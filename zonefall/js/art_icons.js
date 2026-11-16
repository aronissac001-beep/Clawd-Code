'use strict';
// ============================================================================
// ZONEFALL — Module C: inventory item icons + HUD/UI glyphs.
//   ART.icon(id)        -> 16x16 canvas, outlined pixel-art icon for any ITEMS key
//   ART.uiIcon(name, t) -> 16x16 canvas, light glyph with dark outline (optional tint)
//   ART.iconURL(id) / ART.uiIconURL(name) -> cached data-URLs of the above
// Icons are hand-placed ASCII pixel stamps plus a few procedural shapes. Each
// builder draws on a scratch 16x16 grid; the result is trimmed, centred, given
// a 1px dark outline (and a soft halo for artifacts). Light from the top-left.
// Everything is cached and nothing throws: unknown ids get a generic crate.
// ============================================================================
(function () {
  const P = ART.PAL;
  const OUT = '#181425';
  const HI = '#fff4d6', LO = '#1a1530';
  const iconCache = {}, rawCache = {}, uiCache = {}, urlCache = {};

  // ---------------------------------------------------------------- colour
  const lum = hex => { const [r, g, b] = ART.rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  // very dark item colours are lifted a little so they read on dark slots
  const lift = col => { const L = lum(col); return L < 0.3 ? ART.shade(col, (0.3 - L) * 1.25) : col; };
  // 5-step ramp, hue-shifted: warm highlights, cool purple shadows
  function ramp(col) {
    const b = lift(col);
    return { 1: ART.mix(b, HI, 0.55), 2: ART.mix(b, HI, 0.25), 3: b, 4: ART.mix(b, LO, 0.36), 5: ART.mix(b, LO, 0.6) };
  }
  const shiftR = (R, n) => { const o = {}; for (let i = 1; i <= 5; i++) o[i] = R[Math.max(1, Math.min(5, i + n))]; return o; };
  const asChars = (R, keys) => { const o = {}; keys.split('').forEach((k, i) => { o[k] = R[i + 1]; }); return o; };

  // material ramps
  const RW = { 1: '#f3c999', 2: P.tan, 3: P.clay, 4: P.brown, 5: P.darkbrown };          // wood
  const RS = { 1: '#eef2f8', 2: P.silver, 3: P.steel, 4: P.slate, 5: P.navy };           // steel
  const RG = { 1: '#eceef0', 2: '#c9ccd1', 3: '#9ea3a9', 4: '#6c7178', 5: '#45484f' };   // neutral grey
  const RDG = { 1: '#b0b4ba', 2: '#8d9198', 3: '#6d7178', 4: '#4c4f57', 5: '#34353c' };  // dark ore rock
  const RBR = { 1: '#fbedb8', 2: '#f0cf7a', 3: '#d0a84a', 4: '#97702e', 5: '#5e4220' };  // brass
  const RCU = { 1: '#f4b27c', 2: P.orange, 3: P.rust, 4: '#8a3324', 5: '#5a2420' };      // copper
  const RWH = { 1: '#ffffff', 2: '#ffffff', 3: '#eef1f5', 4: P.silver, 5: P.steel };     // white (UI)

  // fixed palette characters shared by all ASCII stamps
  const FIX = {
    o: OUT, k: P.ink, h: '#ffffff', s: P.silver, m: P.steel, n: P.slate, N: P.navy,
    w: P.tan, W: P.clay, v: P.brown, V: P.darkbrown, p: P.sand, q: ART.mix(P.sand, P.clay, 0.4),
    y: P.yellow, g: P.gold, G: ART.mix(P.gold, P.brown, 0.55), r: P.red, R: P.blood, f: P.flame, u: P.orange, t: P.rust,
    l: P.lime, L: P.green, D: P.darkgreen, b: P.sky, B: P.blue, c: P.cyan, e: P.plum,
    a: RG[2], A: RG[3], X: RG[4], Z: RG[5],
    Y: RBR[2], H: RBR[3], I: RBR[4], U: RBR[5],
  };
  // UI glyph palette: everything collapses to white / cool greys
  const UIPAL = Object.assign({}, FIX, {
    s: P.silver, m: P.steel, n: P.slate, N: P.navy, w: P.silver, W: P.steel, v: P.slate, V: P.navy, p: '#ffffff', q: P.silver,
    a: '#eef1f5', A: P.silver, X: P.steel, Z: P.slate, y: '#ffffff', g: '#ffffff', G: P.silver, r: P.steel, R: P.slate,
    u: P.silver, t: P.steel, Y: '#ffffff', H: P.silver, I: P.steel, U: P.slate, l: '#ffffff', L: P.silver, D: P.steel, b: P.silver, B: P.steel, c: '#ffffff',
  });

  // ---------------------------------------------------------------- drawing
  const W16 = 16;
  const cv = () => { const c = document.createElement('canvas'); c.width = c.height = W16; let g; try { g = c.getContext('2d', { willReadFrequently: true }); } catch (e) { g = null; } g = g || c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; };
  function stamp(g, rows, x, y, pal) {
    for (let j = 0; j < rows.length; j++) {
      const r = rows[j];
      for (let i = 0; i < r.length; i++) {
        const ch = r[i]; if (ch === '.' || ch === ' ') continue;
        const col = pal[ch]; if (!col) continue;
        g.fillStyle = col; g.fillRect(x + i, y + j, 1, 1);
      }
    }
  }
  // mirror a left half (last column = centre) into a symmetric sprite
  function mirror(rows, map) {
    return rows.map(r => {
      const back = r.slice(0, -1).split('').reverse().map(ch => (map && map[ch]) || ch).join('');
      return r + back;
    });
  }
  // shape tests (pixel centres)
  const ell = (cx, cy, rx, ry) => (x, y) => { const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; return dx * dx + dy * dy <= 1; };
  const rectT = (x0, y0, w, h) => (x, y) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
  const poly = pts => (x, y) => {
    const px = x + 0.5, py = y + 0.5; let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const union = (...ts) => (x, y) => ts.some(f => f(x, y));
  const minus = (a, b) => (x, y) => a(x, y) && !b(x, y);

  // Fill a shape with a ramp: diagonal top-left -> bottom-right gradient plus a
  // 1px bevel (lit top/left edges, shaded bottom/right edges).
  function shape(g, test, R, opt) {
    opt = opt || {};
    const ins = (x, y) => x >= 0 && y >= 0 && x < W16 && y < W16 && test(x, y);
    let x0 = W16, y0 = W16, x1 = -1, y1 = -1;
    for (let y = 0; y < W16; y++) for (let x = 0; x < W16; x++) if (ins(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, gr = opt.grad || [0.36, 0.7], gx = opt.gx == null ? 1 : opt.gx, gy = opt.gy == null ? 1 : opt.gy;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!ins(x, y)) continue;
      let lv;
      if (opt.base) lv = opt.base(x, y);
      else if (opt.flat) lv = 3;
      else { const tt = ((x - x0 + 0.5) / bw * gx + (y - y0 + 0.5) / bh * gy) / (gx + gy); lv = tt < gr[0] ? 2 : tt < gr[1] ? 3 : 4; }
      if (opt.bevel !== false) {
        if (!ins(x, y - 1)) lv--; if (!ins(x - 1, y)) lv--;
        if (!ins(x, y + 1)) lv++; if (!ins(x + 1, y)) lv++;
      }
      if (opt.mod) lv = opt.mod(x, y, lv);
      lv = Math.max(opt.min || 1, Math.min(opt.max || 5, lv));
      g.fillStyle = R[lv]; g.fillRect(x, y, 1, 1);
    }
  }

  // builder context
  function ctx(g, pal, R) {
    return {
      g, P: pal, R,
      S(rows, x, y, extra) { stamp(g, rows, x || 0, y || 0, extra ? Object.assign({}, pal, extra) : pal); },
      px(x, y, ch) { const c = pal[ch] || ch; g.fillStyle = c; g.fillRect(x | 0, y | 0, 1, 1); },
      clear(x, y, w, h) { g.clearRect(x, y, w || 1, h || 1); },
      shape(test, RR, opt) { shape(g, test, RR || R, opt); },
      line(x0, y0, x1, y1, ch) { ART.line(g, x0, y0, x1, y1, pal[ch] || ch); },
    };
  }

  // trim, centre in 16x16, outline in place, optional glow
  function finish(src, opt) {
    opt = opt || {};
    const d = src.getContext('2d').getImageData(0, 0, W16, W16).data;
    let x0 = W16, y0 = W16, x1 = -1, y1 = -1;
    for (let y = 0; y < W16; y++) for (let x = 0; x < W16; x++) if (d[(y * W16 + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const [c, g] = cv();
    if (x1 < 0) return c;
    const w = Math.min(14, x1 - x0 + 1), h = Math.min(14, y1 - y0 + 1);
    const dx = Math.floor((W16 - w) / 2), dy = Math.floor((W16 - h + 1) / 2);
    g.drawImage(src, x0, y0, w, h, dx, dy, w, h);
    outlineIn(c, opt.out || OUT);
    if (opt.glow) glow(c, opt.glow);
    return c;
  }
  function outlineIn(c, col) {
    const g = c.getContext('2d'), im = g.getImageData(0, 0, W16, W16), d = im.data;
    const a = (x, y) => x >= 0 && y >= 0 && x < W16 && y < W16 && d[(y * W16 + x) * 4 + 3] > 0;
    const pts = [];
    for (let y = 0; y < W16; y++) for (let x = 0; x < W16; x++) if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) pts.push([x, y]);
    g.fillStyle = col; for (const [x, y] of pts) g.fillRect(x, y, 1, 1);
  }
  function glow(c, col) {
    const g = c.getContext('2d'), d = g.getImageData(0, 0, W16, W16).data;
    const a = (x, y) => x >= 0 && y >= 0 && x < W16 && y < W16 && d[(y * W16 + x) * 4 + 3] > 0;
    const [r, gg, b] = ART.rgb(col);
    for (let y = 0; y < W16; y++) for (let x = 0; x < W16; x++) {
      if (a(x, y)) continue;
      let n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (a(x + i, y + j)) n++;
      if (n) { g.fillStyle = `rgba(${r},${gg},${b},${n >= 3 ? 0.5 : 0.32})`; g.fillRect(x, y, 1, 1); }
    }
  }

  // ================================================================ ITEM ART
  const IC = {};   // by item id
  const TPL = {};  // by item.icon (fallback templates)

  // ---------- resources
  const LOG = ['.2222222pp.', '3343333pwwp', '3333433pwWp', '4444444pwwp', '.5555555pp.'];
  IC.wood = t => { t.S(LOG, 3, 1); t.S(['.v', 'v.'], 4, 0); t.S(LOG, 0, 6); };

  IC.stone = t => {
    const big = poly([[2.5, 0.5], [8, 0], [11.5, 2], [12.5, 6.5], [10.5, 10], [2, 10], [0, 6], [0.5, 3]]);
    t.shape(big, t.R, { grad: [0.4, 0.72] });
    t.S(['...4', '..4.', '.4..', '..4.'], 5, 3); // crack
    t.S(['11', '1.'], 3, 2);
    t.shape(ell(12, 10, 2.6, 2.1), t.R, { grad: [0.45, 0.8] });
    t.shape(ell(1.8, 11, 1.8, 1.3), t.R);
  };

  function ore(t, speckCol) {
    const rock = poly([[2.5, 1], [8, 0], [12, 1.5], [13.8, 7], [11.5, 11.5], [3, 11.8], [0, 7.5], [0.5, 3.5]]);
    t.shape(rock, RDG, { grad: [0.38, 0.7] });
    t.S(['.4', '4.', '4.'], 9, 2, { 4: RDG[4] });
    const S = ramp(speckCol);
    const spots = [[3, 3, 2], [8, 3, 2], [5, 6, 2], [10, 7, 2], [2, 8, 1], [7, 9, 2], [11, 4, 1], [5, 1, 1]];
    for (const [x, y, s] of spots) {
      if (!rock(x, y)) continue;
      if (s === 1) { t.px(x, y, S[1]); continue; }
      t.px(x, y, S[1]); t.px(x + 1, y, S[2]); t.px(x, y + 1, S[3]); t.px(x + 1, y + 1, S[4]);
    }
  }
  IC.metal_ore = t => ore(t, '#e07a3a');
  IC.sulfur_ore = t => ore(t, '#f2df4a');
  IC.hqm_ore = t => ore(t, '#62c4ff');
  TPL.ore = (t, def) => ore(t, def.col);

  IC.metal = t => {
    t.shape(poly([[0.5, 2.5], [8.5, 0.5], [10, 5.5], [2, 7.5]]), t.R, { grad: [0.45, 0.8] });
    t.px(2, 3, 'N'); t.px(8, 2, 'N'); t.px(3, 6, 'N'); t.S(['111'], 4, 2);
    t.shape(poly([[6, 8.5], [13.8, 6.5], [12.5, 13.5], [4, 12.8]]), t.R, { grad: [0.35, 0.7] });
    t.px(7, 10, 'N'); t.px(11, 9, 'N'); t.S(['11'], 9, 8);
    t.shape(poly([[0.3, 9.5], [3.8, 9], [1.8, 13.6]]), t.R);
  };
  TPL.plate = IC.metal;

  const ING = ['..11111111.', '.1222222221', '12222222224', '33333333345', '43233333345', '.444444445.'];
  IC.hqm = t => { t.S(ING, 3, 0); t.S(ING, 0, 4); t.S(['1', '.1'], 2, 5); };
  TPL.ingot = IC.hqm;

  function heap(t, R, seed, grains) {
    const cx = 7, top = 3, hh = 9, hw = 6.9;
    const test = (x, y) => { const yy = y - top; if (yy < 0 || yy >= hh) return false; const w = hw * Math.pow((yy + 1) / hh, 0.55); return Math.abs(x + 0.5 - cx) <= w; };
    t.shape(test, R, { grad: [0.42, 0.72] });
    const rnd = ART.rng(seed);
    for (const [col, n] of grains) for (let i = 0; i < n; i++) {
      const x = (rnd() * 14) | 0, y = (rnd() * 13) | 0;
      if (test(x, y) && test(x, y + 1) && test(x - 1, y) && test(x + 1, y)) t.px(x, y, col);
    }
    return test;
  }
  IC.sulfur = t => { heap(t, t.R, 11, [[t.R[1], 7], [t.R[4], 6], ['#ffffff', 2]]); t.S(['h', 'y'], 5, 4); };
  IC.gunpowder = t => { heap(t, t.R, 23, [[t.R[5], 16], [t.R[1], 5]]); };
  IC.charcoal = t => {
    const R = { 1: '#9aa0ae', 2: '#62666f', 3: '#3e4048', 4: '#2a2b32', 5: '#1f1f25' };
    const lumps = [[3, 9, 3, 2.6], [10, 9.5, 3.4, 2.6], [6.5, 5.5, 3.2, 2.6], [11.5, 4.5, 2.2, 2], [6.5, 11, 3, 2], [2, 4.5, 1.8, 1.6]];
    for (const [x, y, rx, ry] of lumps) t.shape(ell(x, y, rx, ry), R, { grad: [0.4, 0.7] });
  };
  TPL.powder = (t, def) => heap(t, t.R, 7, [[t.R[5], 10], [t.R[1], 5]]);

  function gear(t, R, cx, cy, ro, ri, rh, n, rot, opt) {
    const test = (x, y) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      if (d < rh) return false; if (d <= ri) return true; if (d > ro) return false;
      return Math.cos((Math.atan2(dy, dx) + rot) * n) > -0.05;
    };
    t.shape(test, R, opt || { grad: [0.4, 0.68] });
    return test;
  }
  IC.scrap = t => {
    gear(t, t.R, 6, 6, 6.1, 4.4, 1.6, 8, 0.2);
    t.px(4, 4, t.R[1]);
    const nut = poly([[9.3, 8.6], [12.7, 8.6], [14.2, 11.3], [12.7, 14], [9.3, 14], [7.8, 11.3]]);
    t.shape(nut, RG, { grad: [0.4, 0.7] }); t.clear(10, 10, 2, 2);
  };
  IC.gears = t => {
    gear(t, t.R, 5.5, 8.5, 5.6, 4, 1.6, 8, 0);
    gear(t, shiftR(t.R, -1), 11.5, 3.8, 3.7, 2.6, 1.1, 6, 0.3);
  };
  TPL.gear = (t) => IC.gears(t);

  const FOLD = ['.1111111111.', '122222222223', '233333333334', '.4444444445.'];
  IC.cloth = t => {
    t.S(FOLD, 1, 7); t.S(FOLD, 0, 4, asChars(shiftR(t.R, 1), '12345')); t.S(FOLD, 1, 0);
    t.S(['4.4.4.4.4'], 3, 1); t.S(['5.5.5.5'], 3, 5);
  };
  TPL.cloth = IC.cloth;

  // ---------- components
  IC.pipe = t => {
    for (let k = 0; k <= 8; k++) t.S(['12334'], k, 12 - k);
    t.S(['22334'], 1, 11, { 2: t.R[1] });
    t.S(['.2.', '1.3'], 0, 11);
    // threaded coupling at the far end + open mouth
    t.S(['.22334', '122345', '12345'], 7, 2, { 2: RS[2], 3: RS[3], 4: RS[4], 5: RS[5], 1: RS[1] });
    t.S(['..1kk5', '.1kk5', '.k5'], 9, 0);
  };
  TPL.pipe = IC.pipe;

  IC.spring = t => {
    const R = t.R, cx = 6.5, turns = 3.5, y0 = 1.5, pts = [];
    for (let i = 0; i <= 720; i++) { const th = i / 720 * Math.PI * 2 * turns; pts.push([cx + Math.cos(th) * 4.6, y0 + th / (Math.PI * 2) * 3.2 + Math.sin(th) * 1.9, Math.sin(th)]); }
    for (const [x, y, s] of pts) if (s < 0) t.px(x, y, R[5]);
    for (const [x, y, s] of pts) if (s >= 0) t.px(x, y, x < cx - 1.8 ? R[1] : x < cx + 1.8 ? R[2] : R[3]);
  };
  TPL.spring = IC.spring;

  IC.circuit = t => {
    t.shape(rectT(0, 0, 13, 9), t.R, { flat: true });
    t.S([
      '.............',
      '.ggg..g...gg.',
      '...g.kkkk..g.',
      '.g.g.knkk..g.',
      '.ggggkkkk.gg.',
      '.....kkkk.g..',
      '.rR.......g..',
      '.RR..ggggggg.',
    ]);
    t.S(['g.g.g.g.g'], 2, 9);
  };
  TPL.chip = IC.circuit;

  IC.rope = t => {
    const cx = 6.5, cy = 6, R = t.R;
    const ring = (x, y) => { const dx = (x + 0.5 - cx) / 6.4, dy = (y + 0.5 - cy) / 5.2, d = Math.sqrt(dx * dx + dy * dy); return d <= 1 && d >= 0.46; };
    t.shape(ring, R, { grad: [0.35, 0.68], mod: (x, y, lv) => (((x + y * 2) % 3) === 0 ? lv + 1 : lv) });
    t.shape(ell(cx, cy, 2.2, 1.6), shiftR(R, 2), { flat: true });
    t.clear(6, 5, 2, 2);
    t.S(['.23', '.23', '234', '34.', '4..'], 10, 9);
  };
  TPL.rope = IC.rope;

  IC.tape = t => {
    t.S([
      '....111122....',
      '..1122222233..',
      '.1222pppp2334.',
      '1222p....q3344',
      '1223p....q3344',
      '.2233qqqq3344.',
      'A2233333344445',
      'AA2333333444ZZ',
      '.AAXXXXXXXXZ34',
      '..AAXXXXXZZ.34',
      '............34',
      '............4.',
    ]);
  };
  TPL.tape = IC.tape;

  // ---------- valuables
  IC.cigs = t => t.S([
    '....uu....',
    '.uu.hh....',
    '.hh.hhuu..',
    '.hh.hhhh..',
    '1555555554',
    '1222222234',
    'rrrrrrrrrR',
    'rhhhhrrrrR',
    'rrrrrrrrrR',
    '1222222234',
    '1222222234',
    '1222222234',
    '3444444445',
  ]);
  TPL.box = IC.cigs;

  IC.rotgut = t => t.S([
    '...WW...',
    '...wv...',
    '...13...',
    '...23...',
    '..1234..',
    '.122334.',
    '1h223334',
    '1h223334',
    '1ppppqq4',
    '1pvpvpq4',
    '1ppppqq4',
    '1h223344',
    '.233344.',
    '..4455..',
  ]);
  TPL.bottle = IC.rotgut;

  IC.watch = t => t.S([
    '....222....',
    '...2...4...',
    '....234....',
    '..1222223..',
    '.12hhhhhp3.',
    '12hhhkhhhp4',
    '12hhhkhhhp4',
    '12hhhkkkhp4',
    '12hhhhhhhp4',
    '13phhhhhpp4',
    '.34ppppp44.',
    '..3444445..',
  ]);
  TPL.watch = IC.watch;

  IC.chain = t => {
    const RING = ['.2.', '1.3', '.4.'], BAR = ['3', '4'];
    for (const [x, y] of [[0, 0], [0, 4], [1, 7], [10, 0], [10, 4], [9, 7]]) t.S(RING, x, y);
    for (const [x, y] of [[1, 3], [11, 3]]) t.S(BAR, x, y);
    t.S(['3'], 3, 9); t.S(['3'], 9, 9);
    t.S(['.122.', '12223', '22r34', '23344', '.344.'], 4, 9, { r: P.red });
  };
  TPL.chain = IC.chain;

  IC.intel = t => t.S([
    '.11112........',
    '12222211111112',
    '12hhhhhhhhhh34',
    '12hqqqqqqhhh34',
    '11111111111113',
    '12222222222224',
    '12rrrrrrr22224',
    '12rRRrRRr22224',
    '12rrrrrrr22224',
    '12222222222224',
    '34444444444445',
  ]);
  TPL.folder = IC.intel;

  IC.gpu = t => t.S([
    'aAAAAAAAAAAAAA',
    'aXkkkXXXXkkkXX',
    'akZAZkXXkZAZkX',
    'akAaAkXrkAaAkX',
    'akZAZkXXkZAZkX',
    'aXkkkXXXXkkkXX',
    'aZZZZZZZZZZZZZ',
    'a2222222222223',
    'a...gggggggg..',
  ]);
  TPL.gpu = IC.gpu;

  IC.idol = t => t.S([
    '...1122...',
    '..122223..',
    '..2l22l3..',
    '..122234..',
    '...2334...',
    '.11222334.',
    '1222l23334',
    '122lhl3334',
    '1222l23344',
    '.12223344.',
    '1222333344',
    '5444444445',
  ], 0, 0, { l: P.lime });
  TPL.idol = IC.idol;

  // ---------- meds
  IC.bandage = t => {
    const R = t.R, cx = 5.5, cy = 5.5;
    t.shape(ell(cx, cy, 5.4, 5.4), R, { grad: [0.42, 0.75] });
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      t.px(cx + Math.cos(a) * 3.3, cy + Math.sin(a) * 3.3, FIX.q);
      t.px(cx + Math.cos(a) * 1.4, cy + Math.sin(a) * 1.4, R[4]);
    }
    t.px(5, 5, R[5]);
    t.S(['22222221', '33333334', '4444444.'], 6, 9);
    t.S(['.1.1', '1.1.'], 11, 8, { 1: R[3] });
    t.S(['rr'], 9, 10, { r: P.red });
  };
  TPL.bandage = IC.bandage;

  IC.medkit = t => t.S([
    '....nnnnn....',
    '....n...n....',
    '1111111111112',
    '1222222222223',
    '4444444444445',
    '2333333333334',
    '23333hhh33334',
    '233hhhhhhh334',
    '233hhhhhhq334',
    '233qqhhhqq334',
    '23333hhq33334',
    '23333qqq33334',
    '4555555555555',
  ]);
  TPL.medkit = IC.medkit;

  IC.stim = t => t.S([
    '.............a',
    '............a.',
    '...........a..',
    '.........aAX..',
    '........h234..',
    '.......h235...',
    '......h234....',
    '.....h235.....',
    '....h234......',
    '...h234.......',
    '.aaaaAX.......',
    '..AX..........',
    'aaAX..........',
  ]);
  TPL.syringe = IC.stim;

  IC.antirad = t => {
    t.S([
      '.hhhhhha.',
      'hhhhhhhaA',
      'aaaaaaaAX',
      '.1222223.',
      '122222334',
      '1yyyyyyy4',
      '1kkykkyy4',
      '1yykyyyy4',
      '1ykkkyyy4',
      '1yyyyyyy4',
      '122222334',
      '122222334',
      '.3444445.',
    ], 0, 0, { y: P.yellow });
    t.S(['hh33', 'qq44'], 10, 11);
  };
  TPL.pill = IC.antirad;

  IC.canned = t => t.S([
    '..ssssss..',
    '.sammmAms.',
    'sammmmmmmn',
    'ssssssssnn',
    '1222222334',
    '12pppp2334',
    '12prrp2334',
    '12pppp2334',
    '1222222334',
    '1222222334',
    'ssssssssnn',
    '.nnnnnnnN.',
  ]);
  TPL.can = IC.canned;

  // ---------- ammo
  const P_RND = ['.wu.', 'wuut', 'uutt', '1234', '1234', '1234', '1234', '3445'];
  IC.pistol_ammo = t => { t.S(P_RND, 0, 1); t.S(P_RND, 5, 0); t.S(P_RND, 10, 1); };
  TPL.ammo = IC.pistol_ammo;

  const rifleRound = tip => [tip[0], tip[1], tip[1], '.12.', '1223', '1234', '1234', '1234', '1234', '1234', '1234', '1234', '3445'];
  IC.rifle_ammo = t => { const r = rifleRound(['.wt.', '.ut.']); t.S(r, 0, 1); t.S(r, 5, 0); t.S(r, 10, 1); };
  IC.ap_ammo = t => {
    const r = rifleRound(['.67.', '.78.']); const B = ramp('#7088ff');
    const ex = Object.assign(asChars(RBR, '12345'), { 6: B[1], 7: B[3], 8: B[4] });
    t.S(r, 0, 1, ex); t.S(r, 5, 0, ex); t.S(r, 10, 1, ex);
    t.S(['kk'], 1, 4, {}); t.S(['kk'], 6, 3); t.S(['kk'], 11, 4);
  };
  TPL.ammo2 = IC.rifle_ammo;

  const SHELL = ['.33.', '1234', '1234', '1234', '1234', '1234', '1234', 'YHHI', 'YHHI', 'HIIU'];
  IC.shell = t => { t.S(SHELL, 0, 1); t.S(SHELL, 5, 0); t.S(SHELL, 10, 1); t.S(['2', '2'], 1, 3); };
  TPL.shell = IC.shell;

  IC.grenade = t => {
    const body = ell(5.5, 9.5, 4.7, 4.8);
    t.shape(body, t.R, { grad: [0.4, 0.72], mod: (x, y, lv) => ((x % 3 === 1 || y % 3 === 0) && body(x, y - 1) && body(x, y + 1) && body(x - 1, y) && body(x + 1, y)) ? lv + 1 : lv });
    t.S([
      '.aa.........',
      'a..a........',
      'a..aaaaaa...',
      '.aa.aAAAAa..',
      '....XXXXXAa.',
      '..........A.',
      '..........A.',
      '..........X.',
    ], 0, 0);
  };
  TPL.grenade = IC.grenade;

  // ---------- guns (pointing right)
  IC.pipe_pistol = t => t.S([
    '.n...........',
    '.223ssasssass',
    '.233mmAmmmAmn',
    '.334nnXnnnXnN',
    '.2334o.......',
    '2334.........',
    'aaAX.........',
    '2344.........',
    '3445.........',
  ]);
  TPL.pistol = IC.pipe_pistol;

  IC.revolver = t => t.S([
    '..5..........3',
    '..432222111111',
    '..332424333334',
    '.wW43535nnnn..',
    'wWWv4445......',
    'wWv..o5.......',
    'WWv..55.......',
    'Wvv...........',
    'vV............',
  ]);
  TPL.revolver = IC.revolver;

  IC.boomstick = t => t.S([
    '.....mmsssssss',
    '22...mnnnnnnnn',
    '23322mnsssssss',
    '33334nNnnnnnnN',
    '3344.o2223....',
    '344...........',
    '45............',
  ]);
  IC.pump = t => t.S([
    '....2222111113',
    '22..3333444444',
    '23323334242433',
    '33334445353544',
    '3344..o.4545..',
    '344...........',
    '45............',
  ]);
  TPL.shotgun = IC.pump;

  IC.smg = t => t.S([
    '....3....3....',
    '22222222222...',
    '2..333kk334nkn',
    '3..44444444NnN',
    '34434.o34.....',
    '...34..34.....',
    '..34....34....',
    '..45....45....',
  ]);
  TPL.smg = IC.smg;

  IC.ar = t => t.S([
    '....2222....3.',
    'wwww333322223.',
    'WWWW4334www223',
    'WWvv4455WWv...',
    'vV..4outt.....',
    '...45.utt.....',
    '...5...utt....',
    '........tt....',
  ]);
  TPL.rifle = IC.ar;

  IC.hunting = t => t.S([
    '.....nmmmmnc..',
    '.....NnnnnNb..',
    '22....N..N....',
    '33222nsssssssm',
    '33334nm222224.',
    '3344.ok44444..',
    '.45...........',
  ]);
  TPL.sniper = IC.hunting;

  // ---------- melee / tools (diagonal, head top-right)
  IC.knife = t => t.S([
    '..........1',
    '.........13',
    '........134',
    '.......1t4.',
    '......134..',
    '.....134...',
    '...nnN.....',
    '..wWv......',
    '.aAX.......',
    'wWv........',
    'NV.........',
  ]);
  IC.machete = t => t.S([
    '...........11.',
    '..........1234',
    '.........1234.',
    '........1234..',
    '.......1t34...',
    '......1234....',
    '.....1234.....',
    '....1234......',
    '...1234.......',
    '..nnN.........',
    '.XaZ..........',
    'XZk...........',
    'aZ............',
  ]);
  TPL.blade = IC.machete;

  function axe(t, R, handle, lash, chips) {
    for (let y = 3; y <= 14; y++) { const x = 15 - y; t.px(x, y, handle[0]); t.px(x + 1, y, handle[1]); }
    const head = poly([[8.6, 9], [12, 5.6], [7.6, 0.4], [1.2, 6.8]]);
    t.shape(head, R, { base: (x, y) => { const s = x + y; return s <= 8 ? 1 : s <= 10 ? 2 : s <= 13 ? 3 : 4; } });
    if (chips) for (const [x, y] of chips) if (head(x, y)) t.px(x, y, R[4]);
    for (const [x, y, ch] of lash) t.px(x, y, ch);
  }
  IC.hatchet = t => axe(t, t.R, ['w', 'v'], [[9, 7, 'p'], [10, 6, 'p'], [11, 5, 'q'], [10, 7, 'q'], [11, 6, 'q'], [12, 4, 'p']], [[6, 3], [5, 5], [8, 4]]);
  IC.salv_axe = t => {
    axe(t, t.R, ['s', 'n'], [[10, 6, 'k'], [11, 5, 'X'], [9, 7, 'X']], []);
    t.S(['aA', 'aA', 'aA'], 2, 11); t.S(['aA', 'aA'], 1, 13);
  };
  TPL.axe = IC.hatchet;

  const PICK = [
    '.....222222...',
    '...2233333333.',
    '..233....p.34.',
    '.23......pW.34',
    '.3......wvp.34',
    '.......wv...34',
    '......wv....34',
    '.....wv.....34',
    '....wv......34',
    '...wv......34.',
    '..wv.......34.',
    '.wv.......34..',
    'wv.......44...',
    'v.............',
  ];
  IC.pickaxe = t => { t.S(PICK); t.S(['4', '.4'], 4, 1); };
  IC.salv_pick = t => { t.S(PICK, 0, 0, { w: P.silver, v: P.slate, p: RG[2], W: RG[4] }); t.S(['aA', 'aA'], 1, 10); t.S(['a'], 0, 12); };
  TPL.pick = IC.pickaxe;

  // ---------- armour
  const VEST = [
    '..12.....23..',
    '.1222...2234.',
    '.12222.22234.',
    '1222223222334',
    '1222223222334',
    '1222222222334',
    '1222222222334',
    '1222222222334',
    '4444444444445',
    '1233233233334',
    '1233233233334',
    '3444444444445',
  ];
  IC.vest_scrap = t => {
    t.S(VEST);
    t.S(['aaA', 'aAX', 'AXX'], 1, 4, { a: RG[2] }); t.px(1, 4, 'k');
    t.S(['ut', 'tt', 'tV'], 9, 5); t.px(10, 5, 'k');
    t.S(['W.W', '.W.'], 5, 6);
  };
  IC.vest_sign = t => {
    t.S(VEST);
    for (let y = 4; y <= 7; y++) for (let x = 0; x <= 12; x++) if ((x + y) % 4 === 0) t.px(x, y, (x < 6 ? FIX.k : FIX.k));
    t.S(['hr', 'rR'], 2, 9);
  };
  IC.vest_plate = t => {
    t.S(VEST);
    t.S(['22222', '23333', '23333', '34444'], 4, 4, { 2: t.R[1], 3: t.R[2], 4: t.R[4] });
    t.S(['6666'], 2, 2, { 6: '#9a9a6a' });
    t.S(['2.2..2.2..2', '4.4..4.4..4'], 1, 9, { 2: t.R[1], 4: t.R[5] });
  };
  IC.vest_heavy = t => {
    t.S(VEST);
    const PAUL = ['.1222.', '122223', '233334', '.4445.'];
    t.S(PAUL, 0, 0); t.S(PAUL, 7, 0);
    t.S(['5555555555555'], 0, 6); t.S(['1111111'], 3, 4);
    t.S(['g', 'G'], 6, 9);
  };
  TPL.vest = (t) => t.S(VEST);

  IC.hazmat = t => t.S([
    '...12223...',
    '..1222223..',
    '..2NNNNN3..',
    '..2NcNNN3..',
    '..22XaX34..',
    '.122222334.',
    '12222k22334',
    '12.22k223.4',
    '12.22k223.4',
    'kk.22233.kk',
    '...22.33...',
    '...23.34...',
    '...kk.kk...',
  ]);
  TPL.suit = IC.hazmat;

  // ---------- helmets
  IC.helm_bucket = t => t.S([
    '..12222223..',
    '..122t2233..',
    '.122t222334.',
    '.1kkkkkkkk4.',
    '.1222222334.',
    '1222222t3344',
    '122222223344',
    'aaaaaaaaaAAX',
    '.a........X.',
    '..a......X..',
    '...aAAAAX...',
  ]);
  IC.helm_gas = t => t.S([
    '...122223...',
    '..12222223..',
    '.1222222223.',
    '.2kkk22kkk3.',
    '12kcB22kcB34',
    '12kBB22kBB34',
    '.2kkk22kkk3.',
    '.1222333334.',
    '..23aAAX34..',
    '...3AkkX4...',
    '...3AAXX4...',
    '....XXZZ....',
  ]);
  TPL.mask = IC.helm_gas;
  IC.helm_riot = t => t.S([
    '....122223...',
    '..1122222234.',
    '.12222222234.',
    '.12222222234.',
    '12aaaaaaaaaX4',
    '2achbbbbbbBX4',
    '2acbbbbbbbBX5',
    '2abbbbbbbBBX5',
    '2aBBBBBBBBBX5',
    '.XXXXXXXXXXX.',
    '..5.......5..',
  ]);
  IC.helm_mil = t => {
    const dome = (x, y) => y <= 7 && ell(6.5, 8, 6.6, 7.6)(x, y);
    t.shape(dome, t.R, { grad: [0.35, 0.7] });
    t.shape(rectT(0, 7, 14, 2), t.R, { grad: [0.3, 0.6], gy: 0.2 });
    const rnd = ART.rng(5), C = { a: ART.mix(t.R[3], '#8a7448', 0.55), b: t.R[5] };
    for (let i = 0; i < 9; i++) { const x = 1 + ((rnd() * 11) | 0), y = 1 + ((rnd() * 5) | 0); if (dome(x, y) && dome(x + 1, y)) { const ch = i % 2 ? C.a : C.b; t.px(x, y, ch); t.px(x + 1, y, ch); } }
    t.S(['kk', 'ka', 'kk'], 12, 3); t.S(['nnnnnnn'], 3, 5);
    t.S(['V.......V', '.V.....V.', '..VVVVV..'], 3, 9);
  };
  TPL.helmet = IC.helm_bucket;

  // ---------- bags
  IC.bag_small = t => t.S([
    '...vvvvvvv...',
    '..v.......v..',
    '.v.........v.',
    '.v.........v.',
    '1111111111112',
    '1222222222234',
    '1222222222234',
    '4444aga444445',
    '1233aka333334',
    '1233333333334',
    '1233333333334',
    '3444444444445',
  ]);
  IC.bag_ruck = t => t.S([
    '..pppppppp..',
    '.pqqqqqqqqp.',
    '..qqqqqqqq..',
    '..12222223..',
    '.1222222223.',
    '.444v44v444.',
    '4223v33v3345',
    '4233v33v3345',
    '423444444345',
    '423222223345',
    '423233333345',
    '423344444345',
    '.5555555555.',
  ]);
  IC.bag_mil = t => t.S([
    '...vvvvvvvv...',
    '..1111111112..',
    '.122k2222k223.',
    '.123k3333k334.',
    '.444k4444k445.',
    '22323333333423',
    '23k3k3k3k3k434',
    '2333333333334',
    '23k3k3k3k3k434',
    '23424444444434',
    '23423333333434',
    '23424444444434',
    '.444555555544.',
  ]);
  TPL.bag = IC.bag_ruck;

  // ---------- keycards
  const CARD = [
    '.111111111111.',
    '12k22222222223',
    '12222222222223',
    '1ygg2hhhhhh223',
    '1gGG2hnnhnn223',
    '12222222222223',
    '14444444444443',
    '12222222222224',
    '.344444444444.',
  ];
  TPL.card = t => t.S(CARD);

  // ---------- artifacts (glow added in finish)
  IC.art_ember = t => {
    const R = t.R;
    const shard = (pts, core) => { t.shape(poly(pts), R, { grad: [0.42, 0.7] }); for (const [x, y] of core) t.px(x, y, P.yellow); };
    shard([[0.5, 4.5], [3.5, 6], [4.5, 12], [1, 12], [-0.2, 8]], [[1, 8], [2, 9], [2, 10]]);
    shard([[10, 2.5], [12.2, 6.5], [11, 12], [7.5, 12], [8.5, 6]], [[10, 6], [10, 7], [9, 8], [10, 9]]);
    shard([[6, -0.2], [8.6, 5], [7.8, 12.2], [3.6, 12.2], [3.6, 5]], [[5, 3], [6, 3], [5, 4], [6, 5], [6, 6], [5, 7], [6, 8], [6, 9]]);
    t.px(5, 1, '#ffffff'); t.px(6, 2, '#ffffff');
  };
  IC.art_moth = t => {
    const half = [
      '....k..',
      '.12..k.',
      '1h222.N',
      '1h2522n',
      '.12333n',
      '..1334n',
      '...234n',
      '..1h34n',
      '..1234n',
      '...34.N',
    ];
    t.S(mirror(half, { h: '1', 1: '2' }), 0, 0, { n: P.slate });
  };
  IC.art_bloom = t => {
    const cx = 6.5, cy = 6.5;
    const test = (x, y) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx); return r <= 3.2 + 3.3 * Math.pow(Math.abs(Math.cos(a * 4 + 0.39)), 0.7); };
    t.shape(test, t.R, { grad: [0.38, 0.7], mod: (x, y, lv) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, a = Math.atan2(dy, dx); return Math.abs(Math.cos(a * 4 + 0.39)) < 0.3 && Math.hypot(dx, dy) > 2.2 ? lv + 1 : lv; } });
    t.shape(ell(cx, cy, 2.3, 2.3), RCU, { grad: [0.45, 0.75] });
    t.px(5, 5, P.yellow);
  };
  IC.art_pearl = t => {
    const cx = 6, cy = 6, R = t.R;
    t.shape(ell(cx, cy, 5.6, 5.6), R, {
      grad: [0.42, 0.7], mod: (x, y, lv) => {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
        if (r < 1.7) return 5; return Math.sin(a * 2 + r * 1.3) > 0.55 ? lv - 1 : lv;
      }
    });
    t.S(['hh', 'h1'], 3, 2, { 1: R[1] });
  };
  IC.art_heart = t => t.S([
    '.112...223.',
    '12h22.22334',
    '1h222222334',
    '1h225222334',
    '12222552344',
    '.122225534.',
    '..1222534..',
    '...12334...',
    '....234....',
    '.....4.....',
  ]);
  TPL.art = IC.art_pearl;

  // ================================================================ SURVIVAL SET
  // (hunting, food, primitive gear, raiding tools)
  // rotated ellipse: rx along the axis at angle `ang` (radians)
  const rell = (cx, cy, rx, ry, ang) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    return (x, y) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry; return u * u + v * v <= 1; };
  };
  // capsule (thick segment) of radius r
  const seg = (x0, y0, x1, y1, r) => (x, y) => {
    const px = x + 0.5 - x0, py = y + 0.5 - y0, dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const k = L2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / L2)) : 0, ex = px - dx * k, ey = py - dy * k;
    return ex * ex + ey * ey <= r * r;
  };
  // shape given in rod-local coords: u along A->B, v across (positive = bottom-right side)
  const along = (ax, ay, bx, by, fn) => {
    const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
    let nx = -uy, ny = ux; if (nx + ny < 0) { nx = -nx; ny = -ny; }
    return (x, y) => { const px = x + 0.5 - ax, py = y + 0.5 - ay; return fn(px * ux + py * uy, px * nx + py * ny, L); };
  };
  // teardrop flame: round base centred on (cx, by - w/2), pointed tip h above the base line
  const flameT = (cx, by, w, h, lean) => union(ell(cx, by - w / 2, w / 2, w / 2), poly([[cx - w / 2, by - w / 2], [cx + w / 2, by - w / 2], [cx + (lean || 0), by - h]]));

  const RBONE = ramp('#e6dcc6');
  const RLEAF = { 1: P.lime, 2: P.lime, 3: P.green, 4: P.darkgreen, 5: P.deepgreen };
  const RFIRE = { 1: P.yellow, 2: P.gold, 3: P.flame, 4: P.rust, 5: P.blood };
  const RCORE = { 1: '#ffffff', 2: '#fff7c8', 3: P.yellow, 4: P.gold, 5: P.gold };
  const RSAND = ramp(P.sand);
  const ROPE = { p: P.sand, q: ART.mix(P.sand, P.clay, 0.4) };

  function spark(t, x, y) { t.px(x, y, 'h'); t.px(x - 1, y, 'y'); t.px(x + 1, y, 'g'); t.px(x, y - 1, 'y'); t.px(x, y + 1, 'f'); }
  function fire(t, cx, by, w, h, lean) {
    t.shape(flameT(cx, by, w, h, lean), RFIRE, { grad: [0.3, 0.75] });
    t.shape(flameT(cx + 0.2, by - 0.4, w * 0.5, h * 0.6, (lean || 0) * 0.6), RCORE, { grad: [0.45, 0.85], bevel: false });
  }

  // ---------- resources
  IC.explosives = t => {
    // three sticks bundled with grey tape, fuse curling out of the middle one
    const BODY = ['2134', '2134', '2134', '2134', '2134', '2134', '2134', '3445'];
    t.S(['.11.'].concat(BODY), 0, 5); t.S(['.11.'].concat(BODY), 8, 5); t.S(['.11.', '2134'].concat(BODY), 4, 4);
    t.S(['aaaaaaaaaaaA', 'XXXXXXXXXXXZ'], 0, 8);
    t.S(['..A', '.A.', 'A..'], 6, 1);
    spark(t, 10, 1);
  };

  IC.leather = t => {
    // stretched hide: body, four leg flaps, neck and tail, with a darker spine
    const R = t.R;
    const hide = union(ell(7, 7, 4.4, 5.4), rell(2.9, 2.7, 2.9, 1.35, Math.PI / 4), rell(11.1, 2.7, 2.9, 1.35, -Math.PI / 4),
      rell(2.9, 11.3, 2.9, 1.35, -Math.PI / 4), rell(11.1, 11.3, 2.9, 1.35, Math.PI / 4), ell(7, 1.3, 1.7, 1.5), ell(7, 13, 1, 1.2));
    t.shape(hide, R, { grad: [0.36, 0.72] });
    for (let y = 3; y <= 11; y++) t.px(7, y, R[4]);
    t.S(['11', '1.', '1.'], 4, 3); t.S(['2', '.', '2'], 9, 8); t.S(['4', '4'], 5, 9);
  };

  IC.animal_fat = t => {
    // one soft, glossy lump with pink streaks of meat
    const R = t.R;
    t.shape(union(ell(7.2, 4.8, 4, 3.6), ell(9.8, 9.2, 4.1, 3.6), ell(4.6, 8.8, 4.6, 4.2)), R, { grad: [0.38, 0.74] });
    t.S(['.hh', 'hh.', 'h..'], 3, 3); t.S(['h'], 9, 3);
    const pk = { x: P.salmon, z: ART.mix(P.salmon, P.blood, 0.4) };
    t.S(['..xx', 'xxz.'], 4, 10, pk); t.S(['xz'], 10, 9, pk); t.S(['xz'], 7, 6, pk);
  };

  IC.bone = t => {
    // a big bone on the diagonal plus two chips
    const R = t.R;
    const bone = union(seg(3.4, 10.6, 10.6, 3.4, 1.5), ell(2, 9.4, 1.9, 1.9), ell(4.6, 12, 1.9, 1.9), ell(9.4, 2, 1.9, 1.9), ell(12, 4.6, 1.9, 1.9));
    t.shape(bone, R, { grad: [0.42, 0.8] });
    t.S(['1'], 1, 8); t.S(['1'], 8, 1);
    t.shape(poly([[10.4, 10.8], [13.6, 9.8], [12.4, 13]]), R);
    t.shape(poly([[7.4, 12.4], [9.8, 11.8], [8.8, 14]]), R);
  };

  IC.low_fuel = t => {
    // jerry can: triple handle, capped spout, embossed X
    const R = t.R;
    t.shape(rectT(0, 3, 11, 11), R, { grad: [0.4, 0.75] });
    t.line(2, 5, 8, 11, R[4]); t.line(8, 5, 2, 11, R[4]);
    t.line(1, 5, 7, 11, R[2]); t.line(7, 5, 1, 11, R[2]); t.px(4, 8, R[4]); t.px(5, 8, R[4]);
    t.S(['aaaaaa', 'aZaZaX', 'AXAXAX'], 1, 0);
    t.S(['..mN', '.mnN', 'mnN.'], 8, 0);
  };

  // ---------- components
  IC.fuse = t => t.S([
    // cartridge fuse: brass end caps (item colour) around a glass tube with a filament
    '.12........23.',
    '122hhhhhhhh233',
    '123aaaaaaaa234',
    '123ZXXmmXXZ234',
    '233aaaaaaaa344',
    '234AAAAAAAA345',
    '344XXXXXXXX445',
    '.45........45.',
  ]);

  // ---------- food
  IC.raw_meat = t => {
    const R = t.R;
    const steak = union(ell(6.4, 8, 6.4, 5), ell(9.6, 5, 4.2, 3.8));
    t.shape(steak, R, { grad: [0.4, 0.75] });
    // fat cap along the upper-right edge
    for (let y = 0; y < W16; y++) for (let x = 0; x < W16; x++) {
      if (!steak(x, y) || x + 0.6 * y < 7) continue;
      if (!steak(x, y - 1) || !steak(x + 1, y)) t.px(x, y, !steak(x, y - 1) && x < 11 ? 'h' : 'p');
      else if (!steak(x, y - 2) || !steak(x + 2, y)) t.px(x, y, 'q');
    }
    // marbling + bone
    t.S(['.pp', 'p..'], 3, 6); t.S(['p.', '.p'], 7, 9); t.S(['pp'], 2, 10);
    t.S(['.pp.', 'p55q', '.qq.'], 4, 9 - 1, { 5: R[5] });
  };

  IC.cooked_meat = t => {
    // drumstick: browned meat with a bone sticking out to the bottom-right
    const R = t.R;
    t.shape(union(seg(7.5, 7.5, 11.3, 11.3, 1.15), ell(13, 11.2, 1.5, 1.5), ell(11.2, 13, 1.5, 1.5)), RBONE, { grad: [0.4, 0.75] });
    t.shape(union(rell(5.2, 5.2, 5.4, 4.6, Math.PI / 4), seg(5.5, 5.5, 8.8, 8.8, 2.2)), R, { grad: [0.32, 0.7] });
    t.S(['.ww', 'w2.', 'w..'], 2, 2); t.S(['w'], 6, 1);
    t.S(['4.', '.4'], 6, 6); t.S(['4'], 3, 8); t.S(['4'], 8, 4);
  };

  IC.berries = t => {
    const R = t.R;
    t.line(6, 4, 7, 1, 'v'); t.line(7, 1, 8, 0, 'V');
    t.shape(rell(10.6, 2.6, 3.4, 1.7, -0.45), RLEAF, { grad: [0.4, 0.75] });
    t.line(8, 3, 12, 1, P.darkgreen);
    for (const [x, y, r] of [[6.5, 6.4, 2.6], [10.8, 7.6, 2.5], [2.6, 8, 2.5], [8.8, 11, 2.6], [4.4, 11.4, 2.6]]) {
      t.shape(ell(x, y, r, r), R, { grad: [0.32, 0.7] });
      t.px(Math.floor(x - 1), Math.floor(y - 1), 'h');
    }
  };

  IC.mushroom = t => {
    const R = t.R;
    // small one behind, to the right
    t.shape(poly([[10.2, 8.6], [12.2, 8.6], [12.6, 13.8], [9.8, 13.8]]), RSAND, { grad: [0.4, 0.75] });
    t.shape((x, y) => y < 9 && ell(11.2, 9.4, 2.9, 4)(x, y), R, { grad: [0.36, 0.72] });
    t.S(['44444'], 9, 8, { 4: R[5] });
    t.S(['p'], 10, 6);
    // big one in front, to the left
    t.shape(poly([[3.6, 7.5], [7, 7.5], [7.8, 13.8], [2.8, 13.8]]), RSAND, { grad: [0.4, 0.75] });
    t.shape((x, y) => y < 8 && ell(5.4, 8.6, 5.5, 7.8)(x, y), R, { grad: [0.32, 0.68] });
    t.S(['.44444444.'], 0, 7, { 4: R[5] });
    t.S(['pp', 'p.'], 3, 2); t.S(['p'], 7, 3); t.S(['p'], 2, 5); t.S(['p'], 8, 5);
  };

  IC.water_bottle = t => {
    const R = t.R, cl = { i: ART.mix(R[1], '#ffffff', 0.55), j: ART.mix(R[2], '#ffffff', 0.35) };
    t.S([
      '...bbbb...',
      '...BBBB...',
      '...hiij...',
      '..hiiiij..',
      '.hiiiiiijm',
      '.hiiiiiijm',
      '.h1111112m',
      '.h2222223m',
      '.ssssssssn',
      '.h2222233m',
      '.h2222233m',
      '.ssssssssn',
      '.h2223334m',
      '..m44445n.',
    ], 0, 0, cl);
  };

  // ---------- ammo / throwables
  IC.arrow = t => {
    const R = t.R;
    for (let y = 4; y <= 12; y++) { t.px(13 - y, y, R[2]); t.px(14 - y, y, R[4]); }
    t.px(0, 13, R[3]); t.px(1, 13, R[5]);
    t.shape(poly([[14, 0], [11, 6], [10.2, 3.6], [7.6, 2.6]]), RG, { grad: [0.4, 0.72] });
    // red fletching hugging the tail end of the shaft
    const F = { x: P.red, z: P.blood, w: P.salmon };
    t.S(['....w..R', '...wx..zz', '..wxx..zz', '.wxx..zz', '.xx..z'], 0, 8, Object.assign({ R: P.blood }, F));
  };

  IC.rocket = t => {
    const R = t.R;
    const rs = fn => along(1.2, 12.8, 13.4, 0.6, fn);
    t.shape(rs((u, v) => u >= 0.6 && u <= 4.6 && Math.abs(v) <= 4.6 - u * 0.7), shiftR(R, 1), { grad: [0.36, 0.72] });
    t.shape(rs((u, v) => u >= 0 && u <= 10.4 && Math.abs(v) <= 1.9), R, { grad: [0.36, 0.72] });
    t.shape(rs((u, v) => u > 9.4 && u <= 10.4 && Math.abs(v) <= 2), { 1: P.yellow, 2: P.yellow, 3: P.gold, 4: RBR[4], 5: RBR[5] }, { grad: [0.36, 0.72] });
    t.shape(rs((u, v, L) => u > 10.4 && u <= L && Math.abs(v) <= Math.min(2.4, (L - u) * 0.5)), RG, { grad: [0.36, 0.72] });
    t.S(['k'], 1, 12);
  };

  IC.beancan = t => {
    t.S([
      '.12222223.',
      '1aAAAAAAX4',
      '1222222234',
      'uuuuuuuutt',
      'uppppppptt',
      'upvWvWpptt',
      'uppppppptt',
      'uuuuuuuutt',
      '1222222334',
      '1222222334',
      '.34444445.',
    ], 0, 3);
    t.S(['kk', 'kk', 'kk', 'kk', 'kk', 'kk', 'kk', 'kk', 'kk', 'kk'], 2, 4, { k: P.ink });
    t.S(['..A', '.A.', 'A..'], 5, 1); t.px(4, 3, 'A');
    spark(t, 8, 1);
  };

  IC.satchel = t => {
    // canvas bag charge: flap, buckle, tied cord and a lit fuse
    t.S([
      '......A.......',
      '.11111A111112.',
      '1222pq22222234',
      '1222pq22222234',
      '1333pq33333345',
      '.444pq444GG45.',
      '1222pq22gk2234',
      '1222pq22GG2234',
      '1222pq22222234',
      '1222pq22223334',
      '.344qp4444445.',
    ], 0, 3, ROPE);
    t.S(['..A', '.A.', 'A..'], 6, 0); spark(t, 9, 1);
  };

  IC.c4 = t => {
    t.S([
      '..111111111111',
      '.1222222222223',
      '12222222222234',
      '23333333333345',
      '23333333333345',
      '23333333333345',
      '23333333333345',
      '34444444444445',
    ], 0, 5);
    // tape bands round the brick
    t.S(['aA', 'aA', 'AX', 'AX', 'AX', 'AX', 'AX', 'XZ'], 2, 5); t.S(['aA', 'aA', 'AX', 'AX', 'AX', 'AX', 'AX', 'XZ'], 10, 5);
    // detonator on top, red light, wires
    t.S([
      '...kkkkkk.',
      '..kNNNrkk.',
      '..kNlNNNk.',
      '..kkkkkkk.',
    ], 2, 1);
    t.px(8, 2, 'h');
    t.S(['r.', '.r', '.r'], 11, 3); t.S(['b', 'b'], 3, 5);
  };

  IC.supply_signal = t => {
    const R = t.R, SM = { 1: '#ffffff', 2: ART.mix(R[1], '#ffffff', 0.5), 3: R[1], 4: R[2], 5: R[3] };
    for (const [x, y, rx, ry] of [[4.4, 4.2, 3.2, 2.8], [9.4, 2.6, 3.6, 2.6], [11.4, 5.6, 2.6, 2.2], [7, 5.6, 2.8, 2.2]]) t.shape(ell(x, y, rx, ry), SM, { grad: [0.45, 0.85] });
    t.S([
      '.aaaaa.',
      'aAAAAAX',
      'XZZZZZZ',
      '1222234',
      '1h22234',
      '1hhhhh4',
      '1222234',
      '1hhhhh4',
      '1222234',
      '.34445.',
    ], 4, 5);
    t.S(['a', 'A', 'A', 'X'], 11, 7);
  };

  // ---------- weapons
  IC.bow = t => {
    // recurve bow on the diagonal: limb arcs toward the top-left, string tip to tip
    const R = t.R, cx = 10.4, cy = 10.4, rad = 9.2, ax = 3.9, ay = 3.9;
    const limb = (x, y) => {
      const px = x + 0.5, py = y + 0.5; if (px + py > 14.4) return false;
      const d = Math.hypot(px - cx, py - cy), m = Math.min(1, Math.hypot(px - ax, py - ay) / 8);
      return Math.abs(d - rad) <= 1.15 - m * 0.55;
    };
    t.shape(limb, R, { grad: [0.36, 0.7] });
    t.px(13, 0, R[2]); t.px(12, 0, R[1]); t.px(0, 13, R[2]); t.px(0, 12, R[1]);
    ART.line(t.g, 12, 2, 2, 12, P.sand);
    t.S(['.VV', 'VvV', 'Vv.'], 2, 3);
  };

  IC.rocket_launcher = t => t.S([
    '.....kNk......',
    'XX....k....aX.',
    'A11111111111aX',
    'A2222222y222aX',
    'A3333333y333AX',
    'A4444444y444AX',
    'X555555555555X',
    'XX.kk.VVVkk.X.',
    '...kk...okk...',
    '........kk....',
  ]);

  IC.rock = t => {
    const rock = poly([[3, 1.2], [8.5, 0.2], [12.6, 2.6], [13.8, 7.4], [11.6, 12], [5.6, 13], [1.2, 10.6], [0.2, 5.4]]);
    t.shape(rock, t.R, { grad: [0.36, 0.7] });
    t.S(['11', '1.'], 3, 3); t.S(['1'], 6, 2);
    t.S(['..4', '.4.', '.4.', '4..'], 8, 4); t.S(['4', '.4'], 4, 9);
    t.px(10, 9, t.R[2]); t.px(3, 7, t.R[4]);
  };

  IC.torch = t => {
    const R = t.R;
    for (let y = 7; y <= 13; y++) { t.px(13 - y, y, R[2]); t.px(14 - y, y, R[4]); }
    t.shape(rell(8.2, 6, 2.6, 2, -Math.PI / 4), RSAND, { grad: [0.36, 0.72] });
    t.S(['.V', 'V.'], 8, 4); t.S(['q', '.q'], 6, 6, ROPE);
    fire(t, 9.8, 5.4, 4.6, 5.4, 0.8);
  };

  IC.spear_wood = t => {
    const R = t.R;
    for (let y = 4; y <= 13; y++) { t.px(13 - y, y, R[2]); t.px(14 - y, y, R[4]); }
    // carved, fire-hardened tip
    t.S(['....p', '...pw', '..pwW', '.pwWv'], 9, 0);
    t.S(['.qp', 'qp.', 'p..'], 8, 4, ROPE);
    // cloth grip
    t.S(['.WW', 'WWv', 'Wv.', 'v..'], 3, 8);
  };

  // ---------- armour
  IC.burlap = t => {
    // rough sack shirt: V-neck, short sleeves, coarse weave, rope belt, frayed hem
    const R = t.R;
    const shirt = poly([[4.6, 0], [7, 2.6], [9.4, 0], [14, 3.4], [12.2, 6.8], [10.8, 5.2], [10.8, 13], [3.2, 13], [3.2, 5.2], [1.8, 6.8], [0, 3.4]]);
    t.shape(shirt, R, { grad: [0.38, 0.74], mod: (x, y, lv) => (x % 2 === 0 && y % 2 === 1 ? lv + 1 : lv) });
    t.S(['pqpqpqpq'], 3, 9, ROPE); t.S(['q', 'p'], 8, 10, ROPE);
    t.S(['5', '5', '5'], 3, 4, { 5: R[5] }); t.S(['5', '5', '5'], 10, 4, { 5: R[5] });
    t.clear(4, 12); t.clear(7, 12); t.clear(9, 12);
    t.S(['44', '44'], 5, 5, { 4: R[4] });
  };

  IC.wood_armor = t => {
    // the vest silhouette built from three wide planks, rope shoulder ties and belt, nailed
    const R = t.R;
    t.S(VEST);
    for (let y = 3; y <= 11; y++) { t.px(4, y, R[4]); t.px(8, y, R[4]); t.px(5, y, R[2]); t.px(9, y, R[2]); }
    t.S(['pq', 'qp'], 2, 0, ROPE); t.S(['qp', 'pq'], 9, 0, ROPE);
    t.S(['pqpqpqpqpqpqp'], 0, 8, ROPE);
    for (const x of [2, 6, 10]) { t.px(x, 4, 'a'); t.px(x, 10, 'a'); }
  };

  IC.helm_wood = t => {
    const R = t.R;
    const dome = (x, y) => y <= 8 && ell(6.5, 9, 6.5, 8.8)(x, y);
    t.shape(dome, R, { grad: [0.35, 0.7] });
    for (let y = 1; y <= 7; y++) for (const sx of [2.6, 6.5, 10.4]) { const x = Math.round(6.5 + (sx - 6.5) * (0.45 + y * 0.08) - 0.5); if (dome(x, y) && dome(x, y - 1)) t.px(x, y, R[4]); }
    t.S(['pqpqpqpqpqpqp', 'qWqWqWqWqWqWq'], 0, 8, ROPE);
    t.S(['V.........V', '.V.......V.', '..VVVVVVV..'], 1, 10);
  };

  // generic fallback: taped cardboard crate with a question mark
  function generic(t) {
    t.S([
      '...1111111...',
      '.11222p222111',
      '1222222p2222.',
      '3333333p33334',
      '3333hhhp33334',
      '33h3333hp3334',
      '33333hh3p3334',
      '33333h333p334',
      '3333333333p34',
      '33333h3333334',
      '4555555555555',
    ], 0, 0, asChars(RW, '12345'));
  }

  // ---------- blueprints: blue rolled sheet with the taught item's silhouette
  function blueprint(t, def) {
    const B = ramp('#4a8ad8');
    t.shape(rectT(1, 2, 12, 10), { 1: B[2], 2: B[3], 3: B[3], 4: B[4], 5: B[4] }, { flat: true });
    for (let y = 3; y <= 10; y++) for (let x = 2; x <= 11; x++) if ((x % 3 === 0 || y % 3 === 0)) t.px(x, y, ART.mix(B[3], B[2], 0.5));
    const roll = ['1111111111111', '2222222222223', '3444444444445'];
    t.S(roll, 0, 0, asChars(B, '12345')); t.S(roll, 0, 11, asChars(B, '12345'));
    // silhouette
    let raw = null;
    try {
      const r = (typeof RECIPE !== 'undefined' && def && def.teach) ? RECIPE[def.teach] : null;
      if (r && r.out) raw = rawIcon(r.out);
    } catch (e) { raw = null; }
    const ink = '#e6f3ff', inkS = '#9cc8f4';
    if (!raw) { t.S(['.hhh.', 'h...h', '...h.', '..h..', '.....', '..h..'], 4, 3, { h: ink }); return; }
    const d = raw.getContext('2d').getImageData(0, 0, W16, W16).data;
    let x0 = W16, y0 = W16, x1 = -1, y1 = -1;
    for (let y = 0; y < W16; y++) for (let x = 0; x < W16; x++) if (d[(y * W16 + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, s = Math.min(10 / w, 7 / h, 1);
    const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
    const ox = 1 + Math.floor((12 - tw) / 2), oy = 3 + Math.floor((8 - th) / 2);
    const on = (i, j) => {
      if (i < 0 || j < 0 || i >= tw || j >= th) return false;
      const sx0 = Math.floor(i / s), sx1 = Math.max(sx0 + 1, Math.floor((i + 1) / s)), sy0 = Math.floor(j / s), sy1 = Math.max(sy0 + 1, Math.floor((j + 1) / s));
      let n = 0, tot = 0;
      for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { tot++; if (d[((y0 + y) * W16 + x0 + x) * 4 + 3] > 0) n++; }
      return n * 2 >= tot || (n > 0 && tot <= 2);
    };
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) if (on(i, j)) {
      if (!on(i + 1, j + 1) && ox + i + 1 <= 12 && oy + j + 1 <= 10) t.px(ox + i + 1, oy + j + 1, B[5]);
    }
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) if (on(i, j)) t.px(ox + i, oy + j, (on(i, j - 1) && on(i - 1, j)) ? inkS : ink);
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) if (on(i, j) && !on(i, j - 1)) t.px(ox + i, oy + j, ink);
  }

  // ---------------------------------------------------------------- build
  function itemDef(id) { try { return (typeof ITEMS !== 'undefined' && ITEMS[id]) || null; } catch (e) { return null; } }

  function drawItem(id, def) {
    const [c, g] = cv();
    const col = (def && def.col) || '#a08868';
    const R = ramp(col);
    const pal = Object.assign({}, FIX, asChars(R, '12345'));
    const t = ctx(g, pal, R);
    if (def && def.cat === 'bp') blueprint(t, def);
    else if (IC[id]) IC[id](t, def || {});
    else if (def && TPL[def.icon]) TPL[def.icon](t, def);
    else if (def && def.cat === 'key') TPL.card(t, def);
    else generic(t);
    return c;
  }
  function rawIcon(id) {
    if (rawCache[id]) return rawCache[id];
    let c = null;
    try { c = drawItem(id, itemDef(id)); } catch (e) { c = null; }
    if (!c) { const [cc, g] = cv(); try { generic(ctx(g, Object.assign({}, FIX), RW)); } catch (e) { } c = cc; }
    return (rawCache[id] = c);
  }
  function icon(id) {
    id = String(id);
    if (iconCache[id]) return iconCache[id];
    let c = null;
    try {
      const def = itemDef(id);
      const raw = rawIcon(id);
      c = finish(raw, def && def.cat === 'art' ? { glow: lift(def.col) } : null);
    } catch (e) { c = null; }
    if (!c) { try { const [cc, g] = cv(); generic(ctx(g, Object.assign({}, FIX), RW)); c = finish(cc); } catch (e) { c = cv()[0]; } }
    return (iconCache[id] = c);
  }

  // ================================================================ UI GLYPHS
  const UI = {};
  const uiT = g => ctx(g, Object.assign({}, UIPAL, asChars(RWH, '12345')), RWH);

  UI.pause = t => { t.S(['hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'ssss'], 0, 0); t.S(['hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'hhhs', 'ssss'], 7, 0); };
  UI.check = t => t.S([
    '..........hh',
    '.........hhs',
    '........hhs.',
    '.......hhs..',
    'hh....hhs...',
    'shh..hhs....',
    '.shhhhs.....',
    '..shhs......',
    '...ss.......',
  ]);
  UI.remove = t => t.shape((x, y) => x >= 0 && y >= 0 && x <= 10 && y <= 10 && (Math.abs(x - y) <= 1 || Math.abs(x + y - 10) <= 1), RWH);
  UI.heart = t => t.S([
    '.hhh...hhs.',
    'hhhhh.hhhhs',
    'hhhhhhhhhhs',
    'hhhhhhhhhss',
    '.hhhhhhhss.',
    '..hhhhhss..',
    '...hhhss...',
    '....hss....',
    '.....s.....',
  ]);
  UI.skull = t => t.S([
    '..hhhhhhh..',
    '.hhhhhhhhs.',
    'hhhhhhhhhhs',
    'hhkkkhkkkhs',
    'hhkkkhkkkhs',
    'hhhhhkhhhhs',
    '.hhhhkhhhs.',
    '..hhhhhhs..',
    '..hkhkhks..',
    '..hhhhhhs..',
  ]);
  UI.rad = t => {
    const cx = 6.5, cy = 6.5;
    t.shape((x, y) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy); if (r <= 1.6) return true;
      if (r < 2.6 || r > 6.4) return false;
      const a = (Math.atan2(dy, dx) * 180 / Math.PI + 720 - 90) % 120; return a < 30 || a > 90;
    }, RWH);
  };
  UI.shield = t => t.S([
    'hhhhhhsssss',
    'hhhhhhsssss',
    'hhhhhhsssss',
    'hhhhhhsssss',
    'hhhhhhsssss',
    '.hhhhhssss.',
    '.hhhhhssss.',
    '..hhhhsss..',
    '...hhhss...',
    '....hhs....',
    '.....h.....',
  ]);
  UI.stamina = t => t.S([
    '....hhhs',
    '...hhhs.',
    '..hhhs..',
    '.hhhs...',
    'hhhhhhhs',
    '...hhhs.',
    '..hhhs..',
    '.hhhs...',
    '.hhs....',
    '.hs.....',
  ]);
  UI.bleed = t => t.shape(union(ell(4.5, 8, 4.5, 4.2), poly([[4.5, -0.5], [8.3, 7], [0.7, 7]])), RWH, { grad: [0.5, 0.8] });
  UI.clock = t => {
    t.shape(ell(6.5, 6.5, 6.5, 6.5), RWH, { grad: [0.55, 0.85] });
    t.S(['k', 'k', 'k', 'k', 'kkkk'], 6, 2, { k: P.navy });
    t.px(6, 0 + 1, P.steel); t.px(11, 6, P.steel); t.px(6, 11, P.steel); t.px(1, 6, P.steel);
  };
  UI.star = t => {
    const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 2.9 : 7; pts.push([6.5 + Math.cos(a) * r, 7.2 + Math.sin(a) * r]); }
    t.shape(poly(pts), RWH, { grad: [0.55, 0.85] });
  };
  UI.lock = t => t.S([
    '...hhhh...',
    '..hs..hs..',
    '.hs....hs.',
    '.hs....hs.',
    'hhhhhhhhhs',
    'hhhhhhhhhs',
    'hhhhkkhhhs',
    'hhhhkkhhhs',
    'hhhhhkhhhs',
    'hhhhhhhhhs',
    'ssssssssss',
  ], 0, 0, { k: P.navy });
  UI.heal = t => t.S([
    '....hhhh....',
    '....hhhs....',
    '....hhhs....',
    '....hhhs....',
    'hhhhhhhhhhhh',
    'hhhhhhhhhhhs',
    'hhhhhhhhhhhs',
    'sssshhhsssss',
    '....hhhs....',
    '....hhhs....',
    '....hhhs....',
    '....ssss....',
  ]);
  const ARR = ['.......h..', '.......hh.', 'hhhhhhhhhh', 'sssssssshs', '.......ss.', '.......s..'];
  UI.swap = t => { t.S(ARR, 2, 0); t.S(ARR.map(r => r.split('').reverse().join('')), 0, 7); };
  UI.reload = t => {
    const cx = 6.5, cy = 7;
    t.shape((x, y) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy); if (r < 3.4 || r > 5.8) return false; const a = Math.atan2(dy, dx) * 180 / Math.PI; return !(a > -90 && a < 0); }, RWH, { grad: [0.6, 0.9] });
    t.S(['h....', 'hh...', 'hhh..', 'hhhh.', 'hhhhs', 'hhhs.', 'hhs..', 'hs...'], 6, 0);
  };
  UI.upgrade = t => {
    const chev = oy => (x, y) => { const yy = y - oy, ax = Math.abs(x - 5); return ax <= 5 && yy >= ax && yy < ax + 3; };
    t.shape(union(chev(0), chev(5)), RWH, { grad: [0.6, 0.9] });
  };
  UI.repair = t => {
    const cx = 9.5, cy = 3.5;
    const head = minus(ell(cx, cy, 3.4, 3.4), (x, y) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy; return Math.abs(dx + dy) < 1.3 && (dx - dy) > -0.6; });
    const handle = (x, y) => { const d = Math.abs((x + 0.5) + (y + 0.5) - 13.3); const u = (x + 0.5) - (y + 0.5); return d <= 1.3 && u > -10 && u < 4 && x >= 0; };
    t.shape(union(head, handle, ell(2, 11, 2.2, 2.2)), RWH, { grad: [0.6, 0.9] });
    t.clear(1, 11);
  };
  UI.build = t => {
    t.S([
      '..hhhhhhhhhh',
      '.hhhhhhhhhhs',
      'hhhhhhhhhhhs',
      '.sssshhhssss',
      '.....hhs....',
      '.....hhs....',
      '.....hhs....',
      '.....hhs....',
      '.....mmn....',
      '.....mmn....',
      '.....mmn....',
      '.....nnN....',
    ]);
  };
  UI.craft = t => {
    // crossed hammer (bottom-left -> top-right) and wrench (bottom-right -> top-left)
    for (let i = 0; i <= 8; i++) t.S(['hs'], 2 + i, 12 - i);
    t.S(['.hhs', 'hhhs', 'hhs.', 'hs..'], 9, 0);
    const head = minus(ell(3, 3, 2.9, 2.9), (x, y) => { const dx = x + 0.5 - 3, dy = y + 0.5 - 3; return Math.abs(dx - dy) < 1.2 && (dx + dy) < 0.5; });
    t.shape(union(head, (x, y) => Math.abs((x + 0.5) - (y + 0.5)) <= 1 && x >= 3 && x <= 12 && y <= 13), RWH, { grad: [0.6, 0.9] });
  };
  UI.map = t => t.S([
    'hhhh....hhhh',
    'hhhhsssshhhh',
    'hhhhssssNhNh',
    'hhhhssnshNhh',
    'hhhhsnssNhNh',
    'hhhhnssshhhh',
    'hhhnsssshhhh',
    'hhnhsssshhhh',
    'hnhhsssshhhh',
    'hhhhsssshhhh',
    'ssssssssssss',
    '....ssss....',
  ], 0, 0, { N: P.navy, n: P.steel });
  UI.base = t => t.S([
    '......h......',
    '.....hhs.....',
    '....hhhhs....',
    '...hhhhhhs...',
    '..hhhhhhhhs..',
    '.hhhhhhhhhhs.',
    'ssssssssssssm',
    '.hhhhnnnhhhs.',
    '.hhhhnnnhhhs.',
    '.hhhhnnnhhhs.',
    '.hhhhnnshhhs.',
    '.ssssnnnssss.',
  ]);
  UI.deploy = t => t.S([
    'hhhhh........',
    'hs...........',
    'hs.......h...',
    'hs.......hh..',
    'hs.hhhhhhhhh.',
    'hs.hhhhhhhhhh',
    'hs.ssssssssss',
    'hs.ssssssss s',
    'hs.......ss..',
    'hs.......s...',
    'hs...........',
    'sssss........',
  ]);
  UI.hand = t => t.S([
    '.....hs.....',
    '...hshshs...',
    '...hshshs...',
    '...hshshshs.',
    '...hshshshs.',
    'hs.hshshshs.',
    'hhshhhhhhhs.',
    '.hhhhhhhhhs.',
    '..hhhhhhhhs.',
    '..hhhhhhhs..',
    '...hhhhhhs..',
    '...hhhhhs...',
  ]);
  UI.trade = t => {
    const coin = ['.hhhhh.', 'hhhhhhs', 'mmmmmmm'];
    t.S(coin, 0, 10); t.S(coin, 0, 8); t.S(coin, 1, 6); t.S(coin, 0, 4);
    t.shape(ell(10.5, 7.5, 3.5, 4.6), RWH, { grad: [0.55, 0.85] });
    t.S(['.mm', 'm..', '.m.', '..m', 'mm.'], 9, 5);
  };
  UI.research = t => {
    t.shape(minus(ell(5.5, 5.5, 5.4, 5.4), ell(5.5, 5.5, 3.4, 3.4)), RWH, { grad: [0.6, 0.9] });
    t.S(['.mm', 'm..', 'm..'], 3, 3, { m: P.silver });
    for (let i = 0; i < 4; i++) t.S(['hhs'], 8 + i, 9 + i);
  };
  UI.smelt = t => t.S([
    '....h......',
    '....hh.....',
    '...hhh.....',
    '...hhhh..h.',
    '..hhhhhh.hh',
    '.hhhhhhhhhh',
    '.hhhhshhhhs',
    'hhhhsmshhhs',
    'hhhsmmmshhs',
    'hhhsmmmshhs',
    '.hhsmmmshs.',
    '..sssssss..',
  ]);
  UI.recycle = t => {
    const cx = 6.5, cy = 6.5;
    t.shape((x, y) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy); if (r < 3.5 || r > 5.9) return false; const a = Math.atan2(dy, dx) * 180 / Math.PI; return !((a > -80 && a < -25) || (a > 100 && a < 155)); }, RWH, { grad: [0.6, 0.9] });
    t.S(['h...', 'hh..', 'hhh.', 'hhhh', 'hhs.', 'hs..'], 6, 0);
    t.S(['..hs', '.hhs', 'hhhs', '.hhs', '..hs', '...s'], 3, 8);
  };
  UI.stash = t => t.S([
    '.hhhhhhhhhhh.',
    'hhhhhhhhhhhhs',
    'hhhhhhhhhhhhs',
    'nnnnnsssnnnnn',
    'hhnhhsNshhnhs',
    'hhnhhsNshhnhs',
    'hhnhhhhhhhnhs',
    'hhnhhhhhhhnhs',
    'ssnssssssnsss',
  ]);
  UI.door = t => t.S([
    'hhhhhhhhhs',
    'hsssssssms',
    'hshhhhhhms',
    'hshmmmmhms',
    'hshmssmhms',
    'hshmmmmhms',
    'hshhhhNhms',
    'hshhhhNhms',
    'hshmmmmhms',
    'hshmssmhms',
    'hshmmmmhms',
    'hshhhhhhms',
    'hmmmmmmmms',
  ]);
  UI.wall = t => {
    t.shape(rectT(0, 0, 13, 11), RWH, { grad: [0.6, 0.9] });
    for (let y = 0; y < 11; y++) for (let x = 0; x < 13; x++) {
      const course = (y / 3.7) | 0, jx = course % 2 ? 2 : 5;
      if (y % 4 === 3 || ((x + 13 - jx) % 6 === 0 && y % 4 !== 3)) t.px(x, y, P.steel);
    }
  };
  UI.turret = t => {
    t.S([
      '..hhhhh......',
      '.hhhhhhhhhhhh',
      '.hhhhhhssssss',
      '.sssssss.....',
      '....hs.......',
      '...hhss......',
    ]);
    t.line(4, 6, 1, 11, 'h'); t.line(5, 6, 5, 11, 's'); t.line(6, 6, 9, 11, 's');
    t.px(0, 11, 'h'); t.px(10, 11, 's');
  };
  UI.bed = t => t.S([
    'hs............',
    'hs............',
    'hshhh.........',
    'hshhhssssssss.',
    'hhhhhhhhhhhhhs',
    'hsmmmmmmmmmmms',
    'hs..........hs',
    'hs..........hs',
  ]);
  UI.grenade = t => IC.grenade(t);
  UI.bag = t => IC.bag_ruck(t);

  // ---------- building pieces & deployables
  function bricks(t, x0, y0, w, h) {
    t.shape(rectT(x0, y0, w, h), RWH, { grad: [0.6, 0.9] });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const course = (y / 3.7) | 0, jx = course % 2 ? 2 : 5;
      if (y % 4 === 3 || ((x + 13 - jx) % 6 === 0 && y % 4 !== 3)) t.px(x0 + x, y0 + y, 'm');
    }
  }
  UI.foundation = t => {
    // square slab seen at an angle: lit top face with tile seams, two shaded sides
    const top = (x, y) => Math.abs(x + 0.5 - 7) / 7 + Math.abs(y + 0.5 - 4) / 4 <= 1;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 14; x++) {
      if (top(x, y)) t.px(x, y, 'h');
      else if (y > 3 && (top(x, y - 1) || top(x, y - 2) || top(x, y - 3))) t.px(x, y, x < 7 ? 's' : 'm');
    }
    t.S(['ss....', '..ss..', '....ss'], 4, 2); t.S(['....ss', '..ss..', 'ss....'], 4, 3);
  };
  UI.ceiling = t => {
    // gabled roof with shingle courses over an eave beam
    const roof = poly([[7, -0.6], [14.4, 7.2], [-0.4, 7.2]]);
    t.shape(roof, RWH, { grad: [0.6, 0.9] });
    for (const y of [3, 5]) for (let x = 0; x < 14; x++) if (roof(x, y) && roof(x - 1, y) && roof(x + 1, y)) t.px(x, y, 'm');
    for (const [x, y] of [[6, 4], [8, 4], [4, 6], [7, 6], [10, 6], [7, 2]]) t.px(x, y, 'm');
    t.S(['.ssssssssssss.', '..nn......nn..', '..nn......nn..'], 0, 8);
  };
  UI.doorway = t => { bricks(t, 0, 0, 13, 12); t.clear(4, 4, 5, 8); t.clear(5, 3, 3, 1); };
  UI.window = t => { bricks(t, 0, 0, 13, 12); t.clear(3, 3, 7, 6); t.S(['mmmmmmm'], 3, 5); t.S(['m', 'm', 'm', 'm', 'm', 'm'], 6, 3); t.S(['sssssssss'], 2, 9); };
  UI.lowwall = t => {
    for (let x = 0; x < 13; x += 2) t.px(x, 0, 'n');
    for (let y = 2; y < 6; y += 2) { t.px(0, y, 'n'); t.px(12, y, 'n'); }
    bricks(t, 0, 6, 13, 7);
  };
  UI.highwall = t => {
    // palisade of sharpened stakes bound by two rails
    const H = [2, 1, 0, 1, 2];
    for (let i = 0; i < 5; i++) {
      const x = i * 3, y0 = H[i];
      t.px(x, y0, 'h'); for (let y = y0 + 1; y <= 12; y++) t.S(['hs'], x, y);
      t.S(['ss'], x, 13);
    }
    t.S(['mmmmmmmmmmmmmm'], 0, 4); t.S(['mmmmmmmmmmmmmm'], 0, 10);
  };
  UI.gate = t => {
    // tall posts and a double gate of planks with rails and braces
    t.S(['h............h', 'hs..........hs'], 0, 0);
    for (let y = 2; y <= 12; y++) t.S(['hshhhhnhhhhshs'], 0, y);
    t.S(['mmmmnmmmmm'], 2, 3); t.S(['mmmmnmmmmm'], 2, 11);
    t.line(2, 10, 5, 4, 'm'); t.line(11, 10, 8, 4, 'm');
    t.px(5, 7, 'N'); t.px(7, 7, 'N'); t.S(['ss'], 0, 13); t.S(['ss'], 12, 13);
  };
  UI.tc = t => t.S([
    // tool cupboard: crowned cabinet, panelled doors, handles by the centre seam
    'hhhhhhhhhhhhh',
    'ssssssssssssm',
    '.hhhhhnhhhhs.',
    '.hmmmhnhmmms.',
    '.hmhhhnhmhhs.',
    '.hmhhNnNmhhs.',
    '.hmhhNnNmhhs.',
    '.hmhhhnhmhhs.',
    '.hmmmhnhmmms.',
    '.hhhhhnhhhhs.',
    'hssssssssssss',
    '.nn.......nn.',
  ]);
  UI.box = t => {
    // storage crate: frame, plank seams, diagonal brace
    t.shape(rectT(0, 0, 13, 11), RWH, { grad: [0.6, 0.9] });
    for (let y = 1; y <= 9; y++) for (let x = 1; x <= 11; x++) t.px(x, y, y % 3 === 0 ? 'm' : 's');
    for (let k = 0; k <= 8; k++) t.S(['hh'], 1 + k, 9 - k);
    t.S(['nn', 'n.'], 0, 0); t.S(['nn', '.n'], 11, 0); t.S(['n.', 'nn'], 0, 9); t.S(['.n', 'nn'], 11, 9);
  };
  UI.furnace = t => t.S([
    '.....hs......',
    '.....hs......',
    '...hhhhhhs...',
    '..hhmhhhmhs..',
    '.hhhhhhhhhhs.',
    '.hmhhNNNhhms.',
    'hhhhNNhNNhhhs',
    'hhhhNhhhNhhhs',
    'hhmhNhhhNhmhs',
    'hhhhNhhhNhhhs',
    'ssssssssssssm',
  ]);
  UI.workbench = t => t.S([
    // bench with a hammer and a vice on top
    '.hhh......hhs.',
    '..h......hNNs.',
    '..h.....hhhhhs',
    'hhhhhhhhhhhhhh',
    'ssssssssssssss',
    '.hs........hs.',
    '.hs........hs.',
    '.hsmmmmmmmmhs.',
    '.hs........hs.',
    '.hs........hs.',
    '.ss........ss.',
  ]);
  UI.campfire = t => t.S([
    // flame over a pair of crossed logs
    '......h.......',
    '......hh......',
    '.....hhh......',
    '.....hhhh..h..',
    '....hhhhhh.hh.',
    '...hhhhhhhhhh.',
    '...hhhhshhhhs.',
    '...hhhsssshhs.',
    '...hhsssssshs.',
    'mhhshssssshshm',
    'nmhhhshhhshhmn',
    '....shhhhs....',
    'mhhhs....shhhm',
    'nms........smn',
  ]);
  UI.sleepingbag = t => t.S([
    // rolled bedroll: spiral end, two straps, carry loop
    '.....hhhhh....',
    '....hs....hs..',
    '.hhhhhhhhhhhh.',
    'hmmmhhnhhhhnhs',
    'mhhhmhnhhhhnhs',
    'mhmhmhnhhhhnhs',
    'mhhmhsnsssssns',
    'hmmhsnnssssnms',
    '.ssss.mmmmmmm.',
  ]);
  UI.trap = t => {
    for (let i = 0; i < 4; i++) { const cx = 1.8 + i * 3.5; t.shape(poly([[cx - 1.8, 9], [cx + 1.8, 9], [cx, i % 2 ? 2 : 0]]), RWH, { grad: [0.6, 0.9] }); }
    t.S(['hhhhhhhhhhhhhh', 'smmmmmmmmmmmmn', '.ss........ss.'], 0, 9);
  };
  UI.mine = t => t.S([
    // pressure mine: trigger button, raised plate, bolted top, riveted side band
    '.....hhs.....',
    '.....hms.....',
    '...hhmmmhs...',
    '.hhhhhhhhhhs.',
    'hhhmhhhhhmhhs',
    'shhhhhhhhhhsm',
    'mnmnmnmnmnmnn',
    'smmmmmmmmmmmn',
    '.sssssssssss.',
  ]);
  UI.light = t => {
    t.S([
      '...hhhhh...',
      '..hhhhhhs..',
      '.hhhhmhhhs.',
      '.hhhm.mhhs.',
      '.hhhhmhhhs.',
      '..hhhmhhs..',
      '...hhmhs...',
      '...mmmmn...',
      '...nnnnN...',
      '...mmmmn...',
      '....nnN....',
    ], 1, 1);
    t.S(['h'], 0, 2); t.S(['h'], 12, 2); t.S(['h'], 6, 0);
  };
  UI.planter = t => t.S([
    '......hs......',
    '.hhh..hs..hhs.',
    'hhhhs.hs.hhhhs',
    '.sss.hhs..sss.',
    '......hhs.....',
    '......hs......',
    'hhhhhhhhhhhhhh',
    'smmmmmmmmmmmmn',
    '.hhhhhhhhhhhs.',
    '.hshshshshshs.',
    '..hhhhhhhhhs..',
    '..ssssssssss..',
  ]);
  UI.drop = t => {
    t.shape(union(ell(5.5, 8, 5, 4.6), poly([[5.5, -0.5], [9.8, 6.6], [1.2, 6.6]])), RWH, { grad: [0.5, 0.85] });
    t.S(['s', 's', '.s'], 2, 7); t.px(3, 10, 's');
  };
  UI.quarry = t => t.S([
    // drill rig: derrick over the hole, drill string, bit biting below ground
    '.....hhs.....',
    '....hsnhs....',
    '....hsnhs....',
    '...hhhnhhs...',
    '...hs.n.hs...',
    '..hs..n..hs..',
    '..hhhhnhhhs..',
    '.hs...n...hs.',
    '.hs...n...hs.',
    'hhhhhhnhhhhhs',
    'sssssmnmsssss',
    '.....hns.....',
    '.....smh.....',
    '......m......',
  ]);

  // ---------- needs, time & navigation
  UI.food = t => {
    t.shape(union(seg(7.5, 7.5, 11.2, 11.2, 1.1), ell(12.8, 11.2, 1.5, 1.5), ell(11.2, 12.8, 1.5, 1.5)), { 1: '#eef1f5', 2: P.silver, 3: P.silver, 4: P.steel, 5: P.slate }, { grad: [0.5, 0.8] });
    t.shape(union(rell(5.2, 5.2, 5.4, 4.6, Math.PI / 4), seg(5.5, 5.5, 8.8, 8.8, 2.2)), RWH, { grad: [0.55, 0.85] });
  };
  UI.drink = t => t.S([
    '........hs',
    '.......hs.',
    '......hs..',
    'hhhhhhhhhh',
    'smmmmhsmmn',
    '.hhhhhhhs.',
    '.hhhhhhhs.',
    '.hmmmmmms.',
    '.hmmmmmms.',
    '..hhhhhs..',
    '..hhhhhs..',
    '..sssssm..',
  ]);
  UI.sun = t => {
    const cx = 6.5, cy = 6.5;
    t.shape((x, y) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy); if (r <= 3.6) return true;
      if (r < 5 || r > 7) return false;
      const a = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360 + 22.5) % 45; return a > 13 && a < 32;
    }, RWH, { grad: [0.55, 0.85] });
  };
  UI.moon = t => {
    t.shape(minus(ell(6, 6.5, 6, 6.2), ell(9.6, 4.4, 5, 5)), RWH, { grad: [0.55, 0.85] });
    t.S(['.h.', 'hhs', '.s.'], 10, 9);
  };
  UI.compass = t => {
    t.shape(ell(6.5, 6.5, 6.5, 6.5), RWH, { grad: [0.55, 0.85] });
    t.S([
      '..N..',
      '..N..',
      '.NNN.',
      '.NNN.',
      'NNNNN',
      '.mhm.',
      'mmmmm',
      '.mmm.',
      '.mmm.',
      '..m..',
      '..m..',
    ], 4, 1, { N: P.navy });
    t.px(1, 6, 's'); t.px(11, 6, 's');
  };
  UI.rotate = t => {
    // a square turned by a curved arrow
    const cx = 6.5, cy = 7;
    t.shape((x, y) => { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy); if (r < 4.6 || r > 6.6) return false; const a = Math.atan2(dy, dx) * 180 / Math.PI; return !(a > -100 && a < -20); }, RWH, { grad: [0.6, 0.9] });
    t.S(['hh...', 'hhh..', 'hhhh.', 'hhhhs', 'hhhs.', 'hhs..'], 8, 0);
    t.S(['hhhs', 'hhhs', 'hhhs', 'ssss'], 5, 5);
  };
  UI.hammer = t => {
    // claw hammer on the diagonal
    t.shape(seg(5, 5, 12.6, 12.6, 1.2), RWH, { grad: [0.6, 0.9] });
    t.shape(minus(poly([[0.2, 5.6], [5.6, 0.2], [8.6, 3.2], [3.2, 8.6]]), poly([[-1, 7], [2.4, 6.4], [1.6, 9]])), RWH, { grad: [0.55, 0.85] });
    t.px(11, 11, 'm'); t.px(12, 12, 'm'); t.px(10, 10, 'm');
  };
  UI.cook = t => t.S([
    // frying pan over a flame
    '.hhhhhhhh.....',
    'hmmmmmmmmhhhhs',
    'hhmmmmmmhhsss.',
    '.hhhhhhhhs....',
    '..sssssss.....',
    '..............',
    '....h...h.....',
    '...hh..hh.....',
    '...hhhhhhh....',
    '..hhhshhhhs...',
    '..hhsmshhhs...',
    '..hsmmmshhs...',
    '...smmmshs....',
    '....sssss.....',
  ]);
  UI.airdrop = t => {
    t.shape((x, y) => y <= 4 && ell(6.5, 5, 6.5, 5)(x, y), RWH, { grad: [0.6, 0.9] });
    t.S(['m...m...m...m'], 0, 4); t.px(4, 3, 'm'); t.px(8, 3, 'm');
    t.line(0, 5, 4, 9, 's'); t.line(12, 5, 8, 9, 's'); t.line(4, 5, 5, 9, 's'); t.line(8, 5, 7, 9, 's');
    t.S(['hhhhhs', 'hmhhms', 'hhmmhs', 'hmhhms', 'ssssss'], 4, 9);
  };
  UI.raid = t => t.S([
    // crossed swords
    'hs..........hs',
    '.hs........hs.',
    '..hs......hs..',
    '...hs....hs...',
    '....hs..hs....',
    '.....hshs.....',
    '......hs......',
    '.....hshs.....',
    '..h.hs..hs.h..',
    '...h......h...',
    '...nh....hn...',
    '..n..h..h..n..',
    'hh..........hh',
    'ss..........ss',
  ]);
  UI.vendor = t => t.S([
    // shopping cart
    'hh............',
    '.hs...........',
    '.hhhhhhhhhhhhh',
    '..hmhmhmhmhmhs',
    '..hhhhhhhhhhs.',
    '...hmhmhmhmhs.',
    '...hhhhhhhhs..',
    '....hs........',
    '....hhhhhhhhs.',
    '....sssssssss.',
    '....hs....hs..',
    '....ss....ss..',
  ]);
  UI.info = t => {
    t.shape(ell(6.5, 6.5, 6.5, 6.5), RWH, { grad: [0.55, 0.85] });
    t.S(['.kk', '.kk', '...', 'kkk', '.kk', '.kk', '.kk', 'kkkk'], 5, 2, { k: P.navy });
  };
  UI.torch = t => {
    for (let y = 6; y <= 13; y++) t.S(['hs'], 12 - y, y);
    t.S(['.nn', 'nnn', 'nn.'], 6, 5);
    t.shape(flameT(9.5, 6, 5, 6.4, 0.7), RWH, { grad: [0.6, 0.9] });
    t.shape(flameT(9.6, 5.6, 2.2, 3, 0.3), { 1: P.silver, 2: P.silver, 3: P.silver, 4: P.steel, 5: P.steel }, { bevel: false });
  };
  UI.sprint = t => {
    // running figure leaning into the stride
    t.shape(ell(9.6, 1.8, 1.9, 1.9), RWH, { grad: [0.6, 0.9] });
    const limbs = union(seg(8.4, 4.2, 6.2, 8.4, 1.15), seg(8.2, 4.4, 10.6, 6.2, 0.75), seg(10.6, 6.2, 12.6, 5, 0.75),
      seg(7.6, 4.4, 4.6, 4.6, 0.75), seg(4.6, 4.6, 2.8, 7, 0.75), seg(6.2, 8.4, 9.4, 9.6, 0.8), seg(9.4, 9.6, 8.6, 13.2, 0.8),
      seg(6.2, 8.4, 4, 11, 0.8), seg(4, 11, 0.8, 11.2, 0.8));
    t.shape(limbs, RWH, { grad: [0.6, 0.9] });
  };
  UI.eye = t => {
    const lens = (x, y) => { const dx = (x + 0.5 - 7) / 7, h = 4.6 * (1 - dx * dx); return Math.abs(y + 0.5 - 5) <= h; };
    t.shape(lens, RWH, { grad: [0.55, 0.85] });
    t.shape(ell(7, 5, 2.9, 2.9), { 1: P.steel, 2: P.steel, 3: P.slate, 4: P.slate, 5: P.navy }, { grad: [0.5, 0.8] });
    t.S(['NN', 'NN'], 6, 4, { N: P.navy }); t.px(6, 3, 'h');
  };
  UI.target = t => {
    const cx = 6.5, cy = 6.5;
    t.shape((x, y) => {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, r = Math.hypot(dx, dy);
      if (r >= 4 && r <= 5.4) return true;
      return (Math.abs(dx) < 1 && r >= 2 && r <= 6.9) || (Math.abs(dy) < 1 && r >= 2 && r <= 6.9);
    }, RWH, { grad: [0.6, 0.9] });
    t.px(6, 6, 'h');
  };
  UI.backpack = t => t.S([
    // pack with its flap thrown open over the dark mouth
    '...hhhhhh...',
    '..hmmmmmmh..',
    '..hhhhhhhs..',
    '.hNNNNNNNNs.',
    'hhhhhhhhhhhs',
    'hhhhhhhhhhhs',
    'nhmmmmmmmmhn',
    'nhmhhhhhhmhn',
    'nhmhhNNhhmhn',
    'nhmhhhhhhmhn',
    'nhmmmmmmmmhn',
    '.ssssssssss.',
  ]);
  UI.close = t => t.shape(union(seg(1, 1, 10, 10, 1.25), seg(10, 1, 1, 10, 1.25)), RWH, { grad: [0.6, 0.9] });

  function uiIcon(name, tint) {
    name = String(name); const key = tint ? name + '|' + tint : name;
    if (uiCache[key]) return uiCache[key];
    let c = null;
    try {
      if (tint) {
        const base = uiIcon(name);
        const [cc, g] = cv(); g.drawImage(base, 0, 0);
        const im = g.getImageData(0, 0, W16, W16), d = im.data, T = ART.rgb(tint), o = ART.rgb(OUT);
        for (let i = 0; i < d.length; i += 4) {
          if (!d[i + 3]) continue; if (d[i] === o[0] && d[i + 1] === o[1] && d[i + 2] === o[2]) continue;
          const l = (d[i] + d[i + 1] + d[i + 2]) / 765; // 0..1 brightness of the glyph shade
          const k = 0.25 + l * 0.85;
          d[i] = Math.min(255, T[0] * k + (l > 0.97 ? 40 : 0)); d[i + 1] = Math.min(255, T[1] * k + (l > 0.97 ? 40 : 0)); d[i + 2] = Math.min(255, T[2] * k + (l > 0.97 ? 40 : 0));
        }
        g.putImageData(im, 0, 0); c = cc;
      } else {
        const [cc, g] = cv();
        const fn = UI[name];
        if (fn) fn(uiT(g)); else uiT(g).S(['.hhhh.', 'hs..hs', '...hs.', '..hs..', '......', '..hs..'], 4, 3);
        c = finish(cc);
      }
    } catch (e) { c = null; }
    if (!c) c = cv()[0];
    return (uiCache[key] = c);
  }

  // ================================================================ export
  ART.icon = icon;
  ART.uiIcon = uiIcon;
  ART.iconURL = id => { const k = 'i:' + id; if (!urlCache[k]) { try { urlCache[k] = icon(id).toDataURL(); } catch (e) { urlCache[k] = ''; } } return urlCache[k]; };
  ART.uiIconURL = (name, tint) => { const k = 'u:' + name + '|' + (tint || ''); if (!urlCache[k]) { try { urlCache[k] = uiIcon(name, tint).toDataURL(); } catch (e) { urlCache[k] = ''; } } return urlCache[k]; };
  ART.UI_ICONS = ['reload', 'swap', 'heal', 'grenade', 'bag', 'map', 'build', 'base', 'deploy', 'pause', 'hand', 'skull', 'heart', 'rad', 'shield', 'stamina', 'bleed', 'clock',
    'craft', 'trade', 'research', 'smelt', 'recycle', 'stash', 'upgrade', 'repair', 'remove', 'check', 'lock', 'star', 'door', 'wall', 'turret', 'bed',
    'foundation', 'ceiling', 'doorway', 'window', 'lowwall', 'highwall', 'gate', 'tc', 'box', 'furnace', 'workbench', 'campfire', 'sleepingbag', 'trap', 'mine',
    'light', 'planter', 'drop', 'quarry', 'food', 'drink', 'sun', 'moon', 'compass', 'rotate', 'hammer', 'cook', 'airdrop', 'raid', 'vendor', 'info', 'torch',
    'sprint', 'eye', 'target', 'backpack', 'close'];

  // pre-warm the caches once at init (cheap; keeps first inventory open snappy)
  ART.builders.push(function buildIcons() {
    try { if (typeof ITEMS !== 'undefined') for (const id in ITEMS) icon(id); } catch (e) { }
    for (const n of ART.UI_ICONS) uiIcon(n);
  });
})();
