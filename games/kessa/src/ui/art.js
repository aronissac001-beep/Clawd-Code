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
// level of detail and night, set by the renderer each frame: detail grows with zoom, windows light up at night
const ARTV = { lod: 1, night: 0, t: 0, emit: null };
// one light from the upper left for everything: lit tops, mid left faces, dark right faces, bright front edges
function box(ctx, x, y, w, d, z, h, col, opt = {}) {
  const top = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  const fr = P(x + w, y + d, z), bl = P(x, y + d, z), br = P(x + w, y, z);
  poly(ctx, [br, fr, top[2], top[1]], opt.right || shade(col, -0.34));
  poly(ctx, [bl, fr, top[2], top[3]], opt.left || shade(col, -0.14));
  poly(ctx, top, opt.top || shade(col, 0.14), opt.edge === false ? null : 'rgba(0,0,0,.25)', 0.6);
  if (ARTV.lod > 0.85 && opt.edge !== false && h > 2) {
    ctx.strokeStyle = 'rgba(255,248,236,.32)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(top[3][0], top[3][1]); ctx.lineTo(top[2][0], top[2][1]); ctx.lineTo(top[1][0], top[1][1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.moveTo(fr[0], fr[1]); ctx.lineTo(top[2][0], top[2][1]); ctx.stroke();
  }
  if (ARTV.lod > 1.15 && opt.seams) {
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 0.6; ctx.beginPath();
    for (let k = 1; k <= opt.seams; k++) { const f = k / (opt.seams + 1), a = P(x + w * f, y + d, z), b2 = P(x + w, y + d * f, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0], a[1] - h); ctx.moveTo(b2[0], b2[1]); ctx.lineTo(b2[0], b2[1] - h); }
    ctx.stroke();
  }
  if (opt.win && ARTV.lod > 0.75) windows(ctx, x, y, w, d, z, h, opt.win);
  if (opt.band) { const a = P(x, y + d, z + h * opt.band[0]), b2 = P(x + w, y + d, z + h * opt.band[0]), c2 = P(x + w, y, z + h * opt.band[0]); ctx.strokeStyle = opt.band[1]; ctx.lineWidth = opt.band[2] || 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke(); }
  return top;
}
// a row of windows on both visible faces; they glow at night
function windows(ctx, x, y, w, d, z, h, o) {
  const n = o.n || 3, hy = z + h * (o.at || 0.55), wh = o.h || 3, lit = ARTV.night > 0.3;
  ctx.fillStyle = lit ? 'rgba(255,214,140,.95)' : 'rgba(40,58,72,.85)';
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n, a = P(x + w * f - 0.06, y + d, hy), b2 = P(x + w * f + 0.06, y + d, hy); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(b2[0], b2[1] - wh); ctx.lineTo(a[0], a[1] - wh); ctx.fill();
    if (lit && ARTV.emit) ARTV.emit.push([a[0], a[1] - wh, b2[0] - a[0], wh, b2[1] - a[1]]);
    if (o.both !== false) { const c1 = P(x + w, y + d * f - 0.06, hy), c2 = P(x + w, y + d * f + 0.06, hy); ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c2[0], c2[1] - wh); ctx.lineTo(c1[0], c1[1] - wh); ctx.fill(); if (lit && ARTV.emit) ARTV.emit.push([c1[0], c1[1] - wh, c2[0] - c1[0], wh, c2[1] - c1[1]]); }
  }
}
// cylinder centred at tile point (cx, cy), radius r in tiles; bands are rings at fractions of the height
function cyl(ctx, cx, cy, r, z, h, col, topCol, bands) {
  const x = isoX(cx, cy), y0 = isoY(cx, cy, z), y1 = y0 - h, rx = r * TW * 0.707, ry = r * TH * 0.707;
  const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  g.addColorStop(0, shade(col, -0.08)); g.addColorStop(0.32, shade(col, 0.16)); g.addColorStop(0.7, shade(col, -0.12)); g.addColorStop(1, shade(col, -0.45));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y0, rx, ry, 0, 0, Math.PI); ctx.lineTo(x - rx, y1); ctx.ellipse(x, y1, rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
  if (bands && ARTV.lod > 0.9) { ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 0.8; for (const f of bands) { ctx.beginPath(); ctx.ellipse(x, y0 - h * f, rx, ry, 0, 0, Math.PI); ctx.stroke(); } }
  ctx.fillStyle = topCol || shade(col, 0.22); ctx.beginPath(); ctx.ellipse(x, y1, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.6; ctx.stroke();
  if (ARTV.lod > 0.85) { ctx.strokeStyle = 'rgba(255,250,240,.35)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.ellipse(x, y1, rx, ry, 0, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); }
  return [x, y1];
}
function sphere(ctx, cx, cy, r, z, col) {
  const x = isoX(cx, cy), y = isoY(cx, cy, z) - r * 22, rr = r * 24;
  const g = ctx.createRadialGradient(x - rr * 0.35, y - rr * 0.4, rr * 0.1, x, y, rr);
  g.addColorStop(0, shade(col, 0.5)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.55));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  if (ARTV.lod > 0.9) { ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.28, 0, 0, Math.PI); ctx.stroke(); }
  return [x, y - rr];
}
function pole(ctx, cx, cy, z, h, col, w) { const x = isoX(cx, cy), y = isoY(cx, cy, z); ctx.strokeStyle = col; ctx.lineWidth = w || 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke(); return [x, y - h]; }
// a blinking lamp with a small halo
function light(ctx, x, y, col, t, r) { const on = Math.sin(t * 3 + x * 0.1) > 0.2; if (!on) return; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r || 1.6, 0, Math.PI * 2); ctx.fill(); if (ARTV.lod > 0.9) { ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, (r || 1.6) * 2.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; } }
// rising steam or dust puffs from a vent
function steam(ctx, x, y, t, seed, col, amt) {
  if (ARTV.lod < 0.55) return;
  const c0 = col || '235,230,225';
  for (let k = 0; k < 3; k++) { const ph = (t * 0.32 + k / 3 + seed * 0.137) % 1, a = (amt || 1) * 0.38 * (1 - ph); ctx.fillStyle = 'rgba(' + c0 + ',' + a.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(x + Math.sin(ph * 3 + seed) * 4 + ph * 7, y - ph * 24, 2.2 + ph * 6.5, 0, Math.PI * 2); ctx.fill(); }
}
// concrete pad with a raised edge and hazard corners at close zoom
function pad(ctx, x, y, s, z, col) {
  const c0 = col || '#6f6259', q = [P(x + 0.08, y + 0.08, z), P(x + s - 0.08, y + 0.08, z), P(x + s - 0.08, y + s - 0.08, z), P(x + 0.08, y + s - 0.08, z)];
  poly(ctx, [P(x + 0.08, y + s - 0.08, z), P(x + s - 0.08, y + s - 0.08, z), P(x + s - 0.08, y + s - 0.08, z - 2), P(x + 0.08, y + s - 0.08, z - 2)], shade(c0, -0.35));
  poly(ctx, [P(x + s - 0.08, y + 0.08, z), P(x + s - 0.08, y + s - 0.08, z), P(x + s - 0.08, y + s - 0.08, z - 2), P(x + s - 0.08, y + 0.08, z - 2)], shade(c0, -0.5));
  poly(ctx, q, c0, 'rgba(0,0,0,.3)');
  if (ARTV.lod > 1.05) {
    const inn = [P(x + 0.2, y + 0.2, z), P(x + s - 0.2, y + 0.2, z), P(x + s - 0.2, y + s - 0.2, z), P(x + 0.2, y + s - 0.2, z)]; poly(ctx, inn, null, 'rgba(255,240,220,.1)', 0.7);
    ctx.strokeStyle = 'rgba(240,170,60,.75)'; ctx.lineWidth = 1.2; ctx.setLineDash([2.5, 2.5]); ctx.beginPath(); const e0 = P(x + 0.14, y + s - 0.14, z), e1 = P(x + 0.6, y + s - 0.14, z), e2 = P(x + s - 0.14, y + s - 0.6, z), e3 = P(x + s - 0.14, y + s - 0.14, z);
    ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.moveTo(e2[0], e2[1]); ctx.lineTo(e3[0], e3[1]); ctx.stroke(); ctx.setLineDash([]);
  }
}
// a turning fan seen from above, inside a ring
function fan(ctx, px, py, r, a) { ctx.fillStyle = '#2a2724'; ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); if (ARTV.lod < 0.8) return; ctx.strokeStyle = '#9a9088'; ctx.lineWidth = 1.4; ctx.beginPath(); for (let k = 0; k < 3; k++) { const b2 = a + k * 2.094; ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(b2) * r * 0.85, py + Math.sin(b2) * r * 0.42); } ctx.stroke(); }

const HULL = '#d9cbb8', HULL2 = '#b9a58e', DARK = '#4a4440', TEAL = '#4fb3b0', ORANGE = '#e88a3c', GLASS = '#8fd0e8';
// each draws a building occupying tiles (x, y)..(x+s, y+s) at ground height z
const ART = {
  lander(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#5d524b');
    for (const [a, b] of [[0.4, 0.4], [2.6, 0.4], [0.4, 2.6], [2.6, 2.6]]) { const p0 = P(x + a, y + b, z), p1 = P(x + 1.5 + (a - 1.5) * 0.45, y + 1.5 + (b - 1.5) * 0.45, z + 22); c.strokeStyle = '#7d7168'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); c.fillStyle = '#4a423c'; c.beginPath(); c.ellipse(p0[0], p0[1], 5, 2.5, 0, 0, 7); c.fill(); }
    cyl(c, x + 1.5, y + 1.5, 0.98, z + 12, 22, HULL, null, [0.3, 0.75]);
    if (ARTV.lod > 0.8) { const lit = ARTV.night > 0.3; for (let k = 0; k < 5; k++) { const a = Math.PI * (0.12 + k * 0.19), w = P(x + 1.5 + Math.cos(a) * 0.98, y + 1.5 + Math.sin(a) * 0.98, z + 24); c.fillStyle = lit ? 'rgba(255,214,140,.95)' : '#33495a'; c.fillRect(w[0] - 2.5, w[1] - 3, 5, 3.2); } }
    cyl(c, x + 1.5, y + 1.5, 0.62, z + 34, 13, HULL2, '#e9dccb', [0.5]);
    const tp = cyl(c, x + 1.5, y + 1.5, 0.24, z + 47, 9, ORANGE);
    if (ARTV.lod > 0.9) { c.strokeStyle = '#b8ab9c'; c.lineWidth = 1; c.beginPath(); c.moveTo(tp[0] + 6, tp[1]); c.lineTo(tp[0] + 10, tp[1] - 12); c.stroke(); c.fillStyle = '#e8ddd0'; c.beginPath(); c.ellipse(tp[0] + 10, tp[1] - 13, 4 + Math.cos(t * 0.5), 2, 0.4, 0, 7); c.fill(); }
    light(c, tp[0], tp[1] - 2, '#ff5a3a', t, 2.2);
    const hatch = P(x + 1.9, y + 2.45, z + 12); c.fillStyle = '#3a3430'; c.fillRect(hatch[0] - 4, hatch[1] - 9, 8, 9); c.fillStyle = 'rgba(255,200,120,.7)'; c.fillRect(hatch[0] - 3, hatch[1] - 8, 6, 1.2);
  },
  hub(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#5a524c');
    box(c, x + 0.25, y + 0.25, 1.5, 1.5, z, 8, '#cfc2ae', { seams: 2, band: [0.55, 'rgba(232,138,60,.8)', 1.6] });
    for (const [a, b] of [[0.6, 0.6], [1.4, 0.6], [0.6, 1.4], [1.4, 1.4]]) { const p = P(x + a, y + b, z + 8.4); c.fillStyle = '#2b2622'; c.beginPath(); c.ellipse(p[0], p[1], 7, 3.5, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(79,224,255,' + (0.5 + 0.4 * Math.sin(t * 2 + a * 3 + b)) + ')'; c.lineWidth = 0.9; c.stroke(); }
    const top = cyl(c, x + 1, y + 1, 0.3, z + 8, 14, '#bfb2a0', null, [0.5]);
    pole(c, x + 1, y + 1, z + 22, 14, '#8c8079', 1.5);
    const d = P(x + 1, y + 1, z + 34); c.save(); c.translate(d[0], d[1]); c.rotate(Math.sin(t * 0.4) * 0.6); c.fillStyle = '#e6ddd0'; c.beginPath(); c.ellipse(0, 0, 7, 3, 0, 0, 7); c.fill(); c.strokeStyle = '#8a7d70'; c.lineWidth = 0.8; c.stroke(); c.restore();
    light(c, top[0], top[1] - 15, '#4fe0ff', t, 2);
  },
  depot(c, x, y, s, z) {
    pad(c, x, y, s, z);
    const crate = (a, b, h, col, hh) => { const tp = box(c, x + a, y + b, 0.78, 0.78, z + (hh || 0), h, col, { seams: 1 }); if (ARTV.lod > 1) { const m1 = P(x + a + 0.39, y + b + 0.78, z + (hh || 0)), m2 = P(x + a + 0.78, y + b + 0.39, z + (hh || 0)); c.strokeStyle = 'rgba(30,22,16,.45)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(m1[0], m1[1]); c.lineTo(m1[0], m1[1] - h); c.moveTo(m2[0], m2[1]); c.lineTo(m2[0], m2[1] - h); c.stroke(); } return tp; };
    crate(0.2, 0.2, 9, '#c58b4e'); crate(1.02, 0.2, 9, '#7d8f9a'); crate(0.2, 1.02, 9, '#8a9a6a'); crate(1.02, 1.02, 9, '#c9b18a'); crate(0.62, 0.62, 8, '#a57e5b', 9);
  },
  mast(c, x, y, s, z, t) {
    const b = P(x + 0.5, y + 0.5, z), h = 54;
    c.fillStyle = '#4a423c'; c.beginPath(); c.ellipse(b[0], b[1], 8, 4, 0, 0, 7); c.fill();
    c.strokeStyle = '#b8aa98'; c.lineWidth = 1.3;
    for (const dx of [-6, 6]) { c.beginPath(); c.moveTo(b[0] + dx, b[1]); c.lineTo(b[0], b[1] - h); c.stroke(); }
    c.lineWidth = 0.9; c.beginPath(); for (let k = 1; k < 6; k++) { const yy = b[1] - k * h / 6, w = 6 * (1 - k / 6), w2 = 6 * (1 - (k + 1) / 6); c.moveTo(b[0] - w, yy); c.lineTo(b[0] + w, yy); if (ARTV.lod > 1) { c.moveTo(b[0] - w, yy); c.lineTo(b[0] + w2, yy - h / 6); } } c.stroke();
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
    const tilt = g ? g.sunTilt : 0.5, det = ARTV.lod > 1.05;
    for (const [a, d] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const bx = x + a + 0.1, by = y + d + 0.1, w = 0.8;
      pole(c, bx + w / 2, by + w / 2, z, 6, '#6e645c', 1.6);
      const h0 = 6 + tilt * 5, h1 = 6 - tilt * 2;
      const pts = [P(bx, by, z + h0), P(bx + w, by, z + h0), P(bx + w, by + w, z + h1), P(bx, by + w, z + h1)];
      poly(c, pts, '#1d3150', '#a8b6c6', 0.8);
      c.strokeStyle = 'rgba(150,190,240,.32)'; c.lineWidth = 0.5; c.beginPath();
      for (let k = 1; k < (det ? 4 : 2); k++) { const f = k / (det ? 4 : 2), m1 = P(bx + w * f, by, z + h0), m2 = P(bx + w * f, by + w, z + h1), n1 = P(bx, by + w * f, z + h0 + (h1 - h0) * f), n2 = P(bx + w, by + w * f, z + h0 + (h1 - h0) * f); c.moveTo(m1[0], m1[1]); c.lineTo(m2[0], m2[1]); if (det) { c.moveTo(n1[0], n1[1]); c.lineTo(n2[0], n2[1]); } }
      c.stroke();
      // a glint that slides across the cells with the sun
      const gl = (t * 0.08 + a * 0.3 + d * 0.5) % 1, sh = P(bx + w * gl, by + 0.1, z + h0); c.fillStyle = 'rgba(220,240,255,' + (0.22 * (1 - ARTV.night)) + ')'; c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(sh[0] + 7, sh[1] + 2); c.lineTo(sh[0] + 2, sh[1] + 7); c.fill();
    }
  },
  wind(c, x, y, s, z, t, b, g) {
    const base = P(x + 0.5, y + 0.5, z), H = 46, top = [base[0], base[1] - H];
    c.fillStyle = '#4a423c'; c.beginPath(); c.ellipse(base[0], base[1], 6, 3, 0, 0, 7); c.fill();
    const tg = c.createLinearGradient(base[0] - 3, 0, base[0] + 3, 0); tg.addColorStop(0, '#efe6da'); tg.addColorStop(1, '#a99c8e');
    c.fillStyle = tg; c.beginPath(); c.moveTo(base[0] - 2.6, base[1]); c.lineTo(top[0] - 1.2, top[1]); c.lineTo(top[0] + 1.2, top[1]); c.lineTo(base[0] + 2.6, base[1]); c.closePath(); c.fill();
    c.fillStyle = '#d9cfc2'; c.beginPath(); c.ellipse(top[0] + 2, top[1], 5, 2.6, 0, 0, 7); c.fill();
    const a = (g ? g.windAngle : t * 3) + (b ? b.id : 0), L = 17;
    for (let k = 0; k < 3; k++) {
      const ang = a + k * 2.094, ca = Math.cos(ang), sa = Math.sin(ang) * 0.92, nx = -sa, ny = ca;
      c.fillStyle = k ? '#ece3d6' : '#f4ece0'; c.beginPath(); c.moveTo(top[0] + nx * 1.8, top[1] + ny * 1.8); c.lineTo(top[0] + ca * L + nx * 0.6, top[1] + sa * L + ny * 0.6); c.lineTo(top[0] + ca * L - nx * 0.4, top[1] + sa * L - ny * 0.4); c.lineTo(top[0] - nx * 1.2, top[1] - ny * 1.2); c.closePath(); c.fill();
      if (ARTV.lod > 1.1) { c.strokeStyle = 'rgba(80,70,60,.35)'; c.lineWidth = 0.5; c.stroke(); }
    }
    c.fillStyle = '#9a8d80'; c.beginPath(); c.arc(top[0], top[1], 2.4, 0, 7); c.fill();
    if (ARTV.night > 0.3) light(c, top[0] + 4, top[1] - 2, '#ff4a3a', t + (b ? b.id : 0), 1.4);
  },
  fuelgen(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z); box(c, x + 0.2, y + 0.3, 1.5, 1.3, z, 12, '#a99a86', { seams: 2, band: [0.7, 'rgba(232,138,60,.7)', 1.4] });
    const st = cyl(c, x + 1.5, y + 0.5, 0.2, z + 12, 14, '#6b625b', null, [0.5]);
    if (b && b._out > 0) steam(c, st[0], st[1], t, x + y, '120,110,100', 1);
    cyl(c, x + 0.6, y + 1.4, 0.3, z, 9, ORANGE, null, [0.5]);
    if (ARTV.lod > 0.9) { const f = P(x + 1.1, y + 1.6, z + 6); fan(c, f[0] + 6, f[1] - 2, 5, b && b._out > 0 ? t * 9 : 0); }
  },
  battery(c, x, y, s, z, t, b) {
    box(c, x + 0.12, y + 0.12, 0.76, 0.76, z, 12, '#5f6a70', { seams: 2 });
    const f = b && b._cap ? b.charge / b._cap : (b && b.charge ? 0.5 : 0);
    const p1 = P(x + 0.88, y + 0.3, z + 2), p2 = P(x + 0.88, y + 0.7, z + 2);
    c.fillStyle = '#15181b'; c.fillRect(Math.min(p1[0], p2[0]) + 1, p2[1] - 9, 6, 9);
    c.fillStyle = f > 0.3 ? '#7dff8a' : f > 0.1 ? '#ffb34a' : '#ff5a4a'; c.fillRect(Math.min(p1[0], p2[0]) + 2, p2[1] - 1 - 7 * f, 4, 7 * f);
    if (ARTV.lod > 1) { const tp = P(x + 0.5, y + 0.5, z + 12); c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.8; c.beginPath(); for (let k = -1; k <= 1; k++) { c.moveTo(tp[0] - 8, tp[1] + k * 2.4); c.lineTo(tp[0] + 8, tp[1] + k * 2.4); } c.stroke(); }
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
    pad(c, x, y, s, z);
    const on = b && b._out > 0;
    cyl(c, x + 1.42, y + 1.32, 0.44, z, 13, '#9fd0e8', '#c8ecff', [0.35, 0.7]);
    box(c, x + 1.0, y + 0.25, 0.7, 0.55, z, 7, '#c4b8a6', { win: { n: 1, at: 0.5, h: 2.4, both: false } });
    const b0 = P(x + 0.7, y + 0.7, z), H = 38;
    c.strokeStyle = '#bfb19f'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(b0[0] - 9, b0[1]); c.lineTo(b0[0], b0[1] - H); c.lineTo(b0[0] + 9, b0[1]); c.stroke();
    c.lineWidth = 1; c.beginPath(); for (let k = 1; k < 4; k++) { const yy = b0[1] - k * H / 4, w = 9 * (1 - k / 4); c.moveTo(b0[0] - w, yy); c.lineTo(b0[0] + w, yy + (ARTV.lod > 1 ? 3 : 0)); } c.stroke();
    const k = on ? Math.sin(t * 6) * 3 : 0; c.fillStyle = ORANGE; c.fillRect(b0[0] - 2, b0[1] - 32 + k, 4, 11);
    if (ARTV.lod > 0.9) { c.strokeStyle = '#6b625b'; c.lineWidth = 2; c.beginPath(); c.moveTo(b0[0], b0[1] - 20 + k); c.lineTo(b0[0], b0[1] - 2); c.stroke(); }
    light(c, b0[0], b0[1] - H - 1, '#ff5a3a', t, 1.6);
    if (on) steam(c, b0[0] + 3, b0[1] - 4, t, x + y, '225,240,250', 0.8);
  },
  condenser(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 1.4, 1.4, z, 10, '#b9c6cc', { seams: 2 });
    c.strokeStyle = '#f2fbff'; c.lineWidth = 2;
    for (let k = 0; k < 5; k++) { const p1 = P(x + 0.42 + k * 0.28, y + 0.5, z + 10); c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p1[0], p1[1] - 9); c.stroke(); if (ARTV.lod > 1) { c.strokeStyle = 'rgba(140,190,210,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(p1[0] + 1, p1[1]); c.lineTo(p1[0] + 1, p1[1] - 9); c.stroke(); c.strokeStyle = '#f2fbff'; c.lineWidth = 2; } }
    const f = P(x + 1, y + 1.3, z + 10); fan(c, f[0] + 8, f[1] - 2, 7, t * 5);
    if (!b || b._out > 0) steam(c, f[0] - 6, f[1] - 10, t, x * 3 + y, '235,248,255', 0.6);
  },
  airsynth(c, x, y, s, z, t) {
    pad(c, x, y, s, z); box(c, x + 0.2, y + 1.0, 1.6, 0.8, z, 8, '#c4b8a6', { seams: 3, win: { n: 2, at: 0.6, h: 2.2, both: false } });
    cyl(c, x + 0.6, y + 0.6, 0.38, z, 22, '#e6edf0', null, [0.25, 0.55, 0.85]); cyl(c, x + 1.4, y + 0.6, 0.38, z, 18, '#e6edf0', null, [0.3, 0.65]);
    const tp1 = P(x + 0.6, y + 0.6, z + 22), tp2 = P(x + 1.4, y + 0.6, z + 18); fan(c, tp1[0], tp1[1], 8, t * 4); fan(c, tp2[0], tp2[1], 8, -t * 4.4);
    const p = P(x + 1.0, y + 1.4, z + 8); c.fillStyle = 'rgba(190,240,255,' + (0.35 + 0.3 * Math.sin(t * 2)) + ')'; c.beginPath(); c.arc(p[0], p[1] - 4, 3.6, 0, 7); c.fill();
  },
  watertank(c, x, y, s, z, t, b) {
    for (const [a, d] of [[0.45, 0.45], [1.55, 0.45], [0.45, 1.55], [1.55, 1.55]]) pole(c, x + a, y + d, z, 5, '#6e645c', 2);
    const top = cyl(c, x + 1, y + 1, 0.82, z + 4, 18, '#7ab0cc', '#a8d4ea', [0.33, 0.66]);
    const f = b && b.water !== undefined ? b.water / 80 : 0; c.fillStyle = 'rgba(40,120,200,.7)'; c.beginPath(); c.ellipse(top[0], top[1], 30 * f, 15 * f, 0, 0, 7); c.fill();
    if (ARTV.lod > 1) { const l0 = P(x + 1.55, y + 1.6, z + 4); c.strokeStyle = 'rgba(60,50,45,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(l0[0] - 2, l0[1]); c.lineTo(l0[0] - 2, l0[1] - 18); c.moveTo(l0[0] + 2, l0[1]); c.lineTo(l0[0] + 2, l0[1] - 18); for (let k = 2; k < 18; k += 3) { c.moveTo(l0[0] - 2, l0[1] - k); c.lineTo(l0[0] + 2, l0[1] - k); } c.stroke(); }
  },
  airtank(c, x, y, s, z) { for (const a of [0.28, 0.72]) pole(c, x + a, y + 0.5, z, 7, '#6e645c', 1.6); const tp = sphere(c, x + 0.5, y + 0.5, 0.42, z + 4, '#e8f2f6'); if (ARTV.lod > 1) { c.fillStyle = '#ff8a3a'; c.fillRect(tp[0] - 3, tp[1] - 1.5, 6, 3); } },
  reclaimer(c, x, y, s, z) { pad(c, x, y, s, z); box(c, x + 0.2, y + 0.2, 1.6, 1.0, z, 12, '#a9b8b0'); cyl(c, x + 0.6, y + 1.4, 0.35, z, 10, '#78a8b8'); cyl(c, x + 1.4, y + 1.4, 0.35, z, 10, '#78a8b8'); },
  algae(c, x, y, s, z, t) { pad(c, x, y, s, z); for (let k = 0; k < 4; k++) { const tp = cyl(c, x + 0.4 + (k % 2) * 1.1, y + 0.5 + (k >> 1) * 1.0, 0.3, z, 18, '#5fbf6a', '#9cf09c'); c.fillStyle = 'rgba(160,255,140,' + (0.2 + 0.15 * Math.sin(t + k)) + ')'; c.beginPath(); c.arc(tp[0], tp[1] + 8, 4, 0, 7); c.fill(); } },
  sinterer(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z, '#6a5a4c'); box(c, x + 0.2, y + 0.2, 1.1, 1.3, z, 14, '#a8784e', { seams: 1 });
    const on = b && b._out > 0, m = P(x + 0.75, y + 1.5, z + 6);
    c.fillStyle = on ? 'rgba(255,150,60,' + (0.7 + 0.3 * Math.sin(t * 4)) + ')' : '#3a2a20'; c.fillRect(m[0] - 4.5, m[1] - 5, 9, 6);
    if (on && ARTV.lod > 0.8) { c.fillStyle = 'rgba(255,190,90,.25)'; c.beginPath(); c.ellipse(m[0], m[1] + 2, 10, 4, 0, 0, 7); c.fill(); }
    const st = cyl(c, x + 0.45, y + 0.45, 0.14, z + 14, 12, '#5e544c'); if (on) steam(c, st[0], st[1], t, x + y * 2, '180,160,140', 0.7);
    box(c, x + 1.35, y + 0.3, 0.5, 1.5, z, 3, '#5e544c'); const sh = (t * 0.3) % 0.45;
    for (let k = 0; k < 3; k++) box(c, x + 1.45, y + 0.4 + ((k * 0.45 + (on ? sh : 0)) % 1.35), 0.3, 0.3, z + 3, 4, '#c9a27a', { edge: false });
  },
  oremine(c, x, y, s, z, t, b, g, col) {
    pad(c, x, y, s, z, '#5e544c');
    const on = b && b._out > 0, b0 = P(x + 0.8, y + 0.8, z);
    c.strokeStyle = '#a89a8a'; c.lineWidth = 2.2;
    c.beginPath(); c.moveTo(b0[0] - 12, b0[1]); c.lineTo(b0[0] - 2, b0[1] - 40); c.lineTo(b0[0] + 10, b0[1]); c.stroke(); c.beginPath(); c.moveTo(b0[0] - 2, b0[1] - 40); c.lineTo(b0[0] + 18, b0[1] - 18); c.stroke();
    if (ARTV.lod > 0.9) { c.lineWidth = 1; c.beginPath(); c.moveTo(b0[0] - 9, b0[1] - 10); c.lineTo(b0[0] + 7, b0[1] - 10); c.moveTo(b0[0] - 6, b0[1] - 22); c.lineTo(b0[0] + 4, b0[1] - 22); c.stroke(); }
    const wh = [b0[0] - 2, b0[1] - 40], sp = on ? t * 4 : 0; c.strokeStyle = '#e8ddd0'; c.lineWidth = 1.3; c.beginPath(); c.arc(wh[0], wh[1], 5.5, 0, 7); c.stroke();
    c.beginPath(); for (let k = 0; k < 2; k++) { const a = sp + k * Math.PI / 2; c.moveTo(wh[0] + Math.cos(a) * 5.5, wh[1] + Math.sin(a) * 5.5); c.lineTo(wh[0] - Math.cos(a) * 5.5, wh[1] - Math.sin(a) * 5.5); } c.stroke();
    c.strokeStyle = 'rgba(40,34,30,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(wh[0], wh[1]); c.lineTo(b0[0] - 2, b0[1] - 4); c.stroke();
    box(c, x + 1.1, y + 0.2, 0.7, 0.7, z, 9, '#b0a08c', { win: { n: 1, at: 0.55, h: 2.4 } });
    const pile = P(x + 1.4, y + 1.4, z); c.fillStyle = col || '#9aa4ad'; c.beginPath(); c.moveTo(pile[0] - 14, pile[1]); c.quadraticCurveTo(pile[0], pile[1] - 16, pile[0] + 14, pile[1]); c.closePath(); c.fill();
    if (ARTV.lod > 1) { c.fillStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.moveTo(pile[0] - 8, pile[1] - 4); c.quadraticCurveTo(pile[0] - 3, pile[1] - 12, pile[0] + 2, pile[1] - 8); c.fill(); }
    if (on) steam(c, b0[0] + 1, b0[1] - 2, t, x + y, '170,150,130', 0.6);
  },
  raremine(c, x, y, s, z, t, b, g) { ART.oremine(c, x, y, s, z, t, b, g, '#cdb6ff'); },
  automine(c, x, y, s, z, t, b, g) { ART.oremine(c, x, y, s, z, t, b, g, '#9fb0bb'); const p = P(x + 0.4, y + 1.5, z + 10); light(c, p[0], p[1], '#4fe0ff', t, 2); },
  harvester(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 1.4, 1.4, z, 10, '#8a7f9a'); const p = P(x + 1, y + 1, z + 10); c.fillStyle = 'rgba(255,110,210,.85)'; c.beginPath(); c.moveTo(p[0], p[1] - 22); c.lineTo(p[0] + 6, p[1] - 4); c.lineTo(p[0] - 6, p[1] - 4); c.fill(); light(c, p[0], p[1] - 24, '#ff8ae0', t, 2); },
  works(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z, '#5a524c'); box(c, x + 0.2, y + 0.3, 2.6, 2.4, z, 16, '#c6b49c', { seams: 4, win: { n: 4, at: 0.45, h: 3.2 } });
    for (let k = 0; k < 4; k++) { const a = P(x + 0.3 + k * 0.62, y + 0.3, z + 16), bb = P(x + 0.3 + k * 0.62, y + 2.7, z + 16); c.fillStyle = k % 2 ? '#8a7a68' : '#a3937f'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[0] + 9, a[1] - 9); c.lineTo(bb[0] + 9, bb[1] - 9); c.lineTo(bb[0], bb[1]); c.closePath(); c.fill();
      if (ARTV.lod > 0.9) { c.fillStyle = ARTV.night > 0.3 ? 'rgba(255,214,140,.55)' : 'rgba(150,200,230,.35)'; c.beginPath(); c.moveTo(a[0] + 9, a[1] - 9); c.lineTo(a[0] + 9, a[1] - 5); c.lineTo(bb[0] + 9, bb[1] - 5); c.lineTo(bb[0] + 9, bb[1] - 9); c.closePath(); c.fill(); } }
    const st = cyl(c, x + 2.4, y + 0.6, 0.18, z + 16, 18, '#6b625b', null, [0.3, 0.7]);
    if (b && b._act > 0) steam(c, st[0], st[1], t, x + y, '150,140,130', 0.9);
    const d = P(x + 1.5, y + 2.7, z + 6); c.fillStyle = b && b._act > 0 ? '#ffcc66' : '#3a3028'; c.fillRect(d[0] - 6, d[1] - 6, 12, 6);
  },
  refinery(c, x, y, s, z, t, b) { pad(c, x, y, s, z); cyl(c, x + 0.5, y + 0.6, 0.3, z, 30, '#c8bcae', null, [0.2, 0.45, 0.7]); cyl(c, x + 1.3, y + 0.5, 0.3, z, 22, '#c8bcae', null, [0.35, 0.7]); box(c, x + 0.3, y + 1.1, 1.4, 0.7, z, 8, ORANGE, { seams: 2 });
    if (ARTV.lod > 0.9) { const p1 = P(x + 0.5, y + 0.9, z + 14), p2 = P(x + 1.3, y + 0.8, z + 10); c.strokeStyle = '#8a7d70'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p1[0], p1[1]); c.quadraticCurveTo((p1[0] + p2[0]) / 2, p1[1] - 6, p2[0], p2[1]); c.stroke(); }
    const f = P(x + 0.5, y + 0.6, z + 34), fl = 0.6 + 0.3 * Math.sin(t * 8) + 0.1 * Math.sin(t * 23); c.fillStyle = 'rgba(255,170,60,' + fl + ')'; c.beginPath(); c.moveTo(f[0] - 2.5, f[1]); c.quadraticCurveTo(f[0], f[1] - 9 * fl, f[0] + 2.5, f[1]); c.fill();
    const s2 = P(x + 1.3, y + 0.5, z + 22); if (!b || b._act > 0) steam(c, s2[0], s2[1], t, x + y, '230,225,220', 0.6); },
  polymer(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.2, y + 1.4, 2.6, 1.3, z, 12, '#b8c2b0'); for (let k = 0; k < 3; k++) cyl(c, x + 0.6 + k * 0.9, y + 0.7, 0.38, z, 20, TEAL, '#8fe0d8'); cyl(c, x + 2.6, y + 2.4, 0.15, z + 12, 16, '#6b625b'); },
  foundry(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 2.4, 2.4, z, 14, '#d8dee2'); for (let k = 0; k < 4; k++) { const p = P(x + 0.6 + k * 0.6, y + 2.7, z + 8); c.fillStyle = 'rgba(120,170,255,' + (0.6 + 0.4 * Math.sin(t * 2 + k)) + ')'; c.fillRect(p[0] - 3, p[1] - 2, 6, 3); } box(c, x + 1, y + 1, 1, 1, z + 14, 6, '#aeb6bc'); },
  greenhouse(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#6a5d52');
    for (let r = 0; r < 3; r++) { const a = P(x + 0.15, y + r + 0.5, z), bb = P(x + 2.85, y + r + 0.5, z); c.fillStyle = 'rgba(110,190,90,.9)'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(bb[0], bb[1]); c.lineTo(bb[0], bb[1] - 4); c.lineTo(a[0], a[1] - 4); c.fill();
      if (ARTV.lod > 1.05) for (let k = 0; k < 8; k++) { const q = P(x + 0.3 + k * 0.33, y + r + 0.5, z + 4); c.fillStyle = k % 2 ? '#8fd46a' : '#5fa848'; c.beginPath(); c.arc(q[0], q[1] - 1.5, 2, 0, 7); c.fill(); } }
    for (let r = 0; r < 3; r++) { const a = P(x + 0.1, y + r + 0.5, z), bb = P(x + 2.9, y + r + 0.5, z); const g = c.createLinearGradient(0, a[1] - 18, 0, a[1]); g.addColorStop(0, 'rgba(220,250,255,.55)'); g.addColorStop(1, 'rgba(140,210,230,.25)');
      c.fillStyle = g; c.beginPath(); c.moveTo(a[0] - 10, a[1] + 5); c.quadraticCurveTo(a[0], a[1] - 22, a[0] + 10, a[1] - 5); c.lineTo(bb[0] + 10, bb[1] - 5); c.quadraticCurveTo(bb[0], bb[1] - 22, bb[0] - 10, bb[1] + 5); c.closePath(); c.fill(); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 0.6; c.stroke();
      if (ARTV.lod > 1.05) { c.strokeStyle = 'rgba(255,255,255,.22)'; c.beginPath(); for (let k = 1; k < 6; k++) { const q = P(x + 0.1 + k * 0.47, y + r + 0.5, z); c.moveTo(q[0] - 10, q[1] + 5); c.quadraticCurveTo(q[0], q[1] - 22, q[0] + 10, q[1] - 5); } c.stroke(); }
      if (ARTV.night > 0.3) { c.fillStyle = 'rgba(255,120,220,.12)'; c.fill(); } }
  },
  bloomfarm(c, x, y, s, z, t) { pad(c, x, y, s, z, '#5e5048'); for (let k = 0; k < 9; k++) { const p = P(x + 0.35 + (k % 3) * 0.65, y + 0.35 + ((k / 3) | 0) * 0.65, z); c.fillStyle = 'rgba(220,240,180,.9)'; c.beginPath(); c.arc(p[0], p[1] - 4 - Math.sin(t + k) * 1.2, 4, 0, 7); c.fill(); } },
  lab(c, x, y, s, z, t) { pad(c, x, y, s, z); box(c, x + 0.2, y + 0.3, 1.6, 1.4, z, 14, '#d9d2c6', { seams: 2, win: { n: 3, at: 0.5, h: 3 } }); const p = P(x + 1, y + 1, z + 14);
    c.fillStyle = '#c0d6e4'; c.beginPath(); c.ellipse(p[0], p[1], 18, 9, 0, Math.PI, 0); c.fill(); const dg = c.createRadialGradient(p[0] - 4, p[1] - 10, 1, p[0], p[1] - 4, 13); dg.addColorStop(0, '#f2f8fc'); dg.addColorStop(1, '#8fb0c6'); c.fillStyle = dg; c.beginPath(); c.arc(p[0], p[1] - 4, 12, Math.PI, 0); c.fill();
    if (ARTV.lod > 1) { c.fillStyle = '#20262c'; c.save(); c.translate(p[0], p[1] - 10); c.rotate(-0.6 + Math.sin(t * 0.25) * 0.4); c.fillRect(-1.5, -9, 3, 9); c.restore(); }
    light(c, p[0] + 14, p[1] - 6, '#b48cff', t, 2); },
  observatory(c, x, y, s, z, t) { pad(c, x, y, s, z); cyl(c, x + 1, y + 1, 0.8, z, 14, '#d8cfc2'); const p = P(x + 1, y + 1, z + 14); c.fillStyle = '#e8e2d8'; c.beginPath(); c.arc(p[0], p[1], 32, Math.PI, 0); c.fill(); c.fillStyle = '#20242a'; c.save(); c.translate(p[0], p[1] - 16); c.rotate(Math.sin(t * 0.2) * 0.5); c.fillRect(-3, -18, 6, 18); c.restore(); },
  mirror(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#5a524c'); box(c, x + 0.3, y + 1.8, 2.4, 0.9, z, 10, '#cfc6b8');
    const p = P(x + 1.4, y + 1.2, z); c.strokeStyle = '#a89a8a'; c.lineWidth = 2; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0], p[1] - 34); c.stroke();
    c.save(); c.translate(p[0], p[1] - 40); c.rotate(-0.5 + Math.sin(t * 0.2) * 0.15);
    const g = c.createLinearGradient(-26, 0, 26, 0); g.addColorStop(0, '#9fb7d0'); g.addColorStop(0.5, '#f4fbff'); g.addColorStop(1, '#7f97b0');
    c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 26, 9, 0, 0, 7); c.fill(); c.strokeStyle = '#5d6b7a'; c.lineWidth = 1; c.stroke(); c.restore();
    c.strokeStyle = 'rgba(255,240,200,' + (0.25 + 0.2 * Math.sin(t * 1.5)) + ')'; c.lineWidth = 2; c.beginPath(); c.moveTo(p[0] + 6, p[1] - 46); c.lineTo(p[0] + 30, p[1] - 140); c.stroke();
  },
  array(c, x, y, s, z, t) {
    pad(c, x, y, s, z, '#4f4744');
    for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283, px = x + 1.5 + Math.cos(a) * 1.1, py = y + 1.5 + Math.sin(a) * 1.1, tp = pole(c, px, py, z, 22 + (k % 2) * 8, '#3a3a44', 3);
      c.fillStyle = 'rgba(120,255,230,' + (0.4 + 0.4 * Math.sin(t * 2 + k)) + ')'; c.beginPath(); c.arc(tp[0], tp[1], 2.5, 0, 7); c.fill(); }
    const m = P(x + 1.5, y + 1.5, z + 6); const g = c.createRadialGradient(m[0], m[1], 1, m[0], m[1], 26); g.addColorStop(0, 'rgba(140,255,230,.7)'); g.addColorStop(1, 'rgba(140,255,230,0)'); c.fillStyle = g; c.beginPath(); c.arc(m[0], m[1], 26, 0, 7); c.fill();
    c.strokeStyle = 'rgba(140,255,230,' + (0.5 * (1 - (t % 2) / 2)) + ')'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(m[0], m[1], 10 + (t % 2) * 30, 5 + (t % 2) * 15, 0, 0, 7); c.stroke();
  },
  vault(c, x, y, s, z, t, b) {
    pad(c, x, y, s, z, '#4f4a48'); box(c, x + 0.2, y + 0.4, 2.6, 2.2, z, 10, '#bfc6cc');
    for (let k = 0; k < 4; k++) { const p = cyl(c, x + 0.6 + (k % 2) * 1.6, y + 0.9 + ((k / 2) | 0) * 1.2, 0.32, z + 10, 14, '#dfe8ee', '#aee4ff'); c.fillStyle = 'rgba(170,230,255,' + (0.35 + 0.3 * Math.sin(t * 1.2 + k)) + ')'; c.beginPath(); c.arc(p[0], p[1] + 4, 3, 0, 7); c.fill(); }
    const m = P(x + 1.5, y + 2.6, z + 5); c.fillStyle = b && b.built ? '#9fe0ff' : '#3a3a40'; c.fillRect(m[0] - 7, m[1] - 5, 14, 5);
  },
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
    const pop = Math.min(g.zoom > 1.2 ? 22 : 14, g.pop || 0), big = g.zoom > 1.2;
    for (let k = 0; k < pop; k++) {
      const a = t * 0.15 * (k % 2 ? 1 : -1) + k * 1.7, r = s * (0.13 + 0.06 * (k % 4)), cp = P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z + 3), step = Math.abs(Math.sin(t * 6 + k)) * 0.8;
      if (big) { c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(cp[0], cp[1], 2.4, 1, 0, 0, 7); c.fill(); }
      c.fillStyle = ['#ffd27a', '#7fd0ff', '#ff9a8a', '#c0ff9a', '#e8d0ff'][k % 5]; c.fillRect(cp[0] - (big ? 1.3 : 1), cp[1] - (big ? 5.5 : 4) - step, big ? 2.6 : 2, big ? 4.5 : 4);
      if (big) { c.fillStyle = '#f0d2b4'; c.beginPath(); c.arc(cp[0], cp[1] - 7 - step, 1.5, 0, 7); c.fill(); }
    }
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
  const c = cv.getContext('2d'), d = BUILDINGS[type] || { size: 1 }, lod0 = ARTV.lod, n0 = ARTV.night; ARTV.lod = 1.4; ARTV.night = 0;
  const s = d.size || 1, sc = px / (s * TW * 1.1 + 10) * dpr;
  c.scale(sc, sc); c.translate(s * TW * 0.55 + 5, (px * dpr / sc) * 0.72 - s * TH * 0.5);
  try {
    if (d.dome) drawDome(c, { id: 1, wear: 0 }, 0, 0, s, 0, 1, null);
    else if (ART[type]) ART[type](c, 0, 0, s, 0, 1, null, null);
    else if (MODULES[type]) box(c, 0.1, 0.1, 0.8, 0.8, 0, 14, MOD_COL[type] || '#c9bba8');
    else if (type === 'cable' || type === 'pipe') { c.strokeStyle = type === 'cable' ? '#ffd84a' : '#9fe4ff'; c.lineWidth = 5; c.beginPath(); c.moveTo(-20, 0); c.lineTo(20, 16); c.stroke(); }
  } catch (e) { /* icon only */ }
  ARTV.lod = lod0; ARTV.night = n0;
  return cv;
}
