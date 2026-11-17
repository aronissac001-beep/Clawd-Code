// Ground kit (owner D; doc 12.4 "baked into chunks", 14.6 row D): natural rock faces for every stone
// with 4-neighbour autotiled edges (16 masks), unknown rock, mined (rough) floor and rubble, ore
// glints for coal, copper, tin and iron, plank and flagstone floors, smoothed stone and the stone
// pile ground mark. C's terrain painter (js/engine/render/terrain.js) calls these per tile while it
// bakes a chunk or repaints a 3 x 3 patch.
//
// Rules the painter relies on: every function draws only inside its own 32 x 32 tile (so a clipped
// patch repaint matches a full bake), the look depends only on (tile x, tile y, the layer values)
// through hash2 (no Math.random, no time), and `detail` false (the far band) skips sub-pixel marks.
// g is in world units (1 tile = TILE = 32), already scaled and translated by the caller.
//
//   paintRockTile(g, tx, ty, mask, mat, known, detail)   mask: open sides N 1, E 2, S 4, W 8
//   paintOreGlint(g, tx, ty, ore, detail)                ore: L.ore value (1 coal, 2 copper, 3 tin, 4 iron; others glint generically)
//   paintMinedFloor(g, tx, ty, mat, detail, rubble?)     TER.ROUGH / TER.RUBBLE, tinted by the stone it was cut from
//   paintFloorTile(g, key, tx, ty, mat, detail)          'struct.f_planks' | 'struct.f_flag' | 'floor.smooth'
//   paintPileMark(g, tx, ty, mat)                        the scuffed ground under a stone pile
//   paintGround(g, key, tx, ty, opt)                     any ground / floor key by name (the contact sheet)
//   rockColour(mat, known) / floorColour(key, mat)       flat colours for the tile-colour texture and minimap

import { TILE } from '../../game/core/grid.js';
import { hash2 } from '../rng.js';
import { shade } from '../sprites.js';
import { STONE_IDS, ORE_IDS, STONE_LOOK, ORE_LOOK, tintOf } from './keys.js';

const T = TILE;
const TAU = Math.PI * 2;

// Shaded palettes per stone, built once on first use (shade() parses a colour each call).
const PAL = new Map();
function palOf(name) {
  let p = PAL.get(name);
  if (p) return p;
  const L = STONE_LOOK[name] || STONE_LOOK.granite;
  p = {
    look: L,
    body: shade(L.base, -0.02), bodyHi: shade(L.base, 0.14), bodyLo: shade(L.base, -0.22),
    face: shade(L.dark, -0.05), faceHi: shade(L.dark, 0.18), faceLo: shade(L.dark, -0.35),
    lip: L.lit, side: shade(L.base, 0.1), sideLo: shade(L.dark, -0.2),
    floor: shade(L.base, -0.42), floorHi: shade(L.base, -0.3), floorLo: shade(L.base, -0.56),
    smooth: shade(L.base, 0.02), smoothLo: shade(L.base, -0.18), fleck: L.fleck,
  };
  PAL.set(name, p);
  return p;
}
const stoneName = (mat) => STONE_IDS[mat & 15] || 'granite';

/** Flat colour of a rock tile (tile-colour texture and minimap). */
export function rockColour(mat, known = true) { return known ? palOf(stoneName(mat)).body : STONE_LOOK.unknown.base; }
/** Flat colour of a floor key (or mined floor of stone mat). */
export function floorColour(key, mat = 3) {
  if (key === 'struct.f_planks') return '#94693f';
  if (key === 'struct.f_flag') return shade(tintOf(typeof mat === 'string' ? mat : stoneName(mat), 'stone'), -0.1);
  return palOf(stoneName(typeof mat === 'number' ? mat : STONE_IDS.indexOf(mat))).floor;
}

/**
 * Natural rock, seen from the south at the 3/4 angle of the roguelite. mask: open sides (N 1, E 2,
 * S 4, W 8). A body with the stone's motif; a lit lip where the north is open; a tall dark face
 * toward the viewer where the south is open; side light on the west and shade on the east.
 */
export function paintRockTile(g, tx, ty, mask, mat, known, detail = true) {
  const bx = tx * T, by = ty * T;
  const name = known ? stoneName(mat) : 'unknown';
  const P = palOf(name);
  if ((mask & 15) === 15) { paintNaturalPillar(g, tx, ty, mat, P, detail); return; }
  g.fillStyle = P.body; g.fillRect(bx, by, T, T);
  if (detail && name !== 'unknown') motif(g, P, P.look.motif, tx, ty, bx, by);
  else if (detail) { // unknown rock: a few dim cracks, no material
    g.fillStyle = P.bodyLo;
    for (let k = 0; k < 3; k++) g.fillRect(bx + 3 + hash2(tx, ty, 150 + k) * (T - 10), by + 4 + hash2(tx, ty, 160 + k) * (T - 12), 5, 1.5);
  }
  const n = mask & 1, e = mask & 2, s = mask & 4, w = mask & 8;
  if (s) { // the face toward the viewer
    const fh = 12;
    g.fillStyle = P.face; g.fillRect(bx, by + T - fh, T, fh);
    g.fillStyle = P.faceHi; g.fillRect(bx, by + T - fh, T, 1.5);
    if (detail) {
      g.fillStyle = P.faceLo;
      for (let k = 0; k < 3; k++) g.fillRect(bx + 3 + k * 10 + hash2(tx, ty, 180 + k) * 5, by + T - fh + 3, 1.3, fh - 4);
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(bx, by + T - 2, T, 2);
    }
    // the lit crest of the face
    g.fillStyle = P.lip; g.globalAlpha = 0.55; g.fillRect(bx, by + T - fh - 1.5, T, 1.5); g.globalAlpha = 1;
  }
  if (n) { g.fillStyle = P.lip; g.fillRect(bx, by, T, 2.5); g.fillStyle = P.bodyHi; g.fillRect(bx, by + 2.5, T, 1.5); }
  if (w) { g.fillStyle = P.side; g.fillRect(bx, by, 2.5, s ? T - 12 : T); if (s) { g.fillStyle = P.faceHi; g.fillRect(bx, by + T - 12, 2, 12); } }
  if (e) { g.fillStyle = P.sideLo; g.fillRect(bx + T - 2.5, by, 2.5, T); }
  // rounded outer corners where two adjacent sides are open
  if (detail) {
    g.fillStyle = 'rgba(12,10,14,0.55)';
    if (n && w) corner(g, bx, by, 1, 1);
    if (n && e) corner(g, bx + T, by, -1, 1);
  }
}
/** A lone rock tile (open on all four sides, B's natural pillars): a rough column on mined floor. */
function paintNaturalPillar(g, tx, ty, mat, P, detail) {
  const bx = tx * T, by = ty * T, cx = bx + T / 2;
  paintMinedFloor(g, tx, ty, mat || 3, detail, false);
  g.fillStyle = 'rgba(12,10,14,0.35)'; g.beginPath(); g.ellipse(cx, by + T - 6, 12, 4.5, 0, 0, TAU); g.fill();
  g.fillStyle = P.face; g.fillRect(cx - 9, by + 6, 18, T - 12);
  g.fillStyle = P.body; g.fillRect(cx - 9, by + 6, 11, T - 12);
  g.fillStyle = P.lip; g.globalAlpha = 0.6; g.fillRect(cx - 8, by + 7, 2, T - 14); g.globalAlpha = 1;
  g.fillStyle = P.face; g.beginPath(); g.ellipse(cx, by + T - 6, 9, 3, 0, 0, Math.PI); g.fill();
  g.fillStyle = P.bodyHi; g.beginPath(); g.ellipse(cx, by + 6, 9, 3.4, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(12,10,14,0.6)'; g.lineWidth = 0.9; g.beginPath(); g.ellipse(cx, by + 6, 9, 3.4, 0, 0, TAU); g.moveTo(cx - 9, by + 6); g.lineTo(cx - 9, by + T - 6); g.moveTo(cx + 9, by + 6); g.lineTo(cx + 9, by + T - 6); g.stroke();
  if (detail) { g.fillStyle = P.faceLo; g.fillRect(cx + 1, by + 12 + hash2(tx, ty, 360) * 8, 5, 1.2); g.fillRect(cx - 5, by + 18 + hash2(tx, ty, 361) * 6, 4, 1.2); }
}
function corner(g, x, y, sx, sy) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 4 * sx, y); g.lineTo(x, y + 4 * sy); g.closePath(); g.fill(); }

/** The stone's surface motif, inside the tile. */
function motif(g, P, kind, tx, ty, bx, by) {
  const h = (k) => hash2(tx, ty, k);
  switch (kind) {
    case 'strata': { // sandstone: soft horizontal bands that run on across tiles (world y based)
      for (let k = 0; k < 4; k++) {
        const yy = by + ((ty * 13 + k * 8 + 3) % 32);
        g.fillStyle = k & 1 ? P.bodyHi : P.bodyLo; g.globalAlpha = 0.55;
        g.fillRect(bx, yy, T, 2); g.globalAlpha = 1;
      }
      g.fillStyle = P.fleck; for (let k = 0; k < 3; k++) g.fillRect(bx + 2 + h(30 + k) * 26, by + 2 + h(40 + k) * 26, 2, 1);
      break;
    }
    case 'fossil': { // limestone: pale shell curls and pits
      g.strokeStyle = P.bodyLo; g.lineWidth = 1;
      for (let k = 0; k < 2; k++) {
        const cx = bx + 7 + h(30 + k) * 18, cy = by + 7 + h(40 + k) * 16, r = 2 + h(50 + k) * 2;
        g.beginPath(); g.arc(cx, cy, r, 0, 4.5); g.stroke();
      }
      g.fillStyle = P.fleck; for (let k = 0; k < 4; k++) g.fillRect(bx + 3 + h(60 + k) * 25, by + 3 + h(70 + k) * 25, 1.6, 1.6);
      break;
    }
    case 'speckle': { // granite: salt and pepper
      for (let k = 0; k < 10; k++) {
        g.fillStyle = k % 3 === 0 ? P.fleck : k % 3 === 1 ? P.bodyLo : P.bodyHi;
        g.fillRect(bx + 2 + h(30 + k) * 27, by + 2 + h(50 + k) * 27, 1.6, 1.6);
      }
      break;
    }
    case 'cleave': { // slate: thin diagonal cleavage lines
      g.strokeStyle = P.bodyLo; g.lineWidth = 1;
      g.beginPath();
      for (let k = 0; k < 3; k++) { const o = 4 + k * 10 + h(30 + k) * 4; g.moveTo(bx + o, by + 2); g.lineTo(bx + o - 6, by + T - 2); }
      g.stroke();
      g.fillStyle = P.fleck; g.globalAlpha = 0.6; g.fillRect(bx + 4 + h(40) * 20, by + 6 + h(41) * 18, 6, 1); g.globalAlpha = 1;
      break;
    }
    case 'column': { // basalt: hexagonal column tops
      g.strokeStyle = P.bodyLo; g.lineWidth = 1.1;
      const ox = (tx & 1) * 8;
      for (let k = 0; k < 2; k++) {
        const cx = bx + 8 + ((k * 16 + ox) % 24), cy = by + 9 + k * 13, r = 6;
        g.beginPath();
        for (let a = 0; a < 6; a++) { const t = a * TAU / 6, x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r * 0.7; if (a) g.lineTo(x, y); else g.moveTo(x, y); }
        g.closePath(); g.stroke();
      }
      g.fillStyle = P.fleck; g.globalAlpha = 0.5; g.fillRect(bx + 5 + h(30) * 20, by + 5 + h(31) * 20, 2, 1.5); g.globalAlpha = 1;
      break;
    }
    case 'vein': { // marble: a soft grey vein across the tile
      g.strokeStyle = P.fleck; g.lineWidth = 1.2; g.globalAlpha = 0.7;
      const y0 = by + 4 + h(30) * 24, y1 = by + 4 + h(31) * 24;
      g.beginPath(); g.moveTo(bx, y0); g.quadraticCurveTo(bx + 16, by + 4 + h(32) * 24, bx + T, y1); g.stroke();
      g.lineWidth = 0.7; g.beginPath(); g.moveTo(bx + 10, y0 + 2); g.lineTo(bx + 18 + h(33) * 8, y0 + 8); g.stroke();
      g.globalAlpha = 1;
      break;
    }
    case 'glint': { // duskstone: violet motes that read in the dark
      for (let k = 0; k < 4; k++) {
        const x = bx + 4 + h(30 + k) * 24, y = by + 4 + h(40 + k) * 22;
        g.fillStyle = k ? P.bodyLo : P.fleck; g.fillRect(x, y, 2, 2);
      }
      g.fillStyle = P.fleck; g.globalAlpha = 0.45; g.fillRect(bx + 6 + h(50) * 18, by + 8 + h(51) * 14, 3, 1); g.globalAlpha = 1;
      break;
    }
    default: break;
  }
}

/** Ore glints over a known rock tile: coal lumps, copper nuggets, tin crystals, iron bands. */
export function paintOreGlint(g, tx, ty, ore, detail = true) {
  const name = ORE_IDS[ore] || '';
  const O = ORE_LOOK[name] || { c: '#e6e8ee', hi: '#ffffff', rim: '#5a5a66', shape: 'crystal' };
  const bx = tx * T, by = ty * T, h = (k) => hash2(tx, ty, k);
  const n = detail ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const px = bx + 7 + h(190 + k) * (T - 14), py = by + 6 + h(200 + k) * (T - 20), r = 3.2 - k * 0.6;
    g.fillStyle = O.rim;
    switch (O.shape) {
      case 'lump': // coal: matt rounded lumps with a blue sheen
        g.beginPath(); g.ellipse(px, py, r + 1.2, r, 0, 0, TAU); g.fill();
        g.fillStyle = O.c; g.beginPath(); g.ellipse(px, py, r + 0.4, r - 0.6, 0, 0, TAU); g.fill();
        if (detail) { g.fillStyle = O.hi; g.fillRect(px - r * 0.5, py - r * 0.5, r * 0.8, 0.9); }
        break;
      case 'nugget': // copper: warm rounded nuggets
        g.beginPath(); g.arc(px, py, r + 0.9, 0, TAU); g.fill();
        g.fillStyle = O.c; g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
        if (detail) { g.fillStyle = O.hi; g.beginPath(); g.arc(px - r * 0.35, py - r * 0.35, r * 0.35, 0, TAU); g.fill(); }
        break;
      case 'band': // iron: rust-red streaks
        g.save(); g.translate(px, py); g.rotate(-0.5 + h(210 + k));
        g.fillRect(-r - 1.5, -1.6, r * 2 + 3, 3.2);
        g.fillStyle = O.c; g.fillRect(-r - 0.8, -1, r * 2 + 1.6, 2);
        if (detail) { g.fillStyle = O.hi; g.fillRect(-r * 0.5, -0.8, r * 0.6, 0.8); }
        g.restore();
        break;
      default: // tin (and generic): bright faceted crystals
        g.beginPath(); g.moveTo(px, py - r - 1); g.lineTo(px + r + 0.6, py); g.lineTo(px, py + r + 1); g.lineTo(px - r - 0.6, py); g.closePath(); g.fill();
        g.fillStyle = O.c; g.beginPath(); g.moveTo(px, py - r); g.lineTo(px + r, py); g.lineTo(px, py + r); g.lineTo(px - r, py); g.closePath(); g.fill();
        if (detail) { g.fillStyle = O.hi; g.fillRect(px - 0.6, py - r * 0.6, 1.2, 1.4); }
        break;
    }
  }
}

/** Mined floor (TER.ROUGH): chipped, uneven stone of the rock it was cut from; rubble adds loose chunks. */
export function paintMinedFloor(g, tx, ty, mat, detail = true, rubble = false) {
  const P = palOf(stoneName(mat)), bx = tx * T, by = ty * T, h = (k) => hash2(tx, ty, k);
  g.fillStyle = P.floor; g.fillRect(bx, by, T, T);
  if (detail) {
    // chisel scars and pale chips
    for (let k = 0; k < 6; k++) {
      g.fillStyle = k & 1 ? P.floorLo : P.floorHi;
      g.fillRect(bx + 2 + h(110 + k) * (T - 6), by + 2 + h(120 + k) * (T - 5), 3 + h(125 + k) * 3, 1.5);
    }
    g.strokeStyle = P.floorLo; g.lineWidth = 0.8; g.globalAlpha = 0.6;
    g.beginPath(); const y0 = by + 6 + h(128) * 20; g.moveTo(bx + 3, y0); g.lineTo(bx + 12 + h(129) * 8, y0 + 4); g.lineTo(bx + 18 + h(130) * 10, y0 + 2); g.stroke();
    g.globalAlpha = 1;
  }
  if (rubble) for (let k = 0; k < (detail ? 6 : 3); k++) {
    const px = bx + 5 + h(130 + k) * (T - 10), py = by + 5 + h(140 + k) * (T - 10);
    g.fillStyle = k % 3 ? P.bodyHi : P.faceLo;
    g.beginPath(); g.moveTo(px - 3.5, py + 2.5); g.lineTo(px - 1.5, py - 3); g.lineTo(px + 3.5, py - 2); g.lineTo(px + 2.5, py + 3); g.closePath(); g.fill();
    if (detail) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px - 3, py + 2.5, 6, 1); }
  }
}

/** Built floors: planks (wood, staggered boards with nails), flagstone (cut blocks in the stone's tint), smoothed stone. */
export function paintFloorTile(g, key, tx, ty, mat, detail = true) {
  const bx = tx * T, by = ty * T, h = (k) => hash2(tx, ty, k);
  if (key === 'struct.f_planks') {
    const base = '#94693f';
    g.fillStyle = base; g.fillRect(bx, by, T, T);
    for (let r = 0; r < 4; r++) {
      const y = by + r * 8;
      g.fillStyle = r & 1 ? '#8a5f37' : '#9c7246'; g.fillRect(bx, y, T, 8);
      if (!detail) continue;
      g.fillStyle = 'rgba(60,36,18,0.55)'; g.fillRect(bx, y + 7.2, T, 0.8);
      const j = ((tx * 5 + r * 3 + ty) % 4) * 8 + 4; // staggered butt joints
      g.fillRect(bx + j, y, 0.9, 7.2);
      g.fillStyle = 'rgba(255,220,170,0.18)'; g.fillRect(bx, y + 0.5, T, 0.8);
      g.fillStyle = 'rgba(70,44,22,0.35)'; g.fillRect(bx + 3 + h(300 + r) * 20, y + 3 + h(310 + r) * 2, 6, 0.7); // grain
      g.fillStyle = '#5a4a3a'; g.fillRect(bx + j + 2, y + 2.5, 1, 1); g.fillRect(bx + j - 3, y + 4.5, 1, 1);
    }
    return;
  }
  if (key === 'struct.f_flag') {
    const stone = typeof mat === 'string' && mat ? mat : stoneName(mat || 3);
    const tint = tintOf(stone, 'stone');
    const grout = shade(tint, -0.45);
    g.fillStyle = grout; g.fillRect(bx, by, T, T);
    // two rows of cut blocks, offset by row, sized by the tile hash
    const rows = [[0, 15], [16, 16]];
    for (let r = 0; r < 2; r++) {
      const [y0, hh] = rows[r];
      const split = 9 + ((tx * 7 + ty * 3 + r * 5) % 3) * 6 + (r ? 4 : 0);
      for (const [x0, ww] of [[0, split], [split, T - split]]) {
        const v = h(320 + r * 2 + (x0 ? 1 : 0));
        g.fillStyle = shade(tint, -0.05 + v * 0.14 - 0.07); g.fillRect(bx + x0 + 0.8, by + y0 + 0.8, ww - 1.6, hh - 1.6);
        if (detail) {
          g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(bx + x0 + 1, by + y0 + 1, ww - 2, 1);
          g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(bx + x0 + 1, by + y0 + hh - 2, ww - 2, 1);
        }
      }
    }
    return;
  }
  // smoothed stone (Stage 2): the rock's own face polished flat
  const P = palOf(typeof mat === 'string' ? mat : stoneName(mat));
  g.fillStyle = P.smooth; g.fillRect(bx, by, T, T);
  if (detail) { g.strokeStyle = P.smoothLo; g.lineWidth = 0.8; g.strokeRect(bx + 0.5, by + 0.5, T - 1, T - 1); g.fillStyle = P.fleck; g.globalAlpha = 0.35; g.fillRect(bx + 5 + h(330) * 18, by + 6 + h(331) * 18, 4, 1); g.globalAlpha = 1; }
}

/** The scuffed ground under a stone pile (baked with the chunk; the pile itself is an item). */
export function paintPileMark(g, tx, ty, mat) {
  const bx = tx * T, by = ty * T, P = palOf(typeof mat === 'string' ? mat : stoneName(mat));
  g.fillStyle = 'rgba(30,24,20,0.22)'; g.beginPath(); g.ellipse(bx + 16, by + 20, 12, 7, 0, 0, TAU); g.fill();
  g.fillStyle = P.floorHi;
  for (let k = 0; k < 5; k++) g.fillRect(bx + 5 + hash2(tx, ty, 340 + k) * 22, by + 12 + hash2(tx, ty, 350 + k) * 14, 1.6, 1.2);
}

/** Paint any ground or floor key into the tile (tx, ty); opt { mask, mat, known, detail, ore }. The contact sheet uses this. */
export function paintGround(g, key, tx, ty, opt = {}) {
  const detail = opt.detail !== false;
  const matOf = (m, d) => (typeof m === 'number' ? m : m ? Math.max(1, STONE_IDS.indexOf(m)) : d);
  if (key.startsWith('rock.')) {
    const st = key.slice(5);
    paintRockTile(g, tx, ty, opt.mask ?? 15, st === 'unknown' ? 0 : Math.max(1, STONE_IDS.indexOf(st)), st !== 'unknown', detail);
    return true;
  }
  if (key.startsWith('ore.')) {
    paintRockTile(g, tx, ty, opt.mask ?? 15, matOf(opt.mat, 3), true, detail);
    paintOreGlint(g, tx, ty, Math.max(1, ORE_IDS.indexOf(key.slice(4))), detail);
    return true;
  }
  switch (key) {
    case 'floor.mined': paintMinedFloor(g, tx, ty, matOf(opt.mat, 3), detail, false); return true;
    case 'floor.rubble': paintMinedFloor(g, tx, ty, matOf(opt.mat, 3), detail, true); return true;
    case 'floor.smooth': paintFloorTile(g, key, tx, ty, matOf(opt.mat, 6), detail); return true;
    case 'ground.pile': paintMinedFloor(g, tx, ty, matOf(opt.mat, 3), detail, false); paintPileMark(g, tx, ty, matOf(opt.mat, 3)); return true;
    case 'struct.f_planks': case 'struct.f_flag': paintFloorTile(g, key, tx, ty, opt.mat ?? 'granite', detail); return true;
    default: return false;
  }
}
