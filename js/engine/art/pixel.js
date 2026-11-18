// Pixel painter and native-size sprite bakes (owner D; docs/ART-STYLE.md). Every sprite is drawn in
// code at its native size (16 px per map tile; 1 native px = 2 world units) into a small offscreen
// canvas, cached, and drawn by the renderer at an integer scale with image smoothing off.
//
//   NPX                 world units per native pixel (2)
//   new Px(g, ox, oy)   a painter over a 2D context in native px (origin offset ox, oy)
//     px rect hl vl dither line ellipse disc box ring outline shadow ...
//   bake(key, w, h, ax, ay, draw, opt)   cached sprite { c, w, h, ax, ay } (w..ay in WORLD units),
//                       draw(p) paints in native px; opt.outline (default true) adds the 1 px dark
//                       outline around every opaque pixel after draw; opt.skip(x, y) keeps the outline
//                       off chosen pixels (walls joined to a neighbour); opt.after(p) paints after it
//   tileCanvas(key, draw)  a cached 16 x 16 canvas (terrain atlas tiles)
//   pixelRim(sp, ci)    the Hollow emissive rim of a baked sprite: a 1 px glow outline plus its eyes
//
// Uses js/engine/sprites.js for the cache (its LRU and memory budget; scale 0.5 = native size).
// Nothing runs at import; canvases are created on first use (browser only).

import * as SP from '../sprites.js';
import { PAL, dith, rgbOf } from './palette.js';

export const NPX = 2;
const NATIVE = 0.5; // sprites.js scale: canvas px per world unit

export class Px {
  constructor(g, ox = 0, oy = 0) { this.g = g; this.ox = ox; this.oy = oy; this.fs = null; }
  col(c) { if (c !== this.fs) { this.g.fillStyle = c; this.fs = c; } }
  px(x, y, c) { this.col(c); this.g.fillRect((x | 0) + this.ox, (y | 0) + this.oy, 1, 1); }
  rect(x, y, w, h, c) { if (w <= 0 || h <= 0) return; this.col(c); this.g.fillRect((x | 0) + this.ox, (y | 0) + this.oy, w | 0, h | 0); }
  hl(x, y, w, c) { this.rect(x, y, w, 1, c); }
  vl(x, y, h, c) { this.rect(x, y, 1, h, c); }
  /** Ordered dither of colour c over a rect at level 0-16 (absolute px coordinates). */
  dither(x, y, w, h, c, level) {
    if (level <= 0) return;
    if (level >= 16) { this.rect(x, y, w, h, c); return; }
    this.col(c);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (dith(i + this.ox, j + this.oy, level)) this.g.fillRect(i + this.ox, j + this.oy, 1, 1);
  }
  /** Bresenham line. */
  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    this.col(c);
    for (let n = 0; n < 256; n++) {
      this.g.fillRect(x0 + this.ox, y0 + this.oy, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  /** Filled ellipse centred at (cx, cy) (may be half-integer), radii rx, ry. */
  ellipse(cx, cy, rx, ry, c) {
    this.col(c);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const v = (y + 0.5 - cy) / ry;
      if (v * v > 1) continue;
      const hw = rx * Math.sqrt(1 - v * v);
      const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
      if (x1 > x0) this.g.fillRect(x0 + this.ox, y + this.oy, x1 - x0, 1);
    }
  }
  disc(cx, cy, r, c) { this.ellipse(cx, cy, r, r, c); }
  /** A box lit from the top-left: body r[1], top row and left column r[2] (top-left pixel r[3]), bottom row and right column r[0]. */
  box(x, y, w, h, r) {
    this.rect(x, y, w, h, r[1]);
    this.hl(x, y, w, r[2]); this.vl(x, y, h, r[2]);
    this.hl(x, y + h - 1, w, r[0]); this.vl(x + w - 1, y, h, r[0]);
    if (r[3]) this.px(x, y, r[3]);
  }
  /** A 1 px ring (circle outline) of radius r. */
  ring(cx, cy, r, c) {
    this.col(c);
    let x = r, y = 0, e = 1 - r;
    const put = (a, b) => this.g.fillRect(cx + a + this.ox, cy + b + this.oy, 1, 1);
    while (x >= y) {
      put(x, y); put(y, x); put(-y, x); put(-x, y); put(-x, -y); put(-y, -x); put(y, -x); put(x, -y);
      y++;
      if (e < 0) e += 2 * y + 1; else { x--; e += 2 * (y - x) + 1; }
    }
  }
  /** A flat contact shadow: an ellipse of ink at 50% (checker dither). */
  shadow(cx, cy, rx, ry, level = 8) {
    const g = this.g;
    this.col(PAL.ink);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const v = (y + 0.5 - cy) / ry;
      if (v * v > 1) continue;
      const hw = rx * Math.sqrt(1 - v * v);
      for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) if (dith(x + this.ox, y + this.oy, level)) g.fillRect(x + this.ox, y + this.oy, 1, 1);
    }
  }
  /**
   * The 1 px outline: every transparent pixel with an opaque 4-neighbour becomes colour c (ink by
   * default). skip(x, y) (canvas px) keeps chosen pixels clear. Reads the whole canvas once.
   */
  outline(c = PAL.ink, skip = null) {
    const g = this.g, cv = g.canvas, w = cv.width, h = cv.height;
    let img;
    try { img = g.getImageData(0, 0, w, h); } catch (_) { return; }
    const d = img.data, a = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 96 ? 1 : 0;
    const [r, gg, b] = rgbOf(c);
    let any = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (a[i]) continue;
      if (!((x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w]))) continue;
      if (skip && skip(x, y)) continue;
      d[i * 4] = r; d[i * 4 + 1] = gg; d[i * 4 + 2] = b; d[i * 4 + 3] = 255; any = true;
    }
    if (any) g.putImageData(img, 0, 0);
  }
}

/**
 * A cached native-size sprite. w, h, ax, ay are in native px; the returned record is in world units
 * (sprites.js shape: { c, w, h, ax, ay, flash, rim }). draw(p) paints with a Px over the canvas.
 */
export function bake(key, w, h, ax, ay, draw, opt = null) {
  return SP.sprite(key, NATIVE, w * NPX, h * NPX, ax * NPX, ay * NPX, (g) => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    const p = new Px(g);
    draw(p);
    if (!opt || opt.outline !== false) p.outline(opt && opt.ink ? opt.ink : PAL.ink, opt && opt.skip);
    if (opt && opt.after) { p.fs = null; opt.after(p); }
  });
}

const SKEYS = new Map();
/** A memoised string key `${name}:${n}` (no string is built on a repeat call). */
export function skey(name, n) { let a = SKEYS.get(name); if (!a) SKEYS.set(name, (a = [])); return a[n] || (a[n] = `${name}:${n}`); }
/** The cached native sprite under key, or null: hot paths check it before building a draw closure. */
export function peek(key) { return SP.peek(key, NATIVE); }

const TILES = new Map();
let tileBytes = 0;
/** A cached 16 x 16 canvas (terrain atlas tile). draw(p) paints with a Px. */
export function tileCanvas(key, draw, w = 16, h = 16) {
  let c = TILES.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(new Px(g), g);
  TILES.set(key, c);
  tileBytes += w * h * 4;
  if (tileBytes > 12 * 1048576) { // a runaway set of variants: start over (they redraw on demand)
    for (const t of TILES.values()) t.width = t.height = 0;
    TILES.clear(); tileBytes = 0; TILES.set(key, c); tileBytes = w * h * 4;
  }
  return c;
}
/** The cached atlas tile under key, or undefined (per-frame painters check it before building a closure). */
export const tilePeek = (key) => TILES.get(key);
/** Bytes held by terrain atlas tiles (render stats). */
export const tileMemory = () => tileBytes;

/** Hollow rim colours (index = SP.rimIndex): Hollow violet, Warden pink, other elites ember. */
export const RIM_PX = Object.freeze([PAL.violet, '#e88cf0', PAL.orange]);
/**
 * The emissive rim of a native sprite: a 1 px glow ring around its silhouette (outside it) and its
 * brightest pixels (eyes) lit. Returned record: { c, w, h, m } in world units, m = the margin.
 */
export function pixelRim(sp, ci = 0) {
  const r = sp.rim && sp.rim[ci];
  if (r) return r;
  const src = sp.c, w = src.width, h = src.height;
  const c = document.createElement('canvas');
  c.width = w + 2; c.height = h + 2;
  const g = c.getContext('2d');
  let data = null;
  try { data = src.getContext('2d').getImageData(0, 0, w, h).data; } catch (_) { data = null; }
  const out = { c, w: (w + 2) * NPX, h: (h + 2) * NPX, m: NPX, t: 0 };
  if (!sp.rim) sp.rim = [null, null, null];
  sp.rim[ci] = out;
  if (!data) return out;
  const img = g.createImageData(w + 2, h + 2), d = img.data;
  // opaque pixels, except the dithered contact shadow (ink pixels with no opaque 4-neighbour): the rim
  // follows the creature's outline, not the checker of its shadow
  const op = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) op[i] = data[i * 4 + 3] > 96 ? 1 : 0;
  const [ir, ig, ib] = rgbOf(PAL.ink);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!op[i] || data[i * 4] !== ir || data[i * 4 + 1] !== ig || data[i * 4 + 2] !== ib) continue;
    if (!((x > 0 && op[i - 1]) || (x < w - 1 && op[i + 1]) || (y > 0 && op[i - w]) || (y < h - 1 && op[i + w]))) op[i] = 2;
  }
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && op[y * w + x] === 1;
  const [rr, rg, rb] = rgbOf(RIM_PX[ci] || RIM_PX[0]);
  const [er, eg, eb] = rgbOf(PAL.bone);
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    const o = ((y + 1) * (w + 2) + x + 1) * 4;
    if (on(x, y)) {
      const k = (y * w + x) * 4, lum = 0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2];
      if (lum > 190) { d[o] = er; d[o + 1] = eg; d[o + 2] = eb; d[o + 3] = 255; }
      continue;
    }
    // the outline pixel ring (the sprite's own ink outline) glows; one more px out, faintly
    if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) { d[o] = rr; d[o + 1] = rg; d[o + 2] = rb; d[o + 3] = 150; }
  }
  g.putImageData(img, 0, 0);
  return out;
}
