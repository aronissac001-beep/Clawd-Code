// ===== art3.js : 2.1 art. The Expedition Pad and its skimmer, the Rail Station, the monorail guideway and trains,
// and three wonders: the Undergrove, the Skyward Relay and the Great Orrery. Same light, materials and layers as art.js. =====
// the skimmer: a slim winged rocket in cream and teal, standing on its tail
function drawSkimmer(c, px, py, t, flame, sc) {
  const k = sc || 1; c.save(); c.translate(px, py); c.scale(k, k);
  if (flame) { const fl = 1 + Math.sin(t * 41) * 0.1, L = 30 * fl; glow(c, 0, 6, 26, '255,170,80', 0.55); const g0 = c.createLinearGradient(0, 0, 0, L); g0.addColorStop(0, 'rgba(255,250,220,.98)'); g0.addColorStop(0.4, 'rgba(255,160,70,.8)'); g0.addColorStop(1, 'rgba(255,90,30,0)'); c.fillStyle = g0; c.beginPath(); c.moveTo(-5, 0); c.quadraticCurveTo(-3, L * 0.5, 0, L); c.quadraticCurveTo(3, L * 0.5, 5, 0); c.fill(); }
  // delta wings behind the body
  c.fillStyle = '#5a6b70'; c.beginPath(); c.moveTo(-5, -20); c.lineTo(-15, -2); c.lineTo(-15, 2); c.lineTo(-5, -4); c.fill(); c.beginPath(); c.moveTo(5, -20); c.lineTo(15, -2); c.lineTo(15, 2); c.lineTo(5, -4); c.fill();
  const g = c.createLinearGradient(-6, 0, 6, 0); g.addColorStop(0, '#d8d0c4'); g.addColorStop(0.4, '#fffaf0'); g.addColorStop(1, '#8a8278');
  c.fillStyle = g; c.beginPath(); c.moveTo(-6, 0); c.lineTo(-6, -34); c.quadraticCurveTo(-5.5, -48, 0, -56); c.quadraticCurveTo(5.5, -48, 6, -34); c.lineTo(6, 0); c.closePath(); c.fill();
  c.fillStyle = TEAL; c.fillRect(-6, -30, 12, 4); c.fillStyle = ORANGE; c.fillRect(-6, -10, 12, 2.4);
  c.fillStyle = '#23323e'; c.beginPath(); c.ellipse(0, -40, 3, 4.5, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(200,235,255,.7)'; c.beginPath(); c.ellipse(-1, -41.5, 1, 1.8, 0, 0, 7); c.fill();
  c.fillStyle = '#3a3532'; c.beginPath(); c.moveTo(-4, 0); c.lineTo(-5, 3); c.lineTo(5, 3); c.lineTo(4, 0); c.fill();
  // a tail fin facing the viewer
  c.fillStyle = '#6f7d82'; c.beginPath(); c.moveTo(-1.2, -14); c.lineTo(1.2, -14); c.lineTo(1.6, 3); c.lineTo(-1.6, 3); c.fill();
  c.restore();
}
Object.assign(ART, {
  xpad: { top: 92,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#55504a');
      // the blast deck: a scorched ring with hazard chevrons round its edge
      const m = P(x + 1.55, y + 1.5, z + 1); c.fillStyle = '#3e3935'; c.beginPath(); c.ellipse(m[0], m[1], 40, 20, 0, 0, 7); c.fill();
      const g = c.createRadialGradient(m[0], m[1], 2, m[0], m[1], 34); g.addColorStop(0, 'rgba(20,14,10,.85)'); g.addColorStop(1, 'rgba(20,14,10,0)'); c.fillStyle = g; c.beginPath(); c.ellipse(m[0], m[1], 34, 17, 0, 0, 7); c.fill();
      if (ARTV.lod > 0.6) for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283; c.fillStyle = k % 2 ? '#e8b030' : '#2a2420'; c.beginPath(); c.ellipse(m[0] + Math.cos(a) * 37, m[1] + Math.sin(a) * 18.5, 3.4, 1.7, a, 0, 7); c.fill(); }
      // gantry tower at the back with a swing arm
      const gp = P(x + 0.45, y + 0.45, z); lattice(c, gp[0], gp[1], 70, 7, '#c4b6a2', 7);
      if (ARTV.lod > 0.7) { c.strokeStyle = ORANGE; c.lineWidth = 1.6; c.beginPath(); c.moveTo(gp[0], gp[1] - 58); c.lineTo(m[0] - 6, m[1] - 50); c.stroke(); }
      // hangar on the right with a big door, and two fuel spheres
      box(c, x + 2.25, y + 0.25, 0.6, 1.5, z, 16, '#cfc2ae', { seams: 2, band: [0.6, 'rgba(79,179,176,.85)', 1.6], win: { n: 2, at: 0.62, h: 2.2, both: false } });
      if (ARTV.lod > 0.6) { const d0 = P(x + 2.25, y + 0.55, z), d1 = P(x + 2.25, y + 1.45, z); poly(c, [d0, d1, [d1[0], d1[1] - 12], [d0[0], d0[1] - 12]], '#4a4440'); }
      for (const [a, b2] of [[0.5, 2.45], [1.05, 2.6]]) sphere(c, x + a, y + b2, 0.26, z + 4, '#d9d0c4');
      pole(c, x + 2.7, y + 2.6, z, 26, '#8c8079', 1.4);
    },
    a(c, x, y, s, z, t, b, g) {
      const m = P(x + 1.55, y + 1.5, z + 1), tp = P(x + 2.7, y + 2.6, z + 26); light(c, tp[0], tp[1], '#ff5a3a', t, 2);
      if (!b || b._home !== false) drawSkimmer(c, m[0], m[1] - 2, t, false, 1);
      else if (g && g.on && ARTV.lod > 0.6) { c.fillStyle = 'rgba(255,220,150,' + (0.35 + 0.25 * Math.sin(t * 2)).toFixed(2) + ')'; for (let k = 0; k < 4; k++) { const a2 = t * 0.6 + k * 1.57; c.beginPath(); c.arc(m[0] + Math.cos(a2) * 30, m[1] + Math.sin(a2) * 15, 1.8, 0, 7); c.fill(); } }
    } },
  station: { top: 40,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#5c544e');
      const q = (a, b2, h) => P(x + a, y + b2, z + h);
      // a raised platform deck on pillars at guideway height, yellow safety edges
      for (const [a, b2] of [[0.3, 0.3], [1.7, 0.3], [0.3, 1.7], [1.7, 1.7]]) { const p0 = q(a, b2, 0); c.fillStyle = '#6f6862'; c.fillRect(p0[0] - 1.8, p0[1] - 7, 3.6, 7); c.fillStyle = '#4f4843'; c.fillRect(p0[0] + 0.4, p0[1] - 7, 1.4, 7); }
      box(c, x + 0.12, y + 0.12, 1.76, 1.76, z + 6, 2.4, '#b8ad9d');
      if (ARTV.lod > 0.7) { c.strokeStyle = '#e8b030'; c.lineWidth = 1.3; c.beginPath(); for (const [a0, b0, a1, b1] of [[0.2, 1.8, 1.8, 1.8], [1.8, 1.8, 1.8, 0.2], [0.2, 0.2, 1.8, 0.2], [0.2, 0.2, 0.2, 1.8]]) { const e0 = q(a0, b0, 8.6), e1 = q(a1, b1, 8.6); c.moveTo(e0[0], e0[1]); c.lineTo(e1[0], e1[1]); } c.stroke(); }
      // a lift tower and ticket hall at the back corner, with lit windows and a teal band
      box(c, x + 0.16, y + 0.16, 0.5, 0.5, z + 8.4, 13, '#d6cab8', { win: { n: 1, at: 0.6, h: 2.4 }, band: [0.9, 'rgba(79,179,176,.95)', 1.6] });
      // posts for the canopy
      for (const [a, b2] of [[0.22, 1.78], [1.78, 1.78], [1.78, 0.22]]) pole(c, x + a, y + b2, z + 8.4, 12, '#8c8079', 1.5);
    },
    a(c, x, y, s, z, t, b, g) { const sp = P(x + 0.41, y + 0.41, z + 24); const on = g && g.on; c.fillStyle = on ? (Math.sin(t * 1.3 + (b ? b.id : 0)) > 0 ? '#8fdc8a' : '#ffd84a') : '#5a5048'; c.beginPath(); c.arc(sp[0], sp[1], 2, 0, 7); c.fill(); if (on && ARTV.lod > 0.9) glow(c, sp[0], sp[1], 8, '160,240,160', 0.35); } },
  undergrove: { top: 84,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#4f4a40');
      const q = (a, b2, h) => P(x + a, y + b2, z + h), m = q(1.5, 1.5, 0);
      // an earth berm ring around a sunken garden
      c.fillStyle = '#6a5038'; c.beginPath(); c.ellipse(m[0], m[1], 60, 30, 0, 0, 7); c.fill();
      c.fillStyle = '#7f6244'; c.beginPath(); c.ellipse(m[0], m[1] - 5, 58, 29, 0, 0, 7); c.fill();
      if (ARTV.lod > 0.7) { c.fillStyle = 'rgba(120,150,70,.6)'; for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283; c.beginPath(); c.ellipse(m[0] + Math.cos(a) * 52, m[1] - 6 + Math.sin(a) * 26, 5, 2.2, 0, 0, 7); c.fill(); } }
      const g = c.createRadialGradient(m[0], m[1] - 2, 4, m[0], m[1] - 2, 50); g.addColorStop(0, '#2a3a2e'); g.addColorStop(1, '#1a2018'); c.fillStyle = g; c.beginPath(); c.ellipse(m[0], m[1] - 3, 48, 24, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(160,140,100,.5)'; c.lineWidth = 1; c.beginPath(); c.ellipse(m[0], m[1] - 3, 40, 20, 0, 0, 7); c.stroke();
      // pale fungal caps on the garden floor, back half first
      const cap = (a, r, h, rad) => { const p0 = [m[0] + Math.cos(a) * r * 46, m[1] - 3 + Math.sin(a) * r * 23]; c.strokeStyle = '#d8d0b8'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p0[0], p0[1] - h); c.stroke(); c.fillStyle = '#ede4cc'; c.beginPath(); c.ellipse(p0[0], p0[1] - h, rad, rad * 0.5, 0, Math.PI, 0); c.fill(); c.fillStyle = 'rgba(150,240,220,.5)'; c.beginPath(); c.ellipse(p0[0], p0[1] - h + 0.5, rad * 0.9, rad * 0.22, 0, 0, Math.PI); c.fill(); };
      for (let k = 0; k < 11; k++) { const a = k * 2.399 + 0.3, r = 0.35 + (k * 0.37) % 0.55; if (Math.sin(a) < 0) cap(a, r, 5 + (k % 3) * 3, 3 + (k % 2) * 2); }
      // the heart: a twisted pale stalk under a glass lantern
      const hp = q(1.5, 1.5, 0); c.strokeStyle = '#e8e0c8'; c.lineWidth = 3.4; c.beginPath(); c.moveTo(hp[0], hp[1] - 3); c.bezierCurveTo(hp[0] - 6, hp[1] - 16, hp[0] + 6, hp[1] - 26, hp[0], hp[1] - 38); c.stroke();
      for (const [dx, dy, r] of [[-8, -30, 5], [7, -34, 4], [0, -42, 6], [-4, -22, 3.5]]) { c.fillStyle = '#f2ead6'; c.beginPath(); c.arc(hp[0] + dx, hp[1] + dy, r, 0, 7); c.fill(); }
      c.strokeStyle = 'rgba(210,240,250,.55)'; c.lineWidth = 0.9; c.fillStyle = 'rgba(170,220,235,.16)'; c.beginPath(); c.ellipse(hp[0], hp[1] - 4, 26, 13, 0, Math.PI, 0); c.bezierCurveTo(hp[0] + 26, hp[1] - 62, hp[0] - 26, hp[1] - 62, hp[0] - 26, hp[1] - 4); c.fill(); c.stroke();
      if (ARTV.lod > 0.8) { c.beginPath(); for (let k = 1; k < 4; k++) { const f = k / 4; c.moveTo(hp[0] - 22 + 44 * f, hp[1] - 4 - Math.sin(f * Math.PI) * 2); c.quadraticCurveTo(hp[0] - 22 + 44 * f, hp[1] - 50, hp[0], hp[1] - 46); } c.stroke(); }
      // an entrance stair cut into the berm at the front
      poly(c, [q(1.3, 2.7, 4), q(1.7, 2.7, 4), q(1.7, 2.95, 0), q(1.3, 2.95, 0)], '#a8977e');
    },
    o(c, x, y, s, z) { const m = P(x + 1.5, y + 1.5, z); for (let k = 0; k < 11; k++) { const a = k * 2.399 + 0.3, r = 0.35 + (k * 0.37) % 0.55; if (Math.sin(a) < 0) continue; const p0 = [m[0] + Math.cos(a) * r * 46, m[1] - 3 + Math.sin(a) * r * 23], h = 5 + (k % 3) * 3, rad = 3 + (k % 2) * 2; c.strokeStyle = '#d8d0b8'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p0[0], p0[1] - h); c.stroke(); c.fillStyle = '#ede4cc'; c.beginPath(); c.ellipse(p0[0], p0[1] - h, rad, rad * 0.5, 0, Math.PI, 0); c.fill(); } },
    a(c, x, y, s, z, t, b, g) {
      if (!(g && g.on)) return; const hp = P(x + 1.5, y + 1.5, z);
      glow(c, hp[0], hp[1] - 30, 30 + 4 * Math.sin(t * 1.4), '140,255,220', 0.22 + 0.12 * ARTV.night);
      for (const [dx, dy] of [[-8, -30], [7, -34], [0, -42]]) { c.fillStyle = 'rgba(150,255,225,' + (0.45 + 0.35 * Math.sin(t * 2 + dx)).toFixed(2) + ')'; c.beginPath(); c.arc(hp[0] + dx, hp[1] + dy, 1.8, 0, 7); c.fill(); }
      if (ARTV.lod < 0.5) return;
      for (let k = 0; k < 7; k++) { const ph = (t * 0.09 + k / 7) % 1, a = k * 0.9 + t * 0.2; c.fillStyle = 'rgba(200,255,235,' + (0.6 * (1 - ph)).toFixed(2) + ')'; c.beginPath(); c.arc(hp[0] + Math.cos(a) * (8 + ph * 22), hp[1] - 40 - ph * 46 + Math.sin(a) * 4, 1.4, 0, 7); c.fill(); }
    } },
  relay: { top: 190,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#4e4a48');
      const q = (a, b2, h) => P(x + a, y + b2, z + h), b0 = q(1.5, 1.5, 0);
      // guy wires to three anchors
      if (ARTV.lod > 0.6) { c.strokeStyle = 'rgba(200,190,175,.55)'; c.lineWidth = 0.7; c.beginPath(); for (const [a, b2] of [[0.2, 0.4], [2.8, 0.6], [1.4, 2.85]]) { const an = q(a, b2, 0); c.moveTo(an[0], an[1]); c.lineTo(b0[0], b0[1] - 110); } c.stroke(); for (const [a, b2] of [[0.2, 0.4], [2.8, 0.6], [1.4, 2.85]]) box(c, x + a - 0.1, y + b2 - 0.1, 0.2, 0.2, z, 3, '#7a706a', { edge: false }); }
      // control block at the foot
      box(c, x + 1.85, y + 1.9, 0.9, 0.8, z, 11, '#cfc6b8', { win: { n: 2, at: 0.55, h: 2.2 }, door: 0.5, band: [0.85, 'rgba(180,140,255,.8)', 1.4] });
      // a tapering lattice mast, three legs drawn as a truss
      const H = 160, w0 = 16, w1 = 3;
      c.strokeStyle = '#c4b6a2'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(b0[0] - w0, b0[1]); c.lineTo(b0[0] - w1, b0[1] - H); c.moveTo(b0[0] + w0, b0[1]); c.lineTo(b0[0] + w1, b0[1] - H); c.moveTo(b0[0], b0[1] + 5); c.lineTo(b0[0], b0[1] - H); c.stroke();
      if (ARTV.lod > 0.5) { c.lineWidth = 0.7; c.strokeStyle = 'rgba(196,182,162,.85)'; c.beginPath(); const n = ARTV.lod > 1 ? 18 : 10; for (let k = 0; k < n; k++) { const f0 = k / n, f1 = (k + 1) / n, wa = w0 + (w1 - w0) * f0, wb = w0 + (w1 - w0) * f1; c.moveTo(b0[0] - wa, b0[1] - H * f0); c.lineTo(b0[0] + wb, b0[1] - H * f1); c.moveTo(b0[0] + wa, b0[1] - H * f0); c.lineTo(b0[0] - wb, b0[1] - H * f1); } c.stroke(); }
      // platforms on the way up
      for (const f of [0.35, 0.68]) { const wy = b0[1] - H * f, ww = w0 + (w1 - w0) * f + 4; c.fillStyle = '#8a7d70'; c.beginPath(); c.ellipse(b0[0], wy, ww, ww * 0.45, 0, 0, 7); c.fill(); }
    },
    a(c, x, y, s, z, t, b, g) {
      const b0 = P(x + 1.5, y + 1.5, z), top = b0[1] - 160, on = g && g.on;
      // the crown: a turning ring of dishes
      c.save(); c.translate(b0[0], top - 4); const a = on ? t * 0.5 : 0.3;
      c.strokeStyle = '#d8cfc2'; c.lineWidth = 1.6; c.beginPath(); c.ellipse(0, 0, 14, 5, 0, 0, 7); c.stroke();
      for (let k = 0; k < 4; k++) { const ang = a + k * 1.571, dx = Math.cos(ang) * 14, dy = Math.sin(ang) * 5; if (Math.sin(ang) < 0) continue; c.fillStyle = '#ece4d8'; c.beginPath(); c.ellipse(dx, dy - 2, 4.5, 3.4, Math.cos(ang) * 0.6, 0, 7); c.fill(); c.strokeStyle = '#8a7d70'; c.lineWidth = 0.6; c.stroke(); }
      c.fillStyle = '#9a8d80'; c.fillRect(-1.5, -14, 3, 12); c.restore();
      light(c, b0[0], top - 19, '#ff4a3a', t, 2.2);
      if (!on) return;
      // a pulse runs up the mast and a faint beam reaches for the ninth moon
      const ph = (t * 0.6) % 1; c.fillStyle = 'rgba(200,170,255,' + (0.8 * (1 - ph)).toFixed(2) + ')'; c.beginPath(); c.arc(b0[0], b0[1] - ph * 160, 2.4, 0, 7); c.fill();
      if (ARTV.night > 0.3) { const g2 = c.createLinearGradient(0, top - 20, 0, top - 260); g2.addColorStop(0, 'rgba(190,160,255,.45)'); g2.addColorStop(1, 'rgba(190,160,255,0)'); c.fillStyle = g2; c.beginPath(); c.moveTo(b0[0] - 2, top - 20); c.lineTo(b0[0] - 9, top - 260); c.lineTo(b0[0] + 9, top - 260); c.lineTo(b0[0] + 2, top - 20); c.fill(); }
    } },
  orrery: { top: 124,
    s(c, x, y, s, z) {
      pad(c, x, y, s, z, '#524a44');
      const m = P(x + 1.5, y + 1.5, z);
      // a stepped round plinth of dark stone with a bronze rim
      for (const [r, h, col] of [[44, 0, '#3e3834'], [38, 5, '#4c4540'], [30, 10, '#5a524c']]) { c.fillStyle = shade(col, -0.25); c.beginPath(); c.ellipse(m[0], m[1] - h + 2, r, r * 0.5, 0, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.ellipse(m[0], m[1] - h - 2, r, r * 0.5, 0, 0, 7); c.fill(); }
      c.strokeStyle = MAT.copper; c.lineWidth = 1.4; c.beginPath(); c.ellipse(m[0], m[1] - 12, 30, 15, 0, 0, 7); c.stroke();
      if (ARTV.lod > 0.8) { c.strokeStyle = 'rgba(255,210,150,.35)'; c.lineWidth = 0.7; c.beginPath(); for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283; c.moveTo(m[0] + Math.cos(a) * 26, m[1] - 12 + Math.sin(a) * 13); c.lineTo(m[0] + Math.cos(a) * 30, m[1] - 12 + Math.sin(a) * 15); } c.stroke(); }
      // the column that holds the sun
      c.fillStyle = '#7a5a3a'; c.fillRect(m[0] - 2.5, m[1] - 70, 5, 58); c.fillStyle = '#9a7248'; c.fillRect(m[0] - 2.5, m[1] - 70, 1.6, 58);
      for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283; if (Math.sin(a) > 0.2) continue; const px = x + 1.5 + Math.cos(a) * 1.25, py = y + 1.5 + Math.sin(a) * 1.25; box(c, px - 0.07, py - 0.07, 0.14, 0.14, z + 5, 14, '#6a605a', { edge: false }); }
    },
    a(c, x, y, s, z, t, b, g) {
      const m = P(x + 1.5, y + 1.5, z), cy = m[1] - 74, on = g && g.on, sp = on ? 1 : 0.05;
      // three tilted bronze rings turning at their own pace, with a planet on each
      const rings = [[54, 0.32, 0.2, '#c58b4e', 3.6], [40, -0.55, 0.33, '#d8a868', 3], [27, 0.95, 0.5, '#b07a44', 2.5]];
      const ring = (R0, tilt, spd, col, pr, back) => { c.save(); c.translate(m[0], cy); c.rotate(tilt); c.strokeStyle = col; c.lineWidth = back ? 1.6 : 2.4; c.beginPath(); c.ellipse(0, 0, R0, R0 * 0.36, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); c.stroke(); const a = t * spd * sp + R0; const px = Math.cos(a) * R0, py = Math.sin(a) * R0 * 0.36; if ((Math.sin(a) < 0) === back) { c.fillStyle = '#e8e0d0'; c.beginPath(); c.arc(px, py, pr, 0, 7); c.fill(); c.fillStyle = 'rgba(60,40,30,.5)'; c.beginPath(); c.arc(px + pr * 0.35, py + pr * 0.3, pr * 0.7, 0, 7); c.fill(); } c.restore(); };
      for (const r of rings) ring(r[0], r[1], r[2], r[3], r[4], true);
      // the sun at the centre
      if (on) glow(c, m[0], cy, 28, '255,200,120', 0.45 + 0.15 * Math.sin(t * 1.7));
      c.fillStyle = on ? '#ffd27a' : '#a08060'; c.beginPath(); c.arc(m[0], cy, 8, 0, 7); c.fill(); c.fillStyle = 'rgba(255,250,230,.75)'; c.beginPath(); c.arc(m[0] - 2, cy - 2, 2.2, 0, 7); c.fill();
      for (const r of rings) ring(r[0], r[1], r[2], r[3], r[4], false);
    } },
});
// ---------- the monorail guideway: a concrete beam on pylons, drawn tile by tile; planned track is a dashed line ----------
const RAIL_Z = 7;
function drawRail(c, G, vis, zs, t) {
  const n = MAP_N, L = G.rail, occ = G._occ; if (!L) return;
  const isSt = i => { const id = occ[i]; if (!id) return false; const b = KC.bById(G, id); return b && b.t === 'station'; };
  const conn = (x, y) => x >= 0 && y >= 0 && x < n && y < n && (L[y * n + x] || isSt(y * n + x));
  const segs = [], plan = [], posts = [];
  for (let i = 0; i < L.length; i++) {
    const v = L[i]; if (!v) continue;
    const x = i % n, y = (i / n) | 0, ax = isoX(x + 0.5, y + 0.5); if (!vis(ax, isoY(x + 0.5, y + 0.5, 0))) continue;
    const z0 = zs(x + 0.5, y + 0.5);
    let any = false;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (!conn(xx, yy)) continue; any = true;
      const other = L[yy * n + xx]; if ((dx < 0 || dy < 0) && other) continue; // each shared edge once
      const half = other ? 1 : 0.6, ex = x + 0.5 + dx * half, ey = y + 0.5 + dy * half;
      (v === 3 || other === 3 ? plan : segs).push([x + 0.5, y + 0.5, z0, ex, ey, zs(ex, ey)]);
    }
    if (!any) (v === 3 ? plan : segs).push([x + 0.5, y + 0.5, z0, x + 0.5, y + 0.5, z0]);
    if (v === 1 && (x + y) % 2 === 0) posts.push([x + 0.5, y + 0.5, z0]);
  }
  // planned track: a dashed amber line on the ground
  if (plan.length) { c.setLineDash([4, 3]); c.strokeStyle = 'rgba(255,200,110,.85)'; c.lineWidth = 2; c.beginPath(); for (const [x0, y0, z0, x1, y1, z1] of plan) { const a = P(x0, y0, z0 + 1), b = P(x1, y1, z1 + 1); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } c.stroke(); c.setLineDash([]); }
  if (!segs.length) return;
  // shadow on the ground, pylons, then the beam in three tones and the running rail on top
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(25,15,8,.28)'; c.lineWidth = 7; c.beginPath(); for (const [x0, y0, z0, x1, y1, z1] of segs) { const a = P(x0 + 0.18, y0 + 0.12, z0), b = P(x1 + 0.18, y1 + 0.12, z1); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } c.stroke();
  for (const [x0, y0, z0] of posts) { const a = P(x0, y0, z0), h = RAIL_Z; c.fillStyle = '#6a625b'; c.fillRect(a[0] - 2, a[1] - h, 4, h); c.fillStyle = '#4a433e'; c.fillRect(a[0] + 0.5, a[1] - h, 1.5, h); c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(a[0], a[1], 4, 2, 0, 0, 7); c.fill(); }
  const pass = (dz, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.beginPath(); for (const [x0, y0, z0, x1, y1, z1] of segs) { const a = P(x0, y0, z0 + RAIL_Z + dz), b = P(x1, y1, z1 + RAIL_Z + dz); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } c.stroke(); };
  pass(-1.6, 6.4, '#5f5852'); pass(0, 5.4, '#a49a8e'); pass(0.9, 3.4, '#cfc6b8'); pass(1.4, 1, '#7d8a90');
  c.lineCap = 'butt';
}
// ---------- trains: two to three cream cars with a teal window band, riding on the beam ----------
// cars of one train along its path, nearest the camera last; each car is an oriented box on the guideway
function trainCars(G, tr, frac) {
  const p = KC.trainPos(G, tr, frac); if (!p || !p.path) return [];
  const N0 = (() => { const R0 = KC.railOf(G); for (const L0 of R0.nets.values()) if (L0.key === tr.line) return L0; return null; })();
  const nc = N0 && N0.st.length > 3 ? 3 : 2, out = [];
  for (let k = 0; k < nc; k++) {
    const d = clamp(p.d - k * 1.05, 0, p.path.len - 0.001), q = pointAtPath(p.path, d);
    out.push({ x: q.x, y: q.y, dx: q.dx, dy: q.dy, head: k === 0, tail: k === nc - 1, k });
  }
  return out;
}
function pointAtPath(p, d) { let i = 1; while (i < p.cum.length - 1 && p.cum[i] < d) i++; const a = p.pts[i - 1], b = p.pts[i], seg = (p.cum[i] - p.cum[i - 1]) || 1, f = clamp((d - p.cum[i - 1]) / seg, 0, 1); return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, dx: b[0] - a[0], dy: b[1] - a[1] }; }
function drawTrainCar(c, car, z, t, lit, load) {
  const along = Math.abs(car.dx) >= Math.abs(car.dy), L0 = 0.96, W0 = 0.36, x = car.x + 0.5, y = car.y + 0.5, zz = z + RAIL_Z + 2;
  const bx = along ? x - L0 / 2 : x - W0 / 2, by = along ? y - W0 / 2 : y - L0 / 2, w = along ? L0 : W0, d = along ? W0 : L0;
  // undercarriage hugging the beam
  box(c, bx + (along ? 0.08 : 0.06), by + (along ? 0.06 : 0.08), w - (along ? 0.16 : 0.12), d - (along ? 0.12 : 0.16), zz - 2, 2.4, '#4a4440', { edge: false });
  const top = box(c, bx, by, w, d, zz, 6.6, '#e4dccf', { win: { n: along ? 4 : 1, at: 0.58, h: 2.2, both: true }, band: [0.36, 'rgba(79,179,176,.95)', 1.6] });
  // a lighter roof stripe and, on the lead car, an orange nose and a headlight
  poly(c, [P(bx + (along ? 0.1 : 0.12), by + (along ? 0.12 : 0.1), zz + 6.7), P(bx + w - (along ? 0.1 : 0.12), by + (along ? 0.12 : 0.1), zz + 6.7), P(bx + w - (along ? 0.1 : 0.12), by + d - (along ? 0.12 : 0.1), zz + 6.7), P(bx + (along ? 0.1 : 0.12), by + d - (along ? 0.12 : 0.1), zz + 6.7)], 'rgba(255,252,246,.55)');
  if (load && load.cargo && car.k > 0) { for (let k = 0; k < 2; k++) box(c, along ? bx + 0.18 + k * 0.36 : bx + 0.06, along ? by + 0.06 : by + 0.18 + k * 0.36, along ? 0.28 : 0.28, along ? 0.28 : 0.28, zz + 6.7, 3, k ? '#c58b4e' : '#7d8f9a', { edge: false }); }
  if (car.head) {
    const fx = along ? (car.dx >= 0 ? bx + w : bx) : x, fy = along ? y : (car.dy >= 0 ? by + d : by), np = P(fx, fy, zz + 3.5);
    c.fillStyle = ORANGE; c.beginPath(); c.arc(np[0], np[1], 2.6, 0, 7); c.fill();
    c.fillStyle = '#fff6d8'; c.beginPath(); c.arc(np[0], np[1] - 1, 1.3, 0, 7); c.fill();
    if (ARTV.night > 0.3) glow(c, np[0], np[1], 14, '255,240,200', 0.5 * ARTV.night);
  }
  return top;
}
// the station canopy: a glass pavilion roof drawn just after the trains standing under it
function drawStationRoof(c, b, z, t, lit) {
  const x = b.x, y = b.y, q = (a, b2, h) => P(x + a, y + b2, z + h), H0 = 20.4, H1 = 28;
  const c0 = q(0.1, 0.1, H0), c1 = q(1.9, 0.1, H0), c2 = q(1.9, 1.9, H0), c3 = q(0.1, 1.9, H0), ap = q(1, 1, H1);
  // back faces, then the two faces towards the camera, glass with ribs and a teal fascia
  poly(c, [c0, c1, ap], 'rgba(150,170,175,.55)'); poly(c, [c0, c3, ap], 'rgba(170,190,195,.55)');
  poly(c, [c3, c2, ap], lit ? 'rgba(255,224,170,.42)' : 'rgba(200,226,236,.5)', 'rgba(240,250,255,.55)', 0.8);
  poly(c, [c1, c2, ap], lit ? 'rgba(230,190,140,.38)' : 'rgba(150,186,200,.5)', 'rgba(240,250,255,.45)', 0.8);
  if (ARTV.lod > 0.8) { c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 0.6; c.beginPath(); for (const f of [0.33, 0.66]) { const m1 = [c3[0] + (c2[0] - c3[0]) * f, c3[1] + (c2[1] - c3[1]) * f], m2 = [c1[0] + (c2[0] - c1[0]) * f, c1[1] + (c2[1] - c1[1]) * f]; c.moveTo(m1[0], m1[1]); c.lineTo(ap[0], ap[1]); c.moveTo(m2[0], m2[1]); c.lineTo(ap[0], ap[1]); } c.stroke(); }
  c.strokeStyle = 'rgba(79,179,176,.95)'; c.lineWidth = 1.8; c.beginPath(); c.moveTo(c3[0], c3[1]); c.lineTo(c2[0], c2[1]); c.lineTo(c1[0], c1[1]); c.stroke();
  c.fillStyle = '#d8d0c4'; c.beginPath(); c.arc(ap[0], ap[1], 1.6, 0, 7); c.fill();
}
