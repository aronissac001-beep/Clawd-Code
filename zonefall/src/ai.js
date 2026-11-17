// ============================================================================
// ZONEFALL 3 — NPC brains: wildlife (passive / predators), human gunners and
// melee fighters (patrol, alert, engage with strafing, search, return),
// night raiders (flow field to the Tool Cupboard, breach walls, rockets),
// Haven guards, traders.
// ============================================================================
import { G } from './state.js';
import { WEAPONS, THROWN } from './data.js';
import { Build } from './build.js';
import { moveActor, settleY, airborne } from './actors.js';
import { fireWeapon, hurt, throwItem, damageStruct, meleeStrike } from './combat.js';
import { SOLID } from './physics.js';
import { Sfx } from './audio.js';
import { rand, clamp, angDiff, dist, chance } from './util.js';

const OPAQ = c => c.opaque && !c.off;

function turnTo(a, ang, rate, dt) { const d = angDiff(a.ang, ang); a.ang += clamp(d, -rate * dt, rate * dt); return Math.abs(d); }

/** steer toward a point with simple obstacle avoidance */
export function steer(a, tx, tz, speed, dt, face = true) {
  let dx = tx - a.x, dz = tz - a.z; const d = Math.hypot(dx, dz); if (d < 0.05) { a.speedNow = 0; return 0; }
  dx /= d; dz /= d; let ang = Math.atan2(dz, dx);
  // feelers
  const look = Math.min(1.2, d);
  if (G.phys.overlaps(a.x + dx * look, a.z + dz * look, a.r * 0.9, c => SOLID(c) && c.kind !== 'door')) {
    const side = a.ai.avoid || (a.ai.avoid = chance(0.5) ? 1 : -1);
    let found = false;
    for (const off of [0.5, 0.9, 1.3, 1.8, 2.4]) {
      for (const sgn of [side, -side]) {
        const aa = ang + off * sgn; const fx = Math.cos(aa), fz = Math.sin(aa);
        if (!G.phys.overlaps(a.x + fx * look, a.z + fz * look, a.r * 0.9, c => SOLID(c) && c.kind !== 'door')) { ang = aa; a.ai.avoid = sgn; found = true; break; }
      }
      if (found) break;
    }
  } else a.ai.avoid = 0;
  if (face) turnTo(a, ang, 8, dt);
  const step = Math.min(d, speed * dt);
  moveActor(a, Math.cos(ang) * step, Math.sin(ang) * step, dt);
  return d;
}

function lightAt(x, z) {
  // is the spot lit? (day, or near a light source)
  if (G.night < 0.5) return true;
  for (const l of G.lightSources || []) if (l.intensity > 0.4 && (l.x - x) ** 2 + (l.z - z) ** 2 < (l.range * 0.6) ** 2) return true;
  return false;
}
export function canSee(a, t, rangeMul = 1) {
  if (!t || t.dead) return false;
  if (!a.heli && airborne(t)) return false; // a pilot in the air is out of reach of anything on the ground
  let range = a.def.sight * rangeMul;
  if (t === G.player) {
    if (G.player.hidden) return false;
    if (G.player.crouch) range *= 0.62;
    if (G.night > 0.5 && !lightAt(t.x, t.z) && !G.player.lightOn) range *= 0.5;
    if (G.player.inSafe && a.team !== 'haven') return false;
  }
  const dx = t.x - a.x, dz = t.z - a.z; const d2 = dx * dx + dz * dz;
  if (d2 > range * range) return false;
  if (d2 > 25 && Math.abs(angDiff(a.ang, Math.atan2(dz, dx))) > 2.0 && !a.ai.alertT) return false;
  return G.phys.los(a.x, a.z, t.x, t.z, OPAQ);
}

// ---------------------------------------------------------------- human-like aim
// Aim "settles" while a shooter keeps a visible target (aimK 0 -> 1); it wobbles while either
// side moves, after being hit, at night, and errors cluster near the target (not uniform).
export function trackAim(a, t, sees, dt) {
  if (sees) a.aimK = Math.min(1, (a.aimK || 0) + dt * (a.speedNow > 2 ? 0.28 : 0.6));
  else a.aimK = Math.max(0, (a.aimK || 0) - dt * 0.7);
}
const bell = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // -1..1, peaked at 0
export function aimError(a, t, base) {
  const k = a.aimK || 0;
  const selfMove = Math.min(1, (a.speedNow || 0) / 4), tgtMove = Math.min(1.5, (t.speedNow || 0) / 4);
  let e = base * (1.6 - k * 0.8) * (1 + selfMove * 0.35) * (1 + tgtMove * 0.3) * (1 + (a.st.flinch || 0) * 1.2);
  if (G.night > 0.5) e *= 1.3;
  return { yaw: bell() * e, pitch: bell() * e * 0.7 };
}
/** a spot behind something solid, away from `from` (within maxD), or null */
export function findCover(a, from, maxD = 10) {
  let best = null, bs = 1e9;
  G.phys.query(a.x - maxD, a.z - maxD, a.x + maxD, a.z + maxD, c => {
    if (!c.opaque || c.off || c.kind === 'door' || (c.h || 3) < 1.1) return;
    let cx, cz, r;
    if (c.t === 'c') { cx = c.x; cz = c.z; r = c.r; } else { cx = (c.x0 + c.x1) / 2; cz = (c.z0 + c.z1) / 2; r = Math.min(c.x1 - c.x0, c.z1 - c.z0) / 2; if (Math.max(c.x1 - c.x0, c.z1 - c.z0) > 14) return; }
    if (r < 0.3) return;
    const fx = cx - from.x, fz = cz - from.z, fl = Math.hypot(fx, fz) || 1;
    const px = cx + fx / fl * (r + 0.75), pz = cz + fz / fl * (r + 0.75);
    if (!G.W.walkable(px, pz) || G.phys.overlaps(px, pz, 0.35)) return;
    const dSelf = Math.hypot(px - a.x, pz - a.z); if (dSelf > maxD) return;
    if (Math.hypot(px - from.x, pz - from.z) < 5) return;
    const sc = dSelf + (Math.hypot(px - from.x, pz - from.z) < Math.hypot(a.x - from.x, a.z - from.z) ? 4 : 0);
    if (sc < bs) { bs = sc; best = { x: px, z: pz, t: G.t }; }
  });
  return best;
}

export function alertTo(a, x, z, src) {
  if (a.dead || a.def.trader) return;
  if (a.kind === 'animal' && a.def.flee) { a.ai.state = 'flee'; a.ai.fleeFrom = { x, z }; a.ai.t = rand(4, 7); return; }
  a.ai.alertT = 6; a.ai.lastSeen = { x, z, t: G.t };
  if (src && src !== a && (src === G.player || src.team === 'player') && a.ai.state !== 'engage') { if (a.ai.state !== 'alert') { a.ai.pause = rand(0.5, 1.2); a.ai.searchN = 0; a.ai.thenReturn = false; } a.ai.state = 'alert'; a.ai.t = 10; a.ai.heard = { x, z }; }
}

// ---------------------------------------------------------------- main
export function updateAI(a, dt) {
  if (a.dead) return;
  a.cd -= dt; a.ai.t -= dt; if (a.ai.alertT) a.ai.alertT = Math.max(0, a.ai.alertT - dt);
  if (a.slowT > 0) a.slowT -= dt;
  if (a.st.swing >= 0) { a.st.swing += dt * (a.swingRate || 1.6); if (a.st.swing >= 0.45 && !a.struck) { a.struck = true; a.onStrike && a.onStrike(); } if (a.st.swing >= 1) { a.st.swing = -1; a.struck = false; } }
  if (a.st.attack >= 0) { a.st.attack += dt * 2.2; if (a.st.attack >= 0.45 && !a.struck) { a.struck = true; a.onStrike && a.onStrike(); } if (a.st.attack >= 1) { a.st.attack = -1; a.struck = false; } }
  if (a.st.reload >= 0) { a.st.reload += dt / (a.reloadTime || 2); if (a.st.reload >= 1) { a.st.reload = -1; a.mag = a.magSize; } }
  if (a.st.recoil > 0) a.st.recoil = Math.max(0, a.st.recoil - dt * 6);
  if (a.st.flinch > 0) a.st.flinch = Math.max(0, a.st.flinch - dt * 4);
  if (a.st.throw >= 0) { a.st.throw += dt * 2.5; if (a.st.throw >= 1) a.st.throw = -1; }
  const d = a.def;
  if (d.trader) { const P = G.player; if (P && dist(a.x, a.z, P.x, P.z) < 8) turnTo(a, Math.atan2(P.z - a.z, P.x - a.x), 3, dt); a.speedNow = 0; settleY(a, dt); return; }
  if (a.kind === 'animal') animalAI(a, dt);
  else if (d.raider) raiderAI(a, dt);
  else if (d.guard) guardAI(a, dt);
  else humanAI(a, dt);
  settleY(a, dt);
  // radiation does not bother NPCs; bleeding does
  if (a.bleed > 0) { a.bleed -= dt; if (chance(dt * 1.5)) hurt(a, 1.5, { kind: 'bleed' }); }
}

/** nearest player-or-survivor to hunt (re-evaluated every second) */
function pickTarget(a) {
  const cur = a.ai.target;
  if (cur && !cur.dead && !cur.removed && G.t - (a.ai.tgtT || 0) < 1.2) return cur;
  a.ai.tgtT = G.t;
  let best = G.player && !G.player.dead && !airborne(G.player) ? G.player : null; let bd = best ? (best.x - a.x) ** 2 + (best.z - a.z) ** 2 : 1e12;
  const lim = (a.def.sight * 1.3) ** 2;
  for (const o of G.actors) if ((o.bot || o.remote !== undefined) && !o.dead && !o.removed && !airborne(o)) { const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d < bd && d < lim) { bd = d; best = o; } }
  a.ai.target = best; return best;
}

// ---------------------------------------------------------------- wildlife
function animalAI(a, dt) {
  const d = a.def, P = pickTarget(a) || G.player, ai = a.ai;
  const spd = d.speed * (a.slowT > 0 ? 0.5 : 1);
  if (ai.state === 'flee') {
    const fx = ai.fleeFrom ? ai.fleeFrom.x : P.x, fz = ai.fleeFrom ? ai.fleeFrom.z : P.z;
    const ang = Math.atan2(a.z - fz, a.x - fx) + Math.sin(G.t + a.id) * 0.4;
    steer(a, a.x + Math.cos(ang) * 6, a.z + Math.sin(ang) * 6, spd, dt);
    if (ai.t <= 0) { ai.state = 'wander'; ai.fleeFrom = null; }
    return;
  }
  if (d.flee) {
    const pd = P && !P.dead ? dist(a.x, a.z, P.x, P.z) : 99;
    if (pd < (P && P.speedNow > 4.8 ? d.sight : d.sight * 0.55) && canSee(a, P)) { ai.state = 'flee'; ai.fleeFrom = null; ai.t = rand(3, 6); if (a.type === 'chicken') Sfx.cluck(a.x, a.z); return; }
    wander(a, dt, spd * 0.3); return;
  }
  // predators
  const sightMul = G.night > 0.5 && a.type === 'wolf' ? 1.15 : 1;
  if (ai.state !== 'chase') {
    if (P && !P.dead && (canSee(a, P, sightMul) || (ai.alertT > 0 && dist(a.x, a.z, P.x, P.z) < d.sight * 1.5))) {
      ai.state = 'chase'; ai.t = 12;
      if (a.type === 'wolf') { Sfx.howl(a.x, a.z); for (const o of G.actors) if (o !== a && o.type === 'wolf' && !o.dead && dist(o.x, o.z, a.x, a.z) < 25) { o.ai.state = 'chase'; o.ai.t = 12; } }
      else if (a.type === 'bear') Sfx.roar(a.x, a.z); else Sfx.grunt(a.x, a.z);
    } else { wander(a, dt, spd * 0.28); return; }
  }
  // chase
  if (!P || P.dead || P.inSafe || airborne(P) || ai.t <= 0 || dist(a.x, a.z, P.x, P.z) > d.sight * 2.2) { ai.state = 'wander'; return; }
  if (a.hp < a.maxhp * 0.22 && a.type === 'wolf') { ai.state = 'flee'; ai.t = 6; return; }
  if (canSee(a, P)) ai.t = 10;
  const pd = dist(a.x, a.z, P.x, P.z);
  let speed = spd;
  if (d.charge) { ai.chargeT = (ai.chargeT || 0) - dt; if (pd < 12 && ai.chargeT <= 0) { ai.charging = 1.2; ai.chargeT = 4; } if (ai.charging > 0) { ai.charging -= dt; speed = d.charge; } }
  const reach = d.melee.reach + P.r;
  if (pd > reach * 0.9) steer(a, P.x, P.z, speed, dt);
  else { a.speedNow = 0; turnTo(a, Math.atan2(P.z - a.z, P.x - a.x), 10, dt); }
  if (pd < reach + 0.2 && a.cd <= 0 && a.st.attack < 0) {
    a.st.attack = 0; a.cd = 1 / d.melee.rate;
    a.onStrike = () => { if (!P.dead && dist(a.x, a.z, P.x, P.z) < reach + 0.5 && Math.abs((P.y ?? a.y) - a.y) < 2.2 && !airborne(P)) { hurt(P, d.melee.dmg, { owner: a, bleed: d.melee.bleed, dir: Math.atan2(P.z - a.z, P.x - a.x), kind: 'melee' }); Sfx.hit(P.x, P.z); } };
    if (a.type === 'bear' && chance(0.3)) Sfx.roar(a.x, a.z); else if (a.type === 'wolf') Sfx.growl(a.x, a.z); else if (a.type === 'boar') Sfx.grunt(a.x, a.z);
  }
}
function wander(a, dt, speed) {
  const ai = a.ai;
  if (!ai.wp || ai.t <= 0 || dist(a.x, a.z, ai.wp.x, ai.wp.z) < 0.6) {
    if (chance(0.45)) { ai.wp = null; ai.t = rand(2, 5); }
    else { const ang = rand(0, 6.28), r = rand(3, 12); let x = ai.home.x + Math.cos(ang) * r, z = ai.home.z + Math.sin(ang) * r; if (!G.W.walkable(x, z)) { x = a.x; z = a.z; } ai.wp = { x, z }; ai.t = rand(5, 10); }
  }
  if (ai.wp) steer(a, ai.wp.x, ai.wp.z, speed, dt); else a.speedNow = 0;
}

// ---------------------------------------------------------------- humans
function setupGun(a) {
  if (a.magSize !== undefined || !a.gun) return;
  const W = WEAPONS[a.gun.id]; a.magSize = W.mag; a.mag = W.mag; a.reloadTime = W.reload * 1.2; a.burst = 0;
}
function engageRange(a) {
  if (!a.gun) return [0, 1.2];
  const W = WEAPONS[a.gun.id];
  if (W.pellets) return [3, 9];
  if (W.rocket) return [14, 26];
  if (W.range > 40) return [16, 30];
  if (W.range > 30) return [9, 20];
  return [6, 14];
}
function humanAI(a, dt) {
  const d = a.def, P = (a.def.raider ? G.player : pickTarget(a)) || G.player, ai = a.ai; setupGun(a);
  const spd = d.speed * (a.slowT > 0 ? 0.5 : 1);
  const sees = P && !P.dead && canSee(a, P);
  if (sees) { ai.lastSeen = { x: P.x, z: P.z, t: G.t }; if (ai.state !== 'engage') { ai.state = 'engage'; ai.react = rand(0.35, 0.8); a.aimK = Math.min(a.aimK || 0, 0.15); ai.cover = null; if (chance(0.5)) Sfx.voice(a.x, a.z); /* call friends */ for (const o of G.actors) if (o !== a && !o.dead && o.team === a.team && o.kind !== 'animal' && dist(o.x, o.z, a.x, a.z) < 22) alertTo(o, P.x, P.z, P); } }
  switch (ai.state) {
    case 'engage': {
      if (!P || P.dead) { ai.state = 'return'; break; }
      if (!sees && !ai.lastSeen) { ai.state = 'return'; break; }
      if (!sees) { if (G.t - (ai.lastSeen ? ai.lastSeen.t : 0) > 2.5) { ai.state = 'search'; ai.t = 10; } }
      const tx = sees ? P.x : ai.lastSeen.x, tz = sees ? P.z : ai.lastSeen.z; const pd = dist(a.x, a.z, tx, tz); const ang = Math.atan2(tz - a.z, tx - a.x);
      if (d.melee) { // melee humans / lurkers
        const reach = d.melee.reach + P.r;
        if (pd > reach * 0.9) steer(a, tx, tz, spd * (d.stealth ? 1 : 1.05), dt); else { a.speedNow = 0; turnTo(a, ang, 10, dt); }
        if (sees && pd < reach + 0.2 && a.cd <= 0 && a.st.swing < 0) {
          a.st.swing = 0; a.swingRate = 1.8; a.cd = 1 / d.melee.rate;
          a.onStrike = () => { if (!P.dead && dist(a.x, a.z, P.x, P.z) < reach + 0.5) { hurt(P, d.melee.dmg, { owner: a, bleed: d.melee.bleed, dir: Math.atan2(P.z - a.z, P.x - a.x), kind: 'melee' }); Sfx.hit(P.x, P.z); } };
          if (d.stealth) Sfx.growl(a.x, a.z);
        }
        break;
      }
      const [near, far] = engageRange(a);
      a.st.aim = true; trackAim(a, P, sees, dt);
      // reloading or badly hurt: duck behind something first
      const needCover = a.st.reload >= 0 || (a.hp < a.maxhp * 0.4 && !ai.coverUsed);
      if (needCover && !ai.cover && (ai.coverT = (ai.coverT || 0) - dt) <= 0) { ai.coverT = 1.5; ai.cover = findCover(a, { x: tx, z: tz }, 10); if (ai.cover && chance(0.4)) Sfx.voice(a.x, a.z); }
      let off;
      if (ai.cover) {
        const cd = steer(a, ai.cover.x, ai.cover.z, spd, dt, false); off = turnTo(a, ang, 5, dt);
        if (cd < 0.7) { a.speedNow = 0; ai.coverWait = (ai.coverWait ?? rand(0.8, 2.2)) - dt; }
        if ((a.st.reload < 0 && (ai.coverWait ?? 1) <= 0) || G.t - ai.cover.t > 9) { ai.cover = null; ai.coverWait = undefined; if (a.hp < a.maxhp * 0.4) ai.coverUsed = true; }
      } else {
        // rhythm: reposition for a moment, then plant and shoot
        if ((ai.phaseT = (ai.phaseT || 0) - dt) <= 0) { ai.moving = !ai.moving; ai.phaseT = ai.moving ? rand(0.7, 1.8) : rand(1.0, 2.6); ai.strafe = chance(0.5) ? 1 : -1; }
        let mx = 0, mz = 0;
        if (pd > far || !sees) { mx = Math.cos(ang); mz = Math.sin(ang); }
        else if (pd < near) { mx = -Math.cos(ang); mz = -Math.sin(ang); }
        if (ai.moving && sees) { mx += Math.cos(ang + Math.PI / 2) * ai.strafe * 0.75; mz += Math.sin(ang + Math.PI / 2) * ai.strafe * 0.75; }
        const ml = Math.hypot(mx, mz);
        if (ml > 0.01) {
          const sp = (pd > far ? spd : spd * (ai.moving ? 0.62 : 0.3)) * dt; const ox = a.x, oz = a.z;
          const bump = moveActor(a, mx / ml * sp, mz / ml * sp, dt);
          if (bump && Math.hypot(a.x - ox, a.z - oz) < sp * 0.3) ai.strafe *= -1;
        } else a.speedNow = 0;
        off = turnTo(a, ang, 5.5, dt);
      }
      // shooting
      if (a.st.reload >= 0) break;
      if (a.mag <= 0) { a.st.reload = 0; Sfx.reload(); break; }
      ai.react -= dt;
      if (sees && ai.react <= 0 && off < 0.2 && a.cd <= 0 && pd < WEAPONS[a.gun.id].range * 0.95 && !(ai.cover && a.speedNow > 0.5)) {
        const W = WEAPONS[a.gun.id];
        if (ai.moving && pd < far && chance(0.45)) { a.cd = rand(0.15, 0.35); break; } // hard to shoot well on the move
        const e = aimError(a, P, (1 - (d.acc || 0.6)) * 0.55);
        fireWeapon(a, a.gun.id, a.ang + e.yaw, { spreadMul: 1.1, dmgMul: G.diff ? G.diff.npcDmg : 1, target: P, pitchErr: e.pitch });
        a.mag--; a.cd = 1 / (W.rof * 0.75) + (W.auto ? 0 : rand(0, 0.3));
        if (W.auto) { a.burst++; if (a.burst >= (a.boss ? 8 : 3) + Math.floor(Math.random() * 4)) { a.burst = 0; a.cd = rand(0.45, 1.2); } }
      }
      // grenades at hiding players
      if (!sees && (d.look === 'bandit' || d.look === 'soldier' || a.boss) && ai.lastSeen && pd > 6 && pd < 18 && (ai.nadeT = (ai.nadeT || rand(3, 6)) - dt) <= 0) {
        ai.nadeT = rand(9, 15); a.st.throw = 0; throwItem(a, 'grenade', ai.lastSeen.x + rand(-1.5, 1.5), ai.lastSeen.z + rand(-1.5, 1.5));
      }
      break;
    }
    case 'alert': case 'search': {
      a.st.aim = ai.state === 'search' || !!a.gun;
      // a beat to react ("huh?"), then a sweep of the area on arrival
      if (ai.pause > 0) {
        ai.pause -= dt; a.speedNow = 0;
        if (ai.pause <= 0 && ai.thenReturn) { ai.thenReturn = false; ai.state = 'return'; ai.searchN = 0; if (chance(0.4)) Sfx.voice(a.x, a.z); break; }
        if (ai.heard && ai.state === 'alert') turnTo(a, Math.atan2(ai.heard.z - a.z, ai.heard.x - a.x), 4, dt);
        else { if (ai.lookBase === undefined) ai.lookBase = a.ang; turnTo(a, ai.lookBase + Math.sin(G.t * 1.4 + a.id) * 1.2, 3, dt); }
        break;
      }
      const tgt = ai.lastSeen || ai.home;
      const r = steer(a, tgt.x, tgt.z, spd * (ai.state === 'search' ? 0.72 : 0.6), dt);
      if (r < 1.3 || ai.t <= 0) {
        ai.searchN = (ai.searchN || 0) + 1; ai.heard = null; ai.lookBase = a.ang; ai.pause = rand(1.4, 3.0);
        if (ai.t > 0 && ai.searchN < 4) {
          let x = tgt.x + rand(-9, 9), z = tgt.z + rand(-9, 9); if (!G.W.walkable(x, z)) { x = tgt.x; z = tgt.z; }
          ai.lastSeen = { x, z, t: G.t }; ai.state = 'search';
        } else ai.thenReturn = true; // one last look around, then back to post
      }
      break;
    }
    case 'return': {
      a.st.aim = false;
      if (steer(a, ai.home.x, ai.home.z, spd * 0.6, dt) < 1.5) ai.state = 'idle';
      break;
    }
    default: { // idle / patrol
      a.st.aim = false;
      if (ai.patrol && ai.patrol.length) {
        const wp = ai.patrol[ai.pi % ai.patrol.length];
        if (ai.wait > 0) { ai.wait -= dt; a.speedNow = 0; if (ai.lookBase === undefined) ai.lookBase = a.ang; turnTo(a, ai.lookBase + Math.sin(G.t * 0.9 + a.id) * 1.0, 1.6, dt); }
        else { ai.lookBase = undefined; if (steer(a, wp[0], wp[1], spd * (ai.pace || (ai.pace = rand(0.36, 0.48))), dt) < 0.8) { ai.pi++; ai.wait = chance(0.3) ? rand(4, 9) : rand(1, 3.5); } }
      } else {
        // stand about: glance around, shift weight, now and then stroll a few steps
        if (ai.stroll) { if (steer(a, ai.stroll.x, ai.stroll.z, spd * 0.32, dt) < 0.5 || ai.t <= 0) { ai.stroll = null; ai.t = rand(3, 7); } break; }
        a.speedNow = 0;
        if (ai.t <= 0) {
          if (chance(0.3)) { const ang2 = rand(0, 6.28), rr = rand(1.5, 4); const x = ai.home.x + Math.cos(ang2) * rr, z = ai.home.z + Math.sin(ang2) * rr; if (G.W.walkable(x, z) && !G.phys.overlaps(x, z, 0.4)) { ai.stroll = { x, z }; ai.t = 6; break; } }
          ai.t = rand(2, 6); ai.look = a.ang + rand(-1.5, 1.5);
        }
        if (ai.look !== undefined) turnTo(a, ai.look, 1.2, dt);
        if (dist(a.x, a.z, ai.home.x, ai.home.z) > 6) ai.state = 'return';
      }
    }
  }
}

function guardAI(a, dt) {
  const P = G.player; setupGun(a);
  if (P && !P.dead && P.hostileT > 0 && dist(a.x, a.z, P.x, P.z) < 45 && G.phys.los(a.x, a.z, P.x, P.z, OPAQ)) {
    const ang = Math.atan2(P.z - a.z, P.x - a.x); a.st.aim = true; const off = turnTo(a, ang, 8, dt); a.speedNow = 0;
    if (off < 0.1 && a.cd <= 0) { fireWeapon(a, a.gun.id, a.ang + rand(-0.03, 0.03), { dmgMul: 1.4, target: P }); a.cd = 0.12; }
    return;
  }
  a.st.aim = false; humanIdle(a, dt);
}
function humanIdle(a, dt) {
  const ai = a.ai; a.speedNow = 0;
  if (ai.t <= 0) { ai.t = rand(3, 7); ai.look = a.ang + rand(-1.2, 1.2); }
  if (ai.look !== undefined) turnTo(a, ai.look, 1.5, dt);
}

// ---------------------------------------------------------------- raiders
function raiderAI(a, dt) {
  const d = a.def, P = G.player, ai = a.ai; setupGun(a);
  const spd = d.speed * (a.slowT > 0 ? 0.5 : 1) * (G.raid ? G.raid.speedMul || 1 : 1);
  // fight the player when close and visible
  const pd = P && !P.dead ? dist(a.x, a.z, P.x, P.z) : 999;
  if (P && !P.dead && pd < (a.gun ? 18 : 10) && canSee(a, P)) { ai.state = 'engage'; ai.lastSeen = { x: P.x, z: P.z, t: G.t }; }
  else if (ai.state === 'engage' && (G.t - (ai.lastSeen ? ai.lastSeen.t : 0) > 3 || pd > 26)) ai.state = 'siege';
  if (!Build.tc) { ai.state = P && !P.dead ? 'engage' : 'idle'; if (!P || P.dead) { a.speedNow = 0; return; } if (ai.state === 'engage') { ai.lastSeen = { x: P.x, z: P.z, t: G.t }; } }
  if (ai.state === 'engage') { humanAI(a, dt); return; }
  ai.state = 'siege'; a.st.aim = false;
  // turrets in sight get shot first by gunners
  if (a.gun && !d.rocket) {
    for (const dep of Build.deploys) {
      if (!dep.type.includes('turret') || dep.dead) continue; const dd = dist(a.x, a.z, dep.x, dep.z);
      if (dd < 20 && G.phys.los(a.x, a.z, dep.x, dep.z, c => OPAQ(c) && c.ref !== dep)) {
        const ang = Math.atan2(dep.z - a.z, dep.x - a.x); a.st.aim = true; const off = turnTo(a, ang, 6, dt); a.speedNow = 0;
        if (a.st.reload < 0 && a.mag <= 0) { a.st.reload = 0; }
        else if (a.st.reload < 0 && off < 0.15 && a.cd <= 0) { fireWeapon(a, a.gun.id, a.ang + rand(-0.06, 0.06)); a.mag--; a.cd = 1 / (WEAPONS[a.gun.id].rof * 0.7); damageStruct(dep, WEAPONS[a.gun.id].dmg * 0.5 * (WEAPONS[a.gun.id].pellets || 1), 'raider'); }
        return;
      }
    }
  }
  const step = Build.ffStep(a.x, a.z);
  if (!step) { const tc = Build.tc; steer(a, tc.x, tc.z, spd, dt); return; }
  const blk = step.block;
  // rocketeers fire at the first structure along the path from range
  if (d.rocket && (ai.rocketT = (ai.rocketT ?? rand(2, 4)) - dt) <= 0) {
    const tgt = pathStructure(a, 26);
    if (tgt) { const ang = Math.atan2(tgt.z - a.z, tgt.x - a.x); a.ang = ang; a.st.aim = true; fireWeapon(a, 'rocket_launcher', ang + rand(-0.04, 0.04)); ai.rocketT = rand(6, 9); return; }
    ai.rocketT = 1;
  }
  if (blk) {
    const bx = blk.x ?? (blk.mesh ? blk.mesh.position.x : a.x), bz = blk.z ?? (blk.mesh ? blk.mesh.position.z : a.z);
    const tx = step.tx ?? bx, tz = step.tz ?? bz; const ang = Math.atan2(tz - a.z, tx - a.x);
    turnTo(a, ang, 8, dt);
    const close = dist(a.x, a.z, tx, tz) < 1.3 + a.r;
    if (!close) { steer(a, tx, tz, spd, dt); return; }
    a.speedNow = 0;
    if (d.breach || d.breachBoss) {
      if ((ai.satchelT = (ai.satchelT ?? 0) - dt) <= 0) {
        ai.satchelT = d.breachBoss ? 9 : 14; a.st.throw = 0;
        const t = throwItem(a, 'satchel', tx, tz); if (t) { t.fuse = 3.5; t.dud = false; }
        ai.retreat = 2.2; Sfx.voice(a.x, a.z);
      }
      if (ai.retreat > 0) { ai.retreat -= dt; steer(a, a.x - Math.cos(ang) * 4, a.z - Math.sin(ang) * 4, spd, dt, false); return; }
      if (!d.breachBoss) return;
    }
    if (a.gun && !d.melee) { // shoot the wall
      if (a.st.reload < 0 && a.mag <= 0) { a.st.reload = 0; return; }
      if (a.st.reload < 0 && a.cd <= 0) { a.st.aim = true; fireWeapon(a, a.gun.id, ang); a.mag--; a.cd = 1 / (WEAPONS[a.gun.id].rof * 0.6); damageStruct(blk, WEAPONS[a.gun.id].dmg * 0.6 * (WEAPONS[a.gun.id].pellets ? 3 : 1) * (G.raid ? G.raid.power : 1), 'raider'); }
      return;
    }
    if (a.cd <= 0 && a.st.swing < 0) {
      a.st.swing = 0; a.swingRate = 1.8; a.cd = 1 / (d.melee ? d.melee.rate : 1);
      a.onStrike = () => { if (!blk.dead) { damageStruct(blk, (d.melee ? d.melee.struct : 15) * (G.raid ? G.raid.power : 1), 'raider'); Sfx.thud(tx, tz); if (G.fx) G.fx.impact(tx, a.y + 1, tz, blk.tier === 'stone' ? 'stone' : 'wood', 0, 0); } };
    }
    return;
  }
  // free path: aim a few cells ahead along the field for a smooth, direct walk
  const ah = Build.ffAhead(a.x, a.z, 7);
  if (ah) steer(a, ah.x, ah.z, spd, dt); else steer(a, a.x + step.dx * 2, a.z + step.dz * 2, spd, dt);
  // reached the cupboard: hit it
  const tc = Build.tc;
  if (tc && dist(a.x, a.z, tc.x, tc.z) < 1.6 + a.r) {
    a.speedNow = 0; turnTo(a, Math.atan2(tc.z - a.z, tc.x - a.x), 8, dt);
    if (a.cd <= 0) { a.cd = 0.9; a.st.swing = 0; a.onStrike = () => { damageStruct(tc, 26 * (G.raid ? G.raid.power : 1), 'raider'); Sfx.thud(tc.x, tc.z); }; }
  }
}
function pathStructure(a, maxd) {
  // walk the flow field forward until we hit a structure cell
  let x = a.x, z = a.z;
  for (let i = 0; i < maxd; i++) {
    const s = Build.ffStep(x, z); if (!s) return null;
    if (s.block) { const b = s.block; const bx = s.tx, bz = s.tz; if (dist(a.x, a.z, bx, bz) < 6) return null; if (!G.phys.los(a.x, a.z, bx - Math.sign(bx - a.x) * 0.6, bz - Math.sign(bz - a.z) * 0.6, c => OPAQ(c) && c.ref !== b)) return null; return { x: bx, z: bz, ref: b }; }
    if (!s.dx && !s.dz) return null; x += s.dx; z += s.dz;
  }
  return null;
}
void THROWN; void meleeStrike;
