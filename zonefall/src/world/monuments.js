// ============================================================================
// ZONEFALL 3 — monument layouts. Each layout is `(K) => void` and builds in
// LOCAL metres (origin = monument centre, +X east, +Z south; the kit rotates
// by quarter turns). Everything stays inside MONUMENTS[type].size.
// Coastal sites (harbor, lighthouse): local +X faces the sea; past ~0.55*size
// toward +X may be water, so only docks / boats live there (no loot / NPCs).
//
// Rotation note: props whose colliders or facing are not symmetric
// (hangar, garage, boat, heli_wreck, vending, fusebox, counter...) are only
// ever given local yaw 0 or PI, so they read correctly whatever the kit does
// with the sign of quarter-turn yaws.
// ============================================================================
import { EXTRA_LAYOUTS } from './monuments_extra.js';
import { CAVE_LAYOUTS } from './caves.js';
import { TALL_LAYOUTS } from './monuments_tall.js';
import { M } from '../gfx/materials.js';

const Q = Math.PI / 2, PI = Math.PI;
const lerp = (a, b, t) => a + (b - a) * t;
const BOX_COLORS = ['#9a4a36', '#3e6a8e', '#5a7048', '#b08a3a', '#6a6a70'];

// ---------------------------------------------------------------- helpers
/** a mesh that belongs to a room's roof group (hides with the roof): tower cabs, roof signs */
function onRoof(K, room, x, z, w, d, h, y, surf) {
  if (!room || !room.roof) return null;
  const [wx, wz] = K.toWorld(x, z); const odd = K.rot & 1;
  const mat = typeof surf === 'string' ? M.surf(surf, { cut: true }) : surf;
  return M.add(room.roof, M.box(odd ? d : w, h, odd ? w : d), mat, wx - K.mon.x, y + h / 2, wz - K.mon.z);
}
/** straight interior wall with door gaps [[lo,hi],...] along its axis (lintel above each gap) */
function wallGaps(K, x0, z0, x1, z1, gaps = [], o = {}) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
  const h = o.h ?? 3.2, t = o.thick ?? 0.25, surf = o.surf ?? 'concrete';
  const seg = (s, e, y0, hh) => { if (e - s < 0.02) return; if (alongX) K.box((s + e) / 2, c, e - s, t, hh, surf, { y: y0 }); else K.box(c, (s + e) / 2, t, e - s, hh, surf, { y: y0 }); };
  let cur = a0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { seg(cur, g0, 0, h); if (o.lintel !== false && h > 2.5) seg(g0, g1, 2.3, h - 2.3); cur = g1; }
  seg(cur, a1, 0, h);
}
/** shanty wall: random-length panels of mixed scrap surfaces and heights, with gaps */
function scrapWall(K, x0, z0, x1, z1, o = {}) {
  const R = K.R, alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
  const surfs = o.surfs || ['corrugated_rust', 'corrugated', 'concrete', 'corrugated_rust', 'plank_dark', 'corrugated_red'];
  const spans = []; let cur = a0;
  for (const g of [...(o.gaps || [])].sort((p, q) => p[0] - q[0])) { if (g[0] > cur) spans.push([cur, g[0]]); cur = Math.max(cur, g[1]); }
  if (cur < a1) spans.push([cur, a1]);
  const t = o.t ?? 0.35;
  for (const [s0, s1] of spans) {
    let s = s0;
    while (s < s1 - 0.01) {
      let e = Math.min(s1, s + (o.seg ?? 2.6) + R() * 2.2); if (s1 - e < 1.2) e = s1;
      const h = (o.h ?? 3.2) + (R() - 0.5) * (o.hv ?? 0.6), surf = surfs[Math.floor(R() * surfs.length)];
      if (alongX) K.box((s + e) / 2, c, e - s, t, h, surf); else K.box(c, (s + e) / 2, t, e - s, h, surf);
      s = e;
    }
  }
}
/** chain-link fence line with gaps [[lo,hi],...] along its axis */
function fenceLine(K, x0, z0, x1, z1, gaps = [], h = 2.4) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1), c = alongX ? z0 : x0;
  let cur = a0;
  // (top wire drawn here with K.box so it follows the monument rotation)
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
/** non-loot decor crate */
const dcrate = (K, x, z, s = 0.9, surf = 'plank', y = 0) => K.box(x, z, s, s, s, surf, { y, collide: y < 0.5 });
/** stack of shipping containers (only the bottom one collides) */
function boxStack(K, x, z, rq, n) { for (let k = 0; k < n; k++) K.prop('container', x, z, rq, { y: k * 2.6, collide: k === 0, color: K.R.pick(BOX_COLORS) }); }
/** short dashed paint line along X or Z */
function dashes(K, x0, z0, x1, z1, dash = 3, gap = 3, surf = 'white_paint', w = 0.3) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0); const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  for (let s = 0; s + dash <= L + 0.01; s += dash + gap) {
    const m = s + dash / 2;
    if (alongX) K.ground(Math.min(x0, x1) + m, z0, dash, w, surf, { y: 0.05, t: 0.02 });
    else K.ground(x0, Math.min(z0, z1) + m, w, dash, surf, { y: 0.05, t: 0.02 });
  }
}
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
/**
 * a walkable roof on a building (x0..x1, z0..z1, roof top at `top`) with railings and an outside stair on whichever
 * wall has room, away from doors (o.avoid = [[x, z, r]]). o.blocks = [[x0, z0, x1, z1, h]] roof clutter you can't walk
 * through; o.loot = [[type, x, z, ry]] containers up there. Runs after the rest of the site is built.
 */
function roofDeck(K, x0, z0, x1, z1, top, o = {}) {
  if (!o.now) { (K.late || (K.late = [])).push(() => roofDeck(K, x0, z0, x1, z1, top, Object.assign({}, o, { now: true }))); return; }
  const LEN = Math.max(4.4, top * 1.45), HW = 0.65;
  const blk = (bx, bz, w, d, h, y) => { const mm = K.box(bx, bz, w, d, h, 'concrete', y ? { y } : {}); if (mm) mm.removeFromParent(); };
  const cands = [];
  for (const f of [0.5, 0.25, 0.75, 0.12, 0.88]) {
    cands.push({ side: 'n', dir: '+z', cx: lerp(x0, x1, f), cz: z0 - LEN / 2 - 0.05 }, { side: 's', dir: '-z', cx: lerp(x0, x1, f), cz: z1 + LEN / 2 + 0.05 });
    cands.push({ side: 'w', dir: '+x', cx: x0 - LEN / 2 - 0.05, cz: lerp(z0, z1, f) }, { side: 'e', dir: '-x', cx: x1 + LEN / 2 + 0.05, cz: lerp(z0, z1, f) });
  }
  const pick = cands.find(c => {
    const ax = c.dir[1] === 'x', out = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[c.side];
    const wx = ax ? (c.side === 'e' ? x1 : x0) : c.cx, wz = ax ? c.cz : (c.side === 's' ? z1 : z0); // foot of the wall
    for (let d = 0.6; d <= LEN + 0.7; d += 0.7) for (const l of [-HW, 0, HW]) {
      const px = wx + out[0] * d + (ax ? 0 : l), pz = wz + out[1] * d + (ax ? l : 0);
      if (!K.freeAt(px, pz, 0.45)) return false;
      if ((o.avoid || []).some(([ax0, az0, r]) => (px - ax0) ** 2 + (pz - az0) ** 2 < r * r)) return false;
    }
    return true;
  });
  if (!pick) return false;
  K.floor((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, top, 'concrete', { visual: false });
  K.stairs(pick.cx, pick.cz, 1.3, LEN, 0, top, pick.dir, 'metal_dark', { side: 'yellow_paint' });
  const ax = pick.dir[1] === 'x';
  for (const l of [-1, 1]) blk(pick.cx + (ax ? 0 : l * (HW + 0.06)), pick.cz + (ax ? l * (HW + 0.06) : 0), ax ? LEN : 0.12, ax ? 0.12 : LEN, top + 1.0);
  // railings round the roof, open where the stair arrives
  const edges = { n: [x0, z0, x1, z0], s: [x0, z1, x1, z1], w: [x0, z0, x0, z1], e: [x1, z0, x1, z1] };
  for (const [side, [ex0, ez0, ex1, ez1]] of Object.entries(edges)) {
    const along = ex0 === ex1 ? 'z' : 'x', a0 = along === 'x' ? ex0 : ez0, a1 = along === 'x' ? ex1 : ez1, at = along === 'x' ? pick.cx : pick.cz;
    const parts = side === pick.side ? [[a0, at - 0.85], [at + 0.85, a1]] : [[a0, a1]];
    for (const [p0, p1] of parts) if (p1 - p0 > 0.1) { const mid = (p0 + p1) / 2; if (along === 'x') blk(mid, ez0, p1 - p0, 0.15, 1.0, top); else blk(ex0, mid, 0.15, p1 - p0, 1.0, top); }
  }
  for (const [bx0, bz0, bx1, bz1, h] of o.blocks || []) blk((bx0 + bx1) / 2, (bz0 + bz1) / 2, bx1 - bx0, bz1 - bz0, h, top);
  for (const [type, lx, lz, ry] of o.loot || []) K.container(type, lx, lz, ry || 0, { y: top });
  return true;
}
/**
 * a watchtower you can climb: timber stairs up to the platform (3.92 m), railings round it. The stair goes out
 * from whichever side has room (prefer `prefer`, a quarter-turn yaw); returns false if no side is free.
 */
function climbTower(K, x, z, prefer = 0, o = {}) {
  if (!o.now) { (K.late || (K.late = [])).push(() => climbTower(K, x, z, prefer, Object.assign({}, o, { now: true }))); return true; }
  const TOP = 3.92, LEN = 5.6, W2 = 0.65;
  let ry = null;
  for (let k = 0; k < 4 && ry === null; k++) {
    const a = prefer + k * Q, ux = Math.round(Math.cos(a)), uz = Math.round(Math.sin(a)); let ok = true;
    for (let s = 1.9; s <= 1.55 + LEN + 0.4 && ok; s += 0.8) for (const l of [-0.6, 0, 0.6]) if (!K.freeAt(x + ux * s - uz * l, z + uz * s + ux * l, 0.45)) { ok = false; break; }
    if (ok) ry = a;
  }
  K.prop('watchtower', x, z, ry ?? prefer);
  if (o.light !== false) K.light(x, z, 5.2, '#fff2d8', 1.0, 14);
  if (ry === null) return false;
  const ux = Math.round(Math.cos(ry)), uz = Math.round(Math.sin(ry));
  K.floor(x, z, 3.0, 3.0, TOP, 'plank', { visual: false });
  const cx = x + ux * (1.5 + LEN / 2), cz = z + uz * (1.5 + LEN / 2), dir = ux > 0 ? '-x' : ux < 0 ? '+x' : uz > 0 ? '-z' : '+z';
  K.stairs(cx, cz, 1.2, LEN, 0, TOP, dir, 'plank_dark', { side: 'log' });
  // stair sides (invisible: the timber stringers are drawn by the stairs) and the platform railings
  const blk = (bx, bz, w, d, h, y) => { const mm = K.box(bx, bz, w, d, h, 'plank', y ? { y } : {}); if (mm) mm.removeFromParent(); };
  for (const l of [-1, 1]) blk(cx - uz * l * W2, cz + ux * l * W2, ux ? LEN : 0.12, ux ? 0.12 : LEN, TOP + 1.0);
  for (let e = 0; e < 4; e++) {
    const ex = Math.round(Math.cos(e * Q)), ez = Math.round(Math.sin(e * Q)), px = x + ex * 1.55, pz = z + ez * 1.55;
    if (ex === ux && ez === uz) { // the stair side: rails either side of the opening
      for (const l of [-1, 1]) blk(px - ez * l * 1.15, pz + ex * l * 1.15, ex ? 0.12 : 0.8, ex ? 0.8 : 0.12, 1.0, TOP);
    } else blk(px, pz, ex ? 0.12 : 3.2, ex ? 3.2 : 0.12, 1.0, TOP);
  }
  return true;
}
function flood(K, x, z, rq = 0, range = 16) { K.deployModel('floodlight', x, z, rq); K.light(x, z, 2.4, '#fff2d8', 1.4, range); }
function fire(K, x, z) { K.deployModel('campfire', x, z); K.light(x, z, 1.1, '#ff9a40', 1.5, 10); }
function room(K, o) { return K.room(o); }

// ============================================================================
// HAVEN MARKET — neutral walled trading post in a shanty compound (safe zone)
// ============================================================================
function haven(K) {
  K.label('Haven Market'); K.safe(34);
  K.ground(0, 0, 44, 44, 'dirt', { y: 0.02 });
  K.ground(0, 0, 26, 22, 'concrete', { y: 0.035 });
  for (const s of [-1, 1]) { K.ground(s * 22, 0, 18, 6, 'asphalt', { y: 0.035 }); dashes(K, s * 13.5, 0, s * 30.5, 0, 2, 2); }
  // walls: west + east gates on the road
  const wo = { h: 3.3, t: 0.4 };
  scrapWall(K, -22.2, -22, 22.2, -22, wo); scrapWall(K, -22.2, 22, 22.2, 22, wo);
  scrapWall(K, -22, -21.8, -22, 21.8, { ...wo, gaps: [[-3.9, 3.9]] }); scrapWall(K, 22, -21.8, 22, 21.8, { ...wo, gaps: [[-3.9, 3.9]] });
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) K.box(s * 22, t * 3.45, 0.9, 0.9, 4.4, 'concrete_dark');
    K.box(s * 22, 0, 0.5, 7.8, 0.5, 'plank_dark', { y: 4.2, collide: false });
    K.box(s * 22.35, 0, 0.12, 4.2, 1.0, 'yellow_paint', { y: 3.2, collide: false });
    K.prop('sandbags', s * 23.3, -s * 6.0, Q); K.prop('barrier', s * 26, -s * 4.3, 0); K.prop('barrier', s * 30, -s * 4.3, 0);
  }
  lamp(K, -25, 4.6, 0); lamp(K, 25, -4.6, PI);
  climbTower(K, -18.5, 7, 0, { light: false }); climbTower(K, 18.5, -7, PI, { light: false });
  K.light(-18.5, 7, 5.2, '#ffe0a0', 1.0, 12); K.light(18.5, -7, 5.2, '#ffe0a0', 1.0, 12);
  for (const [x, z] of [[-20, -4.6], [-20, 4.6], [20, -4.6], [20, 4.6]]) K.npc('guard', x, z, { guard: true });
  // vendor shops on the north row
  const shops = [['general', -12, 'plank', 'corrugated_green', 'yellow_paint'], ['arms', 0, 'corrugated_rust', 'corrugated_red', 'red_paint'], ['tech', 12, 'corrugated_blue', 'corrugated', 'blue_paint']];
  for (const [shop, x, wall, roof, sign] of shops) {
    room(K, { x, z: -17, w: 7.5, d: 6, h: 3.2, wall, roof, floor: 'plank_dark', doors: [{ side: 's', w: 5.0 }], windows: [{ side: 'e', at: 1.2, w: 1.4 }, { side: 'w', at: 1.2, w: 1.4 }] });
    K.vendor(shop, x, -16.0, 0);
    for (const sx of [-1, 1]) K.box(x + sx * 2.55, -16.0, 2.1, 0.5, 1.1, 'plank_dark');
    K.npc('trader', x, -17.6, { guard: true });
    K.prop('shelf', x - 1.8, -19.35, 0); K.prop('shelf', x + 1.8, -19.35, 0);
    K.box(x, -13.78, 4.6, 0.12, 0.6, sign, { y: 2.45, collide: false });
    K.light(x, -16.6, 2.8, '#ffd9a0', 1.1, 8);
  }
  dcrate(K, -14.9, -18.0, 0.8); dcrate(K, -14.9, -17.1, 0.7); dcrate(K, -14.9, -18.0, 0.6, 'plank_dark', 0.8); K.prop('pallets', -9.3, -14.9, 0);
  K.box(3.15, -17.8, 0.4, 1.6, 1.6, 'metal_dark'); K.box(-3.15, -17.8, 0.4, 1.6, 1.6, 'metal_dark'); K.box(2.8, -14.7, 0.35, 0.6, 0.4, 'green_paint');
  K.prop('desk', 14.6, -17.9, Q); K.prop('generator', 9.4, -17.9, Q);
  // plaza: well, benches, stalls, recyclers
  well(K, 0, 0);
  for (const [x, z, r] of [[-4.5, 3.5, 0], [4.5, 3.5, 0], [-4.5, -3.5, PI], [4.5, -3.5, PI]]) K.prop('bench', x, z, r);
  const stall = (x, z, surf) => { canopy(K, x, z, 3.4, 2.6, 2.4, surf); K.prop('table', x, z + 0.2, 0); dcrate(K, x - 1.05, z - 0.75, 0.6); dcrate(K, x + 1.1, z - 0.8, 0.5, 'plank_dark'); };
  stall(-8, -7, 'tarp_blue'); stall(8, -7, 'cloth'); stall(-8, 7, 'tarp_green');
  canopy(K, 8, 7.25, 6.6, 5.1, 3.0, 'corrugated_rust');
  K.recycler(6.5, 7.3, 0); K.recycler(9.5, 7.3, 0);
  K.light(8, 7.25, 2.7, '#ffe6b0', 1.2, 10);
  for (const [x, z, r] of [[-12, -9.5, 0], [12, -9.5, PI], [-12, 9.5, 0], [12, 9.5, PI]]) lamp(K, x, z, r);
  // canteen (SW) and bunkhouse (SE)
  room(K, { x: -11, z: 16.5, w: 12, d: 7, wall: 'plank', roof: 'corrugated_red', trim: 'plank_dark', floor: 'plank', doors: [{ side: 'n', at: 3, w: 1.8 }], windows: [{ side: 'n', at: -3, w: 1.6 }, { side: 'w', w: 1.4 }, { side: 's', w: 1.6 }] });
  for (const x of [-14.5, -11]) { K.prop('table', x, 15.5, 0); K.prop('bench', x, 14.6, 0); K.prop('bench', x, 16.4, 0); }
  K.prop('counter', -8.6, 17.8, 0); K.prop('shelf', -8.6, 19.45, 0); K.box(-15.6, 19.2, 1.4, 0.9, 1.0, 'plank_dark');
  K.light(-11, 16.5, 2.8, '#ffcf8a', 1.0, 9);
  // the Lucky Duck Casino (SE): blackjack and the duck races, for scrap
  room(K, { x: 11, z: 16.5, w: 12, d: 7, h: 3.4, wall: 'corrugated_red', roof: 'corrugated', trim: 'yellow_paint', floor: 'tile', doors: [{ side: 'n', at: -3, w: 2.0 }], windows: [{ side: 'n', at: 2.6, w: 2.2 }, { side: 'e', w: 1.4 }] });
  const track = K.object('duck_track', 11, 18.6, 0, { w: 8.2, d: 2.3, h: 1.0 });
  K.use('duckrace', 11, 16.9, { track: track && track.setProgress ? track : null });
  K.object('blackjack_table', 13.6, 14.9, PI, { w: 2.7, d: 1.5, h: 0.95, cols: [[0, -1.0, 0.7, 0.45, 1.75]] }); // + the dealer
  K.use('blackjack', 13.6, 14.0);
  K.object('casino_sign', 8, 12.75, 0, { y: 2.7, collide: false });
  K.light(11, 16.5, 3.0, '#ffd27a', 1.2, 10); K.light(13.6, 14.9, 2.6, '#86e64a', 0.7, 5); K.light(11, 18.6, 2.6, '#4ac0ff', 0.8, 7);
  // camp corner, tents, water tower
  K.prop('tent', -19, -17, 0); K.prop('tent', -18.5, -10.5, 0); K.prop('tent', 19.5, 10.5, 0);
  K.prop('water_tower', 19, -18, 0);
  fire(K, -19.5, 11); K.box(-19.5, 12.6, 1.6, 0.35, 0.35, 'log'); K.box(-17.9, 11, 0.35, 1.6, 0.35, 'log');
  K.prop('pallets', -20.6, -6.3, 0); K.prop('drums', 20.6, 14.5, 0);
  // outside the walls
  K.prop('car', -27.5, 9.5, Q + 0.1); K.prop('car', 27, -10, 0.25); K.prop('billboard', 26, 12, 0); K.prop('tires', -26.5, -9.5, 0);
}

// ============================================================================
// GAS STATION — canopy + pumps, shop with stock room, repair bay, recycler
// ============================================================================
function gas(K) {
  K.label('Gas Station');
  K.ground(-1, 2, 34, 18, 'asphalt');
  K.ground(-2, -10.75, 27, 7.5, 'gravel', { y: 0.02 });
  K.ground(5.5, -7.2, 12, 1.6, 'concrete', { y: 0.05 });
  dashes(K, -17, 10.2, 15, 10.2, 2.5, 2, 'white_paint', 0.25);
  // canopy over two pump islands
  K.box(-4, 3, 12, 8, 0.5, 'white_paint', { y: 4.4, collide: false });
  for (const [x, z, w, d] of [[-4, -1, 12, 0.15], [-4, 7, 12, 0.15], [-10, 3, 0.15, 8], [2, 3, 0.15, 8]]) K.box(x, z, w, d, 0.6, 'red_paint', { y: 4.3, collide: false });
  for (const [x, z] of [[-9, -0.2], [1, -0.2], [-9, 6.2], [1, 6.2]]) K.cyl(x, z, 0.22, 4.4, 'white_paint', { seg: 10 });
  for (const x of [-6.5, -1.5]) { K.box(x, 3, 1.1, 4.6, 0.2, 'concrete'); K.prop('gas_pump', x, 1.7, 0); K.prop('gas_pump', x, 4.3, 0); }
  K.light(-4, 3, 4.0, '#f0f4ff', 1.4, 14);
  K.prop('car', -4, 1.6, Q);
  // shop + stock room
  roofDeck(K, 0, -15, 11, -8, 3.45, { avoid: [[2, -8, 2.2]], loot: [['crate', 9.3, -14], ['cache', 1.4, -13.8]] });
  const shop = room(K, { x: 5.5, z: -11.5, w: 11, d: 7, wall: 'brick', roof: 'concrete_dark', trim: 'red_paint', floor: 'tile', doors: [{ side: 's', at: -3.5, w: 1.8 }], windows: [{ side: 's', at: 0, w: 2.4 }, { side: 'w', at: -1, w: 1.4 }, { side: 'e', w: 1.2 }] });
  onRoof(K, shop, 4, -8.0, 5, 0.25, 0.9, 3.75, 'red_paint');
  wallGaps(K, 7.6, -14.85, 7.6, -8.15, [[-14.3, -12.8]], { surf: 'brick' });
  K.prop('counter', 5.4, -10.0, 0); K.prop('shelf', 2.4, -12.6, 0); K.prop('shelf', 2.4, -14.45, 0); K.prop('vending', 0.75, -10.6, 0);
  K.container('food', 5.0, -14.3); K.container('food', 0.9, -13.5, Q); K.container('crate', 6.6, -11.6);
  K.container('crate', 9.3, -9.0); K.container('barrel', 10.2, -14.2); K.prop('pallets', 9.6, -12.0, 0);
  K.light(4, -11.5, 2.9, '#fff0d0', 1.0, 9);
  // repair bay
  room(K, { x: -11.25, z: -11, w: 8.5, d: 6, wall: 'corrugated', roof: 'corrugated_rust', floor: 'concrete_dark', doors: [{ side: 's', w: 4.2 }], windows: [{ side: 'w', w: 1.2 }, { side: 'n', at: 2, w: 1.4 }] });
  K.prop('car', -11.4, -11.6, 0.08); K.prop('workbench_old', -13.4, -13.3, 0); K.prop('tires', -8.1, -9.2, 0);
  K.container('toolbox', -9.0, -13.4); K.container('barrel_oil', -14.7, -9.0);
  K.light(-11.25, -11, 2.9, '#ffe0b0', 0.9, 8);
  // yard
  K.recycler(-3.5, -12.0, 0); K.prop('dumpster', -3.5, -15.5, 0);
  lamp(K, -5.2, -8.6, 0); lamp(K, 14.5, 8.5, PI); lamp(K, -16, 8, 0);
  K.prop('billboard', 14, -2.5, 0);
  K.prop('car', -14.2, 4.5, 0.25); K.prop('car', 11.5, 7.5, -0.35);
  K.container('barrel', 13.6, -5.4); K.container('barrel', 14.4, -4.6); K.container('barrel', 12.4, -8.6);
  K.container('barrel_oil', -16.0, -1.0); K.container('barrel_oil', -15.3, -0.3);
  // no guards at low-tier sites: extra loot instead
  K.container('crate', -11, 9); K.container('medbox', -11, -6.8);
}

// ============================================================================
// SUPERMARKET — big store with aisles + stock room, parking lot
// ============================================================================
function mart(K) {
  K.label('Supermarket');
  const store = room(K, {
    x: 0, z: -10, w: 24, d: 14, h: 4.2, wall: 'concrete', roof: 'concrete_dark', trim: 'red_paint', floor: 'tile',
    doors: [{ side: 's', at: -6, w: 2.4 }, { side: 's', at: 6, w: 2.4 }, { side: 'e', at: -4.5, w: 2.0 }],
    windows: [{ side: 's', at: -9.8, w: 2.6 }, { side: 's', at: 0, w: 4 }, { side: 's', at: 9.8, w: 2.6 }, { side: 'w', at: 3, w: 1.6 }],
  });
  onRoof(K, store, 0, -3.25, 10, 0.3, 1.2, 4.75, 'red_paint'); onRoof(K, store, 0, -3.42, 8.4, 0.05, 0.45, 5.05, 'white_paint');
  roofDeck(K, -12, -17, 12, -3, 4.5, { avoid: [[-6, -3, 2.4], [6, -3, 2.4], [12, -14.5, 2.4]], blocks: [[-7.9, -12.7, -6.1, -11.3, 1.0], [-3.9, -12.7, -2.1, -11.3, 1.0], [5.1, -15.2, 6.9, -13.8, 1.0], [0.5, -8.3, 5.5, -7.7, 0.6], [-5, -3.6, 5, -3.1, 1.3]], loot: [['cache', -5, -14.6], ['crate', 9.5, -6.2], ['barrel', 8.6, -15.8]] });
  wallGaps(K, -11.85, -13.2, 11.85, -13.2, [[-4.1, -2.6], [8.0, 9.6]], { h: 4.2, surf: 'concrete' });
  for (const [x, z] of [[-7, -12], [-3, -12], [6, -14.5]]) onRoof(K, store, x, z, 1.8, 1.4, 0.9, 4.5, 'metal');
  onRoof(K, store, 3, -8, 5, 0.5, 0.5, 4.5, 'metal_dark');
  K.ground(14.5, -12, 4.6, 7, 'concrete', { y: 0.03 });
  // checkouts + aisles
  K.prop('counter', -10, -5.6, 0); K.prop('counter', -2, -5.6, 0); K.prop('counter', 2, -5.6, 0);
  for (const z of [-8.0, -10.4, -12.75]) for (const x of [-8.7, -5.7, -1.0, 2.0, 5.0]) K.prop('shelf', x, z, 0);
  K.prop('table', 9.0, -8.2, 0); K.box(9.0, -11.0, 3.0, 0.9, 0.9, 'white_paint'); K.prop('vending', -11.4, -4.0, 0);
  K.container('food', -11.0, -12.5, Q); K.container('food', -7.2, -9.2); K.container('food', 7.2, -11.9); K.container('food', 10.6, -9.4);
  K.container('crate', -11.0, -7.4, Q); K.container('medbox', 11.0, -12.4);
  // stock room
  K.prop('shelf', -5.5, -16.4, 0); K.prop('shelf', 0.5, -16.4, 0); K.prop('pallets', 7.0, -15.3, 0);
  K.container('toolbox', -10.8, -16.3); K.container('crate', -9.3, -16.2); K.container('crate', 4.0, -16.2); K.container('barrel', 10.9, -16.3);
  K.light(-6, -9, 3.8, '#f4f8ff', 1.1, 11); K.light(5, -9, 3.8, '#f4f8ff', 1.1, 11); K.light(0, -15, 3.4, '#ffe8c0', 0.9, 9);
  // outside: sidewalk, parking, recycler, dumpsters
  K.ground(0, -2.25, 26, 1.5, 'concrete', { y: 0.05 });
  K.ground(0, 6, 30, 15, 'asphalt');
  for (let k = 0; k <= 10; k++) { const x = -13.5 + 2.7 * k; K.ground(x, 2.45, 0.12, 4.5, 'white_paint', { y: 0.05, t: 0.02 }); K.ground(x, 10.55, 0.12, 4.5, 'white_paint', { y: 0.05, t: 0.02 }); }
  for (const [k, z] of [[1, 2.45], [4, 2.45], [8, 2.45], [2, 10.55], [6, 10.55], [9, 10.55]]) K.prop('car', -12.15 + 2.7 * k, z, Q + (K.R() - 0.5) * 0.12);
  for (const [x, z, r] of [[-9, -0.6, 0], [9, -0.6, PI], [-9, 13.8, 0], [9, 13.8, PI]]) lamp(K, x, z, r);
  K.recycler(-15, -6.0, 0);
  K.prop('dumpster', 14.4, -10.0, Q); K.prop('dumpster', 14.4, -7.5, Q); K.prop('pallets', 14.2, -3.8, 0);
  K.container('barrel', 13.6, -12.6); K.prop('billboard', -17, 6, Q);
  K.container('crate', -9, -6.85); K.container('ammobox', -1.0, -15.0); K.container('barrel', -13, 6.4);
}

// ============================================================================
// LIGHTHOUSE — tower on the point, keeper's hut, shed, pier with a boat
// ============================================================================
function lighthouse(K) {
  K.label('Lighthouse');
  K.ground(-6, 0, 16, 18, 'gravel', { y: 0.02 });
  K.ground(6.6, 0, 5.2, 16, 'sand', { y: 0.02 }); // beach strip; the sea starts at ~9.9 m (0.55 x radius)
  K.ground(-2, -5, 8.5, 8.5, 'stone_dark', { y: 0.035 });
  K.ground(-1.5, 3.5, 2, 6, 'stone', { y: 0.04 });
  K.prop('lighthouse', -2, -5, 0);
  // keeper's hut
  room(K, { x: -9.5, z: 4, w: 7, d: 6, wall: 'plank', roof: 'corrugated_red', trim: 'plank_dark', floor: 'plank', doors: [{ side: 'e', at: 1, w: 1.6 }], windows: [{ side: 's', w: 1.4 }, { side: 'n', at: -1.5, w: 1.2 }, { side: 'w', w: 1.2 }] });
  K.prop('bunkbed', -11.8, 5.9, 0); K.prop('table', -9.6, 2.3, 0); K.deployModel('furnace', -12.2, 2.0, 0);
  K.container('crate', -7.0, 1.9); K.container('food', -9.6, 6.3);
  K.light(-9.5, 4, 2.8, '#ffcf8a', 0.9, 8);
  // shed
  room(K, { x: -10.5, z: -7, w: 4, d: 4, wall: 'corrugated_rust', roof: 'corrugated', floor: 'concrete_dark', doors: [{ side: 'e', w: 1.4 }] });
  K.container('crate', -11.5, -8.2); K.container('barrel_oil', -11.6, -5.8); K.container('toolbox', -9.4, -8.4);
  K.prop('generator', -7.0, -11.0, 0);
  // pier + boat
  K.prop('dock', 7.5, 3, 0); K.prop('dock', 13.5, 3, 0);
  K.prop('boat', 12.5, -2.0, 0);
  for (const x of [10.5, 15.0]) K.cyl(x, 0.35, 0.16, 0.55, 'metal_dark', { seg: 8 });
  K.deployModel('lantern', 16.0, 5.6); K.light(16.0, 5.6, 1.4, '#ffd080', 1.2, 9);
  K.container('barrel', 5.6, 5.3); K.container('barrel', 6.5, 5.5); K.container('crate', 8.6, 5.1);
  lamp(K, 4.4, 8.4, 0);
  // rocks, trees, odds and ends
  K.prop('rock_big', 4.5, -11.5, 0); K.prop('rock_big', -3.5, 12.5, 0);
  K.veg('pine', -15, -5, 1); K.veg('pine', -14, 9.5, 0.9); K.veg('bush', 0, 12, 1); K.veg('bush', -6, 11.5, 1); K.veg('pine', -2, 15, 0.9);
  K.container('barrel', -5.4, 7.4); K.container('barrel_oil', -5.45, 2.4); K.container('crate', 1.8, -1.2, 0.3);
  K.container('crate', -4.5, 9); K.container('medbox', 3, 0);
}

// ============================================================================
// HOLLOW CREEK — farming village: 8 houses, barn, hall, field, well
// ============================================================================
function village(K) {
  K.label('Hollow Creek');
  K.ground(0, 0, 88, 5, 'dirt', { y: 0.025 });
  K.ground(0, -16.25, 4, 27.5, 'dirt', { y: 0.025 });
  K.ground(0, 6.5, 8, 6, 'gravel', { y: 0.03 });
  const porch = (x, z) => K.light(x, z, 2.5, '#ffcf8a', 0.9, 7);
  // --- north side houses (doors face the road)
  room(K, { x: -30, z: -9, w: 8, d: 6, wall: 'plank', roof: 'corrugated_red', trim: 'plank_dark', floor: 'plank', doors: [{ side: 's', at: 1.5, w: 1.5 }], windows: [{ side: 's', at: -2, w: 1.4 }, { side: 'w', w: 1.4 }, { side: 'n', at: 1.5, w: 1.4 }] });
  wallGaps(K, -31, -11.85, -31, -6.15, [[-10.6, -9.2]], { surf: 'plank' });
  K.prop('bunkbed', -32.5, -11.2, 0); K.prop('table', -28.3, -10.6, 0);
  K.container('locker', -33.4, -7.0); K.container('crate', -26.9, -7.0); K.container('food', -30.2, -11.2);
  porch(-28.5, -5.2);
  room(K, { x: -17, z: -9, w: 7, d: 6, wall: 'brick', roof: 'tile_dark', floor: 'plank_dark', doors: [{ side: 's', at: -1, w: 1.5 }], windows: [{ side: 's', at: 2, w: 1.4 }, { side: 'e', w: 1.4 }, { side: 'n', w: 1.4 }] });
  K.prop('table', -17, -9.6, 0); K.prop('bunkbed', -19.2, -11.2, 0);
  K.container('crate', -14.4, -11.2); K.container('food', -19.8, -7.0, Q);
  porch(-18, -5.2);
  room(K, { x: 14, z: -9.5, w: 7, d: 7, wall: 'corrugated', roof: 'corrugated_rust', floor: 'plank', doors: [{ side: 's', w: 1.5 }], windows: [{ side: 'w', at: 1.5, w: 1.4 }, { side: 'e', at: 1.5, w: 1.4 }, { side: 'n', w: 1.4 }] });
  wallGaps(K, 10.65, -10.4, 17.35, -10.4, [[15.2, 16.6]], { surf: 'corrugated' });
  K.prop('bunkbed', 12, -11.9, 0); K.prop('table', 12.0, -8.2, 0);
  K.container('medbox', 16.6, -12.3); K.container('crate', 16.4, -7.0);
  porch(14, -5.2);
  room(K, { x: 28, z: -9.5, w: 8, d: 7, wall: 'plank_dark', roof: 'corrugated_green', floor: 'plank', doors: [{ side: 's', at: -2, w: 1.5 }], windows: [{ side: 's', at: 2, w: 1.4 }, { side: 'e', w: 1.4 }, { side: 'n', at: -2, w: 1.4 }] });
  wallGaps(K, 28.6, -12.85, 28.6, -6.15, [[-8.4, -7.0]], { surf: 'plank_dark' });
  K.prop('table', 26.3, -10.4, 0); K.prop('bunkbed', 30.6, -12.2, 0);
  K.container('food', 24.9, -12.3); K.container('locker', 31.45, -7.0); K.container('crate', 29.6, -9.6, Q);
  porch(26, -5.2);
  // --- south side houses
  room(K, { x: -25, z: 9.5, w: 8, d: 7, wall: 'brick', roof: 'corrugated_red', floor: 'plank_dark', doors: [{ side: 'n', at: 2, w: 1.5 }], windows: [{ side: 'n', at: -2, w: 1.4 }, { side: 's', w: 1.4 }, { side: 'w', w: 1.4 }] });
  K.prop('bunkbed', -27.6, 12.2, 0); K.prop('table', -24.5, 10.0, 0);
  K.container('crate', -21.9, 12.2, Q); K.container('food', -28.3, 7.0, Q);
  porch(-23, 5.2);
  for (const x of [-28.5, -25.5, -22.5]) K.prop('fence_wood', x, 15.5, 0);
  room(K, { x: -10, z: 9, w: 6, d: 6, wall: 'plank', roof: 'plank_dark', floor: 'plank', doors: [{ side: 'n', w: 1.5 }], windows: [{ side: 'w', w: 1.2 }, { side: 'e', w: 1.2 }] });
  K.prop('bunkbed', -11.8, 11.2, 0); K.prop('table', -8.4, 9.5, Q);
  K.container('food', -12.3, 7.0, Q); K.container('crate', -8.0, 11.3);
  porch(-10, 5.2);
  room(K, { x: 12, z: 10, w: 8, d: 6, wall: 'corrugated_rust', roof: 'corrugated', floor: 'concrete_dark', doors: [{ side: 'n', at: -1.5, w: 1.5 }], windows: [{ side: 'n', at: 2, w: 1.4 }, { side: 'e', w: 1.4 }, { side: 's', at: -1, w: 1.4 }] });
  K.prop('workbench_old', 9.4, 12.3, 0); K.prop('table', 14.0, 9.6, 0);
  K.container('toolbox', 11.2, 12.4); K.container('crate', 15.1, 12.2, Q); K.container('barrel', 8.7, 7.8);
  porch(10.5, 6.2);
  room(K, { x: 27, z: 10.5, w: 7, d: 7, wall: 'plank', roof: 'tile_dark', floor: 'plank', doors: [{ side: 'n', w: 1.5 }], windows: [{ side: 'w', w: 1.4 }, { side: 'e', w: 1.4 }, { side: 's', w: 1.4 }] });
  wallGaps(K, 23.65, 11.2, 30.35, 11.2, [[24.2, 25.6]], { surf: 'plank' });
  K.prop('bunkbed', 28.8, 13.1, 0); K.prop('table', 28.5, 9.0, 0);
  K.container('locker', 30.0, 11.8); K.container('food', 24.3, 10.4);
  porch(27, 6.2);
  for (const x of [32, 35]) K.prop('fence_wood', x, 14.3, 0);
  // --- village hall + well
  room(K, { x: 0.5, z: 15, w: 9, d: 7, wall: 'white_paint', roof: 'corrugated_red', trim: 'plank_dark', floor: 'plank', doors: [{ side: 'n', w: 1.8 }], windows: [{ side: 'w', w: 1.4 }, { side: 'e', w: 1.4 }, { side: 's', at: -2, w: 1.2 }, { side: 's', at: 2, w: 1.2 }] });
  for (const z of [13.6, 15.2]) for (const x of [-2.0, 3.0]) K.prop('bench', x, z, 0);
  K.prop('table', 0.5, 17.6, 0);
  K.container('crate', 4.1, 12.4, Q); K.container('food', -3.0, 17.8);
  K.light(0.5, 15, 2.8, '#ffcf8a', 0.9, 9);
  well(K, 0, 6.5);
  // --- barn + water tower + field
  room(K, { x: -10, z: -24, w: 12, d: 9, h: 4.4, wall: 'plank_dark', roof: 'corrugated_red', trim: 'plank_dark', floor: 'dirt', doors: [{ side: 'e', w: 3.6 }, { side: 'w', at: 1, w: 2.0 }], windows: [{ side: 'n', at: -3, w: 1.4 }, { side: 's', at: 3, w: 1.4 }] });
  for (const [x, z] of [[-14.8, -27.4], [-13.5, -27.4], [-14.8, -20.8], [-13.5, -20.8]]) K.prop('haybale', x, z, 0);
  K.prop('haybale', -14.15, -27.4, 0, { y: 1.2, collide: false });
  K.prop('workbench_old', -7.5, -27.7, 0); K.prop('pallets', -11, -27.6, 0);
  K.container('toolbox', -5.3, -27.8); K.container('crate', -5.0, -20.4); K.container('barrel', -11.0, -20.2);
  K.light(-10, -24, 3.8, '#ffcf8a', 0.9, 10);
  K.prop('water_tower', 5.5, -15, 0);
  K.ground(18, -26.5, 24, 15, 'dirt', { y: 0.025 });
  for (let z = -32.5; z <= -20.5; z += 1.5) K.ground(18, z, 22, 0.45, 'grass', { y: 0.045, t: 0.03 });
  for (let x = 8; x <= 28; x += 2.5) for (const z of [-32.5, -29.5, -26.5]) K.veg('hemp', x, z, 1);
  for (const [x, z] of [[28, -21.0], [26.6, -21.3], [27.3, -22.6], [8.5, -21]]) K.prop('haybale', x, z, 0);
  for (let k = 0; k < 8; k++) K.prop('fence_wood', 7.5 + 3 * k, -34.2, 0);
  for (const x of [7.5, 10.5, 13.5, 19.5, 22.5, 25.5, 28.5]) K.prop('fence_wood', x, -18.8, 0);
  for (const z of [-32.5, -29.5, -26.5, -23.5, -20.5]) { K.prop('fence_wood', 5.8, z, Q); K.prop('fence_wood', 30.2, z, Q); }
  // yards, woodpiles, odds and ends
  for (const x of [-33.5, -30.5, -27.5, -24.5, -21.5, -18.5, -15.5]) K.prop('fence_wood', x, -13.8, 0);
  K.box(-35.5, -7.6, 0.8, 2.4, 0.9, 'log'); K.box(-21.5, 15.6, 1.3, 1.3, 2.3, 'plank_dark');
  K.ground(-10, 14.6, 5, 3, 'dirt', { y: 0.03 }); for (const x of [-11.8, -10, -8.2]) K.veg('berry_bush', x, 14.6, 0.9);
  K.prop('car', 21, 5.6, 0.15); K.prop('truck', -21, -24, Q); K.prop('tires', -18.6, -17.6, 0);
  K.box(33.6, -7.0, 0.8, 2.0, 0.9, 'log'); K.prop('pallets', 18.6, 13.0, 0); K.container('barrel', 6.6, -3.9);
  // lamps + trees
  for (const [x, z, r] of [[-36, 3.6, 0], [-18, 3.6, 0], [18, 3.6, PI], [36, 3.6, PI], [-9, -3.6, 0], [9, -3.6, PI], [36, -3.6, PI]]) lamp(K, x, z, r);
  for (const [k, x, z, s] of [['oak', -40, -10, 1.1], ['oak', -36, 16, 1], ['birch', -15, 18, 1], ['oak', 20, 18, 1], ['oak', 37, -12, 1], ['birch', 35, 17, 1],
    ['oak', -24, -20, 1.1], ['pine', -32, -24, 1], ['bush', 6, -6, 1], ['bush', -4, -9, 1], ['bush', 21, -12, 1], ['bush', -34, 4.5, 0.9], ['birch', -40, 8, 1], ['pine', 40, 8, 1]]) K.veg(k, x, z, s);
  // NPCs: bandit on the road, scavs north lane + field
  K.container('crate', -20, 0); K.container('medbox', 0, -4.5); K.container('toolbox', 16.5, -16.5); K.container('ammobox', 0, -28);
}

// ============================================================================
// SCAV CAMP — scrap-walled camp, tents, fires, tarp, lookout
// ============================================================================
function camp(K) {
  K.label('Scav Camp');
  K.ground(0, 0, 28, 28, 'dirt', { y: 0.02 });
  const wo = { h: 2.4, hv: 0.5, t: 0.35 };
  scrapWall(K, -13.2, -13, 13.2, -13, { ...wo, gaps: [[-2, 3]] });
  scrapWall(K, -13.2, 13, 13.2, 13, { ...wo, gaps: [[-4, 1.5]] });
  scrapWall(K, -13, -12.8, -13, 12.8, { ...wo, gaps: [[-6, -2]] });
  scrapWall(K, 13, -12.8, 13, 12.8, { ...wo, gaps: [[4, 8]] });
  climbTower(K, -10, -10, Q, { light: false }); K.light(-10, -10, 5.2, '#ffd9a0', 0.9, 10);
  for (const [x, z] of [[-9, 8], [-4.5, 9.5], [8.5, -8.5], [9.5, -3.5]]) K.prop('tent', x, z, 0);
  fire(K, 0, 0); K.box(0, -1.9, 1.6, 0.4, 0.4, 'log'); K.box(0, 1.9, 1.6, 0.4, 0.4, 'log'); K.box(-1.9, 0, 0.4, 1.6, 0.4, 'log');
  fire(K, -8.5, -3); K.box(-10.1, -3, 0.4, 1.4, 0.4, 'log');
  canopy(K, 4.5, 7.2, 5, 4.4, 2.3, 'tarp_blue');
  K.prop('table', 4.5, 7.6, 0);
  K.container('crate', 6.0, 8.6); K.container('food', 3.0, 6.3); K.container('toolbox', 5.9, 6.0);
  sandbagU(K, 0.5, -9.6, 'n'); K.prop('sandbags', 10.4, 6.0, Q);
  K.prop('car', 10.0, 10.3, 0.35); K.prop('pallets', -11.4, 1.0, 0); K.prop('tires', 11.5, -6.5, 0);
  K.container('crate', -11.6, 4.0, Q); K.container('crate', 11.4, 1.0, Q); K.container('food', -2.5, 11.6);
  K.container('barrel', 11.5, -11.5); K.container('barrel', 10.6, -11.7); K.container('barrel_oil', -11.5, 11.4);
  K.light(4.5, 7.2, 2.0, '#ffd9a0', 0.8, 7);
  K.npc('scav', 1.3, -1.0, {}); K.npc('scav', -1.2, 1.3, {}); K.npc('scav', -10, -10, {});
  K.npc('scav', -6, -6, { patrol: [[-6, -6], [6, -6], [6, 3.8], [-6, 3.8]] });
  K.npc('scav', -6.8, 11.6, {});
}

// ============================================================================
// STONE QUARRY — excavated pit with rock rims, crusher line, site office
// ============================================================================
function quarry(K) {
  K.label('Stone Quarry'); const R = K.R;
  K.ground(0, 0, 40, 40, 'gravel');
  K.ground(-6, -7, 22, 20, 'rock', { y: 0.035 });
  const rim = (x0, z0, x1, z1, hMin, hMax, t = 1.5) => {
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0); const L = alongX ? x1 - x0 : z1 - z0; let s = 0;
    while (s < L - 0.01) { const e = Math.min(L, s + 2.5 + R() * 2.5); const h = hMin + R() * (hMax - hMin); const m = (s + e) / 2;
      if (alongX) K.box(x0 + m, z0, e - s, t + R() * 0.4, h, 'rock'); else K.box(x0, z0 + m, t + R() * 0.4, e - s, h, 'rock'); s = e; }
  };
  rim(-18.5, -17.9, 5.5, -17.9, 2.4, 3.6); rim(-17.9, -17.2, -17.9, 3.2, 2.2, 3.4); rim(5.9, -17.2, 5.9, -12.2, 2.0, 3.0); rim(-17.2, 3.9, -7.0, 3.9, 1.6, 2.6);
  rim(-16.2, -16.3, 4.2, -16.3, 0.8, 1.2, 1.2); rim(-16.3, -15.5, -16.3, 1.6, 0.8, 1.2, 1.2);
  K.prop('rock_big', -17.5, -17.5, 0); K.prop('rock_big', 5.5, -16.5, 0); K.prop('rock_big', -16.5, 3.5, 0); K.prop('rock_big', -8.5, -17.6, 0); K.prop('rock_big', -17.6, -7.5, 0);
  for (const [x, z] of [[-11.5, -15], [-5.5, -15.2], [-15, -10.5], [0, -11], [-7.5, -6], [-11.5, -1.5], [3.5, -9.5]]) K.veg('rock_small', x, z, 1.2);
  K.prop('scaffold', -6, 9.0, 0); K.prop('workbench_old', 2.5, 9.5, 0);
  for (const [t, x, z] of [['stone', -13, -13], ['stone', -8, -13.5], ['stone', -3, -12.5], ['stone', -13.5, -6], ['stone', -10, -9], ['stone', -6, -1.5],
    ['metal', 1.5, -14], ['metal', -1, -8], ['metal', -13.5, 0.5], ['metal', 2.5, -4.5], ['sulfur', -9.5, -4], ['sulfur', -4.5, -6.5], ['sulfur', -2, -1.0]]) K.node(t, x, z);
  // crusher line
  K.prop('crusher', 12, -10, 0); K.prop('conveyor', 17, -10, 0); K.prop('conveyor', 7.75, -10, PI);
  K.cyl(22.5, -10, 2.5, 2.2, 'gravel', { rTop: 0.3, seg: 12 });
  K.prop('generator', 16, -3.5, 0); K.prop('drums', 13.5, 1.5, 0); K.prop('cable_spool', 9.5, 2.5, 0); K.prop('cable_spool', 11.2, -4.8, 0); K.prop('pallets', 19.5, 5.0, 0);
  K.prop('truck', -3, 12.5, 0);
  // site office
  room(K, { x: 16, z: 12, w: 8, d: 5, wall: 'corrugated_blue', roof: 'corrugated', trim: 'white_paint', floor: 'plank', doors: [{ side: 'w', w: 1.5 }], windows: [{ side: 'n', at: -1, w: 1.4 }, { side: 's', at: 1, w: 1.4 }, { side: 'e', w: 1.2 }] });
  K.prop('desk', 17.0, 10.2, 0); K.prop('table', 16.0, 13.6, 0);
  K.container('locker', 19.4, 13.9); K.container('toolbox', 13.2, 13.9); K.container('crate', 13.2, 10.2);
  K.light(16, 12, 2.8, '#fff0d0', 0.9, 8);
  K.container('barrel', 12.0, 3.5); K.container('barrel', 12.9, 3.9); K.container('barrel_oil', 18.5, -3.4); K.container('crate', 9.0, -7.0);
  flood(K, -15.5, 5.5, 0); flood(K, 7.5, -14.5, 0); lamp(K, 11, 15.5, PI);
  K.container('crate', -12, 6.5); K.container('ammobox', 14.5, 11.0); K.container('barrel', -6.5, -9.5);
}

// ============================================================================
// DISH ARRAY (green card) — fenced compound, three dishes, control building
// with a green-card server vault, irradiated core dish
// ============================================================================
function dish(K) {
  K.label('Dish Array');
  K.ground(0, 0, 54, 54, 'gravel', { y: 0.02 });
  K.ground(0, 11, 6, 32, 'concrete', { y: 0.035 }); K.ground(0, -7, 48, 4, 'concrete', { y: 0.034 }); K.ground(0, 31, 6, 8, 'asphalt');
  K.ground(-4.1, 9, 2.2, 3, 'concrete', { y: 0.035 });
  fenceLine(K, -27, -27, 27, -27); fenceLine(K, -27, 27, 27, 27, [[-3.5, 3.5]]); fenceLine(K, -27, -27, -27, 27); fenceLine(K, 27, -27, 27, 27);
  for (const s of [-1, 1]) K.box(s * 3.8, 27, 0.6, 0.6, 2.6, 'concrete_dark');
  // dishes
  for (const [x, z, r] of [[-15, -17, 0.35], [0, -19, -0.15], [15, -17, 0.6]]) { K.ground(x, z, 8, 8, 'concrete', { y: 0.036 }); K.prop('dish', x, z, r); flood(K, x + 3.2, z + 4.6, 0, 14); }
  K.rad(0, -19, 9, 8);
  K.prop('antenna', 20, 4, 0);
  // control building + green vault
  const ctrl = room(K, { x: -13, z: 9, w: 16, d: 10, h: 3.4, wall: 'concrete', roof: 'concrete_dark', trim: 'white_paint', floor: 'tile',
    doors: [{ side: 'e', w: 1.6 }, { side: 's', at: 3, w: 1.6 }], windows: [{ side: 'n', at: 4, w: 1.6 }, { side: 's', at: 6.5, w: 1.4 }, { side: 'e', at: -3, w: 1.4 }] });
  onRoof(K, ctrl, -9, 6, 2, 2, 1.6, 3.7, 'metal'); onRoof(K, ctrl, -18, 11, 1.2, 1.2, 0.8, 3.7, 'metal_dark');
  room(K, { x: -17.7, z: 9, w: 6, d: 9.4, h: 3.0, wall: 'concrete_dark', floor: false, roofProps: false, roof: 'concrete_dark', doors: [{ side: 'e', type: 'vault', card: 'green' }] });
  K.ground(-17.7, 9, 5.7, 9.1, 'metal_dark', { y: 0.075, t: 0.02 });
  K.box(-20.2, 9, 0.5, 2.4, 1.9, 'metal_dark');
  K.container('military', -19.4, 5.2); K.container('military', -19.4, 12.8); K.container('elite', -16.0, 12.9); K.container('ammobox', -16.0, 5.0);
  K.prop('desk', -12.5, 13.2, 0); K.prop('desk', -7.0, 13.2, 0); K.box(-5.75, 11.4, 0.7, 2.2, 2.0, 'metal_dark');
  K.container('medbox', -13.9, 4.8); K.container('crate', -8.0, 4.9);
  K.light(-10, 9, 3.0, '#e8f0ff', 1.0, 10); K.light(-17.7, 9, 2.6, '#a0ffb0', 0.8, 7);
  // gate booth, generator shed, transformers, towers
  room(K, { x: -7, z: 23, w: 3, d: 3, wall: 'concrete', roof: 'concrete_dark', doors: [{ side: 'e', w: 1.4 }], windows: [{ side: 's', w: 1.2 }, { side: 'n', w: 1.2 }] });
  room(K, { x: 16, z: 18, w: 7, d: 5, wall: 'corrugated', roof: 'corrugated_rust', floor: 'concrete_dark', doors: [{ side: 'w', w: 1.5 }], windows: [{ side: 's', w: 1.2 }] });
  K.prop('generator', 17.4, 18.6, 0); K.container('toolbox', 13.6, 19.8); K.container('crate', 18.6, 16.4);
  K.prop('transformer', 22.0, 16.5, 0); K.prop('transformer', 22.0, 19.5, 0);
  climbTower(K, -23.5, -23.5, 0); climbTower(K, 23.5, 23.5, PI);
  K.light(-23.5, -23.5, 5.2, '#fff2d8', 1.0, 12); K.light(23.5, 23.5, 5.2, '#fff2d8', 1.0, 12);
  sandbagU(K, 6.5, 22.5, 's'); sandbagU(K, -7.5, -3.0, 'n'); sandbagU(K, 7.5, -3.0, 'n');
  boxStack(K, 21.5, -1.5, Q, 2); boxStack(K, 24.2, -1.5, Q, 1); boxStack(K, -22, 20, 0, 1);
  K.prop('truck', -18, -1, 0); K.prop('pylon', -24.0, 2.5, 0); K.prop('cable_spool', -12.5, -1.0, 0);
  for (const [x, z, r] of [[3.8, 20, PI], [3.8, 6, PI], [-3.8, -1.5, 0], [-24, -7, 0], [24, -9.5, PI]]) lamp(K, x, z, r);
  K.container('barrel', 25.5, 10); K.container('barrel', 25.6, 11); K.container('barrel', -25, -2); K.container('crate', 24.3, -5.4);
  K.container('ammobox', 7.5, -2.6); K.container('military', 17.8, 6.5); K.container('crate', -24.5, 18.0, Q);
  K.npc('soldier', -23, -7, { patrol: [[-23, -7], [23, -7]] });
  K.npc('bandit', 0, 25, { patrol: [[0, 25], [0, -3]] });
  K.npc('soldier', 9, 10.5, { patrol: [[9, 10.5], [25, 10.5]] });
  K.npc('soldier', -11.5, 9.5, {});
  K.npc('bandit', -7.3, 23.2, {});
  K.npc('bandit', 11.2, 18, {});
}

// ============================================================================
// HARBOR (green card) — quay with cranes, container yard, warehouses,
// dock office with a green-card vault, piers and boats
// ============================================================================
function harbor(K) {
  K.label('Harbor');
  K.ground(-8, 0, 64, 52, 'concrete', { y: 0.02 }); K.ground(-3, -31, 54, 10, 'concrete', { y: 0.02 }); K.ground(-3, 31, 54, 10, 'concrete', { y: 0.02 });
  K.ground(20, 0, 8, 72, 'concrete_dark', { y: 0.035 }); K.ground(23.6, 0, 0.3, 72, 'yellow_paint', { y: 0.045, t: 0.02 });
  K.ground(-12, 0, 56, 6, 'asphalt', { y: 0.034 }); dashes(K, -39, 0, 15, 0, 3, 3);
  // the seaward quay is the cargo ship's berth (hull from x 28.5 out), so it stays clear of piers and boats
  for (const z of [-30, -16, -2, 13, 21, 32]) K.cyl(23.3, z, 0.22, 0.6, 'metal_dark', { seg: 8 });
  K.prop('crane', 20, -9, 0); K.prop('crane', 20, 16, 0);
  K.light(20, -9, 15, '#fff2d8', 1.2, 18); K.light(20, 16, 15, '#fff2d8', 1.2, 18);
  for (const z of [-26, 0, 28]) lamp(K, 17, z, 0);
  // container yard
  for (const z of [-9, 9]) for (const x of [-13, -10.5, -8, -5.5]) boxStack(K, x, z, Q, 1 + Math.floor(K.R() * 2.4));
  for (const x of [4.5, 11]) { for (const z of [-21, -18.4, -15.8]) boxStack(K, x, z, 0, 1 + Math.floor(K.R() * 2.2)); for (const z of [15.8, 18.4, 21]) boxStack(K, x, z, 0, 1 + Math.floor(K.R() * 2.2)); }
  boxStack(K, -11, -28.5, 0, 2); boxStack(K, -4.5, -28.5, 0, 1);
  // warehouses
  room(K, { x: -30, z: -17, w: 16, d: 12, h: 5.5, wall: 'corrugated', roof: 'corrugated_rust', floor: 'concrete_dark',
    doors: [{ side: 'e', w: 4.0 }, { side: 'n', at: 4, w: 1.6 }, { side: 's', at: -4, w: 1.6 }], windows: [{ side: 'w', w: 2 }, { side: 's', at: 3, w: 2 }] });
  for (const x of [-35.5, -32.5]) { K.prop('shelf', x, -14.0, 0); K.prop('shelf', x, -20.0, 0); }
  K.prop('container', -27.5, -17, 0, { color: '#3e6a8e' }); K.prop('pallets', -28, -13.0, 0); K.prop('pallets', -26.6, -13.0, 0);
  K.container('crate', -27.2, -21.8); K.container('crate', -36.8, -17.0, Q); K.container('barrel', -23.0, -22.0); K.container('toolbox', -30.0, -12.2);
  // mezzanine along the west wall, stairs up along the north wall
  K.floor(-35.9, -17, 3.8, 11.6, 3.0, 'metal_dark', { t: 0.22 });
  K.stairs(-31.75, -21.7, 1.4, 4.5, 0, 3.0, '-x', 'metal_dark', { side: 'yellow_paint' });
  { const rail = (x, z, w, d, h, y) => { const mm = K.box(x, z, w, d, h, 'yellow_paint', y ? { y } : {}); return mm; };
    rail(-34.0, -15.95, 0.1, 9.5, 1.0, 3.0);                       // mezzanine edge rail, open over the stair top
    const side = K.box(-31.75, -20.95, 4.5, 0.1, 3.9, 'concrete'); if (side) side.removeFromParent();
    for (let x = -37.2; x <= -34.6; x += 1.3) K.box(x, -17, 0.12, 11.4, 0.1, 'metal_dark', { y: 2.75, collide: false }); }
  K.container('military', -36.9, -21.5, 0, { y: 3.0 }); K.container('toolbox', -36.9, -12.6, 0, { y: 3.0 }); K.container('ammobox', -35.0, -18.5, Q, { y: 3.0 });
  K.light(-34, -17, 4.8, '#fff0d0', 1.0, 12); K.light(-25, -17, 4.8, '#fff0d0', 1.0, 12);
  room(K, { x: -30, z: 17, w: 16, d: 12, h: 5.5, wall: 'corrugated_blue', roof: 'corrugated', floor: 'concrete_dark',
    doors: [{ side: 'e', w: 4.0 }, { side: 's', at: 4, w: 1.6 }, { side: 'n', at: -4, w: 1.6 }], windows: [{ side: 'w', w: 2 }, { side: 'n', at: 3, w: 2 }] });
  for (const x of [-35.5, -32.5]) { K.prop('shelf', x, 14.0, 0); K.prop('shelf', x, 20.0, 0); }
  K.prop('drums', -26.5, 21.5, 0); K.prop('pallets', -28.5, 12.6, 0); K.prop('cable_spool', -25.5, 13.0, 0);
  K.container('crate', -36.8, 17.0, Q); K.container('food', -33.0, 21.9); K.container('ammobox', -24.0, 21.8); K.container('barrel_oil', -23.0, 12.0);
  K.light(-34, 17, 4.8, '#fff0d0', 1.0, 12); K.light(-25, 17, 4.8, '#fff0d0', 1.0, 12);
  // dock office + green vault
  room(K, { x: 6, z: -31, w: 10, d: 7, wall: 'brick', roof: 'concrete_dark', trim: 'white_paint', floor: 'tile',
    doors: [{ side: 's', at: 2, w: 1.6 }], windows: [{ side: 's', at: 4, w: 1.2 }, { side: 'e', w: 1.4 }, { side: 'n', at: 2.5, w: 1.4 }] });
  room(K, { x: 3.1, z: -31, w: 3.6, d: 6.4, h: 2.9, wall: 'concrete_dark', floor: false, roofProps: false, doors: [{ side: 'e', type: 'vault', card: 'green' }] });
  K.ground(3.1, -31, 3.3, 6.1, 'metal_dark', { y: 0.075, t: 0.02 });
  K.container('military', 2.9, -33.3); K.container('military', 2.9, -28.7); K.container('elite', 2.1, -31.0, Q); K.container('ammobox', 4.2, -33.4, Q);
  K.prop('desk', 7.5, -33.8, 0); K.container('locker', 10.4, -33.9); K.container('medbox', 10.3, -28.3); K.container('crate', 5.8, -28.4, Q);
  K.light(8, -31, 2.8, '#e8f0ff', 0.9, 9);
  // yard clutter
  K.recycler(12.5, 4.8, 0);
  K.prop('truck', -25, -6, 0); K.prop('truck', 6, 5.0, 0);
  K.prop('cable_spool', -6.5, -14.8, 0); K.prop('drums', -1.0, 13.2, 0); K.prop('pallets', -17.0, -12.5, 0); K.prop('pallets', -17.0, 13.0, 0);
  for (const [x, z, r] of [[0, 3.8, 0], [-20, -3.8, 0], [-20, 25.5, 0], [4, -25.5, 0]]) lamp(K, x, z, r);
  K.container('barrel', -1.0, -4.2); K.container('barrel', 13.8, -24.5); K.container('barrel', 13.0, -25.3); K.container('crate', 14.0, 9.5, Q);
  K.container('ammobox', -15.0, -9.0, Q); K.container('military', 18.5, -3.5); K.container('crate', -16.5, 6.5);
  K.npc('bandit', 15, -10, { patrol: [[15, -26], [15, 26]] });
  K.npc('bandit', -20, 0, { patrol: [[-36, 0], [12, 0]] });
  K.npc('bandit', -1.5, -14, { patrol: [[-1.5, -12], [-1.5, -24]] });
  K.npc('bandit', -24.5, -21.5, {}); K.npc('bandit', -24.0, 15.5, {}); K.npc('bandit', 8.0, -25.5, {});
}

// ============================================================================
// TRAIN YARD (blue card + fuse) — tracks, rolling stock, repair shed,
// control tower with a powered blue-card vault, substation fuse box
// ============================================================================
function trainyard(K) {
  K.label('Train Yard');
  K.ground(0, 2, 84, 46, 'gravel', { y: 0.02 });
  for (const z of [-16, -10, -4]) for (let k = 0; k < 14; k++) K.prop('rails', -39 + 6 * k, z, 0);
  for (let k = 0; k < 10; k++) K.prop('rails', -39 + 6 * k, 12, 0);
  K.box(18.6, 12, 0.6, 2.4, 1.2, 'red_paint');
  // rolling stock (gaps leave crossing lanes at x -13..-8 and both ends)
  const car = (x, z, surf) => { K.prop('train_car', x, z, 0); void surf; };
  car(-32, -16); car(-19.5, -16); car(-2, -16); car(10.5, -16); car(23, -16);
  const tanker = (x, z) => { K.box(x, z, 11, 2.6, 1.0, 'metal_dark'); K.prop('tank_h', x - 2.6, z, 0, { y: 1.0, collide: false }); K.prop('tank_h', x + 2.6, z, 0, { y: 1.0, collide: false }); };
  tanker(-26, -10);
  K.prop('locomotive', 31, -10, 0); car(17.5, -10);
  car(-28, -4); car(2.5, -4);
  // repair shed
  room(K, { x: -8, z: 14, w: 32, d: 13, h: 6.5, wall: 'corrugated', roof: 'corrugated_rust', trim: 'metal_dark', floor: 'concrete_dark',
    doors: [{ side: 'w', at: -2, w: 5 }, { side: 'e', at: -2, w: 5 }, { side: 'n', at: 8, w: 2 }, { side: 's', at: -10, w: 1.6 }],
    windows: [{ side: 'n', at: -10, w: 2 }, { side: 'n', at: -3, w: 2 }, { side: 's', at: 3, w: 2 }, { side: 's', at: 10, w: 2 }] });
  K.prop('locomotive', -9, 12, 0);
  K.prop('scaffold', -12, 15.3, 0); K.prop('scaffold', -6, 15.3, 0);
  K.prop('workbench_old', -20.5, 19.6, 0); K.prop('workbench_old', 3.5, 19.6, 0); K.prop('cable_spool', 0.5, 16.5, 0); K.prop('drums', -22.6, 18.6, 0); K.prop('pallets', -3, 19.3, 0);
  K.container('toolbox', -22.9, 17.0, Q); K.container('crate', 6.7, 17.0, Q); K.container('crate', 6.7, 18.6, Q); K.container('barrel', 5.0, 8.4); K.container('barrel', 6.0, 8.6);
  K.light(-15, 14, 5.8, '#fff0d0', 1.3, 16); K.light(1, 14, 5.8, '#fff0d0', 1.3, 16);
  // control tower + blue vault (needs power)
  const tower = room(K, { x: 28, z: 14, w: 10, d: 9, h: 3.6, wall: 'brick', roof: 'concrete_dark', trim: 'white_paint', floor: 'tile',
    doors: [{ side: 's', at: -2, w: 1.6 }, { side: 'w', at: -2, w: 1.6 }], windows: [{ side: 'n', at: -2.5, w: 1.4 }, { side: 'w', at: 2.5, w: 1.4 }] });
  onRoof(K, tower, 26, 14, 5, 5, 2.4, 3.95, M.mat('#41525c', { cut: true, transparent: true, opacity: 0.78 }));
  onRoof(K, tower, 26, 14, 5.6, 5.6, 0.3, 6.35, 'concrete_dark'); onRoof(K, tower, 26, 14, 5.4, 5.4, 0.2, 3.75, 'metal_dark');
  room(K, { x: 31.0, z: 14, w: 3.4, d: 8.4, h: 3.2, wall: 'concrete_dark', floor: false, roofProps: false, doors: [{ side: 'w', type: 'vault', card: 'blue', fuse: true }] });
  roofDeck(K, 23, 9.5, 33, 18.5, 3.78, { avoid: [[26, 18.5, 2.2], [23, 12, 2.2]], blocks: [[23.4, 11.4, 28.6, 16.6, 2.6]], loot: [['ammobox', 31.6, 10.4], ['crate', 31.6, 17.6, Q]] });
  K.ground(31, 14, 3.1, 8.1, 'metal_dark', { y: 0.075, t: 0.02 });
  K.container('military', 31.0, 10.7); K.container('military', 31.0, 17.3); K.container('elite', 31.7, 14.0, Q); K.container('ammobox', 30.2, 16.0, Q);
  K.prop('desk', 26.5, 10.1, 0); K.container('locker', 28.8, 17.9); K.container('medbox', 23.7, 17.8, Q); K.container('crate', 28.3, 11.0, Q);
  K.light(26, 14, 3.0, '#e8f0ff', 0.9, 9);
  // substation with the fuse box
  room(K, { x: -34, z: 22, w: 6, d: 5, wall: 'brick', roof: 'concrete_dark', floor: 'concrete_dark', doors: [{ side: 'e', w: 1.5 }], windows: [{ side: 's', w: 1.2 }] });
  K.fusebox(-36.6, 21.0, 0); K.prop('generator', -33.5, 23.6, 0); K.container('toolbox', -36.2, 23.9);
  K.light(-34, 22, 2.8, '#ffe0b0', 0.8, 7);
  K.prop('transformer', -28.5, 22.5, 0); K.prop('transformer', -28.5, 20.5, 0); K.prop('pylon', -40, 3, 0);
  K.prop('water_tower', 14, 22, 0); boxStack(K, 12, -21.5, 0, 2); boxStack(K, 18.5, -21.5, 0, 1);
  K.prop('cable_spool', -6, 22.5, 0); K.prop('pallets', -10, 22.6, 0);
  // lamps, clutter, loot
  for (const x of [-32, -12, 12, 32]) lamp(K, x, 6.0, 0);
  for (const x of [-30, 0, 30]) lamp(K, x, -20, 0);
  K.box(-36, -20.5, 2.6, 1.2, 0.6, 'plank_dark'); K.box(-36, -20.5, 2.6, 1.2, 0.6, 'plank_dark', { y: 0.6, collide: false });
  K.container('crate', -11, -7.0); K.container('barrel', 40, -20); K.container('barrel', 39.2, -20.4); K.container('crate', -38.5, -7, Q);
  K.container('ammobox', -26.5, 18.0); K.container('military', 40, -13, Q); K.container('barrel_oil', -24.5, 6.4);
  K.npc('soldier', -40, -13, { patrol: [[-40, -13], [37, -13]] });
  K.npc('bandit', -36, 4.5, { patrol: [[-36, 4.5], [36, 4.5]] });
  K.npc('soldier', 21, 7.2, { patrol: [[21, 7.2], [35.5, 7.2], [35.5, 20.5], [21, 20.5]] });
  K.npc('soldier', 25.0, 14.5, {}); K.npc('bandit', -20.0, 16.5, {}); K.npc('soldier', -29.5, 18.9, {}); K.npc('bandit', 39, -7.0, {});
}

// ============================================================================
// WATER TREATMENT (blue card + fuse) — clarifiers, aeration basins (irradiated),
// pump house with the fuse box, admin building with a powered blue vault
// ============================================================================
function water(K) {
  K.label('Water Treatment');
  K.ground(0, 0, 76, 50, 'concrete', { y: 0.02 }); K.ground(0, -31, 50, 12, 'concrete', { y: 0.02 }); K.ground(0, 31, 50, 12, 'concrete', { y: 0.02 });
  K.ground(0, 12.5, 76, 4, 'asphalt', { y: 0.034 }); dashes(K, -36, 12.5, 36, 12.5, 3, 3);
  // round clarifiers
  for (const [x, z, a] of [[-26, -15, 0], [-26, 2, 1], [-10, -24, 2]]) {
    K.cyl(x, z, 7, 1.5, 'concrete', { seg: 28, opaque: false });
    K.cyl(x, z, 6.5, 0.05, '#3e6e7c', { y: 1.5, collide: false, seg: 28 });
    K.cyl(x, z, 0.7, 2.6, 'metal_dark', { collide: false, seg: 10 });
    const ax = a === 1 ? 0 : 3.4, az = a === 1 ? 3.4 : 0;
    K.box(x + ax, z + az, a === 1 ? 0.7 : 6.8, a === 1 ? 6.8 : 0.7, 0.25, 'metal', { y: 1.7, collide: false });
    K.box(x + ax + (a === 1 ? 0.33 : 0), z + az + (a === 1 ? 0 : 0.33), a === 1 ? 0.05 : 6.8, a === 1 ? 6.8 : 0.05, 0.55, 'yellow_paint', { y: 1.95, collide: false });
  }
  // aeration basins (contaminated)
  for (const x0 of [2, 15]) {
    const cx = x0 + 5.5;
    K.box(cx, -32, 11.5, 0.5, 1.4, 'concrete', { opaque: false }); K.box(cx, -16, 11.5, 0.5, 1.4, 'concrete', { opaque: false });
    K.box(x0, -24, 0.5, 15.5, 1.4, 'concrete', { opaque: false }); K.box(x0 + 11, -24, 0.5, 15.5, 1.4, 'concrete', { opaque: false });
    K.ground(cx, -24, 10.5, 15.5, '#56806a', { y: 1.15, t: 0.05 });
    for (let z = -29; z <= -19; z += 5) K.cyl(cx, z, 0.9, 0.06, '#d8e4dc', { y: 1.16, collide: false, seg: 10 });
  }
  K.box(14, -24, 2, 16, 0.2, 'metal', { y: 1.4, collide: false });
  K.rad(14, -24, 12, 8);
  K.prop('drums', -4.0, -12.0, 0); K.prop('drums', 27.5, -14.0, 0);
  // pipes + tanks
  for (const x of [-14, -8, -2]) K.prop('pipes', x, -6.5, 0);
  K.prop('tank_v', 32, -6, 0); K.prop('tank_v', 32, 0, 0); K.prop('tank_v', 37.5, -3, 0); K.prop('tank_h', 36, 9, Q);
  // pump house (fuse box)
  room(K, { x: 12, z: 2, w: 12, d: 8, h: 4.2, wall: 'brick', roof: 'corrugated', trim: 'concrete_dark', floor: 'concrete_dark',
    doors: [{ side: 'w', at: 2, w: 1.6 }, { side: 's', at: -3, w: 2.0 }], windows: [{ side: 'n', at: -3, w: 1.6 }, { side: 'n', at: 3, w: 1.6 }, { side: 'e', w: 1.4 }] });
  K.prop('tank_h', 13.5, 1.0, 0); K.prop('generator', 14.5, 4.6, 0); K.prop('pipes', 12, -1.2, 0);
  K.fusebox(6.45, 0.5, 0);
  K.container('toolbox', 17.2, 5.3, Q); K.container('crate', 7.0, -1.2, Q);
  K.light(12, 2, 3.6, '#fff0d0', 1.0, 10);
  // admin building + blue vault (needs power)
  room(K, { x: -14, z: 22, w: 16, d: 10, h: 3.4, wall: 'concrete', roof: 'concrete_dark', trim: 'blue_paint', floor: 'tile',
    doors: [{ side: 'n', at: 3, w: 1.6 }, { side: 'e', w: 1.6 }], windows: [{ side: 'n', at: -1, w: 1.4 }, { side: 'n', at: 6, w: 1.4 }, { side: 's', at: 2, w: 1.6 }, { side: 's', at: 6, w: 1.4 }] });
  room(K, { x: -18.85, z: 22, w: 5.7, d: 9.4, h: 3.0, wall: 'concrete_dark', floor: false, roofProps: false, doors: [{ side: 'e', type: 'vault', card: 'blue', fuse: true }] });
  K.ground(-18.85, 22, 5.4, 9.1, 'metal_dark', { y: 0.075, t: 0.02 });
  K.container('military', -20.2, 18.2); K.container('military', -20.2, 25.8); K.container('elite', -17.0, 25.8); K.container('ammobox', -17.0, 18.2);
  K.prop('desk', -12.0, 26.2, 0); K.prop('desk', -8.5, 26.2, 0);
  K.container('locker', -6.6, 18.0); K.container('medbox', -15.2, 17.8); K.container('crate', -6.9, 25.0, Q);
  K.light(-10, 22, 3.0, '#e8f0ff', 0.9, 10); K.light(-18.85, 22, 2.6, '#a0c0ff', 0.7, 7);
  // chemical tanks, parking, gate hut (south)
  K.prop('tank_v', 10, 22, 0); K.prop('tank_v', 16, 22, 0); K.prop('silo', 26, 24, 0);
  K.wall(6.5, 18.5, 30.5, 18.5, 0.9, 'concrete', { thick: 0.35 }); K.wall(6.5, 18.5, 6.5, 26, 0.9, 'concrete', { thick: 0.35 });
  K.ground(12, 31, 22, 8, 'asphalt', { y: 0.034 });
  for (let k = 0; k < 7; k++) K.ground(2.5 + 3 * k, 31.5, 0.12, 4.5, 'white_paint', { y: 0.05, t: 0.02 });
  K.prop('truck', 7.5, 31.5, Q); K.prop('car', 13.5, 31.5, Q + 0.08); K.prop('car', 19.5, 31.5, Q - 0.1);
  K.prop('pipes', -16.5, -3, Q); K.prop('pipes', -16.5, 3, Q);
  // lights + loot + patrols
  for (const x of [-30, 2, 24]) lamp(K, x, 15, 0);
  flood(K, -18, -8, 0); flood(K, 0.5, -33, 0); flood(K, 27.5, -33, 0);
  K.container('barrel', 34, -14); K.container('barrel', 34.8, -13.6); K.container('barrel_oil', -36, 14); K.container('crate', 24.5, 3.0);
  K.container('crate', -36.0, -24.0); K.container('ammobox', 14, -11.5); K.container('military', 36.5, 0, Q); K.container('barrel', -2.5, 6.0);
  K.npc('soldier', -34, 12.5, { patrol: [[-34, 12.5], [34, 12.5]] });
  K.npc('soldier', -0.6, -33, { patrol: [[-0.6, -33], [-0.6, -9]] });
  K.npc('soldier', 29, -12, { patrol: [[29, -12], [29, -30]] });
  K.npc('soldier', -36.5, -20, { patrol: [[-36.5, -20], [-36.5, 10]] });
  K.npc('soldier', -9, 21, {}); K.npc('soldier', 8.5, 2.0, {}); K.npc('soldier', 14, -14.5, {});
}

// ============================================================================
// OUTLAW FORT — raidable base from real destructible pieces on the 3 m grid
// (forts are never rotated). Closed high-wall ring (no gate: breach it), a
// keep with a bunk wing, hall, armored loot room, workshop and a low-walled
// firing terrace, plus two wooden guard huts in the yard. Every way in is a
// closed door, a window or a low wall.
// ============================================================================
function fort(K) {
  K.label('Outlaw Fort'); const R = K.R;
  const cx = i => K.cellX(i) + 1.5, cz = j => K.cellZ(j) + 1.5;
  const hw = R() < 0.5 ? 'highwall_stone' : 'highwall_wood';
  const tier = R() < 0.55 ? 'stone' : 'metal', strong = tier === 'stone' ? 'metal' : 'armored';
  K.ground(K.cellX(0), K.cellZ(0), 30, 30, 'dirt', { y: 0.02 });
  // outer ring: cells -5..4 inside
  for (let i = -5; i <= 4; i++) { K.piece(hw, 'wood', i, -5, 'h'); K.piece(hw, 'wood', i, 5, 'h'); }
  for (let j = -5; j <= 4; j++) { K.piece(hw, 'wood', -5, j, 'v'); K.piece(hw, 'wood', 5, j, 'v'); }
  // keep: cells i -3..2, j -2..1. West wing = bunks, centre north = loot, centre south = hall,
  // east north = workshop, east south = open terrace behind low walls.
  const terrace = (i, j) => i >= 1 && j >= 0;
  for (let i = -3; i <= 2; i++) for (let j = -2; j <= 1; j++) { K.piece('foundation', tier, i, j); if (!terrace(i, j)) K.piece('ceiling', tier, i, j); }
  const W = (type, t, i, j, e, door) => K.piece(type, t, i, j, e, door);
  // north face (h, cj -2)
  W('window', tier, -3, -2, 'h'); W('wall', tier, -2, -2, 'h'); W('wall', strong, -1, -2, 'h'); W('wall', strong, 0, -2, 'h'); W('window', tier, 1, -2, 'h'); W('wall', tier, 2, -2, 'h');
  // south face (h, cj 2): main door into the hall, low walls on the terrace
  W('window', tier, -3, 2, 'h'); W('wall', tier, -2, 2, 'h'); W('doorway', tier, -1, 2, 'h', 'door_metal'); W('window', tier, 0, 2, 'h'); W('lowwall', tier, 1, 2, 'h'); W('lowwall', tier, 2, 2, 'h');
  // west face (v, ci -3) and east face (v, ci 3)
  W('wall', tier, -3, -2, 'v'); W('window', tier, -3, -1, 'v'); W('wall', tier, -3, 0, 'v'); W('window', tier, -3, 1, 'v');
  W('wall', tier, 3, -2, 'v'); W('window', tier, 3, -1, 'v'); W('lowwall', tier, 3, 0, 'v'); W('lowwall', tier, 3, 1, 'v');
  // bunk wing | centre (v, ci -1)
  W('wall', strong, -1, -2, 'v'); W('wall', strong, -1, -1, 'v'); W('doorway', tier, -1, 0, 'v', 'door_metal'); W('wall', tier, -1, 1, 'v');
  // loot | hall (h, cj 0) — the armored door
  W('wall', strong, -1, 0, 'h'); W('doorway', strong, 0, 0, 'h', 'door_armored');
  // centre | east (v, ci 1): loot room walls, hall side door to the terrace
  W('wall', strong, 1, -2, 'v'); W('wall', strong, 1, -1, 'v'); W('doorway', tier, 1, 0, 'v', 'door_metal'); W('wall', tier, 1, 1, 'v');
  // workshop | terrace (h, cj 0)
  W('doorway', tier, 1, 0, 'h', 'door_metal'); W('wall', tier, 2, 0, 'h');
  // guard huts (wood): NE hut door faces south, SW hut door faces north
  for (const [i0, j0, doorSouth] of [[2, -4, true], [-4, 3, false]]) {
    for (let i = i0; i <= i0 + 1; i++) { K.piece('foundation', 'wood', i, j0); K.piece('ceiling', 'wood', i, j0); }
    W(doorSouth ? 'window' : 'doorway', 'wood', i0, j0, 'h', doorSouth ? undefined : 'door_wood'); W('wall', 'wood', i0 + 1, j0, 'h');
    W(doorSouth ? 'doorway' : 'window', 'wood', i0 + 1, j0 + 1, 'h', doorSouth ? 'door_wood' : undefined); W('wall', 'wood', i0, j0 + 1, 'h');
    W('window', 'wood', i0, j0, 'v'); W('wall', 'wood', i0 + 2, j0, 'v');
  }
  // loot room (cells -1..0, -2..-1)
  K.container('elite', cx(0), cz(-2)); K.container('military', cx(-1), cz(-2)); K.container('military', cx(0) + 0.3, cz(-1) + 0.6);
  // bunks, hall, workshop, huts, yard
  K.container('ammobox', cx(-3), cz(1) + 0.8); K.container('medbox', cx(-2) + 0.6, cz(-2) - 0.6); K.container('food', cx(-1) - 0.4, cz(1) + 0.8);
  K.container('crate', cx(0) + 0.6, cz(1) + 0.7); K.container('toolbox', cx(2) + 0.6, cz(-2) - 0.7);
  K.container('crate', cx(3) + 0.3, cz(-4)); K.container('crate', cx(-4), cz(3) - 0.2); K.container('barrel', cx(4), cz(3)); K.container('barrel', cx(4) + 0.4, cz(3) + 0.85);
  K.deploy('sleeping_bag', cx(-3), cz(-2)); K.deploy('sleeping_bag', cx(-2), cz(-1)); K.deploy('sleeping_bag', cx(-3), cz(0));
  K.deploy('workbench1', cx(2) + 0.6, cz(-1), 0); K.deploy('furnace', cx(1), cz(-2) - 0.3);
  K.deploy('lantern', cx(-1) + 0.9, cz(0) - 0.9); K.deploy('campfire', cx(2), cz(3)); K.deploy('furnace', cx(-4), cz(-4));
  K.light(cx(2), cz(3), 1.2, '#ff9a40', 1.5, 10); K.light(cx(-0.5), cz(0.5), 2.0, '#ffd9a0', 1.0, 8); K.light(cx(1.5), cz(0.5), 2.0, '#ffd9a0', 0.8, 8);
  K.light(cx(-4), cz(-4), 3.0, '#ffd9a0', 0.8, 10); K.light(cx(3), cz(-3), 3.0, '#ffd9a0', 0.8, 10);
  // outlaws: hall, bunks, loot room, terrace, two on yard patrol
  K.npc('outlaw', cx(-1), cz(1) - 0.3, {}); K.npc('outlaw', cx(-2), cz(0), {}); K.npc('outlaw', cx(-1) + 0.5, cz(-1), {}); K.npc('outlaw', cx(1) + 0.6, cz(1), {});
  const loop = [[cx(-4), cz(-3)], [cx(3), cz(-3)], [cx(3), cz(2)], [cx(-4), cz(2)]];
  K.npc('outlaw', loop[0][0], loop[0][1], { patrol: loop });
  K.npc('outlaw', loop[2][0], loop[2][1], { patrol: [loop[2], loop[3], loop[0], loop[1]] });
}

// ============================================================================
// AIRFIELD — runway, apron, three hangars, control tower, fuel depot,
// wrecks, blue-card bunker with elite crates
// ============================================================================
function planeBody(K, x, z, s = 1, surf = 'white_paint') {
  // small twin-prop transport parked on its gear (boxes only: the kit has no free rotation)
  const y = 0.6 * s, f = 1.6 * s;
  K.box(x - 0.4 * s, z, 7.6 * s, f, f, surf, { y });
  K.box(x + 3.9 * s, z, 1.0 * s, f * 0.8, f * 0.75, surf, { y: y + 0.1 * s, collide: false });
  K.box(x + 4.5 * s, z, 0.25 * s, f * 0.62, f * 0.32, 'glass_dark', { y: y + f * 0.5, collide: false });
  K.box(x - 4.9 * s, z, 1.6 * s, f * 0.6, f * 0.6, surf, { y: y + f * 0.35, collide: false });
  K.box(x + 0.8 * s, z, 2.2 * s, 12 * s, 0.22 * s, surf, { y: y + f * 0.62, collide: false });
  for (const sz of [-1, 1]) {
    K.box(x + 1.6 * s, z + sz * 2.6 * s, 2.2 * s, 0.7 * s, 0.7 * s, 'metal_dark', { y: y + f * 0.4, collide: false });
    K.box(x + 2.75 * s, z + sz * 2.6 * s, 0.08, 2.0 * s, 0.18 * s, 'metal_dark', { y: y + f * 0.6, collide: false });
    K.box(x + 1.0 * s, z + sz * 1.1 * s, 0.25, 0.25, y, 'metal_dark', { collide: false });
  }
  K.box(x + 3.2 * s, z, 0.2, 0.2, y + 0.05, 'metal_dark', { collide: false });
  K.box(x - 5.2 * s, z, 1.2 * s, 4.2 * s, 0.14 * s, surf, { y: y + f * 0.75, collide: false });
  K.box(x - 5.3 * s, z, 1.3 * s, 0.14 * s, 1.7 * s, 'red_paint', { y: y + f * 0.8, collide: false });
}
function airfield(K) {
  K.label('Airfield');
  // runway
  K.ground(0, -28, 116, 12, 'asphalt', { y: 0.03 });
  K.ground(0, -33.4, 112, 0.3, 'white_paint', { y: 0.045, t: 0.02 }); K.ground(0, -22.6, 112, 0.3, 'white_paint', { y: 0.045, t: 0.02 });
  dashes(K, -48, -28, 48, -28, 4, 4, 'white_paint', 0.35);
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) K.ground(s * 53.5, -32.0 + k * 1.6, 4, 0.7, 'white_paint', { y: 0.045, t: 0.02 });
  K.ground(-14, -18, 10, 8, 'asphalt', { y: 0.03 });
  K.ground(-6, 0, 58, 28, 'concrete', { y: 0.03 }); K.ground(27, 10, 8, 20, 'concrete', { y: 0.03 });
  K.ground(-42, 10.5, 14, 43, 'concrete_dark', { y: 0.03 }); K.ground(38, 10, 14, 20, 'concrete_dark', { y: 0.03 });
  K.ground(-14, -14.2, 0.3, 8, 'yellow_paint', { y: 0.05, t: 0.02 }); K.ground(-24.5, -10.5, 21, 0.3, 'yellow_paint', { y: 0.05, t: 0.02 }); K.ground(10, -10.5, 26, 0.3, 'yellow_paint', { y: 0.05, t: 0.02 });
  // hangars (open toward the apron)
  K.prop('hangar', -42, -1, 0); K.prop('hangar', -42, 21, 0); K.prop('hangar', 38, 10, PI);
  K.prop('heli_wreck', -42, -1, 0);
  K.container('military', -46.0, 6.8); K.container('ammobox', -47.8, -8.5, Q); K.container('crate', -38, -9.0);
  planeBody(K, -41, 21, 1, 'white_paint');
  K.container('military', -46, 28.5); K.container('toolbox', -47.5, 13.5, Q); K.container('barrel', -37.5, 29.5);
  K.prop('truck', 39, 5, 0); K.container('crate', 43.8, 17.0, Q); K.container('military', 42.5, 17.8); K.container('barrel', 43.9, 2.0); K.container('barrel', 43.9, 2.9); K.container('toolbox', 36.0, 18.5);
  for (const [x, z] of [[-34.2, -10.2], [-34.2, 8.2], [-34.2, 12.2], [-34.2, 30.2], [31.8, 0.8], [31.8, 19.2]]) flood(K, x, z, 0, 16);
  // parked plane on the apron
  planeBody(K, 2, 1, 1, 'blue_paint');
  // control tower + ops building
  K.box(9, 24, 4, 4, 12, 'concrete');
  K.box(9, 24, 8.6, 8.6, 0.25, 'metal_dark', { y: 11.8, collide: false });
  K.box(9, 24, 7, 7, 3, M.mat('#41525c', { cut: true, transparent: true, opacity: 0.8 }), { y: 12, collide: false });
  K.box(9, 24, 7.8, 7.8, 0.5, 'concrete_dark', { y: 15, collide: false });
  K.cyl(10.5, 25.5, 0.08, 3, 'metal', { y: 15.5, collide: false, seg: 6 });
  K.light(9, 24, 15.8, '#ff4030', 0.8, 8); K.light(9, 24, 13, '#e8f0ff', 0.8, 10);
  room(K, { x: 0, z: 24, w: 12, d: 8, wall: 'concrete', roof: 'concrete_dark', trim: 'white_paint', floor: 'tile',
    doors: [{ side: 'n', at: -2, w: 1.6 }], windows: [{ side: 'n', at: 2.5, w: 1.6 }, { side: 's', at: -3, w: 1.4 }, { side: 's', at: 2, w: 1.4 }, { side: 'w', w: 1.4 }] });
  K.prop('desk', 3.5, 27.2, 0); K.prop('desk', -0.5, 27.2, 0); K.prop('generator', 4.6, 21.4, 0);
  K.container('medbox', -5.3, 20.7); K.container('military', -4.5, 26.8); K.container('ammobox', 5.4, 25.0, Q); K.container('locker', -5.4, 24.0);
  K.light(0, 24, 2.9, '#e8f0ff', 0.9, 9);
  // fuel depot (bunded)
  K.wall(26, -15, 46, -15, 1.0, 'concrete', { thick: 0.4 }); K.wall(26, -3, 46, -3, 1.0, 'concrete', { thick: 0.4 });
  K.wall(46, -15, 46, -3, 1.0, 'concrete', { thick: 0.4 }); K.wall(26, -15, 26, -10.2, 1.0, 'concrete', { thick: 0.4 }); K.wall(26, -7.8, 26, -3, 1.0, 'concrete', { thick: 0.4 });
  K.prop('tank_v', 31, -9, 0); K.prop('tank_v', 37, -9, 0); K.prop('tank_h', 43, -9, Q); K.prop('pipes', 34, -4.3, 0);
  K.container('military', 43, -14.0); K.container('barrel_oil', 28, -13.6); K.container('barrel_oil', 28.8, -13.9);
  // bunker (blue vault)
  K.ground(-20, 28, 4, 28, 'gravel', { y: 0.031 });
  room(K, { x: -20, z: 46, w: 10, d: 8, h: 2.8, thick: 0.6, wall: 'concrete_dark', roof: 'concrete_dark', trim: 'green_paint', floor: 'concrete_dark',
    doors: [{ side: 'n', type: 'vault', card: 'blue' }] });
  K.container('elite', -23.5, 49.0); K.container('elite', -20, 49.0); K.container('elite', -16.5, 49.0); K.container('military', -23.8, 44.0, Q); K.container('military', -16.2, 44.0, Q);
  K.light(-20, 46, 2.4, '#a0c0ff', 0.8, 8);
  for (const z of [43.5, 46, 48.5]) { K.prop('sandbags', -26.3, z, Q); K.prop('sandbags', -13.7, z, Q); }
  sandbagU(K, -20, 36.5, 'n');
  // wrecks
  K.ground(26, 43, 18, 12, 'dirt', { y: 0.031 });
  K.box(26, 44, 14, 2.6, 2.4, 'metal'); K.box(24, 39.1, 3, 7.2, 0.35, 'metal'); K.box(30, 49.6, 6, 2.5, 0.35, 'metal', { collide: false }); K.box(19.6, 44, 1.2, 0.3, 2.8, 'red_paint', { y: 2.4, collide: false });
  K.cyl(28.5, 41.0, 0.8, 1.6, 'metal_dark', { seg: 10 });
  K.prop('heli_wreck', -40, 44, 0);
  K.container('military', 30.5, 40.5); K.container('crate', 21.5, 47.5); K.container('ammobox', -36.5, 41.5);
  K.prop('dish', -20, -47, 0.4); K.ground(-20, -47, 7, 7, 'concrete', { y: 0.03 });
  K.cyl(30, -40, 0.06, 5, 'metal', { seg: 6 }); K.box(30.9, -40, 1.6, 0.35, 0.35, 'red_paint', { y: 4.55, collide: false });
  fenceLine(K, -50, -40, 50, -40, [[-24, -16], [26, 34]]);
  // towers, barriers, sandbags, lamps
  for (const [x, z] of [[-56, -12], [54, 6], [-6, 55], [50, 30]]) climbTower(K, x, z, Math.round(Math.atan2(-z, -x) / Q) * Q);
  for (const x of [-32, -28, -24, -4, 0, 4, 8]) K.prop('barrier', x, -16.5, 0);
  sandbagU(K, -28, -13.0, 'n'); sandbagU(K, 12, -13.0, 'n');
  K.container('ammobox', -28, -12.6); K.container('crate', 12, -12.6);
  for (const [x, z, r] of [[-24, 15.5, 0], [-4, 15.5, 0], [16, 15.5, PI], [22, -14.5, PI]]) lamp(K, x, z, r);
  K.container('crate', 18.5, 12.5); K.container('barrel', -9.5, 12.8); K.container('barrel', -8.7, 13.2); K.container('crate', -31, 13.5);
  // soldiers
  K.npc('soldier', -52, -19, { patrol: [[-52, -19], [52, -19]] });
  K.npc('soldier', -30, -6, { patrol: [[-30, -6], [18, -6], [18, 8], [-30, 8]] });
  K.npc('soldier', 34, 12, {}); K.npc('soldier', -38, 4.0, {}); K.npc('soldier', -37.5, 25.5, {});
  K.npc('soldier', -23, 40.0, {}); K.npc('soldier', -17, 40.0, {}); K.npc('soldier', 2.0, 23.5, {});
  K.npc('soldier', 24.5, -1.0, { patrol: [[24.5, -1.0], [24.5, -14.0]] });
  K.npc('soldier', 28, 38.5, {});
}

// ============================================================================
// GARRISON 9 (blue card + lever, boss) — walled base, gates, towers,
// HQ with the armory vault, barracks, mess, motor pool, switch house
// ============================================================================
function garrison(K) {
  K.label('Garrison 9');
  K.ground(0, 0, 68, 68, 'concrete', { y: 0.02 });
  K.ground(0, -23, 8, 22, 'asphalt', { y: 0.034 }); K.ground(0, 23, 8, 22, 'asphalt', { y: 0.034 });
  K.ground(0, -40, 8, 12, 'asphalt', { y: 0.03 }); K.ground(0, 40, 8, 12, 'asphalt', { y: 0.03 });
  K.ground(0, 0, 30, 22, 'concrete_dark', { y: 0.035 });
  for (const [x, z, w, d] of [[0, -10.6, 29, 0.25], [0, 10.6, 29, 0.25], [-14.6, 0, 0.25, 21], [14.6, 0, 0.25, 21]]) K.ground(x, z, w, d, 'white_paint', { y: 0.05, t: 0.02 });
  // perimeter + gates
  for (const s of [-1, 1]) {
    K.wall(-34.3, s * 34, -4.6, s * 34, 4.0, 'concrete', { thick: 0.6 }); K.wall(4.6, s * 34, 34.3, s * 34, 4.0, 'concrete', { thick: 0.6 });
    K.wall(s * 34, -33.7, s * 34, 33.7, 4.0, 'concrete', { thick: 0.6 });
    for (const t of [-1, 1]) { K.box(t * 4.6, s * 34, 1.2, 1.2, 5.0, 'concrete_dark'); K.box(t * 4.6, s * 34 - s * 0.62, 1.2, 0.05, 0.5, 'hazard', { y: 3.2, collide: false }); }
    K.box(0, s * 34, 10.4, 0.6, 0.6, 'concrete_dark', { y: 5.0, collide: false });
    K.prop('barrier', -2.5, s * 38, 0); K.prop('barrier', 2.5, s * 41.5, 0);
    K.light(0, s * 33, 4.6, '#fff2d8', 1.2, 14);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { climbTower(K, sx * 30.5, sz * 30.5, sx > 0 ? PI : 0, { light: false }); K.light(sx * 30.5, sz * 30.5, 5.2, '#fff4dc', 1.2, 16); }
  // HQ + armory (blue card + lever)
  room(K, { x: -18, z: -22, w: 16, d: 12, h: 3.6, wall: 'concrete', roof: 'concrete_dark', trim: 'green_paint', floor: 'tile',
    doors: [{ side: 'e', at: 2, w: 1.6 }, { side: 's', at: 4, w: 1.6 }], windows: [{ side: 'n', at: 3, w: 1.6 }, { side: 's', at: 7, w: 1.4 }, { side: 'e', at: -3, w: 1.4 }] });
  room(K, { x: -22.6, z: -22, w: 6.2, d: 11.4, h: 3.2, wall: 'concrete_dark', floor: false, roofProps: false, doors: [{ side: 'e', type: 'vault', card: 'blue', lever: true }] });
  K.ground(-22.6, -22, 5.9, 11.1, 'metal_dark', { y: 0.075, t: 0.02 });
  K.container('elite', -24.3, -26.6); K.container('elite', -24.3, -17.4); K.container('elite', -21.0, -26.6); K.container('military', -24.8, -22.0, Q); K.container('military', -21.0, -17.4);
  K.box(-22.8, -22.0, 0.4, 3.0, 1.6, 'metal_dark');
  K.prop('desk', -15.0, -27.2, 0); K.prop('table', -14.5, -22.5, 0);
  K.container('military', -11.2, -27.0, Q); K.container('medbox', -18.6, -16.8); K.container('ammobox', -10.7, -17.0, Q);
  K.light(-14.5, -22, 3.2, '#e8f0ff', 1.0, 10); K.light(-22.6, -22, 2.8, '#a0c0ff', 0.8, 8);
  // barracks
  for (const z of [-23, -9]) {
    room(K, { x: 20, z, w: 14, d: 8, wall: 'corrugated_green', roof: 'corrugated', trim: 'green_paint', floor: 'plank',
      doors: [{ side: 'w', w: 1.6 }, { side: 's', at: 3, w: 1.6 }], windows: [{ side: 'n', at: -4, w: 1.4 }, { side: 'n', at: 2, w: 1.4 }, { side: 's', at: -3, w: 1.4 }, { side: 'e', w: 1.4 }] });
    for (const x of [15.5, 18.5, 21.5, 24.5]) K.prop('bunkbed', x, z - 3.2, 0);
    for (const x of [15.5, 19.5, 25.6]) K.prop('bunkbed', x, z + 3.2, 0);
    K.light(20, z, 2.8, '#ffe8c0', 0.9, 9);
  }
  K.container('locker', 26.4, -22.0); K.container('locker', 26.4, -23.0); K.container('ammobox', 13.7, -21.5, Q);
  K.container('locker', 26.4, -8.0); K.container('food', 26.3, -9.4, Q); K.container('ammobox', 13.7, -7.5, Q);
  // mess hall
  room(K, { x: -20, z: 6, w: 12, d: 9, wall: 'brick', roof: 'corrugated_rust', floor: 'tile',
    doors: [{ side: 'e', w: 1.8 }, { side: 'n', at: -3, w: 1.6 }], windows: [{ side: 'n', at: 2, w: 1.4 }, { side: 's', at: -3, w: 1.4 }, { side: 's', at: 2, w: 1.4 }, { side: 'w', w: 1.4 }] });
  for (const x of [-22.5, -18.5]) for (const z of [4.5, 7.5]) K.prop('table', x, z, 0);
  K.prop('counter', -25.2, 6.0, Q); K.box(-15.0, 9.8, 0.8, 0.8, 1.8, 'white_paint');
  K.container('food', -25.3, 2.4, Q); K.container('food', -25.3, 9.6, Q);
  K.light(-20, 6, 2.9, '#ffe8c0', 0.9, 9);
  // switch house (lever) + power
  room(K, { x: -24, z: 24, w: 6, d: 5, wall: 'brick', roof: 'concrete_dark', floor: 'concrete_dark', doors: [{ side: 'e', w: 1.5 }], windows: [{ side: 'n', w: 1.2 }] });
  K.lever(-25.8, 24.0, 0); K.prop('generator', -23.5, 25.5, 0); K.container('toolbox', -26.4, 22.2);
  K.light(-24, 24, 2.8, '#ffe0b0', 0.8, 7);
  K.prop('transformer', -18.5, 23.0, 0); K.prop('transformer', -18.5, 25.2, 0);
  // motor pool, tents, helipad
  K.prop('garage', 24, 17, PI); K.prop('garage', 24, 26, PI);
  K.prop('truck', 24.0, 17, 0); K.prop('car', 24.5, 26, 0);
  K.container('toolbox', 21.5, 23.7); K.container('crate', 27.0, 28.3); K.prop('drums', 17.0, 27.5, 0);
  for (const [x, z] of [[8.5, 22], [12.5, 22], [8.5, 27], [12.5, 27]]) K.prop('tent', x, z, 0);
  K.cyl(-10.5, 23, 5.5, 0.08, 'concrete_dark', { collide: false, seg: 24 });
  K.ground(-12, 23, 0.6, 4, 'white_paint', { y: 0.1, t: 0.02 }); K.ground(-9, 23, 0.6, 4, 'white_paint', { y: 0.1, t: 0.02 }); K.ground(-10.5, 23, 2.4, 0.6, 'white_paint', { y: 0.1, t: 0.02 });
  // parade ground
  K.cyl(0, -9, 0.1, 9, 'metal', { seg: 6 }); K.box(0.9, -9, 1.6, 0.05, 1.0, 'red_paint', { y: 7.8, collide: false });
  sandbagU(K, -8, -6, 'n'); sandbagU(K, 8, 6, 's');
  K.box(0, -9.6, 8, 2.2, 0.6, 'concrete_dark'); K.prop('truck', -9, 2.5, Q); K.prop('container', 10.2, -3.5, Q, { color: '#5a7048' });
  for (const [x, z, r] of [[3.5, 3.0, 0.3], [-3.5, 6.5, 0], [4.5, -6.5, 0], [-4.0, -2.0, Q]]) K.prop('barrier', x, z, r);
  dcrate(K, -2.5, 3.5, 1.0, 'green_paint'); dcrate(K, -1.5, 3.6, 0.8, 'green_paint');
  for (const s of [-1, 1]) { sandbagU(K, -7, s * 30, s < 0 ? 'n' : 's'); sandbagU(K, 7, s * 30, s < 0 ? 'n' : 's'); }
  for (const [x, z, r] of [[-8, -15.5, 0], [8, -15.5, PI], [-8, 15.5, 0], [8, 15.5, PI]]) lamp(K, x, z, r);
  K.container('military', 10.5, -31.0); K.container('military', -10.5, 31.0); K.container('ammobox', 8.0, 5.4); K.container('ammobox', -8.0, -5.4);
  K.container('barrel', -31.5, -1.5); K.container('barrel', -31.6, -0.6); K.container('crate', 16.5, -15.5);
  // garrison
  K.npc('warlord', 0, -3, { guard: false });
  for (const s of [-1, 1]) { K.npc('soldier', -7, s * 30.2, {}); K.npc('soldier', 7, s * 30.2, {}); }
  K.npc('soldier', -12, -13.5, { patrol: [[-12, -13.5], [12, -13.5], [12, 13.5], [-12, 13.5]] });
  K.npc('soldier', -30, -12, { patrol: [[-30, -12], [-30, 18]] });
  K.npc('soldier', 30.5, -26, { patrol: [[30.5, -26], [30.5, 10]] });
  K.npc('soldier', 20, -22.8, {}); K.npc('soldier', 20, -9, {}); K.npc('soldier', -14, -20.5, {}); K.npc('soldier', -22.5, 23.0, {});
}

// ============================================================================
// REACTOR SECTOR (red card + fuse + lever) — cooling towers, reactor block
// with the red vault, turbine hall (fuse box), control building (lever),
// transformer yard, debris field, heavy radiation, anomalies, mutants
// ============================================================================
function reactor(K) {
  K.label('Reactor Sector'); const R = K.R;
  K.ground(0, 0, 90, 90, 'concrete', { y: 0.02 });
  K.ground(0, 0, 90, 4, 'asphalt', { y: 0.034 }); dashes(K, -44, 0, 44, 0, 3, 3, 'yellow_paint', 0.25);
  // cooling towers + chimney
  K.prop('cooling_tower', -38, -30, 0); K.prop('cooling_tower', -15, -40, 0); K.prop('chimney', 10, -36, 0);
  K.rad(-27, -35, 16, 14);
  // reactor block + red vault
  const block = room(K, { x: 14, z: -10, w: 18, d: 18, h: 7, wall: 'concrete', roof: 'concrete_dark', trim: 'hazard', floor: 'tile_dark',
    doors: [{ side: 'w', type: 'steel', w: 1.4 }, { side: 's', at: -4, w: 2.4 }] });
  K.cyl(14, -10, 3.6, 5, 'metal_dark', { seg: 20 }); K.cyl(14, -10, 2.4, 0.3, '#8cff70', { y: 5, collide: false, seg: 16 });
  for (const [x, z] of [[12.2, -10], [15.8, -10], [14, -8.2], [14, -11.8]]) K.cyl(x, z, 0.25, 1.4, 'metal', { y: 5, collide: false, seg: 6 });
  K.light(14, -10, 5.6, '#80ff60', 1.6, 14);
  K.rad(14, -10, 9, 18);
  room(K, { x: 20.1, z: -15.85, w: 5.2, d: 5.7, h: 3.2, wall: 'concrete_dark', floor: false, roofProps: false, doors: [{ side: 'w', type: 'vault', card: 'red', fuse: true, lever: true }] });
  K.ground(20.1, -15.85, 4.9, 5.4, 'metal_dark', { y: 0.075, t: 0.02 });
  K.container('elite', 21.6, -17.8, Q); K.container('elite', 21.6, -14.0, Q); K.container('elite', 19.5, -17.9); K.container('military', 19.5, -13.8);
  K.light(20.1, -15.85, 2.8, '#ff6060', 0.9, 7);
  K.prop('desk', 7, -2.4, 0); K.container('medbox', 5.8, -18.2);
  // turbine hall (fuse box)
  room(K, { x: -14, z: 12, w: 32, d: 14, h: 6, wall: 'corrugated', roof: 'corrugated_rust', trim: 'metal_dark', floor: 'concrete_dark',
    doors: [{ side: 'e', at: -3, w: 2.0 }, { side: 'n', at: -6, w: 2.4 }, { side: 's', at: 6, w: 2.0 }, { side: 'w', at: 3, w: 1.6 }],
    windows: [{ side: 'n', at: 2, w: 2 }, { side: 'n', at: 10, w: 2 }, { side: 's', at: -8, w: 2 }, { side: 's', at: -1, w: 2 }] });
  for (const x of [-23, -13, -3]) K.prop('tank_h', x, 12, 0);
  K.prop('generator', -19, 12, 0); K.prop('generator', -9, 12, 0);
  K.fusebox(-29.55, 8.0, 0);
  K.container('toolbox', 1.4, 18.2, Q); K.container('crate', -29.0, 18.0, Q); K.container('barrel', -28.9, 6.0); K.container('barrel', 1.3, 6.0);
  K.container('medbox', -14, 18.2); K.container('military', -24.0, 6.0);
  K.light(-20, 12, 5.4, '#fff0d0', 1.1, 14); K.light(-6, 12, 5.4, '#fff0d0', 1.1, 14);
  K.rad(-3, 16, 5, 14);
  // pipes between the hall and the reactor yard (gap at x -16..-10)
  for (const x of [-25, -19, -7, -1]) K.prop('pipes', x, -4, 0);
  // control building (lever)
  room(K, { x: 36, z: 14, w: 12, d: 8, wall: 'concrete', roof: 'concrete_dark', trim: 'hazard', floor: 'tile',
    doors: [{ side: 'w', w: 1.6 }, { side: 's', at: 3, w: 1.6 }], windows: [{ side: 'n', at: -3, w: 1.4 }, { side: 'n', at: 3, w: 1.4 }, { side: 'e', w: 1.4 }] });
  K.lever(40.8, 16.5, 0);
  K.prop('desk', 33, 10.6, 0); K.prop('desk', 39, 10.6, 0);
  K.container('medbox', 41.3, 12.0, Q); K.container('ammobox', 31.0, 17.4); K.container('military', 36.5, 17.3);
  K.light(36, 14, 2.9, '#e8f0ff', 0.9, 9);
  // transformer yard
  fenceLine(K, 26, -28, 44, -28); fenceLine(K, 26, -8, 44, -8); fenceLine(K, 44, -28, 44, -8); fenceLine(K, 26, -28, 26, -8, [[-20, -16]]);
  for (const x of [29.5, 33.5, 37.5, 41.5]) { K.prop('transformer', x, -24, 0); K.prop('transformer', x, -12, 0); }
  K.prop('pylon', 50, -18, 0);
  K.container('ammobox', 28.0, -9.8); K.container('toolbox', 42.6, -26.6);
  // debris field + ruin
  K.ground(-37, 31, 14, 18, 'dirt', { y: 0.035 });
  for (let k = 0; k < 16; k++) { const x = -43 + R() * 12, z = 23 + R() * 16, s = 0.6 + R() * 1.6; K.box(x, z, s * (1 + R()), s, 0.3 + R() * s, R() < 0.7 ? 'concrete_dark' : 'rust'); }
  K.prop('rock_big', -32, 36, 0); K.prop('rock_big', -42, 26, 0);
  K.wall(-26, 28, -14, 28, 3.5, 'concrete', { thick: 0.35 }); K.wall(-26, 28, -26, 34, 2.4, 'concrete', { thick: 0.35 }); K.wall(-26, 36, -26, 40, 1.4, 'concrete', { thick: 0.35 });
  K.wall(-14, 28, -14, 31, 4.0, 'concrete', { thick: 0.35 }); K.wall(-21, 40, -14, 40, 1.2, 'concrete', { thick: 0.35 }); K.wall(-14, 36, -14, 40, 2.2, 'concrete', { thick: 0.35 });
  K.box(-19, 32.5, 3, 2, 0.6, 'concrete_dark'); K.box(-16.5, 37, 2, 1.4, 0.8, 'rust');
  K.rad(-36, 32, 10, 15);
  K.container('military', -30, 38.5); K.container('crate', -18.5, 36.0); K.container('barrel', -23.5, 30.0);
  // anomalies
  K.anomaly('burner', -34, 26); K.anomaly('burner', 6.8, -4.6); K.anomaly('electro', 35.5, -18); K.anomaly('electro', -12, 7.6);
  K.anomaly('gravi', -27, -21); K.anomaly('gravi', -22, 36);
  // roof gear, pipe rack to the stack, decon checkpoint, wrecks
  for (const [x, z] of [[9, -15], [9, -5]]) onRoof(K, block, x, z, 2, 2, 1.2, 7.25, 'metal_dark');
  onRoof(K, block, 18, -5, 3, 3, 0.6, 7.25, 'hazard'); onRoof(K, block, 18, -5, 2.2, 2.2, 2.4, 7.25, 'metal');
  for (const z of [-22, -28]) K.prop('pipes', 10, z, Q);
  K.prop('tent', 30, 30, 0); K.prop('tent', 34, 30, 0); sandbagU(K, 22, 26, 'w'); K.prop('bus', 18, 38, 0.15); K.prop('truck', 36, 40, 0);
  boxStack(K, 33, -36, 0, 2); boxStack(K, 39.5, -36, 0, 1); K.prop('drums', 27, -36, 0);
  K.container('barrel', 25.5, -33.5); K.container('crate', 30.6, 25.6); K.container('ammobox', 22, 26.4);
  // lamps + loose loot
  for (const [x, z, r] of [[-36, 2.6, 0], [-14, -2.6, 0], [24, 2.6, PI], [42, -2.6, PI]]) lamp(K, x, z, r);
  K.container('barrel', 25.5, 4.2); K.container('barrel', 26.3, 4.6); K.container('crate', -40, 10); K.container('crate', 2.5, -22.5); K.container('medbox', -8.0, -16.0);
  // hazguards + lurkers
  K.npc('hazguard', -40, 1.2, { patrol: [[-40, 1.2], [40, 1.2]] });
  K.npc('hazguard', 28, 8, { patrol: [[28, 8], [28, -6]] });
  K.npc('hazguard', 3.2, -2, { patrol: [[3.2, -2], [3.2, -20]] });
  K.npc('hazguard', 35.5, 14.5, {}); K.npc('hazguard', -4, 7.5, {});
  K.npc('lurker', -36, 30, {}); K.npc('lurker', -26, -24, {}); K.npc('lurker', -18, 16.5, {}); K.npc('lurker', 8, -16, {});
}

export const LAYOUTS = { haven, gas, mart, lighthouse, village, camp, quarry, dish, harbor, trainyard, water, fort, airfield, garrison, reactor, ...EXTRA_LAYOUTS, ...CAVE_LAYOUTS, ...TALL_LAYOUTS };
