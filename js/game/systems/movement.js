// Shared locomotion (rework Stream A).
//
// Movers steer with a velocity: seek with arrival (friendlies slow down inside one tile
// and stop within 0.5 units), a turn-rate cap (about 540 degrees a second) so corners
// become arcs, and axis-sliding against solid tiles. Path followers steer at a look-ahead
// point 1.25 tiles along a string-pulled A* path. Separation is a capped velocity term
// (at most 30% of the mover's speed) worked out from a snapshot taken after every mover
// has moved. Knockback is a short decaying impulse that respects solidity, and slows are
// speed multipliers, never position rewinds. Walk animation comes from the distance a
// mover actually walked under its own power, and facing has hysteresis.
//
// Contract (EMBERCROWN-REWORK.md section 3.0):
//   stepToward / followPath write e.vx, e.vy (units/s), e.locoDist (distance walked this
//     tick under own power, after collisions) and, at the end of the tick, e.walk (0/1,
//     on above 20% of nominal speed for 2 ticks, off below it for 6 ticks, so a strike
//     between two steps does not flicker to idle) and e.anim (advanced by e.locoDist only:
//     pushed, knocked back or blocked movers do not walk in place).
//   setFacing(e, dirX, mode)  mode 'move' | 'target'; flips after 150 ms, ignores |dirX| <= 4.
//     Steering faces along the velocity, except while the mover has a live e.targetId:
//     then the fight code owns facing (call setFacing(e, t.x - e.x, 'target')).
//   laneGoal(s, e, gx, gy, who) a flow-field goal moved onto the mover's own lane.
//   applyImpulse(e, dx, dy)   total displacement spread over 0.15 s (a big shove such as
//     Nova's takes longer: never more than 6 units a tick), blocked by solid tiles.
//   applySlow(s, e, mult)     speed multiplier for this tick and the next (call every tick
//     while the slow lasts). A system may instead hold e.slowMult itself (no e.slowS).
//   losClear(...)             lives in pathing.js.
//
// Per-mover fields (plain JSON, all optional): vx, vy, pvx, pvy, locoDist, nomSp, walk,
// walkN, anim, face, faceN, faceS, faceC, faceM, kx, ky, kT, slowMult, slowS, sepS, stuck,
// blockTile.
import { T, N, idx, tileOf, ctr, WORLD } from '../grid.js';
import { solidForFriend, solidForEnemy, astar, losClear } from './pathing.js';
import { ENEMIES } from '../../data/enemies.js';
import { SpatialHash } from '../spatial.js';

export const MOVE = { MOVING: 0, ARRIVED: 1, BLOCKED: 2 };

// Math.hypot is several times slower than this in V8, and these run for every mover every tick.
const len2 = (x, y) => Math.sqrt(x * x + y * y);

export const LOCO = {
  turnRate: (540 * Math.PI) / 180, // radians per second
  arriveR: T,                      // friendlies start slowing inside one tile...
  arriveMin: 0.3,                  // ...down to 30% of their speed
  look: T * 1.25,                  // path look-ahead distance
  sepCap: 0.3,                     // separation speed, fraction of the mover's speed
  sepIdle: 0.4,                    // weight of separation on a mover that is standing still
  sepR: { soldier: 14, hero: 14, sovereign: 14, villager: 10 },
  knockTime: 0.15,                 // seconds an impulse takes to play out...
  knockStep: 6,                    // ...but never more than this many units in one tick
  faceTicks: 3,                    // 150 ms at 20 Hz
  faceMin: 4,                      // |dirX| at or below this never flips facing
  walkOn: 0.2,                     // fraction of nominal speed that counts as walking
  walkOnTicks: 2,                  // start the walk cycle after 2 ticks above it...
  walkOffTicks: 6,                 // ...and stop it after 0.3 s below it (a strike between steps)
};

// The tick being simulated (set by beginLocomotion). Module state, but only ever a copy of
// s.tick, so it never makes two runs differ.
let curTick = 0;

function solidAt(s, x, y, who) {
  const tx = tileOf(x), ty = tileOf(y);
  if (tx < 0 || ty < 0 || tx >= N || ty >= N) return true;
  const i = idx(tx, ty);
  return who === 'friend' ? solidForFriend(s, i) : solidForEnemy(s, i, who === 'phase');
}
/** Solid for this mover, ignoring the tile it already stands in (so it can walk out of a wall
 *  that was built on top of it, but never into a second solid tile). */
function blockedFrom(s, cur, x, y, who) {
  const tx = tileOf(x), ty = tileOf(y);
  if (tx < 0 || ty < 0 || tx >= N || ty >= N) return true;
  const i = idx(tx, ty);
  if (i === cur) return false;
  return who === 'friend' ? solidForFriend(s, i) : solidForEnemy(s, i, who === 'phase');
}
function curTileOf(e) {
  const tx = tileOf(e.x), ty = tileOf(e.y);
  return tx >= 0 && ty >= 0 && tx < N && ty < N ? idx(tx, ty) : -1;
}
function clampWorld(e) {
  if (e.x < 2) e.x = 2; else if (e.x > WORLD - 2) e.x = WORLD - 2;
  if (e.y < 2) e.y = 2; else if (e.y > WORLD - 2) e.y = WORLD - 2;
}
/** Move e by (mx, my) with axis-sliding. Returns 0 = full move, 1 = slid, 2 = blocked. */
function slide(s, e, mx, my, who) {
  const cur = curTileOf(e);
  const nx = e.x + mx, ny = e.y + my;
  e.blockTile = -1;
  if (!blockedFrom(s, cur, nx, ny, who)) { e.x = nx; e.y = ny; clampWorld(e); return 0; }
  if (Math.abs(mx) > 1e-6 && !blockedFrom(s, cur, nx, e.y, who)) { e.x = nx; e.blockTile = idx(tileOf(e.x), tileOf(ny)); clampWorld(e); return 1; }
  if (Math.abs(my) > 1e-6 && !blockedFrom(s, cur, e.x, ny, who)) { e.y = ny; e.blockTile = idx(tileOf(nx), tileOf(e.y)); clampWorld(e); return 1; }
  const tx = tileOf(nx), ty = tileOf(ny);
  if (tx >= 0 && ty >= 0 && tx < N && ty < N) e.blockTile = idx(tx, ty);
  return 2;
}
function whoOf(e) {
  if (e.kind !== 'enemy') return 'friend';
  const d = ENEMIES[e.type];
  return d && d.phase ? 'phase' : 'enemy';
}
/** Speed multiplier from slows: applySlow() lasts this tick and the next; a bare e.slowMult
 *  (no e.slowS) is held by whoever set it. */
export function slowOf(e) {
  const m = e.slowMult;
  if (m === undefined || m === null) return 1;
  if (e.slowS !== undefined && e.slowS !== null && e.slowS < curTick - 1) return 1;
  return m < 0 ? 0 : m;
}
export function applySlow(s, e, mult) {
  if (e.slowS !== s.tick) { e.slowMult = mult; e.slowS = s.tick; }
  else if (mult < e.slowMult) e.slowMult = mult;
}

/** Facing with hysteresis: flip only after the other side has been wanted for 150 ms and
 *  |dirX| > 4. 'target' (attacking, holding toward a foe) wins over 'move' in the same tick. */
export function setFacing(e, dirX, mode = 'move') {
  if (mode !== 'target' && e.faceM === curTick) return;
  if (mode === 'target') e.faceM = curTick;
  if (!(Math.abs(dirX) > LOCO.faceMin)) return;
  const want = dirX < 0 ? -1 : 1;
  if (!e.face) { e.face = want; e.faceN = 0; return; }
  if (want === e.face) { e.faceN = 0; return; }
  if (e.faceS === curTick) return; // already counted this tick
  // Count consecutive ticks of wanting the other side; restart if the facing was changed by
  // anyone else meanwhile (a system that still writes e.face directly).
  e.faceN = e.faceS === curTick - 1 && e.faceC === e.face ? (e.faceN || 0) + 1 : 1;
  e.faceS = curTick; e.faceC = e.face;
  if (e.faceN >= LOCO.faceTicks) { e.face = want; e.faceN = 0; }
}

function engaged(s, e) {
  if (!e.targetId) return false;
  const t = s.rt.eById && s.rt.eById.get(e.targetId);
  return !!(t && t.alive);
}

/** Knockback and shoves: (dx, dy) world units in total, played out over 0.15 s. */
export function applyImpulse(e, dx, dy) {
  e.kx = (e.kx || 0) + dx; e.ky = (e.ky || 0) + dy;
  // Long enough to play the whole shove at no more than knockStep a tick.
  const need = (len2(e.kx, e.ky) / (LOCO.knockStep * 0.55)) * 0.05;
  e.kT = Math.max(LOCO.knockTime, Math.min(0.6, need));
}

/**
 * Steer e toward (gx, gy) at up to speedTiles tiles/s. Records the blocking tile in
 * e.blockTile. `arrive` (default: friendlies yes, the Hollow no) slows down inside one tile.
 */
export function stepToward(s, e, gx, gy, speedTiles, dt, who, arrive) {
  const dx = gx - e.x, dy = gy - e.y;
  const d = len2(dx, dy);
  e.blockTile = -1;
  if (d < 0.5) return MOVE.ARRIVED;
  const nom = speedTiles * T;
  e.nomSp = nom;
  let sp = nom * slowOf(e);
  if (sp <= 0) return MOVE.MOVING;
  if (arrive === undefined ? who === 'friend' : arrive) {
    if (d < LOCO.arriveR) sp *= Math.max(LOCO.arriveMin, d / LOCO.arriveR);
  }
  let ux = dx / d, uy = dy / d;
  // Turn-rate cap against last tick's heading (not near the goal, so nothing orbits it).
  const pvx = e.pvx || 0, pvy = e.pvy || 0, pv = len2(pvx, pvy);
  if (pv > 2 && d > 8) {
    const hx = pvx / pv, hy = pvy / pv;
    const ang = Math.atan2(hx * uy - hy * ux, hx * ux + hy * uy);
    const cap = LOCO.turnRate * dt;
    if (Math.abs(ang) > cap) {
      const a = ang > 0 ? cap : -cap, c = Math.cos(a), sn = Math.sin(a);
      ux = hx * c - hy * sn; uy = hx * sn + hy * c;
      // Ease off while turning hard: a tight arc instead of a wide swing.
      sp *= Math.max(0.35, Math.cos(Math.min(Math.abs(ang), Math.PI / 2) * 0.9));
    }
  }
  const step = Math.min(sp * dt, d);
  const x0 = e.x, y0 = e.y;
  const r = slide(s, e, ux * step, uy * step, who);
  const mx = e.x - x0, my = e.y - y0;
  const moved = len2(mx, my);
  e.locoDist = (e.locoDist || 0) + moved;
  e.vx = mx / dt; e.vy = my / dt;
  // Face along the velocity, unless the mover is engaging a target: then whoever runs its
  // fight decides the facing (toward the foe), and walking never fights it.
  if (moved > 0.01 && !engaged(s, e)) setFacing(e, e.vx, 'move');
  if (r === 2) { e.stuck = (e.stuck || 0) + dt; return MOVE.BLOCKED; }
  e.stuck = Math.max(0, (e.stuck || 0) - dt * 0.5);
  return len2(gx - e.x, gy - e.y) <= 0.6 ? MOVE.ARRIVED : MOVE.MOVING;
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

/**
 * Follow e.path (string-pulled waypoints, tile indices) by steering at a point 1.25 tiles
 * ahead along it; arrives (slowing down) at the last waypoint. A blocked leg forces a repath.
 */
export function followPath(s, e, speedTiles, dt) {
  const P = e.path;
  if (!P || e.pi >= P.length) return MOVE.ARRIVED;
  const last = P.length - 1;
  // Waypoints already reached: inside half a tile, or already behind us (we are past it along
  // the next leg and can see the waypoint after it), so the look-ahead never doubles back.
  while (e.pi < last) {
    const ai = P[e.pi], bi = P[e.pi + 1];
    const ax = ctr(ai % N), ay = ctr((ai / N) | 0), bx = ctr(bi % N), by = ctr((bi / N) | 0);
    if (len2(ax - e.x, ay - e.y) < T * 0.5) { e.pi++; continue; }
    if ((e.x - ax) * (bx - ax) + (e.y - ay) * (by - ay) > 0 && losClear(s, e.x, e.y, bx, by, 'friend', 5)) { e.pi++; continue; }
    break;
  }
  const ti = P[e.pi];
  const wx = ctr(ti % N), wy = ctr((ti / N) | 0);
  if (solidForFriend(s, ti) && e.pi < last) { e.path = null; return MOVE.BLOCKED; }
  // Something was built across the current leg: plan again (checked a few times a second).
  if ((s.tick + e.id) % 7 === 0 && !losClear(s, e.x, e.y, wx, wy, 'friend')) { e.path = null; return MOVE.BLOCKED; }
  // Look-ahead point along the remaining polyline.
  let lx = wx, ly = wy, ax = e.x, ay = e.y, left = LOCO.look, k = e.pi, toEnd = true;
  for (;;) {
    const bi = P[k], bx = ctr(bi % N), by = ctr((bi / N) | 0);
    const seg = len2(bx - ax, by - ay);
    if (seg >= left) { const f = left / seg; lx = ax + (bx - ax) * f; ly = ay + (by - ay) * f; toEnd = false; break; }
    left -= seg; ax = bx; ay = by; lx = bx; ly = by;
    if (k >= last) break;
    k++;
  }
  // Never cut a corner the body cannot clear: then seek the waypoint itself.
  if (k > e.pi && !losClear(s, e.x, e.y, lx, ly, 'friend', 5)) { lx = wx; ly = wy; toEnd = e.pi === last; }
  const r = stepToward(s, e, lx, ly, speedTiles, dt, 'friend', toEnd);
  if (e.pi === last && len2(wx - e.x, wy - e.y) < 5) { e.pi = P.length; return MOVE.ARRIVED; }
  if (r === MOVE.BLOCKED && e.stuck > 0.8) { e.path = null; e.stuck = 0; return MOVE.BLOCKED; }
  return MOVE.MOVING;
}

/** A point beside a flow-field goal, on this mover's own lane: a persistent sideways offset
 *  of 10-14 units (sign and size fixed by the id), perpendicular to the direction of travel,
 *  so a crowd walks in parallel lanes instead of single file (for the Hollow, applied by
 *  enemies.js). laneGoal never puts the point in a solid tile or behind one: it halves the
 *  offset, then drops it, when the lane would clip something (a gap between walls).
 *  Returns a shared [x, y] scratch pair: read it at once. */
export function laneOffset(e) {
  const h = ((e.id * 2654435761) >>> 0) / 4294967296; // deterministic from the id
  const mag = 10 + 4 * ((h * 7) % 1);
  return h < 0.5 ? -mag : mag;
}
const LANE = [0, 0];
export function laneGoal(s, e, gx, gy, who = 'enemy') {
  const dx = gx - e.x, dy = gy - e.y, d = len2(dx, dy);
  LANE[0] = gx; LANE[1] = gy;
  if (d < 1) return LANE;
  let o = laneOffset(e);
  for (let k = 0; k < 2; k++, o *= 0.5) {
    const lx = gx - (dy / d) * o, ly = gy + (dx / d) * o;
    if (!solidAt(s, lx, ly, who) && losClear(s, e.x, e.y, lx, ly, who)) { LANE[0] = lx; LANE[1] = ly; break; }
  }
  return LANE;
}

// ---- Separation ---------------------------------------------------------------------------
// Callers ask for it during their update; it is resolved once everyone has moved.
// Scratch buffers reused every tick (filled by index with a count, never truncated, so they
// keep their storage instead of reallocating each tick).
const SEP = [];       // movers that asked this tick
const SEP_R = [];     // their radius
const SEP_W = [];     // their solidity rule
let SEP_N = 0;
const NEAR = [];
const PUSH = [];

/** Ask for separation from same-team neighbours (resolved after all movers have moved).
 *  minDist is a floor: soldiers, heroes and the Sovereign use 14, villagers 10. */
export function separate(s, e, hash, minDist, who) {
  if (e.sepS === curTick) return; // once per mover per tick
  e.sepS = curTick;
  SEP[SEP_N] = e;
  SEP_R[SEP_N] = Math.max(minDist, LOCO.sepR[e.kind] || 0);
  SEP_W[SEP_N] = who;
  SEP_N++;
}

function resetLoco(e) { e.pvx = e.vx || 0; e.pvy = e.vy || 0; e.vx = 0; e.vy = 0; e.locoDist = 0; }
/** Start of a tick: remember last tick's velocity, clear this tick's locomotion record. */
export function beginLocomotion(s) {
  curTick = s.tick;
  for (let i = 0; i < SEP_N; i++) SEP[i] = null;
  SEP_N = 0;
  for (const e of s.heroes) resetLoco(e);
  for (const e of s.villagers) resetLoco(e);
  for (const e of s.soldiers) resetLoco(e);
  for (const e of s.enemies) resetLoco(e);
  if (s.sovereign) resetLoco(s.sovereign);
}

function playImpulse(s, e, dt) {
  if (!(e.kT > 0)) return;
  let mx = e.kx * 0.55, my = e.ky * 0.55;
  const m = len2(mx, my);
  if (m > LOCO.knockStep) { mx *= LOCO.knockStep / m; my *= LOCO.knockStep / m; }
  const bt = e.blockTile;
  const r = slide(s, e, mx, my, whoOf(e));
  e.blockTile = bt;
  if (r === 2) { e.kx = 0; e.ky = 0; e.kT = 0; return; }
  e.kx -= mx; e.ky -= my; e.kT -= dt;
  if (e.kT <= 1e-6 || Math.abs(e.kx) + Math.abs(e.ky) < 0.05) { e.kx = 0; e.ky = 0; e.kT = 0; }
}
function finishMover(e, dt) {
  const nom = e.nomSp || T * 1.5;
  const fast = e.locoDist / dt > LOCO.walkOn * nom ? 1 : 0;
  if (fast !== (e.walk || 0)) {
    e.walkN = (e.walkN || 0) + 1;
    if (e.walkN >= (fast ? LOCO.walkOnTicks : LOCO.walkOffTicks)) { e.walk = fast; e.walkN = 0; }
  } else e.walkN = 0;
  if (e.walk === undefined) e.walk = 0;
  if (e.locoDist > 0 && !e.boss) e.anim = (e.anim || 0) + e.locoDist * 0.25;
}

/** End of the movement part of a tick: play impulses, resolve separation from a snapshot of
 *  where everyone ended up, then derive walk flags and walk-cycle phase. */
export function endLocomotion(s, dt) {
  const rt = s.rt;
  for (const e of s.heroes) if (e.alive) playImpulse(s, e, dt);
  for (const e of s.villagers) if (e.alive) playImpulse(s, e, dt);
  for (const e of s.soldiers) if (e.alive) playImpulse(s, e, dt);
  for (const e of s.enemies) if (e.alive) playImpulse(s, e, dt);
  if (s.sovereign && s.sovereign.alive) playImpulse(s, s.sovereign, dt);

  if (SEP_N) {
    const fh = rt.sepF || (rt.sepF = new SpatialHash(64, 512));
    const eh = rt.sepE || (rt.sepE = new SpatialHash(64, 1024));
    fh.clear(); eh.clear();
    for (const v of s.villagers) if (v.alive && v.st !== 'sheltered') fh.insert(v);
    for (const u of s.soldiers) if (u.alive) fh.insert(u);
    for (const u of s.heroes) if (u.alive && !u.away) fh.insert(u);
    if (s.sovereign && s.sovereign.alive) fh.insert(s.sovereign);
    for (const e of s.enemies) if (e.alive) eh.insert(e);
    // Work out every push from the snapshot first...
    for (let i = 0; i < SEP_N; i++) {
      const e = SEP[i], R = SEP_R[i];
      let px = 0, py = 0;
      if (e.alive) {
        const n = (e.kind === 'enemy' ? eh : fh).near(e.x, e.y, R, NEAR, e, 8);
        for (let j = 0; j < n; j++) {
          const o = NEAR[j]; NEAR[j] = null;
          if (o.kind === 'villager' && o.st === 'sheltered') continue;
          let dx = e.x - o.x, dy = e.y - o.y, d = len2(dx, dy);
          if (d < 0.01) { const a = ((e.id * 2.399) % 6.283) + (e.id < o.id ? 0 : Math.PI); dx = Math.cos(a); dy = Math.sin(a); d = 1; }
          const k = Math.sqrt((R - d) / R); // firm when close, soft at the rim
          px += (dx / d) * k; py += (dy / d) * k;
        }
      }
      PUSH[2 * i] = px; PUSH[2 * i + 1] = py;
    }
    // ...then apply them as a capped velocity.
    for (let i = 0; i < SEP_N; i++) {
      const e = SEP[i];
      let px = PUSH[2 * i], py = PUSH[2 * i + 1];
      const m = len2(px, py);
      if (!e.alive || m < 1e-4) continue;
      const cap = LOCO.sepCap * (e.nomSp || T * 1.5) * slowOf(e);
      let v = Math.min(1, m) * cap;
      // A mover standing idle (no target, not walking: e.g. at its formation slot) is only
      // nudged, so passers-by flow around it instead of shoving it off its spot.
      if (!(e.locoDist > 0.05) && !e.targetId && !e.siege) v *= LOCO.sepIdle;
      const step = v * dt;
      px = (px / m) * step; py = (py / m) * step;
      const x0 = e.x, y0 = e.y, bt = e.blockTile;
      slide(s, e, px, py, SEP_W[i]);
      e.blockTile = bt;
      const moved = len2(e.x - x0, e.y - y0);
      e.locoDist = (e.locoDist || 0) + moved;
      e.vx = (e.vx || 0) + (e.x - x0) / dt; e.vy = (e.vy || 0) + (e.y - y0) / dt;
    }
    for (let i = 0; i < SEP_N; i++) SEP[i] = null;
    SEP_N = 0;
  }
  for (const e of s.heroes) if (e.alive) finishMover(e, dt);
  for (const e of s.villagers) if (e.alive) finishMover(e, dt);
  for (const e of s.soldiers) if (e.alive) finishMover(e, dt);
  for (const e of s.enemies) if (e.alive) finishMover(e, dt);
  if (s.sovereign && s.sovereign.alive) finishMover(s.sovereign, dt);
}
