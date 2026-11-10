// The Ember Citadel picture: a small fortress-town on a hill at dusk that grows
// as upgrades are bought. Each upgrade's `art` key adds (or lights) one piece.
// Purely cosmetic (Math.random is fine here). The static scene is cached in an
// offscreen canvas and redrawn only when the owned set or the size changes;
// flames, glows and drifting embers animate on top.
import { CITADEL_UPGRADES } from '../data/citadel.js';

const VW = 400, VH = 260;           // design space
const hillY = (x) => Math.min(262, 96 + 168 * ((x - 200) / 236) ** 2);

// Stable pseudo-random numbers for the scenery (same every redraw).
function lcg(seed) { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; }

const C = {
  stone: '#5b5260', stoneHi: '#7a6f7c', stoneLo: '#3b343f', roof: '#6e3a32', roofHi: '#8b4a3c', wood: '#5a3e2c',
  win: '#ffcf6a', winDim: '#8a6a3a', ember: '#ff9a3a', gold: '#f0c040', pale: '#d9d4c4', mire: '#3f5a3a',
};

// ---- Drawing primitives (design units) ------------------------------------------------
function rect(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
function poly(g, pts, c) { g.fillStyle = c; g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); }
function crenels(g, x, y, w, c, step = 4) { for (let i = 0; i + step <= w + 0.01; i += step * 2) rect(g, x + i, y - 3, step, 3, c); }
function windowAt(g, x, y, w = 2.4, h = 3.4, lit = true, glows) {
  rect(g, x, y, w, h, lit ? C.win : C.winDim);
  if (lit && glows) glows.push({ x: x + w / 2, y: y + h / 2, r: 7, a: 0.35 });
}
function house(g, x, by, w, h, roof, glows, lit = true) {
  rect(g, x - w / 2, by - h, w, h, C.stone);
  rect(g, x - w / 2, by - h, w * 0.3, h, C.stoneHi);
  poly(g, [x - w / 2 - 2, by - h, x, by - h - w * 0.55, x + w / 2 + 2, by - h], roof);
  windowAt(g, x - 1.2, by - h * 0.62, 2.4, 3.2, lit, glows);
}
function tower(g, x, by, w, h, glows, roofC = null) {
  rect(g, x - w / 2, by - h, w, h, C.stone);
  rect(g, x - w / 2, by - h, w * 0.35, h, C.stoneHi);
  rect(g, x + w / 2 - w * 0.2, by - h, w * 0.2, h, C.stoneLo);
  if (roofC) poly(g, [x - w / 2 - 2, by - h, x, by - h - w * 1.1, x + w / 2 + 2, by - h], roofC);
  else { rect(g, x - w / 2 - 1.5, by - h - 1, w + 3, 2.5, C.stoneHi); crenels(g, x - w / 2 - 1.5, by - h - 1, w + 3, C.stoneHi, 2.5); }
  windowAt(g, x - 1, by - h * 0.7, 2, 3.2, true, glows);
  windowAt(g, x - 1, by - h * 0.38, 2, 3.2, true, glows);
}
function flag(g, x, y, colors, h = 14, w = 9) {
  rect(g, x, y - h, 1, h, '#2a2224');
  poly(g, [x + 1, y - h, x + 1 + w, y - h + 2, x + 1 + w * 0.8, y - h + 4.5, x + 1 + w, y - h + 7, x + 1, y - h + 7], colors[0]);
  rect(g, x + 1, y - h + 3, w * 0.75, 1.4, colors[1]);
}
function brazierPost(g, x, by, flames, size = 1) {
  rect(g, x - 0.7, by - 7 * size, 1.4, 7 * size, '#2e2628');
  poly(g, [x - 2.4 * size, by - 7 * size, x + 2.4 * size, by - 7 * size, x + 1.4 * size, by - 9 * size, x - 1.4 * size, by - 9 * size], '#4a3c38');
  flames.push({ x, y: by - 9.5 * size, s: size });
}

// ---- Pieces: art key -> { x, depth, draw(g, ctx) } ---------------------------------------
// ctx = { glows, flames, banner: [field, charge], owned: Set }
const PIECES = {
  keep: { x: 200, draw(g, k) { // the Hearthstone Keep: a tall keep replaces the old hall
    const by = hillY(200) + 2;
    rect(g, 186, by - 40, 28, 40, C.stone); rect(g, 186, by - 40, 9, 40, C.stoneHi); rect(g, 208, by - 40, 6, 40, C.stoneLo);
    crenels(g, 186, by - 40, 28, C.stone, 3);
    tower(g, 184, by, 8, 46, k.glows); tower(g, 216, by, 8, 46, k.glows);
    rect(g, 196.5, by - 12, 7, 12, '#2a1f1c');
    for (const wx of [190, 200, 207]) windowAt(g, wx, by - 30, 2.4, 4, true, k.glows);
  } },
  walls: { x: 200, depth: -1, draw(g) { // summit curtain wall
    g.save();
    for (let x = 136; x < 264; x += 2) {
      const y = hillY(x) + 14;
      rect(g, x, y - 9, 2.2, 9, ((x / 2) | 0) % 6 === 0 ? C.stoneHi : C.stone);
      if (((x / 2) | 0) % 2 === 0) rect(g, x, y - 12, 2.2, 3, C.stone);
    }
    g.restore();
  } },
  towerL: { x: 134, draw(g, k) { tower(g, 134, hillY(134) + 16, 11, 34, k.glows, C.roof); } },
  towerR: { x: 266, draw(g, k) { tower(g, 266, hillY(266) + 16, 11, 34, k.glows, C.roof); } },
  gatehouse: { x: 208, draw(g, k) {
    const by = hillY(208) + 74;
    rect(g, 196, by - 20, 24, 20, C.stone); rect(g, 196, by - 20, 7, 20, C.stoneHi);
    crenels(g, 196, by - 20, 24, C.stone, 3);
    g.fillStyle = '#21181a'; g.beginPath(); g.moveTo(203, by); g.lineTo(203, by - 9); g.arc(208, by - 9, 5, Math.PI, 0); g.lineTo(213, by); g.fill();
    rect(g, 203.5, by - 10, 9, 0.8, '#5a4a40'); rect(g, 203.5, by - 7, 9, 0.8, '#5a4a40');
    windowAt(g, 199, by - 16, 2, 3, true, k.glows); windowAt(g, 215, by - 16, 2, 3, true, k.glows);
  } },
  cottages: { x: 104, draw(g, k) {
    house(g, 92, hillY(92) + 6, 12, 9, C.roof, k.glows);
    house(g, 110, hillY(110) + 4, 11, 8, C.roofHi, k.glows);
    house(g, 302, hillY(302) + 5, 12, 9, C.roof, k.glows);
  } },
  larder: { x: 66, draw(g, k) {
    const by = hillY(66) + 4;
    rect(g, 56, by - 11, 20, 11, '#6a4a32'); rect(g, 56, by - 11, 6, 11, '#7d5a3c');
    poly(g, [54, by - 11, 66, by - 20, 78, by - 11], '#7b3d2e');
    rect(g, 63, by - 7, 6, 7, '#3a2a20'); windowAt(g, 71, by - 9, 2, 2.6, true, k.glows);
    for (let i = 0; i < 3; i++) { g.fillStyle = '#c9a04a'; g.beginPath(); g.ellipse(48 + i * 3, by - 2, 2.2, 3, 0, 0, 7); g.fill(); }
  } },
  timber: { x: 334, draw(g) {
    const by = hillY(334) + 3;
    g.fillStyle = '#6b4a30';
    for (let r = 0; r < 3; r++) for (let i = 0; i < 3 - r; i++) { g.beginPath(); g.arc(328 + i * 4.4 + r * 2.2, by - 2.2 - r * 3.8, 2.2, 0, 7); g.fill(); }
    g.fillStyle = '#c49a6a'; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(328 + i * 4.4, by - 2.2, 1, 0, 7); g.fill(); }
    rect(g, 342, by - 9, 1.2, 9, C.wood); rect(g, 352, by - 9, 1.2, 9, C.wood); poly(g, [340, by - 9, 348, by - 14, 356, by - 9], '#5a4030');
  } },
  mint: { x: 160, draw(g, k) {
    const by = hillY(160) + 30;
    rect(g, 150, by - 12, 20, 12, C.stone); rect(g, 150, by - 12, 6, 12, C.stoneHi);
    g.fillStyle = '#b08a3a'; g.beginPath(); g.arc(160, by - 12, 8, Math.PI, 0); g.fill();
    g.fillStyle = C.gold; g.beginPath(); g.arc(160, by - 21, 1.6, 0, 7); g.fill();
    windowAt(g, 153, by - 8, 2.2, 3, true, k.glows); windowAt(g, 165, by - 8, 2.2, 3, true, k.glows);
    k.glows.push({ x: 160, y: by - 21, r: 6, a: 0.4, c: '255,214,90' });
  } },
  quarry: { x: 352, depth: 1, draw(g) {
    const by = hillY(352) + 6;
    poly(g, [340, by, 346, by - 14, 362, by - 16, 368, by], '#8a8290');
    poly(g, [344, by, 349, by - 10, 360, by - 11, 364, by], '#6a6270');
    rect(g, 336, by - 4, 5, 4, '#a8a2a8'); rect(g, 331, by - 3, 4, 3, '#9a949c');
  } },
  library: { x: 244, draw(g, k) {
    const by = hillY(244) + 30;
    rect(g, 239, by - 30, 10, 30, C.stone); rect(g, 239, by - 30, 3.5, 30, C.stoneHi);
    poly(g, [237, by - 30, 244, by - 40, 251, by - 30], '#3e4f7a');
    windowAt(g, 242.6, by - 24, 2.8, 4.5, true, k.glows); windowAt(g, 242.6, by - 14, 2.8, 4.5, true, k.glows);
    k.glows.push({ x: 244, y: by - 22, r: 12, a: 0.3, c: '150,200,255' });
  } },
  barracks: { x: 276, draw(g, k) {
    const by = hillY(276) + 32;
    rect(g, 262, by - 10, 28, 10, C.stone); rect(g, 262, by - 10, 8, 10, C.stoneHi);
    poly(g, [260, by - 10, 266, by - 16, 286, by - 16, 292, by - 10], C.roof);
    for (const wx of [268, 276, 284]) windowAt(g, wx, by - 7, 2.2, 3, true, k.glows);
    flag(g, 290, by - 16, ['#a3242b', '#e8b63c'], 12, 7);
  } },
  braziers: { x: 205, depth: 2, draw(g, k) { for (const [x, dy] of [[214, 108], [196, 92], [212, 60], [194, 40], [206, 22]]) brazierPost(g, x, hillY(x) + dy, k.flames, 0.9); } },
  spring: { x: 122, depth: 1, draw(g, k) {
    const by = hillY(122) + 40;
    g.fillStyle = '#3c3640'; g.beginPath(); g.ellipse(122, by, 11, 3.6, 0, 0, 7); g.fill();
    g.fillStyle = '#5fd0c8'; g.beginPath(); g.ellipse(122, by - 0.4, 9, 2.6, 0, 0, 7); g.fill();
    rect(g, 121, by - 8, 2, 7, C.stoneHi);
    k.glows.push({ x: 122, y: by - 2, r: 16, a: 0.35, c: '95,208,200' });
  } },
  vault: { x: 178, draw(g, k) {
    const by = hillY(178) + 58;
    rect(g, 168, by - 9, 20, 9, C.stoneLo); rect(g, 168, by - 11, 20, 2.5, C.stoneHi);
    rect(g, 175, by - 7, 6, 7, '#7a5a2a'); rect(g, 177.6, by - 5, 0.8, 2, C.gold);
    k.glows.push({ x: 178, y: by - 4, r: 5, a: 0.3, c: '255,214,90' });
  } },
  hall: { x: 226, draw(g, k) {
    const by = hillY(226) + 52;
    rect(g, 214, by - 14, 26, 14, C.stone); rect(g, 214, by - 14, 8, 14, C.stoneHi);
    poly(g, [212, by - 14, 227, by - 24, 242, by - 14], C.roofHi);
    for (const wx of [218, 225, 232]) windowAt(g, wx, by - 10, 2.4, 4, true, k.glows);
    flag(g, 227, by - 24, k.banner, 10, 7);
  } },
  workshop: { x: 312, draw(g, k) {
    const by = hillY(312) + 26;
    rect(g, 302, by - 11, 18, 11, '#6a5040'); rect(g, 302, by - 11, 5, 11, '#7d6050');
    poly(g, [300, by - 11, 311, by - 18, 322, by - 11], C.roof);
    rect(g, 315, by - 22, 3, 8, C.stoneLo);
    windowAt(g, 309, by - 7, 2.4, 3, true, k.glows);
    k.smoke.push({ x: 316.5, y: by - 23 });
  } },
  ranges: { x: 56, depth: 2, draw(g) {
    const by = hillY(56) + 4;
    for (const tx of [48, 62]) {
      rect(g, tx - 0.6, by - 9, 1.2, 9, C.wood);
      g.fillStyle = '#e8d8b0'; g.beginPath(); g.arc(tx, by - 10, 3.6, 0, 7); g.fill();
      g.fillStyle = '#a3242b'; g.beginPath(); g.arc(tx, by - 10, 2.2, 0, 7); g.fill();
      g.fillStyle = '#e8d8b0'; g.beginPath(); g.arc(tx, by - 10, 0.9, 0, 7); g.fill();
    }
  } },
  temple: { x: 152, draw(g, k) {
    const by = hillY(152) + 14;
    rect(g, 143, by - 14, 18, 14, C.pale); rect(g, 143, by - 14, 5, 14, '#ece6d6');
    poly(g, [141, by - 14, 152, by - 22, 163, by - 14], '#8a7a5a');
    rect(g, 150.5, by - 34, 3, 13, C.pale); poly(g, [149.5, by - 34, 152, by - 41, 154.5, by - 34], '#c9973e');
    windowAt(g, 150.8, by - 10, 2.4, 6, true, k.glows);
    k.flames.push({ x: 152, y: by - 42.5, s: 0.55 });
  } },
  guild1: { x: 262, depth: -0.5, draw(g, k) {
    const by = hillY(262) + 16;
    flag(g, 254, by - 24, ['#5d3a7a', '#e8b63c'], 16, 9);
    rect(g, 247, by - 9, 14, 9, C.stone); poly(g, [245, by - 9, 254, by - 15, 263, by - 9], '#5d3a7a');
    windowAt(g, 252.5, by - 6, 2.4, 3, true, k.glows);
  } },
  guild2: { x: 140, depth: -0.5, draw(g, k) {
    const by = hillY(140) + 18;
    flag(g, 147, by - 26, ['#2c4f8c', '#ece6d6'], 18, 9);
    rect(g, 138, by - 9, 14, 9, C.stone); poly(g, [136, by - 9, 145, by - 15, 154, by - 9], '#2c4f8c');
    windowAt(g, 143.5, by - 6, 2.4, 3, true, k.glows);
  } },
  mire: { x: 96, fy: 226, depth: 3, draw(g, k) {
    g.save(); g.translate(78, -22);
    const by = 250;
    g.fillStyle = '#26383a'; g.beginPath(); g.ellipse(18, by + 4, 22, 5, 0, 0, 7); g.fill();
    for (const px of [8, 22]) rect(g, px, by - 8, 1.4, 10, C.wood);
    rect(g, 5, by - 15, 20, 7, C.mire); poly(g, [3, by - 15, 15, by - 23, 27, by - 15], '#5a6a3a');
    windowAt(g, 13.5, by - 13, 2.6, 3, true, k.glows);
    g.restore();
    k.glows.push({ x: 96, y: 231, r: 12, a: 0.22, c: '130,220,120' });
  } },
  pale: { x: 304, fy: 214, depth: 3, draw(g, k) {
    g.save(); g.translate(-82, -22);
    const by = 254;
    rect(g, 380, by - 30, 12, 30, C.pale); rect(g, 380, by - 30, 4, 30, '#efeadc');
    poly(g, [378, by - 30, 386, by - 46, 394, by - 30], '#b8b0a0');
    windowAt(g, 384.6, by - 22, 2.8, 4, false);
    g.fillStyle = '#9ad8e8'; g.fillRect(384.6, by - 22, 2.8, 4);
    g.restore();
    k.glows.push({ x: 304, y: 212, r: 12, a: 0.35, c: '150,220,240' });
  } },
  reliquary1: { x: 188, depth: 0.5, draw(g, k) {
    const by = hillY(188) + 82;
    rect(g, 180, by - 10, 14, 10, C.stone); rect(g, 180, by - 10, 4, 10, C.stoneHi);
    poly(g, [178, by - 10, 187, by - 17, 196, by - 10], '#5d3a7a');
    windowAt(g, 185.8, by - 7, 2.4, 4, true, k.glows);
    k.glows.push({ x: 187, y: by - 5, r: 9, a: 0.3, c: '200,150,255' });
  } },
  reliquary2: { x: 168, depth: 0.6, draw(g, k) {
    const by = hillY(168) + 86;
    rect(g, 160, by - 9, 14, 9, C.stone);
    g.fillStyle = '#8a6ab8'; g.beginPath(); g.arc(167, by - 9, 6, Math.PI, 0); g.fill();
    windowAt(g, 165.8, by - 6, 2.4, 3, true, k.glows);
    k.glows.push({ x: 167, y: by - 13, r: 12, a: 0.35, c: '200,150,255' });
  } },
  siege: { x: 366, depth: 2, draw(g) {
    const by = hillY(366) + 2;
    g.strokeStyle = C.wood; g.lineWidth = 1.6; g.beginPath();
    g.moveTo(358, by); g.lineTo(366, by - 12); g.lineTo(374, by);
    g.moveTo(354, by - 20); g.lineTo(376, by - 7); g.stroke();
    rect(g, 373, by - 9, 4, 4, '#4a4048');
    g.fillStyle = '#3a2c24'; for (const wx of [359, 373]) { g.beginPath(); g.arc(wx, by, 2.4, 0, 7); g.fill(); }
  } },
  wonder: { x: 322, depth: -2, draw(g, k) {
    const by = hillY(322) + 12;
    poly(g, [316, by, 319, by - 58, 325, by - 58, 328, by], '#e8d8a8');
    poly(g, [316, by, 319, by - 58, 321, by - 58, 319, by], '#fff2c8');
    g.fillStyle = '#fff2c8'; g.beginPath(); g.arc(322, by - 62, 4, 0, 7); g.fill();
    k.glows.push({ x: 322, y: by - 62, r: 30, a: 0.55, c: '255,226,140' });
    k.beams.push({ x: 322, y: by - 62 });
  } },
  banner: { x: 200, depth: -3, draw() {} }, // banners colour the keep's flags (see drawScene)
};

/** Progress 0..1 = owned upgrades / all upgrades. */
function progressOf(owned) { return Math.min(1, owned.size / Math.max(1, Object.keys(CITADEL_UPGRADES).length)); }

function drawSky(g, w, h, prog) {
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#120f22'); sky.addColorStop(0.45, '#3a2446'); sky.addColorStop(0.78, '#8a3f46'); sky.addColorStop(1, '#d9773e');
  g.fillStyle = sky; g.fillRect(0, 0, w, h);
  const r = lcg(7);
  g.fillStyle = '#f6ead2';
  for (let i = 0; i < 70; i++) { const x = r() * w, y = r() * h * 0.5; g.globalAlpha = 0.25 + r() * 0.6 * (1 - y / (h * 0.5)); g.fillRect(x, y, r() < 0.15 ? 1.6 : 1, r() < 0.15 ? 1.6 : 1); }
  g.globalAlpha = 1;
  void prog;
}

/** Render the static scene into g (already scaled so 1 unit = 1 design unit). */
function drawScene(g, sc, ox, oy, w, h, owned, bannerColors) {
  const k = { glows: [], flames: [], smoke: [], beams: [], banner: bannerColors, owned };
  // Moon.
  g.save();
  g.fillStyle = '#f3e6c8'; g.beginPath(); g.arc(w * 0.13, h * 0.15, Math.max(8, 10 * sc), 0, 7); g.fill();
  g.fillStyle = '#2a1d38'; g.beginPath(); g.arc(w * 0.13 + 4 * sc, h * 0.15 - 2 * sc, Math.max(8, 10 * sc), 0, 7); g.fill();
  g.restore();
  g.save();
  g.translate(ox, oy); g.scale(sc, sc);
  const x0 = -ox / sc - 2, x1 = (w - ox) / sc + 2, yb = (h - oy) / sc + 2;
  // Distant ridges.
  const ridge = (base, amp, col, seed) => {
    const r = lcg(seed);
    g.fillStyle = col; g.beginPath(); g.moveTo(x0, yb);
    for (let x = x0; x <= x1 + 20; x += 20) g.lineTo(x, base - amp * (0.4 + r() * 0.6));
    g.lineTo(x1, yb); g.closePath(); g.fill();
  };
  ridge(170, 50, '#3a2440', 3); ridge(196, 36, '#2a1c32', 11);
  // The hill.
  const hill = g.createLinearGradient(0, 90, 0, 262);
  hill.addColorStop(0, '#2e2634'); hill.addColorStop(1, '#17131c');
  g.fillStyle = hill; g.beginPath(); g.moveTo(x0, yb);
  for (let x = x0; x <= x1; x += 4) g.lineTo(x, Math.min(hillY(x), 262));
  g.lineTo(x1, yb); g.closePath(); g.fill();
  rect(g, x0, 258, x1 - x0, yb - 258, '#17131c');
  // Rim light from the sunset.
  g.strokeStyle = 'rgba(217,119,62,0.35)'; g.lineWidth = 1.2; g.beginPath();
  for (let x = 40; x <= 360; x += 4) { const y = hillY(x); if (x === 40) g.moveTo(x, y); else g.lineTo(x, y); }
  g.stroke();
  // The winding road.
  g.strokeStyle = '#4a3b36'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath();
  g.moveTo(232, 262); g.bezierCurveTo(176, 228, 238, 190, 206, 168); g.bezierCurveTo(176, 146, 222, 128, 200, 104); g.stroke();
  g.strokeStyle = 'rgba(255,190,120,0.12)'; g.lineWidth = 1.2; g.stroke();
  // Pieces, back to front.
  const list = [];
  for (const id of owned) { const u = CITADEL_UPGRADES[id]; const p = u && PIECES[u.art]; if (p && !list.includes(p)) list.push(p); }
  const yOf = (p) => (p.depth || 0) * 10 + hillY(p.x);
  list.sort((a, b) => yOf(a) - yOf(b));
  // The summit always holds the old hall unless the Keep is built.
  const keepBuilt = list.includes(PIECES.keep);
  const drawSummit = () => {
    const by = hillY(200) + 2;
    if (!keepBuilt) {
      rect(g, 188, by - 22, 24, 22, C.stone); rect(g, 188, by - 22, 7, 22, C.stoneHi);
      crenels(g, 188, by - 22, 24, C.stone, 3);
      rect(g, 197, by - 9, 6, 9, '#2a1f1c');
      windowAt(g, 191, by - 17, 2.2, 3.2, true, k.glows); windowAt(g, 206, by - 17, 2.2, 3.2, true, k.glows);
    }
    // Flags in the realm's banner colours.
    const top = keepBuilt ? by - 47 : by - 25;
    flag(g, keepBuilt ? 184 : 189, top, bannerColors, 13, 9);
    if (keepBuilt) flag(g, 216, top, bannerColors, 13, 9);
    // The great Ember Brazier crowns the hill.
    const bt = keepBuilt ? by - 43 : by - 22;
    poly(g, [194, bt, 206, bt, 203, bt - 5, 197, bt - 5], '#4a3c38');
    rect(g, 199, bt - 2, 2, 2, '#2e2628');
    k.flames.push({ x: 200, y: bt - 6, s: 1.6, main: true });
  };
  for (const p of list) if (p.depth != null && p.depth < 0) p.draw(g, k);
  drawSummit();
  for (const p of list) if (!(p.depth != null && p.depth < 0)) p.draw(g, k);
  g.restore();
  return k;
}

export class CitadelArt {
  constructor(canvas, { reduceMotion = false } = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.reduceMotion = reduceMotion;
    this.owned = new Set();
    this.bannerColors = ['#c9973e', '#7a2a1c'];
    this.cache = document.createElement('canvas');
    this.key = '';
    this.flash = null;
    this.parts = [];
    this.raf = 0;
    this.t = 0;
    this.last = 0;
    this.dead = false;
    this.layout = null;
  }

  set(ownedIds, bannerColors, flashId = null) {
    this.owned = new Set(ownedIds);
    if (bannerColors) this.bannerColors = bannerColors;
    this.key = '';
    if (flashId) {
      const u = CITADEL_UPGRADES[flashId];
      const p = u && PIECES[u.art];
      const x = p ? p.x : 200;
      this.flash = { x, y: p ? (p.fy != null ? p.fy : hillY(x) + 10) : 80, t: 0 };
      for (let i = 0; i < 40; i++) this.parts.push({ x: this.flash.x, y: this.flash.y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 40, life: 1 + Math.random(), age: 0, big: true });
    }
    this.draw(0);
    if (this.loop && !this.running && !this.dead) { this.running = true; this.last = 0; this.raf = requestAnimationFrame(this.loop); }
  }

  start() {
    const loop = (now) => {
      if (this.dead) return;
      if (!this.canvas.isConnected) { this.destroy(); return; }
      const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
      this.last = now;
      this.draw(dt);
      if (!this.reduceMotion || this.flash) this.raf = requestAnimationFrame(loop);
      else this.running = false;
    };
    this.loop = loop;
    this.running = true;
    this.raf = requestAnimationFrame(loop);
    // With reduced motion the loop sleeps: still re-lay out on rotation and resize.
    this.onResize = () => {
      if (this.dead) return;
      if (!this.canvas.isConnected) { this.destroy(); return; }
      if (!this.running) { this.running = true; this.last = 0; this.raf = requestAnimationFrame(this.loop); }
    };
    window.addEventListener('resize', this.onResize);
  }

  destroy() {
    this.dead = true; cancelAnimationFrame(this.raf);
    if (this.onResize) { window.removeEventListener('resize', this.onResize); this.onResize = null; }
  }

  /** Rebuild the static layer when the size or the owned set changes. */
  ensure() {
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${w}x${h}@${dpr}|${[...this.owned].sort().join(',')}|${this.bannerColors.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    this.cache.width = c.width; this.cache.height = c.height;
    const g = this.cache.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fit the hill: width-limited, the summit kept in view; sky fills the rest.
    // Design rows 30..245 (keep flags to the foreground) always fit.
    const sc = Math.min(w / (VW * 0.92), h / 215);
    const ox = (w - VW * sc) / 2;
    const oy = h - 245 * sc;
    drawSky(g, w, h, progressOf(this.owned));
    const k = drawScene(g, sc, ox, oy, w, h, this.owned, this.bannerColors);
    // Window glow halos are static (baked in additively).
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const gl of k.glows) {
      const x = ox + gl.x * sc, y = oy + gl.y * sc, r = gl.r * sc;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${gl.c || '255,190,90'},${gl.a})`); gr.addColorStop(1, `rgba(${gl.c || '255,190,90'},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
    this.layout = { w, h, dpr, sc, ox, oy, k, prog: progressOf(this.owned) };
  }

  draw(dt) {
    this.ensure();
    const L = this.layout;
    if (!L) return;
    const g = this.g, { w, h, dpr, sc, ox, oy, k, prog } = L;
    this.t += dt;
    const t = this.t;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.cache, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.save();
    g.globalCompositeOperation = 'lighter';
    // The great brazier's glow grows with the Citadel.
    for (const f of k.flames) {
      const x = ox + f.x * sc, y = oy + f.y * sc;
      const flick = this.reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(t * 9 + f.x) * Math.sin(t * 5.3 + f.y);
      const r = (f.main ? (16 + 46 * prog) : 7 * f.s) * sc * flick;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, f.main ? 'rgba(255,170,70,0.75)' : 'rgba(255,170,70,0.55)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      // Flame tongue.
      const fh = (f.main ? 5 + 4 * prog : 3) * f.s * sc * flick, fw = (f.main ? 2.6 : 1.6) * f.s * sc;
      g.fillStyle = 'rgba(255,214,120,0.95)';
      g.beginPath(); g.moveTo(x - fw, y + fw * 0.6); g.quadraticCurveTo(x - fw * 0.4, y - fh * 0.5, x, y - fh); g.quadraticCurveTo(x + fw * 0.4, y - fh * 0.5, x + fw, y + fw * 0.6); g.closePath(); g.fill();
    }
    for (const b of k.beams) {
      const x = ox + b.x * sc, y = oy + b.y * sc;
      const gr = g.createLinearGradient(x, y, x, 0);
      gr.addColorStop(0, 'rgba(255,230,150,0.35)'); gr.addColorStop(1, 'rgba(255,230,150,0)');
      g.fillStyle = gr; g.fillRect(x - 3 * sc, 0, 6 * sc, y);
    }
    // Purchase flash.
    if (this.flash) {
      const f = this.flash; f.t += dt;
      const a = Math.max(0, 1 - f.t / 1.6);
      const x = ox + f.x * sc, y = oy + f.y * sc, r = (20 + 40 * f.t) * sc;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,200,110,${0.7 * a})`); gr.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      if (a <= 0) this.flash = null;
    }
    // Drifting embers from the great brazier (more as the Citadel grows).
    if (!this.reduceMotion) {
      const main = k.flames.find((f) => f.main);
      if (main && Math.random() < (0.25 + 0.6 * prog) * Math.min(1, dt * 60)) this.parts.push({ x: main.x + (Math.random() - 0.5) * 4, y: main.y, vx: (Math.random() - 0.5) * 8, vy: -10 - Math.random() * 16, life: 2 + Math.random() * 2, age: 0 });
      for (const s of k.smoke) if (Math.random() < 0.15 * Math.min(1, dt * 60)) this.parts.push({ x: s.x, y: s.y, vx: 2 + Math.random() * 3, vy: -5 - Math.random() * 4, life: 3, age: 0, smoke: true });
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - dt * 0.5;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      const a = 1 - p.age / p.life;
      const x = ox + p.x * sc, y = oy + p.y * sc;
      if (p.smoke) {
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(120,110,120,${0.25 * a})`;
        g.beginPath(); g.arc(x, y, (1.5 + p.age * 1.6) * sc, 0, 7); g.fill();
        g.globalCompositeOperation = 'lighter';
      } else {
        g.fillStyle = `rgba(255,${150 + ((p.big ? 60 : 30) * a) | 0},70,${a})`;
        g.fillRect(x - 0.8 * sc, y - 0.8 * sc, (p.big ? 1.6 : 1.1) * sc, (p.big ? 1.6 : 1.1) * sc);
      }
    }
    g.restore();
  }
}

/** Which art pieces exist (for tests). */
export const CITADEL_PIECES = Object.keys(PIECES);
