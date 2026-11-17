// Copy and paste rooms (owner I; doc 10.11, 13.1 `js/game/tools/copy.js`). `copyRoom {roomId}` stores
// a template in s.colony.templates (A's core/apply.js); this module finds the room under a tile and
// plans a paste read-only: each template cell rotated and placed with the same footprint rule as
// the applier, so the red/green ghost shows exactly what `paste {templateId, x, y, rot}` will plan.
import { W, H, N, idx, inB, clamp } from '../core/grid.js';
import { structDef, sizeOf, tilesOf, hasFlag } from '../core/content.js';
import { checkPlace } from '../core/apply.js';
import { sumNeeds } from './place.js';

/** The room id at tile i: the room itself, or for a wall or door tile the lowest room beside it. 0 none. */
export function roomAt(s, i) {
  const R = s.rt.room;
  if (!R) return 0;
  if (R[i]) return R[i];
  const x = i % W, y = (i / W) | 0;
  let best = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (!inB(nx, ny)) continue;
    const r = R[idx(nx, ny)];
    if (r && (!best || r < best)) best = r;
  }
  return best;
}
/** Tile count of room id (0 when it does not exist). */
export function roomSize(s, id) {
  const r = s.rt.rooms && s.rt.rooms[id];
  if (r && r.n) return r.n;
  let n = 0;
  for (let i = 0; i < N; i++) if (s.rt.room[i] === id) n++;
  return n;
}
/** Template by id, or null. */
export const templateById = (s, id) => s.colony.templates.find((t) => t.id === id) || null;

/** Footprint of a template at rotation rot: [w, h]. */
export const templateSize = (tm, rot) => (rot & 1 ? [tm.h, tm.w] : [tm.w, tm.h]);

/** Rotate a cell (the applier's rotCell): top-left (dx, dy) of a w x h def in a W0 x H0 template. */
export function rotCell(dx, dy, w, h, W0, H0, rot) {
  switch (rot & 3) {
    case 1: return [H0 - 1 - (dy + h - 1), dx];
    case 2: return [W0 - 1 - (dx + w - 1), H0 - 1 - (dy + h - 1)];
    case 3: return [dy, W0 - 1 - (dx + w - 1)];
    default: return [dx, dy];
  }
}

/** Top-left of a paste whose footprint is centred on the finger tile (clamped to the map). */
export function pasteAnchor(tm, tile, rot) {
  const [w, h] = templateSize(tm, rot);
  return { x: clamp(tile.x - ((w - 1) >> 1), 0, Math.max(0, W - w)), y: clamp(tile.y - ((h - 1) >> 1), 0, Math.max(0, H - h)) };
}

/**
 * Plan a paste: { cells: [{ def, x, y, rot, tiles, ok, why }], ok (at least one cell fits), n (cells
 * that fit), need }. Floors are cells too (rot 0). Cells are checked against the map as it is now
 * (cells of the same paste never overlap in a copied room).
 */
export function pastePlan(s, tm, x, y, rot) {
  const cells = [];
  const costs = [];
  const put = (dx, dy, defId, rot0, mat) => {
    const d = structDef(defId);
    if (!d) return;
    const [w, h] = sizeOf(d, rot0);
    const [rx, ry] = rotCell(dx, dy, w, h, tm.w, tm.h, rot);
    const r = (rot0 + rot) & 3, px = x + rx, py = y + ry;
    const why = checkPlace(s, defId, px, py, r);
    cells.push({ def: defId, x: px, y: py, rot: r, tiles: tilesOf(d, px, py, r), ok: !why, why, wall: hasFlag(d, 'wall') || hasFlag(d, 'door'), floor: hasFlag(d, 'floor') });
    if (!why) costs.push([defId, mat]);
  };
  for (const [dx, dy, d, r0, mat] of tm.cells) put(dx, dy, d, r0, mat);
  for (const [dx, dy, d] of tm.floors) put(dx, dy, d, 0, null);
  const n = cells.filter((c) => c.ok).length;
  return { cells, n, ok: n > 0, need: sumNeeds(costs), why: n ? null : (cells.find((c) => c.why) || {}).why || 'nothing to place' };
}

/** The command for a paste (C3 `paste`). */
export const pasteCommand = (tm, x, y, rot) => ({ t: 'paste', templateId: tm.id, x, y, rot });
