// ============================================================================
// ZONEFALL — sites out at sea.
//   oilrig   Oil Rig (tier 4, offshore): a steel platform on four legs in deep
//            water, five levels stepped like a wedding cake so every flight of
//            stairs climbs the open margin of the deck below it:
//              dock  (0.8 m) boat pontoon, a ladder up from the water
//              D1    (5 m)   pump deck: tanks, pipes, oil barrels; four leg
//                            ladders come up here from the sea
//              D2    (9.5 m) main deck: cranes, containers, the recycler
//              D3    (14 m)  crew quarters and a workshop
//              D4    (18.5 m) control room: the locked crate, elite loot
//              PAD   (23 m)  helipad on the control room roof
//            Guarded by scientists. The locked crate is hacked like the cargo
//            ship's (events.js runs it and flies reinforcements onto the pad).
// Placed by gen.js (its own code, out past the cargo ship's ring), never
// flattened: the site's base height is sea level, so every y here is metres
// above the water. Same conventions as the other layout files: LOCAL metres,
// origin = the site centre, +X east / +Z south before the kit's turn and mirror.
// Height rules (kit.js / monuments_tall.js): decks are K.floor slabs, stairs are
// K.stairs ramps, a box raised 1.75 m or more only blocks people at its level.
// Every deck edge is railed (rails sit just inside the slab so NPC paths see
// them); each flight is walled on both sides from the deck below up to handrail
// height over the deck above, and shut underneath its high end, so nobody walks
// off a stair or in under one. Variants with K.pick only; randomness from K.R.
// ============================================================================
import { THREE, M } from '../gfx/materials.js';

const PI = Math.PI, Q = PI / 2;
export const RIG = { DOCK: 0.8, D1: 5.0, D2: 9.5, D3: 14.0, D4: 18.5, PAD: 23.0 };
const { DOCK, D1, D2, D3, D4, PAD } = RIG;
const RAIL_H = 1.1;

// ---------------------------------------------------------------- helpers (local copies of the usual kit tricks)
const statics = K => (K.group.children[0] && K.group.children[0].isGroup ? K.group.children[0] : K.group);
const mat = (surf, o) => (typeof surf === 'string' ? M.surf(surf, o || {}) : surf);
/** a rod between two LOCAL points a = [x, y, z] and b (visual only) */
function rod(K, surf, r, a, b, seg = 6) {
  const [ax, az] = K.toWorld(a[0], a[2]), [bx, bz] = K.toWorld(b[0], b[2]);
  const d = new THREE.Vector3(bx - ax, b[1] - a[1], bz - az), L = d.length(); if (L < 1e-3) return null;
  const m = M.add(statics(K), M.cyl(r, r, 1, seg), mat(surf), (ax + bx) / 2 - K.mon.x, (a[1] + b[1]) / 2, (az + bz) / 2 - K.mon.z, { cast: false });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.scale.y = L;
  return m;
}
/** invisible collider (the kit registers it, the mesh is dropped) */
function block(K, x, z, w, d, h, y) { const m = K.box(x, z, w, d, h, 'concrete', { y, cast: false }); if (m && m.parent) m.parent.remove(m); }
/** visual-only box */
const vbox = (K, x, z, w, d, h, surf, y = 0, cast = false) => K.box(x, z, w, d, h, surf, { y, collide: false, cast });
/** cut [from, to] by gaps [[a, b], ...] -> the solid runs */
function runs(from, to, gaps = []) {
  const out = []; let cur = from;
  for (const [a, b] of gaps.slice().sort((p, q) => p[0] - q[0])) { if (a > cur) out.push([cur, Math.min(a, to)]); cur = Math.max(cur, b); }
  if (to > cur) out.push([cur, to]); return out.filter(([a, b]) => b - a > 0.05);
}
/**
 * a guard rail along `axis` ('x' | 'z') at the fixed other coordinate, from `from` to `to`, standing on height y.
 * o.h = rail height; o.top = the collider reaches up to this height instead (the outer wall of a flight that climbs
 * beside this edge: its sloped handrail is drawn by flight()); gaps = [[a, b]] openings.
 */
function rail(K, axis, fixed, from, to, y, gaps = [], o = {}) {
  const h = o.h ?? RAIL_H, surf = o.surf || 'yellow_paint';
  for (const [a, b] of runs(from, to, gaps)) {
    const mid = (a + b) / 2, len = b - a, ch = (o.top ?? y + h) - y;
    if (axis === 'x') block(K, mid, fixed, len, 0.2, ch, y); else block(K, fixed, mid, 0.2, len, ch, y);
    // posts every ~1.6 m, a top bar and a knee bar
    const n = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) { const t = a + len * i / n; if (axis === 'x') vbox(K, t, fixed, 0.07, 0.07, h, surf, y); else vbox(K, fixed, t, 0.07, 0.07, h, surf, y); }
    for (const yy of h > 0.7 ? [h - 0.05, h * 0.5] : [h - 0.05]) { if (axis === 'x') vbox(K, mid, fixed, len, 0.06, 0.06, surf, y + yy - 0.03); else vbox(K, fixed, mid, 0.06, len, 0.06, surf, y + yy - 0.03); }
  }
}
/** a deck slab [x0,x1] x [z0,z1] with its top at y, steel beams underneath */
function deck(K, x0, x1, z0, z1, y, surf = 'metal_dark', o = {}) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  K.floor(cx, cz, w, d, y, surf, { t: o.t ?? 0.3 });
  if (o.beams === false) return;
  const along = w >= d, n = Math.max(1, Math.round((along ? d : w) / 3));
  for (let i = 0; i <= n; i++) {
    const t = (along ? z0 + 0.2 : x0 + 0.2) + ((along ? d : w) - 0.4) * i / n;
    if (along) vbox(K, cx, t, w - 0.1, 0.18, 0.45, 'metal_dark', y - (o.t ?? 0.3) - 0.45); else vbox(K, t, cz, 0.18, d - 0.1, 0.45, 'metal_dark', y - (o.t ?? 0.3) - 0.45);
  }
}
/**
 * a flight of steel stairs filling the lane [x0,x1] x [z0,z1], rising from y0 to y1 toward dir ('+x' | '-x' | '+z' | '-z').
 * Both long sides are walled from y0 up to handrail height over y1 (o.sides: which of 'a' (low coordinate) / 'b' to wall),
 * and the space under the high end is shut so nobody walks in under the treads.
 */
function flight(K, x0, x1, z0, z1, y0, y1, dir, o = {}) {
  const ax = dir[1] === 'x', sg = dir[0] === '-' ? -1 : 1, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const len = ax ? x1 - x0 : z1 - z0, w = ax ? z1 - z0 : x1 - x0;
  K.stairs(cx, cz, w, len, y0, y1, dir, o.surf || 'metal_dark', { sides: false });
  const H = y1 + RAIL_H - y0, sides = o.sides ?? 'ab';
  const lo = ax ? x0 : z0, hi = ax ? x1 : z1, at = s => (s === 'a' ? (ax ? z0 : x0) + 0.08 : (ax ? z1 : x1) - 0.08);
  for (const s of ['a', 'b']) {
    if (sides.includes(s)) { if (ax) block(K, cx, at(s), len, 0.16, H, y0); else block(K, at(s), cz, 0.16, len, H, y0); }
    // sloped handrail + posts
    const p = (u, yy) => ax ? [u, yy, at(s)] : [at(s), yy, u];
    const u0 = sg > 0 ? lo : hi, u1 = sg > 0 ? hi : lo;
    rod(K, 'yellow_paint', 0.035, p(u0, y0 + 1.0), p(u1, y1 + 1.0));
    for (let i = 0; i <= 4; i++) { const t = i / 4, u = u0 + (u1 - u0) * t, yy = y0 + (y1 - y0) * t; rod(K, 'yellow_paint', 0.03, p(u, yy), p(u, yy + 1.0)); }
  }
  // under the high end: shut from the deck below up to well below the top step
  const e = sg > 0 ? hi - 0.1 : lo + 0.1;
  if (ax) block(K, e, cz, 0.2, w, (y1 - y0) * 0.6, y0); else block(K, cx, e, w, 0.2, (y1 - y0) * 0.6, y0);
}
/** an upright post (visual + collider band) from y0 up to y1 */
function post(K, x, z, y0, y1, s = 0.45, surf = 'metal_dark') { vbox(K, x, z, s, s, y1 - y0, surf, y0, true); block(K, x, z, s, s, y1 - y0, y0); }
/** a wall run along x or z with gaps [[a0, a1], ...]; y = the floor it stands on */
function wallRun(K, axis, fixed, from, to, y, h, surf, gaps = [], t = 0.25) {
  for (const [a, b] of runs(from, to, gaps)) { const mid = (a + b) / 2, len = b - a; if (axis === 'x') K.box(mid, fixed, len, t, h, surf, { y }); else K.box(fixed, mid, t, len, h, surf, { y }); }
  for (const [a, b] of gaps) if (b - a < 3.2 && h > 2.6) { const mid = (a + b) / 2; if (axis === 'x') K.box(mid, fixed, b - a, t, h - 2.3, surf, { y: y + 2.3, collide: false }); else K.box(fixed, mid, t, b - a, h - 2.3, surf, { y: y + 2.3, collide: false }); }
}
/** a wall run with windows (sill to 1.0 m, glass, head from 2.1 m) and door gaps */
function wallWin(K, axis, fixed, from, to, y, h, surf, doors = [], wins = [], t = 0.25) {
  wallRun(K, axis, fixed, from, to, y, h, surf, doors.concat(wins), t);
  const glass = M.mat('#9cc4d4', { transparent: true, opacity: 0.28 });
  for (const [a, b] of wins) {
    const mid = (a + b) / 2, L = b - a, bx = (hh, yy, s, o) => axis === 'x' ? K.box(mid, fixed, L, t, hh, s, Object.assign({ y: yy }, o)) : K.box(fixed, mid, t, L, hh, s, Object.assign({ y: yy }, o));
    bx(1.0, y, surf, { opaque: false }); bx(h - 2.1, y + 2.1, surf, { collide: false });
    if (axis === 'x') vbox(K, mid, fixed, L, 0.05, 1.1, glass, y + 1.0); else vbox(K, fixed, mid, 0.05, L, 1.1, glass, y + 1.0);
  }
}
/** a cylindrical tank standing on a deck (visual cylinder + a square collider band at its level) */
function tank(K, x, z, r, h, y, surf = 'white_paint') {
  K.cyl(x, z, r, h, surf, { y, collide: false, seg: 16 });
  K.cyl(x, z, r * 0.55, 0.35, 'metal_dark', { y: y + h, collide: false, seg: 10 });
  vbox(K, x, z, r * 2.05, 0.12, 0.25, 'red_paint', y + h * 0.7);
  block(K, x, z, r * 1.7, r * 1.7, h, y);
}
/** a recycler on a deck (the kit's K.recycler only stands on the ground) */
function recycler(K, x, z, ry, y) {
  const o = K.deployModel('recycler', x, z, ry); if (o) o.position.y = y;
  block(K, x, z, 1.6, 1.6, 1.8, y);
  return K.use('recycler', x, z, { y, obj: o });
}
/** a pedestal crane at a deck corner: boom out over the sea toward local yaw `ang` */
function crane(K, x, z, y, ang, len = 15) {
  K.cyl(x, z, 1.0, 2.6, 'yellow_paint', { y, collide: false, seg: 12 }); block(K, x, z, 1.8, 1.8, 2.6, y);
  const c = Math.cos(ang), s = Math.sin(ang);
  vbox(K, x - c * 0.4, z - s * 0.4, 2.4, 2.4, 2.2, 'yellow_paint', y + 2.6, true);                      // cab
  vbox(K, x - c * 0.4 + c * 1.21, z - s * 0.4 + s * 1.21, Math.abs(s) * 2 + 0.1, Math.abs(c) * 2 + 0.1, 0.9, 'glass_dark', y + 3.6);
  const b0 = [x + c * 0.8, y + 3.4, z + s * 0.8], b1 = [x + c * len * 0.87, y + 3.4 + len * 0.5, z + s * len * 0.87];
  const px = -s * 0.45, pz = c * 0.45;
  for (const k of [-1, 1]) { rod(K, 'yellow_paint', 0.09, [b0[0] + px * k, b0[1], b0[2] + pz * k], [b1[0] + px * k, b1[1], b1[2] + pz * k]); rod(K, 'yellow_paint', 0.06, [b0[0] + px * k, b0[1] + 0.7, b0[2] + pz * k], [b1[0] + px * k * 0.5, b1[1] + 0.3, b1[2] + pz * k * 0.5]); }
  for (let i = 1; i < 8; i++) { const t = i / 8, p = [b0[0] + (b1[0] - b0[0]) * t, b0[1] + (b1[1] - b0[1]) * t, b0[2] + (b1[2] - b0[2]) * t]; rod(K, 'yellow_paint', 0.04, [p[0] + px, p[1], p[2] + pz], [p[0] - px, p[1] + 0.7, p[2] - pz]); }
  rod(K, 'metal_dark', 0.025, [b1[0], b1[1], b1[2]], [b1[0], y - 1.5, b1[2]]);                    // the hook cable, down past the deck
  vbox(K, b1[0], b1[2], 0.5, 0.5, 0.6, 'red_paint', y - 2.1);
  rod(K, 'metal_dark', 0.04, [x - c * 1.4, y + 4.8, z - s * 1.4], [b1[0], b1[1], b1[2]]);         // luffing wire
}
/** a shipping container prop that sits on a deck */
const box6 = (K, x, z, rq, y, color) => K.prop('container', x, z, rq, { y, color });

// ============================================================================
// OIL RIG
// ============================================================================
function oilrig(K) {
  K.label('Oil Rig');
  const v = K.pick(2), R = K.R;
  K.mon.toWorld = K.toWorld; K.mon.levels = RIG; // events.js flies reinforcements to local spots (and tests walk the decks)
  const CONT = ['#9a4a36', '#3e6a8e', '#5a7048', '#b08a3a', '#6a6a70', '#c8642a'];
  const cc = i => CONT[(K.pick(CONT.length, 11 + i) + i) % CONT.length];

  // ---------------------------------------------------------------- legs, bracing (sea bed to the pump deck)
  const LEGS = [[18, 12.5], [-18, 12.5], [18, -12.5], [-18, -12.5]];
  for (const [x, z] of LEGS) {
    K.cyl(x, z, 1.7, D1 - 0.3 + 15, 'yellow_paint', { y: -15, collide: false, seg: 18 });
    K.cyl(x, z, 2.1, 1.0, 'rust', { y: -0.7, collide: false, seg: 18 });           // splash-zone band at the waterline
    K.cyl(x, z, 1.95, 0.5, 'metal_dark', { y: D1 - 1.2, collide: false, seg: 18 }); // leg cap under the deck
    block(K, x, z, 2.5, 2.5, D1 - 0.3 + 15, -15);
  }
  for (const [[ax, az], [bx, bz]] of [[LEGS[0], LEGS[2]], [LEGS[1], LEGS[3]], [LEGS[0], LEGS[1]], [LEGS[2], LEGS[3]]]) {
    rod(K, 'yellow_paint', 0.32, [ax, 2.0, az], [bx, 2.0, bz], 8);                     // ring beam above the water
    rod(K, 'yellow_paint', 0.22, [ax, -9, az], [bx, 1.6, bz], 6); rod(K, 'yellow_paint', 0.22, [bx, -9, bz], [ax, 1.6, az], 6); // X braces
  }
  // ladders up the legs, from the water to the pump deck (the outer face of each leg)
  for (const [x, z] of LEGS) {
    const s = Math.sign(x), lx = x + s * 1.82;
    K.ladder(lx, z, s > 0 ? PI : 0, -1.3, D1);
    for (let y = 0.8; y < D1 + 0.4; y += 1.0) { // safety cage hoops round the climber (visual)
      rod(K, 'metal_dark', 0.025, [lx + s * 0.05, y, z - 0.42], [lx + s * 0.75, y, z - 0.42]); rod(K, 'metal_dark', 0.025, [lx + s * 0.05, y, z + 0.42], [lx + s * 0.75, y, z + 0.42]);
      rod(K, 'metal_dark', 0.025, [lx + s * 0.75, y, z - 0.42], [lx + s * 0.75, y, z + 0.42]);
    }
    for (const k of [-0.42, 0.42]) rod(K, 'metal_dark', 0.02, [lx + s * 0.75, 0.8, z + k], [lx + s * 0.75, D1 + 0.4, z + k]);
  }

  // ---------------------------------------------------------------- dock (boat pontoon), its ladder, the stair up to D1
  deck(K, -10, 10, -21, -17.6, DOCK, 'plank_dark', { beams: false, t: 0.2 });
  deck(K, -10, -4, -17.6, -15.2, DOCK, 'plank_dark', { beams: false, t: 0.2 });
  K.box(0, -19.3, 20, 3.4, DOCK + 1.6 - 0.2, 'metal_dark', { y: -1.6, cast: false });  // floats (stop boats and swimmers)
  K.box(-7, -16.4, 6, 2.4, DOCK + 1.6 - 0.2, 'metal_dark', { y: -1.6, cast: false });
  vbox(K, 0, -21.05, 20.2, 0.25, 0.3, 'rust', DOCK - 0.25);                            // rubbing strake on the boat side
  for (const x of [-8, -3, 2, 7]) { K.cyl(x, -20.6, 0.18, 0.45, 'metal_dark', { y: DOCK, collide: false, seg: 8 }); K.cyl(x, -20.6, 0.26, 0.06, 'metal_dark', { y: DOCK + 0.45, collide: false, seg: 8 }); } // bollards
  K.ladder(0.3, -21.12, Q, -1.3, DOCK);
  rail(K, 'z', -9.9, -21, -15.2, DOCK);                    // west end (pontoon + wing)
  rail(K, 'z', 9.9, -21, -17.6, DOCK);                     // east end
  rail(K, 'x', -17.68, 3.5, 10, DOCK);                     // the bit of the pontoon's inner edge past the stair
  rail(K, 'x', -15.28, -10, -4, DOCK);                     // wing, under the pump deck's edge
  flight(K, -4, 3.5, -17.6, -15.2, DOCK, D1, '+x');
  deck(K, 3.5, 6.5, -17.6, -15.0, D1, 'metal_dark', { beams: false });                 // landing onto D1
  rail(K, 'x', -17.52, 3.5, 6.5, D1); rail(K, 'z', 6.42, -17.6, -15.0, D1);
  for (const [x, z] of [[-9.6, -20.7], [9.6, -20.7], [-9.6, -15.5], [3.6, -17.4], [6.3, -17.4]]) rod(K, 'metal_dark', 0.12, [x, -6, z], [x, x > 3 ? D1 - 0.3 : DOCK - 0.2, z]); // piles

  // ---------------------------------------------------------------- D1: pump deck
  deck(K, -19.8, 19.8, -15, 15, D1, 'metal_dark');
  const ladGap = [[-13.25, -11.75], [11.75, 13.25]];
  rail(K, 'x', -14.9, -19.8, 19.8, D1, [[3.5, 6.5]]);
  rail(K, 'x', 14.9, -19.8, 19.8, D1);
  rail(K, 'z', -19.7, -15, 15, D1, ladGap);
  rail(K, 'z', 19.7, -15, -6, D1, ladGap); rail(K, 'z', 19.7, 4, 15, D1, ladGap);
  rail(K, 'z', 19.7, -6, 4, D1, [], { top: D2 + RAIL_H });                            // tall: the outer wall of the stair to D2
  // posts holding up the main deck
  for (const [x, z] of [[16.6, 12.1], [-16.6, 12.1], [16.6, -12.1], [-16.6, -12.1], [16.6, 0], [-16.6, 0], [0, 12.1], [0, -12.1], [8, 12.1], [-8, 12.1], [8, -12.1], [-8, -12.1]]) post(K, x, z, D1, D2 - 0.3);
  // machinery
  K.prop('tank_h', -8, 5.6, 0, { y: D1 }); K.prop('tank_h', -8, 8.8, 0, { y: D1 });
  K.prop('pipes', 6, 8, 0, { y: D1 }); K.prop('pipes', 6, 9.2, 0, { y: D1 + 1.25, collide: false });
  K.prop('generator', 10, -5.4, 0, { y: D1 }); K.prop('transformer', 13, -5.4, 0, { y: D1 });
  K.prop(v ? 'cable_spool' : 'drums', -14, -11, 0, { y: D1 }); K.prop('pallets', 2.5, -10.5, 0, { y: D1 }); K.prop('drums', 12.5, 9.2, 0, { y: D1 });
  for (let i = 0; i < 5; i++) rod(K, i % 2 ? 'rust' : 'metal', 0.22, [-15, D1 + 3.2 - i * 0.05, -3 + i * 0.6], [15, D1 + 3.2 - i * 0.05, -3 + i * 0.6], 8); // pipe rack under D2
  for (const x of [-12, -4, 4, 12]) { vbox(K, x, -3 + 1.2, 0.15, 3.4, 0.15, 'metal_dark', D1 + 2.95); post(K, x, -3.3, D1, D1 + 3.0, 0.2); post(K, x, -0.3, D1, D1 + 3.0, 0.2); }
  for (const [x, z] of [[-13.4, 2.4], [-14.1, 3.3], [-13.0, 3.6], [-14.4, 2.2]]) K.container('barrel_oil', x, z, R() * 6, { y: D1 });
  for (const [x, z] of [[14.2, 10.4], [13.4, 11.2], [-5, -12.6]]) K.container('barrel', x, z, R() * 6, { y: D1 });
  K.container('crate', 7.5, -12.4, 0, { y: D1 }); K.container('crate', -2.6, 13.6, Q, { y: D1 }); K.container('toolbox', 8.4, -5.6, 0, { y: D1 });
  K.container('military', v ? -1 : 1, v ? 1.6 : -6.4, 0, { y: D1 }); K.container('ammobox', 15.2, -9.6, Q, { y: D1 });
  K.npc('scientist', -6, -8, { y: D1, patrol: [[-15, -8], [15, -8]], respawn: 1200 });
  K.npc('scientist', 6, 11.3, { y: D1, patrol: [[11.8, 11.3], [-13.6, 11.3]], respawn: 1200 });
  K.light(0, -6, D1 + 3.6, '#fff2d8', 1.0, 14); K.light(-8, 8, D1 + 3.6, '#fff2d8', 0.9, 12); K.light(12, 6, D1 + 3.6, '#fff2d8', 0.9, 12);

  // ---------------------------------------------------------------- stair D1 -> D2 (east margin of D1, rising -z)
  flight(K, 17.5, 19.6, -3.5, 4, D1, D2, '-z', { sides: 'a' });
  deck(K, 17.0, 19.6, -6, -3.5, D2, 'metal_dark', { beams: false });
  rail(K, 'x', -5.92, 17.0, 19.6, D2); rail(K, 'z', 19.5, -6, -3.5, D2);

  // ---------------------------------------------------------------- D2: main deck
  deck(K, -17, 17, -12.5, 12.5, D2, 'metal');
  rail(K, 'x', -12.42, -17, 17, D2, [[-4, 6]]);
  rail(K, 'x', -12.42, -4, 6, D2, [], { top: D3 + RAIL_H });                          // tall: the outer wall of the stair to D3
  rail(K, 'x', 12.42, -17, 17, D2);
  rail(K, 'z', -16.92, -12.5, 12.5, D2);
  rail(K, 'z', 16.92, -12.5, 12.5, D2, [[-6, -3.5]]);
  for (const [x, z] of [[13.6, 9.6], [-13.6, 9.6], [13.6, -9.6], [-13.6, -9.6], [13.6, 0], [-13.6, 0], [0, 9.6], [0, -9.6], [-7, 9.6], [7, -9.6]]) post(K, x, z, D2, D3 - 0.3);
  // cranes on two corners (which two: by variant)
  if (v === 0) { crane(K, 15.3, 11.0, D2, Math.atan2(1, 1)); crane(K, -15.3, -11.0, D2, Math.atan2(-1, -1)); }
  else { crane(K, -15.3, 11.0, D2, Math.atan2(1, -1)); crane(K, 15.3, -11.0, D2, Math.atan2(-1, 1)); }
  box6(K, -7, 5.4, 0, D2, cc(0)); box6(K, 6.5, -5.2, 0, D2, cc(1)); box6(K, 10.2, 4.6, Q, D2, cc(2));
  K.prop('pallets', -2, 8.6, 0, { y: D2 }); K.prop('cable_spool', 3.5, 8.8, 0, { y: D2 }); K.prop('drums', -11.5, -7.5, 0, { y: D2 });
  recycler(K, v ? -15.4 : -15.4, v ? -4 : 4, Q, D2);
  K.container('military', -7, 7.6, 0, { y: D2 }); K.container('military', 6.5, -7.2, PI, { y: D2 }); K.container('ammobox', 12.3, 1.6, Q, { y: D2 });
  K.container('crate', -3.4, -8.2, 0, { y: D2 }); K.container('medbox', 2.6, 6.8, 0, { y: D2 }); K.container('barrel', 16.3, -8.4, 0, { y: D2 }); K.container('barrel', -16.3, 8.4, 0, { y: D2 });
  K.container(v ? 'elite' : 'military', 0.5, 0.8, Q, { y: D2 });
  K.npc('scientist', -10, -2, { y: D2, patrol: [[-10, -6], [-10, 3], [4, 3], [4, -2.5]], respawn: 1200 });
  K.npc('scientist', 15.4, 8, { y: D2, patrol: [[15.4, 8], [15.4, -9]], respawn: 1200 });
  K.npc('scientist', 2, 11.3, { y: D2, patrol: [[-12, 11.3], [12, 11.3]], respawn: 1200 });
  K.light(0, 0, D2 + 3.6, '#fff2d8', 1.0, 15); K.light(-10, 8, D2 + 3.6, '#fff2d8', 0.8, 12); K.light(10, -8, D2 + 3.6, '#fff2d8', 0.8, 12);
  // the flare boom off the west edge (its flame is lit by events.js)
  const fz = v ? -6 : 6;
  rod(K, 'metal_dark', 0.28, [-16.6, D2 + 0.3, fz], [-28, D2 + 12, fz], 8);
  rod(K, 'metal', 0.12, [-16.6, D2 + 2.2, fz - 0.6], [-28, D2 + 12.2, fz - 0.5]); rod(K, 'metal', 0.12, [-16.6, D2 + 2.2, fz + 0.6], [-28, D2 + 12.2, fz + 0.5]);
  K.cyl(-28.1, fz, 0.42, 1.6, 'rust', { y: D2 + 11.6, collide: false, seg: 10 });
  { const [wx, wz] = K.toWorld(-28.1, fz); K.mon.flare = { x: wx, y: K.baseY + D2 + 13.4, z: wz }; }
  K.light(-28.1, fz, D2 + 13.4, '#ff8a30', 2.2, 26);

  // ---------------------------------------------------------------- stair D2 -> D3 (north margin of D2, rising +x)
  flight(K, -4, 3.5, -12.32, -10.25, D2, D3, '+x', { sides: 'b' });
  deck(K, 3.5, 6, -12.32, -10.0, D3, 'metal_dark', { beams: false });
  rail(K, 'z', 5.92, -12.32, -10.0, D3); rail(K, 'x', -12.22, 3.5, 6, D3);

  // ---------------------------------------------------------------- D3: quarters and workshop
  deck(K, -14, 14, -10, 10, D3, 'metal_dark');
  rail(K, 'x', -9.92, -14, 14, D3, [[3.5, 6]]);
  rail(K, 'x', 9.92, -14, 14, D3);
  rail(K, 'z', -13.92, -10, 10, D3, [[-4, 6]]);
  rail(K, 'z', -13.92, -4, 6, D3, [], { top: D4 + RAIL_H });                           // tall: the outer wall of the stair to D4
  rail(K, 'z', 13.92, -10, 10, D3);
  for (const [x, z] of [[10.1, 8.1], [-10.1, 8.1], [10.1, -8.1], [-10.1, -8.1], [10.1, 0], [-10.1, -2], [0, 8.1], [0, -8.1]]) post(K, x, z, D3, D4 - 0.3);
  const qx = v ? 1 : -9, wx0 = v ? -9 : 1;   // quarters and workshop swap sides by variant
  // crew quarters (bunks, lockers): door on the side facing the middle
  wallWin(K, 'x', 1.5, qx, qx + 8, D3, 3.2, 'white_paint', [], [[qx + 2, qx + 3.6]]);
  wallRun(K, 'x', 7.5, qx, qx + 8, D3, 3.2, 'white_paint');
  wallRun(K, 'z', qx, 1.5, 7.5, D3, 3.2, 'white_paint', v ? [[3.6, 5.0]] : []);
  wallRun(K, 'z', qx + 8, 1.5, 7.5, D3, 3.2, 'white_paint', v ? [] : [[3.6, 5.0]]);
  K.prop('bunkbed', qx + 1.4, 6.6, 0, { y: D3 }); K.prop('bunkbed', qx + 4.2, 6.6, 0, { y: D3 }); K.prop('table', qx + 5.6, 3.6, 0, { y: D3 });
  K.container('locker', qx + 7.4, 6.5, Q, { y: D3 }); K.container('locker', qx + 7.4, 2.4, Q, { y: D3 }); K.container('food', qx + 0.6, 2.2, 0, { y: D3 });
  // workshop: open-fronted, benches and parts
  wallRun(K, 'x', -7.5, wx0, wx0 + 8, D3, 3.2, 'corrugated');
  wallRun(K, 'z', v ? wx0 : wx0 + 8, -7.5, -2, D3, 3.2, 'corrugated');
  K.prop('workbench_old', wx0 + 2.5, -6.8, 0, { y: D3 }); K.prop('shelf', wx0 + 6, -6.9, 0, { y: D3 }); K.prop('cable_spool', wx0 + 4.5, -4, 0, { y: D3 });
  K.container('toolbox', wx0 + 1.4, -6.6, 0, { y: D3 }); K.container('crate', wx0 + 4, -6.7, 0, { y: D3 }); K.container('ammobox', wx0 + 7.2, -3, 0, { y: D3 });
  // tanks out on the east margin, loot in the open
  tank(K, 12.2, 6.2, 1.3, 4.2, D3); tank(K, 12.2, 2.9, 1.3, 4.2, D3, 'yellow_paint');
  K.container('military', 12, -5.6, Q, { y: D3 }); K.container('medbox', -12.6, -7.6, 0, { y: D3 }); K.container('elite', v ? -12.6 : 12.4, v ? 8.6 : -8.6, 0, { y: D3 });
  K.npc('scientist', 0, -0.4, { y: D3, patrol: [[-9, -0.6], [9, -0.6]], respawn: 1200 });
  K.npc('scientist', 12.2, -1, { y: D3, patrol: [[12.2, -8.8], [12.2, 0.6], [6, 9.2], [-11, 9.2]], respawn: 1200 });
  K.light(qx + 4, 4.5, D3 + 3.0, '#ffe8c0', 0.8, 9); K.light(wx0 + 4, -4.8, D3 + 3.0, '#fff2d8', 0.8, 9); K.light(11, 0, D3 + 3.6, '#fff2d8', 0.8, 11);

  // ---------------------------------------------------------------- stair D3 -> D4 (west margin of D3, rising +z)
  flight(K, -13.84, -11.8, -4, 3.5, D3, D4, '+z', { sides: 'b' });
  deck(K, -13.84, -10.5, 3.5, 6, D4, 'metal_dark', { beams: false });
  rail(K, 'x', 5.92, -13.84, -10.5, D4); rail(K, 'z', -13.74, 3.5, 6, D4);

  // ---------------------------------------------------------------- D4: control deck and control room
  deck(K, -10.5, 10.5, -8.5, 8.5, D4, 'concrete_dark');
  rail(K, 'x', -8.42, -10.5, 10.5, D4);
  rail(K, 'x', 8.42, -10.5, 10.5, D4, [[-6, 4]]);
  rail(K, 'x', 8.42, -6, 4, D4, [], { top: PAD + RAIL_H });                            // tall: the outer wall of the stair to the pad
  rail(K, 'z', -10.42, -8.5, 8.5, D4, [[3.5, 6]]);
  rail(K, 'z', 10.42, -8.5, 8.5, D4);
  const CR = 4.2; // control room walls, up to the pad slab
  wallWin(K, 'x', -4.5, -6, 6, D4, CR, 'white_paint', [], [[-4.5, -1.5], [1.5, 4.5]]);
  wallWin(K, 'x', 4.5, -6, 6, D4, CR, 'white_paint', [], [[-4.5, -1.5], [1.5, 4.5]]);
  wallWin(K, 'z', -6, -4.5, 4.5, D4, CR, 'white_paint', [[-0.8, 0.8]], [[-3.6, -1.6], [1.6, 3.6]]);
  wallWin(K, 'z', 6, -4.5, 4.5, D4, CR, 'white_paint', [[-0.8, 0.8]], [[-3.6, -1.6], [1.6, 3.6]]);
  vbox(K, 0, -4.5, 12.3, 0.3, 0.3, 'red_paint', D4 + CR - 0.6); vbox(K, 0, 4.5, 12.3, 0.3, 0.3, 'red_paint', D4 + CR - 0.6);
  for (const [x, z] of [[-7.6, -6.1], [7.6, -6.1], [-7.6, 6.1], [7.6, 6.1]]) post(K, x, z, D4, PAD - 0.3, 0.4);
  // consoles and screens
  const screen = M.basic('#5ad0a0'), screen2 = M.basic('#e0a040');
  for (const x of [-3.5, -1.2, 1.2, 3.5]) { K.prop('desk', x, -3.7, 0, { y: D4 }); vbox(K, x, -3.95, 0.9, 0.06, 0.55, x > 0 ? screen : screen2, D4 + 0.95); }
  K.prop('shelf', -5.3, 3.4, Q, { y: D4 }); K.prop('desk', 3.2, 3.7, PI, { y: D4 });
  { const c = K.container('locked_crate', 0, 0.8, 0, { y: D4 }); if (c) { c.locked = true; c.hackEnd = 0; c.rig = true; K.mon.lockedCrate = c; } }
  K.container('elite', -4.6, 2.4, Q, { y: D4 }); K.container('military', 4.6, -1.6, Q, { y: D4 }); K.container('ammobox', 4.5, 1.8, Q, { y: D4 });
  K.container('military', v ? 9.7 : -9.7, -7.9, 0, { y: D4 });
  K.npc('scientist', 0, -7.0, { y: D4, patrol: [[-8.6, -7.0], [8.6, -7.0], [8.6, 5.6]], respawn: 1200 });
  K.npc('scientist', -3, 1.8, { y: D4, respawn: 1200 });
  K.light(0, 0, D4 + 3.6, '#e8f4ff', 1.1, 10); K.light(-8.5, 0, D4 + 3.2, '#fff2d8', 0.8, 10);

  // ---------------------------------------------------------------- stair D4 -> pad (south margin of D4, rising -x)
  flight(K, -3.5, 4, 6.55, 8.34, D4, PAD, '-x', { sides: 'a' });
  deck(K, -6, -3.5, 6.5, 8.34, PAD, 'metal_dark', { beams: false });
  rail(K, 'z', -5.92, 6.5, 8.34, PAD); rail(K, 'x', 8.26, -6, -3.5, PAD);

  // ---------------------------------------------------------------- helipad (on the control room roof)
  deck(K, -8, 8, -6.5, 6.5, PAD, 'concrete_dark', { t: 0.3 });
  const lipGap = [[-6, -3.5]];
  rail(K, 'x', -6.42, -8, 8, PAD, [], { h: 0.5, surf: 'hazard' }); rail(K, 'x', 6.42, -8, 8, PAD, lipGap, { h: 0.5, surf: 'hazard' });
  rail(K, 'z', -7.92, -6.5, 6.5, PAD, [], { h: 0.5, surf: 'hazard' }); rail(K, 'z', 7.92, -6.5, 6.5, PAD, [], { h: 0.5, surf: 'hazard' });
  const yel = M.surf('yellow_paint'), wht = M.mat('#e8e4d8');
  { const [px, pz] = K.toWorld(0, 0); const ring = M.add(statics(K), M.cyl(5.4, 5.4, 0.02, 32), yel, px - K.mon.x, PAD + 0.012, pz - K.mon.z, { cast: false }); void ring;
    M.add(statics(K), M.cyl(4.9, 4.9, 0.02, 32), M.surf('concrete_dark'), px - K.mon.x, PAD + 0.02, pz - K.mon.z, { cast: false }); }
  vbox(K, -1.3, 0, 0.6, 4.2, 0.03, wht, PAD + 0.03); vbox(K, 1.3, 0, 0.6, 4.2, 0.03, wht, PAD + 0.03); vbox(K, 0, 0, 2.0, 0.6, 0.03, wht, PAD + 0.03); // H
  const redL = M.basic('#ff4030'), grnL = M.basic('#60ff70');
  for (const [x, z] of [[-7.6, -6.1], [7.6, -6.1], [-7.6, 6.1], [7.6, 6.1], [0, -6.1], [0, 6.1], [-7.6, 0], [7.6, 0]]) vbox(K, x, z, 0.22, 0.22, 0.2, Math.abs(x) > 1 && Math.abs(z) > 1 ? redL : grnL, PAD);
  K.light(0, 0, PAD + 2, '#ffd0a0', 0.7, 12);
  { const [hx, hz] = K.toWorld(0, 0); K.mon.helipad = { x: hx, z: hz, y: K.baseY + PAD, r: 6.2 }; }
  // a windsock and a mast on the pad's east corner
  rod(K, 'metal', 0.05, [7.4, PAD, -5.9], [7.4, PAD + 3.2, -5.9]);
  rod(K, 'red_paint', 0.18, [7.4, PAD + 3.1, -5.9], [8.6, PAD + 2.9, -5.6]);
  void R;
}

export const SEA_LAYOUTS = { oilrig };
