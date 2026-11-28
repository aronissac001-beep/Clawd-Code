// Temperature (owner B; doc 3.6, 12.3, 13.3). Stage 1b: the simple model with constant seasons.
// Stage 2: the weather offset (weather.js: cold snap -15 C, rain -2, drought +4) and the ice house.
//
//   Outdoor base: the season's constant (Thaw 10, Highsun 22, Ashfall 8, Deepcold -6 C) plus -4 C at
//   night, plus the weather offset. W2.4 (EMBERCROWN-WORLD.md 6.2): the season constant is the hold's climate,
//   weather.seasonBase: a realm hold's season points eased by day (the base can change at midnight, also a
//   multiple of 600 ticks); a realm-less hold's greenvale row, which is the table above exactly. Under a rock roof (roof 2 or 3) the base blends toward 12 C,
//   reaching it at depth 5 (so a cold snap barely reaches a hold dug deep).
//   Ice house (3.6, 7.4): a room holding a finished ice house is held at ICE.under (-2 C) when the
//   room lies at depth >= ICE.depth (8) underground. (Stocked with ice it would hold ICE.stocked, -5 C,
//   anywhere: that needs G's ice item and an item-moved hook from E so the cache stays exact, C13.)
//   Heat sources in the room still count.
//   Cellars are rooms like any other: dug at depth 5+ they sit at a steady 12 C (good for casks).
//   Rooms: rt.roomTemp[id] = the base of the room's majority tile + the heat of the burning heat
//   sources standing in it / max(room tiles, 6), clamped to -30..45 C (a brazier gives 60 C x tiles,
//   so it warms a 10-tile room by 6 C; the Hearth 600).
//   Outdoors: rt.heat (Int8) adds heat / 20 within Chebyshev radius 3 (the Hearth: 6) of every
//   burning heat source that stands outdoors (room 0), on outdoor tiles only.
//   A heat source burns when it is finished and, if it needs fuel, has some (fuel.js).
//
//   Updates (C13, end-of-tick): the endOfTick 'temperature' pass recomputes rt.roomTemp and rt.heat
//   when rt.dirty.temperature is set: by the terrain API (roofs, walls, rock), by the rooms pass, by
//   a heat source finishing, going cold or being refuelled, and by tempBaseSystem on every tick where
//   the outdoor base changes (the hour a night starts or ends and the season turn: always a multiple
//   of 600 ticks). So both caches always equal tempRebuild(s) of the saved state.
//   Read it through terrain.tempAt(s, i).
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.6). At D > 1 the base of a voxel reads its cover and its
// band (js/data/levels.js): cover 0 (open sky) is outdoor; cover 1 / 2 / 3+ blends outdoor toward the band's
// temperature at 1/3 / 2/3 / full (12 C in the soil and stone bands, 11 / 10 C in Caverns I / II, 8 C in the
// Underdeep, 38 C in the ember layer, 2 C in the Hollow Reach, -10 C in the Hollow). Rooms keep their
// majority base. rt.heat spreads within Chebyshev r on the source's own level and 1 level up through open
// air (heat rises); ember pools are heat sources (FLUID.emberHeat per voxel, radius 1). The ice house holds
// at cover >= 3 and 6 levels or more below the surface. Values clamp to TEMP3 (-30..70 C) so Sweltering
// (above 35 / 45 C) and Heatstroke (above 50 C) can read them.
//   levelBand(z) is the C5 v3 read of the band row of a level.

import { W, H, N, D, PLANE, zS, ROOF, TER } from '../core/grid.js';
import { bandOfRel, TEMP3, FLUID } from '../../data/levels.js';
import { coverRebuild } from './vertical.js';
import { emberVoxels } from './pass.js';
import { phaseOf } from '../core/time.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick, registerSystem, tickSystems } from '../core/bus.js';
import { structDef, sizeOf } from './defs.js';
import { occRebuild, walkRebuild, depthRebuild } from './pass.js';
import { roomsBuild } from './rooms.js';
import { isBurning } from './fuel.js';
import { weatherOffset, seasonBase } from './weather.js';
import { TEMP as BAL } from '../../data/balance.js';

/** Tuning: read from js/data/balance.js TEMP (G's numbers), with the doc values as the fallback. */
const B = BAL || {};
export const TEMP = Object.freeze({
  SEASON: Object.freeze((B.season || [10, 22, 8, -6]).slice()), NIGHT: B.night ?? -4, UNDER: B.under ?? 12, UNDER_DEPTH: B.underDepth ?? 5,
  MIN: B.min ?? -30, MAX: B.max ?? 45, ROOM_MIN_TILES: 6, OUT_DIV: 20, OUT_R: B.heatRadius ?? 3, HEARTH_OUT_R: B.hearthHeatRadius ?? 6,
});

/** Ice house tuning (3.6). */
export const ICE = Object.freeze({ def: 'icehouse', depth: 8, under: -2, stocked: -5, item: 'ice' });

/**
 * Outdoor base temperature (C) at a tick: the hold's climate (weather.seasonBase: the realm embark climate, or the
 * greenvale row, which is TEMP.SEASON exactly), the night, and with the colony state `s` the weather offset too.
 */
export function outdoorTemp(tick, s = null) {
  return seasonBase(s, tick) + (phaseOf(tick) === 'night' ? TEMP.NIGHT : 0) + (s ? weatherOffset(s, tick) : 0);
}
/** The band row of level z (C5 v3 levelBand). */
export const levelBand = (z) => bandOfRel(z - zS);
/** The cover array for the D > 1 base: the live cache when it exists, else a rebuild. */
const coverOf = (s) => (s.rt && s.rt.cover && s.rt.cover.length === N ? s.rt.cover : coverRebuild(s));
/** D > 1 base of voxel i with a given cover array (2.6 table). */
export function baseTemp3(s, i, cover, out = outdoorTemp(s.tick, s)) {
  const c = cover[i];
  if (c === 0) return out;
  const t = bandOfRel(((i / PLANE) | 0) - zS).temp;
  if (c >= 3) return t;
  return out + Math.trunc(((t - out) * c) / 3);
}
/** Base temperature of tile i (C, integer) with a given depth map (D > 1: by cover and band; `depth` is then a cover array or ignored). */
export function baseTemp(s, i, depth = s.rt.depth, out = outdoorTemp(s.tick, s)) {
  if (D > 1) return baseTemp3(s, i, depth && depth.isCover ? depth : coverOf(s), out);
  const r = s.L.roof[i];
  if (r !== ROOF.THIN && r !== ROOF.MOUNTAIN) return out;
  const d = depth[i];
  if (d >= TEMP.UNDER_DEPTH) return TEMP.UNDER;
  return out + Math.trunc(((TEMP.UNDER - out) * d) / TEMP.UNDER_DEPTH);
}
const clampT = (v) => (D > 1 ? (v < TEMP3.min ? TEMP3.min : v > TEMP3.max ? TEMP3.max : v) : v < TEMP.MIN ? TEMP.MIN : v > TEMP.MAX ? TEMP.MAX : v);
/** The clamp of the current map (TEMP at D = 1, TEMP3 at D > 1). */
export const tempLimits = () => (D > 1 ? { min: TEMP3.min, max: TEMP3.max } : { min: TEMP.MIN, max: TEMP.MAX });

/** Burning heat sources: [{ b, heat, cx, cy, r }] in id order. */
export function heatSources(s) {
  const out = [];
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const d = structDef(b.def);
    if (!d || !(d.heat > 0) || !isBurning(s, b)) continue;
    const [w, h] = sizeOf(d, b.rot | 0);
    out.push({ b, heat: d.heat | 0, cx: b.x + (w >> 1), cy: b.y + (h >> 1), r: b.def === 'hearth' ? TEMP.HEARTH_OUT_R : TEMP.OUT_R, z: b.z | 0 });
  }
  // D > 1: every ember-pool voxel is a heat source (2.6), in voxel order
  const fl = s.L.fluid;
  if (D > 1 && fl) for (const i of emberVoxels(s)) out.push({ b: null, heat: FLUID.emberHeat, cx: i % W, cy: ((i % PLANE) / W) | 0, r: 1, z: (i / PLANE) | 0 });
  return out;
}

/** { roomTemp, heat } from the given room labels (a pure function of saved state and s.tick). */
export function tempBuild(s, room, rooms, depth = s.rt.depth) {
  if (D > 1) return tempBuild3(s, room, rooms, depth && depth.isCover ? depth : coverOf(s));
  const out = outdoorTemp(s.tick, s);
  const roomTemp = new Array(rooms.length).fill(null);
  const heat = new Int8Array(N);
  // majority base per room: count base values over the room's bounding box
  for (let id = 1; id < rooms.length; id++) {
    const r = rooms[id];
    if (!r) continue;
    const count = new Map();
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = y * W + x;
      if (room[i] !== id) continue;
      const v = baseTemp(s, i, depth, out);
      count.set(v, (count.get(v) || 0) + 1);
    }
    let best = out, bn = -1;
    for (const [v, n] of count) if (n > bn || (n === bn && v < best)) { best = v; bn = n; }
    roomTemp[id] = best;
  }
  const sum = new Array(rooms.length).fill(0);
  for (const src of heatSources(s)) {
    const ci = src.cy * W + src.cx;
    const id = src.cx >= 0 && src.cy >= 0 && src.cx < W && src.cy < H ? room[ci] : 0;
    if (id > 0 && rooms[id]) { sum[id] += src.heat; continue; }
    const add = Math.trunc(src.heat / TEMP.OUT_DIV);
    if (!add) continue;
    for (let y = Math.max(0, src.cy - src.r); y <= Math.min(H - 1, src.cy + src.r); y++) {
      for (let x = Math.max(0, src.cx - src.r); x <= Math.min(W - 1, src.cx + src.r); x++) {
        const i = y * W + x;
        if (room[i]) continue;
        const v = heat[i] + add;
        heat[i] = v > 127 ? 127 : v;
      }
    }
  }
  const ice = iceRooms(s, room, rooms, depth);
  for (let id = 1; id < rooms.length; id++) {
    if (roomTemp[id] === null) continue;
    const base = ice[id] !== undefined ? ice[id] : roomTemp[id];
    roomTemp[id] = clampT(base + Math.trunc(sum[id] / Math.max(rooms[id].n, TEMP.ROOM_MIN_TILES)));
  }
  return { roomTemp, heat };
}

/** Room id -> held base temperature for rooms with a finished ice house (sparse object, read by id). */
function iceRooms(s, room, rooms, depth) {
  const out = {};
  for (const b of s.bld) {
    if (!b || b.st !== 'done' || b.def !== ICE.def) continue;
    const i = b.y * W + b.x, id = room[i];
    if (!id || !rooms[id]) continue;
    const r = rooms[id];
    let minDepth = 255;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const j = y * W + x;
      if (room[j] !== id) continue;
      const rf = s.L.roof[j];
      const d = rf === ROOF.THIN || rf === ROOF.MOUNTAIN ? depth[j] : 0;
      if (d < minDepth) minDepth = d;
    }
    const v = minDepth >= ICE.depth ? ICE.under : null;
    if (v !== null && (out[id] === undefined || v < out[id])) out[id] = v;
  }
  return out;
}

// ---- Levels (D > 1) ----------------------------------------------------------------------------------------
function tempBuild3(s, room, rooms, cover) {
  const out = outdoorTemp(s.tick, s);
  const roomTemp = new Array(rooms.length).fill(null);
  const heat = new Int8Array(N), ter = s.L.terrain;
  for (let id = 1; id < rooms.length; id++) {
    const r = rooms[id];
    if (!r) continue;
    const b0 = (r.z | 0) * PLANE, count = new Map();
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = b0 + y * W + x;
      if (room[i] !== id) continue;
      const v = baseTemp3(s, i, cover, out);
      count.set(v, (count.get(v) || 0) + 1);
    }
    let best = out, bn = -1;
    for (const [v, n] of count) if (n > bn || (n === bn && v < best)) { best = v; bn = n; }
    roomTemp[id] = best;
  }
  const sum = new Array(rooms.length).fill(0);
  const addHeat = (i, add) => { const v = heat[i] + add; heat[i] = v > 127 ? 127 : v; };
  for (const src of heatSources(s)) {
    const b0 = Math.max(0, Math.min(D - 1, src.z)) * PLANE;
    const inMap = src.cx >= 0 && src.cy >= 0 && src.cx < W && src.cy < H;
    const id = inMap ? room[b0 + src.cy * W + src.cx] : 0;
    if (id > 0 && rooms[id]) { sum[id] += src.heat; continue; }
    const add = Math.trunc(src.heat / TEMP.OUT_DIV);
    if (!add) continue;
    for (let y = Math.max(0, src.cy - src.r); y <= Math.min(H - 1, src.cy + src.r); y++) {
      for (let x = Math.max(0, src.cx - src.r); x <= Math.min(W - 1, src.cx + src.r); x++) {
        const i = b0 + y * W + x;
        if (room[i]) continue;
        addHeat(i, add);
        // heat rises one level through open air
        const u = i + PLANE;
        if (u < N && (ter[u] === TER.AIR || ter[u] === TER.RAMP_TOP) && !room[u]) addHeat(u, add);
      }
    }
  }
  const ice = iceRooms3(s, room, rooms, cover);
  for (let id = 1; id < rooms.length; id++) {
    if (roomTemp[id] === null) continue;
    const base = ice[id] !== undefined ? ice[id] : roomTemp[id];
    roomTemp[id] = clampT(base + Math.trunc(sum[id] / Math.max(rooms[id].n, TEMP.ROOM_MIN_TILES)));
  }
  return { roomTemp, heat };
}
function iceRooms3(s, room, rooms, cover) {
  const out = {};
  for (const b of s.bld) {
    if (!b || b.st !== 'done' || b.def !== ICE.def) continue;
    const z = b.z | 0, i = z * PLANE + b.y * W + b.x, id = room[i];
    if (!id || !rooms[id] || z - zS > TEMP3.iceRel) continue;
    const r = rooms[id], b0 = (r.z | 0) * PLANE;
    let minCover = 3;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const j = b0 + y * W + x; if (room[j] === id && cover[j] < minCover) minCover = cover[j]; }
    if (minCover >= 3 && (out[id] === undefined || ICE.under < out[id])) out[id] = ICE.under;
  }
  return out;
}

/** From scratch (C13 rebuild): rooms and depth rebuilt from saved state too. */
export function tempRebuild(s) {
  const occ = occRebuild(s), r = roomsBuild(s, occ, walkRebuild(s, occ));
  if (D > 1) return tempBuild3(s, r.room, r.rooms, coverRebuild(s));
  return tempBuild(s, r.room, r.rooms, depthRebuild(s));
}

/** The endOfTick 'temperature' pass. */
export function temperaturePass(s) {
  const t = tempBuild(s, s.rt.room, s.rt.rooms);
  s.rt.roomTemp = t.roomTemp;
  s.rt.heat = t.heat;
}

/** Sets the temperature flag on every tick where the outdoor base changes (night, season). */
export function tempBaseSystem(s) {
  if (s.tick > 0 && outdoorTemp(s.tick, s) !== outdoorTemp(s.tick - 1, s)) s.rt.dirty.temperature = true;
}

/** Room temperature by id (C), or null for outdoors. */
export const roomTempOf = (s, id) => (id > 0 && s.rt.roomTemp[id] !== undefined ? s.rt.roomTemp[id] : null);

export function installTemperature() {
  registerRebuild('roomTemp', (s) => tempRebuild(s).roomTemp);
  registerRebuild('heat', (s) => tempRebuild(s).heat);
  registerEndOfTick('temperature', (s) => temperaturePass(s));
  if (!tickSystems().some((x) => x.slot === 'weather' && x.name === 'temp-base')) registerSystem('weather', 'temp-base', tempBaseSystem, 0);
}
