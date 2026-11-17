// Regions (owner B; part of contract C5, doc 12.3, 13.3). Stage 0: real labels, a real graph,
// full-map and per-cluster relabelling; the hierarchical path use (HPA-lite) waits for the 1b bench.
//
//   Regions are split at CLUSTER x CLUSTER (16 x 16) borders, with TWO label sets:
//     rt.region   colonists: doors passable
//     rt.regionH  hostiles: doors (and locked gates) are walls
//   A label is 0 on a tile the side cannot enter; otherwise it is canonical:
//     id = cluster * LOCAL_MAX + local + 1, local = order of first tile in the cluster's row scan.
//   So relabelling only the dirty clusters gives exactly the labels of a full rebuild (C13).
//   4-connectivity inside a cluster equals the movers' 8-way no-corner-cutting connectivity.
//
//   rt.regionGraph = { col: G, hos: G }, G = {
//     slots,                       // CW * CH * LOCAL_MAX + 1 (region ids are < slots)
//     size:  Uint16Array(slots),   // tiles per region (0 = no such region)
//     cx, cy: Uint16Array(slots),  // floored centroid tile of the region
//     comp:  Uint16Array(slots),   // component = the smallest region id it is connected to
//     links: Uint32Array,          // sorted unique pairs a * 65536 + b (a < b) across cluster borders
//     regions: number }            // count of live regions
//   Dirty clusters come from rt.dirty.tiles; the endOfTick 'regions' pass relabels them, then the
//   graph is rebuilt from the labels (cheap: one scan plus the border pairs).

import { W, H, N, CLUSTER, CW, CH } from '../core/grid.js';
import { walkRebuild, passW, SIDE, sideOf } from './pass.js';

export const LOCAL_MAX = 128;            // the most 4-connected components a 16 x 16 cluster can hold
export const regionSlots = () => CW * CH * LOCAL_MAX + 1;
export const clusterOfRegion = (r) => ((r - 1) / LOCAL_MAX) | 0;

let stack = null;
const stackBuf = () => (stack && stack.length >= CLUSTER * CLUSTER ? stack : (stack = new Int32Array(CLUSTER * CLUSTER)));

/** Label one cluster of `lab` for `side` from walk costs. */
export function labelCluster(walk, lab, c, side) {
  const x0 = (c % CW) * CLUSTER, y0 = ((c / CW) | 0) * CLUSTER;
  const x1 = Math.min(W, x0 + CLUSTER), y1 = Math.min(H, y0 + CLUSTER);
  for (let y = y0; y < y1; y++) lab.fill(0, y * W + x0, y * W + x1);
  const st = stackBuf();
  let local = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (lab[i] !== 0 || !passW(walk[i], side)) continue;
      const id = c * LOCAL_MAX + local + 1;
      local++;
      let sp = 0; st[sp++] = i; lab[i] = id;
      while (sp > 0) {
        const j = st[--sp], jx = j % W, jy = (j / W) | 0;
        if (jx > x0) { const k = j - 1; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
        if (jx < x1 - 1) { const k = j + 1; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
        if (jy > y0) { const k = j - W; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
        if (jy < y1 - 1) { const k = j + W; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
      }
    }
  }
  return local;
}

export function labelAll(walk, side) {
  const lab = new Uint16Array(N);
  for (let c = 0; c < CW * CH; c++) labelCluster(walk, lab, c, side);
  return lab;
}

/** The region graph of one label set, from scratch. */
export function buildGraph(lab) {
  const slots = regionSlots();
  const size = new Uint16Array(slots), cx = new Uint16Array(slots), cy = new Uint16Array(slots), comp = new Uint16Array(slots);
  const sx = new Float64Array(slots), sy = new Float64Array(slots);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = lab[y * W + x];
    if (r) { size[r]++; sx[r] += x; sy[r] += y; }
  }
  let regions = 0;
  for (let r = 1; r < slots; r++) if (size[r]) { regions++; cx[r] = Math.floor(sx[r] / size[r]); cy[r] = Math.floor(sy[r] / size[r]); }
  // links across cluster borders (4-adjacent tile pairs)
  const pairs = [];
  const add = (a, b) => { if (a && b && a !== b) pairs.push(a < b ? a * 65536 + b : b * 65536 + a); };
  for (let x = CLUSTER - 1; x < W - 1; x += CLUSTER) for (let y = 0; y < H; y++) add(lab[y * W + x], lab[y * W + x + 1]);
  for (let y = CLUSTER - 1; y < H - 1; y += CLUSTER) for (let x = 0; x < W; x++) add(lab[y * W + x], lab[(y + 1) * W + x]);
  const sorted = Uint32Array.from(pairs).sort();
  let n = 0;
  for (let k = 0; k < sorted.length; k++) if (k === 0 || sorted[k] !== sorted[k - 1]) sorted[n++] = sorted[k];
  const links = sorted.slice(0, n);
  // components: union-find, canonical root = smallest region id
  const par = new Int32Array(slots);
  for (let r = 0; r < slots; r++) par[r] = r;
  const find = (r) => { while (par[r] !== r) { par[r] = par[par[r]]; r = par[r]; } return r; };
  for (let k = 0; k < n; k++) {
    const a = find((links[k] / 65536) | 0), b = find(links[k] % 65536);
    if (a !== b) { if (a < b) par[b] = a; else par[a] = b; }
  }
  for (let r = 1; r < slots; r++) if (size[r]) comp[r] = find(r);
  return { slots, size, cx, cy, comp, links, regions };
}

// ---- C13 rebuilds (pure functions of saved state) ----------------------------------------------
export const regionRebuild = (s) => labelAll(walkRebuild(s), SIDE.COL);
export const regionHRebuild = (s) => labelAll(walkRebuild(s), SIDE.HOS);
export function regionGraphRebuild(s) {
  const walk = walkRebuild(s);
  return { col: buildGraph(labelAll(walk, SIDE.COL)), hos: buildGraph(labelAll(walk, SIDE.HOS)) };
}

/** Full relabel of the live runtime from rt.walkCost. */
export function relabelAll(s) {
  const rt = s.rt;
  for (let c = 0; c < CW * CH; c++) { labelCluster(rt.walkCost, rt.region, c, 0); labelCluster(rt.walkCost, rt.regionH, c, 1); }
  rt.regionGraph = { col: buildGraph(rt.region), hos: buildGraph(rt.regionH) };
}

let mark = null;
/** The endOfTick 'regions' pass: relabel the clusters of every dirty tile, then rebuild the graph. */
export function regionsPass(s, d = s.rt.dirty) {
  const rt = s.rt;
  if (!(rt.region instanceof Uint16Array) || rt.region.length !== N) rt.region = new Uint16Array(N);
  if (!(rt.regionH instanceof Uint16Array) || rt.regionH.length !== N) rt.regionH = new Uint16Array(N);
  const tiles = d && d.tiles;
  if (!tiles || tiles.length === 0 || tiles.length > N / 4) { relabelAll(s); return CW * CH; }
  if (!mark || mark.length !== CW * CH) mark = new Uint8Array(CW * CH);
  mark.fill(0);
  for (let k = 0; k < tiles.length; k++) {
    const i = tiles[k];
    if (i >= 0 && i < N) mark[((((i / W) | 0) / CLUSTER) | 0) * CW + (((i % W) / CLUSTER) | 0)] = 1;
  }
  let n = 0;
  for (let c = 0; c < CW * CH; c++) {
    if (!mark[c]) continue;
    labelCluster(rt.walkCost, rt.region, c, 0);
    labelCluster(rt.walkCost, rt.regionH, c, 1);
    n++;
  }
  rt.regionGraph = { col: buildGraph(rt.region), hos: buildGraph(rt.regionH) };
  return n;
}

// ---- Read API (re-exported by terrain.js) ------------------------------------------------------
const labOf = (s, side) => (sideOf(side) === 1 ? s.rt.regionH : s.rt.region);
const graphOf = (s, side) => { const g = s.rt.regionGraph; return g && (sideOf(side) === 1 ? g.hos : g.col); };

/** Region label of tile i for a side (0 = the side cannot stand there). */
export const regionOf = (s, i, side = 0) => labOf(s, side)[i];
/** Component of tile i (0 = none). Two tiles are mutually reachable iff their components match. */
export function compOf(s, i, side = 0) {
  const r = labOf(s, side)[i];
  const g = graphOf(s, side);
  return r && g && g.comp ? g.comp[r] : 0;
}
/** True when a side can walk from tile a to tile b (per the end-of-tick labels). */
export function reachable(s, a, b, side = 0) {
  const ca = compOf(s, a, side);
  return ca !== 0 && ca === compOf(s, b, side);
}

const octile = (ax, ay, bx, by) => {
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx;
};
// Region-graph Dijkstra results, cached per graph object (a graph is replaced, never mutated, when
// labels change, so a cached row can never be stale). The cache changes speed, never results.
const csrCache = new WeakMap();
function csrOf(g) {
  let c = csrCache.get(g);
  if (c) return c;
  const deg = new Int32Array(g.slots + 1);
  for (let k = 0; k < g.links.length; k++) { deg[(g.links[k] / 65536) | 0]++; deg[g.links[k] % 65536]++; }
  const start = new Int32Array(g.slots + 1);
  for (let r = 1; r <= g.slots; r++) start[r] = start[r - 1] + deg[r - 1];
  const fill = start.slice(), adj = new Int32Array(g.links.length * 2);
  for (let k = 0; k < g.links.length; k++) {
    const a = (g.links[k] / 65536) | 0, b = g.links[k] % 65536;
    adj[fill[a]++] = b; adj[fill[b]++] = a;
  }
  c = { start, adj, rows: new Map() };
  csrCache.set(g, c);
  return c;
}
const ROW_CACHE = 48;
function distRow(g, src) {
  const c = csrOf(g);
  let row = c.rows.get(src);
  if (row) return row;
  row = new Int32Array(g.slots).fill(-1);
  // small binary heap over (dist, region)
  const hk = [], hv = [];
  const push = (k, v) => {
    let p = hk.length; hk.push(k); hv.push(v);
    while (p > 0) { const q = (p - 1) >> 1; if (hk[q] < hk[p] || (hk[q] === hk[p] && hv[q] <= hv[p])) break; [hk[q], hk[p]] = [hk[p], hk[q]]; [hv[q], hv[p]] = [hv[p], hv[q]]; p = q; }
  };
  const pop = () => {
    const v = hv[0], k = hk[0], lk = hk.pop(), lv = hv.pop();
    if (hk.length) {
      hk[0] = lk; hv[0] = lv; let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1; let m = p;
        if (l < hk.length && (hk[l] < hk[m] || (hk[l] === hk[m] && hv[l] < hv[m]))) m = l;
        if (r < hk.length && (hk[r] < hk[m] || (hk[r] === hk[m] && hv[r] < hv[m]))) m = r;
        if (m === p) break;
        [hk[m], hk[p]] = [hk[p], hk[m]]; [hv[m], hv[p]] = [hv[p], hv[m]]; p = m;
      }
    }
    return [k, v];
  };
  const done = new Uint8Array(g.slots);
  row[src] = 0; push(0, src);
  while (hk.length) {
    const [d, r] = pop();
    if (done[r]) continue;
    done[r] = 1;
    for (let e = c.start[r]; e < c.start[r + 1]; e++) {
      const n2 = c.adj[e];
      if (done[n2]) continue;
      const nd = d + octile(g.cx[r], g.cy[r], g.cx[n2], g.cy[n2]);
      if (row[n2] < 0 || nd < row[n2]) { row[n2] = nd; push(nd, n2); }
    }
  }
  if (c.rows.size >= ROW_CACHE) c.rows.delete(c.rows.keys().next().value);
  c.rows.set(src, row);
  return row;
}

/**
 * Distance estimate between tiles a and b for a side, in tenths of a tile (orthogonal step 10,
 * diagonal 14), or Infinity when b cannot be reached from a. Same region: the octile distance;
 * otherwise the region-graph distance between centroids plus both ends. Never calls A*.
 */
export function regionDist(s, a, b, side = 0) {
  const lab = labOf(s, side), g = graphOf(s, side);
  const ra = lab[a], rb = lab[b];
  if (!ra || !rb || !g || !g.comp || g.comp[ra] !== g.comp[rb]) return Infinity;
  const ax = a % W, ay = (a / W) | 0, bx = b % W, by = (b / W) | 0;
  if (ra === rb) return octile(ax, ay, bx, by);
  const mid = distRow(g, ra)[rb];
  return octile(ax, ay, g.cx[ra], g.cy[ra]) + mid + octile(g.cx[rb], g.cy[rb], bx, by);
}
