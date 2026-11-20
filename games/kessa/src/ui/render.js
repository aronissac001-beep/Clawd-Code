// ===== render.js : camera, terrain cache, world drawing, overlays, effects, picking =====
const TERR_COL = PAL.terr;
const R = {
  cv: null, c: null, w: 0, h: 0, dpr: 1, cam: { x: 0, y: 0, z: 0.7 }, G: null, terrain: null, oX: 0, oY: 0,
  ghost: null, sel: null, overlay: 'none', anims: [], parts: [], shake: 0, fogPath: null, fogKey: '', dirty: true, bz: new Map(), t: 0,
  init(cv) {
    this.cv = cv; this.c = cv.getContext('2d');
    this.resize(); window.addEventListener('resize', () => this.resize());
    for (let i = 0; i < 260; i++) this.parts.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random() * 1.5, v: 0.3 + Math.random() });
  },
  resize() {
    const q = Settings.get('quality');
    this.dpr = Math.min(q === 'low' ? 1 : q === 'high' ? 3 : 2, window.devicePixelRatio || 1);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.cv.width = Math.round(this.w * this.dpr); this.cv.height = Math.round(this.h * this.dpr);
    this.dirty = true;
  },
  setGame(G) {
    this.G = G; this.bz.clear(); this.anims = []; this.fogKey = ''; this.grit = null; this.lakes = null;
    this.buildTerrain();
    const L = G.buildings.find(b => b.t === 'lander');
    this.centerOn(L.x + 1.5, L.y + 1.5); this.cam.z = 0.8;
  },
  zAt(x, y) { const T = this.G._T, n = MAP_N; x = clamp(Math.floor(x), 0, n - 1); y = clamp(Math.floor(y), 0, n - 1); return T.h[y * n + x] * HZ; },
  // smooth height at a tile-space point (bilinear over tile centres)
  zSmooth(x, y) {
    const T = this.G._T, n = MAP_N, fx = clamp(x - 0.5, 0, n - 1.001), fy = clamp(y - 0.5, 0, n - 1.001), ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const h = (a, b) => T.h[clamp(b, 0, n - 1) * n + clamp(a, 0, n - 1)];
    return ((h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - v) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * v) * HZ;
  },
  cornerZ(cx, cy) { const T = this.G._T, n = MAP_N; let s = 0, k = 0; for (let y = cy - 1; y <= cy; y++) for (let x = cx - 1; x <= cx; x++) if (x >= 0 && y >= 0 && x < n && y < n) { s += T.h[y * n + x]; k++; } return s / k * HZ; },
  buildingZ(b) { let z = this.bz.get(b.id); if (z === undefined) { if (b.mod) return 0; let s = 0, m = -1; for (let y = b.y; y < b.y + b.s; y++) for (let x = b.x; x < b.x + b.s; x++) { const v = this.zAt(x, y); s += v; m = Math.max(m, v); } z = s / (b.s * b.s) * 0.5 + m * 0.5; this.bz.set(b.id, z); } return z; },
  // what the baked terrain shows of Reshaping Kessa; a change rebuilds it (a dozen times in a whole game)
  terraKey() { const T = this.G && this.G.terra; if (!T) return '0'; return Math.round(clamp((T.warm - 15) / 40, 0, 1) * 4) + '|' + (T.life >= 8 ? Math.min(8, Math.floor(T.life / 9)) : -1) + '|' + Math.round(KC.lakeFrac(this.G) * 20) + '|' + (T.levees ? T.levees.length : 0); },
  buildTerrain() {
    const G = this.G, T = G._T, n = MAP_N;
    this.oX = n * TW / 2; this.oY = HZ + 12;
    const W = n * TW, H = n * TH + HZ + 70;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.translate(this.oX, this.oY);
    const cz = []; for (let y = 0; y <= n; y++) { cz.push([]); for (let x = 0; x <= n; x++) cz[y].push(this.cornerZ(x, y)); }
    this.cz = cz;
    const rnd = KC.RNG.fromSeed(G.seed + '/paint');
    // terrain: per-pixel heightfield, drawn column by column front to back (smooth shading, no facets)
    const GR = 4, gn = n * GR + 1, gH = new Float32Array(gn * gn), gR = new Float32Array(gn * gn), gG = new Float32Array(gn * gn), gB = new Float32Array(gn * gn);
    const tcol = TERR_COL.map(cc => { const v = parseInt(cc.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; });
    for (let gy = 0; gy < gn; gy++) for (let gx = 0; gx < gn; gx++) {
      const x = gx / GR, y = gy / GR, ix = Math.min(n - 1, Math.floor(x)), iy = Math.min(n - 1, Math.floor(y)), u = x - ix, v = y - iy;
      gH[gy * gn + gx] = (cz[iy][ix] * (1 - u) + cz[iy][ix + 1] * u) * (1 - v) + (cz[iy + 1][ix] * (1 - u) + cz[iy + 1][ix + 1] * u) * v;
    }
    const tex = makeNoise(KC.RNG.fromSeed(G.seed + '/shade'));
    // Reshaping Kessa: frost melts back to wet ground, lichen, moss and shrubs spread over the plains
    const TS = G.terra || { warm: 0, life: 0, water: 0 }, melt = clamp((TS.warm - 15) / 40, 0, 1), cover = clamp(TS.life / 80, 0, 0.72), vegT = TS.life >= 50 ? 2 : TS.life >= 28 ? 1 : TS.life >= 8 ? 0 : -1;
    this.tkey = this.terraKey();
    const VEG = PAL.veg, WET = PAL.wet, SHT = PAL.shadeTint, LTT = PAL.litTint;
    const sm = (e0, e1, v) => { const q = clamp((v - e0) / (e1 - e0), 0, 1); return q * q * (3 - 2 * q); };
    const wt = new Float32Array(6);
    for (let gy = 0; gy < gn; gy++) for (let gx = 0; gx < gn; gx++) {
      const i = gy * gn + gx, xm = Math.max(0, gx - 1), xp = Math.min(gn - 1, gx + 1), ym = Math.max(0, gy - 1), yp = Math.min(gn - 1, gy + 1);
      const dzdx = (gH[gy * gn + xp] - gH[gy * gn + xm]) / ((xp - xm) / GR), dzdy = (gH[yp * gn + gx] - gH[ym * gn + gx]) / ((yp - ym) / GR);
      const lap = gH[gy * gn + xp] + gH[gy * gn + xm] + gH[yp * gn + gx] + gH[ym * gn + gx] - 4 * gH[i];
      const x = gx / GR, y = gy / GR;
      // terrain types meet along noisy, fairly crisp borders instead of soft bilinear smears
      const wx = x + tex.fbm(x * 0.8 + 11, y * 0.8 + 3, 3) * 0.9, wy = y + tex.fbm(x * 0.8 + 37, y * 0.8 + 19, 3) * 0.9;
      const fx = clamp(wx - 0.5, 0, n - 1.001), fy = clamp(wy - 0.5, 0, n - 1.001), ix = Math.floor(fx), iy = Math.floor(fy), u = sm(0.22, 0.78, fx - ix), v = sm(0.22, 0.78, fy - iy);
      let r = 0, g = 0, b = 0; wt.fill(0);
      const add = (tx, ty, w) => { const k = Math.min(n - 1, ty) * n + Math.min(n - 1, tx), tt = T.terr[k], c0 = tcol[tt], dk = 1 - T.crater[k] * 0.12; r += c0[0] * w * dk; g += c0[1] * w * dk; b += c0[2] * w * dk; wt[tt] += w; };
      add(ix, iy, (1 - u) * (1 - v)); add(ix + 1, iy, u * (1 - v)); add(ix, iy + 1, (1 - u) * v); add(ix + 1, iy + 1, u * v);
      // per-type surface character: wind streaks on dust, mottled rock, blotchy basalt, bright frost, dune crests, highland strata
      const tv = wt[0] * tex.fbm(x * 0.25 + 3, y * 1.6 + 5, 3) * 0.1 + wt[1] * tex.fbm(x * 2.2, y * 2.2, 2) * 0.12 + wt[2] * (tex.fbm(x * 1.4 + 9, y * 1.4, 3) * 0.14 - 0.03)
        + wt[3] * (0.06 + tex.fbm(x * 3 + 2, y * 3, 2) * 0.07) + wt[4] * Math.sin((x * 0.9 + y * 0.45) * 2.6 + tex.fbm(x * 0.5, y * 0.5, 2) * 5) * 0.06 + wt[5] * Math.sin(gH[i] / 4.5) * 0.05;
      // craters: the bowl wall facing the light is bright, the near wall is in shadow, the rim catches the sun
      let crs = 0;
      for (const cr of T.craters || []) { const dx = x - cr.x, dy = y - cr.y, dd = Math.hypot(dx, dy), d = dd / cr.r; if (d > 1.5 || dd < 1e-3) continue; const ux = (dx - dy * 0.35) / dd;
        if (d < 1) crs += ux * 0.26 * sm(0.25, 1, d) - 0.07 * (1 - d) - 0.06 * sm(0.55, 0.95, d) * (1 - Math.max(0, ux)); else crs += Math.exp(-Math.pow((d - 1.06) / 0.16, 2)) * (0.1 - ux * 0.08); }
      const lit = clamp(1.04 + crs - 0.019 * (0.9 * dzdx + 1.0 * dzdy) + clamp(-lap * 0.09, -0.16, 0.13) + (gH[i] / HZ - 0.5) * 0.18 + tex.fbm(x * 0.7, y * 0.7, 4) * 0.09 + tv, 0.4, 1.55);
      if (melt > 0 && wt[3] > 0) { const m = wt[3] * melt * 0.85; r = r * (1 - m) + WET[0] * m; g = g * (1 - m) + WET[1] * m; b = b * (1 - m) + WET[2] * m; }
      if (vegT >= 0) { const v = tex.fbm(x * 0.32 + 51, y * 0.32 + 17, 4) * 0.5 + 0.5 - gH[i] / HZ * 0.25 + (1 - wt[5]) * 0.08, edge = sm(1.02 - cover * 1.15, 1.1 - cover * 1.15, v) * (1 - wt[5] * 0.7);
        if (edge > 0) { const vc = VEG[vegT], vl = VEG[Math.max(0, vegT - 1)], q = sm(0.3, 0.9, edge); const cr = vl[0] + (vc[0] - vl[0]) * q, cg = vl[1] + (vc[1] - vl[1]) * q, cb = vl[2] + (vc[2] - vl[2]) * q, a = edge * 0.82; r = r * (1 - a) + cr * a; g = g * (1 - a) + cg * a; b = b * (1 - a) + cb * a; } }
      const hv = tex.fbm(x * 0.11 + 7, y * 0.11 + 3, 3) * 0.09, sk = lit < 1 ? Math.min(1, (1 - lit) * 2.2) : 0, lk = lit > 1 ? Math.min(1, (lit - 1) * 2.5) : 0;
      const tr = 1 + hv + (SHT[0] - 1) * sk + (LTT[0] - 1) * lk, tg = 1 + (SHT[1] - 1) * sk + (LTT[1] - 1) * lk, tb = 1 - hv + (SHT[2] - 1) * sk + (LTT[2] - 1) * lk;
      gR[i] = r * lit * tr; gG[i] = g * lit * tg; gB[i] = b * lit * tb * (0.98 + wt[3] * 0.06 * (1 - melt));
    }
    const img = c.getImageData(0, 0, W, H), px32 = new Uint32Array(img.data.buffer);
    const ds = 1 / 14;
    for (let px = 0; px < W; px++) {
      const k = (px - this.oX + 0.5) / (TW / 2);
      const sMax = Math.min(2 * n - k, 2 * n + k) - 1e-4, sMin = Math.max(-k, k);
      let ybuf = H;
      for (let s = sMax; s >= sMin; s -= ds) {
        const x = (s + k) / 2 * GR, y = (s - k) / 2 * GR;
        const ix = x | 0, iy = y | 0, u = x - ix, v = y - iy, i0 = iy * gn + ix, i1 = i0 + 1, i2 = i0 + gn, i3 = i2 + 1;
        const ix1 = ix + 1 < gn ? 1 : 0, iy1 = iy + 1 < gn ? 1 : 0;
        const a = (1 - u) * (1 - v), bb = u * (1 - v) * ix1, cc = (1 - u) * v * iy1, d = u * v * ix1 * iy1, ws = a + bb + cc + d;
        const hh = (gH[i0] * a + (ix1 ? gH[i1] * bb : 0) + (iy1 ? gH[i2] * cc : 0) + (ix1 && iy1 ? gH[i3] * d : 0)) / ws;
        const sy = Math.round(s * TH / 2 - hh + this.oY);
        if (sy >= ybuf) continue;
        let r = (gR[i0] * a + (ix1 ? gR[i1] * bb : 0) + (iy1 ? gR[i2] * cc : 0) + (ix1 && iy1 ? gR[i3] * d : 0)) / ws;
        let g = (gG[i0] * a + (ix1 ? gG[i1] * bb : 0) + (iy1 ? gG[i2] * cc : 0) + (ix1 && iy1 ? gG[i3] * d : 0)) / ws;
        let b = (gB[i0] * a + (ix1 ? gB[i1] * bb : 0) + (iy1 ? gB[i2] * cc : 0) + (ix1 && iy1 ? gB[i3] * d : 0)) / ws;
        const top = Math.max(0, sy);
        for (let yy = top; yy < ybuf && yy < H; yy++) {
          const nz = 1 + ((((px * 73856093) ^ (yy * 19349663)) >>> 0) % 1000 / 1000 - 0.5) * 0.09;
          px32[yy * W + px] = 0xff000000 | (clamp(b * nz, 0, 255) << 16) | (clamp(g * nz, 0, 255) << 8) | clamp(r * nz, 0, 255);
        }
        ybuf = top;
        if (ybuf <= 0) break;
      }
    }
    c.putImageData(img, 0, 0);
    // skirt along the two front edges
    for (let i = 0; i < n; i++) {
      for (const side of [0, 1]) {
        const a = side ? [i, n] : [n, i], b = side ? [i + 1, n] : [n, i + 1];
        const za = cz[a[1]][a[0]], zb = cz[b[1]][b[0]];
        const pts = [[isoX(a[0], a[1]), isoY(a[0], a[1], za)], [isoX(b[0], b[1]), isoY(b[0], b[1], zb)], [isoX(b[0], b[1]), isoY(b[0], b[1], -40)], [isoX(a[0], a[1]), isoY(a[0], a[1], -40)]];
        const g = c.createLinearGradient(0, pts[0][1], 0, pts[3][1]); g.addColorStop(0, side ? PAL.skirt[0] : shade(PAL.skirt[0], -0.18)); g.addColorStop(0.5, side ? PAL.skirt[1] : shade(PAL.skirt[1], -0.18)); g.addColorStop(1, PAL.skirt[2]);
        poly(c, pts, g);
      }
    }
    const tAt = (x, y) => T.terr[clamp(y | 0, 0, n - 1) * n + clamp(x | 0, 0, n - 1)];
    const ZP = (x, y) => [isoX(x, y), isoY(x, y, this.zSmooth(x, y))];
    // highland strata and ridge contours (marching squares on the height grid)
    c.lineWidth = 0.8;
    for (const [col, off] of [['rgba(30,20,14,.16)', 0], ['rgba(255,236,214,.09)', -1]]) {
      c.strokeStyle = col; c.beginPath();
      for (let gy = 0; gy < gn - 1; gy++) for (let gx = 0; gx < gn - 1; gx++) {
        const x = gx / GR, y = gy / GR, tt = tAt(x, y); if (tt !== 5 && T.slope[clamp(y | 0, 0, n - 1) * n + clamp(x | 0, 0, n - 1)] < 0.07) continue;
        const h0 = gH[gy * gn + gx], h1 = gH[gy * gn + gx + 1], h2 = gH[(gy + 1) * gn + gx + 1], h3 = gH[(gy + 1) * gn + gx];
        const lv = Math.ceil(Math.min(h0, h1, h2, h3) / 5) * 5; if (lv > Math.max(h0, h1, h2, h3)) continue;
        const pts = [], e = (ha, hb, ax, ay, bx, by) => { if ((ha - lv) * (hb - lv) < 0) { const f = (lv - ha) / (hb - ha); pts.push([ax + (bx - ax) * f, ay + (by - ay) * f]); } };
        const d = 1 / GR; e(h0, h1, x, y, x + d, y); e(h1, h2, x + d, y, x + d, y + d); e(h2, h3, x + d, y + d, x, y + d); e(h3, h0, x, y + d, x, y);
        if (pts.length >= 2) { c.moveTo(isoX(pts[0][0], pts[0][1]), isoY(pts[0][0], pts[0][1], lv) + off); c.lineTo(isoX(pts[1][0], pts[1][1]), isoY(pts[1][0], pts[1][1], lv) + off); }
      }
      c.stroke();
    }
    // basalt: a network of cracked plates
    const jit = (x, y, k) => { const hh = ((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0; return (hh % 1000) / 1000 - 0.5; };
    const cp = (x, y) => [x + jit(x, y, 1) * 0.6, y + jit(x, y, 2) * 0.6];
    for (const [col, lw, off] of [['rgba(18,12,10,.34)', 0.9, 0], ['rgba(255,236,214,.08)', 0.6, 1]]) {
      c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (T.terr[y * n + x] !== 2) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) { if (jit(x, y, 3 + dx) > 0.3) continue; const p0 = cp(x, y), p1 = cp(x + dx, y + dy), m = [(p0[0] + p1[0]) / 2 + jit(x, y, 7) * 0.3, (p0[1] + p1[1]) / 2 + jit(x, y, 8) * 0.3], a0 = ZP(p0[0], p0[1]), a1 = ZP(m[0], m[1]), a2 = ZP(p1[0], p1[1]); c.moveTo(a0[0], a0[1] + off); c.lineTo(a1[0], a1[1] + off); c.lineTo(a2[0], a2[1] + off); }
      }
      c.stroke();
    }
    // grain and pebbles
    for (let k = 0; k < 26000; k++) {
      const x = rnd.next() * n, y = rnd.next() * n, i = (y | 0) * n + (x | 0), z = this.zSmooth(x, y);
      const px = isoX(x, y), py = isoY(x, y, z), dark = rnd.next() < 0.6;
      c.fillStyle = dark ? 'rgba(40,28,20,' + (0.1 + rnd.next() * 0.18) + ')' : 'rgba(255,235,210,' + (0.06 + rnd.next() * 0.12) + ')';
      const sz = T.terr[i] === 1 || T.terr[i] === 2 ? 0.8 + rnd.next() * 2.2 : 0.5 + rnd.next() * 1.1;
      c.fillRect(px, py, sz, sz * 0.6);
    }
    // dust plains: faint wind streaks behind pebbles
    c.lineWidth = 1;
    for (let k = 0; k < 1600; k++) {
      const x = rnd.next() * n, y = rnd.next() * n; if (tAt(x, y) !== 0) continue;
      const p0 = ZP(x, y), L = 6 + rnd.next() * 14; c.strokeStyle = 'rgba(255,228,190,' + (0.05 + rnd.next() * 0.06).toFixed(3) + ')'; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p0[0] + L, p0[1] + L * 0.18); c.stroke();
    }
    // dunes: paired lit and shaded ripple crests along the wind
    for (let k = 0; k < 2600; k++) {
      const x = rnd.next() * n, y = rnd.next() * n; if (tAt(x, y) !== 4) continue;
      const p0 = ZP(x, y), w = 8 + rnd.next() * 10, bow = 2 + rnd.next() * 2;
      c.strokeStyle = 'rgba(255,225,180,.22)'; c.lineWidth = 1; c.beginPath(); c.moveTo(p0[0] - w, p0[1] - 1); c.quadraticCurveTo(p0[0], p0[1] - 1 - bow, p0[0] + w, p0[1]); c.stroke();
      c.strokeStyle = 'rgba(60,34,18,.16)'; c.beginPath(); c.moveTo(p0[0] - w, p0[1] + 0.6); c.quadraticCurveTo(p0[0], p0[1] + 0.6 - bow, p0[0] + w, p0[1] + 1.6); c.stroke();
    }
    // boulders: rock fields, basalt and highland, plus ejecta thrown around crater rims
    const boulder = (x, y, r) => { const z = this.zSmooth(x, y), px = isoX(x, y), py = isoY(x, y, z), tt = tAt(x, y), base = tt === 2 ? PAL.boulder.basalt : tt === 5 ? PAL.boulder.highland : PAL.boulder.rock;
      c.fillStyle = 'rgba(' + PAL.shadow + ',.3)'; c.beginPath(); c.ellipse(px + r * 0.7, py + 0.6, r * 1.35, r * 0.5, 0, 0, 7); c.fill();
      c.fillStyle = shade(base, 0.12 + rnd.next() * 0.22); c.beginPath(); c.moveTo(px - r, py); c.lineTo(px - r * 0.6, py - r * 0.9); c.lineTo(px + r * 0.3, py - r * 1.05); c.lineTo(px + r, py - r * 0.3); c.lineTo(px + r * 0.8, py + r * 0.15); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,236,214,.24)'; c.beginPath(); c.moveTo(px - r * 0.6, py - r * 0.9); c.lineTo(px + r * 0.3, py - r * 1.05); c.lineTo(px, py - r * 0.45); c.closePath(); c.fill(); };
    for (let k = 0; k < 1500; k++) {
      const x = rnd.next() * n, y = rnd.next() * n, tt = tAt(x, y); if (tt !== 1 && tt !== 5 && tt !== 2 && rnd.next() > 0.22) continue;
      boulder(x, y, 2 + rnd.next() * (tt === 1 ? 4.5 : 3));
    }
    for (const cr of T.craters || []) {
      const m = Math.round(cr.r * 7);
      for (let k = 0; k < m; k++) { const a = rnd.next() * 6.283, d = cr.r * (1.05 + Math.pow(rnd.next(), 2) * 0.7), x = cr.x + Math.cos(a) * d, y = cr.y + Math.sin(a) * d; if (x < 0.5 || y < 0.5 || x > n - 0.5 || y > n - 0.5) continue; boulder(x, y, 1.2 + rnd.next() * 2.4); }
      // a bright sunlit rim on the far side and bright ejecta rays from the big ones
      c.strokeStyle = 'rgba(255,238,214,.16)'; c.lineWidth = 2.2; c.beginPath();
      for (let k = 0; k <= 24; k++) { const a = -0.3 + k / 24 * 2.2, x = cr.x + Math.cos(a) * cr.r * 1.0, y = cr.y + Math.sin(a) * cr.r * 1.0, q = ZP(x, y); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
      c.stroke();
      if (cr.r > 6) { c.strokeStyle = 'rgba(255,236,210,.05)'; c.lineWidth = 5; for (let k = 0; k < 14; k++) { const a = rnd.next() * 6.283, d0 = cr.r * 1.15, d1 = cr.r * (1.8 + rnd.next() * 1.4), q0 = ZP(cr.x + Math.cos(a) * d0, cr.y + Math.sin(a) * d0), q1 = ZP(cr.x + Math.cos(a) * d1, cr.y + Math.sin(a) * d1); c.beginPath(); c.moveTo(q0[0], q0[1]); c.lineTo(q1[0], q1[1]); c.stroke(); } }
    }
    // shrubs once Verdure is high: small rounded bushes with shadows on vegetated ground
    if (vegT === 2) for (let k = 0; k < 2600 * cover; k++) {
      const x = rnd.next() * n, y = rnd.next() * n, tt = tAt(x, y); if (tt === 5 || tex.fbm(x * 0.32 + 51, y * 0.32 + 17, 4) * 0.5 + 0.5 < 1.06 - cover * 1.15) continue;
      const q = ZP(x, y), r0 = 1.6 + rnd.next() * 2.4; c.fillStyle = 'rgba(20,30,10,.3)'; c.beginPath(); c.ellipse(q[0] + 1.5, q[1] + 0.5, r0 * 1.2, r0 * 0.5, 0, 0, 7); c.fill();
      c.fillStyle = PAL.shrub[(rnd.next() * 3) | 0]; c.beginPath(); c.arc(q[0], q[1] - r0 * 0.6, r0, 0, 7); c.fill(); c.fillStyle = 'rgba(200,240,150,.28)'; c.beginPath(); c.arc(q[0] - r0 * 0.3, q[1] - r0, r0 * 0.45, 0, 7); c.fill();
    }
    // frost: crisp bright patches with blue edges, and glints (fewer as the world warms)
    for (let k = 0; k < 2200 * (1 - melt * 0.9); k++) {
      const x = rnd.next() * n, y = rnd.next() * n; if (tAt(x, y) !== 3) continue;
      const q = ZP(x, y), rx = 3 + rnd.next() * 8, ry = 1.5 + rnd.next() * 3;
      c.fillStyle = 'rgba(' + PAL.frost.edge + ',.2)'; c.beginPath(); c.ellipse(q[0] + 1, q[1] + 0.8, rx, ry, 0, 0, 7); c.fill();
      c.fillStyle = 'rgba(' + PAL.frost.lit + ',' + (0.2 + rnd.next() * 0.3).toFixed(2) + ')'; c.beginPath(); c.ellipse(q[0], q[1], rx, ry, 0, 0, 7); c.fill();
      if (rnd.next() < 0.3) { c.fillStyle = 'rgba(255,255,255,.85)'; c.fillRect(q[0] + (rnd.next() - 0.5) * rx, q[1] + (rnd.next() - 0.5) * ry, 1, 1); }
    }
    if (G.terra && G.terra.st.lakes) { this.lakes = null; this.lakeGeo(); for (const L of this.lakes.list) this.paintLake(c, L); for (const lv of G.terra.levees || []) this.paintLevee(c, lv); }
    this.terrain = cv; this.dirty = true;
  },
  // ---------- camera ----------
  centerOn(x, y) { const z = this.zSmooth(x, y); this.cam.x = isoX(x, y); this.cam.y = isoY(x, y, z); this.dirty = true; },
  clampCam() { const n = MAP_N, m = 200; this.cam.x = clamp(this.cam.x, -n * TW / 2 - m, n * TW / 2 + m); this.cam.y = clamp(this.cam.y, -m, n * TH + m); this.cam.z = clamp(this.cam.z, 0.28, 2.6); },
  worldToScreen(wx, wy) { return [(wx - this.cam.x) * this.cam.z + this.w / 2, (wy - this.cam.y) * this.cam.z + this.h / 2]; },
  screenToWorld(sx, sy) { return [(sx - this.w / 2) / this.cam.z + this.cam.x, (sy - this.h / 2) / this.cam.z + this.cam.y]; },
  // inverse of the iso projection, refined for terrain height
  screenToTile(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    let z = 0, tx = 0, ty = 0;
    for (let k = 0; k < 4; k++) {
      const a = wx / (TW / 2), b = (wy + z) / (TH / 2);
      tx = (a + b) / 2; ty = (b - a) / 2;
      z = this.zSmooth(tx, ty);
    }
    return { x: Math.floor(tx), y: Math.floor(ty), fx: tx, fy: ty };
  },
  tileToScreen(x, y) { return this.worldToScreen(isoX(x, y), isoY(x, y, this.zSmooth(x, y))); },
  // ---------- frame ----------
  frame(now, frac) {
    const G = this.G; if (!G) return;
    const c = this.c, t = now / 1000; this.t = t;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const env = KC.envNow(G);
    const hourF = (KC.hourOf(G.tick) + frac) % 24;
    const sun = hourF >= 5.5 && hourF <= 19.5 ? Math.max(0, Math.sin((hourF - 5.5) / 14 * Math.PI)) : 0;
    // sky / void
    this.sunNow = sun;
    if (G.terra && this.terraKey() !== this.tkey) this.buildTerrain();
    // the colour grade of this moment (day, dusk, night, storm, cold) drives the sky, shadows, the tint and the lights
    // effects tier: 0 Battery, 2 Sharp; Balanced starts at 2 and steps down to 1 while frames run slow (and back up when they recover)
    const qs = Settings.get('quality'), ft = (typeof UI !== 'undefined' && UI.ft) || 0; this.fx = qs === 'low' ? 0 : qs === 'high' ? 2 : this.fx === 1 ? (ft && ft < 17 ? 2 : 1) : (ft > 26 ? 1 : 2);
    const grade = sceneGrade(sun, env.dust || 0, env.cold); this.grade = grade;
    const SK = PAL.sky, skyC = i => { const a = rgbOf(SK.day[i]), b = rgbOf(SK.dusk[i]), n = rgbOf(SK.night[i]), st = rgbOf(SK.storm[i]); return a.map((v, k) => { let o = v + (b[k] - v) * grade.dusk; o += (n[k] - o) * grade.night; o += (st[k] * (1 - grade.night * 0.7) - o) * clamp(env.dust || 0, 0, 1) * 0.7; return o | 0; }).join(','); };
    const sky = c.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, 'rgb(' + skyC(0) + ')'); sky.addColorStop(1, 'rgb(' + skyC(1) + ')');
    c.fillStyle = sky; c.fillRect(0, 0, this.w, this.h);
    if (grade.night > 0.3 && this.cam.z < 0.75 && !env.dust) drawStars(c, this.w, this.h, (grade.night - 0.3) / 0.7, t);
    const quake = KC.hazardActive(G, 'quake');
    const sh = quake ? 3 * quake.sev : 0;
    const z = this.cam.z, ox = this.w / 2 - this.cam.x * z + (sh ? (Math.random() - 0.5) * sh * 2 : 0), oy = this.h / 2 - this.cam.y * z + (sh ? (Math.random() - 0.5) * sh * 2 : 0);
    c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * ox, this.dpr * oy);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.terrain, -this.oX, -this.oY);
    // visible tile window (roughly) for culling
    const [w0x, w0y] = this.screenToWorld(-80, -120), [w1x, w1y] = this.screenToWorld(this.w + 80, this.h + 160);
    const vis = (wx, wy) => wx > w0x && wx < w1x && wy > w0y && wy < w1y;
    // close up, fine grit on the visible tiles keeps the ground crisp where the terrain bitmap is magnified
    if (z > 1.1 && !this.noGrain) this.drawGrit(c, vis, z);
    if (this.G.terra && this.G.terra.st.lakes) this.drawLakes(c, t, z);
    this.drawDeposits(c, vis, t);
    this.drawLines(c, t, vis);
    drawRail(c, G, vis, (x, y) => this.zSmooth(x, y), t);
    if (this.overlay === 'power' || this.overlay === 'life') this.drawNets(c);
    if (this.overlay === 'drones' || (this.ghost && BUILDINGS[this.ghost.type] && BUILDINGS[this.ghost.type].hub)) this.drawCoverage(c);
    // depth-sorted objects
    const items = [];
    for (const b of G.buildings) {
      if (b.mod) continue;
      const cx = isoX(b.x + b.s / 2, b.y + b.s / 2), cy = isoY(b.x + b.s / 2, b.y + b.s / 2, 0);
      if (!vis(cx, cy)) continue;
      items.push({ d: b.x + b.y + b.s * 2, b });
      if (b.t === 'station' && b.built) items.push({ d: b.x + b.y + b.s * 2 + 0.1, roof: b });
    }
    for (const v of G.vehicles) { const vx = lerp(v.px === undefined ? v.x : v.px, v.x, frac), vy = lerp(v.py === undefined ? v.y : v.py, v.y, frac); items.push({ d: vx + vy + 1.2, v, vx, vy }); }
    // monorail cars: inside a station they draw over its platform
    if (G.trains && G.trains.length) for (const tr of G.trains) for (const car of trainCars(G, tr, frac)) {
      if (!vis(isoX(car.x + 0.5, car.y + 0.5), isoY(car.x + 0.5, car.y + 0.5, 0))) continue;
      const id = G._occ[Math.round(car.y) * MAP_N + Math.round(car.x)], st = id && KC.bById(G, id);
      items.push({ d: st && st.t === 'station' ? st.x + st.y + st.s * 2 + 0.05 : car.x + car.y + 1.5, car, tr });
    }
    items.sort((a, b) => a.d - b.d);
    const glows = [], beacons = [];
    if (sun > 0.02 && this.fx > 0) this.drawShadows(c, items, sun, clamp((hourF - 12) / 6, -1, 1), env.dust || 0);
    const gl = { sunTilt: clamp((hourF - 12) / 6, -1, 1), windAngle: t * (env.dust ? 6 : 2.5), zoom: z, domeGlow: 1 - sun };
    ARTV.lod = z; ARTV.night = Math.max(1 - Math.min(1, sun / 0.2), (env.dust || 0) * 0.6); ARTV.t = t; ARTV.emit = ARTV.night > 0.3 ? [] : null; ARTV.lights = ARTV.night > 0.3 ? [] : null; SPR.dpr = this.dpr;
    for (const it of items) {
      if (it.roof) { drawStationRoof(c, it.roof, this.buildingZ(it.roof), t, ARTV.night > 0.3 && it.roof.pw > 0.4); continue; }
      if (it.car) { const zz = this.zSmooth(it.car.x + 0.5, it.car.y + 0.5), l0 = ARTV.lit, L0 = ARTV.lod; ARTV.lit = ARTV.night > 0.3; ARTV.lod = z; drawTrainCar(c, it.car, zz, t, ARTV.lit, { cargo: !!G._freight }); ARTV.lit = l0; ARTV.lod = L0; if (it.car.head) glows.push([isoX(it.car.x + 0.5, it.car.y + 0.5), isoY(it.car.x + 0.5, it.car.y + 0.5, zz + 12), 16]); continue; }
      if (it.v) { const vz = this.zSmooth(it.vx + 0.5, it.vy + 0.5); drawVehicle(c, it.v, it.vx, it.vy, vz, t, this.sel && this.sel.k === 'v' && this.sel.id === it.v.id); glows.push([isoX(it.vx + 0.5, it.vy + 0.5), isoY(it.vx + 0.5, it.vy + 0.5, vz) - 6, 26]); continue; }
      const b = it.b, d = BUILDINGS[b.t], bz = this.buildingZ(b);
      c.save();
      if (this.overlay !== 'none' && this.overlayDim(b)) c.globalAlpha = 0.45;
      const lit = b.built && !b.broken && b.on !== false && (b._pf === undefined || b._pf > 0.4);
      if (lit && (b.t === 'hub' || b.t === 'mast' || b.t === 'spire' || b.t === 'lander')) beacons.push([isoX(b.x + b.s / 2, b.y + b.s / 2), isoY(b.x + b.s / 2, b.y + b.s / 2, bz) - (b.t === 'spire' ? 120 : b.t === 'mast' ? 46 : 30), b.id]);
      gl.prog = b.built ? 1 : b.prog / Math.max(1, d.work);
      if (d.dome) { drawBuilding(c, b, b.x, b.y, bz, t, Object.assign({}, gl, { mods: KC.domeModules(G, b), pop: b._pop || 0 })); if (lit) glows.push([isoX(b.x + b.s / 2, b.y + b.s / 2), isoY(b.x + b.s / 2, b.y + b.s / 2, bz) - b.s * 6, b.s * 34]); }
      else { drawBuilding(c, b, b.x, b.y, bz, t, gl); if (lit && b.t !== 'solar' && b.t !== 'thinfilm' && b.t !== 'battery') glows.push([isoX(b.x + b.s / 2, b.y + b.s / 2), isoY(b.x + b.s / 2, b.y + b.s / 2, bz) - 10, 10 + b.s * 10]); }
      c.restore();
    }
    this.drawDrones(c, t, frac, vis);
    this.drawWalkers(c, t, frac, vis, sun);
    this.drawRockets(c, t, frac);
    this.drawAnims(c, t);
    this.drawTrail(c, t);
    this.drawFog(c);
    if (this.overlay === 'survey') this.drawSectors(c);
    if (this.overlay === 'deposits') this.drawDepositLabels(c);
    this.drawBadges(c, t, vis);
    this.drawSelection(c, t);
    this.drawGhost(c, t);
    // colour grade: a vertical multiply gradient (cooler sky-side at the top of the view), then aerial haze at the top
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const q = Settings.get('quality'), rgbS = v => 'rgb(' + v.map(x => clamp(x | 0, 0, 255)).join(',') + ')';
    const mg = c.createLinearGradient(0, 0, 0, this.h); mg.addColorStop(0, rgbS(grade.top)); mg.addColorStop(1, rgbS(grade.bot));
    c.globalCompositeOperation = 'multiply'; c.fillStyle = this.fx > 1 ? mg : rgbS(grade.top.map((v, i) => (v + grade.bot[i]) / 2)); c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'lighter';
    if (this.fx > 1 && grade.hazeA > 0.01 && !env.dust) { const hz = c.createLinearGradient(0, 0, 0, this.h * 0.42), hc = grade.haze.map(x => x | 0).join(','); hz.addColorStop(0, 'rgba(' + hc + ',' + (grade.hazeA * (0.5 + 0.5 * (1 - z / 2.6))).toFixed(3) + ')'); hz.addColorStop(1, 'rgba(' + hc + ',0)'); c.fillStyle = hz; c.fillRect(0, 0, this.w, this.h * 0.42); }
    // lights come on at night and in storms; buildings without power stay dark
    const night = Math.max(1 - Math.min(1, sun / 0.25), (env.dust || 0) * 0.7);
    if (night > 0.05) {
      if (!this.glowSp) { this.glowSp = glowSprite(PAL.emit.lamp, PAL.emit.lampOuter); this.beaconSp = glowSprite('255,90,60', '255,40,30'); }
      // bloom: every light is drawn into a quarter-resolution buffer, which is laid over the view additively, twice (tight and wide);
      // the upscale does the blur for free and it costs less than drawing each halo at full resolution
      this.bloomPass(c, glows, beacons, night, z, ox, oy, vis, q);
      c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * ox, this.dpr * oy);
      // red warning beacons on masts, hubs and the spire blink out of step
      c.globalAlpha = 0.9 * night; for (const [bx, by, id] of beacons) { if (!vis(bx, by) || Math.sin(t * 3 + id * 1.7) <= 0.4) continue; c.drawImage(this.beaconSp, bx - 9, by - 9, 18, 18); }
      c.globalAlpha = 1;
      // lit windows shine through the night tint
      if (ARTV.emit && ARTV.emit.length && z > 0.7) { c.globalCompositeOperation = 'source-over'; c.fillStyle = 'rgba(' + PAL.emit.window + ',' + (0.88 * night).toFixed(2) + ')'; c.beginPath(); for (const [ex, ey, ew, eh, sk] of ARTV.emit) { c.moveTo(ex, ey); c.lineTo(ex + ew, ey + sk); c.lineTo(ex + ew, ey + sk + eh); c.lineTo(ex, ey + eh); c.closePath(); } c.fill(); c.globalCompositeOperation = 'lighter'; }
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    c.globalCompositeOperation = 'source-over';
    this.drawWeather(c, t, env);
  },
  // cast shadows that follow the sun: each building's footprint swept away from the light by its height, all in one path,
  // so overlapping shadows never double up; long and soft at dusk, short at noon, thinned by dust
  drawShadows(c, items, sun, tilt, dust) {
    // the sun moves in small steps: the path is rebuilt only when the step, the buildings or the zoom band change
    const ang = 0.42 - Math.round(tilt * 24) / 24 * 0.8, len = 0.85 + Math.round((1 - Math.min(1, sun / 0.6)) * 24) / 24 * 1.6, far = this.cam.z < 1.1, G = this.G;
    const key = ang + '|' + len + '|' + far + '|' + G.buildings.length + '|' + (G.buildings.length ? G.buildings[G.buildings.length - 1].id : 0) + '|' + G.buildings.reduce((a, b) => a + (b.built ? 1 : 0), 0);
    if (this.shKey !== key || this.shG !== G) {
      this.shKey = key; this.shG = G; const vx = Math.cos(ang) * len, vy = Math.sin(ang) * len * 0.62, path = new Path2D(), pts = [];
      for (const b of G.buildings) {
        if (b.mod || !b.built) continue;
        const d = BUILDINGS[b.t]; if (!d || d.line) continue;
        const S = b.s, sp = SHADOW_SPEC[b.t] || (d.dome ? [0.06, S * 15] : null), A = artOf(b.t), ins = sp ? sp[0] : 0.14, H = sp ? sp[1] : Math.min(70, artTop(A, S) * 0.4), bz = this.buildingZ(b);
        if (H <= 0 || (H < 10 && far)) continue;
        const dx = vx * H, dy = vy * H; pts.length = 0;
        for (const [u, w] of [[ins, ins], [S - ins, ins], [S - ins, S - ins], [ins, S - ins]]) { const x = isoX(b.x + u, b.y + w), y = isoY(b.x + u, b.y + w, bz); pts.push([x, y], [x + dx, y + dy]); }
        const hl = hull2d(pts); path.moveTo(hl[0][0], hl[0][1]); for (let i = 1; i < hl.length; i++) path.lineTo(hl[i][0], hl[i][1]); path.closePath();
      }
      this.shPath = path;
    }
    c.fillStyle = 'rgba(' + PAL.shadow + ',' + (0.34 * Math.min(1, sun * 4) * (1 - dust * 0.75)).toFixed(3) + ')'; c.fill(this.shPath);
  },
  // night glow: building lights, lamps and vehicle lights as additive halo sprites in world space (a full-screen blur pass
  // costs too much on phones), a tight warm core plus, on Sharp and Balanced quality, a wide soft halo around big lights
  bloomPass(c, glows, beacons, night, z, ox, oy, vis, q) {
    c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * ox, this.dpr * oy); c.globalCompositeOperation = 'lighter';
    const wide = this.fx > 1 && z < 1, sp = this.glowSp;
    const kz = z > 1.2 ? 0.7 : 1; c.globalAlpha = 0.34 * night; for (const [gx, gy, r0] of glows) { if (!vis(gx, gy)) continue; const r = r0 * kz; c.drawImage(sp, gx - r, gy - r, r * 2, r * 2); }
    if (wide) { c.globalAlpha = 0.12 * night; for (const [gx, gy, r] of glows) { if (r < 40 || !vis(gx, gy)) continue; const R2 = r * 1.9; c.drawImage(sp, gx - R2, gy - R2, R2 * 2, R2 * 2); } }
    if (ARTV.lights) { c.globalAlpha = 0.85 * night; for (const [lx, ly, r, col] of ARTV.lights) { if (!vis(lx, ly)) continue; c.drawImage(tintGlow(col), lx - r, ly - r, r * 2, r * 2); } }
    c.globalAlpha = 1;
  },
  overlayDim(b) {
    const o = this.overlay;
    if (o === 'power') return !(BUILDINGS[b.t].gen || BUILDINGS[b.t].battery || (BUILDINGS[b.t].use && BUILDINGS[b.t].use.power) || BUILDINGS[b.t].dome);
    if (o === 'life') return !(BUILDINGS[b.t].cat === 'life' || BUILDINGS[b.t].dome || (BUILDINGS[b.t].use && BUILDINGS[b.t].use.water));
    if (o === 'drones') return !BUILDINGS[b.t].hub;
    return false;
  },
  drawDeposits(c, vis, t) {
    const G = this.G, z = this.cam.z;
    for (const d of G.deposits) {
      if (d.amount <= 0 || !KC.depKnown(G, d)) continue;
      const D = DEPOSITS[d.type], cx = d.x + 0.5, cy = d.y + 0.5, zz = this.zSmooth(cx, cy), px = isoX(cx, cy), py = isoY(cx, cy, zz);
      if (!vis(px, py)) continue;
      const occupied = d.type !== 'scrap' && d.type !== 'bloom' && G.buildings.some(b => b.dep === d.id);
      drawDepositArt(c, d, D, cx, cy, zz, t, z, occupied);
    }
    for (const a of G.anomalies) {
      if (a.done || !KC.scannedAt(G, a.x, a.y)) continue;
      const zz = this.zSmooth(a.x + 0.5, a.y + 0.5), px = isoX(a.x + 0.5, a.y + 0.5), py = isoY(a.x + 0.5, a.y + 0.5, zz);
      if (!vis(px, py)) continue;
      const pulse = (t * 0.8 + a.id * 0.3) % 1;
      const bm = c.createLinearGradient(0, py - 90, 0, py); bm.addColorStop(0, 'rgba(120,255,230,0)'); bm.addColorStop(1, 'rgba(120,255,230,' + (0.22 + 0.08 * Math.sin(t * 2 + a.id)).toFixed(2) + ')');
      c.fillStyle = bm; c.beginPath(); c.moveTo(px - 3, py - 90); c.lineTo(px + 3, py - 90); c.lineTo(px + 9, py); c.lineTo(px - 9, py); c.closePath(); c.fill();
      c.fillStyle = 'rgba(30,60,56,.35)'; c.beginPath(); c.ellipse(px, py, 13, 6.5, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(140,255,230,.6)'; c.lineWidth = 1; c.setLineDash([3, 3]); c.beginPath(); c.ellipse(px, py, 13, 6.5, 0, 0, 7); c.stroke(); c.setLineDash([]);
      c.strokeStyle = 'rgba(120,255,230,' + (1 - pulse) + ')'; c.lineWidth = 2; c.beginPath(); c.ellipse(px, py, 8 + pulse * 22, (8 + pulse * 22) / 2, 0, 0, 7); c.stroke();
      if (a.kind === 'choir') { for (let k = 0; k < 6; k++) { const ang = k / 6 * 6.283, qx = px + Math.cos(ang) * 16, qy = py + Math.sin(ang) * 8; c.fillStyle = '#26262e'; c.fillRect(qx - 2.5, qy - 22, 5, 22); c.fillStyle = 'rgba(140,255,230,' + (0.5 + 0.5 * Math.sin(t * 3 + k)) + ')'; c.fillRect(qx - 1, qy - 20, 2, 16); } c.fillStyle = 'rgba(140,255,230,.25)'; c.beginPath(); c.ellipse(px, py, 12, 6, 0, 0, 7); c.fill(); }
      else if (a.kind === 'camp') { c.fillStyle = '#5a4a40'; c.beginPath(); c.moveTo(px - 14, py); c.lineTo(px - 4, py - 14); c.lineTo(px + 14, py - 6); c.lineTo(px + 8, py + 4); c.closePath(); c.fill(); c.fillStyle = '#8a7a6a'; c.fillRect(px - 10, py - 4, 6, 4); c.fillStyle = 'rgba(150,220,255,' + (0.4 + 0.4 * Math.sin(t * 1.3)) + ')'; c.beginPath(); c.arc(px + 2, py - 5, 3, 0, 7); c.fill(); }
      else if (a.kind === 'heart') { glow(c, px, py - 6, 26, '150,255,220', 0.35 + 0.15 * Math.sin(t * 1.5)); c.strokeStyle = 'rgba(230,240,220,.85)'; c.lineWidth = 1.2; c.beginPath(); for (let k = 0; k < 7; k++) { const ang = k * 0.9; c.moveTo(px, py - 4); c.quadraticCurveTo(px + Math.cos(ang) * 10, py - 8 + Math.sin(ang) * 3, px + Math.cos(ang) * 20, py + Math.sin(ang) * 9); } c.stroke(); c.fillStyle = '#f2ead6'; c.beginPath(); c.ellipse(px, py - 8, 7, 5, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(140,255,220,' + (0.6 + 0.3 * Math.sin(t * 2)).toFixed(2) + ')'; c.beginPath(); c.ellipse(px, py - 9, 3, 2, 0, 0, 7); c.fill(); }
      else if (a.kind === 'fragment' || a.kind === 'capsule') { c.fillStyle = 'rgba(30,20,14,.55)'; c.beginPath(); c.ellipse(px, py, 18, 9, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,200,140,.5)'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(px, py, 18, 9, 0, Math.PI * 1.05, Math.PI * 1.9); c.stroke(); if (a.kind === 'capsule') { c.fillStyle = '#c9ccd2'; c.beginPath(); c.ellipse(px, py - 6, 7, 9, 0.5, 0, 7); c.fill(); c.fillStyle = 'rgba(190,160,255,' + (0.5 + 0.4 * Math.sin(t * 3)).toFixed(2) + ')'; c.beginPath(); c.arc(px - 1, py - 8, 2.2, 0, 7); c.fill(); } else { c.fillStyle = '#7a7f86'; c.beginPath(); c.moveTo(px - 8, py - 2); c.lineTo(px - 2, py - 14); c.lineTo(px + 9, py - 8); c.lineTo(px + 5, py + 1); c.closePath(); c.fill(); c.strokeStyle = 'rgba(255,230,190,.8)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(px - 4, py - 6); c.lineTo(px + 4, py - 9); c.stroke(); } }
      else if (a.kind === 'warden') { c.fillStyle = '#2a2a33'; c.fillRect(px - 3, py - 26, 6, 26); c.fillStyle = 'rgba(140,255,230,.7)'; c.fillRect(px - 1, py - 24, 2, 20); }
      else { const bob = Math.sin(t * 2 + a.id) * 2.5; glow(c, px, py - 14 + bob, 16, '125,255,224', 0.45); c.fillStyle = '#7dffe0'; c.beginPath(); c.moveTo(px, py - 24 + bob); c.lineTo(px + 7, py - 14 + bob); c.lineTo(px, py - 4 + bob); c.lineTo(px - 7, py - 14 + bob); c.closePath(); c.fill(); c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(px, py - 24 + bob); c.lineTo(px - 7, py - 14 + bob); c.lineTo(px, py - 14 + bob); c.closePath(); c.fill(); c.fillStyle = '#103a34'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.fillText('?', px, py - 10 + bob); }
    }
  },
  drawGrit(c, vis, z) {
    const n = MAP_N, T = this.G._T, a = Math.min(1, (z - 1.1) * 2.5);
    if (!this.grit) { this.grit = []; const r = KC.RNG.fromSeed(this.G.seed + '/grit'); for (let i = 0; i < n * n; i++) { const L = []; const tt = T.terr[i], m = tt === 1 || tt === 2 ? 9 : 6; for (let k = 0; k < m; k++) L.push(r.next(), r.next(), r.next()); this.grit.push(L); } }
    const dk = new Path2D(), lt = new Path2D(), xl = this.screenToWorld(-40, 0)[0], xr = this.screenToWorld(this.w + 40, 0)[0];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const cx = isoX(x + 0.5, y + 0.5); if (cx < xl || cx > xr) continue;
      const cy = isoY(x + 0.5, y + 0.5, this.cz[y][x]); if (!vis(cx, cy)) continue;
      const L = this.grit[y * n + x];
      for (let k = 0; k < L.length; k += 3) { const gx = x + L[k], gy = y + L[k + 1], px = isoX(gx, gy), py = isoY(gx, gy, this.zSmooth(gx, gy)), sz = 0.35 + L[k + 2] * 0.9; (k % 2 ? lt : dk).rect(px, py, sz, sz * 0.6); }
    }
    c.globalAlpha = a; c.fillStyle = 'rgba(38,24,16,.42)'; c.fill(dk); c.fillStyle = 'rgba(255,238,215,.3)'; c.fill(lt); c.globalAlpha = 1;
  },
  // cables and pipes: the geometry of every segment is built once into a few batched paths (shadow, body, core, broken, planned)
  // and rebuilt only when a line changes; a frame is then a handful of strokes
  lineGeo(kind) {
    const G = this.G, n = MAP_N, occ = G._occ, L = G[kind]; let key = 0;
    for (let i = 0; i < L.length; i++) if (L[i]) key = (key * 31 + i * 4 + L[i] + (occ[i] ? 7 : 0)) | 0;
    for (let i = 0; i < occ.length; i += 7) if (occ[i]) key = (key * 17 + i) | 0;
    const cache = (this.lgeo = this.lgeo || {})[kind]; if (cache && cache.key === key && cache.G === G) return cache;
    const off = kind === 'pipe' ? 2.5 : -2.5, sh = new Path2D(), body = new Path2D(), core = new Path2D(), brk = new Path2D(), plan = new Path2D(), sparks = [];
    const conn = (x, y) => x >= 0 && y >= 0 && x < n && y < n && (L[y * n + x] || occ[y * n + x]);
    for (let i = 0; i < L.length; i++) {
      const v = L[i]; if (!v) continue;
      const x = i % n, y = (i / n) | 0, z0 = this.zSmooth(x + 0.5, y + 0.5) + 2, ax = isoX(x + 0.5, y + 0.5) + off, ay = isoY(x + 0.5, y + 0.5, z0), segs = [];
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const xx = x + dx, yy = y + dy; if (!conn(xx, yy)) continue; if ((dx < 0 || dy < 0) && L[yy * n + xx]) continue; const half = L[yy * n + xx] ? 1 : 0.55; const ex = x + 0.5 + dx * half, ey = y + 0.5 + dy * half; segs.push([isoX(ex, ey) + off, isoY(ex, ey, this.zSmooth(ex, ey) + 2)]); }
      if (!segs.length) segs.push([ax + 0.1, ay]);
      const broken = v === 2, planned = v === 3;
      for (const [bx, by] of segs) {
        if (planned) { plan.moveTo(ax, ay); plan.lineTo(bx, by); continue; }
        sh.moveTo(ax, ay + 1.5); sh.lineTo(bx, by + 1.5); body.moveTo(ax, ay); body.lineTo(bx, by);
        const cp = broken ? brk : core; cp.moveTo(ax, ay - 0.5); cp.lineTo(bx, by - 0.5);
      }
      if (broken) sparks.push([ax, ay]);
    }
    return (this.lgeo[kind] = { key, G, sh, body, core, brk, plan, sparks, any: sparks.length > 0 });
  },
  drawLines(c, t, vis) {
    const z = this.cam.z;
    for (const kind of ['pipe', 'cable']) {
      const g = this.lineGeo(kind), pw = kind === 'pipe';
      c.lineCap = z > 1.2 ? 'round' : 'butt';
      if (z > 0.5) { c.strokeStyle = 'rgba(' + PAL.shadow + ',.4)'; c.lineWidth = pw ? 4.5 : 3; c.stroke(g.sh); }
      c.strokeStyle = pw ? '#d6dee2' : '#3a3026'; c.lineWidth = pw ? 3.5 : 2.2; c.stroke(g.body);
      c.strokeStyle = pw ? '#5fb8ff' : '#ffd84a'; c.lineWidth = pw ? 1.2 : 0.9; c.stroke(g.core);
      if (g.any) { c.strokeStyle = '#ff4a3a'; c.stroke(g.brk); }
      c.setLineDash([3, 3]); c.strokeStyle = pw ? 'rgba(160,230,255,.7)' : 'rgba(255,216,74,.7)'; c.lineWidth = 1.5; c.stroke(g.plan); c.setLineDash([]);
      if (g.any && Math.sin(t * 6) > 0) for (const [ax, ay] of g.sparks) { if (!vis(ax, ay)) continue; c.fillStyle = '#ff6a4a'; c.beginPath(); c.arc(ax, ay - 4, 3, 0, 7); c.fill(); if (pw) { c.fillStyle = 'rgba(200,240,255,.6)'; c.beginPath(); c.arc(ax + 3, ay - 8 - (t * 10 % 6), 2, 0, 7); c.fill(); } }
      c.lineCap = 'butt';
    }
  },
  drawNets(c) {
    const G = this.G, n = MAP_N, net = this.overlay === 'power' ? G._cableNet : G._pipeNet; if (!net) return;
    for (let i = 0; i < net.length; i++) {
      const id = net[i]; if (id < 0) continue;
      const x = i % n, y = (i / n) | 0, zz = this.zAt(x, y) + 1;
      const hue = (id * 67 + (this.overlay === 'power' ? 40 : 190)) % 360;
      c.fillStyle = 'hsla(' + hue + ',80%,60%,.28)';
      poly(c, [P(x, y, zz), P(x + 1, y, zz), P(x + 1, y + 1, zz), P(x, y + 1, zz)], c.fillStyle);
    }
  },
  drawCoverage(c) {
    const G = this.G;
    const hubs = KC.hubsOf(G);
    for (const h of hubs) {
      const r = h.r + 0.5, z = this.zSmooth(h.x, h.y);
      poly(c, [P(h.x - r, h.y - r, z), P(h.x + r, h.y - r, z), P(h.x + r, h.y + r, z), P(h.x - r, h.y + r, z)], 'rgba(80,220,255,.08)', 'rgba(120,230,255,.6)', 1.5);
    }
    if (this.ghost && BUILDINGS[this.ghost.type] && BUILDINGS[this.ghost.type].hub) {
      const g = this.ghost, d = BUILDINGS[g.type], r = d.hub.radius + KC.M(G, 'hubRange') + 0.5, cx = g.x + d.size / 2, cy = g.y + d.size / 2, z = this.zSmooth(cx, cy);
      poly(c, [P(cx - r, cy - r, z), P(cx + r, cy - r, z), P(cx + r, cy + r, z), P(cx - r, cy + r, z)], 'rgba(255,210,100,.1)', 'rgba(255,210,100,.8)', 1.5);
    }
  },
  drawDrones(c, t, frac, vis) {
    const G = this.G;
    const srcs = [];
    for (const b of G.buildings) if (!b.mod && b.built && BUILDINGS[b.t].hub) srcs.push({ id: b.id, x: b.x + b.s / 2, y: b.y + b.s / 2, n: b.drones, dt: b._dt || [], z: this.buildingZ(b) + 10 });
    for (const v of G.vehicles) if (v.t === 'crawler') srcs.push({ id: v.id, x: v.x + 0.5, y: v.y + 0.5, n: v.drones, dt: v.path.length ? [] : (v._dt || []), z: this.zSmooth(v.x + 0.5, v.y + 0.5) + 10, moving: v.path.length });
    for (const s of srcs) {
      const hx = isoX(s.x, s.y), hy = isoY(s.x, s.y, s.z);
      if (!vis(hx, hy) && !s.dt.length) continue;
      for (let i = 0; i < s.n; i++) {
        let px, py;
        const task = s.dt[i];
        const ph = (t * 0.22 + i * 0.137 + s.id * 0.071) % 1;
        if (task && !s.moving) {
          const tz = this.zSmooth(task[0], task[1]) + 12, tx = isoX(task[0], task[1]) + Math.sin(i * 3.1) * 8, ty = isoY(task[0], task[1], tz) + Math.cos(i * 2.3) * 4;
          let k; if (ph < 0.35) k = ph / 0.35; else if (ph < 0.65) k = 1; else k = 1 - (ph - 0.65) / 0.35;
          const e = k * k * (3 - 2 * k);
          px = lerp(hx, tx, e) + (k === 1 ? Math.sin(t * 9 + i) * 2 : 0); py = lerp(hy, ty, e) - Math.sin(e * Math.PI) * 18 + (k === 1 ? Math.cos(t * 7 + i) : 0);
          if (k === 1 && task[2] !== 'mine' && Math.sin(t * 20 + i * 5) > 0.6) { c.fillStyle = task[2] === 'repair' || task[2] === 'fix' ? '#ff9a4a' : '#fff4b0'; c.fillRect(px - 1 + Math.random() * 4 - 2, py + 5, 1.5, 1.5); }
        } else {
          const a = t * 0.9 + i * (6.283 / Math.max(1, s.n)); px = hx + Math.cos(a) * 14; py = hy - 8 + Math.sin(a) * 6 + Math.sin(t * 3 + i) * 2;
        }
        if (!vis(px, py)) continue;
        drawDrone(c, px, py, t, i + s.id, task && task[2]);
      }
    }
  },
  drawRockets(c, t, frac) {
    const G = this.G, L = G.buildings.find(b => b.t === 'lander'); if (!L) return;
    const travel = KC.travelTime(G);
    G.rockets.forEach((Rk, i) => {
      let lift = -1, flame = false;
      const rem = Rk.t - frac;
      if (Rk.st === 'out' && rem < 1.2) { lift = Math.max(0, rem) * 520; flame = true; }
      else if (Rk.st === 'landed') lift = 0;
      else if (Rk.st === 'back') { const el = travel - Rk.t + frac; if (el < 1.5) { lift = el * el * 420; flame = true; } }
      if (lift < 0) return;
      const x = L.x + 1.5 + (i ? 0.55 : 0), y = L.y + 1.5 + (i ? -0.55 : 0), z = this.buildingZ(L) + 18;
      if (lift < 60) { const p = P(x, y, z); c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(p[0], p[1], 16, 7, 0, 0, 7); c.fill(); }
      if (flame && lift < 120) for (let k = 0; k < 6; k++) { const p = P(x, y, z), a = Math.random() * 6.28, r = 10 + Math.random() * 30; c.fillStyle = 'rgba(190,150,120,' + (0.25 * (1 - lift / 120)) + ')'; c.beginPath(); c.arc(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r * 0.4, 6 + Math.random() * 8, 0, 7); c.fill(); }
      if (flame && lift > 30) { const p0 = P(x, y, z + lift); (this.trail = this.trail || []).push({ x: p0[0] + (Math.random() - 0.5) * 6, y: p0[1] + 6, t0: t }); if (this.trail.length > 90) this.trail.shift(); }
      drawRocket(c, x, y, z, lift, t, flame);
    });
  },
  drawTrail(c, t) {
    if (!this.trail || !this.trail.length) return;
    this.trail = this.trail.filter(p => t - p.t0 < 4);
    for (const p of this.trail) { const k = (t - p.t0) / 4; c.fillStyle = 'rgba(225,210,195,' + (0.35 * (1 - k)) + ')'; c.beginPath(); c.arc(p.x + k * 18, p.y + k * 6, 4 + k * 16, 0, 7); c.fill(); }
  },
  // colonists walk between home and work around shift changes
  drawWalkers(c, t, frac, vis, sun) {
    const G = this.G; if (!G.colonists.length || this.cam.z < 0.45) return;
    const hr = KC.hourOf(G.tick) + frac, starts = [6, 14, 22], openSky = KC.terraStage(G, 'openair');
    // under the Open Sky, off-shift colonists stroll around the outside of their domes in daylight, no suits
    if (openSky && sun > 0.15) for (const d of G.buildings) {
      if (!d.built || !BUILDINGS[d.t] || !BUILDINGS[d.t].dome || !(d._pop > 0)) continue;
      const cx = d.x + d.s / 2, cy = d.y + d.s / 2; if (!vis(isoX(cx, cy), isoY(cx, cy, 0))) continue;
      for (let k = 0; k < Math.min(6, Math.ceil(d._pop / 6)); k++) { const a = t * 0.05 * (k % 2 ? 1 : -1) + k * 1.9 + d.id, r = d.s * 0.62, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; figure(c, isoX(x, y), isoY(x, y, this.zSmooth(x, y)), SUIT[(k + d.id) % SUIT.length], this.cam.z > 1.3, Math.abs(Math.sin(t * 6 + k)) * 0.8, false); }
    }
    let n = 0;
    for (const col of G.colonists) {
      if (!col.job || !col.home || n > 40) continue;
      const job = KC.bById(G, col.job); if (!job || job.mod) continue;
      const st = starts[col.shift], en = starts[(col.shift + 1) % 3];
      let k = -1, dir = 1;
      const dh = (hr - (st - 1) + 24) % 24; if (dh < 1) k = dh;
      const de = (hr - en + 24) % 24; if (de < 1) { k = de; dir = -1; }
      if (k < 0) continue;
      const home = KC.bById(G, col.home); if (!home) continue;
      const a = KC.center(home), b = KC.center(job), off = ((col.id * 37) % 10) / 10 - 0.5;
      const f = dir > 0 ? k : 1 - k, x = lerp(a.x, b.x, f) + off * 0.6, y = lerp(a.y, b.y, f) - off * 0.6;
      const px = isoX(x, y), py = isoY(x, y, this.zSmooth(x, y));
      if (!vis(px, py)) continue;
      n++;
      figure(c, px, py, SUIT[col.id % SUIT.length], this.cam.z > 1.3, Math.abs(Math.sin(t * 8 + col.id)) * 0.8, !openSky);
      if (sun < 0.2) { glow(c, px - 1, py - 8, 7, '255,240,200', 0.7); }
    }
  },
  addAnim(a) { a.t0 = performance.now() / 1000; if (this.anims.length > 14) this.anims.shift(); this.anims.push(a); },
  drawAnims(c, t) {
    this.anims = this.anims.filter(a => t - a.t0 < (a.dur || 1.6));
    for (const a of this.anims) {
      const k = Math.max(0, t - a.t0), zz = this.zSmooth(a.x + 0.5, a.y + 0.5), px = isoX(a.x + 0.5, a.y + 0.5), py = isoY(a.x + 0.5, a.y + 0.5, zz);
      if (a.k === 'comet') {
        // an ice comet: a long blue-white streak, then a white flash and a rolling ring of steam
        if (k < 1.1) { const f = k / 1.1, sx = px - 380 * (1 - f), sy = py - 640 * (1 - f); const g = c.createLinearGradient(sx - 120, sy - 200, sx, sy); g.addColorStop(0, 'rgba(160,220,255,0)'); g.addColorStop(1, 'rgba(240,250,255,.95)'); c.strokeStyle = g; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(sx - 120, sy - 200); c.lineTo(sx, sy); c.stroke(); c.lineCap = 'butt'; glow(c, sx, sy, 26, '200,235,255', 0.9); }
        else { const f = (k - 1.1) / 2.4; glow(c, px, py - 10, 60 + f * 40, '255,250,240', 0.9 * (1 - f)); c.strokeStyle = 'rgba(235,245,250,' + (0.7 * (1 - f)).toFixed(2) + ')'; c.lineWidth = 6 * (1 - f) + 1; c.beginPath(); c.ellipse(px, py, 20 + f * 140, 10 + f * 70, 0, 0, 7); c.stroke(); for (let j = 0; j < 8; j++) { const ang = j * 0.785, rr = 20 + f * 90; c.fillStyle = 'rgba(230,236,240,' + (0.45 * (1 - f)).toFixed(2) + ')'; c.beginPath(); c.arc(px + Math.cos(ang) * rr, py + Math.sin(ang) * rr * 0.5 - f * 30, 10 + f * 22, 0, 7); c.fill(); } }
      } else if (a.k === 'meteor') {
        if (k < 0.6) { const f = k / 0.6, sx = px + 260 * (1 - f), sy = py - 520 * (1 - f); const g = c.createLinearGradient(sx + 40, sy - 80, sx, sy); g.addColorStop(0, 'rgba(255,160,60,0)'); g.addColorStop(1, 'rgba(255,240,200,.95)'); c.strokeStyle = g; c.lineWidth = 4; c.beginPath(); c.moveTo(sx + 50, sy - 100); c.lineTo(sx, sy); c.stroke(); c.fillStyle = '#fff6d8'; c.beginPath(); c.arc(sx, sy, 4, 0, 7); c.fill(); }
        else { const f = (k - 0.6) / 1.0; c.fillStyle = 'rgba(255,200,120,' + (0.8 * (1 - f)) + ')'; c.beginPath(); c.ellipse(px, py, 10 + f * 50, 5 + f * 25, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(120,95,75,' + (0.6 * (1 - f)) + ')'; for (let j = 0; j < 6; j++) { const ang = j * 1.05; c.beginPath(); c.arc(px + Math.cos(ang) * f * 40, py - Math.abs(Math.sin(ang)) * f * 30, 6 * (1 - f) + 2, 0, 7); c.fill(); } }
      } else if (a.k === 'intercept') {
        const lx = a.lx, ly = a.ly, sy = py - 300;
        c.strokeStyle = 'rgba(255,80,80,' + (1 - k) + ')'; c.lineWidth = 2; c.beginPath(); c.moveTo(lx, ly); c.lineTo(px, sy); c.stroke();
        c.fillStyle = 'rgba(255,220,180,' + (1 - k) + ')'; c.beginPath(); c.arc(px, sy, 6 + k * 20, 0, 7); c.fill();
      } else if (a.k === 'built') {
        c.strokeStyle = 'rgba(255,220,140,' + (1 - k / 1.2) + ')'; c.lineWidth = 2; c.beginPath(); c.ellipse(px, py, 20 + k * 40, 10 + k * 20, 0, 0, 7); c.stroke();
      } else if (a.k === 'skim') {
        // the skimmer lifts off its pad (or settles back onto it) on a column of fire
        const up = a.up, f = clamp(k / a.dur, 0, 1), e = up ? f * f : (1 - f) * (1 - f), lift = e * 520;
        if (lift < 140) for (let j = 0; j < 5; j++) { const ang = j * 1.3 + k * 4, rr = 14 + j * 6; c.fillStyle = 'rgba(200,170,140,' + (0.22 * (1 - lift / 140)).toFixed(2) + ')'; c.beginPath(); c.arc(px + Math.cos(ang) * rr, py + Math.sin(ang) * rr * 0.4, 8 + j * 2, 0, 7); c.fill(); }
        drawSkimmer(c, px, py - 2 - lift, t, true, 1);
      } else if (a.k === 'ping') {
        c.strokeStyle = 'rgba(255,240,160,' + (1 - k / 1.6) + ')'; c.lineWidth = 3; c.beginPath(); c.ellipse(px, py, 10 + k * 30, 5 + k * 15, 0, 0, 7); c.stroke();
      }
    }
  },
  drawFog(c) {
    const G = this.G, key = G.sectors.map(s => s.st).join('');
    if (key !== this.fogKey) {
      this.fogKey = key; const p = new Path2D(), e = new Path2D(), k = MAP_N / SECTOR, cz = this.cz;
      const un = (sx, sy) => sx >= 0 && sy >= 0 && sx < k && sy < k && !G.sectors[sy * k + sx].st;
      const V = (x, y) => [isoX(x, y), isoY(x, y, cz[y][x])];
      for (let si = 0; si < G.sectors.length; si++) {
        if (G.sectors[si].st) continue;
        const sx = si % k, sy = (si / k) | 0, x0 = sx * SECTOR, y0 = sy * SECTOR;
        for (let y = y0; y < y0 + SECTOR; y++) for (let x = x0; x < x0 + SECTOR; x++) {
          const a = V(x, y), b = V(x + 1, y), c2 = V(x + 1, y + 1), d = V(x, y + 1); p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); p.lineTo(c2[0], c2[1]); p.lineTo(d[0], d[1]); p.closePath();
        }
        // the border with surveyed ground, traced along the terrain
        const edge = (ax, ay, dx, dy) => { let q = V(ax, ay); e.moveTo(q[0], q[1]); for (let j = 1; j <= SECTOR; j++) { q = V(ax + dx * j, ay + dy * j); e.lineTo(q[0], q[1]); } };
        if (!un(sx, sy - 1)) edge(x0, y0, 1, 0); if (!un(sx, sy + 1)) edge(x0, y0 + SECTOR, 1, 0); if (!un(sx - 1, sy)) edge(x0, y0, 0, 1); if (!un(sx + 1, sy)) edge(x0 + SECTOR, y0, 0, 1);
      }
      this.fogPath = p; this.fogEdge = e;
    }
    if (!this.fogPat) { const fc = document.createElement('canvas'); fc.width = fc.height = 32; const fx = fc.getContext('2d'); fx.strokeStyle = 'rgba(255,230,200,.07)'; fx.lineWidth = 2; fx.beginPath(); fx.moveTo(-8, 40); fx.lineTo(40, -8); fx.moveTo(-24, 40); fx.lineTo(24, -8); fx.moveTo(8, 40); fx.lineTo(56, -8); fx.stroke(); this.fogPat = c.createPattern(fc, 'repeat'); }
    c.fillStyle = 'rgba(20,12,14,.46)'; c.fill(this.fogPath);
    if (this.cam.z > 0.5) { c.fillStyle = this.fogPat; c.fill(this.fogPath); }
    c.lineJoin = 'round'; c.strokeStyle = 'rgba(20,12,14,.22)'; c.lineWidth = 14; c.stroke(this.fogEdge); c.strokeStyle = 'rgba(20,12,14,.22)'; c.lineWidth = 6; c.stroke(this.fogEdge);
    c.strokeStyle = 'rgba(255,214,150,.5)'; c.lineWidth = 1.2; c.setLineDash([6, 5]); c.stroke(this.fogEdge); c.setLineDash([]); c.lineJoin = 'miter';
  },
  drawSectors(c) {
    const G = this.G, k = MAP_N / SECTOR;
    c.font = 'bold 22px sans-serif'; c.textAlign = 'center';
    for (let si = 0; si < G.sectors.length; si++) {
      const x0 = (si % k) * SECTOR, y0 = ((si / k) | 0) * SECTOR, z = this.zSmooth(x0 + 4, y0 + 4);
      const s = G.sectors[si], q = G.survey.indexOf(si);
      poly(c, [P(x0, y0, z), P(x0 + SECTOR, y0, z), P(x0 + SECTOR, y0 + SECTOR, z), P(x0, y0 + SECTOR, z)], q >= 0 ? 'rgba(255,200,90,.15)' : null, s.st ? 'rgba(255,255,255,.25)' : 'rgba(255,200,120,.6)', 1.5);
      const p = P(x0 + 4, y0 + 4, z + 4);
      c.fillStyle = s.st ? 'rgba(255,255,255,.35)' : '#ffd8a0'; c.fillText(KC.sectorName(si) + (s.st ? '' : q === 0 ? ' ' + Math.round(100 * s.p / KC.surveyCost(G, si)) + '%' : q > 0 ? ' #' + (q + 1) : ' ?'), p[0], p[1]);
    }
  },
  drawDepositLabels(c) {
    const G = this.G; c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
    for (const d of G.deposits) {
      if (d.amount <= 0 || !KC.depKnown(G, d)) continue;
      const z = this.zSmooth(d.x + 0.5, d.y + 0.5), p = P(d.x + 0.5, d.y + 0.5, z + 26);
      const txt = DEPOSITS[d.type].name + ' ' + Math.round(d.amount);
      const w = c.measureText(txt).width + 10;
      c.fillStyle = 'rgba(20,14,12,.85)'; c.fillRect(p[0] - w / 2, p[1] - 12, w, 16);
      c.fillStyle = DEPOSITS[d.type].color; c.fillText(txt, p[0], p[1]);
    }
  },
  // status badges: a dark disc with a coloured ring and the drawn icon (the same icon set as the HUD), cached as sprites
  drawBadges(c, t, vis) {
    const G = this.G, ks = clamp(0.85 / this.cam.z, 1, 2.4);
    for (const b of G.buildings) {
      if (b.mod) continue;
      const st = b._st, ic = BADGE[st]; if (!ic) continue;
      if (st === 'noworkers' && !G.colonists.length) continue;
      const bz = this.buildingZ(b), p = P(b.x + b.s / 2, b.y + b.s / 2, bz + 24 + b.s * 8);
      if (!vis(p[0], p[1])) continue;
      const bob = Math.sin(t * 3 + b.id) * 1.5, r = 9.5 * ks;
      c.drawImage(badgeSprite(st), p[0] - r, p[1] + bob - r, r * 2, r * 2);
    }
  },
  drawSelection(c, t) {
    const G = this.G, s = this.sel; if (!s) return;
    if (s.k === 'b') {
      const b = KC.bById(G, s.id); if (!b || b.mod) return;
      const z = this.buildingZ(b) + 1, a = 0.6 + 0.4 * Math.sin(t * 4);
      poly(c, [P(b.x, b.y, z), P(b.x + b.s, b.y, z), P(b.x + b.s, b.y + b.s, z), P(b.x, b.y + b.s, z)], null, 'rgba(255,210,100,' + a + ')', 2);
      const d = BUILDINGS[b.t];
      const rad = d.hub ? d.hub.radius + KC.M(G, 'hubRange') : d.heat || d.brush || d.lance || d.mast || (d.dome ? d.dome.reach + b.s / 2 : 0);
      if (rad) { const cx = b.x + b.s / 2, cy = b.y + b.s / 2, r = rad + 0.5; poly(c, [P(cx - r, cy - r, z), P(cx + r, cy - r, z), P(cx + r, cy + r, z), P(cx - r, cy + r, z)], 'rgba(255,210,100,.05)', 'rgba(255,210,100,.45)', 1.2); }
    } else if (s.k === 'tile' || s.k === 'a') {
      const z = this.zAt(s.x, s.y) + 1;
      poly(c, [P(s.x, s.y, z), P(s.x + 1, s.y, z), P(s.x + 1, s.y + 1, z), P(s.x, s.y + 1, z)], 'rgba(255,210,100,.2)', 'rgba(255,210,100,.9)', 1.5);
    }
  },
  drawGhost(c, t) {
    const g = this.ghost, G = this.G; if (!g) return;
    if (g.line) {
      for (const [x, y] of g.tiles || []) { const z = this.zAt(x, y) + 2, ok = g.okTiles ? g.okTiles.has(y * MAP_N + x) : g.ok; poly(c, [P(x + 0.15, y + 0.15, z), P(x + 0.85, y + 0.15, z), P(x + 0.85, y + 0.85, z), P(x + 0.15, y + 0.85, z)], ok ? 'rgba(120,255,140,.45)' : 'rgba(255,90,70,.5)'); }
      if (g.start) { const z = this.zAt(g.start[0], g.start[1]) + 3, p = P(g.start[0] + 0.5, g.start[1] + 0.5, z); c.fillStyle = '#ffd36a'; c.beginPath(); c.arc(p[0], p[1], 5, 0, 7); c.fill(); }
      return;
    }
    const d = BUILDINGS[g.type], s = d.size;
    let z = 0; for (let y = g.y; y < g.y + s; y++) for (let x = g.x; x < g.x + s; x++) z = Math.max(z, this.zAt(x, y));
    const col = g.ok ? 'rgba(120,255,140,' : 'rgba(255,90,70,';
    poly(c, [P(g.x, g.y, z + 1), P(g.x + s, g.y, z + 1), P(g.x + s, g.y + s, z + 1), P(g.x, g.y + s, z + 1)], col + '.3)', col + '.95)', 2);
    c.save(); c.globalAlpha = 0.6;
    try { drawBuilding(c, { id: 0, t: g.type, s, built: true, wear: 0, on: true }, g.x, g.y, z, t, { zoom: this.cam.z, sunTilt: 0.3, windAngle: t * 2, mods: d.dome ? [] : null, pop: 0 }); } catch (e) { /* ghost */ }
    c.restore();
    const r = d.heat || d.brush || d.lance || d.mast || (d.dome ? d.dome.reach + s / 2 : 0);
    if (r) { const cx = g.x + s / 2, cy = g.y + s / 2, rr = r + 0.5; poly(c, [P(cx - rr, cy - rr, z), P(cx + rr, cy - rr, z), P(cx + rr, cy + rr, z), P(cx - rr, cy + rr, z)], null, 'rgba(255,220,120,.6)', 1.2); }
  },
  // crater lakes: a flat surface at the shoreline height, deep-to-shallow colour, a foam edge and moving glints
  lakeGeo() {
    const G = this.G, f = KC.lakeFrac(G), T = G._T; if (this.lakes && this.lakes.f === f) return this.lakes;
    this.lakes = { f, list: [] }; if (!f) return this.lakes;
    for (const cr of T.craters) { if (cr.r < 3) continue; const R = cr.r * f, pts = [], N = 40; let zs = 0;
      for (let k = 0; k < N; k++) { const a = k / N * 6.283, rr = R * (1 + 0.07 * Math.sin(a * 3 + cr.x) + 0.04 * Math.sin(a * 7 + cr.y)), x = cr.x + Math.cos(a) * rr, y = cr.y + Math.sin(a) * rr; pts.push([x, y]); zs += this.zSmooth(x, y); }
      const zw = zs / N; this.lakes.list.push({ cr, R, zw, pts: pts.map(([x, y]) => [isoX(x, y), isoY(x, y, zw)]), c: [isoX(cr.x, cr.y), isoY(cr.x, cr.y, zw)] }); }
    return this.lakes;
  },
  // crater lakes are baked into the terrain: a flat surface at the shoreline height, deep-to-shallow colour, a foam edge
  paintLake(c, L) {
    const [cx, cy] = L.c, rx = L.R * TW * 0.72, ry = L.R * TH * 0.72, W = PAL.water, path = () => { c.beginPath(); L.pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); };
    // a dark band of wet sand on the shore, then the water: deep in the middle, shallow at the edge
    path(); c.lineJoin = 'round'; c.strokeStyle = 'rgba(' + W.wetSand + ',.45)'; c.lineWidth = 9; c.stroke(); c.strokeStyle = 'rgba(' + W.wetSand + ',.5)'; c.lineWidth = 4; c.stroke();
    const g = c.createRadialGradient(cx, cy + ry * 0.15, 2, cx, cy, rx); g.addColorStop(0, W.deep); g.addColorStop(0.6, W.mid); g.addColorStop(0.92, W.shallow); g.addColorStop(1, '#7cc0c8');
    c.fillStyle = g; c.fill();
    // the sky reflected on the far half (towards the top of the view), fading to the deep colour near the camera
    c.save(); path(); c.clip();
    const sk = c.createLinearGradient(0, cy - ry * 1.1, 0, cy + ry * 0.3); sk.addColorStop(0, 'rgba(' + W.sky + ',.42)'); sk.addColorStop(1, 'rgba(' + W.sky + ',0)'); c.fillStyle = sk; c.fillRect(cx - rx * 1.4, cy - ry * 1.4, rx * 2.8, ry * 1.8);
    // the reflection of the far shore: a dark rim just inside the top edge
    c.strokeStyle = 'rgba(20,40,50,.25)'; c.lineWidth = 5; c.translate(0, 3); path(); c.stroke();
    c.restore();
    // ripple lines and a sun streak
    c.strokeStyle = 'rgba(230,246,255,.2)'; c.lineWidth = 0.9; for (let k = 0; k < 9; k++) { const wy = cy - ry * 0.7 + k * ry * 0.17, w = (0.25 + ((k * 7) % 5) * 0.09) * rx * Math.sqrt(Math.max(0, 1 - Math.pow((wy - cy) / ry, 2))); c.beginPath(); c.moveTo(cx - w + (k % 3) * 6, wy); c.lineTo(cx + w * 0.6 + (k % 3) * 6, wy); c.stroke(); }
    const ss = c.createLinearGradient(cx - rx * 0.4, 0, cx + rx * 0.4, 0); ss.addColorStop(0, 'rgba(255,248,230,0)'); ss.addColorStop(0.5, 'rgba(255,248,230,.18)'); ss.addColorStop(1, 'rgba(255,248,230,0)'); c.fillStyle = ss; c.beginPath(); c.ellipse(cx + rx * 0.15, cy - ry * 0.25, rx * 0.4, ry * 0.08, -0.12, 0, 7); c.fill();
    // shoreline foam: a bright broken line on the edge and a fainter one just inside
    path(); c.strokeStyle = 'rgba(' + W.foam + ',.75)'; c.lineWidth = 1.6; c.setLineDash([9, 2, 3, 4, 5, 2]); c.stroke(); c.setLineDash([]);
    c.save(); c.translate(cx, cy); c.scale(0.94, 0.92); c.translate(-cx, -cy); path(); c.restore(); c.strokeStyle = 'rgba(' + W.foam + ',.16)'; c.lineWidth = 1; c.setLineDash([4, 6]); c.stroke(); c.setLineDash([]); c.lineJoin = 'miter';
  },
  // a dry earth island with a raised rim, for buildings that stood on a crater floor before it flooded
  paintLevee(c, lv) {
    const [x, y, s] = lv, e = 0.22, zq = (a, b2) => this.zSmooth(a, b2) + 1.5;
    const pts = [[x - e, y - e], [x + s + e, y - e], [x + s + e, y + s + e], [x - e, y + s + e]].map(([a, b2]) => [isoX(a, b2), isoY(a, b2, zq(a, b2))]);
    const path = () => { c.beginPath(); pts.forEach(([a, b2], i) => i ? c.lineTo(a, b2) : c.moveTo(a, b2)); c.closePath(); };
    path(); c.strokeStyle = 'rgba(225,240,235,.55)'; c.lineWidth = 5; c.stroke(); c.strokeStyle = '#5a4232'; c.lineWidth = 3.4; c.stroke(); c.fillStyle = '#8f6c4c'; c.fill();
    c.strokeStyle = '#b08a62'; c.lineWidth = 1.2; c.stroke();
    // the outer face of the embankment, towards the camera
    const fl = pts[3], fr = pts[2], br = pts[1]; c.fillStyle = '#6a4e36'; c.beginPath(); c.moveTo(fl[0], fl[1]); c.lineTo(fr[0], fr[1]); c.lineTo(fr[0], fr[1] + 3); c.lineTo(fl[0], fl[1] + 3); c.closePath(); c.fill();
    c.fillStyle = '#5a4030'; c.beginPath(); c.moveTo(fr[0], fr[1]); c.lineTo(br[0], br[1]); c.lineTo(br[0], br[1] + 3); c.lineTo(fr[0], fr[1] + 3); c.closePath(); c.fill();
  },
  // per frame only a few moving glints on the water, by day and up close
  drawLakes(c, t, z) {
    if (z < 0.6 || this.sunNow < 0.1) return; const LK = this.lakeGeo(); c.strokeStyle = 'rgba(235,248,255,.4)'; c.lineWidth = 1; c.beginPath();
    for (const L of LK.list) { const [cx, cy] = L.c; for (let k = 0; k < 4; k++) { const ph = (t * 0.05 + k / 4) % 1, wy = cy - L.R * TH * 0.4 + ph * L.R * TH * 0.8, w = (6 + (k % 2) * 6) * Math.sin(ph * Math.PI), x0 = cx + Math.sin(t * 0.7 + k) * L.R * 6; c.moveTo(x0 - w, wy); c.lineTo(x0 + w, wy); } }
    c.stroke();
    // twinkling sun glints on the far half of each lake
    c.fillStyle = 'rgba(' + PAL.water.glint + ',.9)'; for (const L of LK.list) { const [cx, cy] = L.c; for (let k = 0; k < 6; k++) { const ph = Math.sin(t * 2.3 + k * 1.7 + L.cr.x); if (ph < 0.6) continue; const gx = cx + Math.sin(k * 2.4 + L.cr.y) * L.R * 12, gy = cy - L.R * TH * 0.3 + Math.cos(k * 1.3) * L.R * 3, r = (ph - 0.6) * 4; c.fillRect(gx - r, gy - 0.4, r * 2, 0.8); c.fillRect(gx - 0.4, gy - r * 0.6, 0.8, r * 1.2); } }
  },
  drawWeather(c, t, env) {
    const dust = env.dust, n = dust ? 260 : 40, w = this.w, h = this.h, G = this.G, TS = G.terra;
    // Reshaping Kessa: the sky over the horizon turns from dusty amber to blue as the Veil thickens, and rain or snow falls
    if (TS && TS.veil > 8) {
      const k = clamp((TS.veil - 8) / 52, 0, 1), blue = clamp((TS.veil - 25) / 40, 0, 1) * clamp(TS.water / 40, 0.3, 1), day = Math.min(1, env.sun * 3), hh = h * 0.3;
      const r = lerp(210, 120, blue), gg = lerp(150, 175, blue), b = lerp(100, 230, blue), hz = c.createLinearGradient(0, 0, 0, hh);
      hz.addColorStop(0, 'rgba(' + (r | 0) + ',' + (gg | 0) + ',' + (b | 0) + ',' + (0.42 * k * (0.35 + 0.65 * day)).toFixed(3) + ')'); hz.addColorStop(1, 'rgba(' + (r | 0) + ',' + (gg | 0) + ',' + (b | 0) + ',0)');
      c.fillStyle = hz; c.fillRect(0, 0, w, hh);
    }
    const sol = KC.solOf(G.tick), hr = KC.hourOf(G.tick), wet = TS && TS.st.rain && !dust && ((sol * 2654435761) >>> 0) % 10 < 3 && hr >= 5 && hr <= 16;
    if (wet) {
      const snow = TS.warm < 40; c.fillStyle = 'rgba(40,52,74,.14)'; c.fillRect(0, 0, w, h);
      // two depths: far flakes or drops are small, dim and slow, near ones larger and faster
      if (snow) { for (const [n0, sz, sp, a0] of [[90, 1.4, 22, 0.55], [50, 2.6, 42, 0.9]]) { c.fillStyle = 'rgba(245,250,255,' + a0 + ')'; for (let k = 0; k < n0; k++) { const x = ((k * 97.3 + Math.sin(t * 0.6 + k) * 20 * sz + t * 14 * sz) % (w + 20)) - 10, y = ((k * 53.7 + sz * 31 + t * (sp + k % 5 * 6)) % (h + 20)) - 10; c.fillRect(x, y, sz, sz); } } }
      else { for (const [n0, len, sp, a0, lw] of [[110, 9, 380, 0.22, 0.8], [60, 18, 620, 0.38, 1.2]]) { c.strokeStyle = 'rgba(200,222,244,' + a0 + ')'; c.lineWidth = lw; c.beginPath(); for (let k = 0; k < n0; k++) { const x = ((k * 97.3 + len * 7 + t * 60) % (w + 40)) - 20, y = ((k * 53.7 + len * 13 + t * (sp + k % 7 * 40)) % (h + 40)) - 20; c.moveTo(x, y); c.lineTo(x - len * 0.28, y + len); } c.stroke(); } }
    }
    // auroras on some clear nights, when charged dust lights the thin upper air: curtains with fine vertical rays
    if (env.sun <= 0.001 && !dust && KC.solOf(G.tick) % 3 === 1) {
      c.globalCompositeOperation = 'lighter';
      for (let band = 0; band < 3; band++) {
        const hue = band === 1 ? '150,96,255' : band === 2 ? '90,220,255' : '80,255,170', y0 = h * (0.06 + band * 0.06), amp = 24 + band * 6, top = x => y0 + Math.sin(x / 70 + t * 0.4 + band * 2) * amp + Math.sin(x / 23 + t * 0.9 + band) * 6, depth = h * (0.16 + band * 0.03);
        const g = c.createLinearGradient(0, y0 - amp, 0, y0 + depth + amp); g.addColorStop(0, 'rgba(' + hue + ',0)'); g.addColorStop(0.6, 'rgba(' + hue + ',' + (0.08 + 0.03 * Math.sin(t * 0.7 + band)).toFixed(3) + ')'); g.addColorStop(0.85, 'rgba(' + hue + ',.14)'); g.addColorStop(1, 'rgba(' + hue + ',0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(0, top(0)); for (let x = 20; x <= w; x += 20) c.lineTo(x, top(x)); for (let x = w; x >= 0; x -= 20) c.lineTo(x, top(x) + depth); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(' + hue + ',.045)'; c.lineWidth = 2; c.beginPath(); for (let x = 3 + band * 5; x < w; x += 9) { const yy = top(x), L = depth * (0.55 + 0.45 * Math.sin(x * 0.37 + t * 1.3 + band)); c.moveTo(x, yy + depth * 0.15); c.lineTo(x, yy + L); } c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
    }
    // static discharges inside dust storms
    if (dust > 0.4) {
      if (!this.bolt && Math.random() < 0.012 * dust) { const x0 = Math.random() * w, pts = [[x0, 0]]; let x = x0, y = 0; while (y < h * (0.4 + Math.random() * 0.4)) { x += (Math.random() - 0.5) * 50; y += 20 + Math.random() * 30; pts.push([x, y]); } this.bolt = { t0: t, pts }; }
      if (this.bolt) { const k = t - this.bolt.t0; if (k > 0.25) this.bolt = null; else { c.fillStyle = 'rgba(255,230,200,' + (0.18 * (1 - k * 4)) + ')'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(190,220,255,' + (0.5 * (1 - k * 4)) + ')'; c.lineWidth = 5; c.beginPath(); this.bolt.pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); c.strokeStyle = 'rgba(255,250,240,' + (1 - k * 4) + ')'; c.lineWidth = 1.6; c.stroke(); } }
    }
    if (dust) {
      // layered storm: a thick far haze at the top of the view thinning towards the camera, two rolling fronts at different speeds,
      // then fast near streaks; visibility falls with severity
      const st = PAL.grade.storm.haze[0]; c.fillStyle = 'rgba(' + st + ',' + (0.12 + 0.28 * dust).toFixed(3) + ')'; c.fillRect(0, 0, w, h);
      if (this.fx > 2) { const hz = c.createLinearGradient(0, 0, 0, h * 0.35); hz.addColorStop(0, 'rgba(' + st + ',' + (0.3 * dust).toFixed(3) + ')'); hz.addColorStop(1, 'rgba(' + st + ',0)'); c.fillStyle = hz; c.fillRect(0, 0, w, h * 0.35); }
      for (const [spd, wd, a0, col] of [[0.05, 0.5, 0.24, '150,98,56']]) { const fx0 = ((t * spd) % 1.5 - 0.25) * w, g = c.createLinearGradient(fx0 - w * wd / 2, 0, fx0 + w * wd / 2, 0); g.addColorStop(0, 'rgba(' + col + ',0)'); g.addColorStop(0.5, 'rgba(' + col + ',' + (a0 * dust).toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + col + ',0)'); c.fillStyle = g; c.fillRect(fx0 - w * wd / 2, 0, w * wd, h); }
    }
    const vx = dust ? 0.25 : 0.03;
    if (dust) {
      c.fillStyle = 'rgba(214,166,116,.4)'; for (let i = 0; i < 160; i++) { const p = this.parts[i], x = ((p.x + t * vx * p.v * 0.6) % 1) * (w + 40) - 20, y = ((p.y + t * 0.008 * p.v + Math.sin(t + i) * 0.003) % 1) * h; c.fillRect(x, y, p.s * 2.2, p.s * 0.6); }
      if (this.fx > 1) { c.strokeStyle = 'rgba(236,196,150,.35)'; c.lineWidth = 1; c.beginPath(); for (let i = 160; i < 220; i++) { const p = this.parts[i], x = ((p.x + t * vx * p.v * 1.8) % 1) * (w + 80) - 40, y = ((p.y + t * 0.02 * p.v) % 1) * h; c.moveTo(x, y); c.lineTo(x + 10 + p.s * 8, y + 1.5); } c.stroke(); }
    } else {
      c.fillStyle = 'rgba(255,230,200,.35)';
      for (let i = 0; i < n; i++) { const p = this.parts[i], x = ((p.x + t * vx * p.v) % 1) * (w + 40) - 20, y = ((p.y + t * 0.01 * p.v + Math.sin(t + i) * 0.003) % 1) * h; c.fillRect(x, y, p.s, p.s); }
    }
    // cold wave: a frosted rim of the view with a few ice glints
    if (env.cold) { if (!this.frostV || this.frostV.width !== Math.ceil(w / 4)) this.frostV = frostVignette(Math.ceil(w / 4), Math.ceil(h / 4)); c.drawImage(this.frostV, 0, 0, w, h); }
  },
  // what is under a screen point: vehicle, building, anomaly, deposit, tile
  pick(sx, sy) {
    const G = this.G;
    for (const v of G.vehicles) { const s = this.worldToScreen(isoX(v.x + 0.5, v.y + 0.5), isoY(v.x + 0.5, v.y + 0.5, this.zSmooth(v.x + 0.5, v.y + 0.5) + 6)); if (Math.hypot(s[0] - sx, s[1] - sy) < 22) return { k: 'v', id: v.id }; }
    const tl = this.screenToTile(sx, sy);
    if (tl.x < 0 || tl.y < 0 || tl.x >= MAP_N || tl.y >= MAP_N) return null;
    // tall buildings: test a little above the ground too
    for (const dz of [0, 18, 36]) { const t2 = dz ? this.screenToTile(sx, sy + dz * this.cam.z) : tl; if (t2.x < 0 || t2.y < 0 || t2.x >= MAP_N || t2.y >= MAP_N) continue; const id = G._occ[t2.y * MAP_N + t2.x]; if (id) return { k: 'b', id }; }
    const a = G.anomalies.find(a => !a.done && Math.abs(a.x - tl.x) <= 0 && Math.abs(a.y - tl.y) <= 0 && KC.scannedAt(G, a.x, a.y));
    if (a) return { k: 'a', id: a.id, x: a.x, y: a.y };
    return { k: 'tile', x: tl.x, y: tl.y };
  },
};
// a soft round light, drawn once and reused for every lamp
function glowSprite(inner, outer) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 1, 32, 32, 32); g.addColorStop(0, 'rgba(' + inner + ',1)'); g.addColorStop(0.35, 'rgba(' + inner + ',.55)'); g.addColorStop(1, 'rgba(' + outer + ',0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); return cv;
}
// building shadow footprints: [inset from the tile edge, casting height in px]; thin masts cast a narrow, long shadow
const SHADOW_SPEC = { solar: [0.1, 7], thinfilm: [0.1, 4], battery: [0.14, 13], wind: [0.44, 44], mast: [0.4, 48], brush: [0.4, 40], lance: [0.12, 14], heater: [0.25, 26],
  airtank: [0.16, 30], watertank: [0.14, 24], hub: [0.25, 18], depot: [0.15, 14], lander: [0.15, 40], condenser: [0.3, 12], spire: [0.5, 110], fieldfarm: [0.1, 4], greenhouse: [0.12, 16], icedrill: [0.3, 30] };
// convex hull of a handful of points (monotone chain)
function hull2d(p) {
  p.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
// a soft glow in any lamp colour, cached
const TINT_GLOW = new Map();
function tintGlow(hex) { let g = TINT_GLOW.get(hex); if (!g) { const v = rgbOf(hex).join(','); g = glowSprite(v, v); TINT_GLOW.set(hex, g); } return g; }
// the night sky behind the map: a fixed field of faint stars, a few of them twinkling (drawn as tiny rects, no full-screen blit)
let STARS = null;
function drawStars(c, w, h, a, t) {
  if (!STARS) { const r = KC.RNG.fromSeed('stars'); STARS = []; for (let i = 0; i < 180; i++) STARS.push([r.next(), r.next(), 0.25 + r.next() * 0.6, r.next() < 0.08 ? 1.6 : 0.9]); }
  c.fillStyle = 'rgb(' + PAL.sky.stars + ')';
  for (let i = 0; i < STARS.length; i++) { const s2 = STARS[i]; c.globalAlpha = a * s2[2] * (i % 7 ? 1 : 0.6 + 0.4 * Math.sin(t * 2 + i)); c.fillRect(s2[0] * w, s2[1] * h, s2[3], s2[3]); }
  c.globalAlpha = 1;
}
// the frosted edge of the view during a cold wave, drawn once at quarter resolution
function frostVignette(w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d'), r = KC.RNG.fromSeed('frost');
  const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72); g.addColorStop(0, 'rgba(' + PAL.frost.lit + ',0)'); g.addColorStop(0.7, 'rgba(190,225,255,.16)'); g.addColorStop(1, 'rgba(' + PAL.frost.lit + ',.42)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(240,250,255,.16)'; c.lineWidth = 0.5; c.beginPath();
  for (let i = 0; i < 70; i++) { const side = i % 4, u = r.next(), x = side === 0 ? u * w : side === 1 ? w - r.next() * 8 : side === 2 ? u * w : r.next() * 8, y = side === 0 ? r.next() * 8 : side === 2 ? h - r.next() * 8 : u * h; let px = x, py = y; c.moveTo(px, py); for (let k = 0; k < 3; k++) { px += (w / 2 - px) * 0.05 + (r.next() - 0.5) * 6; py += (h / 2 - py) * 0.05 + (r.next() - 0.5) * 6; c.lineTo(px, py); } }
  c.stroke(); return cv;
}
// map status badges: icon and ring colour per building state
const BADGE = { nopower: ['power', '#ffcf3a'], nowater: ['water', '#5fb8ff'], noair: ['oxygen', '#bff1ff'], noworkers: ['pop', '#ffb08a'], broken: ['close', '#ff5a4a'], upkeep: ['parts', '#ffb34a'], leaking: ['water', '#ffb34a'], materials: ['sinter', '#ffb34a'], inputs: ['industry', '#ffb34a'], full: ['build', '#bbbbbb'], depleted: ['none', '#aaaaaa'] };
const BADGE_SP = new Map();
function badgeSprite(st) {
  let cv = BADGE_SP.get(st); if (cv) return cv;
  const [icn, col] = BADGE[st], S = 64; cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
  c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.arc(S / 2, S / 2 + 2, 27, 0, 7); c.fill();
  const g = c.createLinearGradient(0, 4, 0, S - 4); g.addColorStop(0, '#2a211b'); g.addColorStop(1, '#120e0b'); c.fillStyle = g; c.beginPath(); c.arc(S / 2, S / 2, 26, 0, 7); c.fill();
  c.strokeStyle = col; c.lineWidth = 4; c.stroke();
  try { drawIcon(c, icn, S / 2 - 17, S / 2 - 17, 34, col); } catch (e) { c.fillStyle = col; c.beginPath(); c.arc(S / 2, S / 2, 8, 0, 7); c.fill(); }
  BADGE_SP.set(st, cv); return cv;
}
