// ============================================================================
// ZONEFALL 4 — vehicles you can use: dune buggies on the roads and little
// minicopters at the airfield, Haven and in the open country.
//   buggy:  stick / WASD = throttle + steer (reverse by pulling back). Fast on
//           roads, slower off-road, crawls through shallows, floods in deep water.
//   heli:   the nose follows where you look; stick / WASD = fly forward / sideways;
//           ⤒ / Space = climb, ⤓ / C = descend. Hovers on its own; lands on its skids.
// Both burn low-grade fuel (topped up from your pockets when you climb in), take
// damage from crashes and explosions, run people over, and respawn after a while
// if wrecked. Arcade physics; collisions use the world's 2D colliders + heights.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Sfx } from './audio.js';
import { hurt, explode } from './combat.js';
import { SOLID } from './physics.js';
import { clamp, lerp, dist, rand, chance, angDiff } from './util.js';
import { Input as INPUT } from './input.js';

const KINDS = {
  buggy: { name: 'Dune Buggy', hp: 420, fuel: 60, burn: 0.14, r: 1.25, eye: 1.0, seat: [-0.25, 0.72, -0.42], respawn: 420 },
  heli: { name: 'Minicopter', hp: 300, fuel: 50, burn: 0.22, r: 2.0, eye: 0.95, seat: [0.15, 0.86, 0], respawn: 600 },
};
const COLORS = ['#ff8a1e', '#2bb3a8', '#d8432f', '#ffc928', '#5a8fd8'];

export class Vehicles {
  constructor(scene) {
    this.scene = scene; this.list = []; this.sndT = 0; this.noiseT = 0;
    this.spawnAll();
  }
  // ---------------------------------------------------------------- spawning
  spawnAll() {
    const W = G.W, spots = [];
    const free = (x, z, r) => W.walkable(x, z) && !W.isWater(x, z) && !G.phys.overlaps(x, z, r, c => c.solid && !c.off) && !(W.onRail && W.onRail(x, z, 4)) && !G.monuments.some(m => !m.def.safe && dist(m.x, m.z, x, z) < m.size * 0.6);
    // buggies: on the shoulders of the roads, spread out
    const roads = W.roads.filter(p => p.length > 6);
    for (let tries = 0; tries < 400 && spots.filter(s => s.kind === 'buggy').length < 9; tries++) {
      const p = roads[Math.floor(Math.random() * roads.length)]; if (!p) break;
      const i = 1 + Math.floor(Math.random() * (p.length - 2)); const [x0, z0] = p[i], [x1, z1] = p[i + 1]; const L = Math.hypot(x1 - x0, z1 - z0) || 1;
      const nx = -(z1 - z0) / L, nz = (x1 - x0) / L, side = chance(0.5) ? 1 : -1;
      const x = x0 + nx * 5.8 * side, z = z0 + nz * 5.8 * side;
      if (!free(x, z, 2.2) || spots.some(s => dist(s.x, s.z, x, z) < 90)) continue;
      spots.push({ kind: 'buggy', x, z, yaw: Math.atan2(z1 - z0, x1 - x0) + (chance(0.5) ? 0 : Math.PI) + rand(-0.3, 0.3) });
    }
    // minicopters: airfield apron, just outside Haven, and open fields
    const heliAt = (x, z) => { for (let k = 0; k < 40; k++) { const a = rand(0, 6.28), r = k * 1.5; const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r; if (free(px, pz, 3.6) && G.W.height(px, pz) > 0.8) { spots.push({ kind: 'heli', x: px, z: pz, yaw: rand(0, 6.28) }); return true; } } return false; };
    const af = G.monuments.find(m => m.type === 'airfield'); if (af) heliAt(af.x + af.size * 0.75, af.z);
    const hv = G.monuments.find(m => m.type === 'haven'); if (hv) heliAt(hv.x + hv.size + 10, hv.z + 6);
    for (let tries = 0; tries < 200 && spots.filter(s => s.kind === 'heli').length < 4; tries++) {
      const x = rand(150, W.size - 150), z = rand(150, W.size - 150);
      if (W.biomeAt(x, z) !== 2 || spots.some(s => dist(s.x, s.z, x, z) < 200)) continue; heliAt(x, z);
    }
    for (const s of spots) this.spawn(s);
  }
  spawn(s) {
    const K = KINDS[s.kind]; const col = COLORS[Math.floor(Math.random() * COLORS.length)];
    const v = { kind: s.kind, K, home: s, x: s.x, z: s.z, y: G.W.height(s.x, s.z), yaw: s.yaw, pitch: 0, roll: 0, speed: 0, vx: 0, vz: 0, vy: 0, steer: 0, hp: K.hp, fuel: Math.round(K.fuel * rand(0.35, 0.8)), dead: false, driver: null, rpm: 0, hitT: new Map() };
    v.mesh = s.kind === 'buggy' ? buildBuggy(col, v) : buildHeli(col, v);
    this.scene.add(v.mesh.root); this.list.push(v); this.place(v);
    return v;
  }
  // ---------------------------------------------------------------- per frame
  update(dt) {
    const P = G.player;
    for (const v of this.list) {
      if (v.dead) { if (G.t > v.respawnAt) this.respawn(v); continue; }
      if (v.driver && v.driver.dead) this.exit(v.driver, false);
      if (v.driver) { if (v.kind === 'buggy') this.driveBuggy(v, dt); else this.flyHeli(v, dt); }
      else if (v.kind === 'heli' && v.y > G.W.height(v.x, v.z) + 0.1) this.flyHeli(v, dt); // abandoned in the air: it drops
      else if (Math.abs(v.speed) > 0.05) this.driveBuggy(v, dt);
      else v.rpm = Math.max(0, v.rpm - dt * 0.5);
      this.animate(v, dt);
      if (v.driver === P) this.carry(v, P, dt);
    }
    // engine sounds + noise for the AI
    const d = P && P.vehicle;
    if (d) {
      this.sndT -= dt;
      if (d.kind === 'buggy' && this.sndT <= 0) { this.sndT = 0.11; const k = Math.min(1, Math.abs(d.speed) / 18); Sfx.noise(0.14, 90 + k * 220, 2, 0.05 + k * 0.05, 'lowpass'); }
      if (d.kind === 'heli' && this.sndT <= 0) { this.sndT = lerp(0.2, 0.075, d.rpm); Sfx.noise(0.07, 160 + d.rpm * 80, 1.5, 0.07 * d.rpm + 0.02, 'lowpass'); }
      if ((this.noiseT -= dt) <= 0) { this.noiseT = 1; if (G.onNoise) G.onNoise(d.x, d.z, d.kind === 'heli' ? 45 : 28, P); }
    }
  }
  /** keep the player in the seat; turning the vehicle turns your view with it */
  carry(v, P, dt) {
    const s = v.K.seat, cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    P.x = v.x + s[0] * cs - s[2] * sn; P.z = v.z + s[0] * sn + s[2] * cs; P.y = v.y + s[1];
    if (v.kind === 'buggy') P.yaw += angDiff(v.lastYaw ?? v.yaw, v.yaw); // your view turns with the car (the heli turns with your view)
    v.lastYaw = v.yaw;
    P.eye = v.K.eye; P.airY = 0; P.vy = 0; P.speedNow = Math.hypot(v.vx, v.vz) || Math.abs(v.speed);
  }
  // ---------------------------------------------------------------- buggy
  driveBuggy(v, dt) {
    const P = v.driver; let thr = 0, st = 0;
    if (P && !G.uiBlock) { const mv = Input().moveVec(); thr = mv.y; st = mv.x; }
    if (v.fuel <= 0 && thr !== 0) { thr = 0; if (!v.dryT || G.t > v.dryT) { v.dryT = G.t + 4; G.ui.toast('Out of fuel — carry low-grade fuel and get back in', 'bad'); } }
    const W = G.W, h0 = W.height(v.x, v.z), b = W.biomeAt(v.x, v.z);
    const road = W.isRoad(v.x, v.z) || W.isFlat(v.x, v.z);
    const vmax = h0 < -0.25 ? 4 : road ? 21 : b === 1 ? 10 : b === 5 ? 9 : 14;
    if (thr > 0.05) { v.speed += thr * (v.speed < -0.3 ? 14 : 7.5) * dt; v.fuel -= v.K.burn * dt * thr; }
    else if (thr < -0.05) { if (v.speed > 0.4) v.speed -= 16 * dt * -thr; else v.speed = Math.max(-6, v.speed + thr * 5 * dt); v.fuel -= v.K.burn * dt * 0.5; }
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), 3.2 * dt);
    if (Math.abs(v.speed) > vmax) v.speed += (Math.sign(v.speed) * vmax - v.speed) * Math.min(1, dt * 2.5);
    v.speed -= Math.sin(v.pitch) * 7 * dt;                         // hills
    v.fuel = Math.max(0, v.fuel); v.rpm = lerp(v.rpm, P ? 0.35 + Math.min(1, Math.abs(v.speed) / 18) * 0.65 : 0, dt * 3);
    v.steer += (st - v.steer) * Math.min(1, dt * 6);
    const turn = v.steer * clamp(v.speed / 5, -1, 1) * 1.35 * (1 - 0.4 * Math.min(1, Math.abs(v.speed) / 21));
    v.yaw += turn * dt;
    // move with collisions (deep water stops you)
    const dx = Math.cos(v.yaw) * v.speed * dt, dz = Math.sin(v.yaw) * v.speed * dt;
    if (W.height(v.x + dx * 4, v.z + dz * 4) < -0.85) { if (Math.abs(v.speed) > 2 && P === G.player) G.ui.toast('Too deep to drive'); v.speed *= -0.2; }
    else {
      const p = { x: v.x, z: v.z }; const bumped = G.phys.move(p, dx, dz, v.K.r, c => SOLID(c) && (c.top === undefined || (c.y0 ?? -99) < v.y + 1.4));
      const want = Math.hypot(dx, dz), got = Math.hypot(p.x - v.x, p.z - v.z);
      if (bumped && got < want * 0.6) { const hit = Math.abs(v.speed); if (hit > 5) this.damage(v, hit * 3.2, 'crash'); if (hit > 2) Sfx.noise(0.25, 260, 1, Math.min(0.5, hit / 30), 'lowpass'); v.speed *= -0.25; }
      v.x = p.x; v.z = p.z;
    }
    this.place(v);
    this.runOver(v, Math.abs(v.speed), Math.cos(v.yaw), Math.sin(v.yaw));
  }
  // ---------------------------------------------------------------- minicopter
  flyHeli(v, dt) {
    const P = v.driver; let fwd = 0, side = 0, lift = 0;
    const engine = !!P && v.fuel > 0;
    if (P && !G.uiBlock) {
      const I = Input(), mv = I.moveVec(); fwd = mv.y; side = mv.x;
      lift = (I.held.jump || I.held.up ? 1 : 0) - (I.held.crouch || I.held.down ? 1 : 0);
      // the nose follows where you look
      v.yaw += clamp(angDiff(v.yaw, P.yaw), -dt * 1.6, dt * 1.6);
    }
    v.rpm = clamp(v.rpm + (engine ? dt * 0.55 : -dt * 0.35), 0, 1);
    if (engine) v.fuel = Math.max(0, v.fuel - v.K.burn * dt * (0.5 + v.rpm * 0.5));
    if (P && v.fuel <= 0 && (!v.dryT || G.t > v.dryT)) { v.dryT = G.t + 5; G.ui.toast('Out of fuel! You\'re coming down…', 'bad'); }
    const ground = G.W.height(v.x, v.z), gy = Math.max(ground, -0.05), up = v.rpm > 0.8;
    const landed = v.y <= gy + 0.02;
    if (up) {
      const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
      v.vx += (cs * fwd * 8 - sn * side * 5.5) * dt; v.vz += (sn * fwd * 8 + cs * side * 5.5) * dt;
      v.vy += (lift * 6.5 - v.vy * 2.2) * dt;
      if (landed && lift <= 0) v.vy = Math.max(0, v.vy);
    } else v.vy -= (P ? 2 : 9) * dt;                                  // spooling / unpowered: settle or fall
    const drag = landed ? 6 : 0.8; v.vx -= v.vx * Math.min(1, drag * dt); v.vz -= v.vz * Math.min(1, drag * dt);
    const hs = Math.hypot(v.vx, v.vz); if (hs > 26) { v.vx *= 26 / hs; v.vz *= 26 / hs; }
    // horizontal move with obstacle checks at our height
    const nx = v.x + v.vx * dt, nz = v.z + v.vz * dt; let blocked = null;
    G.phys.query(nx - v.K.r, nz - v.K.r, nx + v.K.r, nz + v.K.r, c => {
      if (c.off || !c.solid) return; const top = (c.y0 ?? G.W.height(nx, nz)) + (c.h || 3); if (top < v.y + 0.25) return;
      const px = c.t === 'c' ? c.x : clamp(nx, c.x0, c.x1), pz = c.t === 'c' ? c.z : clamp(nz, c.z0, c.z1); const rr = c.t === 'c' ? c.r + v.K.r * 0.8 : v.K.r * 0.8;
      if ((px - nx) ** 2 + (pz - nz) ** 2 < rr * rr) { blocked = c; return false; }
    });
    if (blocked) { const sp = Math.hypot(v.vx, v.vz); if (sp > 6) this.damage(v, sp * 4, 'crash'); if (sp > 2) Sfx.noise(0.3, 300, 1, Math.min(0.5, sp / 30), 'lowpass'); v.vx *= -0.3; v.vz *= -0.3; }
    else { v.x = clamp(nx, 5, G.W.size - 5); v.z = clamp(nz, 5, G.W.size - 5); }
    v.y = Math.min(140, v.y + v.vy * dt);
    const g2 = Math.max(G.W.height(v.x, v.z), -0.05);
    if (v.y < g2) { if (v.vy < -7) this.damage(v, -v.vy * 10, 'crash'); v.y = g2; v.vy = Math.max(0, v.vy); }
    // body attitude: nose down to go forward, bank into sideways motion
    const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw), lf = v.vx * cs + v.vz * sn, ls = -v.vx * sn + v.vz * cs;
    v.pitch += (clamp(-lf * 0.016, -0.32, 0.32) - v.pitch) * Math.min(1, dt * 3);
    v.roll += (clamp(ls * 0.03, -0.35, 0.35) - v.roll) * Math.min(1, dt * 3);
    if (v.y <= g2 + 0.02) { v.pitch *= 0.8; v.roll *= 0.8; }
    v.mesh.root.position.set(v.x, v.y, v.z);
    v.mesh.root.rotation.set(0, -v.yaw, 0); v.mesh.root.rotateZ(v.pitch); v.mesh.root.rotateX(v.roll);
    if (v.y < g2 + 3) this.runOver(v, hs, cs, sn);
  }
  // ---------------------------------------------------------------- shared
  /** sit the buggy on the terrain (pitch from front/back, roll from left/right wheels) */
  place(v) {
    if (v.kind !== 'buggy') { v.mesh.root.position.set(v.x, v.y, v.z); v.mesh.root.rotation.set(0, -v.yaw, 0); return; }
    const H = (x, z) => Math.max(G.W.height(x, z), -0.6), cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    const hf = H(v.x + cs * 1.3, v.z + sn * 1.3), hb = H(v.x - cs * 1.3, v.z - sn * 1.3);
    const hl = H(v.x + sn * 0.95, v.z - cs * 0.95), hr = H(v.x - sn * 0.95, v.z + cs * 0.95);
    v.y = (hf + hb + hl + hr) / 4; v.pitch = Math.atan2(hf - hb, 2.6); v.roll = Math.atan2(hr - hl, 1.9);
    v.mesh.root.position.set(v.x, v.y, v.z);
    v.mesh.root.rotation.set(0, -v.yaw, 0); v.mesh.root.rotateZ(v.pitch); v.mesh.root.rotateX(v.roll);
  }
  animate(v, dt) {
    const m = v.mesh;
    if (v.kind === 'buggy') {
      const spin = v.speed * dt / 0.48; for (const w of m.wheels) w.rotation.z -= spin;
      for (const p of m.pivots) p.rotation.y = -v.steer * 0.45;
      if (m.lights) m.lights.visible = !!v.driver && G.night > 0.4;
    } else {
      m.rotor.rotation.y += dt * v.rpm * 38; m.tail.rotation.z += dt * v.rpm * 60;
      m.blur.visible = v.rpm > 0.6; m.blades.visible = v.rpm <= 0.6;
    }
  }
  /** run people over */
  runOver(v, sp, cs, sn) {
    if (sp < 3.5) return; const r = v.kind === 'buggy' ? 1.9 : 2.4;
    for (const a of G.actors) {
      if (a.dead || a === v.driver || a.heli || (a.x - v.x) ** 2 + (a.z - v.z) ** 2 > r * r) continue;
      if (v.kind === 'heli' && Math.abs(a.y + 1 - v.y) > 2.2) continue;
      if ((v.hitT.get(a) || 0) > G.t) continue; v.hitT.set(a, G.t + 1);
      hurt(a, sp * (v.kind === 'buggy' ? 4.5 : 3), { owner: v.driver, kind: 'vehicle', dir: Math.atan2(a.z - v.z, a.x - v.x) });
      const ang = Math.atan2(a.z - v.z, a.x - v.x); a.x += Math.cos(ang) * 1.6; a.z += Math.sin(ang) * 1.6; if (a.st) a.st.flinch = 1;
      if (v.kind === 'buggy') v.speed *= 0.82; Sfx.hit(a.x, a.z);
    }
  }
  damage(v, n, why) {
    if (v.dead) return; v.hp -= n;
    if (v.driver === G.player && G.rend) G.rend.shake = Math.max(G.rend.shake, Math.min(1.4, n / 40));
    if (v.hp <= 0) this.wreck(v, why);
  }
  /** explosions hurt vehicles too */
  blast(x, z, r, dmg) { for (const v of this.list) if (!v.dead && dist(x, z, v.x, v.z) < r + 1.5) this.damage(v, dmg * 1.6 * (1 - dist(x, z, v.x, v.z) / (r + 1.5) * 0.6), 'explosion'); }
  wreck(v) {
    v.dead = true; const P = v.driver;
    if (P) this.exit(P, true);
    v.driver = null; this.scene.remove(v.mesh.root);
    explode(v.x, v.z, { r: 4.5, dmg: 55, struct: 40 }, null, 'hostile');
    if (G.fx) for (let i = 0; i < 6; i++) G.fx.fire(v.x + rand(-1, 1), v.y + 0.6, v.z + rand(-1, 1), 1.2);
    v.respawnAt = G.t + v.K.respawn;
  }
  respawn(v) {
    const i = this.list.indexOf(v); if (i >= 0) this.list.splice(i, 1);
    const s = v.home; if (dist(s.x, s.z, G.player.x, G.player.z) < 60) { v.respawnAt = G.t + 60; this.list.push(v); return; }
    this.spawn(s);
  }
  // ---------------------------------------------------------------- getting in and out
  interacts(p, push) {
    for (const v of this.list) {
      if (v.dead || v.driver) continue; const d = dist(p.x, p.z, v.x, v.z); const reach = v.kind === 'heli' ? 3.4 : 3.0;
      if (d > reach || Math.abs(p.y - v.y) > 2.5) continue;
      push({ s: d * 0.5 - 0.3, kind: 'vehicle', o: { act: 'enter', v }, label: (v.kind === 'heli' ? 'Fly ' : 'Drive ') + v.K.name.toLowerCase() + ' · ' + Math.round(v.fuel) + ' fuel', icon: 'hand' });
    }
  }
  interact(p, o) {
    if (o.act === 'exit') return this.exit(p);
    const v = o.v; if (!v || v.dead || v.driver) return;
    // top up from your pockets
    const room = Math.floor(v.K.fuel * 1.6 - v.fuel), have = p.inv.count('low_fuel');
    if (room > 0 && have > 0) { const n = Math.min(room, have); p.inv.take('low_fuel', n); v.fuel += n; G.ui.toast('Refuelled +' + n + ' low-grade fuel', 'good'); }
    v.driver = p; p.vehicle = v; v.lastYaw = v.yaw; v.rpm = Math.max(v.rpm, v.kind === 'buggy' ? 0.3 : v.rpm);
    if (G.vm) G.vm.hidden = true; document.body.classList.add('driving'); document.body.classList.toggle('flying', v.kind === 'heli');
    Sfx.noise(0.3, 200, 1, 0.15, 'lowpass');
    if (v.fuel <= 0) G.ui.toast('No fuel — find low-grade fuel (oil barrels, crates)', 'bad');
    else G.ui.toast(v.kind === 'heli' ? 'Look to steer · stick/WASD to fly · ▲ climb · ▼ descend (Space / C) · E to get out' : 'Stick/WASD to drive · pull back to brake and reverse · E to get out');
    if (G.onVehicle) G.onVehicle(v);
  }
  exit(p, forced = false) {
    const v = p.vehicle; if (!v) return;
    const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
    let x = v.x + sn * 2.4, z = v.z - cs * 2.4; if (G.phys.overlaps(x, z, 0.4) || !G.W.walkable(x, z)) { x = v.x - sn * 2.4; z = v.z + cs * 2.4; }
    const fall = v.y - G.W.height(x, z);
    p.x = x; p.z = z; p.y = G.build.floorY(x, z); p.eye = 1.62; p.vehicle = null; v.driver = null;
    const sp = Math.hypot(v.vx, v.vz) || Math.abs(v.speed);
    if (!forced && (fall > 4 || sp > 8)) hurt(p, Math.max(0, fall - 4) * 9 + Math.max(0, sp - 8) * 3, { kind: 'fall' });
    if (forced) hurt(p, 25, { kind: 'explosion' });
    if (v.kind === 'buggy') v.speed *= 0.5;
    document.body.classList.remove('driving', 'flying');
  }
  /** minimap / map markers */
  markers() { return this.list.filter(v => !v.dead).map(v => ({ x: v.x, z: v.z, kind: v.kind, yaw: v.yaw, mine: v.driver === G.player })); }
  dispose() { for (const v of this.list) if (!v.dead) this.scene.remove(v.mesh.root); this.list = []; }
}

function Input() { return INPUT; }

/** a vehicle model on its own (for other players' vehicles in co-op) */
export function buildVehicleModel(kind) { const col = COLORS[Math.floor(Math.random() * COLORS.length)]; return kind === 'heli' ? buildHeli(col) : buildBuggy(col); }

// ---------------------------------------------------------------- models (+X forward, y up)
function buildBuggy(col, v) {
  const root = new THREE.Group(), body = new THREE.Group();
  const paint = M.mat(col, { tex: 'metal' }), dark = M.mat('#2a2624', { tex: 'metal' }), black = M.mat('#1c1a1a'), seat = M.mat('#5a3a2a', { tex: 'cloth' }), steel = M.surf('metal');
  M.add(body, M.box(3.7, 0.3, 1.7), dark, 0, 0.55, 0);                        // floor pan
  M.add(body, M.box(1.1, 0.42, 1.75), paint, 1.35, 0.86, 0);                  // nose
  M.add(body, M.box(0.5, 0.3, 1.9), paint, 1.95, 0.7, 0);                     // bumper
  for (const s of [-1, 1]) M.add(body, M.box(2.4, 0.38, 0.14), paint, 0, 0.88, s * 0.9);   // side panels
  M.add(body, M.box(1.0, 0.62, 1.45), dark, -1.45, 1.0, 0);                    // rear engine
  M.add(body, M.cyl(0.08, 0.08, 0.5, 8), steel, -1.95, 1.2, 0.45, { rz: Math.PI / 2 }); // exhaust
  for (const z of [-0.42, 0.42]) { M.add(body, M.box(0.55, 0.14, 0.55), seat, -0.25, 0.78, z); M.add(body, M.box(0.14, 0.62, 0.55), seat, -0.55, 1.12, z); }
  M.add(body, M.cyl(0.03, 0.03, 0.42, 6), black, 0.25, 1.05, -0.42, { rz: 0.9 });          // steering column
  M.add(body, M.cyl(0.17, 0.17, 0.04, 12), black, 0.12, 1.2, -0.42, { rz: Math.PI / 2 - 0.9 }); // wheel
  // roll cage
  const bar = M.mat('#1f1f22', { tex: 'metal' });
  // roll hoop behind the seats + low windscreen frame (kept out of the driver's eye line)
  for (const z of [-0.82, 0.82]) { M.add(body, M.box(0.08, 1.4, 0.08), bar, -0.8, 1.55, z); M.add(body, M.box(0.05, 0.42, 0.05), bar, 0.72, 1.2, z, { rz: -0.4 }); }
  M.add(body, M.box(0.08, 0.08, 1.72), bar, -0.8, 2.24, 0); M.add(body, M.box(0.05, 0.05, 1.7), bar, 0.62, 1.4, 0);
  const lamp = M.basic('#fff6c8'); for (const z of [-0.6, 0.6]) M.add(body, M.box(0.08, 0.16, 0.24), lamp, 1.92, 0.98, z);
  const baked = M.bake(body); root.add(baked);
  // wheels (front ones in steering pivots)
  const wheels = [], pivots = [], tyre = M.mat('#1a1a1c', { tex: 'rock' }), rim = M.mat('#c8c4b8');
  for (const [x, z] of [[1.25, -1.0], [1.25, 1.0], [-1.25, -1.0], [-1.25, 1.0]]) {
    const pv = new THREE.Group(); pv.position.set(x, 0.48, z); root.add(pv);
    const w = new THREE.Group(); pv.add(w);
    M.add(w, M.cyl(0.48, 0.48, 0.36, 14), tyre, 0, 0, 0, { rx: Math.PI / 2 }); M.add(w, M.cyl(0.24, 0.24, 0.38, 8), rim, 0, 0, 0, { rx: Math.PI / 2 });
    wheels.push(w); if (x > 0) pivots.push(pv);
  }
  const lights = new THREE.Group(); root.add(lights);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(2.4, 12, 12, 1, true).rotateZ(Math.PI / 2).translate(8, 0.9, 0), new THREE.MeshBasicMaterial({ color: '#fff3c0', transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  lights.add(cone); lights.visible = false;
  root.traverse(o => { if (o.isMesh && o !== cone) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, wheels, pivots, lights };
}
function buildHeli(col, v) {
  const root = new THREE.Group(), body = new THREE.Group();
  const paint = M.mat(col, { tex: 'metal' }), dark = M.mat('#2a2624', { tex: 'metal' }), black = M.mat('#1c1a1a'), seat = M.mat('#5a3a2a', { tex: 'cloth' });
  M.add(body, M.box(1.9, 0.14, 1.15), dark, 0, 0.72, 0);                     // floor
  M.add(body, M.box(1.9, 0.5, 0.1), paint, 0, 1.02, -0.6); M.add(body, M.box(1.9, 0.5, 0.1), paint, 0, 1.02, 0.6); // tub sides
  M.add(body, M.box(0.7, 0.62, 1.2), paint, 1.15, 1.0, 0);                   // nose
  M.add(body, M.box(0.5, 0.3, 1.0), paint, 1.45, 0.78, 0);
  M.add(body, M.box(0.35, 0.45, 1.25), paint, -0.95, 1.12, 0);                // back wall
  M.add(body, M.box(0.6, 0.12, 0.6), seat, 0.1, 0.86, 0); M.add(body, M.box(0.12, 0.6, 0.6), seat, -0.22, 1.18, 0);
  M.add(body, M.box(0.05, 0.05, 1.1), black, 0.9, 1.42, 0);                   // low dash rail (below the pilot's eye line)
  M.add(body, M.box(0.6, 0.5, 0.6), dark, -0.45, 1.65, 0);                    // engine
  M.add(body, M.cyl(0.08, 0.08, 0.6, 8), black, -0.3, 2.1, 0);                 // mast
  M.add(body, M.box(2.9, 0.22, 0.22), paint, -2.35, 1.25, 0);                 // tail boom
  M.add(body, M.box(0.55, 0.85, 0.06), paint, -3.65, 1.6, 0);                 // fin
  M.add(body, M.box(0.5, 0.06, 0.8), paint, -3.4, 1.28, 0);                   // stabiliser
  for (const z of [-0.68, 0.68]) { M.add(body, M.box(2.4, 0.08, 0.08), black, 0.1, 0.05, z); for (const x of [-0.5, 0.7]) M.add(body, M.box(0.07, 0.7, 0.07), black, x, 0.4, z * 0.85); }
  const baked = M.bake(body); root.add(baked);
  // main rotor: real blades when slow, a translucent disc when spinning fast
  const rotor = new THREE.Group(); rotor.position.set(-0.3, 2.42, 0); root.add(rotor);
  const blades = new THREE.Group(); rotor.add(blades);
  M.add(blades, M.box(7.2, 0.05, 0.26), black, 0, 0, 0); M.add(blades, M.box(0.26, 0.05, 7.2), black, 0, 0, 0);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(3.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#1c1a1a', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  rotor.add(blur); blur.visible = false;
  const tail = new THREE.Group(); tail.position.set(-3.7, 1.62, 0.1); root.add(tail);
  M.add(tail, M.box(0.08, 1.1, 0.06), black, 0, 0, 0); M.add(tail, M.box(1.1, 0.08, 0.06), black, 0, 0, 0);
  root.traverse(o => { if (o.isMesh && o !== blur) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, rotor, blades, blur, tail };
}
