// Pathfinding (owner B; doc 12.3, 13.1): A* with a shared per-tick expansion budget and a saved
// request queue, for every mover (colonists, animals, hostiles off their flow field).
//
//   requestPath(s, kind, id, goal, mode)   queue a request in rt.pathQ (saved FIFO, C13). One
//                                          pending request per mover: a new one replaces the goal
//                                          in place and keeps the queue position.
//   pathSystem(s)                          the 'path' tick slot: pops requests while the tick has
//                                          spent fewer than PATH.BUDGET (8,000) expansions; each
//                                          search runs to completion (per-search cap N/2 tiles =
//                                          the doc's N*N/2 for side N: 8,192 at 128), so no half-
//                                          done search ever exists at a tick end.
//   Results are written to the mover:      ent.path = { tiles: Uint32Array, i: 0 } (tiles exclude
//                                          the start; empty when already there), or the FAILED
//                                          marker { tiles: [], i: -1 } (unreachable or truncated).
//                                          pathFailed / pathPending / pathReady read them.
//   findPath(s, from, goal, mode, side)    the synchronous search (tests, benches, tools; sim code
//                                          uses requestPath so the budget holds).
//   The region graph rejects unreachable goals before any expansion (regions.js, C5).
//
// Integer costs only (walk cost x10 per tile; orthogonal step = cost x 10, diagonal = cost x 14),
// 8-way moves with no corner cutting; doors cost DOOR_WALK10 for colonists and block hostiles.
// Buffers are allocated on first use for the live map size, never at import (D1).
//
// Flow fields live elsewhere: H owns them in js/game/threat/flow.js.
// Index types (Stage Z1 E1): every tile is a u32 voxel index (grid.js idx with the mover's z); paths are
// Uint32Array.
// 3D (Stage Z1 E2, EMBERCROWN-FORTRESS.md 2.3): plain 3D A*. Planar moves stay 8-way on one level; a
// vertical move goes from an up voxel to the down voxel directly above it (or back; vertical.js upOK /
// downOK) and costs PATH.VERT x walk / 10 (200 on normal ground). The heuristic is octile + VERT x |dz|
// (admissible and consistent). The heap grows on demand (no 8N Float64 heap at D = 20). At D > 1 the
// region pre-check is skipped until E3 gives the regions their vertical links: every search runs.
// A D = 1 map searches, costs and tie-breaks exactly as Stage 2.9.

import { W, H, N, D, PLANE, TILE, idx, DX8, DY8, TER_UP, TER_DOWN } from '../core/grid.js';
import { newPath } from '../core/schema.js';
import { stepCost, passW, sideOf, SIDE } from '../world/pass.js';
import { compOf } from '../world/regions.js';
import { registerSystem, tickSystems } from '../core/bus.js';

/** Tuning (moves to balance.js PATH, owner G). */
export const PATH = Object.freeze({ BUDGET: 8000, VERT: 200 });
/** Goal modes: stand ON the tile, on a 4-neighbour of it (mine, build), or within 1 tile (8-way). */
export const GOAL = Object.freeze({ TILE: 0, ADJ4: 1, ADJ8: 2 });
/** Per-search expansion cap: half the tiles (8,192 at 128 x 128). */
export const searchCap = () => N >> 1;
/** Mover kinds in a request: colonist, animal, foe. */
export const KINDS = Object.freeze({ c: 'col', a: 'anim', f: 'foes' });

// ---- Buffers (lazy, per map size) ------------------------------------------------------------------
let bufN = 0, g = null, came = null, open = null, closed = null, hk = null, hv = null, gen = 0;
const HEAP0 = 4096;
function buffers() {
  if (bufN === N) return;
  bufN = N;
  g = new Int32Array(N); came = new Int32Array(N);
  open = new Uint32Array(N); closed = new Uint32Array(N);
  hk = new Float64Array(HEAP0); hv = new Int32Array(HEAP0); // grown by doubling (the order is size-independent)
  gen = 0;
}
function growHeap() {
  const a = new Float64Array(hk.length * 2); a.set(hk); hk = a;
  const b = new Int32Array(hv.length * 2); b.set(hv); hv = b;
}

const KEY_SHIFT = 1048576; // 2^20 > the largest heuristic (100 x 256 + 40 x 256 + 200 x 32)
const oct100 = (dx, dy) => (dx > dy ? 100 * dx + 40 * dy : 100 * dy + 40 * dx);
const zOf = (i) => (i / PLANE) | 0;
const xOf = (i) => i % W;
const yOf = (i) => ((i % PLANE) / W) | 0;

function goalTest(i, goal, mode) {
  if (i === goal) return true;
  if (mode === GOAL.TILE) return false;
  if (D > 1 && zOf(i) !== zOf(goal)) return false;
  const dx = Math.abs(xOf(i) - xOf(goal)), dy = Math.abs(yOf(i) - yOf(goal));
  return mode === GOAL.ADJ4 ? dx + dy === 1 : dx <= 1 && dy <= 1;
}

/** Region pre-check: can any goal tile be reached from `from` (per the end-of-tick labels)? */
export function goalReachable(s, from, goal, mode = GOAL.TILE, side = 0) {
  if (D > 1) return true;          // planar labels cannot see stairs yet (E3 adds the vertical links)
  side = sideOf(side);
  const walk = s.rt.walkCost;
  const starts = [];
  const add = (arr, i) => { const c = compOf(s, i, side); if (c && !arr.includes(c)) arr.push(c); };
  add(starts, from);
  if (!passW(walk[from], side)) {
    const x = from % W, y = (from / W) | 0;
    for (let d = 0; d < 8; d++) { const nx = x + DX8[d], ny = y + DY8[d]; if (nx >= 0 && ny >= 0 && nx < W && ny < H) add(starts, ny * W + nx); }
  }
  if (!starts.length) return false;
  const goals = [];
  if (passW(walk[goal], side)) add(goals, goal);
  if (mode !== GOAL.TILE) {
    const x = goal % W, y = (goal / W) | 0, n = mode === GOAL.ADJ4 ? 4 : 8;
    for (let d = 0; d < n; d++) { const nx = x + DX8[d], ny = y + DY8[d]; if (nx >= 0 && ny >= 0 && nx < W && ny < H) add(goals, ny * W + nx); }
  }
  for (const c of goals) if (starts.includes(c)) return true;
  return false;
}

/**
 * A* from tile `from` to `goal` (tile index) for a side.
 * @returns {{ status: 'ok'|'here'|'unreachable'|'fail'|'trunc', tiles: Uint32Array|null, expanded: number, cost: number }}
 *   'unreachable': rejected by the region graph with no expansion; 'fail': the open set ran dry;
 *   'trunc': the per-search cap was hit (the bench counts these: must be 0 on reachable pairs).
 */
export function findPath(s, from, goal, mode = GOAL.TILE, side = SIDE.COL, cap = searchCap(), opts = {}) {
  side = sideOf(side);
  if (goalTest(from, goal, mode)) return { status: 'here', tiles: new Uint32Array(0), expanded: 0, cost: 0 };
  if (!opts.noRegionCheck && !goalReachable(s, from, goal, mode, side)) return { status: 'unreachable', tiles: null, expanded: 0, cost: 0 };
  buffers();
  if (++gen >= 0xffffffff) { open.fill(0); closed.fill(0); gen = 1; }
  const walk = s.rt.walkCost, ter = s.L.terrain, VERT20 = PATH.VERT / 10, deep = D > 1;
  const gx = xOf(goal), gy = yOf(goal), gz = zOf(goal);
  const slack = mode === GOAL.TILE ? 0 : mode === GOAL.ADJ4 ? 100 : 140;
  const hOf = (x, y, z) => { const v = oct100(Math.abs(x - gx), Math.abs(y - gy)) + (z === gz ? 0 : PATH.VERT * Math.abs(z - gz)) - slack; return v > 0 ? v : 0; };
  let n = 0;
  const push = (k, v) => {
    if (n >= hk.length) growHeap();
    let p = n++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (hk[q] < k || (hk[q] === k && hv[q] <= v)) break;
      hk[p] = hk[q]; hv[p] = hv[q]; p = q;
    }
    hk[p] = k; hv[p] = v;
  };
  const pop = () => {
    const top = hv[0];
    const k = hk[--n], v = hv[n];
    let p = 0;
    for (;;) {
      const l = 2 * p + 1;
      if (l >= n) break;
      const r = l + 1;
      const m = r < n && (hk[r] < hk[l] || (hk[r] === hk[l] && hv[r] < hv[l])) ? r : l;
      if (hk[m] > k || (hk[m] === k && hv[m] >= v)) break;
      hk[p] = hk[m]; hv[p] = hv[m]; p = m;
    }
    hk[p] = k; hv[p] = v;
    return top;
  };
  g[from] = 0; came[from] = -1; open[from] = gen;
  // heap key: f * 2^20 + h (exact integers in a double): equal f prefers the node nearer the goal,
  // which keeps open-ground searches narrow; then the lower tile index (deterministic order)
  push(hOf(xOf(from), yOf(from), zOf(from)) * KEY_SHIFT, from);
  let expanded = 0;
  while (n > 0) {
    const cur = pop();
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    if (goalTest(cur, goal, mode) && (passW(walk[cur], side))) return done(cur, from, expanded, g[cur]);
    if (expanded >= cap) return { status: 'trunc', tiles: null, expanded, cost: 0 };
    expanded++;
    const cz = zOf(cur), base = cz * PLANE, cx = cur % W, cy = ((cur - base) / W) | 0, gc = g[cur];
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = base + ny * W + nx;
      if (closed[ni] === gen) continue;
      const c = stepCost(walk[ni], side);
      if (c === 0) continue;
      let step;
      if (d < 4) step = c * 10;
      else {
        if (!passW(walk[base + cy * W + nx], side) || !passW(walk[base + ny * W + cx], side)) continue; // no corner cutting
        step = c * 14;
      }
      const ng = gc + step;
      if (open[ni] !== gen || ng < g[ni]) {
        open[ni] = gen; g[ni] = ng; came[ni] = cur;
        const h = hOf(nx, ny, cz);
        push((ng + h) * KEY_SHIFT + h, ni);
      }
    }
    if (!deep) continue;
    // vertical: up then down (fixed order), an up voxel to the down voxel directly above it
    const tc = ter[cur];
    for (let v = 0; v < 2; v++) {
      let ni;
      if (v === 0) { if (cz >= D - 1 || TER_UP[tc] !== 1 || TER_DOWN[ter[cur + PLANE]] !== 1) continue; ni = cur + PLANE; }
      else { if (cz === 0 || TER_DOWN[tc] !== 1 || TER_UP[ter[cur - PLANE]] !== 1) continue; ni = cur - PLANE; }
      if (closed[ni] === gen) continue;
      const c = stepCost(walk[ni], side);
      if (c === 0) continue;
      const ng = gc + c * VERT20;
      if (open[ni] !== gen || ng < g[ni]) {
        open[ni] = gen; g[ni] = ng; came[ni] = cur;
        const h = hOf(cx, cy, v === 0 ? cz + 1 : cz - 1);
        push((ng + h) * KEY_SHIFT + h, ni);
      }
    }
  }
  return { status: 'fail', tiles: null, expanded, cost: 0 };
}
function done(end, start, expanded, cost) {
  let len = 0;
  for (let c = end; c !== start && c !== -1; c = came[c]) len++;
  const tiles = new Uint32Array(len);
  let k = len;
  for (let c = end; c !== start && c !== -1; c = came[c]) tiles[--k] = c;
  return { status: 'ok', tiles, expanded, cost };
}

// ---- Saved request queue and the per-tick budget -------------------------------------------------------
// rt.pathQ entries are JSON arrays [kind, id, goal, mode]; kind 'c' | 'a' | 'f' (KINDS).
const listOf = (s, kind) => s[KINDS[kind]] || null;
function moverOf(s, kind, id) {
  const list = listOf(s, kind);
  if (!list) return null;
  for (let k = 0; k < list.length; k++) { const e = list[k]; if (e && e.id === id) return e; }
  return null;
}
const sideOfKind = (kind) => (kind === 'f' ? SIDE.HOS : SIDE.COL);
const tileOfMover = (e) => {
  const x = Math.min(W - 1, Math.max(0, Math.floor(e.x / TILE))), y = Math.min(H - 1, Math.max(0, Math.floor(e.y / TILE)));
  return (e.z | 0) * PLANE + y * W + x;
};

/** Queue (or re-aim) a path request. kind 'c' colonist, 'a' animal, 'f' foe; goal a tile index. */
export function requestPath(s, kind, id, goal, mode = GOAL.TILE) {
  if (!(kind in KINDS)) throw new Error(`pathing: unknown mover kind ${kind}`);
  const q = s.rt.pathQ;
  for (let k = 0; k < q.length; k++) if (q[k][0] === kind && q[k][1] === id) { q[k][2] = goal; q[k][3] = mode; return k; }
  q.push([kind, id, goal, mode]);
  return q.length - 1;
}
/** Drop a mover's pending request (job cancelled, mover gone). */
export function cancelPath(s, kind, id) {
  const q = s.rt.pathQ;
  for (let k = 0; k < q.length; k++) if (q[k][0] === kind && q[k][1] === id) { q.splice(k, 1); return true; }
  return false;
}
export const pathPending = (s, kind, id) => s.rt.pathQ.some((r) => r[0] === kind && r[1] === id);
/** The FAILED marker written to ent.path when no path exists (or the search was truncated). */
export const failedPath = () => newPath([], -1);
export const pathFailed = (p) => !!p && p.i === -1;
export const pathReady = (p) => !!p && p.i >= 0;

/** Non-sim statistics (benches and the debug hook; the sim never reads them). */
export const pathStats = { ticks: 0, searches: 0, spentLast: 0, spentMax: 0, startedAtMax: 0, searchMax: 0, truncated: 0, unreachable: 0, failed: 0 };
export function resetPathStats() { for (const k of Object.keys(pathStats)) pathStats[k] = 0; }

/** The 'path' tick slot. Returns the expansions spent this tick. */
export function pathSystem(s) {
  const q = s.rt.pathQ;
  let spent = 0, k = 0;
  while (k < q.length && spent < PATH.BUDGET) {
    const [kind, id, goal, mode] = q[k++];
    const e = moverOf(s, kind, id);
    if (!e) continue;
    if (spent > pathStats.startedAtMax) pathStats.startedAtMax = spent;
    const r = findPath(s, tileOfMover(e), goal, mode, sideOfKind(kind));
    spent += r.expanded;
    pathStats.searches++;
    if (r.expanded > pathStats.searchMax) pathStats.searchMax = r.expanded;
    if (r.status === 'ok' || r.status === 'here') e.path = newPath(r.tiles, 0);
    else {
      e.path = failedPath();
      if (r.status === 'trunc') pathStats.truncated++; else if (r.status === 'unreachable') pathStats.unreachable++; else pathStats.failed++;
    }
  }
  if (k) q.splice(0, k);
  pathStats.ticks++;
  pathStats.spentLast = spent;
  if (spent > pathStats.spentMax) pathStats.spentMax = spent;
  return spent;
}

/**
 * Colonist adapter for E's Mover hook (js/game/work/jobs.js setMover): request / status / stop.
 * adj = true asks for a 4-neighbour of the goal (mine, build). Movement along the path is
 * movement.js (B, Stage 1a); until then E keeps its straight-line stub for walking.
 */
export const pathMover = Object.freeze({
  request(s, col, goal, adj) {
    const mode = adj ? GOAL.ADJ4 : GOAL.TILE;
    if (!goalReachable(s, tileOfMover(col), goal, mode, SIDE.COL)) return false;
    col.path = null;
    requestPath(s, 'c', col.id, goal, mode);
    return true;
  },
  status(s, col) {
    if (pathPending(s, 'c', col.id)) return 'pending';
    if (pathFailed(col.path)) return 'failed';
    return pathReady(col.path) ? 'moving' : 'none';
  },
  stop(s, col) { cancelPath(s, 'c', col.id); col.path = null; },
});

/** Register pathSystem in the 'path' tick slot. Idempotent; call again after resetBus(). */
export function installPathing() {
  if (tickSystems().some((x) => x.slot === 'path' && x.name === 'astar')) return;
  registerSystem('path', 'astar', pathSystem);
}

// ---- Walking along paths (Stage 1a colonist movement) ----------------------------------------------------
// The colony's movers walk their saved path tile by tile, in integer world units (no trigonometry):
// each tick a mover may cover MOVE.base x speed / 100 units, scaled by the walk cost of the tile it is
// entering (cost 10 = normal; marsh, water and doors are slower) and by 10/14 on a diagonal step. It
// moves on both axes toward the next tile centre; on arriving it takes the next tile, carrying the
// unused part of the step. When the next tile has become impassable (a wall went up, a door locked),
// the path is dropped (ent.path = null): E's goto toil then asks again, and the region graph rejects a
// goal that is no longer reachable. Arriving at the end drops the path too (status 'none' = there).
// Movers run in s.col order (then s.anim), so the result is deterministic and independent of speed.
// Stairs and ramps (Stage Z1 E2): a path tile on another level is a vertical step, taken in place. The mover
// climbs from where it is to the climb point of its tile (16 units north of the centre going up, 15 south
// going down) at 4x effort, so the step costs 2 tiles of walking (PATH.VERT); there it changes z and stands
// at the tile centre. No extra saved state: the climb's progress is the mover's own x, y.
// The roguelite's steering locomotion (movement.js) stays for H's combat movers (Stage 1b).
export const MOVE = Object.freeze({ base: 5 });
const CLIMB_UP = 16, CLIMB_DOWN = 15;              // x 40 effort = 2 tiles x 320 (PATH.VERT); inside the tile   // units per tick at speed 100 on cost-10 ground (3.1 tiles/s at 1x)
let speedHook = null;
/** F's hook: fn(s, ent) -> speed x100 (100 = normal; traits, wounds, carried mass). */
export function setMoveSpeed(fn) { speedHook = fn || null; }

/** Advance one mover along its path. Returns true while it still has a path. */
export function followPath(s, e, side = SIDE.COL) {
  const p = e.path;
  if (!p || p.i < 0) return false;
  if (p.i >= p.tiles.length) { e.path = null; return false; }
  const walk = s.rt.walkCost;
  const spd = speedHook ? Math.max(10, speedHook(s, e) | 0) : 100;
  let left = MOVE.base * spd;                       // budget x100 units
  let x = e.x | 0, y = e.y | 0;
  for (let guard = 0; guard < 4 && left > 0 && p.i < p.tiles.length; guard++) {
    const t = p.tiles[p.i];
    const c = stepCost(walk[t], side);
    if (c === 0) { e.path = null; e.x = x; e.y = y; return false; }
    const tz = (t / PLANE) | 0, vert = tz !== (e.z | 0);
    const cxw = (t % W) * TILE + (TILE >> 1), cyw = (((t % PLANE) / W) | 0) * TILE + (TILE >> 1);
    const gx = cxw, gy = vert ? cyw + (tz > (e.z | 0) ? -CLIMB_UP : CLIMB_DOWN) : cyw;
    const dx = gx - x, dy = gy - y, diag = dx !== 0 && dy !== 0;
    // effort of one unit = cost x 10 (straight) or x 14 (diagonal); 100 on normal ground; a climb is 4x
    const k = vert ? c * 40 : c * (diag ? 14 : 10);
    const per = Math.floor(left / k);
    const need = Math.max(Math.abs(dx), Math.abs(dy));
    if (per >= need) {
      x = gx; y = gy; p.i++;
      left -= need * k;
      if (vert) { e.z = tz; x = cxw; y = cyw; }
    } else {
      const u = per > 0 ? per : 1;
      x += Math.sign(dx) * Math.min(Math.abs(dx), u);
      y += Math.sign(dy) * Math.min(Math.abs(dy), u);
      left = 0;
    }
  }
  e.x = x; e.y = y;
  if (p.i >= p.tiles.length) { e.path = null; return false; }
  return true;
}

/** The 'movement' tick slot system: colonists, then animals, walk their paths. */
export function movementSystem(s) {
  for (const c of s.col) if (c && c.path && c.path.i >= 0) followPath(s, c, SIDE.COL);
  for (const a of s.anim) if (a && a.path && a.path.i >= 0) followPath(s, a, SIDE.COL);
}

/**
 * Colonist movement for Stage 1a: A* through the saved queue (pathSystem) plus movementSystem, and
 * pathMover as E's Mover. Call instead of E's stub mover (installWork({ stubMove: false })).
 * Idempotent; call again after resetBus().
 */
export function installMovement(setMover = null) {
  installPathing();
  if (!tickSystems().some((x) => x.slot === 'movement' && x.name === 'walk')) registerSystem('movement', 'walk', movementSystem, 0);
  if (setMover) setMover(pathMover);
}

// ---- Line of sight (melee LOS, path smoothing; used by movement B and engage H) ----------------------
/** Tile blocks movement for a side ('col' | 'hos', or 0 | 1). */
export const blockedFor = (s, i, side = 0) => !passW(s.rt.walkCost[i], sideOf(side));
export const solidForFriend = (s, i) => blockedFor(s, i, SIDE.COL);
export const solidForEnemy = (s, i) => blockedFor(s, i, SIDE.HOS);

/**
 * Supercover raycast between two world points. The start and end tiles are not tested; passing
 * exactly through a corner needs both side tiles clear (no corner cutting). rad > 0 also tests two
 * parallel rays rad units to either side (body clearance).
 */
export function losClear(s, x0, y0, x1, y1, side = 0, rad = 0, z = 0) {
  side = sideOf(side);
  const base = z * PLANE;
  const a = tileAt(x0, y0, z), b = tileAt(x1, y1, z);
  if (!ray(s, x0, y0, x1, y1, side, -1, -1, base)) return false;
  if (rad > 0) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1e-6) {
      const ox = (-dy / d) * rad, oy = (dx / d) * rad;
      if (!ray(s, x0 + ox, y0 + oy, x1 + ox, y1 + oy, side, a, b, base)) return false;
      if (!ray(s, x0 - ox, y0 - oy, x1 - ox, y1 - oy, side, a, b, base)) return false;
    }
  }
  return true;
}
const tileAt = (wx, wy, z = 0) => idx(Math.max(0, Math.min(W - 1, Math.floor(wx / TILE))), Math.max(0, Math.min(H - 1, Math.floor(wy / TILE))), z);
function ray(s, x0, y0, x1, y1, side, skipA, skipB, base = 0) {
  let tx = Math.floor(x0 / TILE), ty = Math.floor(y0 / TILE);
  const ex = Math.floor(x1 / TILE), ey = Math.floor(y1 / TILE);
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const tdx = adx > 1e-9 ? TILE / adx : Infinity, tdy = ady > 1e-9 ? TILE / ady : Infinity;
  let tmx = sx > 0 ? ((tx + 1) * TILE - x0) / adx : sx < 0 ? (x0 - tx * TILE) / adx : Infinity;
  let tmy = sy > 0 ? ((ty + 1) * TILE - y0) / ady : sy < 0 ? (y0 - ty * TILE) / ady : Infinity;
  const bad = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    const i = base + y * W + x;
    return i !== skipA && i !== skipB && !passW(s.rt.walkCost[i], side);
  };
  for (let guard = 0; guard < 4 * (W + H) && (tx !== ex || ty !== ey); guard++) {
    if (Math.abs(tmx - tmy) < 1e-9) {
      if (bad(tx + sx, ty) || bad(tx, ty + sy)) return false;
      tx += sx; ty += sy; tmx += tdx; tmy += tdy;
    } else if (tmx < tmy) { tx += sx; tmx += tdx; } else { ty += sy; tmy += tdy; }
    if (tx === ex && ty === ey) break;
    if (bad(tx, ty)) return false;
  }
  return true;
}
/** String-pull a tile path: keep a waypoint only where the straight line would clip (rad units of clearance). */
export function smoothPath(s, start, tiles, side = 0, rad = 5) {
  if (tiles.length < 3) return Array.from(tiles);
  const cx = (i) => (i % W) * TILE + TILE / 2, cy = (i) => (((i % PLANE) / W) | 0) * TILE + TILE / 2, cz = (i) => (i / PLANE) | 0;
  const out = [];
  let anchor = start;
  for (let k = 0; k < tiles.length - 1; k++) {
    const nxt = tiles[k + 1];
    // a level change is always a waypoint (both ends of a stair step are kept)
    if (cz(anchor) !== cz(nxt) || cz(tiles[k]) !== cz(nxt) || !losClear(s, cx(anchor), cy(anchor), cx(nxt), cy(nxt), side, rad, cz(nxt))) { out.push(tiles[k]); anchor = tiles[k]; }
  }
  out.push(tiles[tiles.length - 1]);
  return out;
}

// ---- Bench: the truncation check (gate 14.4 Bench, doc 14.5 row B) --------------------------------------
/**
 * 0 of `pairs` reachable pairs may be truncated at the per-search cap on a stub map of `size`.
 * Pairs are seeded random passable tiles the region graph says are connected (unreachable picks
 * are counted and skipped, never searched). Then the same pairs go through the saved queue and the
 * 8,000 budget, tick by tick. opts.now (e.g. () => performance.now()) adds timings.
 */
export async function benchTruncation({ size = 128, pairs = 400, scene = 'bench', seed = 7, now = null } = {}) {
  const { createColony, initRuntime } = await import('../core/state.js');
  const { installWorld } = await import('../world/terrain.js');
  const { buildStubMap } = await import('../world/stubmap.js');
  const { newColonist } = await import('../core/schema.js');
  const { rint } = await import('../core/rand.js');
  installWorld();
  const s = createColony('TRUNC-' + seed, { w: size });
  buildStubMap(s, scene, seed);
  initRuntime(s);
  const R = { rng: { main: (seed * 2654435761) >>> 0 } };
  const open = [];
  for (let i = 0; i < N; i++) if (passW(s.rt.walkCost[i], 0)) open.push(i);
  const list = [];
  let rejected = 0, guard = 0;
  while (list.length < pairs && guard++ < pairs * 50) {
    const a = open[rint(R, 'main', 0, open.length - 1)], b = open[rint(R, 'main', 0, open.length - 1)];
    if (a === b) continue;
    if (!goalReachable(s, a, b, GOAL.TILE, 0)) { rejected++; continue; }
    list.push([a, b]);
  }
  const cap = searchCap();
  let truncated = 0, failed = 0, maxExp = 0, sumExp = 0;
  const times = [], exps = [];
  for (const [a, b] of list) {
    const t0 = now ? now() : 0;
    const r = findPath(s, a, b, GOAL.TILE, 0, cap);
    if (now) times.push(now() - t0);
    if (r.status === 'trunc') truncated++;
    else if (r.status !== 'ok') failed++;
    exps.push(r.expanded); sumExp += r.expanded;
    if (r.expanded > maxExp) maxExp = r.expanded;
  }
  // the same pairs through the saved queue and the shared budget
  resetPathStats();
  const base = s.col.length;
  list.forEach(([a], k) => s.col.push(newColonist(base + k, { x: (a % W) * TILE + 16, y: ((a / W) | 0) * TILE + 16 })));
  list.forEach(([, b], k) => requestPath(s, 'c', base + k, b, GOAL.TILE));
  let ticks = 0, overBudgetStarts = 0;
  while (s.rt.pathQ.length && ticks < 10000) {
    const before = pathStats.startedAtMax;
    pathSystem(s); ticks++;
    if (pathStats.startedAtMax >= PATH.BUDGET && before < PATH.BUDGET) overBudgetStarts++;
  }
  const delivered = s.col.slice(base).filter((c) => pathReady(c.path)).length;
  const q = (arr, p) => { const v = arr.slice().sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : 0; };
  const out = {
    size, scene, cap, pairs: list.length, rejectedUnreachable: rejected, truncated, failed,
    expandedMax: maxExp, expandedAvg: list.length ? Math.round(sumExp / list.length) : 0, expandedP95: q(exps, 0.95),
    queue: { ticks, budget: PATH.BUDGET, spentMaxPerTick: pathStats.spentMax, startedAtMax: pathStats.startedAtMax, searchMax: pathStats.searchMax, overBudgetStarts, delivered },
  };
  if (now) { out.p95ms = +q(times, 0.95).toFixed(3); out.avgms = +(times.reduce((x, y) => x + y, 0) / Math.max(1, times.length)).toFixed(3); out.maxms = +q(times, 1).toFixed(3); }
  return out;
}
