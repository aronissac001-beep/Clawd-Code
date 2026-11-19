// ===== art.js : procedural art for Veyra, painted once per size and cached as sprites =====
// Unit figures (every line and affinity tier, fauna, civilians), natural wonders, colonies by size and affinity,
// structures for buildings and wonders, and tile improvements. Painters work in a unit box (feet or base at y = 0,
// about one unit tall) and the sprite helpers add a dark sticker outline so they read on any terrain.
const ART_CACHE = new Map();
function artCached(key, make) {
  let c = ART_CACHE.get(key);
  if (!c) { c = make(); ART_CACHE.set(key, c); if (ART_CACHE.size > 1400) ART_CACHE.delete(ART_CACHE.keys().next().value); }
  return c;
}
function artCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
// Paint with fn into a w x h canvas (anchor ax, ay, scale u), then wrap it in a dark outline of o pixels.
function artSprite(w, h, ax, ay, u, fn, o, ink) {
  const pad = Math.ceil(o) + 1, A = artCanvas(w + pad * 2, h + pad * 2), x = A.getContext('2d', { willReadFrequently: true });
  x.translate(ax + pad, ay + pad); x.scale(u, u); x.lineJoin = 'round'; x.lineCap = 'round'; fn(x);
  if (!o) { A.ax = ax + pad; A.ay = ay + pad; return A; }
  // the silhouette keeps only solid paint, so soft glows and mist do not grow a dark halo
  const S = artCanvas(A.width, A.height), sx = S.getContext('2d'), img = x.getImageData(0, 0, A.width, A.height), d = img.data;
  const m = (ink || '14,8,26,.92').match(/[\d.]+/g) || [14, 8, 26, 0.92], ia = +(m[3] === undefined ? 1 : m[3]);
  // also find the painted bounds, so the finished sprite can be trimmed and every blit stays small
  const W = A.width; let x0 = W, y0 = A.height, x1 = -1, y1 = -1;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 8) { const px = (i >> 2) % W, py = (i >> 2) / W | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    d[i] = +m[0]; d[i + 1] = +m[1]; d[i + 2] = +m[2]; d[i + 3] = a < 120 ? 0 : Math.min(255, (a - 120) * 2.2) * ia;
  }
  sx.putImageData(img, 0, 0);
  if (x1 < 0) { x0 = y0 = 0; x1 = W - 1; y1 = A.height - 1; }
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(A.height - 1, y1 + pad);
  const C = artCanvas(x1 - x0 + 1, y1 - y0 + 1), cx = C.getContext('2d');
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; cx.drawImage(S, Math.cos(a) * o - x0, Math.sin(a) * o - y0); }
  cx.drawImage(A, -x0, -y0); C.ax = ax + pad - x0; C.ay = ay + pad - y0; return C;
}
// ---- tiny drawing kit (unit coordinates) ----
function fpoly(x, pts, col) { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.fillStyle = col; x.fill(); }
function fell(x, cx, cy, rx, ry, col, rot) { x.beginPath(); x.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot || 0, 0, 6.283); x.fillStyle = col; x.fill(); }
function fcirc(x, cx, cy, r, col) { x.beginPath(); x.arc(cx, cy, Math.abs(r), 0, 6.283); x.fillStyle = col; x.fill(); }
function fline(x, pts, w, col) { x.beginPath(); pts.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.lineWidth = w; x.strokeStyle = col; x.stroke(); }
function fcurve(x, a, c, b, w, col) { x.beginPath(); x.moveTo(a[0], a[1]); x.quadraticCurveTo(c[0], c[1], b[0], b[1]); x.lineWidth = w; x.strokeStyle = col; x.stroke(); }
function frect(x, x0, y0, w, h, col, r) { x.beginPath(); if (r) { x.moveTo(x0 + r, y0); x.arcTo(x0 + w, y0, x0 + w, y0 + h, r); x.arcTo(x0 + w, y0 + h, x0, y0 + h, r); x.arcTo(x0, y0 + h, x0, y0, r); x.arcTo(x0, y0, x0 + w, y0, r); x.closePath(); } else x.rect(x0, y0, w, h); x.fillStyle = col; x.fill(); }
function lgrad(x, x0, y0, x1, y1, stops) { const g = x.createLinearGradient(x0, y0, x1, y1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; }
function rgrad(x, cx, cy, r0, r1, stops) { const g = x.createRadialGradient(cx, cy, r0, cx, cy, r1); stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c)); return g; }
function glowAt(x, cx, cy, r, col) { fcirc(x, cx, cy, r, rgrad(x, cx, cy, 0, r, [hexA(col, 0.9), hexA(col, 0.35), hexA(col, 0)])); }
function lt(c, a) { return shade(c, a); }
function dk(c, a) { return shade(c, -a); }

// ---- palettes for the three philosophies ----
const FIG_PAL = {
  base: { A: '#93a3bd', D: '#4a5672', V: '#7ff5e0', M: '#c9d3e6', G: '#8ff5dc' },
  communion: { A: '#5cc487', D: '#1f5a3c', V: '#d8ff9a', M: '#b8f0a0', G: '#a8ffd8', T: '#e9f5b0' },
  lattice: { A: '#e8c45a', D: '#77560f', V: '#7ff0ff', M: '#fff3c8', G: '#8ff8ff' },
  lineage: { A: '#cf5363', D: '#5c1621', V: '#ffe6a8', M: '#d6dae4', G: '#ffd27a' },
  fauna: { A: '#b0558f', D: '#4a1640', V: '#ffb0f0', M: '#e7a2d0', G: '#ff9ae0' },
};

// A colonist soldier in three-quarter view, facing right.
function figHuman(x, o) {
  const p = o.pal, A = p.A, D = p.D, b = (o.bulk || 1) * 1.08, team = o.team || '#8ff5dc', kneel = o.pose === 'kneel';
  const hipY = kneel ? -0.3 : -0.4, shY = hipY - 0.34 * b, hx = 0.02, hy = shY - 0.15;
  // behind the body
  if (o.back === 'pack') { frect(x, -0.3 * b, shY + 0.02, 0.2, 0.3, D, 0.05); frect(x, -0.27 * b, shY + 0.05, 0.08, 0.22, lt(D, 0.2), 0.03); }
  if (o.back === 'canopy') { for (const [cx, cy, r] of [[-0.22, shY - 0.18, 0.2], [-0.02, shY - 0.3, 0.2], [-0.32, shY - 0.02, 0.15]]) fcirc(x, cx, cy, r, lgrad(x, 0, cy - r, 0, cy + r, [lt(A, 0.25), D])); for (const [cx, cy] of [[-0.24, shY - 0.24], [0.02, shY - 0.36], [-0.34, shY - 0.06], [-0.1, shY - 0.15]]) fcirc(x, cx, cy, 0.035, p.G); }
  if (o.back === 'thorns') for (const [a, l] of [[-2.4, 0.26], [-2.0, 0.3], [-1.6, 0.24]]) fpoly(x, [[-0.08, shY + 0.04], [-0.08 + Math.cos(a) * l, shY + Math.sin(a) * l], [0.02, shY + 0.02]], p.T || p.M);
  if (o.back === 'quills') for (let k = 0; k < 6; k++) { const a = -2.9 + k * 0.32; fline(x, [[-0.1, shY + 0.1], [-0.1 + Math.cos(a) * 0.36, shY + 0.1 + Math.sin(a) * 0.36]], 0.035, k % 2 ? p.T || p.M : lt(A, 0.3)); }
  if (o.back === 'cape') fpoly(x, [[-0.12, shY], [0.06, shY], [-0.06, hipY + 0.34], [-0.36, hipY + 0.3]], o.capeCol || team);
  if (o.back === 'coils') for (let k = 0; k < 3; k++) { x.beginPath(); x.ellipse(-0.2, shY + 0.06 + k * 0.1, 0.1, 0.035, 0, 0, 6.283); x.lineWidth = 0.035; x.strokeStyle = k === 1 ? p.G : p.M; x.stroke(); }
  if (o.back === 'antenna') { fline(x, [[-0.16, shY + 0.05], [-0.26, shY - 0.34]], 0.025, p.M); glowAt(x, -0.26, shY - 0.36, 0.08, p.G); frect(x, -0.3, shY + 0.02, 0.18, 0.26, D, 0.04); }
  if (o.back === 'hood') fpoly(x, [[-0.1, shY - 0.02], [0.12, shY - 0.02], [0.02, hipY + 0.36], [-0.3, hipY + 0.34]], o.capeCol || D);
  // legs
  if (kneel) {
    fpoly(x, [[-0.1, hipY], [0.04, hipY], [-0.06, -0.02], [-0.24, -0.02], [-0.22, -0.1], [-0.12, -0.12]], D);
    fpoly(x, [[0.0, hipY], [0.14, hipY - 0.02], [0.24, -0.16], [0.24, 0], [0.12, 0], [0.12, -0.12]], A);
  } else {
    fpoly(x, [[-0.13 * b, hipY], [0.0, hipY], [-0.05, -0.06], [-0.16, -0.06]], D);
    fpoly(x, [[-0.02, hipY], [0.13 * b, hipY], [0.12, -0.06], [0.02, -0.06]], A);
    frect(x, -0.2, -0.08, 0.17, 0.08, dk(D, 0.25), 0.03); frect(x, 0.0, -0.08, 0.19, 0.08, dk(D, 0.15), 0.03);
  }
  // torso
  const tw = 0.22 * b;
  fpoly(x, [[-tw, shY], [tw, shY], [tw * 0.72, hipY], [-tw * 0.72, hipY]], lgrad(x, -tw, shY, tw, hipY, [lt(A, 0.2), A, D]));
  frect(x, -tw * 0.72, hipY - 0.06, tw * 1.44, 0.06, dk(D, 0.2));
  frect(x, -tw * 0.85, shY + 0.1, tw * 1.7, 0.05, team);
  if (o.chest === 'core') glowAt(x, 0.04, shY + 0.18, 0.08, p.G);
  if (o.chest === 'plates') for (let k = 0; k < 3; k++) frect(x, -tw * 0.6, shY + 0.03 + k * 0.08, tw * 1.2, 0.04, lt(A, 0.3), 0.02);
  // shoulders
  fell(x, -tw * 0.9, shY + 0.05, 0.1 * b, 0.07 * b, D); fell(x, tw * 0.95, shY + 0.05, 0.11 * b, 0.08 * b, o.pads || lt(A, 0.15));
  // head and helmet
  const hr = 0.135;
  if (o.helm === 'hood') { fcirc(x, hx, hy, hr * 1.12, o.capeCol || D); fell(x, hx + 0.06, hy + 0.01, 0.07, 0.06, '#1a1226'); fcirc(x, hx + 0.08, hy, 0.022, p.V); }
  else {
    fcirc(x, hx, hy, hr, lgrad(x, hx - hr, hy - hr, hx + hr, hy + hr, [lt(A, 0.35), A, D]));
    if (o.helm === 'eye') { fell(x, hx + 0.07, hy, 0.065, 0.065, '#141024'); glowAt(x, hx + 0.08, hy, 0.07, p.V); fcirc(x, hx + 0.08, hy, 0.025, '#fff'); }
    else { frect(x, hx - 0.01, hy - 0.04, hr + 0.04, 0.07, p.V, 0.03); frect(x, hx + 0.02, hy - 0.03, 0.06, 0.02, 'rgba(255,255,255,.7)', 0.01); }
    if (o.helm === 'crest') fpoly(x, [[hx - 0.12, hy - 0.08], [hx - 0.02, hy - 0.26], [hx + 0.06, hy - 0.12]], o.crestCol || team);
    if (o.helm === 'plume') { fcurve(x, [hx - 0.02, hy - hr], [hx - 0.1, hy - 0.34], [hx - 0.3, hy - 0.2], 0.07, o.crestCol || team); }
    if (o.helm === 'horns') { fpoly(x, [[hx - 0.08, hy - 0.08], [hx - 0.22, hy - 0.3], [hx - 0.02, hy - 0.12]], p.T || p.M); fpoly(x, [[hx + 0.02, hy - 0.12], [hx + 0.06, hy - 0.34], [hx + 0.1, hy - 0.08]], p.T || p.M); }
    if (o.helm === 'leaf') for (const a of [-2.2, -1.6, -1.0]) fell(x, hx + Math.cos(a) * 0.17, hy + Math.sin(a) * 0.17, 0.09, 0.04, p.M, a);
    if (o.helm === 'antenna') { fline(x, [[hx - 0.05, hy - hr], [hx - 0.1, hy - 0.3]], 0.02, p.M); fcirc(x, hx - 0.1, hy - 0.31, 0.03, p.G); }
  }
  // back arm, weapon, front arm
  fpoly(x, [[-tw * 0.95, shY + 0.03], [-tw * 0.7, shY + 0.03], [-tw * 0.5, shY + 0.28], [-tw * 0.75, shY + 0.3]], D);
  const gy = shY + 0.2, w = o.weapon;
  if (w === 'rifle' || w === 'longrifle' || w === 'rail' || w === 'heavy') {
    const L = w === 'longrifle' ? 0.62 : w === 'rail' ? 0.6 : w === 'heavy' ? 0.5 : 0.48, th = w === 'heavy' ? 0.09 : 0.06;
    x.save(); x.translate(-0.02, gy); x.rotate(-0.12);
    frect(x, -0.12, -th / 2, L, th, w === 'rail' ? p.M : '#3a3448', 0.02); frect(x, -0.18, -th / 2, 0.12, th * 1.5, dk(D, 0.2), 0.02);
    if (w === 'rail') { frect(x, 0.02, -th, L - 0.18, 0.025, p.G); frect(x, 0.02, th - 0.025, L - 0.18, 0.025, p.G); glowAt(x, L - 0.12, 0, 0.07, p.G); }
    if (w === 'longrifle') frect(x, 0.08, -th - 0.04, 0.14, 0.04, '#1c1828', 0.02);
    if (w === 'heavy') { frect(x, 0.1, th / 2, 0.1, 0.1, '#3a3448', 0.02); fcirc(x, L - 0.12, 0, 0.03, p.G); }
    x.restore();
  } else if (w === 'lance' || w === 'staff') {
    fline(x, [[-0.05, 0.0], [0.26, shY - 0.3]], 0.04, w === 'staff' ? '#7a5a3a' : p.M);
    if (w === 'lance') { fpoly(x, [[0.2, shY - 0.22], [0.36, shY - 0.44], [0.3, shY - 0.18]], p.G); glowAt(x, 0.32, shY - 0.36, 0.12, p.G); }
    else { for (let k = 0; k < 5; k++) fell(x, 0.27 + Math.cos(k * 1.256) * 0.07, shY - 0.33 + Math.sin(k * 1.256) * 0.07, 0.06, 0.035, o.flowerCol || '#ff8fc8', k * 1.256); fcirc(x, 0.27, shY - 0.33, 0.04, '#fff0a0'); }
  } else if (w === 'sword') { fline(x, [[0.16, gy + 0.02], [0.4, shY - 0.18]], 0.05, '#e6eaf2'); fline(x, [[0.11, gy - 0.02], [0.2, gy + 0.07]], 0.04, p.G); }
  else if (w === 'sling') { fline(x, [[0.14, gy], [0.34, shY - 0.04]], 0.04, p.M); fcirc(x, 0.36, shY - 0.06, 0.06, p.T || p.M); }
  else if (w === 'spyglass') { x.save(); x.translate(0.12, shY + 0.02); x.rotate(-0.5); frect(x, 0, -0.03, 0.22, 0.06, '#c9a35a', 0.02); frect(x, 0.16, -0.04, 0.08, 0.08, '#8a6a30', 0.02); x.restore(); }
  else if (w === 'lantern') { fline(x, [[0.14, 0], [0.22, shY - 0.3]], 0.035, '#7a5a3a'); glowAt(x, 0.26, shY - 0.24, 0.13, '#ffd27a'); frect(x, 0.22, shY - 0.29, 0.08, 0.1, '#ffe6a0', 0.02); }
  else if (w === 'item') { o.item(x, 0.24, gy - 0.02); }
  fpoly(x, [[tw * 0.7, shY + 0.03], [tw * 1.05, shY + 0.04], [tw * 0.95, gy + 0.04], [tw * 0.55, gy + 0.06]], A);
  fcirc(x, tw * 0.85, gy + 0.03, 0.05, dk(D, 0.1));
  if (o.shield) {
    const big = o.shield === 'tower', sw = big ? 0.2 : 0.17, sh = big ? 0.42 : 0.3, sx = 0.2, sy = hipY - 0.12;
    fpoly(x, [[sx - sw, sy - sh / 2], [sx + sw, sy - sh / 2], [sx + sw, sy + sh * 0.2], [sx, sy + sh / 2], [sx - sw, sy + sh * 0.2]], lgrad(x, sx - sw, sy - sh, sx + sw, sy + sh, [lt(A, 0.3), A, D]));
    fpoly(x, [[sx - sw * 0.6, sy - sh * 0.36], [sx + sw * 0.6, sy - sh * 0.36], [sx + sw * 0.6, sy + sh * 0.1], [sx, sy + sh * 0.34], [sx - sw * 0.6, sy + sh * 0.1]], team);
    fcirc(x, sx, sy - sh * 0.05, 0.04, p.M);
  }
}

// Wheeled, tracked and hover vehicles, facing right.
function figVehicle(x, o) {
  const p = o.pal, A = p.A, D = p.D, team = o.team || '#8ff5dc', k = o.kind, L = o.len || 0.62;
  const lift = k === 'hover' ? 0.2 : 0, base = -0.14 - lift;
  if (k === 'hover') { fell(x, 0, -0.02, L * 0.9, 0.07, hexA(p.G.length === 7 ? p.G : '#8ff5dc', 0.45)); fell(x, 0, -0.02, L * 0.5, 0.04, hexA('#ffffff', 0.5)); }
  // gun behind the cab
  const gun = o.gun;
  if (gun === 'tube') { x.save(); x.translate(-0.08, base - 0.2); x.rotate(-0.85); frect(x, 0, -0.08, 0.46, 0.16, '#3a3448', 0.04); frect(x, 0.38, -0.1, 0.1, 0.2, dk(D, 0.2), 0.03); x.restore(); }
  if (gun === 'big' || gun === 'coil' || gun === 'beam' || gun === 'rail') {
    const gl = o.gunLen || 0.78;
    x.save(); x.translate(-0.02, base - 0.26); x.rotate(gun === 'big' ? -0.32 : -0.18);
    frect(x, 0, -0.06, gl, 0.12, gun === 'beam' ? p.M : '#3d3850', 0.03);
    if (gun === 'coil') for (let j = 0; j < 4; j++) frect(x, 0.16 + j * 0.13, -0.1, 0.06, 0.2, j % 2 ? p.G : A, 0.02);
    if (gun === 'rail') { frect(x, 0.05, -0.1, gl - 0.05, 0.04, A, 0.02); frect(x, 0.05, 0.06, gl - 0.05, 0.04, A, 0.02); glowAt(x, gl, 0, 0.1, p.G); }
    if (gun === 'beam') { fpoly(x, [[gl - 0.05, -0.12], [gl + 0.16, 0], [gl - 0.05, 0.12]], p.G); glowAt(x, gl + 0.08, 0, 0.16, p.G); }
    if (gun === 'big') { frect(x, gl - 0.08, -0.08, 0.1, 0.16, dk(D, 0.2), 0.02); }
    x.restore();
  }
  // body
  const bh = o.bodyH || 0.24;
  fpoly(x, [[-L, base], [-L + 0.06, base - bh], [L * 0.35, base - bh], [L, base - bh * 0.35], [L, base]], lgrad(x, 0, base - bh, 0, base, [lt(A, 0.3), A, D]));
  frect(x, -L + 0.08, base - bh * 0.55, L * 1.3, 0.05, team);
  // cab / turret
  if (o.cab !== false) {
    const cw = o.cabW || 0.3;
    fpoly(x, [[-0.08, base - bh], [0.0, base - bh - 0.18], [cw, base - bh - 0.18], [cw + 0.1, base - bh]], lgrad(x, 0, base - bh - 0.2, 0, base - bh, [lt(A, 0.4), A]));
    fpoly(x, [[cw - 0.08, base - bh - 0.15], [cw, base - bh - 0.15], [cw + 0.07, base - bh - 0.02], [cw - 0.08, base - bh - 0.02]], p.V);
  }
  if (gun === 'lance') { fline(x, [[0.2, base - bh * 0.6], [L + 0.3, base - bh - 0.1]], 0.045, p.M); fpoly(x, [[L + 0.24, base - bh - 0.16], [L + 0.42, base - bh - 0.12], [L + 0.26, base - bh - 0.02]], p.G); }
  if (o.antenna) { fline(x, [[-L + 0.14, base - bh], [-L + 0.06, base - bh - 0.32]], 0.025, p.M); fcirc(x, -L + 0.06, base - bh - 0.33, 0.03, p.G); }
  if (o.armor) for (let j = 0; j < 3; j++) frect(x, -L + 0.1 + j * 0.2, base - bh + 0.04, 0.14, 0.08, lt(A, 0.25), 0.02);
  // running gear
  if (k === 'wheels') for (const wx of o.wheels || [-L + 0.14, 0, L - 0.16]) { fcirc(x, wx, -0.12, 0.12, '#211c2e'); fcirc(x, wx, -0.12, 0.05, p.M); }
  if (k === 'tracks') { frect(x, -L - 0.02, base + 0.0, L * 2 + 0.04, 0.14, '#211c2e', 0.07); for (let j = 0; j < 5; j++) fcirc(x, -L + 0.1 + j * (L * 2 - 0.2) / 4, base + 0.07, 0.045, p.M); }
  if (k === 'hover') { frect(x, -L * 0.7, base, L * 1.4, 0.05, dk(D, 0.2), 0.02); glowAt(x, -L * 0.4, base + 0.06, 0.1, p.G); glowAt(x, L * 0.4, base + 0.06, 0.1, p.G); }
}
// A bike or trike with a rider leaning forward.
function figBike(x, o) {
  const p = o.pal, A = p.A, D = p.D, team = o.team || '#8ff5dc', heavy = o.heavy;
  fcirc(x, -0.36, -0.15, heavy ? 0.16 : 0.14, '#211c2e'); fcirc(x, -0.36, -0.15, 0.06, p.M);
  fcirc(x, 0.38, -0.15, heavy ? 0.16 : 0.14, '#211c2e'); fcirc(x, 0.38, -0.15, 0.06, p.M);
  fpoly(x, [[-0.4, -0.2], [-0.2, -0.42], [0.3, -0.4], [0.48, -0.24], [0.2, -0.16], [-0.2, -0.16]], lgrad(x, 0, -0.42, 0, -0.16, [lt(A, 0.3), A, D]));
  if (heavy) { fpoly(x, [[0.2, -0.42], [0.56, -0.36], [0.6, -0.22], [0.42, -0.2]], lt(A, 0.15)); frect(x, -0.34, -0.36, 0.5, 0.06, team, 0.02); }
  else frect(x, -0.3, -0.34, 0.4, 0.05, team, 0.02);
  fpoly(x, [[-0.1, -0.42], [0.06, -0.42], [0.12, -0.72], [-0.06, -0.74]], D);
  fpoly(x, [[-0.04, -0.72], [0.12, -0.74], [0.24, -0.52], [0.16, -0.48]], A);
  fcirc(x, 0.1, -0.84, 0.12, lgrad(x, 0, -0.96, 0, -0.72, [lt(A, 0.35), A, D])); frect(x, 0.12, -0.88, 0.12, 0.06, p.V, 0.03);
  if (o.lance) { fline(x, [[-0.1, -0.5], [0.8, -0.86]], 0.04, p.M); fpoly(x, [[0.74, -0.92], [0.92, -0.9], [0.78, -0.8]], p.G); }
  if (o.plume) fcurve(x, [0.06, -0.94], [-0.04, -1.1], [-0.24, -1.0], 0.06, team);
}
// Ridden beasts and living siege engines of the Communion.
function figBeast(x, o) {
  const p = o.pal, A = p.A, D = p.D, team = o.team || '#8ff5dc', k = o.kind;
  if (k === 'loper') {
    for (const [lx, c] of [[-0.3, D], [0.24, D], [-0.2, A], [0.34, A]]) fpoly(x, [[lx - 0.04, -0.36], [lx + 0.04, -0.36], [lx + 0.02, 0], [lx - 0.06, 0]], c);
    fell(x, 0, -0.42, 0.42, 0.14, lgrad(x, 0, -0.56, 0, -0.28, [lt(A, 0.3), A, D]));
    fpoly(x, [[0.3, -0.48], [0.4, -0.78], [0.52, -0.8], [0.44, -0.44]], A); fell(x, 0.52, -0.82, 0.13, 0.07, A, 0.3); fcirc(x, 0.56, -0.84, 0.02, '#1a1226');
    fline(x, [[-0.4, -0.44], [-0.62, -0.62]], 0.05, D);
    for (const a of [-1.9, -1.6]) fline(x, [[0.44, -0.86], [0.44 + Math.cos(a) * 0.18, -0.86 + Math.sin(a) * 0.18]], 0.025, p.T || p.M);
    fpoly(x, [[-0.14, -0.52], [0.06, -0.52], [0.08, -0.82], [-0.08, -0.82]], D); frect(x, -0.16, -0.62, 0.26, 0.05, team);
    fcirc(x, 0.0, -0.92, 0.1, A); frect(x, 0.02, -0.95, 0.1, 0.05, p.V, 0.02);
    fline(x, [[0.06, -0.78], [0.4, -1.02]], 0.035, p.M);
  } else if (k === 'rhino') {
    for (const [lx, c] of [[-0.42, D], [0.28, D], [-0.28, A], [0.42, A]]) frect(x, lx - 0.07, -0.3, 0.14, 0.3, c, 0.04);
    fell(x, -0.02, -0.46, 0.56, 0.26, lgrad(x, 0, -0.72, 0, -0.2, [lt(A, 0.3), A, D]));
    for (let j = 0; j < 4; j++) fpoly(x, [[-0.4 + j * 0.2, -0.64], [-0.3 + j * 0.2, -0.86], [-0.22 + j * 0.2, -0.64]], p.T || p.M);
    fell(x, 0.56, -0.44, 0.2, 0.15, A); fpoly(x, [[0.64, -0.52], [0.86, -0.72], [0.74, -0.44]], p.T || '#f2ead0'); fcirc(x, 0.6, -0.5, 0.025, '#1a1226');
    frect(x, -0.3, -0.78, 0.4, 0.1, team, 0.03); fcirc(x, -0.1, -0.9, 0.09, A); frect(x, -0.08, -0.93, 0.09, 0.05, p.V, 0.02);
    for (const [gx, gy] of [[-0.3, -0.5], [0.0, -0.36], [0.24, -0.52]]) fcirc(x, gx, gy, 0.035, p.G);
  } else if (k === 'sporebulb') {
    for (const [lx, c] of [[-0.3, D], [0.22, D], [-0.16, A], [0.34, A]]) fline(x, [[lx, -0.24], [lx + 0.06, -0.12], [lx - 0.02, 0]], 0.07, c);
    fell(x, 0, -0.34, 0.42, 0.18, lgrad(x, 0, -0.5, 0, -0.18, [lt(A, 0.3), A, D]));
    fell(x, -0.04, -0.66, 0.26, 0.24, rgrad(x, -0.1, -0.74, 0.02, 0.3, ['#ffd0f4', '#c060b0', '#6a2060']));
    for (const [sx, sy] of [[-0.14, -0.78], [0.06, -0.72], [-0.06, -0.56]]) fcirc(x, sx, sy, 0.04, '#fff0fa');
    x.save(); x.translate(0.08, -0.74); x.rotate(-0.8); frect(x, 0, -0.07, 0.42, 0.14, D, 0.06); fell(x, 0.44, 0, 0.06, 0.12, p.G); x.restore();
    frect(x, -0.3, -0.38, 0.6, 0.05, team, 0.02);
  } else if (k === 'maw') {
    fell(x, 0, -0.06, 0.62, 0.1, '#3a2a30');
    for (let j = 0; j < 4; j++) fell(x, -0.42 + j * 0.16, -0.2 - j * 0.12, 0.17, 0.15, lgrad(x, 0, -0.4 - j * 0.12, 0, -0.05 - j * 0.12, [lt(A, 0.25), A, D]));
    fell(x, 0.24, -0.76, 0.3, 0.3, lgrad(x, 0, -1.06, 0, -0.46, [lt(A, 0.3), A, D]));
    fell(x, 0.36, -0.76, 0.17, 0.21, '#2a0c20'); for (let j = 0; j < 8; j++) { const a = j * 0.785; fpoly(x, [[0.36 + Math.cos(a) * 0.17, -0.76 + Math.sin(a) * 0.21], [0.36 + Math.cos(a + 0.2) * 0.07, -0.76 + Math.sin(a + 0.2) * 0.09], [0.36 + Math.cos(a + 0.4) * 0.17, -0.76 + Math.sin(a + 0.4) * 0.21]], '#f2ead0'); }
    glowAt(x, 0.36, -0.76, 0.1, p.G); frect(x, -0.3, -0.42, 0.3, 0.05, team, 0.02);
  }
}
// Boats, ships and the living hulls of the Communion. Waterline at y = 0.
function figBoat(x, o) {
  const p = o.pal, A = p.A, D = p.D, team = o.team || '#8ff5dc', k = o.kind, L = o.len || 0.72;
  fell(x, 0, 0.02, L * 1.08, 0.08, 'rgba(220,255,250,.45)');
  if (k === 'shark' || k === 'puffer' || k === 'kraken' || k === 'siren') return figSeaBeast(x, o);
  const deck = -(o.deckH || 0.16);
  fpoly(x, [[-L, deck], [L * 0.7, deck], [L + 0.12, deck - 0.06], [L * 0.8, 0.04], [-L + 0.08, 0.04]], lgrad(x, 0, deck, 0, 0.04, [lt(A, 0.25), A, D]));
  frect(x, -L + 0.06, deck + 0.04, L * 1.6, 0.04, team);
  const sup = o.sup || 'cabin';
  if (sup === 'cabin') { fpoly(x, [[-0.24, deck], [-0.18, deck - 0.18], [0.16, deck - 0.18], [0.24, deck]], lt(A, 0.2)); frect(x, 0.04, deck - 0.15, 0.14, 0.07, p.V, 0.02); }
  if (sup === 'foil') { fpoly(x, [[-0.3, deck], [-0.1, deck - 0.2], [0.3, deck - 0.2], [0.44, deck]], lt(A, 0.25)); frect(x, 0.16, deck - 0.17, 0.2, 0.08, p.V, 0.03); for (const fx of [-0.4, 0.4]) { fline(x, [[fx, 0.02], [fx + 0.05, 0.16]], 0.04, D); frect(x, fx - 0.04, 0.14, 0.2, 0.03, p.G, 0.01); } }
  if (sup === 'tower' || sup === 'dread' || sup === 'battle' || sup === 'aegis' || sup === 'cruiser' || sup === 'frigate' || sup === 'gun') {
    const tw = sup === 'battle' || sup === 'dread' ? 0.34 : 0.26, th = sup === 'battle' ? 0.42 : sup === 'dread' ? 0.36 : 0.28;
    fpoly(x, [[-tw, deck], [-tw * 0.8, deck - th * 0.6], [-tw * 0.3, deck - th * 0.6], [-tw * 0.2, deck - th], [tw * 0.3, deck - th], [tw * 0.4, deck - th * 0.6], [tw, deck - th * 0.5], [tw * 1.1, deck]], lgrad(x, 0, deck - th, 0, deck, [lt(A, 0.35), A]));
    frect(x, tw * 0.05, deck - th * 0.92, tw * 0.3, 0.05, p.V, 0.02);
    fline(x, [[-tw * 0.05, deck - th], [-tw * 0.05, deck - th - 0.2]], 0.025, p.M);
    const gunAt = (gx, s) => { fell(x, gx, deck - 0.05, 0.09 * s, 0.06 * s, dk(A, 0.15)); fline(x, [[gx, deck - 0.07], [gx + 0.22 * s, deck - 0.12]], 0.045 * s, '#2d2840'); };
    if (sup === 'gun') gunAt(0.44, 1.1);
    if (sup === 'dread' || sup === 'battle') { gunAt(0.46, 1.2); gunAt(-0.5, 1.1); if (sup === 'battle') gunAt(0.68, 0.9); }
    if (sup === 'frigate') { frect(x, 0.32, deck - 0.12, 0.36, 0.04, A, 0.01); frect(x, 0.32, deck - 0.06, 0.36, 0.04, A, 0.01); glowAt(x, 0.7, deck - 0.08, 0.08, p.G); }
    if (sup === 'cruiser') for (let j = 0; j < 3; j++) frect(x, 0.34 + j * 0.1, deck - 0.12, 0.07, 0.1, '#e6e0ee', 0.02);
    if (sup === 'aegis') { x.beginPath(); x.ellipse(0, deck - 0.08, L * 0.95, 0.42, 0, Math.PI, 0); x.lineWidth = 0.04; x.strokeStyle = hexA('#8ff8ff', 0.8); x.stroke(); x.fillStyle = 'rgba(140,250,255,.14)'; x.fill(); }
  }
  if (sup === 'carrier') { frect(x, -L, deck - 0.08, L * 1.9, 0.08, lt(A, 0.15), 0.02); for (let j = 0; j < 4; j++) frect(x, -L + 0.1 + j * 0.36, deck - 0.05, 0.18, 0.02, p.G); fpoly(x, [[0.3, deck - 0.08], [0.34, deck - 0.34], [0.5, deck - 0.34], [0.52, deck - 0.08]], A); fpoly(x, [[-0.2, deck - 0.42], [0.02, deck - 0.5], [0.0, deck - 0.4]], p.M); }
  if (o.lance) { fline(x, [[0.3, deck - 0.02], [L + 0.34, deck - 0.24]], 0.04, p.M); fpoly(x, [[L + 0.28, deck - 0.3], [L + 0.46, deck - 0.3], [L + 0.32, deck - 0.18]], p.G); }
  if (o.ram) fpoly(x, [[L + 0.08, deck - 0.04], [L + 0.3, deck + 0.04], [L * 0.86, deck + 0.1]], p.M);
  if (o.mast) { fline(x, [[-0.1, deck], [-0.1, deck - 0.5]], 0.03, p.M); fpoly(x, [[-0.08, deck - 0.48], [0.18, deck - 0.4], [-0.08, deck - 0.32]], team); }
}
function figSeaBeast(x, o) {
  const p = o.pal, A = p.A, D = p.D, team = o.team || '#8ff5dc', k = o.kind;
  if (k === 'shark') {
    fpoly(x, [[-0.7, -0.06], [-0.3, -0.24], [0.4, -0.22], [0.78, -0.06], [0.4, 0.04], [-0.4, 0.04]], lgrad(x, 0, -0.26, 0, 0.04, [lt(A, 0.3), A, D]));
    fpoly(x, [[-0.06, -0.22], [0.06, -0.52], [0.16, -0.22]], A); fpoly(x, [[-0.66, -0.08], [-0.9, -0.3], [-0.8, -0.04]], D);
    fcirc(x, 0.58, -0.14, 0.025, '#fff'); fline(x, [[0.5, -0.06], [0.68, -0.07]], 0.02, '#2a0c20');
    frect(x, -0.32, -0.32, 0.22, 0.08, team, 0.03); fcirc(x, -0.2, -0.42, 0.07, A); frect(x, -0.19, -0.45, 0.07, 0.04, p.V, 0.02);
  } else if (k === 'puffer') {
    fell(x, 0, -0.26, 0.5, 0.3, lgrad(x, 0, -0.56, 0, 0.04, [lt(A, 0.3), A, D]));
    for (let j = 0; j < 9; j++) { const a = Math.PI + j * Math.PI / 8; fpoly(x, [[Math.cos(a - 0.08) * 0.48, -0.26 + Math.sin(a - 0.08) * 0.28], [Math.cos(a) * 0.66, -0.26 + Math.sin(a) * 0.42], [Math.cos(a + 0.08) * 0.48, -0.26 + Math.sin(a + 0.08) * 0.28]], p.T || p.M); }
    frect(x, -0.3, -0.6, 0.5, 0.08, team, 0.03); x.save(); x.translate(0.0, -0.62); x.rotate(-0.4); frect(x, 0, -0.04, 0.34, 0.08, D, 0.03); x.restore();
    fcirc(x, 0.36, -0.3, 0.04, '#fff'); fcirc(x, 0.37, -0.3, 0.018, '#1a1226');
  } else if (k === 'kraken') {
    for (let j = 0; j < 5; j++) { const bx = -0.5 + j * 0.25; fcurve(x, [bx, 0.02], [bx + (j % 2 ? 0.2 : -0.2), -0.36], [bx + (j % 2 ? -0.08 : 0.1), -0.58 - (j % 3) * 0.08], 0.09, j % 2 ? A : D); fcirc(x, bx + (j % 2 ? -0.08 : 0.1), -0.6 - (j % 3) * 0.08, 0.05, lt(A, 0.3)); }
    fell(x, 0.04, -0.34, 0.3, 0.36, lgrad(x, 0, -0.7, 0, 0, [lt(A, 0.35), A, D]));
    fcirc(x, 0.14, -0.36, 0.06, '#fff2a8'); fcirc(x, 0.16, -0.36, 0.025, '#1a1226'); glowAt(x, -0.06, -0.52, 0.1, p.G);
    frect(x, -0.2, -0.16, 0.44, 0.06, team, 0.02);
  } else if (k === 'siren') {
    fcurve(x, [-0.7, 0.0], [-0.3, -0.3], [0.1, -0.12], 0.16, D);
    fpoly(x, [[-0.1, -0.1], [0.18, -0.12], [0.28, -0.62], [0.08, -0.7], [0.0, -0.4]], lgrad(x, 0, -0.7, 0, -0.1, [lt(A, 0.35), A, D]));
    for (let j = 0; j < 4; j++) fpoly(x, [[0.06 - j * 0.03, -0.66 + j * 0.12], [-0.22 - j * 0.04, -0.82 + j * 0.14], [0.0 - j * 0.03, -0.58 + j * 0.12]], p.G);
    fcirc(x, 0.2, -0.78, 0.11, A); fcirc(x, 0.25, -0.79, 0.025, '#fff'); glowAt(x, 0.2, -0.92, 0.12, p.G);
    fpoly(x, [[-0.7, 0.0], [-0.92, -0.2], [-0.84, 0.04]], p.G); frect(x, 0.02, -0.36, 0.24, 0.05, team, 0.02);
  }
}
// Native fauna: pink-violet chitin and glowing eyes.
function figFauna(x, o) {
  const p = FIG_PAL.fauna, A = p.A, D = p.D, k = o.kind;
  if (k === 'skitter') {
    for (const [bx, by, s] of [[-0.32, -0.04, 0.72], [0.3, -0.1, 0.8], [0.0, 0.06, 1]]) {
      x.save(); x.translate(bx, by); x.scale(s, s);
      for (let j = 0; j < 3; j++) { fline(x, [[-0.08 + j * 0.1, -0.12], [-0.18 + j * 0.14, -0.24], [-0.24 + j * 0.16, 0]], 0.035, D); }
      fell(x, 0, -0.16, 0.22, 0.12, lgrad(x, 0, -0.28, 0, -0.04, [lt(A, 0.35), A, D])); fline(x, [[-0.2, -0.16], [0.2, -0.16]], 0.02, dk(D, 0.2));
      fell(x, 0.22, -0.18, 0.08, 0.07, A); fcirc(x, 0.26, -0.2, 0.025, p.V);
      fcurve(x, [0.26, -0.24], [0.36, -0.38], [0.44, -0.34], 0.02, p.M); x.restore();
    }
  } else if (k === 'delver') {
    fell(x, -0.1, -0.06, 0.56, 0.14, '#4a3530'); fell(x, -0.1, -0.12, 0.4, 0.08, '#6a4c40');
    for (const [rx, ry] of [[-0.5, -0.08], [0.32, -0.1], [-0.3, -0.16]]) fell(x, rx, ry, 0.07, 0.05, '#2c201c');
    x.lineCap = 'round'; fcurve(x, [-0.22, -0.08], [-0.14, -0.9], [0.32, -0.62], 0.26, D); fcurve(x, [-0.22, -0.08], [-0.14, -0.9], [0.32, -0.62], 0.2, A);
    for (let j = 1; j < 5; j++) { const t = j / 5, px = (1 - t) * (1 - t) * -0.22 + 2 * (1 - t) * t * -0.14 + t * t * 0.32, py = (1 - t) * (1 - t) * -0.08 + 2 * (1 - t) * t * -0.9 + t * t * -0.62; fell(x, px, py, 0.1, 0.03, lt(A, 0.3), -0.6 + t); }
    fell(x, 0.36, -0.6, 0.14, 0.13, D); fcirc(x, 0.4, -0.6, 0.08, '#2a0c20'); for (let j = 0; j < 6; j++) { const a = j * 1.047; fcirc(x, 0.4 + Math.cos(a) * 0.08, -0.6 + Math.sin(a) * 0.08, 0.02, '#f2ead0'); }
  } else if (k === 'spinemaw') {
    for (let j = 0; j < 3; j++) { fline(x, [[-0.1 + j * 0.14, -0.18], [-0.22 + j * 0.16, -0.32], [-0.3 + j * 0.18, 0]], 0.04, D); }
    fell(x, 0.02, -0.2, 0.36, 0.14, lgrad(x, 0, -0.34, 0, -0.06, [lt(A, 0.3), A, D]));
    x.lineCap = 'round'; fcurve(x, [-0.3, -0.22], [-0.7, -0.5], [-0.36, -0.86], 0.12, D); fcurve(x, [-0.3, -0.22], [-0.7, -0.5], [-0.36, -0.86], 0.08, A);
    fpoly(x, [[-0.42, -0.82], [-0.18, -0.96], [-0.3, -0.76]], p.V); glowAt(x, -0.24, -0.9, 0.1, p.G);
    for (let j = 0; j < 4; j++) fpoly(x, [[-0.2 + j * 0.12, -0.3], [-0.16 + j * 0.12, -0.46], [-0.1 + j * 0.12, -0.3]], p.M);
    fell(x, 0.4, -0.22, 0.14, 0.12, A); fpoly(x, [[0.46, -0.3], [0.68, -0.36], [0.54, -0.22]], '#f2ead0'); fpoly(x, [[0.46, -0.14], [0.68, -0.08], [0.54, -0.2]], '#f2ead0'); fcirc(x, 0.44, -0.28, 0.03, p.V);
  } else if (k === 'ravager') {
    for (const [lx, c] of [[-0.36, D], [0.0, D], [0.3, D], [-0.26, A], [0.1, A], [0.4, A]]) fpoly(x, [[lx - 0.05, -0.3], [lx + 0.05, -0.3], [lx + 0.03, 0], [lx - 0.07, 0]], c);
    fell(x, 0, -0.4, 0.48, 0.2, lgrad(x, 0, -0.6, 0, -0.2, [lt(A, 0.3), A, D]));
    for (let j = 0; j < 5; j++) fpoly(x, [[-0.34 + j * 0.15, -0.54], [-0.3 + j * 0.15, -0.74 - (j % 2) * 0.06], [-0.22 + j * 0.15, -0.54]], p.M);
    fell(x, 0.5, -0.4, 0.18, 0.15, A); fpoly(x, [[0.6, -0.36], [0.8, -0.5], [0.66, -0.3]], '#f2ead0'); fcirc(x, 0.56, -0.46, 0.035, p.V);
  } else if (k === 'titanoth') {
    for (const [lx, c] of [[-0.5, D], [0.32, D], [-0.34, A], [0.5, A]]) frect(x, lx - 0.1, -0.4, 0.2, 0.4, c, 0.06);
    fell(x, -0.04, -0.66, 0.66, 0.4, lgrad(x, 0, -1.06, 0, -0.26, [lt(A, 0.3), A, D]));
    for (let j = 0; j < 5; j++) fell(x, -0.5 + j * 0.24, -0.9 + Math.abs(j - 2) * 0.05, 0.16, 0.1, lt(A, 0.2 + (j % 2) * 0.1), -0.2);
    fell(x, 0.6, -0.62, 0.24, 0.22, A); fcurve(x, [0.74, -0.5], [0.92, -0.3], [0.82, -0.08], 0.09, D);
    fcurve(x, [0.6, -0.48], [0.9, -0.5], [1.0, -0.76], 0.06, '#f2ead0');
    fcirc(x, 0.66, -0.7, 0.04, p.V); for (const [gx, gy] of [[-0.4, -0.56], [-0.1, -0.46], [0.2, -0.58], [-0.24, -0.74]]) glowAt(x, gx, gy, 0.07, p.G);
  } else if (k === 'tidewyrm') {
    fell(x, 0, 0.02, 0.86, 0.08, 'rgba(220,255,250,.45)');
    for (const [cx, rr] of [[-0.52, 0.18], [0.0, 0.22]]) { x.beginPath(); x.arc(cx, 0, rr, Math.PI, 0); x.lineWidth = 0.16; x.strokeStyle = D; x.stroke(); x.lineWidth = 0.1; x.strokeStyle = A; x.stroke(); }
    fcurve(x, [0.28, 0.0], [0.36, -0.5], [0.6, -0.62], 0.16, D); fcurve(x, [0.28, 0.0], [0.36, -0.5], [0.6, -0.62], 0.1, A);
    fell(x, 0.66, -0.64, 0.16, 0.1, A, 0.3); fpoly(x, [[0.7, -0.6], [0.92, -0.54], [0.74, -0.52]], '#f2ead0'); fcirc(x, 0.68, -0.68, 0.03, p.V);
    for (let j = 0; j < 4; j++) fpoly(x, [[0.3 + j * 0.06, -0.24 - j * 0.12], [0.18 + j * 0.06, -0.34 - j * 0.12], [0.34 + j * 0.06, -0.32 - j * 0.12]], p.G);
  }
}
// Civilians: pods, rigs, haulers, explorers, agents and the great people.
function figCivil(x, o) {
  const p = o.pal, A = p.A, D = p.D, team = o.team || '#8ff5dc', k = o.kind;
  if (k === 'pod') {
    for (const lx of [-0.34, -0.12, 0.12, 0.34]) fline(x, [[lx * 0.6, -0.3], [lx, 0]], 0.05, '#4a4470');
    x.beginPath(); x.arc(0, -0.34, 0.36, Math.PI, 0); x.closePath(); x.fillStyle = rgrad(x, -0.12, -0.56, 0.02, 0.4, ['#e8fbff', '#9fd8e8', '#4a8aa0']); x.fill();
    frect(x, -0.4, -0.36, 0.8, 0.1, lgrad(x, 0, -0.36, 0, -0.26, ['#d8dcea', '#7a7f98']), 0.03); frect(x, -0.36, -0.33, 0.72, 0.04, team);
    fline(x, [[0, -0.7], [0, -0.86]], 0.025, '#c9d3e6'); glowAt(x, 0, -0.88, 0.1, '#8ff5dc');
    x.beginPath(); x.arc(0, -0.34, 0.26, Math.PI * 1.15, Math.PI * 1.5); x.lineWidth = 0.035; x.strokeStyle = 'rgba(255,255,255,.7)'; x.stroke();
  } else if (k === 'rig') {
    fline(x, [[-0.16, -0.36], [-0.3, -0.18], [-0.2, 0]], 0.07, D); fline(x, [[0.16, -0.36], [0.3, -0.18], [0.22, 0]], 0.07, A);
    frect(x, -0.28, -0.66, 0.5, 0.32, lgrad(x, 0, -0.66, 0, -0.34, [lt(A, 0.3), A, D]), 0.06); frect(x, -0.24, -0.5, 0.42, 0.05, team);
    frect(x, 0.02, -0.62, 0.16, 0.08, p.V, 0.03);
    fline(x, [[0.2, -0.5], [0.42, -0.38], [0.48, -0.16]], 0.06, D); fpoly(x, [[0.42, -0.18], [0.56, -0.18], [0.49, 0.02]], '#e6c35a');
    fline(x, [[-0.2, -0.66], [-0.2, -0.86]], 0.025, p.M); fcirc(x, -0.2, -0.88, 0.035, '#ffb44d');
  } else if (k === 'hauler') {
    for (const wx of [-0.5, -0.22, 0.22, 0.5]) { fcirc(x, wx, -0.12, 0.11, '#211c2e'); fcirc(x, wx, -0.12, 0.04, p.M); }
    frect(x, -0.64, -0.5, 0.82, 0.34, lgrad(x, 0, -0.5, 0, -0.16, [lt(team, 0.25), team, dk(team, 0.3)]), 0.04);
    fline(x, [[-0.38, -0.5], [-0.38, -0.16]], 0.02, dk(team, 0.4)); fline(x, [[-0.1, -0.5], [-0.1, -0.16]], 0.02, dk(team, 0.4));
    fpoly(x, [[0.22, -0.16], [0.22, -0.46], [0.48, -0.46], [0.66, -0.3], [0.66, -0.16]], lgrad(x, 0, -0.46, 0, -0.16, [lt(A, 0.3), A, D])); fpoly(x, [[0.42, -0.42], [0.5, -0.42], [0.6, -0.3], [0.42, -0.3]], p.V);
    glowAt(x, 0.66, -0.22, 0.06, '#ffe6a0');
  } else if (k === 'sat') {
    fpoly(x, [[-0.3, 0], [-0.2, -0.16], [0.2, -0.16], [0.3, 0]], '#4a4470');
    frect(x, -0.12, -0.56, 0.24, 0.4, lgrad(x, -0.12, 0, 0.12, 0, ['#e6e8f2', '#8c90a8']), 0.04); frect(x, -0.1, -0.4, 0.2, 0.05, team);
    for (const s of [-1, 1]) { frect(x, s > 0 ? 0.16 : -0.5, -0.5, 0.34, 0.2, '#1d3b6b', 0.02); for (let j = 1; j < 3; j++) fline(x, [[(s > 0 ? 0.16 : -0.5) + j * 0.113, -0.5], [(s > 0 ? 0.16 : -0.5) + j * 0.113, -0.3]], 0.015, '#7fb8ff'); }
    fline(x, [[0, -0.56], [0, -0.72]], 0.025, p.M); glowAt(x, 0, -0.74, 0.09, o.glow || '#8ff5dc');
  }
}
const GP_ITEM = {
  great_scientist: (x, cx, cy) => { fpoly(x, [[cx - 0.03, cy - 0.16], [cx + 0.03, cy - 0.16], [cx + 0.03, cy - 0.06], [cx + 0.1, cy + 0.06], [cx - 0.1, cy + 0.06], [cx - 0.03, cy - 0.06]], '#e8f6ff'); fpoly(x, [[cx - 0.07, cy], [cx + 0.07, cy], [cx + 0.1, cy + 0.06], [cx - 0.1, cy + 0.06]], '#7ff5a0'); glowAt(x, cx, cy, 0.1, '#7ff5a0'); },
  great_engineer: (x, cx, cy) => { for (let j = 0; j < 8; j++) { const a = j * 0.785; fcirc(x, cx + Math.cos(a) * 0.09, cy + Math.sin(a) * 0.09, 0.03, '#f0a050'); } fcirc(x, cx, cy, 0.08, '#f0a050'); fcirc(x, cx, cy, 0.03, '#3a2a18'); },
  great_merchant: (x, cx, cy) => { fpoly(x, [[cx, cy - 0.12], [cx + 0.1, cy], [cx, cy + 0.12], [cx - 0.1, cy]], '#f2d264'); glowAt(x, cx, cy, 0.12, '#f2d264'); },
  great_artist: (x, cx, cy) => { fell(x, cx, cy, 0.12, 0.08, '#e8d8c0', -0.3); for (const [dx, c] of [[-0.05, '#ff6f80'], [0.0, '#5fe0a0'], [0.05, '#7fb8ff']]) fcirc(x, cx + dx, cy - 0.01, 0.025, c); },
  great_general: (x, cx, cy) => { fline(x, [[cx - 0.04, cy + 0.12], [cx - 0.04, cy - 0.3]], 0.025, '#c9d3e6'); fpoly(x, [[cx - 0.03, cy - 0.3], [cx + 0.2, cy - 0.24], [cx - 0.03, cy - 0.14]], '#ff6f80'); },
};
// Which painter and options draw each unit type.
function unitFigSpec(type) {
  const U = UNITS[type]; if (!U) return null;
  const base = U.replaces || type, aff = U.aff, pal = FIG_PAL[aff || 'base'], t = U.tier || 1;
  const H = (o) => ({ f: figHuman, o: Object.assign({ pal }, o) });
  const S = {
    militia: H({ helm: 'dome', weapon: 'rifle' }), legionary: H({ helm: 'crest', weapon: 'rifle', shield: 'round', bulk: 1.08, pal: FIG_PAL.base }),
    grove_ranger: H({ helm: 'leaf', weapon: 'rifle', back: 'hood', capeCol: '#2f6b46', pal: Object.assign({}, FIG_PAL.base, { A: '#7fae8a', D: '#2f5a3e' }) }),
    thornguard: H({ helm: 'horns', weapon: 'lance', back: 'thorns', chest: 'plates' }), servitor: H({ helm: 'eye', weapon: 'rifle', chest: 'core', back: 'coils', bulk: 1.05 }), vanguard: H({ helm: 'crest', weapon: 'rifle', shield: 'round', bulk: 1.05 }),
    sporewarden: H({ helm: 'horns', weapon: 'lance', back: 'canopy', chest: 'plates', bulk: 1.2 }), exo_legion: H({ helm: 'eye', weapon: 'heavy', chest: 'core', back: 'antenna', bulk: 1.25 }), paladin: H({ helm: 'plume', weapon: 'sword', shield: 'tower', back: 'cape', bulk: 1.18 }),
    skirmisher: H({ helm: 'dome', weapon: 'longrifle', pose: 'kneel', back: 'pack' }), pulse_sentry: H({ helm: 'antenna', weapon: 'longrifle', pose: 'kneel', back: 'antenna' }),
    veil_chanter: H({ helm: 'hood', weapon: 'staff', back: 'hood', capeCol: '#6a3a8a', flowerCol: '#e0a0ff' }),
    spineflinger: H({ helm: 'leaf', weapon: 'sling', back: 'quills' }), railgunner: H({ helm: 'eye', weapon: 'rail', pose: 'kneel', back: 'coils' }), longwatch: H({ helm: 'dome', weapon: 'longrifle', pose: 'kneel', back: 'cape' }),
    bloomcaller: H({ helm: 'leaf', weapon: 'staff', back: 'canopy', bulk: 1.1 }), arc_lancer: H({ helm: 'eye', weapon: 'lance', chest: 'core', back: 'coils', bulk: 1.1 }), sentinel_corps: H({ helm: 'crest', weapon: 'heavy', back: 'antenna', bulk: 1.15 }),
    rover: { f: figVehicle, o: { pal, kind: 'wheels', gun: 'none', antenna: true } }, contract_rover: { f: figVehicle, o: { pal: Object.assign({}, FIG_PAL.base, { A: '#e2b45a', D: '#6a4a12' }), kind: 'wheels', antenna: true } },
    wildrunner: { f: figBeast, o: { pal, kind: 'loper' } }, hover_lancer: { f: figVehicle, o: { pal, kind: 'hover', gun: 'lance', len: 0.56 } }, dragoon: { f: figBike, o: { pal } },
    stormback: { f: figBeast, o: { pal, kind: 'rhino' } }, phase_skimmer: { f: figVehicle, o: { pal, kind: 'hover', gun: 'rail', len: 0.64, gunLen: 0.6 } }, cuirassier: { f: figBike, o: { pal, heavy: true, lance: true, plume: true } },
    mortar: { f: figVehicle, o: { pal, kind: 'tracks', gun: 'tube', cab: false } }, forge_crawler: { f: figVehicle, o: { pal: Object.assign({}, FIG_PAL.base, { A: '#d07a3a', D: '#5a2a10', G: '#ffb070' }), kind: 'tracks', gun: 'tube', cab: false } },
    spore_mortar: { f: figBeast, o: { pal, kind: 'sporebulb' } }, mass_driver: { f: figVehicle, o: { pal, kind: 'tracks', gun: 'coil', cab: false } }, howitzer: { f: figVehicle, o: { pal, kind: 'wheels', gun: 'big', cab: false, wheels: [-0.42, 0.42] } },
    gravemaw: { f: figBeast, o: { pal, kind: 'maw' } }, breaker: { f: figVehicle, o: { pal, kind: 'hover', gun: 'beam', cab: false, len: 0.6 } }, citadel_gun: { f: figVehicle, o: { pal, kind: 'tracks', gun: 'big', cab: false, armor: true, gunLen: 0.9, bodyH: 0.3 } },
    skiff: { f: figBoat, o: { pal, sup: 'cabin', len: 0.6 } }, reef_lancer: { f: figBoat, o: { pal, sup: 'cabin', len: 0.6, lance: true } },
    reef_stalker: { f: figBoat, o: { pal, kind: 'shark' } }, hydrofoil: { f: figBoat, o: { pal, sup: 'foil', len: 0.66 } }, cutter: { f: figBoat, o: { pal, sup: 'tower', ram: true } },
    tide_kraken: { f: figBoat, o: { pal, kind: 'kraken' } }, aegis_hull: { f: figBoat, o: { pal, sup: 'aegis', len: 0.78 } }, dreadnought: { f: figBoat, o: { pal, sup: 'dread', ram: true, len: 0.84, deckH: 0.2 } },
    gunboat: { f: figBoat, o: { pal, sup: 'gun', len: 0.66 } }, spine_barge: { f: figBoat, o: { pal, kind: 'puffer' } }, rail_frigate: { f: figBoat, o: { pal, sup: 'frigate', len: 0.76 } }, missile_cruiser: { f: figBoat, o: { pal, sup: 'cruiser', len: 0.78 } },
    abyssal_siren: { f: figBoat, o: { pal, kind: 'siren' } }, arc_carrier: { f: figBoat, o: { pal, sup: 'carrier', len: 0.86 } }, battleship: { f: figBoat, o: { pal, sup: 'battle', len: 0.88, deckH: 0.2 } },
    scout: H({ helm: 'dome', weapon: 'spyglass', back: 'pack', pal: Object.assign({}, FIG_PAL.base, { A: '#b8a07a', D: '#5a4a32' }) }),
    wayfinder: H({ helm: 'hood', weapon: 'lantern', back: 'pack', capeCol: '#3a6a7a', pal: Object.assign({}, FIG_PAL.base, { A: '#a8b890', D: '#4a5a3a' }) }),
    spy: H({ helm: 'hood', weapon: 'none', back: 'hood', capeCol: '#2a2238', pal: Object.assign({}, FIG_PAL.base, { A: '#4a4460', D: '#1e1a2c', V: '#ff6f80' }) }),
    settler: { f: figCivil, o: { pal, kind: 'pod' } }, builder: { f: figCivil, o: { pal: Object.assign({}, FIG_PAL.base, { A: '#e2b45a', D: '#6a4a12' }), kind: 'rig' } }, caravan: { f: figCivil, o: { pal, kind: 'hauler' } },
    skitter: { f: figFauna, o: { kind: 'skitter' }, big: 1.15 }, delver: { f: figFauna, o: { kind: 'delver' } }, spinemaw: { f: figFauna, o: { kind: 'spinemaw' } }, ravager: { f: figFauna, o: { kind: 'ravager' } }, titanoth: { f: figFauna, o: { kind: 'titanoth' }, big: 1.2 }, tidewyrm: { f: figFauna, o: { kind: 'tidewyrm' }, big: 1.1 },
  };
  if (S[type]) return S[type];
  if (GP_ITEM[type]) return H({ helm: 'hood', weapon: 'item', item: GP_ITEM[type], back: 'hood', capeCol: { great_scientist: '#2a6a8a', great_engineer: '#8a5a2a', great_merchant: '#8a6a1a', great_artist: '#6a2a7a', great_general: '#7a2030' }[type], pal: Object.assign({}, FIG_PAL.base, { A: '#d8d0e8', D: '#6a6280' }) });
  if (SATS[type]) return { f: figCivil, o: { pal, kind: 'sat', glow: { sat_helio: '#ffd27a', sat_survey: '#8ff5dc', sat_sentinel: '#ff8f8f', sat_scrubber: '#c8b0ff', sat_seeder: '#ff9ae0', sat_relay: '#f2c94c', sat_haven: '#ffe6a8' }[type] } };
  return S[base] || null;
}
// A unit's figure as a sprite: px is the figure height in CSS pixels. Anchor (ax, ay) is the point between its feet.
function unitFigure(type, px, dpr, team) {
  px = Math.max(8, Math.round(px));
  return artCached(`u|${type}|${px}|${dpr}|${team || ''}`, () => {
    const sp = unitFigSpec(type); if (!sp) return null;
    const u = px * dpr * (sp.big || 1), w = u * 2.4, h = u * 1.8;
    const o = Object.assign({}, sp.o, { team: team || '#8ff5dc' });
    return artSprite(w, h, w / 2, h * 0.88, u, x => sp.f(x, o), Math.max(1, dpr * Math.min(1.6, px / 22)));
  });
}
function hasFigure(type) { return !!unitFigSpec(type); }

// ---- natural wonders: one set piece each, standing on its tile (base at y = 0, about 1.8 units wide) ----
const NATURAL_ART = {
  hollow_titan: x => {
    fell(x, 0, 0, 0.92, 0.2, '#a9907a'); fell(x, 0.1, -0.02, 0.6, 0.1, 'rgba(0,0,0,.18)');
    fcurve(x, [-0.8, -0.06], [-0.1, -0.2], [0.62, -0.12], 0.09, '#e8e0cc');
    for (let j = 0; j < 6; j++) { const bx = -0.6 + j * 0.22, h = 0.62 + Math.sin(j * 0.6 + 0.6) * 0.22; fcurve(x, [bx, -0.1], [bx - 0.12, -h - 0.15], [bx + 0.18, -h * 0.95], 0.075, j % 2 ? '#f4eedc' : '#d8ceb4'); fcurve(x, [bx + 0.18, -h * 0.95], [bx + 0.32, -h * 0.6], [bx + 0.3, -0.12], 0.05, '#cfc4aa'); }
    fell(x, 0.74, -0.26, 0.2, 0.16, '#efe7d2', -0.3); fell(x, 0.78, -0.28, 0.05, 0.04, '#2a2030'); fpoly(x, [[0.86, -0.18], [1.0, -0.06], [0.82, -0.12]], '#e8e0cc');
    for (const [gx, gy] of [[-0.3, -0.5], [0.1, -0.62], [0.4, -0.46]]) glowAt(x, gx, gy, 0.12, '#8ff5dc');
  },
  lumina_falls: x => {
    fpoly(x, [[-0.9, 0], [-0.8, -0.8], [-0.4, -1.0], [-0.1, -0.86], [0.1, -0.86], [0.4, -1.02], [0.8, -0.78], [0.9, 0]], lgrad(x, 0, -1, 0, 0, ['#7a6aa0', '#4a3d6a', '#2c2442']));
    fpoly(x, [[-0.16, -0.88], [0.16, -0.88], [0.26, -0.1], [-0.26, -0.1]], lgrad(x, 0, -0.9, 0, -0.1, ['#e8fffa', '#7ff5e0', '#2ab8b0']));
    for (let j = 0; j < 5; j++) fline(x, [[-0.14 + j * 0.07, -0.86], [-0.2 + j * 0.1, -0.12]], 0.02, 'rgba(255,255,255,.55)');
    fell(x, 0, -0.06, 0.6, 0.14, rgrad(x, 0, -0.06, 0.05, 0.6, ['#c8fff4', '#3ad0c0', 'rgba(40,160,170,.6)']));
    glowAt(x, 0, -0.2, 0.5, '#8ff5dc'); for (const [mx, my] of [[-0.4, -0.16], [0.36, -0.2], [0.0, -0.3]]) fcirc(x, mx, my, 0.12, 'rgba(230,255,250,.35)');
    for (const s of [-1, 1]) for (let j = 0; j < 3; j++) fell(x, s * (0.5 + j * 0.12), -0.9 + j * 0.24, 0.1, 0.05, '#5cc487', s * 0.4);
  },
  choir_spires: x => {
    fell(x, 0, 0, 0.9, 0.18, '#5a5a8a');
    const cols = [[-0.56, 0.6, '#8ff0ff'], [-0.3, 0.95, '#c58cff'], [-0.02, 1.25, '#8ff0ff'], [0.26, 0.85, '#c58cff'], [0.52, 0.55, '#8ff0ff'], [0.12, 0.5, '#ffd0f4']];
    for (const [cx, h, c] of cols) { fpoly(x, [[cx - 0.09, -0.04], [cx - 0.08, -h * 0.82], [cx, -h], [cx + 0.08, -h * 0.82], [cx + 0.09, -0.04]], lgrad(x, cx - 0.09, 0, cx + 0.09, 0, [lt(c, 0.5), c, dk(c, 0.45)])); fpoly(x, [[cx - 0.08, -h * 0.82], [cx, -h], [cx - 0.02, -h * 0.3]], 'rgba(255,255,255,.5)'); }
    for (let r = 0.3; r <= 0.75; r += 0.22) { x.beginPath(); x.arc(-0.02, -1.0, r, -2.6, -0.5); x.lineWidth = 0.025; x.strokeStyle = 'rgba(200,255,250,.55)'; x.stroke(); }
    glowAt(x, -0.02, -0.7, 0.4, '#b0f8ff');
  },
  abyssal_rift: x => {
    fell(x, 0, -0.04, 0.95, 0.32, '#a0674a');
    fpoly(x, [[-0.86, -0.08], [-0.4, -0.22], [0.0, -0.16], [0.44, -0.26], [0.86, -0.06], [0.4, 0.08], [-0.1, 0.02], [-0.5, 0.1]], '#1a0c16');
    fpoly(x, [[-0.7, -0.08], [-0.36, -0.16], [0.0, -0.1], [0.38, -0.18], [0.7, -0.07], [0.3, 0.02], [-0.1, -0.03], [-0.42, 0.04]], rgrad(x, 0, -0.08, 0.02, 0.7, ['#ff9a50', '#a02a30', '#1a0c16']));
    for (const [a, b] of [[[-0.6, -0.1], [-0.3, -0.3]], [[0.2, -0.16], [0.5, -0.4]], [[-0.1, -0.08], [0.0, -0.36]]]) fline(x, [a, b], 0.03, '#ffb070');
    for (let j = 0; j < 6; j++) { const rx = -0.7 + j * 0.28; fpoly(x, [[rx, -0.22], [rx + 0.08, -0.5 - (j % 2) * 0.16], [rx + 0.16, -0.22]], j % 2 ? '#7a4a3a' : '#5a3428'); }
    glowAt(x, 0, -0.1, 0.45, '#ff8a50');
  },
  mother_grove: x => {
    fell(x, 0, 0, 0.9, 0.2, '#3a2a5a');
    mushroom(x, -0.55, 0.02, 0.36, '#7a56e0', 'rgba(160,255,230,.9)'); mushroom(x, 0.6, 0.02, 0.32, '#d06ab0', 'rgba(255,220,140,.9)');
    fpoly(x, [[-0.12, 0], [-0.08, -0.7], [0.08, -0.7], [0.14, 0]], lgrad(x, -0.12, 0, 0.14, 0, ['#f0e4ff', '#9d8bb8']));
    x.beginPath(); x.ellipse(0, -0.78, 0.86, 0.34, 0, Math.PI, 0); x.quadraticCurveTo(0, -0.6, -0.86, -0.78); x.fillStyle = rgrad(x, -0.3, -1.0, 0.05, 0.9, ['#e8a8ff', '#b45ad8', '#4a1e70']); x.fill();
    for (let j = -4; j <= 4; j++) fcirc(x, j * 0.17, -0.95 + Math.abs(j) * 0.025, 0.04, j % 2 ? '#c8fff0' : '#ffe6a0');
    for (let j = -6; j <= 6; j++) fline(x, [[j * 0.12, -0.7], [j * 0.1, -0.62]], 0.02, 'rgba(160,255,230,.7)');
    glowAt(x, 0, -0.65, 0.5, '#8ff5dc');
  },
  glass_eye: x => {
    fell(x, 0, -0.06, 0.9, 0.34, '#b9a3c9'); fell(x, 0, -0.08, 0.72, 0.26, '#6a5a80');
    fell(x, 0, -0.1, 0.62, 0.22, rgrad(x, -0.2, -0.18, 0.02, 0.62, ['#ffffff', '#b8e8ff', '#4a6ad0', '#1a1a5a']));
    fell(x, 0, -0.1, 0.22, 0.09, '#0c0a2a'); fell(x, -0.04, -0.13, 0.06, 0.025, '#ffffff');
    for (const [sx, sy] of [[-0.4, -0.2], [0.3, -0.04], [0.5, -0.16]]) fcirc(x, sx, sy, 0.02, '#fff');
    x.beginPath(); x.ellipse(0, -0.1, 0.62, 0.22, 0, Math.PI * 1.1, Math.PI * 1.45); x.lineWidth = 0.04; x.strokeStyle = 'rgba(255,255,255,.8)'; x.stroke();
    glowAt(x, 0, -0.3, 0.4, '#b8e8ff');
  },
  frozen_leviathan: x => {
    fell(x, 0, 0, 0.92, 0.2, '#c8e0ec');
    fpoly(x, [[-0.86, 0], [-0.7, -0.5], [-0.3, -0.62], [0.2, -0.56], [0.7, -0.66], [0.88, 0]], lgrad(x, 0, -0.7, 0, 0, ['rgba(230,250,255,.95)', 'rgba(150,200,230,.85)', 'rgba(90,140,180,.9)']));
    fcurve(x, [-0.7, -0.2], [-0.2, -0.6], [0.3, -0.28], 0.11, 'rgba(60,40,90,.55)'); fcurve(x, [0.3, -0.28], [0.56, -0.12], [0.62, -0.42], 0.09, 'rgba(60,40,90,.55)');
    fell(x, 0.62, -0.46, 0.1, 0.07, 'rgba(60,40,90,.6)'); for (let j = 0; j < 6; j++) fline(x, [[-0.5 + j * 0.15, -0.36 + Math.sin(j) * 0.04], [-0.52 + j * 0.15, -0.5]], 0.025, 'rgba(60,40,90,.45)');
    for (const [sx, h] of [[-0.6, 0.3], [-0.2, 0.46], [0.42, 0.38], [0.74, 0.26]]) fpoly(x, [[sx - 0.07, -0.5], [sx, -0.5 - h], [sx + 0.07, -0.5]], 'rgba(235,250,255,.95)');
    fpoly(x, [[-0.5, -0.5], [-0.2, -0.6], [-0.4, -0.2]], 'rgba(255,255,255,.35)');
  },
  ember_vents: x => {
    fell(x, 0, 0, 0.9, 0.2, '#4a3a4a');
    for (const [cx, w, h] of [[-0.42, 0.36, 0.44], [0.36, 0.3, 0.36], [0.0, 0.22, 0.24]]) { fpoly(x, [[cx - w, 0], [cx - w * 0.25, -h], [cx + w * 0.25, -h], [cx + w, 0]], lgrad(x, cx - w, 0, cx + w, 0, ['#8a6a7a', '#5a4050', '#2c2030'])); fell(x, cx, -h, w * 0.25, 0.05, '#ff9a50'); glowAt(x, cx, -h, 0.18, '#ff8a40'); }
    for (const [cx, h] of [[-0.42, 0.44], [0.36, 0.36]]) for (let j = 0; j < 4; j++) fcirc(x, cx + Math.sin(j * 1.7) * 0.1, -h - 0.16 - j * 0.16, 0.1 + j * 0.04, `rgba(240,230,245,${0.55 - j * 0.11})`);
    for (const [a, b] of [[[-0.6, -0.04], [-0.42, -0.2]], [[0.2, -0.02], [0.36, -0.16]]]) fline(x, [a, b], 0.03, '#ffb070');
  },
  drowned_spire: x => {
    fell(x, 0, 0.02, 0.9, 0.16, 'rgba(160,240,240,.5)');
    x.save(); x.rotate(0.12);
    fpoly(x, [[-0.2, 0], [-0.14, -0.9], [0, -1.22], [0.14, -0.9], [0.2, 0]], lgrad(x, -0.2, 0, 0.2, 0, ['#9a90c8', '#5a5088', '#2c2650']));
    for (let j = 1; j < 6; j++) frect(x, -0.08, -j * 0.16, 0.16, 0.04, j % 2 ? '#8ff5dc' : '#ffd0f4', 0.02);
    fpoly(x, [[-0.34, -0.52], [-0.14, -0.6], [-0.14, -0.5]], '#5a5088'); fpoly(x, [[0.34, -0.7], [0.14, -0.78], [0.14, -0.68]], '#5a5088');
    glowAt(x, 0, -1.2, 0.2, '#8ff5dc'); x.restore();
    for (let j = 0; j < 3; j++) { x.beginPath(); x.ellipse(0, 0.02, 0.3 + j * 0.2, 0.06 + j * 0.03, 0, 0, Math.PI); x.lineWidth = 0.02; x.strokeStyle = 'rgba(220,255,250,.6)'; x.stroke(); }
  },
  kelp_cathedral: x => {
    fell(x, 0, 0.02, 0.9, 0.16, 'rgba(120,80,200,.45)');
    for (let j = 0; j < 7; j++) { const bx = -0.7 + j * 0.23, h = 0.8 + Math.sin(j * 1.3) * 0.25, s = j < 3 ? 1 : -1; fcurve(x, [bx, 0], [bx + s * 0.3, -h * 0.6], [bx + s * 0.06, -h], 0.07, j % 2 ? '#8a4ad0' : '#b06ae0'); for (let q = 1; q < 4; q++) fell(x, bx + s * 0.12 * q / 2, -h * q / 4, 0.08, 0.03, '#d8a0ff', s * 0.6); glowAt(x, bx + s * 0.06, -h, 0.07, '#ffd0f4'); }
    fcurve(x, [-0.5, -0.86], [0, -1.2], [0.5, -0.86], 0.05, 'rgba(216,160,255,.8)');
    for (const [bx, by] of [[-0.2, -0.3], [0.1, -0.5], [0.3, -0.24]]) fcirc(x, bx, by, 0.03, 'rgba(230,255,255,.8)');
  },
};
function naturalArt(key, px, dpr) {
  px = Math.max(10, Math.round(px));
  return artCached(`n|${key}|${px}|${dpr}`, () => {
    const fn = NATURAL_ART[key]; if (!fn) return null;
    const u = px * dpr / 2, w = u * 2.3, h = u * 1.75;
    return artSprite(w, h, w / 2, h * 0.86, u, fn, Math.max(1, dpr * 0.9), 'rgba(10,6,22,.85)');
  });
}

// ---- structures: buildings and wonders as small standing pieces (base at y = 0, about one unit tall) ----
// Each archetype takes a palette [main, dark, accent glow].
const STRUCT = {
  dome: (x, c) => { frect(x, -0.5, -0.12, 1.0, 0.12, c[1], 0.03); x.beginPath(); x.arc(0, -0.12, 0.42, Math.PI, 0); x.closePath(); x.fillStyle = rgrad(x, -0.15, -0.4, 0.02, 0.45, [lt(c[0], 0.6), c[0], dk(c[0], 0.3)]); x.fill(); x.beginPath(); x.arc(0, -0.12, 0.3, Math.PI * 1.15, Math.PI * 1.5); x.lineWidth = 0.04; x.strokeStyle = 'rgba(255,255,255,.7)'; x.stroke(); fline(x, [[0, -0.54], [0, -0.7]], 0.03, c[1]); glowAt(x, 0, -0.72, 0.08, c[2]); },
  spire: (x, c) => { fpoly(x, [[-0.26, 0], [-0.12, -0.78], [0, -1.05], [0.12, -0.78], [0.26, 0]], lgrad(x, -0.26, 0, 0.26, 0, [lt(c[0], 0.4), c[0], dk(c[0], 0.4)])); for (let j = 1; j < 5; j++) frect(x, -0.05, -j * 0.17, 0.1, 0.04, c[2], 0.02); glowAt(x, 0, -1.02, 0.14, c[2]); },
  tower: (x, c) => { frect(x, -0.22, -0.9, 0.44, 0.9, lgrad(x, -0.22, 0, 0.22, 0, [lt(c[0], 0.3), c[0], dk(c[0], 0.4)]), 0.04); for (let j = 0; j < 4; j++) for (let q = 0; q < 2; q++) frect(x, -0.14 + q * 0.16, -0.8 + j * 0.2, 0.1, 0.08, c[2], 0.02); frect(x, -0.28, -0.96, 0.56, 0.08, c[1], 0.02); },
  obelisk: (x, c) => { fpoly(x, [[-0.16, 0], [-0.1, -0.86], [0, -0.98], [0.1, -0.86], [0.16, 0]], lgrad(x, -0.16, 0, 0.16, 0, [lt(c[0], 0.35), c[0], dk(c[0], 0.4)])); fline(x, [[0, -0.2], [0, -0.8]], 0.03, c[2]); frect(x, -0.3, -0.08, 0.6, 0.08, c[1], 0.02); },
  ring: (x, c) => { frect(x, -0.3, -0.1, 0.6, 0.1, c[1], 0.03); fline(x, [[-0.05, -0.1], [-0.05, -0.4]], 0.06, c[1]); x.beginPath(); x.ellipse(0, -0.6, 0.36, 0.36, 0, 0, 6.283); x.lineWidth = 0.1; x.strokeStyle = c[0]; x.stroke(); x.lineWidth = 0.035; x.strokeStyle = c[2]; x.stroke(); glowAt(x, 0, -0.6, 0.22, c[2]); },
  dish: (x, c) => { frect(x, -0.3, -0.12, 0.6, 0.12, c[1], 0.03); fline(x, [[0, -0.12], [0, -0.42]], 0.06, c[1]); x.save(); x.translate(0, -0.52); x.rotate(-0.5); x.beginPath(); x.ellipse(0, 0, 0.4, 0.16, 0, 0, Math.PI); x.closePath(); x.fillStyle = lgrad(x, 0, 0, 0, 0.16, [lt(c[0], 0.5), c[0]]); x.fill(); fline(x, [[0, 0.04], [0, -0.26]], 0.025, c[1]); glowAt(x, 0, -0.28, 0.08, c[2]); x.restore(); },
  pyramid: (x, c) => { fpoly(x, [[-0.5, 0], [0, -0.8], [0.5, 0]], c[0]); fpoly(x, [[0, -0.8], [0.5, 0], [0.12, 0]], dk(c[0], 0.3)); for (let j = 1; j < 4; j++) fline(x, [[-0.5 + j * 0.125, -j * 0.2], [0.5 - j * 0.125, -j * 0.2]], 0.02, c[2]); glowAt(x, 0, -0.8, 0.14, c[2]); },
  tree: (x, c) => { fpoly(x, [[-0.08, 0], [-0.06, -0.5], [0.06, -0.5], [0.1, 0]], '#7a5a6a'); for (const [cx, cy, r] of [[-0.24, -0.56, 0.26], [0.22, -0.6, 0.26], [0, -0.82, 0.3]]) fcirc(x, cx, cy, r, rgrad(x, cx - r * 0.3, cy - r * 0.3, 0.02, r, [lt(c[0], 0.4), c[0], dk(c[0], 0.3)])); for (const [gx, gy] of [[-0.2, -0.6], [0.2, -0.7], [0, -0.9], [0.1, -0.5]]) fcirc(x, gx, gy, 0.04, c[2]); },
  crystal: (x, c) => { for (const [cx, h, w] of [[-0.24, 0.62, 0.12], [0.02, 0.95, 0.16], [0.26, 0.5, 0.11]]) crystal(x, cx, 0, h, w, c[0]); glowAt(x, 0.02, -0.6, 0.3, c[2]); },
  arch: (x, c) => { frect(x, -0.5, -0.7, 0.2, 0.7, c[0], 0.03); frect(x, 0.3, -0.7, 0.2, 0.7, dk(c[0], 0.2), 0.03); x.beginPath(); x.arc(0, -0.62, 0.4, Math.PI, 0); x.lineWidth = 0.16; x.strokeStyle = c[0]; x.stroke(); glowAt(x, 0, -0.32, 0.22, c[2]); },
  helix: (x, c) => { frect(x, -0.3, -0.08, 0.6, 0.08, c[1], 0.02); for (let j = 0; j < 9; j++) { const y = -0.12 - j * 0.1, s = Math.sin(j * 0.9) * 0.22; fcirc(x, s, y, 0.05, c[0]); fcirc(x, -s, y, 0.05, c[2]); fline(x, [[s, y], [-s, y]], 0.02, 'rgba(255,255,255,.5)'); } },
  foundry: (x, c) => { frect(x, -0.5, -0.4, 0.7, 0.4, lgrad(x, 0, -0.4, 0, 0, [lt(c[0], 0.2), c[0], dk(c[0], 0.3)]), 0.03); fpoly(x, [[-0.5, -0.4], [-0.3, -0.56], [-0.1, -0.4], [0.1, -0.56], [0.2, -0.4]], c[1]); frect(x, 0.24, -0.86, 0.16, 0.86, c[1], 0.03); glowAt(x, 0.32, -0.9, 0.16, c[2]); frect(x, -0.4, -0.24, 0.16, 0.1, c[2], 0.02); },
  arena: (x, c) => { fell(x, 0, -0.16, 0.5, 0.18, dk(c[0], 0.3)); x.beginPath(); x.ellipse(0, -0.24, 0.5, 0.2, 0, Math.PI, 0); x.lineTo(0.5, -0.12); x.ellipse(0, -0.12, 0.5, 0.2, 0, 0, Math.PI); x.closePath(); x.fillStyle = c[0]; x.fill(); for (let j = -3; j <= 3; j++) frect(x, j * 0.13 - 0.03, -0.3, 0.06, 0.12, c[2], 0.02); fell(x, 0, -0.26, 0.36, 0.1, dk(c[0], 0.4)); },
  vault: (x, c) => { frect(x, -0.42, -0.5, 0.84, 0.5, lgrad(x, 0, -0.5, 0, 0, [lt(c[0], 0.3), c[0], dk(c[0], 0.3)]), 0.06); fcirc(x, 0, -0.26, 0.15, c[1]); fcirc(x, 0, -0.26, 0.08, c[2]); for (let j = 0; j < 4; j++) fline(x, [[0, -0.26], [Math.cos(j * 1.57) * 0.15, -0.26 + Math.sin(j * 1.57) * 0.15]], 0.03, c[0]); },
  hall: (x, c) => { fpoly(x, [[-0.52, -0.5], [0, -0.78], [0.52, -0.5]], c[1]); frect(x, -0.48, -0.5, 0.96, 0.08, c[0], 0.02); for (let j = 0; j < 5; j++) frect(x, -0.42 + j * 0.2, -0.42, 0.08, 0.36, c[0], 0.02); frect(x, -0.54, -0.08, 1.08, 0.08, c[1], 0.02); glowAt(x, 0, -0.62, 0.08, c[2]); },
  harbor: (x, c) => { frect(x, -0.55, -0.1, 1.1, 0.1, c[1], 0.02); for (let j = 0; j < 4; j++) fline(x, [[-0.45 + j * 0.3, -0.1], [-0.45 + j * 0.3, 0.06]], 0.04, c[1]); fline(x, [[0.3, -0.1], [0.3, -0.7], [0.0, -0.6]], 0.05, c[0]); frect(x, -0.4, -0.34, 0.4, 0.24, c[0], 0.03); glowAt(x, 0.3, -0.72, 0.1, c[2]); },
  silo: (x, c) => { for (const [cx, h] of [[-0.24, 0.6], [0.16, 0.74]]) { frect(x, cx - 0.16, -h, 0.32, h, lgrad(x, cx - 0.16, 0, cx + 0.16, 0, [lt(c[0], 0.3), c[0], dk(c[0], 0.35)]), 0.04); x.beginPath(); x.arc(cx, -h, 0.16, Math.PI, 0); x.fillStyle = lt(c[0], 0.2); x.fill(); } frect(x, -0.42, -0.36, 0.84, 0.05, c[2], 0.02); },
  garden: (x, c) => { fell(x, 0, -0.06, 0.5, 0.12, dk(c[1], 0.1)); x.beginPath(); x.arc(0, -0.08, 0.42, Math.PI, 0); x.fillStyle = 'rgba(200,255,240,.25)'; x.fill(); for (const [cx, s] of [[-0.18, 0.2], [0.14, 0.26]]) mushroom(x, cx, -0.06, s, c[0], 'rgba(160,255,230,.9)'); x.beginPath(); x.arc(0, -0.08, 0.42, Math.PI * 1.15, Math.PI * 1.5); x.lineWidth = 0.03; x.strokeStyle = 'rgba(255,255,255,.7)'; x.stroke(); },
  stack: (x, c) => { frect(x, -0.4, -0.36, 0.56, 0.36, c[0], 0.03); frect(x, 0.18, -0.84, 0.18, 0.84, lgrad(x, 0.18, 0, 0.36, 0, [lt(c[1], 0.3), c[1]]), 0.04); glowAt(x, 0.27, -0.88, 0.2, c[2]); frect(x, -0.32, -0.26, 0.4, 0.06, c[2], 0.02); },
  wall: (x, c) => { frect(x, -0.55, -0.42, 1.1, 0.42, lgrad(x, 0, -0.42, 0, 0, [lt(c[0], 0.2), c[0], dk(c[0], 0.3)]), 0.03); for (let j = 0; j < 5; j++) frect(x, -0.55 + j * 0.24, -0.54, 0.14, 0.14, c[0], 0.02); frect(x, -0.55, -0.24, 1.1, 0.04, c[2], 0.01); },
  monolith: (x, c) => { frect(x, -0.2, -0.82, 0.4, 0.82, lgrad(x, -0.2, 0, 0.2, 0, [lt(c[0], 0.3), c[0], dk(c[0], 0.4)]), 0.08); fcirc(x, 0, -0.5, 0.1, c[2]); glowAt(x, 0, -0.5, 0.2, c[2]); },
  lens: (x, c) => { frect(x, -0.12, -0.42, 0.24, 0.42, c[1], 0.03); fell(x, 0, -0.64, 0.34, 0.24, rgrad(x, -0.1, -0.7, 0.02, 0.34, ['#ffffff', c[0], dk(c[0], 0.3)])); fell(x, 0, -0.64, 0.12, 0.08, c[2]); },
  skyhook: (x, c) => { frect(x, -0.3, -0.1, 0.6, 0.1, c[1], 0.02); fline(x, [[0, -0.1], [0, -1.15]], 0.04, c[0]); for (let j = 0; j < 3; j++) frect(x, -0.08, -0.3 - j * 0.3, 0.16, 0.08, c[2], 0.02); glowAt(x, 0, -1.15, 0.14, c[2]); },
  world: (x, c) => { frect(x, -0.36, -0.12, 0.72, 0.12, c[1], 0.03); fcirc(x, 0, -0.52, 0.38, rgrad(x, -0.12, -0.64, 0.03, 0.4, [lt(c[0], 0.5), c[0], dk(c[0], 0.4)])); fell(x, -0.1, -0.56, 0.14, 0.08, '#5cc487', 0.4); fell(x, 0.14, -0.42, 0.1, 0.06, '#5cc487'); x.beginPath(); x.ellipse(0, -0.52, 0.52, 0.12, -0.3, 0, 6.283); x.lineWidth = 0.03; x.strokeStyle = c[2]; x.stroke(); },
};
const STRUCT_OF = {
  palace: ['spire', '#c8cde0', '#5a5480', '#8ff5dc'], monument: ['obelisk', '#9a90c8', '#4a4470', '#ffd0f4'], granary: ['silo', '#7fd38a', '#2f6b46', '#eaffb0'], library: ['vault', '#7fb8ff', '#2a4a7a', '#c8f0ff'],
  market: ['dome', '#f2d264', '#7a5a14', '#fff0a0'], temple: ['spire', '#d8a0ff', '#5a2a7a', '#ffe6ff'], amphitheater: ['arena', '#c27ae0', '#45185a', '#ffd0f4'], arena: ['arena', '#ef6a6a', '#5a1717', '#ffd27a'],
  harbor: ['harbor', '#5ad0e0', '#1a4a5a', '#8ff5dc'], courthouse: ['hall', '#d6dae4', '#5a5480', '#f2c94c'], aqueduct: ['arch', '#8fb3c4', '#3a5a6a', '#8ff5dc'], workshop: ['foundry', '#d07a3a', '#5a2a10', '#ffb070'],
  university: ['dish', '#c9c0ee', '#4a4470', '#8ff5dc'], lighthouse: ['tower', '#e8e4ff', '#5a5480', '#ffe6a0'], bank: ['vault', '#f2d264', '#6a4a12', '#fff0a0'], printing: ['tower', '#8fb3c4', '#3a4a6a', '#c8f0ff'],
  observatory: ['dome', '#7a6aa0', '#2c2442', '#b8e8ff'], opera: ['hall', '#ffd0f4', '#7a2a6a', '#fff0fa'], museum: ['hall', '#e8d8c0', '#6a5a40', '#ffe6a0'], factory: ['stack', '#8a8aa8', '#3a3448', '#ff9a50'],
  laboratory: ['dome', '#7ff5a0', '#1f5a3c', '#e8fff0'], hospital: ['dome', '#ffe4ea', '#c45a6c', '#ff6f80'], power_plant: ['stack', '#a8a0c0', '#3a3448', '#fff0a0'], research_lab: ['crystal', '#7ff0ff', '#2a4a7a', '#c8f8ff'],
  broadcast_tower: ['skyhook', '#c9d3e6', '#4a4470', '#ff6f80'], stadium: ['arena', '#7fb8ff', '#1a3a5a', '#ffffff'], supermarket: ['silo', '#f0a050', '#6a3a10', '#ffe6a0'], stock_exchange: ['tower', '#f2d264', '#6a4a12', '#ffffff'],
  symbiont_garden: ['garden', '#b45ad8', '#2f6b46', '#a8ffd8'], gaia_node: ['tree', '#5cc487', '#1f5a3c', '#d8ff9a'], neural_hub: ['crystal', '#f2c94c', '#77560f', '#8ff8ff'], assembler_core: ['foundry', '#e8c45a', '#77560f', '#8ff8ff'],
  heritage_hall: ['hall', '#cf5363', '#5c1621', '#ffd27a'], arcology: ['tower', '#7fd8e8', '#2a4a6a', '#e8fbff'], walls: ['wall', '#7a7498', '#3a3458', '#8ff5dc'], barracks: ['hall', '#8a92a8', '#3a4058', '#ef6a6a'],
  castle: ['wall', '#9a90b8', '#3a3458', '#ffd27a'], armory: ['vault', '#8a8aa8', '#3a3448', '#ef6a6a'], bastion: ['wall', '#b8b0d8', '#3a3458', '#ff6f80'],
  first_light: ['spire', '#fff0c8', '#7a5a14', '#ffe6a0'], memory_vault: ['vault', '#9a90c8', '#2c2650', '#8ff5dc'], xeno_garden: ['garden', '#d06ab0', '#2f6b46', '#ffd0f4'], great_foundry: ['foundry', '#ff9a50', '#5a2a10', '#ffe6a0'],
  credit_nexus: ['crystal', '#f2d264', '#6a4a12', '#fff0a0'], war_college: ['hall', '#ef6a6a', '#5a1717', '#ffd27a'], spore_choir: ['tree', '#c27ae0', '#45185a', '#ffd0f4'], stellar_archive: ['dish', '#b8e8ff', '#2a4a7a', '#ffffff'],
  lodestar_array: ['dish', '#f2c94c', '#77560f', '#8ff8ff'], tidewall: ['wall', '#5ad0e0', '#1a4a5a', '#c8fff4'], grand_arena: ['arena', '#ffb44d', '#5f3b0a', '#ffffff'], the_weave: ['helix', '#ffd0f4', '#7a2a6a', '#8ff5dc'],
  machine_oracle: ['monolith', '#3a3458', '#1a1430', '#8ff8ff'], genetic_ark: ['helix', '#ff8fa0', '#5c1621', '#7ff5a0'], concord_hall: ['hall', '#e8e4ff', '#5a5480', '#8ff5dc'], iron_citadel: ['wall', '#cf5363', '#3a1218', '#ffd27a'],
  quantum_spire: ['spire', '#f2c94c', '#77560f', '#8ff8ff'], deep_eye: ['lens', '#7fb8ff', '#2a2650', '#ffffff'], abyssal_harbor: ['harbor', '#5a4ad0', '#1a1050', '#ffd0f4'], muse_dome: ['dome', '#ffd0f4', '#7a2a6a', '#fff0fa'],
  world_engine: ['foundry', '#a8a0c0', '#2c2442', '#ff6f80'], accord_tower: ['tower', '#e8fbff', '#3a6a7a', '#8ff5dc'], sentinel_grid: ['ring', '#ef6a6a', '#3a1218', '#ffd27a'], resonance_lens: ['lens', '#c58cff', '#3a2050', '#8ff0ff'],
  garden_years: ['tree', '#9bd45f', '#2c4f10', '#ffe6a0'], mind_garden: ['garden', '#7a56e0', '#1f5a3c', '#c8fff0'], ring_city: ['ring', '#c8cde0', '#4a4470', '#8ff5dc'], skyhook: ['skyhook', '#c8cde0', '#3a3448', '#8ff5dc'],
  heartbloom: ['tree', '#ff8fc8', '#1f5a3c', '#a8ffd8'], lattice_core: ['pyramid', '#e8c45a', '#77560f', '#8ff8ff'], genesis_engine: ['world', '#7fb8ff', '#5c1621', '#ffd27a'], listening_array: ['dish', '#c9c0ee', '#2c2442', '#ff9ae0'],
};
// A building or wonder as a standing piece; unknown keys fall back to a plain dome.
function structureArt(key, px, dpr) {
  px = Math.max(8, Math.round(px));
  return artCached(`s|${key}|${px}|${dpr}`, () => {
    const s = STRUCT_OF[key] || ['dome', '#9a90c8', '#4a4470', '#8ff5dc'], fn = STRUCT[s[0]];
    const great = HX.isWonder(key) || HX.isProject(key), u = px * dpr, w = u * 1.5, h = u * 1.5;
    return artSprite(w, h, w / 2, h * 0.86, u, x => {
      if (great) { fell(x, 0, 0.02, 0.6, 0.16, '#2c2442'); fell(x, 0, -0.02, 0.56, 0.13, lgrad(x, -0.5, 0, 0.5, 0, ['#fff0a0', '#c79a2a', '#7a5a14'])); fell(x, 0, -0.04, 0.46, 0.09, '#3d3560'); }
      fn(x, [s[1], s[2], s[3]]);
    }, Math.max(1, dpr * 0.8), 'rgba(10,6,22,.85)');
  });
}
// Mini art for panels: the piece on a small round plate, as a canvas element sized in CSS pixels.
function artThumb(make, css, bg, at) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), s = Math.round(css * dpr), c = artCanvas(s, s); c.style.width = c.style.height = css + 'px'; c.className = 'artthumb';
  const x = c.getContext('2d');
  x.fillStyle = rgrad(x, s * 0.5, s * 0.35, s * 0.05, s * 0.75, bg || ['#3d3560', '#1a1430']); x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 6.283); x.fill();
  x.fillStyle = 'rgba(0,0,0,.3)'; x.beginPath(); x.ellipse(s / 2, s * 0.8, s * 0.32, s * 0.08, 0, 0, 6.283); x.fill();
  const sp = make(dpr); if (sp) { x.save(); x.beginPath(); x.arc(s / 2, s / 2, s / 2, 0, 6.283); x.clip(); x.drawImage(sp, s / 2 - sp.ax, s * (at || 0.8) - sp.ay); x.restore(); }
  return c;
}
function buildingThumb(key, css) { return artThumb(dpr => structureArt(key, css * 0.66, dpr), css, HX.isWonder(key) || HX.isProject(key) ? ['#5a4a20', '#1e1608'] : null); }
function unitThumb(type, css, bg) { return artThumb(dpr => unitFigure(type, css * 0.66, dpr, '#8ff5dc'), css, bg ? bg : UNITS[type] && UNITS[type].fauna ? ['#5a2050', '#1e0818'] : UNITS[type] && UNITS[type].aff ? [hexA(AFFINITIES[AFFI[UNITS[type].aff]].color, 0.5), '#14102a'] : null); }
function naturalThumb(key, css) { return artThumb(dpr => naturalArt(key, css * 1.05, dpr), css, ['#1e4a50', '#0c1420']); }

// ---- colonies: habitats that grow from a landing pad to an arcology, in the style of the colony's philosophy ----
const COLONY_GLASS = { communion: ['#c8ffe0', '#3aa877', '#1f5a3c'], lattice: ['#fff3c4', '#d8a830', '#6a4a10'], lineage: ['#ffe4ea', '#c45a6c', '#5c1621'], none: ['#d8fbff', '#4aa7b8', '#1e4a5a'] };
function colonyHab(x, aff, bx, by, r, k) {
  const g = COLONY_GLASS[aff || 'none'];
  fell(x, bx + r * 0.25, by + r * 0.1, r * 1.1, r * 0.32, 'rgba(0,0,0,.3)');
  if (aff === 'communion') { // living pods: onion domes with vines and glowing pores
    x.beginPath(); x.moveTo(bx - r, by); x.bezierCurveTo(bx - r * 1.1, by - r * 1.1, bx - r * 0.1, by - r * 1.2, bx, by - r * 1.6); x.bezierCurveTo(bx + r * 0.1, by - r * 1.2, bx + r * 1.1, by - r * 1.1, bx + r, by); x.closePath();
    x.fillStyle = rgrad(x, bx - r * 0.35, by - r * 0.9, r * 0.1, r * 1.4, [g[0], g[1], g[2]]); x.fill();
    fcurve(x, [bx - r * 0.9, by - r * 0.1], [bx - r * 0.7, by - r * 1.0], [bx - r * 0.05, by - r * 1.4], r * 0.12, '#2f7a4e');
    for (const [dx, dy] of [[0.3, -0.5], [-0.2, -0.8], [0.5, -0.2]]) fcirc(x, bx + dx * r, by + dy * r, r * 0.09, '#d8ff9a');
  } else if (aff === 'lattice') { // faceted hex blocks with light seams
    const h = r * (1.0 + (k % 3) * 0.25);
    fpoly(x, [[bx - r, by], [bx - r, by - h], [bx - r * 0.5, by - h - r * 0.3], [bx + r * 0.5, by - h - r * 0.3], [bx + r, by - h], [bx + r, by]], lgrad(x, bx - r, 0, bx + r, 0, [g[0], g[1], g[2]]));
    fpoly(x, [[bx - r, by - h], [bx - r * 0.5, by - h - r * 0.3], [bx + r * 0.5, by - h - r * 0.3], [bx + r, by - h], [bx + r * 0.5, by - h + r * 0.3], [bx - r * 0.5, by - h + r * 0.3]], lt(g[0], 0.3));
    fline(x, [[bx - r * 0.5, by - h + r * 0.3], [bx - r * 0.5, by]], r * 0.06, '#8ff8ff'); fline(x, [[bx + r * 0.5, by - h + r * 0.3], [bx + r * 0.5, by]], r * 0.06, '#8ff8ff');
  } else if (aff === 'lineage') { // terraced homes with red gabled roofs
    const h = r * 0.8;
    frect(x, bx - r, by - h, r * 2, h, lgrad(x, bx - r, 0, bx + r, 0, ['#f4f0ea', '#d6d0c8', '#9a9088']), r * 0.08);
    fpoly(x, [[bx - r * 1.12, by - h], [bx - r * 0.2, by - h - r * 0.7], [bx + r * 0.6, by - h - r * 0.7], [bx + r * 1.12, by - h]], lgrad(x, 0, by - h - r * 0.7, 0, by - h, ['#ff8f9a', '#c45a6c', '#7a2a36']));
    for (let j = 0; j < 3; j++) frect(x, bx - r * 0.7 + j * r * 0.55, by - h * 0.7, r * 0.3, r * 0.3, '#ffe6a8', r * 0.05);
  } else { // glass domes on a ring
    frect(x, bx - r, by - r * 0.12, r * 2, r * 0.2, '#4a4470');
    x.beginPath(); x.arc(bx, by - r * 0.1, r, Math.PI, 0); x.closePath(); x.fillStyle = rgrad(x, bx - r * 0.35, by - r * 0.75, r * 0.1, r * 1.1, [g[0], g[1], g[2]]); x.fill();
    x.beginPath(); x.arc(bx, by - r * 0.1, r * 0.72, Math.PI * 1.15, Math.PI * 1.55); x.lineWidth = r * 0.1; x.strokeStyle = 'rgba(255,255,255,.55)'; x.stroke();
    fline(x, [[bx, by - r * 1.1], [bx, by - r * 0.1]], r * 0.05, 'rgba(0,0,0,.18)');
  }
}
function colonyTower(x, aff, bx, by, w, hh, k) {
  const g = COLONY_GLASS[aff || 'none'];
  fell(x, bx + w * 0.6, by + w * 0.15, w * 1.6, w * 0.4, 'rgba(0,0,0,.3)');
  if (aff === 'communion') { // stalk towers with caps, like the fungal forests
    fpoly(x, [[bx - w * 0.7, by], [bx - w * 0.45, by - hh], [bx + w * 0.45, by - hh], [bx + w * 0.7, by]], lgrad(x, bx - w, 0, bx + w, 0, ['#e8fff0', '#8fd8b0', '#3a7a5a']));
    x.beginPath(); x.ellipse(bx, by - hh, w * 2.0, w * 1.0, 0, Math.PI, 0); x.closePath(); x.fillStyle = rgrad(x, bx - w * 0.6, by - hh - w * 0.8, w * 0.1, w * 2.2, ['#d8ff9a', '#3aa877', '#1f5a3c']); x.fill();
    for (let j = -2; j <= 2; j++) fcirc(x, bx + j * w * 0.6, by - hh - w * 0.4 + Math.abs(j) * w * 0.15, w * 0.15, '#c8fff0');
    for (let j = 1; j < 4; j++) fcirc(x, bx, by - hh * j / 4, w * 0.16, '#d8ff9a');
  } else if (aff === 'lattice') {
    fpoly(x, [[bx - w, by], [bx - w * 0.5, by - hh], [bx, by - hh - w * 1.4], [bx + w * 0.5, by - hh], [bx + w, by]], lgrad(x, bx - w, 0, bx + w, 0, [g[0], g[1], g[2]]));
    fline(x, [[bx, by - hh - w * 1.4], [bx, by]], w * 0.18, '#8ff8ff'); fline(x, [[bx, by - hh - w * 1.4], [bx, by - hh - w * 2.4]], w * 0.12, '#fff3c4'); glowAt(x, bx, by - hh - w * 2.5, w * 0.8, '#8ff8ff');
  } else if (aff === 'lineage') {
    frect(x, bx - w, by - hh, w * 2, hh, lgrad(x, bx - w, 0, bx + w, 0, ['#f4f0ea', '#cfc8c0', '#8a8078']), w * 0.15);
    fpoly(x, [[bx - w * 1.2, by - hh], [bx, by - hh - w * 2.2], [bx + w * 1.2, by - hh]], lgrad(x, 0, by - hh - w * 2.2, 0, by - hh, ['#ff8f9a', '#c45a6c', '#7a2a36']));
    for (let j = 1; j < 4; j++) frect(x, bx - w * 0.35, by - hh + j * hh / 4.2 - w * 0.3, w * 0.7, w * 0.5, '#ffe6a8', w * 0.1);
    fline(x, [[bx, by - hh - w * 2.2], [bx, by - hh - w * 3.4]], w * 0.12, '#ddd'); fpoly(x, [[bx, by - hh - w * 3.4], [bx + w * 1.1, by - hh - w * 3.1], [bx, by - hh - w * 2.8]], '#ff6f80');
  } else {
    fpoly(x, [[bx - w, by], [bx - w * 0.75, by - hh], [bx + w * 0.75, by - hh], [bx + w, by]], lgrad(x, bx - w, 0, bx + w, 0, [lt(g[1], 0.35), g[1], dk(g[1], 0.35)]));
    for (let j = 1; j < 6; j++) frect(x, bx - w * 0.5, by - hh * j / 6, w, Math.max(0.5, w * 0.16), 'rgba(255,255,230,.75)');
    fell(x, bx, by - hh, w * 0.75, w * 0.25, lt(g[1], 0.4));
  }
}
function colonyArcology(x, aff, bx, by, s) {
  if (aff === 'communion') { // a living tree-city
    fell(x, bx, by, s * 0.7, s * 0.2, 'rgba(0,0,0,.3)');
    fpoly(x, [[bx - s * 0.32, by], [bx - s * 0.12, by - s * 0.9], [bx + s * 0.12, by - s * 0.9], [bx + s * 0.34, by]], lgrad(x, bx - s * 0.3, 0, bx + s * 0.3, 0, ['#c8b0a0', '#7a5a6a', '#3a2a3a']));
    for (const [cx, cy, r] of [[-0.42, -1.0, 0.36], [0.4, -1.04, 0.36], [0, -1.3, 0.44], [-0.1, -0.86, 0.3]]) fcirc(x, bx + cx * s, by + cy * s, r * s, rgrad(x, bx + (cx - r * 0.3) * s, by + (cy - r * 0.3) * s, s * 0.02, r * s, ['#d8ff9a', '#3aa877', '#1f5a3c']));
    for (let j = 0; j < 9; j++) fcirc(x, bx + Math.cos(j * 2.4) * s * 0.42, by - s * 1.1 + Math.sin(j * 2.4) * s * 0.3, s * 0.035, j % 2 ? '#fff0a0' : '#c8fff0');
  } else if (aff === 'lattice') { // a gold ziggurat under a floating ring
    for (let j = 0; j < 4; j++) { const w = s * (0.62 - j * 0.13), y0 = by - j * s * 0.24; fpoly(x, [[bx - w, y0], [bx - w * 0.9, y0 - s * 0.24], [bx + w * 0.9, y0 - s * 0.24], [bx + w, y0]], lgrad(x, bx - w, 0, bx + w, 0, ['#fff3c4', '#d8a830', '#6a4a10'])); fline(x, [[bx - w * 0.9, y0 - s * 0.12], [bx + w * 0.9, y0 - s * 0.12]], s * 0.025, '#8ff8ff'); }
    x.beginPath(); x.ellipse(bx, by - s * 1.3, s * 0.42, s * 0.12, 0, 0, 6.283); x.lineWidth = s * 0.06; x.strokeStyle = '#f2c94c'; x.stroke(); x.lineWidth = s * 0.02; x.strokeStyle = '#8ff8ff'; x.stroke();
    fline(x, [[bx, by - s * 0.96], [bx, by - s * 1.6]], s * 0.04, '#8ff8ff'); glowAt(x, bx, by - s * 1.3, s * 0.3, '#8ff8ff');
  } else if (aff === 'lineage') { // a stepped citadel with a tall keep
    for (let j = 0; j < 3; j++) { const w = s * (0.66 - j * 0.16), y0 = by - j * s * 0.26; frect(x, bx - w, y0 - s * 0.26, w * 2, s * 0.26, lgrad(x, bx - w, 0, bx + w, 0, ['#f4f0ea', '#cfc8c0', '#8a8078']), s * 0.03); fpoly(x, [[bx - w * 1.04, y0 - s * 0.26], [bx + w * 1.04, y0 - s * 0.26], [bx + w * 0.9, y0 - s * 0.32], [bx - w * 0.9, y0 - s * 0.32]], '#c45a6c'); for (let q = 0; q < 4; q++) frect(x, bx - w * 0.8 + q * w * 0.45, y0 - s * 0.2, s * 0.06, s * 0.08, '#ffe6a8'); }
    colonyTower(x, 'lineage', bx, by - s * 0.78, s * 0.12, s * 0.5, 0);
  } else { // a glass arcology spire with a ring of gardens
    fpoly(x, [[bx - s * 0.36, by], [bx - s * 0.14, by - s * 1.5], [bx + s * 0.14, by - s * 1.5], [bx + s * 0.36, by]], lgrad(x, bx - s * 0.36, 0, bx + s * 0.36, 0, ['#e8fbff', '#4aa7b8', '#1e4a5a']));
    for (let j = 1; j < 9; j++) frect(x, bx - s * 0.16, by - s * 1.5 * j / 9, s * 0.32, s * 0.025, 'rgba(255,255,230,.8)');
    fell(x, bx, by - s * 0.7, s * 0.5, s * 0.12, '#5cc487'); fell(x, bx, by - s * 0.74, s * 0.4, s * 0.07, '#9bd45f');
    fline(x, [[bx, by - s * 1.5], [bx, by - s * 1.85]], s * 0.03, '#d8fbff'); glowAt(x, bx, by - s * 1.86, s * 0.14, '#8ff5dc');
  }
}
// What a colony looks like: c is what the viewer knows ({ o, p, cap }), live the city itself when in view.
function colonySpec(G, c, live) {
  const owner = G.players[c.o], has = k => !!live && live.buildings.includes(k);
  return { aff: owner.minor || owner.barbarian ? null : primaryAff(owner), pop: c.p, walls: has('bastion') ? 3 : has('castle') ? 2 : has('walls') ? 1 : 0, cap: !!c.cap,
    sci: has('university') || has('observatory') || has('laboratory'), ind: has('factory') || has('power_plant'), harbor: has('harbor'), garden: has('gaia_node') || has('symbiont_garden'), arco: has('arcology'), color: CIVS[owner.civ].color, tilt: 1 };
}
function colonyThumb(G, c, live, css) { return artThumb(dpr => colonyArt(colonySpec(G, c, live), css * 0.36, dpr), css, [shade(CIVS[G.players[c.o].civ].color, 0.15), CIVS[G.players[c.o].civ].dark], 0.6); }
// spec: { aff, pop, walls, cap, sci, ind, harbor, garden, arco, color, tilt }. px is the pad radius in CSS pixels.
function colonyArt(sp, px, dpr) {
  px = Math.max(6, Math.round(px));
  const tier = sp.pop <= 3 ? 1 : sp.pop <= 7 ? 2 : sp.pop <= 12 ? 3 : 4, tl = sp.tilt || 1;
  const key = `c|${sp.aff}|${tier}|${Math.min(8, Math.floor(sp.pop / 2))}|${sp.walls}|${sp.cap ? 1 : 0}${sp.sci ? 1 : 0}${sp.ind ? 1 : 0}${sp.harbor ? 1 : 0}${sp.garden ? 1 : 0}${sp.arco ? 1 : 0}|${sp.color}|${px}|${dpr}|${tl}`;
  return artCached(key, () => {
    const u = px * dpr, w = u * 2.8, h = u * 3.2;
    return artSprite(w, h, w / 2, h * 0.7, u, x => {
      const hp = (r, col, dy) => { x.beginPath(); for (let k = 0; k < 6; k++) { const a = (60 * k - 30) * Math.PI / 180; x.lineTo(Math.cos(a) * r, (dy || 0) + Math.sin(a) * r * tl); } x.closePath(); x.fillStyle = col; x.fill(); };
      // landing pad and its light ring
      fell(x, 0.1, 0.62 * tl + 0.1, 1.05, 0.32, 'rgba(0,0,0,.3)');
      hp(1.0, sp.color, 0.12); hp(0.92, '#2b2440', 0.12); hp(0.76, '#3d3560', 0.12);
      x.beginPath(); for (let k = 0; k < 6; k++) { const a = (60 * k - 30) * Math.PI / 180; x.lineTo(Math.cos(a) * 0.58, 0.12 + Math.sin(a) * 0.58 * tl); } x.closePath(); x.lineWidth = 0.025; x.strokeStyle = 'rgba(140,255,230,.35)'; x.stroke();
      const items = [], add = (y, f) => items.push({ y, f });
      const n = Math.min(8, 1 + Math.floor(sp.pop / 2.2)), spots = [[-0.45, 0.14], [0.45, 0.14], [-0.22, 0.48], [0.24, 0.48], [-0.62, -0.18], [0.62, -0.18], [0, 0.64], [-0.06, -0.32]];
      const hr = 0.2 + (tier >= 3 ? 0.03 : 0);
      spots.slice(0, n).forEach((p, i) => add(p[1], () => colonyHab(x, sp.aff, p[0], p[1] * tl + 0.08, hr, i)));
      if (tier <= 2 || !sp.arco) add(0.02, () => colonyHab(x, sp.aff, 0, 0.06 * tl + 0.08, 0.3 + Math.min(0.1, sp.pop * 0.01), 9));
      const towers = tier >= 4 ? 2 : tier === 3 ? 2 : tier === 2 ? 1 : 0;
      for (let k = 0; k < towers; k++) add(-0.5 - k * 0.01, () => colonyTower(x, sp.aff, k ? 0.24 : -0.22, -0.18 * tl + 0.06, 0.1, 0.62 + k * 0.2, k));
      if (tier >= 4 || sp.arco) add(-0.2, () => colonyArcology(x, sp.aff, 0.0, 0.0 * tl + 0.06, 0.62));
      if (sp.cap) add(-0.9, () => { // the landed ark, standing upright with a beacon
        const px0 = 0.36, py0 = -0.34 * tl + 0.04, w0 = 0.13, hh = 0.85;
        fpoly(x, [[px0 - w0, py0], [px0 - w0, py0 - hh * 0.75], [px0, py0 - hh * 1.05], [px0 + w0, py0 - hh * 0.75], [px0 + w0, py0]], lgrad(x, px0 - w0, 0, px0 + w0, 0, ['#f0f2fa', '#c8cde0', '#7a7f98']));
        frect(x, px0 - w0, py0 - hh * 0.45, w0 * 2, hh * 0.08, sp.color);
        fpoly(x, [[px0 - w0 * 1.9, py0], [px0 - w0, py0 - hh * 0.25], [px0 - w0, py0]], '#5a5480'); fpoly(x, [[px0 + w0 * 1.9, py0], [px0 + w0, py0 - hh * 0.25], [px0 + w0, py0]], '#5a5480');
        glowAt(x, px0, py0 - hh * 1.05, 0.22, '#a0ffeb');
      });
      if (sp.sci) add(-0.3, () => { const ox = -0.56, oy = -0.4 * tl + 0.04; fline(x, [[ox, oy + 0.12], [ox, oy - 0.12]], 0.04, '#c9c0ee'); x.save(); x.translate(ox, oy - 0.15); x.rotate(-0.5); x.beginPath(); x.ellipse(0, 0, 0.2, 0.09, 0, 0, Math.PI); x.closePath(); x.fillStyle = '#e8e4ff'; x.fill(); x.restore(); });
      if (sp.ind) add(-0.55, () => { const fx = 0.64, fy = -0.32 * tl + 0.04, w0 = 0.08; frect(x, fx - w0, fy - 0.5, w0 * 2, 0.5, '#4a4470'); glowAt(x, fx, fy - 0.55, 0.2, '#ff9a50'); });
      if (sp.harbor) add(0.7, () => { const hx = -0.78, hy = 0.66 * tl + 0.04; frect(x, hx - 0.28, hy - 0.04, 0.42, 0.08, '#5a5480'); fcirc(x, hx + 0.12, hy - 0.1, 0.05, '#8ff5dc'); fline(x, [[hx - 0.2, hy], [hx - 0.2, hy - 0.3]], 0.03, '#c9d3e6'); });
      if (sp.garden) add(0.5, () => mushroom(x, 0.72, 0.46 * tl + 0.04, 0.32, '#b45ad8', 'rgba(160,255,230,.9)'));
      // walls: an energy fence with pylons that grow with each upgrade; the back half stands behind the buildings
      const pylon = k => { const a = Math.PI / 6 + k * Math.PI / 3, tx = Math.cos(a) * 0.98, ty = 0.12 + Math.sin(a) * 0.98 * tl, th = 0.14 + sp.walls * 0.08; frect(x, tx - 0.05, ty - th, 0.1, th, '#5a5480', 0.02); fcirc(x, tx, ty - th, 0.06, sp.color); };
      const fence = (from, to) => { x.beginPath(); for (let k = from; k <= to; k++) { const a = (60 * k - 30) * Math.PI / 180; x.lineTo(Math.cos(a) * 0.98, 0.12 + Math.sin(a) * 0.98 * tl); } x.lineWidth = 0.06; x.strokeStyle = 'rgba(120,255,230,.75)'; x.stroke(); };
      if (sp.walls) { fence(3, 6); for (const k of [3, 4, 5]) pylon(k); }
      items.sort((a, b) => a.y - b.y); for (const it of items) it.f();
      if (sp.walls) {
        fence(0, 3); for (const k of [0, 1, 2]) pylon(k);
        if (sp.walls >= 3) { x.beginPath(); x.ellipse(0, 0.12, 1.0, 1.05, 0, Math.PI, 0); x.fillStyle = 'rgba(140,255,240,.08)'; x.fill(); x.lineWidth = 0.02; x.strokeStyle = 'rgba(160,255,240,.4)'; x.stroke(); }
      }
    }, Math.max(1, dpr * 0.8), 'rgba(10,6,22,.8)');
  });
}

// ---- tile improvements (base at y = 0, about two units wide) ----
const IMPROV_ART = {
  farm: x => { // hydroponic rows under a greenhouse dome
    for (let j = 0; j < 4; j++) { const y = -0.05 - j * 0.14; fpoly(x, [[-0.95 + j * 0.12, y], [0.75 - j * 0.1, y - 0.04], [0.75 - j * 0.1, y - 0.1], [-0.95 + j * 0.12, y - 0.06]], j % 2 ? '#3f9c6a' : '#5cc487'); for (let q = 0; q < 6; q++) fcirc(x, -0.85 + j * 0.12 + q * 0.27, y - 0.08, 0.035, '#c8ffe0'); }
    x.beginPath(); x.arc(0.62, -0.05, 0.3, Math.PI, 0); x.closePath(); x.fillStyle = 'rgba(210,255,245,.55)'; x.fill(); x.lineWidth = 0.03; x.strokeStyle = '#e8fffa'; x.stroke();
    fline(x, [[0.62, -0.35], [0.62, -0.05]], 0.02, '#e8fffa'); fcirc(x, 0.55, -0.12, 0.06, '#7fd38a');
  },
  mine: x => { // a drill rig: lattice derrick, drill head and an ore pile
    fell(x, 0.5, -0.04, 0.34, 0.12, '#6a5a6a'); for (const [ox, oy, c] of [[0.38, -0.1, '#e08a5a'], [0.56, -0.12, '#ff9a6a'], [0.48, -0.18, '#c06a40']]) fcirc(x, ox, oy, 0.07, c);
    fpoly(x, [[-0.5, 0], [-0.32, -1.0], [-0.22, -1.0], [-0.04, 0]], 'rgba(0,0,0,0)');
    fline(x, [[-0.5, 0], [-0.27, -1.0], [-0.04, 0]], 0.06, '#c9c0ee'); for (let j = 1; j < 5; j++) { const y = -j * 0.2, hw = 0.23 - j * 0.045; fline(x, [[-0.27 - hw, y], [-0.27 + hw, y]], 0.035, '#9a90c8'); }
    fline(x, [[-0.27, -1.0], [-0.27, 0.06]], 0.05, '#4a4470'); fpoly(x, [[-0.34, 0.0], [-0.2, 0.0], [-0.27, 0.12]], '#f2c94c');
    frect(x, -0.42, -1.08, 0.3, 0.1, '#f0a050', 0.02); glowAt(x, -0.27, -1.1, 0.12, '#ffb070');
  },
  quarry: x => { for (const [dx, dy, w] of [[-0.75, -0.0, 0.5], [-0.15, -0.0, 0.55], [-0.5, -0.32, 0.55], [0.15, -0.3, 0.45], [-0.2, -0.6, 0.4]]) { frect(x, dx, dy - 0.28, w, 0.28, '#d7d0e8', 0.03); frect(x, dx + w * 0.62, dy - 0.28, w * 0.38, 0.28, 'rgba(0,0,0,.22)', 0.03); frect(x, dx, dy - 0.28, w, 0.06, '#f4f0ff', 0.02); } },
  camp: x => { fpoly(x, [[-0.7, 0], [-0.25, -0.75], [0.2, 0]], '#c9a36b'); fpoly(x, [[-0.25, -0.75], [0.2, 0], [-0.05, 0]], '#9a7a48'); fpoly(x, [[-0.38, 0], [-0.25, -0.3], [-0.12, 0]], '#4b3420'); for (const s of [-1, 1]) fline(x, [[-0.25 + s * 0.12, -0.9], [-0.25 - s * 0.1, -0.6]], 0.04, '#5a3d22'); fline(x, [[0.45, 0], [0.5, -0.5]], 0.04, '#7a5a3a'); fline(x, [[0.7, 0], [0.62, -0.46]], 0.04, '#7a5a3a'); fcurve(x, [0.5, -0.42], [0.58, -0.3], [0.64, -0.4], 0.025, '#c9c0ee'); fcirc(x, 0.15, -0.04, 0.06, '#ff9a50'); glowAt(x, 0.15, -0.06, 0.14, '#ffb070'); },
  pasture: x => { fline(x, [[-0.95, -0.1], [0.9, -0.24]], 0.05, '#8a6236'); fline(x, [[-0.95, -0.34], [0.9, -0.48]], 0.05, '#8a6236'); for (let k = -2; k <= 2; k++) fline(x, [[k * 0.45, -0.05 - k * 0.035], [k * 0.45, -0.56 - k * 0.035]], 0.06, '#6a4a2a'); x.save(); x.translate(0.05, -0.02); x.scale(0.55, 0.55); figBeast(x, { pal: { A: '#9ad8c0', D: '#3a7a6a', V: '#fff', M: '#e8fff8', G: '#c8fff0' }, kind: 'loper', team: '#7fd38a' }); x.restore(); },
  plantation: x => { for (let k = 0; k < 6; k++) { const bx = ((k % 3) - 1) * 0.55, by = -0.1 - Math.floor(k / 3) * 0.32; fline(x, [[bx, by], [bx, by - 0.2]], 0.04, '#5a3d6a'); fcirc(x, bx, by - 0.28, 0.2, rgrad(x, bx - 0.06, by - 0.34, 0.01, 0.2, ['#8ae08a', '#2f8a4c', '#1a4a2a'])); for (let q = 0; q < 3; q++) fcirc(x, bx + Math.cos(q * 2.1 + k) * 0.11, by - 0.28 + Math.sin(q * 2.1 + k) * 0.1, 0.035, '#ffd27a'); } },
  lumbermill: x => { for (let k = 0; k < 3; k++) { const ly = -0.1 - k * 0.16, lx = -0.15 + k * 0.08; frect(x, lx - 0.6, ly - 0.14, 0.9, 0.16, '#9d8bb8', 0.06); fell(x, lx + 0.3, ly - 0.06, 0.08, 0.08, '#c070e0'); fcirc(x, lx + 0.3, ly - 0.06, 0.03, '#e8d0ff'); } fcirc(x, 0.6, -0.45, 0.24, '#c9ccd2'); for (let j = 0; j < 10; j++) { const a = j * 0.628; fpoly(x, [[0.6 + Math.cos(a) * 0.22, -0.45 + Math.sin(a) * 0.22], [0.6 + Math.cos(a + 0.2) * 0.3, -0.45 + Math.sin(a + 0.2) * 0.3], [0.6 + Math.cos(a + 0.3) * 0.22, -0.45 + Math.sin(a + 0.3) * 0.22]], '#c9ccd2'); } fcirc(x, 0.6, -0.45, 0.07, '#555a62'); frect(x, 0.5, -0.24, 0.2, 0.24, '#5a5480'); },
  boats: x => { // a fishing boat and a ring of net floats
    x.beginPath(); x.ellipse(-0.35, -0.04, 0.5, 0.16, 0, 0, 6.283); x.lineWidth = 0.025; x.strokeStyle = 'rgba(230,240,250,.8)'; x.stroke();
    for (let j = 0; j < 8; j++) { const a = j * 0.785; fcirc(x, -0.35 + Math.cos(a) * 0.5, -0.04 + Math.sin(a) * 0.16, 0.05, j % 2 ? '#ff9a50' : '#ffe6a0'); }
    fpoly(x, [[0.0, -0.1], [0.8, -0.1], [0.66, 0.04], [0.1, 0.04]], '#6b4a6b'); fline(x, [[0.4, -0.1], [0.4, -0.66]], 0.035, '#3a2a38'); fpoly(x, [[0.43, -0.62], [0.78, -0.16], [0.43, -0.16]], '#efe4f4'); fline(x, [[0.4, -0.6], [0.0, -0.1]], 0.015, 'rgba(230,240,250,.7)');
  },
  biowell: x => { fell(x, 0, -0.1, 0.72, 0.3, rgrad(x, 0, -0.1, 0.02, 0.72, ['rgba(255,200,250,.95)', 'rgba(200,90,220,.6)', 'rgba(120,40,140,.3)'])); fell(x, 0, -0.1, 0.72, 0.3, 'rgba(0,0,0,0)'); for (const k of [-1, 0, 1]) fcurve(x, [k * 0.4, -0.1], [k * 0.7, -0.6], [k * 0.25, -0.9], 0.08, '#5fe0a0'); for (const k of [-1, 0, 1]) fcirc(x, k * 0.25, -0.92, 0.06, '#d8ff9a'); glowAt(x, 0, -0.2, 0.5, '#ff9ae0'); },
  nexus: x => { frect(x, -0.4, -0.12, 0.8, 0.12, '#2c2442', 0.03); fpoly(x, [[-0.12, -0.12], [-0.08, -0.85], [0.08, -0.85], [0.12, -0.12]], lgrad(x, -0.12, 0, 0.12, 0, ['#8a84b0', '#4a4470'])); x.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; x.lineTo(Math.cos(a) * 0.3, -1.0 + Math.sin(a) * 0.3); } x.closePath(); x.fillStyle = '#f2c94c'; x.fill(); fcirc(x, 0, -1.0, 0.12, '#1b1830'); glowAt(x, 0, -1.0, 0.2, '#8ff8ff'); },
  terrace: x => { for (let k = 0; k < 3; k++) { frect(x, -0.9 + k * 0.2, -0.24 - k * 0.24, 1.8 - k * 0.4, 0.24, k % 2 ? '#6fbf5a' : '#8bd46c', 0.03); frect(x, -0.9 + k * 0.2, -0.04 - k * 0.24, 1.8 - k * 0.4, 0.04, '#5a4a3a'); } frect(x, 0.2, -0.95, 0.32, 0.26, '#ffe4ea', 0.02); fpoly(x, [[0.15, -0.95], [0.36, -1.15], [0.57, -0.95]], '#ff6f80'); },
  fort: x => { frect(x, -0.7, -0.38, 1.4, 0.38, lgrad(x, 0, -0.38, 0, 0, ['#9a90b8', '#5a5480', '#3a3458']), 0.04); for (let k = 0; k < 5; k++) frect(x, -0.7 + k * 0.3, -0.5, 0.16, 0.14, '#7a7498', 0.02); frect(x, -0.12, -0.24, 0.24, 0.24, '#1a1430', 0.04); fline(x, [[0.5, -0.5], [0.5, -0.95]], 0.03, '#ddd'); fpoly(x, [[0.5, -0.95], [0.8, -0.86], [0.5, -0.76]], '#ff6f80'); },
};
function improvArt(key, px, dpr) {
  px = Math.max(8, Math.round(px));
  return artCached(`i|${key}|${px}|${dpr}`, () => {
    const fn = IMPROV_ART[key]; if (!fn) return null;
    const u = px * dpr / 2, w = u * 2.2, h = u * 1.6;
    return artSprite(w, h, w / 2, h * 0.82, u, fn, Math.max(1, dpr * 0.7), 'rgba(10,6,22,.75)');
  });
}
// Sprite sizes are quantized to 12% steps so pinch-zooming reuses sprites instead of painting new ones every frame.
function artQ(px) { const k = Math.round(Math.log(Math.max(4, px)) / 0.1133); return Math.round(Math.exp(k * 0.1133)); }
// A terrain tile as it looks on the map (flat view, with its forest, ridges or peaks), for the codex.
function terrainThumb(t, css) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), s = Math.round(css * dpr), c = artCanvas(s, s); c.style.width = c.style.height = css + 'px'; c.className = 'artthumb';
  const x = c.getContext('2d'), keep = TILT; TILT = 1; x.translate(s / 2, s / 2); drawTerrainSprite(x, t, 1, s * 0.5, false); TILT = keep;
  return c;
}
function improvThumb(key, css) { return artThumb(dpr => improvArt(key, css * 1.05, dpr), css, ['#2f4a3a', '#101a14'], 0.78); }
