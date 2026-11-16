// Player soldiers (in squads) and the Ember-Sovereign (rework Stream B).
//
// Squads defend a guard zone around their ordered point (engage.js guardZone): a besieged
// building or a foe inside it moves the working rally point there, and it returns 3 s after
// the last threat. Fighters commit: a target is kept for at least 1 s and let go only beyond
// leash + 1 tile; when it dies the fighter looks for the next foe in the same tick (near
// itself, not near the flag) and otherwise holds for about a second facing the spot before
// walking back with arrival steering. Melee fighters take one of 3-4 slots on a ring around
// their foe (the extras pick another foe) and strike only with a clear line of sight: walls
// stop blows, arrows fly over them. Ranged fighters step forward until a foe is in range,
// then hold. The Sovereign with no order fights within 4 tiles of where it stands; a move
// order overrides that until it arrives.
import { BAL } from '../../data/balance.js';
import { UNITS, SOVEREIGN_ABILITIES } from '../../data/units.js';
import { T, N, tileOf, distToRect, clamp } from '../grid.js';
import { MOVE, stepToward, requestPath, followPath, separate, setFacing, applyImpulse } from './movement.js';
import { losClear } from './pathing.js';
import { hurt, getE, emit } from './common.js';
import { spawnProjectile } from './combat.js';
import { beginSlots, acquire, attackSlot, releaseSlot, hold, holdSecs, trackTarget, guardZone } from './engage.js';

const C = BAL.combat;

function auraAt(s, x, y) {
  for (const b of s.banners) if (Math.hypot(b.x - x, b.y - y) <= b.r) return b;
  return null;
}

/** Formation slot offset: staggered rows of three, 20 units apart (sprites are 12 wide). */
export function slotOffset(slot) {
  const col = slot % 3, row = Math.floor(slot / 3);
  return { x: (col - 1) * 20 + (row % 2) * 10, y: (row - 0.8) * 20 };
}

export function updateUnits(s, dt) {
  // Re-pack formation slots once a second so gaps close after losses.
  if (s.tick % 20 === 0) {
    const counts = new Map();
    for (const u of s.soldiers) { if (!u.alive) continue; const c = counts.get(u.squad) || 0; u.slot = c; counts.set(u.squad, c + 1); }
    s.squads = s.squads.filter((q) => (counts.get(q.id) || 0) > 0 || s.rt.bById.has(q.bId));
  }
  beginSlots(s);
  const sqById = s.rt.sqById || (s.rt.sqById = new Map());
  sqById.clear();
  for (const q of s.squads) {
    sqById.set(q.id, q);
    if (q.targetId) {
      const t = getE(s, q.targetId);
      // Follow a grounded target; a foe on the wing leaves the rally where it is.
      if (t && t.alive) { if (!t.flying) { q.rx = t.x; q.ry = t.y; } } else q.targetId = 0;
    }
    guardZone(s, q);
  }
  for (const u of s.soldiers) if (u.alive) updateSoldier(s, u, sqById.get(u.squad), dt);
  updateSovereign(s, dt);
  // Expire banners.
  for (let i = s.banners.length - 1; i >= 0; i--) if (s.banners[i].until <= s.time) s.banners.splice(i, 1);
}

/** The target died or vanished: hold briefly facing the spot, and look again this tick. */
function lostTarget(u) {
  u.targetId = 0;
  releaseSlot(u);
  hold(u, holdSecs(u));
  u.think = 0;
}

function soldierTarget(s, u, sq, d, cur, cx, cy, leash) {
  const ranged = !!d.ranged;
  // An ordered target comes first; a melee fighter turned away by a full ring takes a foe beside it.
  const st = sq.targetId ? getE(s, sq.targetId) : null;
  if (st && st.alive && (ranged || !st.flying)) {
    if (ranged) return st;
    if (attackSlot(st, u, s, d.range * T + st.r + u.r * 0.5)) return st;
    return acquire(s, u, { x: st.x, y: st.y, radius: C.retarget * T, los: true });
  }
  // Keep the current foe for at least a second, and until it is past leash + 1 tile.
  if (cur && (ranged || !cur.flying)) {
    const far = Math.hypot(cur.x - cx, cur.y - cy) > leash + C.releasePad * T;
    if (!far || (u.tgtT || 0) < C.minTargetHold) return cur;
  }
  if (ranged) {
    // Nearest foe in the zone: shoot it from here or step forward until it is in range.
    const r = leash + Math.hypot(u.x - cx, u.y - cy);
    return acquire(s, u, { radius: r, center: { x: cx, y: cy }, leash, ranged: true });
  }
  return acquire(s, u, { radius: C.aggroRadius * T, center: { x: cx, y: cy }, leash, los: true });
}

function updateSoldier(s, u, sq, dt) {
  const d = UNITS[u.type];
  u.hitT = Math.max(0, u.hitT - dt); u.atkT = Math.max(0, u.atkT - dt); u.cd -= dt;
  if (!sq) return;
  const cx = sq.wx !== undefined ? sq.wx : sq.rx, cy = sq.wy !== undefined ? sq.wy : sq.ry;
  const leash = (d.ranged ? Math.max(C.leash, d.range + 0.5) : C.leash) * T;
  let t = getE(s, u.targetId);
  if (t && !t.alive) t = null;
  if (u.targetId && !t) lostTarget(u);
  if (u.holdT > 0) u.holdT = Math.max(0, u.holdT - dt);
  u.think -= dt;
  if (u.think <= 0) {
    u.think = 0.35;
    const nt = soldierTarget(s, u, sq, d, t, cx, cy, leash);
    if (t && nt !== t) releaseSlot(u);
    t = nt;
    u.targetId = t ? t.id : 0;
  }
  trackTarget(u, t, dt);
  if (t) engage(s, u, t, d, dt, 1 + s.mods.soldierDmg + (d.ranged ? s.mods.rangedDmg || 0 : 0));
  if (!u.targetId) {
    if (u.holdT > 0) { u.path = null; if (u.hfx !== undefined) setFacing(u, u.hfx - u.x, 'target'); }
    else { const off = slotOffset(u.slot); moveTo(s, u, cx + off.x, cy + off.y, d.speed, dt); }
  }
  separate(s, u, s.rt.friendHash, C.separation, 'friend');
}

/** Drop the current target (and its attack slot) without the post-kill hold. */
function dropTarget(u) {
  u.targetId = 0;
  releaseSlot(u);
  if (u.kind === 'sovereign') u.orderTarget = 0;
}

// Shared melee/ranged engagement logic for soldiers, the Sovereign and heroes.
export function engage(s, u, t, d, dt, dmgMult) {
  // Melee cannot reach a foe on the wing; hold position until it lands.
  if (t.flying && !d.ranged) { dropTarget(u); return; }
  const dx = t.x - u.x, dy = t.y - u.y;
  const dist = Math.hypot(dx, dy);
  const reach = d.range * T + t.r + u.r * 0.5;
  let gx = t.x, gy = t.y;
  if (!d.ranged) {
    const slot = attackSlot(t, u, s, reach);
    if (!slot) {
      // Ring full: take another foe close by, or wait for a place.
      const alt = acquire(s, u, { radius: C.retarget * T, los: true, noGuards: u.kind === 'hero', filter: (o) => o !== t });
      if (alt && attackSlot(alt, u, s, d.range * T + alt.r + u.r * 0.5)) { u.targetId = alt.id; if (u.kind === 'sovereign' && u.orderTarget === t.id) u.orderTarget = alt.id; return engage(s, u, alt, d, dt, dmgMult); }
      dropTarget(u);
      return;
    }
    gx = slot.x; gy = slot.y;
  }
  setFacing(u, dx, 'target');
  const inReach = dist <= reach && (d.ranged || losClear(s, u.x, u.y, t.x, t.y, 'friend'));
  if (inReach) {
    u.path = null;
    // Shuffle onto the ring slot between blows, so attackers spread instead of stacking.
    if (!d.ranged && Math.hypot(gx - u.x, gy - u.y) > 10) stepToward(s, u, gx, gy, d.speed * 0.5, dt, 'friend');
    if (u.cd <= 0) strikeAt(s, u, t, d, reach, dmgMult);
    return;
  }
  if (Math.hypot(gx - u.x, gy - u.y) > T * 2.5) {
    // Far away: walk a real path so rivers, trees and walls are routed around.
    moveTo(s, u, gx, gy, d.speed, dt);
  } else {
    const r = stepToward(s, u, gx, gy, d.speed, dt, 'friend');
    if (r === MOVE.BLOCKED && u.stuck > 1.2) { dropTarget(u); u.stuck = 0; u.path = null; }
  }
}

function strikeAt(s, u, t, d, reach, dmgMult) {
  const aura = auraAt(s, u.x, u.y);
  const ab = SOVEREIGN_ABILITIES.banner;
  const mult = dmgMult * (aura ? 1 + ab.dmgBonus : 1);
  u.cd = d.rate * (aura ? 1 - ab.rateBonus : 1);
  u.atkT = 0.18;
  if (d.ranged) {
    spawnProjectile(s, 'arrow', u.x, u.y - 10, t, d.dmg * mult, d.dmgType, d.bonus, 13, 1, u.id);
    emit(s, { t: 'sfx', k: 'bow', x: u.x, y: u.y });
    return;
  }
  hurt(s, t, d.dmg * mult, d.dmgType, d.bonus, u.x, u.y, u);
  emit(s, { t: 'sfx', k: 'clash', x: u.x, y: u.y });
  if (d.cleave) {
    let n = 1;
    s.rt.enemyHash.each(u.x, u.y, reach + T * 0.4, (o) => {
      if (o === t || o.flying || !losClear(s, u.x, u.y, o.x, o.y, 'friend')) return false;
      hurt(s, o, d.dmg * mult * 0.6, d.dmgType, d.bonus, u.x, u.y, u);
      return ++n >= d.cleave;
    });
  }
}

export function moveTo(s, u, x, y, speed, dt) {
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

  // A fresh order (sim.js stamps v.orderT): a move order walks there first and fights on arrival.
  if (v.orderT !== v.ordSeen) { v.ordSeen = v.orderT; v.march = v.orderTarget ? 0 : 1; v.holdT = 0; }

  // Fall back when badly hurt, unless the player just gave a direct order.
  if (!v.retreat && v.hp < v.maxHp * C.retreatHp && s.time - v.orderT > 4 && h) {
    v.retreat = true; dropTarget(v); v.march = 0;
    v.rx = (h.tx + 1.5) * T; v.ry = (h.ty + h.size) * T + 14;
    emit(s, { t: 'toast', text: 'The Sovereign is wounded and falls back to the Hearth!', tone: 'bad', icon: 'crown' });
  }
  if (v.retreat && v.hp > v.maxHp * 0.7) v.retreat = false;

  if (v.orderTarget) {
    const t = getE(s, v.orderTarget);
    if (t && t.alive) { v.rx = t.x; v.ry = t.y; } else v.orderTarget = 0;
  }
  if (v.march) {
    const dd = Math.hypot(v.rx - v.x, v.ry - v.y);
    if (dd < T * 0.5 || (v.stuck > 2 && dd < T * 2)) v.march = 0;
  }
  let t = getE(s, v.targetId);
  if (t && !t.alive) t = null;
  if (v.targetId && !t) { v.targetId = 0; releaseSlot(v); if (!v.march) hold(v, holdSecs(v)); v.think = 0; }
  if (v.holdT > 0) v.holdT = Math.max(0, v.holdT - dt);
  v.think -= dt;
  if (v.think <= 0) {
    v.think = 0.3;
    let nt = null;
    if (v.orderTarget) nt = getE(s, v.orderTarget);
    else if (v.retreat) nt = acquire(s, v, { radius: T * 1.2, los: true });
    else if (!v.march) {
      // Auto-fight within sovAggro tiles of where it stands (its anchor, v.rx/v.ry).
      const leash = C.sovAggro * T;
      const keep = t && (Math.hypot(t.x - v.rx, t.y - v.ry) <= leash + C.releasePad * T || (v.tgtT || 0) < C.minTargetHold);
      nt = keep ? t : acquire(s, v, { radius: leash + Math.hypot(v.x - v.rx, v.y - v.ry), center: { x: v.rx, y: v.ry }, leash, los: true });
    }
    if (t && nt !== t) releaseSlot(v);
    t = nt && nt.alive ? nt : null;
    v.targetId = t ? t.id : 0;
  }
  trackTarget(v, t, dt);
  if (t && !(v.retreat && Math.hypot(t.x - v.x, t.y - v.y) > T * 1.5)) engage(s, v, t, d, dt, 1 + (s.mods.sovDmg || 0));
  if (!v.targetId || (v.retreat && t && Math.hypot(t.x - v.x, t.y - v.y) > T * 1.5)) {
    if (v.holdT > 0 && !v.march && !v.retreat) { v.path = null; if (v.hfx !== undefined) setFacing(v, v.hfx - v.x, 'target'); }
    else moveTo(s, v, v.rx, v.ry, d.speed, dt);
  }
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
      if (e.stationary) { hurt(s, e, ndmg, 'fire', null, undefined, undefined, v); return false; }
      hurt(s, e, ndmg, 'fire', null, undefined, undefined, v);
      // Knockback as an impulse: played out over a few ticks and stopped by solid tiles.
      const dx = e.x - v.x, dy = e.y - v.y, l = Math.hypot(dx, dy) || 1;
      const k = a.knock / (e.scale || 1);
      if (!e.boss) applyImpulse(e, (dx / l) * k, (dy / l) * k);
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
