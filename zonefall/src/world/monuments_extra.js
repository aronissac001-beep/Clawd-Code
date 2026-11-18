// ============================================================================
// ZONEFALL 3 — extra monument layouts:
//   fishvillage  Saltmarsh Village (tier 0, coastal haven: Bait & Tackle vendor,
//                long jetty, stilt net loft, smokehouse, boathouse; no hostiles)
//   observatory  Observatory (tier 2, green card + fuse: domed hall with a
//                telescope, office wing with a powered green vault, generator
//                shed with the fuse box, bandit camp, radio-telescope dish)
// Same conventions as monuments.js: LOCAL metres, origin = monument centre,
// +X east / +Z south before rotation. Coastal sites face the sea with local +X
// (past ~0.55 * size it is water: only docks, boats and decor live there).
// Asymmetric props (counter, desk, fusebox, boat...) only get local yaw 0 / PI.
// Curved pieces (drum, dome, rowboats, wires...) are visual meshes merged into
// the monument's static group; their colliders are invisible kit boxes/circles.
// ============================================================================
import { THREE, M } from '../gfx/materials.js';

const Q = Math.PI / 2, PI = Math.PI, TAU = Math.PI * 2;

// ---------------------------------------------------------------- generic helpers
/** the monument's static group (baked into one mesh per material at the end of buildMonument) */
const statics = K => (K.group.children[0] && K.group.children[0].isGroup ? K.group.children[0] : K.group);
const mat = (surf, o) => (typeof surf === 'string' ? M.surf(surf, o || {}) : surf);
/** visual-only mesh (no collider) at LOCAL (x, y, z). ry = local yaw (+X -> +Z positive), rx / rz tilt in the mesh frame, s = [sx, sy, sz] */
function vis(K, geo, surf, x, y, z, o = {}) {
  const [wx, wz] = K.toWorld(x, z);
  const m = M.add(statics(K), geo, mat(surf), wx - K.mon.x, y, wz - K.mon.z, { cast: o.cast });
  m.rotation.order = 'YXZ'; m.rotation.set((K.flip ? -1 : 1) * (o.rx || 0), K.wry ? K.wry(o.ry) : -(K.rot * Q + (o.ry || 0)), o.rz || 0);
  if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  return m;
}
/** reverse a geometry's facing (winding + normals) so a single-sided material shows its other side */
function flipGeo(g) {
  if (g.index) { const ix = g.index; for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); } }
  else for (const k of Object.keys(g.attributes)) { const at = g.attributes[k], n = at.itemSize; for (let i = 0; i < at.count; i += 3) for (let c = 0; c < n; c++) { const a = at.array[(i + 1) * n + c]; at.array[(i + 1) * n + c] = at.array[(i + 2) * n + c]; at.array[(i + 2) * n + c] = a; } }
  const nr = g.attributes.normal; if (nr) for (let i = 0; i < nr.count; i++) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
  return g;
}
/** both faces of a thin shell (front + flipped copy) with the plain material, so it bakes into the shared draw call */
function twoSided(K, geo, surf, x, y, z, o = {}) { vis(K, geo, surf, x, y, z, o); return vis(K, flipGeo(geo.clone()), surf, x, y, z, o); }
/** a rod / tube between two LOCAL points a = [x, y, z] and b (visual only) */
function rod(K, surf, r, a, b, seg = 6, o = {}) {
  const [ax, az] = K.toWorld(a[0], a[2]), [bx, bz] = K.toWorld(b[0], b[2]);
  const d = new THREE.Vector3(bx - ax, b[1] - a[1], bz - az), L = d.length(); if (L < 1e-3) return null;
  const m = M.add(statics(K), M.cyl(r, r, 1, seg), mat(surf), (ax + bx) / 2 - K.mon.x, (a[1] + b[1]) / 2, (az + bz) / 2 - K.mon.z, { cast: o.cast });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.scale.y = L;
  return m;
}
/**
 * register a roofed room record (shelter from rain / snow) over a footprint without building anything:
 * a kit room with fully open sides whose lintel and roof meshes are stripped again (no colliders are made)
 */
function shelter(K, x, z, w, d) {
  const st = statics(K), n0 = st.children.length;
  const rm = K.room({ x, z, w, d, h: 3, floor: false, roofProps: false, doors: ['n', 's', 'e', 'w'].map(side => ({ side, w: (side === 'n' || side === 's' ? w : d) + 1 })) });
  for (const c of st.children.slice(n0)) st.remove(c);
  if (rm.roof) rm.roof.clear();
  return rm;
}
/** invisible colliders (the kit registers the collider, the mesh is dropped) */
function blockBox(K, x, z, w, d, h, o = {}) { const m = K.box(x, z, w, d, h, 'concrete', Object.assign({ cast: false }, o)); if (m && m.parent) m.parent.remove(m); }
function blockCircle(K, x, z, r, h, o = {}) { const m = K.cyl(x, z, r, h, 'concrete', Object.assign({ seg: 6 }, o)); if (m && m.parent) m.parent.remove(m); }
/** open cylinder band between angles t0..t1 (theta 0 = local +Z / south, PI/2 = +X / east), UVs in metres */
function arcGeo(r, h, t0, t1, texScale = 2) {
  const n = Math.max(2, Math.ceil((t1 - t0) / 0.13));
  const g = new THREE.CylinderGeometry(r, r, h, n, 1, true, t0, t1 - t0);
  const uv = g.attributes.uv, L = r * (t1 - t0);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / texScale, uv.getY(i) * h / texScale);
  return g;
}
/** flat annulus facing +Y once tilted with rx = -PI/2 */
const ringGeo = (r0, r1, seg = 48) => new THREE.RingGeometry(r0, r1, seg, 1);
/** upper hemisphere (dome), UVs in metres */
function domeGeo(r, ws = 30, hs = 10, texScale = 2) {
  const g = new THREE.SphereGeometry(r, ws, hs, 0, TAU, 0, PI / 2);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * r / texScale, uv.getY(i) * PI / 2 * r / texScale);
  return g;
}
/** constant-width strip lying on a sphere of radius r: lateral offsets s0..s1 (X), meridian angle t0..t1 from the zenith toward -Z */
function stripGeo(r, s0, s1, t0, t1, n = 14) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (t1 - t0) * i / n, cy = Math.cos(t) * r, cz = -Math.sin(t) * r;
    for (const s of [s0, s1]) { const L = Math.hypot(s, cy, cz); pos.push(s / L * r, cy / L * r, cz / L * r); uv.push(s / 2, (t - t0) * r / 2); }
  }
  for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
/** half ellipsoid hull (lower = bowl, upper = upturned) */
const hullGeo = upper => new THREE.SphereGeometry(1, 16, 5, 0, TAU, upper ? 0 : PI / 2, PI / 2);
/**
 * pitched roof (visual) sitting on a kit room's flat roof + trim: attic prism in the wall surface,
 * two roof panels and a ridge cap. Ridge along the longer side unless o.alongX says otherwise.
 */
function gable(K, rm, wall, surf, o = {}) {
  const alongX = o.alongX ?? (rm.w >= rm.d), ry = alongX ? Q : 0;
  const across = alongX ? rm.d : rm.w, len = (alongX ? rm.w : rm.d) + 0.6;
  const a = o.pitch ?? 0.5, hp = across / 2 + 0.3, rise = hp * Math.tan(a), y0 = rm.h + 0.62, span = hp + 0.4;
  const g = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-hp, 0), new THREE.Vector2(hp, 0), new THREE.Vector2(0, rise)]), { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  vis(K, g, wall, rm.x, y0, rm.z, { ry });
  for (const s of [-1, 1]) {
    const c = s * span / 2, y = y0 + rise - (span / 2) * Math.tan(a) + 0.07;
    vis(K, M.box(span / Math.cos(a), 0.12, len + 0.5), surf, alongX ? rm.x : rm.x + c, y, alongX ? rm.z + c : rm.z, { ry, rz: -s * a });
  }
  vis(K, M.box(0.34, 0.14, len + 0.56), o.ridge || 'plank_dark', rm.x, y0 + rise + 0.1, rm.z, { ry });
  return y0 + rise;
}
/** stove pipe from inside a room up through its roof */
function stovepipe(K, x, z, y1) { rod(K, 'metal_dark', 0.11, [x, 1.2, z], [x, y1, z], 8); vis(K, M.cyl(0.2, 0.16, 0.22, 8), 'metal_dark', x, y1 + 0.05, z); }

// ---------------------------------------------------------------- helpers shared with monuments.js (local copies)
/** a cloth / tin canopy on four thin posts (posts collide, canopy does not) */
function canopy(K, x, z, w, d, y, surf, posts = true) {
  K.box(x, z, w, d, 0.14, surf, { y, collide: false });
  if (posts) for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.cyl(x + sx * (w / 2 - 0.2), z + sz * (d / 2 - 0.2), 0.08, y, 'metal_dark', { seg: 6 });
}
/** U of sandbags facing a direction ('n' = toward -Z ...); the open side is behind */
function sandbagU(K, x, z, face = 'n') {
  const F = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[face]; const Rt = [-F[1], F[0]];
  const rqF = F[0] === 0 ? 0 : Q, rqS = F[0] === 0 ? Q : 0;
  K.prop('sandbags', x + F[0] * 1.4, z + F[1] * 1.4, rqF);
  for (const s of [-1, 1]) K.prop('sandbags', x + Rt[0] * s * 1.4 + F[0] * 0.6, z + Rt[1] * s * 1.4 + F[1] * 0.6, rqS);
}
/** non-loot decor crate */
const dcrate = (K, x, z, s = 0.9, surf = 'plank', y = 0) => K.box(x, z, s, s, s, surf, { y, collide: y < 0.5 });
/** village well / water pump with a little roof */
function well(K, x, z) {
  K.cyl(x, z, 1.0, 0.8, 'stone', { seg: 12, opaque: false });
  K.cyl(x, z, 0.78, 0.04, '#2c4a58', { y: 0.78, collide: false, seg: 12 });
  for (const s of [-1, 1]) K.box(x + s * 0.88, z, 0.16, 0.16, 2.3, 'log', { collide: false });
  K.box(x, z, 2.4, 1.5, 0.12, 'plank_dark', { y: 2.3, collide: false });
  K.box(x, z, 1.9, 0.08, 0.08, 'log', { y: 1.6, collide: false });
  K.water(x, z);
}
const lamp = (K, x, z, rq = 0) => K.prop('lamp', x, z, rq);
function flood(K, x, z, rq = 0, range = 16) { K.deployModel('floodlight', x, z, rq); K.light(x, z, 2.4, '#fff2d8', 1.4, range); }
function fire(K, x, z, i = 1.5) { K.deployModel('campfire', x, z); K.light(x, z, 1.1, '#ff9a40', i, 10); }
const room = (K, o) => K.room(o);

// ---------------------------------------------------------------- fishing-village pieces
const NET_MAT = () => M.mat('#3c5a4c', { tex: 'cloth', transparent: true, opacity: 0.55, side: 'double' });
const FISH = ['metal', 'metal', 'white_paint', 'yellow_paint', 'red_paint'];
/** a row of fish hanging from a bar at height y */
function fishRow(K, x0, z0, x1, z1, y, step = 0.32) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0), L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  for (let s = 0.2; s <= L - 0.15; s += step) {
    const x = alongX ? Math.min(x0, x1) + s : x0, z = alongX ? z0 : Math.min(z0, z1) + s;
    K.box(x, z, alongX ? 0.1 : 0.04, alongX ? 0.04 : 0.1, 0.34, K.R.pick(FISH), { y: y - 0.38, collide: false });
  }
}
/** drying rack: two log posts, two bars of fish (or a net) */
function rack(K, x, z, len, alongX = true, o = {}) {
  const h = o.h ?? 2.1;
  for (const s of [-1, 1]) K.box(alongX ? x + s * len / 2 : x, alongX ? z : z + s * len / 2, 0.15, 0.15, h + 0.1, 'log');
  for (const y of [h - 0.05, h - 0.75]) {
    K.box(x, z, alongX ? len + 0.2 : 0.07, alongX ? 0.07 : len + 0.2, 0.07, 'log', { y, collide: false });
    if (!o.net) fishRow(K, alongX ? x - len / 2 : x, alongX ? z : z - len / 2, alongX ? x + len / 2 : x, alongX ? z : z + len / 2, y);
  }
  if (o.net) K.box(x, z, alongX ? len - 0.1 : 0.03, alongX ? 0.03 : len - 0.1, h - 0.4, NET_MAT(), { y: 0.3, collide: false, cast: false });
}
/** wooden rowboat (custom hull). yaw: quarter turns only; o.flip = upturned on logs; o.y = lift (trestles) */
function rowboat(K, x, z, yaw = 0, o = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw), P = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
  const water = K.yAt(x, z) < -0.2, y0 = (water ? -K.baseY - 0.22 : 0) + (o.y ?? 0);
  const hull = o.hull || 'plank_dark', rim = o.rim || 'red_paint';
  if (o.flip) {
    for (const dx of [-0.85, 0.85]) { const [px, pz] = P(dx, 0); vis(K, M.box(0.24, 0.22, 1.5), 'log', px, y0 + 0.11, pz, { ry: yaw }); }
    vis(K, hullGeo(true), hull, x, y0 + 0.22, z, { ry: yaw, s: [1.6, 0.5, 0.62] });
    vis(K, new THREE.TorusGeometry(1, 0.06, 4, 20), rim, x, y0 + 0.24, z, { ry: yaw, rx: Q, s: [1.6, 0.62, 1] });
  } else {
    twoSided(K, hullGeo(false), hull, x, y0 + 0.5, z, { ry: yaw, s: [1.6, 0.5, 0.62] });
    vis(K, new THREE.TorusGeometry(1, 0.06, 4, 20), rim, x, y0 + 0.5, z, { ry: yaw, rx: Q, s: [1.6, 0.62, 1] });
    for (const dx of [-0.5, 0.45]) { const [px, pz] = P(dx, 0); vis(K, M.box(0.22, 0.05, 1.08), 'plank', px, y0 + 0.36, pz, { ry: yaw }); }
    if (o.oars !== false) for (const dz of [-0.18, 0.18]) { const [px, pz] = P(0.1, dz); vis(K, M.box(2.3, 0.04, 0.09), 'plank', px, y0 + 0.42, pz, { ry: yaw + dz * 0.3 }); }
  }
  if (!water && o.collide !== false) { const w = Math.abs(3.2 * c) + Math.abs(1.24 * s), d = Math.abs(3.2 * s) + Math.abs(1.24 * c); blockBox(K, x, z, w, d, (o.y ?? 0) + 0.7, { opaque: false }); }
}
/** lantern hanging from a log post (light at night) */
function lanternPost(K, x, z, side = 1, i = 1.0) {
  K.box(x, z, 0.16, 0.16, 2.3, 'log');
  K.box(x + side * 0.3, z, 0.6, 0.08, 0.08, 'log', { y: 2.15, collide: false });
  const l = K.deployModel('lantern', x + side * 0.52, z); l.position.y = 1.62;
  K.light(x + side * 0.52, z, 1.85, '#ffc070', i, 10);
}
const buoy = (K, x, y, z, surf = 'red_paint', r = 0.2) => vis(K, M.sphere(r, 8, 6), surf, x, y, z);
/** stack of crab / lobster pots (decor) */
function pots(K, x, z, n = 3) {
  for (let k = 0; k < n; k++) { const top = k === n - 1 && n > 2; K.box(x + (k % 2) * 0.72, z, 0.66, 0.48, 0.42, k % 2 ? 'plank' : 'plank_dark', { y: top ? 0.42 : 0, collide: !top }); }
  if (n > 2) K.box(x + 0.36, z, 0.66, 0.48, 0.42, 'plank', { y: 0.42, collide: false });
}

// ============================================================================
// SALTMARSH VILLAGE — peaceful fishing village on the shore (safe zone):
// Bait & Tackle shop, stilt shacks, smokehouse, boathouse, drying racks, a
// long jetty with a net loft over the water and moored boats.
// ============================================================================
function fishvillage(K) {
  K.label('Saltmarsh Village'); K.safe(26);
  // ground: packed dirt village, sand beach (the sea starts ~16.5 m out on +X), plank boardwalk + jetty
  K.ground(-4, 0, 36, 36, 'dirt', { y: 0.02 });
  K.ground(-24.5, 0, 6, 6, 'dirt', { y: 0.02 });
  K.ground(12.75, 0, 7.5, 44, 'sand', { y: 0.025 });
  K.ground(-4.75, 0, 33.5, 3, 'plank', { y: 0.045 });
  K.ground(1.5, -4.2, 6.5, 5.4, 'plank_dark', { y: 0.04 }); // plaza deck round the well
  for (const x of [-15.5, -6.5, 2, 9.5]) K.ground(x, -2.5, 1.6, 2, 'plank_dark', { y: 0.04 }); // steps up to the north doors
  for (const x of [-13.2, -6.5, 3.5, 9.5]) K.ground(x, 3.6, 1.6, 4.2, 'plank_dark', { y: 0.04 });
  // ---- jetty: three docks out to sea, an L platform to the north holding the net loft
  for (const [x, z] of [[14.5, 0], [20.5, 0], [26.5, 0], [20.5, -6], [26.5, -6]]) K.prop('dock', x, z, 0);
  for (const [x, z] of [[17.5, 2.75], [23.5, 2.75], [29.2, 2.75], [29.2, -2.75], [23.6, -8.7]]) K.cyl(x, z, 0.14, 0.55, 'metal_dark', { seg: 8 });
  K.prop('boat', 24.5, 5.0, 0);
  rod(K, '#a08a60', 0.025, [23.5, 0.5, 2.75], [22.0, 1.4, 3.9]); rod(K, '#a08a60', 0.025, [29.2, 0.5, 2.75], [27.6, 1.5, 4.0]);
  rowboat(K, 27.0, -10.7, 0, { rim: 'blue_paint', oars: false, collide: false });
  rod(K, '#a08a60', 0.025, [23.6, 0.5, -8.7], [25.5, 0.05, -10.6]);
  // net loft on stilts over the water (no loot out here)
  const loft = room(K, { x: 20.5, z: -6.4, w: 5.0, d: 4.4, h: 2.9, wall: 'plank_dark', roof: 'corrugated_rust', trim: 'plank', floor: false, roofProps: false,
    doors: [{ side: 's', w: 1.8 }], windows: [{ side: 'e', w: 1.2 }, { side: 'w', w: 1.2 }] });
  gable(K, loft, 'plank_dark', 'corrugated_rust', { pitch: 0.55 });
  vis(K, M.ico(0.75, 1), 'tarp_green', 19.0, 0.28, -7.6, { s: [1.3, 0.38, 0.9] });
  vis(K, M.ico(0.6, 1), 'tarp_blue', 22.0, 0.22, -7.8, { s: [1.0, 0.36, 0.8] });
  dcrate(K, 22.4, -5.2, 0.7, 'plank'); dcrate(K, 22.4, -5.2, 0.55, 'plank_dark', 0.7);
  for (const z of [-7.6, -5.6]) rod(K, 'plank', 0.04, [18.25, 0.05, z], [18.3, 2.1, z + 0.25]);
  for (const [x, z, s] of [[18.6, -3.95, 'red_paint'], [19.2, -3.95, 'white_paint'], [21.8, -3.95, 'red_paint'], [23.3, -5.2, 'white_paint'], [23.3, -7.4, 'red_paint']]) buoy(K, x, 1.9, z, s);
  K.light(20.5, -6.4, 2.5, '#ffd9a0', 0.8, 7);
  // end platform: gutting table, pots, davit with a hook, lantern
  K.prop('table', 26.8, -4.2, 0); pots(K, 24.4, -8.2, 3); pots(K, 28.2, -1.2, 2);
  K.box(28.0, -8.2, 0.2, 0.2, 2.8, 'metal_dark'); K.box(27.2, -8.2, 1.7, 0.12, 0.12, 'metal_dark', { y: 2.7, collide: false });
  rod(K, '#a08a60', 0.02, [26.5, 2.7, -8.2], [26.5, 1.4, -8.2]); vis(K, M.box(0.08, 0.25, 0.04), 'metal_dark', 26.5, 1.28, -8.2);
  lanternPost(K, 29.1, -4.4, -1, 1.0);
  // ---- Bait & Tackle shop at the head of the jetty (vendor + trader)
  const shop = room(K, { x: 9.5, z: -6.5, w: 7, d: 5, h: 3.2, wall: 'plank', roof: 'corrugated_blue', trim: 'white_paint', floor: 'plank_dark', roofProps: false,
    doors: [{ side: 's', w: 3.0 }], windows: [{ side: 'e', w: 1.4 }, { side: 'w', w: 1.4 }] });
  gable(K, shop, 'plank', 'corrugated_blue', { alongX: false, ridge: 'white_paint' });
  K.vendor('fisher', 9.5, -5.6, 0);
  for (const sx of [-1, 1]) K.box(9.5 + sx * 2.42, -5.6, 1.85, 0.5, 1.1, 'plank_dark');
  K.npc('trader', 9.5, -7.0, { guard: true });
  K.prop('shelf', 8.0, -8.5, 0); K.prop('shelf', 11.0, -8.5, 0);
  for (let k = 0; k < 4; k++) rod(K, k % 2 ? 'plank' : 'plank_dark', 0.025, [12.75, 0.1, -7.9 + k * 0.32], [12.75, 2.6, -8.1 + k * 0.32]);
  vis(K, M.sphere(1, 10, 6), 'yellow_paint', 9.5, 2.45, -8.84, { s: [0.55, 0.22, 0.06] }); // trophy fish
  K.box(9.5, -3.78, 3.6, 0.1, 0.45, 'blue_paint', { y: 2.78, collide: false });
  vis(K, M.sphere(1, 12, 8), 'yellow_paint', 9.25, 4.65, -3.62, { s: [1.0, 0.42, 0.1] }); // fish sign on the gable
  vis(K, M.cone(0.42, 0.6, 4), 'yellow_paint', 10.5, 4.65, -3.62, { rz: Q, s: [1, 1, 0.25] });
  vis(K, M.sphere(0.07, 6, 4), 'metal_dark', 8.6, 4.75, -3.53);
  canopy(K, 9.5, -2.85, 7.0, 2.0, 2.5, 'corrugated_green');
  K.box(7.0, -2.6, 1.2, 0.6, 0.7, 'blue_paint'); K.box(7.0, -2.6, 1.04, 0.44, 0.04, '#2c4a58', { y: 0.7, collide: false });
  K.prop('bench', 12.0, -2.4, 0);
  K.light(9.5, -6.4, 2.8, '#ffd9a0', 1.0, 8);
  K.npc('guard', 13.2, 2.6, { guard: true });
  // ---- north row: two shacks, well plaza with a washing line
  gable(K, room(K, { x: -5.5, z: -8, w: 6.5, d: 5, wall: 'plank', roof: 'corrugated_red', trim: 'plank_dark', floor: 'plank', roofProps: false,
    doors: [{ side: 's', at: -1, w: 1.6 }], windows: [{ side: 's', at: 1.7, w: 1.2 }, { side: 'w', w: 1.2 }, { side: 'n', w: 1.2 }] }), 'plank', 'corrugated_red');
  K.prop('bunkbed', -7.4, -9.75, 0); K.prop('table', -4.0, -8.8, 0);
  K.container('locker', -8.25, -6.2); K.container('food', -2.9, -6.3, Q);
  K.light(-5.5, -8, 2.7, '#ffcf8a', 0.8, 7);
  gable(K, room(K, { x: -14.5, z: -7.5, w: 5.5, d: 5, wall: 'plank_dark', roof: 'corrugated_green', trim: 'plank', floor: 'plank', roofProps: false,
    doors: [{ side: 's', at: -1, w: 1.6 }], windows: [{ side: 'e', w: 1.2 }, { side: 'w', w: 1.2 }, { side: 'n', w: 1.2 }] }), 'plank_dark', 'corrugated_green', { alongX: false, pitch: 0.55 });
  K.deployModel('furnace', -16.4, -9.2); blockBox(K, -16.4, -9.2, 0.9, 0.9, 1.4); stovepipe(K, -16.4, -9.4, 5.4); K.prop('table', -13.0, -8.9, 0);
  K.container('crate', -12.6, -6.0);
  well(K, 1.5, -6.0);
  for (const [x, z, r] of [[-0.6, -3.0, 0], [3.6, -3.0, 0]]) K.prop('bench', x, z, r);
  K.box(-1.3, -11.6, 0.1, 0.1, 2.2, 'log'); K.box(4.3, -11.6, 0.1, 0.1, 2.2, 'log');
  rod(K, '#d8d4c8', 0.012, [-1.3, 2.1, -11.6], [4.3, 2.1, -11.6]);
  for (const [x, s, h] of [[-0.6, 'cloth', 0.7], [0.3, 'tarp_blue', 0.55], [1.2, 'white_paint', 0.8], [2.2, 'red_paint', 0.6], [3.3, 'tarp_green', 0.7]]) K.box(x, -11.6, 0.7, 0.03, h, s, { y: 2.08 - h, collide: false });
  // ---- north beach: drying racks, net rack, gutting table, beached rowboats
  rack(K, 1.0, -15.0, 4); rack(K, 6.2, -15.0, 4); rack(K, -4.6, -14.6, 3.4, true, { net: true });
  K.prop('table', 3.6, -12.4, 0); vis(K, M.cyl(0.22, 0.18, 0.4, 10), 'metal', 2.6, 0.2, -11.6); vis(K, M.cyl(0.22, 0.18, 0.4, 10), 'blue_paint', 4.6, 0.2, -11.6);
  K.container('barrel', -1.8, -12.6);
  rowboat(K, 14.6, -11.8, Q, { rim: 'green_paint' }); rowboat(K, 11.4, -16.4, 0, { flip: true, hull: 'plank', rim: 'blue_paint' });
  K.container('barrel_oil', 12.3, -13.6);
  for (const [x, z, s] of [[15.6, -15.5, 'red_paint'], [16.0, -14.9, 'white_paint'], [15.3, -14.6, 'yellow_paint']]) buoy(K, x, 0.22, z, s, 0.22);
  // ---- south row: two shacks, smokehouse, boathouse
  gable(K, room(K, { x: -13.2, z: 8, w: 6, d: 5, wall: 'corrugated_blue', roof: 'corrugated', trim: 'white_paint', floor: 'plank_dark', roofProps: false,
    doors: [{ side: 'n', w: 1.6 }], windows: [{ side: 'w', w: 1.2 }, { side: 's', w: 1.2 }, { side: 'e', w: 1.2 }] }), 'corrugated_blue', 'corrugated', { ridge: 'white_paint', pitch: 0.45 });
  K.prop('bunkbed', -15.0, 9.8, 0); K.prop('table', -11.6, 9.6, 0);
  K.container('medbox', -15.4, 6.2); K.container('crate', -11.0, 6.4, Q);
  gable(K, room(K, { x: -4.5, z: 8.5, w: 7, d: 5.5, wall: 'plank', roof: 'corrugated_blue', trim: 'plank_dark', floor: 'plank', roofProps: false,
    doors: [{ side: 'n', at: -2, w: 1.6 }], windows: [{ side: 'n', at: 1.6, w: 1.4 }, { side: 'e', w: 1.2 }, { side: 's', w: 1.4 }] }), 'plank', 'corrugated_red', { alongX: false });
  K.deployModel('furnace', -2.0, 8.6); blockBox(K, -2.0, 8.6, 0.9, 0.9, 1.4); stovepipe(K, -2.0, 8.6, 5.6);
  K.prop('bunkbed', -2.6, 10.45, 0); K.prop('table', -6.0, 9.6, 0); K.prop('bench', -6.0, 10.6, 0);
  vis(K, M.ico(0.5, 1), 'tarp_green', -4.0, 0.2, 6.9, { s: [1.2, 0.4, 0.8] }); // net being mended
  K.container('food', -7.4, 10.5); K.container('locker', -1.75, 7.0);
  K.light(-4.5, 8.5, 2.7, '#ffcf8a', 0.8, 7);
  gable(K, room(K, { x: 3.5, z: 7.75, w: 4.6, d: 4.0, h: 2.8, wall: 'plank_dark', roof: 'corrugated_rust', trim: 'plank_dark', floor: 'dirt', roofProps: false,
    doors: [{ side: 'n', w: 1.6 }] }), 'plank_dark', 'corrugated_rust', { pitch: 0.6 });
  K.box(5.05, 9.15, 0.7, 0.7, 5.3, 'brick'); K.box(5.05, 9.15, 0.85, 0.85, 0.2, 'concrete_dark', { y: 5.3, collide: false });
  fire(K, 3.0, 8.6, 1.2);
  for (const z of [7.05, 8.0]) { K.box(3.2, z, 3.9, 0.06, 0.06, 'log', { y: 2.1, collide: false }); fishRow(K, 1.4, z, 4.9, z, 2.1, 0.28); }
  K.container('food', 1.9, 6.45);
  gable(K, room(K, { x: 11, z: 8.5, w: 6.5, d: 6, h: 3.4, wall: 'corrugated', roof: 'corrugated_rust', trim: 'metal_dark', floor: 'plank_dark', roofProps: false,
    doors: [{ side: 'e', w: 3.2 }, { side: 'n', at: -1.5, w: 1.6 }], windows: [{ side: 's', w: 1.4 }, { side: 'w', w: 1.2 }] }), 'corrugated', 'corrugated_rust', { ridge: 'metal_dark', pitch: 0.42 });
  for (const dx of [-1.0, 1.0]) K.box(10.8 + dx, 8.5, 0.3, 1.0, 0.5, 'plank_dark');
  rowboat(K, 10.8, 8.5, 0, { y: 0.5, rim: 'white_paint', collide: false });
  K.prop('workbench_old', 8.45, 10.7, 0);
  K.container('toolbox', 13.4, 6.3); K.container('barrel_oil', 8.3, 6.25);
  K.light(11, 8.5, 3.0, '#ffd9a0', 0.8, 8);
  // ---- south beach: campfire with log seats, beached boat, rods in the sand
  fire(K, 6.0, 15.2);
  K.box(6.0, 13.6, 1.8, 0.4, 0.4, 'log'); K.box(4.4, 15.2, 0.4, 1.8, 0.4, 'log'); K.box(7.6, 15.6, 0.4, 1.6, 0.4, 'log');
  rowboat(K, 13.6, 15.4, 0, { rim: 'red_paint' });
  for (const [x, z] of [[15.6, 11.8], [15.9, 12.6]]) { rod(K, 'plank_dark', 0.03, [x, 0, z], [x + 0.9, 2.4, z]); rod(K, '#d8d4c8', 0.006, [x + 0.9, 2.4, z], [x + 1.25, 0.05, z]); }
  pots(K, 14.0, 12.4, 3);
  K.container('barrel', 8.6, 13.2);
  // ---- inland: entrance arch, fence, garden, trees
  for (const s of [-1, 1]) K.box(-20.5, s * 2.3, 0.32, 0.32, 3.8, 'log');
  K.box(-20.5, 0, 0.3, 5.4, 0.3, 'log', { y: 3.5, collide: false });
  K.box(-20.65, 0, 0.08, 3.0, 0.6, 'plank', { y: 2.75, collide: false });
  for (const z of [-1.0, 1.0]) { rod(K, '#a08a60', 0.015, [-20.5, 3.5, z], [-20.5, 2.6, z]); K.box(-20.5, z, 0.04, 0.12, 0.4, 'metal', { y: 2.2, collide: false }); }
  for (const z of [-16.5, -13.5, -10.5, -7.5, -4.5, 4.5, 7.5, 10.5, 13.5, 16.5]) K.prop('fence_wood', -21.5, z, Q);
  K.ground(-17, 14, 6, 4, 'dirt', { y: 0.03 });
  for (const x of [-19, -17, -15]) { K.veg('hemp', x, 13.2, 0.9); K.veg('berry_bush', x, 14.9, 0.8); }
  K.deployModel('water_barrel', -18.5, 10.6); blockCircle(K, -18.5, 10.6, 0.45, 1.05);
  for (const [k, x, z, s] of [['birch', -24, -9, 1], ['pine', -25, 10, 1], ['birch', -18, -15.5, 0.9], ['oak', -10, -16, 1], ['bush', -12, -13, 1], ['bush', -3, 13.5, 0.9],
    ['grass', 8.5, -12, 1], ['grass', 9.5, 12.5, 1], ['grass', -0.5, 14, 1], ['bush', -9, 14, 1], ['fern', -22.5, 4, 1], ['stump', -24, -4, 1]]) K.veg(k, x, z, s);
  // boardwalk lanterns
  lanternPost(K, -11.5, 1.9, 1); lanternPost(K, -1.5, -1.9, -1); lanternPost(K, 5.5, 1.9, 1);
}

// ============================================================================
// OBSERVATORY (green card + fuse) — domed hall with a telescope, office wing
// with a powered green-card vault, generator shed with the fuse box,
// radio-telescope dish, viewing terrace, bandit camp, parking
// ============================================================================
/**
 * Round wall (drum) centred at local (cx, cz), radius r: one double-sided shell,
 * overlapping circle colliders along it (inset so door gaps keep full width),
 * gaps [[theta, width], ...] (theta 0 = +Z south, PI/2 = +X east) with jambs, soffit and a lintel from `top` up.
 */
function ringWall(K, cx, cz, r, h, surf, gaps = [], o = {}) {
  const t = o.thick ?? 0.4, rc = t / 2 + 0.1, top = o.top ?? 2.5, ro = r + t / 2 - 0.05, ri = r - t / 2 + 0.05;
  const shell = (h0, h1, a0, a1) => { vis(K, arcGeo(ro, h1 - h0, a0, a1), surf, cx, (h0 + h1) / 2, cz); vis(K, flipGeo(arcGeo(ri, h1 - h0, a0, a1)), surf, cx, (h0 + h1) / 2, cz); };
  const gs = gaps.map(([a, w]) => [a - w / 2 / r, a + w / 2 / r]).sort((p, q) => p[0] - q[0]);
  const arcs = [];
  if (!gs.length) arcs.push([0, TAU]);
  else for (let i = 0; i < gs.length; i++) { const a0 = gs[i][1]; let a1 = gs[(i + 1) % gs.length][0]; if (i === gs.length - 1) a1 += TAU; if (a1 > a0 + 1e-3) arcs.push([a0, a1]); }
  const P = (a, rr = r) => [cx + rr * Math.sin(a), cz + rr * Math.cos(a)];
  for (const [a0, a1] of arcs) {
    shell(0, h, a0, a1);
    if (o.plinth) vis(K, arcGeo(r + t / 2 + 0.04, 0.5, a0, a1), o.plinth, cx, 0.25, cz);
    const b0 = a0 + rc / r, b1 = a1 - rc / r, n = Math.max(1, Math.ceil((b1 - b0) * r / 0.5));
    for (let k = 0; k <= n; k++) { const [x, z] = P(b0 + (b1 - b0) * k / n); blockCircle(K, x, z, rc, h); }
  }
  for (const [g0, g1] of gs) {
    shell(top, h, g0, g1);
    const gm = (g0 + g1) / 2, half = (g1 - g0) / 2, [sx, sz] = P(gm, r * Math.cos(half));
    vis(K, M.box(2 * r * Math.sin(half) + 0.1, 0.1, t), surf, sx, top - 0.05, sz, { ry: -gm });
    for (const [a, k] of [[g0, -1], [g1, 1]]) { const ae = a + k * 0.1 / r, [x, z] = P(ae); vis(K, M.box(0.2, top, t), surf, x, top / 2, z, { ry: -ae }); }
  }
}
/** coin-operated viewing telescope on a post, looking along local yaw `aim` */
function coinScope(K, x, z, aim) {
  K.cyl(x, z, 0.09, 1.15, 'metal_dark', { seg: 8 }); K.cyl(x, z, 0.28, 0.08, 'concrete', { seg: 10, collide: false });
  const D = [Math.cos(aim), 0.3, Math.sin(aim)];
  rod(K, 'blue_paint', 0.12, [x - D[0] * 0.35, 1.3 - D[1] * 0.35, z - D[2] * 0.35], [x + D[0] * 0.4, 1.3 + D[1] * 0.4, z + D[2] * 0.4], 10);
  vis(K, M.box(0.2, 0.26, 0.2), 'blue_paint', x, 1.2, z, { ry: aim });
}
function observatory(K) {
  K.label('Observatory');
  const DX = -4, DZ = -6, DR = 7.2, DH = 5.2, DOME = 7.45;
  // plateau, plaza, path, parking
  K.ground(0, 0, 50, 50, 'gravel', { y: 0.02 });
  K.ground(-1, 8.5, 30, 13, 'concrete', { y: 0.03 });
  K.ground(-4, 19.5, 4.6, 9, 'stone', { y: 0.035 });
  K.ground(-4, 27, 22, 8, 'asphalt', { y: 0.03 });
  for (let k = 0; k < 7; k++) K.ground(-13 + 3 * k, 24.6, 0.12, 3.2, 'white_paint', { y: 0.05, t: 0.02 });
  K.ground(-21.5, 0, 10, 16, 'stone', { y: 0.025 }); // viewing terrace
  K.ground(15, 4.5, 5, 6, 'gravel', { y: 0.025 });
  // ---- domed hall: round floor, stone drum, cornice, white dome with a dark slit and ribs
  K.cyl(DX, DZ, DR - 0.1, 0.1, 'tile', { collide: false, seg: 36 });
  K.cyl(DX, DZ, 2.4, 0.03, 'tile_dark', { y: 0.1, collide: false, seg: 24 });
  ringWall(K, DX, DZ, DR, DH, 'stone', [[0, 2.2], [Q, 2.7]], { plinth: 'concrete_dark' });
  vis(K, arcGeo(DR + 0.2, 0.3, 0, TAU), 'white_paint', DX, 3.6, DZ);
  for (const a of [0.75, 2.05, 2.75, 3.5, 4.25, 5.0, 5.65]) { vis(K, arcGeo(DR + 0.2, 1.3, a - 0.04, a + 0.04), 'glass_dark', DX, 2.0, DZ); vis(K, flipGeo(arcGeo(DR - 0.2, 1.3, a - 0.04, a + 0.04)), 'glass_dark', DX, 2.0, DZ); }
  vis(K, arcGeo(DOME + 0.3, 0.45, 0, TAU), 'concrete_dark', DX, DH + 0.225, DZ);
  vis(K, flipGeo(arcGeo(DR - 0.3, 0.45, 0, TAU)), 'concrete_dark', DX, DH + 0.225, DZ);
  vis(K, ringGeo(DR - 0.3, DOME + 0.3, 48), 'concrete_dark', DX, DH, DZ, { rx: Q });
  vis(K, ringGeo(DR - 0.3, DOME + 0.3, 48), 'concrete_dark', DX, DH + 0.45, DZ, { rx: -Q });
  twoSided(K, domeGeo(DOME), 'white_paint', DX, DH + 0.45, DZ);
  vis(K, stripGeo(DOME + 0.03, -0.6, 0.6, -0.28, PI / 2, 16), 'glass_dark', DX, DH + 0.45, DZ);
  for (const s of [-1, 1]) vis(K, stripGeo(DOME + 0.07, s * 0.62, s * 0.8, -0.32, PI / 2, 16), 'metal_dark', DX, DH + 0.45, DZ);
  for (let k = 1; k < 12; k++) if (k !== 6) vis(K, stripGeo(DOME + 0.04, -0.06, 0.06, 0.16, PI / 2, 10), 'metal', DX, DH + 0.45, DZ, { ry: k * TAU / 12 });
  rod(K, 'metal_dark', 0.05, [DX + 1.2, DH + 0.45 + Math.sqrt(DOME * DOME - 1.44) - 0.1, DZ + 0.4], [DX + 1.2, DH + 0.45 + DOME + 1.3, DZ + 0.4], 5);
  // portico + steps on the south door
  for (const s of [-1, 1]) K.cyl(DX + s * 2.2, 3.7, 0.28, 3.3, 'white_paint', { seg: 12 });
  K.box(DX, 2.75, 5.2, 3.6, 0.3, 'concrete_dark', { y: 3.3, collide: false });
  K.box(DX, 4.5, 5.2, 0.12, 0.45, 'white_paint', { y: 3.6, collide: false }); K.box(DX, 4.58, 3.2, 0.05, 0.32, 'blue_paint', { y: 3.66, collide: false });
  K.ground(DX, 5.3, 6, 1.4, 'concrete', { y: 0.05 }); K.ground(DX, 2.9, 4.2, 3.4, 'tile', { y: 0.045 });
  // ---- telescope on its pier, fork mount, tube aimed at the slit (north)
  K.cyl(DX, DZ - 1.2, 0.85, 1.5, 'concrete', { seg: 14 });
  K.box(DX, DZ - 1.2, 1.3, 1.3, 0.3, 'metal_dark', { y: 1.5, collide: false });
  for (const s of [-1, 1]) K.box(DX + s * 0.78, DZ - 1.2, 0.22, 0.8, 1.9, 'blue_paint', { y: 1.8, collide: false });
  const piv = [DX, 3.35, DZ - 1.2], AX = [0, Math.cos(0.8), -Math.sin(0.8)];
  const TP = k => [piv[0] + AX[0] * k, piv[1] + AX[1] * k, piv[2] + AX[2] * k];
  rod(K, 'white_paint', 0.5, TP(-2.3), TP(3.7), 16);
  rod(K, 'metal_dark', 0.56, TP(3.2), TP(3.85), 16); rod(K, 'metal_dark', 0.55, TP(-2.4), TP(-1.9), 16); rod(K, 'metal_dark', 0.53, TP(-0.35), TP(0.35), 16);
  rod(K, 'metal_dark', 0.08, TP(-2.4), TP(-2.75), 8);
  rod(K, 'metal', 0.11, [DX + 0.62, TP(0.2)[1] + 0.05, TP(0.2)[2]], [DX + 0.62, TP(1.8)[1] + 0.05, TP(1.8)[2]], 8);
  rod(K, 'metal', 0.06, [DX - 0.9, 3.35, DZ - 1.2], [DX + 0.9, 3.35, DZ - 1.2], 8);
  K.box(DX + 1.35, DZ + 0.4, 0.9, 0.7, 0.45, 'metal'); // step stool to the eyepiece
  // instruments, desks, red working light
  K.prop('desk', DX - 4.4, DZ + 3.4, 0); K.prop('desk', DX + 4.6, DZ + 3.4, 0);
  K.box(DX - 5.0, DZ - 1.8, 0.8, 2.2, 1.0, 'metal_dark'); K.box(DX - 4.58, DZ - 1.8, 0.04, 1.8, 0.45, 'glass', { y: 1.0, collide: false });
  K.prop('shelf', DX + 2.6, DZ - 4.4, 0);
  K.container('crate', DX - 4.6, DZ + 1.6); K.container('ammobox', DX + 3.6, DZ - 3.0); K.container('toolbox', DX - 3.2, DZ - 4.3);
  K.light(DX, DZ, 6.2, '#e8f0ff', 1.2, 14); K.light(DX - 4.6, DZ - 1.8, 1.7, '#ff6a50', 0.6, 6);
  // maintenance scaffold + clutter behind the dome
  K.prop('scaffold', DX, DZ - 8.45, 0);
  K.prop('pallets', 2.0, -14.2, 0); K.prop('cable_spool', -10.5, -15.0, 0); dcrate(K, 4.0, -13.6, 0.9); dcrate(K, 4.0, -13.6, 0.7, 'plank_dark', 0.9);
  K.container('barrel', -12.2, -13.0);
  // ---- corridor from the drum to the office wing
  K.wall(3.0, -7.35, 8.0, -7.35, 3.0, 'concrete'); K.wall(3.0, -4.65, 8.0, -4.65, 3.0, 'concrete');
  K.box(5.65, -6, 5.1, 3.3, 0.25, 'concrete_dark', { y: 3.0, collide: false });
  K.ground(5.5, -6, 5.0, 2.4, 'tile', { y: 0.06, t: 0.12 });
  shelter(K, DX, DZ, 9.6, 9.6); shelter(K, 5.6, -6, 5.0, 2.4); // rain stays outside the round hall + corridor
  // ---- office wing + green vault (needs power from the shed)
  room(K, { x: 15, z: -6, w: 14, d: 10, h: 3.4, wall: 'concrete', roof: 'concrete_dark', trim: 'white_paint', floor: 'tile', roofProps: false,
    doors: [{ side: 'w', w: 1.8 }, { side: 's', at: -3, w: 1.6 }], windows: [{ side: 'n', at: -4, w: 1.6 }, { side: 'n', at: 0, w: 1.4 }, { side: 's', at: -6, w: 1.2 }, { side: 's', at: 0.5, w: 1.4 }] });
  room(K, { x: 19.2, z: -6, w: 5.0, d: 9.4, h: 3.0, wall: 'concrete_dark', roof: 'concrete_dark', floor: false, roofProps: false, doors: [{ side: 'w', type: 'vault', card: 'green', fuse: true }] });
  K.ground(19.2, -6, 4.7, 9.1, 'metal_dark', { y: 0.075, t: 0.02 });
  K.box(18.3, -2.0, 2.2, 0.5, 1.8, 'metal_dark');
  K.container('military', 20.6, -9.6); K.container('military', 20.6, -2.4); K.container('elite', 21.0, -6.0, Q); K.container('ammobox', 17.6, -10.0);
  K.light(19.2, -6, 2.6, '#a0ffb0', 0.8, 7);
  K.prop('desk', 10.2, -10.4, 0); K.prop('desk', 13.6, -10.4, 0); K.prop('table', 12.4, -8.2, 0);
  K.box(16.0, -10.3, 0.6, 0.5, 1.3, 'metal'); K.box(16.0, -9.7, 0.6, 0.5, 1.3, 'metal');
  K.container('locker', 8.55, -9.8); K.container('locker', 8.55, -2.3); K.container('medbox', 15.9, -1.75); K.container('crate', 9.9, -1.8);
  K.light(12.4, -6, 3.1, '#fff0d0', 1.0, 10);
  rod(K, 'metal_dark', 0.04, [20.5, 3.7, -9.6], [20.5, 8.0, -9.6], 5); rod(K, 'metal_dark', 0.03, [21.1, 3.7, -9.9], [21.1, 6.2, -9.9], 5);
  // small second dome on the office roof
  vis(K, arcGeo(1.9, 1.1, 0, TAU), 'white_paint', 11.5, 3.7 + 0.55, -6.2);
  vis(K, arcGeo(1.92, 0.18, 0, TAU), 'blue_paint', 11.5, 4.7, -6.2);
  vis(K, domeGeo(2.0, 20, 7), 'metal', 11.5, 4.8, -6.2);
  vis(K, stripGeo(2.03, -0.22, 0.22, -0.3, PI / 2, 8), 'glass_dark', 11.5, 4.8, -6.2, { ry: 2.4 });
  K.box(14.6, -2.2, 0.7, 0.7, 1.0, 'metal', { y: 3.7, collide: false });
  // ---- generator shed with the fuse box
  room(K, { x: 16, z: 10, w: 6, d: 5, wall: 'brick', roof: 'corrugated', trim: 'concrete_dark', floor: 'concrete_dark',
    doors: [{ side: 'w', w: 1.6 }], windows: [{ side: 's', w: 1.2 }, { side: 'n', at: 1.5, w: 1.0 }] });
  K.fusebox(18.55, 9.0, PI);
  K.prop('generator', 16.4, 11.6, 0);
  K.container('toolbox', 14.0, 8.05); K.container('barrel_oil', 18.4, 11.75);
  K.light(16, 10, 2.8, '#ffe0b0', 0.8, 7);
  K.prop('transformer', 20.6, 8.6, 0); K.prop('transformer', 20.6, 11.0, 0); K.prop('cable_spool', 21.2, 14.6, 0);
  // ---- plaza: ringed-planet sculpture in a round planter, sandbag nests either side of the path, lamps, floodlight
  K.cyl(DX, 10.5, 1.7, 0.5, 'stone', { seg: 18, opaque: false }); K.cyl(DX, 10.5, 1.5, 0.04, 'dirt', { y: 0.5, collide: false, seg: 18 });
  K.cyl(DX, 10.5, 0.3, 1.7, 'concrete', { y: 0.5, collide: false, seg: 10 });
  vis(K, M.sphere(0.8, 16, 12), 'yellow_paint', DX, 3.0, 10.5);
  vis(K, new THREE.TorusGeometry(1.3, 0.08, 4, 28), 'white_paint', DX, 3.0, 10.5, { rx: Q + 0.38, ry: 0.5, s: [1, 1, 0.35] });
  for (const [x, z] of [[DX - 1.05, 10.0], [DX + 1.0, 11.1], [DX + 0.2, 9.4]]) vis(K, M.ico(0.38, 1), 'tarp_green', x, 0.72, z, { s: [1, 0.75, 1] });
  sandbagU(K, -10, 9, 's'); sandbagU(K, 2, 9, 's');
  K.container('ammobox', 2, 8.7, Q);
  for (const x of [-11, 3]) K.prop('barrier', x, 21.2, 0);
  lamp(K, -6.8, 12.5, 0); lamp(K, -1.2, 18.0, PI);
  flood(K, 7.2, 1.0, 0, 14);
  // ---- parking: tour bus, car, bandit truck
  K.prop('bus', -8.5, 28.2, 0); K.prop('car', 2.8, 27.5, Q); K.prop('truck', 11, 20, 0);
  K.container('barrel', 6.5, 24.2); K.container('barrel', 6.9, 25.1); K.container('crate', 8.4, 17.6); K.container('barrel_oil', 15.6, 19.4);
  lamp(K, -14.2, 23.4, 0);
  // ---- bandit camp on the west lawn
  K.prop('tent', -19, 12.5, 0); K.prop('tent', -22.5, 8.0, 0);
  fire(K, -17.2, 7.4); K.box(-17.2, 5.9, 1.6, 0.4, 0.4, 'log'); K.box(-18.8, 7.4, 0.4, 1.5, 0.4, 'log');
  K.container('food', -18.9, 5.6); K.container('crate', -21.2, 14.4); K.container('military', -24.6, 12.0, Q);
  // ---- viewing terrace (west) and the radio-telescope dish (north-west)
  K.wall(-27, -7, -27, 7, 0.9, 'stone', { thick: 0.5 });
  coinScope(K, -25.6, -3, PI); coinScope(K, -25.6, 3, PI);
  K.prop('bench', -23.0, -5.8, Q); K.prop('bench', -23.0, 5.8, Q);
  K.ground(-20, -20, 7, 7, 'concrete', { y: 0.035 }); K.prop('dish', -20, -20, 0.6);
  // ---- edges: rocks + trees
  K.prop('rock_big', 27, -8, 0); K.prop('rock_big', -24, 21, 0); K.prop('rock_big', 14, -24, 0);
  for (const [k, x, z, s] of [['pine', -30, -12, 1], ['pine', -29, 16, 1], ['pine', 26, -20, 1], ['pine', 29, 14, 0.95], ['pine', 8, -28, 1], ['pine', -12, -29, 1], ['pine', 20, 25, 1],
    ['bush', 25, 3, 1], ['bush', -14, -21, 1], ['bush', 12, 29, 0.9], ['birch', -30, 4, 1], ['rock_small', 22, -12, 1.2], ['rock_small', -27, -18, 1.1]]) K.veg(k, x, z, s);
  // ---- bandits + scavs
  K.npc('bandit', -14, 6.5, { patrol: [[-14, 6.5], [7, 6.5], [7, 17], [-14, 17]] });
  K.npc('bandit', 11, 1.5, { patrol: [[11, 1.5], [11, 13.5]] });
  K.npc('bandit', DX + 3.0, DZ + 2.0, {});
  K.npc('bandit', 13.0, -3.6, {});
  K.npc('scav', -15.8, 9.4, {});
  K.npc('scav', -14, -16.5, { patrol: [[-14, -16.5], [8, -16.5]] });
}

export const EXTRA_LAYOUTS = { fishvillage, observatory };

export const EXTRA_MONUMENTS = {
  fishvillage: { name: 'Saltmarsh Village', tier: 0, count: 1, size: 30, coast: true, safe: true, desc: 'Fishing village on the shore. No fighting. Bait & Tackle vendor and a long jetty to fish from.' },
  observatory: { name: 'Observatory', tier: 2, count: 1, size: 36, card: 'green', desc: 'Domed observatory held by bandits. Power the green vault from the generator shed.' },
};

// vendor stock [itemId, count, price in scrap], same rates as SHOPS.general where items overlap.
// `buy` [itemId, scrap each] is optional data for selling catch to the fisher (half the item value, like
// "sell valuables"); the shop UI only sells cat 'val' items today, so it needs a hook to use it.
export const EXTRA_SHOPS = {
  fisher: {
    name: 'Bait & Tackle',
    stock: [['fishing_rod', 1, 20], ['bait', 10, 6], ['cooked_fish', 2, 12], ['rope', 1, 14], ['cloth', 30, 12], ['water_bottle', 1, 10], ['bandage', 3, 8], ['low_fuel', 10, 8], ['knife', 1, 12], ['torch', 1, 5]],
    buy: [['fish_golden', 90], ['fish_tuna', 8], ['fish_salmon', 4], ['fish_mackerel', 2], ['fish_trout', 2], ['fish_perch', 1]],
  },
};

export const EXTRA_LOOT = {};
