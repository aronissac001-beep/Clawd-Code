// ============================================================================
// ZONEFALL 3 — characters, animals and held items  (src/gfx/models_chars.js)
//
//   makeHuman(look)  -> Rig     nested pivot rig + procedural animation
//   makeAnimal(kind) -> Rig     'wolf' | 'boar' | 'bear' | 'deer' | 'chicken'
//   makeHeld(id)     -> Group   grip at origin, pointing +X, up +Y
//   HELD_INFO, LOOKS
//
// Everything faces +X at rotation.y = 0, origin at the feet, units = metres.
// Humans use FK for locomotion and a 2-bone arm IK (in "body space": the
// un-yawed frame at the feet) for every weapon / tool pose, so guns, chops,
// throws and reloads stay locked to the hands while the legs walk.
// ============================================================================
import { THREE, M, PAL } from './materials.js';
const _hsl = { h: 0, s: 0, l: 0 };

const PI = Math.PI, TAU = PI * 2, HALF = PI / 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const EASE = [t => t * t * (3 - 2 * t), t => t * t, t => 1 - (1 - t) * (1 - t), t => t];
const EMPTY = {};

// ---------------------------------------------------------------- colour + geometry helpers
const _col = new THREE.Color();
function shade(hex, f) { _col.set(hex); _col.r = Math.min(1, _col.r * f); _col.g = Math.min(1, _col.g * f); _col.b = Math.min(1, _col.b * f); return '#' + _col.getHexString(); }

const GC = {};
/** Box (w along X, h along Y, d along Z) whose top (+Y) face is scaled by tx / tz. */
function tbox(w, h, d, tx = 1, tz = 1) {
  const k = `t${w.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${tx.toFixed(3)},${tz.toFixed(3)}`;
  if (GC[k]) return GC[k];
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * tx); p.setZ(i, p.getZ(i) * tz); }
  g.computeVertexNormals();
  return (GC[k] = g);
}
/** Box whose front (+X) face is scaled by fy / fz (snouts, stocks, wedges). */
function xbox(l, h, d, fy = 1, fz = 1) {
  const k = `x${l.toFixed(4)},${h.toFixed(4)},${d.toFixed(4)},${fy.toFixed(3)},${fz.toFixed(3)}`;
  if (GC[k]) return GC[k];
  const g = new THREE.BoxGeometry(l, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getX(i) > 0) { p.setY(i, p.getY(i) * fy); p.setZ(i, p.getZ(i) * fz); }
  g.computeVertexNormals();
  return (GC[k] = g);
}
/**
 * Chamfered box: octagonal cross-section (vertical edges cut by c) so shapes read
 * rounder from the high camera. o.tx / o.tz scale the top, o.bx / o.bz the bottom,
 * o.bev adds a rounded top edge (inset o.bevS). Flat shaded, non-indexed.
 */
function cbox(w, h, d, c = 0.03, o = {}) {
  const tx = o.tx ?? 1, tz = o.tz ?? 1, bxs = o.bx ?? 1, bzs = o.bz ?? 1, bev = o.bev || 0, bevS = o.bevS ?? 0.8;
  const k = `c${[w, h, d, c, tx, tz, bxs, bzs, bev, bevS].map(v => v.toFixed(4)).join(',')}${o.alongX ? 'X' : ''}`;
  if (GC[k]) return GC[k];
  const hw = w / 2, hd = d / 2; c = Math.min(c, hw * 0.8, hd * 0.8);
  const oct = [[hw, hd - c], [hw - c, hd], [-hw + c, hd], [-hw, hd - c], [-hw, -hd + c], [-hw + c, -hd], [hw - c, -hd], [hw, -hd + c]];
  const ring = (y, sx, sz) => oct.map(([x, z]) => [x * sx, y, z * sz]);
  const rings = [ring(-h / 2, bxs, bzs)];
  if (bev > 0) { rings.push(ring(h / 2 - bev, tx, tz)); rings.push(ring(h / 2, tx * bevS, tz * bevS)); } else rings.push(ring(h / 2, tx, tz));
  const pos = [], uv = [];
  const ctr = [0, 0, 0];
  const tri = (a, b, cc, cap) => {
    // keep the winding pointing away from the shape centre
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const m = [(a[0] + b[0] + cc[0]) / 3 - ctr[0], (a[1] + b[1] + cc[1]) / 3 - ctr[1], (a[2] + b[2] + cc[2]) / 3 - ctr[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { const t = b; b = cc; cc = t; }
    for (const p of [a, b, cc]) { pos.push(p[0], p[1], p[2]); uv.push(cap ? p[0] / 2 : (p[0] + p[2]) / 2, cap ? p[2] / 2 : p[1] / 2); }
  };
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8, A = rings[r][i], B = rings[r][j], C2 = rings[r + 1][j], D2 = rings[r + 1][i];
    tri(A, B, C2); tri(A, C2, D2);
  }
  for (const R of [rings[0], rings[rings.length - 1]]) for (let i = 1; i < 7; i++) tri(R[0], R[i], R[i + 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (o.alongX) g.rotateZ(-HALF);   // "top" becomes the front (+X) face
  g.computeVertexNormals();
  return (GC[k] = g);
}
/** chamfered box lying along X (length l), front (+X) face scaled by fy / fz */
function cxbox(l, h, d, c, fy = 1, fz = 1, o = {}) { return cbox(h, l, d, c, Object.assign({ tx: fy, tz: fz, alongX: true }, o)); }
/** add a chamfered box */
function cb(p, w, h, d, c, col, x = 0, y = 0, z = 0, o, go) { return M.add(p, cbox(w, h, d, c, go || {}), mat(col), x, y, z, o || {}); }
function dome(r, ws = 10, hs = 4) { const k = `d${r},${ws},${hs}`; return GC[k] || (GC[k] = new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, HALF)); }

const mat = (c, o) => (typeof c === 'string' ? M.mat(c, o) : c);
/** add a box */
function bx(p, w, h, d, c, x = 0, y = 0, z = 0, o) { return M.add(p, M.box(w, h, d), mat(c), x, y, z, o); }
/** add any geometry */
function gm(p, geo, c, x = 0, y = 0, z = 0, o) { return M.add(p, geo, mat(c), x, y, z, o); }
/** cylinder along an axis */
function cy(p, rt, rb, len, seg, c, x, y, z, axis = 'y', o = {}) {
  const oo = Object.assign({}, o);
  if (axis === 'x') oo.rz = (o.rz || 0) - HALF; else if (axis === 'z') oo.rx = (o.rx || 0) + HALF;
  const m = M.add(p, M.cyl(rt, rb, len, seg), mat(c), x, y, z, oo);
  if (axis === 'z') m.rotation.order = 'YXZ';
  return m;
}
/** cone pointing along an axis ('x' | 'y' | '-y' | 'z' | '-z') */
function cn(p, r, h, seg, c, x, y, z, axis = 'y', o = {}) {
  const oo = Object.assign({}, o);
  if (axis === 'x') oo.rz = (o.rz || 0) - HALF; else if (axis === '-y') oo.rx = (o.rx || 0) + PI;
  else if (axis === 'z') oo.rx = (o.rx || 0) + HALF; else if (axis === '-z') oo.rx = (o.rx || 0) - HALF;
  const m = M.add(p, M.cone(r, h, seg), mat(c), x, y, z, oo);
  if (axis === 'z' || axis === '-z') m.rotation.order = 'YXZ';
  return m;
}
/** temporary sub-assembly group (flattened away by mergeGroup) */
function sub(p, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const g = new THREE.Group(); g.userData.tmp = true; g.position.set(x, y, z); g.rotation.set(rx, ry, rz); p.add(g); return g; }
function pivot(parent, x = 0, y = 0, z = 0, name) { const g = new THREE.Group(); g.userData.pivot = true; g.position.set(x, y, z); if (name) g.name = name; if (parent) parent.add(g); return g; }

// ---------------------------------------------------------------- draw-call reduction
// Every source mesh is baked into a vertex-coloured, non-indexed geometry and
// merged per material *category* (plain / textured / transparent / glow), so a
// whole character renders in a handful of draw calls. Rigs bind each pivot
// group as a skeleton bone (rigid weights, identity bind) -> one SkinnedMesh
// per category animates exactly like the old per-pivot meshes.
function collect(node, m, out, bone) {
  for (const c of node.children) {
    if (c.userData.pivot || c.userData.keep || c.userData.look) continue;
    c.updateMatrix();
    const mm = new THREE.Matrix4().multiplyMatrices(m, c.matrix);
    if (c.isMesh) out.push([c, mm, bone]);
    else if (c.userData.tmp) collect(c, mm, out, bone);
  }
}
const VCM = new Map();
const catKey = m => `${m.type}|${m.map ? m.map.uuid : ''}|${m.transparent ? 1 : 0}|${m.opacity}|${m.blending}|${m.side}|${m.depthWrite ? 1 : 0}`;
/** shared white vertex-colour twin of a source material (same texture / blending / transparency) */
function vcMat(src) {
  const k = catKey(src);
  let m = VCM.get(k);
  if (!m) { m = src.clone(); m.color.set(0xffffff); m.vertexColors = true; VCM.set(k, m); }
  return m;
}
const _lc = new THREE.Color();
/** non-indexed copy of a mesh's geometry in the target frame, with colour (+ rigid skin) attributes */
function bakeGeo(mesh, matrix, bone) {
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  g.applyMatrix4(matrix);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  _lc.copy(mesh.material.color);   // linear working-space colour
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = _lc.r; col[i * 3 + 1] = _lc.g; col[i * 3 + 2] = _lc.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (bone != null) {
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }
  return g;
}
/** group [mesh, matrix, bone] entries by material category -> Map(key -> { mat, geos, cast }) */
function categorize(list) {
  const cats = new Map();
  for (const [mesh, m, bone] of list) {
    const k = catKey(mesh.material);
    if (!cats.has(k)) cats.set(k, { mat: vcMat(mesh.material), geos: [], cast: false });
    const e = cats.get(k); e.geos.push(bakeGeo(mesh, m, bone)); e.cast = e.cast || mesh.castShadow;
    if (mesh.parent) mesh.parent.remove(mesh);
  }
  return cats;
}
function mergeCat(e) {
  const merged = e.geos.length === 1 ? e.geos[0] : M.mergeGeometries(e.geos, false);
  if (e.geos.length > 1) for (const x of e.geos) x.dispose();
  return merged;
}
function dropTmp(g) { for (const c of [...g.children]) { if (c.userData.tmp) g.remove(c); else if (!c.userData.pivot && !c.userData.keep) dropTmp(c); } }
/** merge a static group (held items) into one plain Mesh per material category */
function mergeVC(g, tag = 'held') {
  const list = []; collect(g, new THREE.Matrix4(), list, null);
  const cats = categorize(list); dropTmp(g);
  for (const e of cats.values()) {
    const geo = mergeCat(e); if (!geo) continue;
    const mesh = new THREE.Mesh(geo, e.mat);
    const glow = e.mat.isMeshBasicMaterial;
    mesh.castShadow = e.cast && !glow; mesh.receiveShadow = !glow;
    mesh.userData[tag] = true; mesh.userData.own = true;
    g.add(mesh);
  }
}
const ID4 = new THREE.Matrix4();
/**
 * Rigid skinning: bones[i] = pivot group i. Geometry stays in each pivot's local
 * space (identity bind / bone inverse) so skinned = boneWorld * localPos, i.e.
 * pixel-identical to meshes parented to the pivots. One SkinnedMesh per category.
 */
function skinBuild(R, bones, sphere) {
  const list = [];
  bones.forEach((b, i) => { collect(b, new THREE.Matrix4(), list, i); });
  const cats = categorize(list);
  for (const b of bones) dropTmp(b);
  const out = [];
  for (const e of cats.values()) {
    const geo = mergeCat(e); if (!geo) continue;
    const mesh = new THREE.SkinnedMesh(geo, e.mat);
    mesh.bind(R.skeleton, ID4);
    mesh.boundingSphere = sphere.clone();   // pose-independent culling volume (scaleG space)
    const glow = e.mat.isMeshBasicMaterial;
    mesh.castShadow = e.cast && !glow; mesh.receiveShadow = !glow;
    mesh.userData.look = true; mesh.userData.own = true;
    R.scaleG.add(mesh);
    out.push(mesh);
  }
  return out;
}
function disposeOwned(obj) { obj.traverse(o => { if (o.isMesh && o.userData.own) o.geometry.dispose(); }); }

// ---------------------------------------------------------------- shared palette bits
const C = {
  ink: '#1c1a22', rubber: '#2a2828', haz: '#d6b13a', burlap: '#a8935f', rope: '#c4aa7a',
  wood: '#8a5c38', woodD: '#5e3d24', woodL: '#a87c4c', stone: '#8e8b85', stoneD: '#6e6b66',
  steel: '#9aa0a8', steelD: '#5a6068', gun: PAL.gun, gunL: PAL.gunLight, rust: PAL.rust,
  olive: '#56603a', oliveD: '#3f4a2a', leather: '#6e4a2e', leatherD: '#3e2b1d', brass: PAL.brass,
  glass: '#3e5462', bone: '#e4dbc4', red: '#b8402f',
};

// ---------------------------------------------------------------- base rig (materials / flash / dispose)
const WHITE = new THREE.Color(1, 1, 1);
class RigBase {
  constructor() {
    this.root = new THREE.Group();
    this.scaleG = new THREE.Group(); this.root.add(this.scaleG);
    this.fall = new THREE.Group(); this.scaleG.add(this.fall);
    this._mats = new Map(); this._flash = 0;
    this.height = 1;
  }
  /** swap every Lambert material under obj for this rig's private clone */
  _adopt(obj) {
    obj.traverse(o => {
      if (!o.isMesh || Array.isArray(o.material)) return;
      const m = o.material;
      if (!m.isMeshLambertMaterial || m.userData.rigOwned) return;
      let c = this._mats.get(m);
      if (!c) {
        c = m.clone(); c.userData.rigOwned = true;
        // comic pop: characters a touch brighter and juicier than the world, and never inky-black in shade
        if (!c.vertexColors) {
          c.color.getHSL(_hsl); c.color.setHSL(_hsl.h, Math.min(1, _hsl.s * 1.25), Math.min(0.85, _hsl.l * 1.12 + 0.03));
          if (c.emissive.r + c.emissive.g + c.emissive.b < 0.01) { c.emissive.copy(c.color).multiplyScalar(0.22); c.emissiveIntensity = 1; }
        } else c.color.multiplyScalar(1.15);
        c.userData.e0 = c.emissive.clone(); c.userData.i0 = c.emissiveIntensity;
        this._mats.set(m, c);
        this._applyFlash(c, this._flash);
      }
      o.material = c;
    });
  }
  /** dispose private materials no longer used by any mesh of this rig (after gear / item swaps) */
  _prune() {
    const used = new Set();
    this.root.traverse(o => { if (o.isMesh && o.material && o.material.userData.rigOwned) used.add(o.material); });
    for (const [k, c] of this._mats) if (!used.has(c)) { c.dispose(); this._mats.delete(k); }
  }
  _applyFlash(c, k) { c.emissive.copy(c.userData.e0).lerp(WHITE, k); c.emissiveIntensity = lerp(c.userData.i0, 1, k); }
  flash(k) {
    k = clamp(k || 0, 0, 1) * 0.85;
    if (Math.abs(k - this._flash) < 0.002) return;
    this._flash = k;
    for (const c of this._mats.values()) this._applyFlash(c, k);
  }
  _clearSkin() { for (const m of this.skinMeshes || []) { m.parent && m.parent.remove(m); m.geometry.dispose(); } this.skinMeshes = []; }
  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    disposeOwned(this.root);
    if (this.skeleton) this.skeleton.dispose();
    for (const c of this._mats.values()) c.dispose();
    this._mats.clear();
  }
}

// ============================================================================
// HELD ITEMS
// ============================================================================
export const HELD_INFO = {
  // tools / melee
  rock:        { kind: 'tool',  twoHand: false, swing: 'chop' },
  torch:       { kind: 'melee', twoHand: false, swing: 'chop', muzzle: [0.52, 0.26, 0], light: true },
  hatchet:     { kind: 'tool',  twoHand: false, swing: 'chop' },
  pickaxe:     { kind: 'tool',  twoHand: true,  swing: 'chop', grip2: [-0.15, 0, 0] },
  salv_axe:    { kind: 'tool',  twoHand: false, swing: 'chop' },
  salv_pick:   { kind: 'tool',  twoHand: true,  swing: 'chop', grip2: [-0.15, 0, 0] },
  knife:       { kind: 'melee', twoHand: false, swing: 'slash' },
  machete:     { kind: 'melee', twoHand: false, swing: 'slash' },
  spear_wood:  { kind: 'melee', twoHand: true,  swing: 'thrust', grip2: [0.36, 0, 0] },
  fishing_rod: { kind: 'tool',  twoHand: false, muzzle: [1.8, 0, 0] },   // muzzle = rod tip (fishing line)
  hammer:      { kind: 'build', twoHand: false, swing: 'chop' },
  buildplan:   { kind: 'build', twoHand: true,  grip2: [0.3, 0, 0] },
  // guns  (muzzle = barrel tip, grip2 = fore-grip for the left hand, mag = where the left hand reloads)
  bow:         { kind: 'gun', twoHand: true,  hand: 'L', muzzle: [0.56, 0.02, 0] },
  pipe_pistol: { kind: 'gun', twoHand: false, muzzle: [0.35, 0.075, 0], mag: [0.0, 0.07, 0] },
  revolver:    { kind: 'gun', twoHand: false, muzzle: [0.3, 0.085, 0], mag: [0.04, 0.07, 0] },
  boomstick:   { kind: 'gun', twoHand: true,  muzzle: [0.6, 0.07, 0], grip2: [0.25, -0.005, 0], mag: [0.07, 0.08, 0] },
  pump:        { kind: 'gun', twoHand: true,  muzzle: [0.78, 0.085, 0], grip2: [0.42, 0.0, 0], mag: [0.16, 0.02, 0] },
  smg:         { kind: 'gun', twoHand: true,  muzzle: [0.5, 0.075, 0], grip2: [0.3, 0.035, 0], mag: [0.12, 0.07, -0.2] },
  ar:          { kind: 'gun', twoHand: true,  muzzle: [0.75, 0.08, 0], grip2: [0.32, 0.02, 0], mag: [0.15, -0.09, 0] },
  hunting:     { kind: 'gun', twoHand: true,  muzzle: [0.96, 0.075, 0], grip2: [0.36, 0.015, 0], mag: [0.1, -0.02, 0] },
  rocket_launcher: { kind: 'gun', twoHand: true, muzzle: [0.84, 0.15, 0], grip2: [0.3, 0.0, 0], mag: [-0.5, 0.15, 0] },
  // extra guns (data in weapons_extra.js)
  crossbow:    { kind: 'gun', twoHand: true,  muzzle: [0.52, 0.1, 0], grip2: [0.3, 0.03, 0], mag: [0.16, 0.05, -0.07] },
  nailgun:     { kind: 'gun', twoHand: false, muzzle: [0.255, -0.026, 0], mag: [0.06, -0.07, 0] },
  semi_rifle:  { kind: 'gun', twoHand: true,  muzzle: [0.88, 0.09, 0], grip2: [0.33, 0.03, 0], mag: [0.12, -0.08, 0] },
  sniper:      { kind: 'gun', twoHand: true,  muzzle: [0.99, 0.085, 0], grip2: [0.38, 0.02, 0], mag: [0.1, -0.02, 0] },
  lmg:         { kind: 'gun', twoHand: true,  muzzle: [0.84, 0.085, 0], grip2: [0.4, 0.03, 0], mag: [0.12, -0.1, -0.04] },
  // throwables
  grenade:       { kind: 'throw', twoHand: false },
  beancan:       { kind: 'throw', twoHand: false },
  satchel:       { kind: 'throw', twoHand: false },
  c4:            { kind: 'throw', twoHand: false },
  supply_signal: { kind: 'throw', twoHand: false },
  // consumables
  bandage:      { kind: 'item', twoHand: false, use: 'arm' },
  medkit:       { kind: 'item', twoHand: false, use: 'arm' },
  stim:         { kind: 'item', twoHand: false, use: 'inject' },
  antirad:      { kind: 'item', twoHand: false, use: 'inject' },
  food:         { kind: 'item', twoHand: false, use: 'mouth' },
  cooked_meat:  { kind: 'item', twoHand: false, use: 'mouth' },
  water_bottle: { kind: 'item', twoHand: false, use: 'mouth' },
  flare:        { kind: 'item', twoHand: false, muzzle: [0.19, 0, 0], light: true },
};
const GENERIC_INFO = { kind: 'item', twoHand: false, use: 'mouth' };

function flameGroup(p, x, y, z, s = 1) {
  const f = new THREE.Group(); f.position.set(x, y, z); f.userData.keep = true; p.add(f);
  const o1 = cn(f, 0.075 * s, 0.27 * s, 7, M.basic('#ff7322', { additive: true }), 0, 0.12 * s, 0);
  const o2 = cn(f, 0.05 * s, 0.2 * s, 6, M.basic('#ffae3a', { additive: true }), 0, 0.09 * s, 0);
  const o3 = cn(f, 0.028 * s, 0.12 * s, 5, M.basic('#fff0b0'), 0, 0.06 * s, 0);
  for (const o of [o1, o2, o3]) { o.castShadow = false; o.receiveShadow = false; }
  f.userData.tip = new THREE.Vector3(0, 0.25 * s, 0);
  return f;
}

const HELD = {
  rock(g) {
    gm(g, M.ico(0.09, 0), M.mat('#8d8a84', { flat: true }), 0.03, 0.005, 0, { sx: 1.25, sy: 0.9, sz: 1.1, rx: 0.4, ry: 0.3 });
    gm(g, M.ico(0.05, 0), M.mat('#a19e97', { flat: true }), 0.07, 0.05, 0.03, { rz: 0.6 });
  },
  torch(g) {
    cy(g, 0.022, 0.028, 0.62, 6, C.wood, 0.16, 0, 0, 'x');
    cy(g, 0.05, 0.042, 0.13, 7, '#3b2a20', 0.47, 0, 0, 'x');
    bx(g, 0.07, 0.1, 0.11, '#5a4030', 0.47, 0.0, 0, { rx: 0.6 });
    g.userData.flame = flameGroup(g, 0.52, 0.0, 0);
  },
  hatchet(g) {
    bx(g, 0.54, 0.042, 0.046, C.wood, 0.16, 0, 0);
    bx(g, 0.13, 0.052, 0.056, C.leatherD, -0.02, 0, 0);
    gm(g, tbox(0.15, 0.17, 0.07, 1.0, 0.4), M.mat(C.stone, { flat: true }), 0.4, -0.06, 0, { rx: PI });
    bx(g, 0.05, 0.07, 0.08, C.rope, 0.4, 0.015, 0, { rz: 0.5 });
    bx(g, 0.05, 0.07, 0.08, C.rope, 0.4, 0.015, 0, { rz: -0.5 });
  },
  pickaxe(g) {
    bx(g, 0.66, 0.046, 0.046, C.wood, 0.2, 0, 0);
    bx(g, 0.12, 0.054, 0.054, C.leatherD, -0.05, 0, 0);
    gm(g, tbox(0.065, 0.2, 0.065, 0.4, 0.4), M.mat(C.stone, { flat: true }), 0.5, 0.1, 0, { rz: 0.35 });
    gm(g, tbox(0.065, 0.2, 0.065, 0.4, 0.4), M.mat(C.stone, { flat: true }), 0.5, -0.08, 0, { rz: PI - 0.4 });
    bx(g, 0.07, 0.07, 0.075, C.rope, 0.51, 0.01, 0, { rz: 0.6 });
  },
  salv_axe(g) {
    cy(g, 0.024, 0.024, 0.6, 6, C.steelD, 0.17, 0, 0, 'x');
    cy(g, 0.031, 0.031, 0.18, 6, '#262626', -0.02, 0, 0, 'x');
    bx(g, 0.18, 0.19, 0.03, M.mat(C.rust, { tex: 'metal' }), 0.41, -0.07, 0);
    bx(g, 0.19, 0.03, 0.034, '#b9bdc2', 0.41, -0.165, 0);
    bx(g, 0.07, 0.08, 0.05, C.steelD, 0.43, 0.015, 0);
    bx(g, 0.02, 0.02, 0.05, '#2a2a2a', 0.36, -0.06, 0); bx(g, 0.02, 0.02, 0.05, '#2a2a2a', 0.46, -0.06, 0);
  },
  salv_pick(g) {
    cy(g, 0.024, 0.024, 0.66, 6, C.steelD, 0.2, 0, 0, 'x');
    cy(g, 0.031, 0.031, 0.18, 6, '#262626', -0.04, 0, 0, 'x');
    gm(g, tbox(0.05, 0.24, 0.05, 0.35, 0.5), M.mat('#7d4a32', { tex: 'metal' }), 0.52, 0.12, 0, { rz: 0.3 });
    gm(g, tbox(0.05, 0.22, 0.05, 0.35, 0.5), M.mat('#7d4a32', { tex: 'metal' }), 0.52, -0.1, 0, { rz: PI - 0.35 });
    bx(g, 0.09, 0.08, 0.07, C.steelD, 0.52, 0.01, 0);
  },
  knife(g) {
    bx(g, 0.12, 0.036, 0.04, '#3a2a20', -0.02, 0, 0);
    bx(g, 0.022, 0.03, 0.075, C.steelD, 0.045, 0, 0);
    bx(g, 0.18, 0.012, 0.052, '#c4c8ce', 0.145, 0, 0);
    bx(g, 0.07, 0.012, 0.036, '#c4c8ce', 0.255, 0, -0.008, { ry: 0.4 });
  },
  machete(g) {
    bx(g, 0.15, 0.04, 0.046, '#2e2a26', -0.03, 0, 0);
    bx(g, 0.02, 0.034, 0.06, C.steelD, 0.05, 0, 0);
    gm(g, xbox(0.44, 0.012, 0.064, 1, 1.4), M.mat('#b4b8bd'), 0.28, 0, -0.006);
    bx(g, 0.42, 0.016, 0.012, '#6c7178', 0.27, 0, 0.03);
    bx(g, 0.08, 0.012, 0.07, '#b4b8bd', 0.52, 0, -0.014, { ry: 0.5 });
  },
  spear_wood(g) {
    cy(g, 0.022, 0.024, 1.6, 6, '#9a7448', 0.18, 0, 0, 'x');
    cn(g, 0.034, 0.22, 6, '#4a3524', 1.09, 0, 0, 'x');
    cy(g, 0.03, 0.03, 0.08, 6, C.rope, 0.95, 0, 0, 'x');
    cy(g, 0.03, 0.03, 0.1, 6, C.leatherD, 0.0, 0, 0, 'x');
  },
  fishing_rod(g) {   // 1.8 m spinning rod: cork grips, reel seat + reel underneath, tapered blank with guides, tip at x = 1.8
    const cork = '#c9a06a', dark = '#2a2828';
    cy(g, 0.019, 0.019, 0.03, 8, dark, -0.245, 0, 0, 'x');
    cy(g, 0.017, 0.019, 0.2, 8, cork, -0.13, 0, 0, 'x');
    cy(g, 0.014, 0.014, 0.09, 8, '#3a3c42', 0.015, 0, 0, 'x');
    cy(g, 0.013, 0.016, 0.1, 8, cork, 0.11, 0, 0, 'x');
    cy(g, 0.0035, 0.01, 1.64, 6, '#4a3020', 0.98, 0, 0, 'x');
    for (const [x, r] of [[0.42, 0.012], [0.78, 0.009], [1.1, 0.007], [1.38, 0.006], [1.6, 0.005]]) {
      bx(g, 0.006, r + 0.008, 0.004, C.steel, x, -0.006 - r * 0.5, 0);
      cy(g, r, r, 0.004, 6, C.steelD, x, -0.012 - r, 0, 'x');
    }
    cy(g, 0.005, 0.005, 0.014, 5, C.steelD, 1.795, 0, 0, 'x');
    // spinning reel hanging under the seat: stem, body, spool with line, crank on the left
    bx(g, 0.012, 0.05, 0.014, '#3a3c42', 0.015, -0.035, 0);
    cy(g, 0.024, 0.02, 0.06, 10, '#55585e', 0.0, -0.068, 0, 'x');
    cy(g, 0.026, 0.026, 0.03, 10, '#c49a45', 0.045, -0.068, 0, 'x');
    cy(g, 0.0265, 0.0265, 0.014, 10, '#e8e4d8', 0.045, -0.068, 0, 'x');
    bx(g, 0.012, 0.012, 0.05, dark, -0.005, -0.068, -0.045);
    cy(g, 0.009, 0.009, 0.026, 6, dark, -0.005, -0.068, -0.075, 'z');
  },
  hammer(g) {
    bx(g, 0.48, 0.042, 0.042, C.wood, 0.14, 0, 0);
    bx(g, 0.12, 0.05, 0.05, C.leatherD, -0.03, 0, 0);
    cy(g, 0.08, 0.08, 0.22, 8, C.woodL, 0.41, 0, 0, 'y');
    cy(g, 0.083, 0.083, 0.03, 8, C.woodD, 0.41, 0.095, 0, 'y');
    cy(g, 0.083, 0.083, 0.03, 8, C.woodD, 0.41, -0.095, 0, 'y');
  },
  buildplan(g) {
    cy(g, 0.045, 0.045, 0.4, 8, '#3c6aa8', 0.15, 0, 0, 'x');
    cy(g, 0.047, 0.047, 0.02, 8, '#e8eef2', 0.02, 0, 0, 'x');
    cy(g, 0.047, 0.047, 0.02, 8, '#e8eef2', 0.28, 0, 0, 'x');
    bx(g, 0.36, 0.006, 0.2, '#4a7cc0', 0.15, -0.035, -0.13, { rx: 0.2 });
    for (const z of [-0.07, -0.14, -0.2]) bx(g, 0.3, 0.008, 0.008, '#dfe8f4', 0.15, -0.03 - (z + 0.07) * 0.2, z, { rx: 0.2 });
    bx(g, 0.008, 0.008, 0.16, '#dfe8f4', 0.08, -0.04, -0.13, { rx: 0.2 });
  },
  // ---------------------------------------------------------------- guns
  bow(g) {
    const wd = M.mat('#6a4428'), lt = M.mat('#8a5c34');
    bx(g, 0.06, 0.06, 0.15, wd, 0, 0, 0);
    bx(g, 0.066, 0.066, 0.08, C.leatherD, 0, 0, 0);
    for (const s of [1, -1]) {
      bx(g, 0.04, 0.026, 0.32, lt, -0.035, 0, s * 0.22, { ry: s * -0.28 });
      bx(g, 0.032, 0.024, 0.12, lt, -0.08, 0, s * 0.42, { ry: s * 0.45 });
    }
    // body + arrow + both string halves are ONE mesh; setDraw moves the arrow / nock vertices
    const body = []; collect(g, new THREE.Matrix4(), body, null);
    const arrow = new THREE.Group();
    bx(arrow, 0.62, 0.014, 0.014, '#cfb488', 0.31, 0, 0);
    cn(arrow, 0.022, 0.07, 4, C.steelD, 0.65, 0, 0, 'x');
    bx(arrow, 0.09, 0.035, 0.004, C.red, 0.04, 0, 0); bx(arrow, 0.09, 0.004, 0.035, C.red, 0.04, 0, 0);
    const arr = []; collect(arrow, new THREE.Matrix4().makeTranslation(0, 0.02, 0), arr, null);
    const sm = M.mat('#e8e2d0');
    const strs = [bx(null, 1, 0.008, 0.008, sm), bx(null, 1, 0.008, 0.008, sm)].map(m => [m, new THREE.Matrix4(), null]);
    const parts = [...body, ...arr, ...strs];
    const geos = parts.map(([m, mm]) => bakeGeo(m, mm, null));
    const cnt = geos.map(x => x.attributes.position.count);
    const nB = cnt.slice(0, body.length).reduce((a, b) => a + b, 0), nA = cnt.slice(body.length, body.length + arr.length).reduce((a, b) => a + b, 0), nS = cnt[cnt.length - 1];
    const geo = M.mergeGeometries(geos, false); for (const x of geos) x.dispose();
    for (const [m] of body) g.remove(m);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.1, 0, 0), 0.8);
    const mesh = new THREE.Mesh(geo, vcMat(wd)); mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.keep = true; mesh.userData.own = true; mesh.userData.held = true;
    g.add(mesh);
    const pos = geo.attributes.position.array, base = pos.slice();
    const tips = [[-0.06, 0.47], [-0.06, -0.47]];
    let last = -1;
    g.userData.setDraw = d => {
      if (Math.abs(d - last) < 1e-4) return; last = d;
      const nx = -0.07 - d * 0.36;
      for (let i = nB; i < nB + nA; i++) pos[i * 3] = base[i * 3] + nx;
      tips.forEach(([tx, tz], k) => {
        const dx = nx - tx, dz = -tz, len = Math.hypot(dx, dz), px = -dz / len, pz = dx / len;
        for (let i = nB + nA + k * nS, e = i + nS; i < e; i++) {
          const t = base[i * 3] + 0.5, bz = base[i * 3 + 2];
          pos[i * 3] = tx + t * dx + px * bz; pos[i * 3 + 1] = base[i * 3 + 1]; pos[i * 3 + 2] = tz + t * dz + pz * bz;
        }
      });
      geo.attributes.position.needsUpdate = true;
    };
    g.userData.setDraw(0);
  },
  pipe_pistol(g) {
    cy(g, 0.032, 0.034, 0.32, 7, M.mat('#77706a', { tex: 'metal' }), 0.18, 0.075, 0, 'x');
    bx(g, 0.11, 0.085, 0.072, '#3a3836', 0.0, 0.07, 0);
    gm(g, tbox(0.07, 0.17, 0.056, 1.15, 1), M.mat(C.wood), -0.035, -0.035, 0, { rz: 0.28 });
    bx(g, 0.06, 0.012, 0.022, '#2a2a2a', 0.035, -0.012, 0);
    cy(g, 0.037, 0.037, 0.04, 7, '#2a2626', 0.13, 0.075, 0, 'x');
    cy(g, 0.037, 0.037, 0.035, 7, '#2a2626', 0.27, 0.075, 0, 'x');
    bx(g, 0.035, 0.045, 0.024, C.steelD, -0.055, 0.125, 0, { rz: 0.4 });
  },
  revolver(g) {
    bx(g, 0.21, 0.045, 0.038, C.gunL, 0.18, 0.085, 0);
    bx(g, 0.2, 0.016, 0.02, C.gun, 0.18, 0.113, 0);
    bx(g, 0.13, 0.085, 0.05, C.gun, 0.02, 0.07, 0);
    cy(g, 0.046, 0.046, 0.08, 8, C.gunL, 0.04, 0.07, 0, 'x');
    gm(g, tbox(0.06, 0.15, 0.052, 1.2, 1), M.mat('#6a4228'), -0.04, -0.03, 0, { rz: 0.35 });
    bx(g, 0.035, 0.035, 0.022, C.gun, -0.045, 0.12, 0, { rz: 0.3 });
    bx(g, 0.03, 0.04, 0.012, C.gunL, 0.27, 0.115, 0);
  },
  boomstick(g) {
    for (const s of [1, -1]) cy(g, 0.031, 0.031, 0.52, 7, '#5a5d63', 0.33, 0.072, s * 0.032, 'x');
    bx(g, 0.5, 0.02, 0.03, C.gun, 0.33, 0.104, 0);
    bx(g, 0.14, 0.095, 0.1, C.gun, 0.03, 0.06, 0);
    bx(g, 0.2, 0.055, 0.092, '#7a4a2a', 0.25, 0.03, 0);
    gm(g, xbox(0.2, 0.08, 0.066, 1, 1), M.mat('#7a4a2a'), -0.1, 0.0, 0, { rz: 0.32 });
    gm(g, xbox(0.08, 0.13, 0.072, 0.7, 1), M.mat('#6a3f24'), -0.21, -0.045, 0, { rz: 0.3 });
  },
  pump(g) {
    cy(g, 0.027, 0.027, 0.62, 7, C.gun, 0.46, 0.085, 0, 'x');
    cy(g, 0.023, 0.023, 0.46, 7, C.gunL, 0.38, 0.042, 0, 'x');
    bx(g, 0.18, 0.068, 0.078, '#7a4a2a', 0.43, 0.036, 0);
    bx(g, 0.23, 0.105, 0.078, C.gun, 0.04, 0.066, 0);
    gm(g, tbox(0.06, 0.11, 0.05, 1.2, 1), M.mat('#6a3f24'), -0.05, -0.03, 0, { rz: 0.35 });
    gm(g, xbox(0.32, 0.13, 0.066, 0.6, 1), M.mat('#7a4a2a'), -0.24, 0.02, 0, { rz: 0.12 });
    bx(g, 0.03, 0.14, 0.072, '#1e1e1e', -0.405, -0.0, 0, { rz: 0.12 });
  },
  smg(g) {
    const st = M.mat('#6b7076', { tex: 'metal' });
    bx(g, 0.3, 0.09, 0.07, st, 0.08, 0.065, 0);
    bx(g, 0.304, 0.014, 0.074, '#4a4e54', 0.08, 0.025, 0);
    cy(g, 0.036, 0.036, 0.22, 7, '#3a3c40', 0.33, 0.072, 0, 'x');
    cy(g, 0.016, 0.016, 0.06, 6, '#2a2a2c', 0.465, 0.072, 0, 'x');
    bx(g, 0.06, 0.055, 0.21, C.gun, 0.12, 0.068, -0.135);
    gm(g, tbox(0.055, 0.12, 0.05, 1.2, 1), M.mat('#2a2a2c'), -0.03, -0.03, 0, { rz: 0.25 });
    for (const s of [1, -1]) bx(g, 0.24, 0.016, 0.016, C.steelD, -0.18, 0.075, s * 0.026);
    bx(g, 0.024, 0.1, 0.07, C.steelD, -0.3, 0.05, 0);
  },
  ar(g) {
    const wd = M.mat('#8a5228'), wdD = M.mat('#6a3c1e');
    bx(g, 0.3, 0.092, 0.066, C.gun, 0.06, 0.07, 0);
    bx(g, 0.26, 0.028, 0.06, C.gunL, 0.05, 0.128, 0);
    bx(g, 0.2, 0.076, 0.078, wd, 0.32, 0.064, 0);
    bx(g, 0.17, 0.032, 0.05, wd, 0.31, 0.118, 0);
    cy(g, 0.018, 0.018, 0.3, 6, C.gun, 0.56, 0.08, 0, 'x');
    bx(g, 0.03, 0.05, 0.02, C.gun, 0.65, 0.108, 0);
    cy(g, 0.026, 0.026, 0.06, 6, C.gun, 0.72, 0.08, 0, 'x');
    bx(g, 0.072, 0.12, 0.046, '#3a2e26', 0.135, -0.03, 0, { rz: -0.2 });
    bx(g, 0.07, 0.11, 0.045, '#3a2e26', 0.17, -0.13, 0, { rz: -0.5 });
    gm(g, tbox(0.055, 0.12, 0.05, 1.2, 1), wdD, -0.035, -0.04, 0, { rz: 0.35 });
    gm(g, xbox(0.3, 0.13, 0.056, 0.55, 1), wd, -0.21, 0.03, 0, { rz: 0.06 });
    bx(g, 0.025, 0.135, 0.06, '#1e1e1e', -0.365, 0.02, 0, { rz: 0.06 });
  },
  hunting(g) {
    const wd = M.mat('#7a4a2a');
    gm(g, xbox(0.62, 0.075, 0.062, 0.75, 1), wd, 0.06, 0.035, 0);
    gm(g, xbox(0.24, 0.13, 0.062, 0.55, 1), wd, -0.33, 0.015, 0, { rz: 0.05 });
    bx(g, 0.025, 0.135, 0.066, '#1e1e1e', -0.46, 0.008, 0, { rz: 0.05 });
    cy(g, 0.019, 0.016, 0.64, 6, C.gun, 0.63, 0.075, 0, 'x');
    cy(g, 0.03, 0.03, 0.2, 7, C.gunL, 0.08, 0.085, 0, 'x');
    cy(g, 0.032, 0.032, 0.28, 7, '#222326', 0.08, 0.16, 0, 'x');
    cy(g, 0.042, 0.032, 0.05, 7, '#222326', 0.24, 0.16, 0, 'x');
    cy(g, 0.032, 0.04, 0.05, 7, '#222326', -0.08, 0.16, 0, 'x');
    bx(g, 0.03, 0.05, 0.03, C.gun, 0.02, 0.12, 0); bx(g, 0.03, 0.05, 0.03, C.gun, 0.15, 0.12, 0);
    bx(g, 0.02, 0.02, 0.08, C.gunL, -0.01, 0.085, 0.05);
    gm(g, M.sphere(0.022, 6, 4), C.gunL, -0.01, 0.075, 0.095);
  },
  rocket_launcher(g) {
    const ol = M.mat('#58623c', { tex: 'metal' });
    cy(g, 0.078, 0.078, 1.1, 8, ol, 0.04, 0.15, 0, 'x');
    for (const x of [-0.32, 0.36]) cy(g, 0.083, 0.083, 0.04, 8, '#2e3226', x, 0.15, 0, 'x');
    cy(g, 0.098, 0.08, 0.09, 8, '#2e3226', -0.55, 0.15, 0, 'x');
    cy(g, 0.06, 0.07, 0.07, 8, '#6a7448', 0.63, 0.15, 0, 'x');
    cn(g, 0.06, 0.16, 8, '#7a8452', 0.745, 0.15, 0, 'x');
    gm(g, tbox(0.06, 0.13, 0.05, 1.2, 1), M.mat('#222'), 0.0, -0.0, 0, { rz: 0.2 });
    bx(g, 0.05, 0.11, 0.05, '#222', 0.3, 0.04, 0);
    bx(g, 0.07, 0.09, 0.035, '#2a2a2a', 0.12, 0.25, -0.06);
    bx(g, 0.22, 0.035, 0.11, '#3a2c22', -0.18, 0.066, 0);
  },
  // ---------------------------------------------------------------- extra guns (weapons_extra.js)
  // Part colours below are unique per model: fp/viewmodel.js finds the moving bits by them.
  crossbow(g) {   // Ratchet Crossbow: wooden stock + tiller, steel recurve prod with orange tips and a foot stirrup, ratchet crank on the left; string cocked, arrow on the rail
    const wd = M.mat('#8a5530'), wdD = M.mat('#5e3a20'), lim = '#3e434a', tip = '#d8572a';
    gm(g, xbox(0.28, 0.12, 0.052, 0.6, 1), wd, -0.2, 0.03, 0, { rz: 0.07 });            // butt
    bx(g, 0.024, 0.126, 0.058, '#1e1e1e', -0.345, 0.02, 0, { rz: 0.07 });
    gm(g, tbox(0.055, 0.12, 0.05, 1.2, 1), wdD, -0.035, -0.04, 0, { rz: 0.35 });        // pistol grip
    bx(g, 0.58, 0.05, 0.056, wd, 0.2, 0.055, 0);                                         // tiller
    bx(g, 0.2, 0.026, 0.06, wdD, 0.3, 0.02, 0);                                          // fore-grip pad
    bx(g, 0.42, 0.012, 0.03, C.steelD, 0.27, 0.086, 0);                                  // rail
    bx(g, 0.11, 0.046, 0.066, C.gun, 0.03, 0.07, 0);                                     // latch box
    bx(g, 0.008, 0.026, 0.008, C.gun, -0.004, 0.106, 0);                                 // rear peep: stem + ring
    for (const [yy, h] of [[0.142, 0.006], [0.114, 0.006]]) bx(g, 0.006, h, 0.026, C.gun, -0.004, yy, 0);
    for (const s of [1, -1]) bx(g, 0.006, 0.034, 0.006, C.gun, -0.004, 0.128, s * 0.012);
    bx(g, 0.075, 0.075, 0.09, C.gun, 0.49, 0.06, 0);                                     // prod block
    bx(g, 0.008, 0.03, 0.008, tip, 0.5, 0.112, 0);                                       // front post
    for (const s of [1, -1]) {
      bx(g, 0.036, 0.032, 0.2, lim, 0.47, 0.06, s * 0.13, { ry: -s * 0.28 });            // limbs, swept back
      bx(g, 0.03, 0.028, 0.15, lim, 0.4, 0.06, s * 0.285, { ry: -s * 0.62 });
      bx(g, 0.034, 0.036, 0.034, tip, 0.356, 0.062, s * 0.343);                           // tip caps
      bx(g, 0.08, 0.016, 0.016, C.steelD, 0.565, 0.042, s * 0.036, { rz: -0.45 });       // stirrup
    }
    bx(g, 0.016, 0.016, 0.088, C.steelD, 0.6, 0.026, 0);
    // ratchet crank on the left side (disc static; arm + knob turn while cocking)
    cy(g, 0.032, 0.032, 0.014, 10, C.gun, 0.16, 0.05, -0.036, 'z');
    for (let i = 0; i < 8; i++) { const a = i * PI / 4; bx(g, 0.012, 0.012, 0.012, C.gun, 0.16 + Math.cos(a) * 0.034, 0.05 + Math.sin(a) * 0.034, -0.036); }
    const ca = -2.4, cx = 0.16 + Math.cos(ca) * 0.0275, cyy = 0.05 + Math.sin(ca) * 0.0275;
    bx(g, 0.07, 0.014, 0.01, '#a7adb5', cx, cyy, -0.048, { rz: ca });
    cy(g, 0.011, 0.011, 0.03, 7, '#b8402f', 0.16 + Math.cos(ca) * 0.056, 0.05 + Math.sin(ca) * 0.056, -0.064, 'z');
    // string halves (cocked to the latch) and the arrow
    const L = Math.hypot(0.28, 0.343), fy = 0.0795;
    bx(g, L, 0.008, 0.008, '#e8e2d0', 0.218, fy, 0.1715, { ry: -Math.atan2(0.343, 0.28) });
    bx(g, L, 0.008, 0.008, '#d9d2bf', 0.218, fy, -0.1715, { ry: Math.atan2(0.343, 0.28) });
    bx(g, 0.385, 0.014, 0.014, '#cdb27c', 0.2775, 0.1, 0);
    cn(g, 0.016, 0.05, 4, '#5f656e', 0.495, 0.1, 0, 'x');
    bx(g, 0.07, 0.026, 0.003, '#c23a2a', 0.12, 0.108, 0); bx(g, 0.07, 0.003, 0.026, '#c23a2a', 0.12, 0.1, 0);
  },
  nailgun(g) {    // Nailgun: yellow tool housing with a drive head at the front, black rubber grip on a battery pack, angled nail magazine under the nose
    const yel = M.mat('#e0a43a'), yelD = M.mat('#b8822a'), blk = '#26272a';
    cb(g, 0.22, 0.08, 0.066, 0.018, yel, 0.04, 0.07, 0);                                  // housing
    cy(g, 0.042, 0.042, 0.15, 10, yel, 0.17, 0.045, 0);                                  // drive head
    cy(g, 0.045, 0.045, 0.03, 10, blk, 0.17, 0.0, 0);                                    // rubber band
    cy(g, 0.046, 0.046, 0.014, 10, yelD, 0.17, 0.122, 0);                                // head cap
    bx(g, 0.06, 0.02, 0.07, blk, -0.04, 0.115, 0);                                       // rubber top / vents
    for (let i = 0; i < 3; i++) bx(g, 0.01, 0.006, 0.072, '#141416', -0.06 + i * 0.02, 0.127, 0);
    bx(g, 0.014, 0.012, 0.02, blk, -0.06, 0.13, 0);                                      // rear notch
    bx(g, 0.012, 0.012, 0.012, '#e8572a', 0.19, 0.134, 0);                               // front bead
    gm(g, tbox(0.052, 0.12, 0.05, 1.15, 1), blk, -0.035, -0.03, 0, { rz: 0.35 });        // grip
    bx(g, 0.012, 0.03, 0.012, C.steelD, 0.018, 0.012, 0, { rz: -0.3 });                  // trigger
    bx(g, 0.12, 0.045, 0.076, blk, -0.02, -0.105, 0);                                    // battery
    bx(g, 0.122, 0.01, 0.078, '#e0a43a', -0.02, -0.09, 0);
    bx(g, 0.045, 0.05, 0.036, C.steel, 0.2, -0.02, 0);                                   // nose / driver guide
    bx(g, 0.03, 0.026, 0.026, C.steelD, 0.235, -0.026, 0);
    // magazine rail from the nose back towards the battery; the nail strip in it is the moving part
    bx(g, 0.18, 0.02, 0.046, '#55595f', 0.12, -0.066, 0, { rz: 0.3 });
    bx(g, 0.15, 0.014, 0.028, '#c9ced6', 0.125, -0.051, 0, { rz: 0.3 });                // nail heads
    bx(g, 0.15, 0.006, 0.032, '#c8402e', 0.125, -0.059, 0, { rz: 0.3 });                // paper band
  },
  semi_rifle(g) { // Ridgeback Carbine: walnut stock and pistol grip, ridged upper handguard, blued receiver, straight 16-round box mag, peep + hooded post sights
    const wd = M.mat('#9a5a2e'), wdD = M.mat('#6e3e1e'), bl = '#2c3036';
    gm(g, xbox(0.28, 0.125, 0.058, 0.6, 1), wd, -0.24, 0.035, 0, { rz: 0.07 });          // butt
    bx(g, 0.026, 0.13, 0.062, '#1e1e1e', -0.385, 0.026, 0, { rz: 0.07 });
    gm(g, tbox(0.055, 0.12, 0.05, 1.2, 1), wdD, -0.035, -0.04, 0, { rz: 0.35 });         // pistol grip
    bx(g, 0.26, 0.08, 0.064, bl, 0.06, 0.085, 0);                                        // receiver
    bx(g, 0.2, 0.02, 0.05, '#3a3f46', 0.05, 0.134, 0);                                   // receiver top
    bx(g, 0.035, 0.018, 0.04, C.steelD, 0.12, 0.1, 0.05);                                // charging handle (right)
    bx(g, 0.34, 0.06, 0.066, wd, 0.36, 0.06, 0);                                         // fore-end
    bx(g, 0.3, 0.026, 0.05, wdD, 0.36, 0.1, 0);                                          // ridge handguard
    cy(g, 0.016, 0.016, 0.34, 7, bl, 0.66, 0.09, 0, 'x');                                // barrel
    cy(g, 0.022, 0.022, 0.065, 7, '#1c1e22', 0.855, 0.09, 0, 'x');                       // flash hider
    for (const s of [1, -1]) bx(g, 0.04, 0.005, 0.005, '#0e0f12', 0.86, 0.09, s * 0.023);
    bx(g, 0.03, 0.03, 0.03, bl, 0.75, 0.115, 0);                                         // front sight base
    for (const s of [1, -1]) bx(g, 0.026, 0.034, 0.005, bl, 0.75, 0.145, s * 0.014);     // hood wings
    bx(g, 0.006, 0.028, 0.006, '#e8d27a', 0.75, 0.14, 0);                                // post (brass bead)
    bx(g, 0.024, 0.04, 0.03, bl, -0.045, 0.16, 0);                                       // rear peep
    bx(g, 0.026, 0.012, 0.012, '#0e0f12', -0.045, 0.165, 0);
    bx(g, 0.074, 0.14, 0.046, '#33363c', 0.11, -0.025, 0, { rz: -0.06 });                // magazine
    bx(g, 0.078, 0.016, 0.05, '#4a4e56', 0.106, -0.09, 0, { rz: -0.06 });
    bx(g, 0.07, 0.012, 0.05, bl, 0.03, 0.03, 0);                                         // trigger guard
  },
  sniper(g) {     // Longreach Sniper: khaki stock with cheek riser, long fluted barrel with a ported brake, big scope with a wide bell and turrets, folded bipod
    const kh = M.mat('#8f8458'), khD = M.mat('#6b6442'), sc = '#25272b';
    gm(g, xbox(0.3, 0.14, 0.064, 0.62, 1), kh, -0.34, 0.012, 0, { rz: 0.04 });          // butt
    bx(g, 0.03, 0.15, 0.07, '#1e1e1e', -0.5, 0.004, 0, { rz: 0.04 });
    bx(g, 0.2, 0.036, 0.05, khD, -0.31, 0.098, 0);                                       // cheek riser
    gm(g, xbox(0.24, 0.085, 0.064, 0.82, 1), kh, -0.08, 0.035, 0);                       // wrist
    gm(g, xbox(0.44, 0.075, 0.066, 0.72, 0.9), kh, 0.3, 0.04, 0);                        // fore-end
    for (let i = 0; i < 3; i++) bx(g, 0.05, 0.008, 0.068, khD, 0.2 + i * 0.08, 0.02, 0); // grip grooves
    cy(g, 0.031, 0.031, 0.27, 8, C.gun, 0.08, 0.085, 0, 'x');                            // receiver
    bx(g, 0.02, 0.02, 0.08, C.gunL, -0.01, 0.085, 0.05); gm(g, M.sphere(0.022, 6, 4), C.gunL, -0.01, 0.075, 0.095);   // bolt (as the hunting rifle)
    bx(g, 0.08, 0.055, 0.05, '#2a2b2e', 0.1, 0.005, 0);                                  // 5-round mag
    cy(g, 0.023, 0.019, 0.72, 8, C.gun, 0.575, 0.085, 0, 'x');                           // barrel
    for (const s of [1, -1]) bx(g, 0.5, 0.006, 0.004, '#1b1c1f', 0.5, 0.085, s * 0.02);  // flutes
    bx(g, 0.09, 0.05, 0.054, '#3a3c40', 0.94, 0.085, 0);                                 // brake
    for (const xx of [0.915, 0.94, 0.965]) bx(g, 0.012, 0.032, 0.058, '#141518', xx, 0.085, 0);
    // scope + rings
    for (const xx of [0.0, 0.17]) { bx(g, 0.03, 0.05, 0.05, C.gun, xx, 0.13, 0); }
    cy(g, 0.025, 0.025, 0.28, 10, sc, 0.08, 0.17, 0, 'x');
    cy(g, 0.044, 0.026, 0.1, 10, sc, 0.27, 0.17, 0, 'x');                                // objective bell
    cy(g, 0.044, 0.044, 0.02, 10, '#3a3d42', 0.33, 0.17, 0, 'x');
    cy(g, 0.036, 0.036, 0.004, 10, '#3e6a8a', 0.341, 0.17, 0, 'x');                      // lens
    cy(g, 0.028, 0.033, 0.07, 10, sc, -0.095, 0.17, 0, 'x');                             // eyepiece
    cy(g, 0.016, 0.016, 0.03, 8, sc, 0.09, 0.205, 0);                                    // turrets
    cy(g, 0.016, 0.016, 0.03, 8, sc, 0.09, 0.17, 0.035, 'z');
    bx(g, 0.012, 0.006, 0.034, '#c49a45', 0.09, 0.221, 0);
    // bipod folded along the fore-end
    bx(g, 0.04, 0.03, 0.06, C.gun, 0.47, 0.0, 0);
    for (const s of [1, -1]) bx(g, 0.26, 0.014, 0.014, '#3a3c40', 0.34, -0.01, s * 0.024);
  },
  lmg(g) {        // Thresher LMG: olive receiver with a hinged feed cover, ported barrel shroud, carry handle, conical flash hider, bipod, ammo box and brass belt on the left
    const ol = M.mat('#4f5638'), olD = M.mat('#3c4230'), blk = '#232427';
    gm(g, xbox(0.32, 0.12, 0.06, 0.7, 1), blk, -0.29, 0.04, 0, { rz: 0.05 });           // stock
    bx(g, 0.026, 0.13, 0.066, '#141416', -0.455, 0.032, 0, { rz: 0.05 });
    gm(g, tbox(0.055, 0.12, 0.05, 1.2, 1), blk, -0.035, -0.04, 0, { rz: 0.35 });         // pistol grip
    bx(g, 0.42, 0.1, 0.084, ol, 0.08, 0.075, 0);                                         // receiver
    bx(g, 0.42, 0.012, 0.088, olD, 0.08, 0.03, 0);
    bx(g, 0.3, 0.024, 0.082, '#5a6440', 0.1, 0.137, 0);                                  // feed cover (moves)
    bx(g, 0.02, 0.03, 0.03, '#5a6440', -0.035, 0.162, 0);                                // rear sight on the cover
    bx(g, 0.022, 0.012, 0.012, '#0e0f12', -0.035, 0.172, 0);
    bx(g, 0.04, 0.04, 0.03, olD, -0.07, 0.13, 0);                                        // cover hinge
    bx(g, 0.03, 0.02, 0.05, C.steelD, 0.2, 0.1, 0.05);                                   // charging handle (right)
    cy(g, 0.036, 0.036, 0.44, 10, olD, 0.51, 0.085, 0, 'x');                             // barrel shroud
    for (let i = 0; i < 5; i++) {
      const xx = 0.35 + i * 0.075;
      for (const s of [1, -1]) bx(g, 0.03, 0.016, 0.006, '#1a1c16', xx, 0.085, s * 0.035);
      bx(g, 0.03, 0.006, 0.016, '#1a1c16', xx, 0.12, 0);
    }
    cy(g, 0.017, 0.017, 0.1, 7, blk, 0.77, 0.085, 0, 'x');                               // barrel
    cn(g, 0.032, 0.07, 8, blk, 0.835, 0.085, 0, 'x', { rz: PI });                    // flash hider (flares forward)
    bx(g, 0.012, 0.05, 0.012, blk, 0.72, 0.13, 0);                                       // front post
    bx(g, 0.03, 0.02, 0.03, blk, 0.72, 0.11, 0);
    // carry handle over the shroud (left side, clear of the sights)
    bx(g, 0.03, 0.06, 0.02, blk, 0.33, 0.135, -0.03); bx(g, 0.03, 0.06, 0.02, blk, 0.47, 0.135, -0.03);
    bx(g, 0.18, 0.024, 0.024, blk, 0.4, 0.165, -0.03);
    // bipod folded forward under the shroud
    bx(g, 0.04, 0.026, 0.07, blk, 0.62, 0.04, 0);
    for (const s of [1, -1]) { bx(g, 0.24, 0.014, 0.014, '#3a3c40', 0.5, 0.032, s * 0.026); bx(g, 0.03, 0.02, 0.03, '#1e1e1e', 0.37, 0.032, s * 0.026); }
    // ammo box (left) with the brass belt feeding in (moving part)
    bx(g, 0.17, 0.13, 0.08, '#56603a', 0.11, -0.05, -0.03);
    bx(g, 0.172, 0.02, 0.082, '#434b2e', 0.11, 0.0, -0.03);
    bx(g, 0.1, 0.004, 0.084, '#e3c35a', 0.11, -0.05, -0.03);                             // stencil stripe
    for (let i = 0; i < 4; i++) bx(g, 0.03, 0.022, 0.012, '#c49a45', 0.08 + i * 0.022, 0.03, -0.058, { rz: 0.5 });
  },
  // ---------------------------------------------------------------- throwables
  grenade(g) {
    gm(g, M.sphere(0.058, 8, 6), M.mat('#4f5a34', { flat: true }), 0.02, 0.02, 0, { sy: 1.2 });
    bx(g, 0.12, 0.012, 0.12, '#3a4426', 0.02, 0.02, 0);
    bx(g, 0.035, 0.035, 0.035, C.steelD, 0.02, 0.1, 0);
    bx(g, 0.014, 0.09, 0.024, C.steel, 0.06, 0.07, 0, { rz: 0.25 });
    bx(g, 0.004, 0.035, 0.035, C.brass, 0.0, 0.11, 0.03);
  },
  beancan(g) {
    cy(g, 0.05, 0.05, 0.13, 8, '#9aa0a4', 0.02, 0.03, 0);
    cy(g, 0.052, 0.052, 0.055, 8, '#5f7f3c', 0.02, 0.03, 0);
    cy(g, 0.053, 0.053, 0.016, 8, '#2a2828', 0.02, 0.075, 0);
    bx(g, 0.012, 0.07, 0.012, '#3a3028', 0.02, 0.13, 0, { rz: 0.3 });
    const sp = bx(g, 0.02, 0.02, 0.02, M.basic('#ffb040'), 0.005, 0.165, 0); sp.castShadow = false;
  },
  satchel(g) {
    bx(g, 0.19, 0.14, 0.1, M.mat('#86774e', { tex: 'cloth' }), 0.04, -0.05, 0);
    bx(g, 0.18, 0.022, 0.104, '#6a5c3c', 0.04, 0.025, 0);
    bx(g, 0.03, 0.15, 0.106, '#d27a35', 0.04, -0.05, 0);
    bx(g, 0.02, 0.09, 0.02, '#4a3c2a', 0.0, 0.06, 0); bx(g, 0.02, 0.09, 0.02, '#4a3c2a', 0.08, 0.06, 0);
    bx(g, 0.012, 0.012, 0.13, '#2e2a26', 0.1, 0.03, 0.08, { ry: 0.6 });
  },
  c4(g) {
    bx(g, 0.21, 0.075, 0.12, '#cfc6a8', 0.03, -0.02, 0);
    for (const x of [-0.04, 0.1]) bx(g, 0.028, 0.079, 0.124, '#4f5a34', x, -0.02, 0);
    bx(g, 0.07, 0.03, 0.06, '#1e1e1e', 0.03, 0.033, 0);
    bx(g, 0.12, 0.008, 0.008, C.red, 0.03, 0.05, 0.02, { ry: 0.2 });
    bx(g, 0.12, 0.008, 0.008, '#3a6ea8', 0.03, 0.05, -0.02, { ry: -0.2 });
    const l = bx(g, 0.02, 0.016, 0.02, M.basic('#ff2a1a'), 0.0, 0.054, 0); l.userData.keep = true; l.castShadow = false;
    g.userData.blink = l;
  },
  supply_signal(g) {
    cy(g, 0.043, 0.043, 0.18, 8, '#6c3f92', 0.02, 0.03, 0);
    cy(g, 0.045, 0.045, 0.03, 8, '#e8e2d6', 0.02, 0.05, 0);
    cy(g, 0.03, 0.036, 0.03, 8, '#2a2a2a', 0.02, 0.135, 0);
    const t = cy(g, 0.022, 0.022, 0.015, 8, M.basic('#c690ff'), 0.02, 0.155, 0); t.castShadow = false;
  },
  // ---------------------------------------------------------------- consumables
  bandage(g) {
    cy(g, 0.045, 0.045, 0.09, 8, '#ece7d8', 0.02, 0, 0, 'z');
    bx(g, 0.12, 0.006, 0.08, '#e2dccb', 0.09, -0.04, 0, { rz: -0.3 });
    bx(g, 0.004, 0.06, 0.092, '#c9b8a0', 0.065, 0, 0);
  },
  medkit(g) {
    bx(g, 0.22, 0.085, 0.16, '#e8e4dc', 0.05, 0.0, 0);
    bx(g, 0.13, 0.006, 0.04, '#c83a2e', 0.05, 0.045, 0); bx(g, 0.04, 0.006, 0.12, '#c83a2e', 0.05, 0.045, 0);
    bx(g, 0.224, 0.02, 0.164, '#b8b2a6', 0.05, -0.03, 0);
    bx(g, 0.06, 0.02, 0.02, '#3a3a3a', 0.05, 0.05, 0.06);
  },
  stim(g) {
    cy(g, 0.021, 0.021, 0.15, 6, '#c8463a', 0.05, 0, 0, 'x');
    cy(g, 0.023, 0.023, 0.03, 6, '#e8e8e8', 0.11, 0, 0, 'x');
    bx(g, 0.07, 0.007, 0.007, '#d8dde2', 0.16, 0, 0);
    bx(g, 0.025, 0.04, 0.04, '#e8e8e8', -0.035, 0, 0);
  },
  antirad(g) {
    cy(g, 0.026, 0.026, 0.16, 6, '#d6c23a', 0.05, 0, 0, 'x');
    cy(g, 0.028, 0.028, 0.03, 6, '#1e1e1e', 0.05, 0, 0, 'x');
    cy(g, 0.022, 0.026, 0.04, 6, '#4f8a43', 0.15, 0, 0, 'x');
    bx(g, 0.03, 0.035, 0.035, '#4f8a43', -0.04, 0, 0);
  },
  food(g) {
    cy(g, 0.052, 0.052, 0.11, 8, '#a8adb2', 0.02, 0.01, 0);
    cy(g, 0.054, 0.054, 0.065, 8, '#b84a32', 0.02, 0.01, 0);
    cy(g, 0.055, 0.055, 0.015, 8, '#e6d6a8', 0.02, 0.01, 0);
  },
  cooked_meat(g) {
    gm(g, M.ico(0.075, 0), M.mat('#7a3f22', { flat: true }), 0.09, 0.0, 0, { sx: 1.45, sy: 0.85, sz: 1.05 });
    bx(g, 0.12, 0.012, 0.09, '#4a2414', 0.09, 0.055, 0, { ry: 0.5 });
    cy(g, 0.016, 0.016, 0.13, 5, C.bone, -0.02, 0, 0, 'x');
    gm(g, M.sphere(0.026, 6, 4), C.bone, -0.085, 0, 0);
  },
  water_bottle(g) {
    cy(g, 0.038, 0.038, 0.18, 8, M.mat('#7ab0d8', { transparent: true, opacity: 0.8 }), 0.0, 0.04, 0);
    cy(g, 0.04, 0.04, 0.05, 8, '#e8eef2', 0.0, 0.04, 0);
    cy(g, 0.02, 0.036, 0.04, 8, M.mat('#7ab0d8', { transparent: true, opacity: 0.8 }), 0.0, 0.15, 0);
    cy(g, 0.021, 0.021, 0.028, 8, '#2a5a9a', 0.0, 0.18, 0);
  },
  flare(g) {
    cy(g, 0.023, 0.023, 0.21, 6, '#c8392a', 0.06, 0, 0, 'x');
    cy(g, 0.026, 0.026, 0.03, 6, '#1e1e1e', -0.045, 0, 0, 'x');
    cy(g, 0.025, 0.025, 0.02, 6, '#e8d6b0', 0.17, 0, 0, 'x');
  },
  generic(g) {
    bx(g, 0.11, 0.08, 0.09, M.mat('#9c8d62', { tex: 'cloth' }), 0.03, 0, 0);
    bx(g, 0.02, 0.084, 0.094, '#5a4a32', 0.03, 0, 0);
  },
};

/**
 * Held item model. Grip/handle at the origin, pointing +X, up +Y.
 * null / unknown id -> small generic item. Geometry is merged per material
 * (animated bits kept: userData.flame, userData.blink, userData.setDraw).
 */
export function makeHeld(id) {
  const g = new THREE.Group();
  (HELD[id] || HELD.generic)(g);
  mergeVC(g, 'held');
  if (g.userData.flame) mergeVC(g.userData.flame, 'flame');
  g.name = 'held:' + (id || 'generic');
  g.userData.id = id || null;
  return g;
}

// mount rotation of the item relative to the hand (hand frame: -Y = knuckles, +X = thumb side)
const Q_ID = new THREE.Quaternion();
const MOUNT = {
  handle: new THREE.Quaternion(),                                                     // handle through the fist, item forward when the arm hangs
  pistol: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -HALF), // barrel along the knuckles, grip through the fist
  bow: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HALF),     // bow grip (Z) through the fist
};

// ============================================================================
// HUMANS
// ============================================================================
const DEF_LOOK = {
  skin: PAL.skin2, hair: '#4a3324', hairStyle: 'short', shirt: '#6f6a5c', pants: '#4d4a44', shoes: '#2e2a26',
  vest: null, helmet: null, bag: null, mask: 'none', outfit: 'none', beard: false, accent: PAL.red,
};
const RAW_LOOKS = {
  survivor: { skin: PAL.skin1, hair: '#5a3b26', hairStyle: 'short', shirt: null, pants: '#7d8ba0', shorts: true, shoes: null, accent: '#7d8ba0' },
  scav: { skin: PAL.skin2, hair: '#3b2a1e', hairStyle: 'short', shirt: '#6b6142', hood: 'down', ragged: true, pants: '#4d4536', shoes: '#3a2f25', mask: 'bandana', maskCol: '#7a4630', accent: '#5d6b3c' },
  bandit: { skin: PAL.skin3, hair: '#1f1a17', hairStyle: 'short', beard: true, shirt: '#7a2b26', pants: '#34302c', shoes: '#1d1a18', gloves: '#2a2220', mask: 'bandana', maskCol: '#2a2524', hat: 'brim', hatCol: '#4a3526', accent: '#c49a45' },
  soldier: { skin: PAL.skin2, hair: '#3a2c20', hairStyle: 'buzz', shirt: '#5a6640', pants: '#4a5434', shoes: '#22201d', gloves: '#2e2c28', helmet: 'helm_mil', vest: 'vest_plate', accent: '#3f4a2a' },
  raider: { skin: PAL.skin3, hair: '#2a1f18', hairStyle: 'short', shirt: '#4a3428', pants: '#3a2c22', shoes: '#1e1915', gloves: '#2a201a', mask: 'balaclava', maskCol: '#2b2a2c', pad: true, accent: '#a8352a' },
  breacher: { skin: PAL.skin2, hair: '#3a2a1e', hairStyle: 'buzz', beard: true, shirt: '#4a4a44', pants: '#3c3b35', shoes: '#22201d', gloves: '#2a2826', vest: 'vest_charges', hat: 'beanie', hatCol: '#d27a35', mask: 'bandana', maskCol: '#34322e', accent: '#d27a35' },
  brute: { skin: PAL.skin2, hair: '#2a2420', hairStyle: 'buzz', shirt: '#3b3b3e', pants: '#2f3034', shoes: '#1b1a1a', gloves: '#222222', vest: 'vest_heavy', helmet: 'helm_riot', accent: '#a8402e', scale: 1.12, bulk: 1.18 },
  rocketeer: { skin: PAL.skin1, hair: '#8a4a2a', hairStyle: 'short', shirt: '#4a3354', outfit: 'coat', pants: '#2e2a30', shoes: '#1e1b1e', gloves: '#2a2228', goggles: true, bag: 'bag_rockets', mask: 'bandana', maskCol: '#2a2430', accent: '#d27a35' },
  warlord: { skin: PAL.skin3, hair: '#1a1716', hairStyle: 'short', beard: true, shirt: '#1f1d22', outfit: 'coat', pants: '#1c1b1e', shoes: '#121014', gloves: '#1a1a1a', hat: 'officer', hatCol: '#1c1b1f', sash: true, epaulettes: true, accent: '#a3302a', scale: 1.15, bulk: 1.1 },
  ironjack: { skin: PAL.skin2, hair: '#1a1716', hairStyle: 'bald', shirt: '#26262a', pants: '#1f1f22', shoes: '#111111', gloves: '#18181a', vest: 'vest_heavy', armorTint: '#2c2d32', mask: 'skull', hood: 'up', hoodCol: '#1c1c20', spikes: true, accent: '#c2342a', scale: 1.25, bulk: 1.22 },
  trader: { skin: PAL.skin1, hair: '#8a8580', hairStyle: 'short', beard: true, shirt: '#c2ad84', sleeves: 'short', outfit: 'apron', apronCol: '#7a5233', pants: '#5a4a3a', shoes: '#3a2c20', hat: 'cap', hatCol: '#3f6b5e', bag: 'bag_small', accent: '#3f6b5e' },
  guard: { skin: PAL.skin2, hair: '#2a2420', hairStyle: 'buzz', shirt: '#2f3d5a', pants: '#263149', shoes: '#141418', gloves: '#1a1c22', helmet: 'helm_riot', badge: true, accent: '#c49a45' },
  hazguard: { skin: PAL.skin1, hairStyle: 'short', shirt: '#d6b13a', outfit: 'hazmat', mask: 'gas', pants: '#d6b13a', shoes: '#2a2828', accent: '#2a2826' },
  // AI survivor players: player-like crafted / looted gear
  survivor_a: { skin: PAL.skin3, hair: '#2a1f18', hairStyle: 'short', vest: 'burlap', helmet: 'helm_wood', bag: 'bag_small', pants: '#8a7a50', shoes: '#4a3a2a', accent: '#8a7a50' },
  survivor_b: { skin: PAL.skin1, hair: '#a8824a', hairStyle: 'long', shirt: '#56646e', hood: 'down', pants: '#4a5f82', shoes: '#2e2a26', bag: 'bag_ruck', mask: 'bandana', maskCol: '#a8402e', accent: '#a8402e' },
  survivor_c: { skin: PAL.skin4, hair: '#1a1614', hairStyle: 'buzz', beard: true, shirt: '#6a5a44', pants: '#4f4a3e', shoes: '#2e2620', vest: 'vest_scrap', helmet: 'helm_bucket', bag: 'bag_ruck', bagCol: '#6e6450', accent: '#9a5634' },
  survivor_d: { skin: PAL.skin2, hair: '#3a2a1e', hairStyle: 'short', shirt: '#3e4448', pants: '#3a3f36', shoes: '#1c1a18', gloves: '#2a2826', vest: 'vest_plate', plateCol: '#7a7050', helmet: 'helm_riot', bag: 'bag_mil', accent: '#c49a45' },
  lurker: { form: 'lurker', skin: '#a99bb2', hair: '#3a3036', hairStyle: 'bald', shirt: null, pants: '#3b3436', shorts: true, ragged: true, shoes: null, eyes: '#d8ff6a', accent: '#d8ff6a', scale: 1.04 },
};
export const LOOKS = {};
for (const k in RAW_LOOKS) LOOKS[k] = Object.assign({}, DEF_LOOK, RAW_LOOKS[k]);

function lookDims(L) {
  const lurk = L.form === 'lurker', b = L.bulk || 1;
  const D = {
    lurk, bulk: b,
    footH: 0.1, footL: lurk ? 0.25 : 0.28, footW: 0.14 * (0.6 + 0.4 * b),
    shin: 0.4, thigh: lurk ? 0.42 : 0.4,
    legW: (lurk ? 0.13 : 0.16) * (0.55 + 0.45 * b), legZ: (lurk ? 0.11 : 0.115) * (0.5 + 0.5 * b),
    waist: 0.1, torsoH: lurk ? 0.46 : 0.5,
    tW0: (lurk ? 0.34 : 0.42) * b, tW1: (lurk ? 0.48 : 0.52) * b,
    tD0: (lurk ? 0.21 : 0.235) * b, tD1: (lurk ? 0.27 : 0.275) * b,
    up: lurk ? 0.4 : 0.32, fore: lurk ? 0.4 : 0.29,
    armW: (lurk ? 0.12 : 0.13) * (0.55 + 0.45 * b), hand: (lurk ? 1.35 : 1) * (0.75 + 0.25 * b),
    gOff: 0.06,
    hx: lurk ? 0.28 : 0.29, hy: lurk ? 0.27 : 0.31, hz: lurk ? 0.26 : 0.31,
    hunch: lurk ? 0.55 : 0, crouch: lurk ? 1 : 0,
  };
  D.hipY = D.footH + D.shin + D.thigh;
  D.crouchDrop = lurk ? (D.hipY) * (1 - Math.cos(0.42)) * 0.9 + 0.06 : 0;
  D.shY = D.torsoH - 0.07;
  D.shZ = D.tW1 / 2 + D.armW / 2 - 0.025;
  D.fx = y => lerp(D.tD0, D.tD1, y / D.torsoH);   // torso depth (X) at height y
  D.fz = y => lerp(D.tW0, D.tW1, y / D.torsoH);   // torso width (Z) at height y
  return D;
}

// ---------------------------------------------------------------- body + gear builder
function buildHuman(R) {
  const L = R.look, D = R.D, lurk = D.lurk;
  const hz = L.outfit === 'hazmat' || L.vest === 'hazmat';
  const burlap = L.vest === 'burlap';
  const coat = L.outfit === 'coat';
  const skin = L.skin;
  const shirt = hz ? C.haz : burlap ? C.burlap : (L.shirt || null);
  const sleeves = hz ? 'long' : burlap ? 'short' : (L.sleeves || (shirt ? 'long' : 'none'));
  const CL = c => M.mat(c, { tex: 'cloth' });
  const mSkin = M.mat(skin), mSkinD = M.mat(shade(skin, 0.82));
  const mTorso = shirt ? CL(shirt) : mSkin;
  const mUpper = sleeves === 'none' ? mSkin : mTorso;
  const mFore = sleeves === 'long' ? mTorso : mSkin;
  const mHand = M.mat(hz ? C.rubber : (L.gloves || skin));
  const pantsC = hz ? C.haz : (L.pants || skin);
  const mPants = CL(pantsC);
  const mShin = L.shorts && !hz ? mSkin : mPants;
  const footC = hz ? C.rubber : (L.shoes || shade(skin, 0.9));
  const mFoot = M.mat(footC);
  const accent = L.accent || C.red;
  const { torso, hips, neck, head } = R;
  const fx = D.fx, fz = D.fz, H = D.torsoH;
  const SIDES = [1, -1];   // +1 = right (+Z), -1 = left (-Z)

  // shell hugging the torso between y0 and y1, grown by g
  const shell = (y0, y1, g, m, p = torso, dx = 0) => {
    const w0 = fx(y0) + 2 * g, w1 = fx(y1) + 2 * g, d0 = fz(y0) + 2 * g, d1 = fz(y1) + 2 * g;
    return gm(p, cbox(w0, y1 - y0, d0, 0.055 * D.bulk + g, { tx: w1 / w0, tz: d1 / d0 }), m, dx, (y0 + y1) / 2, 0);
  };

  // ---- pelvis / torso
  cb(hips, D.tD0 + 0.012, 0.22, D.tW0 + 0.012, 0.055 * D.bulk, mPants, 0, 0.03, 0);
  gm(torso, cbox(D.tD0, H, D.tW0, 0.06 * D.bulk, { tx: D.tD1 / D.tD0, tz: D.tW1 / D.tW0, bev: 0.05, bevS: 0.84 }), mTorso, 0, H / 2, 0);
  if (shirt && !hz) {
    bx(torso, 0.15, 0.05, 0.22, CL(shade(shirt, 0.8)), 0, H - 0.005, 0);   // collar
    if (!burlap && !coat) { shell(0.0, 0.05, 0.012, M.mat('#3a2c22')); bx(torso, 0.02, 0.045, 0.06, C.brass, fx(0.025) / 2 + 0.018, 0.025, 0); }
  }
  if (!shirt && !lurk) {   // bare chest: subtle muscle shading + waistband
    bx(torso, 0.012, 0.09, 0.15, mSkinD, fx(0.36) / 2, 0.36, 0.075); bx(torso, 0.012, 0.09, 0.15, mSkinD, fx(0.36) / 2, 0.36, -0.075);
    bx(hips, D.tD0 + 0.02, 0.04, D.tW0 + 0.02, M.mat(shade(pantsC, 1.25)), 0, 0.12, 0);
  }
  if (L.ragged && shirt) {
    for (const [z, h] of [[-0.14, 0.06], [-0.03, 0.09], [0.08, 0.05], [0.16, 0.08]]) {
      bx(torso, 0.02, h, 0.07, mTorso, fx(0) / 2, -h / 2 + 0.02, z); bx(torso, 0.02, h * 0.8, 0.07, mTorso, -fx(0) / 2, -h * 0.4 + 0.02, -z);
    }
  }
  if (L.hood === 'down') { bx(torso, 0.13, 0.11, 0.3, CL(shade(shirt || skin, 0.85)), -fx(H) / 2 + 0.02, H - 0.01, 0); bx(torso, 0.02, 0.12, 0.2, CL(shade(shirt || skin, 0.9)), fx(0.15) / 2 + 0.006, 0.12, 0); }

  // ---- legs
  for (let i = 0; i < 2; i++) {
    const th = R.th[i], kn = R.kn[i], ft = R.ft[i];
    if (L.shorts && !hz) {
      cb(th, D.legW + 0.014, 0.19, D.legW + 0.014, 0.04, mPants, 0, -0.075, 0);
      cb(th, D.legW, D.thigh - 0.12, D.legW, 0.035, mSkin, 0, -0.14 - (D.thigh - 0.14) / 2, 0);
      if (L.ragged) bx(th, D.legW + 0.016, 0.05, 0.05, mPants, 0, -0.18, 0.02);
    } else cb(th, D.legW, D.thigh + 0.04, D.legW, 0.04, mPants, 0, -D.thigh / 2 + 0.02, 0, null, { bx: 0.9, bz: 0.9 });
    cb(kn, D.legW * 0.88, D.shin, D.legW * 0.88, 0.035, mShin, 0, -D.shin / 2, 0, null, { bx: 0.85, bz: 0.85 });
    if (L.shoes || hz) bx(kn, D.legW * 0.88 + 0.016, 0.13, D.legW * 0.88 + 0.016, mFoot, 0, -D.shin + 0.065, 0);
    cb(ft, D.footL, D.footH, D.footW, 0.04, mFoot, 0.05, -D.footH / 2, 0, null, { tx: 0.92, tz: 0.9 });
    if (L.shoes || hz) bx(ft, D.footL + 0.006, 0.025, D.footW + 0.006, M.mat(shade(footC, 0.6)), 0.05, -D.footH + 0.0125, 0);
    else bx(ft, 0.05, 0.04, D.footW * 0.95, mSkinD, 0.05 + D.footL / 2 - 0.02, -0.03, 0);
  }

  // ---- arms
  for (let i = 0; i < 2; i++) {
    const s = SIDES[i], sh = R.sh[i], el = R.el[i], hd = R.hand[i];
    if (sleeves === 'short') {
      cb(sh, D.armW, D.up + 0.05, D.armW, 0.035, mSkin, 0, -D.up / 2 + 0.025, 0, null, { bx: 0.9, bz: 0.9 });
      cb(sh, D.armW + 0.018, D.up * 0.55, D.armW + 0.018, 0.04, mTorso, 0, -D.up * 0.26 + 0.03, 0, null, { tx: 0.85, tz: 0.85 });
    } else cb(sh, D.armW, D.up + 0.05, D.armW, 0.035, mUpper, 0, -D.up / 2 + 0.025, 0, null, { bx: 0.9, bz: 0.9, tx: 0.88, tz: 0.88 });
    cb(el, D.armW * 0.9, D.fore, D.armW * 0.9, 0.032, mFore, 0, -D.fore / 2, 0, null, { bx: 0.85, bz: 0.85 });
    if (sleeves === 'long' && (L.gloves || hz)) bx(el, D.armW * 0.9 + 0.014, 0.06, D.armW * 0.9 + 0.014, mHand, 0, -D.fore + 0.03, 0);
    const hs = D.hand;
    cb(hd, 0.1 * hs, 0.11 * hs, 0.105 * hs, 0.025 * hs, mHand, 0, -0.055 * hs, 0, null, { bx: 0.85, bz: 0.9 });
    if (!lurk) bx(hd, 0.04 * hs, 0.05 * hs, 0.04 * hs, mHand, 0.055 * hs, -0.04 * hs, -s * 0.03, { rz: 0.3 });   // thumb
    if (lurk) for (const z of [-0.035, 0, 0.035]) cn(hd, 0.016, 0.11, 4, C.bone, 0.035, -0.17, z, '-y', { rz: -0.35 });
    if (L.pad && i === 1) { bx(sh, 0.2, 0.06, 0.18, M.mat(C.leatherD), 0, 0.045, -0.025, { rx: -0.2 }); bx(sh, 0.205, 0.02, 0.05, M.mat(accent), 0, 0.075, -0.04, { rx: -0.2 }); }
    if (L.pad && i === 0) bx(sh, D.armW + 0.02, 0.06, D.armW + 0.02, M.mat(accent), 0, -0.12, 0);
    if (L.epaulettes) { bx(sh, 0.15, 0.035, 0.13, M.mat(C.brass), 0, 0.06, 0); for (const x of [-0.05, 0, 0.05]) bx(sh, 0.02, 0.05, 0.02, M.mat(C.brass), x, 0.035, s * 0.07); }
  }

  // ---- neck + head
  cb(neck, 0.12, 0.11, 0.13, 0.03, hz ? CL(C.haz) : mSkin, 0, 0.03, 0);
  const balac = L.mask === 'balaclava';
  const mHead = balac ? CL(L.maskCol || '#2b2a2c') : mSkin;
  const hx = D.hx, hy = D.hy, hzz = D.hz;
  gm(head, cbox(hx, hy, hzz, lurk ? 0.06 : 0.075, { tx: 0.97, tz: 0.97, bx: lurk ? 0.8 : 0.9, bz: lurk ? 0.8 : 0.92, bev: 0.06, bevS: 0.8 }), mHead, 0, hy / 2, 0);
  const ink = M.mat(C.ink);
  if (lurk) {
    const glow = M.basic(L.eyes || '#d8ff6a');
    bx(head, 0.13, 0.08, 0.2, mSkinD, 0.07, 0.03, 0);
    bx(head, 0.03, 0.03, 0.12, M.mat('#3a1a22'), 0.135, 0.04, 0);
    for (const z of [-0.03, 0.03]) bx(head, 0.015, 0.025, 0.015, C.bone, 0.14, 0.06, z);
    bx(head, 0.05, 0.035, 0.24, mSkinD, 0.115, 0.185, 0);
    for (const s of SIDES) {
      bx(head, 0.02, 0.06, 0.08, M.mat('#4a3a52'), 0.118, 0.155, s * 0.06);
      const e = bx(head, 0.02, 0.032, 0.05, glow, 0.13, 0.155, s * 0.06); e.castShadow = false;
      bx(head, 0.07, 0.05, 0.025, mSkinD, -0.03, 0.17, s * 0.13, { rx: s * 0.5, rz: 0.4 });
    }
    for (let k = 0; k < 3; k++) bx(head, 0.06, 0.02, 0.03, mSkinD, -0.04 + k * 0.05, hy + 0.005, 0);
  } else {
    if (!balac) {
      bx(head, 0.04, 0.055, 0.05, mSkinD, hx / 2 + 0.01, 0.12, 0);   // nose
      for (const s of SIDES) bx(head, 0.06, 0.08, 0.03, mSkin, 0, 0.14, s * (hzz / 2 + 0.008));   // ears
      bx(head, 0.012, 0.02, 0.07, M.mat(shade(skin, 0.6)), hx / 2 + 0.002, 0.065, 0);   // mouth
    } else bx(head, 0.014, 0.06, 0.22, mSkin, hx / 2 + 0.002, 0.17, 0);   // eye slit
    for (const s of SIDES) bx(head, 0.02, 0.055, 0.05, ink, hx / 2 + 0.006, 0.17, s * 0.068);
    if (!balac && L.hairStyle !== 'bald' && L.mask !== 'skull') for (const s of SIDES) bx(head, 0.025, 0.02, 0.07, M.mat(shade(L.hair, 0.8)), hx / 2 + 0.008, 0.21, s * 0.068);
  }

  // hair
  const hatTop = !!L.hat || L.hood === 'up' || hz || balac;
  const helmTop = L.helmet && L.helmet !== 'helm_gas';
  const mHair = M.mat(L.hair);
  if (!balac && !hz && !lurk) {
    const st = L.hairStyle;
    if (st === 'short' || st === 'long') {
      if (!hatTop && !helmTop && L.mask !== 'skull') { gm(head, cbox(hx + 0.03, 0.1, hzz + 0.03, 0.085, { bev: 0.05, bevS: 0.76 }), mHair, -0.008, hy - 0.0, 0); bx(head, 0.05, 0.05, hzz - 0.03, mHair, hx / 2 - 0.006, hy - 0.04, 0); }
      bx(head, 0.07, hy - 0.1, hzz - 0.02, mHair, -hx / 2 + 0.03, (hy + 0.12) / 2 + 0.0, 0);
      if (st === 'long') { bx(head, 0.08, hy + 0.06, hzz + 0.03, mHair, -hx / 2 + 0.02, hy / 2 - 0.04, 0); for (const s of SIDES) bx(head, 0.16, 0.2, 0.03, mHair, -0.05, hy * 0.62, s * (hzz / 2 + 0.012)); }
    } else if (st === 'buzz') {
      if (!hatTop && !helmTop) gm(head, cbox(hx + 0.012, 0.07, hzz + 0.012, 0.078, { bev: 0.05, bevS: 0.79 }), mHair, 0, hy - 0.025, 0);
      bx(head, 0.02, hy * 0.5, hzz + 0.008, mHair, -hx / 2 - 0.002, hy * 0.68, 0);
    }
    if (L.beard) {
      bx(head, 0.05, 0.12, hzz * 0.82, mHair, hx / 2 + 0.012, 0.06, 0);
      for (const s of SIDES) bx(head, 0.17, 0.11, 0.024, mHair, 0.06, 0.09, s * (hzz / 2 + 0.006));
    }
  }

  // ---- outfits
  if (hz) {
    const mz = CL(C.haz), mzD = CL(shade(C.haz, 0.82));
    gm(head, cbox(hx + 0.08, hy + 0.09, hzz + 0.08, 0.09, { tx: 0.95, tz: 0.95, bev: 0.07, bevS: 0.75 }), mz, -0.012, hy / 2 + 0.015, 0);
    bx(head, 0.025, 0.14, 0.25, M.mat('#26343e'), hx / 2 + 0.035, 0.17, 0);
    bx(head, 0.03, 0.025, 0.28, mzD, hx / 2 + 0.035, 0.25, 0);
    shell(0.36, H, 0.025, mzD);                                   // shoulder yoke
    bx(torso, 0.03, 0.42, 0.04, M.mat(C.rubber), fx(0.25) / 2 + 0.012, 0.22, 0);   // zipper
    const tk = M.mat('#8a9099', { tex: 'metal' });
    cy(torso, 0.075, 0.075, 0.38, 8, tk, -fx(0.3) / 2 - 0.08, 0.3, 0.07);
    cy(torso, 0.075, 0.075, 0.03, 8, '#3a3a3a', -fx(0.3) / 2 - 0.08, 0.5, 0.07);
    bx(torso, 0.06, 0.24, 0.16, M.mat(C.rubber), -fx(0.3) / 2 - 0.03, 0.28, -0.07);
    for (let i = 0; i < 2; i++) bx(R.th[i], D.legW + 0.02, 0.04, D.legW + 0.02, M.mat(C.rubber), 0, -0.02, 0);
  }
  if (coat) {
    const cc = L.coat || shirt || '#3a3436', mc = CL(cc), mcD = CL(shade(cc, 0.75));
    for (let i = 0; i < 2; i++) {
      const s = SIDES[i];
      bx(R.th[i], D.legW + 0.06, D.thigh * 0.9, D.legW + 0.05, mc, -0.005, -D.thigh * 0.42, s * 0.012);
      bx(R.th[i], D.legW + 0.065, 0.035, D.legW + 0.055, mcD, -0.005, -D.thigh * 0.85, s * 0.012);
    }
    bx(hips, D.tD0 + 0.05, 0.24, D.tW0 + 0.05, mc, -0.01, -0.0, 0);
    bx(torso, 0.18, 0.1, 0.3, mcD, -0.01, H + 0.0, 0);   // big collar
    bx(torso, 0.016, 0.44, 0.03, mcD, fx(0.24) / 2 + 0.006, 0.24, 0.0);   // button line
    for (const y of [0.12, 0.24, 0.36]) bx(torso, 0.02, 0.025, 0.025, M.mat(C.brass), fx(y) / 2 + 0.012, y, 0.0);
    shell(0.03, 0.08, 0.015, M.mat('#2a2220'));   // belt
  }
  if (L.outfit === 'apron') {
    const ac = L.apronCol || '#7a5233', ma = M.mat(ac, { tex: 'cloth' }), maD = M.mat(shade(ac, 0.7));
    bx(torso, 0.025, 0.4, fz(0.2) * 0.78, ma, fx(0.2) / 2 + 0.014, 0.2, 0);
    bx(torso, 0.04, 0.09, 0.12, maD, fx(0.12) / 2 + 0.03, 0.12, 0.06);   // pocket
    for (const s of SIDES) bx(torso, fx(H) + 0.02, 0.025, 0.035, maD, 0, H - 0.04, s * 0.09);
    shell(0.05, 0.08, 0.016, maD);
    for (let i = 0; i < 2; i++) bx(R.th[i], 0.025, D.thigh * 0.9, D.legW + 0.06, ma, D.legW / 2 + 0.02, -D.thigh * 0.42, SIDES[i] * 0.012);
  }

  // ---- vests (chest armour / shirts)
  const v = L.vest;
  if (burlap) {
    const mr = M.mat(C.rope);
    shell(0.04, 0.085, 0.016, mr);
    for (const [z, h] of [[-0.15, 0.07], [-0.04, 0.1], [0.06, 0.06], [0.16, 0.09]]) { bx(torso, 0.022, h, 0.08, mTorso, fx(0) / 2 + 0.002, -h / 2 + 0.03, z); bx(torso, 0.022, h, 0.08, mTorso, -fx(0) / 2 - 0.002, -h / 2 + 0.03, -z); }
    bx(torso, 0.02, 0.07, 0.12, CL(shade(C.burlap, 0.7)), fx(0.4) / 2 + 0.004, 0.42, 0);
    bx(torso, 0.022, 0.12, 0.1, CL(shade(C.burlap, 0.85)), fx(0.25) / 2 + 0.006, 0.22, -0.1);   // patch
  } else if (v === 'wood_armor') {
    const mp = M.mat(PAL.plank, { tex: 'plank' }), mpD = M.mat(PAL.plankDark, { tex: 'plank' }), mr = M.mat(C.rope);
    const fr = fx(0.3) / 2;
    [[-0.135, 0.37, 0.04], [0, 0.4, -0.03], [0.135, 0.36, 0.02]].forEach(([z, h, r], k) => {
      bx(torso, 0.05, h, 0.13, k === 1 ? mpD : mp, fr + 0.03, 0.08 + h / 2, z, { rx: r });
      bx(torso, 0.05, h - 0.04, 0.13, k === 1 ? mp : mpD, -fr - 0.03, 0.1 + h / 2, z, { rx: -r });
    });
    for (const s of SIDES) bx(torso, fx(H) + 0.12, 0.03, 0.045, mr, 0, H + 0.0, s * 0.13);
    shell(0.14, 0.18, 0.06, mr);
    for (let i = 0; i < 2; i++) { bx(R.sh[i], 0.19, 0.045, 0.17, i ? mpD : mp, 0, 0.05, SIDES[i] * 0.02, { rx: SIDES[i] * 0.3 }); bx(R.sh[i], 0.2, 0.02, 0.03, mr, 0, 0.075, SIDES[i] * 0.02, { rx: SIDES[i] * 0.3 }); }
  } else if (v === 'vest_scrap') {
    const mRu = M.mat(C.rust, { tex: 'metal' }), mSt = M.mat('#7e848c', { tex: 'metal' }), mStr = M.mat(C.leatherD), mBolt = M.mat('#2a2826');
    bx(torso, 0.04, 0.24, 0.32, mRu, fx(0.33) / 2 + 0.025, 0.33, -0.01, { rx: 0.12 });
    bx(torso, 0.035, 0.17, 0.22, mSt, fx(0.16) / 2 + 0.03, 0.16, 0.07, { rx: -0.22, ry: 0.06 });
    bx(torso, 0.04, 0.3, 0.34, mRu, -fx(0.3) / 2 - 0.022, 0.3, 0, { rx: -0.08 });
    for (const [y, z] of [[0.42, -0.13], [0.42, 0.11], [0.23, -0.13], [0.22, 0.12], [0.1, 0.14]]) bx(torso, 0.02, 0.022, 0.022, mBolt, fx(y) / 2 + 0.05, y, z);
    shell(0.12, 0.16, 0.045, mStr); shell(0.28, 0.31, 0.04, mStr);
    bx(R.sh[1], 0.22, 0.05, 0.2, mSt, 0, 0.045, -0.03, { rx: -0.35 }); bx(R.sh[1], 0.16, 0.045, 0.14, mRu, 0.0, -0.04, -0.06, { rx: -0.5 });
    bx(R.sh[0], 0.16, 0.04, 0.15, mRu, 0, 0.05, 0.02, { rx: 0.3 });
  } else if (v === 'vest_sign') {
    const fr = fx(0.3) / 2;
    bx(torso, 0.025, 0.3, 0.3, M.mat('#1e1e1e'), fr + 0.022, 0.29, 0, { rx: PI / 4 });
    bx(torso, 0.025, 0.27, 0.27, M.mat('#e0b83a', { tex: 'metal' }), fr + 0.032, 0.29, 0, { rx: PI / 4 });
    bx(torso, 0.01, 0.035, 0.13, M.mat('#1e1e1e'), fr + 0.046, 0.33, 0.0, { rx: 0.0 });
    bx(torso, 0.01, 0.11, 0.035, M.mat('#1e1e1e'), fr + 0.046, 0.25, 0.0);
    gm(torso, M.cyl(0.19, 0.19, 0.03, 8), M.mat('#b03a2c', { tex: 'metal' }), -fx(0.3) / 2 - 0.02, 0.29, 0, { rz: HALF, ry: 0, rx: PI / 8 });
    bx(torso, 0.034, 0.05, 0.2, M.mat('#e8e2d6'), -fx(0.3) / 2 - 0.022, 0.29, 0);
    const mStr = M.mat('#2a2622');
    for (const s of SIDES) bx(torso, fx(H) + 0.1, 0.025, 0.05, mStr, 0, H - 0.01, s * 0.12);
    shell(0.16, 0.2, 0.05, mStr);
  } else if (v === 'vest_plate') {
    const ol = L.plateCol || '#5d6b3c', mo = CL(ol), moD = CL(shade(ol, 0.72));
    shell(0.1, 0.46, 0.035, mo);
    bx(torso, 0.04, 0.3, fz(0.28) * 0.86, mo, fx(0.28) / 2 + 0.05, 0.28, 0);   // front plate bulk
    bx(torso, 0.04, 0.3, fz(0.28) * 0.86, mo, -fx(0.28) / 2 - 0.05, 0.28, 0);
    for (const z of [-0.12, 0, 0.12]) { bx(torso, 0.065, 0.12, 0.1, moD, fx(0.2) / 2 + 0.1, 0.2, z); bx(torso, 0.066, 0.025, 0.104, mo, fx(0.2) / 2 + 0.1, 0.255, z); }
    bx(torso, 0.06, 0.1, 0.07, moD, fx(0.38) / 2 + 0.085, 0.38, -0.13);
    bx(torso, 0.012, 0.06, 0.012, '#1e1e1e', fx(0.38) / 2 + 0.09, 0.46, -0.15);
    for (const s of SIDES) bx(torso, fx(H) + 0.07, 0.035, 0.08, mo, 0, H - 0.005, s * 0.14);
    bx(torso, 0.05, 0.14, 0.22, moD, -fx(0.3) / 2 - 0.09, 0.28, 0);
    shell(0.06, 0.11, 0.03, M.mat('#2a2a26'));
  } else if (v === 'vest_heavy') {
    const ac = L.armorTint || '#43474e', ma = M.mat(ac, { tex: 'metal' }), maD = M.mat(shade(ac, 0.7)), maL = M.mat(shade(ac, 1.25), { tex: 'metal' });
    shell(0.06, 0.5, 0.045, ma);
    bx(torso, 0.05, 0.28, fz(0.32) * 0.82, maL, fx(0.32) / 2 + 0.06, 0.32, 0, { rx: 0 });
    bx(torso, 0.04, 0.14, fz(0.12) * 0.75, ma, fx(0.12) / 2 + 0.055, 0.12, 0);
    bx(torso, 0.05, 0.36, fz(0.3) * 0.84, maL, -fx(0.3) / 2 - 0.055, 0.3, 0);
    bx(torso, 0.24, 0.1, 0.3, maD, 0, H + 0.02, 0);   // gorget
    for (const [y, z] of [[0.44, 0.16], [0.44, -0.16], [0.2, 0.15], [0.2, -0.15]]) bx(torso, 0.02, 0.025, 0.025, '#1a1a1a', fx(y) / 2 + 0.09, y, z);
    for (let i = 0; i < 2; i++) {
      const s = SIDES[i];
      bx(R.sh[i], 0.27, 0.11, 0.24, maL, 0, 0.045, s * 0.035, { rx: s * 0.25 });
      bx(R.sh[i], 0.24, 0.08, 0.2, ma, 0, -0.045, s * 0.07, { rx: s * 0.5 });
      if (L.spikes) for (const x of [-0.07, 0.07]) cn(R.sh[i], 0.03, 0.13, 5, M.mat('#b8bcc0'), x, 0.15, s * 0.05, 'y', { rx: s * 0.3 });
      bx(R.th[i], 0.05, 0.18, D.legW + 0.06, ma, D.legW / 2 + 0.02, -0.08, 0);
      bx(R.el[i], D.armW + 0.03, 0.14, D.armW + 0.03, maD, 0, -0.1, 0);
    }
  } else if (v === 'vest_charges') {
    const mh = M.mat('#2f2c26'), mp = CL('#6a5a3a'), mo = M.mat(accent), mw = M.mat(C.red);
    shell(0.14, 0.18, 0.02, mh); shell(0.3, 0.33, 0.02, mh);
    for (const s of SIDES) bx(torso, fx(H) + 0.06, 0.03, 0.06, mh, 0, H - 0.01, s * 0.13);
    for (const [z, y] of [[-0.12, 0.3], [0.0, 0.33], [0.12, 0.3], [-0.06, 0.15], [0.06, 0.15]]) {
      bx(torso, 0.08, 0.1, 0.1, mp, fx(y) / 2 + 0.055, y, z);
      bx(torso, 0.084, 0.03, 0.104, mo, fx(y) / 2 + 0.055, y + 0.01, z);
    }
    bx(torso, 0.012, 0.012, 0.26, mw, fx(0.38) / 2 + 0.1, 0.38, 0, { rx: 0.2 });
    bx(torso, 0.06, 0.18, 0.24, mp, -fx(0.3) / 2 - 0.045, 0.3, 0);
    for (let i = 0; i < 2; i++) bx(R.sh[i], D.armW + 0.02, 0.05, D.armW + 0.02, mo, 0, -0.1, 0);
  }

  // ---- warlord sash / badge
  if (L.sash) {
    const ms = CL(accent);
    bx(torso, 0.02, 0.66, 0.1, ms, fx(0.26) / 2 + 0.016, 0.27, 0, { rx: 0.72 });
    bx(torso, 0.02, 0.66, 0.1, ms, -fx(0.26) / 2 - 0.016, 0.27, 0, { rx: 0.72 });
    shell(0.02, 0.1, 0.022, ms);
    bx(torso, 0.04, 0.14, 0.06, ms, fx(0.0) / 2 + 0.02, -0.04, -0.14, { rx: 0.15 });
  }
  if (L.badge) {
    bx(torso, 0.016, 0.05, 0.045, M.mat(C.brass), fx(0.38) / 2 + 0.008, 0.38, -0.12);
    shell(0.0, 0.06, 0.014, M.mat('#1a1a1e'));
    bx(torso, 0.05, 0.1, 0.06, M.mat('#1a1a1e'), fx(0.0) / 2 + 0.02, 0.0, 0.17);
  }

  // ---- bags
  const b = L.bag, backX = y => -fx(y) / 2;
  if (b === 'bag_small') {
    const ml = M.mat(L.bagCol || C.leather), mlD = M.mat(shade(L.bagCol || C.leather, 0.7));
    bx(torso, 0.17, 0.16, 0.08, ml, 0.0, 0.0, fz(0) / 2 + 0.05);
    bx(torso, 0.175, 0.04, 0.085, mlD, 0.0, 0.065, fz(0) / 2 + 0.05);
    bx(torso, 0.02, 0.64, 0.05, mlD, fx(0.25) / 2 + 0.012, 0.24, 0, { rx: -0.72 });
    bx(torso, 0.02, 0.64, 0.05, mlD, -fx(0.25) / 2 - 0.012, 0.24, 0, { rx: -0.72 });
  } else if (b === 'bag_ruck') {
    const c = L.bagCol || '#8a7a52', m1 = CL(c), m2 = CL(shade(c, 0.75));
    bx(torso, 0.2, 0.38, 0.34, m1, backX(0.3) - 0.1, 0.3, 0);
    bx(torso, 0.22, 0.06, 0.32, m2, backX(0.46) - 0.1, 0.48, 0);
    bx(torso, 0.07, 0.14, 0.24, m2, backX(0.2) - 0.22, 0.18, 0);
    for (const s of SIDES) { bx(torso, 0.12, 0.2, 0.06, m2, backX(0.25) - 0.1, 0.24, s * 0.2); bx(torso, fx(H) + 0.04, 0.03, 0.06, m2, 0.0, H - 0.01, s * 0.12); }
  } else if (b === 'bag_mil') {
    const c = L.bagCol || '#5a6440', m1 = CL(c), m2 = CL(shade(c, 0.72)), mr = CL('#6e7a4a');
    bx(torso, 0.26, 0.5, 0.42, m1, backX(0.3) - 0.13, 0.32, 0);
    bx(torso, 0.28, 0.07, 0.4, m2, backX(0.5) - 0.13, 0.56, 0);
    cy(torso, 0.08, 0.08, 0.5, 8, mr, backX(0.5) - 0.13, 0.66, 0, 'z');
    for (const z of [-0.14, 0.14]) bx(torso, 0.17, 0.03, 0.03, M.mat('#2a2a22'), backX(0.5) - 0.13, 0.68, z, { rz: 0 });
    for (const s of SIDES) { bx(torso, 0.16, 0.24, 0.08, m2, backX(0.25) - 0.13, 0.24, s * 0.25); bx(torso, fx(H) + 0.05, 0.035, 0.07, m2, 0.0, H - 0.01, s * 0.12); }
    bx(torso, 0.08, 0.16, 0.3, m2, backX(0.2) - 0.29, 0.2, 0);
  } else if (b === 'bag_rockets') {
    const mq = CL('#3a3028'), mw = M.mat('#7a8452'), mt = M.mat('#4a5434');
    bx(torso, 0.15, 0.42, 0.24, mq, backX(0.3) - 0.08, 0.3, 0, { rx: 0.25 });
    for (const z of [-0.06, 0.06]) { cy(torso, 0.05, 0.05, 0.2, 8, mt, backX(0.3) - 0.08, 0.56, z + 0.06, 'y', { rx: 0.25 }); cn(torso, 0.05, 0.13, 8, mw, backX(0.3) - 0.08, 0.72, z + 0.1, 'y', { rx: 0.25 }); }
    bx(torso, 0.02, 0.64, 0.05, mq, fx(0.25) / 2 + 0.012, 0.24, 0, { rx: 0.72 });
  }

  // ---- hats / hoods
  if (L.hat && !L.helmet && !hz) {
    const hc = L.hatCol || accent, mh = CL(hc), mhD = M.mat(shade(hc, 0.65));
    if (L.hat === 'cap') { gm(head, cbox(hx + 0.03, 0.12, hzz + 0.03, 0.085, { bev: 0.05, bevS: 0.75 }), mh, -0.005, hy + 0.0, 0); bx(head, 0.15, 0.022, hzz - 0.04, mhD, hx / 2 + 0.065, hy - 0.01, 0); bx(head, 0.03, 0.02, 0.03, mhD, 0, hy + 0.08, 0); }
    else if (L.hat === 'beanie') { gm(head, cbox(hx + 0.03, 0.16, hzz + 0.03, 0.085, { tx: 0.9, tz: 0.9, bev: 0.07, bevS: 0.7 }), mh, -0.005, hy + 0.02, 0); gm(head, cbox(hx + 0.045, 0.05, hzz + 0.045, 0.09), mhD, 0, hy - 0.05, 0); }
    else if (L.hat === 'officer') {
      gm(head, cbox(hx + 0.03, 0.08, hzz + 0.03, 0.085), mh, 0, hy - 0.015, 0);
      gm(head, cbox(hx + 0.036, 0.032, hzz + 0.036, 0.087), CL(accent), 0, hy - 0.0, 0);
      gm(head, cbox(hx + 0.04, 0.05, hzz + 0.06, 0.1, { tx: 1.28, tz: 1.2 }), mh, 0.025, hy + 0.05, 0, { rz: -0.08 });
      bx(head, 0.13, 0.02, hzz - 0.05, M.mat('#0e0e10'), hx / 2 + 0.05, hy - 0.05, 0, { rz: -0.15 });
      bx(head, 0.02, 0.04, 0.05, M.mat(C.brass), hx / 2 + 0.035, hy + 0.035, 0);
    } else if (L.hat === 'brim') {
      bx(head, hx - 0.01, 0.12, hzz - 0.01, mh, -0.005, hy + 0.05, 0);
      bx(head, hx + 0.0, 0.03, hzz + 0.0, mhD, -0.005, hy + 0.0, 0);
      gm(head, M.cyl(0.3, 0.3, 0.025, 10), mh, -0.0, hy - 0.01, 0);
    }
  }
  if (L.hood === 'up' && !hz) {
    const mh = CL(L.hoodCol || shade(shirt || '#555', 0.9));
    gm(head, cbox(hx + 0.04, hy + 0.08, hzz + 0.07, 0.09, { tx: 0.95, tz: 0.95, bev: 0.07, bevS: 0.72 }), mh, -0.04, hy / 2 + 0.02, 0);
    bx(head, 0.1, 0.14, hzz * 0.7, mh, -hx / 2 - 0.03, -0.02, 0);
  }
  if (L.goggles && !hz) {
    bx(head, hx + 0.02, 0.035, hzz + 0.02, M.mat('#2a2420'), 0, hy - 0.035, 0);
    for (const s of SIDES) { cy(head, 0.048, 0.048, 0.05, 6, M.mat(C.brass), hx / 2 + 0.02, hy - 0.035, s * 0.07, 'x'); bx(head, 0.012, 0.05, 0.05, M.mat('#6a9aa8'), hx / 2 + 0.046, hy - 0.035, s * 0.07); }
  }

  // ---- masks
  const mk = L.mask;
  if (mk === 'bandana') {
    const mb = CL(L.maskCol || accent);
    bx(head, 0.05, 0.14, hzz + 0.02, mb, hx / 2 - 0.01, 0.07, 0);
    gm(head, tbox(0.07, 0.07, 0.12, 0.3, 1), mb, hx / 2 + 0.02, 0.0, 0, { rz: PI });
    for (const s of SIDES) bx(head, hx * 0.85, 0.11, 0.02, mb, 0.02, 0.075, s * (hzz / 2 + 0.008));
    bx(head, 0.08, 0.06, 0.07, mb, -hx / 2 - 0.03, 0.1, 0); bx(head, 0.1, 0.03, 0.05, mb, -hx / 2 - 0.06, 0.06, 0.03, { rz: 0.6 });
  } else if (mk === 'gas' && !(L.helmet === 'helm_gas')) {
    const mr = M.mat(C.rubber);
    bx(head, 0.06, 0.17, 0.23, mr, hx / 2 + 0.015, hz ? 0.08 : 0.1, 0);
    cy(head, 0.06, 0.06, 0.09, 8, M.mat('#5d6b3c'), hx / 2 + 0.08, 0.04, 0, 'x', { rz: -0.4 });
    cy(head, 0.062, 0.062, 0.02, 8, M.mat('#2e3420'), hx / 2 + 0.12, 0.02, 0, 'x', { rz: -0.4 });
    if (!hz) { for (const s of SIDES) cy(head, 0.035, 0.035, 0.03, 8, M.mat('#4a6a70'), hx / 2 + 0.045, 0.17, s * 0.065, 'x'); bx(head, hx + 0.02, 0.03, hzz + 0.02, mr, 0, 0.17, 0); }
  } else if (mk === 'skull') {
    const mbn = M.mat(C.bone), mdk = M.mat('#1e1a1a');
    bx(head, 0.04, hy - 0.03, hzz + 0.01, mbn, hx / 2 + 0.005, hy / 2 - 0.005, 0);
    for (const s of SIDES) bx(head, 0.06, 0.06, 0.04, mbn, hx / 2 - 0.01, 0.1, s * (hzz / 2 - 0.01));
    for (const s of SIDES) bx(head, 0.02, 0.07, 0.07, L.eyes ? M.basic(L.eyes) : mdk, hx / 2 + 0.022, 0.18, s * 0.07);
    if (L.spikes) for (const s of SIDES) bx(head, 0.018, 0.035, 0.035, M.basic(accent), hx / 2 + 0.028, 0.18, s * 0.07);
    bx(head, 0.02, 0.05, 0.035, mdk, hx / 2 + 0.022, 0.11, 0);
    bx(head, 0.02, 0.02, 0.17, mdk, hx / 2 + 0.022, 0.05, 0);
    for (const z of [-0.06, -0.02, 0.02, 0.06]) bx(head, 0.022, 0.05, 0.008, mdk, hx / 2 + 0.024, 0.05, z);
  }

  // ---- helmets
  const hm = L.helmet;
  if (hm === 'helm_bucket') {
    const mrst = M.mat('#8e5a3a', { tex: 'metal' }), mD = M.mat('#5e3a26');
    cy(head, 0.165, 0.2, 0.25, 10, mrst, -0.005, 0.315, 0, 'y', { rz: 0.1 });
    cy(head, 0.205, 0.205, 0.03, 10, mD, -0.0, 0.2, 0, 'y', { rz: 0.1 });
    cy(head, 0.175, 0.175, 0.02, 10, mD, -0.012, 0.37, 0, 'y', { rz: 0.1 });
    for (const s of SIDES) bx(head, 0.03, 0.03, 0.02, mD, -0.01, 0.3, s * 0.18);
    bx(head, 0.012, 0.012, 0.4, M.mat('#4a4a4a'), -0.06, 0.42, 0, { rx: 0 });
  } else if (hm === 'helm_gas') {
    const mr = M.mat(C.rubber);
    bx(head, 0.07, 0.18, 0.24, mr, hx / 2 + 0.02, 0.1, 0);
    for (const s of SIDES) {
      cy(head, 0.04, 0.04, 0.03, 8, M.mat('#5a7a80'), hx / 2 + 0.055, 0.175, s * 0.065, 'x');
      cy(head, 0.055, 0.055, 0.1, 8, M.mat('#5d6b3c'), hx / 2 + 0.03, 0.05, s * 0.14, 'z', { ry: s * 0.7 });
      cy(head, 0.057, 0.057, 0.02, 8, M.mat('#2e3420'), hx / 2 + 0.06, 0.05, s * 0.175, 'z', { ry: s * 0.7 });
    }
    bx(head, 0.05, 0.025, hzz + 0.02, mr, 0.0, hy + 0.008, 0); bx(head, hx + 0.02, 0.025, 0.05, mr, -0.01, hy + 0.008, 0);
    bx(head, hx + 0.02, 0.03, hzz + 0.02, mr, -0.0, 0.17, 0);
  } else if (hm === 'helm_riot') {
    const tint = L.helmCol || '#2a2d34', mh = M.mat(tint), mhL = M.mat(shade(tint, 1.4));
    gm(head, cbox(hx + 0.07, 0.22, hzz + 0.07, 0.1, { tx: 0.92, tz: 0.94, bev: 0.08, bevS: 0.72 }), mh, -0.012, hy - 0.01, 0);
    bx(head, 0.06, 0.13, hzz + 0.05, mh, -hx / 2 - 0.02, 0.16, 0);
    bx(head, 0.03, 0.16, hzz + 0.04, M.mat('#3c5466', { transparent: true, opacity: 0.82 }), hx / 2 + 0.04, 0.17, 0);
    bx(head, 0.04, 0.03, hzz + 0.06, mhL, hx / 2 + 0.035, 0.265, 0);
    bx(head, 0.2, 0.025, 0.05, mhL, -0.02, hy + 0.1, 0);
    if (L.badge) bx(head, 0.016, 0.04, 0.04, M.mat(C.brass), hx / 2 + 0.04, 0.3, 0);
  } else if (hm === 'helm_mil') {
    const ol = L.helmCol || '#56603a', mh = CL(ol), mhD = M.mat(shade(ol, 0.7));
    gm(head, dome(0.235, 10, 4), mh, -0.01, hy * 0.58, 0, { sy: 0.8 });
    gm(head, M.cyl(0.24, 0.25, 0.03, 10), mhD, -0.01, hy * 0.58, 0);
    bx(head, 0.025, 0.16, hzz + 0.03, mhD, 0.04, 0.12, 0);
    bx(head, 0.06, 0.03, 0.2, M.mat('#2a2a26'), hx / 2 + 0.05, hy * 0.6 + 0.07, 0);
    for (const s of SIDES) bx(head, 0.06, 0.04, 0.06, M.mat('#2a2a26'), hx / 2 + 0.06, hy * 0.6 + 0.07, s * 0.06);
  } else if (hm === 'helm_wood') {
    const mp = M.mat(PAL.plank, { tex: 'plank' }), mpD = M.mat(PAL.plankDark), mr = M.mat(C.rope);
    gm(head, cbox(hx + 0.06, 0.16, hzz + 0.06, 0.09, { tx: 0.9, tz: 0.9, bev: 0.05, bevS: 0.8 }), mp, -0.005, hy - 0.005, 0);
    bx(head, hx + 0.065, 0.035, hzz + 0.065, mr, 0, hy - 0.06, 0);
    bx(head, 0.03, 0.13, 0.05, mpD, hx / 2 + 0.035, 0.21, 0);
    bx(head, hx + 0.02, 0.025, 0.07, mpD, -0.005, hy + 0.08, 0);
    bx(head, 0.08, 0.025, hzz + 0.0, mpD, -0.005, hy + 0.082, 0);
    for (const s of SIDES) bx(head, 0.03, 0.18, 0.02, mr, 0.03, 0.12, s * (hzz / 2 + 0.01));
  }

  // ---- lurker extras
  if (lurk) {
    for (let k = 0; k < 5; k++) { const y = 0.08 + k * 0.085; bx(torso, 0.05, 0.05, 0.06, mSkinD, -fx(y) / 2 - 0.012, y, 0); }
    for (const s of SIDES) for (const y of [0.18, 0.26, 0.34]) bx(torso, 0.06, 0.018, 0.014, mSkinD, fx(y) / 2 - 0.02, y, s * (fz(y) / 2 + 0.004));
    for (const s of SIDES) bx(torso, 0.1, 0.16, 0.04, mSkinD, -fx(0.38) / 2 + 0.02, 0.38, s * 0.12);
    bx(torso, 0.03, 0.1, 0.1, M.mat('#8a6a8e'), fx(0.3) / 2 + 0.005, 0.3, 0.08);
  }
}

// ---------------------------------------------------------------- pose tracks (body space, feet origin, facing +X)
// [t, x, y, z, yaw, pitch, roll, twist, lean, ease(0 io,1 in,2 out,3 lin)]
const TRACK_RAW = {
  chop: [[0.35, -0.04, 1.86, 0.26, -0.15, 2.5, 0, -0.3, 0.1, 0], [0.45, 0.28, 1.9, 0.16, 0, 1.3, 0, -0.05, 0, 1], [0.55, 0.55, 1.02, 0.02, 0.2, -0.55, 0, 0.3, -0.32, 1], [0.7, 0.42, 0.88, -0.1, 0.3, -0.95, 0, 0.32, -0.26, 2]],
  slash: [[0.35, 0.04, 1.48, 0.46, -1.35, 0.25, -0.35, -0.5, 0.04, 0], [0.55, 0.52, 1.3, -0.16, 0.9, 0, -0.1, 0.42, -0.12, 1], [0.7, 0.34, 1.22, -0.36, 1.45, -0.1, 0, 0.5, -0.1, 2]],
  thrust: [[0.35, -0.12, 1.24, 0.27, 0.05, 0.12, 0, -0.32, 0.05, 0], [0.55, 0.58, 1.32, 0.1, 0, 0, 0, 0.3, -0.18, 1], [0.7, 0.5, 1.3, 0.12, 0, 0, 0, 0.28, -0.15, 2]],
  punch: [[0.35, 0.14, 1.38, 0.2, 0, 0, 0, -0.32, 0.02, 0], [0.55, 0.64, 1.42, 0.06, 0, 0, 0, 0.36, -0.12, 1], [0.7, 0.56, 1.4, 0.08, 0, 0, 0, 0.32, -0.1, 2]],
  claw: [[0.35, -0.02, 1.62, 0.44, 0, 0, 0, -0.42, 0.05, 0], [0.55, 0.62, 0.98, -0.22, 0, 0, 0, 0.46, -0.35, 1], [0.72, 0.36, 0.72, -0.34, 0, 0, 0, 0.4, -0.3, 2]],
  throw: [[0.35, -0.2, 1.62, 0.32, -0.1, 2.0, 0, -0.52, 0.14, 0], [0.5, 0.3, 1.74, 0.12, 0, 0.6, 0, 0.2, -0.05, 1], [0.68, 0.46, 1.06, -0.14, 0.2, -0.6, 0, 0.46, -0.28, 2]],
  bash: [[0.35, 0.05, 1.3, 0.2, 0.3, 0.3, 0, -0.2, 0, 0], [0.55, 0.45, 1.3, 0.0, -0.4, 0.2, 0, 0.3, -0.12, 1], [0.7, 0.4, 1.28, 0.02, -0.3, 0.1, 0, 0.25, -0.1, 2]],
};
const OFF_RAW = {
  chop: [[0.35, 0.3, 1.3, -0.22], [0.55, 0.06, 1.0, -0.34], [0.7, 0.02, 1.0, -0.34]],
  slash: [[0.35, 0.34, 1.32, -0.12], [0.55, 0.0, 1.1, -0.36], [0.7, -0.05, 1.05, -0.36]],
  punch: [[0.35, 0.24, 1.38, -0.14], [0.55, 0.14, 1.34, -0.18], [0.7, 0.16, 1.34, -0.18]],
  claw: [[0.35, 0.42, 1.1, -0.3], [0.55, -0.04, 1.15, -0.4], [0.7, 0.0, 1.0, -0.4]],
  throw: [[0.35, 0.5, 1.5, -0.24], [0.5, 0.3, 1.3, -0.3], [0.68, -0.05, 1.02, -0.34]],
};
const _eu = new THREE.Euler();
const qE = (yaw, pitch, roll, out = new THREE.Quaternion()) => out.setFromEuler(_eu.set(roll, yaw, pitch, 'YZX'));
const TRACKS = {}, OFFS = {};
for (const k in TRACK_RAW) TRACKS[k] = TRACK_RAW[k].map(r => ({ t: r[0], p: new THREE.Vector3(r[1], r[2], r[3]), q: qE(r[4], r[5], r[6]), tw: r[7], ln: r[8], e: r[9] }));
for (const k in OFF_RAW) OFFS[k] = OFF_RAW[k].map(r => ({ t: r[0], p: new THREE.Vector3(r[1], r[2], r[3]) }));

function catmull(p0, p1, p2, p3, t, out) {
  const t2 = t * t, t3 = t2 * t;
  for (const k of ['x', 'y', 'z']) out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
  return out;
}
const _tp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
/** evaluate a track at u (0..1) starting/ending at the base pose (P0, Q0) */
function evalTrack(tr, u, ko, P0, Q0, outP, outQ, res) {
  const n = tr.length;
  let i = -1; while (i + 1 < n && u >= tr[i + 1].t) i++;
  const t0 = i < 0 ? 0 : tr[i].t, t1 = i + 1 < n ? tr[i + 1].t : 1;
  const e = EASE[(i + 1 < n && tr[i + 1].e) || 0](clamp((u - t0) / Math.max(1e-4, t1 - t0), 0, 1));
  const pt = (j, o) => (j < 0 || j >= n ? o.copy(P0) : o.copy(tr[j].p).add(ko));
  catmull(pt(i - 1, _tp[0]), pt(i, _tp[1]), pt(i + 1, _tp[2]), pt(i + 2, _tp[3]), e, outP);
  if (outQ) {
    const qa = i < 0 ? Q0 : tr[i].q, qb = i + 1 < n ? tr[i + 1].q : Q0;
    if (qa && qb) outQ.slerpQuaternions(qa, qb, e);
  }
  if (res) {
    res.tw = lerp(i < 0 ? 0 : tr[i].tw, i + 1 < n ? tr[i + 1].tw : 0, e);
    res.ln = lerp(i < 0 ? 0 : tr[i].ln, i + 1 < n ? tr[i + 1].ln : 0, e);
  }
  return outP;
}

// temporaries
const _v = [...Array(12)].map(() => new THREE.Vector3());
const _q = [...Array(10)].map(() => new THREE.Quaternion());
const _m4 = new THREE.Matrix4(), _tm = new THREE.Matrix4(), _tmInv = new THREE.Matrix4();
const _tq = new THREE.Quaternion(), _tqInv = new THREE.Quaternion();
const AX_Z = new THREE.Vector3(0, 0, 1);
const _res = { tw: 0, ln: 0 };

const HUMAN_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);   // covers standing, aiming and lying poses
class HumanRig extends RigBase {
  constructor(look) {
    super();
    this.kind = 'human';
    this.root.name = 'human';
    const f = this.fall;
    this.hips = pivot(f, 0, 0.9, 0, 'hips');
    this.torso = pivot(this.hips, 0, 0.1, 0, 'torso');
    this.neck = pivot(this.torso, 0, 0.5, 0, 'neck');
    this.head = pivot(this.neck, 0.01, 0.07, 0, 'head');
    this.sh = []; this.el = []; this.hand = []; this.grip = []; this.th = []; this.kn = []; this.ft = [];
    for (let i = 0; i < 2; i++) {
      const n = i ? 'L' : 'R';
      this.sh[i] = pivot(this.torso, 0, 0, 0, 'shoulder' + n);
      this.el[i] = pivot(this.sh[i], 0, 0, 0, 'elbow' + n);
      this.hand[i] = pivot(this.el[i], 0, 0, 0, 'hand' + n);
      this.grip[i] = pivot(this.hand[i], 0, 0, 0, 'grip' + n);
      this.th[i] = pivot(this.hips, 0, 0, 0, 'thigh' + n);
      this.kn[i] = pivot(this.th[i], 0, 0, 0, 'knee' + n);
      this.ft[i] = pivot(this.kn[i], 0, 0, 0, 'foot' + n);
    }
    // aliases matching the spec naming (upperArm = shoulder group, forearm = elbow group, shin = knee group)
    this.parts = { hips: this.hips, torso: this.torso, neck: this.neck, head: this.head,
      shoulderR: this.sh[0], shoulderL: this.sh[1], elbowR: this.el[0], elbowL: this.el[1], handR: this.hand[0], handL: this.hand[1],
      thighR: this.th[0], thighL: this.th[1], kneeR: this.kn[0], kneeL: this.kn[1], footR: this.ft[0], footL: this.ft[1] };
    this.groups = [this.hips, this.torso, this.neck, this.head, ...this.sh, ...this.el, ...this.hand, ...this.th, ...this.kn, ...this.ft];
    this.skeleton = new THREE.Skeleton(this.groups, this.groups.map(() => new THREE.Matrix4()));
    this.skinMeshes = [];
    this.anim = { t: Math.random() * 10, phase: 0, spd: 0, legYaw: 0, aimW: 0 };
    this.held = null; this.heldId = null; this.info = null; this.cat = 'empty'; this.hi = 0;
    // pose scratch
    this.T = [0, 1].map(() => ({ w: 0, P: new THREE.Vector3(), Q: new THREE.Quaternion(), hasQ: false, pole: new THREE.Vector3() }));
    this.ko = new THREE.Vector3();
    this.setLook(look || LOOKS.survivor);
  }

  setLook(look) {
    const L = Object.assign({}, DEF_LOOK, typeof look === 'string' ? LOOKS[look] : look);
    const key = JSON.stringify(L);
    if (key === this._lookKey) return this;   // unchanged gear: nothing to rebuild
    this._lookKey = key;
    this.look = L;
    this._clearSkin();
    const D = this.D = lookDims(L);
    this.hips.position.y = D.hipY;
    this.torso.position.y = D.waist;
    this.neck.position.y = D.torsoH;
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      this.sh[i].position.set(0, D.shY, s * D.shZ);
      this.el[i].position.set(0, -D.up, 0);
      this.hand[i].position.set(0, -D.fore, 0);
      this.grip[i].position.set(0, -D.gOff * D.hand, 0);
      this.th[i].position.set(0, 0, s * D.legZ);
      this.kn[i].position.set(0, -D.thigh, 0);
      this.ft[i].position.set(0, -D.shin, 0);
    }
    buildHuman(this);
    this.skinMeshes = skinBuild(this, this.groups, HUMAN_SPHERE);
    this._adopt(this.root);
    this._prune();
    const sc = L.scale || 1;
    this.scaleG.scale.setScalar(sc);
    let top = D.hipY + D.waist + D.torsoH + 0.07 + D.hy + 0.04;
    if (L.helmet || L.hat) top += 0.06;
    if (D.lurk) top -= 0.22;
    this.height = top * sc;
    // key offset: where this body's right shoulder rests vs. the reference human
    const sy = D.shY, hn = D.hunch;
    this.ko.set(sy * Math.sin(hn), D.hipY - D.crouchDrop + D.waist + sy * Math.cos(hn) - 1.43, 0);
    return this;
  }

  setHeld(id) {
    id = id || null;
    if (id === this.heldId) return;
    if (this.held) { this.held.parent && this.held.parent.remove(this.held); disposeOwned(this.held); this.held = null; }
    this.heldId = id;
    this.info = id ? (HELD_INFO[id] || GENERIC_INFO) : null;
    const I = this.info;
    this.cat = !I ? 'empty' : I.hand === 'L' ? 'bow' : I.kind === 'gun' ? (id === 'rocket_launcher' ? 'rocket' : I.twoHand ? 'rifle' : 'pistol')
      : id === 'torch' ? 'torch' : id === 'spear_wood' ? 'spear' : id === 'buildplan' ? 'plan' : id === 'fishing_rod' ? 'rod'
      : (I.kind === 'tool' || I.kind === 'melee' || id === 'hammer') ? (I.twoHand ? 'tool2' : 'tool') : 'item';
    if (!id) return;
    const g = makeHeld(id);
    this.hi = I.hand === 'L' ? 1 : 0;
    this.mount = I.kind === 'gun' ? (this.cat === 'bow' ? MOUNT.bow : MOUNT.pistol) : MOUNT.handle;
    g.quaternion.copy(this.mount);
    this.grip[this.hi].add(g);
    this._adopt(g);
    this._prune();
    this.held = g;
  }

  handWorld(v) { this.grip[0].updateWorldMatrix(true, false); return this.grip[0].getWorldPosition(v); }
  muzzleWorld(v) {
    const h = this.held;
    if (h) {
      h.updateWorldMatrix(true, true);
      if (h.userData.flame) return h.userData.flame.localToWorld(v.copy(h.userData.flame.userData.tip));
      if (this.info && this.info.muzzle) return h.localToWorld(v.fromArray(this.info.muzzle));
    }
    this.grip[this.hi].updateWorldMatrix(true, false);
    return this.grip[this.hi].getWorldPosition(v);
  }

  // ------------------------------------------------------------ base hold pose for the current item
  _hold(T, a, mv, sp, ph) {
    const cat = this.cat, I = this.info, ko = this.ko, aw = a.aimW;
    const M0 = T[this.hi], O = T[1 - this.hi];
    M0.w = O.w = 0; M0.hasQ = O.hasQ = false;
    const P = M0.P, Q = M0.Q, q1 = _q[0], q2 = _q[1];
    const swingA = (0.5 + 0.2 * mv) * mv * sp;   // matches the FK arm swing of the right arm
    if (cat === 'empty') return;
    M0.w = 1; M0.hasQ = true;
    switch (cat) {
      case 'rifle': case 'rocket': {
        const rk = cat === 'rocket';
        P.lerpVectors(_v[0].set(rk ? 0.16 : 0.2, rk ? 1.2 : 1.07, rk ? 0.2 : 0.17), _v[1].set(rk ? 0.16 : 0.3, rk ? 1.33 : 1.36, rk ? 0.23 : 0.08), aw);
        P.y += 0.012 * Math.sin(2 * ph) * mv * (1 - aw * 0.6); P.x += 0.012 * sp * mv;
        Q.slerpQuaternions(qE(rk ? 0.35 : 0.8, rk ? 0.45 : -0.22, rk ? 0 : 0.15, q1), Q_ID, aw);
        M0.pole.set(-0.35, -1, lerp(0.5, 1.0, aw));
        O.w = 1; O.pole.set(-0.1, -1, -0.5);
        break;
      }
      case 'pistol':
        P.lerpVectors(_v[0].set(0.24 + 0.06 * swingA, 1.0, 0.22), _v[1].set(0.54, 1.36, 0.03), aw);
        Q.slerpQuaternions(qE(0.05, -0.55 - 0.2 * swingA, 0, q1), Q_ID, aw);
        M0.pole.set(-0.3, -1, 0.6);
        O.w = aw; O.pole.set(-0.2, -1, -0.6);
        O.P.copy(P).add(_v[2].set(-0.03, -0.045, -0.065));
        break;
      case 'bow':
        P.lerpVectors(_v[0].set(0.16, 0.98, -0.26), _v[1].set(0.58, 1.38, -0.03), aw);
        Q.slerpQuaternions(qE(-0.1, -0.5, 1.35, q1), qE(0, 0.03, 0.55, q2), aw);
        M0.pole.set(-0.3, -1, -0.7);
        O.w = aw; O.pole.set(-0.6, -0.6, 1);
        break;
      case 'tool':
        P.set(0.15 + 0.16 * swingA, 0.84 + 0.03 * Math.abs(swingA), 0.29);
        qE(-0.05, 0.4 + 0.3 * swingA, 0, Q);
        M0.pole.set(-0.4, -1, 0.3);
        break;
      case 'tool2':
        P.set(0.2, 0.98, 0.2); P.y += 0.01 * Math.sin(2 * ph) * mv;
        qE(0.9, 0.7, 0, Q);
        M0.pole.set(-0.3, -1, 0.5); O.w = 1; O.pole.set(-0.2, -1, -0.5);
        break;
      case 'spear':
        P.set(0.12, 1.02, 0.25); P.y += 0.01 * Math.sin(2 * ph) * mv;
        qE(0.05, 0.18, 0, Q);
        M0.pole.set(-0.3, -1, 0.5); O.w = 1; O.pole.set(-0.2, -1, -0.6);
        break;
      case 'torch':
        P.set(0.26, 1.2, 0.26); P.y += 0.01 * Math.sin(2 * ph) * mv;
        qE(0.0, 0.9, 0, Q);
        M0.pole.set(-0.3, -1, 0.5);
        break;
      case 'rod':   // fishing rod: grip at the waist, rod raised up and forward, tip slightly inwards
        P.set(0.3, 1.02, 0.22); P.y += 0.008 * Math.sin(2 * ph) * mv;
        qE(0.12, 0.62, 0, Q);
        M0.pole.set(-0.3, -1, 0.5);
        break;
      case 'plan':
        P.set(0.3, 1.18, 0.12);
        qE(1.35, 0.15, 0, Q);
        M0.pole.set(-0.3, -1, 0.5); O.w = 1; O.pole.set(-0.3, -1, -0.6);
        break;
      default:   // item / throwable
        P.set(0.21 + 0.12 * swingA, 0.96, 0.25);
        qE(0.1, 0.15 + 0.2 * swingA, 0, Q);
        M0.pole.set(-0.4, -1, 0.3);
    }
    P.add(ko);
    if (cat === 'pistol') O.P.add(ko);
  }

  // ------------------------------------------------------------ 2-bone IK for arm i (target in body space)
  _ik(i, P, Q, hasQ, pole, qs, qe, qh) {
    const D = this.D, S = this.sh[i].position;
    const p = _v[3].copy(P).applyMatrix4(_tmInv);
    const pl = _v[4].copy(pole).applyQuaternion(_tqInv);
    const qa = _q[2];
    if (hasQ) { qa.multiplyQuaternions(_tqInv, Q); if (i === this.hi && this.held) qa.multiply(_q[3].copy(this.mount).invert()); }
    else {   // relaxed wrist: hand aligned with the line to the shoulder
      const y = _v[5].subVectors(S, p).normalize();
      const x = _v[6].set(1, 0, 0).addScaledVector(y, -y.x);
      if (x.lengthSq() < 1e-6) x.set(0, 0, 1);
      x.normalize();
      const z = _v[7].crossVectors(x, y);
      qa.setFromRotationMatrix(_m4.makeBasis(x, y, z));
    }
    const w = _v[5].set(0, -D.gOff * D.hand, 0).applyQuaternion(qa);
    w.subVectors(p, w);                                   // wrist position
    const d = _v[6].subVectors(w, S);
    const L1 = D.up, L2 = D.fore;
    let c = d.length();
    c = clamp(c, Math.abs(L1 - L2) + 1e-3, (L1 + L2) * 0.9995);
    d.normalize();
    const cosA = clamp((L1 * L1 + c * c - L2 * L2) / (2 * L1 * c), -1, 1), A = Math.acos(cosA);
    const pp = _v[7].copy(pl).addScaledVector(d, -pl.dot(d));
    if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0).addScaledVector(d, -d.y);
    pp.normalize();
    const u = _v[8].copy(d).multiplyScalar(cosA).addScaledVector(pp, Math.sin(A));
    const cosB = clamp((L1 * L1 + L2 * L2 - c * c) / (2 * L1 * L2), -1, 1);
    const bend = PI - Math.acos(cosB);
    const e = _v[9].copy(S).addScaledVector(u, L1);
    const f = _v[10].subVectors(w, e).normalize();
    const yb = _v[11].copy(u).negate();
    const xb = f.addScaledVector(u, -f.dot(u));
    if (xb.lengthSq() < 1e-8) xb.copy(pp).negate();
    xb.normalize();
    const zb = _v[9].crossVectors(xb, yb);
    qs.setFromRotationMatrix(_m4.makeBasis(xb, yb, zb));
    qe.setFromAxisAngle(AX_Z, bend);
    qh.multiplyQuaternions(qs, qe).invert().multiply(qa);
  }

  // ------------------------------------------------------------ animation
  update(dt, st) {
    st = st || EMPTY;
    dt = clamp(dt || 0, 0, 0.1);
    const a = this.anim, D = this.D, I = this.info, cat = this.cat, T = this.T;
    a.t += dt;
    // locomotion
    const speed = st.speed || 0;
    a.spd = damp(a.spd, speed, 10, dt);
    const mv = clamp(a.spd / 1.2, 0, 1);
    const run = clamp((a.spd - 3.6) / 1.6, 0, 1);
    const ma = st.moveAng || 0;
    const back = speed > 0.2 && Math.cos(ma) < -0.25;
    const yawT = speed > 0.2 ? clamp(wrapA(back ? ma + PI : ma), -1.1, 1.1) : 0;
    a.legYaw = damp(a.legYaw, yawT * mv, 8, dt);
    const dirS = back ? -1 : 1;
    a.phase += dirS * a.spd * dt / (1.5 + 0.3 * run) * TAU;
    const ph = a.phase, sp = Math.sin(ph), cp = Math.cos(ph);
    const isGun = I && I.kind === 'gun';
    a.aimW = damp(a.aimW, st.aim && isGun ? 1 : 0, 14, dt);
    const aw = a.aimW;
    const dead = clamp(st.dead || 0, 0, 1), dw = sstep(0.0, 0.8, dead);
    const alive = 1 - sstep(0, 0.3, dead);
    const lurk = D.lurk;

    // ---- legs
    const A = (0.44 + 0.1 * run) * mv * (lurk ? 0.85 : 1);
    const stance = aw * (1 - mv) * (I && (I.twoHand || cat === 'bow') ? 1 : 0.5);
    const legLen = D.thigh + D.shin + D.footH;
    const crouchT = lurk ? 0.42 : 0, crouchK = lurk ? 0.85 : 0;
    const buckle = Math.sin(clamp(dead, 0, 1) * PI) * 0.7;
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      const lp = ph + (i === 0 ? PI : 0);
      const la = A * Math.sin(lp);
      const sw = Math.max(0, Math.cos(lp) * dirS);
      let thz = la + crouchT * (1 - 0.3 * mv) + (i ? 0.2 : -0.13) * stance;
      let kz = -(0.05 + 0.04 * mv + (0.55 + 0.75 * run) * mv * Math.pow(sw, 1.3)) - crouchK * (1 - 0.25 * mv) - (i ? 0.16 : 0.1) * stance - buckle;
      thz = lerp(thz, 0.08, dw * 0.6); kz = lerp(kz, -0.12, dw * 0.5) - buckle * (1 - dw);
      this.th[i].rotation.set(-s * (0.035 + 0.16 * dw), 0, thz);
      this.kn[i].rotation.set(0, 0, kz);
      const toe = mv * (la < 0 ? -0.35 * sw : 0.12 * Math.max(0, Math.sin(lp)));
      this.ft[i].rotation.set(0, 0, -(thz + kz) + toe * (1 - dw) + dw * 0.25);
    }
    // ---- hips
    const amax = Math.max(Math.abs(A * sp), 0);
    const crouchDrop = D.crouchDrop;
    let hy = D.hipY - legLen * (1 - Math.cos(amax)) * 0.85 + (0.016 * mv + 0.045 * run) * Math.abs(cp) - 0.03 * stance - crouchDrop - 0.12 * buckle;
    this.hips.position.set(0, hy, 0.012 * sp * mv);
    this.hips.rotation.set(0.04 * sp * mv, a.legYaw, 0);

    // ---- torso base
    let lean = -(0.04 * mv + 0.16 * run) * (1 - 0.7 * aw) - D.hunch;
    let twist = 0.13 * sp * mv * (1 - 0.75 * aw) * dirS;
    let roll = 0;
    if (isGun) twist += (cat === 'bow' ? -0.6 : I.twoHand ? -0.3 : -0.06) * aw;
    let headPitch = (cat === 'rifle' ? -0.1 : 0) * aw, headYaw = 0, headRoll = 0;
    const br = Math.sin(a.t * 1.9) * (1 - mv);

    // ---- base hold pose (IK targets)
    this._hold(T, a, mv, sp, ph);
    const Mi = this.hi, MT = T[Mi], OT = T[1 - Mi];
    const grip2 = I && I.grip2 ? _v[0].fromArray(I.grip2) : null;

    // ---- actions
    const swing = st.swing, thr = st.throw, use = st.use, rel = st.reload, rec = st.recoil || 0, fl = st.flinch || 0;
    const ko = this.ko;
    let offTrack = null, offEnv = 0, offU = 0;
    if (swing != null && swing >= 0 && alive > 0) {
      const u = clamp(swing, 0, 1);
      const env = sstep(0, 0.1, u) * (1 - sstep(0.85, 1, u));
      const name = !I ? (lurk ? 'claw' : 'punch') : I.kind === 'gun' ? 'bash' : (I.swing || 'chop');
      const tr = TRACKS[name];
      const base = MT.w > 0, P0 = base ? _v[1].copy(MT.P) : (name === 'claw' ? _v[1].set(0.22, 0.8, 0.36) : _v[1].set(0.2, 1.22, 0.24)).add(ko);
      const Q0 = base ? _q[4].copy(MT.Q) : null;
      evalTrack(tr, u, ko, P0, Q0, _v[2], base || MT.hasQ ? _q[5] : null, _res);
      if (base) { MT.P.lerp(_v[2], env); MT.Q.slerp(_q[5], env); }
      else { MT.P.copy(_v[2]); MT.w = env; MT.hasQ = false; MT.pole.set(-0.3, -1, 0.5); }
      MT.pole.set(-0.3, -0.6, 1);
      twist += _res.tw * env; lean += _res.ln * env;
      if (!(I && I.twoHand) && OFFS[name]) { offTrack = OFFS[name]; offEnv = env; offU = u; }
    }
    if (thr != null && thr >= 0 && alive > 0) {
      const u = clamp(thr, 0, 1), env = sstep(0, 0.1, u) * (1 - sstep(0.85, 1, u));
      const P0 = MT.w > 0 ? _v[1].copy(MT.P) : _v[1].set(0.2, 0.96, 0.25).add(ko);
      const Q0 = MT.w > 0 ? _q[4].copy(MT.Q) : _q[4].identity();
      evalTrack(TRACKS.throw, u, ko, P0, Q0, _v[2], _q[5], _res);
      MT.P.lerpVectors(P0, _v[2], env); MT.Q.slerpQuaternions(Q0, _q[5], env); MT.w = Math.max(MT.w, env); MT.hasQ = !!this.held;
      MT.pole.set(-0.4, -1, 0.6);
      twist += _res.tw * env; lean += _res.ln * env;
      offTrack = OFFS.throw; offEnv = env; offU = u;
    }
    if (use != null && use >= 0 && alive > 0 && !isGun) {
      const u = clamp(use, 0, 1), env = sstep(0, 0.22, u) * (1 - sstep(0.8, 1, u));
      const mode = I ? (I.use || 'mouth') : 'mouth';
      const P0 = MT.w > 0 ? _v[1].copy(MT.P) : _v[1].set(0.22, 0.95, 0.25).add(ko);
      const Q0 = MT.w > 0 ? _q[4].copy(MT.Q) : _q[4].identity();
      if (mode === 'mouth') {
        _v[2].set(0.25, 1.58 + 0.012 * Math.sin(a.t * 14), 0.08).add(ko); qE(-0.2, 1.25, 0, _q[5]);
        headPitch -= 0.12 * env;
      } else {
        const t9 = a.t * 9;
        if (mode === 'arm') _v[2].set(0.34 + 0.03 * Math.cos(t9), 1.26 + 0.025 * Math.sin(t9), 0.04).add(ko);
        else { const j = sstep(0.4, 0.5, u); _v[2].set(lerp(0.42, 0.34, j), lerp(1.34, 1.25, j), lerp(0.14, 0.02, j)).add(ko); }
        qE(1.3, mode === 'arm' ? -0.2 : -0.45, 0, _q[5]);
        OT.w = Math.max(OT.w, env); OT.P.set(0.3, 1.18, -0.04).add(ko); OT.hasQ = false; OT.pole.set(-0.2, -1, -0.6);
        headPitch -= 0.3 * env; headYaw += 0.2 * env;
      }
      MT.P.lerpVectors(P0, _v[2], env); MT.Q.slerpQuaternions(Q0, _q[5], env); MT.w = Math.max(MT.w, env); MT.hasQ = MT.hasQ || !!this.held;
      MT.pole.set(-0.3, -1, 0.7);
    }
    // two-handed coupling: off hand follows the item (before reload so it can leave the grip)
    if (I && grip2 && MT.w > 0 && (I.twoHand)) {
      OT.P.copy(grip2).applyQuaternion(MT.Q).add(MT.P); OT.w = MT.w; OT.hasQ = false;
    }
    if (cat === 'bow') {   // right hand on the string
      const draw = aw * (rel != null && rel >= 0 ? 1 - sstep(0, 0.2, rel) * (1 - sstep(0.75, 1, rel)) : 1);
      OT.P.set(-0.07 - 0.36 * draw, 0, 0).applyQuaternion(MT.Q).add(MT.P); OT.hasQ = false;
      if (this.held && this.held.userData.setDraw) this.held.userData.setDraw(draw);
    }
    if (isGun && rel != null && rel >= 0 && alive > 0) {
      const u = clamp(rel, 0, 1), env = sstep(0, 0.15, u) * (1 - sstep(0.85, 1, u));
      const one = !I.twoHand;
      if (one) { MT.P.lerp(_v[1].set(0.32, 1.2, 0.08).add(ko), env); }
      else MT.P.add(_v[1].set(-0.03, 0.05, -0.04).multiplyScalar(env));
      MT.Q.multiply(qE(0.15 * env, (one ? 0.6 : 0.22) * env, (one ? 0.4 : 0.6) * env, _q[6]));
      if (cat === 'bow') {
        const b = sstep(0.15, 0.4, u) * (1 - sstep(0.55, 0.8, u));
        OT.P.lerp(_v[1].set(-0.16, 1.62, 0.18).add(ko), b);
      } else {
        const mag = _v[1].fromArray(I.mag || [0.1, -0.05, 0]).applyQuaternion(MT.Q).add(MT.P);
        const g2 = OT.w > 0 ? _v[2].copy(OT.P) : _v[2].copy(MT.P).add(_v[3].set(-0.05, -0.15, -0.2));
        const ta = sstep(0.1, 0.3, u), tb = sstep(0.3, 0.45, u) * (1 - sstep(0.52, 0.68, u)), tc = sstep(0.72, 0.9, u);
        OT.P.lerpVectors(g2, mag, ta * (1 - tc)).add(_v[3].set(-0.02, -0.2 * tb, -0.04 * tb));
        if (one) OT.P.lerp(_v[4].copy(MT.P).add(_v[3].set(-0.03, -0.045, -0.065)), aw * tc);
        OT.w = Math.max(OT.w, env); OT.hasQ = false; OT.pole.set(-0.2, -1, -0.6);
      }
      headPitch -= 0.15 * env;
    }
    if (rec > 0 && MT.w > 0) {
      const r = clamp(rec, 0, 1) * (cat === 'rocket' ? 1.4 : 1);
      MT.P.x -= 0.07 * r; MT.P.y += 0.02 * r;
      MT.Q.multiply(qE(0, 0.24 * r, 0, _q[6]));
      if (OT.w > 0 && grip2 && I.twoHand && cat !== 'bow') OT.P.copy(grip2).applyQuaternion(MT.Q).add(MT.P);
      else if (OT.w > 0) OT.P.x -= 0.07 * r;
      lean += 0.05 * r; headPitch += 0.05 * r;
    }
    if (offTrack && offEnv > 0 && OT.w < 1) {
      evalTrack(offTrack, offU, ko, _v[1].copy(offTrack[0].p).add(ko), null, _v[2], null, null);
      OT.P.lerp(_v[2], OT.w > 0 ? offEnv : 1); OT.w = Math.max(OT.w, offEnv * 0.9); OT.hasQ = false; OT.pole.set(-0.3, -1, -0.6);
    }
    if (fl > 0) {
      const f = clamp(fl, 0, 1);
      lean += 0.22 * f; roll += 0.1 * f; twist += 0.12 * f; headPitch += 0.25 * f;
      for (const t of T) if (t.w > 0) t.P.add(_v[1].set(-0.06 * f, 0.03 * f, 0));
    }

    // ---- apply torso + head
    lean = lerp(lean, 0, dw); twist *= alive;
    this.torso.position.y = D.waist + br * 0.004;
    this.torso.rotation.set(roll, twist - a.legYaw, lean);
    this.neck.rotation.set(headRoll + 0.4 * dw, -twist * 0.8 + headYaw, D.hunch * 0.85 + headPitch + (lean + D.hunch) * -0.3 + 0.1 * dw);
    this.hips.updateMatrix(); this.torso.updateMatrix();
    _tm.multiplyMatrices(this.hips.matrix, this.torso.matrix); _tmInv.copy(_tm).invert();
    _tq.multiplyQuaternions(this.hips.quaternion, this.torso.quaternion); _tqInv.copy(_tq).invert();

    // ---- arms: FK (swing / dead) blended with IK
    const armA = (0.55 + 0.35 * run) * mv * dirS * (lurk ? 1.2 : 1);
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1;
      const swingF = s * armA * sp;
      let ax = -s * (0.1 + 0.05 * run) + 0.02 * s * br, az = swingF + 0.03 * Math.sin(a.t * 1.9 + i) * (1 - mv) + D.hunch * 0.95;
      let el = 0.18 + 0.25 * mv + 0.9 * run + 0.35 * Math.max(0, swingF) + (lurk ? 0.25 : 0);
      if (fl > 0) { az -= 0.3 * fl; el += 0.3 * fl; }
      ax = lerp(ax, -s * 1.25, dw); az = lerp(az, 0.35 + 0.25 * s, dw); el = lerp(el, 0.55, dw);
      const qsF = _q[7].setFromEuler(_eu.set(ax, 0, az, 'XYZ'));
      const qeF = _q[8].setFromAxisAngle(AX_Z, el);
      const qhF = _q[9].setFromEuler(_eu.set(0, 0, 0.1 + 0.2 * dw, 'XYZ'));
      const t = T[i], w = clamp(t.w, 0, 1) * alive;
      if (w > 0.001) {
        this._ik(i, t.P, t.Q, t.hasQ, t.pole, _q[4], _q[5], _q[6]);
        this.sh[i].quaternion.slerpQuaternions(qsF, _q[4], w);
        this.el[i].quaternion.slerpQuaternions(qeF, _q[5], w);
        this.hand[i].quaternion.slerpQuaternions(qhF, _q[6], w);
      } else {
        this.sh[i].quaternion.copy(qsF); this.el[i].quaternion.copy(qeF); this.hand[i].quaternion.copy(qhF);
      }
    }

    // ---- death fall (rotate the whole body backwards about the feet)
    const fa = dead < 0.85 ? Math.pow(dead / 0.85, 2) : 1 + 0.05 * Math.sin((dead - 0.85) / 0.15 * PI);
    this.fall.rotation.set(0, 0, HALF * fa);
    this.fall.position.set(-0.04 * dw, (D.tD1 / 2 + 0.02) * sstep(0.55, 1, dead), 0);

    // ---- held item animation
    const h = this.held;
    if (h) {
      if (h.userData.flame) {
        const fg = h.userData.flame, t = a.t;
        fg.scale.set(1 + 0.1 * Math.sin(t * 23), 1 + 0.18 * Math.sin(t * 17 + 1.3) + 0.08 * Math.sin(t * 41), 1 + 0.1 * Math.cos(t * 19));
        h.updateWorldMatrix(true, false);
        fg.quaternion.copy(h.getWorldQuaternion(_q[0]).invert()).multiply(this.root.getWorldQuaternion(_q[1]));
      }
      if (h.userData.blink) h.userData.blink.visible = (a.t % 0.8) < 0.4;
    }
  }
}

export function makeHuman(look) { return new HumanRig(look); }

// ============================================================================
// ANIMALS
// ============================================================================
function leg(R, body, x, y, z, front, off, lu, ll, w, paw, cols, a1 = 0, a2 = 0) {
  const hip = pivot(body, x, y, z); const knee = pivot(hip, 0, -lu, 0); const foot = pivot(knee, 0, -ll, 0);
  cb(hip, w * 1.1, lu + w * 0.6, w, w * 0.3, cols[0], 0, -lu / 2 + w * 0.3, 0, null, { bx: 0.8, bz: 0.85 });
  cb(knee, w * 0.8, ll, w * 0.8, w * 0.25, cols[1] || cols[0], 0, -ll / 2, 0, null, { bx: 0.85, bz: 0.85 });
  cb(foot, paw[0], paw[1], paw[2], Math.min(paw[0], paw[2]) * 0.25, cols[2] || cols[1] || cols[0], paw[0] * 0.2, -paw[1] / 2, 0);
  const L = { hip, knee, foot, front, off, a1, a2 };
  R.legs.push(L); R.groups.push(hip, knee, foot);
  return L;
}
/** segment lengths so that a leg with base angles a1/a2 reaches the ground */
function legLens(need, a1, a2) { const k = need / (Math.cos(a1) + Math.cos(a1 + a2)); return [k, k]; }

const ANIMAL = {
  wolf(R) {
    const col = '#7f7b76', dark = '#4c4946', light = '#c8c0b2';
    const C0 = R.cfg = { stride: 1.35, A: 0.55, kneeF: 0.9, kneeH: 0.8, bob: 0.03, bodyY: 0.56, neck0: 0.35, halfW: 0.14, attack: 'lunge', runV: 4, height: 0.85, len: 1.1 };
    const body = R.body;
    gm(body, cxbox(0.64, 0.27, 0.25, 0.07, 1.15, 1.12, { bx: 0.9, bz: 0.9 }), M.mat(col, { tex: 'cloth' }), 0, 0, 0);
    cb(body, 0.46, 0.05, 0.17, 0.05, dark, -0.02, 0.145, 0);
    bx(body, 0.42, 0.06, 0.2, light, 0.02, -0.13, 0);
    gm(body, cbox(0.2, 0.34, 0.31, 0.08, { tz: 0.85, bev: 0.05 }), M.mat(light), 0.26, 0.02, 0);   // ruff
    bx(body, 0.12, 0.12, 0.16, dark, -0.29, 0.06, 0);
    const neck = R.neck = pivot(body, 0.3, 0.06, 0);
    bx(neck, 0.18, 0.17, 0.17, col, 0.07, 0, 0);
    const head = R.head = pivot(neck, 0.15, 0.02, 0);
    gm(head, cbox(0.2, 0.17, 0.19, 0.06, { tx: 0.85, tz: 0.8, bev: 0.04 }), M.mat(col), 0.02, 0.0, 0);
    gm(head, cxbox(0.15, 0.085, 0.1, 0.03, 0.8, 0.75), M.mat(light), 0.16, -0.035, 0);
    bx(head, 0.04, 0.04, 0.05, '#1c1a1a', 0.235, -0.02, 0);
    for (const s of [1, -1]) {
      cn(head, 0.04, 0.1, 4, dark, -0.03, 0.12, s * 0.06, 'y', { rx: s * 0.25 });
      const e = bx(head, 0.02, 0.022, 0.03, M.basic('#e0b040'), 0.1, 0.03, s * 0.065); e.castShadow = false;
    }
    const jaw = R.jaw = pivot(head, 0.06, -0.07, 0);
    bx(jaw, 0.15, 0.035, 0.08, light, 0.07, 0, 0);
    const tail = R.tail = pivot(body, -0.32, 0.08, 0);
    gm(tail, cxbox(0.3, 0.1, 0.1, 0.03, 0.6, 0.6), M.mat(col), -0.15, 0, 0, { rz: PI });
    bx(tail, 0.08, 0.06, 0.06, light, -0.3, 0, 0);
    R.tail.rotation.z = 0.7;
    const need = 0.56 - 0.04 + 0.0;
    const [fu, fl] = legLens(need - 0.04, 0, 0), [hu, hl] = legLens(need - 0.04, -0.3, 0.55);
    const cols = [col, col, dark];
    leg(R, body, 0.22, -0.04, 0.085, true, 0, fu, fl, 0.085, [0.1, 0.04, 0.08], cols);
    leg(R, body, 0.22, -0.04, -0.085, true, PI, fu, fl, 0.085, [0.1, 0.04, 0.08], cols);
    leg(R, body, -0.22, -0.04, 0.085, false, PI, hu, hl, 0.09, [0.1, 0.04, 0.08], cols, -0.3, 0.55);
    leg(R, body, -0.22, -0.04, -0.085, false, 0, hu, hl, 0.09, [0.1, 0.04, 0.08], cols, -0.3, 0.55);
  },
  boar(R) {
    const col = '#4a3628', dark = '#2a1f18', snout = '#8a6658';
    R.cfg = { stride: 1.05, A: 0.5, kneeF: 0.8, kneeH: 0.7, bob: 0.025, bodyY: 0.5, neck0: -0.2, halfW: 0.2, attack: 'gore', runV: 3.5, height: 0.8, len: 1.2 };
    const body = R.body;
    gm(body, cxbox(0.8, 0.42, 0.4, 0.12, 1.12, 1.05, { bx: 0.85, bz: 0.85 }), M.mat(col, { tex: 'cloth' }), 0, 0, 0);
    gm(body, cbox(0.34, 0.12, 0.34, 0.1, { tx: 0.7, tz: 0.6 }), M.mat(col), 0.18, 0.24, 0);   // shoulder hump
    for (let k = 0; k < 7; k++) cn(body, 0.035, 0.11, 4, dark, 0.33 - k * 0.09, 0.27 + (k < 3 ? 0.03 : 0) - k * 0.01, 0, 'y', { rz: 0.5 });
    bx(body, 0.5, 0.04, 0.12, dark, 0.05, 0.22, 0);
    const neck = R.neck = pivot(body, 0.38, 0.04, 0);
    bx(neck, 0.14, 0.3, 0.3, col, 0.04, 0, 0);
    const head = R.head = pivot(neck, 0.1, -0.02, 0);
    gm(head, cxbox(0.3, 0.26, 0.24, 0.07, 0.55, 0.6), M.mat(col), 0.12, 0, 0);
    cy(head, 0.065, 0.065, 0.05, 8, snout, 0.285, -0.02, 0, 'x');
    for (const s of [1, -1]) {
      bx(head, 0.03, 0.015, 0.015, '#1a1212', 0.312, -0.015, s * 0.025);
      cn(head, 0.022, 0.12, 4, C.bone, 0.23, -0.0, s * 0.085, 'y', { rz: -0.5, rx: s * 0.3 });
      bx(head, 0.06, 0.09, 0.03, dark, 0.0, 0.13, s * 0.09, { rx: s * 0.4 });
      bx(head, 0.02, 0.025, 0.025, '#121010', 0.14, 0.06, s * 0.09);
    }
    const jaw = R.jaw = pivot(head, 0.12, -0.11, 0);
    bx(jaw, 0.14, 0.04, 0.12, dark, 0.04, 0, 0);
    const tail = R.tail = pivot(body, -0.4, 0.12, 0);
    bx(tail, 0.03, 0.12, 0.03, dark, 0, -0.06, 0, { rz: 0.4 });
    const need = 0.5 - 0.1;
    const [fu, fl] = legLens(need - 0.04, 0, 0), [hu, hl] = legLens(need - 0.04, -0.2, 0.35);
    const cols = [col, dark, '#1a1410'];
    leg(R, body, 0.26, -0.1, 0.12, true, 0, fu, fl, 0.1, [0.09, 0.04, 0.08], cols);
    leg(R, body, 0.26, -0.1, -0.12, true, PI, fu, fl, 0.1, [0.09, 0.04, 0.08], cols);
    leg(R, body, -0.27, -0.1, 0.12, false, PI, hu, hl, 0.11, [0.09, 0.04, 0.08], cols, -0.2, 0.35);
    leg(R, body, -0.27, -0.1, -0.12, false, 0, hu, hl, 0.11, [0.09, 0.04, 0.08], cols, -0.2, 0.35);
  },
  bear(R) {
    const col = '#4b3424', dark = '#33241a', muz = '#8a6a48';
    R.cfg = { stride: 1.9, A: 0.42, kneeF: 0.8, kneeH: 0.7, bob: 0.04, bodyY: 0.82, neck0: -0.05, halfW: 0.4, attack: 'swipe', runV: 4.5, height: 1.25, len: 2.0 };
    const body = R.body;
    gm(body, cxbox(1.28, 0.66, 0.74, 0.2, 1.05, 1.0, { bx: 0.86, bz: 0.88, bev: 0.08, bevS: 0.8 }), M.mat(col, { tex: 'cloth' }), 0, 0, 0);
    gm(body, cbox(0.55, 0.2, 0.6, 0.16, { tx: 0.6, tz: 0.6 }), M.mat(col, { tex: 'cloth' }), 0.3, 0.38, 0);   // hump
    gm(body, cbox(0.5, 0.1, 0.56, 0.15, { tx: 0.7, tz: 0.7 }), M.mat(col), -0.36, 0.35, 0);
    bx(body, 0.9, 0.06, 0.5, dark, 0.0, -0.33, 0);
    const neck = R.neck = pivot(body, 0.62, 0.12, 0);
    gm(neck, cxbox(0.26, 0.46, 0.5, 0.13, 0.8, 0.8), M.mat(col), 0.08, 0, 0);
    const head = R.head = pivot(neck, 0.22, -0.02, 0);
    gm(head, cbox(0.34, 0.3, 0.36, 0.1, { tx: 0.85, tz: 0.82, bev: 0.05 }), M.mat(col), 0.06, 0, 0);
    gm(head, cxbox(0.18, 0.15, 0.18, 0.05, 0.85, 0.85), M.mat(muz), 0.29, -0.06, 0);
    bx(head, 0.05, 0.05, 0.08, '#141010', 0.385, -0.03, 0);
    for (const s of [1, -1]) {
      cb(head, 0.05, 0.09, 0.09, 0.025, dark, -0.03, 0.17, s * 0.14);
      bx(head, 0.02, 0.03, 0.03, '#0e0c0c', 0.2, 0.04, s * 0.1);
    }
    const jaw = R.jaw = pivot(head, 0.2, -0.13, 0);
    bx(jaw, 0.18, 0.05, 0.14, muz, 0.06, 0, 0);
    const tail = R.tail = pivot(body, -0.64, 0.12, 0);
    bx(tail, 0.08, 0.08, 0.1, dark, -0.03, 0, 0);
    const need = 0.82 - 0.12;
    const [fu, fl] = legLens(need - 0.08, 0, 0), [hu, hl] = legLens(need - 0.08, -0.15, 0.3);
    const cols = [col, dark, '#2a1d14'];
    leg(R, body, 0.42, -0.12, 0.22, true, 0, fu, fl, 0.22, [0.26, 0.08, 0.22], cols);
    leg(R, body, 0.42, -0.12, -0.22, true, PI, fu, fl, 0.22, [0.26, 0.08, 0.22], cols);
    leg(R, body, -0.42, -0.12, 0.22, false, PI, hu, hl, 0.24, [0.26, 0.08, 0.22], cols, -0.15, 0.3);
    leg(R, body, -0.42, -0.12, -0.22, false, 0, hu, hl, 0.24, [0.26, 0.08, 0.22], cols, -0.15, 0.3);
    for (const L of R.legs) if (L.front) for (const z of [-0.06, 0, 0.06]) bx(L.foot, 0.05, 0.03, 0.025, C.bone, 0.16, -0.05, z);
  },
  deer(R, o) {
    const col = '#a8784a', light = '#ece2cf', dark = '#5a4030';
    R.cfg = { stride: 1.8, A: 0.5, kneeF: 1.1, kneeH: 0.9, bob: 0.03, bodyY: 0.92, neck0: 1.0, halfW: 0.16, attack: 'kick', runV: 5, height: 1.5, len: 1.5 };
    const body = R.body;
    gm(body, cxbox(0.84, 0.38, 0.3, 0.09, 1.06, 1.0, { bx: 0.9, bz: 0.9 }), M.mat(col, { tex: 'cloth' }), 0, 0, 0);
    bx(body, 0.6, 0.06, 0.22, light, 0.02, -0.18, 0);
    bx(body, 0.06, 0.24, 0.24, light, -0.41, 0.0, 0);
    bx(body, 0.6, 0.04, 0.12, shade(col, 0.8), 0.0, 0.19, 0);
    const neck = R.neck = pivot(body, 0.36, 0.1, 0);
    gm(neck, cxbox(0.44, 0.15, 0.13, 0.04, 0.85, 0.85), M.mat(col), 0.2, 0, 0);
    bx(neck, 0.3, 0.04, 0.1, light, 0.18, -0.065, 0);
    const head = R.head = pivot(neck, 0.42, 0.0, 0);
    gm(head, cbox(0.17, 0.15, 0.14, 0.04, { tx: 0.9, tz: 0.85, bev: 0.03 }), M.mat(col), 0.0, 0.02, 0);
    gm(head, cxbox(0.15, 0.1, 0.09, 0.025, 0.75, 0.75), M.mat(col), 0.13, -0.01, 0);
    bx(head, 0.035, 0.035, 0.05, '#141010', 0.21, 0.0, 0);
    for (const s of [1, -1]) {
      bx(head, 0.05, 0.12, 0.02, col, -0.04, 0.12, s * 0.09, { rx: s * 0.7 });
      bx(head, 0.02, 0.025, 0.025, '#0e0c0c', 0.06, 0.05, s * 0.07);
    }
    if (o.antlers) {
      const ma = M.mat('#d8c8a4');
      for (const s of [1, -1]) {
        const a = sub(head, -0.02, 0.1, s * 0.04, -s * 0.45, 0, -0.35);
        bx(a, 0.025, 0.3, 0.025, ma, 0, 0.15, 0);
        bx(a, 0.02, 0.13, 0.02, ma, 0.04, 0.12, 0, { rz: -0.8 });
        bx(a, 0.02, 0.12, 0.02, ma, 0.03, 0.24, 0, { rz: -0.7 });
        bx(a, 0.02, 0.1, 0.02, ma, -0.02, 0.3, 0, { rz: 0.5 });
      }
    }
    const jaw = R.jaw = pivot(head, 0.1, -0.05, 0);
    bx(jaw, 0.1, 0.025, 0.06, col, 0.04, 0, 0);
    const tail = R.tail = pivot(body, -0.43, 0.12, 0);
    bx(tail, 0.05, 0.12, 0.08, light, -0.02, 0.0, 0, { rz: 0.5 });
    const need = 0.92 - 0.12;
    const [fu, fl] = legLens(need - 0.04, 0, 0), [hu, hl] = legLens(need - 0.04, -0.25, 0.5);
    const cols = [col, col, '#2a2018'];
    leg(R, body, 0.3, -0.12, 0.09, true, 0, fu, fl, 0.075, [0.06, 0.04, 0.05], cols);
    leg(R, body, 0.3, -0.12, -0.09, true, PI, fu, fl, 0.075, [0.06, 0.04, 0.05], cols);
    leg(R, body, -0.3, -0.12, 0.09, false, PI, hu, hl, 0.085, [0.06, 0.04, 0.05], cols, -0.25, 0.5);
    leg(R, body, -0.3, -0.12, -0.09, false, 0, hu, hl, 0.085, [0.06, 0.04, 0.05], cols, -0.25, 0.5);
    if (o.antlers) R.cfg.height = 1.75;
  },
  chicken(R, o) {
    const col = o.color === 'brown' ? '#9a5a32' : '#eee8dc', wing = o.color === 'brown' ? '#7a4426' : '#d8d0c0';
    R.cfg = { stride: 0.34, A: 0.6, kneeF: 0, kneeH: 1.0, bob: 0.012, bodyY: 0.2, neck0: 1.1, halfW: 0.08, attack: 'peck', runV: 1.6, height: 0.35, len: 0.35, biped: true };
    const body = R.body;
    gm(body, cxbox(0.24, 0.17, 0.16, 0.045, 0.8, 0.85, { bev: 0.03 }), M.mat(col), 0, 0, 0);
    bx(body, 0.1, 0.14, 0.1, col, -0.12, 0.07, 0, { rz: 0.6 });
    bx(body, 0.06, 0.1, 0.07, wing, -0.16, 0.13, 0, { rz: 0.9 });
    for (const s of [1, -1]) bx(body, 0.15, 0.09, 0.02, wing, -0.01, 0.01, s * 0.085, { rz: 0.15 });
    const neck = R.neck = pivot(body, 0.09, 0.05, 0);
    bx(neck, 0.08, 0.06, 0.07, col, 0.04, 0, 0);
    const head = R.head = pivot(neck, 0.08, 0, 0);
    bx(head, 0.08, 0.085, 0.07, col, 0, 0.0, 0);
    bx(head, 0.07, 0.04, 0.02, '#c8302a', -0.0, 0.06, 0);
    cn(head, 0.016, 0.05, 4, '#e0a83a', 0.06, -0.005, 0, 'x');
    bx(head, 0.02, 0.035, 0.015, '#c8302a', 0.04, -0.04, 0);
    for (const s of [1, -1]) bx(head, 0.012, 0.014, 0.012, '#111', 0.025, 0.015, s * 0.036);
    R.jaw = null; R.tail = null;
    const ly = '#d8a038';
    leg(R, body, 0.0, -0.06, 0.04, true, 0, 0.07, 0.07, 0.025, [0.06, 0.012, 0.05], [col, ly, ly], 0.2, -0.4);
    leg(R, body, 0.0, -0.06, -0.04, true, PI, 0.07, 0.07, 0.025, [0.06, 0.012, 0.05], [col, ly, ly], 0.2, -0.4);
  },
};

class AnimalRig extends RigBase {
  constructor(kind, o = {}) {
    super();
    this.kind = ANIMAL[kind] ? kind : 'wolf';
    this.root.name = 'animal:' + this.kind;
    this.legs = [];
    this.body = pivot(this.fall, 0, 0, 0, 'body');
    this.groups = [this.body];
    const opts = Object.assign({ antlers: Math.random() < 0.5, color: Math.random() < 0.5 ? 'white' : 'brown' }, o);
    ANIMAL[this.kind](this, opts);
    this.body.position.y = this.cfg.bodyY;
    for (const g of [this.neck, this.head, this.jaw, this.tail]) if (g) this.groups.push(g);
    if (this.neck) this.neck.rotation.z = this.cfg.neck0;
    if (this.head) this.head.rotation.z = -this.cfg.neck0 * 0.8;
    this.skeleton = new THREE.Skeleton(this.groups, this.groups.map(() => new THREE.Matrix4()));
    const C0 = this.cfg, rad = Math.max(C0.len, C0.height) * 0.75 + 0.5;
    this.skinMeshes = skinBuild(this, this.groups, new THREE.Sphere(new THREE.Vector3(0, C0.bodyY, 0), rad));
    this._adopt(this.root);
    this.height = this.cfg.height;
    this.anim = { t: Math.random() * 10, phase: Math.random() * TAU, spd: 0, seed: Math.random() * 10 };
  }
  setHeld() {}
  setLook() {}
  handWorld(v) { (this.head || this.body).updateWorldMatrix(true, false); return (this.head || this.body).localToWorld(v.set(0.15, 0, 0)); }
  muzzleWorld(v) { return this.handWorld(v); }
  update(dt, st) {
    st = st || EMPTY;
    dt = clamp(dt || 0, 0, 0.1);
    const a = this.anim, C0 = this.cfg;
    a.t += dt;
    const speed = st.speed || 0;
    a.spd = damp(a.spd, speed, 8, dt);
    const mv = clamp(a.spd / (C0.stride * 0.6), 0, 1);
    const back = speed > 0.1 && Math.cos(st.moveAng || 0) < -0.25, dirS = back ? -1 : 1;
    a.phase += dirS * a.spd * dt / C0.stride * TAU;
    const ph = a.phase;
    const gal = clamp((a.spd - C0.runV) / C0.runV, 0, 1);
    const A = C0.A * mv * (1 + 0.35 * gal);
    const dead = clamp(st.dead || 0, 0, 1), dw = sstep(0, 0.8, dead);
    const att = st.attack != null && st.attack >= 0 && dead === 0 ? clamp(st.attack, 0, 1) : -1;

    // attack curves: crouch (wind-up) then strike
    let crouch = 0, strike = 0, rear = 0;
    if (att >= 0) { crouch = sstep(0, 0.35, att) * (1 - sstep(0.35, 0.5, att)); strike = sstep(0.35, 0.5, att) * (1 - sstep(0.6, 1, att)); }
    // legs
    for (const L of this.legs) {
      const lp = ph + L.off, sw = Math.sin(lp), lift = Math.max(0, Math.cos(lp) * dirS);
      let a1 = L.a1 + A * sw, a2 = L.a2;
      if (C0.biped) { a2 -= lift * C0.kneeH * mv; a1 += 0.1 * lift * mv; }
      else if (L.front) a2 -= lift * C0.kneeF * mv;
      else { a2 += lift * C0.kneeH * mv; a1 -= lift * C0.kneeH * 0.3 * mv; }
      if (C0.attack === 'swipe' && att >= 0 && L.front) {
        rear = sstep(0, 0.35, att) * (1 - sstep(0.55, 0.95, att));
        const sideR = L.hip.position.z > 0;
        const raise = sstep(0, 0.35, att) * (1 - sstep(0.4, 0.55, att));
        a1 += (sideR ? 1.6 : 0.6) * raise + (sideR ? -0.3 : 0) * strike; a2 -= 0.9 * raise;
      }
      a1 += (L.front ? -0.15 : 0.2) * crouch + (L.front ? 0.25 : -0.3) * strike * (C0.attack === 'lunge' ? 1 : 0.4);
      a1 = lerp(a1, L.front ? 0.35 : -0.35, dw); a2 = lerp(a2, 0, dw * 0.8);
      L.hip.rotation.set(0, 0, a1); L.knee.rotation.set(0, 0, a2); L.foot.rotation.set(0, 0, -(a1 + a2) * (1 - dw));
    }
    // body
    const b = this.body;
    const bob = C0.bob * mv * (1 + gal) * Math.abs(Math.sin(ph));
    const br = Math.sin(a.t * 2.2) * 0.006 * (1 - mv);
    const lunge = C0.attack === 'lunge' || C0.attack === 'gore' ? strike * C0.len * 0.22 - crouch * C0.len * 0.05 : 0;
    b.position.set(lunge, C0.bodyY - bob + br - crouch * C0.bodyY * 0.08 + rear * C0.bodyY * 0.35, 0);
    b.rotation.set(0, 0, 0.03 * Math.sin(2 * ph) * mv - 0.06 * crouch + rear * 0.55 + (C0.attack === 'kick' ? -0.3 * strike : 0));
    // neck / head
    if (this.neck) {
      const graze = (!st.alert && mv < 0.2 && C0.attack !== 'swipe') ? Math.pow(Math.max(0, Math.sin(a.t * 0.45 + a.seed)), 4) : 0;
      let n = C0.neck0 + (st.alert ? 0.35 : 0) + 0.06 * Math.sin(2 * ph) * mv - graze * (C0.biped ? 1.3 : 1.0);
      if (C0.attack === 'peck') n -= 1.3 * strike;
      else if (C0.attack === 'gore') n += -0.35 * crouch + 0.6 * strike;
      else if (C0.attack === 'lunge') n += -0.2 * crouch + 0.15 * strike;
      else if (C0.attack === 'swipe') n += -0.2 * rear;
      n = lerp(n, C0.neck0 * 0.3 - 0.25, dw);
      this.neck.rotation.set(0.25 * dw, 0.08 * Math.sin(a.t * 0.7 + a.seed) * (1 - mv), n);
      if (C0.biped) this.neck.position.x = 0.09 + 0.02 * Math.sin(2 * ph) * mv;
      this.head.rotation.z = -C0.neck0 * 0.8 + (st.alert ? -0.15 : 0) + graze * 0.4 + 0.1 * dw;
    }
    if (this.jaw) this.jaw.rotation.z = -0.55 * Math.max(strike, rear * 0.8) - 0.25 * dw;
    if (this.tail) {
      const wag = this.kind === 'wolf' ? 0.25 * Math.sin(a.t * (mv > 0.3 ? 9 : 4)) : this.kind === 'deer' ? 0.2 * Math.max(0, Math.sin(a.t * 3)) : 0.15 * Math.sin(a.t * 5);
      this.tail.rotation.y = wag * (1 - dw);
      if (this.kind === 'deer') this.tail.rotation.z = st.alert ? 1.2 : 0.2;
    }
    // death: fall onto the side
    const fa = dead < 0.85 ? Math.pow(dead / 0.85, 2) : 1 + 0.05 * Math.sin((dead - 0.85) / 0.15 * PI);
    this.fall.rotation.set(HALF * fa, 0, 0);
    this.fall.position.y = C0.halfW * sstep(0.5, 1, dead);
  }
}

export function makeAnimal(kind, opts) { return new AnimalRig(kind, opts); }

export default { makeHuman, makeAnimal, makeHeld, HELD_INFO, LOOKS };
