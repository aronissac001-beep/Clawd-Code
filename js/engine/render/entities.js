// Entity layer (owner C; doc 12.4 "drawn per frame, culled to the view"): plants, buildings and
// furniture, item stacks, colonists, animals and foes, y-sorted. Adapted from the roguelite
// render.js (drawSorted, drawNode, drawBuilding, drawUnit, flame, progressBar) onto the colony
// state (s.L.plant, s.bld, s.items, s.col, s.anim, s.foes; schema.js C2).
//
// Art comes through the art lookup (index.js artFor, C9): D's kit registry when it has the key,
// else kit.js stand-ins (walls autotiled by neighbouring walls, doors and rock; furniture; benches),
// else the roguelite sprites for the Hearth and the old debug-scene ids. Footprints come from the
// structure data (size, rotated). Plants come from js/data/plants.js by layer code (kind tree or
// crop). Positions are interpolated render-side between ticks (the sim has no px/py fields).
// Level of detail: zoom < strategicZoom draws colonists as constant-size pips (after the darkness)
// with the role glyph, a mood ring and job and draft badges, a 44 pt hit area (pipAt), and item
// stacks as 4 px dots.

import { TILE, W, H, N, TER } from '../../game/core/grid.js';
import { structDef } from '../../game/core/content.js';
import { FIX } from '../../game/core/schema.js';
import { plantDef } from '../../game/world/defs.js';
import { PLANT_CODE } from '../../data/plants.js';
import { buildWork } from '../../game/work/construct.js';
import * as SP from '../sprites.js';
import { kitSprite, drawScaffold, drawItem, itemDot } from './kit.js';

const T = TILE;
const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
/** Snap a world coordinate to whole art pixels (2 world units). */
const snap = (v) => Math.round(v / 2) * 2;

/** Flame sizes of structures that burn (the Hearth's flame is part of its old art). */
const FLAME = { hearth: 15, brazier: 9, sconce: 4.5, torch: 4, fireplace: 8, campfire: 8 };
/** Plant layer codes (js/data/plants.js order: index + 1). Debug scenes use these. */
export const PLANT = Object.freeze({ TREE: PLANT_CODE.oak || 1, PINE: PLANT_CODE.pine || 2, CROP: PLANT_CODE.hearthroot || 3 });
const JOB_COL = { idle: null, mine: '#e8a050', build: '#6ab0e8', construct: '#6ab0e8', deliver: '#6ab0e8', chop: '#7ac85a', haul: '#d8c08a', craft: '#c88ae8', deconstruct: '#e87a6a' };
const ROLE_GLYPH = { miner: 1, builder: 2, crafter: 3, hauler: 4, generalist: 0 };

const FLOORISH = new Map();
const isFloorDef = (id) => { let v = FLOORISH.get(id); if (v === undefined) { const d = structDef(id); v = !!(d && d.flags && d.flags.includes('floor')); FLOORISH.set(id, v); } return v; };
const GHOST = new Map();
/** Blueprints drawn as a faint ghost of the finished piece: anything but walls and floors. */
const bpGhost = (id) => { let v = GHOST.get(id); if (v === undefined) { const d = structDef(id); v = !!d && !(d.flags && (d.flags.includes('floor') || d.flags.includes('wall'))); GHOST.set(id, v); } return v; };

const PIP_OPT = { kind: 'colonist', mood: 50, role: 'generalist', drafted: false, job: false, alert: false };
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
    this.pipXY = new Float32Array(4 * 128); this.pipN = 0; // screen x, y, kind (0 colonist, 1 foe), id
    this.flames = [];                    // tile indexes of flames this frame (to the light layer)
    this.colAt = null;                   // Uint8Array(N): a colonist stands here this frame (doors open)
    this.lit = [];                       // colonists drawn this frame: [sprite, x, y, tile] x n (redrawn over darkness)
    this.st = { drawn: 0 };
  }
  setState(s) { this.s = s; this.motion.clear(); this.colAt = new Uint8Array(N); }

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

  /** Wall-like neighbour (connects walls and frames doors): natural rock, or a wall or door that is not a blueprint. */
  wallish(s, x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;
    const i = y * W + x;
    if (s.L.terrain[i] === TER.ROCK) return true;
    const id = s.rt.occ ? s.rt.occ[i] : -1;
    if (id < 0) return false;
    const b = s.bld[id];
    if (!b || b.st === 'bp') return false;
    const d = structDef(b.def);
    return !!(d && d.flags && (d.flags.includes('wall') || d.flags.includes('door')));
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
    // Colonists' tiles (doors stand open under them).
    const colAt = this.colAt;
    for (const c of s.col) { const tx = Math.floor(c.x / T), ty = Math.floor(c.y / T); if (tx >= 0 && ty >= 0 && tx < W && ty < H) colAt[ty * W + tx] = 1; }
    for (const b of s.bld) {
      if (!b) continue;
      // blueprints are an overlay (dashed footprint); furniture, benches and doors also get a faint
      // ghost of the finished piece so a planned bed reads as a bed (walls and floors stay dashed)
      if (b.st === 'bp' && !bpGhost(b.def)) continue;
      if (b.st === 'done' && isFloorDef(b.def)) continue; // a laid floor lives in the floor layer (baked)
      const f = ctx.footOf(b), w = f[0], h = f[1];
      const fl = FLAME[b.def];
      if (fl && b.st === 'done') this.flames.push(Math.min(N - 1, (b.y + (h >> 1)) * W + b.x + (w >> 1)));
      if (!inView((b.x + w / 2) * T, (b.y + h / 2) * T, 64 + Math.max(w, h) * T)) continue;
      const r = this.rec(); r.k = 'bld'; r.e = b; r.w = w; r.h = h; r.y = (b.y + h) * T - 2;
    }
    const tick = s.tick;
    for (const it of s.items) {
      if (!it) continue;
      const x = (it.x + 0.5) * T, y = (it.y + 0.5) * T;
      if (!inView(x, y, 16)) continue;
      const r = this.rec(); r.k = 'item'; r.e = it; r.y = y - 4;
    }
    const strategic = view.z < this.cfg.strategicZoom;
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
    this.lit.length = 0;
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
    // clear the colonist tile marks
    for (const c of s.col) { const tx = Math.floor(c.x / T), ty = Math.floor(c.y / T); if (tx >= 0 && ty >= 0 && tx < W && ty < H) this.colAt[ty * W + tx] = 0; }
    this.st.drawn = n;
  }

  drawPlant(g, s, r, ctx) {
    const i = r.i, tx = i % W, ty = (i / W) | 0, x = (tx + 0.5) * T, y = (ty + 0.5) * T;
    const p = r.p, gr = s.L.growth[i], pd = plantDef(p);
    const kind = pd ? pd.kind : p === PLANT.TREE || p === PLANT.PINE ? 'tree' : 'crop';
    const v = (tx * 7 + ty * 13) % 3;
    const K = ctx.kit;
    if (K && K.treeSprite) { // D's pixel kit: growth stages instead of scaling (pixels stay whole)
      const st = K.stageOf(gr), id = pd ? pd.id : '';
      const sp = kind === 'tree' ? K.treeSprite(id === 'pine' || p === PLANT.PINE ? 'pine' : 'oak', v, st)
        : kind === 'bush' || id === 'berry' ? K.bushSprite(v, gr >= 230) : K.cropSprite(id || 'hearthroot', st);
      const by = kind === 'tree' ? y + 8 : y + 10;
      g.drawImage(sp.c, x - sp.ax, by - sp.ay, sp.w, sp.h);
      if (kind === 'tree' && ctx.carve && SP.EMIS.length) ctx.occlude(x - sp.w * 0.4, by - sp.ay, x + sp.w * 0.4, y - 4);
      return;
    }
    if (kind === 'tree') {
      const pine = pd ? pd.id === 'pine' : p === PLANT.PINE;
      const sp = SP.treeSprite(pine ? 3 + (v & 1) : v, ctx.scale, ctx.pal);
      const k = 0.4 + 0.6 * (gr / 255);
      g.drawImage(sp.c, x - sp.ax * k, y + 6 - sp.ay * k, sp.w * k, sp.h * k);
      if (ctx.carve && SP.EMIS.length) ctx.occlude(x - sp.w * 0.4 * k, y + 6 - sp.ay * k, x + sp.w * 0.4 * k, y - 4);
      return;
    }
    const k = 0.35 + 0.65 * (gr / 255);
    g.fillStyle = '#4f8a3a';
    for (let q = 0; q < 3; q++) { const a = -1.9 + q * 0.6; g.beginPath(); g.ellipse(x + Math.cos(a) * 4 * k, y + 2 + Math.sin(a) * 6 * k, 2.6 * k, 6 * k, a + 1.57, 0, TAU); g.fill(); }
  }

  drawBuilding(g, s, r, ctx) {
    if (r.e.st === 'bp') { g.globalAlpha = 0.38; this.drawBuildingArt(g, s, r, ctx); g.globalAlpha = 1; return; }
    this.drawBuildingArt(g, s, r, ctx);
  }
  drawBuildingArt(g, s, r, ctx) {
    const b = r.e, w = r.w, h = r.h;
    const cx = (b.x + w / 2) * T;
    const art = ctx.artFor(b);
    if (art && art.draw) { // a kit drawer from D (C9 art key lookup); a deconstruct order shows the kit's cancel mark
      art.draw(g, b, ctx);
      if (b.dcon && ctx.kit && ctx.kit.markSprite) { const mk = ctx.kit.markSprite('cancel'); g.drawImage(mk.c, b.x * T + ((w - 1) * T) / 2, b.y * T + ((h - 1) * T) / 2, mk.w, mk.h); }
      return;
    }
    if (art && art.sprite) { this.drawOldArt(g, b, art, w, ctx); return; }
    // kit.js stand-in
    const d = structDef(b.def);
    let mask = 0, open = false;
    const flags = d && d.flags;
    if (flags && (flags.includes('wall') || flags.includes('door'))) {
      mask = (this.wallish(s, b.x, b.y - 1) ? 1 : 0) | (this.wallish(s, b.x + 1, b.y) ? 2 : 0) | (this.wallish(s, b.x, b.y + 1) ? 4 : 0) | (this.wallish(s, b.x - 1, b.y) ? 8 : 0);
      if (flags.includes('door')) open = this.colAt[b.y * W + b.x] === 1;
    }
    const sp = kitSprite(b, d, w, h, ctx.scale, mask, open);
    const x = b.x * T, y = b.y * T;
    if (b.st === 'frame') {
      const p = Math.max(0, Math.min(1, (b.work || 0) / buildWork(b)));
      g.globalAlpha = 0.45 + 0.4 * p; g.drawImage(sp.c, x, y, sp.w, sp.h); g.globalAlpha = 1;
      drawScaffold(g, x, y, w, h);
      if (p > 0) this.progressBar(g, cx, y - 4, p, '#f0c040');
    } else {
      g.drawImage(sp.c, x, y - sp.ay, sp.w, sp.h);
      const fl = FLAME[b.def];
      if (fl) this.flame(g, cx, y + 4, fl, ctx);
    }
    if (b.dcon) { // marked for deconstruction
      g.strokeStyle = 'rgba(240,90,70,0.9)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + 6, y + 6); g.lineTo(x + w * T - 6, y + h * T - 6); g.moveTo(x + w * T - 6, y + 6); g.lineTo(x + 6, y + h * T - 6); g.stroke();
    }
  }
  /** The roguelite building art (the Hearth until D's kit lands; old ids in the flat debug scene). */
  drawOldArt(g, b, art, sz, ctx) {
    const cx = (b.x + sz / 2) * T;
    const sp = art.sprite(ctx.scale, b);
    const x = b.x * T - sp.ax, y = b.y * T - sp.ay;
    if (b.st === 'frame') {
      const p = Math.max(0.05, Math.min(1, (b.work || 0) / Math.max(1, buildWork(b))));
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
    const K = ctx.kit;
    if (K && K.drawItem) { K.drawItem(g, it, z, ctx.scale); return; } // D's kit
    const x = (it.x + 0.5) * T, y = (it.y + 0.5) * T;
    if (z < this.cfg.strategicZoom) { g.fillStyle = itemDot(it); g.fillRect(x - 2 / z, y - 2 / z, 4 / z, 4 / z); return; }
    drawItem(g, it, x, y, ctx.scale);
  }

  drawMover(g, s, r, ctx, type, foe) {
    const e = r.e, m = r.m;
    const x = lerp(m.px, m.x, ctx.alpha), y = lerp(m.py, m.y, ctx.alpha);
    const K = ctx.kit;
    if (K && K.colonistSprite) { this.drawPixelMover(g, s, e, m, x, y, ctx, type, foe, K); return; }
    let frame = m.walk ? ((m.anim / 2.4) | 0) % 2 ? 1 : 2 : 0;
    const opt = UNIT_OPT;
    opt.field = ctx.her.field; opt.charge = ctx.her.charge; opt.second = ctx.her.second; opt.hue = undefined; opt.tool = undefined;
    if (type === 'villager') {
      opt.hue = e.look ? (e.look.cloth | 0) % 3 : 0;
      const jt = e.job && e.job.type;
      if (jt && !m.walk) {
        opt.tool = jt === 'build' || jt === 'construct' || jt === 'deconstruct' ? 'hammer' : jt === 'chop' ? 'axe' : jt === 'mine' ? 'pick' : jt === 'grow' ? 'hoe' : undefined;
        if (opt.tool) frame = ((ctx.time * 3 + e.id * 0.37) | 0) % 2 ? 3 : 4;
      }
      opt.field = ''; opt.charge = ''; opt.second = '';
    }
    const flip = m.face < 0;
    const sp = SP.unitSprite(type, frame, flip, ctx.scale, opt);
    const dx = x - sp.ax, dy = y - sp.ay;
    if (type === 'villager') { const tx = Math.floor(x / T), ty = Math.floor(y / T); this.lit.push(sp, dx, dy, tx >= 0 && ty >= 0 && tx < W && ty < H ? ty * W + tx : -1); }
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
  /**
   * D's pixel sprites (docs/ART-STYLE.md): the walk cycle 1, 0, 2, 0 by distance walked, the carry
   * pose while a job carries a stack (5, 6, 0 -> 7), the work swing (3, 4) with the job's tool, and
   * the draw position snapped to whole art pixels (2 world units) so sprites never shimmer.
   */
  drawPixelMover(g, s, e, m, x, y, ctx, type, foe, K) {
    const flip = m.face < 0, step = ((m.anim / 1.6) | 0) & 3; // 0..3 through the cycle
    let sp, frame = 0;
    if (type === 'villager') {
      const carry = K.carryOf ? K.carryOf(e) : 0, jt = e.job && e.job.type;
      const tool = jt && !m.walk && !carry && K.toolOfJob ? K.toolOfJob(jt) : '';
      if (carry) frame = m.walk ? [6, 5, 7, 5][step] : 5;
      else if (tool) frame = ((ctx.time * 3 + e.id * 0.37) | 0) % 2 ? 3 : 4;
      else frame = m.walk ? [1, 0, 2, 0][step] : 0;
      sp = K.colonistSprite(e, frame, flip, ctx.scale, tool);
      const sel = ctx.select;
      if (sel && sel.kind === 'colonist' && sel.id === e.id && K.selectRing) { const rg = K.selectRing(!!e.drafted); g.drawImage(rg.c, snap(x) - rg.ax, snap(y) - rg.ay, rg.w, rg.h); }
    } else if (foe) {
      frame = e.atkT > 0 ? 3 : m.walk ? [1, 0, 2, 0][step] : 0;
      sp = K.foeSprite(e.kind, frame, flip);
    } else {
      frame = m.walk ? [1, 0, 2, 0][step] : 0;
      sp = K.animalSprite(e.kind, frame, flip);
    }
    const dx = snap(x) - sp.ax, dy = snap(y) - sp.ay;
    if (type === 'villager') { const tx = Math.floor(x / T), ty = Math.floor(y / T); this.lit.push(sp, dx, dy, tx >= 0 && ty >= 0 && tx < W && ty < H ? ty * W + tx : -1); }
    g.drawImage(sp.c, dx, dy, sp.w, sp.h);
    if (e.hitT > 0) {
      const f = sp.flash || SP.flashOf(sp, sp.k || `mv:${type}:${e.kind}:${frame}:${flip ? 1 : 0}`, 0.5);
      g.globalAlpha = Math.min(1, e.hitT / 0.08) * 0.95; g.drawImage(f.c, dx, dy, sp.w, sp.h); g.globalAlpha = 1;
    }
    if (foe && K.pixelRim) SP.pushEmissive(sp, K.pixelRim(sp, SP.rimIndex(e)), dx, dy, sp.w, sp.h, 1);
  }

  /**
   * Readability in the dark (render only, not light): a colonist on a tile darker than level 1.5 is
   * drawn again over the darkness at partial alpha, so the player can follow the digging in an
   * unlit tunnel. levelOf(i) is the light layer's level for tile i (or < 0 for fog and rock).
   */
  drawOverDark(g, levelOf) {
    const L = this.lit;
    for (let k = 0; k < L.length; k += 4) {
      const i = L[k + 3];
      if (i < 0) continue;
      const lv = levelOf(i);
      if (lv < 0 || lv >= 1.5) continue;
      const sp = L[k];
      g.globalAlpha = 0.65 * (1 - lv / 1.5);
      g.drawImage(sp.c, L[k + 1], L[k + 2], sp.w, sp.h);
    }
    g.globalAlpha = 1;
  }

  /**
   * Strategic view (zoom < strategicZoom): constant-size pips after the darkness (12.4). A colonist
   * pip is a 20 pt disc with its role glyph, a mood ring, a job badge (colour of the job) and a
   * draft badge; a foe is a red pip. (ox, oy) is the screen offset of world (0, 0) so pipAt can hit
   * test in screen space (44 pt hit area).
   */
  drawPips(g, ctx, z, ox = 0, oy = 0) {
    const P = this.pips, k = 1 / z, rr = (this.cfg.pipPt / 2) * k;
    if (this.pipXY.length < (P.length / 3) * 4) this.pipXY = new Float32Array(P.length * 2 + 64);
    const XY = this.pipXY;
    let n = 0;
    for (let i = 0; i < P.length; i += 3) {
      const e = P[i], m = P[i + 1], foe = P[i + 2] === 1;
      const x = lerp(m.px, m.x, ctx.alpha), y = lerp(m.py, m.y, ctx.alpha);
      XY[n * 4] = ox + x * z; XY[n * 4 + 1] = oy + y * z; XY[n * 4 + 2] = foe ? 1 : 0; XY[n * 4 + 3] = e.id; n++;
      if (ctx.kit && ctx.kit.pipSprite) { // D's pixel pips, drawn in screen space on whole device pixels (2 css px per pip pixel)
        const o = PIP_OPT; o.kind = foe ? 'foe' : 'colonist'; o.mood = foe ? 0 : (e.mood | 0) / FIX; o.role = (e.role && e.role[0]) || 'generalist';
        o.drafted = !!e.drafted; o.job = !foe && !!(e.job && e.job.type !== 'idle'); o.alert = false;
        const sp = ctx.kit.pipSprite(o), dpr = ctx.dpr || 1, pw = sp.c.width * 2, ph = sp.c.height * 2;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
        g.drawImage(sp.c, Math.round((XY[(n - 1) * 4] - pw / 2) * dpr) / dpr, Math.round((XY[(n - 1) * 4 + 1] - ph / 2) * dpr) / dpr, pw, ph);
        g.imageSmoothingEnabled = sm;
        g.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr);
        continue;
      }
      g.fillStyle = 'rgba(10,8,6,0.6)'; g.beginPath(); g.arc(x, y + 1.5 * k, rr + 2.5 * k, 0, TAU); g.fill();
      g.fillStyle = foe ? '#c8506a' : e.drafted ? '#d8835a' : '#e8c06a'; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
      if (foe) { g.strokeStyle = '#ffd0d8'; g.lineWidth = 2 * k; g.beginPath(); g.arc(x, y, rr - 1 * k, 0, TAU); g.stroke(); continue; }
      // mood ring: the share of the circle is the mood; colour by band
      const mood = Math.max(0, Math.min(100, (e.mood | 0) / FIX));
      g.lineWidth = 2.5 * k;
      g.strokeStyle = 'rgba(30,22,16,0.7)'; g.beginPath(); g.arc(x, y, rr + 1 * k, 0, TAU); g.stroke();
      g.strokeStyle = mood < 25 ? '#e8504a' : mood < 40 ? '#e8b040' : '#7ad06a';
      g.beginPath(); g.arc(x, y, rr + 1 * k, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.04, mood / 100)); g.stroke();
      this.roleGlyph(g, x, y, k, ROLE_GLYPH[e.role && e.role[0]] || 0);
      const jt = e.job && e.job.type;
      if (jt && JOB_COL[jt] !== null) { g.fillStyle = JOB_COL[jt] || '#d8d0c0'; g.strokeStyle = 'rgba(20,14,10,0.9)'; g.lineWidth = 1.2 * k; g.beginPath(); g.arc(x + rr * 0.8, y - rr * 0.8, 4 * k, 0, TAU); g.fill(); g.stroke(); }
      if (e.drafted) { g.fillStyle = '#c83a3a'; g.strokeStyle = '#fff0e0'; g.lineWidth = 1.2 * k; g.beginPath(); g.moveTo(x - rr * 0.8 - 4 * k, y - rr * 0.8 - 4 * k); g.lineTo(x - rr * 0.8 + 4 * k, y - rr * 0.8 - 4 * k); g.lineTo(x - rr * 0.8, y - rr * 0.8 + 5 * k); g.closePath(); g.fill(); g.stroke(); }
    }
    this.pipN = n;
  }
  /** Role glyphs drawn in ink inside the pip: 0 generalist (figure), 1 miner (pick), 2 builder (hammer), 3 crafter (saw), 4 hauler (crate). */
  roleGlyph(g, x, y, k, kind) {
    g.strokeStyle = '#3a2a1a'; g.fillStyle = '#3a2a1a'; g.lineWidth = 2 * k; g.lineCap = 'round';
    g.beginPath();
    if (kind === 1) { g.moveTo(x - 4 * k, y + 5 * k); g.lineTo(x + 3 * k, y - 3 * k); g.moveTo(x - 1 * k, y - 6 * k); g.quadraticCurveTo(x + 5 * k, y - 6 * k, x + 7 * k, y); g.stroke(); }
    else if (kind === 2) { g.moveTo(x - 4 * k, y + 5 * k); g.lineTo(x + 2 * k, y - 2 * k); g.stroke(); g.fillRect(x - 1 * k, y - 7 * k, 8 * k, 5 * k); }
    else if (kind === 3) { g.moveTo(x - 6 * k, y + 2 * k); g.lineTo(x + 6 * k, y - 2 * k); g.lineTo(x + 6 * k, y + 2 * k); g.lineTo(x - 6 * k, y + 4 * k); g.closePath(); g.fill(); g.fillRect(x + 5 * k, y - 4 * k, 3 * k, 8 * k); }
    else if (kind === 4) { g.strokeRect(x - 5 * k, y - 4 * k, 10 * k, 9 * k); g.moveTo(x - 5 * k, y); g.lineTo(x + 5 * k, y); g.stroke(); }
    else { g.arc(x, y - 3 * k, 3 * k, 0, TAU); g.fill(); g.fillRect(x - 4 * k, y + 1.5 * k, 8 * k, 4 * k); }
    g.lineCap = 'butt';
  }
  /** Hit test of the pips drawn last frame (screen CSS px): nearest within the 44 pt hit area. */
  pipAt(sx, sy) {
    const XY = this.pipXY, r = this.cfg.pipHitPt / 2;
    let best = -1, bd = r * r;
    for (let i = 0; i < this.pipN; i++) {
      const dx = XY[i * 4] - sx, dy = XY[i * 4 + 1] - sy, d = dx * dx + dy * dy;
      if (d <= bd) { bd = d; best = i; }
    }
    return best < 0 ? null : { kind: XY[best * 4 + 2] ? 'foe' : 'colonist', id: XY[best * 4 + 3] };
  }
}
