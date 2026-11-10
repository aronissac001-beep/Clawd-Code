// ===== render.js : canvas map renderer =====
const HEX_R = 32;
const CORNERS = []; for (let k = 0; k < 6; k++) { const a = (60 * k - 30) * Math.PI / 180; CORNERS.push([Math.cos(a), Math.sin(a)]); }
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

// TILT squashes the map vertically for the 3D view (1 = flat, straight down).
let TILT = 1;
function hexPath(ctx, x, y, r) {
  ctx.moveTo(x + CORNERS[0][0] * r, y + CORNERS[0][1] * r * TILT);
  for (let k = 1; k < 6; k++) ctx.lineTo(x + CORNERS[k][0] * r, y + CORNERS[k][1] * r * TILT);
  ctx.closePath();
}
function edgePath(ctx, x, y, r, d) {
  const a = CORNERS[d], b = CORNERS[(d + 1) % 6];
  ctx.moveTo(x + a[0] * r, y + a[1] * r * TILT); ctx.lineTo(x + b[0] * r, y + b[1] * r * TILT);
}
// Height of each terrain above the sea, in world pixels (3D view only).
const ELEV = { steppe: 6, flats: 6, dunes: 5, frost: 7, ridge: 13, fungal: 7, marsh: 3, spire: 22, shallows: 1, deep: 0 };
const VIEW_TILT = 0.74;
const ELEV_T = TERRAIN.map(T => ELEV[T.key] || 0);
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
    if (!this.visHooked) { this.visHooked = true; document.addEventListener('visibilitychange', () => { if (!document.hidden) this.request(); }); }
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
    else if (this.ambientOn() && !this.ambT) this.ambT = setTimeout(() => { this.ambT = 0; if (!document.hidden) this.request(); }, 150); // ~6-7 fps idle loop
  }
  ambientOn() { return !!this.G && Settings.get('ambient') !== false && Settings.get('anim') !== 'off' && Settings.get('quality') !== 'battery'; }
  // Glinting water and slow cloud shadows drifting across the world.
  drawAmbient(waves, rs, now, ox, oy, z, tilt) {
    const ctx = this.ctx, s = now / 1000;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, rs * 0.05);
    for (let j = 0; j < waves.length; j += 3) {
      const x = waves[j], y = waves[j + 1], i = waves[j + 2], ph = (i * 0.618) % 1 * 6.283;
      for (let k = 0; k < 2; k++) {
        const a = Math.sin(s * 1.3 + ph + k * 2.4); if (a <= 0.25) continue;
        const dx = ((i * 37 + k * 53) % 100 / 100 - 0.5) * rs * 1.1, dy = ((i * 61 + k * 29) % 100 / 100 - 0.5) * rs * 0.8 * tilt, w = rs * (0.16 + 0.1 * a);
        ctx.strokeStyle = `rgba(230,246,255,${((a - 0.25) * 0.55).toFixed(3)})`;
        ctx.beginPath(); ctx.moveTo(x + dx - w, y + dy); ctx.quadraticCurveTo(x + dx, y + dy - w * 0.35, x + dx + w, y + dy); ctx.stroke();
      }
    }
    // clouds: positions in world units, drifting east and wrapping with the map
    const ww = this.worldW, wh = this.worldH, n = Math.max(4, Math.round(ww * wh / 260000));
    for (let c = 0; c < n; c++) {
      const h1 = (c * 2654435761 >>> 0) / 4294967296, h2 = (c * 40503 * 2654435761 >>> 0) / 4294967296;
      let wx = (h1 * ww + s * (6 + h2 * 5)) % ww, wy = h2 * wh;
      let x = ox + wx * z; const span = ww * z; while (x < -400 * z) x += span; while (x > this.w + 400 * z) x -= span;
      const y = oy + wy * z * tilt, R = (90 + h1 * 80) * z;
      if (x < -R * 2 || x > this.w + R * 2 || y < -R || y > this.h + R) continue;
      for (let b = 0; b < 4; b++) {
        const bx = x + (b - 1.5) * R * 0.55, by = y + Math.sin(b * 1.9 + c) * R * 0.18, br = R * (0.55 + 0.25 * Math.sin(b * 2.3 + c * 1.7));
        const g = ctx.createRadialGradient(bx, by, br * 0.1, bx, by, br);
        g.addColorStop(0, 'rgba(10,16,28,.13)'); g.addColorStop(1, 'rgba(10,16,28,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(bx, by, br, br * tilt, 0, 0, 6.283); ctx.fill();
      }
    }
    ctx.restore();
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
  get tilt() { return Settings.get('view3d') === false ? 1 : VIEW_TILT; }
  elev(i) { if (this.tilt === 1 || !this.G) return 0; const m = this.G.map; return m.lake[i] ? 1 : ELEV_T[m.terrain[i]]; }
  posOf(i) {
    const ww = this.worldW; let dx = this.tileWX(i) - this.cam.x;
    dx = ((dx % ww) + ww * 1.5) % ww - ww / 2;
    const ex = this.G.players[this.pid] && this.G.players[this.pid].explored[i];
    return [dx * this.cam.z + this.w / 2, (this.tileWY(i) - this.cam.y) * this.cam.z * this.tilt + this.h / 2 - (ex ? this.elev(i) : 0) * this.cam.z];
  }
  screenToWorld(sx, sy) { return [(sx - this.w / 2) / this.cam.z + this.cam.x, (sy - this.h / 2) / (this.cam.z * this.tilt) + this.cam.y]; }
  // With raised tiles a tap can land on a tile drawn above its flat position: test the flat guess and its
  // neighbors against their drawn (tilted, raised) hexagons, front rows first.
  screenToTile(sx, sy) {
    const t0 = this.flatTile(sx, sy); if (t0 < 0 || this.tilt === 1) return t0;
    const g = this.G._grid, rs = HEX_R * this.cam.z, cands = [t0, ...g.neighbors(t0)];
    for (const n of g.neighbors(t0)) for (const n2 of g.neighbors(n)) if (!cands.includes(n2)) cands.push(n2);
    cands.sort((a, b) => b - a);
    for (const t of cands) {
      const [x, y] = this.posOf(t), dx = Math.abs(sx - x) / rs, dy = Math.abs(sy - y) / (rs * this.tilt);
      if (dx <= 0.866 && dy <= 1 - dx * 0.577) return t;
    }
    return t0;
  }
  flatTile(sx, sy) {
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
    const tx = this.tileWX(tile), ty = this.tileWY(tile) + this.h * 0.07 / (this.cam.z * this.tilt);
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
        drawTerrainSprite(x, t, v, R, this.tilt < 1);
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
    // 3D props: taller canvases with the tile centre at (pw/2, ph*0.72)
    this.props = new Map(); this.propGrays = new Map();
    if (this.tilt < 1) {
      const pw = Math.ceil(SQ3 * R) + 8, ph = Math.ceil(2.9 * R); this.propW = pw; this.propH = ph;
      for (const t of PROP_T) {
        const row = [], grow = [];
        for (let v = 0; v < VARIANTS; v++) {
          const c = document.createElement('canvas'); c.width = pw; c.height = ph;
          const x = c.getContext('2d'); x.translate(pw / 2, ph * 0.72); drawPropSprite(x, t, v, R); row.push(c);
          const g = document.createElement('canvas'); g.width = pw; g.height = ph;
          const gx = g.getContext('2d'); gx.drawImage(c, 0, 0); gx.globalCompositeOperation = 'saturation'; gx.fillStyle = 'rgb(128,128,128)'; gx.fillRect(0, 0, pw, ph);
          gx.globalCompositeOperation = 'destination-in'; gx.drawImage(c, 0, 0); grow.push(g);
        }
        this.props.set(t, row); this.propGrays.set(t, grow);
      }
    }
    this.spriteTilt = this.tilt; this.skirts = new Map();
    this.fogCv = this.fogCv || document.createElement('canvas');
    this.glyphs.clear(); this.banners.clear();
  }
  // The two front cliff faces of a raised tile, shaded as if lit from the upper left. Cached per terrain, height and seen state.
  skirt(t, ev, dimmed) {
    const key = t * 1000 + ev * 2 + (dimmed ? 1 : 0);
    let c = this.skirts.get(key); if (c) return c;
    const R = HEX_R * this.spriteZ * this.dpr, E = ev * this.spriteZ * this.dpr, tl = this.tilt;
    const w = Math.ceil(SQ3 * R) + 4, top = 0.5 * R * tl - 2, hgt = Math.ceil(R * tl - top + E) + 3;
    c = document.createElement('canvas'); c.width = w; c.height = hgt; c.oy = top;
    const x = c.getContext('2d'); x.translate(w / 2, -top);
    const pts = [1, 2, 3].map(k => [CORNERS[k][0] * R, CORNERS[k][1] * R * tl]);
    const rock = t === T.MOUNTAIN || t === T.HILLS, snow = t === T.TUNDRA, sand = t === T.DESERT;
    const [lit, dark] = rock ? ['#6d6290', '#463d63'] : snow ? ['#a9c3d4', '#7c96a8'] : sand ? ['#a58fb8', '#7e6a94'] : TERRAIN[t].water ? ['#2a8c9a', '#1f6573'] : ['#6a4a64', '#4a3046'];
    const face = (a2, b2, col) => { const g = x.createLinearGradient(0, a2[1], 0, a2[1] + E); g.addColorStop(0, col); g.addColorStop(1, shade(col, -0.35)); x.fillStyle = g;
      x.beginPath(); x.moveTo(a2[0], a2[1]); x.lineTo(b2[0], b2[1]); x.lineTo(b2[0], b2[1] + E); x.lineTo(a2[0], a2[1] + E); x.closePath(); x.fill(); };
    face(pts[0], pts[1], dark); face(pts[1], pts[2], lit);
    if (!TERRAIN[t].water && !rock) { x.strokeStyle = shade(TERRAIN[t].color, -0.1); x.lineWidth = Math.max(1, E * 0.22); x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); x.lineTo(pts[1][0], pts[1][1]); x.lineTo(pts[2][0], pts[2][1]); x.stroke(); }
    if (dimmed) { x.fillStyle = Settings.get('quality') !== 'battery' ? 'rgba(8,12,18,.34)' : 'rgba(8,12,18,.46)'; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); x.lineTo(pts[1][0], pts[1][1]); x.lineTo(pts[2][0], pts[2][1]); x.lineTo(pts[2][0], pts[2][1] + E); x.lineTo(pts[1][0], pts[1][1] + E); x.lineTo(pts[0][0], pts[0][1] + E); x.closePath(); x.fill(); }
    this.skirts.set(key, c);
    return c;
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
    const tint = unitTint(type);
    px = Math.max(5, Math.round(px)); const key = '#' + name + px + (tint || ''); let c = this.glyphs.get(key);
    if (!c) { c = iconCanvas(name, px, this.dpr, tint); this.glyphs.set(key, c); }
    const s = c.width / this.dpr; this.ctx.drawImage(c, x - s / 2, y - s / 2, s, s);
  }
  // A supply pod from the arks, half buried, with a blinking beacon: something worth a detour.
  drawRuin(x, y, rs, alpha, now) {
    const ctx = this.ctx, k = rs / 30;
    if (k < 0.25) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(k, k);
    const tw = (Math.sin((now || 0) / 400 + x * 0.05) + 1) / 2;
    const gl = ctx.createRadialGradient(0, -6, 2, 0, -6, 22); gl.addColorStop(0, `rgba(120,255,220,${0.2 + 0.25 * tw})`); gl.addColorStop(1, 'rgba(120,255,220,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -6, 22, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(1, 7, 15, 5, 0, 0, 6.283); ctx.fill();
    const g = ctx.createLinearGradient(-10, 0, 10, 0); g.addColorStop(0, '#e8ecf5'); g.addColorStop(0.6, '#a9b0c6'); g.addColorStop(1, '#6a7088');
    ctx.fillStyle = g; ctx.strokeStyle = '#1b1830'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-10, 6); ctx.lineTo(-10, -6); ctx.quadraticCurveTo(-10, -16, 0, -16); ctx.quadraticCurveTo(10, -16, 10, -6); ctx.lineTo(10, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a8f86'; ctx.fillRect(-10, -3, 20, 3);
    ctx.fillStyle = '#1b1830'; ctx.fillRect(-4, 0, 8, 5);
    ctx.strokeStyle = '#6a7088'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(4, -15); ctx.lineTo(7, -22); ctx.stroke();
    ctx.fillStyle = `rgba(120,255,220,${0.35 + 0.65 * tw})`; ctx.beginPath(); ctx.arc(7, -23, 2.3, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  drawVeil(veils, rs, now, amb) {
    const ctx = this.ctx, t = (amb ? now : 0) / 1000;
    ctx.save();
    for (let j = 0; j < veils.length; j += 4) {
      const x = veils[j], y = veils[j + 1], i = veils[j + 2], seen = veils[j + 3];
      const ph = (i * 0.618) % 1 * 6.283;
      for (let k = 0; k < 3; k++) {
        const dx = Math.sin(t * 0.35 + ph + k * 2.1) * rs * 0.22, dy = Math.cos(t * 0.27 + ph + k) * rs * 0.12 * TILT;
        const r0 = rs * (0.62 + 0.12 * Math.sin(ph + k));
        const g = ctx.createRadialGradient(x + dx, y + dy, r0 * 0.1, x + dx, y + dy, r0);
        g.addColorStop(0, seen ? 'rgba(232,120,214,.30)' : 'rgba(170,110,170,.18)'); g.addColorStop(1, 'rgba(160,80,200,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x + dx, y + dy, r0, r0 * 0.8 * TILT + r0 * 0.2, 0, 0, 6.283); ctx.fill();
      }
      if (seen && rs > 16) for (let k = 0; k < 4; k++) { // drifting spores
        const a = (t * 0.25 + (i * 37 + k * 13) % 100 / 100) % 1, sx = x + (((i * 53 + k * 29) % 100) / 100 - 0.5) * rs * 1.3, sy = y + rs * 0.4 - a * rs * 0.9;
        ctx.fillStyle = `rgba(255,200,250,${(0.8 * Math.sin(a * Math.PI)).toFixed(3)})`; ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, rs * 0.035), 0, 6.283); ctx.fill();
      }
    }
    ctx.restore();
  }
  // How dark it is on Veyra: a slow day and night cycle (about a minute), 0 = noon, 1 = midnight.
  nightLevel(now, amb) { return amb ? 0.5 - 0.5 * Math.cos((now || 0) / 60000 * 6.283) : 0.3; }
  glowSprite(col) {
    this._glow = this._glow || {};
    if (!this._glow[col]) {
      const c = document.createElement('canvas'); c.width = c.height = 48; const x = c.getContext('2d');
      const g = x.createRadialGradient(24, 24, 0, 24, 24, 24); g.addColorStop(0, col.replace('A', '1')); g.addColorStop(0.35, col.replace('A', '.45')); g.addColorStop(1, col.replace('A', '0'));
      x.fillStyle = g; x.fillRect(0, 0, 48, 48); this._glow[col] = c;
    }
    return this._glow[col];
  }
  drawGlow(glows, rs, now, amb) {
    const ctx = this.ctx, night = this.nightLevel(now, amb);
    if (night > 0.04) { ctx.fillStyle = `rgba(8,3,26,${(0.34 * night).toFixed(3)})`; ctx.fillRect(0, 0, this.w, this.h); }
    if (!glows.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const base = 0.22 + 0.78 * night, t = (now || 0) / 900;
    for (let j = 0; j < glows.length; j += 4) {
      const x = glows[j], y = glows[j + 1], i = glows[j + 2], G0 = GLOW_T[glows[j + 3]], img = this.glowSprite(G0.col);
      for (let q = 0; q < G0.n; q++) {
        const hsh = ((i * 2654435761 + q * 40503) >>> 0) % 1000 / 1000, hs2 = ((i * 97 + q * 7919) >>> 0) % 1000 / 1000;
        const px = x + (hsh - 0.5) * rs * 1.2, py = y + (hs2 - 0.5) * rs * 0.9 * TILT - rs * G0.up;
        const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + hsh) + i * 1.7 + q * 2.1);
        const r = rs * (0.3 + 0.3 * hs2) * (0.75 + 0.5 * night);
        ctx.globalAlpha = Math.min(1, base * tw * G0.a);
        ctx.drawImage(img, px - r, py - r, r * 2, r * 2);
      }
    }
    ctx.restore();
  }
  drawSat(st, x, y, rs, R0, now) {
    const ctx = this.ctx, S = SATS[st.type], own = st.owner === this.pid, col = CIVS[this.G.players[st.owner].civ].color;
    ctx.save();
    ctx.setLineDash([5, 6]); ctx.lineWidth = 1.5; ctx.strokeStyle = own ? 'rgba(140,255,230,.55)' : 'rgba(255,160,160,.45)';
    ctx.beginPath(); ctx.ellipse(x, y, R0, R0 * TILT, 0, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
    const g = ctx.createRadialGradient(x, y, 0, x, y, R0); g.addColorStop(0, own ? 'rgba(120,255,220,.07)' : 'rgba(255,120,120,.06)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, R0, R0 * TILT, 0, 0, 6.283); ctx.fill();
    // the orbit: a tilted ellipse high above the footprint
    const alt = rs * 1.45, orx = Math.max(rs * 0.9, R0 * 0.55), ory = orx * 0.28, cy = y - alt;
    ctx.strokeStyle = own ? 'rgba(160,255,235,.22)' : 'rgba(255,170,170,.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, cy, orx, ory, -0.18, 0, 6.283); ctx.stroke();
    const a = (now || 0) / 3200 + st.id * 1.9, pos = k => { const b = a - k; return [x + Math.cos(b) * orx * Math.cos(-0.18) - Math.sin(b) * ory * Math.sin(-0.18), cy + Math.cos(b) * orx * Math.sin(-0.18) + Math.sin(b) * ory * Math.cos(-0.18)]; };
    const [ox, oy] = pos(0);
    for (let q = 1; q <= 6; q++) { const [tx, ty] = pos(q * 0.09); ctx.fillStyle = `rgba(170,255,240,${0.32 - q * 0.05})`; ctx.beginPath(); ctx.arc(tx, ty, Math.max(1, rs * 0.05 * (1 - q / 8)), 0, 6.283); ctx.fill(); }
    const bm = ctx.createLinearGradient(ox, oy, x, y); bm.addColorStop(0, own ? 'rgba(150,255,230,.35)' : 'rgba(255,150,150,.3)'); bm.addColorStop(1, 'rgba(150,255,230,0)');
    ctx.fillStyle = bm; ctx.beginPath(); ctx.moveTo(ox - rs * 0.05, oy); ctx.lineTo(ox + rs * 0.05, oy); ctx.lineTo(x + R0 * 0.35, y); ctx.lineTo(x - R0 * 0.35, y); ctx.closePath(); ctx.fill();
    // the craft: a body with two solar wings, its owner's color on the hull
    const sz = Math.max(5, rs * 0.16), tilt = Math.sin(a) * 0.4;
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(tilt);
    ctx.fillStyle = '#1d3b6b'; ctx.strokeStyle = '#9fd8ff'; ctx.lineWidth = 1;
    for (const sgn of [-1, 1]) { ctx.fillRect(sgn > 0 ? sz * 0.7 : -sz * 2.3, -sz * 0.45, sz * 1.6, sz * 0.9); ctx.strokeRect(sgn > 0 ? sz * 0.7 : -sz * 2.3, -sz * 0.45, sz * 1.6, sz * 0.9); }
    ctx.fillStyle = col; ctx.strokeStyle = '#0a0618'; ctx.beginPath(); ctx.arc(0, 0, sz * 0.75, 0, 6.283); ctx.fill(); ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin((now || 0) / 300 + st.id)})`; ctx.beginPath(); ctx.arc(0, -sz * 0.9, Math.max(1, sz * 0.22), 0, 6.283); ctx.fill();
    ctx.restore();
    if (this.cam.z > 0.6) { ctx.fillStyle = 'rgba(10,6,24,.8)'; ctx.beginPath(); ctx.arc(x, y - rs * 0.62, Math.max(8, rs * 0.24), 0, 6.283); ctx.fill(); this.drawIcon(st.type, x, y - rs * 0.62, Math.max(6, rs * 0.17)); }
    if (this.cam.z > 0.75) { const left = st.until - this.G.turn; ctx.font = `700 ${Math.max(9, rs * 0.24)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = '#000a'; ctx.strokeText(String(left), ox + rs * 0.36, oy - rs * 0.28); ctx.fillStyle = '#c8fff0'; ctx.fillText(String(left), ox + rs * 0.36, oy - rs * 0.28); }
    ctx.restore();
  }
  // Wreckage, Precursor ruins and Echo Vaults, each drawn small and distinct.
  drawSite(st, x, y, rs, alpha, now, done) {
    const ctx = this.ctx, k = rs / 30; if (k < 0.25) return;
    ctx.save(); ctx.globalAlpha = alpha * (done ? 0.5 : 1); ctx.translate(x, y); ctx.scale(k, k);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(1, 7, 16, 5, 0, 0, 6.283); ctx.fill();
    const tw = (Math.sin((now || 0) / 480 + x * 0.05) + 1) / 2;
    if (st.kind === 'wreck') {
      ctx.fillStyle = '#5b6070'; ctx.strokeStyle = '#1c1a26'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-15, 5); ctx.lineTo(-6, -8); ctx.lineTo(10, -4); ctx.lineTo(14, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8a90a2'; ctx.beginPath(); ctx.moveTo(-6, -8); ctx.lineTo(-2, -16); ctx.lineTo(4, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2b2f3c'; ctx.fillRect(-4, -3, 8, 5);
      ctx.fillStyle = `rgba(255,150,80,${0.4 + 0.6 * tw})`; ctx.beginPath(); ctx.arc(8, -6, 2.4, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(200,200,220,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, -12); ctx.quadraticCurveTo(-14, -20, -8, -26); ctx.stroke();
    } else if (st.kind === 'ruin') {
      const g = ctx.createRadialGradient(0, -6, 2, 0, -6, 22); g.addColorStop(0, 'rgba(160,255,230,.35)'); g.addColorStop(1, 'rgba(160,255,230,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -6, 22, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#4c4470'; ctx.strokeStyle = '#1a1430'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(-11, -16); ctx.lineTo(-6, -18); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(4, 6); ctx.lineTo(6, -12); ctx.lineTo(13, -9); ctx.lineTo(14, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(-1, -14, 11, Math.PI * 1.05, Math.PI * 1.9); ctx.lineWidth = 3.5; ctx.strokeStyle = '#4c4470'; ctx.stroke();
      ctx.fillStyle = `rgba(140,255,230,${0.5 + 0.5 * tw})`; for (const [px, py] of [[-9, -6], [9, -2], [-8, 1]]) { ctx.beginPath(); ctx.arc(px, py, 1.6, 0, 6.283); ctx.fill(); }
    } else {
      const g = ctx.createRadialGradient(0, -8, 2, 0, -8, 26); g.addColorStop(0, `rgba(200,140,255,${0.35 + 0.3 * tw})`); g.addColorStop(1, 'rgba(200,140,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -8, 26, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#2a2050'; ctx.strokeStyle = '#d0b0ff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(12, -6); ctx.lineTo(9, 6); ctx.lineTo(-9, 6); ctx.lineTo(-12, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgba(230,200,255,${0.6 + 0.4 * tw})`; ctx.beginPath(); ctx.arc(0, -6, 4, 0, 6.283); ctx.fill();
      ctx.strokeStyle = 'rgba(230,200,255,.6)'; ctx.lineWidth = 1; for (let r = 8; r <= 16; r += 4) { ctx.beginPath(); ctx.arc(0, -6, r + tw * 2, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
    }
    ctx.restore();
  }
  // A fauna nest: an organic mound with glowing eggs.
  drawNest(x, y, rs, cp, occupied, now, alpha) {
    const ctx = this.ctx, k = rs / 30; if (k < 0.22) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(occupied ? x - rs * 0.42 : x, occupied ? y + rs * 0.4 : y + rs * 0.1); ctx.scale(occupied ? k * 0.6 : k, occupied ? k * 0.6 : k);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(1, 6, 17, 6, 0, 0, 6.283); ctx.fill();
    const g = ctx.createLinearGradient(0, -14, 0, 6); g.addColorStop(0, '#8a3f78'); g.addColorStop(1, '#3a1434');
    ctx.fillStyle = g; ctx.strokeStyle = '#1a0614'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-16, 6); ctx.quadraticCurveTo(-14, -12, 0, -14); ctx.quadraticCurveTo(14, -12, 16, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#c9408a'; ctx.lineWidth = 1.5; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 5, -10 + Math.abs(i) * 2); ctx.quadraticCurveTo(i * 7, -18, i * 9 + 2, -20 + Math.abs(i)); ctx.stroke(); }
    const tw = (Math.sin((now || 0) / 700 + x * 0.03) + 1) / 2;
    for (const [px, py] of [[-6, -2], [0, -5], [6, -1]]) { const eg = ctx.createRadialGradient(px, py, 0, px, py, 5); eg.addColorStop(0, `rgba(255,${cp.hoard ? 230 : 160},${cp.hoard ? 120 : 230},${0.6 + 0.4 * tw})`); eg.addColorStop(1, 'rgba(255,120,220,0)'); ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(px, py, 5, 0, 6.283); ctx.fill(); }
    ctx.restore();
  }
  drawGlyph(ch, x, y, px) { const c = this.glyph(ch, px), s = c.width / this.dpr; this.ctx.drawImage(c, x - s / 2, y - s / 2, s, s); }

  // ---- main draw ----
  draw(now) {
    const ctx = this.ctx, dpr = this.dpr;
    TILT = this.tilt; const T3 = TILT < 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07040f'; ctx.fillRect(0, 0, this.w, this.h);
    const G = this.G; if (!G) return;
    const z = this.cam.z;
    if (!this.sprites || this.spriteTilt !== this.tilt || (!this.gesturing && Math.abs(z / this.spriteZ - 1) > 0.12)) this.buildSprites();
    const m = G.map, W = m.W, H = m.H, P = G.players[this.pid], ex = P.explored, vis = P._vis, nb = G._grid.nb;
    const rs = HEX_R * z, k = z / this.spriteZ, sw = this.spriteW / dpr * k, sh = this.spriteH / dpr * k;
    const [lx, ty] = this.screenToWorld(0, 0), [rx, by] = this.screenToWorld(this.w, this.h);
    const r0 = Math.max(0, Math.floor((ty - HEX_R) / (1.5 * HEX_R)) - 1), r1 = Math.min(H - 1, Math.ceil((by - HEX_R) / (1.5 * HEX_R)) + (T3 ? 2 : 1));
    const c0 = Math.floor(lx / (SQ3 * HEX_R)) - 1, c1 = Math.ceil(rx / (SQ3 * HEX_R)) + 1;
    const fog = new Path2D(), dim = new Path2D(), grid = new Path2D(), river = new Path2D(), shore = new Path2D(), foam = new Path2D();
    const tint = new Map(), border = new Map();
    const resList = [], impList = [], road = new Path2D(), rail = new Path2D(), lens = [], props = [], waves = [], veils = [], glows = [];
    const amb = this.ambientOn();
    const far = z < 0.58; // far out: skip icons and lines that are unreadable at this scale
    const lensM = Settings.get('lens') === true ? 'yields' : Settings.get('lens');
    const showGrid = Settings.get('grid') && !far, showRes = Settings.get('resources') && !far, showLens = lensM === 'yields' && !far;
    const hi = Settings.get('quality') !== 'battery';
    const ox = this.w / 2 - this.cam.x * z, oy = this.h / 2 - this.cam.y * z * TILT;
    let anyDim = false;
    for (let r = r0; r <= r1; r++) {
      const gy = (1.5 * HEX_R * r + HEX_R) * z * TILT + oy;
      for (let c = c0; c <= c1; c++) {
        const i = r * W + ((c % W) + W) % W;
        const sx = SQ3 * HEX_R * (c + 0.5 * (r & 1)) * z + ox;
        if (!ex[i]) { hexPath(fog, sx, gy, rs + 0.6); continue; }
        const t = m.terrain[i], seen = vis[i], e = T3 ? (m.lake[i] ? 1 : ELEV_T[t]) * z : 0, sy = gy - e;
        if (e > 0.5) { // cliff faces under the two front edges, pre-rendered per terrain and height
          const sk = this.skirt(t, m.lake[i] ? 1 : ELEV_T[t], !seen);
          ctx.drawImage(sk, sx - sk.width / dpr * k / 2, sy + sk.oy / dpr * k, sk.width / dpr * k, sk.height / dpr * k);
        }
        ctx.drawImage((seen || !hi ? this.sprites : this.grays)[t][(i * 2654435761 >>> 27) % VARIANTS], sx - sw / 2, sy - sh * TILT / 2, sw, sh * TILT);
        if (T3 && PROP_T.has(t) && !G._cityAt.has(i)) props.push(t, (i * 2654435761 >>> 27) % VARIANTS, sx, sy, seen ? 1 : 0);
        if (amb && seen && TERRAIN[t].water && !far) waves.push(sx, sy, i);
        if (m.veil && m.veil[i]) veils.push(sx, sy, i, seen ? 1 : 0);
        if (seen && hi && !far && GLOW_T[t]) glows.push(sx, sy, i, t);
        if (!seen && T3) { ctx.fillStyle = hi ? 'rgba(8,12,18,.34)' : 'rgba(8,12,18,.46)'; ctx.beginPath(); hexPath(ctx, sx, sy, rs + 0.6); ctx.fill(); } // 3D: darken in draw order so nearer tiles are not dimmed
        else if (!seen) { hexPath(dim, sx, sy, rs + 0.6); anyDim = true; }
        if (showGrid) hexPath(grid, sx, sy, rs);
        const rv = m.river[i];
        if (rv) for (let d = 0; d < 6; d++) if (rv & (1 << d)) edgePath(river, sx, sy, rs, d);
        if (TERRAIN[t].land) for (let d = 0; d < 6; d++) {
          const n = nb[i * 6 + d];
          if (n >= 0 && TERRAIN[m.terrain[n]].water) { edgePath(shore, sx, sy, rs * 0.97, d); edgePath(foam, sx, sy, rs * 1.06, d); }
        }
        const o = m.owner[i];
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
          const a = CORNERS[d], b = CORNERS[(d + 1) % 6], mx = sx + (a[0] + b[0]) / 2 * rs, my = sy + (a[1] + b[1]) / 2 * rs * TILT;
          const pth = rd >= 2 && rn >= 2 ? rail : road; pth.moveTo(sx, sy); pth.lineTo(mx, my);
        }
      }
    }
    for (const [o, p] of tint) { ctx.globalAlpha = 0.12; ctx.fillStyle = CIVS[G.players[o].civ].color; ctx.fill(p); }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(150,240,220,.42)'; ctx.lineWidth = Math.max(2, 5 * z); ctx.stroke(shore);
    ctx.strokeStyle = 'rgba(225,250,255,.4)'; ctx.lineWidth = Math.max(1, 1.5 * z); ctx.stroke(foam);
    ctx.strokeStyle = '#139c9a'; ctx.lineWidth = Math.max(2.5, 5 * z); ctx.stroke(river);
    ctx.strokeStyle = '#a8fff0'; ctx.lineWidth = Math.max(0.8, 1.4 * z); ctx.stroke(river);
    if (showGrid) { ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke(grid); }
    for (let j = 0; j < impList.length; j += 3) {
      const I = IMPROV[impList[j]], x = impList[j + 1], y = impList[j + 2];
      if (I.key === 'farm') {
        ctx.save(); ctx.beginPath(); hexPath(ctx, x, y, rs * 0.72); ctx.clip();
        ctx.fillStyle = 'rgba(90,230,200,.16)'; ctx.fillRect(x - rs, y - rs * 0.1, rs * 2, rs);
        ctx.strokeStyle = 'rgba(150,255,225,.75)'; ctx.lineWidth = Math.max(1, 1.8 * z);
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
    ctx.strokeStyle = 'rgba(30,20,50,.85)'; ctx.lineWidth = Math.max(2, 4.5 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(190,180,215,.9)'; ctx.lineWidth = Math.max(1, 2.2 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(20,14,40,.9)'; ctx.lineWidth = Math.max(2.5, 5 * z); ctx.stroke(rail);
    ctx.strokeStyle = 'rgba(110,255,230,.95)'; ctx.lineWidth = Math.max(1, 1.6 * z); ctx.setLineDash([3 * z + 1, 2 * z + 1]); ctx.stroke(rail); ctx.setLineDash([]);
    // 3D: trees, hills and peaks stand up after the ground layers, back rows first
    if (props.length) {
      const pw = this.propW / dpr * k, ph = this.propH / dpr * k;
      for (let j = 0; j < props.length; j += 5) {
        const img = (props[j + 4] || !hi ? this.props : this.propGrays).get(props[j])[props[j + 1]];
        ctx.drawImage(img, props[j + 2] - pw / 2, props[j + 3] - ph * 0.72, pw, ph);
      }
    }
    // Veyra's night: the land dims and the fungal forests, marshes and spires glow
    if (glows.length || amb) this.drawGlow(glows, rs, now, amb);
    // the Spore Veil: a drifting pink-violet mist over affected tiles
    if (veils.length) this.drawVeil(veils, rs, now, amb);
    // 3D: alien sky haze toward the top of the screen, violet above a teal horizon glow
    if (T3) { const hz = ctx.createLinearGradient(0, 0, 0, this.h * 0.55); hz.addColorStop(0, 'rgba(120,70,190,.34)'); hz.addColorStop(0.45, 'rgba(70,200,190,.12)'); hz.addColorStop(1, 'rgba(70,200,190,0)'); ctx.fillStyle = hz; ctx.fillRect(0, 0, this.w, this.h * 0.55); }
    for (let j = 0; j < resList.length; j += 3) {
      const R0 = RES[resList[j]];
      const gx = resList[j + 1] + rs * 0.42, gy = resList[j + 2] + rs * 0.42;
      ctx.fillStyle = R0.kind === 'strategic' ? 'rgba(70,24,12,.82)' : R0.kind === 'luxury' ? 'rgba(74,22,74,.82)' : 'rgba(12,34,22,.78)';
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(7, rs * 0.27), 0, 6.283); ctx.fill();
      ctx.strokeStyle = R0.kind === 'strategic' ? '#e08a5a' : R0.kind === 'luxury' ? '#d58ae0' : '#7fd38a'; ctx.lineWidth = 1; ctx.stroke();
      this.drawGlyph(R0.glyph, gx, gy, Math.max(9, rs * 0.34));
    }
    // your trade routes: dashed golden arcs between the two cities
    if (z > 0.35) {
      ctx.save(); ctx.setLineDash([6 * z + 2, 5 * z + 2]); ctx.lineCap = 'round';
      for (const r of G.routes) {
        if (r.owner !== this.pid) continue;
        const a0 = cityById(G, r.from), b0 = cityById(G, r.to); if (!a0 || !b0) continue;
        let [ax, ay] = this.posOf(a0.tile), [bx, by] = this.posOf(b0.tile);
        const ww = this.worldW * z; if (bx - ax > ww / 2) bx -= ww; if (ax - bx > ww / 2) bx += ww;
        if (Math.max(ax, bx) < -50 || Math.min(ax, bx) > this.w + 50 || Math.max(ay, by) < -50 || Math.min(ay, by) > this.h + 50) continue;
        const mx = (ax + bx) / 2 - (by - ay) * 0.18, my = (ay + by) / 2 + (bx - ax) * 0.18;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(mx, my, bx, by);
        ctx.strokeStyle = 'rgba(6,30,28,.55)'; ctx.lineWidth = Math.max(2.5, 4 * z); ctx.stroke();
        ctx.strokeStyle = 'rgba(110,250,220,.9)'; ctx.lineWidth = Math.max(1.2, 2 * z); ctx.stroke();
        if (z > 0.8) this.drawGlyph('🚚', (ax + 2 * mx + bx) / 4, (ay + 2 * my + by) / 4, Math.max(10, 13 * z));
      }
      ctx.restore();
    }
    // natural wonders: a glowing medallion and, up close, a name
    for (const n of G.natural || []) {
      if (!P.explored[n.tile]) continue;
      const [nx, ny] = this.posOf(n.tile); if (nx < -rs * 2 || nx > this.w + rs * 2 || ny < -rs * 2 || ny > this.h + rs * 2) continue;
      const N = naturalAt(G, n.tile), r = Math.max(10, rs * 0.42);
      const gl = ctx.createRadialGradient(nx, ny, r * 0.2, nx, ny, r * 1.7); gl.addColorStop(0, 'rgba(140,255,230,.55)'); gl.addColorStop(1, 'rgba(140,255,230,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(nx, ny, r * 1.7, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(18,10,36,.85)'; ctx.strokeStyle = '#8ff5dc'; ctx.lineWidth = Math.max(1.5, 2.5 * z);
      ctx.beginPath(); ctx.arc(nx, ny, r, 0, 6.283); ctx.fill(); ctx.stroke();
      this.drawGlyph(N.glyph, nx, ny, r * 1.15);
      if (z > 0.9) { ctx.font = `600 ${Math.max(10, 11 * z)}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(N.name, nx, ny + r * 1.1); ctx.fillStyle = '#c8fff0'; ctx.fillText(N.name, nx, ny + r * 1.1); }
    }
    for (let j = 0; j < lens.length; j += 3) this.drawPips(lens[j + 1], lens[j + 2] - rs * 0.05, tileOutput(G, this.pid, lens[j], null), rs);
    if (anyDim) { ctx.fillStyle = hi ? 'rgba(8,12,18,.34)' : 'rgba(8,12,18,.46)'; ctx.fill(dim); }
    for (const [o, p] of border) {
      const civ = CIVS[G.players[o].civ];
      ctx.strokeStyle = civ.dark; ctx.lineWidth = Math.max(2, 5 * z); ctx.stroke(p);
      ctx.strokeStyle = civ.color; ctx.lineWidth = Math.max(1.2, 2.6 * z); ctx.stroke(p);
    }
    // Fog: sharp fill, plus a low-resolution copy scaled up to feather the edge cheaply
    if (amb) this.drawAmbient(waves, rs, now, ox, oy, z, TILT);
    ctx.fillStyle = '#0a0616'; ctx.fill(fog);
    if (hi) {
      const f = this.fogCv, sc = 1 / 10, fw = Math.ceil(this.w * sc), fh = Math.ceil(this.h * sc);
      if (f.width !== fw || f.height !== fh) { f.width = fw; f.height = fh; }
      const fx = f.getContext('2d'); fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, fw, fh);
      fx.setTransform(sc, 0, 0, sc, 0, 0); fx.fillStyle = '#0a0616'; fx.fill(fog);
      ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.9; ctx.drawImage(f, 0, 0, fw, fh, 0, 0, fw / sc, fh / sc); ctx.globalAlpha = 1;
    }
    // ancient ruins (drawn over the fog, so a Dowsing Rod can show unexplored ones faintly)
    if (G.ruins && G.ruins.length) {
      const dowse = P.relics && P.relics.includes('dowsing_rod');
      for (const t of G.ruins) {
        if (!P.explored[t] && !dowse) continue;
        const [x, y] = this.posOf(t); if (x < -rs * 2 || x > this.w + rs * 2 || y < -rs * 2 || y > this.h + rs * 2) continue;
        this.drawRuin(x, y + rs * 0.12, rs, !P.explored[t] ? 0.55 : vis[t] ? 1 : 0.8, now);
      }
    }
    // crash sites, Precursor ruins and Echo Vaults
    for (const st of G.sites || []) {
      if (!P.explored[st.tile]) continue;
      const [x, y] = this.posOf(st.tile); if (x < -rs * 2 || x > this.w + rs * 2 || y < -rs * 2 || y > this.h + rs * 2) continue;
      this.drawSite(st, x, y + rs * 0.1, rs, vis[st.tile] ? 1 : 0.75, now, st.kind === 'vault' && (P.vaults || []).includes(st.id));
    }
    // landfall candidates before the first colony
    if (this.landing && G.players[this.pid] && !G.players[this.pid].landed) this.landing.forEach((t, i) => {
      const [x, y] = this.posOf(t); const r = Math.max(12, rs * 0.55), pulse = (Math.sin((now || 0) / 400 + i) + 1) / 2;
      ctx.strokeStyle = `rgba(140,255,230,${0.5 + 0.5 * pulse})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y, r, r * TILT, 0, 0, 6.283); ctx.stroke();
      ctx.font = `800 ${Math.max(12, rs * 0.4)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = '#000b'; ctx.strokeText(String(i + 1), x, y - r * 1.2); ctx.fillStyle = '#c8fff0'; ctx.fillText(String(i + 1), x, y - r * 1.2);
    });
    // satellites: a soft coverage ring and the satellite itself, gently orbiting
    for (const st of G.sats || []) {
      if (st.owner !== this.pid && !vis[st.tile]) continue;
      const [x, y] = this.posOf(st.tile); const R0 = (SATS[st.type].radius + 0.5) * SQ3 * rs;
      if (x < -R0 || x > this.w + R0 || y < -R0 || y > this.h + R0) continue;
      this.drawSat(st, x, y, rs, R0, now);
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
    for (const cp of G.camps) { if (!P.explored[cp.tile]) continue; const [x, y] = this.posOf(cp.tile); if (x < -40 || x > this.w + 40 || y < -40 || y > this.h + 40) continue;
      this.drawNest(x, y, rs, cp, !!G._mil.get(cp.tile), now, vis[cp.tile] ? 1 : 0.7); }
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
    const owner = G.players[c.o], era = live ? playerEra(owner) : 0, aff = owner.minor || owner.barbarian ? null : primaryAff(owner);
    const glass = aff === 'communion' ? ['#b8ffd8', '#3aa877'] : aff === 'lattice' ? ['#fff3c4', '#c79a2a'] : aff === 'lineage' ? ['#ffe4ea', '#c45a6c'] : ['#d8fbff', '#4aa7b8'];
    ctx.globalAlpha = remembered ? 0.8 : 1;
    const s = rs * 0.62;
    // landing pad
    ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(x + s * 0.1, y + s * 0.62, s * 1.05, s * 0.32, 0, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#2b2440'; ctx.strokeStyle = civ.color; ctx.lineWidth = Math.max(1.5, 2.2 * z);
    ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.98); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3d3560'; ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.78); ctx.fill();
    if (z > 0.5) { ctx.strokeStyle = 'rgba(140,255,230,.25)'; ctx.lineWidth = 1; ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.58); ctx.stroke(); }
    // walls: an energy fence; shield generators add a translucent dome; bastions add pylons
    const wallLvl = has('bastion') ? 3 : has('castle') ? 2 : has('walls') ? 1 : 0;
    if (wallLvl) {
      ctx.strokeStyle = 'rgba(20,14,40,.9)'; ctx.lineWidth = s * 0.12; ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.96); ctx.stroke();
      ctx.strokeStyle = 'rgba(120,255,230,.85)'; ctx.lineWidth = s * 0.05; ctx.beginPath(); hexPath(ctx, x, y + s * 0.12, s * 0.96); ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const an = Math.PI / 6 + k * Math.PI / 3, tx = x + Math.cos(an) * s * 0.96, ty = y + s * 0.12 + Math.sin(an) * s * 0.96 * TILT, th = s * (0.14 + wallLvl * 0.08);
        ctx.fillStyle = '#5a5480'; ctx.fillRect(tx - s * 0.05, ty - th, s * 0.1, th);
        ctx.fillStyle = civ.color; ctx.beginPath(); ctx.arc(tx, ty - th, s * 0.06, 0, 6.283); ctx.fill();
      }
    }
    const items = [];
    // habitat domes grow with the population
    const n = Math.min(7, 1 + Math.floor(c.p / 2)), spots = [[-0.45, 0.12], [0.45, 0.12], [-0.25, 0.45], [0.25, 0.45], [-0.6, -0.22], [0.6, -0.22], [0, 0.62]];
    const dome = (dx, dy, r) => {
      const bx = x + dx * s, by = y + dy * s;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(bx + r * 0.2, by + r * 0.12, r * 1.05, r * 0.3, 0, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#4a4470'; ctx.fillRect(bx - r, by - r * 0.12, r * 2, r * 0.2);
      const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.75, r * 0.1, bx, by - r * 0.3, r * 1.1); g.addColorStop(0, glass[0]); g.addColorStop(1, glass[1]);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by - r * 0.1, r, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = Math.max(0.8, r * 0.08); ctx.beginPath(); ctx.arc(bx, by - r * 0.1, r * 0.72, Math.PI * 1.15, Math.PI * 1.55); ctx.stroke();
      if (z > 0.7 && r > 4) { ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx, by - r * 1.1); ctx.lineTo(bx, by - r * 0.1); ctx.moveTo(bx - r * 0.7, by - r * 0.8); ctx.quadraticCurveTo(bx, by - r * 0.55, bx + r * 0.7, by - r * 0.8); ctx.stroke(); }
      if (aff === 'communion') { ctx.strokeStyle = '#3fc27f'; ctx.lineWidth = Math.max(1, r * 0.14); ctx.beginPath(); ctx.moveTo(bx - r, by - r * 0.05); ctx.quadraticCurveTo(bx - r * 0.6, by - r * 1.1, bx - r * 0.1, by - r * 0.95); ctx.stroke(); }
    };
    spots.slice(0, n).forEach((p, i) => items.push({ y: p[1], draw: () => dome(p[0], p[1], s * (0.2 + (c.p >= 10 ? 0.03 : 0))) }));
    items.push({ y: 0, draw: () => dome(0, 0.05, s * (0.3 + Math.min(0.12, c.p * 0.01))) });
    // arcology towers later in the game, and always with an Arcology
    const towers = has('arcology') ? 3 : era >= 4 ? 2 : era >= 3 ? 1 : 0;
    for (let k = 0; k < towers; k++) items.push({ y: -0.5 - k * 0.01, draw: () => {
      const tx = x + (k === 0 ? -0.18 : k === 1 ? 0.22 : 0.02) * s, ty = y - s * (0.2 + (k === 2 ? 0.25 : 0)), w = s * 0.11, hh = s * (0.75 + k * 0.18);
      const g = ctx.createLinearGradient(tx - w, 0, tx + w, 0); g.addColorStop(0, shade(glass[1], 0.35)); g.addColorStop(1, shade(glass[1], -0.35));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(tx - w, ty); ctx.lineTo(tx - w * 0.75, ty - hh); ctx.lineTo(tx + w * 0.75, ty - hh); ctx.lineTo(tx + w, ty); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,230,.7)'; for (let j = 1; j < 5; j++) ctx.fillRect(tx - w * 0.5, ty - hh * j / 5, w, Math.max(1, s * 0.02));
      if (aff === 'lattice') { ctx.strokeStyle = '#ffe17a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tx, ty - hh); ctx.lineTo(tx, ty - hh - s * 0.18); ctx.stroke(); }
      if (aff === 'lineage') { ctx.fillStyle = '#ff6f80'; ctx.fillRect(tx, ty - hh - s * 0.16, w * 0.9, w * 0.5); ctx.fillStyle = '#ddd'; ctx.fillRect(tx - 0.5, ty - hh - s * 0.16, 1.2, s * 0.16); }
    } });
    // the Command Hub: the landed ark standing upright with a beacon
    if (c.cap) items.push({ y: -0.9, draw: () => {
      const px = x + s * 0.32, py = y - s * 0.32, w = s * 0.13, hh = s * 0.85;
      ctx.fillStyle = '#c8cde0'; ctx.beginPath(); ctx.moveTo(px - w, py); ctx.lineTo(px - w, py - hh * 0.75); ctx.quadraticCurveTo(px, py - hh * 1.05, px + w, py - hh * 0.75); ctx.lineTo(px + w, py); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(px, py - hh * 0.8, w, hh * 0.8);
      ctx.fillStyle = civ.color; ctx.fillRect(px - w, py - hh * 0.45, w * 2, hh * 0.08);
      ctx.fillStyle = '#5a5480'; ctx.beginPath(); ctx.moveTo(px - w * 1.9, py); ctx.lineTo(px - w, py - hh * 0.25); ctx.lineTo(px - w, py); ctx.fill(); ctx.beginPath(); ctx.moveTo(px + w * 1.9, py); ctx.lineTo(px + w, py - hh * 0.25); ctx.lineTo(px + w, py); ctx.fill();
      const bg = ctx.createRadialGradient(px, py - hh * 1.0, 0, px, py - hh * 1.0, s * 0.25); bg.addColorStop(0, 'rgba(160,255,235,.95)'); bg.addColorStop(1, 'rgba(160,255,235,0)'); ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(px, py - hh * 1.0, s * 0.25, 0, 6.283); ctx.fill();
    } });
    if (has('university') || has('observatory') || has('laboratory')) items.push({ y: -0.3, draw: () => { // a sensor dish
      const ox = x - s * 0.55, oy = y - s * 0.38;
      ctx.strokeStyle = '#c9c0ee'; ctx.lineWidth = Math.max(1, s * 0.04); ctx.beginPath(); ctx.moveTo(ox, oy + s * 0.12); ctx.lineTo(ox, oy - s * 0.12); ctx.stroke();
      ctx.fillStyle = '#e8e4ff'; ctx.beginPath(); ctx.ellipse(ox, oy - s * 0.15, s * 0.2, s * 0.09, -0.5, 0, Math.PI); ctx.fill();
    } });
    if (has('factory') || has('power_plant')) items.push({ y: -0.55, draw: () => { // a glowing reactor stack
      const fx = x + s * 0.62, fy = y - s * 0.32, w = s * 0.08;
      ctx.fillStyle = '#4a4470'; ctx.fillRect(fx - w, fy - s * 0.5, w * 2, s * 0.5);
      const rg = ctx.createRadialGradient(fx, fy - s * 0.55, 0, fx, fy - s * 0.55, s * 0.18); rg.addColorStop(0, has('power_plant') ? 'rgba(255,240,150,.95)' : 'rgba(255,150,90,.9)'); rg.addColorStop(1, 'rgba(255,150,90,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(fx, fy - s * 0.55, s * 0.18, 0, 6.283); ctx.fill();
    } });
    if (has('harbor')) items.push({ y: 0.7, draw: () => { const hx = x - s * 0.75, hy = y + s * 0.62; ctx.fillStyle = '#5a5480'; ctx.fillRect(hx - s * 0.28, hy - s * 0.04, s * 0.42, s * 0.08); ctx.fillStyle = '#8ff5dc'; ctx.beginPath(); ctx.arc(hx + s * 0.12, hy - s * 0.1, s * 0.05, 0, 6.283); ctx.fill(); } });
    if (has('gaia_node') || has('symbiont_garden')) items.push({ y: 0.5, draw: () => mushroom(ctx, x + s * 0.7, y + s * 0.45, s * 0.35, '#b45ad8', 'rgba(160,255,230,.9)') });
    items.sort((a, b) => a.y - b.y); for (const it of items) it.draw();
    // wonders and projects stand around the colony on glowing plinths
    if (live && z > 0.45) {
      const ws = live.buildings.filter(k => BUILDINGS[BLDI[k]].wonder || BUILDINGS[BLDI[k]].project);
      const ring = [[0.95, 0.55], [-0.95, 0.55], [1.15, -0.05], [-1.15, -0.05], [0.6, 0.95], [-0.6, 0.95]];
      ws.slice(0, 6).forEach((k, i) => {
        const [ox, oy] = ring[i], wx = x + ox * s, wy = y + oy * s, pr = s * 0.3, proj = BUILDINGS[BLDI[k]].project;
        ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(wx, wy + pr * 0.75, pr * 1.05, pr * 0.35, 0, 0, 6.283); ctx.fill();
        const gg = ctx.createLinearGradient(wx, wy - pr, wx, wy + pr); gg.addColorStop(0, proj ? '#ffd0f4' : '#b8fff0'); gg.addColorStop(1, proj ? '#a03a90' : '#2a8a7a');
        ctx.fillStyle = gg; ctx.strokeStyle = '#120a28'; ctx.lineWidth = 1;
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
    const minor = CIVS[this.G.players[c.o].civ].minor;
    const label = (minor ? HX.MINOR_TYPES[minor].glyph + ' ' : c.cap ? '★ ' : '') + c.n + (!minor && !remembered && c.id !== undefined && cityById(this.G, c.id) && cityById(this.G, c.id).buildings.some(k => BUILDINGS[BLDI[k]].project) ? ' ⏳' : '');
    const info = !remembered && c.o === this.pid && this.cityInfo ? this.cityInfo.get(c.id) : null;
    ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width, bh2 = fs * 1.6, pw = bh2;
    let extraW = 0, prodLabel = '';
    if (info && info.prod) { prodLabel = String(info.turns); ctx.font = `600 ${fs * 0.85}px -apple-system, system-ui, sans-serif`; extraW = ctx.measureText(prodLabel).width + fs * (prodLabel ? 1.5 : 1.15); ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`; }
    const rel = null;
    const relW = rel ? fs * 1.3 : 0;
    const bw2 = tw + pw + fs * 0.9 + extraW + relW;
    const bx = x - bw2 / 2, by = y - rs * 0.9 - bh2;
    ctx.fillStyle = 'rgba(14,8,32,.9)'; ctx.strokeStyle = civ.color; ctx.lineWidth = 1.5;
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
    if (info && info.prod) {
      const gx = bx + pw + fs * 0.25 + tw + fs * 0.55 + relW;
      this.drawGlyph(info.prod, gx + fs * 0.45, cy, fs * 0.9);
      ctx.font = `600 ${fs * 0.85}px -apple-system, system-ui, sans-serif`; ctx.fillStyle = '#8ff5dc';
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
    const emb = isEmbarked(this.G, u), tnow = performance.now(), UF = UNITS[u.type];
    if (UF.fauna && Settings.get('anim') !== 'off') y += Math.sin(tnow / 520 + u.id * 1.3) * rad * (UF.colossus ? 0.06 : 0.1);
    if (own && this.G.map.veil[u.tile] && !UF.orbital && HX.veilImmune && !HX.veilImmune(this.G, u)) {
      const pul = 0.5 + 0.5 * Math.sin(tnow / 330);
      ctx.save(); ctx.strokeStyle = `rgba(255,110,200,${0.45 + 0.45 * pul})`; ctx.lineWidth = Math.max(2, rad * 0.16);
      ctx.beginPath(); ctx.ellipse(x, y + rad * 0.95, rad * (1.05 + 0.12 * pul), rad * 0.42, 0, 0, 6.283); ctx.stroke(); ctx.restore();
    }
    if (UF.colossus) { const g0 = ctx.createRadialGradient(x, y, rad * 0.4, x, y, rad * 1.9); g0.addColorStop(0, 'rgba(255,120,210,.35)'); g0.addColorStop(1, 'rgba(255,120,210,0)'); ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(x, y, rad * 1.9, 0, 6.283); ctx.fill(); }
    if (this.tilt < 1 && !emb && !UNITS[u.type].naval) { // 3D: the token stands on the ground and casts a soft shadow
      const gy = y + rad * 1.05;
      ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.beginPath(); ctx.ellipse(x + rad * 0.18, gy, rad * 0.95, rad * 0.3, 0, 0, 6.283); ctx.fill();
      y -= rad * 0.28;
    }
    if (emb) { ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.moveTo(x - rad * 1.25, y + rad * 0.55); ctx.lineTo(x + rad * 1.25, y + rad * 0.55); ctx.lineTo(x + rad * 0.85, y + rad * 1.05); ctx.lineTo(x - rad * 0.85, y + rad * 1.05); ctx.closePath(); ctx.fill(); }
    ctx.save(); ctx.translate(1.5, 2.5); shape(); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); ctx.restore();
    shape();
    const g = ctx.createLinearGradient(x, y - rad, x, y + rad);
    g.addColorStop(0, shade(civ.color, 0.22)); g.addColorStop(1, shade(civ.color, -0.18));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.2 * this.cam.z);
    ctx.strokeStyle = ready ? '#ffffff' : civ.dark; ctx.stroke();
    const UA = UNITS[u.type];
    if (UA.aff || UA.fauna) { ctx.save(); ctx.lineWidth = Math.max(1.5, rad * 0.14); ctx.strokeStyle = UA.fauna ? '#ff7ac8' : AFFINITIES[AFFI[UA.aff]].color; ctx.globalAlpha = 0.9; shape(); ctx.stroke(); ctx.restore(); }
    this.drawIcon(u.type, x, y - (civilian ? 0 : rad * 0.04), rad * (civilian ? 0.66 : 0.74));
    if (UNITS[u.type].civ) { const bx = x + rad * 0.82, by = y + rad * 0.62, br = Math.max(3, rad * 0.2); ctx.beginPath(); ctx.moveTo(bx, by - br); ctx.lineTo(bx + br, by); ctx.lineTo(bx, by + br); ctx.lineTo(bx - br, by); ctx.closePath(); ctx.fillStyle = '#f2d264'; ctx.fill(); ctx.strokeStyle = '#3d2f0c'; ctx.lineWidth = 1; ctx.stroke(); }
    if (own && u.order && u.order.t !== 'goto') {
      const lab = { fortify: 'F', sleep: 'Z', explore: 'E', auto: 'A', heal: '+', dig: '⛏' }[u.order.t] || '';
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
    if (own && this.upgradable && this.upgradable.has(u.id)) {
      const bx = x - rad * 1.05, by = y + rad * 0.05, br = Math.max(6, rad * 0.34);
      ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.283); ctx.fillStyle = '#5fcf7a'; ctx.fill(); ctx.strokeStyle = '#0e2a14'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#0e2a14'; ctx.font = `800 ${br * 1.3}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('↑', bx, by + 0.5);
    }
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
    cx.fillStyle = '#0a0616'; cx.fillRect(0, 0, w, h);
    for (let i = 0; i < W * H; i++) {
      if (!P.explored[i]) continue;
      const c = i % W, r = (i / W) | 0, o = m.owner[i];
      cx.fillStyle = o >= 0 ? CIVS[G.players[o].civ].color : TERRAIN[m.terrain[i]].color;
      cx.globalAlpha = o >= 0 ? 0.85 : P._vis[i] ? 1 : 0.6;
      cx.fillRect((c + 0.5 * (r & 1)) * tw, r * th, tw + 0.6, th + 0.6);
    }
    cx.globalAlpha = 1;
    for (const k in P.seen) { const t = +k, c = t % W, r = (t / W) | 0; cx.fillStyle = '#fff'; cx.fillRect((c + 0.5 * (r & 1)) * tw - 1, r * th - 1, tw + 2, th + 2); }
    for (let i = 0; i < W * H; i++) if (P.explored[i] && m.veil && m.veil[i] && m.owner[i] < 0) { const c = i % W, r = (i / W) | 0; cx.fillStyle = 'rgba(230,120,220,.45)'; cx.fillRect((c + 0.5 * (r & 1)) * tw, r * th, tw + 0.6, th + 0.6); }
    for (const n of G.natural || []) if (P.explored[n.tile]) { const c = n.tile % W, r = (n.tile / W) | 0, x = (c + 0.5 * (r & 1) + 0.5) * tw, y = (r + 0.5) * th, rr = Math.max(2.5, tw * 0.8); cx.fillStyle = '#8ff5dc'; cx.strokeStyle = '#3d2f0c'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x, y - rr); cx.lineTo(x + rr, y); cx.lineTo(x, y + rr); cx.lineTo(x - rr, y); cx.closePath(); cx.fill(); cx.stroke(); }
    for (const u of G.units) if (u.owner === this.pid) { const c = u.tile % W, r = (u.tile / W) | 0; cx.fillStyle = '#ffe08a'; cx.beginPath(); cx.arc((c + 0.5 * (r & 1) + 0.5) * tw, (r + 0.5) * th, Math.max(1.5, tw * 0.45), 0, 6.283); cx.fill(); }
    // camera view
    const vw = this.w / this.cam.z / (SQ3 * HEX_R) * tw, vh = this.h / (this.cam.z * this.tilt) / (1.5 * HEX_R) * th;
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
      for (let k = 0; k < 3; k++) { const ly = y + r * (0.35 - k * 0.28), lx = x - r * 0.15 + k * r * 0.12; ctx.fillStyle = '#9d8bb8'; ctx.fillRect(lx - r * 0.7, ly - r * 0.14, r * 1.2, r * 0.28); ctx.fillStyle = '#c070e0'; ctx.beginPath(); ctx.arc(lx + r * 0.5, ly, r * 0.16, 0, 6.283); ctx.fill(); }
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
    case 'biowell': shadow();
      { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,190,250,.95)'); g.addColorStop(1, 'rgba(200,90,220,.2)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y + r * 0.2, r * 0.8, r * 0.45, 0, 0, 6.283); ctx.fill(); }
      ctx.strokeStyle = '#5fe0a0'; ctx.lineWidth = r * 0.12; for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(x + k * r * 0.45, y + r * 0.2); ctx.quadraticCurveTo(x + k * r * 0.8, y - r * 0.4, x + k * r * 0.3, y - r * 0.8); ctx.stroke(); } break;
    case 'nexus': shadow();
      ctx.fillStyle = '#4a4470'; ctx.fillRect(x - r * 0.12, y - r * 0.6, r * 0.24, r * 1.2);
      ctx.fillStyle = '#f2c94c'; ctx.beginPath(); for (let k = 0; k < 6; k++) { const an = k * Math.PI / 3; ctx.lineTo(x + Math.cos(an) * r * 0.45, y - r * 0.7 + Math.sin(an) * r * 0.45); } ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1b1830'; ctx.beginPath(); ctx.arc(x, y - r * 0.7, r * 0.15, 0, 6.283); ctx.fill(); break;
    case 'terrace': shadow();
      for (let k = 0; k < 3; k++) { ctx.fillStyle = k % 2 ? '#6fbf5a' : '#8bd46c'; ctx.fillRect(x - r * (0.9 - k * 0.2), y + r * (0.3 - k * 0.32), r * (1.8 - k * 0.4), r * 0.28); }
      ctx.fillStyle = '#ffe4ea'; ctx.fillRect(x + r * 0.35, y - r * 0.75, r * 0.3, r * 0.35); ctx.fillStyle = '#ff6f80'; ctx.beginPath(); ctx.moveTo(x + r * 0.3, y - r * 0.75); ctx.lineTo(x + r * 0.5, y - r * 0.95); ctx.lineTo(x + r * 0.7, y - r * 0.75); ctx.fill(); break;
    default: ctx.restore(); return false;
  }
  ctx.restore(); return true;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

const VARIANTS = 4;
// Upright props for the 3D view, painted around a tile centre at (0,0) with footprints squashed by VIEW_TILT.
const PROP_T = new Set();
// Bioluminescent terrain: glow color (A is the alpha slot), dots per tile, strength and height above the ground.
const GLOW_T = {};
GLOW_T[T.FOREST] = { col: 'rgba(120,255,220,A)', n: 4, a: 0.8, up: 0.35 };
GLOW_T[T.MARSH] = { col: 'rgba(255,120,220,A)', n: 3, a: 0.75, up: 0.15 };
GLOW_T[T.MOUNTAIN] = { col: 'rgba(170,140,255,A)', n: 1, a: 0.55, up: 0.6 };
GLOW_T[T.HILLS] = { col: 'rgba(130,200,255,A)', n: 1, a: 0.45, up: 0.25 };
function mushroom(x, px, py, s, cap, glow) {
  x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.ellipse(px + s * 0.25, py + s * 0.06, s * 0.55, s * 0.18, 0, 0, 6.283); x.fill();
  const sg = x.createLinearGradient(px - s * 0.12, 0, px + s * 0.12, 0); sg.addColorStop(0, '#e8dcf5'); sg.addColorStop(1, '#9d8bb8');
  x.fillStyle = sg; x.beginPath(); x.moveTo(px - s * 0.1, py); x.quadraticCurveTo(px - s * 0.05, py - s * 0.7, px - s * 0.07, py - s * 1.05); x.lineTo(px + s * 0.07, py - s * 1.05); x.quadraticCurveTo(px + s * 0.05, py - s * 0.7, px + s * 0.1, py); x.closePath(); x.fill();
  const cg = x.createRadialGradient(px - s * 0.15, py - s * 1.25, s * 0.05, px, py - s * 1.05, s * 0.6); cg.addColorStop(0, shade(cap, 0.35)); cg.addColorStop(1, shade(cap, -0.35));
  x.fillStyle = cg; x.beginPath(); x.ellipse(px, py - s * 1.05, s * 0.55, s * 0.32, 0, Math.PI, 0); x.quadraticCurveTo(px, py - s * 0.92, px - s * 0.55, py - s * 1.05); x.fill();
  x.fillStyle = glow; for (let k = -2; k <= 2; k++) { x.beginPath(); x.arc(px + k * s * 0.17, py - s * (1.16 - Math.abs(k) * 0.04), s * 0.045, 0, 6.283); x.fill(); }
  x.strokeStyle = 'rgba(120,255,220,.35)'; x.lineWidth = Math.max(1, s * 0.04); x.beginPath(); x.ellipse(px, py - s * 1.0, s * 0.5, s * 0.08, 0, 0, Math.PI); x.stroke();
}
function crystal(x, px, py, h, w, col) {
  const g = x.createLinearGradient(px - w, 0, px + w, 0); g.addColorStop(0, shade(col, 0.45)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.4));
  x.fillStyle = g; x.beginPath(); x.moveTo(px - w, py); x.lineTo(px - w * 0.7, py - h * 0.75); x.lineTo(px, py - h); x.lineTo(px + w * 0.7, py - h * 0.7); x.lineTo(px + w, py); x.closePath(); x.fill();
  x.fillStyle = 'rgba(255,255,255,.45)'; x.beginPath(); x.moveTo(px - w * 0.7, py - h * 0.75); x.lineTo(px, py - h); x.lineTo(px - w * 0.15, py - h * 0.2); x.closePath(); x.fill();
}
function drawPropSprite(x, t, v, R) {
  const rnd = lcg(t * 131 + v * 29 + 3), base = TERRAIN[t].color, F = VIEW_TILT;
  const spots = (n, spread) => { const a = []; for (let i = 0; i < n; i++) { const ang = rnd() * 6.283, d = Math.sqrt(rnd()) * spread; a.push([Math.cos(ang) * d * R, Math.sin(ang) * d * R * F]); } return a.sort((p, q) => p[1] - q[1]); };
  const shadow = (px, py, w) => { x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.ellipse(px + w * 0.35, py + w * 0.08, w * 0.95, w * 0.32, 0, 0, 6.283); x.fill(); };
  if (t === T.FOREST) {
    const caps = ['#b45ad8', '#d06ab0', '#7a56e0', '#5fb8d8'];
    for (const [px, py] of spots(5 + (v % 2) * 2, 0.6)) mushroom(x, px, py, R * (0.3 + rnd() * 0.16), caps[Math.floor(rnd() * caps.length)], rnd() < 0.5 ? 'rgba(160,255,230,.9)' : 'rgba(255,220,140,.85)');
  } else if (t === T.HILLS) {
    const hs = v % 2 ? [[-0.34, 0.18, 0.48], [0.32, 0.22, 0.4], [0.02, -0.28, 0.4]] : [[-0.2, 0.0, 0.54], [0.36, 0.3, 0.36], [-0.32, -0.4, 0.3]];
    for (const [hx, hy, hr] of hs.sort((a, b) => a[1] - b[1])) {
      const cx = hx * R, cy = hy * R * F + R * 0.08, rx = hr * R, ry = hr * R * 0.8;
      shadow(cx, cy, rx * 0.9);
      const g = x.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.6, cy);
      g.addColorStop(0, shade(base, 0.3)); g.addColorStop(0.5, shade(base, 0.0)); g.addColorStop(1, shade(base, -0.35));
      x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, Math.PI, 0); x.closePath(); x.fill();
      const col = rnd() < 0.5 ? '#7ff0ff' : '#c58cff';
      crystal(x, cx - rx * 0.2, cy - ry * 0.55, R * (0.28 + rnd() * 0.12), R * 0.07, col);
      crystal(x, cx + rx * 0.25, cy - ry * 0.4, R * (0.18 + rnd() * 0.1), R * 0.05, col);
    }
  } else if (t === T.MOUNTAIN) {
    const peaks = v % 2 ? [[-0.32, -0.1, 0.5], [0.3, 0.05, 0.44], [0, 0.32, 0.62], [0.45, 0.4, 0.3]] : [[-0.2, -0.2, 0.58], [0.34, 0.1, 0.46], [-0.38, 0.32, 0.34], [0.1, 0.4, 0.4]];
    for (const [px0, py0, hgt] of peaks.sort((a, b) => a[1] - b[1])) {
      const bx = px0 * R, by = py0 * R * F + R * 0.15, top = by - hgt * R * 2.4, hw = hgt * R * 0.42;
      shadow(bx, by, hw * 1.4);
      x.fillStyle = '#3c3552'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx - hw * 0.2, top); x.lineTo(bx + hw * 0.15, top + hw * 0.3); x.lineTo(bx + hw, by); x.closePath(); x.fill();
      const lg = x.createLinearGradient(bx - hw, top, bx, by); lg.addColorStop(0, '#a99cc8'); lg.addColorStop(1, '#5d5276');
      x.fillStyle = lg; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx - hw * 0.2, top); x.lineTo(bx - hw * 0.05, by); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(140,255,240,.5)'; x.lineWidth = Math.max(1, R * 0.025); x.beginPath(); x.moveTo(bx - hw * 0.2, top + hw * 0.4); x.lineTo(bx - hw * 0.1, by - hw); x.stroke();
    }
  } else if (t === T.MARSH) {
    for (const [px, py] of spots(4, 0.55)) {
      const s = R * (0.14 + rnd() * 0.1);
      x.strokeStyle = '#3d5a34'; x.lineWidth = Math.max(1, s * 0.18); x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px - s * 0.4, py - s * 1.2, px + s * 0.1, py - s * 2.2); x.stroke();
      const g = x.createRadialGradient(px + s * 0.1, py - s * 2.3, s * 0.05, px + s * 0.1, py - s * 2.3, s * 0.6); g.addColorStop(0, 'rgba(255,210,250,.95)'); g.addColorStop(1, 'rgba(200,120,230,0)');
      x.fillStyle = g; x.beginPath(); x.arc(px + s * 0.1, py - s * 2.3, s * 0.6, 0, 6.283); x.fill();
    }
  }
}
[T.FOREST, T.HILLS, T.MOUNTAIN, T.MARSH].forEach(t => PROP_T.add(t));
function drawTerrainSprite(x, t, v, R, ground) {
  const base = TERRAIN[t].color, rnd = lcg(t * 97 + v * 13 + 7);
  const L = Math.max(1, R * 0.045);
  const pts = (n, spread) => { const a = []; for (let i = 0; i < n; i++) a.push([(rnd() - 0.5) * 2 * spread * R, (rnd() - 0.5) * 2 * spread * R]); return a; };
  const blob = (cx, cy, rx, ry, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, rnd() * 3, 0, 6.283); x.fill(); };
  const glowDot = (px, py, r0, col) => { const g = x.createRadialGradient(px, py, 0, px, py, r0 * 3); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py, r0 * 3, 0, 6.283); x.fill(); };
  x.save();
  x.beginPath(); hexPath(x, 0, 0, R + 0.8); x.clip();
  const gr = x.createRadialGradient(-R * 0.35, -R * 0.45, R * 0.1, 0, 0, R * 1.25);
  gr.addColorStop(0, shade(base, 0.1)); gr.addColorStop(1, shade(base, -0.18));
  x.fillStyle = gr; x.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
  for (let k = 0; k < 3; k++) blob((rnd() - 0.5) * R, (rnd() - 0.5) * R, R * (0.25 + rnd() * 0.3), R * (0.15 + rnd() * 0.2), rnd() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)');
  for (let k = 0; k < 60; k++) { x.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.07)'; const [px, py] = pts(1, 0.95)[0]; x.fillRect(px, py, L * 0.9, L * 0.9); }
  if (t === T.GRASS) { // teal blades that glow at the tips
    x.strokeStyle = shade(base, -0.32); x.lineWidth = L;
    for (const [px, py] of pts(12, 0.62)) { x.beginPath(); x.moveTo(px - R * 0.05, py); x.quadraticCurveTo(px - R * 0.02, py - R * 0.08, px + R * 0.02, py - R * 0.13); x.moveTo(px, py); x.lineTo(px + R * 0.06, py - R * 0.09); x.stroke(); }
    for (const [px, py] of pts(6 + v, 0.6)) glowDot(px, py, L * 0.55, 'rgba(150,255,225,.8)');
  } else if (t === T.PLAINS) { // rust flats: cracked stone, lichen
    x.strokeStyle = shade(base, -0.35); x.lineWidth = L * 0.8;
    for (const [px, py] of pts(5, 0.5)) { x.beginPath(); x.moveTo(px, py); x.lineTo(px + R * 0.12, py + R * 0.05); x.lineTo(px + R * 0.18, py - R * 0.06); x.moveTo(px + R * 0.12, py + R * 0.05); x.lineTo(px + R * 0.1, py + R * 0.16); x.stroke(); }
    for (const [px, py] of pts(4, 0.55)) blob(px, py, R * 0.1, R * 0.06, 'rgba(160,220,140,.25)');
    for (const [px, py] of pts(7, 0.6)) blob(px, py, R * 0.035, R * 0.025, shade(base, 0.3));
  } else if (t === T.DESERT) { // lilac dunes with glass glints
    for (let k = 0; k < 3; k++) {
      const py = (k - 1) * R * 0.42 + (rnd() - 0.5) * R * 0.2, px = (rnd() - 0.5) * R * 0.5, rr = R * (0.34 + rnd() * 0.1);
      x.fillStyle = shade(base, -0.14); x.beginPath(); x.ellipse(px + rr * 0.15, py + R * 0.1, rr, rr * 0.35, 0, Math.PI, 0); x.fill();
      x.fillStyle = shade(base, 0.14); x.beginPath(); x.ellipse(px - rr * 0.1, py + R * 0.1, rr * 0.75, rr * 0.28, 0, Math.PI, Math.PI * 1.6); x.fill();
    }
    for (const [px, py] of pts(5, 0.6)) { x.fillStyle = 'rgba(230,250,255,.85)'; x.beginPath(); x.moveTo(px, py - L * 1.4); x.lineTo(px + L * 0.6, py); x.lineTo(px, py + L * 1.4); x.lineTo(px - L * 0.6, py); x.closePath(); x.fill(); }
  } else if (t === T.TUNDRA) { // frost shelf: blue ice plates and cracks
    for (const [px, py] of pts(4, 0.5)) blob(px, py, R * (0.18 + rnd() * 0.14), R * 0.1, 'rgba(225,245,255,.32)');
    x.strokeStyle = 'rgba(255,255,255,.45)'; x.lineWidth = L * 0.7;
    for (const [px, py] of pts(4, 0.5)) { x.beginPath(); x.moveTo(px - R * 0.15, py); x.lineTo(px, py + R * 0.05); x.lineTo(px + R * 0.12, py - R * 0.04); x.stroke(); }
    x.fillStyle = 'rgba(240,250,255,.55)'; for (const [px, py] of pts(10, 0.65)) x.fillRect(px, py, L * 1.2, L * 1.2);
  } else if (ground && (t === T.HILLS || t === T.FOREST || t === T.MOUNTAIN || t === T.MARSH)) {
    if (t === T.FOREST) { for (const [px, py] of pts(8, 0.6)) blob(px, py, R * 0.18, R * 0.1, 'rgba(20,10,40,.28)'); for (const [px, py] of pts(10, 0.6)) glowDot(px, py, L * 0.4, 'rgba(170,255,230,.55)'); }
    else if (t === T.MOUNTAIN) { for (const [px, py] of pts(10, 0.6)) blob(px, py, R * 0.12, R * 0.07, rnd() < 0.5 ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.2)'); }
    else if (t === T.MARSH) { for (const [px, py] of pts(4, 0.45)) blob(px, py, R * (0.18 + rnd() * 0.12), R * (0.08 + rnd() * 0.05), 'rgba(120,200,150,.4)'); }
    else for (const [px, py] of pts(5, 0.55)) blob(px, py, R * 0.22, R * 0.12, 'rgba(0,0,0,.1)');
  } else if (t === T.HILLS) {
    const hs = v % 2 ? [[-0.34, 0.18, 0.44], [0.32, 0.26, 0.38], [0.02, -0.24, 0.36]] : [[-0.2, 0.05, 0.5], [0.36, 0.32, 0.34], [-0.3, -0.38, 0.28]];
    hs.sort((a, b) => a[1] - b[1]);
    for (const [hx, hy, hr] of hs) {
      const cx = hx * R, cy = hy * R + R * 0.1, rx = hr * R, ry = hr * R * 0.66;
      const hg = x.createLinearGradient(cx - rx, cy - ry, cx + rx, cy);
      hg.addColorStop(0, shade(base, 0.25)); hg.addColorStop(0.55, shade(base, -0.05)); hg.addColorStop(1, shade(base, -0.3));
      x.fillStyle = hg; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, Math.PI, 0); x.closePath(); x.fill();
      crystal(x, cx, cy - ry * 0.4, R * 0.2, R * 0.05, rnd() < 0.5 ? '#7ff0ff' : '#c58cff');
    }
  } else if (t === T.FOREST) {
    const caps = ['#b45ad8', '#d06ab0', '#7a56e0', '#5fb8d8'];
    for (const [px, py] of pts(6 + (v % 2) * 2, 0.55).sort((a, b) => a[1] - b[1])) mushroom(x, px, py + R * 0.15, R * (0.2 + rnd() * 0.08), caps[Math.floor(rnd() * caps.length)], 'rgba(160,255,230,.9)');
  } else if (t === T.MARSH) {
    for (const [px, py] of pts(4, 0.45)) blob(px, py, R * (0.18 + rnd() * 0.12), R * (0.08 + rnd() * 0.05), 'rgba(120,200,150,.45)');
    for (const [px, py] of pts(5, 0.55)) glowDot(px, py, L * 0.8, 'rgba(255,190,245,.7)');
    x.strokeStyle = shade(base, -0.38); x.lineWidth = L;
    for (const [px, py] of pts(8, 0.58)) { x.beginPath(); x.moveTo(px, py); x.lineTo(px - R * 0.04, py - R * 0.17); x.moveTo(px, py); x.lineTo(px + R * 0.05, py - R * 0.15); x.stroke(); }
  } else if (t === T.MOUNTAIN) {
    const peaks = v % 2 ? [[-0.3, 0.42, 0.42], [0.26, 0.45, 0.36], [0, 0.28, 0.55]] : [[-0.18, 0.4, 0.5], [0.3, 0.38, 0.4], [-0.42, 0.5, 0.26]];
    peaks.sort((a, b) => a[1] - b[1]);
    for (const [px, by0, hgt] of peaks) {
      const bx = px * R, by = by0 * R, top = by - hgt * R * 1.9, hw = hgt * R * 0.45;
      x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse(bx + hw * 0.3, by, hw * 1.3, hw * 0.3, 0, 0, 6.283); x.fill();
      x.fillStyle = '#433b5c'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx - hw * 0.15, top); x.lineTo(bx + hw, by); x.closePath(); x.fill();
      x.fillStyle = '#9a8fbd'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx - hw * 0.15, top); x.lineTo(bx - hw * 0.1, by); x.closePath(); x.fill();
    }
  } else if (t === T.COAST || t === T.OCEAN) {
    const deep = t === T.OCEAN;
    if (!deep) for (const [px, py] of pts(4, 0.5)) blob(px, py, R * 0.25, R * 0.12, 'rgba(180,255,240,.07)');
    else for (const [px, py] of pts(3, 0.5)) blob(px, py, R * 0.3, R * 0.14, 'rgba(160,80,200,.12)');
    x.strokeStyle = deep ? 'rgba(190,160,255,.16)' : 'rgba(210,255,245,.3)'; x.lineWidth = L * 1.1;
    for (const [px, py] of pts(deep ? 3 : 4, 0.5)) {
      x.beginPath(); x.arc(px - R * 0.08, py, R * 0.09, Math.PI * 1.1, Math.PI * 1.9); x.arc(px + R * 0.1, py, R * 0.09, Math.PI * 1.1, Math.PI * 1.9); x.stroke();
    }
    if (deep && v % 2) for (const [px, py] of pts(2, 0.5)) glowDot(px, py, L * 0.5, 'rgba(140,255,230,.45)');
  }
  x.restore();
}
