// ===== art.js : improvement, resource, camp and wonder art (painted once per zoom and cached) =====
const ART_INK = 'rgba(28,20,12,.85)';
function artPoly(x, pts, fill, ink, lw) { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); if (ink) { x.strokeStyle = ink; x.lineWidth = lw; x.stroke(); } if (fill) { x.fillStyle = fill; x.fill(); } }
function artShadow(x, cx, cy, rx, ry) { x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 6.283); x.fill(); }

// Ground improvements are painted flat across the tile (and squashed with the map in 3D); the rest
// are small upright vignettes in the lower-left of the tile.
const IMP_GROUND = new Set(['farm', 'plantation']);
function drawImprovementSprite(x, key, v, R) {
  const rnd = lcg(key.length * 71 + v * 17 + 5), L = Math.max(1, R * 0.03);
  x.lineJoin = 'round'; x.lineCap = 'round';
  if (key === 'farm') {
    x.save(); x.beginPath(); hexPath(x, 0, 0, R * 0.8); x.clip();
    // patchwork of three or four fields split by hedgerows, each with furrows at its own angle
    const crops = [['#d6c060', '#bfa64a'], ['#9cc054', '#84a844'], ['#cfae62', '#b8964e'], ['#e0cf80', '#cbb86a'], ['#a8c464', '#90ac50']];
    const cut = (rnd() - 0.5) * R * 0.4, cut2 = (rnd() - 0.5) * R * 0.4;
    const parcels = [
      [[-R, -R], [cut, -R], [cut2, 0], [-R, 0]], [[cut, -R], [R, -R], [R, 0], [cut2, 0]],
      [[-R, 0], [cut2 + R * 0.15, 0], [cut2 - R * 0.05, R], [-R, R]], [[cut2 + R * 0.15, 0], [R, 0], [R, R], [cut2 - R * 0.05, R]]];
    parcels.forEach((pp, k) => {
      const [c0, c1] = crops[(v + k * 2) % crops.length];
      x.save(); x.beginPath(); pp.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.clip();
      x.fillStyle = c0; x.fillRect(-R, -R, 2 * R, 2 * R);
      const ang = ((v + k) % 3) * 0.5 - 0.4; x.rotate(ang);
      x.strokeStyle = c1; x.lineWidth = L * 1.1;
      x.beginPath(); for (let q = -8; q <= 8; q++) { x.moveTo(-R * 1.4, q * R * 0.11); x.lineTo(R * 1.4, q * R * 0.11); } x.stroke();
      x.restore();
    });
    // hedgerows
    x.strokeStyle = 'rgba(76,106,42,.85)'; x.lineWidth = L * 2; x.beginPath(); x.moveTo(cut, -R); x.lineTo(cut2, 0); x.moveTo(-R, 0); x.lineTo(R, 0); x.moveTo(cut2 + R * 0.15, 0); x.lineTo(cut2 - R * 0.05, R); x.stroke();
    x.fillStyle = '#5f8436'; for (let k = 0; k < 6; k++) { const t = rnd(); x.beginPath(); x.arc(-R + t * 2 * R, (rnd() - 0.5) * L * 2, L * 1.8, 0, 6.283); x.fill(); }
    x.restore();
    x.strokeStyle = 'rgba(60,45,20,.35)'; x.lineWidth = L; x.beginPath(); hexPath(x, 0, 0, R * 0.8); x.stroke();
    return;
  }
  if (key === 'plantation') {
    x.save(); x.beginPath(); hexPath(x, 0, 0, R * 0.78); x.clip();
    x.fillStyle = 'rgba(90,60,30,.35)'; x.fillRect(-R, -R, 2 * R, 2 * R);
    for (let r = -3; r <= 3; r++) for (let c = -4; c <= 4; c++) {
      const bx = c * R * 0.22 + (r & 1) * R * 0.11, by = r * R * 0.2;
      x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse(bx + R * 0.02, by + R * 0.04, R * 0.08, R * 0.04, 0, 0, 6.283); x.fill();
      x.fillStyle = '#2f6b2c'; x.beginPath(); x.arc(bx, by, R * 0.075, 0, 6.283); x.fill();
      x.fillStyle = '#5ea648'; x.beginPath(); x.arc(bx - R * 0.02, by - R * 0.02, R * 0.04, 0, 6.283); x.fill();
      if ((r + c + v) % 3 === 0) { x.fillStyle = '#e04a3a'; x.beginPath(); x.arc(bx + R * 0.03, by + R * 0.01, R * 0.015, 0, 6.283); x.fill(); }
    }
    x.restore(); return;
  }
  // vignettes: centred at 0,0 with half-size r
  const r = R * 0.4, lw = Math.max(1, r * 0.07);
  switch (key) {
    case 'mine': {
      artShadow(x, 0, r * 0.62, r * 1.05, r * 0.26);
      const g = x.createLinearGradient(-r, -r, r, r * 0.6); g.addColorStop(0, '#9a8466'); g.addColorStop(1, '#5a4a36');
      artPoly(x, [[-r, r * 0.6], [-r * 0.5, -r * 0.55], [-r * 0.05, -r * 0.8], [r * 0.5, -r * 0.45], [r, r * 0.6]], g, ART_INK, lw);
      artPoly(x, [[-r * 0.38, r * 0.6], [-r * 0.38, -r * 0.02], [0, -r * 0.3], [r * 0.38, -r * 0.02], [r * 0.38, r * 0.6]], '#140e08');
      x.strokeStyle = '#b07e45'; x.lineWidth = r * 0.14; x.beginPath(); x.moveTo(-r * 0.44, r * 0.6); x.lineTo(-r * 0.44, -r * 0.08); x.lineTo(r * 0.44, -r * 0.08); x.lineTo(r * 0.44, r * 0.6); x.stroke();
      x.strokeStyle = '#8c8c94'; x.lineWidth = lw; x.beginPath(); x.moveTo(-r * 0.2, r * 0.62); x.lineTo(r * 0.9, r * 0.75); x.moveTo(-r * 0.05, r * 0.58); x.lineTo(r * 0.95, r * 0.66); x.stroke();
      artPoly(x, [[r * 0.45, r * 0.38], [r * 0.95, r * 0.42], [r * 0.88, r * 0.66], [r * 0.5, r * 0.62]], '#6a5a48', ART_INK, lw);
      x.fillStyle = '#c9a04a'; for (const [a, b] of [[0.58, 0.34], [0.72, 0.32], [0.84, 0.37]]) { x.beginPath(); x.arc(a * r, b * r, r * 0.08, 0, 6.283); x.fill(); }
      break; }
    case 'quarry': {
      artShadow(x, 0, r * 0.55, r * 1.05, r * 0.3);
      artPoly(x, [[-r, r * 0.55], [-r * 0.8, -r * 0.15], [r * 0.8, -r * 0.25], [r, r * 0.55]], '#b9b1a2', ART_INK, lw);
      artPoly(x, [[-r * 0.6, r * 0.45], [-r * 0.5, 0], [r * 0.5, -r * 0.08], [r * 0.62, r * 0.45]], '#8a8274');
      for (const [a, b, w] of [[-0.55, 0.12, 0.42], [-0.08, 0.16, 0.44], [-0.3, -0.18, 0.4], [0.25, -0.22, 0.36]]) { artPoly(x, [[a * r, b * r], [(a + w) * r, b * r], [(a + w) * r, (b + 0.26) * r], [a * r, (b + 0.26) * r]], '#e3dccb', ART_INK, lw * 0.7); x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect((a + w * 0.65) * r, b * r, w * 0.35 * r, 0.26 * r); }
      x.strokeStyle = '#6a4a2a'; x.lineWidth = lw * 1.3; x.beginPath(); x.moveTo(r * 0.7, r * 0.45); x.lineTo(r * 0.75, -r * 0.8); x.lineTo(r * 0.1, -r * 0.6); x.stroke();
      x.strokeStyle = '#3a2a1a'; x.lineWidth = lw * 0.6; x.beginPath(); x.moveTo(r * 0.12, -r * 0.6); x.lineTo(r * 0.12, -r * 0.3); x.stroke();
      break; }
    case 'lumbermill': {
      artShadow(x, 0, r * 0.62, r * 1.05, r * 0.26);
      artPoly(x, [[-r * 0.2, r * 0.3], [-r * 0.2, -r * 0.35], [r * 0.85, -r * 0.35], [r * 0.85, r * 0.3]], '#a0784a', ART_INK, lw);
      artPoly(x, [[-r * 0.3, -r * 0.33], [r * 0.32, -r * 0.82], [r * 0.95, -r * 0.33]], '#6a4428', ART_INK, lw);
      x.fillStyle = '#2a1a10'; x.fillRect(r * 0.2, -r * 0.1, r * 0.28, r * 0.4);
      for (let k = 0; k < 3; k++) { const ly = r * (0.48 - k * 0.2), lx = -r * 0.55 + k * r * 0.08; artPoly(x, [[lx - r * 0.42, ly - r * 0.1], [lx + r * 0.32, ly - r * 0.1], [lx + r * 0.32, ly + r * 0.1], [lx - r * 0.42, ly + r * 0.1]], '#8a5a30', ART_INK, lw * 0.7); x.fillStyle = '#e1b77c'; x.beginPath(); x.arc(lx + r * 0.32, ly, r * 0.1, 0, 6.283); x.fill(); x.strokeStyle = '#8a5a30'; x.lineWidth = lw * 0.5; x.beginPath(); x.arc(lx + r * 0.32, ly, r * 0.05, 0, 6.283); x.stroke(); }
      x.fillStyle = '#c9ccd2'; x.beginPath(); x.arc(r * 0.88, -r * 0.05, r * 0.22, 0, 6.283); x.fill(); x.strokeStyle = ART_INK; x.lineWidth = lw * 0.7; x.stroke();
      x.fillStyle = '#555a62'; x.beginPath(); x.arc(r * 0.88, -r * 0.05, r * 0.06, 0, 6.283); x.fill();
      break; }
    case 'pasture': {
      x.strokeStyle = '#7a5530'; x.lineWidth = lw;
      const fence = (pts) => { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a * r, b * r) : x.moveTo(a * r, b * r)); x.stroke(); };
      fence([[-1, 0.0], [0.0, -0.4], [1, 0.0]]); fence([[-1, 0.25], [0.0, -0.15], [1, 0.25]]);
      x.lineWidth = lw * 1.4; for (const [a, b] of [[-1, 0.0], [-0.5, -0.2], [0, -0.4], [0.5, -0.2], [1, 0.0]]) fence([[a, b - 0.1], [a, b + 0.35]]);
      const sheep = (sx, sy, s) => { artShadow(x, sx + s * 0.1, sy + s * 0.5, s * 0.7, s * 0.18); x.strokeStyle = '#2a2420'; x.lineWidth = s * 0.14; x.beginPath(); x.moveTo(sx - s * 0.3, sy + s * 0.2); x.lineTo(sx - s * 0.3, sy + s * 0.5); x.moveTo(sx + s * 0.3, sy + s * 0.2); x.lineTo(sx + s * 0.3, sy + s * 0.5); x.stroke();
        x.fillStyle = '#f2eee4'; x.strokeStyle = ART_INK; x.lineWidth = lw * 0.7; x.beginPath(); x.ellipse(sx, sy, s * 0.55, s * 0.36, 0, 0, 6.283); x.stroke(); x.fill();
        x.fillStyle = '#2a2420'; x.beginPath(); x.ellipse(sx + s * 0.55, sy - s * 0.08, s * 0.18, s * 0.14, 0, 0, 6.283); x.fill(); };
      sheep(-r * 0.35, r * 0.55, r * 0.42); sheep(r * 0.45, r * 0.62, r * 0.38);
      break; }
    case 'camp': {
      artShadow(x, 0, r * 0.62, r * 1.0, r * 0.24);
      artPoly(x, [[-r * 0.9, r * 0.6], [-r * 0.2, -r * 0.75], [r * 0.5, r * 0.6]], '#c9a36b', ART_INK, lw);
      artPoly(x, [[-r * 0.2, -r * 0.75], [r * 0.5, r * 0.6], [r * 0.05, r * 0.6]], '#a07a48');
      artPoly(x, [[-r * 0.38, r * 0.6], [-r * 0.2, r * 0.05], [-r * 0.02, r * 0.6]], '#3b2716');
      x.strokeStyle = '#5a3d22'; x.lineWidth = lw; x.beginPath(); x.moveTo(-r * 0.32, -r * 0.95); x.lineTo(-r * 0.08, -r * 0.55); x.moveTo(-r * 0.08, -r * 0.95); x.lineTo(-r * 0.32, -r * 0.55); x.stroke();
      // drying rack with a pelt and a small fire
      x.beginPath(); x.moveTo(r * 0.6, r * 0.55); x.lineTo(r * 0.6, -r * 0.2); x.moveTo(r * 1.0, r * 0.55); x.lineTo(r * 1.0, -r * 0.2); x.moveTo(r * 0.55, -r * 0.15); x.lineTo(r * 1.05, -r * 0.15); x.stroke();
      artPoly(x, [[r * 0.66, -r * 0.15], [r * 0.94, -r * 0.15], [r * 0.9, r * 0.25], [r * 0.8, r * 0.18], [r * 0.7, r * 0.25]], '#b06a34', ART_INK, lw * 0.6);
      x.fillStyle = '#ffb04a'; x.beginPath(); x.moveTo(r * 0.72, r * 0.72); x.quadraticCurveTo(r * 0.78, r * 0.42, r * 0.8, r * 0.5); x.quadraticCurveTo(r * 0.86, r * 0.4, r * 0.9, r * 0.72); x.fill();
      break; }
    case 'boats': {
      x.strokeStyle = 'rgba(230,240,250,.55)'; x.lineWidth = lw * 0.8; x.beginPath(); x.ellipse(0, r * 0.45, r * 0.95, r * 0.15, 0, 0, 6.283); x.stroke();
      artPoly(x, [[-r * 0.8, r * 0.15], [r * 0.8, r * 0.15], [r * 0.52, r * 0.48], [-r * 0.52, r * 0.48]], '#7a5232', ART_INK, lw);
      x.strokeStyle = '#3a2a18'; x.lineWidth = lw; x.beginPath(); x.moveTo(-r * 0.1, r * 0.15); x.lineTo(-r * 0.1, -r * 0.8); x.stroke();
      artPoly(x, [[-r * 0.05, -r * 0.75], [r * 0.55, r * 0.05], [-r * 0.05, r * 0.05]], '#efe4cc', ART_INK, lw * 0.7);
      // net and floats
      x.strokeStyle = 'rgba(240,230,200,.6)'; x.lineWidth = lw * 0.5; x.beginPath(); x.moveTo(r * 0.7, r * 0.2); x.quadraticCurveTo(r * 1.0, r * 0.5, r * 0.6, r * 0.7); x.stroke();
      x.fillStyle = '#e04a3a'; for (const [a, b] of [[0.9, 0.45], [0.75, 0.66], [-0.85, 0.6]]) { x.beginPath(); x.arc(a * r, b * r, r * 0.06, 0, 6.283); x.fill(); }
      break; }
    case 'fort': {
      artShadow(x, 0, r * 0.6, r * 1.1, r * 0.3);
      // earthwork ring with a palisade and a watchtower
      x.fillStyle = '#8a7a52'; x.beginPath(); x.ellipse(0, r * 0.3, r * 1.0, r * 0.42, 0, 0, 6.283); x.fill(); x.strokeStyle = ART_INK; x.lineWidth = lw; x.stroke();
      x.fillStyle = '#6d8a46'; x.beginPath(); x.ellipse(0, r * 0.26, r * 0.7, r * 0.26, 0, 0, 6.283); x.fill();
      for (let k = -4; k <= 4; k++) { const px = k * r * 0.21, py = r * 0.3 + Math.sqrt(Math.max(0, 1 - (k / 4.6) ** 2)) * r * 0.36; artPoly(x, [[px - r * 0.08, py], [px - r * 0.08, py - r * 0.42], [px, py - r * 0.55], [px + r * 0.08, py - r * 0.42], [px + r * 0.08, py]], k & 1 ? '#8a6236' : '#9a7040', ART_INK, lw * 0.6); }
      artPoly(x, [[-r * 0.2, -r * 0.05], [-r * 0.2, -r * 0.8], [r * 0.2, -r * 0.8], [r * 0.2, -r * 0.05]], '#7a5530', ART_INK, lw * 0.8);
      artPoly(x, [[-r * 0.32, -r * 0.8], [0, -r * 1.05], [r * 0.32, -r * 0.8]], '#5a3a20', ART_INK, lw * 0.8);
      x.strokeStyle = '#3a2a1a'; x.lineWidth = lw * 0.6; x.beginPath(); x.moveTo(0, -r * 1.05); x.lineTo(0, -r * 1.35); x.stroke();
      artPoly(x, [[0, -r * 1.35], [r * 0.35, -r * 1.25], [0, -r * 1.15]], '#c0392b');
      break; }
    default: return false;
  }
  return true;
}

// Resource medallions: a small painted object on a disc ringed in the resource kind's colour.
const RES_RING = { bonus: ['#7fd38a', '#14301d'], strategic: ['#f0a060', '#3a1c0e'], luxury: ['#d99af0', '#2e1438'] };
function resourceCanvas(key, kind, px, dpr) {
  const s = Math.ceil(px * 2.3 * dpr), c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d'), r = px * dpr; x.translate(s / 2, s / 2); x.lineJoin = 'round'; x.lineCap = 'round';
  const [ring, bg] = RES_RING[kind] || RES_RING.bonus;
  x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.arc(r * 0.06, r * 0.1, r, 0, 6.283); x.fill();
  const g = x.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.1, 0, 0, r); g.addColorStop(0, shade(bg, 0.28)); g.addColorStop(1, bg);
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, 6.283); x.fill();
  x.strokeStyle = ring; x.lineWidth = Math.max(1.2, r * 0.13); x.beginPath(); x.arc(0, 0, r * 0.93, 0, 6.283); x.stroke();
  paintResource(x, key, r * 0.72);
  return c;
}
function paintResource(x, key, r) {
  const lw = Math.max(1, r * 0.09), ink = 'rgba(14,10,6,.9)';
  const P = (pts, fill) => artPoly(x, pts.map(([a, b]) => [a * r, b * r]), fill, ink, lw);
  const E = (cx, cy, rx, ry, fill, rot) => { x.beginPath(); x.ellipse(cx * r, cy * r, rx * r, ry * r, rot || 0, 0, 6.283); x.strokeStyle = ink; x.lineWidth = lw; x.stroke(); x.fillStyle = fill; x.fill(); };
  const Ln = (pts, w, col) => { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a * r, b * r) : x.moveTo(a * r, b * r)); x.strokeStyle = ink; x.lineWidth = w * r + lw * 1.6; x.stroke(); x.strokeStyle = col; x.lineWidth = w * r; x.stroke(); };
  switch (key) {
    case 'wheat': for (const dx of [-0.35, 0, 0.35]) { Ln([[dx * 0.6, 0.9], [dx, -0.1]], 0.07, '#c9a03a'); for (let k = 0; k < 4; k++) { E(dx - 0.09, -0.15 - k * 0.2, 0.08, 0.13, '#f2cf5a', -0.5); E(dx + 0.09, -0.15 - k * 0.2, 0.08, 0.13, '#e8c04a', 0.5); } } break;
    case 'cattle': E(-0.7, -0.45, 0.25, 0.1, '#e8e0cc', -0.4); E(0.7, -0.45, 0.25, 0.1, '#e8e0cc', 0.4); P([[-0.55, -0.6], [0.55, -0.6], [0.45, 0.35], [0, 0.85], [-0.45, 0.35]], '#f4f0e8'); E(0.15, -0.25, 0.22, 0.16, '#2a2420'); E(0, 0.5, 0.32, 0.24, '#e8a8a0'); E(-0.12, 0.5, 0.05, 0.05, '#4a2a2a'); E(0.12, 0.5, 0.05, 0.05, '#4a2a2a'); break;
    case 'deer': Ln([[-0.2, -0.45], [-0.45, -0.95], [-0.7, -0.8]], 0.08, '#d9c09a'); Ln([[-0.38, -0.8], [-0.25, -0.98]], 0.07, '#d9c09a'); Ln([[0.2, -0.45], [0.45, -0.95], [0.7, -0.8]], 0.08, '#d9c09a'); Ln([[0.38, -0.8], [0.25, -0.98]], 0.07, '#d9c09a');
      E(-0.42, -0.4, 0.2, 0.1, '#a8703a', -0.5); E(0.42, -0.4, 0.2, 0.1, '#a8703a', 0.5); P([[-0.35, -0.5], [0.35, -0.5], [0.22, 0.45], [0, 0.8], [-0.22, 0.45]], '#b47a40'); E(0, 0.62, 0.12, 0.1, '#2a1a10'); E(-0.15, -0.15, 0.05, 0.06, '#1a1008'); E(0.15, -0.15, 0.05, 0.06, '#1a1008'); break;
    case 'fish': P([[-0.85, 0], [-0.35, -0.42], [0.35, -0.38], [0.7, 0], [0.35, 0.38], [-0.35, 0.42]], '#8ec8e8'); P([[0.62, 0], [0.98, -0.42], [0.98, 0.42]], '#6aa8d0'); x.fillStyle = 'rgba(255,255,255,.55)'; x.beginPath(); x.ellipse(-0.15 * r, -0.15 * r, 0.4 * r, 0.1 * r, 0, 0, 6.283); x.fill(); E(-0.52, -0.06, 0.07, 0.07, '#1a2a3a'); break;
    case 'stone': P([[-0.85, 0.7], [-0.85, 0.15], [-0.05, 0.15], [-0.05, 0.7]], '#c9c3b6'); P([[0.05, 0.7], [0.05, 0.15], [0.85, 0.15], [0.85, 0.7]], '#b3ad9f'); P([[-0.45, 0.05], [-0.45, -0.55], [0.45, -0.55], [0.45, 0.05]], '#ddd7ca'); break;
    case 'horses': P([[-0.5, 0.9], [-0.55, 0.2], [-0.3, -0.45], [-0.05, -0.85], [0.1, -0.55], [0.7, -0.15], [0.75, 0.15], [0.5, 0.25], [0.15, 0.05], [0.1, 0.4], [0.3, 0.9]], '#9a5a30');
      Ln([[-0.32, -0.5], [-0.55, -0.1], [-0.6, 0.4]], 0.12, '#3a2414'); E(0.1, -0.3, 0.07, 0.07, '#1a1008'); break;
    case 'iron': P([[-0.85, 0.55], [-0.6, 0.15], [0.35, 0.15], [0.1, 0.55]], '#7c8592'); P([[-0.35, 0.15], [-0.1, -0.25], [0.85, -0.25], [0.6, 0.15]], '#9aa3b0'); P([[-0.1, -0.25], [0.15, -0.65], [0.7, -0.65], [0.45, -0.25]], '#b8c0cc'); x.fillStyle = 'rgba(255,255,255,.55)'; x.fillRect(0.2 * r, -0.58 * r, 0.3 * r, 0.06 * r); break;
    case 'saltpeter': P([[-0.9, 0.7], [0, -0.1], [0.9, 0.7]], '#a8865a'); for (const [a, b, h] of [[-0.35, 0.3, 0.55], [0.1, 0.2, 0.75], [0.45, 0.4, 0.45]]) P([[a - 0.13, b], [a, b - h], [a + 0.13, b]], '#f4f4ee'); break;
    case 'silk': E(0, 0, 0.62, 0.62, '#e48ab8'); E(0, 0, 0.62, 0.62, 'rgba(0,0,0,0)'); x.strokeStyle = '#b85a8a'; x.lineWidth = lw * 0.8; for (let k = -2; k <= 2; k++) { x.beginPath(); x.moveTo(-0.55 * r, k * 0.2 * r); x.lineTo(0.55 * r, k * 0.2 * r); x.stroke(); } P([[-0.8, -0.75], [0.8, -0.75], [0.8, -0.55], [-0.8, -0.55]], '#c9a46a'); P([[-0.8, 0.55], [0.8, 0.55], [0.8, 0.75], [-0.8, 0.75]], '#c9a46a'); break;
    case 'spices': P([[-0.7, 0.85], [-0.8, 0.0], [-0.45, -0.35], [0.45, -0.35], [0.8, 0.0], [0.7, 0.85]], '#c9a46a'); E(0, -0.35, 0.48, 0.18, '#d8461e'); x.fillStyle = '#ff8a3a'; for (const [a, b] of [[-0.2, -0.42], [0.15, -0.38], [0, -0.48]]) { x.beginPath(); x.arc(a * r, b * r, 0.06 * r, 0, 6.283); x.fill(); } Ln([[-0.45, -0.35], [0.45, -0.35]], 0.06, '#7a5a2a'); break;
    case 'gems': P([[-0.7, -0.25], [-0.35, -0.7], [0.35, -0.7], [0.7, -0.25], [0, 0.85]], '#4ad0e8'); P([[-0.7, -0.25], [0.7, -0.25], [0, 0.85]], '#2aa0c8'); P([[-0.35, -0.7], [0, -0.25], [0.35, -0.7]], '#9af0ff'); break;
    case 'wine': Ln([[0, -0.6], [0.15, -0.95]], 0.07, '#6a4a2a'); E(0.4, -0.75, 0.3, 0.16, '#5ea648', -0.4); for (const [a, b] of [[-0.3, -0.35], [0.0, -0.4], [0.3, -0.35], [-0.15, -0.05], [0.15, -0.05], [-0.3, 0.25], [0.3, 0.25], [0, 0.25], [-0.15, 0.55], [0.15, 0.55], [0, 0.82]]) E(a, b, 0.17, 0.17, '#7a3a9a'); break;
    case 'furs': P([[-0.6, -0.6], [-0.25, -0.3], [0.25, -0.3], [0.6, -0.6], [0.55, 0.0], [0.3, 0.3], [0.15, 0.9], [-0.15, 0.9], [-0.3, 0.3], [-0.55, 0.0]], '#d8823a'); P([[-0.25, -0.1], [0.25, -0.1], [0.12, 0.6], [-0.12, 0.6]], '#f4e4cc'); E(-0.2, -0.32, 0.05, 0.05, '#1a1008'); E(0.2, -0.32, 0.05, 0.05, '#1a1008'); break;
    case 'pearls': P([[-0.9, 0.2], [-0.6, -0.4], [0, -0.6], [0.6, -0.4], [0.9, 0.2]], '#b8a8c8'); P([[-0.9, 0.2], [0.9, 0.2], [0.5, 0.7], [-0.5, 0.7]], '#9a8aae'); E(0, 0.12, 0.28, 0.28, '#fdfbf6'); x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(-0.08 * r, 0.04 * r, 0.08 * r, 0, 6.283); x.fill(); break;
    default: return false;
  }
  return true;
}

// Barbarian camp: a palisade of sharpened stakes around a hide tent and a skull banner.
function drawBarbCamp(x, r) {
  const lw = Math.max(1, r * 0.06);
  artShadow(x, 0, r * 0.5, r * 1.1, r * 0.32);
  x.fillStyle = '#5a4a32'; x.beginPath(); x.ellipse(0, r * 0.3, r * 0.95, r * 0.38, 0, 0, 6.283); x.fill();
  artPoly(x, [[-r * 0.55, r * 0.35], [-r * 0.1, -r * 0.55], [r * 0.4, r * 0.35]], '#8a6a4a', ART_INK, lw);
  artPoly(x, [[-r * 0.25, r * 0.35], [-r * 0.1, -r * 0.05], [r * 0.05, r * 0.35]], '#2a1a10');
  x.fillStyle = '#ffb04a'; x.beginPath(); x.moveTo(r * 0.5, r * 0.4); x.quadraticCurveTo(r * 0.56, r * 0.1, r * 0.6, r * 0.2); x.quadraticCurveTo(r * 0.66, r * 0.05, r * 0.7, r * 0.4); x.fill();
  for (let k = -5; k <= 5; k++) { const a = k / 5.5 * Math.PI * 0.5, px = Math.sin(a) * r * 0.98, py = r * 0.3 + Math.cos(a) * r * 0.38; artPoly(x, [[px - r * 0.07, py], [px - r * 0.07, py - r * 0.36], [px, py - r * 0.48], [px + r * 0.07, py - r * 0.36], [px + r * 0.07, py]], k & 1 ? '#7a5430' : '#6a4626', ART_INK, lw * 0.6); }
  x.strokeStyle = '#2a1a10'; x.lineWidth = lw; x.beginPath(); x.moveTo(r * 0.75, r * 0.2); x.lineTo(r * 0.75, -r * 0.95); x.stroke();
  artPoly(x, [[r * 0.75, -r * 0.95], [r * 1.25, -r * 0.85], [r * 1.12, -r * 0.65], [r * 1.25, -r * 0.45], [r * 0.75, -r * 0.5]], '#9b2f2a', ART_INK, lw * 0.7);
  x.fillStyle = '#efe6d2'; x.beginPath(); x.arc(r * 0.98, -r * 0.72, r * 0.1, 0, 6.283); x.fill(); x.fillRect(r * 0.93, -r * 0.66, r * 0.1, r * 0.07);
  x.fillStyle = '#2a1a10'; x.fillRect(r * 0.93, -r * 0.74, r * 0.035, r * 0.035); x.fillRect(r * 0.995, -r * 0.74, r * 0.035, r * 0.035);
}

// ---- cities ----
// A city painted around (0,0) with hex radius S. o = { era, pop, cap, wall, civ, seed, has(k), tilt }.
// Ancient huts grow into whitewashed towns, timbered medieval streets, spired Renaissance cities,
// brick-and-smokestack industrial towns and finally a glass skyline. Walls are split into a back
// half (drawn before the houses) and a front half (after) so the houses sit inside them.
const CITY_STYLE = [
  { wall: '#d9c497', side: '#b39a6a', roof: '#a07a40', kind: 'hut' },
  { wall: '#f1e8d4', side: '#cfc2a4', roof: '#b8583a', kind: 'gable' },
  { wall: '#eadcc0', side: '#c4b090', roof: '#6a4a3a', kind: 'timber' },
  { wall: '#efe6d6', side: '#c9bea8', roof: '#a5432f', kind: 'gable' },
  { wall: '#b86a4e', side: '#8a4a36', roof: '#59606a', kind: 'brick' },
  { wall: '#b8c8d6', side: '#7c90a4', roof: '#5a6a7a', kind: 'tower' },
];
function paintCity(x, S, o) {
  const tl = o.tilt, rnd = lcg(o.seed * 7 + 3), era = Math.min(5, o.era), st = CITY_STYLE[era], civ = o.civ;
  const lw = Math.max(1, S * 0.025), ink = 'rgba(30,22,14,.8)';
  const hexPts = (r, dy) => { const a = []; for (let k = 0; k < 6; k++) a.push([CORNERS[k][0] * r, (CORNERS[k][1] * r + (dy || 0)) * tl]); return a; };
  // ground: a trodden plaza (earth early, paving later) inside a civ-coloured kerb
  artShadow(x, S * 0.06, S * 0.12 * tl, S * 0.86, S * 0.7 * tl);
  artPoly(x, hexPts(S * 0.8), era >= 3 ? '#9a958a' : era >= 1 ? '#a8987a' : '#8f7a58', civ.color, Math.max(1.5, S * 0.045));
  artPoly(x, hexPts(S * 0.66), era >= 4 ? '#8a8a88' : era >= 1 ? '#b8a888' : '#a08a62');
  if (era >= 1) { x.strokeStyle = 'rgba(70,60,45,.3)'; x.lineWidth = lw; x.beginPath(); x.moveTo(-S * 0.6, 0); x.lineTo(S * 0.6, 0); x.moveTo(-S * 0.3, -S * 0.52 * tl); x.lineTo(S * 0.3, S * 0.52 * tl); x.moveTo(S * 0.3, -S * 0.52 * tl); x.lineTo(-S * 0.3, S * 0.52 * tl); x.stroke(); }
  // walls
  const wall = o.wall, wr = S * 0.74;
  const wallCols = era === 0 ? ['#8a6236', '#6a4826'] : wall >= 3 ? ['#9a9488', '#6a665e'] : ['#c9bb9e', '#8a7d64'];
  const wh = S * (0.1 + wall * 0.04);
  const wallSeg = (k) => {
    const a = CORNERS[k], b = CORNERS[(k + 1) % 6], ax = a[0] * wr, ay = a[1] * wr * tl, bx = b[0] * wr, by = b[1] * wr * tl;
    if (era === 0 && wall) { for (let q = 0; q <= 5; q++) { const px = ax + (bx - ax) * q / 5, py = ay + (by - ay) * q / 5; artPoly(x, [[px - S * 0.03, py], [px - S * 0.03, py - wh], [px, py - wh - S * 0.05], [px + S * 0.03, py - wh], [px + S * 0.03, py]], wallCols[q & 1], ink, lw * 0.6); } return; }
    artPoly(x, [[ax, ay], [bx, by], [bx, by - wh], [ax, ay - wh]], wallCols[(k === 1 || k === 0) ? 1 : 0], ink, lw);
    x.fillStyle = wallCols[0]; for (let q = 0; q < 5; q++) { const f = (q + 0.25) / 5, px = ax + (bx - ax) * f, py = ay + (by - ay) * f; x.fillRect(px - S * 0.025, py - wh - S * 0.035, S * 0.05, S * 0.04); }
  };
  const tower = (k) => {
    const a = CORNERS[k], tx = a[0] * wr, ty = a[1] * wr * tl, tw = S * (0.07 + wall * 0.015), th = wh + S * (0.08 + wall * 0.04);
    if (era === 0) return;
    artPoly(x, [[tx - tw, ty], [tx - tw, ty - th], [tx + tw, ty - th], [tx + tw, ty]], wallCols[0], ink, lw);
    x.fillStyle = 'rgba(0,0,0,.2)'; x.fillRect(tx + tw * 0.2, ty - th, tw * 0.8, th);
    if (wall >= 2) artPoly(x, [[tx - tw * 1.2, ty - th], [tx, ty - th - tw * 1.6], [tx + tw * 1.2, ty - th]], wall >= 3 ? '#5a6068' : civ.dark, ink, lw);
    else { x.fillStyle = wallCols[0]; x.fillRect(tx - tw, ty - th - S * 0.035, tw * 0.6, S * 0.035); x.fillRect(tx + tw * 0.4, ty - th - S * 0.035, tw * 0.6, S * 0.035); }
  };
  if (wall) { for (const k of [3, 4, 5]) wallSeg(k); for (const k of [3, 4, 5, 0]) tower(k); }
  // buildings on a jittered grid, back to front
  const n = Math.min(14, 3 + Math.floor(o.pop / 1.4));
  const spots = [[0, -0.18], [-0.32, -0.08], [0.32, -0.08], [-0.16, 0.18], [0.18, 0.18], [-0.44, 0.2], [0.46, 0.2], [0, 0.42], [-0.3, -0.38], [0.3, -0.38], [-0.3, 0.44], [0.3, 0.44], [0, -0.48], [-0.55, -0.12]];
  const items = [];
  for (let i = 0; i < n; i++) { const [px, py] = spots[i]; items.push({ x: (px + (rnd() - 0.5) * 0.06) * S, y: (py + (rnd() - 0.5) * 0.05) * S * tl, i, kind: 'house' }); }
  if (o.cap) items.push({ x: 0.04 * S, y: -0.3 * S * tl, kind: 'palace' });
  if (o.has('temple') || o.has('shrine') || o.has('grand_temple')) items.push({ x: -0.42 * S, y: -0.28 * S * tl, kind: 'temple' });
  if (o.has('factory') || o.has('power_plant')) items.push({ x: 0.48 * S, y: -0.3 * S * tl, kind: 'stack' });
  if (o.has('university') || o.has('observatory')) items.push({ x: 0.2 * S, y: -0.46 * S * tl, kind: 'obs' });
  if (o.has('harbor')) items.push({ x: -0.62 * S, y: 0.5 * S * tl, kind: 'pier' });
  if (o.has('broadcast_tower')) items.push({ x: -0.18 * S, y: -0.5 * S * tl, kind: 'mast' });
  items.sort((a, b) => a.y - b.y);
  const box = (bx, by, w, h, wall, side, d) => { // front face plus a receding right side
    d = d === undefined ? w * 0.5 : d; const dy = d * 0.55 * tl;
    artPoly(x, [[bx + w / 2, by], [bx + w / 2 + d, by - dy], [bx + w / 2 + d, by - h - dy], [bx + w / 2, by - h]], side, ink, lw);
    artPoly(x, [[bx - w / 2, by], [bx + w / 2, by], [bx + w / 2, by - h], [bx - w / 2, by - h]], wall, ink, lw);
    return dy;
  };
  const windows = (bx, by, w, h, rows, cols, col) => { x.fillStyle = col; const ww = w / (cols * 2 + 1), hh = h / (rows * 2 + 1); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) x.fillRect(bx - w / 2 + ww * (1 + c * 2), by - h + hh * (1 + r * 2), ww, hh); };
  for (const it of items) {
    const bx = it.x, by = it.y;
    if (it.kind === 'house') {
      const main = it.i === 0, big = main && o.pop >= 8;
      if (st.kind === 'hut') {
        const r = S * (main ? 0.13 : 0.1);
        artPoly(x, [[bx - r, by], [bx - r, by - r * 0.8], [bx + r, by - r * 0.8], [bx + r, by]], st.wall, ink, lw);
        artPoly(x, [[bx - r * 1.3, by - r * 0.7], [bx, by - r * 2.2], [bx + r * 1.3, by - r * 0.7]], it.i % 3 ? st.roof : shade(st.roof, -0.15), ink, lw);
        x.fillStyle = '#3a2a1a'; x.fillRect(bx - r * 0.25, by - r * 0.55, r * 0.5, r * 0.55);
        continue;
      }
      if (st.kind === 'tower') { // modern: glass and concrete towers, taller in big cities
        const w = S * (main ? 0.2 : 0.14 + rnd() * 0.04), h = S * (0.3 + rnd() * 0.25 + (main ? Math.min(0.7, o.pop * 0.035) : Math.min(0.35, o.pop * 0.015)));
        const glass = x.createLinearGradient(bx - w / 2, by - h, bx + w / 2, by); glass.addColorStop(0, it.i % 2 ? '#cfe2f0' : '#d8d2c4'); glass.addColorStop(1, it.i % 2 ? '#6e8aa4' : '#9a948a');
        box(bx, by, w, h, glass, it.i % 2 ? '#5a7088' : '#7a746a', w * 0.4);
        x.fillStyle = 'rgba(255,240,180,.55)'; for (let r = 0; r < Math.floor(h / (S * 0.07)); r++) for (let c = 0; c < 3; c++) if ((r * 3 + c + it.i) % 4) x.fillRect(bx - w / 2 + w * (0.12 + c * 0.3), by - h + S * 0.035 + r * S * 0.07, w * 0.16, S * 0.025);
        if (main) { x.strokeStyle = '#3a4048'; x.lineWidth = lw; x.beginPath(); x.moveTo(bx, by - h); x.lineTo(bx, by - h - S * 0.18); x.stroke(); x.fillStyle = '#ff5a4a'; x.beginPath(); x.arc(bx, by - h - S * 0.18, S * 0.02, 0, 6.283); x.fill(); }
        continue;
      }
      const w = S * (main ? 0.22 : 0.15 + rnd() * 0.04), h = S * (main ? (big ? 0.32 : 0.22) : 0.14 + rnd() * 0.06) * (st.kind === 'brick' ? 1.4 : 1);
      const dy = box(bx, by, w, h, st.wall, st.side);
      if (st.kind === 'timber') { x.strokeStyle = 'rgba(70,45,25,.75)'; x.lineWidth = lw; x.beginPath(); x.moveTo(bx - w / 2, by - h * 0.5); x.lineTo(bx + w / 2, by - h * 0.5); x.moveTo(bx - w / 2, by - h); x.lineTo(bx, by - h * 0.5); x.lineTo(bx + w / 2, by - h); x.stroke(); }
      windows(bx, by, w, h * 0.85, st.kind === 'brick' ? 2 : 1, 2, era >= 3 ? '#f5d77a' : '#4a3a26');
      const roofCol = main && era < 4 ? civ.color : st.roof, peak = st.kind === 'brick' ? 0.25 : st.kind === 'timber' ? 0.75 : 0.5;
      const d = w * 0.5;
      artPoly(x, [[bx - w / 2 - S * 0.02, by - h], [bx, by - h - w * peak], [bx + d, by - h - w * peak - dy], [bx + w / 2 + d + S * 0.02, by - h - dy], [bx + w / 2 + S * 0.02, by - h]], shade(roofCol, -0.15), ink, lw);
      artPoly(x, [[bx - w / 2 - S * 0.02, by - h], [bx, by - h - w * peak], [bx + w / 2 + S * 0.02, by - h]], roofCol, ink, lw);
      if (st.kind === 'brick' && it.i % 2 === 0) { artPoly(x, [[bx + w * 0.15, by - h - w * 0.1], [bx + w * 0.15, by - h - w * 0.55], [bx + w * 0.32, by - h - w * 0.55], [bx + w * 0.32, by - h - w * 0.1]], '#4b4f57', ink, lw); }
    } else if (it.kind === 'palace') {
      const w = S * 0.36, h = S * 0.2;
      box(bx, by, w, h, '#efe4cc', '#c9bc9c');
      x.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 5; k++) x.fillRect(bx - w / 2 + w * (0.1 + k * 0.19), by - h * 0.9, Math.max(1, w * 0.05), h * 0.85);
      const g = x.createLinearGradient(bx - S * 0.12, by - h - S * 0.25, bx + S * 0.12, by - h); g.addColorStop(0, '#fbe9a8'); g.addColorStop(1, '#b8892f');
      x.beginPath(); x.ellipse(bx + S * 0.03, by - h, S * 0.13, S * 0.15, 0, Math.PI, 0); x.closePath(); x.strokeStyle = ink; x.lineWidth = lw * 2; x.stroke(); x.fillStyle = g; x.fill();
      x.strokeStyle = '#3a2a1a'; x.lineWidth = lw; x.beginPath(); x.moveTo(bx + S * 0.03, by - h - S * 0.15); x.lineTo(bx + S * 0.03, by - h - S * 0.36); x.stroke();
      artPoly(x, [[bx + S * 0.03, by - h - S * 0.36], [bx + S * 0.2, by - h - S * 0.32], [bx + S * 0.03, by - h - S * 0.27]], civ.color, ink, lw * 0.7);
    } else if (it.kind === 'temple') {
      const w = S * 0.2, h = S * 0.14;
      if (era >= 2) { box(bx, by, w * 0.9, h * 1.4, '#ece4d4', '#c4baa6'); artPoly(x, [[bx - w * 0.3, by - h * 1.4], [bx, by - h * 1.4 - S * 0.32], [bx + w * 0.3, by - h * 1.4]], '#6a7078', ink, lw); }
      else { box(bx, by, w, h, '#f3ecdc', '#cfc4ae'); x.fillStyle = 'rgba(0,0,0,.28)'; for (let k = 0; k < 4; k++) x.fillRect(bx - w / 2 + w * (0.12 + k * 0.24), by - h * 0.9, Math.max(1, w * 0.07), h * 0.88); artPoly(x, [[bx - w * 0.6, by - h], [bx, by - h - w * 0.35], [bx + w * 0.6, by - h]], o.has('grand_temple') ? '#d9b45a' : '#ddd3bf', ink, lw); }
    } else if (it.kind === 'stack') {
      for (const [dx, hh] of [[0, 0.62], [S * 0.1, 0.48]]) { artPoly(x, [[bx + dx - S * 0.035, by], [bx + dx - S * 0.03, by - S * hh], [bx + dx + S * 0.03, by - S * hh], [bx + dx + S * 0.035, by]], '#7a4636', ink, lw); x.fillStyle = '#f0e8d8'; x.fillRect(bx + dx - S * 0.03, by - S * hh + S * 0.04, S * 0.06, S * 0.025); }
      x.fillStyle = 'rgba(210,210,215,.55)'; for (let k = 0; k < 3; k++) { x.beginPath(); x.arc(bx + S * (0.05 + k * 0.08), by - S * (0.7 + k * 0.08), S * (0.05 + k * 0.025), 0, 6.283); x.fill(); }
    } else if (it.kind === 'obs') {
      box(bx, by, S * 0.1, S * 0.28, '#e4dccb', '#bcb3a0', S * 0.05);
      x.beginPath(); x.arc(bx, by - S * 0.28, S * 0.075, Math.PI, 0); x.closePath(); x.strokeStyle = ink; x.lineWidth = lw * 2; x.stroke(); x.fillStyle = '#6d88a8'; x.fill();
    } else if (it.kind === 'pier') {
      artPoly(x, [[bx - S * 0.2, by], [bx + S * 0.12, by - S * 0.05], [bx + S * 0.14, by + S * 0.0], [bx - S * 0.18, by + S * 0.05]], '#7a5a36', ink, lw);
      artPoly(x, [[bx - S * 0.1, by - S * 0.02], [bx - S * 0.1, by - S * 0.24], [bx + S * 0.04, by - S * 0.03]], '#efe4cc', ink, lw);
    } else if (it.kind === 'mast') {
      x.strokeStyle = '#c84a3a'; x.lineWidth = lw * 1.5; x.beginPath(); x.moveTo(bx - S * 0.05, by); x.lineTo(bx, by - S * 0.8); x.lineTo(bx + S * 0.05, by); x.stroke();
      x.strokeStyle = '#f0f0f0'; x.lineWidth = lw; for (let k = 1; k < 5; k++) { x.beginPath(); x.moveTo(bx - S * 0.05 * (1 - k / 5), by - S * 0.16 * k); x.lineTo(bx + S * 0.05 * (1 - k / 5), by - S * 0.16 * k); x.stroke(); }
    }
  }
  if (wall) { for (const k of [0, 1, 2]) wallSeg(k); for (const k of [1, 2]) tower(k); }
}

// ---- world wonders: each a distinct small landmark on its own plinth ----
const WONDER_ART = {
  stone_circle: 'stones', terraced_gardens: 'terraces', tide_colossus: 'colossus', archive_of_ages: 'library', builders_ziggurat: 'ziggurat',
  hall_of_champions: 'arena', oracle_spring: 'fountain', star_dial: 'obelisk', grand_circus: 'bigtop', beacon_of_tides: 'lighthouse',
  jade_court: 'pagoda', grand_basilica: 'basilica', knights_citadel: 'keep', scholars_tower: 'scholars', golden_bazaar: 'bazaar',
  celestial_lens: 'observatory', admirals_compass: 'compass', gallery_of_muses: 'gallery', grand_arsenal: 'arsenal', clockwork_foundry: 'foundry',
  tower_of_accord: 'accord', lightning_spire: 'spire', cloud_harbor: 'airship', peoples_hall: 'hall', hall_of_nations: 'globe',
  grand_exhibition: 'crystal', skyward_gantry: 'gantry', skyward_habitat: 'habitat', skyward_engine: 'rocket',
};
function paintWonder(x, key, r) {
  const kind = WONDER_ART[key]; if (!kind) return false;
  const lw = Math.max(1, r * 0.06), ink = 'rgba(30,22,10,.85)';
  const P = (pts, fill) => artPoly(x, pts.map(([a, b]) => [a * r, b * r]), fill, ink, lw);
  const E = (cx, cy, rx, ry, fill, a0, a1) => { x.beginPath(); x.ellipse(cx * r, cy * r, rx * r, ry * r, 0, a0 || 0, a1 === undefined ? 6.283 : a1); if (a1 !== undefined) x.closePath(); x.strokeStyle = ink; x.lineWidth = lw; x.stroke(); x.fillStyle = fill; x.fill(); };
  const R = (a, b, w, h, fill) => P([[a, b], [a + w, b], [a + w, b + h], [a, b + h]], fill);
  const G = (c0, c1, y0, y1) => { const g = x.createLinearGradient(-r, y0 * r, r, y1 * r); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
  const gold = G('#fbe9a8', '#b8892f', -1, 0.3), marble = G('#fbf6ea', '#c9bea6', -1, 0.3);
  artShadow(x, r * 0.08, r * 0.08, r * 1.0, r * 0.3);
  // golden plinth marks every wonder as special at a glance
  P([[-0.9, 0.0], [0.9, 0.0], [0.8, 0.16], [-0.8, 0.16]], '#c9a54a');
  switch (kind) {
    case 'stones': for (const [a, h] of [[-0.62, 0.55], [-0.22, 0.75], [0.2, 0.7], [0.6, 0.55]]) P([[a - 0.13, 0], [a - 0.11, -h], [a + 0.11, -h - 0.04], [a + 0.13, 0]], '#9a958c'); P([[-0.32, -0.75], [0.32, -0.78], [0.32, -0.88], [-0.32, -0.85]], '#a8a398'); break;
    case 'terraces': for (let k = 0; k < 4; k++) { const w = 0.85 - k * 0.2; R(-w, -0.18 * (k + 1), w * 2, 0.18, k % 2 ? '#c9b48a' : '#b8a27a'); x.fillStyle = '#4e9a3e'; for (let q = 0; q < 5; q++) { x.beginPath(); x.arc((-w + 0.1 + q * (w * 2 - 0.2) / 4) * r, -0.18 * (k + 1) * r, 0.07 * r, 0, 6.283); x.fill(); } } break;
    case 'colossus': R(-0.3, -0.25, 0.6, 0.25, '#b8b0a0'); P([[-0.14, -0.25], [-0.18, -0.9], [0.18, -0.9], [0.14, -0.25]], G('#7ac0a8', '#2f7a68', -1, 0)); E(0, -1.05, 0.13, 0.14, '#5aa890'); P([[0.16, -0.85], [0.42, -1.3], [0.5, -1.25], [0.24, -0.82]], '#5aa890'); E(0.48, -1.36, 0.08, 0.1, '#ffc84a'); break;
    case 'library': R(-0.7, -0.5, 1.4, 0.5, marble); x.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 6; k++) x.fillRect((-0.62 + k * 0.25) * r, -0.45 * r, 0.06 * r, 0.42 * r); E(0, -0.5, 0.42, 0.42, G('#8ab0d8', '#3a6a9a', -1, -0.4), Math.PI, 0); break;
    case 'ziggurat': for (let k = 0; k < 4; k++) { const w = 0.85 - k * 0.2; R(-w, -0.24 * (k + 1), w * 2, 0.24, k % 2 ? '#d8b878' : '#c9a464'); } R(-0.08, -1.06, 0.16, 0.1, '#8a5a2a'); break;
    case 'arena': E(0, -0.32, 0.85, 0.36, '#d9cbaa'); E(0, -0.36, 0.62, 0.22, '#b8a27a'); x.fillStyle = 'rgba(0,0,0,.28)'; for (let k = 0; k < 9; k++) { const a = Math.PI * (0.1 + k * 0.1); x.fillRect(Math.cos(a) * -0.75 * r - 0.03 * r, (-0.32 + Math.sin(a) * 0.22) * r, 0.06 * r, 0.14 * r); } break;
    case 'fountain': for (const a of [-0.55, 0.55]) R(a - 0.08, -0.85, 0.16, 0.85, marble); R(-0.7, -0.95, 1.4, 0.12, marble); E(0, -0.12, 0.42, 0.12, '#5ab0e0'); x.strokeStyle = '#bfe6ff'; x.lineWidth = lw; x.beginPath(); x.moveTo(0, -0.12 * r); x.quadraticCurveTo(-0.1 * r, -0.65 * r, -0.3 * r, -0.2 * r); x.moveTo(0, -0.12 * r); x.quadraticCurveTo(0.1 * r, -0.65 * r, 0.3 * r, -0.2 * r); x.stroke(); break;
    case 'obelisk': P([[-0.14, 0], [-0.1, -1.1], [0, -1.28], [0.1, -1.1], [0.14, 0]], G('#efe0c0', '#a8946a', -1.2, 0)); E(0, -0.15, 0.6, 0.14, 'rgba(240,210,120,.6)'); x.strokeStyle = ink; x.lineWidth = lw; x.beginPath(); x.moveTo(0.1 * r, -0.2 * r); x.lineTo(0.55 * r, -0.1 * r); x.stroke(); break;
    case 'bigtop': P([[-0.8, 0], [-0.75, -0.45], [0, -1.05], [0.75, -0.45], [0.8, 0]], '#f2ecdc'); x.save(); x.beginPath(); x.moveTo(-0.8 * r, 0); x.lineTo(-0.75 * r, -0.45 * r); x.lineTo(0, -1.05 * r); x.lineTo(0.75 * r, -0.45 * r); x.lineTo(0.8 * r, 0); x.clip(); x.fillStyle = '#d8402e'; for (let k = -4; k <= 4; k += 2) { x.beginPath(); x.moveTo(0, -1.05 * r); x.lineTo((k * 0.2 - 0.1) * r, 0); x.lineTo((k * 0.2 + 0.1) * r, 0); x.fill(); } x.restore(); P([[0, -1.05], [0, -1.3], [0.25, -1.22]], '#f2d264'); break;
    case 'lighthouse': P([[-0.25, 0], [-0.15, -1.0], [0.15, -1.0], [0.25, 0]], '#f2ecdc'); x.fillStyle = '#c84a3a'; x.fillRect(-0.22 * r, -0.35 * r, 0.44 * r, 0.14 * r); x.fillRect(-0.18 * r, -0.72 * r, 0.36 * r, 0.12 * r); R(-0.2, -1.2, 0.4, 0.2, '#ffe08a'); P([[-0.25, -1.2], [0, -1.42], [0.25, -1.2]], '#3a3f46'); { const g = x.createRadialGradient(0, -1.1 * r, 0, 0, -1.1 * r, 0.7 * r); g.addColorStop(0, 'rgba(255,230,140,.6)'); g.addColorStop(1, 'rgba(255,230,140,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, -1.1 * r, 0.7 * r, 0, 6.283); x.fill(); } break;
    case 'pagoda': for (let k = 0; k < 3; k++) { const w = 0.5 - k * 0.12, y0 = -0.32 * k; R(-w * 0.7, y0 - 0.26, w * 1.4, 0.26, '#c8423a'); P([[-w - 0.15, y0 - 0.24], [w + 0.15, y0 - 0.24], [w * 0.7, y0 - 0.38], [-w * 0.7, y0 - 0.38]], '#3f8a5a'); } P([[-0.04, -1.0], [0, -1.3], [0.04, -1.0]], '#f2d264'); break;
    case 'basilica': R(-0.6, -0.55, 1.2, 0.55, marble); for (const a of [-0.62, 0.42]) { R(a, -1.0, 0.2, 1.0, marble); P([[a - 0.02, -1.0], [a + 0.1, -1.25], [a + 0.22, -1.0]], '#b8892f'); } E(0, -0.55, 0.32, 0.4, gold, Math.PI, 0); P([[-0.02, -0.95], [-0.02, -1.15], [0.02, -1.15], [0.02, -0.95]], '#b8892f'); break;
    case 'keep': R(-0.6, -0.6, 1.2, 0.6, '#b3a68b'); for (const a of [-0.75, 0.45]) { R(a, -0.95, 0.3, 0.95, '#c9bb9e'); P([[a - 0.04, -0.95], [a + 0.15, -1.25], [a + 0.34, -0.95]], '#4a5e8a'); } R(-0.2, -1.1, 0.4, 0.5, '#c9bb9e'); x.fillStyle = '#2a1a10'; x.fillRect(-0.1 * r, -0.3 * r, 0.2 * r, 0.3 * r); P([[0, -1.1], [0, -1.4], [0.3, -1.3]], '#c84a3a'); break;
    case 'scholars': R(-0.22, -1.2, 0.44, 1.2, marble); x.fillStyle = 'rgba(40,40,60,.5)'; for (let k = 0; k < 4; k++) x.fillRect(-0.06 * r, (-1.05 + k * 0.25) * r, 0.12 * r, 0.12 * r); P([[-0.3, -1.2], [0, -1.6], [0.3, -1.2]], '#4a5e8a'); R(-0.6, -0.4, 0.38, 0.4, marble); R(0.22, -0.4, 0.38, 0.4, marble); break;
    case 'bazaar': R(-0.75, -0.45, 1.5, 0.45, '#e8d8b0'); for (const [a, c] of [[-0.6, '#d8402e'], [-0.15, '#2a8a6a'], [0.3, '#d8a02e']]) P([[a, -0.3], [a + 0.4, -0.3], [a + 0.46, -0.16], [a - 0.06, -0.16]], c); E(0, -0.45, 0.36, 0.42, gold, Math.PI, 0); for (const a of [-0.7, 0.62]) { R(a, -1.0, 0.1, 1.0, '#e8d8b0'); E(a + 0.05, -1.0, 0.08, 0.1, gold); } break;
    case 'observatory': R(-0.5, -0.5, 1.0, 0.5, marble); E(0, -0.5, 0.45, 0.45, G('#d0d8e0', '#7a8a9a', -1, -0.4), Math.PI, 0); P([[0.05, -0.75], [0.6, -1.2], [0.68, -1.1], [0.15, -0.68]], '#3a3f46'); break;
    case 'compass': R(-0.12, -0.9, 0.24, 0.9, '#b8b0a0'); E(0, -1.05, 0.38, 0.38, '#f2ecdc'); P([[0, -1.4], [0.08, -1.05], [0, -0.7], [-0.08, -1.05]], '#c84a3a'); P([[-0.35, -1.05], [0, -1.12], [0.35, -1.05], [0, -0.98]], '#3a3f46'); break;
    case 'gallery': R(-0.75, -0.55, 1.5, 0.55, marble); x.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 7; k++) x.fillRect((-0.68 + k * 0.22) * r, -0.5 * r, 0.06 * r, 0.46 * r); P([[-0.85, -0.55], [0, -0.95], [0.85, -0.55]], marble); E(0, -0.7, 0.12, 0.08, '#d84a7a'); break;
    case 'arsenal': R(-0.75, -0.6, 1.5, 0.6, '#7a6a58'); x.fillStyle = '#4a3a2a'; for (let k = 0; k < 4; k++) x.fillRect((-0.62 + k * 0.38) * r, -0.85 * r, 0.24 * r, 0.25 * r); P([[-0.2, -0.25], [0.6, -0.45], [0.62, -0.35], [-0.18, -0.15]], '#2a2a30'); E(-0.15, -0.15, 0.12, 0.12, '#5a3a22'); break;
    case 'foundry': R(-0.7, -0.55, 1.1, 0.55, '#a05a42'); R(0.45, -1.2, 0.18, 1.2, '#7a4636'); x.fillStyle = 'rgba(210,210,215,.6)'; for (let k = 0; k < 3; k++) { x.beginPath(); x.arc((0.6 + k * 0.15) * r, (-1.35 - k * 0.15) * r, (0.1 + k * 0.05) * r, 0, 6.283); x.fill(); } x.save(); x.translate(-0.15 * r, -0.85 * r); { x.beginPath(); for (let i = 0; i < 20; i++) { const a = i * Math.PI / 10, rr = (i % 2 ? 0.28 : 0.38) * r; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.closePath(); x.strokeStyle = ink; x.lineWidth = lw; x.stroke(); x.fillStyle = gold; x.fill(); x.fillStyle = '#5a3a1a'; x.beginPath(); x.arc(0, 0, 0.1 * r, 0, 6.283); x.fill(); } x.restore(); break;
    case 'accord': R(-0.2, -1.25, 0.4, 1.25, '#f6f6f2'); for (const [a, c] of [[-0.55, '#5b84dc'], [0.0, '#e2b544'], [0.55, '#62c44c']]) { x.strokeStyle = ink; x.lineWidth = lw * 0.7; x.beginPath(); x.moveTo(a * r, -0.05 * r); x.lineTo(a * r, -0.75 * r); x.stroke(); if (a) P([[a, -0.75], [a + 0.25, -0.68], [a, -0.6]], c); } P([[-0.28, -1.25], [0, -1.55], [0.28, -1.25]], '#7fb4ff'); break;
    case 'spire': P([[-0.3, 0], [-0.06, -1.5], [0.06, -1.5], [0.3, 0]], G('#d8dde4', '#6a727c', -1.5, 0)); x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = lw * 0.6; for (let k = 1; k < 6; k++) { const yy = -k * 0.25, w = 0.3 - k * 0.045; x.beginPath(); x.moveTo(-w * r, yy * r); x.lineTo(w * r, yy * r); x.stroke(); } P([[0.05, -1.5], [0.32, -1.25], [0.16, -1.25], [0.36, -0.98], [0.02, -1.3], [0.18, -1.3]], '#ffe14a'); break;
    case 'airship': R(-0.05, -0.95, 0.1, 0.95, '#6a727c'); E(-0.15, -1.15, 0.65, 0.22, G('#e8e4dc', '#9a948a', -1.4, -0.9)); R(-0.25, -0.95, 0.3, 0.1, '#5a4a3a'); P([[-0.78, -1.15], [-0.95, -1.35], [-0.95, -0.95]], '#c84a3a'); break;
    case 'hall': R(-0.8, -0.5, 1.6, 0.5, marble); x.fillStyle = 'rgba(0,0,0,.25)'; for (let k = 0; k < 8; k++) x.fillRect((-0.72 + k * 0.2) * r, -0.45 * r, 0.06 * r, 0.42 * r); P([[-0.9, -0.5], [0, -0.85], [0.9, -0.5]], marble); R(-0.04, -1.2, 0.04, 0.35, '#3a2a1a'); P([[0, -1.2], [0.3, -1.12], [0, -1.04]], '#c84a3a'); break;
    case 'globe': R(-0.6, -0.4, 1.2, 0.4, '#d8d8d8'); E(0, -0.85, 0.42, 0.42, G('#6ab0e8', '#2a6aa8', -1.3, -0.4)); x.fillStyle = '#5ab04a'; x.beginPath(); x.ellipse(-0.12 * r, -0.95 * r, 0.16 * r, 0.12 * r, 0.5, 0, 6.283); x.ellipse(0.16 * r, -0.72 * r, 0.12 * r, 0.1 * r, 0, 0, 6.283); x.fill(); x.strokeStyle = '#b8892f'; x.lineWidth = lw * 1.2; x.beginPath(); x.ellipse(0, -0.85 * r, 0.5 * r, 0.5 * r, 0.4, Math.PI * 0.6, Math.PI * 1.9); x.stroke(); break;
    case 'crystal': P([[-0.85, 0], [-0.85, -0.45], [0.85, -0.45], [0.85, 0]], G('#e0f0f8', '#8ab0c8', -0.5, 0)); E(0, -0.45, 0.45, 0.5, G('#f0f8ff', '#9ac0d8', -1, -0.4), Math.PI, 0); x.strokeStyle = 'rgba(60,90,110,.5)'; x.lineWidth = lw * 0.6; for (let k = -3; k <= 3; k++) { x.beginPath(); x.moveTo(k * 0.25 * r, 0); x.lineTo(k * 0.25 * r, -0.45 * r); x.stroke(); } break;
    case 'gantry': R(-0.5, -1.3, 0.16, 1.3, '#c84a3a'); x.strokeStyle = '#7a2a20'; x.lineWidth = lw * 0.7; for (let k = 0; k < 6; k++) { x.beginPath(); x.moveTo(-0.5 * r, -k * 0.22 * r); x.lineTo(-0.34 * r, -(k + 1) * 0.22 * r); x.stroke(); } R(-0.34, -1.1, 0.25, 0.06, '#7a2a20'); break;
    case 'habitat': E(0, -0.3, 0.75, 0.3, G('#e8eef4', '#9aa8b8', -0.6, 0)); E(0, -0.6, 0.35, 0.3, G('#f0f6fa', '#a8b8c8', -0.9, -0.3)); R(-0.03, -1.15, 0.06, 0.3, '#5a6068'); E(0, -1.2, 0.12, 0.06, '#c8d0d8'); break;
    case 'rocket': R(-0.5, -1.3, 0.12, 1.3, '#c84a3a'); P([[-0.16, 0], [-0.16, -1.1], [0.0, -1.5], [0.16, -1.1], [0.16, 0]], G('#ffffff', '#b8c0c8', -1.5, 0)); P([[-0.16, -0.25], [-0.36, 0], [-0.16, 0]], '#c84a3a'); P([[0.16, -0.25], [0.36, 0], [0.16, 0]], '#c84a3a'); R(-0.16, -0.75, 0.32, 0.08, '#2a3a5a'); break;
    default: return false;
  }
  return true;
}
