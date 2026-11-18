// Light layer (owner C; doc 12.4 "Light and darkness"). The sim light map s.rt.light (B,
// js/game/world/light.js, Uint8 0-3) is the ONLY light model: this file has none of its own. It keeps
// one texture at cfg.lightPxPerTile px per tile that combines fog, roof darkness, the ambient day
// level and per-tile light, and draws it scaled over the world (smoothing per cfg.lightSmoothing).
//   - An open tile's pixels take its own level: max(ambient under its roof, rt.light), each quadrant
//     blended 2:1:1 with the open neighbours on its side (softer terraces; rock never counts).
//   - A wall or rock tile's pixels take the level of the open neighbour ON THAT PIXEL'S SIDE, so a
//     rock wall between a lit tunnel and a dark one is lit on one face only, and light never shows
//     through rock. Rock with no open neighbour shows its dim body (ROCK_BODY). Opacity is B's own
//     rule (world/pass.js isOpaque: rock, walls, closed doors).
//   - Unexplored open tiles (fog bit 0) are fog.
// Updates: changed tiles (light, fog, roof, terrain or opacity diffed against shadow copies when
// s.tick moves, plus markTile from the terrain patch queue) and their 4 neighbours; a full rebuild
// when the quantised ambient level changes (day-phase ticks) or on setState (about 1 ms at 128 on a
// desktop: per-tile levels first, then packed 32-bit pixel writes). Only the bounding box of the
// visible tiles that carry darkness is drawn (nothing at noon on open ground).
// Flames flicker by modulating the alpha of their own tiles (the cfg.flickerFlames nearest).
// Hollow emissive rims (SP.EMIS) are drawn after the darkness, as in the roguelite.
// Pixel style (docs/ART-STYLE.md): the texture is cfg.lightPixelPpt (8) px per tile, i.e. one light
// pixel per 2 x 2 native art pixels, drawn with smoothing off. Within open tiles the darkness is
// interpolated toward the open neighbours, then POSTERISED to 5 bands (LIGHT_BANDS) with a 4 x 4
// Bayer dither at the band edges, so light falls off in stepped, dithered rings that match the art.

import { TILE, W, H, N, TER_OPAQUE, ROOF, getBit } from '../../game/core/grid.js';
import { hourOf, minuteOf, seasonOf } from '../../game/core/time.js';
import { isOpaque } from '../../game/world/pass.js';
import * as SP from '../sprites.js';

const T = TILE;
/** Darkness alpha at light level 0, 1, 2, 3 (S2: readable 1-tile tunnels at level 1). */
// Level 0 is 200 (was 236 in the S2 spike): an unlit dug tunnel stays readable as a darker groove
// next to the rock body (ROCK_BODY, level 1), which matters for digging in Stage 1a.
export const DARK_ALPHA = [200, 160, 100, 0];
/** The 5 posterised darkness levels (alpha); every DARK_ALPHA value is one of them, so flat areas stay flat. */
export const LIGHT_BANDS = [0, 50, 100, 160, 200];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// QUANT[a * 16 + t]: alpha a (0-255) posterised at dither threshold t (0-15); a >= 200 stays as it is (fog)
// (built on the first LightLayer, not at import: check-imports forbids typed arrays at import)
let QUANT = null;
function buildQuant() {
  if (QUANT) return;
  QUANT = new Uint8Array(256 * 16);
  for (let a = 0; a < 256; a++) for (let t = 0; t < 16; t++) {
    let v = a;
    if (a > 0 && a < 200) {
      let k = 0; while (a >= LIGHT_BANDS[k + 1]) k++;
      const f = (a - LIGHT_BANDS[k]) / (LIGHT_BANDS[k + 1] - LIGHT_BANDS[k]);
      v = f * 16 > t + 0.5 ? LIGHT_BANDS[k + 1] : LIGHT_BANDS[k];
    }
    QUANT[a * 16 + t] = v;
  }
}
const quant = (a, x, y) => QUANT[(a > 255 ? 255 : a < 0 ? 0 : a | 0) * 16 + BAYER[((y & 3) << 2) | (x & 3)]];
const NIGHT_RGB = [10, 12, 34], UNDER_RGB = [9, 8, 14], FOG_RGB = [23, 21, 31], FOG_A = 245;
const AMB_STEPS = 8;
/** Radius (tiles) of the drawn firelight falloff inside tiles the sim lights by fire (sconce r 4). */
const FIRE_R = 4.5; // ambient is quantised so a full rebuild happens a few times per dusk and dawn
/** Light level of a rock body with no open face (under a rock roof): dim, so unexplored massif reads as rock and unlit tunnels as darker grooves. */
export const ROCK_BODY = 1;
const OPAQUE = -1, FOG = -2;

/** Ambient level 0-3 of open sky at this tick: 3 by day, NIGHT_AMB at night, eased through dawn and dusk. */
export const NIGHT_AMB = 0.85;
export function ambientOf(tick) {
  const h = hourOf(tick) + minuteOf(tick) / 60, cold = seasonOf(tick) === 3;
  const dawn0 = cold ? 6 : 5, night0 = cold ? 20 : 21;
  let u; // 1 = day, 0 = night
  if (h >= night0 || h < dawn0) u = 0;
  else if (h < dawn0 + 2) u = (h - dawn0) / 2;
  else if (h >= night0 - 2) u = (night0 - h) / 2;
  else u = 1;
  u = u * u * (3 - 2 * u);
  return NIGHT_AMB + (3 - NIGHT_AMB) * u;
}
/** Ambient under a roof: built roofs let some light in by day, rock roofs none. */
const roofAmb = (roof, sky) => (roof === ROOF.OPEN ? sky : roof === ROOF.BUILT ? Math.min(sky, 1.6) : 0);

function alphaOf(lv) {
  if (lv >= 3) return 0;
  if (lv <= 0) return DARK_ALPHA[0];
  const k = lv | 0, f = lv - k;
  return Math.round(DARK_ALPHA[k] + (DARK_ALPHA[k + 1] - DARK_ALPHA[k]) * f);
}
// Packed RGBA (little-endian Uint32: 0xAABBGGRR) without the alpha byte.
const rgb32 = (c) => (c[0] | (c[1] << 8) | (c[2] << 16)) >>> 0;
const NIGHT32 = rgb32(NIGHT_RGB), UNDER32 = rgb32(UNDER_RGB), FOG32 = rgb32(FOG_RGB);
// Firelight: an open tile whose rt.light beats its ambient is lit by a flame, so its (lighter) darkness
// takes a warm ember cast instead of the cold night blue; the bands then read as a warm pool fading
// to cold dark. Index = und[i]: 0 open sky, 1 under a roof, 2 lit by fire (palette ember0, darkened).
const WARM_RGB = [150, 70, 20];
const WARM32 = rgb32(WARM_RGB);
const COL32 = [NIGHT32, UNDER32, WARM32];
/** Firelight colour per posterised band (LIGHT_BANDS order): a gold glow near the flame, ember, then warm dark. */
const WARM_BAND = new Map([[0, rgb32([255, 176, 64])], [50, rgb32([255, 160, 56])], [100, WARM32], [160, rgb32([64, 30, 16])], [200, rgb32([30, 16, 12])]]);
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export class LightLayer {
  constructor(cfg) {
    buildQuant();
    this.cfg = cfg;
    this.c = null; this.g = null; this.img = null; this.px = null;
    this.ppt = cfg.lightPixelPpt || cfg.lightPxPerTile;
    this.s = null;
    this.amb = -1; this.ambOverride = null;
    this.prev = null;          // shadow copies for the diff
    this.lv = null;            // per tile: level of an open tile, OPAQUE, or FOG
    this.und = null;           // per tile: 1 when under a roof
    this.dirty = [];           // tiles to refresh
    this.dirtyMark = null;     // Uint8Array(N) de-dupe
    this.flames = [];          // tile indexes of flames (set by the entity layer each frame)
    this.flickerNext = 0; this.flickerOn = [];
    this.st = { full: 0, tiles: 0, lastMs: 0, fullMs: 0, drawn: 0 };
    this.curA = 0;
  }

  setState(s, opts = {}) {
    this.s = s;
    this.ppt = opts.ppt || this.cfg.lightPixelPpt || this.cfg.lightPxPerTile;
    if (!this.c) { this.c = document.createElement('canvas'); this.g = this.c.getContext('2d'); }
    const cw = W * this.ppt, ch = H * this.ppt;
    if (this.c.width !== cw || this.c.height !== ch) { this.c.width = cw; this.c.height = ch; }
    this.img = this.g.createImageData(cw, ch);
    this.px = LE ? new Uint32Array(this.img.data.buffer) : null;
    this.base = new Uint8Array(cw * ch); // alpha before flicker
    this.dirtyMark = new Uint8Array(N);
    this.lv = new Float32Array(N); this.und = new Uint8Array(N);
    this.tileA = new Uint8Array(N); // max alpha written for each tile (a fully lit view skips the draw)
    this.fon = new Uint8Array(N); this.fseen = new Uint32Array(N); this.flist = []; this.fgen = 0; // known flames (firelight falloff)
    this.prev = { light: new Uint8Array(N), roof: new Uint8Array(N), ter: new Uint8Array(N), fog: new Uint8Array(s.L.fog.length), op: new Uint8Array(N), tick: -1 };
    this.amb = -1;
    this.flickerOn.length = 0;
  }
  /** Force the ambient sky level (debug scenes); null returns to the clock. */
  setAmbient(v) { this.ambOverride = v; this.amb = -1; }
  markTile(i) { if (this.dirtyMark && !this.dirtyMark[i]) { this.dirtyMark[i] = 1; this.dirty.push(i); } }
  markAll() { this.amb = -1; }

  /** Opaque for light: rock terrain, walls and closed doors (B's isOpaque, the sim's own rule). */
  opaque(s, i) { return TER_OPAQUE[s.L.terrain[i]] === 1 || (s.rt.occ && s.rt.occ[i] >= 0 && isOpaque(s, i)); }
  /** Level of tile i into lv/und: the open level max(ambient under its roof, rt.light), OPAQUE or FOG. */
  level(s, i, sky) {
    const L = s.L;
    this.und[i] = L.roof[i] !== ROOF.OPEN ? 1 : 0;
    if (this.opaque(s, i)) { this.lv[i] = OPAQUE; return; }
    if (!getBit(L.fog, i)) { this.lv[i] = FOG; return; }
    const lt = s.rt.light ? s.rt.light[i] : 0, a = roofAmb(L.roof[i], sky);
    this.lv[i] = lt > a ? lt : a;
    if (lt > a + 0.25) this.und[i] = 2;
  }
  /** Write one light pixel (texture coords px, py): continuous alpha a (kept in base for the flicker), posterised in the texture. */
  put(p, px, py, c, a) {
    this.base[p] = a;
    const q = quant(a, px, py);
    if (q > this.curA) this.curA = q;
    if (c === WARM32) c = WARM_BAND.get(q) ?? WARM32;
    if (this.px) this.px[p] = ((q << 24) | c) >>> 0;
    else { const d = this.img.data, o = p * 4; d[o] = c & 255; d[o + 1] = (c >> 8) & 255; d[o + 2] = (c >> 16) & 255; d[o + 3] = q; }
  }
  /** fill() with the firelight falloff of the nf flames (k of them) applied per pixel. */
  fillFire(x, y, x0, y0, n, c, a, k) {
    const ppt = this.ppt, cw = W * ppt;
    for (let py = y0; py < y0 + n; py++) {
      const ty = y * ppt + py;
      let p = ty * cw + x * ppt + x0;
      for (let q = 0; q < n; q++, p++) { const tx = x * ppt + x0 + q; this.put(p, tx, ty, c, a * (0.3 + 0.7 * this.fall(tx, ty, k)) + 0.5); }
    }
  }
  fill(x, y, x0, y0, n, c, a) {
    const ppt = this.ppt, cw = W * ppt;
    for (let py = y0; py < y0 + n; py++) {
      const ty = y * ppt + py;
      let p = ty * cw + x * ppt + x0;
      for (let k = 0; k < n; k++, p++) this.put(p, x * ppt + x0 + k, ty, c, a);
    }
  }
  /**
   * Write the pixels of tile i from lv. An open tile takes its own level, interpolated toward its
   * open neighbours across each half (opaque and fogged neighbours do not count, so light still
   * never crosses rock), posterised with the dither. A wall or rock tile: each quadrant takes the
   * open neighbour on its own side (vertical first, then horizontal if brighter), so a 1-tile rock
   * wall is lit on one face only and light never shows through; with no open neighbour on that side
   * it shows its own body (walls under the sky take the sky, rock under rock the dim ROCK_BODY
   * level); a fogged neighbour shows fog.
   */
  writeTile(s, i, sky) {
    this.curA = 0;
    this.writeTile0(s, i, sky);
    this.tileA[i] = this.curA;
  }
  writeTile0(s, i, sky) {
    const ppt = this.ppt, x = i % W, y = (i / W) | 0, lv = this.lv, und = this.und;
    const v = lv[i], half = ppt >> 1;
    if (v !== OPAQUE) {
      if (v === FOG) { this.fill(x, y, 0, 0, ppt, FOG32, FOG_A); return; }
      const c = COL32[und[i]], a0 = alphaOf(v), warm = und[i] === 2;
      const nfl = warm ? this.nearFlames(x, y) : 0;
      const ln = y > 0 ? lv[i - W] : OPAQUE, ls = y < H - 1 ? lv[i + W] : OPAQUE, lw = x > 0 ? lv[i - 1] : OPAQUE, le = x < W - 1 ? lv[i + 1] : OPAQUE;
      const an = ln >= 0 ? alphaOf(ln) : a0, as = ls >= 0 ? alphaOf(ls) : a0, aw = lw >= 0 ? alphaOf(lw) : a0, ae = le >= 0 ? alphaOf(le) : a0;
      if (!nfl && an === a0 && as === a0 && aw === a0 && ae === a0) { this.fill(x, y, 0, 0, ppt, c, a0); return; }
      const cw = W * ppt, inv = 1 / ppt;
      for (let py = 0; py < ppt; py++) {
        const vy = (py + 0.5) * inv - 0.5, av = vy < 0 ? an : as, wy = vy < 0 ? -vy : vy, ty = y * ppt + py;
        let p = ty * cw + x * ppt;
        for (let pxx = 0; pxx < ppt; pxx++, p++) {
          const vx = (pxx + 0.5) * inv - 0.5, ah = vx < 0 ? aw : ae, wx = vx < 0 ? -vx : vx;
          const edge = (ah - a0) * wx + (av - a0) * wy; // toward the neighbours (darker at the pool's rim)
          // firelight: the tile's own darkness falls off toward the nearest flame (rings once posterised)
          const own = nfl ? a0 * (0.3 + 0.7 * this.fall(x * ppt + pxx, ty, nfl)) : a0;
          this.put(p, x * ppt + pxx, ty, c, own + (nfl && edge < 0 ? 0 : edge) + 0.5);
        }
      }
      return;
    }
    const ownOpen = s.L.roof[i] === ROOF.OPEN;
    const ownC = ownOpen ? NIGHT32 : UNDER32, ownA = alphaOf(ownOpen ? sky : ROCK_BODY);
    for (let q = 0; q < 4; q++) {
      const sx = q & 1 ? 1 : -1, sy = q & 2 ? 1 : -1;
      const ny = y + sy, nx = x + sx;
      const jv = ny >= 0 && ny < H ? ny * W + x : -1, jh = nx >= 0 && nx < W ? y * W + nx : -1;
      const a = jv >= 0 ? lv[jv] : OPAQUE, b = jh >= 0 ? lv[jh] : OPAQUE;
      let c, al;
      if (a >= 0 || b >= 0) {
        const j = b > a ? jh : jv;
        c = COL32[und[j]]; al = alphaOf(b > a ? b : a);
        if (und[j] === 2) { const n = this.nearFlames(x, y); if (n) { this.fillFire(x, y, q & 1 ? half : 0, q & 2 ? half : 0, half, c, al, n); continue; } }
      } else if (a === FOG || b === FOG) { c = FOG32; al = FOG_A; }
      else { c = ownC; al = ownA; }
      this.fill(x, y, q & 1 ? half : 0, q & 2 ? half : 0, half, c, al);
    }
  }

  /**
   * Track the flame tiles the entity layer reports (this.flames): a flame that appears or goes out
   * re-dirties the tiles within FIRE_R + 1 of it, so their firelight falloff is rewritten.
   */
  syncFlames() {
    if (!this.fon) return;
    const f = this.flames, on = this.fon, seen = this.fseen, list = this.flist, n = ++this.fgen;
    for (let k = 0; k < f.length; k++) { const c = f[k]; if (!on[c]) { on[c] = 1; list.push(c); this.markAround(c); } seen[c] = n; }
    for (let k = list.length - 1; k >= 0; k--) {
      const c = list[k];
      if (seen[c] === n) continue;
      on[c] = 0; list[k] = list[list.length - 1]; list.pop(); this.markAround(c);
    }
  }
  markAround(c) {
    const cx = c % W, cy = (c / W) | 0, r = FIRE_R + 1;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) this.markTile(y * W + x);
  }
  /** The known flames within FIRE_R + 1 tiles of tile (x, y), as tile-centre coordinates into this.nf; returns the count. */
  nearFlames(x, y) {
    const nf = this.nf || (this.nf = new Float32Array(64)), list = this.flist, r = FIRE_R + 1;
    let n = 0;
    for (let k = 0; k < list.length && n < 32; k++) {
      const c = list[k], fx = c % W, fy = (c / W) | 0;
      if (fx < x - r || fx > x + r || fy < y - r || fy > y + r) continue;
      nf[n * 2] = fx + 0.5; nf[n * 2 + 1] = fy + 0.5; n++;
    }
    return n;
  }
  /** Firelight falloff 0..1 at texture pixel (px, py) from the nf flames (n of them): 0 at a flame, 1 from FIRE_R tiles out. */
  fall(px, py, n) {
    if (!n) return 1;
    const nf = this.nf, inv = 1 / this.ppt, tx = (px + 0.5) * inv, ty = (py + 0.5) * inv;
    let d2 = 1e9;
    for (let k = 0; k < n; k++) { const dx = tx - nf[k * 2], dy = ty - nf[k * 2 + 1], d = dx * dx + dy * dy; if (d < d2) d2 = d; }
    const f = Math.sqrt(d2) / FIRE_R;
    return f >= 1 ? 1 : f;
  }

  /** Bring the texture up to date with s (cheap when nothing changed). */
  update(s) {
    const t0 = performance.now();
    const sky = this.ambOverride !== null ? this.ambOverride : ambientOf(s.tick);
    const q = Math.round(sky * AMB_STEPS) / AMB_STEPS;
    const P = this.prev, L = s.L, light = s.rt.light, occ = s.rt.occ;
    this.syncFlames();
    if (q !== this.amb) {
      this.amb = q;
      for (let i = 0; i < N; i++) this.level(s, i, q);
      for (let i = 0; i < N; i++) this.writeTile(s, i, q);
      if (light) P.light.set(light); else P.light.fill(0);
      P.roof.set(L.roof); P.ter.set(L.terrain); P.fog.set(L.fog);
      for (let i = 0; i < N; i++) P.op[i] = this.lv[i] === OPAQUE ? 1 : 0;
      P.tick = s.tick;
      this.dirty.length = 0; this.dirtyMark.fill(0);
      this.g.putImageData(this.img, 0, 0);
      this.st.full++; this.st.lastMs = this.st.fullMs = performance.now() - t0;
      return true;
    }
    if (P.tick !== s.tick) { // diff the inputs once per tick (about 0.1 ms at 128)
      P.tick = s.tick;
      for (let i = 0; i < N; i++) {
        const op = TER_OPAQUE[L.terrain[i]] === 1 || ((occ && occ[i] >= 0) || P.op[i] ? this.opaque(s, i) : false) ? 1 : 0;
        if ((light && light[i] !== P.light[i]) || L.roof[i] !== P.roof[i] || L.terrain[i] !== P.ter[i] || op !== P.op[i]) {
          if (light) P.light[i] = light[i];
          P.roof[i] = L.roof[i]; P.ter[i] = L.terrain[i]; P.op[i] = op;
          this.markTile(i);
        }
      }
      for (let k = 0; k < L.fog.length; k++) if (L.fog[k] !== P.fog[k]) {
        for (let b = 0; b < 8; b++) { const i = k * 8 + b; if (i < N) this.markTile(i); }
        P.fog[k] = L.fog[k];
      }
    }
    if (!this.dirty.length) return false;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const list = this.dirty;
    for (let k = 0; k < list.length; k++) { const i = list[k]; this.dirtyMark[i] = 0; this.level(s, i, q); }
    const touch = (i) => { this.writeTile(s, i, q); const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (let k = 0; k < list.length; k++) {
      const i = list[k], x = i % W, y = (i / W) | 0;
      touch(i);
      if (x > 0) touch(i - 1); if (x < W - 1) touch(i + 1); if (y > 0) touch(i - W); if (y < H - 1) touch(i + W);
    }
    this.st.tiles += list.length;
    list.length = 0;
    const ppt = this.ppt;
    this.g.putImageData(this.img, 0, 0, x0 * ppt, y0 * ppt, (x1 - x0 + 1) * ppt, (y1 - y0 + 1) * ppt);
    this.st.lastMs = performance.now() - t0;
    return true;
  }

  /** Flame flicker: alpha modulation of the tiles of the nearest flames (render time only). */
  flicker(time, camX, camY, reduceMotion) {
    if (!this.img) return;
    const ppt = this.ppt, cw = W * ppt, base = this.base, px32 = this.px, d = this.img.data;
    const blk = this.flickerBlk || (this.flickerBlk = []);
    // write a 3 x 3 tile block around flame tile c with the alpha moved toward darkness by dip (0 = restore), one put
    const block = (c, dip) => {
      const cx = c % W, cy = (c / W) | 0;
      const x0 = Math.max(0, cx - 1), y0 = Math.max(0, cy - 1), x1 = Math.min(W - 1, cx + 1), y1 = Math.min(H - 1, cy + 1);
      for (let ty = y0 * ppt; ty < (y1 + 1) * ppt; ty++) {
        let p = ty * cw + x0 * ppt;
        for (let tx = x0 * ppt; tx < (x1 + 1) * ppt; tx++, p++) {
          const a = base[p], a2 = dip ? a + (DARK_ALPHA[0] - a) * dip * Math.min(1, a / 60) : a; // no flicker in full light
          const q = quant(a2, tx, ty);
          if (px32) px32[p] = ((q << 24) | (px32[p] & 0xffffff)) >>> 0; else d[p * 4 + 3] = q;
        }
      }
      this.g.putImageData(this.img, 0, 0, x0 * ppt, y0 * ppt, (x1 - x0 + 1) * ppt, (y1 - y0 + 1) * ppt);
    };
    const restore = () => { for (const c of blk) block(c, 0); blk.length = 0; this.flickerOn.length = 0; };
    if (reduceMotion || !this.flames.length) { if (blk.length) restore(); return; }
    if (time < this.flickerNext) return;
    this.flickerNext = time + 1 / this.cfg.flickerHz;
    restore();
    const f = this.flames;
    const ctx = camX / T, cty = camY / T;
    const near = f.length <= this.cfg.flickerFlames ? f : f.slice().sort((a, b) => {
      const ax = (a % W) - ctx, ay = ((a / W) | 0) - cty, bx = (b % W) - ctx, by = ((b / W) | 0) - cty;
      return ax * ax + ay * ay - (bx * bx + by * by) || a - b;
    }).slice(0, this.cfg.flickerFlames);
    for (const c of near) {
      const cx = c % W, cy = (c / W) | 0;
      const k = 0.88 + 0.12 * Math.sin(time * 11 + cx * 1.7) * Math.sin(time * 7.3 + cy);
      block(c, (1 - k) * 0.6);
      blk.push(c);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < W && y < H) this.flickerOn.push(y * W + x); }
    }
  }

  /** Draw the visible part of the texture over the world (g in world transform). */
  draw(g, view, smooth) {
    if (!this.c) return;
    const ppt = this.ppt;
    const tx0 = Math.max(0, Math.floor(view.x0 / T) - 1), ty0 = Math.max(0, Math.floor(view.y0 / T) - 1);
    const tx1 = Math.min(W, Math.ceil(view.x1 / T) + 1), ty1 = Math.min(H, Math.ceil(view.y1 / T) + 1);
    if (tx1 <= tx0 || ty1 <= ty0) return;
    // Only the bounding box of the visible tiles that carry any darkness (plus flickering tiles): a
    // view of the surface at noon draws nothing. The box keeps a 1-tile clear margin for smoothing.
    const A = this.tileA;
    let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
    for (let y = ty0; y < ty1; y++) {
      const row = y * W;
      let x = tx0;
      while (x < tx1 && !A[row + x]) x++;
      if (x === tx1) continue;
      if (x < bx0) bx0 = x;
      let xr = tx1 - 1;
      while (xr > x && !A[row + xr]) xr--;
      if (xr > bx1) bx1 = xr;
      if (y < by0) by0 = y;
      by1 = y;
    }
    for (const i of this.flickerOn) { const x = i % W, y = (i / W) | 0; if (x < tx0 || x >= tx1 || y < ty0 || y >= ty1) continue; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    this.st.drawn = bx1 >= 0 ? 1 : 0;
    if (bx1 < 0) return;
    const x0 = Math.max(0, bx0 - 1), y0 = Math.max(0, by0 - 1), x1 = Math.min(W, bx1 + 2), y1 = Math.min(H, by1 + 2);
    const sm = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = smooth;
    g.drawImage(this.c, x0 * ppt, y0 * ppt, (x1 - x0) * ppt, (y1 - y0) * ppt, x0 * T, y0 * T, (x1 - x0) * T, (y1 - y0) * T);
    g.imageSmoothingEnabled = sm;
  }

  /** Hollow rims and eyes, after the darkness so they are never darkened (roguelite drawEmissive). */
  drawEmissive(g, view, sky) {
    const E = SP.EMIS;
    if (!E.length) return;
    const a = Math.min(1, 0.2 + 0.8 * Math.max(0, (3 - sky) / (3 - NIGHT_AMB)));
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a;
    for (let i = 0; i < E.length; i += SP.EMIS_N) {
      const rim = E[i + 1], dx = E[i + 2], dy = E[i + 3], k = E[i + 6];
      if (dx > view.x1 || dy > view.y1 || dx + E[i + 4] < view.x0 || dy + E[i + 5] < view.y0) continue;
      if (rim.m !== undefined) g.drawImage(rim.c, dx - rim.m, dy - rim.m, rim.w, rim.h); // a pixel rim (art/pixel.js pixelRim)
      else g.drawImage(rim.c, dx - k, dy - k, rim.w * k, rim.h * k);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
}
