// Hollow AI. Each enemy follows the shared flow field toward the Hearth,
// detours to bite nearby living things, and smashes any structure in its way.
import { ENEMIES } from '../../data/enemies.js';
import { T, N, idx, tileOf, ctr, distToRect } from '../grid.js';
import { MOVE, stepToward, separate } from './movement.js';
import { hurt, hurtBuilding, getE, getB, emit } from './common.js';
import { solidForEnemy } from './pathing.js';

export function updateEnemies(s, dt) {
  const rt = s.rt;
  for (const e of s.enemies) {
    if (!e.alive || e.boss || e.stationary) continue;
    const d = ENEMIES[e.type];
    if (e.slowT > 0) e.slowT -= dt;
    e.hitT = Math.max(0, e.hitT - dt); e.atkT = Math.max(0, e.atkT - dt); e.cd -= dt;
    const tx = Math.max(0, Math.min(N - 1, tileOf(e.x))), ty = Math.max(0, Math.min(N - 1, tileOf(e.y)));
    const ti = idx(tx, ty);
    e.lit = s.lit[ti];
    const who = d.phase ? 'phase' : 'enemy';
    const speed = d.speed * e.speedMult * (d.phase && e.lit ? 0.75 : 1) * (e.slowT > 0 ? 1 - (e.slowAmt || 0.4) : 1);

    e.think -= dt;
    if (e.think <= 0) {
      e.think = 0.4;
      const r = d.prefers === 'buildings' ? T * 1.1 : d.aggro * T;
      const f = rt.friendHash.nearest(e.x, e.y, r);
      e.targetId = f ? f.id : 0;
    }

    // 1. Bite a living target.
    const t = getE(s, e.targetId);
    if (t && Math.hypot(t.x - e.x, t.y - e.y) < (d.aggro + 2) * T) {
      const reach = d.range * T + t.r + e.r * 0.4;
      const dist = Math.hypot(t.x - e.x, t.y - e.y);
      if (Math.abs(t.x - e.x) > 1) e.face = t.x < e.x ? -1 : 1;
      if (dist <= reach) { if (e.cd <= 0) strike(s, e, d, t, null); }
      else {
        const r = stepToward(s, e, t.x, t.y, speed, dt, who);
        if (r === MOVE.BLOCKED) { e.targetId = 0; trySiege(s, e); }
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
        if (Math.abs(cx - e.x) > 2) e.face = cx < e.x ? -1 : 1;
        if (e.cd <= 0) strike(s, e, d, null, sb);
        separate(s, e, rt.enemyHash, e.r * 1.5, who);
        continue;
      }
      // Phasing shades only besiege what they cannot pass.
      stepToward(s, e, (sb.tx + sb.size / 2) * T, (sb.ty + sb.size / 2) * T, speed, dt, who);
      if (e.blockTile >= 0) trySiege(s, e);
      continue;
    }
    e.siege = 0;

    // 3. Follow the flow field.
    const field = d.phase ? rt.fieldP : rt.fieldN;
    const n = field.next[ti];
    let gx, gy;
    if (n < 0) {
      const h = rt.hearth;
      if (!h) continue;
      if (distToRect(e.x, e.y, h) <= d.range * T + e.r + 2) { e.siege = h.id; continue; }
      gx = (h.tx + 1.5) * T; gy = (h.ty + 1.5) * T;
    } else {
      const occ = s.occ[n];
      if (occ && solidForEnemy(s, n, d.phase)) { e.siege = occ; continue; }
      gx = ctr(n % N) + e.jx * 0.6; gy = ctr((n / N) | 0) + e.jy * 0.6;
    }
    const r = stepToward(s, e, gx, gy, speed, dt, who);
    if (r === MOVE.BLOCKED) trySiege(s, e);
    separate(s, e, rt.enemyHash, e.r * 1.7, who);
  }
}

function trySiege(s, e) {
  if (e.blockTile < 0) return;
  const occ = s.occ[e.blockTile];
  if (occ) e.siege = occ;
}

function strike(s, e, d, target, building) {
  e.cd = d.rate; e.atkT = 0.2;
  const dmg = d.dmg * e.dmgMult;
  if (target) hurt(s, target, dmg, d.dmgType, null, e.x, e.y);
  else if (building) { hurtBuilding(s, building, dmg, d.dmgType); building.lastHit = s.time; }
  emit(s, { t: 'sfx', k: building ? 'thud' : 'bite', x: e.x, y: e.y });
}
