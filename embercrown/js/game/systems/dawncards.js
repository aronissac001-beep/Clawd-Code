// Dawn Cards and the Beacon reward (rework, stream H2). Implements the §3.0 contract:
//   HOOKS.dawnCard(s)     -> the dawn's single pending choice { kind: 'dawnCard', options }
//   HOOKS.beaconReward(s) -> the region-end pick at the dawn the Beacon becomes ready
//                            { kind: 'beaconPick', options }
// js/game/systems/cycle.js calls both from toDawn(); this module answers them through
// BUS.choose and runs every upgrade effect through BUS only (deterministic, plain JSON).
//
// Region state, s.ext.dawn = {
//   up:     { upgradeId: rank }   run-long upgrades (copied from run.ext.dawn at regionInit)
//   q:      [ queued hits ]       chain / cleave / burst hits resolved on the next tick (saved,
//                                 so a save between two ticks resumes identically)
//   fire:   [ { x, y, r, until, dps } ]  burning ground left by a Pyre Nova
//   nv:     last seen Nova cooldown (a jump means the Sovereign just cast it)
//   rb:     the run's Beacon bonuses (so a non-stackable one is not offered twice)
//   beacon: null | the reward picked at the region's end (folded into the run by run.js)
//   picks:  dawn cards taken in this region
// }
// Enemy movers: e.burnT / e.burnD (seconds and damage a second of an Ember Blade burn).
// Run state, run.ext.dawn = { up: { upgradeId: rank } }.
import { BUS, HOOKS, first, isLocked } from '../hooks.js';
import { BUILDINGS } from '../../data/buildings.js';
import { ENEMIES } from '../../data/enemies.js';
import { RELICS, relicPool } from '../../data/relics.js';
import { BEACONS } from '../../data/beacons.js';
import { UPGRADES, UPGRADE_LIST, SUPPLIES, CARD_WEIGHTS, BEACON_PICK } from '../../data/cards.js';
import { T, N, idx, tileOf } from '../grid.js';
import { emit, rng, hurt, getE } from './common.js';
import { baseDepth } from './waves.js';
import { heroCards, heroCardText, heroCardHasEffect, takeHeroCard, livingHeroes, recruitHero } from './heroes.js';

// ---- State ------------------------------------------------------------------------------------
export function dawnX(s) {
  const X = s.ext.dawn || (s.ext.dawn = {});
  if (!X.up || typeof X.up !== 'object') X.up = {};
  if (!Array.isArray(X.q)) X.q = [];
  if (!Array.isArray(X.fire)) X.fire = [];
  if (typeof X.nv !== 'number') X.nv = 0;
  if (!Array.isArray(X.rb)) X.rb = [];
  if (X.beacon === undefined) X.beacon = null;
  if (typeof X.picks !== 'number') X.picks = 0;
  return X;
}
export function rankOf(s, id) { const X = s.ext && s.ext.dawn; return (X && X.up && X.up[id]) || 0; }

// ---- What a card would do now -----------------------------------------------------------------
/** Is this building type still to learn, and offerable to this realm? */
export function bpPool(s) {
  const known = s.blueprints || [];
  if (!known.length) return []; // a realm that knows every building (Sandbox, a lone region)
  return Object.keys(BUILDINGS).filter((t) => {
    const d = BUILDINGS[t];
    return d.cat && !known.includes(t) && (!d.faction || d.faction === s.faction) && !d.wonder && !isLocked(s, 'buildings', t)
      && !(BUS.draftVeto.length && first(BUS.draftVeto, s, t));
  });
}
function knows(s, type) { return !s.blueprints || !s.blueprints.length || s.blueprints.includes(type) || s.buildings.some((b) => b.alive && b.type === type); }
function sovAlive(s) { return !!(s.sovereign && s.sovereign.alive); }
function damagedBuildings(s) { return s.buildings.filter((b) => b.alive && b.built && b.hp < b.maxHp - 1); }

export function upgradeHasEffect(s, u) {
  if (!u || rankOf(s, u.id) >= u.max) return false;
  const n = u.needs || {};
  if (n.bp && !knows(s, n.bp)) return false;
  if (n.barracks && !knows(s, 'barracks')) return false;
  if (n.sov && !sovAlive(s)) return false;
  return true;
}

function supplyHasEffect(s, c) {
  if (c.needs === 'damaged') return damagedBuildings(s).length > 0;
  if (c.needs === 'sovHurt') return sovAlive(s) && s.sovereign.hp < s.sovereign.maxHp - 1;
  return true;
}

/** Would this card change anything if taken now? Never offer one that would not. */
export function hasEffect(s, card) {
  if (!card) return false;
  switch (card.k) {
    case 'bp': return bpPool(s).includes(card.type);
    case 'up': return upgradeHasEffect(s, UPGRADES[card.id]);
    case 'hero': return heroCardHasEffect(s, card.card);
    case 'sup': return !!SUPPLIES[card.id] && supplyHasEffect(s, SUPPLIES[card.id]);
    default: return false;
  }
}

const REPAIR_POOL = 300; // health a Masons' Vigil spreads over damaged buildings, Hearth first
function supplyRes(s, c) { return c.res ? c.res(baseDepth(s)) : null; }

/** Player text for a card: { kind, title, text, icon }. */
export function cardText(s, card) {
  switch (card.k) {
    case 'bp': {
      const d = BUILDINGS[card.type] || { name: card.type, desc: '' };
      return { kind: 'Blueprint', title: d.name, text: d.desc || 'Learn a new building for the rest of the run.', icon: iconFor(card.type) };
    }
    case 'up': {
      const u = UPGRADES[card.id];
      const r = rankOf(s, card.id) + 1;
      return { kind: u.max > 1 ? `Upgrade ${r}/${u.max}` : 'Upgrade', title: u.name, text: u.text(r), icon: u.icon };
    }
    case 'hero': { const t = heroCardText(s, card.card); return { kind: 'Hero', title: t.title, text: t.text, icon: t.icon }; }
    case 'sup': {
      const c = SUPPLIES[card.id];
      const res = supplyRes(s, c);
      let text = '';
      if (res) text = Object.entries(res).map(([k, v]) => `+${v} ${k}`).join(', ') + '.';
      else if (c.needs === 'damaged') text = `Repair ${REPAIR_POOL} health across damaged buildings, the Hearth first.`;
      else if (c.needs === 'sovHurt') text = 'The Sovereign regains half of its health.';
      return { kind: 'Supplies', title: c.name, text, icon: c.icon };
    }
    default: return { kind: '', title: '?', text: '', icon: 'info' };
  }
}
const BUILD_ICONS = ['house', 'farm', 'lumber', 'quarry', 'wall', 'gate', 'tower', 'brazier', 'barracks'];
function iconFor(type) { return BUILD_ICONS.includes(type) ? type : 'book'; }

// ---- The dawn's card choice ---------------------------------------------------------------------
/** Every card the realm could be offered right now, by kind (all pass hasEffect). */
export function candidates(s) {
  const out = { upgrade: [], blueprint: [], hero: [], supplies: [] };
  for (const u of UPGRADE_LIST) if (upgradeHasEffect(s, u)) out.upgrade.push({ k: 'up', id: u.id });
  for (const t of bpPool(s)) out.blueprint.push({ k: 'bp', type: t });
  for (const c of heroCards(s, 2)) if (heroCardHasEffect(s, c)) out.hero.push({ k: 'hero', card: c });
  for (const c of Object.values(SUPPLIES)) if (supplyHasEffect(s, c)) out.supplies.push({ k: 'sup', id: c.id });
  return out;
}

export function makeDawnCards(s) {
  if (s.outcome) return null;
  const r = rng(s);
  const pool = candidates(s);
  const n = Math.min(4, 3 + Math.max(0, s.mods.draftExtra || 0));
  const picks = [];
  // A hero who has earned a perk always gets a card for it (one of the perk's options).
  const perk = pool.hero.filter((c) => c.card.act === 'perk');
  if (perk.length) { picks.push(perk[r.int(0, perk.length - 1)]); pool.hero = []; }
  const W = CARD_WEIGHTS;
  const heroW = livingHeroes(s) === 0 ? W.heroFirst : W.hero;
  while (picks.length < n) {
    const kinds = [];
    if (pool.upgrade.length) kinds.push(['upgrade', W.upgrade]);
    if (pool.blueprint.length) kinds.push(['blueprint', W.blueprint]);
    if (pool.hero.length) kinds.push(['hero', heroW]);
    if (pool.supplies.length) kinds.push(['supplies', W.supplies]);
    if (!kinds.length) break;
    const [k] = r.weighted(kinds, (x) => x[1]);
    const list = pool[k];
    picks.push(list.splice(r.int(0, list.length - 1), 1)[0]);
    // At most one hero card (recruits are one decision) and one supplies card a dawn.
    if (k === 'hero' || k === 'supplies') pool[k] = [];
  }
  if (!picks.length) return null;
  return { kind: 'dawnCard', options: picks };
}

function takeCard(s, card) {
  const X = dawnX(s);
  const t = cardText(s, card);
  switch (card.k) {
    case 'bp':
      if (!s.blueprints.includes(card.type)) s.blueprints.push(card.type);
      emit(s, { t: 'blueprint', type: card.type });
      emit(s, { t: 'toast', text: `New blueprint: ${t.title}.`, tone: 'good', icon: 'book' });
      break;
    case 'up': {
      const u = UPGRADES[card.id];
      if (!u || (X.up[u.id] || 0) >= u.max) return false;
      X.up[u.id] = (X.up[u.id] || 0) + 1;
      if (u.mods) for (const k in u.mods) s.mods[k] = (s.mods[k] || 0) + u.mods[k];
      applyNow(s, u, X.up[u.id]);
      emit(s, { t: 'toast', text: `${u.name}: ${t.text}`, tone: 'good', icon: u.icon });
      break;
    }
    case 'hero': if (!takeHeroCard(s, card.card).ok) return false; break;
    case 'sup': {
      const c = SUPPLIES[card.id];
      const res = supplyRes(s, c);
      if (res) for (const k in res) { s.res[k] += res[k]; if (s.stats.produced && k in s.stats.produced) s.stats.produced[k] += res[k]; }
      else if (c.needs === 'damaged') repairPool(s, REPAIR_POOL);
      else if (c.needs === 'sovHurt' && sovAlive(s)) s.sovereign.hp = Math.min(s.sovereign.maxHp, s.sovereign.hp + s.sovereign.maxHp * 0.5);
      emit(s, { t: 'sfx', k: 'coin' });
      break;
    }
    default: return false;
  }
  X.picks++;
  return true;
}

/** One-off effects of taking an upgrade (the lasting ones run from the BUS handlers). */
function applyNow(s, u, rank) {
  if (u.id === 'vigor' && sovAlive(s)) { const v = u.v[rank - 1]; s.sovereign.maxHp += v.hp; s.sovereign.hp += v.hp; }
  if (u.id === 'stoneskin') {
    for (const b of s.buildings) {
      const d = BUILDINGS[b.type];
      if (!b.alive || !d || !d.isWall) continue;
      const k = 1 + u.mods.wallHp;
      b.maxHp = Math.round(b.maxHp * k); b.hp = Math.min(b.maxHp, b.hp * k);
    }
  }
}

function repairPool(s, amount) {
  let left = amount;
  const list = damagedBuildings(s).sort((a, b) => (a.type === 'hearth' ? -1 : 0) - (b.type === 'hearth' ? -1 : 0) || a.id - b.id);
  for (const b of list) {
    if (left <= 0) break;
    const add = Math.min(left, b.maxHp - b.hp);
    b.hp += add; left -= add;
  }
}

function chooseDawnCard(s, i) {
  const p = s.pending;
  const card = p.options[i];
  if (!card) return { ok: false };
  if (!takeCard(s, card)) return { ok: false, msg: 'That card can no longer be taken.' };
  s.pending = null;
  return { ok: true };
}

// ---- The Beacon reward ---------------------------------------------------------------------------
/**
 * Options for a Beacon reward: 3 of relics and lasting bonuses, at least one of each when both
 * are left. holder: { relics: [{id}], beacons: [ids], locked }, nodeType: the region's type.
 * Option shape: { k: 'relic', id } | { k: 'bonus', id }.
 */
export function rewardOptions(holder, nodeType, r) {
  const owned = new Set((holder.relics || []).map((x) => x.id));
  const kind = nodeType === 'cursed' || nodeType === 'boss' ? nodeType : 'region';
  const rar = BEACON_PICK.relicRarity[kind];
  const relics = [];
  const pickRelic = () => {
    const want = r.chance(BEACON_PICK.legendaryChance[kind]) ? 'legendary' : rar[r.int(0, rar.length - 1)];
    for (const tier of [want, ...rar, 'rare', 'common', 'legendary']) {
      const pool = relicPool(tier).filter((id) => !owned.has(id) && !relics.includes(id) && !isLocked(holder, 'relics', id));
      if (pool.length) return pool[r.int(0, pool.length - 1)];
    }
    return null;
  };
  const taken = new Set(holder.beacons || []);
  const bonus = Object.values(BEACONS).filter((b) => b.stackable || !taken.has(b.id)).map((b) => b.id);
  r.shuffle(bonus);
  const out = [];
  const addRelic = () => { const id = pickRelic(); if (id) { relics.push(id); out.push({ k: 'relic', id }); return true; } return false; };
  const addBonus = () => { const id = bonus.shift(); if (id) { out.push({ k: 'bonus', id }); return true; } return false; };
  addRelic(); addBonus();
  while (out.length < BEACON_PICK.options) { if (!(r.chance(0.5) ? addRelic() || addBonus() : addBonus() || addRelic())) break; }
  return out;
}

export function rewardText(opt) {
  if (opt.k === 'relic') { const R = RELICS[opt.id] || { name: opt.id, text: '', icon: 'relic', rarity: 'common' }; return { kind: `Relic · ${R.rarity}`, title: R.name, text: R.text, icon: R.icon || 'relic' }; }
  const B = BEACONS[opt.id] || { name: opt.id, text: '', icon: 'beacon' };
  return { kind: 'Lasting bonus', title: B.name, text: B.text, icon: B.icon || 'beacon' };
}

function makeBeaconPick(s) {
  if (s.outcome) return null;
  const X = dawnX(s);
  if (X.beacon) return null;
  const options = rewardOptions({ relics: s.relics, beacons: X.rb, locked: s.locked }, s.nodeType, rng(s));
  return options.length ? { kind: 'beaconPick', options } : null;
}

function chooseBeacon(s, i) {
  const o = s.pending.options[i];
  if (!o) return { ok: false };
  const X = dawnX(s);
  X.beacon = { k: o.k, id: o.id };
  const t = rewardText(o);
  emit(s, { t: 'toast', text: `${t.title} will travel with you from this region.`, tone: 'good', icon: t.icon });
  emit(s, { t: 'sfx', k: 'coin' });
  s.pending = null;
  return { ok: true };
}

// ---- Upgrade effects -------------------------------------------------------------------------------
const NOVA_JUMP = 3; // a cooldown rising by more than this between ticks is a fresh cast

function dmgMult(s, a, t, type) {
  const X = s.ext.dawn;
  if (!X) return 1;
  const up = X.up;
  let m = 1;
  if (t.kind === 'enemy') {
    if (!a) {
      // Building arrows: Watchtowers and Ballistae carry no shooter id.
      if (type === 'pierce' && up.chain && X.q.length < 40) { const v = UPGRADES.chain.v[up.chain - 1]; X.q.push({ k: 'chain', tid: t.id, x: Math.round(t.x), y: Math.round(t.y), d: v.dmg, r: v.range }); }
      if (type === 'pierce' && up.pinning && !t.boss && !t.stationary) { const v = UPGRADES.pinning.v[0]; slow(t, v.slow, v.secs); }
      return m;
    }
    if (a.kind === 'sovereign' && type !== 'fire') {
      if (up.cleave && X.q.length < 40) { const v = UPGRADES.cleave.v[up.cleave - 1]; X.q.push({ k: 'cleave', tid: t.id, x: Math.round(t.x), y: Math.round(t.y), d: v.dmg, r: v.range }); }
      if (up.firebrand && !t.stationary) { const v = UPGRADES.firebrand.v[up.firebrand - 1]; t.burnT = v.secs; t.burnD = Math.max(t.burnD || 0, v.dps); }
    }
    if (up.execute && (a.kind === 'soldier' || a.kind === 'hero' || a.kind === 'sovereign') && t.hp < t.maxHp * UPGRADES.execute.v[0].below) m *= 1 + UPGRADES.execute.v[0].mult;
    if (a.kind === 'soldier') {
      if (up.brace && a.type === 'spearman' && !a.walk) m *= 1 + UPGRADES.brace.v[up.brace - 1].mult;
      if (up.volley && (a.type === 'archer' || a.type === 'crossbow')) {
        const v = UPGRADES.volley.v[up.volley - 1], dx = t.x - a.x, dy = t.y - a.y, R = v.beyond * T;
        if (dx * dx + dy * dy > R * R) m *= 1 + v.mult;
      }
    }
    return m;
  }
  if (t.kind === 'soldier' && up.guard && s.sovereign && s.sovereign.alive) {
    const v = UPGRADES.guard.v[0], dx = t.x - s.sovereign.x, dy = t.y - s.sovereign.y, R = v.range * T;
    if (dx * dx + dy * dy <= R * R) m *= 1 - v.cut;
  }
  return m;
}

function slow(e, amt, secs) {
  e.slowAmt = e.slowT > 0 ? Math.max(e.slowAmt || 0, amt) : amt;
  e.slowT = Math.max(e.slowT || 0, secs);
}

const scratch = [];
function foesNear(s, x, y, r, skipId) {
  scratch.length = 0;
  s.rt.enemyHash.each(x, y, r, (e) => { if (e.kind === 'enemy' && e.alive && e.id !== skipId && !e.guard) scratch.push(e); return false; });
  return scratch.slice();
}

function resolveQueue(s, X) {
  const q = X.q;
  X.q = [];
  for (const h of q) {
    if (h.k === 'chain') {
      let best = null, bd = Infinity;
      for (const e of foesNear(s, h.x, h.y, h.r * T, h.tid)) { const d = (e.x - h.x) ** 2 + (e.y - h.y) ** 2; if (d < bd) { bd = d; best = e; } }
      if (best) { emit(s, { t: 'arcane', x1: h.x, y1: h.y, x2: best.x, y2: best.y }); hurt(s, best, h.d, 'chain'); }
    } else if (h.k === 'cleave' || h.k === 'burst') {
      for (const e of foesNear(s, h.x, h.y, h.r * T, h.k === 'cleave' ? h.tid : 0)) hurt(s, e, h.d, h.k === 'burst' ? 'burn' : 'cleave');
      if (h.k === 'burst') emit(s, { t: 'burn', x: h.x, y: h.y });
    }
  }
}

function tick(s, dt) {
  const X = s.ext.dawn;
  if (!X) return;
  const up = X.up;
  if (X.q.length) resolveQueue(s, X);
  // Pyre Nova: a fresh cast is a jump of the Nova cooldown.
  const sv = s.sovereign;
  if (sv && sv.alive) {
    const cd = sv.novaCd || 0;
    if (up.pyre && cd > X.nv + NOVA_JUMP) { const v = UPGRADES.pyre.v[up.pyre - 1]; X.fire.push({ x: Math.round(sv.x), y: Math.round(sv.y), r: v.radius, dps: v.dps, until: Math.round((s.time + v.secs) * 100) / 100 }); }
    X.nv = cd;
  }
  if (s.tick % 10 !== 0) return; // twice a second
  const step = 0.5;
  if (X.fire.length) {
    X.fire = X.fire.filter((f) => f.until > s.time);
    for (const f of X.fire) {
      for (const e of foesNear(s, f.x, f.y, f.r * T, 0)) if (!e.stationary || e.type === 'rift') hurt(s, e, f.dps * step, 'burn');
      emit(s, { t: 'burn', x: f.x, y: f.y });
    }
  }
  const snare = up.snare ? UPGRADES.snare.v[up.snare - 1].slow : 0;
  for (const e of s.enemies) {
    if (!e.alive) continue;
    if (e.burnT > 0) {
      e.burnT = Math.max(0, e.burnT - step);
      hurt(s, e, (e.burnD || 0) * step, 'burn');
      if (!(e.burnT > 0)) e.burnD = 0;
      if (!e.alive) continue;
    }
    if (snare && !e.boss && !e.stationary && !e.flying) {
      const tx = tileOf(e.x), ty = tileOf(e.y);
      if (tx >= 0 && ty >= 0 && tx < N && ty < N && s.lit[idx(tx, ty)]) slow(e, snare, 0.6);
    }
  }
}

function onKill(s, v, killer) {
  const X = s.ext.dawn;
  if (v.kind === 'sovereign' && !s.outcome) s.outcome = { result: 'defeat', reason: sovCause(s, v, killer) };
  if (!X || v.kind !== 'enemy' || v.stationary) return;
  const up = X.up;
  if (up.tithe) s.res.gold += UPGRADES.tithe.v[up.tithe - 1].gold;
  if (up.kindling && X.q.length < 40) {
    const tx = tileOf(v.x), ty = tileOf(v.y);
    if (tx >= 0 && ty >= 0 && tx < N && ty < N && s.lit[idx(tx, ty)]) { const k = UPGRADES.kindling.v[0]; X.q.push({ k: 'burst', tid: v.id, x: Math.round(v.x), y: Math.round(v.y), d: k.dmg, r: k.radius }); }
  }
}

function onPhase(s, phase) {
  const X = s.ext.dawn;
  if (!X || phase !== 'dawn') return;
  X.fire = []; X.q = [];
  for (const e of s.enemies) if (e.burnT) { e.burnT = 0; e.burnD = 0; }
  if (X.up.dawnrest && sovAlive(s)) s.sovereign.hp = Math.min(s.sovereign.maxHp, s.sovereign.hp + s.sovereign.maxHp * UPGRADES.dawnrest.v[0].heal);
  if (X.up.surgeons) for (const u of s.soldiers) if (u.alive) u.hp = u.maxHp;
}

// ---- Loss causes (one line on the region-end screen) ----------------------------------------------
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
function compass(dx, dy) { const a = Math.atan2(dy, dx); return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]; }
function plural(name) { return /(s|sh|ch|x)$/.test(name) ? name + 'es' : name + 's'; }
function foeName(e) { const d = ENEMIES[e.type]; return d ? d.name : 'Hollow'; }

function hearthCause(s, h) {
  const cx = (h.tx + h.size / 2) * T, cy = (h.ty + h.size / 2) * T, R = 5 * T;
  const count = {};
  let sx = 0, sy = 0, n = 0, warden = false;
  for (const e of s.enemies) {
    if (!e.alive || e.kind !== 'enemy' || e.stationary) continue;
    const dx = e.x - cx, dy = e.y - cy;
    if (dx * dx + dy * dy > R * R) continue;
    const w = e.affix === 'warden' ? 3 : 1;
    if (e.affix === 'warden') warden = true;
    count[e.type] = (count[e.type] || 0) + w;
    sx += dx; sy += dy; n++;
  }
  if (!n) return s.boss && s.boss.state && s.boss.state !== 'slain' && s.boss.state !== 'dormant' ? `The Hearth fell to ${(ENEMIES[s.bossType] && ENEMIES[s.bossType].name) || 'the boss'}.` : 'The Hearth has fallen. The Heartflame gutters out.';
  const top = Object.keys(count).sort((a, b) => count[b] - count[a] || (a < b ? -1 : 1))[0];
  const who = plural((ENEMIES[top] && ENEMIES[top].name) || 'Hollow');
  const dist = Math.hypot(sx / n, sy / n);
  const from = dist > T ? ` from the ${compass(sx / n, sy / n)}` : '';
  return `The Hearth fell to ${warden ? 'a Warden and its ' : ''}${who}${from}.`;
}

function sovCause(s, v, killer) {
  const h = s.rt.hearth;
  const where = h ? (() => { const dx = v.x - (h.tx + h.size / 2) * T, dy = v.y - (h.ty + h.size / 2) * T; return Math.hypot(dx, dy) > 3 * T ? ` ${Math.round(Math.hypot(dx, dy) / T)} tiles ${compass(dx, dy)} of the Hearth` : ' at the Hearth'; })() : '';
  const who = killer && killer.kind === 'enemy' ? `${killer.affix === 'warden' ? 'a Warden ' : 'a '}${killer.affix === 'warden' ? foeName(killer) : foeName(killer)}` : 'the Hollow';
  return `The Ember-Sovereign fell to ${who}${where}, and with no heir the realm scatters.`;
}

function onRemoved(s, b, destroyed) {
  if (b.type === 'hearth' && destroyed && !s.outcome) s.outcome = { result: 'defeat', reason: hearthCause(s, b) };
}

// ---- Run plumbing ------------------------------------------------------------------------------------
function onRegionInit(s, ctx) {
  const X = dawnX(s);
  const run = ctx && ctx.run;
  const R = run && run.ext && run.ext.dawn;
  if (R && R.up) for (const id of Object.keys(R.up)) { if (UPGRADES[id]) X.up[id] = Math.min(UPGRADES[id].max, R.up[id] | 0); }
  if (run && Array.isArray(run.beacons)) X.rb = run.beacons.slice();
  // Run-long upgrades: their modifiers join the region's (one-off effects such as Royal Vigor
  // already live in the run's Sovereign health).
  for (const id of Object.keys(X.up)) {
    const u = UPGRADES[id];
    if (u && u.mods) for (const k in u.mods) s.mods[k] = (s.mods[k] || 0) + u.mods[k] * X.up[id];
  }
  X.nv = s.sovereign ? s.sovereign.novaCd || 0 : 0;
  // A hero promised by a Mystery event joins now (the run's roster has already been placed).
  if (ctx && ctx.extra && ctx.extra.recruit && !X.rec) { X.rec = 1; recruitHero(s, null); }
}

function runExt(run) {
  if (!run.ext) run.ext = {};
  const D = run.ext.dawn || (run.ext.dawn = {});
  if (!D.up || typeof D.up !== 'object') D.up = {};
  return D;
}

function onRunRegionEnd(run, s) {
  const X = s.ext && s.ext.dawn;
  if (!X) return;
  runExt(run).up = { ...X.up };
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  HOOKS.dawnCard = makeDawnCards;
  HOOKS.beaconReward = makeBeaconPick;
  BUS.choose.dawnCard = chooseDawnCard;
  BUS.choose.beaconPick = chooseBeacon;
  BUS.regionInit.push(onRegionInit);
  BUS.dmgMult.push(dmgMult);
  BUS.tick.push(tick);
  BUS.kill.push(onKill);
  BUS.phase.push(onPhase);
  BUS.removed.push(onRemoved);
  BUS.runNew.push((run) => { runExt(run); });
  BUS.runRegion.push((run) => { runExt(run); });
  BUS.runLoad.push((run) => { runExt(run); });
  BUS.runRegionEnd.push(onRunRegionEnd);
}
