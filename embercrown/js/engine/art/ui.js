// UI art (owner D; EMBERCROWN-WORLD.md 7.2 item 2, 8.9): the 9-slice pixel panel frames, the rune rule
// for section headers, and the icon sheet. Everything is drawn in code from the palette (palette.js),
// light from the top left, and baked once: frames to PNG data URLs for CSS `border-image`, icons to one
// canvas for canvas painters (the world map, the minimap). No gradient, arc, blur or filter.
//
// Integer scaling only. A frame is baked at m device px per art px, m = max(1, round(k * dpr)) (k = CSS px
// per art px, default 2), and handed to the CSS with `border-image-slice` = S * m image px and
// `border-width` = S * m / dpr CSS px: every art pixel covers exactly m x m device pixels at any device
// pixel ratio (at dpr 2 or 3 that is S * k CSS px). `border-image-repeat: repeat` keeps the edge tiles
// unscaled (never `round` or `stretch`, which scale by fractions).
//
// Pure (no DOM; node tests and tools):
//   FRAME_KINDS          'stone' (menus, sheets), 'wood' (letters, the Annals: iron-banded), 'plate' (title
//                        and menu buttons, filled), 'plate.hot' (the same plate, lit gold: selected / pressed)
//   frameGrid(kind)      { kind, w, h, slice, tile, fill, px: Array<'#rrggbb' | null> } (row-major, w x h;
//                        the edges are uniform along their length, the detail is in the corners)
//   ruleGrid()           the rune rule's line tile { w, h, px }; runeGrid() the 9 x 9 rune { w, h, px }
//   devScale(k, dpr)     m, the whole device px per art px
//   gridRuns(grid)       nearest-neighbour upscale check helper: the grid scaled by m as a flat colour list
// Browser:
//   bakeGrid(grid, m)    a canvas of the grid at m px per art px (cached by grid and m)
//   bakeFrame(kind, { k, dpr })  { url, slice, width, m, k, dpr, fill } (cached)
//   frameVars({ k, dpr })        CSS custom properties { '--px-frame-stone': 'url(...)', ... } for :root
//   iconSheet({ scale, color })  { canvas, cell, cols, rect(name) -> [x, y, w, h] } every icon in one canvas
//   drawIcon(g, name, x, y, { scale, color })   draw one icon from the sheet (smoothing off)
//   uiArtSamples(doc)    contact-sheet figures (each frame at k 2 and 3, the rule, the icon sheet)
import { PAL } from './palette.js';
import { ICON_NAMES, iconBits } from '../../ui/icons.js';

const P = PAL;
export const FRAME_KINDS = Object.freeze(['stone', 'wood', 'plate', 'plate.hot']);

// ---- frames (pure) ---------------------------------------------------------------------------------
const SPEC = {
  stone: { slice: 6, tile: 4, fill: false },
  wood: { slice: 6, tile: 4, fill: false },
  plate: { slice: 4, tile: 4, fill: true },
  'plate.hot': { slice: 4, tile: 4, fill: true },
};
const GRIDS = new Map();

/** The frame's art grid: w = h = 2 * slice + tile; null = transparent. */
export function frameGrid(kind) {
  let g = GRIDS.get(kind);
  if (g) return g;
  const sp = SPEC[kind];
  if (!sp) throw new Error(`frameGrid: unknown kind '${kind}'`);
  const S = sp.slice, T = sp.tile, W = 2 * S + T, H = W, px = new Array(W * H).fill(null);
  const paint = kind === 'stone' ? stonePx : kind === 'wood' ? woodPx : platePx(kind === 'plate.hot');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    const corner = (x < S || x >= W - S) && (y < S || y >= H - S);
    // chipped outer corners
    if ((x === 0 || x === W - 1) && (y === 0 || y === H - 1)) continue;
    if (d >= S) { if (sp.fill) px[y * W + x] = paint.fill; continue; }
    // the nearest edge: 't' 'l' (lit) or 'b' 'r' (shade)
    const side = d === y ? 't' : d === x ? 'l' : d === H - 1 - y ? 'b' : 'r';
    const lx = x < S ? x : x - (W - S), ly = y < S ? y : y - (H - S); // corner-box local, unmirrored
    px[y * W + x] = corner ? paint.corner(x < S ? lx : lx + S, y < S ? ly : ly + S, S) : paint.edge(d, side === 't' || side === 'l');
  }
  g = Object.freeze({ kind, w: W, h: H, slice: S, tile: T, fill: sp.fill, px: Object.freeze(px) });
  GRIDS.set(kind, g);
  return g;
}

// The edges are uniform along their length: `border-image-repeat: repeat` centres the edge tiles, so on
// an edge of odd device length they start half a device pixel off, and any pattern along the edge would
// be resampled into uneven runs. All the detail (joints, rivets, straps, studs) sits in the corner boxes.

// carved stone: ink, a lit (or shaded) outer bevel, the body with a carved groove, the inner bevel facing
// the content, ink. The corners are square bosses with a gold stud.
const stonePx = {
  edge(d, lit) {
    if (d === 0 || d === 5) return P.ink;
    if (d === 1) return lit ? P.stone1 : P.slate0;
    if (d === 2) return lit ? P.stone0 : P.slate1;                                // groove: shaded lip
    if (d === 3) return lit ? P.slate1 : P.stone0;                                //         and lit lip
    return lit ? P.slate0 : P.stone1;                                             // d 4, the inner bevel
  },
  corner(cx, cy, S) {
    // cx, cy in 0..2S-1: the box is (cx mod S, cy mod S); light stays top-left
    const x = cx % S, y = cy % S;
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1) return P.ink;
    if (x >= 2 && x <= 3 && y >= 2 && y <= 3) return x === 2 && y === 2 ? P.flame : x === 3 && y === 3 ? P.orange : P.gold;
    if (x === 1 && y === 1) return P.mist;
    if (x === 1 || y === 1) return P.stone1;
    if (x === S - 2 || y === S - 2) return P.slate0;
    return P.stone0;
  },
};

// iron-banded wood: planks whose grain runs along the edge, iron corner brackets with a rivet
const woodPx = {
  edge(d, lit) {
    if (d === 0 || d === 5) return P.ink;
    if (d === 1) return lit ? P.umber3 : P.umber1;
    if (d === 2) return P.umber2;
    if (d === 3) return P.umber1;                                                  // the grain line
    return lit ? P.umber0 : P.umber3;                                              // d 4
  },
  corner(cx, cy, S) {
    const x = cx % S, y = cy % S;
    if (x === 0 || y === 0 || x === S - 1 || y === S - 1) return P.ink;
    if (x === 2 && y === 2) return P.mist;                                          // rivet head
    if (x === 3 && y === 3) return P.slate0;
    if (x === 1 || y === 1) return P.slate3;
    if (x === S - 2 || y === S - 2) return P.slate0;
    return P.slate2;
  },
};

// the button plate: ink, a lit bevel top-left and a shaded one bottom-right, a filled body (gold rim when hot)
function platePx(hot) {
  const lit = hot ? P.flame : P.stone1, shade = hot ? P.orange : P.slate0, body = P.stone0;
  const edge = (d, isLit) => (d === 0 ? P.ink : d === 1 ? (isLit ? lit : shade) : d === 2 && hot ? (isLit ? P.gold : P.umber3) : body);
  return {
    fill: body,
    edge: (d, isLit) => edge(d, isLit),
    corner(cx, cy, S) {
      // a plate corner: the same rings as the edges, lit on the top-left half of its diagonal
      const x = cx < S ? cx : 2 * S - 1 - cx, y = cy < S ? cy : 2 * S - 1 - cy, d = Math.min(x, y);
      const isLit = cx < S && cy < S ? true : cx >= S && cy >= S ? false : (cx < S ? x : y) === d;
      return edge(d, isLit);
    },
  };
}

/** The rune rule's line tile (repeat-x): a carved groove, 8 x 3 art px. */
export function ruleGrid() {
  const w = 8, h = 3, px = new Array(w * h).fill(null);
  for (let x = 0; x < w; x++) { px[x] = P.ink; px[w + x] = x === 0 ? P.umber3 : P.stone1; px[2 * w + x] = P.slate0; }
  px[w] = P.gold;
  return { w, h, px };
}
const RUNE = [
  '....k....',
  '...kfk...',
  '..kfgkk..',
  '.kfgkgok.',
  'kfgkgkgok',
  '.kgkgkok.',
  '..kkgok..',
  '...kok...',
  '....k....',
];
/** The 9 x 9 rune set at the inner end of each half of the rule. */
export function runeGrid() {
  const C = { k: P.ink, f: P.flame, g: P.gold, o: P.orange };
  const px = [];
  for (const row of RUNE) for (const ch of row) px.push(C[ch] || null);
  return { w: 9, h: 9, px };
}

/** Whole device px per art px for k CSS px per art px at a device pixel ratio. */
export function devScale(k = 2, dpr = 1) { return Math.max(1, Math.round((+k || 2) * (+dpr || 1))); }

/** The grid upscaled by m (nearest): w*m x h*m colours. The oracle the bake and the screen must equal. */
export function gridRuns(grid, m) {
  const W = grid.w * m, out = new Array(W * grid.h * m);
  for (let y = 0; y < grid.h * m; y++) for (let x = 0; x < W; x++) out[y * W + x] = grid.px[((y / m) | 0) * grid.w + ((x / m) | 0)];
  return out;
}

// ---- bakes (browser) ---------------------------------------------------------------------------------
const CANV = new Map();
function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
/** A canvas of the grid at m px per art px (cached by key). */
export function bakeGrid(grid, m, key = grid.kind || null) {
  const ck = key ? `${key}@${m}` : null;
  if (ck && CANV.has(ck)) return CANV.get(ck);
  const c = canvasOf(grid.w * m, grid.h * m), g = c.getContext('2d');
  let fs = null;
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w;) {
    const col = grid.px[y * grid.w + x];
    let n = 1;
    while (x + n < grid.w && grid.px[y * grid.w + x + n] === col) n++;
    if (col) { if (col !== fs) { g.fillStyle = col; fs = col; } g.fillRect(x * m, y * m, n * m, m); }
    x += n;
  }
  if (ck) CANV.set(ck, c);
  return c;
}

const URLS = new Map();
const urlOf = (c) => `url(${c.toDataURL('image/png')})`;
/** A frame baked for CSS border-image: { url, slice (image px), width (CSS px), m, k, dpr, fill }. */
export function bakeFrame(kind, { k = 2, dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1 } = {}) {
  const m = devScale(k, dpr), key = `${kind}@${m}`;
  const grid = frameGrid(kind);
  let url = URLS.get(key);
  if (!url) { url = urlOf(bakeGrid(grid, m)); URLS.set(key, url); }
  return { url, slice: grid.slice * m, width: +(grid.slice * m / dpr).toFixed(4), m, k, dpr, fill: grid.fill };
}

/** CSS custom properties for :root: per frame kind --px-frame-<kind> (url), -slice (number), -w (px);
 *  the rule --px-rule, --px-rule-w, --px-rule-h, --px-rune, --px-rune-w; and --px-m (device px per art px). */
export function frameVars({ k = 2, dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1 } = {}) {
  const v = {}, m = devScale(k, dpr), css = (n) => `${+(n * m / dpr).toFixed(4)}px`;
  for (const kind of FRAME_KINDS) {
    const f = bakeFrame(kind, { k, dpr }), n = kind.replace('.', '-');
    v[`--px-frame-${n}`] = f.url; v[`--px-frame-${n}-slice`] = `${f.slice}${f.fill ? ' fill' : ''}`; v[`--px-frame-${n}-w`] = `${f.width}px`;
  }
  const rule = ruleGrid(), rune = runeGrid();
  if (!URLS.has(`rule@${m}`)) URLS.set(`rule@${m}`, urlOf(bakeGrid(rule, m, 'rule')));
  if (!URLS.has(`rune@${m}`)) URLS.set(`rune@${m}`, urlOf(bakeGrid(rune, m, 'rune')));
  v['--px-rule'] = URLS.get(`rule@${m}`); v['--px-rule-w'] = css(rule.w); v['--px-rule-h'] = css(rule.h);
  v['--px-rune'] = URLS.get(`rune@${m}`); v['--px-rune-w'] = css(rune.w);
  v['--px-m'] = String(m);
  return v;
}

// ---- the icon sheet ------------------------------------------------------------------------------
const SHEETS = new Map();
/** Every icon in one canvas, 16 x 16 art px each at `scale` px per art px, in `color`. */
export function iconSheet({ scale = 1, color = P.bone, names = ICON_NAMES } = {}) {
  scale = Math.max(1, Math.round(scale));
  const key = `${scale}|${color}|${names === ICON_NAMES ? '*' : names.join(',')}`;
  let sh = SHEETS.get(key);
  if (sh) return sh;
  const cell = 16 * scale, cols = 16, rows = Math.ceil(names.length / cols);
  const c = canvasOf(cols * cell, rows * cell), g = c.getContext('2d');
  g.fillStyle = color;
  const at = new Map();
  names.forEach((n, i) => {
    const ox = (i % cols) * cell, oy = ((i / cols) | 0) * cell, bits = iconBits(n);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16;) {
      if (!((bits[y] >> (15 - x)) & 1)) { x++; continue; }
      let w = 1;
      while (x + w < 16 && ((bits[y] >> (15 - x - w)) & 1)) w++;
      g.fillRect(ox + x * scale, oy + y * scale, w * scale, scale);
      x += w;
    }
    at.set(n, [ox, oy, cell, cell]);
  });
  sh = { canvas: c, cell, cols, scale, color, rect: (n) => at.get(n) || at.get('info') || null };
  SHEETS.set(key, sh);
  return sh;
}
/** Draw one icon from the sheet at (x, y) in the context's units, `scale` px per art px. */
export function drawIcon(g, name, x, y, { scale = 1, color = P.bone } = {}) {
  const sh = iconSheet({ scale, color }), r = sh.rect(name);
  if (!r) return;
  const sm = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(sh.canvas, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]);
  g.imageSmoothingEnabled = sm;
}

// ---- contact sheet -------------------------------------------------------------------------------
/** Figures for the art contact sheet: each frame as a live border-image panel at k 2 and 3, the rune
 *  rule over a header, the native grids at 4x, and the icon sheet. Returns { figures, keys }. */
export function uiArtSamples(doc = document) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1, figures = [], keys = [];
  const fig = (html, cap) => { const f = doc.createElement('figure'); f.innerHTML = `${html}<figcaption>${cap}</figcaption>`; figures.push(f); return f; };
  for (const kind of FRAME_KINDS) {
    for (const k of [2, 3]) {
      const b = bakeFrame(kind, { k, dpr });
      const st = `border:${b.width}px solid transparent;border-image:${b.url} ${b.slice}${b.fill ? ' fill' : ''} / ${b.width}px repeat;image-rendering:pixelated;`
        + `width:${kind.startsWith('plate') ? 132 : 168}px;min-height:${kind.startsWith('plate') ? 24 : 72}px;padding:8px;box-sizing:content-box;color:#f1ead8;font:15px system-ui,sans-serif;`
        + `${b.fill ? '' : 'background:#22202e;background-clip:padding-box;'}display:flex;align-items:center;justify-content:center`;
      const f = fig(`<div class="uiframe" data-kind="${kind}" data-k="${k}" data-m="${b.m}" style="${st}">${kind.startsWith('plate') ? 'Found now' : 'A panel'}</div>`, `<b>ui.frame.${kind}</b> k ${k} (${b.m} dev px / art px)`);
      f.style.background = 'transparent';
    }
    const grid = frameGrid(kind), c = bakeGrid(grid, 4 * Math.max(1, Math.round(dpr)), `${kind}#sheet`);
    c.style.width = `${grid.w * 4}px`; c.style.imageRendering = 'pixelated';
    const f = fig('', `<b>${kind}</b> ${grid.w} x ${grid.h}, slice ${grid.slice}, tile ${grid.tile}`); f.insertBefore(c, f.firstChild);
    keys.push(`ui.frame.${kind}`);
  }
  const v = frameVars({ k: 2, dpr });
  const half = (pos) => `<i style="flex:1;height:${v['--px-rune-w']};image-rendering:pixelated;background:${v['--px-rune']} ${pos} center / ${v['--px-rune-w']} ${v['--px-rune-w']} no-repeat, ${v['--px-rule']} 0 center / ${v['--px-rule-w']} ${v['--px-rule-h']} repeat-x"></i>`;
  const rule = `<div style="display:flex;align-items:center;gap:6px;width:280px;font:600 17px system-ui,sans-serif;color:#f1ead8">${half('right')}<span>Stock</span>${half('left')}</div>`;
  fig(rule, '<b>ui.rule</b> the rune rule of a section header');
  keys.push('ui.rule');
  const sh = iconSheet({ scale: 2 });
  const ic = sh.canvas; ic.style.width = `${ic.width / 2}px`; ic.style.imageRendering = 'pixelated';
  const f = fig('', `<b>ui.iconsheet</b> ${ICON_NAMES.length} icons, ${sh.cols} per row, 2x`); f.insertBefore(ic, f.firstChild);
  keys.push('ui.iconsheet');
  return { figures, keys };
}
