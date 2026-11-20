// ============================================================================
// ZONEFALL 3 — NPC brains: wildlife (passive / predators), human gunners and
// melee fighters (patrol, alert, engage with strafing, search, return),
// night raiders (flow field to the Tool Cupboard, breach walls, rockets),
// Haven guards, traders.
// ============================================================================
import { G } from './state.js';
import { WEAPONS, THROWN } from './data.js';
import { Build } from './build.js';
import { Nav } from './nav.js';
import { bandHit } from './build.js';
import { canOpen } from './doors.js';
import { moveActor, settleY, airborne } from './actors.js';
import { fireWeapon, hurt, throwItem, damageStruct, meleeStrike } from './combat.js';
import { SOLID } from './physics.js';
import { Sfx } from './audio.js';
import { rand, clamp, angDiff, dist, chance } from './util.js';

const OPAQ = c => c.opaque && !c.off;

function turnTo(a, ang, rate, dt) { const d = angDiff(a.ang, ang); a.ang += clamp(d, -rate * dt, rate * dt); return Math.abs(d); }

/**
 * steer toward a point (ty: its floor height, for targets upstairs / downstairs).
 * Walks straight while the way is clear; otherwise follows a local A* path (nav.js) that uses
 * stairs, ladders and doors it may open. Look-ahead whiskers keep it off walls and corners, and if it
 * makes no progress for a moment it re-plans. Returns the distance left (plus the height gap).
 */
export function steer(a, tx, tz, speed, dt, face = true, ty) {
  if (a.climb) { Nav.climbStep(a, dt); return 9; }
  const ai = a.ai || (a.ai = {}); const N = a.nav || (a.nav = {});
  const ay = a.y ?? 0, d = Math.hypot(tx - a.x, tz - a.z), dy = ty === undefined ? 0 : ty - ay;
  const ret = Math.abs(dy) > 1.2 ? d + Math.abs(dy) : d;
  if (d < 0.05 && Math.abs(dy) <= 1.2) { a.speedNow = 0; return 0; }
  // straight there, or along a path?
  if (!N.lcT || G.t > N.lcT || Math.abs(N.lcx - tx) + Math.abs(N.lcz - tz) > 0.8) { N.lcT = G.t + 0.3; N.lcx = tx; N.lcz = tz; N.lc = Nav.lineClear(a, tx, tz, ty); }
  let wx = tx, wz = tz, pathing = false;
  if (!N.lc || Math.abs(dy) > 1.2 || G.t < (N.forceT || 0)) {
    const w = Nav.follow(a, N, tx, tz, ty ?? ay);
    if (w === 'climb') { Nav.climbStep(a, dt); return ret; }
    if (w) { wx = w.x; wz = w.z; pathing = true; }
  } else if (N.path) N.path = null;
  let dx = wx - a.x, dz = wz - a.z; const dw = Math.hypot(dx, dz) || 1e-6; dx /= dw; dz /= dw; let ang = Math.atan2(dz, dx);
  // whiskers: probe ahead (further when running); if blocked, swing to the clearer side and keep to it (wall following)
  // (each probe is tested at the floor height out there, so a ramp up the stairs is not a wall)
  let ph = ay; const f = c => c.solid && !c.off && bandHit(c, ph) && !(c.kind === 'door' && c.ref && canOpen(c.ref, a));
  const look = Math.min(pathing ? 0.9 : Math.max(0.9, Math.min(1.8, speed * 0.4)), dw + 0.2), rr = a.r * 0.9;
  const probe = (x, z) => { ph = Build.floorY(x, z, ay + 0.05); return ph - ay < 0.95 && !G.phys.overlaps(x, z, rr, f); };
  const free = aa => probe(a.x + Math.cos(aa) * look * 0.5, a.z + Math.sin(aa) * look * 0.5) && probe(a.x + Math.cos(aa) * look, a.z + Math.sin(aa) * look);
  if (!free(ang)) {
    const side = ai.avoid || (ai.avoid = (N.side || (chance(0.5) ? 1 : -1)));
    let found = false;
    for (const off of [0.45, 0.8, 1.2, 1.6, 2.1, 2.6]) {
      for (const sgn of [side, -side]) { const aa = ang + off * sgn; if (free(aa)) { ang = aa; ai.avoid = sgn; found = true; break; } }
      if (found) break;
    }
    if (!found) N.replan = true;
  } else if (ai.avoid && free(ang + 0.35 * ai.avoid) && free(ang - 0.35 * ai.avoid)) ai.avoid = 0;
  if (face) turnTo(a, ang, 8, dt);
  const step = Math.min(dw + (pathing ? 0.3 : 0), speed * dt); const ox = a.x, oz = a.z;
  moveActor(a, Math.cos(ang) * step, Math.sin(ang) * step, dt);
  // stuck: little progress for a moment -> plan a path (and try the other side next time)
  const got = Math.hypot(a.x - ox, a.z - oz);
  if (step > 0.004 && got < step * 0.3) { N.stuckT = (N.stuckT || 0) + dt; a.stuckTotal = (a.stuckTotal || 0) + dt; } else N.stuckT = Math.max(0, (N.stuckT || 0) - dt * 2);
  if (N.stuckT > 0.6) { N.stuckT = 0; N.forceT = G.t + 4; N.replan = true; N.side = -(N.side || 1); ai.avoid = N.side; N.stuckN = (N.stuckN || 0) + 1; if (N.stuckN > 4) { N.stuckN = 0; N.path = null; } }
  return ret;
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
  // floors between storeys block the view; walls only at the heights they stand
  const ay = (a.y ?? 0) + 1.5, ty = (t.y ?? 0) + 1.2;
  if (Math.abs(ty - ay) > 0.8 && (Build.slabBetween(a.x, a.z, ay, t.x, t.z, ty) || Build.floorBetween(a.x, a.z, ay, t.x, t.z, ty))) return false;
  const ylo = Math.min(ay, ty) - 0.2, yhi = Math.max(ay, ty);
  return G.phys.los(a.x, a.z, t.x, t.z, c => OPAQ(c) && (c.yhi === undefined || (c.yhi > ylo && c.ylo < yhi)));
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

/** a noise of radius r at (x, z): only enemies very close by come to look; further off they just glance toward it */
const NEAR_HEAR = 12;
export function hearNoise(a, x, z, r, src) {
  if (a.dead || !a.def || a.def.trader || !a.ai) return;
  const d = Math.hypot(a.x - x, a.z - z); if (d >= r) return;
  if (a.kind === 'animal' && a.def.flee) { alertTo(a, x, z, src); return; } // prey bolts from anything it hears
  if (d < Math.min(r, NEAR_HEAR) || a.def.raider) { alertTo(a, x, z, src); return; }
  if (a.kind !== 'animal' && a.ai.state !== 'engage' && d < r * 0.6) { a.ai.look = Math.atan2(z - a.z, x - a.x); a.ai.t = Math.max(a.ai.t || 0, 3); }
}

// ---------------------------------------------------------------- grenades
/**
 * Get away from a live grenade that lands (or rolls) near you: NPCs, animals and survivors (bots.js calls
 * G.nadeDodge). They notice one they can see, or hear land close by, after a human beat (0.15-0.5 s), shout,
 * and sprint straight away from it (steer() finds a way round walls) until they're past its blast, then wait.
 * Returns true while dodging (the caller skips its usual brain for that frame).
 */
export function nadeDodge(a, dt) {
  if (a.dead || a.heli || a.climb || !a.def || a.def.invuln || a.def.trader || !G.throwns.length && !a.dodge) return false;
  if ((a.ndT = (a.ndT || 0) - dt) <= 0) {
    a.ndT = 0.2; let best = null, bd = 1e9;
    for (const t of G.throwns) {
      const T = t.def; if (!T || !T.dmg || t.fuse <= 0 || t.fuse > 60 || t.stuck) continue; // a dead dud lies there harmless
      if (t.owner === a && t.fuse > 2.2) continue;                                       // just threw it at someone else
      const r = (T.r || 3) + 2, d2 = (t.x - a.x) ** 2 + (t.z - a.z) ** 2;
      if (d2 > r * r || Math.abs(t.y - (a.y ?? 0)) > 3) continue;
      if (!t.rest && !t.roll && Math.hypot(t.vx, t.vz) > 7 && d2 > 9) continue;         // still flying past
      if (d2 > 9 && !G.phys.los(a.x, a.z, t.x, t.z, OPAQ)) continue;                     // can't see it (but hears it land close by)
      if (d2 < bd) { bd = d2; best = t; }
    }
    if (best && (!a.dodge || a.dodge.t !== best)) a.dodge = { t: best, react: rand(0.15, 0.5), shout: a.kind === 'human' && chance(0.7) };
    else if (!best && a.dodge && !G.throwns.includes(a.dodge.t)) a.dodge = null;
  }
  const D = a.dodge; if (!D) return false;
  const t = D.t; if (!G.throwns.includes(t) || t.fuse <= 0) { a.dodge = null; return false; }
  if (D.react > 0) { D.react -= dt; return false; }
  if (D.shout) { D.shout = false; Sfx.voice(a.x, a.z); if (G.ui && G.ui.say && (a.x - (G.player ? G.player.x : 1e9)) ** 2 + (a.z - (G.player ? G.player.z : 1e9)) ** 2 < 40 * 40) G.ui.say(a, a.bot ? a.bot.name : a.name || a.def.name, chance(0.5) ? 'Grenade!' : 'Get down!'); }
  const safe = (t.def.r || 3) + 2.5, d = Math.hypot(a.x - t.x, a.z - t.z);
  if (d > safe) { a.speedNow = 0; a.st.aim = false; return true; } // far enough: wait for it
  let ang = d > 0.05 ? Math.atan2(a.z - t.z, a.x - t.x) : a.ang + Math.PI;
  a.st.aim = false; a.st.flinch = Math.max(a.st.flinch || 0, 0.2);
  steer(a, a.x + Math.cos(ang) * 7, a.z + Math.sin(ang) * 7, (a.def.speed || 3.6) * 1.35, dt);
  return true;
}
G.nadeDodge = nadeDodge; // survivors (bots.js)

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
  if (a.climb) { Nav.climbStep(a, dt); return; } // halfway up a ladder: finish the climb first
  if (!d.guard && nadeDodge(a, dt)) { settleY(a, dt); return; } // a live grenade close by: run
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
  if (pd > reach * 0.9 || Math.abs((P.y ?? a.y) - a.y) > 1.5) steer(a, P.x, P.z, speed, dt, true, P.y);
  else { a.speedNow = 0; turnTo(a, Math.atan2(P.z - a.z, P.x - a.x), 10, dt); }
  if (pd < reach + 0.2 && a.cd <= 0 && a.st.attack < 0) {
    a.st.attack = 0; a.cd = 1 / d.melee.rate;
    a.onStrike = () => { if (!P.dead && dist(a.x, a.z, P.x, P.z) < reach + 0.5 && Math.abs((P.y ?? a.y) - a.y) < 1.6 && !airborne(P)) { hurt(P, d.melee.dmg, { owner: a, bleed: d.melee.bleed, dir: Math.atan2(P.z - a.z, P.x - a.x), kind: 'melee' }); Sfx.hit(P.x, P.z); } };
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
  a.meds = a.boss ? 3 : a.def.look === 'scav' ? (chance(0.5) ? 1 : 0) : chance(0.75) ? (chance(0.4) ? 2 : 1) : 0; // bandages, like a player's
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
/** shout to nearby friends: everyone in earshot now knows where you are */
function callout(a, x, z) {
  if ((a.ai.callT || 0) > G.t) return; a.ai.callT = G.t + 6;
  for (const o of G.actors) {
    if (o === a || o.dead || o.removed || o.team !== a.team || o.kind !== 'human' || !o.ai || o.def.raider || o.def.guard || o.def.trader) continue;
    if ((o.x - a.x) ** 2 + (o.z - a.z) ** 2 > 10 * 10 || o.ai.state === 'engage') continue; // only friends right beside you join in
    o.ai.state = 'alert'; o.ai.lastSeen = { x, z, t: G.t }; o.ai.alertT = 6; o.ai.pause = rand(0.15, 0.5); o.ai.searchN = 0; o.ai.thenReturn = false;
  }
  if (chance(0.7)) Sfx.voice(a.x, a.z);
}
function engagedMates(a, r = 28) { let n = 0; for (const o of G.actors) if (o !== a && !o.dead && o.team === a.team && o.ai && o.ai.state === 'engage' && (o.x - a.x) ** 2 + (o.z - a.z) ** 2 < r * r) n++; return n; }
function humanAI(a, dt) {
  const d = a.def, P = (a.def.raider ? G.player : pickTarget(a)) || G.player, ai = a.ai; setupGun(a);
  const spd = d.speed * (a.slowT > 0 ? 0.5 : 1);
  // ---- player-like habits: notice being hit, patch yourself up between fights
  if (a.lastHp !== undefined && a.hp < a.lastHp - 0.5) a.hitT = G.t; a.lastHp = a.hp;
  if (a.healT > 0) {
    a.healT -= dt; a.speedNow = 0; a.st.aim = false; a.st.use = clamp(1 - a.healT / 2.4, 0, 0.99);
    if (G.t - (a.hitT || -9) < 0.15) { a.healT = 0; a.st.use = -1; }           // shot while bandaging: give up and fight
    else if (a.healT <= 0) { a.hp = Math.min(a.maxhp, a.hp + a.maxhp * 0.45); a.meds--; a.st.use = -1; a.lastHp = a.hp; if (chance(0.4)) Sfx.voice(a.x, a.z); }
    return;
  }
  const sees = P && !P.dead && canSee(a, P);
  if (sees) { ai.lastSeen = { x: P.x, z: P.z, y: P.y, t: G.t }; if (ai.state !== 'engage') { callout(a, P.x, P.z); ai.state = 'engage'; ai.react = rand(0.35, 0.8); a.aimK = Math.min(a.aimK || 0, 0.15); ai.cover = null; if (chance(0.5)) Sfx.voice(a.x, a.z); /* call friends */ for (const o of G.actors) if (o !== a && !o.dead && o.team === a.team && o.kind !== 'animal' && dist(o.x, o.z, a.x, a.z) < 8) alertTo(o, P.x, P.z, P); } }
  switch (ai.state) {
    case 'engage': {
      if (!P || P.dead) { ai.state = 'return'; break; }
      if (!sees && !ai.lastSeen) { ai.state = 'return'; break; }
      if (!sees) { if (G.t - (ai.lastSeen ? ai.lastSeen.t : 0) > 2.5) { ai.state = 'search'; ai.t = 10; } }
      const tx = sees ? P.x : ai.lastSeen.x, tz = sees ? P.z : ai.lastSeen.z, ty = sees ? P.y : ai.lastSeen.y; const pd = dist(a.x, a.z, tx, tz); const ang = Math.atan2(tz - a.z, tx - a.x);
      const upDown = ty !== undefined && Math.abs(ty - a.y) > 1.5; // on another floor: find the way up / down first
      if (d.melee) { // melee humans / lurkers
        const reach = d.melee.reach + P.r;
        if (pd > reach * 0.9 || upDown) steer(a, tx, tz, spd * (d.stealth ? 1 : 1.05), dt, true, ty); else { a.speedNow = 0; turnTo(a, ang, 10, dt); }
        if (sees && !upDown && pd < reach + 0.2 && a.cd <= 0 && a.st.swing < 0) {
          a.st.swing = 0; a.swingRate = 1.8; a.cd = 1 / d.melee.rate;
          a.onStrike = () => { if (!P.dead && dist(a.x, a.z, P.x, P.z) < reach + 0.5) { hurt(P, d.melee.dmg, { owner: a, bleed: d.melee.bleed, dir: Math.atan2(P.z - a.z, P.x - a.x), kind: 'melee' }); Sfx.hit(P.x, P.z); } };
          if (d.stealth) Sfx.growl(a.x, a.z);
        }
        break;
      }
      const [near, far] = engageRange(a);
      // out of sight (or tucked into cover) and hurt: bandage up, like a player would
      if (a.hp < a.maxhp * 0.55 && a.meds > 0 && (!sees || (ai.cover && a.speedNow < 0.3)) && G.t - (a.hitT || -9) > 1.2 && a.st.reload < 0) { a.healT = 2.4; a.st.use = 0; a.speedNow = 0; break; }
      // badly hurt, nothing to heal with and nobody to back you up: run, regroup, come back later
      if (a.hp < a.maxhp * 0.3 && !a.meds && !ai.retreated && engagedMates(a) === 0 && !a.boss) { ai.retreated = true; ai.state = 'retreat'; ai.t = rand(5, 8); ai.fleeFrom = { x: tx, z: tz }; Sfx.voice(a.x, a.z); break; }
      // top the magazine up while the target is out of sight
      if (!sees && a.st.reload < 0 && a.magSize && a.mag < a.magSize * 0.45) { a.st.reload = 0; Sfx.reload(); }
      a.st.aim = true; trackAim(a, P, sees, dt);
      // reloading or badly hurt: duck behind something first
      const needCover = a.st.reload >= 0 || (a.hp < a.maxhp * 0.4 && !ai.coverUsed);
      if (needCover && !ai.cover && (ai.coverT = (ai.coverT || 0) - dt) <= 0) { ai.coverT = 1.5; ai.cover = findCover(a, { x: tx, z: tz }, 10); if (ai.cover && chance(0.4)) Sfx.voice(a.x, a.z); }
      let off;
      // flanking: with friends in the fight, some swing wide round the target while the others keep it busy
      if (sees && !ai.cover && !ai.flank && (ai.flankCd = (ai.flankCd ?? rand(3, 6)) - dt) <= 0) {
        ai.flankCd = rand(8, 13); const mates = engagedMates(a);
        if (mates >= 2 || (mates >= 1 && a.id % 2 === 0)) {
          const side = a.id % 4 < 2 ? 1 : -1, base = Math.atan2(a.z - tz, a.x - tx) + side * rand(0.9, 1.35), r = clamp(pd, 8, far);
          const fx = tx + Math.cos(base) * r, fz = tz + Math.sin(base) * r;
          if (G.W.walkable(fx, fz) && !G.phys.overlaps(fx, fz, 0.6)) { ai.flank = { x: fx, z: fz, t: G.t }; if (chance(0.5)) Sfx.voice(a.x, a.z); }
        }
      }
      if (ai.flank && !ai.cover) {
        const fd = steer(a, ai.flank.x, ai.flank.z, spd * 1.25, dt, false); off = turnTo(a, ang, 5, dt);
        if (fd < 1.2 || G.t - ai.flank.t > 6.5) ai.flank = null;
      } else if (ai.cover) {
        const cd = steer(a, ai.cover.x, ai.cover.z, spd, dt, false); off = turnTo(a, ang, 5, dt);
        if (cd < 0.7) { a.speedNow = 0; ai.coverWait = (ai.coverWait ?? rand(0.8, 2.2)) - dt; }
        if ((a.st.reload < 0 && (ai.coverWait ?? 1) <= 0) || G.t - ai.cover.t > 9) { ai.cover = null; ai.coverWait = undefined; if (a.hp < a.maxhp * 0.4) ai.coverUsed = true; }
      } else {
        // rhythm: reposition for a moment, then plant and shoot
        if ((ai.phaseT = (ai.phaseT || 0) - dt) <= 0) { ai.moving = !ai.moving; ai.phaseT = ai.moving ? rand(0.7, 1.8) : rand(1.0, 2.6); ai.strafe = chance(0.5) ? 1 : -1; }
        let mx = 0, mz = 0;
        const pushing = sees && P.reloadT >= 0 && pd > near * 0.7; // the target is reloading: push in
        // out of sight or on another floor: walk the real way there (round walls, up the stairs) instead of into the wall
        if ((!sees || upDown) && (pd > 2 || upDown)) { steer(a, tx, tz, spd * (sees ? 1 : 1.1), dt, !sees, ty); off = sees ? turnTo(a, ang, 5.5, dt) : Math.abs(angDiff(a.ang, ang)); }
        else if (pd > far || pushing) { mx = Math.cos(ang); mz = Math.sin(ang); }
        else if (pd < near) { mx = -Math.cos(ang); mz = -Math.sin(ang); }
        if (ai.moving && sees) { mx += Math.cos(ang + Math.PI / 2) * ai.strafe * 0.75; mz += Math.sin(ang + Math.PI / 2) * ai.strafe * 0.75; }
        const ml = Math.hypot(mx, mz);
        if (off !== undefined) { /* moved by steer */ }
        else if (ml > 0.01) {
          const sp = (pd > far ? spd * (sees ? 1 : 1.15) : pushing ? spd * 0.95 : spd * (ai.moving ? 0.62 : 0.3)) * dt; const ox = a.x, oz = a.z;
          const bump = moveActor(a, mx / ml * sp, mz / ml * sp, dt);
          if (bump && Math.hypot(a.x - ox, a.z - oz) < sp * 0.3) ai.strafe *= -1;
        } else a.speedNow = 0;
        if (off === undefined) off = turnTo(a, ang, 5.5, dt);
      }
      // shooting
      if (a.st.reload >= 0) break;
      if (a.mag <= 0) { a.st.reload = 0; Sfx.reload(); break; }
      ai.react -= dt;
      if (sees && ai.react <= 0 && off < 0.2 && a.cd <= 0 && pd < WEAPONS[a.gun.id].range * 0.95 && !(ai.cover && a.speedNow > 0.5) && !(ai.flank && a.speedNow > 2.5 && chance(0.85))) {
        const W = WEAPONS[a.gun.id];
        if (ai.moving && pd < far && chance(0.45)) { a.cd = rand(0.15, 0.35); break; } // hard to shoot well on the move
        const e = aimError(a, P, (1 - (d.acc || 0.6)) * 0.66);
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
      const r = steer(a, tgt.x, tgt.z, spd * (ai.state === 'search' ? 0.72 : 0.6), dt, true, tgt.y);
      if (r < 1.3 || ai.t <= 0) {
        ai.searchN = (ai.searchN || 0) + 1; ai.heard = null; ai.lookBase = a.ang; ai.pause = rand(1.4, 3.0);
        if (ai.t > 0 && ai.searchN < 4) {
          let x = tgt.x + rand(-9, 9), z = tgt.z + rand(-9, 9); if (!G.W.walkable(x, z)) { x = tgt.x; z = tgt.z; }
          ai.lastSeen = { x, z, y: Build.floorY(x, z, (tgt.y ?? a.y) + 0.3), t: G.t }; ai.state = 'search';
        } else ai.thenReturn = true; // one last look around, then back to post
      }
      break;
    }
    case 'retreat': { // sprint away from the fight, then circle back and hunt
      a.st.aim = false; const f = ai.fleeFrom || ai.home; const ang = Math.atan2(a.z - f.z, a.x - f.x) + Math.sin(G.t * 0.7 + a.id) * 0.5;
      steer(a, a.x + Math.cos(ang) * 6, a.z + Math.sin(ang) * 6, spd * 1.2, dt);
      if (ai.t <= 0) { ai.state = 'search'; ai.t = 10; ai.searchN = 1; }
      break;
    }
    case 'return': {
      a.st.aim = false;
      if (steer(a, ai.home.x, ai.home.z, spd * 0.6, dt, true, ai.home.y) < 1.5) ai.state = 'idle';
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
  const tc = Build.tc;
  if (tc && Math.abs(tc.y - a.y) > 1.2 && dist(a.x, a.z, tc.x, tc.z) < 9) { steer(a, tc.x, tc.z, spd, dt, true, tc.y); } // the cupboard is upstairs: find the stairs / ladder
  else { const ah = Build.ffAhead(a.x, a.z, 7); if (ah) steer(a, ah.x, ah.z, spd, dt); else steer(a, a.x + step.dx * 2, a.z + step.dz * 2, spd, dt); }
  // reached the cupboard: hit it
  if (tc && dist(a.x, a.z, tc.x, tc.z) < 1.6 + a.r && Math.abs(tc.y - a.y) < 1.2) {
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
