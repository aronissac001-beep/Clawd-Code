// ============================================================================
// ZONEFALL — caves and natural landmarks:
//   cave      Cave (tier 1): rocky outcrop with two mouths, a winding tunnel and
//             three chambers (explorers' camp with a fire, crystal grotto with
//             ore, an animal den in the deepest chamber)
//   deepcave  Deep Cave (tier 2): a bigger hill with a long gallery, a pool
//             grotto, a hidden military stash and a lurker-infested deep hall
//             full of stalactites
//   arch      Stone Arch (tier 0): natural arch you can walk under, boulders,
//             a small cache tucked into a crevice
//   spires    Hoodoo Spires (tier 0): a cluster of tall rock spires with a
//             lookout campsite at their feet
// The terrain is a heightmap, so a cave is a self-contained rock "monument":
// one solid field (hill minus cave air) sampled on a grid and turned into a
// single faceted, watertight shell (surface nets) — from inside you always see
// rock, never sky. Collision is the same field sliced at body height: circles
// along every wall plus boxes in the deep rock. The floor is the flattened
// terrain (a dark dirt slab covers it under the rock). All layout coordinates
// are LOCAL metres (+X east, +Z south before the monument's quarter turn);
// odd variants are mirrored in X. The heavy part (field + mesh + collider
// shapes) is cached per type and variant, so repeated sites build quickly.
// ============================================================================
import { THREE, M } from '../gfx/materials.js';

const Q = Math.PI / 2, PI = Math.PI, TAU = Math.PI * 2;

// ---------------------------------------------------------------- kit helpers (local copies, see monuments_extra.js)
const statics = K => (K.group.children[0] && K.group.children[0].isGroup ? K.group.children[0] : K.group);
/** visual-only mesh in the monument frame: geometry already in LOCAL coordinates (the monument's turn is applied here) */
function place(K, geo, mat) {
  const m = M.add(statics(K), geo, mat, 0, 0, 0);
  m.rotation.y = -K.rot * Q;
  return m;
}
/** invisible colliders: the kit registers the collider, the mesh is dropped */
function blockBox(K, x, z, w, d, h, o = {}) { const m = K.box(x, z, w, d, h, 'rock', Object.assign({ cast: false, tex: 2 }, o)); if (m && m.parent) m.parent.remove(m); }
function blockCircle(K, x, z, r, h, o = {}) { const m = K.cyl(x, z, r, h, 'rock', Object.assign({ seg: 6 }, o)); if (m && m.parent) m.parent.remove(m); }
/** roofed room record over a footprint (rain and snow stay outside) without building anything */
function shelter(K, x, z, w, d) {
  const st = statics(K), n0 = st.children.length;
  const rm = K.room({ x, z, w, d, h: 3, floor: false, roofProps: false, doors: ['n', 's', 'e', 'w'].map(side => ({ side, w: (side === 'n' || side === 's' ? w : d) + 1 })) });
  for (const c of st.children.slice(n0)) st.remove(c);
  if (rm.roof) rm.roof.clear();
  return rm;
}

// ---------------------------------------------------------------- noise + distance functions
/** seeded 3D value noise in -1..1 (smooth trilinear), plus .h = raw lattice hash */
function noise3(seed) {
  const s = Math.imul(seed | 0, 0x9e3779b1) | 0;
  const h = (x, y, z) => {
    let n = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x1b873593) ^ s) | 0;
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b); n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35); n ^= n >>> 16;
    return (n >>> 0) / 2147483648 - 1;
  };
  const f = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let u = x - xi, v = y - yi, w = z - zi; u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v); w = w * w * (3 - 2 * w);
    const a = h(xi, yi, zi), b = h(xi + 1, yi, zi), c = h(xi, yi + 1, zi), d = h(xi + 1, yi + 1, zi);
    const e = h(xi, yi, zi + 1), g = h(xi + 1, yi, zi + 1), k = h(xi, yi + 1, zi + 1), l = h(xi + 1, yi + 1, zi + 1);
    const x0 = a + (b - a) * u, x1 = c + (d - c) * u, x2 = e + (g - e) * u, x3 = k + (l - k) * u;
    const y0 = x0 + (x1 - x0) * v, y1 = x2 + (x3 - x2) * v;
    return y0 + (y1 - y0) * w;
  };
  f.h = h;
  return f;
}
/** ellipsoid (IQ's bound), centred at the origin */
function sdEll(px, py, pz, rx, ry, rz) {
  const ax = px / rx, ay = py / ry, az = pz / rz, k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  if (k0 < 1e-4) return -Math.min(rx, ry, rz);
  return k0 * (k0 - 1) / h3(ax / rx, ay / ry, az / rz);
}
/** rounded box, centred at the origin */
function sdBox(px, py, pz, hx, hy, hz, r) {
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r, qz = Math.abs(pz) - hz + r;
  return h3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
const h3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z), h2 = (x, y) => Math.sqrt(x * x + y * y);
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
const tri = t => Math.abs(t - Math.floor(t) - 0.5) * 2 - 0.5; // triangle wave, -0.5..0.5
/** tunnel / room cross-section: vertical walls up to hw, then an elliptical vault up to h (d = lateral distance past the wall line) */
function vault(d, y, hw, vh, w) {
  const rect = Math.max(d, y - hw);
  if (y <= hw) return rect;
  const k0 = h2((d + w) / w, (y - hw) / vh);
  return Math.min(rect, (k0 - 1) * Math.min(w, vh));
}

// ---------------------------------------------------------------- the rock field
/**
 * desc: {
 *   seed, k (hill smooth-union radius), hn: [[amp, freq], ...] hill noise, an: [[amp, freq], ...] cave noise,
 *   strata: [amp, step],
 *   blobs: [{x, y, z, rx, ry, rz}]                        ellipsoids (y = centre height, usually 0)
 *   boxes: [{x, y, z, hx, hy, hz, yaw, tx, tz, r, k}]     rounded boxes (crags, cliff faces), yaw about Y, tilt about local X / Z
 *   tubes: [{pts: [[x, y, z, r], ...], k}]                 3D capsule chains (arches)
 *   cols:  [{x, z, h, r0, r1, lx, lz, ring, cap}]          tapered columns with strata rings (hoodoos), cap = cap-rock radius
 *   tunnels: [[[x, z, w, h], ...], ...]                     cave passages (w = half width, h = ceiling height)
 *   rooms: [{x, z, rx, rz, h, hw}]                         cave chambers (domes)
 * }
 * hill(x,y,z) < 0 inside the rock mass, air(x,y,z) < 0 inside the cave; rock = max(hill, -air) < 0
 */
class Field {
  constructor(d, mirror = 1) {
    this.mx = mirror; this.d = d;
    this.k = d.k ?? 2.4;
    this.nh = noise3(d.seed * 7 + 1); this.na = noise3(d.seed * 7 + 2);
    this.hn = d.hn || [[1.1, 0.1], [0.4, 0.3]]; this.an = d.an || [[0.26, 0.28]];
    this.strata = d.strata || null;
    this.blobs = (d.blobs || []).map(b => Object.assign({ y: 0 }, b));
    this.boxes = (d.boxes || []).map(b => Object.assign({ y: 0, yaw: 0, tx: 0, tz: 0, r: 0.6, k: 1.2 }, b, { c: Math.cos(b.yaw || 0), s: Math.sin(b.yaw || 0), ext: Math.hypot(b.hx, b.hy, b.hz) + 1.5 }));
    this.tubes = (d.tubes || []).map(t => ({ k: t.k ?? 1.5, segs: t.pts.slice(1).map((b, i) => { const a = t.pts[i]; return { a, b, dx: b[0] - a[0], dy: b[1] - a[1], dz: b[2] - a[2], L2: (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2 }; }) }));
    this.cols = (d.cols || []).map(c => Object.assign({ lx: 0, lz: 0, ring: 0.12, cap: 0, ph: 0 }, c));
    this.tunnels = (d.tunnels || []).map(pts => {
      const segs = pts.slice(1).map((b, i) => { const a = pts[i]; const dx = b[0] - a[0], dz = b[1] - a[1]; return { ax: a[0], az: a[1], dx, dz, L2: dx * dx + dz * dz, w0: a[2], w1: b[2], h0: a[3], h1: b[3] }; });
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0] - p[2]); x1 = Math.max(x1, p[0] + p[2]); z0 = Math.min(z0, p[1] - p[2]); z1 = Math.max(z1, p[1] + p[2]); }
      return { segs, x0: x0 - 3, x1: x1 + 3, z0: z0 - 3, z1: z1 + 3 };
    });
    this.rooms = (d.rooms || []).map(r => Object.assign({ hw: 1.8 }, r));
    this.airTop = 0; for (const t of d.tunnels || []) for (const p of t) this.airTop = Math.max(this.airTop, p[3]); for (const r of this.rooms) this.airTop = Math.max(this.airTop, r.h);
    this.airTop += 1.5;
    this.lh = 0; this.lc = 0;
  }
  hill(x, y, z) {
    let d = 40; const k = this.k;
    for (const b of this.blobs) {
      const px = x - b.x, py = y - b.y, pz = z - b.z;
      if (Math.abs(px) > b.rx + 5 || Math.abs(pz) > b.rz + 5 || Math.abs(py) > b.ry + 5) continue;
      d = smin(d, sdEll(px, py, pz, b.rx, b.ry, b.rz), k);
    }
    for (const b of this.boxes) {
      let px = x - b.x, py = y - b.y, pz = z - b.z;
      if (Math.abs(px) > b.ext || Math.abs(pz) > b.ext || Math.abs(py) > b.ext) continue;
      let qx = px * b.c + pz * b.s, qz = -px * b.s + pz * b.c; // into the box frame (yaw)
      if (b.tx) { const c = Math.cos(b.tx), s = Math.sin(b.tx), y2 = py * c - qz * s; qz = py * s + qz * c; py = y2; }
      if (b.tz) { const c = Math.cos(b.tz), s = Math.sin(b.tz), x2 = qx * c + py * s; py = -qx * s + py * c; qx = x2; }
      d = smin(d, sdBox(qx, py, qz, b.hx, b.hy, b.hz, b.r), b.k);
    }
    for (const t of this.tubes) for (const s of t.segs) {
      const px = x - s.a[0], py = y - s.a[1], pz = z - s.a[2];
      const u = Math.max(0, Math.min(1, (px * s.dx + py * s.dy + pz * s.dz) / s.L2));
      const r = s.a[3] + (s.b[3] - s.a[3]) * u;
      d = smin(d, h3(px - s.dx * u, py - s.dy * u, pz - s.dz * u) - r, t.k);
    }
    for (const c of this.cols) {
      if (y > c.h + 4 || y < -2) continue;
      const t = Math.max(0, Math.min(1, y / c.h)), ax = x - c.x - c.lx * y, az = z - c.z - c.lz * y;
      if (Math.abs(ax) > c.r0 + 4 || Math.abs(az) > c.r0 + 4) continue;
      const r = (c.r0 + (c.r1 - c.r0) * Math.pow(t, 0.8)) * (1 + c.ring * Math.sin(y * 2.3 + c.ph) + c.ring * 0.5 * Math.sin(y * 5.1 + c.ph * 2));
      let e = Math.max(h2(ax, az) - r, y - c.h);
      if (c.cap) e = smin(e, sdEll(ax - c.lx * 0, y - c.h, az, c.cap, c.cap * 0.42, c.cap * 0.92), 0.5);
      d = smin(d, e * 0.85, 1.0);
    }
    if (d < 4.5) {
      for (const [a, f] of this.hn) d += a * this.nh(x * f, y * f * 1.25, z * f);
      if (this.strata) d += this.strata[0] * tri(y / this.strata[1] + this.nh(x * 0.05, 7.1, z * 0.05) * 0.8);
    }
    return d;
  }
  air(x, y, z) {
    if (y > this.airTop) return 9;
    let c = 9;
    for (const t of this.tunnels) {
      if (x < t.x0 || x > t.x1 || z < t.z0 || z > t.z1) continue;
      for (const s of t.segs) {
        const px = x - s.ax, pz = z - s.az, u = Math.max(0, Math.min(1, (px * s.dx + pz * s.dz) / s.L2));
        const dd = h2(px - s.dx * u, pz - s.dz * u), w = s.w0 + (s.w1 - s.w0) * u, h = s.h0 + (s.h1 - s.h0) * u;
        const hw = Math.max(1.9, h - w * 1.05);
        const a = vault(dd - w, y, hw, h - hw, w); if (a < c) c = a;
      }
    }
    for (const r of this.rooms) {
      const dx = x - r.x, dz = z - r.z; if (Math.abs(dx) > r.rx + 4 || Math.abs(dz) > r.rz + 4) continue;
      const q = h2(dx / r.rx, dz / r.rz), dl = (q - 1) * Math.min(r.rx, r.rz);
      let a = Math.max(dl, y - r.hw);
      if (y > r.hw) a = Math.min(a, sdEll(dx, y - r.hw, dz, r.rx, r.h - r.hw, r.rz));
      c = smin(c, a, 1.6);
    }
    if (c < 2.5) for (const [a, f] of this.an) c += a * this.na(x * f, y * f, z * f);
    return c;
  }
  /** solid rock: < 0. Also leaves this.lh / this.lc (hill / cave values) */
  S(x, y, z) {
    x *= this.mx;
    const h = this.hill(x, y, z); this.lh = h;
    if (h > 1.5) { this.lc = 9; return h; }
    const c = this.air(x, y, z); this.lc = c;
    return Math.max(h, -c);
  }
}

// ---------------------------------------------------------------- colours
const lin = hex => new THREE.Color(hex);
const PALETTE = {
  out: ['#8d8a82', '#9a958a', '#827d74', '#8f877a', '#7c7c7e', '#a29d90'].map(lin),
  moss: lin('#6f8a44'), mossDark: lin('#58703a'), lichen: lin('#a6a070'),
  in: ['#857d72', '#8c8274', '#7a746c', '#7e8082'].map(lin), damp: lin('#5e5244'), roof: lin('#6a635a'),
};
const _c = new THREE.Color();
/** face colour for the rock shell (linear rgb into out[]) */
function paintRock(n, cx, cy, cz, nx, ny, nz, inside, o, out) {
  const j = n.h(Math.round(cx * 3.1), Math.round(cy * 3.3), Math.round(cz * 2.9)) * 0.5 + 0.5; // per-face jitter
  const v = n(cx * 0.21, cy * 0.21, cz * 0.21) * 0.5 + 0.5;
  if (inside) {
    const P = PALETTE.in; _c.copy(P[Math.floor(v * 3.99)]).lerp(P[(Math.floor(v * 3.99) + 1) & 3], j * 0.5);
    if (ny < -0.35) _c.lerp(PALETTE.roof, 0.55);
    if (cy < 0.7) _c.lerp(PALETTE.damp, 0.5);
    if (o.innerMoss && ny > 0.55 && cy < 2.5) _c.lerp(PALETTE.mossDark, 0.45);
    _c.multiplyScalar(0.86 + j * 0.16);
  } else {
    const P = PALETTE.out, band = Math.floor((cy + v * 1.4) / (o.band || 1.6));
    _c.copy(P[((band % P.length) + P.length) % P.length]).lerp(P[(band + 3) % P.length], j * 0.35);
    const patch = n(cx * 0.16 + 9, cy * 0.1, cz * 0.16) + j * 0.25;
    if (ny > 0.72 && cy > 1.2 && patch > -0.05) _c.lerp(v > 0.45 ? PALETTE.moss : PALETTE.mossDark, Math.min(1, (ny - 0.72) * 4.5) * (o.moss ?? 0.8));
    else if (ny > 0.3 && patch > 0.3) _c.lerp(PALETTE.lichen, 0.3);
    if (ny < -0.3) _c.multiplyScalar(0.8);
    if (cy < 0.9 && ny < 0.5) _c.lerp(PALETTE.damp, 0.25);
    _c.multiplyScalar(0.9 + j * 0.16);
  }
  out[0] = _c.r; out[1] = _c.g; out[2] = _c.b;
}

// ---------------------------------------------------------------- surface nets
/**
 * Samples the field on a grid (corners), builds one faceted shell (flat normals, triplanar UVs in metres,
 * per-face colours) and keeps the samples for collision / floor / decoration queries.
 */
function buildShell(F, b, paint) {
  const { x0, y0, z0, nx, ny, nz, cs } = b, NX = nx + 1, NY = ny + 1, NZ = nz + 1, NXY = NX * NY;
  const S = new Float32Array(NX * NY * NZ), Hh = new Float32Array(NX * NY * NZ), Cc = new Float32Array(NX * NY * NZ);
  const tf = performance.now();
  for (let k = 0, q = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++, q++) { S[q] = F.S(x0 + i * cs, y0 + j * cs, z0 + k * cs); Hh[q] = F.lh; Cc[q] = F.lc; }
  const msField = performance.now() - tf;
  const vid = new Int32Array(nx * ny * nz).fill(-1), V = [], VI = [];
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const ED = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8), cq = new Int32Array(8);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let m = 0;
    for (let c = 0; c < 8; c++) { const q = i + CO[c][0] + NX * (j + CO[c][1]) + NXY * (k + CO[c][2]); cq[c] = q; cv[c] = S[q]; if (cv[c] < 0) m |= 1 << c; }
    if (m === 0 || m === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, e] of ED) {
      if ((cv[a] < 0) === (cv[e] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[e]);
      sx += CO[a][0] + (CO[e][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[e][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[e][2] - CO[a][2]) * t; n++;
    }
    // inside (cave) or outside surface: vote of the air corners
    let ins = 0, out = 0;
    for (let c = 0; c < 8; c++) if (cv[c] >= 0) { const q = cq[c]; if (-Cc[q] >= Hh[q]) ins++; else out++; }
    vid[i + nx * (j + ny * k)] = V.length / 3;
    V.push(x0 + (i + sx / n) * cs, y0 + (j + sy / n) * cs, z0 + (k + sz / n) * cs); VI.push(ins >= out && ins > 0 ? 1 : 0);
  }
  const quads = [];
  const cell = (i, j, k) => vid[i + nx * (j + ny * k)];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const q = i + NX * j + NXY * k, a = S[q] < 0;
    if (i < nx && j > 0 && k > 0 && j < ny && k < nz && a !== (S[q + 1] < 0)) quads.push(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), a ? 1 : -1, 0, 0);
    if (j < ny && i > 0 && k > 0 && i < nx && k < nz && a !== (S[q + NX] < 0)) quads.push(cell(i - 1, j, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i - 1, j, k), 0, a ? 1 : -1, 0);
    if (k < nz && i > 0 && j > 0 && i < nx && j < ny && a !== (S[q + NXY] < 0)) quads.push(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), 0, 0, a ? 1 : -1);
  }
  const nq = quads.length / 7, pos = new Float32Array(nq * 18), nor = new Float32Array(nq * 18), uv = new Float32Array(nq * 12), col = new Float32Array(nq * 18), side = new Uint8Array(nq * 2);
  let w = 0; const rgb = [0, 0, 0];
  const P = idx => [V[idx * 3], V[idx * 3 + 1], V[idx * 3 + 2]];
  const emit = (A, B, C, inside) => {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx; const L = Math.hypot(nx2, ny2, nz2); if (L < 1e-9) return;
    nx2 /= L; ny2 /= L; nz2 /= L;
    const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, cz = (A[2] + B[2] + C[2]) / 3;
    paint(cx, cy, cz, nx2, ny2, nz2, inside, rgb); side[w / 3] = inside ? 1 : 0;
    const ax = Math.abs(nx2), ay = Math.abs(ny2), az = Math.abs(nz2);
    for (const p of [A, B, C]) {
      pos[w * 3] = p[0]; pos[w * 3 + 1] = p[1]; pos[w * 3 + 2] = p[2];
      nor[w * 3] = nx2; nor[w * 3 + 1] = ny2; nor[w * 3 + 2] = nz2;
      col[w * 3] = rgb[0]; col[w * 3 + 1] = rgb[1]; col[w * 3 + 2] = rgb[2];
      if (ay >= ax && ay >= az) { uv[w * 2] = p[0] / 3.6; uv[w * 2 + 1] = p[2] / 3.6; }
      else if (ax >= az) { uv[w * 2] = p[2] / 3.6; uv[w * 2 + 1] = p[1] / 3.6; }
      else { uv[w * 2] = p[0] / 3.6; uv[w * 2 + 1] = p[1] / 3.6; }
      w++;
    }
  };
  for (let t = 0; t < nq; t++) {
    const o = t * 7; let A = P(quads[o]), B = P(quads[o + 1]), C = P(quads[o + 2]), D = P(quads[o + 3]);
    const ins = VI[quads[o]] + VI[quads[o + 1]] + VI[quads[o + 2]] + VI[quads[o + 3]] >= 2;
    // orientation: the outward (rock -> air) normal points along the edge direction given
    const n0 = (C[1] - A[1]) * (D[2] - B[2]) - (C[2] - A[2]) * (D[1] - B[1]), n1 = (C[2] - A[2]) * (D[0] - B[0]) - (C[0] - A[0]) * (D[2] - B[2]), n2 = (C[0] - A[0]) * (D[1] - B[1]) - (C[1] - A[1]) * (D[0] - B[0]);
    if (n0 * quads[o + 4] + n1 * quads[o + 5] + n2 * quads[o + 6] < 0) { const tmp = B; B = D; D = tmp; }
    // split along the shorter diagonal
    if ((A[0] - C[0]) ** 2 + (A[1] - C[1]) ** 2 + (A[2] - C[2]) ** 2 <= (B[0] - D[0]) ** 2 + (B[1] - D[1]) ** 2 + (B[2] - D[2]) ** 2) { emit(A, B, C, ins); emit(A, C, D, ins); }
    else { emit(A, B, D, ins); emit(B, C, D, ins); }
  }
  // two geometries: outside faces (rock texture) and cave faces (a quieter texture)
  const geos = [0, 1].map(want => {
    let n = 0; for (let t = 0; t < w / 3; t++) if (side[t] === want) n++;
    const P = new Float32Array(n * 9), N = new Float32Array(n * 9), U = new Float32Array(n * 6), C = new Float32Array(n * 9); let o = 0;
    for (let t = 0; t < w / 3; t++) if (side[t] === want) { P.set(pos.subarray(t * 9, t * 9 + 9), o * 9); N.set(nor.subarray(t * 9, t * 9 + 9), o * 9); C.set(col.subarray(t * 9, t * 9 + 9), o * 9); U.set(uv.subarray(t * 6, t * 6 + 6), o * 6); o++; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    return n ? g : null;
  });
  return { geo: geos[0], geoIn: geos[1], tris: w / 3, S, H: Hh, C: Cc, b, NX, NY, NZ, msField };
}

// ---------------------------------------------------------------- 2D slices of the sampled field
/** value of a per-corner array at a column (grid i,k) and height y (linear in y) */
function colAt(sh, arr, i, k, y) {
  const { y0, cs } = sh.b; const t = Math.max(0, Math.min(sh.NY - 1.001, (y - y0) / cs)), j = Math.floor(t), f = t - j;
  const q = i + sh.NX * j + sh.NX * sh.NY * k;
  return arr[q] + (arr[q + sh.NX] - arr[q]) * f;
}
/** 2D grid (NX x NZ) of a column function */
function slice(sh, fn) { const out = new Float32Array(sh.NX * sh.NZ); for (let k = 0; k < sh.NZ; k++) for (let i = 0; i < sh.NX; i++) out[i + sh.NX * k] = fn(i, k); return out; }
/** bilinear sample of a 2D slice at local (x, z) */
function bil(sh, A, x, z) {
  const { x0, z0, cs } = sh.b; let u = (x - x0) / cs, v = (z - z0) / cs;
  u = Math.max(0, Math.min(sh.NX - 1.001, u)); v = Math.max(0, Math.min(sh.NZ - 1.001, v));
  const i = Math.floor(u), k = Math.floor(v), fu = u - i, fv = v - k, q = i + sh.NX * k;
  return (A[q] * (1 - fu) + A[q + 1] * fu) * (1 - fv) + (A[q + sh.NX] * (1 - fu) + A[q + sh.NX + 1] * fu) * fv;
}
/** highest rock sample in a column (local height) */
function topAt(sh, i, k) { for (let j = sh.NY - 1; j >= 0; j--) if (sh.S[i + sh.NX * j + sh.NX * sh.NY * k] < 0) return sh.b.y0 + j * sh.b.cs; return 0; }
/** marching squares: closed iso-lines (value 0) of a 2D slice as point loops [[x, z], ...] */
function contours(sh, A) {
  const { x0, z0, cs } = sh.b, NX = sh.NX, NZ = sh.NZ;
  const pts = new Map(), adj = new Map();
  const ep = id => {
    let p = pts.get(id); if (p) return p;
    const e = id >> 1, i = e % NX, k = (e / NX) | 0, va = A[e], vb = (id & 1) ? A[e + NX] : A[e + 1], t = va / (va - vb);
    p = (id & 1) ? [x0 + i * cs, z0 + (k + t) * cs] : [x0 + (i + t) * cs, z0 + k * cs]; pts.set(id, p); return p;
  };
  const link = (a, b) => { ep(a); ep(b); (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
  for (let k = 0; k < NZ - 1; k++) for (let i = 0; i < NX - 1; i++) {
    const q = i + NX * k, a = A[q], b = A[q + 1], c = A[q + NX + 1], d = A[q + NX];
    const m = (a < 0 ? 1 : 0) | (b < 0 ? 2 : 0) | (c < 0 ? 4 : 0) | (d < 0 ? 8 : 0); if (m === 0 || m === 15) continue;
    const e0 = q * 2, e1 = (q + 1) * 2 + 1, e2 = (q + NX) * 2, e3 = q * 2 + 1; // bottom, right, top, left
    const ctr = (a + b + c + d) / 4;
    switch (m) {
      case 1: case 14: link(e3, e0); break;
      case 2: case 13: link(e0, e1); break;
      case 3: case 12: link(e3, e1); break;
      case 4: case 11: link(e1, e2); break;
      case 6: case 9: link(e0, e2); break;
      case 7: case 8: link(e3, e2); break;
      case 5: if (ctr < 0) { link(e0, e1); link(e2, e3); } else { link(e3, e0); link(e1, e2); } break;
      case 10: if (ctr < 0) { link(e3, e0); link(e1, e2); } else { link(e0, e1); link(e2, e3); } break;
    }
  }
  const seen = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = -1, cur = start;
    while (cur !== undefined && !seen.has(cur)) { seen.add(cur); loop.push(pts.get(cur)); const nb = adj.get(cur); const nxt = nb[0] !== prev ? nb[0] : nb[1]; prev = cur; cur = nxt; }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
/** points every ~step along a closed loop */
function resample(loop, step) {
  let L = 0; for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const n = Math.max(3, Math.round(L / step)), ds = L / n, out = [];
  let acc = 0, i = 0, a = loop[0], b = loop[1 % loop.length], seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let s = 0; s < n; s++) {
    const target = s * ds;
    while (acc + seg < target && i < loop.length * 2) { acc += seg; i++; a = loop[i % loop.length]; b = loop[(i + 1) % loop.length]; seg = Math.hypot(b[0] - a[0], b[1] - a[1]); }
    const t = seg > 1e-6 ? (target - acc) / seg : 0; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { pts: out, L };
}
/** greedy rectangles over a boolean cell grid (w x h): [[i0, k0, i1, k1], ...] inclusive */
function rects(on, w, h) {
  const used = new Uint8Array(w * h), out = [];
  for (let k = 0; k < h; k++) for (let i = 0; i < w; i++) {
    if (!on[i + w * k] || used[i + w * k]) continue;
    let i1 = i; while (i1 + 1 < w && on[i1 + 1 + w * k] && !used[i1 + 1 + w * k]) i1++;
    let k1 = k; grow: while (k1 + 1 < h) { for (let ii = i; ii <= i1; ii++) if (!on[ii + w * (k1 + 1)] || used[ii + w * (k1 + 1)]) break grow; k1++; }
    for (let kk = k; kk <= k1; kk++) for (let ii = i; ii <= i1; ii++) used[ii + w * kk] = 1;
    out.push([i, k, i1, k1]);
  }
  return out;
}

// ---------------------------------------------------------------- site analysis (cached per type + variant)
const SITE_CACHE = new Map();
/**
 * Everything heavy for one design: the shell geometry, collider shapes (local), wall samples (for decoration),
 * the dark floor under the rock, shelter rectangles.
 * o: { margin, r, step, deep, floor, shelterMin }
 */
function analyse(key, desc, mirror, bounds, o = {}) {
  if (SITE_CACHE.has(key)) return SITE_CACHE.get(key);
  const t0 = performance.now();
  const F = new Field(desc, mirror), n = F.nh;
  const sh = buildShell(F, bounds, (cx, cy, cz, nx, ny, nz, ins, out) => paintRock(n, cx, cy, cz, nx, ny, nz, ins, o, out));
  const t1 = performance.now();
  const { x0, z0, cs } = bounds, NX = sh.NX, NZ = sh.NZ;
  // body-height slice: rock if any of feet / chest / head height is rock (minus a small margin)
  const margin = o.margin ?? 0.12;
  const body = slice(sh, (i, k) => Math.min(colAt(sh, sh.S, i, k, 0.3), colAt(sh, sh.S, i, k, 1.1), colAt(sh, sh.S, i, k, 1.9)) - margin);
  const loops = contours(sh, body);
  const circles = [], walls = [];
  const R = o.r ?? 1.2, step = o.step ?? 1.1, e = 0.05;
  for (const loop of loops) {
    // small rock islands (pillars, boulders): one circle
    let cx = 0, cz = 0; for (const p of loop) { cx += p[0]; cz += p[1]; } cx /= loop.length; cz /= loop.length;
    let rmax = 0; for (const p of loop) rmax = Math.max(rmax, Math.hypot(p[0] - cx, p[1] - cz));
    if (rmax < R * 1.05 && bil(sh, body, cx, cz) < 0) { circles.push([cx, cz, rmax + e]); continue; }
    const { pts } = resample(loop, step);
    for (const [px, pz] of pts) {
      let gx = bil(sh, body, px + 0.25, pz) - bil(sh, body, px - 0.25, pz), gz = bil(sh, body, px, pz + 0.25) - bil(sh, body, px, pz - 0.25);
      const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl; // toward free space
      circles.push([px - gx * (R - e), pz - gz * (R - e), R]);
      walls.push({ x: px, z: pz, nx: gx, nz: gz, cave: bil(sh, slice2(sh, 'Cb'), px, pz) < 1.5 });
    }
  }
  // deep rock: cells whose four corners are well inside
  const deep = o.deep ?? 1.45, on = new Uint8Array((NX - 1) * (NZ - 1));
  for (let k = 0; k < NZ - 1; k++) for (let i = 0; i < NX - 1; i++) { const q = i + NX * k; on[i + (NX - 1) * k] = body[q] < -deep && body[q + 1] < -deep && body[q + NX] < -deep && body[q + NX + 1] < -deep ? 1 : 0; }
  const boxes = rects(on, NX - 1, NZ - 1).map(([i0, k0, i1, k1]) => { let h = 0; for (let k = k0; k <= k1 + 1; k += Math.max(1, k1 - k0)) for (let i = i0; i <= i1 + 1; i += Math.max(1, i1 - i0)) h = Math.max(h, topAt(sh, i, k)); return [x0 + (i0 + i1 + 1) / 2 * cs, z0 + (k0 + k1 + 1) / 2 * cs, (i1 - i0 + 1) * cs, (k1 - k0 + 1) * cs, Math.max(3, h)]; });
  for (const c of circles) { const i = Math.round((c[0] - x0) / cs), k = Math.round((c[1] - z0) / cs); c.push(Math.max(2.5, topAt(sh, Math.max(0, Math.min(NX - 1, i)), Math.max(0, Math.min(NZ - 1, k))) + 0.3)); }
  // covered air (under the rock): shelter rectangles + dark floor
  const covered = slice(sh, (i, k) => { for (let y = 2.8; y < 12; y += cs * 0.5) if (colAt(sh, sh.S, i, k, y) < 0) return 1; return 0; });
  const res = { sh, F, body, circles, boxes, walls, covered, loops: loops.length, ms: 0 };
  res.floor = o.floor === false ? null : floorGeo(sh, o);
  if (o.shelter !== false) {
    const cov = new Uint8Array((NX - 1) * (NZ - 1));
    for (let k = 0; k < NZ - 1; k++) for (let i = 0; i < NX - 1; i++) { const q = i + NX * k; cov[i + (NX - 1) * k] = covered[q] && covered[q + 1] && covered[q + NX] && covered[q + NX + 1] && (body[q] > 0 || body[q + 1] > 0 || body[q + NX] > 0 || body[q + NX + 1] > 0) ? 1 : 0; }
    res.shelters = rects(cov, NX - 1, NZ - 1).filter(([i0, k0, i1, k1]) => (i1 - i0 + 1) * (k1 - k0 + 1) >= 2).map(([i0, k0, i1, k1]) => [x0 + (i0 + i1 + 1) / 2 * cs, z0 + (k0 + k1 + 1) / 2 * cs, (i1 - i0 + 1) * cs, (k1 - k0 + 1) * cs]);
  } else res.shelters = [];
  res.ms = performance.now() - t0; res.msShell = t1 - t0; res.msField = sh.msField;
  SITE_CACHE.set(key, res);
  return res;
}
/** cached named slices: 'Cb' = cave value at chest height, 'Hb' = hill value near the ground */
function slice2(sh, name) {
  sh.slices = sh.slices || {};
  if (!sh.slices[name]) sh.slices[name] = name === 'Cb' ? slice(sh, (i, k) => colAt(sh, sh.C, i, k, 1.5)) : slice(sh, (i, k) => colAt(sh, sh.H, i, k, 0.3));
  return sh.slices[name];
}
/** dark earth floor under the rock: marching-squares fill of (near the hill) AND (near the cave air), at y = 0.05 */
function floorGeo(sh, o) {
  const { x0, z0, cs } = sh.b, NX = sh.NX, NZ = sh.NZ;
  const Cb = slice2(sh, 'Cb'), Hb = slice2(sh, 'Hb');
  const A = new Float32Array(NX * NZ); for (let q = 0; q < A.length; q++) A[q] = Math.max(Hb[q] - (o.floorOut ?? 0.3), Cb[q] - 0.8);
  const pos = [], col = [], n = noise3(77);
  const y = 0.05;
  const vtx = (x, z) => { pos.push(x, y, z); const v = 0.82 + n(x * 0.35, 0, z * 0.35) * 0.22; const c = lin('#5b4f42'); col.push(c.r * v, c.g * v, c.b * v); };
  const tri3 = (a, b, c) => { vtx(a[0], a[1]); vtx(c[0], c[1]); vtx(b[0], b[1]); }; // CCW seen from above (+Y normal)
  for (let k = 0; k < NZ - 1; k++) for (let i = 0; i < NX - 1; i++) {
    const q = i + NX * k, cv = [A[q], A[q + 1], A[q + NX + 1], A[q + NX]];
    const cp = [[x0 + i * cs, z0 + k * cs], [x0 + (i + 1) * cs, z0 + k * cs], [x0 + (i + 1) * cs, z0 + (k + 1) * cs], [x0 + i * cs, z0 + (k + 1) * cs]];
    if (cv.every(v => v >= 0)) continue;
    const poly = [];
    for (let c = 0; c < 4; c++) {
      const a = cv[c], b = cv[(c + 1) & 3];
      if (a < 0) poly.push(cp[c]);
      if ((a < 0) !== (b < 0)) { const t = a / (a - b), P0 = cp[c], P1 = cp[(c + 1) & 3]; poly.push([P0[0] + (P1[0] - P0[0]) * t, P0[1] + (P1[1] - P0[1]) * t]); }
    }
    for (let t = 1; t < poly.length - 1; t++) tri3(poly[0], poly[t], poly[t + 1]);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.flatMap((v, i) => (i % 3 === 0 ? [v / 2.2, pos[i + 2] / 2.2] : [])), 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
/** register the cached analysis with the kit: shell mesh, floor, colliders, shelters */
function addSite(K, A) {
  if (A.sh.geo) place(K, A.sh.geo, MAT.rock());
  if (A.sh.geoIn) place(K, A.sh.geoIn, MAT.cave());
  if (A.floor) place(K, A.floor, MAT.dirt());
  // (sizes quantised: every distinct shape is a cached geometry in the kit)
  const qz = (v, s) => Math.round(v / s) * s;
  for (const [x, z, r, h] of A.circles) blockCircle(K, x, z, qz(r, 0.05), qz(h, 1));
  for (const [x, z, w, d, h] of A.boxes) blockBox(K, x, z, w, d, qz(h, 1));
  for (const [x, z, w, d] of A.shelters) shelter(K, x, z, w, d);
}

// ---------------------------------------------------------------- decoration builder (local space, one mesh per material)
const MAT = {
  rock: () => M.mat('#ffffff', { tex: 'rock', vc: true }),
  cave: () => M.mat('#ffffff', { tex: 'noise', vc: true }),
  dirt: () => M.mat('#ffffff', { tex: 'dirt', vc: true }),
  plain: () => M.mat('#ffffff', { vc: true }),
  log: () => M.mat('#ffffff', { tex: 'log', vc: true }),
  plank: () => M.mat('#ffffff', { tex: 'plank', vc: true }),
  cloth: () => M.mat('#ffffff', { tex: 'cloth', vc: true }),
  glow: () => M.basic('#ffffff', { vc: true }),
  flame: () => M.basic('#ffffff', { vc: true, additive: true }),
};
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _n3 = new THREE.Matrix3(), _up = new THREE.Vector3(0, 1, 0);
const _ni = new Map();
const nonIdx = g => { let r = _ni.get(g); if (!r) { r = g.index ? g.toNonIndexed() : g; _ni.set(g, r); } return r; };
/** collects triangles in local space per material; flush() adds one mesh per material to the monument */
class Deco {
  constructor(K, mirror) { this.K = K; this.mx = mirror; this.b = {}; this.R = K.R; }
  buf(name) { return this.b[name] || (this.b[name] = { p: [], n: [], u: [], c: [] }); }
  /**
   * add a template geometry: o = { p: [x, y, z] local (mirrored here), q: Quaternion | dir: [x, y, z] (+Y axis of the template -> dir),
   *   ry (yaw, applied before dir), s: number | [sx, sy, sz], col: hex | THREE.Color, vary (0..1 per-vertex brightness noise), flat, tri (triplanar uv) }
   */
  add(mat, geo, o) {
    const B = this.buf(mat), g = nonIdx(geo), P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const s = o.s ?? 1; _s.set(...(Array.isArray(s) ? s : [s, s, s]));
    _q.identity();
    if (o.dir) { const d = _v.set(o.dir[0] * this.mx, o.dir[1], o.dir[2]).normalize(); _q.setFromUnitVectors(_up, d); }
    if (o.ry) _q.multiply(new THREE.Quaternion().setFromAxisAngle(_up, this.mx < 0 ? -o.ry : o.ry));
    if (o.q) _q.multiply(this.mx < 0 ? _q2.set(o.q.x, -o.q.y, -o.q.z, o.q.w) : o.q);
    _m4.compose(_v.set(o.p[0] * this.mx, o.p[1], o.p[2]), _q, _s); _n3.getNormalMatrix(_m4);
    const c = o.col instanceof THREE.Color ? o.col : lin(o.col || '#ffffff'), vary = o.vary ?? 0, R = this.R;
    const a = new THREE.Vector3(), nn = new THREE.Vector3(), b0 = B.p.length;
    for (let i = 0; i < P.count; i++) {
      a.fromBufferAttribute(P, i).applyMatrix4(_m4); B.p.push(a.x, a.y, a.z);
      nn.fromBufferAttribute(N, i).applyMatrix3(_n3).normalize(); B.n.push(nn.x, nn.y, nn.z);
      if (o.tri || !U) B.u.push(0, 0); else B.u.push(U.getX(i), U.getY(i));
      const k = 1 - vary * 0.5 + vary * R(); B.c.push(c.r * k, c.g * k, c.b * k);
    }
    if (o.flat || o.tri) for (let t = b0; t < B.p.length; t += 9) {
      const p = B.p, ux = p[t + 3] - p[t], uy = p[t + 4] - p[t + 1], uz = p[t + 5] - p[t + 2], vx = p[t + 6] - p[t], vy = p[t + 7] - p[t + 1], vz = p[t + 8] - p[t + 2];
      let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx; const L = Math.hypot(fx, fy, fz) || 1; fx /= L; fy /= L; fz /= L;
      for (let v = 0; v < 3; v++) {
        if (o.flat) { B.n[t + v * 3] = fx; B.n[t + v * 3 + 1] = fy; B.n[t + v * 3 + 2] = fz; }
        if (o.tri) { const ax = Math.abs(fx), ay = Math.abs(fy), az = Math.abs(fz), X = p[t + v * 3], Y = p[t + v * 3 + 1], Z = p[t + v * 3 + 2], ui = (t / 3 + v) * 2;
          if (ay >= ax && ay >= az) { B.u[ui] = X / 2.2; B.u[ui + 1] = Z / 2.2; } else if (ax >= az) { B.u[ui] = Z / 2.2; B.u[ui + 1] = Y / 2.2; } else { B.u[ui] = X / 2.2; B.u[ui + 1] = Y / 2.2; } }
      }
    }
    return this;
  }
  flush() {
    for (const [mat, B] of Object.entries(this.b)) {
      if (!B.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
      place(this.K, g, MAT[mat]());
    }
    this.b = {};
  }
}
// template geometries
const GEO = {
  ico: new THREE.IcosahedronGeometry(1, 0), ico1: new THREE.IcosahedronGeometry(1, 1), dode: new THREE.DodecahedronGeometry(1, 0),
  hex: new THREE.CylinderGeometry(0.62, 1, 1, 6).translate(0, 0.5, 0), tip: new THREE.ConeGeometry(0.62, 0.7, 6).translate(0, 0.35, 0),
  cone: new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), cyl: new THREE.CylinderGeometry(1, 1, 1, 7).translate(0, 0.5, 0), cyl5: new THREE.CylinderGeometry(1, 1, 1, 5).translate(0, 0.5, 0),
  cap: new THREE.SphereGeometry(1, 6, 2, 0, TAU, 0, PI / 2), sph: new THREE.SphereGeometry(1, 7, 5), box: new THREE.BoxGeometry(1, 1, 1),
  flame: new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), arc: new THREE.TorusGeometry(1, 0.08, 4, 9, PI),
};
/** a jittered low-poly rock (icosahedron / dodecahedron with displaced vertices), cached by seed */
const ROCKS = [];
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), PI);
function rockGeo(i) {
  i = i % 6; if (ROCKS[i]) return ROCKS[i];
  const base = (i % 2 ? GEO.dode : GEO.ico).clone(), n = noise3(91 + i), P = base.attributes.position;
  for (let v = 0; v < P.count; v++) { const x = P.getX(v), y = P.getY(v), z = P.getZ(v); const k = 1 + n(x * 1.7 + i, y * 1.7, z * 1.7) * 0.28; P.setXYZ(v, x * k, y * k, z * k); }
  base.computeVertexNormals();
  return (ROCKS[i] = base);
}

// ---------------------------------------------------------------- decoration pieces
const CRYSTAL = { cyan: ['#7af4ff', '#bdfcff', '#45c8e8'], violet: ['#c58cff', '#e6c6ff', '#9a5ce8'], amber: ['#ffc85a', '#ffe7a0', '#e89a30'], green: ['#8cff9a', '#d0ffc0', '#4ed27a'] };
/** crystal cluster growing from (x, y, z) along a rough direction (local) */
function crystals(D, x, y, z, dir, n = 5, size = 1, kind = 'cyan') {
  const R = D.R, C = CRYSTAL[kind];
  D.add('rock', rockGeo(R() * 6 | 0), { p: [x, y - 0.05, z], s: [0.45 * size, 0.28 * size, 0.45 * size], col: '#4d4a46', tri: true, flat: true });
  for (let i = 0; i < n; i++) {
    const d = [dir[0] + (R() - 0.5) * 1.1, dir[1] + (R() - 0.5) * 0.8 + 0.3, dir[2] + (R() - 0.5) * 1.1], len = (0.35 + R() * 0.9) * size, r = (0.06 + R() * 0.07) * size * (1.4 - len / size * 0.5);
    const col = C[i % 3];
    D.add('glow', GEO.hex, { p: [x, y, z], dir: d, s: [r, len, r], col });
    const L = Math.hypot(...d), u = [d[0] / L * len, d[1] / L * len, d[2] / L * len];
    D.add('glow', GEO.tip, { p: [x + u[0], y + u[1], z + u[2]], dir: d, s: [r, r * 2.2, r], col: C[1] });
  }
}
/** glowing mushrooms: n caps on pale stalks around (x, z) */
function shrooms(D, x, z, n = 5, spread = 0.6, glow = '#7dffd2') {
  const R = D.R;
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, r = R() * spread, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, h = 0.12 + R() * 0.3, cr = 0.07 + R() * 0.1;
    D.add('plain', GEO.cyl5, { p: [px, 0, pz], s: [cr * 0.28, h, cr * 0.28], col: '#d8d2bc', dir: [(R() - 0.5) * 0.4, 1, (R() - 0.5) * 0.4] });
    D.add('glow', GEO.cap, { p: [px, h, pz], s: [cr, cr * 0.6, cr], col: glow, vary: 0.3 });
  }
}
/** loose rubble: a few small rocks */
function rubble(D, x, z, n = 4, s = 0.35, col = '#6a655d') {
  const R = D.R;
  for (let i = 0; i < n; i++) { const a = R() * TAU, r = R() * s * 2.2, k = s * (0.45 + R() * 0.8); D.add('rock', rockGeo(R() * 6 | 0), { p: [x + Math.cos(a) * r, k * 0.25, z + Math.sin(a) * r], s: [k, k * (0.5 + R() * 0.4), k * (0.8 + R() * 0.4)], ry: R() * TAU, col, vary: 0.15, tri: true, flat: true }); }
}
/** a boulder (visual) + optional collider */
function boulder(D, x, z, s, o = {}) {
  const R = D.R, K = D.K;
  D.add('rock', rockGeo(o.g ?? (R() * 6 | 0)), { p: [x, s * (o.sink ?? 0.35), z], s: [s * (o.sx ?? 1), s * (o.sy ?? 0.78), s * (o.sz ?? 0.92)], ry: o.ry ?? R() * TAU, col: o.col || PALETTE.out[R() * 6 | 0], vary: 0.12, tri: true, flat: true });
  if (o.collide !== false && s > 0.55) blockCircle(K, x * D.mx, z, s * 0.85 * Math.min(o.sx ?? 1, o.sz ?? 0.92), s * 1.2 + s * (o.sink ?? 0.35) * 0, { opaque: s > 1.0 });
}
/** stalactite hanging from ceiling height top at (x, z) */
function stalactite(D, x, z, top, len, r) { D.add('rock', GEO.cone, { p: [x, top + 0.3, z], q: FLIP, s: [r, len + 0.3, r], ry: D.R() * TAU, col: '#5c5750', vary: 0.1, tri: true, flat: true }); }
/** stalagmite rising from the floor */
function stalagmite(D, x, z, len, r) { D.add('rock', GEO.cone, { p: [x, -0.1, z], s: [r, len + 0.1, r], ry: D.R() * TAU, col: '#625c54', vary: 0.1, tri: true, flat: true }); }
/** bones: a skeleton slumped on the floor (sit = against a wall, facing yaw) */
function skeleton(D, x, z, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (f, l, y) => [x + c * f - s * l, y, z + s * f + c * l], bone = '#e2d8c0';
  D.add('plain', GEO.sph, { p: P(-0.1, 0, 0.75), s: [0.13, 0.14, 0.12], col: bone }); // skull
  D.add('plain', GEO.box, { p: P(-0.02, 0, 0.66), s: [0.1, 0.05, 0.12], ry: -yaw, col: bone });
  for (const l of [-0.05, 0.05]) D.add('plain', GEO.sph, { p: P(0.02, l, 0.77), s: [0.035, 0.035, 0.035], col: '#2a2420' });
  D.add('plain', GEO.cyl5, { p: P(-0.25, 0, 0.12), dir: [-c * 0.35 + 0, 1, -s * 0.35], s: [0.035, 0.6, 0.035], col: bone }); // spine
  for (let i = 0; i < 4; i++) D.add('plain', GEO.arc, { p: P(-0.17 + i * 0.03, 0, 0.55 - i * 0.09), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -yaw + PI / 2, 0.3)), s: [0.17 - i * 0.015, 0.14, 0.17], col: bone });
  for (const l of [-0.13, 0.13]) {
    D.add('plain', GEO.cyl5, { p: P(-0.2, l, 0.05), dir: [c, 0.06, s], s: [0.03, 0.42, 0.03], col: bone }); // femur
    D.add('plain', GEO.cyl5, { p: P(0.22, l * 1.2, 0.05), dir: [c, -0.04, s], s: [0.026, 0.38, 0.026], col: bone }); // shin
    D.add('plain', GEO.cyl5, { p: P(-0.2, l * 1.9, 0.5), dir: [c * 0.6, -0.8, s * 0.6], s: [0.025, 0.3, 0.025], col: bone }); // arm
  }
}
/** loose bones scattered round a den */
function bones(D, x, z, n = 6) {
  const R = D.R;
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, r = R() * 1.3, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, d = [Math.cos(a * 3), 0.05, Math.sin(a * 3)], len = 0.25 + R() * 0.35;
    D.add('plain', GEO.cyl5, { p: [px, 0.04, pz], dir: d, s: [0.028, len, 0.028], col: '#ddd2b6' });
    D.add('plain', GEO.sph, { p: [px, 0.05, pz], s: [0.05, 0.04, 0.05], col: '#ddd2b6' });
  }
  D.add('plain', GEO.sph, { p: [x + 0.4, 0.09, z - 0.3], s: [0.16, 0.11, 0.2], col: '#d6cab0' }); // big skull
}
/** fire pit: stone ring, teepee logs, ash, flames (+ night light) */
function firePit(D, x, z, o = {}) {
  const R = D.R;
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + R() * 0.3; D.add('rock', rockGeo(i), { p: [x + Math.cos(a) * 0.62, 0.06, z + Math.sin(a) * 0.62], s: [0.18, 0.13, 0.2], ry: a, col: '#77726a', tri: true, flat: true }); }
  D.add('plain', GEO.cyl, { p: [x, 0, z], s: [0.5, 0.05, 0.5], col: '#2c2824' });
  if (o.lit !== false) {
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; D.add('log', GEO.cyl5, { p: [x + Math.cos(a) * 0.42, 0.03, z + Math.sin(a) * 0.42], dir: [-Math.cos(a) * 0.42, 0.55, -Math.sin(a) * 0.42], s: [0.055, 0.66, 0.055], col: '#7a5534' }); }
    for (const [dx, dz, h, r, c] of [[0, 0, 0.72, 0.22, '#ff6a1a'], [0.03, 0.02, 0.52, 0.15, '#ffc04a'], [-0.1, 0.08, 0.42, 0.12, '#ff7a2a'], [0.09, -0.08, 0.38, 0.1, '#ff8a2a']]) D.add('flame', GEO.flame, { p: [x + dx, 0.06, z + dz], s: [r, h, r], col: c });
    D.K.light(x * D.mx, z, 1.1, '#ff9a40', o.i ?? 1.6, o.range ?? 9);
  } else for (let i = 0; i < 3; i++) D.add('log', GEO.cyl5, { p: [x - 0.3 + i * 0.25, 0.06, z - 0.2], dir: [0.3, 0.02, 1], s: [0.06, 0.5, 0.06], col: '#3a2a1e' });
}
/** wooden lantern post / pole with a lit lantern (+ night light) */
function lanternPost(D, x, z, o = {}) {
  const h = o.h ?? 1.9;
  D.add('log', GEO.cyl5, { p: [x, 0, z], s: [0.06, h, 0.06], col: '#6e4c2e', dir: [0.04, 1, 0.02] });
  D.add('log', GEO.cyl5, { p: [x, h - 0.08, z], dir: [1, 0, 0], s: [0.035, 0.45, 0.035], col: '#6e4c2e' });
  const lx = x + 0.4;
  D.add('plain', GEO.cyl5, { p: [lx, h - 0.47, z], s: [0.09, 0.05, 0.09], col: '#2c2a26' });
  D.add('glow', GEO.cyl, { p: [lx, h - 0.42, z], s: [0.065, 0.22, 0.065], col: '#ffd27a' });
  D.add('plain', GEO.cone, { p: [lx, h - 0.2, z], s: [0.11, 0.1, 0.11], col: '#2c2a26' });
  D.add('plain', GEO.cyl5, { p: [lx, h - 0.11, z], s: [0.008, 0.05, 0.008], col: '#2c2a26' });
  D.K.light(lx * D.mx, z, h - 0.3, o.col || '#ffc070', o.i ?? 1.1, o.range ?? 9);
}
/** a burning torch wedged in the rock (wall point x, z with normal n) */
function torch(D, x, z, n, o = {}) {
  const px = x + n[0] * 0.15, pz = z + n[1] * 0.15, y = o.y ?? 1.5;
  D.add('log', GEO.cyl5, { p: [x - n[0] * 0.1, y - 0.35, z - n[1] * 0.1], dir: [n[0] * 0.55, 1, n[1] * 0.55], s: [0.035, 0.55, 0.035], col: '#5a3a22' });
  D.add('plain', GEO.cyl5, { p: [px, y + 0.06, pz], s: [0.06, 0.12, 0.06], col: '#2c2420' });
  for (const [h, r, c] of [[0.42, 0.09, '#ff7a2a'], [0.28, 0.06, '#ffd060']]) D.add('flame', GEO.flame, { p: [px, y + 0.14, pz], s: [r, h, r], col: c });
  if (o.light !== false) D.K.light(px * D.mx, pz, y + 0.4, '#ffa050', o.i ?? 1.1, o.range ?? 8);
}
/** explorer's bedroll + pack (decor, no collision) */
function bedroll(D, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  D.add('cloth', GEO.box, { p: [x, 0.08, z], ry: -yaw, s: [1.9, 0.14, 0.75], col: '#5d6b3c' });
  D.add('cloth', GEO.cyl, { p: [x - c * 0.95, 0.12, z - s * 0.95], dir: [-s, 0, c], s: [0.16, 0.72, 0.16], col: '#c9b48f' }); // pillow roll
  D.add('cloth', GEO.box, { p: [x + c * 1.25 + s * 0.4, 0.28, z + s * 1.25 - c * 0.4], ry: -yaw + 0.3, s: [0.45, 0.56, 0.32], col: '#7a5233' }); // backpack
}
/** wooden pick / shovel leaning on the wall */
function tool(D, x, z, n, kind = 'pick') {
  const t = [-n[1], n[0]];
  D.add('log', GEO.cyl5, { p: [x + n[0] * 0.45, 0, z + n[1] * 0.45], dir: [-n[0] * 0.38, 1, -n[1] * 0.38], s: [0.03, 1.15, 0.03], col: '#8a6a44' });
  const hx = x + n[0] * 0.03, hz = z + n[1] * 0.03, hy = 1.08;
  if (kind === 'pick') D.add('plain', GEO.cyl5, { p: [hx - t[0] * 0.3, hy, hz - t[1] * 0.3], dir: [t[0], 0.15, t[1]], s: [0.03, 0.6, 0.03], col: '#555b63' });
  else D.add('plain', GEO.box, { p: [x + n[0] * 0.48, 0.12, z + n[1] * 0.48], ry: Math.atan2(n[1], n[0]), s: [0.06, 0.32, 0.24], col: '#555b63' });
}
/** a log lying on the ground centred at (x, z) along d (collides, low) */
function logSeat(D, x, z, d, L, r = 0.2) {
  const l = Math.hypot(d[0], d[2]), ux = d[0] / l, uz = d[2] / l;
  D.add('log', GEO.cyl, { p: [x - ux * L / 2, r, z - uz * L / 2], dir: [ux, 0, uz], s: [r, L, r], col: '#7a5534' });
  for (const s of [-1, 1]) D.add('plank', GEO.cyl, { p: [x + ux * (s * L / 2 - (s < 0 ? 0.005 : 0)), r, z + uz * (s * L / 2)], dir: [ux, 0, uz], s: [r * 0.9, 0.01, r * 0.9], col: '#b08a58' });
  for (let t = -L / 2 + 0.3; t <= L / 2 - 0.3 + 1e-6; t += Math.max(0.3, (L - 0.6) / 2)) blockCircle(D.K, (x + ux * t) * D.mx, z + uz * t, r + 0.05, r * 2, { opaque: false });
}
/** a decor crate (no loot) */
function dcrate(D, x, z, s = 0.8, y = 0, yaw = 0, col = '#a27748') {
  D.add('plank', GEO.box, { p: [x, y + s / 2, z], ry: yaw, s: [s, s, s], col });
  if (y < 0.5) blockCircle(D.K, x * D.mx, z, s * 0.6, s + y, { opaque: false });
}

// ---------------------------------------------------------------- placement helpers (work in DESIGN coordinates; D.mx mirrors)
/** wall samples (design coords) inside a disc, sorted by an angle preference */
function wallsNear(A, D, x, z, r) {
  return A.walls.filter(w => w.cave && Math.hypot(w.x * D.mx - x, w.z - z) < r).map(w => ({ x: w.x * D.mx, z: w.z, n: [w.nx * D.mx, w.nz] }));
}
/** a spot just off the wall, `off` metres into the room, nearest to the hint direction from (cx, cz) */
function wallSpot(A, D, cx, cz, r, ang, off = 0.9) {
  const ws = wallsNear(A, D, cx, cz, r); if (!ws.length) return null;
  let best = null, bd = 1e9; const hx = cx + Math.cos(ang) * r, hz = cz + Math.sin(ang) * r;
  for (const w of ws) { const d = Math.hypot(w.x - hx, w.z - hz); if (d < bd) { bd = d; best = w; } }
  return { x: best.x + best.n[0] * off, z: best.z + best.n[1] * off, wx: best.x, wz: best.z, n: best.n };
}
/** ceiling height above (x, z) (design coords), or null */
function ceilAt(A, D, x, z) {
  const sh = A.sh, { x0, z0, cs } = sh.b; const i = Math.round((x * D.mx - x0) / cs), k = Math.round((z - z0) / cs);
  if (i < 0 || k < 0 || i >= sh.NX || k >= sh.NZ) return null;
  for (let y = 2.4; y < 14; y += 0.25) if (colAt(sh, sh.S, i, k, y) < 0) return y;
  return null;
}
/** kit calls in design coordinates */
const KX = (K, D) => ({
  container: (t, x, z, ry = 0) => K.container(t, x * D.mx, z, D.mx < 0 ? PI - ry : ry),
  node: (t, x, z) => K.node(t, x * D.mx, z),
  npc: (k, x, z, o) => K.npc(k, x * D.mx, z, o && o.patrol ? Object.assign({}, o, { patrol: o.patrol.map(p => [p[0] * D.mx, p[1]]) }) : o),
  veg: (k, x, z, s) => K.veg(k, x * D.mx, z, s),
  light: (x, z, y, c, i, r) => K.light(x * D.mx, z, y, c, i, r),
  prop: (t, x, z, rq = 0, o) => K.prop(t, x * D.mx, z, D.mx < 0 ? PI - rq : rq, o),
});

// ============================================================================
// CAVE — rocky outcrop, two mouths, a winding passage through three chambers
// ============================================================================
const CAVE_DESIGN = {
  open: { 0: [1, 0], 3: [0, 1] }, // passage segments left uncovered at the mouths
  // passages: [x, z, half width, ceiling]
  tunnels: [
    [[-3.6, 24], [-3.8, 16], [-2.2, 11.5], [0.6, 8.0]].map(p => [p[0], p[1], 1.85, 4.4]),            // south mouth -> camp
    [[0.5, 4.0], [-4.5, 2.6], [-8.6, -0.8], [-9.4, -5.0], [-7.6, -8.2]].map(p => [p[0], p[1], 1.8, 4.2]), // camp -> grotto
    [[-3.0, -11.6], [1.0, -13.4], [5.0, -12.0], [7.2, -9.4]].map(p => [p[0], p[1], 1.8, 4.1]),         // grotto -> den
    [[6.6, 7.4], [10.8, 9.8], [14.6, 13.4], [19.5, 18.5]].map(p => [p[0], p[1], 1.8, 4.3]),             // camp -> east mouth
  ],
  rooms: [
    { x: 2.6, z: 5.4, rx: 5.6, rz: 4.7, h: 6.0, hw: 2.0 },   // camp
    { x: -6.6, z: -10.4, rx: 5.2, rz: 4.4, h: 5.9, hw: 1.9 }, // grotto
    { x: 9.2, z: -7.4, rx: 4.8, rz: 4.2, h: 5.5, hw: 1.8 },  // den
  ],
};
/** coverage for a cave design: a lump over every chamber and along every passage (mouth ends left open) */
function coverage(design, o = {}) {
  const blobs = [], up = o.up ?? 3.6, side = o.side ?? 3.8;
  for (const r of design.rooms) blobs.push({ x: r.x, z: r.z, rx: r.rx + side + 0.6, ry: r.h + up, rz: r.rz + side + 0.6 });
  design.tunnels.forEach((pts, ti) => {
    const open = (design.open || {})[ti] || [0, 0]; // [skip first n segments, skip last n segments]
    for (let i = open[0]; i < pts.length - 1 - open[1]; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L; s += 2.8) { const t = s / L; blobs.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, rx: a[2] + side, ry: a[3] + up, rz: a[2] + side }); }
    }
  });
  return blobs;
}
function caveDesc(seed) {
  const blobs = coverage(CAVE_DESIGN, { up: 3.4, side: 3.6 });
  blobs.push({ x: -10.5, z: 4, rx: 6.5, ry: 6.0, rz: 7.5 }, { x: 12, z: 2, rx: 6, ry: 7.2, rz: 6.5 }, { x: 2, z: -14.5, rx: 8, ry: 6.2, rz: 5 }, { x: -12, z: -11, rx: 6, ry: 6.8, rz: 6 });
  return {
    seed, k: 1.7, hn: [[1.2, 0.09], [0.5, 0.22]], an: [[0.26, 0.3]], strata: [0.75, 2.1],
    blobs,
    boxes: [
      // the massif: a rounded slab with a flat-ish top at ~10 m
      { x: 0.5, y: 3.0, z: -2.5, hx: 11.5, hy: 6.8, hz: 9.5, yaw: 0.22, r: 3.2, k: 2.2 },
      // cliff faces around the mouths (the passage cuts through)
      { x: -3.6, y: 3.0, z: 13.8, hx: 6.0, hy: 5.6, hz: 3.6, yaw: 0.05, tx: -0.08, r: 1.0, k: 2.6 },
      { x: 13.4, y: 3.2, z: 12.0, hx: 5.4, hy: 5.8, hz: 3.4, yaw: -0.78, tx: -0.06, r: 1.0, k: 2.6 },
      // crags on top
      { x: -6.0, y: 9.2, z: -4.0, hx: 3.2, hy: 4.6, hz: 2.6, yaw: 0.55, tz: 0.1, r: 1.0, k: 1.4 },
      { x: 5.5, y: 8.8, z: -4.5, hx: 2.8, hy: 4.4, hz: 3.4, yaw: -0.35, tx: 0.1, r: 1.0, k: 1.4 },
      { x: -0.5, y: 9.6, z: 3.2, hx: 2.4, hy: 3.2, hz: 2.2, yaw: 0.9, tz: -0.15, r: 0.9, k: 1.3 },
      { x: 12.5, y: 6.2, z: -6.5, hx: 2.2, hy: 4.4, hz: 2.8, yaw: 0.3, tx: 0.2, r: 0.9, k: 1.3 },
      { x: -12.5, y: 5.0, z: -3.0, hx: 2.6, hy: 4.6, hz: 3.6, yaw: -0.4, tz: -0.12, r: 1.0, k: 1.4 },
      { x: 7.5, y: 6.0, z: 8.0, hx: 2.6, hy: 3.6, hz: 2.4, yaw: 0.7, r: 0.9, k: 1.3 },
    ],
    tunnels: CAVE_DESIGN.tunnels, rooms: CAVE_DESIGN.rooms,
  };
}
const CAVE_BOUNDS = { x0: -25.2, y0: -0.9, z0: -25.2, nx: 42, ny: 13, nz: 42, cs: 1.2 };

const PREP = {
  cave: v => analyse('cave' + v, caveDesc(11 + v * 17), v & 1 ? -1 : 1, CAVE_BOUNDS, { moss: 0.9 }),
};
function cave(K) {
  K.label('Cave');
  const variant = (K.mon.variant ?? Math.floor(K.R() * 4)) & 3, mirror = variant & 1 ? -1 : 1;
  const A = PREP.cave(variant);
  addSite(K, A);
  const D = new Deco(K, mirror), X = KX(K, D), R = K.R;
  const [camp, grotto, den] = CAVE_DESIGN.rooms;
  // ---- outside: boulders, scree and greenery round the foot of the hill
  for (const [x, z, s] of [[-9.5, 17.5, 1.5], [3.5, 19.5, 1.2], [-13.5, 13, 1.9], [19, 6, 1.6], [17.5, -12, 1.4], [-18.5, -6, 1.8], [-6, -21, 1.3], [8.5, -20.5, 1.6], [21, 13, 1.1], [-17, 7.5, 1.0]]) boulder(D, x, z, s);
  for (const [x, z] of [[-1, 19.5], [-8, 21], [16.5, 17.5], [12.5, 20], [-15, -14], [20.5, -2], [0, -22]]) rubble(D, x, z, 4, 0.32);
  for (const [k, x, z, s] of [['grass', -7.2, 18.6, 1], ['grass', 0.2, 18.2, 1], ['fern', -10.8, 15.6, 1], ['bush', -12, 16, 1], ['grass', 18.2, 15.4, 1], ['fern', 13, 18.8, 1], ['bush', 21.5, 9.5, 1],
    ['grass', 19.5, -8, 1], ['bush', -19, 2, 1], ['fern', -17.5, -10, 1], ['grass', 3, -21.5, 1], ['birch', -20, 13.5, 1], ['pine', 21.5, -14.5, 1], ['dead', 4.8, 21, 0.85], ['grass', -15, 10.8, 1], ['bush', 9.5, -21.5, 0.9]]) X.veg(k, x, z, s);
  // explorers marked the south mouth: a lantern post and a torch inside
  lanternPost(D, -6.4, 18.2);
  // ---- south passage
  const t1 = wallSpot(A, D, -3.2, 12.5, 3.5, 0);
  if (t1) torch(D, t1.wx, t1.wz, t1.n);
  rubble(D, -5.2, 14.0, 3, 0.3); shrooms(D, -1.0, 10.2, 4, 0.3);
  // ---- camp chamber: fire, bedrolls, crates, a toolbox, a pick on the wall
  firePit(D, camp.x - 0.4, camp.z + 0.2);
  logSeat(D, camp.x - 2.1, camp.z + 0.5, [0.2, 0, 1], 1.6); logSeat(D, camp.x + 0.6, camp.z + 2.0, [1, 0, -0.25], 1.5);
  bedroll(D, camp.x + 2.2, camp.z - 1.6, 0.4);
  X.container('crate', camp.x - 3.2, camp.z - 1.4, 0.3);
  X.container('toolbox', camp.x + 3.3, camp.z + 1.6, -0.8);
  X.container('food', camp.x - 2.6, camp.z + 2.3, 1.2);
  dcrate(D, camp.x + 1.0, camp.z - 3.0, 0.75, 0, 0.3); dcrate(D, camp.x + 1.0, camp.z - 3.0, 0.55, 0.75, 0.9, '#6e4c2e');
  const pk = wallSpot(A, D, camp.x, camp.z, 5.6, -2.2, 0); if (pk) tool(D, pk.wx, pk.wz, pk.n, 'pick');
  const sv = wallSpot(A, D, camp.x, camp.z, 5.6, 0.6, 0); if (sv) tool(D, sv.wx, sv.wz, sv.n, 'shovel');
  // ---- west passage: mushrooms, an ore node in a bend
  shrooms(D, -7.2, 1.4, 5, 0.5); shrooms(D, -9.8, -3.2, 4, 0.4, '#9dff8a');
  // ---- crystal grotto: crystals, ore, a hidden stash, a skeleton of someone who did not make it out
  for (const [ang, n, s, kind] of [[2.4, 6, 1.2, 'cyan'], [-1.9, 5, 1.0, 'cyan'], [0.4, 4, 0.9, 'violet'], [-0.6, 3, 0.8, 'cyan'], [3.6, 4, 0.9, 'violet']]) {
    const w = wallSpot(A, D, grotto.x, grotto.z, 5.2, ang, 0.1); if (w) crystals(D, w.x, 0.05, w.z, [w.n[0], 0.9, w.n[1]], n, s, kind);
  }
  for (const [ang, kind] of [[-2.6, 'metal'], [1.2, 'sulfur'], [-0.2, 'metal']]) { const w = wallSpot(A, D, grotto.x, grotto.z, 5.2, ang, 0.85); if (w) X.node(kind, w.x, w.z); }
  if (R() < 0.45) { const w = wallSpot(A, D, grotto.x, grotto.z, 5.2, 2.0, 0.85); if (w) X.node('hqm', w.x, w.z); }
  { const w = wallSpot(A, D, grotto.x, grotto.z, 5.2, -1.2, 0.75); if (w) { X.container('cache', w.x, w.z, Math.atan2(w.n[1], w.n[0])); } }
  { const w = wallSpot(A, D, grotto.x, grotto.z, 5.2, 3.0, 0.55); if (w) skeleton(D, w.x, w.z, Math.atan2(w.n[1], w.n[0])); }
  shrooms(D, grotto.x + 1.2, grotto.z + 2.4, 6, 0.6);
  X.light(grotto.x, grotto.z, 2.2, '#7ae8ff', 1.0, 9);
  for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + R(), r = 1 + R() * 2.2, x = grotto.x + Math.cos(a) * r, z = grotto.z + Math.sin(a) * r, c = ceilAt(A, D, x, z); if (c && c > 4) stalactite(D, x, z, c, 0.5 + R() * 0.9, 0.16 + R() * 0.14); }
  // ---- east passage
  shrooms(D, 3.4, -12.6, 5, 0.5, '#c8a0ff');
  { const w = wallSpot(A, D, 9.2, 10.0, 2.4, 2.4, 0); if (w) torch(D, w.wx, w.wz, w.n, { light: false }); }
  lanternPost(D, 17.8, 18.8, { i: 1.0 });
  // ---- den: bones, a nest of branches, ore; a bear or a pair of wolves (sometimes empty)
  bones(D, den.x + 0.4, den.z - 0.6, 7);
  for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + R() * 0.4; D.add('log', GEO.cyl5, { p: [den.x + 1.2 + Math.cos(a) * 0.9, 0.06, den.z + 1.0 + Math.sin(a) * 0.9], dir: [-Math.sin(a), 0.05, Math.cos(a)], s: [0.04, 1.1, 0.04], col: '#5a4030' }); }
  { const w = wallSpot(A, D, den.x, den.z, 5, -0.9, 0.85); if (w) X.node(R() < 0.5 ? 'sulfur' : 'metal', w.x, w.z); }
  { const w = wallSpot(A, D, den.x, den.z, 5, 1.0, 0.7); if (w) X.container('crate', w.x, w.z, Math.atan2(w.n[1], w.n[0])); }
  for (const [ang, kind] of [[0.3, 'violet'], [-2.2, 'amber']]) { const w = wallSpot(A, D, den.x, den.z, 5, ang, 0.1); if (w) crystals(D, w.x, 0.05, w.z, [w.n[0], 0.9, w.n[1]], 4, 0.8, kind); }
  X.light(den.x, den.z, 2.0, '#c890ff', 0.7, 8);
  const roll = R();
  if (roll < 0.45) X.npc('bear', den.x + 0.6, den.z + 0.4, {});
  else if (roll < 0.85) { X.npc('wolf', den.x + 1.0, den.z - 0.8, {}); X.npc('wolf', den.x - 0.8, den.z + 1.0, {}); }
  D.flush();
}

// ============================================================================
export const CAVE_LAYOUTS = { cave };
export const CAVE_MONUMENTS = {
  cave: { name: 'Cave', tier: 1, count: 5, size: 26, late: true, desc: 'A rocky outcrop with a winding cave: an old camp, a crystal grotto with ore, and something living in the deepest chamber.' },
};
export const CAVE_LOOT = {};
/** dev: drop cached analyses (viewer hot reload) */
export function _caveDebug() {
  const P = t => t.map(p => [p[0], p[1]]);
  const interior = (type, v, x, z) => { const A = PREP[type](v); return bil(A.sh, slice2(A.sh, 'Hb'), x, z) < -0.6 && bil(A.sh, slice2(A.sh, 'Cb'), x, z) < 0; };
  return { SITE_CACHE, PREP, interior, paths: { cave: CAVE_DESIGN.tunnels.map(P) }, mirrorOf: (type, mon) => (((mon.variant ?? 0) & 1) ? -1 : 1) };
}
