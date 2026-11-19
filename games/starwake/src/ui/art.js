// ===== art.js : procedural art (stars, planets, portraits, event scenes) =====
const Art = (() => {
  const mk = (w, hh) => { const c = document.createElement('canvas'); c.width = w; c.height = hh || w; return c; };
  const hash = (x, y, s) => { let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; n = (n ^ (n >>> 13)) * 1274126177 | 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  function vnoise(x, y, s) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const fbm = (x, y, s, o) => { let t = 0, amp = 0.5, f = 1; for (let i = 0; i < (o || 4); i++) { t += amp * vnoise(x * f, y * f, s + i * 17); amp *= 0.5; f *= 2; } return t; };
  const hex = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hslRgb = (hh, l) => { const a = 0.75 * Math.min(l, 1 - l), f = n => { const q = (n + hh / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1))); }; return [f(0), f(8), f(4)]; };
  const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // ---- stars ----
  // a tight bright core, a soft halo and, for hot stars, thin diffraction spikes; 'big' is the system-view version
  const starCache = {};
  function star(type, big) {
    const key = type + (big ? ':b' : '');
    if (starCache[key]) return starCache[key];
    const T = STAR_TYPES[type], S = big ? 256 : 96, c = mk(S), g = c.getContext('2d'), m = S / 2;
    if (type === 'hole') {
      const gr = g.createRadialGradient(m, m, 0, m, m, m);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.27, 'rgba(0,0,0,1)'); gr.addColorStop(0.31, 'rgba(255,236,200,1)'); gr.addColorStop(0.36, 'rgba(255,170,110,.8)'); gr.addColorStop(0.5, 'rgba(190,120,255,.35)'); gr.addColorStop(1, 'rgba(120,60,200,0)');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      g.save(); g.translate(m, m); g.scale(1, 0.28); g.strokeStyle = 'rgba(255,214,170,.75)'; g.lineWidth = S * 0.03; g.beginPath(); g.arc(0, 0, S * 0.36, 0, 7); g.stroke(); g.restore();
      g.fillStyle = '#000'; g.beginPath(); g.arc(m, m, S * 0.13, 0, 7); g.fill();
      return (starCache[key] = c);
    }
    const [r, gg, b] = hex(T.glow);
    const halo = g.createRadialGradient(m, m, 0, m, m, m);
    halo.addColorStop(0, `rgba(${r},${gg},${b},.55)`); halo.addColorStop(0.18, `rgba(${r},${gg},${b},.28)`); halo.addColorStop(0.45, `rgba(${r},${gg},${b},.07)`); halo.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = halo; g.fillRect(0, 0, S, S);
    const spikes = type === 'white' || type === 'blue' || type === 'neutron' || type === 'yellow';
    if (spikes) {
      g.globalCompositeOperation = 'lighter';
      const len = type === 'blue' ? 0.98 : type === 'yellow' ? 0.62 : 0.85;
      for (const [ax, ay, w] of [[1, 0, 1], [0, 1, 1], [0.707, 0.707, 0.45], [0.707, -0.707, 0.45]]) {
        if (w < 1 && type !== 'blue' && type !== 'white') continue;
        const L = m * len * w, lg = g.createLinearGradient(m - ax * L, m - ay * L, m + ax * L, m + ay * L);
        lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(${Math.min(255, r + 60)},${Math.min(255, gg + 60)},255,${0.55 * w})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.strokeStyle = lg; g.lineWidth = Math.max(1, S * 0.012); g.beginPath(); g.moveTo(m - ax * L, m - ay * L); g.lineTo(m + ax * L, m + ay * L); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    }
    const core = g.createRadialGradient(m, m, 0, m, m, m * 0.34);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.32, '#ffffff'); core.addColorStop(0.5, T.color); core.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = core; g.beginPath(); g.arc(m, m, m * 0.34, 0, 7); g.fill();
    if (big) { // granulated photosphere
      g.save(); g.beginPath(); g.arc(m, m, m * 0.17, 0, 7); g.clip(); g.globalCompositeOperation = 'multiply';
      for (let i = 0; i < 160; i++) { const a = hash(i, 1, 5) * 6.283, d = Math.sqrt(hash(i, 2, 5)) * m * 0.17; g.fillStyle = `rgba(${r},${gg},${b},${0.08 + hash(i, 3, 5) * 0.12})`; g.beginPath(); g.arc(m + Math.cos(a) * d, m + Math.sin(a) * d, S * 0.012, 0, 7); g.fill(); }
      g.restore();
    }
    if (type === 'neutron') { g.strokeStyle = 'rgba(160,240,255,.55)'; g.lineWidth = Math.max(1.5, S * 0.016); g.beginPath(); g.moveTo(m, 2); g.lineTo(m, S - 2); g.stroke(); }
    return (starCache[key] = c);
  }
  // ---- planets ----
  const planetCache = new Map();
  function planet(p, S) {
    const key = p.id + ':' + p.type + ':' + S;
    if (planetCache.has(key)) return planetCache.get(key);
    const T = PLANET_TYPES[p.type], c = mk(S), g = c.getContext('2d');
    if (T.tex === 'belt') { planetCache.set(key, c); return c; }
    const img = g.createImageData(S, S), d = img.data, R = S / 2 - 1, cols = T.cols.map(hex), s = p.seed % 100000;
    const tex = T.tex, clouds = T.hab && p.type !== 'dune' && p.type !== 'mesa' && p.type !== 'relic' || p.type === 'toxic';
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x - S / 2 + 0.5) / R, dy = (y - S / 2 + 0.5) / R, rr = dx * dx + dy * dy; if (rr > 1) continue;
      const z = Math.sqrt(1 - rr), u = dx / (z + 0.6) * 2.2, v = dy / (z + 0.6) * 2.2;
      let col, n;
      if (tex === 'gas') { n = fbm(u * 0.6, v * 4 + fbm(u, v, s) * 1.5, s, 3); col = n < 0.45 ? mixC(cols[0], cols[1], n / 0.45) : mixC(cols[1], cols[2], (n - 0.45) / 0.55); }
      else if (tex === 'bands') { n = fbm(u * 1.5, v * 2.5, s, 4); col = mixC(cols[0], cols[2], clamp(n * 1.4 - 0.2, 0, 1)); }
      else if (tex === 'ocean') { n = fbm(u * 1.4, v * 1.4, s, 5); col = n > 0.58 ? mixC(cols[1], [90, 150, 70], (n - 0.58) * 3) : mixC(cols[0], cols[1], n / 0.58); if (Math.abs(dy) > 0.82) col = cols[2]; }
      else if (tex === 'ice') { n = fbm(u * 2, v * 2, s, 4); col = mixC(cols[0], cols[2], clamp(n * 1.5 - 0.1, 0, 1)); }
      else if (tex === 'lava') { n = fbm(u * 2.2, v * 2.2, s, 4); col = n > 0.55 ? mixC(cols[1], cols[2], (n - 0.55) * 3) : mixC([20, 8, 6], cols[0], n / 0.55); }
      else if (tex === 'crater') { n = fbm(u * 2.5, v * 2.5, s, 4); const cr = vnoise(u * 5, v * 5, s + 3); col = mixC(cols[0], cols[2], clamp(n * 1.3 - 0.15 + (cr > 0.8 ? -0.25 : 0), 0, 1)); }
      else if (tex === 'city') { n = fbm(u * 2, v * 2, s, 4); col = mixC(cols[0], cols[1], n); if (hash(Math.floor(u * 14), Math.floor(v * 14), s) > 0.82 && z < 0.95) col = mixC(col, [255, 220, 150], 0.6); }
      else if (tex === 'beacon') { n = fbm(u * 3, v * 3, s, 3); col = mixC(cols[0], cols[1], n); if (Math.abs(((u * 4) % 1)) < 0.08 || Math.abs(((v * 4) % 1)) < 0.08) col = cols[2]; }
      else { n = fbm(u * 1.6, v * 1.6, s, 5); col = n < 0.48 ? mixC([25, 60, 120], [40, 100, 160], n / 0.48) : mixC(cols[0], cols[1], (n - 0.48) * 2.5); if (n > 0.72) col = mixC(col, cols[2], (n - 0.72) * 3); if (Math.abs(dy) > 0.86) col = [235, 242, 250]; }
      // weather: drifting clouds on living worlds, a storm on some giants
      if (clouds) { const cn = fbm(u * 1.9 + 11, v * 3.2, s + 99, 4); if (cn > 0.56) col = mixC(col, [240, 246, 255], Math.min(0.85, (cn - 0.56) * 2.6)); }
      if (tex === 'gas' && s % 2 === 0) { const sx = u - 0.55, sy = (v - 0.35) * 1.8, sd = sx * sx + sy * sy; if (sd < 0.09) col = mixC(col, [250, 236, 214], (0.09 - sd) / 0.09 * 0.55); }
      // lighting from the upper left
      const light = clamp(0.25 + 0.95 * (-dx * 0.55 - dy * 0.35 + z * 0.75), 0.08, 1.15);
      const i = (y * S + x) * 4; d[i] = clamp(col[0] * light, 0, 255); d[i + 1] = clamp(col[1] * light, 0, 255); d[i + 2] = clamp(col[2] * light, 0, 255); d[i + 3] = rr > 0.96 ? 255 * (1 - rr) / 0.04 : 255;
    }
    g.putImageData(img, 0, 0);
    if (T.hab || tex === 'gas') { const at = g.createRadialGradient(S / 2, S / 2, R * 0.8, S / 2, S / 2, R * 1.02); const ac = tex === 'gas' ? '255,220,180' : '140,200,255'; at.addColorStop(0, `rgba(${ac},0)`); at.addColorStop(1, `rgba(${ac},.55)`); g.fillStyle = at; g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.fill(); }
    if (T.hab && p.type === 'tidal' || p.type === 'glacier') { const sp = g.createRadialGradient(S * 0.36, S * 0.33, 0, S * 0.36, S * 0.33, R * 0.45); sp.addColorStop(0, 'rgba(255,255,255,.28)'); sp.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sp; g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.fill(); }
    { // soft terminator: the far side falls into night
      const sh = g.createRadialGradient(S * 0.3, S * 0.28, R * 0.6, S * 0.42, S * 0.4, R * 1.55); sh.addColorStop(0, 'rgba(0,0,8,0)'); sh.addColorStop(1, 'rgba(0,0,8,.55)'); g.fillStyle = sh; g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.fill(); }
    if (p.type === 'hollowed') { g.strokeStyle = 'rgba(190,120,255,.7)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(S / 2, S / 2, R * (0.3 + k * 0.18), k, k + 2); g.stroke(); } }
    planetCache.set(key, c); return c;
  }
  // ---- species portraits ----
  function portrait(gen, S, color, bodyType) {
    const c = mk(S), g = c.getContext('2d'); g.scale(S / 100, S / 100);
    const [hue, sat, head, eyes, crest, mouth, pattern, bgHue, accent] = gen;
    const satv = [45, 65, 30][sat] || 50;
    const skin = `hsl(${hue},${satv}%,46%)`, dark = `hsl(${hue},${satv}%,26%)`, light = `hsl(${hue},${satv}%,66%)`, acc = `hsl(${(hue + 150 + accent * 40) % 360},70%,60%)`;
    const bg = g.createRadialGradient(50, 40, 5, 50, 50, 75); bg.addColorStop(0, `hsl(${bgHue},45%,26%)`); bg.addColorStop(1, `hsl(${bgHue},55%,7%)`); g.fillStyle = bg; g.fillRect(0, 0, 100, 100);
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + hash(i, 1, hue) * 0.5})`; g.fillRect(hash(i, 2, bgHue) * 100, hash(i, 3, bgHue) * 60, 1, 1); }
    if (color) { g.strokeStyle = color; g.lineWidth = 3; g.globalAlpha = 0.7; g.strokeRect(1.5, 1.5, 97, 97); g.globalAlpha = 1; }
    // shoulders with a robe in the empire color
    g.fillStyle = color || '#445'; g.beginPath(); g.moveTo(8, 100); g.quadraticCurveTo(14, 70, 50, 68); g.quadraticCurveTo(86, 70, 92, 100); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.moveTo(40, 100); g.lineTo(50, 74); g.lineTo(60, 100); g.fill();
    g.fillStyle = dark; g.fillRect(43, 56, 14, 16);
    // crest behind the head
    g.fillStyle = acc; g.strokeStyle = acc; g.lineWidth = 3; g.lineCap = 'round';
    if (crest === 1) { g.beginPath(); g.moveTo(34, 30); g.quadraticCurveTo(22, 14, 26, 4); g.quadraticCurveTo(32, 18, 40, 24); g.fill(); g.beginPath(); g.moveTo(66, 30); g.quadraticCurveTo(78, 14, 74, 4); g.quadraticCurveTo(68, 18, 60, 24); g.fill(); }
    else if (crest === 2) { g.beginPath(); g.moveTo(42, 24); g.quadraticCurveTo(34, 8, 26, 6); g.moveTo(58, 24); g.quadraticCurveTo(66, 8, 74, 6); g.stroke(); g.beginPath(); g.arc(26, 6, 3.5, 0, 7); g.arc(74, 6, 3.5, 0, 7); g.fill(); }
    else if (crest === 3) { g.beginPath(); for (let k = 0; k < 7; k++) { const a = Math.PI * (0.1 + k * 0.133); g.lineTo(50 - Math.cos(a) * 38, 40 - Math.sin(a) * 34); g.lineTo(50 - Math.cos(a + 0.066) * 26, 40 - Math.sin(a + 0.066) * 24); } g.closePath(); g.globalAlpha = 0.85; g.fill(); g.globalAlpha = 1; }
    else if (crest === 4) { g.beginPath(); g.ellipse(50, 22, 34, 16, 0, Math.PI, 0); g.fill(); g.fillStyle = light; for (let k = 0; k < 6; k++) { g.beginPath(); g.arc(28 + k * 9, 16 + (k % 2) * 4, 2.5, 0, 7); g.fill(); } }
    else if (crest === 5) { g.beginPath(); g.moveTo(26, 40); g.lineTo(10, 30); g.lineTo(24, 52); g.fill(); g.beginPath(); g.moveTo(74, 40); g.lineTo(90, 30); g.lineTo(76, 52); g.fill(); }
    // head
    const hg = g.createRadialGradient(42, 30, 4, 50, 40, 32); hg.addColorStop(0, light); hg.addColorStop(0.6, skin); hg.addColorStop(1, dark);
    g.fillStyle = hg; g.beginPath();
    if (head === 0) g.ellipse(50, 40, 22, 24, 0, 0, 7);
    else if (head === 1) g.ellipse(50, 38, 18, 28, 0, 0, 7);
    else if (head === 2) g.ellipse(50, 42, 27, 21, 0, 0, 7);
    else if (head === 3) { g.moveTo(50, 12); g.quadraticCurveTo(76, 22, 70, 46); g.quadraticCurveTo(62, 64, 50, 64); g.quadraticCurveTo(38, 64, 30, 46); g.quadraticCurveTo(24, 22, 50, 12); }
    else if (head === 4) { g.ellipse(50, 34, 26, 26, 0, 0, 7); g.ellipse(50, 56, 12, 10, 0, 0, 7); }
    else { g.moveTo(50, 14); g.lineTo(72, 30); g.lineTo(66, 56); g.lineTo(50, 64); g.lineTo(34, 56); g.lineTo(28, 30); g.closePath(); }
    g.fill();
    // pattern
    g.save(); g.clip();
    g.fillStyle = dark; g.strokeStyle = dark; g.globalAlpha = 0.5;
    if (pattern === 1) for (let k = 0; k < 12; k++) { g.beginPath(); g.arc(30 + hash(k, 5, hue) * 40, 18 + hash(k, 6, hue) * 30, 1.5 + hash(k, 7, hue) * 2.5, 0, 7); g.fill(); }
    else if (pattern === 2) { g.lineWidth = 3; for (let k = 0; k < 5; k++) { g.beginPath(); g.moveTo(26, 18 + k * 9); g.quadraticCurveTo(50, 12 + k * 9, 74, 18 + k * 9); g.stroke(); } }
    else if (pattern === 3) { g.fillStyle = acc; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(50, 16); g.lineTo(55, 30); g.lineTo(50, 34); g.lineTo(45, 30); g.fill(); }
    else if (pattern === 4) { g.strokeStyle = acc; g.globalAlpha = 0.8; g.lineWidth = 1.2; g.shadowColor = acc; g.shadowBlur = 4; g.beginPath(); g.moveTo(34, 26); g.lineTo(42, 40); g.lineTo(36, 52); g.moveTo(66, 26); g.lineTo(58, 40); g.lineTo(64, 52); g.stroke(); }
    g.restore(); g.globalAlpha = 1; g.shadowBlur = 0;
    // eyes
    const eye = (x, y, rx, ry, slit) => { g.fillStyle = '#0a0a12'; g.beginPath(); g.ellipse(x, y, rx + 1, ry + 1, 0, 0, 7); g.fill(); const eg = g.createRadialGradient(x - rx * 0.3, y - ry * 0.3, 0.5, x, y, rx); eg.addColorStop(0, '#fff'); eg.addColorStop(0.35, acc); eg.addColorStop(1, '#111'); g.fillStyle = eg; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); g.fillStyle = '#000'; g.beginPath(); if (slit) g.ellipse(x, y, rx * 0.18, ry * 0.85, 0, 0, 7); else g.arc(x, y, Math.min(rx, ry) * 0.38, 0, 7); g.fill(); };
    if (eyes === 0) { eye(41, 38, 6, 5.5); eye(59, 38, 6, 5.5); }
    else if (eyes === 1) { eye(40, 39, 7, 3, true); eye(60, 39, 7, 3, true); }
    else if (eyes === 2) { eye(41, 34, 4.5, 4); eye(59, 34, 4.5, 4); eye(43, 45, 3, 2.5); eye(57, 45, 3, 2.5); }
    else if (eyes === 3) eye(50, 38, 10, 8, true);
    else { eye(40, 40, 4.5, 4.5); eye(60, 40, 4.5, 4.5); eye(50, 29, 3.5, 3.5); }
    // mouth
    g.strokeStyle = '#140a10'; g.fillStyle = dark; g.lineWidth = 2;
    if (mouth === 0) { g.beginPath(); g.moveTo(43, 54); g.quadraticCurveTo(50, 57, 57, 54); g.stroke(); }
    else if (mouth === 1) { g.fillStyle = `hsl(${(hue + 40) % 360},60%,55%)`; g.beginPath(); g.moveTo(44, 48); g.lineTo(56, 48); g.lineTo(50, 62); g.closePath(); g.fill(); }
    else if (mouth === 2) { g.strokeStyle = light; g.lineWidth = 2.5; g.beginPath(); g.moveTo(44, 52); g.quadraticCurveTo(40, 60, 46, 64); g.moveTo(56, 52); g.quadraticCurveTo(60, 60, 54, 64); g.stroke(); }
    else if (mouth === 3) { g.strokeStyle = skin; g.lineWidth = 3; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(50 + k * 4, 54); g.quadraticCurveTo(50 + k * 6, 64, 50 + k * 5 + (k % 2) * 3, 72); g.stroke(); } }
    else { g.beginPath(); g.moveTo(45, 55); g.lineTo(55, 55); g.stroke(); }
    return c;
  }
  // ---- event scenes ----
  const ART_TINT = { ship: 220, crystal: 280, void: 260, vault: 200, alien: 170, planet: 210, storm: 20, library: 190, map: 45, egg: 120, fleet: 0, beacon: 190, riot: 10, harvest: 90, science: 200, refugee: 30, envoy: 300, prim: 140, hollow: 280, contact: 180, war: 355 };
  function scene(kind, W, H, seed) {
    const c = mk(W, H), g = c.getContext('2d'), hue = ART_TINT[kind] ?? 220, s = seed || 7;
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, `hsl(${hue},45%,10%)`); bg.addColorStop(1, `hsl(${(hue + 40) % 360},40%,4%)`); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) { const x = hash(i, 9, s) * W, y = hash(i, 10, s) * H, r = 40 + hash(i, 11, s) * 120; const n = g.createRadialGradient(x, y, 0, x, y, r); n.addColorStop(0, `hsla(${(hue + i * 25) % 360},70%,50%,.18)`); n.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = n; g.fillRect(0, 0, W, H); }
    { // fractal nebula wisps, painted small and scaled up
      const NW = 96, NH = Math.round(96 * H / W), nc = mk(NW, NH), ng = nc.getContext('2d'), img = ng.createImageData(NW, NH), d = img.data, c1 = hslRgb(hue, 0.6), c2 = hslRgb((hue + 50) % 360, 0.55);
      for (let j = 0; j < NH; j++) for (let i = 0; i < NW; i++) { const n = fbm(i / 14, j / 14, s + 5, 5), m = fbm(i / 24 + 3, j / 24, s + 9, 3), a = Math.max(0, n - 0.45) * 2.4, o = (j * NW + i) * 4, col = mixC(c1, c2, m);
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.min(255, a * 170); }
      ng.putImageData(img, 0, 0); g.imageSmoothingEnabled = true; g.globalCompositeOperation = 'lighter'; g.drawImage(nc, 0, 0, W, H); g.globalCompositeOperation = 'source-over'; }
    for (let i = 0; i < 140; i++) { const a = hash(i, 12, s); g.fillStyle = `rgba(255,255,255,${a * 0.8})`; const z = a > 0.95 ? 2 : 1; g.fillRect(hash(i, 13, s) * W, hash(i, 14, s) * H, z, z); }
    const cx = W / 2, cy = H / 2, acc = `hsl(${hue},80%,65%)`;
    g.save();
    const glow = (x, y, r, col) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    if (kind === 'planet' || kind === 'prim' || kind === 'harvest' || kind === 'refugee') {
      const gp = g.createRadialGradient(cx - 60, cy + 60, 10, cx, cy + 130, 190); gp.addColorStop(0, `hsl(${hue},50%,55%)`); gp.addColorStop(0.7, `hsl(${hue},55%,22%)`); gp.addColorStop(1, '#000'); g.fillStyle = gp; g.beginPath(); g.arc(cx, cy + 150, 170, 0, 7); g.fill();
      glow(cx, cy + 150, 200, `hsla(${hue},80%,70%,.15)`);
      if (kind === 'prim') for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(255,210,120,.9)'; g.fillRect(cx - 90 + hash(k, 3, s) * 180, cy + 10 + hash(k, 4, s) * 30, 2, 2); }
      if (kind === 'refugee') for (let k = 0; k < 12; k++) { g.fillStyle = '#cfd6ff'; const x = 30 + hash(k, 1, s) * (W - 60), y = 20 + hash(k, 2, s) * 60; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 8, y + 3); g.lineTo(x - 8, y - 3); g.fill(); }
    } else if (kind === 'crystal') {
      for (let k = 0; k < 9; k++) { const x = 30 + k * (W - 60) / 8, hh = 40 + hash(k, 2, s) * 80; g.fillStyle = `hsla(${hue + k * 8},80%,${55 + k * 3}%,.85)`; g.beginPath(); g.moveTo(x - 9, H); g.lineTo(x, H - hh); g.lineTo(x + 9, H); g.fill(); glow(x, H - hh, 18, `hsla(${hue},90%,80%,.5)`); }
    } else if (kind === 'void' || kind === 'hollow') {
      g.translate(cx, cy); for (let k = 0; k < 60; k++) { g.rotate(0.21); g.strokeStyle = `hsla(${hue + k},80%,${40 + k % 30}%,${0.05 + k / 200})`; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 8 + k * 1.6, 0, 1.2); g.stroke(); }
      g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, kind === 'hollow' ? 22 : 12, 0, 7); g.fill();
      if (kind === 'hollow') for (let k = 0; k < 3; k++) { g.fillStyle = '#0b0612'; g.strokeStyle = '#a56cff'; g.lineWidth = 1; g.beginPath(); const x = -120 + k * 120, y = 30 - (k % 2) * 40; g.moveTo(x, y + 50); g.lineTo(x + 8, y - 40); g.lineTo(x + 16, y + 50); g.fill(); g.stroke(); }
    } else if (kind === 'vault') {
      g.strokeStyle = acc; g.lineWidth = 3; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx, cy, 20 + k * 15, k, k + Math.PI * 1.6); g.stroke(); }
      glow(cx, cy, 30, 'rgba(255,255,255,.4)');
    } else if (kind === 'ship' || kind === 'fleet' || kind === 'war') {
      const n = kind === 'ship' ? 1 : 6;
      for (let k = 0; k < n; k++) {
        const x = n === 1 ? cx : 40 + hash(k, 1, s) * (W - 80), y = n === 1 ? cy : 30 + hash(k, 2, s) * (H - 60), sc = n === 1 ? 1.6 : 0.6 + hash(k, 3, s) * 0.4;
        g.save(); g.translate(x, y); g.scale(sc, sc); g.rotate(kind === 'war' ? -0.2 : 0.15);
        glow(-64, 0, 26, `hsla(${hue},90%,70%,.55)`); glow(-60, -7, 10, 'rgba(255,255,255,.7)'); glow(-60, 7, 10, 'rgba(255,255,255,.7)');
        const hg = g.createLinearGradient(0, -16, 0, 16); hg.addColorStop(0, '#5a6488'); hg.addColorStop(0.45, '#2a3150'); hg.addColorStop(1, '#0d1020');
        g.fillStyle = hg; g.strokeStyle = acc; g.lineWidth = 1;
        g.beginPath(); g.moveTo(66, 0); g.lineTo(18, -12); g.lineTo(-8, -18); g.lineTo(-30, -12); g.lineTo(-56, -11); g.lineTo(-62, 0); g.lineTo(-56, 11); g.lineTo(-30, 12); g.lineTo(-8, 18); g.lineTo(18, 12); g.closePath(); g.fill(); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(66, 0); g.lineTo(18, -12); g.lineTo(-8, -18); g.stroke();
        g.fillStyle = 'rgba(10,12,24,.8)'; g.fillRect(-40, -4, 50, 8);
        g.fillStyle = acc; for (let j = 0; j < 6; j++) { g.globalAlpha = 0.6 + hash(j, k, s) * 0.4; g.fillRect(-38 + j * 8, -1.5, 4, 3); } g.globalAlpha = 1;
        if (kind === 'war') { g.strokeStyle = 'rgba(255,90,110,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(60, 0); g.lineTo(200, -30 + k * 10); g.stroke(); }
        g.restore();
      }
      if (kind === 'fleet') for (let k = 0; k < 20; k++) { g.fillStyle = 'rgba(180,190,220,.6)'; g.fillRect(hash(k, 7, s) * W, hash(k, 8, s) * H, 3, 2); }
    } else if (kind === 'storm') {
      glow(cx - 80, cy, 120, 'rgba(255,170,80,.6)');
      g.strokeStyle = 'rgba(255,220,160,.8)'; g.lineWidth = 1.5;
      for (let k = 0; k < 7; k++) { g.beginPath(); let x = cx - 70, y = cy - 30 + k * 10; g.moveTo(x, y); for (let j = 0; j < 8; j++) { x += 25; y += (hash(k, j, s) - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
    } else if (kind === 'library' || kind === 'science') {
      g.translate(cx, cy); g.strokeStyle = acc; g.lineWidth = 1.5;
      for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); g.strokeRect(-12, -55, 24, 40); }
      glow(0, 0, 26, 'rgba(160,230,255,.7)');
    } else if (kind === 'map' || kind === 'beacon') {
      const pts = []; for (let k = 0; k < 14; k++) pts.push([30 + hash(k, 1, s) * (W - 60), 20 + hash(k, 2, s) * (H - 40)]);
      g.strokeStyle = `hsla(${hue},80%,70%,.5)`; g.lineWidth = 1; g.beginPath(); for (let k = 1; k < pts.length; k++) { g.moveTo(...pts[k - 1]); g.lineTo(...pts[k]); } g.stroke();
      for (const [x, y] of pts) glow(x, y, 6, 'rgba(255,255,255,.9)');
      if (kind === 'beacon') { g.fillStyle = '#d8f7ff'; g.beginPath(); g.moveTo(cx, cy - 50); g.lineTo(cx + 12, cy); g.lineTo(cx, cy + 50); g.lineTo(cx - 12, cy); g.fill(); glow(cx, cy, 70, 'rgba(110,214,255,.45)'); }
    } else if (kind === 'egg') {
      const gg = g.createRadialGradient(cx - 15, cy - 20, 5, cx, cy, 60); gg.addColorStop(0, '#e9f5c8'); gg.addColorStop(1, '#2d4a22'); g.fillStyle = gg; g.beginPath(); g.ellipse(cx, cy, 40, 55, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(30,50,20,.8)'; g.beginPath(); g.moveTo(cx - 10, cy - 30); g.lineTo(cx + 5, cy - 10); g.lineTo(cx - 5, cy + 10); g.stroke(); glow(cx, cy, 80, 'rgba(160,255,140,.15)');
    } else if (kind === 'alien' || kind === 'contact' || kind === 'envoy') {
      g.fillStyle = `hsl(${hue},30%,30%)`; g.beginPath(); g.ellipse(cx, cy + 10, 26, 34, 0, 0, 7); g.fill(); g.beginPath(); g.arc(cx, cy - 34, 18, 0, 7); g.fill();
      glow(cx - 7, cy - 36, 6, acc); glow(cx + 7, cy - 36, 6, acc);
      if (kind === 'contact') { glow(cx, cy, 120, `hsla(${hue},80%,60%,.15)`); g.strokeStyle = acc; for (let k = 1; k < 4; k++) { g.beginPath(); g.arc(cx, cy, 50 + k * 18, -0.6, 0.6); g.stroke(); g.beginPath(); g.arc(cx, cy, 50 + k * 18, Math.PI - 0.6, Math.PI + 0.6); g.stroke(); } }
    } else if (kind === 'riot') {
      glow(cx, H, 220, 'rgba(255,110,60,.45)');
      for (let layer = 0; layer < 2; layer++) for (let k = 0; k < 16; k++) { const wdt = 14 + hash(k, 5 + layer, s) * 18, x = k * W / 15 - 10 + layer * 18, hh = (layer ? 40 : 70) + hash(k, 1 + layer, s) * (layer ? 50 : 90);
        g.fillStyle = layer ? '#07080f' : '#111426'; g.fillRect(x, H - hh, wdt, hh);
        for (let wy = H - hh + 6; wy < H - 6; wy += 7) for (let wx = x + 3; wx < x + wdt - 3; wx += 5) if (hash(wx | 0, wy | 0, s + layer) > 0.62) { g.fillStyle = `rgba(255,${190 + hash(wx | 0, 3, s) * 50 | 0},120,${layer ? 0.75 : 0.45})`; g.fillRect(wx, wy, 2, 2.5); } }
      for (let k = 0; k < 5; k++) { const x = 60 + k * (W - 120) / 4; g.strokeStyle = 'rgba(30,30,40,.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, H - 8); g.lineTo(x, H - 70); g.stroke(); g.fillStyle = `hsla(${(hue + k * 40) % 360},75%,55%,.9)`; g.beginPath(); g.moveTo(x, H - 70); g.lineTo(x + 26, H - 62); g.lineTo(x, H - 52); g.fill(); }
    }
    g.restore();
    const vg = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.7); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    return c;
  }
  return { star, planet, portrait, scene, fbm, hash, mk };
})();
