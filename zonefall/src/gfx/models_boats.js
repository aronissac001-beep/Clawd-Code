// ============================================================================
// ZONEFALL 4 — rideable boats (comic / cel style, +X forward, y = 0 at the
// waterline when floating):
//   rowboat    clinker-ish wooden hull with a painted outside, white boot stripe,
//              three thwarts and two animated oars in their oarlocks
//   motorboat  small rigid-hull inflatable: bright tubes, white deep-V hull,
//              centre console with windscreen, jockey seat, outboard motor that
//              swings with the steering and a spinning prop
// Static parts are merged per material (M.bake). Each model carries its own
// world-space wake ribbon (a child of the root, so it is removed with it) and a
// tick(dt, state) for co-op friends' boats, where only {x,y,z,yaw,p,r,rpm} is known.
// ============================================================================
import { THREE, M } from './materials.js';
import { G } from '../state.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const BOAT_COLORS = {
  rowboat: ['#d8432f', '#2bb3a8', '#ffc928', '#5a8fd8', '#f4f1ea', '#3c9a4a'],
  motorboat: ['#ff8a1e', '#d8432f', '#ffc928', '#2bb3a8', '#3a3f47', '#5a8fd8'],
};

// ---------------------------------------------------------------- hull lofting
/** split a side profile (gunwale -> keel, y decreasing) with crisp colour boundaries */
function insertBands(side, ys) {
  let out = side.slice();
  for (const b of ys) {
    const e = 0.0015; let k = -1;
    for (let i = 0; i < out.length - 1; i++) if (out[i][1] >= b && out[i + 1][1] < b) { k = i; break; }
    if (k < 0) { // boundary above the gunwale or below the keel: degenerate pair (keeps the vertex count constant)
      const at = out[0][1] < b ? 0 : out.length - 1; const p = out[at];
      out.splice(at === 0 ? 1 : at, 0, [p[0], p[1]], [p[0], p[1]]); continue;
    }
    const a = out[k], c = out[k + 1], t = (a[1] - b) / Math.max(1e-6, a[1] - c[1]), z = lerp(a[0], c[0], t);
    out.splice(k + 1, 0, [z, b + e], [z, b - e]);
  }
  return out;
}
/**
 * Loft a hull surface through cross-sections.
 *   secs: [{ x, hw, top, bot }]   prof: [[fz, fy]] gunwale (0,0) -> keel (0,1)
 *   o: { bands: [[y, '#col'], ...] (desc, colour BELOW y), col (above the first band), inset, floor, inward, tex }
 */
function loftHull(secs, prof, o = {}) {
  const bands = o.bands || [], cTop = new THREE.Color(o.col || '#ffffff'), cB = bands.map(b => new THREE.Color(b[1]));
  const rows = secs.map(s => {
    const hw = Math.max(0.004, s.hw - (o.inset || 0)), top = s.top - (o.inset ? 0.004 : 0), bot = s.bot + (o.inset || 0);
    let side = prof.map(([fz, fy]) => [hw * fz, lerp(top, bot, fy)]);
    if (o.floor !== undefined) side = side.map(([z, y]) => [z, Math.max(y, o.floor)]);
    if (bands.length) side = insertBands(side, bands.map(b => b[0]));
    return { x: s.x, ring: [...side.map(([z, y]) => [-z, y]), ...side.slice(0, -1).reverse()] };
  });
  const S = rows.length, R = rows[0].ring.length, ts = o.tex || 1;
  const pos = new Float32Array(S * R * 3), uv = new Float32Array(S * R * 2), col = new Float32Array(S * R * 3);
  for (let i = 0; i < S; i++) {
    let arc = 0;
    for (let j = 0; j < R; j++) {
      const [z, y] = rows[i].ring[j], k = i * R + j;
      if (j) { const [pz, py] = rows[i].ring[j - 1]; arc += Math.hypot(z - pz, y - py); }
      pos[k * 3] = rows[i].x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = rows[i].x / ts; uv[k * 2 + 1] = arc / ts;
      let c = cTop; for (let b = 0; b < bands.length; b++) if (y < bands[b][0]) c = cB[b];
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  const idx = [];
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < R - 1; j++) {
    const a = i * R + j, b = (i + 1) * R + j, c = (i + 1) * R + j + 1, d = i * R + j + 1;
    if (o.inward) idx.push(a, d, b, b, d, c); else idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.rows = rows;
  return g;
}
/** flat panel closing a lofted section (the transom); faces -X unless flip */
function capSection(ring, x, flip, color) {
  let yc = 0; for (const [, y] of ring) yc += y; yc /= ring.length;
  const pos = [x, yc, 0]; for (const [z, y] of ring) pos.push(x, y, z);
  const idx = [], n = ring.length;
  for (let j = 0; j < n; j++) { const a = 1 + j, b = 1 + (j + 1) % n; if (flip) idx.push(0, b, a); else idx.push(0, a, b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const c = new THREE.Color(color), cols = new Float32Array((n + 1) * 3); for (let i = 0; i <= n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((n + 1) * 2), 2));
  return g;
}
function tube(points, r, seg = 32, rad = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, seg, r, rad, closed);
}
const VC = () => M.mat('#ffffff', { vc: true });
function shadows(root, skip) { root.traverse(o => { if (o.isMesh && !(skip && skip.has(o))) { o.castShadow = true; o.receiveShadow = true; } }); }

// ---------------------------------------------------------------- wake ribbon (world space)
let WAKE_TEX = null;
function wakeTexture() {
  if (WAKE_TEX) return WAKE_TEX;
  const W = 64, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  let s = 7; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.clearRect(0, 0, W, H); g.fillStyle = '#ffffff';
  // the two V arms: crisp wavy white bands along both edges
  for (const side of [0, 1]) {
    g.beginPath();
    for (let y = 0; y <= H; y += 4) { const w = 9 + Math.sin(y / H * Math.PI * 6) * 3 + Math.sin(y / H * Math.PI * 14 + 1) * 1.5; g.lineTo(side ? W - w : w, y); }
    g.lineTo(side ? W : 0, H); g.lineTo(side ? W : 0, 0); g.closePath(); g.fill();
  }
  // churned water in the middle: blobs and dashes (tiling in v)
  g.globalAlpha = 0.72;
  for (let i = 0; i < 46; i++) { const x = 14 + R() * (W - 28), y = R() * H, rx = 1.5 + R() * 4.5, ry = 2 + R() * 7; for (const dy of [-H, 0, H]) { g.beginPath(); g.ellipse(x, y + dy, rx, ry, 0, 0, 7); g.fill(); } }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return (WAKE_TEX = t);
}
export class Wake {
  /** o: { w0 (start width), spread (m/s of widening), life (s), vref (speed for full strength), alpha, max (points) } */
  constructor(o) {
    this.o = Object.assign({ w0: 1, spread: 1.4, life: 4, vref: 10, alpha: 0.95, max: 44 }, o);
    const n = this.o.max; this.pts = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 4); this.uv = new Float32Array(n * 2 * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4)); geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } geo.setIndex(idx); geo.setDrawRange(0, 0);
    this.geo = geo;
    const mat = new THREE.MeshBasicMaterial({ map: wakeTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false; this.mesh.matrixWorldAutoUpdate = false; // vertices are in world space although the mesh hangs off the boat
    this.mesh.castShadow = false; this.mesh.receiveShadow = false; this.mesh.name = 'wake';
    this.dist = 0;
  }
  /** feed the stern position; t = game time */
  add(x, z, yaw, speed, t, wy) {
    const P = this.pts, last = P[0], sp = Math.abs(speed);
    if (last) {
      const d = Math.hypot(x - last.x, z - last.z);
      if (d < Math.max(0.5, sp * 0.11) && t - last.t < 0.4) { last.hx = x; last.hz = z; last.ht = t; last.hy = yaw; last.hs = sp; return; } // head moves with the stern
      this.dist += d;
    }
    if (sp < 0.4) return;
    P.unshift({ x, z, t, yaw, sp, d: this.dist, wy });
    if (P.length > this.o.max - 1) P.length = this.o.max - 1;
  }
  update(t, camX, camZ) {
    const o = this.o, P = this.pts; while (P.length && t - P[P.length - 1].t > o.life) P.pop();
    if (P.length < 1) { this.geo.setDrawRange(0, 0); this.mesh.visible = false; return; }
    this.mesh.visible = true;
    // a moving head point right at the stern, then the history
    const h = P[0], list = h.hx !== undefined ? [{ x: h.hx, z: h.hz, t: h.ht, yaw: h.hy, sp: h.hs, d: h.d + Math.hypot(h.hx - h.x, h.hz - h.z), wy: h.wy }, ...P] : P;
    const n = Math.min(list.length, o.max), pos = this.pos, col = this.col, uv = this.uv;
    for (let i = 0; i < n; i++) {
      const p = list[i], age = Math.max(0, t - p.t), k = age / o.life;
      const w = (o.w0 + age * o.spread) * 0.5, a = (i === 0 ? 0 : 1) * o.alpha * (1 - k) * (1 - k) * clamp(p.sp / o.vref, 0.15, 1);
      const nx = -Math.sin(p.yaw) * w, nz = Math.cos(p.yaw) * w, y = (p.wy ?? -0.05) + 0.035;
      pos.set([p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz], i * 6);
      col.set([1, 1, 1, a, 1, 1, 1, a], i * 8);
      const v = -p.d / 5; uv.set([0, v, 1, v], i * 4);
    }
    this.geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
    void camX; void camZ;
  }
  clear() { this.pts.length = 0; this.geo.setDrawRange(0, 0); this.mesh.visible = false; }
}

// ---------------------------------------------------------------- rowboat
const ROW_SECS = [
  { x: -1.72, hw: 0.50, top: 0.50, bot: -0.06 }, { x: -1.4, hw: 0.59, top: 0.47, bot: -0.15 }, { x: -0.9, hw: 0.67, top: 0.44, bot: -0.21 },
  { x: -0.3, hw: 0.71, top: 0.42, bot: -0.23 }, { x: 0.3, hw: 0.70, top: 0.42, bot: -0.23 }, { x: 0.9, hw: 0.61, top: 0.45, bot: -0.20 },
  { x: 1.32, hw: 0.45, top: 0.50, bot: -0.13 }, { x: 1.62, hw: 0.25, top: 0.56, bot: -0.02 }, { x: 1.84, hw: 0.03, top: 0.63, bot: 0.16 },
];
const ROW_PROF = [[1, 0], [0.985, 0.2], [0.95, 0.42], [0.86, 0.64], [0.68, 0.82], [0.4, 0.95], [0.14, 0.995], [0, 1]];
const rowHW = x => { const S = ROW_SECS; for (let i = 0; i < S.length - 1; i++) if (x >= S[i].x && x <= S[i + 1].x) { const t = (x - S[i].x) / (S[i + 1].x - S[i].x); return { hw: lerp(S[i].hw, S[i + 1].hw, t), top: lerp(S[i].top, S[i + 1].top, t) }; } return { hw: 0.03, top: 0.6 }; };

export function buildRowboat(col = '#d8432f') {
  const root = new THREE.Group(), body = new THREE.Group(); root.name = 'rowboat';
  const dark = new THREE.Color(col).multiplyScalar(0.55).getStyle();
  const outer = loftHull(ROW_SECS, ROW_PROF, { col, bands: [[0.17, '#f6f1e4'], [0.11, dark]] });
  M.add(body, outer, VC());
  M.add(body, loftHull(ROW_SECS, ROW_PROF, { inset: 0.045, floor: 0.09, inward: true, col: '#e8b878', tex: 1.2 }), M.mat('#ffffff', { tex: 'plank', vc: true }));
  // transom: painted outside, wood inside
  const st = outer.userData.rows[0].ring;
  M.add(body, capSection(st, ROW_SECS[0].x, false, col), VC());
  M.add(body, capSection(st.map(([z, y]) => [z * 0.92, Math.max(0.09, y)]), ROW_SECS[0].x + 0.045, true, '#d8a868'), VC());
  // gunwale rails (white) and a rubbing strake
  const rim = M.mat('#f6f1e4'), wood = M.mat('#c48a50'), wood2 = M.mat('#e0b070'), iron = M.mat('#2a2826');
  for (const s of [-1, 1]) {
    M.add(body, tube(ROW_SECS.map(q => [q.x, q.top + 0.012, s * (q.hw + 0.004)]), 0.04, 30, 5), rim);
    M.add(body, tube(ROW_SECS.slice(0, -1).map(q => [q.x, q.top - 0.12, s * (q.hw * 0.975 + 0.012)]), 0.022, 26, 4), wood);
  }
  M.add(body, M.box(0.1, 0.06, 1.04), rim, ROW_SECS[0].x + 0.02, ROW_SECS[0].top + 0.012, 0);
  // thwarts (seats) + knees, stern bench, bow breasthook
  for (const [x, w] of [[-0.05, 0.24], [0.95, 0.2]]) { const { hw } = rowHW(x); M.add(body, M.box(w, 0.05, hw * 2 * 0.93), wood2, x, 0.3, 0); M.add(body, M.box(0.08, 0.2, 0.08), wood, x, 0.19, 0); }
  { const { hw } = rowHW(-1.3); M.add(body, M.box(0.62, 0.05, hw * 2 * 0.9), wood2, -1.32, 0.32, 0); }
  for (const s of [-1, 1]) M.add(body, M.box(0.5, 0.05, 0.16), wood2, -0.95, 0.32, s * 0.5);
  M.add(body, M.box(0.32, 0.04, 0.22), wood2, 1.6, 0.52, 0, { ry: 0 });
  M.add(body, M.box(0.08, 0.08, 0.08), iron, 1.83, 0.6, 0); // stem ring
  // floor boards
  for (const z of [-0.26, 0, 0.26]) M.add(body, M.box(2.5, 0.03, 0.18), wood, -0.1, 0.105, z);
  // oarlocks
  for (const s of [-1, 1]) { const { hw, top } = rowHW(0.12); M.add(body, M.cyl(0.03, 0.03, 0.12, 6), iron, 0.12, top + 0.07, s * (hw + 0.01)); M.add(body, M.box(0.1, 0.02, 0.02), iron, 0.12, top + 0.13, s * (hw + 0.01)); }
  // a coil of rope in the bow and a bucket
  M.add(body, new THREE.TorusGeometry(0.13, 0.035, 5, 12).rotateX(Math.PI / 2), M.mat('#c8a870'), 1.15, 0.14, 0.12);
  M.add(body, M.cyl(0.11, 0.09, 0.2, 9), M.mat('#5a8fd8'), -1.25, 0.2, -0.32);
  const baked = M.bake(body); root.add(baked);
  // oars: pivot at the oarlock, shaft along the outboard axis (+Z starboard, -Z port)
  const oars = [];
  for (const s of [-1, 1]) {
    const { hw, top } = rowHW(0.12);
    const pv = new THREE.Group(); pv.position.set(0.12, top + 0.1, s * (hw + 0.01)); pv.rotation.order = 'YXZ'; root.add(pv);
    const g = new THREE.Group();
    M.add(g, M.cyl(0.026, 0.026, 2.3, 6).clone().rotateX(Math.PI / 2), wood2, 0, 0, s * 0.5);
    M.add(g, M.box(0.022, 0.15, 0.52), wood2, 0, 0, s * 1.48);
    M.add(g, M.box(0.024, 0.152, 0.16), M.mat(col), 0, 0, s * 1.68); // painted tip
    M.add(g, M.cyl(0.034, 0.034, 0.22, 6).clone().rotateX(Math.PI / 2), wood, 0, 0, -s * 0.52); // grip
    const ob = M.bake(g); pv.add(ob);
    oars.push({ pv, s, phase: 0 });
  }
  const wake = new Wake({ w0: 0.7, spread: 0.55, life: 3, vref: 4.2, alpha: 0.65, max: 30 });
  root.add(wake.mesh);
  shadows(root, new Set([wake.mesh]));
  const model = { root, kind: 'rowboat', oars, wake, len: 3.6, beam: 1.4, sternX: -1.75, bowX: 1.8,
    /** oars: mode 'shipped' (nobody aboard), 'idle', 'row'; eL/eR = effort per side (-1..1) */
    animate(dt, o) {
      for (const oar of oars) {
        const e = oar.s < 0 ? o.eL : o.eR;
        let sweep, dip;
        if (o.mode === 'shipped') { sweep = -1.28; dip = -0.02; }
        else if (o.mode === 'row' && Math.abs(e) > 0.05) {
          const prev = Math.sin(oar.phase);
          oar.phase += Math.sign(e) * (3.2 + Math.abs(e) * 3.2) * dt;
          sweep = 0.07 + 0.55 * Math.cos(oar.phase); dip = 0.33 + 0.12 * Math.sin(oar.phase);
          if (prev <= 0 && Math.sin(oar.phase) > 0 && o.onCatch) o.onCatch(oar.s); // blade enters the water
        } else { sweep = 0.12; dip = 0.24; }
        const k = Math.min(1, dt * (o.mode === 'row' ? 14 : 3));
        oar.sw = oar.sw === undefined ? sweep : lerp(oar.sw, sweep, k); oar.dp = oar.dp === undefined ? dip : lerp(oar.dp, dip, k);
        oar.pv.rotation.y = oar.s > 0 ? oar.sw : -oar.sw; oar.pv.rotation.x = oar.s > 0 ? oar.dp : -oar.dp;
      }
    },
    /** stroke power 0..1.6 of one side (drive phase pushes) */
    pulse(side) { const oar = oars[side < 0 ? 0 : 1]; return Math.max(0, Math.sin(oar.phase)) * 1.6 + 0.15; },
    tick(dt, st) { remoteTick(this, dt, st); },
  };
  return model;
}

// ---------------------------------------------------------------- motorboat (RIB)
const RIB_SECS = [
  { x: -2.3, hw: 0.70, top: 0.26, bot: -0.28 }, { x: -1.6, hw: 0.74, top: 0.26, bot: -0.31 }, { x: -0.6, hw: 0.76, top: 0.26, bot: -0.33 },
  { x: 0.4, hw: 0.74, top: 0.27, bot: -0.31 }, { x: 1.2, hw: 0.63, top: 0.29, bot: -0.24 }, { x: 1.8, hw: 0.43, top: 0.32, bot: -0.12 },
  { x: 2.15, hw: 0.21, top: 0.36, bot: 0.02 }, { x: 2.32, hw: 0.03, top: 0.4, bot: 0.16 },
];
const RIB_PROF = [[1, 0], [0.97, 0.28], [0.82, 0.55], [0.5, 0.82], [0.18, 0.97], [0, 1]];
const TUBE = [[-2.38, 0.36, 0.8], [-1.6, 0.365, 0.82], [-0.4, 0.37, 0.825], [0.6, 0.38, 0.8], [1.35, 0.41, 0.69], [1.95, 0.46, 0.46], [2.34, 0.52, 0.2], [2.46, 0.54, 0]];

export function buildMotorboat(col = '#ff8a1e') {
  const root = new THREE.Group(), body = new THREE.Group(); root.name = 'motorboat';
  const white = '#f4f1ea', navy = '#26354a';
  // rigid hull: white topsides, a navy stripe, antifouling below the waterline
  const hull = loftHull(RIB_SECS, RIB_PROF, { col: white, bands: [[0.04, navy], [-0.02, '#3a4658']] });
  M.add(body, hull, VC());
  M.add(body, capSection(hull.userData.rows[0].ring, RIB_SECS[0].x, false, white), VC());
  // tubes: one U around the sides and bow, cones at the stern, a dark rubbing strake
  const tubeM = M.mat(col), darkT = M.mat(new THREE.Color(col).multiplyScalar(0.45).getStyle()), rub = M.mat('#22252a');
  const path = [...TUBE.map(([x, y, z]) => [x, y, -z]), ...TUBE.slice(0, -1).reverse().map(([x, y, z]) => [x, y, z])];
  M.add(body, tube(path, 0.26, 70, 12), tubeM);
  const rubPath = [...TUBE.map(([x, y, z]) => [x + (z < 0.3 ? 0.24 : 0), y - 0.06, -(z + (z < 0.3 ? 0.06 : 0.25))]), ...TUBE.slice(0, -1).reverse().map(([x, y, z]) => [x + (z < 0.3 ? 0.24 : 0), y - 0.06, z + (z < 0.3 ? 0.06 : 0.25)])];
  M.add(body, tube(rubPath, 0.035, 60, 5), rub);
  for (const s of [-1, 1]) {
    M.add(body, M.cyl(0.26, 0.17, 0.3, 12).clone().rotateZ(Math.PI / 2), darkT, -2.53, 0.36, s * 0.8);
    for (const x of [-1.3, 0.0, 1.0]) M.add(body, M.box(0.32, 0.05, 0.05), rub, x, 0.6, s * 0.84); // grab-line patches
  }
  // deck
  const sh = new THREE.Shape([[-2.32, -0.62], [0.4, -0.62], [1.3, -0.5], [1.9, -0.24], [2.1, 0], [1.9, 0.24], [1.3, 0.5], [0.4, 0.62], [-2.32, 0.62]].map(([x, z]) => new THREE.Vector2(x, z)));
  M.add(body, new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2), M.mat('#7d8790', { tex: 'metal' }), 0, 0.14, 0);
  M.add(body, M.box(0.1, 0.4, 1.3), M.mat(white), -2.33, 0.36, 0); // transom top
  // console + windscreen, wheel, throttle
  const cw = M.mat(white), cdk = M.mat('#2a2c30'), red = M.mat('#d8432f');
  M.add(body, M.box(0.62, 0.78, 0.64), cw, 0.2, 0.53, 0);
  M.add(body, M.box(0.64, 0.12, 0.66), M.mat(col), 0.2, 0.2, 0);
  M.add(body, M.box(0.46, 0.07, 0.62), cdk, 0.1, 0.94, 0, { rz: -0.42 });
  M.add(body, M.box(0.05, 0.3, 0.7), M.mat('#9fd4e8', { transparent: true, opacity: 0.42 }), 0.42, 1.08, 0, { rz: 0.5 });
  M.add(body, M.box(0.05, 0.05, 0.72), cdk, 0.35, 1.22, 0, { rz: 0.5 });
  M.add(body, new THREE.TorusGeometry(0.13, 0.022, 5, 14), cdk, 0.0, 1.03, -0.12, { ry: Math.PI / 2, rx: 0, rz: 0.55 });
  M.add(body, M.box(0.06, 0.14, 0.04), cdk, 0.02, 1.02, 0.2); M.add(body, M.sphere(0.04, 6, 4), red, 0.02, 1.1, 0.2);
  // jockey seat + jerrycan + bow locker
  M.add(body, M.box(0.5, 0.42, 0.46), cw, -0.6, 0.35, 0); M.add(body, M.box(0.56, 0.1, 0.52), M.mat('#3a3f47'), -0.6, 0.61, 0);
  M.add(body, M.box(0.36, 0.28, 0.24), red, -1.85, 0.28, 0.32); M.add(body, M.box(0.08, 0.06, 0.06), M.mat('#ffc928'), -1.75, 0.45, 0.32);
  M.add(body, M.box(0.6, 0.3, 0.7), cw, 1.45, 0.29, 0);
  // nav lights on the bow locker
  M.add(body, M.box(0.08, 0.06, 0.06), M.basic('#ff3a2a'), 1.72, 0.47, -0.16); M.add(body, M.box(0.08, 0.06, 0.06), M.basic('#3aff6a'), 1.72, 0.47, 0.16);
  const baked = M.bake(body); root.add(baked);
  // outboard motor (steers) + prop (spins)
  const motor = new THREE.Group(); motor.position.set(-2.4, 0.36, 0); root.add(motor);
  const mg = new THREE.Group(), cowl = M.mat('#1e1f22'), leg = M.mat('#3a3d42');
  M.add(mg, M.box(0.14, 0.26, 0.3), leg, 0.02, 0.05, 0);
  M.add(mg, M.box(0.44, 0.44, 0.36), cowl, -0.24, 0.42, 0);
  M.add(mg, M.cyl(0.18, 0.18, 0.44, 10).clone().rotateZ(Math.PI / 2), cowl, -0.24, 0.64, 0, { sz: 1.0 });
  M.add(mg, M.box(0.45, 0.06, 0.37), M.mat(white), -0.24, 0.5, 0); M.add(mg, M.box(0.2, 0.06, 0.375), M.mat(col), -0.3, 0.5, 0);
  M.add(mg, M.box(0.16, 0.7, 0.1), leg, -0.2, -0.05, 0);
  M.add(mg, M.box(0.34, 0.03, 0.22), leg, -0.24, -0.3, 0);
  M.add(mg, M.cyl(0.06, 0.06, 0.32, 8).clone().rotateZ(Math.PI / 2), leg, -0.2, -0.44, 0);
  M.add(mg, M.box(0.08, 0.16, 0.03), leg, -0.16, -0.54, 0);
  motor.add(M.bake(mg));
  const prop = new THREE.Group(); prop.position.set(-0.4, -0.44, 0); motor.add(prop);
  const pg = new THREE.Group(), brass = M.mat('#c8b070');
  for (let i = 0; i < 3; i++) M.add(pg, M.box(0.03, 0.17, 0.07), brass, 0, Math.cos(i * 2.094) * 0.08, Math.sin(i * 2.094) * 0.08, { rx: i * 2.094 + 0.4 });
  M.add(pg, M.cyl(0.035, 0.035, 0.08, 6).clone().rotateZ(Math.PI / 2), brass, 0, 0, 0);
  prop.add(M.bake(pg));
  const wake = new Wake({ w0: 1.3, spread: 1.7, life: 4.2, vref: 11, alpha: 0.95, max: 44 });
  root.add(wake.mesh);
  shadows(root, new Set([wake.mesh]));
  return { root, kind: 'motorboat', motor, prop, wake, len: 4.8, beam: 2.0, sternX: -2.6, bowX: 2.4,
    animate(dt, o) {
      prop.rotation.x += dt * (o.rpm || 0) * 70 * (o.rev ? -1 : 1);
      motor.rotation.y = lerp(motor.rotation.y, (o.steer || 0) * 0.45, Math.min(1, dt * 6));
      motor.rotation.z = lerp(motor.rotation.z, o.beached ? 0.5 : 0, Math.min(1, dt * 2)); // tilt the leg up in the shallows
    },
    tick(dt, st) { remoteTick(this, dt, st); },
  };
}

// ---------------------------------------------------------------- shared effects
/**
 * Wake + spray + churn for a boat model at world pose. o: { x, z, y, yaw, speed (forward m/s), rpm, t, wy (water level),
 * near (camera distance) } — call every frame the boat is in view.
 */
export function boatFx(m, dt, o) {
  const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw), sp = o.speed, asp = Math.abs(sp);
  const sx = o.x + cs * m.sternX, sz = o.z + sn * m.sternX;
  m.wake.add(sx, sz, o.yaw, sp, o.t, o.wy);
  m.wake.update(o.t);
  const F = G.fx; if (!F || o.near > 70) return;
  const wy = o.wy ?? 0;
  if (m.kind === 'motorboat') {
    // bow spray: two fans thrown out sideways
    const rate = asp > 5 && sp > 0 ? (asp - 5) * 7 : 0;
    m._sp = (m._sp || 0) + rate * dt;
    while (m._sp >= 1) {
      m._sp -= 1; const s = Math.random() < 0.5 ? -1 : 1, bx = 1.0 + Math.random() * 0.8, bz = s * (0.75 + Math.random() * 0.25);
      const px = o.x + cs * bx - sn * bz, pz = o.z + sn * bx + cs * bz, out = 1.6 + Math.random() * 2.2;
      F.emit({ x: px, y: wy + 0.12, z: pz, vx: cs * sp * 0.35 - sn * s * out, vy: 1.8 + Math.random() * 2.2 + asp * 0.06, vz: sn * sp * 0.35 + cs * s * out, life: 0.5 + Math.random() * 0.3, size: 0.2, size1: 0.42, r: 1, g: 1, b: 1, a: 0.95, a1: 0, grav: 9 });
    }
    // prop churn behind the transom
    const crate = (o.rpm || 0) > 0.25 ? 6 + asp * 2.2 : 0;
    m._ch = (m._ch || 0) + crate * dt;
    while (m._ch >= 1) {
      m._ch -= 1; const px = sx - cs * 0.3 + (Math.random() - 0.5) * 0.4, pz = sz - sn * 0.3 + (Math.random() - 0.5) * 0.4;
      F.emit({ x: px, y: wy + 0.05, z: pz, vx: -cs * (1 + asp * 0.15) + (Math.random() - 0.5), vy: 0.5 + Math.random() * 0.9, vz: -sn * (1 + asp * 0.15) + (Math.random() - 0.5), life: 0.55 + Math.random() * 0.4, size: 0.28, size1: 0.8, r: 0.96, g: 0.99, b: 1, a: 0.8, a1: 0, drag: 1.5 });
    }
  } else if (asp > 1.2) {
    // little bow ripple
    m._sp = (m._sp || 0) + (asp - 1) * 3 * dt;
    while (m._sp >= 1) { m._sp -= 1; const s = Math.random() < 0.5 ? -1 : 1; const px = o.x + cs * 1.6 - sn * s * 0.35, pz = o.z + sn * 1.6 + cs * s * 0.35; F.emit({ x: px, y: wy + 0.06, z: pz, vx: -sn * s * 0.8, vy: 0.5, vz: cs * s * 0.8, life: 0.4, size: 0.12, size1: 0.3, r: 1, g: 1, b: 1, a: 0.8, a1: 0, grav: 4 }); }
  }
}
/** splash where an oar blade enters the water */
export function oarSplash(m, side, x, z, yaw, wy) {
  const F = G.fx; if (!F) return;
  const oar = m.oars[side < 0 ? 0 : 1]; const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const lx = 0.12 + Math.sin(oar.sw || 0) * 1.5, lz = side * (0.72 + Math.cos(oar.sw || 0) * 1.45);
  const px = x + cs * lx - sn * lz, pz = z + sn * lx + cs * lz;
  for (let i = 0; i < 5; i++) F.emit({ x: px + (Math.random() - 0.5) * 0.3, y: (wy ?? 0) + 0.05, z: pz + (Math.random() - 0.5) * 0.3, vx: (Math.random() - 0.5) * 1.2, vy: 1 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 1.2, life: 0.45, size: 0.12, size1: 0.22, r: 1, g: 1, b: 1, a: 0.9, a1: 0, grav: 9 });
}
/** co-op friends' boats: only the network pose is known (speed from successive positions) */
function remoteTick(m, dt, st) {
  if (!st) return;
  const now = performance.now() / 1000;
  if (m._lx !== undefined && dt > 0) { const d = Math.hypot(st.x - m._lx, st.z - m._lz), fwd = (st.x - m._lx) * Math.cos(st.yaw) + (st.z - m._lz) * Math.sin(st.yaw); if (d > 0.0001 || now - m._lt > 0.5) { const el = Math.max(1e-3, now - m._lt); if (d < 30) m._spd = lerp(m._spd || 0, (d / el) * Math.sign(fwd || 1), Math.min(1, el * 4)); m._lt = now; m._lx = st.x; m._lz = st.z; } }
  else { m._lx = st.x; m._lz = st.z; m._lt = now; m._spd = 0; }
  const rpm = +st.rpm || 0, sp = m._spd || 0, t = (G.t || now);
  if (m.kind === 'rowboat') m.animate(dt, { mode: rpm > 0.05 ? 'row' : 'idle', eL: rpm, eR: rpm });
  else m.animate(dt, { rpm, steer: 0 });
  const cam = G.rend && G.rend.camera ? G.rend.camera.position : null;
  boatFx(m, dt, { x: st.x, z: st.z, yaw: st.yaw, speed: sp, rpm, t, wy: -0.05, near: cam ? Math.hypot(cam.x - st.x, cam.z - st.z) : 0 });
}

export function buildBoatModel(kind, col) {
  const cols = BOAT_COLORS[kind] || BOAT_COLORS.rowboat;
  const c = col || cols[Math.floor(Math.random() * cols.length)];
  return kind === 'motorboat' ? buildMotorboat(c) : buildRowboat(c);
}
