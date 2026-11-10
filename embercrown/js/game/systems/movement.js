// Shared movement: steering with axis-sliding against solid tiles, path
// following, and soft separation so crowds spread instead of stacking.
import { T, N, idx, tileOf, ctr, WORLD } from '../grid.js';
import { solidForFriend, solidForEnemy, astar } from './pathing.js';

export const MOVE = { MOVING: 0, ARRIVED: 1, BLOCKED: 2 };

function solidAt(s, x, y, who) {
  const tx = tileOf(x), ty = tileOf(y);
  if (tx < 0 || ty < 0 || tx >= N || ty >= N) return true;
  const i = idx(tx, ty);
  return who === 'friend' ? solidForFriend(s, i) : solidForEnemy(s, i, who === 'phase');
}

/** Step entity e toward (gx,gy). Records the blocking tile in e.blockTile. */
export function stepToward(s, e, gx, gy, speedTiles, dt, who) {
  const dx = gx - e.x, dy = gy - e.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return MOVE.ARRIVED;
  const step = Math.min(speedTiles * T * dt, d);
  const nx = e.x + (dx / d) * step, ny = e.y + (dy / d) * step;
  if (Math.abs(dx) > 0.5) e.face = dx < 0 ? -1 : 1;
  e.anim += step * 0.25;
  // If we're already inside something solid (e.g. a wall was built on us), walk out freely.
  const inside = solidAt(s, e.x, e.y, who);
  e.blockTile = -1;
  if (inside || !solidAt(s, nx, ny, who)) { e.x = nx; e.y = ny; }
  else if (!solidAt(s, nx, e.y, who)) { e.x = nx; e.blockTile = idx(tileOf(e.x), tileOf(ny)); }
  else if (!solidAt(s, e.x, ny, who)) { e.y = ny; e.blockTile = idx(tileOf(nx), tileOf(e.y)); }
  else {
    e.stuck += dt;
    const tx = tileOf(nx), ty = tileOf(ny);
    if (tx >= 0 && ty >= 0 && tx < N && ty < N) e.blockTile = idx(tx, ty);
    return MOVE.BLOCKED;
  }
  if (e.x < 2) e.x = 2; else if (e.x > WORLD - 2) e.x = WORLD - 2;
  if (e.y < 2) e.y = 2; else if (e.y > WORLD - 2) e.y = WORLD - 2;
  e.stuck = Math.max(0, e.stuck - dt * 0.5);
  return d <= step + 0.5 ? MOVE.ARRIVED : MOVE.MOVING;
}

/** Request an A* path to a goal rectangle, respecting the per-tick budget. */
export function requestPath(s, e, gx0, gy0, gx1 = gx0, gy1 = gy0) {
  // Per-entity cooldown: unreachable or moving goals must not re-run A* every tick.
  const goal = idx(gx0, gy0);
  if (s.rt.pathBudget <= 0 || (e.pathT && s.time < e.pathT && e.goal === goal)) return false;
  s.rt.pathBudget--;
  e.pathT = s.time + 0.6 + (e.id % 5) * 0.05;
  const sx = Math.max(0, Math.min(N - 1, tileOf(e.x))), sy = Math.max(0, Math.min(N - 1, tileOf(e.y)));
  e.path = astar(s, sx, sy, gx0, gy0, gx1, gy1) || [];
  e.pi = 0;
  e.goal = goal;
  return true;
}

/** Follow e.path; returns ARRIVED when done. A newly solid tile forces a repath. */
export function followPath(s, e, speedTiles, dt) {
  if (!e.path || e.pi >= e.path.length) return MOVE.ARRIVED;
  const ti = e.path[e.pi];
  if (solidForFriend(s, ti) && e.pi < e.path.length - 1) { e.path = null; return MOVE.BLOCKED; }
  const tx = ctr(ti % N), ty = ctr((ti / N) | 0);
  const r = stepToward(s, e, tx, ty, speedTiles, dt, 'friend');
  if (Math.hypot(tx - e.x, ty - e.y) < 5) { e.pi++; if (e.pi >= e.path.length) return MOVE.ARRIVED; }
  if (r === MOVE.BLOCKED && e.stuck > 0.8) { e.path = null; e.stuck = 0; return MOVE.BLOCKED; }
  return MOVE.MOVING;
}

/** Push e away from close neighbours in `hash` (same team). */
const NEAR = []; // scratch list reused every call: separation runs for every mover every tick
export function separate(s, e, hash, minDist, who) {
  // Up to 7 neighbours, visited in the spatial hash's order (same result as the
  // former each() callback, without allocating a closure per mover per tick).
  const n = hash.near(e.x, e.y, minDist, NEAR, e, 7);
  if (!n) return;
  let px = 0, py = 0;
  for (let i = 0; i < n; i++) {
    const o = NEAR[i];
    const dx = e.x - o.x, dy = e.y - o.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const k = (minDist - d) / minDist;
    px += (dx / d) * k; py += (dy / d) * k;
    NEAR[i] = null;
  }
  const nx = e.x + px * 1.6, ny = e.y + py * 1.6;
  if (!solidAt(s, nx, ny, who)) { e.x = nx; e.y = ny; }
}
