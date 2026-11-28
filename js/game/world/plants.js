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
//   Regional climate (W2.4; EMBERCROWN-WORLD.md 6.2): growth keeps reading tempAt, which now follows the hold's
//   climate, so the growing season is the days whose daytime base reaches WORLD.weather.climate.growMin:
//     growingSeason(s)        { days, first, last } of the year (greenvale and realm-less holds: 30, Thaw to Ashfall;
//                             tundra: 15); first is -1 when there is none
//     inGrowingSeason(s, t)   true on a day of the growing season (for the UI and the bot)
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.9). At D > 1 plants grow on any level with soil or cave loam;
// "open sky" means cover 0 (vertical.coverAt). The round-robin walks the sorted list of clusters (16 x 16 x
// 1) that hold a plant: plantClusters(s), a pure function of the plant layer, cached per runtime object and
// kept exact by the plant write hook (as claims.js keeps its map), so 64 clusters are visited, not 1,280.
// A visit adds the growth of the list's length in ticks.
//
// Underground life (Stage Z2.7; EMBERCROWN-FORTRESS.md 2.9, 2.10, 3.7). At D > 1:
//   caveLoam(s, i)        true for cave loam: an underground (cover >= 1) voxel of cave moss, tilled ground, or a mined
//                         soil floor (rough floor of loam or clay). `underground` plants (glowcap, greyshank, mere-reed,
//                         shore lichen, dimroot) need no light, and are sown on cave loam as well as fertile ground.
//   `dark` plants (glowcaps) grow only in the dark or the gloam: light <= GROW.darkMax (1, the glow of glowcaps,
//                         glowbeetles and shore lichen), never beside a torch.
//   Cavern spreading      a mature wild underground plant (CAVE.spread) may drop a seedling on a free neighbour of its
//                         habitat (cave moss; the Mere's shores; the foot of a cliff), at most CAVE.clusterMax plants per
//                         cluster, so the caverns stay alive after the hold harvests them. Pure: a hash of (tile, tick).
//   seedCavernFlora(s)    the cavern flora the first mapgen3 did not place (greyshank in the Hollows; mere-reed, shore
//                         lichen and dimroot in the Mere), a pure function of the seed and the world, written once by
//                         js/game/animals/caverns.js (its herd record keeps the flag). Returns the count planted.
//   plantYield            also carries the plant's material (greyshank: shankwood) as `mat`.

import { W, H, N, D, PLANE, CW, CH, CLUSTER, CLUSTERS, TER, TER_FERTILE, ROOF, zS } from '../core/grid.js';
import { seedOf } from '../core/rand.js';
import { coverAt } from './vertical.js';
import { onTileWrite } from './terrain.js';
import { TICKS_PER_DAY } from '../core/time.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { plantDef, isTreeCode, plantCode, stoneId } from './defs.js';
import { FL } from './pass.js';
import { setPlant, setGrowth, tempAt } from './terrain.js';
import { worldStage2 } from './worldrec.js';
import { growthPct, growingSeasonOf, seasonBase } from './weather.js';
import { WORLD, GEN3 } from '../../data/worldgen.js';
import { installSeeps } from './seeps.js';

/** Tuning (moves to balance.js WORLD with G). */
export const GROW = Object.freeze({ seedPermille: 2, chopWork: 30, minChopWork: 10, halfGrown: 128, harvestWork: 12, sowWork: 8, regrowFrom: 0, darkMax: 1 });
/**
 * Cavern life (Z2.7). spread: plant id -> habitat of its seedlings; mat: a yield's material (until the plant schema
 * has `mat`); flora: the one-time seeding, permille per habitat voxel by cavern.
 */
export const CAVE = Object.freeze({
  spreadPermille: 2, clusterMax: 16,
  spread: Object.freeze({ glowcap: 'moss', greyshank: 'moss', merereed: 'shore', lichen: 'cliff' }),
  mat: Object.freeze({ greyshank: 'shankwood' }),
  flora: Object.freeze({
    hollows: Object.freeze([['greyshank', 'moss', 25]]),
    mere: Object.freeze([['merereed', 'shore', 300], ['lichen', 'cliff', 60], ['dimroot', 'floor', 25]]),
  }),
});

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
  if (n <= 0) return null;
  const mat = d.mat || CAVE.mat[d.id];
  return mat ? { item, n, mat } : { item, n };
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
  if (!TER_FERTILE[t] && t !== TER.TILLED && !(d.underground && caveLoam(s, i))) return 'the ground is not fertile';
  if (L.floor[i]) return 'a floor covers the soil';
  if (s.rt.occ[i] >= 0) return 'a building stands here';
  if (s.rt.itemAt[i] >= 0) return 'an item lies here';
  if (!d.underground && (D > 1 ? coverAt(s, i) !== 0 : L.roof[i] !== ROOF.OPEN)) return 'it needs open sky';
  if (d.minTemp !== undefined && tempAt(s, i) < d.minTemp) return 'too cold to sow';
  if (worldStage2() && L.blight[i] > 0) return 'the soil is blighted';
  if (d.dark && s.rt.light && s.rt.light[i] > GROW.darkMax) return 'it grows only in the dark';
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
        if (d.dark && s.rt.light[i] > GROW.darkMax) continue;
        let add = gain(i, s.tick, n, d.days);
        if (wPct !== 100 && openSky(i)) add = Math.floor((add * wPct + (hashT(i, s.tick ^ 0x3c6ef372) % 100)) / 100);
        const ng = g + add;
        setGrowth(s, i, ng > 255 ? 255 : ng);
      } else if (D > 1 && CAVE.spread[d.id] && coverAt(s, i) > 0) {
        if ((hashT(i, s.tick ^ 0x1b873593) % 1000) < CAVE.spreadPermille) caveSpread(s, i, code, d, base, x, y);
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
// ---- Underground life (Z2.7) ------------------------------------------------------------------------------
let soilMats = null;
const soilMat = (m) => { if (!soilMats) soilMats = [stoneId('loam'), stoneId('clay')].filter((k) => k > 0); return soilMats.includes(m); };
/** Cave loam (2.2, 2.9): an underground voxel of cave moss, tilled ground or a mined soil floor (loam, clay). */
export function caveLoam(s, i) {
  if (D === 1 || coverAt(s, i) === 0) return false;
  const t = s.L.terrain[i];
  return t === TER.MOSS || t === TER.TILLED || ((t === TER.ROUGH || t === TER.DIRT) && soilMat(s.L.mat[i]));
}
const waterAt = (s, j) => { const f = s.L.fluid; return !!f && (f[j] & FL.DEPTH) !== 0 && (f[j] & FL.EMBER) === 0; };
/** Is voxel j (plane x, y of level base) free natural ground of a habitat ('moss' | 'shore' | 'cliff' | 'floor')? */
function habitatOk(s, j, hab, x, y) {
  const L = s.L, t = L.terrain[j];
  if (L.plant[j] || L.floor[j] || L.zone[j] || L.desig[j] || s.rt.occ[j] >= 0 || s.rt.itemAt[j] >= 0 || waterAt(s, j)) return false;
  if (t !== TER.MOSS && t !== TER.ROUGH) return false;
  if (hab === 'moss') return t === TER.MOSS;
  if (hab === 'floor') return true;
  const want = hab === 'shore' ? (k) => waterAt(s, k) : (k) => L.terrain[k] === TER.ROCK;
  if (x > 0 && want(j - 1)) return true;
  if (x < W - 1 && want(j + 1)) return true;
  if (y > 0 && want(j - W)) return true;
  return y < H - 1 && want(j + W);
}
function caveSpread(s, i, code, d, base, x, y) {
  const e = clCache.get(s.rt);
  if (e && e.count[clusterOfI(i)] >= CAVE.clusterMax) return;
  const k = hashT(i, s.tick ^ 0x27d4eb2d) & 7;
  const DX = [0, 1, 0, -1, 1, 1, -1, -1], DY = [-1, 0, 1, 0, -1, 1, 1, -1];
  const nx = x + DX[k], ny = y + DY[k];
  if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
  const j = base + ny * W + nx;
  if (!habitatOk(s, j, CAVE.spread[d.id], nx, ny) || coverAt(s, j) === 0) return;
  if (d.dark && s.rt.light && s.rt.light[j] > GROW.darkMax) return;
  if (d.minTemp !== undefined && tempAt(s, j) < d.minTemp) return;
  setPlant(s, j, code, 0);
}
const caveZ = (rel) => (rel === undefined ? -1 : zS + rel);
/** The levels of Caverns I and II: { hollows: [floor, ledge], mere: [floor, ledge] } (empty at D = 1). */
export function cavernLevels() {
  if (D === 1) return {};
  const out = {};
  for (const id of ['hollows', 'mere']) {
    const C = GEN3.caverns[id], zs = [caveZ(C.floor), caveZ(C.ledge)].filter((z) => z >= 0 && z < D);
    if (zs.length) out[id] = zs;
  }
  return out;
}
/** The cavern flora mapgen3 did not place (once per colony; caverns.js holds the flag). Returns the count planted. */
export function seedCavernFlora(s) {
  if (D === 1) return 0;
  const lv = cavernLevels(), sd = seedOf(s.seed) ^ 0x6a09e667;
  let n = 0;
  for (const [cid, rows] of Object.entries(CAVE.flora)) {
    for (const z of lv[cid] || []) {
      const base = z * PLANE;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = base + y * W + x;
        if (coverAt(s, i) === 0) continue;
        let r = hashT(i, sd) % 1000;
        for (const [id, hab, pm] of rows) {
          if (r >= pm) { r -= pm; continue; }
          const code = plantCode(id);
          if (code && habitatOk(s, i, hab, x, y)) { setPlant(s, i, code, 128 + (hashT(i, sd ^ 0x3c6ef372) & 127)); n++; }
          break;
        }
      }
    }
  }
  return n;
}

/** A seedling never lands next to a building or in a zone (stockpiles, farms) or on a designation. */
function plantSeedable(s, j) {
  return !s.L.zone[j] && !s.L.desig[j];
}

let plantHooked = false;
export function installPlants() {
  if (!plantHooked) { plantHooked = true; onTileWrite((s, i, layer, before, after) => { if (D > 1 && layer === 'plant') plantWritten(s, i, before, after); }); }
  installSeeps();   // Z2.7: seep lining (seeps.js), installed with the plants until terrain.js installs it itself
  if (tickSystems().some((x) => x.slot === 'plants' && x.name === 'growth')) return;
  registerSystem('plants', 'growth', plantsSystem, 0);
}

/** The hold's growing season: { days, first, last } (days of the year). */
export const growingSeason = (s) => growingSeasonOf(s);
/** True on a day of the hold's growing season (daytime base >= WORLD.weather.climate.growMin). */
export const inGrowingSeason = (s, tick = s.tick) => seasonBase(s, tick) >= WORLD.weather.climate.growMin;
