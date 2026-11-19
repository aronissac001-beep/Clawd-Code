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
  // Every body type has its own surface recipe, sampled on a true sphere (longitude/latitude) so features
  // bend toward the limb. Light comes from the upper left; lava, fissures, beacon lattices and the city
  // lights of colonized worlds glow on the night side.
  const planetCache = new Map();
  const OCEAN_D = [16, 46, 104], OCEAN_S = [42, 112, 172];
  function craterList(s, n, rmax) { const out = []; for (let i = 0; i < n; i++) out.push([hash(i, 1, s) * 6.283 - 3.14, (hash(i, 2, s) - 0.5) * 2.6, 0.05 + hash(i, 3, s) * rmax]); return out; }
  function craterAt(cr, lon, lat) { let best = 0; for (const [cx, cy, r] of cr) { let dl = lon - cx; if (dl > 3.14) dl -= 6.283; if (dl < -3.14) dl += 6.283; const d = Math.sqrt(dl * dl * Math.cos(lat) * Math.cos(lat) + (lat - cy) * (lat - cy)) / r; if (d < 1.25) { const v = d < 0.82 ? -0.3 * (1 - d * d * 0.6) : d < 1 ? 0.35 : 0.12 * (1.25 - d) / 0.25; if (Math.abs(v) > Math.abs(best)) best = v; } } return best; }
  function surface(type, u, v, lat, lon, s, cols, cr) {
    const f = (a, b, o, k) => fbm(a, b, s + (k || 0), o), ridge = (a, b, o, k) => 1 - Math.abs(2 * f(a, b, o, k) - 1);
    const polar = Math.abs(lat), ice = (lim, soft) => clamp((polar - lim + (f(u * 3, v * 3, 3, 7) - 0.5) * 0.3) / (soft || 0.1), 0, 1);
    let col, land = false, glow = 0, gcol = null;
    const sea = n => mixC(OCEAN_D, OCEAN_S, clamp(n, 0, 1));
    switch (type) {
      case 'tidal': { const n = f(u * 1.3, v * 1.3, 5); if (n > 0.62) { land = true; col = mixC([196, 184, 130], cols[1].map(x => x * 0.6), clamp((n - 0.62) * 8, 0, 1)); } else col = sea(n > 0.56 ? 0.9 + (n - 0.56) : n * 1.2); col = mixC(col, [236, 244, 252], ice(1.32)); break; }
      case 'jungle': { const n = f(u * 1.2, v * 1.2, 5); if (n > 0.4) { land = true; col = mixC([18, 64, 28], [58, 132, 52], f(u * 4, v * 4, 3, 2)); if (Math.abs(f(u * 3 + 9, v * 3, 4, 4) - 0.5) < 0.016) col = [30, 70, 90]; } else col = sea(n * 1.6); break; }
      case 'fen': { land = true; col = mixC(cols[0], cols[1], f(u * 2.5, v * 2.5, 4)); const l = f(u * 5, v * 5, 3, 3); if (l > 0.6) { land = false; col = mixC([44, 66, 62], [70, 92, 80], (l - 0.6) * 3); } col = mixC(col, [180, 192, 170], clamp(f(u * 1.5 + 3, v * 4, 3, 9) - 0.55, 0, 0.4)); break; }
      case 'dune': { land = true; const w = Math.sin(u * 10 + f(u * 2, v * 2, 3) * 7 + v * 2); col = mixC(cols[0], cols[2], clamp(0.45 + w * 0.22 + (f(u * 3, v * 3, 3, 5) - 0.5) * 0.6, 0, 1)); if (f(u * 2.5, v * 2.5, 4, 8) > 0.7) col = mixC(col, [110, 70, 40], 0.5); break; }
      case 'mesa': { land = true; const t = Math.floor(f(u * 1.8, v * 1.8, 4) * 6) / 6; col = mixC(cols[0], cols[2], t); const r = ridge(u * 2.4, v * 2.4, 4, 3); if (r > 0.9) col = mixC(col, [60, 24, 14], (r - 0.9) * 8); if (f(u * 4, v * 4, 3, 6) > 0.72) col = [222, 206, 180]; break; }
      case 'steppe': { const n = f(u * 1.1, v * 1.1, 4, 2); if (n > 0.66) col = sea(1 - (n - 0.66) * 3); else { land = true; col = mixC(cols[0], cols[2], clamp(f(u * 1.2, v * 4, 4) * 1.3 - 0.15, 0, 1)); } col = mixC(col, [236, 244, 252], ice(1.3)); break; }
      case 'taiga': { const n = f(u * 1.3, v * 1.3, 5); if (n > 0.42) { land = true; col = mixC([24, 58, 46], [70, 110, 82], f(u * 5, v * 5, 3, 3)); if (f(u * 6, v * 6, 2, 5) > 0.68) col = [52, 86, 120]; } else col = sea(n); col = mixC(col, [232, 240, 246], ice(0.85, 0.25)); break; }
      case 'glacier': { col = mixC([170, 200, 228], [246, 250, 255], f(u * 2, v * 2, 4)); const r = ridge(u * 3, v * 3, 4, 2); if (r > 0.93) col = mixC(col, [60, 110, 160], (r - 0.93) * 12); if (polar < 0.25 && f(u * 3, v * 3, 3, 9) > 0.62) col = sea(0.7); land = true; break; }
      case 'highland': { const el = f(u * 1.8, v * 1.8, 5), r = ridge(u * 3, v * 3, 4, 2); land = true; col = el < 0.44 ? mixC([56, 96, 60], [92, 122, 80], el / 0.44) : mixC([96, 94, 112], [150, 148, 166], clamp((el - 0.44) * 4, 0, 1)); col = mixC(col, [40, 40, 52], clamp((r - 0.8) * 2, 0, 0.35)); if (el > 0.62) col = mixC(col, [238, 240, 248], clamp((el - 0.62) * 8, 0, 1)); if (f(u * 1.2, v * 1.2, 4, 4) > 0.7) { land = false; col = sea(0.5); } break; }
      case 'garden': { const n = f(u * 1.25, v * 1.25, 5); if (n > 0.5) { land = true; const dry = f(u * 3, v * 3, 3, 4), band = polar; col = band > 0.9 ? [214, 222, 206] : dry > 0.66 && band < 0.5 ? [190, 166, 104] : mixC([34, 112, 52], [104, 160, 72], clamp(band * 0.9 + (dry - 0.5), 0, 1)); } else col = sea(n * 1.5); col = mixC(col, [240, 246, 252], ice(1.25)); break; }
      case 'barren': case 'frozen': { const n = f(u * 2.5, v * 2.5, 4); col = mixC(cols[0], cols[2], clamp(n * 1.3 - 0.15, 0, 1)); const c = craterAt(cr, lon, lat); col = c < 0 ? mixC(col, [20, 22, 28], -c) : mixC(col, [255, 255, 255], c * 0.5); if (type === 'frozen' && f(u * 4, v * 4, 3, 5) > 0.6) col = mixC(col, [232, 242, 252], 0.5); land = true; break; }
      case 'molten': { col = mixC([26, 10, 8], [70, 34, 22], f(u * 2.4, v * 2.4, 4)); const r = ridge(u * 2.6, v * 2.6, 4, 3); const lk = f(u * 1.6, v * 1.6, 4, 6); if (r > 0.86 || lk > 0.68) { glow = Math.min(1, Math.max((r - 0.86) * 7, (lk - 0.68) * 6)); gcol = mixC([255, 90, 20], [255, 220, 110], glow); } land = true; break; }
      case 'toxic': { const n = f(u * 1.2 + f(u * 2, v * 2, 3, 2) * 2.2, v * 3.4, 4); col = mixC(cols[0], cols[2], clamp(n * 1.5 - 0.25, 0, 1)); if (f(u * 5, v * 5, 2, 8) > 0.74) col = mixC(col, [240, 250, 160], 0.4); break; }
      case 'gas': case 'icegas': { const warp = f(u * 1.4, v * 1.4, 3, 4) * (type === 'gas' ? 1.6 : 0.8); const n = f(lat * 7 + warp, u * 0.35, 3); col = n < 0.45 ? mixC(cols[0], cols[1], n / 0.45) : mixC(cols[1], cols[2], (n - 0.45) / 0.55); col = mixC(col, cols[2], clamp(Math.sin(lat * 18 + warp * 3) * 0.12, 0, 0.12));
        if (type === 'gas' && s % 2 === 0) { const sx = (lon - 0.6) * 1.1, sy = (lat - 0.32) * 3, sd = sx * sx + sy * sy; if (sd < 0.09) col = mixC(col, [214, 120, 80], (0.09 - sd) / 0.09 * 0.6); } break; }
      case 'hollowed': { col = mixC([16, 10, 24], [44, 30, 60], f(u * 2.5, v * 2.5, 4)); const r = ridge(u * 2.8, v * 2.8, 4, 5); if (r > 0.9) { glow = (r - 0.9) * 10; gcol = [190, 120, 255]; } const c = craterAt(cr, lon, lat); if (c < -0.2) col = [4, 2, 8]; else if (c > 0.2) { glow = Math.max(glow, 0.6); gcol = [170, 110, 255]; } land = true; break; }
      case 'relic': { land = true; const bx = Math.floor(u * 9), by = Math.floor(v * 9), fx = u * 9 - bx, fy = v * 9 - by; col = mixC(cols[0], cols[2], hash(bx, by, s) * 0.6 + f(u * 2, v * 2, 3) * 0.4); if (fx < 0.08 || fy < 0.08) col = mixC(col, [30, 26, 22], 0.6); if (hash(bx, by, s + 3) > 0.75) col = mixC(col, [210, 196, 150], 0.35); break; }
      case 'beacon': { const cx = Math.floor(u * 4 + f(u, v, 2) * 1.5), cy = Math.floor(v * 4 + f(v, u, 2) * 1.5); col = mixC(cols[0], cols[1], hash(cx, cy, s) * 0.8); const fx = (u * 4 + f(u, v, 2) * 1.5) % 1, fy = (v * 4 + f(v, u, 2) * 1.5) % 1; if (Math.min(Math.abs(fx), Math.abs(fy), 1 - Math.abs(fx), 1 - Math.abs(fy)) < 0.06) { glow = 0.9; gcol = cols[2]; } land = true; break; }
      default: { const n = f(u * 1.6, v * 1.6, 5); col = n < 0.48 ? sea(n) : mixC(cols[0], cols[1], (n - 0.48) * 2.5); land = n >= 0.48; }
    }
    return { col, land, glow, gcol };
  }
  function planet(p, S) {
    const T = PLANET_TYPES[p.type], lit = !!(p.col && T.hab) || p.type === 'relic';
    const key = p.id + ':' + p.type + ':' + S + (lit ? ':c' : '');
    if (planetCache.has(key)) return planetCache.get(key);
    const c = mk(S), g = c.getContext('2d');
    if (T.tex === 'belt') { planetCache.set(key, c); return c; }
    const img = g.createImageData(S, S), d = img.data, R = S / 2 - 1, cols = T.cols.map(hex), s = p.seed % 100000;
    const cr = /barren|frozen|hollowed/.test(p.type) ? craterList(s, p.type === 'hollowed' ? 7 : 16, p.type === 'hollowed' ? 0.22 : 0.3) : null;
    const clouds = T.hab && !/dune|mesa|relic/.test(p.type) ? (p.type === 'jungle' || p.type === 'fen' ? 0.5 : p.type === 'glacier' ? 0.62 : 0.56) : 0;
    const Lx = -0.58, Ly = -0.46, Lz = 0.67, rot = hash(s, 3, 1) * 6.283;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x - S / 2 + 0.5) / R, dy = (y - S / 2 + 0.5) / R, rr = dx * dx + dy * dy; if (rr > 1) continue;
      const z = Math.sqrt(1 - rr), lat = Math.asin(clamp(-dy, -1, 1)), lon = Math.atan2(dx, z) + rot;
      const u = lon * 1.15 + 10, v = lat * 1.6 + 10;
      const sf = surface(p.type, u, v, lat, Math.atan2(dx, z), s, cols, cr);
      let col = sf.col;
      if (clouds) { const cn = fbm(u * 1.7 + 11, v * 2.8, s + 99, 5); if (cn > clouds) col = mixC(col, [242, 247, 255], Math.min(0.88, (cn - clouds) * 2.8)); }
      const lam = dx * Lx + dy * Ly + z * Lz, light = clamp(0.04 + 1.08 * Math.max(0, lam) + 0.1 * z, 0, 1.12);
      let r = col[0] * light, gg = col[1] * light, b = col[2] * light;
      const night = clamp(1 - light * 2.6, 0, 1);
      if (sf.glow) { const k = sf.glow * (0.55 + 0.45 * night); r += sf.gcol[0] * k; gg += sf.gcol[1] * k; b += sf.gcol[2] * k; }
      if (lit && sf.land && night > 0.35) { const hx = Math.floor(u * 30), hy = Math.floor(v * 30); if (hash(hx, hy, s + 17) > (p.type === 'relic' ? 0.6 : 0.86)) { const k = night * 0.85; r += 255 * k; gg += 196 * k; b += 110 * k; } }
      const i = (y * S + x) * 4; d[i] = clamp(r, 0, 255); d[i + 1] = clamp(gg, 0, 255); d[i + 2] = clamp(b, 0, 255); d[i + 3] = rr > 0.965 ? 255 * (1 - rr) / 0.035 : 255;
    }
    g.putImageData(img, 0, 0);
    // atmosphere: a thin lit rim on worlds with air, tinted by the world
    if (T.hab || T.tex === 'gas' || p.type === 'toxic') {
      const ac = T.tex === 'gas' ? (p.type === 'icegas' ? '170,230,255' : '255,214,170') : p.type === 'toxic' ? '210,240,120' : '140,200,255';
      const at = g.createRadialGradient(S / 2, S / 2, R * 0.78, S / 2, S / 2, R * 1.0); at.addColorStop(0, `rgba(${ac},0)`); at.addColorStop(1, `rgba(${ac},.6)`);
      g.save(); g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.clip(); g.globalCompositeOperation = 'lighter';
      const lm = g.createLinearGradient(S * 0.2, S * 0.2, S * 0.8, S * 0.8); lm.addColorStop(0, 'rgba(0,0,0,1)'); lm.addColorStop(0.6, 'rgba(0,0,0,0)');
      g.fillStyle = at; g.fillRect(0, 0, S, S); g.restore();
    }
    if (p.type === 'tidal' || p.type === 'garden' || p.type === 'glacier') { const sp = g.createRadialGradient(S * 0.33, S * 0.3, 0, S * 0.33, S * 0.3, R * 0.4); sp.addColorStop(0, 'rgba(255,255,255,.22)'); sp.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sp; g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.fill(); }
    planetCache.set(key, c); return c;
  }
  // a ring system for giants: banded and translucent, split into the half behind the planet and the half in front
  function ringBands(g, x, y, rx, ry, tilt, half, seed, tint) {
    g.save(); g.translate(x, y); g.rotate(tilt); g.scale(1, ry / rx);
    const a0 = half === 'back' ? Math.PI : 0, a1 = half === 'back' ? 2 * Math.PI : Math.PI;
    for (let k = 0; k < 7; k++) { const rk = rx * (1.25 + k * 0.09), a = 0.12 + hash(k, 2, seed) * 0.32; g.strokeStyle = `rgba(${tint},${a})`; g.lineWidth = rx * (0.05 + hash(k, 3, seed) * 0.05); g.beginPath(); g.arc(0, 0, rk, a0, a1); g.stroke(); }
    g.restore();
  }
  // ---- species portraits ----
  // ethos backdrops: a motif behind the figure that says what the people value
  const ETHOS_BG = {
    vanguard: (g, a) => { g.fillStyle = 'rgba(255,90,90,.16)'; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(8 + k * 26, 0); g.lineTo(20 + k * 26, 0); g.lineTo(20 + k * 26, 46); g.lineTo(14 + k * 26, 40); g.lineTo(8 + k * 26, 46); g.fill(); } },
    concord: (g, a) => { g.strokeStyle = 'rgba(150,230,190,.3)'; g.lineWidth = 2; for (const sg of [-1, 1]) for (let k = 0; k < 6; k++) { const an = Math.PI * (0.62 + k * 0.08), x = 50 + sg * Math.cos(an) * 40, y = 52 - Math.sin(an) * 40; g.beginPath(); g.ellipse(x, y, 5, 2.4, sg * an, 0, 7); g.stroke(); } },
    ascendant: (g, a) => { g.strokeStyle = 'rgba(110,214,255,.3)'; g.lineWidth = 1; for (let k = 0; k < 9; k++) { const x = 6 + hash(k, 1, a) * 88, y = 4 + hash(k, 2, a) * 50; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10, y); g.lineTo(x + 14, y + 6); g.stroke(); g.fillStyle = 'rgba(110,214,255,.5)'; g.fillRect(x + 13, y + 5, 2, 2); } },
    devout: (g, a) => { g.strokeStyle = 'rgba(255,214,120,.35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(50, 38, 34, 0, 7); g.stroke(); g.lineWidth = 1; for (let k = 0; k < 24; k++) { const an = k * Math.PI / 12; g.beginPath(); g.moveTo(50 + Math.cos(an) * 36, 38 + Math.sin(an) * 36); g.lineTo(50 + Math.cos(an) * 46, 38 + Math.sin(an) * 46); g.stroke(); } },
    frontier: (g, a) => { const pg = g.createRadialGradient(80, 22, 2, 80, 22, 16); pg.addColorStop(0, 'rgba(255,214,150,.6)'); pg.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = pg; g.beginPath(); g.arc(80, 22, 16, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,214,150,.25)'; g.beginPath(); g.moveTo(0, 58); g.quadraticCurveTo(50, 48, 100, 58); g.stroke(); },
    insular: (g, a) => { g.strokeStyle = 'rgba(160,180,220,.18)'; g.lineWidth = 1; for (let y = 0; y < 60; y += 10) for (let x = (y / 10) % 2 * 9; x < 100; x += 18) { g.beginPath(); for (let k = 0; k < 6; k++) { const an = k * Math.PI / 3; g.lineTo(x + Math.cos(an) * 6, y + Math.sin(an) * 6); } g.closePath(); g.stroke(); } },
    mercantile: (g, a) => { for (let k = 0; k < 8; k++) { const x = 8 + hash(k, 3, a) * 84, y = 6 + hash(k, 4, a) * 46; g.fillStyle = 'rgba(255,214,110,.28)'; g.beginPath(); g.ellipse(x, y, 4, 4, 0, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,230,160,.4)'; g.beginPath(); g.ellipse(x, y, 2, 2, 0, 0, 7); g.stroke(); } },
    zealous: (g, a) => { for (let k = 0; k < 7; k++) { const x = 6 + k * 15, h = 22 + hash(k, 5, a) * 26; const fg = g.createLinearGradient(0, 70, 0, 70 - h); fg.addColorStop(0, 'rgba(255,120,40,.35)'); fg.addColorStop(1, 'rgba(255,200,80,0)'); g.fillStyle = fg; g.beginPath(); g.moveTo(x - 7, 70); g.quadraticCurveTo(x - 4, 70 - h * 0.6, x, 70 - h); g.quadraticCurveTo(x + 4, 70 - h * 0.6, x + 7, 70); g.fill(); } },
  };
  function portrait(gen, S, color, opts) {
    const c = mk(S), g = c.getContext('2d'); g.scale(S / 100, S / 100);
    const [hue, sat, head, eyes, crest, mouth, pattern, bgHue, accent] = gen;
    const satv = [45, 65, 30][sat] || 50;
    const skin = `hsl(${hue},${satv}%,46%)`, dark = `hsl(${hue},${satv}%,26%)`, light = `hsl(${hue},${satv}%,66%)`, acc = `hsl(${(hue + 150 + accent * 40) % 360},70%,60%)`;
    const bg = g.createRadialGradient(50, 40, 5, 50, 50, 75); bg.addColorStop(0, `hsl(${bgHue},45%,26%)`); bg.addColorStop(1, `hsl(${bgHue},55%,7%)`); g.fillStyle = bg; g.fillRect(0, 0, 100, 100);
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + hash(i, 1, hue) * 0.5})`; g.fillRect(hash(i, 2, bgHue) * 100, hash(i, 3, bgHue) * 60, 1, 1); }
    const eth = opts && opts.ethos; if (eth) for (const k of eth.slice(0, 2)) if (ETHOS_BG[k]) ETHOS_BG[k](g, hue + bgHue);
    // a soft key light behind the head
    { const kl = g.createRadialGradient(50, 34, 2, 50, 34, 40); kl.addColorStop(0, 'rgba(255,255,255,.12)'); kl.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = kl; g.fillRect(0, 0, 100, 80); }
    // clothing: five cuts, all trimmed in the empire color
    const col = color || '#556', cloth = (gen[0] * 7 + gen[2] * 3 + gen[4] * 5 + gen[8]) % 5, cdark = 'rgba(0,0,0,.32)';
    g.fillStyle = col; g.beginPath(); g.moveTo(8, 100); g.quadraticCurveTo(14, 70, 50, 68); g.quadraticCurveTo(86, 70, 92, 100); g.fill();
    const sh = g.createLinearGradient(0, 68, 0, 100); sh.addColorStop(0, 'rgba(255,255,255,.18)'); sh.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = sh; g.beginPath(); g.moveTo(8, 100); g.quadraticCurveTo(14, 70, 50, 68); g.quadraticCurveTo(86, 70, 92, 100); g.fill();
    g.fillStyle = cdark; g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
    if (cloth === 0) { g.beginPath(); g.moveTo(40, 100); g.lineTo(50, 74); g.lineTo(60, 100); g.fill(); }
    else if (cloth === 1) { for (const sg of [-1, 1]) { g.fillStyle = '#5a6382'; g.beginPath(); g.ellipse(50 + sg * 30, 80, 15, 8, sg * 0.35, 0, 7); g.fill(); g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); } g.fillStyle = '#3a4058'; g.fillRect(42, 74, 16, 26); g.fillStyle = col; g.fillRect(47, 80, 6, 6); }
    else if (cloth === 2) { g.fillStyle = '#20243a'; g.beginPath(); g.moveTo(36, 70); g.lineTo(50, 92); g.lineTo(64, 70); g.lineTo(60, 66); g.lineTo(50, 80); g.lineTo(40, 66); g.fill(); g.fillStyle = '#e8eaff'; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(50, 84 + k * 5, 1.2, 0, 7); g.fill(); } }
    else if (cloth === 3) { g.fillStyle = acc; g.globalAlpha = 0.8; g.beginPath(); g.moveTo(22, 78); g.lineTo(34, 74); g.lineTo(78, 100); g.lineTo(62, 100); g.fill(); g.globalAlpha = 1; g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(30, 77, 3, 0, 7); g.fill(); }
    else { g.strokeStyle = acc; g.lineWidth = 1.2; g.shadowColor = acc; g.shadowBlur = 3; for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(50 + sg * 6, 74); g.lineTo(50 + sg * 18, 88); g.lineTo(50 + sg * 18, 100); g.stroke(); } g.beginPath(); g.moveTo(44, 70); g.lineTo(56, 70); g.stroke(); g.shadowBlur = 0; }
    if (color) { g.strokeStyle = color; g.lineWidth = 3; g.globalAlpha = 0.7; g.strokeRect(1.5, 1.5, 97, 97); g.globalAlpha = 1; }
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
    const c = mk(W, H), g = c.getContext('2d'), hue = kind.startsWith('nebula_') ? +kind.slice(7) : ART_TINT[kind] ?? 220, s = seed || 7;
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
      // a world filling the lower frame, with a lit limb, clouds and a moon
      const pr = Math.max(W, H) * 0.62, px = cx + W * 0.08, py = H + pr * 0.55;
      const pl = planet({ id: -900 - (s % 7), type: kind === 'prim' ? 'jungle' : kind === 'harvest' ? 'steppe' : kind === 'refugee' ? 'dune' : ['tidal', 'taiga', 'mesa', 'glacier'][s % 4], seed: s * 7919 }, 256);
      glow(px, py, pr * 1.18, `hsla(${hue},80%,70%,.22)`);
      g.save(); g.beginPath(); g.arc(px, py, pr, 0, 7); g.clip(); g.translate(px, py); g.rotate(1.35); g.drawImage(pl, -pr, -pr, pr * 2, pr * 2); g.setTransform(1, 0, 0, 1, 0, 0);
      const sh = g.createLinearGradient(px - pr * 0.3, py - pr, px + pr * 0.5, py - pr * 0.4); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,8,.65)'); g.fillStyle = sh; g.fillRect(0, 0, W, H); g.restore();
      g.strokeStyle = `hsla(${hue},90%,80%,.55)`; g.lineWidth = 2; g.beginPath(); g.arc(px, py, pr, Math.PI * 1.08, Math.PI * 1.55); g.stroke();
      const mx = W * 0.16, my = H * 0.3, mr = 16; const mg = g.createRadialGradient(mx - 5, my - 5, 2, mx, my, mr); mg.addColorStop(0, '#d8d4cc'); mg.addColorStop(1, '#3a3836'); g.fillStyle = mg; g.beginPath(); g.arc(mx, my, mr, 0, 7); g.fill();
      if (kind === 'prim') for (let k = 0; k < 18; k++) { const a = Math.PI * (1.2 + hash(k, 3, s) * 0.6), r = pr * (0.98 - hash(k, 4, s) * 0.05); glow(px + Math.cos(a) * r, py + Math.sin(a) * r * 0.99 + 4, 3, 'rgba(255,210,120,.95)'); }
      if (kind === 'harvest') for (let k = 0; k < 5; k++) { const x = 60 + k * (W - 120) / 4, y = 40 + hash(k, 2, s) * 30; g.fillStyle = '#cfd6ff'; g.fillRect(x - 6, y - 2, 12, 4); glow(x, y, 10, 'rgba(160,255,140,.35)'); }
      if (kind === 'refugee') for (let k = 0; k < 14; k++) { g.fillStyle = '#e4e8ff'; const x = 30 + hash(k, 1, s) * (W - 60), y = 18 + hash(k, 2, s) * 70; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 9, y + 3); g.lineTo(x - 9, y - 3); g.fill(); glow(x - 11, y, 5, 'rgba(120,200,255,.7)'); }
    } else if (kind === 'council') {
      // a hall of glass: tiers of seats lit in many colors around a speaker's dais
      glow(cx, H * 0.95, 220, 'rgba(182,147,255,.35)');
      for (let tier = 0; tier < 4; tier++) { const rr = 70 + tier * 38; for (let k = 0; k < 9 + tier * 3; k++) { const a = Math.PI * (1.05 + 0.9 * k / (8 + tier * 3)), x = cx + Math.cos(a) * rr * 1.5, y = H * 0.95 + Math.sin(a) * rr * 0.7;
        g.fillStyle = `hsla(${(k * 47 + tier * 30) % 360},70%,${55 + tier * 4}%,.95)`; g.fillRect(x - 4, y - 3, 8, 5); glow(x, y - 2, 7, `hsla(${(k * 47 + tier * 30) % 360},90%,70%,.35)`); } }
      g.fillStyle = '#20233f'; g.beginPath(); g.moveTo(cx - 22, H); g.lineTo(cx - 12, H - 46); g.lineTo(cx + 12, H - 46); g.lineTo(cx + 22, H); g.fill(); glow(cx, H - 52, 26, 'rgba(255,240,210,.7)');
      g.strokeStyle = 'rgba(200,220,255,.18)'; g.lineWidth = 1.5; for (let k = 0; k < 7; k++) { const x = 20 + k * (W - 40) / 6; g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(cx, -40, W - x, H); g.stroke(); }
    } else if (kind === 'crystal') {
      // a field of faceted spires on dark rock, each with a bright and a shadowed face
      g.fillStyle = '#0c0a18'; g.beginPath(); g.moveTo(0, H); for (let k = 0; k <= 12; k++) g.lineTo(k * W / 12, H - 18 - hash(k, 8, s) * 22); g.lineTo(W, H); g.fill();
      const spires = []; for (let k = 0; k < 14; k++) spires.push([20 + hash(k, 1, s) * (W - 40), 40 + hash(k, 2, s) * 110, 7 + hash(k, 3, s) * 12, (hash(k, 4, s) - 0.5) * 0.35]);
      spires.sort((a, b) => a[1] - b[1]);
      for (const [x, hh, w, lean] of spires) { const tx = x + lean * hh, ty = H - 20 - hh, hl = `hsla(${hue + hh * 0.3},85%,${62 + hh / 8}%,.95)`, dk = `hsla(${hue + 20},70%,28%,.95)`;
        g.fillStyle = hl; g.beginPath(); g.moveTo(x - w, H - 18); g.lineTo(tx, ty); g.lineTo(x, H - 14); g.fill();
        g.fillStyle = dk; g.beginPath(); g.moveTo(x, H - 14); g.lineTo(tx, ty); g.lineTo(x + w, H - 18); g.fill();
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, H - 14); g.lineTo(tx, ty); g.stroke(); glow(tx, ty, 14 + hh / 8, `hsla(${hue},95%,80%,.45)`); }
      for (let k = 0; k < 30; k++) glow(hash(k, 5, s) * W, H - 40 - hash(k, 6, s) * 120, 2, 'rgba(230,220,255,.9)');
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
      // a holographic star chart: a projected grid in perspective, lanes between nodes and a scanning ring
      g.strokeStyle = `hsla(${hue},80%,65%,.16)`; g.lineWidth = 1;
      for (let k = 0; k <= 10; k++) { g.beginPath(); g.moveTo(cx + (k - 5) * 22, H * 0.5); g.lineTo(cx + (k - 5) * 90, H); g.stroke(); }
      for (let k = 0; k < 6; k++) { const y = H * 0.5 + Math.pow(k / 5, 1.6) * H * 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      const pts = []; for (let k = 0; k < 16; k++) pts.push([30 + hash(k, 1, s) * (W - 60), 16 + hash(k, 2, s) * (H * 0.62)]);
      g.strokeStyle = `hsla(${hue},85%,72%,.55)`; g.lineWidth = 1.2; g.beginPath();
      for (let k = 0; k < pts.length; k++) { let best = -1, bd = 1e9; for (let j = 0; j < pts.length; j++) { if (j === k) continue; const d = (pts[j][0] - pts[k][0]) ** 2 + (pts[j][1] - pts[k][1]) ** 2; if (d < bd) { bd = d; best = j; } } g.moveTo(...pts[k]); g.lineTo(...pts[best]); }
      g.stroke();
      pts.forEach(([x, y], k) => { glow(x, y, 9, `hsla(${(hue + k * 20) % 360},90%,75%,.8)`); g.fillStyle = '#fff'; g.fillRect(x - 1, y - 1, 2, 2); });
      const [sx, sy] = pts[s % pts.length]; g.strokeStyle = `hsla(${hue},95%,80%,.8)`; g.lineWidth = 1.5; for (let k = 1; k <= 3; k++) { g.globalAlpha = 1 - k * 0.25; g.beginPath(); g.arc(sx, sy, k * 12, 0, 7); g.stroke(); } g.globalAlpha = 1;
      g.fillStyle = `hsla(${hue},70%,70%,.12)`; g.beginPath(); g.moveTo(cx, H); g.lineTo(cx - 120, H * 0.2); g.lineTo(cx + 120, H * 0.2); g.fill();
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
  return { star, planet, portrait, scene, fbm, hash, mk, ringBands };
})();
