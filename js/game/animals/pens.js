// Pens (doc 7.5): pen zones keep tamed animals. Owner K.
// a.pen is a zone id of type 'pen' (E's zones). Acceptance (14.8 K): a tamed goat stays in its pen.
//
// Room: a pen holds animals of total size up to floor(tiles / PEN.tilesPerSize) (a goat is size 2:
// a 6 x 6 pen holds 9). A tamed animal joins the nearest pen with room (penFor); one whose pen is
// gone, or a tame animal with no pen, is reassigned at the daily check (pensSystem) when room exists.
// Containment (wild.js uses these): a penned animal only picks wander goals on its pen's tiles and
// only takes paths that stay on them (penPathOk), and an animal found outside its pen walks back in.
// Pen tiles come from a code cache (a WeakMap on s.rt) rebuilt whenever a zone was added, edited or
// removed (BUS.zoned) or the zone list changed: a pure function of the saved zone layer.

import { N } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { def } from '../colony/defs.js';
import { animTile } from './spawn.js';

export const PEN = Object.freeze({ tilesPerSize: 2 });
const cache = new WeakMap();   // s.rt -> { key, tiles: Map(zoneId -> sorted tiles) }
const zkey = (s) => s.zones.filter((z) => z.type === 'pen').map((z) => z.id).join(',');
function penTilesAll(s) {
  let c = cache.get(s.rt);
  const key = zkey(s);
  if (c && c.key === key && !c.stale) return c.tiles;
  const tiles = new Map();
  for (const z of s.zones) if (z.type === 'pen') tiles.set(z.id, []);
  if (tiles.size) { const L = s.L.zone; for (let i = 0; i < N; i++) { const z = L[i]; if (z) { const a = tiles.get(z); if (a) a.push(i); } } }
  c = { key, tiles, stale: false };
  cache.set(s.rt, c);
  return tiles;
}
const onZoned = (s) => { const c = cache.get(s.rt); if (c) c.stale = true; };
export function installPens() { if (!BUS.zoned.includes(onZoned)) BUS.zoned.push(onZoned); }

export const penZones = (s) => s.zones.filter((z) => z.type === 'pen');
export const penOf = (s, a) => (a.pen === null ? null : s.zones.find((z) => z.id === a.pen && z.type === 'pen') || null);
/** Tiles of pen zone id, ascending (read only). */
export const penTiles = (s, id) => penTilesAll(s).get(id) || [];
/** Is tile i inside pen zone id? */
export const inPen = (s, id, i) => s.L.zone[i] === id;
const sizeOf = (a) => { const d = def('animal', a.kind); return d ? d.size | 0 || 1 : 1; };
/** Size units a pen holds, and how many are used. */
export function penRoom(s, id) {
  let used = 0;
  for (const a of s.anim) if (a.tame && a.pen === id) used += sizeOf(a);
  return { cap: Math.floor(penTiles(s, id).length / PEN.tilesPerSize), used };
}
/** The pen with room for animal a, nearest to it (ties: lower zone id), or null. */
export function penFor(s, a) {
  const at = animTile(a), ax = at % s.w, ay = (at / s.w) | 0;
  let best = null, bd = Infinity;
  for (const z of penZones(s)) {
    const r = penRoom(s, z.id);
    if (r.used + (a.pen === z.id ? 0 : sizeOf(a)) > r.cap) continue;
    const t = penTiles(s, z.id);
    if (!t.length) continue;
    const c = t[t.length >> 1], d = Math.abs((c % s.w) - ax) + Math.abs(((c / s.w) | 0) - ay);
    if (d < bd) { bd = d; best = z; }
  }
  return best;
}
/** Is there a pen with room for one more animal of this kind? */
export function penRoomFor(s, kind) {
  const need = (def('animal', kind) || {}).size | 0 || 1;
  return penZones(s).some((z) => { const r = penRoom(s, z.id); return r.used + need <= r.cap; });
}
/** Assign an animal to a pen zone (null to release). */
export function assignPen(s, a, zoneId) {
  if (zoneId === null) { a.pen = null; return true; }
  if (!penZones(s).some((z) => z.id === zoneId)) return false;
  a.pen = zoneId;
  return true;
}
/** Does a path stay on the pen's tiles (the start tile excepted)? */
export function penPathOk(s, a, path) {
  if (a.pen === null || !path || path.i < 0) return true;
  for (let k = 0; k < path.tiles.length; k++) if (s.L.zone[path.tiles[k]] !== a.pen) return false;
  return true;
}
/** Tick system (slot 'animals'), daily: pens that went away release their animals; homeless tame animals find room. */
export function pensSystem(s) {
  if (s.tick % TICKS_PER_DAY !== 0) return;
  for (const a of s.anim) {
    if (!a.tame) continue;
    if (a.pen !== null && !penOf(s, a)) a.pen = null;
    if (a.pen === null) { const p = penFor(s, a); if (p) a.pen = p.id; }
  }
}
