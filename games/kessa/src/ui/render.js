// ===== render.js : camera, terrain cache, world drawing, overlays, effects, picking =====
const TERR_COL = ['#9a7a60', '#7f6857', '#55493f', '#b7c0c2', '#b38d68', '#8b7563'];
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
    this.G = G; this.bz.clear(); this.anims = []; this.fogKey = '';
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
    for (let gy = 0; gy < gn; gy++) for (let gx = 0; gx < gn; gx++) {
      const i = gy * gn + gx, xm = Math.max(0, gx - 1), xp = Math.min(gn - 1, gx + 1), ym = Math.max(0, gy - 1), yp = Math.min(gn - 1, gy + 1);
      const dzdx = (gH[gy * gn + xp] - gH[gy * gn + xm]) / ((xp - xm) / GR), dzdy = (gH[yp * gn + gx] - gH[ym * gn + gx]) / ((yp - ym) / GR);
      const x = gx / GR, y = gy / GR;
      const fx = clamp(x - 0.5, 0, n - 1.001), fy = clamp(y - 0.5, 0, n - 1.001), ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
      let r = 0, g = 0, b = 0;
      const add = (tx, ty, w) => { const k = Math.min(n - 1, ty) * n + Math.min(n - 1, tx), c0 = tcol[T.terr[k]], dk = 1 - T.crater[k] * 0.12; r += c0[0] * w * dk; g += c0[1] * w * dk; b += c0[2] * w * dk; };
      add(ix, iy, (1 - u) * (1 - v)); add(ix + 1, iy, u * (1 - v)); add(ix, iy + 1, (1 - u) * v); add(ix + 1, iy + 1, u * v);
      const lit = clamp(1.04 - 0.011 * (0.9 * dzdx + 1.0 * dzdy) + (gH[i] / HZ - 0.5) * 0.18 + tex.fbm(x * 0.7, y * 0.7, 4) * 0.09, 0.42, 1.5);
      gR[i] = r * lit; gG[i] = g * lit; gB[i] = b * lit * 0.98;
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
        const g = c.createLinearGradient(0, pts[0][1], 0, pts[3][1]); g.addColorStop(0, side ? '#6e5848' : '#5a4739'); g.addColorStop(0.5, side ? '#5a4535' : '#4a392d'); g.addColorStop(1, '#2a1f19');
        poly(c, pts, g);
      }
    }
    // grain, pebbles and dune ripples
    for (let k = 0; k < 9000; k++) {
      const x = rnd.next() * n, y = rnd.next() * n, i = (y | 0) * n + (x | 0), z = this.zSmooth(x, y);
      const px = isoX(x, y), py = isoY(x, y, z), dark = rnd.next() < 0.6;
      c.fillStyle = dark ? 'rgba(40,28,20,' + (0.1 + rnd.next() * 0.18) + ')' : 'rgba(255,235,210,' + (0.06 + rnd.next() * 0.12) + ')';
      const sz = T.terr[i] === 1 || T.terr[i] === 2 ? 1 + rnd.next() * 2.4 : 0.6 + rnd.next() * 1.2;
      c.fillRect(px, py, sz, sz * 0.6);
    }
    for (let k = 0; k < 900; k++) {
      const x = rnd.next() * n, y = rnd.next() * n, i = (y | 0) * n + (x | 0); if (T.terr[i] !== 4) continue;
      const z = this.zSmooth(x, y), px = isoX(x, y), py = isoY(x, y, z);
      c.strokeStyle = 'rgba(255,225,180,.18)'; c.lineWidth = 1; c.beginPath(); c.moveTo(px - 10, py); c.quadraticCurveTo(px, py - 3, px + 10, py + 1); c.stroke();
    }
    for (let k = 0; k < 500; k++) {
      const x = rnd.next() * n, y = rnd.next() * n, i = (y | 0) * n + (x | 0); if (T.terr[i] !== 1 && T.terr[i] !== 5 && T.terr[i] !== 2) continue;
      const z = this.zSmooth(x, y), px = isoX(x, y), py = isoY(x, y, z), r = 2 + rnd.next() * 4;
      c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(px + 2, py + 1, r * 1.2, r * 0.5, 0, 0, 7); c.fill();
      c.fillStyle = shade(TERR_COL[2], 0.15 + rnd.next() * 0.2); c.beginPath(); c.ellipse(px, py - r * 0.4, r, r * 0.7, 0, 0, 7); c.fill();
    }
    // frost in crater floors
    for (let k = 0; k < 1600; k++) {
      const x = rnd.next() * n, y = rnd.next() * n, i = (y | 0) * n + (x | 0); if (T.terr[i] !== 3) continue;
      const z = this.zSmooth(x, y), px = isoX(x, y), py = isoY(x, y, z);
      c.fillStyle = 'rgba(235,245,255,' + (0.15 + rnd.next() * 0.25) + ')'; c.beginPath(); c.ellipse(px, py, 3 + rnd.next() * 6, 1.5 + rnd.next() * 2, 0, 0, 7); c.fill();
    }
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
    const sky = c.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, sun > 0.05 ? '#3b2a22' : '#0d0c14'); sky.addColorStop(1, sun > 0.05 ? '#1a120e' : '#07060a');
    c.fillStyle = sky; c.fillRect(0, 0, this.w, this.h);
    const quake = KC.hazardActive(G, 'quake');
    const sh = quake ? 3 * quake.sev : 0;
    const z = this.cam.z, ox = this.w / 2 - this.cam.x * z + (sh ? (Math.random() - 0.5) * sh * 2 : 0), oy = this.h / 2 - this.cam.y * z + (sh ? (Math.random() - 0.5) * sh * 2 : 0);
    c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * ox, this.dpr * oy);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.terrain, -this.oX, -this.oY);
    // visible tile window (roughly) for culling
    const [w0x, w0y] = this.screenToWorld(-80, -120), [w1x, w1y] = this.screenToWorld(this.w + 80, this.h + 160);
    const vis = (wx, wy) => wx > w0x && wx < w1x && wy > w0y && wy < w1y;
    this.drawDeposits(c, vis, t);
    this.drawLines(c, t, vis);
    if (this.overlay === 'power' || this.overlay === 'life') this.drawNets(c);
    if (this.overlay === 'drones' || (this.ghost && BUILDINGS[this.ghost.type] && BUILDINGS[this.ghost.type].hub)) this.drawCoverage(c);
    // depth-sorted objects
    const items = [];
    for (const b of G.buildings) {
      if (b.mod) continue;
      const cx = isoX(b.x + b.s / 2, b.y + b.s / 2), cy = isoY(b.x + b.s / 2, b.y + b.s / 2, 0);
      if (!vis(cx, cy)) continue;
      items.push({ d: b.x + b.y + b.s * 2, b });
    }
    for (const v of G.vehicles) { const vx = lerp(v.px === undefined ? v.x : v.px, v.x, frac), vy = lerp(v.py === undefined ? v.y : v.py, v.y, frac); items.push({ d: vx + vy + 1.2, v, vx, vy }); }
    items.sort((a, b) => a.d - b.d);
    const glows = [];
    const gl = { sunTilt: clamp((hourF - 12) / 6, -1, 1), windAngle: t * (env.dust ? 6 : 2.5), zoom: z, domeGlow: 1 - sun };
    for (const it of items) {
      if (it.v) { const vz = this.zSmooth(it.vx + 0.5, it.vy + 0.5); drawVehicle(c, it.v, it.vx, it.vy, vz, t, this.sel && this.sel.k === 'v' && this.sel.id === it.v.id); glows.push([isoX(it.vx + 0.5, it.vy + 0.5), isoY(it.vx + 0.5, it.vy + 0.5, vz) - 6, 26]); continue; }
      const b = it.b, d = BUILDINGS[b.t], bz = this.buildingZ(b);
      if (!b.built) { drawSite(c, b, b.x, b.y, b.s, bz, t, b.prog / Math.max(1, d.work)); continue; }
      c.save();
      if (this.overlay !== 'none' && this.overlayDim(b)) c.globalAlpha = 0.45;
      if (d.dome) { const mods = KC.domeModules(G, b); drawDome(c, b, b.x, b.y, b.s, bz, t, Object.assign({ mods, pop: b._pop || 0 }, gl)); glows.push([isoX(b.x + b.s / 2, b.y + b.s / 2), isoY(b.x + b.s / 2, b.y + b.s / 2, bz) - b.s * 6, b.s * 34]); }
      else if (ART[b.t]) { ART[b.t](c, b.x, b.y, b.s, bz, t, b, gl); if (b.t !== 'solar' && b.t !== 'thinfilm' && b.t !== 'battery') glows.push([isoX(b.x + b.s / 2, b.y + b.s / 2), isoY(b.x + b.s / 2, b.y + b.s / 2, bz) - 10, 10 + b.s * 10]); }
      c.restore();
      if (b.broken || (b.on === false)) { const p = P(b.x + b.s / 2, b.y + b.s / 2, bz + 6); c.fillStyle = b.broken ? 'rgba(255,60,40,.25)' : 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(p[0], p[1], b.s * 22, b.s * 11, 0, 0, 7); c.fill(); }
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
    // lighting: dusk/night multiply, then glows
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const dusk = sun > 0 && sun < 0.35 ? 1 - sun / 0.35 : 0;
    let tr = 255, tg = 250, tb = 244;
    if (sun <= 0.001) { tr = 70; tg = 82; tb = 130; }
    else { tr = lerp(255, 235, dusk); tg = lerp(248, 160, dusk); tb = lerp(240, 130, dusk); const n = 1 - Math.min(1, sun / 0.12); tr = lerp(tr, 70, n); tg = lerp(tg, 82, n); tb = lerp(tb, 130, n); }
    if (env.cold) { tr *= 0.9; tg *= 0.96; tb = Math.min(255, tb * 1.1); }
    c.globalCompositeOperation = 'multiply'; c.fillStyle = 'rgb(' + (tr | 0) + ',' + (tg | 0) + ',' + (tb | 0) + ')'; c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'lighter';
    const night = 1 - Math.min(1, sun / 0.25);
    if (night > 0.05) {
      c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * ox, this.dpr * oy);
      for (const [gx, gy, r] of glows) { if (!vis(gx, gy)) continue; const g = c.createRadialGradient(gx, gy, 1, gx, gy, r); g.addColorStop(0, 'rgba(255,190,110,' + 0.32 * night + ')'); g.addColorStop(1, 'rgba(255,150,60,0)'); c.fillStyle = g; c.beginPath(); c.arc(gx, gy, r, 0, 7); c.fill(); }
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    c.globalCompositeOperation = 'source-over';
    this.drawWeather(c, t, env);
  },
  overlayDim(b) {
    const o = this.overlay;
    if (o === 'power') return !(BUILDINGS[b.t].gen || BUILDINGS[b.t].battery || (BUILDINGS[b.t].use && BUILDINGS[b.t].use.power) || BUILDINGS[b.t].dome);
    if (o === 'life') return !(BUILDINGS[b.t].cat === 'life' || BUILDINGS[b.t].dome || (BUILDINGS[b.t].use && BUILDINGS[b.t].use.water));
    if (o === 'drones') return !BUILDINGS[b.t].hub;
    return false;
  },
  drawDeposits(c, vis, t) {
    const G = this.G;
    for (const d of G.deposits) {
      if (d.amount <= 0 || !KC.depKnown(G, d)) continue;
      const D = DEPOSITS[d.type], cx = d.x + 0.5, cy = d.y + 0.5, zz = this.zSmooth(cx, cy), px = isoX(cx, cy), py = isoY(cx, cy, zz);
      if (!vis(px, py)) continue;
      if (d.type === 'scrap') {
        for (let k = 0; k < 4; k++) { const a = k * 1.9 + d.id, ex = px + Math.cos(a) * 7, ey = py + Math.sin(a) * 3; c.fillStyle = k % 2 ? '#c8ced4' : '#8f969c'; c.beginPath(); c.moveTo(ex - 4, ey); c.lineTo(ex, ey - 5); c.lineTo(ex + 5, ey + 1); c.closePath(); c.fill(); }
        continue;
      }
      const occupied = G.buildings.some(b => b.dep === d.id);
      const rr = (d.r + 0.8) * TW * 0.62, al = occupied ? 0.22 : 0.42 + 0.08 * Math.sin(t * 2 + d.id);
      const gd = c.createRadialGradient(px, py, 2, px, py, rr);
      gd.addColorStop(0, D.color); gd.addColorStop(0.6, D.color); gd.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = al; c.fillStyle = gd; c.beginPath(); c.ellipse(px, py, rr, rr / 2, 0, 0, 7); c.fill(); c.globalAlpha = 1;
      if (!occupied) { c.strokeStyle = 'rgba(255,255,255,' + (0.25 + 0.15 * Math.sin(t * 2 + d.id)) + ')'; c.setLineDash([4, 4]); c.lineWidth = 1; c.beginPath(); c.ellipse(px, py, rr * 0.92, rr * 0.46, 0, 0, 7); c.stroke(); c.setLineDash([]); }
      // a few crystals or chunks on the deposit
      for (let k = 0; k < 5; k++) { const a = k * 2.3 + d.id, r = 0.3 + (k % 3) * 0.3, ex = isoX(cx + Math.cos(a) * r, cy + Math.sin(a) * r), ey = isoY(cx + Math.cos(a) * r, cy + Math.sin(a) * r, zz);
        c.fillStyle = shade(D.color, k % 2 ? 0.2 : -0.25);
        if (d.type === 'crystal' || d.type === 'rare') { c.beginPath(); c.moveTo(ex - 3, ey); c.lineTo(ex, ey - 9); c.lineTo(ex + 3, ey); c.fill(); }
        else if (d.type === 'ice') { c.beginPath(); c.ellipse(ex, ey - 1, 5, 2.5, 0, 0, 7); c.fill(); }
        else if (d.type === 'bloom') { c.beginPath(); c.arc(ex, ey - 2, 2.5, 0, 7); c.fill(); }
        else { c.beginPath(); c.moveTo(ex - 4, ey); c.lineTo(ex - 1, ey - 5); c.lineTo(ex + 4, ey); c.fill(); } }
    }
    for (const a of G.anomalies) {
      if (a.done || !KC.scannedAt(G, a.x, a.y)) continue;
      const zz = this.zSmooth(a.x + 0.5, a.y + 0.5), px = isoX(a.x + 0.5, a.y + 0.5), py = isoY(a.x + 0.5, a.y + 0.5, zz);
      if (!vis(px, py)) continue;
      const pulse = (t * 0.8 + a.id * 0.3) % 1;
      c.strokeStyle = 'rgba(120,255,230,' + (1 - pulse) + ')'; c.lineWidth = 2; c.beginPath(); c.ellipse(px, py, 8 + pulse * 22, (8 + pulse * 22) / 2, 0, 0, 7); c.stroke();
      if (a.kind === 'choir') { for (let k = 0; k < 6; k++) { const ang = k / 6 * 6.283, qx = px + Math.cos(ang) * 16, qy = py + Math.sin(ang) * 8; c.fillStyle = '#26262e'; c.fillRect(qx - 2.5, qy - 22, 5, 22); c.fillStyle = 'rgba(140,255,230,' + (0.5 + 0.5 * Math.sin(t * 3 + k)) + ')'; c.fillRect(qx - 1, qy - 20, 2, 16); } c.fillStyle = 'rgba(140,255,230,.25)'; c.beginPath(); c.ellipse(px, py, 12, 6, 0, 0, 7); c.fill(); }
      else if (a.kind === 'warden') { c.fillStyle = '#2a2a33'; c.fillRect(px - 3, py - 26, 6, 26); c.fillStyle = 'rgba(140,255,230,.7)'; c.fillRect(px - 1, py - 24, 2, 20); }
      else { c.fillStyle = '#7dffe0'; c.beginPath(); c.moveTo(px, py - 22); c.lineTo(px + 7, py - 12); c.lineTo(px, py - 2); c.lineTo(px - 7, py - 12); c.closePath(); c.fill(); c.fillStyle = '#103a34'; c.font = 'bold 10px sans-serif'; c.textAlign = 'center'; c.fillText('?', px, py - 8); }
    }
  },
  drawLines(c, t, vis) {
    const G = this.G, n = MAP_N, occ = G._occ;
    for (const [kind, off] of [['pipe', 2.5], ['cable', -2.5]]) {
      const L = G[kind];
      const conn = (x, y) => x >= 0 && y >= 0 && x < n && y < n && (L[y * n + x] || occ[y * n + x]);
      for (let i = 0; i < L.length; i++) {
        const v = L[i]; if (!v) continue;
        const x = i % n, y = (i / n) | 0, z0 = this.zSmooth(x + 0.5, y + 0.5) + 2;
        const ax = isoX(x + 0.5, y + 0.5) + off, ay = isoY(x + 0.5, y + 0.5, z0);
        if (!vis(ax, ay)) continue;
        const segs = [];
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { const xx = x + dx, yy = y + dy; if (!conn(xx, yy)) continue; if ((dx < 0 || dy < 0) && L[yy * n + xx]) continue; const half = L[yy * n + xx] ? 1 : 0.55; const ex = x + 0.5 + dx * half, ey = y + 0.5 + dy * half; segs.push([isoX(ex, ey) + off, isoY(ex, ey, this.zSmooth(ex, ey) + 2)]); }
        if (!segs.length) segs.push([ax + 0.1, ay]);
        const broken = v === 2, planned = v === 3;
        c.lineCap = 'round';
        for (const [bx, by] of segs) {
          if (planned) { c.setLineDash([3, 3]); c.strokeStyle = kind === 'cable' ? 'rgba(255,216,74,.7)' : 'rgba(160,230,255,.7)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); c.setLineDash([]); continue; }
          c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = kind === 'pipe' ? 4.5 : 3; c.beginPath(); c.moveTo(ax, ay + 1.5); c.lineTo(bx, by + 1.5); c.stroke();
          c.strokeStyle = kind === 'cable' ? '#3a3026' : '#cfd8dc'; c.lineWidth = kind === 'pipe' ? 3.5 : 2.2; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
          c.strokeStyle = kind === 'cable' ? (broken ? '#ff4a3a' : '#ffd84a') : (broken ? '#ff4a3a' : '#5fb8ff'); c.lineWidth = kind === 'pipe' ? 1.2 : 0.9; c.beginPath(); c.moveTo(ax, ay - 0.5); c.lineTo(bx, by - 0.5); c.stroke();
        }
        if (broken && Math.sin(t * 6) > 0) { c.fillStyle = '#ff6a4a'; c.beginPath(); c.arc(ax, ay - 4, 3, 0, 7); c.fill(); if (kind === 'pipe') { c.fillStyle = 'rgba(200,240,255,.6)'; c.beginPath(); c.arc(ax + 3, ay - 8 - (t * 10 % 6), 2, 0, 7); c.fill(); } }
      }
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
        c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(px, py + 14, 3, 1.4, 0, 0, 7); c.fill();
        c.fillStyle = '#e8e2d6'; c.beginPath(); c.ellipse(px, py, 3.2, 2, 0, 0, 7); c.fill();
        c.fillStyle = (i + Math.floor(t * 2)) % 3 ? '#4fe0ff' : '#ff8a4a'; c.fillRect(px - 0.8, py - 2.6, 1.6, 1.6);
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
    const hr = KC.hourOf(G.tick) + frac, starts = [6, 14, 22];
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
      c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(px - 1.5, py, 3, 1.2);
      c.fillStyle = ['#ffd27a', '#7fd0ff', '#ff9a8a', '#c0ff9a'][col.id % 4]; c.fillRect(px - 1, py - 5 + Math.abs(Math.sin(t * 8 + col.id)) * 0.8, 2, 5);
      if (sun < 0.2) { c.fillStyle = 'rgba(255,240,200,.9)'; c.fillRect(px - 0.5, py - 6, 1, 1); }
    }
  },
  addAnim(a) { a.t0 = performance.now() / 1000; if (this.anims.length > 14) this.anims.shift(); this.anims.push(a); },
  drawAnims(c, t) {
    this.anims = this.anims.filter(a => t - a.t0 < (a.dur || 1.6));
    for (const a of this.anims) {
      const k = Math.max(0, t - a.t0), zz = this.zSmooth(a.x + 0.5, a.y + 0.5), px = isoX(a.x + 0.5, a.y + 0.5), py = isoY(a.x + 0.5, a.y + 0.5, zz);
      if (a.k === 'meteor') {
        if (k < 0.6) { const f = k / 0.6, sx = px + 260 * (1 - f), sy = py - 520 * (1 - f); const g = c.createLinearGradient(sx + 40, sy - 80, sx, sy); g.addColorStop(0, 'rgba(255,160,60,0)'); g.addColorStop(1, 'rgba(255,240,200,.95)'); c.strokeStyle = g; c.lineWidth = 4; c.beginPath(); c.moveTo(sx + 50, sy - 100); c.lineTo(sx, sy); c.stroke(); c.fillStyle = '#fff6d8'; c.beginPath(); c.arc(sx, sy, 4, 0, 7); c.fill(); }
        else { const f = (k - 0.6) / 1.0; c.fillStyle = 'rgba(255,200,120,' + (0.8 * (1 - f)) + ')'; c.beginPath(); c.ellipse(px, py, 10 + f * 50, 5 + f * 25, 0, 0, 7); c.fill(); c.fillStyle = 'rgba(120,95,75,' + (0.6 * (1 - f)) + ')'; for (let j = 0; j < 6; j++) { const ang = j * 1.05; c.beginPath(); c.arc(px + Math.cos(ang) * f * 40, py - Math.abs(Math.sin(ang)) * f * 30, 6 * (1 - f) + 2, 0, 7); c.fill(); } }
      } else if (a.k === 'intercept') {
        const lx = a.lx, ly = a.ly, sy = py - 300;
        c.strokeStyle = 'rgba(255,80,80,' + (1 - k) + ')'; c.lineWidth = 2; c.beginPath(); c.moveTo(lx, ly); c.lineTo(px, sy); c.stroke();
        c.fillStyle = 'rgba(255,220,180,' + (1 - k) + ')'; c.beginPath(); c.arc(px, sy, 6 + k * 20, 0, 7); c.fill();
      } else if (a.k === 'built') {
        c.strokeStyle = 'rgba(255,220,140,' + (1 - k / 1.2) + ')'; c.lineWidth = 2; c.beginPath(); c.ellipse(px, py, 20 + k * 40, 10 + k * 20, 0, 0, 7); c.stroke();
      } else if (a.k === 'ping') {
        c.strokeStyle = 'rgba(255,240,160,' + (1 - k / 1.6) + ')'; c.lineWidth = 3; c.beginPath(); c.ellipse(px, py, 10 + k * 30, 5 + k * 15, 0, 0, 7); c.stroke();
      }
    }
  },
  drawFog(c) {
    const G = this.G, key = G.sectors.map(s => s.st).join('');
    if (key !== this.fogKey) {
      this.fogKey = key; const p = new Path2D(), k = MAP_N / SECTOR;
      for (let si = 0; si < G.sectors.length; si++) {
        if (G.sectors[si].st) continue;
        const x0 = (si % k) * SECTOR, y0 = ((si / k) | 0) * SECTOR;
        for (let y = y0; y < y0 + SECTOR; y++) for (let x = x0; x < x0 + SECTOR; x++) {
          const cz = this.cz;
          p.moveTo(isoX(x, y), isoY(x, y, cz[y][x])); p.lineTo(isoX(x + 1, y), isoY(x + 1, y, cz[y][x + 1])); p.lineTo(isoX(x + 1, y + 1), isoY(x + 1, y + 1, cz[y + 1][x + 1])); p.lineTo(isoX(x, y + 1), isoY(x, y + 1, cz[y + 1][x])); p.closePath();
        }
      }
      this.fogPath = p;
    }
    c.fillStyle = 'rgba(20,12,14,.42)'; c.fill(this.fogPath);
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
  drawBadges(c, t, vis) {
    const G = this.G;
    const icon = { nopower: ['⚡', '#ffcf3a'], nowater: ['💧', '#5fb8ff'], noair: ['O₂', '#bff1ff'], noworkers: ['☺', '#ffb08a'], broken: ['✖', '#ff5a4a'], upkeep: ['🔧', '#ffb34a'], leaking: ['🔧', '#ffb34a'], materials: ['▦', '#ffb34a'], inputs: ['◇', '#ffb34a'], full: ['■', '#bbbbbb'], depleted: ['∅', '#aaaaaa'] };
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const ks = clamp(0.85 / this.cam.z, 1, 2.4);
    for (const b of G.buildings) {
      if (b.mod) continue;
      const st = b._st; const ic = icon[st]; if (!ic) continue;
      if (st === 'noworkers' && !G.colonists.length) continue;
      const bz = this.buildingZ(b), p = P(b.x + b.s / 2, b.y + b.s / 2, bz + 24 + b.s * 8);
      if (!vis(p[0], p[1])) continue;
      const bob = Math.sin(t * 3 + b.id) * 1.5;
      c.fillStyle = 'rgba(20,14,12,.85)'; c.beginPath(); c.arc(p[0], p[1] + bob, 8 * ks, 0, 7); c.fill(); c.strokeStyle = ic[1]; c.lineWidth = 1.5 * ks; c.stroke();
      c.fillStyle = ic[1]; c.font = 'bold ' + Math.round(9 * ks) + 'px sans-serif'; c.fillText(ic[0], p[0], p[1] + bob + 0.5);
    }
    c.textBaseline = 'alphabetic';
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
    try { if (d.dome) drawDome(c, { id: 0, wear: 0 }, g.x, g.y, s, z, t, null); else if (ART[g.type]) ART[g.type](c, g.x, g.y, s, z, t, null, null); } catch (e) { /* ghost */ }
    c.restore();
    const r = d.heat || d.brush || d.lance || d.mast || (d.dome ? d.dome.reach + s / 2 : 0);
    if (r) { const cx = g.x + s / 2, cy = g.y + s / 2, rr = r + 0.5; poly(c, [P(cx - rr, cy - rr, z), P(cx + rr, cy - rr, z), P(cx + rr, cy + rr, z), P(cx - rr, cy + rr, z)], null, 'rgba(255,220,120,.6)', 1.2); }
  },
  drawWeather(c, t, env) {
    const dust = env.dust, n = dust ? 260 : 40, w = this.w, h = this.h, G = this.G;
    // auroras on some clear nights, when charged dust lights the thin upper air
    if (env.sun <= 0.001 && !dust && KC.solOf(G.tick) % 3 === 1) {
      c.globalCompositeOperation = 'lighter';
      for (let band = 0; band < 3; band++) {
        const g = c.createLinearGradient(0, 0, 0, h * 0.45); const hue = band === 1 ? '140,90,255' : '80,255,170';
        g.addColorStop(0, 'rgba(' + hue + ',0)'); g.addColorStop(0.5, 'rgba(' + hue + ',' + (0.07 + 0.03 * Math.sin(t * 0.7 + band)) + ')'); g.addColorStop(1, 'rgba(' + hue + ',0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(0, h * 0.05);
        for (let x = 0; x <= w; x += 20) c.lineTo(x, h * (0.08 + band * 0.06) + Math.sin(x / 70 + t * 0.4 + band * 2) * 26);
        for (let x = w; x >= 0; x -= 20) c.lineTo(x, h * (0.3 + band * 0.05) + Math.sin(x / 90 + t * 0.3 + band) * 30);
        c.closePath(); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }
    // static discharges inside dust storms
    if (dust > 0.4) {
      if (!this.bolt && Math.random() < 0.012 * dust) { const x0 = Math.random() * w, pts = [[x0, 0]]; let x = x0, y = 0; while (y < h * (0.4 + Math.random() * 0.4)) { x += (Math.random() - 0.5) * 50; y += 20 + Math.random() * 30; pts.push([x, y]); } this.bolt = { t0: t, pts }; }
      if (this.bolt) { const k = t - this.bolt.t0; if (k > 0.25) this.bolt = null; else { c.fillStyle = 'rgba(255,230,200,' + (0.18 * (1 - k * 4)) + ')'; c.fillRect(0, 0, w, h); c.strokeStyle = 'rgba(255,245,230,' + (1 - k * 4) + ')'; c.lineWidth = 2; c.beginPath(); this.bolt.pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); } }
    }
    if (dust) { c.fillStyle = 'rgba(150,100,60,' + (0.12 + 0.3 * dust) + ')'; c.fillRect(0, 0, w, h); }
    const vx = dust ? 0.25 : 0.03;
    c.fillStyle = dust ? 'rgba(220,170,120,.55)' : 'rgba(255,230,200,.35)';
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      const x = ((p.x + t * vx * p.v) % 1) * (w + 40) - 20, y = ((p.y + t * 0.01 * p.v + Math.sin(t + i) * 0.003) % 1) * h;
      if (dust) c.fillRect(x, y, p.s * 3, p.s * 0.8); else c.fillRect(x, y, p.s, p.s);
    }
    if (env.cold) { const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); g.addColorStop(0, 'rgba(180,220,255,0)'); g.addColorStop(1, 'rgba(190,225,255,.28)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }
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
