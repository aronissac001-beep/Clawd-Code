// The region link graph in 3D (owner B; Stage Z1 E3, EMBERCROWN-FORTRESS.md 6.2, 7.3): the link Dijkstra
// per goal (rt `linkCache`, DERIVED_PURE), the link heuristic for 3D A*, and regionDist in 3D.
//
//   A link joins two regions (regions.js): planar across a 16 x 16 cluster border on one level, or vertical
//   at a stair or ramp column (TER_UP at z under TER_DOWN at z + 1). At D > 1 there is one link entry per
//   crossing group (a run along a border, or a 4-connected group of stairs), each with a FIXED representative
//   crossing (ta in the lower region id, tb in the other: the run's middle, the group's lowest voxel index), so
//   reshaping a region away from its borders changes no link cost. A crossing costs 100 planar, PATH.VERT (200) vertical.
//   Node 2l + s is "standing at link l's tile on side s" (s 0: ta in region a, 1: tb in region b).
//
//   linkDijkstra(g, lab, goal, mode) -> row cost[node] = estimated cost (100 per tile, octile + VERT x |dz|)
//                                           from the node's tile to the goal over the link graph. Seeded from
//                                           the goal's region (and, for ADJ goals, the regions of its
//                                           neighbours on its level). Lazy: a row settles only the nodes its
//                                           queries need, and every answer equals the full Dijkstra's.
//   linkH(D, lab, i)                        the link heuristic at voxel i (RimWorld-style region cost): the
//                                           octile in a seed region, else the best link of i's region plus the
//                                           octile to it, never below the plain octile. Not admissible:
//                                           paths may be slightly longer than optimal (bench: mean <= 1.08x).
//   regionDist3(...)                        regionDist on a D > 1 map, from the cached Dijkstra of `a`.
//
// linkCache: keyed by the link arrays' identity (regions.js keeps the same arrays while the link set and
// every representative are unchanged; that is linkStamp) and by (goal, mode, seed regions). A hit equals a
// rebuild; misses are uncapped; an LRU evicts, which costs only time (C13 F25). Nothing here is saved.

import { W, PLANE, D } from '../core/grid.js';

export const VERT = 200;                 // = pathing PATH.VERT (2 tiles of walking)
export const CROSS = 100;                // one orthogonal step across a cluster border
const SPAN = 1048576;                    // regions.js LINK_SPAN
const INF = 0x3fffffff;
const LRU = 64;
const LINK_SLACK = 100;                  // the link estimate's slack (1 tile; see linkHAt)

const oct100 = (dx, dy) => (dx > dy ? 100 * dx + 40 * dy : 100 * dy + 40 * dx);
/** Octile distance x100 between voxels, plus VERT per level. */
export function octT(a, b) {
  const za = (a / PLANE) | 0, zb = (b / PLANE) | 0, ra = a - za * PLANE, rb = b - zb * PLANE;
  return oct100(Math.abs((ra % W) - (rb % W)), Math.abs(((ra / W) | 0) - ((rb / W) | 0))) + VERT * Math.abs(za - zb);
}

/** Non-sim statistics for the benches (the sim never reads them). */
export const linkStats = { builds: 0, settled: 0, ms: 0 };
let clock = null;
/** Benches: a clock (() => ms) so linkStats.ms sums the Dijkstra time. */
export function setLinkClock(fn) { clock = fn || null; }

// ---- Per link set: adjacency tables (built once per link set) -------------------------------------
//   rStart/rNode: region r -> its link nodes on r's side (CSR); per node: tile x, y, z; nStart/nNb/nW: node ->
//   the other nodes of its region with the octile between the two tiles (static for the link set); cross[l].
let tables = new WeakMap();              // links array -> table
/** Drop every cached table and row (benches and tests: a cold cache answers the same, only slower). */
export function linkCacheClear() { tables = new WeakMap(); }
function tableOf(g) {
  let t = tables.get(g.links);
  if (t) return t;
  const L = g.links.length, slots = g.slots, M = 2 * L;
  const rStart = new Int32Array(slots + 1);
  for (let l = 0; l < L; l++) { const k = g.links[l]; rStart[Math.floor(k / SPAN) + 1]++; rStart[(k % SPAN) + 1]++; }
  for (let r = 0; r < slots; r++) rStart[r + 1] += rStart[r];
  const fill = rStart.slice(0, slots), rNode = new Int32Array(M);
  for (let l = 0; l < L; l++) { const k = g.links[l]; rNode[fill[Math.floor(k / SPAN)]++] = 2 * l; rNode[fill[k % SPAN]++] = 2 * l + 1; }
  const nx = new Int32Array(M), ny = new Int32Array(M), nz = new Int32Array(M), nReg = new Int32Array(M);
  for (let n = 0; n < M; n++) {
    const ti = n & 1 ? g.tb[n >> 1] : g.ta[n >> 1], z = (ti / PLANE) | 0, rr = ti - z * PLANE;
    nx[n] = rr % W; ny[n] = (rr / W) | 0; nz[n] = z;
    const k = g.links[n >> 1];
    nReg[n] = n & 1 ? k % SPAN : Math.floor(k / SPAN);
  }
  const nStart = new Int32Array(M + 1);
  for (let n = 0; n < M; n++) { const r = nReg[n]; nStart[n + 1] = nStart[n] + (rStart[r + 1] - rStart[r] - 1); }
  const nNb = new Int32Array(nStart[M]), nW = new Int32Array(nStart[M]);
  for (let n = 0, e = 0; n < M; n++) {
    const r = nReg[n];
    for (let f = rStart[r]; f < rStart[r + 1]; f++) {
      const m = rNode[f];
      if (m === n) continue;
      const dx = Math.abs(nx[m] - nx[n]), dy = Math.abs(ny[m] - ny[n]);
      nNb[e] = m; nW[e++] = (dx > dy ? 100 * dx + 40 * dy : 100 * dy + 40 * dx) + VERT * Math.abs(nz[m] - nz[n]);
    }
  }
  const cross = new Int32Array(L);
  for (let l = 0; l < L; l++) cross[l] = D > 1 && g.tb[l] - g.ta[l] === PLANE ? VERT : CROSS;
  t = { rStart, rNode, nx, ny, nz, nReg, nStart, nNb, nW, cross, rows: new Map() };
  tables.set(g.links, t);
  return t;
}

/** Seed regions of a goal: its own region, plus (ADJ4 / ADJ8, mode 1 / 2) its planar neighbours' on its level. */
export function seedRegions(lab, goal, mode) {
  const out = [];
  const add = (i) => { const r = lab[i]; if (r && !out.includes(r)) out.push(r); };
  add(goal);
  if (mode) {
    const z = (goal / PLANE) | 0, base = z * PLANE, x = goal % W, y = ((goal - base) / W) | 0, H = PLANE / W;
    const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];
    for (let d = 0; d < (mode === 1 ? 4 : 8); d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) add(base + ny * W + nx);
    }
  }
  return out.sort((a, b) => a - b);
}

// ---- The lazy link Dijkstra ---------------------------------------------------------------------------
// A row holds a Dijkstra that settles nodes only as far as a query needs (resumable: its heap is kept). A
// query for voxel i settles nodes until the cheapest unsettled cost is no lower than the best answer from
// i's region's settled nodes, so every answer is exactly the full Dijkstra's (unsettled nodes can only be
// dearer): a hit, a partial row and a fresh one answer alike (C13 F25).
function hpush(row, c, v) {
  let hc = row.hc, hv = row.hv;
  if (row.hn >= hc.length) { const x = new Int32Array(hc.length * 2); x.set(hc); row.hc = hc = x; const y = new Int32Array(hv.length * 2); y.set(hv); row.hv = hv = y; }
  let p = row.hn++;
  while (p > 0) { const q = (p - 1) >> 1; if (hc[q] < c || (hc[q] === c && hv[q] < v)) break; hc[p] = hc[q]; hv[p] = hv[q]; p = q; }
  hc[p] = c; hv[p] = v;
}
/** Pop and settle the cheapest node; returns it, or -1 when the top entry was stale. */
function settleOne(row) {
  const hc = row.hc, hv = row.hv;
  const n = hv[0], c = hc[0];
  const lc = hc[--row.hn], lv = hv[row.hn], hn = row.hn;
  let p = 0;
  for (;;) {
    const l = 2 * p + 1; if (l >= hn) break;
    const r = l + 1, m = r < hn && (hc[r] < hc[l] || (hc[r] === hc[l] && hv[r] < hv[l])) ? r : l;
    if (hc[m] > lc || (hc[m] === lc && hv[m] > lv)) break;
    hc[p] = hc[m]; hv[p] = hv[m]; p = m;
  }
  hc[p] = lc; hv[p] = lv;
  const { cost, done } = row;
  if (done[n] || c !== cost[n]) return -1;
  done[n] = 1; row.settled++;
  const { nStart, nNb, nW, cross } = row.t;
  const far = n ^ 1, cf = c + cross[n >> 1];
  if (cf < cost[far]) { cost[far] = cf; hpush(row, cf, far); }
  for (let e = nStart[n]; e < nStart[n + 1]; e++) {
    const m = nNb[e], cn = c + nW[e];
    if (cn < cost[m]) { cost[m] = cn; hpush(row, cn, m); }
  }
  return n;
}

/**
 * The link Dijkstra row toward `goal` (cached; see the header). slack: the heuristic slack of the goal mode
 * (0 TILE, 100 ADJ4, 140 ADJ8), taken off every seed. Settled lazily by linkBest.
 */
export function linkDijkstra(g, lab, goal, mode = 0, slack = 0) {
  const t = tableOf(g);
  const seeds = seedRegions(lab, goal, mode);
  const key = goal + ':' + mode + ':' + slack + ':' + seeds.join(',');
  let row = t.rows.get(key);
  if (row) { t.rows.delete(key); t.rows.set(key, row); return row; }
  const M = 2 * g.links.length;
  row = { t, cost: new Int32Array(M).fill(INF), done: new Uint8Array(M), hc: new Int32Array(64), hv: new Int32Array(64), hn: 0, settled: 0, seeds, goal, slack };
  const { rStart, rNode, nz } = t, cost = row.cost;
  const gz = (goal / PLANE) | 0, gr = goal - gz * PLANE, gx = gr % W, gy = (gr / W) | 0;
  for (const r of seeds) {
    for (let e = rStart[r]; e < rStart[r + 1]; e++) {
      const n = rNode[e], dx = Math.abs(t.nx[n] - gx), dy = Math.abs(t.ny[n] - gy);
      const c = Math.max(0, (dx > dy ? 100 * dx + 40 * dy : 100 * dy + 40 * dx) + VERT * Math.abs(nz[n] - gz) - slack);
      if (c < cost[n]) { cost[n] = c; hpush(row, c, n); }
    }
  }
  if (t.rows.size >= LRU) t.rows.delete(t.rows.keys().next().value);
  t.rows.set(key, row);
  linkStats.builds++;
  return row;
}
/** Settle a row completely (benches, tests). */
export function linkSettleAll(row) { while (row.hn > 0) settleOne(row); return row; }

/** The best link estimate from voxel i (100 per tile), or INF when i's region has no finite link. Exact. */
export function linkBest(row, lab, i) {
  const z = (i / PLANE) | 0, rr = i - z * PLANE;
  return linkBestAt(row, lab[i], rr % W, (rr / W) | 0, z);
}
/** linkBest for a voxel at (x, y, z) in region r. */
export function linkBestAt(row, r, x, y, z) {
  if (!r) return INF;
  const { t, cost, done } = row, { rStart, rNode, nx, ny, nz, nReg } = t;
  let best = INF;
  for (let e = rStart[r]; e < rStart[r + 1]; e++) {
    const n = rNode[e];
    if (done[n] === 0) continue;
    const dx = Math.abs(nx[n] - x), dy = Math.abs(ny[n] - y);
    const v = cost[n] + (dx > dy ? 100 * dx + 40 * dy : 100 * dy + 40 * dx) + VERT * Math.abs(nz[n] - z);
    if (v < best) best = v;
  }
  if (row.hn > 0 && row.hc[0] < best) {
    const t0 = clock ? clock() : 0, s0 = row.settled;
    while (row.hn > 0 && row.hc[0] < best) {
      const n = settleOne(row);
      if (n >= 0 && nReg[n] === r) {
        const dx = Math.abs(nx[n] - x), dy = Math.abs(ny[n] - y);
        const v = cost[n] + (dx > dy ? 100 * dx + 40 * dy : 100 * dy + 40 * dx) + VERT * Math.abs(nz[n] - z);
        if (v < best) best = v;
      }
    }
    linkStats.settled += row.settled - s0;
    if (clock) linkStats.ms += clock() - t0;
  }
  return best;
}
/** The link heuristic for a voxel at (x, y, z) in region r whose plain octile (minus the slack) is `plain`. */
export function linkHAt(row, r, x, y, z, plain) {
  if (!r) return plain;
  const sd = row.seeds;
  for (let k = 0; k < sd.length; k++) if (sd[k] === r) return plain;
  const best = linkBestAt(row, r, x, y, z);
  const sc = best < INF ? best - LINK_SLACK : 0;
  return sc > plain ? sc : plain;
}
/**
 * Link heuristic at voxel i (100 per tile): the plain octile in a seed region, else max(plain, the best link
 * minus LINK_SLACK). With one link entry per crossing group (regions.js portals) the estimate rarely
 * overshoots (bench maze3d: cost mean 1.02x, p95 1.07x of optimal; flat3d 1.04x / 1.14x).
 */
export function linkH(row, lab, i) {
  const plain = Math.max(0, octT(i, row.goal) - row.slack), r = lab[i];
  if (!r || row.seeds.includes(r)) return plain;
  const best = linkBest(row, lab, i);
  const sc = best < INF ? best - LINK_SLACK : 0;
  return sc > plain ? sc : plain;
}

/**
 * regionDist on a D > 1 map (tenths of a tile: orthogonal 10, diagonal 14, a level 20), or Infinity when b
 * cannot be reached from a. Same region: the octile; otherwise the link-graph distance from a's cached
 * Dijkstra. Never calls A*.
 */
export function regionDist3(g, lab, a, b) {
  const ra = lab[a], rb = lab[b];
  if (!ra || !rb || !g || !g.comp || g.comp[ra] !== g.comp[rb]) return Infinity;
  if (ra === rb) return octT(a, b) / 10;
  const v = linkBest(linkDijkstra(g, lab, a, 0, 0), lab, b);
  return v < INF ? v / 10 : Infinity;
}
