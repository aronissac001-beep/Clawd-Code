// ===== art2.js : domes, construction sites, damage states, vehicles, rockets, people, and the sprite cache =====
const MOD_COL = { quarters: '#d8c4a8', apartments: '#cbb79c', suites: '#e6d6bd', nursery: '#f0c8c0', canteen: '#e8a560', lounge: '#b48cff', gym: '#7fb4ff', arboretum: '#6fbf5a', market: '#e8c25a', arcade: '#ff7ad9', clinic: '#ff8a8a', medcenter: '#ff9a9a', school: '#ffd27a', security: '#7fa0c0', spa: '#7fd0d0', hydro: '#7fdc6a', vfarm: '#6fcc5a', labmod: '#c0a8ff', workshop: '#c8a070' };
const SUIT = ['#ffd27a', '#7fd0ff', '#ff9a8a', '#c0ff9a', '#e8d0ff', '#ffb36a'];
// a person in a pressure suit (outside) or work clothes (inside): body, helmet or head, a shadow
function figure(c, x, y, col, big, step, suit) {
  const s = big ? 1.25 : 1;
  c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.ellipse(x, y, 2.4 * s, 1 * s, 0, 0, 7); c.fill();
  c.fillStyle = shade(col, -0.35); c.fillRect(x - 1.1 * s, y - 2.6 * s - step * 0.3, 0.9 * s, 2.6 * s); c.fillRect(x + 0.2 * s, y - 2.6 * s + step * 0.3, 0.9 * s, 2.6 * s);
  c.fillStyle = col; c.fillRect(x - 1.4 * s, y - 6 * s - step, 2.8 * s, 3.6 * s);
  if (suit) { c.fillStyle = '#8a7d70'; c.fillRect(x + 0.9 * s, y - 5.6 * s - step, 1.1 * s, 2.6 * s); c.fillStyle = '#e8eef2'; c.beginPath(); c.arc(x, y - 7.4 * s - step, 1.7 * s, 0, 7); c.fill(); c.fillStyle = '#3a5a78'; c.fillRect(x - 1.2 * s, y - 7.8 * s - step, 1.8 * s, 0.9 * s); }
  else { c.fillStyle = '#f0d2b4'; c.beginPath(); c.arc(x, y - 7.2 * s - step, 1.4 * s, 0, 7); c.fill(); }
}
// ---------- domes ----------
const DOME_ART = {
  topOf: S => S * 19 + 30,
  k: (b, g) => (g && g.mods ? g.mods.map(m => m.t + (m.built ? 1 : 0)).join(',') : ''),
  s(c, x, y, S, z, b, g) {
    const cx = x + S / 2, cy = y + S / 2, p = P(cx, cy, z), rx = S * TW * 0.47, ry = S * TH * 0.47;
    // ring foundation with two airlock tubes
    for (const [a, d] of [[S * 0.5, S + 0.15], [S + 0.15, S * 0.5]]) { box(c, x + a - 0.32, y + d - 0.5, 0.64, 0.64, z, 6, '#a89580'); if (ARTV.lod > 0.8) { const q = P(x + a, y + d + 0.14, z + 2); c.fillStyle = '#3a3430'; c.fillRect(q[0] - 2.5, q[1] - 4, 5, 4); } }
    c.fillStyle = '#6a5a4c'; c.beginPath(); c.ellipse(p[0], p[1] + 1, rx + 5, ry + 2.6, 0, 0, 7); c.fill();
    c.fillStyle = '#b3a08a'; c.beginPath(); c.ellipse(p[0], p[1] - 2, rx + 2, ry + 1, 0, 0, 7); c.fill();
    // interior floor: lawn, paving ring and a central plaza
    c.fillStyle = '#6f8a5a'; c.beginPath(); c.ellipse(p[0], p[1] - 3, rx - 2, ry - 1, 0, 0, 7); c.fill();
    c.strokeStyle = '#c9b89c'; c.lineWidth = Math.max(2, S * 0.9); c.beginPath(); c.ellipse(p[0], p[1] - 3, rx * 0.56, ry * 0.56, 0, 0, 7); c.stroke();
    c.fillStyle = '#d4c4a6'; c.beginPath(); c.ellipse(p[0], p[1] - 3, rx * 0.18, ry * 0.18, 0, 0, 7); c.fill();
    if (ARTV.lod > 1) { c.strokeStyle = 'rgba(201,184,156,.8)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(p[0] - rx * 0.9, p[1] - 3); c.lineTo(p[0] + rx * 0.9, p[1] - 3); c.moveTo(p[0], p[1] - 3 - ry * 0.9); c.lineTo(p[0], p[1] - 3 + ry * 0.9); c.stroke(); }
    if (ARTV.lod < 0.75) return;
    const mods = (g && g.mods) || [], n = Math.max(mods.length, 1), items = [];
    mods.forEach((m, i) => { const a = -Math.PI * 0.75 + (i / n) * Math.PI * 2; items.push({ d: Math.sin(a) + Math.cos(a), m, mx: cx + Math.cos(a) * S * 0.3, my: cy + Math.sin(a) * S * 0.3 }); });
    for (let k = 0; k < Math.min(10, S * 2); k++) { const a = k * 2.4 + 0.7, r = S * (0.38 + (k % 2) * 0.05); items.push({ d: Math.sin(a) + Math.cos(a) - 0.01, tree: true, mx: cx + Math.cos(a) * r, my: cy + Math.sin(a) * r, k }); }
    items.sort((u, v) => u.d - v.d);
    for (const it of items) {
      if (it.tree) { const tp = P(it.mx, it.my, z + 3); c.fillStyle = '#5a4030'; c.fillRect(tp[0] - 0.7, tp[1] - 4, 1.4, 4); c.fillStyle = it.k % 3 ? '#4f8a3a' : '#6aa04a'; c.beginPath(); c.arc(tp[0], tp[1] - 7, 4.2, 0, 7); c.fill(); if (ARTV.lod > 1) { c.fillStyle = 'rgba(255,255,220,.25)'; c.beginPath(); c.arc(tp[0] - 1.4, tp[1] - 8.4, 1.8, 0, 7); c.fill(); } continue; }
      const m = it.m, built = m.built, h = built ? 8 + (MODULES[m.t] && MODULES[m.t].housing ? 7 : 0) : 3, col = built ? (MOD_COL[m.t] || '#c9bba8') : '#6a5a4a';
      box(c, it.mx - 0.32, it.my - 0.32, 0.64, 0.64, z + 3, h, col, { win: built && ARTV.lod > 1 ? { n: 2, at: 0.55, h: 2 } : null, top: built ? shade(col, 0.3) : null });
      if (built && ARTV.lod > 1.1) { const rf = P(it.mx, it.my, z + 3 + h); c.fillStyle = shade(col, -0.2); c.fillRect(rf[0] - 2.5, rf[1] - 2.5, 5, 2.5); }
      if (!built) { const q = P(it.mx, it.my, z + 3); c.strokeStyle = 'rgba(230,200,150,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(q[0] - 8, q[1]); c.lineTo(q[0] - 8, q[1] - 12); c.moveTo(q[0] + 8, q[1]); c.lineTo(q[0] + 8, q[1] - 12); c.stroke(); }
    }
  },
  a(c, x, y, S, z, t, b, g) {
    if (ARTV.lod < 0.75) return;
    const cx = x + S / 2, cy = y + S / 2, big = ARTV.lod > 1.2, pop = Math.min(big ? 24 : 14, (g && g.pop) || 0);
    for (let k = 0; k < pop; k++) {
      const a = t * 0.12 * (k % 2 ? 1 : -1) + k * 1.7, r = S * (k % 3 ? 0.17 : 0.4), cp = P(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.98, z + 3), step = Math.abs(Math.sin(t * 6 + k)) * 0.8;
      figure(c, cp[0], cp[1], SUIT[k % SUIT.length], big, step, false);
    }
  },
  o(c, x, y, S, z, b, g) {
    const cx = x + S / 2, cy = y + S / 2, p = P(cx, cy, z), rx = S * TW * 0.47, ry = S * TH * 0.47, h = S * 17, clear = ARTV.lod >= 0.75;
    const gr = c.createRadialGradient(p[0] - rx * 0.35, p[1] - h * 0.9, 4, p[0], p[1] - h * 0.3, rx * 1.1);
    gr.addColorStop(0, 'rgba(255,255,255,' + (clear ? 0.5 : 0.6) + ')'); gr.addColorStop(0.35, 'rgba(170,220,240,' + (clear ? 0.12 : 0.3) + ')'); gr.addColorStop(1, 'rgba(90,150,180,' + (clear ? 0.3 : 0.5) + ')');
    c.fillStyle = gr; c.beginPath(); c.ellipse(p[0], p[1] - 3, rx, ry, 0, 0, Math.PI); c.bezierCurveTo(p[0] - rx, p[1] - h * 1.4, p[0] + rx, p[1] - h * 1.4, p[0] + rx, p[1] - 3); c.fill();
    if (ARTV.lit) { c.fillStyle = 'rgba(255,220,150,.16)'; c.fill(); }
    // geodesic frame: latitude rings and meridians, finer at close zoom
    c.strokeStyle = 'rgba(230,245,255,.5)'; c.lineWidth = ARTV.lod > 1.2 ? 0.8 : 1;
    const nl = ARTV.lod > 1.2 ? 5 : 3;
    for (let k = 1; k <= nl; k++) { const f = k / (nl + 1); c.beginPath(); c.ellipse(p[0], p[1] - 3 - h * f * 0.95, rx * Math.sqrt(1 - f * f), ry * Math.sqrt(1 - f * f) * 0.6, 0, Math.PI, 0, true); c.stroke(); }
    c.beginPath(); for (const m of ARTV.lod > 1.2 ? [-0.8, -0.5, -0.2, 0.2, 0.5, 0.8] : [-0.55, 0.55]) { c.moveTo(p[0], p[1] - 3 - h * 1.04); c.quadraticCurveTo(p[0] + rx * m * 1.05, p[1] - h * 0.6, p[0] + rx * m, p[1] + ry * Math.sqrt(1 - m * m) * 0.95); } c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 2; c.beginPath(); c.ellipse(p[0], p[1] - h * 0.45, rx * 0.72, h * 0.62, 0, Math.PI * 1.15, Math.PI * 1.4); c.stroke();
    if (b && (b.broken || b.wear >= 100)) { c.strokeStyle = 'rgba(255,90,70,.85)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(p[0] - rx * 0.2, p[1] - h * 0.8); c.lineTo(p[0] - rx * 0.05, p[1] - h * 0.55); c.lineTo(p[0] - rx * 0.25, p[1] - h * 0.4); c.moveTo(p[0] - rx * 0.05, p[1] - h * 0.55); c.lineTo(p[0] + rx * 0.12, p[1] - h * 0.5); c.stroke(); }
  }
};
// ---------- states ----------
const TINT = { broken: 'rgba(40,22,16,.45)', off: 'rgba(72,74,82,.5)', nopower: 'rgba(18,24,46,.32)', site: 'rgba(222,196,150,.4)' };
function buildingState(b) { if (!b.built) return 'site'; if (b.broken) return 'broken'; if (b.on === false) return 'off'; if (b._pf !== undefined && b._pf <= 0.4) return 'nopower'; return 'ok'; }
function artOf(t) { const d = BUILDINGS[t]; return d && d.dome ? DOME_ART : ART[t]; }
function artTop(A, S) { return A.topOf ? A.topOf(S) : (A.top || 64); }
// ---------- the sprite cache: static layers drawn once per zoom bucket, state and key ----------
const SPR = { map: new Map(), px: 0, budget: 20e6, dpr: 1, made: 0 };
function sprBucket(z) { return z < 0.6 ? 0.6 : z < 0.95 ? 0.95 : z < 1.5 ? 1.5 : z < 2.2 ? 2.2 : 0; }
function spriteFor(A, b, S, layer, state, g, lod) {
  const key = b.t + '|' + S + '|' + layer + '|' + state + '|' + (g.lit ? 1 : 0) + '|' + lod + '|' + (A.k ? A.k(b, g) : '');
  let sp = SPR.map.get(key); if (sp) { SPR.map.delete(key); SPR.map.set(key, sp); return sp; }
  const top = artTop(A, S), x0 = -S * TW / 2 - 28, y0 = -top - 10, w = S * TW + 56, h = top + 10 + S * TH + 16, sc = sprScale(A, S, lod);
  const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.ceil(w * sc)); cv.height = Math.max(1, Math.ceil(h * sc));
  const c = cv.getContext('2d'); c.setTransform(sc, 0, 0, sc, -x0 * sc, -y0 * sc);
  const L0 = ARTV.lod, lit0 = ARTV.lit, em0 = ARTV.emit; ARTV.lod = lod; ARTV.lit = !!g.lit; ARTV.emit = g.lit ? [] : null;
  try { A[layer](c, 0, 0, S, 0, b, g); } catch (e) { /* a broken sprite must not stop the frame */ }
  const emit = ARTV.emit && ARTV.emit.length ? ARTV.emit : null; ARTV.lod = L0; ARTV.lit = lit0; ARTV.emit = em0;
  if (TINT[state]) {
    c.globalCompositeOperation = 'source-atop'; c.fillStyle = TINT[state]; c.fillRect(x0, y0, w, h);
    if (state === 'broken' && layer === 's') { const r = KC.RNG.fromSeed(b.t + '/crack'); c.strokeStyle = 'rgba(20,10,8,.7)'; c.lineWidth = 1.1; for (let k = 0; k < 4; k++) { let px = (r.next() - 0.5) * S * 40, py = -r.next() * top * 0.6 + S * 8; c.beginPath(); c.moveTo(px, py); for (let j = 0; j < 4; j++) { px += (r.next() - 0.5) * 12; py += 3 + r.next() * 6; c.lineTo(px, py); } c.stroke(); } c.fillStyle = 'rgba(15,8,6,.35)'; c.beginPath(); c.ellipse((r.next() - 0.5) * S * 20, -top * 0.2, S * 9, S * 5, 0, 0, 7); c.fill(); }
    c.globalCompositeOperation = 'source-over';
  }
  // trim the transparent margin: drawing cost follows the sprite's area
  let tc = cv, tx0 = x0, ty0 = y0, tw = w, th = h;
  try {
    const W = cv.width, H = cv.height, d = c.getImageData(0, 0, W, H).data; let l = W, r = -1, tp = H, bt = -1;
    for (let yy = 0; yy < H; yy++) { const row = yy * W * 4; for (let xx = 0; xx < W; xx++) if (d[row + xx * 4 + 3] > 2) { if (xx < l) l = xx; if (xx > r) r = xx; if (yy < tp) tp = yy; bt = yy; } }
    if (r >= l && bt >= tp) { l = Math.max(0, l - 1); tp = Math.max(0, tp - 1); r = Math.min(W - 1, r + 1); bt = Math.min(H - 1, bt + 1); tc = document.createElement('canvas'); tc.width = r - l + 1; tc.height = bt - tp + 1; tc.getContext('2d').drawImage(cv, -l, -tp); tx0 = x0 + l / sc; ty0 = y0 + tp / sc; tw = tc.width / sc; th = tc.height / sc; }
  } catch (e) { /* keep the untrimmed sprite */ }
  sp = { cv: tc, x0: tx0, y0: ty0, w: tw, h: th, emit, px: tc.width * tc.height };
  SPR.map.set(key, sp); SPR.px += sp.px; SPR.made++;
  while (SPR.px > SPR.budget && SPR.map.size > 1) { const k0 = SPR.map.keys().next().value; SPR.px -= SPR.map.get(k0).px; SPR.map.delete(k0); }
  return sp;
}
// device pixels per world pixel for a sprite; very large sprites (big domes up close) are kept under about 3 megapixels
function sprScale(A, S, lod) { const sc = Math.min(lod * SPR.dpr, lod > 2 ? 4.8 : 3.2), a = (S * TW + 56) * (artTop(A, S) + S * TH + 26); return a * sc * sc > 3e6 ? Math.sqrt(3e6 / a) : sc; }
function sprClear() { SPR.map.clear(); SPR.px = 0; }
function layerDraw(c, A, b, S, layer, state, x, y, z, g, lod) {
  // draw directly when zoomed right in, or when a sprite would have to be blurrier than the screen
  if (!TINT[state] && (!lod || sprScale(A, S, lod) < Math.min(lod * SPR.dpr, lod > 2 ? 4.8 : 3.2) * 0.8)) { const L0 = ARTV.lod, lit0 = ARTV.lit; ARTV.lod = g.zoom; ARTV.lit = !!g.lit; A[layer](c, x, y, S, z, b, g); ARTV.lod = L0; ARTV.lit = lit0; return; }
  const sp = spriteFor(A, b, S, layer, state, g, lod || 1.5), o = P(x, y, z);
  c.drawImage(sp.cv, o[0] + sp.x0, o[1] + sp.y0, sp.w, sp.h);
  if (sp.emit && ARTV.emit) for (const e of sp.emit) ARTV.emit.push([e[0] + o[0], e[1] + o[1], e[2], e[3], e[4]]);
}
// draws any building, in any state, at tile (x, y) and ground height z. g: { zoom, sunTilt, windAngle, mods, pop } from the renderer
function drawBuilding(c, b, x, y, z, t, g) {
  const A = artOf(b.t); if (!A) return;
  const S = b.s || (BUILDINGS[b.t] && BUILDINGS[b.t].size) || 1, state = buildingState(b), lod = g.direct ? 0 : sprBucket(g.zoom);
  g.state = state; g.on = state === 'ok'; g.lit = state === 'ok' && ARTV.night > 0.3;
  if (state === 'site') return drawSiteArt(c, A, b, S, x, y, z, t, g, lod);
  layerDraw(c, A, b, S, 's', state, x, y, z, g, lod);
  if (A.a) { const L0 = ARTV.lod; ARTV.lod = g.zoom; A.a(c, x, y, S, z, state === 'off' ? 0 : t, b, g); ARTV.lod = L0; }
  if (A.o) layerDraw(c, A, b, S, 'o', state, x, y, z, g, lod);
  if (state === 'broken') brokenFx(c, A, b, S, x, y, z, t, g);
  else if (state === 'nopower' && g.zoom > 0.5) { const p = P(x + S / 2, y + S / 2, z + Math.min(artTop(A, S) * 0.6, 40)); if (Math.sin(t * 4 + b.id) > 0) { c.fillStyle = '#ffb34a'; c.beginPath(); c.arc(p[0], p[1], 2.2, 0, 7); c.fill(); glow(c, p[0], p[1], 9, '255,180,80', 0.5); } }
}
// smoke, sparks and a warning light over a broken building
function brokenFx(c, A, b, S, x, y, z, t, g) {
  const p = P(x + S / 2, y + S / 2, z + Math.min(artTop(A, S) * 0.5, 36)), sd = b.id || 1;
  if (g.zoom > 0.45) for (let k = 0; k < 4; k++) { const ph = (t * 0.22 + k / 4 + sd * 0.13) % 1, a = 0.45 * (1 - ph); c.fillStyle = 'rgba(52,44,40,' + a.toFixed(3) + ')'; c.beginPath(); c.arc(p[0] + Math.sin(ph * 4 + sd) * 5 + ph * 12, p[1] - ph * 46, 3.5 + ph * 11, 0, 7); c.fill(); }
  if (g.zoom > 0.7 && Math.sin(t * 9 + sd * 2.1) > 0.6) { c.strokeStyle = '#ffe08a'; c.lineWidth = 1; c.beginPath(); for (let k = 0; k < 4; k++) { const a = k * 1.6 + t * 3; c.moveTo(p[0], p[1] + 8); c.lineTo(p[0] + Math.cos(a) * 7, p[1] + 8 + Math.sin(a) * 4 - 4); } c.stroke(); }
  if (Math.sin(t * 3 + sd) > 0) { c.fillStyle = '#ff4a3a'; c.beginPath(); c.arc(p[0] - 6, p[1] - 4, 2.2, 0, 7); c.fill(); glow(c, p[0] - 6, p[1] - 4, 10, '255,70,50', 0.5); }
}
// ---------- construction: foundation, then the building rising inside scaffolding, a crane over it ----------
function drawSiteArt(c, A, b, S, x, y, z, t, g, lod) {
  const prog = clamp(g.prog !== undefined ? g.prog : (b.prog || 0) / Math.max(1, (BUILDINGS[b.t] && BUILDINGS[b.t].work) || 1), 0, 1);
  const L0 = ARTV.lod; ARTV.lod = g.zoom;
  const dome = !!BUILDINGS[b.t] && BUILDINGS[b.t].dome, top = artTop(A, S), hs = Math.min(top * 0.62, 26 + S * 8);
  // the excavated footprint with survey tape
  const q = [P(x, y, z), P(x + S, y, z), P(x + S, y + S, z), P(x, y + S, z)];
  poly(c, q, 'rgba(70,52,40,.45)', 'rgba(255,190,110,.85)', 1.1);
  if (!dome) { const inn = [P(x + 0.12, y + 0.12, z), P(x + S - 0.12, y + 0.12, z), P(x + S - 0.12, y + S - 0.12, z), P(x + 0.12, y + S - 0.12, z)]; poly(c, inn, 'rgba(140,128,116,' + (0.35 + 0.5 * Math.min(1, prog * 4)).toFixed(2) + ')'); }
  for (const [a, d] of [[0, 0], [S, 0], [S, S], [0, S]]) { const p0 = P(x + a, y + d, z); c.fillStyle = ORANGE; c.fillRect(p0[0] - 1, p0[1] - 6, 2, 6); }
  // the building rises from the ground as work goes on
  const k = clamp((prog - 0.12) / 0.88, 0, 1);
  if (k > 0) {
    const o = P(x, y, z), bottom = o[1] + S * TH + 18, topY = o[1] - top * 0.8, cut = bottom - (bottom - topY) * k;
    c.save(); c.beginPath(); c.rect(o[0] - S * TW, cut, S * TW * 2, bottom - cut + 4); c.clip();
    c.globalAlpha *= 0.92; layerDraw(c, A, b, S, 's', 'site', x, y, z, g, lod || 1.5); if (A.o) layerDraw(c, A, b, S, 'o', 'site', x, y, z, g, lod || 1.5);
    c.restore();
    if (g.zoom > 0.7 && Math.sin(t * 11 + b.id * 3) > 0.5) { const wx = o[0] + Math.sin(t * 0.7 + b.id) * S * 14; c.fillStyle = '#dff4ff'; c.beginPath(); c.arc(wx, Math.max(cut, topY) + 2, 1.5, 0, 7); c.fill(); glow(c, wx, Math.max(cut, topY) + 2, 8, '170,220,255', 0.6); }
  } else if (g.zoom > 0.6) { // material stacks waiting on the pad
    box(c, x + S * 0.25, y + S * 0.55, 0.45, 0.35, z, 4, '#c58b4e', { edge: false }); box(c, x + S * 0.55, y + S * 0.3, 0.3, 0.45, z, 3, '#8a979f', { edge: false });
  }
  // scaffolding around the front and side
  if (!dome) {
    const h = hs * Math.min(1, 0.2 + k * 1.1), posts = [[0.05, S - 0.05], [S / 2, S - 0.05], [S - 0.05, S - 0.05], [S - 0.05, S / 2], [S - 0.05, 0.05], [0.05, 0.05]];
    c.strokeStyle = 'rgba(214,176,98,.9)'; c.lineWidth = 1; c.beginPath();
    for (const [a, d] of posts) { const p0 = P(x + a, y + d, z); c.moveTo(p0[0], p0[1]); c.lineTo(p0[0], p0[1] - h); }
    for (let lv = 8; lv <= h; lv += 8) { for (let i = 0; i < 5; i++) { const p0 = P(x + posts[i][0], y + posts[i][1], z + lv), p1 = P(x + posts[i + 1][0], y + posts[i + 1][1], z + lv); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); } }
    if (g.zoom > 0.9) for (let i = 0; i < 4; i++) { const p0 = P(x + posts[i][0], y + posts[i][1], z), p1 = P(x + posts[i + 1][0], y + posts[i + 1][1], z + Math.min(h, 16)); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); }
    c.stroke();
  }
  // a tower crane on the back corner of bigger sites
  if (S >= 2) {
    const base = P(x + S - 0.25, y + 0.25, z), H = Math.max(40, top * 0.9), jx = base[0], jy = base[1] - H, a = Math.sin(t * 0.25 + b.id) * 1.4 - 1.9, L = 18 + S * 10;
    c.strokeStyle = '#ffb34a'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(jx - 2, base[1]); c.lineTo(jx - 2, jy); c.moveTo(jx + 2, base[1]); c.lineTo(jx + 2, jy); c.stroke();
    if (g.zoom > 0.8) { c.lineWidth = 0.6; c.beginPath(); for (let yy = base[1]; yy > jy; yy -= 6) { c.moveTo(jx - 2, yy); c.lineTo(jx + 2, yy - 6); } c.stroke(); }
    const ex = jx + Math.cos(a) * L, ey = jy + Math.sin(a) * L * 0.5, bx = jx - Math.cos(a) * 9, by = jy - Math.sin(a) * 4.5;
    c.lineWidth = 2; c.beginPath(); c.moveTo(bx, by); c.lineTo(ex, ey); c.stroke(); c.fillStyle = '#6b625b'; c.fillRect(bx - 3, by - 2, 6, 4);
    const hy = ey + 10 + (1 - k) * 14 + Math.sin(t * 0.9) * 3; c.strokeStyle = '#3a3532'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex, hy); c.stroke(); c.fillStyle = '#c58b4e'; c.fillRect(ex - 2.5, hy, 5, 3);
    light(c, jx, jy - 2, '#ff4a3a', t, 1.6);
  }
  ARTV.lod = L0;
}
// ---------- vehicles ----------
function vehHeading(v) { let dx = 0, dy = 0; if (v.px !== undefined) { dx = v.x - v.px; dy = v.y - v.py; } if (!dx && !dy && v.path && v.path.length) { const n = v.path[0]; dx = (n[0] !== undefined ? n[0] : n.x) - v.x; dy = (n[1] !== undefined ? n[1] : n.y) - v.y; } if (!dx && !dy) return v._hd || 0; v._hd = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3); return v._hd; }
function drawVehicle(c, v, wx, wy, z, t, sel) {
  const p = P(wx + 0.5, wy + 0.5, z), hd = vehHeading(v), along = hd % 2 === 0, fw = hd < 2 ? 1 : -1, moving = v.path && v.path.length;
  const L = v.t === 'crawler' ? 0.92 : 0.66, W = v.t === 'crawler' ? 0.66 : 0.44, bx = wx + 0.5 - (along ? L : W) / 2, by = wy + 0.5 - (along ? W : L) / 2, lx = along ? L : W, ly = along ? W : L;
  c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(p[0], p[1] + 1, v.t === 'crawler' ? 22 : 15, v.t === 'crawler' ? 10 : 7, 0, 0, 7); c.fill();
  if (moving && ARTV.lod > 0.6) for (let k = 0; k < 3; k++) { const ph = (t * 1.4 + k / 3) % 1, q = P(wx + 0.5 - (along ? fw * (0.4 + ph * 0.5) : 0), wy + 0.5 - (along ? 0 : fw * (0.4 + ph * 0.5)), z); c.fillStyle = 'rgba(190,150,110,' + (0.35 * (1 - ph)).toFixed(2) + ')'; c.beginPath(); c.arc(q[0], q[1] - 2 - ph * 4, 3 + ph * 5, 0, 7); c.fill(); }
  const front = (u, w2, h) => along ? P(wx + 0.5 + fw * u, wy + 0.5 + w2, z + h) : P(wx + 0.5 + w2, wy + 0.5 + fw * u, z + h);
  if (v.t === 'crawler') {
    // two tracks, a yellow hull with a drone bay, a cab and a rotating beacon
    for (const s of [-1, 1]) { const o = along ? [0, s * W * 0.38] : [s * W * 0.38, 0]; box(c, wx + 0.5 + o[0] - (along ? L : 0.16) / 2, wy + 0.5 + o[1] - (along ? 0.16 : L) / 2, along ? L : 0.16, along ? 0.16 : L, z, 5, '#2f2b28', { edge: false }); if (ARTV.lod > 1) { c.strokeStyle = 'rgba(120,110,100,.6)'; c.lineWidth = 0.6; c.beginPath(); for (let k = 0; k < 6; k++) { const q = along ? P(wx + 0.5 - L / 2 + k * L / 6, wy + 0.5 + o[1] + 0.08, z + 2.5) : P(wx + 0.5 + o[0] + 0.08, wy + 0.5 - L / 2 + k * L / 6, z + 2.5); c.moveTo(q[0], q[1] - 2); c.lineTo(q[0], q[1] + 2); } c.stroke(); } }
    box(c, bx + 0.06, by + 0.06, lx - 0.12, ly - 0.12, z + 4, 9, '#e2b25a', { seams: 3, band: [0.35, 'rgba(40,30,20,.55)', 1.4] });
    // the drone bay on the back half, a raised cab with windows at the front, a mast with a turning beacon
    const hb = front(-L * 0.18, 0, 13); c.fillStyle = '#3a3532'; c.beginPath(); c.ellipse(hb[0], hb[1], 9, 4.5, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(79,224,255,.75)'; c.lineWidth = 0.9; c.stroke(); c.fillStyle = '#e8e2d6'; c.beginPath(); c.ellipse(hb[0] - 2, hb[1] - 1, 2.6, 1.4, 0, 0, 7); c.fill();
    const cw = along ? 0.26 : W - 0.2, cd = along ? W - 0.2 : 0.26, cc = along ? [wx + 0.5 + fw * L * 0.3 - cw / 2, wy + 0.5 - cd / 2] : [wx + 0.5 - cw / 2, wy + 0.5 + fw * L * 0.3 - cd / 2];
    box(c, cc[0], cc[1], cw, cd, z + 13, 8, '#d8cdbd', { win: { n: 2, at: 0.5, h: 2.6 } });
    const mt = front(-L * 0.38, W * 0.3, 13); c.strokeStyle = '#8a7d70'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(mt[0], mt[1]); c.lineTo(mt[0], mt[1] - 12); c.stroke();
    const ba = t * 4; c.fillStyle = '#ffb34a'; c.beginPath(); c.arc(mt[0], mt[1] - 13, 2, 0, 7); c.fill(); if (Math.cos(ba) > 0) glow(c, mt[0] + Math.sin(ba) * 3, mt[1] - 13, 10, '255,180,80', 0.6);
  } else {
    // a six-wheeled rover: chassis, cream body, cab glass at the front, solar deck, antenna
    for (const u of [-0.24, 0, 0.24]) for (const s of [-1, 1]) { const w = front(u, s * W * 0.55, 2.4); c.fillStyle = '#26221f'; c.beginPath(); c.ellipse(w[0], w[1], 2.6, 2.2, 0, 0, 7); c.fill(); if (ARTV.lod > 1.1) { c.fillStyle = '#7a7068'; c.beginPath(); c.arc(w[0], w[1], 0.9, 0, 7); c.fill(); } }
    box(c, bx, by, lx, ly, z + 2.5, 2.5, '#5a524c', { edge: false });
    box(c, bx + 0.04, by + 0.04, lx - 0.08, ly - 0.08, z + 5, 5, '#e6e0d6', { band: [0.4, 'rgba(232,138,60,.85)', 1.2] });
    const g0 = front(L * 0.36, 0, 9); c.fillStyle = ARTV.night > 0.3 ? 'rgba(255,214,140,.95)' : '#3a5a78'; c.beginPath(); c.ellipse(g0[0], g0[1], 4, 2.2, 0, 0, 7); c.fill();
    if (ARTV.lod > 0.9) { const sp = [front(-0.3, -W * 0.36, 10.4), front(0.02, -W * 0.36, 10.4), front(0.02, W * 0.36, 10.4), front(-0.3, W * 0.36, 10.4)]; poly(c, sp, '#1d3150', '#a8b6c6', 0.5); }
    const m = front(-0.2, W * 0.3, 10); c.strokeStyle = '#b8aa98'; c.lineWidth = 1; c.beginPath(); c.moveTo(m[0], m[1]); c.lineTo(m[0], m[1] - 10); c.stroke(); light(c, m[0], m[1] - 10, '#7dff8a', t + v.id, 1.8);
    if (ARTV.night > 0.3) { const hl = front(L * 0.55, 0, 6); glow(c, hl[0], hl[1], 12, '255,240,200', 0.5); }
  }
  if (sel) { c.strokeStyle = '#ffd36a'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(p[0], p[1], 20, 10, 0, 0, 7); c.stroke(); }
}
// a rocket on the pad or in flight: body, nose, fins, legs near the ground, engine bell, flame and glow
function drawRocket(c, x, y, z, lift, t, flame) {
  const p = P(x, y, z + lift);
  if (flame) {
    const fl = 1 + Math.sin(t * 40) * 0.08 + Math.sin(t * 23) * 0.06, L = (34 + Math.min(lift, 60) * 0.25) * fl;
    glow(c, p[0], p[1] + 10, 34, '255,170,80', 0.55);
    const g0 = c.createLinearGradient(0, p[1], 0, p[1] + L); g0.addColorStop(0, 'rgba(255,250,220,.98)'); g0.addColorStop(0.35, 'rgba(255,170,70,.85)'); g0.addColorStop(1, 'rgba(255,90,30,0)');
    c.fillStyle = g0; c.beginPath(); c.moveTo(p[0] - 7, p[1] + 2); c.quadraticCurveTo(p[0] - 5, p[1] + L * 0.5, p[0], p[1] + L); c.quadraticCurveTo(p[0] + 5, p[1] + L * 0.5, p[0] + 7, p[1] + 2); c.fill();
    c.fillStyle = 'rgba(200,240,255,.9)'; c.beginPath(); c.ellipse(p[0], p[1] + 4, 3, 6 * fl, 0, 0, 7); c.fill();
  }
  c.fillStyle = '#4a4440'; c.beginPath(); c.moveTo(p[0] - 6, p[1] - 2); c.lineTo(p[0] - 8, p[1] + 3); c.lineTo(p[0] + 8, p[1] + 3); c.lineTo(p[0] + 6, p[1] - 2); c.fill();
  if (lift < 50) { c.strokeStyle = '#6a625b'; c.lineWidth = 1.6; c.beginPath(); for (const s of [-1, 1]) { c.moveTo(p[0] + s * 8, p[1] - 12); c.lineTo(p[0] + s * 16, p[1] + 4); } c.stroke(); c.fillStyle = '#4a4440'; c.fillRect(p[0] - 18, p[1] + 3, 5, 2); c.fillRect(p[0] + 13, p[1] + 3, 5, 2); }
  const g = c.createLinearGradient(p[0] - 9, 0, p[0] + 9, 0); g.addColorStop(0, '#e2dbd0'); g.addColorStop(0.35, '#fffaf2'); g.addColorStop(1, '#8a8078');
  c.fillStyle = g; c.beginPath(); c.moveTo(p[0] - 9, p[1] - 2); c.lineTo(p[0] - 9, p[1] - 52); c.quadraticCurveTo(p[0] - 8, p[1] - 74, p[0], p[1] - 84); c.quadraticCurveTo(p[0] + 8, p[1] - 74, p[0] + 9, p[1] - 52); c.lineTo(p[0] + 9, p[1] - 2); c.closePath(); c.fill();
  c.fillStyle = ORANGE; c.fillRect(p[0] - 9, p[1] - 36, 18, 5); c.fillStyle = '#3a3532'; c.fillRect(p[0] - 9, p[1] - 14, 18, 2);
  if (ARTV.lod > 0.8) { c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 0.6; c.beginPath(); for (const yy of [22, 46, 60]) { c.moveTo(p[0] - 9, p[1] - yy); c.lineTo(p[0] + 9, p[1] - yy); } c.stroke(); }
  c.fillStyle = '#6a625b'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(p[0] + s * 9, p[1] - 18); c.lineTo(p[0] + s * 17, p[1] - 2); c.lineTo(p[0] + s * 17, p[1] + 2); c.lineTo(p[0] + s * 9, p[1] - 4); c.fill(); }
  c.fillStyle = '#2a3a4a'; c.beginPath(); c.arc(p[0] - 1, p[1] - 46, 3.2, 0, 7); c.fill(); c.fillStyle = 'rgba(200,230,255,.6)'; c.beginPath(); c.arc(p[0] - 2, p[1] - 47, 1.2, 0, 7); c.fill();
}
// a small icon of any building for menus (drawn into its own canvas, same art as the map)
function iconCanvas(type, px, ph) {
  const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1), pw = px; ph = ph || px;
  cv.width = pw * dpr; cv.height = ph * dpr; cv.style.width = pw + 'px'; cv.style.height = ph + 'px';
  const c = cv.getContext('2d'), d = BUILDINGS[type] || { size: 1 }, n0 = ARTV.night, em0 = ARTV.emit; ARTV.night = 0; ARTV.emit = null;
  const s = d.size || 1, A = ART[type] || (d.dome ? DOME_ART : null), top = A ? artTop(A, s) : 30;
  // square icons fit the whole sprite; wide banners fit the building's body and let tall masts run off the top
  const banner = ph < pw * 0.6, tv = banner ? top * 0.62 : top, sc = Math.min(pw * dpr * (banner ? 0.62 : 0.92) / (s * TW + 12), ph * dpr * (banner ? 0.96 : 0.92) / (tv + s * TH + 8));
  c.translate(pw * dpr / 2, ph * dpr / 2 + (tv - s * TH) * sc * 0.5); c.scale(sc, sc);
  try {
    if (A) drawBuilding(c, { id: 1, t: type, s, built: true, wear: 0, on: true, _pop: 6 }, 0, 0, 0, 1, { zoom: 1.4, direct: true, sunTilt: 0.3, windAngle: 0.6, mods: d.dome ? [{ t: 'quarters', built: true }, { t: 'canteen', built: true }, { t: 'hydro', built: true }] : null, pop: 6 });
    else if (MODULES[type]) { c.translate(0, -12); box(c, -0.4, -0.4, 0.8, 0.8, 0, 14, MOD_COL[type] || '#c9bba8', { win: { n: 2, at: 0.5, h: 2.4 } }); }
    else if (type === 'cable' || type === 'pipe') { c.strokeStyle = type === 'cable' ? '#ffd84a' : '#9fe4ff'; c.lineWidth = 5; c.beginPath(); c.moveTo(-20, 0); c.lineTo(20, 16); c.stroke(); }
  } catch (e) { /* icon only */ }
  ARTV.night = n0; ARTV.emit = em0;
  return cv;
}
// ---------- drones and resource deposits ----------
// a little quad drone: four blurred rotors, a cream shell, a status light; a shadow on the ground below
function drawDrone(c, px, py, t, i, kind) {
  c.fillStyle = 'rgba(0,0,0,.22)'; c.beginPath(); c.ellipse(px, py + 14, 3.4, 1.5, 0, 0, 7); c.fill();
  if (ARTV.lod > 0.8) { c.fillStyle = 'rgba(210,220,225,.35)'; for (const [dx, dy] of [[-3.6, -1.2], [3.6, -1.2], [-3.6, 1.2], [3.6, 1.2]]) { c.beginPath(); c.ellipse(px + dx, py + dy - 0.6, 2.4, 1, 0, 0, 7); c.fill(); } }
  c.fillStyle = '#5a524c'; c.beginPath(); c.ellipse(px, py + 0.6, 3.4, 1.9, 0, 0, 7); c.fill();
  c.fillStyle = '#ece6dc'; c.beginPath(); c.ellipse(px, py - 0.4, 3, 1.8, 0, 0, 7); c.fill();
  c.fillStyle = kind === 'repair' || kind === 'fix' ? '#ff9a4a' : kind === 'mine' ? '#ffd36a' : (i + Math.floor(t * 2)) % 3 ? '#4fe0ff' : '#ff8a4a'; c.fillRect(px - 0.8, py - 2.4, 1.6, 1.4);
}
const hash1 = (a, k) => { const v = Math.sin(a * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
// every deposit type has its own look: grey metal chunks with glints, cracked ice sheets, violet crystal clusters,
// tall glowing kessite, soft regolith mounds, twisted scrap, swaying spore pods
function drawDepositArt(c, d, D, cx, cy, zz, t, zoom, occupied) {
  const id = d.id || 0, e = (d.r || 0) + 0.5, at = (k, sp) => { const a = hash1(id, k) * 6.283, r = Math.sqrt(hash1(id, k + 50)) * e * (sp || 0.8); return P(cx + Math.cos(a) * r, cy + Math.sin(a) * r, zz); };
  const c0 = P(cx, cy, zz);
  if (d.type !== 'scrap' && d.type !== 'bloom') {
    c.save(); c.translate(c0[0], c0[1]); c.scale(1, 0.5); const R = e * TW * 0.78, g = c.createRadialGradient(0, 0, 1, 0, 0, R), rgb = parseInt(D.color.slice(1), 16);
    const col = (rgb >> 16) + ',' + ((rgb >> 8) & 255) + ',' + (rgb & 255); g.addColorStop(0, 'rgba(' + col + ',' + (occupied ? 0.14 : zoom < 0.6 ? 0.55 : 0.36) + ')'); g.addColorStop(0.7, 'rgba(' + col + ',' + (occupied ? 0.06 : 0.16) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, 7); c.fill(); c.restore();
    if (!occupied) { const pts = [[cx - e, cy - e], [cx + e, cy - e], [cx + e, cy + e], [cx - e, cy + e]].map(([x, y]) => P(x, y, zz)); c.strokeStyle = 'rgba(255,250,240,' + (0.3 + 0.15 * Math.sin(t * 2 + id)).toFixed(2) + ')'; c.setLineDash([5, 4]); c.lineWidth = 1.1; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.stroke(); c.setLineDash([]); }
  }
  if (zoom < 0.45) return;
  const n = Math.min(14, 5 + Math.round(e * 4));
  if (d.type === 'metal') for (let k = 0; k < n; k++) { const p = at(k), r = 2.2 + hash1(id, k + 9) * 3.2; c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(p[0] + 1.5, p[1] + 0.8, r * 1.2, r * 0.45, 0, 0, 7); c.fill(); poly(c, [[p[0] - r, p[1]], [p[0] - r * 0.5, p[1] - r], [p[0] + r * 0.4, p[1] - r * 0.85], [p[0] + r, p[1] - r * 0.1], [p[0] + r * 0.3, p[1] + r * 0.3]], '#7d8a94'); poly(c, [[p[0] - r * 0.5, p[1] - r], [p[0] + r * 0.4, p[1] - r * 0.85], [p[0] + r * 0.1, p[1] - r * 0.3], [p[0] - r * 0.6, p[1] - r * 0.4]], '#b9c5ce'); if (zoom > 0.9 && Math.sin(t * 2 + k * 1.7 + id) > 0.85) { c.fillStyle = '#ffffff'; c.fillRect(p[0] - r * 0.2, p[1] - r * 0.8, 1.4, 1.4); } }
  else if (d.type === 'ice') for (let k = 0; k < n; k++) { const p = at(k), w = 5 + hash1(id, k + 9) * 6, h = w * 0.45; c.fillStyle = 'rgba(90,140,170,.35)'; c.beginPath(); c.ellipse(p[0] + 1, p[1] + 1, w, h, 0, 0, 7); c.fill(); c.fillStyle = '#d6f1ff'; c.beginPath(); c.moveTo(p[0] - w, p[1]); c.lineTo(p[0] - w * 0.3, p[1] - h); c.lineTo(p[0] + w * 0.8, p[1] - h * 0.6); c.lineTo(p[0] + w, p[1] + h * 0.3); c.lineTo(p[0], p[1] + h); c.closePath(); c.fill(); c.strokeStyle = 'rgba(120,180,215,.8)'; c.lineWidth = 0.6; c.beginPath(); c.moveTo(p[0] - w * 0.5, p[1] - h * 0.2); c.lineTo(p[0] + w * 0.2, p[1] + h * 0.1); c.lineTo(p[0] + w * 0.5, p[1] - h * 0.5); c.stroke(); if (zoom > 0.8 && Math.sin(t * 3 + k * 2.3 + id) > 0.8) { c.fillStyle = '#fff'; c.fillRect(p[0], p[1] - h * 0.6, 1.5, 1.5); } }
  else if (d.type === 'rare') for (let k = 0; k < Math.ceil(n * 0.7); k++) { const p = at(k); for (let j = 0; j < 3; j++) crystal(c, [p[0] - 3 + j * 3, p[1] - (j % 2) * 1.5], 5 + hash1(id, k * 3 + j) * 6, 1.8, '#b59cf0', (j - 1) * 1.5); }
  else if (d.type === 'crystal') { const pul = 0.25 + 0.12 * Math.sin(t * 2.4 + id); glow(c, c0[0], c0[1] - 6, 14 + e * 14, '255,122,217', pul); for (let k = 0; k < n; k++) { const p = at(k, 0.7); crystal(c, p, 9 + hash1(id, k + 3) * 12, 2.6, '#ff7ad9', (hash1(id, k + 7) - 0.5) * 4); } }
  else if (d.type === 'regolith') for (let k = 0; k < n; k++) { const p = at(k), w = 6 + hash1(id, k + 9) * 6; c.fillStyle = '#b8936c'; c.beginPath(); c.ellipse(p[0], p[1], w, w * 0.42, 0, 0, 7); c.fill(); c.fillStyle = '#e4c49c'; c.beginPath(); c.ellipse(p[0] - w * 0.2, p[1] - w * 0.18, w * 0.6, w * 0.22, 0, 0, 7); c.fill(); }
  else if (d.type === 'scrap') for (let k = 0; k < 6; k++) { const p = at(k, 0.6), a = hash1(id, k) * 3; c.fillStyle = k % 2 ? '#c8ced4' : '#8f969c'; c.beginPath(); c.moveTo(p[0] - 5, p[1]); c.lineTo(p[0] - 1, p[1] - 5); c.lineTo(p[0] + 6, p[1] - 2); c.lineTo(p[0] + 3, p[1] + 2); c.closePath(); c.fill(); c.strokeStyle = '#6f777c'; c.lineWidth = 1.1; c.beginPath(); c.moveTo(p[0] - 3, p[1] + 1); c.quadraticCurveTo(p[0] + Math.cos(a) * 6, p[1] - 6, p[0] + 7, p[1] - 3 + Math.sin(a) * 2); c.stroke(); if (k === 0) { c.fillStyle = ORANGE; c.fillRect(p[0] + 1, p[1] - 3, 3, 1.5); } }
  else if (d.type === 'bloom') for (let k = 0; k < 7; k++) { const p = at(k, 0.6), sw = Math.sin(t * 1.3 + k + id) * 1.2, h = 4 + hash1(id, k + 4) * 4; c.strokeStyle = '#8aa070'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[0] + sw, p[1] - h); c.stroke(); c.fillStyle = '#e4f4c0'; c.beginPath(); c.arc(p[0] + sw, p[1] - h - 2, 2.6, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,240,.6)'; c.beginPath(); c.arc(p[0] + sw - 0.8, p[1] - h - 2.8, 1, 0, 7); c.fill(); if (ARTV.night > 0.3) glow(c, p[0] + sw, p[1] - h - 2, 7, '220,255,170', 0.4); }
}
// a small illustration for empty states, drawn with the same art as the map
function sceneCanvas(kind, w, h) {
  const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.className = 'scene';
  const c = cv.getContext('2d'), n0 = ARTV.night, em0 = ARTV.emit, L0 = ARTV.lod; ARTV.night = 0; ARTV.emit = null; ARTV.lod = 1.3;
  c.scale(dpr, dpr);
  const g = c.createRadialGradient(w / 2, h * 0.74, 4, w / 2, h * 0.74, w * 0.5); g.addColorStop(0, 'rgba(176,130,94,.9)'); g.addColorStop(1, 'rgba(176,130,94,0)'); c.fillStyle = g; c.save(); c.translate(w / 2, h * 0.74); c.scale(1, 0.42); c.beginPath(); c.arc(0, 0, w * 0.5, 0, 7); c.restore(); c.fill();
  try {
    if (kind === 'people') { c.translate(w / 2, h * 0.72); c.scale(2.2, 2.2); [[-9, 2, 0], [0, -2, 1], [9, 3, 2], [-3, 6, 3]].forEach(([x, y, k]) => figure(c, x, y, SUIT[k], true, 0, true)); }
    else if (kind === 'rocket') { c.translate(w / 2, h * 0.66); const sc = h / 120; c.scale(sc, sc); drawRocket(c, 0, 0, 0, 0, 1, false); }
    else { const d = BUILDINGS[kind] || { size: 2 }, s = d.size || 2, A = artOf(kind), top = A ? artTop(A, s) : 40, sc = Math.min(w * 0.8 / (s * TW), h * 0.86 / (top + s * TH)); c.translate(w / 2, h * 0.5 + (top - s * TH) * sc * 0.5); c.scale(sc, sc); if (A) drawBuilding(c, { id: 2, t: kind, s, built: true, wear: 0, on: true, _pop: 8 }, 0, 0, 0, 2, { zoom: 1.3, direct: true, sunTilt: 0.3, windAngle: 0.8, mods: d.dome ? [{ t: 'quarters', built: true }, { t: 'canteen', built: true }, { t: 'hydro', built: true }, { t: 'lounge', built: true }] : null, pop: 8 }); }
  } catch (e) { /* illustration only */ }
  ARTV.night = n0; ARTV.emit = em0; ARTV.lod = L0;
  return cv;
}
// ---------- the globe of Kessa for the Reshaping panel: frost caps shrink, seas and green spread, clouds thicken ----------
const GLOBE = { key: '', cv: null };
function planetCanvas(G, w, h) {
  const T = G.terra || { veil: 0, warm: 0, water: 0, life: 0, st: {} }, key = [w, h, Math.round(T.veil / 3), Math.round(T.warm / 3), Math.round(T.water / 3), Math.round(T.life / 3), G.seed].join('|');
  const cv = document.createElement('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.className = 'globe';
  const c = cv.getContext('2d');
  if (GLOBE.key === key && GLOBE.cv) { c.drawImage(GLOBE.cv, 0, 0); return cv; }
  const W = cv.width, H = cv.height, R = Math.min(W, H) * 0.42, cx = W * 0.5, cy = H * 0.52, nz = makeNoise(KC.RNG.fromSeed(G.seed + '/globe'));
  const img = c.createImageData(W, H), d = img.data, sea = clamp((T.water - 10) / 90, 0, 0.55), cap = 1 - clamp(T.warm / 70, 0, 0.8) * 0.75, green = clamp(T.life / 70, 0, 0.9), cloud = clamp((T.veil - 15) / 60, 0, 0.7) * clamp(T.water / 30, 0.2, 1);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const i = (py * W + px) * 4, dx = (px - cx) / R, dy = (py - cy) / R, r2 = dx * dx + dy * dy;
    if (r2 > 1) { const st = ((px * 73856093) ^ (py * 19349663)) >>> 0; if (st % 997 === 0) { d[i] = d[i + 1] = d[i + 2] = 200 + st % 55; d[i + 3] = 255; } continue; }
    const dz = Math.sqrt(1 - r2), lon = Math.atan2(dx, dz) + 0.6, lat = Math.asin(-dy), u = lon * 1.4, v = lat * 2.2;
    let e = nz.fbm(u + 3, v + 7, 5) * 0.5 + 0.5, col;
    const polar = Math.abs(lat) / (Math.PI / 2);
    if (e < 0.32 + sea * 0.5) col = e < 0.26 + sea * 0.5 ? [28, 72, 110] : [52, 112, 140];
    else if (polar > cap * 0.95 + nz.fbm(u * 2, v * 2, 2) * 0.08) col = [232, 238, 244];
    else { col = [176 + e * 40, 118 + e * 30, 82 + e * 18]; const gv = nz.fbm(u * 1.7 + 11, v * 1.7 + 5, 4) * 0.5 + 0.5 + (0.5 - Math.abs(lat)) * 0.2; if (gv < green * 0.9 + 0.1 && green > 0) { const k = clamp((green * 0.9 + 0.1 - gv) * 4, 0, 1); col = [col[0] * (1 - k) + 88 * k, col[1] * (1 - k) + 132 * k, col[2] * (1 - k) + 66 * k]; } }
    if (cloud > 0) { const cl = nz.fbm(u * 2.4 + 40, v * 3 + 9, 4) * 0.5 + 0.5; if (cl > 1 - cloud) { const k = clamp((cl - (1 - cloud)) * 3, 0, 0.85); col = [col[0] * (1 - k) + 245 * k, col[1] * (1 - k) + 245 * k, col[2] * (1 - k) + 248 * k]; } }
    const lit = clamp(0.25 + 0.95 * (dz * 0.75 - dx * 0.45 - dy * 0.25), 0.12, 1.15);
    d[i] = clamp(col[0] * lit, 0, 255); d[i + 1] = clamp(col[1] * lit, 0, 255); d[i + 2] = clamp(col[2] * lit, 0, 255); d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // the Veil: a rim of air whose colour moves from thin amber to blue
  const blue = clamp((T.veil - 20) / 45, 0, 1), a = 0.15 + clamp(T.veil / 60, 0, 1) * 0.55, rim = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.12);
  rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.45, 'rgba(' + Math.round(lerp(230, 120, blue)) + ',' + Math.round(lerp(170, 190, blue)) + ',' + Math.round(lerp(110, 255, blue)) + ',' + a.toFixed(2) + ')'); rim.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = rim; c.beginPath(); c.arc(cx, cy, R * 1.12, 0, 7); c.fill();
  GLOBE.key = key; GLOBE.cv = document.createElement('canvas'); GLOBE.cv.width = W; GLOBE.cv.height = H; GLOBE.cv.getContext('2d').drawImage(cv, 0, 0);
  return cv;
}
