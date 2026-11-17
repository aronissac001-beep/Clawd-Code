// Terrain layer (owner C; doc 12.4): chunk bakes in three bands with an LRU each, the tile-colour
// texture (minimap and never-blank placeholder), 3 x 3 patch redraws queued by markDirty, and the
// tile painter (adapted from the roguelite render.js paintTerrain, plus rock with 4-neighbour
// autotiled faces, mined floor, ore glints, constructed floors, tilled soil and blight tint).
//
// Render only: it reads s.L (and never writes state). Canvases are created lazily, never at import.

import { TILE, W, H, TER, ROOF, getBit } from '../../game/core/grid.js';
import { hash2 } from '../rng.js';
import { shade } from '../sprites.js';

const T = TILE;
const TAU = Math.PI * 2;

// ---- Placeholder art tables (D replaces these with kit art keys, js/engine/art/keys.js) ----------
/** Stone colour by material id (B's stub ids: 1 sandstone, 3 granite, 5 basalt, 7 duskstone). */
const STONE = ['#77716a', '#a08a68', '#8f8676', '#868a8e', '#7a7775', '#4f5157', '#5f5a66', '#3f3a4a',
  '#8a7f70', '#6d6a60', '#7f7466', '#5d6264', '#6a6158', '#8c8478', '#4a4650', '#706b64'];
const UNKNOWN_ROCK = '#2e2b33';
/** Ore glint colour by deposit id (coal, copper, tin, iron, silver, gold, then gems). */
const ORE = [null, '#1c1b1f', '#d9874a', '#c8cdd2', '#b0603c', '#e6e8ee', '#f0c64a', '#6ad0e0', '#d04a6a', '#7ae08a'];
/** Constructed floor colours by floor id (smoothed stone, planks, flagstone, brick, carpet, mosaic, road). */
const FLOOR = [null, '#8d877e', '#9a7146', '#8a8478', '#9a5a46', '#7a3a4a', '#6a7a8a', '#6f6457'];
const PLAIN = { // simple terrain colours not in the biome palette
  rich: '#5a4430', marsh: '#55623e', rough: '#6c645a', rubble: '#5d5750', moss: '#4f6a44', tilled: '#6e4f33',
  ice: '#bcd8e6', lava: '#e0602a', void: '#17151f',
};

const isWater = (t) => t === TER.SHALLOW || t === TER.DEEP || t === TER.ICE;
const isRock = (t) => t === TER.ROCK;

/** Flat colour of one tile (the tile-colour texture and minimap). */
export function tileColour(s, pal, i) {
  const L = s.L, t = L.terrain[i];
  if (L.floor[i] && FLOOR[L.floor[i]]) return FLOOR[L.floor[i]];
  switch (t) {
    case TER.GRASS: return pal.grass[0];
    case TER.MEADOW: return pal.meadow;
    case TER.DIRT: return pal.dirt;
    case TER.SAND: return pal.sand;
    case TER.RICH: return PLAIN.rich;
    case TER.MARSH: return PLAIN.marsh;
    case TER.SHALLOW: return pal.water;
    case TER.DEEP: return pal.waterDeep;
    case TER.ROCK: return L.roof[i] === ROOF.OPEN ? pal.crag : getBit(L.known, i) ? STONE[L.mat[i] & 15] : UNKNOWN_ROCK;
    case TER.ROUGH: return shade(STONE[L.mat[i] & 15], -0.12);
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
  const soft = [[TER.MEADOW, pal.meadow, 0.72], [TER.DIRT, pal.dirt, 0.6], [TER.SAND, pal.sand, 0.74],
    [TER.RICH, PLAIN.rich, 0.66], [TER.MARSH, PLAIN.marsh, 0.7], [TER.TILLED, PLAIN.tilled, 0.64], [TER.MOSS, PLAIN.moss, 0.7]];
  for (const [type, color, r] of soft) {
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === type) blob(x, y, T * r, color, 1, 5);
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
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * W + x, t = L.terrain[i], bx = x * T, by = y * T;
    if (t === TER.ROUGH || t === TER.RUBBLE) {
      const base = STONE[L.mat[i] & 15];
      g.fillStyle = shade(base, -0.12); g.fillRect(bx, by, T, T);
      if (detail) for (let k = 0; k < 5; k++) {
        g.fillStyle = k & 1 ? shade(base, -0.3) : shade(base, 0.08);
        g.fillRect(bx + 2 + hash2(x, y, 110 + k) * (T - 5), by + 2 + hash2(x, y, 120 + k) * (T - 5), 2, 1.5);
      }
      if (t === TER.RUBBLE) for (let k = 0; k < 6; k++) {
        const px = bx + 4 + hash2(x, y, 130 + k) * (T - 8), py = by + 4 + hash2(x, y, 140 + k) * (T - 8);
        g.fillStyle = k % 3 ? '#77706a' : '#5a4a3a';
        g.beginPath(); g.moveTo(px - 3, py + 2); g.lineTo(px - 1, py - 3); g.lineTo(px + 3, py - 2); g.lineTo(px + 2, py + 3); g.closePath(); g.fill();
      }
    } else if (t === TER.ICE) {
      g.fillStyle = PLAIN.ice; g.fillRect(bx, by, T, T);
      if (detail) { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx + 5, by + 9 + hash2(x, y, 5) * 10); g.lineTo(bx + 24, by + 6 + hash2(x, y, 6) * 16); g.stroke(); }
    } else if (t === TER.LAVA) {
      g.fillStyle = PLAIN.lava; g.fillRect(bx, by, T, T);
    } else if (t === TER.VOID) {
      g.fillStyle = PLAIN.void; g.fillRect(bx, by, T, T);
    }
    // Rock casts a soft shadow onto the open tile south of it (drawn inside this tile).
    if (!isRock(t) && y > 0 && isRock(L.terrain[i - W]) && L.roof[i - W] !== ROOF.OPEN) {
      g.fillStyle = 'rgba(15,12,18,0.32)'; g.fillRect(bx, by, T, 5);
    }
    if (L.floor[i] && FLOOR[L.floor[i]]) paintFloor(g, L.floor[i], x, y, detail);
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

function paintFloor(g, id, x, y, detail) {
  const bx = x * T, by = y * T, c = FLOOR[id];
  g.fillStyle = c; g.fillRect(bx, by, T, T);
  if (!detail) return;
  g.strokeStyle = shade(c, -0.28); g.lineWidth = 1;
  g.beginPath();
  if (id === 2) { for (let k = 1; k < 4; k++) { g.moveTo(bx, by + k * 8); g.lineTo(bx + T, by + k * 8); } const o = (x + y) % 2 ? 10 : 22; g.moveTo(bx + o, by); g.lineTo(bx + o, by + T); }
  else if (id === 3 || id === 4) { g.moveTo(bx, by + T / 2); g.lineTo(bx + T, by + T / 2); const o = (y % 2) * T / 2; g.moveTo(bx + T / 2 - o / 2, by); g.lineTo(bx + T / 2 - o / 2, by + T / 2); g.moveTo(bx + o / 2 + 4, by + T / 2); g.lineTo(bx + o / 2 + 4, by + T); }
  g.strokeRect(bx + 0.5, by + 0.5, T - 1, T - 1);
  g.stroke();
}

/**
 * Natural rock with 4-neighbour autotiled faces (16 masks per stone): a darker body, a lit top
 * edge where the north side is open, a tall wall face where the south side is open (the view is
 * from the south), side shading on east and west. Unknown rock is a dark face with no material.
 * Known ore shows glints. Everything stays inside the tile so a 3 x 3 patch repaints exactly.
 */
function paintRock(g, s, i, x, y, detail) {
  const L = s.L, bx = x * T, by = y * T;
  const open = (j, ok) => ok && !isRock(L.terrain[j]);
  const n = open(i - W, y > 0), e = open(i + 1, x < W - 1), so = open(i + W, y < H - 1), w = open(i - 1, x > 0);
  const known = getBit(L.known, i) === 1;
  const base = known ? STONE[L.mat[i] & 15] : UNKNOWN_ROCK;
  g.fillStyle = shade(base, -0.18); g.fillRect(bx, by, T, T);
  if (detail) {
    for (let k = 0; k < 4; k++) {
      const px = bx + 3 + hash2(x, y, 150 + k) * (T - 8), py = by + 3 + hash2(x, y, 160 + k) * (T - 10);
      g.fillStyle = k & 1 ? shade(base, -0.34) : shade(base, 0.02);
      g.fillRect(px, py, 4 + hash2(x, y, 170 + k) * 4, 2);
    }
  }
  if (so) { // wall face toward the viewer
    const fh = 11;
    g.fillStyle = shade(base, -0.42); g.fillRect(bx, by + T - fh, T, fh);
    g.fillStyle = shade(base, -0.05); g.fillRect(bx, by + T - fh - 2, T, 2);
    if (detail) { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 3; k++) g.fillRect(bx + 4 + k * 10 + hash2(x, y, 180 + k) * 4, by + T - fh + 2, 1.2, fh - 3); }
  }
  if (n) { g.fillStyle = shade(base, 0.22); g.fillRect(bx, by, T, 2.5); }
  if (w) { g.fillStyle = shade(base, 0.08); g.fillRect(bx, by, 2.5, T); }
  if (e) { g.fillStyle = shade(base, -0.4); g.fillRect(bx + T - 2.5, by, 2.5, T); }
  if (known && L.ore[i] && ORE[L.ore[i]]) {
    const c = ORE[L.ore[i]];
    for (let k = 0; k < 3; k++) {
      const px = bx + 6 + hash2(x, y, 190 + k) * (T - 12), py = by + 5 + hash2(x, y, 200 + k) * (T - 16), r = 2.4 - k * 0.4;
      g.fillStyle = c; g.beginPath(); g.moveTo(px, py - r); g.lineTo(px + r, py); g.lineTo(px, py + r); g.lineTo(px - r, py); g.closePath(); g.fill();
      if (detail) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(px - 0.6, py - r * 0.6, 1.2, 1.2); }
    }
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
    this.st = { bakes: 0, bakeMs: 0, bakeMax: 0, evictions: 0, patches: 0, placeholderRects: 0, blankRects: 0, failed: 0, released: 0 };
  }

  setState(s, pal) {
    for (let b = 0; b < this.held.length; b++) this.releaseBand(b, Infinity);
    this.s = s; this.pal = pal;
    this.band = -1; this.prevBand = -1;
    this.patchQ.length = 0; this.patchSet.clear();
    this.buildPlaceholder();
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
  }
  patchPlaceholder(x0, y0, x1, y1) {
    const d = this.phImg.data;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, rgb = hexRGB(tileColour(this.s, this.pal, i));
      d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
    }
    this.phg.putImageData(this.phImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
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

  /** Queue a 3 x 3 patch redraw around tile (tx, ty) (C9 markDirty). */
  markDirty(tx, ty) {
    const i = ty * W + tx;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H || this.patchSet.has(i)) return;
    this.patchSet.add(i); this.patchQ.push(i);
  }
  runPatches(max) {
    let done = 0;
    while (this.patchQ.length && done < max) {
      const i = this.patchQ.shift(); this.patchSet.delete(i);
      const tx = i % W, ty = (i / W) | 0;
      const x0 = Math.max(0, tx - 1), y0 = Math.max(0, ty - 1), x1 = Math.min(W - 1, tx + 1), y1 = Math.min(H - 1, ty + 1);
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
    // Only the active band and the neighbour it came from keep canvases; others free over frames.
    for (let b = 0; b < this.bands.length; b++) {
      if (b === this.band || (b === this.prevBand && Math.abs(b - this.band) === 1)) continue;
      if (this.held[b].size) this.releaseBand(b, cfg.releasePerFrame);
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
    const sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.ph, x0, y0, tw, th, x0 * T, y0 * T, tw * T, th * T);
    g.imageSmoothingEnabled = sm;
    this.st.placeholderRects++;
  }
}
