// ============================================================================
// ZONEFALL 4 — island infrastructure: bridges where roads and the railway
// cross the rivers, and the power lines strung across the island on steel
// pylons. You can ride the power lines: stand at a pylon, tap ZIPLINE, climb
// up, hook on and slide to the next pylon (and on along the line). Let go
// (jump / E) to drop off; it's a long way down.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Sfx } from './audio.js';
import { WATER_Y } from './world/gen.js';
import { clamp, lerp, dist, angDiff } from './util.js';

const CABLE_Y = 10.6;      // cable height above the pylon base (the zipline cable is the left one)
const SAG = 1.4;           // cable sag at mid-span
const HANG = 1.95;         // feet below the cable while riding
const ARM = 1.9;           // crossarm half-length: the two cables hang at ±ARM

let bridgeFloors = [];     // { x0, z0, ux, uz, len, w, y0, y1 }

// ---------------------------------------------------------------- bridges
function buildBridges(W, scene) {
  bridgeFloors = [];
  const root = new THREE.Group(); root.name = 'bridges';
  const conc = M.surf('concrete'), dark = M.surf('concrete_dark'), steel = M.surf('metal_dark'), plank = M.surf('plank_dark'), rail = M.mat('#c8402e'), yellow = M.surf('yellow_paint');
  for (const b of W.bridges) {
    const dx = b.x1 - b.x0, dz = b.z1 - b.z0, len = Math.hypot(dx, dz); if (len < 2) continue;
    const ux = dx / len, uz = dz / len, yaw = Math.atan2(dz, dx), pitch = Math.atan2(b.y1 - b.y0, len);
    const g = new THREE.Group(); g.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2 + 0.1, (b.z0 + b.z1) / 2); g.rotation.set(0, -yaw, pitch, 'YXZ');
    const L = len + 0.4, w = b.w;
    if (!b.rail) {
      M.add(g, M.box(L, 0.7, w + 0.6), conc, 0, -0.42, 0);                              // deck slab under the road surface
      for (const s of [-1, 1]) { M.add(g, M.box(L, 0.75, 0.35), dark, 0, 0.3, s * (w / 2 + 0.12)); M.add(g, M.box(L, 0.12, 0.38), yellow, 0, 0.72, s * (w / 2 + 0.12)); }
      for (let x = -L / 2 + 1.5; x <= L / 2 - 1.5; x += 3.2) for (const s of [-1, 1]) M.add(g, M.box(0.18, 0.5, 0.18), steel, x, 1.0, s * (w / 2 + 0.12));
      for (const s of [-1, 1]) M.add(g, M.box(L, 0.1, 0.1), rail, 0, 1.25, s * (w / 2 + 0.12));
    } else {
      M.add(g, M.box(L, 0.35, w), plank, 0, -0.28, 0);                                 // timber deck under the sleepers
      for (const s of [-1, 1]) { M.add(g, M.box(L, 1.4, 0.25), steel, 0, -0.9, s * (w / 2 - 0.1)); M.add(g, M.box(L, 0.12, 0.12), rail, 0, 1.05, s * (w / 2 + 0.15)); for (let x = -L / 2 + 1; x <= L / 2 - 1; x += 2.5) M.add(g, M.box(0.12, 1.1, 0.12), steel, x, 0.5, s * (w / 2 + 0.15)); }
    }
    // piers down into the river
    const ybase = WATER_Y - 2.4, mid = (b.y0 + b.y1) / 2 + 0.1;
    for (const f of len > 12 ? [-0.25, 0.25] : [0]) for (const s of [-1, 1]) { const h = mid - 0.7 - ybase; const p = M.add(g, M.box(0.9, h, 0.9), dark, f * L, -0.7 - h / 2, s * (w / 2 - 0.8)); void p; }
    root.add(g);
    bridgeFloors.push({ x0: b.x0, z0: b.z0, ux, uz, len, w: w + 0.4, y0: b.y0 + 0.1, y1: b.y1 + 0.1 });
    // railings: a row of small posts (the physics grid only has axis-aligned boxes and circles)
    for (let s = 0; s <= len; s += 1.0) for (const side of [-1, 1]) {
      const x = b.x0 + ux * s - uz * side * (w / 2 + 0.15), z = b.z0 + uz * s + ux * side * (w / 2 + 0.15), y = lerp(b.y0, b.y1, s / len) + 0.1;
      const c = G.phys.addCircle(x, z, 0.32, { h: 1.2, y0: y, kind: 'fence', opaque: false }); c.ylo = y - 0.2; c.yhi = y + 1.3;
    }
  }
  const baked = M.bake(root); baked.name = 'bridges'; scene.add(baked);
  return baked;
}
/** height of a bridge deck at (x,z) for someone at height y, or null */
function bridgeFloor(x, z, y) {
  let best = null;
  for (const b of bridgeFloors) {
    const rx = x - b.x0, rz = z - b.z0, t = rx * b.ux + rz * b.uz; if (t < -0.5 || t > b.len + 0.5) continue;
    if (Math.abs(-rx * b.uz + rz * b.ux) > b.w / 2) continue;
    const fy = lerp(b.y0, b.y1, clamp(t / b.len, 0, 1)); if (y !== undefined && y < fy - 1.2) continue;
    best = Math.max(best ?? -99, fy);
  }
  return best;
}

// ---------------------------------------------------------------- power lines
function pylonGeo() {
  // a slim steel lattice pylon, origin at the base; crossarm at CABLE_Y + 0.5
  const g = new THREE.Group(), steel = M.surf('metal_dark'), white = M.mat('#e8e0d0');
  const H = CABLE_Y + 1.3;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const leg = M.add(g, M.box(0.16, H, 0.16), steel, sx * 0.55, H / 2, sz * 0.55); leg.rotation.set(sz * 0.045, 0, -sx * 0.045); }
  for (let y = 1.6; y < H - 0.6; y += 1.9) for (const [ax, az, w, d] of [[0, -0.55, 1.1, 0.08], [0, 0.55, 1.1, 0.08], [-0.55, 0, 0.08, 1.1], [0.55, 0, 0.08, 1.1]]) M.add(g, M.box(w * (1 - y / H * 0.35), 0.08, d * (1 - y / H * 0.35) + (d > 1 ? 0 : 0)), steel, ax * (1 - y / H * 0.35), y, az * (1 - y / H * 0.35));
  for (let y = 0.8; y < H - 1.2; y += 1.9) { const x1 = M.add(g, M.box(1.45, 0.06, 0.06), steel, 0, y + 0.95, -0.52); x1.rotation.z = 0.9; const x2 = M.add(g, M.box(1.45, 0.06, 0.06), steel, 0, y + 0.95, 0.52); x2.rotation.z = -0.9; }
  M.add(g, M.box(0.22, 0.22, ARM * 2 + 0.6), steel, 0, CABLE_Y + 0.55, 0);           // crossarm (across the line)
  for (const s of [-1, 1]) { M.add(g, M.cyl(0.09, 0.09, 0.5, 6), white, 0, CABLE_Y + 0.2, s * ARM); }
  M.add(g, M.box(0.5, 0.06, 0.5), M.surf('hazard'), 0, 2.4, 0.62);                    // danger plate
  // a ladder up one face
  for (let y = 0.4; y < CABLE_Y; y += 0.45) M.add(g, M.box(0.5, 0.05, 0.05), steel, 0, y, 0.68);
  for (const s of [-1, 1]) M.add(g, M.box(0.05, CABLE_Y, 0.05), steel, s * 0.25, CABLE_Y / 2, 0.68);
  return M.bake(g);
}
function cableAt(a, b, t) { // a,b = pole entries; returns [x, y, z] on the zipline (left) cable
  const ox = -a.uz * ARM, oz = a.ux * ARM; // cables offset to the left of the line's direction
  const bx = -b.uz * ARM, bz = b.ux * ARM;
  const x = lerp(a.x + ox, b.x + bx, t), z = lerp(a.z + oz, b.z + bz, t);
  const y = lerp(a.y + CABLE_Y, b.y + CABLE_Y, t) - SAG * 4 * t * (1 - t);
  return [x, y, z];
}
function buildPowerlines(W, scene) {
  const lines = [];
  for (const L of W.powerlines || []) {
    const poles = L.pts.map(([x, z, y]) => ({ x, z, y, ux: 1, uz: 0 }));
    for (let i = 0; i < poles.length; i++) { const a = poles[Math.max(0, i - 1)], b = poles[Math.min(poles.length - 1, i + 1)]; const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; poles[i].ux = dx / l; poles[i].uz = dz / l; }
    lines.push({ poles });
  }
  // pylons: one instanced mesh per material
  const proto = pylonGeo(); const meshes = [];
  const all = lines.flatMap(l => l.poles);
  proto.traverse(o => { if (!o.isMesh) return; const im = new THREE.InstancedMesh(o.geometry, o.material, Math.max(1, all.length)); im.castShadow = true; im.receiveShadow = true; meshes.push(im); });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  all.forEach((p, i) => { q.setFromAxisAngle(up, -Math.atan2(p.uz, p.ux)); m4.compose(new THREE.Vector3(p.x, p.y - 0.05, p.z), q, one); for (const im of meshes) im.setMatrixAt(i, m4); });
  for (const im of meshes) { im.count = all.length; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); scene.add(im); }
  // cables: both sides of every span as sagging polylines in one draw call
  const pos = [];
  for (const l of lines) for (let i = 0; i < l.poles.length - 1; i++) {
    const a = l.poles[i], b = l.poles[i + 1];
    for (const side of [1, -1]) {
      const pa = side > 0 ? a : { ...a, ux: -a.ux, uz: -a.uz }, pb = side > 0 ? b : { ...b, ux: -b.ux, uz: -b.uz };
      let prev = cableAt(pa, pb, 0);
      for (let k = 1; k <= 10; k++) { const c = cableAt(pa, pb, k / 10); pos.push(...prev, ...c); prev = c; }
    }
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const cables = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#1a1416' })); cables.frustumCulled = false; scene.add(cables);
  // ground colliders for the pylon footings
  for (const p of all) { const c = G.phys.addCircle(p.x, p.z, 0.75, { h: CABLE_Y + 1, kind: 'pylon', opaque: false }); void c; }
  return { lines, meshes, cables };
}

// ---------------------------------------------------------------- the module
export const Infra = {
  lines: [], objs: [],
  build(W, scene) {
    this.dispose();
    try { this.objs.push(buildBridges(W, scene)); } catch (e) { console.warn('bridges', e); }
    try { const pl = buildPowerlines(W, scene); this.lines = pl.lines; this.objs.push(...pl.meshes, pl.cables); } catch (e) { console.warn('power lines', e); this.lines = []; }
  },
  dispose() { for (const o of this.objs) o.removeFromParent(); this.objs = []; this.lines = []; bridgeFloors = []; },
  floorAt(x, z, y) { return bridgeFloors.length ? bridgeFloor(x, z, y) : null; },
  walkable(x, z) { return bridgeFloors.length ? bridgeFloor(x, z) !== null : false; },
  /** nearest pylon within reach */
  poleNear(x, z, r = 2.8) { let best = null, bd = r * r; for (const l of this.lines) l.poles.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = { line: l, i }; } }); return best; },
  // ---------------------------------------------------------------- zipline
  interacts(p, push) {
    if (p.vehicle) return;
    if (p.zip) { // riding: the button lets go (shows how far you'd fall)
      if (p.zip.phase === 'ride') { const drop = Math.max(0, p.y - G.build.floorY(p.x, p.z, p.y)); push({ s: 0, kind: 'zip', o: { act: 'letgo' }, label: 'Let go · ' + Math.round(drop) + ' m drop' + (drop > 6 ? ' (it will hurt)' : ''), icon: 'hand' }); }
      return;
    }
    const n = this.poleNear(p.x, p.z); if (!n) return;
    const { line, i } = n, P = line.poles[i]; if (Math.abs(p.y - P.y) > 2.5) return;
    // ride toward whichever neighbour pylon is closer to where you're looking
    const opts = []; if (i < line.poles.length - 1) opts.push(1); if (i > 0) opts.push(-1);
    if (!opts.length) return;
    let dir = opts[0], bd = 9;
    for (const d of opts) { const Q = line.poles[i + d]; const a = Math.abs(angDiff(p.yaw ?? p.ang, Math.atan2(Q.z - P.z, Q.x - P.x))); if (a < bd) { bd = a; dir = d; } }
    const Q = line.poles[i + dir], drop = P.y - Q.y;
    let run = 0; for (let k = i; k + dir >= 0 && k + dir < line.poles.length; k += dir) run += dist(line.poles[k].x, line.poles[k].z, line.poles[k + dir].x, line.poles[k + dir].z);
    push({ s: 1.1, kind: 'zip', o: { line, i, dir }, label: 'Zipline ' + (drop > 1.5 ? '↘ downhill' : drop < -1.5 ? '↗ uphill' : '→') + ' · ' + Math.round(run) + ' m of line', icon: 'hand' });
  },
  interact(p, o) {
    if (o.act === 'letgo') { if (p.zip && p.zip.phase === 'ride') this.letGo(p); return; }
    const { line, i, dir } = o; const P = line.poles[i];
    // climb up beside the pylon, then reach out and hook onto the cable
    const side = { x: P.x - P.uz * 0.75 * dir, z: P.z + P.ux * 0.75 * dir }; // the pylon face on the cable's side
    p.zip = { line, i, dir, phase: 'climb', t: 0, y0: p.y, x0: p.x, z0: p.z, sx: side.x, sz: side.z, v: 0 };
    Sfx.tone && Sfx.tone(520, 0.08, 0.05, 'square');
    if (G.ui) G.ui.toast('Climbing up… Jump or E lets go once you ride', 'good'); void P;
  },
  /** the little pulley and handle you hang from (only drawn while riding) */
  trolley() {
    if (this._trolley) return this._trolley;
    const g = new THREE.Group(), steel = M.mat('#2a2c30'), red = M.mat('#d8432f'), grip = M.mat('#1a1416');
    M.add(g, M.cyl(0.12, 0.12, 0.08, 10), steel, 0, 0, 0).rotation.x = Math.PI / 2;
    M.add(g, M.box(0.36, 0.1, 0.05), red, 0, 0.02, 0.06); M.add(g, M.box(0.36, 0.1, 0.05), red, 0, 0.02, -0.06);
    M.add(g, M.box(0.05, 0.62, 0.05), steel, 0, -0.34, 0);
    M.add(g, M.box(0.06, 0.06, 0.7), grip, 0, -0.66, 0);
    this._trolley = g; return g;
  },
  showTrolley(on, x, y, z, yaw) {
    const t = this.trolley();
    if (!on) { if (t.parent) t.removeFromParent(); return; }
    if (t.parent !== G.scene) G.scene.add(t);
    t.position.set(x, y, z); t.rotation.y = -yaw;
  },
  /** called from updatePlayer while on the zipline; returns true when the zipline controls the player */
  ride(p, dt, Input) {
    const Z = p.zip; if (!Z) return false;
    const line = Z.line, P = line.poles[Z.i], Q = line.poles[Z.i + Z.dir];
    if (p.dead || p.vehicle || !Q) { p.zip = null; this.showTrolley(false); return false; }
    const a = Z.dir > 0 ? P : { ...P, ux: -P.ux, uz: -P.uz }, b = Z.dir > 0 ? Q : { ...Q, ux: -Q.ux, uz: -Q.uz };
    if (Z.phase === 'climb') {
      // up the face of the pylon (eased), then out along the crossarm to the cable
      Z.t += dt / 1.5; const k = Math.min(1, Z.t), [cx, cy, cz] = cableAt(a, b, 0);
      if (k < 0.72) { const u = k / 0.72, e = u * u * (3 - 2 * u); const m = Math.min(1, u * 4); p.x = lerp(Z.x0, Z.sx, m); p.z = lerp(Z.z0, Z.sz, m); p.y = lerp(Z.y0, cy - HANG, e); if ((Z.tick = (Z.tick || 0) - dt) <= 0) { Z.tick = 0.22; Sfx.tone && Sfx.tone(180 + Math.random() * 40, 0.04, 0.03, 'square'); } }
      else { const u = (k - 0.72) / 0.28; p.x = lerp(Z.sx, cx, u); p.z = lerp(Z.sz, cz, u); p.y = cy - HANG; }
      p.airY = 0;
      if (Z.t >= 1) { Z.phase = 'ride'; Z.t = 0; Z.v = 4; Sfx.noise && Sfx.noise(0.25, 2200, 1, 0.05, 'highpass'); }
      return true;
    }
    if (Z.phase === 'down') { // end of the line: a controlled slide down the pylon
      p.y = Math.max(Z.floor, p.y - dt * 5.5); p.airY = 0; this.showTrolley(false);
      if (p.y <= Z.floor + 0.01) { p.zip = null; if (G.ui) G.ui.toast('End of the line'); return false; }
      return true;
    }
    if (Input && (Input.pressed.jump || Input.pressed.interact)) { this.letGo(p); return false; }
    // ride: gravity along the cable, light friction; carries you on along the line. Brakes for the last pylon.
    const span = Math.max(1, dist(P.x, P.z, Q.x, Q.z));
    const c0 = cableAt(a, b, Math.max(0, Z.t - 0.01)), c1 = cableAt(a, b, Math.min(1, Z.t + 0.01));
    const grade = (c1[1] - c0[1]) / Math.max(0.01, Math.hypot(c1[0] - c0[0], c1[2] - c0[2]));
    const last = !(Z.i + Z.dir * 2 >= 0 && Z.i + Z.dir * 2 < line.poles.length);
    let vmax = 19; if (last) vmax = Math.max(3, Math.min(19, (1 - Z.t) * span * 0.55 + 3));
    Z.v = clamp(Z.v + (-grade * 9.8 * 0.85 - 0.25 - Z.v * Z.v * 0.0035) * dt + 2.2 * dt, 2.5, 19);
    if (Z.v > vmax) Z.v = Math.max(vmax, Z.v - dt * 9);
    Z.t += Z.v * dt / span;
    if (Z.t >= 1) {
      const next = Z.i + Z.dir;
      if (next + Z.dir >= 0 && next + Z.dir < line.poles.length) { Z.i = next; Z.t = 0; Sfx.noise && Sfx.noise(0.12, 900, 1, 0.08, 'bandpass'); }
      else { // slide down the last pylon (no fall damage)
        const E = line.poles[next], bx = E.x - E.uz * 0.75 * Z.dir, bz = E.z + E.ux * 0.75 * Z.dir;
        p.x = bx; p.z = bz; Z.phase = 'down'; Z.floor = G.build.floorY(bx, bz, E.y + 0.5); return true;
      }
    }
    const [x, y, z] = cableAt(a, b, Math.min(1, Z.t)); p.x = x; p.z = z; p.y = y - HANG; p.airY = 0; p.speedNow = Z.v;
    this.showTrolley(true, x, y, z, Math.atan2(b.z - a.z, b.x - a.x));
    Z.hum = (Z.hum || 0) - dt; if (Z.hum <= 0 && Sfx.noise) { Z.hum = 0.18; Sfx.noise(0.2, 1400 + Z.v * 60, 1, 0.02 + Z.v * 0.002, 'bandpass'); }
    return true;
  },
  /** let go mid-ride: you fall (and get hurt if it's far, unless you land in deep water and swim) */
  letGo(p) {
    this.showTrolley(false);
    let fy = G.build.floorY(p.x, p.z, p.y);
    // over deep water you just drop in and swim (water breaks the fall)
    p.airY = Math.max(0, p.y - fy); p.y = fy; p.vy = 0; p.zip = null; p.zipSoft = false;
  },
};
