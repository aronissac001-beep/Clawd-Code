'use strict';
// ============================================================================
// ZONEFALL — shared pixel-art core: palette, helpers and the sprite registry.
// All sprites are drawn in code at ART resolution (1 art pixel = 2 world units,
// one map tile = 16x16 art pixels) and upscaled with nearest-neighbour.
// Art modules (art_chars.js, art_world.js, art_icons.js) push builder
// functions into ART.builders; ART.init() runs them once at startup.
// ============================================================================

const ART = {
  sprites: {},     // name -> { c, w, h, ox, oy }
  builders: [],    // functions run by ART.init()
  ready: false,

  // Base palette: Endesga 32 (cohesive, widely used). Prefer these; derive
  // shades with ART.shade(). Named for readability.
  PAL: {
    rust: '#be4a2f', orange: '#d77643', sand: '#ead4aa', tan: '#e4a672', clay: '#b86f50', brown: '#733e39', darkbrown: '#3e2731',
    blood: '#a22633', red: '#e43b44', flame: '#f77622', gold: '#feae34', yellow: '#fee761',
    lime: '#63c74d', green: '#3e8948', darkgreen: '#265c42', deepgreen: '#193c3e',
    blue: '#124e89', sky: '#0099db', cyan: '#2ce8f5',
    white: '#ffffff', silver: '#c0cbdc', steel: '#8b9bb4', slate: '#5a6988', navy: '#3a4466', ink: '#262b44', black: '#181425',
    pink: '#ff0044', plum: '#68386c', mauve: '#b55088', salmon: '#f6757a', skin: '#e8b796', skin2: '#c28569',
  },

  add(name, canvas, ox = 0, oy = 0) { const s = { c: canvas, w: canvas.width, h: canvas.height, ox, oy }; this.sprites[name] = s; return s; },
  get(name) { return this.sprites[name] || null; },
  has(name) { return !!this.sprites[name]; },

  canvas(w, h) {
    const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g];
  },
  // single pixel / rect (integer coords)
  px(g, x, y, col) { g.fillStyle = col; g.fillRect(x | 0, y | 0, 1, 1); },
  rect(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(x | 0, y | 0, w | 0, h | 0); },
  // pixel line (Bresenham)
  line(g, x0, y0, x1, y1, col) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0; g.fillStyle = col;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (; ;) { g.fillRect(x0, y0, 1, 1); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  },
  // filled pixel circle / ellipse
  disc(g, cx, cy, r, col) { g.fillStyle = col; for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8)); g.fillRect((cx - w) | 0, (cy + y) | 0, w * 2 + 1, 1); } },
  ellipse(g, cx, cy, rx, ry, col) { g.fillStyle = col; for (let y = -ry; y <= ry; y++) { const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry + 0.5)))); g.fillRect((cx - w) | 0, (cy + y) | 0, w * 2 + 1, 1); } },

  // Build a canvas from ASCII rows. Each char maps to a colour in pal;
  // '.' and ' ' are transparent.  ART.ascii(['.aa.','abba'], {a:'#000', b:'#fff'})
  ascii(rows, pal) {
    const h = rows.length, w = Math.max(...rows.map(r => r.length));
    const [c, g] = this.canvas(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x]; if (ch === '.' || ch === ' ') continue;
      const col = pal[ch]; if (!col) continue; g.fillStyle = col; g.fillRect(x, y, 1, 1);
    }
    return c;
  },
  // Return a new canvas (w+2, h+2) with a 1px outline around opaque pixels.
  outline(src, col = '#181425') {
    const [c, g] = this.canvas(src.width + 2, src.height + 2);
    const d = src.getContext('2d').getImageData(0, 0, src.width, src.height).data;
    g.fillStyle = col;
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
      if (d[(y * src.width + x) * 4 + 3] < 128) continue;
      g.fillRect(x, y + 1, 1, 1); g.fillRect(x + 2, y + 1, 1, 1); g.fillRect(x + 1, y, 1, 1); g.fillRect(x + 1, y + 2, 1, 1);
    }
    g.drawImage(src, 1, 1); return c;
  },
  flipX(src) { const [c, g] = this.canvas(src.width, src.height); g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); return c; },
  // Solid-colour silhouette (hit flash etc.)
  silhouette(src, col = '#ffffff') {
    const [c, g] = this.canvas(src.width, src.height); g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c;
  },
  // Replace exact colours: map { '#rrggbb': '#rrggbb' }
  recolor(src, map) {
    const [c, g] = this.canvas(src.width, src.height); g.drawImage(src, 0, 0);
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
    const m = {}; for (const k in map) m[k.toLowerCase()] = this.rgb(map[k]);
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue; const key = '#' + ((1 << 24) | (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]).toString(16).slice(1);
      const t = m[key]; if (t) { d[i] = t[0]; d[i + 1] = t[1]; d[i + 2] = t[2]; }
    }
    g.putImageData(im, 0, 0); return c;
  },
  rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; },
  hex(r, g, b) { return '#' + ((1 << 24) | (Math.round(Math.max(0, Math.min(255, r))) << 16) | (Math.round(Math.max(0, Math.min(255, g))) << 8) | Math.round(Math.max(0, Math.min(255, b)))).toString(16).slice(1); },
  // lighten (amt>0) / darken (amt<0) by a fraction -1..1
  shade(hex, amt) { const [r, g, b] = this.rgb(hex); const t = amt < 0 ? 0 : 255, p = Math.abs(amt); return this.hex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p); },
  mix(a, b, t) { const A = this.rgb(a), B = this.rgb(b); return this.hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); },
  // deterministic RNG for art
  rng(seed) { let a = (seed * 2654435761) >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; },

  init() {
    if (this.ready) return;
    for (const b of this.builders) { try { b(); } catch (e) { console.error('art builder failed', e); } }
    this.ready = true;
  },
};
