// Hollow AI (rework Stream B). Each enemy follows the shared flow field toward the Hearth on
// its own lane, detours to bite living things it can actually reach, and smashes any
// structure in its way.
//  - Living targets need a clear line (walls block melee; ranged foes such as the Bog Witch
//    shoot over them), so a Hollow at a wall no longer flips between a friend it cannot
//    reach and the wall.
//  - A target is kept for at least 1 s and chased to aggro + 2 tiles.
//  - Siege commitment: when the way to a bite is blocked, or the flow field runs into a
//    building, the Hollow smashes that tile for at least 2.5 s (or until it breaks) before
//    anything living can pull it away, and only a target it can reach does.
//  - Gloom Hounds (data `hunt`) search a wider radius for villagers first, then soldiers, and
//    never stop to smash a wall that blocks a bite: they flank along the field instead.
// Per-mover fields (plain JSON): siegeT (seconds of siege commitment left), flankT (seconds a
// blocked hound ignores living targets), tgtT / tgtId (time on the current target).
import { BAL } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { T, N, idx, tileOf, ctr, distToRect } from '../grid.js';
import { MOVE, stepToward, separate, setFacing, laneGoal } from './movement.js';
import { hurt, hurtBuilding, getE, getB, emit } from './common.js';
import { solidForEnemy, losClear } from './pathing.js';

const C = BAL.combat;

// Target search scratch (allocation-free): the best living target for qE.
let qE = null, qS = null, qWho = 'enemy', qBest = null, qScore = 0, qHunt = false, qRanged = false;
function considerFriend(f) {
  if (f.flying) return false;
  const dx = f.x - qE.x, dy = f.y - qE.y;
  let sc = dx * dx + dy * dy;
  if (qHunt && f.kind === 'villager') sc *= 0.36; // hounds go for villagers first
  if (sc >= qScore) return false;
  if (!qRanged && !losClear(qS, qE.x, qE.y, f.x, f.y, qWho)) return false;
  qScore = sc; qBest = f;
  return false;
}
function findFriend(s, e, r, who, hunt, ranged) {
  qE = e; qS = s; qWho = who; qBest = null; qScore = r * r; qHunt = hunt; qRanged = ranged;
  s.rt.friendHash.each(e.x, e.y, r, considerFriend);
  const f = qBest;
  qE = null; qS = null; qBest = null;
  return f;
}

export function updateEnemies(s, dt) {
  const rt = s.rt;
  for (const e of s.enemies) {
    if (!e.alive || e.boss || e.stationary) continue;
    const d = ENEMIES[e.type];
    if (e.slowT > 0) e.slowT -= dt;
    if (e.guard) { updateGuard(s, e, d, dt); continue; }
    e.hitT = Math.max(0, e.hitT - dt); e.atkT = Math.max(0, e.atkT - dt); e.cd -= dt;
    if (e.siegeT > 0) e.siegeT = Math.max(0, e.siegeT - dt);
    if (e.flankT > 0) e.flankT = Math.max(0, e.flankT - dt);
    const tx = Math.max(0, Math.min(N - 1, tileOf(e.x))), ty = Math.max(0, Math.min(N - 1, tileOf(e.y)));
    const ti = idx(tx, ty);
    e.lit = s.lit[ti];
    const who = d.phase ? 'phase' : 'enemy';
    const speed = d.speed * e.speedMult * (d.phase && e.lit ? 0.75 : 1) * (e.slowT > 0 ? 1 - (e.slowAmt || 0.4) : 1);
    const ranged = d.range >= 2;
    const hunt = d.hunt || 0;
    const aggro = Math.max(d.aggro, hunt);

    let t = getE(s, e.targetId);
    if (t && !t.alive) t = null;
    e.think -= dt;
    if (!t && e.targetId) { e.targetId = 0; e.think = Math.min(e.think, 0.1); }
    if (e.think <= 0) {
      e.think = 0.4;
      if (!aggro) t = null;
      else {
        const sb = e.siege ? getB(s, e.siege) : null;
        const committed = sb && sb.alive && e.siegeT > 0;
        // Keep a reachable target for at least a second (hysteresis), else look again.
        const keep = t && (e.tgtT || 0) < C.minTargetHold && Math.hypot(t.x - e.x, t.y - e.y) < (aggro + C.biteRelease) * T &&
          (ranged || losClear(s, e.x, e.y, t.x, t.y, who));
        if (!keep) {
          let r = d.prefers === 'buildings' ? T * 1.1 : aggro * T;
          // While committed to a siege, only something right beside it pulls it away.
          if (committed) r = Math.min(r, d.range * T + e.r + 10);
          t = e.flankT > 0 ? null : findFriend(s, e, r, who, hunt > 0, ranged);
        }
      }
      e.targetId = t ? t.id : 0;
    }
    if (t && t.id !== e.tgtId) { e.tgtId = t.id; e.tgtT = 0; } else if (t) e.tgtT = (e.tgtT || 0) + dt;

    // 1. Bite a living target.
    if (t && Math.hypot(t.x - e.x, t.y - e.y) < (aggro + C.biteRelease) * T) {
      const reach = d.range * T + t.r + e.r * 0.4;
      const dist = Math.hypot(t.x - e.x, t.y - e.y);
      setFacing(e, t.x - e.x, 'target');
      if (dist <= reach && (ranged || losClear(s, e.x, e.y, t.x, t.y, who))) { if (e.cd <= 0) strike(s, e, d, t, null); }
      else {
        const r = stepToward(s, e, t.x, t.y, speed, dt, who);
        if (r === MOVE.BLOCKED) {
          e.targetId = 0;
          // Hounds flank instead of smashing; everyone else commits to the blocking tile.
          if (d.ignoreBuildings) e.flankT = C.flankTime;
          else trySiege(s, e);
        }
      }
      separate(s, e, rt.enemyHash, e.r * 1.7, who);
      continue;
    }
    e.targetId = 0;

    // 2. Keep smashing whatever we are besieging.
    const sb = getB(s, e.siege);
    if (sb) {
      if (distToRect(e.x, e.y, sb) <= d.range * T + e.r + 2) {
        const cx = (sb.tx + sb.size / 2) * T;
        setFacing(e, cx - e.x, 'target');
        if (e.cd <= 0) strike(s, e, d, null, sb);
        separate(s, e, rt.enemyHash, e.r * 1.5, who);
        continue;
      }
      // Phasing shades only besiege what they cannot pass.
      stepToward(s, e, (sb.tx + sb.size / 2) * T, (sb.ty + sb.size / 2) * T, speed, dt, who);
      if (e.blockTile >= 0) trySiege(s, e);
      separate(s, e, rt.enemyHash, e.r * 1.5, who);
      continue;
    }
    e.siege = 0;

    // 3. Follow the flow field, on this mover's own lane.
    const field = d.phase ? rt.fieldP : rt.fieldN;
    const n = field.next[ti];
    let gx, gy;
    if (n < 0) {
      const h = rt.hearth;
      if (!h) continue;
      if (distToRect(e.x, e.y, h) <= d.range * T + e.r + 2) { e.siege = h.id; e.siegeT = C.siegeCommit; continue; }
      gx = (h.tx + 1.5) * T; gy = (h.ty + 1.5) * T;
    } else {
      const occ = s.occ[n];
      if (occ && solidForEnemy(s, n, d.phase)) { e.siege = occ; e.siegeT = C.siegeCommit; continue; }
      const L = laneGoal(s, e, ctr(n % N), ctr((n / N) | 0), who);
      gx = L[0]; gy = L[1];
    }
    const r = stepToward(s, e, gx, gy, speed, dt, who);
    if (r === MOVE.BLOCKED) trySiege(s, e);
    separate(s, e, rt.enemyHash, e.r * 1.7, who);
  }
}

function trySiege(s, e) {
  if (e.blockTile < 0) return;
  const occ = s.occ[e.blockTile];
  if (occ) { if (e.siege !== occ) e.siegeT = C.siegeCommit; e.siege = occ; }
}

function strike(s, e, d, target, building) {
  e.cd = d.rate; e.atkT = 0.2;
  const dmg = d.dmg * e.dmgMult;
  if (target) hurt(s, target, dmg, d.dmgType, null, e.x, e.y, e);
  else if (building) { hurtBuilding(s, building, dmg, d.dmgType); building.lastHit = s.time; }
  emit(s, { t: 'sfx', k: building ? 'thud' : 'bite', x: e.x, y: e.y });
}

// Lair guards and other homebound creatures: e.guard = { x, y, r } (world units).
// They rest near home, attack anything that comes within r of home, chase a
// little past it, then walk back. They never follow the flow field.
function updateGuard(s, e, d, dt) {
  const g = e.guard;
  e.hitT = Math.max(0, e.hitT - dt); e.atkT = Math.max(0, e.atkT - dt); e.cd -= dt;
  e.think -= dt;
  if (e.think <= 0) {
    e.think = 0.4;
    const f = s.rt.friendHash.nearest(g.x, g.y, g.r);
    e.targetId = f ? f.id : (e.hitT > 0 ? e.targetId : 0);
  }
  const t = getE(s, e.targetId);
  const fromHome = Math.hypot(e.x - g.x, e.y - g.y);
  if (t && fromHome < g.r * 1.6) {
    const reach = d.range * T + t.r + e.r * 0.4;
    setFacing(e, t.x - e.x, 'target');
    if (Math.hypot(t.x - e.x, t.y - e.y) <= reach && losClear(s, e.x, e.y, t.x, t.y, 'enemy')) { if (e.cd <= 0) strike(s, e, d, t, null); }
    else stepToward(s, e, t.x, t.y, d.speed * e.speedMult, dt, 'enemy');
  } else {
    e.targetId = 0;
    if (fromHome > 6) stepToward(s, e, g.x + e.jx, g.y + e.jy, d.speed * 0.6, dt, 'enemy');
    else if (fromHome < 3) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.05 * dt); // lick wounds at home
  }
  separate(s, e, s.rt.enemyHash, e.r * 1.6, 'enemy');
}
