// Heroes and bounty flags (Phase 3). Heroes are independent champions: the
// player never orders them directly (except a short Rally), but tempts them with
// gold bounties. Each hero re-thinks its goal about once a second:
//   rally order > retreat when hurt > best bounty > fight nearby Hollow >
//   guard the settlement at night > rest or wander near the Hearth by day.
// Region state: s.heroes (movers of kind 'hero') and s.ext.heroes
//   { bounties: [...], tavern: { [buildingId]: { day, list } }, fallen: [...], splash: [...], seq, bseq }.
// Run state: run.ext.heroes (the living roster) and run.ext.fallen (the honoured dead).
import { BUS } from '../hooks.js';
import { BUILDINGS, BUILD_ORDER, levelStats } from '../../data/buildings.js';
import { FACTIONS } from '../../data/factions.js';
import {
  HERO_CLASSES, TRAITS, HERO_RULES as R, TAVERN_BUILDING, XP_TABLE, MAX_LEVEL, PERK_LEVELS, LEVEL_GROWTH,
  KILL_XP, rollHero, perkDef,
} from '../../data/heroes.js';
import { T, N, idx, tileOf, ctr, inB, clamp, distToRect, WORLD } from '../grid.js';
import { newId, emit, getE, getB, hurt, queuePending, moodAdd, accessTile } from './common.js';
import { engage, moveTo } from './units.js';
import { separate } from './movement.js';
import { spawnProjectile } from './combat.js';
import { revealAround } from './fog.js';
import { withRng } from '../run.js';

export { R as HERO_RULES };
const BOUNTY_KINDS = ['attack', 'explore', 'defend', 'avoid'];
const SEPARATION = 9;

// ---- State helpers -------------------------------------------------------------------
export function heroExt(s) {
  return s.ext.heroes || (s.ext.heroes = { bounties: [], tavern: {}, fallen: [], splash: [], seq: 1, bseq: 1 });
}
export function livingHeroes(s) {
  let n = 0;
  for (const e of s.heroes) if (e.alive && e.kind === 'hero') n++;
  return n;
}
export function heroByHid(s, hid) {
  for (const e of s.heroes) if (e.alive && e.hid === hid) return e;
  return null;
}
export function bountyById(s, id) {
  const X = s.ext.heroes;
  if (!X) return null;
  for (const b of X.bounties) if (b.id === id) return b;
  return null;
}
export function tavernOffers(s, b) {
  const X = s.ext.heroes;
  return X && X.tavern[b.id] ? X.tavern[b.id].list : [];
}

// ---- Stats ---------------------------------------------------------------------------------
/** Full stats for a class at a level with perks and a quirk (plain object). */
export function computeStats(cls, level, perks, quirk) {
  const c = HERO_CLASSES[cls] || HERO_CLASSES.paladin;
  const lv = Math.max(0, (level || 1) - 1);
  const st = {
    hp: c.hp * (1 + LEVEL_GROWTH.hp * lv), armor: c.armor, dmg: c.dmg * (1 + LEVEL_GROWTH.dmg * lv), dmgType: c.dmgType,
    rate: c.rate, range: c.range, speed: c.speed, sight: c.sight, ranged: !!c.ranged, bonus: c.bonus || {}, cleave: c.cleave || 0,
    regen: 0, xpMult: 1, goldMult: 1, power: 0, abilCd: 0,
  };
  for (const id of perks || []) {
    const p = perkDef(id);
    if (!p) continue;
    for (const k in p.stats) st[k] = (st[k] || 0) + p.stats[k];
  }
  if (quirk === 'stout') st.hp *= 1.1;
  if (quirk === 'sleepwalker') st.xpMult += 0.15;
  if (quirk === 'collector') st.goldMult += 0.25;
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
  if (!c || c.k !== key) { c = { k: key, st: computeStats(e.cls, e.level, e.perks, e.quirk) }; m.set(e.id, c); }
  return c.st;
}

function refreshStats(s, e) {
  const st = heroStats(s, e);
  const d = st.hp - e.maxHp;
  e.maxHp = st.hp; e.armor = st.armor; e.sight = st.sight;
  if (d > 0) e.hp += d;
  e.hp = Math.min(e.hp, e.maxHp);
}

// ---- Spawning --------------------------------------------------------------------------------
/** Put a hero (run-roster record) on the map as a mover. */
export function spawnHero(s, h, x, y) {
  const st = computeStats(h.cls, h.level || 1, h.perks || [], h.quirk);
  const r = s.rt.rng;
  const e = {
    id: newId(s), kind: 'hero', type: h.cls, x, y, px: x, py: y,
    hp: h.hp != null ? clamp(h.hp, 1, st.hp) : st.hp, maxHp: st.hp, r: 7, face: 1, anim: r.float(0, 6),
    hitT: 0, atkT: 0, cd: 0, alive: true, path: null, pi: 0, stuck: 0,
    hid: h.id, name: h.name, cls: h.cls, trait: h.trait, quirk: h.quirk, level: h.level || 1, xp: h.xp || 0,
    perks: (h.perks || []).slice(), purse: h.purse || 0, kills: h.kills || 0,
    armor: st.armor, sight: st.sight, targetId: 0, think: r.float(0, R.thinkEvery), gk: 'idle', gx: x, gy: y, bountyId: 0,
    retreat: false, rallyT: 0, rallyCd: 0, rallyX: x, rallyY: y, rallyTarget: 0,
    abilT: 2, hitN: 0, castT: 0, cryUntil: 0, hawkX: x, hawkY: y, hawkT: 0, lastHurt: -99, hpPrev: 0,
    lastFoe: 0, retarget: 0, idleNight: false, skipB: 0, skipT: 0,
  };
  e.hpPrev = e.hp;
  s.rt.eById.set(e.id, e);
  s.heroes.push(e);
  return e;
}

function toRoster(e) {
  return {
    id: e.hid, name: e.name, cls: e.cls, trait: e.trait, quirk: e.quirk, level: e.level, xp: Math.round(e.xp),
    perks: e.perks.slice(), hp: Math.max(1, Math.ceil(e.hp)), maxHp: e.maxHp, alive: true, purse: e.purse, kills: e.kills,
  };
}

export function makeStarter(run) {
  const f = FACTIONS[run.faction] || FACTIONS.dawnhold;
  const id = withRng(run, (r) => rollHero(r.fork('hero:starter'), f.heroClass));
  return { id: 'h0', ...id, level: 1, xp: 0, perks: [], hp: null, maxHp: null, alive: true, purse: 0, kills: 0 };
}

function hearthFront(s, i = 0) {
  const h = s.rt.hearth;
  if (!h) return { x: WORLD / 2, y: WORLD / 2 };
  return { x: ctr(h.tx + 1) + ((i % 4) - 1.5) * 15, y: (h.ty + h.size) * T + 18 + ((i / 4) | 0) * 10 };
}

// ---- Tavern ------------------------------------------------------------------------------------
function rollTavern(s, b) {
  const X = heroExt(s);
  const n = levelStats('tavern', b.level).recruits || 2;
  const r = s.rt.rng;
  const list = [];
  for (let i = 0; i < n; i++) {
    const h = rollHero(r, null, s.locked && s.locked.heroes);
    list.push({ ...h, price: Math.round(r.int(R.priceMin, R.priceMax) / 5) * 5, hired: false });
  }
  X.tavern[b.id] = { day: s.cycle.night, list };
}

// ---- Bounties ----------------------------------------------------------------------------------
function inAvoid(s, x, y) {
  const X = s.ext.heroes;
  if (!X) return false;
  const r2 = (R.avoidRadius * T) * (R.avoidRadius * T);
  for (const b of X.bounties) if (b.kind === 'avoid') { const dx = b.x - x, dy = b.y - y; if (dx * dx + dy * dy < r2) return b; }
  return null;
}

function removeBounty(s, b) {
  const X = heroExt(s);
  const i = X.bounties.indexOf(b);
  if (i >= 0) X.bounties.splice(i, 1);
  for (const e of s.heroes) if (e.bountyId === b.id) { e.bountyId = 0; e.think = Math.min(e.think, 0.2); }
}

function refundBounty(s, b, why) {
  if (b.gold) s.res.gold += b.gold;
  removeBounty(s, b);
  if (why) emit(s, { t: 'toast', text: why + (b.gold ? ` ${b.gold} gold returned.` : ''), tone: '', icon: 'gold' });
}

function payBounty(s, b, e) {
  const st = heroStats(s, e);
  const paid = Math.round(b.gold * st.goldMult);
  e.purse += paid;
  removeBounty(s, b);
  emit(s, { t: 'sfx', k: 'coin', x: e.x, y: e.y });
  emit(s, { t: 'bountyPaid', x: e.x, y: e.y, gold: paid, hero: e.id, kind: b.kind });
  const what = b.kind === 'attack' ? 'slew the marked foe' : b.kind === 'explore' ? 'scouted the flag' : 'held the line';
  emit(s, { t: 'toast', text: `${e.name} ${what} and claims ${paid} gold.`, tone: 'good', icon: 'gold' });
  gainXp(s, e, b.gold * R.bountyXp);
}

function bountyScore(s, e, st, b) {
  if (b.kind === 'avoid') return 0;
  const w = (TRAITS[e.trait] || TRAITS.brave).weights[b.kind] || 1;
  if (b.kind === 'attack') {
    const t = getE(s, b.targetId);
    if (!t || (t.flying && !st.ranged)) return 0;
  }
  const bx = b.kind === 'attack' ? getE(s, b.targetId).x : b.x, by = b.kind === 'attack' ? getE(s, b.targetId).y : b.y;
  const d = Math.hypot(bx - e.x, by - e.y) / T;
  return (b.gold * w * (e.quirk === 'collector' ? 1.15 : 1)) / (1 + d / 6);
}

function bestBounty(s, e, st) {
  const X = s.ext.heroes;
  if (!X || !X.bounties.length) return null;
  let best = null, bs = 2.5; // a bounty must be worth the walk
  for (const b of X.bounties) {
    if (b.id === e.skipB && s.time < e.skipT) continue;
    const sc = bountyScore(s, e, st, b) * (b.id === e.bountyId ? 1.25 : 1); // a little commitment
    if (sc > bs) { bs = sc; best = b; }
  }
  return best;
}

function updateBounties(s) {
  const X = s.ext.heroes;
  for (let i = X.bounties.length - 1; i >= 0; i--) {
    const b = X.bounties[i];
    if (b.kind === 'attack') {
      const t = getE(s, b.targetId);
      if (!t) { refundBounty(s, b, 'The marked foe is gone.'); continue; }
      b.x = t.x; b.y = t.y;
    } else if (b.kind === 'defend') {
      const bd = getB(s, b.buildingId);
      if (!bd) { refundBounty(s, b, 'The guarded building fell.'); continue; }
      if (s.time >= b.until) {
        let best = null, bdist = R.defendNear * T;
        for (const e of s.heroes) {
          if (!e.alive) continue;
          const d = distToRect(e.x, e.y, bd);
          if (d <= bdist) { bdist = d; best = e; }
        }
        if (best) payBounty(s, b, best);
        else refundBounty(s, b, `No hero stood guard at the ${BUILDINGS[bd.type].name}.`);
      }
    }
  }
}

// ---- Experience -------------------------------------------------------------------------------
export function gainXp(s, e, amt) {
  if (!e.alive || amt <= 0) return;
  const st = heroStats(s, e);
  // Adventurers' Quarter (combos.js) raises hero XP through a shared flag.
  e.xp += amt * st.xpMult * ((s.ext.combos && s.ext.combos.flags && s.ext.combos.flags.heroXp) || 1);
  while (e.level < MAX_LEVEL && e.xp >= XP_TABLE[e.level]) {
    e.level++;
    refreshStats(s, e);
    emit(s, { t: 'heroLevel', x: e.x, y: e.y, hero: e.id, level: e.level });
    emit(s, { t: 'toast', text: `${e.name} reached level ${e.level}!`, tone: 'good', icon: 'up' });
    if (PERK_LEVELS.includes(e.level)) {
      const P = (HERO_CLASSES[e.cls] || HERO_CLASSES.paladin).perks[e.level];
      if (P) queuePending(s, { kind: 'perk', heroId: e.id, hid: e.hid, name: e.name, level: e.level, options: P.map((p) => p.id) });
    }
  }
}

// ---- Targeting ----------------------------------------------------------------------------------
// Tiles within nightGuard of any building. Rebuilt whenever the building list changes
// (placed: the length changes; finished or removed: the BUS hooks mark it dirty), so the
// cached mask always equals a fresh one and a save/load cannot change hero choices.
function settleMask(s) {
  const rt = s.rt;
  const key = s.buildings.length;
  if (rt.heroGuard && rt.heroGuardK === key && !rt.heroGuardDirty) return rt.heroGuard;
  rt.heroGuardDirty = false;
  const m = rt.heroGuard || (rt.heroGuard = new Uint8Array(N * N));
  m.fill(0);
  const r = R.nightGuard;
  for (const b of s.buildings) {
    if (!b.alive) continue;
    const x0 = Math.max(0, b.tx - r), x1 = Math.min(N - 1, b.tx + b.size - 1 + r);
    const y0 = Math.max(0, b.ty - r), y1 = Math.min(N - 1, b.ty + b.size - 1 + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m[idx(x, y)] = 1;
  }
  rt.heroGuardK = key;
  return m;
}

function canFight(e, st, f) {
  if (!f.alive || f.kind === 'hero') return false;
  if (f.flying && !st.ranged) return false;
  if (e.quirk === 'fearsHounds' && f.type === 'hound') return false;
  return true;
}

function pickFoe(s, e, st, radiusTiles) {
  const glory = (TRAITS[e.trait] || {}).glory;
  const r = Math.max(radiusTiles, st.ranged ? st.range : 0) * T;
  if (glory) {
    let best = null, bh = -1;
    s.rt.enemyHash.each(e.x, e.y, r + T, (f) => {
      if (f.stationary || !canFight(e, st, f) || inAvoid(s, f.x, f.y)) return false;
      if (f.maxHp > bh) { bh = f.maxHp; best = f; }
      return false;
    });
    return best;
  }
  return s.rt.enemyHash.nearest(e.x, e.y, r, (f) => !f.stationary && canFight(e, st, f) && !inAvoid(s, f.x, f.y));
}

function nightFoe(s, e, st) {
  const m = settleMask(s);
  return s.rt.enemyHash.nearest(e.x, e.y, 16 * T, (f) => {
    if (f.stationary || !canFight(e, st, f)) return false;
    const tx = clamp(tileOf(f.x), 0, N - 1), ty = clamp(tileOf(f.y), 0, N - 1);
    return m[idx(tx, ty)] === 1 && !inAvoid(s, f.x, f.y);
  });
}

function walkable(s, x, y) {
  const tx = tileOf(x), ty = tileOf(y);
  if (!inB(tx, ty)) return false;
  const i = idx(tx, ty);
  return !s.occ[i] && !s.nodeGrid[i] && s.terrain[i] !== 4 && s.terrain[i] !== 5;
}

function idleGoal(s, e, night, order) {
  const r = s.rt.rng;
  const h = s.rt.hearth;
  if (!h) return;
  const idle = e.gk === 'wander' || e.gk === 'rest' || e.gk === 'watch';
  // Keep the current idle plan for a while; a new day or night makes a new one.
  if (idle && e.idleNight === night && e.retarget > s.time) return;
  e.idleNight = night;
  const lazy = (TRAITS[e.trait] || TRAITS.brave).rest;
  const hx = (h.tx + 1.5) * T, hy = (h.ty + 1.5) * T;
  const wander = night ? e.quirk === 'sleepwalker' : !r.chance(lazy);
  if (wander) {
    const rad = night ? 5 : 6;
    for (let k = 0; k < 4; k++) {
      const a = r.float(0, Math.PI * 2), d = r.float(2.5, rad) * T;
      const x = hx + Math.cos(a) * d, y = hy + Math.sin(a) * d;
      if (walkable(s, x, y) && !inAvoid(s, x, y)) { e.gx = x; e.gy = y; e.gk = 'wander'; e.retarget = s.time + r.float(6, 12); return; }
    }
  }
  const p = hearthFront(s, order);
  e.gx = p.x + r.float(-6, 6); e.gy = p.y + r.float(-4, 4); e.gk = night ? 'watch' : 'rest';
  e.retarget = s.time + r.float(8, 16);
}

function think(s, e, st, order) {
  e.targetId = 0;
  const night = s.cycle.phase === 'night' || s.cycle.phase === 'dusk';
  // 1. A Rally is a direct order.
  if (e.rallyT > 0) {
    e.gk = 'rally';
    const t = getE(s, e.rallyTarget);
    if (t) { e.targetId = t.id; return; }
    e.rallyTarget = 0; e.gx = e.rallyX; e.gy = e.rallyY;
    const f = s.rt.enemyHash.nearest(e.gx, e.gy, 3 * T, (o) => !o.stationary && canFight(e, st, o));
    if (f) e.targetId = f.id;
    return;
  }
  // 2. Fall back when badly hurt.
  if (e.retreat) {
    e.gk = 'home';
    const p = hearthFront(s, order); e.gx = p.x; e.gy = p.y;
    const f = s.rt.enemyHash.nearest(e.x, e.y, T * 1.2, (o) => canFight(e, st, o));
    if (f) e.targetId = f.id;
    return;
  }
  // 3. Gold.
  const b = bestBounty(s, e, st);
  if (b) {
    e.gk = 'bounty'; e.bountyId = b.id;
    if (!b.claimedBy || !getE(s, b.claimedBy)) b.claimedBy = e.id;
    if (b.kind === 'attack') { e.targetId = b.targetId; return; }
    if (b.kind === 'explore') {
      e.gx = b.x; e.gy = b.y;
      const f = s.rt.enemyHash.nearest(e.x, e.y, T * 1.5, (o) => !o.stationary && canFight(e, st, o));
      if (f) e.targetId = f.id;
      return;
    }
    if (b.kind === 'defend') {
      const bd = getB(s, b.buildingId);
      if (bd) {
        const cx = (bd.tx + bd.size / 2) * T, cy = (bd.ty + bd.size / 2) * T;
        const f = s.rt.enemyHash.nearest(cx, cy, (bd.size / 2 + 4) * T, (o) => !o.stationary && canFight(e, st, o));
        if (f) { e.targetId = f.id; return; }
        if (distToRect(e.x, e.y, bd) > 1.6 * T) {
          const a = accessTile(s, bd, e.x, e.y);
          if (a) { e.gx = ctr(a.tx); e.gy = ctr(a.ty); }
        }
        return;
      }
    }
  }
  e.bountyId = 0;
  // 4. Fight what comes close (sticky: keep a foe we are already fighting).
  const cur = getE(s, e.lastFoe);
  if (cur && canFight(e, st, cur) && Math.hypot(cur.x - e.x, cur.y - e.y) < (R.aggro + 2) * T) { e.targetId = cur.id; e.gk = 'fight'; return; }
  const f = pickFoe(s, e, st, R.aggro + ((TRAITS[e.trait] || {}).glory ? 1 : 0));
  if (f) { e.targetId = f.id; e.gk = 'fight'; return; }
  // 5. Night: defend the settlement.
  if (night) {
    const g = nightFoe(s, e, st);
    if (g) { e.targetId = g.id; e.gk = 'guard'; return; }
  }
  // 6. Rest or wander.
  idleGoal(s, e, night, order);
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
      const far = (5 + 2 * st.power) * T;
      let ang;
      const dx = e.gx - e.x, dy = e.gy - e.y;
      if (Math.hypot(dx, dy) > 2 * T) ang = Math.atan2(dy, dx);
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
export function updateHeroes(s, dt) {
  if (!s.heroes.length) {
    if (s.ext.heroes) { if (s.ext.heroes.splash && s.ext.heroes.splash.length) s.ext.heroes.splash.length = 0; if (s.tick % 10 === 0) updateBounties(s); }
    return;
  }
  heroExt(s);
  runSplashes(s);
  const h = s.rt.hearth;
  let order = 0;
  for (const e of s.heroes) {
    if (!e.alive || e.away) continue;
    const st = heroStats(s, e);
    if (e.maxHp !== st.hp) refreshStats(s, e);
    e.hitT = Math.max(0, e.hitT - dt); e.atkT = Math.max(0, e.atkT - dt); e.cd -= dt;
    e.castT = Math.max(0, e.castT - dt); e.hawkT = Math.max(0, e.hawkT - dt);
    e.rallyCd = Math.max(0, e.rallyCd - dt);
    if (e.rallyT > 0) { e.rallyT -= dt; if (e.rallyT <= 0) { e.rallyT = 0; e.think = 0; } }
    if (e.hp < e.hpPrev - 0.01) e.lastHurt = s.time;
    // Regeneration: always a little, a lot at the Hearth.
    let reg = st.regen + (s.time - e.lastHurt > 5 ? R.regenIdle : 0);
    if (h && distToRect(e.x, e.y, h) < R.hearthRange * T) reg += R.regenHearth;
    if (e.quirk === 'lovesTaverns' && nearTavern(s, e)) reg *= 3;
    if (reg > 0 && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + reg * dt);
    e.hpPrev = e.hp;
    // Retreat thresholds by trait.
    const tr = TRAITS[e.trait] || TRAITS.brave;
    if (!e.retreat && e.rallyT <= 0 && e.hp < e.maxHp * tr.retreat && h) {
      e.retreat = true; e.think = 0; e.bountyId = 0;
      emit(s, { t: 'toast', text: `${e.name} is wounded and falls back to the Hearth.`, tone: 'bad', icon: 'shield' });
    }
    if (e.retreat && e.hp >= e.maxHp * 0.8) { e.retreat = false; e.think = 0; }

    e.think -= dt;
    if (e.think <= 0) { e.think = R.thinkEvery; think(s, e, st, order); }
    order++;

    // Act on the goal.
    let t = getE(s, e.targetId);
    if (t && t.kind === 'hero') t = null;
    if (t) {
      e.lastFoe = t.id;
      const cd0 = e.cd;
      engage(s, e, t, st, dt, 1);
      if (cd0 <= 0 && e.cd > 0) onAttack(s, e, st, t);
    } else {
      e.targetId = 0;
      // Step out of an avoid zone unless an order or a bounty leads in.
      const az = e.gk !== 'rally' && e.gk !== 'bounty' ? inAvoid(s, e.x, e.y) : null;
      if (az) {
        const dx = e.x - az.x, dy = e.y - az.y, l = Math.hypot(dx, dy) || 1;
        e.gx = az.x + (dx / l) * (R.avoidRadius + 1) * T; e.gy = az.y + (dy / l) * (R.avoidRadius + 1) * T;
      }
      moveTo(s, e, e.gx, e.gy, st.speed, dt);
      // Explore bounties pay on arrival (or as close as the land allows).
      if (e.gk === 'bounty' && e.bountyId) {
        const b = bountyById(s, e.bountyId);
        const d = b ? Math.hypot(b.x - e.x, b.y - e.y) : 0;
        if (b && b.kind === 'explore' && (d < T * 1.5 || (e.stuck > 2 && d < T * 3.5))) {
          revealAround(s, b.x, b.y, R.exploreReveal);
          payBounty(s, b, e);
        }
      }
    }
    // A bounty this hero cannot reach is set aside for a while.
    if (e.gk === 'bounty' && e.bountyId && e.stuck > 3) {
      e.skipB = e.bountyId; e.skipT = s.time + 30;
      e.bountyId = 0; e.stuck = 0; e.path = null; e.think = 0; e.targetId = 0;
    }
    abilities(s, e, st, t && t.alive ? t : null, dt);
    separate(s, e, s.rt.friendHash, SEPARATION, 'friend');
  }
  if (s.tick % 10 === 0) updateBounties(s);
}

function nearTavern(s, e) {
  for (const b of s.buildings) if (b.type === 'tavern' && b.built && distToRect(e.x, e.y, b) < 3 * T) return true;
  return false;
}

// ---- Damage modifiers (hot path) --------------------------------------------------------------
function dmgMult(s, a, t, type) {
  const H = s.heroes;
  if (!H.length) return 1;
  let m = 1;
  if (a && a.kind === 'hero') {
    const night = s.cycle.phase === 'night' || s.cycle.phase === 'dusk';
    if (a.quirk === 'nightOwl' && night) m *= 1.1;
    else if (a.quirk === 'earlyRiser' && !night) m *= 1.1;
    else if (a.quirk === 'haunted') m *= 1.05;
    if (t.kind === 'enemy') {
      if (a.cls === 'rogue' && ((t.targetId && t.targetId !== a.id) || t.siege)) m *= 2 * (1 + heroStats(s, a).power);
      if (a.cls === 'pyromancer' && type === 'fire' && !s.rt.heroSplashing) {
        const X = heroExt(s);
        const q = X.splash || (X.splash = []);
        if (q.length < 32) q.push({ x: t.x, y: t.y, tid: t.id, src: a.id });
      }
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

// ---- Commands ---------------------------------------------------------------------------------
function cmdPlaceBounty(s, c) {
  const X = heroExt(s);
  if (!BOUNTY_KINDS.includes(c.kind)) return { ok: false };
  if (!livingHeroes(s)) return { ok: false, msg: 'No hero to claim it. Hire one at a Tavern.' };
  if (X.bounties.length >= R.maxBounties) return { ok: false, msg: `At most ${R.maxBounties} bounty flags at once.` };
  const gold = c.kind === 'avoid' ? 0 : Math.round(c.gold || 0);
  if (c.kind !== 'avoid' && !(gold > 0 && gold <= 500)) return { ok: false };
  if (s.res.gold < gold) return { ok: false, msg: 'Not enough gold for that bounty.' };
  const b = { id: X.bseq++, kind: c.kind, x: 0, y: 0, targetId: 0, buildingId: 0, gold, until: 0, claimedBy: 0, placed: s.time };
  if (c.kind === 'attack') {
    const t = getE(s, c.targetId);
    if (!t || t.kind === 'hero' || t.kind === 'villager' || t.kind === 'soldier' || t.kind === 'sovereign') return { ok: false, msg: 'Mark a foe or a lair.' };
    if (X.bounties.some((o) => o.kind === 'attack' && o.targetId === t.id)) return { ok: false, msg: 'That foe already has a price on its head.' };
    b.targetId = t.id; b.x = t.x; b.y = t.y;
  } else if (c.kind === 'defend') {
    const bd = getB(s, c.buildingId);
    if (!bd) return { ok: false, msg: 'Mark one of your buildings.' };
    if (X.bounties.some((o) => o.kind === 'defend' && o.buildingId === bd.id)) return { ok: false, msg: 'That building is already guarded.' };
    b.buildingId = bd.id; b.x = (bd.tx + bd.size / 2) * T; b.y = (bd.ty + bd.size / 2) * T; b.until = s.time + R.defendTime;
  } else {
    if (typeof c.x !== 'number' || typeof c.y !== 'number' || !isFinite(c.x) || !isFinite(c.y)) return { ok: false };
    b.x = clamp(c.x, 8, WORLD - 8); b.y = clamp(c.y, 8, WORLD - 8);
  }
  s.res.gold -= gold;
  X.bounties.push(b);
  for (const e of s.heroes) e.think = Math.min(e.think, 0.15 + (e.id % 4) * 0.05);
  emit(s, { t: 'sfx', k: gold ? 'coin' : 'ok', x: b.x, y: b.y });
  emit(s, { t: 'bountyPlaced', x: b.x, y: b.y, kind: b.kind, gold });
  return { ok: true, id: b.id };
}

function cmdCancelBounty(s, c) {
  const b = bountyById(s, c.id);
  if (!b) return { ok: false };
  refundBounty(s, b, null);
  emit(s, { t: 'sfx', k: 'coin', x: b.x, y: b.y });
  return { ok: true };
}

function cmdRecruit(s, c) {
  const X = heroExt(s);
  let b = c.id ? getB(s, c.id) : null;
  if (!b) b = s.buildings.find((x) => x.type === 'tavern' && x.built && x.alive) || null;
  if (!b || b.type !== 'tavern' || !b.built) return { ok: false, msg: 'You need a Tavern.' };
  const slot = X.tavern[b.id];
  const cand = slot && slot.list[c.i];
  if (!cand || cand.hired) return { ok: false };
  if (livingHeroes(s) >= R.maxHeroes) return { ok: false, msg: `At most ${R.maxHeroes} heroes serve the realm at once.` };
  if (s.res.gold < cand.price) return { ok: false, msg: 'Not enough gold.' };
  s.res.gold -= cand.price;
  cand.hired = true;
  const a = accessTile(s, b, (b.tx + b.size / 2) * T, (b.ty + b.size + 1) * T);
  const x = a ? ctr(a.tx) : (b.tx + 1) * T, y = a ? ctr(a.ty) : (b.ty + b.size) * T + 8;
  const e = spawnHero(s, { id: `h${s.act || 1}.${s.step || 0}.${X.seq++}`, name: cand.name, cls: cand.cls, trait: cand.trait, quirk: cand.quirk, level: 1, xp: 0, perks: [] }, x, y);
  emit(s, { t: 'sfx', k: 'coin', x, y });
  emit(s, { t: 'heroHired', x, y, hero: e.id });
  emit(s, { t: 'toast', text: `${e.name} the ${HERO_CLASSES[e.cls].name} joins your realm.`, tone: 'good', icon: 'crown' });
  return { ok: true, id: e.id };
}

function cmdRally(s, c) {
  const e = getE(s, c.id);
  if (!e || e.kind !== 'hero') return { ok: false };
  if (e.rallyCd > 0) return { ok: false, msg: `${e.name} will heed another Rally in ${Math.ceil(e.rallyCd)} s.` };
  const t = c.target ? getE(s, c.target) : null;
  if (t && t.kind === 'enemy') { e.rallyTarget = t.id; e.rallyX = t.x; e.rallyY = t.y; }
  else {
    if (typeof c.x !== 'number' || typeof c.y !== 'number' || !isFinite(c.x) || !isFinite(c.y)) return { ok: false };
    e.rallyTarget = 0; e.rallyX = clamp(c.x, 8, WORLD - 8); e.rallyY = clamp(c.y, 8, WORLD - 8);
  }
  e.rallyT = R.rallyTime; e.rallyCd = R.rallyCd;
  e.retreat = false; e.path = null; e.think = 0; e.bountyId = 0;
  emit(s, { t: 'sfx', k: 'horn', x: e.x, y: e.y });
  return { ok: true };
}

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

// ---- Life-cycle hooks --------------------------------------------------------------------------
function onKill(s, v, killer) {
  if (!s.ext.heroes && v.kind !== 'hero') return;
  if (v.kind === 'hero') {
    const X = heroExt(s);
    X.fallen.push({ ...toRoster(v), hp: 0, alive: false, act: s.act || 1, step: s.step || 0, night: s.cycle.night });
    for (const b of X.bounties) if (b.claimedBy === v.id) b.claimedBy = 0;
    if (s.rt.heroSt) s.rt.heroSt.delete(v.id);
    return;
  }
  if (v.kind !== 'enemy' && !(v.guard || v.lair)) return;
  // Attack bounties.
  const X = s.ext.heroes;
  for (let i = X.bounties.length - 1; i >= 0; i--) {
    const b = X.bounties[i];
    if (b.kind !== 'attack' || b.targetId !== v.id) continue;
    if (killer && killer.kind === 'hero' && killer.alive) payBounty(s, b, killer);
    else refundBounty(s, b, 'Someone else slew the marked foe.');
  }
  if (!s.heroes.length) return;
  // Experience: the killer earns it all, heroes nearby share some.
  let base = KILL_XP[v.type] || 6;
  if (v.affix === 'warden') base *= 3;
  const r2 = (R.shareRadius * T) * (R.shareRadius * T);
  for (const e of s.heroes) {
    if (!e.alive) continue;
    if (killer === e) {
      e.kills++;
      gainXp(s, e, base);
      if (e.quirk === 'hums') moodAdd(s, 0.4, 0);
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
    if (!h.alive) continue;
    const p = hearthFront(s, i++);
    const st = computeStats(h.cls, h.level || 1, h.perks || [], h.quirk);
    const hp = h.hp == null ? st.hp : Math.min(st.hp, h.hp + st.hp * R.carryHeal);
    spawnHero(s, { ...h, hp }, p.x, p.y + 12);
  }
}

function onRunNew(run) {
  run.ext.heroes = [makeStarter(run)];
  run.ext.fallen = [];
}

function onRunRegion(run) {
  if (!run.ext) run.ext = {};
  if (!run.ext.heroes) { run.ext.heroes = [makeStarter(run)]; run.ext.fallen = run.ext.fallen || []; }
}

function onRunRegionEnd(run, s, summary) {
  const X = s.ext && s.ext.heroes;
  if (!run.ext) run.ext = {};
  // A region saved before heroes existed (Phase 2) never ran regionInit: keep the roster it was given.
  if (!X && !(s.heroes && s.heroes.length)) {
    if (!run.ext.heroes) run.ext.heroes = [makeStarter(run)];
    run.ext.fallen = run.ext.fallen || [];
    return;
  }
  run.ext.heroes = (s.heroes || []).filter((e) => e.alive && e.kind === 'hero').map(toRoster);
  run.ext.fallen = run.ext.fallen || [];
  if (X) {
    for (const f of X.fallen) run.ext.fallen.push(f);
    // Escrowed bounty gold comes home with the Sovereign.
    let back = 0;
    for (const b of X.bounties) back += b.gold || 0;
    if (back) run.gold += back;
    if (summary) { summary.heroesLost = X.fallen.map((f) => f.name); summary.bountyRefund = back; }
  }
}

function onBuilt(s, b) {
  s.rt.heroGuardDirty = true;
  if (b.type === 'tavern') rollTavern(s, b);
}
function onRemoved(s, b) {
  s.rt.heroGuardDirty = true;
  const X = s.ext.heroes;
  if (!X) return;
  if (X.tavern[b.id]) delete X.tavern[b.id];
}
function onPhase(s, phase) {
  if (phase === 'day') {
    for (const b of s.buildings) if (b.type === 'tavern' && b.built && b.alive) rollTavern(s, b);
  } else if (phase === 'night') {
    for (const e of s.heroes) if (e.alive && e.quirk === 'haunted') moodAdd(s, 0, 1, '');
  }
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  Object.assign(BUILDINGS, TAVERN_BUILDING);
  const list = BUILD_ORDER.military || (BUILD_ORDER.military = []);
  if (!list.includes('tavern')) list.push('tavern');
  BUS.regionInit.push(onRegionInit);
  BUS.tick.push(updateHeroes);
  BUS.phase.push(onPhase);
  BUS.built.push(onBuilt);
  BUS.removed.push(onRemoved);
  BUS.kill.push(onKill);
  BUS.dmgMult.push(dmgMult);
  BUS.runNew.push(onRunNew);
  BUS.runRegion.push(onRunRegion);
  BUS.runRegionEnd.push(onRunRegionEnd);
  Object.assign(BUS.commands, { placeBounty: cmdPlaceBounty, cancelBounty: cmdCancelBounty, recruitHero: cmdRecruit, heroRally: cmdRally });
  BUS.choose.perk = choosePerk;
}
