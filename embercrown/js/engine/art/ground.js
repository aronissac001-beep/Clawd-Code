// Ground kit (owner D; doc 12.4 "baked into chunks", docs/ART-STYLE.md): pixel autotiles at the
// native 16 x 16 px per tile. Natural rock faces for every stone with 4-neighbour edges (16 masks,
// 4 variants, the stone's own motif and cracks), unknown rock, the natural pillar, mined (rough)
// floor and rubble, ore glints (1-2 px sparkles), plank, flagstone and smoothed floors, the stone
// pile mark, and the surface: grass with sparse tufts, meadow flowers, soil, sand, marsh, moss,
// tilled rows, ice, lava, and water (depth dither, shore foam and a 2-frame shimmer drawn per frame).
// Soft terrains creep over their lower neighbours with a ragged 1-4 px fringe (grass over soil,
// soil over sand, sand over water).
//
// Every tile is a cached 16 x 16 canvas (pixel.js tileCanvas) drawn with one drawImage per layer,
// strictly inside its own square (a clipped 3 x 3 patch repaint matches a full bake). Variants come
// from hash2(tile x, tile y): no Math.random, no time. g is in world units (1 tile = 32), already
// scaled and translated by the caller (C's chunk bake at 0.5 px per unit = native size).
//
//   paintRockTile(g, tx, ty, mask, mat, known, detail)   mask: open sides N 1, E 2, S 4, W 8
//   paintOreGlint(g, tx, ty, ore, detail, mask?)         ore: L.ore value (1 coal, 2 copper, 3 tin, 4 iron, ...)
//   paintMinedFloor(g, tx, ty, mat, detail, rubble?)     TER.ROUGH / TER.RUBBLE, by the stone it was cut from
//   paintFloorTile(g, key, tx, ty, mat, detail)          'struct.f_planks' | 'struct.f_flag' | 'floor.smooth'
//   paintPileMark(g, tx, ty, mat)                        the scuffed ground under a stone pile
//   paintSurfaceTile(g, s, tx, ty, detail)               any non-rock, non-mined terrain tile with its fringes
//   paintShadowN(g, tx, ty) / paintBlight(g, tx, ty, v)  overlays (rock to the north; blight)
//   paintShimmer(g, tx, ty, frame)                       water shimmer (per frame, frame 0 | 1)
//   paintGround(g, key, tx, ty, opt)                     any ground / floor key by name (the contact sheet)
//   rockColour(mat, known) / floorColour(key, mat) / terrainColour(t)   flat colours (tile-colour texture, minimap)

import { TILE, W, H, TER, ROOF } from '../../game/core/grid.js';
import { hash2 } from '../rng.js';
import { PAL, RAMP, STONE_RAMP, ORE_PX, rampOf, dith } from './palette.js';
import { tileCanvas, tilePeek, skey } from './pixel.js';
import { STONE_IDS, ORE_IDS } from './keys.js';
import { PARTS2 } from './kit2.js';
/** Stage 2 floor keys and the kit2 drawer that paints each. */
const FLOOR2 = Object.freeze({ 'struct.road': 'cobbles', 'struct.bridge': 'deck', 'struct.f_brick': 'bricks', 'struct.f_carpet': 'carpet' });

const T = TILE;
const stoneName = (mat) => STONE_IDS[mat & 15] || 'granite';
/** Stones whose body sits one ramp step up (dark stones), so the body always reads above its floor. */
const DARK_STONE = new Set(['slate', 'basalt', 'duskstone', 'unknown']);
const bodyIx = (name) => (DARK_STONE.has(name) ? 2 : 1);
const variant = (tx, ty, k = 0) => (hash2(tx, ty, 211 + k) * 4) | 0;

/** A tiny deterministic generator for one cached tile (seeded by its cache key parts). */
function rng(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 1442695041 + 12345) | 0;
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
const ri = (r, n) => (r() * n) | 0;
const strId = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

/** Draw a cached 16 x 16 tile canvas at tile (tx, ty) in world units. */
const put = (g, c, tx, ty) => g.drawImage(c, tx * T, ty * T, T, T);

// ---- Flat colours ------------------------------------------------------------------------------------
/** Flat colour of a rock tile (tile-colour texture and minimap). */
export function rockColour(mat, known = true) { const n = known ? stoneName(mat) : 'unknown'; return STONE_RAMP[n].r[bodyIx(n)]; }
/** Flat colour of a floor key (or mined floor of stone mat). */
export function floorColour(key, mat = 3) {
  if (key === 'struct.f_planks' || key === 'struct.bridge') return RAMP.wood[2];
  if (key === 'struct.f_brick') return RAMP.red[1];
  if (key === 'struct.f_carpet') return RAMP.plum[1];
  if (key === 'struct.road') return RAMP.granite[1];
  if (key === 'struct.f_flag') return rampOf(typeof mat === 'string' ? mat : stoneName(mat), 'stone')[2];
  const n = typeof mat === 'number' ? stoneName(mat) : mat || 'granite';
  return STONE_RAMP[n] ? STONE_RAMP[n].r[bodyIx(n) - 1] : RAMP.granite[0];
}
/** Flat colour of a surface terrain id (the tile-colour texture). */
export function terrainColour(t) { return (SURF[t] || SURF[TER.VOID]).base; }

// ---- Rock ---------------------------------------------------------------------------------------------
function rockCanvas(name, mask, v) {
  return tileCanvas(`r:${name}:${mask}:${v}`, (p) => drawRock(p, name, mask, v));
}
function drawRock(p, name, mask, v) {
  const S = STONE_RAMP[name] || STONE_RAMP.granite, r = S.r, b = bodyIx(name);
  const body = r[b], lo = r[b - 1], hi = r[Math.min(3, b + 1)], top = r[3], deep = b >= 2 ? r[0] : PAL.ink;
  if ((mask & 15) === 15) { drawFloor(p, name, v, false); drawPillar(p, r, b); return; }
  const n = mask & 1, e = mask & 2, s = mask & 4, w = mask & 8;
  const fy = s ? 10 : 16; // rows from fy down are the face toward the viewer
  const R = rng(strId(name), mask, v);
  p.rect(0, 0, 16, 16, body);
  // the stone's motif on the top surface
  const y0 = n ? 3 : 0, y1 = fy;
  switch (S.motif) {
    case 'strata': for (let y = y0; y < y1; y++) if ((y + v * 2) % 5 === 0) { for (let x = 0; x < 16; x++) if (R() < 0.8) p.px(x, y, hi); for (let x = 0; x < 16; x++) if (R() < 0.35) p.px(x, y + 1, lo); } break;
    case 'fossil': { const cx = 3 + ri(R, 9), cy = y0 + 2 + ri(R, Math.max(1, y1 - y0 - 4)); p.px(cx, cy, lo); p.px(cx + 1, cy, lo); p.px(cx + 1, cy + 1, lo); p.px(cx, cy + 1, S.fleck); for (let k = 0; k < 4; k++) p.px(ri(R, 16), y0 + ri(R, Math.max(1, y1 - y0)), k & 1 ? hi : S.fleck); break; }
    case 'speckle': for (let k = 0; k < 11; k++) p.px(ri(R, 16), y0 + ri(R, Math.max(1, y1 - y0)), k % 3 === 0 ? S.fleck : k % 3 === 1 ? hi : lo); break;
    case 'cleave': for (let y = y0; y < y1; y++) for (let x = 0; x < 16; x++) if ((x + y + v) % 6 === 0 && R() < 0.75) { p.px(x, y, lo); if (x < 15) p.px(x + 1, y, hi); } break;
    case 'column': { const xs = [(v + 2) % 8, (v + 2) % 8 + 7]; for (const x of xs) { p.vl(x, y0, y1 - y0, lo); if (x < 15) p.vl(x + 1, y0, y1 - y0, hi); } const jy = y0 + 2 + ri(R, Math.max(1, y1 - y0 - 3)); p.hl(xs[0] + 1, jy, xs[1] - xs[0] - 1, lo); break; }
    case 'vein': { let y = y0 + 2 + ri(R, Math.max(1, y1 - y0 - 4)); for (let x = 0; x < 16; x++) { p.px(x, y, S.fleck); if (R() < 0.3) y += R() < 0.5 ? -1 : 1; y = Math.max(y0, Math.min(y1 - 1, y)); } for (let k = 0; k < 3; k++) p.px(ri(R, 16), y0 + ri(R, Math.max(1, y1 - y0)), hi); break; }
    case 'glint': for (let k = 0; k < 3; k++) p.px(1 + ri(R, 14), y0 + 1 + ri(R, Math.max(1, y1 - y0 - 2)), k ? S.fleck : PAL.teal); for (let k = 0; k < 5; k++) p.px(ri(R, 16), y0 + ri(R, Math.max(1, y1 - y0)), hi); break;
    default: break;
  }
  // a crack
  if (R() < 0.7) { let x = 2 + ri(R, 11), y = y0 + 1 + ri(R, Math.max(1, y1 - y0 - 3)); for (let k = 0; k < 4; k++) { p.px(x, y, deep); x += R() < 0.5 ? 1 : 0; y += 1; if (y >= y1) break; } }
  // edges: a 1 px ink outline on every open side, then the lit or shaded rim (light from the top-left)
  if (n) { p.hl(0, 0, 16, PAL.ink); p.hl(0, 1, 16, top); p.dither(0, 2, 16, 1, hi, 8); }
  if (w) { p.vl(0, n ? 1 : 0, fy - (n ? 1 : 0), PAL.ink); p.vl(1, n ? 1 : 0, fy - (n ? 1 : 0), hi); }
  if (e) { p.vl(15, n ? 1 : 0, fy - (n ? 1 : 0), PAL.ink); p.vl(14, n ? 2 : 0, fy - (n ? 2 : 0), lo); }
  if (n && w) p.px(1, 1, PAL.ink);
  if (n && e) p.px(14, 1, PAL.ink);
  if (s) {
    p.rect(0, fy, 16, 6, lo);
    p.dither(0, fy + 1, 16, 2, body, 6);
    p.hl(0, fy, 16, top);
    for (let k = 0; k < 3; k++) { const x = 1 + k * 5 + ri(R, 3); p.vl(x, fy + 2, 2 + ri(R, 2), deep); }
    p.hl(0, 15, 16, PAL.ink);
    if (w) { p.vl(0, fy, 6, PAL.ink); p.vl(1, fy, 5, body); }
    if (e) { p.vl(15, fy, 6, PAL.ink); }
  }
}
function drawPillar(p, r, b) {
  const body = r[b], lo = r[b - 1], hi = r[Math.min(3, b + 1)], top = r[3];
  p.shadow(8, 14, 6, 1.6, 10);
  p.ellipse(8, 3.5, 5, 2.5, PAL.ink); p.rect(2, 3, 12, 11, PAL.ink); p.ellipse(8, 13.5, 6, 2, PAL.ink);
  p.rect(3, 4, 10, 10, body); p.rect(3, 4, 2, 10, hi); p.rect(11, 4, 2, 10, lo); p.ellipse(8, 13.5, 5, 1.2, lo);
  p.ellipse(8, 3.5, 4, 1.6, top); p.hl(6, 3, 3, PAL.bone);
  p.vl(7, 7, 3, lo); p.px(8, 10, lo);
}

// ---- Ore glints -----------------------------------------------------------------------------------------
function oreCanvas(ore, v, low) {
  return tileCanvas(`o:${ore}:${v}:${low}`, (p) => {
    const c = ORE_PX[ore] || [PAL.slate2, PAL.mist, PAL.bone];
    const R = rng(strId(ore), v, 7);
    const yMax = low ? 9 : 13;
    for (let k = 0; k < 3; k++) {
      const x = 2 + ri(R, 11), y = 3 + ri(R, yMax - 4);
      if (ore === 'coal') { p.rect(x, y, 3, 2, c[0]); p.px(x + 1, y, c[1]); p.px(x, y, c[2]); continue; }
      if (k === 2) { p.px(x, y, c[2]); continue; } // a lone 1 px sparkle
      p.rect(x, y, 2, 2, c[1]); p.px(x + 1, y + 1, c[0]); p.px(x, y, c[2]);
    }
  });
}

// ---- Mined floor, rubble, built floors ---------------------------------------------------------------------
function drawFloor(p, name, v, rubble) {
  const S = STONE_RAMP[name] || STONE_RAMP.granite, r = S.r, b = bodyIx(name);
  const base = r[b - 1], spec = r[b], dark = b >= 2 ? PAL.ink : r[0] === base ? PAL.night : r[0];
  const R = rng(strId(name), v, rubble ? 2 : 1);
  p.rect(0, 0, 16, 16, base);
  for (let k = 0; k < 14; k++) p.px(ri(R, 16), ri(R, 16), spec);
  for (let k = 0; k < 6; k++) p.px(ri(R, 16), ri(R, 16), dark);
  for (let k = 0; k < 2; k++) { const x = 2 + ri(R, 11), y = 2 + ri(R, 11); p.px(x, y, r[Math.min(3, b + 1)]); p.px(x + 1, y + 1, dark); } // pebbles
  { const x = 3 + ri(R, 9), y = 3 + ri(R, 9); p.px(x, y, dark); p.px(x + 1, y - 1, dark); } // a pick mark
  if (!rubble) return;
  for (let k = 0; k < 3; k++) {
    const w = 3 + ri(R, 2), h = 2, x = 1 + ri(R, 16 - w - 1), y = 2 + ri(R, 11);
    p.rect(x - 1, y - 1, w + 2, h + 2, PAL.ink);
    p.rect(x, y, w, h, spec); p.hl(x, y, w - 1, r[Math.min(3, b + 1)]); p.px(x + w - 1, y + h - 1, base);
  }
}
function floorCanvas(name, v, rubble) { return tileCanvas(`f:${name}:${v}:${rubble ? 1 : 0}`, (p) => drawFloor(p, name, v, rubble)); }

function planksCanvas(v, ramp, rk) {
  return tileCanvas(`pl:${rk}:${v}`, (p) => {
    const r = ramp, R = rng(31, v, strId(rk));
    for (let k = 0; k < 4; k++) {
      const y = k * 4;
      p.rect(0, y, 16, 3, r[2]);
      p.hl(0, y + 3, 16, r[0]);
      for (let x = 0; x < 16; x++) if (R() < 0.18) p.px(x, y + 1 + ri(R, 2), r[1]);
      p.hl(0, y, 16, r[3]); p.dither(0, y, 16, 1, r[2], 8);
      const j = (k * 5 + v * 3 + 2) % 16;
      p.vl(j, y, 3, r[0]); p.px(j + 1 < 16 ? j + 1 : j - 1, y + 1, r[1]);
    }
  });
}
function flagCanvas(v, ramp, rk) {
  return tileCanvas(`fl:${rk}:${v}`, (p) => {
    const r = ramp, R = rng(37, v, strId(rk));
    p.rect(0, 0, 16, 16, r[0]);
    const slab = (x, y, w, h) => {
      p.rect(x, y, w, h, r[2]);
      p.hl(x, y, w, r[3]); p.vl(x, y, h, r[3]); p.hl(x + 1, y + h - 1, w - 1, r[1]); p.vl(x + w - 1, y + 1, h - 1, r[1]);
      if (R() < 0.6) p.px(x + 2 + ri(R, Math.max(1, w - 4)), y + 2 + ri(R, Math.max(1, h - 3)), r[1]);
    };
    const o = (v & 1) * 4;
    slab(0, 0, 7 + o, 7); slab(8 + o, 0, 8 - o, 7);
    slab(0, 8, 3 + o, 7); slab(4 + o, 8, 7, 7); slab(12 + o, 8, 4 - o, 7);
  });
}
function smoothCanvas(v, ramp, rk) {
  return tileCanvas(`sm:${rk}:${v}`, (p) => {
    const r = ramp;
    p.rect(0, 0, 16, 16, r[2]);
    p.hl(0, 7, 16, r[1]); p.vl(7, 0, 16, r[1]); p.hl(0, 15, 16, r[1]); p.vl(15, 0, 16, r[1]);
    for (let k = 0; k < 6; k++) p.px(((v * 5 + k * 3) % 13) + 1, 2 + k * 2, r[3]); // a polished sheen
  });
}

// ---- Surface ------------------------------------------------------------------------------------------------
// base colour and the fringe priority (a higher terrain creeps over a lower neighbour; 0 = none)
const SURF = [];
const sf = (t, base, pri) => { SURF[t] = { base, pri }; };
sf(TER.VOID, PAL.night, 0); sf(TER.GRASS, PAL.moss2, 8); sf(TER.MEADOW, PAL.moss3, 7); sf(TER.DIRT, PAL.umber2, 5);
sf(TER.SAND, PAL.sand, 3); sf(TER.RICH, PAL.umber1, 6); sf(TER.MARSH, PAL.moss1, 4); sf(TER.SHALLOW, PAL.water, 2);
sf(TER.DEEP, PAL.deep, 1); sf(TER.ROCK, PAL.slate1, 0); sf(TER.ROUGH, PAL.stone0, 0); sf(TER.RUBBLE, PAL.stone0, 0);
sf(TER.MOSS, PAL.moss1, 7); sf(TER.TILLED, PAL.umber1, 0); sf(TER.ICE, PAL.mist, 0); sf(TER.LAVA, PAL.ember1, 0);
const isWater = (t) => t === TER.SHALLOW || t === TER.DEEP;

function drawSurface(p, t, v) {
  const R = rng(t, v, 91);
  const any = (n, c, y0 = 0, y1 = 16) => { for (let k = 0; k < n; k++) p.px(ri(R, 16), y0 + ri(R, y1 - y0), c); };
  switch (t) {
    case TER.GRASS:
      p.rect(0, 0, 16, 16, PAL.moss2);
      any(18, PAL.moss1); any(6, PAL.moss3);
      for (let k = 0; k < 2 + (v & 1); k++) { const x = 1 + ri(R, 13), y = 2 + ri(R, 12); p.px(x, y, PAL.moss3); p.px(x + 2, y, PAL.moss3); p.px(x + 1, y + 1, PAL.moss3); p.px(x + 1, y + 2, PAL.moss1); }
      break;
    case TER.MEADOW:
      p.rect(0, 0, 16, 16, PAL.moss3);
      any(16, PAL.moss2); any(4, PAL.moss1);
      for (let k = 0; k < 2; k++) { const x = 1 + ri(R, 14), y = 1 + ri(R, 14), c = [PAL.gold, PAL.bone, PAL.danger, PAL.violet][ri(R, 4)]; p.px(x, y, c); p.px(x, y + 1, PAL.moss1); }
      break;
    case TER.DIRT:
      p.rect(0, 0, 16, 16, PAL.umber2);
      any(16, PAL.umber1); any(5, PAL.umber3);
      for (let k = 0; k < 2; k++) { const x = 1 + ri(R, 13), y = 1 + ri(R, 13); p.px(x, y, PAL.tan); p.px(x + 1, y, PAL.umber3); p.hl(x, y + 1, 2, PAL.umber0); }
      break;
    case TER.SAND:
      p.rect(0, 0, 16, 16, PAL.sand);
      any(14, PAL.tan); any(3, PAL.umber3); any(4, PAL.peach);
      break;
    case TER.RICH:
      p.rect(0, 0, 16, 16, PAL.umber1);
      any(16, PAL.umber0); any(8, PAL.umber2); any(4, PAL.moss1);
      break;
    case TER.MARSH:
      p.rect(0, 0, 16, 16, PAL.moss1);
      any(12, PAL.moss0); any(6, PAL.moss2);
      for (let k = 0; k < 2; k++) { const x = 1 + ri(R, 11), y = 2 + ri(R, 12); p.hl(x, y, 3 + ri(R, 2), PAL.water); p.px(x + 1, y, PAL.shallow); }
      { const x = 2 + ri(R, 12), y = 3 + ri(R, 10); p.vl(x, y, 3, PAL.moss3); p.px(x + 1, y - 1, PAL.moss3); }
      break;
    case TER.MOSS:
      p.rect(0, 0, 16, 16, PAL.moss1);
      any(20, PAL.moss2); any(7, PAL.moss3); any(5, PAL.moss0);
      break;
    case TER.TILLED:
      p.rect(0, 0, 16, 16, PAL.umber1);
      for (let k = 0; k < 4; k++) { p.hl(0, k * 4 + 3, 16, PAL.umber0); p.hl(0, k * 4 + 1, 16, PAL.umber2); }
      any(6, PAL.umber3, 0, 16);
      break;
    case TER.ICE:
      p.rect(0, 0, 16, 16, PAL.mist);
      p.dither(0, 0, 16, 16, PAL.slate3, 3);
      { let x = 2 + ri(R, 4), y = 3 + ri(R, 4); for (let k = 0; k < 9; k++) { p.px(x, y, PAL.slate2); x++; if (R() < 0.4) y++; } }
      p.hl(3 + ri(R, 6), 11, 4, PAL.bone);
      break;
    case TER.LAVA:
      p.rect(0, 0, 16, 16, PAL.ember1);
      p.dither(0, 0, 16, 16, PAL.orange, 6);
      for (let k = 0; k < 3; k++) { const x = 1 + ri(R, 12), y = 1 + ri(R, 12); p.rect(x, y, 3, 2, PAL.gold); p.px(x + 1, y, PAL.flame); }
      any(6, PAL.ember0);
      break;
    case TER.SHALLOW:
      p.rect(0, 0, 16, 16, PAL.water);
      p.dither(0, 0, 16, 16, PAL.shallow, 2);
      for (let k = 0; k < 2; k++) { const x = 1 + ri(R, 10), y = 2 + ri(R, 12); p.hl(x, y, 3 + ri(R, 3), PAL.shallow); }
      break;
    case TER.DEEP:
      p.rect(0, 0, 16, 16, PAL.deep);
      p.dither(0, 0, 16, 16, PAL.water, 2);
      { const x = 1 + ri(R, 10), y = 2 + ri(R, 12); p.hl(x, y, 3 + ri(R, 3), PAL.water); }
      break;
    default:
      p.rect(0, 0, 16, 16, PAL.night);
      break;
  }
}
const surfCanvas = (t, v) => tileCanvas(`s:${t}:${v}`, (p) => drawSurface(p, t, v));

/**
 * A ragged fringe of terrain `t` creeping in from side `side` (0 N, 1 E, 2 S, 3 W): the source
 * tile's own pixels within a depth of 1-4 px from that edge; over water a row of foam follows it.
 */
function fringeCanvas(t, side, v, water) {
  return tileCanvas(`fr:${t}:${side}:${v}:${water ? 1 : 0}`, (p, g) => {
    const R = rng(t * 7 + side, v, 53);
    const depth = new Int8Array(16);
    let d = 1 + ri(R, 3);
    for (let i = 0; i < 16; i++) { depth[i] = d; const r = R(); if (r < 0.3 && d > 1) d--; else if (r > 0.7 && d < 4) d++; }
    // mask, then the source texture inside it
    g.fillStyle = '#000';
    for (let i = 0; i < 16; i++) {
      const k = depth[i];
      if (side === 0) g.fillRect(i, 0, 1, k); else if (side === 2) g.fillRect(i, 16 - k, 1, k);
      else if (side === 3) g.fillRect(0, i, k, 1); else g.fillRect(16 - k, i, k, 1);
    }
    g.globalCompositeOperation = 'source-in';
    g.drawImage(surfCanvas(t, v), 0, 0);
    g.globalCompositeOperation = 'source-over';
    p.fs = null;
    if (!water) return;
    for (let i = 0; i < 16; i++) {
      if (!dith(i, side, 10)) continue;
      const k = depth[i];
      if (side === 0) p.px(i, k, PAL.mist); else if (side === 2) p.px(i, 15 - k, PAL.mist);
      else if (side === 3) p.px(k, i, PAL.mist); else p.px(15 - k, i, PAL.mist);
    }
  });
}

/**
 * Paint one surface tile (any terrain but natural rock and mined floor) with the fringes of its
 * higher neighbours. s: the colony (reads s.L.terrain only).
 */
export function paintSurfaceTile(g, s, tx, ty, detail = true) {
  const L = s.L, i = ty * W + tx, t = L.terrain[i];
  const v = variant(tx, ty);
  put(g, surfCanvas(SURF[t] ? t : TER.VOID, v), tx, ty);
  const me = SURF[t] ? SURF[t].pri : 0;
  if (!me && t !== TER.TILLED) return;
  if (!detail) return;
  const wat = isWater(t);
  for (let side = 0; side < 4; side++) {
    const nx = tx + (side === 1 ? 1 : side === 3 ? -1 : 0), ny = ty + (side === 2 ? 1 : side === 0 ? -1 : 0);
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const u = L.terrain[ny * W + nx], o = SURF[u];
    if (!o || o.pri <= me || !me) continue;
    put(g, fringeCanvas(u, side, variant(nx, ny, 3) & 1, wat && !isWater(u)), tx, ty);
  }
}
/** The shadow a rock (or a built wall's mass) casts on the open tile south of it. */
export function paintShadowN(g, tx, ty) {
  put(g, tileCanvas('sh:n', (p) => { p.dither(0, 0, 16, 1, PAL.ink, 10); p.dither(0, 1, 16, 1, PAL.ink, 5); p.dither(0, 2, 16, 1, PAL.ink, 2); }), tx, ty);
}
/** Blight tint: a violet dither (v = the blight layer value, 0-255). */
export function paintBlight(g, tx, ty, v) {
  const lv = v > 300 ? 8 : v > 120 ? 6 : 3;
  put(g, tileCanvas(`bl:${lv}`, (p) => p.dither(0, 0, 16, 16, PAL.plum0, lv)), tx, ty);
}
/** Water shimmer (drawn per frame over visible water): frame 0 or 1. */
export function paintShimmer(g, tx, ty, frame) {
  const v = variant(tx, ty, 5), key = skey('wv', v * 2 + (frame & 1)), hit = tilePeek(key);
  if (hit) { put(g, hit, tx, ty); return; }
  put(g, tileCanvas(key, (p) => {
    const R = rng(v, 0, 77);
    for (let k = 0; k < 3; k++) {
      const x = 1 + ri(R, 11), y = 2 + ri(R, 12), dx = frame ? 1 : -1;
      p.hl(x + (frame ? 1 : 0), y, 2, PAL.shallow); p.px(x + 2 + dx, y - 1 + (frame ? 0 : 1), PAL.mist);
    }
  }), tx, ty);
}

// ---- The painters C's terrain layer calls ---------------------------------------------------------------------
/** Natural rock, seen from the south (3/4 view). mask: open sides (N 1, E 2, S 4, W 8). */
export function paintRockTile(g, tx, ty, mask, mat, known, detail = true) {
  const name = known ? stoneName(mat) : 'unknown';
  put(g, rockCanvas(name, mask & 15, detail ? variant(tx, ty) : 0), tx, ty);
}
/** Ore glints on a known rock tile (L.ore value). mask: the rock's open sides (glints stay off its face). */
export function paintOreGlint(g, tx, ty, ore, detail = true, mask = 0) {
  const name = typeof ore === 'number' ? ORE_IDS[ore] : ore;
  if (!name) return;
  if ((mask & 15) === 15) return; // a natural pillar shows no vein
  put(g, oreCanvas(name, detail ? variant(tx, ty, 1) : 0, mask & 4 ? 1 : 0), tx, ty);
}
/** Mined rough floor and rubble, by the stone it was cut from (L.mat). */
export function paintMinedFloor(g, tx, ty, mat, detail = true, rubble = false) {
  put(g, floorCanvas(stoneName(mat || 3), detail ? variant(tx, ty) : 0, rubble), tx, ty);
}
/** A built floor tile ('struct.f_planks' | 'struct.f_flag' | 'floor.smooth'); mat: material id or L.mat value. */
export function paintFloorTile(g, key, tx, ty, mat, detail = true) {
  const v = detail ? variant(tx, ty, 2) : 0;
  const m = typeof mat === 'number' ? stoneName(mat) : mat;
  const f2 = FLOOR2[key];
  if (f2) { const r = rampOf(m || (key === 'struct.bridge' ? 'wood' : 'granite'), key === 'struct.bridge' || key === 'struct.f_carpet' ? 'wood' : 'stone'); put(g, tileCanvas(`f2:${key}:${m || ''}:${v}`, (p) => PARTS2[f2](p, { r, v, key, W: 16, H: 16 })), tx, ty); return; }
  if (key === 'struct.f_planks') { const r = rampOf(m && rampOf(m) !== RAMP.wood ? m : 'wood', 'wood'); put(g, planksCanvas(v, r, m || 'wood'), tx, ty); return; }
  const r = rampOf(m || 'granite', 'stone');
  if (key === 'floor.smooth') { put(g, smoothCanvas(v, r, m || 'granite'), tx, ty); return; }
  put(g, flagCanvas(v, r, m || 'granite'), tx, ty);
}
/** The scuffed ground mark under a stone pile. */
export function paintPileMark(g, tx, ty, mat) {
  const name = stoneName(mat || 3), r = STONE_RAMP[name].r;
  put(g, tileCanvas(`pm:${name}`, (p) => { p.shadow(8, 11, 6.5, 3, 5); p.px(4, 12, r[2]); p.px(11, 10, r[2]); p.px(7, 13, r[1]); }), tx, ty);
}

/** Any ground or floor key by name (contact sheet, drawArt): opt { mask, mat, detail }. */
export function paintGround(g, key, tx, ty, opt = {}) {
  const detail = opt.detail !== false;
  const matOf = (m, d) => (typeof m === 'number' ? m : m ? Math.max(1, STONE_IDS.indexOf(m)) : d);
  if (key.startsWith('rock.')) {
    const st = key.slice(5);
    paintRockTile(g, tx, ty, opt.mask ?? 4, st === 'unknown' ? 0 : Math.max(1, STONE_IDS.indexOf(st)), st !== 'unknown', detail);
    return true;
  }
  if (key.startsWith('ore.')) {
    const mask = opt.mask ?? 4;
    paintRockTile(g, tx, ty, mask, matOf(opt.mat, 3), true, detail);
    paintOreGlint(g, tx, ty, Math.max(1, ORE_IDS.indexOf(key.slice(4))), detail, mask);
    return true;
  }
  switch (key) {
    case 'floor.mined': paintMinedFloor(g, tx, ty, matOf(opt.mat, 3), detail, false); return true;
    case 'floor.rubble': paintMinedFloor(g, tx, ty, matOf(opt.mat, 3), detail, true); return true;
    case 'floor.smooth': paintFloorTile(g, key, tx, ty, typeof opt.mat === 'string' ? opt.mat : 'marble', detail); return true;
    case 'ground.pile': paintMinedFloor(g, tx, ty, matOf(opt.mat, 3), detail, false); paintPileMark(g, tx, ty, matOf(opt.mat, 3)); return true;
    case 'struct.f_planks': case 'struct.f_flag': paintFloorTile(g, key, tx, ty, opt.mat ?? 'granite', detail); return true;
    case 'struct.road': case 'struct.bridge': case 'struct.f_brick': case 'struct.f_carpet': paintFloorTile(g, key, tx, ty, typeof opt.mat === 'string' ? opt.mat : null, detail); return true;
    default: return false;
  }
}
export { ROOF };
