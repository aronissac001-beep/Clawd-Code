// Heroes (rework Stream C). 0-2 named champions, commanded exactly like squads:
//   heroMove   walk there (ignoring foes on the way) and hold that post, facing outward
//   heroAttack go for that foe (guard beasts included); the post follows it while it lives
//   heroAuto   drop the post: guard the Hearth again
// Guard-post AI: at its post a hero engages foes within postAggro tiles of the post (through
// engage.acquire, with the same hold-after-kill, minimum target time and release hysteresis as
// soldiers), walks back with arrival steering when clear and stands still. With no post it
// guards within hearthGuard tiles of the Hearth from a spot in front of it. Below its trait's
// threshold it falls back to the Hearth until healed. Guard beasts are never chased unless
// ordered, and there is no idle wandering.
// Heroes join through recruitHero (the Recruit Dawn/Beacon card or a Mystery event); a new run
// has none. Perks earned on a level-up wait in e.owedPerks and are offered at dawn (never as a
// modal in the middle of a night).
//
// Region state: s.heroes (movers of kind 'hero') and s.ext.heroes { fallen: [...], splash: [...], seq }.
// Hero mover fields (plain JSON): postX/postY (null: guard the Hearth), orderTarget, march (1 while
//   walking to a move order), orderT (time of the last order), owedPerks ([[perk ids], ...]),
//   retreat, kills, level, xp, perks, gk (what it is doing, for the card).
// Run state: run.ext.heroes (the living roster) and run.ext.fallen (the honoured dead).
//
// API for the Dawn Cards (stream H2) and events:
//   recruitHero(s, cls, opts)   spawn a new hero (cap HERO_RULES.maxHeroes); returns it or null
//   canRecruit(s)               below the cap?
//   recruitOffers(s, n)         n rolled candidates { cls, name, trait } (consumes the region rng)
//   pendingPerks(s)             [{ heroId, name, level, options: [perk ids] }] owed perk choices
//   heroCards(s, n)             ready-made card options (perk choices first, then recruits)
//   takeHeroCard(s, card)       apply one of them -> { ok, msg? }
//   heroCardHasEffect(s, card)  false when the card would do nothing now
import { BUS, HOOKS } from '../hooks.js';
import { BUILDINGS } from '../../data/buildings.js';
import { BAL } from '../../data/balance.js';
import {
  HERO_CLASSES, HERO_RULES as R, TAVERN_BUILDING, XP_TABLE, MAX_LEVEL, PERK_LEVELS, LEVEL_GROWTH,
  KILL_XP, rollHero, perkDef, perkChoice, traitOf,
} from '../../data/heroes.js';
import { T, ctr, clamp, distToRect, WORLD } from '../grid.js';
import { newId, emit, getE, hurt, rng } from './common.js';
import { engage, moveTo } from './units.js';
import { separate, setFacing } from './movement.js';
import { losClear } from './pathing.js';
import { acquire, attackers, slotCap, releaseSlot, hold, holdSecs, trackTarget } from './engage.js';
import { spawnProjectile } from './combat.js';
import { revealAround } from './fog.js';

export { R as HERO_RULES };
const C = BAL.combat;

// ---- State helpers -------------------------------------------------------------------
export function heroExt(s) {
  const X = s.ext.heroes || (s.ext.heroes = { fallen: [], splash: [], seq: 1 });
  if (!X.fallen) X.fallen = [];
  if (!X.splash) X.splash = [];
  if (!X.seq) X.seq = 1;
  return X;
}
export function livingHeroes(s) {
  let n = 0;
  for (const e of s.heroes || []) if (e.alive && e.kind === 'hero') n++;
  return n;
}
export function heroByHid(s, hid) {
  for (const e of s.heroes) if (e.alive && e.hid === hid) return e;
  return null;
}
function heroById(s, id) {
  const e = getE(s, id);
  return e && e.kind === 'hero' && e.alive ? e : null;
}

// ---- Stats ---------------------------------------------------------------------------------
/** Full stats for a class at a level with perks (plain object). */
export function computeStats(cls, level, perks) {
  const c = HERO_CLASSES[cls] || HERO_CLASSES.paladin;
  const lv = Math.max(0, (level || 1) - 1);
  const st = {
    hp: c.hp * (1 + LEVEL_GROWTH.hp * lv), armor: c.armor, dmg: c.dmg * (1 + LEVEL_GROWTH.dmg * lv), dmgType: c.dmgType,
    rate: c.rate, range: c.range, speed: c.speed, sight: c.sight, ranged: !!c.ranged, bonus: c.bonus || {}, cleave: c.cleave || 0,
    regen: 0, xpMult: 1, power: 0, abilCd: 0,
  };
  for (const id of perks || []) {
    const p = perkDef(id);
    if (!p) continue;
    for (const k in p.stats) st[k] = (st[k] || 0) + p.stats[k];
  }
  st.hp = Math.round(st.hp);
  st.dmg = Math.round(st.dmg * 10) / 10;
  st.rate = Math.max(0.3, st.rate);
  st.armor = Math.min(0.6, st.armor);
  st.abilCd = Math.max(-0.7, st.abilCd);
  return st;
}

/** Cached stats for a hero mover (rebuilt when its level or perks change, or after a load). */
export function heroStats(s, e) {
  const m = s.rt.heroSt || (s.rt.heroSt = new Map());
  const key = e.level * 100 + e.perks.length;
  let c = m.get(e.id);
  if (!c || c.k !== key) { c = { k: key, st: computeStats(e.cls, e.level, e.perks) }; m.set(e.id, c); }
  return c.st;
}

function refreshStats(s, e) {
  const st = heroStats(s, e);
  const d = st.hp - e.maxHp;
  e.maxHp = st.hp; e.armor = st.armor; e.sight = st.sight;
  if (d > 0) e.hp += d;
  e.hp = Math.min(e.hp, e.maxHp);
}

/** Perk ids this build no longer knows (retired perks in older saves) become the last option
 *  of the first perk level the hero has not picked from yet. */
function sanitizePerks(cls, perks) {
  const out = [];
  for (const id of perks || []) if (perkDef(id) && !out.includes(id)) out.push(id);
  const lost = (perks || []).length - out.length;
  for (let k = 0; k < lost; k++) {
    for (const lv of PERK_LEVELS) {
      const P = perkChoice(cls, lv);
      if (!P || P.some((p) => out.includes(p.id))) continue;
      out.push(P[P.length - 1].id);
      break;
    }
  }
  return out;
}

/** Fill in fields older saves lack and drop the retired ones (Rally, quirks, idle wander; the v4
 *  migration in state.js already dropped the gold-flag fields). Idempotent: it runs after every
 *  load and whenever the hero list changes, so a resumed save plays like the run that wrote it. */
function normalize(e) {
  if (e.postX === undefined || e.postY === undefined || e.postX === null || e.postY === null) { e.postX = null; e.postY = null; }
  if (!Array.isArray(e.owedPerks)) e.owedPerks = [];
  if (!e.orderTarget) e.orderTarget = 0;
  if (!e.march) e.march = 0;
  if (typeof e.orderT !== 'number') e.orderT = -99;
  if (typeof e.kills !== 'number') e.kills = 0;
  if (!Array.isArray(e.perks)) e.perks = [];
  e.perks = sanitizePerks(e.cls, e.perks);
  for (const k of ['rallyT', 'rallyCd', 'rallyX', 'rallyY', 'rallyTarget', 'quirk', 'idleNight', 'retarget', 'gx', 'gy']) delete e[k];
}

// ---- Spawning --------------------------------------------------------------------------------
/** Put a hero (run-roster record) on the map as a mover. */
export function spawnHero(s, h, x, y) {
  const perks = sanitizePerks(h.cls, h.perks);
  const st = computeStats(h.cls, h.level || 1, perks);
  const r = s.rt.rng;
  const e = {
    id: newId(s), kind: 'hero', type: h.cls, x, y, px: x, py: y,
    hp: h.hp != null ? clamp(h.hp, 1, st.hp) : st.hp, maxHp: st.hp, r: 7, face: 1, anim: r.float(0, 6),
    hitT: 0, atkT: 0, cd: 0, alive: true, path: null, pi: 0, stuck: 0,
    hid: h.id, name: h.name, cls: h.cls, trait: h.trait, level: h.level || 1, xp: h.xp || 0,
    perks, kills: h.kills || 0,
    armor: st.armor, sight: st.sight, targetId: 0, think: r.float(0, R.thinkEvery), gk: 'guard',
    retreat: false, postX: null, postY: null, orderTarget: 0, march: 0, orderT: -99,
    owedPerks: Array.isArray(h.owedPerks) ? h.owedPerks.map((o) => o.slice()) : [],
    abilT: 2, hitN: 0, castT: 0, cryUntil: 0, hawkX: x, hawkY: y, hawkT: 0, lastHurt: -99, hpPrev: 0,
  };
  e.hpPrev = e.hp;
  s.rt.eById.set(e.id, e);
  s.heroes.push(e);
  return e;
}

function toRoster(e) {
  return {
    id: e.hid, name: e.name, cls: e.cls, trait: e.trait, level: e.level, xp: Math.round(e.xp),
    perks: e.perks.slice(), hp: Math.max(1, Math.ceil(e.hp)), maxHp: e.maxHp, alive: true, kills: e.kills,
    owedPerks: (e.owedPerks || []).map((o) => o.slice()),
  };
}

/** Where hero number i stands guard in front of the Hearth (and falls back to). */
function hearthFront(s, i = 0) {
  const h = s.rt.hearth;
  if (!h) return { x: WORLD / 2, y: WORLD / 2 };
  return { x: ctr(h.tx + 1) + ((i % 4) - 1.5) * 15, y: (h.ty + h.size) * T + 18 + ((i / 4) | 0) * 10 };
}
function hearthCenter(s) {
  const h = s.rt.hearth;
  return h ? { x: (h.tx + h.size / 2) * T, y: (h.ty + h.size / 2) * T } : { x: WORLD / 2, y: WORLD / 2 };
}

// ---- Recruiting (the Recruit card, events) ---------------------------------------------------
export function canRecruit(s) { return !!s.rt.hearth && livingHeroes(s) < R.maxHeroes; }

/** n distinct candidates { cls, name, trait } (classes the realm already has are avoided). */
export function recruitOffers(s, n = 2) {
  const r = rng(s);
  const have = (s.heroes || []).filter((e) => e.alive).map((e) => e.cls);
  const out = [];
  for (let i = 0; i < n; i++) {
    const h = rollHero(r, null, s.locked && s.locked.heroes, have.concat(out.map((o) => o.cls)));
    out.push({ cls: h.cls, name: h.name, trait: h.trait });
  }
  return out;
}

/** A new hero joins at the Hearth. cls: a class id (or null: rolled). opts: { name, trait }.
 *  Returns the hero mover, or null at the cap (or with no Hearth). */
export function recruitHero(s, cls, opts = {}) {
  if (!canRecruit(s)) return null;
  const X = heroExt(s);
  const r = rng(s);
  const id = rollHero(r, cls && HERO_CLASSES[cls] ? cls : null, s.locked && s.locked.heroes);
  const name = opts.name || id.name;
  const trait = opts.trait && traitOf(opts.trait).id === opts.trait ? opts.trait : id.trait;
  const p = hearthFront(s, livingHeroes(s));
  const e = spawnHero(s, { id: `h${s.act || 1}.${s.step || 0}.${X.seq++}`, name, cls: id.cls, trait, level: 1, xp: 0, perks: [] }, p.x, p.y + 12);
  emit(s, { t: 'sfx', k: 'horn', x: e.x, y: e.y });
  emit(s, { t: 'heroHired', x: e.x, y: e.y, hero: e.id });
  emit(s, { t: 'toast', text: `${e.name} the ${HERO_CLASSES[e.cls].name} joins your realm.`, tone: 'good', icon: 'crown' });
  return e;
}

/** Perk choices waiting for the dawn, oldest first. */
export function pendingPerks(s) {
  const out = [];
  for (const e of s.heroes || []) {
    if (!e.alive || !e.owedPerks || !e.owedPerks.length) continue;
    for (const options of e.owedPerks) out.push({ heroId: e.id, name: e.name, level: e.level, options: options.slice() });
  }
  return out;
}

/** Card options for a dawn pick: the oldest owed perk choice (one card per perk), then recruits.
 *  Card shape: { kind: 'hero', act: 'perk', heroId, perk } | { kind: 'hero', act: 'recruit', cls, name, trait }. */
export function heroCards(s, n = 2) {
  const cards = [];
  const owed = pendingPerks(s)[0];
  if (owed) for (const id of owed.options) if (cards.length < n) cards.push({ kind: 'hero', act: 'perk', heroId: owed.heroId, perk: id });
  if (!cards.length && canRecruit(s)) for (const c of recruitOffers(s, n)) cards.push({ kind: 'hero', act: 'recruit', ...c });
  return cards;
}

/** Display text for a hero card: { title, text, icon }. */
export function heroCardText(s, card) {
  if (card.act === 'perk') {
    const e = getE(s, card.heroId), d = perkDef(card.perk) || { name: card.perk, text: '' };
    return { title: d.name, text: `${e ? e.name : 'Your hero'}: ${d.text}`, icon: 'up' };
  }
  if (card.act === 'recruit') {
    const c = HERO_CLASSES[card.cls] || HERO_CLASSES.paladin;
    return { title: `Recruit ${card.name}`, text: `${c.name}, ${c.role.toLowerCase()}. ${c.ability.name}: ${c.ability.text}`, icon: 'crown' };
  }
  return { title: 'Hero', text: '', icon: 'crown' };
}

export function heroCardHasEffect(s, card) {
  if (!card) return false;
  if (card.act === 'recruit') return canRecruit(s) && !!HERO_CLASSES[card.cls];
  if (card.act === 'perk') {
    const e = heroById(s, card.heroId);
    return !!(e && perkDef(card.perk) && !e.perks.includes(card.perk) && e.owedPerks.some((o) => o.includes(card.perk)));
  }
  return false;
}

export function takeHeroCard(s, card) {
  if (!heroCardHasEffect(s, card)) return { ok: false };
  if (card.act === 'recruit') return recruitHero(s, card.cls, { name: card.name, trait: card.trait }) ? { ok: true } : { ok: false };
  const e = heroById(s, card.heroId);
  const k = e.owedPerks.findIndex((o) => o.includes(card.perk));
  e.owedPerks.splice(k, 1);
  e.perks.push(card.perk);
  refreshStats(s, e);
  emit(s, { t: 'toast', text: `${e.name} learns ${perkDef(card.perk).name}.`, tone: 'good', icon: 'up' });
  return { ok: true };
}

// ---- Experience -------------------------------------------------------------------------------
export function gainXp(s, e, amt) {
  if (!e.alive || amt <= 0) return;
  const st = heroStats(s, e);
  e.xp += amt * st.xpMult;
  while (e.level < MAX_LEVEL && e.xp >= XP_TABLE[e.level]) {
    e.level++;
    refreshStats(s, e);
    const P = PERK_LEVELS.includes(e.level) ? perkChoice(e.cls, e.level) : null;
    emit(s, { t: 'heroLevel', x: e.x, y: e.y, hero: e.id, level: e.level });
    emit(s, { t: 'toast', text: `${e.name} reached level ${e.level}!${P ? ' A perk awaits at dawn.' : ''}`, tone: 'good', icon: 'up' });
    // Never a modal mid-fight: the choice waits for the dawn pick.
    if (P) (e.owedPerks || (e.owedPerks = [])).push(P.map((p) => p.id));
  }
}

// ---- Targeting ----------------------------------------------------------------------------------
/** Glory-seekers: the strongest foe the hero could take on (ties: the nearest). */
function gloryFoe(s, e, st, cx, cy, leash, radius) {
  let best = null, bh = -1, bd = Infinity;
  s.rt.enemyHash.each(e.x, e.y, radius, (f) => {
    if (!f.alive || f.stationary || f.guard || (f.flying && !st.ranged)) return false;
    if (Math.hypot(f.x - cx, f.y - cy) > leash) return false;
    if (!st.ranged && e.slotFoe !== f.id && attackers(f, e) >= slotCap(f)) return false;
    if (!st.ranged && !losClear(s, e.x, e.y, f.x, f.y, 'friend')) return false;
    const d = Math.hypot(f.x - e.x, f.y - e.y);
    if (f.maxHp > bh || (f.maxHp === bh && d < bd)) { bh = f.maxHp; bd = d; best = f; }
    return false;
  });
  return best;
}
const notStationary = (f) => !f.stationary;

/** The area a hero defends: its post, or the Hearth. */
function guardArea(s, e, i, out) {
  if (e.postX !== null) {
    out.ax = e.postX; out.ay = e.postY; out.cx = e.postX; out.cy = e.postY;
    out.leash = R.postLeash * T; out.aggro = R.postAggro * T;
  } else {
    const p = hearthFront(s, i), c = hearthCenter(s), h = s.rt.hearth;
    out.ax = p.x; out.ay = p.y; out.cx = c.x; out.cy = c.y;
    out.leash = (R.hearthGuard + (h ? h.size / 2 : 1.5)) * T; out.aggro = out.leash;
  }
  return out;
}

function think(s, e, st, A) {
  // 1. An attack order.
  if (e.orderTarget) {
    const t = getE(s, e.orderTarget);
    if (t && t.alive && (st.ranged || !t.flying)) return t;
    e.orderTarget = 0;
  }
  // 2. Falling back: only swat what blocks the way.
  if (e.retreat) return acquire(s, e, { radius: T * 1.2, los: !st.ranged, ranged: st.ranged, noGuards: true, filter: notStationary });
  // 3. Walking to a new post: foes on the way are ignored.
  if (e.march) return null;
  // 4. Hold the area: keep the current foe for a second and until it is past leash + 1 tile.
  const cur = getE(s, e.targetId);
  if (cur && cur.alive && (st.ranged || !cur.flying) && !cur.guard) {
    const far = Math.hypot(cur.x - A.cx, cur.y - A.cy) > A.leash + C.releasePad * T;
    if (!far || (e.tgtT || 0) < C.minTargetHold) return cur;
  }
  const radius = Math.min(A.leash, A.aggro + (st.ranged ? st.range * T : 0)) + Math.hypot(e.x - A.cx, e.y - A.cy);
  if (traitOf(e.trait).glory) return gloryFoe(s, e, st, A.cx, A.cy, A.aggro, radius);
  return acquire(s, e, { radius, center: { x: A.cx, y: A.cy }, leash: A.aggro, los: !st.ranged, ranged: st.ranged, noGuards: true, front: true, filter: notStationary });
}

// ---- Abilities ------------------------------------------------------------------------------------
function cdOf(base, st) { return base * (1 + st.abilCd); }

function fxRing(s, x, y, k, r) {
  const L = s.rt.heroFx || (s.rt.heroFx = []);
  if (L.length >= 40) L.shift();
  L.push({ x, y, k, r, t: s.time });
}

function onAttack(s, e, st, t) {
  e.hitN++;
  if (e.cls === 'pyromancer' || e.cls === 'cleric') {
    // Restyle the bolt engage() just loosed.
    for (let i = s.projectiles.length - 1; i >= 0 && i >= s.projectiles.length - 3; i--) {
      const p = s.projectiles[i];
      if (p.src === e.id && p.kind === 'arrow') { p.kind = e.cls === 'pyromancer' ? 'herofire' : 'heroholy'; p.arc = 0.15; break; }
    }
  }
  if (e.cls === 'runesmith' && e.hitN % 4 === 0) {
    const rad = 1.5 * (1 + 0.3 * st.power) * T, dmg = st.dmg * 1.2 * (1 + 0.5 * st.power);
    const x = t.x, y = t.y;
    s.rt.enemyHash.each(x, y, rad, (o) => { if (o.kind === 'enemy') hurt(s, o, dmg, 'magic', null, x, y, e); return false; });
    e.castT = 0.4;
    fxRing(s, x, y, 'rune', rad);
    emit(s, { t: 'sfx', k: 'nova', x, y });
  }
}

function abilities(s, e, st, t, dt) {
  e.abilT -= dt;
  if (e.abilT > 0) return;
  switch (e.cls) {
    case 'ranger': {
      if (!t) { e.abilT = 0.5; return; }
      let n = 0;
      const dmg = st.dmg * 0.8 * (1 + st.power);
      s.rt.enemyHash.each(e.x, e.y, st.range * T, (o) => {
        if (o.kind !== 'enemy' || o.stationary) return false;
        spawnProjectile(s, 'arrow', e.x, e.y - 10, o, dmg, st.dmgType, st.bonus, 14, 1, e.id);
        return ++n >= 3;
      });
      if (n) { e.abilT = cdOf(7, st); e.atkT = 0.2; emit(s, { t: 'sfx', k: 'bow', x: e.x, y: e.y }); } else e.abilT = 0.5;
      return;
    }
    case 'cleric': {
      let best = null, bf = 0.95;
      const r2 = (4 * T) * (4 * T);
      const test = (o) => {
        if (!o || !o.alive || o.hp >= o.maxHp) return;
        const dx = o.x - e.x, dy = o.y - e.y;
        if (dx * dx + dy * dy > r2) return;
        const f = o.hp / o.maxHp;
        if (f < bf) { bf = f; best = o; }
      };
      for (const o of s.heroes) test(o);
      for (const o of s.soldiers) test(o);
      test(s.sovereign);
      if (!best) { e.abilT = 0.5; return; }
      const amt = 16 * (1 + st.power);
      best.hp = Math.min(best.maxHp, best.hp + amt);
      e.abilT = cdOf(4, st); e.castT = 0.4;
      fxRing(s, best.x, best.y, 'heal', 14);
      emit(s, { t: 'heal', x: best.x, y: best.y, amt });
      return;
    }
    case 'warlord': {
      if (!t || Math.hypot(t.x - e.x, t.y - e.y) > 3 * T) { e.abilT = 0.5; return; }
      e.cryUntil = s.time + 6; e.castT = 0.5;
      e.abilT = cdOf(14, st);
      fxRing(s, e.x, e.y, 'cry', 3.5 * T);
      emit(s, { t: 'sfx', k: 'clash', x: e.x, y: e.y });
      return;
    }
    case 'beastmaster': {
      // The hawk scouts ahead of where she is going, else circles outward from her post.
      const far = (5 + 2 * st.power) * T;
      const c = hearthCenter(s);
      const gx = e.postX !== null ? e.postX : e.x, gy = e.postY !== null ? e.postY : e.y;
      let ang;
      if (Math.hypot(gx - e.x, gy - e.y) > 2 * T) ang = Math.atan2(gy - e.y, gx - e.x);
      else if (Math.hypot(e.x - c.x, e.y - c.y) > T) ang = Math.atan2(e.y - c.y, e.x - c.x) + Math.sin(e.id * 1.7 + s.time * 0.37) * 0.9;
      else ang = (e.id * 1.7 + s.time * 0.37) % (Math.PI * 2);
      const hx = clamp(e.x + Math.cos(ang) * far, 16, WORLD - 16), hy = clamp(e.y + Math.sin(ang) * far, 16, WORLD - 16);
      revealAround(s, hx, hy, 4 * (1 + 0.4 * st.power) * (s.rt.sightMult || 1));
      e.hawkX = hx; e.hawkY = hy; e.hawkT = 2.4;
      e.abilT = cdOf(6, st);
      return;
    }
    default: e.abilT = 1;
  }
}

// Wildfire bursts are queued by dmgMult (a hit cannot safely hurt others mid-hurt) and
// resolved at the start of the next hero update. The queue is plain JSON in s.ext so a
// save between the hit and the burst loses nothing.
function runSplashes(s) {
  const q = s.ext.heroes && s.ext.heroes.splash;
  if (!q || !q.length) return;
  s.rt.heroSplashing = true;
  for (let i = 0; i < q.length; i++) {
    const sp = q[i];
    const src = getE(s, sp.src);
    if (!src) continue;
    const st = heroStats(s, src);
    const rad = (1 + 0.4 * st.power) * T, dmg = st.dmg * 0.5 * (1 + st.power);
    s.rt.enemyHash.each(sp.x, sp.y, rad, (o) => { if (o.id !== sp.tid && o.kind === 'enemy') hurt(s, o, dmg, 'fire', null, sp.x, sp.y, src); return false; });
    fxRing(s, sp.x, sp.y, 'fire', rad);
  }
  q.length = 0;
  s.rt.heroSplashing = false;
}

// ---- Per-tick update ---------------------------------------------------------------------------
const AREA = { ax: 0, ay: 0, cx: 0, cy: 0, leash: 0, aggro: 0 };

export function updateHeroes(s, dt) {
  if (!s.heroes.length) {
    if (s.ext.heroes && s.ext.heroes.splash && s.ext.heroes.splash.length) s.ext.heroes.splash.length = 0;
    return;
  }
  heroExt(s);
  if (s.rt.heroNorm !== s.heroes.length) { s.rt.heroNorm = s.heroes.length; for (const e of s.heroes) normalize(e); }
  runSplashes(s);
  const h = s.rt.hearth;
  let order = 0;
  for (const e of s.heroes) {
    if (!e.alive || e.away) continue;
    const st = heroStats(s, e);
    if (e.maxHp !== st.hp) refreshStats(s, e);
    const tr = traitOf(e.trait);
    e.hitT = Math.max(0, e.hitT - dt); e.atkT = Math.max(0, e.atkT - dt); e.cd -= dt;
    e.castT = Math.max(0, e.castT - dt); e.hawkT = Math.max(0, e.hawkT - dt);
    if (e.hp < e.hpPrev - 0.01) e.lastHurt = s.time;
    // Regeneration: a little when out of the fight (more for restful traits), more at the Hearth.
    let reg = st.regen + (s.time - e.lastHurt > 5 && !e.targetId ? R.regenIdle * (tr.rest || 1) : 0);
    if (h && distToRect(e.x, e.y, h) < R.hearthRange * T) reg += R.regenHearth;
    if (reg > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + reg * dt);
    e.hpPrev = e.hp;
    // Fall back below the trait's threshold, unless the player gave an order in the last 4 s.
    if (!e.retreat && h && e.hp < e.maxHp * tr.retreat && s.time - e.orderT > 4) {
      e.retreat = true; e.march = 0; e.orderTarget = 0; e.think = 0;
      emit(s, { t: 'toast', text: `${e.name} is wounded and falls back to the Hearth.`, tone: 'bad', icon: 'shield' });
    }
    if (e.retreat && e.hp >= e.maxHp * 0.8) { e.retreat = false; e.think = 0; }

    // An attack order: the post follows a grounded target.
    if (e.orderTarget) {
      const ot = getE(s, e.orderTarget);
      if (ot && ot.alive) { if (!ot.flying) { e.postX = Math.round(ot.x); e.postY = Math.round(ot.y); } } else e.orderTarget = 0;
    }
    const A = guardArea(s, e, order, AREA);
    if (e.retreat) { const p = hearthFront(s, order); A.ax = p.x; A.ay = p.y; }
    order++;
    // A move order: arrived, wedged close by, or walking too long (unreachable): hold there.
    if (e.march) {
      const dd = Math.hypot(A.ax - e.x, A.ay - e.y);
      if (dd < T * 0.5 || (e.stuck > 2 && dd < T * 2)) e.march = 0;
      else if (e.stuck > 4 || s.time - e.orderT > R.marchMax) {
        e.march = 0; e.postX = Math.round(e.x); e.postY = Math.round(e.y); e.path = null;
        guardArea(s, e, order - 1, A);
      }
    }

    let t = getE(s, e.targetId);
    if (t && (!t.alive || t.kind === 'hero')) t = null;
    if (e.targetId && !t) { e.targetId = 0; releaseSlot(e); if (!e.march) hold(e, holdSecs(e)); e.think = 0; }
    if (e.holdT > 0) e.holdT = Math.max(0, e.holdT - dt);
    e.think -= dt;
    if (e.think <= 0) {
      e.think = R.thinkEvery;
      const nt = think(s, e, st, A);
      if (t && nt !== t) releaseSlot(e);
      t = nt && nt.alive ? nt : null;
      e.targetId = t ? t.id : 0;
    }
    trackTarget(e, t, dt);
    const fleeing = e.retreat && t && Math.hypot(t.x - e.x, t.y - e.y) > T * 1.5;
    if (t && !fleeing) {
      const cd0 = e.cd;
      engage(s, e, t, st, dt, 1);
      if (cd0 <= 0 && e.cd > 0) onAttack(s, e, st, t);
    }
    if (!e.targetId || fleeing) {
      if (e.holdT > 0 && !e.march && !e.retreat) { e.path = null; if (e.hfx !== undefined) setFacing(e, e.hfx - e.x, 'target'); }
      else {
        moveTo(s, e, A.ax, A.ay, st.speed, dt);
        // Settled at the post: face outward, away from the Hearth.
        if (!e.march && !e.retreat && Math.hypot(A.ax - e.x, A.ay - e.y) < T * 0.75) {
          const c = hearthCenter(s);
          setFacing(e, (e.postX !== null ? A.ax : e.x) - c.x, 'target');
        }
      }
    }
    e.gk = e.retreat ? 'home' : e.march ? 'march' : e.orderTarget ? 'attack' : e.targetId ? 'fight' : e.postX !== null ? 'post' : 'guard';
    abilities(s, e, st, t && t.alive ? t : null, dt);
    separate(s, e, s.rt.friendHash, C.separation, 'friend');
  }
}

// ---- Damage modifiers (hot path) --------------------------------------------------------------
function dmgMult(s, a, t, type) {
  const H = s.heroes;
  if (!H.length) return 1;
  let m = 1;
  if (a && a.kind === 'hero' && t.kind === 'enemy') {
    if (a.cls === 'rogue' && ((t.targetId && t.targetId !== a.id) || t.siege)) m *= 2 * (1 + heroStats(s, a).power);
    if (a.cls === 'pyromancer' && type === 'fire' && !s.rt.heroSplashing) {
      const X = heroExt(s);
      if (X.splash.length < 32) X.splash.push({ x: t.x, y: t.y, tid: t.id, src: a.id });
    }
  }
  // Friendly auras.
  const friendHit = t.kind !== 'enemy';
  const friendAtk = a && a.kind && a.kind !== 'enemy';
  if (!friendHit && !friendAtk) return m;
  let aegis = 0, cry = 0;
  for (let i = 0; i < H.length; i++) {
    const p = H[i];
    if (!p.alive) continue;
    if (friendHit && p.cls === 'paladin') {
      const st = heroStats(s, p), r = 3 * (1 + 0.33 * st.power) * T;
      const dx = p.x - t.x, dy = p.y - t.y;
      if (dx * dx + dy * dy <= r * r) aegis = Math.max(aegis, 0.15 * (1 + st.power));
    }
    if (friendAtk && p.cls === 'warlord' && p.cryUntil > s.time) {
      const dx = p.x - a.x, dy = p.y - a.y, r = 3.5 * T;
      if (dx * dx + dy * dy <= r * r) cry = Math.max(cry, 0.2 * (1 + heroStats(s, p).power));
    }
  }
  return m * (1 - aegis) * (1 + cry);
}

// ---- Commands (same shape as squadMove / squadAttack) -------------------------------------------
function okPoint(c) { return typeof c.x === 'number' && typeof c.y === 'number' && isFinite(c.x) && isFinite(c.y); }

function cmdHeroMove(s, c) {
  const e = heroById(s, c.id);
  if (!e || !okPoint(c)) return { ok: false };
  normalize(e);
  e.postX = Math.round(clamp(c.x, 8, WORLD - 8)); e.postY = Math.round(clamp(c.y, 8, WORLD - 8));
  e.orderTarget = 0; e.targetId = 0; releaseSlot(e); e.holdT = 0;
  e.march = 1; e.retreat = false; e.orderT = s.time; e.path = null; e.stuck = 0; e.think = R.thinkEvery;
  return { ok: true };
}

function cmdHeroAttack(s, c) {
  const e = heroById(s, c.id);
  const t = getE(s, c.target);
  if (!e || !t || !t.alive || t.kind !== 'enemy') return { ok: false };
  normalize(e);
  if (t.flying && !heroStats(s, e).ranged) return { ok: false, msg: `${e.name} cannot reach a foe on the wing.` };
  e.orderTarget = t.id; e.targetId = t.id; e.march = 0; e.holdT = 0;
  e.postX = Math.round(t.x); e.postY = Math.round(t.y);
  e.retreat = false; e.orderT = s.time; e.path = null; e.stuck = 0; e.think = R.thinkEvery;
  return { ok: true };
}

function cmdHeroAuto(s, c) {
  const e = heroById(s, c.id);
  if (!e) return { ok: false };
  normalize(e);
  e.postX = null; e.postY = null; e.orderTarget = 0; e.march = 0; e.holdT = 0;
  e.orderT = s.time; e.path = null; e.think = 0;
  return { ok: true };
}

// An older save may still hold a perk choice queued in the middle of a night: answer it.
function choosePerk(s, i) {
  const p = s.pending;
  const id = p.options[i];
  const e = getE(s, p.heroId);
  if (e && e.kind === 'hero' && perkDef(id) && !e.perks.includes(id)) {
    e.perks.push(id);
    refreshStats(s, e);
    emit(s, { t: 'toast', text: `${e.name} learns ${perkDef(id).name}.`, tone: 'good', icon: 'up' });
  }
  s.pending = null;
  return { ok: true };
}

// ---- Hero dawn pick (until the Dawn Cards of stream H2 set HOOKS.dawnCard) --------------------
// On a dawn whose pick is a plain Offering, a hero choice takes its place when a hero has a perk
// waiting, or on a region's first dawn while there is room for a recruit. A small supply of gold
// is always the third option, so taking a hero is a choice. Still exactly one pick per dawn.
function heroDawn(s) {
  if (HOOKS.dawnCard || !s.pending || s.pending.kind !== 'boon' || s.outcome) return;
  const owed = pendingPerks(s).length > 0;
  if (!owed && !(s.cycle.night === 1 && canRecruit(s))) return;
  const cards = heroCards(s, 2);
  if (!cards.length) return;
  cards.push({ kind: 'hero', act: 'supplies', gold: R.supplyGold });
  s.pending = { kind: 'heroDawn', options: cards };
}

function chooseHeroDawn(s, i) {
  const o = s.pending.options[i];
  if (!o) return { ok: false };
  if (o.act === 'supplies') { s.res.gold += o.gold; emit(s, { t: 'sfx', k: 'coin' }); }
  else takeHeroCard(s, o);
  s.pending = null;
  return { ok: true };
}

// ---- Life-cycle hooks --------------------------------------------------------------------------
function onKill(s, v, killer) {
  if (v.kind === 'hero') {
    const X = heroExt(s);
    X.fallen.push({ ...toRoster(v), hp: 0, alive: false, act: s.act || 1, step: s.step || 0, night: s.cycle.night });
    emit(s, { t: 'toast', text: `${v.name} has fallen. Heroes do not return.`, tone: 'bad', icon: 'skull' });
    if (s.rt.heroSt) s.rt.heroSt.delete(v.id);
    return;
  }
  if (!s.heroes.length || (v.kind !== 'enemy' && !v.guard)) return;
  // Experience: the killer earns it all, heroes nearby share some.
  let base = KILL_XP[v.type] || 6;
  if (v.affix === 'warden') base *= 3;
  const r2 = (R.shareRadius * T) * (R.shareRadius * T);
  for (const e of s.heroes) {
    if (!e.alive) continue;
    if (killer === e) {
      e.kills++;
      gainXp(s, e, base);
      continue;
    }
    const dx = e.x - v.x, dy = e.y - v.y;
    if (dx * dx + dy * dy <= r2) gainXp(s, e, base * R.shareFrac);
  }
}

function onRegionInit(s, ctx) {
  heroExt(s);
  const run = ctx && ctx.run;
  if (!run || !run.ext) return;
  const roster = run.ext.heroes || [];
  let i = 0;
  for (const h of roster) {
    if (!h.alive || i >= R.maxHeroes) continue;
    const p = hearthFront(s, i++);
    const st = computeStats(h.cls, h.level || 1, sanitizePerks(h.cls, h.perks));
    const hp = h.hp == null ? st.hp : Math.min(st.hp, h.hp + st.hp * R.carryHeal);
    spawnHero(s, { ...h, hp }, p.x, p.y + 12);
  }
}

function onRunNew(run) {
  run.ext.heroes = []; // no free starter: heroes come from the Recruit card
  run.ext.fallen = [];
}

function onRunRegion(run) {
  if (!run.ext) run.ext = {};
  if (!Array.isArray(run.ext.heroes)) run.ext.heroes = [];
  if (!Array.isArray(run.ext.fallen)) run.ext.fallen = [];
}

function onRunRegionEnd(run, s, summary) {
  const X = s.ext && s.ext.heroes;
  if (!run.ext) run.ext = {};
  run.ext.fallen = run.ext.fallen || [];
  // A region saved before heroes existed (Phase 2) never ran regionInit: keep the roster it was given.
  if (!X && !(s.heroes && s.heroes.length)) { if (!Array.isArray(run.ext.heroes)) run.ext.heroes = []; return; }
  run.ext.heroes = (s.heroes || []).filter((e) => e.alive && e.kind === 'hero').map(toRoster);
  // Perk choices still waiting (an older save's queued modal) travel with the hero.
  for (const p of [s.pending, ...(s.pendingQueue || [])]) {
    if (!p || p.kind !== 'perk') continue;
    const h = run.ext.heroes.find((x) => x.id === p.hid);
    if (h) h.owedPerks.push(p.options.slice());
  }
  if (X) {
    for (const f of X.fallen) run.ext.fallen.push(f);
    if (summary) summary.heroesLost = X.fallen.map((f) => f.name);
  }
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  // Retired Tavern: still defined for older saves, never drafted or shown in the build bar.
  Object.assign(BUILDINGS, TAVERN_BUILDING);
  BUS.draftVeto.push((holder, type) => type === 'tavern');
  BUS.regionInit.push(onRegionInit);
  BUS.tick.push(updateHeroes);
  BUS.phase.push((s, phase) => { if (phase === 'dawn') heroDawn(s); });
  BUS.kill.push(onKill);
  BUS.dmgMult.push(dmgMult);
  BUS.runNew.push(onRunNew);
  BUS.runRegion.push(onRunRegion);
  BUS.runRegionEnd.push(onRunRegionEnd);
  Object.assign(BUS.commands, { heroMove: cmdHeroMove, heroAttack: cmdHeroAttack, heroAuto: cmdHeroAuto });
  BUS.choose.perk = choosePerk;
  BUS.choose.heroDawn = chooseHeroDawn;
}
