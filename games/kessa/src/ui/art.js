// ===== art.js : procedural isometric drawing of buildings, vehicles and props =====
const TW = 64, TH = 32, HZ = 52;
// tile-space (x, y) and height z in px -> world px
const isoX = (x, y) => (x - y) * TW / 2;
const isoY = (x, y, z) => (x + y) * TH / 2 - (z || 0);
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}
function poly(ctx, pts, fill, stroke, lw) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
}
const P = (x, y, z) => [isoX(x, y), isoY(x, y, z)];
// a box over tile rect (x..x+w, y..y+d) from height z to z+h
function box(ctx, x, y, w, d, z, h, col, opt = {}) {
  const top = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  poly(ctx, [P(x + w, y, z), P(x + w, y + d, z), top[2], top[1]], opt.right || shade(col, -0.32));
  poly(ctx, [P(x, y + d, z), P(x + w, y + d, z), top[2], top[3]], opt.left || shade(col, -0.15));
  poly(ctx, top, opt.top || shade(col, 0.12), opt.edge === false ? null : 'rgba(0,0,0,.25)', 0.6);
  return top;
}
// cylinder centred at tile point (cx, cy), radius r in tiles
function cyl(ctx, cx, cy, r, z, h, col, topCol) {
  const x = isoX(cx, cy), y0 = isoY(cx, cy, z), y1 = y0 - h, rx = r * TW * 0.707, ry = r * TH * 0.707;
  const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  g.addColorStop(0, shade(col, -0.05)); g.addColorStop(0.45, shade(col, 0.1)); g.addColorStop(1, shade(col, -0.4));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y0, rx, ry, 0, 0, Math.PI); ctx.lineTo(x - rx, y1); ctx.ellipse(x, y1, rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
  ctx.fillStyle = topCol || shade(col, 0.2); ctx.beginPath(); ctx.ellipse(x, y1, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.6; ctx.stroke();
  return [x, y1];
}
function sphere(ctx, cx, cy, r, z, col) {
  const x = isoX(cx, cy), y = isoY(cx, cy, z) - r * 22, rr = r * 24;
  const g = ctx.createRadialGradient(x - rr * 0.35, y - rr * 0.4, rr * 0.1, x, y, rr);
  g.addColorStop(0, shade(col, 0.45)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.5));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
}
function pole(ctx, cx, cy, z, h, col, w) { const x = isoX(cx, cy), y = isoY(cx, cy, z); ctx.strokeStyle = col; ctx.lineWidth = w || 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke(); return [x, y - h]; }
function light(ctx, x, y, col, t, r) { const on = Math.sin(t * 3 + x * 0.1) > 0.2; if (!on) return; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r || 1.6, 0, Math.PI * 2); ctx.fill(); }
function pad(ctx, x, y, s, z, col) { poly(ctx, [P(x + 0.08, y + 0.08, z), P(x + s - 0.08, y + 0.08, z), P(x + s - 0.08, y + s - 0.08, z), P(x + 0.08, y + s - 0.08, z)], col || '#6f6259', 'rgba(0,0,0,.3)'); }

const HULL = '#d9cbb8', HULL2 = '#b9a58e', DARK = '#4a4440', TEAL = '#4fb3b0', ORANGE = '#e88a3c', GLASS = '#8fd0e8';
// each draws a building occupying tiles (x, y)..(x+s, y+s) at ground height z
const ART = {
  lander(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#5d524b');
    for (const [a, b] of [[0.4, 0.4], [2.6, 0.4], [0.4, 2.6], [2.6, 2.6]]) { const p0 = P(x + a, y + b, z), p1 = P(x + 1.5, y + 1.5, z + 26); c.strokeStyle = '#8d8178'; c.lineWidth = 2; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); }
    cyl(c, x + 1.5, y + 1.5, 0.95, z + 14, 20, HULL);
    cyl(c, x + 1.5, y + 1.5, 0.6, z + 34, 14, HULL2, '#e9dccb');
    const tp = cyl(c, x + 1.5, y + 1.5, 0.25, z + 48, 10, ORANGE);
    light(c, tp[0], tp[1] - 2, '#ff5a3a', t, 2.2);
    const w = P(x + 1.9, y + 2.2, z + 26); c.fillStyle = '#7fd8ff'; c.fillRect(w[0] - 4, w[1] - 3, 8, 3);
  },
  hub(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#5a524c');
    box(c, x + 0.3, y + 0.3, 1.4, 1.4, z, 8, '#cfc2ae');
    const top = cyl(c, x + 1, y + 1, 0.35, z + 8, 16, '#bfb2a0');
    pole(c, x + 1, y + 1, z + 24, 14, '#8c8079', 1.5);
    light(c, top[0], top[1] - 14, '#4fe0ff', t, 2);
    for (const [a, b] of [[0.55, 1.5], [1.5, 0.55]]) { const p = P(x + a, y + b, z + 8.5); c.fillStyle = '#2b2622'; c.beginPath(); c.ellipse(p[0], p[1], 6, 3, 0, 0, 7); c.fill(); c.strokeStyle = '#4fe0ff'; c.lineWidth = 0.8; c.stroke(); }
  },
  depot(c, x, y, s, z) {
    pad(c, x, y, s, z);
    box(c, x + 0.2, y + 0.2, 0.8, 0.8, z, 9, '#c58b4e'); box(c, x + 1.0, y + 0.2, 0.8, 0.8, z, 9, '#7d8f9a');
    box(c, x + 0.2, y + 1.0, 0.8, 0.8, z, 9, '#8a9a6a'); box(c, x + 1.0, y + 1.0, 0.8, 0.8, z, 9, '#c9b18a'); box(c, x + 0.6, y + 0.6, 0.8, 0.8, z + 9, 8, '#a57e5b');
  },
  mast(c, x, y, s, z, t) {
    const b = P(x + 0.5, y + 0.5, z), h = 54;
    c.strokeStyle = '#b8aa98'; c.lineWidth = 1.2;
    for (const dx of [-6, 6]) { c.beginPath(); c.moveTo(b[0] + dx, b[1]); c.lineTo(b[0], b[1] - h); c.stroke(); }
    for (let k = 1; k < 6; k++) { const yy = b[1] - k * h / 6, w = 6 * (1 - k / 6); c.beginPath(); c.moveTo(b[0] - w, yy); c.lineTo(b[0] + w, yy + 4); c.stroke(); }
    const a = t * 0.6; c.fillStyle = '#e8ddd0'; c.beginPath(); c.ellipse(b[0] + Math.cos(a) * 3, b[1] - h + 4, 8, 4, Math.cos(a) * 0.4, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#8a7d70'; c.stroke();
    light(c, b[0], b[1] - h - 2, '#ff4a3a', t, 2);
  },
  assembler(c, x, y, s, z, t) {
    pad(c, x, y, s, z); box(c, x + 0.2, y + 0.3, 1.6, 1.4, z, 14, '#c8bba8');
    const g1 = P(x + 0.3, y + 0.3, z + 14), g2 = P(x + 1.7, y + 0.3, z + 14); c.strokeStyle = ORANGE; c.lineWidth = 2; c.beginPath(); c.moveTo(g1[0], g1[1] - 10); c.lineTo(g2[0], g2[1] - 10); c.stroke();
    const k = (Math.sin(t) + 1) / 2, arm = P(x + 0.3 + k * 1.4, y + 0.3, z + 24); c.fillStyle = '#ffd36a'; c.fillRect(arm[0] - 2, arm[1], 4, 6);
  },
  heater(c, x, y, s, z, t) { cyl(c, x + 0.5, y + 0.5, 0.38, z, 14, '#8a7d70', '#ff8a3a'); const p = P(x + 0.5, y + 0.5, z + 14); c.fillStyle = 'rgba(255,140,60,' + (0.35 + 0.2 * Math.sin(t * 2)) + ')'; c.beginPath(); c.ellipse(p[0], p[1], 10, 5, 0, 0, 7); c.fill(); },
  brush(c, x, y, s, z, t) { const top = pole(c, x + 0.5, y + 0.5, z, 40, '#9a8d80', 3); for (let k = 0; k < 4; k++) { c.strokeStyle = 'rgba(140,200,255,' + (0.4 + 0.4 * Math.sin(t * 5 + k)) + ')'; c.lineWidth = 1; c.beginPath(); c.ellipse(top[0], top[1] + 8 + k * 7, 7, 3, 0, 0, 7); c.stroke(); } },
  lance(c, x, y, s, z, t) { cyl(c, x + 0.5, y + 0.5, 0.4, z, 8, '#6f6660'); const p = P(x + 0.5, y + 0.5, z + 14); box(c, x + 0.3, y + 0.3, 0.4, 0.4, z + 8, 7, '#a59a8e'); c.strokeStyle = '#d6cbbd'; c.lineWidth = 3; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + 10 * Math.cos(t * 0.3), p[1] - 14); c.stroke(); light(c, p[0], p[1] - 2, '#ff3a3a', t, 1.6); },
  spire(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#6a5d52');
    box(c, x + 0.5, y + 0.5, 3, 3, z, 10, '#c9b9a2');
    const cx = x + 2, cy = y + 2;
    for (let k = 0; k < 5; k++) { const r = 1.1 - k * 0.18; box(c, cx - r, cy - r, r * 2, r * 2, z + 10 + k * 22, 22, k % 2 ? '#e2d4bf' : '#b8a58a'); }
    const tp = P(cx, cy, z + 122); const g = c.createRadialGradient(tp[0], tp[1], 1, tp[0], tp[1], 22); g.addColorStop(0, 'rgba(255,230,150,.95)'); g.addColorStop(1, 'rgba(255,170,60,0)');
    c.fillStyle = g; c.beginPath(); c.arc(tp[0], tp[1], 22 + 3 * Math.sin(t * 2), 0, 7); c.fill();
  },
  solar(c, x, y, s, z, t, b, g) {
    const tilt = g ? g.sunTilt : 0.5;
    for (const [a, d] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const bx = x + a + 0.12, by = y + d + 0.12, w = 0.76;
      pole(c, bx + w / 2, by + w / 2, z, 6, '#7a6f66', 1.5);
      const h0 = 6 + tilt * 5, h1 = 6 - tilt * 2;
      const pts = [P(bx, by, z + h0), P(bx + w, by, z + h0), P(bx + w, by + w, z + h1), P(bx, by + w, z + h1)];
      poly(c, pts, '#24395a', '#8aa0b8', 0.6);
      c.strokeStyle = 'rgba(140,180,230,.35)'; c.lineWidth = 0.5; const m1 = P(bx + w / 2, by, z + h0), m2 = P(bx + w / 2, by + w, z + h1); c.beginPath(); c.moveTo(m1[0], m1[1]); c.lineTo(m2[0], m2[1]); c.stroke();
      const sh = P(bx + 0.2, by + 0.1, z + h0); c.fillStyle = 'rgba(200,230,255,.18)'; c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(sh[0] + 8, sh[1] + 2); c.lineTo(sh[0] + 2, sh[1] + 6); c.fill();
    }
  },
  wind(c, x, y, s, z, t, b, g) {
    const top = pole(c, x + 0.5, y + 0.5, z, 46, '#d6cbbd', 2.5);
    const a = (g ? g.windAngle : t * 3) + (b ? b.id : 0);
    c.strokeStyle = '#ece3d6'; c.lineWidth = 2.2;
    for (let k = 0; k < 3; k++) { const ang = a + k * 2.094; c.beginPath(); c.moveTo(top[0], top[1]); c.lineTo(top[0] + Math.cos(ang) * 16, top[1] + Math.sin(ang) * 16 * 0.9); c.stroke(); }
    c.fillStyle = '#9a8d80'; c.beginPath(); c.arc(top[0], top[1], 2.5, 0, 7); c.fill();
  },
  fuelgen(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z); box(c, x + 0.2, y + 0.3, 1.5, 1.3, z, 12, '#a99a86');
    const st = cyl(c, x + 1.5, y + 0.5, 0.2, z + 12, 14, '#6b625b');
    if (b && b._out > 0) for (let k = 0; k < 3; k++) { const ph = (t * 0.6 + k / 3) % 1; c.fillStyle = 'rgba(120,110,100,' + (0.4 * (1 - ph)) + ')'; c.beginPath(); c.arc(st[0] + ph * 8, st[1] - ph * 18, 3 + ph * 5, 0, 7); c.fill(); }
    cyl(c, x + 0.6, y + 1.4, 0.3, z, 9, ORANGE);
  },
  battery(c, x, y, s, z, t, b) {
    box(c, x + 0.15, y + 0.15, 0.7, 0.7, z, 12, '#5f6a70');
    const f = b && b._cap ? b.charge / b._cap : (b && b.charge ? 0.5 : 0);
    const p1 = P(x + 0.85, y + 0.25, z + 2), p2 = P(x + 0.85, y + 0.75, z + 2);
    c.fillStyle = '#1a1d20'; c.fillRect(Math.min(p1[0], p2[0]) + 1, p2[1] - 8, 6, 8);
    c.fillStyle = f > 0.3 ? '#7dff8a' : '#ffb34a'; c.fillRect(Math.min(p1[0], p2[0]) + 2, p2[1] - 1 - 6 * f, 4, 6 * f);
  },
  thinfilm(c, x, y, s, z, t) {
    for (let r = 0; r < 3; r++) { const pts = [P(x + 0.1, y + r + 0.15, z + 4), P(x + 2.9, y + r + 0.15, z + 4), P(x + 2.9, y + r + 0.85, z + 1), P(x + 0.1, y + r + 0.85, z + 1)]; poly(c, pts, '#1f2c4a', '#6a7fa8', 0.6); }
  },
  reactor(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#5a524c'); box(c, x + 0.2, y + 1.6, 2.6, 1.2, z, 12, '#b5a690');
    const top = cyl(c, x + 1.2, y + 1, 0.85, z, 34, '#d8cdbd', '#c2b6a6');
    c.fillStyle = 'rgba(120,220,255,' + (0.5 + 0.3 * Math.sin(t * 2)) + ')'; c.beginPath(); c.ellipse(top[0], top[1], 30, 15, 0, 0, 7); c.fill();
    c.fillStyle = 'rgba(230,230,230,.35)'; for (let k = 0; k < 3; k++) { const ph = (t * 0.3 + k / 3) % 1; c.beginPath(); c.arc(top[0] + ph * 10, top[1] - ph * 30, 8 + ph * 10, 0, 7); c.fill(); }
  },
  cell(c, x, y, s, z, t) {
    pad(c, x, y, s, z);
    const p = P(x + 1, y + 1, z); const h = 34;
    c.fillStyle = 'rgba(255,110,210,.85)'; c.beginPath(); c.moveTo(p[0], p[1] - h); c.lineTo(p[0] + 12, p[1] - 10); c.lineTo(p[0], p[1]); c.lineTo(p[0] - 12, p[1] - 10); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,200,240,.6)'; c.beginPath(); c.moveTo(p[0], p[1] - h); c.lineTo(p[0] - 12, p[1] - 10); c.lineTo(p[0], p[1] - 6); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,120,220,' + (0.2 + 0.15 * Math.sin(t * 3)) + ')'; c.beginPath(); c.arc(p[0], p[1] - 16, 22, 0, 7); c.fill();
  },
  icedrill(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z); cyl(c, x + 1.4, y + 1.3, 0.45, z, 12, '#9fd0e8', '#c8ecff');
    const b0 = P(x + 0.7, y + 0.7, z); c.strokeStyle = '#c0b2a0'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(b0[0] - 8, b0[1]); c.lineTo(b0[0], b0[1] - 36); c.lineTo(b0[0] + 8, b0[1]); c.stroke();
    c.beginPath(); c.moveTo(b0[0] - 5, b0[1] - 12); c.lineTo(b0[0] + 5, b0[1] - 12); c.moveTo(b0[0] - 3, b0[1] - 24); c.lineTo(b0[0] + 3, b0[1] - 24); c.stroke();
    const k = b && b._out > 0 ? Math.sin(t * 6) * 3 : 0; c.fillStyle = ORANGE; c.fillRect(b0[0] - 2, b0[1] - 30 + k, 4, 10);
  },
  condenser(c, x, y, s, z, t) {
    pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 1.4, 1.4, z, 10, '#b9c6cc');
    for (let k = 0; k < 5; k++) { const p1 = P(x + 0.4 + k * 0.28, y + 0.3, z + 10), p2 = P(x + 0.4 + k * 0.28, y + 1.7, z + 10); c.strokeStyle = '#eef8ff'; c.lineWidth = 2; c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p1[0], p1[1] - 8); c.stroke(); }
  },
  airsynth(c, x, y, s, z, t) {
    pad(c, x, y, s, z); box(c, x + 0.2, y + 1.0, 1.6, 0.8, z, 8, '#c4b8a6');
    cyl(c, x + 0.6, y + 0.6, 0.38, z, 22, '#e6edf0'); cyl(c, x + 1.4, y + 0.6, 0.38, z, 18, '#e6edf0');
    const p = P(x + 1.0, y + 1.4, z + 8); c.fillStyle = 'rgba(190,240,255,' + (0.3 + 0.3 * Math.sin(t * 2)) + ')'; c.beginPath(); c.arc(p[0], p[1] - 4, 4, 0, 7); c.fill();
  },
  watertank(c, x, y, s, z, t, b) {
    const top = cyl(c, x + 1, y + 1, 0.8, z, 18, '#7ab0cc', '#a8d4ea');
    const f = b && b.water !== undefined ? b.water / 80 : 0; c.fillStyle = 'rgba(40,120,200,.7)'; c.beginPath(); c.ellipse(top[0], top[1], 30 * f, 15 * f, 0, 0, 7); c.fill();
  },
  airtank(c, x, y, s, z) { pole(c, x + 0.3, y + 0.5, z, 6, '#7a6f66', 1.5); pole(c, x + 0.7, y + 0.5, z, 6, '#7a6f66', 1.5); sphere(c, x + 0.5, y + 0.5, 0.42, z + 4, '#e8f2f6'); },
  reclaimer(c, x, y, s, z) { pad(c, x, y, s, z); box(c, x + 0.2, y + 0.2, 1.6, 1.0, z, 12, '#a9b8b0'); cyl(c, x + 0.6, y + 1.4, 0.35, z, 10, '#78a8b8'); cyl(c, x + 1.4, y + 1.4, 0.35, z, 10, '#78a8b8'); },
  algae(c, x, y, s, z, t) { pad(c, x, y, s, z); for (let k = 0; k < 4; k++) { const tp = cyl(c, x + 0.4 + (k % 2) * 1.1, y + 0.5 + (k >> 1) * 1.0, 0.3, z, 18, '#5fbf6a', '#9cf09c'); c.fillStyle = 'rgba(160,255,140,' + (0.2 + 0.15 * Math.sin(t + k)) + ')'; c.beginPath(); c.arc(tp[0], tp[1] + 8, 4, 0, 7); c.fill(); } },
  sinterer(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z, '#6a5a4c'); box(c, x + 0.2, y + 0.2, 1.1, 1.3, z, 14, '#a8784e');
    const m = P(x + 0.75, y + 1.5, z + 6); c.fillStyle = b && b._out > 0 ? 'rgba(255,150,60,' + (0.7 + 0.3 * Math.sin(t * 4)) + ')' : '#3a2a20'; c.fillRect(m[0] - 4, m[1] - 4, 8, 5);
    box(c, x + 1.35, y + 0.3, 0.5, 1.5, z, 3, '#5e544c'); for (let k = 0; k < 3; k++) box(c, x + 1.45, y + 0.4 + k * 0.45, 0.3, 0.3, z + 3, 4, '#c9a27a');
  },
  oremine(c, x, y, s, z, t, b, g, col) {
    pad(c, x, y, s, z, '#5e544c');
    const b0 = P(x + 0.8, y + 0.8, z); c.strokeStyle = '#a89a8a'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(b0[0] - 12, b0[1]); c.lineTo(b0[0] - 2, b0[1] - 40); c.lineTo(b0[0] + 10, b0[1]); c.stroke(); c.beginPath(); c.moveTo(b0[0] - 2, b0[1] - 40); c.lineTo(b0[0] + 18, b0[1] - 18); c.stroke();
    const wh = [b0[0] - 2, b0[1] - 40]; c.strokeStyle = '#e8ddd0'; c.lineWidth = 1.2; c.beginPath(); c.arc(wh[0], wh[1], 5, 0, 7); c.stroke();
    const sp = b && b._out > 0 ? t * 4 : 0; c.beginPath(); c.moveTo(wh[0] + Math.cos(sp) * 5, wh[1] + Math.sin(sp) * 5); c.lineTo(wh[0] - Math.cos(sp) * 5, wh[1] - Math.sin(sp) * 5); c.stroke();
    box(c, x + 1.1, y + 0.2, 0.7, 0.7, z, 9, '#b0a08c');
    const pile = P(x + 1.4, y + 1.4, z); c.fillStyle = col || '#9aa4ad'; c.beginPath(); c.moveTo(pile[0] - 14, pile[1]); c.quadraticCurveTo(pile[0], pile[1] - 16, pile[0] + 14, pile[1]); c.closePath(); c.fill();
  },
  raremine(c, x, y, s, z, t, b, g) { ART.oremine(c, x, y, s, z, t, b, g, '#cdb6ff'); },
  automine(c, x, y, s, z, t, b, g) { ART.oremine(c, x, y, s, z, t, b, g, '#9fb0bb'); const p = P(x + 0.4, y + 1.5, z + 10); light(c, p[0], p[1], '#4fe0ff', t, 2); },
  harvester(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 1.4, 1.4, z, 10, '#8a7f9a'); const p = P(x + 1, y + 1, z + 10); c.fillStyle = 'rgba(255,110,210,.85)'; c.beginPath(); c.moveTo(p[0], p[1] - 22); c.lineTo(p[0] + 6, p[1] - 4); c.lineTo(p[0] - 6, p[1] - 4); c.fill(); light(c, p[0], p[1] - 24, '#ff8ae0', t, 2); },
  works(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z, '#5a524c'); box(c, x + 0.2, y + 0.3, 2.6, 2.4, z, 16, '#c6b49c');
    for (let k = 0; k < 4; k++) { const a = P(x + 0.3 + k * 0.62, y + 0.3, z + 16), bb = P(x + 0.3 + k * 0.62, y + 2.7, z + 16); c.fillStyle = k % 2 ? '#8a7a68' : '#a3937f'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[0] + 9, a[1] - 9); c.lineTo(bb[0] + 9, bb[1] - 9); c.lineTo(bb[0], bb[1]); c.closePath(); c.fill(); }
    const st = cyl(c, x + 2.4, y + 0.6, 0.18, z + 16, 18, '#6b625b');
    if (b && b._act > 0) { const ph = (t * 0.5) % 1; c.fillStyle = 'rgba(140,130,120,' + 0.4 * (1 - ph) + ')'; c.beginPath(); c.arc(st[0] + ph * 6, st[1] - ph * 16, 3 + ph * 6, 0, 7); c.fill(); }
    const d = P(x + 1.5, y + 2.7, z + 6); c.fillStyle = b && b._act > 0 ? '#ffcc66' : '#3a3028'; c.fillRect(d[0] - 6, d[1] - 6, 12, 6);
  },
  refinery(c, x, y, s, z, t) { pad(c, x, y, s, z); cyl(c, x + 0.5, y + 0.6, 0.3, z, 30, '#c8bcae'); cyl(c, x + 1.3, y + 0.5, 0.3, z, 22, '#c8bcae'); box(c, x + 0.3, y + 1.1, 1.4, 0.7, z, 8, ORANGE); const f = P(x + 0.5, y + 0.6, z + 34); c.fillStyle = 'rgba(255,170,60,' + (0.6 + 0.3 * Math.sin(t * 8)) + ')'; c.beginPath(); c.arc(f[0], f[1], 3, 0, 7); c.fill(); },
  polymer(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.2, y + 1.4, 2.6, 1.3, z, 12, '#b8c2b0'); for (let k = 0; k < 3; k++) cyl(c, x + 0.6 + k * 0.9, y + 0.7, 0.38, z, 20, TEAL, '#8fe0d8'); cyl(c, x + 2.6, y + 2.4, 0.15, z + 12, 16, '#6b625b'); },
  foundry(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 2.4, 2.4, z, 14, '#d8dee2'); for (let k = 0; k < 4; k++) { const p = P(x + 0.6 + k * 0.6, y + 2.7, z + 8); c.fillStyle = 'rgba(120,170,255,' + (0.6 + 0.4 * Math.sin(t * 2 + k)) + ')'; c.fillRect(p[0] - 3, p[1] - 2, 6, 3); } box(c, x + 1, y + 1, 1, 1, z + 14, 6, '#aeb6bc'); },
  greenhouse(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#6a5d52');
    for (let r = 0; r < 3; r++) { const a = P(x + 0.15, y + r + 0.5, z), bb = P(x + 2.85, y + r + 0.5, z); c.fillStyle = 'rgba(110,190,90,.9)'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(bb[0], bb[1]); c.lineTo(bb[0], bb[1] - 4); c.lineTo(a[0], a[1] - 4); c.fill(); }
    for (let r = 0; r < 3; r++) { const a = P(x + 0.1, y + r + 0.5, z), bb = P(x + 2.9, y + r + 0.5, z); const g = c.createLinearGradient(0, a[1] - 18, 0, a[1]); g.addColorStop(0, 'rgba(220,250,255,.55)'); g.addColorStop(1, 'rgba(140,210,230,.25)');
      c.fillStyle = g; c.beginPath(); c.moveTo(a[0] - 10, a[1] + 5); c.quadraticCurveTo(a[0], a[1] - 22, a[0] + 10, a[1] - 5); c.lineTo(bb[0] + 10, bb[1] - 5); c.quadraticCurveTo(bb[0], bb[1] - 22, bb[0] - 10, bb[1] + 5); c.closePath(); c.fill(); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 0.6; c.stroke(); }
  },
  bloomfarm(c, x, y, s, z, t) { pad(c, x, y, s, z, '#5e5048'); for (let k = 0; k < 9; k++) { const p = P(x + 0.35 + (k % 3) * 0.65, y + 0.35 + ((k / 3) | 0) * 0.65, z); c.fillStyle = 'rgba(220,240,180,.9)'; c.beginPath(); c.arc(p[0], p[1] - 4 - Math.sin(t + k) * 1.2, 4, 0, 7); c.fill(); } },
  lab(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.2, y + 0.3, 1.6, 1.4, z, 14, '#d9d2c6'); const p = P(x + 1, y + 1, z + 14); c.fillStyle = '#c0d6e4'; c.beginPath(); c.ellipse(p[0], p[1], 18, 9, 0, Math.PI, 0); c.fill(); c.beginPath(); c.arc(p[0], p[1] - 4, 12, Math.PI, 0); c.fill(); light(c, p[0] + 14, p[1] - 6, '#b48cff', t, 2); },
  observatory(c, x, y, s, z, t) { pad(c, x, y, s, z); cyl(c, x + 1, y + 1, 0.8, z, 14, '#d8cfc2'); const p = P(x + 1, y + 1, z + 14); c.fillStyle = '#e8e2d8'; c.beginPath(); c.arc(p[0], p[1], 32, Math.PI, 0); c.fill(); c.fillStyle = '#20242a'; c.save(); c.translate(p[0], p[1] - 16); c.rotate(Math.sin(t * 0.2) * 0.5); c.fillRect(-3, -18, 6, 18); c.restore(); },
  institute(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 2.4, 2.4, z, 12, '#d6cdbd'); box(c, x + 0.8, y + 0.8, 1.4, 1.4, z + 12, 26, '#e8e1d4'); const p = P(x + 1.5, y + 1.5, z + 44); c.strokeStyle = 'rgba(180,140,255,.8)'; c.lineWidth = 1.5; for (let k = 0; k < 2; k++) { c.beginPath(); c.ellipse(p[0], p[1], 20 + k * 6, 6 + k * 2, Math.sin(t * 0.5 + k) * 0.3, 0, 7); c.stroke(); } },
};
// domes: glass hemisphere with modules and gardens visible inside at close zoom
function drawDome(c, b, x, y, s, z, t, g) {
  const cx = x + s / 2, cy = y + s / 2, p = P(cx, cy, z), rx = s * TW * 0.47, ry = s * TH * 0.47, h = s * 13;
  // ring foundation
  c.fillStyle = '#7a6a5c'; c.beginPath(); c.ellipse(p[0], p[1], rx + 4, ry + 2, 0, 0, 7); c.fill();
  c.fillStyle = '#a89580'; c.beginPath(); c.ellipse(p[0], p[1] - 2, rx + 1, ry, 0, 0, 7); c.fill();
  c.fillStyle = '#6f8a5a'; c.beginPath(); c.ellipse(p[0], p[1] - 3, rx - 2, ry - 1, 0, 0, 7); c.fill();
  if (g && g.zoom > 0.75 && g.mods) {
    // interior: module blocks arranged in a ring, little trees, colonists
    const mods = g.mods, n = Math.max(mods.length, 1);
    for (let i = 0; i < mods.length; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2, mx = cx + Math.cos(a) * s * 0.28, my = cy + Math.sin(a) * s * 0.28, m = mods[i];
      const col = m.built ? (MOD_COL[m.t] || '#c9bba8') : '#6a5a4a';
      box(c, mx - 0.3, my - 0.3, 0.6, 0.6, z + 3, m.built ? 8 + (MODULES[m.t].housing ? 6 : 0) : 3, col);
    }
    for (let k = 0; k < Math.min(8, s * 2); k++) { const a = k * 2.4 + b.id, r = s * 0.12 * (1 + (k % 3) * 0.3), tp = P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z + 3); c.fillStyle = '#4f8a3a'; c.beginPath(); c.arc(tp[0], tp[1] - 6, 4, 0, 7); c.fill(); c.fillStyle = '#5a4030'; c.fillRect(tp[0] - 0.7, tp[1] - 3, 1.4, 3); }
    const pop = Math.min(14, g.pop || 0);
    for (let k = 0; k < pop; k++) { const a = t * 0.15 * (k % 2 ? 1 : -1) + k * 1.7, r = s * (0.15 + 0.06 * (k % 4)), cp = P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z + 3); c.fillStyle = ['#ffd27a', '#7fd0ff', '#ff9a8a', '#c0ff9a'][k % 4]; c.fillRect(cp[0] - 1, cp[1] - 4, 2, 4); }
  }
  // glass shell
  const lit = g ? g.domeGlow : 0;
  const gr = c.createRadialGradient(p[0] - rx * 0.35, p[1] - h * 0.9, 4, p[0], p[1] - h * 0.3, rx * 1.1);
  gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.35, 'rgba(170,220,240,' + (g && g.zoom > 0.75 ? 0.16 : 0.5) + ')'); gr.addColorStop(1, 'rgba(90,150,180,' + (g && g.zoom > 0.75 ? 0.32 : 0.65) + ')');
  c.fillStyle = gr; c.beginPath(); c.ellipse(p[0], p[1] - 3, rx, ry, 0, 0, Math.PI); c.bezierCurveTo(p[0] - rx, p[1] - h * 1.4, p[0] + rx, p[1] - h * 1.4, p[0] + rx, p[1] - 3); c.fill();
  if (lit > 0) { c.fillStyle = 'rgba(255,220,150,' + 0.18 * lit + ')'; c.fill(); }
  c.strokeStyle = 'rgba(230,245,255,.55)'; c.lineWidth = 1;
  for (let k = 1; k < 4; k++) { const f = k / 4; c.beginPath(); c.ellipse(p[0], p[1] - 3 - h * f * 0.95, rx * Math.sqrt(1 - f * f), ry * Math.sqrt(1 - f * f) * 0.6, 0, Math.PI, 0, true); c.stroke(); }
  c.beginPath(); c.moveTo(p[0], p[1] - 3 - h * 1.04); c.quadraticCurveTo(p[0] - rx * 0.6, p[1] - h * 0.6, p[0] - rx * 0.55, p[1] + ry * 0.83); c.moveTo(p[0], p[1] - 3 - h * 1.04); c.quadraticCurveTo(p[0] + rx * 0.6, p[1] - h * 0.6, p[0] + rx * 0.55, p[1] + ry * 0.83); c.stroke();
  if (b.broken || b.wear >= 100) { c.strokeStyle = 'rgba(255,90,70,.8)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(p[0] - rx * 0.2, p[1] - h * 0.8); c.lineTo(p[0] - rx * 0.05, p[1] - h * 0.55); c.lineTo(p[0] - rx * 0.25, p[1] - h * 0.4); c.stroke(); }
}
const MOD_COL = { quarters: '#d8c4a8', apartments: '#cbb79c', suites: '#e6d6bd', nursery: '#f0c8c0', canteen: '#e8a560', lounge: '#b48cff', gym: '#7fb4ff', arboretum: '#6fbf5a', market: '#e8c25a', arcade: '#ff7ad9', clinic: '#ff8a8a', medcenter: '#ff9a9a', school: '#ffd27a', security: '#7fa0c0', spa: '#7fd0d0', hydro: '#7fdc6a', vfarm: '#6fcc5a', labmod: '#c0a8ff', workshop: '#c8a070' };
// construction scaffolding, drawn over a translucent outline
function drawSite(c, b, x, y, s, z, t, frac) {
  const top = [P(x, y, z), P(x + s, y, z), P(x + s, y + s, z), P(x, y + s, z)];
  poly(c, top, 'rgba(240,170,80,.12)', 'rgba(255,190,110,.8)', 1.2);
  const h = 8 + s * 6, k = Math.max(0.05, frac);
  c.strokeStyle = 'rgba(230,200,150,.8)'; c.lineWidth = 1;
  for (const [a, d] of [[0, 0], [s, 0], [s, s], [0, s]]) { const p0 = P(x + a, y + d, z); c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p0[0], p0[1] - h * k); c.stroke(); }
  box(c, x + s * 0.2, y + s * 0.2, s * 0.6, s * 0.6, z, h * k * 0.8, '#b8a58a', { edge: false });
  const cr = P(x + s, y, z); c.strokeStyle = '#ffb34a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(cr[0], cr[1]); c.lineTo(cr[0], cr[1] - h - 14); c.lineTo(cr[0] - 22, cr[1] - h - 10); c.stroke();
}
function drawVehicle(c, v, wx, wy, z, t, sel) {
  const p = P(wx + 0.5, wy + 0.5, z);
  c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(p[0], p[1], 14, 6, 0, 0, 7); c.fill();
  if (v.t === 'crawler') {
    box(c, wx + 0.1, wy + 0.2, 0.8, 0.6, z, 4, '#3a3532');
    box(c, wx + 0.15, wy + 0.25, 0.7, 0.5, z + 4, 7, '#e2b25a');
    const tp = P(wx + 0.5, wy + 0.5, z + 11); c.fillStyle = '#4fe0ff'; c.fillRect(tp[0] - 4, tp[1] - 2, 8, 2);
  } else {
    box(c, wx + 0.2, wy + 0.3, 0.6, 0.4, z + 2, 6, '#e6e0d6');
    for (const [a, d] of [[0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) { const w = P(wx + a, wy + d, z + 2); c.fillStyle = '#2a2622'; c.beginPath(); c.arc(w[0], w[1], 2.4, 0, 7); c.fill(); }
    const m = P(wx + 0.4, wy + 0.45, z + 8); c.strokeStyle = '#b8aa98'; c.lineWidth = 1; c.beginPath(); c.moveTo(m[0], m[1]); c.lineTo(m[0], m[1] - 10); c.stroke(); light(c, m[0], m[1] - 10, '#7dff8a', t, 1.8);
  }
  if (sel) { c.strokeStyle = '#ffd36a'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(p[0], p[1], 18, 9, 0, 0, 7); c.stroke(); }
}
function drawRocket(c, x, y, z, lift, t, flame) {
  const p = P(x, y, z + lift);
  const g = c.createLinearGradient(p[0] - 9, 0, p[0] + 9, 0); g.addColorStop(0, '#f2ece3'); g.addColorStop(0.5, '#fffaf2'); g.addColorStop(1, '#9a9088');
  if (flame) { const fl = c.createLinearGradient(0, p[1], 0, p[1] + 40); fl.addColorStop(0, 'rgba(255,240,180,.95)'); fl.addColorStop(0.4, 'rgba(255,150,60,.8)'); fl.addColorStop(1, 'rgba(255,90,30,0)'); c.fillStyle = fl; c.beginPath(); c.moveTo(p[0] - 7, p[1]); c.lineTo(p[0], p[1] + 30 + Math.random() * 14); c.lineTo(p[0] + 7, p[1]); c.fill(); }
  c.fillStyle = g; c.beginPath(); c.moveTo(p[0] - 9, p[1]); c.lineTo(p[0] - 9, p[1] - 50); c.quadraticCurveTo(p[0], p[1] - 80, p[0] + 9, p[1] - 50); c.lineTo(p[0] + 9, p[1]); c.closePath(); c.fill();
  c.fillStyle = ORANGE; c.fillRect(p[0] - 9, p[1] - 34, 18, 5);
  c.fillStyle = '#6a625b'; c.beginPath(); c.moveTo(p[0] - 9, p[1] - 10); c.lineTo(p[0] - 16, p[1] + 2); c.lineTo(p[0] - 9, p[1]); c.fill(); c.beginPath(); c.moveTo(p[0] + 9, p[1] - 10); c.lineTo(p[0] + 16, p[1] + 2); c.lineTo(p[0] + 9, p[1]); c.fill();
  c.fillStyle = '#2a3a4a'; c.beginPath(); c.arc(p[0], p[1] - 44, 3, 0, 7); c.fill();
}
// small icon of any building for menus (drawn into its own canvas)
function iconCanvas(type, px) {
  const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = px * dpr; cv.height = px * dpr; cv.style.width = px + 'px'; cv.style.height = px + 'px';
  const c = cv.getContext('2d'), d = BUILDINGS[type] || { size: 1 };
  const s = d.size || 1, sc = px / (s * TW * 1.1 + 10) * dpr;
  c.scale(sc, sc); c.translate(s * TW * 0.55 + 5, (px * dpr / sc) * 0.72 - s * TH * 0.5);
  try {
    if (d.dome) drawDome(c, { id: 1, wear: 0 }, 0, 0, s, 0, 1, null);
    else if (ART[type]) ART[type](c, 0, 0, s, 0, 1, null, null);
    else if (MODULES[type]) box(c, 0.1, 0.1, 0.8, 0.8, 0, 14, MOD_COL[type] || '#c9bba8');
    else if (type === 'cable' || type === 'pipe') { c.strokeStyle = type === 'cable' ? '#ffd84a' : '#9fe4ff'; c.lineWidth = 5; c.beginPath(); c.moveTo(-20, 0); c.lineTo(20, 16); c.stroke(); }
  } catch (e) { /* icon only */ }
  return cv;
}
