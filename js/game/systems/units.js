// Player soldiers (in squads) and the Ember-Sovereign. Squads hold a rally
// point; members auto-engage Hollow near it and return when the threat ends.
import { BAL } from '../../data/balance.js';
import { UNITS, SOVEREIGN_ABILITIES } from '../../data/units.js';
import { T, N, idx, tileOf, distToRect, clamp, WORLD } from '../grid.js';
import { MOVE, stepToward, requestPath, followPath, separate } from './movement.js';
import { hurt, getE, emit } from './common.js';
import { spawnProjectile } from './combat.js';

const C = BAL.combat;

function auraAt(s, x, y) {
  for (const b of s.banners) if (Math.hypot(b.x - x, b.y - y) <= b.r) return b;
  return null;
}

export function slotOffset(slot) {
  const col = slot % 3, row = Math.floor(slot / 3);
  return { x: (col - 1) * 15 + (row % 2) * 6, y: (row - 0.8) * 14 };
}

export function updateUnits(s, dt) {
  // Re-pack formation slots once a second so gaps close after losses.
  if (s.tick % 20 === 0) {
    const counts = new Map();
    for (const u of s.soldiers) { if (!u.alive) continue; const c = counts.get(u.squad) || 0; u.slot = c; counts.set(u.squad, c + 1); }
    s.squads = s.squads.filter((q) => (counts.get(q.id) || 0) > 0 || s.rt.bById.has(q.bId));
  }
  const sqById = s.rt.sqById || (s.rt.sqById = new Map());
  sqById.clear();
  for (const q of s.squads) {
    sqById.set(q.id, q);
    if (q.targetId) {
      const t = getE(s, q.targetId);
      if (t) { q.rx = t.x; q.ry = t.y; } else q.targetId = 0;
    }
  }
  for (const u of s.soldiers) if (u.alive) updateSoldier(s, u, sqById.get(u.squad), dt);
  updateSovereign(s, dt);
  // Expire banners.
  for (let i = s.banners.length - 1; i >= 0; i--) if (s.banners[i].until <= s.time) s.banners.splice(i, 1);
}

function updateSoldier(s, u, sq, dt) {
  const d = UNITS[u.type];
  u.hitT = Math.max(0, u.hitT - dt); u.atkT = Math.max(0, u.atkT - dt); u.cd -= dt;
  if (!sq) return;
  const off = slotOffset(u.slot);
  const rx = sq.rx + off.x, ry = sq.ry + off.y;
  u.think -= dt;
  if (u.think <= 0) {
    u.think = 0.35;
    if (sq.targetId) u.targetId = sq.targetId;
    else {
      const reach = (d.ranged ? d.range + 0.5 : C.aggroRadius) * T;
      const t = s.rt.enemyHash.nearest(u.x, u.y, reach, (e) => (d.ranged || !e.flying) && Math.hypot(e.x - sq.rx, e.y - sq.ry) < C.leash * T);
      u.targetId = t ? t.id : 0;
    }
  }
  const t = getE(s, u.targetId);
  if (t) {
    if (!sq.targetId && Math.hypot(u.x - sq.rx, u.y - sq.ry) > C.leash * T) { u.targetId = 0; return; }
    engage(s, u, t, d, dt, 1 + s.mods.soldierDmg + (d.ranged ? s.mods.rangedDmg || 0 : 0));
  } else {
    moveTo(s, u, rx, ry, d.speed, dt);
  }
  separate(s, u, s.rt.friendHash, C.separation, 'friend');
}

// Shared melee/ranged engagement logic for soldiers and the Sovereign.
function engage(s, u, t, d, dt, dmgMult) {
  // Melee cannot reach a foe on the wing; hold position until it lands.
  if (t.flying && !d.ranged) { u.targetId = 0; if (u.kind === 'sovereign') u.orderTarget = 0; return; }
  const dist = Math.hypot(t.x - u.x, t.y - u.y);
  const reach = d.range * T + t.r + u.r * 0.5;
  if (Math.abs(t.x - u.x) > 1) u.face = t.x < u.x ? -1 : 1;
  if (dist <= reach) {
    u.path = null;
    if (u.cd <= 0) {
      const aura = auraAt(s, u.x, u.y);
      const ab = SOVEREIGN_ABILITIES.banner;
      const mult = dmgMult * (aura ? 1 + ab.dmgBonus : 1);
      u.cd = d.rate * (aura ? 1 - ab.rateBonus : 1);
      u.atkT = 0.18;
      if (d.ranged) {
        spawnProjectile(s, 'arrow', u.x, u.y - 10, t, d.dmg * mult, d.dmgType, d.bonus, 13, 1);
        emit(s, { t: 'sfx', k: 'bow', x: u.x, y: u.y });
      } else {
        hurt(s, t, d.dmg * mult, d.dmgType, d.bonus, u.x, u.y);
        emit(s, { t: 'sfx', k: 'clash', x: u.x, y: u.y });
        if (d.cleave) {
          let n = 1;
          s.rt.enemyHash.each(u.x, u.y, reach + T * 0.4, (o) => {
            if (o === t) return false;
            hurt(s, o, d.dmg * mult * 0.6, d.dmgType, d.bonus, u.x, u.y);
            return ++n >= d.cleave;
          });
        }
      }
    }
  } else if (dist > T * 2.5) {
    // Far away: walk a real path so rivers, trees and walls are routed around.
    moveTo(s, u, t.x, t.y, d.speed, dt);
  } else {
    const r = stepToward(s, u, t.x, t.y, d.speed, dt, 'friend');
    if (r === MOVE.BLOCKED && u.stuck > 1.2) { u.targetId = 0; u.stuck = 0; u.path = null; }
  }
}

function moveTo(s, u, x, y, speed, dt) {
  const dd = Math.hypot(x - u.x, y - u.y);
  if (dd < 3) { u.path = null; return; }
  if (dd < T * 1.4) { stepToward(s, u, x, y, speed, dt, 'friend'); return; }
  const gx = clamp(tileOf(x), 0, N - 1), gy = clamp(tileOf(y), 0, N - 1);
  // Keep the current path while the goal drifts less than two tiles.
  const drift = u.goal !== undefined ? Math.max(Math.abs((u.goal % N) - gx), Math.abs(((u.goal / N) | 0) - gy)) : 99;
  if (!u.path || drift > 1) {
    if (!requestPath(s, u, gx, gy)) { if (!u.path) stepToward(s, u, x, y, speed, dt, 'friend'); }
  }
  if (!u.path) return;
  const r = followPath(s, u, speed, dt);
  if (r === MOVE.ARRIVED) { u.path = null; stepToward(s, u, x, y, speed, dt, 'friend'); }
}

function updateSovereign(s, dt) {
  const v = s.sovereign;
  if (!v || !v.alive) return;
  const d = UNITS.sovereign;
  const S = BAL.sovereign;
  v.hitT = Math.max(0, v.hitT - dt); v.atkT = Math.max(0, v.atkT - dt); v.cd -= dt;
  v.novaCd = Math.max(0, v.novaCd - dt); v.bannerCd = Math.max(0, v.bannerCd - dt);
  const h = s.rt.hearth;
  const nearHearth = h && distToRect(v.x, v.y, h) < S.hearthRange * T;
  if (nearHearth) v.hp = Math.min(v.maxHp, v.hp + S.regenNearHearth * dt);
  else if (s.time - v.lastHurt > S.idleDelay) v.hp = Math.min(v.maxHp, v.hp + S.regenIdle * dt);

  // Fall back when badly hurt, unless the player just gave a direct order.
  if (!v.retreat && v.hp < v.maxHp * C.retreatHp && s.time - v.orderT > 4 && h) {
    v.retreat = true; v.targetId = 0;
    v.rx = (h.tx + 1.5) * T; v.ry = (h.ty + h.size) * T + 14;
    emit(s, { t: 'toast', text: 'The Sovereign is wounded and falls back to the Hearth!', tone: 'bad', icon: 'crown' });
  }
  if (v.retreat && v.hp > v.maxHp * 0.7) v.retreat = false;

  if (v.orderTarget) {
    const t = getE(s, v.orderTarget);
    if (t) { v.rx = t.x; v.ry = t.y; } else v.orderTarget = 0;
  }
  v.think -= dt;
  if (v.think <= 0) {
    v.think = 0.3;
    if (v.orderTarget) v.targetId = v.orderTarget;
    else {
      const reach = v.retreat ? T * 1.2 : C.aggroRadius * T;
      const t = s.rt.enemyHash.nearest(v.x, v.y, reach, (e) => !e.flying && (v.retreat || Math.hypot(e.x - v.rx, e.y - v.ry) < C.leash * T));
      v.targetId = t ? t.id : 0;
    }
  }
  const t = getE(s, v.targetId);
  if (t && !(v.retreat && Math.hypot(t.x - v.x, t.y - v.y) > T * 1.5)) engage(s, v, t, d, dt, 1 + (s.mods.sovDmg || 0));
  else moveTo(s, v, v.rx, v.ry, d.speed, dt);
  separate(s, v, s.rt.friendHash, C.separation, 'friend');
}

export function castAbility(s, name) {
  const v = s.sovereign;
  if (!v || !v.alive) return { ok: false, msg: 'The Sovereign cannot act.' };
  if (name === 'nova') {
    const a = SOVEREIGN_ABILITIES.nova;
    if (v.novaCd > 0) return { ok: false, msg: 'Heartflame Nova is recharging.' };
    v.novaCd = Math.max(6, a.cooldown - (s.mods.novaCd || 0));
    const ndmg = a.dmg * (1 + (s.mods.novaDmg || 0));
    s.rt.enemyHash.each(v.x, v.y, a.radius * T, (e) => {
      if (e.stationary) { hurt(s, e, ndmg, 'fire', null); return false; }
      hurt(s, e, ndmg, 'fire', null);
      const dx = e.x - v.x, dy = e.y - v.y, l = Math.hypot(dx, dy) || 1;
      const k = a.knock / (e.scale || 1);
      const nx = e.x + (dx / l) * k, ny = e.y + (dy / l) * k;
      if (nx > 2 && ny > 2 && nx < WORLD - 2 && ny < WORLD - 2 && !s.occ[idx(tileOf(nx), tileOf(ny))]) { e.x = nx; e.y = ny; }
      return false;
    });
    emit(s, { t: 'nova', x: v.x, y: v.y, r: a.radius * T });
    return { ok: true };
  }
  if (name === 'banner') {
    const a = SOVEREIGN_ABILITIES.banner;
    if (v.bannerCd > 0) return { ok: false, msg: 'The Royal Banner is not ready.' };
    v.bannerCd = Math.max(8, a.cooldown - (s.mods.bannerCd || 0));
    s.banners.push({ x: v.x, y: v.y, r: a.radius * T, until: s.time + a.duration + (s.mods.bannerDur || 0), start: s.time });
    emit(s, { t: 'banner', x: v.x, y: v.y });
    return { ok: true };
  }
  return { ok: false };
}
