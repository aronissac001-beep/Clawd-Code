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
    this.selTile = -1; this.path = null; this.reach = null; this.raf = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }
  resize() {
    const hi = Settings.get('quality') !== 'battery';
    this.dpr = Math.min(window.devicePixelRatio || 1, hi ? 3 : 1.5);
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
    this.sprites = []; this.spriteZ = z; this.spriteW = sw; this.spriteH = sh;
    for (let t = 0; t < TERRAIN.length; t++) {
      const row = [];
      for (let v = 0; v < 3; v++) {
        const c = document.createElement('canvas'); c.width = sw; c.height = sh;
        const x = c.getContext('2d'); x.translate(sw / 2, sh / 2);
        drawTerrainSprite(x, t, v, R);
        row.push(c);
      }
      this.sprites.push(row);
    }
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
    const fog = new Path2D(), dim = new Path2D(), grid = new Path2D(), river = new Path2D(), coast = new Path2D();
    const tint = new Map(), border = new Map();
    const resList = [], impList = [], road = new Path2D(), rail = new Path2D();
    const showGrid = Settings.get('grid'), showRes = Settings.get('resources');
    const ox = this.w / 2 - this.cam.x * z, oy = this.h / 2 - this.cam.y * z;
    for (let r = r0; r <= r1; r++) {
      const sy = (1.5 * HEX_R * r + HEX_R) * z + oy;
      for (let c = c0; c <= c1; c++) {
        const i = r * W + ((c % W) + W) % W;
        const sx = SQ3 * HEX_R * (c + 0.5 * (r & 1)) * z + ox;
        if (!ex[i]) { hexPath(fog, sx, sy, rs + 0.6); continue; }
        const t = m.terrain[i];
        ctx.drawImage(this.sprites[t][(i * 2654435761 >>> 28) % 3], sx - sw / 2, sy - sh / 2, sw, sh);
        if (!vis[i]) hexPath(dim, sx, sy, rs + 0.6);
        if (showGrid) hexPath(grid, sx, sy, rs);
        const rv = m.river[i];
        if (rv) for (let d = 0; d < 6; d++) if (rv & (1 << d)) edgePath(river, sx, sy, rs, d);
        if (TERRAIN[t].land) for (let d = 0; d < 6; d++) { const n = nb[i * 6 + d]; if (n >= 0 && TERRAIN[m.terrain[n]].water) edgePath(coast, sx, sy, rs, d); }
        const o = m.owner[i];
        if (o >= 0) {
          if (!tint.has(o)) { tint.set(o, new Path2D()); border.set(o, new Path2D()); }
          hexPath(tint.get(o), sx, sy, rs);
          for (let d = 0; d < 6; d++) { const n = nb[i * 6 + d]; if (n < 0 || m.owner[n] !== o) edgePath(border.get(o), sx, sy, rs * 0.9, d); }
        }
        if (showRes && m.res[i] >= 0 && resVisible(G, this.pid, m.res[i])) resList.push(m.res[i], sx, sy);
        if (m.improv[i]) impList.push(m.improv[i], sx, sy);
        const rd = roadAt(G, i);
        if (rd) for (let d = 0; d < 6; d++) {
          const n = nb[i * 6 + d]; if (n < 0 || !ex[n]) continue;
          const rn = roadAt(G, n); if (!rn) continue;
          const a = CORNERS[d], b = CORNERS[(d + 1) % 6], mx = sx + (a[0] + b[0]) / 2 * rs, my = sy + (a[1] + b[1]) / 2 * rs;
          const pth = rd >= 2 && rn >= 2 ? rail : road; pth.moveTo(sx, sy); pth.lineTo(mx, my);
        }
      }
    }
    for (const [o, p] of tint) { ctx.globalAlpha = 0.13; ctx.fillStyle = CIVS[G.players[o].civ].color; ctx.fill(p); }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(225,240,250,.35)'; ctx.lineWidth = Math.max(1, 1.6 * z); ctx.stroke(coast);
    ctx.strokeStyle = '#3f9be0'; ctx.lineWidth = Math.max(2, 4.2 * z); ctx.stroke(river);
    ctx.strokeStyle = '#a8dcff'; ctx.lineWidth = Math.max(0.8, 1.3 * z); ctx.stroke(river);
    if (showGrid) { ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1; ctx.stroke(grid); }
    for (let j = 0; j < impList.length; j += 3) {
      const I = IMPROV[impList[j]], x = impList[j + 1], y = impList[j + 2];
      if (I.key === 'farm') {
        ctx.strokeStyle = 'rgba(240,215,120,.75)'; ctx.lineWidth = Math.max(1, 2 * z);
        ctx.beginPath();
        for (let k = -1; k <= 1; k++) { ctx.moveTo(x - rs * 0.5, y + rs * (0.15 + k * 0.18)); ctx.lineTo(x + rs * 0.5, y + rs * (0.05 + k * 0.18)); }
        ctx.stroke();
      } else {
        const gx = x - rs * 0.42, gy = y + rs * 0.42;
        ctx.fillStyle = 'rgba(20,24,30,.75)'; ctx.beginPath(); ctx.arc(gx, gy, Math.max(7, rs * 0.25), 0, 6.283); ctx.fill();
        this.drawGlyph(I.glyph, gx, gy, Math.max(8, rs * 0.3));
      }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(70,45,25,.85)'; ctx.lineWidth = Math.max(2, 4.5 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(196,160,110,.9)'; ctx.lineWidth = Math.max(1, 2.2 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(30,30,34,.9)'; ctx.lineWidth = Math.max(2.5, 5 * z); ctx.stroke(rail);
    ctx.strokeStyle = 'rgba(170,170,180,.95)'; ctx.lineWidth = Math.max(1, 1.6 * z); ctx.setLineDash([3 * z + 1, 2 * z + 1]); ctx.stroke(rail); ctx.setLineDash([]);
    for (let j = 0; j < resList.length; j += 3) {
      const R0 = RES[resList[j]];
      const gx = resList[j + 1] + rs * 0.42, gy = resList[j + 2] + rs * 0.42;
      ctx.fillStyle = R0.kind === 'strategic' ? 'rgba(60,20,10,.8)' : R0.kind === 'luxury' ? 'rgba(70,20,70,.8)' : 'rgba(10,30,20,.75)';
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(7, rs * 0.27), 0, 6.283); ctx.fill();
      this.drawGlyph(R0.glyph, gx, gy, Math.max(9, rs * 0.34));
    }
    ctx.fillStyle = 'rgba(8,12,18,.46)'; ctx.fill(dim);
    for (const [o, p] of border) {
      const civ = CIVS[G.players[o].civ];
      ctx.strokeStyle = civ.dark; ctx.lineWidth = Math.max(2, 5 * z); ctx.stroke(p);
      ctx.strokeStyle = civ.color; ctx.lineWidth = Math.max(1.2, 2.6 * z); ctx.stroke(p);
    }
    ctx.fillStyle = '#0b0f15'; ctx.fill(fog);

    // overlays
    if (this.reach && this.reach.length) {
      const p = new Path2D(); for (const t of this.reach) { const [x, y] = this.posOf(t); hexPath(p, x, y, rs * 0.92); }
      ctx.fillStyle = 'rgba(127,180,255,.18)'; ctx.fill(p);
      ctx.strokeStyle = 'rgba(160,200,255,.5)'; ctx.lineWidth = 1.2; ctx.stroke(p);
    }
    // worked tiles of the selected own city
    if (this.cityFocus && G.cities.includes(this.cityFocus)) {
      const c = this.cityFocus, area = new Path2D();
      for (const t of c.tiles) { const [x, y] = this.posOf(t); hexPath(area, x, y, rs * 0.97); }
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.2; ctx.stroke(area);
      for (const t of c.worked) {
        const [x, y] = this.posOf(t), o = tileOutput(G, c.owner, t, c);
        this.drawPips(x, y - rs * 0.05, o, rs);
      }
    }
    // cities (known or remembered)
    const banners = [];
    for (const key in P.seen) {
      const t = +key; const mem = P.seen[key];
      const live = vis[t] ? G._cityAt.get(t) : null;
      const info = live ? { o: live.owner, n: live.name, p: live.pop, cap: live.capital } : { o: mem.o, n: mem.n, p: mem.p, cap: mem.cap };
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
        const e = (now - a.t0) / a.dur, s = Math.min(a.steps.length - 2, Math.floor(e)), f = Math.min(1, e - s);
        const [x0, y0] = this.posOf(a.steps[s]), [x1, y1] = this.posOf(a.steps[s + 1]);
        let ddx = x1 - x0; const ww = this.worldW * z; if (ddx > ww / 2) ddx -= ww; if (ddx < -ww / 2) ddx += ww;
        x = x0 + ddx * f; y = y0 + (y1 - y0) * f;
      }
      if (x < -60 || x > this.w + 60 || y < -60 || y > this.h + 60) continue;
      drawn.push([u, x, y, !!a]);
    }
    for (const [u, x, y, moving] of drawn) {
      const civ = isCivilianUnit(u), both = !moving && G._mil.has(u.tile) && G._civ.has(u.tile);
      const px = both ? (civ ? x - rs * 0.3 : x + rs * 0.16) : x, py = both ? (civ ? y + rs * 0.26 : y - rs * 0.1) : y + rs * 0.04;
      this.drawUnit(u, px, py, rs, civ);
    }
    // selection, path preview
    if (this.selTile >= 0) {
      const [x, y] = this.posOf(this.selTile);
      ctx.beginPath(); hexPath(ctx, x, y, rs * 0.93);
      ctx.strokeStyle = '#000a'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    for (const [x, y, info, rem] of banners) this.drawBanner(x, y, info, rs, rem);
    if (this.path && this.path.steps.length) this.drawPath(this.path, rs);
  }

  drawPips(x, y, o, rs) {
    const ctx = this.ctx, pr = Math.max(2.2, rs * 0.075), gap = pr * 2.5;
    const groups = [[o.f, '#7fd38a'], [o.p, '#f0a050'], [o.g, '#f2d264']].filter(g => g[0] > 0);
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
    const ctx = this.ctx, civ = CIVS[this.G.players[c.o].civ];
    ctx.globalAlpha = remembered ? 0.75 : 1;
    // keep
    const s = rs * 0.5;
    ctx.fillStyle = civ.dark; ctx.strokeStyle = civ.color; ctx.lineWidth = Math.max(1.5, 2.4 * this.cam.z);
    ctx.beginPath(); hexPath(ctx, x, y, s * 1.12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#efe6d2';
    const bw = s * 0.34, bh = s * 0.9;
    for (const [ox, hh] of [[-0.55, 0.75], [0, 1], [0.55, 0.75]]) {
      const tx = x + ox * s - bw / 2, top = y + s * 0.45 - bh * hh;
      ctx.fillRect(tx, top, bw, bh * hh);
      ctx.fillRect(tx - bw * 0.12, top - bw * 0.3, bw * 0.32, bw * 0.34);
      ctx.fillRect(tx + bw * 0.8, top - bw * 0.3, bw * 0.32, bw * 0.34);
    }
    ctx.globalAlpha = 1;
  }
  drawBanner(x, y, c, rs, remembered) {
    const ctx = this.ctx, civ = CIVS[this.G.players[c.o].civ];
    ctx.globalAlpha = remembered ? 0.8 : 1;
    const fs = Math.max(10, Math.min(15, 12 * this.cam.z + 2));
    const label = (c.cap ? '★ ' : '') + c.n;
    ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width, bh2 = fs * 1.6, pw = bh2, bw2 = tw + pw + fs * 0.9;
    const bx = x - bw2 / 2, by = y - rs * 0.9 - bh2;
    ctx.fillStyle = 'rgba(10,14,20,.9)'; ctx.strokeStyle = civ.color; ctx.lineWidth = 1.5;
    roundRect(ctx, bx, by, bw2, bh2, bh2 / 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = civ.color; ctx.beginPath(); ctx.arc(bx + bh2 / 2, by + bh2 / 2, bh2 / 2 - 2, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#10141a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(c.p), bx + bh2 / 2, by + bh2 / 2 + 0.5);
    ctx.fillStyle = '#f2f5f8'; ctx.textAlign = 'left';
    ctx.fillText(label, bx + pw + fs * 0.25, by + bh2 / 2 + 0.5);
    ctx.globalAlpha = 1;
  }

  drawUnit(u, x, y, rs, civilian) {
    const ctx = this.ctx, civ = CIVS[this.G.players[u.owner].civ], own = u.owner === this.pid;
    const rad = rs * (civilian ? 0.3 : 0.38);
    ctx.beginPath(); ctx.arc(x, y + 1.5, rad, 0, 6.283); ctx.fillStyle = '#0007'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, rad, 0, 6.283); ctx.fillStyle = civ.color; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.2 * this.cam.z);
    ctx.strokeStyle = own ? (u.moves > 0 && !u.order && !u.skip ? '#ffffff' : '#2b3440') : civ.dark;
    ctx.stroke();
    this.drawGlyph(UNITS[u.type].glyph, x, y, rad * 1.15);
    if (own && u.order && u.order.t !== 'goto') {
      const lab = { fortify: 'F', sleep: 'Z', explore: 'E' }[u.order.t] || '';
      if (lab) {
        const bx = x + rad * 0.8, by = y - rad * 0.8, br = Math.max(6, rad * 0.38);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.283); ctx.fillStyle = '#121a24'; ctx.fill(); ctx.strokeStyle = '#cfd8e3'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#e8eef5'; ctx.font = `700 ${br * 1.2}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lab, bx, by + 0.5);
      }
    }
  }

  drawPath(path, rs) {
    const ctx = this.ctx, pts = [this.posOf(path.from)];
    for (const s of path.steps) {
      const prev = pts[pts.length - 1]; let [x, y] = this.posOf(s.t);
      const ww = this.worldW * this.cam.z; if (x - prev[0] > ww / 2) x -= ww; if (x - prev[0] < -ww / 2) x += ww;
      pts.push([x, y]);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = '#000a'; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = path.ok ? '#ffe08a' : '#ff8a7a'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
    path.steps.forEach((s, i) => {
      const [x, y] = pts[i + 1];
      const last = i === path.steps.length - 1, turnEnd = last || path.steps[i + 1].turn !== s.turn;
      if (!turnEnd) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 6.283); ctx.fillStyle = '#ffe08a'; ctx.fill(); return; }
      const r = Math.max(9, rs * 0.3);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fillStyle = last ? '#ffe08a' : '#1b2430'; ctx.fill();
      ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = last ? '#1b1405' : '#ffe08a'; ctx.font = `700 ${r * 1.05}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(s.turn + 1), x, y + 0.5);
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawTerrainSprite(x, t, v, R) {
  const base = TERRAIN[t].color, rnd = lcg(t * 97 + v * 13 + 7);
  x.save();
  x.beginPath(); hexPath(x, 0, 0, R + 0.8); x.clip();
  const gr = x.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.2);
  gr.addColorStop(0, shade(base, 0.12)); gr.addColorStop(1, shade(base, -0.12));
  x.fillStyle = gr; x.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
  const L = Math.max(1, R * 0.05);
  const pts = (n, spread) => { const a = []; for (let i = 0; i < n; i++) a.push([(rnd() - 0.5) * 2 * spread * R, (rnd() - 0.5) * 2 * spread * R]); return a; };
  if (t === T.GRASS) {
    x.strokeStyle = shade(base, -0.28); x.lineWidth = L;
    for (const [px, py] of pts(9, 0.6)) { x.beginPath(); x.moveTo(px - R * 0.05, py); x.lineTo(px, py - R * 0.1); x.lineTo(px + R * 0.05, py); x.stroke(); }
  } else if (t === T.PLAINS) {
    x.strokeStyle = shade(base, 0.25); x.lineWidth = L;
    for (const [px, py] of pts(8, 0.6)) { x.beginPath(); x.moveTo(px - R * 0.1, py); x.lineTo(px + R * 0.1, py); x.stroke(); }
    x.strokeStyle = shade(base, -0.2);
    for (const [px, py] of pts(5, 0.55)) { x.beginPath(); x.moveTo(px, py + R * 0.06); x.lineTo(px, py - R * 0.08); x.stroke(); }
  } else if (t === T.DESERT) {
    x.lineWidth = L * 1.2;
    for (let k = 0; k < 3; k++) {
      const py = (k - 1) * R * 0.42 + (rnd() - 0.5) * R * 0.2, px = (rnd() - 0.5) * R * 0.5;
      x.strokeStyle = shade(base, -0.18); x.beginPath(); x.arc(px, py + R * 0.3, R * 0.38, Math.PI * 1.2, Math.PI * 1.8); x.stroke();
    }
  } else if (t === T.TUNDRA) {
    x.fillStyle = 'rgba(240,248,255,.55)';
    for (const [px, py] of pts(12, 0.65)) { x.fillRect(px, py, L * 1.5, L * 1.5); }
    x.strokeStyle = shade(base, -0.25); x.lineWidth = L;
    for (const [px, py] of pts(4, 0.5)) { x.beginPath(); x.moveTo(px - R * 0.06, py); x.lineTo(px + R * 0.06, py); x.stroke(); }
  } else if (t === T.HILLS) {
    const hs = [[-0.32, 0.12, 0.42], [0.3, 0.2, 0.36], [0.02, -0.28, 0.32]];
    for (const [hx, hy, hr] of hs) {
      x.beginPath(); x.ellipse(hx * R, hy * R + R * 0.08, hr * R, hr * R * 0.62, 0, Math.PI, 0); x.closePath();
      x.fillStyle = shade(base, -0.18); x.fill();
      x.beginPath(); x.ellipse(hx * R - hr * R * 0.15, hy * R + R * 0.08, hr * R * 0.7, hr * R * 0.48, 0, Math.PI, Math.PI * 1.7); x.closePath();
      x.fillStyle = shade(base, 0.18); x.fill();
    }
  } else if (t === T.FOREST) {
    const trees = pts(6, 0.5).sort((a, b) => a[1] - b[1]);
    for (const [px, py] of trees) {
      const s = R * (0.2 + rnd() * 0.07);
      x.fillStyle = '#4b3420'; x.fillRect(px - L * 0.7, py + s * 0.4, L * 1.4, s * 0.5);
      if (v === 0) { x.fillStyle = shade(base, -0.25); x.beginPath(); x.moveTo(px, py - s * 1.1); x.lineTo(px + s * 0.7, py + s * 0.5); x.lineTo(px - s * 0.7, py + s * 0.5); x.closePath(); x.fill(); }
      else { x.fillStyle = shade(base, -0.22); x.beginPath(); x.arc(px, py, s * 0.7, 0, 6.283); x.fill(); x.fillStyle = shade(base, 0.12); x.beginPath(); x.arc(px - s * 0.2, py - s * 0.2, s * 0.35, 0, 6.283); x.fill(); }
    }
  } else if (t === T.MARSH) {
    x.strokeStyle = 'rgba(120,170,190,.7)'; x.lineWidth = L * 1.4;
    for (let k = 0; k < 4; k++) { const py = (k - 1.5) * R * 0.32, px = (rnd() - 0.5) * R * 0.4; x.beginPath(); x.moveTo(px - R * 0.3, py); x.lineTo(px + R * 0.3, py); x.stroke(); }
    x.strokeStyle = shade(base, -0.35); x.lineWidth = L;
    for (const [px, py] of pts(7, 0.55)) { x.beginPath(); x.moveTo(px, py); x.lineTo(px - R * 0.04, py - R * 0.16); x.moveTo(px, py); x.lineTo(px + R * 0.05, py - R * 0.14); x.stroke(); }
  } else if (t === T.MOUNTAIN) {
    const peaks = [[-0.28, 0.35, 0.42], [0.22, 0.4, 0.36], [0, 0.2, 0.5]];
    for (const [px, base_y, hgt] of peaks) {
      const bx = px * R, by = base_y * R, top = by - hgt * R * 1.5, hw = hgt * R * 0.85;
      x.fillStyle = '#5d5853'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx + hw, by); x.closePath(); x.fill();
      x.fillStyle = '#8d8781'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx - hw * 0.1, by); x.closePath(); x.fill();
      x.fillStyle = '#f3f6f8'; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.32, top + hgt * R * 0.5); x.lineTo(bx, top + hgt * R * 0.4); x.lineTo(bx - hw * 0.3, top + hgt * R * 0.5); x.closePath(); x.fill();
    }
  } else if (t === T.COAST || t === T.OCEAN) {
    x.strokeStyle = t === T.COAST ? 'rgba(220,245,255,.28)' : 'rgba(170,210,240,.16)'; x.lineWidth = L * 1.1;
    for (const [px, py] of pts(t === T.COAST ? 4 : 3, 0.5)) {
      x.beginPath(); x.arc(px - R * 0.08, py, R * 0.09, Math.PI * 1.1, Math.PI * 1.9); x.arc(px + R * 0.1, py, R * 0.09, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
    }
  }
  x.restore();
}
