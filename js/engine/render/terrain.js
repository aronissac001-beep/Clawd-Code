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
import { PAL, RAMP, STONE_RAMP } from '../art/palette.js';

const T = TILE;

// ---- Tile tables (placeholder colours; D's kit paints every tile through registerTileArt and setGroundArt) ----
// Colours follow the data and the pixel palette (js/engine/art/palette.js): stones by the L.mat ids of
// worldgen STONES, ore by the L.ore ids of worldgen DEPOSITS, floor looks by the order of the 'floor'
// structure defs (the floor layer id is that order + 1, core/apply.js floorIdOf). Built lazily.
const STONE_FALLBACK = PAL.stone1;
const UNKNOWN_ROCK = PAL.night;
const FLOOR_LOOK = { f_planks: RAMP.wood[2], f_flag: PAL.stone1, f_smooth: PAL.mist, f_brick: PAL.ember1, f_carpet: PAL.plum1 };
const PLAIN = [];
for (const [t, c] of [[TER.VOID, PAL.night], [TER.GRASS, PAL.moss2], [TER.MEADOW, PAL.moss3], [TER.DIRT, PAL.umber2], [TER.SAND, PAL.sand], [TER.RICH, PAL.umber1],
  [TER.MARSH, PAL.moss1], [TER.SHALLOW, PAL.water], [TER.DEEP, PAL.deep], [TER.RUBBLE, PAL.stone0], [TER.MOSS, PAL.moss1], [TER.TILLED, PAL.umber1],
  [TER.ICE, PAL.mist], [TER.LAVA, PAL.ember1]]) PLAIN[t] = c;
let TAB = null;
/** The data-driven tile tables (stone body and floor colours, floor ids by layer id). Rebuilt after resetTileTables(). */
export function tileTables() {
  if (TAB) return TAB;
  const stone = STONES.map((n) => { const r = n && STONE_RAMP[n]; return r ? r.r[n === 'slate' || n === 'basalt' || n === 'duskstone' ? 2 : 1] : STONE_FALLBACK; });
  const floorOf = STONES.map((n) => { const r = n && STONE_RAMP[n]; return r ? r.r[n === 'slate' || n === 'basalt' || n === 'duskstone' ? 1 : 0] : PAL.stone0; });
  let floors = [];
  try { floors = all('structure').filter((d) => hasFlag(d, 'floor')); } catch (_) { floors = []; }
  const floor = [null, ...floors.map((d) => ({ id: d.id, c: FLOOR_LOOK[d.id] || PAL.stone1 }))];
  TAB = { stone, floorOf, floor, ore: DEPOSITS };
  return TAB;
}
export function resetTileTables() { TAB = null; }

// ---- Tile art hooks (C9): D's kit paints tiles inside their own square ---------------------------
//   registerTileArt('rock',  (g, x, y, t) => bool)   t: { mat, mask (1 N, 2 E, 4 S, 8 W open), known, ore, detail }
//   registerTileArt('floor', (g, x, y, t) => bool)   t: { id (floor def id), detail }
//   registerTileArt('rough', (g, x, y, t) => bool)   t: { mat, rubble, detail }
//   setGroundArt({ surface(g, s, x, y, detail), shadowN(g, x, y), blight(g, x, y, v), shimmer(g, x, y, frame) })
//                                                    the surface, the rock shadow, blight and the water shimmer
// Return true when painted; false falls back to the flat-colour placeholder. Everything stays inside
// the tile (x * 32 .. x * 32 + 32), so a clipped 3 x 3 patch repaints exactly.
const TILE_ART = new Map();
export function registerTileArt(kind, fn) { if (fn) TILE_ART.set(kind, fn); else TILE_ART.delete(kind); TAB = null; }
let GROUND = null;
/** The kit's surface painters (art/index.js GROUND_ART), or null for flat colours. */
export function setGroundArt(g) { GROUND = g || null; }
const ART_INFO = { mat: 0, mask: 0, known: false, ore: 0, detail: true, id: null, rubble: false };

const isRock = (t) => t === TER.ROCK;
const isWater = (t) => t === TER.SHALLOW || t === TER.DEEP;

/** Flat colour of one tile (the tile-colour texture and minimap). */
export function tileColour(s, pal, i) {
  const L = s.L, t = L.terrain[i];
  tileTables();
  const f = L.floor[i] && TAB.floor[L.floor[i]];
  if (f) return f.c;
  if (t === TER.ROCK) return L.roof[i] === ROOF.OPEN || getBit(L.known, i) ? TAB.stone[L.mat[i]] || STONE_FALLBACK : UNKNOWN_ROCK;
  if (t === TER.ROUGH) return TAB.floorOf[L.mat[i]] || PAL.stone0;
  return PLAIN[t] || PAL.night;
}

const hexRGB = (c) => {
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = c.match(/\d+/g); return [+m[0], +m[1], +m[2]];
};

/**
 * Paint the tiles of the rectangle [x0, x0 + w) x [y0, y0 + h) (tiles) into g (already scaled and
 * translated to world space; chunk bakes at 0.5 px per unit = the art's native 16 px per tile).
 * Each tile is self-contained (its fringes read the neighbours but draw inside the tile), so a
 * clipped repaint of a patch matches a full bake exactly. `detail` false skips fringes and variants.
 */
export function paintTerrain(g, s, pal, x0, y0, w, h, detail = true) {
  const L = s.L;
  tileTables();
  const rough = TILE_ART.get('rough'), floorArt = TILE_ART.get('floor'), rockArt = TILE_ART.get('rock');
  g.globalAlpha = 1;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * W + x, t = L.terrain[i], bx = x * T, by = y * T;
    let done = false;
    if (isRock(t)) {
      if (rockArt) {
        const n = y > 0 && !isRock(L.terrain[i - W]), e = x < W - 1 && !isRock(L.terrain[i + 1]), so = y < H - 1 && !isRock(L.terrain[i + W]), wv = x > 0 && !isRock(L.terrain[i - 1]);
        const known = getBit(L.known, i) === 1 || L.roof[i] === ROOF.OPEN;
        ART_INFO.mat = L.mat[i] || 3; ART_INFO.mask = (n ? 1 : 0) | (e ? 2 : 0) | (so ? 4 : 0) | (wv ? 8 : 0); ART_INFO.known = known;
        ART_INFO.ore = getBit(L.known, i) ? L.ore[i] : 0; ART_INFO.detail = detail;
        done = rockArt(g, x, y, ART_INFO);
      }
    } else if (t === TER.ROUGH || t === TER.RUBBLE) {
      ART_INFO.mat = L.mat[i]; ART_INFO.rubble = t === TER.RUBBLE; ART_INFO.detail = detail;
      done = !!rough && rough(g, x, y, ART_INFO);
    } else if (GROUND) { GROUND.surface(g, s, x, y, detail); done = true; }
    if (!done) { g.fillStyle = tileColour(s, pal, i); g.fillRect(bx, by, T, T); }
    const fl = L.floor[i] ? TAB.floor[L.floor[i]] : null;
    if (fl) { ART_INFO.id = fl.id; ART_INFO.detail = detail; if (!floorArt || !floorArt(g, x, y, ART_INFO)) { g.fillStyle = fl.c; g.fillRect(bx, by, T, T); } }
    // rock casts a short dithered shadow onto the open tile south of it (inside this tile)
    if (!isRock(t) && y > 0 && isRock(L.terrain[i - W]) && GROUND) GROUND.shadowN(g, x, y);
    if (L.blight[i] && GROUND) GROUND.blight(g, x, y, L.blight[i]);
  }
}

/** Water shimmer over the visible water tiles (drawn per frame, 2 frames; skipped in the strategic view). */
function shimmer(g, s, view, time) {
  if (!GROUND || !GROUND.shimmer) return;
  const L = s.L, frame = ((time * 1.6) | 0) & 1;
  const tx0 = Math.max(0, Math.floor(view.x0 / T)), tx1 = Math.min(W - 1, Math.floor(view.x1 / T));
  const ty0 = Math.max(0, Math.floor(view.y0 / T)), ty1 = Math.min(H - 1, Math.floor(view.y1 / T));
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const i = y * W + x;
    if (isWater(L.terrain[i]) && !L.floor[i] && getBit(L.fog, i)) GROUND.shimmer(g, x, y, frame);
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
    g.imageSmoothingEnabled = false;
    g.setTransform(B.tscale, 0, 0, B.tscale, -cx * n * T * B.tscale, -cy * n * T * B.tscale);
    const x0 = cx * n, y0 = cy * n;
    paintTerrain(g, this.s, this.pal, x0, y0, Math.min(n, W - x0), Math.min(n, H - y0), true);
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
          paintTerrain(g, this.s, this.pal, x0, y0, x1 - x0 + 1, y1 - y0 + 1, true);
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
    if (!this.calm && z >= 0.5) shimmer(g, this.s, view, this.time || 0);
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
