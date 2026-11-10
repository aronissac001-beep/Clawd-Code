// The storyteller director (Phase 3): AI pacing, in-region random events, tonight's
// wave modifiers and lasting region modifiers.
//
// Region state (plain JSON):  s.ext.director = { tension, lastCrisis, eventsSeen, buffs, ... }
//                             s.ext.modifiers = [region modifier ids]
// Run layer:                  node.modifiers = [ids] on the Realm Map (rolled at BUS.runMap)
//
// Pacing: right after tonight's plan is rolled (BUS.wavePlan, at the start of each day)
// the director measures tension from the realm's wealth, army, recent losses and the
// nights since the last crisis, then may bend tonight's wave with a modifier. Everything
// it adds is written into s.wave (groups and wave.mods) before dusk, so it is always
// telegraphed. At BUS.phase 'day' it may raise a region event (a pending choice).
// Deterministic: region RNG s.rt.rng in the sim, the run RNG (withRng) on the map.
import { BUS } from '../hooks.js';
import { BAL } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { BUILDINGS } from '../../data/buildings.js';
import { T, N, idx, ctr, inB } from '../grid.js';
import { emit, moodAdd, spawnVillager, kill, queuePending, getB } from './common.js';
import { revealAround } from './fog.js';
import { withRng } from '../run.js';
import { STORYTELLERS, storytellerDef } from '../../data/storytellers.js';
import { REGION_EVENTS, REGION_EVENT_BY_ID } from '../../data/regionevents.js';
import { MODIFIERS, MODIFIER_LIST, modifierFits, modifierLine } from '../../data/modifiers.js';

// ---- Tuning ------------------------------------------------------------------------------------
export const DIRECTOR = {
  tension: {
    wealthPerRes: 0.04, wealthPerBuilding: 1, wealthCap: 40,   // (food+wood+stone+gold) and built buildings
    armySoldier: 3, armyHero: 6, armyTower: 4, armyCap: 35,     // soldiers, heroes, defensive buildings
    calmPerNight: 6, calmCap: 30,                               // nights since the last crisis
    perLoss: 7,                                                 // each life or building lost since yesterday
  },
  heavyLoss: 3,           // this many losses in a night counts as a crisis (a breather follows)
  eventSpacing: 0.5,      // event chance multiplier on the day right after an event
  lullShare: 0.3,         // a Lull removes this share of tonight's units
  bloodLoot: true,        // Twin Moons: Blood Moon dawns pay double gold
  shadow: { at: 45, dmg: 0.15 },   // Dragon's Shadow: noon strike, share of max health
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
    const st = storytellerDef(s.storyteller);
    d = ext.director = {
      tension: 0, lastCrisis: -st.crisisCooldown, eventsSeen: [], buffs: [], bv: 0,
      tonight: null, lastEventDay: -9, snapLost: 0, bLost: 0, recentLoss: 0,
      shadow: null, battlefield: null, last: null,
      log: [], // [{ n, ids, tension }] wave modifier history (for tests and the omen card)
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
/** Tension 0..100: how much drama the storyteller feels is due. Pure read. */
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
  lull: {
    id: 'lull', name: 'Lull', hostile: false, minNight: 1, weight: 1,
    ok: (s, w) => w.total >= 3,
    apply(s, w, v, r) {
      const share = DIRECTOR.lullShare;
      let k = 0;
      for (const g of w.groups) {
        const cut = Math.round(g.units.length * share);
        for (let i = 0; i < cut; i++) {
          const cand = [];
          g.units.forEach((u, j) => { if (u[1] !== 'warden') cand.push(j); });
          if (cand.length <= 1) break;
          g.units.splice(r.pick(cand), 1); k++;
        }
      }
      if (!k) { // many tiny groups: still thin the biggest one by one foe
        const big = w.groups.reduce((a, b) => (a.units.length >= b.units.length ? a : b));
        const j = big.units.findIndex((u) => u[1] !== 'warden');
        if (big.units.length > 1 && j >= 0) { big.units.splice(j, 1); k = 1; }
        else if (w.groups.length > 1) { // lone stragglers: one front stays quiet tonight
          const gi = w.groups.findIndex((g) => g.units.every((u) => u[1] !== 'warden'));
          if (gi >= 0) { k = w.groups[gi].units.length; w.groups.splice(gi, 1); }
        }
      }
      return `Breathing room: the Hollow is thin tonight, ${k} fewer foe${k > 1 ? 's' : ''}.`;
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
  if (hasModifier(s, 'twin_moons') && n % 3 === 0 && !w.blood && s.objective.type !== 'boss') {
    w.blood = true;
    const mult = BAL.waves.bloodMoonMult;
    for (const g of w.groups) {
      const base = g.units.filter((u) => u[1] !== 'warden');
      const add = Math.round(base.length * (mult - 1));
      for (let i = 0; i < add && base.length; i++) g.units.push([r.pick(base)[0], null]);
    }
    if (w.groups.length) {
      const big = w.groups.reduce((a, b) => (a.units.length >= b.units.length ? a : b));
      big.units.push([n >= 4 ? 'knight' : 'husk', 'warden']); big.warden = true;
    }
    pushMod(w, 'twin_moons', 'Twin Moons', 'The second moon rises red: a Blood Moon tonight. Its dawn pays double gold.');
  }
  if (hasModifier(s, 'haunted_woods')) {
    let k = 0;
    for (const g of w.groups) {
      const husks = g.units.filter(plain(['husk']));
      const want = Math.max(n < 3 ? 1 : 0, Math.round(husks.length * 0.25));
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
  const st = storytellerDef(s.storyteller);
  const n = w.n;
  if (s.objective && s.objective.type === 'boss') return [];
  // A replan of the same night (debug Blood Moon) keeps the same choice.
  let ids;
  if (d.tonight && d.tonight.n === n) ids = d.tonight.ids.slice();
  else {
    ids = [];
    const t = d.tension;
    const breathe = n > 1 && (d.lastCrisis === n - 1 || d.recentLoss >= DIRECTOR.heavyLoss);
    const hostileIds = Object.keys(WAVE_MODS).filter((id) => WAVE_MODS[id].hostile);
    const eligible = (id) => n >= WAVE_MODS[id].minNight && WAVE_MODS[id].ok(s, w) && !ids.includes(id);
    if (breathe && r.chance(st.breather) && WAVE_MODS.lull.ok(s, w)) ids.push('lull');
    else if (n >= st.minNight && n - d.lastCrisis > st.crisisCooldown) {
      let p = st.modifierChance * (0.4 + 1.2 * t / 100);
      if (w.blood && st.id !== 'jester') p *= 0.4;
      if (r.chance(p)) {
        const pool = hostileIds.filter(eligible);
        if (pool.length) ids.push(r.weighted(pool, (id) => WAVE_MODS[id].weight));
        if (ids.length && st.stack && r.chance(st.stack)) {
          const more = hostileIds.filter(eligible);
          if (more.length) ids.push(r.weighted(more, (id) => WAVE_MODS[id].weight));
        }
      }
    } else if (st.id === 'jester' && n > 1 && r.chance(0.12) && WAVE_MODS.lull.ok(s, w)) ids.push('lull'); // a sudden mercy
    d.tonight = { n, ids: ids.slice() };
    if (ids.some((id) => WAVE_MODS[id].hostile) || w.blood) d.lastCrisis = n;
    d.log.push({ n, ids: ids.slice(), tension: t, blood: !!w.blood });
    if (d.log.length > 40) d.log.shift();
  }
  const v = Math.max(0, Math.min(1, st.waveVariance * (st.id === 'jester' ? r.float(0.4, 1) : r.float(0.85, 1.1))));
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

// ---- Region events --------------------------------------------------------------------------------
function eventPool(s) {
  const d = directorState(s);
  return REGION_EVENTS.filter((e) => !d.eventsSeen.includes(e.id) && (!e.need || e.need(s)));
}

/** Weight of an event given tension (0..100), the storyteller and recent losses. */
export function eventWeight(s, e) {
  const d = directorState(s);
  const st = storytellerDef(s.storyteller);
  const t = d.tension / 100, b = st.toneBias;
  let w = e.weight || 1;
  if (e.tone === 'good') w *= (1 + (1 - t) * 1.5 * b) * st.goodBias;
  else if (e.tone === 'bad') {
    w *= 1 + t * 1.5 * b;
    if (d.recentLoss >= DIRECTOR.heavyLoss) w *= 1 - 0.6 * b;
    if (st.id === 'gentle') w *= 0.5;
  } else w *= 1.2;
  return Math.max(0.01, w);
}

/** Maybe raise a region event at daybreak. Returns the event id or null. */
export function rollRegionEvent(s) {
  const d = directorState(s);
  const st = storytellerDef(s.storyteller);
  const r = s.rt.rng;
  const day = s.cycle.night;
  let p = st.eventChance * (0.7 + 0.6 * d.tension / 100);
  if (d.lastEventDay === day - 1 && st.id !== 'jester') p *= DIRECTOR.eventSpacing;
  if (!r.chance(p)) return null;
  const pool = eventPool(s);
  if (!pool.length) return null;
  const e = r.weighted(pool, (x) => eventWeight(s, x));
  raiseEvent(s, e.id);
  return e.id;
}

/** Queue event id as a pending choice (the spawn point of any extra group is fixed now). */
export function raiseEvent(s, id) {
  const e = REGION_EVENT_BY_ID[id];
  if (!e) return false;
  const d = directorState(s);
  const sp = s.spawns.length ? s.rt.rng.int(0, s.spawns.length - 1) : 0;
  queuePending(s, { kind: 'regionEvent', id, options: e.choices.map((_, i) => i), sp, day: s.cycle.night });
  if (!d.eventsSeen.includes(id)) d.eventsSeen.push(id);
  d.lastEventDay = s.cycle.night;
  return true;
}

// ---- REGION effect language: describe and apply ------------------------------------------------------
const pct = (v) => `${v >= 1 ? '+' : '-'}${Math.round(Math.abs(v - 1) * 100)}%`;
const daysText = (n) => (n <= 1 ? 'today and tonight' : `for ${n} days and nights`);
const list = (x) => (x ? [].concat(x) : []);
function spawnCount(spec, s) { return Math.max(1, (spec.count || 1) + Math.floor((spec.perNight || 0) * s.cycle.night)); }
const SIDE_WORD = { N: 'north', S: 'south', E: 'east', W: 'west', battlefield: 'old battlefield', rift: 'Rift' };
export function sideWord(side) { return SIDE_WORD[side] || side || 'wilds'; }
function sideOf(s, spi) { const sp = s.spawns[(spi || 0) % Math.max(1, s.spawns.length)]; return sideWord(sp && sp.side); }

// Factions and decrees make morale drops and Dread gains stronger (common.js moodAdd):
// show and report the numbers the realm will really feel. Read-only (no lazy create).
function effMorale(s, v) { const m = s.ext && s.ext.mood; return Math.round(v < 0 ? v * ((m && m.dropMult) || 1) : v); }
function effDread(s, v) { const m = s.ext && s.ext.mood; return Math.round(v > 0 ? v * ((m && m.dreadMult) || 1) : v); }
const signed = (v) => `${v > 0 ? '+' : ''}${v}`;

/** Exact, player-facing parts of an effect (no flavour text). ctx = { sp } */
export function describeRegionEffect(eff, s, ctx = {}) {
  if (!eff) return [];
  const out = [];
  const r = eff.res || {};
  const gains = [], losses = [];
  for (const k of RES) if (r[k]) (r[k] > 0 ? gains : losses).push(`${r[k] > 0 ? '+' : ''}${r[k]} ${k}`);
  if (gains.length) out.push(gains.join(', '));
  if (losses.length) out.push(losses.join(', '));
  if (eff.morale) out.push(`Morale ${signed(effMorale(s, eff.morale))}`);
  if (eff.dread) out.push(`Dread ${signed(effDread(s, eff.dread))}`);
  if (eff.villagers > 0) out.push(`${eff.villagers} villager${eff.villagers > 1 ? 's' : ''} join${eff.villagers > 1 ? '' : 's'}`);
  if (eff.villagers < 0) out.push(`${-eff.villagers} villager${eff.villagers < -1 ? 's' : ''} die${eff.villagers < -1 ? '' : 's'}`);
  if (eff.repair) out.push(`Repairs every building by ${Math.round(eff.repair * 100)}% of its health`);
  if (eff.damage) out.push(`${eff.damage.building === 'house' ? 'A House' : 'A random building'} loses ${Math.round(eff.damage.amount * 100)}% of its health`);
  for (const sp of list(eff.spawnTonight)) {
    const k = spawnCount(sp, s);
    out.push(`Tonight: +${k} ${plural(sp.type, k)} from the ${sideOf(s, ctx.sp)}`);
  }
  for (const b of list(eff.buff)) out.push(`${BUFF_WORD[b.key] || b.key} ${pct(b.value)} ${daysText(b.days)}`);
  if (eff.reveal) out.push(`Reveals the land within ${eff.reveal} tiles of a spot beyond your borders`);
  return out;
}

const costText = (c) => `Costs ${RES.filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(', ')}`;
/** One line per choice for the event card: exact effects, odds and cost. */
export function describeChoice(c, s, ctx = {}) {
  const parts = [];
  if (c.cost && RES.some((k) => c.cost[k])) parts.push(costText(c.cost) + '.');
  if (c.chance != null) {
    const w = describeRegionEffect(c.win, s, ctx), l = describeRegionEffect(c.lose, s, ctx);
    parts.push(`Win: ${w.length ? w.join('; ') : 'nothing happens'}.`);
    parts.push(`Lose: ${l.length ? l.join('; ') : 'nothing happens'}.`);
  } else {
    const e = describeRegionEffect(c.eff, s, ctx);
    parts.push(e.length ? e.join('; ') + '.' : 'Nothing happens.');
  }
  return parts.join(' ');
}

/** Can the realm pay this choice? (only gold costs are hard requirements) */
export function canAffordChoice(s, c) { return !(c.cost && c.cost.gold && s.res.gold < c.cost.gold); }

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

/** Add a telegraphed group to tonight's wave. Returns the number of foes added. */
export function addTonightGroup(s, specs, spi, tag) {
  const w = s.wave;
  if (!w || !s.spawns.length) return 0;
  const sp = s.spawns[(spi || 0) % s.spawns.length];
  const units = [];
  for (const spec of list(specs)) for (let i = 0, k = spawnCount(spec, s); i < k; i++) units.push([spec.type, null]);
  if (!units.length) return 0;
  w.groups.push({ sp: { tx: sp.tx, ty: sp.ty, side: sp.side }, units, counts: {}, event: tag || true });
  if (s.cycle.phase === 'night') { // too late for dusk: they come a few seconds from now
    let t = s.cycle.t + 3;
    for (const [type, affix] of units) { s.spawnQueue.push({ t, type, affix, tx: sp.tx, ty: sp.ty }); t += BAL.waves.spawnInterval; }
    s.spawnQueue.sort((a, b) => a.t - b.t);
  }
  recount(w);
  return units.length;
}

function revealSomewhere(s, radius, r) {
  const h = s.rt.hearth;
  const hx = h ? h.tx + 1 : N / 2, hy = h ? h.ty + 1 : N / 2;
  let best = null;
  for (let k = 0; k < 12; k++) {
    const a = r.float(0, Math.PI * 2), dist = r.float(9, 15);
    const tx = Math.round(hx + Math.cos(a) * dist), ty = Math.round(hy + Math.sin(a) * dist);
    if (!inB(tx, ty)) continue;
    best = { tx, ty, a };
    if (!s.fog[idx(tx, ty)]) break;
  }
  if (!best) return '';
  revealAround(s, ctr(best.tx), ctr(best.ty), radius);
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const dir = dirs[Math.round(((Math.atan2(best.ty - hy, best.tx - hx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  return dir;
}

/** Apply a REGION effect. Returns the exact outcome lines. ctx = { sp, source } */
export function applyRegionEffect(s, eff, ctx = {}) {
  const lines = [];
  if (!eff) return lines;
  const r = s.rt.rng;
  const d = directorState(s);
  const res = eff.res || {};
  for (const k of RES) {
    const a = res[k];
    if (!a) continue;
    const before = s.res[k];
    s.res[k] = Math.max(0, s.res[k] + a);
    const got = Math.round(s.res[k] - before);
    if (got) lines.push(`${got > 0 ? '+' : ''}${got} ${k}`);
  }
  if (eff.morale || eff.dread) {
    const m0 = s.ext.mood ? s.ext.mood.morale : null, d0 = s.ext.mood ? s.ext.mood.dread : null;
    moodAdd(s, eff.morale || 0, eff.dread || 0, '');
    const m = s.ext.mood;
    // Report what really changed (multipliers and the 0..100 clamp included).
    const dm = m0 == null ? effMorale(s, eff.morale || 0) : Math.round(m.morale - m0);
    const dd = d0 == null ? effDread(s, eff.dread || 0) : Math.round(m.dread - d0);
    if (eff.morale) lines.push(`Morale ${dm ? signed(dm) : 'unchanged'}`);
    if (eff.dread) lines.push(`Dread ${dd ? signed(dd) : 'unchanged'}`);
  }
  if (eff.villagers > 0) {
    for (let i = 0; i < eff.villagers; i++) spawnVillager(s);
    lines.push(`${eff.villagers} villager${eff.villagers > 1 ? 's' : ''} joined`);
  } else if (eff.villagers < 0) {
    let k = 0;
    for (let i = 0; i < -eff.villagers; i++) {
      const alive = s.villagers.filter((v) => v.alive);
      if (alive.length <= 1) break;
      kill(s, r.pick(alive), null); k++;
    }
    if (k) lines.push(`${k} villager${k > 1 ? 's' : ''} died`);
  }
  if (eff.repair) {
    let k = 0;
    for (const b of s.buildings) if (b.built && b.alive && b.hp < b.maxHp) { b.hp = Math.min(b.maxHp, b.hp + b.maxHp * eff.repair); k++; }
    lines.push(k ? `${k} building${k > 1 ? 's' : ''} repaired` : 'Nothing needed repair');
  }
  if (eff.damage) {
    const b = pickBuilding(s, eff.damage.building, r);
    if (b) { const dmg = scorch(s, b, eff.damage.amount); lines.push(`Your ${bName(b)} lost ${Math.round(dmg)} health`); }
  }
  if (eff.spawnTonight) {
    const k = addTonightGroup(s, eff.spawnTonight, ctx.sp, ctx.source ? ctx.source.id : 'event');
    if (k) {
      const types = list(eff.spawnTonight).map((x) => plural(x.type, 2)).join(' and ');
      const text = `${k} ${types} come from the ${sideOf(s, ctx.sp)} tonight.`;
      pushMod(s.wave, 'ev_' + (ctx.source ? ctx.source.id : 'event'), ctx.source ? ctx.source.title : 'Omen', text);
      lines.push(`Tonight: +${k} foes from the ${sideOf(s, ctx.sp)}`);
    }
  }
  for (const b of list(eff.buff)) {
    d.buffs.push({ key: b.key, value: b.value, end: s.cycle.night + Math.max(1, b.days || 1), src: ctx.source ? ctx.source.id : '', name: ctx.source ? ctx.source.title : '' });
    bumpBuffs(s);
    lines.push(`${BUFF_WORD[b.key] || b.key} ${pct(b.value)} ${daysText(b.days)}`);
  }
  if (eff.reveal) {
    const dir = revealSomewhere(s, eff.reveal, r);
    if (dir) lines.push(`The land to the ${dir} is revealed`);
  }
  return lines;
}

/** Is an outcome on the whole kindly? (tone of the toast and result card) */
function isKindly(eff) {
  if (!eff) return true;
  if ((eff.dread || 0) > 0 || (eff.morale || 0) < 0 || eff.spawnTonight || eff.damage || eff.villagers < 0) return false;
  if (list(eff.buff).some((b) => b.value < 1)) return false;
  const r = eff.res || {};
  const gain = RES.some((k) => (r[k] || 0) > 0) || (eff.morale || 0) > 0 || (eff.dread || 0) < 0 || eff.villagers > 0 || eff.repair || eff.reveal || list(eff.buff).length;
  return !!gain || !RES.some((k) => (r[k] || 0) < 0);
}

/** BUS.choose.regionEvent */
export function chooseRegionEvent(s, i) {
  const p = s.pending;
  const ev = p && REGION_EVENT_BY_ID[p.id];
  const c = ev && ev.choices[i];
  if (!c) { if (p && !ev) s.pending = null; return { ok: !!(p && !ev) }; }
  if (!canAffordChoice(s, c)) return { ok: false, msg: 'Not enough gold.' };
  const ctx = { sp: p.sp, source: ev };
  const lines = [];
  if (c.cost) for (const k of RES) if (c.cost[k]) { const paid = Math.min(s.res[k], c.cost[k]); s.res[k] -= paid; if (paid) lines.push(`-${paid} ${k}`); }
  let eff = c.eff, won = null;
  if (c.chance != null) { won = s.rt.rng.chance(c.chance); eff = won ? c.win : c.lose; }
  lines.push(...applyRegionEffect(s, eff, ctx));
  const good = won !== null ? won : isKindly(eff);
  const d = directorState(s);
  d.last = { id: ev.id, i, won, title: ev.title, lines, text: (eff && eff.text) || '', good };
  s.pending = null;
  emit(s, { t: 'toast', text: `${ev.title}: ${lines.length ? lines.join(', ') : 'nothing changes'}.`, tone: good ? 'good' : 'bad', icon: ev.icon });
  return { ok: true, won, lines, text: (eff && eff.text) || '', good, title: ev.title };
}

/** Player-facing view of the pending region event (for showEventDialog). */
export function regionEventView(s, p = s.pending) {
  const ev = p && REGION_EVENT_BY_ID[p.id];
  if (!ev) return null;
  const ctx = { sp: p.sp };
  return {
    title: ev.title, text: ev.text, icon: ev.icon,
    choices: ev.choices.map((c) => ({ label: c.label, desc: describeChoice(c, s, ctx), chance: c.chance != null ? c.chance : undefined, disabled: !canAffordChoice(s, c) })),
  };
}

// ---- Buffs and omens (read-only helpers for the UI) ----------------------------------------------------
/** Active temporary buffs: [{ key, value, end, name, text }] */
export function activeBuffs(s) {
  const d = s.ext && s.ext.director;
  if (!d) return [];
  return d.buffs.map((b) => {
    const left = b.end - s.cycle.night;
    return { ...b, text: `${BUFF_WORD[b.key] || b.key} ${pct(b.value)}${b.name ? ' (' + b.name + ')' : ''}: ends at dawn ${b.end}${left > 1 ? `, in ${left} nights` : ''}` };
  });
}
/** Tonight's telegraphed modifiers [{ id, name, text }]. */
export function tonightOmens(s) { return (s.wave && s.wave.mods) || []; }
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
    if (hasModifier(s, 'twin_moons') && s.wave && s.wave.blood && DIRECTOR.bloodLoot) {
      const c = s.cycle;
      const gold = Math.round((BAL.dawnGold.base + BAL.dawnGold.perNight * c.night + (s.mods.dawnGold || 0)) * (1 + (s.mods.lootMult || 0)));
      s.res.gold += gold;
      emit(s, { t: 'toast', text: `Twin Moons: the Blood Moon leaves double loot, +${gold} gold.`, tone: 'good', icon: 'gold' });
    }
    if (hasModifier(s, 'dragon_shadow')) {
      const b = pickBuilding(s, 'random', s.rt.rng);
      if (b) {
        d.shadow = { bid: b.id, at: DIRECTOR.shadow.at, type: b.type };
        emit(s, { t: 'toast', text: `A wyvern circles overhead. At noon its shadow will scorch your ${bName(b)}.`, tone: 'bad', icon: 'wyrm' });
      }
    }
  } else if (phase === 'day') {
    // Tonight's director omen was chosen at the plan; announce it, then maybe an event.
    const mine = (s.wave && s.wave.mods || []).filter((m) => WAVE_MODS[m.id]);
    for (const m of mine) emit(s, { t: 'toast', text: `Omen for tonight: ${m.name}. ${m.text}`, tone: m.id === 'lull' ? 'good' : 'bad', icon: m.id === 'lull' ? 'sun' : 'moon' });
    rollRegionEvent(s);
  } else if (phase === 'dusk') {
    // Called the night before noon? The wyvern still passes, at sundown.
    if (d.shadow) shadowStrike(s, d);
    const mods = tonightOmens(s);
    if (mods.length) emit(s, { t: 'toast', text: `Omens tonight: ${mods.map((m) => m.name).join(', ')}. Tap the omen button for details.`, tone: 'bad', icon: 'moon' });
    if (hasModifier(s, 'haunted_woods')) moodAdd(s, 0, 3, '');
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

function onRemoved(s, b, destroyed) { if (destroyed) directorState(s).bLost++; }

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
  if (c.what === 'event') { if (!REGION_EVENT_BY_ID[c.id]) return { ok: false, msg: 'No such event' }; raiseEvent(s, c.id); return { ok: true }; }
  if (c.what === 'mod') {
    const M = WAVE_MODS[c.id];
    if (!M || !s.wave || s.cycle.phase === 'night') return { ok: false };
    if (!M.ok(s, s.wave)) return { ok: false, msg: 'Not possible tonight' };
    const text = M.apply(s, s.wave, storytellerDef(s.storyteller).waveVariance, s.rt.rng);
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
  BUS.choose.regionEvent = chooseRegionEvent;
  BUS.commands.directorDebug = cmdDirectorDebug;
  BUS.runMap.push(dressMapModifiers);
  BUS.runRegion.push(onRunRegion);
  BUS.mapNode.push(mapNodeLines);
  // Twin Moons: extra Blood Moons, for the moon countdown (see INTEGRATION in the report).
  BUS.query.extraBloodMoon = extraBloodMoon;
}

/** True when a region modifier makes night n a Blood Moon (Twin Moons: every 3rd night). */
export function extraBloodMoon(s, n) { return n > 0 && n % 3 === 0 && hasModifier(s, 'twin_moons') && !(s.objective && s.objective.type === 'boss'); }

export { STORYTELLERS, MODIFIERS, REGION_EVENTS };
