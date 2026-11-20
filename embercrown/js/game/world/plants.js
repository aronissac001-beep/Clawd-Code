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
//   Stage 1b, for E's Grow giver (sow, harvest) and the Harvest designation:
//     isRipe(s, i)          a mature (growth 255) bush, crop or wild plant
//     harvestWork(s, i)     work in game minutes at speed 1.0 (GROW.harvestWork)
//     harvestPlant(s, i)    returns { item, n }: a crop is pulled up (the tile is free to sow again);
//                           a bush or perennial keeps its plant and starts regrowing (growth
//                           GROW.regrowFrom); null when nothing is ripe
//     canSow(s, i, code)    null when plant `code` can be sown on tile i now, else a reason string:
//                           fertile soil or tilled ground, no plant, building, item or floor, open
//                           sky unless the plant is `underground`, and warm enough (tempAt >= minTemp)
//     sowPlant(s, i, code)  sows it (growth 0); returns true when sown
//     sowWork(s, i)         work in game minutes (GROW.sowWork)
//   Berry bushes ('berry') grow wild on meadows (mapgen) and regrow after picking; hearthroot is the
//   Stage 1b crop of grow zones.
//   Stage 2 (worldrec.worldStage2): weather scales growth on open sky (weather.growthPct: rain 125%,
//   drought 40%); blighted tiles (L.blight >= 64) neither grow nor can be sown; an annual crop dies of
//   frost when its tile is WORLD.weather.frostKillBelow degrees under its minTemp (a Deepcold field
//   is lost unless it is harvested or roofed and warmed); `dark` plants (glowcaps) grow only on unlit
//   tiles (rt.light 0).
//   All writes go through terrain.js (setPlant / setGrowth).
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.9). At D > 1 plants grow on any level with soil or cave loam;
// "open sky" means cover 0 (vertical.coverAt). The round-robin walks the sorted list of clusters (16 x 16 x
// 1) that hold a plant: plantClusters(s), a pure function of the plant layer, cached per runtime object and
// kept exact by the plant write hook (as claims.js keeps its map), so 64 clusters are visited, not 1,280.
// A visit adds the growth of the list's length in ticks.

import { W, H, N, D, PLANE, CW, CH, CLUSTER, CLUSTERS, TER, TER_FERTILE, ROOF } from '../core/grid.js';
import { coverAt } from './vertical.js';
import { onTileWrite } from './terrain.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { plantDef, isTreeCode } from './defs.js';
import { setPlant, setGrowth, tempAt } from './terrain.js';
import { worldStage2 } from './worldrec.js';
import { growthPct } from './weather.js';
import { WORLD } from '../../data/worldgen.js';

/** Tuning (moves to balance.js WORLD with G). */
export const GROW = Object.freeze({ seedPermille: 2, chopWork: 30, minChopWork: 10, halfGrown: 128, harvestWork: 12, sowWork: 8, regrowFrom: 0 });

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

// ---- Harvest and sowing (Stage 1b) ------------------------------------------------------------------
const PICKED = new Set(['bush', 'crop', 'wild']);
export function isRipe(s, i) {
  const d = plantDef(s.L.plant[i]);
  return !!d && PICKED.has(d.kind) && s.L.growth[i] === 255;
}
export const harvestWork = () => GROW.harvestWork;
export const sowWork = () => GROW.sowWork;
/** Pick a ripe plant on tile i. Returns { item, n } or null. */
export function harvestPlant(s, i) {
  if (!isRipe(s, i)) return null;
  const code = s.L.plant[i], d = plantDef(code), y = plantYield(s, i);
  if (d.kind === 'bush' || d.perennial) setPlant(s, i, code, GROW.regrowFrom);
  else setPlant(s, i, 0, 0);
  return y;
}
/** null when plant `code` can be sown on tile i now, else the reason. */
export function canSow(s, i, code) {
  const d = plantDef(code), L = s.L;
  if (!d || !d.sow) return 'not a sown plant';
  if (L.plant[i]) return 'something grows here';
  const t = L.terrain[i];
  if (!TER_FERTILE[t] && t !== TER.TILLED) return 'the ground is not fertile';
  if (L.floor[i]) return 'a floor covers the soil';
  if (s.rt.occ[i] >= 0) return 'a building stands here';
  if (s.rt.itemAt[i] >= 0) return 'an item lies here';
  if (!d.underground && (D > 1 ? coverAt(s, i) !== 0 : L.roof[i] !== ROOF.OPEN)) return 'it needs open sky';
  if (d.minTemp !== undefined && tempAt(s, i) < d.minTemp) return 'too cold to sow';
  if (worldStage2() && L.blight[i] > 0) return 'the soil is blighted';
  if (d.dark && s.rt.light && s.rt.light[i] > 0) return 'it grows only in the dark';
  return null;
}
export function sowPlant(s, i, code) {
  if (canSow(s, i, code) !== null) return false;
  setPlant(s, i, code, 0);
  return true;
}

/** Growth gained over `elapsed` ticks for a plant taking `days` to mature (integer, hash-rounded). */
function gain(i, tick, elapsed, days) {
  const num = 255 * elapsed, den = Math.max(1, days) * TICKS_PER_DAY;
  const whole = Math.floor(num / den), rem = num - whole * den;
  return whole + ((hashT(i, tick) % den) < rem ? 1 : 0);
}

// ---- The cluster list (D > 1) ----------------------------------------------------------------------------
const clCache = new WeakMap();   // s.rt -> { count: Uint16Array(CLUSTERS), list: number[] | null }
const clusterOfI = (i) => { const p = i % PLANE; return ((i / PLANE) | 0) * CW * CH + (((p / W) | 0) >> 4) * CW + ((p % W) >> 4); };
function clusterCounts(s) {
  let e = clCache.get(s.rt);
  if (!e || e.count.length !== CLUSTERS) {
    const count = new Uint16Array(CLUSTERS), P = s.L.plant;
    for (let i = 0; i < N; i++) if (P[i]) count[clusterOfI(i)]++;
    e = { count, list: null };
    clCache.set(s.rt, e);
  }
  return e;
}
/** Sorted cluster ids (z-major) that hold at least one plant (D > 1 round-robin list). */
export function plantClusters(s) {
  const e = clusterCounts(s);
  if (!e.list) { e.list = []; for (let c = 0; c < e.count.length; c++) if (e.count[c]) e.list.push(c); }
  return e.list;
}
function plantWritten(s, i, before, after) {
  const e = clCache.get(s.rt);
  if (!e) return;
  const c = clusterOfI(i);
  if (before && !after) { if (--e.count[c] === 0) e.list = null; } else if (!before && after) { if (e.count[c]++ === 0) e.list = null; }
}

/** One cluster of growth (the 'plants' tick slot). */
export function plantsSystem(s) {
  let n = CW * CH, c = 0, base = 0;
  if (D > 1) {
    const list = plantClusters(s);
    n = list.length;
    if (!n) return;
    const id = list[s.tick % n], per = CW * CH;
    base = ((id / per) | 0) * PLANE; c = id % per;
  } else {
    if (!n) return;
    c = s.tick % n;
  }
  const x0 = (c % CW) * CLUSTER, y0 = ((c / CW) | 0) * CLUSTER;
  const x1 = Math.min(W, x0 + CLUSTER), y1 = Math.min(H, y0 + CLUSTER);
  const L = s.L, st2 = worldStage2(), wPct = st2 ? growthPct(s) : 100, frost = WORLD.weather.frostKillBelow;
  const openSky = (i) => (D > 1 ? coverAt(s, i) === 0 : L.roof[i] === ROOF.OPEN);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = base + y * W + x, code = L.plant[i];
      if (!code) continue;
      const d = plantDef(code);
      if (!d) continue;
      const g = L.growth[i];
      if (g < 255) {
        if (d.minTemp !== undefined) {
          const t = tempAt(s, i);
          if (t < d.minTemp) {
            if (st2 && d.kind === 'crop' && t < d.minTemp - frost) setPlant(s, i, 0, 0);   // killed by frost
            continue;
          }
        }
        if (st2 && L.blight[i] >= 64) continue;
        if (d.dark && s.rt.light[i] > 0) continue;
        let add = gain(i, s.tick, n, d.days);
        if (wPct !== 100 && openSky(i)) add = Math.floor((add * wPct + (hashT(i, s.tick ^ 0x3c6ef372) % 100)) / 100);
        const ng = g + add;
        setGrowth(s, i, ng > 255 ? 255 : ng);
      } else if (d.kind === 'tree' && (hashT(i, s.tick ^ 0x5bd1e995) % 1000) < GROW.seedPermille) {
        // reseed one of the 8 neighbours, picked by the same hash
        const k = hashT(i, s.tick ^ 0x27d4eb2d) & 7;
        const DX = [0, 1, 0, -1, 1, 1, -1, -1], DY = [-1, 0, 1, 0, -1, 1, 1, -1];
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = base + ny * W + nx;
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

let plantHooked = false;
export function installPlants() {
  if (!plantHooked) { plantHooked = true; onTileWrite((s, i, layer, before, after) => { if (D > 1 && layer === 'plant') plantWritten(s, i, before, after); }); }
  if (tickSystems().some((x) => x.slot === 'plants' && x.name === 'growth')) return;
  registerSystem('plants', 'growth', plantsSystem, 0);
}
