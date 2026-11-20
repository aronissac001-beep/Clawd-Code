// ============================================================================
// ZONEFALL 3 — effects: CPU particles (one Points cloud), projectile meshes,
// muzzle flashes, explosions with flash lights, ground decals, debris,
// thrown item meshes, smoke, rising sparks.
// ============================================================================
import { THREE, M } from './materials.js';
import { G } from '../state.js';
import { NukeFX } from './fx_nuke.js';

const MAXP = 1400;
const _dir = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0);
function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    // ---- particles: two clouds (normal blend for dust/smoke/blood, additive for sparks/fire)
    this.clouds = [this.makeCloud(false), this.makeCloud(true)];
    // ---- projectile pools
    this.pools = { bullet: [], arrow: [], rocket: [] };
    this.tracerMat = M.basic('#ffe6a0', { additive: true });
    this.arrowMat = M.mat('#9a7448');
    this.stuck = []; // arrows stuck in the world
    // ---- flashes / lights
    this.flashes = []; // {mesh, t, life}
    this.flashMat = M.basic('#ffd27a', { additive: true });
    this.lights = []; // temp light sources {x,y,z,color,intensity,range,t,life}
    // ---- decals
    this.decals = [];
    this.decalMats = { blood: M.basic('#5a1010', { transparent: true, opacity: 0.6 }), scorch: M.basic('#141210', { transparent: true, opacity: 0.55 }) };
    this.decalGeo = new THREE.CircleGeometry(0.5, 10).rotateX(-Math.PI / 2);
    this.ring = null;
    this.debrisList = [];
    this.thrown = [];
    this.nukes = new NukeFX(scene); // the nuclear strike: missile trails, the blast, the mushroom cloud (fx_nuke.js)
  }
  makeCloud(additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAXP * 3), col = new Float32Array(MAXP * 4), size = new Float32Array(MAXP);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: softTex() }, scale: { value: innerHeight * 0.9 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(size * scale / -mv.z, 180.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec4 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = additive ? 6 : 5; this.scene.add(pts);
    return { pts, geo, pos, col, size, P: [], additive };
  }
  /** emit a particle: o = {x,y,z, vx,vy,vz, life, size, size1, r,g,b, a, a1, grav, drag, add} */
  emit(o) {
    const c = this.clouds[o.add ? 1 : 0]; if (c.P.length >= MAXP) c.P.shift();
    c.P.push(Object.assign({ vx: 0, vy: 0, vz: 0, life: 1, t: 0, size: 0.2, size1: null, r: 1, g: 1, b: 1, a: 1, a1: 0, grav: 0, drag: 0 }, o));
  }
  burst(n, f) { for (let i = 0; i < n; i++) this.emit(f(i)); }
  // ---------------------------------------------------------------- presets
  impact(x, y, z, kind, nx = 0, nz = 0) {
    const C = { dust: [0.62, 0.56, 0.46], stone: [0.6, 0.6, 0.58], wood: [0.55, 0.38, 0.22], metal: [1, 0.85, 0.5], blood: [0.55, 0.06, 0.05], snow: [0.95, 0.96, 1], water: [0.82, 0.92, 0.98] }[kind] || [0.6, 0.55, 0.45];
    const n = kind === 'blood' ? 9 : 7;
    for (let i = 0; i < n; i++) this.emit({ x, y, z, vx: nx * 2 + (Math.random() - 0.5) * 3, vy: Math.random() * 3 + 0.5, vz: nz * 2 + (Math.random() - 0.5) * 3, life: 0.35 + Math.random() * 0.3, size: kind === 'blood' ? 0.16 : 0.12, size1: 0.05, r: C[0], g: C[1], b: C[2], a: 1, a1: 0.2, grav: 9 });
    if (kind === 'metal') for (let i = 0; i < 5; i++) this.emit({ x, y, z, vx: nx * 4 + (Math.random() - 0.5) * 6, vy: Math.random() * 3, vz: nz * 4 + (Math.random() - 0.5) * 6, life: 0.2 + Math.random() * 0.2, size: 0.08, r: 1, g: 0.8, b: 0.4, add: true, grav: 6 });
    if (kind !== 'blood') this.emit({ x, y, z, vy: 0.5, life: 0.6, size: 0.3, size1: 0.9, r: C[0], g: C[1], b: C[2], a: 0.5, a1: 0 });
    if (kind === 'blood' && Math.random() < 0.5) this.decal(x + (Math.random() - 0.5), z + (Math.random() - 0.5), 'blood', 0.3 + Math.random() * 0.4);
  }
  chips(x, y, z, kind) {
    const C = kind === 'wood' ? [0.62, 0.45, 0.26] : kind === 'sulfur' ? [0.85, 0.78, 0.3] : kind === 'metal' ? [0.6, 0.45, 0.38] : [0.6, 0.6, 0.58];
    for (let i = 0; i < 8; i++) this.emit({ x, y, z, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.5 + Math.random() * 0.3, size: 0.14, size1: 0.08, r: C[0], g: C[1], b: C[2], a: 1, a1: 0.6, grav: 12 });
    this.emit({ x, y, z, vy: 0.4, life: 0.7, size: 0.4, size1: 1.1, r: C[0], g: C[1], b: C[2], a: 0.35, a1: 0 });
  }
  debris(x, y, z, tier) {
    const C = tier === 'stone' ? [0.58, 0.57, 0.55] : tier === 'metal' || tier === 'armored' ? [0.5, 0.52, 0.56] : [0.6, 0.43, 0.25];
    for (let i = 0; i < 26; i++) this.emit({ x: x + (Math.random() - 0.5) * 2.4, y: y + Math.random() * 1.5, z: z + (Math.random() - 0.5) * 2.4, vx: (Math.random() - 0.5) * 5, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 5, life: 0.8 + Math.random() * 0.6, size: 0.22, size1: 0.12, r: C[0], g: C[1], b: C[2], grav: 12, a: 1, a1: 0.7 });
    for (let i = 0; i < 8; i++) this.emit({ x: x + (Math.random() - 0.5) * 2, y: y + Math.random(), z: z + (Math.random() - 0.5) * 2, vy: 0.6, life: 1.6, size: 0.8, size1: 2.6, r: 0.55, g: 0.52, b: 0.48, a: 0.5, a1: 0 });
  }
  muzzle(x, y, z, ang, k = 1) {
    for (let i = 0; i < 3; i++) this.emit({ x: x + Math.cos(ang) * 0.1 * i, y, z: z + Math.sin(ang) * 0.1 * i, vx: Math.cos(ang) * 4, vz: Math.sin(ang) * 4, life: 0.06, size: 0.5 * k - i * 0.1, r: 1, g: 0.85, b: 0.45, add: true });
    this.emit({ x, y, z, vx: Math.cos(ang) * 1.5, vy: 0.4, vz: Math.sin(ang) * 1.5, life: 0.5, size: 0.25, size1: 0.8, r: 0.7, g: 0.7, b: 0.7, a: 0.3, a1: 0 });
    this.light(x, y, z, '#ffc070', 2.4 * k, 9, 0.06);
  }
  /** a blast: flash, fireball, sparks, a smoke column, a ring of dust rolling out over the ground, debris, a shockwave
   *  ring and a scorch mark. o = { floor (ground height under it), frags (shrapnel streaks), water (a spout instead), dust } */
  explosion(x, y, z, r, o = {}) {
    const gy = Number.isFinite(o.floor) ? o.floor : (G.W ? G.W.height(x, z) : y - 0.3);
    const R = Math.random;
    // flash: a white-hot pop, then the fireball
    this.emit({ x, y: y + 0.25, z, life: 0.11, size: r * 1.7, size1: r * 2.6, r: 1, g: 0.97, b: 0.85, a: 1, a1: 0, add: true });
    this.emit({ x, y: y + 0.4, z, life: 0.24, size: r * 1.2, size1: r * 0.5, r: 1, g: 0.72, b: 0.32, a: 0.95, a1: 0, add: true });
    for (let i = 0; i < 30; i++) { const a = R() * 6.28, s = R() * r * 2.2; this.emit({ x, y, z, vx: Math.cos(a) * s, vy: R() * r * 1.6, vz: Math.sin(a) * s, life: 0.35 + R() * 0.35, size: 0.9, size1: 0.2, r: 1, g: 0.6 + R() * 0.3, b: 0.2, add: true, drag: 2 }); }
    for (let i = 0; i < 16; i++) this.emit({ x, y, z, vx: (R() - 0.5) * 14, vy: 3 + R() * 6, vz: (R() - 0.5) * 14, life: 0.8, size: 0.12, r: 1, g: 0.8, b: 0.4, add: true, grav: 14 });
    if (o.water) { // a spout of spray instead of dust and a scorch
      for (let i = 0; i < 26; i++) { const a = R() * 6.28, s = R() * 2.2; this.emit({ x: x + Math.cos(a) * 0.3, y: 0.1, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * s, vy: 6 + R() * 7, vz: Math.sin(a) * s, life: 1.3 + R() * 0.5, size: 0.35, size1: 1.2, r: 0.85, g: 0.93, b: 1, a: 0.85, a1: 0, grav: 11 }); }
      this.shock(x, 0.06, z, r); this.light(x, y + 1, z, '#ffc070', 10, r * 6, 0.3); return;
    }
    // smoke column: billows up and spreads, hangs a few seconds
    for (let i = 0; i < 22; i++) { const a = R() * 6.28, s = R() * r * 0.35, c = 0.14 + R() * 0.1; this.emit({ x: x + Math.cos(a) * s, y: y + 0.3 + i * 0.1, z: z + Math.sin(a) * s, vx: Math.cos(a) * 0.7, vy: 2 + R() * 3, vz: Math.sin(a) * 0.7, life: 3.2 + R() * 3, size: 1 + R() * 0.7, size1: 3.6 + R() * 2.4, r: c, g: c * 0.96, b: c * 0.92, a: 0.74, a1: 0, drag: 0.55 }); }
    // dust rolling out along the ground
    const DC = { sand: [0.78, 0.7, 0.52], snow: [0.93, 0.95, 1], stone: [0.62, 0.61, 0.58] }[o.dust] || [0.56, 0.5, 0.41];
    for (let i = 0; i < 22; i++) { const a = i / 22 * 6.28 + R() * 0.25, s = r * 1.8 + R() * r; this.emit({ x: x + Math.cos(a) * 0.4, y: gy + 0.25, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * s, vy: 0.3 + R() * 0.5, vz: Math.sin(a) * s, life: 1.1 + R() * 0.6, size: 0.5, size1: 2.2, r: DC[0], g: DC[1], b: DC[2], a: 0.55, a1: 0, drag: 2.6 }); }
    // debris: dark chunks thrown up that fall and bounce
    for (let i = 0; i < 18; i++) { const a = R() * 6.28, s = 2 + R() * r * 1.6; this.emit({ x, y: y + 0.2, z, vx: Math.cos(a) * s, vy: 3 + R() * 7, vz: Math.sin(a) * s, life: 1.2 + R() * 0.8, size: 0.09 + R() * 0.08, r: 0.17, g: 0.15, b: 0.13, a: 1, a1: 0.9, grav: 14 }); }
    // shrapnel: fast hot streaks
    if (o.frags) for (let i = 0; i < 22; i++) { const a = R() * 6.28, up = R() * 0.7, s = 24 + R() * 14; this.emit({ x, y: y + 0.1, z, vx: Math.cos(a) * s * Math.cos(up), vy: Math.sin(up) * s, vz: Math.sin(a) * s * Math.cos(up), life: 0.12 + R() * 0.12, size: 0.07, r: 1, g: 0.86, b: 0.5, add: true }); }
    this.light(x, y + 1, z, '#ffb050', 12, r * 7, 0.35);
    this.shock(x, gy + 0.12, z, r);
    this.decal(x, z, 'scorch', r * 0.55, gy);
  }
  /** the nuclear strike's blast (combat.js explode with a nuke def): the big pieces live in fx_nuke.js; here the
   *  near-field particles (a firestorm of sparks, dust and debris) and a long flash light */
  nuke(x, y, z) {
    const B = this.nukes.blast(x, y, z), R = Math.random;
    this.light(x, y + 30, z, '#fff2d0', 60, 400, 2.5); this.light(x, y + 20, z, '#ff9a40', 30, 260, 9);
    for (let i = 0; i < 70; i++) { const a = R() * 6.28, s = 20 + R() * 60; this.emit({ x, y: y + 2, z, vx: Math.cos(a) * s, vy: 4 + R() * 40, vz: Math.sin(a) * s, life: 2 + R() * 2.5, size: 1.5, size1: 0.4, r: 1, g: 0.6 + R() * 0.3, b: 0.2, add: true, drag: 0.8, grav: 6 }); }
    for (let i = 0; i < 60; i++) { const a = i / 60 * 6.28, s = 60 + R() * 50; this.emit({ x: x + Math.cos(a) * 6, y: y + 1, z: z + Math.sin(a) * 6, vx: Math.cos(a) * s, vy: 1 + R() * 3, vz: Math.sin(a) * s, life: 4 + R() * 3, size: 6, size1: 26, r: 0.55, g: 0.48, b: 0.38, a: 0.7, a1: 0, drag: 0.9 }); }
    return B;
  }
  /** a dud's fizzle: sparks and a puff */
  fizzle(x, y, z) { for (let i = 0; i < 10; i++) this.emit({ x, y: y + 0.05, z, vx: (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2.5, vz: (Math.random() - 0.5) * 3, life: 0.4, size: 0.07, r: 1, g: 0.75, b: 0.3, add: true, grav: 6 }); this.emit({ x, y: y + 0.1, z, vy: 0.5, life: 1.6, size: 0.25, size1: 1, r: 0.6, g: 0.6, b: 0.6, a: 0.5, a1: 0 }); }
  /** a flat shockwave ring racing out over the ground */
  shock(x, y, z, r) {
    if (!this.ringGeo) { this.ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2); }
    let m = this.ringPool && this.ringPool.pop();
    if (!m) { m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 7; m.frustumCulled = false; }
    m.position.set(x, y, z); m.scale.setScalar(0.3); m.material.opacity = 0.8; this.scene.add(m);
    (this.rings || (this.rings = [])).push({ m, t: 0, r });
  }
  smoke(x, y, z, col, dt) {
    this._sm = (this._sm || 0) + dt; if (this._sm < 0.05) return; this._sm = 0;
    const c = new THREE.Color(col);
    this.emit({ x, y: y + 0.2, z, vx: (Math.random() - 0.5) * 0.6 + 0.4, vy: 2 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 3, size: 0.6, size1: 3.2, r: c.r, g: c.g, b: c.b, a: 0.7, a1: 0, drag: 0.3 });
  }
  fire(x, y, z, k = 1) {
    if (Math.random() < 0.6) this.emit({ x: x + (Math.random() - 0.5) * 0.4 * k, y, z: z + (Math.random() - 0.5) * 0.4 * k, vy: 1.2 + Math.random(), life: 0.45, size: 0.45 * k, size1: 0.1, r: 1, g: 0.55 + Math.random() * 0.25, b: 0.15, add: true });
    if (Math.random() < 0.08) this.emit({ x, y: y + 0.5, z, vx: (Math.random() - 0.5) * 0.4, vy: 1.6, vz: (Math.random() - 0.5) * 0.4, life: 2, size: 0.4, size1: 1.4, r: 0.3, g: 0.3, b: 0.3, a: 0.35, a1: 0 });
  }
  rad(x, y, z) { this.emit({ x: x + (Math.random() - 0.5) * 3, y: y + Math.random() * 0.4, z: z + (Math.random() - 0.5) * 3, vy: 0.4, life: 1.6, size: 0.12, r: 0.6, g: 1, b: 0.3, add: true, a: 0.8, a1: 0 }); }
  anomaly(x, y, z, kind) {
    const c = kind === 'burner' ? [1, 0.45, 0.15] : kind === 'electro' ? [0.5, 0.75, 1] : [0.7, 0.5, 1];
    this.emit({ x: x + (Math.random() - 0.5) * 2.4, y: y + Math.random() * 1.5, z: z + (Math.random() - 0.5) * 2.4, vy: 0.3, life: 0.6, size: 0.35, size1: 0.05, r: c[0], g: c[1], b: c[2], add: true });
  }
  rain(x, y, z, k, dt) {
    this._rn = (this._rn || 0) + dt * 260 * k; const snow = G.W && G.W.biomeAt(x, z) === 5;
    while (this._rn >= 1) { this._rn -= 1;
      const px = x + (Math.random() - 0.5) * 46, pz = z + (Math.random() - 0.4) * 34;
      this.emit(snow ? { x: px, y: y + 9 + Math.random() * 4, z: pz, vx: 0.6, vy: -2.4, vz: 0.3, life: 3.2, size: 0.09, r: 1, g: 1, b: 1, a: 0.8, a1: 0.6 }
        : { x: px, y: y + 10 + Math.random() * 3, z: pz, vx: 1.2, vy: -17, vz: 0.6, life: 0.65, size: 0.06, r: 0.75, g: 0.82, b: 0.95, a: 0.55, a1: 0.4 }); }
  }
  light(x, y, z, color, intensity, range, life) { this.lights.push({ x, y, z, color, intensity, range, t: 0, life, base: intensity }); }
  decal(x, z, kind, s = 1, y) {
    const m = new THREE.Mesh(this.decalGeo, this.decalMats[kind].clone()); m.position.set(x, (Number.isFinite(y) ? y : G.W ? G.W.height(x, z) : 0) + 0.04 + Math.random() * 0.01, z); m.scale.setScalar(s * 2); m.rotation.y = Math.random() * 6;
    m.renderOrder = 1; this.scene.add(m); this.decals.push({ m, t: 0, life: kind === 'scorch' ? 90 : 40 });
    if (this.decals.length > 50) { const d = this.decals.shift(); this.scene.remove(d.m); d.m.material.dispose(); }
  }
  // ---------------------------------------------------------------- projectiles
  projectile(kind) {
    const pool = this.pools[kind] || this.pools.bullet; let m = pool.pop();
    if (!m) {
      if (kind === 'arrow') { m = new THREE.Group(); M.add(m, M.box(0.8, 0.03, 0.03), this.arrowMat, 0, 0, 0, { cast: false }); M.add(m, M.box(0.12, 0.08, 0.02), M.mat('#d8d0c0'), -0.36, 0, 0, { cast: false }); }
      else if (kind === 'rocket') { m = new THREE.Group(); M.add(m, M.cyl(0.07, 0.07, 0.6, 6).clone().rotateZ(Math.PI / 2), M.mat('#5a6a3a'), 0, 0, 0, { cast: false }); }
      else { m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.035, 0.035), this.tracerMat); }
    }
    m.visible = true; m.userData.kind = kind; this.scene.add(m); return m;
  }
  placeProjectile(m, p) {
    // visual offset (first-person shots leave the weapon's muzzle, then converge on the true path)
    let ox = 0, oy = 0, oz = 0; if (p.off) { const k = Math.max(0, 1 - p.dist / 9); ox = p.off.x * k; oy = p.off.y * k; oz = p.off.z * k; }
    m.position.set(p.x + ox, p.y + oy, p.z + oz);
    _dir.set(p.vx, p.vy || 0, p.vz).normalize(); m.quaternion.setFromUnitVectors(_X, _dir);
    if (p.kind === 'bullet') { const len = Math.min(p.dist + 0.1, p.v3 ? 3.2 : 2.6); m.scale.x = len; m.position.addScaledVector(_dir, -len / 2); }
    if (p.kind === 'rocket') { this.emit({ x: p.x, y: p.y, z: p.z, vy: 0.3, life: 1.2, size: 0.3, size1: 1.4, r: 0.6, g: 0.6, b: 0.6, a: 0.6, a1: 0 }); this.emit({ x: p.x, y: p.y, z: p.z, life: 0.1, size: 0.5, r: 1, g: 0.7, b: 0.3, add: true }); }
  }
  releaseProjectile(m, stickAt) {
    if (stickAt && m.userData.kind === 'arrow') { m.position.set(stickAt.x, stickAt.y, stickAt.z); this.stuck.push({ m, t: 0 }); if (this.stuck.length > 30) { const s = this.stuck.shift(); this.scene.remove(s.m); this.pools.arrow.push(s.m); } return; }
    this.scene.remove(m); (this.pools[m.userData.kind] || this.pools.bullet).push(m);
  }
  thrownMesh(id) {
    let m = null;
    try { m = this.models && this.models.makeHeld ? this.models.makeHeld(id) : null; } catch (e) { m = null; }
    if (!m) { m = new THREE.Group(); M.add(m, M.sphere(0.12, 8, 6), M.mat('#4a5a3a'), 0, 0, 0); }
    this.scene.add(m); return m;
  }
  placeThrown(m, t, dt) { m.position.set(t.x, t.y, t.z); if (!t.rest && !t.stuck) { m.rotation.z += t.spin * dt; m.rotation.y += t.spin * 0.3 * dt; } }
  releaseThrown(m) { this.scene.remove(m); }
  /** a felled tree mesh that tips over then fades */
  fall(obj, dirAng) { this.scene.add(obj); this.debrisList.push({ obj, t: 0, ang: dirAng }); }
  // ---------------------------------------------------------------- tick
  update(dt, cam) {
    for (const c of this.clouds) {
      const P = c.P; let n = 0;
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.t += dt; if (p.t >= p.life) { P[i] = P[P.length - 1]; P.pop(); continue; }
        p.vy -= p.grav * dt; if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.grav && G.W) { const gy = G.W.height(p.x, p.z) + 0.03; if (p.y < gy) { p.y = gy; p.vy *= -0.2; p.vx *= 0.5; p.vz *= 0.5; } }
      }
      for (const p of P) {
        const k = p.t / p.life; const s = p.size1 === null ? p.size : p.size + (p.size1 - p.size) * k; const a = p.a + (p.a1 - p.a) * k;
        c.pos[n * 3] = p.x; c.pos[n * 3 + 1] = p.y; c.pos[n * 3 + 2] = p.z;
        c.col[n * 4] = p.r; c.col[n * 4 + 1] = p.g; c.col[n * 4 + 2] = p.b; c.col[n * 4 + 3] = a; c.size[n] = s; n++;
      }
      c.geo.setDrawRange(0, n);
      c.geo.attributes.position.needsUpdate = true; c.geo.attributes.color.needsUpdate = true; c.geo.attributes.size.needsUpdate = true;
      c.pts.material.uniforms.scale.value = innerHeight * 0.95;
    }
    for (let i = this.lights.length - 1; i >= 0; i--) { const l = this.lights[i]; l.t += dt; l.intensity = l.base * (1 - l.t / l.life); if (l.t >= l.life) this.lights.splice(i, 1); }
    for (let i = this.decals.length - 1; i >= 0; i--) { const d = this.decals[i]; d.t += dt; if (d.t > d.life) { this.scene.remove(d.m); d.m.material.dispose(); this.decals.splice(i, 1); } else if (d.t > d.life - 5) d.m.material.opacity = (d.life - d.t) / 5 * 0.55; }
    for (let i = this.debrisList.length - 1; i >= 0; i--) {
      const d = this.debrisList[i]; d.t += dt; const k = Math.min(1, d.t / 1.3);
      d.obj.rotation.set(0, 0, 0); d.obj.rotateOnWorldAxis(new THREE.Vector3(-Math.sin(d.ang), 0, Math.cos(d.ang)), -(k * k) * 1.5);
      if (d.t > 2.4) { d.obj.position.y -= dt * 1.5; }
      if (d.t > 3.4) { this.scene.remove(d.obj); this.debrisList.splice(i, 1); }
    }
    for (const s of this.stuck) s.t += dt;
    this.nukes.update(dt, cam);
    if (this.rings) for (let i = this.rings.length - 1; i >= 0; i--) { const g = this.rings[i]; g.t += dt; const k = g.t / 0.42; if (k >= 1) { this.scene.remove(g.m); (this.ringPool || (this.ringPool = [])).push(g.m); this.rings.splice(i, 1); continue; } g.m.scale.setScalar(0.3 + (1 - (1 - k) * (1 - k)) * g.r * 2); g.m.material.opacity = 0.8 * Math.pow(1 - k, 1.5); }
    void cam;
  }
}
