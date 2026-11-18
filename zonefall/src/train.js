// ============================================================================
// ZONEFALL 4 — the island railway. A loop of track through the interior with
// a few halts, and a little freight train that runs it on a timetable:
// cruise, brake into each halt, dwell, sound the horn, pull away.
//   * flatcars are moving decks: climb aboard (E), walk about, ride, shoot,
//     step off at a platform (or jump off anywhere)
//   * the flatcars carry cargo crates that refill as the train runs
//   * people on the line get shoved aside (and hurt if it's moving)
// The train is purely kinematic: cars follow the track by arc length.
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { G } from './state.js';
import { Sfx } from './audio.js';
import { LOOT, ITEMS } from './data.js';
import { Inv } from './inventory.js';
import { Live, rollInto } from './world/live.js';
import { hurt } from './combat.js';
import { clamp, lerp, dist, rand, chance } from './util.js';

const CRUISE = 12, ACC = 1.5, DEC = 1.3, DWELL = 24;
const RAIL_TOP = 0.3;          // rail head above the track profile
const DECK = 1.2;              // flatcar deck above the rail head
const PLAT_TOP = 1.0;          // station platform top above the profile (deck is 0.5 higher)
const HALF_W = 1.45;           // car half width
// car layout from the front: offsets are of each car centre from the train reference (middle flatcar)
const CARS = [
  { type: 'loco', len: 9.2, off: 9.4, deck: false },
  { type: 'flat', len: 8.4, off: 0, deck: true, crates: [[-2.4, -0.45], [2.4, 0.45]] },
  { type: 'flat', len: 8.4, off: -9.0, deck: true, crates: [[-2.6, 0.5]], bench: true },
];

export class Railway {
  constructor(W, scene) {
    this.W = W; this.scene = scene; const R = W.railway;
    this.pts = R.pts; this.hs = R.hs; this.n = R.pts.length; this.L = R.len; this.step = R.len / this.n;
    this.group = new THREE.Group(); this.group.name = 'railway'; scene.add(this.group);
    this.buildTrack();
    this.stations = W.stations.map(s => ({ ...s, s: s.i * this.step }));
    this.platforms = [];
    this.buildStations();
    // timetable: start dwelling at the first halt
    this.next = 0; this.s = this.stations.length ? this.stations[0].s : 0; this.v = 0; this.state = 'dwell'; this.t = DWELL * 0.6;
    this.cars = CARS.map(c => this.buildCar(c));
    this.light = { x: 0, y: 0, z: 0, color: '#fff2c0', intensity: 2.2, range: 22, night: true, train: true }; G.lights.push(this.light);
    this.rumbleT = 0; this.smokeT = 0;
    this.place(); for (const c of this.cars) { c.px = c.x; c.pz = c.z; c.pyaw = c.yaw; c.py = c.y; }
  }
  // ---------------------------------------------------------------- track sampling
  /** position on the loop at arc length s: {x, z, y (rail head), ang} */
  sample(s, out = {}) {
    const L = this.L; s = ((s % L) + L) % L;
    const f = s / this.step, i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    const a = this.pts[i], b = this.pts[j];
    out.x = lerp(a[0], b[0], t); out.z = lerp(a[1], b[1], t); out.y = lerp(this.hs[i], this.hs[j], t) + RAIL_TOP;
    out.ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    return out;
  }
  // ---------------------------------------------------------------- meshes
  buildTrack() {
    const P = this.pts, n = this.n, hs = this.hs;
    const norm = i => { const a = P[(i - 1 + n) % n], b = P[(i + 1) % n]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
    // a closed strip with a top and two sides: off = lateral centre, w = width, y0/y1 = bottom/top above the profile
    const strip = (off, w, y0, y1, uvScale = 1) => {
      const pos = [], uv = [], idx = []; let acc = 0;
      for (let i = 0; i <= n; i++) {
        const k = i % n, [nx, nz] = norm(k), [x, z] = P[k], h = hs[k];
        if (i > 0) acc += this.step;
        const lx = x + nx * (off - w / 2), lz = z + nz * (off - w / 2), rx = x + nx * (off + w / 2), rz = z + nz * (off + w / 2);
        pos.push(lx, h + y1, lz, rx, h + y1, rz, lx, h + y0, lz, rx, h + y0, rz);
        uv.push(0, acc / uvScale, w / uvScale, acc / uvScale, 0, acc / uvScale, 0, acc / uvScale);
        if (i > 0) { const a = (i - 1) * 4, b = i * 4; idx.push(a, b, a + 1, a + 1, b, b + 1, a + 2, b + 2, a, a, b + 2, b, a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere(); return g;
    };
    const bed = new THREE.Mesh(strip(0, 3.4, -0.15, 0.1, 3), M.surf('gravel')); bed.receiveShadow = true; this.group.add(bed);
    const steel = M.mat('#5d5650', { tex: 'metal' });
    for (const o of [-0.72, 0.72]) { const r = new THREE.Mesh(strip(o, 0.09, 0.1, RAIL_TOP, 2), steel); r.castShadow = false; this.group.add(r); }
    // sleepers every ~0.9 m (instanced)
    const per = Math.max(1, Math.round(this.step / 0.9)), count = n * per;
    const sl = new THREE.InstancedMesh(M.box(0.24, 0.12, 2.5, 1), M.surf('plank_dark'), count);
    const d = new THREE.Object3D(); let k = 0;
    for (let i = 0; i < n; i++) for (let q = 0; q < per; q++) {
      const p = this.sample(i * this.step + q * this.step / per); d.position.set(p.x, p.y - RAIL_TOP + 0.14, p.z); d.rotation.set(0, -p.ang, 0); d.updateMatrix(); sl.setMatrixAt(k++, d.matrix);
    }
    sl.instanceMatrix.needsUpdate = true; sl.computeBoundingSphere(); sl.receiveShadow = true; this.group.add(sl);
  }
  buildStations() {
    const conc = M.surf('concrete'), dark = M.surf('concrete_dark'), roofM = M.surf('corrugated_red'), post = M.surf('metal_dark'), yellow = M.mat('#ffc928');
    for (const st of this.stations) {
      const p = this.sample(st.s); const ang = p.ang, side = st.side, base = p.y - RAIL_TOP;
      const nx = -Math.sin(ang) * side, nz = Math.cos(ang) * side, tx = Math.cos(ang), tz = Math.sin(ang);
      const g = new THREE.Group(); // built in its own frame, merged, and only then moved into place (merging bakes in transforms)
      // local frame: +X along the track, +Z towards the platform side (flip by side)
      const L = (x, y, z) => [x, y, z * side];
      const add = (geo, mat, x, y, z) => M.add(g, geo, mat, ...L(x, y, z));
      const W0 = 1.7, PW = 3.4, PL = 22;            // inner edge, width, length
      add(M.box(PL, PLAT_TOP + 0.1, PW, 2), conc, 0, (PLAT_TOP - 0.1) / 2, W0 + PW / 2);
      add(M.box(PL - 0.2, 2.5, PW - 0.2, 2), dark, 0, -1.3, W0 + PW / 2); // footing down into the ground
      add(M.box(PL, 0.06, 0.25), yellow, 0, PLAT_TOP + 0.01, W0 + 0.2);       // safety line
      for (const sx of [-1, 1]) add(M.box(1.6, 0.5, PW, 2), dark, sx * (PL / 2 + 0.8), 0.25, W0 + PW / 2); // steps
      // shelter
      for (const sx of [-3.2, 3.2]) for (const sz of [W0 + 1.0, W0 + 3.1]) add(M.box(0.16, 2.6, 0.16), post, sx, PLAT_TOP + 1.3, sz);
      add(M.box(7.6, 0.14, 2.8), roofM, 0, PLAT_TOP + 2.66, W0 + 2.05);
      add(M.box(3.4, 0.12, 0.5), M.surf('plank'), 0, PLAT_TOP + 0.45, W0 + 2.9);
      add(M.box(0.12, 0.45, 0.12), post, -1.4, PLAT_TOP + 0.22, W0 + 2.9); add(M.box(0.12, 0.45, 0.12), post, 1.4, PLAT_TOP + 0.22, W0 + 2.9);
      // name board
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: signTex(st.name), side: THREE.DoubleSide }));
      sign.position.set(...L(-6.5, PLAT_TOP + 2.3, W0 + PW - 0.2)); g.add(sign);
      add(M.box(0.12, 2.3, 0.12), post, -7.8, PLAT_TOP + 1.15, W0 + PW - 0.2); add(M.box(0.12, 2.3, 0.12), post, -5.2, PLAT_TOP + 1.15, W0 + PW - 0.2);
      const lamp = add(M.box(0.3, 0.2, 0.3), M.basic('#ffe9a0'), 0, PLAT_TOP + 2.5, W0 + 2.05); lamp.castShadow = false;
      const baked = M.bake(g); g.clear(); g.add(baked); g.add(sign);
      g.position.set(p.x, base, p.z); g.rotation.y = -ang; this.group.add(g);
      // gameplay: walkable platform, light, loot
      const cx = p.x + nx * (W0 + PW / 2), cz = p.z + nz * (W0 + PW / 2);
      const plat = { cx, cz, ang, hl: PL / 2 + 1.6, hw: PW / 2, y: base + PLAT_TOP, st };
      this.platforms.push(plat); st.plat = plat;
      G.lights.push({ x: p.x + nx * (W0 + 2), y: base + PLAT_TOP + 2.4, z: p.z + nz * (W0 + 2), color: '#ffd9a0', intensity: 1.3, range: 12, night: true });
      {
        const spots = [[-9, W0 + 2.6, 'crate'], [8.6, W0 + 2.8, chance(0.5) ? 'toolbox' : 'food'], [-2.6, W0 + 3.0, 'barrel'], [9.6, W0 + 1.2, 'barrel']];
        for (const [a, o, type] of spots) Live.addContainer({ type, x: p.x + tx * a + nx * o, z: p.z + tz * a + nz * o, ry: -ang + rand(-0.3, 0.3) });
      }
    }
  }
  buildCar(def) {
    const g = new THREE.Group(); const L = def.len;
    const red = M.mat('#d8432f'), cream = M.mat('#f2e2b8'), black = M.mat('#24201f', { tex: 'metal' }), yellow = M.mat('#ffc928'), steel = M.surf('metal'), plank = M.surf('plank');
    const wheels = (z0) => { for (const ax of [-L / 2 + 1.3, -L / 2 + 2.5, L / 2 - 2.5, L / 2 - 1.3]) for (const s of [-1, 1]) M.add(g, M.cyl(0.42, 0.42, 0.16, 12), black, ax, 0.42 - RAIL_TOP + 0.3, s * 0.72 + z0, { rx: Math.PI / 2 }); };
    wheels(0);
    for (const bx of [-L / 2 + 1.9, L / 2 - 1.9]) M.add(g, M.box(2.2, 0.35, 2.2), black, bx, 0.62, 0);   // bogies
    M.add(g, M.box(L, 0.3, 2.5), black, 0, 0.92, 0);                                                    // frame
    for (const ex of [-L / 2 - 0.15, L / 2 + 0.15]) M.add(g, M.box(0.3, 0.25, 0.4), black, ex, 0.9, 0); // couplers
    if (def.type === 'loco') {
      M.add(g, M.box(L - 3.2, 1.9, 2.3), red, -1.0, 2.05, 0);                 // long hood
      M.add(g, M.box(L - 3.25, 0.22, 2.36), cream, -1.0, 2.7, 0);             // livery band
      M.add(g, M.box(2.9, 2.9, 2.7), red, L / 2 - 1.5, 2.55, 0);              // cab
      M.add(g, M.box(3.0, 0.2, 2.9), black, L / 2 - 1.5, 4.08, 0);            // cab roof
      for (const s of [-1, 1]) M.add(g, M.box(1.6, 0.9, 0.06), M.mat('#9fd8f0'), L / 2 - 1.5, 3.1, s * 1.36); // windows
      M.add(g, M.box(0.06, 0.9, 2.1), M.mat('#9fd8f0'), L / 2 + 0.01, 3.1, 0);
      M.add(g, M.cyl(0.22, 0.28, 0.9, 10), black, -L / 2 + 2.0, 3.4, 0);      // exhaust stack
      M.add(g, M.box(0.6, 0.4, 2.5), yellow, -L / 2 + 0.1, 1.2, 0);            // nose stripe (front is -X... set below)
      const head = M.add(g, M.box(0.12, 0.34, 0.34), M.basic('#fff6c8'), -L / 2 - 0.02, 2.0, 0); head.castShadow = false;
      for (const s of [-1, 1]) M.add(g, M.box(0.5, 0.5, 0.1), yellow, -L / 2 + 0.3, 1.25, s * 1.0);
    } else {
      M.add(g, M.box(L, 0.18, 2.8), plank, 0, 1.11, 0);                       // deck
      for (const s of [-1, 1]) M.add(g, M.box(L, 0.32, 0.12), red, 0, 1.36, s * 1.36);  // low side rails
      for (const ex of [-1, 1]) M.add(g, M.box(0.12, 0.32, 2.8), red, ex * (L / 2 - 0.06), 1.36, 0);
      for (const s of [-1, 1]) for (const x of [-L / 2 + 0.3, 0, L / 2 - 0.3]) M.add(g, M.box(0.1, 0.5, 0.1), black, x, 1.45, s * 1.36);
      if (def.bench) { M.add(g, M.box(3.2, 0.12, 0.6), plank, 2.0, 1.62, 0.6); M.add(g, M.box(3.2, 0.6, 0.1), plank, 2.0, 1.92, 0.88); }
    }
    const baked = M.bake(g); baked.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const root = new THREE.Group(); root.add(baked); this.scene.add(root);
    const car = { def, root, x: 0, z: 0, y: 0, yaw: 0, px: 0, pz: 0, py: 0, pyaw: 0, crates: [] };
    for (const [cx, cz] of def.crates || []) {
      const crate = new THREE.Group(); M.add(crate, M.box(1.1, 0.8, 0.9, 1.2), M.mat('#5e6a3c', { tex: 'metal' }), 0, 0.4, 0); M.add(crate, M.box(1.14, 0.12, 0.94), M.mat('#2c2a26'), 0, 0.82, 0);
      const cm = M.bake(crate); cm.position.set(-cx, DECK + 0.02, -cz); root.add(cm); // model is flipped (nose at -X)
      car.crates.push({ lx: cx, lz: cz, inv: null, mesh: cm });
    }
    return car;
  }
  // ---------------------------------------------------------------- simulation
  place() {
    const a = {}, b = {};
    for (const c of this.cars) {
      const L = c.def.len, s = this.s + c.def.off;
      this.sample(s + L * 0.32, a); this.sample(s - L * 0.32, b);          // bogie points
      c.x = (a.x + b.x) / 2; c.z = (a.z + b.z) / 2; c.y = (a.y + b.y) / 2;
      c.yaw = Math.atan2(a.z - b.z, a.x - b.x); c.pitch = Math.atan2(a.y - b.y, Math.hypot(a.x - b.x, a.z - b.z));
      c.root.position.set(c.x, c.y, c.z); // model y is relative to the rail head
      // models are built facing -X = forward for the loco nose; flip so +X of the model points backwards
      c.root.rotation.set(0, -c.yaw + Math.PI, 0); c.root.rotateZ(-c.pitch);
    }
  }
  update(dt) {
    if (!this.stations.length) return;
    const st = this.stations[this.next];
    if (this.state === 'dwell') {
      this.v = 0; this.t -= dt;
      if (this.t < 3 && !this.honked) { this.honked = true; this.horn(); }
      if (this.t <= 0) { this.state = 'run'; this.honked = false; this.depart(); }
    } else {
      let d = ((st.s - this.s) % this.L + this.L) % this.L; if (d > this.L - 1) d = 0;
      const want = Math.min(CRUISE, Math.sqrt(2 * DEC * Math.max(0, d - 0.2)));
      this.v += clamp(want - this.v, -DEC * 1.6 * dt, ACC * dt);
      this.s += this.v * dt;
      if (d < 0.4 && this.v < 0.6) { this.s = st.s; this.state = 'dwell'; this.t = DWELL; this.arrive(st); }
    }
    for (const c of this.cars) { c.px = c.x; c.pz = c.z; c.pyaw = c.yaw; c.py = c.y; }
    this.place();
    this.carry(dt);
    this.shove(dt);
    this.effects(dt);
  }
  depart() {
    // cargo restocks between stops
    for (const c of this.cars) for (const k of c.crates) if ((!k.inv || k.inv.empty()) && chance(0.55)) k.inv = null;
    this.next = (this.next + 1) % this.stations.length;
  }
  arrive(st) {
    const p = G.player; if (p && dist(p.x, p.z, st.x, st.z) < 70) G.ui.toast('Train at ' + st.name + ' — it leaves in ' + DWELL + ' s');
    if (this.riding(p)) G.ui.toast('Arriving at ' + st.name);
  }
  horn() { const p = G.player; if (!p) return; const v = Sfx.vol(this.cars[0].x, this.cars[0].z, 220); if (v > 0.02) { Sfx.tone(196, 1.2, 0.3 * v, 'sawtooth', 0, 1.0); Sfx.tone(247, 1.2, 0.22 * v, 'sawtooth', 0, 1.0); } }
  /** the car whose deck the actor stands on */
  riding(a) {
    if (!a || a.dead) return null;
    for (const c of this.cars) if (c.def.deck) { const top = c.y + DECK; if (Math.abs(a.y - top) < 0.6 && this.inCar(c, a.x, a.z, -0.05)) return c; }
    return null;
  }
  inCar(c, x, z, pad = 0, yaw = c.yaw, cx = c.x, cz = c.z) {
    const dx = x - cx, dz = z - cz, cs = Math.cos(yaw), sn = Math.sin(yaw);
    const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
    return Math.abs(lx) < c.def.len / 2 + pad && Math.abs(lz) < HALF_W + pad;
  }
  /** move whoever stands on a flatcar along with it */
  carry() {
    const riders = [G.player, ...G.actors.filter(a => a.bot && !a.dead)];
    for (const a of riders) {
      if (!a || a.dead) continue;
      for (const c of this.cars) {
        if (!c.def.deck) continue;
        if (Math.abs(a.y - (c.py + DECK)) > 0.6 || !this.inCar(c, a.x, a.z, 0.05, c.pyaw, c.px, c.pz)) continue;
        const dx = a.x - c.px, dz = a.z - c.pz, cs = Math.cos(c.pyaw), sn = Math.sin(c.pyaw);
        const lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs, nc = Math.cos(c.yaw), ns = Math.sin(c.yaw);
        a.x = c.x + lx * nc - lz * ns; a.z = c.z + lx * ns + lz * nc; a.y += c.y - c.py;
        const dyaw = c.yaw - c.pyaw; if (a === G.player) a.yaw += dyaw; a.ang = (a.ang || 0) + dyaw;
        a.onTrain = c; break;
      }
    }
  }
  /** keep people on the ground out of the cars; hurt them if the train is moving */
  shove(dt) {
    const fast = this.v > 2.5;
    const hit = (a) => {
      if (a.dead || a.heli) return;
      for (const c of this.cars) {
        if ((a.x - c.x) ** 2 + (a.z - c.z) ** 2 > 60) continue;
        const top = c.y + (c.def.deck ? DECK : 4);
        if (a.y > top - 0.7) continue; // standing on it
        const r = a.r || 0.4; const dx = a.x - c.x, dz = a.z - c.z, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
        let lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs; const hl = c.def.len / 2 + r, hw = HALF_W + r;
        if (Math.abs(lx) >= hl || Math.abs(lz) >= hw) continue;
        // push out along the shortest way (usually sideways)
        if (hw - Math.abs(lz) < hl - Math.abs(lx)) lz = Math.sign(lz || 1) * (hw + 0.02); else lx = Math.sign(lx || 1) * (hl + 0.02);
        a.x = c.x + lx * cs - lz * sn; a.z = c.z + lx * sn + lz * cs;
        if (fast && !(a.trainHitT > G.t)) {
          a.trainHitT = G.t + 1.2;
          hurt(a, 18 + this.v * 2.5, { kind: 'train', owner: null, dir: Math.atan2(lz, lx) });
          if (a === G.player && G.rend) G.rend.shake = Math.max(G.rend.shake, 1);
          Sfx.noise(0.25, 300, 1, 0.4 * Sfx.vol(a.x, a.z, 40), 'lowpass');
        }
      }
    };
    if (G.player) hit(G.player);
    for (const a of G.actors) if (a !== G.player && (a.x - this.cars[1].x) ** 2 + (a.z - this.cars[1].z) ** 2 < 900) hit(a);
  }
  effects(dt) {
    const loco = this.cars[0];
    // headlight follows the nose
    const fx = Math.cos(loco.yaw), fz = Math.sin(loco.yaw);
    this.light.x = loco.x + fx * 6; this.light.z = loco.z + fz * 6; this.light.y = loco.y + 1.8;
    const p = G.player; if (!p) return;
    const d2 = (p.x - loco.x) ** 2 + (p.z - loco.z) ** 2;
    if (d2 < 140 * 140 && this.v > 0.5) {
      this.rumbleT -= dt; if (this.rumbleT <= 0) { this.rumbleT = 0.42; Sfx.noise(0.5, 120 + this.v * 8, 1, 0.12 * Sfx.vol(loco.x, loco.z, 140) * Math.min(1, this.v / 6), 'lowpass'); }
      // clickety-clack
      this.clackS = (this.clackS || 0) + this.v * dt; if (this.clackS > 9) { this.clackS = 0; Sfx.noise(0.06, 900, 2, 0.08 * Sfx.vol(loco.x, loco.z, 70), 'bandpass'); }
    }
    if (d2 < 200 * 200 && G.fx) {
      this.smokeT -= dt * (this.v > 0.5 ? 1 : 0.3);
      if (this.smokeT <= 0) { this.smokeT = 0.18; const sx = loco.x - fx * 2.6, sz = loco.z - fz * 2.6; G.fx.emit({ x: sx, y: loco.y + 3.6, z: sz, vx: -fx * this.v * 0.5 + rand(-0.3, 0.3), vy: 1.4, vz: -fz * this.v * 0.5 + rand(-0.3, 0.3), life: 2.2, size: 0.5, size1: 2.4, r: 0.32, g: 0.3, b: 0.3, a: 0.45, a1: 0 }); }
    }
  }
  // ---------------------------------------------------------------- queries for the rest of the game
  /** floor under (x,z) from the train decks / station platforms, or null. y = who's asking (ignore decks far above them) */
  floorAt(x, z, y) {
    let best = null;
    for (const c of this.cars) {
      if (!c.def.deck || (x - c.x) ** 2 + (z - c.z) ** 2 > 40) continue;
      const top = c.y + DECK; if (y !== undefined && y < top - 0.9) continue;
      if (this.inCar(c, x, z)) best = Math.max(best ?? -99, top);
    }
    for (const P of this.platforms) {
      if ((x - P.cx) ** 2 + (z - P.cz) ** 2 > 200) continue;
      if (y !== undefined && y < P.y - 1.15) continue;
      const dx = x - P.cx, dz = z - P.cz, cs = Math.cos(P.ang), sn = Math.sin(P.ang);
      if (Math.abs(dx * cs + dz * sn) < P.hl && Math.abs(-dx * sn + dz * cs) < P.hw) best = Math.max(best ?? -99, P.y);
    }
    return best;
  }
  /** interaction prompts near the train */
  interacts(p, push) {
    const onCar = this.riding(p);
    for (const c of this.cars) {
      if (!c.def.deck || (p.x - c.x) ** 2 + (p.z - c.z) ** 2 > 80) continue;
      if (onCar === c) {
        for (const k of c.crates) {
          const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), wx = c.x + k.lx * cs - k.lz * sn, wz = c.z + k.lx * sn + k.lz * cs;
          const d = dist(p.x, p.z, wx, wz); if (d < 1.9) push({ s: d * 0.6 - 0.2, kind: 'train', o: { act: 'cargo', car: c, crate: k }, label: 'Open cargo crate', icon: 'stash' });
        }
        // step off sideways (to the platform side if stopped at one)
        push({ s: 2.6, kind: 'train', o: { act: 'off', car: c }, label: 'Step off the train', icon: 'hand' });
      } else if (!onCar && this.inCar(c, p.x, p.z, 1.6) && p.y < c.y + DECK - 0.6) {
        push({ s: 0.5, kind: 'train', o: { act: 'board', car: c }, label: this.v > 0.5 ? 'Jump aboard' : 'Climb aboard', icon: 'hand' });
      }
    }
  }
  interact(p, o) {
    const c = o.car, cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    if (o.act === 'board') {
      if (this.v > 7) { G.ui.toast('Too fast to jump on!', 'bad'); return; }
      const dx = p.x - c.x, dz = p.z - c.z; let lx = dx * cs + dz * sn, lz = -dx * sn + dz * cs;
      lx = clamp(lx, -c.def.len / 2 + 0.6, c.def.len / 2 - 0.6); lz = clamp(lz, -HALF_W + 0.55, HALF_W - 0.55);
      p.x = c.x + lx * cs - lz * sn; p.z = c.z + lx * sn + lz * cs; p.y = c.y + DECK; p.airY = 0; p.vy = 0;
      Sfx.step(); if (G.onTrainBoard) G.onTrainBoard();
    } else if (o.act === 'off') {
      const dx = p.x - c.x, dz = p.z - c.z; const lz = -dx * sn + dz * cs;
      let side = Math.sign(lz) || 1;
      const st = this.state === 'dwell' ? this.stations[this.next] : null;
      if (st && st.plat) { const px = st.plat.cx - c.x, pz = st.plat.cz - c.z; side = Math.sign(-px * sn + pz * cs) || side; }
      const off = HALF_W + 0.7, lx = clamp(dx * cs + dz * sn, -c.def.len / 2 + 1, c.def.len / 2 - 1);
      p.x = c.x + lx * cs - side * off * sn; p.z = c.z + lx * sn + side * off * cs;
      p.y = G.build.floorY(p.x, p.z); if (this.v > 4) hurt(p, this.v * 1.5, { kind: 'fall' });
    } else if (o.act === 'cargo') {
      const k = o.crate; if (!k.inv) { k.inv = new Inv(12); rollInto(k.inv, LOOT[chance(0.25) ? 'military' : chance(0.5) ? 'ammobox' : 'crate'] || LOOT.crate); }
      G.ui.openLoot(k.inv, 'Cargo crate', null, 0.4);
    }
  }
  /** for the HUD map */
  mapInfo() { const c = this.cars[1]; return { x: c.x, z: c.z, ang: this.cars[0].yaw, next: this.stations[this.next], state: this.state, t: this.t }; }
  dispose() {
    this.scene.remove(this.group); for (const c of this.cars) this.scene.remove(c.root);
    const i = G.lights.indexOf(this.light); if (i >= 0) G.lights.splice(i, 1);
  }
}

function signTex(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#1f3a5c'; g.fillRect(0, 0, 256, 64); g.strokeStyle = '#f2e2b8'; g.lineWidth = 5; g.strokeRect(4, 4, 248, 56);
  g.fillStyle = '#f2e2b8'; g.font = 'italic 900 32px "Avenir Next Condensed","Arial Black",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name.toUpperCase(), 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
void ITEMS;
