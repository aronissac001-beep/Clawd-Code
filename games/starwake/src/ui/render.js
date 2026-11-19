// ===== render.js : canvas renderer for the galaxy map and the system view =====
function makeRenderer(canvas) {
  const mainCtx = canvas.getContext('2d'); let ctx = mainCtx;
  const R = { cam: { x: 0, y: 0, z: 0.3 }, mode: 'galaxy', sys: -1, w: 0, h: 0, dpr: 1, dirty: true, anim: null, fx: [], prevCounts: {}, sysZoom: 1, lastShotDay: -1 };
  let starfield = null, glow = null, glowB = 0, terr = null, terrGrid = null, terrKey = '', visKey = '', vis = null, lastG = null;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    R.w = canvas.clientWidth || window.innerWidth; R.h = canvas.clientHeight || window.innerHeight; R.dpr = dpr;
    canvas.width = Math.round(R.w * dpr); canvas.height = Math.round(R.h * dpr);
    starfield = null; R.dirty = true;
  }
  function makeStarfield() {
    const W = Math.ceil(R.w * 1.3), H = Math.ceil(R.h * 1.3), c = Art.mk(W, H), g = c.getContext('2d');
    const gr = g.createRadialGradient(W * 0.3, H * 0.2, 0, W * 0.5, H * 0.5, Math.max(W, H)); gr.addColorStop(0, '#0d0c26'); gr.addColorStop(1, '#03040b'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    for (let i = 0; i < W * H / 900; i++) { const a = Art.hash(i, 1, 9), x = Art.hash(i, 2, 9) * W, y = Art.hash(i, 3, 9) * H; g.fillStyle = `rgba(${200 + a * 55},${210 + a * 45},255,${0.15 + a * 0.6})`; g.fillRect(x, y, a > 0.97 ? 1.6 : 1, a > 0.97 ? 1.6 : 1); }
    starfield = c;
  }
  function makeGlow(G) {
    const B = G.R * 1.2, S = 1024, c = Art.mk(S), g = c.getContext('2d'), k = S / (2 * B);
    g.globalCompositeOperation = 'lighter';
    const core = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.2); core.addColorStop(0, 'rgba(255,220,170,.55)'); core.addColorStop(0.3, 'rgba(200,140,255,.2)'); core.addColorStop(1, 'rgba(60,40,120,0)');
    g.fillStyle = core; g.fillRect(0, 0, S, S);
    for (const s of G.systems) {
      const x = S / 2 + s.x * k, y = S / 2 + s.y * k, r = 34 * k * 2.4;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(120,140,255,.10)'); gr.addColorStop(1, 'rgba(80,60,200,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (const n of G.nebulae) {
      const x = S / 2 + n.x * k, y = S / 2 + n.y * k, r = n.r * k * 1.25;
      for (let i = 0; i < 5; i++) { const ox = (Art.hash(i, 1, n.r) - 0.5) * r * 0.8, oy = (Art.hash(i, 2, n.r) - 0.5) * r * 0.8; const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r * 0.7); gr.addColorStop(0, `hsla(${n.hue + i * 12},80%,55%,.16)`); gr.addColorStop(1, `hsla(${n.hue},80%,40%,0)`); g.fillStyle = gr; g.fillRect(0, 0, S, S); }
    }
    // cloud texture: fractal noise shaped by the nebulae and the galactic disc, added once per game
    { const N = 256, nc = Art.mk(N), ng = nc.getContext('2d'), img = ng.createImageData(N, N), d = img.data, kk = N / (2 * B);
      const hsl = (hh, l) => { const a = 0.75 * Math.min(l, 1 - l), f = n => { const q = (n + hh / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1))); }; return [f(0), f(8), f(4)]; };
      const neb = G.nebulae.map(n => ({ n, rgb: hsl(n.hue, 0.55) })), discA = hsl(232, 0.55), discB = hsl(285, 0.5);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const wx = (i + 0.5) / kk - B, wy = (j + 0.5) / kk - B; let w = 0, rgb = null;
        for (const q of neb) { const dd = hyp(wx - q.n.x, wy - q.n.y) / (q.n.r * 1.45); if (dd < 1 && 1 - dd > w) { w = 1 - dd; rgb = q.rgb; } }
        const disc = Math.max(0, 1 - hyp(wx, wy) / (G.R * 1.08)), nz = Art.fbm(i / 20, j / 20, 31, 4);
        const a = clamp((nz - 0.4) * 2.4, 0, 1) * Math.max(w * 1.1, disc * 0.45); if (a <= 0.01) continue;
        const col = w * 1.1 > disc * 0.45 && rgb ? rgb : (nz > 0.55 ? discB : discA), o = (j * N + i) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = a * 95;
      }
      ng.putImageData(img, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(nc, 0, 0, S, S); }
    glow = c; glowB = B;
  }
  function makeTerritory(G, pid) {
    const B = G.R * 1.2, N = 320, cell = 2 * B / N, P = G.empires[pid];
    const bins = new Map(), bs = 90;
    for (const s of G.systems) { if (s.owner < 0 || !P.known[s.id]) continue; const k = Math.floor(s.x / bs) + ',' + Math.floor(s.y / bs); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(s); }
    const own = new Int16Array(N * N).fill(-1);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -B + (i + 0.5) * cell, y = -B + (j + 0.5) * cell, bx = Math.floor(x / bs), by = Math.floor(y / bs);
      let best = -1, bd = 62 * 62;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const b = bins.get((bx + dx) + ',' + (by + dy)); if (!b) continue; for (const s of b) { const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y); if (d < bd) { bd = d; best = s.owner; } } }
      own[j * N + i] = best;
    }
    const c = Art.mk(N), g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data;
    const rgb = G.empires.map(e => { const n = parseInt(e.color.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const o = own[j * N + i]; if (o < 0) continue;
      let edge = false; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N || own[jj * N + ii] !== o) { edge = true; break; } }
      const q = (j * N + i) * 4, col = rgb[o]; d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2]; d[q + 3] = edge ? 210 : 28;
    }
    // two passes of a 3x3 box blur soften the cell edges into glowing borders
    const tmp = new Uint8ClampedArray(d.length);
    for (let pass = 0; pass < 2; pass++) {
      const src = pass ? tmp : d, dst = pass ? d : tmp;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let r = 0, g2 = 0, b = 0, a = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= N) continue; for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= N) continue; const q = (jj * N + ii) * 4, al = src[q + 3]; r += src[q] * al; g2 += src[q + 1] * al; b += src[q + 2] * al; a += al; n++; } }
        const q = (j * N + i) * 4; if (a > 0) { dst[q] = r / a; dst[q + 1] = g2 / a; dst[q + 2] = b / a; } dst[q + 3] = a / n;
      }
    }
    g.putImageData(img, 0, 0); terr = c;
    terrGrid = { own, N, B, cell }; // kept for the hex lattice drawn over each empire's space when zoomed in
  }
  // which systems the player can currently see fleets in
  function visibility(G, pid) {
    const key = G.day + ':' + G.fleets.length + ':' + (G._ownVer || 0);
    if (key === visKey && vis) return vis;
    vis = new Uint8Array(G.systems.length);
    for (const s of G.systems) if (s.owner === pid) { vis[s.id] = 1; for (const w of s.lanes) vis[w] = 1; }
    for (const f of G.fleets) if (f.owner === pid) { vis[f.sys] = 1; if (f.path.length) vis[f.path[0]] = 1; for (const w of G.systems[f.sys].lanes) vis[w] = 1; }
    for (const e of G.empires) if (e.kind === 'major' && e.id !== pid && SW.rel(G, pid, e.id).treaties.alliance) for (const s of G.systems) if (s.owner === e.id) vis[s.id] = 1;
    visKey = key; return vis;
  }
  R.visible = (G, sid) => visibility(G, UI.pid)[sid] === 1;
  const toS = (x, y) => [(x - R.cam.x) * R.cam.z + R.w / 2, (y - R.cam.y) * R.cam.z + R.h / 2];
  R.toWorld = (sx, sy) => [(sx - R.w / 2) / R.cam.z + R.cam.x, (sy - R.h / 2) / R.cam.z + R.cam.y];
  function fleetPos(G, f, frac) {
    const a = G.systems[f.sys];
    if (f.path.length && (f.prog > 0 || frac > 0) && !f.lockDays) {
      const b = G.systems[f.path[0]], L = Math.max(1, hyp(a.x - b.x, a.y - b.y));
      const t = clamp(f.prog + (frac || 0) * SW.fleetSpeed(G, f) / L, 0, 1);
      return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, Math.atan2(b.y - a.y, b.x - a.x), true];
    }
    return [a.x, a.y, -Math.PI / 2, false];
  }
  R.fleetScreen = (G, f) => { const [x, y, , mv] = fleetPos(G, f, UI.frac || 0); const [sx, sy] = toS(x, y); return mv ? [sx, sy] : slotPos(G, f, sx, sy); };
  // stationary fleets in a system, grouped: three or more armed fleets of one owner share one icon
  function sysItems(G, sid) {
    const key = sid + ':' + G.day + ':' + G.fleets.length;
    R._items = R._items || new Map();
    const c = R._items.get(sid); if (c && c.key === key) return c.items;
    const here = G.fleets.filter(g => g.sys === sid && (!g.path.length || g.prog === 0) && (g.owner === UI.pid || R.visible(G, sid)));
    const items = [], groups = new Map();
    for (const f of here) { const armed = f.kind === 'war' || f.kind === 'monster'; const k = f.owner + (armed ? 'a' : 'c'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); }
    for (const [k, fs] of groups) {
      if (k.endsWith('a') && fs.length >= 3) { const lead = fs.slice().sort((a, b) => pw(G, b) - pw(G, a))[0]; items.push({ fleets: fs, lead }); }
      else for (const f of fs) items.push({ fleets: [f], lead: f });
    }
    R._items.set(sid, { key, items });
    return items;
  }
  function itemOf(G, f) { return sysItems(G, f.sys).find(it => it.fleets.includes(f)); }
  function slotPos(G, f, sx, sy) {
    const items = sysItems(G, f.sys);
    const i = Math.max(0, items.findIndex(it => it.fleets.includes(f))), n = items.length;
    const rad = starPx(G.systems[f.sys]) * 0.55 + 12;
    const a = -Math.PI * 0.75 + (n > 1 ? i * Math.min(0.55, 4.5 / n) : 0);
    return [sx + Math.cos(a) * rad, sy + Math.sin(a) * rad];
  }
  function label(text, x, y, fill) { ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(2,3,10,.9)'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y); }
  // fleet power is cached per game day for drawing
  function pw(G, f) { const c = R._pwc || (R._pwc = new Map()); const k = f.id; const v = c.get(k); if (v && v[0] === G.day && v[2] === f.ships.length) return v[1]; const p = SW.fleetPower(G, f); c.set(k, [G.day, p, f.ships.length]); if (c.size > 4000) c.clear(); return p; }
  R.pw = pw;
  const starPx = s => clamp(R.cam.z * 34, 9, 40) * STAR_TYPES[s.star].r;
  function drawFleetIcon(G, f, x, y, ang, sel) {
    const e = G.empires[f.owner], mine = f.owner === UI.pid;
    const sz = f.kind === 'war' || f.kind === 'monster' ? clamp(5 + Math.log10(1 + pw(G, f)) * 1.6, 6, 12) : 5.5;
    ctx.save(); ctx.translate(x, y);
    if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, sz + 6, 0, 7); ctx.stroke(); }
    if (R.cam.z > 0.75 && f.ships.length) { // close up, fleets show their lead ship: biggest hull, or the monster itself
      const lc = R._lead || (R._lead = new Map()), lk = lc.get(f.id); let L;
      if (lk && lk.day === G.day && lk.n === f.ships.length) L = lk.L; else { const lead = f.kind === 'monster' ? f.ships[0] : f.ships.reduce((a, b) => (shipLook(G, f, b).size > shipLook(G, f, a).size ? b : a), f.ships[0]); L = shipLook(G, f, lead); lc.set(f.id, { day: G.day, n: f.ships.length, L }); if (lc.size > 3000) lc.clear(); }
      const px = clamp(L.size * (f.kind === 'monster' ? 0.75 : 1.05), 14, 34);
      ctx.fillStyle = 'rgba(3,4,12,.55)'; ctx.beginPath(); ctx.arc(0, 0, px * 0.52, 0, 7); ctx.fill();
      ctx.strokeStyle = mine ? 'rgba(255,255,255,.75)' : e.color; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, px * 0.52, 0, 7); ctx.stroke();
      ctx.rotate(L.up ? 0 : ang); ctx.drawImage(L.spr, -px / 2, -px / 2, px, px); ctx.restore();
      if (Settings.get('names') && (f.kind === 'war' || f.kind === 'monster')) { ctx.fillStyle = 'rgba(230,235,255,.8)'; ctx.font = '10px system-ui'; ctx.textAlign = 'left'; ctx.fillText(f.kind === 'monster' ? f.name : fmt(pw(G, f)), x + px * 0.55 + 3, y + 3); }
      return;
    }
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = e.color; ctx.strokeStyle = mine ? '#fff' : 'rgba(0,0,0,.7)'; ctx.lineWidth = mine ? 1.2 : 1;
    ctx.beginPath();
    if (f.kind === 'monster') { if (f.owner === G.crisisId) { for (let k = 0; k < 8; k++) { const r = k % 2 ? sz * 0.5 : sz * 1.2, a = k * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } } else { ctx.moveTo(0, -sz); ctx.lineTo(sz, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz, 0); } }
    else if (f.kind === 'war') { ctx.moveTo(0, -sz * 1.2); ctx.lineTo(sz * 0.9, sz * 0.8); ctx.lineTo(0, sz * 0.35); ctx.lineTo(-sz * 0.9, sz * 0.8); }
    else if (f.kind === 'army') { ctx.rect(-sz * 0.7, -sz * 0.7, sz * 1.4, sz * 1.4); }
    else { ctx.arc(0, 0, sz * 0.75, 0, 7); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (R.cam.z > 0.7 && (f.kind === 'war' || f.kind === 'monster') && Settings.get('names')) { ctx.fillStyle = 'rgba(230,235,255,.75)'; ctx.font = '10px system-ui'; ctx.textAlign = 'left'; ctx.fillText(f.kind === 'monster' ? f.name : fmt(pw(G, f)), x + sz + 4, y + 3); }
  }
  // Static layer: glow, territory, lanes, stars, markers and names, drawn into an offscreen canvas
  // larger than the screen and reused while panning; rebuilt when the zoom settles or the map changes.
  let layer = null; // kept for compatibility with older checks
  const TILE = 512, TILE_CAP = 24;
  let tiles = new Map(), tileZ = 0, tileKey = '', prevTiles = null, prevZ = 0, tileDpr = 0;
  function renderTile(G, tx, ty) {
    const c = Art.mk(Math.round(TILE * R.dpr)), lc = c.getContext('2d'); lc.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    const sw = R.w, sh = R.h, cam = R.cam;
    R.w = TILE; R.h = TILE; R.cam = { x: (tx + 0.5) * TILE / tileZ, y: (ty + 0.5) * TILE / tileZ, z: tileZ }; ctx = lc;
    try { drawStatic(G); } finally { ctx = mainCtx; R.w = sw; R.h = sh; R.cam = cam; }
    R.layerStats.builds++;
    return c;
  }
  // unscaled tiles are drawn at whole device pixels so the browser copies instead of resampling
  function blit(c, sx, sy, k) {
    if (Math.abs(k - 1) < 0.0005) { const d = R.dpr; ctx.drawImage(c, Math.round(sx * d) / d, Math.round(sy * d) / d, TILE, TILE); }
    else ctx.drawImage(c, sx, sy, TILE * k + 0.5, TILE * k + 0.5);
  }
  function drawTileSet(set, zt, z) {
    const k = z / zt, size = TILE * k;
    for (const [id, t] of set) { const sx = (t.tx * TILE / zt - R.cam.x) * z + R.w / 2, sy = (t.ty * TILE / zt - R.cam.y) * z + R.h / 2; if (sx > R.w || sy > R.h || sx + size < 0 || sy + size < 0) continue; blit(t.c, sx, sy, k); }
  }
  // is this tile's area already painted by a tile from the previous set (stale or other zoom)?
  function covered(tx, ty, zt) {
    if (!prevTiles) return false;
    for (const [fx, fy] of [[0.5, 0.5], [0.02, 0.02], [0.98, 0.02], [0.02, 0.98], [0.98, 0.98]]) {
      const wx = (tx + fx) * TILE / zt, wy = (ty + fy) * TILE / zt;
      if (!prevTiles.has(Math.floor(wx * prevZ / TILE) + ',' + Math.floor(wy * prevZ / TILE))) return false;
    }
    return true;
  }
  function drawTiles(G, key, now) {
    const z = R.cam.z, zooming = now - (R.zoomT || 0) < 160;
    if (tileDpr !== R.dpr) { tiles = new Map(); prevTiles = null; tileDpr = R.dpr; tileZ = 0; }
    if (!tileZ) { tileZ = z; tileKey = key; }
    const ratio = z / tileZ;
    if (key !== tileKey || (Math.abs(ratio - 1) > 0.001 && (!zooming || ratio < 0.55 || ratio > 1.8))) {
      if (tiles.size) { prevTiles = tiles; prevZ = tileZ; }
      tiles = new Map(); tileZ = z; tileKey = key;
    }
    const zt = tileZ, k = z / zt, size = TILE * k;
    const x0 = Math.floor(((R.cam.x - R.w / 2 / z) * zt) / TILE), x1 = Math.floor(((R.cam.x + R.w / 2 / z) * zt) / TILE);
    const y0 = Math.floor(((R.cam.y - R.h / 2 / z) * zt) / TILE), y1 = Math.floor(((R.cam.y + R.h / 2 / z) * zt) / TILE);
    const first = !tiles.size && !prevTiles, budget = 5;
    let missing = 0;
    if (prevTiles) drawTileSet(prevTiles, prevZ, z);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const id = tx + ',' + ty; let t = tiles.get(id);
      if (!t) { if (first || performance.now() - now < budget || !covered(tx, ty, zt)) { t = { tx, ty, c: renderTile(G, tx, ty) }; tiles.set(id, t); } else { missing++; continue; } }
      t.used = now;
      const sx = (tx * TILE / zt - R.cam.x) * z + R.w / 2, sy = (ty * TILE / zt - R.cam.y) * z + R.h / 2;
      blit(t.c, sx, sy, k);
    }
    // prefetch a ring around the view while time allows
    if (!missing && !zooming) for (let ty = y0 - 1; ty <= y1 + 1 && performance.now() - now < budget * 0.6; ty++) for (let tx = x0 - 1; tx <= x1 + 1; tx++) { const id = tx + ',' + ty; if (tiles.has(id)) continue; if (performance.now() - now >= budget * 0.6) break; tiles.set(id, { tx, ty, c: renderTile(G, tx, ty), used: now }); }
    if (!missing && prevTiles) prevTiles = null;
    if (tiles.size > TILE_CAP) { const old = Array.from(tiles.entries()).sort((a, b) => (a[1].used || 0) - (b[1].used || 0)); for (let i = 0; i < tiles.size - TILE_CAP; i++) tiles.delete(old[i][0]); }
    R._tilesPending = missing > 0 || Math.abs(z / tileZ - 1) > 0.001 || (!zooming && [...Array(1)].some(() => { for (let ty = y0 - 1; ty <= y1 + 1; ty++) for (let tx = x0 - 1; tx <= x1 + 1; tx++) if (!tiles.has(tx + ',' + ty)) return true; return false; }));
  }
  function staticKey(G, P) {
    let k = 0, sv = 0, sb = 0, an = 0;
    for (const s of G.systems) { if (P.known[s.id]) k++; if (P.surv[s.id]) sv++; if (s.sb) sb += s.sb.lvl + 1; if (s.anom && s.anom.by === UI.pid && !s.anom.done) an++; }
    return [G._ownVer || 0, terrKey, k, sv, sb, an, Settings.get('names') ? 1 : 0, (G.folded || []).length, G.systems.length].join(':');
  }
  function drawStatic(G) {
    const pid = UI.pid, P = G.empires[pid], z = R.cam.z;
    const [gx, gy] = toS(-glowB, -glowB);
    // big full-galaxy layers are sampled only over the visible rectangle, so a tile copies a small piece
    const part = (img) => { const S = img.width, k = S / (glowB * 2 * z), sx = clamp(-gx * k, 0, S), sy = clamp(-gy * k, 0, S), sx1 = clamp((R.w - gx) * k, 0, S), sy1 = clamp((R.h - gy) * k, 0, S);
      if (sx1 - sx < 1 || sy1 - sy < 1) return; ctx.drawImage(img, sx, sy, sx1 - sx, sy1 - sy, gx + sx / k, gy + sy / k, (sx1 - sx) / k, (sy1 - sy) / k); };
    part(glow);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(terr, gx, gy, glowB * 2 * z, glowB * 2 * z);
    if (terrGrid && z > 0.75) { // crisp hex lattice in each owner's color, only over owned space
      const T = terrGrid, r = 15, w = r * Math.sqrt(3), [wx0, wy0] = R.toWorld(-20, -20), [wx1, wy1] = R.toWorld(R.w + 20, R.h + 20), by = new Map();
      for (let row = Math.floor(wy0 / (1.5 * r)); row <= Math.ceil(wy1 / (1.5 * r)); row++) for (let col = Math.floor(wx0 / w) - 1; col <= Math.ceil(wx1 / w); col++) {
        const cx = col * w + (row & 1 ? w / 2 : 0), cy = row * 1.5 * r, i = Math.floor((cx + T.B) / T.cell), j = Math.floor((cy + T.B) / T.cell);
        if (i < 0 || j < 0 || i >= T.N || j >= T.N) continue; const o = T.own[j * T.N + i]; if (o < 0) continue;
        let a = by.get(o); if (!a) by.set(o, a = []); a.push(cx, cy); }
      ctx.globalAlpha = clamp((z - 0.75) * 1.4, 0, 0.32); ctx.lineWidth = 1;
      for (const [o, pts] of by) { ctx.strokeStyle = G.empires[o].color; ctx.beginPath();
        const rr = r * z, HX = [-0.866 * rr, 0, 0.866 * rr, 0.866 * rr], HY = [-0.5 * rr, -rr, -0.5 * rr, 0.5 * rr];
        for (let q = 0; q < pts.length; q += 2) { const sx = (pts[q] - R.cam.x) * z + R.w / 2, sy = (pts[q + 1] - R.cam.y) * z + R.h / 2; ctx.moveTo(sx + HX[0], sy + HY[0]); ctx.lineTo(sx + HX[1], sy + HY[1]); ctx.lineTo(sx + HX[2], sy + HY[2]); ctx.lineTo(sx + HX[3], sy + HY[3]); } // three shared edges per cell draw the whole lattice
        ctx.stroke(); }
      ctx.globalAlpha = 1; }
    const pad = 100, inView = (x, y) => x > -pad && y > -pad && x < R.w + pad && y < R.h + pad;
    ctx.lineWidth = 1;
    ctx.lineWidth = z > 0.6 ? 1.25 : 1; ctx.strokeStyle = 'rgba(140,160,255,.32)'; ctx.beginPath();
    const known = P.known;
    for (const s of G.systems) {
      if (!known[s.id]) continue;
      const [ax, ay] = toS(s.x, s.y);
      for (const w of s.lanes) { if (w < s.id && known[w]) continue; const t = G.systems[w]; const [bx, by] = toS(t.x, t.y); if (!inView(ax, ay) && !inView(bx, by)) continue; ctx.moveTo(ax, ay); ctx.lineTo(bx, by); }
    }
    ctx.stroke();
    if (z > 0.22) {
      const byOwner = new Map();
      for (const s of G.systems) { if (s.owner < 0 || !known[s.id]) continue; for (const w of s.lanes) { if (w < s.id || G.systems[w].owner !== s.owner) continue; let a = byOwner.get(s.owner); if (!a) byOwner.set(s.owner, a = []); a.push(s, G.systems[w]); } }
      ctx.lineWidth = 1.5; ctx.globalAlpha = 0.36;
      for (const [o, segs] of byOwner) { ctx.strokeStyle = G.empires[o].color; ctx.beginPath(); for (let i = 0; i < segs.length; i += 2) { const [ax, ay] = toS(segs[i].x, segs[i].y), [bx, by] = toS(segs[i + 1].x, segs[i + 1].y); if (!inView(ax, ay) && !inView(bx, by)) continue; ctx.moveTo(ax, ay); ctx.lineTo(bx, by); } ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
    if (G.folded) { ctx.strokeStyle = 'rgba(110,214,255,.7)'; ctx.setLineDash([4, 4]); ctx.beginPath(); for (const [a, b] of G.folded) { if (!known[a] && !known[b]) continue; const [ax, ay] = toS(G.systems[a].x, G.systems[a].y), [bx, by] = toS(G.systems[b].x, G.systems[b].y); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); } ctx.stroke(); ctx.setLineDash([]); }
    for (const s of G.systems) {
      const [x, y] = toS(s.x, s.y); if (!inView(x, y)) continue;
      if (!known[s.id]) { ctx.fillStyle = 'rgba(160,170,220,.35)'; ctx.fillRect(x - 1, y - 1, 2, 2); continue; }
      const sp = starPx(s), ds = z > 0.4 ? sp * 0.85 : sp;
      ctx.drawImage(Art.star(s.star), x - ds, y - ds, ds * 2, ds * 2);
      if (s.owner >= 0) {
        const col = G.empires[s.owner].color;
        if (s.sb && s.sb.lvl > (z < 0.7 ? 1 : 0)) { ctx.strokeStyle = col; ctx.globalAlpha = 0.85; ctx.lineWidth = 1.2; ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6, r = sp * 0.42 + 3; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.stroke(); ctx.globalAlpha = 1; }
        if ((z > 0.45 || s.owner === UI.pid) && s.planets.some(id => G.planets[id].col)) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + sp * 0.4 + 3, y - sp * 0.4 - 3, 3.2, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.stroke(); }
      }
      if (s.special === 'beacon') { ctx.fillStyle = '#9ee9ff'; ctx.beginPath(); const bx = x - sp * 0.5 - 4, by = y - sp * 0.5 - 4; ctx.moveTo(bx, by - 5); ctx.lineTo(bx + 3, by); ctx.lineTo(bx, by + 5); ctx.lineTo(bx - 3, by); ctx.fill(); }
      if (s.anom && s.anom.by === pid && !s.anom.done) { ctx.fillStyle = '#c99bff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', x - sp * 0.5 - 2, y + sp * 0.5 + 8); }
      if (P.surv[s.id] === 0 && z > 0.35) { ctx.strokeStyle = 'rgba(200,200,255,.25)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, sp * 0.5 + 2, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (Settings.get('names') && showName(G, P, s, z)) drawName(G, s, x, y, sp, z);
    }
  }
  const showName = (G, P, s, z) => z > 0.78 || (z > 0.55 && (s.owner < 0 || s.owner === UI.pid || s.special)) || (z > 0.36 && s.planets.some(id => G.planets[id].col) && P.surv[s.id]) || (z > 0.18 && s.planets.some(id => G.planets[id].home && G.planets[id].col));
  function drawName(G, s, x, y, sp, z) { const home = s.planets.some(id => G.planets[id].home && G.planets[id].col); ctx.font = (s.owner >= 0 ? (home ? '700 ' : '600 ') : '500 ') + (z > 0.9 ? 12.5 : home && z < 0.5 ? 12 : 11) + 'px system-ui'; ctx.textAlign = 'center'; label(home && z < 0.5 ? s.name.toUpperCase() : s.name, x, y + sp * 0.45 + 13, s.owner >= 0 ? nameCol(G.empires[s.owner].color) : 'rgba(214,219,248,.88)'); }
  // empire colors are lifted toward white for names so dark hues stay readable on space
  const nameColC = {}; function nameCol(c) { if (nameColC[c]) return nameColC[c]; const n = parseInt(c.slice(1), 16), m = (v) => Math.round(v + (255 - v) * 0.28); return (nameColC[c] = `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`); }
  R.layerStats = { builds: 0 };
  function drawGalaxy(G, frac) {
    const pid = UI.pid, P = G.empires[pid];
    if (!starfield) makeStarfield();
    if (lastG !== G) { glow = null; terr = null; terrKey = ''; lastG = G; layer = null; tiles = new Map(); prevTiles = null; tileZ = 0; }
    if (!glow) makeGlow(G);
    const tk = (G._ownVer || 0) + ':' + Math.floor(G.day / 30) + ':' + G.systems.length;
    if (tk !== terrKey && (!terr || performance.now() - (R.terrT || 0) > 1500)) { makeTerritory(G, pid); terrKey = tk; R.terrT = performance.now(); }
    const z = R.cam.z, now = performance.now();
    ctx.drawImage(starfield, -((R.cam.x * 0.03) % (R.w * 0.3) + R.w * 0.15), -((R.cam.y * 0.03) % (R.h * 0.3) + R.h * 0.15));
    // static layer in 256px tiles: cached, rebuilt a few per frame within a time budget,
    // with the previous tile set (older content or zoom) drawn underneath until replaced
    drawTiles(G, staticKey(G, P), now);
    const pad = 60, inView = (x, y) => x > -pad && y > -pad && x < R.w + pad && y < R.h + pad;
    const known = P.known;
    // selected fleet route
    const sf = UI.selFleet != null ? SW.fleetById(G, UI.selFleet) : null;
    if (sf && sf.path.length) {
      ctx.strokeStyle = sf.owner === pid ? 'rgba(120,230,255,.9)' : 'rgba(255,140,140,.8)'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.beginPath();
      const [fx, fy] = fleetPos(G, sf, frac); let [px, py] = toS(fx, fy); ctx.moveTo(px, py);
      for (const sid of sf.path) { const [x, y] = toS(G.systems[sid].x, G.systems[sid].y); ctx.lineTo(x, y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    // battles and the selection ring
    const v = visibility(G, pid);
    const fight = G._fight || {};
    for (const sid in fight) { const s = G.systems[sid]; if (!v[sid] || !known[sid]) continue; const [x, y] = toS(s.x, s.y); if (!inView(x, y)) continue; const sp = starPx(s), pulse = 0.5 + 0.5 * Math.sin(now / 150); ctx.strokeStyle = `rgba(255,90,110,${0.4 + pulse * 0.5})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, sp * 0.6 + 6 + pulse * 3, 0, 7); ctx.stroke(); }
    if (UI.selSys != null && known[UI.selSys]) {
      const s = G.systems[UI.selSys], [x, y] = toS(s.x, s.y), sp = starPx(s);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; const r = sp * 0.55 + 8; ctx.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + (R.still ? 0 : now / 900); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.arc(x, y, r, a, a + 0.9); } ctx.stroke();
      if (Settings.get('names') && !showName(G, P, s, z)) drawName(G, s, x, y, sp, z);
    }
    // fleets
    for (const f of G.fleets) {
      if (f.owner !== pid && !v[f.sys] && !(f.path.length && v[f.path[0]])) continue;
      if (!known[f.sys]) continue;
      const [wx, wy, ang, moving] = fleetPos(G, f, frac);
      let [x, y] = toS(wx, wy); if (!inView(x, y)) continue;
      let grp = 1;
      if (!moving) { const it = itemOf(G, f); if (it && it.lead !== f) continue; grp = it ? it.fleets.length : 1; [x, y] = slotPos(G, f, x, y); }
      drawFleetIcon(G, f, x, y, moving ? ang : -Math.PI / 2, UI.selFleet === f.id || (grp > 1 && itemOf(G, f).fleets.some(g => g.id === UI.selFleet)));
      if (grp > 1) { ctx.fillStyle = '#05060f'; ctx.beginPath(); ctx.arc(x + 9, y + 8, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText(grp, x + 9, y + 11); }
    }
  }
  // ---------- system view ----------
  function sysLayout(G, s) {
    const tops = s.planets.map(id => G.planets[id]).filter(p => p.moonOf < 0);
    const maxR = Math.max(120, ...tops.map(p => p.r)) + 30;
    const k = Math.min(R.w * 0.46, (R.h - R.topPad - R.botPad) * 0.8) / maxR * R.sysZoom;
    return { k, cx: R.w / 2, cy: (R.topPad + R.h - R.botPad) / 2 - (UI.selPlanet != null || UI.selFleet != null ? R.h * 0.12 : 0), maxR };
  }
  function planetPos(G, p, L, t) {
    if (p.moonOf >= 0) { const par = G.planets[p.moonOf], [px, py] = planetPos(G, par, L, t); const a = p.ang + t * 0.06; return [px + Math.cos(a) * p.r * L.k * 0.9, py + Math.sin(a) * p.r * L.k * 0.5]; }
    const a = p.ang + t * 0.012 * Math.pow(60 / p.r, 1.5);
    return [L.cx + Math.cos(a) * p.r * L.k, L.cy + Math.sin(a) * p.r * L.k * 0.62];
  }
  const planetPx = (p, L) => clamp((PLANET_TYPES[p.type].big ? 38 : 13 + p.size * 1.15) * L.k * (p.moonOf >= 0 ? 0.45 : 1), 6, 54);
  function fleetAnchor(G, f, L, i, n) { const a = -Math.PI * 0.15 + i * (Math.PI * 1.4 / Math.max(1, n)); return [L.cx + Math.cos(a) * L.maxR * 0.42 * L.k, L.cy + Math.sin(a) * L.maxR * 0.42 * L.k * 0.56 - 10]; }
  function shipPositions(G, f, ax, ay, gap) {
    const out = []; const n = f.ships.length, dx = gap || 9, dy = (gap || 9) * 0.78;
    for (let i = 0; i < n; i++) { const row = Math.floor(Math.sqrt(i)), col = i - row * row; out.push([ax - row * dx + col * dx - (col > row ? (col - row) * dx : 0), ay + row * dy - (col > row ? (col - row) * dy : 0)]); }
    return out;
  }
  const sysFleets = (G, s) => G.fleets.filter(f => f.sys === s.id && (!f.path.length || f.prog === 0) && (f.owner === UI.pid || R.visible(G, s.id)));
  // ships are cached sprites per hull and color; flames and damage are added live
  const HULL_PX = { picket: 15, lancer: 19, warden: 25, monarch: 34, surveyor: 14, builder: 14, colony: 16, army: 14 };
  function shipLook(G, f, sh) {
    const e = G.empires[f.owner];
    if (sh.m) { const M = MONSTERS[sh.m]; return { spr: Art.monster(sh.m), size: clamp(14 + M.size * 1.3, 16, 64), max: M.hull, hull: null, up: sh.m === 'hollow_spire' }; }
    if (typeof sh.d === 'string') return { spr: Art.ship('army', e.color), size: HULL_PX.army, max: 0, hull: 'army' };
    const k = f.owner + ':' + sh.d, c = R._dm || (R._dm = new Map()); let v = c.get(k);
    if (!v) { const d = SW.designById(e, sh.d); v = { hull: d ? d.hull : 'picket', max: d ? SW.designStats(G, e, d).hull : 0 }; c.set(k, v); if (c.size > 3000) c.clear(); }
    return { spr: Art.ship(v.hull, e.color), size: HULL_PX[v.hull] || 15, max: v.max, hull: v.hull };
  }
  function drawShip(G, f, sh, x, y, ang, now) {
    const L = shipLook(G, f, sh), sz = L.size;
    ctx.save(); ctx.translate(x, y); ctx.rotate(L.up ? 0 : ang);
    if (L.hull && !R.still) { // engine flames flicker
      const eng = Art.SHIP_ENGINES[L.hull], gl = Art.glow('rgba(110,200,255,.85)'); ctx.globalCompositeOperation = 'lighter';
      eng.forEach(([ex, ey, es], i) => { const fl = es * sz * (2.6 + 0.5 * Math.sin(now / 70 + i * 2.1 + f.id)); ctx.drawImage(gl, ex * sz - fl * 1.1, ey * sz - fl * 0.45, fl * 1.3, fl * 0.9); });
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(L.spr, -sz / 2, -sz / 2, sz, sz);
    if (L.max && sh.hp < L.max * 0.55) { // damage: smoke and fire on the hull
      const k = 1 - sh.hp / L.max, fl = 0.6 + 0.4 * Math.sin(now / 55 + f.id * 3 + (sh.d || 0));
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, k * 1.3) * fl; ctx.drawImage(Art.glow('rgba(255,120,40,.9)'), -sz * 0.15, -sz * 0.2, sz * 0.32, sz * 0.32); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (k > 0.7) { ctx.fillStyle = 'rgba(40,40,46,.55)'; ctx.beginPath(); ctx.arc(-sz * 0.25, -sz * 0.18, sz * 0.12, 0, 7); ctx.fill(); }
    }
    ctx.restore();
  }
  // labels in the system view: each tries below, above, right and left of its body and takes the first spot that
  // overlaps nothing placed before it (selected and colonized worlds first); minor labels give way rather than overlap
  function placeTags(tags, L) {
    const boxes = [], hit = b => boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    for (const p of R._planetHits || []) boxes.push({ x: p.x - p.r * 0.7, y: p.y - p.r * 0.7, w: p.r * 1.4, h: p.r * 1.4 });
    tags.sort((a, b) => a.prio - b.prio);
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    for (const t of tags) {
      let w = 0; for (const [txt, font] of t.lines) { ctx.font = font; w = Math.max(w, ctx.measureText(txt).width); }
      const hh = t.lines.length * 12 + 2, gap = 5;
      const below = [t.x - w / 2, t.y + t.r + gap], above = [t.x - w / 2, t.y - t.r - gap - hh], right = [t.x + t.r + gap + 2, t.y - hh / 2], left = [t.x - t.r - gap - 2 - w, t.y - hh / 2];
      const cands = t.up ? [above, below, right, left] : [below, above, right, left];
      let spot = null; for (const [bx, by] of cands) { const b = { x: bx - 2, y: by, w: w + 4, h: hh }; if (b.x < 2 || b.x + b.w > R.w - 2 || b.y < R.topPad || b.y + b.h > R.h - R.botPad) continue; if (!hit(b)) { spot = b; break; } }
      if (!spot) { if (t.prio > 2) continue; const [bx, by] = cands[0]; spot = { x: bx - 2, y: by, w: w + 4, h: hh }; }
      boxes.push(spot);
      t.lines.forEach(([txt, font, col], i) => { ctx.font = font; label(txt, spot.x + spot.w / 2, spot.y + 10 + i * 12, col); });
    }
  }
  function drawSystem(G, frac) {
    const s = G.systems[R.sys], P = G.empires[UI.pid];
    if (!starfield) makeStarfield();
    ctx.drawImage(starfield, -R.w * 0.15, -R.h * 0.15);
    const L = sysLayout(G, s), t = G.day + frac, now = performance.now();
    // nebula tint
    if (s.nebula) { if (!R._sysNeb || R._sysNeb.id !== s.id || R._sysNeb.w !== R.w) { const n0 = G.nebulae.find(q => hyp(q.x - s.x, q.y - s.y) < q.r) || { hue: 260 }; R._sysNeb = { id: s.id, w: R.w, c: Art.scene('nebula_' + n0.hue, Math.round(R.w / 2), Math.round(R.h / 2), s.id + 3) }; } ctx.globalAlpha = 0.55; ctx.drawImage(R._sysNeb.c, 0, 0, R.w, R.h); ctx.globalAlpha = 1; }
    if (s.nebula) { const n = G.nebulae.find(q => hyp(q.x - s.x, q.y - s.y) < q.r) || { hue: 260 }; const gr = ctx.createRadialGradient(L.cx * 0.6, L.cy * 0.7, 0, L.cx, L.cy, R.w); gr.addColorStop(0, `hsla(${n.hue},70%,40%,.25)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, R.w, R.h); }
    // star and its light
    { const gl = STAR_TYPES[s.star].glow; const gr = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(R.w, R.h) * 0.7); gr.addColorStop(0, gl + '33'); gr.addColorStop(0.4, gl + '10'); gr.addColorStop(1, gl + '00'); ctx.fillStyle = gr; ctx.fillRect(0, 0, R.w, R.h); }
    const sp = 38 * STAR_TYPES[s.star].r * clamp(L.k * 1.2, 0.6, 1.4);
    ctx.globalAlpha = 0.5; ctx.drawImage(Art.star(s.star, true), L.cx - sp * 2.2, L.cy - sp * 2.2, sp * 4.4, sp * 4.4); ctx.globalAlpha = 1;
    { // each star type has its own corona
      const st = s.star, gl = STAR_TYPES[st].glow, tt = R.still ? 0 : now;
      ctx.save(); ctx.translate(L.cx, L.cy); ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
      if (st === 'hole') {
        ctx.save(); ctx.scale(1, 0.32); ctx.rotate(tt / 3000);
        for (let k = 0; k < 5; k++) { ctx.strokeStyle = k % 2 ? 'rgba(255,170,110,.32)' : 'rgba(255,230,190,.45)'; ctx.lineWidth = 3 + k; ctx.beginPath(); ctx.arc(0, 0, sp * (1.05 + k * 0.22), k * 0.7, k * 0.7 + 4.2); ctx.stroke(); }
        ctx.restore(); ctx.strokeStyle = 'rgba(200,160,255,.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, sp * 0.62, 0, 7); ctx.stroke();
      } else if (st === 'neutron') { // two sweeping beams
        ctx.rotate(tt / 900); for (const sg of [1, -1]) { const bg = ctx.createLinearGradient(0, 0, 0, sg * sp * 4); bg.addColorStop(0, 'rgba(160,240,255,.55)'); bg.addColorStop(1, 'rgba(160,240,255,0)'); ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(-sp * 0.12, 0); ctx.lineTo(-sp * 0.5, sg * sp * 4); ctx.lineTo(sp * 0.5, sg * sp * 4); ctx.lineTo(sp * 0.12, 0); ctx.fill(); }
      } else if (st === 'red') { // slow prominence loops
        ctx.strokeStyle = gl; for (let k = 0; k < 3; k++) { const a = k * 2.1 + tt / 15000, r0 = sp * 0.5; ctx.globalAlpha = 0.12 + 0.06 * Math.sin(tt / 900 + k); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(Math.cos(a) * r0, Math.sin(a) * r0, sp * 0.16, a + Math.PI * 0.9, a + Math.PI * 2.1); ctx.stroke(); }
        const rg = ctx.createRadialGradient(0, 0, sp * 0.4, 0, 0, sp * 1.5); rg.addColorStop(0, 'rgba(255,90,70,.18)'); rg.addColorStop(1, 'rgba(255,60,40,0)'); ctx.globalAlpha = 1; ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, sp * 1.5, 0, 7); ctx.fill();
      } else if (st === 'blue' || st === 'white') { // long thin spikes and a lens ring
        ctx.rotate(tt / 20000); ctx.strokeStyle = gl;
        for (let k = 0; k < (st === 'blue' ? 16 : 8); k++) { const a = k * Math.PI * 2 / (st === 'blue' ? 16 : 8), len = sp * (st === 'blue' ? 2.4 : 1.8) * (k % 2 ? 0.6 : 1); ctx.globalAlpha = 0.18; ctx.lineWidth = k % 2 ? 1 : 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * sp * 0.4, Math.sin(a) * sp * 0.4); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke(); }
        ctx.globalAlpha = 0.16; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, sp * 1.6, 0, 7); ctx.stroke();
      } else { // yellow and orange: soft rays that breathe
        ctx.rotate(tt / 9000); ctx.strokeStyle = gl; const n = st === 'orange' ? 9 : 12;
        for (let k = 0; k < n; k++) { const a = k * Math.PI * 2 / n, len = sp * (1.3 + 0.35 * Math.sin(tt / 700 + k * 1.7)); ctx.globalAlpha = 0.13; ctx.lineWidth = st === 'orange' ? 4.5 : 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * sp * 0.5, Math.sin(a) * sp * 0.5); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke(); }
      }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    ctx.drawImage(Art.star(s.star, true), L.cx - sp * 1.15, L.cy - sp * 1.15, sp * 2.3, sp * 2.3);
    // orbits
    ctx.strokeStyle = 'rgba(150,170,255,.2)'; ctx.lineWidth = 1;
    const surveyed = P.surv[s.id] === 1;
    for (const id of s.planets) { const p = G.planets[id]; if (p.moonOf >= 0) continue; if (p.col) { ctx.save(); ctx.strokeStyle = G.empires[p.col.owner].color; ctx.globalAlpha = 0.32; ctx.lineWidth = 1.4; } ctx.beginPath(); ctx.ellipse(L.cx, L.cy, p.r * L.k, p.r * L.k * 0.62, 0, 0, 7); ctx.stroke(); if (p.col) ctx.restore(); }
    // planets back to front by y
    const items = s.planets.map(id => G.planets[id]).map(p => ({ p, pos: planetPos(G, p, L, t) })).sort((a, b) => a.pos[1] - b.pos[1]);
    R._planetHits = []; const tags = [];
    for (const { p, pos: [x, y] } of items) {
      const T = PLANET_TYPES[p.type];
      if (T.tex === 'belt') {
        { // a dusty band with rocks of many sizes, lit from the star's side
          const rk = p.r * L.k, sd = p.seed % 999;
          ctx.strokeStyle = 'rgba(160,150,140,.07)'; ctx.lineWidth = rk * 0.12; ctx.beginPath(); ctx.ellipse(L.cx, L.cy, rk, rk * 0.62, 0, 0, 7); ctx.stroke();
          for (let k = 0; k < 130; k++) { const a = k / 130 * Math.PI * 2 + Art.hash(k, 1, sd) * 0.09 + t * 0.003, rr = rk * (0.93 + Art.hash(k, 2, sd) * 0.14), bx = L.cx + Math.cos(a) * rr, by = L.cy + Math.sin(a) * rr * 0.62, sz = 0.7 + Art.hash(k, 3, sd) * Art.hash(k, 4, sd) * 3.2, lit = 0.55 + 0.45 * Math.max(0, -Math.sin(a));
            const sh = 110 + Art.hash(k, 5, sd) * 70; ctx.fillStyle = `rgba(${sh * lit + 30 | 0},${sh * lit + 20 | 0},${sh * lit | 0},.9)`; ctx.beginPath(); ctx.arc(bx, by, sz, 0, 7); ctx.fill(); }
        }
        R._planetHits.push({ p, x, y, r: 14 });
        if (Settings.get('names')) tags.push({ lines: [[p.name, '10px system-ui', 'rgba(200,205,235,.75)']], x, y, r: 2, prio: 5 });
        continue;
      }
      const pr = planetPx(p, L);
      const img = Art.planet(p, pr * R.dpr > 52 ? 128 : 64);
      const ringed = T.big && p.seed % 3 === 0, rt = p.type === 'icegas' ? '190,225,245' : '226,206,176';
      if (ringed) Art.ringBands(ctx, x, y, pr, pr * 0.3, -0.3, 'back', p.seed, rt);
      ctx.drawImage(img, x - pr, y - pr, pr * 2, pr * 2);
      if (ringed) Art.ringBands(ctx, x, y, pr, pr * 0.3, -0.3, 'front', p.seed, rt);
      if (p.type === 'beacon') { const pulse = 0.5 + 0.5 * Math.sin(now / 400); const gr = ctx.createRadialGradient(x, y, 0, x, y, pr * 3); gr.addColorStop(0, `rgba(120,220,255,${0.3 + pulse * 0.3})`); gr.addColorStop(1, 'rgba(120,220,255,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, pr * 3, 0, 7); ctx.fill(); }
      if (p.col) { ctx.strokeStyle = G.empires[p.col.owner].color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, pr + 3, 0, 7); ctx.stroke(); }
      if (p.station) { ctx.fillStyle = p.station === 'lab' ? '#6fc3ff' : '#ff8a5c'; ctx.fillRect(x + pr * 0.8, y - pr - 3, 5, 5); }
      if (p.siege) { ctx.strokeStyle = 'rgba(255,90,110,.9)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, pr + 6, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (UI.selPlanet === p.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, pr + 7, now / 600, now / 600 + 4.5); ctx.stroke(); }
      R._planetHits.push({ p, x, y, r: Math.max(pr + 6, 18) });
      if (Settings.get('names') && (p.moonOf < 0 || R.sysZoom > 1.3 || p.col)) {
        let label = p.name; if (p.col) label += ' · ' + p.col.pops; else if (p.prim && surveyed) label += ' · natives';
        const lines = [[label, (p.col ? '600 ' : '') + '11px system-ui', p.col ? nameCol(G.empires[p.col.owner].color) : 'rgba(215,220,245,.88)']];
        if (surveyed && p.dep && !p.col) { const k = Object.keys(p.dep)[0]; lines.push(['+' + p.dep[k] + ' ' + RES_INFO[k].name.split(' ')[0].toLowerCase(), '10px system-ui', RES_INFO[k].color]); }
        else if (surveyed && T.hab && !p.col && !p.prim) { const hb = SW.habitability(G, G.species[P.species], p, P); lines.push([Math.round(hb * 100) + '% habitable', '10px system-ui', hb >= 0.6 ? '#8ff0b8' : hb >= 0.4 ? '#ffd27a' : '#ff8f9c']); }
        tags.push({ lines, x, y, r: pr, prio: UI.selPlanet === p.id ? 0 : p.col ? 1 : p.moonOf < 0 ? 3 : 4 });
      }
    }
    // starbase
    R._sbHit = null;
    if (s.sb) {
      const x = L.cx + 46 * L.k + sp * 0.4, y = L.cy - 30 * L.k - sp * 0.25, col = G.empires[s.sb.owner].color, r = 17 + s.sb.lvl * 6;
      const spr = Art.starbase(s.sb.lvl, s.sb.mods, col), size = 34 + s.sb.lvl * 12;
      ctx.save(); ctx.translate(x, y); ctx.rotate(R.still ? 0 : now / 9000);
      if (s.sb.dis) ctx.globalAlpha = 0.45; ctx.drawImage(spr, -size / 2, -size / 2, size, size); ctx.globalAlpha = 1;
      const nb = s.sb.mods.filter(m => m === 'battery').length; for (let k = 0; k < nb; k++) { const a = -now / 2500 + k * Math.PI; ctx.fillStyle = col; ctx.fillRect(Math.cos(a) * (size * 0.55) - 2, Math.sin(a) * (size * 0.55) - 2, 4, 4); }
      ctx.restore();
      if (s.sb.dis) { ctx.strokeStyle = 'rgba(255,107,129,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke(); }
      R._sbHit = { x, y, r: Math.max(20, r + 8) };
      R._sbPos = [x, y];
      if (Settings.get('names')) tags.push({ lines: [[SB_LEVELS[s.sb.lvl].name + (s.sb.dis ? ' (disabled)' : ''), '10px system-ui', nameCol(col)]], x, y, r, prio: 2 });
    }
    // fleets
    const fl = sysFleets(G, s);
    R._fleetHits = []; const shipXY = {};
    const byOwner = new Map(); for (const f of fl) { if (!byOwner.has(f.owner)) byOwner.set(f.owner, []); byOwner.get(f.owner).push(f); }
    const units = [];
    for (const [o, fs] of byOwner) { if (fs.length > 3) units.push({ fleets: fs, cluster: true }); else for (const f of fs) units.push({ fleets: [f] }); }
    units.forEach((u, i) => {
      const f = u.fleets[0];
      const [ax, ay] = fleetAnchor(G, f, L, i, units.length);
      const ships = []; for (const g of u.fleets) g.ships.forEach((sh, j) => ships.push([g, sh, j]));
      const shown = ships.slice(0, 24), gap = Math.max(11, ...shown.slice(0, 6).map(([g, sh]) => shipLook(G, g, sh).size * 0.72)), pos = shipPositions(G, { ships: shown }, ax, ay, gap);
      const bob = Math.sin(now / 900 + i) * 1.5;
      shown.forEach(([g, sh, j], q) => { const [x, y] = pos[q]; shipXY[g.id + ':' + j] = [x, y + bob]; drawShip(G, g, sh, x, y + bob, g.owner === UI.pid ? -0.3 : Math.PI - 0.3, now); });
      for (let q = shown.length; q < ships.length; q++) { const [g, , j] = ships[q]; shipXY[g.id + ':' + j] = pos[q % pos.length]; }
      const sel = u.fleets.some(g => g.id === UI.selFleet);
      const rr = 14 + Math.sqrt(shown.length) * 6;
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(ax - 6, ay + 6, rr, 0, 7); ctx.stroke(); }
      ctx.fillStyle = G.empires[f.owner].color; ctx.font = '600 10.5px system-ui'; ctx.textAlign = 'center';
      const fpw = sum(u.fleets, g => g.kind === 'war' || g.kind === 'monster' ? pw(G, g) : 0);
      tags.push({ lines: [[u.cluster ? `${u.fleets.length} fleets · ${fmt(fpw)}` : f.name + (fpw ? ' · ' + fmt(fpw) : ''), '600 10.5px system-ui', nameCol(G.empires[f.owner].color)]], x: ax - 6, y: ay + 2, r: 10 + Math.sqrt(shown.length) * 4, prio: sel ? 0 : 2, up: true });
      R._fleetHits.push({ f, cluster: u.cluster, x: ax - 6, y: ay + 4, r: 22 + Math.sqrt(shown.length) * 4 });
    });
    if (Settings.get('names')) placeTags(tags, L);
    // combat effects: new shots each day
    const shots = G._shots && G._shots[s.id];
    if (Settings.get('effects') && shots && R.lastShotDay !== G.day) {
      R.lastShotDay = G.day;
      for (const sh of shots.slice(0, 24)) {
        const a = sh.a === 'sb' ? R._sbPos : shipXY[sh.a]; const b = sh.b === 'sb' ? R._sbPos : shipXY[sh.b];
        if (!a || !b) continue;
        const t0 = now + Math.random() * 400;
        R.fx.push({ t0, life: sh.ty === 'mis' ? 700 : sh.ty === 'beam' ? 320 : 360, ty: sh.ty, a: a.slice(), b: b.slice(), hit: sh.h, col: G.empires[sh.o] ? G.empires[sh.o].color : '#fff' });
        if (sh.h && sh.sh) R.fx.push({ t0: t0 + (sh.ty === 'mis' ? 650 : 120), life: 300, ty: 'shield', a: b.slice(), ang: Math.atan2(a[1] - b[1], a[0] - b[0]) });
      }
      if (shots.length && UI.speed > 0) { if (Math.random() < 0.6) Sound.play('laser'); }
    }
    // explosions when ship counts drop
    const counts = {}; for (const f of fl) counts[f.id] = f.ships.length; const oldIdx = R._unitIdx || new Map(); R._unitIdx = new Map(); units.forEach((u, i) => u.fleets.forEach(g => R._unitIdx.set(g.id, [i, units.length])));
    for (const id in R.prevCounts) {
      const before = R.prevCounts[id], after = counts[id] || 0;
      if (after < before && Settings.get('effects')) { const ui2 = oldIdx.get(+id) || R._unitIdx.get(+id); const [ax, ay] = ui2 ? fleetAnchor(G, null, L, ui2[0], ui2[1]) : [L.cx, L.cy]; for (let q = 0; q < before - after && q < 4; q++) { const bx = ax + (Math.random() - 0.5) * 20, by = ay + (Math.random() - 0.5) * 14; R.fx.push({ t0: now + q * 120, life: 900, ty: 'boom', a: [bx, by] }); for (let k = 0; k < 7; k++) { const an = Math.random() * 6.28; R.fx.push({ t0: now + q * 120, life: 700 + Math.random() * 400, ty: 'spark', a: [bx, by], v: [Math.cos(an), Math.sin(an)] }); } } Sound.play('boom'); }
    }
    R.prevCounts = counts; R.prevSys = s.id;
    for (let i = R.fx.length - 1; i >= 0; i--) {
      const x = R.fx[i], age = (now - x.t0) / x.life;
      if (age > 1) { R.fx.splice(i, 1); continue; } if (age < 0) continue;
      if (x.ty === 'boom') { const r = 4 + age * 26; const gr = ctx.createRadialGradient(x.a[0], x.a[1], 0, x.a[0], x.a[1], r); gr.addColorStop(0, `rgba(255,240,200,${1 - age})`); gr.addColorStop(0.4, `rgba(255,150,60,${0.8 * (1 - age)})`); gr.addColorStop(1, 'rgba(255,60,30,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x.a[0], x.a[1], r, 0, 7); ctx.fill(); continue; }
      if (x.ty === 'spark') { const r = 1 + (1 - age) * 2; ctx.fillStyle = `rgba(255,${180 + 60 * (1 - age)},120,${1 - age})`; ctx.fillRect(x.a[0] + x.v[0] * age * 30 - r / 2, x.a[1] + x.v[1] * age * 30 - r / 2, r, r); continue; }
      if (x.ty === 'shield') { ctx.strokeStyle = `rgba(120,200,255,${0.8 * (1 - age)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x.a[0], x.a[1], 9 + age * 4, x.ang - 0.9, x.ang + 0.9); ctx.stroke(); continue; }
      const tx = x.hit ? x.b[0] : x.b[0] + 14, ty = x.hit ? x.b[1] : x.b[1] - 10;
      if (x.ty === 'beam') {
        const fade = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
        ctx.globalAlpha = fade * 0.35; ctx.strokeStyle = x.col; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x.a[0], x.a[1]); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.globalAlpha = fade; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.globalAlpha = 1;
        if (x.hit && age > 0.1 && age < 0.4) { ctx.fillStyle = 'rgba(255,240,210,.9)'; ctx.beginPath(); ctx.arc(tx, ty, 3 + (0.4 - age) * 8, 0, 7); ctx.fill(); }
      } else {
        const px = x.a[0] + (tx - x.a[0]) * age, py = x.a[1] + (ty - x.a[1]) * age - (x.ty === 'mis' ? Math.sin(age * Math.PI) * 18 : 0);
        if (x.ty === 'mis') { const qx = x.a[0] + (tx - x.a[0]) * Math.max(0, age - 0.12), qy = x.a[1] + (ty - x.a[1]) * Math.max(0, age - 0.12) - Math.sin(Math.max(0, age - 0.12) * Math.PI) * 18; ctx.strokeStyle = 'rgba(255,200,120,.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke(); ctx.fillStyle = '#ffd27a'; ctx.fillRect(px - 1.5, py - 1.5, 3, 3); }
        else { const dx = (tx - x.a[0]) * 0.06, dy = (ty - x.a[1]) * 0.06; ctx.strokeStyle = 'rgba(235,240,255,.9)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(px - dx, py - dy); ctx.lineTo(px, py); ctx.stroke(); }
        if (age > 0.9 && x.hit) { ctx.fillStyle = 'rgba(255,200,120,.85)'; ctx.beginPath(); ctx.arc(tx, ty, 3.5, 0, 7); ctx.fill(); }
      }
      if (age < 0.12) { ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(x.a[0], x.a[1], 2.2, 0, 7); ctx.fill(); } // muzzle flash
    }
    // header
    ctx.textAlign = 'center'; ctx.font = '600 13px system-ui'; ctx.fillStyle = s.owner >= 0 ? G.empires[s.owner].color : 'rgba(220,225,250,.9)';
    label(s.name + ' · ' + STAR_TYPES[s.star].name + (s.nebula ? ' · nebula' : ''), R.w / 2, R.h - R.botPad - (surveyed ? 14 : 32), s.owner >= 0 ? G.empires[s.owner].color : 'rgba(220,225,250,.9)');
    if (!surveyed) { ctx.font = '12px system-ui'; label('Unsurveyed: send a surveyor to learn about these worlds', R.w / 2, R.h - R.botPad - 14, 'rgba(220,225,250,.7)'); }
  }
  R.topPad = 110; R.botPad = 70;
  try { const mq = matchMedia('(prefers-reduced-motion: reduce)'); R.still = mq.matches; mq.addEventListener && mq.addEventListener('change', () => { R.still = mq.matches; }); } catch (e) { R.still = false; }
  R.draw = (G, frac) => {
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    if (R.anim) { const k = clamp((performance.now() - R.anim.t0) / R.anim.dur, 0, 1), e = 1 - Math.pow(1 - k, 3); R.cam.x = lerp(R.anim.x0, R.anim.x1, e); R.cam.y = lerp(R.anim.y0, R.anim.y1, e); R.cam.z = lerp(R.anim.z0, R.anim.z1, e); if (R.anim.z0 !== R.anim.z1) R.zoomT = performance.now(); if (k >= 1) R.anim = null; }
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, R.w, R.h);
    if (!G) return;
    if (R.mode === 'system' && R.sys >= 0) drawSystem(G, frac); else drawGalaxy(G, frac);
    R.dirty = false;
  };
  R.request = () => { R.dirty = true; };
  R.busy = () => !!R.anim || (R.mode === 'galaxy' && R._tilesPending) || R.fx.length > 0 || R.mode === 'system' || UI.selSys != null || (UI.G && UI.G._fight && Object.keys(UI.G._fight).length > 0);
  R.centerOn = (sid, animate, z) => {
    const s = UI.G.systems[sid]; const z1 = z || Math.max(R.cam.z, 0.55);
    if (animate) R.anim = { t0: performance.now(), dur: 380, x0: R.cam.x, y0: R.cam.y, z0: R.cam.z, x1: s.x, y1: s.y + (R.h * 0.17) / z1, z1 };
    else { R.anim = null; R.cam.x = s.x; R.cam.y = s.y + (R.h * 0.17) / z1; R.cam.z = z1; }
    R.dirty = true;
  };
  R.fit = (G) => { R.cam.x = 0; R.cam.y = 0; R.cam.z = Math.min(R.w, R.h) / (2 * G.R * 1.05); R.dirty = true; };
  R.minZ = () => UI.G ? Math.min(R.w, R.h) / (2 * UI.G.R * 1.4) : 0.1;
  R.zoomAt = (sx, sy, f) => {
    const [wx, wy] = R.toWorld(sx, sy);
    R.cam.z = clamp(R.cam.z * f, R.minZ(), 3.2); R.zoomT = performance.now();
    const [nx, ny] = R.toWorld(sx, sy); R.cam.x += wx - nx; R.cam.y += wy - ny; R.anim = null; R.dirty = true;
  };
  R.pan = (dx, dy) => { R.cam.x -= dx / R.cam.z; R.cam.y -= dy / R.cam.z; R.anim = null; R.dirty = true; R.panT = performance.now(); };
  R.enterSystem = (sid) => { R.mode = 'system'; R.sys = sid; R.sysZoom = 1; R.fx = []; R.prevCounts = {}; R.dirty = true; };
  R.exitSystem = () => { if (R.mode !== 'system') return; const sid = R.sys; R.mode = 'galaxy'; R.fx = []; R.centerOn(sid, false, Math.max(R.cam.z, 0.9)); };
  // hit testing in screen coordinates
  R.hit = (G, x, y) => {
    if (R.mode === 'system') {
      for (const hb of R._fleetHits || []) if (hyp(hb.x - x, hb.y - y) < hb.r) return hb.cluster ? { k: 'cluster', id: R.sys, owner: hb.f.owner } : { k: 'fleet', id: hb.f.id };
      if (R._sbHit && hyp(R._sbHit.x - x, R._sbHit.y - y) < R._sbHit.r) return { k: 'sb', id: R.sys };
      let best = null, bd = 1e9; for (const hb of R._planetHits || []) { const d = hyp(hb.x - x, hb.y - y); if (d < hb.r && d < bd) { bd = d; best = hb; } }
      if (best) return { k: 'planet', id: best.p.id };
      return null;
    }
    const P = G.empires[UI.pid], v = visibility(G, UI.pid);
    let bf = null, bfd = 18;
    for (const f of G.fleets) {
      if (f.owner !== UI.pid && !v[f.sys]) continue; if (!P.known[f.sys]) continue;
      const [sx, sy] = R.fleetScreen(G, f); const d = hyp(sx - x, sy - y); if (d < bfd) { bfd = d; bf = f; }
    }
    // a tap on a star's core always means the star
    for (const s of G.systems) { if (!P.known[s.id]) continue; const [sx, sy] = toS(s.x, s.y); if (hyp(sx - x, sy - y) < Math.max(13, starPx(s) * 0.45)) return { k: 'sys', id: s.id }; }
    if (bf && !(bf.path.length && bf.prog > 0)) { const it = itemOf(G, bf); if (it && it.fleets.length > 1) { if (bfd < 14) return { k: 'sys', id: bf.sys }; bf = null; } }
    if (bf && bfd < 12) return { k: 'fleet', id: bf.id };
    let bs = null, bsd = 30;
    for (const s of G.systems) { const [sx, sy] = toS(s.x, s.y); const d = hyp(sx - x, sy - y); if (d < bsd) { bsd = d; bs = s; } }
    if (bf && (!bs || bfd < bsd)) return { k: 'fleet', id: bf.id };
    if (bs) return { k: 'sys', id: bs.id };
    return null;
  };
  R.resetCaches = () => { glow = null; terr = null; terrKey = ''; visKey = ''; lastG = null; layer = null; tiles = new Map(); prevTiles = null; tileZ = 0; };
  resize();
  window.addEventListener('resize', () => { resize(); });
  return R;
}
