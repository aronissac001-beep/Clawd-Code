// Rooms (owner B; doc 7.11, 12.3, 13.3). Stage 1a: detection, ids and basic stats. Stage 2: roles,
// stats and tiers (roomInfo, below), from G's rooms.js data.
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
import { isOpaque, WALK_DOOR, occRebuild, walkRebuild, footprint } from './pass.js';
import { structDef, roomRoles, roomTiers, floorDefById, materialDef } from './defs.js';
import { stackValue, buildingValue } from '../colony/wealth.js';

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
  // new room labels feed the temperature pass that runs right after (END_OF_TICK order)
  registerEndOfTick('rooms', (s) => { roomsPass(s); s.rt.dirty.temperature = true; });
}

// ---- Roles, stats and tiers (Stage 2; doc 7.11) -----------------------------------------------------
// roomInfo(s, id) is a pure function of the saved state and the end-of-tick caches (rt.room, rt.light,
// rt.itemAt), computed on demand and never stored, so it can never go stale (C13). Callers: F's room
// thoughts (once a game hour per colonist), E's tend and quality rolls, I's room card, C's outlines.
//   contents   finished buildings with any footprint tile in the room (walls and doors bound it and
//              belong to no room), in id order
//   role       the first role (rooms.js `order`) whose match holds: `any` structure ids at least
//              `count` (default 1) of them, `workbench`, `underground` (most tiles under rock);
//              'stockpile' in `any` also matches when stockpile zones cover half the floor; else Hall
//   stats      wealth (coins: buildings + stacks), beauty (sum over tiles: floors, buildings, -10 per
//              corpse, -2 per blighted tile), space (tiles minus furniture footprints), clean (100 less
//              25 per corpse and 5 per blighted tile), light (average level x 100 / 3)
//   imp        impressiveness: the weighted geometric mean of the scores
//                W = isqrt(4 x wealth), B = 25 + 20 x avg beauty (x2 weight), S = 10 x space (<= 200),
//                C = 10 + clean / 2
//              banded by rooms.js roomTier `min`: Squalid 0, Plain 20, Decent 40, Fine 65, Grand 90,
//              Majestic 130
export const ROOM_STATS = Object.freeze({ corpseBeauty: -10, blightBeauty: -2, corpseClean: 25, blightClean: 5, bigRoom: 200 });
const isqrt = (v) => (v <= 0 ? 0 : Math.floor(Math.sqrt(v)));

/** Finished buildings standing in room `id` (any footprint tile), sorted by id. */
export function roomContents(s, id) {
  const r = roomById(s, id);
  if (!r) return [];
  const seen = new Set(), out = [];
  const a = s.rt.room, occ = s.rt.occ;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
    const i = y * W + x;
    if (a[i] !== id || occ[i] < 0 || seen.has(occ[i])) continue;
    seen.add(occ[i]);
    const b = s.bld[occ[i]];
    if (b && b.st === 'done') out.push(b);
  }
  return out.sort((p, q) => p.id - q.id);
}

/** Structure ids some role names in `match.any`: they make that role, never the generic Workshop. */
let NAMED = null;
const namedDefs = () => NAMED || (NAMED = new Set(roomRoles().flatMap((r) => (r.match && r.match.any) || [])));
function roleOf(s, rec, contents, zoneShare) {
  for (const role of roomRoles()) {
    const m = role.match || {};
    if (m.fallback) return role.id;
    if (m.underground && !rec.under) continue;
    if (m.workbench) { if (contents.some((b) => { const d = structDef(b.def); return d && d.workbench && !namedDefs().has(b.def); })) return role.id; continue; }
    if (m.any) {
      const need = m.count || 1;
      let n = 0;
      for (const b of contents) if (m.any.includes(b.def)) n++;
      if (n >= need) return role.id;
      if (m.any.includes('stockpile') && zoneShare * 2 >= 1) return role.id;
    }
  }
  return 'hall';
}

/** Beauty of one finished building: its def, a furniture's material, and quality above Normal. */
export function buildingBeauty(b) {
  const d = structDef(b.def);
  if (!d) return 0;
  let v = d.beauty | 0;
  if (d.kind === 'furniture' && b.mat) { const m = materialDef(b.mat); if (m) v += m.beauty | 0; }
  if ((b.q | 0) > 2) v += (b.q | 0) - 2;
  return v;
}

/**
 * Room role, stats and tier. null for outdoors (id 0) or an unknown id.
 * @returns {null | { id, role, stats: { wealth, beauty, space, clean, light }, beautyAvg, imp, tier, tierIdx, contents: number[] }}
 */
export function roomInfo(s, id) {
  const rec = roomById(s, id);
  if (!rec) return null;
  const contents = roomContents(s, id);
  const L = s.L, a = s.rt.room, light = s.rt.light, itemAt = s.rt.itemAt;
  let n = 0, beauty = 0, lightSum = 0, corpses = 0, blight = 0, stock = 0, wealth10 = 0, blocked = 0;
  for (let y = rec.y0; y <= rec.y1; y++) for (let x = rec.x0; x <= rec.x1; x++) {
    const i = y * W + x;
    if (a[i] !== id) continue;
    n++;
    const fd = floorDefById(L.floor[i]);
    if (fd) beauty += fd.beauty | 0;
    if (L.blight[i] > 0) blight++;
    if (light) lightSum += light[i];
    if (L.zone[i] && zoneTypeAt(s, L.zone[i]) === 'stockpile') stock++;
    const it = itemAt && itemAt[i] >= 0 ? s.items[itemAt[i]] : null;
    if (it) { wealth10 += stackValue(it); if (it.k === 'corpse') corpses++; }
  }
  for (const b of contents) {
    wealth10 += buildingValue(b);
    beauty += buildingBeauty(b);
    // space counts the floor left free: furniture and benches take their footprint
    for (const i of footprint(s, b)) if (a[i] === id) blocked++;
  }
  beauty += corpses * ROOM_STATS.corpseBeauty + blight * ROOM_STATS.blightBeauty;
  const wealth = Math.floor(wealth10 / 10);
  const space = Math.max(0, n - blocked);
  const clean = Math.max(0, 100 - corpses * ROOM_STATS.corpseClean - blight * ROOM_STATS.blightClean);
  const lightPct = n ? Math.floor((lightSum * 100) / (3 * n)) : 0;
  const beautyAvg10 = n ? Math.trunc((beauty * 10) / n) : 0;                 // tenths
  const sW = Math.max(1, isqrt(4 * wealth));
  const sB = Math.max(1, 25 + Math.trunc((beautyAvg10 * 20) / 10));
  const sS = Math.max(1, Math.min(ROOM_STATS.bigRoom, 10 * space));
  const sC = 10 + (clean >> 1);
  const imp = Math.round(Math.pow(sW * sB * sB * sS * sC, 1 / 5));
  const tiers = roomTiers();
  let tierIdx = 0;
  for (let k = 0; k < tiers.length; k++) if (imp >= tiers[k].min) tierIdx = k;
  return {
    id, role: roleOf(s, rec, contents, n ? stock / n : 0),
    stats: { wealth, beauty, space, clean, light: lightPct }, beautyAvg: beautyAvg10 / 10,
    imp, tier: tiers[tierIdx] ? tiers[tierIdx].id : 'plain', tierIdx, contents: contents.map((b) => b.id),
  };
}
function zoneTypeAt(s, zid) { for (const z of s.zones) if (z.id === zid) return z.type; return null; }
/** roomInfo of the room at tile i (null outdoors). */
export const roomInfoAt = (s, i) => (s.rt.room[i] ? roomInfo(s, s.rt.room[i]) : null);
/** The tier thought value of a role (rooms.js `thoughts`, Squalid..Majestic), or 0. */
export function tierThought(role, tierIdx) {
  for (const r of roomRoles()) if (r.id === role) return r.thoughts ? r.thoughts[tierIdx] | 0 : 0;
  return 0;
}
