// Plants: growth, felling and yields (owner B; doc 3.2 step 7, 6.5, 12.3; data js/data/plants.js).
//
//   The `plant` layer holds a plant code (defs.plantDef), `growth` 0-255 (255 = mature).
//   plantsSystem (tick slot 'plants') visits ONE 16 x 16 cluster per tick, round-robin by s.tick, so the
//   whole map is visited every CW * CH ticks (64 at 128). A visit adds the growth of the ticks elapsed
//   since the last visit: expected gain = 255 * elapsed / (days * TICKS_PER_DAY). Growth is a u8, so
//   the fraction is resolved by a hash of (tile, tick): the same saved state always grows the same
//   way and nothing extra is stored (C13: no runtime state at all). Growth stops below the plant's
//   minTemp (tempAt, 3.6).
//   Wild trees reseed: on a visit, a mature tree may drop a seedling on a free fertile tile next to it
//   (rarely; GROW.seedPermille), so a forest slowly grows back after felling.
//
//   Read / write API for E's Chop giver and toil (and the Harvest giver in 1b):
//     treeAt(s, i)          true for a tree (any growth)
//     plantYield(s, i)      { item, n } that felling or harvesting gives now (doc: growth / 255 of the
//                           full yield, rounded down, at least 1 once half grown), or null
//     chopWork(s, i)        work in game minutes at speed 1.0 (WORK.chop, scaled by maturity)
//     fellPlant(s, i)       removes the plant through terrain.setPlant and returns plantYield; the
//                           caller spawns the items through the item API (C6)
//   All writes go through terrain.js (setPlant / setGrowth).

import { W, H, CW, CH, CLUSTER, TER_FERTILE } from '../core/grid.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { plantDef, isTreeCode } from './defs.js';
import { setPlant, setGrowth, tempAt } from './terrain.js';

/** Tuning (moves to balance.js WORLD with G). */
export const GROW = Object.freeze({ seedPermille: 2, chopWork: 30, minChopWork: 10, halfGrown: 128 });

function hashT(i, t) {
  let h = (Math.imul(i | 0, 0x9e3779b1) ^ Math.imul(t | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

export const treeAt = (s, i) => isTreeCode(s.L.plant[i]);

/** Items a plant gives now: { item, n } (first yield entry of its def), or null. */
export function plantYield(s, i) {
  const d = plantDef(s.L.plant[i]);
  if (!d || !d.yield) return null;
  const keys = Object.keys(d.yield);
  if (!keys.length) return null;
  const item = keys[0], full = d.yield[item] | 0, g = s.L.growth[i];
  let n = Math.floor((full * g) / 255);
  if (g >= GROW.halfGrown && n < 1) n = 1;
  return n > 0 ? { item, n } : null;
}

/** Felling work in game minutes at speed 1.0: a sapling takes less. */
export function chopWork(s, i) {
  const g = s.L.growth[i];
  return Math.max(GROW.minChopWork, Math.round((GROW.chopWork * g) / 255));
}

/** Fell or uproot the plant on tile i. Returns what it yields ({ item, n } or null). */
export function fellPlant(s, i) {
  const y = plantYield(s, i);
  if (s.L.plant[i]) setPlant(s, i, 0, 0);
  return y;
}

/** Growth gained over `elapsed` ticks for a plant taking `days` to mature (integer, hash-rounded). */
function gain(i, tick, elapsed, days) {
  const num = 255 * elapsed, den = Math.max(1, days) * TICKS_PER_DAY;
  const whole = Math.floor(num / den), rem = num - whole * den;
  return whole + ((hashT(i, tick) % den) < rem ? 1 : 0);
}

/** One cluster of growth (the 'plants' tick slot). */
export function plantsSystem(s) {
  const n = CW * CH;
  if (!n) return;
  const c = s.tick % n;
  const x0 = (c % CW) * CLUSTER, y0 = ((c / CW) | 0) * CLUSTER;
  const x1 = Math.min(W, x0 + CLUSTER), y1 = Math.min(H, y0 + CLUSTER);
  const L = s.L;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x, code = L.plant[i];
      if (!code) continue;
      const d = plantDef(code);
      if (!d) continue;
      const g = L.growth[i];
      if (g < 255) {
        if (d.minTemp !== undefined && tempAt(s, i) < d.minTemp) continue;
        const ng = g + gain(i, s.tick, n, d.days);
        setGrowth(s, i, ng > 255 ? 255 : ng);
      } else if (d.kind === 'tree' && (hashT(i, s.tick ^ 0x5bd1e995) % 1000) < GROW.seedPermille) {
        // reseed one of the 8 neighbours, picked by the same hash
        const k = hashT(i, s.tick ^ 0x27d4eb2d) & 7;
        const DX = [0, 1, 0, -1, 1, 1, -1, -1], DY = [-1, 0, 1, 0, -1, 1, 1, -1];
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (L.plant[j] || !TER_FERTILE[L.terrain[j]] || L.floor[j] || L.roof[j] || s.rt.occ[j] >= 0 || s.rt.itemAt[j] >= 0) continue;
        if (!plantSeedable(s, j)) continue;
        setPlant(s, j, code, 0);
      }
    }
  }
}
/** A seedling never lands next to a building or in a zone (stockpiles, farms) or on a designation. */
function plantSeedable(s, j) {
  return !s.L.zone[j] && !s.L.desig[j];
}

export function installPlants() {
  if (tickSystems().some((x) => x.slot === 'plants' && x.name === 'growth')) return;
  registerSystem('plants', 'growth', plantsSystem, 0);
}
