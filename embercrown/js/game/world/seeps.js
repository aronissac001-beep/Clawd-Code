// Aquifer seeps and their lining (owner B; EMBERCROWN-FORTRESS.md 2.8, Stage Z2.7). Static fluids (Z1, Z2).
//
//   Mining a wet-sand aquifer voxel leaves a seep (support.js: water depth 2 that stays a source; pass.isSeep). A seep
//   is LINED when it carries a built block or brick floor (Flagstone, Tiled floor or Road: Masonry work) and each of
//   its 4 planar neighbours is held: natural rock, a wall structure, or itself a voxel with a block or brick floor (so
//   a basin of several seeps is lined together). A lined seep dries: its depth and source bit clear (pass.lineSeep),
//   so walking there is no longer slow, and a well on it is an ordinary well again.
//   The check is a sweep with no state of its own: one level per tick for the first D ticks of each game hour
//   (seepSystem, slot 'mechanisms'), so every seep is looked at once an hour; liningOk(s, i) is the pure rule.
//   installSeeps() is called by plants.installPlants (both are installed by terrain.js through installWorld).

import { W, H, D, PLANE, TER } from '../core/grid.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { bldById } from '../core/state.js';
import { floorDefById, structDef, hasFlag } from './defs.js';
import { isSeep, lineSeep } from './pass.js';

/** Constructed floors that line a seep: the block and brick floors. */
export const LINING_FLOORS = Object.freeze(['f_flag', 'f_brick', 'road']);
const liningFloor = (s, i) => { const d = s.L.floor[i] ? floorDefById(s.L.floor[i]) : null; return !!d && LINING_FLOORS.includes(d.id); };
function held(s, j) {
  if (s.L.terrain[j] === TER.ROCK || liningFloor(s, j)) return true;
  const id = s.rt.occ[j];
  if (id === undefined || id < 0) return false;
  const b = bldById(s, id);
  return !!b && hasFlag(structDef(b.def), 'wall');
}
/** True when seep voxel i is lined (2.8): a block or brick floor on it, and its 4 planar neighbours held. */
export function liningOk(s, i) {
  if (!liningFloor(s, i)) return false;
  const p = i % PLANE, x = p % W, y = (p / W) | 0;
  if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return false;
  return held(s, i - 1) && held(s, i + 1) && held(s, i - W) && held(s, i + W);
}
/** Line every lined seep of level z now. Returns how many dried. */
export function lineLevel(s, z) {
  const f = s.L.fluid;
  if (!f) return 0;
  let n = 0;
  for (let i = z * PLANE, e = i + PLANE; i < e; i++) {
    if (!(f[i] & 16) || !isSeep(s, i) || !liningOk(s, i)) continue;
    lineSeep(s, i); n++;
  }
  return n;
}
/** Tick system: level (tick % hour) for the first D ticks of every game hour. */
export function seepSystem(s) {
  const k = s.tick % TICKS_PER_HOUR;
  if (k < D && s.L.fluid) lineLevel(s, k);
}
export function installSeeps() {
  if (tickSystems().some((x) => x.slot === 'mechanisms' && x.name === 'seep-lining')) return;
  registerSystem('mechanisms', 'seep-lining', seepSystem, 40);
}
