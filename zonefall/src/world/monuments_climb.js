// ============================================================================
// ZONEFALL — sites rebuilt around climbing and routes:
//   radio       Radio Outpost (tier 1, loot only): a steel platform tower round
//               the lattice mast with a cable bridge to a two-storey comms
//               house, or a stilted watch cabin and a roof-deck shack
//   lighthouse  Lighthouse (tier 1, coast): a climbable tower, a square spiral
//               stair round a stone core up to the watch room and gallery;
//               a keeper's station with a boathouse, or a wreck on the beach
//   quarry      Stone Quarry (tier 1): a terraced rock face with haul ramps and
//               an old adit tunnel; a crusher plant with a screening tower and
//               stacked site cabins, or an old mine with an ore bin trestle
//   dish        Dish Array (tier 2, green card): dishes on plinth bunkers tied
//               together by catwalks and a skywalk to a two-storey control
//               block; or one big dish on a drum with a receiver deck up top
//   water       Water Treatment (tier 2, blue card + fuse): bridges out over
//               the clarifiers, catwalks across the hot aeration basins, a
//               pump hall with a gallery, a filter tower and a pipe gantry
// Same conventions as monuments.js: LOCAL metres, origin = monument centre,
// +X east / +Z south before the kit's turn and mirror. Coastal sites face the
// sea with local +X (past ~0.55 * size only docks, boats and decor).
// Height rules (see kit.js / monuments_tall.js): K.floor / K.stairs make
// height-aware walkable slabs and ramps; a box raised 1.75 m or more only
// blocks people up at its level, a box on the ground blocks everyone below its
// top. No deck sits between 1.0 and 1.75 m (railings there could not collide).
// Stair flights never share a footprint at overlapping heights. Every variant
// is picked with K.pick (stable per site, the same for co-op friends).
// ============================================================================
import { THREE, M } from '../gfx/materials.js';

const PI = Math.PI, Q = PI / 2, TAU = PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- kit helpers (local copies, see monuments_extra.js)
const statics = K => (K.group.children[0] && K.group.children[0].isGroup ? K.group.children[0] : K.group);
const mat = (surf, o) => (typeof surf === 'string' ? M.surf(surf, o || {}) : surf);
/** visual-only mesh (no collider) at LOCAL (x, y, z); ry = local yaw, rx / rz tilt in the mesh frame, s = scale */
function vis(K, geo, surf, x, y, z, o = {}) {
  const [wx, wz] = K.toWorld(x, z);
  const m = M.add(statics(K), geo, mat(surf), wx - K.mon.x, y, wz - K.mon.z, { cast: o.cast });
  m.rotation.order = 'YXZ'; m.rotation.set((K.flip ? -1 : 1) * (o.rx || 0), K.wry(o.ry), o.rz || 0);
  if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
  return m;
}
/** reverse a geometry's facing so a single-sided material shows its other side */
function flipGeo(g) {
  if (g.index) { const ix = g.index; for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, a); } }
  const nr = g.attributes.normal; if (nr) for (let i = 0; i < nr.count; i++) nr.setXYZ(i, -nr.getX(i), -nr.getY(i), -nr.getZ(i));
  return g;
}
/** a rod between two LOCAL points a = [x, y, z] and b (visual only) */
function rod(K, surf, r, a, b, seg = 6) {
  const [ax, az] = K.toWorld(a[0], a[2]), [bx, bz] = K.toWorld(b[0], b[2]);
  const d = new THREE.Vector3(bx - ax, b[1] - a[1], bz - az), L = d.length(); if (L < 1e-3) return null;
  const m = M.add(statics(K), M.cyl(r, r, 1, seg), mat(surf), (ax + bx) / 2 - K.mon.x, (a[1] + b[1]) / 2, (az + bz) / 2 - K.mon.z, { cast: false });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); m.scale.y = L;
  return m;
}
/** invisible collider (the kit registers it, the mesh is dropped) */
function block(K, x, z, w, d, h, o = {}) { const m = K.box(x, z, w, d, h, 'concrete', Object.assign({ cast: false }, o)); if (m && m.parent) m.parent.remove(m); }
/** visual-only box */
const vbox = (K, x, z, w, d, h, surf, y = 0) => K.box(x, z, w, d, h, surf, { y, collide: false, cast: false });
/** chain-link fence line with gaps [[lo,hi],...] along its axis */
function fenceLine(K, x0, z0, x1, z1, gaps = [], h = 2.4) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
  let cur = a0;
  const run = (s, e) => { if (e - s < 0.5) return; if (alongX) K.fence(s, c, e, c, h, { wire: false }); else K.fence(c, s, c, e, h, { wire: false });
    const m = (s + e) / 2; if (alongX) K.box(m, c, e - s, 0.04, 0.04, '#6a6e72', { y: h + 0.03, collide: false }); else K.box(c, m, 0.04, e - s, 0.04, '#6a6e72', { y: h + 0.03, collide: false }); };
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { run(cur, g0); cur = g1; }
  run(cur, a1);
}
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
const dcrate = (K, x, z, s = 0.9, surf = 'plank', y = 0) => K.box(x, z, s, s, s, surf, { y, collide: y < 0.5 });
const lamp = (K, x, z, rq = 0) => K.prop('lamp', x, z, rq);
function flood(K, x, z, rq = 0, range = 16) { K.deployModel('floodlight', x, z, rq); K.light(x, z, 2.4, '#fff2d8', 1.4, range); }
function fire(K, x, z, i = 1.5) { K.deployModel('campfire', x, z); K.light(x, z, 1.1, '#ff9a40', i, 10); }
/** a wall run along x or z with gaps [[a0, a1], ...]; y = the storey's floor height (lintels over narrow gaps) */
function wallRun(K, axis, fixed, from, to, y, h, surf, gaps = [], t = 0.3) {
  const cuts = [[from, from]].concat(gaps.slice().sort((a, b) => a[0] - b[0])).concat([[to, to]]);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i][1], b = cuts[i + 1][0]; if (b - a < 0.05) continue;
    const mid = (a + b) / 2, len = b - a;
    if (axis === 'x') K.box(mid, fixed, len, t, h, surf, { y }); else K.box(fixed, mid, t, len, h, surf, { y });
  }
  for (const [a, b] of gaps) if (b - a < 3.2 && h > 2.6) { const mid = (a + b) / 2; if (axis === 'x') K.box(mid, fixed, b - a, t, h - 2.3, surf, { y: y + 2.3, collide: false }); else K.box(fixed, mid, t, b - a, h - 2.3, surf, { y: y + 2.3, collide: false }); }
}
/** a wall run with door gaps and window gaps (sill to 1.0 m, glass, head from 2.1 m) */
function wallWin(K, axis, fixed, from, to, y, h, surf, doors = [], wins = [], t = 0.3) {
  wallRun(K, axis, fixed, from, to, y, h, surf, doors.concat(wins), t);
  for (const [a, b] of wins) {
    const mid = (a + b) / 2, L = b - a, bx = (hh, yy, s, o) => axis === 'x' ? K.box(mid, fixed, L, t, hh, s, Object.assign({ y: yy }, o)) : K.box(fixed, mid, t, L, hh, s, Object.assign({ y: yy }, o));
    bx(1.0, y, surf, { opaque: false }); bx(h - 2.1, y + 2.1, surf, { collide: false });
    if (axis === 'x') vbox(K, mid, fixed, L, 0.05, 1.1, M.mat('#9cc4d4', { transparent: true, opacity: 0.28 }), y + 1.0); else vbox(K, fixed, mid, 0.05, L, 1.1, M.mat('#9cc4d4', { transparent: true, opacity: 0.28 }), y + 1.0);
  }
}

// ---------------------------------------------------------------- frames: build a module turned / moved inside the site
/**
 * A sub-frame of the site: everything built through F lands offset by (ox, oz) and turned k quarter-turns
 * (+X toward +Z). Only the calls listed here exist on a frame, so a module can't silently skip the transform.
 */
function frame(K, ox, oz, k = 0) {
  k = ((k % 4) + 4) % 4; K.late = K.late || [];
  const P = (x, z) => { for (let i = 0; i < k; i++) [x, z] = [-z, x]; return [x + ox, z + oz]; };
  const S = (w, d) => (k & 1 ? [d, w] : [w, d]);
  const DIR = ['+x', '+z', '-x', '-z'], D = d => DIR[(DIR.indexOf(d) + k) % 4];
  const SIDE = { n: 0, e: 1, s: 2, w: 3 }, SN = ['n', 'e', 's', 'w'];
  const door = dr => { let s = dr.side, a = dr.at ?? 0; for (let i = 0; i < k; i++) { if (s === 'e' || s === 'w') a = -a; s = SN[(SIDE[s] + 1) % 4]; } return Object.assign({}, dr, { side: s, at: a }); };
  return {
    R: K.R, mon: K.mon, rot: K.rot, baseY: K.baseY, group: K.group, flip: K.flip, variant: K.variant, late: K.late, pick: K.pick, label: K.label, safe: K.safe,
    P, k,
    toWorld: (x, z) => K.toWorld(...P(x, z)), wry: ry => K.wry((ry || 0) + k * Q), yAt: (x, z) => K.yAt(...P(x, z)),
    ground: (x, z, w, d, s, o) => K.ground(...P(x, z), ...S(w, d), s, o),
    box: (x, z, w, d, h, s, o) => K.box(...P(x, z), ...S(w, d), h, s, o),
    cyl: (x, z, r, h, s, o) => K.cyl(...P(x, z), r, h, s, o),
    floor: (x, z, w, d, y, s, o) => K.floor(...P(x, z), ...S(w, d), y, s, o),
    stairs: (x, z, w, len, y0, y1, dir, s, o) => K.stairs(...P(x, z), w, len, y0, y1, D(dir), s, o),
    prop: (t, x, z, rq = 0, o) => K.prop(t, ...P(x, z), rq + k * Q, o),
    container: (t, x, z, ry = 0, o) => K.container(t, ...P(x, z), ry + k * Q, o),
    npc: (kind, x, z, o = {}) => K.npc(kind, ...P(x, z), o.patrol ? Object.assign({}, o, { patrol: o.patrol.map(p => P(p[0], p[1])) }) : o),
    light: (x, z, ...a) => K.light(...P(x, z), ...a),
    deployModel: (t, x, z, ry = 0) => K.deployModel(t, ...P(x, z), ry + k * Q),
    freeAt: (x, z, r) => K.freeAt(...P(x, z), r),
    fusebox: (x, z, ry = 0, id) => K.fusebox(...P(x, z), ry + k * Q, id),
    lever: (x, z, ry = 0, id) => K.lever(...P(x, z), ry + k * Q, id),
    water: (x, z) => K.water(...P(x, z)), node: (t, x, z) => K.node(t, ...P(x, z)), veg: (t, x, z, s) => K.veg(t, ...P(x, z), s), rad: (x, z, r, p) => K.rad(...P(x, z), r, p),
    fence: (x0, z0, x1, z1, h, o) => K.fence(...P(x0, z0), ...P(x1, z1), h, o),
    room: o => { const [x, z] = P(o.x, o.z), [w, d] = S(o.w, o.d); const r = K.room(Object.assign({}, o, { x, z, w, d, doors: (o.doors || []).map(door), windows: (o.windows || []).map(door) })); return Object.assign({}, r, { x: o.x, z: o.z, w: o.w, d: o.d }); },
  };
}

// ---------------------------------------------------------------- walkways
/** railing along a deck edge at height y: posts + two bars, and an invisible 1.05 m collider (raised: only blocks people up there) */
function rail(K, x0, z0, x1, z1, y, surf = 'yellow_paint') {
  const ax = Math.abs(x1 - x0) >= Math.abs(z1 - z0), L = ax ? Math.abs(x1 - x0) : Math.abs(z1 - z0); if (L < 0.15) return;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  vbox(K, cx, cz, ax ? L : 0.06, ax ? 0.06 : L, 0.06, surf, y + 0.98);
  vbox(K, cx, cz, ax ? L : 0.04, ax ? 0.04 : L, 0.04, surf, y + 0.5);
  const n = Math.max(1, Math.round(L / 1.6));
  for (let i = 0; i <= n; i++) { const t = i / n; vbox(K, lerp(x0, x1, t), lerp(z0, z1, t), 0.07, 0.07, 1.0, surf, y); }
  block(K, cx, cz, ax ? L : 0.12, ax ? 0.12 : L, 1.05, { y, opaque: false });
}
/**
 * a raised deck (slab top at y, w along x, d along z) with railings on its edges, except the spans in
 * o.open = { n: [[a0, a1]], ... } (absolute coordinates along the edge) and the sides named in o.bare ('nse...');
 * support posts at the corners down to the ground (o.posts = [] for none, or a list of [x, z]).
 */
function deck(K, x, z, w, d, y, o = {}) {
  const t = o.t ?? 0.22, rs = o.rail || 'yellow_paint';
  K.floor(x, z, w, d, y, o.surf || 'metal_dark', { t });
  const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, bare = o.bare || '', open = o.open || {};
  const edge = (side, fixed, a0, a1, alongX) => {
    if (bare.includes(side)) return;
    let cur = a0;
    for (const [g0, g1] of (open[side] || []).slice().sort((p, q) => p[0] - q[0]).concat([[a1, a1]])) {
      const e = Math.min(g0, a1); if (e - cur > 0.15) { if (alongX) rail(K, cur, fixed, e, fixed, y, rs); else rail(K, fixed, cur, fixed, e, y, rs); }
      cur = Math.max(cur, g1);
    }
  };
  edge('n', z0, x0, x1, true); edge('s', z1, x0, x1, true); edge('w', x0, z0, z1, false); edge('e', x1, z0, z1, false);
  if (o.toe !== false) for (const [ex, ez, ew, ed] of [[x, z0, w, 0.04], [x, z1, w, 0.04], [x0, z, 0.04, d], [x1, z, 0.04, d]]) vbox(K, ex, ez, ew, ed, 0.12, o.toeSurf || 'yellow_paint', y);
  const posts = o.posts ?? [[x0 + 0.15, z0 + 0.15], [x1 - 0.15, z0 + 0.15], [x0 + 0.15, z1 - 0.15], [x1 - 0.15, z1 - 0.15]];
  for (const [px, pz] of posts) K.box(px, pz, 0.22, 0.22, y - t, o.postSurf || 'metal_dark');
}
/**
 * a stair flight with guards: invisible blockers along its sides from ~0.55 m up to the top (nobody walks into the
 * side of the flight, under it or off it) and a sloped handrail on each guarded side. o.guard = sides to guard
 * (-1 = the -z / -x side, 1 = the other), default both. A flight starting on the ground guards from the ground up.
 */
function flight(K, x, z, w, len, y0, y1, dir, o = {}) {
  K.stairs(x, z, w, len, y0, y1, dir, o.surf || 'metal_dark', { side: o.side || 'metal_dark', sides: o.sides });
  const ax = dir[1] === 'x', sg = dir[0] === '-' ? -1 : 1, rise = y1 - y0;
  const a0 = -len / 2 + len * Math.min(0.8, 0.55 / rise), a1 = len / 2;
  const P = (along, side) => ax ? [x + along * sg, z + side] : [x + side, z + along * sg];
  const raised = y0 >= 1.75, rs = o.railSurf || 'yellow_paint';
  for (const s of (o.guard || [-1, 1])) {
    const off = s * (w / 2 + 0.07), [gx, gz] = P((a0 + a1) / 2, off);
    block(K, gx, gz, ax ? a1 - a0 : 0.12, ax ? 0.12 : a1 - a0, (raised ? rise : y1) + 1.05, raised ? { y: y0, opaque: false } : { opaque: false });
    if (o.rails !== false) {
      const [bx, bz] = P(-len / 2, off), [tx, tz] = P(len / 2, off);
      rod(K, rs, 0.035, [bx, y0 + 0.95, bz], [tx, y1 + 0.95, tz], 5);
      for (const t of [0.04, 0.5, 0.96]) { const [px, pz] = P(lerp(-len / 2, len / 2, t), off); vbox(K, px, pz, 0.06, 0.06, 0.95, rs, lerp(y0, y1, t)); }
    }
  }
}
/** an X brace in a vertical plane between two posts (visual) */
function xbrace(K, ax, az, bx, bz, y0, y1, surf = 'metal_dark') { rod(K, surf, 0.045, [ax, y0, az], [bx, y1, bz], 5); rod(K, surf, 0.045, [bx, y0, bz], [ax, y1, az], 5); }
/** a red aircraft-warning beacon light */
function beacon(K, x, z, y) { vis(K, M.sphere(0.16, 8, 6), M.mat('#ff3a2a', { emissive: '#ff2a1a', emissiveIntensity: 1.2 }), x, y, z); K.light(x, z, y, '#ff4a3a', 0.9, 12); }

// ---------------------------------------------------------------- module: open steel platform tower
/**
 * An 8 x 8 m steel tower centred on (0, 0) of frame F with decks at 3.4 / 6.8 (/ 10.2): an outside flight up the
 * east face to a corner landing (x 4..5.5, z -4..-2.5), then flights inside the north band (L1 -> L2, rising -x)
 * and the south band (L2 -> L3, rising +x), each under a hole in the deck above. o.mast puts the lattice mast
 * through the middle; o.open = side of landing A left open for a bridge ('e' | 'n'); o.cabin closes the top deck
 * into a watch cabin (no mast); o.canopy roofs the top deck. Returns the deck heights.
 */
function steelTower(F, o = {}) {
  const n = o.levels ?? 3, L = [3.4, 6.8, 10.2].slice(0, n), top = L[n - 1], Y = o.rail || 'yellow_paint', S = o.deck || 'metal_dark';
  const legTop = top + (o.canopy || o.cabin ? 2.75 : 1.1);
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) F.box(x, z, 0.3, 0.3, legTop, o.leg || 'metal_dark');
  for (const [x, z] of [[0, -4], [0, 4], [-4, 0], [4, 0]]) F.box(x, z, 0.22, 0.22, top, o.leg || 'metal_dark');
  // bracing: knee braces at the ground, X braces between decks
  for (const [x, z, dx, dz] of [[-4, -4, 1, 0], [4, -4, -1, 0], [-4, 4, 1, 0], [4, 4, -1, 0], [-4, -4, 0, 1], [4, -4, 0, 1], [-4, 4, 0, -1], [4, 4, 0, -1]]) rod(F, o.leg || 'metal_dark', 0.05, [x, 2.2, z], [x + dx * 1.4, 3.2, z + dz * 1.4], 5);
  for (let i = 0; i < n - 1; i++) for (const [ax, az, bx, bz] of [[-4, -4, 0, -4], [0, -4, 4, -4], [-4, 4, 0, 4], [0, 4, 4, 4], [-4, -4, -4, 0], [-4, 0, -4, 4], [4, -4, 4, 0], [4, 0, 4, 4]]) xbrace(F, ax, az, bx, bz, L[i] + 0.1, L[i + 1] - 0.3, o.leg || 'metal_dark');
  // flight A: ground -> L1 up the outside of the east face, onto landing A
  flight(F, 4.75, 0.5, 1.3, 6, 0, 3.4, '-z', { railSurf: Y });
  deck(F, 4.75, -3.25, 1.5, 1.5, 3.4, { surf: S, rail: Y, bare: 'sw', open: o.open === 'e' ? { e: [[-4, -2.5]] } : o.open === 'n' ? { n: [[4, 5.5]] } : {}, posts: [[5.35, -3.9]] });
  // L1: the whole square; the north band carries flight B (its guards are the rail there), the east edge is guard A
  F.floor(0, 0, 8, 8, 3.4, S, { t: 0.22 });
  rail(F, -4, 4, 4, 4, 3.4, Y); rail(F, -4, -4, -4, 4, 3.4, Y); rail(F, 4, 2.5, 4, 4, 3.4, Y);
  rail(F, -4, -4, -2.6, -4, 3.4, Y); rail(F, 2.45, -4, 4, -4, 3.4, Y);
  flight(F, 0.4, -3.25, 1.3, 6, 3.4, 6.8, '-x', { railSurf: Y });
  // L2: main deck + landing B (north-west), hole over flight B
  F.floor(0, 0.75, 8, 6.5, 6.8, S, { t: 0.22 }); F.floor(-3.3, -3.25, 1.4, 1.5, 6.8, S, { t: 0.22 });
  rail(F, -2.6, -2.5, 4, -2.5, 6.8, Y); rail(F, -4, -4, -4, 4, 6.8, Y); rail(F, -4, -4, -2.6, -4, 6.8, Y); rail(F, 4, -2.5, 4, 4, 6.8, Y);
  if (n === 2) {
    if (!o.cabin) rail(F, -4, 4, 4, 4, 6.8, Y);
  } else {
    rail(F, -4, 4, -2.45, 4, 6.8, Y); rail(F, 2.6, 4, 4, 4, 6.8, Y);
    flight(F, -0.4, 3.25, 1.3, 6, 6.8, 10.2, '+x', { railSurf: Y });
    // L3: main deck + landing C (south-east), hole over flight C
    F.floor(0, -0.75, 8, 6.5, 10.2, S, { t: 0.22 }); F.floor(3.3, 3.25, 1.4, 1.5, 10.2, S, { t: 0.22 });
    rail(F, -4, 2.5, 2.6, 2.5, 10.2, Y); rail(F, -4, -4, 4, -4, 10.2, Y); rail(F, -4, -4, -4, 2.5, 10.2, Y); rail(F, 4, -4, 4, 4, 10.2, Y); rail(F, 2.6, 4, 4, 4, 10.2, Y);
  }
  if (o.mast) { F.prop('antenna', 0, 0, 0); beacon(F, 0, 0, 22.9); beacon(F, 0.7, 0, 12.2); }
  if (o.canopy) { vbox(F, 0, 0, 8.6, 8.6, 0.14, o.canopy, top + 2.75); vbox(F, 0, 0, 8.2, 0.14, 0.4, 'metal_dark', top + 2.4); }
  if (o.cabin) { // a watch cabin over the main L2 deck (x -4..4, z -2.5..4), entered from landing B
    const y = 6.8, h = 2.75, wall = o.cabin;
    wallWin(F, 'x', 4, -4, 4, y, h, wall, [], [[-3, -0.6], [0.6, 3]], 0.2);
    wallWin(F, 'z', 4, -2.5, 4, y, h, wall, [], [[-1, 2.4]], 0.2);
    wallWin(F, 'z', -4, -2.5, 4, y, h, wall, [], [[-0.6, 2.6]], 0.2);
    wallRun(F, 'x', -2.5, -2.6, 4, y, h, wall, [], 0.2);
    vbox(F, -3.3, -2.5, 1.4, 0.2, 0.45, wall, y + 2.3); // door head over the landing
    vbox(F, 0, 0.75, 8.6, 7.2, 0.25, o.roof || 'corrugated_rust', y + h); vbox(F, 0, 0.75, 8.8, 0.2, 0.3, 'metal_dark', y + h - 0.1);
  }
  for (let i = 0; i < n; i++) F.light(-2, 2, L[i] + 2.4, '#ffe6b8', 0.7, 8);
  return L;
}

// ---------------------------------------------------------------- module: two-storey building
/**
 * A two-storey building w x d centred on (0, 0) of frame F (w >= 8.2). An inside flight along the north wall rises
 * +x to the upper floor (F1); with o.roofStair a second flight along the south wall rises -x to a walkable roof with a
 * parapet. o.doors1 / o.wins1 / o.doors2 / o.wins2 = { n: [[a0, a1]], s, e, w } gaps along each wall (absolute
 * along-wall coordinates). Returns { F1, ROOF, x0, x1, z0, z1, xb, xt } (the flight runs xb..xt in the north strip).
 */
function house2(F, o) {
  const w = o.w, d = o.d, F1 = o.F1 ?? 3.4, h2 = o.h2 ?? 3.2, ROOF = F1 + h2, wall = o.wall || 'concrete', wall2 = o.wall2 || wall, trim = o.trim || 'concrete_dark';
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2, D1 = o.doors1 || {}, W1 = o.wins1 || {}, D2 = o.doors2 || {}, W2 = o.wins2 || {};
  F.ground(0, 0, w, d, o.floor || 'tile', { y: 0.06, t: 0.12 });
  const walls = (y, h, s, D, Wn) => {
    wallWin(F, 'x', z0, x0 - 0.15, x1 + 0.15, y, h, s, D.n || [], Wn.n || []); wallWin(F, 'x', z1, x0 - 0.15, x1 + 0.15, y, h, s, D.s || [], Wn.s || []);
    wallWin(F, 'z', x0, z0 + 0.15, z1 - 0.15, y, h, s, D.w || [], Wn.w || []); wallWin(F, 'z', x1, z0 + 0.15, z1 - 0.15, y, h, s, D.e || [], Wn.e || []);
  };
  walls(0, F1, wall, D1, W1); walls(F1, h2, wall2, D2, W2);
  vbox(F, 0, z0, w + 0.4, 0.4, 0.3, trim, F1 - 0.1); vbox(F, 0, z1, w + 0.4, 0.4, 0.3, trim, F1 - 0.1); vbox(F, x0, 0, 0.4, d + 0.4, 0.3, trim, F1 - 0.1); vbox(F, x1, 0, 0.4, d + 0.4, 0.3, trim, F1 - 0.1);
  // inside flight (north strip) and the upper floor round its hole
  const zs = z0 + 0.85, xb = x0 + 1.25, xt = xb + 5.4, hs = z0 + 1.6;
  flight(F, (xb + xt) / 2, zs, 1.3, 5.4, 0, F1, '+x', { guard: [1], surf: o.stair || 'concrete_dark', railSurf: 'metal_dark' });
  F.floor(0, (hs + z1) / 2, w, z1 - hs, F1, trim, { t: 0.3 });
  F.floor((x0 + xb) / 2, (z0 + hs) / 2, xb - x0, hs - z0, F1, trim, { t: 0.3 });
  F.floor((xt + x1) / 2, (z0 + hs) / 2, x1 - xt, hs - z0, F1, trim, { t: 0.3 });
  rail(F, xb, hs, xt, hs, F1, 'metal_dark'); rail(F, xb, z0 + 0.15, xb, hs, F1, 'metal_dark');
  // roof: walkable with a parapet when there's a roof flight, else a plain slab
  if (o.roofStair) {
    const zr = z1 - 0.85, rb = x1 - 1.25, rt = rb - 5.2, hr = z1 - 1.6;
    flight(F, (rb + rt) / 2, zr, 1.3, 5.2, F1, ROOF, '-x', { guard: [-1], surf: o.stair || 'concrete_dark', railSurf: 'metal_dark' });
    F.floor(0, (z0 + hr) / 2, w, hr - z0, ROOF, o.roof || 'concrete_dark', { t: 0.3 });
    F.floor((x0 + rt) / 2, (hr + z1) / 2, rt - x0, z1 - hr, ROOF, o.roof || 'concrete_dark', { t: 0.3 });
    F.floor((rb + x1) / 2, (hr + z1) / 2, x1 - rb, z1 - hr, ROOF, o.roof || 'concrete_dark', { t: 0.3 });
    rail(F, rt, hr, rb, hr, ROOF, 'metal_dark'); rail(F, rb, hr, rb, z1 - 0.15, ROOF, 'metal_dark');
    for (const [x, z, ww, dd] of [[0, z0, w + 0.3, 0.3], [0, z1, w + 0.3, 0.3], [x0, 0, 0.3, d + 0.3], [x1, 0, 0.3, d + 0.3]]) F.box(x, z, ww, dd, 1.0, trim, { y: ROOF });
    vbox(F, (rb + rt) / 2, zr, 5.6, 1.7, 0.08, 'metal_dark', ROOF + 2.3); // a little cover over the roof hatch
    for (const x of [rt, rb]) F.box(x, z1 - 0.15, 0.14, 0.14, 2.3, 'metal_dark', { y: ROOF });
  } else {
    vbox(F, 0, 0, w + 0.45, d + 0.45, 0.3, o.roof || 'concrete_dark', ROOF);
    for (const [x, z, ww, dd] of [[0, z0 - 0.1, w + 0.45, 0.25], [0, z1 + 0.1, w + 0.45, 0.25], [x0 - 0.1, 0, 0.25, d + 0.45], [x1 + 0.1, 0, 0.25, d + 0.45]]) vbox(F, x, z, ww, dd, 0.35, trim, ROOF + 0.3);
  }
  F.light(0, (hs + z1) / 2, F1 - 0.4, '#ffe2b0', 0.8, 9); F.light(0, (hs + z1) / 2, ROOF - 0.4, '#ffe2b0', 0.7, 9);
  return { F1, ROOF, x0, x1, z0, z1, xb, xt, hs };
}

// ---------------------------------------------------------------- small set pieces
/** small satellite dish on a pole: aims along local yaw `aim`, tilted up by `el` */
function smallDish(K, x, z, y0, h, aim, el = 0.55, r = 0.95) {
  if (y0 < 0.5) K.cyl(x, z, 0.09, h, 'metal_dark', { y: y0, seg: 8 }); else vis(K, M.cyl(0.09, 0.09, h, 8), 'metal_dark', x, y0 + h / 2, z);
  const D = new THREE.Vector3(Math.cos(el) * Math.cos(aim), Math.sin(el), Math.cos(el) * Math.sin(aim));
  const [wx, wz] = K.toWorld(x, z), [ex, ez] = K.toWorld(x + D.x, z + D.z);
  const Dw = new THREE.Vector3(ex - wx, D.y, ez - wz).normalize();
  const g = new THREE.SphereGeometry(r, 14, 4, 0, TAU, 0, 0.72); g.translate(0, -r * Math.cos(0.72), 0);
  const cy = y0 + h + 0.1;
  for (const gg of [g, flipGeo(g.clone())]) { const m = M.add(statics(K), gg, M.surf('white_paint'), wx - K.mon.x, cy, wz - K.mon.z); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), Dw); }
  const tip = [x + D.x * 0.75, cy + D.y * 0.75, z + D.z * 0.75];
  rod(K, 'metal_dark', 0.025, [x, cy, z], tip, 5); vis(K, M.box(0.14, 0.14, 0.14), 'metal_dark', tip[0], tip[1], tip[2]);
}
/** tilted solar panel row facing local +Z (south), w along X */
function solarRow(K, x, z, w) {
  block(K, x, z, w, 1.6, 1.5, { opaque: false });
  for (const sx of [-1, 1]) { vbox(K, x + sx * (w / 2 - 0.25), z + 0.55, 0.08, 0.08, 0.75, 'metal_dark'); vbox(K, x + sx * (w / 2 - 0.25), z - 0.55, 0.08, 0.08, 1.45, 'metal_dark'); }
  vbox(K, x, z - 0.55, w - 0.4, 0.08, 0.08, 'metal_dark', 1.35);
  vis(K, M.box(w, 0.05, 1.7), 'metal', x, 1.12, z, { rx: 0.5 });
  vis(K, M.box(w - 0.12, 0.05, 1.58), 'glass_dark', x, 1.14, z - 0.01, { rx: 0.5 });
  for (let s = -w / 2 + 1; s < w / 2 - 0.2; s += 1) vis(K, M.box(0.03, 0.06, 1.6), 'metal', x + s, 1.16, z - 0.01, { rx: 0.5 });
}
/** a row of equipment cabinets with status lamps (solid), along x */
function cabinets(K, x, z, n, y = 0, face = 1) {
  for (let i = 0; i < n; i++) {
    const cx = x + (i - (n - 1) / 2) * 0.75;
    K.box(cx, z, 0.7, 0.6, 1.9, i % 3 === 1 ? 'metal' : 'white_paint', { y });
    for (const [ly, c] of [[1.55, '#46e05a'], [1.4, i % 2 ? '#e8b040' : '#46e05a']]) vbox(K, cx - 0.15, z + face * 0.31, 0.08, 0.02, 0.06, c, y + ly);
    vbox(K, cx, z + face * 0.31, 0.5, 0.02, 0.9, 'metal_dark', y + 0.35);
  }
}
/** a warning sign on a post */
function sign(K, x, z, ry, txt = 'red_paint', post = true) {
  if (post) K.box(x, z, 0.1, 0.1, 1.6, 'metal_dark', { collide: false });
  vis(K, M.box(0.9, 0.6, 0.04), 'white_paint', x, 1.75, z, { ry }); vis(K, M.box(0.82, 0.14, 0.05), txt, x, 1.9, z, { ry });
}
/** pipe run between two local points at height y (visual) with flanges */
function pipe(K, x0, z0, x1, z1, y, r = 0.22, surf = 'metal') {
  rod(K, surf, r, [x0, y, z0], [x1, y, z1], 10);
  const L = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(L / 3);
  for (let i = 1; i < n; i++) { const t = i / n; rod(K, 'metal_dark', r + 0.05, [lerp(x0, x1, t) - (x1 - x0) / L * 0.05, y, lerp(z0, z1, t) - (z1 - z0) / L * 0.05], [lerp(x0, x1, t) + (x1 - x0) / L * 0.05, y, lerp(z0, z1, t) + (z1 - z0) / L * 0.05], 10); }
}

// ============================================================================
// RADIO OUTPOST — fenced hilltop relay (loot only). Two layouts:
//  0 relay tower: a three-deck steel tower wrapped round the lattice mast, a
//    cable bridge from its first landing into a two-storey comms house
//  1 listening post: the guyed mast stands alone; a stilted watch cabin on a
//    two-deck tower, a shack with a roof terrace, a container store
// The best loot is at the top (hidden stash + ammo).
// ============================================================================
function radioYard(K) {
  K.ground(0, 0, 30, 30, 'gravel', { y: 0.02 });
  K.ground(0, 17.5, 4.6, 7, 'dirt', { y: 0.02 });
  K.ground(0, 6.5, 3.6, 14, 'dirt', { y: 0.03 });
  fenceLine(K, -13.5, -13.5, 13.5, -13.5); fenceLine(K, -13.5, 13.5, 13.5, 13.5, [[-2.2, 2.2]]); fenceLine(K, -13.5, -13.5, -13.5, 13.5); fenceLine(K, 13.5, -13.5, 13.5, 13.5);
  for (const s of [-1, 1]) K.box(s * 2.45, 13.5, 0.5, 0.5, 2.7, 'concrete_dark');
  K.fence(2.9, 14.05, 7.1, 14.05, 2.2); K.box(7.4, 14.05, 0.16, 0.16, 2.3, 'metal_dark');
  vbox(K, -5, 13.63, 1.4, 0.04, 0.85, 'white_paint', 1.0); vbox(K, -5, 13.66, 1.4, 0.02, 0.2, 'red_paint', 1.55);
  // outside the fence: track, burnt car, barrels, rocky hilltop with ore
  K.prop('car', -7.5, 17.4, 0.2);
  K.container('barrel', 3.4, 16.4); K.container('barrel', 4.2, 17.1); K.container('barrel', -3.6, 19.2);
  K.prop('rock_big', -17.5, -8, 0); K.prop('rock_big', 17.5, -4, 0); K.prop('rock_big', -4, -18, 0);
  K.node('stone', -17.2, -2.6); K.node('metal', 17.4, 1.6); K.node('stone', 2.0, -18.0);
  for (const [k, x, z, s] of [['pine', 18, 10, 0.9], ['pine', -18.5, 9, 1], ['bush', -15, 14.5, 1], ['bush', 16, -13, 1], ['rock_small', -16, -12, 1.2], ['rock_small', 12, 17, 1.1], ['bush', 9, -17.5, 0.9]]) K.veg(k, x, z, s);
}
/** generator lean-to with fuel (2 oil barrels) */
function genLeanTo(K, x, z) {
  K.ground(x, z, 4.8, 3.6, 'concrete', { y: 0.035 });
  canopy(K, x, z, 4.4, 3.2, 2.4, 'corrugated_rust');
  K.prop('generator', x, z - 0.3, 0); K.prop('drums', x + 3.1, z - 1.5, 0);
  K.container('barrel_oil', x + 2.8, z + 1.1); K.container('barrel_oil', x + 3.8, z + 1.9);
  for (const dx of [-1.8, -1.35]) vbox(K, x + dx, z + 1.1, 0.35, 0.2, 0.45, 'red_paint');
  K.light(x, z, 2.2, '#ffe0b0', 0.8, 8);
}
function radio(K) {
  K.label('Radio Outpost');
  radioYard(K);
  const v = K.pick(2);
  if (v === 0) {
    // ---- the relay tower round the mast (tower centre -6, -5; landing A at x -2..-0.5, z -9..-7.5)
    const T = frame(K, -6, -5, 0);
    steelTower(T, { levels: 3, mast: true, open: 'e' });
    K.ground(-6, -5, 9, 9, 'concrete', { y: 0.035 });
    cabinets(T, -2, 2.6, 3, 0, -1); cabinets(T, 2.2, -2.4, 2, 0, 1);
    T.container('toolbox', -2.6, -2.6, 0); T.prop('cable_spool', 2.4, 2.3, 0);
    // top deck: the relay shelf, small dishes and the best loot
    cabinets(T, 2.2, -3.4, 2, 10.2, 1); smallDish(T, -3.4, -3.4, 10.2, 1.1, -2.4, 0.5, 0.8); smallDish(T, 3.4, 1.6, 10.2, 1.1, 0.4, 0.45, 0.8);
    T.container('cache', -2.6, -0.4, Q, { y: 10.2 }); T.container('ammobox', -2.8, 1.6, Q, { y: 10.2 });
    T.prop('pallets', 2.6, 2.6, 0, { y: 6.8 }); T.container('crate', 2.8, 0.6, Q, { y: 6.8 });
    // the cable bridge from landing A to the comms house (x -0.5..2, z -9..-7.5)
    deck(K, 0.75, -8.25, 2.5, 1.5, 3.4, { bare: 'ew', posts: [[0.75, -8.9], [0.75, -7.6]] });
    pipe(K, -0.5, -9.05, 2, -9.05, 3.1, 0.08, 'metal_dark'); pipe(K, -0.5, -8.9, 2, -8.9, 3.0, 0.06, '#2a2c30');
    // ---- the comms house: radio room + generator room below, bunk room above, door onto the bridge
    const H = frame(K, 6.5, -7, 0);
    const h = house2(H, { w: 9, d: 7, wall: 'white_paint', wall2: 'white_paint', trim: 'red_paint', floor: 'plank', roof: 'corrugated',
      doors1: { s: [[-3, -1.6]], e: [[-0.6, 0.8]] }, wins1: { s: [[0.8, 2.2]], w: [[0.2, 1.6]] },
      doors2: { w: [[-1.9, -0.6]] }, wins2: { s: [[-2.8, -1.2], [1.2, 2.8]], e: [[-0.6, 1.2]], n: [[2.6, 3.8]] } });
    wallRun(H, 'z', 1.2, h.hs, 3.35, 0, 3.4, 'plank_dark', [[0.2, 1.6]], 0.2); // radio room | generator room
    H.prop('desk', -0.6, 2.75, PI); vbox(H, -0.6, 2.9, 0.7, 0.4, 0.32, 'metal_dark', 0.79); vbox(H, -0.6, 2.69, 0.5, 0.02, 0.1, '#e8b040', 0.95);
    cabinets(H, 0.2, -1.4, 2, 0, 1); // under the stair
    H.container('crate', -3.8, 2.8, 0); H.container('food', -3.8, 0.6, Q);
    H.prop('generator', 3.0, 2.4, 0); H.container('toolbox', 3.9, -1.4, Q);
    H.prop('bunkbed', 2.6, 2.7, 0, { y: 3.4 }); H.prop('table', -1.2, 1.4, 0, { y: 3.4 });
    H.container('locker', 3.95, 0.6, -Q, { y: 3.4 }); H.container('medbox', -3.7, 2.9, 0, { y: 3.4 });
    smallDish(H, 3.2, -2.6, 6.9, 0.9, 0.6, 0.6, 1.05); smallDish(H, -3.2, 2.4, 6.9, 0.7, 2.6, 0.5, 0.7);
    rod(H, 'metal_dark', 0.03, [-3.8, 6.9, -2.8], [-3.8, 10.4, -2.8], 5); rod(H, 'metal_dark', 0.02, [-3.2, 6.9, -3.0], [-3.2, 8.6, -3.0], 5);
    lamp(K, 1.8, -1.6, 0);
    // yard: generator lean-to, solar rows, water barrel, a ground dish
    genLeanTo(K, 8.5, 4.5);
    solarRow(K, -7, 6.5, 5.5); solarRow(K, -7, 10.0, 5.5);
    K.box(-11.7, 8.2, 1.0, 1.6, 1.0, 'white_paint'); vbox(K, -11.7, 8.2, 0.9, 1.5, 0.06, 'metal_dark', 1.0);
    K.deployModel('water_barrel', 3.6, 1.6); block(K, 3.6, 1.6, 0.9, 0.9, 1.05); K.water(3.6, 1.6);
    smallDish(K, 4.2, 9.6, 0, 1.7, -2.2, 0.6, 1.2);
    K.prop('cable_spool', -1.6, 10.6, 0); K.prop('pallets', 11.6, -1.2, 0); dcrate(K, 11.2, 0.6, 0.9); dcrate(K, 11.2, 0.6, 0.7, 'plank_dark', 0.9);
    flood(K, 3.4, 11.7, 0, 14);
  } else {
    // ---- the guyed mast stands alone (north-east)
    K.ground(6, -7, 6.5, 6.5, 'concrete', { y: 0.035 });
    K.prop('antenna', 6, -7, 0); beacon(K, 6, -7, 22.9);
    for (const [ax, az] of [[12, -11], [0.5, -11.5], [6, -0.5]]) {
      K.box(ax, az, 0.9, 0.9, 0.45, 'concrete'); vis(K, M.box(0.12, 0.5, 0.12), 'metal_dark', ax, 0.7, az);
      const dx = ax - 6, dz = az + 7, L = Math.hypot(dx, dz);
      for (const [y, hw] of [[12, 0.62], [18.5, 0.42]]) rod(K, '#3a3d42', 0.022, [6 + dx / L * hw, y, -7 + dz / L * hw], [ax, 0.9, az], 4);
    }
    cabinets(K, 9.4, -4.2, 3, 0, 1);
    // ---- stilted watch cabin (two decks, the cabin up top), west side
    const T = frame(K, -6.5, -5, 0);
    steelTower(T, { levels: 2, cabin: 'corrugated_green', roof: 'corrugated_rust' });
    K.ground(-6.5, -5, 9, 9, 'gravel', { y: 0.03 });
    T.prop('desk', 1.2, 3.3, PI, { y: 6.8 }); vbox(T, 1.2, 3.45, 0.7, 0.4, 0.32, 'metal_dark', 7.59); vbox(T, 0.9, 3.2, 0.3, 0.02, 0.1, '#46e05a', 7.75);
    T.prop('bunkbed', -2.9, 2.9, 0, { y: 6.8 }); cabinets(T, 3.1, 0.2, 1, 6.8, -1);
    T.container('cache', 2.9, -1.6, Q, { y: 6.8 }); T.container('ammobox', -3.2, 0.4, Q, { y: 6.8 });
    T.container('crate', 2.8, 2.8, 0, { y: 3.4 }); T.prop('pallets', -2.8, 2.8, 0, { y: 3.4 });
    T.prop('generator', -1.8, 2.4, 0); T.container('toolbox', 2.4, 2.6, 0);
    smallDish(T, -3.4, 3.4, 9.55, 0.6, 2.2, 0.5, 0.75);
    // ---- the comms shack: one storey, a roof terrace reached by an outside stair
    const S = frame(K, 5.5, 6.5, 0);
    S.room({ x: 0, z: 0, w: 8, d: 5, h: 3.4, wall: 'white_paint', roof: 'concrete_dark', trim: 'red_paint', floor: 'plank', roofProps: false,
      doors: [{ side: 'n', at: -1.8, w: 1.5 }], windows: [{ side: 'n', at: 1.8, w: 1.4 }, { side: 'e', w: 1.2 }, { side: 's', at: -1, w: 1.4 }] });
    S.prop('desk', 0.6, 1.7, PI); cabinets(S, 2.6, 1.85, 2, 0, -1); S.prop('bunkbed', -2.8, 1.6, 0);
    S.container('locker', 3.55, -1.6, -Q); S.container('food', -3.4, -1.5, 0); S.container('medbox', -0.6, 1.95, 0);
    // the roof terrace (the room's roof slab tops out at 3.7): parapet, open where the outside stair arrives
    const RT = 3.7;
    S.floor(0, 0, 8, 5, RT, 'concrete_dark', { visual: false });
    for (const [x, z, w, d] of [[0, -2.5, 8, 0.2], [0, 2.5, 8, 0.2], [4, 0, 0.2, 5], [-4, 1.25, 0.2, 2.5]]) S.box(x, z, w, d, 1.0, 'white_paint', { y: RT });
    flight(S, -4.75, 2.4, 1.3, 5, 0, RT, '-z', { railSurf: 'red_paint' });
    S.floor(-4.75, -1.3, 1.5, 2.4, RT, 'concrete_dark'); rail(S, -5.5, -2.5, -5.5, -0.1, RT, 'red_paint'); rail(S, -5.5, -2.5, -4, -2.5, RT, 'red_paint');
    S.prop('sandbags', 2.9, 0.2, Q, { y: RT }); S.prop('sandbags', 2.2, -1.5, 0, { y: RT }); S.prop('sandbags', 2.2, 1.9, 0, { y: RT });
    smallDish(S, -2.2, 1.4, RT, 1.2, 1.2, 0.6, 1.0); S.container('crate', -1.6, -1.3, 0, { y: RT });
    for (const x of [-3, 3]) vbox(S, x, 2.4, 0.08, 0.08, 1.4, 'metal_dark', RT);
    // ---- container store and the generator
    K.prop('container', -8, 9.5, 0, { color: '#5a7048' }); K.prop('container', -8, 9.5, 0, { y: 2.6, collide: false, color: '#3e6a8e' });
    genLeanTo(K, -4.5, 3.2);
    solarRow(K, 10.5, 1.0, 4.0);
    K.deployModel('water_barrel', 10.6, 10.4); block(K, 10.6, 10.4, 0.9, 0.9, 1.05); K.water(10.6, 10.4);
    K.prop('cable_spool', 1.4, -1.0, 0); K.prop('pallets', -11.6, 1.2, 0);
    flood(K, -2.2, 11.7, 0, 14); lamp(K, 1.6, 2.6, 0);
  }
}

// ============================================================================
// LIGHTHOUSE — the tower is climbable: a door at the foot, a square spiral
// stair round a stone core (8 flights, 11.2 m) to the watch room, a gallery
// all round outside, the lantern on top. Two settings:
//  0 keeper's station: two-storey keeper's house, boathouse with a slipway,
//    pier and boat
//  1 wreck cove: a coaster run aground on the beach (in through the torn hull
//    or up the gangway to the deck and wheelhouse), the keeper's cottage burnt
//    out, salvagers' camp
// ============================================================================
/** the lighthouse tower, centred on (0, 0) of frame F, door in the south wall. Returns the top floor height. */
function lighthouseTower(F, o = {}) {
  const TOP = 11.2, LANT = 13.8, wallS = 'white_paint', band = o.band || 'red_paint';
  F.ground(0, 0, 7.4, 7.4, 'stone_dark', { y: 0.04 });
  F.box(0, 0, 3.0, 3.0, TOP, 'stone'); // the core
  // shell (ground-based walls up to the top floor), the door in the south wall
  F.box(0, -3.0, 6.4, 0.4, TOP, wallS); F.box(-3.0, 0, 0.4, 5.6, TOP, wallS); F.box(3.0, 0, 0.4, 5.6, TOP, wallS);
  F.box(-1.95, 3.0, 2.5, 0.4, TOP, wallS); F.box(1.95, 3.0, 2.5, 0.4, TOP, wallS); F.box(0, 3.0, 1.4, 0.4, TOP - 2.3, wallS, { y: 2.3 });
  vbox(F, 0, 3.25, 1.9, 0.12, 0.25, 'stone_dark', 2.3); vbox(F, 0, 3.4, 2.2, 0.8, 0.1, 'stone_dark', 0.0);
  // painted bands and slit windows
  for (const [y0, y1] of o.bands || [[3.0, 5.0], [7.4, 9.4]]) for (const [x, z, w, d] of [[0, -3.22, 6.48, 0.05], [0, 3.22, 6.48, 0.05], [-3.22, 0, 0.05, 6.48], [3.22, 0, 0.05, 6.48]]) vbox(F, x, z, w, d, y1 - y0, band, y0);
  for (const [x, z, w, d, y] of [[-3.23, 0.6, 0.04, 0.35, 2.0], [-1.2, -3.23, 0.35, 0.04, 3.4], [3.23, -0.8, 0.04, 0.35, 4.6], [1.0, 3.23, 0.35, 0.04, 6.4], [-3.23, -1.0, 0.04, 0.35, 7.6], [0.6, -3.23, 0.35, 0.04, 9.0], [3.23, 1.0, 0.04, 0.35, 10.0]]) vbox(F, x, z, w, d, 0.7, '#1c2228', y);
  // the spiral: flights between the corners (W -z, N +x, E +z, S -x), corner landings, twice round
  const seq = [[-2.15, 0, '-z', [-2.15, -2.15]], [0, -2.15, '+x', [2.15, -2.15]], [2.15, 0, '+z', [2.15, 2.15]], [0, 2.15, '-x', [-2.15, 2.15]]];
  for (let i = 0; i < 8; i++) {
    const [x, z, dir, [cx, cz]] = seq[i % 4], y0 = i * 1.4, y1 = y0 + 1.4;
    F.stairs(x, z, 1.3, 3.0, y0, y1, dir, 'stone_dark', { sides: false });
    if (i < 7) F.floor(cx, cz, 1.3, 1.3, y1, 'stone_dark', { t: 0.25 });
    // a handrail along the core and a lamp on the outer wall at each corner
    const ax = dir[1] === 'x', sg = dir[0] === '-' ? -1 : 1, hx = ax ? 0 : Math.sign(x) * 1.58, hz = ax ? Math.sign(z) * 1.58 : 0;
    rod(F, 'metal_dark', 0.03, [hx + (ax ? -1.5 * sg : 0), y0 + 0.95, hz + (ax ? 0 : -1.5 * sg)], [hx + (ax ? 1.5 * sg : 0), y1 + 0.95, hz + (ax ? 0 : 1.5 * sg)], 5);
    vbox(F, cx * 1.3, cz * 1.3, 0.22, 0.22, 0.3, M.mat('#ffe2a0', { emissive: '#ffcf7a', emissiveIntensity: 0.8 }), y1 + 1.9);
    if (i % 2 === 1) F.light(cx, cz, y1 + 1.9, '#ffd9a0', 0.55, 6);
  }
  F.box(2.15, 2.15, 1.3, 1.3, 2.6, 'stone_dark'); // the ground ring stops at the south-east corner (the flights climb overhead)
  // top floor (TOP): north strip, west side, south-west corner and the top of the core; the hole over the last flights
  F.floor(0, -2.15, 5.6, 1.3, TOP, 'plank_dark', { t: 0.25 }); F.floor(-2.15, 0.65, 1.3, 4.3, TOP, 'plank_dark', { t: 0.25 }); F.floor(0, 0, 3.0, 3.0, TOP, 'plank_dark', { t: 0.25 });
  rail(F, 1.5, -1.5, 1.5, 1.5, TOP, 'metal_dark'); rail(F, -1.5, 1.5, 1.5, 1.5, TOP, 'metal_dark'); rail(F, 1.5, -1.5, 2.8, -1.5, TOP, 'metal_dark');
  // watch room: low walls with big windows, a door onto the gallery in the west wall
  const wh = LANT - TOP;
  for (const [x, z, w, d] of [[0, -3.0, 6.4, 0.4], [0, 3.0, 6.4, 0.4], [3.0, 0, 0.4, 5.6]]) F.box(x, z, w, d, 1.0, wallS, { y: TOP });
  F.box(-3.0, -1.9, 0.4, 2.1, 1.0, wallS, { y: TOP }); F.box(-3.0, 1.9, 0.4, 2.1, 1.0, wallS, { y: TOP });
  for (const [x, z] of [[-3.0, -3.0], [3.0, -3.0], [-3.0, 3.0], [3.0, 3.0], [-3.0, -0.85], [-3.0, 0.85]]) F.box(x, z, 0.4, 0.4, wh, wallS, { y: TOP });
  vbox(F, -3.0, 0, 0.4, 1.3, wh - 2.2, wallS, TOP + 2.2);
  const glass = M.mat('#9cc4d4', { transparent: true, opacity: 0.3 });
  for (const [x, z, w, d] of [[0, -3.0, 5.6, 0.06], [0, 3.0, 5.6, 0.06], [3.0, 0, 0.06, 5.6], [-3.0, -1.9, 0.06, 2.1], [-3.0, 1.9, 0.06, 2.1]]) vbox(F, x, z, w, d, wh - 1.3, glass, TOP + 1.0);
  vbox(F, 0, 0, 6.8, 6.8, 0.3, 'metal_dark', LANT);
  // gallery all round outside, on brackets
  // (the gallery floors run in over the top of the shell walls, so the door threshold has a floor under it)
  F.floor(0, -3.6, 8.8, 1.6, TOP, 'metal_dark', { t: 0.2 }); F.floor(0, 3.6, 8.8, 1.6, TOP, 'metal_dark', { t: 0.2 });
  F.floor(-3.6, 0, 1.6, 5.6, TOP, 'metal_dark', { t: 0.2 }); F.floor(3.6, 0, 1.6, 5.6, TOP, 'metal_dark', { t: 0.2 });
  for (const [x0, z0, x1, z1] of [[-4.4, -4.4, 4.4, -4.4], [-4.4, 4.4, 4.4, 4.4], [-4.4, -4.4, -4.4, 4.4], [4.4, -4.4, 4.4, 4.4]]) rail(F, x0, z0, x1, z1, TOP, 'metal_dark');
  for (const s of [-1, 1]) for (const t of [-2.4, 0, 2.4]) { rod(F, 'metal_dark', 0.06, [s * 3.2, TOP - 1.4, t], [s * 4.2, TOP - 0.2, t], 5); rod(F, 'metal_dark', 0.06, [t, TOP - 1.4, s * 3.2], [t, TOP - 0.2, s * 4.2], 5); }
  // the lantern
  const lg = M.mat('#ffe9a8', { emissive: '#ffcf6a', emissiveIntensity: 0.6 });
  vis(F, M.cyl(2.2, 2.4, 0.5, 16), 'metal_dark', 0, LANT + 0.55, 0);
  vis(F, M.cyl(1.7, 1.7, 2.0, 12), lg, 0, LANT + 1.8, 0);
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; vbox(F, Math.cos(a) * 1.75, Math.sin(a) * 1.75, 0.1, 0.1, 2.0, 'metal_dark', LANT + 0.8); }
  vis(F, M.cyl(1.9, 1.9, 0.14, 12), band, 0, LANT + 2.87, 0);
  vis(F, new THREE.SphereGeometry(1.9, 12, 4, 0, TAU, 0, PI / 2), band, 0, LANT + 2.9, 0, { s: [1, 0.55, 1] });
  rod(F, 'metal_dark', 0.04, [0, LANT + 3.9, 0], [0, LANT + 5.0, 0], 5);
  F.light(0, 0, LANT + 1.8, '#fff1c0', 2.4, 34); F.light(0, 0, TOP + 2.2, '#ffd9a0', 0.8, 8);
  return TOP;
}
/** a simple pitched roof (visual) over a box room of w x d with walls h high, ridge along x */
function pitch(K, x, z, w, d, h, surf, gableSurf) {
  const hp = d / 2 + 0.35, rise = hp * 0.55, y0 = h + 0.3;
  const g = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rise * (d / 2) / hp)]), { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  vis(K, g, gableSurf, x, y0, z, { ry: Q });
  const a = Math.atan2(rise, hp), L = hp / Math.cos(a) + 0.1;
  for (const s of [-1, 1]) vis(K, M.box(w + 0.5, 0.12, L), surf, x, y0 + rise / 2, z + s * hp / 2, { rx: s * a });
  vis(K, M.box(w + 0.6, 0.16, 0.3), 'plank_dark', x, y0 + rise + 0.05, z);
}
function lighthouse(K) {
  K.label('Lighthouse');
  const v = K.pick(2);
  K.ground(-6, 0, 16, 18, 'gravel', { y: 0.02 });
  K.ground(6.6, 0, 5.2, 16, 'sand', { y: 0.02 }); // beach strip; the sea starts at ~9.9 m (0.55 x radius)
  K.ground(-3, 3.2, 2, 6.4, 'stone', { y: 0.04 });
  const T = frame(K, -3, -4.5, 0);
  lighthouseTower(T, { band: K.pick(3, 5) === 2 ? 'concrete_dark' : 'red_paint' });
  // top of the tower: the keeper's log, a stash and supplies
  T.prop('desk', 0.2, -2.25, 0, { y: 11.2 }); T.container('cache', -2.15, -0.4, Q, { y: 11.2 }); T.container('medbox', 1.6, -2.3, 0, { y: 11.2 });
  T.container('crate', 0, 3.85, 0, { y: 11.2 });
  // generator + fuel by the tower
  K.prop('generator', -9.4, -9.8, 0); K.container('barrel_oil', -11.4, -9.4); K.prop('drums', -8.6, -12.4, 0);
  if (v === 0) {
    // ---- keeper's house: kitchen below, bedroom above
    const H = frame(K, -9.6, 6.4, 0);
    const h = house2(H, { w: 8.4, d: 6.4, wall: 'plank', wall2: 'plank', trim: 'plank_dark', floor: 'plank', stair: 'plank_dark', roof: 'tile_dark',
      doors1: { e: [[0.2, 1.6]], n: [[2.4, 3.6]] }, wins1: { s: [[-2.8, -1.4], [1, 2.4]], w: [[-0.6, 0.8]] }, wins2: { s: [[-2.6, -1.2], [1.2, 2.6]], e: [[-0.4, 1]], w: [[-0.4, 1]] } });
    pitch(H, 0, 0, 8.4, 6.4, h.ROOF, 'corrugated_red', 'plank');
    H.prop('table', 0.4, 1.4, 0); H.prop('bench', 0.4, 2.3, 0); K.deployModel('furnace', -12.9, 8.2, 0); H.prop('shelf', -2.4, 2.85, 0);
    H.container('food', 3.5, 2.6, 0); H.container('crate', -3.6, 0.6, Q);
    H.prop('bunkbed', -2.6, 2.6, 0, { y: 3.4 }); H.container('locker', 3.75, 2.4, -Q, { y: 3.4 }); H.prop('table', 2.2, 0.4, 0, { y: 3.4 });
    K.prop('bench', -4.6, 4.4, Q); K.light(-5.0, 7.0, 2.6, '#ffcf8a', 0.8, 6);
    // boathouse on the beach: open to the sea, a slipway and a dinghy, loot along the back
    const B = frame(K, 5.4, 6.4, 0);
    B.room({ x: 0, z: 0, w: 6.4, d: 5.4, h: 3.0, wall: 'plank_dark', roof: 'corrugated_rust', floor: 'plank', roofProps: false, doors: [{ side: 'e', w: 4.6 }, { side: 'w', at: -1.2, w: 1.3 }] });
    B.ground(1.4, 0, 4.6, 2.6, 'plank_dark', { y: 0.08, t: 0.06 }); for (let i = 0; i < 6; i++) vbox(B, -0.6 + i * 0.8, 0, 0.12, 2.6, 0.06, 'log', 0.08);
    B.prop('workbench_old', -2.0, 2.15, 0); B.container('toolbox', -0.4, 2.2, 0); B.container('barrel', -2.6, -2.0); B.container('crate', -1.2, -2.0, 0);
    vis(B, M.sphere(1, 12, 6), 'blue_paint', 1.2, 0.35, 0, { s: [2.0, 0.42, 0.75] }); vbox(B, 1.2, 0, 3.2, 1.1, 0.08, 'plank', 0.62);
    B.light(0, 0, 2.6, '#ffcf8a', 0.8, 7);
    // pier + boat, lantern post
    K.prop('dock', 7.5, -3, 0); K.prop('dock', 13.5, -3, 0); K.prop('boat', 12.5, 2.0, PI);
    for (const x of [10.5, 15.0]) K.cyl(x, -5.6, 0.16, 0.55, 'metal_dark', { seg: 8 });
    K.deployModel('lantern', 16.0, -0.6); K.light(16.0, -0.6, 1.4, '#ffd080', 1.2, 9);
    K.container('barrel', 6.0, -6.8); K.container('crate', 7.6, -5.0, 0.3);
    K.prop('rock_big', 4.5, -12.5, 0); K.prop('rock_big', -3.5, 14.2, 0);
    lamp(K, 3.2, 1.6, 0);
  } else {
    // ---- a coaster aground on the beach: torn hull (walk in at the stern), deck at 2.6, wheelhouse aft
    const W = frame(K, 6.3, 3.0, 0); const DY = 2.6, y = DY, hh = 2.5;
    W.ground(0, -1.5, 5.6, 17.5, 'sand', { y: 0.025 });
    // hull: the port (land) side torn open at z -0.6..1.6, a bulkhead at the bow, the stern; rounded bow beyond
    W.box(-2.3, -4.3, 0.3, 7.4, DY, 'rust'); W.box(-2.3, 3.3, 0.3, 3.4, DY, 'rust'); W.box(-2.3, 0.5, 0.3, 2.2, 0.8, 'rust', { y: 1.8 });
    W.box(2.3, -1.5, 0.3, 13, DY, 'rust'); W.box(0, 5.0, 4.9, 0.3, DY, 'rust'); W.box(0, -8.0, 4.9, 0.3, DY, 'rust');
    const bow = new THREE.CylinderGeometry(2.45, 2.0, DY + 1.0, 12, 1, true, Q, PI);
    vis(W, bow, 'rust', 0, (DY + 1.0) / 2, -8.0); vis(W, flipGeo(bow.clone()), 'rust', 0, (DY + 1.0) / 2, -8.0); block(W, 0, -9.3, 3.4, 2.2, DY + 1.0);
    vis(W, new THREE.CylinderGeometry(2.3, 2.3, 0.2, 12, 1, false, Q, PI), 'plank_dark', 0, DY - 0.1, -8.0); // forecastle deck
    for (const [z, a] of [[-0.3, 0.5], [0.6, -0.4], [1.3, 0.7]]) vis(W, M.box(0.06, 1.3, 0.8), 'rust', -2.55, 0.8, z, { ry: a, rz: -0.35 });
    vbox(W, 0, -1.5, 4.9, 13, 0.06, '#7a3a26', 0.04); vbox(W, -2.47, -1.5, 0.04, 13, 0.5, 'red_paint', 0.0); vbox(W, 2.47, -1.5, 0.04, 13, 0.5, 'red_paint', 0.0);
    // the deck at 2.6 with the hold hatch open (x -1.05..1.05, z -3..-0.5), bulwarks all round
    W.floor(0, -5.5, 4.9, 5.0, DY, 'plank_dark', { t: 0.25 }); W.floor(0, 2.25, 4.9, 5.5, DY, 'plank_dark', { t: 0.25 });
    W.floor(-1.75, -1.75, 1.4, 2.5, DY, 'plank_dark', { t: 0.25 }); W.floor(1.75, -1.75, 1.4, 2.5, DY, 'plank_dark', { t: 0.25 });
    rail(W, -1.05, -3, -1.05, -0.5, DY, 'rust'); rail(W, 1.05, -3, 1.05, -0.5, DY, 'rust'); rail(W, -1.05, -3, 1.05, -3, DY, 'rust'); rail(W, -1.05, -0.5, 1.05, -0.5, DY, 'rust');
    for (const [x, z, w, d] of [[-2.45, -7.8, 0.15, 0.4], [-2.45, -0.6, 0.15, 11.2], [2.45, -1.5, 0.15, 13], [0, 5.0, 4.9, 0.15], [0, -8.0, 4.9, 0.15]]) W.box(x, z, w, d, 1.0, 'rust', { y: DY });
    // the gangway up from the beach along the port side, onto a landing by the bow
    flight(W, -3.1, -4.1, 1.2, 4.2, 0, DY, '-z', { guard: [-1], railSurf: 'metal_dark', surf: 'plank' });
    W.floor(-3.1, -6.9, 1.3, 1.4, DY, 'plank', { t: 0.2 }); rail(W, -3.75, -7.6, -3.75, -6.2, DY, 'metal_dark'); rail(W, -3.75, -7.6, -2.45, -7.6, DY, 'metal_dark');
    W.box(-3.65, -6.9, 0.14, 0.14, DY, 'metal_dark');
    // wheelhouse aft (z 1..5): walls raised on the deck, the door forward
    wallWin(W, 'x', 1.0, -2.3, 2.3, y, hh, 'white_paint', [[-0.7, 0.7]], [[1.0, 2.0]], 0.2); wallWin(W, 'x', 4.85, -2.3, 2.3, y, hh, 'white_paint', [], [[-1.2, 1.2]], 0.2);
    wallWin(W, 'z', -2.3, 1.1, 4.75, y, hh, 'white_paint', [], [[2.0, 3.6]], 0.2); wallWin(W, 'z', 2.3, 1.1, 4.75, y, hh, 'white_paint', [], [[2.0, 3.6]], 0.2);
    vbox(W, 0, 3.0, 5.0, 4.4, 0.2, 'white_paint', y + hh); rod(W, 'metal_dark', 0.06, [0.8, y + hh, 4.2], [0.8, y + hh + 2.6, 4.2], 6);
    vis(W, M.cyl(0.35, 0.4, 1.6, 10), 'red_paint', -1.2, y + hh + 0.8, 4.0);
    W.prop('desk', 0, 4.4, PI, { y }); W.container('ammobox', 1.6, 2.0, 0, { y }); W.container('crate', -1.6, 4.0, Q, { y });
    W.light(0, 3.0, y + 2.2, '#ffd9a0', 0.7, 7);
    // the hold: cargo in the dark, in through the tear
    W.container('crate', 0.6, -4.6, 0); W.container('barrel', -1.4, -6.2); W.container('food', -1.2, 2.8, 0);
    W.prop('pallets', 1.2, -6.6, 0); dcrate(W, -1.4, -3.6, 0.9); dcrate(W, -1.4, -3.6, 0.7, 'plank_dark', 0.9); dcrate(W, 1.3, 3.6, 0.8);
    W.light(0, -2.0, 2.0, '#ffb070', 0.5, 6); W.light(0, 3.0, 1.8, '#ffb070', 0.35, 5);
    rod(W, 'metal_dark', 0.07, [0, DY + 0.6, -10.3], [0, DY + 1.0, -11.6], 5); // bowsprit stub
    // the keeper's cottage, burnt out
    K.room({ x: -10, z: 5.5, w: 7, d: 6, wall: 'brick', noRoof: true, floor: 'dirt', doors: [{ side: 'e', at: 1, w: 1.6 }], windows: [{ side: 's', w: 1.4 }, { side: 'n', at: -1.5, w: 1.2 }] });
    const soot = M.mat('#1a1716'), char = M.mat('#2a2220');
    vis(K, M.box(6.4, 0.02, 5.4), soot, -10, 0.13, 5.5);
    for (let k = 0; k < 6; k++) vis(K, M.box(0.6 + K.R() * 1.4, 0.1, 0.18), char, -10 + (K.R() - 0.5) * 5, 0.2 + K.R() * 0.3, 5.5 + (K.R() - 0.5) * 4, { ry: K.R() * 6, rz: K.R() - 0.5 });
    vis(K, M.box(7.4, 0.16, 0.16), char, -10, 1.9, 5.5, { rz: 0.32 });
    K.container('crate', -12.2, 7.6); K.container('locker', -7.0, 3.0);
    // salvagers' camp on the beach
    K.prop('tent', 1.6, 9.6, 0); fire(K, 1.4, 6.6, 1.2); K.box(-0.2, 6.6, 0.4, 1.2, 0.4, 'log'); K.box(3.0, 6.6, 0.4, 1.2, 0.4, 'log');
    K.container('barrel', 3.6, 11.2); K.prop('pallets', -1.4, 11.4, 0);
    K.prop('rock_big', 4.5, -12.5, 0);
  }
  // rocks, trees, odds and ends
  K.veg('pine', -15, -5, 1); K.veg('pine', -14.5, 11.5, 0.9); K.veg('bush', 0.5, 13.5, 1); K.veg('bush', -6, 13, 1);
  K.container('barrel', -5.4, 1.8); K.container('crate', -14.2, -3.2, 0.3);
}

// ============================================================================
// STONE QUARRY — the worked face is an L of rock round the north-west: a
// lower bench (3 m) and a top bench (6 m) joined by haul ramps, an old adit
// driven into the west face (timbered tunnel, a chamber with ore at the end),
// the pit floor full of nodes. Two plants:
//  0 working pit: crusher house (a steel tower round the crusher, conveyor to
//    the stockpile) and stacked site cabins with a walkway
//  1 old mine: a timber ore-bin trestle fed by a rail line from the adit, a
//    headframe over a fenced shaft, a two-storey mine office
// The explosives store up on the top bench holds the best loot.
// ============================================================================
/** a solid rock wedge you can walk up (a ramp made with K.stairs, its steps swapped for a smooth slope) */
function rampRock(K, x, z, w, len, y0, y1, dir, surf = 'gravel') {
  const st = statics(K), n0 = st.children.length;
  K.stairs(x, z, w, len, y0, y1, dir, surf, { sides: false });
  for (const c of st.children.slice(n0)) st.remove(c);
  const rise = y1 - y0, g = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(len, 0), new THREE.Vector2(len, rise)]), { depth: w, bevelEnabled: false });
  g.translate(-len / 2, 0, -w / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  const ry = { '+x': 0, '-x': PI, '+z': Q, '-z': -Q }[dir];
  vis(K, g, 'rock', x, y0, z, { ry });
  const a = Math.atan2(rise, len);
  vis(K, M.box(Math.hypot(len, rise) + 0.1, 0.06, w - 0.1), surf, x, y0 + rise / 2 + 0.03, z, { ry, rz: a }); // the gravel running surface
}
/** a block of rock (solid up to its top, walkable on top), gravel on top and rough slabs on the faces in `faces` */
function rockMass(K, x0, z0, x1, z1, h, faces = '', o = {}) {
  const R = K.R, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0;
  K.box(cx, cz, w, d, h, 'rock');
  if (o.walk !== false) K.floor(cx, cz, w, d, h, 'gravel', { visual: false });
  vbox(K, cx, cz, w - 0.2, d - 0.2, 0.05, o.top || 'gravel', h);
  const slab = (fx, fz, along, L, side) => {
    for (let s = 0.4; s < L - 0.8; s += 1.2 + R() * 1.6) {
      const sw = 0.8 + R() * 1.4, sh = h * (0.35 + R() * 0.6), px = along === 'x' ? fx + s + sw / 2 : fx + side * 0.12, pz = along === 'x' ? fz + side * 0.12 : fz + s + sw / 2;
      vbox(K, px, pz, along === 'x' ? sw : 0.3, along === 'x' ? 0.3 : sw, sh, R() < 0.5 ? 'rock' : 'stone_dark', R() * 0.3);
    }
  };
  if (faces.includes('s')) slab(x0, z1, 'x', w, 1); if (faces.includes('n')) slab(x0, z0, 'x', w, -1);
  if (faces.includes('e')) slab(x1, z0, 'z', d, 1); if (faces.includes('w')) slab(x0, z0, 'z', d, -1);
}
/** loose boulders (visual) on a bench at height y */
function boulders(K, x, z, y, n = 3, s = 0.7) { const R = K.R; for (let i = 0; i < n; i++) vis(K, M.ico(s * (0.5 + R()), 0), 'rock', x + (R() - 0.5) * 2.4, y + s * 0.3, z + (R() - 0.5) * 2.4, { ry: R() * 6, rz: R() - 0.5 }); }
/** an inclined conveyor (visual belt, trestle legs that collide) from (x0, z0, y0) to (x1, z1, y1) */
function beltway(K, x0, z0, y0, x1, z1, y1, w = 1.0) {
  const dx = x1 - x0, dz = z1 - z0, dh = Math.hypot(dx, dz), dy = y1 - y0, ry = Math.atan2(dz, dx), rz = Math.atan2(dy, dh), L = Math.hypot(dh, dy);
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (y0 + y1) / 2, px = -Math.sin(ry), pz = Math.cos(ry);
  vis(K, M.box(L, 0.12, w), '#2a2a2c', mx, my, mz, { ry, rz });
  for (const s of [-1, 1]) vis(K, M.box(L, 0.3, 0.08), 'yellow_paint', mx + px * s * (w / 2 + 0.05), my + 0.12, mz + pz * s * (w / 2 + 0.05), { ry, rz });
  const n = Math.max(1, Math.floor(dh / 3.2));
  for (let i = 1; i <= n; i++) { const t = i / (n + 1), x = x0 + dx * t, z = z0 + dz * t, y = y0 + dy * t - 0.15; for (const s of [-1, 1]) K.box(x + px * s * w * 0.55, z + pz * s * w * 0.55, 0.16, 0.16, y, 'metal_dark'); rod(K, 'metal_dark', 0.04, [x + px * w * 0.55, y * 0.3, z + pz * w * 0.55], [x - px * w * 0.55, y * 0.8, z - pz * w * 0.55], 4); }
}
/** a little mine cart on the rails (solid) */
function cart(K, x, z, y = 0) {
  K.box(x, z, 1.5, 1.0, 0.9, 'rust', { y: y + 0.25 }); vbox(K, x, z, 1.3, 0.8, 0.06, '#5a5652', y + 1.1);
  for (const sx of [-0.45, 0.45]) for (const sz of [-0.45, 0.45]) vis(K, M.cyl(0.22, 0.22, 0.1, 10), 'metal_dark', x + sx, y + 0.22, z + sz, { rx: Q });
  boulders(K, x, z, y + 1.0, 2, 0.25);
}
/** the stacked site cabins: two on the ground, an office on top, a walkway and a stair (frame: x -6.6..6.6, z -1.4..2.9) */
function cabins(F, o = {}) {
  const Y = 3.0, h1 = 2.8, h2 = 2.6, c1 = o.c1 || 'corrugated_blue', c2 = o.c2 || 'white_paint', c3 = o.c3 || 'corrugated';
  F.ground(0, 0.7, 13.6, 4.6, 'concrete', { y: 0.04 });
  // cabin A (canteen, door south) and B (tool store, door east)
  wallWin(F, 'x', -1.4, -6.75, -0.05, 0, h1, c1, [], [[-4.6, -2.4]], 0.25); wallWin(F, 'x', 1.4, -6.75, -0.05, 0, h1, c1, [[-4.6, -3.4]], [[-2.4, -1.0]], 0.25);
  wallWin(F, 'z', -6.6, -1.4, 1.4, 0, h1, c1, [], [], 0.25); wallWin(F, 'z', -0.2, -1.4, 1.4, 0, h1, c1, [], [], 0.25);
  wallWin(F, 'x', -1.4, 0.05, 6.75, 0, h1, c3, [], [[2.6, 4.4]], 0.25); wallWin(F, 'x', 1.4, 0.05, 6.75, 0, h1, c3, [], [], 0.25);
  wallWin(F, 'z', 0.2, -1.4, 1.4, 0, h1, c3, [], [], 0.25); wallWin(F, 'z', 6.6, -1.4, 1.4, 0, h1, c3, [[-0.65, 0.65]], [], 0.25);
  F.ground(-3.4, 0, 6.2, 2.6, 'plank', { y: 0.07, t: 0.06 }); F.ground(3.4, 0, 6.2, 2.6, 'concrete_dark', { y: 0.07, t: 0.06 });
  // the deck over both (office floor + terrace) and the walkway in front of the office
  F.floor(0, 0, 13.4, 3.0, Y, 'metal_dark', { t: 0.22 });
  deck(F, -2.8, 2.1, 7.6, 1.4, Y, { bare: 'ne', open: {}, posts: [[-6.45, 2.65], [-1.5, 2.65], [0.85, 2.65]] });
  rail(F, -0.2, -1.5, 6.7, -1.5, Y); rail(F, 6.7, -1.5, 6.7, 1.5, Y); rail(F, 5.4, 1.45, 6.7, 1.45, Y);
  flight(F, 3.7, 2.15, 1.3, 5.4, 0, Y, '-x', { railSurf: 'yellow_paint' });
  // the office on top of A
  wallWin(F, 'x', -1.4, -6.75, -0.05, Y, h2, c2, [], [[-5.2, -3.4]], 0.2); wallWin(F, 'x', 1.4, -6.75, -0.05, Y, h2, c2, [[-2.2, -1.0]], [[-5.4, -3.6]], 0.2);
  wallWin(F, 'z', -6.6, -1.4, 1.4, Y, h2, c2, [], [[-0.6, 0.6]], 0.2); wallWin(F, 'z', -0.2, -1.4, 1.4, Y, h2, c2, [], [[-0.5, 0.5]], 0.2);
  vbox(F, -3.4, 0, 7.0, 3.3, 0.2, 'corrugated_rust', Y + h2); vbox(F, 3.4, 0, 6.9, 3.2, 0.12, c3, h1); vbox(F, -3.4, 0, 6.9, 3.2, 0.12, c1, h1);
  vbox(F, -3.4, 1.62, 3.0, 0.06, 0.5, 'yellow_paint', Y + h2 - 0.6); // sign board
  F.light(-3.4, 0, Y + 2.2, '#fff0d0', 0.8, 8); F.light(-3.4, 0, 2.4, '#fff0d0', 0.7, 7); F.light(3.4, 0, 2.4, '#ffe0b0', 0.6, 7);
}
function quarry(K) {
  K.label('Stone Quarry');
  const v = K.pick(2), R = K.R;
  K.ground(0, 0, 46, 46, 'gravel');
  K.ground(-1, -1, 26, 24, 'rock', { y: 0.035 });
  // ---- the face: top bench (6 m) behind, lower bench (3 m) in front, the adit cut into the west side
  rockMass(K, -16, -24, 14, -16, 6, 'se'); rockMass(K, -20, -20, -16, -16, 6, '', {});
  rockMass(K, -24, -16, -16, -6.5, 6); rockMass(K, -24, 1.0, -16, 12, 6, 's');
  rockMass(K, -24, -6.5, -23.5, 1.0, 6, '', { walk: false }); rockMass(K, -19.5, -6.5, -16, -4.2, 6, '', { walk: false }); rockMass(K, -19.5, -1.4, -16, 1.0, 6, '', { walk: false });
  K.floor(-20, -2.75, 8, 7.5, 6, 'gravel', { visual: false }); vbox(K, -20, -2.75, 7.8, 7.3, 0.05, 'gravel', 6);
  K.box(-21.5, -2.75, 4, 7.5, 2.8, 'rock', { y: 3.2 }); K.box(-17.75, -2.8, 3.5, 2.8, 3.4, 'rock', { y: 2.6 }); // chamber + tunnel roofs
  rockMass(K, -12, -16, 14, -12, 3, 'se'); rockMass(K, -16, -16, -12, -12, 3);
  rockMass(K, -16, -12, -12, -4.2, 3, 'e'); rockMass(K, -16, -1.4, -12, 12, 3, 'es');
  K.floor(-14, -2.8, 4, 2.8, 3, 'gravel', { visual: false }); vbox(K, -14, -2.8, 3.8, 2.6, 0.05, 'gravel', 3); K.box(-14, -2.8, 4, 2.8, 0.4, 'rock', { y: 2.6 });
  // a broken rocky crest round the outer edge of the top bench (a natural parapet)
  const crest = (x0, z0, x1, z1) => { const ax = Math.abs(x1 - x0) > Math.abs(z1 - z0), L = ax ? Math.abs(x1 - x0) : Math.abs(z1 - z0); let s = 0;
    while (s < L - 0.3) { const e = Math.min(L, s + 1.4 + R() * 2.2), m = (s + e) / 2, h = 0.9 + R() * 1.1, t = 0.9 + R() * 0.6; if (ax) K.box(Math.min(x0, x1) + m, z0, e - s, t, h, 'rock', { y: 6 }); else K.box(x0, Math.min(z0, z1) + m, t, e - s, h, 'rock', { y: 6 }); s = e; } };
  crest(-15.5, -23.4, 13.5, -23.4); crest(-23.4, -15.5, -23.4, 11.5); crest(-19.4, -19.6, -16, -19.6); crest(-19.6, -19.4, -19.6, -16); crest(13.4, -23.5, 13.4, -16.4);
  // haul ramps: pit -> lower bench (north), lower -> top bench (west)
  rampRock(K, 5.3, -9, 2.6, 6, 0, 3, '-z'); block(K, 3.93, -9.55, 0.15, 4.9, 4.05, { opaque: false }); block(K, 6.67, -9.55, 0.15, 4.9, 4.05, { opaque: false });
  rampRock(K, -14.8, 7, 2.4, 6, 3, 6, '-z'); block(K, -13.53, 6.5, 0.15, 5, 4.05, { y: 3, opaque: false });
  for (const [x, z, y] of [[4.0, -7, 1.2], [6.6, -10.5, 2.4], [-13.6, 9, 3.6], [-13.6, 5, 5.4]]) boulders(K, x, z, y, 2, 0.35);
  for (const [x, z, y] of [[-6, -13.2, 3], [10, -13.4, 3], [-13, 4, 3], [-8, -17.5, 6], [8, -18, 6], [-19, -14, 6], [-20, 8, 6]]) boulders(K, x, z, y, 3, 0.6);
  for (const [x, z] of [[-10.5, -11], [0, -11.2], [12, -11], [-11.2, 6], [-11, -8]]) boulders(K, x, z, 0, 3, 0.5);
  // the adit: timber sets along the tunnel, the portal, lamps, a chamber with a vein
  for (const x of [-12.2, -14.4, -16.6, -18.8]) { for (const z of [-4.05, -1.55]) vbox(K, x, z, 0.22, 0.22, 2.6, 'log'); vbox(K, x, -2.8, 0.26, 2.9, 0.26, 'log', 2.35); }
  vbox(K, -11.9, -2.8, 0.4, 3.6, 0.4, 'log', 2.6); for (const z of [-4.35, -1.25]) vbox(K, -11.9, z, 0.35, 0.35, 3.0, 'log');
  vis(K, M.box(1.6, 0.5, 0.06), 'yellow_paint', -11.6, 3.3, -2.8, { ry: Q }); vis(K, M.box(1.4, 0.16, 0.07), 'red_paint', -11.6, 3.38, -2.8, { ry: Q });
  K.light(-15.5, -2.8, 2.2, '#ffb060', 0.7, 7); K.light(-21.5, -2.75, 2.6, '#ffb060', 0.8, 8);
  for (const [x, z] of [[-15.5, -3.9], [-21.5, -6.2], [-21.5, 0.7]]) vis(K, M.box(0.2, 0.3, 0.2), M.mat('#ffd080', { emissive: '#ffb050', emissiveIntensity: 1 }), x, 2.0, z);
  K.node('metal', -22.4, -5.2); K.node('sulfur', -22.4, 0.0);
  K.container('cache', -20.4, -5.6, 0); vbox(K, -22.8, -2.6, 0.9, 1.2, 0.9, 'plank_dark');
  for (let k = 0; k < (v === 1 ? 7 : 3); k++) K.prop('rails', -21 + 6 * k, -2.8, 0);
  cart(K, -20.6, -0.2); cart(K, v === 1 ? 6 : -6.5, -2.8);
  // the pit floor: ore, cover, lights
  for (const [t, x, z] of [['stone', -9.5, -9], ['stone', -4, -8.8], ['stone', 1.5, -9.2], ['stone', -8.5, 3.5], ['stone', -3, 6.5], ['metal', -6, -6.2], ['metal', 0.5, -5], ['metal', -9.5, 8.5],
    ['sulfur', -2, 1.5], ['sulfur', 4.5, 0.5], ['sulfur', -6.5, 11]]) K.node(t, x, z);
  flood(K, -9, 13, 0); flood(K, 11, -10.5, 0);
  // ---- the explosives store up on the top bench (walls raised to the bench), a drill rig
  const B = frame(K, -4, -20.5, 0), y6 = 6;
  wallWin(B, 'x', -2, -2.2, 2.2, y6, 2.5, 'concrete', [], [], 0.25); wallWin(B, 'z', -2.1, -2, 2, y6, 2.5, 'concrete', [], [], 0.25); wallWin(B, 'z', 2.1, -2, 2, y6, 2.5, 'concrete', [], [[-0.6, 0.6]], 0.25);
  wallRun(B, 'x', 2, -2.2, 2.2, y6, 2.5, 'concrete', [[-0.6, 0.6]], 0.25);
  vbox(B, 0, 0, 4.8, 4.6, 0.25, 'concrete_dark', y6 + 2.5); vis(B, M.box(1.2, 0.5, 0.05), 'red_paint', 1.4, y6 + 1.9, 2.15);
  B.container('ammobox', -1.2, -1.2, 0, { y: y6 }); B.container('crate', 1.0, -1.2, 0, { y: y6 }); B.light(0, 0, y6 + 2.1, '#ffe0b0', 0.6, 6);
  B.prop('sandbags', -1.2, 3.4, 0, { y: y6 }); B.prop('sandbags', 1.6, 3.4, 0, { y: y6 });
  const D = frame(K, 6, -20, 0); // drill rig: crawler body, mast, rods
  D.box(0, 0, 3.2, 2.0, 1.6, 'yellow_paint', { y: y6 }); vbox(D, -0.6, 0, 1.4, 1.6, 1.0, 'yellow_paint', y6 + 1.6); vbox(D, -0.6, 0.81, 1.0, 0.04, 0.5, '#2e3e48', y6 + 1.9);
  for (const s of [-1, 1]) vbox(D, 0, s * 1.05, 3.4, 0.5, 0.6, '#2a2a2c', y6);
  vbox(D, 1.4, 0, 0.35, 0.35, 6.5, 'yellow_paint', y6 + 1.0); rod(D, 'metal_dark', 0.06, [1.4, y6 + 7.4, 0], [1.4, y6 - 0.2, 0], 6);
  for (let k = 0; k < 4; k++) rod(D, 'metal', 0.05, [-1.8 + k * 0.14, y6 + 0.1, -1.6], [-1.8 + k * 0.14, y6 + 0.1, 1.6], 5);
  if (v === 0) {
    // ---- crusher house: a steel tower round the crusher, a conveyor down to the stockpile, a loader
    const T = frame(K, 18, -4, 0);
    steelTower(T, { levels: 2, canopy: 'corrugated_rust', rail: 'yellow_paint' });
    T.prop('crusher', 0, 0, 0); K.ground(18, -4, 9, 9, 'concrete', { y: 0.04 });
    T.container('crate', 2.8, 2.6, 0, { y: 6.8 }); T.prop('generator', -2.6, 2.6, 0, { y: 3.4 }); cabinets(T, 2.7, 2.6, 1, 3.4, -1);
    beltway(K, 18, -1.0, 1.0, 18, 9.2, 4.6, 1.0); K.cyl(18, 11.2, 3.2, 3.8, 'gravel', { rTop: 0.3, seg: 12 });
    beltway(K, 9.5, 1.5, 0.9, 13.6, -2.5, 4.2, 0.9); K.box(8.6, 2.4, 2.4, 2.4, 1.6, 'rust'); vbox(K, 8.6, 2.4, 2.8, 2.8, 0.5, 'rust', 1.6);
    K.prop('truck', 9.5, 9, Q); K.prop('cable_spool', 12.5, 3.5, 0); K.prop('drums', 23.5, 4.5, 0);
    K.cyl(24, 11, 2.2, 2.4, 'gravel', { rTop: 0.25, seg: 10 }); K.cyl(10.5, 16, 2.0, 2.0, 'gravel', { rTop: 0.25, seg: 10 });
    // stacked site cabins (south-west of the pit)
    const C = frame(K, -3, 18.6, 0);
    cabins(C);
    C.prop('table', -2.0, -0.5, 0); C.prop('bench', -2.0, 0.35, 0); C.container('food', -5.9, -0.6, Q);
    C.prop('shelf', 3.2, -1.0, 0); C.prop('workbench_old', 1.6, 0.8, 0); C.container('toolbox', 4.6, 0.9, 0);
    C.prop('desk', -3.0, -0.8, 0, { y: 3.0 }); C.container('locker', -6.1, 0.6, Q, { y: 3.0 }); C.container('medbox', -1.0, -0.9, 0, { y: 3.0 });
    C.prop('pallets', 4.8, -0.4, 0, { y: 3.0 }); smallDish(C, 2.0, -0.8, 3.0, 1.0, -2.2, 0.6, 0.8);
    K.prop('generator', 10.5, 21, 0); K.container('barrel_oil', 12.6, 20.4); K.container('barrel', 13, 8.2); K.container('barrel', 13.8, 8.9);
    lamp(K, 5.6, 16.6, 0); lamp(K, -12, 14.6, 0);
  } else {
    // ---- ore bin on a timber trestle, fed by the rail line from the adit
    const T = frame(K, 17, -2.8, 0);
    steelTower(T, { levels: 2, canopy: 'corrugated_rust', leg: 'log', deck: 'plank_dark', rail: 'plank' });
    T.box(0, 0.4, 4.2, 3.8, 2.6, 'plank_dark', { y: 3.4 }); vbox(T, 0, 0.4, 4.4, 4.0, 0.2, 'log', 6.0); // the bin (up through the first deck)
    vis(T, M.cyl(0.4, 1.4, 1.6, 4), 'rust', 0, 2.6, 0.4, { ry: PI / 4 }); vbox(T, 0, 0.4, 0.6, 0.6, 1.2, 'rust', 1.2);
    cart(T, 0, 0.4); T.container('crate', 2.8, 2.8, 0, { y: 6.8 }); T.prop('pallets', -2.8, 2.6, 0, { y: 3.4 });
    K.ground(17, -2.8, 9, 9, 'gravel', { y: 0.04 });
    // headframe over a fenced shaft
    const S = frame(K, 7, 9, 0);
    vbox(S, 0, 0, 3, 3, 0.06, '#0e0d0c', 0.05); for (const [x, z, w, d] of [[0, -1.7, 3.6, 0.15], [0, 1.7, 3.6, 0.15], [-1.7, 0, 0.15, 3.6], [1.7, 0, 0.15, 3.6]]) S.box(x, z, w, d, 1.1, 'plank_dark');
    for (const s of [-1, 1]) { S.box(s * 1.6, 1.9, 0.3, 0.3, 7, 'log'); rod(S, 'log', 0.13, [s * 1.6, 0, -2.6], [s * 1.6, 6.6, 1.6], 6); }
    vbox(S, 0, 1.9, 3.6, 0.3, 0.3, 'log', 6.8); vis(S, new THREE.TorusGeometry(1.0, 0.08, 6, 16), 'metal_dark', 0, 7.6, 1.9); rod(S, 'metal_dark', 0.03, [0, 7.6, 2.9], [0, 0.2, 0], 4);
    // the mine office: two storeys, timber, pitched roof
    const H = frame(K, -1.5, 19, 0);
    const h = house2(H, { w: 9, d: 6.4, wall: 'plank_dark', wall2: 'plank', trim: 'plank_dark', floor: 'plank', stair: 'plank_dark',
      doors1: { s: [[-1.6, -0.2]], e: [[0.4, 1.8]] }, wins1: { s: [[1.2, 2.8]], w: [[-0.4, 1.0]] }, wins2: { s: [[-3, -1.6], [0.6, 2.2]], e: [[-0.6, 0.8]] } });
    pitch(H, 0, 0, 9, 6.4, h.ROOF, 'corrugated_rust', 'plank_dark');
    H.prop('table', -2.6, 1.2, 0); H.container('crate', 3.7, 2.6, 0); H.container('toolbox', -3.9, 2.6, 0); H.prop('shelf', 1.6, 2.85, 0);
    H.prop('desk', 1.4, 0.4, 0, { y: 3.4 }); H.container('locker', 4.05, 2.2, -Q, { y: 3.4 }); H.container('medbox', -3.8, 2.6, 0, { y: 3.4 });
    K.prop('generator', 11, 18.5, 0); K.container('barrel_oil', 13, 18); K.container('barrel', 13.4, 5.8); K.container('barrel', 12.6, 6.6);
    K.prop('cable_spool', 10.5, 12.5, 0); K.prop('pallets', 22.5, 6.5, 0); K.cyl(23, 12, 2.2, 2.2, 'gravel', { rTop: 0.25, seg: 10 });
    lamp(K, 5, 16, 0); lamp(K, -12, 14.6, 0);
  }
  K.prop('workbench_old', 2.5, 14.6, 0); K.prop('tires', 14.5, 14.5, 0);
  void R;
}

export const CLIMB_LAYOUTS = { radio, lighthouse, quarry };
