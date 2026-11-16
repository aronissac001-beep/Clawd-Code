// The wave director (Phase 3): invisible pacing, tonight's wave modifiers and lasting
// region modifiers. (In-region random events and the choice of pacing style were cut in
// the rework; one steady pacing curve, PACE below, remains.)
//
// Rework (stream D): the pacing is invisible. The region's own 3-night escalation (waves.js)
// is the curve; the director only bends a middle night now and then (never night 1 and never
// the Long Night) and says nothing about it: the change shows in the dusk forecast's counts
// and fronts, like any other part of the wave. The Lull is gone (no free nights).
//
// Region state (plain JSON):  s.ext.director = { tension, lastCrisis, buffs, ... }
//                             s.ext.modifiers = [region modifier ids]
// Run layer:                  node.modifiers = [ids] on the Realm Map (rolled at BUS.runMap)
//
// Pacing: right after tonight's plan is rolled (BUS.wavePlan, at the start of each day)
// the director measures tension from the realm's wealth, army, recent losses and the
// nights since the last crisis, then may bend tonight's wave with a modifier. Everything
// it adds is written into s.wave (groups and wave.mods) before dusk, so it is always
// telegraphed.
// Deterministic: region RNG s.rt.rng in the sim, the run RNG (withRng) on the map.
import { BUS } from '../hooks.js';
import { registerWaves } from './waves.js';
import { BAL } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { BUILDINGS } from '../../data/buildings.js';
import { T, N, idx, ctr, inB } from '../grid.js';
import { emit, getB } from './common.js';
import { withRng } from '../run.js';
import { MODIFIERS, MODIFIER_LIST, modifierFits, modifierLine } from '../../data/modifiers.js';

// ---- Tuning ------------------------------------------------------------------------------------
// The one pacing curve (formerly "The Steady Hand"):
//  waveVariance    0..1, how hard a wave modifier bends tonight's plan (share of units affected)
//  modifierChance  base chance each day that tonight's wave carries a hostile modifier
//  crisisCooldown  nights that must pass after a crisis before the next hostile modifier
//  minNight        first (effective) night that can carry a hostile modifier; only a region's
//                  middle night is ever bent (see directorWaveMods)
//  stack           chance of a second, stacked hostile modifier on a crisis night
export const PACE = { id: 'steady', waveVariance: 0.5, modifierChance: 0.35, crisisCooldown: 1, minNight: 2, stack: 0 };
export const DIRECTOR = {
  tension: {
    wealthPerRes: 0.04, wealthPerBuilding: 1, wealthCap: 40,   // (food+wood+stone+gold) and built buildings
    armySoldier: 3, armyHero: 6, armyTower: 4, armyCap: 35,     // soldiers, heroes, defensive buildings
    calmPerNight: 6, calmCap: 30,                               // nights since the last crisis
    perLoss: 7,                                                 // each life or building lost since yesterday
  },
  heavyLoss: 3,           // this many losses in a night counts as a crisis (no modifier the next night)
  bloodLoot: true,        // Twin Moons: the Long Night's dawn pays double gold
  shadow: { at: 17, dmg: 0.15 },   // Dragon's Shadow: noon strike (mid-day), share of max health
  tremor: 0.1,            // Restless Earth: dusk wall damage share
  ley: 1.5, fog: 0.5, stoneGather: 1.4, woodNode: 1.5, rockNode: 1.5, warGold: 40,
};
const DEFENSE = new Set(['tower', 'ballista', 'spire']);
const BUFF_WORD = { work: 'Villagers work', farm: 'Farms yield', gold: 'Taxes and markets', dmg: 'Your damage', sight: 'Sight' };
const RES = ['food', 'wood', 'stone', 'gold'];

// ---- State -------------------------------------------------------------------------------------
/** Director state, created lazily (older saves have none). */
export function directorState(s) {
  const ext = s.ext || (s.ext = {});
  let d = ext.director;
  if (!d) {
    d = ext.director = {
      tension: 0, lastCrisis: -PACE.crisisCooldown, buffs: [], bv: 0,
      tonight: null, snapLost: 0, bLost: 0, recentLoss: 0,
      shadow: null, battlefield: null,
      log: [], // [{ n, ids, tension }] wave modifier history (for tests)
    };
  }
  return d;
}
export function regionModifiers(s) { const m = s.ext && s.ext.modifiers; return Array.isArray(m) ? m : []; }
export function hasModifier(s, id) { return regionModifiers(s).includes(id); }

// Cached multipliers for the hot paths; rebuilt when the buff list changes.
function cache(s) {
  const d = s.ext.director;
  let c = s.rt.director;
  const v = d ? d.bv : -1;
  if (c && c.v === v) return c;
  c = s.rt.director = { v, work: 1, farm: 1, gold: 1, dmg: 1, sight: 1, ley: hasModifier(s, 'ley_surge'), fog: hasModifier(s, 'fog_of_ages'), quake: hasModifier(s, 'restless_earth') };
  if (d) for (const b of d.buffs) if (b.key in c) c[b.key] *= b.value;
  if (c.fog) c.sight *= DIRECTOR.fog;
  return c;
}
function bumpBuffs(s) { directorState(s).bv++; }

// ---- Tension ---------------------------------------------------------------------------------------
/** Tension 0..100: how much drama the director feels is due. Pure read. */
export function computeTension(s, nightN) {
  const P = DIRECTOR.tension;
  const d = directorState(s);
  let res = 0;
  for (const k of RES) res += s.res[k] || 0;
  let built = 0, def = 0;
  for (const b of s.buildings) if (b.built && b.alive && b.type !== 'hearth') { built++; if (DEFENSE.has(b.type)) def++; }
  let sol = 0, her = 0;
  for (const u of s.soldiers) if (u.alive) sol++;
  for (const u of s.heroes || []) if (u.alive) her++;
  const wealth = Math.min(P.wealthCap, res * P.wealthPerRes + built * P.wealthPerBuilding);
  const army = Math.min(P.armyCap, sol * P.armySoldier + her * P.armyHero + def * P.armyTower);
  const n = nightN != null ? nightN : (s.cycle.night + 1);
  const calm = Math.min(P.calmCap, Math.max(0, n - 1 - d.lastCrisis) * P.calmPerNight);
  return Math.max(0, Math.min(100, Math.round(wealth + army + calm - d.recentLoss * P.perLoss)));
}

function totalLost(s) {
  const st = s.stats;
  return (st.villagersLost || 0) + (st.soldiersLost || 0) + (st.heroesLost || 0) + directorState(s).bLost;
}

// ---- Wave modifiers ----------------------------------------------------------------------------------
const plural = (t, k) => { const nm = (ENEMIES[t] && ENEMIES[t].name) || t; return k === 1 ? nm : nm + 's'; };
function recount(w) {
  for (const g of w.groups) { const c = {}; for (const [t] of g.units) c[t] = (c[t] || 0) + 1; g.counts = c; }
  w.total = w.groups.reduce((a, g) => a + g.units.length, 0);
}
function unitsOf(w, pred) { let k = 0; for (const g of w.groups) for (const u of g.units) if (pred(u)) k++; return k; }
const plain = (types) => (u) => !u[1] && types.includes(u[0]);

/** Tonight's wave modifiers the director can choose. apply(s, w, v, r) -> telegraph text or null. */
export const WAVE_MODS = {
  swift_tide: {
    id: 'swift_tide', name: 'Swift Tide', hostile: true, minNight: 2, weight: 3,
    ok: (s, w) => unitsOf(w, plain(['husk', 'hound'])) >= 3,
    apply(s, w, v, r) {
      const f = 0.3 + 0.4 * v;
      let k = 0, firstU = null;
      const by = { husk: 0, hound: 0 };
      for (const g of w.groups) for (const u of g.units) if (plain(['husk', 'hound'])(u)) { firstU = firstU || u; if (r.chance(f)) { u[1] = 'swift'; by[u[0]]++; k++; } }
      if (!k && firstU) { firstU[1] = 'swift'; by[firstU[0]]++; k = 1; }
      const parts = ['husk', 'hound'].filter((t) => by[t]).map((t) => `${by[t]} ${plural(t, by[t])}`);
      return `${parts.join(' and ')} ${k > 1 ? 'run' : 'runs'} Swift tonight (45% faster).`;
    },
  },
  armoured_tide: {
    id: 'armoured_tide', name: 'Armoured Tide', hostile: true, minNight: 3, weight: 2,
    ok: (s, w) => w.groups.some((g) => g.units.filter(plain(['husk'])).length >= 4),
    apply(s, w, v, r) {
      const f = 0.3 + 0.4 * v;
      let k = 0;
      for (const g of w.groups) {
        const husks = g.units.filter(plain(['husk']));
        let swaps = Math.round((husks.length * f) / 4);
        if (!k && !swaps && husks.length >= 4) swaps = 1;
        for (let i = 0; i < swaps; i++) {
          let removed = 0;
          for (let j = g.units.length - 1; j >= 0 && removed < 4; j--) if (plain(['husk'])(g.units[j])) { g.units.splice(j, 1); removed++; }
          g.units.splice(r.int(0, g.units.length), 0, ['knight', null]);
          k++;
        }
      }
      return `${k} Hollow Knight${k > 1 ? 's march' : ' marches'} in place of Husks (each replaces 4).`;
    },
  },
  shade_haunt: {
    id: 'shade_haunt', name: 'Shade Haunt', hostile: true, minNight: 2, weight: 2,
    ok: (s, w) => unitsOf(w, plain(['hound'])) >= 2,
    apply(s, w) {
      let k = 0;
      for (const g of w.groups) for (const u of g.units) if (plain(['hound'])(u)) { u[0] = 'shade'; k++; }
      return `${k} Shades come in place of the Gloom Hounds. They slip through dark walls.`;
    },
  },
  second_front: {
    id: 'second_front', name: 'Second Front', hostile: true, minNight: 2, weight: 2,
    ok: (s, w) => s.spawns.length > 1 && w.total >= 4,
    apply(s, w, v, r) {
      const used = new Set(w.groups.map((g) => g.sp.side));
      const usedAt = new Set(w.groups.map((g) => g.sp.tx + ',' + g.sp.ty));
      let pool = s.spawns.filter((sp) => !used.has(sp.side));
      if (!pool.length) pool = s.spawns.filter((sp) => !usedAt.has(sp.tx + ',' + sp.ty));
      if (!pool.length) pool = s.spawns;
      const sp = r.pick(pool);
      const src = [];
      for (const g of w.groups) for (const u of g.units) if (u[1] !== 'warden' && ENEMIES[u[0]] && !ENEMIES[u[0]].boss) src.push(u[0]);
      const k = Math.max(2, Math.round(w.total * (0.15 + 0.2 * v)));
      const units = [];
      for (let i = 0; i < k; i++) units.push([src.length ? r.pick(src) : 'husk', null]);
      w.groups.push({ sp: { tx: sp.tx, ty: sp.ty, side: sp.side }, units, counts: {}, front: true });
      return `A second front opens in the ${sideWord(sp.side)}: ${k} more Hollow.`;
    },
  },
};

function pushMod(w, id, name, text) {
  if (!w.mods) w.mods = [];
  w.mods.push({ id, name, text });
}

/** Region modifier effects on tonight's plan (telegraphed in wave.mods). */
function regionWaveMods(s, w, r) {
  const n = w.n;
  if (hasModifier(s, 'twin_moons') && w.long && s.objective.type !== 'boss') {
    // A second Warden leads the Long Night from the smallest front.
    if (w.groups.length) {
      const small = w.groups.reduce((a, b) => (a.units.length <= b.units.length ? a : b));
      small.units.unshift([w.ne >= 4 ? 'knight' : 'shade', 'warden']); small.warden = true;
    }
    pushMod(w, 'twin_moons', 'Twin Moons', 'Two moons rise: two Wardens lead the Long Night. Its dawn pays double gold.');
  }
  if (hasModifier(s, 'haunted_woods')) {
    let k = 0;
    for (const g of w.groups) {
      const husks = g.units.filter(plain(['husk']));
      const want = Math.max((w.ne || n) < 3 ? 1 : 0, Math.round(husks.length * 0.25));
      for (let i = 0; i < want && i < husks.length; i++) { husks[i][0] = 'shade'; k++; }
    }
    if (k) pushMod(w, 'haunted_woods', 'Haunted Woods', `${k} Shade${k > 1 ? 's' : ''} drift out of the whispering trees tonight.`);
  }
  if (hasModifier(s, 'ley_surge') && n >= 2) {
    let k = 0;
    for (const g of w.groups) for (const u of g.units) if (plain(['husk', 'hound'])(u) && r.chance(0.15)) { u[0] = 'shade'; k++; }
    if (k) pushMod(w, 'ley_surge', 'Ley Line Surge', `${k} extra Shade${k > 1 ? 's' : ''} ride the ley lines tonight.`);
  }
  const bf = s.ext.director && s.ext.director.battlefield;
  if (hasModifier(s, 'ancient_battlefield') && bf && s.objective.type !== 'boss') {
    const k = 2 + Math.floor(n * 0.8);
    const units = [];
    for (let i = 0; i < k; i++) units.push(['husk', null]);
    w.groups.push({ sp: { tx: bf.tx, ty: bf.ty, side: 'battlefield' }, units, counts: {}, battlefield: true });
    pushMod(w, 'ancient_battlefield', 'Ancient Battlefield', `${k} Husks will claw out of the old battlefield at nightfall.`);
  }
}

/** Choose and apply the director's modifiers for tonight. */
function directorWaveMods(s, w, r) {
  const d = directorState(s);
  const st = PACE;
  const n = w.n;
  if (s.objective && s.objective.type === 'boss') return [];
  // A replan of the same night (debug Long Night) keeps the same choice.
  let ids;
  if (d.tonight && d.tonight.n === n) ids = d.tonight.ids.slice();
  else {
    ids = [];
    const t = d.tension;
    const hostileIds = Object.keys(WAVE_MODS).filter((id) => WAVE_MODS[id].hostile);
    const eligible = (id) => (w.ne || n) >= WAVE_MODS[id].minNight && WAVE_MODS[id].ok(s, w) && !ids.includes(id);
    // Only a middle night is bent: night 1 teaches, the Long Night is already the peak, and a
    // night after heavy losses is left as planned.
    const middle = w.pos ? w.pos === 'n2' : !w.long;
    if (middle && d.recentLoss < DIRECTOR.heavyLoss && n - d.lastCrisis > st.crisisCooldown) {
      const p = st.modifierChance * (0.4 + 1.2 * t / 100);
      if (r.chance(p)) {
        const pool = hostileIds.filter(eligible);
        if (pool.length) ids.push(r.weighted(pool, (id) => WAVE_MODS[id].weight));
        if (ids.length && st.stack && r.chance(st.stack)) {
          const more = hostileIds.filter(eligible);
          if (more.length) ids.push(r.weighted(more, (id) => WAVE_MODS[id].weight));
        }
      }
    }
    d.tonight = { n, ids: ids.slice() };
    if (ids.some((id) => WAVE_MODS[id].hostile) || w.long) d.lastCrisis = n;
    d.log.push({ n, ids: ids.slice(), tension: t, long: !!w.long });
    if (d.log.length > 40) d.log.shift();
  }
  const v = Math.max(0, Math.min(1, st.waveVariance * r.float(0.85, 1.1)));
  for (const id of ids) {
    const M = WAVE_MODS[id];
    if (!M || !M.ok(s, w)) continue;
    const text = M.apply(s, w, v, r);
    if (text) pushMod(w, M.id, M.name, text);
  }
  return ids;
}

function onWavePlan(s, w) {
  const d = directorState(s);
  const r = s.rt.rng;
  // Losses since the last plan (yesterday's night and day).
  const lost = totalLost(s);
  if (!d.tonight || d.tonight.n !== w.n) { d.recentLoss = Math.max(0, lost - d.snapLost); d.snapLost = lost; }
  if (d.recentLoss >= DIRECTOR.heavyLoss && d.lastCrisis < w.n - 1) d.lastCrisis = w.n - 1;
  d.tension = computeTension(s, w.n);
  if (!w.mods) w.mods = [];
  recount(w); // the core totals the plan after the wavePlan hooks
  regionWaveMods(s, w, r);
  recount(w);
  directorWaveMods(s, w, r);
  recount(w);
}

// ---- Shared helpers -----------------------------------------------------------------------------------
const SIDE_WORD = { N: 'north', S: 'south', E: 'east', W: 'west', battlefield: 'old battlefield', rift: 'Rift' };
export function sideWord(side) { return SIDE_WORD[side] || side || 'wilds'; }
function pickBuilding(s, kind, r) {
  const ok = (b) => b.built && b.alive && b.type !== 'hearth';
  let pool = kind === 'house' ? s.buildings.filter((b) => ok(b) && b.type === 'house') : [];
  if (!pool.length) pool = s.buildings.filter((b) => ok(b) && !isWallType(b));
  if (!pool.length) pool = s.buildings.filter(ok);
  return pool.length ? r.pick(pool) : null;
}
const bName = (b) => (b && BUILDINGS[b.type] ? BUILDINGS[b.type].name : 'building');

/** Scorch a building for a share of its max health; never destroys it. Returns damage dealt. */
export function scorch(s, b, share, quiet) {
  if (!b || !b.alive) return 0;
  const dmg = Math.max(0, Math.min(b.maxHp * share, b.hp - 1));
  b.hp -= dmg; b.hitT = 0.14;
  if (quiet) return dmg;
  const x = (b.tx + b.size / 2) * T, y = (b.ty + b.size / 2) * T;
  emit(s, { t: 'hit', x, y: y - 10, amt: dmg, foe: false, dtype: 'fire' });
  emit(s, { t: 'sfx', k: 'thud', x, y });
  return dmg;
}

// ---- Read-only helpers --------------------------------------------------------------------------------
/** Tonight's telegraphed modifiers [{ id, name, text }]. */
export function tonightMods(s) { return (s.wave && s.wave.mods) || []; }
/** Region modifier views [{ id, name, icon, text }]. */
export function regionModifierViews(s) { return regionModifiers(s).map((id) => MODIFIERS[id]).filter(Boolean); }

// ---- Phases and ticks ------------------------------------------------------------------------------
function onPhase(s, phase) {
  const d = directorState(s);
  if (phase === 'dawn') {
    // Buffs end at the dawn after their last night.
    const gone = d.buffs.filter((b) => s.cycle.night >= b.end);
    if (gone.length) {
      d.buffs = d.buffs.filter((b) => s.cycle.night < b.end);
      bumpBuffs(s);
      for (const b of gone) emit(s, { t: 'toast', text: `${b.name || 'A blessing'} fades: ${(BUFF_WORD[b.key] || b.key).toLowerCase()} back to normal.`, tone: '', icon: 'sun' });
    }
    if (hasModifier(s, 'twin_moons') && s.wave && s.wave.long && DIRECTOR.bloodLoot) {
      const c = s.cycle;
      const gold = Math.round((BAL.dawnGold.base + BAL.dawnGold.perNight * c.night + (s.mods.dawnGold || 0)) * (1 + (s.mods.lootMult || 0)));
      s.res.gold += gold;
      emit(s, { t: 'toast', text: `Twin Moons: the Long Night leaves double loot, +${gold} gold.`, tone: 'good', icon: 'gold' });
    }
    if (hasModifier(s, 'dragon_shadow')) {
      const b = pickBuilding(s, 'random', s.rt.rng);
      if (b) {
        d.shadow = { bid: b.id, at: DIRECTOR.shadow.at, type: b.type };
        emit(s, { t: 'toast', text: `A wyvern circles overhead. At noon its shadow will scorch your ${bName(b)}.`, tone: 'bad', icon: 'wyrm' });
      }
    }
  } else if (phase === 'dusk') {
    // Called the night before noon? The wyvern still passes, at sundown.
    if (d.shadow) shadowStrike(s, d);
    // Tonight's wave modifiers are not announced: they show in the forecast itself.
    if (hasModifier(s, 'restless_earth')) {
      let k = 0;
      for (const b of s.buildings) if (b.built && b.alive && isWallType(b)) { scorch(s, b, DIRECTOR.tremor, true); k++; }
      if (k) {
        const h = s.rt.hearth;
        if (h) emit(s, { t: 'sfx', k: 'thud', x: ctr(h.tx + 1), y: ctr(h.ty + 1) });
        emit(s, { t: 'toast', text: `The earth shudders: ${k} wall${k > 1 ? 's and gates crack' : ' or gate cracks'} (-${Math.round(DIRECTOR.tremor * 100)}% health).`, tone: 'bad', icon: 'quarry' });
      }
    }
  }
}


function isWallType(b) { const def = BUILDINGS[b.type]; return !!(def && def.isWall); }

function onTick(s) {
  const d = s.ext.director;
  if (!d || !d.shadow || s.cycle.phase !== 'day' || s.cycle.t < d.shadow.at) return;
  shadowStrike(s, d);
}
function shadowStrike(s, d) {
  const b = getB(s, d.shadow.bid);
  d.shadow = null;
  if (!b) return;
  const dmg = scorch(s, b, DIRECTOR.shadow.dmg);
  emit(s, { t: 'toast', text: `The wyvern's shadow passes: your ${bName(b)} is scorched (-${Math.round(dmg)} health).`, tone: 'bad', icon: 'wyrm' });
}

function onRemoved(s, b, destroyed) {
  if (!destroyed) return;
  const d = directorState(s);
  d.bLost++;
  if (!isWallType(b)) d.bLostB = (d.bLostB || 0) + 1; // buildings other than walls (side goal)
}

// ---- Region modifiers: install --------------------------------------------------------------------
function findBattlefield(s, r) {
  const h = s.rt.hearth;
  const hx = h ? h.tx + 1 : N / 2, hy = h ? h.ty + 1 : N / 2;
  for (let k = 0; k < 160; k++) {
    const a = r.float(0, Math.PI * 2), dist = k < 80 ? r.float(9, 13) : r.float(7, 17);
    const tx = Math.round(hx + Math.cos(a) * dist), ty = Math.round(hy + Math.sin(a) * dist);
    if (!inB(tx, ty) || tx < 2 || ty < 2 || tx > N - 3 || ty > N - 3) continue;
    const i = idx(tx, ty);
    if (s.occ[i] || s.nodeGrid[i] || s.terrain[i] === 4 || s.terrain[i] === 5) continue;
    return { tx, ty };
  }
  // Crowded land: the old armies lie under the nearest Hollow spawn point instead.
  const sp = s.spawns.length ? s.spawns[r.int(0, s.spawns.length - 1)] : null;
  return sp ? { tx: sp.tx, ty: sp.ty } : null;
}

/** BUS.canPlace: nothing is built on the old battlefield (Husks claw out of it at night). */
function vetoBattlefield(s, type, tx, ty) {
  const d = s.ext.director;
  const bf = d && d.battlefield;
  if (!bf) return null;
  const def = BUILDINGS[type];
  const size = (def && def.size) || 1;
  if (bf.tx >= tx - 1 && bf.tx <= tx + size && bf.ty >= ty - 1 && bf.ty <= ty + size) return { ok: false, reason: 'The old battlefield will not hold foundations' };
  return null;
}

function onRegionInit(s, ctx) {
  const ids = (ctx && ctx.extra && Array.isArray(ctx.extra.modifiers) ? ctx.extra.modifiers : []).filter((id) => MODIFIERS[id]);
  s.ext.modifiers = ids.slice();
  const d = directorState(s);
  const r = s.rt.rng;
  if (ids.includes('bountiful_woods')) for (const n of s.nodes) if (n.kind === 'tree') { n.amount = Math.round(n.amount * DIRECTOR.woodNode); n.max = Math.round((n.max || n.amount) * DIRECTOR.woodNode); }
  if (ids.includes('iron_veins')) for (const n of s.nodes) if (n.kind === 'rock') { n.amount = Math.round(n.amount * DIRECTOR.rockNode); n.max = Math.round((n.max || n.amount) * DIRECTOR.rockNode); }
  if (ids.includes('ancient_battlefield')) {
    d.battlefield = findBattlefield(s, r);
    for (const c of s.caches) c.reward.gold = (c.reward.gold || 0) + DIRECTOR.warGold;
  }
  s.rt.director = null; // modifier flags changed: rebuild the multiplier cache
  if (ids.length) emit(s, { t: 'toast', text: `This land: ${ids.map((id) => MODIFIERS[id].name).join(', ')}.`, tone: '', icon: 'map' });
}

// ---- Multipliers (hot paths: cached) -----------------------------------------------------------------
function workMult(s) { return s.ext.director ? cache(s).work : 1; }
function farmMult(s) { return s.ext.director ? cache(s).farm : 1; }
function goldMult(s) { return s.ext.director ? cache(s).gold : 1; }
function sightMult(s) { return cache(s).sight; }
function dmgMult(s, a, t, type) {
  if (t.kind !== 'enemy') return 1;
  const c = cache(s);
  return (c.ley && !a && type === 'magic') ? c.dmg * DIRECTOR.ley : c.dmg;
}
function gatherMult(s, b, k) { return k === 'stone' && cache(s).quake ? DIRECTOR.stoneGather : 1; }

// ---- Run layer ----------------------------------------------------------------------------------------
const MOD_NODES = new Set(['region', 'cursed', 'ruin']);
/** BUS.runMap: dress region/cursed/ruin nodes with 0-2 modifiers. */
export function dressMapModifiers(run, map) {
  withRng(run, (r) => {
    for (const id of Object.keys(map.nodes).sort()) {
      const node = map.nodes[id];
      if (node.modifiers) continue;
      if (!MOD_NODES.has(node.type) || ((map.act || run.act || 1) === 1 && node.step === 0)) { node.modifiers = []; continue; }
      const n = node.type === 'cursed' ? (r.chance(0.35) ? 2 : 1)
        : node.type === 'ruin' ? (r.chance(0.4) ? 1 : 0)
        : r.weighted([0, 1, 2], (k) => [0.45, 0.4, 0.15][k]);
      const ids = [];
      for (let k = 0; k < n; k++) {
        const pool = MODIFIER_LIST.filter((m) => modifierFits(m.id, ids));
        if (!pool.length) break;
        const m = r.weighted(pool, (x) => x.weight * (node.type === 'cursed' ? (x.tone === 'bad' ? 2.5 : x.tone === 'good' ? 0.4 : 1) : 1));
        ids.push(m.id);
      }
      node.modifiers = ids;
    }
  });
}
function mapNodeLines(node) { return (node && node.modifiers ? node.modifiers : []).map(modifierLine).filter(Boolean); }
function onRunRegion(run, node, params) {
  const ids = (node && Array.isArray(node.modifiers) ? node.modifiers : []).filter((id) => MODIFIERS[id]);
  params.extra = params.extra || {};
  params.extra.modifiers = ids.slice();
  for (const id of ids) {
    const m = MODIFIERS[id];
    for (const k in m.mods || {}) {
      if (!(k in params.mods)) continue;
      if (k === 'lightMult') params.mods[k] *= m.mods[k]; else params.mods[k] += m.mods[k];
    }
    for (const k in m.start || {}) params.start[k] = (params.start[k] || 0) + m.start[k];
  }
}

// ---- Debug / test command ----------------------------------------------------------------------------
function cmdDirectorDebug(s, c) {
  if (c.what === 'mod') {
    const M = WAVE_MODS[c.id];
    if (!M || !s.wave || s.cycle.phase === 'night') return { ok: false };
    if (!M.ok(s, s.wave)) return { ok: false, msg: 'Not possible tonight' };
    const text = M.apply(s, s.wave, PACE.waveVariance, s.rt.rng);
    pushMod(s.wave, M.id, M.name, text); recount(s.wave);
    return { ok: true };
  }
  return { ok: false };
}

// ---- Registration ------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  BUS.regionInit.push(onRegionInit);
  BUS.wavePlan.push(onWavePlan);
  BUS.phase.push(onPhase);
  BUS.tick.push(onTick);
  BUS.removed.push(onRemoved);
  BUS.canPlace.push(vetoBattlefield);
  BUS.workMult.push(workMult);
  BUS.farmMult.push(farmMult);
  BUS.goldMult.push(goldMult);
  BUS.sightMult.push(sightMult);
  BUS.dmgMult.push(dmgMult);
  BUS.gatherMult.push(gatherMult);
  BUS.commands.directorDebug = cmdDirectorDebug;
  BUS.runMap.push(dressMapModifiers);
  BUS.runRegion.push(onRunRegion);
  BUS.mapNode.push(mapNodeLines);
  registerWaves();
}

/** Legacy query (the Blood Moon cadence is gone; the Long Night is part of every region). */
export function extraBloodMoon() { return false; }

export { MODIFIERS };
