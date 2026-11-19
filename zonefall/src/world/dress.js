// ============================================================================
// ZONEFALL — the monument detail pass. After a site's layout is built, this
// weathers and clutters it by theme: oil stains, cracks and puddles on the hard
// ground, litter and rubble, weeds pushing through, and odds and ends round the
// edges (tyres, pallets, drums, wrecks, hay, sandbags, broken fencing...).
// Everything inside the site is visual only; the few solid things go round the
// outer edge, in free space, off roads and rails, so no path gets blocked.
// It runs on its own seeded random stream: the same for every co-op player.
// ============================================================================
import { THREE, M } from '../gfx/materials.js';

const THEME = {
  gas: 'urban', mart: 'urban', apartments: 'urban',
  village: 'rural', camp: 'rural', lighthouse: 'rural', radio: 'rural', fishvillage: 'coast', observatory: 'rural', haven: 'market', fort: 'rural',
  quarry: 'quarry', dish: 'industrial', harbor: 'coast', trainyard: 'industrial', water: 'industrial', airfield: 'industrial', reactor: 'industrial', garrison: 'military',
};
const EDGE = {
  urban: ['tires', 'pallets', 'car', 'dumpster', 'barrier', 'drums', 'streetsign', 'cable_spool'],
  rural: ['haybale', 'tires', 'pallets', 'drums', 'fence_wood', 'cable_spool'],
  coast: ['pallets', 'drums', 'tires', 'cable_spool', 'fence_wood'],
  market: ['haybale', 'pallets', 'drums'],
  quarry: ['tires', 'drums', 'cable_spool', 'pallets', 'barrier'],
  industrial: ['drums', 'cable_spool', 'pallets', 'barrier', 'tires', 'car', 'pipes'],
  military: ['sandbags', 'barrier', 'drums', 'cable_spool', 'pallets', 'tires'],
};
const DEBRIS = { urban: ['concrete', 'brick', 'concrete_dark'], industrial: ['concrete', 'rust', 'metal_dark'], military: ['concrete', 'metal_dark', 'tarp_green'], quarry: ['rock', 'stone', 'gravel'], rural: ['plank_dark', 'log', 'rock'], coast: ['plank', 'plank_dark', 'rock'], market: ['plank', 'cloth'] };
const LITTER = ['#c8483a', '#3a6ab0', '#d8c050', '#e8e2d4', '#5a8a48', '#2a2a2e'];

const statics = K => (K.group.children[0] && K.group.children[0].isGroup ? K.group.children[0] : K.group);
/** a visual-only mesh at local (x, y, z) with a local yaw (mirror-aware) */
export function deco(K, geo, mat, x, y, z, ry = 0, rx = 0, rz = 0) {
  const [wx, wz] = K.toWorld(x, z);
  const m = M.add(statics(K), geo, mat, wx - K.mon.x, y, wz - K.mon.z, { cast: false });
  m.rotation.order = 'YXZ'; m.rotation.set(rx, K.wry(ry), rz); return m;
}

export function dress(K, R, ctx) {
  const theme = THEME[K.mon.type]; if (!theme) return;
  const S = K.mon.size, base = K.baseY, r = (a, b) => a + R() * (b - a), pick = a => a[Math.floor(R() * a.length)];
  const level = (x, z, tol = 0.06) => Math.abs(K.yAt(x, z) - base) < tol;
  const dry = (x, z) => K.yAt(x, z) > 0.15;
  const offPaths = (x, z) => { const [wx, wz] = K.toWorld(x, z); return !(ctx.isRoad && ctx.isRoad(wx, wz)) && !(ctx.onRail && ctx.onRail(wx, wz, 4)); };
  const inner = () => { const a = R() * Math.PI * 2, d = Math.sqrt(R()) * S * 0.8; return [Math.cos(a) * d, Math.sin(a) * d]; };
  const hard = theme === 'urban' || theme === 'industrial' || theme === 'military';

  // ---- weathering on the ground: oil stains, cracks, puddles (only where the ground is level with the site)
  const nStain = Math.round(S * S / (hard ? 70 : 160));
  const dark = M.surf('asphalt'), crackM = M.mat('#2a2826'), pud = M.mat('#5f7a86', { transparent: true, opacity: 0.55 });
  for (let i = 0; i < nStain; i++) {
    const [x, z] = inner(); if (!level(x, z) || !K.freeAt(x, z, 0.4)) continue;
    const kind = R();
    if (kind < 0.45 && hard) { const w = r(0.8, 2.4), d = w * r(0.5, 1); deco(K, M.cyl(w / 2, w / 2, 0.012, 10), dark, x, 0.078, z, r(0, 6)).scale.set(1, 1, d / w); }
    else if (kind < 0.8) { const L = r(1.2, 4); for (let k = 0; k < 3; k++) deco(K, M.box(L / 3, 0.01, 0.05), crackM, x + Math.cos(k) * L / 3 * (k - 1), 0.08, z + Math.sin(k * 1.7) * 0.25, r(-0.6, 0.6) + k * 0.4); }
    else { const w = r(1, 2.6); deco(K, M.cyl(w / 2, w / 2, 0.01, 12), pud, x, 0.082, z, 0).scale.set(1, 1, r(0.5, 0.9)); }
  }
  // ---- litter: cans, bottles, paper, bags
  const nLit = Math.round(S * S / (theme === 'market' ? 90 : 55));
  for (let i = 0; i < nLit; i++) {
    const [x, z] = inner(); if (!K.freeAt(x, z, 0.3) || !dry(x, z)) continue;
    const y = Math.max(0.03, K.yAt(x, z) - base + 0.03), t = R(), col = M.mat(pick(LITTER));
    if (t < 0.35) deco(K, M.cyl(0.04, 0.04, 0.12, 6), col, x, y + 0.04, z, r(0, 6), Math.PI / 2);
    else if (t < 0.6) deco(K, M.box(0.22, 0.01, 0.3), M.mat('#e8e2d4'), x, y, z, r(0, 6));
    else if (t < 0.8) deco(K, M.sphere(0.22, 6, 4), M.mat(R() < 0.6 ? '#2a2a2e' : '#3a5a2e'), x, y + 0.12, z, r(0, 6)).scale.set(1, 0.7, 0.85);
    else deco(K, M.cyl(0.05, 0.05, 0.26, 6), M.mat('#5a7a48', { transparent: true, opacity: 0.8 }), x, y + 0.05, z, r(0, 6), Math.PI / 2);
  }
  // ---- rubble / debris piles
  const nDeb = Math.round(S * S / (hard ? 120 : 220)), dm = DEBRIS[theme] || DEBRIS.urban;
  for (let i = 0; i < nDeb; i++) {
    const [x, z] = inner(); if (!K.freeAt(x, z, 1.0) || !dry(x, z)) continue;
    const y0 = Math.max(0, K.yAt(x, z) - base), mat = M.surf(pick(dm)), n = 3 + Math.floor(R() * 5);
    for (let k = 0; k < n; k++) { const s = r(0.15, 0.55); deco(K, M.box(s, s * r(0.4, 0.9), s * r(0.6, 1.2)), mat, x + r(-0.7, 0.7), y0 + s * 0.25, z + r(-0.7, 0.7), r(0, 6), r(-0.4, 0.4), r(-0.4, 0.4)); }
  }
  // ---- weeds and grass pushing through (and small bushes at the edges)
  const tuft = M.mat('#6f8a3a'), tuft2 = M.mat('#8a9a48');
  const nWeed = Math.round(S * S / (theme === 'rural' || theme === 'coast' ? 45 : 70));
  for (let i = 0; i < nWeed; i++) {
    const [x, z] = inner(); if (!K.freeAt(x, z, 0.3) || !dry(x, z)) continue;
    const y0 = Math.max(0.02, K.yAt(x, z) - base), n = 3 + Math.floor(R() * 4), m = R() < 0.5 ? tuft : tuft2;
    for (let k = 0; k < n; k++) { const h = r(0.18, 0.45); deco(K, M.box(0.04, h, 0.02), m, x + r(-0.15, 0.15), y0 + h / 2, z + r(-0.15, 0.15), r(0, 6), r(-0.35, 0.35), r(-0.35, 0.35)); }
  }
  // ---- odds and ends round the outer edge (solid; only in free space, off roads and rails, on dry land)
  const edge = EDGE[theme] || [], nEdge = Math.round(S / 4.5);
  for (let i = 0, made = 0; i < nEdge * 4 && made < nEdge; i++) {
    const a = R() * Math.PI * 2, d = S * r(0.72, 0.98), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!dry(x, z) || !level(x, z, 0.5) || !offPaths(x, z) || !K.freeAt(x, z, 2.2)) continue;
    // up against something (a wall, a fence, a building), never in a gap (blocked both sides) or out in an open approach
    const blocked = []; for (let q = 0; q < 8; q++) { const b = q / 8 * Math.PI * 2; blocked.push(!K.freeAt(x + Math.cos(b) * 3, z + Math.sin(b) * 3, 0.7)); }
    const nb = blocked.filter(Boolean).length; if (nb === 0 || nb > 5) continue;
    if ([0, 1, 2, 3].some(q => blocked[q] && blocked[q + 4])) continue; // between two things: a doorway, a gate, a lane
    const type = pick(edge), ry = R() < 0.6 ? Math.round(R() * 4) * Math.PI / 2 : r(0, 6);
    if (type === 'pipes') { for (let k = 0; k < 3; k++) deco(K, M.cyl(0.32, 0.32, 4, 10), M.surf('rust'), x, 0.32 + (k === 2 ? 0.55 : 0), z + (k === 2 ? 0 : (k - 0.5) * 0.66), ry, 0, Math.PI / 2); const blk = K.box(x, z, 2.2, 2.2, 0.9, 'rust'); if (blk) blk.removeFromParent(); made++; continue; }
    K.prop(type, x, z, ry); made++;
  }
  // ---- one extra point of interest per site, with a little loot
  extra(K, R, theme, { dry, level, offPaths, r, pick });
  // ---- a couple of utility poles with sagging wire (most themes)
  if (theme !== 'market' && theme !== 'military') {
    const poles = []; const a0 = R() * Math.PI * 2;
    for (let k = 0; k < 3; k++) { const a = a0 + k * 0.55, d = S * 0.95, x = Math.cos(a) * d, z = Math.sin(a) * d; if (dry(x, z) && offPaths(x, z) && K.freeAt(x, z, 0.8)) poles.push([x, z]); }
    if (poles.length >= 2) {
      const wood = M.surf('log'), wireM = M.mat('#1c1c1e');
      for (const [x, z] of poles) { const y0 = K.yAt(x, z) - base; K.cyl(x, z, 0.14, 7.5, 'log', { y: y0, seg: 7 }); deco(K, M.box(1.6, 0.12, 0.12), wood, x, y0 + 7.0, z, 0); }
      for (let k = 0; k < poles.length - 1; k++) for (const off of [-0.7, 0.7]) {
        const [ax, az] = poles[k], [bx, bz] = poles[k + 1], ya = K.yAt(ax, az) - base + 7.1, yb = K.yAt(bx, bz) - base + 7.1;
        let prev = null;
        for (let t = 0; t <= 6; t++) { const u = t / 6, x = ax + (bx - ax) * u + off, z = az + (bz - az) * u, y = ya + (yb - ya) * u - Math.sin(u * Math.PI) * 0.7; if (prev) { const [px, py, pz] = prev; const [w0x, w0z] = K.toWorld(px, pz), [w1x, w1z] = K.toWorld(x, z); const dv = new THREE.Vector3(w1x - w0x, y - py, w1z - w0z), L = dv.length(); const m = M.add(statics(K), M.cyl(0.02, 0.02, 1, 4), wireM, (w0x + w1x) / 2 - K.mon.x, (py + y) / 2, (w0z + w1z) / 2 - K.mon.z, { cast: false }); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize()); m.scale.y = L; } prev = [x, y, z]; }
      }
    }
  }
}

const EXTRA = {
  urban: ['wreck', 'stack', 'shed'], industrial: ['stack', 'wreck', 'lookout', 'stack'], military: ['lookout', 'stack', 'wreck'],
  rural: ['camp', 'shed', 'wreck'], coast: ['camp', 'shed'], quarry: ['stack', 'shed', 'camp'],
};
function extra(K, R, theme, H) {
  const list = EXTRA[theme]; if (!list || K.mon.def && K.mon.def.safe) return;
  const kind = list[K.pick(list.length, 3)], S = K.mon.size;
  for (let tries = 0; tries < 40; tries++) {
    const a = R() * Math.PI * 2, d = S * H.r(0.5, 0.86), x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!H.dry(x, z) || !H.level(x, z, 0.35) || !H.offPaths(x, z) || !K.freeAt(x, z, 4.2)) continue;
    const ry = Math.round(R() * 4) * Math.PI / 2, c = Math.cos(ry), s = Math.sin(ry), P = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
    if (kind === 'wreck') {
      const heli = theme !== 'rural' && R() < 0.5;
      K.prop(heli ? 'heli_wreck' : 'car', x, z, ry + H.r(-0.3, 0.3));
      deco(K, M.cyl(2.6, 2.6, 0.012, 14), M.mat('#1e1c1a'), x, 0.08, z, 0);
      for (let k = 0; k < 6; k++) { const [px, pz] = P(H.r(-3, 3), H.r(-3, 3)); deco(K, M.box(H.r(0.3, 0.9), 0.05, H.r(0.2, 0.6)), M.surf(heli ? 'metal_dark' : 'rust'), px, 0.1, pz, H.r(0, 6), H.r(-0.3, 0.3)); }
      const [lx, lz] = P(0, 2.6); K.container(heli ? 'military' : 'crate', lx, lz, ry);
    } else if (kind === 'stack') {
      K.prop('container', x, z, ry); K.prop('container', x + H.r(-0.4, 0.4), z, ry + H.r(-0.08, 0.08), { y: 2.6 });
      const [lx, lz] = P(0, 2.3); K.container('crate', lx, lz, ry); const [bx, bz] = P(3.6, 1.6); K.container('barrel', bx, bz);
    } else if (kind === 'lookout') {
      K.prop('watchtower', x, z, ry); const [lx, lz] = P(2.4, 0); K.container('ammobox', lx, lz, ry); K.prop('sandbags', ...P(-2.6, 0), ry + Math.PI / 2);
    } else if (kind === 'camp') {
      K.prop('tent', x, z, ry); const [fx, fz] = P(0, 3.2); K.deployModel('campfire', fx, fz); K.light(fx, fz, 1.1, '#ff9a40', 1.2, 9);
      for (const k of [-1, 1]) { const [lx, lz] = P(k * 1.4, 3.2); K.box(lx, lz, 0.4, 1.2, 0.4, 'log'); }
      const [cx, cz] = P(2.2, 0.6); K.container('food', cx, cz, ry); const [sx, sz] = P(-2.2, 0.8); K.container('cache', sx, sz, ry);
    } else if (kind === 'shed') {
      const sides = ['s', 'w', 'n', 'e'], side = sides[Math.round(ry / (Math.PI / 2)) & 3];
      K.room({ x, z, w: 4, d: 3.4, h: 2.6, wall: pick2(R, ['corrugated_rust', 'plank_dark', 'corrugated', 'corrugated_green']), roof: 'corrugated_rust', floor: 'concrete_dark', doors: [{ side, w: 1.3 }], roofProps: false });
      K.container(R() < 0.5 ? 'toolbox' : 'crate', x, z, ry); K.prop('workbench_old', ...P(0, -1.1), ry);
    }
    return;
  }
}
const pick2 = (R, a) => a[Math.floor(R() * a.length)];
