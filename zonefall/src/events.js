// ============================================================================
// ZONEFALL 3 — world events: the patrol gunship. From day 3 it sweeps the
// island between monuments; if it spots you (or a survivor) it circles and
// strafes with its cannon and rockets. Shoot it down for elite crates.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { spawnProjectile, explode } from './combat.js';
import { Live } from './world/live.js';
import { Sfx } from './audio.js';
import { rand, pick, dist, clamp, angDiff, chance } from './util.js';
import { WORLD } from './world/gen.js';

const HELI_DEF = { name: 'Patrol Gunship', kind: 'vehicle', hp: 2200, speed: 16, r: 3.2, sight: 70, xp: 60, drop: null };

/** co-op guests: a gunship body that just mirrors the host's (no AI here) */
G.makeHeliMirror = (x, z, y) => {
  let root = null; try { root = G.models.makeHeli(); } catch (e) { root = null; }
  if (!root) { root = new THREE.Group(); M.add(root, M.box(8, 2.4, 2.4), M.mat('#3a4038'), 0, 0, 0); root.userData.rotor = M.add(root, M.box(12, 0.1, 0.5), M.mat('#222'), 0, 1.6, 0); }
  root.scale.setScalar(1.1); root.position.set(x, y, z);
  const a = { id: -1, type: 'heli', def: HELI_DEF, kind: 'vehicle', heli: true, x, z, y, ang: 0, r: HELI_DEF.r, hp: HELI_DEF.hp, maxhp: HELI_DEF.hp, team: 'hostile', st: { flinch: 0, aim: false, swing: -1, attack: -1, reload: -1, recoil: 0 }, ai: { route: [] }, cd: 0, dead: false, deadT: 0, bleed: 0, flash: 0, armor: 0.2, helm: 0, speedNow: 0, boss: true,
    rig: { root, height: 3, setHeld() { }, setLook() { }, flash() { }, dispose() { }, update(dt) { const u = root.userData; if (u.rotor) u.rotor.rotation.y += dt * 30; if (u.tail) u.tail.rotation.x += dt * 40; }, muzzleWorld(v) { return v.set(a.x + Math.cos(a.ang) * 4, a.y - 1, a.z + Math.sin(a.ang) * 4); }, handWorld(v) { return this.muzzleWorld(v); } } };
  G.scene.add(root); G.actors.push(a); return a;
};
export function spawnHeli() {
  if (G.actors.some(a => a.heli && !a.dead)) return null;
  let root = null; try { root = G.models.makeHeli(); } catch (e) { root = null; }
  if (!root) { root = new THREE.Group(); M.add(root, M.box(8, 2.4, 2.4), M.mat('#3a4038'), 0, 0, 0); root.userData.rotor = M.add(root, M.box(12, 0.1, 0.5), M.mat('#222'), 0, 1.6, 0); }
  root.scale.setScalar(1.1);
  const ang = rand(0, 6.28); const x = WORLD / 2 + Math.cos(ang) * WORLD * 0.55, z = WORLD / 2 + Math.sin(ang) * WORLD * 0.55;
  const a = {
    id: 90000 + Math.floor(Math.random() * 999), type: 'heli', def: HELI_DEF, kind: 'vehicle', heli: true, x, z, y: 22, ang: ang + Math.PI, r: HELI_DEF.r, hp: HELI_DEF.hp, maxhp: HELI_DEF.hp,
    team: 'hostile', st: { flinch: 0 }, ai: { route: [], wp: null, t: 0, alertT: 0 }, cd: 0, rocketCd: 6, dead: false, deadT: 0, bleed: 0, flash: 0, armor: 0.2, helm: 0, speedNow: 0, life: 300, boss: true,
    rig: {
      root, height: 3, setHeld() { }, setLook() { }, flash() { }, dispose() { },
      update(dt) { const u = root.userData; if (u.rotor) u.rotor.rotation.y += dt * 30; if (u.tail) u.tail.rotation.x += dt * 40; },
      muzzleWorld(v) { return v.set(a.x + Math.cos(a.ang) * 4, a.y - 1, a.z + Math.sin(a.ang) * 4); }, handWorld(v) { return this.muzzleWorld(v); },
    },
  };
  // route over a few monuments then out
  const mons = [...G.monuments].sort(() => Math.random() - 0.5).slice(0, 4);
  a.ai.route = mons.map(m => ({ x: m.x, z: m.z })).concat([{ x: WORLD / 2 - Math.cos(ang) * WORLD * 0.6, z: WORLD / 2 - Math.sin(ang) * WORLD * 0.6, exit: true }]);
  G.scene.add(root); G.actors.push(a);
  G.ui.toast('You hear rotor blades… a patrol gunship is in the air!', 'bad'); if (G.net) G.net.note('A patrol gunship is in the air!', 'bad');
  return a;
}

export function updateHeli(a, dt) {
  if (a.dead) {
    a.deadT += dt; a.y = Math.max(G.W.height(a.x, a.z) + 1, a.y - dt * 9); a.rig.root.rotation.z += dt * 2; a.rig.root.rotation.y += dt * 3;
    if (G.fx && Math.random() < 0.5) G.fx.fire(a.x, a.y + 1, a.z, 1.4);
    if (!a.crashed && a.y <= G.W.height(a.x, a.z) + 1.05) crash(a);
    return;
  }
  a.life -= dt; a.cd -= dt; a.rocketCd -= dt; a.ai.alertT = Math.max(0, a.ai.alertT - dt);
  // find a target: the player or a survivor in the open nearby
  let tgt = null, bd = HELI_DEF.sight ** 2;
  const consider = o => { if (!o || o.dead || o.inSafe) return; const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d < bd && !(G.build && G.build.isInside(o.x, o.z))) { bd = d; tgt = o; } };
  consider(G.player); for (const o of G.actors) if (o.bot) consider(o);
  if (tgt) { a.ai.target = tgt; a.ai.lastT = G.t; }
  else if (a.ai.target && G.t - (a.ai.lastT || 0) > 12) a.ai.target = null;
  const T = a.ai.target;
  let gx, gz, speed = HELI_DEF.speed;
  if (T && !T.dead) { // circle the target
    a.ai.orbit = (a.ai.orbit || 0) + dt * 0.35; const R = 18;
    gx = T.x + Math.cos(a.ai.orbit) * R; gz = T.z + Math.sin(a.ai.orbit) * R; speed = 11;
  } else {
    if (!a.ai.wp) a.ai.wp = a.ai.route.shift();
    if (!a.ai.wp || a.life < 0) { a.ai.wp = { x: a.x + Math.cos(a.ang) * 600, z: a.z + Math.sin(a.ang) * 600, exit: true }; }
    gx = a.ai.wp.x; gz = a.ai.wp.z;
    if (dist(a.x, a.z, gx, gz) < 15) { if (a.ai.wp.exit) { remove(a); return; } a.ai.wp = null; }
  }
  const want = Math.atan2(gz - a.z, gx - a.x);
  const face = T && !T.dead ? Math.atan2(T.z - a.z, T.x - a.x) : want;
  a.ang += clamp(angDiff(a.ang, face), -dt * 1.6, dt * 1.6);
  a.x += Math.cos(want) * speed * dt; a.z += Math.sin(want) * speed * dt;
  a.y += ((G.W.height(a.x, a.z) + 12) - a.y) * Math.min(1, dt);
  a.speedNow = speed;
  a.rig.root.rotation.z = -0.12; // nose down
  if (dist(a.x, a.z, G.player.x, G.player.z) < 160 && Math.random() < dt * 2) Sfx.noise(0.25, 160, 1, 0.12 * Sfx.vol(a.x, a.z, 160), 'lowpass');
  // weapons
  if (T && !T.dead) {
    const d = dist(a.x, a.z, T.x, T.z); const aim = Math.atan2(T.z - a.z, T.x - a.x);
    if (d < 55 && Math.abs(angDiff(a.ang, aim)) < 0.5) {
      if (a.cd <= 0) {
        a.burst = (a.burst || 0) + 1; a.cd = a.burst % 12 === 0 ? 2.2 : 0.11;
        const lead = T.speedNow > 0.5 ? 0.25 : 0; const tx = T.x + Math.cos(T.ang) * T.speedNow * lead, tz = T.z + Math.sin(T.ang) * T.speedNow * lead;
        const ang = Math.atan2(tz - a.z, tx - a.x) + rand(-0.07, 0.07);
        const pd = Math.hypot(tx - a.x, tz - a.z) || 1; const pp = Math.atan2(T.y + 1.0 - (a.y - 1), pd) + (Math.random() - 0.5) * 0.06;
        spawnProjectile({ x: a.x + Math.cos(ang) * 3, z: a.z + Math.sin(ang) * 3, y: a.y - 1, ang, pitch: pp, v3: true, speed: 140, dmg: 11, pen: 0.3, range: 80, owner: a, team: 'hostile', kind: 'bullet' });
        if (G.fx) G.fx.muzzle(a.x + Math.cos(ang) * 3.5, a.y - 1, a.z + Math.sin(ang) * 3.5, ang, 1.2);
        Sfx.shot('rifle', a.x, a.z);
      }
      if (a.rocketCd <= 0 && d > 10) {
        a.rocketCd = rand(5, 8);
        for (const off of [-0.08, 0.08]) spawnProjectile({ x: a.x, z: a.z, y: a.y - 1.5, ang: aim + off, speed: 30, dmg: 60, pen: 0.4, range: 70, owner: a, team: 'hostile', kind: 'rocket' });
        Sfx.shot('rocket', a.x, a.z);
      }
    }
  }
}

function crash(a) {
  a.crashed = true; const gy = G.W.height(a.x, a.z);
  explode(a.x, a.z, { r: 6, dmg: 120, struct: 300 }, a, 'hostile', (a.y ?? G.W.height(a.x, a.z)) + 0.6);
  G.scene.remove(a.rig.root);
  let wreck = null; try { wreck = G.models.makeProp('heli_wreck', {}); } catch (e) { }
  if (wreck) { wreck.position.set(a.x, gy, a.z); wreck.rotation.y = -a.ang; G.scene.add(wreck); }
  G.phys.addCircle(a.x, a.z, 3, { h: 3, kind: 'prop' });
  for (let i = 0; i < 3; i++) { const ang = i * 2.1; Live.addContainer({ type: i === 0 ? 'elite' : 'military', x: a.x + Math.cos(ang) * 4.5, z: a.z + Math.sin(ang) * 4.5, ry: ang }); }
  G.lights.push({ x: a.x, y: gy + 2, z: a.z, color: '#ff8030', intensity: 2.5, range: 14 });
  G.ui.toast('The gunship is down! Loot the wreck.', 'good');
  G.heliWreck = { x: a.x, z: a.z, t: G.t };
  setTimeout(() => { const i = G.actors.indexOf(a); if (i >= 0) G.actors.splice(i, 1); }, 500);
}
function remove(a) { G.scene.remove(a.rig.root); const i = G.actors.indexOf(a); if (i >= 0) G.actors.splice(i, 1); a.removed = true; }
void pick; void chance;
