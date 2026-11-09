// Shared simulation helpers: ids, resources, spawning, building lifecycle and
// damage. Systems import these instead of touching each other directly.
import { BAL, MATCHUPS } from '../../data/balance.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { UNITS } from '../../data/units.js';
import { ENEMIES, AFFIXES } from '../../data/enemies.js';
import { T, N, idx, tileOf, ctr, inB } from '../grid.js';
import { HOOKS, BUS, each, product } from '../hooks.js';

export const RES_KEYS = ['food', 'wood', 'stone', 'gold'];

export function emit(s, ev) { if (s.rt.fx.length < 600) s.rt.fx.push(ev); }
export function newId(s) { return s.nextId++; }
export function rng(s) { return s.rt.rng; }
export function markFlowDirty(s) { s.rt.flowDirty = true; }
export function markLightDirty(s) { s.rt.lightDirty = true; s.rt.flowDirty = true; }
export function getE(s, id) { const e = id ? s.rt.eById.get(id) : null; return e && e.alive ? e : null; }
export function getB(s, id) { const b = id ? s.rt.bById.get(id) : null; return b && b.alive ? b : null; }

// ---- Resources --------------------------------------------------------------
export function canAfford(res, cost, mult = 1) {
  for (const k in cost) if ((res[k] || 0) < Math.ceil(cost[k] * mult)) return false;
  return true;
}
export function spend(s, cost, mult = 1) { for (const k in cost) s.res[k] -= Math.ceil(cost[k] * mult); }
export function refund(s, cost, share) { for (const k in cost) s.res[k] += Math.floor(cost[k] * share); }
// Production and upkeep go through here so the HUD can show per-minute flow.
export function flowRes(s, k, a) {
  s.res[k] += a; s.flow[k] += a;
  if (a > 0 && s.stats.produced) s.stats.produced[k] = (s.stats.produced[k] || 0) + a;
  if (s.res[k] < 0) s.res[k] = 0;
}

/** Cost of a building level after plug-in multipliers (faction prices, decrees...). */
export function costOf(s, type, level = 0) {
  const def = BUILDINGS[type];
  const base = def.levels[Math.min(level, def.levels.length - 1)].cost || {};
  if (!BUS.costMult.length) return base;
  const out = {};
  for (const k in base) out[k] = Math.max(0, Math.round(base[k] * product(BUS.costMult, s, type, k)));
  return out;
}

// ---- Morale and Dread (0..100) --------------------------------------------------
// Shared by every system that moves the realm's mood; mood.js adds the consequences.
/** Offer a choice now, or after the current one is answered. */
export function queuePending(s, p) {
  if (!s.pending) s.pending = p;
  else (s.pendingQueue || (s.pendingQueue = [])).push(p);
}

export function mood(s) {
  const m = s.ext.mood || (s.ext.mood = { morale: 60, dread: 10 });
  return m;
}
export function moodAdd(s, dMorale = 0, dDread = 0, why = '') {
  const m = mood(s);
  // Factions/decrees may make the realm's mood more fragile (dropMult) or Dread swifter (dreadMult).
  if (dMorale < 0) dMorale *= m.dropMult || 1;
  if (dDread > 0) dDread *= m.dreadMult || 1;
  m.morale = Math.max(0, Math.min(100, m.morale + dMorale));
  m.dread = Math.max(0, Math.min(100, m.dread + dDread));
  if (why && (Math.abs(dMorale) >= 3 || Math.abs(dDread) >= 3)) emit(s, { t: 'mood', dMorale, dDread, why });
}

export function popCap(s) {
  let p = 0;
  for (const b of s.buildings) if (b.built && b.alive) {
    p += levelStats(b.type, b.level).pop || 0;
    if (b.type === 'house') p += s.mods.popPerHouse || 0;
  }
  return p;
}

// ---- Spawning -------------------------------------------------------------------
function mover(s, kind, type, x, y, hp, r) {
  const e = { id: newId(s), kind, type, x, y, px: x, py: y, hp, maxHp: hp, r, face: 1, anim: rng(s).float(0, 6), hitT: 0, atkT: 0, cd: 0, alive: true, path: null, pi: 0, stuck: 0 };
  s.rt.eById.set(e.id, e);
  return e;
}
export function spawnVillager(s, x, y) {
  const h = s.rt.hearth;
  if (x === undefined && h) { x = ctr(h.tx + 1) + rng(s).float(-20, 20); y = (h.ty + 3) * T + 8; }
  const v = mover(s, 'villager', 'villager', x, y, BAL.villager.hp, 5);
  Object.assign(v, { st: 'idle', job: 0, build: 0, node: 0, carryK: null, carryA: 0, timer: 0, shelter: 0, think: rng(s).float(0, 0.5), wx: x, wy: y, hue: rng(s).int(0, 5) });
  s.villagers.push(v);
  return v;
}
export function spawnSovereign(s, x, y) {
  const d = UNITS.sovereign;
  const v = mover(s, 'sovereign', 'sovereign', x, y, d.hp, 7);
  Object.assign(v, { rx: x, ry: y, targetId: 0, novaCd: 0, bannerCd: 0, lastHurt: -99, retreat: false, armor: d.armor, orderT: -99, think: 0 });
  s.sovereign = v;
  return v;
}
export function spawnSoldier(s, type, squad, x, y) {
  const d = UNITS[type];
  const v = mover(s, 'soldier', type, x, y, d.hp, 6);
  const slot = s.soldiers.filter((q) => q.alive && q.squad === squad.id).length;
  Object.assign(v, { squad: squad.id, slot, targetId: 0, armor: d.armor, think: rng(s).float(0, 0.4), repath: 0 });
  s.soldiers.push(v);
  s.stats.trained++;
  return v;
}
export function spawnEnemy(s, type, x, y, affix) {
  const d = ENEMIES[type];
  const diff = BAL.difficulty[s.difficulty];
  const a = affix ? AFFIXES[affix] : null;
  const hp = Math.round(d.hp * diff.enemyHp * (a?.hpMult || 1) * (1 + 0.04 * s.cycle.night) * (1 + (s.mods.enemyHp || 0)) * (d.boss || d.stationary ? 1 : 1 + 0.05 * (s.step || 0)));
  const e = mover(s, 'enemy', type, x, y, hp, d.radius * (a?.scale || 1));
  Object.assign(e, { affix: affix || null, targetId: 0, siege: 0, think: rng(s).float(0, 0.5), speedMult: (a?.speedMult || 1) * (1 + (s.mods.enemySpeed || 0)), dmgMult: (a?.dmgMult || 1) * (1 + (s.mods.enemyDmg || 0)), scale: a?.scale || 1, jx: rng(s).float(-8, 8), jy: rng(s).float(-8, 8), lit: 0 });
  s.enemies.push(e);
  return e;
}

// ---- Buildings ------------------------------------------------------------------
export function footprintFree(s, type, tx, ty) {
  const size = BUILDINGS[type].size;
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
    if (!inB(x, y)) return false;
    const i = idx(x, y);
    if (s.occ[i] || s.nodeGrid[i]) return false;
  }
  return true;
}

// Max health including region modifiers (Hearth and wall bonuses).
export function maxHpFor(s, type, level) {
  const def = BUILDINGS[type];
  const base = levelStats(type, level).hp;
  const m = type === 'hearth' ? s.mods.hearthHp : def.isWall ? s.mods.wallHp : 0;
  return Math.round(base * (1 + (m || 0)));
}

export function createBuilding(s, type, tx, ty, built) {
  const def = BUILDINGS[type];
  const st = levelStats(type, 0);
  const mhp = maxHpFor(s, type, 0);
  const b = {
    id: newId(s), type, tx, ty, size: def.size, level: 0,
    hp: built ? mhp : Math.max(10, mhp * 0.15), maxHp: mhp,
    built: !!built, progress: 0, need: st.work || 1, upg: false,
    wantW: st.workers || 0, cd: 0, train: [], squad: 0, alive: true, hitT: 0, noRes: false, placedAt: s.time,
  };
  for (let y = ty; y < ty + def.size; y++) for (let x = tx; x < tx + def.size; x++) s.occ[idx(x, y)] = b.id;
  s.buildings.push(b);
  s.rt.bById.set(b.id, b);
  markFlowDirty(s);
  if (st.light || type === 'brazier') markLightDirty(s);
  return b;
}

export function finishConstruction(s, b) {
  if (b.upg) {
    b.level++; b.upg = false;
    const st = levelStats(b.type, b.level);
    const ratio = b.hp / b.maxHp;
    const mhp = maxHpFor(s, b.type, b.level);
    b.maxHp = mhp; b.hp = Math.max(b.hp, mhp * ratio);
    if (st.workers) b.wantW = st.workers;
    emit(s, { t: 'built', id: b.id, x: (b.tx + b.size / 2) * T, y: (b.ty + b.size / 2) * T, upgrade: true });
    b.progress = 0; markLightDirty(s);
    each(BUS.built, s, b, true);
    return;
  }
  b.built = true; b.hp = b.maxHp;
  s.stats.built++;
  emit(s, { t: 'built', id: b.id, x: (b.tx + b.size / 2) * T, y: (b.ty + b.size / 2) * T });
  b.progress = 0;
  markLightDirty(s);
  each(BUS.built, s, b, false);
}

export function removeBuilding(s, b, destroyed) {
  if (!b.alive) return;
  b.alive = false;
  for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) if (s.occ[idx(x, y)] === b.id) s.occ[idx(x, y)] = 0;
  s.rt.bById.delete(b.id);
  const i = s.buildings.indexOf(b);
  if (i >= 0) s.buildings.splice(i, 1);
  const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
  for (const v of s.villagers) {
    if (v.job === b.id) { v.job = 0; if (v.st !== 'sheltered' && v.st !== 'toShelter') v.st = 'idle'; v.path = null; }
    if (v.build === b.id) { v.build = 0; v.st = 'idle'; v.path = null; }
    if (v.shelter === b.id) {
      v.shelter = 0; v.x = cx + rng(s).float(-10, 10); v.y = (b.ty + b.size) * T + 6; v.px = v.x; v.py = v.y;
      v.st = s.cycle.phase === 'day' ? 'idle' : 'toShelter'; v.path = null;
    }
  }
  if (destroyed) {
    s.decals.push({ k: 'rubble', x: cx, y: cy, size: b.size, t: s.time });
    if (s.decals.length > 60) s.decals.shift();
    emit(s, { t: 'destroyed', x: cx, y: cy, size: b.size, type: b.type });
  }
  markLightDirty(s);
  each(BUS.removed, s, b, destroyed);
  if (b.type === 'hearth' && destroyed && !s.outcome) s.outcome = { result: 'defeat', reason: 'The Hearth has fallen. The Heartflame gutters out.' };
}

// Nearest walkable tile next to a building (for villagers and units).
export function accessTile(s, b, fromX, fromY) {
  let best = null, bd = 1e9;
  for (let y = b.ty - 1; y <= b.ty + b.size; y++) for (let x = b.tx - 1; x <= b.tx + b.size; x++) {
    if (!inB(x, y)) continue;
    if (x >= b.tx && x < b.tx + b.size && y >= b.ty && y < b.ty + b.size) continue;
    const i = idx(x, y);
    if (s.occ[i] || s.nodeGrid[i]) continue;
    if (s.terrain[i] === 4 || s.terrain[i] === 5) continue;
    const d = Math.hypot(ctr(x) - fromX, ctr(y) - fromY);
    if (d < bd) { bd = d; best = { tx: x, ty: y }; }
  }
  return best;
}

// ---- Damage -----------------------------------------------------------------------
export function hurt(s, t, amt, type, bonus, fx, fy, src) {
  if (!t.alive || amt <= 0) return 0;
  let d = amt;
  if (BUS.dmgMult.length) d *= product(BUS.dmgMult, s, src || null, t, type);
  if (t.kind === 'enemy') {
    const def = ENEMIES[t.type];
    const mt = MATCHUPS[type];
    for (const tag of def.tags) {
      if (mt && mt[tag]) d *= mt[tag];
      if (bonus && bonus[tag]) d *= bonus[tag];
    }
    const ti = idx(Math.max(0, Math.min(N - 1, tileOf(t.x))), Math.max(0, Math.min(N - 1, tileOf(t.y))));
    if (s.lit[ti]) d *= 1 + BAL.combat.lightBonus;
    if (fx !== undefined && !t.stationary && !t.boss) {
      const dx = t.x - fx, dy = t.y - fy, l = Math.hypot(dx, dy) || 1;
      const k = 2.5 / (t.scale || 1);
      t.x += (dx / l) * k; t.y += (dy / l) * k;
    }
  } else {
    d *= 1 - (t.armor || 0);
    if (t.kind === 'sovereign') t.lastHurt = s.time;
  }
  t.hp -= d; t.hitT = 0.14;
  emit(s, { t: 'hit', x: t.x, y: t.y - 10, amt: d, foe: t.kind === 'enemy', dtype: type });
  if (t.hp <= 0) kill(s, t, src || null);
  return d;
}

export function kill(s, e, killer = null) {
  if (!e.alive) return;
  e.alive = false; e.hp = 0;
  each(BUS.kill, s, e, killer);
  if (e.kind === 'enemy') { s.stats.kills++; emit(s, { t: 'death', x: e.x, y: e.y, foe: true, type: e.type, big: e.scale > 1.3 }); }
  else if (e.kind === 'villager') { s.stats.villagersLost++; emit(s, { t: 'death', x: e.x, y: e.y, foe: false, type: 'villager' }); emit(s, { t: 'toast', text: 'A villager has fallen.', tone: 'bad' }); }
  else if (e.kind === 'soldier') { s.stats.soldiersLost++; emit(s, { t: 'death', x: e.x, y: e.y, foe: false, type: e.type }); }
  else if (e.kind === 'hero') { s.stats.heroesLost = (s.stats.heroesLost || 0) + 1; emit(s, { t: 'death', x: e.x, y: e.y, foe: false, type: 'hero', big: true }); emit(s, { t: 'toast', text: `${e.name || 'A hero'} has fallen.`, tone: 'bad', icon: 'skull' }); }
  else if (e.kind === 'sovereign') {
    emit(s, { t: 'death', x: e.x, y: e.y, foe: false, type: 'sovereign', big: true });
    if (!s.outcome) s.outcome = { result: 'defeat', reason: 'The Ember-Sovereign has fallen, and with no heir the realm scatters.' };
  }
}

export function hurtBuilding(s, b, amt, type) {
  if (!b.alive) return;
  const m = BAL.combat.buildingDmgMult[type] || 1;
  b.hp -= amt * m; b.hitT = 0.14;
  if (b.type === 'hearth') emit(s, { t: 'hearthHit' });
  if (b.hp <= 0 && b.type === 'hearth' && HOOKS.relicHook && HOOKS.relicHook(s, 'onHearthFall')) { b.hp = Math.max(b.hp, 1); return; }
  if (b.hp <= 0) removeBuilding(s, b, true);
}

// In-place removal of dead entities, keeping arrays allocation-free.
export function compact(s, list) {
  let w = 0;
  for (let r = 0; r < list.length; r++) {
    const e = list[r];
    if (e.alive) list[w++] = e; else s.rt.eById.delete(e.id);
  }
  list.length = w;
}
