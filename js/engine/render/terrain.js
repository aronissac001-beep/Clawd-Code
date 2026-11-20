// Terrain layer (owner C; doc 12.4): chunk bakes in three bands with an LRU each, the tile-colour
// texture (minimap and never-blank placeholder), 3 x 3 patch redraws queued by markDirty, and the
// tile painter (adapted from the roguelite render.js paintTerrain, plus rock with 4-neighbour
// autotiled faces, mined floor, ore glints, constructed floors, tilled soil and blight tint).
//
// Stone, ore and floor looks follow the data (materials tints, worldgen STONES / DEPOSITS ids, the
// floor def order); D's kit paints rock, mined floor and floors through registerTileArt. markDirty
// skips tiles whose baked inputs did not change (a fog reveal only touches the light texture).
// Render only: it reads s.L (and never writes state). Canvases are created lazily, never at import.
//
// Levels (Stage Z1 E6; EMBERCROWN-FORTRESS.md 4.2, 6.3, 6.4). On a map with D > 1 the layer draws ONE view
// level (setLevel). Everything below is dark on a D = 1 map, which paints exactly as before.
//   - chunk keys are (z, band, cx, cy) in the one LRU per band; the LRU cap is 3 x the visible chunks of
//     the viewport (z and the pre-baked z +- 1), capped at near 48, mid 36 and far 64 (6.4)
//   - the below bake: AIR and RAMP_TOP paint the level below dimmed 55% (art/vertical.js paintDim), with a
//     2 px lip where open air meets standing ground; stairs and ramps carry chevrons; floors with no ceiling
//     on underground levels carry a faint hatch; unknown rock paints the band's void tint
//   - a write at voxel i patches the held chunks of z and of z + 1 (and z - 1 for its hatch)
//   - per-level placeholders (W x H tile colours, LRU of 6): the never-blank fill and the minimap of that level
//   - uniform chunks (all unknown rock, or all air over unknown rock) hold no canvas: a pattern fill
//   - idle pre-bake of z - 1 then z + 1: visible chunks only, 1 per still frame, while `prebake` is set
//     (the renderer clears it under Battery saver, paused and still, and after 3 s of stillness)
//   - scrubbing: chunk bakes of a level start only after it has stayed 150 ms, so a fast scrub bakes nothing
//     (only placeholders and held chunks draw; the pre-bake makes a one-step switch complete anyway)
// The plane code reads level views (levelview.js): the level's slice of every layer, so index y * W + x.

import { TILE, W, H, D, PLANE, zS, TER, ROOF, getBit } from '../../game/core/grid.js';
import { def, all, hasFlag } from '../../game/core/content.js';
import { STONES, DEPOSITS } from '../../data/worldgen.js';
import { PAL, RAMP, STONE_RAMP } from '../art/palette.js';
import { seasonTile, seasonGround } from './weather.js';
import { bandOfLevel, voidColour, voidPattern, paintVoid, paintDim, paintLip, paintHatch, paintStair, paintRamp, dimmed } from '../art/vertical.js';

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
// The season the chunks paint (0 Thaw .. 3 Deepcold; Stage 2 season palettes): TerrainLayer.setSeason
// sets it before any bake or patch, so a patch always matches the bake around it.
let SEASON = 0;
const SEASON_FLAT = [null, null, PAL.umber3, PAL.mist];
const isWater = (t) => t === TER.SHALLOW || t === TER.DEEP;

/** Flat colour of one tile (the tile-colour texture and minimap). */
export function tileColour(s, pal, i) {
  if (LV && s.__lvl !== undefined) return tileColour3(s, pal, i);
  const L = s.L, t = L.terrain[i];
  tileTables();
  const f = L.floor[i] && TAB.floor[L.floor[i]];
  if (f) return f.c;
  if (t === TER.ROCK) return L.roof[i] === ROOF.OPEN || getBit(L.known, i) ? TAB.stone[L.mat[i]] || STONE_FALLBACK : UNKNOWN_ROCK;
  if (t === TER.ROUGH) return TAB.floorOf[L.mat[i]] || PAL.stone0;
  // the season shows on the tile-colour texture too (minimap, placeholder): snow, autumn grass
  if (SEASON >= 2 && L.roof[i] === ROOF.OPEN && seasonGround(t) && (SEASON === 3 || t === TER.GRASS || t === TER.MEADOW)) return SEASON_FLAT[SEASON];
  return PLAIN[t] || PAL.night;
}

// ---- Levels (D > 1) ----
// LV: the level context of the paint in progress (set by the layer before every bake, patch and placeholder
// build): { below: view of z - 1 | null, above: view of z + 1 | null, under: z < zS, band, bandBelow }.
let LV = null;
const isOpenAir = (t) => t === TER.AIR || t === TER.VOID;
const isVert = (t) => t >= TER.STAIR_U && t <= TER.RAMP_TOP;
const rockKnown = (L, i) => getBit(L.known, i) === 1 || L.roof[i] === ROOF.OPEN;
function levelCtx(views, z) {
  const rel = z - zS;
  const band = bandOfLevel(rel), bandBelow = bandOfLevel(rel - 1);
  const belowCtx = { z: z - 1, below: null, above: null, under: false, band: bandBelow, bandBelow, belowCtx: null };
  return { z, below: z > 0 ? views.get(z - 1) : null, above: z < D - 1 ? views.get(z + 1) : null, under: z < zS, band, bandBelow, belowCtx };
}
function tileColour3(s, pal, i) {
  const L = s.L, t = L.terrain[i];
  if (isOpenAir(t) || t === TER.RAMP_TOP) {
    const b = LV.below;
    if (!b) return voidColour(LV.band, true);
    const bt = b.L.terrain[i];
    if (isOpenAir(bt) || (bt === TER.ROCK && !rockKnown(b.L, i))) return voidColour(LV.bandBelow, true);
    const lv = LV; LV = null;
    const c = tileColour(b, pal, i);
    LV = lv;
    return dimmed(c);
  }
  if (t === TER.ROCK && !rockKnown(L, i)) return voidColour(LV.band, false);
  if (isVert(t)) { tileTables(); return TAB.floorOf[L.mat[i]] || PAL.stone0; }
  const lv = LV; LV = null;
  const c = tileColour(s, pal, i);
  LV = lv;
  return c;
}
/** A chunk with nothing to bake: 1 all unknown rock, 2 all open air over unknown rock (or the world floor), else 0. */
function uniformKind(s, x0, y0, w, h) {
  const L = s.L, b = LV.below;
  let kind = -1;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = y * W + x, t = L.terrain[i];
    let k;
    if (t === TER.ROCK && !L.floor[i] && !rockKnown(L, i)) k = 1;
    else if (isOpenAir(t) && (!b || (b.L.terrain[i] === TER.ROCK && !rockKnown(b.L, i)))) k = 2;
    else return 0;
    if (kind < 0) kind = k; else if (k !== kind) return 0;
  }
  return kind < 0 ? 0 : kind;
}
/** Paint one tile of a level (D > 1): the below bake, chevrons, lips, hatch and void tint, else the plane painter. */
function paintTile3(g, s, pal, x, y, detail) {
  const L = s.L, i = y * W + x, t = L.terrain[i], lv = LV;
  if (isOpenAir(t) || t === TER.RAMP_TOP) {
    const b = lv.below;
    if (b && !isOpenAir(b.L.terrain[i])) {
      if (b.L.terrain[i] === TER.ROCK && !rockKnown(b.L, i)) paintVoid(g, x, y, lv.bandBelow, false);
      else { LV = lv.belowCtx; paintTile3(g, b, pal, x, y, detail); LV = lv; }
      paintDim(g, x, y);
    } else paintVoid(g, x, y, b ? lv.bandBelow : lv.band, true);
    if (t === TER.RAMP_TOP) { paintRamp(g, x, y, true); return; }
    const so = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && !isOpenAir(L.terrain[yy * W + xx]) && L.terrain[yy * W + xx] !== TER.RAMP_TOP;
    paintLip(g, x, y, (so(x, y - 1) ? 1 : 0) | (so(x + 1, y) ? 2 : 0) | (so(x, y + 1) ? 4 : 0) | (so(x - 1, y) ? 8 : 0));
    return;
  }
  if (t === TER.ROCK && !L.floor[i] && !rockKnown(L, i)) { paintVoid(g, x, y, lv.band, false); return; }
  LV = null;
  if (isVert(t)) {
    const rough = TILE_ART.get('rough');
    ART_INFO.mat = L.mat[i]; ART_INFO.rubble = false; ART_INFO.detail = detail;
    if (!rough || !rough(g, x, y, ART_INFO)) { tileTables(); g.fillStyle = TAB.floorOf[L.mat[i]] || PAL.stone0; g.fillRect(x * T, y * T, T, T); }
    if (t === TER.RAMP) paintRamp(g, x, y, false); else paintStair(g, x, y, t);
  } else paintTerrain(g, s, pal, x, y, 1, 1, detail);
  LV = lv;
  // no ceiling on an underground level: a shaft or the sky above this floor
  if (lv.under && t !== TER.ROCK && lv.above) { const a = lv.above.L.terrain[i]; if (isOpenAir(a) || a === TER.RAMP_TOP) paintHatch(g, x, y); }
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
  if (LV) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) paintTile3(g, s, pal, x, y, detail); return; }
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
    // season palettes (Stage 2): Highsun dries the green, Ashfall drops leaves, Deepcold snows on open ground
    if (SEASON && !fl && L.roof[i] === ROOF.OPEN) { const sc = seasonTile(SEASON, (x * 7 + y * 13) & 3, t); if (sc) g.drawImage(sc, bx, by, T, T); }
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
    this.held = this.bands.map(() => new Map());   // key -> { c, g, cx, cy, z } in LRU order (oldest first)
    this.uni = this.bands.map(() => new Map());    // D > 1: key -> uniform kind (1 rock, 2 air over rock); no canvas
    this.band = -1; this.prevBand = -1;
    this.s = null; this.pal = null;
    this.ph = null; this.phg = null; this.phImg = null; // tile-colour texture of the view level (minimap, placeholder)
    this.patchQ = []; this.patchSet = new Set();
    this.need = [];
    this.sig = null;           // bake signature per tile at its last paint (skip patches that change nothing baked)
    this.phVer = 0;            // bumped when the tile-colour texture changes (minimap)
    this.season = 0;           // the season held chunks were painted for; stale chunks rebake in place
    // levels (D > 1): the view level, the level views, per-level { sig, ph, phg, phImg } (LRU of 6 placeholders)
    this.d3 = false; this.z = 0; this.views = null; this.lvls = new Map();
    this.prebake = false;      // set per frame by the renderer (idle, no Battery saver, not paused and still)
    this.changeT = -1e9; this.prevChangeT = -1e9; this.now = 0;
    this.heldCeiling = 72 * 1048576;
    this.st = { bakes: 0, bakeMs: 0, bakeMax: 0, evictions: 0, patches: 0, patchSkips: 0, patchMs: 0, placeholderRects: 0, blankRects: 0, failed: 0, released: 0,
      phBuilds: 0, phMs: 0, prebakes: 0, uniformRects: 0, scrubFrames: 0, levelSwitches: 0, missing: 0 };
  }

  /**
   * The season to paint (0-3). A change keeps every held chunk on screen and rebakes them in place,
   * one per frame, nearest first (never a placeholder flash); the tile-colour texture follows at once.
   */
  setSeason(se) {
    se = se | 0;
    if (se === this.season) return false;
    this.season = se; SEASON = se;
    if (this.s && this.ph) {
      if (this.d3) { for (const [z, l] of this.lvls) if (l.ph) this.buildPlaceholder(z); }
      else this.buildPlaceholder();
    }
    return true;
  }
  /** views: the renderer's LevelViews (D > 1). z: the view level (D > 1; default the surface). */
  setState(s, pal, season = 0, views = null, z = zS) {
    for (let b = 0; b < this.held.length; b++) { this.releaseBand(b, Infinity); this.uni[b].clear(); }
    this.s = s; this.pal = pal;
    this.season = season | 0; SEASON = this.season;
    this.band = -1; this.prevBand = -1;
    this.patchQ.length = 0; this.patchSet.clear();
    resetTileTables();
    for (const l of this.lvls.values()) if (l.ph) l.ph.width = l.ph.height = 0;
    this.lvls.clear();
    this.d3 = D > 1 && !!views;
    this.views = this.d3 ? views : null;
    LV = null;
    if (this.d3) { this.z = Math.max(0, Math.min(D - 1, z | 0)); this.useLevel(this.z, true); return; }
    this.z = 0;
    if (!this.sig || this.sig.length !== W * H) this.sig = new Uint32Array(W * H);
    for (let i = 0; i < W * H; i++) this.sig[i] = this.sigOf(i);
    this.buildPlaceholder();
  }
  /** Everything a chunk bake reads for tile i, packed (terrain, stone, ore, floor, open sky, known, blight band). */
  sigOf(i, s = this.s) {
    const L = s.L;
    return (L.terrain[i] | (L.mat[i] << 4) | (L.ore[i] << 8) | (L.floor[i] << 14) | ((L.roof[i] === ROOF.OPEN ? 1 : 0) << 22)
      | (getBit(L.known, i) << 23) | ((L.blight[i] >> 6) << 24)) >>> 0;
  }

  // ---- Levels (D > 1) ----
  /** The per-level record of z (its signature and placeholder), created on first use. */
  level(z) {
    let l = this.lvls.get(z);
    if (!l) {
      const v = this.views.get(z), sig = new Uint32Array(PLANE);
      for (let p = 0; p < PLANE; p++) sig[p] = this.sigOf(p, v);
      l = { z, sig, ph: null, phg: null, phImg: null, ver: 0 };
      this.lvls.set(z, l);
    }
    return l;
  }
  /** Point the plane fields (sig, ph, phImg: the minimap) at level z, building its placeholder if needed. */
  useLevel(z, build) {
    const l = this.level(z);
    if (!l.ph && build) this.buildPlaceholder(z);
    this.sig = l.sig; this.ph = l.ph; this.phg = l.phg; this.phImg = l.phImg;
    this.phVer++;
    return l;
  }
  /** Change the view level (D > 1). now: performance.now() (the 150 ms scrub dwell). */
  setLevel(z, now = performance.now()) {
    if (!this.d3) return false;
    z = Math.max(0, Math.min(D - 1, z | 0));
    if (z === this.z) return false;
    this.prevChangeT = this.changeT; this.changeT = now;
    this.z = z; this.st.levelSwitches++;
    const l = this.lvls.get(z);
    if (l) { this.lvls.delete(z); this.lvls.set(z, l); }  // LRU touch
    // the placeholder builds on the next draw (at most one per frame)
    this.sig = this.level(z).sig; this.ph = l ? l.ph : null; this.phg = l ? l.phg : null; this.phImg = l ? l.phImg : null;
    this.phVer++;
    return true;
  }
  /** Scrubbing (4.1, 6.3): the level has not yet stayed 150 ms since its last change, so only placeholders and held chunks draw. */
  scrubbing(now = this.now) { return this.d3 && now - this.changeT < 150; }
  /** Placeholders held (LRU of 6 levels; the rest keep only their signature). */
  trimPlaceholders() {
    let n = 0;
    for (const l of this.lvls.values()) if (l.ph) n++;
    for (const l of this.lvls.values()) {   // Map order = least recently used first
      if (n <= 6) break;
      if (Math.abs(l.z - this.z) <= 1 || !l.ph) continue;
      l.ph.width = l.ph.height = 0; l.ph = l.phg = l.phImg = null; n--;
    }
  }

  // ---- Tile-colour texture (W x H, 1 px per tile) ----
  buildPlaceholder(z = this.z) {
    const t0 = performance.now();
    let s = this.s, tgt = this;
    if (this.d3) { tgt = this.level(z); this.lvls.delete(z); this.lvls.set(z, tgt); s = this.views.get(z); LV = levelCtx(this.views, z); }
    if (!tgt.ph) { tgt.ph = document.createElement('canvas'); tgt.phg = tgt.ph.getContext('2d'); }
    if (tgt.ph.width !== W || tgt.ph.height !== H) { tgt.ph.width = W; tgt.ph.height = H; tgt.phImg = null; }
    if (!tgt.phImg) tgt.phImg = tgt.phg.createImageData(W, H);
    const d = tgt.phImg.data, memo = new Map();
    for (let i = 0; i < W * H; i++) {
      const c = tileColour(s, this.pal, i);
      let rgb = memo.get(c); if (!rgb) memo.set(c, (rgb = hexRGB(c)));
      d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
    }
    tgt.phg.putImageData(tgt.phImg, 0, 0);
    LV = null;
    if (this.d3) {
      this.st.phBuilds++; this.st.phMs += performance.now() - t0;
      if (z === this.z) { this.ph = tgt.ph; this.phg = tgt.phg; this.phImg = tgt.phImg; }
      this.trimPlaceholders();
    }
    this.phVer++;
  }
  patchPlaceholder(x0, y0, x1, y1, z = this.z) {
    let s = this.s, tgt = this;
    if (this.d3) { tgt = this.lvls.get(z); if (!tgt || !tgt.ph) return; s = this.views.get(z); LV = levelCtx(this.views, z); }
    const d = tgt.phImg.data;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, rgb = hexRGB(tileColour(s, this.pal, i));
      d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255;
    }
    tgt.phg.putImageData(tgt.phImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    LV = null;
    if (z === this.z) this.phVer++;
  }
  /** The minimap canvas of the view level (W x H px). */
  get minimap() { return this.ph; }

  // ---- Bands, LRU and release ----
  heldCount(b) { return this.held[b].size; }
  heldBytes() {
    let n = 0;
    for (let b = 0; b < this.bands.length; b++) { const px = this.bands[b].chunk * T * this.bands[b].tscale; n += this.held[b].size * px * px * 4; }
    return n;
  }
  /** Canvases held of the levels (D > 1): { z: count } over every band. */
  heldByLevel() {
    const out = {};
    for (const m of this.held) for (const e of m.values()) out[e.z | 0] = (out[e.z | 0] || 0) + 1;
    return out;
  }
  /** The LRU cap of band b: the configured one on a D = 1 map; 3 x the visible chunks (z and z +- 1) on D > 1 (6.4). */
  capOf(b) {
    if (!this.d3) return this.bands[b].lru;
    const abs = LEVEL_CAP[b] !== undefined ? LEVEL_CAP[b] : this.bands[b].lru;
    return Math.min(abs, Math.max(12, 3 * (this.visible || 4)));
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
    if (max === Infinity || !m.size) this.uni[b].clear();
    return n;
  }
  evict(b) {
    const m = this.held[b], cap = this.capOf(b);
    while (m.size > cap) {
      const [k, e] = m.entries().next().value;
      e.c.width = e.c.height = 0;
      m.delete(k); this.st.evictions++;
    }
  }

  bake(b, cx, cy, z = this.z) {
    const B = this.bands[b], n = B.chunk, px = n * T * B.tscale;
    const t0 = performance.now();
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    if (!g || c.width !== px) { this.st.failed++; c.width = c.height = 0; return null; } // over the canvas-memory cap
    g.imageSmoothingEnabled = false;
    g.setTransform(B.tscale, 0, 0, B.tscale, -cx * n * T * B.tscale, -cy * n * T * B.tscale);
    const x0 = cx * n, y0 = cy * n;
    const s = this.d3 ? this.views.get(z) : this.s;
    if (this.d3) LV = levelCtx(this.views, z);
    paintTerrain(g, s, this.pal, x0, y0, Math.min(n, W - x0), Math.min(n, H - y0), true);
    LV = null;
    const ms = performance.now() - t0;
    this.st.bakes++; this.st.bakeMs += ms; if (ms > this.st.bakeMax) this.st.bakeMax = ms;
    if (this.onBake) this.onBake(ms, b);
    return { c, g, cx, cy, z, season: this.season };
  }

  /** Drop every held chunk (new tile art): they rebake one per frame, the placeholder covering them. */
  rebakeAll() { for (let b = 0; b < this.held.length; b++) { this.releaseBand(b, Infinity); this.uni[b].clear(); } resetTileTables(); }

  /**
   * Queue a 3 x 3 patch redraw around tile (tx, ty) (C9 markDirty). A tile whose baked inputs did
   * not change (a fog-only reveal, a growth tick) is skipped: the light texture carries fog.
   * force = true always patches (debug, art swaps). On a D > 1 map (tx, ty) is on the view level.
   */
  markDirty(tx, ty, force = false) {
    if (this.d3) { if (tx >= 0 && ty >= 0 && tx < W && ty < H) this.markVoxel(this.z * PLANE + ty * W + tx, force); return; }
    const i = ty * W + tx;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H || this.patchSet.has(i)) return;
    if (!force && this.sig && this.s && this.sig[i] === this.sigOf(i)) { this.st.patchSkips++; return; }
    this.patchSet.add(i); this.patchQ.push(i);
  }
  /**
   * D > 1: queue voxel i (the terrain API's render sink). Its own level patches when its baked inputs
   * changed (checked when the patches run); the levels above (open air shows it) and below (its ceiling
   * hatch) patch with it. Levels the layer has never drawn are skipped.
   */
  markVoxel(i, force = false) {
    if (!this.d3) { this.markDirty(i % W, (i / W) | 0, force); return; }
    const z = (i / PLANE) | 0;
    for (let k = -1; k <= 1; k++) {
      const zz = z + k;
      if (zz < 0 || zz >= D || !this.lvls.has(zz)) continue;
      const j = i + k * PLANE, key = k === 0 && !force ? j : -1 - j;   // negative: forced
      if (this.patchSet.has(j) || this.patchSet.has(-1 - j)) continue;
      this.patchSet.add(key); this.patchQ.push(key);
    }
  }
  runPatches(max) {
    let done = 0;
    const t0 = this.patchQ.length ? performance.now() : 0;
    while (this.patchQ.length && done < max) {
      const q = this.patchQ.shift(); this.patchSet.delete(q);
      const forced = q < 0, i = forced ? -1 - q : q;
      const z = this.d3 ? (i / PLANE) | 0 : 0, p = i - z * PLANE;
      const tx = p % W, ty = (p / W) | 0;
      let sig = this.sig, s = this.s;
      if (this.d3) {
        const l = this.lvls.get(z);
        if (!l) continue;
        sig = l.sig; s = this.views.get(z);
        if (!forced && sig[p] === this.sigOf(p, s)) { this.st.patchSkips++; continue; }
      }
      const x0 = Math.max(0, tx - 1), y0 = Math.max(0, ty - 1), x1 = Math.min(W - 1, tx + 1), y1 = Math.min(H - 1, ty + 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sig[y * W + x] = this.sigOf(y * W + x, s);
      this.patchPlaceholder(x0, y0, x1, y1, z);
      if (this.d3) LV = levelCtx(this.views, z);
      for (let b = 0; b < this.bands.length; b++) {
        const B = this.bands[b], n = B.chunk, m = this.held[b], u = this.uni[b];
        if (!m.size && !u.size) continue;
        for (let cy = (y0 / n) | 0; cy <= ((y1 / n) | 0); cy++) for (let cx = (x0 / n) | 0; cx <= ((x1 / n) | 0); cx++) {
          const key = chunkKey(z, cx, cy);
          u.delete(key);
          const e = m.get(key);
          if (!e) continue;
          const g = e.g;
          g.save();
          g.setTransform(B.tscale, 0, 0, B.tscale, -cx * n * T * B.tscale, -cy * n * T * B.tscale);
          g.beginPath(); g.rect(x0 * T, y0 * T, (x1 - x0 + 1) * T, (y1 - y0 + 1) * T); g.clip();
          paintTerrain(g, s, this.pal, x0, y0, x1 - x0 + 1, y1 - y0 + 1, true);
          g.restore();
        }
      }
      LV = null;
      done++; this.st.patches++;
    }
    if (done) this.st.patchMs += performance.now() - t0;
    return done;
  }

  /** D > 1: the uniform kind of chunk (z, cx, cy) of band b (cached until a patch touches it). */
  uniformOf(b, z, cx, cy) {
    const u = this.uni[b], key = chunkKey(z, cx, cy);
    let k = u.get(key);
    if (k === undefined) {
      const n = this.bands[b].chunk, x0 = cx * n, y0 = cy * n;
      LV = levelCtx(this.views, z);
      k = uniformKind(this.views.get(z), x0, y0, Math.min(n, W - x0), Math.min(n, H - y0));
      LV = null;
      u.set(key, k);
    }
    return k;
  }

  /**
   * Draw the terrain under view (world units) at zoom z. Held chunks draw; missing ones draw the
   * tile-colour texture (never blank) and queue; at most cfg.bakesPerFrame bakes run, nearest first.
   */
  draw(g, view, z, camX, camY) {
    const cfg = this.cfg, d3 = this.d3, lz = this.z;
    SEASON = this.season;
    this.now = performance.now();
    const nb = bandFor(this.bands, z, this.band, cfg.hysteresis);
    if (nb !== this.band) { if (this.band >= 0) this.prevBand = this.band; this.band = nb; }
    // Only the active band and the neighbour it came from keep canvases. A band two steps away (a
    // jump from near to far) is freed at once, so at most two adjacent bands are ever held.
    for (let b = 0; b < this.bands.length; b++) {
      if (b === this.band || (b === this.prevBand && Math.abs(b - this.band) === 1)) continue;
      if (this.held[b].size) this.releaseBand(b, Math.abs(b - this.band) > 1 ? Infinity : cfg.releasePerFrame);
    }
    this.runPatches(cfg.patchesPerFrame);
    const scrub = d3 && this.scrubbing(this.now);
    if (scrub) this.st.scrubFrames++;
    // the view level's placeholder (at most one build per frame: this is the only one while scrubbing)
    let phBuilt = false;
    if (d3 && !this.ph) { this.buildPlaceholder(lz); phBuilt = true; }
    const B = this.bands[this.band], n = B.chunk, size = n * T, m = this.held[this.band];
    const ncx = Math.ceil(W / n), ncy = Math.ceil(H / n);
    const cx0 = Math.max(0, Math.floor(view.x0 / size)), cx1 = Math.min(ncx - 1, Math.floor(view.x1 / size));
    const cy0 = Math.max(0, Math.floor(view.y0 / size)), cy1 = Math.min(ncy - 1, Math.floor(view.y1 / size));
    const need = this.need; need.length = 0;
    let visible = 0, stale = -1;
    // Scaled with smoothing (the strategic view, a non-pixel-perfect zoom), chunk edges land on
    // fractional device pixels and can leave hairline seams: the tile-colour texture underneath fills
    // them with the right colour instead of the void.
    if (g.imageSmoothingEnabled && this.ph && this.ph.width) {
      const x0 = cx0 * n, y0 = cy0 * n, x1 = Math.min(W, (cx1 + 1) * n), y1 = Math.min(H, (cy1 + 1) * n);
      g.imageSmoothingEnabled = false;
      g.drawImage(this.ph, x0, y0, x1 - x0, y1 - y0, x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T);
      g.imageSmoothingEnabled = true;
    }
    const band = d3 ? bandOfLevel(lz - zS) : null;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = chunkKey(lz, cx, cy), e = m.get(key);
      visible++;
      const tw = Math.min(n, W - cx * n), th = Math.min(n, H - cy * n);
      if (e) {
        if (e.season !== this.season && stale < 0) stale = key;
        m.delete(key); m.set(key, e); // LRU touch
        g.drawImage(e.c, 0, 0, tw * T * B.tscale, th * T * B.tscale, cx * size, cy * size, tw * T, th * T);
      } else if (d3 && this.uniformOf(this.band, lz, cx, cy)) {
        const k = this.uniformOf(this.band, lz, cx, cy);
        g.fillStyle = voidPattern(g, k === 2 ? bandOfLevel(lz - 1 - zS) : band, k === 2);
        g.fillRect(cx * size, cy * size, tw * T, th * T);
        this.st.uniformRects++;
      } else {
        this.drawPlaceholder(g, cx * n, cy * n, tw, th, band);
        need.push(key);
      }
    }
    this.visible = visible;
    this.st.missing = need.length;
    let baked = 0;
    if (need.length && !scrub) {
      const ccx = camX / size - 0.5, ccy = camY / size - 0.5;
      need.sort((a, b2) => {
        const ax = keyX(a) - ccx, ay = keyY(a) - ccy, bx = keyX(b2) - ccx, by = keyY(b2) - ccy;
        return ax * ax + ay * ay - (bx * bx + by * by) || a - b2;
      });
      for (let k = 0; k < Math.min(cfg.bakesPerFrame, need.length); k++) {
        const key = need[k], cx = keyX(key), cy = keyY(key);
        const e = this.bake(this.band, cx, cy);
        if (!e) continue; // failed: the placeholder stays
        m.set(key, e); this.evict(this.band); baked++;
        const tw = Math.min(n, W - cx * n), th = Math.min(n, H - cy * n);
        g.drawImage(e.c, 0, 0, tw * T * B.tscale, th * T * B.tscale, cx * size, cy * size, tw * T, th * T);
        this.st.placeholderRects--;
        this.st.missing--;
      }
    }
    // a season change: one visible chunk a frame rebakes in place (no new chunk waited this frame)
    if (stale >= 0 && !need.length) {
      const cx = keyX(stale), cy = keyY(stale), old = m.get(stale), e = this.bake(this.band, cx, cy);
      if (e && old) {
        old.c.width = old.c.height = 0; m.set(stale, e); baked++;
        const tw = Math.min(n, W - cx * n), th = Math.min(n, H - cy * n);
        g.drawImage(e.c, 0, 0, tw * T * B.tscale, th * T * B.tscale, cx * size, cy * size, tw * T, th * T);
      }
    }
    // idle pre-bake of z - 1 then z + 1 (visible chunks only, one per still frame, never evicting)
    if (d3 && this.prebake && !scrub && !need.length && !baked) this.preBake(cx0, cy0, cx1, cy1, phBuilt);
    if (!this.calm && z >= 0.5) shimmer(g, d3 ? this.views.get(lz) : this.s, view, this.time || 0);
    return visible;
  }
  /** One step of the idle pre-bake: the placeholder of z - 1 / z + 1, then their first missing visible chunk. Returns true if it did work. */
  preBake(cx0, cy0, cx1, cy1, phBuilt) {
    const b = this.band, m = this.held[b], cap = this.capOf(b), B = this.bands[b], px = B.chunk * T * B.tscale;
    const over = this.heldBytes() + px * px * 4 > this.heldCeiling;
    // room in the LRU: full, the oldest chunk of a level that is not z or z +- 1 makes way (never one of those)
    const room = () => {
      if (m.size < cap) return true;
      for (const [k, e] of m) if (Math.abs((e.z | 0) - this.z) > 1) { e.c.width = e.c.height = 0; m.delete(k); this.st.evictions++; return true; }
      return false;
    };
    for (const zz of [this.z - 1, this.z + 1]) {
      if (zz < 0 || zz >= D) continue;
      if (over && zz > this.z) break;   // over the held-canvas ceiling: z - 1 only, then stop (6.4)
      const l = this.level(zz);
      if (!l.ph) { if (phBuilt) return false; this.buildPlaceholder(zz); return true; }
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const key = chunkKey(zz, cx, cy);
        if (m.has(key) || this.uniformOf(b, zz, cx, cy)) continue;
        if (over && this.heldBytes() + px * px * 4 > this.heldCeiling) return false;
        if (!room()) return false;
        const e = this.bake(b, cx, cy, zz);
        if (!e) return false;
        m.set(key, e); this.st.prebakes++;
        return true;
      }
    }
    this.prebakeDone = true;
    return false;
  }
  /** True when every visible chunk of level z is held or uniform (a switch to z completes in one frame). */
  readyAt(z, view) {
    if (!this.d3 || this.band < 0) return true;
    const b = this.band, n = this.bands[b].chunk, size = n * T, m = this.held[b];
    const ncx = Math.ceil(W / n), ncy = Math.ceil(H / n);
    const cx0 = Math.max(0, Math.floor(view.x0 / size)), cx1 = Math.min(ncx - 1, Math.floor(view.x1 / size));
    const cy0 = Math.max(0, Math.floor(view.y0 / size)), cy1 = Math.min(ncy - 1, Math.floor(view.y1 / size));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) if (!m.has(chunkKey(z, cx, cy)) && !this.uniformOf(b, z, cx, cy)) return false;
    return true;
  }
  drawPlaceholder(g, x0, y0, tw, th, band = null) {
    if (!this.ph || !this.ph.width) {
      // a level whose placeholder is not built yet (a second build this frame while scrubbing): its band tint
      if (band) { g.fillStyle = voidColour(band, false); g.fillRect(x0 * T, y0 * T, tw * T, th * T); this.st.placeholderRects++; return; }
      this.st.blankRects++; return;
    }
    const sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.ph, x0, y0, tw, th, x0 * T, y0 * T, tw * T, th * T);
    g.imageSmoothingEnabled = sm;
    this.st.placeholderRects++;
  }
}

// Chunk keys: (z, cy, cx) packed, z * 2^20 + cy * 2^10 + cx (a D = 1 map keeps cy * 1024 + cx).
const chunkKey = (z, cx, cy) => z * 1048576 + cy * 1024 + cx;
const keyX = (k) => k % 1024, keyY = (k) => ((k / 1024) | 0) % 1024;
/** Absolute LRU caps per band on a D > 1 map (6.4): near 48, mid 36, far 64. */
const LEVEL_CAP = [48, 36, 64];
