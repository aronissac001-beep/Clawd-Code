// Weather, fire, smoke and seasons in the renderer (owner C; doc 12.4, 14.8 row C; Stage 2).
// Render only: reads the saved world record (B's s.colony.world: weather, fire), the calendar
// (core/time.js seasonOf) and s.L; never writes state. Pixel style (docs/ART-STYLE.md): every piece
// is a baked native-size canvas in palette colours with Bayer dithering, drawn at whole art pixels.
//
//   seasonTile(season, v)    16 x 16 overlay painted into terrain chunks over open-sky natural ground
//                            (terrain.js paintTerrain): Highsun dry specks, Ashfall fallen leaves and
//                            an amber cast, Deepcold snow. Thaw is the base look (null).
//   seasonGround(t)          is terrain id t natural ground that takes the season overlay?
//   class WeatherLayer
//     update(s, view, time)  reads the weather kind and the burning tiles once a frame
//     drawFire(g, s, view, ctx)   flames, scorch and rising smoke over every burning tile in view
//                            (world transform, before the darkness so the light texture tints it;
//                            fires light themselves through the sim light map)
//     drawSky(g, s, view, ctx)    precipitation (rain streaks, snow flakes) over open-sky tiles and
//                            the cold snap and drought cast (after the darkness, before overlays)
//     fireFlames(out)        appends the tile index of each burning tile (the light layer's flicker list)
//     drawRumble(g, s, view, ctx)  cracks over tiles whose roof is about to fall (B's cave-in queue,
//                            s.colony.world.caveQ), shaking a pixel left and right (still with reduce motion)
//     markTile(i)            a roof or terrain change: the sky mask is rebuilt (at most once a second)
// Costs: one drawImage per burning tile plus 3 smoke puffs; precipitation draws a sparse hashed set
// of open-sky tiles (1 in 3 for rain, 1 in 4 for snow); the cast is one drawImage of a W x H mask.
// No per-frame allocation once warm.
import { TILE, W, H, TER, ROOF } from '../../game/core/grid.js';
import { seasonOf } from '../../game/core/time.js';
import { PAL, dith } from '../art/palette.js';
import { tileCanvas } from '../art/pixel.js';
import { weatherKind } from '../../game/world/weather.js';

const T = TILE;
const NAT = new Uint8Array(32);
for (const t of [TER.GRASS, TER.MEADOW, TER.DIRT, TER.RICH, TER.MARSH, TER.MOSS, TER.SAND, TER.TILLED]) if (t !== undefined) NAT[t] = 1;
/** Natural open ground that shows the season (not rock, water, floors or mined floor). */
export const seasonGround = (t) => NAT[t] === 1;

/** Tile hash (render only; stable per tile). */
const hash = (i) => { let h = (i * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; return (h ^ (h >>> 13)) >>> 0; };

// ---- Season overlays (baked into terrain chunks) -------------------------------------------------
/**
 * The season overlay of variant v (0-3) for a tile of terrain t, or null (Thaw, or terrain that
 * keeps its look). 16 x 16 native px, transparent where the ground shows through.
 */
export function seasonTile(season, v, t) {
  if (!season || !seasonGround(t)) return null;
  const sand = t === TER.SAND, soil = t === TER.DIRT || t === TER.RICH || t === TER.TILLED;
  if (season === 1 && (sand || soil)) return null; // Highsun dries only the green
  const key = `season:${season}:${v & 3}:${sand ? 's' : soil ? 'd' : 'g'}`;
  return tileCanvas(key, (p) => {
    // per-pixel noise from a hash (not the Bayer grid: a whole field of snow must not read as a checker)
    const nz = (x, y) => hash(x * 131 + y * 7 + v * 4099 + season * 65537) & 255;
    const r = (n) => (hash(n * 31 + v * 977 + season * 7919) & 255);
    if (season === 1) {
      // Highsun: sun-bleached tips and a few straw specks on the green (about 4% of the pixels)
      for (let k = 0; k < 10; k++) { const q = r(k); p.px(q & 15, (q >> 4) & 15, k % 3 ? PAL.moss3 : PAL.sand); }
      return;
    }
    if (season === 2) {
      // Ashfall: dry straw in the green and a few fallen leaves in ember and gold (about 9%)
      if (!sand && !soil) for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (nz(x, y) < 14) p.px(x, y, PAL.tan);
      const leaves = 2 + (v & 1) * 2;
      for (let k = 0; k < leaves; k++) { const q = r(k); p.px(q & 15, (q >> 4) & 15, k % 3 === 0 ? PAL.gold : k % 3 === 1 ? PAL.orange : PAL.ember1); }
      return;
    }
    // Deepcold: a snow cover (bone) with soft mist hollows, grass tips poking through, thinner on soil and sand
    const holes = sand ? 60 : soil ? 46 : 8;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const n = nz(x, y);
      if (n < holes) continue;                                   // the ground shows through
      p.px(x, y, n < holes + 28 ? PAL.mist : PAL.bone);
    }
    if (!sand && !soil) for (let k = 0; k < 5; k++) { const q = r(k); p.px(q & 15, (q >> 4) & 15, k & 1 ? PAL.moss2 : PAL.slate3); }
  });
}

// ---- Fire and smoke sprites ------------------------------------------------------------------------
/** Scorch under a burning tile: a dithered ember glow on the ground (16 x 16). */
const scorchTile = (v) => tileCanvas(`fire:scorch:${v & 1}`, (p) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 7.5, dy = y - 9, d = dx * dx + dy * dy * 1.6;
    if (d < 20 && dith(x + v, y, 12)) p.px(x, y, PAL.orange);
    else if (d < 42 && dith(x + v, y, 8)) p.px(x, y, PAL.ember1);
    else if (d < 70 && dith(x, y + v, 5)) p.px(x, y, PAL.ember0);
  }
});
/** A smoke puff, k 0 (dense, small) to 2 (thin, wide): slate dithered discs (8 x 8). */
const puffTile = (k) => tileCanvas(`fire:puff:${k}`, (p) => {
  const r = 2 + k, lv = [13, 9, 5][k];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const dx = x - 3.5, dy = y - 3.5;
    if (dx * dx + dy * dy > r * r + 0.5) continue;
    if (!dith(x, y, lv)) continue;
    p.px(x, y, dx + dy < -1 ? PAL.slate3 : k === 2 ? PAL.slate1 : PAL.slate2);
  }
}, 8, 8);
/** One rain streak (1 x 4 px) and one snow flake (2 x 2 px), drawn sparsely. */
const dropTile = () => tileCanvas('wx:drop', (p) => { p.vl(0, 0, 3, PAL.shallow); p.px(0, 3, PAL.mist); }, 1, 4);
const flakeTile = () => tileCanvas('wx:flake', (p) => { p.px(0, 0, PAL.bone); p.px(1, 1, PAL.bone); p.px(1, 0, PAL.mist); }, 2, 2);

/**
 * A precipitation sheet for a 4 x 4 tile block (64 x 64 px), stacked twice (64 x 128) so any 64 px
 * window of it is seamless: a fully open block draws its rain or snow with one drawImage.
 */
const sheetTile = (rain) => tileCanvas(rain ? 'wx:sheet:rain' : 'wx:sheet:snow', (p) => {
  const n = rain ? 22 : 18;
  for (let k = 0; k < n; k++) {
    const h = hash(k * 7919 + (rain ? 1 : 2)), x = h & 63, y = (h >> 8) & 63;
    for (const oy of [0, 64]) {
      if (rain) { p.vl(x, y + oy, 3, PAL.shallow); p.px(x, ((y + 3) & 63) + oy, PAL.mist); }
      else { p.px(x, y + oy, PAL.bone); p.px((x + 1) & 63, ((y + 1) & 63) + oy, PAL.bone); p.px((x + 1) & 63, y + oy, PAL.mist); }
    }
  }
}, 64, 128);
const BLK = 4;
/** Cracks in a rumbling roof: ink fissures with bone dust (16 x 16, 2 variants). */
const crackTile = (v) => tileCanvas(`cave:crack:${v & 1}`, (p) => {
  const lines = v & 1 ? [[2, 3, 7, 8], [7, 8, 6, 13], [7, 8, 13, 6], [13, 6, 14, 2]] : [[3, 2, 8, 7], [8, 7, 4, 12], [8, 7, 12, 10], [12, 10, 13, 14]];
  for (const [a, b, c, d] of lines) p.line(a, b, c, d, PAL.ink);
  for (const [x, y] of [[5, 4], [9, 9], [11, 11], [6, 10], [12, 4]]) p.px(x, y, PAL.bone);
});

/** Weather casts (doc 9.7): cold snap frost blue, drought heat gold; rain and snow darken by light (sim). */
const CAST = { coldsnap: [PAL.mist, 0.14], drought: [PAL.gold, 0.1], snow: [PAL.bone, 0.06], rain: [PAL.slate1, 0.1] };

export class WeatherLayer {
  constructor() {
    this.kind = 'clear';
    this.fire = null;           // the saved [[tile, heat, fuel]] list (sorted), read-only
    this.mask = null; this.maskG = null; this.maskImg = null; this.maskKind = ''; this.maskDirty = true; this.maskAt = -1e9;
    this.blk = null; this.blkDirty = true; this.blkAt = -1e9;   // open-sky tiles per 4 x 4 block (precipitation sheets)
    this.st = { fires: 0, drops: 0, puffs: 0 };
  }
  setState() { this.maskDirty = true; this.maskKind = ''; this.fire = null; this.blk = null; }
  markTile() { this.maskDirty = true; this.blkDirty = true; }
  /** Open-sky tile count of every 4 x 4 block (16 = the whole block is under the sky). */
  buildBlocks(s) {
    const bw = Math.ceil(W / BLK), bh = Math.ceil(H / BLK);
    if (!this.blk || this.blk.length !== bw * bh) this.blk = new Uint8Array(bw * bh);
    const B = this.blk, L = s.L;
    B.fill(0);
    for (let i = 0; i < W * H; i++) if (L.roof[i] === ROOF.OPEN && L.terrain[i] !== TER.ROCK) { const x = i % W, y = (i / W) | 0; B[((y / BLK) | 0) * bw + ((x / BLK) | 0)]++; }
    this.blkDirty = false;
  }

  /** The current weather kind and burning tiles (B's saved world record; none before Stage 2). */
  update(s, time) {
    const w = s && s.colony && s.colony.world;
    let k = 'clear';
    if (w && w.weather) { try { k = weatherKind(s); } catch (_) { k = w.weather.kind || 'clear'; } }
    this.kind = k;
    this.fire = w && w.fire && w.fire.length ? w.fire : null;
    this.time = time;
  }
  /** Tile indexes of burning tiles (for the flicker list). */
  fireFlames(out) { if (this.fire) for (const e of this.fire) out.push(e[0]); }

  /** Flames, scorch and smoke over burning tiles in view (world transform). */
  drawFire(g, s, view, ctx) {
    const F = this.fire;
    this.st.fires = 0; this.st.puffs = 0;
    if (!F) return;
    const K = ctx.kit, t = ctx.time || 0, calm = !!ctx.reduceMotion;
    const tx0 = Math.floor(view.x0 / T) - 1, tx1 = Math.floor(view.x1 / T) + 1, ty0 = Math.floor(view.y0 / T) - 1, ty1 = Math.floor(view.y1 / T) + 2;
    const sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    for (let k = 0; k < F.length; k++) {
      const i = F[k][0], x = i % W, y = (i / W) | 0;
      if (x < tx0 || x > tx1 || y < ty0 || y > ty1) continue;
      this.st.fires++;
      const heat = F[k][1] | 0, hv = hash(i);
      g.drawImage(scorchTile(hv), x * T, y * T, T, T);
      const cx = x * T + 16, by = y * T + 26;
      const r = heat >= 70 ? 12 : heat >= 35 ? 8 : 5;
      if (K && K.flame) {
        K.flame(g, cx - 4 + (hv & 7), by, r, t + (hv & 15) * 0.13, calm);
        if (heat >= 50) K.flame(g, cx + 6 - ((hv >> 3) & 7), by + 2, r - 3, t + 0.37, calm);
      } else {
        g.fillStyle = PAL.orange; g.fillRect(cx - 4, by - r * 2, 8, r * 2);
        g.fillStyle = PAL.flame; g.fillRect(cx - 2, by - r, 4, r);
      }
      if (ctx.lowDetail) continue;
      // smoke: three puffs on a 2.4 s cycle each, rising 40 world units and widening as they thin
      for (let q = 0; q < 3; q++) {
        const ph = calm ? (q / 3) : ((t / 2.4 + q / 3 + (hv & 255) / 255) % 1);
        const kk = ph < 0.34 ? 0 : ph < 0.67 ? 1 : 2;
        const px = cx + Math.round((Math.sin((hv & 63) + ph * 3) * 4 + ph * 6) / 2) * 2 - 8;
        const py = by - 22 - Math.round((ph * 40) / 2) * 2;
        g.drawImage(puffTile(kk), px, py, 16, 16);
        this.st.puffs++;
      }
    }
    g.imageSmoothingEnabled = sm;
  }

  /** Rebuild the W x H open-sky mask in the cast colour (one pixel per tile). */
  buildMask(s, kind) {
    const c = CAST[kind];
    if (!c) { this.maskKind = kind; return; }
    if (!this.mask) { this.mask = document.createElement('canvas'); this.mask.width = W; this.mask.height = H; this.maskG = this.mask.getContext('2d'); this.maskImg = this.maskG.createImageData(W, H); }
    const d = this.maskImg.data, L = s.L;
    const hex = parseInt(c[0].slice(1), 16), r = (hex >> 16) & 255, gg = (hex >> 8) & 255, b = hex & 255, a = Math.round(c[1] * 255);
    for (let i = 0; i < W * H; i++) {
      const open = L.roof[i] === ROOF.OPEN && L.terrain[i] !== TER.ROCK;
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = open ? a : 0;
    }
    this.maskG.putImageData(this.maskImg, 0, 0);
    this.maskKind = kind; this.maskDirty = false;
  }

  /** Precipitation and the weather cast over open-sky tiles in view (world transform, after the darkness). */
  drawSky(g, s, view, ctx) {
    const kind = this.kind;
    this.st.drops = 0;
    if (kind === 'clear') return;
    const t = ctx.time || 0;
    if (CAST[kind]) {
      if (this.maskKind !== kind || (this.maskDirty && t - this.maskAt > 1)) { this.buildMask(s, kind); this.maskAt = t; }
      if (this.mask && this.maskKind === kind) {
        const x0 = Math.max(0, Math.floor(view.x0 / T)), y0 = Math.max(0, Math.floor(view.y0 / T));
        const x1 = Math.min(W, Math.ceil(view.x1 / T) + 1), y1 = Math.min(H, Math.ceil(view.y1 / T) + 1);
        const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
        g.drawImage(this.mask, x0, y0, x1 - x0, y1 - y0, x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T);
        g.imageSmoothingEnabled = sm;
      }
    }
    if (kind !== 'rain' && kind !== 'snow') return;
    if (ctx.lowDetail || view.z < 0.5) return; // the strategic view keeps only the cast
    const L = s.L, rain = kind === 'rain', sp = rain ? dropTile() : flakeTile(), sheet = sheetTile(rain);
    if (!this.blk || (this.blkDirty && t - this.blkAt > 1)) { this.buildBlocks(s); this.blkAt = t; }
    const every = rain ? 3 : 4, fall = rain ? 520 : 70, sw = rain ? 2 : 4, sh = rain ? 8 : 4;
    const tx0 = Math.max(0, Math.floor(view.x0 / T)), tx1 = Math.min(W - 1, Math.floor(view.x1 / T));
    const ty0 = Math.max(0, Math.floor(view.y0 / T)), ty1 = Math.min(H - 1, Math.floor(view.y1 / T));
    const calm = !!ctx.reduceMotion, bw = Math.ceil(W / BLK), BS = BLK * T;
    // the sheet scrolls down (rain fast, snow slowly with a sway); whole art pixels only
    const off = calm ? 0 : (((t * fall * 0.5) | 0) & 63);
    const sway = rain || calm ? 0 : Math.round(Math.sin(t * 1.3) * 2) * 2;
    const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    for (let by = (ty0 / BLK) | 0; by <= ((ty1 / BLK) | 0); by++) for (let bx = (tx0 / BLK) | 0; bx <= ((tx1 / BLK) | 0); bx++) {
      const open = this.blk[by * bw + bx];
      if (!open) continue;
      if (open === BLK * BLK) { g.drawImage(sheet, 0, 64 - off, 64, 64, bx * BS + sway, by * BS, BS, BS); this.st.drops++; continue; }
      // a block at a roof or rock edge: drops on its open tiles one by one
      for (let y = by * BLK; y < Math.min(H, by * BLK + BLK); y++) for (let x = bx * BLK; x < Math.min(W, bx * BLK + BLK); x++) {
        const i = y * W + x, hv = hash(i);
        if (hv % every) continue;
        if (L.roof[i] !== ROOF.OPEN || L.terrain[i] === TER.ROCK) continue;
        const ph = calm ? ((hv >> 8) & 31) / 32 : ((t * fall) / T + ((hv >> 8) & 255) / 255) % 1;
        const dx = rain ? 0 : Math.round(Math.sin(t * 1.3 + (hv & 31)) * 3) * 2;
        const px = x * T + (((hv >> 4) & 7) * 4) + dx, py = y * T + Math.round((ph * (T - sh)) / 2) * 2;
        g.drawImage(sp, px, py, sw, sh);
        this.st.drops++;
      }
    }
    g.imageSmoothingEnabled = sm;
  }
}

/** Cracks over the rumbling tiles (after the darkness, so they read in a dark tunnel). */
WeatherLayer.prototype.drawRumble = function drawRumble(g, s, view, ctx) {
  const q = s && s.colony && s.colony.world && s.colony.world.caveQ;
  if (!q || !q.length) return;
  const t = ctx.time || 0, shake = ctx.reduceMotion ? 0 : (((t * 18) | 0) & 1) * 2 - 1;
  const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
  for (const e of q) {
    const i = e[0], x = i % W, y = (i / W) | 0;
    if ((x + 1) * T < view.x0 || x * T > view.x1 || (y + 1) * T < view.y0 || y * T > view.y1) continue;
    g.drawImage(crackTile(hash(i)), x * T + shake * 2, y * T, T, T);
  }
  g.imageSmoothingEnabled = sm;
};

/** Season index (0 Thaw .. 3 Deepcold) of a colony now. */
export const seasonNow = (s) => (s ? seasonOf(s.tick) : 0);
