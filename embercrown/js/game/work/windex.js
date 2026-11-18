// Work indexes and job ranking (doc 5.3, 13.3; owner E). The parts of s.rt.idx that are not item
// buckets, and the shared nearest-first machinery every work giver uses.
//
// Indexes (C13 class incremental-ordered: updated in the same call that changes their input; every
// bucket is an array sorted ascending, so a rebuild from saved state is always identical):
//   idx.desig  { mine: [CW*CH tile lists], chop: [...] }   designation bits of s.L.desig by cluster
//   idx.frames [CW*CH id lists]   buildings not yet done (blueprints and frames), by the cluster of
//                                 their top-left tile
//   idx.bills  [ids]              finished workbenches that hold at least one bill
//   idx.plants [CW*CH tile lists]  tiles of grow zones (Stage 1b: the Grow giver sows and harvests them),
//                                 kept by BUS.zoned (zone tiles added or removed; a zone's type never changes)
//   idx.desig.harvest              Harvest designations (wild berry bushes; the Grow giver)
// Inputs and who reports them: the desig layer (A's appliers and setDesig below, through
// BUS.designated), buildings (A's addBuilding / removeBuilding through BUS.placed / BUS.removed;
// E's own state changes call refreshBuildingIndex), bills (BUS.billsChanged).
//
// Ranking (5.3): candidates are collected by walking 16 x 16 clusters outward from the colonist in
// ring order until WORK.candidatesK valid-looking ones are found (the ring is finished first), then
// ranked by B's region-graph distance (regionDist: the region-graph path length, so a target behind
// a winding tunnel is not taken as near). A target the colonist cannot reach (different component in
// the end-of-tick labels) gets distance Infinity and is dropped here, before any A* call.

import { W, H, CW, CH, CLUSTER, clusterOf, idx, tx, ty, DX4, DY4, DESIG } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { registerIdxPart, WORK, isReserved, isUnreachable } from './jobs.js';
import { regionDist, passable, compOf } from '../world/terrain.js';
import { footprint } from '../world/pass.js';
import { structDef } from '../core/content.js';
import { colTile } from './reserve.js';

// ---- Sorted array helpers -------------------------------------------------------------------------
export function sortedInsert(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  if (a[lo] === v) return false;
  a.splice(lo, 0, v);
  return true;
}
export function sortedRemove(a, v) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  if (a[lo] !== v) return false;
  a.splice(lo, 1);
  return true;
}
export const sortedHas = (a, v) => {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; }
  return a[lo] === v;
};
const clusterLists = () => { const out = []; for (let c = 0; c < CW * CH; c++) out.push([]); return out; };

// ---- Designations ---------------------------------------------------------------------------------
/** Indexed designation kinds (Stage 1a: the Mine and Chop givers). */
export const DESIG_INDEX = Object.freeze([['mine', DESIG.MINE], ['chop', DESIG.CHOP], ['harvest', DESIG.HARVEST]]);
export function rebuildDesigIndex(s) {
  const out = {};
  for (const [name] of DESIG_INDEX) out[name] = clusterLists();
  const L = s.L.desig;
  for (let i = 0; i < L.length; i++) {
    const v = L[i];
    if (!v) continue;
    for (const [name, bit] of DESIG_INDEX) if (v & bit) out[name][clusterOf(i)].push(i);
  }
  return out;
}
function onDesignated(s, i, before, after) {
  const d = s.rt.idx.desig;
  if (!d || Array.isArray(d)) return;
  for (const [name, bit] of DESIG_INDEX) {
    if ((before & bit) === (after & bit)) continue;
    const list = d[name][clusterOf(i)];
    if (after & bit) sortedInsert(list, i); else sortedRemove(list, i);
  }
}
/** E's designation write (a mined tile, a felled tree): writes the layer and tells BUS.designated. */
export function setDesig(s, i, v) {
  const before = s.L.desig[i];
  if (before === v) return false;
  s.L.desig[i] = v;
  for (const fn of BUS.designated) fn(s, i, before, v);
  return true;
}
export const clearDesig = (s, i, bits) => setDesig(s, i, s.L.desig[i] & ~bits);

// ---- Frames (blueprints and frames) -----------------------------------------------------------------
const isFrame = (b) => !!b && b.st !== 'done';
export function rebuildFrameIndex(s) {
  const out = clusterLists();
  for (const b of s.bld) if (isFrame(b)) out[clusterOf(idx(b.x, b.y))].push(b.id);
  return out;
}
// ---- Bills (finished workbenches with bills) ---------------------------------------------------------
const hasBills = (b) => !!b && b.st === 'done' && Array.isArray(b.bills) && b.bills.length > 0 && !!(structDef(b.def) || {}).workbench;
export function rebuildBillIndex(s) {
  const out = [];
  for (const b of s.bld) if (hasBills(b)) out.push(b.id);
  return out;
}

/** Bring every building index up to date for building b (after its state, bills or existence changed). */
export function refreshBuildingIndex(s, b, gone = false) {
  const ix = s.rt.idx;
  if (Array.isArray(ix.frames) && ix.frames.length === CW * CH) {
    const list = ix.frames[clusterOf(idx(b.x, b.y))];
    if (!gone && isFrame(b)) sortedInsert(list, b.id); else sortedRemove(list, b.id);
  }
  if (Array.isArray(ix.bills)) {
    if (!gone && hasBills(b)) sortedInsert(ix.bills, b.id); else sortedRemove(ix.bills, b.id);
  }
}

// ---- Grow zone tiles (Stage 1b) -------------------------------------------------------------------
const zoneType = (s, zid) => { if (!zid) return null; for (const z of s.zones) if (z.id === zid) return z.type; return null; };
export function rebuildGrowIndex(s) {
  const out = clusterLists();
  const grow = new Set(s.zones.filter((z) => z.type === 'grow').map((z) => z.id));
  if (!grow.size) return out;
  const Z = s.L.zone;
  for (let i = 0; i < Z.length; i++) if (Z[i] && grow.has(Z[i])) out[clusterOf(i)].push(i);
  return out;
}
function onZoned(s, z, tiles) {
  const p = s.rt.idx.plants;
  if (!Array.isArray(p) || p.length !== CW * CH) return;
  for (const i of tiles) {
    const list = p[clusterOf(i)];
    if (zoneType(s, s.L.zone[i]) === 'grow') sortedInsert(list, i); else sortedRemove(list, i);
  }
}

registerIdxPart('desig', rebuildDesigIndex);
registerIdxPart('plants', rebuildGrowIndex);
registerIdxPart('frames', rebuildFrameIndex);
registerIdxPart('bills', rebuildBillIndex);

/** Register the BUS hooks that keep these indexes exact (idempotent; after resetBus). */
export function installIndexHooks() {
  const add = (list, fn) => { if (!list.includes(fn)) list.push(fn); };
  add(BUS.designated, onDesignated);
  add(BUS.placed, onPlaced);
  add(BUS.removed, onRemoved);
  add(BUS.billsChanged, onBillsChanged);
  add(BUS.zoned, onZoned);
}
function onPlaced(s, b) { refreshBuildingIndex(s, b); }
function onRemoved(s, b) { refreshBuildingIndex(s, b, true); }
function onBillsChanged(s, b) { refreshBuildingIndex(s, b); }

// ---- Ring search over clusters ---------------------------------------------------------------------
/**
 * Visit cluster indexes in Chebyshev rings around cluster (cx, cy), nearest ring first, each ring in
 * row-major order. fn(c, ring) -> true stops after the CURRENT ring is finished.
 */
export function clusterRings(cx, cy, fn, maxR = Math.max(CW, CH)) {
  for (let r = 0; r <= maxR; r++) {
    let stop = false;
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= CH) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= CW) continue;
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (fn(y * CW + x, r)) stop = true;
      }
    }
    if (stop) return;
  }
}
/** The colonist's cluster coordinates. */
export function colCluster(col) { const c = clusterOf(colTile(col)); return [c % CW, (c / CW) | 0]; }

/**
 * Nearest-first candidate collection. lists(c) -> the sorted entries of cluster c (tile indexes or ids);
 * accept(entry) -> a candidate object { key, d, ... } with d the region-graph distance, or null.
 * Collects until k candidates, finishing the ring, then sorts by (d, key) and keeps k. Also stops
 * (after the current cluster) once WORK.scanMax entries were examined: designating a whole massif
 * must not make every think scan thousands of interior tiles (the face clusters come first).
 */
export function collect(s, col, lists, accept, k = WORK.candidatesK) {
  const out = [];
  const [cx, cy] = colCluster(col);
  let seen = 0, capped = false;
  clusterRings(cx, cy, (c) => {
    if (capped) return true;
    const a = lists(c);
    if (a) {
      for (let j = 0; j < a.length; j++) { const r = accept(a[j]); if (r && r.d !== Infinity) out.push(r); }
      seen += a.length;
      if (seen >= WORK.scanMax) capped = true;   // a whole cluster at a time, so the cut is deterministic
    }
    return out.length >= k || capped;
  });
  out.sort((p, q) => p.d - q.d || p.key - q.key);
  if (out.length > k) out.length = k;
  return out;
}

// ---- Standing spots ----------------------------------------------------------------------------------
/**
 * The best tile to stand on to work on a set of target tiles (a rock tile to mine, a building
 * footprint): a passable tile 4-adjacent to the set (and not in it), in the colonist's component,
 * with the smallest region-graph distance from the colonist (ties: lower tile index).
 * opts.onTarget: the target tiles themselves may be stood on (felling a tree); when one of them can
 * be, the neighbours are not considered.
 * @returns {{ i: number, d: number }} i = -1 and d = Infinity when there is none
 */
export function standSpot(s, col, tiles, { onTarget = false } = {}) {
  const from = colTile(col);
  const comp = compOf(s, from, 0);
  let best = -1, bd = Infinity;
  const consider = (j) => {
    if (!passable(s, j, 0) || compOf(s, j, 0) !== comp || comp === 0) return;
    const d = regionDist(s, from, j, 0);
    if (d < bd || (d === bd && j < best)) { bd = d; best = j; }
  };
  if (onTarget) { for (const i of tiles) consider(i); if (best >= 0) return { i: best, d: bd }; }
  for (const i of tiles) {
    const x = tx(i), y = ty(i);
    for (let k = 0; k < 4; k++) {
      const nx = x + DX4[k], ny = y + DY4[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = idx(nx, ny);
      if (tiles.length > 1 && tiles.includes(j)) continue;
      if (tiles.length === 1 && j === tiles[0]) continue;
      consider(j);
    }
  }
  return { i: best, d: bd };
}
/** Footprint tiles of a building (B's resolver: def size and rotation). */
export const tilesOfBld = (s, b) => footprint(s, b);

/** Region-graph distance from the colonist to tile i (Infinity when unreachable). */
export const distTo = (s, col, i) => regionDist(s, colTile(col), i, 0);
/** Same component as the colonist (the O(1) reachable-set test of 5.3)? */
export const reachableFrom = (s, col, i) => { const c = compOf(s, colTile(col), 0); return c !== 0 && c === compOf(s, i, 0); };

/** Shared candidate pre-filter: not claimed by someone else and not in the unreachable memory. */
export const openTarget = (s, col, key) => !isReserved(s, key, col.id) && !isUnreachable(s, col, key);

export { CLUSTER };
