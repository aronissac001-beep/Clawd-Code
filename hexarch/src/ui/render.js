// ===== render.js : canvas map renderer =====
const HEX_R = 32;
const CORNERS = []; for (let k = 0; k < 6; k++) { const a = (60 * k - 30) * Math.PI / 180; CORNERS.push([Math.cos(a), Math.sin(a)]); }
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function hexPath(ctx, x, y, r) {
  ctx.moveTo(x + CORNERS[0][0] * r, y + CORNERS[0][1] * r);
  for (let k = 1; k < 6; k++) ctx.lineTo(x + CORNERS[k][0] * r, y + CORNERS[k][1] * r);
  ctx.closePath();
}
function edgePath(ctx, x, y, r, d) {
  const a = CORNERS[d], b = CORNERS[(d + 1) % 6];
  ctx.moveTo(x + a[0] * r, y + a[1] * r); ctx.lineTo(x + b[0] * r, y + b[1] * r);
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
  return `rgb(${r},${g},${b})`;
}
function lcg(seed) { let s = seed >>> 0 || 1; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }

class Renderer {
  constructor(cv) {
    this.cv = cv; this.ctx = cv.getContext('2d');
    this.cam = { x: 0, y: 0, z: 0.9 }; this.G = null; this.pid = 0;
    this.sprites = null; this.spriteZ = 0; this.gesturing = false;
    this.anims = new Map(); this.camAnim = null; this.glyphs = new Map(); this.banners = new Map();
    this.selTile = -1; this.path = null; this.reach = null; this.raf = 0; this.fx = [];
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  resize() {
    const hi = Settings.get('quality') !== 'battery';
    this.dpr = Math.min(window.devicePixelRatio || 1, hi ? 2 : 1);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.cv.width = Math.round(this.w * this.dpr); this.cv.height = Math.round(this.h * this.dpr);
    this.sprites = null; this.glyphs.clear();
    this.request();
  }
  setGame(G, pid) { this.G = G; this.pid = pid; this.anims.clear(); this.selTile = -1; this.path = null; this.reach = null; this.request(); }
  get worldW() { return SQ3 * HEX_R * this.G.map.W; }
  get worldH() { return 1.5 * HEX_R * (this.G.map.H - 1) + 2 * HEX_R; }
  request() { if (!this.raf) this.raf = requestAnimationFrame(t => { this.raf = 0; this.frame(t); }); }
  frame(t) {
    let more = false;
    if (this.camAnim) {
      const a = this.camAnim, k = Math.min(1, (t - a.t0) / a.dur), e = 1 - Math.pow(1 - k, 3);
      this.cam.x = a.fx + a.dx * e; this.cam.y = a.fy + a.dy * e;
      if (k >= 1) this.camAnim = null; else more = true;
    }
    if (this.onFrame && this.onFrame(t)) more = true;
    for (const [id, a] of this.anims) { if (t - a.t0 >= a.dur * (a.steps.length - 1)) this.anims.delete(id); else more = true; }
    this.fx = this.fx.filter(f => t - f.t0 < f.dur); if (this.fx.length) more = true;
    this.clampCam();
    this.draw(t);
    if (more) this.request();
  }
  clampCam() {
    if (!this.G) return;
    const c = this.cam, ww = this.worldW, wh = this.worldH;
    c.x = ((c.x % ww) + ww) % ww;
    const half = this.h / 2 / c.z;
    if (wh < 2 * half) c.y = wh / 2; else c.y = Math.max(half * 0.35, Math.min(wh - half * 0.35, c.y));
  }
  tileWX(i) { const W = this.G.map.W, c = i % W, r = (i / W) | 0; return SQ3 * HEX_R * (c + 0.5 * (r & 1)); }
  tileWY(i) { return 1.5 * HEX_R * ((i / this.G.map.W) | 0) + HEX_R; }
  // screen position of the copy of tile i closest to the camera
  posOf(i) {
    const ww = this.worldW; let dx = this.tileWX(i) - this.cam.x;
    dx = ((dx % ww) + ww * 1.5) % ww - ww / 2;
    return [dx * this.cam.z + this.w / 2, (this.tileWY(i) - this.cam.y) * this.cam.z + this.h / 2];
  }
  screenToWorld(sx, sy) { return [(sx - this.w / 2) / this.cam.z + this.cam.x, (sy - this.h / 2) / this.cam.z + this.cam.y]; }
  screenToTile(sx, sy) {
    if (!this.G) return -1;
    const [wx, wy0] = this.screenToWorld(sx, sy), wy = wy0 - HEX_R;
    const q = (SQ3 / 3 * wx - wy / 3) / HEX_R, r = (2 / 3 * wy) / HEX_R;
    let x = q, z = r, y = -x - z, rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    const row = rz, col = rx + ((row - (row & 1)) >> 1);
    return this.G._grid.idx(col, row);
  }
  centerOn(tile, animate) {
    const tx = this.tileWX(tile), ty = this.tileWY(tile) + this.h * 0.07 / this.cam.z;
    const ww = this.worldW; let dx = tx - this.cam.x; dx = ((dx % ww) + ww * 1.5) % ww - ww / 2;
    if (animate) this.camAnim = { fx: this.cam.x, fy: this.cam.y, dx, dy: ty - this.cam.y, t0: performance.now(), dur: 320 };
    else { this.cam.x += dx; this.cam.y = ty; }
    this.request();
  }
  isOnScreen(tile, margin) {
    const [x, y] = this.posOf(tile), m = margin || 60;
    return x > m && x < this.w - m && y > 70 + m && y < this.h - 200;
  }
  // Visual feedback for an attack: lunge for melee, a shot line for ranged, floating damage numbers.
  combatFx(unitId, res) {
    const now = performance.now();
    if (unitId !== null && !res.ranged && !res.killedA && Settings.get('anim') !== 'off') this.anims.set(unitId, { steps: [res.from, res.to, res.moved ? res.to : res.from], t0: now, dur: 110 });
    if (res.ranged) this.fx.push({ kind: 'shot', from: res.from, to: res.to, t0: now, dur: 380 });
    if (res.dmgT) this.fx.push({ kind: 'num', tile: res.to, text: res.killedT ? '✖' : `−${res.dmgT}`, color: '#ff7a6b', t0: now + 120, dur: 1100 });
    if (res.dmgA) this.fx.push({ kind: 'num', tile: res.moved ? res.to : res.from, text: res.killedA ? '✖' : `−${res.dmgA}`, color: '#ffb36b', t0: now + 160, dur: 1100, dy: 0.35 });
    if (res.captured) this.fx.push({ kind: 'num', tile: res.to, text: 'Captured!', color: '#ffe08a', t0: now + 200, dur: 1500, dy: -0.4 });
    this.request();
  }
  animate(unitId, steps) {
    const sp = Settings.get('anim'); if (sp === 'off' || steps.length < 2) return 0;
    const dur = sp === 'fast' ? 70 : 150;
    this.anims.set(unitId, { steps, t0: performance.now(), dur });
    this.request();
    return dur * (steps.length - 1);
  }

  // ---- sprites ----
  buildSprites() {
    const z = this.cam.z, R = HEX_R * z * this.dpr;
    const sw = Math.ceil(SQ3 * R) + 4, sh = Math.ceil(2 * R) + 4;
    this.sprites = []; this.grays = []; this.spriteZ = z; this.spriteW = sw; this.spriteH = sh;
    for (let t = 0; t < TERRAIN.length; t++) {
      const row = [], grow = [];
      for (let v = 0; v < VARIANTS; v++) {
        const c = document.createElement('canvas'); c.width = sw; c.height = sh;
        const x = c.getContext('2d'); x.translate(sw / 2, sh / 2);
        drawTerrainSprite(x, t, v, R);
        row.push(c);
        // faded copy for tiles seen before but not in view now
        const g = document.createElement('canvas'); g.width = sw; g.height = sh;
        const gx = g.getContext('2d'); gx.drawImage(c, 0, 0);
        gx.globalCompositeOperation = 'saturation'; gx.fillStyle = 'rgb(128,128,128)'; gx.fillRect(0, 0, sw, sh);
        gx.globalCompositeOperation = 'destination-in'; gx.drawImage(c, 0, 0);
        grow.push(g);
      }
      this.sprites.push(row); this.grays.push(grow);
    }
    this.fogCv = this.fogCv || document.createElement('canvas');
    this.glyphs.clear(); this.banners.clear();
  }
  glyph(ch, px) {
    px = Math.max(8, Math.round(px));
    const key = ch + px; let c = this.glyphs.get(key);
    if (!c) {
      const s = Math.ceil(px * 1.35 * this.dpr);
      c = document.createElement('canvas'); c.width = s; c.height = s;
      const x = c.getContext('2d'); x.font = `${px * this.dpr}px ${EMOJI_FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(ch, s / 2, s / 2 + px * this.dpr * 0.06);
      this.glyphs.set(key, c);
    }
    return c;
  }
  drawIcon(type, x, y, px) {
    const name = UNIT_ICON[type]; if (!name) return this.drawGlyph(UNITS[type].glyph, x, y, px * 1.4);
    px = Math.max(5, Math.round(px)); const key = '#' + name + px; let c = this.glyphs.get(key);
    if (!c) { c = iconCanvas(name, px, this.dpr); this.glyphs.set(key, c); }
    const s = c.width / this.dpr; this.ctx.drawImage(c, x - s / 2, y - s / 2, s, s);
  }
  drawGlyph(ch, x, y, px) { const c = this.glyph(ch, px), s = c.width / this.dpr; this.ctx.drawImage(c, x - s / 2, y - s / 2, s, s); }

  // ---- main draw ----
  draw(now) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070a0e'; ctx.fillRect(0, 0, this.w, this.h);
    const G = this.G; if (!G) return;
    const z = this.cam.z;
    if (!this.sprites || (!this.gesturing && Math.abs(z / this.spriteZ - 1) > 0.12)) this.buildSprites();
    const m = G.map, W = m.W, H = m.H, P = G.players[this.pid], ex = P.explored, vis = P._vis, nb = G._grid.nb;
    const rs = HEX_R * z, k = z / this.spriteZ, sw = this.spriteW / dpr * k, sh = this.spriteH / dpr * k;
    const [lx, ty] = this.screenToWorld(0, 0), [rx, by] = this.screenToWorld(this.w, this.h);
    const r0 = Math.max(0, Math.floor((ty - HEX_R) / (1.5 * HEX_R)) - 1), r1 = Math.min(H - 1, Math.ceil((by - HEX_R) / (1.5 * HEX_R)) + 1);
    const c0 = Math.floor(lx / (SQ3 * HEX_R)) - 1, c1 = Math.ceil(rx / (SQ3 * HEX_R)) + 1;
    const fog = new Path2D(), dim = new Path2D(), grid = new Path2D(), river = new Path2D(), shore = new Path2D(), foam = new Path2D();
    const tint = new Map(), border = new Map();
    const resList = [], impList = [], road = new Path2D(), rail = new Path2D(), lens = [];
    const far = z < 0.58; // far out: skip icons and lines that are unreadable at this scale
    const lensM = Settings.get('lens') === true ? 'yields' : Settings.get('lens');
    const showGrid = Settings.get('grid') && !far, showRes = Settings.get('resources') && !far, showLens = lensM === 'yields' && !far, relLens = lensM === 'religion';
    const relTint = new Map();
    const hi = Settings.get('quality') !== 'battery';
    const ox = this.w / 2 - this.cam.x * z, oy = this.h / 2 - this.cam.y * z;
    let anyDim = false;
    for (let r = r0; r <= r1; r++) {
      const sy = (1.5 * HEX_R * r + HEX_R) * z + oy;
      for (let c = c0; c <= c1; c++) {
        const i = r * W + ((c % W) + W) % W;
        const sx = SQ3 * HEX_R * (c + 0.5 * (r & 1)) * z + ox;
        if (!ex[i]) { hexPath(fog, sx, sy, rs + 0.6); continue; }
        const t = m.terrain[i], seen = vis[i];
        ctx.drawImage((seen || !hi ? this.sprites : this.grays)[t][(i * 2654435761 >>> 27) % VARIANTS], sx - sw / 2, sy - sh / 2, sw, sh);
        if (!seen) { hexPath(dim, sx, sy, rs + 0.6); anyDim = true; }
        if (showGrid) hexPath(grid, sx, sy, rs);
        const rv = m.river[i];
        if (rv) for (let d = 0; d < 6; d++) if (rv & (1 << d)) edgePath(river, sx, sy, rs, d);
        if (TERRAIN[t].land) for (let d = 0; d < 6; d++) {
          const n = nb[i * 6 + d];
          if (n >= 0 && TERRAIN[m.terrain[n]].water) { edgePath(shore, sx, sy, rs * 0.97, d); edgePath(foam, sx, sy, rs * 1.06, d); }
        }
        const o = m.owner[i];
        if (relLens && o >= 0 && this.relOf) {
          const rel = this.relOf.get(m.ocity[i]);
          if (rel) { const col = REL_COLORS[rel.nameIdx % REL_COLORS.length]; if (!relTint.has(col)) relTint.set(col, new Path2D()); hexPath(relTint.get(col), sx, sy, rs); }
        }
        if (o >= 0) {
          if (!tint.has(o)) { tint.set(o, new Path2D()); border.set(o, new Path2D()); }
          hexPath(tint.get(o), sx, sy, rs);
          for (let d = 0; d < 6; d++) { const n = nb[i * 6 + d]; if (n < 0 || m.owner[n] !== o) edgePath(border.get(o), sx, sy, rs * 0.9, d); }
        }
        if (showRes && m.res[i] >= 0 && resVisible(G, this.pid, m.res[i])) resList.push(m.res[i], sx, sy);
        if (m.improv[i] && !far) impList.push(m.improv[i], sx, sy);
        if (showLens && vis[i] && !G._cityAt.has(i) && !TERRAIN[t].impassable) lens.push(i, sx, sy);
        const rd = roadAt(G, i);
        if (rd) for (let d = 0; d < 6; d++) {
          const n = nb[i * 6 + d]; if (n < 0 || !ex[n]) continue;
          const rn = roadAt(G, n); if (!rn) continue;
          const a = CORNERS[d], b = CORNERS[(d + 1) % 6], mx = sx + (a[0] + b[0]) / 2 * rs, my = sy + (a[1] + b[1]) / 2 * rs;
          const pth = rd >= 2 && rn >= 2 ? rail : road; pth.moveTo(sx, sy); pth.lineTo(mx, my);
        }
      }
    }
    for (const [o, p] of tint) { ctx.globalAlpha = 0.12; ctx.fillStyle = CIVS[G.players[o].civ].color; ctx.fill(p); }
    for (const [col, p] of relTint) { ctx.globalAlpha = 0.38; ctx.fillStyle = col; ctx.fill(p); }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(222,200,140,.55)'; ctx.lineWidth = Math.max(2, 5 * z); ctx.stroke(shore);
    ctx.strokeStyle = 'rgba(235,248,255,.4)'; ctx.lineWidth = Math.max(1, 1.5 * z); ctx.stroke(foam);
    ctx.strokeStyle = '#2f86cf'; ctx.lineWidth = Math.max(2.5, 5 * z); ctx.stroke(river);
    ctx.strokeStyle = '#8fd0ff'; ctx.lineWidth = Math.max(0.8, 1.4 * z); ctx.stroke(river);
    if (showGrid) { ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke(grid); }
    for (let j = 0; j < impList.length; j += 3) {
      const I = IMPROV[impList[j]], x = impList[j + 1], y = impList[j + 2];
      if (I.key === 'farm') {
        ctx.save(); ctx.beginPath(); hexPath(ctx, x, y, rs * 0.72); ctx.clip();
        ctx.fillStyle = 'rgba(214,190,90,.22)'; ctx.fillRect(x - rs, y - rs * 0.1, rs * 2, rs);
        ctx.strokeStyle = 'rgba(240,215,120,.8)'; ctx.lineWidth = Math.max(1, 1.8 * z);
        ctx.beginPath();
        for (let q = -2; q <= 3; q++) { ctx.moveTo(x - rs, y + rs * (0.02 + q * 0.13)); ctx.lineTo(x + rs, y + rs * (-0.12 + q * 0.13)); }
        ctx.stroke(); ctx.restore();
      } else if (rs >= 20 && drawImprovementArt(ctx, I.key, x - rs * 0.36, y + rs * 0.36, rs * 0.3)) {
        // drawn art when zoomed in
      } else {
        const gx = x - rs * 0.42, gy = y + rs * 0.42;
        ctx.fillStyle = 'rgba(20,24,30,.78)'; ctx.beginPath(); ctx.arc(gx, gy, Math.max(7, rs * 0.25), 0, 6.283); ctx.fill();
        this.drawGlyph(I.glyph, gx, gy, Math.max(8, rs * 0.3));
      }
    }
    ctx.strokeStyle = 'rgba(70,45,25,.85)'; ctx.lineWidth = Math.max(2, 4.5 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(205,170,115,.92)'; ctx.lineWidth = Math.max(1, 2.2 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(30,30,34,.9)'; ctx.lineWidth = Math.max(2.5, 5 * z); ctx.stroke(rail);
    ctx.strokeStyle = 'rgba(170,170,180,.95)'; ctx.lineWidth = Math.max(1, 1.6 * z); ctx.setLineDash([3 * z + 1, 2 * z + 1]); ctx.stroke(rail); ctx.setLineDash([]);
    for (let j = 0; j < resList.length; j += 3) {
      const R0 = RES[resList[j]];
      const gx = resList[j + 1] + rs * 0.42, gy = resList[j + 2] + rs * 0.42;
      ctx.fillStyle = R0.kind === 'strategic' ? 'rgba(70,24,12,.82)' : R0.kind === 'luxury' ? 'rgba(74,22,74,.82)' : 'rgba(12,34,22,.78)';
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(7, rs * 0.27), 0, 6.283); ctx.fill();
      ctx.strokeStyle = R0.kind === 'strategic' ? '#e08a5a' : R0.kind === 'luxury' ? '#d58ae0' : '#7fd38a'; ctx.lineWidth = 1; ctx.stroke();
      this.drawGlyph(R0.glyph, gx, gy, Math.max(9, rs * 0.34));
    }
    for (let j = 0; j < lens.length; j += 3) this.drawPips(lens[j + 1], lens[j + 2] - rs * 0.05, tileOutput(G, this.pid, lens[j], null), rs);
    if (anyDim) { ctx.fillStyle = hi ? 'rgba(8,12,18,.34)' : 'rgba(8,12,18,.46)'; ctx.fill(dim); }
    for (const [o, p] of border) {
      const civ = CIVS[G.players[o].civ];
      ctx.strokeStyle = civ.dark; ctx.lineWidth = Math.max(2, 5 * z); ctx.stroke(p);
      ctx.strokeStyle = civ.color; ctx.lineWidth = Math.max(1.2, 2.6 * z); ctx.stroke(p);
    }
    // Fog: sharp fill, plus a low-resolution copy scaled up to feather the edge cheaply
    ctx.fillStyle = '#0b0f15'; ctx.fill(fog);
    if (hi) {
      const f = this.fogCv, sc = 1 / 10, fw = Math.ceil(this.w * sc), fh = Math.ceil(this.h * sc);
      if (f.width !== fw || f.height !== fh) { f.width = fw; f.height = fh; }
      const fx = f.getContext('2d'); fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, fw, fh);
      fx.setTransform(sc, 0, 0, sc, 0, 0); fx.fillStyle = '#0b0f15'; fx.fill(fog);
      ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.9; ctx.drawImage(f, 0, 0, fw, fh, 0, 0, fw / sc, fh / sc); ctx.globalAlpha = 1;
    }

    // overlays
    if (this.reach && this.reach.length) {
      const p = new Path2D(); for (const t of this.reach) { const [x, y] = this.posOf(t); hexPath(p, x, y, rs * 0.92); }
      ctx.fillStyle = 'rgba(127,180,255,.18)'; ctx.fill(p);
      ctx.strokeStyle = 'rgba(160,200,255,.5)'; ctx.lineWidth = 1.2; ctx.stroke(p);
    }
    const focus = this.manage || this.cityFocus;
    if (focus && G.cities.includes(focus)) this.drawCityTiles(focus, rs, !!this.manage);
    // cities (known or remembered)
    const banners = [];
    for (const key in P.seen) {
      const t = +key; const mem = P.seen[key];
      const live = vis[t] ? G._cityAt.get(t) : null;
      const info = live ? { o: live.owner, n: live.name, p: live.pop, cap: live.capital, id: live.id } : { o: mem.o, n: mem.n, p: mem.p, cap: mem.cap, id: mem.id };
      const [x, y] = this.posOf(t);
      if (x < -150 || x > this.w + 150 || y < -80 || y > this.h + 80) continue;
      this.drawCity(x, y, info, rs, !vis[t]);
      banners.push([x, y, info, !vis[t]]);
    }
    // units
    const drawn = [];
    for (const u of G.units) {
      if (u.owner !== this.pid && !vis[u.tile]) continue;
      let [x, y] = this.posOf(u.tile);
      const a = this.anims.get(u.id);
      if (a) {
        const e = Math.max(0, (now - a.t0) / a.dur), st = Math.max(0, Math.min(a.steps.length - 2, Math.floor(e))), f = Math.max(0, Math.min(1, e - st));
        const [x0, y0] = this.posOf(a.steps[st]), [x1, y1] = this.posOf(a.steps[st + 1]);
        let ddx = x1 - x0; const ww = this.worldW * z; if (ddx > ww / 2) ddx -= ww; if (ddx < -ww / 2) ddx += ww;
        x = x0 + ddx * f; y = y0 + (y1 - y0) * f;
      }
      if (x < -60 || x > this.w + 60 || y < -60 || y > this.h + 60) continue;
      drawn.push([u, x, y, !!a]);
    }
    for (const [u, x, y, moving] of drawn) {
      const civ = isCivilianUnit(u), both = !moving && G._mil.has(u.tile) && G._civ.has(u.tile);
      if (!moving && G._cityAt.has(u.tile)) { // garrison: a smaller token at the city's edge so the city stays visible
        this.drawUnit(u, x + (civ ? -rs * 0.5 : rs * 0.5), y + rs * 0.42, rs * 0.62, civ); continue;
      }
      const px = both ? (civ ? x - rs * 0.3 : x + rs * 0.16) : x, py = both ? (civ ? y + rs * 0.26 : y - rs * 0.1) : y + rs * 0.04;
      this.drawUnit(u, px, py, rs, civ);
    }
    if (this.selTile >= 0) {
      const [x, y] = this.posOf(this.selTile);
      ctx.beginPath(); hexPath(ctx, x, y, rs * 0.93);
      ctx.strokeStyle = '#000a'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    for (const [x, y, info, rem] of banners) this.drawBanner(x, y, info, rs, rem);
    if (this.path && this.path.steps.length) this.drawPath(this.path, rs);
    // barbarian camps in view
    for (const cp of G.camps) { if (!vis[cp.tile]) continue; const [x, y] = this.posOf(cp.tile); if (x < -40 || x > this.w + 40 || y < -40 || y > this.h + 40) continue;
      if (!G._mil.has(cp.tile)) { ctx.fillStyle = 'rgba(40,8,6,.8)'; ctx.beginPath(); ctx.arc(x, y, rs * 0.38, 0, 6.283); ctx.fill(); ctx.strokeStyle = '#d0453b'; ctx.lineWidth = 2; ctx.stroke(); }
      this.drawGlyph('🏴', G._mil.has(cp.tile) ? x - rs * 0.45 : x, G._mil.has(cp.tile) ? y + rs * 0.45 : y, G._mil.has(cp.tile) ? rs * 0.32 : rs * 0.48); }
    // attack effects
    for (const f of this.fx) {
      const e = (now - f.t0) / f.dur; if (e < 0) continue;
      if (f.kind === 'shot') {
        const [x0, y0] = this.posOf(f.from), [x1, y1] = this.posOf(f.to), k = Math.min(1, e * 2);
        ctx.strokeStyle = `rgba(255,224,138,${1 - e})`; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k); ctx.stroke(); ctx.setLineDash([]);
      } else {
        const [x, y] = this.posOf(f.tile), fs = Math.max(15, rs * 0.55);
        ctx.globalAlpha = Math.max(0, 1 - e * e);
        ctx.font = `800 ${fs}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const yy = y - rs * (0.5 + (f.dy || 0)) - e * rs * 0.8;
        ctx.lineWidth = 4; ctx.strokeStyle = '#000c'; ctx.strokeText(f.text, x, yy); ctx.fillStyle = f.color; ctx.fillText(f.text, x, yy);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawCityTiles(c, rs, managing) {
    const ctx = this.ctx, G = this.G, area = new Path2D();
    for (const t of c.tiles) { const [x, y] = this.posOf(t); hexPath(area, x, y, rs * 0.97); }
    ctx.strokeStyle = managing ? 'rgba(255,224,138,.7)' : 'rgba(255,255,255,.35)'; ctx.lineWidth = managing ? 2 : 1.2; ctx.stroke(area);
    const work = managing ? workableTiles(G, c) : c.worked;
    for (const t of work) {
      const [x, y] = this.posOf(t), o = tileOutput(G, c.owner, t, c), on = c.worked.includes(t);
      if (managing && !on) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); hexPath(ctx, x, y, rs * 0.9); ctx.fill(); }
      ctx.globalAlpha = on ? 1 : 0.6;
      this.drawPips(x, y - rs * 0.05, o, rs);
      ctx.globalAlpha = 1;
      if (managing && c.locked.includes(t)) this.drawGlyph('📌', x + rs * 0.42, y - rs * 0.42, Math.max(10, rs * 0.32));
    }
    if (managing) {
      for (const t of G._grid.within(c.tile, 3).slice()) {
        const cost = tileBuyCost(G, c, t); if (cost === null || !G.players[c.owner].explored[t]) continue;
        const [x, y] = this.posOf(t);
        ctx.font = `600 ${Math.max(10, rs * 0.3)}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const label = `💰${cost}`, w = ctx.measureText(label).width + 10, hh = Math.max(16, rs * 0.45);
        ctx.fillStyle = 'rgba(10,14,20,.8)'; roundRect(ctx, x - w / 2, y - hh / 2, w, hh, hh / 2); ctx.fill();
        ctx.fillStyle = '#f2d264'; ctx.fillText(label, x, y + 0.5);
      }
    }
  }

  drawPips(x, y, o, rs) {
    const ctx = this.ctx, pr = Math.max(2.2, rs * 0.075), gap = pr * 2.5;
    const groups = [[o.f, '#7fd38a'], [o.p, '#f0a050'], [o.g, '#f2d264']].filter(g => g[0] > 0);
    if (!groups.length) return;
    const total = groups.reduce((a, g) => a + Math.min(4, g[0]), 0) + groups.length - 1;
    const w = total * gap, bx = x - w / 2 + gap / 2;
    ctx.fillStyle = 'rgba(8,12,18,.72)'; roundRect(ctx, x - w / 2 - pr, y - pr * 2, w + pr * 2, pr * 4, pr * 2); ctx.fill();
    let k = 0;
    for (const [n, col] of groups) {
      ctx.fillStyle = col;
      for (let j = 0; j < Math.min(4, n); j++) { ctx.beginPath(); ctx.arc(bx + k * gap, y, pr, 0, 6.283); ctx.fill(); k++; }
      k++;
    }
  }

  drawCity(x, y, c, rs, remembered) {
    const ctx = this.ctx, G = this.G, civ = CIVS[G.players[c.o].civ], z = this.cam.z;
    const live = !remembered && c.id !== undefined ? cityById(G, c.id) : null;
    const has = k => !!live && live.buildings.includes(k);
    const era = live ? playerEra(G.players[live.owner]) : 0;
    ctx.globalAlpha = remembered ? 0.8 : 1;
    const s = rs * 0.62;
    // ground
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(x + s * 0.1, y + s * 0.62, s * 1.05, s * 0.32, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = era >= 3 ? '#8f8a80' : '#8b8170'; ctx.strokeStyle = civ.color; ctx.lineWidth = Math.max(1.5, 2.2 * z);
    ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.98); ctx.fill(); ctx.stroke();
    ctx.fillStyle = era >= 3 ? '#b5afa3' : '#a69b86'; ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.78); ctx.fill();
    if (z > 0.5) { ctx.strokeStyle = 'rgba(70,60,45,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - s * 0.7, y + s * 0.12); ctx.lineTo(x + s * 0.7, y + s * 0.12); ctx.moveTo(x, y - s * 0.6); ctx.lineTo(x, y + s * 0.85); ctx.stroke(); }
    // walls: a stone ring with towers at the corners; castles and bastions are taller
    const wallLvl = has('bastion') ? 3 : has('castle') ? 2 : has('walls') ? 1 : 0;
    if (wallLvl) {
      ctx.strokeStyle = '#4e463b'; ctx.lineWidth = s * 0.17; ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.96); ctx.stroke();
      ctx.strokeStyle = wallLvl >= 3 ? '#9a9488' : '#b9ab90'; ctx.lineWidth = s * 0.1; ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.96); ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3, tx = x + Math.cos(a) * s * 0.96, ty = y + s * 0.12 + Math.sin(a) * s * 0.96, tw = s * (0.1 + wallLvl * 0.025), th = s * (0.12 + wallLvl * 0.07);
        ctx.fillStyle = '#5a5144'; ctx.fillRect(tx - tw - 1, ty - th - 1, tw * 2 + 2, th + 2);
        ctx.fillStyle = '#c9bb9e'; ctx.fillRect(tx - tw, ty - th, tw * 2, th);
        ctx.fillStyle = civ.color; ctx.fillRect(tx - tw, ty - th - s * 0.05, tw * 2, s * 0.05);
      }
    }
    // houses grow with population; their style follows the era
    const style = [{ wall: '#d9c497', roof: '#9b7440', peak: 1.0 }, { wall: '#efe4cc', roof: null, peak: 0.85 }, { wall: '#e8dcc6', roof: null, peak: 1.15, beams: true },
      { wall: '#f2ebdc', roof: '#a5432f', peak: 0.75 }, { wall: '#b86a4e', roof: '#59606a', peak: 0.35, chimney: true }][Math.min(4, era)];
    const n = Math.min(8, 2 + Math.floor(c.p / 2)), spots = [[0, -0.2], [-0.45, 0.05], [0.45, 0.05], [-0.25, 0.4], [0.25, 0.4], [-0.55, -0.32], [0.55, -0.32], [0, 0.62]];
    const items = spots.slice(0, n).map((p, i) => ({ y: p[1], draw: () => {
      const [hx, hy] = p, bx = x + hx * s, byy = y + hy * s, hw = s * (i === 0 ? 0.26 : 0.2), hh = s * (i === 0 ? (c.p >= 8 ? 0.5 : 0.36) : 0.24) * (era >= 4 ? 1.25 : 1);
      ctx.fillStyle = style.wall; ctx.fillRect(bx - hw, byy - hh, hw * 2, hh);
      ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(bx + hw * 0.3, byy - hh, hw * 0.7, hh);
      if (style.beams && z > 0.6) { ctx.strokeStyle = 'rgba(70,45,25,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx - hw, byy - hh * 0.5); ctx.lineTo(bx + hw, byy - hh * 0.5); ctx.moveTo(bx, byy - hh); ctx.lineTo(bx, byy); ctx.stroke(); }
      if (z > 0.7 && hh > 6) { ctx.fillStyle = era >= 2 ? '#f5d77a' : '#4a3a26'; ctx.fillRect(bx - hw * 0.45, byy - hh * 0.62, hw * 0.3, hh * 0.25); }
      ctx.fillStyle = style.roof || (i === 0 ? civ.color : shade(civ.dark, 0.25));
      ctx.beginPath(); ctx.moveTo(bx - hw * 1.2, byy - hh); ctx.lineTo(bx, byy - hh - hw * style.peak * (i === 0 ? 1.1 : 0.85)); ctx.lineTo(bx + hw * 1.2, byy - hh); ctx.closePath(); ctx.fill();
      if (style.chimney && i % 2 === 0) { ctx.fillStyle = '#4b4f57'; ctx.fillRect(bx + hw * 0.4, byy - hh - hw * 0.9, hw * 0.3, hw * 0.7); }
    } }));
    // landmarks
    if (c.cap) items.push({ y: -0.9, draw: () => { // palace dome, behind the houses but tall enough to rise over them
      const px = x + s * 0.28, py = y - s * 0.5, r = s * 0.27;
      ctx.fillStyle = '#e9dcc0'; ctx.fillRect(px - r * 0.9, py - r * 0.9, r * 1.8, r * 0.9);
      ctx.fillStyle = '#efe4cc'; ctx.fillRect(px - r * 1.2, py - r * 0.2, r * 2.4, r * 0.9);
      const gd = ctx.createLinearGradient(px, py - r * 1.3, px, py); gd.addColorStop(0, '#f8e3a0'); gd.addColorStop(1, '#b8892f');
      ctx.fillStyle = gd; ctx.beginPath(); ctx.arc(px, py - r * 0.2, r, Math.PI, 0); ctx.fill();
      ctx.fillStyle = '#b8892f'; ctx.fillRect(px - 1, py - r * 1.5, 2, r * 0.4);
    } });
    if (has('temple') || has('grand_temple') || has('shrine')) items.push({ y: -0.36, draw: () => { // pillared temple
      const tx = x - s * 0.62, ty = y - s * 0.28, w = s * 0.22, hh = s * 0.22, big = has('grand_temple');
      ctx.fillStyle = '#f3ecdc'; ctx.fillRect(tx - w, ty - hh, w * 2, hh);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; for (let k = -1; k <= 1; k += 0.66) ctx.fillRect(tx + k * w * 0.8, ty - hh * 0.85, Math.max(1, w * 0.14), hh * 0.85);
      ctx.fillStyle = big ? '#d9b45a' : '#ddd3bf'; ctx.beginPath(); ctx.moveTo(tx - w * 1.2, ty - hh); ctx.lineTo(tx, ty - hh - w * 0.6); ctx.lineTo(tx + w * 1.2, ty - hh); ctx.closePath(); ctx.fill();
    } });
    if (wallLvl >= 2) items.push({ y: -0.45, draw: () => { // keep
      const kx = x + s * 0.62, ky = y - s * 0.3, w = s * 0.13, hh = s * 0.5;
      ctx.fillStyle = '#b3a68b'; ctx.fillRect(kx - w, ky - hh, w * 2, hh); ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(kx, ky - hh, w, hh);
      ctx.fillStyle = '#b3a68b'; for (let k = -1; k <= 1; k++) ctx.fillRect(kx + k * w * 0.75 - w * 0.22, ky - hh - w * 0.4, w * 0.44, w * 0.4);
      ctx.fillStyle = civ.color; ctx.fillRect(kx - 0.5, ky - hh - w * 1.6, 1.5, w * 1.2); ctx.fillRect(kx + 1, ky - hh - w * 1.6, w * 0.8, w * 0.5);
    } });
    if (has('factory')) items.push({ y: -0.55, draw: () => { // smokestack
      const fx = x + s * 0.3, fy = y - s * 0.5, w = s * 0.07;
      ctx.fillStyle = '#7a4636'; ctx.fillRect(fx - w, fy - s * 0.55, w * 2, s * 0.55);
      ctx.fillStyle = 'rgba(200,200,205,.55)'; const tt = 0.15; // static: no redraw loop, saves battery
      for (let k = 0; k < 3; k++) { const f = (tt + k / 3) % 1; ctx.beginPath(); ctx.arc(fx + f * s * 0.3, fy - s * 0.6 - f * s * 0.45, s * (0.07 + f * 0.1), 0, 6.283); ctx.fill(); }
    } });
    if (has('university') || has('observatory')) items.push({ y: -0.3, draw: () => { // tower with a lens
      const ox = x + s * 0.05, oy = y - s * 0.62, w = s * 0.09;
      ctx.fillStyle = '#e4dccb'; ctx.fillRect(ox - w, oy - s * 0.32, w * 2, s * 0.32);
      ctx.fillStyle = '#6d88a8'; ctx.beginPath(); ctx.arc(ox, oy - s * 0.32, w * 1.3, Math.PI, 0); ctx.fill();
    } });
    if (has('harbor')) items.push({ y: 0.7, draw: () => { // pier and a little sail
      const hx = x - s * 0.75, hy = y + s * 0.62;
      ctx.fillStyle = '#7a5a36'; ctx.fillRect(hx - s * 0.28, hy - s * 0.04, s * 0.42, s * 0.08);
      ctx.fillStyle = '#efe4cc'; ctx.beginPath(); ctx.moveTo(hx - s * 0.2, hy - s * 0.06); ctx.lineTo(hx - s * 0.2, hy - s * 0.32); ctx.lineTo(hx, hy - s * 0.06); ctx.closePath(); ctx.fill();
    } });
    items.sort((a, b) => a.y - b.y); for (const it of items) it.draw();
    // world wonders stand around the city on gold plinths
    if (live && z > 0.45) {
      const ws = live.buildings.filter(k => BUILDINGS[BLDI[k]].wonder || BUILDINGS[BLDI[k]].project);
      const ring = [[0.95, 0.55], [-0.95, 0.55], [1.15, -0.05], [-1.15, -0.05], [0.6, 0.95], [-0.6, 0.95]];
      ws.slice(0, 6).forEach((k, i) => {
        const [ox, oy] = ring[i], wx = x + ox * s, wy = y + oy * s, pr = s * 0.3;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(wx, wy + pr * 0.75, pr * 1.05, pr * 0.35, 0, 0, 6.283); ctx.fill();
        const gg = ctx.createLinearGradient(wx, wy - pr, wx, wy + pr); gg.addColorStop(0, '#f6e09a'); gg.addColorStop(1, '#a8812f');
        ctx.fillStyle = gg; ctx.strokeStyle = '#5a4517'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(wx, wy, pr, 0, 6.283); ctx.fill(); ctx.stroke();
        this.drawGlyph(BUILDINGS[BLDI[k]].glyph, wx, wy, pr * 1.25);
      });
    }
    ctx.globalAlpha = 1;
  }
  drawBanner(x, y, c, rs, remembered) {
    const ctx = this.ctx, civ = CIVS[this.G.players[c.o].civ];
    ctx.globalAlpha = remembered ? 0.8 : 1;
    const fs = Math.max(10, Math.min(15, 12 * this.cam.z + 2));
    const label = (c.cap ? '★ ' : '') + c.n;
    const info = !remembered && c.o === this.pid && this.cityInfo ? this.cityInfo.get(c.id) : null;
    ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width, bh2 = fs * 1.6, pw = bh2;
    let extraW = 0, prodLabel = '';
    if (info && info.prod) { prodLabel = String(info.turns); ctx.font = `600 ${fs * 0.85}px -apple-system, system-ui, sans-serif`; extraW = ctx.measureText(prodLabel).width + fs * 1.5; ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`; }
    const rel = this.relOf && c.id !== undefined ? this.relOf.get(c.id) : null;
    const relW = rel ? fs * 1.3 : 0;
    const bw2 = tw + pw + fs * 0.9 + extraW + relW;
    const bx = x - bw2 / 2, by = y - rs * 0.9 - bh2;
    ctx.fillStyle = 'rgba(10,14,20,.9)'; ctx.strokeStyle = civ.color; ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, bw2, bh2, bh2 / 2); ctx.fill(); ctx.stroke();
    const cx = bx + bh2 / 2, cy = by + bh2 / 2, rr = bh2 / 2 - 2;
    ctx.fillStyle = civ.color; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.283); ctx.fill();
    if (info && info.grow > 0) { ctx.strokeStyle = '#7fd38a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, rr + 0.5, -Math.PI / 2, -Math.PI / 2 + 6.283 * Math.min(1, info.grow)); ctx.stroke(); }
    ctx.fillStyle = '#10141a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(c.p), cx, cy + 0.5);
    ctx.fillStyle = '#f2f5f8'; ctx.textAlign = 'left';
    ctx.fillText(label, bx + pw + fs * 0.25, cy + 0.5);
    const live = !remembered && c.id !== undefined ? cityById(this.G, c.id) : null;
    if (live) { const mx = cityMaxHp(this.G, live); if (live.hp < mx) { const w = bw2 * 0.8, hx = x - w / 2, hy = by + bh2 + 2; ctx.fillStyle = '#000b'; ctx.fillRect(hx - 1, hy - 1, w + 2, 6); ctx.fillStyle = live.hp / mx > 0.5 ? '#7fd38a' : live.hp / mx > 0.25 ? '#f2d264' : '#ec6a5f'; ctx.fillRect(hx, hy, w * live.hp / mx, 4); } }
    if (rel) this.drawGlyph(rel.glyph, bx + pw + fs * 0.25 + tw + fs * 0.75, cy, fs * 0.95);
    if (prodLabel) {
      const gx = bx + pw + fs * 0.25 + tw + fs * 0.55 + relW;
      this.drawGlyph(info.prod, gx + fs * 0.45, cy, fs * 0.9);
      ctx.font = `600 ${fs * 0.85}px -apple-system, system-ui, sans-serif`; ctx.fillStyle = '#e8c26a';
      ctx.fillText(prodLabel, gx + fs * 1.05, cy + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  drawUnit(u, x, y, rs, civilian) {
    const ctx = this.ctx, civ = CIVS[this.G.players[u.owner].civ], own = u.owner === this.pid;
    const rad = rs * (civilian ? 0.3 : 0.38);
    const ready = own && u.moves > 0 && !u.order && !u.skip;
    const shape = () => {
      ctx.beginPath();
      if (civilian) ctx.arc(x, y, rad, 0, 6.283);
      else { // shield
        ctx.moveTo(x - rad, y - rad * 0.85); ctx.quadraticCurveTo(x, y - rad * 1.15, x + rad, y - rad * 0.85);
        ctx.lineTo(x + rad * 0.95, y + rad * 0.15); ctx.quadraticCurveTo(x + rad * 0.7, y + rad * 0.85, x, y + rad * 1.15);
        ctx.quadraticCurveTo(x - rad * 0.7, y + rad * 0.85, x - rad * 0.95, y + rad * 0.15); ctx.closePath();
      }
    };
    const emb = isEmbarked(this.G, u);
    if (emb) { ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.moveTo(x - rad * 1.25, y + rad * 0.55); ctx.lineTo(x + rad * 1.25, y + rad * 0.55); ctx.lineTo(x + rad * 0.85, y + rad * 1.05); ctx.lineTo(x - rad * 0.85, y + rad * 1.05); ctx.closePath(); ctx.fill(); }
    ctx.save(); ctx.translate(1.5, 2.5); shape(); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); ctx.restore();
    shape();
    const g = ctx.createLinearGradient(x, y - rad, x, y + rad);
    g.addColorStop(0, shade(civ.color, 0.22)); g.addColorStop(1, shade(civ.color, -0.18));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.2 * this.cam.z);
    ctx.strokeStyle = ready ? '#ffffff' : civ.dark; ctx.stroke();
    this.drawIcon(u.type, x, y - (civilian ? 0 : rad * 0.04), rad * (civilian ? 0.66 : 0.74));
    if (UNITS[u.type].civ) { const bx = x + rad * 0.82, by = y + rad * 0.62, br = Math.max(3, rad * 0.2); ctx.beginPath(); ctx.moveTo(bx, by - br); ctx.lineTo(bx + br, by); ctx.lineTo(bx, by + br); ctx.lineTo(bx - br, by); ctx.closePath(); ctx.fillStyle = '#f2d264'; ctx.fill(); ctx.strokeStyle = '#3d2f0c'; ctx.lineWidth = 1; ctx.stroke(); }
    if (own && u.order && u.order.t !== 'goto') {
      const lab = { fortify: 'F', sleep: 'Z', explore: 'E', auto: 'A', heal: '+' }[u.order.t] || '';
      if (lab) {
        const bx = x + rad * 0.85, by = y - rad * 0.85, br = Math.max(6, rad * 0.38);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.283); ctx.fillStyle = '#121a24'; ctx.fill(); ctx.strokeStyle = '#cfd8e3'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#e8eef5'; ctx.font = `700 ${br * 1.2}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lab, bx, by + 0.5);
      }
    }
    if (u.hp < 100) {
      const w = rad * 1.7, hx = x - w / 2, hy = y + rad * 1.18;
      ctx.fillStyle = '#000b'; ctx.fillRect(hx - 1, hy - 1, w + 2, 5);
      ctx.fillStyle = u.hp > 60 ? '#7fd38a' : u.hp > 30 ? '#f2d264' : '#ec6a5f'; ctx.fillRect(hx, hy, w * u.hp / 100, 3);
    }
    if (u.promos && u.promos.length) { ctx.fillStyle = '#ffe08a'; ctx.font = `700 ${Math.max(8, rad * 0.5)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★'.repeat(Math.min(3, u.promos.length)), x, y - rad * 1.25); }
    if (own && promoChoices(this.G, u).length) { const bx = x - rad * 0.9, by = y + rad * 0.75, br = Math.max(6, rad * 0.36); ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.283); ctx.fillStyle = '#ffe08a'; ctx.fill(); ctx.fillStyle = '#1d1607'; ctx.font = `800 ${br * 1.2}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★', bx, by + 0.5); }
    if (own && u.charges !== undefined) {
      const bx = x - rad * 0.9, by = y - rad * 0.85, br = Math.max(6, rad * 0.36);
      ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.283); ctx.fillStyle = '#e8c26a'; ctx.fill();
      ctx.fillStyle = '#1d1607'; ctx.font = `700 ${br * 1.2}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.charges), bx, by + 0.5);
    }
  }

  drawPath(path, rs) {
    const ctx = this.ctx, pts = [this.posOf(path.from)];
    for (const st of path.steps) {
      const prev = pts[pts.length - 1]; let [x, y] = this.posOf(st.t);
      const ww = this.worldW * this.cam.z; if (x - prev[0] > ww / 2) x -= ww; if (x - prev[0] < -ww / 2) x += ww;
      pts.push([x, y]);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = '#000a'; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = path.ok ? '#ffe08a' : '#ff8a7a'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
    path.steps.forEach((st, i) => {
      const [x, y] = pts[i + 1];
      const last = i === path.steps.length - 1, turnEnd = last || path.steps[i + 1].turn !== st.turn;
      if (!turnEnd) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.283); ctx.fillStyle = '#ffe08a'; ctx.fill(); return; }
      const r = Math.max(9, rs * 0.3);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fillStyle = last ? '#ffe08a' : '#1b2430'; ctx.fill();
      ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = last ? '#1b1405' : '#ffe08a'; ctx.font = `700 ${r * 1.05}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(st.turn + 1), x, y + 0.5);
    });
  }

  // Whole explored world, scaled to fit a w x h box.
  drawWorld(cv, w, h) {
    const G = this.G, P = G.players[this.pid], m = G.map, W = m.W, H = m.H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2), cx = cv.getContext('2d');
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tw = w / (W + 0.5), th = h / H;
    cx.fillStyle = '#0b0f15'; cx.fillRect(0, 0, w, h);
    for (let i = 0; i < W * H; i++) {
      if (!P.explored[i]) continue;
      const c = i % W, r = (i / W) | 0, o = m.owner[i];
      cx.fillStyle = o >= 0 ? CIVS[G.players[o].civ].color : TERRAIN[m.terrain[i]].color;
      cx.globalAlpha = o >= 0 ? 0.85 : P._vis[i] ? 1 : 0.6;
      cx.fillRect((c + 0.5 * (r & 1)) * tw, r * th, tw + 0.6, th + 0.6);
    }
    cx.globalAlpha = 1;
    for (const k in P.seen) { const t = +k, c = t % W, r = (t / W) | 0; cx.fillStyle = '#fff'; cx.fillRect((c + 0.5 * (r & 1)) * tw - 1, r * th - 1, tw + 2, th + 2); }
    for (const u of G.units) if (u.owner === this.pid) { const c = u.tile % W, r = (u.tile / W) | 0; cx.fillStyle = '#ffe08a'; cx.beginPath(); cx.arc((c + 0.5 * (r & 1) + 0.5) * tw, (r + 0.5) * th, Math.max(1.5, tw * 0.45), 0, 6.283); cx.fill(); }
    // camera view
    const vw = this.w / this.cam.z / (SQ3 * HEX_R) * tw, vh = this.h / this.cam.z / (1.5 * HEX_R) * th;
    const vx = this.cam.x / (SQ3 * HEX_R) * tw - vw / 2, vy = (this.cam.y - HEX_R) / (1.5 * HEX_R) * th - vh / 2;
    cx.strokeStyle = '#ffffff'; cx.lineWidth = 1.5;
    for (const off of [-w, 0, w]) cx.strokeRect(vx + off, vy, vw, vh);
    return { tw, th };
  }
}

// Small painted improvements, centred at x,y with half-size r. Returns false for kinds without art.
function drawImprovementArt(ctx, key, x, y, r) {
  ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const shadow = () => { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y + r * 0.62, r * 1.05, r * 0.28, 0, 0, 6.283); ctx.fill(); };
  switch (key) {
    case 'mine': shadow();
      ctx.fillStyle = '#6b5a45'; ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.6); ctx.lineTo(x - r * 0.3, y - r * 0.7); ctx.lineTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x + r, y + r * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1b140d'; ctx.beginPath(); ctx.moveTo(x - r * 0.42, y + r * 0.6); ctx.lineTo(x - r * 0.42, y - r * 0.05); ctx.quadraticCurveTo(x, y - r * 0.45, x + r * 0.42, y - r * 0.05); ctx.lineTo(x + r * 0.42, y + r * 0.6); ctx.fill();
      ctx.strokeStyle = '#a77a45'; ctx.lineWidth = r * 0.16; ctx.beginPath(); ctx.moveTo(x - r * 0.48, y + r * 0.6); ctx.lineTo(x - r * 0.48, y - r * 0.1); ctx.lineTo(x + r * 0.48, y - r * 0.1); ctx.lineTo(x + r * 0.48, y + r * 0.6); ctx.stroke();
      ctx.fillStyle = '#8c8c94'; ctx.fillRect(x + r * 0.55, y + r * 0.25, r * 0.4, r * 0.25); break;
    case 'quarry': shadow();
      for (const [dx, dy, w] of [[-0.55, 0.2, 0.5], [0.05, 0.2, 0.55], [-0.3, -0.25, 0.55], [0.4, -0.2, 0.4]]) {
        ctx.fillStyle = '#d7d0c0'; ctx.fillRect(x + dx * r, y + dy * r, w * r, r * 0.4); ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x + (dx + w * 0.6) * r, y + dy * r, w * 0.4 * r, r * 0.4); } break;
    case 'lumbermill': shadow();
      for (let k = 0; k < 3; k++) { const ly = y + r * (0.35 - k * 0.28), lx = x - r * 0.15 + k * r * 0.12; ctx.fillStyle = '#8a5a30'; ctx.fillRect(lx - r * 0.7, ly - r * 0.14, r * 1.2, r * 0.28); ctx.fillStyle = '#e1b77c'; ctx.beginPath(); ctx.arc(lx + r * 0.5, ly, r * 0.14, 0, 6.283); ctx.fill(); }
      ctx.fillStyle = '#c9ccd2'; ctx.beginPath(); ctx.arc(x + r * 0.75, y - r * 0.45, r * 0.3, 0, 6.283); ctx.fill(); ctx.fillStyle = '#555a62'; ctx.beginPath(); ctx.arc(x + r * 0.75, y - r * 0.45, r * 0.09, 0, 6.283); ctx.fill(); break;
    case 'pasture':
      ctx.strokeStyle = '#8a6236'; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.1); ctx.lineTo(x + r, y - r * 0.1); ctx.moveTo(x - r, y + r * 0.45); ctx.lineTo(x + r, y + r * 0.25); ctx.stroke();
      ctx.lineWidth = r * 0.13; ctx.beginPath(); for (let k = -1; k <= 1; k++) { ctx.moveTo(x + k * r * 0.8, y - r * 0.15 - k * r * 0.08); ctx.lineTo(x + k * r * 0.8, y + r * 0.6 - k * r * 0.08); } ctx.stroke(); break;
    case 'plantation': shadow();
      for (let k = 0; k < 6; k++) { const bx = x + ((k % 3) - 1) * r * 0.62, by = y + (Math.floor(k / 3) - 0.3) * r * 0.55; ctx.fillStyle = '#2f6b2c'; ctx.beginPath(); ctx.arc(bx, by, r * 0.24, 0, 6.283); ctx.fill(); ctx.fillStyle = '#5ea648'; ctx.beginPath(); ctx.arc(bx - r * 0.06, by - r * 0.06, r * 0.13, 0, 6.283); ctx.fill(); } break;
    case 'camp': shadow();
      ctx.fillStyle = '#c9a36b'; ctx.beginPath(); ctx.moveTo(x - r * 0.8, y + r * 0.55); ctx.lineTo(x, y - r * 0.7); ctx.lineTo(x + r * 0.8, y + r * 0.55); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#4b3420'; ctx.beginPath(); ctx.moveTo(x - r * 0.2, y + r * 0.55); ctx.lineTo(x, y + r * 0.05); ctx.lineTo(x + r * 0.2, y + r * 0.55); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.moveTo(x - r * 0.15, y - r * 0.9); ctx.lineTo(x + r * 0.12, y - r * 0.5); ctx.moveTo(x + r * 0.15, y - r * 0.9); ctx.lineTo(x - r * 0.12, y - r * 0.5); ctx.stroke(); break;
    case 'boats':
      ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.moveTo(x - r * 0.8, y + r * 0.2); ctx.lineTo(x + r * 0.8, y + r * 0.2); ctx.lineTo(x + r * 0.5, y + r * 0.55); ctx.lineTo(x - r * 0.5, y + r * 0.55); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.moveTo(x, y + r * 0.2); ctx.lineTo(x, y - r * 0.75); ctx.stroke();
      ctx.fillStyle = '#efe4cc'; ctx.beginPath(); ctx.moveTo(x + r * 0.05, y - r * 0.7); ctx.lineTo(x + r * 0.6, y + r * 0.1); ctx.lineTo(x + r * 0.05, y + r * 0.1); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(230,240,250,.6)'; ctx.lineWidth = r * 0.05; ctx.beginPath(); ctx.moveTo(x - r * 0.9, y + r * 0.75); ctx.quadraticCurveTo(x - r * 0.5, y + r * 0.6, x - r * 0.1, y + r * 0.75); ctx.stroke(); break;
    case 'fort': shadow();
      ctx.fillStyle = '#8a6236'; for (let k = -3; k <= 3; k++) { const px = x + k * r * 0.26; ctx.beginPath(); ctx.moveTo(px - r * 0.11, y + r * 0.55); ctx.lineTo(px - r * 0.11, y - r * 0.25); ctx.lineTo(px, y - r * 0.45); ctx.lineTo(px + r * 0.11, y - r * 0.25); ctx.lineTo(px + r * 0.11, y + r * 0.55); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x - r * 0.9, y + r * 0.1, r * 1.8, r * 0.1); break;
    default: ctx.restore(); return false;
  }
  ctx.restore(); return true;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const VARIANTS = 4;
function drawTerrainSprite(x, t, v, R) {
  const base = TERRAIN[t].color, rnd = lcg(t * 97 + v * 13 + 7);
  const L = Math.max(1, R * 0.045);
  const pts = (n, spread) => { const a = []; for (let i = 0; i < n; i++) a.push([(rnd() - 0.5) * 2 * spread * R, (rnd() - 0.5) * 2 * spread * R]); return a; };
  const blob = (cx, cy, rx, ry, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, rnd() * 3, 0, 6.283); x.fill(); };
  x.save();
  x.beginPath(); hexPath(x, 0, 0, R + 0.8); x.clip();
  const gr = x.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.25);
  gr.addColorStop(0, shade(base, 0.1)); gr.addColorStop(1, shade(base, -0.14));
  x.fillStyle = gr; x.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
  // soft patches and grain so tiles do not look flat
  for (let k = 0; k < 3; k++) blob((rnd() - 0.5) * R, (rnd() - 0.5) * R, R * (0.25 + rnd() * 0.3), R * (0.15 + rnd() * 0.2), rnd() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)');
  for (let k = 0; k < 70; k++) { x.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.07)'; const [px, py] = pts(1, 0.95)[0]; x.fillRect(px, py, L * 0.9, L * 0.9); }
  const tree = (px, py, s, conifer) => {
    x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(px + s * 0.25, py + s * 0.55, s * 0.6, s * 0.22, 0, 0, 6.283); x.fill();
    x.fillStyle = '#4b3420'; x.fillRect(px - L * 0.6, py + s * 0.2, L * 1.2, s * 0.45);
    if (conifer) {
      for (let k = 0; k < 2; k++) {
        const yy = py - s * 0.15 * k, ww = s * (0.68 - k * 0.14);
        x.fillStyle = shade(base, -0.3 + k * 0.08); x.beginPath(); x.moveTo(px, yy - s * 0.95); x.lineTo(px + ww, yy + s * 0.35); x.lineTo(px - ww, yy + s * 0.35); x.closePath(); x.fill();
      }
      x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath(); x.moveTo(px, py - s * 1.1); x.lineTo(px - s * 0.5, py + s * 0.2); x.lineTo(px - s * 0.1, py + s * 0.2); x.closePath(); x.fill();
    } else {
      x.fillStyle = shade(base, -0.26); x.beginPath(); x.arc(px, py - s * 0.15, s * 0.62, 0, 6.283); x.fill();
      x.fillStyle = shade(base, -0.08); x.beginPath(); x.arc(px - s * 0.18, py - s * 0.32, s * 0.38, 0, 6.283); x.fill();
      x.fillStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.arc(px - s * 0.28, py - s * 0.42, s * 0.16, 0, 6.283); x.fill();
    }
  };
  if (t === T.GRASS) {
    x.strokeStyle = shade(base, -0.3); x.lineWidth = L;
    for (const [px, py] of pts(11, 0.62)) { x.beginPath(); x.moveTo(px - R * 0.05, py); x.lineTo(px, py - R * 0.11); x.lineTo(px + R * 0.05, py); x.stroke(); }
    if (v === 3) for (const [px, py] of pts(3, 0.5)) { x.fillStyle = '#f3e27a'; x.beginPath(); x.arc(px, py, L * 1.1, 0, 6.283); x.fill(); }
  } else if (t === T.PLAINS) {
    for (const [px, py] of pts(3, 0.45)) blob(px, py, R * 0.32, R * 0.16, 'rgba(230,200,110,.18)');
    x.strokeStyle = shade(base, 0.28); x.lineWidth = L;
    for (const [px, py] of pts(9, 0.6)) { x.beginPath(); x.moveTo(px - R * 0.1, py); x.lineTo(px + R * 0.1, py - R * 0.02); x.stroke(); }
    x.strokeStyle = shade(base, -0.25);
    for (const [px, py] of pts(6, 0.55)) { x.beginPath(); x.moveTo(px, py + R * 0.06); x.lineTo(px + R * 0.02, py - R * 0.09); x.stroke(); }
  } else if (t === T.DESERT) {
    for (let k = 0; k < 3; k++) {
      const py = (k - 1) * R * 0.42 + (rnd() - 0.5) * R * 0.2, px = (rnd() - 0.5) * R * 0.5, rr = R * (0.34 + rnd() * 0.1);
      x.fillStyle = shade(base, -0.12); x.beginPath(); x.ellipse(px + rr * 0.15, py + R * 0.1, rr, rr * 0.35, 0, Math.PI, 0); x.fill();
      x.fillStyle = shade(base, 0.12); x.beginPath(); x.ellipse(px - rr * 0.1, py + R * 0.1, rr * 0.75, rr * 0.28, 0, Math.PI, Math.PI * 1.6); x.fill();
    }
  } else if (t === T.TUNDRA) {
    for (const [px, py] of pts(4, 0.55)) blob(px, py, R * (0.14 + rnd() * 0.16), R * 0.08, 'rgba(240,248,255,.38)');
    x.fillStyle = 'rgba(240,248,255,.5)'; for (const [px, py] of pts(14, 0.65)) x.fillRect(px, py, L * 1.4, L * 1.4);
    x.strokeStyle = shade(base, -0.28); x.lineWidth = L;
    for (const [px, py] of pts(5, 0.5)) { x.beginPath(); x.moveTo(px - R * 0.06, py); x.lineTo(px + R * 0.06, py); x.stroke(); }
  } else if (t === T.HILLS) {
    const hs = v % 2 ? [[-0.34, 0.18, 0.44], [0.32, 0.26, 0.38], [0.02, -0.24, 0.36]] : [[-0.2, 0.05, 0.5], [0.36, 0.32, 0.34], [-0.3, -0.38, 0.28]];
    hs.sort((a, b) => a[1] - b[1]);
    for (const [hx, hy, hr] of hs) {
      const cx = hx * R, cy = hy * R + R * 0.1, rx = hr * R, ry = hr * R * 0.66;
      x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(cx + rx * 0.2, cy + ry * 0.05, rx, ry * 0.35, 0, 0, 6.283); x.fill();
      const hg = x.createLinearGradient(cx - rx, cy - ry, cx + rx, cy);
      hg.addColorStop(0, shade(base, 0.25)); hg.addColorStop(0.55, shade(base, -0.05)); hg.addColorStop(1, shade(base, -0.3));
      x.fillStyle = hg; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, Math.PI, 0); x.closePath(); x.fill();
    }
  } else if (t === T.FOREST) {
    const n = 7 + (v % 2) * 2, trees = pts(n, 0.55).sort((a, b) => a[1] - b[1]);
    for (const [px, py] of trees) tree(px, py, R * (0.18 + rnd() * 0.07), v < 2 ? true : rnd() < 0.3);
  } else if (t === T.MARSH) {
    for (const [px, py] of pts(4, 0.45)) { blob(px, py, R * (0.18 + rnd() * 0.12), R * (0.08 + rnd() * 0.05), 'rgba(90,140,160,.55)'); }
    x.strokeStyle = 'rgba(200,230,240,.25)'; x.lineWidth = L * 0.8;
    for (const [px, py] of pts(3, 0.4)) { x.beginPath(); x.moveTo(px - R * 0.1, py); x.lineTo(px + R * 0.1, py); x.stroke(); }
    x.strokeStyle = shade(base, -0.38); x.lineWidth = L;
    for (const [px, py] of pts(10, 0.58)) { x.beginPath(); x.moveTo(px, py); x.lineTo(px - R * 0.04, py - R * 0.17); x.moveTo(px, py); x.lineTo(px + R * 0.05, py - R * 0.15); x.stroke(); }
  } else if (t === T.MOUNTAIN) {
    const peaks = v % 2 ? [[-0.3, 0.42, 0.42], [0.26, 0.45, 0.36], [0, 0.28, 0.55]] : [[-0.18, 0.4, 0.5], [0.3, 0.38, 0.4], [-0.42, 0.5, 0.26]];
    peaks.sort((a, b) => a[1] - b[1]);
    for (const [px, by0, hgt] of peaks) {
      const bx = px * R, by = by0 * R, top = by - hgt * R * 1.55, hw = hgt * R * 0.9;
      x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse(bx + hw * 0.3, by, hw * 1.05, hw * 0.25, 0, 0, 6.283); x.fill();
      x.fillStyle = '#58534e'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx + hw, by); x.closePath(); x.fill();
      x.fillStyle = '#958e86'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx - hw * 0.05, by); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = L * 0.8; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.15, by * 0.6 + top * 0.4); x.stroke();
      x.fillStyle = '#f4f7f9'; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.34, top + hgt * R * 0.52); x.lineTo(bx + hw * 0.08, top + hgt * R * 0.42); x.lineTo(bx - hw * 0.12, top + hgt * R * 0.55); x.lineTo(bx - hw * 0.32, top + hgt * R * 0.5); x.closePath(); x.fill();
    }
  } else if (t === T.COAST || t === T.OCEAN) {
    const deep = t === T.OCEAN;
    if (!deep) for (const [px, py] of pts(4, 0.5)) blob(px, py, R * 0.25, R * 0.12, 'rgba(255,255,255,.05)');
    x.strokeStyle = deep ? 'rgba(170,210,240,.16)' : 'rgba(225,248,255,.3)'; x.lineWidth = L * 1.1;
    for (const [px, py] of pts(deep ? 3 : 4, 0.5)) {
      x.beginPath(); x.arc(px - R * 0.08, py, R * 0.09, Math.PI * 1.1, Math.PI * 1.9); x.arc(px + R * 0.1, py, R * 0.09, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
    }
  }
  x.restore();
}
