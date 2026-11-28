// The pixel FX sheet (owner D; EMBERCROWN-WORLD.md 7.2 item 1, G19). Every cosmetic particle frame is
// drawn here once, as a grid of shade levels, then baked per tint into one small sheet canvas that
// js/engine/particles.js draws from with drawImage only: no arc, ellipse, gradient, blur, filter or
// text call per frame. Floating numbers come from the 5 x 7 glyphs of the same sheet.
//
// Frames are grids of levels: 0 clear, 1 shade, 2 body, 3 light (lit from the top left), 4 ink (the
// outline, always PAL.ink). Fading is baked as Bayer dither density (the "alphas"), not globalAlpha.
// A tint is three palette colours [shade, body, light]; any colour asked for snaps to the palette.
//
// Pure (node tests and tools):
//   fxLayout()           (built once, on first call) { frames: [{ name, w, h, ax, ay, px: Uint8Array }], rects: Int16Array(n * 6)
//                        [sx, sy, w, h, ax, ay] native px, index: { frame name: i }, sw, sh }
//   fxTint(color)        tint id (a small int, cached) of a RAMP name, a PAL name or any '#rgb' / '#rrggbb'
//   tintColours(id)      [shade, body, light] palette hexes of a tint
//   GLYPH_ADV, GLYPH_H   the glyph advance and height (native px); glyphFrame(charCode) -> frame index or -1
// Browser (or a canvas factory set with setFxCanvasFactory):
//   fxSheet(id, m)       the tint's sheet canvas at m canvas px per art px (baked on first call, cached;
//                        scaled sheets share a 12 MB cap and are rebaked after a drop)
//   fxText(text, id, m)  a cached canvas of a floating number in glyph frames (48 strings per tint and m)
//   fxMemory()           bytes held by the baked sheets
//   fxArtSamples(doc)    contact-sheet figures (every frame in four tints at 4x, the glyph strip)
import { PAL, RAMP, BAYER4, rgbOf } from './palette.js';

const L = { S: 1, B: 2, H: 3, K: 4 };
const ALPHA = [16, 11, 6]; // dither density of the three baked alphas (of 16)
const dith = (x, y, lv) => lv >= 16 || BAYER4[((y & 3) << 2) | (x & 3)] < lv;

// ---- frame painters (pure: grids of levels) ----------------------------------------------------------
function grid(w, h) { return { w, h, px: new Uint8Array(w * h) }; }
const put = (g, x, y, v) => { if (x >= 0 && y >= 0 && x < g.w && y < g.h) g.px[y * g.w + x] = v; };

/** A shaded disc (radius r native px), lit from the top left, thinned by dither level a. */
function disc(r, a) {
  const n = Math.ceil(r * 2), g = grid(n, n), c = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c;
    if (dx * dx + dy * dy > r * r || !dith(x, y, a)) continue;
    const lit = dx + dy; // < 0 towards the top left
    put(g, x, y, lit < -r * 0.55 ? L.H : lit > r * 0.6 ? L.S : L.B);
  }
  return g;
}
/** A square n x n with a lit corner (sparks, embers, chips). */
function square(n) {
  const g = grid(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) put(g, x, y, x + y === 0 ? L.H : x + y >= 2 * n - 2 && n > 2 ? L.S : L.B);
  if (n === 1) g.px[0] = L.H;
  return g;
}
/** The 3 x 3 star of a big spark or a flake: a light centre and body arms. */
function star() { const g = grid(3, 3); put(g, 1, 0, L.B); put(g, 0, 1, L.B); put(g, 1, 1, L.H); put(g, 2, 1, L.B); put(g, 1, 2, L.B); return g; }
/** A rock chip: an irregular 3 x 2 with its shade underneath. */
function chip() { const g = grid(3, 2); put(g, 0, 0, L.H); put(g, 1, 0, L.B); put(g, 0, 1, L.B); put(g, 1, 1, L.S); put(g, 2, 1, L.S); return g; }
/** A falling drop: 2 x 4, a light head, the body, a dark tail. */
function drop() { const g = grid(2, 4); put(g, 0, 0, L.H); put(g, 0, 1, L.H); put(g, 1, 1, L.B); put(g, 0, 2, L.B); put(g, 1, 2, L.B); put(g, 1, 3, L.S); return g; }
/** The splash crown in three steps: a jump, a crown, scattered beads. */
function splash(step) {
  const g = grid(7, 5);
  if (step === 0) { put(g, 3, 1, L.H); put(g, 3, 2, L.B); put(g, 2, 3, L.B); put(g, 4, 3, L.B); put(g, 2, 4, L.S); put(g, 3, 4, L.S); put(g, 4, 4, L.S); }
  else if (step === 1) { put(g, 1, 1, L.H); put(g, 5, 1, L.H); put(g, 2, 2, L.B); put(g, 4, 2, L.B); put(g, 1, 3, L.B); put(g, 5, 3, L.B); for (let x = 1; x <= 5; x++) put(g, x, 4, L.S); }
  else { put(g, 0, 0, L.H); put(g, 6, 0, L.H); put(g, 1, 2, L.B); put(g, 5, 2, L.B); put(g, 0, 4, L.S); put(g, 6, 4, L.S); put(g, 3, 4, L.S); }
  return g;
}
/** A 1 px ring (an ellipse rx x rx / 2): light on top, body at the sides, shade below; dithered at a. */
function ripple(rx, a) {
  const ry = Math.max(1, Math.round(rx / 2)), w = rx * 2 + 1, h = ry * 2 + 1, g = grid(w, h);
  const steps = Math.max(16, rx * 10);
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2, x = Math.round(rx + Math.cos(t) * rx), y = Math.round(ry + Math.sin(t) * ry);
    if (!dith(x, y, a)) continue;
    put(g, x, y, y < ry - ry * 0.4 ? L.H : y > ry + ry * 0.4 ? L.S : L.B);
  }
  return g;
}
/** Leaves in four turns (0, 45, 90, 135 degrees) and petals in two, drawn by hand: H light, B body, S shade. */
const LEAF = [
  ['.HB..', 'HBBBS', '..BS.'],
  ['...BS', '..BBS', '.HBB.', 'HB...'],
  ['.H.', 'HB.', 'BB.', 'BBS', '.S.'],
  ['HB...', '.HBB.', '..BBS', '...BS'],
];
const PETAL = [['HB', 'BS'], ['HBS', '.S.']];
function rows(r) {
  const g = grid(r[0].length, r.length);
  r.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch !== '.') put(g, x, y, ch === 'H' ? L.H : ch === 'S' ? L.S : L.B); } });
  return g;
}
/** A puddle decal (an ellipse rx x ry), the rim lit on top, thinned by dither level a. */
function puddle(rx, ry, a) {
  const w = rx * 2, h = ry * 2, g = grid(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - rx) / rx, dy = (y + 0.5 - ry) / ry, d = dx * dx + dy * dy;
    if (d > 1 || !dith(x, y, a)) continue;
    put(g, x, y, d > 0.55 && dy < 0 ? L.B : d < 0.25 && dx < 0 ? L.H : L.S);
  }
  return g;
}
/** A footprint (left or right): sole and heel in shade, thinned by dither level a. */
function foot(right, a) {
  const g = grid(3, 4), pts = right ? [[1, 0], [2, 0], [1, 1], [2, 1], [2, 3]] : [[0, 0], [1, 0], [0, 1], [1, 1], [0, 3]];
  for (const [x, y] of pts) if (dith(x + (right ? 1 : 0), y, a)) put(g, x, y, L.S);
  if (!g.px.some((v) => v)) put(g, right ? 1 : 0, 0, L.S);
  return g;
}
/** A floating mote: one light pixel, or a soft 2 x 2 (the twinkle). */
function mote(big) { const g = grid(2, 2); put(g, 0, 0, L.H); if (big) { put(g, 1, 0, L.B); put(g, 0, 1, L.B); } return g; }

// The 5 x 7 glyphs of floating numbers (our own letterforms), outlined in ink into 7 x 9 cells.
const GLYPHS = {
  '0': '.###.#...##..###.#.###..##...#.###.', '1': '..#...##....#....#....#....#...###.',
  '2': '.###.#...#....#...#...#...#...#####', '3': '####.....#....#.###.....#....#####.',
  '4': '...#...##..#.#.#..#.#####...#....#.', '5': '######....####.....#....##...#.###.',
  '6': '..##..#...#....####.#...##...#.###.', '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.', '9': '.###.#...##...#.####....#...#..##..',
  '+': '.......#....#..#####..#....#.......', '-': '...............#####...............',
  '%': '##..###..#...#...#...#...#..###..##', 'x': '..........#...#.#.#...#...#.#.#...#',
  '.': '.........................##...##...', '!': '..#....#....#....#....#.........#..',
  '?': '.###.#...#....#...#...#.........#..', '/': '....#....#...#...#...#...#....#....',
};
export const GLYPH_CHARS = Object.freeze(Object.keys(GLYPHS));
export const GLYPH_ADV = 6, GLYPH_H = 9;
function glyph(ch) {
  const src = GLYPHS[ch], g = grid(7, 9);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) if (src[y * 5 + x] === '#') put(g, x + 1, y + 1, y < 3 ? L.H : L.B);
  const o = g.px.slice();
  for (let y = 0; y < 9; y++) for (let x = 0; x < 7; x++) {
    if (o[y * 7 + x]) continue;
    let near = false;
    for (let j = -1; j <= 1 && !near; j++) for (let i = -1; i <= 1; i++) { const u = x + i, v = y + j; if (u >= 0 && v >= 0 && u < 7 && v < 9 && o[v * 7 + u] && o[v * 7 + u] !== L.K) { near = true; break; } }
    if (near) g.px[y * 7 + x] = L.K;
  }
  return g;
}

// Frame list: [name, painter, ax, ay] with the anchor in native px (default: the centre).
const PUFF_R = [2, 3.5, 5];
const RIPPLE_RX = [2, 3, 5, 7, 10, 14];
function frameDefs() {
  const d = [];
  for (let s = 0; s < 3; s++) for (let a = 0; a < 3; a++) d.push([`puff${s}a${a}`, disc(PUFF_R[s], ALPHA[a])]);
  for (let n = 1; n <= 3; n++) d.push([`sq${n}`, square(n)]);
  d.push(['star', star()], ['chip', chip()], ['drop', drop()]);
  for (let k = 0; k < 3; k++) d.push([`splash${k}`, splash(k)]);
  for (let k = 0; k < RIPPLE_RX.length; k++) d.push([`ripple${k}`, ripple(RIPPLE_RX[k], 16)]);
  d.push(['ripple-fade', ripple(RIPPLE_RX[RIPPLE_RX.length - 1], ALPHA[2])]);
  for (let k = 0; k < 4; k++) d.push([`leaf${k}`, rows(LEAF[k])]);
  for (let k = 0; k < 2; k++) d.push([`petal${k}`, rows(PETAL[k])]);
  d.push(['flake0', square(1)], ['flake1', star()], ['mote0', mote(false)], ['mote1', mote(true)]);
  for (let s = 0; s < 2; s++) for (let a = 0; a < 3; a++) d.push([`puddle${s}a${a}`, s ? puddle(6, 2, ALPHA[a]) : puddle(4, 2, ALPHA[a])]);
  for (let r = 0; r < 2; r++) for (let a = 0; a < 3; a++) d.push([`foot${r ? 'R' : 'L'}a${a}`, foot(!!r, ALPHA[a])]);
  for (const ch of GLYPH_CHARS) d.push([`glyph:${ch}`, glyph(ch), 0, 0]);
  return d;
}
export const FX_SHEET_W = 80; // sheet width (native px)

let LAYOUT = null;
/** The frame grids and their packed rects (shelf packing, tallest first, 1 px gutters). Built once. */
export function fxLayout() {
  if (LAYOUT) return LAYOUT;
  const defs = frameDefs(), frames = [], rects = new Int16Array(defs.length * 6), index = {};
  defs.forEach(([name, g, ax, ay], i) => { frames.push({ name, w: g.w, h: g.h, ax: ax ?? (g.w >> 1), ay: ay ?? (g.h >> 1), px: g.px }); index[name] = i; });
  const order = frames.map((f, i) => i).sort((a, b) => frames[b].h - frames[a].h || frames[b].w - frames[a].w || a - b);
  let x = 0, y = 0, row = 0;
  for (const i of order) {
    const f = frames[i];
    if (x + f.w > FX_SHEET_W) { x = 0; y += row + 1; row = 0; }
    rects.set([x, y, f.w, f.h, f.ax, f.ay], i * 6);
    x += f.w + 1; row = Math.max(row, f.h);
  }
  LAYOUT = { frames, rects, index: Object.freeze(index), sw: FX_SHEET_W, sh: y + row };
  return LAYOUT;
}
const GLYPH_OF = new Int16Array(128).fill(-1);
/** The glyph frame of a char code, or -1 (drawn as a space). */
export function glyphFrame(code) {
  if (GLYPH_OF[48] < 0) { const ix = fxLayout().index; for (const ch of GLYPH_CHARS) GLYPH_OF[ch.charCodeAt(0)] = ix[`glyph:${ch}`]; GLYPH_OF[88] = GLYPH_OF[120]; }
  return code < 128 ? GLYPH_OF[code] : -1;
}

// ---- tints ------------------------------------------------------------------------------------------
const PAL_HEX = Object.values(PAL);
const RAMPS = Object.entries(RAMP);
const TINTS = [];          // id -> [shade, body, light]
const TINT_OF = new Map(); // asked colour string -> id
const TRIPLE = new Map();  // 'a|b|c' -> id
function nearestPal(hex) {
  const [r, g, b] = rgbOf(hex);
  let best = PAL.bone, bd = Infinity;
  for (const c of PAL_HEX) { const [r2, g2, b2] = rgbOf(c), d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2; if (d < bd) { bd = d; best = c; } }
  return best;
}
function tripleOf(color) {
  if (RAMP[color]) { const r = RAMP[color]; return [r[1], r[2], r[3]]; }
  let hex = PAL[color] || null;
  if (!hex && typeof color === 'string' && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) {
    const c = color.toLowerCase();
    hex = nearestPal(c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c);
  }
  if (!hex) hex = PAL.bone;
  // the ramp that holds the colour nearest its middle gives the shade and the light
  let pick = null, pi = -1;
  for (const [, r] of RAMPS) {
    const i = r.indexOf(hex);
    if (i < 0) continue;
    if (!pick || Math.abs(i - 1.5) < Math.abs(pi - 1.5)) { pick = r; pi = i; }
  }
  if (!pick) return [hex, hex, hex];
  return [pick[Math.max(0, pi - 1)], hex, pick[Math.min(pick.length - 1, pi + 1)]];
}
/** The tint id of a colour (cached by the colour string: a repeat call is one Map lookup). */
export function fxTint(color) {
  let id = TINT_OF.get(color);
  if (id !== undefined) return id;
  const t = tripleOf(color), k = t.join('|');
  id = TRIPLE.get(k);
  if (id === undefined) { id = TINTS.length; TINTS.push(Object.freeze(t)); TRIPLE.set(k, id); }
  TINT_OF.set(color, id);
  return id;
}
export const tintColours = (id) => TINTS[id] || null;

// ---- bake (browser) ---------------------------------------------------------------------------------
let makeCanvas = null;
/** Tools: a canvas factory (w, h) -> canvas-like, for node benches. */
export function setFxCanvasFactory(fn) { makeCanvas = fn; }
function newCanvas(w, h) {
  if (makeCanvas) return makeCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
const SHEETS = [];   // tint id -> the native sheet (1 canvas px per art px)
let SCALED = [];     // m -> tint id -> the sheet at m canvas px per art px (drawn 1:1 in device px)
let TEXTS = [];      // m -> tint id -> Map(text -> canvas): cached floating-number strings
let bytes = 0, scaledBytes = 0;
const SCALED_CAP = 12 * 1048576; // scaled sheets and strings past this are dropped and rebaked on demand
function paintNative(c, t) {
  const lay = fxLayout(), g = c.getContext('2d');
  if (!g) return;
  const cols = [null, t[0], t[1], t[2], PAL.ink];
  g.imageSmoothingEnabled = false;
  lay.frames.forEach((f, i) => {
    const sx = lay.rects[i * 6], sy = lay.rects[i * 6 + 1];
    for (let v = 1; v <= 4; v++) {
      g.fillStyle = cols[v];
      for (let y = 0; y < f.h; y++) {
        // runs of one level along a row: one fillRect each
        for (let x = 0; x < f.w; x++) {
          if (f.px[y * f.w + x] !== v) continue;
          let e = x; while (e + 1 < f.w && f.px[y * f.w + e + 1] === v) e++;
          g.fillRect(sx + x, sy + y, e - x + 1, 1); x = e;
        }
      }
    }
  });
}
function dropScaled() {
  for (const per of SCALED) if (per) for (const c of per) if (c) c.width = c.height = 0;
  for (const per of TEXTS) if (per) for (const m of per) if (m) for (const c of m.values()) c.width = c.height = 0;
  SCALED = []; TEXTS = []; scaledBytes = 0;
}
/**
 * The sheet of tint id at m canvas px per art px (m = 1: native; baked once per tint and m). Drawn at m =
 * the device px per art px of the view, every frame is a 1:1 copy (no scaling in the hot path).
 */
export function fxSheet(id, m = 1) {
  m = m < 1 ? 1 : m > 16 ? 16 : m | 0;
  let c = SHEETS[id];
  if (!c) {
    const lay = fxLayout();
    c = newCanvas(lay.sw, lay.sh); paintNative(c, TINTS[id] || TINTS[fxTint('pale')]);
    SHEETS[id] = c; bytes += lay.sw * lay.sh * 4;
  }
  if (m === 1) return c;
  const per = SCALED[m] || (SCALED[m] = []);
  let s = per[id];
  if (s) return s;
  const lay = fxLayout(), b = lay.sw * lay.sh * m * m * 4;
  if (scaledBytes + b > SCALED_CAP) { dropScaled(); return fxSheet(id, m); }
  s = newCanvas(lay.sw * m, lay.sh * m);
  const g = s.getContext('2d');
  if (g) { g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, lay.sw, lay.sh, 0, 0, lay.sw * m, lay.sh * m); }
  per[id] = s; scaledBytes += b;
  return s;
}
/**
 * A floating number: the string's glyphs in tint id at m canvas px per art px, as one cached canvas
 * (width = (n * GLYPH_ADV + 1) * m, height = GLYPH_H * m). Unknown characters are spaces.
 */
export function fxText(text, id, m = 1) {
  m = m < 1 ? 1 : m > 16 ? 16 : m | 0;
  const per = TEXTS[m] || (TEXTS[m] = []), map = per[id] || (per[id] = new Map());
  let c = map.get(text);
  if (c) return c;
  const sheet = fxSheet(id, m), lay = fxLayout(), n = text.length, w = (n * GLYPH_ADV + 1) * m, h = GLYPH_H * m;
  if (map.size >= 48) { for (const o of map.values()) { scaledBytes -= o.width * o.height * 4; o.width = o.height = 0; } map.clear(); }
  c = newCanvas(w, h);
  const g = c.getContext('2d');
  if (g) {
    g.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      const f = glyphFrame(text.charCodeAt(i));
      if (f < 0) continue;
      const r = lay.rects;
      g.drawImage(sheet, r[f * 6] * m, r[f * 6 + 1] * m, r[f * 6 + 2] * m, r[f * 6 + 3] * m, i * GLYPH_ADV * m, 0, r[f * 6 + 2] * m, r[f * 6 + 3] * m);
    }
  }
  map.set(text, c); scaledBytes += w * h * 4;
  return c;
}
/** Bytes held by the baked sheets (native and scaled) and cached strings. */
export const fxMemory = () => bytes + scaledBytes;

/** Contact-sheet figures: every frame in four tints at 4x, and a floating number. */
export function fxArtSamples(doc = document) {
  const lay = fxLayout(), figures = [], keys = [];
  const S = 4;
  for (const tint of ['pale', 'fire', 'water', 'grass']) {
    const sheet = fxSheet(fxTint(tint)), c = doc.createElement('canvas');
    c.width = lay.sw * S; c.height = lay.sh * S;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.fillStyle = PAL.night; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(sheet, 0, 0, lay.sw, lay.sh, 0, 0, c.width, c.height);
    c.style.width = `${lay.sw * 2}px`; c.style.imageRendering = 'pixelated';
    const f = doc.createElement('figure');
    f.appendChild(c);
    const cap = doc.createElement('figcaption'); cap.innerHTML = `<b>fx.sheet.${tint}</b> ${lay.frames.length} frames, ${lay.sw} x ${lay.sh} px`;
    f.appendChild(cap); figures.push(f); keys.push(`fx.sheet.${tint}`);
  }
  return { figures, keys };
}
