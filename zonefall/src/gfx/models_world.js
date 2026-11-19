// ============================================================================
// ZONEFALL 3 — world models: building pieces (every tier), doors & gates,
// deployables, loot containers, vertex-coloured vegetation for instancing,
// resource nodes, monument props, pickups, airdrop and event vehicles.
//
// Conventions (see SPEC3): metres, Y up, models face +X at rotation.y = 0,
// origin at the feet / floor centre. Tall things use `cut` materials so they
// dither away between the camera and the player.
//
// Static geometry is baked (M.bake) and cached per type: every call returns a
// fresh Group whose meshes SHARE geometry + materials with earlier calls, so
// never dispose() geometry/materials of returned objects (just remove them).
// Animated / toggled parts (lids, door panels, turret heads, flames, rotors)
// are separate un-baked children exposed through userData / return values.
// ============================================================================
import { THREE, M, PAL } from './materials.js';

export const CELL = 3, FOUND_H = 0.6, WALL_H = 2.6, WALL_T = 0.2;
const PI = Math.PI, TAU = PI * 2;

// ----------------------------------------------------------------- utils
function rng(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = () => new THREE.Group();
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
function shade(hex, k) { const c = new THREE.Color(hex).multiplyScalar(k); return '#' + c.getHexString(); }

// ----------------------------------------------------------------- materials
const S = (name, cut) => M.surf(name, cut ? { cut: true } : {});                 // named surface
const C = (hex, cut) => M.mat(hex, cut ? { cut: true } : {});                     // plain colour
const T = (hex, tex, cut) => M.mat(hex, cut ? { tex, cut: true } : { tex });      // tinted texture
const DS = (hex, tex, cut) => M.mat(hex, Object.assign(tex ? { tex } : {}, { side: 'double' }, cut ? { cut: true } : {}));
const GL = hex => M.basic(hex);                                                  // unlit glow
const ADD = hex => M.basic(hex, { additive: true });                             // additive glow

// Local copy of the see-through patch (materials.js does not export it) for
// the few materials this module builds by hand (custom canvas textures).
function cutPatch(mat) {
  const CUT = M.CUT;
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPlayer = CUT.uPlayer; sh.uniforms.uCam = CUT.uCam; sh.uniforms.uCutR = CUT.uCutR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n{ vec4 cw = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\ncw = instanceMatrix * cw;\n#endif\nvCutW = (modelMatrix * cw).xyz; }');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutW; uniform vec3 uPlayer; uniform vec3 uCam; uniform float uCutR;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      {
        vec3 d = uPlayer - uCam; float dd = dot(d, d);
        float t = dot(vCutW - uCam, d) / dd;
        if (t > 0.0 && t < 0.985 && vCutW.y > 0.35) {
          vec3 cp = uCam + d * t; float r = length(vCutW - cp);
          float k = smoothstep(uCutR, uCutR * 0.55, r);
          vec2 q = floor(gl_FragCoord.xy * 0.5);
          float dith = fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453);
          if (k * 0.92 > dith) discard;
        }
      }`);
  };
  mat.customProgramCacheKey = () => 'cut';
  return mat;
}

// ----------------------------------------------------------------- geometry helpers
// box by centre / by bottom (M.box has metre-scaled UVs)
function bx(p, m, w, h, d, x = 0, y = 0, z = 0, o) { return M.add(p, M.box(w, h, d, (o && o.ts) || 2), m, x, y, z, o); }
function bb(p, m, w, h, d, x = 0, y0 = 0, z = 0, o) { return bx(p, m, w, h, d, x, y0 + h / 2, z, o); }
// vertical cylinder standing on y0
function cv(p, m, rt, rb, h, x = 0, y0 = 0, z = 0, seg = 10, o) { return M.add(p, M.cyl(rt, rb, h, seg), m, x, y0 + h / 2, z, o); }
// horizontal cylinders centred, along X / along Z
function cxl(p, m, r, len, x = 0, y = 0, z = 0, seg = 10, o) { return M.add(p, M.cyl(r, r, len, seg), m, x, y, z, Object.assign({ rz: PI / 2 }, o)); }
function czl(p, m, r, len, x = 0, y = 0, z = 0, seg = 10, o) { return M.add(p, M.cyl(r, r, len, seg), m, x, y, z, Object.assign({ rx: PI / 2 }, o)); }
const _up = V3(0, 1, 0);
function orient(mesh, a, b) {
  const A = Array.isArray(a) ? V3(a[0], a[1], a[2]) : a, B = Array.isArray(b) ? V3(b[0], b[1], b[2]) : b;
  const d = new THREE.Vector3().subVectors(B, A); const L = d.length() || 1e-4;
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, d.divideScalar(L));
  return L;
}
// cylinder / tapered cylinder / box beam between two points
function rod(p, m, r, a, b, seg = 6) { const me = M.add(p, M.cyl(r, r, 1, seg), m); me.scale.y = orient(me, a, b); return me; }
function rodT(p, m, r0, r1, a, b, seg = 6) { const me = M.add(p, M.cyl(r1, r0, 1, seg), m); me.scale.y = orient(me, a, b); return me; }
function beam(p, m, w, d, a, b) { const me = M.add(p, M.box(w, 1, d, 1), m); me.scale.y = orient(me, a, b); return me; }
// box with world-aligned UVs so textures run seamlessly across segments
function wbox(p, m, w, h, d, x, y, z, ts = 2, swap = false) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
  const pos = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    if (ax > 0.5) uv.setXY(i, pz / ts, py / ts);
    else if (ay > 0.5) { if (swap) uv.setXY(i, pz / ts, px / ts); else uv.setXY(i, px / ts, pz / ts); }
    else uv.setXY(i, px / ts, py / ts);
  }
  return M.add(p, g, m);
}
const wbb = (p, m, w, h, d, x, y0, z, ts, swap) => wbox(p, m, w, h, d, x, y0 + h / 2, z, ts, swap);
// 2D profile (XY) extruded along Z, centred on z
const _geo = new Map();
function prism(pts, depth, uvs = 0.5) {
  const k = 'pr' + JSON.stringify(pts) + depth + ':' + uvs;
  if (_geo.has(k)) return _geo.get(k);
  const sh = new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], q[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvs, uv.getY(i) * uvs);
  _geo.set(k, g); return g;
}
function sphereCap(r, ws, hs, theta) {
  const k = `sc${r},${ws},${hs},${theta}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, theta));
  return _geo.get(k);
}
function torus(R, r, rs = 6, ts = 14, arc = TAU) {
  const k = `t${R},${r},${rs},${ts},${arc}`;
  if (!_geo.has(k)) _geo.set(k, new THREE.TorusGeometry(R, r, rs, ts, arc));
  return _geo.get(k);
}
function octa(r) { const k = 'o' + r; if (!_geo.has(k)) _geo.set(k, new THREE.OctahedronGeometry(r, 0)); return _geo.get(k); }

// rust patch: two axis-aligned plates forming an irregular L, flush on a face.
// axis: 'y' (on a top face at height y), 'z' (on a Z face at z), 'x' (on an X face at x)
function rustBlot(g, x, y, z, w, h, axis = 'y', cut = false, seed = 1, tex = 'noise', base = null) {
  const R = rng(seed * 977 + 13), t = 0.01;
  const rc = base ? '#' + new THREE.Color(base).lerp(new THREE.Color('#7a4a2c'), 0.5).getHexString() : '#7e4e2e', m = T(rc, tex, cut);
  const w2 = w * (0.4 + R() * 0.3), h2 = h * (0.35 + R() * 0.3), sx = R() < 0.5 ? -1 : 1, sy = R() < 0.5 ? -1 : 1;
  for (const [ox, oy, pw, ph] of [[0, 0, w, h * 0.6], [sx * (w - w2) / 2, sy * (h * 0.3 + h2 / 2), w2, h2]]) {
    if (axis === 'y') bx(g, m, pw, t, ph, x + ox, y + t / 2, z + oy, { ts: 1.6 });
    else if (axis === 'z') bx(g, m, pw, ph, t, x + ox, y + oy, z, { ts: 1.6 });
    else bx(g, m, t, ph, pw, x, y + oy, z + ox, { ts: 1.6 });
  }
}
// stacked-block stone pillar (square, plain colours: identical under 90 deg
// rotation so pillars shared by neighbouring high walls never flicker)
function stonePillar(g, x, y0 = -1.5, h = 6.2, w = 0.62) {
  const a = C('#7f7d77', true), b = C('#74726c', true), n = Math.round(h / 0.62);
  for (let i = 0; i < n; i++) bb(g, i % 2 ? b : a, w, h / n, w, x, y0 + i * h / n, 0);
  bb(g, C('#908e88', true), w + 0.1, 0.14, w + 0.1, x, y0 + h, 0);
}
function openFrustum(rt, rb, h, seg) {
  const k = `of${rt},${rb},${h},${seg}`;
  if (!_geo.has(k)) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, true);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * rt / 2, uv.getY(i) * h / 2);
    _geo.set(k, g);
  }
  return _geo.get(k);
}

// bake cache: build(g) fills a Group once; every call returns a clone that
// shares the baked geometry.
const STATIC = new Map();
function cached(key, build) {
  let s = STATIC.get(key);
  if (!s) {
    let g = G();
    try { build(g); s = M.bake(g); } catch (e) {
      console.warn('[models_world] build failed for', key, e);
      g = G(); placeholder(g); s = M.bake(g);
    }
    STATIC.set(key, s);
  }
  return s.clone();
}
// sensible fallback: a small strapped wooden crate
function placeholder(g) {
  bb(g, S('plank'), 0.8, 0.6, 0.6, 0, 0, 0, { ts: 1.5 });
  for (const s of [-1, 1]) bb(g, C('#3b3a38'), 0.82, 0.62, 0.05, 0, 0, s * 0.2);
}

// ============================================================================
// BUILDING PIECES
// ============================================================================
const TIERS = ['twig', 'wood', 'stone', 'metal', 'armored'];
// End posts sit centred on the wall ends so neighbouring walls share them.
// Sizes / heights differ per tier so mixed-tier corners never z-fight.
const POST = { twig: 0.13, wood: 0.24, metal: 0.27, stone: 0.3, armored: 0.33 };
const POST_DROP = { twig: 0.012, wood: 0.009, metal: 0.006, stone: 0.003, armored: 0 };
const WALL_SPEC = {
  wall: [WALL_H, null],
  doorway: [WALL_H, [-0.6, 0.6, 0, 2.1]],
  window: [WALL_H, [-0.55, 0.55, 1.0, 1.8]],
  lowwall: [1.1, null],
};
function normTier(t) {
  if (TIERS.includes(t)) return t;
  if (t === 'sheet' || t === 'sheetmetal') return 'metal';
  if (t === 'hqm' || t === 'armor') return 'armored';
  return 'wood';
}
// rectangles covering the wall face minus the hole
function fillRects(h, hole, x0 = -1.4, x1 = 1.4) {
  if (!hole) return [[x0, x1, 0, h]];
  const [a, b, y0, y1] = hole, r = [[x0, a, 0, h], [b, x1, 0, h]];
  if (y1 < h) r.push([a, b, y1, h]);
  if (y0 > 0) r.push([a, b, 0, y0]);
  return r;
}
// x-spans of a horizontal band (centre y, thickness th) not crossing the hole
function spans(y, th, hole, x0 = -1.4, x1 = 1.4) {
  if (!hole || y + th / 2 <= hole[2] || y - th / 2 >= hole[3]) return [[x0, x1]];
  return [[x0, hole[0]], [hole[1], x1]];
}

export function makePiece(type, tier) {
  tier = normTier(tier);
  if (type === 'highwall') tier = (tier === 'twig' || tier === 'wood') ? 'wood' : 'stone';
  const o = cached('piece:' + type + ':' + tier, g => {
    if (type === 'foundation') foundation(g, tier);
    else if (type === 'ceiling') ceiling(g, tier);
    else if (type === 'stairs') stairs(g, tier);
    else if (type === 'tri_foundation') triFoundation(g, tier);
    else if (type === 'tri_ceiling') triCeiling(g, tier);
    else if (type === 'highwall') highwall(g, tier);
    else wallPiece(g, WALL_SPEC[type] ? type : 'wall', tier);
  });
  o.userData.piece = type; o.userData.tier = tier;
  return o;
}

// ---------------------------------------------------------------- walls
function wallPiece(g, type, tier) {
  const [h, hole] = WALL_SPEC[type];
  const ps = POST[tier], ptop = h - POST_DROP[tier];
  const rects = fillRects(h, hole);
  const R = rng(hashStr(type + tier));
  const band = (m, y, th, z, dep, ts) => { for (const [a, b] of spans(y, th, hole)) if (b - a > 0.03) bx(g, m, b - a, th, dep, (a + b) / 2, y, z, ts ? { ts } : undefined); };
  const posts = m => { bb(g, m, ps, ptop, ps, -1.5, 0, 0); bb(g, m, ps, ptop, ps, 1.5, 0, 0); };

  if (tier === 'twig') {
    const st = S('twig', true), post = C('#8c6a40', true), lash = C('#4a3a2a', true);
    for (const x of [-1.5, 1.5]) rod(g, post, ps / 2, [x, 0, 0], [x, ptop, 0], 8);
    const rails = h > 2 ? [0.08, 1.3, h - 0.07] : [0.08, h - 0.07];
    for (const y of rails) for (const [a, b] of spans(y, 0.08, hole, -1.46, 1.46)) {
      rod(g, st, 0.042, [a, y, 0], [b, y + (R() - 0.5) * 0.03, 0], 5);
    }
    for (const y of rails) for (const x of [-1.42, 1.42]) cv(g, lash, 0.062, 0.062, 0.08, x, y - 0.04, 0, 6);
    // fill: woven verticals + X braces per rectangle (gaps are intentional)
    const fill = [];
    for (const r of rects) {
      const [x0, x1, y0, y1] = r, hh = y1 - y0;
      const k = h > 2 && hh > 1.6 ? 2 : 1;
      for (let i = 0; i < k; i++) fill.push([x0, x1, y0 + hh * i / k, y0 + hh * (i + 1) / k]);
    }
    for (const [x0, x1, y0, y1] of fill) {
      const w = x1 - x0; if (w < 0.08 || y1 - y0 < 0.08) continue;
      const n = Math.max(1, Math.round(w / 0.3));
      for (let i = 0; i < n; i++) {
        const x = x0 + (i + 0.5) * w / n + (R() - 0.5) * 0.04, z = i % 2 ? 0.032 : -0.032;
        rod(g, st, 0.026 + R() * 0.008, [x, y0 + 0.03, z], [x + (R() - 0.5) * 0.05, y1 - 0.03, z], 5);
      }
      if (w > 0.45 && y1 - y0 > 0.4) {
        rod(g, st, 0.034, [x0 + 0.04, y0 + 0.05, 0.058], [x1 - 0.04, y1 - 0.05, 0.058], 5);
        rod(g, st, 0.034, [x0 + 0.04, y1 - 0.05, -0.058], [x1 - 0.04, y0 + 0.05, -0.058], 5);
      }
    }
    if (hole) {
      const [a, b, y0, y1] = hole;
      for (const x of [a - 0.03, b + 0.03]) rod(g, post, 0.045, [x, 0.02, 0], [x, Math.min(h - 0.05, y1 + 0.15), 0], 6);
      rod(g, post, 0.045, [a - 0.14, y1 + 0.04, 0], [b + 0.14, y1 + 0.04, 0], 6);
      if (y0 > 0) rod(g, post, 0.04, [a - 0.12, y0 - 0.03, 0], [b + 0.12, y0 - 0.03, 0], 6);
    }
    return;
  }

  if (tier === 'wood') {
    const plank = S('plank', true), dark = S('plank_dark', true), postM = C('#5b3e26', true), iron = C('#34312d', true);
    for (const [x0, x1, y0, y1] of rects) wbox(g, plank, x1 - x0, y1 - y0, 0.16, (x0 + x1) / 2, (y0 + y1) / 2, 0, 2);
    posts(postM);
    const bys = h > 2 ? [0.3, 1.32, h - 0.3] : [0.25, h - 0.26];
    for (const y of bys) for (const s of [-1, 1]) band(dark, y, 0.15, s * 0.1, 0.05);
    band(dark, h - 0.04, 0.08, 0, 0.22);
    // nail heads where battens meet the posts
    for (const y of bys) for (const x of [-1.32, 1.32]) for (const s of [-1, 1]) bx(g, iron, 0.04, 0.04, 0.02, x, y, s * 0.13);
    if (hole) {
      const [a, b, y0, y1] = hole;
      for (const x of [a - 0.06, b + 0.06]) bb(g, dark, 0.12, y1 - y0, 0.22, x, y0, 0);
      bx(g, dark, b - a + 0.26, 0.15, 0.22, (a + b) / 2, y1 + 0.075, 0);
      if (y0 > 0) bx(g, dark, b - a + 0.34, 0.08, 0.3, (a + b) / 2, y0 - 0.04, 0);
      if (type === 'window') { bx(g, dark, 0.06, y1 - y0, 0.06, (a + b) / 2, (y0 + y1) / 2, 0); }
    }
    return;
  }

  if (tier === 'stone') {
    const stone = T('#8f8e89', 'stoneblock', true), cap = T('#b1afa8', 'stoneblock', true), base = T('#6c6b67', 'stoneblock', true), postM = C('#7d7c77', true);
    for (const [x0, x1, y0, y1] of rects) wbox(g, stone, x1 - x0, y1 - y0, 0.2, (x0 + x1) / 2, (y0 + y1) / 2, 0, 1.7);
    band(base, 0.12, 0.24, 0, 0.26);
    band(cap, h - 0.08, 0.16, 0, 0.27);
    posts(postM);
    if (hole) {
      const [a, b, y0, y1] = hole;
      bx(g, base, b - a + 0.42, 0.26, 0.26, (a + b) / 2, Math.min(y1 + 0.13, h - 0.29), 0);
      let i = 0;
      for (let y = y0; y < y1 - 0.05; y += 0.42, i++) {
        const hh = Math.min(0.4, y1 - y);
        for (const [x, s] of [[a, -1], [b, 1]]) { const w = i % 2 ? 0.16 : 0.26; bb(g, cap, w, hh - 0.02, 0.24, x + s * w / 2, y + 0.01, 0); }
      }
      if (y0 > 0) bx(g, cap, b - a + 0.36, 0.1, 0.3, (a + b) / 2, y0 - 0.05, 0);
    }
    return;
  }

  if (tier === 'metal') {
    const sheet = T('#7c858c', 'corrugated', true), rustS = T('#8f5634', 'corrugated', true), frame = S('metal_dark', true), postM = C('#484d54', true), bolt = C('#2a2c30', true);
    for (const [x0, x1, y0, y1] of rects) wbox(g, sheet, x1 - x0, y1 - y0, 0.1, (x0 + x1) / 2, (y0 + y1) / 2, 0, 2);
    // replacement rusty sheets (outside the holes)
    if (h > 2) { wbox(g, rustS, 0.72, 1.25, 0.02, -0.98, 0.95, 0.06, 2); wbox(g, rustS, 0.66, 0.95, 0.02, 0.98, 1.55, -0.06, 2); }
    else { wbox(g, rustS, 0.7, 0.62, 0.02, 0.5, 0.52, 0.06, 2); }
    band(frame, 0.09, 0.18, 0, 0.17, 1);
    band(frame, h - 0.07, 0.14, 0, 0.17, 1);
    if (h > 2) band(frame, 1.32, 0.09, 0, 0.14, 1);
    posts(postM);
    for (const y of (h > 2 ? [0.09, 1.32, h - 0.07] : [0.09, h - 0.07])) for (const [a, b] of spans(y, 0.1, hole)) {
      for (let x = a + 0.12; x < b - 0.06; x += 0.36) for (const s of [-1, 1]) bx(g, bolt, 0.035, 0.035, 0.02, x, y, s * (y > 1 && y < 1.5 ? 0.075 : 0.09));
    }
    if (hole) {
      const [a, b, y0, y1] = hole;
      for (const x of [a - 0.04, b + 0.04]) bb(g, frame, 0.08, y1 - y0, 0.17, x, y0, 0);
      bx(g, frame, b - a + 0.16, 0.1, 0.17, (a + b) / 2, y1 + 0.05, 0);
      if (y0 > 0) {
        bx(g, frame, b - a + 0.16, 0.08, 0.2, (a + b) / 2, y0 - 0.04, 0);
        for (let i = 1; i < 5; i++) rod(g, postM, 0.018, [a + (b - a) * i / 5, y0, 0], [a + (b - a) * i / 5, y1, 0], 5);
        bx(g, postM, b - a, 0.04, 0.04, (a + b) / 2, (y0 + y1) / 2, 0);
      }
    }
    return;
  }

  // armored
  const plate = S('armor', true), plate2 = T('#4b5059', 'armor', true), haz = S('hazard', true), postM = C('#26292e', true), bolt = C('#16171a', true);
  for (const [x0, x1, y0, y1] of rects) wbox(g, plate, x1 - x0, y1 - y0, 0.22, (x0 + x1) / 2, (y0 + y1) / 2, 0, 1.5);
  for (const [x0, x1, y0, y1] of rects) {
    const ya = Math.max(y0, 0.32) + 0.06, yb = y1 - (y1 >= h - 0.01 ? 0.18 : 0.08);
    const xa = x0 + 0.1, xb = x1 - 0.1;
    if (xb - xa > 0.3 && yb - ya > 0.3) for (const s of [-1, 1]) wbox(g, plate2, xb - xa, yb - ya, 0.03, (xa + xb) / 2, (ya + yb) / 2, s * 0.12, 1.5);
  }
  band(haz, 0.13, 0.26, 0, 0.27, 0.8);
  band(haz, h - 0.05, 0.1, 0, 0.26, 0.8);
  posts(postM);
  for (const y of [0.33, h - 0.17]) for (const [a, b] of spans(y, 0.05, hole)) {
    for (let x = a + 0.15; x < b - 0.08; x += 0.32) for (const s of [-1, 1]) bx(g, bolt, 0.05, 0.05, 0.03, x, y, s * 0.135);
  }
  if (hole) {
    const [a, b, y0, y1] = hole;
    for (const x of [a - 0.06, b + 0.06]) bb(g, haz, 0.12, y1 - y0, 0.28, x, y0, 0, { ts: 0.8 });
    bx(g, postM, b - a + 0.24, 0.14, 0.28, (a + b) / 2, y1 + 0.07, 0);
    if (y0 > 0) {
      bx(g, postM, b - a + 0.24, 0.1, 0.3, (a + b) / 2, y0 - 0.05, 0);
      for (let i = 1; i < 4; i++) bx(g, postM, 0.05, y1 - y0, 0.05, a + (b - a) * i / 4, (y0 + y1) / 2, 0);
      bx(g, postM, b - a, 0.05, 0.05, (a + b) / 2, (y0 + y1) / 2, 0);
    }
  }
}

// ---------------------------------------------------------------- foundation
function foundation(g, tier) {
  const top = FOUND_H, bot = -2.0, hh = top - bot;
  if (tier === 'twig') {
    const R = rng(11), st = S('twig'), post = C('#8c6a40'), core = C('#33291f'), lash = C('#4a3a2a');
    bb(g, core, 2.84, hh - 0.12, 2.84, 0, bot, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) rod(g, post, 0.09, [sx * 1.38, bot, sz * 1.38], [sx * 1.38, top - 0.03, sz * 1.38], 6);
    for (const s of [-1, 1]) {
      rod(g, post, 0.075, [-1.47, top - 0.1, s * 1.38], [1.47, top - 0.1, s * 1.38], 6);
      rod(g, post, 0.075, [s * 1.38, top - 0.17, -1.47], [s * 1.38, top - 0.17, 1.47], 6);
    }
    for (const x of [-0.7, 0, 0.7]) rod(g, post, 0.05, [x, top - 0.12, -1.4], [x, top - 0.12, 1.4], 5);
    for (let i = 0; i < 16; i++) {
      const z = -1.32 + i * 0.176 + (R() - 0.5) * 0.03, y = top - 0.045;
      rod(g, st, 0.043 + R() * 0.008, [-1.45, y, z], [1.45, y + (R() - 0.5) * 0.015, z + (R() - 0.5) * 0.05], 5);
    }
    for (let side = 0; side < 4; side++) {
      const ax = side < 2, s = side % 2 ? 1 : -1, f = 1.44 * s;
      const P = (u, y) => ax ? [u, y, f] : [f, y, u];
      rod(g, st, 0.04, P(-1.3, -0.3), P(1.3, top - 0.2), 5);
      rod(g, st, 0.04, P(-1.3, top - 0.2), P(1.3, -0.3), 5);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cv(g, lash, 0.105, 0.105, 0.1, sx * 1.38, top - 0.16, sz * 1.38, 6);
    return;
  }
  if (tier === 'wood') {
    const deck = S('plank'), side = S('plank_dark'), beamM = C('#5b3e26'), iron = C('#34312d');
    wbb(g, side, 2.94, hh - 0.16, 2.94, 0, bot, 0, 2);
    wbb(g, deck, 2.64, 0.14, 2.64, 0, top - 0.14, 0, 2);
    for (const s of [-1, 1]) {
      bb(g, beamM, 3.0, 0.16, 0.18, 0, top - 0.16, s * 1.41);
      bb(g, beamM, 0.18, 0.16, 2.64, s * 1.41, top - 0.16, 0);
      bb(g, beamM, 2.6, 0.14, 0.06, 0, 0.02, s * 1.47);
      bb(g, beamM, 0.06, 0.14, 2.6, s * 1.47, 0.02, 0);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      bb(g, beamM, 0.2, hh - 0.17, 0.2, sx * 1.4, bot, sz * 1.4);
      bx(g, iron, 0.06, 0.012, 0.06, sx * 1.41, top + 0.002, sz * 1.41);
    }
    return;
  }
  if (tier === 'stone') {
    const body = T('#8f8e89', 'stoneblock'), pav = T('#9c9a94', 'stoneblock'), rim = T('#b5b3ac', 'stoneblock'), base = T('#6c6b67', 'stoneblock');
    wbb(g, body, 2.96, hh - 0.12, 2.96, 0, bot, 0, 1.7);
    wbb(g, pav, 2.7, 0.12, 2.7, 0, top - 0.12, 0, 3);
    for (const s of [-1, 1]) {
      bb(g, rim, 3.0, 0.16, 0.15, 0, top - 0.14, s * 1.425);
      bb(g, rim, 0.15, 0.16, 2.7, s * 1.425, top - 0.14, 0);
      wbb(g, base, 3.0, 0.3, 0.04, 0, -0.1, s * 1.48, 1.7);
      wbb(g, base, 0.04, 0.3, 2.92, s * 1.48, -0.1, 0, 1.7);
    }
    return;
  }
  if (tier === 'metal') {
    const body = T('#7c858c', 'corrugated'), rimM = S('metal_dark'), rustS = T('#8f5634', 'corrugated'), bolt = C('#2a2c30');
    wbb(g, body, 2.96, hh - 0.12, 2.96, 0, bot, 0, 2);
    wbox(g, rustS, 1.2, 0.5, 0.02, 0.6, 0.25, 1.485, 2); wbox(g, rustS, 0.02, 0.5, 1.0, -1.485, 0.28, -0.5, 2);
    const plates = [T('#78808a', 'metal'), T('#6b737c', 'metal'), T('#86796c', 'metal')];
    for (let i = 0; i < 3; i++) wbb(g, plates[i], 0.9, 0.12, 2.76, -0.92 + i * 0.92, top - 0.12, 0, 0.92);
    for (const x of [-0.46, 0.46]) bb(g, C('#3a3d42'), 0.04, 0.125, 2.76, x, top - 0.12, 0);
    for (const s of [-1, 1]) {
      bb(g, rimM, 3.0, 0.14, 0.12, 0, top - 0.13, s * 1.44, { ts: 1 });
      bb(g, rimM, 0.12, 0.14, 2.76, s * 1.44, top - 0.13, 0, { ts: 1 });
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, rimM, 0.16, hh - 0.2, 0.16, sx * 1.42, bot, sz * 1.42, { ts: 1 });
    for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) { bx(g, bolt, 0.04, 0.02, 0.04, i * 0.6, top + 0.01, s * 1.44); bx(g, bolt, 0.04, 0.02, 0.04, s * 1.44, top + 0.01, i * 0.6); }
    return;
  }
  // armored
  const body = S('armor'), deck = T('#4a4f57', 'armor'), haz = S('hazard'), bolt = C('#16171a');
  wbb(g, body, 2.96, hh - 0.12, 2.96, 0, bot, 0, 1.5);
  wbb(g, deck, 2.64, 0.12, 2.64, 0, top - 0.12, 0, 1.32);
  for (const s of [-1, 1]) {
    bx(g, haz, 3.0, 0.14, 0.18, 0, top - 0.07, s * 1.41, { ts: 0.8 });
    bx(g, haz, 0.18, 0.14, 2.64, s * 1.41, top - 0.07, 0, { ts: 0.8 });
    wbb(g, T('#2c2f35', 'armor'), 3.0, 0.35, 0.04, 0, -0.15, s * 1.48, 1.5);
    wbb(g, T('#2c2f35', 'armor'), 0.04, 0.35, 2.92, s * 1.48, -0.15, 0, 1.5);
  }
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (i || j) bx(g, bolt, 0.06, 0.02, 0.06, i * 1.16, top + 0.005, j * 1.16);
}

// ---------------------------------------------------------------- ceiling (roof)
function ceiling(g, tier) {
  const y0 = WALL_H, y1 = y0 + 0.2;
  if (tier === 'twig') {
    const R = rng(23), st = S('twig', true), post = C('#8c6a40', true), lash = C('#4a3a2a', true), thatch = T('#9a8250', 'grass', true);
    for (const s of [-1, 1]) {
      rod(g, post, 0.07, [-1.47, y0 + 0.07, s * 1.4], [1.47, y0 + 0.07, s * 1.4], 6);
      rod(g, post, 0.07, [s * 1.4, y0 + 0.07, -1.47], [s * 1.4, y0 + 0.07, 1.47], 6);
    }
    for (const x of [-0.7, 0.7]) rod(g, post, 0.05, [x, y0 + 0.08, -1.45], [x, y0 + 0.08, 1.45], 5);
    for (let i = 0; i < 14; i++) {
      const z = -1.27 + i * 0.195 + (R() - 0.5) * 0.04, y = y0 + 0.15;
      rod(g, st, 0.04 + R() * 0.008, [-1.44, y, z], [1.44, y + (R() - 0.5) * 0.02, z + (R() - 0.5) * 0.06], 5);
    }
    // a few bundles of dry grass laid on top
    for (let i = 0; i < 5; i++) bx(g, thatch, 0.5 + R() * 0.4, 0.05, 0.3 + R() * 0.2, (R() - 0.5) * 2, y0 + 0.2, (R() - 0.5) * 2, { ry: R() * 3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cv(g, lash, 0.09, 0.09, 0.12, sx * 1.4, y0 + 0.01, sz * 1.4, 6);
    return;
  }
  if (tier === 'wood') {
    const pl = S('plank', true), dk = C('#5b3e26', true), iron = C('#34312d', true);
    wbb(g, pl, 2.96, 0.16, 2.96, 0, y0, 0, 2, true);
    for (const s of [-1, 1]) {
      bb(g, dk, 3.0, 0.1, 0.16, 0, y0 + 0.14, s * 1.42);
      bb(g, dk, 0.16, 0.1, 2.68, s * 1.42, y0 + 0.14, 0);
    }
    bb(g, dk, 2.68, 0.06, 0.12, 0, y0 + 0.15, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(g, iron, 0.1, 0.02, 0.1, sx * 1.42, y0 + 0.25, sz * 1.42);
    return;
  }
  if (tier === 'stone') {
    const st = T('#8f8e89', 'stoneblock', true), cap = T('#b1afa8', 'stoneblock', true);
    wbb(g, st, 2.96, 0.2, 2.96, 0, y0, 0, 3);
    for (const s of [-1, 1]) {
      bb(g, cap, 3.0, 0.14, 0.2, 0, y0 + 0.12, s * 1.4);
      bb(g, cap, 0.2, 0.14, 2.6, s * 1.4, y0 + 0.12, 0);
    }
    return;
  }
  if (tier === 'metal') {
    const base = S('metal_dark', true), sh = T('#7c858c', 'corrugated', true), rs = T('#8f5634', 'corrugated', true), trim = C('#3e4248', true), bolt = C('#24262a', true);
    wbb(g, base, 2.96, 0.12, 2.96, 0, y0, 0, 1.5);
    wbb(g, sh, 1.56, 0.05, 2.84, -0.66, y0 + 0.12, 0, 2);
    wbb(g, rs, 1.4, 0.05, 2.84, 0.74, y0 + 0.135, 0, 2);
    for (const s of [-1, 1]) {
      bb(g, trim, 3.0, 0.1, 0.1, 0, y0 + 0.1, s * 1.45);
      bb(g, trim, 0.1, 0.1, 2.8, s * 1.45, y0 + 0.1, 0);
    }
    for (let i = -2; i <= 2; i++) for (const x of [-1.2, -0.1, 0.1, 1.2]) bx(g, bolt, 0.04, 0.02, 0.04, x, y0 + 0.19, i * 0.6);
    return;
  }
  const pl = S('armor', true), pl2 = T('#4b5059', 'armor', true), haz = S('hazard', true), bolt = C('#16171a', true);
  wbb(g, pl, 2.96, 0.2, 2.96, 0, y0, 0, 1.5);
  wbb(g, pl2, 1.9, 0.04, 1.9, 0, y1, 0, 0.95);
  for (const s of [-1, 1]) {
    bx(g, haz, 3.0, 0.08, 0.16, 0, y1 + 0.02, s * 1.42, { ts: 0.8 });
    bx(g, haz, 0.16, 0.08, 2.68, s * 1.42, y1 + 0.02, 0, { ts: 0.8 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(g, bolt, 0.07, 0.03, 0.07, sx * 0.88, y1 + 0.05, sz * 0.88);
}

// ---------------------------------------------------------------- stairs
// One 3 m cell, climbing one storey (WALL_H + 0.2) along +X: low end at x = -1.5,
// high end at x = +1.5, origin on the floor at the cell centre. Ten steps; every
// tier but twig is a solid flight (you can't walk underneath it), with stringers.
const STAIR_N = 10, STAIR_RISE = (WALL_H + 0.2) / STAIR_N, STAIR_RUN = CELL / STAIR_N, STAIR_W = 2.7;
function stairs(g, tier) {
  const N = STAIR_N, run = STAIR_RUN, rise = STAIR_RISE, w = STAIR_W, H = WALL_H + 0.2;
  const stringer = (m, th, z) => { for (let i = 0; i < N; i++) { const x0 = -1.5 + i * run; bb(g, m, run + 0.002, Math.min(0.42, (i + 1) * rise), th, x0 + run / 2, Math.max(0, (i + 1) * rise - 0.42) + 0.02, z); } };
  if (tier === 'twig') {
    const st = S('twig', true), post = C('#8c6a40', true), lash = C('#4a3a2a', true);
    for (const z of [-w / 2, w / 2]) { rod(g, post, 0.07, [-1.5, 0.02, z], [1.5, H - 0.06, z], 6); for (const x of [-0.5, 0.5, 1.4]) rod(g, post, 0.055, [x, 0, z], [x, (x + 1.5) / CELL * H - 0.08, z], 6); }
    for (let i = 0; i < N; i++) {
      const x = -1.5 + (i + 0.5) * run, y = (i + 1) * rise - 0.04;
      for (const dz of [-0.06, 0.06]) rod(g, st, 0.04, [x + dz, y, -w / 2 - 0.04], [x - dz, y, w / 2 + 0.04], 5);
      for (const z of [-w / 2, w / 2]) cv(g, lash, 0.05, 0.05, 0.06, x, y - 0.05, z, 6);
    }
    return;
  }
  const M3 = {
    wood: [S('plank', true), S('plank_dark', true), C('#5b3e26', true)],
    stone: [T('#8f8e89', 'stoneblock', true), T('#b1afa8', 'stoneblock', true), T('#6c6b67', 'stoneblock', true)],
    metal: [T('#7c858c', 'corrugated', true), S('metal_dark', true), C('#484d54', true)],
    armored: [S('armor', true), T('#4b5059', 'armor', true), S('hazard', true)],
  }[tier] || [S('plank', true), S('plank_dark', true), C('#5b3e26', true)];
  const [body, tread, edge] = M3;
  // the flight: one block per step, from the floor up to its tread
  for (let i = 0; i < N; i++) { const x0 = -1.5 + i * run, top = (i + 1) * rise; wbb(g, body, run + 0.004, top - 0.05, w - 0.1, x0 + run / 2, 0, 0, 1.6); bb(g, tread, run + 0.05, 0.06, w, x0 + run / 2 - 0.02, top - 0.06, 0); }
  for (const z of [-w / 2 - 0.04, w / 2 + 0.04]) stringer(edge, 0.08, z);
  if (tier === 'metal' || tier === 'armored') { // a handrail on both sides
    for (const z of [-w / 2 - 0.02, w / 2 + 0.02]) { for (const x of [-1.3, 0, 1.3]) { const y = (x + 1.5) / CELL * H; rod(g, edge, 0.025, [x, y, z], [x, y + 0.9, z], 6); } rod(g, edge, 0.03, [-1.3, (0.2 / CELL) * H + 0.9, z], [1.3, (2.8 / CELL) * H + 0.9, z], 6); }
  }
}

// ---------------------------------------------------------------- triangle foundation / floor
// Equilateral, 3 m sides, centred on the centroid: vertices at angles 0/120/240 deg
// (three.js cylinder order: +Z first), so one edge lies along local X at z = -0.866.
const TRI_R = CELL / Math.sqrt(3);
function triMats(tier, cut) {
  const s = n => S(n, cut), t = (h, x) => T(h, x, cut), c = h => C(h, cut);
  return {
    twig: [c('#33291f'), s('twig'), c('#8c6a40')], wood: [s('plank_dark'), s('plank'), c('#5b3e26')],
    stone: [t('#8f8e89', 'stoneblock'), t('#9c9a94', 'stoneblock'), t('#b5b3ac', 'stoneblock')],
    metal: [t('#7c858c', 'corrugated'), t('#78808a', 'metal'), s('metal_dark')], armored: [s('armor'), t('#4a4f57', 'armor'), s('hazard')],
  }[tier] || [s('plank_dark'), s('plank'), c('#5b3e26')];
}
function triRims(g, m, y, h, inset = 0.08, d = 0.15) {
  for (const a of [PI / 3, PI, PI * 5 / 3]) { const r = TRI_R / 2 - inset; bx(g, m, CELL - inset * 3.2, h, d, Math.sin(a) * r, y, Math.cos(a) * r, { ry: a }); }
}
function triFoundation(g, tier) {
  const top = FOUND_H, bot = -2.0, [body, deck, rim] = triMats(tier, false);
  cv(g, body, TRI_R * 0.985, TRI_R * 0.985, top - bot - 0.12, 0, bot, 0, 3);
  cv(g, deck, TRI_R * 0.9, TRI_R * 0.9, 0.13, 0, top - 0.13, 0, 3);
  triRims(g, rim, top - 0.07, 0.15);
  if (tier === 'twig') for (const a of [0, PI * 2 / 3, PI * 4 / 3]) rod(g, rim, 0.08, [Math.sin(a) * TRI_R * 0.9, bot, Math.cos(a) * TRI_R * 0.9], [Math.sin(a) * TRI_R * 0.9, top - 0.03, Math.cos(a) * TRI_R * 0.9], 6);
}
function triCeiling(g, tier) {
  const y0 = WALL_H, [body, deck, rim] = triMats(tier, true);
  cv(g, body, TRI_R * 0.99, TRI_R * 0.99, 0.16, 0, y0, 0, 3);
  cv(g, deck, TRI_R * 0.9, TRI_R * 0.9, 0.05, 0, y0 + 0.15, 0, 3);
  triRims(g, rim, y0 + 0.17, 0.08, 0.06, 0.14);
}

// ---------------------------------------------------------------- ladder (deployable, any height)
// Origin at the foot, centred on the rails; the wall it leans on is at +X.
export function makeLadder(h) {
  const hh = Math.max(1, Math.round(h * 10) / 10);
  const o = cached('ladder:' + hh, g => {
    const rail = S('plank', true), rung = S('plank_dark', true), rope = C('#8a7650', true), top = hh + 0.55;
    for (const z of [-0.27, 0.27]) bb(g, rail, 0.07, top, 0.07, 0, 0, z);
    for (let y = 0.28; y < top - 0.1; y += 0.3) { bx(g, rung, 0.05, 0.05, 0.56, 0.0, y, 0); for (const z of [-0.27, 0.27]) bx(g, rope, 0.09, 0.03, 0.09, 0, y + 0.03, z); }
  });
  o.userData.deploy = 'ladder';
  return o;
}

// ---------------------------------------------------------------- high walls
function highwall(g, tier) {
  const y0 = -1.5;
  if (tier === 'wood') {
    const R = rng(77), logM = S('log', true), tip = T('#b39064', 'log', true), back = S('plank_dark', true), beamM = C('#5b3e26', true), rope = C('#6e5c3e', true);
    wbb(g, back, 2.98, 5.1, 0.1, 0, y0, -0.12, 2);
    for (let i = 0; i < 8; i++) {
      const x = -1.3125 + i * 0.375, r = 0.172 + R() * 0.012, top = 4.02 + R() * 0.2;
      cv(g, logM, r, r * 1.05, top - y0, x, y0, 0.03, 7);
      cv(g, tip, 0.015, r, 0.46, x, top, 0.03, 7);
    }
    for (const [y, z] of [[0.55, 0.24], [3.05, 0.24], [0.9, -0.2], [3.3, -0.2]]) bb(g, beamM, 2.96, 0.22, 0.12, 0, y, z);
    bb(g, rope, 2.98, 0.07, 0.05, 0, 3.75, 0.21);
    return;
  }
  const stone = T('#8a8984', 'stoneblock', true), cap = T('#aba9a2', 'stoneblock', true), pil = C('#77756f', true), pilCap = C('#908e88', true), base = T('#65645f', 'stoneblock', true);
  wbb(g, stone, 2.4, 5.5, 0.5, 0, y0, 0, 3);
  bb(g, base, 2.4, 0.5, 0.58, 0, -0.3, 0);
  bb(g, cap, 2.4, 0.16, 0.6, 0, 3.86, 0);
  for (const x of [-0.6, 0.6]) bb(g, stone, 0.55, 0.5, 0.5, x, 4.02, 0);
  for (const x of [-1.5, 1.5]) stonePillar(g, x);
}

// ============================================================================
// DOORS & GATES — root origin = doorway centre at floor; panel pivots at hinge
// ============================================================================
export function makeDoor(type = 'door_wood', opts = {}) {
  opts = opts || {};
  const root = G(); root.userData.door = type;
  const panel = G(); let panel2, width = 1.2, height = 2.1;
  if (type === 'gate_wood' || type === 'gate_stone') {
    width = 3.0; height = 4.2;
    root.add(cached('gframe:' + type, g => gateFrame(g, type)));
    panel.position.set(-1.5, 0, 0); panel.add(cached('gpanel:' + type + ':1', g => gatePanel(g, type, 1)));
    panel2 = G(); panel2.position.set(1.5, 0, 0); panel2.add(cached('gpanel:' + type + ':-1', g => gatePanel(g, type, -1)));
    root.add(panel, panel2);
  } else if (type === 'vault' || type === 'steel') {
    width = 1.4; height = 2.3;
    const col = opts.color || '#3a9a4a';
    root.add(cached('mframe:' + type, g => monumentFrame(g, type)));
    panel.position.set(-0.7, 0, 0);
    panel.add(cached('mpanel:' + type + (type === 'vault' ? col : ''), g => monumentPanel(g, type, col)));
    root.add(panel);
  } else {
    const t = ['door_wood', 'door_metal', 'door_armored'].includes(type) ? type : 'door_wood';
    panel.position.set(-0.6, 0, 0);
    panel.add(cached('dpanel:' + t, g => doorPanel(g, t)));
    root.add(panel);
  }
  panel.name = 'panel'; if (panel2) panel2.name = 'panel2';
  const out = { root, panel, width, height };
  if (panel2) out.panel2 = panel2;
  return out;
}

// panel-local: hinge at x=0, panel spans x 0..1.2, y 0..2.1. +Z face = inside (lock side).
function codeLock(g, x, y, z, s = 1) {
  bx(g, C('#6f7378', true), 0.1, 0.17, 0.05, x, y, z + s * 0.025);
  bx(g, C('#1c1d20', true), 0.07, 0.06, 0.012, x, y + 0.02, z + s * 0.052);
  bx(g, GL('#46e05a'), 0.025, 0.025, 0.01, x + 0.02, y - 0.055, z + s * 0.052);
}
function doorPanel(g, type) {
  if (type === 'door_wood') {
    const pl = S('plank', true), pd = T('#93683e', 'plank', true), dk = S('plank_dark', true), iron = C('#2e2d2b', true);
    for (let i = 0; i < 5; i++) bx(g, i % 2 ? pd : pl, 2.08, 0.226, 0.07, 0.128 + i * 0.236, 1.05, 0, { rz: PI / 2 });
    for (const y of [0.36, 1.74]) bx(g, dk, 1.1, 0.15, 0.04, 0.6, y, 0.055);
    beam(g, dk, 0.13, 0.04, [0.16, 0.44, 0.055], [1.04, 1.66, 0.055]);
    for (const y of [0.36, 1.74]) { bx(g, iron, 0.72, 0.07, 0.015, 0.37, y, -0.042); cv(g, iron, 0.03, 0.03, 0.3, 0.0, y - 0.15, 0, 6); }
    for (const s of [-1, 1]) bx(g, iron, 0.05, 0.16, 0.04, 1.06, 1.0, s * 0.055);
    codeLock(g, 1.04, 1.24, 0.035, 1);
    return;
  }
  if (type === 'door_metal') {
    const sh = T('#8b9299', 'metal', true), fr = S('rust', true), dk = C('#3a3d42', true);
    bx(g, sh, 1.18, 2.08, 0.06, 0.6, 1.05, 0, { ts: 1.2 });
    for (const s of [-1, 1]) {
      const z = s * 0.035;
      bx(g, fr, 1.18, 0.1, 0.02, 0.6, 0.06, z); bx(g, fr, 1.18, 0.1, 0.02, 0.6, 2.04, z);
      bx(g, fr, 0.1, 1.88, 0.02, 0.06, 1.05, z); bx(g, fr, 0.1, 1.88, 0.02, 1.14, 1.05, z);
      bx(g, fr, 0.98, 0.08, 0.02, 0.6, 1.05, z);
      beam(g, fr, 0.08, 0.02, [0.14, 0.14, z], [1.06, 1.0, z]);
    }
    bx(g, C('#141416', true), 0.34, 0.06, 0.07, 0.6, 1.76, 0);
    cv(g, dk, 0.03, 0.03, 0.5, 0.0, 0.2, 0, 6); cv(g, dk, 0.03, 0.03, 0.5, 0.0, 1.4, 0, 6);
    for (const s of [-1, 1]) bx(g, dk, 0.05, 0.22, 0.05, 1.05, 1.0, s * 0.055);
    codeLock(g, 1.02, 1.26, 0.03, 1);
    return;
  }
  // armored
  const pl = S('armor', true), pl2 = T('#4b5059', 'armor', true), haz = S('hazard', true), bolt = C('#16171a', true), dk = C('#26292e', true);
  bx(g, pl, 1.18, 2.08, 0.1, 0.6, 1.05, 0, { ts: 1.2 });
  for (const s of [-1, 1]) {
    const z = s * 0.057;
    bx(g, pl2, 0.92, 1.26, 0.02, 0.6, 1.2, z, { ts: 1.2 });
    bx(g, haz, 1.18, 0.24, 0.02, 0.6, 0.18, z, { ts: 0.6 });
    for (const [x, y] of [[0.18, 0.62], [1.02, 0.62], [0.18, 1.78], [1.02, 1.78], [0.6, 0.62], [0.6, 1.78]]) bx(g, bolt, 0.055, 0.055, 0.03, x, y, z);
  }
  bx(g, S('glass_dark', true), 0.4, 0.08, 0.12, 0.6, 1.9, 0);
  cv(g, dk, 0.045, 0.045, 0.4, 0.0, 0.2, 0, 6); cv(g, dk, 0.045, 0.045, 0.4, 0.0, 1.45, 0, 6);
  bx(g, dk, 0.06, 0.3, 0.06, 1.05, 1.0, -0.08);
  codeLock(g, 1.02, 1.22, 0.05, 1);
}

function gateFrame(g, type) {
  if (type === 'gate_wood') {
    const logM = S('log', true), tip = T('#b39064', 'log', true), beamM = C('#5b3e26', true);
    for (const x of [-1.5, 1.5]) { cv(g, logM, 0.25, 0.27, 6.5, x, -1.5, 0, 8); cv(g, tip, 0.02, 0.25, 0.5, x, 5.0, 0, 8); }
    rod(g, logM, 0.17, [-1.78, 4.62, 0.05], [1.78, 4.62, 0.05], 8);
    for (const x of [-1.5, 1.5]) bb(g, beamM, 0.6, 0.18, 0.6, x, 4.5, 0);
    return;
  }
  const pil = C('#77756f', true), pilCap = C('#908e88', true), stone = T('#8a8984', 'stoneblock', true), cap = T('#aba9a2', 'stoneblock', true);
  for (const x of [-1.5, 1.5]) stonePillar(g, x);
  bb(g, stone, 2.4, 0.42, 0.56, 0, 4.28, 0);
  bb(g, cap, 2.4, 0.1, 0.62, 0, 4.6, 0);
}
function gatePanel(g, type, s) {
  if (type === 'gate_wood') {
    const R = rng(s > 0 ? 5 : 9), logM = S('log', true), tip = T('#b39064', 'log', true), beamM = C('#5b3e26', true), iron = C('#2e2d2b', true);
    for (let i = 0; i < 4; i++) {
      const x = s * (0.19 + i * 0.375), r = 0.165 + R() * 0.012, top = 3.72 + R() * 0.12;
      cv(g, logM, r, r, top - 0.02, x, 0.02, 0, 7);
      cv(g, tip, 0.015, r, 0.42, x, top, 0, 7);
    }
    for (const [y, z] of [[0.6, 0.22], [3.1, 0.22], [0.75, -0.21], [2.95, -0.21]]) bx(g, beamM, 1.44, 0.2, 0.1, s * 0.74, y, z);
    beam(g, beamM, 0.15, 0.08, [s * 0.18, 0.75, 0.22], [s * 1.3, 2.95, 0.22]);
    for (const y of [0.6, 3.1]) bx(g, iron, 0.55, 0.09, 0.02, s * 0.3, y, -0.27);
    bx(g, iron, 0.06, 0.25, 0.06, s * 1.38, 1.6, 0.27);
    return;
  }
  const pl = S('metal_dark', true), bar = T('#5e4a3c', 'metal', true), bolt = C('#1e1f22', true);
  bx(g, pl, 1.46, 4.16, 0.12, s * 0.74, 2.1, 0, { ts: 1.5 });
  for (const z of [-0.075, 0.075]) {
    for (const y of [0.16, 1.4, 2.8, 4.04]) bx(g, bar, 1.46, 0.16, 0.03, s * 0.74, y, z);
    for (const x of [0.08, 1.4]) bx(g, bar, 0.14, 4.16, 0.03, s * x, 2.1, z);
    beam(g, bar, 0.14, 0.03, [s * 0.15, 1.45, z], [s * 1.33, 2.75, z]);
    for (const y of [0.16, 1.4, 2.8, 4.04]) for (let x = 0.2; x < 1.4; x += 0.3) bx(g, bolt, 0.05, 0.05, 0.02, s * x, y, z * 1.25);
  }
  for (let i = 0; i < 4; i++) cv(g, bar, 0.01, 0.05, 0.25, s * (0.18 + i * 0.37), 4.18, 0, 5);
  bx(g, bolt, 0.07, 0.3, 0.07, s * 1.36, 1.6, 0.1);
}
function monumentFrame(g, type) {
  const fr = type === 'vault' ? C('#3e4248', true) : C('#5d6269', true);
  for (const x of [-0.78, 0.78]) bb(g, fr, 0.16, 2.46, 0.36, x, 0, 0);
  bb(g, fr, 1.72, 0.16, 0.36, 0, 2.3, 0);
  if (type === 'vault') for (const x of [-0.78, 0.78]) for (const s of [-1, 1]) bb(g, S('hazard', true), 0.16, 2.2, 0.01, x, 0.1, s * 0.185, { ts: 0.6 });
}
function monumentPanel(g, type, col) {
  if (type === 'vault') {
    const pl = S('metal_dark', true), ring = C('#6f757d', true), dk = C('#2a2d31', true), stripe = C(col, true);
    bx(g, pl, 1.38, 2.28, 0.2, 0.7, 1.15, 0, { ts: 1.4 });
    for (const s of [-1, 1]) {
      M.add(g, torus(0.44, 0.05, 5, 20), ring, 0.7, 1.15, s * 0.1);
      bx(g, stripe, 1.38, 0.12, 0.02, 0.7, 1.95, s * 0.105);
      bx(g, GL(col), 0.07, 0.07, 0.02, 1.2, 2.13, s * 0.11);
    }
    M.add(g, torus(0.22, 0.035, 5, 14), dk, 0.7, 1.15, -0.16);
    for (let i = 0; i < 4; i++) bx(g, dk, 0.44, 0.04, 0.04, 0.7, 1.15, -0.16, { rz: i * PI / 4 });
    cv(g, dk, 0.06, 0.06, 0.12, 0.7, 1.15, -0.12, 8, { rx: PI / 2 });
    for (const y of [0.35, 1.15, 1.95]) cv(g, ring, 0.06, 0.06, 0.32, 0.0, y - 0.16, 0, 8);
    return;
  }
  const pl = T('#8a9099', 'metal', true), dk = C('#3a3d42', true);
  bx(g, pl, 1.38, 2.28, 0.08, 0.7, 1.15, 0, { ts: 1.4 });
  for (const s of [-1, 1]) { bx(g, dk, 1.38, 0.25, 0.02, 0.7, 0.14, s * 0.045); bx(g, dk, 1.38, 0.05, 0.02, 0.7, 2.26, s * 0.045); }
  bx(g, S('glass_dark', true), 0.32, 0.42, 0.09, 0.7, 1.65, 0);
  cxl(g, C('#b0b4b8', true), 0.025, 0.9, 0.75, 1.05, 0.09, 6);
  for (const x of [0.32, 1.18]) bx(g, dk, 0.05, 0.05, 0.08, x, 1.05, 0.06);
  bx(g, dk, 0.05, 0.2, 0.05, 1.22, 1.05, -0.065);
  for (const y of [0.4, 1.9]) cv(g, dk, 0.045, 0.045, 0.3, 0.0, y - 0.15, 0, 6);
}

// ============================================================================
// DEPLOYABLES — origin floor centre, the working / front side faces +X.
// DEPLOY_INFO: w = local X extent, d = local Z extent, h = height.
// Hooks: userData.lid + setOpen(k), setLit(bool), light (Vector3 local),
// head (yaw Group) + muzzle (Vector3 local to head), tick(t). Planter crops: makeCrop().
// ============================================================================
export const DEPLOY_INFO = {
  tc: { w: 0.55, d: 0.9, h: 1.85, solid: true },
  box_small: { w: 0.5, d: 0.8, h: 0.5, solid: true },
  box_large: { w: 0.8, d: 1.5, h: 0.8, solid: true },
  furnace: { w: 1.0, d: 1.0, h: 1.4, solid: true },
  campfire: { w: 1.2, d: 1.2, h: 0.5, solid: false, r: 0.6 },
  workbench1: { w: 0.9, d: 1.8, h: 1.2, solid: true },
  workbench2: { w: 1.0, d: 2.0, h: 1.6, solid: true },
  workbench3: { w: 1.2, d: 2.4, h: 1.4, solid: true },
  research: { w: 0.8, d: 1.5, h: 1.3, solid: true },
  recycler: { w: 1.6, d: 1.6, h: 1.8, solid: true },
  sleeping_bag: { w: 2.0, d: 0.9, h: 0.18, solid: false },
  bed: { w: 2.2, d: 1.2, h: 0.85, solid: true },
  planter: { w: 3.0, d: 1.0, h: 0.5, solid: true },
  water_barrel: { w: 0.9, d: 0.9, h: 1.05, solid: true, r: 0.45 },
  auto_turret: { w: 0.8, d: 0.8, h: 1.2, solid: true },
  shotgun_trap: { w: 0.6, d: 0.6, h: 0.8, solid: true },
  landmine: { w: 0.5, d: 0.5, h: 0.08, solid: false, r: 0.25 },
  spikes: { w: 0.8, d: 3.0, h: 0.7, solid: false },
  floodlight: { w: 0.6, d: 0.6, h: 2.5, solid: true },
  lantern: { w: 0.3, d: 0.3, h: 0.45, solid: false, r: 0.15 },
  quarry: { w: 2.4, d: 2.4, h: 2.6, solid: true },
  repair_bench: { w: 0.8, d: 1.6, h: 1.5, solid: true },
  rug: { w: 2.0, d: 1.4, h: 0.03, solid: false },
  stash: { w: 0.6, d: 0.6, h: 0.14, solid: false },
  ladder: { w: 0.2, d: 0.7, h: 3, solid: false },
};

const DEP = {};
export function makeDeployable(type) {
  const t = DEP[type] ? type : 'box_small';
  const D = DEP[t];
  const out = cached('dep:' + t, D.base);
  if (D.post) D.post(out);
  out.userData.deploy = t;
  return out;
}
// hinged lid: hinge position, axis, open angle for k = 1
function addLid(out, key, hinge, axis, angle, build) {
  const lid = G(); lid.position.set(hinge[0], hinge[1], hinge[2]); lid.name = 'lid';
  lid.add(cached(key, build)); out.add(lid);
  out.userData.lid = lid;
  out.userData.setOpen = k => { lid.rotation[axis] = angle * k; };
  return lid;
}
function codeLockX(g, x, y, z) {   // code lock on a +X face
  bx(g, C('#6f7378'), 0.05, 0.17, 0.1, x + 0.025, y, z);
  bx(g, C('#1c1d20'), 0.012, 0.06, 0.07, x + 0.052, y + 0.02, z);
  bx(g, GL('#46e05a'), 0.01, 0.025, 0.025, x + 0.052, y - 0.055, z + 0.02);
}
const dark = () => C('#2c2e33');

DEP.tc = {
  base(g) {
    const pl = S('plank', true), dk = S('plank_dark', true), trim = C('#4e3622', true), iron = C('#34312d', true), roof = S('rust', true), paint = T('#d6a83a', 'metal', true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, trim, 0.08, 0.08, 0.08, sx * 0.2, 0, sz * 0.4);
    wbb(g, pl, 0.5, 1.6, 0.9, 0, 0.08, 0, 2);
    for (const s of [-1, 1]) bb(g, dk, 0.03, 1.28, 0.405, 0.265, 0.3, s * 0.215);
    for (const s of [-1, 1]) { bb(g, trim, 0.06, 1.6, 0.06, 0.24, 0.08, s * 0.43); bb(g, trim, 0.06, 1.6, 0.06, -0.24, 0.08, s * 0.43); }
    bb(g, trim, 0.56, 0.08, 0.92, 0, 1.6, 0); bb(g, trim, 0.56, 0.08, 0.92, 0, 0.12, 0);
    bx(g, roof, 0.66, 0.05, 1.02, 0, 1.73, 0, { rz: -0.14 });
    bx(g, paint, 0.34, 0.02, 0.56, 0.0, 1.765, 0, { rz: -0.14 });
    for (const s of [-1, 1]) for (const y of [0.45, 1.4]) bx(g, iron, 0.02, 0.07, 0.06, 0.285, y, s * 0.4);
    for (const s of [-1, 1]) bx(g, iron, 0.03, 0.14, 0.03, 0.29, 0.95, s * 0.05);
    codeLockX(g, 0.28, 1.15, 0.12);
    // tool rack on the side
    bb(g, dk, 0.4, 0.04, 0.04, 0, 1.1, 0.47); bx(g, C('#8a8d92', true), 0.04, 0.3, 0.12, 0.08, 0.98, 0.49);
  },
};
DEP.box_small = {
  base(g) {
    const pl = S('plank'), dk = C('#5b3e26'), iron = C('#34312d'), rope = C('#8a7650');
    wbb(g, pl, 0.48, 0.37, 0.78, 0, 0.03, 0, 1.5);
    for (const s of [-1, 1]) bb(g, dk, 0.5, 0.04, 0.08, 0, 0, s * 0.32);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, iron, 0.04, 0.37, 0.04, sx * 0.235, 0.03, sz * 0.385);
    for (const s of [-1, 1]) bx(g, rope, 0.18, 0.04, 0.03, 0, 0.3, s * 0.405);
  },
  post(out) {
    addLid(out, 'dep:box_small:lid', [-0.25, 0.4, 0], 'z', 1.25, g => {
      bb(g, T('#93683e', 'plank'), 0.52, 0.08, 0.82, 0.26, 0, 0, { ts: 1.5 });
      for (const s of [-1, 1]) bb(g, C('#34312d'), 0.53, 0.085, 0.04, 0.26, -0.002, s * 0.3);
      bx(g, C('#8a8d92'), 0.03, 0.09, 0.08, 0.53, -0.01, 0);
    });
  },
};
DEP.box_large = {
  base(g) {
    const pl = S('plank'), dk = C('#5b3e26'), iron = C('#3b3a38'), rope = C('#8a7650');
    wbb(g, pl, 0.78, 0.64, 1.48, 0, 0.04, 0, 1.5);
    for (const s of [-1, 1]) { bb(g, dk, 0.8, 0.05, 0.1, 0, 0, s * 0.62); bb(g, iron, 0.8, 0.645, 0.06, 0, 0.04, s * 0.45); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, iron, 0.05, 0.64, 0.05, sx * 0.37, 0.04, sz * 0.72);
    for (const s of [-1, 1]) { bx(g, rope, 0.24, 0.05, 0.03, 0, 0.5, s * 0.755); bx(g, iron, 0.03, 0.1, 0.1, 0.4, 0.6, s * 0.2); }
  },
  post(out) {
    addLid(out, 'dep:box_large:lid', [-0.4, 0.68, 0], 'z', 1.2, g => {
      bb(g, T('#93683e', 'plank'), 0.82, 0.1, 1.52, 0.41, 0, 0, { ts: 1.5 });
      for (const s of [-1, 1]) bb(g, C('#3b3a38'), 0.83, 0.105, 0.06, 0.41, -0.002, s * 0.45);
      bb(g, C('#5b3e26'), 0.6, 0.03, 0.1, 0.41, 0.1, 0);
    });
  },
};
DEP.furnace = {
  base(g) {
    const st = S('stone', true), sd = T('#6c6b67', 'stoneblock', true), dk = C('#1b1512', true), iron = C('#3a3633', true), pipe = S('metal_dark', true), rock = S('rock');
    cv(g, sd, 0.52, 0.55, 0.16, 0, 0, 0, 8, { ry: PI / 8 });
    cv(g, st, 0.4, 0.49, 0.95, 0, 0.16, 0, 8, { ry: PI / 8 });
    cv(g, sd, 0.44, 0.44, 0.1, 0, 1.1, 0, 8, { ry: PI / 8 });
    cv(g, dk, 0.32, 0.32, 0.02, 0, 1.2, 0, 8, { ry: PI / 8 });
    bx(g, dk, 0.16, 0.34, 0.4, 0.42, 0.45, 0);
    bx(g, iron, 0.06, 0.06, 0.52, 0.47, 0.65, 0); bx(g, iron, 0.06, 0.06, 0.52, 0.48, 0.25, 0);
    for (const s of [-1, 1]) bx(g, iron, 0.06, 0.46, 0.06, 0.47, 0.45, s * 0.23);
    cv(g, pipe, 0.09, 0.1, 0.42, -0.18, 1.14, 0.14, 8); cv(g, iron, 0.14, 0.14, 0.05, -0.18, 1.56, 0.14, 8);
    const R = rng(4);
    for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + 0.4; M.add(g, M.ico(0.11, 0), rock, Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55, { sx: 1.2, sy: 0.7, sz: 1, ry: R() * 3 }); }
  },
  post(out) {
    const glow = G();
    M.add(glow, M.box(0.03, 0.28, 0.34), GL('#ff8a2a'), 0.51, 0.45, 0, { cast: false });
    M.add(glow, M.cyl(0.28, 0.28, 0.01, 8), GL('#ff5a14'), 0, 1.215, 0, { cast: false, ry: PI / 8 });
    out.add(glow);
    out.userData.glow = glow;
    out.userData.light = V3(0.7, 0.5, 0);
    out.userData.setLit = on => { glow.visible = !!on; };
    out.userData.setLit(false);
  },
};
DEP.campfire = {
  base(g) {
    const rock = S('rock'), logM = S('log'), ash = C('#2c2824'), char = C('#1c1816');
    cv(g, ash, 0.42, 0.46, 0.04, 0, 0, 0, 10);
    const R = rng(8);
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; M.add(g, M.ico(0.13, 0), rock, Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5, { sx: 1.1, sy: 0.75, sz: 1.3, ry: a + R() }); }
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.5;
      rod(g, logM, 0.055, [Math.cos(a) * 0.4, 0.04, Math.sin(a) * 0.4], [Math.cos(a) * 0.05, 0.46, Math.sin(a) * 0.05], 6);
      rod(g, char, 0.05, [Math.cos(a) * 0.12, 0.36, Math.sin(a) * 0.12], [Math.cos(a) * 0.03, 0.5, Math.sin(a) * 0.03], 5);
    }
    rod(g, logM, 0.06, [-0.35, 0.06, -0.1], [0.35, 0.06, 0.12], 6);
  },
  post(out) {
    const f = G(); f.name = 'flame';
    const add = (geo, m, x, y, z, o) => M.add(f, geo, m, x, y, z, Object.assign({ cast: false, recv: false }, o));
    add(M.cone(0.2, 0.62, 6), ADD('#ff6a1a'), 0, 0.33, 0);
    add(M.cone(0.13, 0.46, 6), ADD('#ffc04a'), 0.02, 0.27, 0.02);
    add(M.cone(0.11, 0.38, 5), ADD('#ff7a2a'), -0.1, 0.22, 0.08, { rz: 0.35 });
    add(M.cone(0.1, 0.34, 5), ADD('#ff8a2a'), 0.09, 0.2, -0.08, { rz: -0.3 });
    add(M.cyl(0.3, 0.32, 0.02, 10), GL('#ff4a10'), 0, 0.045, 0);
    out.add(f);
    out.userData.flame = f;
    out.userData.light = V3(0, 0.45, 0);
    out.userData.setLit = on => { f.visible = !!on; };
    out.userData.tick = t => { const k = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06; f.scale.set(1, k, 1); f.rotation.y = t * 0.7; };
    out.userData.setLit(true);
  },
};
DEP.workbench1 = {
  base(g) {
    const pl = S('plank'), dk = S('plank_dark'), leg = C('#5b3e26'), iron = C('#4a4c52'), steel = C('#a8adb2'), red = C('#a8402e');
    bb(g, pl, 1.8, 0.1, 0.9, 0, 0.8, 0, { ry: PI / 2 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, leg, 0.1, 0.8, 0.1, sx * 0.38, 0, sz * 0.82);
    bb(g, dk, 0.76, 0.04, 1.66, 0, 0.22, 0);
    for (const s of [-1, 1]) bb(g, leg, 0.06, 0.08, 1.64, s * 0.38, 0.42, 0);
    bb(g, dk, 0.06, 0.32, 1.8, -0.42, 0.9, 0);
    // tools: hammer, saw, nails, vice, scrap planks
    bb(g, leg, 0.04, 0.03, 0.32, 0.18, 0.9, 0.35); bb(g, iron, 0.12, 0.06, 0.06, 0.18, 0.9, 0.5);
    bb(g, steel, 0.2, 0.006, 0.46, 0.0, 0.9, -0.3, { ry: 0.15 }); bb(g, leg, 0.06, 0.03, 0.12, 0.0, 0.9, -0.56);
    bb(g, red, 0.12, 0.06, 0.1, -0.2, 0.9, 0.0);
    bb(g, iron, 0.16, 0.12, 0.2, 0.36, 0.9, 0.72); bb(g, iron, 0.04, 0.06, 0.24, 0.43, 0.98, 0.72);
    for (let i = 0; i < 3; i++) bb(g, pl, 0.14, 0.04, 1.1, -0.15 + i * 0.16, 0.26, 0.1, { ry: 0.05 * i });
    bx(g, iron, 0.02, 0.18, 0.05, -0.38, 1.05, 0.3); bx(g, steel, 0.02, 0.05, 0.24, -0.38, 1.12, -0.3);
  },
};
DEP.workbench2 = {
  base(g) {
    const top = T('#8c939a', 'metal'), legM = C('#3e4248'), blue = T('#3f5a73', 'metal'), dk = C('#22252a'), peg = T('#8a7a5c', 'noise', true), red = T('#b8402f', 'metal'), steel = C('#a8adb2');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, legM, 0.08, 0.9, 0.08, sx * 0.44, 0, sz * 0.94);
    wbb(g, top, 1.0, 0.08, 2.0, 0, 0.9, 0, 1);
    wbb(g, blue, 0.8, 0.72, 0.72, 0, 0.12, -0.58, 1);
    for (let i = 0; i < 3; i++) { bx(g, dk, 0.01, 0.02, 0.66, 0.405, 0.36 + i * 0.22, -0.58); bx(g, steel, 0.03, 0.03, 0.18, 0.415, 0.27 + i * 0.22, -0.58); }
    bb(g, S('metal_dark'), 0.84, 0.04, 1.1, 0, 0.18, 0.4);
    wbb(g, peg, 0.04, 0.62, 2.0, -0.48, 0.98, 0, 1);
    for (let i = 0; i < 6; i++) bx(g, i % 2 ? steel : C('#5a5d62'), 0.02, 0.22 + (i % 3) * 0.06, 0.05, -0.45, 1.3, -0.8 + i * 0.3);
    bb(g, red, 0.32, 0.18, 0.5, -0.12, 0.98, -0.55);
    bb(g, dk, 0.2, 0.16, 0.18, 0.36, 0.98, 0.8); bb(g, C('#4a5a6a'), 0.06, 0.08, 0.26, 0.44, 1.08, 0.8);
    czl(g, C('#4f6e3e'), 0.09, 0.22, 0.1, 1.08, 0.3, 10); czl(g, C('#888c90'), 0.12, 0.03, 0.1, 1.08, 0.44, 12);
  },
};
DEP.workbench3 = {
  base(g) {
    const yl = T('#c9a032', 'metal'), dk = C('#2c2e33'), haz = S('hazard'), steel = C('#a8adb2'), md = S('metal_dark');
    bb(g, dk, 1.2, 0.08, 2.4, 0, 0, 0);
    wbb(g, yl, 1.1, 0.68, 2.3, 0, 0.08, 0, 1.5);
    bb(g, haz, 1.12, 0.1, 2.32, 0, 0.66, 0, { ts: 0.6 });
    bb(g, md, 0.5, 0.18, 2.1, -0.1, 0.76, 0, { ts: 1 });
    wbb(g, yl, 0.62, 0.5, 0.5, -0.1, 0.76, -0.86, 1);
    czl(g, steel, 0.17, 0.12, -0.1, 1.04, -0.55, 12);
    bb(g, yl, 0.4, 0.34, 0.3, -0.1, 0.94, 0.82); czl(g, steel, 0.04, 0.3, -0.1, 1.08, 0.55, 8);
    bb(g, dk, 0.36, 0.14, 0.34, -0.05, 0.94, 0.1); bb(g, steel, 0.08, 0.06, 0.2, 0.05, 1.08, 0.1);
    cxl(g, md, 0.22, 0.5, -0.32, 1.12, -0.86, 12);
    bx(g, dk, 0.08, 0.42, 0.55, 0.6, 0.98, 0.62, { rz: -0.3 });
    for (let i = 0; i < 3; i++) bx(g, GL(['#ff4a3a', '#4ae05a', '#ffb02a'][i]), 0.02, 0.05, 0.05, 0.655, 1.05, 0.45 + i * 0.12, { rz: -0.3 });
    cv(g, C('#c0302a'), 0.05, 0.05, 0.04, 0.6, 1.2, 0.86, 8);
    rod(g, dk, 0.03, [-0.5, 0.2, 1.1], [-0.6, 0.02, 1.4], 5);
  },
};
DEP.research = {
  base(g) {
    const pl = S('plank'), leg = C('#5b3e26'), paper = C('#e8e2d0'), blue = C('#3f6ea6'), dk = C('#2c2e33'), brass = C('#b08a40');
    bb(g, pl, 1.5, 0.06, 0.8, 0, 0.74, 0, { ry: PI / 2 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, leg, 0.07, 0.74, 0.07, sx * 0.34, 0, sz * 0.68);
    bb(g, leg, 0.05, 0.06, 1.3, -0.34, 0.25, 0);
    for (let i = 0; i < 4; i++) bb(g, paper, 0.26, 0.004, 0.2, -0.12 + (i % 2) * 0.1, 0.8 + i * 0.004, -0.25 + i * 0.12, { ry: (i - 1.5) * 0.4 });
    bb(g, blue, 0.4, 0.004, 0.55, 0.1, 0.8, -0.35, { ry: 0.12 });
    for (let i = 0; i < 3; i++) bb(g, C('#d8e4f0'), 0.36, 0.002, 0.01, 0.1, 0.805, -0.5 + i * 0.12, { ry: 0.12 });
    // desk lamp
    cv(g, dk, 0.08, 0.1, 0.03, -0.25, 0.8, 0.5, 10);
    rod(g, dk, 0.012, [-0.25, 0.83, 0.5], [-0.12, 1.15, 0.44], 5);
    rod(g, dk, 0.012, [-0.12, 1.15, 0.44], [0.02, 1.18, 0.4], 5);
    M.add(g, M.cone(0.1, 0.13, 10), C('#4f6e3e'), 0.04, 1.13, 0.4, { rz: 0.5 });
    // magnifier + gear scrap
    cv(g, brass, 0.03, 0.03, 0.12, 0.2, 0.8, 0.2, 8); M.add(g, torus(0.05, 0.01, 4, 10), brass, 0.2, 0.96, 0.2);
    cv(g, C('#7a7d82'), 0.08, 0.08, 0.02, 0.15, 0.8, 0.55, 8);
  },
  post(out) {
    M.add(out, M.sphere(0.04, 6, 4), GL('#ffe7a8'), 0.06, 1.08, 0.4, { cast: false });
    out.userData.light = V3(0.06, 1.05, 0.4);
  },
};
DEP.recycler = {
  base(g) {
    const gr = T('#557546', 'metal', true), grd = T('#3f5a32', 'metal', true), md = S('metal_dark', true), dk = C('#17181a', true), rustM = S('rust', true), haz = S('hazard', true);
    bb(g, C('#2c2e33'), 1.6, 0.1, 1.6, 0, 0, 0);
    wbb(g, gr, 1.3, 1.0, 1.3, 0, 0.1, 0, 1.3);
    bb(g, grd, 1.36, 0.08, 1.36, 0, 1.1, 0);
    bb(g, haz, 1.32, 0.14, 1.32, 0, 0.18, 0, { ts: 0.6 });
    M.add(g, openFrustum(0.8, 0.42, 0.56, 4), DS('#4f555d', 'metal', true), 0, 1.46, 0, { ry: PI / 4 });
    cv(g, C('#2a2b2e', true), 0.43, 0.43, 0.01, 0, 1.185, 0, 4, { ry: PI / 4 });
    for (const z of [-0.1, 0.1]) bx(g, C('#55595e', true), 0.56, 0.03, 0.03, 0, 1.2, z);
    for (let i = 0; i < 4; i++) bx(g, C('#c9a032', true), i % 2 ? 1.14 : 0.06, 0.04, i % 2 ? 0.06 : 1.14, i === 0 ? 0.57 : i === 2 ? -0.57 : 0, 1.74, i === 1 ? 0.57 : i === 3 ? -0.57 : 0);
    for (const s of [-1, 1]) { czl(g, rustM, 0.36, 0.08, 0.05, 0.62, s * 0.69, 12); czl(g, md, 0.1, 0.12, 0.05, 0.62, s * 0.72, 8); for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; bx(g, rustM, 0.1, 0.1, 0.08, 0.05 + Math.cos(a) * 0.38, 0.62 + Math.sin(a) * 0.38, s * 0.69, { rz: a }); } }
    bx(g, md, 0.55, 0.06, 0.5, 0.82, 0.48, 0, { rz: -0.45 });
    bb(g, md, 0.3, 0.28, 0.6, 0.72, 0.1, 0);
    cv(g, md, 0.06, 0.06, 0.5, -0.5, 1.1, -0.5, 8);
    for (const z of [-0.3, 0, 0.3]) bx(g, C('#e8e2d4', true), 0.01, 0.16, 0.1, 0.652, 0.75, z, { rz: 0 });
  },
  post(out) {
    M.add(out, M.cyl(0.06, 0.06, 0.1, 8), GL('#ffb02a'), 0.55, 1.2, 0.55, { cast: false });
    out.userData.light = V3(0.55, 1.3, 0.55);
  },
};
DEP.sleeping_bag = {
  base(g) {
    const bag = T('#56683e', 'cloth'), bag2 = T('#6a7c4a', 'cloth'), pil = T('#8a7a5a', 'cloth'), seam = T('#46572f', 'cloth');
    bb(g, bag, 1.86, 0.1, 0.8, 0.05, 0, 0);
    bb(g, pil, 0.36, 0.08, 0.62, -0.7, 0.1, 0);
    bb(g, bag2, 1.0, 0.05, 0.82, 0.45, 0.1, 0);
    cxl(g, seam, 0.055, 1.86, 0.05, 0.07, 0.4, 8);
    bb(g, seam, 0.04, 0.06, 0.82, -0.05, 0.1, 0);
  },
};
DEP.bed = {
  base(g) {
    const fr = C('#3e4248'), mat = T('#8a8f9a', 'cloth'), pil = T('#d8d4c8', 'cloth'), bl = T('#5a6a8a', 'cloth'), bl2 = T('#6c7c9c', 'cloth');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cv(g, fr, 0.03, 0.03, sx < 0 ? 0.85 : 0.42, sx * 1.06, 0, sz * 0.56, 6);
    for (const s of [-1, 1]) cxl(g, fr, 0.025, 2.12, 0, 0.3, s * 0.56, 6);
    for (const s of [-1, 1]) czl(g, fr, 0.025, 1.12, s * 1.06, 0.3, 0, 6);
    for (const y of [0.6, 0.8]) czl(g, fr, 0.022, 1.12, -1.06, y, 0, 6);
    bb(g, mat, 2.08, 0.16, 1.08, 0, 0.3, 0);
    bb(g, pil, 0.34, 0.1, 0.76, -0.82, 0.46, 0);
    bb(g, bl, 1.32, 0.04, 1.12, 0.36, 0.46, 0);
    bb(g, bl2, 0.2, 0.06, 1.12, -0.26, 0.46, 0);
  },
};
DEP.planter = {
  base(g) {
    const pl = S('plank'), dk = C('#5b3e26'), soil = T('#5a4630', 'dirt');
    for (const s of [-1, 1]) { wbb(g, pl, 3.0, 0.44, 0.08, 0, 0.02, s * 0.46, 2); wbb(g, pl, 0.08, 0.44, 0.84, s * 1.46, 0.02, 0, 2); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, dk, 0.11, 0.5, 0.11, sx * 1.46, 0, sz * 0.46);
    for (const x of [-0.5, 0.5]) for (const s of [-1, 1]) bb(g, dk, 0.06, 0.46, 0.04, x, 0.02, s * 0.5);
    bb(g, soil, 2.84, 0.38, 0.84, 0, 0.02, 0);
    // one mound per plot (crops are added on top by farming.js: makeCrop)
    for (const x of [-1.0, 0, 1.0]) M.add(g, M.sphere(0.24, 8, 4), soil, x, 0.4, 0, { sy: 0.22 });
  },
};
let _openCyl;
DEP.water_barrel = {
  base(g) {
    const blue = C('#3f6f9e'), rib = C('#355f8a'), tarp = DS('#56683e', 'cloth'), water = C('#4b86a6'), iron = C('#3a3d42');
    cv(g, blue, 0.4, 0.4, 0.86, 0, 0, 0, 14);
    for (const y of [0.2, 0.6]) cv(g, rib, 0.412, 0.412, 0.05, 0, y, 0, 14);
    if (!_openCyl) _openCyl = new THREE.CylinderGeometry(0.5, 0.36, 0.18, 14, 1, true);
    M.add(g, _openCyl, tarp, 0, 0.95, 0);
    cv(g, water, 0.46, 0.46, 0.01, 0, 0.98, 0, 14);
    M.add(g, torus(0.5, 0.02, 4, 16), iron, 0, 1.04, 0, { rx: PI / 2 });
    cxl(g, iron, 0.03, 0.12, 0.44, 0.14, 0, 6); bx(g, iron, 0.03, 0.06, 0.03, 0.5, 0.11, 0);
  },
};
DEP.auto_turret = {
  base(g) {
    const md = C('#3a3d42'), legM = C('#2c2e33'), box = T('#4a4c52', 'metal');
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + PI / 6; rodT(g, legM, 0.035, 0.025, [Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36], [0, 0.5, 0], 6); bx(g, legM, 0.1, 0.03, 0.1, Math.cos(a) * 0.36, 0.015, Math.sin(a) * 0.36); }
    cv(g, md, 0.07, 0.09, 0.55, 0, 0.05, 0, 8);
    bb(g, md, 0.28, 0.05, 0.28, 0, 0.52, 0);
    bb(g, box, 0.14, 0.18, 0.1, -0.1, 0.25, 0.12); rod(g, C('#1c1d20'), 0.012, [-0.1, 0.25, 0.17], [-0.3, 0.0, 0.3], 4);
  },
  post(out) {
    const head = G(); head.position.set(0, 0.57, 0); head.name = 'head';
    head.add(cached('dep:auto_turret:head', g => {
      const body = T('#4a4c52', 'metal'), dk = C('#2a2b2f'), gun = C('#1f2023'), ol = T('#5d6b3c', 'metal');
      cv(g, dk, 0.14, 0.16, 0.08, 0, 0, 0, 10);
      bb(g, body, 0.42, 0.24, 0.34, 0, 0.08, 0);
      bb(g, C('#3a3c42'), 0.46, 0.04, 0.38, -0.02, 0.32, 0);
      cxl(g, gun, 0.034, 0.5, 0.44, 0.2, 0, 8); cxl(g, dk, 0.058, 0.2, 0.3, 0.2, 0, 8);
      cxl(g, gun, 0.045, 0.04, 0.68, 0.2, 0, 8);
      bb(g, C('#1c1d20'), 0.1, 0.08, 0.1, 0.17, 0.34, 0.08);
      bb(g, ol, 0.22, 0.14, 0.12, -0.04, 0.12, -0.23);
      rod(g, dk, 0.008, [-0.16, 0.36, 0.12], [-0.2, 0.66, 0.12], 4);
    }));
    const lens = M.add(head, M.box(0.012, 0.04, 0.05), GL('#ff3a2a'), 0.226, 0.38, 0.08, { cast: false });
    out.add(head);
    out.userData.head = head;
    out.userData.muzzle = V3(0.72, 0.2, 0);
    out.userData.setOn = on => { lens.material = on ? GL('#ff3a2a') : GL('#3a1a16'); };
  },
};
DEP.shotgun_trap = {
  base(g) {
    const pl = S('plank'), iron = C('#34312d');
    wbb(g, pl, 0.5, 0.4, 0.5, 0, 0.02, 0, 1.5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, iron, 0.04, 0.42, 0.04, sx * 0.24, 0, sz * 0.24);
    bb(g, iron, 0.2, 0.06, 0.2, 0, 0.42, 0);
    rod(g, C('#c8c0a8'), 0.004, [0.25, 0.1, 0.2], [0.6, 0.03, 0.5], 3);
  },
  post(out) {
    const head = G(); head.position.set(0, 0.48, 0); head.name = 'head';
    head.add(cached('dep:shotgun_trap:head', g => {
      const gun = C('#26272b'), wood = S('plank_dark'), iron = C('#34312d');
      bb(g, iron, 0.08, 0.1, 0.08, 0, 0, 0);
      for (const z of [-0.028, 0.028]) cxl(g, gun, 0.026, 0.56, 0.16, 0.13, z, 8);
      bb(g, gun, 0.16, 0.07, 0.1, -0.16, 0.09, 0);
      bx(g, wood, 0.3, 0.08, 0.07, -0.36, 0.08, 0, { rz: 0.12 });
      rod(g, C('#c8c0a8'), 0.004, [-0.16, 0.07, 0.05], [0.02, -0.06, 0.25], 3);
    }));
    out.add(head);
    out.userData.head = head;
    out.userData.muzzle = V3(0.45, 0.13, 0);
  },
};
DEP.landmine = {
  base(g) {
    cv(g, T('#6a5640', 'dirt'), 0.26, 0.29, 0.02, 0, 0, 0, 10);
    cv(g, T('#5d6b3c', 'metal'), 0.2, 0.22, 0.06, 0, 0, 0, 12);
    cv(g, C('#3f4a2a'), 0.08, 0.09, 0.03, 0, 0.06, 0, 10);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; bx(g, C('#2a2f22'), 0.03, 0.01, 0.03, Math.cos(a) * 0.15, 0.062, Math.sin(a) * 0.15); }
  },
};
DEP.spikes = {
  base(g) {
    const logM = S('log'), tipM = T('#c9a878', 'log'), rope = C('#6e5c3e');
    for (const x of [-0.22, 0.06]) rod(g, logM, 0.075, [x, 0.08, -1.5], [x, 0.08, 1.5], 7);
    for (let i = 0; i < 10; i++) {
      const z = -1.35 + i * 0.3, a = i % 2 ? 0.0 : 0.12;
      rodT(g, logM, 0.05, 0.03, [-0.34, 0.02, z], [0.2 + a, 0.52 + a, z], 6);
      rodT(g, tipM, 0.03, 0.004, [0.2 + a, 0.52 + a, z], [0.3 + a, 0.64 + a, z], 6);
      cv(g, rope, 0.06, 0.06, 0.05, -0.08, 0.14, z, 6);
    }
  },
};
DEP.floodlight = {
  base(g) {
    const legM = C('#2c2e33'), pole = C('#6a6e74'), dk = C('#26282c'), yl = T('#c9a032', 'metal');
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; rodT(g, legM, 0.025, 0.02, [Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3], [0, 0.9, 0], 5); }
    cv(g, pole, 0.03, 0.035, 2.2, 0, 0, 0, 8);
    bb(g, yl, 0.12, 0.2, 0.12, 0.06, 0.8, 0);
    rod(g, dk, 0.012, [0.06, 0.8, 0.04], [0.3, 0.0, 0.25], 4);
    const hg = G(); hg.position.set(0.08, 2.25, 0); hg.rotation.z = -0.5; g.add(hg);
    bb(hg, dk, 0.2, 0.32, 0.46, 0, -0.16, 0);
    bb(hg, C('#3a3d42'), 0.04, 0.36, 0.5, 0.1, -0.18, 0);
    for (const s of [-1, 1]) bx(g, dk, 0.08, 0.12, 0.03, 0.04, 2.2, s * 0.25);
  },
  post(out) {
    const hg = G(); hg.position.set(0.08, 2.25, 0); hg.rotation.z = -0.5; out.add(hg);
    const lens = M.add(hg, M.box(0.012, 0.28, 0.4), GL('#fff3cf'), 0.125, -0.18, 0, { cast: false });
    out.userData.light = V3(0.25, 2.15, 0);
    out.userData.lightDir = V3(1, -0.55, 0).normalize();
    out.userData.setLit = on => { lens.material = on ? GL('#fff3cf') : C('#5a5c60'); };
  },
};
DEP.lantern = {
  base(g) {
    const dk = C('#2c2a26'), brass = C('#9a7a3a');
    cv(g, dk, 0.09, 0.1, 0.05, 0, 0, 0, 8);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + PI / 4; rod(g, dk, 0.008, [Math.cos(a) * 0.075, 0.05, Math.sin(a) * 0.075], [Math.cos(a) * 0.075, 0.31, Math.sin(a) * 0.075], 4); }
    M.add(g, M.cone(0.11, 0.08, 8), dk, 0, 0.35, 0);
    M.add(g, torus(0.06, 0.008, 4, 10, PI), brass, 0, 0.39, 0);
    cv(g, brass, 0.02, 0.02, 0.04, 0, 0.05, 0, 6);
  },
  post(out) {
    const glass = M.add(out, M.cyl(0.068, 0.068, 0.25, 8), M.basic('#ffd27a', { transparent: true, opacity: 0.65 }), 0, 0.18, 0, { cast: false });
    const flame = M.add(out, M.cone(0.025, 0.07, 5), ADD('#ffb040'), 0, 0.14, 0, { cast: false });
    out.userData.light = V3(0, 0.2, 0);
    out.userData.setLit = on => { glass.material = on ? M.basic('#ffd27a', { transparent: true, opacity: 0.65 }) : M.mat('#4a5258', { transparent: true, opacity: 0.5 }); flame.visible = !!on; };
    out.userData.setLit(true);
  },
};
DEP.quarry = {
  base(g) {
    const yl = T('#c9a032', 'metal', true), dk = C('#2c2e33', true), md = S('metal_dark', true), red = T('#a8402e', 'metal'), haz = S('hazard'), rock = S('rock');
    for (const s of [-1, 1]) bb(g, dk, 2.4, 0.16, 0.2, 0, 0, s * 1.0);
    for (const x of [-1.1, 0, 1.1]) bb(g, dk, 0.16, 0.14, 2.1, x, 0.02, 0);
    for (const s of [-1, 1]) bb(g, haz, 0.06, 0.16, 0.22, s * 1.21, 0, 1.0, { ts: 0.5 });
    wbb(g, yl, 1.0, 0.8, 0.9, -0.6, 0.16, -0.5, 1.2);
    bx(g, C('#1c1d20'), 0.02, 0.5, 0.6, -0.09, 0.56, -0.5);
    for (let i = 0; i < 5; i++) bx(g, md, 0.025, 0.04, 0.58, -0.08, 0.36 + i * 0.1, -0.5);
    cv(g, md, 0.05, 0.05, 0.7, -0.9, 0.96, -0.7, 6); cv(g, dk, 0.08, 0.08, 0.06, -0.9, 1.64, -0.7, 6);
    cxl(g, red, 0.2, 0.8, -0.6, 0.48, 0.55, 10);
    for (const x of [-0.9, -0.3]) bb(g, dk, 0.08, 0.2, 0.42, x, 0.16, 0.55);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) beam(g, yl, 0.1, 0.1, [0.5 + sx * 0.5, 0.16, sz * 0.55], [0.5, 2.5, 0]);
    bb(g, yl, 0.36, 0.2, 0.36, 0.5, 2.42, 0);
    czl(g, md, 0.16, 0.12, 0.5, 2.5, 0.2, 10);
    bb(g, md, 0.6, 0.35, 0.6, 1.0, 0.16, 0.85);
    for (let i = 0; i < 6; i++) M.add(g, M.ico(0.09, 0), rock, 0.85 + (i % 3) * 0.13, 0.55, 0.72 + Math.floor(i / 3) * 0.2, { ry: i });
    bx(g, md, 0.5, 0.04, 0.3, 0.85, 0.75, 0.5, { rx: 0.5 });
  },
  post(out) {
    const drill = G(); drill.name = 'drill';
    drill.add(cached('dep:quarry:drill', g => {
      const steel = C('#8a8f94', true), dk = C('#2c2e33', true);
      cv(g, steel, 0.06, 0.06, 2.4, 0, -0.4, 0, 8);
      cv(g, dk, 0.16, 0.16, 0.12, 0, 1.6, 0, 10);
      M.add(g, M.cone(0.12, 0.25, 8), dk, 0, -0.5, 0, { rx: PI });
    }));
    drill.position.set(0.5, 0, 0);
    out.add(drill);
    out.userData.drill = drill;
    out.userData.tick = t => { drill.position.y = Math.sin(t * 4) * 0.08; drill.rotation.y = t * 6; };
  },
};
DEP.repair_bench = {
  base(g) {
    const blue = T('#3a5f8f', 'metal'), top = S('metal_dark'), dk = C('#22252a'), steel = C('#a8adb2'), gear = C('#5a5e64', true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, blue, 0.08, 0.86, 0.08, sx * 0.34, 0, sz * 0.74);
    wbb(g, top, 0.8, 0.08, 1.6, 0, 0.86, 0, 1);
    wbb(g, blue, 0.7, 0.5, 0.6, 0, 0.12, 0.42, 1);
    bb(g, S('metal_dark'), 0.7, 0.04, 1.5, 0, 0.14, 0);
    czl(g, C('#8a8478'), 0.16, 0.05, 0.05, 1.1, -0.45, 14); bb(g, dk, 0.12, 0.12, 0.18, 0.05, 0.94, -0.6);
    bb(g, dk, 0.16, 0.12, 0.2, 0.25, 0.94, 0.55); bb(g, steel, 0.04, 0.06, 0.24, 0.33, 1.02, 0.55);
    cxl(g, gear, 0.3, 0.05, -0.36, 1.22, 0, 12);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; bx(g, gear, 0.05, 0.1, 0.1, -0.36, 1.22 + Math.cos(a) * 0.32, Math.sin(a) * 0.32, { rx: -a }); }
    cxl(g, dk, 0.1, 0.07, -0.34, 1.22, 0, 8);
    bb(g, blue, 0.05, 0.4, 0.05, -0.36, 0.9, 0);
  },
};
DEP.rug = {
  base(g) {
    bb(g, T('#6e2f26', 'cloth'), 2.0, 0.012, 1.4, 0, 0, 0);
    bb(g, T('#c9a85a', 'cloth'), 1.8, 0.014, 1.2, 0, 0, 0);
    bb(g, T('#8a3a2c', 'cloth'), 1.66, 0.016, 1.06, 0, 0, 0);
    bb(g, T('#e2d6b0', 'cloth'), 0.5, 0.018, 0.5, 0, 0, 0, { ry: PI / 4 });
    bb(g, T('#2f3d5a', 'cloth'), 0.3, 0.02, 0.3, 0, 0, 0, { ry: PI / 4 });
    for (const s of [-1, 1]) bb(g, T('#e2d6b0', 'cloth'), 0.06, 0.008, 1.3, s * 1.03, 0, 0);
  },
};
DEP.stash = {
  base(g) {
    M.add(g, M.sphere(0.3, 8, 4), T('#6a5640', 'dirt'), 0, 0, 0, { sy: 0.3 });
    bb(g, T('#8a6a44', 'plank'), 0.28, 0.03, 0.28, 0.02, 0.07, 0.0, { ry: 0.3 });
    bb(g, C('#5a4630'), 0.04, 0.02, 0.12, 0.02, 0.1, 0.0, { ry: 0.3 });
  },
};

// ============================================================================
// HOMESTEAD — electricity (generator, solar panel, wind turbine, battery,
// switch, splitter, timer, motion sensor, ceiling light, electric furnace,
// door controller), farming (small planter + crops) and the cooking pot.
// Sockets and the indicator lamp of every powered item are added by power.js
// at data_homestead.js POWER[type].ports. Hooks: setLit(bool), rotor (wind
// turbine, spun by power.js), setOn(bool) (switch lever), setCharge(0..1)
// (battery gauge), setMount(hanging) (ceiling light), setDial(night) (timer),
// steam (cook pot: local point for the steam puffs).
// ============================================================================
Object.assign(DEPLOY_INFO, {
  generator: { w: 1.1, d: 0.7, h: 0.9, solid: true },
  solar_panel: { w: 1.2, d: 1.0, h: 1.2, solid: true },
  wind_turbine: { w: 0.8, d: 0.8, h: 6.6, solid: true, r: 0.32 },
  battery: { w: 0.8, d: 0.5, h: 0.75, solid: true },
  switch: { w: 0.3, d: 0.3, h: 1.1, solid: false, r: 0.15 },
  splitter: { w: 0.3, d: 0.35, h: 0.95, solid: false, r: 0.15 },
  timer: { w: 0.3, d: 0.3, h: 1.1, solid: false, r: 0.15 },
  motion_sensor: { w: 0.3, d: 0.3, h: 1.35, solid: false, r: 0.15 },
  ceiling_light: { w: 0.5, d: 0.5, h: 2.6, solid: false, r: 0.2 },
  electric_furnace: { w: 0.9, d: 0.9, h: 1.5, solid: true },
  door_controller: { w: 0.3, d: 0.3, h: 1.1, solid: false, r: 0.15 },
  planter_small: { w: 1.1, d: 1.1, h: 0.5, solid: true },
  cook_pot: { w: 1.1, d: 1.1, h: 1.35, solid: false, r: 0.55 },
});
// a slim steel post with a foot plate (switches, timers, sensors)
function elecPost(g, h, col = '#3a3d42') {
  cv(g, C('#2c2e33'), 0.09, 0.1, 0.03, 0, 0, 0, 8);
  cv(g, C(col), 0.024, 0.03, h, 0, 0.03, 0, 8);
}
DEP.generator = {
  base(g) {
    const fr = C('#2c2e33'), body = T('#d6a032', 'metal'), dk = C('#3a3d42'), tank = T('#b8402e', 'metal'), steel = C('#a8adb2'), rub = C('#1c1d20');
    for (const s of [-1, 1]) for (const y of [0.06, 0.84]) cxl(g, fr, 0.028, 1.06, 0, y, s * 0.3, 6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cv(g, fr, 0.028, 0.028, 0.8, sx * 0.51, 0.05, sz * 0.3, 6);
    for (const sx of [-1, 1]) czl(g, fr, 0.028, 0.62, sx * 0.51, 0.84, 0, 6);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, rub, 0.1, 0.05, 0.1, sx * 0.45, 0, sz * 0.3);
    // engine block with cooling fins, alternator drum
    bb(g, dk, 0.44, 0.38, 0.44, -0.2, 0.1, 0);
    for (let i = 0; i < 5; i++) bb(g, C('#4d5056'), 0.48, 0.02, 0.48, -0.2, 0.16 + i * 0.065, 0);
    cxl(g, body, 0.17, 0.42, 0.2, 0.3, 0, 12);
    cxl(g, dk, 0.12, 0.04, 0.42, 0.3, 0, 12);
    // fuel tank + cap, with a stripe
    bb(g, tank, 0.74, 0.2, 0.46, -0.04, 0.6, 0);
    bb(g, T('#e8e0c8', 'metal'), 0.3, 0.012, 0.47, 0.12, 0.7, 0);
    cv(g, steel, 0.05, 0.05, 0.05, -0.28, 0.8, 0.12, 8);
    // control panel on the front (+X), pull starter, muffler at the back
    bb(g, C('#26282c'), 0.05, 0.3, 0.46, 0.5, 0.14, 0);
    bb(g, T('#d6a032', 'metal'), 0.012, 0.06, 0.2, 0.53, 0.36, 0.0);
    czl(g, C('#d8402e'), 0.09, 0.05, -0.2, 0.36, 0.25, 10);
    cxl(g, steel, 0.07, 0.24, -0.52, 0.5, -0.15, 8);
    rod(g, steel, 0.02, [-0.4, 0.5, -0.15], [-0.3, 0.42, -0.12], 5);
  },
};
DEP.solar_panel = {
  base(g) {
    const al = C('#b8bcc2'), back = C('#3a3d42'), dk = C('#2c2e33');
    // legs: short at the front (+X), tall at the back
    for (const sz of [-1, 1]) { cv(g, al, 0.025, 0.03, 0.62, 0.42, 0, sz * 0.4, 6); cv(g, al, 0.025, 0.03, 1.12, -0.42, 0, sz * 0.4, 6); beam(g, al, 0.03, 0.03, [0.42, 0.1, sz * 0.4], [-0.42, 0.7, sz * 0.4]); }
    czl(g, al, 0.02, 0.84, -0.42, 0.25, 0, 6);
    // tilted panel facing +X: frame, backing, 3 x 4 cells with bus lines
    const pg = G(); pg.position.set(0, 0.86, 0); pg.rotation.z = -0.55; g.add(pg);
    bx(pg, al, 1.16, 0.05, 0.98, 0, 0, 0);
    bx(pg, back, 1.1, 0.02, 0.92, 0, -0.03, 0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) bx(pg, C((i + j) % 2 ? '#2b4f8f' : '#2f5698'), 0.34, 0.012, 0.21, -0.37 + i * 0.37, 0.03, -0.345 + j * 0.23);
    for (let j = 0; j < 4; j++) bx(pg, C('#7fa4d8'), 1.08, 0.004, 0.012, 0, 0.037, -0.345 + j * 0.23);
    // junction box on its own little post
    cv(g, dk, 0.025, 0.025, 0.28, -0.18, 0, 0.05, 6);
    bx(g, C('#e8e4dc'), 0.12, 0.16, 0.24, -0.18, 0.36, 0.05);
  },
};
DEP.wind_turbine = {
  base(g) {
    const wh = C('#e8e8e4'), steel = C('#b8bcc2'), dk = C('#3a3d42');
    cv(g, dk, 0.3, 0.32, 0.06, 0, 0, 0, 10);
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + PI / 4; bx(g, dk, 0.06, 0.04, 0.06, Math.cos(a) * 0.24, 0.07, Math.sin(a) * 0.24); }
    cv(g, wh, 0.055, 0.1, 5.66, 0, 0.06, 0, 10);
    bx(g, C('#e8e4dc'), 0.1, 0.24, 0.2, 0.14, 0.58, 0);
    // nacelle, nose, tail boom + fin
    cv(g, wh, 0.1, 0.1, 0.1, 0, 5.62, 0, 10);
    cxl(g, wh, 0.12, 0.6, 0.02, 5.78, 0, 10);
    M.add(g, M.cone(0.12, 0.16, 10), wh, 0.4, 5.78, 0, { rz: -PI / 2 });
    rod(g, steel, 0.025, [-0.25, 5.78, 0], [-0.95, 5.84, 0], 6);
    bx(g, T('#d8402e', 'metal'), 0.5, 0.42, 0.02, -1.05, 5.9, 0);
  },
  post(out) {
    const rotor = G(); rotor.position.set(0.46, 5.78, 0); rotor.name = 'rotor';
    rotor.add(cached('dep:wind_turbine:rotor', g => {
      const bl = C('#f2f2ee'), hub = C('#c8ccd2');
      M.add(g, M.sphere(0.09, 10, 6), hub, 0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const bg = G(); bg.rotation.x = i / 3 * TAU; g.add(bg);
        bx(bg, bl, 0.035, 1.35, 0.15, 0.02, 0.78, 0.02, { rx: 0.18 });
        bx(bg, bl, 0.03, 0.4, 0.1, 0.02, 1.5, 0.03, { rx: 0.18 });
      }
    }));
    out.add(rotor); out.userData.rotor = rotor;
  },
};
DEP.battery = {
  base(g) {
    const body = T('#3a3d42', 'metal'), top = C('#4d5056'), haz = S('hazard'), dk = C('#1c1d20');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, dk, 0.08, 0.04, 0.08, sx * 0.33, 0, sz * 0.18);
    bb(g, body, 0.8, 0.6, 0.5, 0, 0.04, 0);
    bb(g, top, 0.82, 0.06, 0.52, 0, 0.62, 0);
    bb(g, haz, 0.012, 0.08, 0.5, 0.404, 0.08, 0, { ts: 0.6 });
    for (const [x, c] of [[0.25, '#c83a2a'], [-0.25, '#2a2a2e']]) { cv(g, C('#b8bcc2'), 0.05, 0.05, 0.06, x, 0.68, 0, 8); cv(g, C(c), 0.035, 0.035, 0.03, x, 0.74, 0, 8); }
    bb(g, C('#1c1d20'), 0.012, 0.32, 0.18, 0.402, 0.27, -0.02);
    bx(g, C('#e8e0c8'), 0.012, 0.06, 0.14, 0.404, 0.2, 0.16); // label
  },
  post(out) {
    const bars = [], off = C('#2a2c30'), on = GL('#86e64a'), lo = GL('#ffc928');
    for (let i = 0; i < 5; i++) bars.push(M.add(out, M.box(0.012, 0.045, 0.14), off, 0.41, 0.31 + i * 0.058, -0.02, { cast: false }));
    out.userData.setCharge = k => { const n = Math.round(Math.max(0, Math.min(1, k)) * 5); bars.forEach((b, i) => { b.material = i < n ? (n <= 1 ? lo : on) : off; }); };
    out.userData.setCharge(0);
  },
};
DEP.switch = {
  base(g) {
    elecPost(g, 0.7);
    bb(g, T('#c9a032', 'metal'), 0.14, 0.3, 0.26, 0, 0.72, 0);
    bb(g, C('#2c2e33'), 0.02, 0.22, 0.12, 0.075, 0.76, 0);
    bx(g, C('#e8e0c8'), 0.012, 0.04, 0.16, 0.074, 0.99, -0.02);
  },
  post(out) {
    const lever = G(); lever.position.set(0.085, 0.87, 0); lever.name = 'lever';
    M.add(lever, M.box(0.03, 0.03, 0.06), C('#2c2e33'), 0, 0, 0);
    const arm = G(); lever.add(arm);
    M.add(arm, M.cyl(0.012, 0.012, 0.14, 6), C('#b8bcc2'), 0.07, 0, 0, { rz: PI / 2 });
    M.add(arm, M.sphere(0.028, 8, 6), C('#d8402e'), 0.14, 0, 0);
    out.add(lever); out.userData.lever = arm;
    out.userData.setOn = on => { arm.rotation.z = on ? 0.75 : -0.75; };
    out.userData.setOn(false);
  },
};
DEP.splitter = {
  base(g) {
    elecPost(g, 0.6);
    bb(g, C('#4a4c52'), 0.16, 0.34, 0.34, 0, 0.6, 0);
    bb(g, C('#6a6e74'), 0.17, 0.04, 0.35, 0, 0.92, 0);
    bx(g, T('#d6a032', 'metal'), 0.012, 0.04, 0.3, 0.084, 0.77, 0);
  },
};
DEP.timer = {
  base(g) {
    elecPost(g, 0.66);
    bb(g, C('#e8e4dc'), 0.14, 0.3, 0.26, 0, 0.68, 0);
    cxl(g, C('#3a3d42'), 0.1, 0.015, 0.075, 0.84, 0, 14);
  },
  post(out) {
    // sun half up = passes power by day, moon half up = at night
    const dial = G(); dial.position.set(0.085, 0.84, 0); dial.name = 'dial';
    M.add(dial, M.cyl(0.085, 0.085, 0.012, 14, 1), GL('#ffd23a'), 0, 0, 0, { rz: PI / 2 });
    M.add(dial, M.box(0.016, 0.085, 0.17), GL('#2a3a7a'), 0.002, -0.043, 0);
    M.add(dial, M.sphere(0.022, 6, 4), GL('#e8ecff'), 0.008, -0.045, 0.03);
    out.add(dial);
    out.userData.setDial = isNight => { dial.rotation.x = isNight ? PI : 0; };
  },
};
DEP.motion_sensor = {
  base(g) {
    elecPost(g, 1.12);
    bb(g, C('#3a3d42'), 0.12, 0.16, 0.2, 0, 0.78, 0);
    bb(g, C('#e8e4dc'), 0.12, 0.12, 0.16, 0, 1.14, 0);
    M.add(g, M.sphere(0.07, 10, 6), C('#c8d0d8'), 0.06, 1.2, 0, { sx: 0.85 });
    bx(g, C('#2c2e33'), 0.04, 0.02, 0.14, 0.04, 1.27, 0);
  },
};
DEP.ceiling_light = {
  base(g) {
    const steel = C('#b8bcc2'), dk = C('#3a3d42');
    cv(g, steel, 0.09, 0.09, 0.03, 0, 2.57, 0, 10);
    bb(g, dk, 0.14, 0.06, 0.2, 0, 2.5, 0);
    rod(g, C('#1c1d20'), 0.008, [0, 2.5, 0], [0, 2.26, 0], 4);
    cv(g, dk, 0.03, 0.03, 0.04, 0, 2.23, 0, 8);
    M.add(g, openFrustum(0.06, 0.22, 0.16, 12), DS('#2f4a3c'), 0, 2.16, 0);
    cv(g, C('#2f4a3c'), 0.065, 0.065, 0.02, 0, 2.23, 0, 12);
  },
  post(out) {
    const bulb = M.add(out, M.sphere(0.06, 10, 6), C('#6a6a60'), 0, 2.12, 0, { cast: false });
    const pole = G(); pole.add(cached('dep:ceiling_light:pole', g => {
      cv(g, C('#2c2e33'), 0.16, 0.18, 0.04, 0, 0, 0, 10);
      cv(g, C('#5a5e64'), 0.025, 0.03, 2.47, 0, 0.04, 0, 8);
    }));
    out.add(pole);
    out.userData.light = V3(0, 2.1, 0);
    out.userData.setLit = on => { bulb.material = on ? GL('#fff3cf') : C('#6a6a60'); };
    out.userData.setMount = hanging => { pole.visible = !hanging; };
  },
};
DEP.electric_furnace = {
  base(g) {
    const body = T('#8a9099', 'metal'), dk = C('#2c2e33'), trim = C('#5a5e64');
    bb(g, dk, 0.9, 0.08, 0.9, 0, 0, 0);
    bb(g, body, 0.86, 1.2, 0.86, 0, 0.08, 0);
    bb(g, trim, 0.88, 0.05, 0.88, 0, 1.28, 0);
    bb(g, dk, 0.4, 0.16, 0.4, -0.1, 1.33, 0);
    bb(g, C('#1c1d20'), 0.03, 0.46, 0.6, 0.43, 0.32, 0);
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) bx(g, dk, 0.5, 0.025, 0.012, -0.05, 0.4 + i * 0.12, s * 0.432);
    bb(g, C('#26282c'), 0.03, 0.18, 0.3, 0.44, 0.98, -0.12);
    for (const z of [-0.2, -0.04]) cxl(g, C('#d8402e'), 0.03, 0.04, 0.465, 1.07, z, 8);
    bx(g, T('#d6a032', 'metal'), 0.012, 0.05, 0.5, 0.435, 1.22, 0); // hazard band
  },
  post(out) {
    const win = M.add(out, M.box(0.02, 0.36, 0.5), C('#3a2a24'), 0.445, 0.55, 0, { cast: false });
    const coil = G(); for (let i = 0; i < 4; i++) M.add(coil, M.box(0.012, 0.025, 0.42), GL('#ffd27a'), 0.457, 0.42 + i * 0.085, 0, { cast: false }); out.add(coil);
    out.userData.light = V3(0.6, 0.55, 0);
    out.userData.setLit = on => { win.material = on ? GL('#ff7a2a') : C('#3a2a24'); coil.visible = !!on; };
    out.userData.setLit(false);
  },
};
DEP.door_controller = {
  base(g) {
    elecPost(g, 0.64);
    bb(g, C('#5a6a7a'), 0.14, 0.3, 0.26, 0, 0.66, 0);
    cv(g, C('#b8bcc2'), 0.035, 0.035, 0.14, 0, 0.96, 0.04, 8);
    cv(g, C('#e8e8e4'), 0.015, 0.015, 0.1, 0, 1.1, 0.04, 6);
    bx(g, C('#c9a032'), 0.012, 0.05, 0.2, 0.074, 0.84, 0);
    bx(g, C('#1c1d20'), 0.012, 0.03, 0.03, 0.074, 0.78, -0.06);
  },
};
DEP.planter_small = {
  base(g) {
    const pl = S('plank'), dk = C('#5b3e26'), soil = T('#5a4630', 'dirt');
    for (const s of [-1, 1]) { wbb(g, pl, 1.1, 0.44, 0.07, 0, 0.02, s * 0.515, 2); wbb(g, pl, 0.07, 0.44, 0.96, s * 0.515, 0.02, 0, 2); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, dk, 0.1, 0.5, 0.1, sx * 0.515, 0, sz * 0.515);
    bb(g, soil, 0.98, 0.38, 0.98, 0, 0.02, 0);
    M.add(g, M.sphere(0.24, 8, 4), soil, 0, 0.4, 0, { sy: 0.22 });
  },
};
DEP.cook_pot = {
  base(g) {
    const rock = S('rock'), logM = S('log'), ash = C('#2c2824'), iron = C('#232428');
    cv(g, ash, 0.36, 0.4, 0.04, 0, 0, 0, 10);
    const R = rng(11);
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; M.add(g, M.ico(0.11, 0), rock, Math.cos(a) * 0.42, 0.05, Math.sin(a) * 0.42, { sx: 1.1, sy: 0.75, sz: 1.3, ry: a + R() }); }
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.4; rod(g, logM, 0.045, [Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3], [Math.cos(a) * 0.04, 0.22, Math.sin(a) * 0.04], 6); }
    // tripod, chain and the pot
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + PI / 6; rod(g, logM, 0.03, [Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], [0, 1.32, 0], 6); }
    M.add(g, torus(0.05, 0.015, 4, 10), C('#5a4a3a'), 0, 1.24, 0, { rx: PI / 2 });
    rod(g, iron, 0.01, [0, 1.24, 0], [0, 0.84, 0], 4);
    M.add(g, torus(0.2, 0.012, 4, 14, PI), iron, 0, 0.78, 0);
    cv(g, iron, 0.22, 0.16, 0.3, 0, 0.48, 0, 14);
    M.add(g, M.sphere(0.16, 12, 6), iron, 0, 0.5, 0, { sy: 0.55 });
    M.add(g, torus(0.22, 0.025, 5, 16), C('#34353a'), 0, 0.78, 0, { rx: PI / 2 });
    cv(g, C('#6a4a2a'), 0.2, 0.2, 0.01, 0, 0.74, 0, 14);
  },
  post(out) {
    const f = G(); f.name = 'flame';
    const add = (geo, m, x, y, z, o) => M.add(f, geo, m, x, y, z, Object.assign({ cast: false, recv: false }, o));
    add(M.cone(0.16, 0.36, 6), ADD('#ff6a1a'), 0, 0.2, 0);
    add(M.cone(0.1, 0.28, 6), ADD('#ffc04a'), 0.02, 0.16, 0.02);
    add(M.cone(0.08, 0.24, 5), ADD('#ff8a2a'), -0.07, 0.14, 0.05, { rz: 0.35 });
    add(M.cyl(0.24, 0.26, 0.02, 10), GL('#ff4a10'), 0, 0.045, 0);
    out.add(f);
    out.userData.flame = f; out.userData.steam = V3(0, 0.85, 0);
    out.userData.light = V3(0, 0.4, 0);
    out.userData.setLit = on => { f.visible = !!on; };
    out.userData.tick = t => { const k = 1 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.06; f.scale.set(1, k, 1); f.rotation.y = t * 0.7; };
    out.userData.setLit(false);
  },
};

// ---------------------------------------------------------------- crops
// makeCrop(crop, stage): a plant standing on the soil at y = 0. Stages: 0 seed
// mound, 1 sprout, 2 young, 3 flowering, 4 ripe (with its produce). Cached + baked.
function cropLeaf(g, m, x, y, z, len, wid, yaw, tilt) {
  const dx = Math.cos(tilt) * Math.cos(yaw), dy = Math.sin(tilt), dz = -Math.cos(tilt) * Math.sin(yaw);
  return M.add(g, M.box(len, 0.018, wid), m, x + dx * len / 2, y + dy * len / 2, z + dz * len / 2, { ry: yaw, rz: tilt });
}
function cropFan(g, m, x, y, z, n, len, wid, yaw0, tilt) { for (let i = 0; i < n; i++) cropLeaf(g, m, x, y, z, len, wid, yaw0 + i / n * TAU, tilt); }
const CROP = {
  hemp(g, s, L) {
    const h = [0, 0.1, 0.36, 0.78, 0.86][s];
    rod(g, L.stem, 0.016, [0, 0, 0], [0, h, 0], 5);
    const levels = s === 2 ? [0.16, 0.3] : [0.22, 0.42, 0.6, 0.76];
    levels.forEach((y, i) => { if (y > h) return; const k = 1 - i * 0.12; for (let j = 0; j < 2; j++) cropFan(g, s === 4 && i < 2 ? L.yellow : L.leaf, 0, y, 0, 5, 0.2 * k, 0.035, j * PI + i * 0.9, 0.35 - i * 0.08); });
    if (s === 4) for (const [x, y, z] of [[0, 0.88, 0], [0.05, 0.8, 0.03], [-0.04, 0.72, -0.03], [0.03, 0.64, -0.05]]) M.add(g, M.ico(0.045, 0), L.bud, x, y, z, { sy: 1.6 });
    if (s === 3) M.add(g, M.ico(0.035, 0), L.leafL, 0, h + 0.02, 0, { sy: 1.6 });
  },
  berry(g, s, L) {
    const r = [0, 0, 0.13, 0.2, 0.22][s];
    rod(g, L.stem, 0.02, [0, 0, 0], [0, r * 1.1, 0], 5);
    for (const [x, y, z, k] of [[0, 1, 0, 1], [0.6, 0.75, 0.3, 0.8], [-0.55, 0.8, -0.35, 0.8], [0.2, 0.7, -0.65, 0.75], [-0.3, 0.7, 0.62, 0.75]]) M.add(g, M.ico(r * k, 0), (x + z) > 0 ? L.leaf : L.leafD, x * r, y * r * 1.1, z * r, { ry: x * 3 });
    if (s === 3) for (const [x, y, z] of [[0.7, 1.2, 0.2], [-0.5, 1.4, -0.4], [0.1, 1.6, 0.6], [-0.7, 1.0, 0.5], [0.5, 1.0, -0.7]]) M.add(g, M.sphere(0.022, 5, 4), L.flower, x * r, y * r, z * r);
    if (s === 4) for (let i = 0; i < 14; i++) { // clusters on the outside of the bush
      const a = i * 2.4, el = 0.15 + (i % 5) * 0.17, dx = Math.cos(a) * Math.cos(el), dz = Math.sin(a) * Math.cos(el), dy = Math.sin(el);
      const x = dx * r * 1.02, y = r * 1.1 + dy * r * 1.02, z = dz * r * 1.02;
      M.add(g, M.sphere(0.036, 6, 4), L.berry, x, y, z); M.add(g, M.sphere(0.028, 5, 4), L.berryD, x + dz * 0.04, y - 0.03, z - dx * 0.04);
    }
  },
  corn(g, s, L) {
    const h = [0, 0.1, 0.45, 1.15, 1.28][s];
    cv(g, L.stem, 0.022, 0.034, h, 0, 0, 0, 6);
    const n = s === 2 ? 4 : 7;
    for (let i = 0; i < n; i++) { const y = 0.08 + i * (h * 0.78) / n; cropLeaf(g, s === 4 && i < 3 ? L.yellow : i % 2 ? L.leaf : L.leafD, 0, y, 0, 0.36 + (i < n - 2 ? 0.14 : -0.05), 0.065, i * 2.4, 0.5 - i * 0.03); }
    if (s >= 3) for (let i = 0; i < 6; i++) rod(g, L.tassel, 0.008, [0, h, 0], [Math.cos(i * 1.05) * 0.1, h + 0.14, Math.sin(i * 1.05) * 0.1], 3);
    if (s === 4) for (const [a, y] of [[0.6, 0.5], [3.4, 0.68], [1.9, 0.82]]) { // cobs leaning out of the stalk
      const ux = Math.cos(a) * 0.5, uz = -Math.sin(a) * 0.5, cx = ux * 0.08, cz = uz * 0.08;
      rodT(g, L.cob, 0.055, 0.035, [cx, y, cz], [cx + ux * 0.22, y + 0.24, cz + uz * 0.22], 8);
      rodT(g, L.husk, 0.06, 0.015, [cx, y - 0.03, cz], [cx + ux * 0.12, y + 0.12, cz + uz * 0.12], 6);
      rod(g, L.tassel, 0.006, [cx + ux * 0.22, y + 0.24, cz + uz * 0.22], [cx + ux * 0.3, y + 0.33, cz + uz * 0.3], 3);
    }
  },
  potato(g, s, L) {
    const r = [0, 0, 0.16, 0.24, 0.24][s];
    for (let i = 0; i < 7; i++) cropLeaf(g, s === 4 ? (i % 2 ? L.yellow : L.leafY) : i % 2 ? L.leaf : L.leafD, 0, 0.02, 0, r, 0.07, i / 7 * TAU, s === 4 ? 0.25 : 0.7 - (i % 3) * 0.12);
    M.add(g, M.ico(r * 0.4, 0), s === 4 ? L.leafY : L.leaf, 0, r * 0.55, 0);
    if (s === 3) for (let i = 0; i < 4; i++) M.add(g, M.sphere(0.022, 5, 4), i % 2 ? L.flower : L.flowerP, Math.cos(i * 1.6) * r * 0.45, r * 0.75, Math.sin(i * 1.6) * r * 0.45);
    if (s === 4) for (const [x, z, k] of [[0.12, 0.05, 1], [-0.1, 0.1, 0.8], [0.02, -0.14, 0.9]]) M.add(g, M.sphere(0.055 * k, 7, 5), L.potato, x, 0.025, z, { sx: 1.3, sy: 0.8 });
  },
  pumpkin(g, s, L) {
    const r = [0, 0, 0.13, 0.2, 0.24][s];
    rod(g, L.stem, 0.014, [0, 0, 0], [r * 1.2, 0.05, -r * 0.3], 4);
    for (const [x, z, k] of [[0, 0, 1], [r * 1.1, -r * 0.4, 0.85], [-r * 0.6, r * 0.8, 0.8], [r * 0.3, r * 1.0, 0.7]]) M.add(g, M.sphere(r * 0.55 * k, 7, 4), x > 0 ? L.leaf : L.leafD, x, r * 0.32 * k, z, { sy: 0.35 });
    if (s === 3) { M.add(g, M.cone(0.04, 0.07, 5), L.flowerY, r * 0.4, r * 0.55, -r * 0.3, { rz: PI }); M.add(g, M.sphere(0.05, 7, 5), L.leafD, -r * 0.9, 0.05, -r * 0.5); }
    if (s === 4) {
      const px = -0.12, pz = -0.08;
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; M.add(g, M.sphere(0.13, 8, 6), i % 2 ? L.pumpkin : L.pumpkinD, px + Math.cos(a) * 0.07, 0.13, pz + Math.sin(a) * 0.07, { sx: 0.75, sz: 0.75 }); }
      cv(g, L.stem, 0.015, 0.022, 0.07, px, 0.24, pz, 5);
    }
  },
};
function cropMats() {
  return {
    stem: C('#5e8a34'), leaf: C('#4f8a2e'), leafD: C('#3e6e26'), leafL: C('#7ab040'), leafY: C('#8a9a3a'), yellow: C('#b8a83a'),
    bud: C('#c8d86a'), flower: C('#f4f0e8'), flowerP: C('#b89ad8'), flowerY: C('#f2c838'), berry: C('#e0304a'), berryD: C('#a81e3a'), tassel: C('#d8c070'),
    cob: C('#f2c838'), husk: C('#8ab04a'), potato: C('#b08a5a'), pumpkin: C('#e8862a'), pumpkinD: C('#d0701c'), dirt: T('#4a3826', 'dirt'),
  };
}
export function makeCrop(crop, stage) {
  stage = Math.max(0, Math.min(4, stage | 0));
  return cached('crop:' + crop + ':' + stage, g => {
    const L = cropMats();
    M.add(g, M.sphere(0.1, 7, 3), L.dirt, 0, 0, 0, { sy: 0.3 });
    if (stage === 0) { M.add(g, M.sphere(0.018, 4, 3), C('#c8b080'), 0.02, 0.03, 0.01); return; }
    if (stage === 1) { rod(g, L.stem, 0.008, [0, 0, 0], [0, 0.08, 0], 4); cropLeaf(g, L.leafL, 0, 0.07, 0, 0.06, 0.035, 0.3, 0.4); cropLeaf(g, L.leafL, 0, 0.07, 0, 0.06, 0.035, 0.3 + PI, 0.4); return; }
    (CROP[crop] || CROP.hemp)(g, stage, L);
  });
}

// ============================================================================
// CONTAINERS — lootable world containers. CONTAINER_INFO w = X, d = Z, h.
// Lids: userData.lid (hinge at the back -Z edge; setOpen(k) opens it).
// ============================================================================
export const CONTAINER_INFO = {
  barrel: { w: 0.7, d: 0.7, h: 0.9, r: 0.35 },
  barrel_oil: { w: 0.7, d: 0.7, h: 0.9, r: 0.35 },
  crate: { w: 1.0, d: 0.7, h: 0.72 },
  toolbox: { w: 0.7, d: 0.36, h: 0.42 },
  medbox: { w: 0.7, d: 0.45, h: 0.42 },
  ammobox: { w: 0.6, d: 0.32, h: 0.4 },
  military: { w: 1.5, d: 0.7, h: 0.6 },
  elite: { w: 1.3, d: 0.8, h: 0.8 },
  food: { w: 0.8, d: 0.6, h: 0.5 },
  cache: { w: 1.0, d: 1.0, h: 0.35 },
  locker: { w: 0.5, d: 0.6, h: 1.9 },
  fridge: { w: 0.7, d: 0.75, h: 1.7 },
  cabinet: { w: 0.6, d: 0.5, h: 1.3 },
};
const CON = {};
export function makeContainer(type) {
  const t = CON[type] ? type : 'crate';
  const D = CON[t];
  const out = cached('con:' + t, D.base);
  if (D.lid) addLid(out, 'con:' + t + ':lid', D.lid.hinge, 'x', -1.2, D.lid.build);
  out.userData.container = t;
  return out;
}
function drum(g, body, band, top, x = 0, z = 0) {
  cv(g, body, 0.34, 0.34, 0.88, x, 0, z, 14);
  for (const y of [0.27, 0.57]) cv(g, band, 0.352, 0.352, 0.04, x, y, z, 14);
  cv(g, top, 0.33, 0.33, 0.01, x, 0.88, z, 14);
  M.add(g, torus(0.33, 0.022, 4, 16), band, x, 0.885, z, { rx: PI / 2 });
  cv(g, band, 0.04, 0.04, 0.02, x + 0.17, 0.88, z + 0.1, 6); cv(g, band, 0.025, 0.025, 0.02, x - 0.18, 0.88, z - 0.08, 6);
}
CON.barrel = { base(g) { drum(g, S('blue_paint'), T('#2c4a70', 'metal'), T('#33557e', 'metal')); } };
CON.barrel_oil = {
  base(g) {
    drum(g, T('#a03a2a', 'metal'), C('#1e1e20'), C('#26262a'));
    cv(g, C('#1e1e20'), 0.342, 0.342, 0.16, 0, 0.7, 0, 14);
    bx(g, C('#e8d8a0'), 0.18, 0.12, 0.01, 0, 0.42, 0.343);
  },
};
CON.crate = {
  base(g) {
    const pl = T('#9c7a4c', 'plank'), dk = C('#5e4329');
    wbb(g, pl, 0.96, 0.6, 0.66, 0, 0.02, 0, 1.5);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, dk, 0.08, 0.62, 0.08, sx * 0.46, 0, sz * 0.31);
    for (const s of [-1, 1]) { bb(g, dk, 0.96, 0.08, 0.06, 0, 0, s * 0.32); beam(g, dk, 0.08, 0.03, [-0.4, 0.08, s * 0.34], [0.4, 0.56, s * 0.34]); }
    bx(g, C('#2a2620'), 0.26, 0.1, 0.004, 0.18, 0.4, 0.332); bx(g, C('#2a2620'), 0.12, 0.05, 0.004, -0.2, 0.2, 0.332);
  },
  lid: { hinge: [0, 0.62, -0.35], build(g) { bb(g, T('#a8875a', 'plank'), 1.0, 0.08, 0.72, 0, 0, 0.36, { ts: 1.5 }); for (const x of [-0.42, 0, 0.42]) bb(g, C('#5e4329'), 0.07, 0.085, 0.72, x, 0, 0.36); } },
};
CON.toolbox = {
  base(g) {
    bb(g, T('#b8402f', 'metal'), 0.68, 0.27, 0.34, 0, 0.02, 0, { ts: 1 });
    for (const s of [-1, 1]) bb(g, C('#2a2a2c'), 0.7, 0.03, 0.05, 0, 0, s * 0.14);
    for (const x of [-0.2, 0.2]) bx(g, C('#c8ccd0'), 0.06, 0.06, 0.02, x, 0.27, 0.175);
  },
  lid: {
    hinge: [0, 0.29, -0.17],
    build(g) {
      bb(g, T('#c04a36', 'metal'), 0.7, 0.08, 0.36, 0, 0, 0.18, { ts: 1 });
      for (const x of [-0.18, 0.18]) bb(g, C('#2a2a2c'), 0.03, 0.06, 0.03, x, 0.08, 0.18);
      cxl(g, C('#2a2a2c'), 0.018, 0.4, 0, 0.14, 0.18, 6);
    },
  },
};
CON.medbox = {
  base(g) {
    const wh = T('#e2ddd0', 'metal'), red = C('#c0302a');
    bb(g, wh, 0.68, 0.3, 0.43, 0, 0.02, 0, { ts: 1 });
    bb(g, C('#8a8d92'), 0.7, 0.03, 0.45, 0, 0, 0);
    bx(g, red, 0.18, 0.05, 0.01, 0, 0.18, 0.217); bx(g, red, 0.05, 0.18, 0.01, 0, 0.18, 0.217);
  },
  lid: {
    hinge: [0, 0.32, -0.215],
    build(g) {
      bb(g, T('#eae6da', 'metal'), 0.7, 0.1, 0.45, 0, 0, 0.225, { ts: 1 });
      bx(g, C('#c0302a'), 0.3, 0.012, 0.08, 0, 0.106, 0.225); bx(g, C('#c0302a'), 0.08, 0.012, 0.3, 0, 0.106, 0.225);
      bx(g, C('#8a8d92'), 0.08, 0.04, 0.02, 0, 0.03, 0.455);
    },
  },
};
CON.ammobox = {
  base(g) {
    bb(g, T('#5d6b3c', 'metal'), 0.58, 0.26, 0.3, 0, 0.02, 0, { ts: 1 });
    bb(g, C('#3f4a2a'), 0.6, 0.03, 0.32, 0, 0, 0);
    bx(g, C('#d0b040'), 0.3, 0.04, 0.005, -0.08, 0.16, 0.152);
  },
  lid: {
    hinge: [0, 0.28, -0.16],
    build(g) {
      bb(g, T('#667544', 'metal'), 0.6, 0.1, 0.32, 0, 0, 0.16, { ts: 1 });
      bb(g, C('#2f3622'), 0.24, 0.03, 0.05, 0, 0.1, 0.16);
      bx(g, C('#2f3622'), 0.05, 0.12, 0.03, 0.22, -0.02, 0.33);
    },
  },
};
CON.military = {
  base(g) {
    const ol = T('#56633a', 'plank'), od = C('#3c4628'), bk = C('#1e1f1c'), yl = C('#c9a032');
    wbb(g, ol, 1.46, 0.46, 0.66, 0, 0.04, 0, 1.5);
    for (const s of [-1, 1]) { bb(g, od, 0.1, 0.5, 0.7, s * 0.7, 0, 0); bx(g, C('#8a7650'), 0.03, 0.05, 0.22, s * 0.765, 0.32, 0); }
    bb(g, od, 1.3, 0.05, 0.7, 0, 0, 0);
    for (const x of [-0.45, 0, 0.45]) bx(g, bk, 0.08, 0.1, 0.03, x, 0.42, 0.34);
    bx(g, yl, 0.5, 0.06, 0.005, -0.2, 0.25, 0.332); bx(g, yl, 0.14, 0.06, 0.005, 0.32, 0.25, 0.332);
  },
  lid: {
    hinge: [0, 0.5, -0.35],
    build(g) {
      bb(g, T('#5d6b40', 'plank'), 1.5, 0.1, 0.7, 0, 0, 0.35, { ts: 1.5 });
      for (const x of [-0.6, 0.6]) bb(g, C('#c9a032'), 0.08, 0.104, 0.7, x, 0, 0.35);
      bx(g, C('#1e1f1c'), 0.4, 0.008, 0.18, -0.05, 0.104, 0.35);
    },
  },
};
CON.elite = {
  base(g) {
    const bd = T('#3a4250', 'metal'), dk = C('#1e2228'), yl = C('#d0a838');
    bb(g, dk, 1.3, 0.06, 0.8, 0, 0, 0);
    wbb(g, bd, 1.26, 0.56, 0.76, 0, 0.06, 0, 1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, yl, 0.07, 0.56, 0.07, sx * 0.63, 0.06, sz * 0.38);
    bx(g, dk, 0.5, 0.2, 0.01, 0, 0.36, 0.385);
    for (const x of [-0.12, 0.12]) bx(g, GL('#4ae0ff'), 0.06, 0.04, 0.01, x, 0.4, 0.392);
    bx(g, GL('#ffb02a'), 0.3, 0.025, 0.01, 0, 0.3, 0.392);
    for (const s of [-1, 1]) bx(g, C('#8a8d92'), 0.03, 0.08, 0.22, s * 0.645, 0.45, 0);
  },
  lid: {
    hinge: [0, 0.62, -0.4],
    build(g) {
      bb(g, T('#434c5c', 'metal'), 1.3, 0.16, 0.8, 0, 0, 0.4, { ts: 1 });
      for (const s of [-1, 1]) { bb(g, C('#d0a838'), 1.3, 0.04, 0.05, 0, 0.13, 0.4 + s * 0.375); bb(g, C('#d0a838'), 0.05, 0.04, 0.8, s * 0.625, 0.13, 0.4); }
      for (const x of [-0.3, 0, 0.3]) bb(g, C('#2a3038'), 0.08, 0.04, 0.6, x, 0.16, 0.4);
      bx(g, GL('#4ae0ff'), 0.5, 0.01, 0.03, 0, 0.205, 0.72);
    },
  },
};
CON.food = {
  base(g) {
    const pl = T('#b08a58', 'plank'), dk = C('#6e5034');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, dk, 0.05, 0.42, 0.05, sx * 0.375, 0, sz * 0.275);
    for (const y of [0.03, 0.18, 0.33]) for (const s of [-1, 1]) { bb(g, pl, 0.8, 0.09, 0.02, 0, y, s * 0.29); bb(g, pl, 0.02, 0.09, 0.6, s * 0.39, y, 0); }
    bb(g, pl, 0.76, 0.02, 0.56, 0, 0.02, 0);
    const cols = ['#c0402a', '#d07a35', '#8aa040', '#d8b040', '#b03a2a'], R = rng(31);
    for (let i = 0; i < 14; i++) M.add(g, M.sphere(0.075, 6, 4), C(cols[i % 5]), -0.28 + (i % 5) * 0.14 + (R() - 0.5) * 0.04, 0.36 + (R() * 0.06), -0.16 + Math.floor(i / 5) * 0.15 + (R() - 0.5) * 0.04);
    cv(g, C('#9aa0a6'), 0.05, 0.05, 0.12, 0.25, 0.38, 0.12, 8);
  },
};
CON.cache = {
  base(g) {
    const dirt = T('#6a5640', 'dirt'), pl = T('#8a6a44', 'plank'), rope = C('#8a7650'), rock = S('rock'), tarp = T('#56683e', 'cloth');
    M.add(g, M.sphere(0.6, 10, 5), dirt, 0, 0, 0, { sy: 0.35 });
    bb(g, pl, 0.62, 0.05, 0.62, 0, 0.18, 0, { ry: 0.2 });
    for (const i of [-1, 1]) bb(g, C('#5e4329'), 0.08, 0.055, 0.62, i * 0.2, 0.182, 0, { ry: 0.2 });
    M.add(g, torus(0.06, 0.012, 4, 8), rope, 0.12, 0.25, 0.04, { rx: PI / 2 });
    bx(g, tarp, 0.3, 0.02, 0.25, -0.38, 0.12, 0.3, { rz: 0.3, ry: 0.5 });
    for (let i = 0; i < 4; i++) { const a = i * 1.7 + 0.4; M.add(g, M.ico(0.09, 0), rock, Math.cos(a) * 0.55, 0.04, Math.sin(a) * 0.55, { ry: a }); }
  },
};
CON.locker = {
  base(g) {
    const bd = T('#5a6a72', 'metal', true), dr = T('#66777f', 'metal', true), dk = C('#22262a', true);
    bb(g, dk, 0.46, 0.06, 0.58, 0, 0, 0);
    wbb(g, bd, 0.48, 1.84, 0.6, 0, 0.06, 0, 1);
    bb(g, dr, 0.02, 1.7, 0.56, 0.25, 0.12, 0, { ts: 1 });
    for (let i = 0; i < 4; i++) bx(g, dk, 0.01, 0.025, 0.3, 0.262, 1.6 + i * 0.06, 0);
    for (let i = 0; i < 3; i++) bx(g, dk, 0.01, 0.025, 0.3, 0.262, 0.3 + i * 0.06, 0);
    bx(g, C('#a8adb2', true), 0.03, 0.14, 0.03, 0.27, 1.0, 0.2);
    bx(g, C('#d8d4c8', true), 0.005, 0.05, 0.1, 0.262, 1.35, 0);
    rustBlot(g, 0.262, 0.6, -0.12, 0.2, 0.3, 'x', true, 45);
  },
};
CON.fridge = {
  base(g) {
    const wh = T('#d6d2c2', 'metal', true), dk = C('#2a2a2c', true), chrome = C('#a8adb2', true);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, dk, 0.05, 0.05, 0.05, sx * 0.3, 0, sz * 0.33);
    wbb(g, wh, 0.68, 1.62, 0.74, 0, 0.05, 0, 1);
    bx(g, dk, 0.012, 0.02, 0.72, 0.345, 1.18, 0);
    bx(g, chrome, 0.04, 0.3, 0.035, 0.36, 1.42, 0.3); bx(g, chrome, 0.04, 0.45, 0.035, 0.36, 0.85, 0.3);
    bx(g, dk, 0.01, 0.08, 0.6, 0.345, 0.12, 0);
    rustBlot(g, 0.342, 0.5, -0.15, 0.3, 0.25, 'x', true, 46); rustBlot(g, -0.1, 1.67, 0.1, 0.3, 0.25, 'y', true, 47);
  },
};
CON.cabinet = {
  base(g) {
    const bd = T('#6e7a6e', 'metal', true), dr = T('#7a867a', 'metal', true), chrome = C('#a8adb2', true), lbl = C('#d8d4c8', true);
    wbb(g, bd, 0.56, 1.3, 0.5, 0, 0, 0, 1);
    for (let i = 0; i < 4; i++) {
      const y = 0.06 + i * 0.31, out = i === 1 ? 0.12 : 0;
      bb(g, dr, 0.03, 0.27, 0.46, 0.285 + out, y, 0, { ts: 1 });
      if (out) bb(g, dr, out, 0.22, 0.44, 0.27 + out / 2, y + 0.03, 0);
      bx(g, chrome, 0.03, 0.03, 0.14, 0.31 + out, y + 0.16, 0); bx(g, lbl, 0.005, 0.04, 0.08, 0.302 + out, y + 0.22, 0);
    }
  },
};

// ============================================================================
// VEGETATION — vertex-coloured, flat-shaded, merged geometries for
// InstancedMesh. Attributes: position, normal, color, uv (planar, metres/1.5).
// `solid` = trunk / rock part, `cut` = foliage / tall part (use a cut material).
// vegMaterial(cut) returns a matching shared Lambert material.
// ============================================================================
export const VEG_INFO = {
  pine: { r: 0.32, h: 9.0 }, pine_snow: { r: 0.32, h: 9.0 }, oak: { r: 0.42, h: 7.6 }, birch: { r: 0.22, h: 7.4 },
  dead: { r: 0.3, h: 6.4 }, palm: { r: 0.28, h: 8.2 }, cactus: { r: 0.36, h: 2.8 },
  bush: { r: 0, h: 1.1 }, berry_bush: { r: 0, h: 1.1 }, hemp: { r: 0, h: 1.1 }, mushroom: { r: 0, h: 0.2 },
  grass: { r: 0, h: 0.45 }, fern: { r: 0, h: 0.55 }, stump: { r: 0.45, h: 0.52 }, log_fallen: { r: 0.5, h: 0.68 },
  rock_small: { r: 0, h: 0.3 }, boulder: { r: 1.6, h: 2.1 },
};
export function vegMaterial(cut = false) { return M.mat('#ffffff', cut ? { vc: true, cut: true } : { vc: true }); }

function tri(P, a, b, c) { P.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
function tri2(P, a, b, c) { tri(P, a, b, c); tri(P, a, c, b); }
function geoFromTris(P) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); return g; }
function jitterGeo(g, amt, R) {
  const a = g.attributes.position, map = new Map();
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
    const k = Math.round(x * 1e3) + ',' + Math.round(y * 1e3) + ',' + Math.round(z * 1e3);
    let o = map.get(k);
    if (!o) { o = [(R() - 0.5) * 2 * amt, (R() - 0.5) * 2 * amt, (R() - 0.5) * 2 * amt]; map.set(k, o); }
    a.setXYZ(i, x + o[0], y + o[1], z + o[2]);
  }
}
function paintGeo(g, col, o, R) {
  const a = g.attributes.position, n = g.attributes.normal, cnt = a.count;
  const arr = new Float32Array(cnt * 3), base = new THREE.Color(col), c = new THREE.Color();
  const vary = o.vary ?? 0.08;
  for (let i = 0; i < cnt; i += 3) {
    if (o.vfn) {
      for (let j = 0; j < 3; j++) { c.copy(base); o.vfn(c, a.getX(i + j), a.getY(i + j), a.getZ(i + j), R); arr[(i + j) * 3] = c.r; arr[(i + j) * 3 + 1] = c.g; arr[(i + j) * 3 + 2] = c.b; }
      continue;
    }
    const cx = (a.getX(i) + a.getX(i + 1) + a.getX(i + 2)) / 3, cy = (a.getY(i) + a.getY(i + 1) + a.getY(i + 2)) / 3, cz = (a.getZ(i) + a.getZ(i + 1) + a.getZ(i + 2)) / 3;
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    c.copy(base);
    if (o.fn) o.fn(c, cx, cy, cz, ny, R, nx, nz);
    if (o.ao) { const [y0, y1, lo] = o.ao; c.multiplyScalar(lo + (1 - lo) * clamp01((cy - y0) / (y1 - y0))); }
    if (o.top) c.multiplyScalar(1 + o.top * ny);
    c.multiplyScalar(1 + (R() - 0.5) * 2 * vary);
    for (let j = 0; j < 3; j++) { arr[(i + j) * 3] = c.r; arr[(i + j) * 3 + 1] = c.g; arr[(i + j) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}
function planarUV(g, ts) {
  const a = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(a.count * 2);
  for (let i = 0; i < a.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = a.getX(i); v = a.getZ(i); } else if (ax >= az) { u = a.getZ(i); v = a.getY(i); } else { u = a.getX(i); v = a.getY(i); }
    uv[i * 2] = u / ts; uv[i * 2 + 1] = v / ts;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
// vertex-colour geometry builder
class VB {
  constructor(seed = 1) { this.parts = []; this.R = rng(seed); }
  add(geo, o = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.clearGroups();
    const s = o.s === undefined ? [1, 1, 1] : (Array.isArray(o.s) ? o.s : [o.s, o.s, o.s]);
    const p = o.p || [0, 0, 0], r = o.r || [0, 0, 0];
    const q = o.q || new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
    g.applyMatrix4(new THREE.Matrix4().compose(V3(p[0], p[1], p[2]), q, V3(s[0], s[1], s[2])));
    if (o.jit) jitterGeo(g, o.jit, this.R);
    if (o.floor !== undefined) { const a = g.attributes.position; for (let i = 0; i < a.count; i++) if (a.getY(i) < o.floor) a.setY(i, o.floor); }
    g.computeVertexNormals();
    paintGeo(g, o.col || '#ffffff', o, this.R);
    this.parts.push(g);
    return g;
  }
  // tapered cylinder from a (radius r0) to b (radius r1)
  rod(r0, r1, a, b, seg = 6, o = {}) {
    const A = V3(a[0], a[1], a[2]), B = V3(b[0], b[1], b[2]), d = B.clone().sub(A), L = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(_up, d.clone().normalize());
    const m = A.clone().add(B).multiplyScalar(0.5);
    return this.add(new THREE.CylinderGeometry(r1, r0, 1, seg, 1, o.open !== false), Object.assign({}, o, { p: [m.x, m.y, m.z], q, s: [1, L, 1] }));
  }
  tris(P, o) { return this.add(geoFromTris(P), o); }
  build(ts = 1.5) {
    if (!this.parts.length) return null;
    for (const g of this.parts) planarUV(g, ts);
    const m = M.mergeGeometries(this.parts, false);
    m.computeBoundingBox(); m.computeBoundingSphere();
    return m;
  }
}
// split a merged non-indexed geometry into faces below / above y
function splitY(geo, y) {
  if (!geo) return [null, null];
  const keys = Object.keys(geo.attributes), lo = {}, hi = {};
  for (const k of keys) { lo[k] = []; hi[k] = []; }
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, dst = cy < y ? lo : hi;
    for (const k of keys) { const at = geo.attributes[k], s = at.itemSize; for (let j = 0; j < 3 * s; j++) dst[k].push(at.array[i * s + j]); }
  }
  const mk = d => {
    if (!d.position.length) return null;
    const g = new THREE.BufferGeometry();
    for (const k of keys) g.setAttribute(k, new THREE.Float32BufferAttribute(d[k], geo.attributes[k].itemSize));
    g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  };
  return [mk(lo), mk(hi)];
}
// star-rimmed cone layer (pine tiers): tip at y = h, drooping rim near 0, concave underside
function starCone(r, h, seg = 12, jag = 0.22, droop = 0.1) {
  const P = [], tip = [0, h, 0], under = [0, h * 0.2, 0], rim = [], mid = [];
  for (let i = 0; i < seg; i++) {
    const a = i / seg * TAU, rr = r * (i % 2 ? 1 - jag : 1);
    rim.push([Math.cos(a) * rr, (i % 2 ? droop * 0.4 : -droop) * h, Math.sin(a) * rr]);
    mid.push([Math.cos(a) * rr * 0.55, h * 0.5, Math.sin(a) * rr * 0.55]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    tri(P, tip, mid[j], mid[i]);
    tri(P, mid[i], mid[j], rim[j]); tri(P, mid[i], rim[j], rim[i]);
    tri(P, rim[i], rim[j], under);
  }
  return geoFromTris(P);
}
// folded, double-sided frond / leaf strip
function frond(P, o) {
  const { x = 0, y = 0, z = 0, ang = 0, len = 1, wid = 0.2, lift = 0.3, droop = 0.6, segs = 4, fold = 0.3 } = o;
  const ca = Math.cos(ang), sa = Math.sin(ang), Cc = [], L = [], Rr = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, d = len * t, yy = y + (lift * t - droop * t * t) * len;
    const w = wid * (o.prof ? o.prof(t) : Math.sin(PI * Math.min(1, t * 0.95 + 0.05)));
    const cx = x + ca * d, cz = z + sa * d;
    Cc.push([cx, yy, cz]); L.push([cx - sa * w, yy - fold * w, cz + ca * w]); Rr.push([cx + sa * w, yy - fold * w, cz - ca * w]);
  }
  for (let i = 0; i < segs; i++) {
    tri2(P, Cc[i], L[i], L[i + 1]); tri2(P, Cc[i], L[i + 1], Cc[i + 1]);
    tri2(P, Cc[i], Cc[i + 1], Rr[i + 1]); tri2(P, Cc[i], Rr[i + 1], Rr[i]);
  }
}
// flat diamond leaf (double-sided, 4 tris)
function diamond(P, b, ang, len, wid, lift = 0.2) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const tip = [b[0] + ca * len, b[1] + lift * len, b[2] + sa * len];
  const m = [b[0] + ca * len * 0.45, b[1] + lift * len * 0.6, b[2] + sa * len * 0.45];
  const l = [m[0] - sa * wid, m[1] - wid * 0.3, m[2] + ca * wid], r = [m[0] + sa * wid, m[1] - wid * 0.3, m[2] - ca * wid];
  tri2(P, b, l, tip); tri2(P, b, tip, r);
}
// ribbed column (cactus)
function ribCyl(rt, rb, h, seg = 12, hs = 2, k = 0.84) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, hs, true), a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), z = a.getZ(i), ang = Math.atan2(x, z), idx = Math.round(((ang + TAU) % TAU) / (TAU / seg));
    if (idx % 2) { a.setX(i, x * k); a.setZ(i, z * k); }
  }
  return g;
}
const VEG_CACHE = new Map();
export function vegGeometry(kind) {
  const k = VEG_BUILD[kind] ? kind : 'bush';
  if (!VEG_CACHE.has(k)) VEG_CACHE.set(k, VEG_BUILD[k]());
  return VEG_CACHE.get(k);
}
const col = h => new THREE.Color(h);
function blobs(vb, list, o) {
  for (const [x, y, z, r, det, sy] of list) vb.add(M.ico(r, det), Object.assign({}, o, { p: [x, y, z], s: [1, sy || 0.82, 1], jit: r * 0.13, r: [vb.R() * 3, vb.R() * 3, vb.R() * 3] }));
}
function pineGeo(snow) {
  const sol = new VB(3), cut = new VB(4);
  sol.add(new THREE.CylinderGeometry(0.13, 0.32, 3.4, 7), { p: [0, 1.7, 0], col: '#5a4130', vary: 0.12, ao: [0, 2, 0.55] });
  const L = [[2.6, 1.45, 2.5], [2.2, 2.8, 2.35], [1.78, 4.05, 2.2], [1.36, 5.2, 2.05], [0.95, 6.3, 1.9], [0.55, 7.35, 1.65]];
  L.forEach(([r, y, h], i) => {
    const base = col(PAL.pine).lerp(col('#46774c'), i / 7);
    cut.add(starCone(r, h, 12, 0.24, 0.1), {
      p: [0, y, 0], r: [0, i * 0.9, 0], col: base, vary: 0.06,
      fn: (c, x, yy, z, ny, R) => {
        const t = (yy - y) / h;
        if (snow && (t > 0.3 || (ny > 0.45 && R() < 0.55))) c.set('#e4ebf0').multiplyScalar(0.9 + t * 0.12);
        else c.multiplyScalar(0.58 + 0.6 * t);
      },
    });
  });
  return { solid: sol.build(), cut: cut.build() };
}
const VEG_BUILD = {
  pine: () => pineGeo(false),
  pine_snow: () => pineGeo(true),
  oak() {
    const sol = new VB(5), cut = new VB(6);
    sol.add(new THREE.CylinderGeometry(0.24, 0.42, 3.8, 7), { p: [0, 1.9, 0], col: '#5e4632', vary: 0.12, ao: [0, 2.2, 0.6] });
    sol.rod(0.18, 0.08, [0, 2.9, 0], [1.3, 4.5, 0.5], 5, { col: '#5e4632' });
    sol.rod(0.16, 0.07, [0, 3.2, 0], [-1.2, 4.6, -0.5], 5, { col: '#5e4632' });
    sol.rod(0.14, 0.06, [0, 3.5, 0], [0.2, 5.0, 1.1], 5, { col: '#5e4632' });
    const leaf = (c, x, y, z, ny, R) => { if (R() < 0.35) c.lerp(col(PAL.leafDark), 0.6); if (R() < 0.12) c.lerp(col('#7a9a3e'), 0.6); };
    blobs(cut, [[0, 5.5, 0, 2.3, 1], [1.45, 4.85, 0.7, 1.6, 1], [-1.35, 5.0, -0.6, 1.7, 1], [0.4, 6.55, -0.25, 1.4, 0], [-0.5, 4.7, 1.3, 1.35, 0]],
      { col: PAL.leaf, vary: 0.07, fn: leaf, top: 0.28, ao: [3.4, 7.2, 0.5] });
    return { solid: sol.build(), cut: cut.build() };
  },
  birch() {
    const sol = new VB(7), cut = new VB(8);
    sol.add(new THREE.CylinderGeometry(0.11, 0.2, 5.4, 6, 3), { p: [0, 2.7, 0], col: '#e4e0d4', vary: 0.05, fn: (c, x, y, z, ny, R) => { if (R() < 0.3) c.set('#3a3530'); }, ao: [0, 1, 0.7] });
    sol.rod(0.07, 0.03, [0, 3.6, 0], [0.8, 4.6, 0.3], 5, { col: '#d8d4c8' });
    sol.rod(0.06, 0.025, [0, 4.2, 0], [-0.7, 5.2, -0.2], 5, { col: '#d8d4c8' });
    blobs(cut, [[0, 5.7, 0, 1.4, 1, 1.3], [0.65, 4.6, 0.3, 1.0, 1, 1.1], [-0.5, 6.6, -0.2, 0.9, 1, 1.1], [-0.45, 4.9, -0.5, 0.85, 0, 1.0]],
      { col: '#8fae4a', vary: 0.08, fn: (c, x, y, z, ny, R) => { if (R() < 0.3) c.lerp(col('#6f9038'), 0.7); if (R() < 0.1) c.lerp(col('#c8c060'), 0.6); }, top: 0.25, ao: [3.6, 7.2, 0.55] });
    return { solid: sol.build(), cut: cut.build() };
  },
  dead() {
    const sol = new VB(9), cut = new VB(10), bark = '#6b5b4b';
    sol.add(new THREE.CylinderGeometry(0.14, 0.3, 4.6, 6), { p: [0, 2.3, 0], col: bark, vary: 0.12, ao: [0, 2, 0.65] });
    sol.rod(0.14, 0.05, [0, 4.6, 0], [0.3, 6.3, 0.1], 5, { col: bark });
    for (const [a, b, r0, r1] of [
      [[0, 2.4, 0], [1.6, 3.8, 0.5], 0.09, 0.03], [[0, 3.0, 0], [-1.5, 4.4, -0.3], 0.08, 0.03], [[0, 3.6, 0], [0.4, 5.2, -1.3], 0.07, 0.025],
      [[0, 4.2, 0], [-0.6, 5.6, 1.1], 0.06, 0.02], [[0.15, 5.2, 0.05], [1.1, 6.1, 0.4], 0.04, 0.015], [[1.0, 3.3, 0.3], [1.5, 4.5, -0.3], 0.035, 0.01],
      [[-1.0, 4.0, -0.2], [-1.7, 4.9, 0.4], 0.035, 0.01], [[0.3, 4.7, -0.9], [0.9, 5.6, -1.4], 0.03, 0.01]]) cut.rod(r0, r1, a, b, 5, { col: bark, vary: 0.1 });
    return { solid: sol.build(), cut: cut.build() };
  },
  palm() {
    const sol = new VB(11), cut = new VB(12), N = 6, pt = t => [1.1 * t * t, 7.4 * t, 0];
    for (let k = 0; k < N; k++) {
      const a = pt(k / N), b = pt((k + 1) / N), r0 = 0.27 - k * 0.016, r1 = 0.27 - (k + 1) * 0.016;
      sol.rod(r0, r1, a, b, 6, { col: k % 2 ? '#8a7356' : '#71604a', vary: 0.06, open: k !== N - 1 });
    }
    const top = pt(1);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; sol.add(octa(0.15), { p: [top[0] + Math.cos(a) * 0.22, top[1] - 0.25, Math.sin(a) * 0.22], col: '#5a4020' }); }
    const P = [];
    for (let i = 0; i < 8; i++) frond(P, { x: top[0], y: top[1], z: top[2], ang: i / 8 * TAU + 0.3, len: 3.2 + (i % 3) * 0.25, wid: 0.42, lift: 0.4, droop: 0.95, segs: 4, fold: 0.35 });
    frond(P, { x: top[0], y: top[1], z: top[2], ang: 1.2, len: 1.7, wid: 0.3, lift: 1.0, droop: 0.7, segs: 3, fold: 0.3 });
    cut.tris(P, { col: '#5c8a3a', vary: 0.06, fn: (c, x, y, z) => { const d = Math.hypot(x - top[0], z - top[2]); c.lerp(col('#9aae4c'), clamp01(d / 3.4) * 0.7); c.multiplyScalar(0.8 + 0.25 * clamp01((y - top[1] + 2) / 2.5)); } });
    return { solid: sol.build(), cut: cut.build() };
  },
  cactus() {
    const vb = new VB(13), green = '#5f8a4a';
    const o = { col: green, vary: 0.07, top: 0.15, ao: [0, 1.2, 0.7] };
    vb.add(ribCyl(0.3, 0.34, 2.4, 12, 2), Object.assign({ p: [0, 1.2, 0] }, o));
    vb.add(sphereCap(0.3, 12, 3, PI / 2), Object.assign({ p: [0, 2.4, 0], s: [1, 0.8, 1] }, o));
    vb.rod(0.15, 0.15, [0.22, 1.15, 0], [0.62, 1.3, 0], 8, o);
    vb.add(ribCyl(0.15, 0.16, 0.85, 8, 1), Object.assign({ p: [0.66, 1.72, 0] }, o));
    vb.add(sphereCap(0.15, 8, 2, PI / 2), Object.assign({ p: [0.66, 2.145, 0], s: [1, 0.8, 1] }, o));
    vb.rod(0.13, 0.13, [-0.2, 0.85, 0.1], [-0.55, 0.98, 0.16], 8, o);
    vb.add(ribCyl(0.13, 0.14, 0.62, 8, 1), Object.assign({ p: [-0.58, 1.28, 0.16] }, o));
    vb.add(sphereCap(0.13, 8, 2, PI / 2), Object.assign({ p: [-0.58, 1.59, 0.16], s: [1, 0.8, 1] }, o));
    for (const p of [[0.05, 2.62, 0.05], [0.66, 2.27, 0.02]]) vb.add(octa(0.05), { p, col: '#e07aa0', vary: 0.05 });
    const [solid, cut] = splitY(vb.build(), 1.0);
    return { solid, cut };
  },
  bush() {
    const cut = new VB(14);
    blobs(cut, [[0, 0.5, 0, 0.62, 1, 0.78], [0.55, 0.38, 0.25, 0.5, 1, 0.75], [-0.5, 0.36, -0.2, 0.45, 0, 0.8], [0.02, 0.34, -0.55, 0.42, 0, 0.8], [-0.28, 0.32, 0.5, 0.38, 0, 0.8]],
      { col: '#4a7030', vary: 0.08, fn: (c, x, y, z, ny, R) => { if (R() < 0.4) c.lerp(col('#355a26'), 0.7); }, top: 0.3, ao: [0, 1, 0.5], floor: 0.02 });
    return { solid: null, cut: cut.build() };
  },
  berry_bush() {
    const cut = new VB(15);
    const B = [[0, 0.52, 0, 0.6, 1, 0.8], [0.5, 0.4, -0.3, 0.48, 1, 0.75], [-0.45, 0.38, 0.25, 0.46, 0, 0.8], [0.15, 0.32, 0.5, 0.38, 0, 0.8]];
    blobs(cut, B, { col: '#3f6a2e', vary: 0.08, fn: (c, x, y, z, ny, R) => { if (R() < 0.4) c.lerp(col('#2f5224'), 0.7); }, top: 0.3, ao: [0, 1, 0.5], floor: 0.02 });
    const R = rng(51);
    for (let i = 0; i < 16; i++) {
      const [x, y, z, r, , sy] = B[i % B.length], a = R() * TAU, e = 0.15 + R() * 1.1;
      const d = [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
      cut.add(octa(0.06), { p: [x + d[0] * r * 0.95, y + d[1] * r * sy * 0.95, z + d[2] * r * 0.95], col: i % 3 ? '#c0302a' : '#d8483a', vary: 0.06 });
    }
    return { solid: null, cut: cut.build() };
  },
  hemp() {
    const sol = new VB(16);
    sol.rod(0.03, 0.014, [0, 0, 0], [0, 1.0, 0], 5, { col: '#5a8a32', open: true });
    const P = [];
    [[0.3, 0.32, 0], [0.55, 0.27, PI / 2], [0.78, 0.2, 0.4]].forEach(([y, L, a0]) => {
      for (const side of [0, PI]) for (let f = -2; f <= 2; f++) diamond(P, [0, y, 0], a0 + side + f * 0.42, L * (1 - Math.abs(f) * 0.18), 0.038, 0.35 - Math.abs(f) * 0.12);
    });
    sol.tris(P, { col: '#5f9a34', vary: 0.08, fn: (c, x, y, z, ny, R) => { if (R() < 0.3) c.lerp(col('#4a7a2a'), 0.7); } });
    for (const [x, y, z] of [[0, 1.0, 0], [0.04, 0.92, 0.03], [-0.03, 0.86, -0.03]]) sol.add(M.ico(0.06, 0), { p: [x, y, z], s: [1, 1.6, 1], col: '#a6c860', vary: 0.06 });
    return { solid: sol.build(), cut: null };
  },
  mushroom() {
    const sol = new VB(17);
    for (const [x, z, s, cc] of [[0, 0, 1, '#b8402f'], [0.12, 0.08, 0.7, '#b8402f'], [-0.1, 0.1, 0.55, '#8a6a4a']]) {
      sol.add(new THREE.CylinderGeometry(0.025 * s, 0.035 * s, 0.14 * s, 6), { p: [x, 0.07 * s, z], col: '#e8e0cc', vary: 0.04 });
      sol.add(new THREE.CylinderGeometry(0.085 * s, 0.085 * s, 0.01, 7), { p: [x, 0.13 * s, z], col: '#d8ccb0', vary: 0.03 });
      sol.add(sphereCap(0.09 * s, 7, 3, PI / 2), { p: [x, 0.13 * s, z], s: [1, 0.7, 1], col: cc, vary: 0.06, fn: (c, a, b, d, ny, R) => { if (cc !== '#8a6a4a' && R() < 0.25) c.set('#f0e8d8'); } });
    }
    return { solid: sol.build(), cut: null };
  },
  grass() {
    const sol = new VB(18), P = [], R = rng(19);
    for (let i = 0; i < 12; i++) {
      const a = R() * TAU, r = R() * 0.14, x = Math.cos(a) * r, z = Math.sin(a) * r, ang = a + (R() - 0.5), h = 0.26 + R() * 0.22, w = 0.032 + R() * 0.018, bend = 0.12 + R() * 0.14;
      const ca = Math.cos(ang), sa = Math.sin(ang), px = -sa, pz = ca;
      const b0 = [x + px * w, 0, z + pz * w], b1 = [x - px * w, 0, z - pz * w];
      const mx = x + ca * bend * 0.4, mz = z + sa * bend * 0.4, my = h * 0.55;
      const m0 = [mx + px * w * 0.6, my, mz + pz * w * 0.6], m1 = [mx - px * w * 0.6, my, mz - pz * w * 0.6], tip = [x + ca * bend, h, z + sa * bend];
      tri2(P, b0, b1, m1); tri2(P, b0, m1, m0); tri2(P, m0, m1, tip);
    }
    sol.tris(P, { col: '#4a6a2a', vfn: (c, x, y) => c.lerp(col('#a2bc5e'), clamp01(y / 0.42)) });
    return { solid: sol.build(), cut: null };
  },
  fern() {
    const sol = new VB(20), P = [], R = rng(21);
    for (let i = 0; i < 7; i++) frond(P, { ang: i / 7 * TAU + R() * 0.4, len: 0.6 + R() * 0.15, wid: 0.11, lift: 2.2, droop: 2.0, segs: 3, fold: 0.3, prof: t => Math.sin(PI * Math.min(1, 0.15 + t * 0.85)) });
    sol.tris(P, { col: '#3f7a3a', vary: 0.06, fn: (c, x, y, z) => c.lerp(col('#7aa64a'), clamp01(Math.hypot(x, z) / 0.7) * 0.6) });
    return { solid: sol.build(), cut: null };
  },
  stump() {
    const sol = new VB(22);
    sol.add(new THREE.CylinderGeometry(0.36, 0.45, 0.5, 9), { p: [0, 0.25, 0], col: '#5e4632', vary: 0.1, fn: (c, x, y, z, ny) => { if (ny > 0.9) c.set('#c49a68'); } });
    sol.add(new THREE.CylinderGeometry(0.24, 0.24, 0.012, 9), { p: [0, 0.505, 0], col: '#a8845a', vary: 0.03 });
    sol.add(new THREE.CylinderGeometry(0.07, 0.07, 0.014, 7), { p: [0, 0.508, 0], col: '#8a6440', vary: 0.03 });
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; sol.rod(0.13, 0.03, [Math.cos(a) * 0.3, 0.13, Math.sin(a) * 0.3], [Math.cos(a) * 0.68, -0.02, Math.sin(a) * 0.68], 5, { col: '#5a4330', open: false }); }
    return { solid: sol.build(), cut: null };
  },
  log_fallen() {
    const sol = new VB(23);
    sol.add(new THREE.CylinderGeometry(0.33, 0.35, 3.6, 9), {
      p: [0, 0.3, 0], r: [0, 0, PI / 2], col: '#5a4130', vary: 0.1,
      fn: (c, x, y, z, ny, R, nx) => { if (Math.abs(nx) > 0.9) c.set('#b99266'); else if (ny > 0.6 && R() < 0.35) c.lerp(col('#5f7d36'), 0.6); },
    });
    sol.rod(0.08, 0.03, [0.6, 0.55, 0.05], [0.9, 1.0, 0.25], 5, { col: '#5a4130', open: false });
    sol.add(new THREE.CylinderGeometry(0.2, 0.2, 0.01, 8), { p: [1.805, 0.3, 0], r: [0, 0, PI / 2], col: '#9a7650', vary: 0.03 });
    return { solid: sol.build(), cut: null };
  },
  rock_small() {
    const sol = new VB(24);
    for (const [x, z, r, c] of [[0, 0, 0.2, '#8a877f'], [0.24, 0.12, 0.13, '#7a776f'], [-0.18, 0.16, 0.11, '#96938a'], [0.05, -0.22, 0.12, '#828078']]) {
      sol.add(M.ico(r, 0), { p: [x, r * 0.35, z], s: [1, 0.65, 0.9], r: [sol.R() * 3, sol.R() * 3, 0], jit: r * 0.15, floor: 0, col: c, vary: 0.1, top: 0.15 });
    }
    return { solid: sol.build(), cut: null };
  },
  boulder() {
    const vb = new VB(25);
    const fn = (c, x, y, z, ny, R) => { if (ny > 0.7 && R() < 0.45) c.lerp(col('#5e7a3c'), 0.75); else if (R() < 0.15) c.lerp(col('#a8a59c'), 0.5); };
    vb.add(M.ico(1.6, 1), { p: [0, 0.92, 0], s: [1, 0.72, 0.9], r: [0.3, 0.7, 0.2], jit: 0.22, floor: -0.1, col: '#8a877f', vary: 0.1, fn, ao: [-0.1, 1.4, 0.62] });
    vb.add(M.ico(0.75, 0), { p: [1.25, 0.32, 0.75], s: [1, 0.7, 1], jit: 0.1, floor: -0.05, col: '#7f7c75', vary: 0.1, fn, ao: [-0.1, 1.0, 0.7] });
    const [solid, cut] = splitY(vb.build(), 0.85);
    return { solid, cut };
  },
};

// ============================================================================
// RESOURCE NODES — single vertex-coloured mesh (rock texture), ~1.4 x 1.1 m
// ============================================================================
const NODE_CACHE = new Map();
export function makeNode(type) {
  const t = ['stone', 'metal', 'sulfur', 'hqm'].includes(type) ? type : 'stone';
  if (!NODE_CACHE.has(t)) NODE_CACHE.set(t, nodeGeo(t));
  const g = G();
  const m = new THREE.Mesh(NODE_CACHE.get(t), M.mat('#ffffff', { vc: true, tex: 'rock' }));
  m.castShadow = m.receiveShadow = true;
  g.add(m); g.userData.node = t;
  return g;
}
function nodeGeo(t) {
  const vb = new VB(hashStr(t)), R = vb.R;
  const base = { stone: '#8d8c88', metal: '#6f6a62', sulfur: '#8f8774', hqm: '#5b6470' }[t];
  const fn = (c, x, y, z, ny, R2) => {
    if (t === 'stone' && R2() < 0.22) c.lerp(col('#b0aea6'), 0.6);
    if (t === 'metal' && Math.sin(x * 5.1 + y * 3.3) * Math.sin(z * 4.7 - y * 2.1) > 0.3) c.set(R2() < 0.5 ? '#b5652c' : '#8e4a26');
    if (t === 'sulfur' && (ny > 0.4 && R2() < 0.35)) c.lerp(col('#d0b448'), 0.8);
    if (t === 'hqm' && R2() < 0.14) c.set('#dbe8f5');
  };
  const o = { col: base, vary: 0.1, fn, top: 0.18, ao: [0, 0.9, 0.62] };
  vb.add(M.ico(0.78, 1), Object.assign({ p: [0, 0.5, 0], s: [0.95, 0.75, 0.85], r: [0.2, 0.5, 0.1], jit: 0.09, floor: 0 }, o));
  vb.add(M.ico(0.38, 0), Object.assign({ p: [0.55, 0.16, 0.42], r: [0.5, 0.2, 0.3], jit: 0.05, floor: 0 }, o));
  vb.add(M.ico(0.3, 0), Object.assign({ p: [-0.6, 0.1, -0.35], r: [0.1, 0.9, 0.4], jit: 0.05, floor: 0 }, o));
  const surf = (a, e) => { const d = V3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)); return [d, [d.x * 0.7, 0.5 + d.y * 0.55, d.z * 0.62]]; };
  if (t === 'metal') for (let i = 0; i < 6; i++) { const [, p] = surf(R() * TAU, 0.1 + R() * 1.1); vb.add(M.ico(0.12 + R() * 0.05, 0), { p, col: R() < 0.5 ? '#c06a2e' : '#9a5228', vary: 0.1, r: [R() * 3, R() * 3, 0] }); }
  if (t === 'sulfur' || t === 'hqm') {
    const cc = t === 'sulfur' ? ['#e6c63e', '#f2da62'] : ['#8fb4d8', '#c4dcf0'];
    for (let i = 0; i < (t === 'sulfur' ? 8 : 6); i++) {
      const [d, p] = surf(R() * TAU, 0.25 + R() * 1.1);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, d.clone().add(V3(0, 0.6, 0)).normalize());
      vb.add(octa(0.1 + R() * 0.05), { p, q, s: [0.8, 2.2 + R(), 0.8], col: cc[i % 2], vary: 0.08, top: 0.2 });
    }
  }
  return vb.build(1.2);
}

// ============================================================================
// PROPS — monument building blocks.
// PROP_INFO: w = X extent, d = Z extent, h; colliders [cx, cz, w, d, h, opaque?]
// local & unrotated (opaque defaults to true). Vehicles face +X.
// ============================================================================
const box1 = (w, d, h, opaque) => ({ w, d, h, colliders: [opaque === false ? [0, 0, w, d, h, false] : [0, 0, w, d, h]] });
const legs4 = (x, z, s, h) => [[-x, -z, s, s, h], [x, -z, s, s, h], [-x, z, s, s, h], [x, z, s, s, h]];
export const PROP_INFO = {
  container: box1(6.0, 2.4, 2.6),
  tank_v: { w: 4.4, d: 4.4, h: 6.4, colliders: [[0, 0, 4.1, 2.9, 6.2], [0, 0, 2.9, 4.1, 6.2]] },
  tank_h: box1(6.0, 2.4, 2.4),
  silo: { w: 6.4, d: 6.4, h: 12.2, colliders: [[0, 0, 6.2, 4.4, 12], [0, 0, 4.4, 6.2, 12]] },
  crane: { w: 6, d: 4, h: 18, colliders: legs4(3, 2, 0.9, 12).map(c => [c[0], c[1], 1.6, 0.9, 12]) },
  dish: { w: 3, d: 3, h: 10, colliders: [[0, 0, 3, 3, 4.5]] },
  antenna: { w: 2.2, d: 2.2, h: 23, colliders: [[0, 0, 2.2, 2.2, 20]] },
  pylon: { w: 3.2, d: 8.4, h: 16.4, colliders: [[0, 0, 3.2, 3.2, 16]] },
  cooling_tower: { w: 19.2, d: 19.2, h: 18, colliders: [[0, 0, 17.6, 9, 18], [0, 0, 9, 17.6, 18], [0, 0, 14, 14, 18]] },
  chimney: box1(3.4, 3.4, 25),
  car: box1(4.3, 1.8, 1.4),
  truck: box1(7.1, 2.4, 3.1),
  bus: box1(10, 2.6, 3.0),
  heli_wreck: { w: 10, d: 3.4, h: 3, colliders: [[0.6, 0, 5.4, 2.4, 2.8], [-4.6, 0.6, 4.4, 1.4, 1.2]] },
  barrier: box1(2.0, 0.6, 0.9),
  sandbags: box1(2.0, 0.8, 0.9),
  fence_chain: box1(3.0, 0.12, 2.2, false),
  fence_wood: box1(3.0, 0.15, 1.4),
  pallets: box1(1.2, 1.2, 1.0),
  tires: { w: 1.6, d: 1.6, h: 0.8, colliders: [[0, 0, 1.4, 1.4, 0.8]] },
  lamp: { w: 0.3, d: 0.3, h: 6, colliders: [[0, 0, 0.3, 0.3, 6]] },
  gas_pump: box1(0.8, 0.5, 1.6),
  billboard: { w: 4, d: 0.3, h: 5, colliders: [[-1.2, 0, 0.3, 0.3, 5], [1.2, 0, 0.3, 0.3, 5]] },
  pipes: box1(6, 1, 1.2),
  generator: box1(2, 1.2, 1.4),
  transformer: box1(1.5, 1.5, 2.2),
  watchtower: { w: 3, d: 3, h: 6.5, colliders: legs4(1.3, 1.3, 0.35, 4) },
  tent: box1(3, 3, 2.2),
  rock_big: { w: 4, d: 4, h: 3, colliders: [[0, 0, 3.6, 3.4, 3]] },
  lighthouse: { w: 6.8, d: 6.8, h: 22, colliders: [[0, 0, 6, 4.3, 22], [0, 0, 4.3, 6, 22]] },
  boat: { w: 8, d: 3, h: 3, colliders: [[-0.6, 0, 6.8, 3, 3], [3.3, 0, 1.4, 1.6, 2]] },
  dock: { w: 6, d: 6, h: 0.1, colliders: [] },
  rails: { w: 6, d: 2.2, h: 0.3, colliders: [] },
  train_car: box1(12, 3, 3.6),
  locomotive: box1(14, 3, 4),
  conveyor: box1(6, 1.2, 1.5),
  crusher: box1(4, 4, 5),
  vending: box1(0.8, 1.0, 2.0),
  counter: box1(3, 0.8, 1.1),
  shelf: box1(3, 0.6, 1.8),
  cardreader: box1(0.3, 0.25, 1.25),
  fusebox: box1(0.3, 0.5, 1.6),
  lever: box1(0.3, 0.3, 1.0),
  haybale: box1(1.2, 1.2, 1.2),
  drums: box1(1.6, 1.6, 0.9),
  desk: box1(1.6, 0.8, 0.8),
  bunkbed: box1(2, 1, 1.6),
  table: box1(1.6, 0.9, 0.8),
  workbench_old: box1(2, 0.8, 1.0),
  cable_spool: { w: 1.6, d: 1.6, h: 1.0, colliders: [[0, 0, 1.4, 1.4, 1.0]] },
  scaffold: { w: 3, d: 1.5, h: 4.2, colliders: [[-1.45, -0.7, 0.15, 0.15, 4.2], [1.45, -0.7, 0.15, 0.15, 4.2], [-1.45, 0.7, 0.15, 0.15, 4.2], [1.45, 0.7, 0.15, 0.15, 4.2], [0, -0.7, 0.15, 0.15, 4.2], [0, 0.7, 0.15, 0.15, 4.2]] },
  hangar: { w: 14, d: 20, h: 7, colliders: [[0, 9.5, 14, 1.0, 3.5], [0, -9.5, 14, 1.0, 3.5], [-6.92, 0, 0.3, 20, 7]] },
  garage: { w: 8, d: 6, h: 3.5, colliders: [[-3.9, 0, 0.2, 6, 3.5], [0, 2.9, 8, 0.2, 3.5], [0, -2.9, 8, 0.2, 3.5]] },
  smokestack: box1(2.4, 2.4, 14),
  water_tower: { w: 5.4, d: 5.4, h: 12, colliders: [...legs4(1.8, 1.8, 0.4, 7.6), [0, 0, 0.4, 0.4, 7.6]] },
  dumpster: box1(2, 1.2, 1.3),
  bench: box1(2, 0.5, 0.5),
  streetsign: { w: 0.12, d: 0.8, h: 2.7, colliders: [[0, 0, 0.12, 0.12, 2.7]] },
};

const PROPS = {}, PROP_POST = {};
export function makeProp(type, opts = {}) {
  const t = PROPS[type] ? type : 'pallets';
  opts = opts || {};
  const out = cached('prop:' + t + ':' + JSON.stringify(opts), g => PROPS[t](g, opts));
  if (PROP_POST[t]) PROP_POST[t](out, opts);
  out.userData.prop = t;
  return out;
}

// ---- local canvas-texture materials (ad board, chain-link)
let _adMat, _chainMat;
function adMat() {
  if (_adMat) return _adMat;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d'), R = rng(99);
  const gr = x.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#dccb9c'); gr.addColorStop(1, '#c2a573');
  x.fillStyle = gr; x.fillRect(0, 0, 512, 256);
  x.fillStyle = '#b3402f'; x.beginPath(); x.arc(112, 128, 88, 0, 7); x.fill();
  x.fillStyle = '#ead9ad'; x.beginPath(); x.arc(112, 128, 62, 0, 7); x.fill();
  x.fillStyle = '#b3402f'; x.font = 'bold 80px sans-serif'; x.textAlign = 'center'; x.fillText('Z', 112, 156);
  x.textAlign = 'left'; x.fillStyle = '#3a2a22'; x.font = 'bold 66px sans-serif'; x.fillText('ZONA COLA', 222, 118);
  x.fillStyle = '#7a3a2c'; x.font = 'bold 28px sans-serif'; x.fillText('ICE COLD  SINCE 1987', 226, 168);
  x.fillStyle = '#3a2a22'; x.fillRect(226, 186, 250, 6);
  for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(70,50,30,${0.04 + R() * 0.12})`; const w = 10 + R() * 60; x.fillRect(R() * 512, R() * 256, w, w * (0.3 + R())); }
  x.fillStyle = 'rgba(236,226,200,0.9)'; x.fillRect(392, 0, 46, 92); x.fillRect(40, 206, 130, 26); x.fillRect(300, 210, 60, 46);
  for (let i = 0; i < 6; i++) { const gx = R() * 512, g2 = x.createLinearGradient(0, 0, 0, 256); g2.addColorStop(0, 'rgba(80,50,30,0.25)'); g2.addColorStop(1, 'rgba(80,50,30,0)'); x.fillStyle = g2; x.fillRect(gx, 0, 3 + R() * 6, 256); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (_adMat = cutPatch(new THREE.MeshLambertMaterial({ map: t })));
}
function chainMat() {
  if (_chainMat) return _chainMat;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  x.strokeStyle = '#ffffff'; x.lineWidth = 3.2; x.beginPath();
  for (let k = -2; k <= 4; k++) { x.moveTo(0, k * 32); x.lineTo(64, k * 32 + 64); x.moveTo(0, k * 32); x.lineTo(64, k * 32 - 64); }
  x.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (_chainMat = new THREE.MeshLambertMaterial({ color: '#a4abb0', map: t, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: false }));
}
const _planeGeo = new Map();
function plane(w, h) { const k = w + 'x' + h; if (!_planeGeo.has(k)) _planeGeo.set(k, new THREE.PlaneGeometry(w, h)); return _planeGeo.get(k); }

// ---- industrial
PROPS.container = (g, o) => {
  const col = o.color || '#9a4a36';
  const body = T(col, 'corrugated', true), frame = C(shade(col, 0.5), true), steel = C('#a0a6ab', true);
  wbb(g, body, 5.84, 2.36, 2.3, 0, 0.12, 0, 1.6);
  for (const s of [-1, 1]) {
    bb(g, frame, 6.0, 0.14, 0.14, 0, 0, s * 1.13); bb(g, frame, 6.0, 0.12, 0.14, 0, 2.48, s * 1.13);
    bb(g, frame, 0.14, 0.14, 2.12, s * 2.93, 0, 0); bb(g, frame, 0.14, 0.12, 2.12, s * 2.93, 2.48, 0);
    for (const z of [-1, 1]) bb(g, frame, 0.16, 2.6, 0.16, s * 2.92, 0, z * 1.12);
  }
  for (const z of [-0.56, 0.56]) wbox(g, body, 0.04, 2.3, 1.1, 2.94, 1.3, z, 1.6);
  bx(g, frame, 0.05, 2.3, 0.03, 2.95, 1.3, 0);
  for (const z of [-0.85, -0.27, 0.27, 0.85]) { rod(g, steel, 0.025, [3.0, 0.2, z], [3.0, 2.42, z], 6); bx(g, steel, 0.05, 0.05, 0.16, 3.02, 1.2, z + 0.06); }
  const R = rng(hashStr(col));
  for (let i = 0; i < 3; i++) rustBlot(g, (R() - 0.5) * 4.0, 2.48, (R() - 0.5) * 0.9, 0.7 + R() * 0.7, 0.45 + R() * 0.35, 'y', true, i + 1, 'corrugated', col);
  for (let i = 0; i < 2; i++) rustBlot(g, (R() - 0.5) * 4, 0.8 + R() * 0.8, 1.155 * (i ? -1 : 1), 0.5 + R() * 0.4, 0.5 + R() * 0.4, 'z', true, i + 7, 'corrugated', col);
  bx(g, C(shade(col, 1.5), true), 1.4, 0.42, 0.01, -1.6, 2.05, 1.156); bx(g, C(shade(col, 1.5), true), 1.4, 0.42, 0.01, 1.6, 2.05, -1.156);
};
PROPS.tank_v = g => {
  const shell = T('#c4bfb2', 'metal', true), band = T('#8f8a7e', 'metal', true), conc = S('concrete'), dk = C('#3a3d42', true), steel = C('#7f858c', true), haz = S('hazard', true);
  cv(g, conc, 2.15, 2.25, 0.3, 0, 0, 0, 20);
  cv(g, shell, 2, 2, 5.4, 0, 0.3, 0, 20);
  M.add(g, sphereCap(2, 20, 5, PI / 2), shell, 0, 5.7, 0, { sy: 0.24 });
  cv(g, haz, 2.02, 2.02, 0.25, 0, 0.35, 0, 20);
  for (const y of [1.9, 3.5, 5.1]) cv(g, band, 2.03, 2.03, 0.08, 0, y, 0, 20);
  for (const z of [-0.22, 0.22]) bb(g, dk, 0.05, 5.8, 0.05, 2.12, 0.3, z);
  for (let y = 0.6; y < 6; y += 0.36) bx(g, dk, 0.04, 0.04, 0.44, 2.12, y, 0);
  M.add(g, torus(1.9, 0.03, 4, 24), steel, 0, 6.35, 0, { rx: PI / 2 });
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; rod(g, steel, 0.025, [Math.cos(a) * 1.9, 5.85, Math.sin(a) * 1.9], [Math.cos(a) * 1.9, 6.35, Math.sin(a) * 1.9], 4); }
  bb(g, dk, 0.7, 0.18, 0.7, 0, 6.05, 0);
  cxl(g, steel, 0.16, 1.4, -2.6, 0.6, 0.6, 10); cv(g, steel, 0.16, 0.16, 0.76, -3.3, -0.1, 0.6, 10);
  cv(g, dk, 0.02, 0.02, 0.3, -2.8, 0.7, 0.6, 4); M.add(g, torus(0.16, 0.025, 4, 12), C('#b0392c', true), -2.8, 1.0, 0.6, { rx: PI / 2 });
  bx(g, C('#2e3034', true), 0.8, 0.5, 0.01, 0, 3.0, 2.005); bx(g, C('#e8e2d4', true), 0.6, 0.08, 0.012, 0, 3.0, 2.008);
};
PROPS.tank_h = g => {
  const shell = T('#cbc3ab', 'metal', true), band = T('#8f8a7e', 'metal', true), conc = S('concrete'), dk = C('#3a3d42', true), steel = C('#7f858c', true), red = C('#b0392c', true), wh = C('#e8e2d4', true);
  for (const x of [-1.8, 1.8]) bb(g, conc, 0.5, 0.62, 2.1, x, 0, 0);
  cxl(g, shell, 1.08, 4.9, 0, 1.25, 0, 18);
  for (const s of [-1, 1]) M.add(g, sphereCap(1.08, 18, 4, PI / 2), shell, s * 2.45, 1.25, 0, { rz: -s * PI / 2, sy: 0.38 });
  for (const x of [-1.8, 0, 1.8]) cxl(g, band, 1.11, 0.08, x, 1.25, 0, 18);
  bb(g, dk, 2.6, 0.05, 0.6, 0, 2.31, 0);
  for (const x of [-1.2, 0, 1.2]) rod(g, steel, 0.02, [x, 2.36, 0.3], [x, 2.85, 0.3], 4);
  cxl(g, steel, 0.02, 2.6, 0, 2.85, 0.3, 4);
  for (const s of [-1, 1]) bb(g, dk, 0.04, 2.4, 0.04, -1.0 + s * 0.2, 0, 1.2);
  for (let y = 0.3; y < 2.4; y += 0.3) bx(g, dk, 0.4, 0.035, 0.035, -1.0, y, 1.2);
  for (const s of [-1, 1]) { bx(g, wh, 0.62, 0.62, 0.02, 0.7, 1.25, s * 1.085, { rz: PI / 4 }); bx(g, red, 0.48, 0.48, 0.03, 0.7, 1.25, s * 1.086, { rz: PI / 4 }); }
  cxl(g, steel, 0.12, 0.6, -2.95, 0.65, 0.4, 8); cv(g, steel, 0.12, 0.12, 0.7, -3.2, -0.05, 0.4, 8);
};
PROPS.silo = g => {
  const body = T('#a6a9a6', 'corrugated', true), band = C('#6a6e72', true), roof = T('#8f9396', 'metal', true), conc = S('concrete'), dk = C('#3a3d42', true), steel = C('#7f858c', true);
  cv(g, conc, 3.2, 3.3, 0.4, 0, 0, 0, 24);
  cv(g, body, 3, 3, 9.8, 0, 0.4, 0, 24);
  for (const y of [2.6, 5.0, 7.4, 10.0]) cv(g, band, 3.03, 3.03, 0.1, 0, y, 0, 24);
  cv(g, roof, 0.35, 3.15, 1.6, 0, 10.2, 0, 24);
  cv(g, dk, 0.3, 0.35, 0.35, 0, 11.8, 0, 10); M.add(g, M.cone(0.45, 0.3, 10), dk, 0, 12.3, 0);
  for (const s of [-1, 1]) bb(g, dk, 0.05, 10.2, 0.05, 3.12, 0.3, s * 0.22);
  for (let y = 0.7; y < 10.4; y += 0.4) bx(g, dk, 0.04, 0.04, 0.44, 3.12, y, 0);
  for (let y = 3; y < 10.4; y += 1.1) M.add(g, torus(0.4, 0.025, 3, 10, PI), dk, 3.35, y, 0, { rx: PI / 2, rz: -PI / 2 });
  rod(g, steel, 0.25, [-2.8, 8.6, 0], [-5.4, 2.4, 0], 10); cv(g, steel, 0.3, 0.25, 0.5, -5.55, 1.9, 0, 10);
  for (const z of [-0.4, 0.4]) rod(g, dk, 0.05, [-4.6, 0, z], [-4.6, 4.3, z], 5);
};
PROPS.crane = g => {
  const yl = T('#c99a2e', 'metal', true), dk = C('#3a3d42', true), red = T('#a8402e', 'metal', true), cab = T('#d8d4c8', 'metal', true), glass = S('glass_dark', true), cable = C('#1e1f22', true), haz = S('hazard', true), tire = C('#222224');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    bb(g, yl, 0.6, 11.4, 0.6, sx * 3, 0.6, sz * 2, { ts: 1.5 });
    bb(g, dk, 1.6, 0.55, 0.8, sx * 3, 0.05, sz * 2);
    for (const wx of [-0.5, 0.5]) czl(g, tire, 0.25, 0.86, sx * 3 + wx, 0.25, sz * 2, 10);
    bb(g, haz, 1.62, 0.12, 0.82, sx * 3, 0.5, sz * 2, { ts: 0.6 });
  }
  for (const sz of [-1, 1]) { bb(g, yl, 6.6, 0.8, 0.6, 0, 11.2, sz * 2); bb(g, yl, 6.6, 0.45, 0.45, 0, 5.6, sz * 2); beam(g, yl, 0.28, 0.28, [-3, 6.0, sz * 2], [3, 11.2, sz * 2]); beam(g, yl, 0.28, 0.28, [3, 6.0, sz * 2], [-3, 11.2, sz * 2]); }
  for (const sx of [-1, 1]) bb(g, yl, 0.6, 0.8, 4.6, sx * 3, 11.2, 0);
  for (const sz of [-1, 1]) bb(g, yl, 30, 1.0, 0.45, 5, 12, sz * 1.5, { ts: 1.5 });
  for (let x = -9; x <= 19; x += 2) bb(g, yl, 0.25, 0.25, 3.0, x, 12.75, 0);
  wbb(g, cab, 4.5, 2.2, 3.6, -7.4, 13.0, 0, 2);
  bb(g, red, 4.7, 0.2, 3.8, -7.4, 15.2, 0);
  bx(g, glass, 0.02, 0.5, 2.6, -5.14, 14.2, 0);
  for (const sz of [-1, 1]) { beam(g, yl, 0.35, 0.35, [-3, 13, sz * 1.5], [-1, 17.4, sz * 0.6]); beam(g, yl, 0.35, 0.35, [1, 13, sz * 1.5], [-1, 17.4, sz * 0.6]); }
  bb(g, yl, 0.6, 0.5, 1.6, -1, 17.3, 0);
  for (const sz of [-1, 1]) { rod(g, cable, 0.05, [-1, 17.6, sz * 0.6], [19.5, 13, sz * 1.5], 4); rod(g, cable, 0.05, [-1, 17.6, sz * 0.6], [-9.5, 13, sz * 1.5], 4); }
  bb(g, dk, 1.6, 0.6, 3.4, 9, 11.4, 0);
  wbb(g, cab, 1.6, 1.3, 1.5, 9, 10.1, -0.9, 2); bx(g, glass, 0.02, 0.8, 1.3, 9.81, 10.8, -0.9);
  for (const z of [-0.5, 0.5]) rod(g, cable, 0.03, [9, 11.4, z], [9, 5.6, z], 4);
  bb(g, yl, 2.6, 0.35, 1.0, 9, 5.25, 0); bb(g, dk, 0.4, 0.3, 0.5, 9, 5.6, 0);
  M.add(g, M.sphere(0.14, 6, 4), GL('#ff3a2a'), -1, 17.95, 0);
};
PROPS.dish = g => {
  const conc = S('concrete'), ped = T('#c8c4b8', 'metal', true), dk = C('#3a3d42', true), steel = C('#9aa0a6', true), bowl = DS('#dcd9ce', 'metal', true);
  bb(g, conc, 3, 0.8, 3, 0, 0, 0);
  cv(g, ped, 0.55, 0.75, 3.6, 0, 0.8, 0, 12);
  cv(g, dk, 1.0, 1.0, 0.3, 0, 4.4, 0, 14);
  for (const s of [-1, 1]) bb(g, ped, 0.5, 1.6, 0.25, 0, 4.7, s * 0.9);
  bx(g, C('#2e3034', true), 0.02, 0.9, 0.6, 0.76, 2.0, 0);
  const d = G(); d.position.set(0, 6.0, 0); d.rotation.z = -0.75; g.add(d);
  M.add(d, sphereCap(6.5, 28, 5, 0.765), bowl, 0, 6.5, 0, { rx: PI });
  M.add(d, torus(4.48, 0.07, 4, 28), steel, 0, 1.81, 0, { rx: PI / 2 });
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, c = Math.cos(a), s = Math.sin(a); rod(d, dk, 0.06, [0, -0.3, 0], [c * 2.5, 0.25, s * 2.5], 5); rod(d, dk, 0.06, [c * 2.5, 0.25, s * 2.5], [c * 4.45, 1.62, s * 4.45], 5); }
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.5; rod(d, steel, 0.04, [Math.cos(a) * 4.3, 1.75, Math.sin(a) * 4.3], [0, 3.35, 0], 5); }
  cv(d, dk, 0.22, 0.3, 0.5, 0, 3.1, 0, 8);
  cv(d, dk, 0.8, 0.6, 0.6, 0, -0.9, 0, 10);
};
function lattice(g, H, hw, levels, legM, braceM, legW = 0.14, brW = 0.06, colFn) {
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]], P = (sx, sz, y) => [sx * hw(y), y, sz * hw(y)];
  for (const [sx, sz] of corners) for (let i = 0; i < levels.length - 1; i++) beam(g, colFn ? colFn(i) : legM, legW, legW, P(sx, sz, levels[i]), P(sx, sz, levels[i + 1]));
  for (let i = 0; i < levels.length - 1; i++) for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k], [cx_, cz_] = corners[(k + 1) % 4], y0 = levels[i], y1 = levels[i + 1];
    beam(g, braceM, brW, brW, P(ax, az, y0), P(cx_, cz_, y1));
    beam(g, braceM, brW, brW, P(cx_, cz_, y0), P(ax, az, y1));
    beam(g, braceM, brW * 1.2, brW * 1.2, P(ax, az, y1), P(cx_, cz_, y1));
  }
}
PROPS.antenna = g => {
  const red = T('#b0392c', 'metal', true), wh = T('#d8d4c8', 'metal', true), dk = C('#3a3d42', true), conc = S('concrete');
  const hw = y => 1.0 - 0.65 * y / 20;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bb(g, conc, 0.5, 0.3, 0.5, sx, -0.05, sz);
  lattice(g, 20, hw, [0, 4, 8, 12, 16, 20], red, dk, 0.14, 0.06, i => (i % 2 ? wh : red));
  bb(g, dk, 0.9, 0.06, 0.9, 0, 20, 0);
  rod(g, dk, 0.05, [0, 20, 0], [0, 22.6, 0], 6);
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; bx(g, wh, 0.12, 1.1, 0.3, Math.cos(a) * 0.36, 19.3, Math.sin(a) * 0.36, { ry: -a }); }
  M.add(g, sphereCap(0.45, 10, 3, 1.0), DS('#d8d4c8', null, true), 0.42, 16.5, 0, { rz: -PI / 2 });
  M.add(g, M.sphere(0.1, 6, 4), GL('#ff3a2a'), 0, 22.65, 0);
};
PROPS.pylon = g => {
  const st = C('#8a9096', true), dk = C('#666c72', true), ins = C('#3f5266', true), conc = S('concrete');
  const hw = y => (y < 12 ? 1.5 - 0.95 * y / 12 : 0.55 - 0.15 * (y - 12) / 4);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) bb(g, conc, 0.6, 0.3, 0.6, sx * 1.5, -0.05, sz * 1.5);
  lattice(g, 16, hw, [0, 3, 6, 9, 12, 16], st, dk, 0.13, 0.06);
  for (const [y, half] of [[11.6, 4.2], [14.6, 3.0]]) {
    for (const sx of [-1, 1]) beam(g, st, 0.12, 0.12, [sx * 0.42, y, -half], [sx * 0.42, y, half]);
    for (let z = -half; z <= half + 0.01; z += half / 3) beam(g, dk, 0.05, 0.05, [-0.42, y, z], [0.42, y, z]);
    for (const sz of [-1, 1]) {
      beam(g, dk, 0.06, 0.06, [0, y + 1.3, sz * 0.4], [0, y, sz * half]);
      cv(g, ins, 0.04, 0.04, 0.95, 0, y - 0.95, sz * (half - 0.15), 6);
      for (let j = 0; j < 4; j++) cv(g, ins, 0.12, 0.12, 0.05, 0, y - 0.9 + j * 0.2, sz * (half - 0.15), 8);
      bx(g, dk, 0.3, 0.06, 0.06, 0, y - 1.0, sz * (half - 0.15));
    }
  }
  rod(g, st, 0.05, [0, 16, 0], [0, 16.4, 0], 4);
};
PROPS.cooling_tower = g => {
  const conc = DS('#b2aea4', 'concrete', true), soot = DS('#6c6964', 'concrete', true), base = T('#8a867e', 'concrete'), water = C('#2a3a3e'), leg = S('concrete_dark', true);
  const prof = [[9.0, 1.6], [8.1, 4.5], [7.0, 8.5], [6.3, 12.5], [6.2, 15.0], [6.5, 17.2], [6.8, 18.0]];
  const lg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 36);
  const uv = lg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 22, uv.getY(i) * 4.5);
  M.add(g, lg, conc);
  const sg = new THREE.LatheGeometry([[6.27, 15.6], [6.52, 17.2], [6.83, 18.0]].map(([r, y]) => new THREE.Vector2(r, y)), 36);
  const su = sg.attributes.uv; for (let i = 0; i < su.count; i++) su.setXY(i, su.getX(i) * 22, su.getY(i) * 1);
  M.add(g, sg, soot);
  M.add(g, torus(6.82, 0.18, 4, 36), S('concrete_dark', true), 0, 18.0, 0, { rx: PI / 2 });
  cv(g, base, 9.6, 9.7, 0.35, 0, 0, 0, 36);
  cv(g, water, 8.7, 8.7, 0.02, 0, 0.35, 0, 36);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * TAU, d = TAU / 96, f = [Math.cos(a) * 9.2, 0.35, Math.sin(a) * 9.2];
    beam(g, leg, 0.32, 0.32, f, [Math.cos(a - d) * 8.95, 1.7, Math.sin(a - d) * 8.95]);
    beam(g, leg, 0.32, 0.32, f, [Math.cos(a + d) * 8.95, 1.7, Math.sin(a + d) * 8.95]);
  }
};
PROPS.chimney = g => {
  const br = S('brick', true), wh = T('#e4e0d4', 'concrete', true), red = T('#b0392c', 'concrete', true), conc = S('concrete'), dk = C('#2a2a2c', true);
  bb(g, conc, 3.4, 1.0, 3.4, 0, 0, 0);
  cv(g, br, 1.05, 1.5, 20, 0, 1.0, 0, 14);
  for (let i = 0; i < 4; i++) { const y = 21 + i, r0 = 1.05 - i * 0.03; cv(g, i % 2 ? wh : red, r0 - 0.03, r0, 1, 0, y, 0, 14); }
  cv(g, dk, 1.02, 1.02, 0.25, 0, 24.85, 0, 14); cv(g, C('#111113'), 0.8, 0.8, 0.02, 0, 25.1, 0, 14);
  for (const s of [-1, 1]) beam(g, dk, 0.05, 0.05, [1.56, 1.0, s * 0.2], [1.07, 25, s * 0.2]);
  for (let y = 1.5; y < 25; y += 0.8) { const r = 1.5 - (y - 1) / 20 * 0.45 + 0.07; bx(g, dk, 0.04, 0.04, 0.44, Math.max(r, 1.08), y, 0); }
  for (const s of [-1, 1]) M.add(g, M.sphere(0.09, 6, 4), GL('#ff3a2a'), s * 1.06, 24.6, 0);
};
PROPS.smokestack = g => {
  const st = T('#7a5040', 'metal', true), ring = C('#3a3330', true), soot = C('#2a2522', true), conc = S('concrete');
  bb(g, conc, 2.4, 0.8, 2.4, 0, 0, 0);
  cv(g, st, 0.95, 1.0, 10.8, 0, 0.8, 0, 14);
  cv(g, soot, 0.95, 0.95, 2.4, 0, 11.6, 0, 14);
  for (const y of [3.5, 7.0, 10.5, 13.8]) cv(g, ring, 1.06, 1.06, 0.14, 0, y, 0, 14);
  cv(g, C('#0e0e10'), 0.86, 0.86, 0.02, 0, 14.0, 0, 14);
  for (const s of [-1, 1]) bb(g, ring, 0.04, 13, 0.04, 1.03, 0.8, s * 0.2);
  for (let y = 1.2; y < 13.8; y += 0.5) bx(g, ring, 0.04, 0.035, 0.44, 1.03, y, 0);
};
PROPS.water_tower = g => {
  const wood = T('#8a6a48', 'log', true), band = C('#3a3633', true), roof = T('#5e4a3a', 'plank', true), legM = S('metal_dark', true), dk = C('#2c2e33', true), conc = S('concrete');
  const L = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of L) { bb(g, conc, 0.6, 0.3, 0.6, sx * 1.8, -0.05, sz * 1.8); rodT(g, legM, 0.16, 0.13, [sx * 1.8, 0, sz * 1.8], [sx * 1.6, 7.6, sz * 1.6], 8); }
  for (const [y0, y1] of [[0.4, 3.9], [3.9, 7.4]]) for (let k = 0; k < 4; k++) {
    const [ax, az] = L[k], [bx_, bz] = L[(k + 1) % 4], w0 = 1.8 - 0.2 * y0 / 7.6, w1 = 1.8 - 0.2 * y1 / 7.6;
    rod(g, dk, 0.03, [ax * w0, y0, az * w0], [bx_ * w1, y1, bz * w1], 4); rod(g, dk, 0.03, [bx_ * w0, y0, bz * w0], [ax * w1, y1, az * w1], 4);
    rod(g, dk, 0.04, [ax * w1, y1, az * w1], [bx_ * w1, y1, bz * w1], 4);
  }
  cv(g, legM, 0.15, 0.15, 7.6, 0, 0, 0, 8);
  cv(g, legM, 2.7, 2.7, 0.15, 0, 7.5, 0, 16);
  M.add(g, torus(2.75, 0.03, 3, 24), dk, 0, 8.4, 0, { rx: PI / 2 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; rod(g, dk, 0.02, [Math.cos(a) * 2.75, 7.65, Math.sin(a) * 2.75], [Math.cos(a) * 2.75, 8.4, Math.sin(a) * 2.75], 4); }
  cv(g, wood, 2.45, 2.5, 3.3, 0, 7.65, 0, 18);
  for (const y of [8.1, 9.1, 10.1, 10.8]) cv(g, band, 2.52, 2.52, 0.06, 0, y, 0, 18);
  cv(g, roof, 0.15, 2.7, 1.2, 0, 10.95, 0, 18);
  cv(g, dk, 0.06, 0.08, 0.3, 0, 12.1, 0, 6);
  for (const s of [-1, 1]) bb(g, dk, 0.04, 7.6, 0.04, 1.95, 0, s * 0.2);
  for (let y = 0.4; y < 7.6; y += 0.35) bx(g, dk, 0.035, 0.035, 0.42, 1.95, y, 0);
};
PROPS.pipes = g => {
  const pm = T('#8f8a80', 'metal'), yl = T('#c9a032', 'metal'), dk = C('#3a3d42'), red = C('#b0392c'), conc = S('concrete');
  for (const x of [-2.5, 0, 2.5]) { for (const z of [-0.42, 0.42]) bb(g, dk, 0.1, 0.72, 0.1, x, 0.15, z); bb(g, dk, 0.14, 0.1, 1.0, x, 0.82, 0); bb(g, conc, 0.4, 0.15, 1.0, x, 0, 0); }
  cxl(g, pm, 0.22, 6, 0, 1.15, -0.2, 12); cxl(g, yl, 0.14, 6, 0, 1.06, 0.28, 10);
  for (const x of [-2.9, -1.0, 1.0, 2.9]) { cxl(g, dk, 0.27, 0.08, x, 1.15, -0.2, 12); cxl(g, dk, 0.18, 0.06, x, 1.06, 0.28, 10); }
  cv(g, dk, 0.03, 0.03, 0.22, 1.5, 1.35, -0.2, 6);
  M.add(g, torus(0.17, 0.025, 4, 12), red, 1.5, 1.6, -0.2, { rx: PI / 2 });
  for (let i = 0; i < 2; i++) bx(g, red, 0.32, 0.025, 0.025, 1.5, 1.6, -0.2, { ry: i * PI / 2 });
};
PROPS.generator = g => {
  const yl = T('#c9a032', 'metal'), dk = C('#2c2e33'), md = S('metal_dark'), haz = S('hazard'), grill = C('#1c1d20');
  bb(g, dk, 2.0, 0.15, 1.2, 0, 0, 0);
  bb(g, haz, 2.02, 0.08, 1.22, 0, 0.04, 0, { ts: 0.6 });
  wbb(g, yl, 1.7, 1.0, 1.0, -0.05, 0.15, 0, 1.2);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) bx(g, grill, 0.18, 0.04, 0.01, -0.6 + i * 0.22, 0.75, s * 0.505);
  bx(g, grill, 0.02, 0.8, 0.8, 0.81, 0.65, 0);
  for (let i = 0; i < 5; i++) bx(g, md, 0.03, 0.03, 0.8, 0.83, 0.33 + i * 0.16, 0);
  bb(g, md, 0.4, 0.3, 0.3, -0.5, 1.15, -0.2);
  cv(g, md, 0.06, 0.06, 0.5, -0.7, 1.15, 0.3, 8); M.add(g, M.cone(0.09, 0.08, 8), md, -0.7, 1.69, 0.3);
  bx(g, C('#3a3d42'), 0.4, 0.3, 0.02, 0.2, 0.75, 0.51);
  for (let i = 0; i < 3; i++) bx(g, GL(['#4ae05a', '#ffb02a', '#ff4a3a'][i]), 0.04, 0.04, 0.01, 0.08 + i * 0.12, 0.82, 0.522);
  cv(g, C('#c0302a'), 0.06, 0.06, 0.04, 0.6, 1.15, -0.3, 8);
  rod(g, C('#1c1d20'), 0.025, [-0.85, 0.3, 0.45], [-1.3, 0.02, 0.9], 5);
};
PROPS.transformer = g => {
  const gr = T('#6f7a6a', 'metal', true), fin = C('#5c6658', true), cer = C('#7a3e2c', true), conc = S('concrete'), steel = C('#a8adb2', true), yl = C('#d0a838', true);
  bb(g, conc, 1.5, 0.15, 1.5, 0, 0, 0);
  wbb(g, gr, 1.1, 1.3, 1.0, 0, 0.15, 0, 1);
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) bb(g, fin, 0.03, 1.0, 0.18, -0.42 + i * 0.14, 0.3, s * 0.59);
  bb(g, C('#5a6456', true), 1.16, 0.06, 1.06, 0, 1.45, 0);
  for (let i = 0; i < 3; i++) { const x = -0.35 + i * 0.35; for (let j = 0; j < 4; j++) cv(g, cer, 0.07, 0.07, 0.06, x, 1.52 + j * 0.13, 0, 8); cv(g, cer, 0.03, 0.03, 0.55, x, 1.5, 0, 6); cv(g, steel, 0.04, 0.04, 0.08, x, 2.05, 0, 6); }
  bx(g, yl, 0.02, 0.28, 0.28, 0.56, 0.95, 0, { rx: PI / 4 }); bx(g, C('#1c1d20', true), 0.022, 0.12, 0.04, 0.565, 0.95, 0, { rz: 0.3 });
  cv(g, C('#3a3d42'), 0.05, 0.05, 0.7, -0.4, 0.15, -0.45, 6);
};
PROPS.conveyor = g => {
  const fr = T('#c9a032', 'metal'), dk = C('#2c2e33'), belt = C('#1e1f21'), steel = C('#8a8f94'), rock = S('rock'), md = S('metal_dark');
  for (const s of [-1, 1]) { bb(g, fr, 6, 0.16, 0.1, 0, 1.15, s * 0.5); bb(g, md, 6, 0.18, 0.03, 0, 1.31, s * 0.48); }
  bb(g, belt, 5.9, 0.05, 0.88, 0, 1.24, 0);
  for (const x of [-2.95, 2.95]) czl(g, steel, 0.12, 0.9, x, 1.2, 0, 10);
  for (const x of [-2.6, 0, 2.6]) { for (const s of [-1, 1]) bb(g, dk, 0.1, 1.15, 0.1, x, 0, s * 0.45); beam(g, dk, 0.05, 0.05, [x, 0.15, -0.45], [x, 1.1, 0.45]); bb(g, dk, 0.1, 0.06, 0.9, x, 0.4, 0); }
  bb(g, fr, 0.5, 0.4, 0.4, -2.7, 0.7, 0.75); cxl(g, md, 0.12, 0.3, -2.9, 1.0, 0.75, 8);
  const R = rng(5);
  for (let i = 0; i < 9; i++) M.add(g, M.ico(0.1 + R() * 0.06, 0), rock, -2.2 + i * 0.55 + R() * 0.2, 1.33, (R() - 0.5) * 0.5, { ry: R() * 3, sy: 0.7 });
};
PROPS.crusher = g => {
  const yl = T('#c9a032', 'metal', true), dk = C('#2c2e33', true), md = S('metal_dark', true), haz = S('hazard', true), rock = S('rock'), rustM = S('rust', true);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { bb(g, md, 0.3, 3.1, 0.3, sx * 1.6, 0, sz * 1.6, { ts: 1 }); bb(g, S('concrete'), 0.6, 0.2, 0.6, sx * 1.6, -0.05, sz * 1.6); }
  for (const s of [-1, 1]) { beam(g, dk, 0.12, 0.12, [-1.6, 0.3, s * 1.6], [1.6, 2.8, s * 1.6]); beam(g, dk, 0.12, 0.12, [s * 1.6, 0.3, -1.6], [s * 1.6, 2.8, 1.6]); }
  wbb(g, md, 2.4, 1.5, 2.4, 0, 1.3, 0, 1.5);
  czl(g, yl, 1.0, 0.18, 0.2, 2.0, 1.32, 16); czl(g, dk, 0.25, 0.25, 0.2, 2.0, 1.35, 8);
  for (let i = 0; i < 4; i++) bx(g, yl, 1.9, 0.12, 0.08, 0.2, 2.0, 1.36, { rz: i * PI / 4 });
  M.add(g, openFrustum(2.85, 1.2, 2.1, 4), DS('#c9a032', 'metal', true), 0, 3.85, 0, { ry: PI / 4 });
  cv(g, C('#26272a', true), 1.2, 1.2, 0.02, 0, 2.8, 0, 4, { ry: PI / 4 });
  for (const s of [-1, 1]) { bb(g, haz, 4.04, 0.16, 0.08, 0, 4.82, s * 2.0, { ts: 0.6 }); bb(g, haz, 0.08, 0.16, 4.04, s * 2.0, 4.82, 0, { ts: 0.6 }); }
  bx(g, md, 2.4, 0.08, 1.0, 2.2, 0.75, 0, { rz: -0.45 }); for (const s of [-1, 1]) bx(g, md, 2.4, 0.3, 0.05, 2.2, 0.85, s * 0.5, { rz: -0.45 });
  const R = rng(17);
  for (let i = 0; i < 12; i++) M.add(g, M.ico(0.16 + R() * 0.14, 0), rock, 3.3 + (R() - 0.5) * 1.0, 0.1 + R() * 0.25, (R() - 0.5) * 1.3, { ry: R() * 3, sy: 0.7 });
  for (let i = 0; i < 10; i++) { const a = R() * TAU, d = R() * 0.9; M.add(g, M.ico(0.2 + R() * 0.12, 0), rock, Math.cos(a) * d, 3.0 + d * 0.5 + R() * 0.2, Math.sin(a) * d, { ry: R() * 3 }); }
  rustBlot(g, 1.205, 1.8, -0.4, 0.9, 0.8, 'x', true, 48);
};

// ---- vehicles & wrecks
PROPS.car = (g, o) => {
  const paint = T(o.color || '#5d7487', 'metal'), rustM = S('rust'), dk = C('#1e1e20'), glass = S('glass_dark'), chrome = C('#9aa0a6'), tire = C('#232325'), light = C('#e8e2c8'), tail = C('#a8302a');
  bb(g, dk, 3.4, 0.2, 1.5, 0, 0.18, 0);
  M.add(g, prism([[-2.1, 0.32], [2.1, 0.32], [2.12, 0.72], [1.95, 0.86], [0.95, 0.94], [-1.55, 0.96], [-2.08, 0.9]], 1.74), paint);
  M.add(g, prism([[0.9, 0.93], [0.32, 1.36], [-0.95, 1.38], [-1.5, 0.95]], 1.52), glass);
  bx(g, paint, 1.24, 0.05, 1.54, -0.32, 1.38, 0);
  for (const s of [-1, 1]) {
    beam(g, paint, 0.08, 0.06, [0.88, 0.95, s * 0.735], [0.32, 1.37, s * 0.735]);
    bx(g, paint, 0.1, 0.44, 0.06, -0.3, 1.16, s * 0.735);
    beam(g, paint, 0.1, 0.06, [-1.46, 0.96, s * 0.735], [-0.93, 1.37, s * 0.735]);
    for (const x of [-1.35, 1.35]) { czl(g, tire, 0.34, 0.24, x, 0.34, s * 0.8, 12); czl(g, chrome, 0.16, 0.25, x, 0.34, s * 0.8, 8); }
    bx(g, light, 0.04, 0.1, 0.26, 2.12, 0.65, s * 0.6); bx(g, tail, 0.04, 0.1, 0.26, -2.1, 0.75, s * 0.6);
    bx(g, dk, 0.01, 0.5, 0.005, 0.45, 0.62, s * 0.872); bx(g, dk, 0.01, 0.5, 0.005, -0.75, 0.62, s * 0.872);
  }
  for (const s of [-1, 1]) bb(g, dk, 0.14, 0.16, 1.8, s * 2.13, 0.3, 0);
  rustBlot(g, 1.5, 0.9, 0.25, 0.6, 0.5, 'y', false, 21); rustBlot(g, -0.4, 1.405, -0.3, 0.5, 0.45, 'y', false, 22);
  rustBlot(g, -1.4, 0.6, 0.871, 0.6, 0.3, 'z', false, 23); rustBlot(g, 0.9, 0.55, -0.871, 0.5, 0.3, 'z', false, 24);
};
PROPS.truck = (g, o) => {
  const paint = T(o.color || '#6b4a3a', 'metal', true), box = T('#c8c2b0', 'corrugated', true), dk = C('#1e1e20'), glass = S('glass_dark', true), tire = C('#232325'), chrome = C('#9aa0a6'), rustM = S('rust', true), light = C('#e8e2c8');
  bb(g, dk, 6.6, 0.3, 1.6, 0, 0.5, 0);
  M.add(g, prism([[1.6, 0.75], [3.5, 0.75], [3.52, 1.6], [3.3, 2.6], [2.9, 2.95], [1.6, 2.95]], 2.3), paint);
  bx(g, glass, 0.04, 0.82, 2.0, 3.43, 2.12, 0, { rz: 0.2 });
  for (const s of [-1, 1]) { bx(g, glass, 0.9, 0.6, 0.02, 2.45, 2.3, s * 1.155); bx(g, dk, 0.08, 0.25, 0.1, 3.2, 2.2, s * 1.25); }
  bx(g, dk, 0.04, 0.5, 1.6, 3.53, 1.1, 0);
  for (let i = 0; i < 4; i++) bx(g, chrome, 0.02, 0.04, 1.5, 3.56, 0.95 + i * 0.12, 0);
  for (const s of [-1, 1]) bx(g, light, 0.04, 0.16, 0.24, 3.54, 1.1, s * 0.92);
  bb(g, dk, 0.2, 0.25, 2.3, 3.55, 0.45, 0);
  wbb(g, box, 4.9, 2.4, 2.4, -1.05, 0.7, 0, 2);
  bx(g, dk, 0.02, 2.3, 0.03, -3.51, 1.9, 0);
  for (const s of [-1, 1]) bx(g, C('#3a3d42', true), 4.9, 0.08, 0.02, -1.05, 3.06, s * 1.2);
  for (const [x, w] of [[2.7, 0.3], [-1.5, 0.5], [-2.7, 0.5]]) for (const s of [-1, 1]) { czl(g, tire, 0.5, w, x, 0.5, s * (1.25 - w / 2), 12); czl(g, chrome, 0.24, w + 0.01, x, 0.5, s * (1.25 - w / 2), 8); }
  cxl(g, chrome, 0.22, 0.9, 1.0, 0.8, 1.0, 10);
  cv(g, chrome, 0.06, 0.06, 1.6, 1.5, 1.5, -1.0, 6);
  rustBlot(g, -2.0, 3.1, 0.3, 1.2, 0.8, 'y', true, 25); rustBlot(g, 2.2, 1.3, 1.151, 0.7, 0.6, 'z', true, 26); rustBlot(g, -0.5, 1.4, 1.201, 1.0, 0.8, 'z', true, 27);
};
PROPS.bus = (g, o) => {
  const paint = T(o.color || '#c79a3a', 'metal', true), roof = T('#d8d4c8', 'metal', true), dk = C('#1e1e20', true), glass = S('glass_dark', true), tire = C('#232325'), chrome = C('#9aa0a6'), rustM = S('rust', true), light = C('#e8e2c8');
  bb(g, dk, 8.6, 0.3, 2.2, 0, 0.3, 0);
  wbb(g, paint, 9.8, 2.2, 2.5, 0, 0.6, 0, 2);
  bb(g, roof, 9.7, 0.18, 2.4, 0, 2.8, 0);
  bb(g, C('#9a968c', true), 1.0, 0.1, 0.8, -1.5, 2.98, 0);
  for (const s of [-1, 1]) {
    bx(g, glass, 8.2, 0.78, 0.02, -0.5, 2.15, s * 1.256);
    for (let x = -4.4; x <= 3.6; x += 1.0) bx(g, paint, 0.1, 0.78, 0.03, x, 2.15, s * 1.258);
    bx(g, dk, 9.8, 0.08, 0.02, 0, 1.45, s * 1.256);
    for (const x of [3.2, -2.9]) { czl(g, tire, 0.5, 0.32, x, 0.5, s * 1.12, 12); czl(g, chrome, 0.24, 0.33, x, 0.5, s * 1.12, 8); }
  }
  bx(g, glass, 0.03, 1.0, 2.2, 4.91, 2.0, 0);
  bx(g, glass, 0.03, 1.6, 0.8, 4.6, 1.45, 1.26);
  for (const s of [-1, 1]) bx(g, light, 0.03, 0.18, 0.3, 4.91, 1.0, s * 0.9);
  bb(g, dk, 0.16, 0.25, 2.5, 4.95, 0.5, 0); bb(g, dk, 0.16, 0.25, 2.5, -4.95, 0.5, 0);
  bx(g, C('#1c1d20', true), 0.02, 0.4, 1.8, 4.91, 2.65, 0);
  rustBlot(g, 2.0, 2.98, 0.4, 1.6, 1.0, 'y', true, 28); rustBlot(g, -3.0, 1.0, 1.252, 1.0, 0.7, 'z', true, 29); rustBlot(g, 1.5, 0.95, -1.252, 0.7, 0.5, 'z', true, 30); rustBlot(g, -2.5, 2.98, -0.5, 1.0, 0.7, 'y', true, 31);
};
PROPS.heli_wreck = g => {
  const ol = T('#4f5a3a', 'metal', true), od = T('#3e472d', 'metal', true), dk = C('#262722', true), glass = S('glass_dark', true), burn = C('#3a352c'), steel = C('#5a5e62', true), char = C('#1e1c1a', true);
  cv(g, burn, 2.5, 2.8, 0.015, 0.5, 0, 0.2, 9);
  const w = G(); w.position.set(0.8, 0.05, 0); w.rotation.set(0.2, 0.2, 0.05); g.add(w);
  M.add(w, prism([[3.3, 0.95], [2.8, 0.4], [-1.4, 0.35], [-2.1, 0.9], [-1.9, 1.85], [0.9, 2.0], [2.4, 1.7]], 1.5), ol);
  M.add(w, M.sphere(1, 10, 6), glass, 2.15, 1.42, 0, { sx: 1.15, sy: 0.62, sz: 0.66 });
  cxl(w, od, 0.42, 2.1, -0.6, 2.0, 0, 10);
  M.add(w, M.cone(0.42, 0.5, 10), dk, -1.9, 2.0, 0, { rz: PI / 2 });
  cv(w, dk, 0.1, 0.1, 0.45, -0.3, 2.3, 0, 8); cv(w, dk, 0.3, 0.3, 0.12, -0.3, 2.72, 0, 8);
  beam(w, dk, 0.34, 0.05, [-0.3, 2.82, 0], [1.4, 1.6, 3.4]); beam(w, dk, 0.34, 0.05, [1.4, 1.6, 3.4], [2.0, 0.1, 4.8]);
  beam(w, dk, 0.34, 0.05, [-0.3, 2.82, 0], [-2.2, 2.6, -1.4]);
  rodT(w, ol, 0.36, 0.26, [-1.9, 1.35, 0], [-4.0, 1.55, 0], 8);
  bx(w, char, 1.4, 0.8, 0.02, 0.4, 1.2, 0.76); bx(w, char, 1.0, 0.5, 0.02, -0.9, 1.4, -0.76); bx(w, char, 0.9, 0.02, 0.9, -0.3, 2.03, 0.1);
  rod(w, dk, 0.05, [1.8, 0.0, 0.85], [-1.2, 0.0, 0.85], 6); rod(w, dk, 0.05, [1.8, 0.0, 0.85], [2.2, 0.25, 0.85], 6);
  for (const x of [-0.7, 1.2]) rod(w, dk, 0.04, [x, 0.0, 0.85], [x + 0.1, 0.5, 0.5], 5);
  rod(w, dk, 0.05, [1.6, 0.2, -0.85], [-1.0, -0.15, -1.15], 6);
  rodT(g, ol, 0.24, 0.15, [-4.2, 0.25, 0.9], [-7.3, 0.3, 1.9], 8);
  M.add(g, prism([[0, 0], [0.9, 0], [0.45, 1.3], [-0.25, 1.3]], 0.08), ol, -7.6, 0.25, 1.9, { ry: -0.3, rx: 1.25 });
  for (let i = 0; i < 2; i++) bx(g, dk, 1.3, 0.04, 0.14, -7.0, 0.35, 2.4, { ry: 0.4 + i * PI / 2 });
  bx(g, dk, 5.0, 0.05, 0.34, 2.4, 0.03, -2.9, { ry: 0.35 }); bx(g, dk, 2.6, 0.05, 0.34, -2.3, 0.03, -2.1, { ry: -0.9 }); bx(g, dk, 1.6, 0.05, 0.34, -3.8, 0.03, -0.9, { ry: -0.4 });
  for (let i = 0; i < 6; i++) M.add(g, M.ico(0.12 + i * 0.02, 0), steel, -2 + i * 0.9, 0.06, 1.6 + (i % 2) * 0.6, { ry: i });
};
PROPS.boat = g => {
  const hullTop = T('#3a5f7f', 'metal', true), hullBot = T('#7a2e24', 'metal', true), wh = T('#d8d4c8', 'metal', true), deck = T('#8a7558', 'plank', true), dk = C('#2a2c30', true), glass = S('glass_dark', true), orange = C('#d27a35', true), net = C('#4a5248', true), rope = C('#a08a60', true);
  const outline = [[-4, -1.3], [1.2, -1.5], [2.8, -1.1], [4, 0], [2.8, 1.1], [1.2, 1.5], [-4, 1.3]];
  const hull = (h, k) => { const pts = outline.map(([x, z]) => [x, -z]); const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(q => new THREE.Vector2(q[0], q[1]))), { depth: h, bevelEnabled: false }); geo.rotateX(-PI / 2); const a = geo.attributes.position; for (let i = 0; i < a.count; i++) if (a.getY(i) < 0.01) { a.setZ(i, a.getZ(i) * k); a.setX(i, a.getX(i) * (a.getX(i) > 0 ? 0.88 : 1)); } geo.computeVertexNormals(); const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5); return geo; };
  M.add(g, hull(0.7, 0.5), hullBot, 0, 0, 0);
  M.add(g, hull(1.0, 0.98), hullTop, 0, 0.7, 0, { sx: 1.0 });
  M.add(g, prism([[-3.9, -1.22], [1.2, -1.4], [2.7, -1.0], [3.85, 0], [2.7, 1.0], [1.2, 1.4], [-3.9, 1.22]].map(([x, z]) => [x, -z]), 0.06), deck, 0, 1.62, 0, { rx: -PI / 2 });
  M.add(g, prism(outline.map(([x, z]) => [x * 1.005, -z * 1.02]), 0.1), wh, 0, 1.7, 0, { rx: -PI / 2, sy: 1 });
  wbb(g, wh, 1.8, 1.6, 1.8, -1.4, 1.68, 0, 1.5);
  bb(g, C('#c8c4b8', true), 2.0, 0.1, 2.0, -1.4, 3.28, 0);
  bx(g, glass, 0.02, 0.5, 1.4, -0.49, 2.85, 0); for (const s of [-1, 1]) bx(g, glass, 1.2, 0.45, 0.02, -1.4, 2.85, s * 0.91);
  cv(g, dk, 0.07, 0.07, 0.6, -1.9, 3.38, 0.5, 6);
  M.add(g, torus(0.26, 0.06, 5, 12), orange, -1.0, 2.3, 0.92);
  cv(g, dk, 0.07, 0.06, 3.4, 1.6, 1.7, 0, 6);
  rod(g, dk, 0.05, [1.6, 3.6, 0], [-0.4, 2.2, 0], 5);
  for (let i = 0; i < 3; i++) M.add(g, M.sphere(0.13, 6, 4), orange, -3.2 + i * 0.35, 1.84, -0.8 + i * 0.1);
  M.add(g, M.ico(0.7, 1), net, -3.0, 1.75, 0.3, { sx: 1.1, sy: 0.35, sz: 0.9 });
  M.add(g, torus(0.22, 0.06, 4, 10), rope, 2.4, 1.72, 0.3, { rx: PI / 2 });
  for (const s of [-1, 1]) bx(g, C('#e8e2d4', true), 0.6, 0.12, 0.01, 2.5, 1.35, s * 1.02);
};
PROPS.train_car = g => {
  const body = T('#7a3a2c', 'corrugated', true), frame = C('#2a2522', true), dk = C('#1c1d20'), roof = T('#6a3428', 'metal', true), steel = C('#6a6e72'), wh = C('#d8d0bc', true), rustM = S('rust', true);
  bb(g, frame, 11.8, 0.35, 2.6, 0, 0.75, 0);
  wbb(g, body, 11.6, 2.5, 2.8, 0, 1.1, 0, 2);
  bb(g, roof, 11.8, 0.12, 3.0, 0, 3.6, 0);
  bb(g, T('#6e5a44', 'plank', true), 11.0, 0.05, 0.5, 0, 3.72, 0);
  for (const s of [-1, 1]) {
    wbox(g, T('#6e3326', 'corrugated', true), 2.4, 2.3, 0.05, 0.6, 2.2, s * 1.42, 2);
    bb(g, frame, 5.6, 0.08, 0.06, 0.6, 3.4, s * 1.44); bb(g, frame, 5.6, 0.08, 0.06, 0.6, 1.0, s * 1.44);
    bx(g, wh, 1.8, 0.35, 0.01, -3.6, 3.0, s * 1.405); bx(g, wh, 0.9, 0.2, 0.01, 3.8, 1.5, s * 1.405);
    rustBlot(g, 3.2, 2.5, s * 1.404, 1.2, 0.8, 'z', true, 40 + s);
    for (const x of [-4.2, 4.2]) for (const dx of [-0.7, 0.7]) { czl(g, dk, 0.42, 0.14, x + dx, 0.42, s * 0.72, 12); }
  }
  for (const x of [-4.2, 4.2]) { bb(g, steel, 2.2, 0.3, 1.9, x, 0.35, 0); czl(g, steel, 0.06, 1.8, x - 0.7, 0.42, 0, 6); czl(g, steel, 0.06, 1.8, x + 0.7, 0.42, 0, 6); }
  for (const s of [-1, 1]) { bb(g, dk, 0.5, 0.2, 0.3, s * 6.05, 0.75, 0); for (const z of [-1.2, 1.2]) { bb(g, frame, 0.04, 2.4, 0.04, s * 5.82, 1.0, z); for (let y = 1.3; y < 3.4; y += 0.35) bx(g, frame, 0.04, 0.03, 0.3, s * 5.84, y, z * 0.88); } }
};
PROPS.locomotive = g => {
  const yl = T('#c98a2e', 'metal', true), bl = T('#2e3a48', 'metal', true), dk = C('#1c1d20', true), steel = C('#6a6e72'), glass = S('glass_dark', true), rail = C('#d8d4c8', true), light = GL('#ffe7a8');
  bb(g, dk, 13.6, 0.4, 2.9, 0, 1.0, 0);
  bb(g, bl, 14, 0.2, 3.0, 0, 1.4, 0);
  wbb(g, yl, 9.6, 2.0, 2.2, -1.6, 1.6, 0, 2);
  wbb(g, yl, 2.6, 2.6, 3.0, 4.6, 1.6, 0, 2);
  bb(g, bl, 2.8, 0.2, 3.1, 4.6, 4.2, 0);
  wbb(g, yl, 0.8, 1.4, 2.2, 6.3, 1.6, 0, 2);
  bx(g, glass, 0.02, 0.8, 2.4, 5.91, 3.5, 0); for (const s of [-1, 1]) bx(g, glass, 1.4, 0.7, 0.02, 4.6, 3.5, s * 1.51);
  for (const s of [-1, 1]) { bb(g, bl, 9.6, 0.25, 0.02, -1.6, 2.1, s * 1.11); bx(g, bl, 2.6, 0.25, 0.02, 4.6, 2.35, s * 1.51); }
  for (let x = -5.8; x < 2.6; x += 1.4) bx(g, C('#3a3d42', true), 0.9, 0.02, 1.6, x, 3.61, 0);
  for (const x of [-5.6, -3.2, -0.8]) { cv(g, dk, 0.45, 0.45, 0.08, x, 3.6, 0, 12); }
  cv(g, dk, 0.14, 0.14, 0.5, 1.6, 3.6, 0.4, 8); cv(g, dk, 0.14, 0.14, 0.5, 2.1, 3.6, 0.4, 8);
  for (const s of [-1, 1]) { cxl(g, rail, 0.025, 9.6, -1.6, 2.6, s * 1.4, 4); for (let x = -6.2; x <= 3.0; x += 1.6) rod(g, rail, 0.02, [x, 1.5, s * 1.4], [x, 2.6, s * 1.4], 4); }
  cxl(g, steel, 0.7, 4.4, -1.0, 0.65, 0, 12);
  for (const x of [-4.8, 3.8]) { bb(g, steel, 3.2, 0.35, 2.0, x, 0.3, 0); for (const dx of [-1.1, 0, 1.1]) for (const s of [-1, 1]) czl(g, dk, 0.45, 0.14, x + dx, 0.45, s * 0.72, 12); }
  for (const s of [-1, 1]) bb(g, dk, 0.4, 0.25, 0.3, s * 7.0, 0.95, 0);
  bx(g, light, 0.04, 0.24, 0.24, 6.71, 2.6, 0); for (const s of [-1, 1]) bx(g, light, 0.04, 0.14, 0.14, 7.01, 1.25, s * 1.1);
  bb(g, S('hazard'), 0.1, 0.3, 3.0, 7.0, 1.1, 0, { ts: 0.6 }); bb(g, S('hazard'), 0.1, 0.3, 3.0, -7.0, 1.1, 0, { ts: 0.6 });
};
PROPS.rails = g => {
  const ballast = S('gravel'), sleeper = T('#5e4a3a', 'plank'), rail = C('#5e6266'), top = C('#a8acb0');
  bb(g, ballast, 6.0, 0.12, 2.6, 0, 0, 0);
  for (let i = 0; i < 10; i++) bb(g, sleeper, 0.24, 0.1, 2.3, -2.7 + i * 0.6, 0.1, 0);
  for (const s of [-1, 1]) { bb(g, rail, 6.0, 0.1, 0.08, 0, 0.2, s * 0.72); bb(g, top, 6.0, 0.02, 0.07, 0, 0.3, s * 0.72); for (let i = 0; i < 10; i++) bx(g, C('#3a3d42'), 0.14, 0.03, 0.18, -2.7 + i * 0.6, 0.215, s * 0.72); }
};
PROPS.dock = g => {
  const pl = T('#8a7558', 'plank'), pl2 = T('#76644a', 'plank'), beamM = C('#4e3f2e'), pile = S('log'), rope = C('#a08a60'), iron = C('#2a2c30');
  for (const x of [-2.7, 0, 2.7]) bb(g, beamM, 0.22, 0.2, 6.0, x, -0.24, 0);
  const R = rng(61);
  for (let i = 0; i < 20; i++) { if (i === 13) continue; const z = -2.85 + i * 0.3; bb(g, i % 3 ? pl : pl2, 6.0 - (i === 7 ? 1.2 : 0), 0.1, 0.27, i === 7 ? 0.6 : 0, -0.04, z + (R() - 0.5) * 0.01, { ts: 1.5 }); }
  bb(g, pl2, 6.0, 0.1, 0.27, 0, -0.14, -2.85 + 13 * 0.3);
  for (const [x, z] of [[-2.85, -2.85], [2.85, -2.85], [-2.85, 2.85], [2.85, 2.85], [0, -2.85], [0, 2.85], [-2.85, 0], [2.85, 0]]) cv(g, pile, 0.17, 0.18, 3.4, x, -3.0, z, 8);
  cv(g, iron, 0.08, 0.1, 0.12, 2.5, 0.06, 2.5, 8); M.add(g, torus(0.24, 0.05, 4, 12), rope, 2.0, 0.1, 2.3, { rx: PI / 2 });
};

// ---- barriers & clutter
PROPS.barrier = g => {
  const conc = T('#b5b0a4', 'concrete'), dk = C('#6a665e'), red = C('#b0392c'), wh = C('#e8e2d4');
  M.add(g, prism([[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.12, 0.3], [0.08, 0.9], [-0.08, 0.9], [-0.12, 0.3], [-0.3, 0.08]], 2.0), conc, 0, 0, 0, { ry: PI / 2 });
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) bx(g, i % 2 ? wh : red, 0.24, 0.32, 0.01, -0.6 + i * 0.4, 0.62, s * 0.093, { rx: s * 0.07 });
  bb(g, dk, 2.0, 0.04, 0.62, 0, 0, 0);
};
PROPS.sandbags = g => {
  const a = T('#a89a72', 'cloth'), b = T('#9a8c66', 'cloth'), R = rng(3);
  const rows = [[0.14, 5, [-0.2, 0.2], 0], [0.42, 5, [-0.17, 0.17], 0.2], [0.7, 5, [0], 0]];
  for (const [y, n, zs, off] of rows) for (const z of zs) for (let i = 0; i < n; i++) {
    const x = -0.8 + i * 0.4 + off * (z > 0 ? 1 : 0) - (off ? 0.1 : 0);
    if (Math.abs(x) > 0.85) continue;
    M.add(g, M.sphere(1, 7, 4), R() < 0.5 ? a : b, x, y, z, { sx: 0.22, sy: 0.15, sz: 0.2, ry: (R() - 0.5) * 0.3 });
  }
};
PROPS.fence_chain = g => {
  const galv = C('#9aa0a4', true), dk = C('#6a6e72', true);
  for (const x of [-1.5, 1.5]) cv(g, galv, 0.045, 0.045, 2.25, x, 0, 0, 8);
  cxl(g, galv, 0.025, 3.0, 0, 2.18, 0, 6); cxl(g, dk, 0.01, 3.0, 0, 0.1, 0, 4);
  for (const x of [-1.5, 1.5]) beam(g, galv, 0.04, 0.04, [x, 2.2, 0], [x, 2.55, 0.3]);
  for (let i = 0; i < 3; i++) cxl(g, dk, 0.008, 3.0, 0, 2.3 + i * 0.11, 0.09 + i * 0.1, 3);
};
PROP_POST.fence_chain = out => {
  const m = M.add(out, M.box(2.96, 2.06, 0.004, 0.5), chainMat(), 0, 1.13, 0, { cast: false });
  m.renderOrder = 1;
};
PROPS.fence_wood = g => {
  const pl = T('#94744c', 'plank', true), pl2 = T('#7c6040', 'plank', true), postM = C('#5b4430', true), R = rng(12);
  for (const x of [-1.5, 0, 1.5]) bb(g, postM, 0.12, 1.5, 0.12, x, 0, 0);
  for (const y of [0.35, 1.1]) bb(g, pl2, 2.9, 0.09, 0.05, 0, y, -0.07);
  for (let i = 0; i < 11; i++) {
    if (i === 4) continue;
    const x = -1.33 + i * 0.266, h = (i === 8 ? 0.8 : 1.25) + R() * 0.1;
    bb(g, R() < 0.5 ? pl : pl2, 0.2, h, 0.03, x, 0.05, -0.02, { rz: (R() - 0.5) * 0.06, ts: 1.5 });
  }
  bb(g, pl, 0.2, 1.1, 0.03, -1.33 + 4 * 0.266, 0.05, -0.02, { rz: 0.5 });
};
PROPS.pallets = g => {
  const pl = T('#b39566', 'plank'), dk = T('#8a7048', 'plank'), R = rng(14);
  for (let k = 0; k < 6; k++) {
    const p = G(); p.position.set((R() - 0.5) * 0.08, k * 0.155, (R() - 0.5) * 0.08); p.rotation.y = (R() - 0.5) * 0.14; g.add(p);
    for (const z of [-0.5, 0, 0.5]) bb(p, dk, 1.2, 0.09, 0.1, 0, 0, z, { ts: 1 });
    for (let i = 0; i < 5; i++) bb(p, pl, 0.17, 0.025, 1.2, -0.5 + i * 0.25, 0.09, 0, { ts: 1 });
  }
};
PROPS.tires = g => {
  const tire = C('#26262a'), rim = C('#4a4c50');
  const t = (x, y, z, o) => M.add(g, torus(0.34, 0.16, 6, 12), tire, x, y, z, Object.assign({ rx: PI / 2 }, o));
  t(-0.15, 0.16, -0.1); t(-0.12, 0.48, -0.12, { rz: 0.06 }); t(0.45, 0.16, 0.5);
  M.add(g, torus(0.34, 0.16, 6, 12), tire, 0.55, 0.45, -0.45, { ry: 0.6, rx: 0.25 });
  cv(g, rim, 0.2, 0.2, 0.02, 0.45, 0.06, 0.5, 10);
};
PROPS.lamp = g => {
  const pole = T('#6a6e72', 'metal', true), dk = C('#2c2e33', true), conc = S('concrete');
  cv(g, conc, 0.25, 0.3, 0.3, 0, 0, 0, 8);
  cv(g, pole, 0.06, 0.1, 5.8, 0, 0.3, 0, 8);
  rod(g, pole, 0.05, [0, 5.7, 0], [0.7, 6.0, 0], 6); rod(g, pole, 0.05, [0.7, 6.0, 0], [1.4, 5.95, 0], 6);
  bb(g, dk, 0.7, 0.12, 0.34, 1.45, 5.82, 0);
  bx(g, C('#2c2e33', true), 0.16, 0.3, 0.12, 0, 2.4, 0.1);
};
PROP_POST.lamp = out => {
  M.add(out, M.box(0.56, 0.02, 0.26), GL('#ffe3a3'), 1.45, 5.81, 0, { cast: false });
  out.userData.light = V3(1.45, 5.6, 0);
};
PROPS.gas_pump = g => {
  const red = T('#a8402e', 'metal', true), wh = T('#d8d4c8', 'metal', true), dk = C('#1e1f22', true), conc = S('concrete'), glass = S('glass_dark', true), chrome = C('#9aa0a6');
  bb(g, conc, 0.9, 0.12, 0.6, 0, 0, 0);
  wbb(g, red, 0.7, 1.1, 0.42, 0, 0.12, 0, 1);
  wbb(g, wh, 0.78, 0.38, 0.48, 0, 1.22, 0, 1);
  for (const s of [-1, 1]) { bx(g, glass, 0.5, 0.2, 0.01, 0, 1.42, s * 0.245); bx(g, GL('#e8d070'), 0.2, 0.05, 0.005, -0.08, 1.44, s * 0.252); bx(g, wh, 0.4, 0.12, 0.01, 0, 0.85, s * 0.215); }
  bx(g, dk, 0.1, 0.25, 0.12, 0.4, 0.8, 0); rod(g, dk, 0.025, [0.4, 0.75, 0], [0.42, 0.25, 0.1], 5); rod(g, dk, 0.025, [0.42, 0.25, 0.1], [0.36, 1.05, 0.15], 5);
  bx(g, chrome, 0.06, 0.18, 0.05, 0.42, 0.85, 0.04);
  bx(g, S('rust', true), 0.3, 0.3, 0.01, -0.15, 0.4, 0.216);
};
PROPS.billboard = g => {
  const post = C('#3a3d42', true), frame = T('#7a7f84', 'metal', true), grate = C('#4a4d52', true), dk = C('#2c2e33', true);
  for (const x of [-1.2, 1.2]) { bb(g, post, 0.22, 5.0, 0.22, x, 0, 0); bb(g, S('concrete'), 0.5, 0.2, 0.5, x, -0.05, 0); }
  bb(g, frame, 4.0, 2.3, 0.12, 0, 2.62, 0);
  M.add(g, plane(3.84, 2.14), adMat(), 0, 3.77, 0.062);
  M.add(g, plane(3.84, 2.14), adMat(), 0, 3.77, -0.062, { ry: PI });
  bb(g, grate, 4.0, 0.05, 0.5, 0, 2.5, 0.32);
  cxl(g, dk, 0.02, 4.0, 0, 3.0, 0.56, 4);
  for (const x of [-1.9, 0, 1.9]) rod(g, dk, 0.02, [x, 2.55, 0.56], [x, 3.0, 0.56], 4);
  for (const x of [-1.2, 1.2]) { rod(g, dk, 0.025, [x, 4.95, 0.05], [x, 5.15, 0.7], 4); bx(g, dk, 0.3, 0.1, 0.16, x, 5.12, 0.72, { rx: 0.5 }); }
};
PROPS.watchtower = g => {
  const logM = S('log', true), pl = S('plank', true), pd = S('plank_dark', true), roof = T('#7c858c', 'corrugated', true), rope = C('#6e5c3e', true), sand = T('#a89a72', 'cloth', true);
  const L = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of L) cv(g, logM, 0.12, 0.14, 6.3, sx * 1.3, 0, sz * 1.3, 7);
  for (let k = 0; k < 4; k++) {
    const [ax, az] = L[k], [bx_, bz] = L[(k + 1) % 4];
    for (const [y0, y1] of [[0.3, 2.0], [2.0, 3.8]]) { rod(g, pd, 0.06, [ax * 1.3, y0, az * 1.3], [bx_ * 1.3, y1, bz * 1.3], 5); rod(g, pd, 0.06, [bx_ * 1.3, y0, bz * 1.3], [ax * 1.3, y1, az * 1.3], 5); }
  }
  wbb(g, pl, 3.2, 0.14, 3.2, 0, 3.85, 0, 2);
  for (let k = 0; k < 4; k++) {
    const [ax, az] = L[k], [bx_, bz] = L[(k + 1) % 4], cx_ = (ax + bx_) / 2 * 1.48, cz_ = (az + bz) / 2 * 1.48, alongX = az === bz;
    if (k === 1) { for (const y of [4.5, 5.0]) bb(g, pd, alongX ? 3.0 : 0.06, 0.08, alongX ? 0.06 : 3.0, cx_, y, cz_); continue; }
    bb(g, pl, alongX ? 3.0 : 0.05, 0.85, alongX ? 0.05 : 3.0, cx_, 3.99, cz_, { ts: 1.5 });
    bb(g, pd, alongX ? 3.06 : 0.1, 0.08, alongX ? 0.1 : 3.06, cx_, 4.84, cz_);
  }
  bx(g, roof, 3.6, 0.06, 3.6, 0, 6.35, 0, { rz: 0.12 });
  bb(g, pd, 3.4, 0.1, 0.12, 0, 6.12, 0);
  for (const s of [-1, 1]) bb(g, pd, 0.05, 3.9, 0.05, 1.85, 0, s * 0.22);
  for (let y = 0.3; y < 3.9; y += 0.32) bx(g, pd, 0.05, 0.04, 0.48, 1.85, y, 0);
  for (const [x, z] of [[-0.9, -1.1], [-0.5, -1.15], [-1.1, -0.6]]) M.add(g, M.sphere(1, 6, 4), sand, x, 4.08, z, { sx: 0.22, sy: 0.13, sz: 0.18 });
  cv(g, rope, 0.15, 0.15, 0.06, 0.8, 3.99, 0.9, 8);
};
PROPS.tent = g => {
  const can = T('#64734a', 'cloth', true), can2 = T('#4f5c38', 'cloth', true), dk = C('#1e1c18', true), pole = C('#5b4430', true), rope = C('#b0a080', true);
  const th = Math.atan2(2.0, 1.45), L = Math.hypot(1.45, 2.0);
  bx(g, can, 2.9, 0.04, L, 0, 1.15, 0.725, { rx: th });
  bx(g, can2, 2.9, 0.04, L, 0, 1.15, -0.725, { rx: -th });
  M.add(g, prism([[-1.42, 0.05], [1.42, 0.05], [0, 2.1]], 0.03), can2, -1.43, 0, 0, { ry: PI / 2 });
  M.add(g, prism([[-1.0, 0.02], [1.0, 0.02], [0, 1.5]], 0.02), dk, 1.42, 0, 0, { ry: PI / 2 });
  for (const s of [-1, 1]) M.add(g, prism([[0, 0], [0.7, 0], [0.1, 1.45]], 0.03), can, 1.48, 0, s * 0.42, { ry: PI / 2 + s * 0.5, sx: -s });
  cxl(g, pole, 0.05, 3.1, 0, 2.2, 0, 6);
  for (const x of [-1.5, 1.5]) cv(g, pole, 0.035, 0.035, 2.2, x, 0, 0, 6);
  for (const x of [-1.5, 1.5]) for (const s of [-1, 1]) { rod(g, rope, 0.01, [x, 2.15, 0], [x * 1.35, 0, s * 0.7], 3); bx(g, pole, 0.04, 0.12, 0.04, x * 1.35, 0.04, s * 0.7); }
  for (const s of [-1, 1]) for (const x of [-0.7, 0.7]) rod(g, rope, 0.01, [x, 0.9, s * 0.85], [x, 0, s * 1.75], 3);
  bx(g, T('#8a7a5a', 'cloth', true), 0.6, 0.03, 0.5, 0.5, 0.86, 0.95, { rx: th });
  for (const sz of [-1, 1]) {
    bx(g, T('#7a8a5c', 'cloth', true), 2.92, 0.05, 0.42, 0, 2.0, sz * 0.15, { rx: sz * th });
    for (const x of [-0.72, 0.72]) bx(g, C('#3e4a2c', true), 0.05, 0.05, L * 0.92, x, 1.15, sz * 0.735, { rx: sz * th });
  }
};
PROPS.rock_big = (g, o) => {
  const seed = (o.seed ?? 1) | 0, vb = new VB(1000 + seed * 7), R = rng(seed * 13 + 5);
  const fn = (c, x, y, z, ny, R2) => { if (ny > 0.75 && R2() < 0.4) c.lerp(col('#6a7a48'), 0.6); else if (R2() < 0.2) c.lerp(col('#a8a59c'), 0.5); };
  const oo = { col: '#86837b', vary: 0.1, fn, top: 0.2, ao: [-0.2, 2.6, 0.6] };
  vb.add(M.ico(1.7, 1), Object.assign({ p: [0, 1.25, 0], s: [1.1, 1.0 + R() * 0.2, 0.95], r: [R() * 3, R() * 3, R() * 3], jit: 0.3, floor: -0.2 }, oo));
  for (let i = 0; i < 3; i++) { const a = R() * TAU, d = 1.2 + R() * 0.5; vb.add(M.ico(0.6 + R() * 0.5, i ? 0 : 1), Object.assign({ p: [Math.cos(a) * d, 0.35 + R() * 0.4, Math.sin(a) * d], s: [1, 0.8, 1], r: [R() * 3, R() * 3, 0], jit: 0.12, floor: -0.1 }, oo)); }
  const m = new THREE.Mesh(vb.build(2), M.mat('#ffffff', { vc: true, tex: 'rock', cut: true }));
  g.add(m);
};
PROPS.lighthouse = g => {
  const wh = T('#e4e0d4', 'concrete', true), red = T('#b0392c', 'concrete', true), dk = C('#2a2c30', true), conc = S('concrete'), glass = M.mat('#ffe9a8', { emissive: '#ffcf6a', emissiveIntensity: 0.55, cut: true }), win = C('#1c2228', true);
  cv(g, conc, 3.4, 3.5, 0.6, 0, 0, 0, 10);
  const r = y => 3.0 - 1.05 * (y / 17);
  for (let i = 0; i < 5; i++) { const y0 = 0.6 + i * 3.28, y1 = y0 + 3.28; cv(g, i % 2 ? red : wh, r(y1), r(y0), 3.28, 0, y0, 0, 18); }
  cv(g, dk, 2.6, 2.6, 0.25, 0, 17.0, 0, 18);
  M.add(g, torus(2.5, 0.04, 3, 24), dk, 0, 17.95, 0, { rx: PI / 2 });
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; rod(g, dk, 0.025, [Math.cos(a) * 2.5, 17.25, Math.sin(a) * 2.5], [Math.cos(a) * 2.5, 17.95, Math.sin(a) * 2.5], 4); }
  cv(g, glass, 1.35, 1.35, 2.0, 0, 17.25, 0, 12);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; bb(g, dk, 0.08, 2.0, 0.08, Math.cos(a) * 1.37, 17.25, Math.sin(a) * 1.37); }
  cv(g, red, 1.5, 1.5, 0.12, 0, 19.25, 0, 12);
  M.add(g, sphereCap(1.5, 12, 3, PI / 2), red, 0, 19.37, 0, { sy: 0.6 });
  M.add(g, M.sphere(0.18, 8, 6), dk, 0, 20.35, 0); rod(g, dk, 0.025, [0, 20.4, 0], [0, 21.4, 0], 4);
  bb(g, dk, 0.08, 2.0, 1.0, 2.98, 0.6, 0);
  for (const [y, a] of [[4.5, 0.3], [8.0, 1.2], [11.5, 0.5], [14.5, 1.4]]) bx(g, win, 0.1, 0.6, 0.4, Math.cos(a) * r(y), y, Math.sin(a) * r(y), { ry: -a });
};
PROP_POST.lighthouse = out => {
  M.add(out, M.sphere(0.6, 10, 8), GL('#fff1c0'), 0, 18.25, 0, { cast: false });
  out.userData.light = V3(0, 18.25, 0);
};
PROPS.haybale = g => {
  const hay = T('#c6a55a', 'grass'), end = T('#b8954c', 'grass'), ring = C('#a8863e');
  czl(g, hay, 0.6, 1.2, 0, 0.6, 0, 14);
  for (const s of [-1, 1]) { for (const r of [0.42, 0.24]) M.add(g, torus(r, 0.02, 3, 14), ring, 0, 0.6, s * 0.6); cv(g, end, 0.1, 0.1, 0.02, 0, 0.59, s * 0.6, 8, { rx: PI / 2 }); }
  for (const z of [-0.3, 0.3]) M.add(g, torus(0.605, 0.012, 3, 16), C('#d8d0bc'), 0, 0.6, z);
};
PROPS.drums = g => {
  drum(g, T('#3a5f8f', 'metal'), T('#2c4a70', 'metal'), T('#33557e', 'metal'), -0.4, -0.35);
  drum(g, T('#a03a2a', 'metal'), C('#1e1e20'), C('#26262a'), 0.42, -0.3);
  drum(g, T('#c9a032', 'metal'), T('#8a6a20', 'metal'), T('#b08a2a', 'metal'), 0.0, 0.4);
  bx(g, C('#1c1d20'), 0.2, 0.2, 0.01, 0.0, 0.5, 0.745, { rz: PI / 4 });
};
PROPS.cable_spool = g => {
  const wood = T('#a8875a', 'plank'), dk = C('#5e4329'), cable = C('#262729'), bolt = C('#3a3d42');
  cv(g, wood, 0.8, 0.8, 0.08, 0, 0, 0, 16); cv(g, wood, 0.8, 0.8, 0.08, 0, 0.92, 0, 16);
  cv(g, dk, 0.4, 0.4, 0.84, 0, 0.08, 0, 12);
  for (let i = 0; i < 5; i++) M.add(g, torus(0.52, 0.09, 5, 16), cable, 0, 0.2 + i * 0.17, 0, { rx: PI / 2 });
  cv(g, C('#1c1d20'), 0.1, 0.1, 0.01, 0, 1.0, 0, 8);
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; bx(g, bolt, 0.05, 0.02, 0.05, Math.cos(a) * 0.3, 1.005, Math.sin(a) * 0.3); }
  for (const a of [0, PI / 2]) bx(g, dk, 1.56, 0.012, 0.05, 0, 1.004, 0, { ry: a });
};
PROPS.scaffold = g => {
  const tube = C('#9aa0a6', true), pl = T('#a8875a', 'plank', true), clamp = C('#5a5e62', true);
  const X = [-1.45, 0, 1.45], Z = [-0.7, 0.7];
  for (const x of X) for (const z of Z) { cv(g, tube, 0.03, 0.03, 4.2, x, 0, z, 6); bb(g, clamp, 0.14, 0.04, 0.14, x, 0, z); }
  for (const y of [0.15, 2.0, 4.0]) { for (const z of Z) cxl(g, tube, 0.025, 3.0, 0, y, z, 6); for (const x of X) czl(g, tube, 0.025, 1.5, x, y, 0, 6); }
  rod(g, tube, 0.022, [-1.45, 0.15, -0.7], [0, 2.0, -0.7], 5); rod(g, tube, 0.022, [0, 2.0, -0.7], [1.45, 4.0, -0.7], 5);
  for (const y of [2.03, 4.03]) for (let i = 0; i < 3; i++) bb(g, pl, 3.0, 0.05, 0.42, 0, y, -0.45 + i * 0.45, { ts: 1.5 });
  for (const z of Z) bb(g, pl, 3.0, 0.15, 0.03, 0, 4.08, z * 0.98);
};
PROPS.hangar = g => {
  const sheet = T('#8f9396', 'corrugated', true), rs = T('#8f5634', 'corrugated', true), rib = C('#4a4e54', true), haz = S('hazard', true), conc = S('concrete'), yl = C('#c9a032'), dk = C('#2a2c30', true);
  bb(g, conc, 14, 0.06, 20, 0, 0, 0, { ts: 4 });
  for (const z of [-6, 6]) bb(g, yl, 13, 0.004, 0.15, 0, 0.06, z);
  const N = 14, A = 10, B = 7;
  const pt = (t, k = 1) => [A * k * Math.cos(t), B * k * Math.sin(t)];
  for (let i = 0; i < N; i++) {
    const [z0, y0] = pt(i / N * PI), [z1, y1] = pt((i + 1) / N * PI), len = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y1 - y0, z1 - z0);
    const m = (i === 3 || i === 10) ? rs : sheet, yc = (y0 + y1) / 2, zc = (z0 + z1) / 2;
    if (i === 5) { M.add(g, M.box(6, 0.12, len + 0.03, 4), m, -4, yc, zc, { rx: -ang }); M.add(g, M.box(5, 0.12, len + 0.03, 4), m, 4.5, yc, zc, { rx: -ang }); }
    else M.add(g, M.box(14, 0.12, len + 0.03, 4), m, 0, yc, zc, { rx: -ang });
    for (const x of [-4.6, -1.5, 1.5, 4.6]) beam(g, rib, 0.14, 0.12, [x, ...pt(i / N * PI, 1.01).reverse()], [x, ...pt((i + 1) / N * PI, 1.01).reverse()]);
    beam(g, haz, 0.34, 0.34, [7.0, ...pt(i / N * PI, 1.012).reverse()], [7.0, ...pt((i + 1) / N * PI, 1.012).reverse()]);
  }
  const wall = []; for (let i = 0; i <= 16; i++) { const t = i / 16 * PI; wall.push([A * Math.cos(t), B * Math.sin(t)]); }
  M.add(g, prism(wall, 0.15, 0.5), sheet, -6.92, 0, 0, { ry: PI / 2 });
  bb(g, dk, 0.04, 2.2, 1.2, -7.01, 0, 3.5);
  for (let i = 0; i < 3; i++) bb(g, T('#5a6a72', 'metal'), 1.2, 1.1, 1.0, -5.8, 0.06 + (i % 2) * 0, -7.5 + i * 1.3);
};
PROPS.garage = g => {
  const br = S('brick', true), roof = T('#6f757a', 'corrugated', true), conc = S('concrete'), dk = C('#2c2e33', true), shut = T('#8a9096', 'corrugated', true), trim = S('concrete', true), yl = C('#c9a032', true);
  bb(g, conc, 8, 0.05, 6, 0, 0, 0);
  wbb(g, br, 0.2, 3.3, 6, -3.9, 0, 0, 2);
  for (const s of [-1, 1]) wbb(g, br, 7.6, 3.3, 0.2, 0.0, 0, s * 2.9, 2);
  for (const s of [-1, 1]) bb(g, trim, 0.3, 3.3, 0.3, 3.85, 0, s * 2.85);
  wbb(g, roof, 8.4, 0.12, 6.3, 0.2, 3.3, 0, 2);
  for (const s of [-1, 1]) bb(g, trim, 8.4, 0.18, 0.15, 0.2, 3.36, s * 3.08);
  bb(g, trim, 0.3, 0.6, 5.4, 3.85, 2.7, 0);
  czl(g, shut, 0.25, 5.3, 3.62, 2.9, 0, 12);
  for (const s of [-1, 1]) bb(g, dk, 0.08, 2.7, 0.08, 3.7, 0, s * 2.66);
  bx(g, yl, 0.03, 0.38, 2.6, 4.02, 3.0, 0);
  for (let i = 0; i < 5; i++) bx(g, dk, 0.032, 0.18, 0.3, 4.02, 3.0, -1.0 + i * 0.5);
  cv(g, C('#2a2826'), 1.0, 1.2, 0.005, 0.6, 0.05, 0.7, 12);
};
PROPS.dumpster = g => {
  const gr = T('#4f6e3e', 'metal'), dk = C('#1e1f21'), lid = C('#2a2c2e'), rustM = S('rust');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cv(g, dk, 0.07, 0.07, 0.12, sx * 0.8, 0, sz * 0.45, 8);
  wbb(g, gr, 1.9, 1.0, 1.1, 0, 0.14, 0, 1);
  bb(g, C('#3f5a32'), 1.96, 0.08, 1.16, 0, 1.12, 0);
  for (const s of [-1, 1]) bb(g, C('#3f5a32'), 1.96, 0.18, 0.06, 0, 0.5, s * 0.58);
  bx(g, lid, 0.95, 0.05, 1.16, -0.48, 1.22, 0, { rx: 0.06 });
  bx(g, lid, 0.95, 0.05, 1.16, 0.48, 1.62, -0.62, { rx: -1.25 });
  M.add(g, M.ico(0.32, 0), C('#16171a'), 0.4, 1.18, 0.1, { sy: 0.7 });
  rustBlot(g, -0.4, 0.5, 0.552, 0.6, 0.4, 'z', false, 44);
};

// ---- small interior / street props
PROPS.vending = g => {
  const red = T('#a8402e', 'metal', true), dk = C('#1a1b1e', true), wh = C('#e8e2d4', true);
  wbb(g, red, 0.8, 2.0, 1.0, 0, 0, 0, 1);
  bx(g, dk, 0.02, 1.3, 0.62, 0.405, 1.15, -0.12);
  const cols = ['#c0402a', '#3a6ea8', '#d0a838', '#4f8a43', '#e8e2d4'];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) bx(g, C(cols[(r + c) % 5], true), 0.03, 0.14, 0.1, 0.42, 0.62 + r * 0.24, -0.36 + c * 0.16);
  bx(g, GL('#cfe8ff'), 0.012, 1.26, 0.6, 0.418, 1.15, -0.12, { cast: false });
  bx(g, wh, 0.02, 0.22, 0.98, 0.405, 1.9, 0);
  bx(g, dk, 0.02, 0.5, 0.2, 0.41, 1.2, 0.34); bx(g, GL('#4ae05a'), 0.01, 0.05, 0.06, 0.422, 1.35, 0.34);
  bx(g, dk, 0.02, 0.18, 0.6, 0.41, 0.25, -0.12);
};
PROPS.counter = g => {
  const pd = S('plank_dark'), pl = S('plank'), dk = C('#2c2e33'), glass = S('glass');
  wbb(g, pd, 3.0, 1.0, 0.7, 0, 0, 0, 1.5);
  bb(g, pl, 3.1, 0.06, 0.82, 0, 1.0, 0.02);
  bb(g, dk, 3.0, 0.08, 0.72, 0, 0, 0);
  bb(g, dk, 0.4, 0.25, 0.35, 0.9, 1.06, -0.1); bx(g, C('#3a5a3a'), 0.3, 0.16, 0.02, 0.9, 1.4, -0.05, { rx: -0.3 }); bx(g, GL('#7adf7a'), 0.2, 0.08, 0.005, 0.9, 1.4, -0.035, { rx: -0.3 });
  for (let i = 0; i < 3; i++) cv(g, C(['#c0402a', '#d0a838', '#3a6ea8'][i]), 0.05, 0.05, 0.14, -1.0 + i * 0.15, 1.06, 0.1, 8);
  bb(g, C('#d8ccb0'), 0.3, 0.15, 0.25, -0.2, 1.06, 0.05);
  bx(g, T('#c9a032', 'metal'), 2.8, 0.1, 0.01, 0, 0.8, 0.355);
};
PROPS.shelf = g => {
  const fr = C('#5a6066', true), sh = T('#8a9096', 'metal', true), R = rng(41), cols = ['#c0402a', '#3a6ea8', '#d0a838', '#4f8a43', '#d8ccb0', '#8a5a3a', '#e8e2d4'];
  for (const x of [-1.45, 0, 1.45]) for (const z of [-0.27, 0.27]) bb(g, fr, 0.05, 1.8, 0.05, x, 0, z);
  bb(g, fr, 3.0, 1.7, 0.02, 0, 0.05, -0.28);
  for (const y of [0.08, 0.55, 1.02, 1.49]) bb(g, sh, 2.96, 0.03, 0.56, 0, y, 0, { ts: 1 });
  for (const y of [0.11, 0.58, 1.05, 1.52]) for (let x = -1.35; x < 1.35;) {
    const w = 0.12 + R() * 0.18, h = 0.12 + R() * 0.24; if (R() < 0.18) { x += w; continue; }
    if (R() < 0.4) cv(g, C(cols[(R() * 7) | 0], true), w * 0.4, w * 0.4, h, x + w / 2, y, (R() - 0.5) * 0.2, 8);
    else bb(g, C(cols[(R() * 7) | 0], true), w * 0.9, h, 0.3, x + w / 2, y, (R() - 0.5) * 0.1);
    x += w + 0.02;
  }
};
PROPS.cardreader = (g, o) => {
  const c = o.color || '#3a9a4a', post = C('#3a3d42'), body = T('#6a7078', 'metal'), dk = C('#141416');
  bb(g, post, 0.1, 0.9, 0.1, 0, 0, 0);
  bb(g, body, 0.2, 0.34, 0.24, 0, 0.88, 0, { ts: 1 });
  bb(g, C(c), 0.21, 0.06, 0.25, 0, 1.12, 0);
  bx(g, dk, 0.01, 0.03, 0.14, 0.101, 1.0, 0);
  bx(g, GL(c), 0.012, 0.04, 0.04, 0.102, 1.18 - 0.1, 0.07);
  bb(g, C('#2c2e33'), 0.3, 0.04, 0.3, 0, 0, 0);
};
PROPS.fusebox = g => {
  const box = T('#7a8078', 'metal'), dk = C('#2c2e33'), yl = C('#d0a838'), conduit = C('#5a5e62');
  bb(g, dk, 0.08, 1.6, 0.08, -0.1, 0, 0);
  bb(g, box, 0.24, 0.7, 0.5, 0, 0.9, 0, { ts: 1 });
  bx(g, C('#868c84'), 0.02, 0.64, 0.44, 0.13, 1.25, 0);
  bx(g, yl, 0.01, 0.16, 0.16, 0.142, 1.38, 0, { rx: PI / 4 }); bx(g, dk, 0.012, 0.1, 0.03, 0.145, 1.38, 0, { rx: 0.4 });
  bx(g, dk, 0.03, 0.08, 0.03, 0.15, 1.2, 0.18);
  cv(g, conduit, 0.03, 0.03, 0.9, 0.0, 0, 0.18, 6);
};
PROPS.lever = g => {
  const base = T('#5a6066', 'metal'), haz = S('hazard');
  bb(g, base, 0.3, 0.22, 0.3, 0, 0, 0, { ts: 1 });
  bb(g, haz, 0.31, 0.04, 0.31, 0, 0.2, 0, { ts: 0.4 });
  bb(g, C('#2c2e33'), 0.08, 0.06, 0.22, 0, 0.24, 0);
};
PROP_POST.lever = out => {
  const h = G(); h.position.set(0, 0.27, 0); h.name = 'handle';
  rod(h, C('#3a3d42'), 0.022, [0, 0, 0], [0, 0.65, 0], 6);
  M.add(h, M.sphere(0.06, 8, 6), C('#c0302a'), 0, 0.68, 0);
  out.add(h);
  out.userData.handle = h;
  out.userData.setOn = on => { h.rotation.z = on ? -0.6 : 0.6; };
  out.userData.setOn(false);
};
PROPS.desk = g => {
  const top = T('#8a7f70', 'noise'), legM = C('#3a3d42'), dr = T('#6e6458', 'noise'), dk = C('#1c1d20'), paper = C('#e8e2d0');
  bb(g, top, 1.6, 0.05, 0.8, 0, 0.74, 0);
  for (const s of [-1, 1]) bb(g, legM, 0.05, 0.74, 0.7, -0.74, 0, s * 0);
  bb(g, legM, 0.05, 0.74, 0.7, -0.74, 0, 0);
  wbb(g, dr, 0.45, 0.72, 0.72, 0.55, 0.02, 0, 1);
  for (let i = 0; i < 3; i++) bx(g, C('#a8adb2'), 0.12, 0.02, 0.02, 0.55, 0.2 + i * 0.22, 0.37);
  bb(g, C('#c8c2b0'), 0.42, 0.36, 0.38, -0.3, 0.79, -0.15); bx(g, GL('#5a9a6a'), 0.3, 0.24, 0.01, -0.3, 0.98, 0.04);
  bb(g, C('#c8c2b0'), 0.45, 0.02, 0.16, -0.3, 0.79, 0.22);
  bb(g, paper, 0.25, 0.006, 0.32, 0.35, 0.79, 0.1, { ry: 0.3 });
  cv(g, C('#d8d4c8'), 0.04, 0.04, 0.09, 0.6, 0.79, -0.2, 8);
};
PROPS.bunkbed = g => {
  const fr = C('#3e4248', true), mat = T('#7a8090', 'cloth', true), bl = T('#566440', 'cloth', true), pil = T('#d8d4c8', 'cloth', true);
  for (const x of [-0.97, 0.97]) for (const z of [-0.47, 0.47]) cv(g, fr, 0.025, 0.025, 1.6, x, 0, z, 6);
  for (const y of [0.32, 1.22]) {
    for (const z of [-0.47, 0.47]) cxl(g, fr, 0.02, 1.94, 0, y, z, 6);
    bb(g, mat, 1.9, 0.12, 0.9, 0, y, 0);
    bb(g, pil, 0.3, 0.08, 0.6, -0.75, y + 0.12, 0);
    bb(g, bl, 1.1, 0.03, 0.92, 0.3, y + 0.12, 0, { ry: y > 1 ? 0.05 : -0.04 });
  }
  for (const x of [-0.97, 0.97]) for (const y of [0.6, 1.5]) czl(g, fr, 0.018, 0.94, x, y, 0, 6);
  for (let y = 0.5; y < 1.4; y += 0.28) cxl(g, fr, 0.015, 0.35, 0.7, y, 0.5, 4);
};
PROPS.table = g => {
  const pl = S('plank'), leg = C('#5b3e26');
  bb(g, pl, 1.6, 0.06, 0.9, 0, 0.74, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, leg, 0.07, 0.74, 0.07, sx * 0.72, 0, sz * 0.38);
  for (const s of [-1, 1]) bb(g, leg, 1.4, 0.05, 0.04, 0, 0.3, s * 0.38);
  cv(g, C('#d8d4c8'), 0.11, 0.11, 0.015, -0.3, 0.8, 0.1, 10); cv(g, C('#3a6a3a'), 0.035, 0.04, 0.24, 0.35, 0.8, -0.15, 8);
  cv(g, C('#9a9a94'), 0.06, 0.06, 0.08, 0.1, 0.8, -0.2, 8);
};
PROPS.workbench_old = g => {
  const top = S('rust'), legM = C('#3a3330'), dk = C('#22201e'), steel = C('#7a7e82'), red = T('#8a3a2c', 'metal');
  wbb(g, top, 2.0, 0.08, 0.8, 0, 0.9, 0, 1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, legM, 0.07, 0.9, 0.07, sx * 0.94, 0, sz * 0.35);
  bb(g, S('rust'), 1.9, 0.04, 0.7, 0, 0.25, 0, { ts: 1 });
  bb(g, dk, 0.2, 0.15, 0.2, 0.85, 0.98, 0.2); bb(g, steel, 0.06, 0.08, 0.26, 0.92, 1.08, 0.2);
  bb(g, red, 0.5, 0.2, 0.25, -0.5, 0.98, -0.15, { ts: 1 });
  bb(g, steel, 0.3, 0.02, 0.05, 0.1, 0.98, 0.2, { ry: 0.4 }); rod(g, steel, 0.03, [-0.2, 1.0, 0.25], [0.5, 1.0, 0.1], 6);
  for (let i = 0; i < 4; i++) M.add(g, M.ico(0.08, 0), steel, -0.6 + i * 0.4, 0.33, (i % 2 ? 0.15 : -0.12), { ry: i });
  bb(g, C('#5a5e62'), 0.4, 0.35, 0.4, 0.5, 0.29, 0.0);
};
PROPS.bench = g => {
  const pl = T('#94744c', 'plank'), iron = C('#2a2b2e');
  for (let i = 0; i < 3; i++) bb(g, pl, 2.0, 0.04, 0.13, 0, 0.44, -0.15 + i * 0.15);
  for (const x of [-0.8, 0.8]) { M.add(g, prism([[-0.22, 0], [0.22, 0], [0.18, 0.44], [-0.18, 0.44]], 0.06), iron, x, 0, 0, { ry: PI / 2 }); }
  bb(g, iron, 1.7, 0.04, 0.04, 0, 0.3, 0);
};
PROPS.streetsign = g => {
  const pole = C('#8a9096'), grn = C('#2e6a42'), wh = C('#e8e2d4'), yl = C('#d8b03a'), dk = C('#1c1d20');
  cv(g, pole, 0.035, 0.035, 2.7, 0, 0, 0, 6);
  bb(g, grn, 0.02, 0.18, 0.8, 0.04, 2.45, 0); bx(g, wh, 0.022, 0.04, 0.6, 0.04, 2.54, 0);
  bx(g, yl, 0.02, 0.5, 0.5, 0.04, 1.9, 0, { rx: PI / 4 }); bx(g, dk, 0.022, 0.2, 0.05, 0.04, 1.92, 0); bx(g, dk, 0.022, 0.05, 0.05, 0.04, 1.75, 0);
};

// ============================================================================
// PICKUPS & EVENTS
// ============================================================================
const PICK = {
  bag(g) {
    const body = T('#5d5038', 'cloth'), flap = T('#4a402c', 'cloth'), strap = C('#2e2a22'), roll = T('#56683e', 'cloth');
    bb(g, body, 0.52, 0.2, 0.4, 0, 0, 0);
    M.add(g, M.sphere(1, 8, 4), body, -0.05, 0.2, 0, { sx: 0.24, sy: 0.08, sz: 0.19 });
    bb(g, flap, 0.26, 0.05, 0.42, 0.14, 0.18, 0);
    for (const z of [-0.12, 0.12]) bb(g, strap, 0.5, 0.215, 0.04, 0, 0, z);
    czl(g, roll, 0.09, 0.46, -0.3, 0.12, 0, 8);
    bx(g, C('#a8adb2'), 0.04, 0.03, 0.06, 0.27, 0.19, 0);
  },
  item(g) {
    const sack = T('#a89a72', 'cloth'), rope = C('#6e5c3e');
    M.add(g, M.sphere(1, 8, 5), sack, 0, 0.13, 0, { sx: 0.2, sy: 0.15, sz: 0.18 });
    cv(g, sack, 0.06, 0.09, 0.1, 0, 0.24, 0, 7); cv(g, rope, 0.065, 0.065, 0.03, 0, 0.27, 0, 7);
    M.add(g, M.cone(0.08, 0.08, 7), sack, 0, 0.37, 0);
    bb(g, T('#9c7a4c', 'plank'), 0.18, 0.12, 0.14, 0.2, 0, 0.12, { ry: 0.5 });
  },
  weapon(g) {
    const gun = C('#26272b'), wood = S('plank_dark'), metal = C('#4a4c52');
    const w = G(); w.rotation.x = PI / 2; w.position.y = 0.05; g.add(w);
    bb(w, wood, 0.36, 0.12, 0.05, -0.38, -0.06, 0);
    bb(w, metal, 0.36, 0.1, 0.06, -0.02, -0.04, 0);
    cxl(w, gun, 0.02, 0.5, 0.4, 0.02, 0, 6);
    bb(w, gun, 0.06, 0.16, 0.04, 0.04, -0.2, 0, { rz: 0.15 });
    bb(w, wood, 0.22, 0.06, 0.05, 0.25, -0.04, 0);
    bb(w, gun, 0.05, 0.1, 0.04, -0.16, -0.14, 0);
  },
};
export function makePickup(kind) {
  const k = PICK[kind] ? kind : 'item';
  const out = cached('pick:' + k, PICK[k]);
  out.userData.pickup = k;
  return out;
}

export function makeAirdrop() {
  const out = cached('ev:airdrop', g => {
    const blue = T('#3a62a0', 'metal'), wh = C('#e8e4d8'), yl = C('#d8b03a'), frame = C('#2a2d33'), dk = C('#1c1d20');
    bb(g, frame, 1.4, 0.08, 1.4, 0, 0, 0);
    for (const s of [-1, 1]) bb(g, dk, 1.36, 0.1, 0.16, 0, 0.0, s * 0.45);
    wbb(g, blue, 1.32, 1.04, 1.32, 0, 0.08, 0, 1);
    for (const y of [0.3, 0.82]) bb(g, wh, 1.34, 0.08, 1.34, 0, y, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) bb(g, frame, 0.1, 1.1, 0.1, sx * 0.66, 0.06, sz * 0.66);
    wbb(g, T('#3f6aa8', 'metal'), 1.36, 0.06, 1.36, 0, 1.12, 0, 1);
    for (const s of [-1, 1]) { bb(g, frame, 1.42, 0.08, 0.08, 0, 1.11, s * 0.67); bb(g, frame, 0.08, 0.08, 1.42, s * 0.67, 1.11, 0); }
    bb(g, wh, 1.26, 0.02, 0.22, 0, 1.18, 0); bb(g, wh, 0.22, 0.02, 1.26, 0, 1.18, 0);
    bb(g, yl, 0.4, 0.025, 0.4, 0, 1.18, 0, { ry: PI / 4 });
    M.add(g, torus(0.1, 0.02, 4, 10), C('#8a8d92'), 0, 1.22, 0);
    for (const s of [-1, 1]) bx(g, yl, 0.01, 0.2, 0.5, s * 0.665, 0.56, 0);
    cv(g, dk, 0.07, 0.08, 0.08, 0.52, 1.18, 0.52, 8);
  });
  const beacon = M.add(out, M.cyl(0.055, 0.055, 0.12, 8), GL('#ff3a2a'), 0.52, 1.32, 0.52, { cast: false });
  out.userData.beacon = beacon;
  out.userData.light = V3(0.52, 1.4, 0.52);
  out.userData.tick = t => { beacon.visible = (t % 0.8) < 0.45; };
  out.userData.airdrop = true;
  return out;
}

// canopy + lines; origin (pivot) at the bottom where the load hangs
export function makeParachute() {
  return cached('ev:parachute', g => {
    const R = 3.3, th = 1.1, cy = 5.4, sy = 0.6, n = 12;
    const ora = DS('#d27a35', 'cloth'), wh = DS('#e8e2d4', 'cloth'), line = C('#3a3530');
    for (let i = 0; i < n; i++) {
      const geo = new THREE.SphereGeometry(R, 2, 5, i / n * TAU, TAU / n, 0, th);
      M.add(g, geo, i % 2 ? wh : ora, 0, cy, 0, { sy });
    }
    const rimR = R * Math.sin(th), rimY = cy + R * Math.cos(th) * sy;
    for (let i = 0; i < n; i++) { const a = i / n * TAU; rod(g, line, 0.018, [Math.sin(a) * rimR, rimY, Math.cos(a) * rimR], [0, 0.45, 0], 3); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + PI / 4; rod(g, C('#2a2620'), 0.03, [0, 0.45, 0], [Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5], 4); }
    cv(g, C('#2a2620'), 0.08, 0.08, 0.1, 0, 0.42, 0, 6);
  });
}

// cargo plane, ~24 m wingspan, faces +X; origin = fuselage centre
export function makePlane() {
  const out = cached('ev:plane', g => {
    const grey = T('#7d848a', 'metal'), dark = T('#5e656c', 'metal'), glass = S('glass_dark'), dk = C('#2a2c30');
    cxl(g, grey, 1.6, 14, 0.5, 0, 0, 14);
    rodT(g, grey, 1.6, 0.7, [7.5, 0, 0], [10.2, -0.25, 0], 14);
    M.add(g, M.sphere(0.7, 10, 6), dark, 10.2, -0.25, 0, { sx: 0.8 });
    bx(g, glass, 0.9, 0.35, 1.6, 8.9, 0.7, 0, { rz: -0.35 });
    rodT(g, grey, 1.6, 0.35, [-6.5, 0, 0], [-12.5, 1.1, 0], 14);
    for (const s of [-1, 1]) bb(g, dark, 4.5, 0.9, 0.7, 0.5, -1.55, s * 1.3);
    const wing = [[2.6, 0], [1.6, 12], [-0.3, 12], [-1.6, 0], [-0.3, -12], [1.6, -12]];
    M.add(g, prism(wing, 0.42, 0.25), grey, 0, 1.45, 0, { rx: -PI / 2 });
    bb(g, dark, 4.2, 0.35, 2.6, 0.5, 1.1, 0);
    for (const z of [-8, -4.2, 4.2, 8]) { cxl(g, dark, 0.52, 3.2, 2.3, 1.0, z, 10); M.add(g, M.cone(0.3, 0.5, 8), dk, 4.1, 1.0, z, { rz: -PI / 2 }); }
    M.add(g, prism([[-8.6, 1.0], [-11.9, 1.0], [-12.9, 6.2], [-11.0, 6.2]], 0.35, 0.25), grey, 0, 0, 0);
    M.add(g, prism([[-9.8, 0], [-10.6, 5.0], [-12.0, 5.0], [-12.4, 0], [-12.0, -5.0], [-10.6, -5.0]], 0.22, 0.25), grey, 0, 1.0, 0, { rx: -PI / 2 });
    bx(g, C('#e8e2d4'), 3.0, 0.02, 1.0, 1.0, 1.67, -9.5); bx(g, C('#2f3d5a'), 0.8, 0.02, 0.8, 1.0, 1.68, -9.5);
  });
  const props = [];
  for (const z of [-8, -4.2, 4.2, 8]) {
    const p = G(); p.position.set(4.25, 1.0, z); p.name = 'prop';
    p.add(cached('ev:plane:prop', g => { for (let i = 0; i < 4; i++) M.add(g, M.box(0.06, 1.7, 0.22), C('#1c1d20'), 0, 0, 0, { rx: i * PI / 2 + 0.3 }); cv(g, C('#3a3d42'), 0.12, 0.12, 0.2, 0, -0.1, 0, 8, { rz: PI / 2 }); }));
    out.add(p); props.push(p);
  }
  out.userData.props = props;      // spin each on X
  out.userData.tick = t => { for (const p of props) p.rotation.x = t * 25; };
  return out;
}

// attack helicopter ~12 m, faces +X. userData.rotor spins on Y, userData.tail spins on X.
export function makeHeli() {
  const out = cached('ev:heli', g => {
    const ol = T('#4a5236', 'metal'), od = T('#3a412a', 'metal'), glass = S('glass_dark'), dk = C('#22241f'), gun = C('#1e1f22');
    M.add(g, prism([[4.6, 1.3], [4.0, 0.75], [1.0, 0.55], [-1.6, 0.7], [-2.2, 1.2], [-2.0, 2.0], [0.2, 2.3], [2.4, 2.2], [3.8, 1.75]], 1.3), ol);
    M.add(g, prism([[4.25, 1.55], [3.7, 2.02], [2.65, 2.12], [2.6, 1.6]], 0.95), glass);
    M.add(g, prism([[2.5, 1.7], [2.5, 2.3], [1.4, 2.45], [1.25, 1.85]], 0.95), glass);
    for (const s of [-1, 1]) { cxl(g, od, 0.34, 2.2, -0.3, 2.15, s * 0.68, 10); cv(g, dk, 0.2, 0.2, 0.05, -1.42, 2.15, s * 0.68, 8, { rz: PI / 2 }); }
    cv(g, dk, 0.13, 0.16, 0.6, 0.1, 2.25, 0, 8);
    bb(g, od, 0.9, 0.1, 3.6, 0.3, 1.35, 0);
    for (const s of [-1, 1]) {
      cxl(g, dk, 0.2, 1.3, 0.4, 1.12, s * 1.25, 10); M.add(g, M.cone(0.2, 0.3, 10), dk, 1.2, 1.12, s * 1.25, { rz: -PI / 2 });
      for (const dz of [-0.08, 0.08]) cxl(g, C('#5a5e52'), 0.06, 1.1, 0.3, 1.18, s * 1.72 + dz, 6);
    }
    M.add(g, M.sphere(0.24, 8, 6), dk, 3.6, 0.55, 0); cxl(g, gun, 0.04, 1.0, 4.2, 0.5, 0, 6);
    rodT(g, ol, 0.44, 0.18, [-1.9, 1.55, 0], [-7.3, 1.9, 0], 10);
    M.add(g, prism([[-6.6, 1.75], [-7.7, 1.75], [-8.1, 3.4], [-7.45, 3.4]], 0.12), ol);
    bb(g, od, 0.65, 0.06, 2.0, -6.4, 1.82, 0);
    for (const s of [-1, 1]) {
      rod(g, dk, 0.05, [-1.6, 0.05, s * 0.95], [2.3, 0.05, s * 0.95], 6); rod(g, dk, 0.05, [2.3, 0.05, s * 0.95], [2.7, 0.28, s * 0.95], 6);
      for (const x of [-0.9, 1.4]) rod(g, dk, 0.04, [x, 0.05, s * 0.95], [x + 0.1, 0.65, s * 0.45], 5);
    }
  });
  const rotor = G(); rotor.position.set(0.1, 2.88, 0); rotor.name = 'rotor';
  rotor.add(cached('ev:heli:rotor', g => {
    const dk = C('#1c1d1a');
    cv(g, dk, 0.3, 0.3, 0.16, 0, -0.08, 0, 10);
    for (let i = 0; i < 4; i++) { const b = G(); b.rotation.y = i * PI / 2; g.add(b); bx(b, dk, 5.6, 0.05, 0.36, 3.0, 0.02, 0); }
  }));
  const mount = G(); mount.position.set(-7.75, 2.75, 0.14); mount.rotation.y = PI / 2;
  const tail = G(); tail.name = 'tail';
  tail.add(cached('ev:heli:tail', g => { const dk = C('#1c1d1a'); bx(g, dk, 0.04, 1.6, 0.16, 0, 0, 0); bx(g, dk, 0.04, 0.16, 1.6, 0, 0, 0); cv(g, dk, 0.08, 0.08, 0.12, 0, -0.06, 0, 8, { rz: PI / 2 }); }));
  mount.add(tail); out.add(rotor, mount);
  out.userData.rotor = rotor;
  out.userData.tail = tail;
  return out;
}
