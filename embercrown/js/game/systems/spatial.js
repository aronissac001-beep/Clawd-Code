// Spatial hash keyed by level (owner B; EMBERCROWN-FORTRESS.md 8.3 E2, C13 key `spatial`, class PER_TICK).
// Movers are bucketed by (z, cell) with 4 x 4 tile cells, in list order (so in id order), so a query that
// walks its cells in a fixed order returns the same movers in the same order on every engine. Only movers
// on the asked level are ever returned: nothing sees or reaches through floors (combat on the same z, E11).
//
//   buildSpatial(s)                   -> { cs, cw, ch, col, anim, foes }: per kind a Map bucket -> [ent]
//   near(sp, kind, x, y, z, r, out)   movers of a kind within r world units (Chebyshev box of cells, then a
//                                     squared-distance test), in cell-row order then list order
//   installSpatial()                  opt-in: rebuild s.rt.spatial at the start of every tick (slot 'path',
//                                     before the A* system) and register it as the C13 rebuild. Nothing in the
//                                     shipped D = 1 game calls it yet (no reader until H's E11), so D = 1
//                                     hashes and tick cost are unchanged.

import { W, H, TILE } from '../core/grid.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { registerRebuild } from '../core/rtcontract.js';

export const CELL = 4;                    // tiles per cell side
const KINDS = ['col', 'anim', 'foes'];

/** Fresh spatial hash of s.col, s.anim and s.foes. */
export function buildSpatial(s) {
  const cs = CELL * TILE, cw = Math.ceil(W / CELL), ch = Math.ceil(H / CELL);
  const out = { cs, cw, ch };
  for (const kind of KINDS) {
    const m = new Map(), list = s[kind] || [];
    for (const e of list) {
      if (!e) continue;
      const k = keyOf(e.x, e.y, e.z | 0, cs, cw, ch);
      let b = m.get(k);
      if (!b) m.set(k, (b = []));
      b.push(e);
    }
    out[kind] = m;
  }
  return out;
}
function keyOf(x, y, z, cs, cw, ch) {
  const cx = Math.min(cw - 1, Math.max(0, Math.floor(x / cs))), cy = Math.min(ch - 1, Math.max(0, Math.floor(y / cs)));
  return (z * ch + cy) * cw + cx;
}

/** Movers of `kind` on level z within r world units of (x, y). Appends to `out` (returned). */
export function near(sp, kind, x, y, z, r, out = []) {
  const m = sp[kind];
  if (!m) return out;
  const { cs, cw, ch } = sp;
  const x0 = Math.max(0, Math.floor((x - r) / cs)), x1 = Math.min(cw - 1, Math.floor((x + r) / cs));
  const y0 = Math.max(0, Math.floor((y - r) / cs)), y1 = Math.min(ch - 1, Math.floor((y + r) / cs));
  const r2 = r * r;
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const b = m.get((z * ch + cy) * cw + cx);
    if (!b) continue;
    for (const e of b) { const dx = e.x - x, dy = e.y - y; if (dx * dx + dy * dy <= r2) out.push(e); }
  }
  return out;
}

/** Opt-in per-tick rebuild of s.rt.spatial (see the header). Idempotent; call again after resetBus(). */
export function installSpatial() {
  registerRebuild('spatial', buildSpatial);
  if (tickSystems().some((x) => x.slot === 'path' && x.name === 'spatial')) return;
  registerSystem('path', 'spatial', (s) => { s.rt.spatial = buildSpatial(s); }, -1);
}
