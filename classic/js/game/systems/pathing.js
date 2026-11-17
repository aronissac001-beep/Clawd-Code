// Pathfinding.
//  - Friendly units and villagers use A* on the tile grid (8-way, no corner
//    cutting). Buffers are preallocated and reused with a generation stamp.
//  - Every enemy shares one flow field toward the Hearth (Dijkstra), rebuilt
//    only when structures change. Buildings are expensive-but-passable in the
//    field, so the Hollow walks around walls when it can and smashes through
//    when it must. Shades get a second field where dark walls cost nothing.
//  - A* results are string-pulled (waypoints only where the straight line would clip
//    something), and each flow-field tile points at the farthest downstream tile in line of
//    sight, so movers walk curved, any-angle lines instead of 45-degree tile steps.
//  - losClear() is a supercover tile raycast (melee line of sight, path smoothing).
import { N, T, idx, TER_PASSABLE } from '../grid.js';
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
  if (!bd) return false;
  const def = BUILDINGS[bd.type];
  return !((def.isGate && bd.built) || def.walkable);
}
export function solidForEnemy(s, i, phase) {
  if (terrainBlocked(s, i)) return true;
  const b = s.occ[i];
  if (!b) return false;
  const bd = s.rt.bById.get(b);
  if (bd && BUILDINGS[bd.type].walkable) return false;
  if (phase && bd && BUILDINGS[bd.type].isWall && !s.lit[i]) return false;
  return true;
}

// ---- Line of sight ------------------------------------------------------------------
function blockedFor(s, i, who) {
  if (who === 'friend') return solidForFriend(s, i);
  if (who === 'phase') return solidForEnemy(s, i, true);
  return solidForEnemy(s, i, false); // 'enemy' and anything else: terrain and non-walkable buildings
}
/** Supercover raycast between two world points through the tile grid. The start and end
 *  tiles are not tested; passing exactly through a tile corner needs both side tiles clear
 *  (the same no-corner-cutting rule as A*). rad > 0 also tests two parallel rays rad units to
 *  either side (body clearance). who: 'friend' | 'enemy' | 'phase'. */
export function losClear(s, x0, y0, x1, y1, who = 'enemy', rad = 0) {
  if (!ray(s, x0, y0, x1, y1, who)) return false;
  if (rad > 0) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (d > 1e-6) {
      const ox = (-dy / d) * rad, oy = (dx / d) * rad;
      if (!ray(s, x0 + ox, y0 + oy, x1 + ox, y1 + oy, who, idx(tc(x0), tc(y0)), idx(tc(x1), tc(y1)))) return false;
      if (!ray(s, x0 - ox, y0 - oy, x1 - ox, y1 - oy, who, idx(tc(x0), tc(y0)), idx(tc(x1), tc(y1)))) return false;
    }
  }
  return true;
}
const tc = (w) => Math.max(0, Math.min(N - 1, Math.floor(w / T)));
function ray(s, x0, y0, x1, y1, who, skipA = -1, skipB = -1, mask = null) {
  let tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
  const ex = Math.floor(x1 / T), ey = Math.floor(y1 / T);
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const tdx = adx > 1e-9 ? T / adx : Infinity, tdy = ady > 1e-9 ? T / ady : Infinity;
  let tmx = sx > 0 ? ((tx + 1) * T - x0) / adx : sx < 0 ? (x0 - tx * T) / adx : Infinity;
  let tmy = sy > 0 ? ((ty + 1) * T - y0) / ady : sy < 0 ? (y0 - ty * T) / ady : Infinity;
  for (let guard = 0; guard < 4 * N && (tx !== ex || ty !== ey); guard++) {
    if (Math.abs(tmx - tmy) < 1e-9) {
      // Exactly through a corner: both side tiles must be clear (no corner cutting).
      if (rayBad(s, tx + sx, ty, who, skipA, skipB, mask) || rayBad(s, tx, ty + sy, who, skipA, skipB, mask)) return false;
      tx += sx; ty += sy; tmx += tdx; tmy += tdy;
    } else if (tmx < tmy) { tx += sx; tmx += tdx; } else { ty += sy; tmy += tdy; }
    if (tx === ex && ty === ey) break;
    if (rayBad(s, tx, ty, who, skipA, skipB, mask)) return false;
  }
  return true;
}
function rayBad(s, x, y, who, skipA, skipB, mask) {
  if (x < 0 || y < 0 || x >= N || y >= N) return true;
  const i = y * N + x;
  if (i === skipA || i === skipB) return false;
  return mask ? mask[i] === 0 : blockedFor(s, i, who);
}
/** losClear between two tile centres, cached for the current tick (hot callers: melee LOS). */
const losCache = new Map();
let losTick = -1, losState = null;
export function losClearTiles(s, i0, i1, who = 'enemy') {
  if (losTick !== s.tick || losState !== s) { losCache.clear(); losTick = s.tick; losState = s; }
  const key = (i0 * SIZE + i1) * 3 + (who === 'friend' ? 0 : who === 'phase' ? 1 : 2);
  let v = losCache.get(key);
  if (v === undefined) {
    v = i0 === i1 || ray(s, (i0 % N) * T + T / 2, ((i0 / N) | 0) * T + T / 2, (i1 % N) * T + T / 2, ((i1 / N) | 0) * T + T / 2, who);
    losCache.set(key, v);
  }
  return v;
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
export function astar(s, sx, sy, gx0, gy0, gx1, gy1, maxExpand = 2000, smooth = true) {
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
    if (isGoal(cx, cy) && (cur === start || !solidForFriend(s, cur))) return build(s, cur, start, smooth);
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
  return best >= 0 && best !== start ? build(s, best, start, smooth) : null;
}
function build(s, end, start, smooth) {
  const out = [];
  let c = end;
  while (c !== -1 && c !== start) { out.push(c); c = came[c]; }
  out.reverse();
  return smooth ? smoothPath(s, start, out) : out;
}
/** String-pull a tile path: keep a waypoint only where the straight line from the last kept
 *  point to the one after it would clip a solid tile (with 5 units of body clearance). */
export function smoothPath(s, start, path) {
  if (path.length < 3) return path;
  const cx = (i) => (i % N) * T + T / 2, cy = (i) => ((i / N) | 0) * T + T / 2;
  const out = [];
  let anchor = start;
  for (let i = 0; i < path.length - 1; i++) {
    const nxt = path[i + 1];
    if (!losClear(s, cx(anchor), cy(anchor), cx(nxt), cy(nxt), 'friend', 5)) { out.push(path[i]); anchor = path[i]; }
  }
  out.push(path[path.length - 1]);
  return out;
}

// ---- Flow fields ---------------------------------------------------------------
const fheap = new Heap(SIZE);

// field.par[i] is the raw Dijkstra parent of tile i (one 8-way step toward the Hearth).
// field.next[i] is what movers seek: the farthest tile up that chain that is in straight,
// clear line of sight from i (any-angle, Theta*-style: each tile inherits its parent's anchor
// while it can still see it). When the very next step is a solid building, next[i] is that
// building tile, so the Hollow besieges it exactly as before.
// (The plan suggested a 2-4 step look-ahead; spawns sit almost in line with the Hearth and an
// 8-way chain runs straight first and diagonal last, so a short look-ahead still walks that
// kink. Anchoring on the farthest visible tile removes it.)
export function createField() { return { dist: new Float32Array(SIZE), next: new Int32Array(SIZE), par: new Int32Array(SIZE) }; }

function tileCost(s, i, phase) {
  if (terrainBlocked(s, i)) return Infinity;
  const b = s.occ[i];
  if (!b) return 1;
  const bd = s.rt.bById.get(b);
  if (!bd) return 1;
  if (bd.type === 'hearth' || BUILDINGS[bd.type].walkable) return 1;
  if (phase && BUILDINGS[bd.type].isWall && !s.lit[i]) return 1;
  // Based on maxHp, not current hp: the field must be a pure function of saved state, so a
  // save/load (which rebuilds it) routes the Hollow exactly as the live game did.
  return 1 + bd.maxHp / 35;
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
  let nOrd = 0;
  while (fheap.n > 0) {
    const cur = fheap.pop();
    if (done[cur] === gen) continue;
    done[cur] = gen;
    order[nOrd++] = cur;
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
  // Any-angle anchors, in Dijkstra order so a parent is always settled before its children.
  const par = field.par || (field.par = new Int32Array(SIZE));
  par.set(next);
  for (let i = 0; i < SIZE; i++) openMask[i] = costBuf[i] !== Infinity && !solidForEnemy(s, i, phase) ? 1 : 0;
  for (let k = 0; k < nOrd; k++) {
    const i = order[k], p = par[i];
    if (p < 0 || !openMask[p]) continue; // none (the Hearth), or a building to besiege
    const a = next[p];
    next[i] = a >= 0 && a !== p && openMask[a] && flowRay(s, i, a) ? a : p;
  }
}
const order = new Int32Array(SIZE);
const openMask = new Uint8Array(SIZE);
/** Clear line between two tile centres over openMask (centre ray only: it runs for every tile
 *  on every rebuild, and movers slide off any corner they graze). */
function flowRay(s, i0, i1) {
  return ray(s, (i0 % N) * T + T / 2, ((i0 / N) | 0) * T + T / 2, (i1 % N) * T + T / 2, ((i1 / N) | 0) * T + T / 2, null, -1, -1, openMask);
}
