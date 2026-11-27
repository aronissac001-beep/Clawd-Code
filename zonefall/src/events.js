// ============================================================================
// ZONEFALL — world events (the host runs them; co-op guests mirror them):
//  * the patrol gunship: from day 3 it sweeps the island between monuments; if
//    it spots you (or a survivor) it circles and strafes with its cannon and
//    rockets. Shoot it down for elite crates.
//  * the oil rig's locked crate: hacking it (two minutes) brings a transport
//    helicopter out to the helipad with heavy scientists.
//  * the locked-crate drop: a twin-rotor transport flies to a monument and
//    lowers a locked crate on a line. Hack it while the site's garrison and the
//    heavies it flies in come for you.
//  * the armoured patrol: an APC drives the ring road and shoots anyone it
//    sees with its machine gun and cannon. Blow it up for the crates inside.
// State for the map: G.events.lockedCrate = { x, z, phase, name },
// G.events.convoy = { x, z, ang, phase }, G.events.helis = [{ x, z, ang }].
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { spawnProjectile, explode, fireWeapon, hurt, damageStruct } from './combat.js';
import { Live } from './world/live.js';
import { Build } from './build.js';
import { spawnActor, removeActor, airborne } from './actors.js';
import { Sfx } from './audio.js';
import { CONTAINERS, WEAPONS } from './data.js';
import { HACK_T } from './cargo.js';
import { rand, randi, pick, dist, clamp, angDiff, chance, lerp } from './util.js';
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

// ============================================================================
// shared bits
// ============================================================================
const isGuest = () => !!(G.net && G.net.role === 'guest');
const anchors = () => (G.net && G.net.role === 'host' && G.net.anchors) ? G.net.anchors() : (G.player ? [G.player] : []);
/** distance from (x, z) to the nearest living player (co-op friends too) */
const nearest = (x, z) => { let b = 1e9; for (const a of anchors()) if (a && !a.dead) b = Math.min(b, dist(a.x, a.z, x, z)); return b; };
function say(msg, kind) { if (G.ui) G.ui.toast(msg, kind); if (G.net && G.net.note) G.net.note(msg, kind); }
const evs = () => G.events || (G.events = []);
const r2 = v => Math.round(v * 100) / 100;
function compass(x, z) { const c = WORLD / 2, a = Math.atan2(z - c, x - c), k = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8; return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][k]; }
const E = { helis: [], hid: 0, aid: 0, drop: null, apc: null, wreck: null, rig: {} };

// ============================================================================
// the transport helicopter: a twin-rotor heavy lifter that lowers crates on a line and flies in squads.
// It can't be shot down. Its flight is a pure function of time, so co-op guests replay it from a few numbers.
// ============================================================================
function makeTransport() {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const hull = M.mat('#55604e', { tex: 'metal' }), hull2 = M.mat('#3f483c', { tex: 'metal' }), dark = M.mat('#1e2422'), glass = M.mat('#22323a'), band = M.mat('#c9a43c'), red = M.basic('#ff3a2a'), grn = M.basic('#4aff6a');
  M.add(body, M.box(11, 3.0, 3.1), hull, 0, 0, 0);                                   // cabin (nose toward +x)
  M.add(body, M.box(2.4, 2.5, 2.9), hull, 6.6, -0.15, 0);                           // nose
  M.add(body, M.box(1.3, 1.6, 2.6), hull, 8.3, -0.4, 0);
  M.add(body, M.box(1.0, 1.0, 2.7), glass, 7.7, 0.75, 0, { rz: -0.5 });             // windscreen
  M.add(body, M.box(2.6, 2.9, 2.5), hull2, -5.6, 0.85, 0);                          // rear pylon
  M.add(body, M.box(1.6, 1.3, 1.6), hull2, -6.2, 2.7, 0);
  M.add(body, M.box(2.0, 0.9, 1.4), hull2, 5.3, 1.9, 0);                            // front rotor mast
  for (const s of [-1, 1]) { M.add(body, M.box(6.2, 1.3, 0.9), hull2, -0.2, -1.05, s * 1.95); M.add(body, M.box(6.0, 0.08, 0.92), band, -0.2, -0.35, s * 1.95); } // side pods
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) M.add(body, M.box(0.55, 0.45, 0.05), glass, 3.8 - i * 1.5, 0.55, s * 1.56);
  M.add(body, M.box(2.2, 0.25, 2.9), hull2, -6.7, -1.25, 0, { rz: 0.35 });          // rear ramp
  for (const [x, z] of [[4.6, -1.0], [4.6, 1.0], [-3.6, -2.2], [-3.6, 2.2]]) { M.add(body, M.box(0.12, 0.8, 0.12), dark, x, -1.75, z); M.add(body, M.cyl(0.32, 0.32, 0.26, 10), dark, x, -2.2, z, { rx: Math.PI / 2 }); }
  M.add(body, M.box(0.18, 0.18, 0.18), red, -0.5, -0.2, -2.45); M.add(body, M.box(0.18, 0.18, 0.18), grn, -0.5, -0.2, 2.45);
  const rotor = (x, y) => { const g = new THREE.Group(); g.position.set(x, y, 0); M.add(g, M.cyl(0.35, 0.35, 0.5, 8), dark, 0, 0, 0); for (let k = 0; k < 3; k++) M.add(g, M.box(14.5, 0.07, 0.55), dark, 0, 0.18, 0, { ry: k * Math.PI / 3, cast: false }); body.add(g); return g; };
  root.userData.rotors = [rotor(5.3, 2.55), rotor(-6.2, 3.55)]; root.userData.body = body;
  return root;
}
const TV = 24; // cruise speed (m/s)
class Transport {
  /**
   * p: { id, kind: 'crate' | 'troops', sx, sz (start), hx, hz, hy (hover point), gy (ground under it), ex, ez (exit), cy (cruise height), hov (hover seconds), t }
   * mirror = a co-op guest's copy (no cues: the host does the dropping)
   */
  constructor(p, mirror = false) {
    for (const k of ['id', 'kind', 'sx', 'sz', 'hx', 'hz', 'hy', 'gy', 'ex', 'ez', 'cy', 'hov']) this[k] = p[k];
    this.t = p.t || 0; this.mirror = mirror; this.cues = []; this.done = false; this.sndT = 0; this.tilt = 0;
    this.dA = Math.max(1, Math.hypot(this.hx - this.sx, this.hz - this.sz) / TV); this.dB = Math.max(1, (this.cy - this.hy) / 6); this.dE = Math.max(1, Math.hypot(this.ex - this.hx, this.ez - this.hz) / TV);
    this.T1 = this.dA; this.T2 = this.T1 + this.dB; this.T3 = this.T2 + this.hov; this.T4 = this.T3 + this.dB; this.end = this.T4 + this.dE;
    this.yawIn = Math.atan2(this.hz - this.sz, this.hx - this.sx); this.yawOut = Math.atan2(this.ez - this.hz, this.ex - this.hx);
    this.root = makeTransport(); G.scene.add(this.root);
    if (this.kind === 'crate') {
      let c = null; try { c = G.models && G.models.makeContainer ? G.models.makeContainer('elite') : null; } catch (e) { c = null; }
      if (!c) { c = new THREE.Group(); M.add(c, M.box(1.4, 1.0, 1.0), M.mat('#2a3a4a'), 0, 0.5, 0); }
      this.crate = c; this.rope = M.add(null, M.cyl(0.035, 0.035, 1, 5), M.mat('#2a2622'), 0, 0, 0, { cast: false }); G.scene.add(c, this.rope);
    }
    this.place(0);
  }
  /** where it is at time t (the same on every phone) */
  pose(t) {
    const e = u => u * u * (3 - 2 * u);
    if (t < this.T1) { const u = e(clamp(t / this.dA, 0, 1)); return { x: lerp(this.sx, this.hx, u), y: this.cy, z: lerp(this.sz, this.hz, u), yaw: this.yawIn }; }
    if (t < this.T2) { const u = e((t - this.T1) / this.dB); return { x: this.hx, y: lerp(this.cy, this.hy, u), z: this.hz, yaw: this.yawIn }; }
    if (t < this.T3) return { x: this.hx + Math.sin(t * 0.7) * 0.3, y: this.hy + Math.sin(t * 1.3) * 0.25, z: this.hz + Math.cos(t * 0.5) * 0.3, yaw: this.yawIn + Math.sin(t * 0.4) * 0.04 };
    if (t < this.T4) { const u = e((t - this.T3) / this.dB); return { x: this.hx, y: lerp(this.hy, this.cy, u), z: this.hz, yaw: this.yawIn + angDiff(this.yawIn, this.yawOut) * u }; }
    const u = clamp((t - this.T4) / this.dE, 0, 1), k = u * u; // speeds up as it leaves
    return { x: lerp(this.hx, this.ex, k), y: this.cy + u * 15, z: lerp(this.hz, this.ez, k), yaw: this.yawOut };
  }
  /** the crate's height on its line (it goes down over most of the hover), -1 once it's been let go */
  get touchT() { return this.T2 + this.hov * 0.7; }
  lineY(t) { const h0 = this.T2 + this.hov * 0.08, h1 = this.touchT; if (t < h0) return null; if (t >= h1) return -1; return lerp(this.hy - 2.6, this.gy, clamp((t - h0) / (h1 - h0), 0, 1)); }
  place(dt) {
    const P = this.pose(this.t), R = this.root;
    if (dt > 0) { const sp = Math.hypot(P.x - this.x, P.z - this.z) / dt; this.tilt += (clamp(sp / TV, 0, 1.4) * 0.13 - this.tilt) * Math.min(1, dt * 2); }
    this.x = P.x; this.y = P.y; this.z = P.z; this.yaw = P.yaw;
    R.position.set(P.x, P.y, P.z); R.rotation.set(0, -P.yaw, 0); R.userData.body.rotation.z = -this.tilt;
    if (this.crate) {
      const ly = this.lineY(this.t), belly = P.y - 1.6;
      let cy = ly === null ? P.y - 2.6 : ly; this.crate.visible = ly !== -1;
      if (ly === -1) { const k = clamp((this.t - this.touchT) / Math.max(0.5, this.T3 - this.touchT), 0, 1); cy = lerp(this.gy + 1, belly - 0.2, k); } // the empty line winds back up
      this.crate.position.set(P.x, cy, P.z); this.crate.rotation.y = -P.yaw;
      const top = cy + (ly === -1 ? 0 : 1.0), L = Math.max(0.05, belly - top);
      this.rope.visible = ly !== null && L > 0.3; this.rope.position.set(P.x, top + L / 2, P.z); this.rope.scale.y = L;
    }
  }
  on(at, fn) { this.cues.push({ at, fn, fired: this.t > at }); return this; }
  update(dt) {
    this.t += dt; if (this.t >= this.end) { this.done = true; return; }
    if (!this.mirror) for (const c of this.cues) if (!c.fired && this.t >= c.at) { c.fired = true; try { c.fn(this); } catch (e) { console.warn('event cue', e); } }
    this.place(dt);
    const [r1, r2b] = this.root.userData.rotors; r1.rotation.y += dt * 24; r2b.rotation.y -= dt * 24;
    if ((this.sndT -= dt) <= 0) { this.sndT = 0.12; const v = G.player ? Sfx.vol(this.x, this.z, 420) : 0; if (v > 0.02) Sfx.noise(0.09, 95, 1.4, 0.2 * v, 'lowpass'); }
    // downwash: dust kicked up under it when it's low
    if (G.fx && this.y - this.gy < 9 && this.t > this.T1 && this.t < this.T4 && Math.random() < dt * 10) { const a = Math.random() * 6.283, r = 2 + Math.random() * 5; G.fx.smoke(this.x + Math.cos(a) * r, this.gy + 0.3, this.z + Math.sin(a) * r, '#b8ab90', 0.05); }
  }
  plan() { const o = {}; for (const k of ['id', 'kind', 'sx', 'sz', 'hx', 'hz', 'hy', 'gy', 'ex', 'ez', 'cy', 'hov']) o[k] = typeof this[k] === 'number' && k !== 'id' ? r2(this[k]) : this[k]; o.t = r2(this.t); return o; }
  dispose() { this.root.removeFromParent(); if (this.crate) this.crate.removeFromParent(); if (this.rope) this.rope.removeFromParent(); this.done = true; }
}
/** a transport from out at sea to a hover over (hx, hz) at height hy, hov seconds there, then away across the island */
function callTransport(kind, hx, hz, hy, gy, hov) {
  const c = WORLD / 2, a = Math.atan2(hz - c, hx - c) + rand(-0.5, 0.5);
  const sx = clamp(hx + Math.cos(a) * 640, 10, WORLD - 10), sz = clamp(hz + Math.sin(a) * 640, 10, WORLD - 10);
  const b = a + Math.PI + rand(-0.6, 0.6), ex = hx + Math.cos(b) * 700, ez = hz + Math.sin(b) * 700;
  const T = new Transport({ id: ++E.hid, kind, sx, sz, hx, hz, hy, gy, ex, ez, cy: Math.max(hy + 18, gy + 45, 50), hov, t: 0 });
  E.helis.push(T); return T;
}
/** a heavy scientist dropped off by a transport: straight to the crate, and they hold it */
function spawnTroop(kind, x, z, y, at, tag) {
  const a = spawnActor(kind, x, z); a.y = y; a.evTroop = tag; a.roamer = true;
  a.ai.home = { x: at.x, z: at.z, y: at.y }; a.ai.state = 'alert'; a.ai.lastSeen = { x: at.x, z: at.z, y: at.y, t: G.t }; a.ai.t = 60; a.ai.alertT = 40;
  return a;
}
/** open ground near (x, z) for a squad to land on, 22-38 m out (clear = room to hover low) */
function troopSpot(x, z, y) {
  for (let k = 0; k < 50; k++) {
    const a = rand(0, 6.283), r = rand(22, 38), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (!G.W.walkable(px, pz) || G.W.isWater(px, pz)) continue;
    const gy = G.W.height(px, pz), fy = Build.floorY(px, pz); if (fy - gy > 0.35 || Live.floorAt(px, pz) !== null || Math.abs(fy - y) > 8) continue;
    if (G.phys.overlaps(px, pz, 1.2)) continue;
    const clear = !G.phys.overlaps(px, pz, 9.5, c => c.solid && !c.off && ((c.y0 ?? gy) + (c.h || 3)) > gy + 2.5); // room for the rotors to come down low
    return { x: px, z: pz, y: fy, clear };
  }
  return { x, z, y, clear: false };
}
function groundNear(x, z, fx, fz) { if (G.W.walkable(x, z) && !G.W.isWater(x, z) && !G.phys.overlaps(x, z, 0.5)) return { x, z, y: Build.floorY(x, z) }; return { x: fx, z: fz, y: Build.floorY(fx, fz) }; }

// ============================================================================
// the oil rig: its locked crate (hack -> heavies fly in to the helipad), the flare, steel ladders, strays
// ============================================================================
const RIG_RELOCK = 1500; // the crate is restocked and locked again this long after it was opened (when nobody's there)
function rigMon() { if (E.rigW !== G.W) { E.rigW = G.W; E.rigM = G.monuments.find(m => m.type === 'oilrig') || null; } return E.rigM; }
/** the rig's locked crate (a co-op guest's containers are replaced by the host's when it joins: find it again) */
function rigCrate(m) {
  const c = m.lockedCrate; if (c && G.t < (E.rigCT || 0)) return c;
  E.rigCT = G.t + 2; if (c && G.containers.includes(c)) return c;
  return (m.lockedCrate = G.containers.find(q => q.type === 'locked_crate' && (q.x - m.x) ** 2 + (q.z - m.z) ** 2 < 20 * 20) || null);
}
function steelLadders(m) {
  for (const d of Build.deploys) {
    if (d.type !== 'ladder' || d._steel || d.dead || !d.mesh || d.owner === 'player' || (d.x - m.x) ** 2 + (d.z - m.z) ** 2 > 45 * 45) continue;
    d._steel = true; const mt = M.mat('#6a7078', { tex: 'metal' }); d.mesh.traverse(o => { if (o.isMesh) o.material = mt; });
  }
}
/**
 * The rig's people (garrison and the heavies flown in) find their way home a flight of stairs at a time: on the rig the
 * stairs are out on the deck margins, so home on another level is a long walk the local path search can't see whole.
 * One who followed a swimmer down a leg ladder is put back at their post.
 */
function rigWalkers(m) {
  const F = m.flights; if (!F) return;
  const lv = [F[0].foot.y, ...F.map(f => f.top.y)];
  const deck = y => { let b = -1, bd = 1.3; lv.forEach((h, i) => { if (Math.abs(h - y) < bd) { bd = Math.abs(h - y); b = i; } }); return b; };
  for (const a of G.actors) {
    if (a.dead || a.removed || a.climb || !(a.mon === m || a.evTroop === 'rig') || !a.ai || (a.x - m.x) ** 2 + (a.z - m.z) ** 2 > 60 * 60) continue;
    if (a.y < lv[1] - 1.5 && a.y < lv[0] - 0.5) { const h = a.spawn || a.rigHome || a.ai.home; if (h) { a.x = h.x; a.z = h.z; a.y = h.y ?? lv[1]; a.nav = null; a.rigWay = null; if (a.rigHome) a.ai.home = a.rigHome; a.ai.state = 'return'; } continue; }
    if (a.rigWay) {
      if (a.ai.state === 'engage' || a.ai.state === 'retreat') { a.ai.home = a.rigHome; a.rigWay = null; continue; }
      const w = a.rigWay[0];
      if (dist(a.x, a.z, w.x, w.z) < 1.6 && Math.abs(a.y - w.y) < 1) { a.rigWay.shift(); a.ai.home = a.rigWay.length ? a.rigWay[0] : a.rigHome; if (!a.rigWay.length) a.rigWay = null; }
      a.ai.state = 'return'; continue;
    }
    if (a.ai.state !== 'return' && a.ai.state !== 'idle') continue;
    const hy = a.ai.home.y ?? (a.spawn ? a.spawn.y : undefined); if (hy === undefined) continue;
    const from = deck(a.y), to = deck(hy); if (from < 0 || to < 0 || from === to) continue;
    const way = []; for (let k = from; k < to; k++) way.push(F[k].foot, F[k].top); for (let k = from; k > to; k--) way.push(F[k - 1].top, F[k - 1].foot);
    a.rigHome = a.ai.home; a.rigWay = way; a.ai.home = way[0]; a.ai.state = 'return';
  }
}
const Rig = {
  startHack(c, by) {
    const m = rigMon(); if (!m || !c.locked || c.hackEnd) return;
    c.hackEnd = G.t + HACK_T; Sfx.card && Sfx.card();
    say('Hacking the oil rig\'s locked crate — 2 minutes. A helicopter is bringing in scientists!', 'bad');
    if (G.onNoise) G.onNoise(c.x, c.z, 90, by || null);
    const pad = m.helipad; if (!pad) return;
    const T = callTransport('troops', pad.x, pad.z, pad.y + 3.6, pad.y, 9), spots = [[2.6, 2.3], [-2.6, 2.3], [2.6, -2.3], [-2.6, -2.3]];
    spots.forEach(([lx, lz], i) => T.on(T.T2 + 0.8 + i * 0.9, () => { const [x, z] = m.toWorld(lx, lz); spawnTroop('scientist_heavy', x, z, pad.y, { x: c.x, z: c.z, y: c.y }, 'rig'); }));
  },
  tick(dt) {
    const m = rigMon(); if (!m) return;
    const P = G.player, R = E.rig;
    if (m.flare && G.fx && P && (P.x - m.x) ** 2 + (P.z - m.z) ** 2 < 320 * 320 && (R.fxT = (R.fxT || 0) - dt) <= 0) { R.fxT = 0.06; G.fx.fire(m.flare.x, m.flare.y, m.flare.z, 1.5); }
    if ((R.ladT = (R.ladT || 0) - dt) <= 0) { R.ladT = 3; steelLadders(m); }
    if (isGuest()) return;
    const c = rigCrate(m);
    if (c && c.locked && c.hackEnd && G.t >= c.hackEnd) { c.locked = false; c.hackEnd = 0; R.unlockedAt = G.t; Sfx.win(); say('The locked crate on the oil rig is open!', 'good'); }
    if (c && !c.locked && R.unlockedAt && G.t - R.unlockedAt > RIG_RELOCK && nearest(m.x, m.z) > 120) { // restocked while nobody's around
      c.locked = true; c.hackEnd = 0; c.inv = null; c.opened = false; c.openedAt = 0; c.emptyAt = 0; R.unlockedAt = 0;
      if (c.gone) { c.gone = false; c.mesh.visible = true; c.col.off = false; }
    }
    if ((R.fixT = (R.fixT || 0) - dt) <= 0) { R.fixT = 0.5; rigWalkers(m); }
  },
  info() { const m = rigMon(), c = m && rigCrate(m); if (!c) return null; return { x: c.x, z: c.z, phase: c.locked ? (c.hackEnd ? 'hacking' : 'locked') : 'open' }; },
};

// ============================================================================
// the locked-crate drop: a transport lowers a locked crate onto a monument
// ============================================================================
const DROP_SKIP = new Set(['fort', 'cave', 'deepcave', 'arch', 'spires', 'oilrig']);
/** open ground inside a site where a crate can come down on a line: not on a roof or deck, nothing tall close by */
function dropSpot(m) {
  for (let k = 0; k < 90; k++) {
    const a = rand(0, 6.283), r = rand(0, m.size * 0.6), x = m.x + Math.cos(a) * r, z = m.z + Math.sin(a) * r;
    if (!G.W.walkable(x, z) || G.W.isWater(x, z)) continue;
    const gy = G.W.height(x, z), fy = Build.floorY(x, z); if (fy - gy > 0.35 || Live.floorAt(x, z) !== null) continue;
    if (G.rooms.some(q => x > q.x0 - 1.5 && x < q.x1 + 1.5 && z > q.z0 - 1.5 && z < q.z1 + 1.5)) continue;
    if (G.phys.overlaps(x, z, 1.8) || G.phys.overlaps(x, z, 4, c => c.solid && !c.off && ((c.y0 ?? gy) + (c.h || 3)) > gy + 4)) continue;
    if (Build.inPrivilege(x, z)) continue;
    return { x, z, y: fy };
  }
  return null;
}
const Drop = {
  start() {
    if (isGuest() || E.drop) return null;
    const cand = G.monuments.filter(m => m.def && !m.def.safe && (m.def.tier || 0) >= 1 && !m.def.offshore && !DROP_SKIP.has(m.type) && !(Build.tc && dist(Build.tc.x, Build.tc.z, m.x, m.z) < m.size + 60));
    for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    cand.sort((a, b) => (b.spawns && b.spawns.length ? 1 : 0) - (a.spawns && a.spawns.length ? 1 : 0)); // guarded sites first
    let m = null, s = null; for (const q of cand.slice(0, 12)) { s = dropSpot(q); if (s) { m = q; break; } }
    if (!s) return null;
    const T = callTransport('crate', s.x, s.z, s.y + 22, s.y, 15);
    const D = E.drop = { mon: m, x: s.x, z: s.z, y: s.y, phase: 'inbound', heli: T, c: null, t0: G.t };
    T.on(T.touchT, () => this.land());
    say('A transport helicopter is bringing in a locked crate — it\'s heading for the ' + m.name + ' (' + compass(m.x, m.z) + ')', 'good');
    Sfx.tone && Sfx.tone(330, 0.2, 0.08, 'triangle');
    publish(); return D;
  },
  land() {
    const D = E.drop; if (!D || D.c) return;
    const c = Live.addContainer({ type: 'locked_crate', x: D.x, z: D.z, ry: rand(0, 6.28) }); if (!c) { this.end(); return; }
    Live.placeY(c, D.y); c.locked = true; c.hackEnd = 0; c.evDrop = true; D.c = c; D.phase = 'landed'; D.landT = G.t;
    if (G.net && G.net.role === 'host') G.net.broadcast({ t: 'cadd', c: [c.id, c.type, r2(c.x), r2(c.y), r2(c.z), Math.round(c.ry * 1000) / 1000, 1, 'ev'] });
    say('The locked crate is down at the ' + D.mon.name + '. Hack it open — and hold it for two minutes.', 'good');
    if (G.onNoise) G.onNoise(D.x, D.z, 70, null); // the site's garrison heard it come down
  },
  startHack(c, by) {
    const D = E.drop; if (!D || D.c !== c || !c.locked || c.hackEnd) return;
    c.hackEnd = G.t + HACK_T; D.phase = 'hacking'; Sfx.card && Sfx.card();
    say('Hacking the locked crate — 2 minutes. They\'re flying in a squad to take it back!', 'bad');
    if (G.onNoise) G.onNoise(c.x, c.z, 70, by || null);
    const s = troopSpot(D.x, D.z, D.y), n = G.day >= 6 ? 4 : 3;
    const T = callTransport('troops', s.x, s.z, s.y + (s.clear ? 3.4 : 12), s.y, 8);
    for (let i = 0; i < n; i++) T.on(T.T2 + 0.8 + i * 0.9, () => { const a = rand(0, 6.28), p = groundNear(s.x + Math.cos(a) * 2.2, s.z + Math.sin(a) * 2.2, s.x, s.z); spawnTroop('scientist_heavy', p.x, p.z, p.y, { x: c.x, z: c.z, y: c.y }, 'drop'); });
  },
  tick() {
    const D = E.drop; if (!D) return;
    const c = D.c;
    if (c && c.locked && c.hackEnd && G.t >= c.hackEnd) { c.locked = false; c.hackEnd = 0; D.phase = 'open'; D.openT = G.t; Sfx.win(); say('The locked crate at the ' + D.mon.name + ' is open!', 'good'); }
    if (!c) { if (D.heli.done) this.end(); return; } // (the line broke: never landed)
    const far = nearest(D.x, D.z) > 40, showing = G.ui && G.ui.sheetOpen && G.ui.curSide && G.ui.curSide.inv === c.inv;
    if (D.phase === 'landed' && G.t - D.landT > 1200 && far) this.end('Nobody claimed the locked crate at the ' + D.mon.name + ' — it was flown out again');
    else if (D.phase === 'open' && far && !showing && ((c.inv && c.inv.empty()) || G.t - D.openT > 600)) this.end();
  },
  end(msg) {
    const D = E.drop; if (!D) return; E.drop = null;
    const c = D.c;
    if (c) { const i = G.containers.indexOf(c); if (i >= 0) G.containers.splice(i, 1); if (c.mesh) c.mesh.removeFromParent(); if (c.col) G.phys.remove(c.col); if (G.net && G.net.role === 'host') G.net.broadcast({ t: 'crem', ids: [c.id] }); }
    if (msg) say(msg);
    publish();
  },
};
/** the red smoke and beacon over a locked crate that's down (everyone, from G.events.lockedCrate) */
function dropFx(dt) {
  const L = evs().lockedCrate, on = !!(L && (L.phase === 'landed' || L.phase === 'hacking'));
  if (on && G.fx && G.player && dist(G.player.x, G.player.z, L.x, L.z) < 260) G.fx.smoke(L.x, (L.y ?? G.W.height(L.x, L.z)) + 1.1, L.z, L.phase === 'hacking' ? '#e0a030' : '#d04040', dt);
  const have = G.lights.find(l => l.evDrop);
  if (on && !have) G.lights.push({ x: L.x, y: (L.y ?? 0) + 1.6, z: L.z, color: '#ff4030', intensity: 1.6, range: 9, evDrop: true });
  else if (!on && have) G.lights = G.lights.filter(l => !l.evDrop);
}

// ============================================================================
// the armoured patrol: an APC on the ring road with a machine gun and a cannon
// ============================================================================
const APC_DEF = { name: 'Armoured Patrol', kind: 'vehicle', hp: 1200, speed: 5.5, r: 2.3, sight: 55, xp: 80, drop: null };
function makeApcModel(burnt) {
  const root = new THREE.Group();
  const c = (hex, tex) => M.mat(burnt ? '#2a2826' : hex, tex ? { tex: 'metal' } : {});
  const green = c('#4d5a3c', 1), green2 = c('#3a4630', 1), dark = M.mat('#1c1e1c'), sand = c('#8a7a52', 1);
  M.add(root, M.box(6.4, 1.3, 3.0), green, 0, 1.25, 0);                          // hull
  M.add(root, M.box(1.7, 0.9, 2.9), green, 3.2, 1.05, 0, { rz: 0.55 });          // glacis
  M.add(root, M.box(6.0, 0.18, 3.3), green2, -0.1, 1.95, 0);                     // upper deck
  for (const s of [-1, 1]) {
    M.add(root, M.box(6.2, 0.75, 0.12), green2, -0.1, 1.2, s * 1.63);            // side skirts
    M.add(root, M.box(6.3, 0.9, 0.62), dark, -0.05, 0.5, s * 1.25);              // tracks
    for (const x of [-2.4, -0.8, 0.8, 2.4]) M.add(root, M.cyl(0.42, 0.42, 0.3, 10), dark, x, 0.45, s * 1.47, { rx: Math.PI / 2 });
    M.add(root, M.box(0.7, 0.4, 0.5), sand, -2.6, 2.2, s * 1.1);                 // stowage boxes
  }
  M.add(root, M.box(0.3, 0.12, 0.3), M.basic(burnt ? '#2a2826' : '#ffd890'), 3.95, 1.55, -1.0); M.add(root, M.box(0.3, 0.12, 0.3), M.basic(burnt ? '#2a2826' : '#ffd890'), 3.95, 1.55, 1.0);
  const tur = new THREE.Group(); tur.position.set(-0.4, 2.04, 0); root.add(tur);
  M.add(tur, M.box(2.6, 0.9, 2.2), green, 0, 0.45, 0); M.add(tur, M.box(1.1, 0.65, 1.9), green2, -1.4, 0.38, 0);
  M.add(tur, M.cyl(0.1, 0.13, 2.7, 8), dark, 2.45, 0.5, 0.35, { rz: Math.PI / 2 });   // cannon
  M.add(tur, M.cyl(0.055, 0.055, 1.3, 6), dark, 1.85, 0.62, -0.45, { rz: Math.PI / 2 }); // coaxial machine gun
  M.add(tur, M.box(0.5, 0.45, 0.55), dark, 0.25, 1.1, -0.55);                      // sight
  M.add(tur, M.cyl(0.02, 0.02, 2.4, 4), dark, -1.6, 2.0, 0.8);                     // antenna
  root.userData.turret = tur;
  return root;
}
/** the muzzle: the cannon or the machine gun at the end of the turned turret */
function apcMuzzle(a, cannon) {
  const ox = a.x - Math.cos(a.ang) * 0.4, oz = a.z - Math.sin(a.ang) * 0.4, t = a.turY ?? a.ang, f = cannon ? 3.8 : 2.55, s = cannon ? 0.35 : -0.45;
  return { x: ox + Math.cos(t) * f - Math.sin(t) * s, y: a.y + 2.04 + (cannon ? 0.5 : 0.62), z: oz + Math.sin(t) * f + Math.cos(t) * s };
}
function makeApcActor(x, z, y, mirror) {
  const root = makeApcModel(false); root.position.set(x, y, z);
  const a = {
    id: mirror ? -1 : 92000 + (++E.aid), type: 'apc', def: APC_DEF, kind: 'vehicle', apc: true, x, z, y, ang: 0, turY: 0, r: APC_DEF.r, hp: APC_DEF.hp, maxhp: APC_DEF.hp, team: 'hostile',
    st: { flinch: 0, aim: false, swing: -1, attack: -1, reload: -1, recoil: 0, speed: 0, dead: 0, throw: -1, use: -1 }, ai: { state: 'patrol', alertT: 1, route: [] },
    cd: 0, cannonCd: 5, dead: false, deadT: 0, bleed: 0, flash: 0, slowT: 0, armor: 0.72, helm: 1, speedNow: 0, boss: true, burst: 0,
  };
  a.rig = {
    root, height: 2.7, setHeld() { }, setLook() { }, flash() { }, dispose() { },
    update(dt) {
      if (a.mirror !== undefined) { const P = G.player, want = a.st.aim && P && !P.dead ? Math.atan2(P.z - a.z, P.x - a.x) : a.ang; a.turY = (a.turY ?? a.ang) + clamp(angDiff(a.turY ?? a.ang, want), -dt * 1.5, dt * 1.5); }
      root.userData.turret.rotation.y = -((a.turY ?? a.ang) - a.ang);
    },
    muzzleWorld(v) { const p = apcMuzzle(a, a.useCannon); return v.set(p.x, p.y, p.z); }, handWorld(v) { return this.muzzleWorld(v); },
  };
  if (!mirror) a.evUpdate = dt => updateApc(a, dt);
  G.scene.add(root); G.actors.push(a); return a;
}
/** the ring road as a path: cumulative lengths and the road's own (smoothed) heights */
function roadPath() {
  const p = G.W && G.W.roads && G.W.roads[0]; if (!p || !p.hs || p.length < 4) return null;
  const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + dist(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]));
  return { p, hs: p.hs, cum, len: cum[cum.length - 1] };
}
/** the stretches of the ring road that keep clear of the monuments (it runs through some sites, buildings and all): [s0, s1] arcs */
function clearStretches(R) {
  const n = R.p.length - 1, ok = [];
  for (let i = 0; i < n; i++) { const [x, z] = R.p[i]; ok.push(!G.monuments.some(m => (m.x - x) ** 2 + (m.z - z) ** 2 < (m.size + 10) ** 2)); }
  if (ok.every(Boolean)) return [{ s0: 0, s1: R.len, loop: true }];
  const first = ok.indexOf(false), out = []; let i0 = -1, cnt = 0;
  const flush = () => { if (i0 < 0 || cnt < 2) return; const i1 = (i0 + cnt - 1) % n; const s0 = R.cum[i0], s1 = i1 >= i0 ? R.cum[i1] : R.cum[i1] + R.len; out.push({ s0, s1 }); };
  for (let k = 1; k <= n; k++) { const i = (first + k) % n; if (ok[i]) { if (i0 < 0) { i0 = i; cnt = 0; } cnt++; } else { flush(); i0 = -1; } }
  flush();
  return out.filter(r => r.s1 - r.s0 > 250);
}
function sampleRoad(R, s) {
  s = ((s % R.len) + R.len) % R.len; let lo = 1, hi = R.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (R.cum[mid] < s) lo = mid + 1; else hi = mid; }
  const i = lo, a = R.p[i - 1], b = R.p[i], t = (s - R.cum[i - 1]) / Math.max(1e-6, R.cum[i] - R.cum[i - 1]);
  return { x: lerp(a[0], b[0], t), z: lerp(a[1], b[1], t), y: lerp(R.hs[i - 1], R.hs[i], t), ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
function apcTarget(a) {
  let best = null, bd = APC_DEF.sight ** 2;
  const consider = o => {
    if (!o || o.dead || o.removed || airborne(o) || o.inSafe || (o === G.player && o.hidden)) return;
    const d = (o.x - a.x) ** 2 + (o.z - a.z) ** 2; if (d >= bd || Math.abs((o.y ?? 0) - a.y) > 14) return;
    const ya = a.y + 2.6, yo = (o.y ?? 0) + 1.2, lo = Math.min(ya, yo), hi = Math.max(ya, yo);
    if (!G.phys.los(a.x, a.z, o.x, o.z, c => c.opaque && !c.off && (c.yhi === undefined ? (c.y0 ?? -99) + (c.h || 3) > lo : (c.yhi > lo && c.ylo < hi)))) return;
    bd = d; best = o;
  };
  consider(G.player); for (const o of G.actors) if (o.bot || o.remote !== undefined) consider(o);
  return best;
}
/** anyone in front of the tracks gets knocked aside (and hurt) */
function runOver(a, v) {
  if (v < 1.5) return; const fx = Math.cos(a.ang), fz = Math.sin(a.ang);
  for (const o of [G.player, ...G.actors]) {
    if (!o || o === a || o.dead || o.apc || o.vehicle || o.remote !== undefined || o.heli || airborne(o)) continue;
    const dx = o.x - a.x, dz = o.z - a.z, f = dx * fx + dz * fz, l = -dx * fz + dz * fx;
    if (f < -3.2 || f > 3.7 || Math.abs(l) > 1.9 || Math.abs((o.y ?? 0) - a.y) > 2) continue;
    const sg = l >= 0 ? 1 : -1; o.x += -fz * sg * 1.2; o.z += fx * sg * 1.2;
    if (!o.crushT || G.t > o.crushT) { o.crushT = G.t + 1; hurt(o, 18 * v / 3, { owner: a, kind: 'crush', dir: a.ang }); }
  }
}
/** what people built on the road ahead of the tracks: walls, doorways, windows, high walls, stairs, solid deployables
 *  (foundations it climbs onto; floors overhead it drives under). [{ o, k }] with k the metres of road to it, nearest first */
function apcBlockers(a, A) {
  const pts = []; for (let k = 1.5; k <= 9.01; k += 1.5) { const S = sampleRoad(A.R, A.s + A.dir * k); pts.push([S.x, S.z, k]); }
  const out = [], R2 = 14 * 14, lo = a.y + 0.45, hi = a.y + 2.5;
  const test = (o, x, z, rad, y0, y1) => {
    if (y1 < lo || y0 > hi) return;
    for (const [px, pz, k] of pts) if ((px - x) ** 2 + (pz - z) ** 2 < (rad + 1.45) ** 2) { out.push({ o, k }); return; }
  };
  for (const e of Build.edges.values()) {
    if (e.dead || e.owner === 'mon') continue; const [x, z] = Build.pieceXZ(e); if ((x - a.x) ** 2 + (z - a.z) ** 2 > R2) continue;
    const b = e.base ?? e.level ?? 0; test(e, x, z, e.hw ? 1.5 : 1.3, b, b + (e.type === 'lowwall' ? 1.1 : e.hw ? 6 : 3));
  }
  for (const c of Build.cells.values()) for (let s = 0; s < 3; s++) { const st = c['stair' + s]; if (!st || st.dead) continue; const [x, z] = Build.pieceXZ(st); if ((x - a.x) ** 2 + (z - a.z) ** 2 < R2) test(st, x, z, 1.5, st.base ?? 0, (st.base ?? 0) + 3); }
  for (const d of Build.deploys) { if (d.dead || !d.col || DEPLOY_LADDER(d)) continue; if ((d.x - a.x) ** 2 + (d.z - a.z) ** 2 < R2) test(d, d.x, d.z, Math.min(1.5, d.r || 0.5), d.y ?? 0, (d.y ?? 0) + 1.5); }
  return out.sort((p, q) => p.k - q.k);
}
const DEPLOY_LADDER = d => d.type === 'ladder';
/** ram what's in the way: a jolt, dust and a thud, and real damage (twig and wood go fast, armour barely) */
function apcRam(a, A, list) {
  const P = G.player, k0 = list[0].k; // returns whether anything gave way
  for (const { o, k } of list) {
    if (k > k0 + 1.6) break;
    damageStruct(o, 140, 'explosive');
    if (o.door && !o.door.dead) damageStruct(o.door, 140, 'explosive');
    const [x, z] = o.sk === 'deploy' ? [o.x, o.z] : Build.pieceXZ(o);
    if (G.fx && P && dist(P.x, P.z, x, z) < 120) { G.fx.debris(x, a.y + 1, z, o.tier || 'metal'); G.fx.emit({ x, y: a.y + 0.6, z, vy: 0.6, life: 1.6, size: 1.2, size1: 3.4, r: 0.55, g: 0.5, b: 0.42, a: 0.6, a1: 0, drag: 0.6 }); }
    Sfx.thud(x, z);
  }
  if (P && G.rend) { const d = dist(P.x, P.z, a.x, a.z); if (d < 30) G.rend.shake = Math.max(G.rend.shake || 0, clamp(1.1 - d / 30, 0.15, 1.1)); }
  A.jolt = 0.35; // it rocks back on its tracks
  return list.some(q => q.o.dead);
}
function updateApc(a, dt) {
  const A = E.apc; if (!A || A.a !== a) { if (!a.removed) removeActor(a); return; }
  if (a.dead) { apcWreck(a); return; }
  A.life -= dt; a.cd -= dt; a.cannonCd -= dt;
  if ((A.scanT -= dt) <= 0) { A.scanT = 0.4; const t = apcTarget(a); if (t) { A.tgt = t; A.seenT = G.t; } }
  const T = A.tgt && !A.tgt.dead && G.t - A.seenT < 6 ? A.tgt : null; // keeps at it where it last saw you for a moment
  // something built on the road ahead: slow down, drive up to it and ram it until it gives; if it won't (armour), turn back
  if ((A.blkT = (A.blkT || 0) - dt) <= 0) { A.blkT = 0.3; A.blk = apcBlockers(a, A); }
  const blk = A.blk && A.blk.length ? A.blk : null, contact = blk && blk[0].k <= 3.2;
  let want = T ? 0 : APC_DEF.speed;
  if (blk) want = Math.min(want, contact ? 0 : 1.6);
  if (contact) {
    A.ramT = (A.ramT || 0) + dt;
    if (A.ramT > 1.6 && !T) { A.ramT = 0; A.rams = apcRam(a, A, blk) ? 0 : (A.rams || 0) + 1; A.blkT = 0; }
    if ((A.rams || 0) >= 7) { A.dir = -A.dir; A.rams = 0; A.ramT = 0; A.v = 0; A.blk = null; } // seven rams and nothing gave: back the way it came
  } else if (!blk) { A.rams = 0; A.ramT = 0; }
  A.v += clamp(want - A.v, -4 * dt, 1.4 * dt);
  // patrols its stretch of road to and fro: at each end it stops and pivots round on its tracks
  if (!A.loop && ((A.dir > 0 && A.s >= A.s1) || (A.dir < 0 && A.s <= A.s0))) { A.s = clamp(A.s, A.s0, A.s1); A.dir = -A.dir; A.v = 0; }
  const S0 = sampleRoad(A.R, A.s), head = A.dir > 0 ? S0.ang : S0.ang + Math.PI, turning = Math.abs(angDiff(a.ang, head)) > 0.6;
  if (turning) { A.v = Math.min(A.v, 0.4); a.ang += clamp(angDiff(a.ang, head), -dt * 0.9, dt * 0.9); }
  if (A.v > 0.01) {
    A.s += A.v * dt * A.dir;
    const S = sampleRoad(A.R, A.s), ang = A.dir > 0 ? S.ang : S.ang + Math.PI;
    a.x = S.x; a.z = S.z; a.y += (Build.floorY(S.x, S.z, S.y + 0.6) - a.y) * Math.min(1, dt * 6);
    if (!turning) a.ang += angDiff(a.ang, ang) * Math.min(1, dt * 2.5);
    runOver(a, A.v);
  }
  if (A.jolt > 0) { A.jolt = Math.max(0, A.jolt - dt); const j = Math.sin(A.jolt / 0.35 * Math.PI) * 0.35, S = sampleRoad(A.R, A.s - A.dir * j); a.x = S.x; a.z = S.z; } // the jolt of a ram
  a.speedNow = A.v;
  const aim = T ? Math.atan2(T.z - a.z, T.x - a.x) : a.ang;
  a.turY += clamp(angDiff(a.turY, aim), -dt * 1.5, dt * 1.5); a.st.aim = !!T;
  if (T && Math.abs(angDiff(a.turY, aim)) < 0.12) {
    const d = dist(a.x, a.z, T.x, T.z), mg = WEAPONS.lmg ? 'lmg' : 'ar';
    if (a.cd <= 0) { a.burst++; a.cd = a.burst % 14 === 0 ? rand(1.4, 2.4) : 0.1; a.useCannon = false; fireWeapon(a, mg, a.turY + rand(-0.03, 0.03), { target: T, dmgMul: 0.75, spreadMul: 1.4 }); }
    if (a.cannonCd <= 0 && d > 9) { a.cannonCd = rand(6, 9); a.useCannon = true; fireWeapon(a, 'rocket_launcher', a.turY, { target: T, dmgMul: 0.8 }); a.useCannon = false; }
  }
  if (G.player && (A.sndT = (A.sndT || 0) - dt) <= 0) { A.sndT = 0.22; const v = Sfx.vol(a.x, a.z, 120); if (v > 0.02) Sfx.noise(0.2, 70 + A.v * 8, 1, 0.14 * v, 'lowpass'); }
  // done patrolling: it leaves once nobody's near
  if (A.life <= 0 && nearest(a.x, a.z) > 170) { removeActor(a); E.apc = null; }
}
function buildWreck(w) {
  const mesh = makeApcModel(true); mesh.position.set(w.x, w.y, w.z); mesh.rotation.set(0, -w.ang, 0.06); mesh.userData.turret.rotation.y = -(w.tur - w.ang) + 0.5; mesh.userData.turret.position.y += 0.1; G.scene.add(mesh);
  const col = G.phys.addCircle(w.x, w.z, 2.2, { h: 2.6, kind: 'prop', y0: w.y });
  G.lights.push({ x: w.x, y: w.y + 2, z: w.z, color: '#ff8030', intensity: 2.2, range: 12, evWreck: true });
  return Object.assign({ mesh, col, crates: [], t0: G.t }, w);
}
function removeWreck() {
  const W = E.wreck; if (!W) return; E.wreck = null;
  W.mesh.removeFromParent(); G.phys.remove(W.col); G.lights = G.lights.filter(l => !l.evWreck);
  const ids = [];
  for (const c of W.crates) { const i = G.containers.indexOf(c); if (i >= 0) { G.containers.splice(i, 1); ids.push(c.id); } if (c.mesh) c.mesh.removeFromParent(); if (c.col) G.phys.remove(c.col); }
  if (ids.length && G.net && G.net.role === 'host') G.net.broadcast({ t: 'crem', ids });
}
function apcWreck(a) {
  if (a.wrecked) return; a.wrecked = true;
  explode(a.x, a.z, { r: 5, dmg: 90, struct: 150 }, a, 'hostile', a.y + 1);
  removeWreck();
  const W = E.wreck = buildWreck({ x: a.x, y: a.y, z: a.z, ang: a.ang, tur: a.turY ?? a.ang });
  [['elite', -0.9], ['military', 0], ['military', 0.9]].forEach(([type, k], i) => {
    const an = a.ang + Math.PI / 2 * (i === 1 ? -1 : 1) + k * 0.3, x = a.x + Math.cos(an) * 3.6 + Math.cos(a.ang) * k * 1.8, z = a.z + Math.sin(an) * 3.6 + Math.sin(a.ang) * k * 1.8;
    const c = Live.addContainer({ type, x, z, ry: rand(0, 6.28) }); if (!c) return;
    c.def = Object.assign({}, CONTAINERS[type], { respawn: 0 }); W.crates.push(c);
    if (G.net && G.net.role === 'host') G.net.broadcast({ t: 'cadd', c: [c.id, c.type, r2(c.x), r2(c.y), r2(c.z), Math.round(c.ry * 1000) / 1000, 0, 'ev'] });
  });
  say('The armoured patrol is destroyed! Its crates are in the wreck.', 'good');
  removeActor(a); E.apc = null; publish();
}
function wreckTick(dt) {
  const W = E.wreck; if (!W) return;
  const age = G.t - W.t0, P = G.player;
  if (G.fx && P && dist(P.x, P.z, W.x, W.z) < 200) { if (age < 150) G.fx.fire(W.x + Math.cos(age) * 0.6, W.y + 1.8, W.z, 1.1); if (age < 400) G.fx.smoke(W.x, W.y + 2.6, W.z, '#2a2826', dt); }
  if (!isGuest() && age > 600 && nearest(W.x, W.z) > 50) { removeWreck(); publish(); }
}
const Apc = {
  start() {
    if (isGuest() || E.apc) return null;
    const R = roadPath(); if (!R) return null;
    // a stretch of the ring road clear of the monuments (preferably one starting well away from everyone), and a spot on it
    const runs = clearStretches(R); if (!runs.length) return null;
    let run = null, s = null;
    for (let k = 0; k < 80 && s === null; k++) { const r = pick(runs), q = rand(r.s0 + 20, r.s1 - 20), S = sampleRoad(R, q); if (nearest(S.x, S.z) > 260 || k > 60) { run = r; s = q; } }
    const S = sampleRoad(R, s), a = makeApcActor(S.x, S.z, Build.floorY(S.x, S.z, S.y + 0.6), false);
    E.apc = { a, R, s, s0: run.s0, s1: run.s1, loop: !!run.loop, dir: chance(0.5) ? 1 : -1, v: 0, life: 900, scanT: 0, tgt: null, seenT: -99 };
    a.ang = a.turY = E.apc.dir > 0 ? S.ang : S.ang + Math.PI;
    say('An armoured patrol is rolling along the ring road — it shoots on sight. Rockets and C4 will stop it.', 'bad');
    publish(); return a;
  },
};

// ============================================================================
// event control (host / solo runs it; co-op guests get the state line)
// ============================================================================
function publish() {
  const ev = evs(), D = E.drop, A = E.apc, W = E.wreck;
  ev.lockedCrate = D ? { x: r2(D.x), z: r2(D.z), y: r2(D.y), phase: D.phase, name: D.mon.name } : null;
  ev.convoy = A ? { x: r2(A.a.x), z: r2(A.a.z), ang: r2(A.a.ang), phase: A.v < 0.5 && A.tgt ? 'engaging' : 'patrol' } : W ? { x: r2(W.x), z: r2(W.z), ang: r2(W.ang), phase: 'wreck' } : null;
  ev.helis = E.helis.filter(T => !T.done).map(T => ({ x: r2(T.x), z: r2(T.z), ang: r2(T.yaw) }));
  ev.rig = Rig.info();
}
export const Events = {
  update(dt) {
    for (const T of E.helis) T.update(dt);
    for (let i = E.helis.length - 1; i >= 0; i--) if (E.helis[i].done) { E.helis[i].dispose(); E.helis.splice(i, 1); }
    Rig.tick(dt);
    if (!isGuest()) Drop.tick(dt);
    if ((E.pubT = (E.pubT || 0) - dt) <= 0) { // the map's view of it all, a few times a second
      E.pubT = 0.2;
      if (!isGuest()) publish(); else { const ev = evs(); ev.helis = E.helis.map(T => ({ x: r2(T.x), z: r2(T.z), ang: r2(T.yaw) })); ev.rig = Rig.info(); }
    }
    dropFx(dt); wreckTick(dt);
  },
  startDrop() { return Drop.start(); },
  startApc() { return Apc.start(); },
  debug() { return E; }, // tests
  /** host -> guests: what's flying, where the crate is, the convoy, the wreck (null = nothing going on) */
  state() {
    const h = E.helis.filter(T => !T.done).map(T => T.plan()), ev = evs(), W = E.wreck;
    if (!h.length && !E.drop && !E.apc && !W) return null;
    return { t: 'zev', h, lc: ev.lockedCrate || null, cv: ev.convoy || null, wr: W ? { x: r2(W.x), y: r2(W.y), z: r2(W.z), ang: r2(W.ang), tur: r2(W.tur) } : null };
  },
  /** guest: follow the host's events */
  fromHost(m) {
    if (!m || typeof m !== 'object') return;
    const ev = evs(), num = v => typeof v === 'number' && Number.isFinite(v);
    const ids = new Set();
    for (const p of Array.isArray(m.h) ? m.h.slice(0, 8) : []) {
      if (!p || !['sx', 'sz', 'hx', 'hz', 'hy', 'gy', 'ex', 'ez', 'cy', 'hov', 't'].every(k => num(p[k])) || (p.kind !== 'crate' && p.kind !== 'troops')) continue;
      ids.add(p.id); let T = E.helis.find(q => q.id === p.id);
      if (!T) { T = new Transport(p, true); E.helis.push(T); } else if (Math.abs(T.t - p.t) > 0.8) T.t = p.t;
    }
    for (const T of E.helis) if (!ids.has(T.id)) T.done = true;
    const lc = m.lc; ev.lockedCrate = lc && num(lc.x) && num(lc.z) ? { x: lc.x, z: lc.z, y: num(lc.y) ? lc.y : G.W.height(lc.x, lc.z), phase: String(lc.phase || ''), name: String(lc.name || '').slice(0, 40) } : null;
    const cv = m.cv; ev.convoy = cv && num(cv.x) && num(cv.z) ? { x: cv.x, z: cv.z, ang: num(cv.ang) ? cv.ang : 0, phase: String(cv.phase || '') } : null;
    const wr = m.wr;
    if (wr && ['x', 'y', 'z', 'ang', 'tur'].every(k => num(wr[k]))) { if (!E.wreck || Math.hypot(E.wreck.x - wr.x, E.wreck.z - wr.z) > 1) { removeWreck(); E.wreck = buildWreck(wr); } }
    else if (E.wreck) removeWreck();
  },
  reset() {
    for (const T of E.helis) T.dispose(); E.helis.length = 0;
    if (E.wreck) { E.wreck.mesh.removeFromParent(); E.wreck = null; }
    E.drop = null; E.apc = null; E.rig = {}; E.rigW = null;
    const ev = evs(); ev.lockedCrate = null; ev.convoy = null; ev.helis = []; ev.rig = null;
  },
};
/** a locked crate's hack starts: the cargo ship's, the oil rig's or a dropped one (co-op guests ask the host, net.js) */
G.onHack = (c, by) => {
  if (!c || !c.locked || c.hackEnd) return;
  const m = rigMon();
  if (c.rig || (m && rigCrate(m) === c)) Rig.startHack(c, by); // (by position too: a guest whose host left plays on with the host's crates)
  else if (c.evDrop) Drop.startHack(c, by);
  else if (G.cargo && G.cargo.startHack) G.cargo.startHack(c, by);
};
/** co-op guests: the body of a host's event vehicle (networld.js) */
G.makeEventMirror = m => (m && m.type === 'apc' ? makeApcActor(+m.x || 0, +m.z || 0, +m.y || 0, true) : null);
G.eventsNet = m => Events.fromHost(m);
void pick; void randi;
