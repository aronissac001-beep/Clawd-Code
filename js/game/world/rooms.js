// Rooms (owner B; doc 7.11, 12.3, 13.3). Stage 1a: detection, ids and basic stats; room roles,
// beauty, value and tiers come with G's rooms.js data in Stage 1b / 2.
//
//   A room is a 4-connected area of tiles bounded by room walls: rock and rubble, built walls and
//   doors (anything opaque, and every door). Doors belong to no room (they join two rooms).
//   An area is OUTDOORS (room 0) when it touches the map edge or is bigger than ROOM.maxTiles.
//   Everything else is a room.
//   Rooms auto-roof (7.3): in the rooms pass, the open-sky tiles of a room whose bounds include a
//   built wall or door get a built roof (roof 1) when a support lies within ROOM.roofReach (6). The
//   roof write goes through terrain.setRoof (light, temperature and render follow in the same
//   endOfTick: light runs after rooms), then the room records are built from the roofed state, so
//   a rebuild from saved state always equals the live caches (C13).
//   rt.room   Uint16 per tile: room id (0 outdoors or a wall)
//   rt.rooms  [null, { id, n, x0, y0, x1, y1, first, doors, under, roofed }] by id; ids are
//             canonical: rooms are numbered in the order of their first tile in an index scan, so a
//             rebuild from saved state always gives the same ids (C13).
//   The endOfTick 'rooms' pass rebuilds both when rt.dirty.rooms is set (walls, doors, rock or roofs
//   changed). A full rebuild is about 0.3 ms at 128 x 128 (under the 1 ms budget), and exact.

import { W, H, N, ROOF } from '../core/grid.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick } from '../core/bus.js';
import { isOpaque, WALK_DOOR, occRebuild, walkRebuild } from './pass.js';

export const ROOM = Object.freeze({ maxTiles: 600, roofReach: 6 });

/** Room walls: opaque tiles and doors. */
function wallMask(s, occ, walk) {
  const m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = walk[i] === WALK_DOOR || isOpaque(s, i, occ) ? 1 : 0;
  return m;
}

/** { room, rooms } from scratch. occ and walk default to the live caches (the pass) or rebuilt ones. */
export function roomsBuild(s, occ = s.rt.occ, walk = s.rt.walkCost) {
  const wall = wallMask(s, occ, walk);
  const room = new Uint16Array(N), seen = new Uint8Array(N), q = new Int32Array(N);
  const rooms = [null];
  const L = s.L;
  for (let start = 0; start < N; start++) {
    if (wall[start] || seen[start]) continue;
    let h = 0, t = 0, edge = false, sky = 0, under = 0;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    q[t++] = start; seen[start] = 1;
    while (h < t) {
      const c = q[h++], x = c % W, y = (c / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      const r = L.roof[c];
      if (r === ROOF.OPEN) sky++; else if (r !== ROOF.BUILT) under++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !wall[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; q[t++] = c - 1; }
      if (x < W - 1 && !wall[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; q[t++] = c + 1; }
      if (y > 0 && !wall[c - W] && !seen[c - W]) { seen[c - W] = 1; q[t++] = c - W; }
      if (y < H - 1 && !wall[c + W] && !seen[c + W]) { seen[c + W] = 1; q[t++] = c + W; }
    }
    if (edge || t > ROOM.maxTiles) continue; // outdoors: room 0
    const id = rooms.length;
    if (id > 65535) break;
    let doors = 0, built = 0;
    for (let k = 0; k < t; k++) {
      const c = q[k];
      room[c] = id;
    }
    // doors touching the room (each door counted once per room)
    const dseen = new Set();
    for (let k = 0; k < t; k++) {
      const c = q[k], x = c % W, y = (c / W) | 0;
      const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const j of nb) {
        if (j < 0 || !wall[j] || dseen.has(j)) continue;
        dseen.add(j);
        if (walk[j] === WALK_DOOR) doors++;
        if (occ[j] >= 0) built++;
      }
    }
    rooms.push({ id, n: t, x0, y0, x1, y1, first: start, doors, built, sky, under: under * 2 > t, roofed: sky === 0 });
  }
  return { room, rooms };
}

let setRoofFn = null;
/** terrain.js hands its setRoof over (avoids an import cycle). */
export function bindRoof(fn) { setRoofFn = fn; }

/** Auto-roof the open-sky tiles of built rooms (within roofReach of a support). Returns tiles roofed. */
function autoRoof(s, r) {
  if (!setRoofFn) return 0;
  let n = 0;
  const sup = s.rt.support;
  for (let id = 1; id < r.rooms.length; id++) {
    const rec = r.rooms[id];
    if (!rec.sky || !rec.built) continue;
    for (let y = rec.y0; y <= rec.y1; y++) for (let x = rec.x0; x <= rec.x1; x++) {
      const i = y * W + x;
      if (r.room[i] === id && s.L.roof[i] === ROOF.OPEN && sup[i] <= ROOM.roofReach) { setRoofFn(s, i, ROOF.BUILT); n++; }
    }
  }
  return n;
}

/** The endOfTick 'rooms' pass. */
export function roomsPass(s) {
  let r = roomsBuild(s);
  if (autoRoof(s, r)) r = roomsBuild(s);
  s.rt.room = r.room;
  s.rt.rooms = r.rooms;
}

export const roomOf = (s, i) => s.rt.room[i];
export const roomById = (s, id) => (id > 0 && s.rt.rooms[id]) || null;
/** Tile indexes of a room, sorted. */
export function roomTiles(s, id) {
  const out = [], a = s.rt.room;
  const r = roomById(s, id);
  if (!r) return out;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (a[y * W + x] === id) out.push(y * W + x);
  return out;
}

export function installRooms() {
  registerRebuild('room', (s) => { const occ = occRebuild(s); return roomsBuild(s, occ, walkRebuild(s, occ)).room; });
  registerRebuild('rooms', (s) => { const occ = occRebuild(s); return roomsBuild(s, occ, walkRebuild(s, occ)).rooms; });
  registerEndOfTick('rooms', (s) => roomsPass(s));
}
