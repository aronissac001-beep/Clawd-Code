// Seasons and weather (owner B; doc 2.2, 3.6, 9.7; data js/data/worldgen.js WORLD.weather; Stage 2).
//
//   Seasons come from the calendar (core/time.js seasonOf: Thaw, Highsun, Ashfall, Deepcold, 10 days
//   each). Weather is one saved record, s.colony.world.weather = { kind, since, until, day }:
//     clear | rain | snow (rain in Deepcold) | coldsnap | drought
//   Natural weather is rolled once a day at 06:00 from a hash of the colony seed and the day (no RNG
//   stream is advanced, so adding weather never shifts another system's rolls): cold snaps (Ashfall,
//   Deepcold, 2-4 days), droughts (Highsun, 3-6 days), else rain or snow for 4-14 hours, else clear.
//   A running cold snap or drought is never replaced by the daily roll. H's disasters force weather
//   with setWeather(s, kind, hours) (cold snap, drought; 9.7).
//
//   Effects (read by the systems that own them):
//     weatherOffset(s)      degrees added to the outdoor base (temperature.js; cold snap -15)
//     growthPct(s)          growth on open sky (plants.js; rain 125, drought 40)
//     skyCap(s)             daylight level cap (light.js; overcast 2)
//     fireOutPermille(s), spreadPct(s)   fire.js (rain puts outdoor flames out; drought spreads them)
//   Changes set the temperature and light dirty flags in the same call (C13: rt.roomTemp, rt.heat and
//   rt.light are pure functions of the saved weather record and s.tick).
//
//   Frozen water: on the first tick of Deepcold every open-sky shallow-water tile freezes to ice (cavern
//   pools under the mountain stay liquid at 12 C); on the first
//   tick of Thaw every ice tile thaws (terrain.setTerrain, so walk costs and regions follow). The
//   record keeps the season index it froze for, so a save in Deepcold does not freeze twice.

import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_YEAR, DAYS_PER_SEASON, dayOf, hourOf, seasonOf } from '../core/time.js';
import { N, TER, ROOF } from '../core/grid.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { WORLD } from '../../data/worldgen.js';
import { worldRec, ensureWorld, worldStage2, hash3, emitIf } from './worldrec.js';

const WX = WORLD.weather;
export const WEATHER_KINDS = Object.freeze(Object.keys(WX.kinds));
export const WEATHER_NAMES = Object.freeze({ clear: 'Clear', rain: 'Rain', snow: 'Snow', coldsnap: 'Cold snap', drought: 'Drought' });
const ROLL_HOUR = 6;

/** The weather in force now ('clear' once a spell has run out, or before Stage 2). */
export function weatherKind(s, tick = s.tick) {
  if (!worldStage2()) return 'clear';
  const w = worldRec(s).weather;
  return w.kind !== 'clear' && tick < w.until ? w.kind : 'clear';
}
const kindDef = (s) => WX.kinds[weatherKind(s)] || WX.kinds.clear;
export const weatherOffset = (s, tick = s.tick) => (WX.kinds[weatherKind(s, tick)] || WX.kinds.clear).offset | 0;
export const growthPct = (s) => kindDef(s).growthPct;
export const skyCap = (s) => kindDef(s).light;
export const fireOutPermille = (s) => kindDef(s).fireOut;
export const spreadPct = (s) => kindDef(s).spreadPct;
export const raining = (s) => { const k = weatherKind(s); return k === 'rain' || k === 'snow'; };
/** Hours left of the current spell (0 when clear). */
export function weatherHoursLeft(s) {
  const w = worldRec(s).weather;
  return weatherKind(s) === 'clear' ? 0 : Math.ceil((w.until - s.tick) / TICKS_PER_HOUR);
}
/** UI line: "Cold snap, 31 h left" / "Clear". */
export function weatherText(s) {
  const k = weatherKind(s);
  return k === 'clear' ? WEATHER_NAMES.clear : `${WEATHER_NAMES[k]}, ${weatherHoursLeft(s)} h left`;
}

/**
 * Force a weather spell (H's disasters, tests). Sets the temperature and light flags.
 * @returns {object} the weather record
 */
export function setWeather(s, kind, hours) {
  if (!(kind in WX.kinds)) throw new Error(`weather: unknown kind ${kind}`);
  const w = ensureWorld(s).weather;
  const before = weatherKind(s);
  w.kind = kind; w.since = s.tick; w.until = kind === 'clear' ? s.tick : s.tick + Math.max(1, hours | 0) * TICKS_PER_HOUR;
  if (before !== weatherKind(s)) { s.rt.dirty.temperature = true; s.rt.dirty.light = true; }
  return w;
}

/** The natural roll for a day: { kind, hours } (a pure function of the seed and the day). */
export function rollWeather(seed, day) {
  const season = Math.floor(day / DAYS_PER_SEASON) % 4;
  const r = (salt) => hash3(seed, day, salt) % 100;
  const span = (lo, hi, salt) => lo + (hash3(seed, day, salt) % (hi - lo + 1));
  if (r(1) < WX.coldSnapPct[season]) return { kind: 'coldsnap', hours: 24 * span(WX.coldSnapD[0], WX.coldSnapD[1], 11) };
  if (r(2) < WX.droughtPct[season]) return { kind: 'drought', hours: 24 * span(WX.droughtD[0], WX.droughtD[1], 12) };
  if (r(3) < WX.rainPct[season]) return { kind: season === 3 ? 'snow' : 'rain', hours: span(WX.rainH[0], WX.rainH[1], 13) };
  return { kind: 'clear', hours: 0 };
}

/** Tick system (slot 'weather'): the daily roll, spell ends (flags), frozen water at the season turn. */
export function weatherSystem(s) {
  if (!worldStage2()) return;
  const w = ensureWorld(s);
  const wx = w.weather;
  // a spell ending this tick changes the temperature and the daylight
  if (wx.kind !== 'clear' && s.tick === wx.until) { s.rt.dirty.temperature = true; s.rt.dirty.light = true; }
  const day = dayOf(s.tick);
  if (hourOf(s.tick) === ROLL_HOUR && s.tick % TICKS_PER_HOUR === 0 && wx.day !== day) {
    wx.day = day;
    const cur = weatherKind(s);
    if (cur !== 'coldsnap' && cur !== 'drought') {
      const roll = rollWeather(s.seed >>> 0, day);
      if (roll.kind !== 'clear' || cur !== 'clear') setWeather(s, roll.kind, roll.hours);
    }
  }
  if (s.tick % TICKS_PER_DAY === 0) freezeWater(s);
  // dry lightning in a drought: once a day at 15:00 a hashed chance to set a mature tree alight far
  // from the Hearth (9.7: wildfire)
  if (weatherKind(s) === 'drought' && s.tick % TICKS_PER_DAY === 15 * TICKS_PER_HOUR && lightningFn && hash3(s.seed >>> 0, day, 0x11) % 100 < WX.lightningPct) {
    const h = s.colony.hearth, hb = h && h.id !== null ? s.bld[h.id] : null;
    for (let k = 0; k < 40; k++) {
      const i = hash3(s.seed >>> 0, day, 0x20 + k) % N;
      if (s.L.plant[i] && s.L.growth[i] === 255 && s.L.roof[i] === ROOF.OPEN && (!hb || Math.max(Math.abs((i % s.w) - hb.x), Math.abs(((i / s.w) | 0) - hb.y)) > WX.lightningFar) && lightningFn(s, i)) break;
    }
  }
}
let lightningFn = null;
/** terrain.js hands fire.ignite over (avoids an import cycle). */
export function bindLightning(fn) { lightningFn = fn; }

let setTerrainFn = null;
/** terrain.js hands its setTerrain over (avoids an import cycle). */
export function bindWeatherTerrain(fn) { setTerrainFn = fn; }

/** Season index since the colony began (year * 4 + season), the key of the frozen record. */
const seasonIndex = (tick) => Math.floor(dayOf(tick) / DAYS_PER_YEAR) * 4 + seasonOf(tick);
/** Freeze shallow water in the freeze season and thaw it at Thaw (once per season). Returns tiles changed. */
export function freezeWater(s) {
  if (!worldStage2() || !setTerrainFn) return 0;
  const w = ensureWorld(s), season = seasonOf(s.tick), key = seasonIndex(s.tick);
  let n = 0;
  if (season === WX.freezeSeason) {
    if (w.frozen === key) return 0;
    w.frozen = key;
    for (let i = 0; i < N; i++) if (s.L.terrain[i] === TER.SHALLOW && s.L.roof[i] === ROOF.OPEN) { setTerrainFn(s, i, TER.ICE); n++; }
  } else if (season === 0 && w.frozen >= 0 && w.frozen !== -2) {
    w.frozen = -2;   // thawed
    for (let i = 0; i < N; i++) if (s.L.terrain[i] === TER.ICE) { setTerrainFn(s, i, TER.SHALLOW); n++; }
  }
  if (n) emitIf(s, 'season', { season, frozen: season === WX.freezeSeason, tiles: n });
  return n;
}

export function installWeather() {
  if (!tickSystems().some((x) => x.slot === 'weather' && x.name === 'weather')) registerSystem('weather', 'weather', weatherSystem, -10);
}
