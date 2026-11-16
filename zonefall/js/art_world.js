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
      if ([1, 4, 6].includes(v)) {
        const walk = (x, y, ang, steps, depth) => {
          for (let s2 = 0; s2 < steps; s2++) {
            ang += (r() - 0.5) * 1.3;
            const nx = clamp(Math.round(x + Math.cos(ang) * 1.6), 1, 14), ny = clamp(Math.round(y + Math.sin(ang) * 1.6), 1, 14);
            G.line(x, y, nx, ny, '#323136'); if (G.get(nx, ny + 1) !== '#323136') G.set(nx, ny + 1, def.lite[0]);
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
        const fc = v === 2 ? ['#e9e3c6', '#cbb76a'] : ['#c3a8d4', '#a088b6'];
        for (let k = 0; k < 2; k++) { const x = ix(), y = iy(); G.set(x, y, fc[0]); G.set(x - 1, y, fc[1]); G.set(x + 1, y, fc[1]); G.set(x, y - 1, fc[1]); G.set(x, y + 1, def.dark); }
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
      const BT = ['#694638', '#704b3c', '#775141', '#7e5746', '#855d4a'];
      wallSprite('wall_brick', brickTop(BT, '#714a3b', 31, 8, 4), brickFront(B, '#6e5f55', '#b08a70', '#3a211c', 32, 8, 3, 2, 0.6));
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
      let v = 0.32 + b * 0.62 + (gfn ? gfn(px, py) : 0) + (hn(px, py, seed + 7) - 0.5) * (opt.noise ?? 0.22) + (bayer(px, py) - 0.5) * 0.18;
      if (d > r - 1.1 && (x + y) > r * 0.5) v -= 0.22;         // dark lower-right rim separates clumps
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
      const top = i === 0 ? 0 : Math.round(bot - (8 + i * 2.6));
      const hw = lerp(4.2, w / 2 - 0.6, k);
      T.push({ top, bot, hw, i });
    }
    for (let ti = tiers - 1; ti >= 0; ti--) {
      const { top, bot, hw, i } = T[ti];
      for (let y = top; y <= bot; y++) for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - (cx + 0.5), rel = (y - top) / Math.max(1, bot - top);
        const half = hw * Math.pow(0.12 + 0.88 * rel, 0.8);
        if (Math.abs(dx) > half + 0.3) continue;
        const ad = Math.abs(dx) / hw;
        const jag = ((Math.abs(Math.round(dx)) + i + (dx < 0 ? 1 : 0)) % 3 === 1) ? 1 : 0;
        const yb = bot - Math.round(1.6 * (1 - ad * ad)) - jag;
        if (y > yb) continue;
        let t = 0.6 - (dx / hw) * 0.38 + (rel - 0.45) * 0.42;
        if (y >= yb) t -= 0.22;                                      // underside of the needle fringe
        const st = dx < 0 ? (x + y) % 3 : (x - y + 300) % 3;          // needle strokes slanting outward-down
        if (st === 0) t += 0.12; else if (st === 2) t -= 0.06;
        t += (hn(x, y, seed) - 0.5) * 0.14;
        if (Math.abs(dx) < 0.8 && rel < 0.5 && i > 0) t += 0.05;
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
    const gfn = (x, y) => -((x - CX) / RX) * 0.1 - ((y - CY) / RY) * 0.16;
    const cl = [{ x: CX, y: CY, r: Math.min(RX, RY) * 0.72 }];
    for (let i = 0; i < 13; i++) {
      const a = r() * Math.PI * 2, d = 0.45 + r() * 0.55;
      cl.push({ x: CX + Math.cos(a) * (RX - 4.2) * d, y: CY + Math.sin(a) * (RY - 3.8) * d - 0.5, r: 3.4 + r() * 1.9 });
    }
    cl.push({ x: CX - RX * 0.35, y: CY + RY * 0.55, r: 4 }, { x: CX + RX * 0.3, y: CY + RY * 0.6, r: 4.2 }, { x: CX, y: CY - RY * 0.6, r: 4.4 });
    cl.sort((a, b) => a.y - b.y);
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
      const cl = [{ x: 3.5, y: 4.6, r: 3.2 }, { x: 8.2, y: 4.8, r: 3.3 }, { x: 6, y: 3.3, r: 3.4 }, { x: 5.8, y: 5.3, r: 2.6 }];
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

  // @@PARTS@@
  ART.builders.push(function buildWorld() {
    for (const k in GROUND) ART.groundSet(k);
    buildRoads(); buildConcrete(); buildFloors(); buildWater(); buildWalls(); buildRoofs();
    buildNature();
  });
})();
