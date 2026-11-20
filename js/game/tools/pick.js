// Tap selection (owner I; doc 10.2 "colonists win"; then animals, Stage 2). Pure: positions in world units, radii in pt.
// A tap within `colonistPt` (22 pt) of a colonist's centre selects the nearest colonist. Below the
// strategic zoom colonists are pips whose hit area is `pipHitPt` (44 pt) across whatever the zoom.
// Otherwise the tap falls to the tile; a second tap on the same tile cycles item > building > zone >
// tile (the cycle list is built here from what lies on the tile).
// Stage Z1 (EMBERCROWN-FORTRESS.md 4.4): with a level z, only entities on that level are picked (a tap within
// 22 pt of a colonist on another level does not select it) and the tile index is the voxel on level z.
import { W, H, TILE, PLANE } from '../core/grid.js';

export const PICK = Object.freeze({ colonistPt: 22, pipHitPt: 44, strategicZoom: 0.5 });

/**
 * Nearest colonist to the world point within the hit radius, or null.
 * @param {object[]} cols  s.col (any objects with x, y in world units and an id)
 * @param {number} wx, wy  world point of the tap
 * @param {number} zoom    camera zoom (pt per world unit)
 */
export function pickColonist(cols, wx, wy, zoom, opt = PICK, z = null) {
  const rPt = zoom < opt.strategicZoom ? opt.pipHitPt / 2 : opt.colonistPt;
  const r = rPt / zoom;               // pt -> world units
  let best = null, bd = r * r;
  for (const c of cols) {
    if (z !== null && (c.z | 0) !== z) continue;
    // the body's centre sits about half a tile above its feet (c.y)
    const dx = c.x - wx, dy = (c.y - (zoom < opt.strategicZoom ? 0 : TILE * 0.35)) - wy;
    const d = dx * dx + dy * dy;
    if (d <= bd) { bd = d; best = c; }
  }
  return best;
}
/** The tile under a world point (null off the map). */
export function pickTile(wx, wy, z = null) {
  const x = Math.floor(wx / TILE), y = Math.floor(wy / TILE);
  if (!(x >= 0 && y >= 0 && x < W && y < H)) return null;
  return z === null ? { x, y, i: y * W + x } : { x, y, z, i: z * PLANE + y * W + x };
}
/** Selection candidates on a tile in cycle order: items, then buildings, then the zone, then the tile. */
export function tileCandidates(s, t) {
  const out = [];
  const it = s.rt && s.rt.itemAt ? s.rt.itemAt[t.i] : -1;
  if (it >= 0) out.push({ kind: 'item', id: it });
  const b = s.rt && s.rt.occ ? s.rt.occ[t.i] : -1;
  if (b >= 0) out.push({ kind: 'building', id: b });
  const z = s.L.zone[t.i];
  if (z) out.push({ kind: 'zone', id: z });
  out.push({ kind: 'tile', id: t.i });
  return out;
}
/**
 * One tap: colonists win, else the tile's candidates; tapping the same tile again moves along the
 * cycle. `prev` is the current selection ({kind, id, tile?}) or null. Returns the new selection.
 */
export function pickAt(s, wx, wy, zoom, prev = null, opt = PICK, z = null) {
  const c = pickColonist(s.col, wx, wy, zoom, opt, z);
  if (c) return { kind: 'colonist', id: c.id, again: !!(prev && prev.kind === 'colonist' && prev.id === c.id) };
  // animals (Stage 2) come next: a tap on a sheep selects the sheep, not the grass under it
  const a = s.anim && s.anim.length ? pickColonist(s.anim, wx, wy, zoom, opt, z) : null;
  if (a) return { kind: 'animal', id: a.id, again: !!(prev && prev.kind === 'animal' && prev.id === a.id) };
  const t = pickTile(wx, wy, z);
  if (!t) return null;
  const list = tileCandidates(s, t);
  let k = 0;
  if (prev && prev.tile === t.i && prev.kind !== 'colonist') {
    const j = list.findIndex((e) => e.kind === prev.kind && e.id === prev.id);
    k = j >= 0 ? (j + 1) % list.length : 0;
  }
  const out = { ...list[k], tile: t.i, x: t.x, y: t.y };
  if (z !== null) out.z = z;
  return out;
}
