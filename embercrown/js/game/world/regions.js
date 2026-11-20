// Regions (owner B; part of contract C5, doc 12.3, 13.3). Stage 0: real labels, a real graph,
// full-map and per-cluster relabelling; the hierarchical path use (HPA-lite) waits for the 1b bench.
//
//   Index types (Stage Z1 E1, EMBERCROWN-FORTRESS.md 7.1, 7.3): labels are u32 (Uint32Array of N voxels,
//   all levels), clusters are 16 x 16 x 1 (grid.js clusterOf, CLUSTERS = CW * CH * D), and a link is one
//   Float64 key a * LINK_SPAN + b. On a D = 1 map every label, link and component equals Stage 2's.
//   Stage Z1 E3 (6.2): links also join levels where a TER_UP voxel sits under a TER_DOWN voxel (stairs and
//   ramps); each link keeps a fixed representative crossing (ta, tb: the crossing with the lowest voxel
//   index); the graph is updated per dirty cluster only (labels, stats and the links of those clusters), and
//   equals a full rebuild BY VALUE; g.stamp is linkStamp. The link Dijkstra, the link heuristic and the 3D
//   regionDist live in regiongraph.js.
//   Regions are split at CLUSTER x CLUSTER (16 x 16) borders, with TWO label sets:
//     rt.region   colonists: doors passable
//     rt.regionH  hostiles: doors (and locked gates) are walls
//   A label is 0 on a tile the side cannot enter; otherwise it is canonical:
//     id = cluster * LOCAL_MAX + local + 1, local = order of first tile in the cluster's row scan.
//   So relabelling only the dirty clusters gives exactly the labels of a full rebuild (C13).
//   4-connectivity inside a cluster equals the movers' 8-way no-corner-cutting connectivity.
//
//   rt.regionGraph = { col: G, hos: G }, G = {
//     slots,                       // CLUSTERS * LOCAL_MAX + 1 (region ids are < slots)
//     size:  Uint16Array(slots),   // tiles per region (0 = no such region)
//     cx, cy: Uint16Array(slots),  // floored centroid tile of the region
//     comp:  Uint32Array(slots),   // component = the smallest region id it is connected to
//     nreg:  Uint8Array(CLUSTERS), // regions per cluster
//     links: Float64Array,         // sorted pairs a * LINK_SPAN + b (a < b) across cluster borders and levels:
//                                  // unique at D = 1; at D > 1 one entry per crossing group (portal)
//     ta, tb: Uint32Array,         // per link: its representative crossing (ta in region a, tb in region b)
//     stamp: number,               // linkStamp: value hash of links, ta, tb (< 2^53)
//     regions: number }            // count of live regions
//   Dirty clusters come from rt.dirty.tiles; the endOfTick 'regions' pass relabels them and patches the
//   graph for them (no full relabel at runtime; initRuntime builds it whole).

import { W, H, N, D, PLANE, CLUSTER, CW, CH, CLUSTERS, clusterOf, TER_UP, TER_DOWN } from '../core/grid.js';
import { regionDist3, linkDijkstra, linkH, linkHAt, linkBest } from './regiongraph.js';
import { walkRebuild, passW, SIDE, sideOf, WALK_DOOR } from './pass.js';

export const LOCAL_MAX = 128;            // the most 4-connected components a 16 x 16 cluster can hold
export const regionSlots = () => CLUSTERS * LOCAL_MAX + 1;
/** Link key span: a * LINK_SPAN + b, exact in a double for every region id (< 2^20 while N < 1e6). */
export const LINK_SPAN = 1048576;
export const linkA = (k) => Math.floor(k / LINK_SPAN);
export const linkB = (k) => k % LINK_SPAN;
export const clusterOfRegion = (r) => ((r - 1) / LOCAL_MAX) | 0;

let stack = null;
const stackBuf = () => (stack && stack.length >= CLUSTER * CLUSTER ? stack : (stack = new Int32Array(CLUSTER * CLUSTER)));

/** Label one cluster (16 x 16 on its level) of `lab` for `side` from walk costs. */
export function labelCluster(walk, lab, c, side) {
  const cz = (c / (CW * CH)) | 0, cp = c - cz * CW * CH, base = cz * PLANE;
  const x0 = (cp % CW) * CLUSTER, y0 = ((cp / CW) | 0) * CLUSTER;
  const x1 = Math.min(W, x0 + CLUSTER), y1 = Math.min(H, y0 + CLUSTER);
  let any = false;
  for (let y = y0; y < y1; y++) {
    const r0 = base + y * W;
    lab.fill(0, r0 + x0, r0 + x1);
    if (!any) for (let i = r0 + x0; i < r0 + x1; i++) if (walk[i] !== 0) { any = true; break; }
  }
  if (!any) return 0;                       // all solid: nothing to flood (most deep rock)
  const st = stackBuf();
  let local = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = base + y * W + x;
      if (lab[i] !== 0 || !passW(walk[i], side)) continue;
      const id = c * LOCAL_MAX + local + 1;
      local++;
      let sp = 0; st[sp++] = i; lab[i] = id;
      while (sp > 0) {
        const j = st[--sp], jx = j % W, jy = ((j - base) / W) | 0;
        if (jx > x0) { const k = j - 1; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
        if (jx < x1 - 1) { const k = j + 1; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
        if (jy > y0) { const k = j - W; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
        if (jy < y1 - 1) { const k = j + W; if (lab[k] === 0 && passW(walk[k], side)) { lab[k] = id; st[sp++] = k; } }
      }
    }
  }
  return local;
}

/**
 * Label cluster c for both sides: the colonist set, then the hostile set, which is the same labelling unless a
 * door (WALK_DOOR) lies in the cluster, so it is copied (same tiles, same scan order, same ids). Returns the
 * colonist region count (the hostile one: lastHostileCount()).
 */
let lastH = 0;
/** The hostile region count of the last labelClusterBoth call. */
export const lastHostileCount = () => lastH;
export function labelClusterBoth(walk, lab, labH, c) {
  const cz = (c / (CW * CH)) | 0, cp = c - cz * CW * CH, base = cz * PLANE;
  const x0 = (cp % CW) * CLUSTER, y0 = ((cp / CW) | 0) * CLUSTER;
  const x1 = Math.min(W, x0 + CLUSTER), y1 = Math.min(H, y0 + CLUSTER);
  const n = labelCluster(walk, lab, c, 0);
  let door = false;
  if (n) for (let y = y0; y < y1 && !door; y++) for (let i = base + y * W + x0; i < base + y * W + x1; i++) if (walk[i] === WALK_DOOR) { door = true; break; }
  if (door) { lastH = labelCluster(walk, labH, c, 1); return n; }
  lastH = n;
  for (let y = y0; y < y1; y++) {
    const r0 = base + y * W;
    if (n === 0) labH.fill(0, r0 + x0, r0 + x1);
    else for (let i = r0 + x0; i < r0 + x1; i++) labH[i] = lab[i];
  }
  return n;
}

export function labelAll(walk, side, counts = null) {
  const lab = new Uint32Array(N);
  for (let c = 0; c < CLUSTERS; c++) { const n = labelCluster(walk, lab, c, side); if (counts) counts[c] = n; }
  return lab;
}

// ---- The region graph (Stage Z1 E3: vertical links, incremental only, canonical by value) ----------------
let par = null, sxs = null, sys = null, cnt = null;
const scratch = (slots) => {
  if (!par || par.length < slots) par = new Int32Array(slots);
  if (!sxs) { sxs = new Float64Array(LOCAL_MAX + 1); sys = new Float64Array(LOCAL_MAX + 1); cnt = new Uint16Array(LOCAL_MAX + 1); }
};
/** Size, floored centroid and region count of cluster c, from its labels (zeroing its slots first). */
function clusterStats(g, lab, c, known) {
  const cz = (c / (CW * CH)) | 0, cp = c - cz * CW * CH, base = cz * PLANE;
  const x0 = (cp % CW) * CLUSTER, y0 = ((cp / CW) | 0) * CLUSTER;
  const x1 = Math.min(W, x0 + CLUSTER), y1 = Math.min(H, y0 + CLUSTER), r0 = c * LOCAL_MAX;
  const before = g.nreg[c];
  if (before) {                                       // slots past nreg are always 0
    g.size.fill(0, r0 + 1, r0 + before + 1); g.cx.fill(0, r0 + 1, r0 + before + 1);
    g.cy.fill(0, r0 + 1, r0 + before + 1); g.comp.fill(0, r0 + 1, r0 + before + 1);
  }
  let n = 0;
  if (known === 0) { g.nreg[c] = 0; return -before; }  // the labelling found no region here
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const r = lab[base + y * W + x];
    if (!r) continue;
    const k = r - r0;
    cnt[k]++; sxs[k] += x; sys[k] += y;
    if (k > n) n = k;
  }
  for (let k = 1; k <= n; k++) {
    if (cnt[k]) { g.size[r0 + k] = cnt[k]; g.cx[r0 + k] = Math.floor(sxs[k] / cnt[k]); g.cy[r0 + k] = Math.floor(sys[k] / cnt[k]); }
    cnt[k] = 0; sxs[k] = 0; sys[k] = 0;               // the scratch is left zeroed
  }
  g.nreg[c] = n;
  return n - before;
}
/**
 * The crossings of cluster c (D = 1: into `map`, key -> the best crossing value, one link per region pair, as
 * Stage 2). half: only the right, bottom and upward faces (a full build visits every cluster, so each face once).
 * A crossing value is type * 2^21 + p (type 0: q = p + 1, 1: q = p + W, 2: q = p + PLANE), ranked by
 * rank * 2^23 (planar: the distance from the middle of the 16-tile border).
 */
function clusterLinks(lab, ter, c, map, half) {
  const cz = (c / (CW * CH)) | 0, cp = c - cz * CW * CH, base = cz * PLANE;
  const x0 = (cp % CW) * CLUSTER, y0 = ((cp / CW) | 0) * CLUSTER;
  const x1 = Math.min(W, x0 + CLUSTER), y1 = Math.min(H, y0 + CLUSTER);
  if (D > 1) { clusterPortals(lab, ter, cz, base, x0, y0, x1, y1, half); return; }
  // runs of crossings with the same pair are folded locally before touching the map
  let lk = -1, lv = 0;
  const flush = () => { if (lk >= 0) { const o = map.get(lk); if (o === undefined || lv < o) map.set(lk, lv); lk = -1; } };
  const add = (p, q, v) => {
    const a = lab[p], b = lab[q];
    if (a === 0 || b === 0 || a === b) return;
    const k = a * LINK_SPAN + b;                      // a < b: p lies in the lower cluster
    if (k === lk) { if (v < lv) lv = v; return; }
    flush(); lk = k; lv = v;
  };
  const mid = (t) => Math.abs(2 * (t & 15) - 15) * 8388608;
  if (x1 < W) for (let y = y0; y < y1; y++) { const i = base + y * W + x1 - 1; add(i, i + 1, mid(y) + i); }
  if (y1 < H) for (let x = x0; x < x1; x++) { const i = base + (y1 - 1) * W + x; add(i, i + W, mid(x) + 2097152 + i); }
  if (!half && x0 > 0) for (let y = y0; y < y1; y++) { const i = base + y * W + x0 - 1; add(i, i + 1, mid(y) + i); }
  if (!half && y0 > 0) for (let x = x0; x < x1; x++) { const i = base + (y0 - 1) * W + x; add(i, i + W, mid(x) + 2097152 + i); }
  flush();
}
const repP = (v) => v % 2097152;
const repQ = (v) => { const p = v % 2097152, t = Math.floor(v / 2097152) & 3; return p + (t === 0 ? 1 : t === 1 ? W : PLANE); };

// ---- Portals (D > 1): one link entry per crossing group, so a region pair joined in two places has two -------
// A planar group is a run of adjacent crossings along a border with the same region pair (its representative:
// the run's middle crossing); a vertical group is a 4-connected set of stair or ramp crossings with the same pair
// inside the cluster (its representative: the lowest voxel index). Entries are (key, value) sorted by key, then
// the representative's index.
let pk = new Float64Array(256), pv = new Float64Array(256), pn = 0;
function portal(k, v) {
  if (pn >= pk.length) { const a = new Float64Array(pk.length * 2); a.set(pk); pk = a; const b = new Float64Array(pv.length * 2); b.set(pv); pv = b; }
  pk[pn] = k; pv[pn++] = v;
}
const vmask = new Int32Array(CLUSTER * CLUSTER), vst = new Int32Array(CLUSTER * CLUSTER);
function clusterPortals(lab, ter, cz, base, x0, y0, x1, y1, half) {
  // planar faces: (p, q) pairs along a border line, in order
  const face = (p0, step, n, dq, type) => {
    let rk = -1, rs = 0;
    for (let t = 0; t <= n; t++) {
      let k = -1;
      if (t < n) {
        const p = p0 + t * step, a = lab[p], b = lab[p + dq];
        if (a !== 0 && b !== 0 && a !== b) k = a * LINK_SPAN + b;
      }
      if (k !== rk) {
        if (rk >= 0) portal(rk, type * 2097152 + p0 + ((rs + t - 1) >> 1) * step);
        rk = k; rs = t;
      }
    }
  };
  const nx = x1 - x0, ny = y1 - y0;
  if (x1 < W) face(base + y0 * W + x1 - 1, W, ny, 1, 0);
  if (y1 < H) face(base + (y1 - 1) * W + x0, 1, nx, W, 1);
  if (!half && x0 > 0) face(base + y0 * W + x0 - 1, W, ny, 1, 0);
  if (!half && y0 > 0) face(base + (y0 - 1) * W + x0, 1, nx, W, 1);
  if (!ter) return;
  // vertical faces: up (this level to the next) and, unless half, down (the level below to this one)
  for (let dir = 0; dir < (half ? 1 : 2); dir++) {
    const lo = dir === 0 ? base : base - PLANE;            // the lower level's base
    if (dir === 0 ? cz >= D - 1 : cz === 0) continue;
    let any = false;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = lo + y * W + x, j = i + PLANE, m = (y - y0) * CLUSTER + (x - x0);
      vmask[m] = 0;
      if (TER_UP[ter[i]] === 1 && TER_DOWN[ter[j]] === 1) {
        const a = lab[i], b = lab[j];
        if (a !== 0 && b !== 0 && a !== b) { vmask[m] = 1; any = true; }
      }
    }
    if (!any) continue;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const m0 = (y - y0) * CLUSTER + (x - x0);
      if (vmask[m0] !== 1) continue;
      const i0 = lo + y * W + x, a = lab[i0], b = lab[i0 + PLANE];
      // flood the group (same pair, 4-connected); the first tile in scan order is its lowest index
      let sp = 0; vst[sp++] = m0; vmask[m0] = 2;
      while (sp > 0) {
        const m = vst[--sp], mx = m % CLUSTER, my = (m / CLUSTER) | 0;
        for (let d = 0; d < 4; d++) {
          const ax = mx + (d === 0 ? 1 : d === 1 ? -1 : 0), ay = my + (d === 2 ? 1 : d === 3 ? -1 : 0);
          if (ax < 0 || ay < 0 || ax >= x1 - x0 || ay >= y1 - y0) continue;
          const am = ay * CLUSTER + ax;
          if (vmask[am] !== 1) continue;
          const ai = lo + (y0 + ay) * W + x0 + ax;
          if (lab[ai] !== a || lab[ai + PLANE] !== b) continue;
          vmask[am] = 2; vst[sp++] = am;
        }
      }
      portal(a * LINK_SPAN + b, 2 * 2097152 + i0);
    }
  }
}

/** linkStamp: a value hash (< 2^53) of the link set and its representatives (C13 v3: a value, not a counter). */
export function stampOf(links, ta, tb) {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  const mix = (v) => { h1 = Math.imul(h1 ^ v, 16777619); h2 = Math.imul(h2 ^ v, 2246822519) ^ (h2 >>> 13); };
  mix(links.length);
  for (let l = 0; l < links.length; l++) { const k = links[l]; mix(k % 4294967296); mix(Math.floor(k / 4294967296)); mix(ta[l]); mix(tb[l]); }
  return (h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff);
}

/**
 * Update a region graph for the clusters marked in `mark` (Uint8Array(CLUSTERS), 1 = relabelled), or build it
 * whole (prev null or mark null). Every value equals a full build from the same labels (C13 v3). counts (optional,
 * Uint8Array(CLUSTERS)): the region count of each relabelled cluster as its labelling returned it; a 0 skips
 * the cluster's scan.
 */
export function updateGraph(prev, lab, ter, mark, counts = null) {
  const slots = regionSlots();
  scratch(slots);
  const full = !mark || !prev || prev.slots !== slots || !prev.size || !prev.nreg || prev.nreg.length !== CLUSTERS;
  const g = full
    ? { slots, size: new Uint16Array(slots), cx: new Uint16Array(slots), cy: new Uint16Array(slots), comp: new Uint32Array(slots), nreg: new Uint8Array(CLUSTERS), links: new Float64Array(0), ta: new Uint32Array(0), tb: new Uint32Array(0), stamp: 0, regions: 0 }
    : { slots, size: prev.size, cx: prev.cx, cy: prev.cy, comp: prev.comp, nreg: prev.nreg, links: prev.links, ta: prev.ta, tb: prev.tb, stamp: prev.stamp, regions: prev.regions };
  const map = new Map();
  pn = 0;
  for (let c = 0; c < CLUSTERS; c++) {
    if (!full && !mark[c]) continue;
    g.regions += clusterStats(g, lab, c, counts ? counts[c] : -1);
    if (g.nreg[c]) clusterLinks(lab, ter, c, map, full);   // a link needs labels on both sides
  }
  // the new entries, sorted by (key, representative) and deduplicated (a face between two relabelled clusters
  // is found from both)
  for (const [k, v] of map) portal(k, v);
  const ord = new Int32Array(pn);
  for (let j = 0; j < pn; j++) ord[j] = j;
  ord.sort((x, y) => pk[x] - pk[y] || repP(pv[x]) - repP(pv[y]));
  const nk = new Float64Array(pn), nv = new Float64Array(pn);
  let m = 0;
  for (let j = 0; j < pn; j++) { const o = ord[j]; if (m && nk[m - 1] === pk[o] && nv[m - 1] === pv[o]) continue; nk[m] = pk[o]; nv[m++] = pv[o]; }
  // links: the kept ones (touching no relabelled cluster; still sorted) merged with the new ones
  const old = g.links, oa = g.ta, ob = g.tb;
  const links = new Float64Array(old.length + m), ta = new Uint32Array(links.length), tb = new Uint32Array(links.length);
  let n = 0, p = 0, q = 0;
  const keep = (l) => { const k = old[l]; return full ? false : !mark[clusterOfRegion(Math.floor(k / LINK_SPAN))] && !mark[clusterOfRegion(k % LINK_SPAN)]; };
  while (p < old.length && !keep(p)) p++;
  while (p < old.length || q < m) {
    if (q >= m || (p < old.length && (old[p] < nk[q] || (old[p] === nk[q] && oa[p] < repP(nv[q]))))) {
      links[n] = old[p]; ta[n] = oa[p]; tb[n] = ob[p]; n++;
      p++; while (p < old.length && !keep(p)) p++;
    } else {
      links[n] = nk[q]; ta[n] = repP(nv[q]); tb[n] = repQ(nv[q]); n++; q++;
    }
  }
  let same = n === old.length;
  for (let l = 0; same && l < n; l++) if (links[l] !== old[l] || ta[l] !== oa[l] || tb[l] !== ob[l]) same = false;
  if (!same || full) {
    // keep the same arrays while nothing changed: their identity keys linkCache (regiongraph.js)
    g.links = links.slice(0, n); g.ta = ta.slice(0, n); g.tb = tb.slice(0, n);
    g.stamp = stampOf(g.links, g.ta, g.tb);
  }
  // components: union-find over the live regions; canonical root = the smallest region id
  for (let c = 0; c < CLUSTERS; c++) { const r0 = c * LOCAL_MAX, nr = g.nreg[c]; for (let k = 1; k <= nr; k++) par[r0 + k] = r0 + k; }
  const find = (r) => { while (par[r] !== r) { par[r] = par[par[r]]; r = par[r]; } return r; };
  const L = g.links;
  for (let l = 0; l < L.length; l++) {
    const a = find(Math.floor(L[l] / LINK_SPAN)), b = find(L[l] % LINK_SPAN);
    if (a !== b) { if (a < b) par[b] = a; else par[a] = b; }
  }
  for (let c = 0; c < CLUSTERS; c++) { const r0 = c * LOCAL_MAX, nr = g.nreg[c]; for (let k = 1; k <= nr; k++) g.comp[r0 + k] = find(r0 + k); }
  return g;
}

/** The region graph of one label set, from scratch (ter: terrain for the vertical links; null = planar only). */
export const buildGraph = (lab, ter = null, counts = null) => updateGraph(null, lab, ter, null, counts);

// ---- C13 rebuilds (pure functions of saved state) ----------------------------------------------
export const regionRebuild = (s) => labelAll(walkRebuild(s), SIDE.COL);
export const regionHRebuild = (s) => labelAll(walkRebuild(s), SIDE.HOS);
export function regionGraphRebuild(s) {
  const walk = walkRebuild(s), ter = s.L.terrain, nc = new Uint8Array(CLUSTERS), nh = new Uint8Array(CLUSTERS);
  const lc = labelAll(walk, SIDE.COL, nc), lh = labelAll(walk, SIDE.HOS, nh);
  return { col: buildGraph(lc, ter, nc), hos: buildGraph(lh, ter, nh) };
}

/** Full relabel of the live runtime from rt.walkCost (initRuntime, or a pass with no tile list). */
export function relabelAll(s) {
  const rt = s.rt;
  const nc = cntC(), nh = cntH();
  for (let c = 0; c < CLUSTERS; c++) { nc[c] = labelClusterBoth(rt.walkCost, rt.region, rt.regionH, c); nh[c] = lastH; }
  rt.regionGraph = { col: buildGraph(rt.region, s.L.terrain, nc), hos: buildGraph(rt.regionH, s.L.terrain, nh) };
}

let mark = null, cc = null, chh = null;
const cntC = () => (cc && cc.length === CLUSTERS ? cc : (cc = new Uint8Array(CLUSTERS)));
const cntH = () => (chh && chh.length === CLUSTERS ? chh : (chh = new Uint8Array(CLUSTERS)));
/**
 * The endOfTick 'regions' pass: relabel the clusters of every dirty tile, then update the graph for those
 * clusters only (their links, vertical ones to z +- 1 included). A new graph object each pass (D = 1
 * regionDist caches rows per object); its arrays are shared and patched.
 */
export function regionsPass(s, d = s.rt.dirty) {
  const rt = s.rt;
  if (!(rt.region instanceof Uint32Array) || rt.region.length !== N) rt.region = new Uint32Array(N);
  if (!(rt.regionH instanceof Uint32Array) || rt.regionH.length !== N) rt.regionH = new Uint32Array(N);
  const tiles = d && d.tiles;
  const g = rt.regionGraph;
  if (!tiles || tiles.length === 0 || !g || !g.col || !g.col.nreg) { relabelAll(s); return CLUSTERS; }
  if (!mark || mark.length !== CLUSTERS) mark = new Uint8Array(CLUSTERS);
  mark.fill(0);
  const nc = cntC(), nh = cntH();
  for (let k = 0; k < tiles.length; k++) {
    const i = tiles[k];
    if (i >= 0 && i < N) mark[clusterOf(i)] = 1;
  }
  let n = 0;
  for (let c = 0; c < CLUSTERS; c++) {
    if (!mark[c]) continue;
    nc[c] = labelClusterBoth(rt.walkCost, rt.region, rt.regionH, c); nh[c] = lastH;
    n++;
  }
  rt.regionGraph = { col: updateGraph(g.col, rt.region, s.L.terrain, mark, nc), hos: updateGraph(g.hos, rt.regionH, s.L.terrain, mark, nh) };
  return n;
}

// ---- Read API (re-exported by terrain.js) ------------------------------------------------------
const labOf = (s, side) => (sideOf(side) === 1 ? s.rt.regionH : s.rt.region);
const graphOf = (s, side) => { const g = s.rt.regionGraph; return g && (sideOf(side) === 1 ? g.hos : g.col); };

/** linkStamp of a side (C13 v3, 6.2): a value hash of the link set; changes only when a link or its cost does. */
export const linkStamp = (s, side = 0) => { const g = graphOf(s, side); return g ? g.stamp : 0; };
/** The cached link Dijkstra toward `goal` for a side (regiongraph.js; pathing's link heuristic). */
export const linkRow = (s, goal, mode = 0, slack = 0, side = 0) => linkDijkstra(graphOf(s, side), labOf(s, side), goal, mode, slack);
export { linkH, linkHAt, linkBest };

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
  for (let k = 0; k < g.links.length; k++) { deg[linkA(g.links[k])]++; deg[linkB(g.links[k])]++; }
  const start = new Int32Array(g.slots + 1);
  for (let r = 1; r <= g.slots; r++) start[r] = start[r - 1] + deg[r - 1];
  const fill = start.slice(), adj = new Int32Array(g.links.length * 2);
  for (let k = 0; k < g.links.length; k++) {
    const a = linkA(g.links[k]), b = linkB(g.links[k]);
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
  if (D > 1) return regionDist3(g, lab, a, b);
  const ra = lab[a], rb = lab[b];
  if (!ra || !rb || !g || !g.comp || g.comp[ra] !== g.comp[rb]) return Infinity;
  const ax = a % W, ay = ((a % PLANE) / W) | 0, bx = b % W, by = ((b % PLANE) / W) | 0;
  if (ra === rb) return octile(ax, ay, bx, by);
  const mid = distRow(g, ra)[rb];
  return octile(ax, ay, g.cx[ra], g.cy[ra]) + mid + octile(g.cx[rb], g.cy[rb], bx, by);
}
