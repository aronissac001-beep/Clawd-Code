// ============================================================================
// ZONEFALL — cargo ship world event: the container ship NORTHWIND.
//
//   const ship = makeCargoShip();
//   ship.root       Group: the whole ship except the gangway (frame below)
//   ship.gangway    Group in the same ship-local frame (parent it to root, toggle .visible)
//   ship.lights     [{ x, y, z, color, intensity, range, name }] ship-local point-light spots
//   ship.props      [{ name, x0, x1, y0, y1, z0, z1 }] ship-local AABBs of the deck clutter,
//                   furniture and extra walls / rails this model adds beyond the brief
//   ship.update(dt) spins the radar scanners, blinks the mast-top light, flutters the flag
//
// Ship-local frame (metres): +X = bow, -Z = port (the quay side), Y up, Y = 0 the
// waterline, origin amidships. Walkable tops sit exactly at: main deck 5.0, bridge
// level 8.4, ramp X -26..-13 (8.4 -> 5.0), gangway X -14..-2.4 (1.0 -> 5.0) + landing
// 5.0, low hatch 5.5. SHIP_INFO.halfBeam(x) gives the deck / bulwark outline.
//
// Same conventions as models_world: static geometry is baked (M.bake, one mesh
// per texture) once and shared by every call, so never dispose() what this
// returns. Animated parts are separate, un-baked children.
// ============================================================================
import { THREE, M } from './materials.js';

const PI = Math.PI;

// ----------------------------------------------------------------- layout
const STERN = -38, TIP = 38, ENTRY = 26, KEEL = -4, DECK = 5.0, BRIDGE = 8.4, ROOF = 11.4;
const RAIL_H = 1.1;
const BUL_X = 20;                                 // solid bow bulwark from here forward, pipe railing aft of it
const GAP = [-2.4, 0];                            // port railing opening where the gangway lands
const CL = 6.1, CW = 2.4, CH = 2.6;               // container slot: length (X), width (Z), height
const BLOCKS = [
  { name: 'A', x0: 18, tiers: 2 }, { name: 'B', x0: 8, tiers: 3 },
  { name: 'C', x0: -2, tiers: 3 }, { name: 'D', x0: -12, tiers: 2 },
];
const RAMP = { x0: -26, x1: -13, z0: 4.4, z1: 6.6 };          // surface 8.4 at x0 -> 5.0 at x1
const GANG = { x0: -14, x1: -2.4, x2: 0, z0: -9.4, z1: -7.2, y0: 1.0 };

// ----------------------------------------------------------------- hull lines
const sm = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const depthK = y => { const s = (DECK - y) / (DECK - KEEL); return s < 0 ? 0 : s > 1 ? 1 : s; };
const stemX = y => TIP - 2.6 * depthK(y) - 1.6 * depthK(y) ** 2;   // raked stem: 38 at the deck, ~33.8 at the keel
const entryX = y => ENTRY - 7 * depthK(y);                          // where the bow taper starts (finer below water)
const botY = x => KEEL + 2.8 * sm(-30, -38, x);                     // flat bottom, rising aft under the stern
function halfW(x, y) {
  let w = 7;
  const h = y - botY(x);
  if (h < 1.4) { const d = 1.4 - Math.max(0, h); w = 5.6 + Math.sqrt(Math.max(0, 1.96 - d * d)); } // bilge radius
  const e = entryX(y), t = stemX(y);
  if (x > e) { const u = Math.min(1, (x - e) / (t - e)); w *= 1 - Math.pow(u, 1.7); }
  return w > 0 ? w : 0;
}
/** deck / bulwark half-beam at ship-local x: 7 from the stern to x = 26, tapering to 0 at the bow tip (x = 38) */
export function deckHalfBeam(x) { return x < STERN || x > TIP ? 0 : halfW(x, DECK); }

export const SHIP_INFO = {
  len: 76, beam: 14, deckY: DECK, bridgeY: BRIDGE,
  roofY: ROOF, sternX: STERN, bowX: TIP, bowStart: ENTRY, railH: RAIL_H,
  halfBeam: deckHalfBeam,
  blocks: BLOCKS.map(b => ({ name: b.name, x0: b.x0, x1: b.x0 + CL, z0: -4.8, z1: 4.8, y0: DECK, y1: DECK + b.tiers * CH, tiers: b.tiers })),
};

// ----------------------------------------------------------------- utils / materials
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = () => new THREE.Group();
function shade(hex, k) { const c = new THREE.Color(hex).multiplyScalar(k); return '#' + c.getHexString(); }
const C = hex => M.mat(hex);                       // plain colour
const T = (hex, tex) => M.mat(hex, { tex });       // tinted texture
const S = name => M.surf(name);                    // named surface
const GL = hex => M.basic(hex);                    // unlit glow

const COL = {
  hull: '#235a84', boot: '#efebe0', anti: '#93322a', deck: '#5d7a58', line: '#e2b33a',
  white: '#ebe7dc', trim: '#24857f', dark: '#2a2c31', steel: '#7f878e', rail: '#ece8de', yellow: '#e0b23a',
  orange: '#e8742a', machine: '#3a6ea8', funnel: '#24857f',
};
const CONT = ['#c23b2c', '#2f62a6', '#3e8a46', '#e07b2c', '#e6e2d6', '#259a93', '#b5352a', '#3b74b8', '#d0662a', '#2c8a84', '#4f9a4a', '#dcd8cc'];

let _glass = null, _glow = null, _atlas = null;
function glassMat() { return _glass || (_glass = M.mat('#9cc8d8', { transparent: true, opacity: 0.3, side: 'double' })); }
function glowMat() { return _glow || (_glow = M.basic('#ffffff', { vc: true })); }

// ----------------------------------------------------------------- geometry helpers (as models_world)
function bx(p, m, w, h, d, x = 0, y = 0, z = 0, o) { return M.add(p, M.box(w, h, d, (o && o.ts) || 2), m, x, y, z, o); }
function bb(p, m, w, h, d, x = 0, y0 = 0, z = 0, o) { return bx(p, m, w, h, d, x, y0 + h / 2, z, o); }
function cv(p, m, rt, rb, h, x = 0, y0 = 0, z = 0, seg = 10, o) { return M.add(p, M.cyl(rt, rb, h, seg), m, x, y0 + h / 2, z, o); }
function cxl(p, m, r, len, x = 0, y = 0, z = 0, seg = 10, o) { return M.add(p, M.cyl(r, r, len, seg), m, x, y, z, Object.assign({ rz: PI / 2 }, o)); }
function czl(p, m, r, len, x = 0, y = 0, z = 0, seg = 10, o) { return M.add(p, M.cyl(r, r, len, seg), m, x, y, z, Object.assign({ rx: PI / 2 }, o)); }
const _up = V3(0, 1, 0);
function orient(mesh, a, b) {
  const A = V3(a[0], a[1], a[2]), B = V3(b[0], b[1], b[2]);
  const d = new THREE.Vector3().subVectors(B, A); const L = d.length() || 1e-4;
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, d.divideScalar(L));
  return L;
}
function rod(p, m, r, a, b, seg = 6) { const me = M.add(p, M.cyl(r, r, 1, seg), m); me.scale.y = orient(me, a, b); return me; }
function rodT(p, m, r0, r1, a, b, seg = 6) { const me = M.add(p, M.cyl(r1, r0, 1, seg), m); me.scale.y = orient(me, a, b); return me; }
function beam(p, m, w, d, a, b) { const me = M.add(p, M.box(w, 1, d, 1), m); me.scale.y = orient(me, a, b); return me; }
// box with world-aligned UVs so textures run seamlessly across neighbouring pieces
function wbox(p, m, w, h, d, x, y, z, ts = 2) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
  const pos = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    if (ax > 0.5) uv.setXY(i, pz / ts, py / ts); else if (ay > 0.5) uv.setXY(i, px / ts, pz / ts); else uv.setXY(i, px / ts, py / ts);
  }
  return M.add(p, g, m);
}
const box3 = (p, m, x0, y0, z0, x1, y1, z1, ts = 2) => wbox(p, m, x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, ts);
// vertex-coloured unlit geometry: every lamp lens / screen on the ship shares ONE glow material (one draw call)
function tint(geo, hex) {
  const g = geo.clone(), n = g.attributes.position.count, c = new THREE.Color(hex), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function glow(p, hex, geo, x, y, z, o = {}) { return M.add(p, tint(geo, hex), glowMat(), x, y, z, Object.assign({ cast: false }, o)); }
const _torus = new Map();
function torus(R, r, rs = 6, ts = 14) { const k = `${R},${r},${rs},${ts}`; if (!_torus.has(k)) _torus.set(k, new THREE.TorusGeometry(R, r, rs, ts)); return _torus.get(k); }

// Wall in the plane x = const (thickness t), spanning z0..z1 / y0..y1, with rectangular holes [za, zb, ya, yb].
function wallX(p, m, x, t, z0, z1, y0, y1, holes = [], ts = 2) {
  const zs = [...new Set([z0, z1, ...holes.flatMap(h => [h[0], h[1]])])].filter(v => v >= z0 && v <= z1).sort((a, b) => a - b);
  for (let i = 0; i < zs.length - 1; i++) {
    const za = zs[i], zb = zs[i + 1], zm = (za + zb) / 2; if (zb - za < 1e-4) continue;
    let y = y0;
    for (const [ya, yb] of holes.filter(h => h[0] <= zm && h[1] >= zm).map(h => [h[2], h[3]]).sort((a, b) => a[0] - b[0])) {
      if (ya > y + 1e-4) wbox(p, m, t, ya - y, zb - za, x, (y + ya) / 2, zm, ts); y = Math.max(y, yb);
    }
    if (y1 > y + 1e-4) wbox(p, m, t, y1 - y, zb - za, x, (y + y1) / 2, zm, ts);
  }
}
// Wall in the plane z = const, spanning x0..x1 / y0..y1, holes [xa, xb, ya, yb].
function wallZ(p, m, z, t, x0, x1, y0, y1, holes = [], ts = 2) {
  const xs = [...new Set([x0, x1, ...holes.flatMap(h => [h[0], h[1]])])].filter(v => v >= x0 && v <= x1).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const xa = xs[i], xb = xs[i + 1], xm = (xa + xb) / 2; if (xb - xa < 1e-4) continue;
    let y = y0;
    for (const [ya, yb] of holes.filter(h => h[0] <= xm && h[1] >= xm).map(h => [h[2], h[3]]).sort((a, b) => a[0] - b[0])) {
      if (ya > y + 1e-4) wbox(p, m, xb - xa, ya - y, t, xm, (y + ya) / 2, z, ts); y = Math.max(y, yb);
    }
    if (y1 > y + 1e-4) wbox(p, m, xb - xa, y1 - y, t, xm, (y + y1) / 2, z, ts);
  }
}
// sloped plate whose TOP surface runs exactly through the (x, y) points a and b; spans z0..z1
function slope(p, m, a, b, z0, z1, t, ts = 2) {
  if (a[0] > b[0]) [a, b] = [b, a];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  const nx = -Math.sin(ang), ny = Math.cos(ang);
  return M.add(p, M.box(L, t, z1 - z0, ts), m, (a[0] + b[0]) / 2 - nx * t / 2, (a[1] + b[1]) / 2 - ny * t / 2, (z0 + z1) / 2, { rz: ang });
}
// floor / roof slab: core in `core` (its underside is the ceiling below), a 0.1 m fascia rim in `rim`
function slabRim(p, core, rim, x0, x1, z0, z1, y0, y1) {
  box3(p, core, x0 + 0.1, y0, z0 + 0.1, x1 - 0.1, y1, z1 - 0.1);
  box3(p, rim, x0, y0, z0, x1, y1, z0 + 0.1); box3(p, rim, x0, y0, z1 - 0.1, x1, y1, z1);
  box3(p, rim, x0, y0, z0 + 0.1, x0 + 0.1, y1, z1 - 0.1); box3(p, rim, x1 - 0.1, y0, z0 + 0.1, x1, y1, z1 - 0.1);
}
// straight railing on a level floor y0 from (x0, z0) to (x1, z1): posts + three courses, top exactly at y0 + h
function rail(p, m, x0, z0, x1, z1, y0, o = {}) {
  const h = o.h || RAIL_H, step = o.step || 1.5, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.05) return;
  const n = Math.max(1, Math.round(L / step)), ry = Math.atan2(-dz, dx), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  for (let i = 0; i <= n; i++) { if ((i === 0 && o.noStart) || (i === n && o.noEnd)) continue; const t = i / n; bb(p, m, 0.06, h, 0.06, x0 + dx * t, y0, z0 + dz * t); }
  bx(p, m, L + 0.06, 0.06, 0.07, mx, y0 + h - 0.03, mz, { ry });
  bx(p, m, L, 0.04, 0.04, mx, y0 + h * 0.64, mz, { ry });
  if (!o.two) bx(p, m, L, 0.04, 0.04, mx, y0 + h * 0.32, mz, { ry });
  if (o.toe) bx(p, o.toe, L, 0.12, 0.03, mx, y0 + 0.06, mz, { ry });
}
// handrail along a slope: a, b = [x, y, z] points ON the walking surface
function srail(p, m, a, b, o = {}) {
  const h = o.h || 1.0, step = o.step || 1.6, L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.round(L / step));
  for (let i = 0; i <= n; i++) { const t = i / n; bb(p, m, 0.06, h, 0.06, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); }
  beam(p, m, 0.07, 0.07, [a[0], a[1] + h - 0.035, a[2]], [b[0], b[1] + h - 0.035, b[2]]);
  beam(p, m, 0.045, 0.045, [a[0], a[1] + h * 0.55, a[2]], [b[0], b[1] + h * 0.55, b[2]]);
}

// ----------------------------------------------------------------- decal atlas (hull name, stern, signs, logos)
const AT = 1024;
const REG = {
  name: [0, 0, 1024, 160], stern: [0, 160, 1024, 400],
  emblem: [0, 400, 256, 656], thruster: [256, 400, 512, 656], plimsoll: [512, 400, 768, 656], bulb: [768, 400, 1024, 656],
  brand0: [0, 664, 1024, 784], brand1: [0, 784, 1024, 904], brand2: [0, 904, 1024, 1024],
};
function atlasMat() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas'); c.width = c.height = AT; const x = c.getContext('2d');
  const font = px => `900 ${px}px "Arial Black", "Helvetica Neue", Helvetica, Arial, sans-serif`;
  const say = (s, cx, cy, px, fill, stroke, lw, maxW) => {
    x.font = font(px); x.textAlign = 'center'; x.textBaseline = 'middle';
    const w = x.measureText(s).width, k = maxW && w > maxW ? maxW / w : 1;
    x.save(); x.translate(cx, cy); x.scale(k, 1);
    if (stroke) { x.lineJoin = 'round'; x.strokeStyle = stroke; x.lineWidth = lw; x.strokeText(s, 0, 0); }
    x.fillStyle = fill; x.fillText(s, 0, 0); x.restore();
  };
  const ink = '#14161c', wh = '#f4f1e8';
  say('NORTHWIND', 512, 84, 136, wh, ink, 16, 980);
  say('NORTHWIND', 512, 238, 118, wh, ink, 14, 900);
  say('PORT ALBA', 512, 344, 64, wh, ink, 10, 520);
  // funnel emblem: white disc, yellow compass star, bold N
  const [ex, ey] = [128, 528];
  x.fillStyle = ink; x.beginPath(); x.arc(ex, ey, 122, 0, 7); x.fill();
  x.fillStyle = wh; x.beginPath(); x.arc(ex, ey, 108, 0, 7); x.fill();
  x.fillStyle = '#e0b23a'; x.strokeStyle = ink; x.lineWidth = 6; x.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * PI / 4 - PI / 2, r = i % 2 ? 34 : 100; x.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r); }
  x.closePath(); x.fill(); x.stroke();
  say('N', ex, ey + 6, 92, '#1f4a6e', ink, 8);
  // bow thruster mark: circle with a cross
  x.strokeStyle = wh; x.lineWidth = 16; x.beginPath(); x.arc(384, 528, 92, 0, 7); x.stroke();
  x.beginPath(); x.moveTo(320, 464); x.lineTo(448, 592); x.moveTo(448, 464); x.lineTo(320, 592); x.stroke();
  // load-line (plimsoll) mark
  x.lineWidth = 12; x.beginPath(); x.arc(640, 540, 74, 0, 7); x.stroke();
  x.fillStyle = wh; x.fillRect(540, 534, 200, 13);
  say('Z', 580, 456, 54, wh); say('F', 700, 456, 54, wh);
  // bulbous bow mark
  x.lineWidth = 14; x.beginPath(); x.moveTo(880, 430); x.lineTo(880, 560); x.stroke();
  x.beginPath(); x.arc(880, 590, 34, 0, 7); x.stroke(); x.beginPath(); x.moveTo(800, 520); x.lineTo(960, 520); x.stroke();
  // container lines (plain white stencils)
  say('MARLINE', 512, 724, 104, wh, null, 0, 900);
  say('KORVO LINES', 512, 844, 96, wh, null, 0, 960);
  say('TESSARA', 512, 964, 104, wh, null, 0, 900);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (_atlas = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5 }));
}
function decal(p, reg, w, h, x, y, z, ry = 0) {
  const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv;
  const u0 = reg[0] / AT, u1 = reg[2] / AT, v1 = 1 - reg[1] / AT, v0 = 1 - reg[3] / AT;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
  return M.add(p, geo, atlasMat(), x, y, z, { ry, cast: false });
}

// ----------------------------------------------------------------- hull surfaces
const NM = 29, NB = 26;                           // mid-body columns (-38..20, every 2 m), bow columns (20..stem)
function rowXs(y) {
  const xs = []; for (let c = 0; c <= NM; c++) xs.push(STERN + (20 - STERN) * c / NM);
  const t = stemX(y); for (let j = 1; j <= NB; j++) xs.push(20 + (t - 20) * (1 - Math.pow(1 - j / NB, 1.35)));
  return xs;
}
// rows of [x, y]: the anti-fouling band is stretched so it follows the rising bottom under the stern
function bandGrid(knots, stretchTop = null) {
  return knots.map(k => rowXs(k).map(x => [x, stretchTop == null ? k : botY(x) + (k - KEEL) * (stretchTop - botY(x)) / (stretchTop - KEEL)]));
}
// generic grid -> indexed geometry; winding picked so faces point along `want`
function gridGeo(P, want, uvFn, nFn) {
  const R = P.length, Cn = P[0].length, pos = new Float32Array(R * Cn * 3), uv = new Float32Array(R * Cn * 2), nor = nFn ? new Float32Array(R * Cn * 3) : null;
  for (let r = 0; r < R; r++) for (let c = 0; c < Cn; c++) {
    const i = r * Cn + c, q = P[r][c]; pos.set(q, i * 3); uv.set(uvFn(q), i * 2); if (nFn) nor.set(nFn(q), i * 3);
  }
  const idx = []; let flip = null; const a = V3(), b = V3(), cc = V3();
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < Cn - 1; c++) {
    const i0 = r * Cn + c, i1 = i0 + 1, i2 = i0 + Cn + 1, i3 = i0 + Cn;
    if (flip === null) {
      a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3).sub(a); cc.fromArray(pos, i2 * 3).sub(a);
      const n = b.clone().cross(cc); if (n.lengthSq() < 1e-8) { b.fromArray(pos, i2 * 3).sub(a); cc.fromArray(pos, i3 * 3).sub(a); n.copy(b).cross(cc); }
      if (n.lengthSq() > 1e-8) flip = n.dot(V3(want[0], want[1], want[2])) < 0;
    }
  }
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < Cn - 1; c++) {
    const i0 = r * Cn + c, i1 = i0 + 1, i2 = i0 + Cn + 1, i3 = i0 + Cn;
    if (flip) idx.push(i0, i2, i1, i0, i3, i2); else idx.push(i0, i1, i2, i0, i2, i3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  if (nFn) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); else g.computeVertexNormals();
  return g;
}
// hull side at z = side * (halfW + off), analytic normals (seamless across the colour bands)
function hullSide(grid, side, off = 0, inward = false, ts = 3) {
  const P = grid.map(row => row.map(([x, y]) => [x, y, side * Math.max(0, halfW(x, y) + off)]));
  const e = 0.03, s = inward ? -1 : 1;
  const nFn = ([x, y]) => {
    const wx = (halfW(x + e, y) - halfW(x - e, y)) / (2 * e), wy = (halfW(x, y + e) - halfW(x, y - e)) / (2 * e);
    const n = V3(-wx, -wy, side).normalize().multiplyScalar(s); return [n.x, n.y, n.z];
  };
  return gridGeo(P, [0, 0, side * s], q => [q[0] / ts, q[1] / ts], nFn);
}

function buildHull(g) {
  const ts = 3, anti = T(COL.anti, 'metal'), boot = T(COL.boot, 'metal'), top = T(COL.hull, 'metal');
  const bands = [
    { m: anti, grid: bandGrid([-4, -3.93, -3.75, -3.47, -3.08, -2.6, -1.5, -0.4, 0.4], 0.4) },
    { m: boot, grid: bandGrid([0.4, 0.8]) },
    { m: top, grid: bandGrid([0.8, 1.7, 2.6, 3.4, 4.2, DECK]) },
  ];
  for (const b of bands) {
    for (const s of [-1, 1]) M.add(g, hullSide(b.grid, s), b.m);
    // flat transom at x = -38 from the band's stern column
    const P = b.grid.map(row => { const y = row[0][1], w = halfW(STERN, y); return [[STERN, y, -w], [STERN, y, w]]; });
    M.add(g, gridGeo(P, [-1, 0, 0], q => [q[2] / ts, q[1] / ts]), b.m);
  }
  // flat bottom
  const xs = bands[0].grid[0].map(q => q[0]);
  M.add(g, gridGeo([xs.map(x => [x, botY(x), -halfW(x, botY(x))]), xs.map(x => [x, botY(x), halfW(x, botY(x))])], [0, -1, 0], q => [q[0] / ts, q[2] / ts]), anti);
  // bow bulwark: hull colour outside, white inside and on the cap
  const bxs = rowXs(DECK).filter(x => x >= BUL_X - 1e-6);
  const bulTop = x => DECK + RAIL_H + 0.55 * sm(28, 38, x);
  const grid = [bxs.map(x => [x, DECK]), bxs.map(x => [x, bulTop(x)])];
  const cap = C(COL.rail);
  for (const s of [-1, 1]) {
    M.add(g, hullSide(grid, s), top);
    M.add(g, hullSide(grid, s, -0.15, true), T('#d8d4c8', 'metal'));
    M.add(g, gridGeo([bxs.map(x => [x, bulTop(x), s * halfW(x, DECK)]), bxs.map(x => [x, bulTop(x), s * Math.max(0, halfW(x, DECK) - 0.15)])], [0, 1, 0], q => [q[0], q[2]]), cap);
    bb(g, cap, 0.06, RAIL_H, 0.16, BUL_X + 0.03, DECK, s * 6.92);          // end of the bulwark plate
  }
  // hull markings
  for (const s of [-1, 1]) {
    const ry = s > 0 ? 0 : PI, z = s * 7.025;
    decal(g, REG.name, 12, 1.875, 18.2, 3.6, z, ry);
    decal(g, REG.thruster, 1.0, 1.0, 22.6, 1.7, z, ry);
    decal(g, REG.bulb, 1.0, 1.0, 21.2, 1.7, z, ry);
    decal(g, REG.plimsoll, 1.5, 1.5, 4.2, 2.2, z, ry);
  }
  decal(g, REG.stern, 10, 2.34, STERN - 0.025, 3.5, 0, -PI / 2);
}

// ----------------------------------------------------------------- deck
const INTERIOR = [[-35.8, -5.8], [-26.2, -5.8], [-26.2, 4.2], [-27.2, 4.2], [-27.2, 5.8], [-35.8, 5.8]];
function deckOutline(inset) {
  const xs = rowXs(DECK), pts = [];
  const w = x => Math.max(0, halfW(x, DECK) - (x > BUL_X - 1 ? 0.13 : inset));   // the bow flares: keep the slab sides inside the hull
  for (const x of xs) pts.push([x === STERN ? x + inset : x, -w(x)]);
  for (let i = xs.length - 2; i >= 0; i--) pts.push([xs[i] === STERN ? xs[i] + inset : xs[i], w(xs[i])]);
  return pts;
}
function slabGeo(outline, holes, depth, ts) {
  const sh = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, z))));
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(PI / 2);                                         // shape (x, z) -> world (x, z); extruded downwards from y = 0
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / ts, uv.getY(i) / ts);
  return geo;
}
function buildDeck(g, props) {
  const geo = slabGeo(deckOutline(0.03), [INTERIOR], 0.3, 2.5); geo.translate(0, DECK, 0);
  M.add(g, geo, T(COL.deck, 'metal'));
  const fl = slabGeo(INTERIOR, [], 0.3, 1.6); fl.translate(0, DECK, 0);
  M.add(g, fl, T('#9a7a52', 'plank'));                         // crew mess + quarters floor (top 5.0)
  // painted walkway lines (1.2 cm decals) along the container blocks and at the block ends
  const yl = C(COL.line), y = DECK + 0.006;
  bx(g, yl, 52, 0.012, 0.1, 0, y, -4.87);
  bx(g, yl, 39, 0.012, 0.1, 6.5, y, 4.87);
  for (const b of BLOCKS) for (const x of [b.x0 - 0.12, b.x0 + CL + 0.12]) bx(g, yl, 0.1, 0.012, 9.64, x, y, 0);
  // low hatch cover in front of the tower (top 5.5)
  const coam = T('#7a3a2c', 'metal'), lid = T('#3a5f8f', 'metal');
  box3(g, coam, -21.2, DECK, -2.8, -16.2, DECK + 0.32, 0.8);
  box3(g, lid, -21.1, DECK + 0.32, -2.7, -16.3, DECK + 0.5, 0.7);
  for (const x of [-20.5, -18.7, -16.9]) for (const z of [-2.83, 0.83]) bb(g, C(COL.dark), 0.3, 0.24, 0.06, x, DECK + 0.08, z);
  bx(g, S('hazard'), 4.8, 0.012, 0.12, -18.7, DECK + 0.506, -2.64, { ts: 0.6 });
  props.push({ name: 'hatch (walkable top 5.5)', x0: -21.2, x1: -16.2, y0: DECK, y1: DECK + 0.5, z0: -2.8, z1: 0.8 });
}

// ----------------------------------------------------------------- railings
function buildRailings(g, props) {
  const m = C(COL.rail), toe = C('#d8d4c8'), y = DECK, zr = 6.95;
  // starboard side, stern -> bow bulwark
  rail(g, m, STERN + 0.05, zr, BUL_X - 0.04, zr, y, { toe });
  // port side, with the gangway opening
  rail(g, m, STERN + 0.05, -zr, GAP[0] - 0.05, -zr, y, { toe });
  rail(g, m, GAP[1] + 0.05, -zr, BUL_X - 0.04, -zr, y, { toe });
  // stern
  rail(g, m, STERN + 0.05, -zr, STERN + 0.05, zr, y, { toe, step: 1.4 });
  // gangway opening: hazard-striped stanchions + a yellow lamp post
  const haz = S('hazard');
  for (const x of GAP) bb(g, haz, 0.12, RAIL_H + 0.05, 0.12, x + (x < -1 ? -0.06 : 0.06), y, -zr, { ts: 0.5 });
  const dk = C(COL.dark);
  bb(g, dk, 0.08, 1.8, 0.08, GAP[0] - 0.4, y + RAIL_H, -zr);
  bb(g, dk, 0.32, 0.22, 0.26, GAP[0] - 0.4, y + RAIL_H + 1.72, -zr - 0.04);
  glow(g, '#fff1c8', M.box(0.24, 0.06, 0.2), GAP[0] - 0.4, y + RAIL_H + 1.69, -zr - 0.04);
  props.push({ name: 'gangway gap post aft', x0: GAP[0] - 0.12, x1: GAP[0], y0: y, y1: y + RAIL_H + 0.05, z0: -7.01, z1: -6.89 });
  props.push({ name: 'gangway gap post fwd', x0: GAP[1], x1: GAP[1] + 0.12, y0: y, y1: y + RAIL_H + 0.05, z0: -7.01, z1: -6.89 });
}

// ----------------------------------------------------------------- bow / forecastle
function anchorAt(g, x, side) {
  // place on the hull surface at (x, 3.9) aligned with the local hull normal
  const y = 3.9, e = 0.05, w = halfW(x, y), wx = (halfW(x + e, y) - halfW(x - e, y)) / (2 * e);
  const ry = Math.atan2(-wx, side);
  const grp = G(); grp.position.set(x, y, side * w); grp.rotation.y = ry; g.add(grp);
  const dk = C('#25272b'), rim = C('#3a3d42'), stl = C('#4a4e54');
  czl(grp, rim, 0.62, 0.16, 0, 0, 0.0, 14);                  // hawse rim
  czl(grp, C('#0e0f12'), 0.48, 0.18, 0, 0, 0.02, 14);        // dark pipe mouth
  // stockless anchor hanging flat against the hull
  bx(grp, stl, 0.22, 1.9, 0.22, 0, -0.95, 0.2);               // shank
  bx(grp, stl, 1.5, 0.3, 0.3, 0, -1.95, 0.24);                // crown
  for (const s of [-1, 1]) beam(grp, stl, 0.3, 0.26, [s * 0.65, -2.0, 0.24], [s * 0.85, -1.05, 0.34]); // flukes
  for (const s of [-1, 1]) M.add(grp, M.cone(0.17, 0.4, 4), stl, s * 0.88, -0.86, 0.36, { rz: -s * 0.2 });
  M.add(grp, torus(0.2, 0.06, 5, 10), dk, 0, 0.02, 0.22);
}
function buildBow(g, props) {
  const blue = T(COL.machine, 'metal'), dk = C(COL.dark), dk2 = C('#3a3d42'), wh = C(COL.white), yl = C(COL.yellow), chain = C('#2e3034');
  for (const s of [-1, 1]) {
    anchorAt(g, 33.4, s);
    // windlass: bed, motor housing, gypsy wheel, warping drum
    const x = 31.0, z = s * 1.9;
    bb(g, dk2, 1.9, 0.25, 1.7, x, DECK, z);
    bb(g, blue, 1.0, 0.75, 0.7, x - 0.45, DECK + 0.25, z - s * 0.35);
    czl(g, dk, 0.45, 0.32, x + 0.35, DECK + 0.95, z + s * 0.1, 14);
    czl(g, blue, 0.2, 0.9, x + 0.35, DECK + 0.95, z - s * 0.4, 10);
    czl(g, C('#b08a58'), 0.3, 0.5, x - 0.45, DECK + 0.62, z + s * 0.55, 10);   // rope drum
    for (const zz of [z - s * 0.75, z + s * 0.75]) bb(g, blue, 0.25, 0.75, 0.12, x + 0.35, DECK + 0.25, zz);
    props.push({ name: 'windlass', x0: x - 0.95, x1: x + 0.95, y0: DECK, y1: DECK + 1.45, z0: z - 0.85, z1: z + 0.85 });
    // chain from the gypsy to the chain pipe
    const a = [x + 0.6, DECK + 1.3, z + s * 0.1], b = [33.6, DECK + 0.22, s * 2.6], n = 16;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * PI) * 0.1, a[2] + (b[2] - a[2]) * t];
      const lk = M.add(g, i % 2 ? M.box(0.2, 0.05, 0.13) : M.box(0.2, 0.13, 0.05), chain, p[0], p[1], p[2]);
      lk.rotation.set(0, Math.atan2(-(b[2] - a[2]), b[0] - a[0]), Math.atan2(b[1] - a[1], Math.hypot(b[0] - a[0], b[2] - a[2])));
    }
    cv(g, dk2, 0.34, 0.42, 0.22, 33.6, DECK, s * 2.6, 12);
    props.push({ name: 'chain pipe', x0: 33.2, x1: 34.0, y0: DECK, y1: DECK + 0.22, z0: s * 2.6 - 0.42, z1: s * 2.6 + 0.42 });
    // mooring bitts
    for (const [bxp, bzp] of [[28.2, s * 3.9], [35.0, s * 1.5]]) {
      bb(g, dk2, 1.05, 0.06, 0.42, bxp, DECK, bzp);
      for (const o of [-0.32, 0.32]) { cv(g, dk, 0.16, 0.16, 0.5, bxp + o, DECK + 0.06, bzp, 10); cv(g, dk, 0.21, 0.21, 0.05, bxp + o, DECK + 0.56, bzp, 10); }
      props.push({ name: 'bollard', x0: bxp - 0.53, x1: bxp + 0.53, y0: DECK, y1: DECK + 0.61, z0: bzp - 0.21, z1: bzp + 0.21 });
    }
    bb(g, dk2, 0.5, 0.22, 0.24, 28.2, DECK + RAIL_H, s * (halfW(28.2, DECK) - 0.075));   // fairleads on the bulwark cap
  }
  // foremast with the forward masthead light and a flood facing the deck
  cv(g, yl, 0.09, 0.14, 4.7, 36.3, DECK, 0, 10);
  bb(g, yl, 0.7, 0.06, 0.7, 36.3, DECK + 3.9, 0);
  bb(g, dk, 0.24, 0.3, 0.24, 36.3, DECK + 4.7, 0);
  glow(g, '#fffbe8', M.box(0.2, 0.18, 0.26), 36.3, DECK + 4.85, 0);
  bb(g, dk, 0.3, 0.32, 0.44, 36.05, DECK + 3.96, 0);
  glow(g, '#fff1c8', M.box(0.03, 0.24, 0.36), 35.89, DECK + 4.12, 0);
  M.add(g, M.cone(0.2, 0.28, 10), C('#c49a45'), 36.3, DECK + 2.6, 0.2, { rx: PI });   // ship's bell
  props.push({ name: 'foremast', x0: 36.1, x1: 36.5, y0: DECK, y1: DECK + 5.0, z0: -0.2, z1: 0.2 });
}

// ----------------------------------------------------------------- container blocks
function buildContainers(g) {
  const R = rng(4242), brands = [REG.brand0, REG.brand1, REG.brand2];
  let prev = -1;
  for (const b of BLOCKS) {
    const xc = b.x0 + CL / 2;
    for (let col = 0; col < 4; col++) {
      const zc = -4.8 + CW * (col + 0.5);
      let below = -1;
      for (let tier = 0; tier < b.tiers; tier++) {
        let k; do { k = (R() * CONT.length) | 0; } while (k === below || k === prev);
        below = k; prev = k;
        const hex = CONT[k], y0 = DECK + tier * CH;
        container(g, hex, xc, y0, zc, col === 0 ? -1 : col === 3 ? 1 : 0, R, brands, tier === b.tiers - 1);
      }
      // lashing rods on both block ends (first tier corner castings)
      const rodM = C('#26282c');
      for (const s of [-1, 1]) {
        const xe = xc + s * (CL / 2 + 0.03);
        rod(g, rodM, 0.025, [xe + s * 0.1, DECK + 0.05, zc - 0.95], [xe, DECK + CH - 0.1, zc + 0.75], 4);
        rod(g, rodM, 0.025, [xe + s * 0.1, DECK + 0.05, zc + 0.95], [xe, DECK + CH - 0.1, zc - 0.75], 4);
        for (const zz of [-0.95, 0.95]) bb(g, rodM, 0.1, 0.05, 0.1, xe + s * 0.1, DECK, zc + zz);
      }
    }
  }
}
function container(g, hex, xc, y0, zc, outer, R, brands, topTier) {
  const body = T(hex, 'corrugated'), frame = C(shade(hex, 0.5)), bar = C('#9aa0a6');
  const hw = 3.03 - 0.07, hd = 1.18 - 0.07;           // post centres
  wbox(g, body, 5.92, 2.5, 2.26, xc, y0 + 1.32, zc, 1.6);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, frame, 0.14, CH - 0.02, 0.14, xc + sx * hw, y0, zc + sz * hd);
  for (const sz of [-1, 1]) for (const yy of [y0, y0 + CH - 0.14]) if (sz === outer || (topTier && yy > y0)) bb(g, frame, 5.8, 0.13, 0.12, xc, yy, zc + sz * hd);
  for (const sx of [-1, 1]) for (const yy of [y0, y0 + CH - 0.14]) bb(g, frame, 0.12, 0.13, 2.1, xc + sx * hw, yy, zc);
  // door end faces aft (-X): lock bars + seam
  const xd = xc - 2.985;
  for (const dz of [-0.78, -0.3, 0.3, 0.78]) { bx(g, bar, 0.03, 2.2, 0.04, xd, y0 + 1.3, zc + dz); bx(g, frame, 0.05, 0.08, 0.14, xd - 0.01, y0 + 1.15, zc + dz + 0.06); }
  bx(g, frame, 0.03, 2.3, 0.04, xd, y0 + 1.3, zc);
  bx(g, C(shade(hex, 1.6)), 0.02, 0.32, 0.7, xd, y0 + 2.1, zc - 0.5);
  // brand stencil on the exposed long side
  if (outer && hex !== '#e6e2d6' && hex !== '#dcd8cc' && R() < 0.8) decal(g, brands[(R() * 3) | 0], 3.6, 0.42, xc + 0.3, y0 + 1.85, zc + outer * 1.141, outer > 0 ? 0 : PI);
}

// ----------------------------------------------------------------- bridge tower
function buildTower(g, props) {
  const W = T(COL.white, 'noise'), teal = T(COL.trim, 'metal'), dk = C(COL.dark), gd = S('glass_dark'), gl = glassMat();
  const walk = T(COL.deck, 'metal'), plank = T('#9a7a52', 'plank'), steel = C('#8d9399'), y0 = DECK, yC = BRIDGE - 0.3;
  // ---------------- first storey (deck level): crew mess X -30..-26, quarters X -36..-30
  const frontHoles = [[-1.2, 1.2, y0, 7.3], [-4.4, -2.6, 6.2, 7.4], [2.6, 3.8, 6.2, 7.4]];
  wallX(g, W, -26.1, 0.2, -6, 4.4, y0, yC, frontHoles);
  for (const [za, zb] of [[-4.4, -2.6], [2.6, 3.8]]) box3(g, gd, -26.13, 6.2, za, -26.07, 7.4, zb);
  wallZ(g, W, 4.3, 0.2, -27.2, -26.2, y0, yC);                 // recess under the ramp landing
  wallX(g, W, -27.1, 0.2, 4.4, 5.8, y0, yC);
  wallX(g, W, -35.9, 0.2, -6, 6, y0, yC);                      // back wall
  for (const s of [-1, 1]) wallZ(g, W, s * 5.9, 0.2, -36, -26, y0, yC);
  wallX(g, W, -30, 0.2, -5.8, 5.8, y0, yC, [[-1, 1, y0, 7.2]]); // partition with its doorway
  // portholes (glass both faces)
  for (const s of [-1, 1]) for (const x of [-34.4, -32.0, -28.6]) {
    czl(g, dk, 0.34, 0.28, x, 6.8, s * 5.9, 14); czl(g, gd, 0.27, 0.3, x, 6.8, s * 5.9, 14);
  }
  for (const z of [-3.6, 3.6]) { cxl(g, dk, 0.34, 0.28, -35.9, 6.8, z, 14); cxl(g, gd, 0.27, 0.3, -35.9, 6.8, z, 14); }
  // door trims + an open watertight door leaf parked against the front wall
  for (const [x, za, zb, yt] of [[-25.97, -1.2, 1.2, 7.3], [-30, -1, 1, 7.2]]) {
    for (const z of [za - 0.06, zb + 0.06]) bb(g, dk, x === -30 ? 0.24 : 0.08, yt - y0 + 0.08, 0.12, x, y0, z);
    bb(g, dk, x === -30 ? 0.24 : 0.08, 0.12, zb - za + 0.24, x, yt, (za + zb) / 2);
  }
  box3(g, T('#d6d2c6', 'metal'), -25.97, y0 + 0.08, 1.32, -25.9, 7.2, 2.42); bb(g, dk, 0.05, 0.16, 0.06, -25.87, 6.2, 2.25);
  // lifebuoys + fire box
  const or = C(COL.orange), whc = C(COL.white);
  const buoy = (x, y, z, ry) => { const r = G(); r.position.set(x, y, z); r.rotation.y = ry; g.add(r); M.add(r, torus(0.34, 0.08, 6, 16), or, 0, 0, 0); for (let i = 0; i < 4; i++) bx(r, whc, 0.1, 0.18, 0.18, Math.cos(i * PI / 2) * 0.34, Math.sin(i * PI / 2) * 0.34, 0, { rz: i * PI / 2 }); };
  buoy(-25.9, 6.6, -1.95, PI / 2);
  buoy(-26.9, 6.7, 5.3, PI / 2);
  box3(g, C('#c0392b'), -26.98, 5.6, 4.55, -26.75, 6.4, 4.95);
  // ceiling lights
  for (const [x, z] of [[-28, -3.2], [-28, 2.6], [-33, -2.8], [-33, 2.8]]) glow(g, '#fff4d8', M.box(0.9, 0.04, 0.3), x, yC - 0.02, z);
  // ---------------- bridge-level slab: walkway X -30..-26 (metal), cabin floor (plank); top exactly 8.4
  slabRim(g, W, teal, -36.08, -26.0, -6.08, 6.08, yC, BRIDGE - 0.1);
  box3(g, walk, -30.0, BRIDGE - 0.1, -6.0, -26.0, BRIDGE, 6.0, 2.5);
  box3(g, plank, -36.0, BRIDGE - 0.1, -6.0, -30.0, BRIDGE, 6.0, 1.6);
  bx(g, S('hazard'), 0.12, 0.012, 2.4, -26.08, BRIDGE + 0.006, 0, { ts: 0.6 });   // edge mark at the front-rail gap
  // walkway railings: front edge (gaps Z -1.2..1.2 and 4.4..6.0), short closer over the ramp top Z 6.0..6.6, both sides
  const rm = C(COL.rail);
  rail(g, rm, -26.05, -5.97, -26.05, -1.2, BRIDGE);
  rail(g, rm, -26.05, 1.2, -26.05, 4.4, BRIDGE);
  rail(g, rm, -26.05, 6.0, -26.05, 6.6, BRIDGE);
  for (const s of [-1, 1]) rail(g, rm, -29.9, s * 5.97, -26.05, s * 5.97, BRIDGE, { noEnd: s > 0 });
  props.push({ name: 'walkway side rail port', x0: -29.9, x1: -26.0, y0: BRIDGE, y1: BRIDGE + RAIL_H, z0: -6.0, z1: -5.94 });
  props.push({ name: 'walkway side rail starboard', x0: -29.9, x1: -26.0, y0: BRIDGE, y1: BRIDGE + RAIL_H, z0: 5.94, z1: 6.0 });
  props.push({ name: 'ramp top closer rail', x0: -26.08, x1: -26.02, y0: BRIDGE, y1: BRIDGE + RAIL_H, z0: 6.0, z1: 6.6 });
  props.push({ name: 'recess walls (deck level)', x0: -27.2, x1: -26.2, y0: DECK, y1: yC, z0: 4.2, z1: 5.8 });
  // ---------------- bridge cabin X -36..-30, walls 8.4..11.2, roof slab top 11.4
  const yb = BRIDGE, yr = ROOF - 0.2, wy0 = 9.3, wy1 = 10.95;
  const fw = [[-5.6, -4.27], [-4.17, -2.83], [-2.73, -1.4], [1.4, 2.73], [2.83, 4.17], [4.27, 5.6]].map(([a, b]) => [a, b, wy0, wy1]);
  wallX(g, W, -30, 0.2, -6, 6, yb, yr, [[-1, 1, yb, 10.6], ...fw]);
  const sw = [[-35.5, -34.3], [-34.2, -33.0], [-32.9, -31.7], [-31.6, -30.4]].map(([a, b]) => [a, b, wy0, wy1]);
  for (const s of [-1, 1]) wallZ(g, W, s * 5.9, 0.2, -36, -29.9, yb, yr, sw);
  const bw = [[-5.4, -3.9], [-3.8, -2.3], [2.3, 3.8], [3.9, 5.4]].map(([a, b]) => [a, b, 9.9, wy1]);
  wallX(g, W, -35.9, 0.2, -6, 6, yb, yr, bw);
  for (const [a, b, c, d] of fw) box3(g, gl, -30.03, c, a, -29.97, d, b);
  for (const s of [-1, 1]) for (const [a, b, c, d] of sw) box3(g, gl, a, c, s * 5.9 - 0.03, b, d, s * 5.9 + 0.03);
  for (const [a, b, c, d] of bw) box3(g, gl, -35.93, c, a, -35.87, d, b);
  for (const s of [-1, 1]) bb(g, dk, 0.14, 10.6 - yb + 0.1, 0.12, -29.97, yb, s * 1.06);
  bb(g, dk, 0.14, 0.12, 2.24, -29.97, 10.6, 0);
  for (const s of [-1, 1]) { bb(g, teal, 0.24, 0.12, 4.96, -30, 9.18, s * 3.58); bb(g, teal, 6.1, 0.12, 0.24, -32.95, 9.18, s * 5.9); }   // sill band
  // roof (visor overhang to -29.4)
  slabRim(g, W, teal, -36.08, -29.4, -6.08, 6.08, yr, ROOF - 0.08);
  box3(g, T('#9aa0a4', 'metal'), -36.08, ROOF - 0.08, -6.08, -29.4, ROOF, 6.08, 2.5);
  for (const [x, z] of [[-33, -3], [-33, 3], [-31.2, 0]]) glow(g, '#fff4d8', M.box(0.9, 0.04, 0.4), x, yr - 0.02, z);
  // ---------------- interior: crew mess
  const tbl = T('#b08a5c', 'plank'), cush = C('#3f6a8a'), wood = T('#7a5a3a', 'plank'), gry = C('#b7bcc0');
  box3(g, tbl, -29.0, 5.72, -4.0, -27.6, 5.8, -2.0, 1.2); cv(g, steel, 0.06, 0.06, 0.72, -28.3, y0, -3.0, 8); bb(g, steel, 0.5, 0.04, 0.5, -28.3, y0, -3.0);
  box3(g, cush, -29.6, y0, -4.0, -29.2, 5.46, -2.0); box3(g, cush, -27.4, y0, -4.0, -27.0, 5.46, -2.0);
  props.push({ name: 'mess table + benches', x0: -29.6, x1: -27.0, y0, y1: 5.8, z0: -4.0, z1: -2.0 });
  box3(g, gry, -29.9, y0, 1.6, -29.25, 5.95, 4.0); box3(g, C('#4a4e54'), -29.9, 5.95, 1.6, -29.22, 5.99, 4.0);
  for (const z of [2.2, 2.7]) cv(g, dk, 0.16, 0.16, 0.03, -29.55, 5.99, z, 10);
  box3(g, gry, -29.9, 7.0, 1.6, -29.55, 7.6, 4.0);
  box3(g, C('#d8dcdf'), -29.9, y0, 4.1, -29.2, 6.9, 5.0); bb(g, dk, 0.04, 0.5, 0.04, -29.18, 6.0, 4.85);
  props.push({ name: 'galley counter + fridge', x0: -29.9, x1: -29.2, y0, y1: 6.9, z0: 1.6, z1: 5.0 });
  // crew quarters: four bunks along the side walls, lockers on the back wall, a desk
  const blankets = ['#b8402f', '#3a6ea8', '#4f8a43', '#d0a838'];
  let bi = 0;
  for (const [s, xa, L] of [[-1, -34.7, 2.0], [-1, -32.6, 2.0], [1, -32.12, 1.97]]) {
    const z0 = s * 4.85, z1 = s * 5.75, zm = (z0 + z1) / 2;
    for (const x of [xa + 0.03, xa + L - 0.03]) for (const z of [z0 + s * 0.03, z1 - s * 0.03]) bb(g, dk, 0.06, 1.8, 0.06, x, y0, z);
    for (const yy of [5.3, 6.45]) {
      bb(g, dk, L, 0.08, 0.9, xa + L / 2, yy, zm);
      bb(g, C(blankets[bi++ % 4]), L - 0.1, 0.14, 0.82, xa + L / 2, yy + 0.08, zm);
      bb(g, whc, 0.4, 0.1, 0.6, xa + 0.3, yy + 0.22, zm);
    }
    props.push({ name: 'bunk', x0: xa, x1: xa + L, y0, y1: y0 + 1.8, z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  }
  for (const [za, zb] of [[-3.4, -1.4], [1.4, 3.4]]) {
    box3(g, C('#7d8a92'), -35.8, y0, za, -35.3, 6.9, zb);
    for (let z = za + 0.5; z < zb - 0.01; z += 0.5) bx(g, dk, 0.02, 1.8, 0.025, -35.29, 5.95, z);
    for (let z = za + 0.25; z < zb; z += 0.5) bx(g, dk, 0.03, 0.12, 0.03, -35.28, 6.0, z + 0.12);
    props.push({ name: 'lockers', x0: -35.8, x1: -35.3, y0, y1: 6.9, z0: za, z1: zb });
  }
  box3(g, wood, -30.8, 5.74, 2.0, -30.1, 5.8, 3.4); for (const z of [2.05, 3.35]) for (const x of [-30.75, -30.15]) bb(g, dk, 0.04, 0.74, 0.04, x, y0, z);
  props.push({ name: 'desk', x0: -30.8, x1: -30.1, y0, y1: 5.8, z0: 2.0, z1: 3.4 });
  // ---------------- interior: bridge (console on the back wall, two chairs, chart table)
  box3(g, C('#3d4a56'), -35.8, yb, -1.8, -35.0, 9.3, 1.8);
  // slanted control panel facing the operator (+X, up), screens + buttons on it
  const pa = -0.5, pc = [-35.2, 9.42], tg = [Math.cos(pa), Math.sin(pa)], pn = [-Math.sin(pa), Math.cos(pa)];
  const onPanel = (u, h) => [pc[0] + tg[0] * u + pn[0] * h, pc[1] + tg[1] * u + pn[1] * h];
  M.add(g, M.box(0.62, 0.08, 3.6), C('#2c343c'), pc[0], pc[1], 0, { rz: pa });
  const scr = ['#7ae6d0', '#9ad0ff', '#7ae6d0', '#ffd27a', '#9ad0ff', '#7ae6d0'];
  for (let i = 0; i < 3; i++) { const q = onPanel(-0.06, 0.045); glow(g, scr[i + 1], M.box(0.36, 0.02, 0.9), q[0], q[1], -1.15 + i * 1.15, { rz: pa }); }
  for (let i = 0; i < 5; i++) { const q = onPanel(0.22, 0.045); glow(g, i % 2 ? '#7aff8a' : '#ff6a4a', M.box(0.06, 0.02, 0.06), q[0], q[1], -0.8 + i * 0.4, { rz: pa }); }
  for (const z of [-0.9, 0.9]) {
    cv(g, dk, 0.06, 0.06, 0.45, -34.2, yb, z, 8); bb(g, cush, 0.55, 0.12, 0.55, -34.2, yb + 0.45, z); bb(g, cush, 0.1, 0.6, 0.5, -33.95, yb + 0.57, z);
    props.push({ name: 'bridge chair', x0: -34.5, x1: -33.9, y0: yb, y1: yb + 1.2, z0: z - 0.3, z1: z + 0.3 });
  }
  box3(g, C('#5a4632'), -31.2, yb, 3.6, -30.4, 9.32, 5.4); box3(g, C('#e8e0c8'), -31.15, 9.32, 3.7, -30.45, 9.34, 5.3);
  props.push({ name: 'bridge console', x0: -35.8, x1: -35.0, y0: yb, y1: 9.6, z0: -1.8, z1: 1.8 });
  props.push({ name: 'chart table', x0: -31.2, x1: -30.4, y0: yb, y1: 9.34, z0: 3.6, z1: 5.4 });
  // ---------------- outside the cabin: side (nav) lights, floods under the visor, roof rail
  for (const s of [-1, 1]) {
    bb(g, dk, 0.5, 0.36, 0.08, -30.45, 10.65, s * 6.04);
    glow(g, s < 0 ? '#ff3020' : '#30ff70', M.box(0.26, 0.22, 0.06), -30.45, 10.83, s * 6.1);
  }
  for (const z of [-4, 0, 4]) { bb(g, dk, 0.36, 0.3, 0.46, -29.62, 10.88, z); glow(g, '#fff4d8', M.box(0.03, 0.22, 0.36), -29.43, 11.03, z); }
  for (const [x0, z0, x1, z1] of [[-35.95, -5.98, -29.47, -5.98], [-35.95, 5.98, -29.47, 5.98], [-35.95, -5.98, -35.95, 5.98], [-29.47, -5.98, -29.47, 5.98]]) rail(g, rm, x0, z0, x1, z1, ROOF, { h: 0.9, step: 1.6, two: true });
}

function buildTopside(g, keepSpots) {
  const W = T(COL.white, 'metal'), dk = C(COL.dark), wh = C(COL.white), rm = C(COL.rail);
  // radar gantry: A-frame legs, platform, top pole + yardarm
  const mx = -31.2;
  for (const s of [-1, 1]) {
    beam(g, W, 0.24, 0.24, [mx, ROOF, s * 2.4], [mx, 15.0, s * 0.9]);
    beam(g, W, 0.12, 0.12, [mx, ROOF + 0.4, s * 2.25], [mx, 14.2, -s * 0.6]);
    bb(g, dk, 0.5, 0.45, 0.5, mx, 15.15, s * 2.5);                  // scanner pedestals
  }
  box3(g, W, mx - 0.7, 15.0, -3.7, mx + 0.7, 15.15, 3.7);
  for (const [x0, z0, x1, z1] of [[mx + 0.66, -3.66, mx + 0.66, 3.66], [mx - 0.66, -3.66, mx - 0.66, 3.66]]) rail(g, rm, x0, z0, x1, z1, 15.15, { h: 0.6, step: 1.2, two: true });
  rodT(g, wh, 0.15, 0.08, [mx, 15.15, 0], [mx, 19.6, 0], 8);
  bx(g, W, 0.16, 0.14, 3.0, mx, 18.3, 0);
  for (const s of [-1, 1]) { bb(g, dk, 0.2, 0.24, 0.2, mx + 0.05, 18.37, s * 1.3); glow(g, '#fffbe8', M.box(0.16, 0.14, 0.16), mx + 0.08, 18.45, s * 1.3); }
  bb(g, dk, 0.26, 0.3, 0.26, mx + 0.2, 16.6, 0); glow(g, '#fffbe8', M.box(0.2, 0.2, 0.28), mx + 0.24, 16.66, 0);   // masthead light
  M.add(g, M.cone(0.2, 0.7, 10), dk, mx + 0.95, 15.5, 0.5, { rz: PI / 2 });     // horn (flare forward)
  cv(g, dk, 0.05, 0.05, 0.35, mx + 0.6, 15.15, 0.5, 6);
  keepSpots.radarA = [mx, 15.6, -2.5]; keepSpots.radarB = [mx, 15.6, 2.5]; keepSpots.blink = [mx, 19.72, 0];
  // whip antennas, satellite dome
  for (const z of [-5.5, 5.5]) rod(g, dk, 0.03, [-35.6, ROOF, z], [-35.6, 15.2, z], 4);
  cv(g, dk, 0.08, 0.08, 0.6, -30.6, ROOF, -4.4, 6); M.add(g, M.sphere(0.48, 12, 8), wh, -30.6, ROOF + 0.95, -4.4);
  // funnel: rounded box, raked aft; teal body, white ring, black top, emblem both sides
  const fg = G(); fg.position.set(-34.55, ROOF - 0.1, 0); fg.rotation.z = 0.06; g.add(fg);   // base stays inside the roof slab (11.2..11.4)
  const seg = (m, y0, y1) => { const h = y1 - y0; bb(fg, m, 3.0, h, 1.6, 0, y0, 0); bb(fg, m, 2.2, h, 2.4, 0, y0, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) cv(fg, m, 0.4, 0.4, h, sx * 1.1, y0, sz * 0.8, 10); };
  seg(T(COL.funnel, 'metal'), 0, 4.2); seg(C('#efebe0'), 4.2, 4.5); seg(C('#18191c'), 4.5, 5.5);
  for (const z of [-0.5, 0.5]) { cv(fg, C('#3a3d42'), 0.26, 0.26, 0.7, -0.4, 5.5, z, 10); cv(fg, C('#0e0f12'), 0.2, 0.2, 0.02, -0.4, 6.2, z, 10); }
  cv(fg, C('#3a3d42'), 0.18, 0.18, 0.5, 0.7, 5.5, 0, 8);
  for (const s of [-1, 1]) decal(fg, REG.emblem, 1.6, 1.6, 0, 2.3, s * 1.215, s > 0 ? 0 : PI);
}

// ----------------------------------------------------------------- stern: bollards, flagpole, free-fall lifeboat
function buildStern(g, props, keepSpots) {
  const dk = C(COL.dark), dk2 = C('#3a3d42'), steel = C('#6a6e72'), or = C(COL.orange), wh = C(COL.white), gd = S('glass_dark');
  for (const s of [-1, 1]) {
    const bz = s * 4.2;
    bb(g, dk2, 0.42, 0.06, 1.05, -37.1, DECK, bz);
    for (const o of [-0.32, 0.32]) { cv(g, dk, 0.16, 0.16, 0.5, -37.1, DECK + 0.06, bz + o, 10); cv(g, dk, 0.21, 0.21, 0.05, -37.1, DECK + 0.56, bz + o, 10); }
    props.push({ name: 'stern bollard', x0: -37.31, x1: -36.89, y0: DECK, y1: DECK + 0.61, z0: bz - 0.53, z1: bz + 0.53 });
  }
  // stern light on the rail
  bb(g, dk, 0.14, 0.24, 0.3, -37.98, DECK + RAIL_H, -0.6); glow(g, '#fffbe8', M.box(0.04, 0.16, 0.24), -38.06, DECK + RAIL_H + 0.12, -0.6);
  // ensign staff (flag itself is animated)
  cv(g, C('#d8d4c8'), 0.035, 0.05, 3.1, -37.75, DECK, 3.0, 6);
  M.add(g, M.sphere(0.07, 6, 4), C('#c49a45'), -37.75, DECK + 3.12, 3.0);
  keepSpots.flag = [-37.75, DECK + 2.95, 3.0];
  props.push({ name: 'flagpole', x0: -37.8, x1: -37.7, y0: DECK, y1: DECK + 3.1, z0: 2.95, z1: 3.05 });
  // free-fall lifeboat on a launch ramp off the bridge back wall (all above Y 7.3)
  const ang = 0.5, dir = [Math.cos(ang), Math.sin(ang)], nrm = [-Math.sin(ang), Math.cos(ang)], cx = -39.0, cy = 9.6;
  const along = (t, h) => [cx + dir[0] * t + nrm[0] * h, cy + dir[1] * t + nrm[1] * h];
  const r0 = along(-3.0, -0.92), r1 = along((-36.0 - (cx + nrm[0] * -0.92)) / dir[0], -0.92);
  for (const z of [-0.8, 0.8]) {
    beam(g, steel, 0.16, 0.2, [r0[0], r0[1], z], [r1[0], r1[1], z]);
    const s0 = along(-2.2, -1.0), s1 = along(0.2, -1.0);
    beam(g, steel, 0.12, 0.12, [s0[0], s0[1], z], [-35.98, 7.6, z]);
    beam(g, steel, 0.12, 0.12, [s1[0], s1[1], z], [-35.98, 8.7, z]);
  }
  for (const t of [-2.6, 1.6]) { const p = along(t, -0.92); bx(g, steel, 0.16, 0.16, 1.8, p[0], p[1], 0, { rz: ang }); }
  const lb = G(); lb.position.set(cx, cy, 0); lb.rotation.z = ang; g.add(lb);
  M.add(lb, M.cyl(1, 1, 4.4, 14), or, 0.6, 0, 0, { rz: PI / 2, sx: 0.78, sz: 1.12 });
  M.add(lb, M.sphere(1, 14, 8), or, -1.6, 0, 0, { sx: 1.25, sy: 0.78, sz: 1.12 });
  bb(lb, or, 3.6, 0.62, 1.9, 0.5, 0.55, 0);
  M.add(lb, M.cyl(0.95, 0.95, 3.6, 12), or, 0.5, 1.12, 0, { rz: PI / 2, sx: 0.32 });
  bb(lb, wh, 4.4, 0.08, 2.26, 0.6, -0.08, 0);
  for (const s of [-1, 1]) for (let i = 0; i < 5; i++) bx(lb, gd, 0.34, 0.22, 0.04, -0.8 + i * 0.68, 0.92, s * 0.96);
  bb(lb, dk, 0.5, 0.1, 0.5, 1.4, 1.42, 0);
  bx(lb, dk, 3.6, 0.12, 0.14, 0.4, -0.84, 0);
  props.push({ name: 'lifeboat (overhangs the stern, Y >= 7.3)', x0: -41.4, x1: -35.95, y0: 7.3, y1: 12.2, z0: -1.15, z1: 1.15 });
}

// ----------------------------------------------------------------- ramp: deck -> bridge level, starboard
function buildRamp(g, props) {
  const steel = T(COL.steel, 'metal'), dk = C('#3a3d42'), yl = C(COL.yellow), haz = S('hazard');
  const { x0, x1, z0, z1 } = RAMP, yAt = x => DECK + (x1 - x) / (x1 - x0) * (BRIDGE - DECK);
  const ang = Math.atan2(BRIDGE - DECK, x1 - x0);   // rise toward -X
  slope(g, haz, [x1 - 0.45, yAt(x1 - 0.45)], [x1, DECK], z0, z1, 0.1, 0.6);
  slope(g, steel, [x0 + 0.45, yAt(x0 + 0.45)], [x1 - 0.45, yAt(x1 - 0.45)], z0, z1, 0.1, 2);
  slope(g, haz, [x0, BRIDGE], [x0 + 0.45, yAt(x0 + 0.45)], z0, z1, 0.1, 0.6);
  for (let x = x1 - 0.7; x > x0 + 0.5; x -= 0.45) bx(g, dk, 0.05, 0.025, z1 - z0 - 0.3, x, yAt(x) + 0.012, (z0 + z1) / 2, { rz: -ang });
  // channel stringers (kick plates) on both edges
  for (const z of [z0 + 0.04, z1 - 0.04]) slope(g, dk, [x0, BRIDGE + 0.1], [x1, DECK + 0.1], z - 0.04, z + 0.04, 0.42, 2);
  // support legs + bracing
  for (const x of [-16.5, -20.0, -23.5]) {
    const top = yAt(x) - 0.3;
    for (const z of [z0 + 0.12, z1 - 0.12]) bb(g, dk, 0.14, top - DECK, 0.14, x, DECK, z);
    beam(g, dk, 0.07, 0.07, [x, DECK + 0.1, z0 + 0.12], [x, top - 0.05, z1 - 0.12]);
    bb(g, dk, 0.3, 0.03, 2.0, x, DECK, (z0 + z1) / 2);
  }
  for (const z of [z0 + 0.12, z1 - 0.12]) beam(g, dk, 0.06, 0.06, [-20.0, DECK + 0.15, z], [-23.5, yAt(-23.5) - 0.35, z]);
  bb(g, dk, 0.16, BRIDGE - 0.3 - DECK, 0.16, x0 + 0.1, DECK, z1 - 0.1);   // post under the top corner beside the tower
  // inner handrail (Z = 4.4); the hull railing is the outer side
  srail(g, yl, [x1 - 0.12, yAt(x1 - 0.12), z0 + 0.03], [x0 + 0.05, BRIDGE, z0 + 0.03], { h: 1.0, step: 1.6 });
  props.push({ name: 'ramp legs (under the ramp)', x0: -23.6, x1: -16.4, y0: DECK, y1: yAt(-23.5), z0: z0 + 0.05, z1: z1 - 0.05 });
}

// ----------------------------------------------------------------- gangway (separate group)
function buildGangway(g) {
  const al = T('#a9afb4', 'metal'), dk = C('#3a3d42'), yl = C(COL.yellow), haz = S('hazard');
  const { x0, x1, x2, z0, z1, y0 } = GANG, yAt = x => y0 + (x - x0) / (x1 - x0) * (DECK - y0);
  const ang = Math.atan2(DECK - y0, x1 - x0), zm = (z0 + z1) / 2;
  slope(g, haz, [x0, y0], [x0 + 0.45, yAt(x0 + 0.45)], z0, z1, 0.08, 0.6);
  slope(g, al, [x0 + 0.45, yAt(x0 + 0.45)], [x1, DECK], z0, z1, 0.08, 2);
  box3(g, al, x1, DECK - 0.1, z0, x2, DECK, z1, 2);
  box3(g, haz, x1 + 0.08, DECK - 0.03, z1, x2 - 0.08, DECK, -7.0, 0.6);    // bridge plate over the gap to the hull
  for (let x = x0 + 0.7; x < x1 - 0.2; x += 0.42) bx(g, dk, 0.05, 0.025, z1 - z0 - 0.3, x, yAt(x) + 0.012, zm, { rz: ang });
  // side stringers along the slope and the landing
  for (const z of [z0 + 0.04, z1 - 0.04]) {
    slope(g, al, [x0, y0 + 0.12], [x1, DECK + 0.12], z - 0.04, z + 0.04, 0.4, 2);
    box3(g, al, x1, DECK - 0.28, z - 0.04, x2, DECK + 0.12, z + 0.04, 2);
  }
  // handrails: quay side the full length, hull side up to the landing, across the far end
  const zo = z0 + 0.04, zi = z1 - 0.04;
  srail(g, yl, [x0 + 0.1, yAt(x0 + 0.1), zo], [x1, DECK, zo], { h: 1.0, step: 1.5 });
  srail(g, yl, [x0 + 0.1, yAt(x0 + 0.1), zi], [x1, DECK, zi], { h: 1.0, step: 1.5 });
  rail(g, yl, x1, zo, x2 - 0.04, zo, DECK, { h: 1.0, noStart: true, two: true });
  rail(g, yl, x2 - 0.04, zo, x2 - 0.04, zi, DECK, { h: 1.0, two: true });
  // support legs down to the quay (Y 1.0), base plates, foot wheels
  for (const x of [-10.4, -6.6, x1 - 0.1, x2 - 0.12]) {
    const top = (x >= x1 - 0.11 ? DECK : yAt(x)) - 0.3;
    for (const z of [z0 + 0.14, z1 - 0.14]) { bb(g, dk, 0.12, top - y0, 0.12, x, y0, z); bb(g, dk, 0.34, 0.04, 0.34, x, y0, z); }
    beam(g, dk, 0.06, 0.06, [x, y0 + 0.15, z0 + 0.14], [x, top - 0.05, z1 - 0.14]);
  }
  for (const z of [z0 + 0.14, z1 - 0.14]) beam(g, dk, 0.06, 0.06, [-6.6, y0 + 0.2, z], [x1 - 0.1, DECK - 0.4, z]);
  for (const z of [z0 - 0.06, z1 + 0.06]) czl(g, C('#1e1f22'), 0.14, 0.1, x0 + 0.3, y0 + 0.14, z, 10);
}

// ----------------------------------------------------------------- animated parts
function radarGeo(len) {
  const g = G(), wh = C('#ecebe4'), dk = C(COL.dark);
  bb(g, dk, 0.42, 0.3, 0.42, 0, 0, 0);
  bx(g, wh, len, 0.26, 0.16, 0, 0.43, 0);
  bx(g, dk, len - 0.12, 0.05, 0.17, 0, 0.4, 0);
  bb(g, wh, 0.2, 0.06, 0.2, 0, 0.3, 0);
  return M.bake(g);
}
function flagGeo() {
  const g = G();
  const cols = ['#24857f', '#efebe0', '#c23b2c'];
  for (let i = 0; i < 3; i++) bx(g, C(cols[i]), 0.42, 0.9, 0.02, -0.21 - i * 0.42, -0.45, 0);
  return M.bake(g);
}

// ----------------------------------------------------------------- assembly
const LIGHTS = [
  { name: 'deck flood (tower visor)', x: -29.0, y: 10.9, z: 0, color: '#fff2d0', intensity: 2.6, range: 26 },
  { name: 'deck flood (foremast)', x: 35.6, y: 9.0, z: 0, color: '#fff2d0', intensity: 2.0, range: 18 },
  { name: 'gangway lamp', x: -2.8, y: 7.6, z: -7.3, color: '#ffe2a8', intensity: 1.6, range: 10 },
  { name: 'bridge cabin', x: -33.0, y: 10.7, z: 0, color: '#ffd9a0', intensity: 1.3, range: 9 },
  { name: 'crew mess', x: -28.0, y: 7.6, z: -0.5, color: '#ffd9a0', intensity: 1.2, range: 8 },
  { name: 'crew quarters', x: -33.0, y: 7.6, z: 0, color: '#ffd9a0', intensity: 1.0, range: 7 },
  { name: 'port side light (red)', x: -30.45, y: 10.85, z: -6.5, color: '#ff3a2a', intensity: 1.4, range: 7 },
  { name: 'starboard side light (green)', x: -30.45, y: 10.85, z: 6.5, color: '#3aff6a', intensity: 1.4, range: 7 },
];

const STATIC = {};
function postBake(grp) {
  grp.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.isMeshBasicMaterial || m.transparent || m.alphaTest > 0) o.castShadow = false;
  });
  return grp;
}
function buildShip() {
  const g = G(), props = [], keep = {};
  buildHull(g); buildDeck(g, props); buildRailings(g, props); buildBow(g, props); buildContainers(g);
  buildTower(g, props); buildTopside(g, keep); buildStern(g, props, keep); buildRamp(g, props);
  return { mesh: postBake(M.bake(g)), props, keep };
}

export function makeCargoShip() {
  if (!STATIC.ship) {
    try { STATIC.ship = buildShip(); } catch (e) {
      console.warn('[models_ship] build failed', e);
      const g = G(); bb(g, T(COL.hull, 'metal'), 76, 9, 14, 0, KEEL, 0); STATIC.ship = { mesh: M.bake(g), props: [], keep: {} };
    }
    const gg = G(); try { buildGangway(gg); } catch (e) { console.warn('[models_ship] gangway failed', e); }
    STATIC.gang = postBake(M.bake(gg));
    STATIC.radarA = radarGeo(3.0); STATIC.radarB = radarGeo(2.3); STATIC.flag = flagGeo();
  }
  const S0 = STATIC.ship, K = S0.keep;
  const root = G(); root.name = 'cargoShip';
  root.add(S0.mesh.clone());
  const gangway = G(); gangway.name = 'gangway'; gangway.add(STATIC.gang.clone());
  const pivot = (src, at) => { const p = G(); p.add(src.clone()); if (at) p.position.set(at[0], at[1], at[2]); root.add(p); return p; };
  const radarA = pivot(STATIC.radarA, K.radarA), radarB = pivot(STATIC.radarB, K.radarB), flag = pivot(STATIC.flag, K.flag);
  radarA.name = radarB.name = 'radar'; flag.name = 'flag'; radarB.rotation.y = 1.3;
  const blink = M.add(root, M.sphere(0.1, 8, 6), GL('#ff3a2a'), 0, 0, 0, { cast: false }); blink.name = 'beacon';
  if (K.blink) blink.position.set(K.blink[0], K.blink[1], K.blink[2]);
  for (const o of [radarA, radarB, flag, blink]) o.traverse(c => { c.userData.keep = true; if (c.isMesh) c.castShadow = c !== blink && c.castShadow; });
  let t = 0;
  function update(dt) {
    t += dt;
    radarA.rotation.y += dt * 2.6;
    radarB.rotation.y -= dt * 3.4;
    blink.visible = (t % 1.5) < 0.22;
    flag.rotation.y = Math.sin(t * 2.3) * 0.2 + Math.sin(t * 5.1) * 0.06;
  }
  return {
    root, gangway, update,
    lights: LIGHTS.map(l => Object.assign({}, l)),
    props: S0.props.map(p => Object.assign({}, p)),
  };
}
