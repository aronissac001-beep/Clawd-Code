// Renderer: pre-rendered terrain chunks, y-sorted sprites, projectiles,
// particles, fog of war, time-of-day lighting and screen-space overlays.
import { T, N, WORLD, TER, idx } from '../game/grid.js';
import { BIOMES } from '../data/biomes.js';
import { BUILDINGS, levelStats } from '../data/buildings.js';
import { BAL } from '../data/balance.js';
import { UNITS, SOVEREIGN_ABILITIES } from '../data/units.js';
import { lightRadiusOf } from '../game/systems/fog.js';
import { hash2 } from './rng.js';
import { ART_HOOKS, BUS } from '../game/hooks.js';
import { Particles } from './particles.js';
import * as SP from './sprites.js';

const CH = 8;          // tiles per terrain chunk
const TSCALE = 2;      // terrain chunk resolution (px per world unit)
const VOID = '#17151f';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.light = document.createElement('canvas');
    this.lg = this.light.getContext('2d');
    this.fogC = document.createElement('canvas');
    this.fogC.width = N + 2; this.fogC.height = N + 2;
    this.fg = this.fogC.getContext('2d');
    this.fogImg = this.fg.createImageData(N + 2, N + 2);
    this.chunks = new Map();
    this.list = [];
    this.lights = [];
    this.time = 0;
    this.particles = new Particles();
    this.insets = { top: 60, bottom: 100, left: 12, right: 12 };
    this.settings = { damageNumbers: true, colorblind: false, reduceMotion: false };
    this.w = 1; this.h = 1; this.dpr = 1;
    this.fogVersion = 0;
    this.edgeGrads = null;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.light.width = Math.ceil(w / 2); this.light.height = Math.ceil(h / 2);
  }

  setState(s) {
    this.state = s;
    this.chunks.clear();
    this.biome = BIOMES[s.biome];
    this.particles.clear();
    s.rt.fogDirty = true;
  }

  // ---- Terrain -------------------------------------------------------------------
  chunk(cx, cy) {
    const key = cy * 16 + cx;
    let c = this.chunks.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = CH * T * TSCALE;
    const g = c.getContext('2d');
    g.scale(TSCALE, TSCALE);
    g.translate(-cx * CH * T, -cy * CH * T);
    this.paintTerrain(g, cx * CH, cy * CH);
    this.chunks.set(key, c);
    return c;
  }

  paintTerrain(g, x0, y0) {
    const s = this.state, pal = this.biome;
    const ter = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? -1 : s.terrain[idx(x, y)]);
    g.fillStyle = pal.grass[0];
    g.fillRect(x0 * T, y0 * T, CH * T, CH * T);
    const blob = (x, y, r, color, alpha = 1, jit = 4) => {
      const jx = (hash2(x, y, 7) - 0.5) * jit, jy = (hash2(x, y, 9) - 0.5) * jit;
      g.globalAlpha = alpha; g.fillStyle = color;
      g.beginPath(); g.arc(x * T + T / 2 + jx, y * T + T / 2 + jy, r, 0, Math.PI * 2); g.fill();
    };
    const X0 = x0 - 1, X1 = x0 + CH, Y0 = y0 - 1, Y1 = y0 + CH;
    // Grass colour blotches.
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const t = ter(x, y);
      if (t === TER.GRASS || t === TER.MEADOW || t === -1) blob(x, y, T * 0.8, pal.grass[(hash2(x, y, 1) * pal.grass.length) | 0], 0.55, 10);
    }
    for (const [type, color, r] of [[TER.MEADOW, pal.meadow, 0.72], [TER.DIRT, pal.dirt, 0.6], [TER.SAND, pal.sand, 0.74]]) {
      for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === type) blob(x, y, T * r, color, 1, 5);
    }
    // Lighter centres on dirt for a worn look.
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === TER.DIRT) blob(x, y, T * 0.3, SP.shade(pal.dirt, 0.1), 0.45, 12);
    // Water with shoreline foam and deep centres.
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === TER.WATER) blob(x, y, T * 0.74, SP.shade(pal.sand, 0.25), 0.9, 2);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === TER.WATER) blob(x, y, T * 0.66, pal.water, 1, 2);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      if (ter(x, y) !== TER.WATER) continue;
      if (ter(x + 1, y) === TER.WATER && ter(x - 1, y) === TER.WATER && ter(x, y + 1) === TER.WATER && ter(x, y - 1) === TER.WATER) blob(x, y, T * 0.55, pal.waterDeep, 1, 4);
    }
    // Crags: raised, readable rock outcrops.
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) if (ter(x, y) === TER.CRAG) blob(x, y, T * 0.78, '#4e4b48', 1, 3);
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      if (ter(x, y) !== TER.CRAG) continue;
      const jx = (hash2(x, y, 3) - 0.5) * 6;
      g.globalAlpha = 1; g.fillStyle = pal.crag;
      g.beginPath(); g.arc(x * T + T / 2 + jx, y * T + T / 2 - 5, T * 0.62, 0, Math.PI * 2); g.fill();
      g.fillStyle = pal.cragTop;
      g.beginPath(); g.arc(x * T + T / 2 + jx - 3, y * T + T / 2 - 9, T * 0.36, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // Small details: tufts, flowers, pebbles, ripples.
    for (let y = y0; y < y0 + CH; y++) for (let x = x0; x < x0 + CH; x++) {
      const t = ter(x, y);
      const bx = x * T, by = y * T;
      for (let k = 0; k < 3; k++) {
        const hx = hash2(x, y, 20 + k), hy = hash2(x, y, 40 + k);
        const px = bx + 3 + hx * (T - 6), py = by + 3 + hy * (T - 6);
        if (t === TER.GRASS && hash2(x, y, 60 + k) < 0.55) {
          g.strokeStyle = SP.shade(pal.grass[k % pal.grass.length], -0.22); g.lineWidth = 1;
          g.beginPath(); g.moveTo(px - 2, py); g.lineTo(px - 0.5, py - 3.5); g.moveTo(px, py); g.lineTo(px + 0.3, py - 4); g.moveTo(px + 2, py); g.lineTo(px + 1, py - 3); g.stroke();
        } else if (t === TER.MEADOW && hash2(x, y, 80 + k) < 0.6) {
          g.fillStyle = pal.flowers[(hash2(x, y, 90 + k) * pal.flowers.length) | 0];
          g.beginPath(); g.arc(px, py, 1.6, 0, 6.283); g.fill();
        } else if (t === TER.DIRT && hash2(x, y, 70 + k) < 0.35) {
          g.fillStyle = 'rgba(70,52,34,0.6)'; g.fillRect(px, py, 2, 1.5);
        } else if (t === TER.WATER && k === 0 && hash2(x, y, 99) < 0.4) {
          g.strokeStyle = 'rgba(200,230,255,0.35)'; g.lineWidth = 1;
          g.beginPath(); g.moveTo(px - 4, py); g.quadraticCurveTo(px, py - 2, px + 4, py); g.stroke();
        }
      }
    }
  }

  // ---- Frame ---------------------------------------------------------------------
  draw(s, cam, alpha, dt, ui) {
    this.time += dt;
    const g = this.g, dpr = this.dpr, z = cam.zoom;
    const scale = SP.scaleBucket(z * dpr);
    this.particles.update(dt);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = VOID; g.fillRect(0, 0, this.w, this.h);
    const ox = this.w / 2 - cam.x * z + cam.sx, oy = this.h / 2 - cam.y * z + cam.sy;
    g.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr);
    g.imageSmoothingEnabled = true;
    const view = {
      x0: cam.x - this.w / 2 / z - 64, x1: cam.x + this.w / 2 / z + 64,
      y0: cam.y - this.h / 2 / z - 64, y1: cam.y + this.h / 2 / z + 110,
    };
    this.view = view;
    // Terrain chunks.
    const cx0 = Math.max(0, Math.floor(view.x0 / (CH * T))), cx1 = Math.min(N / CH - 1, Math.floor(view.x1 / (CH * T)));
    const cy0 = Math.max(0, Math.floor(view.y0 / (CH * T))), cy1 = Math.min(N / CH - 1, Math.floor(view.y1 / (CH * T)));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) g.drawImage(this.chunk(cx, cy), cx * CH * T, cy * CH * T, CH * T, CH * T);
    this.drawEdges(g);
    this.drawDecals(g, s, scale, view);
    for (const f of BUS.draw.ground) f(g, s, view, this.time);
    this.drawGround(g, s, ui, alpha);
    this.drawSorted(g, s, scale, alpha, view, ui);
    for (const f of BUS.draw.world) f(g, s, view, this.time);
    this.drawProjectiles(g, s, alpha);
    this.particles.draw(g, false, view);
    this.drawBars(g, s, alpha, view, z);
    this.drawFog(g, s);
    // The Hollow is never hidden by fog: threats must always be readable.
    for (const e of s.enemies) {
      const pad = e.boss ? 220 + (e.z || 0) : 0;
      if (e.x < view.x0 - pad || e.x > view.x1 + pad || e.y < view.y0 - pad || e.y > view.y1 + pad) continue;
      if (s.fog[idx(Math.min(N - 1, Math.max(0, (e.x / T) | 0)), Math.min(N - 1, Math.max(0, (e.y / T) | 0)))]) continue;
      this.drawUnit(g, s, e, scale, alpha);
    }
    if (s.boss && ART_HOOKS.bossLights) ART_HOOKS.bossLights(s, (lx, ly, r, a) => this.lights.push(lx, ly, r, a));
    for (const f of BUS.draw.lights) f(s, (lx, ly, r, a) => this.lights.push(lx, ly, r, a));
    this.drawLighting(g, s, cam, ox, oy, z);
    g.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr);
    // Boss warning lines sit above the night so a threat is never hidden.
    if (s.boss && ART_HOOKS.drawBossWarnings) ART_HOOKS.drawBossWarnings(g, s, this.time);
    for (const f of BUS.draw.overlay) f(g, s, view, this.time);
    g.globalCompositeOperation = 'lighter';
    this.particles.draw(g, true, view);
    g.globalCompositeOperation = 'source-over';
    if (ui.ghost) this.drawGhost(g, s, ui.ghost, scale);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const f of BUS.draw.screen) f(g, s, this.w, this.h, this.time);
    this.drawScreenOverlays(g, s, cam, ui, scale);
  }

  drawEdges(g) {
    // The Hollowing presses in at the map edge.
    if (!this.edgeGrads) {
      const w = T * 2.5;
      const mk = (x0, y0, x1, y1) => { const gr = this.g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(23,21,31,0.95)'); gr.addColorStop(1, 'rgba(23,21,31,0)'); return gr; };
      this.edgeGrads = [[mk(0, 0, 0, w), 0, 0, WORLD, w], [mk(0, WORLD, 0, WORLD - w), 0, WORLD - w, WORLD, w], [mk(0, 0, w, 0), 0, 0, w, WORLD], [mk(WORLD, 0, WORLD - w, 0), WORLD - w, 0, w, WORLD]];
    }
    for (const [gr, x, y, w, h] of this.edgeGrads) { g.fillStyle = gr; g.fillRect(x, y, w, h); }
  }

  drawDecals(g, s, scale, view) {
    for (const d of s.decals) {
      if (d.x < view.x0 || d.x > view.x1 || d.y < view.y0 || d.y > view.y1) continue;
      const sp = d.k === 'rubble' ? SP.rubbleSprite(d.size, scale) : d.k === 'stump' ? SP.stumpSprite(scale) : null;
      if (sp) g.drawImage(sp.c, d.x - sp.ax, d.y - sp.ay, sp.w, sp.h);
      else if (d.k === 'pebbles') { g.fillStyle = 'rgba(120,115,110,0.7)'; for (let i = 0; i < 5; i++) g.fillRect(d.x - 8 + i * 4, d.y + ((i * 7) % 5) - 2, 2.5, 2); }
    }
  }

  // Selection rings, rally flags, rifts, banner auras, range circles.
  drawGround(g, s, ui, alpha) {
    const t = this.time;
    // Rifts for tonight's groups.
    if (s.wave && (s.cycle.phase === 'dusk' || s.cycle.phase === 'night')) {
      const pending = new Set(s.spawnQueue.map((q) => q.tx + ',' + q.ty));
      for (const gr of s.wave.groups) {
        const x = (gr.sp.tx + 0.5) * T, y = (gr.sp.ty + 0.5) * T;
        const active = s.cycle.phase === 'dusk' || pending.has(gr.sp.tx + ',' + gr.sp.ty);
        if (!active) continue;
        const r = 18 + Math.sin(t * 3) * 2;
        g.save(); g.translate(x, y); g.scale(1, 0.55);
        g.fillStyle = 'rgba(40,30,60,0.75)'; g.beginPath(); g.arc(0, 0, r + 6, 0, 6.283); g.fill();
        g.strokeStyle = s.wave.blood ? 'rgba(230,80,90,0.9)' : 'rgba(180,160,240,0.9)'; g.lineWidth = 2.5;
        for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(0, 0, r - k * 5, t * (2 + k) + k, t * (2 + k) + k + 4); g.stroke(); }
        g.restore();
        if (Math.random() < 0.3) this.particles.spawn('ember', x + (Math.random() - 0.5) * 30, y, { vy: -20, life: 1.2, size: 2, color: s.wave.blood ? '#e05a6a' : '#b8a8f0', add: true });
      }
    }
    // Banner auras.
    for (const b of s.banners) {
      g.strokeStyle = 'rgba(240,192,64,0.55)'; g.lineWidth = 2; g.setLineDash([6, 5]);
      g.beginPath(); g.ellipse(b.x, b.y, b.r, b.r * 0.6, 0, 0, 6.283); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(240,192,64,0.08)'; g.fill();
      g.strokeStyle = '#6b4a2d'; g.lineWidth = 2; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(b.x, b.y - 34); g.stroke();
      SP.banner(g, b.x, b.y - 34, 12, 20, s.heraldry);
    }
    const sel = ui.sel;
    if (!sel) return;
    if (sel.kind === 'squad') {
      const q = s.squads.find((x) => x.id === sel.id);
      if (q) {
        for (const u of s.soldiers) if (u.squad === q.id) this.ring(g, lerp(u.px, u.x, alpha), lerp(u.py, u.y, alpha), 9, q.color);
        this.flagMarker(g, q.rx, q.ry, q.color);
      }
    } else if (sel.kind === 'sov' && s.sovereign) {
      const v = s.sovereign;
      this.ring(g, lerp(v.px, v.x, alpha), lerp(v.py, v.y, alpha), 12, '#f0c040');
      this.flagMarker(g, v.rx, v.ry, '#f0c040');
    } else if (sel.kind === 'building') {
      const b = s.rt.bById.get(sel.id);
      if (b) {
        g.strokeStyle = 'rgba(255,220,140,0.9)'; g.lineWidth = 2;
        g.strokeRect(b.tx * T + 1, b.ty * T + 1, b.size * T - 2, b.size * T - 2);
        this.rangeOf(g, s, b.type, b.level, (b.tx + b.size / 2) * T, (b.ty + b.size / 2) * T);
      }
    }
  }
  ring(g, x, y, r, color) {
    g.strokeStyle = color; g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y, r, r * 0.5, 0, 0, 6.283); g.stroke();
  }
  flagMarker(g, x, y, color) {
    const b = Math.sin(this.time * 4) * 2;
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(x, y, 10, 5, 0, 0, 6.283); g.stroke();
    g.strokeStyle = '#3a2a1a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 22 + b); g.stroke();
    g.fillStyle = color; g.beginPath(); g.moveTo(x, y - 22 + b); g.lineTo(x + 12, y - 18 + b); g.lineTo(x, y - 14 + b); g.closePath(); g.fill();
  }
  rangeOf(g, s, type, level, cx, cy) {
    const st = levelStats(type, level);
    let r = 0, color = 'rgba(255,230,160,0.8)';
    if (st.attack && (type === 'tower' || type === 'ballista')) r = (st.attack.range + s.mods.towerRange) * T;
    else if (type === 'brazier') { r = (st.light + s.mods.lightRadius) * (s.mods.lightMult || 1) * T; color = 'rgba(255,190,90,0.9)'; }
    else if (st.attack && type !== 'hearth') { r = st.attack.range * T; color = 'rgba(120,240,230,0.85)'; }
    else if (st.radius) { r = st.radius * T; color = 'rgba(180,230,140,0.85)'; }
    else if (type === 'hearth') r = st.attack.range * T;
    if (!r) return;
    g.strokeStyle = color; g.lineWidth = 1.6; g.setLineDash([7, 6]);
    g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke(); g.setLineDash([]);
    g.fillStyle = color.replace(/[\d.]+\)$/, '0.07)'); g.fill();
  }

  // ---- Sprites, y-sorted -------------------------------------------------------------
  drawSorted(g, s, scale, alpha, view, ui) {
    const L = this.list;
    L.length = 0;
    const inView = (x, y) => x > view.x0 && x < view.x1 && y > view.y0 && y < view.y1;
    for (const n of s.nodes) { const x = (n.tx + 0.5) * T, y = (n.ty + 0.5) * T; if (inView(x, y)) L.push(n); }
    for (const c of s.caches) if (!c.taken && s.fog[idx(c.tx, c.ty)]) L.push(c);
    for (const b of s.buildings) { const x = (b.tx + b.size / 2) * T, y = (b.ty + b.size) * T; if (inView(x, y)) L.push(b); }
    for (const v of s.villagers) if (v.st !== 'sheltered' && inView(v.x, v.y)) L.push(v);
    for (const v of s.heroes || []) if (v.alive && !v.away && inView(v.x, v.y)) L.push(v);
    for (const u of s.soldiers) if (inView(u.x, u.y)) L.push(u);
    for (const e of s.enemies) if ((e.boss || inView(e.x, e.y)) && s.fog[idx(Math.min(N - 1, Math.max(0, (e.x / T) | 0)), Math.min(N - 1, Math.max(0, (e.y / T) | 0)))]) L.push(e);
    if (s.sovereign && s.sovereign.alive) L.push(s.sovereign);
    for (const o of L) o._ry = sortY(o, alpha);
    L.sort((a, b) => a._ry - b._ry);
    this.lights.length = 0;
    for (const o of L) {
      if (o.kind === 'tree' || o.kind === 'rock') this.drawNode(g, o, scale);
      else if (o.reward) this.drawCache(g, o, scale);
      else if (o.type && BUILDINGS[o.type] && o.tx !== undefined) this.drawBuilding(g, s, o, scale, ui);
      else this.drawUnit(g, s, o, scale, alpha);
    }
  }

  drawNode(g, n, scale) {
    const x = (n.tx + 0.5) * T, y = (n.ty + 0.5) * T;
    const sp = n.kind === 'tree' ? SP.treeSprite(n.v, scale, this.biome) : SP.rockSprite(n.v, n.amount > 25, scale);
    g.drawImage(sp.c, x - sp.ax, y + 6 - sp.ay, sp.w, sp.h);
  }
  drawCache(g, c, scale) {
    const x = (c.tx + 0.5) * T, y = (c.ty + 0.5) * T;
    const sp = SP.chestSprite(scale);
    g.drawImage(sp.c, x - sp.ax, y + 6 - sp.ay, sp.w, sp.h);
    if (Math.random() < 0.05) this.particles.spawn('spark', x + (Math.random() - 0.5) * 14, y - 4, { vy: -14, life: 0.7, size: 2, color: '#ffe680', add: true });
  }

  drawBuilding(g, s, b, scale, ui) {
    const sp = SP.buildingSprite(b.type, b.level, scale, s.heraldry);
    const x = b.tx * T - sp.ax, y = b.ty * T - sp.ay;
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    if (!b.built) {
      const p = Math.max(0.05, b.progress / b.need);
      const sh = sp.h * p;
      g.globalAlpha = 0.95;
      g.drawImage(sp.c, 0, (sp.h - sh) * (sp.c.height / sp.h), sp.c.width, sh * (sp.c.height / sp.h), x, y + sp.h - sh, sp.w, sh);
      g.globalAlpha = 1;
      const sc = SP.scaffoldSprite(b.size, scale);
      g.drawImage(sc.c, b.tx * T - sc.ax, b.ty * T - sc.ay, sc.w, sc.h);
      this.progressBar(g, cx, b.ty * T - 10, p, '#f0c040');
      return;
    }
    g.drawImage(sp.c, x, y, sp.w, sp.h);
    if (b.hitT > 0) {
      const f = SP.flashOf(sp, `b:${b.type}:${b.level}`, scale);
      g.globalAlpha = b.hitT / 0.14 * 0.7; g.drawImage(f.c, x, y, sp.w, sp.h); g.globalAlpha = 1;
    }
    if (b.upg) {
      const sc = SP.scaffoldSprite(b.size, scale);
      g.globalAlpha = 0.75; g.drawImage(sc.c, b.tx * T - sc.ax, b.ty * T - sc.ay, sc.w, sc.h); g.globalAlpha = 1;
      this.progressBar(g, cx, b.ty * T - sp.ay + 4, b.progress / b.need, '#8fd16a');
    }
    const st = levelStats(b.type, b.level);
    // Animated fires and light sources.
    if (b.type === 'hearth') {
      const fx = cx, fy = b.ty * T - sp.ay + 58;
      this.flame(g, fx, fy, 15);
      if (Math.random() < (this.settings.reduceMotion ? 0.15 : 0.5)) this.particles.spawn('ember', fx + (Math.random() - 0.5) * 16, fy - 10, { vy: -30 - Math.random() * 30, vx: (Math.random() - 0.5) * 14, life: 1.6, size: 2 + Math.random() * 1.5, color: Math.random() < 0.5 ? '#ffb347' : '#ff7a2a', add: true, drag: 0.99 });
      this.lights.push(cx, cy, lightRadiusOf(s, b) * T, 1);
    } else if (b.type === 'brazier' && b.snuffT > 0) {
      // Snuffed by the Hollow King: no flame, no light until it rekindles.
    } else if (b.type === 'brazier') {
      const fy = b.ty * T - sp.ay + 20 - b.level * 3;
      this.flame(g, cx, fy, 7 + b.level * 2);
      if (Math.random() < 0.15) this.particles.spawn('ember', cx + (Math.random() - 0.5) * 8, fy - 6, { vy: -25, life: 1, size: 1.8, color: '#ffb347', add: true });
      this.lights.push(cx, cy, lightRadiusOf(s, b) * T, 1);
    } else if (st.light) {
      this.lights.push(cx, cy - 8, st.light * T, 0.7);
      if (b.type === 'tower') this.flame(g, cx + 9, b.ty * T - sp.ay + 26 + b.level * 0, 3);
    }
    if (b.noRes) this.warnIcon(g, cx, b.ty * T - sp.ay + 2);
  }

  flame(g, x, y, r) {
    const t = this.time;
    const f1 = Math.sin(t * 11 + x) * 0.12 + Math.sin(t * 7.3 + y) * 0.1;
    const layers = [['rgba(255,110,30,0.9)', 1], ['rgba(255,170,60,0.95)', 0.72], ['rgba(255,236,160,1)', 0.42]];
    for (const [c, k] of layers) {
      const rr = r * k;
      g.fillStyle = c;
      g.beginPath();
      g.moveTo(x - rr, y);
      g.quadraticCurveTo(x - rr * 0.9, y - rr * (1.4 + f1), x + f1 * rr * 2, y - rr * (2.3 + f1 * 2));
      g.quadraticCurveTo(x + rr * 0.9, y - rr * (1.3 - f1), x + rr, y);
      g.quadraticCurveTo(x, y + rr * 0.5, x - rr, y);
      g.fill();
    }
  }
  warnIcon(g, x, y) {
    g.fillStyle = '#d8453a'; g.strokeStyle = '#2a1410'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x + 8, y); g.lineTo(x - 8, y); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.fillRect(x - 1, y - 10, 2, 5); g.fillRect(x - 1, y - 3.5, 2, 2);
  }
  progressBar(g, x, y, p, color) {
    g.fillStyle = 'rgba(20,14,10,0.75)'; g.fillRect(x - 15, y - 2, 30, 5);
    g.fillStyle = color; g.fillRect(x - 14, y - 1, 28 * Math.max(0, Math.min(1, p)), 3);
  }

  drawUnit(g, s, e, scale, alpha) {
    const x = lerp(e.px, e.x, alpha), y = lerp(e.py, e.y, alpha);
    if (e.boss && ART_HOOKS.drawBoss) {
      ART_HOOKS.drawBoss(g, e, x, y, this.time, scale);
      // The boss is the biggest threat on screen: keep it readable in the dark.
      this.lights.push(x, y - (e.z || 0), 120, 0.8);
      return;
    }
    const custom = BUS.draw.entity[e.kind] || BUS.draw.entity[e.type];
    if (custom) {
      custom(g, e, x, y, this.time, scale);
      if (e.kind !== 'enemy') this.lights.push(x, y - 8, (e.kind === 'hero' ? 2.2 : 1.3) * T, 0.6);
      return;
    }
    if (e.type === 'rift' && ART_HOOKS.drawRift) {
      ART_HOOKS.drawRift(g, e, x, y, this.time, scale);
      if (ART_HOOKS.riftLights) ART_HOOKS.riftLights(e, (lx, ly, r, a) => this.lights.push(lx, ly, r, a));
      return;
    }
    const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.04;
    let frame = e.atkT > 0 ? 3 : moving ? ((e.anim / 2.4) | 0) % 2 ? 1 : 2 : 0;
    const opt = { field: s.heraldry.field, charge: s.heraldry.charge, second: s.heraldry.second };
    let type = e.type;
    if (e.kind === 'villager') {
      opt.hue = e.hue || 0;
      if (e.act) {
        opt.tool = e.act === 'hammer' ? 'hammer' : e.act === 'chop' ? 'axe' : e.act === 'mine' ? 'pick' : 'hoe';
        frame = ((this.time * 3 + e.id * 0.37) | 0) % 2 ? 3 : 4;
      }
      opt.field = ''; opt.charge = ''; opt.second = '';
    }
    const flip = e.face < 0;
    const sp = SP.unitSprite(type, frame, flip, scale, opt);
    let k = e.kind === 'sovereign' ? 1.25 : e.kind === 'enemy' ? (e.scale || 1) * (e.type === 'knight' ? 1.15 : 1) : 1;
    let bob = 0;
    if (e.type === 'shade') bob = Math.sin(this.time * 4 + e.id) * 2 - 4;
    const w = sp.w * k, h = sp.h * k;
    const dx = x - sp.ax * k, dy = y + bob - sp.ay * k;
    if (e.kind === 'enemy' && e.affix === 'warden') {
      g.globalCompositeOperation = 'lighter';
      const gl = SP.glowSprite('rgba(170,140,255,0.5)');
      g.drawImage(gl.c, x - 30, y - 40, 60, 60);
      g.globalCompositeOperation = 'source-over';
    }
    g.drawImage(sp.c, dx, dy, w, h);
    if (e.hitT > 0) {
      const f = SP.flashOf(sp, `u:${type}:${frame}:${flip ? 1 : 0}:${opt.tool || ''}:${opt.hue || 0}:${opt.field || ''}`, scale);
      g.globalAlpha = Math.min(1, e.hitT / 0.14); g.drawImage(f.c, dx, dy, w, h); g.globalAlpha = 1;
    }
    if (e.kind === 'villager' && e.carryK) this.carryIcon(g, x, y - 26, e.carryK);
    if (e.kind === 'enemy') {
      // Glowing eyes read in the dark.
      this.lights.push(x, y - 10, 10 * k, 0.25);
    } else if (e.kind === 'sovereign') {
      this.lights.push(x, y - 10, 3 * T, 0.9);
    } else if (e.kind === 'soldier') this.lights.push(x, y - 8, 1.3 * T, 0.5);
  }
  carryIcon(g, x, y, k) {
    if (k === 'wood') { g.fillStyle = '#a7774a'; g.fillRect(x - 6, y, 12, 4); g.fillStyle = '#d8b07a'; g.fillRect(x + 4, y, 2, 4); }
    else if (k === 'stone') { g.fillStyle = '#b4b0aa'; g.beginPath(); g.arc(x, y + 2, 3.5, 0, 6.283); g.fill(); }
  }

  drawProjectiles(g, s, alpha) {
    for (const p of s.projectiles) {
      const x = lerp(p.px, p.x, alpha), y = lerp(p.py, p.y, alpha) - p.z;
      if (ART_HOOKS.drawProjectileExt && ART_HOOKS.drawProjectileExt(g, p, x, y)) { if (p.kind === 'arcane') this.lights.push(x, y, 22, 0.7); continue; }
      if (p.kind === 'arrow') {
        const ang = Math.atan2(p.ty - p.sy - p.arc * p.dist * 0.7 * Math.cos(Math.PI * Math.min(1, p.t / p.dur)), p.tx - p.sx);
        g.strokeStyle = '#e8dcc0'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x - Math.cos(ang) * 7, y - Math.sin(ang) * 7); g.lineTo(x, y); g.stroke();
      } else {
        g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(x, y, 3.5, 0, 6.283); g.fill();
        this.lights.push(x, y, 26, 0.8);
        if (Math.random() < 0.6) this.particles.spawn('ember', x, y, { life: 0.35, size: 2.2, color: '#ff9a3a', add: true });
      }
    }
  }

  drawBars(g, s, alpha, view, z) {
    const bar = (x, y, f, foe, w = 18) => {
      g.fillStyle = 'rgba(15,10,8,0.8)'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, 4.5);
      const cb = this.settings.colorblind;
      g.fillStyle = foe ? (cb ? '#ff9a2a' : '#c8506a') : f > 0.5 ? (cb ? '#5fa8ff' : '#8fd16a') : f > 0.25 ? '#e8c440' : (cb ? '#ffd0a0' : '#e0563a');
      g.fillRect(x - w / 2, y, w * Math.max(0, f), 2.5);
    };
    if (z < 0.6) return; // far zoom level of detail: no small bars
    for (const list of [s.soldiers, s.enemies, s.villagers, s.heroes || []]) for (const e of list) {
      if (e.hp >= e.maxHp || e.st === 'sheltered' || e.boss) continue;
      const x = lerp(e.px, e.x, alpha), y = lerp(e.py, e.y, alpha);
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      if (e.type === 'rift') { bar(x, y - 46, e.hp / e.maxHp, true, 64); continue; }
      bar(x, y - 30 * (e.scale || 1), e.hp / e.maxHp, e.kind === 'enemy');
    }
    const v = s.sovereign;
    if (v && v.alive && v.hp < v.maxHp) bar(lerp(v.px, v.x, alpha), lerp(v.py, v.y, alpha) - 40, v.hp / v.maxHp, false, 26);
    for (const b of s.buildings) {
      if (!b.built || b.hp >= b.maxHp) continue;
      const sp = BUILDINGS[b.type];
      bar((b.tx + b.size / 2) * T, b.ty * T - (sp.size === 1 ? 20 : 24) - (b.type === 'tower' ? 34 : 0) - (b.type === 'hearth' ? 46 : 0), b.hp / b.maxHp, false, 14 + b.size * 8);
    }
  }

  // ---- Fog ---------------------------------------------------------------------------
  drawFog(g, s) {
    if (s.rt.fogDirty) {
      const d = this.fogImg.data;
      const W = N + 2;
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inside = x > 0 && y > 0 && x <= N && y <= N;
        const a = inside ? (s.fog[idx(x - 1, y - 1)] ? 0 : 245) : 245;
        d[i] = 22; d[i + 1] = 20; d[i + 2] = 32; d[i + 3] = a;
      }
      this.fg.putImageData(this.fogImg, 0, 0);
      s.rt.fogDirty = false;
      this.fogVersion++;
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(this.fogC, -T, -T, (N + 2) * T, (N + 2) * T);
  }

  // ---- Lighting ------------------------------------------------------------------------
  ambience(s) {
    const C = BAL.cycle, c = s.cycle;
    const blood = s.wave && s.wave.blood && (c.phase === 'dusk' || c.phase === 'night');
    let dark = 0, tint = null, tintA = 0;
    if (c.phase === 'day') {
      const late = Math.max(0, (c.t - (C.dayLen - 18)) / 18);
      tint = '255,170,80'; tintA = late * 0.14;
    } else if (c.phase === 'dusk') {
      const u = Math.min(1, c.t / C.duskLen);
      dark = u * 0.54; tint = blood ? '200,40,50' : '255,120,60'; tintA = 0.16 * (1 - u) + (blood ? 0.12 * u : 0);
    } else if (c.phase === 'night') {
      dark = 0.56; if (blood) { tint = '170,20,40'; tintA = 0.12; }
    } else if (c.phase === 'dawn') {
      const u = Math.min(1, c.t / C.dawnLen);
      dark = 0.56 * (1 - u); tint = '255,160,170'; tintA = 0.16 * (1 - u * 0.6);
    }
    return { dark, tint, tintA, blood };
  }

  drawLighting(g, s, cam, ox, oy, z) {
    const amb = this.ambience(s);
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (amb.tint && amb.tintA > 0.005) { g.fillStyle = `rgba(${amb.tint},${amb.tintA})`; g.fillRect(0, 0, this.w, this.h); }
    if (amb.dark < 0.01) return;
    const lg = this.lg, L = this.light;
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, L.width, L.height);
    lg.fillStyle = amb.blood ? `rgba(28,6,14,${amb.dark})` : `rgba(10,12,34,${amb.dark})`;
    lg.fillRect(0, 0, L.width, L.height);
    lg.globalCompositeOperation = 'destination-out';
    const ls = SP.lightSprite();
    const ls2 = this.lights;
    const flick = this.settings.reduceMotion ? 0 : 1;
    for (let i = 0; i < ls2.length; i += 4) {
      const sx = (ls2[i] * z + ox) / 2, sy = (ls2[i + 1] * z + oy) / 2;
      const r = ls2[i + 2] * z / 2 * (1 + flick * 0.04 * Math.sin(this.time * 9 + ls2[i]));
      if (sx + r < 0 || sy + r < 0 || sx - r > L.width || sy - r > L.height) continue;
      lg.globalAlpha = ls2[i + 3];
      lg.drawImage(ls.c, sx - r, sy - r, r * 2, r * 2);
    }
    lg.globalAlpha = 1;
    g.drawImage(L, 0, 0, this.w, this.h);
    // Warm additive glow around fires.
    g.globalCompositeOperation = 'lighter';
    const glow = SP.glowSprite(amb.blood ? 'rgba(255,90,60,0.35)' : 'rgba(255,150,60,0.32)');
    for (let i = 0; i < ls2.length; i += 4) {
      if (ls2[i + 2] < T * 1.5 || ls2[i + 3] < 0.85) continue;
      const sx = ls2[i] * z + ox, sy = ls2[i + 1] * z + oy, r = ls2[i + 2] * z * 0.8;
      if (sx + r < 0 || sy + r < 0 || sx - r > this.w || sy - r > this.h) continue;
      g.globalAlpha = amb.dark;
      g.drawImage(glow.c, sx - r, sy - r, r * 2, r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // ---- Placement ghost -------------------------------------------------------------------
  drawGhost(g, s, gh, scale) {
    const def = BUILDINGS[gh.type];
    const size = def.size;
    for (let i = 0; i < gh.tiles.length; i++) {
      const [tx, ty] = gh.tiles[i];
      const ok = gh.valid[i];
      const cb = this.settings.colorblind;
      g.fillStyle = ok ? (cb ? 'rgba(90,160,255,0.35)' : 'rgba(120,230,120,0.32)') : (cb ? 'rgba(255,150,40,0.4)' : 'rgba(240,80,70,0.38)');
      g.fillRect(tx * T, ty * T, size * T, size * T);
      g.strokeStyle = ok ? (cb ? 'rgba(140,200,255,0.95)' : 'rgba(160,255,160,0.95)') : (cb ? 'rgba(255,190,90,0.95)' : 'rgba(255,120,110,0.95)'); g.lineWidth = 2;
      g.strokeRect(tx * T + 1, ty * T + 1, size * T - 2, size * T - 2);
      const sp = SP.buildingSprite(gh.type, 0, scale, s.heraldry);
      g.globalAlpha = 0.6;
      g.drawImage(sp.c, tx * T - sp.ax, ty * T - sp.ay, sp.w, sp.h);
      g.globalAlpha = 1;
    }
    const [tx, ty] = gh.tiles[0];
    const cx = (tx + size / 2) * T, cy = (ty + size / 2) * T;
    this.rangeOf(g, s, gh.type, 0, cx, cy);
    if (def.needs) {
      const st = levelStats(gh.type, 0);
      for (const n of s.nodes) {
        if (n.kind !== def.needs || !s.fog[idx(n.tx, n.ty)]) continue;
        if (Math.hypot((n.tx + 0.5) * T - cx, (n.ty + 0.5) * T - cy) > st.radius * T) continue;
        g.strokeStyle = 'rgba(200,255,160,0.9)'; g.lineWidth = 1.5;
        g.beginPath(); g.ellipse((n.tx + 0.5) * T, (n.ty + 0.5) * T + 6, 9, 4.5, 0, 0, 6.283); g.stroke();
      }
    }
    if (def.line && gh.handle) {
      const [hx, hy] = gh.handle;
      const x = (hx + 0.5) * T, y = (hy + 0.5) * T;
      g.fillStyle = 'rgba(255,230,150,0.95)'; g.strokeStyle = '#3a2a1a'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 11, 0, 6.283); g.fill(); g.stroke();
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - 5, y); g.lineTo(x + 5, y); g.moveTo(x, y - 5); g.lineTo(x, y + 5); g.stroke();
    }
  }

  // ---- Screen-space: incoming wave arrows, press feedback, slow-mo vignette -------------------
  drawScreenOverlays(g, s, cam, ui, scale) {
    const ins = this.insets;
    if (ui.slowmo) {
      const gr = g.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.35, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7);
      gr.addColorStop(0, 'rgba(60,120,180,0)'); gr.addColorStop(1, 'rgba(60,120,180,0.28)');
      g.fillStyle = gr; g.fillRect(0, 0, this.w, this.h);
    }
    if (ui.press) {
      const p = ui.press;
      const u = Math.min(1, (performance.now() - p.t) / 480);
      g.strokeStyle = 'rgba(255,230,160,0.9)'; g.lineWidth = 3;
      g.beginPath(); g.arc(p.x, p.y, 26, -Math.PI / 2, -Math.PI / 2 + u * Math.PI * 2); g.stroke();
    }
    if (ui.tapMark) {
      const m = ui.tapMark, u = (performance.now() - m.t) / 400;
      if (u < 1) {
        const p = cam.worldToScreen(m.x, m.y);
        g.strokeStyle = `rgba(${m.color || '255,240,200'},${1 - u})`; g.lineWidth = 2.5;
        g.beginPath(); g.ellipse(p.x, p.y, 8 + u * 18, (8 + u * 18) * 0.55, 0, 0, 6.283); g.stroke();
      }
    }
    // Incoming waves: show during dusk, and for groups still to arrive at night.
    if (!s.wave || !(s.cycle.phase === 'dusk' || (s.cycle.phase === 'night' && s.spawnQueue.length))) return;
    const pending = new Map();
    if (s.cycle.phase === 'night') for (const q of s.spawnQueue) { const k = q.tx + ',' + q.ty; pending.set(k, (pending.get(k) || 0) + 1); }
    const pulse = 0.75 + Math.sin(this.time * 6) * 0.25;
    for (const gr of s.wave.groups) {
      const key = gr.sp.tx + ',' + gr.sp.ty;
      const count = s.cycle.phase === 'dusk' ? gr.units.length : pending.get(key) || 0;
      if (!count) continue;
      const wp = cam.worldToScreen((gr.sp.tx + 0.5) * T, (gr.sp.ty + 0.5) * T);
      const x0 = ins.left + 34, x1 = this.w - ins.right - 34, y0 = ins.top + 34, y1 = this.h - ins.bottom - 34;
      const on = wp.x > x0 && wp.x < x1 && wp.y > y0 && wp.y < y1;
      let ax = wp.x, ay = wp.y, ang = 0;
      if (!on) {
        const cx = this.w / 2, cy = (y0 + y1) / 2;
        const dx = wp.x - cx, dy = wp.y - cy;
        const k = Math.min((dx > 0 ? x1 - cx : x0 - cx) / (dx || 1e-6), (dy > 0 ? y1 - cy : y0 - cy) / (dy || 1e-6));
        ax = cx + dx * Math.abs(k); ay = cy + dy * Math.abs(k);
        ax = Math.max(x0, Math.min(x1, ax)); ay = Math.max(y0, Math.min(y1, ay));
        ang = Math.atan2(dy, dx);
      }
      const red = s.wave.blood ? '216,60,70' : '214,74,58';
      g.save(); g.translate(ax, ay);
      if (!on) {
        g.rotate(ang);
        g.fillStyle = `rgba(${red},${pulse})`; g.strokeStyle = 'rgba(30,10,10,0.9)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(30, 0); g.lineTo(10, -14); g.lineTo(10, 14); g.closePath(); g.fill(); g.stroke();
        g.rotate(-ang);
      }
      // Label: enemy icons with counts.
      const counts = s.cycle.phase === 'dusk' ? gr.counts : { husk: count };
      const entries = Object.entries(counts);
      const w = 14 + entries.length * 46;
      const lx = on ? -w / 2 : -w / 2 - Math.cos(ang) * 30, ly = on ? -58 : -22 - Math.sin(ang) * 26;
      g.fillStyle = 'rgba(28,20,24,0.88)'; g.strokeStyle = `rgba(${red},0.95)`; g.lineWidth = 2;
      roundRect(g, lx, ly, w, 40, 10); g.fill(); g.stroke();
      let ex = lx + 10;
      g.font = '800 15px system-ui, -apple-system, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      for (const [type, n] of entries) {
        const sp = SP.unitSprite(s.cycle.phase === 'dusk' ? type : 'husk', 0, false, SP.scaleBucket(this.dpr));
        g.drawImage(sp.c, ex - 2, ly + 4, 22, 27);
        g.fillStyle = '#fbe9d0'; g.fillText('×' + n, ex + 20, ly + 21);
        ex += 46;
      }
      if (gr.warden) { g.fillStyle = '#c9b0ff'; g.font = '800 13px system-ui, sans-serif'; g.fillText('ELITE', lx + 6, ly + 50); }
      g.restore();
    }
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function sortY(o, alpha) {
  if (o.kind === 'tree' || o.kind === 'rock') return (o.ty + 0.5) * T + 6;
  if (o.reward) return (o.ty + 0.5) * T + 6;
  if (o.tx !== undefined && o.size) return (o.ty + o.size) * T - 2;
  if (o.boss && o.flying) return 1e6; // the wyrm on the wing passes over everything
  return lerp(o.py, o.y, alpha);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
void UNITS; void SOVEREIGN_ABILITIES;
