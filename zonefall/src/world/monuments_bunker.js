// ============================================================================
// ZONEFALL — the Nuclear Bunker (tier 5, unique): a missile silo complex dug
// into a hill inside a fenced, guarded compound. Local metres, origin = the site
// centre, +X east / +Z south (the kit turns local +Z to face the road: gen.js),
// the gate is at x = 0 on the south fence.
//
//   The hill: a concrete facade (z = 10) with the blast-door portal, a flat top
//   (5.6 m) over the bunker you can walk up onto from the west and north banks
//   (walkable ramps), a concrete retaining wall on the east side.
//   Inside (all at pad level under a 3.6 m ceiling):
//     E  entry hall            x -11..5,  z -4..10   (portal in the facade)
//     G  guard office          x -21..-11, z -4..10   (terminal)
//     B  barracks              x -33..-21, z -4..10   (terminal)
//     R  generator hall        x -33..-11, z -18..-4
//     K  armoury               x 5..15,   z -4..10   (red keycard: elite loot, the launch fuse, a terminal)
//     P  launch control        x -11..5,  z -18..-4   (fuse box, four arming keys, the authorise button)
//     V  vault                 x -8..2,   z -26..-18 (puzzle door: the controller's pedestal, vault crates)
//     C  silo corridor         x 5..16,   z -12..-8
//     S  the silo (round, centre 23.4, -10): the missile on its stand, a ladder up to a catwalk (terminal,
//        elite crate), the hatch on top (bunker.js animates hatch, missile, levers, lamps and screens)
//   Height rules as in monuments_tall.js / monuments_sea.js: walkable decks are K.floor slabs, banks are K.stairs
//   ramps (drawn as earth here), a box raised 1.75 m or more only blocks people at its height.
// ============================================================================
import { THREE, M } from '../gfx/materials.js';

const PI = Math.PI, Q = PI / 2;
const TOP = 5.6, CEIL = 3.6, SLAB = 4.0, RUN = 8;          // the hill's flat top, the ceiling, the slab over it, the banks' run
const X0 = -33, X1 = 15, Z0 = -26, Z1 = 10;                // the bunker under the hill (Z1 = the facade)
export const BUNKER = { SX: 23.4, SZ: -10, RIN: 7, ROUT: 7.8, SH: 11.5, CW: 5.0, TOP };
const { SX, SZ, RIN, ROUT, SH, CW } = BUNKER;

// ---------------------------------------------------------------- helpers
const statics = K => (K.group.children[0] && K.group.children[0].isGroup ? K.group.children[0] : K.group);
/** invisible collider */
function block(K, x, z, w, d, h, y = 0) { const m = K.box(x, z, w, d, h, 'concrete', { y, cast: false }); if (m && m.parent) m.parent.remove(m); }
/** visual-only box */
const vbox = (K, x, z, w, d, h, surf, y = 0, cast = false) => K.box(x, z, w, d, h, surf, { y, collide: false, cast });
/** cut [from, to] by gaps [[a, b], ...] -> the solid runs */
function runs(from, to, gaps = []) {
  const out = []; let cur = from;
  for (const [a, b] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (a > cur) out.push([cur, Math.min(a, to)]); cur = Math.max(cur, b); }
  if (to > cur) out.push([cur, to]); return out.filter(([a, b]) => b - a > 0.05);
}
/** a wall along `axis` at the fixed other coordinate, from..to, h tall, with door gaps [[a, b, top]] (lintel over them) */
function wall(K, axis, fixed, from, to, h, surf, gaps = [], t = 0.4) {
  for (const [a, b] of runs(from, to, gaps)) { const mid = (a + b) / 2, len = b - a; if (axis === 'x') K.box(mid, fixed, len, t, h, surf); else K.box(fixed, mid, t, len, h, surf); }
  for (const [a, b, top = 2.6] of gaps) { const mid = (a + b) / 2; if (h - top > 0.05) { if (axis === 'x') K.box(mid, fixed, b - a, t, h - top, surf, { y: top, collide: false }); else K.box(fixed, mid, t, b - a, h - top, surf, { y: top, collide: false }); } }
}
/** a mesh in local coordinates (visual only): geometry built round local (x, y, z), turned by local yaw ry */
function lmesh(K, geo, mat, x, y, z, ry = 0, o = {}) {
  const [wx, wz] = K.toWorld(x, z);
  const m = M.add(statics(K), geo, mat, wx - K.mon.x, y, wz - K.mon.z, { cast: o.cast ?? false });
  m.rotation.order = 'YXZ'; m.rotation.set(o.rx || 0, K.wry(ry), o.rz || 0); return m;
}
/** an open tube (or a slice of one) with its texture at real scale; theta in three.js terms (0 = +Z, clockwise from above) */
function tube(r, h, seg, t0 = 0, tl = PI * 2, rb = r) {
  const g = new THREE.CylinderGeometry(r, rb, h, seg, 1, true, t0, tl), uv = g.attributes.uv, circ = r * tl;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ / 2, uv.getY(i) * h / 2);
  return g;
}
/** world-frame theta (three.js cylinder convention) of a LOCAL direction (dx, dz) */
function wtheta(K, dx, dz) { const [ax, az] = K.toWorld(0, 0), [bx, bz] = K.toWorld(dx, dz); return Math.atan2(bx - ax, bz - az); }
/** the hill's surface height at local (x, z): flat top over the bunker, banks to the west and north, cut at the facade and east wall */
export function hillY(x, z) {
  if (x > X1 + 0.01 || z > Z1 + 0.01 || x < X0 - RUN || z < Z0 - RUN) return 0;
  return Math.max(0, Math.min(TOP, (x - (X0 - RUN)) / RUN * TOP, (z - (Z0 - RUN)) / RUN * TOP));
}
/** the earth over the bunker: a height field matching the walkable banks exactly (vertex-coloured grass and dirt) */
function hill(K) {
  const R = K.R, step = 2, nx = Math.round((X1 - (X0 - RUN)) / step), nz = Math.round((Z1 - (Z0 - RUN)) / step);
  const pos = [], col = [], uv = [], ox = X0 - RUN, oz = Z0 - RUN;
  const cA = new THREE.Color('#7f9a4a'), cB = new THREE.Color('#6a8640'), cD = new THREE.Color('#8a7452'), tmp = new THREE.Color();
  const vcol = (x, z) => { const k = 0.5 + 0.5 * Math.sin(x * 0.37 + z * 0.21) * Math.cos(x * 0.13 - z * 0.41); tmp.copy(cA).lerp(cB, k); const y = hillY(x, z); if (y < TOP - 0.05 && y > 0.05) tmp.lerp(cD, 0.25 + 0.2 * Math.sin(x * 0.9 + z)); return tmp; };
  const P = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = ox + i * step, z = oz + j * step; const [wx, wz] = K.toWorld(x, z); P.push([wx - K.mon.x, hillY(x, z) + (hillY(x, z) >= TOP - 0.01 && i > 0 && j > 0 && i < nx && j < nz ? (R() - 0.5) * 0.06 : 0) + 0.02, wz - K.mon.z, x, z]); }
  const v = (i, j) => P[j * (nx + 1) + i];
  const tri = (a, b, c) => {
    const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2];
    if (ux * wz - uz * wx > 0) { const t = b; b = c; c = t; } // facing up whatever the mirror did
    for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); const cc = vcol(p[3], p[4]); col.push(cc.r, cc.g, cc.b); uv.push(p[3] / 3, p[4] / 3); }
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
    if (a[1] < 0.03 && b[1] < 0.03 && c[1] < 0.03 && d[1] < 0.03) continue; // the toe: on the ground
    // split along the diagonal that follows the banks (the NW corner is a hip)
    if (a[3] - ox >= a[4] - oz) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  M.add(statics(K), g, M.mat('#ffffff', { vc: true, tex: 'grass' }), 0, 0, 0, { cast: true });
  // the walkable top and banks (nothing drawn: the earth above is the look of them)
  K.floor((X0 + X1) / 2, (Z0 + Z1) / 2, X1 - X0, Z1 - Z0, TOP, 'grass', { visual: false });
  K.stairs(X0 - RUN / 2, (Z0 + Z1) / 2, Z1 - Z0, RUN, 0, TOP, '+x', 'grass', { visual: false });
  K.stairs((X0 + X1) / 2, Z0 - RUN / 2, X1 - X0, RUN, 0, TOP, '+z', 'grass', { visual: false });
  block(K, X0 - RUN / 2, Z0 - RUN / 2, RUN, RUN, TOP + 1); // the hip at the NW corner: too steep
  // rocks, bushes and vents up on top
  for (const [x, z, s] of [[-38, -6, 1], [-36.5, 4, 0.8], [-20, -31, 0.9], [6, -30.5, 1.1], [-30, -30, 0.7]]) { const y = hillY(x, z); lmesh(K, M.ico(1.1 * s, 0), M.surf('rock', { flat: true }), x, y + 0.3 * s, z, R() * 6, { rz: R() * 0.4 }).scale.set(1.3, 0.7, 1); }
  for (const [x, z] of [[-24, -14], [-8, -22], [9, 0], [-14, 4]]) { // ventilation stacks, mushroom caps
    K.box(x, z, 1.3, 1.3, 1.6, 'concrete_dark', { y: TOP });
    vbox(K, x, z, 1.9, 1.9, 0.25, 'metal_dark', TOP + 1.75); vbox(K, x, z, 1.0, 1.0, 0.2, 'metal', TOP + 1.6);
  }
  K.box(-27, 2, 2.4, 1.6, 1.0, 'metal_dark', { y: TOP }); vbox(K, -27, 2, 2.2, 1.4, 0.06, '#2a2c30', TOP + 1.0); // an air intake grille
  crown(K, -11, -9, 13, 9, 2.6);
  K.prop('antenna', -11, -9, 0, { y: TOP + 2.5, collide: false });
  for (const [x, z, s] of [[-2, -20, 1], [-24, 4, 0.9], [8, -22, 1.2], [-30, -18, 0.8], [11, 6, 1], [-36, -2, 0.7], [-16, 7.5, 0.8]]) { const y = hillY(x, z); for (let k = 0; k < 3; k++) lmesh(K, M.ico(0.7 * s, 0), M.mat(k ? '#4f7a34' : '#5f8a3a', { flat: true }), x + (R() - 0.5) * 1.6 * s, y + 0.4 * s, z + (R() - 0.5) * 1.6 * s, R() * 6).scale.set(1.2, 0.8, 1.1); } // bushes
}
/** a concrete wall of 1 m columns along `axis` at `fixed`, from..to, whose top follows the hill's surface ground(u): it
 *  stands COPE above it (a coping you see from below) and an invisible rail keeps people up on the hill from walking off */
const COPE = 0.45;
function stepWall(K, axis, fixed, from, to, ground, gaps = [], t = 0.6, surf = 'concrete') {
  for (const [a, b] of runs(from, to, gaps)) {
    for (let u = a; u < b - 0.01; u += 1) {
      const e = Math.min(b, u + 1), m = (u + e) / 2, g = ground(m), h = g + COPE;
      if (axis === 'x') { K.box(m, fixed, e - u, t, h, surf); block(K, m, fixed, e - u, t, 1.1 - COPE, h); }
      else { K.box(fixed, m, t, e - u, h, surf); block(K, fixed, m, t, e - u, 1.1 - COPE, h); }
    }
  }
}
/** a grassy lip of earth rolling over the top of a retaining wall (seen from below), along `axis` from..to */
function lip(K, axis, fixed, from, to, ground, inset) {
  const mat = M.mat('#ffffff', { vc: true, tex: 'grass' }), col = new THREE.Color('#77923f');
  for (let u = from; u < to - 0.01; u += 2) {
    const e = Math.min(to, u + 2), m = (u + e) / 2, g = (ground(u) + ground(e)) / 2; if (g < 0.4) continue;
    const geo = M.cyl(0.75, 0.75, e - u + 0.05, 7).clone(); const c = new Float32Array(geo.attributes.position.count * 3); for (let i = 0; i < c.length; i += 3) { c[i] = col.r; c[i + 1] = col.g; c[i + 2] = col.b; } geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const x = axis === 'x' ? m : fixed + inset, z = axis === 'x' ? fixed + inset : m;
    lmesh(K, geo, mat, x, g + 0.08, z, axis === 'x' ? 0 : Q, { rz: Math.PI / 2 });
  }
}
/** the crown of the hill: a grassy hump on the flat top (people up there walk round it) */
function crown(K, cx, cz, rx, rz, h) {
  const n = 14, pos = [], uv = [], col = [], c0 = new THREE.Color('#7a9644'), c1 = new THREE.Color('#5f7c38'), tmp = new THREE.Color();
  const P = (i, j) => { const u = i / n * 2 - 1, v = j / n * 2 - 1, d = Math.min(1, Math.hypot(u, v)), y = h * (0.5 + 0.5 * Math.cos(Math.PI * d)); const x = cx + u * rx, z = cz + v * rz; const [wx, wz] = K.toWorld(x, z); return [wx - K.mon.x, TOP + y - 0.05, wz - K.mon.z, x, z, y / h]; };
  const tri = (a, b, c) => { const ux = b[0] - a[0], uz = b[2] - a[2], wx = c[0] - a[0], wz = c[2] - a[2]; if (ux * wz - uz * wx > 0) { const t = b; b = c; c = t; } for (const p of [a, b, c]) { pos.push(p[0], p[1], p[2]); uv.push(p[3] / 3, p[4] / 3); tmp.copy(c1).lerp(c0, p[5]); col.push(tmp.r, tmp.g, tmp.b); } };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1); if (a[5] + b[5] + c[5] + d[5] < 0.01) continue; tri(a, b, c); tri(a, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  M.add(statics(K), g, M.mat('#ffffff', { vc: true, tex: 'grass' }), 0, 0, 0, { cast: true });
  block(K, cx, cz, rx * 1.3, rz * 1.3, h + 0.5, TOP); // where it's more than ~0.3 m high
}

// ============================================================================
function bunker(K) {
  K.label('Nuclear Bunker');
  const B = K.mon.bunker = { W: K.toWorld, wry: K.wry, baseY: K.baseY, clues: [], spots: [], beacons: [], screens: [] };
  const use = (type, x, z, extra = {}) => K.use(type, x, z, extra);
  // ---------------------------------------------------------------- ground + compound
  K.ground(0, 0, 92, 92, 'gravel', { y: 0.02 });
  K.ground(-2, 29, 10, 36, 'asphalt', { y: 0.035 });                 // the drive from the gate to the portal
  K.ground(-3, 14, 16, 8, 'concrete_dark', { y: 0.04 });             // the apron in front of the portal
  K.ground(31, 22, 26, 30, 'concrete', { y: 0.03 });                 // the east yard
  for (let z = 18; z < 46; z += 6) K.ground(-2, z, 0.25, 3, 'yellow_paint', { y: 0.05, t: 0.02 });
  // perimeter: a chain-link fence with a gate on the road (south) and a cut breach on the west side
  const F = 46;
  const fence = (x0, z0, x1, z1, gaps = []) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0), a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
    for (const [s, e] of runs(a0, a1, gaps)) { if (alongX) K.fence(s, c, e, c, 2.6, { wire: false }); else K.fence(c, s, c, e, 2.6, { wire: false });
      const m = (s + e) / 2; for (const yy of [2.62, 2.82]) { if (alongX) vbox(K, m, c, e - s, 0.05, 0.05, 'metal_dark', yy); else vbox(K, c, m, 0.05, e - s, 0.05, 'metal_dark', yy); } }
  };
  fence(-F, F, F, F, [[-5, 5]]); fence(-F, -F, F, -F); fence(F, -F, F, F); fence(-F, -F, -F, F, [[19, 22.5]]);
  for (const s of [-1, 1]) { K.box(s * 5.6, F, 1.0, 1.0, 3.4, 'concrete_dark'); vbox(K, s * 5.6, F - 0.52, 1.0, 0.05, 0.5, 'hazard', 2.4); }
  vbox(K, 0, F, 12.2, 0.7, 0.6, 'concrete_dark', 3.4); vbox(K, 0, F + 0.36, 6, 0.05, 0.4, 'red_paint', 3.5);
  K.prop('barrier', -2.6, F - 2.2, 0); K.prop('barrier', 2.8, F - 5.5, 0); K.prop('barrier', -2.8, F - 9, 0);
  // the breach: a fence panel pushed in, sandbags
  lmesh(K, M.box(0.1, 2.4, 3.4), M.mat('#9aa3a8', { tex: 'metal', transparent: true, opacity: 0.5 }), -F + 1.4, 0.5, 20.75, 0, { rz: 1.2 });
  bags(K, -F + 3.5, 17.4, 0.9, 2.0); bags(K, -F + 3.5, 24.2, 0.9, 2.0);
  // the guard booth at the gate
  K.room({ x: 10, z: 41.5, w: 4.4, d: 3.4, h: 2.7, wall: 'concrete', roof: 'concrete_dark', trim: 'hazard', floor: 'concrete_dark', doors: [{ side: 'n', w: 1.2 }], windows: [{ side: 'w', w: 1.6 }, { side: 's', w: 1.6 }], roofProps: false });
  K.prop('desk', 10.6, 42.4, 0); K.container('ammobox', 11.4, 40.6, 0);
  // watchtowers (stairs up), floodlights, lamps along the drive
  const tower = (x, z, prefer) => { K.prop('watchtower', x, z, prefer); K.floor(x, z, 3.0, 3.0, 3.92, 'plank', { visual: false });
    const ux = Math.round(Math.cos(prefer)), uz = Math.round(Math.sin(prefer)), LEN = 5.6, cx = x + ux * (1.5 + LEN / 2), cz = z + uz * (1.5 + LEN / 2);
    K.stairs(cx, cz, 1.2, LEN, 0, 3.92, ux > 0 ? '-x' : ux < 0 ? '+x' : uz > 0 ? '-z' : '+z', 'plank_dark', { side: 'log' });
    for (const l of [-1, 1]) block(K, cx - uz * l * 0.65, cz + ux * l * 0.65, ux ? LEN : 0.12, ux ? 0.12 : LEN, 4.92);
    for (let e = 0; e < 4; e++) { const ex = Math.round(Math.cos(e * Q)), ez = Math.round(Math.sin(e * Q)), px = x + ex * 1.55, pz = z + ez * 1.55;
      if (ex === ux && ez === uz) { for (const l of [-1, 1]) block(K, px - ez * l * 1.15, pz + ex * l * 1.15, ex ? 0.12 : 0.8, ex ? 0.8 : 0.12, 1.0, 3.92); }
      else block(K, px, pz, ex ? 0.12 : 3.2, ex ? 3.2 : 0.12, 1.0, 3.92); }
    K.light(x, z, 5.2, '#fff4dc', 1.2, 18);
  };
  tower(-41.5, 41.5, -Q); tower(41.5, 41.5, -Q); tower(41.5, -41.5, Q);
  K.deployModel('floodlight', -12.5, 12.6, Q); K.light(-12.5, 12.6, 2.4, '#fff2d8', 1.4, 16);
  K.deployModel('floodlight', 6.5, 12.6, Q); K.light(6.5, 12.6, 2.4, '#fff2d8', 1.4, 16);
  for (const [x, z, r] of [[-8, 24, 0], [4, 34, PI], [-8, 40, 0], [26, 6, PI]]) K.prop('lamp', x, z, r);
  // sandbag nests either side of the drive
  for (const [x, z] of [[-13, 19], [9, 19]]) { bags(K, x, z - 1.4, 2.0, 0.9); bags(K, x - 1.4, z - 0.6, 0.9, 2.0); bags(K, x + 1.4, z - 0.6, 0.9, 2.0); }
  K.container('ammobox', -13, 19.6, 0); K.container('military', 9, 19.8, 0);
  // the helipad (west yard)
  K.cyl(-29, 31, 6.5, 0.12, 'concrete_dark', { collide: false, seg: 28 });
  for (const s of [-1, 1]) { vbox(K, -29 + s * 1.6, 31, 0.6, 4.0, 0.02, 'white_paint', 0.13); }
  vbox(K, -29, 31, 3.2, 0.6, 0.02, 'white_paint', 0.13);
  for (let k = 0; k < 8; k++) { const a = k / 8 * PI * 2; vbox(K, -29 + Math.cos(a) * 6.2, 31 + Math.sin(a) * 6.2, 0.25, 0.25, 0.18, '#e8a030', 0.1); }
  K.prop('heli_wreck', -30, 18, 0.3); K.container('military', -24.2, 19.8, 0);
  // motor pool + fuel depot (east yard)
  K.prop('truck', 26, 30, Q); K.prop('truck', 32.5, 30, Q); K.prop('car', 38.5, 30.5, Q + 0.1);
  K.box(32, 30, 18, 6, 0.15, 'corrugated', { y: 3.6, collide: false }); for (const x of [23.5, 32, 40.5]) for (const s of [-1, 1]) K.cyl(x, 30 + s * 2.8, 0.12, 3.6, 'metal_dark', { seg: 6 });
  K.container('toolbox', 23.4, 34.4, 0); K.container('crate', 29.6, 34.4, 0); K.container('barrel', 41.6, 34.6);
  K.prop('tank_v', 37, 14, 0); K.prop('tank_v', 37, 6.5, 0); K.prop('pipes', 31.5, 10.2, Q); K.prop('generator', 30.5, 16, 0);
  K.container('barrel_oil', 33, 18.4); K.container('barrel_oil', 34, 18.6); K.container('barrel', 41, 18);
  // containers, a radar dish behind the hill
  K.prop('container', 20, 41, 0, { color: '#5a7048' }); K.prop('container', 20, 41, 0, { y: 2.6, collide: false, color: '#3e6a8e' }); K.prop('container', 28, 41.5, 0.08, { color: '#6a6a70' });
  K.container('crate', 24, 38.6, 0); K.container('barrel', 15.6, 39);
  K.prop('dish', 33, -33, 0); K.prop('transformer', 26.5, -36, 0); K.prop('transformer', 29, -36, 0); K.container('crate', 38, -38, 0);
  K.prop('cable_spool', 22, -28, 0); K.prop('drums', 18.4, -20.5, 0);
  // warning signs
  for (const [x, z] of [[-7.5, 43.5], [7.5, 43.5], [-15, 11]]) { K.prop('streetsign', x, z, 0); }

  // ---------------------------------------------------------------- the hill, the facade and the east wall
  hill(K);
  // facade (z = Z1): full height over the bunker, stepping down the west bank; the portal is the gap
  const fGround = x => Math.max(0.4, hillY(x, Z1 - 0.4)), eGround = z => Math.max(0.4, hillY(X1 - 0.4, z));
  stepWall(K, 'x', Z1, X0 - RUN, X1 + 0.3, fGround, [[-5, -1]]);
  K.box(-3, Z1, 4, 0.6, TOP + COPE - 3.4, 'concrete', { y: 3.4, collide: false }); block(K, -3, Z1, 4, 0.6, 1.1 - COPE, TOP + COPE); // over the portal
  lip(K, 'x', Z1, X0 - RUN, X1, fGround, -0.5); lip(K, 'z', X1, Z0 - RUN, Z1, eGround, -0.5);
  // the facade's face: joints, a grime band, two sealed side doors, a pipe run, rust streaks, cameras
  for (let x = X0 - 1; x <= X1 - 1; x += 4) if (x < -6 || x > 0) vbox(K, x, Z1 + 0.31, 0.1, 0.03, TOP - 0.2, '#6a6760', 0.1);
  vbox(K, (X0 - RUN + X1) / 2, Z1 + 0.31, X1 - X0 + RUN, 0.02, 0.6, '#77736a', 0.0);
  for (const x of [-22, 9]) { K.box(x, Z1 + 0.42, 2.8, 0.25, 3.0, 'concrete_dark'); vbox(K, x, Z1 + 0.56, 2.2, 0.05, 2.6, 'rust', 0.1); vbox(K, x, Z1 + 0.6, 2.2, 0.04, 0.22, 'hazard', 1.2); vbox(K, x + 0.7, Z1 + 0.62, 0.12, 0.08, 0.4, '#2a2c30', 1.3); }
  vbox(K, -14, Z1 + 0.55, 18, 0.3, 0.3, 'rust', 4.6); vbox(K, 12, Z1 + 0.55, 6, 0.3, 0.3, 'rust', 4.6); for (const x of [-22, -14, -6.5, 10, 14]) vbox(K, x, Z1 + 0.5, 0.2, 0.4, 0.5, 'metal_dark', 4.45);
  for (const [x, h] of [[-26, 2.2], [-17.5, 3.0], [-9.5, 1.6], [5, 2.4], [13.5, 1.8]]) vbox(K, x, Z1 + 0.315, 0.35, 0.02, h, '#5a4434', TOP - h - 0.3);
  for (const x of [-7, 1]) { vbox(K, x, Z1 + 0.6, 0.3, 0.5, 0.25, '#2a2c30', 4.9); vbox(K, x, Z1 + 0.85, 0.12, 0.08, 0.12, '#101010', 4.95); }
  for (const s of [-1, 1]) K.box(-3 + s * 2.65, Z1 + 0.9, 1.3, 1.2, 4.6, 'concrete_dark');            // portal pillars
  K.box(-3, Z1 + 0.9, 6.6, 1.2, 1.2, 'concrete_dark', { y: 3.4, collide: false });                     // lintel
  vbox(K, -3, Z1 + 1.52, 6.6, 0.05, 0.42, 'hazard', 3.7);
  vbox(K, -3, Z1 + 1.52, 3.2, 0.05, 0.7, 'red_paint', 4.8); vbox(K, -3, Z1 + 1.55, 2.8, 0.03, 0.36, 'white_paint', 4.97); // the sign over the door
  K.box(1.9, Z1 + 0.62, 3.6, 0.5, 3.4, 'metal_dark');                                                  // the blast door, rolled aside
  vbox(K, 1.9, Z1 + 0.88, 3.4, 0.03, 0.3, 'hazard', 1.4); vbox(K, 1.9, Z1 + 0.88, 3.4, 0.03, 0.3, 'hazard', 2.6);
  for (const x of [0.6, 1.9, 3.2]) vbox(K, x, Z1 + 0.9, 0.12, 0.08, 3.2, 'metal', 0.1);
  vbox(K, -3, Z1 + 0.4, 4.0, 0.3, 0.12, 'metal_dark', 0.05);                                           // the door's rail
  K.shelter(-5, Z1, -1, Z1 + 1.5, 3.4);
  // the east retaining wall (x = X1), stepping down the north bank; the silo corridor goes through it
  stepWall(K, 'z', X1, Z0 - RUN, Z1, eGround, [[-11.8, -8.2]]);
  K.box(X1, -10, 0.6, 3.6, TOP + COPE - CEIL, 'concrete', { y: CEIL, collide: false }); block(K, X1, -10, 0.6, 3.6, 1.1 - COPE, TOP + COPE);
  facade(K, fGround);
  for (const x of [-30, -18, 6, 12]) vbox(K, x, Z1 + 0.33, 2.4, 0.05, 0.25, 'hazard', 4.4);
  K.light(-3, Z1 + 2, 3.2, '#ffd890', 1.3, 14);

  // ---------------------------------------------------------------- the bunker shell
  wall(K, 'z', X0, Z0, Z1, SLAB, 'concrete', [], 0.6);                                                 // west
  wall(K, 'x', Z0, X0, X1, SLAB, 'concrete', [], 0.6);                                                 // north
  vbox(K, (X0 + X1) / 2, (Z0 + Z1) / 2, X1 - X0, Z1 - Z0, 0.4, 'concrete_dark', CEIL);                  // the ceiling
  K.floor((X0 + X1) / 2, (Z0 + Z1) / 2, X1 - X0, Z1 - Z0, SLAB, 'concrete', { visual: false });         // (grenades bounce off it)
  K.shelter(X0, Z0, X1, Z1, CEIL);
  // partitions (door gaps [a, b, lintel])
  wall(K, 'x', -4, X0, X1, CEIL, 'concrete', [[-29.6, -28.0], [-4.6, -1.4]]);                         // B|R, E|P
  wall(K, 'z', -21, -4, Z1, CEIL, 'concrete', [[5.0, 6.6]]);                                          // B|G
  wall(K, 'z', -11, -4, Z1, CEIL, 'concrete', [[0.2, 1.8]]);                                          // G|E
  wall(K, 'z', -11, Z0 + 8, -4, CEIL, 'concrete', [[-8.9, -7.1]]);                                     // R|P
  wall(K, 'x', -18, X0, 5, CEIL, 'concrete', [[-3.7, -2.3, 2.6]]);                                     // R/P | vault + void (the vault door)
  wall(K, 'z', 5, -4, Z1, CEIL, 'concrete', [[2.3, 3.7]]);                                             // E|K (the red door)
  wall(K, 'z', 5, -18, -4, CEIL, 'concrete', [[-11.6, -8.4]]);                                         // P|C
  wall(K, 'z', -8, Z0, -18, CEIL, 'concrete'); wall(K, 'z', 2, Z0, -18, CEIL, 'concrete');              // the vault's sides
  wall(K, 'x', -12, 5, X1 + 0.2, CEIL, 'concrete'); wall(K, 'x', -8, 5, X1 + 0.2, CEIL, 'concrete');    // the silo corridor
  vbox(K, X1 + 0.6, -10, 1.0, 4.6, 0.4, 'concrete', CEIL);                                             // over the step into the silo
  K.door(-3, -18, 'x', 'vault', { card: 'nuke', puzzle: true });
  K.door(5, 3, 'z', 'vault', { card: 'red' });
  // floors
  for (const [x0, z0, x1, z1, s] of [[-11, -4, 5, Z1, 'tile_dark'], [-21, -4, -11, Z1, 'tile'], [X0, -4, -21, Z1, 'tile'], [X0, -18, -11, -4, 'concrete_dark'], [-11, -18, 5, -4, 'tile_dark'], [-8, Z0, 2, -18, 'metal_dark'], [5, -4, X1, Z1, 'concrete_dark'], [5, -12, X1, -8, 'concrete_dark']])
    K.ground((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, s, { y: 0.06, t: 0.12 });
  const lamp = (x, z, c = '#e8f0ff', i = 0.9, r = 10) => { vbox(K, x, z, 1.4, 0.3, 0.08, '#fff4d0', CEIL - 0.1); K.light(x, z, CEIL - 0.3, c, i, r); };

  // ---- E: entry hall
  for (const x of [-5.3, -0.7]) { K.box(x, 6.4, 0.4, 0.4, 2.8, 'metal_dark'); } vbox(K, -3, 6.4, 5, 0.4, 0.3, 'metal_dark', 2.8); // the decon arch
  for (const x of [-4.4, -3, -1.6]) vbox(K, x, 6.4, 0.18, 0.18, 0.12, '#9ad0ff', 2.66);
  vbox(K, -3, 6.4, 4.2, 1.6, 0.03, '#3a3e44', 0.12);
  K.prop('counter', 2.6, 6.8, 0); K.prop('desk', -8.6, 7.6, 0); K.prop('bench', -9.8, -1.6, Q); K.prop('bench', 3.8, -1.2, Q);
  K.container('locker', -10.5, 4.0, Q); K.container('locker', -10.5, 4.9, Q); K.container('medbox', 4.4, 8.9, 0); K.container('ammobox', -9.8, 8.9, 0);
  vbox(K, -3, -3.75, 5, 0.06, 1.6, '#2a3a2e', 1.4); vbox(K, -3, -3.72, 4.6, 0.04, 1.2, '#4a7a52', 1.6); // a site map on the wall
  lamp(-3, 2); lamp(-3, -1.5); lamp(1.5, 6);
  K.npc('scientist', -6, 2, { patrol: [[-6, 2], [0, 2], [0, 8], [-6, 8]] }); K.npc('scientist', 1.5, -1.5, { guard: true });
  B.beacons.push([-3, Z1 + 1.6, 5.2]);
  // ---- G: guard office (terminal A)
  K.prop('desk', -19.4, 2.0, Q); K.prop('desk', -19.4, -1.6, Q); K.prop('shelf', -16, 9.2, 0); K.prop('table', -13.4, 5.2, 0);
  for (const [z, c] of [[2.0, '#3cff8a'], [-1.6, '#8ad0ff']]) { vbox(K, -20.4, z, 0.1, 1.4, 0.9, '#1a1d22', 1.0); vbox(K, -20.34, z, 0.04, 1.2, 0.7, c, 1.1); }
  B.clues[0] = use('bk_clue', -19.2, 2.0, { i: 0, title: 'Guard office terminal' });
  K.container('locker', -12, 9.0, 0); K.container('military', -20.2, 8.6, 0); K.container('ammobox', -12.2, -3.2, 0);
  lamp(-16, 3);
  K.npc('scientist', -15, 1, { patrol: [[-15, 1], [-15, 7]] });
  // ---- B: barracks (terminal B)
  for (const x of [-31, -28, -25]) { K.prop('bunkbed', x, 8.6, 0); K.prop('bunkbed', x, 3.6, 0); }
  K.prop('desk', -31.6, -2.2, Q); vbox(K, -32.5, -2.2, 0.1, 1.2, 0.8, '#1a1d22', 1.0); vbox(K, -32.44, -2.2, 0.04, 1.0, 0.6, '#ffb84a', 1.1);
  B.clues[1] = use('bk_clue', -31.4, -2.2, { i: 1, title: 'Duty officer\'s terminal' });
  K.container('locker', -22, 9.2, 0); K.container('locker', -23, 9.2, 0); K.container('food', -32.4, 6.0, Q); K.container('food', -22.2, -3.2, 0); K.container('medbox', -32.3, 1.2, Q);
  lamp(-27, 6); lamp(-27, -1);
  K.npc('scientist_heavy', -25, 1, { patrol: [[-30, 1], [-22.5, 1]] });
  B.spots.push([-27, 1], [-24, 6.2]);
  // ---- R: generator hall
  for (const x of [-29, -22]) { K.prop('generator', x, -15.6, 0); K.prop('transformer', x + 3, -15.8, 0); }
  K.prop('tank_h', -20, -6.6, 0); K.prop('pipes', -31, -10.5, Q); K.prop('pallets', -14, -15.8, 0); K.prop('workbench_old', -13.6, -5.2, 0);
  K.container('toolbox', -32.2, -5.2, Q); K.container('crate', -12, -12.4, 0); K.container('barrel', -32.2, -17.2); K.container('barrel', -31.3, -17.3); K.container('military', -14.5, -12.6, 0);
  K.prop('fusebox', -32.72, -12.8, 0, { collide: false, y: 1.0 }); // a dead one: the live one is in launch control
  ceilingPipes(K); lamp(-28, -11, '#fff0d0'); lamp(-17, -11, '#fff0d0');
  K.npc('scientist_heavy', -18, -10, { patrol: [[-18, -10], [-28, -10]] }); K.npc('scientist', -25, -12.6, { guard: true });
  B.spots.push([-20, -11], [-26, -9]);
  // ---- P: launch control
  // the console: four arming keys and the authorise button (bunker.js draws the levers, lamps and the button)
  K.box(-3, -13.2, 9.6, 0.9, 0.95, 'metal_dark');
  vbox(K, -3, -13.25, 9.6, 1.0, 0.06, '#2b2e33', 0.95); vbox(K, -3, -13.62, 9.6, 0.2, 0.5, '#1d2024', 0.95);
  const keys = [-6.6, -4.8, -1.2, 0.6];
  B.levers = keys.map((x, i) => { use('bk_sw', x, -12.4, { i }); return [x, -13.25, 1.01]; });
  B.button = [-3, -13.25, 1.01]; use('bk_auth', -3, -12.3);
  // the fuse box on the west wall, the status screen over the vault door, a status terminal
  K.prop('fusebox', -10.72, -14.6, 0, { collide: false, y: 1.0 }); B.fuse = [-10.66, -14.6, 1.6]; use('bk_fuse', -10.4, -14.6);
  B.screens.push({ x: -3, z: -17.76, y: 2.62, w: 3.4, h: 0.9, ry: 0 });
  K.prop('desk', 3.6, -16.9, 0); vbox(K, 3.6, -17.3, 1.2, 0.08, 0.7, '#1a1d22', 0.8); B.screens.push({ x: 3.6, z: -17.25, y: 1.15, w: 1.0, h: 0.5, ry: 0 });
  use('bk_status', 3.6, -16.2);
  K.prop('desk', -9.4, -5.4, 0); K.prop('desk', 3.4, -5.4, 0); K.prop('shelf', -10.3, -11.5, Q);
  for (const x of [-9.6, 3.6]) { vbox(K, x, -5.7, 1.2, 0.08, 0.7, '#1a1d22', 0.8); vbox(K, x, -5.65, 1.0, 0.04, 0.5, '#2a6a3a', 0.9); }
  vbox(K, -3, -17.75, 4.2, 0.06, 0.2, 'hazard', 2.4); for (const s of [-1, 1]) vbox(K, -3 + s * 1.05, -17.75, 0.18, 0.06, 2.4, 'hazard', 0);
  K.container('ammobox', 4.2, -6.4, Q); K.container('medbox', -10.3, -16.8, Q);
  lamp(-7, -9, '#ffe8e0', 1.0, 10); lamp(1, -9, '#ffe8e0', 1.0, 10); lamp(-3, -15.5, '#ffd0c0', 0.8, 8);
  K.npc('scientist_heavy', -6, -8, { guard: true }); K.npc('scientist', 1, -8.5, { patrol: [[2.6, -8.5], [2.6, -16], [-8.5, -16], [-8.5, -8.5]] });
  B.beacons.push([-10.4, -4.6, 3.2], [4.4, -17.4, 3.2]);
  B.spots.push([-3, -7]);
  // ---- V: the vault (the controller on its pedestal, the best crates)
  K.box(-3, -22.4, 1.1, 1.1, 1.05, 'metal_dark'); vbox(K, -3, -22.4, 1.4, 1.4, 0.12, 'hazard', 0); vbox(K, -3, -22.4, 1.25, 1.25, 0.05, '#3a3e44', 1.05);
  B.pedestal = [-3, -22.4, 1.1]; use('bk_ctl', -3, -21.4);
  K.container('bunker_crate', -6.8, -24.8, 0); K.container('bunker_crate', 0.8, -24.8, 0); K.container('elite', -6.9, -20.0, Q); K.container('elite', 0.9, -20.0, Q);
  for (const x of [-7.6, 1.6]) for (const z of [-25.4, -19.6]) vbox(K, x, z, 0.12, 0.12, CEIL, 'hazard', 0);
  lamp(-3, -22, '#ffe6a0', 1.1, 8);
  // ---- K: the armoury (red card: elite loot, the launch fuse, terminal C)
  for (const z of [8.4, 4.4, 0.4]) { K.box(14.4, z, 0.7, 2.6, 1.9, 'metal_dark'); for (let k = 0; k < 5; k++) { const zz = z - 1 + k * 0.5; vbox(K, 13.97, zz, 0.08, 0.15, 0.4, '#6a4426', 0.25); vbox(K, 13.97, zz, 0.07, 0.1, 0.5, '#2a2b2f', 0.65); vbox(K, 13.97, zz + 0.07, 0.06, 0.07, 0.2, '#2a2b2f', 0.5); vbox(K, 13.97, zz, 0.035, 0.035, 0.55, '#16171a', 1.15); } vbox(K, 14.02, z, 0.05, 2.5, 0.06, 'yellow_paint', 1.55); } // gun racks, rifles standing in them
  K.container('elite', 9, 9.0, 0); K.container('elite', 6.2, -3.0, 0); K.container('military', 11.6, -3.1, 0); K.container('ammobox', 6.0, 9.1, 0);
  K.container('fuse_rack', 9.4, -3.3, 0);
  K.prop('desk', 6.0, 7.2, Q); vbox(K, 5.4, 7.2, 0.1, 1.2, 0.8, '#1a1d22', 1.0); vbox(K, 5.46, 7.2, 0.04, 1.0, 0.6, '#8ad0ff', 1.1);
  B.clues[2] = use('bk_clue', 6.4, 7.2, { i: 2, title: 'Armoury log' });
  lamp(10, 3, '#ffe0e0');
  // ---- C: the corridor to the silo
  for (const x of [7, 10.5, 14]) { vbox(K, x, -11.6, 0.9, 0.3, 0.3, 'rust', 3.0); }
  vbox(K, 10, -11.6, 9, 0.25, 0.25, 'metal', 3.1); vbox(K, 10, -11.6, 9, 0.18, 0.18, 'yellow_paint', 2.7);
  vbox(K, 8, -8.24, 1.0, 0.06, 0.6, '#1a1d22', 1.3); B.screens.push({ x: 8, z: -8.28, y: 1.6, w: 0.9, h: 0.45, ry: PI });
  lamp(8, -10); lamp(13, -10);
  K.npc('scientist', 9, -10, { patrol: [[7, -10], [20, -10]] });

  // ---------------------------------------------------------------- the silo
  silo(K, B);
  // anything left to know at runtime (bunker.js)
  B.wave = [[-27, 1], [-24, 6.2], [-20, -11], [-26, -9], [-3, 14], [1, 16]];
  // outside guards
  K.npc('scientist', -4, 42, { guard: true }); K.npc('scientist', 4.5, 41, { patrol: [[4.5, 41], [4.5, 22]] });
  K.npc('scientist', -41.5, 41.5, { y: 3.92, guard: true }); K.npc('scientist', 41.5, -41.5, { y: 3.92, guard: true });
  K.npc('scientist', 22, 22, { patrol: [[22, 22], [40, 22], [40, 2], [22, 2]] });
  K.npc('scientist_heavy', -24, 26, { patrol: [[-24, 26], [-36, 36], [-12, 34]] });
}
/** canvas textures for the facade's signs and the camo net (made once) */
const TEX = {};
function canvasTex(key, w, h, draw) {
  if (TEX[key]) return TEX[key];
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return (TEX[key] = t);
}
function trefoil(g, cx, cy, r, col) {
  g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r * 0.18, 0, PI * 2); g.fill();
  for (let k = 0; k < 3; k++) { const a = -PI / 2 + k * PI * 2 / 3; g.beginPath(); g.moveTo(cx + Math.cos(a - 0.52) * r * 0.28, cy + Math.sin(a - 0.52) * r * 0.28); g.arc(cx, cy, r, a - 0.52, a + 0.52); g.arc(cx, cy, r * 0.28, a + 0.52, a - 0.52, true); g.fill(); }
}
const SIGNS = {
  rad: (g, w, h) => { g.fillStyle = '#f0c030'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1a1a1a'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10); trefoil(g, w / 2, h / 2, w * 0.36, '#1a1a1a'); },
  danger: (g, w, h) => { g.fillStyle = '#e8e4da'; g.fillRect(0, 0, w, h); g.fillStyle = '#b02a20'; g.fillRect(0, 0, w, h * 0.42); g.fillStyle = '#fff'; g.font = '900 ' + h * 0.3 + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DANGER', w / 2, h * 0.22);
    g.fillStyle = '#1a1a1a'; g.font = '800 ' + h * 0.17 + 'px system-ui, sans-serif'; g.fillText('AUTHORISED', w / 2, h * 0.58); g.fillText('PERSONNEL ONLY', w / 2, h * 0.8); },
  silo: (g, w, h) => { g.fillStyle = '#ddd8cc'; g.fillRect(0, 0, w, h); g.fillStyle = '#7a1c14'; g.font = '900 ' + h * 0.62 + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LAUNCH COMPLEX 7', w / 2, h * 0.54); },
  stencil: (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(40,38,34,0.88)'; g.font = '900 ' + h * 0.8 + 'px Impact, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUNKER 7', w / 2, h * 0.54);
    g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 70; i++) { g.fillStyle = 'rgba(0,0,0,' + (0.3 + Math.random() * 0.6) + ')'; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3); } // worn paint
    g.globalCompositeOperation = 'source-over'; },
  b1: (g, w, h) => { g.fillStyle = '#e0dcd0'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a1a1a'; g.font = '900 ' + h * 0.7 + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B-1', w / 2, h * 0.55); },
  b2: (g, w, h) => { g.fillStyle = '#e0dcd0'; g.fillRect(0, 0, w, h); g.fillStyle = '#1a1a1a'; g.font = '900 ' + h * 0.7 + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B-2', w / 2, h * 0.55); },
};
/** a flat sign facing local +Z (the drive) */
function sign(K, key, x, y, z, w, h, cw = 128, ch = 128, o = {}) {
  const t = canvasTex(key, cw, ch, SIGNS[key]); if (!t) return;
  const mat = new THREE.MeshLambertMaterial({ map: t, transparent: !!o.alpha, alphaTest: o.alpha ? 0.3 : 0, depthWrite: !o.alpha });
  lmesh(K, new THREE.PlaneGeometry(w, h), mat, x, y, z, K.flip ? PI : 0); // (a mirrored site turns local yaws round: keep it facing out)
}
/** the bunker's front: pilasters, a plinth and a cornice break the long wall into bays; formwork joints, vent grilles,
 *  conduits on brackets with a valve, wall lamps, signs and a stencil, hazard bands, sandbags and a camo net over the
 *  east bay. Visual only, except the sandbags and the net's poles. About 2.5k triangles. */
function facade(K, fGround) {
  const F = Z1 + 0.3, H = TOP + COPE;                                                                  // the wall's face, its top
  const PIL = [-34, -28, -15.6, -9.6, 4.6, 14.5];
  for (const x of PIL) {
    const h = Math.max(1, fGround(x) + COPE);
    vbox(K, x, F + 0.16, 0.8, 0.32, h, 'concrete_dark', 0, true);
    vbox(K, x, F + 0.2, 1.0, 0.4, 0.28, 'concrete_dark', h - 0.28);                                    // its cap
    vbox(K, x, F + 0.33, 0.82, 0.02, 0.75, 'hazard', 0.05);                                            // a hazard band at its foot
  }
  // the plinth (darker, a little proud) and the cornice under the coping, either side of the portal
  for (const [a, b] of [[-33.6, -6.3], [-0.0, X1 + 0.3]]) { vbox(K, (a + b) / 2, F + 0.07, b - a, 0.14, 0.72, 'concrete_dark', 0); vbox(K, (a + b) / 2, F + 0.11, b - a, 0.22, 0.32, 'concrete_dark', H - 0.62); }
  for (const [a, b] of [[-33.6, -6.3], [4.2, X1]]) vbox(K, (a + b) / 2, F + 0.012, b - a, 0.02, 0.06, '#5e5b55', 2.9); // a formwork joint
  // vent grilles low in the bays: a frame and slats
  for (const x of [-31, -12.6, 12]) { vbox(K, x, F + 0.04, 1.3, 0.08, 0.8, 'metal_dark', 1.0); for (let k = 0; k < 4; k++) vbox(K, x, F + 0.1, 1.16, 0.05, 0.08, 'metal', 1.1 + k * 0.17); }
  // two conduits on brackets (a gas line in yellow), a drop into a junction box by the portal, a valve wheel
  const pipeX = (x0, x1, y, z, r, surf) => lmesh(K, M.cyl(r, r, x1 - x0, 8), M.surf(surf), (x0 + x1) / 2, y, z, 0, { rz: Q, cast: true });
  pipeX(-33.8, -6.8, 3.9, F + 0.62, 0.11, 'metal'); pipeX(-33.8, -6.8, 4.2, F + 0.62, 0.08, 'yellow_paint');
  for (let x = -32.5; x < -7; x += 3) vbox(K, x, F + 0.32, 0.1, 0.62, 0.55, 'metal_dark', 3.7);
  lmesh(K, M.cyl(0.11, 0.11, 3.1, 8), M.surf('metal'), -6.8, 2.4, F + 0.62); lmesh(K, M.cyl(0.08, 0.08, 3.4, 8), M.surf('yellow_paint'), -7.15, 2.55, F + 0.62);
  vbox(K, -7.0, F + 0.3, 0.9, 0.55, 1.0, 'metal_dark', 0.35); vbox(K, -7.0, F + 0.58, 0.7, 0.02, 0.12, 'hazard', 1.1);
  lmesh(K, M.cyl(0.11, 0.11, 2.2, 8), M.surf('metal'), -33.8, 2.8, F + 0.62);                         // down into the ground at the west end
  lmesh(K, new THREE.TorusGeometry(0.22, 0.035, 4, 10), M.surf('red_paint'), -25, 3.9, F + 0.85, 0, { rx: 0 }); vbox(K, -25, F + 0.75, 0.06, 0.18, 0.06, 'metal_dark', 3.87);
  // wall lamps: a dark housing over a glowing lens, each casting a pool of light on the apron at night
  const lens = new THREE.MeshBasicMaterial({ color: '#fff0c8' });
  for (const x of [-24, -12, 8]) {
    vbox(K, x, F + 0.2, 0.7, 0.4, 0.3, 'metal_dark', 3.25); vbox(K, x, F + 0.06, 0.2, 0.12, 0.4, 'metal_dark', 3.0);
    lmesh(K, M.box(0.6, 0.05, 0.32), lens, x, 3.23, F + 0.22);
    K.light(x, F + 1.4, 2.9, '#ffe2b0', 0.9, 10);
  }
  // signs: over the door, beside the side doors, on the portal pillar, door numbers, a big stencil
  sign(K, 'silo', -3, 5.15, Z1 + 1.585, 2.8, 0.36, 256, 32);
  for (const x of [-22 - 2.1, 9 - 2.1]) sign(K, 'rad', x, 1.75, F + 0.02, 0.7, 0.7, 64, 64);
  sign(K, 'danger', -5.65, 1.6, Z1 + 1.515, 1.0, 0.62, 128, 80);
  sign(K, 'b1', -22, 2.35, Z1 + 0.59, 0.5, 0.26, 64, 32); sign(K, 'b2', 9, 2.35, Z1 + 0.59, 0.5, 0.26, 64, 32);
  sign(K, 'stencil', -18.1, 1.55, F + 0.015, 4.0, 1.0, 256, 64, { alpha: true });
  // sandbags along the wall, either side
  bags(K, -30.5, Z1 + 1.6, 3.4, 0.9); bags(K, 12.6, Z1 + 1.55, 3.0, 0.9);
  // the camo net over the east bay: a sagging sheet from the wall top out to two poles
  const nx0 = 5.4, nx1 = 13.8, nz0 = F + 0.35, nz1 = Z1 + 6.6, ny0 = TOP - 0.4, ny1 = 2.75, NU = 10, NV = 7;
  for (const x of [nx0 + 0.5, nx1 - 0.5]) K.cyl(x, nz1 - 0.2, 0.07, ny1 + 0.1, 'metal_dark', { seg: 6 });
  const tex = canvasTex('camo', 128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); const R = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < 260; i++) { g.fillStyle = ['#4a5a30', '#5d6b3c', '#3c4628', '#6e6a44', '#57492e'][i % 5]; g.beginPath(); g.ellipse(R(0, w), R(0, h), R(3, 9), R(2, 6), R(0, 3), 0, PI * 2); g.fill(); }
    g.strokeStyle = '#2e3220'; g.lineWidth = 1.5; for (let k = 0; k <= w; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, h); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(w, k); g.stroke(); }
  });
  if (tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const u = i / NU, v = j / NV, x = nx0 + (nx1 - nx0) * u, z = nz0 + (nz1 - nz0) * v;
      const y = ny0 + (ny1 - ny0) * v - 0.55 * Math.sin(PI * u) * Math.sin(PI * Math.min(1, v * 1.15)) - (j === NV && i % 5 ? 0.25 : 0) + (K.R() - 0.5) * 0.12;
      const [wx, wz] = K.toWorld(x, z); pos.push(wx - K.mon.x, y, wz - K.mon.z); uv.push(u * 3.4, v * 2.4);
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    M.add(statics(K), g, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide }), 0, 0, 0, { cast: false });
  }
}
/** a cheap sandbag wall (w x d, two courses of bags) */
function bags(K, x, z, w, d) {
  K.box(x, z, w, d, 0.45, '#8a7c58', { tex: 2 }); K.box(x, z, w * 0.94, d * 0.94, 0.4, '#7e7150', { y: 0.45, collide: false });
  const along = w > d, n = Math.max(2, Math.round((along ? w : d) / 0.55));
  for (let k = 1; k < n; k++) { const u = -0.5 + k / n; vbox(K, x + (along ? u * w : 0), z + (along ? 0 : u * d), along ? 0.04 : d * 1.01, along ? d * 1.01 : 0.04, 0.84, '#5e5238', 0.02); }
}
/** a few pipes along the generator hall's ceiling */
function ceilingPipes(K) { for (const z of [-17.2, -16.6]) vbox(K, -22, z, 21, 0.28, 0.28, z < -17 ? 'rust' : 'metal', 3.1); }

/** the silo: a round concrete tower east of the hill, the missile stand, a catwalk on a ladder, the hatch (bunker.js) */
function silo(K, B) {
  const st = statics(K), cs = M.surf('concrete'), cd = M.surf('concrete_dark');
  const [cx, cz] = K.toWorld(SX, SZ), px = cx - K.mon.x, pz = cz - K.mon.z;
  // collision: a ring of posts round the wall, a gap for the corridor (local west)
  const gapA = Math.asin(2.0 / ((RIN + ROUT) / 2));
  for (let a = 0; a < PI * 2; a += 0.6 / ((RIN + ROUT) / 2)) {
    const off = Math.abs(((a - PI) % (PI * 2) + PI * 3) % (PI * 2) - PI); // distance from local west (PI)
    if (off < gapA) continue;
    const m = K.cyl(SX + Math.cos(a) * (RIN + ROUT) / 2, SZ + Math.sin(a) * (RIN + ROUT) / 2, 0.5, SH, 'concrete', { seg: 5 }); if (m && m.parent) m.parent.remove(m);
  }
  for (const s of [-1, 1]) block(K, SX - (RIN + ROUT) / 2 - 0.3, SZ + s * 2.25, 1.6, 0.5, CEIL); // the doorway's cheeks
  // the walls: full above the doorway, a slice cut out for it below
  const tw = wtheta(K, -1, 0), gw = Math.asin(1.8 / RIN), seg = 44;
  const add = (geo, mat, y) => { const m = M.add(st, geo, mat, px, y, pz, { cast: true }); return m; };
  const dbl = M.mat(M.SURF.concrete[0], { tex: 'concrete', side: 'double' });
  add(tube(ROUT, SH - CEIL, seg), cs, CEIL + (SH - CEIL) / 2); add(tube(RIN, SH - CEIL, seg), dbl, CEIL + (SH - CEIL) / 2);
  add(tube(ROUT, CEIL, seg, tw + gw, PI * 2 - gw * 2), cs, CEIL / 2); add(tube(RIN, CEIL, seg, tw + gw, PI * 2 - gw * 2), dbl, CEIL / 2);
  for (const s of [-1, 1]) { const a = tw + s * gw; const m = M.add(st, M.box(ROUT - RIN, CEIL, 0.1), cd, px + Math.sin(a) * (RIN + ROUT) / 2, CEIL / 2, pz + Math.cos(a) * (RIN + ROUT) / 2); m.rotation.y = a + Q; }
  // the rim, a hazard band and a ring of buttresses round the base
  const rim = new THREE.RingGeometry(RIN - 0.05, ROUT + 0.35, seg, 1).rotateX(-PI / 2); add(rim, cd, SH + 0.01);
  add(tube(ROUT + 0.36, 0.5, seg), cd, SH - 0.25); add(tube(ROUT + 0.02, 0.45, seg), M.surf('hazard'), SH - 1.1);
  add(tube(ROUT + 0.03, 0.3, seg), M.surf('red_paint'), 6.2);
  for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * PI * 2, dx = Math.cos(a), dz = Math.sin(a); if (dx < -0.6) continue; // none on the hill side
    K.box(SX + dx * (ROUT + 0.45), SZ + dz * (ROUT + 0.45), 1.0, 1.0, 3.2, 'concrete_dark'); }
  // the floor, the stand, the rail ring
  add(new THREE.CircleGeometry(RIN, seg).rotateX(-PI / 2), cd, 0.1);
  K.cyl(SX, SZ, 1.55, 1.2, 'metal_dark', { seg: 18 }); vbox(K, SX, SZ, 2.4, 2.4, 0.08, 'hazard', 0.1);
  for (let k = 0; k < 4; k++) { const a = k * Q + PI / 4; vbox(K, SX + Math.cos(a) * 1.6, SZ + Math.sin(a) * 1.6, 0.4, 0.4, 3.2, 'yellow_paint', 0); }
  const RR = 2.7;
  for (let k = 0; k < 20; k++) { const a = k / 20 * PI * 2; K.cyl(SX + Math.cos(a) * RR, SZ + Math.sin(a) * RR, 0.05, 1.05, 'yellow_paint', { seg: 4, opaque: false }); }
  for (let k = 0; k < 40; k++) { const a = k / 40 * PI * 2; const m = K.cyl(SX + Math.cos(a) * RR, SZ + Math.sin(a) * RR, 0.22, 1.0, 'concrete', { seg: 4, opaque: false }); if (m && m.parent) m.parent.remove(m); }
  add(new THREE.TorusGeometry(RR, 0.045, 4, 40).rotateX(PI / 2), M.surf('yellow_paint'), 1.05);
  for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2 + 0.3; vbox(K, SX + Math.cos(a) * 4.3, SZ + Math.sin(a) * 4.3, 1.6, 0.5, 0.05, '#1a1a1c', 0.1); } // flame trench grates
  // the catwalk (local to the silo), its posts, rails; the ladder up on the south side
  const L = (x, z) => [SX + x, SZ + z];
  for (const [x0, z0, x1, z1] of [[-4.6, -4.6, 4.6, -2.4], [-4.6, 2.4, 4.6, 4.6], [-4.6, -2.4, -2.4, 2.4], [2.4, -2.4, 4.6, 2.4]]) { const [x, z] = L((x0 + x1) / 2, (z0 + z1) / 2); K.floor(x, z, x1 - x0, z1 - z0, CW, 'metal_dark', { t: 0.2 }); }
  for (const [x, z] of [[-4.4, -4.4], [4.4, -4.4], [-4.4, 4.4], [4.4, 4.4], [0, -4.4], [4.4, 0]]) { const [a, b] = L(x, z); K.box(a, b, 0.3, 0.3, CW - 0.2, 'metal_dark'); }
  const rail = (x, z, w, d) => { const [a, b] = L(x, z); block(K, a, b, w, d, 1.1, CW); vbox(K, a, b, w, d, 0.06, 'yellow_paint', CW + 1.04); vbox(K, a, b, w, d, 0.05, 'yellow_paint', CW + 0.55); };
  rail(0, -2.45, 4.9, 0.1); rail(0, 2.45, 4.9, 0.1); rail(-2.45, 0, 0.1, 4.9); rail(2.45, 0, 0.1, 4.9);          // round the hole
  rail(0, -4.55, 9.2, 0.1); rail(-4.55, 0, 0.1, 9.2); rail(4.55, 0, 0.1, 9.2); rail(-2.7, 4.55, 3.8, 0.1); rail(2.7, 4.55, 3.8, 0.1); // the outer edge, open at the ladder
  for (const [x, z] of [[-4.55, -4.55], [4.55, -4.55], [-4.55, 4.55], [4.55, 4.55], [-0.8, 4.55], [0.8, 4.55]]) { const [a, b] = L(x, z); vbox(K, a, b, 0.07, 0.07, 1.1, 'yellow_paint', CW); }
  { const [a, b] = L(0, 5.0); K.ladder(a, b, -Q, 0, CW); }
  { const [a, b] = L(0, -4.1); vbox(K, a, b, 1.1, 0.5, 0.85, 'metal_dark', CW); vbox(K, a, b + 0.26, 0.9, 0.04, 0.5, '#3cff8a', CW + 0.85); B.clues[3] = K.use('bk_clue', a, b + 0.6, { i: 3, title: 'Silo maintenance panel', y: K.baseY + CW, ly: CW }); }
  { const [a, b] = L(5.3, 2.4); K.container('elite', a, b, Q); }                  // on the silo floor, out of the way
  { const [a, b] = L(-4.0, -4.0); K.container('ammobox', a, b, 0, { y: CW }); }
  // lights, the doorway's hazard frame, a status screen by the door
  K.light(SX, SZ, 9.5, '#e8f0ff', 1.3, 14); K.light(SX, SZ + 3, 3.0, '#ffe0c0', 0.8, 9);
  { const [a, b] = L(-6.2, -2.6); vbox(K, a, b, 0.5, 0.06, 0.9, '#1a1d22', 1.2); }
  B.beacons.push([SX + RIN - 0.2, SZ, SH + 0.3]);
  B.silo = { x: SX, z: SZ, rin: RIN, top: SH };
}

export const BUNKER_LAYOUTS = { bunker };
