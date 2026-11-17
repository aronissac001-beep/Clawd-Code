// Terrain layer (owner C; doc 12.4): chunk bakes in three bands with an LRU each, the tile-colour
// texture (minimap and never-blank placeholder), 3 x 3 patch redraws queued by markDirty, and the
// tile painter (adapted from the roguelite render.js paintTerrain, plus rock with 4-neighbour
// autotiled faces, mined floor, ore glints, constructed floors, tilled soil and blight tint).
//
// Stone, ore and floor looks follow the data (materials tints, worldgen STONES / DEPOSITS ids, the
// floor def order); D's kit paints rock, mined floor and floors through registerTileArt. markDirty
// skips tiles whose baked inputs did not change (a fog reveal only touches the light texture).
// Render only: it reads s.L (and never writes state). Canvases are created lazily, never at import.

import { TILE, W, H, TER, ROOF, getBit } from '../../game/core/grid.js';
import { def, all, hasFlag } from '../../game/core/content.js';
import { STONES, DEPOSITS } from '../../data/worldgen.js';
import { hash2 } from '../rng.js';
import { shade } from '../sprites.js';

const T = TILE;
const TAU = Math.PI * 2;

// ---- Tile tables (placeholder art; D's kit replaces the painters through registerTileArt) --------
// Colours follow the data: stone tints from js/data/materials.js by the L.mat ids of worldgen STONES,
// ore glints by the L.ore ids of worldgen DEPOSITS, floor looks by the order of the 'floor' structure
// defs (the floor layer id is that order + 1, core/apply.js floorIdOf). Built lazily on first use.
const STONE_FALLBACK = '#77716a';
const UNKNOWN_ROCK = '#2e2b33';
/** Glint colour by deposit name (gems and Stage 2-3 ores included so later data just works). */
const ORE_COL = { coal: '#121115', copper: '#e08a4c', tin: '#d2d8dc', iron: '#c0643e', silver: '#eef0f6', gold: '#f4c94a',
  lumenite: '#7ae4f0', clay: '#b9805c', amber: '#e8a83c', garnet: '#b8304a', sapphire: '#4a7ae0', emerald: '#40c07a', ruby: '#e0344e', heartstone: '#ff7040' };
/** Floor look by structure id: colour and pattern ('planks' | 'flag' | 'tile'). */
const FLOOR_LOOK = { f_planks: ['#9a7146', 'planks'], f_flag: ['#8e877b', 'flag'], f_smooth: ['#8d877e', 'tile'], f_brick: ['#9a5a46', 'flag'], f_carpet: ['#7a3a4a', 'tile'] };
const PLAIN = { // simple terrain colours not in the biome palette
  rich: '#5f4a32', marsh: '#55623e', rough: '#6c645a', rubble: '#5d5750', moss: '#4f6a44', tilled: '#6e4f33',
  ice: '#bcd8e6', lava: '#e0602a', void: '#17151f',
};
let TAB = null;
/** The data-driven tile tables (stone, ore, floor by layer id). Rebuilt after resetTileTables(). */
export function tileTables() {
  if (TAB) return TAB;
  const stone = STONES.map((n) => { const m = n ? def('material', n) : null; return (m && m.tint) || STONE_FALLBACK; });
  const ore = DEPOSITS.map((n) => (n && ORE_COL[n]) || (n ? '#e8e0c8' : null));
  let floors = [];
  try { floors = all('structure').filter((d) => hasFlag(d, 'floor')); } catch (_) { floors = []; }
  const floor = [null, ...floors.map((d) => { const f = FLOOR_LOOK[d.id] || [(d.tint || '#8d877e'), 'tile']; return { id: d.id, c: f[0], kind: f[1] }; })];
  TAB = { stone, ore, floor };
  return TAB;
}
export function resetTileTables() { TAB = null; }
const stoneOf = (L, i) => TAB.stone[L.mat[i]] || STONE_FALLBACK;

// ---- Tile art hooks (C9): D's kit paints tiles inside their own square ---------------------------
//   registerTileArt('rock',  (g, x, y, t) => bool)   t: { mat, mask (1 N, 2 E, 4 S, 8 W open), known, ore, detail }
//   registerTileArt('floor', (g, x, y, t) => bool)   t: { id (floor def id), detail }
//   registerTileArt('rough', (g, x, y, t) => bool)   t: { mat, rubble, detail }
// Return true when painted; false falls back to the placeholder painter. Everything must stay inside
// the tile (x * 32 .. x * 32 + 32), so a clipped 3 x 3 patch repaints exactly.
const TILE_ART = new Map();
export function registerTileArt(kind, fn) { if (fn) TILE_ART.set(kind, fn); else TILE_ART.delete(kind); TAB = null; }
const ART_INFO = { mat: 0, mask: 0, known: false, ore: 0, detail: true, id: null, rubble: false };

const isWater = (t) => t === TER.SHALLOW || t === TER.DEEP || t === TER.ICE;
const isRock = (t) => t === TER.ROCK;

/** Flat colour of one tile (the tile-colour texture and minimap). */
export function tileColour(s, pal, i) {
  const L = s.L, t = L.terrain[i];
  tileTables();
  const f = L.floor[i] && TAB.floor[L.floor[i]];
  if (f) return f.c;
  switch (t) {
    case TER.GRASS: return pal.grass[0];
    case TER.MEADOW: return pal.meadow;
    case TER.DIRT: return pal.dirt;
    case TER.SAND: return pal.sand;
    case TER.RICH: return PLAIN.rich;
    case TER.MARSH: return PLAIN.marsh;
    case TER.SHALLOW: return pal.water;
    case TER.DEEP: return pal.waterDeep;
    case TER.ROCK: return L.roof[i] === ROOF.OPEN ? pal.crag : getBit(L.known, i) ? shade(stoneOf(L, i), -0.18) : UNKNOWN_ROCK;
    case TER.ROUGH: return shade(stoneOf(L, i), -0.12);
    case TER.RUBBLE: return PLAIN.rubble;
    case TER.MOSS: return PLAIN.moss;
    case TER.TILLED: return PLAIN.tilled;
    case TER.ICE: return PLAIN.ice;
    case TER.LAVA: return PLAIN.lava;
    default: return PLAIN.void;
  }
}

const hexRGB = (c) => {
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = c.match(/\d+/g); return [+m[0], +m[1], +m[2]];
};

/**
 * Paint the tiles of the rectangle [x0, x0 + w) x [y0, y0 + h) in world units into g (already
 * scaled and translated to world space). Blob passes also run over a 1-tile margin, so a clipped
 * repaint of a patch matches a full bake exactly (no blob reaches more than one tile out).
 * `detail` false skips the sub-pixel tufts and specks (far band).
 */
export function paintTerrain(g, s, pal, x0, y0, w, h, detail = true) {
  const L = s.L;
  const ter = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : L.terrain[y * W + x]);
  const X0 = x0 - 1, X1 = x0 + w, Y0 = y0 - 1, Y1 = y0 + h;
  g.globalAlpha = 1;
  g.fillStyle = pal.grass[0];
  g.fillRect(x0 * T, y0 * T, w * T, h * T);
  const blob = (x, y, r, color, alpha = 1, jit = 4) => {
    const jx = (hash2(x, y, 7) - 0.5) * jit, jy = (hash2(x, y, 9) - 0.5) * jit;
    g.globalAlpha = alpha; g.fillStyle = color;
    g.beginPath(); g.arc(x * T + T / 2 + jx, y * T + T / 2 + jy, r, 0, TAU); g.fill();
  };
  // Grass colour blotches (the roguelite look).
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const t = ter(x, y);
    if (t === TER.GRASS || t === TER.MEADOW || t === -1) blob(x, y, T * 0.8, pal.grass[(hash2(x, y, 1) * pal.grass.length) | 0], 0.55, 10);
  }
  // rich soil is a dark olive that blends into the grass: a lone opaque brown disc read as a pit in play
  const soft = [[TER.MEADOW, pal.meadow, 0.72], [TER.DIRT, pal.dirt, 0.6], [TER.SAND, pal.sand, 0.74],
    [TER.RICH, '#4e5530', 0.74, 0.45], [TER.MARSH, PLAIN.marsh, 0.7], [TER.TILLED, PLAIN.tilled, 0.64], [TER.MOSS, PLAIN.moss, 0.7]];
  for (const [type, color, r, a = 1] of soft) {
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === type) blob(x, y, T * r, color, a, 5);
  }
  // Lighter centres on dirt for a worn look.
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === TER.DIRT) blob(x, y, T * 0.3, shade(pal.dirt, 0.1), 0.45, 12);
  // Water with shoreline foam and deep centres (shallow and deep; ice is drawn flat below).
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const t = ter(x, y); if (t === TER.SHALLOW || t === TER.DEEP) blob(x, y, T * 0.74, shade(pal.sand, 0.25), 0.9, 2); }
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) { const t = ter(x, y); if (t === TER.SHALLOW || t === TER.DEEP) blob(x, y, T * 0.66, pal.water, 1, 2); }
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    const t = ter(x, y);
    if (t !== TER.SHALLOW && t !== TER.DEEP) continue;
    const wa = (a, b) => { const u = ter(a, b); return u === TER.SHALLOW || u === TER.DEEP || u === -1; };
    if (t === TER.DEEP || (wa(x + 1, y) && wa(x - 1, y) && wa(x, y + 1) && wa(x, y - 1))) blob(x, y, T * 0.55, pal.waterDeep, 1, 4);
  }
  // Surface crags (rock under open sky): the roguelite's raised outcrops.
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === TER.ROCK && L.roof[y * W + x] === ROOF.OPEN) blob(x, y, T * 0.78, '#4e4b48', 1, 3);
  for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
    if (ter(x, y) !== TER.ROCK || L.roof[y * W + x] !== ROOF.OPEN) continue;
    const jx = (hash2(x, y, 3) - 0.5) * 6;
    g.globalAlpha = 1; g.fillStyle = pal.crag;
    g.beginPath(); g.arc(x * T + T / 2 + jx, y * T + T / 2 - 5, T * 0.62, 0, TAU); g.fill();
    g.fillStyle = pal.cragTop;
    g.beginPath(); g.arc(x * T + T / 2 + jx - 3, y * T + T / 2 - 9, T * 0.36, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  // Hard-edged tiles, each inside its own square: underground floors, ice, lava, floors, then rock.
  tileTables();
  const rough = TILE_ART.get('rough'), floorArt = TILE_ART.get('floor');
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * W + x, t = L.terrain[i], bx = x * T, by = y * T;
    if (t === TER.ROUGH || t === TER.RUBBLE) {
      ART_INFO.mat = L.mat[i]; ART_INFO.rubble = t === TER.RUBBLE; ART_INFO.detail = detail;
      if (!rough || !rough(g, x, y, ART_INFO)) paintRough(g, L, i, x, y, t, detail);
    } else if (t === TER.ICE) {
      g.fillStyle = PLAIN.ice; g.fillRect(bx, by, T, T);
      if (detail) { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx + 5, by + 9 + hash2(x, y, 5) * 10); g.lineTo(bx + 24, by + 6 + hash2(x, y, 6) * 16); g.stroke(); }
    } else if (t === TER.LAVA) {
      g.fillStyle = PLAIN.lava; g.fillRect(bx, by, T, T);
    } else if (t === TER.VOID) {
      g.fillStyle = PLAIN.void; g.fillRect(bx, by, T, T);
    }
    const fl = L.floor[i] ? TAB.floor[L.floor[i]] : null;
    if (fl) { ART_INFO.id = fl.id; ART_INFO.detail = detail; if (!floorArt || !floorArt(g, x, y, ART_INFO)) paintFloor(g, fl, x, y, detail); }
    // Rock casts a soft shadow onto the open tile south of it (drawn inside this tile).
    if (!isRock(t) && y > 0 && isRock(L.terrain[i - W]) && L.roof[i - W] !== ROOF.OPEN) {
      g.fillStyle = 'rgba(15,12,18,0.34)'; g.fillRect(bx, by, T, 5);
      g.fillStyle = 'rgba(15,12,18,0.16)'; g.fillRect(bx, by + 5, T, 4);
    }
    if (isRock(t) && L.roof[i] !== ROOF.OPEN) paintRock(g, s, i, x, y, detail);
    if (L.blight[i]) { g.globalAlpha = Math.min(0.55, L.blight[i] / 400); g.fillStyle = '#5a3a6a'; g.fillRect(bx, by, T, T); g.globalAlpha = 1; }
  }
  if (!detail) return;
  // Small details: tufts, flowers, pebbles, ripples, furrows.
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * W + x, t = L.terrain[i];
    if (L.floor[i]) continue;
    const bx = x * T, by = y * T;
    if (t === TER.TILLED) {
      g.strokeStyle = 'rgba(50,34,20,0.55)'; g.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(bx + 3, by + 5 + k * 7); g.lineTo(bx + T - 3, by + 5 + k * 7); g.stroke(); }
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const hx = hash2(x, y, 20 + k), hy = hash2(x, y, 40 + k);
      const px = bx + 3 + hx * (T - 6), py = by + 3 + hy * (T - 6);
      if (t === TER.GRASS && hash2(x, y, 60 + k) < 0.55) {
        g.strokeStyle = shade(pal.grass[k % pal.grass.length], -0.22); g.lineWidth = 1;
        g.beginPath(); g.moveTo(px - 2, py); g.lineTo(px - 0.5, py - 3.5); g.moveTo(px, py); g.lineTo(px + 0.3, py - 4); g.moveTo(px + 2, py); g.lineTo(px + 1, py - 3); g.stroke();
      } else if (t === TER.MEADOW && hash2(x, y, 80 + k) < 0.6) {
        g.fillStyle = pal.flowers[(hash2(x, y, 90 + k) * pal.flowers.length) | 0];
        g.beginPath(); g.arc(px, py, 1.6, 0, TAU); g.fill();
      } else if (t === TER.DIRT && hash2(x, y, 70 + k) < 0.35) {
        g.fillStyle = 'rgba(70,52,34,0.6)'; g.fillRect(px, py, 2, 1.5);
      } else if ((t === TER.SHALLOW || t === TER.DEEP) && k === 0 && hash2(x, y, 99) < 0.4) {
        g.strokeStyle = 'rgba(200,230,255,0.35)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(px - 4, py); g.quadraticCurveTo(px, py - 2, px + 4, py); g.stroke();
      } else if (t === TER.MOSS && hash2(x, y, 75 + k) < 0.5) {
        g.fillStyle = 'rgba(140,190,110,0.6)'; g.beginPath(); g.arc(px, py, 1.4, 0, TAU); g.fill();
      }
    }
  }
}

/** Mined rough floor and rubble: the stone's own colour, chipped. */
function paintRough(g, L, i, x, y, t, detail) {
  const bx = x * T, by = y * T, base = stoneOf(L, i);
  g.fillStyle = shade(base, -0.12); g.fillRect(bx, by, T, T);
  if (detail) {
    for (let k = 0; k < 6; k++) {
      g.fillStyle = k & 1 ? shade(base, -0.3) : shade(base, 0.1);
      g.fillRect(bx + 2 + hash2(x, y, 110 + k) * (T - 5), by + 2 + hash2(x, y, 120 + k) * (T - 5), 2.2, 1.6);
    }
    // faint pick marks
    g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1; g.beginPath();
    const px = bx + 6 + hash2(x, y, 125) * 16, py = by + 8 + hash2(x, y, 126) * 14;
    g.moveTo(px, py); g.lineTo(px + 5, py - 3); g.stroke();
  }
  if (t === TER.RUBBLE) for (let k = 0; k < 6; k++) {
    const px = bx + 4 + hash2(x, y, 130 + k) * (T - 8), py = by + 4 + hash2(x, y, 140 + k) * (T - 8);
    g.fillStyle = k % 3 ? shade(base, 0.05) : shade(base, -0.35);
    g.beginPath(); g.moveTo(px - 3, py + 2); g.lineTo(px - 1, py - 3); g.lineTo(px + 3, py - 2); g.lineTo(px + 2, py + 3); g.closePath(); g.fill();
  }
}

/** Constructed floor (placeholder looks: planks, flagstones, plain tiles). */
function paintFloor(g, f, x, y, detail) {
  const bx = x * T, by = y * T, c = f.c;
  g.fillStyle = c; g.fillRect(bx, by, T, T);
  if (!detail) return;
  g.strokeStyle = shade(c, -0.3); g.lineWidth = 1;
  g.beginPath();
  if (f.kind === 'planks') {
    for (let k = 1; k < 4; k++) { g.moveTo(bx, by + k * 8); g.lineTo(bx + T, by + k * 8); }
    for (let k = 0; k < 4; k++) { const o = 4 + (((x * 5 + y * 3 + k * 7) % 4) * 7); g.moveTo(bx + o, by + k * 8); g.lineTo(bx + o, by + k * 8 + 8); }
  } else if (f.kind === 'flag') {
    g.moveTo(bx, by + T / 2); g.lineTo(bx + T, by + T / 2);
    const o = (y & 1) * 8;
    g.moveTo(bx + 12 + o, by); g.lineTo(bx + 12 + o, by + T / 2);
    g.moveTo(bx + 4 + o, by + T / 2); g.lineTo(bx + 4 + o, by + T); g.moveTo(bx + 22 + o / 2, by + T / 2); g.lineTo(bx + 22 + o / 2, by + T);
  }
  g.stroke();
  g.strokeStyle = shade(c, -0.18); g.strokeRect(bx + 0.5, by + 0.5, T - 1, T - 1);
  if (f.kind === 'flag') { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(bx + 2, by + 2, 8, 2); g.fillRect(bx + 18, by + 18, 8, 2); }
}

/**
 * Natural rock with 4-neighbour autotiled faces (16 masks per stone): a darker body, a lit top
 * edge where the north side is open, a tall wall face where the south side is open (the view is
 * from the south), side shading on east and west. A rock tile open on all four sides is a natural
 * pillar (a round column). Unknown rock is a dark face with no material. Known ore shows glints.
 * Everything stays inside the tile so a 3 x 3 patch repaints exactly.
 */
function paintRock(g, s, i, x, y, detail) {
  const L = s.L, bx = x * T, by = y * T;
  const open = (j, ok) => ok && !isRock(L.terrain[j]);
  const n = open(i - W, y > 0), e = open(i + 1, x < W - 1), so = open(i + W, y < H - 1), w = open(i - 1, x > 0);
  const known = getBit(L.known, i) === 1;
  const art = TILE_ART.get('rock');
  if (art) {
    ART_INFO.mat = L.mat[i]; ART_INFO.mask = (n ? 1 : 0) | (e ? 2 : 0) | (so ? 4 : 0) | (w ? 8 : 0); ART_INFO.known = known;
    ART_INFO.ore = known ? L.ore[i] : 0; ART_INFO.detail = detail;
    if (art(g, x, y, ART_INFO)) return;
  }
  const base = known ? stoneOf(L, i) : UNKNOWN_ROCK;
  if (n && e && so && w) { paintPillar(g, L, i, x, y, base, known, detail); return; }
  g.fillStyle = shade(base, -0.2); g.fillRect(bx, by, T, T);
  if (detail) {
    for (let k = 0; k < 4; k++) {
      const px = bx + 3 + hash2(x, y, 150 + k) * (T - 8), py = by + 3 + hash2(x, y, 160 + k) * (T - 10);
      g.fillStyle = k & 1 ? shade(base, -0.36) : shade(base, 0.0);
      g.fillRect(px, py, 4 + hash2(x, y, 170 + k) * 4, 2);
    }
  }
  if (so) { // wall face toward the viewer
    const fh = 11;
    g.fillStyle = shade(base, -0.44); g.fillRect(bx, by + T - fh, T, fh);
    g.fillStyle = shade(base, -0.02); g.fillRect(bx, by + T - fh - 2, T, 2);
    if (detail) { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 3; k++) g.fillRect(bx + 4 + k * 10 + hash2(x, y, 180 + k) * 4, by + T - fh + 2, 1.2, fh - 3); }
  }
  if (n) { g.fillStyle = shade(base, 0.22); g.fillRect(bx, by, T, 2.5); }
  if (w) { g.fillStyle = shade(base, 0.08); g.fillRect(bx, by, 2.5, so ? T - 11 : T); }
  if (e) { g.fillStyle = shade(base, -0.42); g.fillRect(bx + T - 2.5, by, 2.5, so ? T - 11 : T); }
  if (known && L.ore[i]) paintOre(g, L.ore[i], x, y, bx, by + (so ? -3 : 0), detail);
}

/** A natural pillar: a rock tile with open ground on all four sides. */
function paintPillar(g, L, i, x, y, base, known, detail) {
  const bx = x * T, by = y * T, cx = bx + T / 2;
  g.fillStyle = 'rgba(15,12,18,0.35)'; g.beginPath(); g.ellipse(cx, by + T - 5, 13, 4.5, 0, 0, TAU); g.fill();
  g.fillStyle = shade(base, -0.38); g.fillRect(cx - 10, by + 8, 20, T - 13);
  g.fillStyle = shade(base, -0.2); g.fillRect(cx - 10, by + 8, 7, T - 13);
  g.fillStyle = shade(base, -0.5); g.fillRect(cx + 5, by + 8, 5, T - 13);
  g.fillStyle = shade(base, 0.12); g.beginPath(); g.ellipse(cx, by + 8, 10, 5, 0, 0, TAU); g.fill();
  if (detail) { g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.beginPath(); g.ellipse(cx, by + 8, 10, 5, 0, 0, TAU); g.stroke(); }
  if (known && L.ore[i]) paintOre(g, L.ore[i], x, y, bx, by + 4, detail);
}

/** Ore glints: three small faceted diamonds with a highlight (coal gets a pale rim to read on dark stone). */
function paintOre(g, ore, x, y, bx, by, detail) {
  const c = TAB.ore[ore];
  if (!c) return;
  const coal = c === ORE_COL.coal;
  for (let k = 0; k < 3; k++) {
    const px = bx + 6 + hash2(x, y, 190 + k) * (T - 12), py = by + 6 + hash2(x, y, 200 + k) * (T - 18), r = 3 - k * 0.5;
    g.fillStyle = c; g.beginPath(); g.moveTo(px, py - r); g.lineTo(px + r, py); g.lineTo(px, py + r); g.lineTo(px - r, py); g.closePath(); g.fill();
    if (coal) { g.strokeStyle = 'rgba(200,200,215,0.55)'; g.lineWidth = 0.8; g.stroke(); }
    if (detail) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(px - 0.7, py - r * 0.6, 1.4, 1.4); }
  }
}

// ---- Chunk bands ---------------------------------------------------------------------------------

/** Pick the band for zoom z, moving off the current band only past the +-hysteresis edges. */
export function bandFor(bands, z, cur, hys) {
  let b = cur < 0 || cur >= bands.length ? bands.findIndex((B) => z >= B.minZoom) : cur;
  if (b < 0) b = bands.length - 1;
  for (let k = 0; k < bands.length; k++) {
    if (b > 0 && z >= bands[b - 1].minZoom + hys) b--;
    else if (b < bands.length - 1 && z < bands[b].minZoom - hys) b++;
    else break;
  }
  return b;
}

export class TerrainLayer {
  constructor(cfg) {
    this.cfg = cfg;
    this.bands = cfg.bands;
    this.held = this.bands.map(() => new Map());   // key -> { c, g, cx, cy } in LRU order (oldest first)
    this.band = -1; this.prevBand = -1;
    this.s = null; this.pal = null;
    this.ph = null; this.phg = null; this.phImg = null; // tile-colour texture (minimap, placeholder)
    this.patchQ = []; this.patchSet = new Set();
    this.need = [];
    this.sig = null;           // bake signature per tile at its last paint (skip patches that change nothing baked)
    this.phVer = 0;            // bumped when the tile-colour texture changes (minimap)
    this.st = { bakes: 0, bakeMs: 0, bakeMax: 0, evictions: 0, patches: 0, patchSkips: 0, patchMs: 0, placeholderRects: 0, blankRects: 0, failed: 0, released: 0 };
  }

  setState(s, pal) {
    for (let b = 0; b < this.held.length; b++) this.releaseBand(b, Infinity);
    this.s = s; this.pal = pal;
    this.band = -1; this.prevBand = -1;
    this.patchQ.length = 0; this.patchSet.clear();
    resetTileTables();
    if (!this.sig || this.sig.length !== W * H) this.sig = new Uint32Array(W * H);
    for (let i = 0; i < W * H; i++) this.sig[i] = this.sigOf(i);
    this.buildPlaceholder();
  }
  /** Everything a chunk bake reads for tile i, packed (terrain, stone, ore, floor, open sky, known, blight band). */
  sigOf(i) {
    const L = this.s.L;
    return (L.terrain[i] | (L.mat[i] << 4) | (L.ore[i] << 8) | (L.floor[i] << 14) | ((L.roof[i] === ROOF.OPEN ? 1 : 0) << 22)
      | (getBit(L.known, i) << 23) | ((L.blight[i] >> 6) << 24)) >>> 0;
  }

  // ---- Tile-colour texture (W x H, 1 px per tile) ----
  buildPlaceholder() {
    const s = this.s;
    if (!this.ph) { this.ph = document.createElement('canvas'); this.phg = this.ph.getContext('2d'); }
    if (this.ph.width !== W || this.ph.height !== H) { this.ph.width = W; this.ph.height = H; this.phImg = null; }
    if (!this.phImg) this.phImg = this.phg.createImageData(W, H);
    const d = this.phImg.data, memo = new Map();
    for (let i = 0; i < W * H; i++) {
      const c = tileColour(s, this.pal, i);
      let rgb = memo.get(c); if (!rgb) memo.set(c, (rgb = hexRGB(c)));
      d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
    }
    this.phg.putImageData(this.phImg, 0, 0);
    this.phVer++;
  }
  patchPlaceholder(x0, y0, x1, y1) {
    const d = this.phImg.data;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, rgb = hexRGB(tileColour(this.s, this.pal, i));
      d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
    }
    this.phg.putImageData(this.phImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.phVer++;
  }
  /** The minimap canvas (W x H px). */
  get minimap() { return this.ph; }

  // ---- Bands, LRU and release ----
  heldCount(b) { return this.held[b].size; }
  heldBytes() {
    let n = 0;
    for (let b = 0; b < this.bands.length; b++) { const px = this.bands[b].chunk * T * this.bands[b].tscale; n += this.held[b].size * px * px * 4; }
    return n;
  }
  releaseBand(b, max) {
    const m = this.held[b];
    let n = 0;
    for (const [k, e] of m) {
      if (n >= max) break;
      e.c.width = e.c.height = 0; // iOS frees canvas memory reliably only then (12.4)
      m.delete(k); n++;
    }
    this.st.released += n;
    return n;
  }
  evict(b) {
    const m = this.held[b], cap = this.bands[b].lru;
    while (m.size > cap) {
      const [k, e] = m.entries().next().value;
      e.c.width = e.c.height = 0;
      m.delete(k); this.st.evictions++;
    }
  }

  bake(b, cx, cy) {
    const B = this.bands[b], n = B.chunk, px = n * T * B.tscale;
    const t0 = performance.now();
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    if (!g || c.width !== px) { this.st.failed++; c.width = c.height = 0; return null; } // over the canvas-memory cap
    g.setTransform(B.tscale, 0, 0, B.tscale, -cx * n * T * B.tscale, -cy * n * T * B.tscale);
    const x0 = cx * n, y0 = cy * n;
    paintTerrain(g, this.s, this.pal, x0, y0, Math.min(n, W - x0), Math.min(n, H - y0), B.tscale >= 1);
    const ms = performance.now() - t0;
    this.st.bakes++; this.st.bakeMs += ms; if (ms > this.st.bakeMax) this.st.bakeMax = ms;
    if (this.onBake) this.onBake(ms, b);
    return { c, g, cx, cy };
  }

  /** Drop every held chunk (new tile art): they rebake one per frame, the placeholder covering them. */
  rebakeAll() { for (let b = 0; b < this.held.length; b++) this.releaseBand(b, Infinity); resetTileTables(); }

  /**
   * Queue a 3 x 3 patch redraw around tile (tx, ty) (C9 markDirty). A tile whose baked inputs did
   * not change (a fog-only reveal, a growth tick) is skipped: the light texture carries fog.
   * force = true always patches (debug, art swaps).
   */
  markDirty(tx, ty, force = false) {
    const i = ty * W + tx;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H || this.patchSet.has(i)) return;
    if (!force && this.sig && this.s && this.sig[i] === this.sigOf(i)) { this.st.patchSkips++; return; }
    this.patchSet.add(i); this.patchQ.push(i);
  }
  runPatches(max) {
    let done = 0;
    const t0 = this.patchQ.length ? performance.now() : 0;
    while (this.patchQ.length && done < max) {
      const i = this.patchQ.shift(); this.patchSet.delete(i);
      const tx = i % W, ty = (i / W) | 0;
      const x0 = Math.max(0, tx - 1), y0 = Math.max(0, ty - 1), x1 = Math.min(W - 1, tx + 1), y1 = Math.min(H - 1, ty + 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.sig[y * W + x] = this.sigOf(y * W + x);
      this.patchPlaceholder(x0, y0, x1, y1);
      for (let b = 0; b < this.bands.length; b++) {
        const B = this.bands[b], n = B.chunk, m = this.held[b];
        if (!m.size) continue;
        for (let cy = (y0 / n) | 0; cy <= ((y1 / n) | 0); cy++) for (let cx = (x0 / n) | 0; cx <= ((x1 / n) | 0); cx++) {
          const e = m.get(cy * 1024 + cx);
          if (!e) continue;
          const g = e.g;
          g.save();
          g.setTransform(B.tscale, 0, 0, B.tscale, -cx * n * T * B.tscale, -cy * n * T * B.tscale);
          g.beginPath(); g.rect(x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T); g.clip();
          paintTerrain(g, this.s, this.pal, x0, y0, x1 - x0 + 1, y1 - y0 + 1, B.tscale >= 1);
          g.restore();
        }
      }
      done++; this.st.patches++;
    }
    if (done) this.st.patchMs += performance.now() - t0;
    return done;
  }

  /**
   * Draw the terrain under view (world units) at zoom z. Held chunks draw; missing ones draw the
   * tile-colour texture (never blank) and queue; at most cfg.bakesPerFrame bakes run, nearest first.
   */
  draw(g, view, z, camX, camY) {
    const cfg = this.cfg;
    const nb = bandFor(this.bands, z, this.band, cfg.hysteresis);
    if (nb !== this.band) { if (this.band >= 0) this.prevBand = this.band; this.band = nb; }
    // Only the active band and the neighbour it came from keep canvases. A band two steps away (a
    // jump from near to far) is freed at once, so at most two adjacent bands are ever held.
    for (let b = 0; b < this.bands.length; b++) {
      if (b === this.band || (b === this.prevBand && Math.abs(b - this.band) === 1)) continue;
      if (this.held[b].size) this.releaseBand(b, Math.abs(b - this.band) > 1 ? Infinity : cfg.releasePerFrame);
    }
    this.runPatches(cfg.patchesPerFrame);
    const B = this.bands[this.band], n = B.chunk, size = n * T, m = this.held[this.band];
    const ncx = Math.ceil(W / n), ncy = Math.ceil(H / n);
    const cx0 = Math.max(0, Math.floor(view.x0 / size)), cx1 = Math.min(ncx - 1, Math.floor(view.x1 / size));
    const cy0 = Math.max(0, Math.floor(view.y0 / size)), cy1 = Math.min(ncy - 1, Math.floor(view.y1 / size));
    const need = this.need; need.length = 0;
    let visible = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = cy * 1024 + cx, e = m.get(key);
      visible++;
      const tw = Math.min(n, W - cx * n), th = Math.min(n, H - cy * n);
      if (e) {
        m.delete(key); m.set(key, e); // LRU touch
        g.drawImage(e.c, 0, 0, tw * T * B.tscale, th * T * B.tscale, cx * size, cy * size, tw * T, th * T);
      } else {
        this.drawPlaceholder(g, cx * n, cy * n, tw, th);
        need.push(key);
      }
    }
    this.visible = visible;
    if (need.length) {
      const ccx = camX / size - 0.5, ccy = camY / size - 0.5;
      need.sort((a, b2) => {
        const ax = (a % 1024) - ccx, ay = ((a / 1024) | 0) - ccy, bx = (b2 % 1024) - ccx, by = ((b2 / 1024) | 0) - ccy;
        return ax * ax + ay * ay - (bx * bx + by * by) || a - b2;
      });
      for (let k = 0; k < Math.min(cfg.bakesPerFrame, need.length); k++) {
        const key = need[k], cx = key % 1024, cy = (key / 1024) | 0;
        const e = this.bake(this.band, cx, cy);
        if (!e) continue; // failed: the placeholder stays
        m.set(key, e); this.evict(this.band);
        const tw = Math.min(n, W - cx * n), th = Math.min(n, H - cy * n);
        g.drawImage(e.c, 0, 0, tw * T * B.tscale, th * T * B.tscale, cx * size, cy * size, tw * T, th * T);
        this.st.placeholderRects--;
      }
    }
    return visible;
  }
  drawPlaceholder(g, x0, y0, tw, th) {
    if (!this.ph || !this.ph.width) { this.st.blankRects++; return; }
    const sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.ph, x0, y0, tw, th, x0 * T, y0 * T, tw * T, th * T);
    g.imageSmoothingEnabled = sm;
    this.st.placeholderRects++;
  }
}
