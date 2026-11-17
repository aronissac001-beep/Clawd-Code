// Entity layer (owner C; doc 12.4 "drawn per frame, culled to the view"): plants, buildings and
// furniture, item stacks, colonists, animals and foes, y-sorted. Adapted from the roguelite
// render.js (drawSorted, drawNode, drawBuilding, drawUnit, flame, progressBar) onto the colony
// state (s.L.plant, s.bld, s.items, s.col, s.anim, s.foes; schema.js C2).
//
// Art comes through the art lookup (index.js artFor, C9): D's kit registry when it exists, else the
// roguelite sprites (buildingSprite for the old building ids, villager / husk units, trees, rocks).
// Positions are interpolated render-side between ticks (the sim has no px/py fields).
// Level of detail: zoom < strategicZoom draws colonists as constant-size pips (after the darkness)
// and item stacks as 4 px dots.

import { TILE, W, H } from '../../game/core/grid.js';
import * as SP from '../sprites.js';

const T = TILE;
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;

/** Roguelite footprints for the old building art ids (js/data/buildings.js sizes). */
const OLD_SIZE = { hearth: 3, house: 1, farm: 2, lumber: 2, quarry: 2, wall: 1, gate: 1, tower: 1, brazier: 1, barracks: 2 };
/** New structure ids drawn with the old art until D's kit lands (placeholder mapping). */
const OLD_ALIAS = { hearth: 'hearth', wall_wood: 'wall', wall_stone: 'wall', wall: 'wall', door: 'gate', gate: 'gate', brazier: 'brazier', tower: 'tower', house: 'house', barracks: 'barracks', farm: 'farm' };
/** Structures that are flames: they flicker in the light texture and draw an animated fire. */
const FLAME = { hearth: 15, brazier: 9, sconce: 4, torch: 4, fireplace: 8, campfire: 8 };
/** Plant kinds (placeholder ids until js/data/plants.js): 1 broadleaf, 2 pine, 3 bush, 4 crop, 5 tuft, 6 mushroom. */
export const PLANT = { TREE: 1, PINE: 2, BUSH: 3, CROP: 4, TUFT: 5, SHROOM: 6 };
const ITEM_COLOUR = { stone: '#9a958e', wood: '#a7774a', ore: '#b0603c', block: '#b8b2a8', food: '#d8a64a' };

const UNIT_OPT = { field: '', charge: '', second: '', hue: undefined, tool: undefined };
function unitKey(type, frame, flip, opt) { return `u:${type}:${frame}:${flip ? 1 : 0}:${opt.tool || ''}:${opt.hue || 0}:${opt.field || ''}`; }

export class EntityLayer {
  constructor(cfg) {
    this.cfg = cfg;
    this.list = [];                      // draw records, reused
    this.pool = [];
    this.ry = new Float64Array(512); this.ord = [];
    this.byDepth = (a, b) => { const d = this.ry[a] - this.ry[b]; return d < 0 ? -1 : d > 0 ? 1 : a - b; };
    this.motion = new Map();             // 'c12' -> { px, py, x, y, tick, anim, face, walk }
    this.pips = [];                      // strategic pips queued for after the darkness
    this.flames = [];                    // tile indexes of flames this frame (to the light layer)
    this.st = { drawn: 0 };
  }
  setState(s) { this.s = s; this.motion.clear(); }

  rec() { const r = this.pool.pop() || {}; this.list.push(r); return r; }

  /** Render-side motion: previous and current world position per mover, refreshed when s.tick moves. */
  moved(key, x, y, tick) {
    let m = this.motion.get(key);
    if (!m) { m = { px: x, py: y, x, y, tick, anim: 0, face: 1, walk: 0 }; this.motion.set(key, m); return m; }
    if (m.tick !== tick) {
      m.px = m.x; m.py = m.y; m.tick = tick;
      const dx = x - m.x, dy = y - m.y, d = Math.abs(dx) + Math.abs(dy);
      m.x = x; m.y = y;
      if (dx > 0.05) m.face = 1; else if (dx < -0.05) m.face = -1;
      m.walk = d > 0.04 ? 1 : 0; m.anim += d / 6;
    }
    return m;
  }

  gather(s, view, ctx) {
    for (const r of this.list) this.pool.push(r);
    this.list.length = 0;
    this.flames.length = 0;
    const inView = (x, y, pad = 0) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;
    // Plants (per visible tile, from the plant layer).
    const L = s.L;
    const tx0 = Math.max(0, Math.floor(view.x0 / T)), tx1 = Math.min(W - 1, Math.floor(view.x1 / T));
    const ty0 = Math.max(0, Math.floor(view.y0 / T)), ty1 = Math.min(H - 1, Math.floor(view.y1 / T) + 2);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const i = ty * W + tx, p = L.plant[i];
      if (!p) continue;
      const r = this.rec(); r.k = 'plant'; r.p = p; r.i = i; r.y = (ty + 0.5) * T + 6;
    }
    for (const b of s.bld) {
      if (!b || b.st === 'bp') continue; // blueprints are an overlay
      const sz = ctx.sizeOf(b);
      const cx = (b.x + sz / 2) * T, by = (b.y + sz) * T;
      const fl = FLAME[b.def];
      if (fl && b.st === 'done') this.flames.push(b.y * W + b.x + (sz > 1 ? ((sz / 2) | 0) * (W + 1) : 0));
      if (!inView(cx, by, 96)) continue;
      const r = this.rec(); r.k = 'bld'; r.e = b; r.sz = sz; r.y = by - 2;
    }
    const strategic = view.z < this.cfg.strategicZoom;
    for (const it of s.items) {
      if (!it) continue;
      const x = (it.x + 0.5) * T, y = (it.y + 0.5) * T;
      if (!inView(x, y)) continue;
      const r = this.rec(); r.k = 'item'; r.e = it; r.y = y - 4;
    }
    const tick = s.tick;
    this.pips.length = 0;
    // forget movers not seen for 600 ticks (dead, gone or off the map)
    if ((this.gathers = (this.gathers || 0) + 1) % 300 === 0) for (const [k, m] of this.motion) if (tick - m.tick > 600) this.motion.delete(k);
    for (const c of s.col) {
      const m = this.moved('c' + c.id, c.x, c.y, tick);
      if (!inView(c.x, c.y, 40)) continue;
      if (strategic) { this.pips.push(c, m, 0); continue; }
      const r = this.rec(); r.k = 'col'; r.e = c; r.m = m; r.y = lerp(m.py, m.y, ctx.alpha);
    }
    for (const a of s.anim) {
      const m = this.moved('a' + a.id, a.x, a.y, tick);
      if (!inView(a.x, a.y, 40)) continue;
      const r = this.rec(); r.k = 'anim'; r.e = a; r.m = m; r.y = lerp(m.py, m.y, ctx.alpha);
    }
    for (const f of s.foes) {
      const m = this.moved('f' + f.id, f.x, f.y, tick);
      if (!inView(f.x, f.y, 60)) continue;
      if (strategic) { this.pips.push(f, m, 1); continue; }
      const r = this.rec(); r.k = 'foe'; r.e = f; r.m = m; r.y = lerp(m.py, m.y, ctx.alpha);
    }
  }

  /** Draw every record in depth order (g in world transform). */
  draw(g, s, view, ctx) {
    this.gather(s, view, ctx);
    const L = this.list, n = L.length;
    if (this.ry.length < n) this.ry = new Float64Array(n * 2);
    const ry = this.ry, ord = this.ord;
    ord.length = n;
    for (let i = 0; i < n; i++) { ry[i] = L[i].y; ord[i] = i; }
    ord.sort(this.byDepth);
    for (let j = 0; j < n; j++) {
      const r = L[ord[j]];
      switch (r.k) {
        case 'plant': this.drawPlant(g, s, r, ctx); break;
        case 'bld': this.drawBuilding(g, s, r, ctx); break;
        case 'item': this.drawItem(g, r.e, ctx, view.z); break;
        case 'col': this.drawMover(g, s, r, ctx, 'villager', false); break;
        case 'anim': this.drawMover(g, s, r, ctx, 'hound', false); break;
        case 'foe': this.drawMover(g, s, r, ctx, 'husk', true); break;
        default: break;
      }
    }
    this.st.drawn = n;
  }

  drawPlant(g, s, r, ctx) {
    const i = r.i, tx = i % W, ty = (i / W) | 0, x = (tx + 0.5) * T, y = (ty + 0.5) * T;
    const p = r.p, gr = s.L.growth[i];
    const v = (tx * 7 + ty * 13) % 3;
    let sp;
    if (p === PLANT.TREE || p === PLANT.PINE) sp = SP.treeSprite(p === PLANT.PINE ? 3 + (v & 1) : v, ctx.scale, ctx.pal);
    else if (p === PLANT.BUSH || p === PLANT.CROP) sp = SP.treeSprite(v, ctx.scale, ctx.pal);
    if (sp) {
      const k = p === PLANT.BUSH ? 0.45 : p === PLANT.CROP ? 0.3 + 0.25 * (gr / 255) : gr ? 0.45 + 0.55 * (gr / 255) : 1;
      g.drawImage(sp.c, x - sp.ax * k, y + 6 - sp.ay * k, sp.w * k, sp.h * k);
      if (ctx.carve && SP.EMIS.length && p <= PLANT.PINE) ctx.occlude(x - sp.w * 0.4 * k, y + 6 - sp.ay * k, x + sp.w * 0.4 * k, y - 4);
      return;
    }
    if (p === PLANT.TUFT) { g.strokeStyle = '#3f6f2c'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x - 4, y + 4); g.lineTo(x - 2, y - 4); g.moveTo(x, y + 4); g.lineTo(x, y - 6); g.moveTo(x + 4, y + 4); g.lineTo(x + 3, y - 3); g.stroke(); }
    else if (p === PLANT.SHROOM) { g.fillStyle = '#d8d0c0'; g.fillRect(x - 1, y - 2, 2, 5); g.fillStyle = '#9a6ad0'; g.beginPath(); g.ellipse(x, y - 3, 5, 3, 0, 0, TAU); g.fill(); }
  }

  drawBuilding(g, s, r, ctx) {
    const b = r.e, sz = r.sz;
    const cx = (b.x + sz / 2) * T;
    const art = ctx.artFor(b);
    if (art && art.draw) { art.draw(g, b, ctx); } // a kit drawer from D (C9 art key lookup)
    else if (art && art.sprite) {
      const sp = art.sprite(ctx.scale);
      const x = b.x * T - sp.ax, y = b.y * T - sp.ay;
      if (b.st === 'frame') {
        const need = Math.max(1, b.work || 1), p = Math.max(0.05, Math.min(1, (b.got && b.got.work ? b.got.work : 0) / need || 0.35));
        const sh = sp.h * p;
        g.globalAlpha = 0.95;
        g.drawImage(sp.c, 0, (sp.h - sh) * (sp.c.height / sp.h), sp.c.width, sh * (sp.c.height / sp.h), x, y + sp.h - sh, sp.w, sh);
        g.globalAlpha = 1;
        const sc = SP.scaffoldSprite(sz, ctx.scale);
        g.drawImage(sc.c, b.x * T - sc.ax, b.y * T - sc.ay, sc.w, sc.h);
        this.progressBar(g, cx, b.y * T - 10, p, '#f0c040');
        return;
      }
      g.drawImage(sp.c, x, y, sp.w, sp.h);
      if (ctx.carve && SP.EMIS.length) ctx.occlude(b.x * T, y + sp.h * 0.15, (b.x + sz) * T, (b.y + sz) * T);
      if (b.hitT > 0 && art.key) {
        const f = sp.flash || SP.flashOf(sp, art.key, ctx.scale);
        g.globalAlpha = Math.min(1, b.hitT / 0.14) * 0.7; g.drawImage(f.c, x, y, sp.w, sp.h); g.globalAlpha = 1;
      }
      const fl = FLAME[b.def];
      if (fl && b.def === 'hearth') this.flame(g, cx, b.y * T - sp.ay + 58, fl, ctx);
      else if (fl && b.def === 'brazier') this.flame(g, cx, b.y * T - sp.ay + 20 - (b.lvl - 1) * 3, 7 + (b.lvl - 1) * 2, ctx);
      else if (fl) this.flame(g, cx, b.y * T + 6, fl, ctx);
    } else {
      this.placeholderBox(g, b, sz);
      const fl = FLAME[b.def];
      if (fl) this.flame(g, cx, b.y * T + T * 0.45, fl, ctx);
    }
  }
  /** A neutral box for a structure with no art yet (D's kit replaces it). */
  placeholderBox(g, b, sz) {
    const x = b.x * T, y = b.y * T, S = sz * T;
    g.fillStyle = 'rgba(20,15,30,0.25)'; g.beginPath(); g.ellipse(x + S / 2, y + S - 3, S * 0.45, 4, 0, 0, TAU); g.fill();
    g.fillStyle = b.st === 'frame' ? 'rgba(150,120,80,0.6)' : '#8a6d4a'; g.strokeStyle = 'rgba(30,22,16,0.8)'; g.lineWidth = 1;
    g.fillRect(x + 4, y + 6, S - 8, S - 10); g.strokeRect(x + 4.5, y + 6.5, S - 9, S - 11);
    g.fillStyle = '#a7865e'; g.fillRect(x + 4, y + 4, S - 8, 5);
  }
  flame(g, x, y, r, ctx) {
    const t = ctx.time;
    const f1 = ctx.reduceMotion ? 0 : Math.sin(t * 11 + x) * 0.12 + Math.sin(t * 7.3 + y) * 0.1;
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
  progressBar(g, x, y, p, color) {
    g.fillStyle = 'rgba(20,14,10,0.75)'; g.fillRect(x - 15, y - 2, 30, 5);
    g.fillStyle = color; g.fillRect(x - 14, y - 1, 28 * Math.max(0, Math.min(1, p)), 3);
  }

  drawItem(g, it, ctx, z) {
    const x = (it.x + 0.5) * T, y = (it.y + 0.5) * T;
    const kind = it.k.startsWith('stone') ? 'stone' : it.k.startsWith('wood') ? 'wood' : it.k.startsWith('ore') ? 'ore' : it.k.startsWith('block') ? 'block' : 'food';
    if (z < this.cfg.strategicZoom) { g.fillStyle = ITEM_COLOUR[kind]; g.fillRect(x - 2 / z, y - 2 / z, 4 / z, 4 / z); return; }
    const n = Math.min(10, it.n | 0);
    if (kind === 'stone' || kind === 'ore' || kind === 'block') {
      for (let k = 0; k < Math.min(6, 1 + (n >> 1)); k++) {
        const px = x - 8 + (k % 3) * 7, py = y + 4 - ((k / 3) | 0) * 6;
        g.fillStyle = k & 1 ? SP.shade(ITEM_COLOUR[kind], -0.2) : ITEM_COLOUR[kind]; g.strokeStyle = 'rgba(30,22,16,0.7)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(px - 3.5, py + 2.5); g.lineTo(px - 1.5, py - 3); g.lineTo(px + 3.5, py - 2); g.lineTo(px + 3, py + 3); g.closePath(); g.fill(); g.stroke();
      }
    } else if (kind === 'wood') {
      for (let k = 0; k < Math.min(4, 1 + (n >> 2)); k++) {
        const py = y + 4 - k * 4;
        g.fillStyle = '#8a5e36'; g.fillRect(x - 9, py - 2, 18, 4); g.fillStyle = '#d8b07a'; g.beginPath(); g.ellipse(x + 9, py, 2, 2, 0, 0, TAU); g.fill();
      }
    } else {
      g.fillStyle = '#8a5a2e'; g.fillRect(x - 7, y - 5, 14, 10); g.strokeStyle = 'rgba(30,22,16,0.8)'; g.strokeRect(x - 6.5, y - 4.5, 13, 9);
    }
  }

  drawMover(g, s, r, ctx, type, foe) {
    const e = r.e, m = r.m;
    const x = lerp(m.px, m.x, ctx.alpha), y = lerp(m.py, m.y, ctx.alpha);
    let frame = m.walk ? ((m.anim / 2.4) | 0) % 2 ? 1 : 2 : 0;
    const opt = UNIT_OPT;
    opt.field = ctx.her.field; opt.charge = ctx.her.charge; opt.second = ctx.her.second; opt.hue = undefined; opt.tool = undefined;
    if (type === 'villager') {
      opt.hue = e.look ? (e.look.cloth | 0) % 3 : 0;
      const jt = e.job && e.job.type;
      if (jt && !m.walk) {
        opt.tool = jt === 'build' ? 'hammer' : jt === 'chop' ? 'axe' : jt === 'mine' ? 'pick' : jt === 'grow' ? 'hoe' : undefined;
        if (opt.tool) frame = ((ctx.time * 3 + e.id * 0.37) | 0) % 2 ? 3 : 4;
      }
      opt.field = ''; opt.charge = ''; opt.second = '';
    }
    const flip = m.face < 0;
    const sp = SP.unitSprite(type, frame, flip, ctx.scale, opt);
    const dx = x - sp.ax, dy = y - sp.ay;
    if (foe) { const cs = SP.contactShadow(); g.drawImage(cs.c, x - cs.ax, y + 0.5 - cs.ay, cs.w, cs.h); }
    g.drawImage(sp.c, dx, dy, sp.w, sp.h);
    if (e.hitT > 0) {
      const f = sp.flash || SP.flashOf(sp, unitKey(type, frame, flip, opt), ctx.scale);
      g.globalAlpha = Math.min(1, e.hitT / 0.08) * 0.95; g.drawImage(f.c, dx, dy, sp.w, sp.h); g.globalAlpha = 1;
    }
    if (foe) {
      const ci = SP.rimIndex(e), rim = sp.rim && sp.rim[ci];
      if (rim) SP.pushEmissive(sp, rim, dx, dy, sp.w, sp.h, 1);
      else SP.markEmissive(sp, unitKey(type, frame, flip, opt), ctx.scale, dx, dy, sp.w, sp.h, 1, ci);
    }
  }

  /** Strategic view (zoom < strategicZoom): constant-size pips with a 44 pt hit area, after the darkness. */
  drawPips(g, ctx, z) {
    const P = this.pips, k = 1 / z, rr = (this.cfg.pipPt / 2) * k;
    for (let i = 0; i < P.length; i += 3) {
      const m = P[i + 1], foe = P[i + 2] === 1;
      const x = lerp(m.px, m.x, ctx.alpha), y = lerp(m.py, m.y, ctx.alpha);
      g.fillStyle = 'rgba(10,8,6,0.6)'; g.beginPath(); g.arc(x, y + 1.5 * k, rr + 1.5 * k, 0, TAU); g.fill();
      g.fillStyle = foe ? '#c8506a' : '#e8c06a'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      g.strokeStyle = foe ? '#ffd0d8' : '#fff4d8'; g.lineWidth = 2 * k; g.beginPath(); g.arc(x, y, rr - 1 * k, 0, TAU); g.stroke();
      if (!foe) { g.fillStyle = '#3a2a1a'; g.beginPath(); g.arc(x, y - 2 * k, 3 * k, 0, TAU); g.fill(); g.fillRect(x - 4 * k, y + 1.5 * k, 8 * k, 4 * k); }
    }
  }
}
