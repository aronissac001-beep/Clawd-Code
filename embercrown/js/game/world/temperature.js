// Temperature (owner B; doc 3.6, 12.3, 13.3). Stage 1b: the simple model with constant seasons.
// Stage 2: the weather offset (weather.js: cold snap -15 C, rain -2, drought +4) and the ice house.
//
//   Outdoor base: the season's constant (Thaw 10, Highsun 22, Ashfall 8, Deepcold -6 C) plus -4 C at
//   night, plus the weather offset. Under a rock roof (roof 2 or 3) the base blends toward 12 C,
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

import { W, H, N, ROOF } from '../core/grid.js';
import { seasonOf, phaseOf } from '../core/time.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick, registerSystem, tickSystems } from '../core/bus.js';
import { structDef, sizeOf } from './defs.js';
import { occRebuild, walkRebuild, depthRebuild } from './pass.js';
import { roomsBuild } from './rooms.js';
import { isBurning } from './fuel.js';
import { weatherOffset } from './weather.js';
import { TEMP as BAL } from '../../data/balance.js';

/** Tuning: read from js/data/balance.js TEMP (G's numbers), with the doc values as the fallback. */
const B = BAL || {};
export const TEMP = Object.freeze({
  SEASON: Object.freeze((B.season || [10, 22, 8, -6]).slice()), NIGHT: B.night ?? -4, UNDER: B.under ?? 12, UNDER_DEPTH: B.underDepth ?? 5,
  MIN: B.min ?? -30, MAX: B.max ?? 45, ROOM_MIN_TILES: 6, OUT_DIV: 20, OUT_R: B.heatRadius ?? 3, HEARTH_OUT_R: B.hearthHeatRadius ?? 6,
});

/** Ice house tuning (3.6). */
export const ICE = Object.freeze({ def: 'icehouse', depth: 8, under: -2, stocked: -5, item: 'ice' });

/** Outdoor base temperature (C) at a tick; with the colony state `s`, the weather offset too. */
export function outdoorTemp(tick, s = null) {
  return TEMP.SEASON[seasonOf(tick)] + (phaseOf(tick) === 'night' ? TEMP.NIGHT : 0) + (s ? weatherOffset(s, tick) : 0);
}
/** Base temperature of tile i (C, integer) with a given depth map. */
export function baseTemp(s, i, depth = s.rt.depth, out = outdoorTemp(s.tick, s)) {
  const r = s.L.roof[i];
  if (r !== ROOF.THIN && r !== ROOF.MOUNTAIN) return out;
  const d = depth[i];
  if (d >= TEMP.UNDER_DEPTH) return TEMP.UNDER;
  return out + Math.trunc(((TEMP.UNDER - out) * d) / TEMP.UNDER_DEPTH);
}
const clampT = (v) => (v < TEMP.MIN ? TEMP.MIN : v > TEMP.MAX ? TEMP.MAX : v);

/** Burning heat sources: [{ b, heat, cx, cy, r }] in id order. */
export function heatSources(s) {
  const out = [];
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const d = structDef(b.def);
    if (!d || !(d.heat > 0) || !isBurning(s, b)) continue;
    const [w, h] = sizeOf(d, b.rot | 0);
    out.push({ b, heat: d.heat | 0, cx: b.x + (w >> 1), cy: b.y + (h >> 1), r: b.def === 'hearth' ? TEMP.HEARTH_OUT_R : TEMP.OUT_R });
  }
  return out;
}

/** { roomTemp, heat } from the given room labels (a pure function of saved state and s.tick). */
export function tempBuild(s, room, rooms, depth = s.rt.depth) {
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

/** From scratch (C13 rebuild): rooms and depth rebuilt from saved state too. */
export function tempRebuild(s) {
  const occ = occRebuild(s), r = roomsBuild(s, occ, walkRebuild(s, occ));
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
