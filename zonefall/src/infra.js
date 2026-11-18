// ============================================================================
// ZONEFALL 4 — island infrastructure: bridges where roads and the railway
// cross the rivers, and the power lines strung across the island on steel
// lattice towers. Like the big transmission lines in survival games: climb a
// tower's ladder to its side platform, hook onto the outer cable and ride it
// down to the next tower's platform (downhill or level only). Jump / E lets
// go mid-ride; it's a long way down.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Sfx } from './audio.js';
import { WATER_Y } from './world/gen.js';
import { clamp, lerp, dist, angDiff } from './util.js';

const TH = 16.6;            // tower height
const ARM_Y = 15.6;         // main crossarm
const ATT = 14.7;           // where the cables hang (bottom of the insulators)
const PLAT = 12.7;          // side platform floor
const SIDE = 3.4;           // outer cables' lateral offset (the zipline is the +side one, over the platform)
const SAG = 1.5;            // cable sag at mid-span
const HANG = 1.95;          // feet below the cable while riding
const halfW = y => 1.9 + (0.62 - 1.9) * clamp(y / TH, 0, 1); // lattice half-width at height y
const PL_A = 1.25, PL_L0 = 0.95, PL_L1 = 4.3; // platform: along ±PL_A, lateral PL_L0..PL_L1

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
function towerGeo() {
  // a steel lattice transmission tower; local +x along the line, +z = the platform / zipline side
  const g = new THREE.Group(), steel = M.surf('metal_dark'), grey = M.mat('#9aa3a8'), white = M.mat('#e8e0d0'), grate = M.surf('metal'), haz = M.surf('hazard'), conc = M.surf('concrete');
  const leg = (sx, sz) => { const x0 = sx * 1.9, z0 = sz * 1.9, x1 = sx * 0.62, z1 = sz * 0.62, L = Math.hypot(x1 - x0, TH, z1 - z0); const m = M.add(g, M.box(0.2, L, 0.2), steel, (x0 + x1) / 2, TH / 2, (z0 + z1) / 2); m.rotation.set(Math.atan2(z1 - z0, TH), 0, -Math.atan2(x1 - x0, TH)); };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { leg(sx, sz); M.add(g, M.box(0.7, 0.5, 0.7), conc, sx * 1.9, 0.25, sz * 1.9); }
  for (let y = 1.2; y < TH - 0.4; y += 2.2) { const h = halfW(y); for (const s of [-1, 1]) { M.add(g, M.box(h * 2, 0.1, 0.1), steel, 0, y, s * h); M.add(g, M.box(0.1, 0.1, h * 2), steel, s * h, y, 0); } }
  for (let y = 1.2; y < TH - 2.6; y += 2.2) { const ya = y, yb = y + 2.2, ha = halfW(ya), hb = halfW(yb), hm = (ha + hb) / 2, L = Math.hypot(ha + hb, 2.2), ang = Math.atan2(2.2, ha + hb);
    for (const s of [-1, 1]) for (const d of [-1, 1]) { const a = M.add(g, M.box(L, 0.07, 0.07), grey, 0, (ya + yb) / 2, s * hm); a.rotation.z = d * ang; const b = M.add(g, M.box(0.07, 0.07, L), grey, s * hm, (ya + yb) / 2, 0); b.rotation.x = d * ang; } }
  // crossarm across the line with three insulator strings, and a peak
  M.add(g, M.box(0.5, 0.45, 8.6), steel, 0, ARM_Y, 0);
  for (const s of [-1, 1]) { const br = M.add(g, M.box(0.12, 0.12, 4.2), grey, 0, ARM_Y - 0.9, s * 2.1); br.rotation.x = s * 0.42; }
  for (const z of [-SIDE, SIDE]) { M.add(g, M.cyl(0.13, 0.13, 0.9, 7), white, 0, ARM_Y - 0.45 - 0.22, z); for (let k = 0; k < 4; k++) M.add(g, M.cyl(0.22, 0.22, 0.06, 8), white, 0, ARM_Y - 0.4 - k * 0.2, z); }
  M.add(g, M.box(0.35, 1.4, 0.35), steel, 0, TH + 0.5, 0); M.add(g, M.cyl(0.13, 0.13, 0.9, 7), white, 0, TH + 0.6, 0);
  // the side platform (grated, railed) the zipline leaves from, and the ladder up to it
  M.add(g, M.box(PL_A * 2, 0.12, PL_L1 - PL_L0), grate, 0, PLAT - 0.06, (PL_L0 + PL_L1) / 2);
  for (const z of [PL_L0 + 0.2, (PL_L0 + PL_L1) / 2, PL_L1 - 0.2]) { const st = M.add(g, M.box(0.12, 0.12, 1.6), steel, 0, PLAT - 0.7, z - 0.5); st.rotation.x = 0.7; }
  M.add(g, M.box(PL_A * 2, 0.08, 0.08), haz, 0, PLAT + 1.05, PL_L1); M.add(g, M.box(PL_A * 2, 0.08, 0.08), haz, 0, PLAT + 0.55, PL_L1);
  for (const sx of [-1, 1]) { M.add(g, M.box(0.08, 0.08, PL_L1 - PL_L0), haz, sx * PL_A, PLAT + 1.05, (PL_L0 + PL_L1) / 2); M.add(g, M.box(0.08, 0.08, PL_L1 - PL_L0), haz, sx * PL_A, PLAT + 0.55, (PL_L0 + PL_L1) / 2); }
  for (const [x, z] of [[-PL_A, PL_L1], [PL_A, PL_L1], [-PL_A, PL_L0], [PL_A, PL_L0], [0, PL_L1]]) M.add(g, M.box(0.08, 1.1, 0.08), steel, x, PLAT + 0.55, z);
  for (let y = 0.35; y < PLAT; y += 0.35) M.add(g, M.box(0.62, 0.05, 0.05), steel, 0, y, halfW(y) + 0.12);
  for (const sx of [-1, 1]) for (let y = 0; y < PLAT; y += 1.0) { const L = 1.0, h0 = halfW(y) + 0.12, h1 = halfW(y + 1) + 0.12; const r = M.add(g, M.box(0.06, L, 0.06), steel, sx * 0.3, y + 0.5, (h0 + h1) / 2); r.rotation.x = Math.atan2(h0 - h1, 1) * -1; }
  M.add(g, M.box(0.6, 0.45, 0.04), haz, 0, 2.6, halfW(2.6) + 0.16); // DANGER plate
  return M.bake(g);
}
/** a tower's frame in the world: position, along-line axis (ux,uz) and the platform side (lx,lz) */
function frame(p) { return { x: p.x, z: p.z, y: p.y, ux: p.ux, uz: p.uz, lx: -p.uz, lz: p.ux }; }
const W2 = (P, a, l) => [P.x + P.ux * a + P.lx * l, P.z + P.uz * a + P.lz * l];
/** point on the zipline (the +side cable) between towers a and b, t in 0..1 */
function cableAt(a, b, t) {
  const [ax, az] = W2(a, 0, SIDE), [bx, bz] = W2(b, 0, SIDE);
  return [lerp(ax, bx, t), lerp(a.y + ATT, b.y + ATT, t) - SAG * 4 * t * (1 - t), lerp(az, bz, t)];
}
function buildPowerlines(W, scene) {
  const lines = [];
  for (const L of W.powerlines || []) {
    const poles = L.pts.map(([x, z, y]) => ({ x, z, y, ux: 1, uz: 0 }));
    for (let i = 0; i < poles.length; i++) { const a = poles[Math.max(0, i - 1)], b = poles[Math.min(poles.length - 1, i + 1)]; const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; poles[i].ux = dx / l; poles[i].uz = dz / l; }
    lines.push({ poles: poles.map(frame) });
  }
  const proto = towerGeo(); const meshes = []; const all = lines.flatMap(l => l.poles);
  proto.traverse(o => { if (!o.isMesh) return; const im = new THREE.InstancedMesh(o.geometry, o.material, Math.max(1, all.length)); im.castShadow = true; im.receiveShadow = true; meshes.push(im); });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  all.forEach((p, i) => { q.setFromAxisAngle(up, -Math.atan2(p.uz, p.ux)); m4.compose(new THREE.Vector3(p.x, p.y - 0.05, p.z), q, one); for (const im of meshes) im.setMatrixAt(i, m4); });
  for (const im of meshes) { im.count = all.length; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); scene.add(im); }
  // three cables per span (both outer ones and the earth wire on the peak) in one draw call
  const pos = [];
  for (const l of lines) for (let i = 0; i < l.poles.length - 1; i++) {
    const a = l.poles[i], b = l.poles[i + 1];
    for (const [lat, hy] of [[SIDE, ATT], [-SIDE, ATT], [0, TH + 0.9]]) {
      const pa = W2(a, 0, lat), pb = W2(b, 0, lat); let prev = null;
      for (let k = 0; k <= 12; k++) { const t = k / 12, c = [lerp(pa[0], pb[0], t), lerp(a.y + hy, b.y + hy, t) - (lat ? SAG : SAG * 0.6) * 4 * t * (1 - t), lerp(pa[1], pb[1], t)]; if (prev) pos.push(...prev, ...c); prev = c; }
    }
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const cables = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#1a1416' })); cables.frustumCulled = false; scene.add(cables);
  // feet (between the legs is walkable), platform floors and railings (height bands: they only matter up there)
  for (const p of all) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const [x, z] = W2(p, sx * 1.9, sz * 1.9); const c = G.phys.addCircle(x, z, 0.42, { h: 3, kind: 'pylon', opaque: false, y0: p.y }); c.ylo = p.y - 50; c.yhi = p.y + 3; }
    const [px, pz] = W2(p, 0, PL_L0);
    bridgeFloors.push({ x0: px, z0: pz, ux: p.lx, uz: p.lz, len: PL_L1 - PL_L0, w: PL_A * 2, y0: p.y + PLAT, y1: p.y + PLAT, plat: true });
    const rail = (a, l) => { const [x, z] = W2(p, a, l); const c = G.phys.addCircle(x, z, 0.16, { h: 1.2, kind: 'fence', opaque: false, y0: p.y + PLAT }); c.ylo = p.y + PLAT - 0.3; c.yhi = p.y + PLAT + 1.2; };
    for (let a = -PL_A; a <= PL_A + 0.01; a += 0.42) rail(a, PL_L1 + 0.05);
    for (let l = PL_L0; l <= PL_L1 + 0.01; l += 0.42) { rail(-PL_A - 0.05, l); rail(PL_A + 0.05, l); }
    for (const a of [-1.15, -0.75, 0.75, 1.15]) rail(a, PL_L0 - 0.05); // the tower side, open at the ladder
  }
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
  /** nearest tower within reach of (x, z) */
  towerNear(x, z, r = 7) { let best = null, bd = r * r; for (const l of this.lines) l.poles.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = { line: l, i, p }; } }); return best; },
  /** is (x, y, z) standing on tower p's platform? */
  onPlatform(p, x, z, y) { const dx = x - p.x, dz = z - p.z, a = dx * p.ux + dz * p.uz, l = dx * p.lx + dz * p.lz; return Math.abs(a) < PL_A + 0.1 && l > PL_L0 - 0.1 && l < PL_L1 + 0.1 && Math.abs(y - (p.y + PLAT)) < 0.6; },
  // ---------------------------------------------------------------- ladders and the zipline
  interacts(p, push) {
    if (p.zip || p.ladder || p.vehicle) return;
    const n = this.towerNear(p.x, p.z); if (!n) return;
    const T = n.p, [fx, fz] = W2(T, 0, halfW(0) + 0.55);
    // at the foot of the ladder
    if (Math.abs(p.y - T.y) < 1.2 && (p.x - fx) ** 2 + (p.z - fz) ** 2 < 1.7 * 1.7) { push({ s: 0.9, kind: 'zip', o: { act: 'climb', T }, label: 'Climb the ladder (hold forward)', icon: 'hand' }); return; }
    if (!this.onPlatform(T, p.x, p.z, p.y)) return;
    // on the platform: climb down, or ride to a neighbour that isn't higher up
    const [tx, tz] = W2(T, 0, PL_L0 + 0.3); if ((p.x - tx) ** 2 + (p.z - tz) ** 2 < 1.0) push({ s: 1.4, kind: 'zip', o: { act: 'down', T }, label: 'Climb down', icon: 'hand' });
    const opts = [];
    for (const d of [1, -1]) { const Q = n.line.poles[n.i + d]; if (!Q) continue; if (Q.y > T.y + 0.6) continue; opts.push({ d, Q }); }
    if (!opts.length) { push({ s: 1.6, kind: 'zip', o: { act: 'none' }, label: 'The line runs uphill from here', icon: 'info' }); return; }
    let best = opts[0], bd = 9;
    for (const o of opts) { const a = Math.abs(angDiff(p.yaw ?? p.ang, Math.atan2(o.Q.z - T.z, o.Q.x - T.x))); if (a < bd) { bd = a; best = o; } }
    const drop = T.y - best.Q.y;
    push({ s: 1.0, kind: 'zip', o: { act: 'ride', line: n.line, i: n.i, dir: best.d }, label: 'Ride the zipline ' + (drop > 1.5 ? '↘' : '→') + ' ' + Math.round(dist(T.x, T.z, best.Q.x, best.Q.z)) + ' m', icon: 'hand' });
  },
  interact(p, o) {
    if (o.act === 'climb') { const T = o.T; p.ladder = { T, y: p.y - T.y }; p.airY = 0; p.vy = 0; Sfx.tone && Sfx.tone(300, 0.05, 0.04, 'square'); return; }
    if (o.act === 'down') { const T = o.T; p.ladder = { T, y: PLAT - 0.05 }; return; }
    if (o.act !== 'ride') return;
    const { line, i, dir } = o, T = line.poles[i];
    p.zip = { line, i, dir, phase: 'ride', t: 0, v: 3 }; p.airY = 0;
    const [x, y, z] = cableAt(T, line.poles[i + dir], 0); p.x = x; p.z = z; p.y = y - HANG;
    Sfx.noise && Sfx.noise(0.25, 2200, 1, 0.05, 'highpass');
  },
  /** on a ladder: forward climbs, back goes down, jump lets go. Returns true while the ladder holds the player */
  climb(p, dt, Input) {
    const L = p.ladder; if (!L) return false;
    if (p.dead || p.vehicle) { p.ladder = null; return false; }
    const T = L.T, mv = Input ? Input.moveVec() : { y: 0 };
    if (Input && Input.pressed.jump) { p.ladder = null; this.letGo(p); return false; }
    L.y = clamp(L.y + (mv.y || 0) * 2.6 * dt, 0, PLAT);
    const [x, z] = W2(T, 0, halfW(L.y) + 0.55); p.x = x; p.z = z; p.y = T.y + L.y; p.airY = 0; p.speedNow = Math.abs(mv.y || 0) * 2;
    if ((L.step = (L.step || 0) - Math.abs(mv.y || 0) * dt) < 0) { L.step = 0.35; Sfx.tone && Sfx.tone(160 + Math.random() * 40, 0.04, 0.03, 'square'); }
    if (L.y >= PLAT - 0.01 && (mv.y || 0) > 0.3) { const [px, pz] = W2(T, 0, PL_L0 + 0.75); p.x = px; p.z = pz; p.y = T.y + PLAT; p.ladder = null; return false; } // step off onto the platform
    if (L.y <= 0.01 && (mv.y || 0) < -0.3) { const [px, pz] = W2(T, 0, halfW(0) + 1.1); p.x = px; p.z = pz; p.y = G.build.floorY(px, pz, T.y + 0.3); p.ladder = null; return false; } // (the platform overhead doesn't count)
    return true;
  },
  /** riding the zipline: gravity along the cable; lands on the next tower's platform. Jump / E lets go */
  ride(p, dt, Input) {
    const Z = p.zip; if (!Z) return false;
    const line = Z.line, P = line.poles[Z.i], Q = line.poles[Z.i + Z.dir];
    if (p.dead || p.vehicle || !Q) { p.zip = null; return false; }
    if (Input && (Input.pressed.jump || Input.pressed.interact)) { this.letGo(p); return false; }
    const span = Math.max(1, dist(P.x, P.z, Q.x, Q.z));
    const c0 = cableAt(P, Q, Math.max(0, Z.t - 0.01)), c1 = cableAt(P, Q, Math.min(1, Z.t + 0.01));
    const grade = (c1[1] - c0[1]) / Math.max(0.01, Math.hypot(c1[0] - c0[0], c1[2] - c0[2]));
    Z.v = clamp(Z.v + (-grade * 9.8 * 0.9 - 0.2 - Z.v * Z.v * 0.003) * dt, 3, 21);
    Z.t += Z.v * dt / span;
    if (Z.t >= 1) { // arrive on the next tower's platform
      const [px, pz] = W2(Q, 0, SIDE - 0.4); p.x = px; p.z = pz; p.y = Q.y + PLAT; p.airY = 0; p.zip = null;
      Sfx.noise && Sfx.noise(0.2, 400, 1, 0.12, 'lowpass'); if (G.ui) G.ui.toast(Z.v > 12 ? 'Hard landing on the platform!' : 'Landed on the next tower');
      return false;
    }
    const [x, y, z] = cableAt(P, Q, Z.t); p.x = x; p.z = z; p.y = y - HANG; p.airY = 0; p.speedNow = Z.v;
    Z.hum = (Z.hum || 0) - dt; if (Z.hum <= 0 && Sfx.noise) { Z.hum = 0.16; Sfx.noise(0.2, 1300 + Z.v * 70, 1, 0.02 + Z.v * 0.002, 'bandpass'); }
    return true;
  },
  letGo(p) {
    const fy = G.build.floorY(p.x, p.z, p.y);
    p.airY = Math.max(0, p.y - fy); p.y = fy; p.vy = 0; p.zip = null; p.ladder = null; p.zipSoft = false;
  },
};
