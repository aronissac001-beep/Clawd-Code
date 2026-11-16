'use strict';
// ============================================================================
// ZONEFALL — art module B: ground tiles, roads/floors/water, 3/4-view walls,
// roofs, nature, props & containers, vehicles/monuments, base structures.
// Everything is drawn procedurally at art resolution (tile = 16x16 px).
// Light from the top-left. Deterministic (ART.rng only).
// ============================================================================
(function () {
  const P = ART.PAL;
  const sh = (h, a) => ART.shade(h, a);
  const mix = (a, b, t) => ART.mix(a, b, t);
  const mk = (w, h) => ART.canvas(w, h);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const bayer = (x, y) => (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
  const OUT = '#181425';

  // ---------------------------------------------------------------- pixel buffers
  const _rgb = {};
  const rgbOf = (h) => _rgb[h] || (_rgb[h] = ART.rgb(h));
  // Build a canvas from a per-pixel function returning hex | [hex, alpha0..1] | null
  function fromFn(w, h, fn) {
    const [c, g] = mk(w, h); const im = g.createImageData(w, h); const d = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let col = fn(x, y); if (!col) continue; let a = 1;
      if (Array.isArray(col)) { a = col[1]; col = col[0]; }
      const [r, gg, b] = rgbOf(col); const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = Math.round(a * 255);
    }
    g.putImageData(im, 0, 0); return c;
  }
  // Mutable colour grid (hex strings), converted to canvas at the end
  class Grid {
    constructor(w, h) { this.w = w; this.h = h; this.d = new Array(w * h).fill(null); }
    in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    set(x, y, c) { x |= 0; y |= 0; if (this.in(x, y)) this.d[y * this.w + x] = c; }
    get(x, y) { x |= 0; y |= 0; return this.in(x, y) ? this.d[y * this.w + x] : null; }
    // wrap-around access (seamless textures)
    setW(x, y, c) { x = ((x | 0) % this.w + this.w) % this.w; y = ((y | 0) % this.h + this.h) % this.h; this.d[y * this.w + x] = c; }
    getW(x, y) { x = ((x | 0) % this.w + this.w) % this.w; y = ((y | 0) % this.h + this.h) % this.h; return this.d[y * this.w + x]; }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
    line(x0, y0, x1, y1, c) {
      x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
      for (; ;) { this.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    }
    canvas() { return fromFn(this.w, this.h, (x, y) => this.d[y * this.w + x]); }
  }

  // ---------------------------------------------------------------- noise
  // Periodic (16px) lattice value noise. Lattice points on the tile border
  // (i==0 or j==0) come from a SHARED seed, so any two variants built with the
  // same sharedSeed join continuously at their edges -> seamless mixing.
  function lnoise(sharedSeed, varSeed, cell, borderAmp = 1, period = 16) {
    const n = period / cell, rs = ART.rng(sharedSeed), rv = ART.rng(varSeed), L = [];
    for (let j = 0; j < n; j++) {
      L[j] = []; for (let i = 0; i < n; i++) {
        const s = rs(), v = rv();
        L[j][i] = (i === 0 || j === 0) ? 0.5 + (s - 0.5) * borderAmp : v;
      }
    }
    return (x, y) => {
      const fx = x / cell, fy = y / cell, i0 = Math.floor(fx), j0 = Math.floor(fy);
      let tx = fx - i0, ty = fy - j0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = L[((j0 % n) + n) % n][((i0 % n) + n) % n], b = L[((j0 % n) + n) % n][(((i0 + 1) % n) + n) % n];
      const c = L[(((j0 + 1) % n) + n) % n][((i0 % n) + n) % n], d = L[(((j0 + 1) % n) + n) % n][(((i0 + 1) % n) + n) % n];
      return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    };
  }
  // pick from a ramp with a float 0..1, dithered by t (0..1 jitter)
  const ramp = (R, v) => R[clamp(Math.floor(v * R.length), 0, R.length - 1)];

  // ---------------------------------------------------------------- shape shading
  // mask: Uint8Array (1 solid). Returns Float32Array brightness 0..1 using a
  // rounded bevel from a distance transform plus an optional global gradient.
  function bevel(mask, w, h, depth = 3, opt = {}) {
    const D = new Float32Array(w * h), BIG = 1e6;
    for (let i = 0; i < w * h; i++) D[i] = mask[i] ? BIG : 0;
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : D[y * w + x];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!D[i]) continue;
      D[i] = Math.min(D[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.41, at(x + 1, y - 1) + 1.41);
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!D[i]) continue;
      D[i] = Math.min(D[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.41, at(x - 1, y + 1) + 1.41);
    }
    const H = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) { if (!mask[i]) continue; const t = Math.min(D[i], depth) / depth; H[i] = Math.sqrt(1 - (1 - t) * (1 - t)); }
    const hat = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : H[y * w + x];
    const lx = opt.lx ?? -0.62, ly = opt.ly ?? -0.68, lz = opt.lz ?? 0.55, k = opt.k ?? 1.6;
    const B = new Float32Array(w * h);
    const cy0 = opt.cy ?? h / 2, cx0 = opt.cx ?? w / 2, gy = opt.gy ?? 0.25, gx = opt.gx ?? 0.12;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!mask[i]) continue;
      const dx = (hat(x + 1, y) - hat(x - 1, y)) * k, dy = (hat(x, y + 1) - hat(x, y - 1)) * k;
      let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      let b = nx * lx + ny * ly + nz * lz;
      b += (cy0 - y) / h * gy + (cx0 - x) / w * gx;
      B[i] = b;
    }
    return B;
  }
  // render mask+brightness through a colour ramp (dark..light) with ordered dither
  function shadeMask(mask, w, h, R, opt = {}) {
    const B = bevel(mask, w, h, opt.depth ?? 3, opt);
    const r = ART.rng(opt.seed ?? 7), nz = opt.noise ?? 0.08, dith = opt.dither ?? 0.5;
    const off = opt.offset ?? 0.18, sc = opt.scale ?? 1.25;
    const G = new Grid(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!mask[i]) continue;
      let v = (B[i] - off) * sc + (r() - 0.5) * nz + (bayer(x, y) - 0.5) * dith / R.length;
      G.set(x, y, ramp(R, v));
    }
    return G;
  }
  function maskFromFn(w, h, fn) { const m = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = fn(x, y) ? 1 : 0; return m; }
  // irregular blob mask: ellipse with angular radius noise; flat-ish bottom
  function blobMask(w, h, cx, cy, rx, ry, seed, rough = 0.18, flat = 0) {
    const r = ART.rng(seed), K = 7, amp = []; for (let i = 0; i < K; i++) amp.push((r() - 0.5) * 2 * rough);
    const ph = r() * 6.28;
    return maskFromFn(w, h, (x, y) => {
      let dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (flat && dy > 0) dy *= 1 + flat;
      const a = Math.atan2(dy, dx); let m = 1;
      for (let i = 0; i < K; i++) m += amp[i] * Math.sin(a * (i + 2) + ph * (i + 1)) / (i + 1);
      return dx * dx + dy * dy <= m * m;
    });
  }
  // stamp a Grid onto another (null = transparent)
  function stamp(dst, src, ox, oy) { for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) { const c = src.d[y * src.w + x]; if (c) dst.set(ox + x, oy + y, c); } }
  // outline a Grid -> canvas (w+2,h+2)
  const outlined = (G, col = OUT) => ART.outline(G.canvas(), col);
  // add sprite with bottom-centre anchor (feet) after outline
  function addFoot(name, cnv, oxAdj = 0, oyAdj = 0) { return ART.add(name, cnv, Math.floor(cnv.width / 2) + oxAdj, cnv.height - 1 + oyAdj); }
  // Darken outline pixels selectively: re-tint outline toward a local dark colour on the lower/right, keep top-left lighter
  function selOutline(G, dark, lite) {
    // returns canvas w+2,h+2 ; lit edges get "lite" (if given), others dark
    const W = G.w + 2, Hh = G.h + 2, O = new Grid(W, Hh);
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.get(x, y)) O.set(x + 1, y + 1, G.get(x, y));
    const solid = (x, y) => !!G.get(x - 1, y - 1);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      if (solid(x, y)) continue;
      const n = solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1);
      if (!n) continue;
      O.set(x, y, (lite && (solid(x + 1, y) || solid(x, y + 1)) && !solid(x - 1, y) && !solid(x, y - 1)) ? lite : dark);
    }
    return O.canvas();
  }

  // ======================================================================
  // GROUND SETS
  // ======================================================================
  const GROUND = {
    forest: {
      seed: 11, R: ['#1b3329', '#20392d', '#254130', '#2b4934', '#315238'], dark: '#16291f', lite: ['#3b6040', '#456b45'], tip: '#517a4c',
      blades: 20, darkBlades: 12,
    },
    village: {
      seed: 23, R: ['#38552f', '#3e5d33', '#456637', '#4c6f3b', '#53783f'], dark: '#2e4728', lite: ['#5b8245', '#678e4c'], tip: '#76995a',
      blades: 15, darkBlades: 9,
      soil: ['#4d3c2c', '#5a4632', '#665139', '#725c42'],
    },
    dry: {
      seed: 37, R: ['#5d5832', '#665f36', '#6f673b', '#787040', '#817845'], dark: '#4d482a', lite: ['#857c4b', '#918753'], tip: '#9f955f',
      blades: 13, darkBlades: 9,
      soil: ['#5e4c35', '#6a573d', '#776345', '#836e4e'],
    },
    gravel: {
      seed: 53, R: ['#4a4237', '#50483c', '#564d41', '#5c5346', '#62594b'], dark: '#3c352c', lite: ['#766c5c', '#857b69'], tip: '#958b78',
      blades: 0, darkBlades: 0,
    },
    ash: {
      seed: 71, R: ['#47464a', '#4d4c50', '#535256', '#59585b', '#5f5e61'], dark: '#3a393e', lite: ['#69686a', '#747273'], tip: '#7f7d7c',
      blades: 0, darkBlades: 0,
    },
    base: {
      seed: 89, R: ['#3b6334', '#416b38', '#47733c', '#4e7b40', '#558445'], dark: '#33562e', lite: ['#5f8e4b', '#6b9952'], tip: '#7aa55c',
      blades: 17, darkBlades: 8,
    },
  };
  const groundCache = {};

  function grassBlade(G, r, def, x, y) {
    // 2-3px blade: dark root, mid, light tip; slight lean
    const lean = r() < 0.3 ? (r() < 0.5 ? -1 : 1) : 0, tall = r() < 0.45;
    G.set(x, y, def.lite[0]);
    G.set(x + (tall ? 0 : lean), y - 1, def.lite[1]);
    if (tall) G.set(x + lean, y - 2, def.tip);
  }
  function pebble(G, r, x, y, base, lite, dark, big) {
    if (big) { G.set(x, y, lite); G.set(x + 1, y, base); G.set(x, y + 1, base); G.set(x + 1, y + 1, sh(base, -0.12)); G.set(x, y + 2, dark); G.set(x + 1, y + 2, dark); }
    else { G.set(x, y, r() < 0.5 ? lite : base); G.set(x, y + 1, dark); }
  }
  // interior-only blob (never crosses the tile edge)
  function blob(G, r, cx, cy, rx, ry, colFn) {
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy + (r() - 0.5) * 0.45;
      if (d < 1) G.set(x, y, colFn(x, y, d));
    }
  }

  function tuft(G, r, def, x, y) {
    // small grass tuft: two/three light blades over a dark root pixel
    const k = r();
    G.set(x, y + 1, def.dark);
    if (k < 0.4) { G.set(x - 1, y, def.lite[0]); G.set(x + 1, y, def.lite[0]); G.set(x, y - 1, def.lite[1]); G.set(x, y, def.R[3]); }
    else if (k < 0.7) { G.set(x, y, def.lite[0]); G.set(x, y - 1, def.lite[1]); if (r() < 0.6) G.set(x + 1, y - 2, def.tip); }
    else { G.set(x, y, def.lite[0]); G.set(x + 1, y - 1, def.lite[1]); G.set(x - 1, y - 1, def.lite[0]); }
  }
  function buildGroundTile(name, v) {
    const def = GROUND[name], r = ART.rng(def.seed * 977 + v * 131 + 5), G = new Grid(16, 16);
    const nA = lnoise(def.seed, def.seed * 31 + v * 7 + 3, 4, 0.3);
    const nB = lnoise(def.seed + 1, def.seed * 17 + v * 13 + 9, 8, 0.3);
    const R = def.R, mid = [R[1], R[2], R[3]];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const f = nA(x, y) * 0.5 + nB(x, y) * 0.5;
      G.set(x, y, ramp(mid, (f - 0.5) * 1.25 + 0.5 + (r() - 0.5) * 0.34));
    }
    const ix = () => 2 + (r() * 12) | 0, iy = () => 3 + (r() * 11) | 0;
    // soil specks & occasional patch (fully inside the tile)
    if (def.soil) {
      const S = def.soil;
      const specks = name === 'dry' ? 5 : 1;
      for (let k = 0; k < specks; k++) { const x = 1 + (r() * 14) | 0, y = 1 + (r() * 14) | 0; G.set(x, y, S[1]); if (r() < 0.6) G.set(x + 1, y, S[2]); if (r() < 0.4) G.set(x, y + 1, S[0]); }
      const patch = name === 'dry' ? [1, 4, 6].includes(v) : [1, 5].includes(v);
      if (patch) {
        const big = name === 'village' ? 1.25 : 1;
        const rx = (2.6 + r() * 1.8) * big, ry = (1.8 + r() * 1.2) * big;
        const cx = 1.5 + rx + r() * (13 - 2 * rx), cy = 1.5 + ry + r() * (13 - 2 * ry);
        blob(G, r, cx, cy, rx, ry, (x, y, d) => d > 0.72 ? S[0] : ramp(S, 0.55 + (cy - y) / ry * 0.3 + (r() - 0.5) * 0.45));
        for (let k = 0; k < 2; k++) { const px = Math.round(cx + (r() - 0.5) * rx), py = Math.round(cy + (r() - 0.5) * ry); if (px > 1 && px < 14 && py > 1 && py < 14) pebble(G, r, px, py, sh(S[3], 0.12), sh(S[3], 0.3), S[0]); }
      }
    }
    const isSoil = (x, y) => def.soil && def.soil.includes(G.get(x, y));
    // dark gaps between blades
    for (let k = 0; k < def.darkBlades; k++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; if (!isSoil(x, y)) G.set(x, y, r() < 0.6 ? def.dark : R[0]); }
    // blades and tufts
    for (let k = 0; k < def.blades; k++) {
      const x = (r() * 16) | 0, y = (r() * 18) | 0;
      if (isSoil(x, y)) continue;
      if (k % 3 === 0) tuft(G, r, def, x, y); else grassBlade(G, r, def, x, y);
    }
    // per-set details
    if (name === 'forest') {
      const leafC = ['#43402a', '#4f452c', '#3b3a27'];
      for (let k = 0; k < 2; k++) G.set(ix(), iy(), leafC[(r() * 3) | 0]);
      if (v === 2 || v === 6) { // fern
        const x = ix(), y = iy(); const L1 = '#3a6340', L2 = '#4b764a';
        G.set(x, y, L1); G.set(x - 1, y - 1, L2); G.set(x + 1, y - 1, L2); G.set(x - 2, y - 1, L1); G.set(x + 2, y - 1, L1); G.set(x, y - 1, L1); G.set(x, y - 2, L2); G.set(x - 1, y - 2, L1); G.set(x + 1, y - 2, L1); G.set(x, y + 1, def.dark);
      }
      if (v === 4) { const x = ix(), y = iy(); G.set(x, y, '#7b6b58'); G.set(x - 1, y - 1, '#8c3f35'); G.set(x, y - 1, '#a14c3c'); G.set(x, y + 1, def.dark); } // small toadstool
      if (v === 5) { const x = ix(), y = iy(); G.set(x, y, '#4f4231'); G.set(x + 1, y, '#5d4e3a'); G.set(x + 2, y + 1, '#4f4231'); G.set(x - 1, y - 1, '#4f4231'); } // twig
    } else if (name === 'village') {
      if (r() < 0.5) pebble(G, r, ix(), iy(), '#6d6656', '#8a8270', '#3e3a30');
      if (v === 4) { const x = ix(), y = iy(); G.set(x, y, '#d9cf9a'); G.set(x - 1, y, '#c9bd86'); G.set(x + 1, y, '#c9bd86'); G.set(x, y - 1, '#e6dcaa'); G.set(x, y + 1, def.dark); }
    } else if (name === 'dry') {
      if (v === 3 || v === 7) { // dead weed
        const x = ix(), y = iy(); G.set(x, y, '#8a7748'); G.set(x - 1, y - 1, '#a3925c'); G.set(x + 1, y - 1, '#a3925c'); G.set(x, y - 1, '#7a6a40'); G.set(x - 2, y - 2, '#b5a56c'); G.set(x + 2, y - 2, '#b5a56c'); G.set(x, y + 1, def.dark);
      }
      if (r() < 0.4) pebble(G, r, ix(), iy(), '#8f8468', '#aea283', '#4c4530');
    } else if (name === 'gravel') {
      const pc = [['#6c6354', '#887f6c', '#3a342b'], ['#756c5a', '#918774', '#3f382e'], ['#625b50', '#7d766a', '#36302a']];
      const n = 5 + (r() * 4) | 0;
      for (let k = 0; k < n; k++) { const p = pc[(r() * 3) | 0]; pebble(G, r, 1 + (r() * 13) | 0, 2 + (r() * 12) | 0, p[0], p[1], p[2], r() < 0.25); }
      for (let k = 0; k < 6; k++) G.set((r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? def.dark : def.lite[0]);
      if (v === 4) { const x = ix(), y = iy(); G.set(x, y, '#4a6239'); G.set(x - 1, y - 1, '#566f41'); G.set(x + 1, y - 1, '#566f41'); G.set(x, y - 2, '#4a6239'); }
    } else if (name === 'ash') {
      for (let k = 0; k < 8; k++) G.set((r() * 16) | 0, (r() * 16) | 0, r() < 0.55 ? def.dark : def.lite[0]);
      if ([1, 6].includes(v)) {
        const walk = (x, y, ang, steps, depth) => {
          for (let s2 = 0; s2 < steps; s2++) {
            ang += (r() - 0.5) * 1.3;
            const nx = clamp(Math.round(x + Math.cos(ang) * 1.6), 1, 14), ny = clamp(Math.round(y + Math.sin(ang) * 1.6), 1, 14);
            G.line(x, y, nx, ny, '#3a393e'); if (G.get(nx, ny + 1) !== '#3a393e') G.set(nx, ny + 1, def.lite[0]);
            if (depth < 1 && r() < 0.3) walk(nx, ny, ang + (r() < 0.5 ? 1.3 : -1.3), 2 + (r() * 2 | 0), depth + 1);
            x = nx; y = ny;
          }
        };
        walk(4 + (r() * 8 | 0), 4 + (r() * 8 | 0), r() * 6.28, 3 + (r() * 3 | 0), 0);
      }
      if (v === 5) { const x = ix(), y = iy(); G.set(x, y, '#4f5a38'); G.set(x + 1, y - 1, '#5f6c42'); G.set(x - 1, y - 1, '#5f6c42'); G.set(x, y + 1, def.dark); } // sickly weed
      if (v === 7 || v === 2) pebble(G, r, ix(), iy(), '#6a6868', '#838180', '#2f2e33', v === 7);
    } else if (name === 'base') {
      if (v === 2 || v === 5) { // tiny flowers
        const fc = v === 2 ? ['#d8d2b4', '#b0a868'] : ['#a890b4', '#8a7698'];
        for (let k = 0; k < (v === 2 ? 2 : 1); k++) { const x = ix(), y = iy(); G.set(x, y, fc[0]); G.set(x - 1, y, fc[1]); G.set(x + 1, y, fc[1]); G.set(x, y - 1, fc[1]); G.set(x, y + 1, def.dark); }
      }
      if (v === 6) { const x = ix(), y = iy(); G.set(x, y, '#3f6a3a'); G.set(x - 1, y, '#5c8a4c'); G.set(x + 1, y, '#5c8a4c'); G.set(x, y - 1, '#5c8a4c'); G.set(x, y + 1, '#33562e'); } // clover
      if (v === 3) pebble(G, r, ix(), iy(), '#7d7a6c', '#9a978a', '#3b4033');
    }
    return G.canvas();
  }
  ART.groundSet = function (name) {
    if (!GROUND[name]) name = 'forest';
    if (!groundCache[name]) { const a = []; for (let v = 0; v < 8; v++) a.push(buildGroundTile(name, v)); groundCache[name] = a; }
    return groundCache[name];
  };
  ART.GROUND_SETS = Object.keys(GROUND);

  // ======================================================================
  // ROAD / CONCRETE / FLOORS / WATER
  // ======================================================================
  function crack(G, r, x, y, steps, col, lite, dirx = 1) {
    for (let s = 0; s < steps; s++) {
      const nx = clamp(x + dirx * (1 + r() * 1.5), 1, 14), ny = clamp(y + (r() - 0.5) * 2.4, 1, 14);
      G.line(x, y, nx, ny, col); if (lite) G.set(nx, ny + 1, lite);
      if (r() < 0.25) G.set(nx + (r() < 0.5 ? 1 : -1), ny - 1, col);
      x = nx; y = ny;
    }
  }
  function buildRoads() {
    const R = ['#2d2f35', '#32343a', '#37393f', '#3c3e44', '#414349'];
    const mkRoad = (v) => {
      const r = ART.rng(400 + v * 17), G = new Grid(16, 16), n = lnoise(401, 402 + v, 4, 0.3), n2 = lnoise(403, 404 + v, 8, 0.2);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const f = n(x, y) * 0.5 + n2(x, y) * 0.5 + (r() - 0.5) * 0.45;
        G.set(x, y, ramp(R, (f - 0.5) * 1.5 + 0.5));
      }
      for (let k = 0; k < 9; k++) G.set((r() * 16) | 0, (r() * 16) | 0, r() < 0.55 ? '#4a4b50' : '#25262b'); // aggregate
      return { G, r };
    };
    // road0: plain worn
    { const { G, r } = mkRoad(0); for (let k = 0; k < 4; k++) G.set(2 + (r() * 12) | 0, 2 + (r() * 12) | 0, '#47484c'); ART.add('road0', G.canvas()); }
    // road1: cracks
    { const { G, r } = mkRoad(1); crack(G, r, 2, 5, 7, '#1d1e22', '#46474c'); crack(G, r, 9, 9, 3, '#1d1e22', null, -1); ART.add('road1', G.canvas()); }
    // road2: oil stain
    {
      const { G, r } = mkRoad(2);
      blob(G, r, 8, 8.5, 5, 3.6, (x, y, d) => d < 0.35 ? '#1f2024' : d < 0.75 ? '#25262b' : '#2a2b31');
      G.set(6, 7, '#3b3550'); G.set(7, 7, '#33384b'); G.set(9, 9, '#3a3446'); G.set(10, 8, '#2f3a44'); // rainbow sheen
      ART.add('road2', G.canvas());
    }
    // road3: pothole with weeds + patch
    {
      const { G, r } = mkRoad(3);
      blob(G, r, 7, 8, 3.6, 2.6, (x, y, d) => d > 0.65 ? '#26272c' : (y < 8 ? '#1a1b1f' : '#4b4134'));
      G.set(5, 9, '#4a4136'); G.set(8, 9, '#5a4e3e');
      G.set(10, 6, '#3f6236'); G.set(11, 5, '#4f7540'); G.set(10, 5, '#4f7540'); G.set(4, 7, '#3f6236'); G.set(3, 6, '#4f7540');
      crack(G, r, 11, 9, 2, '#1d1e22', '#46474c');
      ART.add('road3', G.canvas());
    }
    // road_line: faded yellow centre dash (horizontal)
    {
      const { G, r } = mkRoad(4);
      for (let x = 2; x < 14; x++) for (let y = 7; y < 9; y++) { const p = r(); if (p < 0.78) G.set(x, y, p < 0.12 ? '#8f7a40' : y === 7 ? '#b39a52' : '#a08946'); }
      ART.add('road_line', G.canvas());
    }
  }

  function buildConcrete() {
    const R = ['#615f5a', '#686660', '#6f6d67', '#76746d', '#7d7b74'];
    for (let v = 0; v < 3; v++) {
      const r = ART.rng(500 + v * 29), G = new Grid(16, 16), n = lnoise(501, 502 + v, 4, 0.3);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) G.set(x, y, ramp(R, (n(x, y) - 0.5) * 1.3 + 0.5 + (r() - 0.5) * 0.4));
      for (let k = 0; k < 8; k++) G.set((r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? '#58564f' : '#86847c');
      // slab seams: lit top/left edge, dark bottom/right joint
      for (let i = 0; i < 16; i++) { G.set(i, 15, '#48463f'); G.set(15, i, '#48463f'); G.set(i, 0, sh(G.get(i, 0), 0.08)); G.set(0, i, sh(G.get(0, i), 0.08)); }
      G.set(15, 15, '#3f3d37');
      if (v === 1) { crack(G, r, 2, 4, 6, '#45433d', '#87857d'); crack(G, r, 6, 11, 3, '#45433d', null); }
      if (v === 2) {
        blob(G, r, 6, 7, 4.5, 3.2, (x, y, d) => d < 0.5 ? '#5a574e' : '#625f56'); // water stain
        for (let k = 0; k < 6; k++) { const x = 9 + (r() * 5) | 0, y = 9 + (r() * 5) | 0; G.set(x, y, r() < 0.5 ? '#55663f' : '#4b5a38'); } // moss in joint corner
        G.set(3, 12, '#6b4a34'); G.set(4, 12, '#76523a'); G.set(4, 13, '#6b4a34'); // rust stain
      }
      ART.add('concrete' + v, G.canvas());
    }
  }

  function buildFloors() {
    const W = ['#3f2c20', '#4d3627', '#5a402e', '#664a35', '#72543c'];
    for (let v = 0; v < 2; v++) {
      const r = ART.rng(600 + v * 41), G = new Grid(16, 16);
      for (let p = 0; p < 4; p++) {
        const y0 = p * 4, tone = (r() - 0.5) * 0.25, joint = ((p * 7 + 3 + v * 5) % 16);
        for (let y = y0; y < y0 + 4; y++) for (let x = 0; x < 16; x++) {
          const ly = y - y0; let c;
          if (ly === 3) c = W[0];
          else { let t = 0.55 + tone + (ly === 0 ? 0.18 : 0) + (r() - 0.5) * 0.08; c = ramp(W, t); }
          G.set(x, y, c);
        }
        // grain streaks
        for (let k = 0; k < 2; k++) { const gx = (r() * 13) | 0, gy = y0 + 1 + ((r() * 2) | 0); for (let i = 0; i < 2 + (r() * 3 | 0); i++) G.set(gx + i, gy, sh(G.get(gx + i, gy), -0.1)); }
        // plank joint + nails
        for (let y = y0; y < y0 + 3; y++) { G.set(joint, y, W[0]); }
        G.set((joint + 1) % 16, y0, W[4]);
        G.set((joint + 2) % 16, y0 + 1, '#3a2a1f');
      }
      if (v === 1) { blob(G, r, 9, 9, 3.5, 2.5, (x, y, d) => d < 0.6 ? sh(G.get(x, y) || W[2], -0.25) : sh(G.get(x, y) || W[2], -0.12)); G.set(4, 5, '#2b2019'); G.set(5, 5, '#2b2019'); G.set(5, 6, '#22190f'); }
      ART.add('floor_wood' + v, G.canvas());
    }
    // linoleum / checker
    {
      const r = ART.rng(650), G = new Grid(16, 16), A = ['#8c8a78', '#959381', '#9d9b88'], B = ['#4f5a52', '#56615a', '#5d6860'];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const ch = ((x >> 3) + (y >> 3)) & 1; G.set(x, y, ramp(ch ? B : A, 0.5 + (r() - 0.5) * 0.7)); }
      for (let k = 0; k < 10; k++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; G.set(x, y, sh(G.get(x, y), -0.18)); }
      ART.add('floor_tile0', G.canvas());
    }
    { // same checker, dirtier: chipped tile, grime and a crack (mixes with floor_tile0)
      const r = ART.rng(660), G = new Grid(16, 16), A = ['#87857a', '#8f8d80', '#979586'], B = ['#4c574f', '#535e56', '#5a655c'];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const ch = ((x >> 3) + (y >> 3)) & 1; G.set(x, y, ramp(ch ? B : A, 0.45 + (r() - 0.5) * 0.7)); }
      for (let y = 10; y < 14; y++) for (let x = 2; x < 6; x++) if (r() < 0.85 - (x - 2) * 0.12 - (y - 10) * 0.05) G.set(x, y, r() < 0.5 ? '#5a574f' : '#4e4b45');
      G.set(2, 9, '#4e4b45'); G.set(3, 9, '#6a675e');
      crack(G, r, 9, 3, 3, '#3f463f', null);
      blob(G, r, 11, 11, 2.6, 2, (x, y) => sh(G.get(x, y), -0.15));
      for (let k = 0; k < 10; k++) { const x = (r() * 16) | 0, y = (r() * 16) | 0; G.set(x, y, sh(G.get(x, y), -0.15)); }
      ART.add('floor_tile1', G.canvas());
    }
  }

  function buildWater() {
    const R = ['#1e3a3c', '#213f41', '#244446', '#27494a', '#2a4e4e'];
    const n = lnoise(700, 701, 4, 1), n2 = lnoise(702, 703, 8, 1);
    const base = new Grid(16, 16), r0 = ART.rng(704);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) base.set(x, y, ramp(R, (n(x, y) * 0.5 + n2(x, y) * 0.5 - 0.5) * 0.7 + 0.5 + (r0() - 0.5) * 0.3));
    for (let f = 0; f < 2; f++) {
      const G = new Grid(16, 16); G.d = base.d.slice(); const r = ART.rng(710);
      // soft ripple glints; frame 1 drifts them 1px and swaps which ones are visible
      const gl = [[2, 3, 3], [9, 5, 2], [4, 10, 2], [11, 12, 3], [7, 14, 2], [12, 1, 2]];
      gl.forEach(([x, y, len], k) => {
        if ((k % 3 === 2) && f === 0) return; if ((k % 3 === 0) && f === 1 && k > 2) return;
        const xx = x + f;
        for (let i = 0; i < len; i++) G.set(xx + i, y, i === 0 ? '#355f5b' : '#3f6b65');
        G.set(xx + len - 1 + (f ? 0 : 0), y - 1, f ? '#2f5653' : null);
      });
      // drifting algae specks
      for (let k = 0; k < 4; k++) { const x = 1 + (r() * 14) | 0, y = 1 + (r() * 14) | 0; G.set(x + f * ((k & 1) ? 1 : 0), y, '#2b4a3c'); }
      G.set(5 + f, 7, '#4f7d75');
      ART.add('water' + f, G.canvas());
    }
    // shore overlay: wet dark edge along the top, foam line, fade
    {
      const r = ART.rng(720);
      ART.add('shore', fromFn(16, 16, (x, y) => {
        const wob = (Math.sin(x * 0.9) + Math.sin(x * 2.3 + 1)) * 0.6;
        if (y === 0) return ['#1a2420', 0.85];
        if (y === 1) return ['#22302a', 0.75];
        if (y === 2 + Math.round(wob * 0.5)) return r() < 0.75 ? ['#9fb8a8', 0.55] : ['#22302a', 0.6];
        if (y < 4) return ['#1d2b27', 0.5];
        if (y < 6) return ['#14201d', 0.28 - (y - 4) * 0.1];
        return null;
      }));
    }
  }

  // ======================================================================
  // WALLS (16x26, anchor (0,10)): top face rows 0..15, front face rows 16..25
  // ======================================================================
  function wallSprite(name, topFn, frontFn, extra) {
    const G = new Grid(16, 26);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) G.set(x, y, topFn(x, y));
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) G.set(x, 16 + y, frontFn(x, y));
    if (extra) extra(G);
    return ART.add(name, G.canvas(), 0, 10);
  }
  // per-pixel deterministic hash noise (tileable: depends on x mod 16)
  const hn = (x, y, s) => { let h = (((x & 15) * 374761393) ^ ((y & 31) * 668265263) ^ (s * 2246822519)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  // vertical AO gradient on front face: 0 at top -> 1 at bottom
  const ao = (y) => y / 9;

  // generic running-bond masonry front face
  function brickFront(B, mortar, lip, lipDark, seed, len = 8, course = 3, tall = 2, var_ = 0.6) {
    return (x, y) => {
      if (y === 0) return hn(x, y, seed) < 0.2 ? sh(lip, -0.08) : lip;
      if (y === 1) return lipDark;
      const yy = y - 2, c = Math.floor(yy / course), w = yy % course;
      if (w === tall) return sh(mortar, -0.12 * ao(y));
      const off = (c & 1) ? len / 2 : 0, bx = ((x + off) % 16 + 16) % 16;
      if (bx % len === 0) return sh(mortar, -0.08 * ao(y));
      const id = Math.floor(bx / len) + c * 7;
      let t = 0.45 + (hn(id, c, seed + 3) - 0.5) * var_ + (w === 0 ? 0.25 : 0) - ao(y) * 0.35 + (hn(x, y, seed + 9) - 0.5) * 0.25;
      if (bx % len === len - 1) t -= 0.2;
      return ramp(B, t);
    };
  }
  function brickTop(B, mortar, seed, len = 8, rowH = 4) {
    return (x, y) => {
      const c = Math.floor(y / rowH), w = y % rowH;
      if (w === rowH - 1) return mortar;
      const off = (c & 1) ? len / 2 : 0, bx = ((x + off) % 16 + 16) % 16;
      if (bx % len === len - 1) return mortar;
      const id = Math.floor(bx / len) + c * 5;
      let t = 0.5 + (hn(id, c, seed) - 0.5) * 0.3 + (w === 0 ? 0.1 : 0) + (hn(x, y, seed + 1) - 0.5) * 0.3;
      return ramp(B, t);
    };
  }

  function buildWalls() {
    // --- brick house
    {
      const B = ['#4f2620', '#5e2e25', '#6c372b', '#7a4131', '#874c38'];
      const BT = ['#553a33', '#5b3f37', '#61443b', '#674940', '#6d4e44'];
      wallSprite('wall_brick', brickTop(BT, '#4a322c', 31, 8, 4), brickFront(B, '#6e5f55', '#b08a70', '#3a211c', 32, 8, 3, 2, 0.6));
    }
    // --- wooden cabin (weathered horizontal planks)
    {
      const T = ['#62553f', '#6a5c45', '#72634b', '#7a6a51', '#827157'];
      const F = ['#3d3027', '#4a3a2e', '#574535', '#64503d', '#715b45'];
      const top = (x, y) => {
        const p = Math.floor(y / 4), w = y % 4; if (w === 3) return '#56493a';
        const j = (p * 11 + 5) % 16; if (x === j) return '#5a4c3c';
        return ramp(T, 0.5 + (hn(p, 0, 40) - 0.5) * 0.4 + (w === 0 ? 0.2 : 0) + (hn(x, y, 41) - 0.5) * 0.35 - (hn(x >> 1, y, 42) < 0.15 ? 0.3 : 0));
      };
      const front = (x, y) => {
        if (y === 0) return '#86715a';
        if (y === 1) return '#2e241c';
        const yy = y - 2, p = Math.floor(yy / 3) + 0, w = yy % 3; // 3px boards: 2 wood + 1 gap
        if (w === 2 || y === 9) return sh('#271e17', 0);
        const j = (p * 9 + 6) % 16;
        if (x === j) return '#2e241c';
        if ((x === ((j + 2) % 16) || x === ((j + 14) % 16)) && w === 0) return '#9a8a72'; // nail heads
        let t = 0.5 + (hn(p, 1, 43) - 0.5) * 0.45 + (w === 0 ? 0.22 : -0.05) - ao(y) * 0.3 + (hn(x, y, 44) - 0.5) * 0.3;
        if (hn(x >> 2, p, 45) < 0.12) t -= 0.25; // knot / rot
        return ramp(F, t);
      };
      wallSprite('wall_plank', top, front);
    }
    // --- concrete (industrial/military)
    const CT = ['#6a6964', '#72716b', '#7a7972', '#828179', '#8a8980'];
    const CF = ['#4a4945', '#53524d', '#5c5b55', '#65645d', '#6e6d65'];
    const concTop = (x, y) => {
      let t = 0.5 + (hn(x, y, 50) - 0.5) * 0.35 + (hn(x >> 2, y >> 2, 51) - 0.5) * 0.3;
      if (hn(x, y, 52) < 0.04) return '#5c5b56';
      return ramp(CT, t);
    };
    const concFront = (x, y) => {
      if (y === 0) return '#9a988e';
      if (y === 1) return '#43423e';
      if (y === 9) return '#393834';
      if (y === 5) return '#4a4944';
      if (x === 0 && y > 1) return '#46453f';
      if (x === 1 && y > 1 && y !== 5) return '#75746c';
      let t = 0.55 + (hn(x, y, 53) - 0.5) * 0.3 - ao(y) * 0.4 + (y === 2 || y === 6 ? 0.15 : 0);
      if ((x === 5 || x === 11) && y > 1 && hn(x, y, 54) < 0.75) t -= 0.3; // rain streaks
      if (x === 12 && y > 5) t -= 0.2;
      return ramp(CF, t);
    };
    wallSprite('wall_concrete', concTop, concFront, (G) => {
      G.set(8, 22, '#6e5544'); G.set(8, 23, '#634a3a'); G.set(9, 23, '#6e5544'); G.set(8, 24, '#5a4434'); // rust drip from bolt
      G.set(8, 21, '#2f2e2b');
    });
    // --- keycard vault doors
    const keyCols = { green: ['#3ee06a', '#1f8a3e'], blue: ['#3cb4ff', '#1a5ea0'], red: ['#ff4a4a', '#a02626'] };
    for (const k in keyCols) {
      const [lit, dim] = keyCols[k];
      wallSprite('keydoor_' + k, (x, y) => {
        // concrete top with a steel door-lintel slot across
        if (y >= 6 && y <= 9) { if (y === 6) return '#9aa3ad'; if (y === 9) return '#2f343c'; return (x & 3) === 0 ? '#555d68' : '#6b7480'; }
        return concTop(x, y);
      }, (x, y) => {
        if (y === 0) return '#9a988e';
        if (y === 1) return '#43423e';
        if (x <= 1 || x >= 14) return x === 1 ? '#75746c' : x === 14 ? '#46453f' : ramp(CF, 0.5 - ao(y) * 0.3);
        // steel door x2..13
        if (x === 2) return '#2b2f36'; if (x === 13) return '#2b2f36';
        if (y === 2) return '#a8b0ba';
        if (y === 9) return '#24272d';
        // hazard chevrons along the bottom
        if (y === 8) return ((x + y) >> 1) & 1 ? '#d9a435' : '#2b2b2b';
        if (x === 7 || x === 8) return x === 7 ? '#3a4049' : '#7c8590'; // central seam
        if (y === 4 && (x === 4 || x === 11)) return '#b0b8c2'; // bolts
        if (y === 6 && (x === 4 || x === 11)) return '#b0b8c2';
        let t = 0.6 - ao(y) * 0.3 + (x < 7 ? 0.08 : -0.05) + (hn(x, y, 60) - 0.5) * 0.15;
        return ramp(['#3a4048', '#464d56', '#535a64', '#5f6772', '#6b737e'], t);
      }, (G) => {
        // card reader on the right frame: housing + coloured light + glow
        G.rect(14, 19, 2, 3, '#24272d'); G.set(14, 19, lit); G.set(15, 19, dim); G.set(14, 20, '#8a929c'); G.set(15, 20, '#5c636c'); G.set(14, 21, '#3a3f46');
        G.set(14, 18, mix(lit, '#6e6d65', 0.6));
      });
    }
    // --- chain-link fence: 16x22, anchor (0,6). Post at x=0..1, top rail, barbed strand
    {
      const G = new Grid(16, 22);
      const meshTop = 4, meshBot = 20;
      for (let y = meshTop; y <= meshBot; y++) for (let x = 0; x < 16; x++) {
        const d1 = (x + y) % 4 === 0, d2 = (x - y + 64) % 4 === 0;
        if (d1 || d2) G.set(x, y, (d1 && d2) ? '#a7aeb5' : (y < 8 ? '#8f969d' : '#7c838a'));
      }
      // top & bottom rail
      for (let x = 0; x < 16; x++) { G.set(x, 3, '#b8bfc6'); G.set(x, 4, '#5e656c'); G.set(x, 20, '#646b72'); G.set(x, 21, '#3b4046'); }
      // barbed wire
      for (let x = 0; x < 16; x++) { const y = 1 + ((x >> 2) & 1); G.set(x, y, '#6f6862'); if ((x & 3) === 1) { G.set(x, y - 1, '#8a827b'); G.set(x, y + 1, '#4f4a45'); } }
      // post
      for (let y = 0; y < 22; y++) { G.set(0, y, y < 2 ? '#c5ccd3' : '#9aa2aa'); G.set(1, y, y < 2 ? '#8a929a' : '#5b6269'); }
      G.set(0, 21, '#3b4046'); G.set(1, 21, '#2c3035');
      // a rust patch and a torn section
      G.set(10, 14, null); G.set(11, 15, null); G.set(10, 16, '#7a4a32'); G.set(9, 13, '#7a4a32');
      ART.add('fence', G.canvas(), 0, 6);
    }
  }

  // ======================================================================
  // ROOFS (16x16 seamless)
  // ======================================================================
  function buildRoofs() {
    // clay barrel tiles: columns of rounded tiles overlapping in 4px courses
    {
      const R = ['#3e1f1c', '#4f2721', '#5f3027', '#6e3a2d', '#7c4534', '#89523e'];
      ART.add('roof_red', fromFn(16, 16, (x, y) => {
        const cx = x & 3, ly = y & 3, row = y >> 2, col = x >> 2;
        if (ly === 3) return cx === 3 ? R[0] : R[1];             // shadow under the overlapping course
        const prof = [0.62, 0.78, 0.5, 0.18][cx];                 // round barrel profile, lit from left
        let t = prof + (ly === 0 ? 0.14 : 0) - ly * 0.05 + (hn(col + row * 4, row, 80) - 0.5) * 0.22 + (hn(x, y, 81) - 0.5) * 0.12;
        if (hn(col, row, 79) < 0.08 && ly < 2) t -= 0.3;          // the odd cracked/missing tile
        return ramp(R, t);
      }));
    }
    // wooden shingles
    {
      const R = ['#3a2a1f', '#4a3626', '#56402d', '#634a34', '#70553b', '#7d6044'];
      ART.add('roof_brown', fromFn(16, 16, (x, y) => {
        const row = y >> 2, ly = y & 3, off = [0, 3, 6, 1][row], bx = ((x + off) % 16 + 16) % 16;
        const edges = [0, 5, 9, 13]; // irregular shingle widths
        if (ly === 3) return R[0];
        if (edges.includes(bx)) return R[1];
        let id = 0; for (const e of edges) if (bx > e) id++;
        let t = 0.55 + (hn(id + row * 4, row, 82) - 0.5) * 0.5 - ly * 0.1 + (hn(x, y, 83) - 0.5) * 0.18 + (edges.includes(bx - 1) ? 0.12 : 0);
        if (ly === 2 && hn(x, y, 84) < 0.4) t -= 0.2;
        return ramp(R, t);
      }));
    }
    // corrugated tin, rusty
    {
      const S = ['#4a4d52', '#5c6066', '#70757b', '#878c91'];
      const RU = ['#5a3322', '#6f4029', '#844e30', '#985d39'];
      const rust = lnoise(85, 86, 4, 1);
      ART.add('roof_tin', fromFn(16, 16, (x, y) => {
        const ph = x & 3, base = [3, 2, 1, 0][ph]; // ridge highlight on left of each corrugation
        if (y === 7) return ph === 0 ? '#9ba0a4' : '#3c3f43'; // sheet overlap seam
        if (y === 8 && (x === 5 || x === 13)) return '#b9bdc0'; // rivets
        // rust: blotches + streaks running down from the seam rivets
        let rr = rust(x, y) + (hn(x, y, 87) - 0.5) * 0.25;
        const streak = (x === 4 || x === 5) && y > 8 && y < 14 - (x & 1) * 2;
        if (streak) rr = Math.max(rr, 0.6 + (y < 11 ? 0.1 : 0));
        if (rr > 0.66) return RU[clamp(base - (rr > 0.76 ? 1 : 0), 0, 3)];
        if (rr > 0.58) return mix(S[base], RU[base], 0.45);
        return S[base];
      }));
    }
    // flat tar roof with gravel and a vent
    {
      const R = ['#2f3033', '#35363a', '#3b3c40', '#424347'];
      const n = lnoise(88, 89, 4, 1), r = ART.rng(90);
      const G = new Grid(16, 16);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) G.set(x, y, ramp(R, (n(x, y) - 0.5) * 1.2 + 0.5 + (r() - 0.5) * 0.5));
      for (let k = 0; k < 14; k++) G.set((r() * 16) | 0, (r() * 16) | 0, r() < 0.5 ? '#55565a' : '#26272a');
      ART.add('roof_flat', G.canvas());
      // optional variant with a mushroom vent (use sparingly)
      const V = new Grid(16, 16); V.d = G.d.slice();
      V.rect(5, 6, 6, 1, '#9aa0a6'); V.rect(5, 7, 6, 2, '#6a6f75'); V.set(10, 7, '#4c5055'); V.set(10, 8, '#4c5055'); V.rect(6, 9, 4, 2, '#565a60'); V.set(9, 9, '#3e4246'); V.set(9, 10, '#3e4246'); V.rect(5, 11, 6, 1, '#1e1f22');
      V.set(5, 6, '#b8bdc2'); V.set(5, 7, '#80858b');
      ART.add('roof_vent', V.canvas());

    }
  }

  // ======================================================================
  // SHARED SHADING HELPERS FOR SPRITES
  // ======================================================================
  const solidAt = (G, x, y) => !!G.get(x, y);
  // rim light: top/left exposed pixels lighter, bottom/right exposed darker
  function rim(G, lite = 0.14, dark = -0.2, only) {
    const src = G.d.slice(), at = (x, y) => (x >= 0 && y >= 0 && x < G.w && y < G.h) ? src[y * G.w + x] : null;
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      const c = src[y * G.w + x]; if (!c || (only && !only(x, y, c))) continue;
      if (!at(x - 1, y) || !at(x, y - 1)) G.set(x, y, sh(c, lite));
      else if (!at(x + 1, y) || !at(x, y + 1)) G.set(x, y, sh(c, dark));
    }
  }
  // leafy clump with sphere shading
  function clump(G, cx, cy, r, R, gfn, seed, opt = {}) {
    const ri = Math.ceil(r) + 1, lx = -0.55, ly = -0.68, lz = 0.5;
    for (let y = -ri; y <= ri; y++) for (let x = -ri; x <= ri; x++) {
      const px = Math.round(cx + x), py = Math.round(cy + y);
      const ang = Math.atan2(y, x), bump = Math.sin(ang * 5 + seed) * 0.45 + (hn(px, py, seed) - 0.5) * 0.7;
      const d = Math.hypot(x, y); if (d > r + bump * 0.6) continue;
      const nx = x / (r + 0.5), ny = y / (r + 0.5), nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      let b = nx * lx + ny * ly + nz * lz;
      let v = 0.26 + b * 0.82 + (gfn ? gfn(px, py) : 0) + (hn(px, py, seed + 7) - 0.5) * (opt.noise ?? 0.22) + (bayer(px, py) - 0.5) * 0.16;
      if (d > r - 1.4 && (x + y) > r * 0.35) v -= 0.3;          // dark lower-right rim separates clumps
      if (hn(px >> 1, py, seed + 3) < 0.08) v += 0.18;           // leaf glints
      G.set(px, py, ramp(R, v));
    }
  }
  // vertical cylinder (barrels, tanks): per-column profile lit from the left
  const cylT = (u) => clamp(1.05 - Math.abs(u - 0.3) * 1.55, 0, 1);

  // ======================================================================
  // NATURE
  // ======================================================================
  const LEAF = {
    pine: ['#0c241d', '#123128', '#1a4032', '#22503a', '#2d6142', '#3c734b'],
    pineB: ['#0e2024', '#142c30', '#1c3a3c', '#254a48', '#305a54', '#3e6b60'],
    oak: ['#132a1c', '#1b3a24', '#254c2c', '#315f35', '#41723f', '#56874b'],
    oakY: ['#262d17', '#353d1d', '#464f24', '#5a622c', '#6f7536', '#878a43'],
    bush: ['#152c1e', '#1e3d26', '#294f2f', '#356239', '#467545', '#5b8a52'],
  };
  const BARK = ['#2a1d16', '#3a2a1f', '#4b3727', '#5d4632', '#6f563e'];
  const TREE_OUT = '#0b1612';

  function trunk(G, cx, y0, y1, hw, flare) {
    for (let y = y0; y <= y1; y++) {
      const f = flare && y > y1 - 3 ? (y - (y1 - 3)) : 0;
      for (let x = cx - hw - f; x <= cx + hw - 1 + f; x++) {
        const u = (x - (cx - hw - f) + 0.5) / (2 * hw + 2 * f);
        let t = cylT(u) * 0.85 + (hn(x, y >> 1, 5) - 0.5) * 0.25;
        if ((x + (y >> 2)) % 3 === 0 && f === 0) t -= 0.15; // bark furrows
        G.set(x, y, ramp(BARK, t));
      }
    }
  }

  function pine(name, seed, w, h, R, tiers) {
    const G = new Grid(w, h), cx = Math.floor(w / 2), r = ART.rng(seed);
    const canopyBot = h - 5;
    trunk(G, cx, canopyBot - 4, h - 1, 2, true);
    const T = [];
    for (let i = 0; i < tiers; i++) {
      const k = i / (tiers - 1);
      const bot = Math.round(lerp(Math.round(h * 0.3), canopyBot, k));
      const top = i === 0 ? 0 : Math.round(bot - (9 + i * 3.2));
      const hw = lerp(4.2, w / 2 - 0.6, k);
      T.push({ top, bot, hw, i });
    }
    for (let ti = tiers - 1; ti >= 0; ti--) {
      const { top, bot, hw, i } = T[ti];
      for (let y = top; y <= bot; y++) for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - (cx + 0.5), rel = (y - top) / Math.max(1, bot - top);
        const half = hw * (0.06 + 0.94 * Math.pow(rel, 1.15));
        if (Math.abs(dx) > half + 0.4) continue;
        const ad = Math.abs(dx) / hw;
        const tooth = (Math.abs(Math.round(dx)) + i) % 4;            // hanging needle points
        const jag = tooth === 0 ? 0 : tooth === 2 ? 2 : 1;
        const yb = bot - Math.round(1.4 * (1 - ad * ad)) - jag + (ad > 0.85 ? 1 : 0);
        if (y > yb) continue;
        let t = 0.62 - (dx / hw) * 0.42 + (rel - 0.55) * 0.5;
        if (ti > 0) { const dd = y - T[ti - 1].bot; if (dd >= -1 && dd <= 2) t -= 0.32 - Math.max(0, dd) * 0.09; } // shadow under the tier above
        if (y >= yb) t -= 0.25;                                      // dark fringe tips
        const st = dx < 0 ? (x + y) % 3 : (x - y + 300) % 3;          // needle strokes slanting outward-down
        if (st === 0) t += 0.1; else if (st === 2) t -= 0.07;
        t += (hn(x, y, seed) - 0.5) * 0.12;
        G.set(x, y, ramp(R, t));
      }
    }
    // snow-free highlight tip
    G.set(cx, 0, R[4]);
    const c = ART.outline(G.canvas(), TREE_OUT);
    ART.add(name, c, cx + 1, c.height - 1);
  }

  function oak(name, seed, w, h, R) {
    const G = new Grid(w, h), r = ART.rng(seed), cx = Math.floor(w / 2);
    trunk(G, cx, Math.floor(h * 0.5), h - 1, 2, true);
    // two limbs reaching into the canopy
    G.line(cx - 1, Math.floor(h * 0.62), cx - 5, Math.floor(h * 0.48), BARK[2]); G.line(cx + 1, Math.floor(h * 0.6), cx + 5, Math.floor(h * 0.47), BARK[1]);
    const CX = cx, CY = Math.floor(h * 0.37), RX = w * 0.42, RY = h * 0.32;
    const gfn = (x, y) => -((x - CX) / RX) * 0.12 - ((y - CY) / RY) * 0.26;
    const cl = [{ x: CX, y: CY, r: Math.min(RX, RY) * 0.72 }];
    for (let i = 0; i < 13; i++) {
      const a = r() * Math.PI * 2, d = 0.45 + r() * 0.55;
      cl.push({ x: CX + Math.cos(a) * (RX - 4.2) * d, y: CY + Math.sin(a) * (RY - 3.8) * d - 0.5, r: 3.4 + r() * 1.9 });
    }
    cl.push({ x: CX - RX * 0.35, y: CY + RY * 0.55, r: 4 }, { x: CX + RX * 0.3, y: CY + RY * 0.6, r: 4.2 }, { x: CX, y: CY - RY * 0.6, r: 4.4 });
    cl.sort((a, b) => b.y - a.y);   // lower clumps first: upper ones overlap them with their dark rims
    cl.forEach((c, i) => clump(G, c.x, c.y, c.r, R, gfn, seed + i * 13));
    // a few dark holes showing branches
    for (let k = 0; k < 3; k++) { const x = Math.round(CX + (r() - 0.5) * RX), y = Math.round(CY + r() * RY * 0.6); if (G.get(x, y)) { G.set(x, y, R[0]); G.set(x + 1, y, BARK[1]); } }
    const c = ART.outline(G.canvas(), TREE_OUT);
    ART.add(name, c, cx + 1, c.height - 1);
  }

  function deadTree(name, seed, w, h) {
    const G = new Grid(w, h), r = ART.rng(seed), M = new Uint8Array(w * h);
    const plot = (x, y, rad) => { for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) if (i * i + j * j <= rad * rad + 0.3) { const X = Math.round(x + i), Y = Math.round(y + j); if (X >= 0 && Y >= 0 && X < w && Y < h) M[Y * w + X] = 1; } };
    const br = (x, y, ang, len, wd, depth) => {
      const steps = Math.ceil(len * 2);
      for (let s = 0; s <= steps; s++) { const t = s / steps; plot(x + Math.cos(ang) * len * t, y + Math.sin(ang) * len * t, Math.max(0, Math.round(lerp(wd, wd * 0.6, t) - 0.3))); }
      const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
      if (depth <= 0 || len < 2.5) return;
      const n = depth > 2 ? 2 : 1 + (r() < 0.6 ? 1 : 0);
      for (let k = 0; k < n; k++) { const sgn = k === 0 ? -1 : 1; br(ex, ey, ang + sgn * (0.35 + r() * 0.5), len * (0.55 + r() * 0.2), wd * 0.6, depth - 1); }
      if (r() < 0.4) br(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5, ang + (r() < 0.5 ? -1 : 1) * (0.8 + r() * 0.3), len * 0.45, wd * 0.5, depth - 2);
    };
    const cx = Math.floor(w / 2);
    br(cx, h - 1, -Math.PI / 2 + (r() - 0.5) * 0.15, h * 0.42, 1.8, 4);
    // roots
    plot(cx - 2, h - 1, 0); plot(cx + 2, h - 1, 0); plot(cx - 3, h - 1, 0);
    const Rr = ['#2c2723', '#3e3833', '#544c45', '#6b625a', '#857b71'];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!M[y * w + x]) continue;
      const L = x > 0 && M[y * w + x - 1], Rt = x < w - 1 && M[y * w + x + 1], U = y > 0 && M[(y - 1) * w + x];
      let t = 0.5 + (hn(x, y, seed) - 0.5) * 0.2;
      if (!L) t += 0.3; else if (!Rt) t -= 0.3; if (!U && L && Rt) t += 0.12;
      G.set(x, y, ramp(Rr, t));
    }
    const c = ART.outline(G.canvas(), '#15110f');
    ART.add(name, c, cx + 1, c.height - 1);
  }

  const ROCK = ['#2a2c32', '#3a3d44', '#4c4f56', '#60636a', '#777a80', '#91949a'];
  function polyMask(w, h, pts) {
    return maskFromFn(w, h, (x, y) => {
      let ins = false; const px = x + 0.5, py = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) ins = !ins;
      }
      return ins;
    });
  }
  function rockGrid(seed, w, h, kind) {
    const r = ART.rng(seed); let mask;
    if (kind === 'angular') {
      const pts = [], n = 7, cx = w / 2, cy = h * 0.58;
      for (let i = 0; i < n; i++) { const a = -Math.PI + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.4; let rx = w / 2 - 0.2, ry = h * 0.58; const k = 0.8 + r() * 0.2; let py = cy + Math.sin(a) * ry * k; py = Math.min(py, h - 0.01); pts.push([cx + Math.cos(a) * rx * k, py]); }
      mask = polyMask(w, h, pts);
    } else mask = blobMask(w, h, w / 2, h * 0.57, w / 2 - 0.4, h * 0.56, seed, 0.12, 0.55);
    const G = shadeMask(mask, w, h, ROCK, { depth: kind === 'angular' ? 5 : 4, seed, noise: 0.12, gy: 0.35, k: kind === 'angular' ? 2.4 : 1.6, offset: 0.15, scale: 1.3 });
    return { G, mask, r };
  }
  function rockDetail(G, mask, r, w, h, moss) {
    // a crack and some moss on the lit top
    let x = Math.round(w * (0.35 + r() * 0.3)), y = Math.round(h * 0.25);
    for (let k = 0; k < 3; k++) { if (mask[y * w + x]) G.set(x, y, ROCK[0]); x += r() < 0.5 ? 1 : 0; y += 1; }
    if (moss) for (let k = 0; k < 8; k++) {
      const mx = Math.round(w * 0.2 + r() * w * 0.5), my = Math.round(h * 0.1 + r() * h * 0.25);
      if (mask[my * w + mx]) G.set(mx, my, r() < 0.5 ? '#3f5a32' : '#4f6c3a');
    }
  }
  function addRock(name, G) { const c = ART.outline(G.canvas(), '#16161c'); ART.add(name, c, Math.floor(c.width / 2), c.height - 1); }

  function buildNature() {
    pine('tree_pine0', 101, 22, 36, LEAF.pine, 4);
    pine('tree_pine1', 102, 20, 33, LEAF.pine, 4);
    pine('tree_pine2', 103, 24, 39, LEAF.pineB, 5);
    oak('tree_oak0', 111, 28, 30, LEAF.oak);
    oak('tree_oak1', 112, 28, 30, LEAF.oakY);
    deadTree('tree_dead0', 121, 20, 28);
    deadTree('tree_dead1', 127, 20, 28);
    // stump: cut top with rings + bark front
    {
      const G = new Grid(8, 5);
      const top = ['#7a5a3c', '#94744e', '#a8885e'];
      for (let x = 1; x < 7; x++) G.set(x, 0, top[1]); for (let x = 0; x < 8; x++) G.set(x, 1, x === 0 || x === 7 ? top[0] : top[2]);
      G.set(3, 1, top[0]); G.set(4, 1, top[1]); G.set(2, 0, top[2]);
      for (let y = 2; y < 5; y++) for (let x = 0; x < 8; x++) G.set(x, y, ramp(BARK, cylT((x + 0.5) / 8) * 0.9 + (hn(x, y, 9) - 0.5) * 0.2));
      G.set(8 - 1, 4, null); G.set(-1, 4, null);
      const c = ART.outline(G.canvas(), '#140e0b'); ART.add('stump', c, 5, c.height - 1);
    }
    // bushes
    const bush = (name, seed, R, berries) => {
      const w = 12, h = 8, G = new Grid(w, h), r = ART.rng(seed);
      const gfn = (x, y) => -((x - 6) / 6) * 0.08 - ((y - 4) / 4) * 0.12;
      const cl = [{ x: 5.8, y: 5.6, r: 2.6 }, { x: 8.4, y: 4.9, r: 3.2 }, { x: 3.4, y: 4.7, r: 3.1 }, { x: 6, y: 3.2, r: 3.3 }];
      cl.forEach((c, i) => clump(G, c.x + (r() - 0.5) * 0.6, c.y, c.r, R, gfn, seed + i * 5, { noise: 0.28 }));
      if (berries) for (let k = 0; k < 5; k++) { const x = 2 + (r() * 8) | 0, y = 2 + (r() * 4) | 0; if (G.get(x, y)) { G.set(x, y, berries[0]); G.set(x - 1, y - 1, G.get(x - 1, y - 1) ? berries[1] : null); } }
      const c = ART.outline(G.canvas(), TREE_OUT); ART.add(name, c, Math.floor(c.width / 2), c.height - 1);
    };
    bush('bush0', 131, LEAF.bush);
    bush('bush1', 132, LEAF.oak, ['#9a2c33', '#c4484a']);
    bush('bush2', 133, LEAF.oakY);
    // tufts (decals, no outline)
    const tuftArt = [
      ['..b..', 'a.b.b', '.aba.', 'ccac.'],
      ['.b...', '.a.b.', 'cabac', '.ccc.'],
      ['b...b', '.b.a.', '.aba.', 'ccacc'],
      ['..d..', '.dad.', 'b.a.b', 'cacac'],
    ];
    const tp = [{ a: '#3e6a3a', b: '#5b8a4c', c: '#1f3a24', d: '#7a9a50' }, { a: '#4b6b34', b: '#6f8c46', c: '#25381e' }, { a: '#6d6a3a', b: '#8c8650', c: '#3c3a22' }, { a: '#3e6a3a', b: '#5b8a4c', c: '#1f3a24', d: '#8aa65a' }];
    tuftArt.forEach((rows, i) => ART.add('tuft' + i, ART.ascii(rows, tp[i]), 2, 3));
    ART.add('flower0', ART.ascii(['.a.', 'aba', '.a.', '.c.'], { a: '#e8dfbf', b: '#e2b23c', c: '#3e6a3a' }), 1, 3);
    ART.add('flower1', ART.ascii(['a.a.', '.b..', 'aca.', '.c..'], { a: '#b35a6e', b: '#d98095', c: '#3e6a3a' }), 1, 3);
    // rocks
    { const { G, mask, r } = rockGrid(141, 16, 11, 'round'); rockDetail(G, mask, r, 16, 11, true); addRock('rock0', G); }
    { const { G, mask, r } = rockGrid(142, 16, 11, 'angular'); rockDetail(G, mask, r, 16, 11, false); addRock('rock1', G); }
    { // cluster of two stones
      const G = new Grid(16, 11);
      const a = rockGrid(143, 10, 9, 'round'), b = rockGrid(144, 8, 6, 'angular');
      stamp(G, a.G, 0, 2); stamp(G, b.G, 8, 5); addRock('rock2', G);
    }
    // ores
    const ore = (name, seed, kind, vein) => {
      const { G, mask, r } = rockGrid(seed, 16, 11, kind);
      const w = 16, h = 11;
      if (vein === 'metal') {
        const V = ['#5e3020', '#8a4a2a', '#b56a38', '#d98d50'];
        for (let k = 0; k < 4; k++) {
          let x = 3 + (r() * 10) | 0, y = 2 + (r() * 5) | 0; const dx = r() < 0.5 ? 1 : -1;
          for (let s = 0; s < 3; s++) { if (mask[y * w + x]) { G.set(x, y, V[2]); if (mask[(y + 1) * w + x]) G.set(x, y + 1, V[0]); if (s === 0 && mask[(y - 1) * w + x]) G.set(x, y - 1, V[3]); } x += dx; y += r() < 0.5 ? 1 : 0; }
        }
        G.set(5, 3, V[3]); G.set(10, 4, V[3]);
      } else {
        const Y = ['#7a6418', '#b89a24', '#e3c844', '#fff08a'];
        const spots = [[4, 2], [9, 1], [11, 4], [6, 5], [3, 6]];
        spots.forEach(([x, y], k) => {
          if (k > 3 && seed % 2) return;
          G.set(x, y, Y[2]); G.set(x + 1, y, Y[1]); G.set(x, y + 1, Y[1]); G.set(x + 1, y + 1, Y[0]); G.set(x, y - 1, Y[3]);
          if (k % 2 === 0) { G.set(x - 1, y, Y[2]); G.set(x - 1, y - 1, Y[3]); }
        });
      }
      addRock(name, G);
    };
    ore('ore_metal0', 151, 'round', 'metal'); ore('ore_metal1', 152, 'angular', 'metal');
    ore('ore_sulfur0', 153, 'round', 'sulfur'); ore('ore_sulfur1', 154, 'angular', 'sulfur');
    // fallen log: horizontal cylinder with a cut end on the left
    {
      const w = 18, h = 6, G = new Grid(w, h);
      for (let y = 0; y < h; y++) for (let x = 2; x < w; x++) {
        let t = 0.9 - (y / (h - 1)) * 0.85 + (hn(x >> 1, y, 161) - 0.5) * 0.25;
        if ((x * 3 + y) % 7 === 0) t -= 0.18;
        G.set(x, y, ramp(BARK, t));
      }
      G.set(w - 1, 0, null); G.set(w - 1, h - 1, null);
      const E = ['#6f5238', '#8e6c4a', '#a8865c'];
      for (let y = 0; y < h; y++) for (let x = 0; x < 3; x++) {
        const d = Math.hypot((x - 1.5) * 1.6, y - 2.5);
        if (d > 3) continue; G.set(x, y, d < 1 ? E[0] : d < 2 ? E[2] : E[1]);
      }
      G.set(0, 0, null); G.set(0, h - 1, null);
      // moss + a stub branch
      G.set(8, 0, '#3f5a32'); G.set(9, 0, '#4f6c3a'); G.set(13, 0, '#3f5a32');
      const c = ART.outline(G.canvas(), '#140e0b'); ART.add('log', c, Math.floor(c.width / 2), c.height - 1);
    }
  }

  // ======================================================================
  // PROPS & CONTAINERS (anchor bottom-centre, outlined)
  // ======================================================================
  // 3/4 box: top face (th rows) + front face (fh rows)
  function box3(G, x, y, w, th, fh, TR, FR, opt = {}) {
    for (let j = 0; j < th; j++) for (let i = 0; i < w; i++) {
      let t = 0.62 + (j === 0 ? 0.18 : 0) + (i === 0 ? 0.1 : 0) - (i === w - 1 ? 0.15 : 0) - j * 0.03 + (hn(x + i, y + j, opt.seed || 3) - 0.5) * (opt.noise ?? 0.12);
      G.set(x + i, y + j, ramp(TR, t));
    }
    for (let j = 0; j < fh; j++) for (let i = 0; i < w; i++) {
      let t = 0.55 - (j / Math.max(1, fh - 1)) * 0.25 + (j === 0 ? 0.2 : 0) + (i === 0 ? 0.08 : 0) - (i === w - 1 ? 0.22 : 0) + (hn(x + i, y + th + j, (opt.seed || 3) + 1) - 0.5) * (opt.noise ?? 0.12);
      G.set(x + i, y + th + j, ramp(FR, t));
    }
  }
  const OUTW = '#1a1210';   // outline for wooden things
  const addProp = (name, G, out = OUT, oyAdj = 0) => { const c = ART.outline(G.canvas(), out); return ART.add(name, c, Math.floor(c.width / 2), c.height - 1 + oyAdj); };
  const WOOD = ['#3b2a1c', '#523a26', '#6a4d32', '#82603f', '#9a754e', '#ad8a5f'];
  const OLIVE = ['#2c3220', '#3a4229', '#4a5433', '#5b663e', '#6e7a4a', '#838f58'];
  const STEEL = ['#23262d', '#30343d', '#3f444e', '#50565f', '#636a73', '#7a8189'];

  function barrel(name, R, opt = {}) {
    const w = 8, h = 12, G = new Grid(w, h);
    const prof = [2, 4, 4, 3, 3, 2, 1, 0];
    for (let y = 2; y < h; y++) for (let x = 0; x < w; x++) {
      let i = prof[x];
      if (y === 4 || y === 8) i = Math.min(4, i + 1); else if (y === 5 || y === 9) i = Math.max(0, i - 1); // rolled ribs
      if (y === h - 1) i = Math.max(0, i - 1);
      G.set(x, y, R[i]);
    }
    // lid: elliptical rim, recessed top, bung
    for (let x = 1; x < w - 1; x++) { G.set(x, 0, x < 4 ? R[4] : R[3]); G.set(x, 2, x < 3 ? R[3] : R[2]); }
    G.set(0, 1, R[3]); G.set(w - 1, 1, R[2]);
    for (let x = 1; x < w - 1; x++) G.set(x, 1, x < 3 ? R[1] : R[2]);
    G.set(5, 1, R[0]); G.set(2, 1, R[0]); G.set(0, 2, R[2]); G.set(w - 1, 2, R[1]);
    if (opt.stripe) for (let y = 6; y < 8; y++) for (let x = 0; x < w; x++) { const on = ((x + y) >> 1) & 1; G.set(x, y, on ? ['#c99a34', '#e8b94a', '#e8b94a', '#d8a83e', '#d8a83e', '#c99a34', '#a87e28', '#8a6620'][x] : '#1e1b19'); }
    // rust & dents
    G.set(6, 3, '#6a3e26'); G.set(6, 6, '#7a4a2c'); G.set(1, 10, '#5e3a24'); G.set(2, 11, '#6a3e26'); G.set(5, 10, '#6a3e26');
    addProp(name, G);
  }

  function crate(name) {
    const w = 12, h = 11, G = new Grid(w, h);
    box3(G, 0, 0, w, 4, 7, WOOD, WOOD, { seed: 41, noise: 0.15 });
    // top planks
    for (let i = 0; i < w; i++) { G.set(i, 1, sh(G.get(i, 1), -0.12)); G.set(i, 3, sh(G.get(i, 3), -0.08)); }
    // front frame + diagonal brace
    const D = WOOD[1], L = WOOD[4];
    for (let i = 0; i < w; i++) { G.set(i, 4, WOOD[5]); G.set(i, 10, WOOD[1]); }
    for (let j = 4; j < 11; j++) { G.set(0, j, j === 4 ? WOOD[5] : WOOD[4]); G.set(1, j, WOOD[2]); G.set(w - 2, j, WOOD[2]); G.set(w - 1, j, WOOD[1]); }
    for (let k = 0; k < 6; k++) { G.set(2 + k * 1.5, 9 - k, L); G.set(3 + k * 1.5, 9 - k, WOOD[3]); }
    G.set(2, 5, D); G.set(9, 9, D); G.set(1, 5, '#2a1d14'); G.set(10, 5, '#2a1d14'); G.set(1, 9, '#2a1d14'); G.set(10, 9, '#2a1d14');
    addProp(name, G, OUTW);
  }

  function smallBox(name, w, th, fh, TR, FR, deco, out = OUT) {
    const G = new Grid(w, th + fh + 1);
    box3(G, 0, 1, w, th, fh, TR, FR, { seed: name.length * 7 });
    deco(G); addProp(name, G, out);
  }

  function car(name, R, seed) {
    const w = 38, h = 22, G = new Grid(w, h), r = ART.rng(seed);
    const GL = ['#141820', '#1f2833', '#2e3b48', '#4a5c6c', '#7d93a3'];
    const rustC = ['#4a2a1c', '#6a3a22', '#8a4e2c'];
    // body side (rows 10..17)
    for (let y = 10; y < 18; y++) for (let x = 1; x < w - 1; x++) {
      if (y >= 16 && (x < 3 || x > w - 4)) continue;
      let t = 0.62 - (y - 10) * 0.07 + (hn(x, y, seed) - 0.5) * 0.1;
      if (y === 10) t += 0.2; if (y === 12) t += 0.14; if (y === 13) t -= 0.08;
      if (x === 19 && y > 10 && y < 16) t -= 0.25; // door seam
      G.set(x, y, ramp(R, t));
    }
    // nose & tail rounding
    G.set(1, 10, null); G.set(w - 2, 10, null);
    // hood top (front, right) & trunk top (left): surfaces seen from above
    for (let y = 7; y < 10; y++) for (let x = 2; x < 10; x++) G.set(x, y, ramp(R, 0.85 - (y - 7) * 0.12 + (x === 2 ? 0.05 : 0)));
    for (let y = 7; y < 10; y++) for (let x = 28; x < w - 2; x++) G.set(x, y, ramp(R, 0.88 - (y - 7) * 0.12 - (x > w - 5 ? 0.12 : 0)));
    G.set(2, 7, null); G.set(w - 3, 7, null);
    // cabin: roof top + windows
    for (let y = 1; y < 4; y++) for (let x = 11; x < 26; x++) G.set(x, y, ramp(R, 0.95 - (y - 1) * 0.1 - (x > 23 ? 0.1 : 0)));
    G.set(11, 1, null); G.set(25, 1, null);
    for (let y = 4; y < 10; y++) {
      const xl = 10 - Math.max(0, y - 6), xr = 26 + Math.max(0, y - 4);
      for (let x = xl; x <= Math.min(xr, 29); x++) {
        let c;
        if (x === xl || y === 4 || x === 18 || x === 19) c = ramp(R, 0.5 - (x === 19 ? 0.15 : 0));   // pillars
        else if (x >= 26) c = GL[clamp(1 + ((x - y) % 5 === 0 ? 2 : 0), 0, 4)];                     // windshield (slanted)
        else c = GL[(x + y) % 6 === 0 ? 3 : y === 5 ? 2 : 1];
        G.set(x, y, c);
      }
    }
    // broken side window: interior + shards
    for (let y = 5; y < 10; y++) for (let x = 12; x < 17; x++) G.set(x, y, y > 7 ? '#2a211c' : '#0f1115');
    G.set(12, 5, GL[4]); G.set(13, 5, GL[3]); G.set(12, 6, GL[3]); G.set(16, 9, GL[3]); G.set(15, 9, GL[2]);
    G.set(13, 8, '#4a3a2e'); G.set(14, 8, '#5a463a'); // seat
    // wheel arches + wheels
    const wheel = (cx) => {
      for (let y = 13; y < 18; y++) for (let x = cx - 4; x <= cx + 4; x++) if (Math.hypot(x - cx, (y - 17) * 1.2) < 4.6) G.set(x, y, '#121014');
      for (let y = 15; y < h; y++) for (let x = cx - 3; x <= cx + 3; x++) {
        const d = Math.hypot(x - cx, (y - 18.2) * 1.1); if (d > 3.6) continue;
        G.set(x, y, d < 1.4 ? (x <= cx ? '#6a6e74' : '#4a4e54') : d < 2.2 ? '#2a2c30' : (x < cx && y < 18 ? '#3a3c40' : '#1d1e22'));
      }
    };
    wheel(8); wheel(29);
    // lights, bumpers, handle
    G.set(w - 2, 11, '#d8d2b0'); G.set(w - 2, 12, '#a8a284'); G.set(1, 11, '#a03a30'); G.set(1, 12, '#6a2620');
    for (let x = w - 4; x < w - 1; x++) G.set(x, 15, '#5a5e64'); for (let x = 1; x < 4; x++) G.set(x, 15, '#5a5e64');
    G.set(22, 12, '#2a2c30'); G.set(23, 12, '#8a8e94');
    // rust
    for (let k = 0; k < 16; k++) {
      const x = 2 + (r() * (w - 4)) | 0, y = 8 + (r() * 9) | 0; const c = G.get(x, y);
      if (c && c !== '#121014' && !GL.includes(c)) { G.set(x, y, rustC[(r() * 3) | 0]); if (r() < 0.5 && G.get(x + 1, y)) G.set(x + 1, y, rustC[0]); }
    }
    for (let x = 4; x < w - 5; x++) if (r() < 0.55) G.set(x, 17, rustC[0]);
    addProp(name, G, '#120f12');
  }

  function buildProps() {
    barrel('barrel', ['#252c37', '#33404f', '#445468', '#56687e', '#6d8096']);
    barrel('barrel_red', ['#3d1618', '#5c2022', '#7c2b2a', '#983831', '#b04a3c'], { stripe: true });
    crate('crate');
    // toolbox: red metal, handle on the lid, silver latches
    {
      const RD = ['#4a1618', '#6e2022', '#932c2a', '#b33a32', '#cc5040'];
      const w = 11, G = new Grid(w, 7);
      box3(G, 0, 1, w, 2, 4, RD, RD, { seed: 51 });
      for (let x = 3; x < 8; x++) G.set(x, 0, x === 3 || x === 7 ? '#2a2a2e' : '#4a4a50'); G.set(4, 0, '#7a7a80');
      for (let x = 0; x < w; x++) G.set(x, 3, '#3a1214');
      G.set(2, 4, '#c8ccd0'); G.set(8, 4, '#c8ccd0'); G.set(2, 5, '#7a7e84'); G.set(8, 5, '#7a7e84');
      G.set(5, 5, '#e0c050');
      addProp('toolbox', G);
    }
    // medbox: white case, red cross on the lid and front
    {
      const WH = ['#7d8088', '#a4a8ae', '#c4c8cc', '#dcdfe2', '#eef0f1'];
      const w = 11, G = new Grid(w, 8);
      box3(G, 0, 0, w, 3, 5, WH, WH, { seed: 52, noise: 0.06 });
      G.set(5, 0, '#c8323a'); G.set(4, 1, '#c8323a'); G.set(5, 1, '#e8484a'); G.set(6, 1, '#c8323a'); G.set(5, 2, '#a02830');
      for (let x = 0; x < w; x++) G.set(x, 3, '#8a8e94');
      G.set(5, 4, '#c8323a'); G.set(4, 5, '#c8323a'); G.set(5, 5, '#e0403f'); G.set(6, 5, '#c8323a'); G.set(5, 6, '#a02830');
      G.set(1, 4, '#5a5e64'); G.set(9, 4, '#5a5e64');
      addProp('medbox', G, '#1d1b24');
    }
    // ammo can: olive, lid latch, yellow stencil
    {
      const w = 11, G = new Grid(w, 7);
      box3(G, 0, 0, w, 3, 4, OLIVE, OLIVE, { seed: 53 });
      for (let x = 0; x < w; x++) G.set(x, 2, OLIVE[1]);
      for (let x = 3; x < 8; x++) G.set(x, 1, OLIVE[5]); G.set(3, 0, OLIVE[2]); G.set(7, 0, OLIVE[2]);
      G.set(9, 3, '#a8ae96'); G.set(9, 4, '#6a705a');
      G.set(2, 4, '#c9b04a'); G.set(3, 4, '#c9b04a'); G.set(5, 4, '#c9b04a'); G.set(6, 4, '#a89436'); G.set(2, 5, '#a89436'); G.set(5, 5, '#c9b04a');
      addProp('ammobox', G);
    }
    // long military crate
    {
      const w = 18, G = new Grid(w, 10);
      box3(G, 0, 0, w, 4, 6, OLIVE, OLIVE, { seed: 54 });
      for (let x = 0; x < w; x++) { G.set(x, 4, OLIVE[5]); G.set(x, 9, OLIVE[0]); }
      for (const bx of [1, 16]) for (let y = 0; y < 10; y++) G.set(bx, y, y < 4 ? OLIVE[1] : OLIVE[2]);
      // latches + stencil
      for (const lx of [4, 13]) { G.set(lx, 5, '#9aa088'); G.set(lx, 6, '#5a604a'); }
      const st = '#c2b26a';
      [[6, 6], [7, 6], [8, 6], [10, 6], [11, 6], [6, 7], [8, 7], [10, 7], [6, 8], [7, 8], [8, 8], [11, 8]].forEach(([x, y]) => G.set(x, y, st));
      for (let x = 5; x < 13; x++) G.set(x, 2, OLIVE[3]);
      addProp('military', G);
    }
    // elite: dark steel crate with glowing blue strip
    {
      const w = 18, G = new Grid(w, 11);
      box3(G, 0, 0, w, 4, 7, STEEL, STEEL, { seed: 55, noise: 0.08 });
      for (let x = 0; x < w; x++) { G.set(x, 4, STEEL[5]); G.set(x, 10, STEEL[0]); }
      for (let x = 2; x < w - 2; x++) { G.set(x, 7, x === 2 ? '#7fe8ff' : '#2ab8f0'); G.set(x, 8, '#16708f'); }
      for (let x = 3; x < w - 3; x++) G.set(x, 2, x % 3 === 0 ? '#5aa0c0' : STEEL[2]);
      for (const bx of [1, 16]) { G.set(bx, 5, '#8a929c'); G.set(bx, 9, '#8a929c'); }
      G.set(8, 1, '#c8a040'); G.set(9, 1, '#e8c060');
      addProp('elite', G);
    }
    // cache: half-buried duffel in a dirt mound
    {
      const w = 10, h = 6, G = new Grid(w, h);
      const DT = ['#3b2f22', '#4b3c2c', '#5c4a36', '#6d5a42'];
      for (let y = 2; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot((x - 4.5) / 5, (y - 5) / 3.4); if (d < 1) G.set(x, y, ramp(DT, 0.75 - d * 0.4 - (y - 2) * 0.08 + (hn(x, y, 61) - 0.5) * 0.3)); }
      const BG = ['#2c3424', '#3b4630', '#4d5a3c', '#62704b'];
      for (let y = 0; y < 4; y++) for (let x = 2; x < 9; x++) { const d = Math.hypot((x - 5.2) / 3.6, (y - 2.6) / 2.2); if (d < 1) G.set(x, y, ramp(BG, 0.85 - d * 0.5 - (x - 3) * 0.06)); }
      G.set(4, 1, '#8a8a7a'); G.set(5, 1, '#5a5a4e'); G.set(6, 2, '#2a2e22'); G.set(7, 1, '#2a2e22'); // zip + strap
      addProp('cache', G);
    }
    // lootbag: dropped brown sack tied at the top
    {
      const w = 7, h = 6, m = maskFromFn(w, h, (x, y) => y >= 1 ? Math.hypot((x - 3) / 3.5, (y - 3.6) / 2.6) < 1 : x >= 2 && x <= 4);
      const SB = ['#3a2a1c', '#4f3a26', '#654b32', '#7c5e3f', '#94734e'];
      const G = shadeMask(m, w, h, SB, { depth: 2, seed: 62, noise: 0.15 });
      G.set(3, 0, '#2a1e14'); G.set(2, 1, '#c8b47a'); G.set(3, 1, '#a8945e'); G.set(4, 1, '#c8b47a');
      G.set(2, 4, SB[1]); G.set(4, 3, SB[1]);
      addProp('lootbag', G, OUTW);
    }
    car('car0', ['#1f2a36', '#2b3a4a', '#3a4d60', '#4a6076', '#5c738a', '#728aa0'], 71);
    car('car1', ['#331815', '#4a221c', '#622d23', '#7a3a2b', '#8f4a36', '#a35d45'], 72);
    car('car2', ['#3a3826', '#4e4b33', '#636042', '#787551', '#8d8a62', '#a39f76'], 73);
    // sandbags: two courses of plump bags
    {
      const w = 20, h = 9, G = new Grid(w, h);
      const SBG = ['#4a4232', '#5d5440', '#71684f', '#857c60', '#998f71', '#aba283'];
      const bag = (bx, by, bw, bh, seed) => {
        const m = maskFromFn(bw, bh, (x, y) => { const dx = (x + 0.5 - bw / 2) / (bw / 2), dy = (y + 0.5 - bh / 2) / (bh / 2); return Math.pow(Math.abs(dx), 2.6) + Math.pow(Math.abs(dy), 2.2) < 1; });
        stamp(G, shadeMask(m, bw, bh, SBG, { depth: 2, seed, noise: 0.12 }), bx, by);
      };
      bag(0, 4, 7, 5, 1); bag(6, 4, 8, 5, 2); bag(13, 4, 7, 5, 3);
      bag(3, 0, 7, 5, 4); bag(9, 0, 8, 5, 5);
      addProp('sandbag', G, '#1e1a14');
    }
    // radar dish on a lattice stand
    {
      const w = 38, h = 38, G = new Grid(w, h);
      const M = ['#3a3f46', '#4c525a', '#5f666e', '#757c84', '#8d949b', '#a9afb5'];
      // stand: tapered lattice
      for (let y = 22; y < h; y++) {
        const k = (y - 22) / (h - 23), xl = Math.round(lerp(16, 9, k)), xr = Math.round(lerp(21, 28, k));
        G.set(xl, y, M[4]); G.set(xl + 1, y, M[2]); G.set(xr, y, M[1]); G.set(xr - 1, y, M[2]);
        if ((y - 22) % 5 === 0) for (let x = xl; x <= xr; x++) G.set(x, y, M[3]);
        const ph = (y - 22) % 5; if (ph > 0) { const t = ph / 5; G.set(Math.round(lerp(xl, xr, t)), y, M[1]); G.set(Math.round(lerp(xr, xl, t)), y, M[2]); }
      }
      for (let x = 7; x < 31; x++) { G.set(x, h - 1, M[0]); }
      // equipment box on the mount
      box3(G, 14, 18, 10, 2, 4, M, M, { seed: 77 }); G.set(16, 21, '#d04a3a'); G.set(18, 21, '#5ad06a');
      // dish: ellipse facing up-left; concave bowl lit on its far (bottom-right) side, bright rim
      const cx = 18, cy = 11, rx = 16, ry = 10;
      for (let x = 4; x < 33; x++) { const dx = (x + 0.5 - cx) / rx; if (Math.abs(dx) > 1) continue; const yb = Math.round(cy + ry * Math.sqrt(1 - dx * dx)); for (let k = 0; k < 3; k++) if (yb + k < h) G.set(x, yb + k, k === 2 ? M[0] : M[1]); }
      for (let y = 0; y < 23; y++) for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d = dx * dx + dy * dy;
        if (d > 1) continue;
        let t;
        if (d > 0.8) t = 0.95 - (dx + dy) * 0.35;                     // rim
        else { t = 0.4 + (dx * 0.25 + dy * 0.35) - (1 - d) * 0.05; if (Math.abs(d - 0.42) < 0.05) t -= 0.12; if (Math.abs(Math.atan2(dy, dx) * 4 / Math.PI % 1) < 0.06 && d > 0.15) t -= 0.08; }
        G.set(x, y, ramp(M, t + (hn(x, y, 78) - 0.5) * 0.05));
      }
      // feed struts + receiver
      G.line(6, 13, 18, 6, M[0]); G.line(30, 13, 18, 6, M[0]); G.line(18, 20, 18, 7, M[0]);
      G.rect(16, 4, 4, 3, M[4]); G.rect(16, 4, 4, 1, M[5]); G.set(19, 5, M[2]); G.set(19, 6, M[1]); G.set(16, 6, M[3]);
      G.set(18, 3, M[3]); G.set(18, 2, '#e04040'); // beacon light
      // rust streaks
      G.set(24, 14, '#6e4630'); G.set(24, 15, '#5e3a26'); G.set(10, 15, '#6e4630');
      addProp('dish', G);
    }
    // nuclear cooling tower
    {
      const w = 78, h = 68, G = new Grid(w, h), cx = w / 2;
      const CR = ['#363533', '#45443f', '#55534d', '#66645d', '#78756d', '#8a877e', '#9c988e'];
      const topY = 7, botY = 60, ryE = 6;
      const hwAt = (y) => { const t = (y - topY) / (botY - topY); return 24 + 13 * Math.pow((t - 0.6) / 0.6, 2) * (t < 0.6 ? 0.55 : 1.6); };
      for (let y = topY; y <= botY + ryE; y++) {
        const hw = hwAt(Math.min(y, botY));
        for (let x = 0; x < w; x++) {
          const dx = (x + 0.5 - cx) / hw; if (Math.abs(dx) > 1) continue;
          const yBottom = botY + ryE * Math.sqrt(1 - dx * dx); if (y > yBottom) continue;
          let t = 0.7 - dx * 0.45 - Math.pow(Math.abs(dx), 6) * 0.3 + (hn(x, y >> 1, 81) - 0.5) * 0.08;
          // vertical water stains
          if (hn(x, 0, 82) < 0.16 && y < topY + 10 + hn(x, 1, 83) * 30) t -= 0.15;
          if ((y - topY) % 9 === 0) t -= 0.05;   // pour lines
          G.set(x, y, ramp(CR, t));
        }
      }
      // support legs: dark gaps at the base
      for (let y = botY - 1; y <= botY + ryE; y++) for (let x = 0; x < w; x++) {
        if (!G.get(x, y)) continue;
        const ph = ((x - 2) % 6 + 6) % 6; const dx = (x + 0.5 - cx) / hwAt(botY);
        const yBottom = botY + ryE * Math.sqrt(Math.max(0, 1 - dx * dx));
        if (y > yBottom - 4 && ph >= 2) G.set(x, y, y > yBottom - 3 ? '#121214' : '#1e1d1f');
        else if (y > yBottom - 4 && ph === 1) G.set(x, y, CR[5]);
      }
      // top opening: lip + dark interior with the inner back wall
      const hwT = hwAt(topY);
      for (let y = topY - ryE; y <= topY + ryE; y++) for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - cx) / hwT, dy = (y + 0.5 - topY) / ryE, d = dx * dx + dy * dy;
        if (d > 1) continue;
        if (d > 0.78) G.set(x, y, dy < 0 ? CR[6] : CR[4]);
        else G.set(x, y, dy < -0.25 ? (dx < 0 ? '#2e2d2c' : '#3a3936') : '#121214');
      }
      // faint steam wisps
      [[30, 2], [33, 1], [36, 3], [42, 0], [45, 2]].forEach(([x, y]) => G.set(x, y, '#b8bcb8'));
      // hazard sign + door at the base
      G.rect(36, 50, 5, 4, '#d9a435'); G.set(38, 51, '#1e1b19'); G.set(37, 52, '#1e1b19'); G.set(39, 52, '#1e1b19');
      addProp('tower', G, '#121214');
    }
    // wrecked tank (olive), barrel askew, broken track
    {
      const w = 42, h = 24, G = new Grid(w, h), r = ART.rng(91);
      const TR = ['#1d1c1c', '#2b2a29', '#3a3836', '#4c4946'];
      // tracks
      for (let y = 15; y < h; y++) for (let x = 1; x < w - 1; x++) {
        if ((y === 15 || y === h - 1) && (x < 3 || x > w - 4)) continue;
        let t = y === 15 ? 0.85 : y === h - 1 ? 0.1 : 0.4; if (x % 3 === 0) t -= 0.25; G.set(x, y, ramp(TR, t));
      }
      for (let k = 0; k < 6; k++) { const cx = 5 + k * 6.3; for (let y = 17; y < 23; y++) for (let x = Math.round(cx) - 2; x <= Math.round(cx) + 2; x++) { const d = Math.hypot(x - cx, y - 19.8); if (d < 2.6) G.set(x, y, d < 1 ? '#5a5650' : d < 1.8 ? (x < cx ? '#4a4844' : '#34322f') : '#1b1a19'); } }
      // hull: top deck + front glacis + side
      for (let y = 8; y < 16; y++) for (let x = 0; x < w; x++) {
        const xl = y < 11 ? 3 + (11 - y) : 0, xr = y < 11 ? w - 4 - (11 - y) : w - 1;
        if (x < xl || x > xr) continue;
        let t = y < 11 ? 0.8 - (y - 8) * 0.06 : 0.5 - (y - 11) * 0.06;
        if (y === 11) t += 0.15; if (x === xl) t += 0.1; if (x === xr) t -= 0.2;
        t += (hn(x, y, 92) - 0.5) * 0.1;
        G.set(x, y, ramp(OLIVE, t));
      }
      for (let x = 2; x < w - 2; x += 4) G.set(x, 13, OLIVE[1]); // stowage boxes
      // turret: rounded cast shape with lit top, dark underside
      for (let y = 1; y < 11; y++) for (let x = 10; x < 30; x++) {
        const d = Math.hypot((x + 0.5 - 20) / 9.5, (y + 0.5 - 6) / 4.8); if (d > 1) continue;
        let t = y < 7 ? 0.95 - (y - 1) * 0.06 - Math.max(0, x - 20) * 0.02 : 0.38 - (y - 7) * 0.08;
        if (d > 0.86 && x < 20 && y < 7) t += 0.1;
        if (y === 7) t = 0.25;
        t += (hn(x, y, 93) - 0.5) * 0.08;
        G.set(x, y, ramp(OLIVE, t));
      }
      G.rect(14, 1, 4, 2, OLIVE[2]); G.rect(14, 0, 4, 1, OLIVE[4]); G.set(14, 0, OLIVE[5]); // open hatch
      G.rect(28, 4, 3, 4, OLIVE[2]); G.set(28, 4, OLIVE[4]);                                  // mantlet
      // barrel drooping right
      for (let x = 30; x < w; x++) { const y = 5 + Math.floor((x - 30) / 5); G.set(x, y, OLIVE[5]); G.set(x, y + 1, OLIVE[3]); G.set(x, y + 2, OLIVE[1]); }
      G.set(w - 1, 6, '#1a1a1a'); G.set(w - 1, 7, '#1a1a1a');
      // scorch, rust, broken track gap, number
      for (let k = 0; k < 18; k++) { const x = 4 + (r() * 34) | 0, y = 3 + (r() * 12) | 0; if (G.get(x, y) && OLIVE.includes(G.get(x, y))) G.set(x, y, r() < 0.5 ? '#2a2620' : '#6a3e26'); }
      for (let x = 30; x < 33; x++) for (let y = 15; y < h; y++) G.set(x, y, y > 20 ? '#3a3127' : null);
      G.set(6, 12, '#d0c8a0'); G.set(7, 12, '#d0c8a0'); G.set(9, 12, '#d0c8a0'); G.set(6, 13, '#a8a080'); G.set(9, 13, '#a8a080');
      addProp('tank', G, '#111110');
    }
    // pallet
    {
      const w = 12, G = new Grid(w, 4);
      for (let x = 0; x < w; x++) { G.set(x, 0, (x % 4 === 3) ? WOOD[1] : WOOD[4]); G.set(x, 1, (x % 4 === 3) ? WOOD[0] : WOOD[3]); }
      for (let x = 0; x < w; x++) G.set(x, 2, WOOD[2]);
      for (const bx of [0, 5, 10]) { G.set(bx, 3, WOOD[3]); G.set(bx + 1, 3, WOOD[1]); }
      G.set(3, 0, WOOD[5]);
      addProp('pallet', G, OUTW);
    }
    // tyre (lying flat, 3/4)
    ART.add('tire', ART.outline(ART.ascii(['.abba.', 'ab..ca', 'bcddcb', '.cccc.'], { a: '#4a4a50', b: '#38383d', c: '#222226', d: '#141416' }), '#0e0e10'), 4, 5);
    // rubble decals
    {
      const deb = (name, seed, pal) => {
        const w = 8, h = 4, G = new Grid(w, h), r = ART.rng(seed);
        const chunks = [[0, 1, 3, 3], [3, 0, 3, 2], [5, 2, 3, 2], [2, 3, 2, 1]];
        chunks.forEach(([x, y, cw, ch], i) => { const p = pal[i % pal.length]; for (let j = 0; j < ch; j++) for (let k = 0; k < cw; k++) G.set(x + k, y + j, j === 0 ? p[1] : (k === cw - 1 ? p[2] : p[0])); });
        if (r() < 2) G.set(1 + (r() * 5 | 0), 0, pal[0][1]);
        addProp(name, G, '#1b1a1c');
      };
      deb('debris0', 1, [['#6e6c66', '#8c8a83', '#4e4d49'], ['#5e5c57', '#7a7872', '#44433f']]);
      deb('debris1', 2, [['#7a3e30', '#9a5444', '#56291f'], ['#6e6c66', '#8c8a83', '#4e4d49']]);
      deb('debris2', 3, [['#5a4330', '#7a5c42', '#3e2e20'], ['#4c5058', '#6a7078', '#33363c']]);
    }
    // exfil: pole with a green signal flare and a small flag
    {
      const w = 6, h = 18, G = new Grid(w, h);
      for (let y = 4; y < h; y++) { G.set(1, y, '#8a8e94'); G.set(2, y, '#4e5258'); }
      for (let y = 4; y < 9; y++) for (let x = 3; x < 6; x++) G.set(x, y, (y === 4 ? '#7af08a' : y < 7 ? '#3ec05a' : '#2a8a44'));
      G.set(5, 6, '#2a8a44'); G.set(5, 8, null); G.set(4, 8, '#1f6a34');
      G.set(1, 0, '#e8ffd8'); G.set(0, 1, '#9aff9a'); G.set(1, 1, '#ffffff'); G.set(2, 1, '#9aff9a'); G.set(1, 2, '#5ae86a'); G.set(1, 3, '#3a3e44'); G.set(2, 3, '#2a2e34');
      G.set(0, h - 1, '#3a3e44'); G.set(3, h - 1, '#3a3e44');
      addProp('exfil', G);
    }
  }

  // ======================================================================
  // BASE BUILDING
  // ======================================================================
  // seamless Voronoi flagstones (wrap distance), used for stone wall tops
  function flagstones(seed, n, R, mortar) {
    const r = ART.rng(seed), P2 = []; for (let i = 0; i < n; i++) P2.push([r() * 16, r() * 16, r()]);
    const wd = (a, b) => { let d = Math.abs(a - b); return Math.min(d, 16 - d); };
    return (x, y) => {
      let b1 = 1e9, b2 = 1e9, id = 0;
      for (let i = 0; i < n; i++) { const d = Math.hypot(wd(x + 0.5, P2[i][0]), wd(y + 0.5, P2[i][1])); if (d < b1) { b2 = b1; b1 = d; id = i; } else if (d < b2) b2 = d; }
      if (b2 - b1 < 0.9) return mortar;
      const edge = b2 - b1 < 2;
      // light on the upper-left side of each stone
      const [px, py] = P2[id]; let dx = x + 0.5 - px, dy = y + 0.5 - py; if (dx > 8) dx -= 16; if (dx < -8) dx += 16; if (dy > 8) dy -= 16; if (dy < -8) dy += 16;
      let t = 0.5 + (P2[id][2] - 0.5) * 0.4 + (edge ? (dx + dy < 0 ? 0.22 : -0.2) : 0) + (hn(x, y, seed) - 0.5) * 0.18;
      return ramp(R, t);
    };
  }
  // block-course masonry front face (irregular block lengths per course)
  function blockFront(R, mortar, lip, lipDark, courses, seed) {
    // courses: [{y0, h, edges:[x...]}] in front-face local rows
    return (x, y) => {
      if (y === 0) return lip; if (y === 1) return lipDark;
      for (const c of courses) {
        if (y < c.y0 || y >= c.y0 + c.h) continue;
        const ly = y - c.y0; if (ly === c.h - 1) return mortar;
        if (c.edges.includes(x)) return mortar;
        let id = 0; for (const e of c.edges) if (x > e) id++;
        const left = c.edges.includes((x + 15) % 16), right = c.edges.includes((x + 1) % 16);
        let t = 0.5 + (hn(id + c.y0 * 3, c.y0, seed) - 0.5) * 0.45 + (ly === 0 || left ? 0.22 : 0) + (ly === c.h - 2 || right ? -0.2 : 0) - ao(y) * 0.25 + (hn(x, y, seed + 1) - 0.5) * 0.15;
        return ramp(R, t);
      }
      return mortar;
    };
  }
  const BWOOD = ['#3e2a1b', '#4e3523', '#5e412b', '#6e4d33', '#7e5a3c', '#8e6745'];
  const BSTONE = ['#46443f', '#55534d', '#64615a', '#737068', '#827f76', '#918d83'];
  const BMET = ['#3a3e44', '#464b52', '#535960', '#60676e', '#6e757c', '#7d848b'];
  const BARM = ['#1d2025', '#25292f', '#2e333a', '#383e46', '#434a53', '#4f5760'];
  const RUSTS = ['#4e2e1e', '#6a3e26', '#86502f'];

  const woodTop = (x, y) => {
    const p = y >> 2, w = y & 3; if (w === 3) return BWOOD[1];
    const j = (p * 7 + 3) % 16; if (x === j) return BWOOD[2];
    return ramp(BWOOD.slice(2), 0.5 + (hn(p, 3, 201) - 0.5) * 0.4 + (w === 0 ? 0.18 : 0) + (hn(x, y, 202) - 0.5) * 0.3);
  };
  const woodFront = (x, y) => {
    if (y === 0) return '#a07a52'; if (y === 1) return '#2e2016';
    const yy = y - 2, p = (yy / 3) | 0, w = yy % 3;
    if (w === 2 || y === 9) return '#2a1d13';
    const j = (p * 5 + 9) % 16; if (x === j) return '#33241a';
    if ((x === (j + 1) % 16 || x === (j + 15) % 16) && w === 0) return '#b0a08a';
    return ramp(BWOOD, 0.55 + (hn(p, 4, 203) - 0.5) * 0.35 + (w === 0 ? 0.25 : -0.05) - ao(y) * 0.3 + (hn(x, y, 204) - 0.5) * 0.25);
  };
  const stoneTop = flagstones(211, 7, BSTONE.slice(1), BSTONE[0]);
  const stoneCourses = [{ y0: 2, h: 4, edges: [0, 6, 11] }, { y0: 6, h: 4, edges: [3, 9, 14] }];
  const stoneFront = blockFront(BSTONE, '#38362f', '#a6a294', '#2f2d28', stoneCourses, 212);
  const metalTop = (x, y) => {
    if (x === 15 || y === 15) return BMET[0]; if (x === 0 || y === 0) return BMET[4];
    if ((x === 2 || x === 13) && (y === 2 || y === 13)) return BMET[5];
    if ((x === 3 || x === 14) && (y === 3 || y === 14)) return BMET[1];
    let t = 0.5 + (hn(x >> 1, y >> 1, 221) - 0.5) * 0.25 + (hn(x, y, 222) - 0.5) * 0.15;
    if (hn(x >> 2, y >> 2, 223) < 0.15 && hn(x, y, 224) < 0.5) return RUSTS[1];
    return ramp(BMET.slice(1, 5), t);
  };
  const metalFront = (x, y) => {
    if (y === 0) return '#a3aab1'; if (y === 1) return '#2b2f34'; if (y === 9) return '#24272c';
    if (x === 0) return BMET[0]; if (x === 1) return BMET[5];
    if ((y === 3 || y === 7) && (x === 4 || x === 9 || x === 14)) return '#b8bec4';       // rivets
    if ((y === 4 || y === 8) && (x === 4 || x === 9 || x === 14)) return BMET[0];
    const patch = x >= 7 && x <= 12 && y >= 4 && y <= 7;                                   // scrap patch plate
    if (patch) { if (y === 4 || x === 7) return '#7a6a52'; if (y === 7 || x === 12) return '#3e3426'; return ramp(['#4e4232', '#5a4c38', '#66573f'], 0.5 + (hn(x, y, 225) - 0.5) * 0.4); }
    let t = 0.55 - ao(y) * 0.35 + (hn(x, y, 226) - 0.5) * 0.12 + (y === 2 ? 0.2 : 0);
    if ((x === 5 || x === 15) && y > 3 && hn(x, y, 227) < 0.7) return RUSTS[y > 6 ? 0 : 1];   // rust streaks from rivets
    return ramp(BMET, t);
  };
  const armorTop = (x, y) => {
    if (x === 15 || y === 15) return BARM[0]; if (x === 0 || y === 0) return BARM[4];
    if ((x === 3 || x === 12) && (y === 3 || y === 12)) return '#6a7380';
    // diagonal tread
    const d = (x + y) & 3, d2 = (x - y + 32) & 3;
    let t = 0.5 + (d === 0 && d2 === 2 ? 0.3 : 0) + (hn(x, y, 231) - 0.5) * 0.1;
    return ramp(BARM.slice(1, 5), t);
  };
  const armorFront = (x, y) => {
    if (y === 0) return '#7d8792'; if (y === 1) return '#14161a'; if (y === 9) return '#121418';
    if (x === 0) return '#121418'; if (x === 1) return BARM[5];
    if (y === 2) return BARM[5]; if (y === 8) return BARM[0];
    if ((x === 4 || x === 12) && (y === 4 || y === 6)) return '#8a94a0';
    if ((x === 5 || x === 13) && (y === 4 || y === 6)) return '#1a1d22';
    if (y === 5 && x > 6 && x < 10) return BARM[1];
    let t = 0.55 - (y - 2) * 0.06 + (hn(x, y, 232) - 0.5) * 0.1 + (x === 2 ? 0.15 : 0) - (x === 15 ? 0.2 : 0);
    return ramp(BARM, t);
  };

  function buildBaseWalls() {
    wallSprite('b_wall_wood', woodTop, woodFront);
    wallSprite('b_wall_stone', stoneTop, stoneFront);
    wallSprite('b_wall_metal', metalTop, metalFront);
    wallSprite('b_wall_armor', armorTop, armorFront);
    // wooden door: frame posts + boarded door with iron bands and ring handle
    wallSprite('b_door_wood', woodTop, (x, y) => {
      if (y === 0) return '#a07a52'; if (y === 1) return '#2e2016';
      if (x <= 1 || x >= 14) return x === 0 ? '#2a1d13' : x === 1 ? BWOOD[4] : x === 14 ? BWOOD[1] : '#2a1d13';
      if (x === 2 || x === 13) return '#1c130c';
      if (y === 9) return '#1c130c';
      if (y === 3 || y === 7) { if (x === 4 || x === 11) return '#9aa0a6'; return x < 7 ? '#4a4e54' : '#3a3e44'; }
      if (x === 11 && y === 5) return '#c8a050'; if (x === 10 && y === 5) return '#7a5a28'; if (x === 11 && y === 6) return '#7a5a28';
      if ((x - 3) % 3 === 2) return BWOOD[1];
      return ramp(BWOOD, 0.6 - ao(y) * 0.3 + ((x - 3) % 3 === 0 ? 0.15 : 0) + (hn(x, y, 241) - 0.5) * 0.2);
    });
    // metal door: steel frame, inset panel, view slot, lever handle, hazard sill
    wallSprite('b_door_metal', metalTop, (x, y) => {
      if (y === 0) return '#a3aab1'; if (y === 1) return '#2b2f34';
      if (x <= 1 || x >= 14) return x === 1 ? BMET[5] : x === 14 ? BMET[1] : BMET[0];
      if (x === 2 || x === 13) return '#1b1d21';
      if (y === 9) return ((x >> 1) & 1) ? '#d9a435' : '#1e1b19';
      if (y === 3 && x >= 5 && x <= 10) return '#0e0f12';                                     // view slot
      if (y === 2 && x >= 5 && x <= 10) return BMET[1];
      if (y === 4 && x >= 5 && x <= 10) return BMET[5];
      if (y === 6 && x >= 9 && x <= 11) return x === 9 ? '#c8ccd0' : '#8a8e94';               // lever
      if (y === 7 && x === 9) return '#4a4e54';
      if (x === 3 || y === 2) return BMET[5]; if (x === 12 || y === 8) return BMET[1];
      return ramp(BMET, 0.55 - ao(y) * 0.25 + (hn(x, y, 242) - 0.5) * 0.1);
    });
    // embrasure: stone wall with a horizontal shooting slit
    wallSprite('b_embrasure', stoneTop, (x, y) => {
      if (y === 4 || y === 5) { if (x >= 3 && x <= 12) return y === 4 ? '#0b0b0d' : '#141417'; }
      if (y === 3 && x >= 2 && x <= 13) return '#827f76';   // lintel stone
      if (y === 6 && x >= 3 && x <= 12) return '#a6a294';   // lit sill
      if ((y === 4 || y === 5) && (x === 2 || x === 13)) return '#38362f';
      return stoneFront(x, y);
    });
  }

  // furniture helper: Grid of (14, H-2) -> outlined 16xH, anchor (0, H-16)
  function addBase(name, G, out = OUT) { const c = ART.outline(G.canvas(), out); return ART.add(name, c, 0, c.height - 16); }
  const GOLD = ['#7a5418', '#a8742a', '#d09a3a', '#f0c45a', '#fff0a0'];
  const DWOOD = ['#2a1912', '#38221a', '#472c21', '#563728', '#654230', '#764f39'];
  const FIRE = ['#8a2018', '#d0401c', '#f07a22', '#fcc040', '#fff2b0'];

  function flame(G, cx, base, hgt, seed, frame) {
    const r = ART.rng(seed * 10 + frame);
    for (let x = -3; x <= 3; x++) {
      const col = cx + x, hh = Math.max(0, hgt - Math.abs(x) * (1.3 + r() * 0.4) + (r() - 0.5) * 2.2 + ((x + frame) % 2 ? -0.6 : 0.6));
      for (let k = 0; k < hh; k++) {
        const rel = k / Math.max(1, hh), core = Math.abs(x) <= 1 && rel < 0.55;
        const idx = core ? (rel < 0.3 ? 4 : 3) : rel > 0.75 ? 0 : rel > 0.45 ? 1 : 2;
        G.set(col, base - k, FIRE[idx]);
      }
    }
    // flying ember
    G.set(cx + (frame - 1) * 2, base - hgt - 1 - frame % 2, FIRE[3]);
  }

  function buildBaseProps() {
    // ---------------- spikes (floor tile)
    {
      const G = new Grid(14, 14);
      // binding log across the middle
      for (let x = 0; x < 14; x++) { G.set(x, 8, BARK[3]); G.set(x, 9, BARK[2]); G.set(x, 10, BARK[1]); }
      const stake = (x0, y0, x1, y1) => {
        G.line(x0, y0, x1, y1, BARK[3]); G.line(x0 + 1, y0, x1 + 1, y1, BARK[1]);
        G.set(x1, y1, '#d8c094'); G.set(x1 + 1, y1, '#b09870'); G.set(x1 + (x1 > x0 ? 1 : 0), y1 - 1, '#efdcb0');
      };
      stake(1, 13, 4, 2); stake(5, 13, 2, 3); stake(6, 13, 9, 1); stake(10, 13, 7, 3); stake(11, 13, 12, 2);
      for (let x = 0; x < 14; x++) if (x % 4 === 1) G.set(x, 8, '#9a8a6a');   // rope lashings
      ART.add('b_spikes', ART.outline(G.canvas(), OUTW), 0, 0);
    }
    // ---------------- landmine
    ART.add('b_landmine', ART.outline(ART.ascii(['.abbba.', 'abcdcba', '.eeeee.'], { a: '#4a5434', b: '#6a7648', c: '#808c58', d: '#e04030', e: '#2c3220' }), '#141610'), 4, 4);
    // ---------------- claim cupboard (b_core) 16x26
    {
      const G = new Grid(14, 24);
      // top face (depth 5) with gold trim on the front edge
      for (let y = 0; y < 5; y++) for (let x = 0; x < 14; x++) G.set(x, y, ramp(DWOOD, 0.75 - y * 0.05 + (x === 0 ? 0.1 : 0) - (x === 13 ? 0.15 : 0) + (hn(x, y, 251) - 0.5) * 0.15));
      for (let x = 0; x < 14; x++) { G.set(x, 4, GOLD[x < 3 ? 3 : 2]); G.set(x, 0, GOLD[1]); }
      // front: doors + trim
      for (let y = 5; y < 23; y++) for (let x = 0; x < 14; x++) {
        let c;
        if (x === 0 || x === 13) c = x === 0 ? GOLD[2] : GOLD[0];
        else if (x === 6) c = DWOOD[0]; else if (x === 7) c = DWOOD[3];
        else if (y === 5) c = DWOOD[0];
        else if (y === 22) c = GOLD[1];
        else {
          const inX = (x === 2 || x === 5 || x === 8 || x === 11), inY = (y === 7 || y === 20);
          const inside = x > 2 && x < 5 || x > 8 && x < 11;
          let t = 0.5 - (y - 5) * 0.012 + (hn(x, y, 252) - 0.5) * 0.15 + (x === 1 || x === 8 ? 0.15 : 0);
          if ((inX && y >= 7 && y <= 20) || (inY && (x >= 2 && x <= 5 || x >= 8 && x <= 11))) t = (x === 2 || x === 8 || y === 7) ? 0.15 : 0.7;
          else if (inside && y > 7 && y < 20) t -= 0.12;
          c = ramp(DWOOD, t);
        }
        G.set(x, y, c);
      }
      // feet
      G.set(1, 23, DWOOD[1]); G.set(2, 23, DWOOD[0]); G.set(11, 23, DWOOD[1]); G.set(12, 23, DWOOD[0]);
      // glowing emblem (diamond) across the centre seam + handles
      const em = [[6, 10], [7, 10], [5, 11], [6, 11], [7, 11], [8, 11], [4, 12], [5, 12], [6, 12], [7, 12], [8, 12], [9, 12], [5, 13], [6, 13], [7, 13], [8, 13], [6, 14], [7, 14]];
      em.forEach(([x, y]) => G.set(x, y, GOLD[2]));
      [[6, 11], [7, 11], [5, 12], [8, 12], [6, 13], [7, 13]].forEach(([x, y]) => G.set(x, y, GOLD[3]));
      G.set(6, 12, GOLD[4]); G.set(7, 12, '#ffffff');
      G.set(6, 9, '#c89a3a'); G.set(7, 9, '#a8742a'); G.set(3, 12, '#8a6020'); G.set(10, 12, '#8a6020'); G.set(6, 15, '#8a6020'); G.set(7, 15, '#8a6020');
      G.set(5, 17, GOLD[3]); G.set(8, 17, GOLD[3]);
      addBase('b_core', G, '#120a07');
    }
    // ---------------- campfire 16x16 (3 flame frames)
    for (let f = 0; f < 3; f++) {
      const G = new Grid(14, 14);
      // ash bed
      for (let y = 8; y < 13; y++) for (let x = 2; x < 12; x++) if (Math.hypot((x + 0.5 - 7) / 5, (y + 0.5 - 10.5) / 2.4) < 1) G.set(x, y, hn(x, y, 260) < 0.3 ? '#4a3a32' : '#2a2422');
      // logs
      G.line(3, 12, 10, 9, BARK[2]); G.line(3, 11, 10, 8, BARK[4]); G.line(4, 9, 11, 12, BARK[1]); G.line(4, 8, 11, 11, BARK[3]);
      G.set(10, 9, '#e07a2a'); G.set(4, 9, '#d0401c'); G.set(7, 11, '#fcc040');
      flame(G, 7, 9, 7 + (f === 1 ? 1 : 0), 7, f);
      // stone ring (front stones drawn last to overlap)
      const stones = [];
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + 0.2; stones.push([7 + Math.cos(a) * 5.6, 10.3 + Math.sin(a) * 2.7]); }
      stones.sort((a, b) => a[1] - b[1]).forEach(([sx, sy], i) => {
        const x = Math.round(sx - 1), y = Math.round(sy - 1);
        G.set(x, y, '#8a8780'); G.set(x + 1, y, '#6e6b65'); G.set(x, y + 1, '#5a5852'); G.set(x + 1, y + 1, '#45433f');
        if (i % 2) G.set(x + 2, y + 1, '#45433f');
      });
      ART.add('b_campfire' + f, ART.outline(G.canvas(), '#141210'), 0, 0);
    }
    // ---------------- floodlight 16x26
    {
      const G = new Grid(14, 24);
      // tripod legs
      G.line(7, 15, 1, 23, BMET[4]); G.line(7, 15, 12, 23, BMET[1]); G.line(7, 15, 7, 23, BMET[2]);
      G.line(6, 15, 0, 23, BMET[2]);
      // pole
      for (let y = 6; y < 17; y++) { G.set(6, y, BMET[5]); G.set(7, y, BMET[2]); }
      // lamp head (box) with bright lens, tilted toward the viewer
      for (let y = 0; y < 7; y++) for (let x = 1; x < 13; x++) {
        let c;
        if (y === 0) c = BMET[4]; else if (y === 6) c = BMET[0];
        else if (x === 1) c = BMET[3]; else if (x === 12) c = BMET[0];
        else if (y >= 2 && y <= 5 && x >= 2 && x <= 11) c = (y === 2 || x === 2) ? '#fffbe8' : (x + y) % 3 === 0 ? '#f8e8a0' : '#fff4c0';
        else c = BMET[2];
        G.set(x, y, c);
      }
      G.set(3, 3, '#ffffff'); G.set(4, 3, '#ffffff');
      G.set(6, 7, BMET[1]); G.set(7, 7, BMET[0]);   // yoke
      // cable + junction box
      G.line(7, 10, 10, 13, '#1e1e22'); G.line(10, 13, 13, 23, '#1e1e22');
      G.rect(8, 11, 3, 2, '#c08a2a'); G.set(8, 11, '#e0aa4a');
      addBase('b_floodlight', G);
    }
    // ---------------- workbench 1 (wood, tools) 16x20
    {
      const G = new Grid(14, 18);
      // pegboard back
      for (let y = 0; y < 5; y++) for (let x = 1; x < 13; x++) G.set(x, y, ramp(BWOOD, 0.35 + (y === 0 ? 0.2 : 0) + (hn(x, y, 271) - 0.5) * 0.1));
      G.set(3, 1, '#9aa0a6'); G.set(3, 2, '#6a7076'); G.set(4, 1, '#6a7076'); // wrench
      G.set(9, 1, '#4a4e54'); G.set(10, 1, '#4a4e54'); G.set(9, 2, '#6e4a2c'); G.set(9, 3, '#6e4a2c');      // hammer
      // top surface (depth 6)
      for (let y = 5; y < 11; y++) for (let x = 0; x < 14; x++) {
        let t = 0.7 - (y - 5) * 0.03 + (x === 0 ? 0.08 : 0) - (x === 13 ? 0.15 : 0) + (hn(x, y, 272) - 0.5) * 0.12;
        if ((y - 5) % 3 === 2) t -= 0.18;
        G.set(x, y, ramp(BWOOD, t));
      }
      // apron + legs + shelf
      for (let x = 0; x < 14; x++) { G.set(x, 11, BWOOD[5]); G.set(x, 12, BWOOD[2]); }
      for (let y = 13; y < 18; y++) { G.set(0, y, BWOOD[4]); G.set(1, y, BWOOD[2]); G.set(12, y, BWOOD[3]); G.set(13, y, BWOOD[1]); }
      for (let x = 2; x < 12; x++) { G.set(x, 15, BWOOD[3]); G.set(x, 16, BWOOD[1]); }
      G.rect(3, 13, 3, 2, '#5a5e64'); G.set(3, 13, '#8a8e94'); // parts box on the shelf
      // saw + scraps on the top
      for (let x = 2; x < 8; x++) { G.set(x, 7, '#b8bec4'); G.set(x, 8, x % 2 ? '#7a8086' : '#9aa0a6'); }
      G.set(8, 7, '#6e3a22'); G.set(9, 7, '#8a4a2a'); G.set(8, 8, '#5a2e1c'); G.set(9, 8, '#6e3a22');
      G.set(10, 6, '#c8ccd0'); G.set(11, 6, '#c8ccd0'); G.set(11, 9, '#e0b050');
      addBase('b_workbench1', G, OUTW);
    }
    // ---------------- workbench 2 (metal, vice) 16x20
    {
      const G = new Grid(14, 18);
      for (let y = 5; y < 11; y++) for (let x = 0; x < 14; x++) G.set(x, y, ramp(BMET, 0.72 - (y - 5) * 0.04 + (x === 0 ? 0.1 : 0) - (x === 13 ? 0.18 : 0) + (hn(x, y, 281) - 0.5) * 0.15 + (hn(x, y, 282) < 0.06 ? -0.3 : 0)));
      // drawers
      for (let y = 11; y < 15; y++) for (let x = 0; x < 14; x++) G.set(x, y, ramp(BMET, 0.45 - (y - 11) * 0.06 + (x === 0 ? 0.1 : 0) - (x === 13 ? 0.15 : 0)));
      for (let x = 0; x < 14; x++) G.set(x, 11, BMET[5]);
      G.set(7, 11, BMET[0]); G.set(7, 12, BMET[0]); G.set(7, 13, BMET[0]);
      G.set(3, 12, '#c8ccd0'); G.set(4, 12, '#c8ccd0'); G.set(10, 12, '#c8ccd0'); G.set(11, 12, '#c8ccd0');
      for (let y = 15; y < 18; y++) { G.set(0, y, BMET[4]); G.set(1, y, BMET[1]); G.set(12, y, BMET[3]); G.set(13, y, BMET[0]); }
      // vice on the right
      for (let y = 1; y < 8; y++) for (let x = 8; x < 13; x++) G.set(x, y, y < 3 ? (x === 8 ? '#5a7898' : '#486480') : (x === 8 ? '#3e5670' : x === 12 ? '#22303e' : '#30445a'));
      G.set(10, 1, '#1a2028'); G.set(10, 2, '#1a2028');                // jaw gap
      G.line(6, 4, 8, 4, '#c8ccd0'); G.set(6, 3, '#9aa0a6'); G.set(6, 5, '#9aa0a6'); // screw handle
      // gear + bolts lying on top
      G.set(2, 6, '#b8a060'); G.set(3, 6, '#d8c070'); G.set(2, 7, '#8a7440'); G.set(3, 7, '#b8a060'); G.set(4, 8, '#9aa0a6'); G.set(5, 9, '#9aa0a6');
      addBase('b_workbench2', G);
    }
    // ---------------- workbench 3 (high-tech, screen) 16x22
    {
      const G = new Grid(14, 20);
      // monitor
      for (let y = 0; y < 8; y++) for (let x = 2; x < 12; x++) {
        let c = '#15181e';
        if (y === 0 || x === 2) c = '#4a525e'; else if (y === 7 || x === 11) c = '#0c0e12';
        else { c = (y === 2 || y === 4) && x > 3 && x < 10 - (y === 4 ? 2 : 0) ? '#6af0ff' : (y + x) % 7 === 0 ? '#1f6a7a' : '#103a44'; if (y === 5 && x >= 4 && x <= 6) c = '#ffb840'; }
        G.set(x, y, c);
      }
      G.set(3, 1, '#a0f8ff');
      G.set(6, 8, '#2a2f38'); G.set(7, 8, '#1e2229');
      // desk top with keyboard
      for (let y = 9; y < 14; y++) for (let x = 0; x < 14; x++) G.set(x, y, ramp(BARM, 0.75 - (y - 9) * 0.05 + (x === 0 ? 0.12 : 0) - (x === 13 ? 0.18 : 0)));
      for (let x = 3; x < 11; x++) { G.set(x, 10, (x & 1) ? '#9aa4b0' : '#7a8490'); G.set(x, 11, (x & 1) ? '#7a8490' : '#9aa4b0'); }
      G.set(12, 10, '#40e070');
      // front panel with LED strip
      for (let y = 14; y < 17; y++) for (let x = 0; x < 14; x++) G.set(x, y, ramp(BARM, 0.45 - (y - 14) * 0.1 + (x === 0 ? 0.1 : 0)));
      for (let x = 1; x < 13; x++) G.set(x, 14, x % 4 === 0 ? '#a0f8ff' : '#2ab8d0');
      for (let y = 17; y < 20; y++) { G.set(1, y, BARM[4]); G.set(2, y, BARM[1]); G.set(11, y, BARM[3]); G.set(12, y, BARM[0]); }
      addBase('b_workbench3', G, '#0a0b0e');
    }
    // ---------------- furnace (stone, glowing mouth) 16x24, 2 frames
    for (let f = 0; f < 2; f++) {
      const G = new Grid(14, 22);
      // chimney pipe
      for (let y = 0; y < 7; y++) { G.set(9, y, BMET[4]); G.set(10, y, BMET[2]); G.set(11, y, BMET[0]); }
      G.set(8, 0, BMET[3]); G.set(12, 0, BMET[1]); G.set(9, 0, BMET[5]); G.set(10, 0, '#1a1a1c');
      // domed top
      for (let y = 3; y < 9; y++) for (let x = 0; x < 14; x++) { const d = Math.hypot((x + 0.5 - 7) / 7, (y + 0.5 - 9) / 6); if (d < 1 && !(x >= 9 && x <= 11 && y < 6)) G.set(x, y, ramp(BSTONE, 0.85 - d * 0.2 - (x - 7) * 0.04 - (y > 7 ? 0.2 : 0) + (hn(x, y, 291) - 0.5) * 0.18)); }
      // stone body with block courses
      for (let y = 8; y < 22; y++) for (let x = 0; x < 14; x++) {
        const c = ((y - 8) / 3) | 0, ly = (y - 8) % 3, off = (c & 1) ? 2 : 0, bx = (x + off) % 5;
        let t = 0.55 + (hn(((x + off) / 5) | 0, c, 292) - 0.5) * 0.35 - (y - 8) * 0.012;
        if (ly === 2 || bx === 4) t = 0.05; else if (ly === 0 || bx === 0) t += 0.18;
        if (x === 13) t -= 0.2;
        G.set(x, y, ramp(BSTONE, t));
      }
      // arched mouth with fire
      for (let y = 12; y < 20; y++) for (let x = 3; x < 11; x++) {
        const inArch = y >= 14 || Math.hypot(x + 0.5 - 7, (y - 14) * 1.3) < 4;
        if (!inArch) continue;
        const edge = x === 3 || x === 10 || (y < 14 && Math.hypot(x + 0.5 - 7, (y - 14) * 1.3) > 3);
        if (edge) { G.set(x, y, '#1c120e'); continue; }
        const cxd = Math.abs(x + 0.5 - 7), heat = (y - 12) / 8 - cxd * 0.12 + ((x * 7 + y * 3 + f * 5) % 4 === 0 ? 0.12 : 0) - (f && (x + y) % 5 === 0 ? 0.1 : 0);
        let idx = heat > 0.78 ? 4 : heat > 0.55 ? 3 : heat > 0.32 ? 2 : heat > 0.12 ? 1 : 0;
        G.set(x, y, FIRE[idx]);
      }
      for (let x = 3; x < 11; x++) G.set(x, 20, x % 2 ? '#3a3a3e' : '#55555a'); // grate
      for (let x = 2; x < 12; x++) G.set(x, 21, mix(BSTONE[2], FIRE[2], 0.35)); // glow on the sill
      G.set(5 + f, 11, FIRE[2]);
      addBase('b_furnace' + f, G, '#141210');
    }
    // ---------------- research desk 16x20
    {
      const G = new Grid(14, 18);
      for (let y = 6; y < 11; y++) for (let x = 0; x < 14; x++) G.set(x, y, ramp(BWOOD, 0.62 - (y - 6) * 0.04 + (x === 0 ? 0.12 : 0) - (x === 13 ? 0.18 : 0) + (hn(x, y, 301) - 0.5) * 0.1));
      for (let x = 0; x < 14; x++) { G.set(x, 11, BWOOD[4]); G.set(x, 12, BWOOD[1]); }
      for (let y = 13; y < 18; y++) { G.set(0, y, BWOOD[4]); G.set(1, y, BWOOD[2]); G.set(12, y, BWOOD[3]); G.set(13, y, BWOOD[1]); }
      for (let y = 13; y < 16; y++) for (let x = 7; x < 12; x++) G.set(x, y, y === 13 ? BWOOD[3] : BWOOD[2]); G.set(9, 14, '#c8a050');
      // papers & notes
      G.rect(1, 7, 4, 3, '#d8d0b8'); G.set(1, 7, '#efe8d2'); G.set(2, 8, '#8a8270'); G.set(3, 8, '#8a8270'); G.set(2, 9, '#8a8270'); G.set(4, 9, '#b8b098');
      G.rect(3, 6, 3, 2, '#c8c0a4'); G.set(3, 6, '#e8e0c8'); G.set(4, 7, '#7a7260');
      G.set(6, 9, '#3a5a8a'); G.set(6, 10, '#2a4060');  // book
      // microscope
      for (let y = 0; y < 7; y++) { G.set(9, y, '#2a2e34'); G.set(10, y, y < 2 ? '#8a929c' : '#4a525c'); }
      G.set(10, 0, '#c8d0d8'); G.set(11, 3, '#4a525c'); G.set(11, 4, '#2a2e34'); G.set(8, 5, '#4a525c');
      G.rect(8, 7, 5, 2, '#3a4048'); G.set(8, 7, '#6a727c'); G.set(10, 6, '#7af0ff');
      // candle / lamp glow
      G.set(12, 5, '#fff0a0'); G.set(12, 6, '#e8e0c8'); G.set(12, 7, '#c8c0a8');
      addBase('b_research', G, OUTW);
    }
    // ---------------- recycler (green machine, gears) 16x22, 2 frames
    for (let f = 0; f < 2; f++) {
      const G = new Grid(14, 20);
      const GR = ['#1f3a24', '#2a4c2e', '#355e38', '#427042', '#52824e', '#66965c'];
      // hopper on top
      for (let y = 0; y < 5; y++) { const xl = 1 + y, xr = 12 - y; for (let x = 1; x < 13; x++) { if (x < Math.max(1, xl - 1) || x > Math.min(12, xr + 1)) continue; G.set(x, y, y === 0 ? (x < 4 ? BMET[5] : BMET[4]) : x < 7 ? BMET[3] : BMET[1]); } }
      for (let x = 3; x < 11; x++) G.set(x, 1, '#121316'); for (let x = 4; x < 10; x++) G.set(x, 2, '#1a1b1f');
      // body: top face + front
      box3(G, 0, 5, 14, 3, 12, GR, GR, { seed: 311, noise: 0.1 });
      for (let x = 0; x < 14; x++) G.set(x, 8, GR[5]);
      // big gear (rotates between frames)
      const gear = (cx, cy, rr, teeth, rot) => {
        for (let y = -rr - 1; y <= rr + 1; y++) for (let x = -rr - 1; x <= rr + 1; x++) {
          const d = Math.hypot(x, y), a = Math.atan2(y, x) + rot, tooth = Math.cos(a * teeth) > 0.2;
          if (d > rr + (tooth ? 1 : 0)) continue;
          let c = d < 1.2 ? '#2a2c30' : d < rr - 1.2 ? (x + y < 0 ? '#b8a060' : '#9a8448') : (x + y < 0 ? '#d8c070' : '#7a6838');
          G.set(cx + x, cy + y, c);
        }
      };
      gear(4, 13, 3, 4, f * 0.4); gear(9, 15, 2, 3, -f * 0.6);
      // lights, vents, chute
      G.set(11, 10, f ? '#40e070' : '#208a40'); G.set(12, 10, '#e04030');
      for (let x = 8; x < 13; x++) if (x % 2 === 0) G.set(x, 11, GR[0]);
      for (let y = 17; y < 20; y++) for (let x = 10; x < 14; x++) G.set(x, y, y === 17 ? BMET[4] : BMET[1]);
      for (let x = 0; x < 9; x++) G.set(x, 19, ((x >> 1) & 1) ? '#d9a435' : '#1e1b19');
      addBase('b_recycler' + f, G);
    }
    // ---------------- planter 16x18
    {
      const G = new Grid(14, 16);
      // soil surface (top face) and box front
      for (let y = 7; y < 10; y++) for (let x = 0; x < 14; x++) G.set(x, y, (x === 0 || x === 13 || y === 7) ? BWOOD[4] : ramp(['#2a1e16', '#3a2a1e', '#4a3626'], 0.5 + (hn(x, y, 321) - 0.5) * 0.8));
      for (let y = 10; y < 16; y++) for (let x = 0; x < 14; x++) {
        let t = 0.55 - (y - 10) * 0.05 + (x === 0 ? 0.1 : 0) - (x === 13 ? 0.2 : 0) + (hn(x, y, 322) - 0.5) * 0.15;
        if (y === 10) t += 0.25; if (y === 13) t -= 0.3;
        G.set(x, y, ramp(BWOOD, t));
      }
      // plants (three leafy sprouts, one with fruit)
      const L = ['#244a24', '#356a2e', '#4a8a3a', '#68a84a', '#8cc45e'];
      const plant = (cx, top, fruit) => {
        for (let y = top + 1; y < 8; y++) G.set(cx, y, L[1]);
        for (let k = 0; k < 3; k++) {          // alternating leaf pairs, lit on the left
          const y = top + 1 + k * 2;
          G.set(cx - 1, y, L[3]); G.set(cx - 2, y + 1, L[2]); G.set(cx - 1, y + 1, L[4]);
          G.set(cx + 1, y + 1, L[2]); G.set(cx + 2, y + 2, L[1]); G.set(cx + 1, y + 2, L[3]);
        }
        G.set(cx, top, L[4]); G.set(cx, top - 1, L[3]);
        if (fruit) { G.set(cx + 2, top + 3, '#c8342e'); G.set(cx - 2, top + 4, '#e04a3a'); G.set(cx + 2, top + 5, '#a82a26'); }
      };
      plant(3, 1, false); plant(7, 0, true); plant(11, 2, false);
      addBase('b_planter', G, OUTW);
    }
    // ---------------- water collector 16x22
    {
      const G = new Grid(14, 20);
      const BL = ['#122e48', '#1a4064', '#22547e', '#2c6896', '#3c80ac', '#5a9cc4'];
      const prof = [1, 3, 4, 4, 4, 3, 3, 3, 2, 2, 1, 0];
      for (let y = 7; y < 20; y++) for (let x = 1; x < 13; x++) {
        let i = prof[x - 1]; if (y === 10 || y === 15) i = Math.min(5, i + 1); if (y === 11 || y === 16) i = Math.max(0, i - 1); if (y === 19) i = Math.max(0, i - 1);
        G.set(x, y, BL[i]);
      }
      // tarp funnel catching rain
      for (let y = 0; y < 7; y++) { const xl = Math.round(y * 0.5), xr = 13 - Math.round(y * 0.5); for (let x = xl; x <= xr; x++) G.set(x, y, y === 0 ? '#8a9a6a' : (x < 7 ? ramp(OLIVE, 0.7 - y * 0.06) : ramp(OLIVE, 0.5 - y * 0.05))); }
      for (let x = 4; x < 10; x++) G.set(x, 1, '#1e4a6a'); for (let x = 5; x < 9; x++) G.set(x, 2, '#2c6896'); G.set(5, 1, '#5aa8d0'); // water pooled in the funnel
      G.set(0, 0, '#5a4a36'); G.set(13, 0, '#5a4a36');
      // brass tap + drip
      G.set(9, 17, '#e0b050'); G.set(10, 17, '#a8782a'); G.set(10, 18, '#7ac0e0');
      G.set(3, 12, '#7ab0d0'); G.set(3, 13, '#5a9cc4');
      addBase('b_water', G);
    }
    // ---------------- camp bed 16x18
    {
      const G = new Grid(14, 16);
      // frame top
      for (let y = 1; y < 13; y++) for (let x = 0; x < 14; x++) G.set(x, y, (x === 0 || x === 13) ? (x === 0 ? '#6a7076' : '#3a3e44') : null);
      // mattress / blanket
      for (let y = 1; y < 13; y++) for (let x = 1; x < 13; x++) {
        let c;
        if (y < 4) c = (y === 1 ? '#e8e0c8' : x < 7 ? '#d0c8ae' : '#b0a890');   // pillow
        else { let t = 0.65 - (x - 1) * 0.03 + (y === 4 ? 0.25 : 0) + (y === 7 ? -0.2 : 0) + (hn(x, y, 331) - 0.5) * 0.12; if (x === 12) t -= 0.2; c = ramp(OLIVE, t); }
        G.set(x, y, c);
      }
      G.set(2, 1, '#f4eedc'); G.set(12, 2, '#8a8270');
      for (let x = 1; x < 13; x++) G.set(x, 4, x % 3 === 0 ? '#a8b07a' : '#8a9660'); // folded edge
      // front rail + legs
      for (let x = 0; x < 14; x++) { G.set(x, 13, '#7a8086'); G.set(x, 14, '#3a3e44'); }
      G.set(0, 15, '#3a3e44'); G.set(1, 15, '#2a2e34'); G.set(12, 15, '#3a3e44'); G.set(13, 15, '#2a2e34');
      G.set(0, 0, '#6a7076'); G.set(13, 0, '#3a3e44');
      addBase('b_bed', G);
    }
    // ---------------- quarry (drill rig) 16x26, 2 frames
    for (let f = 0; f < 2; f++) {
      const G = new Grid(14, 24);
      const Y = ['#5a3e12', '#8a6018', '#b8821e', '#d8a02a', '#f0c048'];
      // A-frame derrick
      G.line(1, 22, 6, 1, BMET[4]); G.line(12, 22, 7, 1, BMET[1]); G.line(2, 22, 6, 2, BMET[2]);
      for (const yy of [7, 13, 18]) { const k = (yy - 1) / 21; G.line(Math.round(lerp(6, 1, k)), yy, Math.round(lerp(7, 12, k)), yy, BMET[3]); }
      G.rect(5, 0, 4, 2, Y[3]); G.set(5, 0, Y[4]); G.set(8, 1, Y[1]);   // crown block
      // drill string moving
      const dy = f ? 3 : 0;
      for (let y = 2; y < 17 + dy; y++) { G.set(6, y, '#9aa0a6'); G.set(7, y, '#5a6066'); }
      G.rect(5, 6 + dy, 4, 3, Y[2]); G.set(5, 6 + dy, Y[4]); G.set(8, 8 + dy, Y[0]);   // drive head
      // engine box
      box3(G, 0, 15, 7, 2, 6, Y, Y, { seed: 341 });
      G.set(2, 18, '#1e1b19'); G.set(3, 18, '#1e1b19'); G.set(4, 18, '#1e1b19'); G.set(2, 19, '#3a3632'); G.set(4, 19, '#3a3632');
      G.set(1, 14, '#3a3e44'); G.set(1, 13, f ? '#8a8a8a' : '#5a5a5a');  // exhaust
      // ore pile
      for (let y = 19; y < 24; y++) for (let x = 8; x < 14; x++) if (Math.hypot((x + 0.5 - 11) / 3.2, (y + 0.5 - 23.5) / 4) < 1) G.set(x, y, ramp(ROCK, 0.75 - (y - 19) * 0.1 + (hn(x, y, 342 + f) - 0.5) * 0.5));
      G.set(10, 20, '#b56a38'); G.set(12, 22, '#e3c844');
      G.set(6, 23, '#3a3127'); G.set(7, 23, '#3a3127'); G.set(8, 23, '#2a231c');
      addBase('b_quarry' + f, G);
    }
    // ---------------- shotgun trap base (wooden box mount) 16x18
    {
      const G = new Grid(14, 16);
      box3(G, 1, 5, 12, 4, 7, WOOD, WOOD, { seed: 351, noise: 0.12 });
      for (let x = 1; x < 13; x++) { G.set(x, 9, WOOD[5]); G.set(x, 15, WOOD[0]); }
      for (let y = 9; y < 16; y++) { G.set(1, y, WOOD[4]); G.set(12, y, WOOD[1]); }
      G.line(2, 14, 11, 10, WOOD[4]); G.line(3, 14, 12, 10, WOOD[2]);
      // swivel plate where the gun head sits
      for (let x = 4; x < 10; x++) { G.set(x, 4, x < 6 ? '#9aa0a6' : '#6a7076'); G.set(x, 5, '#3a3e44'); }
      G.set(6, 3, '#4a4e54'); G.set(7, 3, '#4a4e54');
      G.set(10, 11, '#9aa0a6'); G.set(10, 12, '#5a5e64'); // tripwire spool
      G.set(11, 12, '#c8b47a'); G.set(12, 13, '#c8b47a');
      addBase('b_shotgun_trap', G, OUTW);
    }
    // ---------------- auto turret base (metal tripod) 16x20
    {
      const G = new Grid(14, 18);
      G.line(6, 9, 0, 17, BMET[4]); G.line(7, 9, 13, 17, BMET[1]); G.line(6, 9, 6, 16, BMET[2]); G.line(7, 9, 7, 16, BMET[1]);
      G.line(1, 17, 0, 17, BMET[3]); G.set(13, 17, BMET[0]); G.set(6, 17, BMET[3]); G.set(7, 17, BMET[1]);
      // battery / ammo box on the hub
      box3(G, 3, 8, 8, 2, 4, OLIVE, OLIVE, { seed: 361 }); G.set(5, 11, '#e0b050'); G.set(9, 11, '#40e070');
      // mast + bearing ring at the top (head pivot sits here)
      for (let y = 3; y < 8; y++) { G.set(6, y, BMET[5]); G.set(7, y, BMET[2]); }
      for (let x = 3; x < 11; x++) { G.set(x, 2, x < 6 ? BMET[5] : BMET[3]); G.set(x, 3, BMET[1]); }
      G.set(2, 3, BMET[2]); G.set(11, 3, BMET[0]);
      addBase('b_auto_turret', G);
    }
    // ---------------- rotating heads (pointing right, anchor = pivot)
    {
      // shotgun head: pivot hub + double barrel + wooden stock block
      const G = new Grid(12, 5);
      for (let x = 0; x < 4; x++) for (let y = 0; y < 5; y++) G.set(x, y, ramp(WOOD, 0.75 - y * 0.12 - x * 0.04));
      G.set(1, 2, '#c8ccd0'); G.set(2, 2, '#6a7076');
      for (let x = 4; x < 12; x++) { G.set(x, 1, '#8a929c'); G.set(x, 2, '#3a3e44'); G.set(x, 3, '#5a626c'); }
      G.set(11, 1, '#121316'); G.set(11, 3, '#121316'); G.set(7, 1, '#a8782a'); G.set(7, 2, '#7a5418'); G.set(7, 3, '#a8782a'); // wire wrap
      ART.add('b_shotgun_gun', ART.outline(G.canvas(), OUT), 2, 3);
    }
    {
      // turret head: armoured housing with sensor + barrel and muzzle brake
      const G = new Grid(14, 7);
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) { if ((x === 0 || x === 6) && (y === 0 || y === 6)) continue; G.set(x, y, ramp(BMET, 0.85 - y * 0.1 - x * 0.03)); }
      G.set(1, 1, BMET[5]); G.set(4, 2, '#e03030'); G.set(5, 2, '#ff8070'); G.set(4, 3, '#901818');   // sensor eye
      for (let x = 7; x < 13; x++) { G.set(x, 2, '#8a929c'); G.set(x, 3, '#3a3e44'); G.set(x, 4, '#2a2e34'); }
      G.rect(12, 1, 2, 5, '#4a525c'); G.set(12, 1, '#8a929c'); G.set(13, 3, '#121316');
      G.set(2, 5, '#d9a435'); G.set(3, 5, '#1e1b19'); G.set(4, 5, '#d9a435');
      ART.add('b_turret_gun', ART.outline(G.canvas(), OUT), 4, 4);
    }
  }

  ART.builders.push(function buildWorld() {
    for (const k in GROUND) ART.groundSet(k);
    buildRoads(); buildConcrete(); buildFloors(); buildWater(); buildWalls(); buildRoofs();
    buildNature(); buildProps(); buildBaseWalls(); buildBaseProps();
    // where a rotating head's pivot sits on its base sprite (sprite-local px)
    ART.TURRET_MOUNT = { b_auto_turret: { x: 8, y: 3, head: 'b_turret_gun' }, b_shotgun_trap: { x: 8, y: 5, head: 'b_shotgun_gun' } };
  });
})();
