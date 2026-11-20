// ===== art.js : procedural isometric drawing primitives and the building catalogue =====
// Every building is split into a static layer (s), optional moving parts (a) and an optional static layer drawn over
// the moving parts (o). Static layers are drawn once per zoom bucket into cached sprites (see art2.js); moving parts
// are drawn every frame. Static layers must only depend on the building's type, size and the key (k) they return.
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
// level of detail (the zoom the art is drawn for), lit windows, time, and the list of lit window quads for the night pass
const ARTV = { lod: 1, night: 0, lit: false, t: 0, emit: null, lights: null };
// materials: one palette for the whole colony (palette.js)
const MAT = PAL.mat;
const HULL = MAT.hull, HULL2 = MAT.hull2, DARK = MAT.dark, TEAL = MAT.teal, ORANGE = MAT.orange, GLASS = MAT.glass;
// a vertical face gradient: lit at the top, falling into contact shadow (ambient occlusion) at the ground
function faceGrad(ctx, p0, p1, col, f0, f1) { const g = ctx.createLinearGradient(0, p0, 0, p1); g.addColorStop(0, shade(col, f0)); g.addColorStop(0.62, shade(col, (f0 + f1) / 2)); g.addColorStop(1, shade(col, f1)); return g; }
// one light from the upper left for everything: lit tops, mid left faces, dark right faces, bright front edges,
// ambient occlusion where walls meet the ground or the part below, a bevel highlight on the lit edges
function box(ctx, x, y, w, d, z, h, col, opt = {}) {
  const top = [P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)];
  const fr = P(x + w, y + d, z), bl = P(x, y + d, z), br = P(x + w, y, z), rich = ARTV.lod > 0.5 && h > 3 && !opt.flat;
  poly(ctx, [br, fr, top[2], top[1]], opt.right || (rich ? faceGrad(ctx, top[1][1], fr[1], col, -0.3, -0.5) : shade(col, -0.36)));
  poly(ctx, [bl, fr, top[2], top[3]], opt.left || (rich ? faceGrad(ctx, top[3][1], fr[1], col, -0.04, -0.26) : shade(col, -0.14)));
  let tf = opt.top; if (!tf) { if (rich && w * d > 0.3) { const g = ctx.createLinearGradient(top[0][0], top[0][1], top[2][0], top[2][1]); g.addColorStop(0, shade(col, 0.26)); g.addColorStop(1, shade(col, 0.1)); tf = g; } else tf = shade(col, 0.16); }
  poly(ctx, top, tf, opt.edge === false ? null : 'rgba(20,12,10,.28)', 0.6);
  if (ARTV.lod > 0.7 && opt.edge !== false && h > 2) {
    // bevels: a bright lip on the two front top edges and the lit vertical corner, contact shadow along the base
    ctx.strokeStyle = 'rgba(255,250,240,.42)'; ctx.lineWidth = 0.75; ctx.beginPath(); ctx.moveTo(top[3][0], top[3][1]); ctx.lineTo(top[2][0], top[2][1]); ctx.lineTo(top[1][0], top[1][1]); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,246,230,.2)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(fr[0] - 0.3, fr[1] - 1); ctx.lineTo(top[2][0] - 0.3, top[2][1] + 0.6); ctx.stroke();
    ctx.strokeStyle = 'rgba(' + PAL.ao + ',.42)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bl[0], bl[1]); ctx.lineTo(fr[0], fr[1]); ctx.lineTo(br[0], br[1]); ctx.stroke();
  }
  if (ARTV.lod > 0.95 && opt.seams) {
    // panel lines with a light edge beside each dark seam
    for (const [col2, dx] of [['rgba(20,12,10,.2)', 0], ['rgba(255,246,232,.12)', 0.7]]) {
      ctx.strokeStyle = col2; ctx.lineWidth = 0.6; ctx.beginPath();
      for (let k = 1; k <= opt.seams; k++) { const f = k / (opt.seams + 1), a = P(x + w * f, y + d, z), b2 = P(x + w, y + d * f, z); ctx.moveTo(a[0] + dx, a[1] - 1); ctx.lineTo(a[0] + dx, a[1] - h + 1); ctx.moveTo(b2[0] + dx, b2[1] - 1); ctx.lineTo(b2[0] + dx, b2[1] - h + 1); }
      ctx.stroke();
    }
    if (ARTV.lod > 1.3 && w * d > 0.5) { // rivet-row greebles on the roof edge
      ctx.fillStyle = 'rgba(20,12,10,.25)'; const n = Math.max(2, Math.round((w + d) * 2.2));
      for (let k = 1; k < n; k++) { const f = k / n, a = P(x + w * f, y + d - 0.07, z + h); ctx.fillRect(a[0] - 0.5, a[1] - 0.3, 1, 0.8); }
    }
  }
  if (opt.win && ARTV.lod > 0.75) windows(ctx, x, y, w, d, z, h, opt.win);
  if (opt.band) { const a = P(x, y + d, z + h * opt.band[0]), b2 = P(x + w, y + d, z + h * opt.band[0]), c2 = P(x + w, y, z + h * opt.band[0]); ctx.strokeStyle = opt.band[1]; ctx.lineWidth = opt.band[2] || 2; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(c2[0], c2[1]); ctx.stroke(); }
  if (opt.door && ARTV.lod > 0.6) { const f = opt.door, a = P(x + w * f - 0.12, y + d, z), b2 = P(x + w * f + 0.12, y + d, z), dh = Math.min(h - 1, 7); poly(ctx, [a, b2, [b2[0], b2[1] - dh], [a[0], a[1] - dh]], '#2a2423'); if (ARTV.lod > 1) { ctx.fillStyle = ARTV.lit ? 'rgba(' + PAL.emit.window + ',.95)' : 'rgba(255,190,110,.75)'; ctx.fillRect(a[0] + 1, a[1] - dh - 1.6, b2[0] - a[0] - 2, 1); } }
  return top;
}
// a row of windows on both visible faces; they glow at night
function windows(ctx, x, y, w, d, z, h, o) {
  const n = o.n || 3, hy = z + h * (o.at || 0.55), wh = o.h || 3, lit = ARTV.lit;
  ctx.fillStyle = lit ? 'rgba(' + PAL.emit.window + ',.97)' : '#24384c';
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n, a = P(x + w * f - 0.06, y + d, hy), b2 = P(x + w * f + 0.06, y + d, hy); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(b2[0], b2[1] - wh); ctx.lineTo(a[0], a[1] - wh); ctx.fill();
    if (lit && ARTV.emit) ARTV.emit.push([a[0], a[1] - wh, b2[0] - a[0], wh, b2[1] - a[1]]);
    if (o.both !== false) { const c1 = P(x + w, y + d * f - 0.06, hy), c2 = P(x + w, y + d * f + 0.06, hy); ctx.beginPath(); ctx.moveTo(c1[0], c1[1]); ctx.lineTo(c2[0], c2[1]); ctx.lineTo(c2[0], c2[1] - wh); ctx.lineTo(c1[0], c1[1] - wh); ctx.fill(); if (lit && ARTV.emit) ARTV.emit.push([c1[0], c1[1] - wh, c2[0] - c1[0], wh, c2[1] - c1[1]]); }
  }
  // by day the glass reflects the sky in its upper third
  if (!lit && ARTV.lod > 1.05) { ctx.fillStyle = 'rgba(176,214,240,.5)'; for (let k = 0; k < n; k++) { const f = (k + 0.5) / n, a = P(x + w * f - 0.06, y + d, hy), b2 = P(x + w * f + 0.06, y + d, hy); ctx.beginPath(); ctx.moveTo(a[0], a[1] - wh); ctx.lineTo(b2[0], b2[1] - wh); ctx.lineTo(b2[0], b2[1] - wh * 0.62); ctx.lineTo(a[0], a[1] - wh * 0.62); ctx.fill(); } }
}
// cylinder centred at tile point (cx, cy), radius r in tiles; bands are rings at fractions of the height
function cyl(ctx, cx, cy, r, z, h, col, topCol, bands) {
  const x = isoX(cx, cy), y0 = isoY(cx, cy, z), y1 = y0 - h, rx = r * TW * 0.707, ry = r * TH * 0.707;
  // a metal body: lit flank, a crisp specular stripe, a cool reflected-light core and a dark terminator
  const g = ctx.createLinearGradient(x - rx, 0, x + rx, 0);
  g.addColorStop(0, shade(col, -0.12)); g.addColorStop(0.2, shade(col, 0.12)); g.addColorStop(0.3, shade(col, 0.36)); g.addColorStop(0.38, shade(col, 0.14));
  g.addColorStop(0.72, shade(col, -0.16)); g.addColorStop(0.92, shade(col, -0.46)); g.addColorStop(1, shade(col, -0.36));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y0, rx, ry, 0, 0, Math.PI); ctx.lineTo(x - rx, y1); ctx.ellipse(x, y1, rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
  if (ARTV.lod > 0.6 && h > 4) { // contact shadow at the foot of the wall
    const ao = ctx.createLinearGradient(0, y0 + ry - Math.min(h, 8), 0, y0 + ry); ao.addColorStop(0, 'rgba(' + PAL.ao + ',0)'); ao.addColorStop(1, 'rgba(' + PAL.ao + ',.32)');
    ctx.fillStyle = ao; ctx.beginPath(); ctx.ellipse(x, y0, rx, ry, 0, 0, Math.PI); ctx.lineTo(x - rx, y0 - Math.min(h, 8)); ctx.ellipse(x, y0 - Math.min(h, 8), rx, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
  }
  if (bands && ARTV.lod > 0.9) { ctx.lineWidth = 0.8; for (const f of bands) { ctx.strokeStyle = 'rgba(20,12,10,.26)'; ctx.beginPath(); ctx.ellipse(x, y0 - h * f, rx, ry, 0, 0, Math.PI); ctx.stroke(); ctx.strokeStyle = 'rgba(255,248,236,.16)'; ctx.beginPath(); ctx.ellipse(x, y0 - h * f - 0.8, rx, ry, 0, 0.2, Math.PI * 0.75); ctx.stroke(); } }
  ctx.fillStyle = topCol || shade(col, 0.24); ctx.beginPath(); ctx.ellipse(x, y1, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(20,12,10,.3)'; ctx.lineWidth = 0.6; ctx.stroke();
  if (ARTV.lod > 0.85) {
    ctx.strokeStyle = 'rgba(255,252,244,.5)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.ellipse(x, y1, rx, ry, 0, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
    if (rx > 6) { ctx.strokeStyle = 'rgba(20,12,10,.14)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.ellipse(x, y1, rx * 0.82, ry * 0.82, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); }
  }
  return [x, y1];
}
function sphere(ctx, cx, cy, r, z, col) {
  const x = isoX(cx, cy), y = isoY(cx, cy, z) - r * 22, rr = r * 24;
  const g = ctx.createRadialGradient(x - rr * 0.38, y - rr * 0.42, rr * 0.05, x, y, rr);
  g.addColorStop(0, shade(col, 0.7)); g.addColorStop(0.18, shade(col, 0.3)); g.addColorStop(0.6, col); g.addColorStop(0.92, shade(col, -0.5)); g.addColorStop(1, shade(col, -0.32));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  if (ARTV.lod > 0.9) {
    ctx.strokeStyle = 'rgba(20,12,10,.2)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.28, 0, 0, Math.PI); ctx.stroke();
    // warm light bounced up from the ground on the underside, and a hard specular glint
    ctx.strokeStyle = 'rgba(255,190,140,.28)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, rr - 0.8, Math.PI * 0.2, Math.PI * 0.75); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.ellipse(x - rr * 0.4, y - rr * 0.45, rr * 0.16, rr * 0.1, -0.6, 0, 7); ctx.fill();
  }
  return [x, y - rr];
}
// a dome cap on a cylinder-like base: radius r tiles, height h px
function domeCap(ctx, cx, cy, r, z, h, col) {
  const x = isoX(cx, cy), y0 = isoY(cx, cy, z), rx = r * TW * 0.707, ry = r * TH * 0.707;
  const g = ctx.createRadialGradient(x - rx * 0.4, y0 - h * 0.8, 1, x, y0 - h * 0.3, rx * 1.2); g.addColorStop(0, shade(col, 0.4)); g.addColorStop(0.6, col); g.addColorStop(1, shade(col, -0.4));
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y0, rx, ry, 0, 0, Math.PI); ctx.bezierCurveTo(x - rx, y0 - h * 1.33, x + rx, y0 - h * 1.33, x + rx, y0); ctx.fill();
  if (ARTV.lod > 0.9) { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(x, y0 - h * 0.35, rx * 0.7, h * 0.62, 0, Math.PI * 1.18, Math.PI * 1.42); ctx.stroke(); }
  return [x, y0 - h];
}
function pole(ctx, cx, cy, z, h, col, w) { const x = isoX(cx, cy), y = isoY(cx, cy, z); ctx.strokeStyle = col; ctx.lineWidth = w || 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke(); return [x, y - h]; }
// a polyline through tile-space points [x, y, z]
function pipe(ctx, pts, col, w) { ctx.strokeStyle = col; ctx.lineWidth = w || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach((q, i) => { const p = P(q[0], q[1], q[2]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke(); ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; if (ARTV.lod > 1.1 && w >= 2) { ctx.strokeStyle = 'rgba(255,250,240,.28)'; ctx.lineWidth = w * 0.35; ctx.beginPath(); pts.forEach((q, i) => { const p = P(q[0], q[1], q[2]); i ? ctx.lineTo(p[0], p[1] - w * 0.25) : ctx.moveTo(p[0], p[1] - w * 0.25); }); ctx.stroke(); } }
// a lattice tower between ground and height h, w px wide at the base
function lattice(ctx, px, py, h, w, col, rungs) {
  ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(px - w, py); ctx.lineTo(px - w * 0.3, py - h); ctx.moveTo(px + w, py); ctx.lineTo(px + w * 0.3, py - h); ctx.stroke();
  if (ARTV.lod < 0.6) return; ctx.lineWidth = 0.8; ctx.beginPath(); const n = rungs || 5;
  for (let k = 0; k < n; k++) { const f0 = k / n, f1 = (k + 1) / n, w0 = w * (1 - 0.7 * f0), w1 = w * (1 - 0.7 * f1); ctx.moveTo(px - w0, py - h * f0); ctx.lineTo(px + w0, py - h * f0); if (ARTV.lod > 0.95) { ctx.moveTo(px - w0, py - h * f0); ctx.lineTo(px + w1, py - h * f1); } }
  ctx.stroke();
}
// a blinking lamp with a small halo
function light(ctx, x, y, col, t, r) { const on = Math.sin(t * 3 + x * 0.1) > 0.2; if (!on) return; if (ARTV.lights && col[0] === '#') ARTV.lights.push([x, y, (r || 1.6) * 5, col]); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r || 1.6, 0, Math.PI * 2); ctx.fill(); if (ARTV.lod > 0.9) { ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, (r || 1.6) * 2.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; } }
// rising steam or dust puffs from a vent
function steam(ctx, x, y, t, seed, col, amt) {
  if (ARTV.lod < 0.55) return;
  const c0 = col || '235,230,225';
  for (let k = 0; k < 3; k++) { const ph = (t * 0.32 + k / 3 + seed * 0.137) % 1, a = (amt || 1) * 0.38 * (1 - ph); ctx.fillStyle = 'rgba(' + c0 + ',' + a.toFixed(3) + ')'; ctx.beginPath(); ctx.arc(x + Math.sin(ph * 3 + seed) * 4 + ph * 7, y - ph * 24, 2.2 + ph * 6.5, 0, Math.PI * 2); ctx.fill(); }
}
// concrete pad with a raised edge and hazard corners at close zoom
function pad(ctx, x, y, s, z, col) {
  const c0 = col || MAT.pad, q = [P(x + 0.08, y + 0.08, z), P(x + s - 0.08, y + 0.08, z), P(x + s - 0.08, y + s - 0.08, z), P(x + 0.08, y + s - 0.08, z)];
  // a soft ambient-occlusion skirt where the slab sits in the dust
  if (ARTV.lod > 0.5) { ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(' + PAL.ao + ',.16)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1] + 1.5); for (let i = 1; i < 4; i++) ctx.lineTo(q[i][0], q[i][1] + 1.5); ctx.closePath(); ctx.stroke(); ctx.lineJoin = 'miter'; }
  poly(ctx, [P(x + 0.08, y + s - 0.08, z), P(x + s - 0.08, y + s - 0.08, z), P(x + s - 0.08, y + s - 0.08, z - 2.4), P(x + 0.08, y + s - 0.08, z - 2.4)], shade(c0, -0.3));
  poly(ctx, [P(x + s - 0.08, y + 0.08, z), P(x + s - 0.08, y + s - 0.08, z), P(x + s - 0.08, y + s - 0.08, z - 2.4), P(x + s - 0.08, y + 0.08, z - 2.4)], shade(c0, -0.5));
  const g = ctx.createLinearGradient(q[0][0], q[0][1], q[2][0], q[2][1]); g.addColorStop(0, shade(c0, 0.1)); g.addColorStop(1, shade(c0, -0.08));
  poly(ctx, q, g, 'rgba(20,12,10,.34)', 0.7);
  if (ARTV.lod > 0.7) { ctx.strokeStyle = 'rgba(255,244,228,.22)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(q[3][0], q[3][1] - 0.4); ctx.lineTo(q[2][0], q[2][1] - 0.4); ctx.lineTo(q[1][0], q[1][1] - 0.4); ctx.stroke(); }
  if (ARTV.lod > 1.05) {
    const inn = [P(x + 0.2, y + 0.2, z), P(x + s - 0.2, y + 0.2, z), P(x + s - 0.2, y + s - 0.2, z), P(x + 0.2, y + s - 0.2, z)]; poly(ctx, inn, null, 'rgba(255,240,220,.1)', 0.7);
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 0.6; ctx.beginPath(); for (let k = 1; k < s; k++) { const a = P(x + k, y + 0.1, z), b = P(x + k, y + s - 0.1, z), c2 = P(x + 0.1, y + k, z), d = P(x + s - 0.1, y + k, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(c2[0], c2[1]); ctx.lineTo(d[0], d[1]); } ctx.stroke();
    ctx.strokeStyle = 'rgba(244,168,58,.8)'; ctx.lineWidth = 1.2; ctx.setLineDash([2.5, 2.5]); ctx.beginPath(); const e0 = P(x + 0.14, y + s - 0.14, z), e1 = P(x + 0.6, y + s - 0.14, z), e2 = P(x + s - 0.14, y + s - 0.6, z), e3 = P(x + s - 0.14, y + s - 0.14, z);
    ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.moveTo(e2[0], e2[1]); ctx.lineTo(e3[0], e3[1]); ctx.stroke(); ctx.setLineDash([]);
  }
}
// a turning fan seen from above, inside a ring
function fan(ctx, px, py, r, a) { ctx.fillStyle = '#2a2724'; ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); if (ARTV.lod < 0.8) return; ctx.strokeStyle = '#9a9088'; ctx.lineWidth = 1.4; ctx.beginPath(); for (let k = 0; k < 3; k++) { const b2 = a + k * 2.094; ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(b2) * r * 0.85, py + Math.sin(b2) * r * 0.42); } ctx.stroke(); }
// a glowing ellipse (crystals, pools, coils)
function glow(ctx, x, y, r, col, a) { const g = ctx.createRadialGradient(x, y, 0.5, x, y, r); g.addColorStop(0, 'rgba(' + col + ',' + a + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
// a faceted crystal standing at p, h tall
function crystal(ctx, p, h, w, col, lean) { const l = lean || 0; poly(ctx, [[p[0] - w, p[1]], [p[0] - w * 0.6 + l, p[1] - h * 0.8], [p[0] + l, p[1] - h], [p[0], p[1] + w * 0.3]], shade(col, 0.25)); poly(ctx, [[p[0] + w, p[1]], [p[0] + w * 0.6 + l, p[1] - h * 0.8], [p[0] + l, p[1] - h], [p[0], p[1] + w * 0.3]], shade(col, -0.3)); }
// a headframe wheel (static spokes; the turning part is drawn by the anim layer)
function wheel(ctx, x, y, r, a, col) { ctx.strokeStyle = col || '#e8ddd0'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.beginPath(); for (let k = 0; k < 3; k++) { const b2 = a + k * Math.PI / 3; ctx.moveTo(x + Math.cos(b2) * r, y + Math.sin(b2) * r); ctx.lineTo(x - Math.cos(b2) * r, y - Math.sin(b2) * r); } ctx.stroke(); }
const isOn = (b, g) => !!(g && g.on && b && (b._out > 0 || b._act > 0 || (b._out === undefined && b._act === undefined)));

// ---------- the building catalogue ----------
const ART = {
  lander: { top: 92,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5d524b');
      for (const [a, b] of [[0.4, 0.4], [2.6, 0.4], [0.4, 2.6], [2.6, 2.6]]) { const p0 = P(x + a, y + b, z), p1 = P(x + 1.5 + (a - 1.5) * 0.45, y + 1.5 + (b - 1.5) * 0.45, z + 22); c.strokeStyle = '#7d7168'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke(); c.fillStyle = '#4a423c'; c.beginPath(); c.ellipse(p0[0], p0[1], 5, 2.5, 0, 0, 7); c.fill(); }
      cyl(c, x + 1.5, y + 1.5, 0.98, z + 12, 22, HULL, null, [0.3, 0.75]);
      if (ARTV.lod > 0.8) for (let k = 0; k < 5; k++) { const a = Math.PI * (0.12 + k * 0.19), w = P(x + 1.5 + Math.cos(a) * 0.98, y + 1.5 + Math.sin(a) * 0.98, z + 24); c.fillStyle = ARTV.lit ? 'rgba(255,214,140,.95)' : '#33495a'; c.fillRect(w[0] - 2.5, w[1] - 3, 5, 3.2); if (ARTV.lit && ARTV.emit) ARTV.emit.push([w[0] - 2.5, w[1] - 3, 5, 3.2, 0]); }
      cyl(c, x + 1.5, y + 1.5, 0.62, z + 34, 13, HULL2, '#e9dccb', [0.5]);
      const tp = cyl(c, x + 1.5, y + 1.5, 0.24, z + 47, 9, ORANGE);
      if (ARTV.lod > 0.9) { c.strokeStyle = '#b8ab9c'; c.lineWidth = 1; c.beginPath(); c.moveTo(tp[0] + 6, tp[1]); c.lineTo(tp[0] + 10, tp[1] - 12); c.stroke(); }
      const hatch = P(x + 1.9, y + 2.45, z + 12); c.fillStyle = '#3a3430'; c.fillRect(hatch[0] - 4, hatch[1] - 9, 8, 9); c.fillStyle = 'rgba(255,200,120,.7)'; c.fillRect(hatch[0] - 3, hatch[1] - 8, 6, 1.2);
      // a ramp down to the pad
      poly(c, [P(x + 1.75, y + 2.45, z + 12), P(x + 2.05, y + 2.45, z + 12), P(x + 2.05, y + 2.95, z + 1), P(x + 1.75, y + 2.95, z + 1)], '#8a7d70');
    },
    a(c, x, y, s, z, t) { const tp = P(x + 1.5, y + 1.5, z + 56); if (ARTV.lod > 0.9) { c.fillStyle = '#e8ddd0'; c.beginPath(); c.ellipse(tp[0] + 10, tp[1] - 13, 4 + Math.cos(t * 0.5), 2, 0.4, 0, 7); c.fill(); } light(c, tp[0], tp[1] - 2, '#ff5a3a', t, 2.2); } },
  hub: { top: 70,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5a524c');
      box(c, x + 0.25, y + 0.25, 1.5, 1.5, z, 8, '#cfc2ae', { seams: 2, band: [0.55, 'rgba(232,138,60,.8)', 1.6], door: 0.5 });
      for (const [a, b] of [[0.6, 0.6], [1.4, 0.6], [0.6, 1.4], [1.4, 1.4]]) { const p = P(x + a, y + b, z + 8.4); c.fillStyle = '#2b2622'; c.beginPath(); c.ellipse(p[0], p[1], 7, 3.5, 0, 0, 7); c.fill(); }
      cyl(c, x + 1, y + 1, 0.3, z + 8, 14, '#bfb2a0', null, [0.5]);
      pole(c, x + 1, y + 1, z + 22, 12, '#8c8079', 1.5);
    },
    a(c, x, y, s, z, t) {
      if (ARTV.lod > 0.6) for (const [a, b] of [[0.6, 0.6], [1.4, 0.6], [0.6, 1.4], [1.4, 1.4]]) { const p = P(x + a, y + b, z + 8.4); c.strokeStyle = 'rgba(79,224,255,' + (0.5 + 0.4 * Math.sin(t * 2 + a * 3 + b)).toFixed(2) + ')'; c.lineWidth = 0.9; c.beginPath(); c.ellipse(p[0], p[1], 7, 3.5, 0, 0, 7); c.stroke(); }
      const d = P(x + 1, y + 1, z + 34); c.save(); c.translate(d[0], d[1]); c.rotate(Math.sin(t * 0.4) * 0.6); c.fillStyle = '#e6ddd0'; c.beginPath(); c.ellipse(0, 0, 7, 3, 0, 0, 7); c.fill(); c.strokeStyle = '#8a7d70'; c.lineWidth = 0.8; c.stroke(); c.restore();
      const tp = P(x + 1, y + 1, z + 22); light(c, tp[0], tp[1] - 1, '#4fe0ff', t, 2);
    } },
  depot: { top: 60,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      // a pallet rack along the back edge, crates in front
      for (const a of [0.15, 1.85]) pole(c, x + a, y + 0.15, z, 22, '#7d7168', 1.6);
      if (ARTV.lod > 0.7) { const r0 = P(x + 0.15, y + 0.15, z + 21), r1 = P(x + 1.85, y + 0.15, z + 21), r2 = P(x + 0.15, y + 0.15, z + 11), r3 = P(x + 1.85, y + 0.15, z + 11); c.strokeStyle = ORANGE; c.lineWidth = 1.4; c.beginPath(); c.moveTo(r0[0], r0[1]); c.lineTo(r1[0], r1[1]); c.moveTo(r2[0], r2[1]); c.lineTo(r3[0], r3[1]); c.stroke(); }
      const crate = (a, b, h, col, hh) => { box(c, x + a, y + b, 0.7, 0.7, z + (hh || 0), h, col, { seams: 1 }); if (ARTV.lod > 1) { const m1 = P(x + a + 0.35, y + b + 0.7, z + (hh || 0)), m2 = P(x + a + 0.7, y + b + 0.35, z + (hh || 0)); c.strokeStyle = 'rgba(30,22,16,.45)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(m1[0], m1[1]); c.lineTo(m1[0], m1[1] - h); c.moveTo(m2[0], m2[1]); c.lineTo(m2[0], m2[1] - h); c.stroke(); } };
      crate(0.25, 0.2, 9, '#7d8f9a'); crate(1.05, 0.2, 9, '#c58b4e'); crate(1.05, 0.2, 8, '#c9b18a', 9); crate(0.2, 1.05, 9, '#8a9a6a'); crate(1.08, 1.1, 7, '#c9b18a');
      cyl(c, x + 0.62, y + 0.9, 0.16, z, 9, '#5a7a8a'); cyl(c, x + 0.85, y + 1.1, 0.16, z, 9, '#5a7a8a');
    } },
  mast: { top: 74,
    s(c, x, y, s, z) { const b = P(x + 0.5, y + 0.5, z); c.fillStyle = '#4a423c'; c.beginPath(); c.ellipse(b[0], b[1], 8, 4, 0, 0, 7); c.fill(); lattice(c, b[0], b[1], 54, 6, '#b8aa98', 6); box(c, x + 0.62, y + 0.3, 0.3, 0.3, z, 5, '#8a7d70', { edge: false }); },
    a(c, x, y, s, z, t) { const b = P(x + 0.5, y + 0.5, z), a = t * 0.6; c.fillStyle = '#e8ddd0'; c.beginPath(); c.ellipse(b[0] + Math.cos(a) * 3, b[1] - 50, 8, 4, Math.cos(a) * 0.4, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#8a7d70'; c.lineWidth = 0.8; c.stroke(); light(c, b[0], b[1] - 57, '#ff4a3a', t, 2); } },
  assembler: { top: 64,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      // an open hangar: back wall, side wall, roof beams, and a drone on its cradle
      box(c, x + 0.15, y + 0.15, 1.7, 0.25, z, 18, '#c8bba8', { seams: 3 }); box(c, x + 0.15, y + 0.4, 0.25, 1.4, z, 18, '#b9ab96', { seams: 2 });
      box(c, x + 0.9, y + 0.9, 0.6, 0.6, z, 3, '#5e544c'); const d0 = P(x + 1.2, y + 1.2, z + 7); c.fillStyle = '#e6e0d6'; c.beginPath(); c.ellipse(d0[0], d0[1], 7, 3.2, 0, 0, 7); c.fill(); c.fillStyle = '#4fb3b0'; c.beginPath(); c.ellipse(d0[0], d0[1] - 1, 3, 1.4, 0, 0, 7); c.fill();
      for (const [a, b] of [[0.2, 1.8], [1.8, 0.2], [1.8, 1.8]]) pole(c, x + a, y + b, z, 20, '#8a7d70', 1.6);
      const g1 = P(x + 0.2, y + 1.8, z + 20), g2 = P(x + 1.8, y + 1.8, z + 20), g3 = P(x + 1.8, y + 0.2, z + 20), g0 = P(x + 0.2, y + 0.2, z + 20); c.strokeStyle = ORANGE; c.lineWidth = 2.2; c.beginPath(); c.moveTo(g0[0], g0[1]); c.lineTo(g3[0], g3[1]); c.lineTo(g2[0], g2[1]); c.lineTo(g1[0], g1[1]); c.lineTo(g0[0], g0[1]); c.stroke();
    },
    a(c, x, y, s, z, t, b, g) { const k = isOn(b, g) ? (Math.sin(t * 0.9) + 1) / 2 : 0.5, a0 = P(x + 0.2 + k * 1.6, y + 0.2, z + 20), a1 = P(x + 0.2 + k * 1.6, y + 1.8, z + 20); c.strokeStyle = '#ffd36a'; c.lineWidth = 2; c.beginPath(); c.moveTo(a0[0], a0[1]); c.lineTo(a1[0], a1[1]); c.stroke(); const hk = P(x + 0.2 + k * 1.6, y + 1.2, z + 20); c.strokeStyle = '#3a3532'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(hk[0], hk[1]); c.lineTo(hk[0], hk[1] + 9); c.stroke(); if (isOn(b, g) && ARTV.lod > 0.8 && Math.sin(t * 13) > 0.3) { const w = P(x + 1.2, y + 1.2, z + 9); c.fillStyle = '#bfe8ff'; c.beginPath(); c.arc(w[0] + 4, w[1] - 2, 1.6, 0, 7); c.fill(); glow(c, w[0] + 4, w[1] - 2, 7, '160,220,255', 0.5); } } },
  heater: { top: 48,
    s(c, x, y, s, z) {
      box(c, x + 0.2, y + 0.2, 0.6, 0.6, z, 5, '#6a5f56');
      // a stack of radiator fins around a core
      cyl(c, x + 0.5, y + 0.5, 0.22, z + 5, 22, '#8a7d70', '#5a4a40');
      for (let k = 0; k < 5; k++) { const p = P(x + 0.5, y + 0.5, z + 8 + k * 3.6), r = 11 - k * 0.6; c.fillStyle = k % 2 ? '#a3473a' : '#c25a3c'; c.beginPath(); c.ellipse(p[0], p[1], r, r * 0.5, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(p[0], p[1] + 0.8, r, r * 0.5, 0, 0, Math.PI); c.fill(); }
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on)) return; const p = P(x + 0.5, y + 0.5, z + 28); c.fillStyle = 'rgba(255,170,70,' + (0.75 + 0.25 * Math.sin(t * 2)).toFixed(2) + ')'; c.beginPath(); c.ellipse(p[0], p[1], 5, 2.5, 0, 0, 7); c.fill(); glow(c, p[0], p[1] - 6, 20, '255,140,60', 0.35 + 0.1 * Math.sin(t * 2)); if (ARTV.lod > 0.8) for (let k = 0; k < 3; k++) { const ph = (t * 0.5 + k / 3) % 1; c.strokeStyle = 'rgba(255,200,150,' + (0.25 * (1 - ph)).toFixed(2) + ')'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(p[0] - 4, p[1] - 4 - ph * 18); c.quadraticCurveTo(p[0], p[1] - 8 - ph * 18, p[0] + 4, p[1] - 4 - ph * 18); c.stroke(); } } },
  brush: { top: 74,
    s(c, x, y, s, z) {
      box(c, x + 0.25, y + 0.25, 0.5, 0.5, z, 6, '#7d7168');
      const b = P(x + 0.5, y + 0.5, z + 6); lattice(c, b[0], b[1], 40, 4, '#9a8d80', 5);
      // splayed bristle rods at the top
      c.strokeStyle = '#c8d4dc'; c.lineWidth = 1; c.beginPath(); for (let k = -3; k <= 3; k++) { c.moveTo(b[0] + k * 0.5, b[1] - 38); c.lineTo(b[0] + k * 3.4, b[1] - 54 + Math.abs(k) * 2); } c.stroke();
      c.fillStyle = '#6f7a82'; c.beginPath(); c.ellipse(b[0], b[1] - 38, 4, 2, 0, 0, 7); c.fill();
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on)) return; const p = P(x + 0.5, y + 0.5, z + 6); for (let k = -3; k <= 3; k += 2) { if (Math.sin(t * 7 + k * 1.7) < 0.4) continue; c.strokeStyle = 'rgba(160,215,255,.85)'; c.lineWidth = 0.9; c.beginPath(); const tx = p[0] + k * 3.4, ty = p[1] - 54 + Math.abs(k) * 2; c.moveTo(tx, ty); c.lineTo(tx + 3, ty - 4); c.lineTo(tx - 1, ty - 7); c.lineTo(tx + 2, ty - 11); c.stroke(); } glow(c, p[0], p[1] - 50, 14, '140,200,255', 0.25 + 0.15 * Math.sin(t * 5)); } },
  lance: { top: 56,
    s(c, x, y, s, z) { cyl(c, x + 0.5, y + 0.5, 0.42, z, 7, '#6f6660', '#8a8078', [0.5]); cyl(c, x + 0.5, y + 0.5, 0.3, z + 7, 6, '#a59a8e'); },
    a(c, x, y, s, z, t, b, g) {
      // a turret that slowly tracks the sky
      const p = P(x + 0.5, y + 0.5, z + 13), a = Math.sin(t * 0.3) * 1.2, dx = Math.cos(a) * 14, dy = Math.sin(a) * 5;
      c.fillStyle = '#8a8078'; c.beginPath(); c.ellipse(p[0], p[1], 8, 4.5, 0, 0, 7); c.fill(); c.fillStyle = '#c4b8aa'; c.beginPath(); c.ellipse(p[0], p[1] - 2, 7, 3.6, 0, 0, 7); c.fill();
      c.strokeStyle = '#d6cbbd'; c.lineWidth = 3.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(p[0], p[1] - 3); c.lineTo(p[0] + dx * 0.6, p[1] - 22 + dy); c.stroke(); c.strokeStyle = '#4a4440'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p[0] + dx * 0.55, p[1] - 20 + dy); c.lineTo(p[0] + dx * 0.62, p[1] - 23 + dy); c.stroke(); c.lineCap = 'butt';
      if (g && g.on) light(c, p[0] - 4, p[1] - 4, '#ff3a3a', t, 1.6);
    } },
  spire: { top: 170,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#6a5d52');
      box(c, x + 0.5, y + 0.5, 3, 3, z, 10, '#c9b9a2', { seams: 5, win: { n: 6, at: 0.5, h: 2.4 } });
      const cx = x + 2, cy = y + 2;
      for (let k = 0; k < 5; k++) { const r = 1.1 - k * 0.18; box(c, cx - r, cy - r, r * 2, r * 2, z + 10 + k * 22, 22, k % 2 ? '#e2d4bf' : '#b8a58a', { seams: 2, win: k % 2 ? { n: 3, at: 0.5, h: 3 } : null }); }
      const tp = P(cx, cy, z + 120); c.strokeStyle = '#e8ddd0'; c.lineWidth = 2; c.beginPath(); c.moveTo(tp[0], tp[1]); c.lineTo(tp[0], tp[1] - 26); c.stroke();
      // banners on the base
      if (ARTV.lod > 0.7) for (const f of [0.25, 0.75]) { const q = P(x + 0.5 + 3 * f, y + 3.5, z + 9); poly(c, [[q[0] - 3, q[1]], [q[0] + 3, q[1] + 1.5], [q[0] + 3, q[1] + 9], [q[0], q[1] + 6], [q[0] - 3, q[1] + 7.5]], ORANGE); }
    },
    a(c, x, y, s, z, t) { const tp = P(x + 2, y + 2, z + 122); glow(c, tp[0], tp[1], 22 + 3 * Math.sin(t * 2), '255,220,140', 0.9); c.fillStyle = '#fff4d6'; c.beginPath(); c.arc(tp[0], tp[1] - 26, 2.2, 0, 7); c.fill(); } },
  solar: { top: 30, k: (b, g) => (g && g.sunTilt !== undefined ? Math.round(g.sunTilt * 2) : 1),
    s(c, x, y, s, z, b, g) {
      const tilt = g && g.sunTilt !== undefined ? Math.round(g.sunTilt * 2) / 2 : 0.5, det = ARTV.lod > 1.05;
      for (const [a, d] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const bx = x + a + 0.1, by = y + d + 0.1, w = 0.8;
        pole(c, bx + w / 2, by + w / 2, z, 6, '#6e645c', 1.6);
        const h0 = 6 + tilt * 5, h1 = 6 - tilt * 2;
        const pts = [P(bx, by, z + h0), P(bx + w, by, z + h0), P(bx + w, by + w, z + h1), P(bx, by + w, z + h1)];
        // photovoltaic glass: deep blue cells, a pale sky sheen across the upper corner, a bright aluminium frame
        const gr = c.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]); gr.addColorStop(0, MAT.solarHi); gr.addColorStop(0.28, '#24426e'); gr.addColorStop(0.45, '#1a3156'); gr.addColorStop(1, MAT.solar);
        poly(c, pts, gr, '#c4ced8', 0.9);
        if (ARTV.lod > 0.6) { c.fillStyle = 'rgba(200,226,255,.16)'; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); c.lineTo((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2); c.lineTo((pts[0][0] + pts[3][0]) / 2, (pts[0][1] + pts[3][1]) / 2); c.closePath(); c.fill(); }
        if (ARTV.lod > 0.6) { c.strokeStyle = 'rgba(150,190,240,.32)'; c.lineWidth = 0.5; c.beginPath();
          for (let k = 1; k < (det ? 4 : 2); k++) { const f = k / (det ? 4 : 2), m1 = P(bx + w * f, by, z + h0), m2 = P(bx + w * f, by + w, z + h1), n1 = P(bx, by + w * f, z + h0 + (h1 - h0) * f), n2 = P(bx + w, by + w * f, z + h0 + (h1 - h0) * f); c.moveTo(m1[0], m1[1]); c.lineTo(m2[0], m2[1]); if (det) { c.moveTo(n1[0], n1[1]); c.lineTo(n2[0], n2[1]); } }
          c.stroke(); }
      }
    },
    a(c, x, y, s, z, t) { if (ARTV.lod < 1.2 || ARTV.night > 0.5) return; for (const [a, d] of [[0, 0], [1, 1]]) { const gl = (t * 0.08 + a * 0.3 + d * 0.5) % 1, sh = P(x + a + 0.1 + 0.8 * gl, y + d + 0.2, z + 9); c.fillStyle = 'rgba(220,240,255,.2)'; c.beginPath(); c.moveTo(sh[0], sh[1]); c.lineTo(sh[0] + 7, sh[1] + 2); c.lineTo(sh[0] + 2, sh[1] + 7); c.fill(); } } },
  wind: { top: 70,
    s(c, x, y, s, z) {
      const base = P(x + 0.5, y + 0.5, z), H = 46, top = [base[0], base[1] - H];
      c.fillStyle = '#4a423c'; c.beginPath(); c.ellipse(base[0], base[1], 6, 3, 0, 0, 7); c.fill();
      const tg = c.createLinearGradient(base[0] - 3, 0, base[0] + 3, 0); tg.addColorStop(0, '#efe6da'); tg.addColorStop(1, '#a99c8e');
      c.fillStyle = tg; c.beginPath(); c.moveTo(base[0] - 2.6, base[1]); c.lineTo(top[0] - 1.2, top[1]); c.lineTo(top[0] + 1.2, top[1]); c.lineTo(base[0] + 2.6, base[1]); c.closePath(); c.fill();
      if (ARTV.lod > 0.9) { c.fillStyle = ORANGE; c.fillRect(base[0] - 2.2, base[1] - 10, 4.4, 1.4); }
      c.fillStyle = '#d9cfc2'; c.beginPath(); c.ellipse(top[0] + 2, top[1], 5, 2.6, 0, 0, 7); c.fill();
    },
    a(c, x, y, s, z, t, b, g) {
      const base = P(x + 0.5, y + 0.5, z), top = [base[0], base[1] - 46], a = (g && g.windAngle !== undefined && t ? g.windAngle : t * 3) * (b && b.broken ? 0 : 1) + (b ? b.id : 0), L = 17;
      for (let k = 0; k < 3; k++) {
        const ang = a + k * 2.094, ca = Math.cos(ang), sa = Math.sin(ang) * 0.92, nx = -sa, ny = ca;
        c.fillStyle = k ? '#ece3d6' : '#f4ece0'; c.beginPath(); c.moveTo(top[0] + nx * 1.8, top[1] + ny * 1.8); c.lineTo(top[0] + ca * L + nx * 0.6, top[1] + sa * L + ny * 0.6); c.lineTo(top[0] + ca * L - nx * 0.4, top[1] + sa * L - ny * 0.4); c.lineTo(top[0] - nx * 1.2, top[1] - ny * 1.2); c.closePath(); c.fill();
        if (ARTV.lod > 1.1) { c.strokeStyle = 'rgba(80,70,60,.35)'; c.lineWidth = 0.5; c.stroke(); }
      }
      c.fillStyle = '#9a8d80'; c.beginPath(); c.arc(top[0], top[1], 2.4, 0, 7); c.fill();
      if (ARTV.night > 0.3) light(c, top[0] + 4, top[1] - 2, '#ff4a3a', t + (b ? b.id : 0), 1.4);
    } },
  fuelgen: { top: 56,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z); box(c, x + 0.2, y + 0.3, 1.5, 1.3, z, 12, '#a99a86', { seams: 2, band: [0.7, 'rgba(232,138,60,.7)', 1.4], door: 0.3 });
      cyl(c, x + 1.5, y + 0.5, 0.2, z + 12, 14, '#6b625b', null, [0.5]);
      cyl(c, x + 0.6, y + 1.4, 0.3, z, 9, ORANGE, null, [0.5]);
      if (ARTV.lod > 0.9) pipe(c, [[x + 0.6, y + 1.4, z + 8], [x + 0.6, y + 1.15, z + 10]], '#6b625b', 1.6);
    },
    a(c, x, y, s, z, t, b, g) { const st = P(x + 1.5, y + 0.5, z + 26), act = g && g.on && b && b._out > 0; if (act) steam(c, st[0], st[1], t, x + y, '120,110,100', 1); if (ARTV.lod > 0.9) { const f = P(x + 1.1, y + 1.6, z + 6); fan(c, f[0] + 6, f[1] - 2, 5, act ? t * 9 : 0); } } },
  battery: { top: 40, k: b => (b && b._cap ? Math.round((b.charge || 0) / b._cap * 4) : 0),
    s(c, x, y, s, z, b) {
      box(c, x + 0.12, y + 0.12, 0.76, 0.76, z, 12, '#5f6a70', { seams: 2, band: [0.82, 'rgba(61,179,173,.85)', 1.3] });
      // louvred cooling vents on the shaded face
      if (ARTV.lod > 0.9) { c.strokeStyle = 'rgba(14,16,18,.55)'; c.lineWidth = 0.7; c.beginPath(); for (let k = 0; k < 4; k++) { const a0 = P(x + 0.88, y + 0.22, z + 3 + k * 1.6), a1 = P(x + 0.88, y + 0.5, z + 3 + k * 1.6); c.moveTo(a0[0], a0[1]); c.lineTo(a1[0], a1[1]); } c.stroke(); }
      // terminals and cooling ribs on top
      const tp = P(x + 0.5, y + 0.5, z + 12); if (ARTV.lod > 0.8) { c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.8; c.beginPath(); for (let k = -1; k <= 1; k++) { c.moveTo(tp[0] - 8, tp[1] + k * 2.4); c.lineTo(tp[0] + 8, tp[1] + k * 2.4); } c.stroke(); }
      for (const [dx, col] of [[-6, '#ff5a4a'], [6, '#3a3a40']]) { c.fillStyle = col; c.fillRect(tp[0] + dx - 1.5, tp[1] - 4, 3, 4); }
      const f = b && b._cap ? Math.round((b.charge || 0) / b._cap * 4) / 4 : 0, p2 = P(x + 0.88, y + 0.7, z + 2);
      c.fillStyle = '#15181b'; c.fillRect(p2[0] - 8, p2[1] - 10, 6, 9);
      c.fillStyle = f > 0.3 ? '#7dff8a' : f > 0.1 ? '#ffb34a' : '#ff5a4a'; c.fillRect(p2[0] - 7, p2[1] - 2 - 7 * f, 4, 7 * f);
    } },
  thinfilm: { top: 30,
    s(c, x, y, s, z) {
      for (let r = 0; r < 3; r++) {
        const pts = [P(x + 0.1, y + r + 0.15, z + 4), P(x + 2.9, y + r + 0.15, z + 4), P(x + 2.9, y + r + 0.85, z + 1), P(x + 0.1, y + r + 0.85, z + 1)];
        const gr = c.createLinearGradient(pts[0][0], pts[0][1], pts[2][0], pts[2][1]); gr.addColorStop(0, '#3a3a6a'); gr.addColorStop(0.5, '#24305a'); gr.addColorStop(1, '#1a2240');
        poly(c, pts, gr, '#6a7fa8', 0.6);
        if (ARTV.lod > 0.9) { c.strokeStyle = 'rgba(180,160,255,.18)'; c.lineWidth = 0.5; c.beginPath(); for (let k = 1; k < 7; k++) { const a = P(x + 0.1 + k * 0.4, y + r + 0.15, z + 4), b2 = P(x + 0.1 + k * 0.4, y + r + 0.85, z + 1); c.moveTo(a[0], a[1]); c.lineTo(b2[0], b2[1]); } c.stroke(); }
        for (const f of [0.1, 2.9]) { const q = P(x + f, y + r + 0.5, z); c.fillStyle = '#5a524c'; c.fillRect(q[0] - 1, q[1] - 3, 2, 3); }
      }
      box(c, x + 2.55, y + 2.55, 0.35, 0.35, z, 7, '#8a8f94');
    } },
  reactor: { top: 92,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5a524c');
      // a hyperbolic cooling tower behind the containment drum
      const cx = isoX(x + 2.1, y + 0.9), cy0 = isoY(x + 2.1, y + 0.9, z), H = 56, rb = 26, rm = 17, rt = 20;
      const g = c.createLinearGradient(cx - rb, 0, cx + rb, 0); g.addColorStop(0, '#b8ad9f'); g.addColorStop(0.35, '#e6dccd'); g.addColorStop(1, '#8a7f72');
      c.fillStyle = g; c.beginPath(); c.moveTo(cx - rb, cy0); c.quadraticCurveTo(cx - rm * 0.9, cy0 - H * 0.55, cx - rt, cy0 - H); c.lineTo(cx + rt, cy0 - H); c.quadraticCurveTo(cx + rm * 0.9, cy0 - H * 0.55, cx + rb, cy0); c.ellipse(cx, cy0, rb, rb * 0.5, 0, 0, Math.PI); c.fill();
      c.fillStyle = '#4a4440'; c.beginPath(); c.ellipse(cx, cy0 - H, rt, rt * 0.5, 0, 0, 7); c.fill(); c.strokeStyle = '#e6dccd'; c.lineWidth = 1; c.stroke();
      if (ARTV.lod > 0.9) { c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 0.7; c.beginPath(); c.ellipse(cx, cy0 - H * 0.8, rm + 1, (rm + 1) * 0.5, 0, 0, Math.PI); c.stroke(); }
      box(c, x + 0.2, y + 1.8, 2.6, 1.0, z, 12, '#b5a690', { seams: 4, win: { n: 4, at: 0.55, h: 2.6 }, door: 0.7 });
      const top = cyl(c, x + 0.95, y + 1.05, 0.72, z, 30, '#d8cdbd', '#c2b6a6', [0.3, 0.7]); domeCap(c, x + 0.95, y + 1.05, 0.72, z + 30, 10, '#e2d8ca');
      if (ARTV.lod > 0.8) { c.fillStyle = '#f5d33a'; c.beginPath(); c.arc(top[0] - 8, top[1] + 16, 3, 0, 7); c.fill(); c.fillStyle = '#2a2622'; c.beginPath(); c.arc(top[0] - 8, top[1] + 16, 1, 0, 7); c.fill(); }
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on)) return; const cx = isoX(x + 2.1, y + 0.9), cy = isoY(x + 2.1, y + 0.9, z) - 56; steam(c, cx - 4, cy, t, 1, '240,240,240', 1.4); steam(c, cx + 5, cy - 2, t + 1.3, 2, '240,240,240', 1.2); const tp = P(x + 0.95, y + 1.05, z + 40); c.fillStyle = 'rgba(120,220,255,' + (0.6 + 0.3 * Math.sin(t * 2)).toFixed(2) + ')'; c.beginPath(); c.arc(tp[0], tp[1], 2.5, 0, 7); c.fill(); } },
  cell: { top: 64,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      // a ring cradle holding the crystal, cables to a control box
      box(c, x + 0.15, y + 1.35, 0.5, 0.5, z, 9, '#8a8f94', { win: { n: 1, at: 0.5, h: 2 } });
      const p = P(x + 1.05, y + 1.05, z); c.fillStyle = '#3a3532'; c.beginPath(); c.ellipse(p[0], p[1], 18, 9, 0, 0, 7); c.fill();
      for (const a of [-1, 1]) { c.strokeStyle = '#9a8d80'; c.lineWidth = 2.4; c.beginPath(); c.moveTo(p[0] + a * 16, p[1]); c.lineTo(p[0] + a * 14, p[1] - 30); c.stroke(); }
      c.strokeStyle = '#c8bcae'; c.lineWidth = 2; c.beginPath(); c.ellipse(p[0], p[1] - 30, 15, 6, 0, Math.PI, 0); c.stroke();
      if (ARTV.lod > 0.8) pipe(c, [[x + 0.4, y + 1.6, z + 2], [x + 0.75, y + 1.35, z + 2]], '#ff7ad9', 1.4);
    },
    a(c, x, y, s, z, t, b, g) { const p = P(x + 1.05, y + 1.05, z), on2 = g && g.on, h = 32, bob = on2 ? Math.sin(t * 1.4) * 1.5 : 0; crystal(c, [p[0], p[1] - 6 + bob], h, 9, on2 ? '#ff7ad9' : '#a07090'); if (on2) glow(c, p[0], p[1] - 20 + bob, 26, '255,120,220', 0.3 + 0.12 * Math.sin(t * 3)); c.strokeStyle = '#c8bcae'; c.lineWidth = 2; c.beginPath(); c.ellipse(p[0], p[1] - 30, 15, 6, 0, 0, Math.PI); c.stroke(); } },
  icedrill: { top: 64,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      cyl(c, x + 1.42, y + 1.32, 0.44, z, 13, '#9fd0e8', '#c8ecff', [0.35, 0.7]);
      box(c, x + 1.0, y + 0.25, 0.7, 0.55, z, 7, '#c4b8a6', { win: { n: 1, at: 0.5, h: 2.4, both: false } });
      const b0 = P(x + 0.7, y + 0.7, z); lattice(c, b0[0], b0[1], 38, 9, '#bfb19f', 4);
      if (ARTV.lod > 0.9) pipe(c, [[x + 0.8, y + 0.9, z + 3], [x + 1.15, y + 1.15, z + 6]], '#7aa8c0', 1.8);
    },
    a(c, x, y, s, z, t, b, g) { const b0 = P(x + 0.7, y + 0.7, z), act = isOn(b, g) && b._out > 0, k = act ? Math.sin(t * 6) * 3 : 0; c.fillStyle = ORANGE; c.fillRect(b0[0] - 2, b0[1] - 32 + k, 4, 11); if (ARTV.lod > 0.9) { c.strokeStyle = '#6b625b'; c.lineWidth = 2; c.beginPath(); c.moveTo(b0[0], b0[1] - 20 + k); c.lineTo(b0[0], b0[1] - 2); c.stroke(); } light(c, b0[0], b0[1] - 39, '#ff5a3a', t, 1.6); if (act) steam(c, b0[0] + 3, b0[1] - 4, t, x + y, '225,240,250', 0.8); } },
  condenser: { top: 50,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z); box(c, x + 0.3, y + 0.3, 1.4, 1.4, z, 10, '#b9c6cc', { seams: 2 });
      c.strokeStyle = '#f2fbff'; c.lineWidth = 2;
      // a condensation tray glinting along the front and a pipe manifold on the side
      if (ARTV.lod > 0.8) { const t0 = P(x + 0.3, y + 1.72, z + 1), t1 = P(x + 1.7, y + 1.72, z + 1); c.strokeStyle = 'rgba(140,210,240,.75)'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(t0[0], t0[1]); c.lineTo(t1[0], t1[1]); c.stroke(); pipe(c, [[x + 1.72, y + 0.5, z + 7], [x + 1.86, y + 0.5, z + 7], [x + 1.86, y + 0.5, z + 1]], '#7aa8c0', 1.8); }
      for (let k = 0; k < 5; k++) { const p1 = P(x + 0.42 + k * 0.28, y + 0.5, z + 10); c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(p1[0], p1[1] - 9); c.stroke(); if (ARTV.lod > 1) { c.strokeStyle = 'rgba(140,190,210,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(p1[0] + 1, p1[1]); c.lineTo(p1[0] + 1, p1[1] - 9); c.stroke(); c.strokeStyle = '#f2fbff'; c.lineWidth = 2; } }
    },
    a(c, x, y, s, z, t, b, g) { const f = P(x + 1, y + 1.3, z + 10), act = isOn(b, g); fan(c, f[0] + 8, f[1] - 2, 7, act ? t * 5 : 0.4); if (act) steam(c, f[0] - 6, f[1] - 10, t, x * 3 + y, '235,248,255', 0.6); } },
  airsynth: { top: 56,
    s(c, x, y, s, z) { pad(c, x, y, s, z); box(c, x + 0.2, y + 1.0, 1.6, 0.8, z, 8, '#c4b8a6', { seams: 3, win: { n: 2, at: 0.6, h: 2.2, both: false } }); cyl(c, x + 0.6, y + 0.6, 0.38, z, 22, '#e6edf0', null, [0.25, 0.55, 0.85]); cyl(c, x + 1.4, y + 0.6, 0.38, z, 18, '#e6edf0', null, [0.3, 0.65]); },
    a(c, x, y, s, z, t, b, g) { const tp1 = P(x + 0.6, y + 0.6, z + 22), tp2 = P(x + 1.4, y + 0.6, z + 18), act = g && g.on; fan(c, tp1[0], tp1[1], 8, act ? t * 4 : 0); fan(c, tp2[0], tp2[1], 8, act ? -t * 4.4 : 1); if (act) { const p = P(x + 1.0, y + 1.4, z + 8); c.fillStyle = 'rgba(190,240,255,' + (0.35 + 0.3 * Math.sin(t * 2)).toFixed(2) + ')'; c.beginPath(); c.arc(p[0], p[1] - 4, 3.6, 0, 7); c.fill(); } } },
  watertank: { top: 50, k: b => (b && b.water !== undefined ? Math.round(b.water / 80 * 4) : 0),
    s(c, x, y, s, z, b) {
      for (const [a, d] of [[0.45, 0.45], [1.55, 0.45], [0.45, 1.55], [1.55, 1.55]]) pole(c, x + a, y + d, z, 5, '#6e645c', 2);
      const top = cyl(c, x + 1, y + 1, 0.82, z + 4, 18, '#7ab0cc', '#a8d4ea', [0.33, 0.66]);
      const f = b && b.water !== undefined ? Math.round(b.water / 80 * 4) / 4 : 0; c.fillStyle = 'rgba(40,120,200,.7)'; c.beginPath(); c.ellipse(top[0], top[1], 30 * f, 15 * f, 0, 0, 7); c.fill();
      if (ARTV.lod > 1) { const l0 = P(x + 1.55, y + 1.6, z + 4); c.strokeStyle = 'rgba(60,50,45,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(l0[0] - 2, l0[1]); c.lineTo(l0[0] - 2, l0[1] - 18); c.moveTo(l0[0] + 2, l0[1]); c.lineTo(l0[0] + 2, l0[1] - 18); for (let k = 2; k < 18; k += 3) { c.moveTo(l0[0] - 2, l0[1] - k); c.lineTo(l0[0] + 2, l0[1] - k); } c.stroke(); }
    } },
  airtank: { top: 40,
    s(c, x, y, s, z) { for (const a of [0.28, 0.72]) pole(c, x + a, y + 0.5, z, 7, '#6e645c', 1.6); const tp = sphere(c, x + 0.5, y + 0.5, 0.42, z + 4, '#e8f2f6'); if (ARTV.lod > 0.8) { c.fillStyle = '#4fb3b0'; c.fillRect(tp[0] - 7, tp[1] + 9, 14, 2.4); } if (ARTV.lod > 1) { c.fillStyle = '#ff8a3a'; c.fillRect(tp[0] - 3, tp[1] - 1.5, 6, 3); } } },
  reclaimer: { top: 46,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      box(c, x + 0.15, y + 0.15, 0.85, 1.7, z, 13, '#a9b8b0', { seams: 2, win: { n: 2, at: 0.6, h: 2.4, both: false }, door: 0.5 });
      // two open settling pools
      for (const [a, d] of [[1.45, 0.6], [1.45, 1.4]]) { const p = P(x + a, y + d, z); c.fillStyle = '#7a8a8a'; c.beginPath(); c.ellipse(p[0], p[1], 13, 6.5, 0, 0, 7); c.fill(); c.fillStyle = '#4f8aa8'; c.beginPath(); c.ellipse(p[0], p[1] - 1.5, 10.5, 5, 0, 0, 7); c.fill(); if (ARTV.lod > 0.9) { c.strokeStyle = 'rgba(200,240,255,.4)'; c.lineWidth = 0.7; c.beginPath(); c.ellipse(p[0] - 2, p[1] - 2.5, 5, 2.2, 0, Math.PI, Math.PI * 1.8); c.stroke(); } }
      if (ARTV.lod > 0.8) pipe(c, [[x + 1.0, y + 0.6, z + 6], [x + 1.25, y + 0.6, z + 3]], '#78a8b8', 1.6);
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on) || ARTV.lod < 0.9) return; for (const [a, d] of [[1.45, 0.6], [1.45, 1.4]]) { const p = P(x + a, y + d, z), r = (t * 0.6 + a + d) % 1; c.strokeStyle = 'rgba(220,245,255,' + (0.5 * (1 - r)).toFixed(2) + ')'; c.lineWidth = 0.7; c.beginPath(); c.ellipse(p[0], p[1] - 1.5, 2 + r * 8, (2 + r * 8) * 0.48, 0, 0, 7); c.stroke(); } } },
  algae: { top: 48,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      // racks of glass photobioreactor tubes
      for (let r = 0; r < 2; r++) { const a = P(x + 0.25, y + 0.45 + r * 0.9, z), b2 = P(x + 1.75, y + 0.45 + r * 0.9, z); c.strokeStyle = '#6e645c'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(a[0], a[1] - 2); c.lineTo(b2[0], b2[1] - 2); c.moveTo(a[0], a[1] - 22); c.lineTo(b2[0], b2[1] - 22); c.stroke();
        for (let k = 0; k < 6; k++) { const q = P(x + 0.3 + k * 0.27, y + 0.45 + r * 0.9, z), gr = c.createLinearGradient(q[0] - 2.5, 0, q[0] + 2.5, 0); gr.addColorStop(0, '#9cf09c'); gr.addColorStop(0.5, '#5fbf6a'); gr.addColorStop(1, '#2f7a3a'); c.fillStyle = gr; c.fillRect(q[0] - 2.4, q[1] - 21, 4.8, 18); if (ARTV.lod > 1) { c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(q[0] - 1.6, q[1] - 20, 1, 16); } } }
      box(c, x + 1.6, y + 1.6, 0.3, 0.3, z, 8, '#8a8f94');
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on) || ARTV.lod < 0.9) return; c.fillStyle = 'rgba(230,255,220,.7)'; for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k += 2) { const q = P(x + 0.3 + k * 0.27, y + 0.45 + r * 0.9, z), ph = (t * 0.7 + k * 0.31 + r * 0.5) % 1; c.beginPath(); c.arc(q[0], q[1] - 4 - ph * 16, 0.9, 0, 7); c.fill(); } } },
  sinterer: { top: 56,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#6a5a4c'); box(c, x + 0.2, y + 0.2, 1.1, 1.3, z, 14, '#a8784e', { seams: 1 });
      const m = P(x + 0.75, y + 1.5, z + 6); c.fillStyle = '#3a2a20'; c.fillRect(m[0] - 4.5, m[1] - 5, 9, 6);
      cyl(c, x + 0.45, y + 0.45, 0.14, z + 14, 12, '#5e544c');
      box(c, x + 1.35, y + 0.3, 0.5, 1.5, z, 3, '#5e544c');
    },
    a(c, x, y, s, z, t, b, g) { const act = isOn(b, g) && b._out > 0, m = P(x + 0.75, y + 1.5, z + 6); if (act) { c.fillStyle = 'rgba(255,150,60,' + (0.7 + 0.3 * Math.sin(t * 4)).toFixed(2) + ')'; c.fillRect(m[0] - 4.5, m[1] - 5, 9, 6); if (ARTV.lod > 0.8) { c.fillStyle = 'rgba(255,190,90,.25)'; c.beginPath(); c.ellipse(m[0], m[1] + 2, 10, 4, 0, 0, 7); c.fill(); } const st = P(x + 0.45, y + 0.45, z + 26); steam(c, st[0], st[1], t, x + y * 2, '180,160,140', 0.7); }
      const sh = (t * 0.3) % 0.45; for (let k = 0; k < 3; k++) box(c, x + 1.45, y + 0.4 + ((k * 0.45 + (act ? sh : 0)) % 1.35), 0.3, 0.3, z + 3, 4, '#c9a27a', { edge: false }); } },
  oremine: { top: 62,
    s(c, x, y, s, z, b, g, col) {
      pad(c, x, y, s, z, '#5e544c');
      const b0 = P(x + 0.8, y + 0.8, z);
      c.strokeStyle = '#a89a8a'; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(b0[0] - 12, b0[1]); c.lineTo(b0[0] - 2, b0[1] - 40); c.lineTo(b0[0] + 10, b0[1]); c.stroke(); c.beginPath(); c.moveTo(b0[0] - 2, b0[1] - 40); c.lineTo(b0[0] + 18, b0[1] - 18); c.stroke();
      if (ARTV.lod > 0.9) { c.lineWidth = 1; c.beginPath(); c.moveTo(b0[0] - 9, b0[1] - 10); c.lineTo(b0[0] + 7, b0[1] - 10); c.moveTo(b0[0] - 6, b0[1] - 22); c.lineTo(b0[0] + 4, b0[1] - 22); c.stroke(); }
      c.strokeStyle = 'rgba(40,34,30,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(b0[0] - 2, b0[1] - 40); c.lineTo(b0[0] - 2, b0[1] - 4); c.stroke();
      c.fillStyle = '#2a2420'; c.beginPath(); c.ellipse(b0[0] - 2, b0[1] - 1, 6, 3, 0, 0, 7); c.fill();
      box(c, x + 1.1, y + 0.2, 0.7, 0.7, z, 9, '#b0a08c', { win: { n: 1, at: 0.55, h: 2.4 } });
      const pile = P(x + 1.4, y + 1.4, z); c.fillStyle = col || '#9aa4ad'; c.beginPath(); c.moveTo(pile[0] - 14, pile[1]); c.quadraticCurveTo(pile[0], pile[1] - 16, pile[0] + 14, pile[1]); c.closePath(); c.fill();
      if (ARTV.lod > 0.8) { c.fillStyle = 'rgba(255,255,255,.22)'; c.beginPath(); c.moveTo(pile[0] - 8, pile[1] - 4); c.quadraticCurveTo(pile[0] - 3, pile[1] - 12, pile[0] + 2, pile[1] - 8); c.fill(); c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.moveTo(pile[0] + 2, pile[1] - 7); c.quadraticCurveTo(pile[0] + 8, pile[1] - 6, pile[0] + 14, pile[1]); c.lineTo(pile[0] + 2, pile[1]); c.fill(); }
    },
    a(c, x, y, s, z, t, b, g) { const b0 = P(x + 0.8, y + 0.8, z), act = isOn(b, g) && b._out > 0; wheel(c, b0[0] - 2, b0[1] - 40, 5.5, act ? t * 4 : 0); if (act) steam(c, b0[0] + 1, b0[1] - 2, t, x + y, '170,150,130', 0.6); } },
  raremine: { top: 70,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#554c50');
      // a drill tower over a violet hopper, with a conveyor to the ore pile
      box(c, x + 0.25, y + 0.25, 0.8, 0.8, z, 6, '#7d7168');
      const b0 = P(x + 0.65, y + 0.65, z + 6); c.fillStyle = '#9a8d80'; c.fillRect(b0[0] - 4, b0[1] - 46, 2.2, 46); c.fillRect(b0[0] + 2, b0[1] - 46, 2.2, 46); if (ARTV.lod > 0.8) { c.strokeStyle = '#9a8d80'; c.lineWidth = 0.8; c.beginPath(); for (let k = 0; k < 6; k++) { c.moveTo(b0[0] - 3, b0[1] - k * 8); c.lineTo(b0[0] + 3, b0[1] - k * 8 - 8); } c.stroke(); }
      box(c, x + 0.45, y + 0.45, 0.4, 0.4, z + 50, 6, '#cfc2ae');
      const h = cyl(c, x + 1.45, y + 0.55, 0.3, z + 8, 12, '#8a7f9a', '#b6a6d8'); for (const a of [-1, 1]) { c.strokeStyle = '#6e645c'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(h[0] + a * 9, h[1] + 16); c.lineTo(h[0] + a * 9, h[1] + 26); c.stroke(); }
      pipe(c, [[x + 1.45, y + 0.8, z + 8], [x + 1.45, y + 1.3, z + 3]], '#5e544c', 2.4);
      const pile = P(x + 1.25, y + 1.5, z); c.fillStyle = '#b8a0f0'; c.beginPath(); c.moveTo(pile[0] - 13, pile[1]); c.quadraticCurveTo(pile[0], pile[1] - 14, pile[0] + 13, pile[1]); c.closePath(); c.fill();
      if (ARTV.lod > 0.8) for (let k = 0; k < 3; k++) crystal(c, [pile[0] - 6 + k * 6, pile[1] - 4 - (k % 2) * 3], 6, 2, '#cdb6ff');
    },
    a(c, x, y, s, z, t, b, g) { const b0 = P(x + 0.65, y + 0.65, z + 6), act = isOn(b, g) && b._out > 0, k = act ? (t * 0.5) % 1 : 0.3; c.fillStyle = ORANGE; c.fillRect(b0[0] - 1.5, b0[1] - 40 + k * 26, 3.5, 8); if (act) { glow(c, b0[0], b0[1], 12, '205,182,255', 0.35); steam(c, b0[0] + 3, b0[1] - 2, t, x + y, '190,170,200', 0.5); } } },
  automine: { top: 52,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#4f5458');
      // a squat robotic extractor: sealed housing, roof panel, sensor mast, conveyor to the pile
      box(c, x + 0.2, y + 0.25, 1.0, 1.1, z, 12, '#8a979f', { seams: 2, band: [0.8, 'rgba(79,224,255,.6)', 1.2] });
      const rp = [P(x + 0.25, y + 0.3, z + 15), P(x + 1.15, y + 0.3, z + 15), P(x + 1.15, y + 1.3, z + 12.5), P(x + 0.25, y + 1.3, z + 12.5)]; poly(c, rp, '#1d3150', '#a8b6c6', 0.6);
      pole(c, x + 1.05, y + 0.35, z + 12, 12, '#6f777c', 1.2);
      box(c, x + 1.2, y + 0.65, 0.6, 0.3, z + 3, 2, '#5e544c');
      const pile = P(x + 1.45, y + 1.45, z); c.fillStyle = '#9fb0bb'; c.beginPath(); c.moveTo(pile[0] - 13, pile[1]); c.quadraticCurveTo(pile[0], pile[1] - 14, pile[0] + 13, pile[1]); c.closePath(); c.fill();
    },
    a(c, x, y, s, z, t, b, g) { const p = P(x + 1.05, y + 0.35, z + 25); if (g && g.on) light(c, p[0], p[1], '#4fe0ff', t, 2); const arm = P(x + 1.4, y + 1.0, z + 6), a = isOn(b, g) && b._out > 0 ? Math.sin(t * 1.6) * 0.8 : 0; c.strokeStyle = '#e2b25a'; c.lineWidth = 2.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(arm[0], arm[1]); c.lineTo(arm[0] + 6, arm[1] - 10); c.lineTo(arm[0] + 6 + Math.cos(a) * 9, arm[1] - 10 + Math.sin(a) * 6 + 4); c.stroke(); c.lineCap = 'butt'; } },
  harvester: { top: 62,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#4f4744');
      // a cage of uprights around the growing crystal bed
      const p = P(x + 1, y + 1, z); c.fillStyle = '#3a2f3a'; c.beginPath(); c.ellipse(p[0], p[1], 22, 11, 0, 0, 7); c.fill();
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283, q = P(x + 1 + Math.cos(a) * 0.72, y + 1 + Math.sin(a) * 0.72, z); if (Math.sin(a) > 0.2) continue; c.strokeStyle = '#8a7f9a'; c.lineWidth = 2; c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(q[0], q[1] - 28); c.stroke(); }
      for (let k = 0; k < 5; k++) { const a = k * 1.3, r = 0.2 + (k % 3) * 0.17, q = P(x + 1 + Math.cos(a) * r, y + 1 + Math.sin(a) * r, z); crystal(c, q, 12 + (k % 3) * 6, 3.2, '#ff7ad9', (k % 2 ? 2 : -2)); }
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283, q = P(x + 1 + Math.cos(a) * 0.72, y + 1 + Math.sin(a) * 0.72, z); if (Math.sin(a) <= 0.2) continue; c.strokeStyle = '#a99cb8'; c.lineWidth = 2; c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(q[0], q[1] - 28); c.stroke(); }
      c.strokeStyle = '#a99cb8'; c.lineWidth = 1.6; c.beginPath(); c.ellipse(p[0], p[1] - 28, 23, 11.5, 0, 0, 7); c.stroke();
    },
    a(c, x, y, s, z, t, b, g) { const p = P(x + 1, y + 1, z); if (g && g.on) { glow(c, p[0], p[1] - 10, 26, '255,120,220', 0.28 + 0.1 * Math.sin(t * 2)); const a = t * 0.8, q = [p[0] + Math.cos(a) * 20, p[1] - 28 + Math.sin(a) * 10]; c.fillStyle = '#ffd36a'; c.fillRect(q[0] - 2, q[1] - 2, 4, 4); c.strokeStyle = 'rgba(60,50,60,.8)'; c.lineWidth = 0.7; c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(q[0] * 0.7 + p[0] * 0.3, q[1] + 12); c.stroke(); } } },
  works: { top: 66,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5a524c'); box(c, x + 0.2, y + 0.3, 2.6, 2.4, z, 16, '#c6b49c', { seams: 4, win: { n: 4, at: 0.45, h: 3.2 } });
      for (let k = 0; k < 4; k++) { const a = P(x + 0.3 + k * 0.62, y + 0.3, z + 16), bb = P(x + 0.3 + k * 0.62, y + 2.7, z + 16); c.fillStyle = k % 2 ? '#8a7a68' : '#a3937f'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[0] + 9, a[1] - 9); c.lineTo(bb[0] + 9, bb[1] - 9); c.lineTo(bb[0], bb[1]); c.closePath(); c.fill();
        if (ARTV.lod > 0.9) { c.fillStyle = ARTV.lit ? 'rgba(255,214,140,.55)' : 'rgba(150,200,230,.35)'; c.beginPath(); c.moveTo(a[0] + 9, a[1] - 9); c.lineTo(a[0] + 9, a[1] - 5); c.lineTo(bb[0] + 9, bb[1] - 5); c.lineTo(bb[0] + 9, bb[1] - 9); c.closePath(); c.fill(); } }
      cyl(c, x + 2.4, y + 0.6, 0.18, z + 16, 18, '#6b625b', null, [0.3, 0.7]);
      const d = P(x + 1.5, y + 2.7, z + 6); c.fillStyle = '#3a3028'; c.fillRect(d[0] - 6, d[1] - 6, 12, 6);
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on && b && b._act > 0)) return; const st = P(x + 2.4, y + 0.6, z + 34); steam(c, st[0], st[1], t, x + y, '150,140,130', 0.9); const d = P(x + 1.5, y + 2.7, z + 6); c.fillStyle = '#ffcc66'; c.fillRect(d[0] - 6, d[1] - 6, 12, 6); } },
  refinery: { top: 64,
    s(c, x, y, s, z) { pad(c, x, y, s, z); cyl(c, x + 0.5, y + 0.6, 0.3, z, 30, '#c8bcae', null, [0.2, 0.45, 0.7]); cyl(c, x + 1.3, y + 0.5, 0.3, z, 22, '#c8bcae', null, [0.35, 0.7]); box(c, x + 0.3, y + 1.1, 1.4, 0.7, z, 8, ORANGE, { seams: 2 });
      if (ARTV.lod > 0.9) { const p1 = P(x + 0.5, y + 0.9, z + 14), p2 = P(x + 1.3, y + 0.8, z + 10); c.strokeStyle = '#8a7d70'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p1[0], p1[1]); c.quadraticCurveTo((p1[0] + p2[0]) / 2, p1[1] - 6, p2[0], p2[1]); c.stroke(); }
      if (ARTV.lod > 0.7) { for (let k = 0; k < 4; k++) { const q = P(x + 0.5, y + 0.6, z + 6 + k * 6); c.strokeStyle = 'rgba(60,50,45,.6)'; c.lineWidth = 0.7; c.beginPath(); c.ellipse(q[0], q[1], 14, 7, 0, 0.2, Math.PI - 0.2); c.stroke(); } } },
    a(c, x, y, s, z, t, b, g) { const f = P(x + 0.5, y + 0.6, z + 34), act = !b || (g && g.on && b._act > 0), fl = act ? 0.6 + 0.3 * Math.sin(t * 8) + 0.1 * Math.sin(t * 23) : 0.15; c.strokeStyle = '#6b625b'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(f[0], f[1] + 4); c.lineTo(f[0], f[1]); c.stroke(); c.fillStyle = 'rgba(255,170,60,' + fl.toFixed(2) + ')'; c.beginPath(); c.moveTo(f[0] - 2.5, f[1]); c.quadraticCurveTo(f[0], f[1] - 9 * fl, f[0] + 2.5, f[1]); c.fill(); const s2 = P(x + 1.3, y + 0.5, z + 22); if (act) steam(c, s2[0], s2[1], t, x + y, '230,225,220', 0.6); } },
  polymer: { top: 70,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z); box(c, x + 0.2, y + 1.6, 2.6, 1.15, z, 12, '#b8c2b0', { seams: 4, win: { n: 4, at: 0.55, h: 2.6 }, door: 0.3 });
      // a pipe rack, three reactor vessels and a tall distillation column
      for (let k = 0; k < 3; k++) cyl(c, x + 0.55 + k * 0.8, y + 0.75, 0.32, z, 18, TEAL, '#8fe0d8', [0.3, 0.7]);
      if (ARTV.lod > 0.7) pipe(c, [[x + 0.55, y + 1.15, z + 14], [x + 2.15, y + 1.15, z + 14], [x + 2.6, y + 1.15, z + 14]], '#8a7d70', 2);
      const col = cyl(c, x + 2.6, y + 0.45, 0.2, z, 46, '#d8d0c4', null, [0.2, 0.4, 0.6, 0.8]); if (ARTV.lod > 0.9) { c.strokeStyle = '#8a7d70'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(col[0] + 7, col[1] + 46); c.lineTo(col[0] + 7, col[1]); c.stroke(); }
    },
    a(c, x, y, s, z, t, b, g) { const tp = P(x + 2.6, y + 0.45, z + 46); if (g && g.on) { light(c, tp[0], tp[1] - 2, '#ff5a3a', t, 1.6); if (b && b._act > 0) steam(c, tp[0], tp[1], t, x, '230,240,235', 0.5); } } },
  foundry: { top: 60,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5a5a5e'); box(c, x + 0.25, y + 0.3, 2.5, 2.4, z, 14, '#d8dee2', { seams: 5, band: [0.25, 'rgba(79,160,255,.7)', 1.4], door: 0.5 });
      // sawtooth clean-room roof with skylights and rooftop air handlers
      for (let k = 0; k < 4; k++) { const a = P(x + 0.35 + k * 0.6, y + 0.35, z + 14), bb = P(x + 0.35 + k * 0.6, y + 2.65, z + 14); c.fillStyle = '#c4ccd2'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[0] + 8, a[1] - 7); c.lineTo(bb[0] + 8, bb[1] - 7); c.lineTo(bb[0], bb[1]); c.closePath(); c.fill(); c.fillStyle = ARTV.lit ? 'rgba(150,200,255,.75)' : 'rgba(120,170,220,.45)'; c.beginPath(); c.moveTo(a[0] + 8, a[1] - 7); c.lineTo(a[0] + 8, a[1] - 3); c.lineTo(bb[0] + 8, bb[1] - 3); c.lineTo(bb[0] + 8, bb[1] - 7); c.closePath(); c.fill(); }
      box(c, x + 2.0, y + 2.0, 0.55, 0.55, z + 14, 5, '#aeb6bc'); box(c, x + 0.45, y + 2.0, 0.55, 0.55, z + 14, 5, '#aeb6bc');
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on)) return; for (let k = 0; k < 4; k++) { const p = P(x + 0.55 + k * 0.6, y + 2.7, z + 8); c.fillStyle = 'rgba(120,170,255,' + (0.6 + 0.4 * Math.sin(t * 2 + k)).toFixed(2) + ')'; c.fillRect(p[0] - 3, p[1] - 2, 6, 3); } if (ARTV.lod > 0.9) for (const [a, d] of [[2.27, 2.27], [0.72, 2.27]]) { const f = P(x + a, y + d, z + 19); fan(c, f[0], f[1], 5, t * 6 + a); } } },
  greenhouse: { top: 46,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#6a5d52');
      for (let r = 0; r < 3; r++) { const a = P(x + 0.15, y + r + 0.5, z), bb = P(x + 2.85, y + r + 0.5, z); c.fillStyle = 'rgba(110,190,90,.9)'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(bb[0], bb[1]); c.lineTo(bb[0], bb[1] - 4); c.lineTo(a[0], a[1] - 4); c.fill();
        if (ARTV.lod > 0.8) for (let k = 0; k < 8; k++) { const q = P(x + 0.3 + k * 0.33, y + r + 0.5, z + 4); c.fillStyle = k % 2 ? '#8fd46a' : '#5fa848'; c.beginPath(); c.arc(q[0], q[1] - 1.5, 2, 0, 7); c.fill(); } }
    },
    o(c, x, y, s, z) {
      for (let r = 0; r < 3; r++) { const a = P(x + 0.1, y + r + 0.5, z), bb = P(x + 2.9, y + r + 0.5, z); const g = c.createLinearGradient(0, a[1] - 18, 0, a[1]); g.addColorStop(0, 'rgba(220,250,255,.55)'); g.addColorStop(1, 'rgba(140,210,230,.25)');
        c.fillStyle = g; c.beginPath(); c.moveTo(a[0] - 10, a[1] + 5); c.quadraticCurveTo(a[0], a[1] - 22, a[0] + 10, a[1] - 5); c.lineTo(bb[0] + 10, bb[1] - 5); c.quadraticCurveTo(bb[0], bb[1] - 22, bb[0] - 10, bb[1] + 5); c.closePath(); c.fill(); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 0.6; c.stroke();
        if (ARTV.lod > 1.05) { c.strokeStyle = 'rgba(255,255,255,.22)'; c.beginPath(); for (let k = 1; k < 6; k++) { const q = P(x + 0.1 + k * 0.47, y + r + 0.5, z); c.moveTo(q[0] - 10, q[1] + 5); c.quadraticCurveTo(q[0], q[1] - 22, q[0] + 10, q[1] - 5); } c.stroke(); }
        if (ARTV.lit) { c.fillStyle = 'rgba(255,120,220,.14)'; c.fill(); } }
    } },
  bloomfarm: { top: 46,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5e5048');
      // raised planter beds under a mesh shade canopy
      for (let r = 0; r < 2; r++) box(c, x + 0.2, y + 0.25 + r * 0.85, 1.6, 0.6, z, 4, '#6a5446', { top: '#4a3a2e', edge: false });
      for (const [a, d] of [[0.15, 0.15], [1.85, 0.15], [0.15, 1.85], [1.85, 1.85]]) pole(c, x + a, y + d, z, 20, '#8a7d70', 1.4);
    },
    a(c, x, y, s, z, t, b, g) { const act = g && g.on; for (let r = 0; r < 2; r++) for (let k = 0; k < 5; k++) { const p = P(x + 0.35 + k * 0.32, y + 0.55 + r * 0.85, z + 4), sw = Math.sin(t * 1.2 + k + r) * 1.2; c.strokeStyle = '#7a9a5a'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + sw, p[1] - 6); c.stroke(); c.fillStyle = act ? 'rgba(225,245,185,.95)' : '#b8c49a'; c.beginPath(); c.arc(p[0] + sw, p[1] - 7, 2.6, 0, 7); c.fill(); if (act && ARTV.night > 0.3) glow(c, p[0] + sw, p[1] - 7, 8, '220,255,170', 0.4); } const q = [P(x + 0.15, y + 0.15, z + 20), P(x + 1.85, y + 0.15, z + 20), P(x + 1.85, y + 1.85, z + 20), P(x + 0.15, y + 1.85, z + 20)]; poly(c, q, 'rgba(210,200,180,.22)', 'rgba(230,220,200,.55)', 0.8); } },
  lab: { top: 56,
    s(c, x, y, s, z) { pad(c, x, y, s, z); box(c, x + 0.2, y + 0.3, 1.6, 1.4, z, 14, '#d9d2c6', { seams: 2, win: { n: 3, at: 0.5, h: 3 }, door: 0.25 }); const p = P(x + 1, y + 1, z + 14);
      c.fillStyle = '#c0d6e4'; c.beginPath(); c.ellipse(p[0], p[1], 18, 9, 0, Math.PI, 0); c.fill(); const dg = c.createRadialGradient(p[0] - 4, p[1] - 10, 1, p[0], p[1] - 4, 13); dg.addColorStop(0, '#f2f8fc'); dg.addColorStop(1, '#8fb0c6'); c.fillStyle = dg; c.beginPath(); c.arc(p[0], p[1] - 4, 12, Math.PI, 0); c.fill(); },
    a(c, x, y, s, z, t, b, g) { const p = P(x + 1, y + 1, z + 14); if (ARTV.lod > 0.8) { c.fillStyle = '#20262c'; c.save(); c.translate(p[0], p[1] - 10); c.rotate(-0.6 + Math.sin(t * 0.25) * 0.4); c.fillRect(-1.5, -9, 3, 9); c.restore(); } if (g && g.on) light(c, p[0] + 14, p[1] - 6, '#b48cff', t, 2); } },
  observatory: { top: 72,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      box(c, x + 0.25, y + 0.25, 1.5, 1.5, z, 10, '#cfc6b8', { seams: 2, win: { n: 2, at: 0.5, h: 2.4 }, door: 0.7 });
      // a white radome and a weather mast with an anemometer
      const r = sphere(c, x + 0.85, y + 0.85, 0.62, z + 10, '#f2eee8'); if (ARTV.lod > 0.9) { c.strokeStyle = 'rgba(0,0,0,.1)'; c.lineWidth = 0.6; c.beginPath(); c.ellipse(r[0], r[1] + 15, 14, 4, 0, 0, Math.PI * 2); c.moveTo(r[0], r[1]); c.lineTo(r[0], r[1] + 30); c.stroke(); }
      pole(c, x + 1.55, y + 1.45, z + 10, 30, '#9a8d80', 1.4);
    },
    a(c, x, y, s, z, t, b, g) { const tp = P(x + 1.55, y + 1.45, z + 40), a = t * (g && g.on ? 5 : 0.5); c.strokeStyle = '#d9cfc2'; c.lineWidth = 1; c.beginPath(); for (let k = 0; k < 3; k++) { const ang = a + k * 2.094, ex = tp[0] + Math.cos(ang) * 6, ey = tp[1] + Math.sin(ang) * 2.4; c.moveTo(tp[0], tp[1]); c.lineTo(ex, ey); } c.stroke(); c.fillStyle = '#e8ddd0'; for (let k = 0; k < 3; k++) { const ang = a + k * 2.094; c.beginPath(); c.arc(tp[0] + Math.cos(ang) * 6, tp[1] + Math.sin(ang) * 2.4, 1.5, 0, 7); c.fill(); } if (g && g.on) light(c, tp[0], tp[1] - 4, '#ff4a3a', t, 1.4); } },
  institute: { top: 92,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z);
      box(c, x + 0.25, y + 0.25, 2.5, 2.5, z, 12, '#d6cdbd', { seams: 5, win: { n: 5, at: 0.5, h: 2.6 }, door: 0.5 });
      box(c, x + 0.7, y + 0.7, 1.6, 1.6, z + 12, 18, '#e8e1d4', { seams: 3, win: { n: 3, at: 0.5, h: 3 } });
      // the deep shaft head: a ring gantry on the roof with an elevator tower
      const p = P(x + 1.5, y + 1.5, z + 30); c.fillStyle = '#2a2622'; c.beginPath(); c.ellipse(p[0], p[1], 15, 7.5, 0, 0, 7); c.fill(); c.strokeStyle = '#b48cff'; c.lineWidth = 1.6; c.stroke();
      for (const a of [-1, 1]) { c.fillStyle = '#9a8d80'; c.fillRect(p[0] + a * 12 - 1.5, p[1] - 30, 3, 30); }
      c.fillStyle = '#cfc2ae'; c.fillRect(p[0] - 14, p[1] - 33, 28, 4);
    },
    a(c, x, y, s, z, t, b, g) { const p = P(x + 1.5, y + 1.5, z + 30); if (g && g.on) { glow(c, p[0], p[1], 18, '180,140,255', 0.35); c.strokeStyle = 'rgba(180,140,255,.8)'; c.lineWidth = 1.4; for (let k = 0; k < 2; k++) { c.beginPath(); c.ellipse(p[0], p[1] - 12 - k * 8, 18 + k * 5, 6 + k * 2, Math.sin(t * 0.5 + k) * 0.25, 0, 7); c.stroke(); } } const k = (Math.sin(t * 0.4) + 1) / 2; c.fillStyle = '#ffd36a'; c.fillRect(p[0] - 4, p[1] - 29 + k * 22, 8, 5); } },
  mirror: { top: 80,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5a524c'); box(c, x + 0.3, y + 2.0, 2.4, 0.75, z, 10, '#cfc6b8', { seams: 3, win: { n: 4, at: 0.5, h: 2.4, both: false }, door: 0.8 });
      const p = P(x + 1.4, y + 1.2, z); for (const [dx, dy] of [[-14, 0], [12, 3], [0, -6]]) { c.strokeStyle = '#a89a8a'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(p[0] + dx, p[1] + dy); c.lineTo(p[0], p[1] - 30); c.stroke(); }
      c.save(); c.translate(p[0], p[1] - 40); c.rotate(-0.45);
      const g = c.createLinearGradient(-28, 0, 28, 0); g.addColorStop(0, '#9fb7d0'); g.addColorStop(0.5, '#f4fbff'); g.addColorStop(1, '#7f97b0');
      c.fillStyle = '#5d6b7a'; c.beginPath(); c.ellipse(0, 2, 28, 10, 0, 0, 7); c.fill(); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 27, 9, 0, 0, 7); c.fill();
      if (ARTV.lod > 0.8) { c.strokeStyle = 'rgba(80,100,120,.4)'; c.lineWidth = 0.6; c.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI; c.moveTo(0, 0); c.lineTo(Math.cos(a) * 27, Math.sin(a) * 9); c.moveTo(0, 0); c.lineTo(-Math.cos(a) * 27, -Math.sin(a) * 9); } c.stroke(); }
      c.restore();
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on)) return; const p = P(x + 1.4, y + 1.2, z); c.strokeStyle = 'rgba(255,240,200,' + (0.25 + 0.2 * Math.sin(t * 1.5)).toFixed(2) + ')'; c.lineWidth = 2; c.beginPath(); c.moveTo(p[0] + 6, p[1] - 46); c.lineTo(p[0] + 30, p[1] - 140); c.stroke(); } },
  array: { top: 64,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#4f4744');
      const m = P(x + 1.5, y + 1.5, z); c.fillStyle = '#2a3036'; c.beginPath(); c.ellipse(m[0], m[1], 30, 15, 0, 0, 7); c.fill(); c.fillStyle = '#1f5a58'; c.beginPath(); c.ellipse(m[0], m[1] - 1, 25, 12.5, 0, 0, 7); c.fill();
      // obelisks with crystal tips around the pool (back half; the front half is drawn over)
      for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (Math.sin(a) > 0) continue; const px = x + 1.5 + Math.cos(a) * 1.15, py = y + 1.5 + Math.sin(a) * 1.15; box(c, px - 0.1, py - 0.1, 0.2, 0.2, z, 24 + (k % 2) * 8, '#3a3a44', { edge: false }); }
    },
    o(c, x, y, s, z) { for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; if (Math.sin(a) <= 0) continue; const px = x + 1.5 + Math.cos(a) * 1.15, py = y + 1.5 + Math.sin(a) * 1.15; box(c, px - 0.1, py - 0.1, 0.2, 0.2, z, 24 + (k % 2) * 8, '#3a3a44', { edge: false }); } },
    a(c, x, y, s, z, t, b, g) { const act = g && g.on, m = P(x + 1.5, y + 1.5, z); for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283, tp = P(x + 1.5 + Math.cos(a) * 1.15, y + 1.5 + Math.sin(a) * 1.15, z + 26 + (k % 2) * 8); c.fillStyle = act ? 'rgba(120,255,230,' + (0.5 + 0.4 * Math.sin(t * 2 + k)).toFixed(2) + ')' : '#4a6a68'; c.beginPath(); c.moveTo(tp[0], tp[1] - 6); c.lineTo(tp[0] + 2.5, tp[1]); c.lineTo(tp[0], tp[1] + 2); c.lineTo(tp[0] - 2.5, tp[1]); c.fill(); }
      if (!act) return; glow(c, m[0], m[1] - 4, 28, '140,255,230', 0.5); const ph = (t % 2) / 2; c.strokeStyle = 'rgba(140,255,230,' + (0.5 * (1 - ph)).toFixed(2) + ')'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(m[0], m[1] - 1, 6 + ph * 28, 3 + ph * 14, 0, 0, 7); c.stroke(); } },
  vault: { top: 56,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#4f4a48');
      // an earth-bermed bunker with a glass roof over rows of cryo pods
      const q = (a, b, h) => P(x + a, y + b, z + h);
      poly(c, [q(0.2, 2.8, 0), q(2.8, 2.8, 0), q(2.6, 2.55, 10), q(0.4, 2.55, 10)], '#7a5a44'); poly(c, [q(2.8, 0.2, 0), q(2.8, 2.8, 0), q(2.55, 2.6, 10), q(2.55, 0.4, 10)], '#5a4232');
      box(c, x + 0.4, y + 0.4, 2.15, 2.15, z, 10, '#bfc6cc', { edge: false });
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { const p = q(0.65 + k * 0.5, 0.75 + r * 0.6, 10); c.fillStyle = '#dfe8ee'; c.beginPath(); c.ellipse(p[0], p[1], 6, 3, 0.46, 0, 7); c.fill(); c.fillStyle = '#7fc8e8'; c.beginPath(); c.ellipse(p[0], p[1] - 0.8, 4, 1.8, 0.46, 0, 7); c.fill(); }
      poly(c, [q(0.4, 0.4, 16), q(2.55, 0.4, 16), q(2.55, 2.55, 12), q(0.4, 2.55, 12)], 'rgba(170,220,240,.28)', 'rgba(230,245,255,.6)', 0.8);
      const m = q(1.5, 2.8, 0); c.fillStyle = '#3a3a40'; c.fillRect(m[0] - 7, m[1] - 7, 14, 7);
    },
    a(c, x, y, s, z, t, b, g) { const m = P(x + 1.5, y + 2.8, z); if (g && g.on) { c.fillStyle = 'rgba(159,224,255,' + (0.7 + 0.3 * Math.sin(t)).toFixed(2) + ')'; c.fillRect(m[0] - 6, m[1] - 6, 12, 1.6); const p = P(x + 1.5, y + 1.5, z + 12); glow(c, p[0], p[1], 30, '160,220,255', 0.18 + 0.08 * Math.sin(t * 1.2)); } } }
};
// ---------- Reshaping Kessa ----------
Object.assign(ART, {
  hazeforge: { top: 96,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5e544c');
      box(c, x + 0.2, y + 1.3, 2.6, 1.45, z, 14, '#8a6a58', { seams: 4, win: { n: 4, at: 0.6, h: 2.4 }, door: 0.25, band: [0.3, 'rgba(232,138,60,.75)', 1.4] });
      // three kiln stacks, tallest at the back, ringed with heat bands
      for (const [a, d, h] of [[0.6, 0.6, 62], [1.5, 0.5, 70], [2.4, 0.7, 56]]) { cyl(c, x + a, y + d, 0.3, z, h, '#5a504a', '#3a3230', [0.2, 0.5, 0.8]); if (ARTV.lod > 0.7) { const q = P(x + a, y + d, z + h * 0.82); c.strokeStyle = ORANGE; c.lineWidth = 1.6; c.beginPath(); c.ellipse(q[0], q[1], 13.6, 6.8, 0, 0, Math.PI); c.stroke(); } }
      if (ARTV.lod > 0.8) pipe(c, [[x + 0.6, y + 0.9, z + 10], [x + 0.6, y + 1.3, z + 10]], '#6b625b', 2.2), pipe(c, [[x + 2.4, y + 1.0, z + 10], [x + 2.4, y + 1.3, z + 10]], '#6b625b', 2.2);
      const m = P(x + 1.5, y + 2.75, z + 6); c.fillStyle = '#2a201a'; c.fillRect(m[0] - 9, m[1] - 6, 18, 6);
    },
    a(c, x, y, s, z, t, b, g) {
      if (!(g && g.on)) return; const m = P(x + 1.5, y + 2.75, z + 6); c.fillStyle = 'rgba(255,150,60,' + (0.75 + 0.25 * Math.sin(t * 3)).toFixed(2) + ')'; c.fillRect(m[0] - 8, m[1] - 5, 16, 4.5); glow(c, m[0], m[1] - 2, 16, '255,140,60', 0.4);
      if (ARTV.lod < 0.5) return;
      // thick ochre haze rolls out of the stacks and climbs high
      for (const [a, d, h, sd] of [[0.6, 0.6, 62, 1], [1.5, 0.5, 70, 2], [2.4, 0.7, 56, 3]]) { const q = P(x + a, y + d, z + h); for (let k = 0; k < 4; k++) { const ph = (t * 0.12 + k / 4 + sd * 0.29) % 1, al = 0.34 * (1 - ph) * Math.min(1, ph * 6); c.fillStyle = 'rgba(214,160,104,' + al.toFixed(3) + ')'; c.beginPath(); c.arc(q[0] + Math.sin(ph * 2 + sd) * 6 + ph * 26, q[1] - ph * 70, 5 + ph * 18, 0, 7); c.fill(); } }
    } },
  lichen: { top: 64,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5e5a48');
      cyl(c, x + 0.75, y + 1.15, 0.5, z, 16, '#6a9a6a', '#8fc48a', [0.3, 0.7]); box(c, x + 1.3, y + 0.25, 0.5, 0.55, z, 8, '#c4b8a6', { win: { n: 1, at: 0.5, h: 2 } });
      pole(c, x + 0.75, y + 1.15, z + 16, 24, '#9a8d80', 2); if (ARTV.lod > 0.8) pipe(c, [[x + 1.15, y + 1.15, z + 4], [x + 1.45, y + 0.8, z + 4]], '#78a8b8', 1.6);
    },
    a(c, x, y, s, z, t, b, g) { const p = P(x + 0.75, y + 1.15, z + 40), act = g && g.on, a = act ? t * 0.8 : 0.4, ex = p[0] + Math.cos(a) * 20, ey = p[1] + Math.sin(a) * 8; c.strokeStyle = '#d8cdbd'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(ex, ey); c.stroke(); c.fillStyle = '#9a8d80'; c.beginPath(); c.arc(p[0], p[1], 2.4, 0, 7); c.fill();
      if (act && ARTV.lod > 0.55) for (let k = 0; k < 4; k++) { const ph = (t * 0.5 + k / 4) % 1; c.fillStyle = 'rgba(170,220,120,' + (0.35 * (1 - ph)).toFixed(3) + ')'; c.beginPath(); c.arc(ex + ph * 14, ey + ph * 8 - ph * 6, 2 + ph * 7, 0, 7); c.fill(); } } },
  seedvault: { top: 62,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5a524c');
      // an earth-covered archive mound with a concrete portal and a glass growing house on top
      const q = (a, b, h) => P(x + a, y + b, z + h); const mg = c.createLinearGradient(0, q(1.5, 1.5, 22)[1], 0, q(1.5, 2.9, 0)[1]); mg.addColorStop(0, '#8a7a52'); mg.addColorStop(1, '#5a4a36');
      c.fillStyle = mg; c.beginPath(); const m0 = q(0.2, 2.8, 0), m1 = q(2.8, 2.8, 0), m2 = q(2.8, 0.2, 0); c.moveTo(m0[0], m0[1]); c.quadraticCurveTo(q(0.6, 0.6, 30)[0], q(0.6, 0.6, 30)[1], m2[0], m2[1]); c.lineTo(m1[0], m1[1]); c.closePath(); c.fill();
      if (ARTV.lod > 0.8) { c.fillStyle = 'rgba(120,150,70,.55)'; for (let k = 0; k < 9; k++) { const p = q(0.8 + (k % 3) * 0.6, 1.0 + ((k / 3) | 0) * 0.55, 14); c.beginPath(); c.ellipse(p[0], p[1], 6, 2.6, 0, 0, 7); c.fill(); } }
      box(c, x + 1.15, y + 2.3, 0.7, 0.55, z, 12, '#c9c2b6', { door: 0.5 }); poly(c, [q(1.1, 2.3, 12), q(1.9, 2.3, 12), q(1.9, 2.85, 16), q(1.1, 2.85, 16)], '#d8d2c6');
      const gp = P(x + 1.3, y + 1.1, z + 18); c.fillStyle = 'rgba(160,220,200,.45)'; c.beginPath(); c.ellipse(gp[0], gp[1], 16, 8, 0, Math.PI, 0); c.bezierCurveTo(gp[0] + 16, gp[1] - 14, gp[0] - 16, gp[1] - 14, gp[0] - 16, gp[1]); c.fill(); c.strokeStyle = 'rgba(240,250,255,.6)'; c.lineWidth = 0.8; c.stroke();
      if (ARTV.lod > 0.8) { c.fillStyle = '#6fbf5a'; for (let k = -2; k <= 2; k++) { c.beginPath(); c.arc(gp[0] + k * 5, gp[1] - 3, 2.2, 0, 7); c.fill(); } }
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on)) return; const d = P(x + 1.5, y + 2.85, z + 3); c.fillStyle = 'rgba(160,255,190,' + (0.6 + 0.3 * Math.sin(t)).toFixed(2) + ')'; c.fillRect(d[0] - 3, d[1] - 6, 6, 1.5); if (ARTV.night > 0.3) glow(c, d[0], d[1] - 6, 14, '160,255,190', 0.4); } },
  lodestone: { top: 110,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#4f4a48');
      box(c, x + 0.2, y + 2.1, 1.1, 0.7, z, 10, '#bfc6cc', { win: { n: 2, at: 0.5, h: 2.4 }, door: 0.5 });
      // two pylons hold a great upright ring of superconducting coil
      const cx = isoX(x + 1.6, y + 1.4), cy = isoY(x + 1.6, y + 1.4, z) - 50;
      for (const sx of [-1, 1]) { c.fillStyle = '#6f777c'; c.beginPath(); c.moveTo(cx + sx * 30, cy + 54); c.lineTo(cx + sx * 36, cy + 54); c.lineTo(cx + sx * 40, cy + 6); c.lineTo(cx + sx * 34, cy + 6); c.fill(); }
      c.lineWidth = 9; c.strokeStyle = '#7a4a2a'; c.beginPath(); c.ellipse(cx, cy, 42, 40, 0.5, 0, 7); c.stroke();
      c.lineWidth = 6; c.strokeStyle = '#c58b4e'; c.beginPath(); c.ellipse(cx, cy, 42, 40, 0.5, 0, 7); c.stroke();
      if (ARTV.lod > 0.8) { c.lineWidth = 1; c.strokeStyle = 'rgba(255,220,170,.55)'; c.beginPath(); c.ellipse(cx, cy, 42, 40, 0.5, Math.PI * 1.05, Math.PI * 1.6); c.stroke(); c.strokeStyle = 'rgba(60,30,10,.4)'; c.beginPath(); for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, ca = Math.cos(a), sa = Math.sin(a), rx = ca * 42 * Math.cos(0.5) - sa * 40 * Math.sin(0.5), ry = ca * 42 * Math.sin(0.5) + sa * 40 * Math.cos(0.5); c.moveTo(cx + rx * 0.9, cy + ry * 0.9); c.lineTo(cx + rx * 1.1, cy + ry * 1.1); } c.stroke(); }
    },
    a(c, x, y, s, z, t, b, g) { if (!(g && g.on)) return; const cx = isoX(x + 1.6, y + 1.4), cy = isoY(x + 1.6, y + 1.4, z) - 50; glow(c, cx, cy, 34, '120,200,255', 0.22 + 0.08 * Math.sin(t * 2));
      c.strokeStyle = 'rgba(140,210,255,.55)'; c.lineWidth = 1.2; for (let k = 0; k < 3; k++) { const ph = (t * 0.4 + k / 3) % 1; c.beginPath(); c.ellipse(cx, cy, 14 + ph * 26, 40 + ph * 30, 0.5, 0, 7); c.globalAlpha = 1 - ph; c.stroke(); } c.globalAlpha = 1;
      if (Math.sin(t * 7) > 0.7) { const a = t * 3, px = cx + Math.cos(a) * 42 * 0.88, py = cy + Math.sin(a) * 40 * 0.88; c.strokeStyle = '#dff4ff'; c.lineWidth = 1; c.beginPath(); c.moveTo(px, py); c.lineTo(px + 5, py - 6); c.lineTo(px + 1, py - 9); c.stroke(); } } },
  fieldfarm: { top: 40,
    s(c, x, y, s, z) {
      // furrowed rows of crops in the open, alternating green and gold, a pivot tower in the middle and a shed
      poly(c, [P(x + 0.05, y + 0.05, z), P(x + s - 0.05, y + 0.05, z), P(x + s - 0.05, y + s - 0.05, z), P(x + 0.05, y + s - 0.05, z)], '#6a4e38');
      for (let r = 0; r < 9; r++) { const y0 = y + 0.15 + r * 0.31, col = r % 3 === 2 ? '#c8a848' : r % 2 ? '#5f9a44' : '#78b050'; poly(c, [P(x + 0.15, y0, z + 1.5), P(x + s - 0.15, y0, z + 1.5), P(x + s - 0.15, y0 + 0.2, z + 1.5), P(x + 0.15, y0 + 0.2, z + 1.5)], col);
        if (ARTV.lod > 1) { c.fillStyle = 'rgba(255,255,220,.18)'; for (let k = 0; k < 9; k++) { const q = P(x + 0.3 + k * 0.29, y0 + 0.1, z + 2.5); c.fillRect(q[0] - 1, q[1] - 1, 2, 1.4); } } }
      cyl(c, x + 1.5, y + 1.5, 0.12, z, 12, '#9a9088'); box(c, x + 2.35, y + 2.35, 0.5, 0.5, z, 8, '#b08a62', { door: 0.5 });
    },
    a(c, x, y, s, z, t, b, g) { const a = (g && g.on ? t * 0.12 : 0.3) + (b ? b.id : 0), p = P(x + 1.5, y + 1.5, z + 11), L = 1.35, e = P(x + 1.5 + Math.cos(a) * L, y + 1.5 + Math.sin(a) * L, z + 8);
      c.strokeStyle = '#d8d2c6'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(e[0], e[1]); c.stroke(); for (let k = 1; k <= 3; k++) { const q = [p[0] + (e[0] - p[0]) * k / 3, p[1] + (e[1] - p[1]) * k / 3]; c.strokeStyle = '#6b625b'; c.lineWidth = 1; c.beginPath(); c.moveTo(q[0], q[1]); c.lineTo(q[0], q[1] + 7); c.stroke(); if (g && g.on && ARTV.lod > 0.7) { c.fillStyle = 'rgba(170,215,255,.35)'; c.beginPath(); c.ellipse(q[0], q[1] + 8, 4, 1.6, 0, 0, 7); c.fill(); } } } }
});
