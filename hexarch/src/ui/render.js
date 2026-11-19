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
const ELEV = { grass: 6, plains: 6, desert: 5, tundra: 6, hills: 13, forest: 7, marsh: 3, mountain: 21, coast: 1, ocean: 0 };
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
    if (this.lazyStale) more = true;
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
    this.sprites = []; this.spriteZ = z; this.spriteW = sw; this.spriteH = sh;
    const keepTilt = TILT; TILT = 1; // ground sprites are painted flat and squashed when drawn
    for (let t = 0; t <= LAKE_T; t++) {
      const row = [];
      for (let v = 0; v < VARIANTS; v++) {
        const c = document.createElement('canvas'); c.width = sw; c.height = sh;
        const x = c.getContext('2d'); x.translate(sw / 2, sh / 2);
        drawTerrainSprite(x, t, v, R, this.tilt < 1);
        row.push(c);
      }
      this.sprites.push(row);
    }
    this.ground = new Map(); // grey, dimmed and improvement-baked variants, made on first use
    // 3D props: taller canvases with the tile centre at (pw/2, ph*0.72)
    this.props = new Map(); this.propGrays = new Map();
    if (this.tilt < 1) {
      const pw = Math.ceil(SQ3 * R) + 8, ph = Math.ceil(2.9 * R); this.propW = pw; this.propH = ph;
      for (const t of PROP_T) {
        const row = [];
        for (let v = 0; v < VARIANTS; v++) {
          const c = document.createElement('canvas'); c.width = pw; c.height = ph;
          const x = c.getContext('2d'); x.translate(pw / 2, ph * 0.72); drawPropSprite(x, t, v, R); row.push(c);
        }
        this.props.set(t, row);
      }
    }
    TILT = keepTilt;
    this.spriteTilt = this.tilt; this.skirts = new Map(); this.imps = new Map();
    if (!this.art || this.art.size > 400) this.art = new Map(); // figures, cities, wonders, icons: kept across zooms, refreshed a few per frame
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
    const rock = t === T.MOUNTAIN || t === T.HILLS, snow = t === T.TUNDRA, sand = t === T.DESERT, wet = TERRAIN[t].water;
    const [lit, dark] = t === T.MOUNTAIN ? ['#8a837b', '#625c56'] : t === T.HILLS ? ['#8f7a58', '#6a5940'] : snow ? ['#9a978e', '#77746c'] : sand ? ['#c9a46c', '#a07e4c'] : wet ? ['#2c6a92', '#235676'] : ['#8a6a48', '#634b33'];
    const rnd = lcg(t * 31 + ev * 7 + 1);
    const face = (a2, b2, col) => {
      const g = x.createLinearGradient(0, a2[1], 0, a2[1] + E); g.addColorStop(0, col); g.addColorStop(1, shade(col, -0.4)); x.fillStyle = g;
      x.beginPath(); x.moveTo(a2[0], a2[1]); x.lineTo(b2[0], b2[1]); x.lineTo(b2[0], b2[1] + E); x.lineTo(a2[0], a2[1] + E); x.closePath(); x.fill();
      if (wet || E < 4) return;
      x.save(); x.clip();
      // strata: wavy horizontal bands and a few vertical cracks
      x.lineWidth = Math.max(1, E * 0.06);
      for (let k = 1; k < 4; k++) {
        const f = k / 4 + (rnd() - 0.5) * 0.08; x.strokeStyle = k % 2 ? 'rgba(0,0,0,.18)' : 'rgba(255,240,210,.12)';
        x.beginPath(); for (let q = 0; q <= 6; q++) { const px = a2[0] + (b2[0] - a2[0]) * q / 6, py = a2[1] + (b2[1] - a2[1]) * q / 6 + E * f + Math.sin(q * 1.7 + k) * E * 0.04; q ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
      }
      x.strokeStyle = 'rgba(0,0,0,.22)'; x.lineWidth = Math.max(1, E * 0.05);
      for (let k = 0; k < (rock ? 4 : 2); k++) { const q = 0.1 + rnd() * 0.8, px = a2[0] + (b2[0] - a2[0]) * q, py = a2[1] + (b2[1] - a2[1]) * q; x.beginPath(); x.moveTo(px, py + E * 0.15); x.lineTo(px + E * 0.05, py + E * (0.4 + rnd() * 0.4)); x.stroke(); }
      x.restore();
    };
    face(pts[0], pts[1], dark); face(pts[1], pts[2], lit);
    if (!wet && !rock) { // a lip of the tile's own ground (grass, sand, snow) overhanging the cliff
      const lip = snow ? '#eef3f4' : (GROUND[t] || [])[1] || TERRAIN[t].color;
      x.strokeStyle = lip; x.lineWidth = Math.max(1.2, E * 0.28); x.lineCap = 'round';
      x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); x.lineTo(pts[1][0], pts[1][1]); x.lineTo(pts[2][0], pts[2][1]); x.stroke();
    }
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
    px = Math.max(5, Math.round(px)); const key = '#' + name + px; let c = this.glyphs.get(key);
    if (!c) { c = iconCanvas(name, px, this.dpr); this.glyphs.set(key, c); }
    const s = c.width / this.dpr; this.ctx.drawImage(c, x - s / 2, y - s / 2, s, s);
  }
  // A terrain tile as drawn: state 0 in view, 1 remembered (grey in high quality), 2 remembered in 3D (grey and
  // darkened, baked in so no per-tile overlay is needed). imp bakes a ground improvement (farm, plantation) into the tile.
  groundSprite(t, v, imp, state) {
    const hi = Settings.get('quality') !== 'battery';
    if (!imp && (state === 0 || (state === 1 && !hi))) return this.sprites[t][v];
    const key = t * 64 + v * 4 + state + (imp ? '|' + imp : ''); let c = this.ground.get(key); if (c) return c;
    const src = this.sprites[t][v], w = src.width, hh = src.height;
    c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d');
    x.drawImage(src, 0, 0);
    if (imp) { const sp = this.impSprite(imp, v); if (sp) x.drawImage(sp, 0, 0); }
    if (state && hi) { x.globalCompositeOperation = 'saturation'; x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, w, hh); x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0); }
    if (state === 2) { x.globalCompositeOperation = 'source-atop'; x.fillStyle = hi ? 'rgba(8,12,18,.34)' : 'rgba(8,12,18,.46)'; x.fillRect(0, 0, w, hh); }
    x.globalCompositeOperation = 'source-over';
    this.ground.set(key, c); return c;
  }
  propGray(t, v) {
    const key = t * 8 + v; let g = this.propGrays.get(key); if (g) return g;
    const c = this.props.get(t)[v]; g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
    const gx = g.getContext('2d'); gx.drawImage(c, 0, 0); gx.globalCompositeOperation = 'saturation'; gx.fillStyle = 'rgb(128,128,128)'; gx.fillRect(0, 0, g.width, g.height);
    gx.globalCompositeOperation = 'destination-in'; gx.drawImage(c, 0, 0); this.propGrays.set(key, g); return g;
  }
  // Cached art that survives zoom changes: a stale copy is scaled while a few fresh ones are painted per frame.
  lazyArt(key, build) {
    const e = this.art.get(key);
    if (e && e.z === this.spriteZ) return e;
    if (!e || performance.now() < this.lazyEnd) { const c = build(); if (c) { c.z = this.spriteZ; this.art.set(key, c); } return c; }
    this.lazyStale = true; return e;
  }
  // Improvement art, painted once per zoom: ground kinds fill the tile, the rest are small vignettes.
  impSprite(key, v) {
    const ck = key + v; if (this.imps.has(ck)) return this.imps.get(ck);
    const R = HEX_R * this.spriteZ * this.dpr, ground = IMP_GROUND.has(key);
    const c = document.createElement('canvas');
    if (ground) { c.width = this.spriteW; c.height = this.spriteH; } else { c.width = c.height = Math.ceil(R * 1.15); }
    const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2);
    const keep = TILT; TILT = 1; const ok = drawImprovementSprite(x, key, v, R) !== false; TILT = keep;
    c.ground = ground; const out = ok ? c : null; this.imps.set(ck, out); return out;
  }
  // Broken columns on a stone plinth, with a slow golden glint: something worth a detour.
  drawRuin(x, y, rs, alpha, now) {
    const ctx = this.ctx, k = rs / 30;
    if (k < 0.25) return;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(k, k);
    const gl = ctx.createRadialGradient(0, -6, 2, 0, -6, 22); gl.addColorStop(0, 'rgba(255,214,120,.38)'); gl.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -6, 22, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(1, 7, 17, 5, 0, 0, 6.283); ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(38,30,16,.9)';
    const stone = (px, py, w, hgt) => { const g = ctx.createLinearGradient(px, 0, px + w, 0); g.addColorStop(0, '#efe4c4'); g.addColorStop(0.55, '#cbbd96'); g.addColorStop(1, '#8c7f5f');
      ctx.fillStyle = g; ctx.beginPath(); ctx.rect(px, py, w, hgt); ctx.fill(); ctx.stroke(); };
    stone(-15, 2, 30, 5);                                   // plinth
    stone(-12, -14, 5, 16); stone(-12.8, -16, 6.6, 2.5);    // tall column with capital
    stone(-2.5, -7, 5, 9);                                   // broken column
    ctx.fillStyle = '#d9cca8'; ctx.beginPath(); ctx.moveTo(-2.5, -7); ctx.lineTo(0, -9.5); ctx.lineTo(2.5, -7.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    stone(7, -11, 5, 13);                                    // third column
    ctx.save(); ctx.translate(9, -14); ctx.rotate(-0.22); stone(-13, -2.5, 15, 3.5); ctx.restore(); // fallen lintel
    ctx.fillStyle = '#7d8f4a'; ctx.beginPath(); ctx.ellipse(-6, 2, 3.5, 1.6, 0, 0, 6.283); ctx.ellipse(12, 2.5, 3, 1.4, 0, 0, 6.283); ctx.fill(); // moss
    const tw = (Math.sin((now || 0) / 520 + x * 0.05) + 1) / 2;   // twinkle
    ctx.globalAlpha = alpha * (0.35 + 0.65 * tw); ctx.fillStyle = '#ffe9a6';
    ctx.beginPath(); ctx.moveTo(13, -20); ctx.lineTo(14.2, -17.2); ctx.lineTo(17, -16); ctx.lineTo(14.2, -14.8); ctx.lineTo(13, -12); ctx.lineTo(11.8, -14.8); ctx.lineTo(9, -16); ctx.lineTo(11.8, -17.2); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  drawGlyph(ch, x, y, px) { const c = this.glyph(ch, px), s = c.width / this.dpr; this.ctx.drawImage(c, x - s / 2, y - s / 2, s, s); }

  // ---- main draw ----
  draw(now) {
    const ctx = this.ctx, dpr = this.dpr;
    TILT = this.tilt; const T3 = TILT < 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070a0e'; ctx.fillRect(0, 0, this.w, this.h);
    const G = this.G; if (!G) return;
    const z = this.cam.z;
    this.lazyEnd = performance.now() + 6; this.lazyStale = false;
    if (!this.sprites || this.spriteTilt !== this.tilt || (!this.gesturing && Math.abs(z / this.spriteZ - 1) > 0.12)) this.buildSprites();
    const m = G.map, W = m.W, H = m.H, P = G.players[this.pid], ex = P.explored, vis = P._vis, nb = G._grid.nb;
    const rs = HEX_R * z, k = z / this.spriteZ, sw = this.spriteW / dpr * k, sh = this.spriteH / dpr * k;
    const [lx, ty] = this.screenToWorld(0, 0), [rx, by] = this.screenToWorld(this.w, this.h);
    const r0 = Math.max(0, Math.floor((ty - HEX_R) / (1.5 * HEX_R)) - 1), r1 = Math.min(H - 1, Math.ceil((by - HEX_R) / (1.5 * HEX_R)) + (T3 ? 2 : 1));
    const c0 = Math.floor(lx / (SQ3 * HEX_R)) - 1, c1 = Math.ceil(rx / (SQ3 * HEX_R)) + 1;
    const fog = new Path2D(), dim = new Path2D(), grid = new Path2D(), river = new Path2D(), shore = new Path2D(), foam = new Path2D();
    const tint = new Map(), border = new Map();
    const resList = [], impList = [], road = new Path2D(), rail = new Path2D(), lens = [], props = [], waves = [];
    const amb = this.ambientOn();
    const far = z < 0.58; // far out: skip icons and lines that are unreadable at this scale
    const lensM = Settings.get('lens') === true ? 'yields' : Settings.get('lens');
    const showGrid = Settings.get('grid') && !far, showRes = Settings.get('resources') && !far, showLens = lensM === 'yields' && !far, relLens = lensM === 'religion';
    const relTint = new Map();
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
        const iv = m.improv[i], gimp = iv && !far && IMP_GROUND.has(IMPROV[iv].key) ? IMPROV[iv].key : null;
        ctx.drawImage(this.groundSprite(m.lake[i] ? LAKE_T : t, (i * 2654435761 >>> 27) % VARIANTS, gimp, seen ? 0 : T3 ? 2 : 1), sx - sw / 2, sy - sh * TILT / 2, sw, sh * TILT);
        if (T3 && PROP_T.has(t) && !G._cityAt.has(i)) props.push(t, (i * 2654435761 >>> 27) % VARIANTS, sx, sy, seen ? 1 : 0);
        if (amb && seen && TERRAIN[t].water && !far) waves.push(sx, sy, i);
        if (!seen && !T3) { hexPath(dim, sx, sy, rs + 0.6); anyDim = true; } // 3D: the darkening is baked into the sprite, in draw order
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
        if (m.improv[i] && !far) impList.push(m.improv[i], sx, sy, i);
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
    for (const [col, p] of relTint) { ctx.globalAlpha = 0.38; ctx.fillStyle = col; ctx.fill(p); }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    // beaches: a soft sand band on the land side, then a broken line of surf on the water side
    ctx.strokeStyle = 'rgba(214,190,130,.38)'; ctx.lineWidth = Math.max(3, 6.5 * z); ctx.stroke(shore);
    ctx.strokeStyle = 'rgba(236,218,160,.7)'; ctx.lineWidth = Math.max(1.5, 3 * z); ctx.stroke(shore);
    ctx.strokeStyle = 'rgba(240,250,255,.42)'; ctx.lineWidth = Math.max(1, 1.5 * z); ctx.stroke(foam);
    // rivers: a dark bank, the water, and a thin highlight
    ctx.strokeStyle = 'rgba(40,52,30,.45)'; ctx.lineWidth = Math.max(3.5, 7.5 * z); ctx.stroke(river);
    ctx.strokeStyle = '#2f7fc0'; ctx.lineWidth = Math.max(2.5, 5 * z); ctx.stroke(river);
    ctx.strokeStyle = 'rgba(160,215,255,.85)'; ctx.lineWidth = Math.max(0.8, 1.3 * z); ctx.stroke(river);
    if (showGrid) { ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1; ctx.stroke(grid); }
    for (let j = 0; j < impList.length; j += 4) {
      const I = IMPROV[impList[j]], x = impList[j + 1], y = impList[j + 2], v = (impList[j + 3] * 2654435761 >>> 27) % VARIANTS;
      const sp = this.impSprite(I.key, v);
      if (!sp) { const gx = x - rs * 0.42, gy = y + rs * 0.42; ctx.fillStyle = 'rgba(20,24,30,.78)'; ctx.beginPath(); ctx.arc(gx, gy, Math.max(7, rs * 0.25), 0, 6.283); ctx.fill(); this.drawGlyph(I.glyph, gx, gy, Math.max(8, rs * 0.3)); continue; }
      if (sp.ground) continue; // baked into the tile sprite
      { const w = sp.width / dpr * k, hh = sp.height / dpr * k; ctx.drawImage(sp, x - rs * 0.36 - w / 2, y + rs * 0.3 * TILT - hh / 2, w, hh); }
    }
    // roads: packed earth with a worn, lighter centre; railroads: sleepers under two steel rails
    ctx.strokeStyle = 'rgba(70,48,28,.55)'; ctx.lineWidth = Math.max(2.5, 5.5 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(176,140,92,.95)'; ctx.lineWidth = Math.max(1.6, 3.6 * z); ctx.stroke(road);
    ctx.strokeStyle = 'rgba(60,50,44,.6)'; ctx.lineWidth = Math.max(3, 6 * z); ctx.stroke(rail);
    ctx.strokeStyle = '#5a3e26'; ctx.lineWidth = Math.max(3, 7 * z); ctx.setLineDash([1.6 * z + 0.6, 2.4 * z + 0.6]); ctx.lineCap = 'butt'; ctx.stroke(rail); ctx.setLineDash([]);
    ctx.strokeStyle = '#c4c8d0'; ctx.lineWidth = Math.max(1.6, 3.6 * z); ctx.stroke(rail);
    ctx.strokeStyle = '#4a3a2c'; ctx.lineWidth = Math.max(0.6, 1.6 * z); ctx.stroke(rail); ctx.lineCap = 'round';
    // 3D: trees, hills and peaks stand up after the ground layers, back rows first
    if (props.length) {
      const pw = this.propW / dpr * k, ph = this.propH / dpr * k;
      for (let j = 0; j < props.length; j += 5) {
        const img = props[j + 4] || !hi ? this.props.get(props[j])[props[j + 1]] : this.propGray(props[j], props[j + 1]);
        ctx.drawImage(img, props[j + 2] - pw / 2, props[j + 3] - ph * 0.72, pw, ph);
      }
    }
    // 3D: distance haze toward the top of the screen
    if (T3) { const hz = ctx.createLinearGradient(0, 0, 0, this.h * 0.5); hz.addColorStop(0, 'rgba(120,140,170,.22)'); hz.addColorStop(1, 'rgba(120,140,170,0)'); ctx.fillStyle = hz; ctx.fillRect(0, 0, this.w, this.h * 0.5); }
    for (let j = 0; j < resList.length; j += 3) {
      const R0 = RES[resList[j]], px = Math.max(7, rs * 0.27);
      const c = this.lazyArt('res' + R0.key, () => resourceCanvas(R0.key, R0.kind, Math.max(7, HEX_R * this.spriteZ * 0.27), dpr));
      const s2 = px * 2.3; ctx.drawImage(c, resList[j + 1] + rs * 0.42 - s2 / 2, resList[j + 2] + rs * 0.36 * TILT - s2 / 2, s2, s2);
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
        ctx.strokeStyle = 'rgba(40,28,6,.55)'; ctx.lineWidth = Math.max(2.5, 4 * z); ctx.stroke();
        ctx.strokeStyle = 'rgba(240,210,120,.9)'; ctx.lineWidth = Math.max(1.2, 2 * z); ctx.stroke();
        if (z > 0.8) this.drawGlyph('🐪', (ax + 2 * mx + bx) / 4, (ay + 2 * my + by) / 4, Math.max(10, 13 * z));
      }
      ctx.restore();
    }
    // natural wonders: a glowing medallion and, up close, a name
    for (const n of G.natural || []) {
      if (!P.explored[n.tile]) continue;
      const [nx, ny] = this.posOf(n.tile); if (nx < -rs * 2 || nx > this.w + rs * 2 || ny < -rs * 2 || ny > this.h + rs * 2) continue;
      const N = naturalAt(G, n.tile), r = Math.max(10, rs * 0.42);
      const gl = ctx.createRadialGradient(nx, ny, r * 0.2, nx, ny, r * 1.6); gl.addColorStop(0, 'rgba(255,240,180,.55)'); gl.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(nx, ny, r * 1.6, 0, 6.283); ctx.fill();
      ctx.fillStyle = 'rgba(20,24,30,.82)'; ctx.strokeStyle = '#f0d690'; ctx.lineWidth = Math.max(1.5, 2.5 * z);
      ctx.beginPath(); ctx.arc(nx, ny, r, 0, 6.283); ctx.fill(); ctx.stroke();
      this.drawGlyph(N.glyph, nx, ny, r * 1.15);
      if (z > 0.9) { ctx.font = `600 ${Math.max(10, 11 * z)}px -apple-system, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(N.name, nx, ny + r * 1.1); ctx.fillStyle = '#f6e7b8'; ctx.fillText(N.name, nx, ny + r * 1.1); }
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
    ctx.fillStyle = '#0b0f15'; ctx.fill(fog);
    if (hi) {
      const f = this.fogCv, sc = 1 / 10, fw = Math.ceil(this.w * sc), fh = Math.ceil(this.h * sc);
      if (f.width !== fw || f.height !== fh) { f.width = fw; f.height = fh; }
      const fx = f.getContext('2d'); fx.setTransform(1, 0, 0, 1, 0, 0); fx.clearRect(0, 0, fw, fh);
      fx.setTransform(sc, 0, 0, sc, 0, 0); fx.fillStyle = '#0b0f15'; fx.fill(fog);
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
    const calls = [];
    for (const [u, x, y, moving] of drawn) {
      const civ = isCivilianUnit(u), both = !moving && G._mil.has(u.tile) && G._civ.has(u.tile);
      if (!moving && G._cityAt.has(u.tile)) { // garrison: a smaller figure at the city's edge so the city stays visible
        calls.push([u, x + (civ ? -rs * 0.5 : rs * 0.5), y + rs * 0.3, rs * 0.62, civ]); continue;
      }
      const px = both ? (civ ? x - rs * 0.3 : x + rs * 0.2) : x, py = both ? (civ ? y + rs * 0.14 : y - rs * 0.16) : y - rs * 0.04;
      calls.push([u, px, py, rs, civ]);
    }
    calls.sort((a, b) => a[2] - b[2]); // back to front so nearer figures overlap farther ones
    for (const c of calls) this.drawUnit(c[0], c[1], c[2], c[3], c[4]);
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
      const occ = G._mil.has(cp.tile), cr = occ ? rs * 0.26 : rs * 0.42;
      const cc = this.lazyArt('camp', () => { const cr0 = HEX_R * this.spriteZ * 0.42, S = Math.ceil(cr0 * 2.8 * dpr), c2 = document.createElement('canvas'); c2.width = S; c2.height = S; const cx2 = c2.getContext('2d'); cx2.translate(S * 0.42, S * 0.55); cx2.lineJoin = 'round'; drawBarbCamp(cx2, cr0 * dpr); return c2; });
      const cw2 = cr * 2.8, ccx = occ ? x - rs * 0.45 : x, ccy = occ ? y + rs * 0.4 : y + rs * 0.05;
      ctx.drawImage(cc, ccx - cw2 * 0.42, ccy - cw2 * 0.55, cw2, cw2);
      if (cp.hoard) { const hx = x + rs * 0.42, hy = y + rs * 0.42, hr = Math.max(6, rs * 0.2); ctx.fillStyle = '#2e1438'; ctx.strokeStyle = '#d99af0'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, 6.283); ctx.fill(); ctx.stroke(); ctx.save(); ctx.translate(hx, hy); paintResource(ctx, 'gems', hr * 0.7); ctx.restore(); } } // a relic hoard
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

  // Cities are painted once per look (size, era, walls, landmarks, zoom) and cached; wonders stand around them.
  drawCity(x, y, c, rs, remembered) {
    const ctx = this.ctx, G = this.G, owner = G.players[c.o], civ = CIVS[owner.civ], z = this.cam.z, dpr = this.dpr;
    const live = !remembered && c.id !== undefined ? cityById(G, c.id) : null;
    const has = k => !!live && live.buildings.includes(k);
    const era = playerEra(owner);
    const wall = has('bastion') ? 3 : has('castle') ? 2 : has('walls') ? 1 : 0;
    const marks = ['temple', 'shrine', 'grand_temple', 'factory', 'power_plant', 'university', 'observatory', 'harbor', 'broadcast_tower'].filter(has);
    const key = [c.id, era, Math.min(14, Math.floor(c.p / 1.4)), c.p >= 8 ? 1 : 0, Math.min(10, c.p), c.cap ? 1 : 0, wall, marks.join(','), civ.key].join('|');
    const cv = this.lazyArt('city' + key, () => {
      const S = HEX_R * this.spriteZ * dpr, top = era >= 5 ? 1.75 : era >= 4 ? 1.2 : 0.95, c2 = document.createElement('canvas'); c2.width = Math.ceil(S * 1.86); c2.height = Math.ceil(S * (top + 0.9));
      const cx = c2.getContext('2d'); cx.translate(c2.width / 2, S * top); cx.lineJoin = 'round'; cx.lineCap = 'round';
      const kt = TILT; TILT = 1;
      paintCity(cx, S, { era, pop: c.p, cap: c.cap, wall, civ, seed: (c.id || 0) + 1, has, tilt: this.tilt });
      TILT = kt; c2.oy = S * top; return c2;
    });
    const k = z / cv.z, w = cv.width / dpr * k, hh = cv.height / dpr * k;
    const ws = live && z > 0.45 ? live.buildings.filter(b => BUILDINGS[BLDI[b]].wonder || BUILDINGS[BLDI[b]].project).slice(0, 6) : [];
    const ring = [[-0.92, -0.16], [0.92, -0.16], [-0.8, 0.42], [0.8, 0.42], [-0.42, 0.72], [0.42, 0.72]];
    const wr = rs * 0.31, drawW = (wk, i) => {
      const [ox, oy] = ring[i], wx = x + ox * rs, wy = y + oy * rs * this.tilt + wr * 0.2;
      const wc = this.lazyArt('w' + wk, () => { const wr0 = HEX_R * this.spriteZ * 0.31, S2 = Math.ceil(wr0 * 2.4 * dpr), c2 = document.createElement('canvas'); c2.width = S2; c2.height = Math.ceil(S2 * 1.2); const wx2 = c2.getContext('2d'); wx2.translate(S2 / 2, c2.height * 0.82); wx2.lineJoin = 'round'; wx2.lineCap = 'round';
        if (!paintWonder(wx2, wk, wr0 * dpr)) { wx2.font = `${wr0 * 1.4 * dpr}px ${EMOJI_FONT}`; wx2.textAlign = 'center'; wx2.fillText(BUILDINGS[BLDI[wk]].glyph, 0, -wr0 * 0.2 * dpr); } return c2; });
      const kw = z / wc.z, ww = wc.width / dpr * kw, wh = wc.height / dpr * kw; ctx.drawImage(wc, wx - ww / 2, wy - wh * 0.82, ww, wh);
    };
    ctx.globalAlpha = remembered ? 0.8 : 1;
    ws.forEach((wk, i) => { if (ring[i][1] < 0) drawW(wk, i); });
    ctx.drawImage(cv, x - w / 2, y - cv.oy / dpr * k, w, hh);
    ws.forEach((wk, i) => { if (ring[i][1] >= 0) drawW(wk, i); });
    ctx.globalAlpha = 1;
  }
  drawBanner(x, y, c, rs, remembered) {
    const ctx = this.ctx, civ = CIVS[this.G.players[c.o].civ];
    ctx.globalAlpha = remembered ? 0.8 : 1;
    const fs = Math.max(10, Math.min(15, 12 * this.cam.z + 2));
    const minor = CIVS[this.G.players[c.o].civ].minor;
    const label = (minor ? HX.MINOR_TYPES[minor].glyph + ' ' : c.cap ? '★ ' : '') + c.n;
    const info = !remembered && c.o === this.pid && this.cityInfo ? this.cityInfo.get(c.id) : null;
    ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`;
    const tw = ctx.measureText(label).width, bh2 = fs * 1.6, pw = bh2;
    let extraW = 0, prodLabel = '';
    if (info && info.prod) { prodLabel = String(info.turns); ctx.font = `600 ${fs * 0.85}px -apple-system, system-ui, sans-serif`; extraW = ctx.measureText(prodLabel).width + fs * (prodLabel ? 1.5 : 1.15); ctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`; }
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
    if (info && info.prod) {
      const gx = bx + pw + fs * 0.25 + tw + fs * 0.55 + relW;
      this.drawGlyph(info.prod, gx + fs * 0.45, cy, fs * 0.9);
      ctx.font = `600 ${fs * 0.85}px -apple-system, system-ui, sans-serif`; ctx.fillStyle = '#e8c26a';
      ctx.fillText(prodLabel, gx + fs * 1.05, cy + 0.5);
    }
    ctx.globalAlpha = 1;
  }

  // Units are drawn figures standing on a civ-coloured base; far out they fall back to compact shield tokens.
  drawUnit(u, x, y, rs, civilian) {
    if (rs < 18 || !UNIT_FIG[u.type]) return this.drawUnitToken(u, x, y, rs, civilian);
    const ctx = this.ctx, civ = CIVS[this.G.players[u.owner].civ], own = u.owner === this.pid, z = this.cam.z;
    const ready = own && u.moves > 0 && !u.order && !u.skip;
    const emb = isEmbarked(this.G, u), naval = UNITS[u.type].naval, spec = UNIT_FIG[u.type];
    const big = spec.k !== 'foot';
    const fy = y + rs * (naval ? 0.36 : 0.34), bx = rs * (big ? 0.5 : 0.36), by = bx * (this.tilt < 1 ? 0.36 : 0.42);
    if (naval || emb) { ctx.strokeStyle = civ.color; ctx.lineWidth = Math.max(1.5, rs * 0.06); ctx.beginPath(); ctx.ellipse(x, fy, bx * 1.05, by * 0.9, 0, 0, 6.283); ctx.stroke(); }
    if (ready) { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, rs * 0.055); ctx.beginPath(); ctx.ellipse(x, fy + (naval || emb ? 0 : by * 0.1), bx * 1.12, by * 1.12, 0, 0, 6.283); ctx.stroke(); }
    if (emb) { // a little boat under an embarked land unit
      ctx.fillStyle = '#6b4a2b'; ctx.strokeStyle = 'rgba(22,16,12,.9)'; ctx.lineWidth = Math.max(1, rs * 0.04);
      ctx.beginPath(); ctx.moveTo(x - rs * 0.48, fy - rs * 0.1); ctx.lineTo(x + rs * 0.48, fy - rs * 0.1); ctx.lineTo(x + rs * 0.32, fy + rs * 0.06); ctx.lineTo(x - rs * 0.32, fy + rs * 0.06); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // the figure itself, painted once per type, civ and size, then scaled with the zoom like the terrain
    const scale = Math.round(rs / (HEX_R * z) * 20) / 20, key = u.type + '|' + civ.key + '|' + scale;
    // land units stand on a civ-coloured disc (shadow, dark rim, lit top) baked into the same cached image
    const fc = this.lazyArt('fig' + key + (naval || emb ? '|n' : '|b') + (this.tilt < 1 ? 3 : 2), () => {
      const dpr = this.dpr, S = HEX_R * this.spriteZ * scale, f = figCanvas(u.type, civ, S * (big ? 0.88 : 0.8), dpr);
      if (naval || emb) return f;
      const bxs = S * (big ? 0.5 : 0.36) * dpr, bys = bxs * (this.tilt < 1 ? 0.36 : 0.42), c = document.createElement('canvas');
      c.width = f.width; c.height = Math.ceil(f.height + bys * 1.6); c.ox = f.ox; c.oy = f.oy;
      const b = c.getContext('2d'); b.translate(f.ox * dpr, f.oy * dpr);
      b.fillStyle = 'rgba(0,0,0,.34)'; b.beginPath(); b.ellipse(bxs * 0.12, bys * 0.35, bxs * 1.08, bys * 1.15, 0, 0, 6.283); b.fill();
      b.fillStyle = civ.dark; b.beginPath(); b.ellipse(0, bys * 0.2, bxs, bys, 0, 0, 6.283); b.fill();
      const g = b.createLinearGradient(0, -bys, 0, bys); g.addColorStop(0, shade(civ.color, 0.25)); g.addColorStop(1, shade(civ.color, -0.15));
      b.fillStyle = g; b.beginPath(); b.ellipse(0, 0, bxs * 0.9, bys * 0.8, 0, 0, 6.283); b.fill();
      b.setTransform(1, 0, 0, 1, 0, 0); b.drawImage(f, 0, 0); return c;
    });
    const k = z / fc.z, fw = fc.width / this.dpr * k, fh = fc.height / this.dpr * k, ox = fc.ox * k, oy = fc.oy * k;
    const lift = emb ? rs * 0.08 : 0;
    ctx.drawImage(fc, x - ox, fy - lift - oy, fw, fh);
    const uh = rs * (big ? 0.88 : 0.8), top = fy - uh * (naval ? 0.95 : 1.0);
    if (UNITS[u.type].civ) { const bx2 = x + bx * 0.95, by2 = fy - by * 0.1, br = Math.max(3, rs * 0.09); ctx.beginPath(); ctx.moveTo(bx2, by2 - br); ctx.lineTo(bx2 + br, by2); ctx.lineTo(bx2, by2 + br); ctx.lineTo(bx2 - br, by2); ctx.closePath(); ctx.fillStyle = '#f2d264'; ctx.fill(); ctx.strokeStyle = '#3d2f0c'; ctx.lineWidth = 1; ctx.stroke(); }
    this.drawUnitBadges(u, x, fy, top, rs * 0.4, own, by);
  }
  // Order letter, health, promotions, charges and upgrade badges, shared by figures and tokens.
  drawUnitBadges(u, x, fy, top, rad, own, by) {
    const ctx = this.ctx;
    if (own && u.order && u.order.t !== 'goto') {
      const lab = { fortify: 'F', sleep: 'Z', explore: 'E', auto: 'A', heal: '+' }[u.order.t] || '';
      if (lab) {
        const bx = x + rad * 0.95, by2 = top + rad * 0.35, br = Math.max(6, rad * 0.36);
        ctx.beginPath(); ctx.arc(bx, by2, br, 0, 6.283); ctx.fillStyle = '#121a24'; ctx.fill(); ctx.strokeStyle = '#cfd8e3'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#e8eef5'; ctx.font = `700 ${br * 1.2}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lab, bx, by2 + 0.5);
      }
    }
    if (u.hp < 100) {
      const w = Math.max(18, rad * 1.9), hx = x - w / 2, hy = fy + (by || 0) + 3, hh = Math.max(3, rad * 0.14);
      ctx.fillStyle = '#000c'; ctx.fillRect(hx - 1, hy - 1, w + 2, hh + 2);
      ctx.fillStyle = u.hp > 60 ? '#7fd38a' : u.hp > 30 ? '#f2d264' : '#ec6a5f'; ctx.fillRect(hx, hy, w * u.hp / 100, hh);
    }
    if (u.promos && u.promos.length) { // chevrons above the head, one per promotion (up to three)
      const n = Math.min(3, u.promos.length), cw = Math.max(4, rad * 0.32), ch = cw * 0.55, cx = x, cy = top - ch * 0.6;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < n; i++) {
        const yy = cy - i * ch * 0.85;
        ctx.beginPath(); ctx.moveTo(cx - cw, yy + ch); ctx.lineTo(cx, yy); ctx.lineTo(cx + cw, yy + ch);
        ctx.strokeStyle = '#1d1607'; ctx.lineWidth = Math.max(3, ch * 0.9); ctx.stroke();
        ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = Math.max(1.6, ch * 0.5); ctx.stroke();
      }
    }
    if (own && promoChoices(this.G, u).length) { const bx = x - rad * 1.0, by2 = fy - rad * 0.55, br = Math.max(6, rad * 0.36); ctx.beginPath(); ctx.arc(bx, by2, br, 0, 6.283); ctx.fillStyle = '#ffe08a'; ctx.fill(); ctx.strokeStyle = '#1d1607'; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = '#1d1607'; ctx.font = `800 ${br * 1.2}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('★', bx, by2 + 0.5); }
    if (own && this.upgradable && this.upgradable.has(u.id)) {
      const bx = x - rad * 1.0, by2 = fy - rad * 1.45, br = Math.max(6, rad * 0.34);
      ctx.beginPath(); ctx.arc(bx, by2, br, 0, 6.283); ctx.fillStyle = '#5fcf7a'; ctx.fill(); ctx.strokeStyle = '#0e2a14'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#0e2a14'; ctx.font = `800 ${br * 1.3}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('↑', bx, by2 + 0.5);
    }
    if (own && u.charges !== undefined) {
      const bx = x + rad * 0.95, by2 = fy - rad * 0.4, br = Math.max(6, rad * 0.36);
      ctx.beginPath(); ctx.arc(bx, by2, br, 0, 6.283); ctx.fillStyle = '#e8c26a'; ctx.fill(); ctx.strokeStyle = '#1d1607'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#1d1607'; ctx.font = `700 ${br * 1.2}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(u.charges), bx, by2 + 0.5);
    }
  }
  // Far zoom: a compact shield (military) or disc (civilian) in the civ colour with a drawn icon.
  drawUnitToken(u, x, y, rs, civilian) {
    const ctx = this.ctx, civ = CIVS[this.G.players[u.owner].civ], own = u.owner === this.pid;
    const rad = rs * (civilian ? 0.3 : 0.38);
    const ready = own && u.moves > 0 && !u.order && !u.skip;
    const shape = () => {
      ctx.beginPath();
      if (civilian) ctx.arc(x, y, rad, 0, 6.283);
      else {
        ctx.moveTo(x - rad, y - rad * 0.85); ctx.quadraticCurveTo(x, y - rad * 1.15, x + rad, y - rad * 0.85);
        ctx.lineTo(x + rad * 0.95, y + rad * 0.15); ctx.quadraticCurveTo(x + rad * 0.7, y + rad * 0.85, x, y + rad * 1.15);
        ctx.quadraticCurveTo(x - rad * 0.7, y + rad * 0.85, x - rad * 0.95, y + rad * 0.15); ctx.closePath();
      }
    };
    ctx.save(); ctx.translate(1, 1.5); shape(); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); ctx.restore();
    shape();
    const g = ctx.createLinearGradient(x, y - rad, x, y + rad);
    g.addColorStop(0, shade(civ.color, 0.22)); g.addColorStop(1, shade(civ.color, -0.18));
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.2 * this.cam.z);
    ctx.strokeStyle = ready ? '#ffffff' : civ.dark; ctx.stroke();
    this.drawIcon(u.type, x, y - (civilian ? 0 : rad * 0.04), rad * (civilian ? 0.66 : 0.74));
    if (u.hp < 100) {
      const w = rad * 1.7, hx = x - w / 2, hy = y + rad * 1.18;
      ctx.fillStyle = '#000b'; ctx.fillRect(hx - 1, hy - 1, w + 2, 5);
      ctx.fillStyle = u.hp > 60 ? '#7fd38a' : u.hp > 30 ? '#f2d264' : '#ec6a5f'; ctx.fillRect(hx, hy, w * u.hp / 100, 3);
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
    for (const n of G.natural || []) if (P.explored[n.tile]) { const c = n.tile % W, r = (n.tile / W) | 0, x = (c + 0.5 * (r & 1) + 0.5) * tw, y = (r + 0.5) * th, rr = Math.max(2.5, tw * 0.8); cx.fillStyle = '#f0d690'; cx.strokeStyle = '#3d2f0c'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x, y - rr); cx.lineTo(x + rr, y); cx.lineTo(x, y + rr); cx.lineTo(x - rr, y); cx.closePath(); cx.fill(); cx.stroke(); }
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
// Upright props for the 3D view, painted around a tile centre at (0,0) with footprints squashed by VIEW_TILT.
// Things stand up out of the ground, so the tops reach well above the tile.
const PROP_T = new Set();
function drawPropSprite(x, t, v, R) {
  const rnd = lcg(t * 131 + v * 29 + 3), base = TERRAIN[t].color, F = VIEW_TILT;
  const spots = (n, spread) => { const a = []; for (let i = 0; i < n; i++) { const ang = rnd() * 6.283, d = Math.sqrt(rnd()) * spread; a.push([Math.cos(ang) * d * R, Math.sin(ang) * d * R * F]); } return a.sort((p, q) => p[1] - q[1]); };
  const shadow = (px, py, w) => { x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.ellipse(px + w * 0.35, py + w * 0.08, w * 0.95, w * 0.32, 0, 0, 6.283); x.fill(); };
  if (t === T.FOREST) {
    for (const [px, py] of spots(7 + (v % 2) * 2, 0.62)) {
      const s = R * (0.2 + rnd() * 0.08), conifer = v < 2 ? true : rnd() < 0.35;
      shadow(px, py, s * 0.8);
      x.fillStyle = '#4b3420'; x.fillRect(px - s * 0.07, py - s * 0.5, s * 0.14, s * 0.55);
      if (conifer) for (let k = 0; k < 3; k++) {
        const yy = py - s * (0.35 + k * 0.42), ww = s * (0.62 - k * 0.14);
        const g = x.createLinearGradient(px - ww, 0, px + ww, 0); g.addColorStop(0, shade(base, -0.05 + k * 0.05)); g.addColorStop(0.5, shade(base, -0.28)); g.addColorStop(1, shade(base, -0.45));
        x.fillStyle = g; x.beginPath(); x.moveTo(px, yy - s * 0.7); x.lineTo(px + ww, yy + s * 0.12); x.lineTo(px - ww, yy + s * 0.12); x.closePath(); x.fill();
      } else {
        const g = x.createRadialGradient(px - s * 0.25, py - s * 1.2, s * 0.1, px, py - s * 0.9, s * 0.75); g.addColorStop(0, shade(base, 0.05)); g.addColorStop(1, shade(base, -0.42));
        x.fillStyle = g; x.beginPath(); x.ellipse(px, py - s * 0.95, s * 0.58, s * 0.62, 0, 0, 6.283); x.fill();
      }
    }
  } else if (t === T.HILLS) {
    const hs = v % 2 ? [[-0.34, 0.18, 0.48], [0.32, 0.22, 0.4], [0.02, -0.28, 0.4]] : [[-0.2, 0.0, 0.54], [0.36, 0.3, 0.36], [-0.32, -0.4, 0.3]];
    for (const [hx, hy, hr] of hs.sort((a, b) => a[1] - b[1])) {
      const cx = hx * R, cy = hy * R * F + R * 0.08, rx = hr * R, ry = hr * R * 0.85;
      shadow(cx, cy, rx * 0.9);
      const g = x.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.6, cy);
      g.addColorStop(0, shade(base, 0.3)); g.addColorStop(0.5, shade(base, 0.0)); g.addColorStop(1, shade(base, -0.35));
      x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, Math.PI, 0); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.15)'; x.lineWidth = Math.max(1, R * 0.03); x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.15, Math.PI * 1.85); x.stroke();
    }
  } else if (t === T.MOUNTAIN) {
    const peaks = v % 2 ? [[-0.32, -0.1, 0.5], [0.3, 0.05, 0.44], [0, 0.32, 0.62]] : [[-0.2, -0.2, 0.58], [0.34, 0.1, 0.46], [-0.38, 0.32, 0.34]];
    for (const [px0, py0, hgt] of peaks.sort((a, b) => a[1] - b[1])) {
      const bx = px0 * R, by = py0 * R * F + R * 0.15, top = by - hgt * R * 2.0, hw = hgt * R * 0.85;
      shadow(bx, by, hw);
      x.fillStyle = '#4e4945'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx + hw, by); x.closePath(); x.fill();
      const lg = x.createLinearGradient(bx - hw, top, bx, by); lg.addColorStop(0, '#b3aca3'); lg.addColorStop(1, '#7d766e');
      x.fillStyle = lg; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx + hw * 0.1, by); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = Math.max(1, R * 0.03);
      x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.18, top + (by - top) * 0.55); x.lineTo(bx + hw * 0.05, by); x.stroke();
      x.fillStyle = '#f4f7f9'; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.32, top + (by - top) * 0.32); x.lineTo(bx + hw * 0.08, top + (by - top) * 0.26); x.lineTo(bx - hw * 0.1, top + (by - top) * 0.36); x.lineTo(bx - hw * 0.34, top + (by - top) * 0.3); x.closePath(); x.fill();
      x.fillStyle = 'rgba(200,215,230,.6)'; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.32, top + (by - top) * 0.32); x.lineTo(bx + hw * 0.08, top + (by - top) * 0.26); x.closePath(); x.fill();
    }
  }
}
[T.FOREST, T.HILLS, T.MOUNTAIN].forEach(t => PROP_T.add(t));
// Ground palette per terrain (lit, mid, shadow) and the lake row that follows the terrain list.
const LAKE_T = TERRAIN.length;
const GROUND = {
  [T.GRASS]: ['#86b552', '#6a9a40', '#4e7a2e'], [T.PLAINS]: ['#c4b263', '#a99a4f', '#857636'], [T.DESERT]: ['#ecd9a0', '#d8c084', '#b39a5e'],
  [T.TUNDRA]: ['#a9b3a6', '#8d998d', '#6d786e'], [T.HILLS]: ['#a39a5e', '#8b814f', '#665d36'], [T.FOREST]: ['#4f8a3e', '#3a7030', '#285222'],
  [T.MARSH]: ['#5f8a68', '#4a7258', '#33553f'], [T.MOUNTAIN]: ['#8f8982', '#77716b', '#59544f'], [T.COAST]: ['#4fb0c8', '#3992b2', '#2a7598'],
  [T.OCEAN]: ['#2a6496', '#1f5282', '#163f68'], [LAKE_T]: ['#58b6c0', '#3f9aaa', '#2e7c8e'],
};
function drawTerrainSprite(x, t, v, R, ground) {
  const pal = GROUND[t] || [shade(TERRAIN[t].color, 0.1), TERRAIN[t].color, shade(TERRAIN[t].color, -0.2)];
  const base = pal[1], rnd = lcg(t * 97 + v * 13 + 7);
  const L = Math.max(1, R * 0.04);
  const pts = (n, spread) => { const a = []; for (let i = 0; i < n; i++) a.push([(rnd() - 0.5) * 2 * spread * R, (rnd() - 0.5) * 2 * spread * R]); return a; };
  const blob = (cx, cy, rx, ry, col) => { x.fillStyle = col; x.beginPath(); x.ellipse(cx, cy, rx, ry, rnd() * 3, 0, 6.283); x.fill(); };
  const soft = (cx, cy, r, col) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)')); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, 6.283); x.fill(); };
  const water = t === T.COAST || t === T.OCEAN || t === LAKE_T;
  x.save();
  x.beginPath(); hexPath(x, 0, 0, R + 0.8); x.clip();
  // lit from the upper left: a broad gradient, then large soft patches of light and shade
  const gr = x.createLinearGradient(-R * 0.7, -R * 0.9, R * 0.7, R * 0.9);
  gr.addColorStop(0, pal[0]); gr.addColorStop(0.55, pal[1]); gr.addColorStop(1, pal[2]);
  x.fillStyle = gr; x.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 2.4);
  for (let k = 0; k < 4; k++) soft((rnd() - 0.5) * R * 1.3, (rnd() - 0.5) * R * 1.3, R * (0.3 + rnd() * 0.35), rnd() < 0.5 ? 'rgba(255,255,240,.10)' : 'rgba(0,10,0,.10)');
  if (!water) for (let k = 0; k < 90; k++) { x.fillStyle = rnd() < 0.5 ? 'rgba(255,255,230,.07)' : 'rgba(0,0,0,.08)'; const [px, py] = pts(1, 0.95)[0]; x.fillRect(px, py, L * 0.8, L * 0.8); }
  const tuft = (px, py, s, col) => { x.strokeStyle = col; x.beginPath(); x.moveTo(px - s * 0.5, py); x.quadraticCurveTo(px - s * 0.4, py - s * 0.6, px - s * 0.7, py - s); x.moveTo(px, py); x.lineTo(px + s * 0.05, py - s * 1.2); x.moveTo(px + s * 0.5, py); x.quadraticCurveTo(px + s * 0.45, py - s * 0.6, px + s * 0.75, py - s * 0.9); x.stroke(); };
  const tree = (px, py, s, conifer) => {
    x.fillStyle = 'rgba(0,0,0,.24)'; x.beginPath(); x.ellipse(px + s * 0.25, py + s * 0.55, s * 0.62, s * 0.22, 0, 0, 6.283); x.fill();
    x.fillStyle = '#4b3420'; x.fillRect(px - L * 0.6, py + s * 0.2, L * 1.2, s * 0.45);
    if (conifer) {
      for (let k = 0; k < 3; k++) {
        const yy = py - s * 0.28 * k, ww = s * (0.66 - k * 0.16);
        x.fillStyle = shade(base, -0.32 + k * 0.07); x.beginPath(); x.moveTo(px, yy - s * 0.75); x.lineTo(px + ww, yy + s * 0.3); x.lineTo(px - ww, yy + s * 0.3); x.closePath(); x.fill();
        x.fillStyle = 'rgba(255,255,220,.13)'; x.beginPath(); x.moveTo(px, yy - s * 0.75); x.lineTo(px - ww, yy + s * 0.3); x.lineTo(px - ww * 0.2, yy + s * 0.3); x.closePath(); x.fill();
      }
    } else {
      x.fillStyle = shade(base, -0.3); x.beginPath(); x.arc(px, py - s * 0.15, s * 0.62, 0, 6.283); x.fill();
      x.fillStyle = shade(base, -0.1); x.beginPath(); x.arc(px - s * 0.16, py - s * 0.3, s * 0.42, 0, 6.283); x.fill();
      x.fillStyle = 'rgba(255,255,220,.16)'; x.beginPath(); x.arc(px - s * 0.26, py - s * 0.42, s * 0.18, 0, 6.283); x.fill();
    }
  };
  if (t === T.GRASS) {
    for (const [px, py] of pts(5, 0.55)) blob(px, py, R * (0.14 + rnd() * 0.12), R * 0.08, 'rgba(40,80,20,.16)');
    x.lineWidth = L * 0.9; x.lineCap = 'round';
    for (const [px, py] of pts(16, 0.66)) tuft(px, py, R * (0.07 + rnd() * 0.04), rnd() < 0.5 ? shade(base, -0.3) : shade(base, 0.22));
    if (v >= 2) for (const [px, py] of pts(5, 0.55)) { x.fillStyle = v === 2 ? '#f6efc8' : '#f3d65a'; x.beginPath(); x.arc(px, py, L * 0.9, 0, 6.283); x.fill(); }
  } else if (t === T.PLAINS) {
    // dry golden grassland: long wind-combed strokes in two tones and the odd shrub
    for (const [px, py] of pts(3, 0.45)) blob(px, py, R * 0.34, R * 0.12, 'rgba(240,214,130,.16)');
    x.lineCap = 'round'; x.lineWidth = L * 0.8;
    for (const [px, py] of pts(22, 0.66)) { const s = R * (0.07 + rnd() * 0.05); x.strokeStyle = rnd() < 0.55 ? 'rgba(246,226,150,.75)' : shade(base, -0.3); x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + s * 0.25, py - s * 0.6, px + s * 0.6, py - s); x.stroke(); }
    for (const [px, py] of pts(2 + (v % 2), 0.5)) { x.fillStyle = 'rgba(0,0,0,.2)'; x.beginPath(); x.ellipse(px + R * 0.02, py + R * 0.03, R * 0.07, R * 0.03, 0, 0, 6.283); x.fill(); x.fillStyle = '#7d8a3a'; x.beginPath(); x.arc(px, py, R * 0.05, 0, 6.283); x.fill(); x.fillStyle = 'rgba(255,255,200,.25)'; x.beginPath(); x.arc(px - R * 0.015, py - R * 0.015, R * 0.022, 0, 6.283); x.fill(); }
  } else if (t === T.DESERT) {
    // dunes: crescent ridges, lit on the left, shaded on the right, with fine wind ripples
    x.lineCap = 'round';
    x.strokeStyle = 'rgba(150,110,60,.25)'; x.lineWidth = L * 0.6;
    for (let k = 0; k < 9; k++) { const py = (k / 8 - 0.5) * R * 1.7 + (rnd() - 0.5) * R * 0.08, px = (rnd() - 0.5) * R * 0.6; x.beginPath(); x.moveTo(px - R * 0.4, py); x.quadraticCurveTo(px, py - R * 0.06, px + R * 0.4, py + R * 0.02); x.stroke(); }
    for (let k = 0; k < 3; k++) {
      const py = (k - 1) * R * 0.5 + (rnd() - 0.5) * R * 0.15, px = (rnd() - 0.5) * R * 0.6, rr = R * (0.32 + rnd() * 0.12);
      x.fillStyle = 'rgba(150,105,50,.32)'; x.beginPath(); x.moveTo(px - rr, py + rr * 0.3); x.quadraticCurveTo(px + rr * 0.1, py - rr * 0.5, px + rr, py + rr * 0.25); x.quadraticCurveTo(px + rr * 0.3, py + rr * 0.05, px - rr, py + rr * 0.3); x.fill();
      x.strokeStyle = 'rgba(255,246,215,.42)'; x.lineWidth = L * 0.9; x.beginPath(); x.moveTo(px - rr, py + rr * 0.3); x.quadraticCurveTo(px + rr * 0.1, py - rr * 0.5, px + rr, py + rr * 0.25); x.stroke();
    }
    if (v === 3) for (const [px, py] of pts(4, 0.55)) { x.fillStyle = 'rgba(110,90,60,.5)'; x.beginPath(); x.arc(px, py, L * 0.9, 0, 6.283); x.fill(); }
  } else if (t === T.TUNDRA) {
    for (const [px, py] of pts(5, 0.55)) { const rx = R * (0.1 + rnd() * 0.12); blob(px + rx * 0.08, py + rx * 0.1, rx, rx * 0.45, 'rgba(80,100,110,.18)'); blob(px, py, rx, rx * 0.42, 'rgba(236,244,248,.5)'); blob(px - rx * 0.25, py - rx * 0.08, rx * 0.45, rx * 0.18, 'rgba(255,255,255,.45)'); }
    for (const [px, py] of pts(10, 0.62)) { x.fillStyle = rnd() < 0.5 ? 'rgba(170,150,90,.45)' : 'rgba(150,90,80,.35)'; x.beginPath(); x.arc(px, py, L * (0.7 + rnd()), 0, 6.283); x.fill(); } // lichen
    for (const [px, py] of pts(3, 0.5)) { x.fillStyle = '#6b6b66'; x.beginPath(); x.ellipse(px, py, R * 0.05, R * 0.03, 0, 0, 6.283); x.fill(); x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(px - R * 0.04, py - R * 0.025, R * 0.04, R * 0.012); }
    x.strokeStyle = shade(base, -0.3); x.lineWidth = L * 0.8; x.lineCap = 'round';
    for (const [px, py] of pts(7, 0.55)) tuft(px, py, R * 0.05, shade(base, -0.3));
  } else if (ground && (t === T.HILLS || t === T.FOREST || t === T.MOUNTAIN)) {
    // 3D view: the ground only; hills, trees and peaks stand up in a separate layer
    if (t === T.FOREST) { for (const [px, py] of pts(8, 0.6)) blob(px, py, R * 0.2, R * 0.1, 'rgba(20,40,15,.28)'); x.fillStyle = 'rgba(70,45,20,.3)'; for (const [px, py] of pts(20, 0.65)) x.fillRect(px, py, L * 1.1, L * 0.7); }
    else if (t === T.MOUNTAIN) { for (const [px, py] of pts(12, 0.6)) blob(px, py, R * 0.12, R * 0.06, rnd() < 0.5 ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.2)'); }
    else { for (const [px, py] of pts(5, 0.55)) blob(px, py, R * 0.22, R * 0.12, 'rgba(0,0,0,.1)'); x.lineWidth = L * 0.8; for (const [px, py] of pts(8, 0.6)) tuft(px, py, R * 0.06, shade(base, -0.3)); }
  } else if (t === T.HILLS) {
    const hs = v % 2 ? [[-0.34, 0.18, 0.44], [0.32, 0.26, 0.38], [0.02, -0.24, 0.36]] : [[-0.2, 0.05, 0.5], [0.36, 0.32, 0.34], [-0.3, -0.38, 0.28]];
    hs.sort((a, b) => a[1] - b[1]);
    for (const [hx, hy, hr] of hs) {
      const cx = hx * R, cy = hy * R + R * 0.1, rx = hr * R, ry = hr * R * 0.66;
      x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(cx + rx * 0.2, cy + ry * 0.05, rx, ry * 0.35, 0, 0, 6.283); x.fill();
      const hg = x.createLinearGradient(cx - rx, cy - ry, cx + rx, cy);
      hg.addColorStop(0, shade(base, 0.28)); hg.addColorStop(0.55, shade(base, -0.02)); hg.addColorStop(1, shade(base, -0.32));
      x.fillStyle = hg; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, Math.PI, 0); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(60,50,20,.3)'; x.lineWidth = L * 0.7; x.beginPath(); x.ellipse(cx, cy, rx * 0.7, ry * 0.6, 0, Math.PI * 1.15, Math.PI * 1.7); x.stroke();
    }
  } else if (t === T.FOREST) {
    const n = 8 + (v % 2) * 2, trees = pts(n, 0.55).sort((a, b) => a[1] - b[1]);
    for (const [px, py] of trees) tree(px, py, R * (0.18 + rnd() * 0.07), v < 2 ? true : rnd() < 0.3);
  } else if (t === T.MARSH) {
    for (const [px, py] of pts(5, 0.45)) { const rx = R * (0.16 + rnd() * 0.12), ry = R * (0.07 + rnd() * 0.05);
      blob(px, py + ry * 0.3, rx * 1.1, ry * 1.2, 'rgba(40,60,40,.35)'); const g = x.createLinearGradient(0, py - ry, 0, py + ry); g.addColorStop(0, 'rgba(150,200,210,.75)'); g.addColorStop(1, 'rgba(70,120,140,.75)'); x.fillStyle = g; x.beginPath(); x.ellipse(px, py, rx, ry, 0, 0, 6.283); x.fill(); }
    x.strokeStyle = 'rgba(230,245,250,.4)'; x.lineWidth = L * 0.7;
    for (const [px, py] of pts(4, 0.4)) { x.beginPath(); x.moveTo(px - R * 0.07, py); x.lineTo(px + R * 0.07, py); x.stroke(); }
    x.lineCap = 'round';
    for (const [px, py] of pts(11, 0.58)) { // reeds with cattail heads
      x.strokeStyle = shade(base, -0.42); x.lineWidth = L * 0.8; x.beginPath(); x.moveTo(px, py); x.lineTo(px - R * 0.03, py - R * 0.17); x.moveTo(px, py); x.lineTo(px + R * 0.04, py - R * 0.14); x.stroke();
      if (rnd() < 0.5) { x.strokeStyle = '#5a3a22'; x.lineWidth = L * 1.6; x.beginPath(); x.moveTo(px - R * 0.028, py - R * 0.15); x.lineTo(px - R * 0.032, py - R * 0.2); x.stroke(); }
    }
  } else if (t === T.MOUNTAIN) {
    const peaks = v % 2 ? [[-0.3, 0.42, 0.42], [0.26, 0.45, 0.36], [0, 0.28, 0.55]] : [[-0.18, 0.4, 0.5], [0.3, 0.38, 0.4], [-0.42, 0.5, 0.26]];
    peaks.sort((a, b) => a[1] - b[1]);
    for (const [px, by0, hgt] of peaks) {
      const bx = px * R, by = by0 * R, top = by - hgt * R * 1.55, hw = hgt * R * 0.9;
      x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse(bx + hw * 0.3, by, hw * 1.05, hw * 0.25, 0, 0, 6.283); x.fill();
      x.fillStyle = '#5a554f'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx + hw, by); x.closePath(); x.fill();
      x.fillStyle = '#9a938a'; x.beginPath(); x.moveTo(bx - hw, by); x.lineTo(bx, top); x.lineTo(bx - hw * 0.05, by); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = L * 0.8; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.15, by * 0.6 + top * 0.4); x.lineTo(bx + hw * 0.05, by); x.stroke();
      x.fillStyle = '#f4f7f9'; x.beginPath(); x.moveTo(bx, top); x.lineTo(bx + hw * 0.34, top + hgt * R * 0.52); x.lineTo(bx + hw * 0.08, top + hgt * R * 0.42); x.lineTo(bx - hw * 0.12, top + hgt * R * 0.55); x.lineTo(bx - hw * 0.32, top + hgt * R * 0.5); x.closePath(); x.fill();
    }
  } else if (water) {
    const deep = t === T.OCEAN, lake = t === LAKE_T;
    if (deep) for (const [px, py] of pts(5, 0.6)) soft(px, py, R * (0.25 + rnd() * 0.25), 'rgba(8,24,56,.28)');
    else { // shallows: a light caustic net over the sand-tinted bottom
      for (const [px, py] of pts(4, 0.55)) soft(px, py, R * 0.3, lake ? 'rgba(120,200,190,.25)' : 'rgba(150,230,230,.22)');
      x.strokeStyle = lake ? 'rgba(220,250,245,.16)' : 'rgba(220,250,255,.18)'; x.lineWidth = L * 0.7;
      for (let k = 0; k < 7; k++) { const [px, py] = pts(1, 0.7)[0], r = R * (0.08 + rnd() * 0.08); x.beginPath(); for (let a = 0; a < 6; a++) { const an = a * 1.047 + rnd() * 0.4; x.lineTo(px + Math.cos(an) * r, py + Math.sin(an) * r * 0.7); } x.closePath(); x.stroke(); }
    }
    x.lineCap = 'round';
    x.strokeStyle = deep ? 'rgba(170,210,245,.22)' : lake ? 'rgba(235,255,250,.35)' : 'rgba(235,252,255,.38)'; x.lineWidth = L * 1.05;
    for (const [px, py] of pts(deep ? 4 : 3, 0.55)) {
      if (lake) { x.beginPath(); x.ellipse(px, py, R * 0.1, R * 0.045, 0, 0, 6.283); x.stroke(); continue; }
      const w = R * (0.08 + rnd() * 0.05);
      x.beginPath(); x.moveTo(px - w * 2, py); x.quadraticCurveTo(px - w, py - w * 0.8, px, py); x.quadraticCurveTo(px + w, py - w * 0.8, px + w * 2, py); x.stroke();
    }
  }
  x.restore();
}
