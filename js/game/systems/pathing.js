// Pathfinding.
//  - Friendly units and villagers use A* on the tile grid (8-way, no corner
//    cutting). Buffers are preallocated and reused with a generation stamp.
//  - Every enemy shares one flow field toward the Hearth (Dijkstra), rebuilt
//    only when structures change. Buildings are expensive-but-passable in the
//    field, so the Hollow walks around walls when it can and smashes through
//    when it must. Shades get a second field where dark walls cost nothing.
import { N, idx, TER_PASSABLE } from '../grid.js';
import { BUILDINGS } from '../../data/buildings.js';

const SIZE = N * N;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// ---- Tile solidity --------------------------------------------------------
export function terrainBlocked(s, i) { return !TER_PASSABLE[s.terrain[i]] || s.nodeGrid[i] !== 0; }

export function solidForFriend(s, i) {
  if (terrainBlocked(s, i)) return true;
  const b = s.occ[i];
  if (!b) return false;
  const bd = s.rt.bById.get(b);
  return !(bd && BUILDINGS[bd.type].isGate && bd.built);
}
export function solidForEnemy(s, i, phase) {
  if (terrainBlocked(s, i)) return true;
  const b = s.occ[i];
  if (!b) return false;
  if (phase) {
    const bd = s.rt.bById.get(b);
    if (bd && BUILDINGS[bd.type].isWall && !s.lit[i]) return false;
  }
  return true;
}

// ---- Binary heap of (key, tile) pairs; keys are copied so lazy re-pushes are safe
class Heap {
  constructor(n) { this.a = new Int32Array(n * 8); this.k = new Float32Array(n * 8); this.n = 0; }
  clear() { this.n = 0; }
  push(i, key) {
    const a = this.a, k = this.k; let p = this.n++;
    a[p] = i; k[p] = key;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (k[q] <= k[p]) break;
      let t = a[q]; a[q] = a[p]; a[p] = t;
      const tk = k[q]; k[q] = k[p]; k[p] = tk; p = q;
    }
  }
  pop() {
    const a = this.a, k = this.k; const top = a[0];
    const n = --this.n;
    if (n > 0) {
      a[0] = a[n]; k[0] = k[n]; let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1; let m = p;
        if (l < n && k[l] < k[m]) m = l;
        if (r < n && k[r] < k[m]) m = r;
        if (m === p) break;
        let t = a[m]; a[m] = a[p]; a[p] = t;
        const tk = k[m]; k[m] = k[p]; k[p] = tk; p = m;
      }
    }
    return top;
  }
}

// ---- A* ----------------------------------------------------------------------
const g = new Float32Array(SIZE), f = new Float32Array(SIZE);
const came = new Int32Array(SIZE), stamp = new Uint32Array(SIZE), closed = new Uint32Array(SIZE);
let gen = 1;
const heap = new Heap(SIZE);

/**
 * Find a path from tile (sx,sy) to any passable tile touching the goal rect
 * [gx0..gx1] x [gy0..gy1] (or inside it, if passable). Returns an array of tile
 * indices (excluding the start) or null.
 */
export function astar(s, sx, sy, gx0, gy0, gx1, gy1, maxExpand = 2000) {
  gen++;
  const start = idx(sx, sy);
  const hx = (gx0 + gx1) / 2, hy = (gy0 + gy1) / 2;
  const isGoal = (x, y) => x >= gx0 - 1 && x <= gx1 + 1 && y >= gy0 - 1 && y <= gy1 + 1;
  g[start] = 0; stamp[start] = gen; came[start] = -1;
  f[start] = Math.hypot(sx - hx, sy - hy);
  heap.clear(); heap.push(start, f[start]);
  let expanded = 0;
  let best = -1, bestH = 1e9;
  while (heap.n > 0) {
    const cur = heap.pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    const cx = cur % N, cy = (cur / N) | 0;
    if (isGoal(cx, cy) && (cur === start || !solidForFriend(s, cur))) return build(cur, start);
    const h = Math.abs(cx - hx) + Math.abs(cy - hy);
    if (h < bestH) { bestH = h; best = cur; }
    if (++expanded > maxExpand) break;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = idx(nx, ny);
      if (closed[ni] === gen) continue;
      if (solidForFriend(s, ni)) continue;
      if (d >= 4 && (solidForFriend(s, idx(cx + DX[d], cy)) || solidForFriend(s, idx(cx, cy + DY[d])))) continue;
      const ng = g[cur] + DC[d];
      if (stamp[ni] !== gen || ng < g[ni]) {
        stamp[ni] = gen; g[ni] = ng; came[ni] = cur;
        f[ni] = ng + Math.hypot(nx - hx, ny - hy);
        heap.push(ni, f[ni]);
      }
    }
  }
  // Unreachable: walk as close as we got, so units never freeze.
  return best >= 0 && best !== start ? build(best, start) : null;
}
function build(end, start) {
  const out = [];
  let c = end;
  while (c !== -1 && c !== start) { out.push(c); c = came[c]; }
  out.reverse();
  return out;
}

// ---- Flow fields ---------------------------------------------------------------
const fheap = new Heap(SIZE);

export function createField() { return { dist: new Float32Array(SIZE), next: new Int32Array(SIZE) }; }

function tileCost(s, i, phase) {
  if (terrainBlocked(s, i)) return Infinity;
  const b = s.occ[i];
  if (!b) return 1;
  const bd = s.rt.bById.get(b);
  if (!bd) return 1;
  if (bd.type === 'hearth') return 1;
  if (phase && BUILDINGS[bd.type].isWall && !s.lit[i]) return 1;
  return 1 + bd.hp / 35;
}

const costBuf = new Float32Array(SIZE);
export function buildFlowField(s, field, phase) {
  const { dist, next } = field;
  dist.fill(Infinity); next.fill(-1);
  for (let i = 0; i < SIZE; i++) costBuf[i] = tileCost(s, i, phase);
  fheap.clear();
  const h = s.rt.hearth;
  if (!h) return;
  for (let y = h.ty; y < h.ty + h.size; y++) for (let x = h.tx; x < h.tx + h.size; x++) {
    const i = idx(x, y); dist[i] = 0; fheap.push(i, 0);
  }
  const done = closed; gen++;
  while (fheap.n > 0) {
    const cur = fheap.pop();
    if (done[cur] === gen) continue;
    done[cur] = gen;
    const cx = cur % N, cy = (cur / N) | 0;
    const enter = costBuf[cur]; // price of stepping INTO cur from a neighbour
    const dc = dist[cur];
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const ni = idx(nx, ny);
      if (costBuf[ni] === Infinity || done[ni] === gen) continue;
      if (d >= 4 && (costBuf[idx(cx + DX[d], cy)] === Infinity || costBuf[idx(cx, cy + DY[d])] === Infinity)) continue;
      const nd = dc + DC[d] * enter;
      if (nd < dist[ni]) { dist[ni] = nd; next[ni] = cur; fheap.push(ni, nd); }
    }
  }
}
