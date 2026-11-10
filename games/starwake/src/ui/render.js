// ===== render.js : canvas renderer for the galaxy map and the system view =====
function makeRenderer(canvas) {
  const mainCtx = canvas.getContext('2d'); let ctx = mainCtx;
  const R = { cam: { x: 0, y: 0, z: 0.3 }, mode: 'galaxy', sys: -1, w: 0, h: 0, dpr: 1, dirty: true, anim: null, fx: [], prevCounts: {}, sysZoom: 1, lastShotDay: -1 };
  let starfield = null, glow = null, glowB = 0, terr = null, terrKey = '', visKey = '', vis = null, lastG = null;
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
      const q = (j * N + i) * 4, col = rgb[o]; d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2]; d[q + 3] = edge ? 255 : 46;
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
  function label(text, x, y, fill) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(3,4,12,.85)'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y); }
  // fleet power is cached per game day for drawing
  function pw(G, f) { const c = R._pwc || (R._pwc = new Map()); const k = f.id; const v = c.get(k); if (v && v[0] === G.day && v[2] === f.ships.length) return v[1]; const p = SW.fleetPower(G, f); c.set(k, [G.day, p, f.ships.length]); if (c.size > 4000) c.clear(); return p; }
  R.pw = pw;
  const starPx = s => clamp(R.cam.z * 34, 9, 40) * STAR_TYPES[s.star].r;
  function drawFleetIcon(G, f, x, y, ang, sel) {
    const e = G.empires[f.owner], mine = f.owner === UI.pid;
    const sz = f.kind === 'war' || f.kind === 'monster' ? clamp(5 + Math.log10(1 + pw(G, f)) * 1.6, 6, 12) : 5.5;
    ctx.save(); ctx.translate(x, y);
    if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, sz + 6, 0, 7); ctx.stroke(); }
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
  let layer = null;
  function staticKey(G, P) {
    let k = 0, sv = 0, sb = 0, an = 0;
    for (const s of G.systems) { if (P.known[s.id]) k++; if (P.surv[s.id]) sv++; if (s.sb) sb += s.sb.lvl + 1; if (s.anom && s.anom.by === UI.pid && !s.anom.done) an++; }
    return [G._ownVer || 0, terrKey, k, sv, sb, an, Settings.get('names') ? 1 : 0, (G.folded || []).length, G.systems.length].join(':');
  }
  function drawStatic(G) {
    const pid = UI.pid, P = G.empires[pid], z = R.cam.z;
    const [gx, gy] = toS(-glowB, -glowB); ctx.drawImage(glow, gx, gy, glowB * 2 * z, glowB * 2 * z);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(terr, gx, gy, glowB * 2 * z, glowB * 2 * z);
    const pad = 60, inView = (x, y) => x > -pad && y > -pad && x < R.w + pad && y < R.h + pad;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(130,150,255,.28)'; ctx.beginPath();
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
      ctx.lineWidth = 1.6; ctx.globalAlpha = 0.45;
      for (const [o, segs] of byOwner) { ctx.strokeStyle = G.empires[o].color; ctx.beginPath(); for (let i = 0; i < segs.length; i += 2) { const [ax, ay] = toS(segs[i].x, segs[i].y), [bx, by] = toS(segs[i + 1].x, segs[i + 1].y); if (!inView(ax, ay) && !inView(bx, by)) continue; ctx.moveTo(ax, ay); ctx.lineTo(bx, by); } ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
    if (G.folded) { ctx.strokeStyle = 'rgba(110,214,255,.7)'; ctx.setLineDash([4, 4]); ctx.beginPath(); for (const [a, b] of G.folded) { if (!known[a] && !known[b]) continue; const [ax, ay] = toS(G.systems[a].x, G.systems[a].y), [bx, by] = toS(G.systems[b].x, G.systems[b].y); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); } ctx.stroke(); ctx.setLineDash([]); }
    for (const s of G.systems) {
      const [x, y] = toS(s.x, s.y); if (!inView(x, y)) continue;
      if (!known[s.id]) { ctx.fillStyle = 'rgba(160,170,220,.35)'; ctx.fillRect(x - 1, y - 1, 2, 2); continue; }
      const sp = starPx(s);
      ctx.drawImage(Art.star(s.star), x - sp, y - sp, sp * 2, sp * 2);
      if (s.owner >= 0) {
        const col = G.empires[s.owner].color;
        if (s.sb && s.sb.lvl > 0) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 6, r = sp * 0.45 + 3; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.closePath(); ctx.stroke(); }
        if (s.planets.some(id => G.planets[id].col)) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x + sp * 0.42 + 3, y - sp * 0.42 - 3, 3, 0, 7); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke(); }
      }
      if (s.special === 'beacon') { ctx.fillStyle = '#9ee9ff'; ctx.beginPath(); const bx = x - sp * 0.5 - 4, by = y - sp * 0.5 - 4; ctx.moveTo(bx, by - 5); ctx.lineTo(bx + 3, by); ctx.lineTo(bx, by + 5); ctx.lineTo(bx - 3, by); ctx.fill(); }
      if (s.anom && s.anom.by === pid && !s.anom.done) { ctx.fillStyle = '#c99bff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', x - sp * 0.5 - 2, y + sp * 0.5 + 8); }
      if (P.surv[s.id] === 0 && z > 0.35) { ctx.strokeStyle = 'rgba(200,200,255,.25)'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, sp * 0.5 + 2, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (Settings.get('names') && showName(G, P, s, z)) drawName(G, s, x, y, sp, z);
    }
  }
  const showName = (G, P, s, z) => z > 0.55 || (z > 0.36 && s.planets.some(id => G.planets[id].col) && P.surv[s.id]) || (z > 0.18 && s.planets.some(id => G.planets[id].home && G.planets[id].col));
  function drawName(G, s, x, y, sp, z) { ctx.font = (s.owner >= 0 ? '600 ' : '') + (z > 0.9 ? 12 : 10.5) + 'px system-ui'; ctx.textAlign = 'center'; label(s.name, x, y + sp * 0.5 + 13, s.owner >= 0 ? G.empires[s.owner].color : 'rgba(210,215,245,.85)'); }
  R.layerStats = { builds: 0 };
  function drawGalaxy(G, frac) {
    const pid = UI.pid, P = G.empires[pid];
    if (!starfield) makeStarfield();
    if (lastG !== G) { glow = null; terr = null; terrKey = ''; lastG = G; layer = null; }
    if (!glow) makeGlow(G);
    const tk = (G._ownVer || 0) + ':' + Math.floor(G.day / 30) + ':' + G.systems.length;
    if (tk !== terrKey && (!terr || performance.now() - (R.terrT || 0) > 1500)) { makeTerritory(G, pid); terrKey = tk; R.terrT = performance.now(); }
    const z = R.cam.z, now = performance.now();
    ctx.drawImage(starfield, -((R.cam.x * 0.03) % (R.w * 0.3) + R.w * 0.15), -((R.cam.y * 0.03) % (R.h * 0.3) + R.h * 0.15));
    // static layer, cached
    const key = staticKey(G, P), M = 0.5;
    const ratio = layer ? z / layer.z : 1;
    const zooming = now - (R.zoomT || 0) < 160;
    let rebuild = !layer || layer.key !== key || layer.dpr !== R.dpr || layer.w !== R.w || layer.h !== R.h;
    if (layer && !rebuild) {
      if (Math.abs(ratio - 1) > 0.001 && (!zooming || ratio < 0.65 || ratio > 1.5)) rebuild = true;
      const [ox, oy] = [(layer.cx - R.cam.x) * z, (layer.cy - R.cam.y) * z];
      if (Math.abs(ox) > R.w * M * 0.9 || Math.abs(oy) > R.h * M * 0.9) rebuild = true;
    }
    if (rebuild) {
      const LW = Math.ceil(R.w * (1 + 2 * M)), LH = Math.ceil(R.h * (1 + 2 * M));
      if (!layer || layer.canvas.width !== Math.round(LW * R.dpr) || layer.canvas.height !== Math.round(LH * R.dpr)) layer = { canvas: Art.mk(Math.round(LW * R.dpr), Math.round(LH * R.dpr)) };
      const lc = layer.canvas.getContext('2d'); lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, layer.canvas.width, layer.canvas.height); lc.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
      const sw = R.w, sh = R.h; R.w = LW; R.h = LH; ctx = lc;
      try { drawStatic(G); } finally { ctx = mainCtx; R.w = sw; R.h = sh; }
      Object.assign(layer, { key, z, cx: R.cam.x, cy: R.cam.y, LW, LH, dpr: R.dpr, w: R.w, h: R.h });
      R.layerStats.builds++;
    }
    { const k = z / layer.z, cxs = (layer.cx - R.cam.x) * z + R.w / 2, cys = (layer.cy - R.cam.y) * z + R.h / 2;
      ctx.drawImage(layer.canvas, cxs - layer.LW / 2 * k, cys - layer.LH / 2 * k, layer.LW * k, layer.LH * k); }
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
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; const r = sp * 0.55 + 8; ctx.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + now / 900; ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.arc(x, y, r, a, a + 0.9); } ctx.stroke();
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
  const planetPx = (p, L) => clamp((PLANET_TYPES[p.type].big ? 30 : 10 + p.size * 0.9) * L.k * (p.moonOf >= 0 ? 0.45 : 1), 5, 44);
  function fleetAnchor(G, f, L, i, n) { const a = -Math.PI * 0.15 + i * (Math.PI * 1.4 / Math.max(1, n)); return [L.cx + Math.cos(a) * L.maxR * 0.42 * L.k, L.cy + Math.sin(a) * L.maxR * 0.42 * L.k * 0.56 - 10]; }
  function shipPositions(G, f, ax, ay) {
    const out = []; const n = f.ships.length;
    for (let i = 0; i < n; i++) { const row = Math.floor(Math.sqrt(i)), col = i - row * row; out.push([ax - row * 9 + col * 9 - (col > row ? (col - row) * 9 : 0), ay + row * 7 - (col > row ? (col - row) * 7 : 0)]); }
    return out;
  }
  const sysFleets = (G, s) => G.fleets.filter(f => f.sys === s.id && (!f.path.length || f.prog === 0) && (f.owner === UI.pid || R.visible(G, s.id)));
  function drawShip(G, f, sh, x, y, ang) {
    const e = G.empires[f.owner];
    let sz = 4;
    if (sh.m) sz = Math.min(16, 4 + MONSTERS[sh.m].size * 0.4); else if (typeof sh.d === 'string') sz = 3.5; else { const d = SW.designById(e, sh.d); sz = d ? (HULLS[d.hull].size ? 3 + Math.sqrt(HULLS[d.hull].size) * 2.2 : 3.5) : 4; }
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = e.color; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 0.8; ctx.beginPath();
    if (sh.m) { ctx.arc(0, 0, sz * 0.7, 0, 7); ctx.fill(); ctx.strokeStyle = e.color; for (let k = 0; k < 6; k++) { const a = k * 1.05; ctx.moveTo(Math.cos(a) * sz * 0.7, Math.sin(a) * sz * 0.7); ctx.lineTo(Math.cos(a) * sz * 1.3, Math.sin(a) * sz * 1.3); } ctx.stroke(); }
    else { ctx.moveTo(sz * 1.3, 0); ctx.lineTo(-sz, -sz * 0.7); ctx.lineTo(-sz * 0.5, 0); ctx.lineTo(-sz, sz * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  function drawSystem(G, frac) {
    const s = G.systems[R.sys], P = G.empires[UI.pid];
    if (!starfield) makeStarfield();
    ctx.drawImage(starfield, -R.w * 0.15, -R.h * 0.15);
    const L = sysLayout(G, s), t = G.day + frac, now = performance.now();
    // nebula tint
    if (s.nebula) { const n = G.nebulae.find(q => hyp(q.x - s.x, q.y - s.y) < q.r) || { hue: 260 }; const gr = ctx.createRadialGradient(L.cx * 0.6, L.cy * 0.7, 0, L.cx, L.cy, R.w); gr.addColorStop(0, `hsla(${n.hue},70%,40%,.25)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, R.w, R.h); }
    // star and its light
    { const gl = STAR_TYPES[s.star].glow; const gr = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, Math.max(R.w, R.h) * 0.7); gr.addColorStop(0, gl + '33'); gr.addColorStop(0.4, gl + '10'); gr.addColorStop(1, gl + '00'); ctx.fillStyle = gr; ctx.fillRect(0, 0, R.w, R.h); }
    const sp = 30 * STAR_TYPES[s.star].r * clamp(L.k * 1.2, 0.6, 1.4);
    ctx.globalAlpha = 0.5; ctx.drawImage(Art.star(s.star), L.cx - sp * 2.2, L.cy - sp * 2.2, sp * 4.4, sp * 4.4); ctx.globalAlpha = 1;
    if (s.star !== 'hole') { // slow corona rays
      ctx.save(); ctx.translate(L.cx, L.cy); ctx.rotate(now / 9000); ctx.strokeStyle = STAR_TYPES[s.star].glow; ctx.lineCap = 'round';
      for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, len = sp * (1.3 + 0.35 * Math.sin(now / 700 + k * 1.7)); ctx.globalAlpha = 0.12; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * sp * 0.5, Math.sin(a) * sp * 0.5); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len); ctx.stroke(); }
      ctx.restore(); ctx.globalAlpha = 1;
    } else { ctx.save(); ctx.translate(L.cx, L.cy); ctx.scale(1, 0.35); ctx.rotate(now / 3000); ctx.strokeStyle = 'rgba(255,200,150,.35)'; ctx.lineWidth = 2; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, sp * (1.1 + k * 0.25), k, k + 4); ctx.stroke(); } ctx.restore(); }
    ctx.drawImage(Art.star(s.star), L.cx - sp, L.cy - sp, sp * 2, sp * 2);
    // orbits
    ctx.strokeStyle = 'rgba(140,160,255,.16)'; ctx.lineWidth = 1;
    const surveyed = P.surv[s.id] === 1;
    for (const id of s.planets) { const p = G.planets[id]; if (p.moonOf >= 0) continue; ctx.beginPath(); ctx.ellipse(L.cx, L.cy, p.r * L.k, p.r * L.k * 0.62, 0, 0, 7); ctx.stroke(); }
    // planets back to front by y
    const items = s.planets.map(id => G.planets[id]).map(p => ({ p, pos: planetPos(G, p, L, t) })).sort((a, b) => a.pos[1] - b.pos[1]);
    R._planetHits = [];
    for (const { p, pos: [x, y] } of items) {
      const T = PLANET_TYPES[p.type];
      if (T.tex === 'belt') {
        ctx.fillStyle = 'rgba(170,160,150,.7)';
        for (let k = 0; k < 70; k++) { const a = k / 70 * Math.PI * 2 + Art.hash(k, 1, p.seed % 999) * 0.08 + t * 0.003; const rr = p.r * L.k * (0.96 + Art.hash(k, 2, p.seed % 999) * 0.08); ctx.fillRect(L.cx + Math.cos(a) * rr, L.cy + Math.sin(a) * rr * 0.62, 1.6, 1.6); }
        R._planetHits.push({ p, x, y, r: 14 });
        if (Settings.get('names')) { ctx.fillStyle = 'rgba(200,205,235,.7)'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(p.name, x, y + 14); }
        continue;
      }
      const pr = planetPx(p, L);
      const img = Art.planet(p, 64);
      if (T.big && p.seed % 3 === 0) { ctx.strokeStyle = 'rgba(220,200,170,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(x, y, pr * 1.8, pr * 0.5, -0.3, 0, 7); ctx.stroke(); }
      ctx.drawImage(img, x - pr, y - pr, pr * 2, pr * 2);
      if (p.type === 'beacon') { const pulse = 0.5 + 0.5 * Math.sin(now / 400); const gr = ctx.createRadialGradient(x, y, 0, x, y, pr * 3); gr.addColorStop(0, `rgba(120,220,255,${0.3 + pulse * 0.3})`); gr.addColorStop(1, 'rgba(120,220,255,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, pr * 3, 0, 7); ctx.fill(); }
      if (p.col) { ctx.strokeStyle = G.empires[p.col.owner].color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, pr + 3, 0, 7); ctx.stroke(); }
      if (p.station) { ctx.fillStyle = p.station === 'lab' ? '#6fc3ff' : '#ff8a5c'; ctx.fillRect(x + pr * 0.8, y - pr - 3, 5, 5); }
      if (p.siege) { ctx.strokeStyle = 'rgba(255,90,110,.9)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, pr + 6, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (UI.selPlanet === p.id) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, pr + 7, now / 600, now / 600 + 4.5); ctx.stroke(); }
      R._planetHits.push({ p, x, y, r: Math.max(pr + 6, 18) });
      if (Settings.get('names') && (p.moonOf < 0 || R.sysZoom > 1.3 || p.col)) {
        ctx.font = (p.col ? '600 ' : '') + '11px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(3,4,12,.85)'; ctx.lineJoin = 'round';
        ctx.fillStyle = p.col ? G.empires[p.col.owner].color : 'rgba(215,220,245,.85)';
        let label = p.name; if (p.col) label += ' · ' + p.col.pops; else if (p.prim && surveyed) label += ' · natives';
        ctx.strokeText(label, x, y + pr + 13); ctx.fillText(label, x, y + pr + 13);
        if (surveyed && p.dep && !p.col) { const k = Object.keys(p.dep)[0]; ctx.fillStyle = RES_INFO[k].color; ctx.font = '10px system-ui'; ctx.fillText('+' + p.dep[k] + ' ' + RES_INFO[k].name.split(' ')[0].toLowerCase(), x, y + pr + 25); }
        else if (surveyed && T.hab && !p.col && !p.prim) { const hb = SW.habitability(G, G.species[P.species], p, P); ctx.fillStyle = hb >= 0.6 ? '#8ff0b8' : hb >= 0.4 ? '#ffd27a' : '#ff8f9c'; ctx.font = '10px system-ui'; ctx.fillText(Math.round(hb * 100) + '% habitable', x, y + pr + 25); }
      }
    }
    // starbase
    R._sbHit = null;
    if (s.sb) {
      const x = L.cx + 46 * L.k + sp * 0.4, y = L.cy - 30 * L.k - sp * 0.25, col = G.empires[s.sb.owner].color, r = 6 + s.sb.lvl * 3;
      ctx.save(); ctx.translate(x, y); ctx.rotate(now / 4000);
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.fillStyle = s.sb.dis ? 'rgba(80,80,90,.8)' : 'rgba(20,24,50,.9)';
      ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, 7); ctx.fillStyle = col; ctx.fill();
      ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.beginPath(); for (let k = 0; k < 3; k++) { const a = k * 2.094; ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * (r + 5 + s.sb.lvl * 2), Math.sin(a) * (r + 5 + s.sb.lvl * 2)); } ctx.stroke(); ctx.globalAlpha = 1;
      const nb = s.sb.mods.filter(m => m === 'battery').length; for (let k = 0; k < nb; k++) { const a = -now / 2500 + k * Math.PI; ctx.fillStyle = col; ctx.fillRect(Math.cos(a) * (r + 12) - 2, Math.sin(a) * (r + 12) - 2, 4, 4); }
      ctx.restore();
      R._sbHit = { x, y, r: Math.max(20, r + 8) };
      R._sbPos = [x, y];
      if (Settings.get('names')) { ctx.fillStyle = col; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText(SB_LEVELS[s.sb.lvl].name + (s.sb.dis ? ' (disabled)' : ''), x, y + r + 12); }
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
      const shown = ships.slice(0, 40), pos = shipPositions(G, { ships: shown }, ax, ay);
      const bob = Math.sin(now / 900 + i) * 1.5;
      shown.forEach(([g, sh, j], q) => { const [x, y] = pos[q]; shipXY[g.id + ':' + j] = [x, y + bob]; drawShip(G, g, sh, x, y + bob, g.owner === UI.pid ? -0.3 : Math.PI - 0.3); });
      for (let q = shown.length; q < ships.length; q++) { const [g, , j] = ships[q]; shipXY[g.id + ':' + j] = pos[q % pos.length]; }
      const sel = u.fleets.some(g => g.id === UI.selFleet);
      const rr = 14 + Math.sqrt(shown.length) * 6;
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(ax - 6, ay + 6, rr, 0, 7); ctx.stroke(); }
      ctx.fillStyle = G.empires[f.owner].color; ctx.font = '600 10.5px system-ui'; ctx.textAlign = 'center';
      const fpw = sum(u.fleets, g => g.kind === 'war' || g.kind === 'monster' ? pw(G, g) : 0);
      label(u.cluster ? `${u.fleets.length} fleets · ${fmt(fpw)}` : f.name + (fpw ? ' · ' + fmt(fpw) : ''), ax - 6, ay - 14 - Math.sqrt(shown.length) * 3, G.empires[f.owner].color);
      R._fleetHits.push({ f, cluster: u.cluster, x: ax - 6, y: ay + 4, r: 22 + Math.sqrt(shown.length) * 4 });
    });
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
  R.draw = (G, frac) => {
    ctx.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    if (R.anim) { const k = clamp((performance.now() - R.anim.t0) / R.anim.dur, 0, 1), e = 1 - Math.pow(1 - k, 3); R.cam.x = lerp(R.anim.x0, R.anim.x1, e); R.cam.y = lerp(R.anim.y0, R.anim.y1, e); R.cam.z = lerp(R.anim.z0, R.anim.z1, e); if (R.anim.z0 !== R.anim.z1) R.zoomT = performance.now(); if (k >= 1) R.anim = null; }
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, R.w, R.h);
    if (!G) return;
    if (R.mode === 'system' && R.sys >= 0) drawSystem(G, frac); else drawGalaxy(G, frac);
    R.dirty = false;
  };
  R.request = () => { R.dirty = true; };
  R.busy = () => !!R.anim || (layer && R.mode === 'galaxy' && layer.z !== R.cam.z) || R.fx.length > 0 || R.mode === 'system' || UI.selSys != null || (UI.G && UI.G._fight && Object.keys(UI.G._fight).length > 0);
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
  R.pan = (dx, dy) => { R.cam.x -= dx / R.cam.z; R.cam.y -= dy / R.cam.z; R.anim = null; R.dirty = true; };
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
  R.resetCaches = () => { glow = null; terr = null; terrKey = ''; visKey = ''; lastG = null; layer = null; };
  resize();
  window.addEventListener('resize', () => { resize(); });
  return R;
}
