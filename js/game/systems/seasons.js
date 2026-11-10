// Seasons (Phase 3): a run-wide calendar of Spring > Summer > Autumn > Winter,
// two days each. The calendar lives in run.ext.calendar = { day }; a region
// starts on the run's current day (s.ext.season.day0) and the day advances at
// every dawn (day = day0 + s.cycle.night). Leaving a region advances the
// calendar by the region's nights + 1.
// Winter: hungrier people, idle farms, Houses burn wood for heat (morale falls
// when it runs out), the Hollow bite harder and friendly units outside the
// realm's territory fight at a loss. Autumn brings the harvest, Spring a little
// growth. Every number is in SEASONS below.
// Plugs in through BUS only (js/game/hooks.js). Deterministic: no Math.random.
import { BUS } from '../hooks.js';
import { ENEMIES } from '../../data/enemies.js';
import { emit, flowRes, moodAdd } from './common.js';

/** Tuning for the whole calendar. */
export const SEASONS = {
  order: ['spring', 'summer', 'autumn', 'winter'],
  daysPer: 2,            // days in each season
  spring: {
    name: 'Spring', color: '#7cc86a', icon: 'farm', farm: 1.10, short: 'New growth: farms +10%',
    text: 'Thaw and new growth: farms yield 10% more.',
  },
  summer: {
    name: 'Summer', color: '#f0c040', icon: 'sun', short: 'Long days. Beware the heat',
    text: 'Long, easy days. No special effects (heat waves can strike).',
  },
  autumn: {
    name: 'Autumn', color: '#d9773a', icon: 'farm', farm: 1.25, short: 'Harvest: farms +25%',
    text: 'Harvest time: farms yield 25% more. Stock food and wood for the winter.',
  },
  winter: {
    name: 'Winter', color: '#9cc8ee', icon: 'flame', short: 'Fields freeze, Houses burn wood, upkeep +50%',
    farm: 0,                 // frozen fields
    upkeep: 1.5,             // food upkeep +50%
    houseWoodPerMin: 1.2,    // each built House burns this much wood for heat
    coldEvery: 15,           // s between morale losses while the Houses are cold
    coldMorale: -3,          // morale per cold interval
    hollowFrost: 1.15,       // damage dealt by the Hollow
    outsideAttack: 0.75,     // friendly attack outside the realm's territory
    text: 'Food upkeep +50%, farms yield nothing, each House burns 1.2 wood a minute for heat (morale falls when the wood runs out), the Hollow deal 15% more damage and your units fight at 75% outside your territory.',
  },
  omen: 'Frost is coming: stock food and wood',
};

const FRIEND = { soldier: 1, hero: 1, sovereign: 1 };

// ---- State ---------------------------------------------------------------------------------
/** Run calendar (plain JSON in run.ext.calendar). */
export function calendar(run) {
  const ext = run.ext || (run.ext = {});
  return ext.calendar || (ext.calendar = { day: 0 });
}
/** Region season state (plain JSON in s.ext.season). */
export function seasonState(s) {
  const ext = s.ext || (s.ext = {});
  return ext.season || (ext.season = { day0: 0, cold: 0, coldWarned: false, ew: false });
}
/** Calendar day of the region right now (0-based, run-wide). */
export function calendarDay(s) {
  const x = s.ext && s.ext.season;
  return (x ? x.day0 : 0) + s.cycle.night;
}
/** True when a region modifier locks the realm in winter. */
export function isEndlessWinter(s) {
  const m = s.ext && s.ext.modifiers;
  if (m) return hasEndlessWinter(m);
  // Before the modifiers module has filled s.ext.modifiers (its regionInit may run after
  // ours), fall back to the copy taken from the node at region start.
  const x = s.ext && s.ext.season;
  return !!(x && x.ew);
}
/** Modifier list (ids or { id }) or flag object contains 'endless_winter'. */
function hasEndlessWinter(m) {
  if (!m) return false;
  if (Array.isArray(m)) {
    for (let i = 0; i < m.length; i++) { const v = m[i]; if (v === 'endless_winter' || (v && v.id === 'endless_winter')) return true; }
    return false;
  }
  return !!m.endless_winter;
}
/** Season index (0 spring .. 3 winter) of an absolute calendar day, for region s. */
export function seasonIndexForDay(s, day) {
  if (isEndlessWinter(s)) return 3;
  return Math.floor(Math.max(0, day) / SEASONS.daysPer) % 4;
}
/** Season index of today + offset days. */
export function seasonIndex(s, offset = 0) { return seasonIndexForDay(s, calendarDay(s) + offset); }
/** Season name of today + offset days: 'spring' | 'summer' | 'autumn' | 'winter'. */
export function seasonOf(s, offset = 0) { return SEASONS.order[seasonIndex(s, offset)]; }
/** Day within the current season (1-based) and the season's length. */
export function seasonDay(s) {
  const d = calendarDay(s);
  return { day: (d % SEASONS.daysPer) + 1, of: SEASONS.daysPer };
}
/** Days until the next season starts (1..daysPer); Infinity under endless winter. */
export function daysToNextSeason(s) {
  if (isEndlessWinter(s)) return Infinity;
  return SEASONS.daysPer - (calendarDay(s) % SEASONS.daysPer);
}

// ---- Effects ---------------------------------------------------------------------------------
function upkeepMult(s) { return seasonIndex(s) === 3 ? SEASONS.winter.upkeep : 1; }
function farmMult(s) {
  const def = SEASONS[SEASONS.order[seasonIndex(s)]];
  return def.farm !== undefined ? def.farm : 1;
}
function dmgMult(s, a, t, type) {
  if (!a || seasonIndex(s) !== 3) return 1;
  if (a.kind === 'enemy') {
    const def = ENEMIES[a.type];
    return def && def.tags && def.tags.indexOf('hollow') >= 0 ? SEASONS.winter.hollowFrost : 1;
  }
  if (FRIEND[a.kind] && !BUS.query.inTerritory(s, a.x, a.y)) return SEASONS.winter.outsideAttack;
  return 1;
}

/** Built Houses (cached in s.rt.ssnHouses; invalidated on build/removal). */
function houses(s) {
  let n = s.rt.ssnHouses;
  if (n === undefined) {
    n = 0;
    for (const b of s.buildings) if (b.alive && b.built && b.type === 'house') n++;
    s.rt.ssnHouses = n;
  }
  return n;
}
function invalidate(s) { if (s.rt) s.rt.ssnHouses = undefined; }

function onTick(s, dt) {
  if (seasonIndex(s) !== 3) return;
  const W = SEASONS.winter;
  const n = houses(s);
  if (!n) return;
  const x = seasonState(s);
  if (s.res.wood > 0.0001) {
    flowRes(s, 'wood', -(n * W.houseWoodPerMin / 60) * dt);
    x.cold = 0;
    if (s.res.wood > 5) x.coldWarned = false;
    return;
  }
  // Cold hearths: morale slips while the wood store is empty.
  if (!x.coldWarned) {
    x.coldWarned = true;
    emit(s, { t: 'toast', text: 'The Houses are cold! Morale falls until there is wood to burn.', tone: 'bad', icon: 'wood' });
  }
  x.cold += dt;
  if (x.cold >= W.coldEvery) { x.cold -= W.coldEvery; moodAdd(s, W.coldMorale, 0, 'Cold houses'); }
}

function onPhase(s, phase) {
  if (phase !== 'dawn' || isEndlessWinter(s)) return;
  const d = calendarDay(s);
  const now = seasonIndexForDay(s, d), prev = seasonIndexForDay(s, d - 1);
  if (now !== prev) {
    const key = SEASONS.order[now], def = SEASONS[key];
    emit(s, { t: 'season', season: key, name: def.name, text: def.text });
    emit(s, { t: 'toast', text: `${def.name} begins: ${def.short}.`, tone: now === 3 ? 'bad' : 'good', icon: def.icon });
  }
  if (now !== 3 && seasonIndexForDay(s, d + 1) === 3) emit(s, { t: 'toast', text: SEASONS.omen, tone: 'bad', icon: 'food' });
}

function onRegionInit(s, ctx) {
  const x = seasonState(s);
  x.day0 = ctx && ctx.run ? calendar(ctx.run).day : x.day0 || 0;
  // The modifiers module may run its regionInit after this one: read the node's list from ctx too.
  x.ew = hasEndlessWinter(ctx && ctx.extra && ctx.extra.modifiers) || hasEndlessWinter(ctx && ctx.node && ctx.node.modifiers);
  invalidate(s);
  if (seasonIndex(s) === 3) emit(s, { t: 'toast', text: `It is Winter. ${SEASONS.winter.text}`, tone: 'bad', icon: 'flame' });
  else if (!isEndlessWinter(s) && seasonIndex(s, 1) === 3) emit(s, { t: 'toast', text: SEASONS.omen, tone: 'bad', icon: 'food' });
}
function onRunNew(run) { calendar(run).day = 0; }
function onRunRegionEnd(run, s) { calendar(run).day += (s.cycle ? s.cycle.night : 0) + 1; }

/** Debug: jump the region to a calendar day (keeps the night count). */
function cmdSeasonDebug(s, c) {
  const day = Math.max(0, Math.floor(+c.day || 0));
  seasonState(s).day0 = day - s.cycle.night;
  return { ok: true };
}

// ---- Registration --------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  BUS.query.season = (s) => SEASONS.order[seasonIndex(s)];
  BUS.runNew.push(onRunNew);
  BUS.runRegionEnd.push(onRunRegionEnd);
  BUS.regionInit.push(onRegionInit);
  BUS.tick.push(onTick);
  BUS.phase.push(onPhase);
  BUS.built.push(invalidate);
  BUS.removed.push(invalidate);
  BUS.upkeepMult.push(upkeepMult);
  BUS.farmMult.push(farmMult);
  BUS.dmgMult.push(dmgMult);
  BUS.commands.seasonDebug = cmdSeasonDebug;
}
