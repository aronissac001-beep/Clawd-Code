// ============================================================================
// ZONEFALL — the nuclear strike's visuals (bunker.js launches it, combat.js
// explode() with a `nuke` def sets it off): the missile's smoke trail and its
// bright exhaust flare, then the blast — a white flash, a fireball, a shockwave
// ring and dome racing out, a dust skirt, a scorched crater and a mushroom cloud
// that rises for half a minute and hangs over the island for a couple more.
//
// The camera's far plane follows the fog (a few hundred metres), but a missile
// and a mushroom cloud have to be seen from anywhere on the island. Everything
// here is drawn at its real place and size, ignores fog and takes the day's
// light instead; its materials go through farDepth(), which clamps the depth of
// anything past the far plane to just inside it (instead of clipping it). So a
// hill that is drawn (nearer than the far plane) still hides the cloud's foot or
// the trail behind it, and what's beyond the drawn world shows against the sky.
// ============================================================================
import { THREE, M } from './materials.js';
import { G } from '../state.js';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _t = V(), _s = V(), _v = V();
/** how far out things are drawn at most */
function d0(cam) { return Math.max(60, Math.min(170, cam.far * 0.5)); }
/** pull P toward the camera if it's past D: writes `out`, returns the scale */
function pull(out, P, cam, D) { out.copy(P).sub(cam); const d = out.length(); if (d <= D) { out.copy(P); return 1; } const k = D / d; out.multiplyScalar(k).add(cam); return k; }
/** draw past the far plane: a vertex beyond it gets the depth of a point just inside it (the sky draws first with no
 *  depth, so it stays behind; anything really drawn in front still hides it). Also switches fog off. */
function farDepth(m) {
  m.fog = false;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      { float pz = projectionMatrix[2][2], pw = projectionMatrix[3][2], fz = pw / (pz + 1.0) * 0.993;
        float zc = -pz + pw / fz; if (gl_Position.z > zc * gl_Position.w) gl_Position.z = zc * gl_Position.w; }`);
  };
  m.customProgramCacheKey = () => 'fardepth';
  return m;
}
/** the day's light on big smoke (dim at night, warm at dusk) */
function skyLight() { const n = G.night || 0; return 0.28 + 0.72 * (1 - n); }

export class NukeFX {
  constructor(scene) {
    this.scene = scene; this.blasts = []; this.trails = []; this.timers = [];
    this.sphere = new THREE.SphereGeometry(1, 18, 12); this.lowSphere = new THREE.SphereGeometry(1, 12, 8);
    this.ringGeo = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);
  }
  // ---------------------------------------------------------------- the missile's trail + flare
  /** a new trail (one per missile in flight). Returns a handle for addPoint / flare / end */
  trail() {
    const geo = new THREE.BufferGeometry(), N = 420;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 4), 4));
    const idx = []; for (let i = 0; i < N - 1; i++) { const v = i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); } geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, farDepth(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide })));
    mesh.frustumCulled = false; mesh.renderOrder = 8; this.scene.add(mesh);
    const flare = new THREE.Mesh(this.lowSphere, farDepth(new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    flare.frustumCulled = false; flare.renderOrder = 9; flare.visible = false; this.scene.add(flare);
    const glow = new THREE.Mesh(this.lowSphere, farDepth(new THREE.MeshBasicMaterial({ color: '#ff8a30', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
    glow.frustumCulled = false; glow.renderOrder = 9; glow.visible = false; this.scene.add(glow);
    const T = { mesh, geo, flare, glow, pts: [], N, live: true, at: null, endT: 0 };
    this.trails.push(T); return T;
  }
  addPoint(T, x, y, z) { T.pts.push({ x, y, z, t: performance.now() / 1000 }); if (T.pts.length > T.N) T.pts.shift(); }
  /** where the missile's exhaust is now (null hides the flare) */
  flare(T, x, y, z) { T.at = x === null ? null : [x, y, z]; }
  end(T) { T.live = false; T.at = null; T.endT = performance.now() / 1000; }
  // ---------------------------------------------------------------- the blast
  blast(x, y, z) {
    const B = { x, y, z, t: 0, group: new THREE.Group(), parts: {}, seed: Math.random() * 100 };
    const g = B.group; g.position.set(x, y, z); this.scene.add(g);
    const lam = (col, o = {}) => { const m = new THREE.MeshLambertMaterial({ color: col, fog: false }); if (o.emissive) m.emissive = new THREE.Color(o.emissive); return m; };
    const add = (geo, mat, ro = 3) => { farDepth(mat); const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = ro; g.add(m); return m; };
    const P = B.parts;
    P.flash = add(this.sphere, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 10);
    P.fireMat = lam('#3a2010', { emissive: '#ffffff' }); P.fire = add(this.sphere, P.fireMat, 4);
    P.dome = add(this.sphere, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false, fog: false, side: THREE.DoubleSide }), 6);
    P.ring = add(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#fff2d8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }), 6);
    // the cloud is made of puffs (a cartoon cauliflower): the cap's rings and crown, a twisting stem, a dust skirt
    P.capMat = lam('#8a6a58', { emissive: '#000000' }); P.rimMat = lam('#7a5c4c', { emissive: '#000000' }); P.stemMat = lam('#76685c', { emissive: '#000000' }); P.skirtMat = lam('#8a7458');
    const puffs = (n, mat) => { const a = []; for (let k = 0; k < n; k++) a.push(add(this.lowSphere, mat)); return a; };
    P.capRing = puffs(10, P.capMat); P.capTop = puffs(6, P.capMat); P.crown = puffs(2, P.capMat); P.rim = puffs(9, P.rimMat);
    P.stem = puffs(13, P.stemMat); P.skirt = puffs(12, P.skirtMat);
    // the scorched ground: a disc that follows the terrain
    B.scorch = this.scorch(x, z);
    this.blasts.push(B);
    return B;
  }
  scorch(x, z) {
    if (!G.W) return null;
    const R = 78, n = 26, pos = [], col = [], idx = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const u = i / n * 2 - 1, v = j / n * 2 - 1, px = x + u * R, pz = z + v * R, d = Math.hypot(u, v);
      pos.push(px, Math.max(G.W.height(px, pz), -0.1) + 0.25 + d * 0.2, pz); const a = Math.max(0, 1 - d) ** 0.6; col.push(0.07, 0.06, 0.05, a * 0.82);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    m.renderOrder = 2; this.scene.add(m); return m;
  }
  /** run fn after `sec` seconds of game frames */
  after(sec, fn) { this.timers.push({ at: sec, fn }); }
  // ---------------------------------------------------------------- tick
  update(dt, cam) {
    for (let i = this.timers.length - 1; i >= 0; i--) { const q = this.timers[i]; q.at -= dt; if (q.at <= 0) { this.timers.splice(i, 1); try { q.fn(); } catch (e) { console.warn('nuke fx', e); } } }
    if (!cam) return;
    const C = cam.position, D = d0(cam), now = performance.now() / 1000, L = skyLight(); this.far = cam.far;
    for (let i = this.trails.length - 1; i >= 0; i--) { const T = this.trails[i]; if (this.drawTrail(T, C, D, now)) { T.mesh.removeFromParent(); T.flare.removeFromParent(); T.glow.removeFromParent(); T.geo.dispose(); T.mesh.material.dispose(); this.trails.splice(i, 1); } }
    for (let i = this.blasts.length - 1; i >= 0; i--) { const B = this.blasts[i]; B.t += dt; if (this.drawBlast(B, C, D, L)) { B.group.removeFromParent(); if (B.scorch) { B.scorch.removeFromParent(); B.scorch.geometry.dispose(); } this.blasts.splice(i, 1); } }
  }
  drawTrail(T, C, D, now) {
    const pts = T.pts, n = pts.length, pos = T.geo.attributes.position.array, col = T.geo.attributes.color.array, L = skyLight();
    const LIFE = 70, age0 = T.live ? 0 : now - T.endT;
    if (!T.live && age0 > LIFE) return true;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)], age = now - p.t;
      _b.set(p.x, p.y, p.z);
      _t.set(q.x - o.x, q.y - o.y, q.z - o.z); _v.copy(_b).sub(C); _s.crossVectors(_t, _v); const sl = _s.length() || 1;
      const width = 3 + Math.min(34, age * 1.3); _s.multiplyScalar(width / 2 / sl);
      pos[w * 6] = _b.x - _s.x; pos[w * 6 + 1] = _b.y - _s.y; pos[w * 6 + 2] = _b.z - _s.z; pos[w * 6 + 3] = _b.x + _s.x; pos[w * 6 + 4] = _b.y + _s.y; pos[w * 6 + 5] = _b.z + _s.z;
      const fade = Math.max(0, 1 - age / LIFE), head = i > n - 6 && T.live ? (n - i) / 6 : 1, a = 0.85 * fade * head, c = (0.9 - Math.min(0.25, age * 0.01)) * L;
      for (const s of [0, 1]) { const b = (w * 2 + s) * 4; col[b] = c; col[b + 1] = c * 0.98; col[b + 2] = c * 0.95; col[b + 3] = a; }
      w++;
    }
    T.geo.setDrawRange(0, Math.max(0, (w - 1) * 6)); T.geo.attributes.position.needsUpdate = true; T.geo.attributes.color.needsUpdate = true;
    if (T.at) {
      _b.set(T.at[0], T.at[1], T.at[2]); const d = _b.distanceTo(C);
      const s = Math.max(1.4, d * 0.0045), fl = 0.85 + Math.random() * 0.3;
      T.flare.visible = T.glow.visible = true; T.flare.position.copy(_b); T.glow.position.copy(_b); T.flare.scale.setScalar(s * fl); T.glow.scale.setScalar(s * 3.2 * fl);
    } else T.flare.visible = T.glow.visible = false;
    return false;
  }
  drawBlast(B, C, D, L) {
    const t = B.t, P = B.parts, g = B.group, END = 180; void D;
    if (t > END) return true;
    // at its real place and size (farDepth keeps the parts past the far plane drawn, behind anything nearer)
    g.position.set(B.x, B.y, B.z); g.scale.setScalar(1); void C;
    const e = (x, tau) => 1 - Math.exp(-x / tau), fade = t > END - 50 ? Math.max(0, (END - t) / 50) : 1, sd = B.seed;
    // the flash
    const fk = Math.max(0, 1 - t / 0.45); P.flash.visible = fk > 0; P.flash.scale.setScalar(20 + t * 260); P.flash.material.opacity = fk;
    // the fireball: white-hot, swelling, cooling through yellow and orange as it rises into the cap
    const fr = 6 + 30 * e(t, 0.8), cy = 30 + 190 * e(t, 10), cr = 22 + 50 * e(t, 8), fy = Math.min(cy, 6 + fr + 60 * e(t, 7));
    P.fire.visible = t < 13; P.fire.scale.setScalar(fr * (t < 9 ? 1 : 1 - (t - 9) / 4.5)); P.fire.position.y = fy;
    const ft = Math.min(1, t / 8); P.fireMat.emissive.setRGB(1, 0.95 - ft * 0.6, 0.8 - ft * 0.75);
    // the shock: a dome and a ground ring racing out at the speed of sound
    const sr = 12 + t * 330; P.dome.visible = t < 1.6; P.dome.scale.set(sr, sr * 0.75, sr); P.dome.material.opacity = 0.32 * Math.max(0, 1 - t / 1.6);
    P.ring.visible = t < 3.2; P.ring.scale.setScalar(sr); P.ring.position.y = 1.5; P.ring.material.opacity = Math.max(0, 1 - t / 3.2);
    // the dust skirt rolling out along the ground
    const kr = 20 + 140 * e(t, 10);
    P.skirt.forEach((q, i) => { const a = i / P.skirt.length * Math.PI * 2 + sd, rr = kr * (0.8 + 0.25 * Math.sin(i * 2.7 + sd)), s = (10 + 22 * e(t, 8)) * (0.8 + 0.3 * Math.sin(i * 1.3)); q.position.set(Math.cos(a) * rr, s * 0.35, Math.sin(a) * rr); q.scale.set(s * 1.3, s * 0.7, s * 1.3); q.visible = t > 0.4 && t < 120; });
    // the stem: puffs from the ground up into the cap, twisting a little, narrowest a third of the way up
    P.stem.forEach((q, i) => { const u = (i + 0.5) / P.stem.length, y = u * (cy - cr * 0.25), w = (8 + 9 * e(t, 6)) * (0.7 + 0.9 * Math.abs(u - 0.35) + (u < 0.12 ? 0.6 : 0)); q.position.set(Math.sin(u * 5 + sd + t * 0.02) * w * 0.25, y, Math.cos(u * 4 + sd) * w * 0.2); q.scale.set(w, Math.max(w, cy / P.stem.length * 0.95), w); q.visible = t > 0.8; });
    // the cap: a ring of big puffs, a smaller ring above it, the crown; a darker rolling rim underneath
    const spin = t * 0.012;
    P.capRing.forEach((q, i) => { const a = i / P.capRing.length * Math.PI * 2 + spin + sd, rr = cr * 0.62; q.position.set(Math.cos(a) * rr, cy + cr * 0.05 * Math.sin(i * 1.9 + sd), Math.sin(a) * rr); q.scale.setScalar(cr * (0.42 + 0.06 * Math.sin(i * 2.3 + sd))); });
    P.capTop.forEach((q, i) => { const a = i / P.capTop.length * Math.PI * 2 - spin * 1.3 + sd * 2, rr = cr * 0.3; q.position.set(Math.cos(a) * rr, cy + cr * 0.34, Math.sin(a) * rr); q.scale.setScalar(cr * (0.4 + 0.05 * Math.sin(i * 3.1))); });
    P.crown.forEach((q, i) => { q.position.set((i - 0.5) * cr * 0.18, cy + cr * (0.6 + 0.04 * i), (i - 0.5) * cr * 0.1); q.scale.setScalar(cr * 0.36); });
    P.rim.forEach((q, i) => { const a = i / P.rim.length * Math.PI * 2 + spin * 2 + 0.3 + sd, rr = cr * 0.78; q.position.set(Math.cos(a) * rr, cy - cr * 0.16, Math.sin(a) * rr); q.scale.set(cr * 0.3, cr * 0.22, cr * 0.3); });
    // colours: glowing orange inside early, then grey-brown smoke in the day's light; it all thins out at the end
    const hot = Math.max(0, 1 - t / 18), hotR = Math.max(0, 1 - t / 30);
    P.capMat.color.setRGB((0.5 + hot * 0.35) * L, (0.42 + hot * 0.1) * L, (0.36 - hot * 0.08) * L); P.capMat.emissive.setRGB(hot * 0.75, hot * 0.32, hot * 0.06);
    P.rimMat.color.setRGB(0.42 * L, 0.34 * L, 0.29 * L); P.rimMat.emissive.setRGB(hotR * 0.85, hotR * 0.28, hotR * 0.04);
    P.stemMat.color.setRGB(0.5 * L, 0.45 * L, 0.4 * L); P.stemMat.emissive.setRGB(hot * 0.35, hot * 0.12, 0);
    P.skirtMat.color.setRGB(0.6 * L, 0.52 * L, 0.4 * L);
    for (const m of [P.capMat, P.rimMat, P.stemMat, P.skirtMat]) { const op = m === P.skirtMat ? fade * Math.max(0, Math.min(1, (120 - t) / 40)) : fade; m.transparent = op < 1; m.opacity = op; m.depthWrite = op >= 1; }
    if (B.scorch) B.scorch.material.opacity = t > 120 ? Math.max(0, 1 - (t - 120) / 60) : 1;
    return false;
  }
}
export { pull, d0, farDepth };
void M;
