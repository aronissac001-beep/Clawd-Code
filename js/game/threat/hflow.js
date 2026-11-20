// Hierarchical flow for raids on a D > 1 map (EMBERCROWN-FORTRESS.md F5, 6.2, 7.3; Stage Z1 step E11). Owner H.
// The D = 1 game keeps flow.js's whole saved fields untouched until the switch (E13); flow.js dispatches here
// when D > 1, and then rt.flow stays empty: nothing of this module is ever saved.
//
// One "level" object per (hostile region graph object, goal seeds, smash set): `lvl`. Both caches are
// DERIVED_PURE (C13 v3): a lvl is a pure function of its key, and so is every value it hands out, whatever was
// asked before (a hit equals a rebuild; misses are uncapped; an LRU may evict, which costs only time).
//   Region level (hflow.region): a lazy, resumable Dijkstra from the goal over the hostile regions (rt.regionH,
//     rt.regionGraph.hos) plus one node per smashable voxel (a finished wall, door or gate: its smash cost from
//     its hp band, flow.js SMASH, is paid to enter it). Rc[x] = the estimated cost (x10 per tile, the walkCost
//     units; a level is VERT10 = 20) from node x to the goal; region-to-region weights are the octile between
//     centroids plus VERT10 x |dz|. Lazy: a query settles nodes only until the asked region is settled, and a
//     settled value is the full Dijkstra's (C13: the order of queries never changes an answer).
//   Local fields (hflow.local): per region r (one 16 x 16 cluster on one level), the exact walk cost inside r
//     to the cheapest way on, seeded from the goal tiles in r (and tiles next to an unwalkable goal, the Hearth)
//     and from every EXIT: a tile of r next to (4-way, or by a stair or ramp) a region or smash node q that is
//     settled with Rc[q] < Rc[r], at Rc[q] + the cost of entering q. Built on demand, uncapped, LRU 512.
//   A step (hStep) goes to the neighbour with the lowest value: in r its local value; across into q (only when
//     Rc[q] < Rc[r]) Rc[q] + entry - 1. So every step lowers the pair (Rc of the region, local value)
//     lexicographically: no loops, and from any voxel with a finite value the walk ends at the goal (or at the
//     unwalkable goal or smash voxel it then claws or breaks, as on the D = 1 field).
// The sapper dig field is planar in Z1 (2.10): one PLANE-sized field on the dig target's level, with rock at
// DIG_COST; delvers on that level walk it, elsewhere they walk the hierarchical flow.

import { W, H, D, PLANE, DX8, DY8, CW, CH, TER, TER_UP, TER_DOWN } from '../core/grid.js';
import { stepCost, SIDE, footprint } from '../world/pass.js';
import { LOCAL_MAX, LINK_SPAN } from '../world/regions.js';

export const INF = 0x3fffffff;
export const VERT10 = 20;               // a climb costs 2 tiles of walking (pathing PATH.VERT)
const LOCAL_LRU = 512;
const DIAG = (c) => ((c * 14 + 5) / 10) | 0;
const oct10 = (dx, dy) => { dx = dx < 0 ? -dx : dx; dy = dy < 0 ? -dy : dy; return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx; };

/** Non-sim statistics for the bench and tests (the sim never reads them). */
export const hflowStats = { levels: 0, settled: 0, locals: 0 };

// ---- Region adjacency per graph object (CSR over g.links; a graph is replaced, never patched, per pass) ----
const csrCache = new WeakMap();
function csrOf(g) {
  let c = csrCache.get(g);
  if (c) return c;
  const slots = g.slots, L = g.links, deg = new Int32Array(slots + 1);
  for (let k = 0; k < L.length; k++) { deg[Math.floor(L[k] / LINK_SPAN)]++; deg[L[k] % LINK_SPAN]++; }
  const start = new Int32Array(slots + 1);
  for (let r = 1; r <= slots; r++) start[r] = start[r - 1] + deg[r - 1];
  const fill = start.slice(0, slots), adj = new Int32Array(L.length * 2);
  for (let k = 0; k < L.length; k++) { const a = Math.floor(L[k] / LINK_SPAN), b = L[k] % LINK_SPAN; adj[fill[a]++] = b; adj[fill[b]++] = a; }
  c = { start, adj };
  csrCache.set(g, c);
  return c;
}
const regionZ = (r) => ((((r - 1) / LOCAL_MAX) | 0) / (CW * CH)) | 0;

// ---- Inputs: smash set and its hash ------------------------------------------------------------------
/** Smash voxels [voxel, entry cost] for hostiles, ascending by voxel (finished walls, doors and gates). */
export function smashList(s, smashable, smashCost) {
  const out = [];
  for (const b of s.bld) {
    if (!b || !smashable(b)) continue;
    const c = smashCost(b);
    for (const i of footprint(s, b)) out.push([i, c]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
/** FNV-1a over [voxel, cost] pairs (or bare voxels). */
export function pairsHash(list) {
  let h = 0x811c9dc5;
  for (const e of list) {
    const a = typeof e === 'number' ? e : e[0], b = typeof e === 'number' ? 0 : e[1] | 0;
    h = Math.imul(h ^ (a & 0xffff), 0x01000193); h = Math.imul(h ^ (a >>> 16), 0x01000193); h = Math.imul(h ^ b, 0x01000193);
  }
  return (h >>> 0) + ':' + list.length;
}

// ---- Building a level -------------------------------------------------------------------------------
const lvlCache = new WeakMap();          // graph object -> Map(goal name -> lvl)
const lastOf = new WeakMap();            // state -> Map(goal name -> its newest lvl): array recycling only
/**
 * The level object for goal `name` with goal seeds `goals` ([voxel, start cost] or voxels) and smash pairs.
 * keys: the precomputed hashes { g: goals hash, x: smash hash } (the caller memoises them per tick).
 */
export function levelFor(s, name, goals, smash, keys) {
  const g = s.rt.regionGraph && s.rt.regionGraph.hos;
  if (!g || !g.slots) return null;
  let m = lvlCache.get(g);
  if (!m) { m = new Map(); lvlCache.set(g, m); }
  const key = keys.g + '|' + keys.x;
  const old = m.get(name);
  if (old && old.key === key) return old;
  // recycle the arrays of this state's last level of the same goal (it is never asked again: a level is current
  // only while its graph object and key are, and both have just moved on)
  let last = lastOf.get(s);
  if (!last) { last = new Map(); lastOf.set(s, last); }
  const lvl = buildLevel(s, g, goals, smash, key, name, last.get(name) || null);
  m.set(name, lvl); last.set(name, lvl);
  return lvl;
}

function buildLevel(s, g, goals, smash, key, name, prev) {
  hflowStats.levels++;
  const lab = s.rt.regionH, slots = g.slots, nS = smash.length, M = slots + nS;
  const smashT = new Int32Array(nS), smashC = new Int32Array(nS), smashAt = new Map();
  for (let k = 0; k < nS; k++) { smashT[k] = smash[k][0]; smashC[k] = smash[k][1]; smashAt.set(smash[k][0], k); }
  // smash adjacency (4-way on its level): sAdj[k] = node ids; rSmash: region -> smash ks next to it
  const sAdj = new Array(nS), rSmash = new Map();
  for (let k = 0; k < nS; k++) {
    const t = smashT[k], z = (t / PLANE) | 0, rr = t - z * PLANE, x = rr % W, y = (rr / W) | 0, nb = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = t + DY8[d] * W + DX8[d], q = lab[j];
      if (q) { if (!nb.includes(q)) nb.push(q); const l = rSmash.get(q); if (!l) rSmash.set(q, [k]); else if (!l.includes(k)) l.push(k); }
      else { const k2 = smashAt.get(j); if (k2 !== undefined) nb.push(slots + k2); }
    }
    sAdj[k] = nb;
  }
  const goalAt = new Map();
  for (const e of goals) { const i = typeof e === 'number' ? e : e[0], c0 = typeof e === 'number' ? 0 : e[1] | 0; if (!goalAt.has(i) || goalAt.get(i) > c0) goalAt.set(i, c0); }
  const lvl = { name, key, g, lab, slots, nS, smashT, smashC, smashAt, sAdj, rSmash, goalAt, csr: csrOf(g),
    dist: null, done: null, tch: null, nt: 0, hc: new Int32Array(64), hv: new Int32Array(64), hn: 0,
    local: new Map(), dig: null, h: true, goalPad: new Map() };
  if (prev && prev.dist.length === M) {
    const { dist, done, tch } = prev;
    for (let k = 0; k < prev.nt; k++) { dist[tch[k]] = INF; done[tch[k]] = 0; }
    lvl.dist = dist; lvl.done = done; lvl.tch = tch;
    prev.dist = prev.done = null;   // a recycled level must never answer again
  } else { lvl.dist = new Int32Array(M).fill(INF); lvl.done = new Uint8Array(M); lvl.tch = new Int32Array(256); }
  // per cluster holding a goal voxel or touching one: its goals on the 18 x 18 padded grid (start cost + 1; 0 none)
  for (const [i, c0] of goalAt) {
    const z = (i / PLANE) | 0, rr = i - z * PLANE, x = rr % W, y = (rr / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const cl = (z * CH + (ny >> 4)) * CW + (nx >> 4);
      let pad = lvl.goalPad.get(cl);
      if (!pad) { pad = new Int32Array(324); lvl.goalPad.set(cl, pad); }
      const px = x - ((nx >> 4) << 4) + 1, py = y - ((ny >> 4) << 4) + 1;
      if (px >= 0 && py >= 0 && px < 18 && py < 18) { const k = py * 18 + px; if (!pad[k] || pad[k] > c0 + 1) pad[k] = c0 + 1; }
    }
  }
  // seeds: the goal's region at its start cost; an unwalkable goal voxel (the Hearth) seeds the regions beside it
  for (const [i, c0] of goalAt) {
    const r = lab[i];
    if (r) { relax(lvl, r, c0); continue; }
    if (smashAt.has(i)) continue;
    const z = (i / PLANE) | 0, rr = i - z * PLANE, x = rr % W, y = (rr / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = lab[i + DY8[d] * W + DX8[d]];
      if (q) relax(lvl, q, c0 + (d < 4 ? 10 : 14));
    }
  }
  return lvl;
}

function relax(lvl, n, c) {
  if (c >= lvl.dist[n]) return;
  if (lvl.dist[n] === INF) {
    if (lvl.nt >= lvl.tch.length) { const a = new Int32Array(lvl.tch.length * 2); a.set(lvl.tch); lvl.tch = a; }
    lvl.tch[lvl.nt++] = n;
  }
  lvl.dist[n] = c;
  let hc = lvl.hc, hv = lvl.hv;
  if (lvl.hn >= hc.length) { const a = new Int32Array(hc.length * 2); a.set(hc); lvl.hc = hc = a; const b = new Int32Array(hv.length * 2); b.set(hv); lvl.hv = hv = b; }
  let p = lvl.hn++;
  while (p > 0) { const q = (p - 1) >> 1; if (hc[q] < c || (hc[q] === c && hv[q] < n)) break; hc[p] = hc[q]; hv[p] = hv[q]; p = q; }
  hc[p] = c; hv[p] = n;
}
/** Pop the cheapest entry and settle it (its incoming edges: Rc[x] = Rc[u] + cost(x -> u)). */
function settleOne(lvl) {
  const hc = lvl.hc, hv = lvl.hv, u = hv[0], c = hc[0];
  const lc = hc[--lvl.hn], lv = hv[lvl.hn], hn = lvl.hn;
  let p = 0;
  for (;;) {
    const l = 2 * p + 1; if (l >= hn) break;
    const r = l + 1, m = r < hn && (hc[r] < hc[l] || (hc[r] === hc[l] && hv[r] < hv[l])) ? r : l;
    if (hc[m] > lc || (hc[m] === lc && hv[m] > lv)) break;
    hc[p] = hc[m]; hv[p] = hv[m]; p = m;
  }
  hc[p] = lc; hv[p] = lv;
  if (lvl.done[u] || c !== lvl.dist[u]) return;
  lvl.done[u] = 1; hflowStats.settled++;
  const { g, slots } = lvl;
  if (u < slots) {
    const { start, adj } = lvl.csr, ux = g.cx[u], uy = g.cy[u], uz = regionZ(u);
    for (let e = start[u]; e < start[u + 1]; e++) {
      const q = adj[e];
      if (lvl.done[q]) continue;
      const w = Math.max(10, oct10(g.cx[q] - ux, g.cy[q] - uy) + VERT10 * Math.abs(regionZ(q) - uz));
      relax(lvl, q, c + w);
    }
    const ks = lvl.rSmash.get(u);
    if (ks) for (const k of ks) {
      const t = lvl.smashT[k], rr = t % PLANE;
      relax(lvl, slots + k, c + Math.max(10, oct10((rr % W) - ux, ((rr / W) | 0) - uy)));
    }
  } else {
    const k = u - slots, t = lvl.smashT[k], rr = t % PLANE, tx = rr % W, ty = (rr / W) | 0, enter = lvl.smashC[k];
    for (const x of lvl.sAdj[k]) {
      if (lvl.done[x]) continue;
      if (x < slots) relax(lvl, x, c + enter + Math.max(10, oct10(g.cx[x] - tx, g.cy[x] - ty)));
      else relax(lvl, x, c + enter + 10);
    }
  }
}
/** Rc of node n, settling the lazy Dijkstra as far as needed (INF when the goal cannot be reached). Exact. */
export function nodeCost(lvl, n) {
  while (!lvl.done[n] && lvl.hn > 0) settleOne(lvl);
  return lvl.done[n] ? lvl.dist[n] : INF;
}
/** Rc of q is below `rc` (q settled; when q is not yet settled its final cost is >= the frontier, so no). */
const lower = (lvl, q, rc) => lvl.done[q] === 1 && lvl.dist[q] < rc;

// ---- Local fields ------------------------------------------------------------------------------------
// Dial's bucket queue for the local Dijkstra (one step costs at most 350 < 512 buckets); seeds enter it in cost
// order as the front reaches them, so no two live entries are 512 or more apart
const LB = 512, LM = LB - 1;
// scratch, allocated on first use (never at import: D1)
let LH = null, LT = null, LN = null, SK = null, EC = null, OP = null, FP = null, FD = null, OFF8 = null;
let stamp = 1;
function scratch() {
  LH = new Int32Array(LB); LT = new Int32Array(4096); LN = new Int32Array(4096); SK = new Float64Array(256);
  EC = new Int32Array(324); OP = new Uint8Array(324); FP = new Int32Array(324); FD = new Int32Array(324);
  OFF8 = Int32Array.from({ length: 8 }, (_, d) => DY8[d] * 18 + DX8[d]);
}
/** The local field of region r (Int32Array(256) over its cluster; INF outside r). r must be settled. */
export function localField(s, lvl, r) {
  let f = lvl.local.get(r);
  if (f) { lvl.local.delete(r); lvl.local.set(r, f); return f; }
  hflowStats.locals++;
  if (!LH) scratch();
  f = new Int32Array(256).fill(INF);
  const rc = nodeCost(lvl, r);
  const cl = ((r - 1) / LOCAL_MAX) | 0, z = (cl / (CW * CH)) | 0, cp = cl - z * CW * CH;
  const x0 = (cp % CW) * 16, y0 = ((cp / CW) | 0) * 16, x1 = Math.min(W, x0 + 16), y1 = Math.min(H, y0 + 16);
  const base = z * PLANE, lab = lvl.lab, walk = s.rt.walkCost, occ = s.rt.occ, ter = s.L.terrain, slots = lvl.slots, gp = lvl.goalPad.get(cl) || null, gl = gp !== null;
  const seed = (l, c) => { if (c < f[l]) f[l] = c; };
  if (rc < INF) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = base + y * W + x;
      if (lab[i] !== r) continue;
      const l = (y - y0) * 16 + (x - x0);
      const pl = (y - y0 + 1) * 18 + (x - x0 + 1);
      if (gl && gp[pl]) seed(l, gp[pl] - 1);
      // 4-way exits (a different region 4-adjacent is only ever across the cluster border), smash voxels; the
      // diagonals only matter next to an unwalkable goal
      for (let d = 0, dn = gl ? 8 : 4; d < dn; d++) {
        const nx = x + DX8[d], ny = y + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = i + DY8[d] * W + DX8[d], q = lab[j];
        if (q === r) continue;
        if (q === 0) {
          if (occ[j] < 0 && !gl) continue;   // bare rock or the void: neither a goal nor a smash voxel
          const g2 = gl && gp[pl + OFF8[d]] ? gp[pl + OFF8[d]] - 1 : undefined;
          if (g2 !== undefined && (d < 4 || (stepCost(walk[i + DX8[d]], SIDE.HOS) !== 0 && stepCost(walk[i + DY8[d] * W], SIDE.HOS) !== 0))) seed(l, g2 + (d < 4 ? 10 : 14));
          if (d < 4) { const k = lvl.smashAt.get(j); if (k !== undefined && lower(lvl, slots + k, rc)) seed(l, lvl.dist[slots + k] + lvl.smashC[k]); }
        } else if (d < 4 && lower(lvl, q, rc)) seed(l, lvl.dist[q] + stepCost(walk[j], SIDE.HOS));
      }
      if (D > 1) {
        if (z < D - 1 && TER_UP[ter[i]] === 1 && TER_DOWN[ter[i + PLANE]] === 1) { const q = lab[i + PLANE]; if (q && lower(lvl, q, rc)) seed(l, lvl.dist[q] + VERT10); }
        if (z > 0 && TER_DOWN[ter[i]] === 1 && TER_UP[ter[i - PLANE]] === 1) { const q = lab[i - PLANE]; if (q && lower(lvl, q, rc)) seed(l, lvl.dist[q] + VERT10); }
      }
    }
  }
  // Dijkstra inside r (exact): from tile j at cost c, a neighbour i pays the entry of j. On an 18 x 18 padded copy
  // of the cluster: EC = entry cost in r (0 outside r), OP = open to hostiles (the corner rule)
  const nw = x1 - x0, nh = y1 - y0;
  EC.fill(0); OP.fill(0); FP.fill(INF);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const i = base + (y0 + y) * W + x0 + x, pl = (y + 1) * 18 + x + 1, c = stepCost(walk[i], SIDE.HOS);
    OP[pl] = c !== 0 ? 1 : 0;
    if (lab[i] === r) EC[pl] = c;
  }
  let ns = 0;
  for (let l = 0; l < 256; l++) if (f[l] < INF) SK[ns++] = f[l] * 512 + (((l >> 4) + 1) * 18 + (l & 15) + 1);
  const keys = SK.subarray(0, ns).sort();
  LH.fill(-1);
  let used = 0, count = 0, sp = 0, cur = ns ? Math.floor(keys[0] / 512) : 0;
  while (count > 0 || sp < ns) {
    if (count === 0) { const c1 = Math.floor(keys[sp] / 512); if (c1 > cur) cur = c1; }
    while (sp < ns) {
      const k = keys[sp], c1 = Math.floor(k / 512);
      if (c1 >= cur + LB) break;
      const pl = k - c1 * 512;
      if (c1 < FP[pl]) { FP[pl] = c1; const b = c1 & LM; LT[used] = pl; LN[used] = LH[b]; LH[b] = used++; count++; }
      sp++;
    }
    const b = cur & LM, e0 = LH[b];
    if (e0 < 0) { cur++; continue; }
    LH[b] = LN[e0]; count--;
    const pl = LT[e0];
    if (FP[pl] !== cur) continue;
    if (FD[pl] === stamp) continue;
    FD[pl] = stamp;
    const e = EC[pl], ed = DIAG(e);
    for (let d = 0; d < 8; d++) {
      const q = pl + OFF8[d];
      if (EC[q] === 0) continue;
      if (d >= 4 && (OP[pl + DX8[d]] === 0 || OP[pl + DY8[d] * 18] === 0)) continue;
      const nc = cur + (d < 4 ? e : ed);
      if (nc < FP[q]) { FP[q] = nc; const bb = nc & LM; LT[used] = q; LN[used] = LH[bb]; LH[bb] = used++; count++; }
    }
  }
  stamp = (stamp + 1) & 0x3fffffff || 1;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) { const v = FP[(y + 1) * 18 + x + 1]; f[y * 16 + x] = v; }
  if (lvl.local.size >= LOCAL_LRU) lvl.local.delete(lvl.local.keys().next().value);
  lvl.local.set(r, f);
  return f;
}
const locOf = (i) => { const rr = i % PLANE; return (((rr / W) | 0) & 15) * 16 + ((rr % W) & 15); };

/** The value at voxel i (x10 per tile to the goal along the hierarchical flow), or INF. */
export function hValue(s, lvl, i) {
  const r = lvl.lab[i];
  if (!r) { const g = lvl.goalAt.get(i); return g !== undefined ? g : INF; }
  if (nodeCost(lvl, r) >= INF) return INF;
  return localField(s, lvl, r)[locOf(i)];
}

/**
 * The neighbour voxel a hostile at i steps to (planar 8-way without corner cutting, or a stair or ramp),
 * or -1 at the goal or where nothing is lower. May be a closed voxel: a smash voxel (break it) or the
 * unwalkable goal (claw it), as flowStep on the D = 1 field.
 */
export function hStep(s, lvl, i) {
  const lab = lvl.lab, walk = s.rt.walkCost, ter = s.L.terrain, slots = lvl.slots;
  const z = (i / PLANE) | 0, rr = i - z * PLANE, x = rr % W, y = (rr / W) | 0;
  const r = lab[i];
  let best = -1, bv;
  if (!r) {
    // off the hostile graph (a door shut under it): any open neighbour on a route
    bv = INF;
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d], ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = i + DY8[d] * W + DX8[d], q = lab[j];
      if (!q) continue;
      const v = nodeCost(lvl, q);
      if (v < bv) { bv = v; best = j; }
    }
    return best;
  }
  const rc = nodeCost(lvl, r);
  if (rc >= INF) return -1;
  const f = localField(s, lvl, r);
  bv = f[locOf(i)];
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = i + DY8[d] * W + DX8[d];
    if (d >= 4 && (stepCost(walk[i + DX8[d]], SIDE.HOS) === 0 || stepCost(walk[i + DY8[d] * W], SIDE.HOS) === 0)) continue;
    const q = lab[j];
    let v = INF;
    if (q === r) v = f[locOf(j)];
    else if (q) { if (lower(lvl, q, rc)) { const e = stepCost(walk[j], SIDE.HOS); v = lvl.dist[q] + (d < 4 ? e : DIAG(e)) - 1; } }
    else {
      const g = lvl.goalAt.get(j);
      if (g !== undefined) v = g;
      else { const k = lvl.smashAt.get(j); if (k !== undefined && lower(lvl, slots + k, rc)) v = lvl.dist[slots + k] + lvl.smashC[k] - 1; }
    }
    if (v < bv) { bv = v; best = j; }
  }
  if (D > 1) {
    if (z < D - 1 && TER_UP[ter[i]] === 1 && TER_DOWN[ter[i + PLANE]] === 1) { const q = lab[i + PLANE]; if (q && lower(lvl, q, rc) && lvl.dist[q] + VERT10 - 1 < bv) { bv = lvl.dist[q] + VERT10 - 1; best = i + PLANE; } }
    if (z > 0 && TER_DOWN[ter[i]] === 1 && TER_UP[ter[i - PLANE]] === 1) { const q = lab[i - PLANE]; if (q && lower(lvl, q, rc) && lvl.dist[q] + VERT10 - 1 < bv) { bv = lvl.dist[q] + VERT10 - 1; best = i - PLANE; } }
  }
  return best;
}

// ---- The planar dig field (sappers, 2.10: per level in Z1) -------------------------------------------
const BUCKETS = 512, BMASK = BUCKETS - 1;
/**
 * A PLANE-sized Uint16 field on level z toward the goal voxels on that level: walk costs, smash costs for walls
 * and doors (costAt(i) gives the hostile entry cost, 0 = closed) and DIG cost for natural rock.
 */
export function planeField(s, z, goals, costAt, unreached = 0xffff) {
  const f = new Uint16Array(PLANE).fill(unreached), base = z * PLANE;
  const cost = new Uint16Array(PLANE), sol = new Uint8Array(PLANE), goal = new Uint8Array(PLANE);
  for (let p = 0; p < PLANE; p++) { const c = costAt(base + p); cost[p] = c; sol[p] = stepCost(s.rt.walkCost[base + p], SIDE.HOS) === 0 ? 1 : 0; }
  let tile = new Int32Array(Math.max(1024, PLANE * 3)), next = new Int32Array(tile.length);
  const heads = new Int32Array(BUCKETS).fill(-1);
  let used = 0, count = 0;
  const push = (p, c) => {
    if (used >= tile.length) { const a = new Int32Array(tile.length * 2); a.set(tile); tile = a; const b = new Int32Array(next.length * 2); b.set(next); next = b; }
    const bb = c & BMASK; tile[used] = p; next[used] = heads[bb]; heads[bb] = used++; count++;
  };
  for (const e of goals) {
    const i = typeof e === 'number' ? e : e[0], c0 = typeof e === 'number' ? 0 : Math.min(BMASK, e[1] | 0);
    if (((i / PLANE) | 0) !== z) continue;
    const p = i - base;
    if (goal[p]) continue;
    goal[p] = 1; f[p] = c0; push(p, c0);
  }
  let cur = 0;
  while (count > 0) {
    const e = heads[cur & BMASK];
    if (e < 0) { cur++; continue; }
    heads[cur & BMASK] = next[e]; count--;
    const t = tile[e];
    if (f[t] !== cur) continue;
    const c0 = cost[t], enter = c0 === 0 ? (goal[t] ? 10 : 0) : c0;
    if (enter === 0) continue;
    const tx = t % W, ty = (t / W) | 0, dg = DIAG(enter);
    for (let d = 0; d < 8; d++) {
      const nx = tx + DX8[d], ny = ty + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (cost[j] === 0) continue;
      if (d >= 4 && (sol[ty * W + nx] || sol[ny * W + tx])) continue;
      const nd = cur + (d >= 4 ? dg : enter);
      if (nd < f[j] && nd < unreached) { f[j] = nd; push(j, nd); }
    }
  }
  return f;
}
/** The step on a plane field from voxel i (lowest neighbour on its level; ties in DX8 order), or -1. */
export function planeStep(s, f, i) {
  const z = (i / PLANE) | 0, base = z * PLANE, p = i - base, x = p % W, y = (p / W) | 0, wc = s.rt.walkCost;
  let best = -1, bv = f[p];
  for (let d = 0; d < 8; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (f[j] >= bv) continue;
    if (d >= 4 && (stepCost(wc[base + y * W + nx], SIDE.HOS) === 0 || stepCost(wc[base + ny * W + x], SIDE.HOS) === 0)) continue;
    bv = f[j]; best = base + j;
  }
  return best;
}
export { TER };
/** Settle a level completely (benches and tests). */
export function settleAll(lvl) { while (lvl.hn > 0) settleOne(lvl); return lvl; }
