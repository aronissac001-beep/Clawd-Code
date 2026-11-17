// Renderer (owner C). Contract C9 (reviewers D, I; provisional until the 1a fun review):
//   new Renderer(canvas)            the frame orchestrator (camera transform, layer order, y-sort)
//   r.resize(w, h, dpr)             CSS px size and device pixel ratio (capped at 2 by the caller)
//   r.setState(s)                   bind a colony; subscribes markDirty to the terrain API (C5)
//   r.draw(s, cam, alpha, dt, ui)   one frame; ui: { press, tapMark } (screen feedback)
//   r.markDirty(tx, ty)             queue a 3 x 3 terrain patch redraw (also called via C5 onRenderDirty)
//   r.setOverlay(name, value)       overlays.js: zones, rooms, preview, stripes, path, chunks
//   registerArt(def, entry)         art key lookup: entry { sprite(scale) -> SP sprite, size } or
//                                   { draw(g, b, ctx), size }; D's js/engine/art/keys.js registers its kit here
//   artFor(b), sizeOf(b)            lookups (fallback: the roguelite sprites)
//   lodOf(zoom) / r.lod / r.onLod(fn)  LOD hooks: { band, bandName, strategic, calm }; fn(lod, prev) on change
//   r.stats()                       counters for the gate (render-check) and the spike
//   r.minimap                       the W x H tile-colour canvas (also the chunk placeholder)
//   r.wantsFast(s)                  true when combat is on screen (loop.js throttle: 60 fps)
// Layer order: terrain chunks > entities (y-sorted) > BUS.draw.world > particles > light texture >
// Hollow rims > pips (strategic) > overlays > BUS.draw.overlay > additive particles > screen feedback.
// Render only: nothing here writes sim state; js/game/ never imports this folder (check-imports).

import { TILE, W, H } from '../../game/core/grid.js';
import { BUS } from '../../game/core/bus.js';
import { onRenderDirty } from '../../game/world/terrain.js';
import { BIOMES } from '../../data/biomes.js';
import * as BALM from '../../data/balance.js';
import { Particles } from '../particles.js';
import * as SP from '../sprites.js';
import { renderConfig } from './config.js';
import { TerrainLayer, bandFor } from './terrain.js';
import { LightLayer, ambientOf } from './light.js';
import { EntityLayer } from './entities.js';
import { OverlayLayer } from './overlays.js';

export { renderConfig, patchRenderConfig, RENDER_DEFAULTS } from './config.js';
export { PLANT } from './entities.js';

const T = TILE;
const VOID = '#17151f';
const DEFAULT_HER = Object.freeze({ field: '#a3242b', charge: '#e8b63c', second: '#2c4f8c', division: 'plain', sigil: 'flame', name: 'Hold' });

// ---- Art key lookup (C9) -----------------------------------------------------------------------
const ART = new Map();
/** Register the art of a structure def (D's kit). entry: { sprite(scale, b) | draw(g, b, ctx), size? }. */
export function registerArt(def, entry) { ART.set(def, entry); }
/** Roguelite art standing in for structure ids until D's kit lands. */
const OLD_ART = { hearth: ['hearth', 3], house: ['house', 1], farm: ['farm', 2], lumber: ['lumber', 2], quarry: ['quarry', 2],
  wall: ['wall', 1], wall_wood: ['wall', 1], wall_stone: ['wall', 1], gate: ['gate', 1], door: ['gate', 1], door_wood: ['gate', 1], door_stone: ['gate', 1], tower: ['tower', 1], brazier: ['brazier', 1], barracks: ['barracks', 2] };
const oldEntries = new Map();
let her = DEFAULT_HER;
export function artFor(b) {
  const e = ART.get(b.def);
  if (e) return e;
  const o = OLD_ART[b.def];
  if (!o) return null;
  let en = oldEntries.get(b.def + ':' + b.lvl);
  if (!en) {
    const lvl = Math.max(0, (b.lvl | 0) - 1);
    en = { key: `b:${o[0]}:${lvl}`, size: o[1], sprite: (scale) => SP.buildingSprite(o[0], lvl, scale, her) };
    oldEntries.set(b.def + ':' + b.lvl, en);
  }
  return en;
}
/** Footprint side in tiles (art entry size, else 1). G's structure data will supply it (size field). */
export function sizeOf(b) { const a = artFor(b); return (a && a.size) || 1; }
const isWallDef = (def) => def === 'wall' || def === 'wall_wood' || def === 'wall_stone' || def === 'door' || def === 'door_wood' || def === 'door_stone' || def === 'gate';

// ---- LOD hooks --------------------------------------------------------------------------------------
export function lodOf(zoom, cfg = renderConfig(), curBand = -1) {
  const band = bandFor(cfg.bands, zoom, curBand, cfg.hysteresis);
  return { band, bandName: cfg.bands[band].name, strategic: zoom < cfg.strategicZoom, calm: zoom < cfg.calmZoom };
}

export class Renderer {
  constructor(canvas, opts = {}) {
    this.cfg = renderConfig(BALM);
    if (opts.cfg) this.cfg = Object.freeze({ ...this.cfg, ...opts.cfg });
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.terrain = new TerrainLayer(this.cfg);
    this.light = new LightLayer(this.cfg);
    this.entities = new EntityLayer(this.cfg);
    this.overlays = new OverlayLayer();
    this.particles = new Particles();
    this.time = 0;
    this.w = 1; this.h = 1; this.dpr = 1;
    this.settings = { reduceMotion: false, colorblind: false, lightSmoothing: this.cfg.lightSmoothing };
    this.lod = null; this.lodFns = [];
    this.unsub = null;
    this.frames = 0; this.frameMs = 0; this.frameMax = 0;
    this.light.isWall = (s, i) => { const id = s.rt.occ ? s.rt.occ[i] : -1; if (id < 0) return false; const b = s.bld[id]; return !!b && b.st === 'done' && isWallDef(b.def) && !b.open; };
    // Per-frame context handed to the layers (reused; no per-frame allocation).
    this.ctx = { scale: 1, alpha: 0, time: 0, pal: null, her: DEFAULT_HER, carve: false, reduceMotion: false, chunkSize: 0,
      artFor, sizeOf, occlude: (x0, y0, x1, y1) => this.occlude(x0, y0, x1, y1) };
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
  }

  setState(s, opts = {}) {
    this.state = s;
    this.pal = BIOMES[opts.biome || s.biome || 'greenvale'] || BIOMES.greenvale;
    her = opts.heraldry || s.heraldry || DEFAULT_HER;
    oldEntries.clear();
    this.ctx.pal = this.pal; this.ctx.her = her;
    this.terrain.setState(s, this.pal);
    this.light.setState(s, { ppt: opts.lightPxPerTile });
    this.entities.setState(s);
    this.particles.clear();
    if (this.unsub) this.unsub();
    this.unsub = onRenderDirty((i) => this.markDirty(i % W, (i / W) | 0));
    this.lod = null;
  }
  dispose() { if (this.unsub) this.unsub(); this.unsub = null; }

  /** C9: queue a terrain patch (3 x 3) and the light texture refresh of the tile. */
  markDirty(tx, ty) {
    this.terrain.markDirty(tx, ty);
    if (tx >= 0 && ty >= 0 && tx < W && ty < H) this.light.markTile(ty * W + tx);
  }
  setOverlay(name, value) { this.overlays.set(name, value); }
  onLod(fn) { this.lodFns.push(fn); return () => { const k = this.lodFns.indexOf(fn); if (k >= 0) this.lodFns.splice(k, 1); }; }
  get minimap() { return this.terrain.minimap; }
  /** Combat on screen (a foe in view): the loop renders at 60 fps. */
  wantsFast(s) {
    if (!s || !s.foes.length || !this.view) return false;
    const v = this.view;
    for (const f of s.foes) if (f.x > v.x0 && f.x < v.x1 && f.y > v.y0 && f.y < v.y1) return true;
    return false;
  }

  /** A sprite drawn over Hollow already queued for the night pass: their rims must not cut through it. */
  occlude(x0, y0, x1, y1) {
    const E = SP.EMIS;
    for (let i = 0; i < E.length; i += SP.EMIS_N) {
      if (E[i + 7]) continue;
      const ex0 = E[i + 2], ey0 = E[i + 3], ex1 = ex0 + E[i + 4], ey1 = ey0 + E[i + 5];
      const ox = Math.min(x1, ex1) - Math.max(x0, ex0), oy = Math.min(y1, ey1) - Math.max(y0, ey0);
      if (ox > 0 && oy > 0 && ox * oy > 0.3 * E[i + 4] * E[i + 5]) E[i + 7] = 1;
    }
  }

  draw(s, cam, alpha = 1, dt = 0, ui = {}) {
    const t0 = performance.now();
    this.time += dt;
    const g = this.g, dpr = this.dpr, z = cam.zoom, cfg = this.cfg, ctx = this.ctx;
    // LOD hooks.
    const lod = lodOf(z, cfg, this.terrain.band);
    if (!this.lod || lod.band !== this.lod.band || lod.strategic !== this.lod.strategic || lod.calm !== this.lod.calm) {
      const prev = this.lod; this.lod = lod;
      for (const fn of this.lodFns) fn(lod, prev);
    }
    ctx.scale = SP.scaleBucket(z * dpr); ctx.alpha = alpha; ctx.time = this.time; ctx.reduceMotion = this.settings.reduceMotion;
    SP.spriteFrame();
    SP.EMIS.length = 0;
    const sky = this.light.ambOverride !== null ? this.light.ambOverride : ambientOf(s.tick);
    ctx.carve = sky < 2.9;
    if (!lod.calm) this.particles.update(dt);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = VOID; g.fillRect(0, 0, this.w, this.h);
    const ox = this.w / 2 - cam.x * z + (cam.sx || 0), oy = this.h / 2 - cam.y * z + (cam.sy || 0);
    g.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr);
    g.imageSmoothingEnabled = true;
    const view = this.view || (this.view = { x0: 0, y0: 0, x1: 0, y1: 0, z: 1 });
    view.x0 = cam.x - this.w / 2 / z; view.x1 = cam.x + this.w / 2 / z;
    view.y0 = cam.y - this.h / 2 / z; view.y1 = cam.y + this.h / 2 / z; view.z = z;
    // 1. terrain
    this.terrain.draw(g, view, z, cam.x, cam.y);
    ctx.chunkSize = cfg.bands[this.terrain.band].chunk * T;
    // 2. entities, y-sorted
    this.entities.draw(g, s, view, ctx);
    for (const f of BUS.draw.world) f(g, s, view, this.time);
    if (!lod.calm) this.particles.draw(g, false, view);
    // 3. light texture (fog, roof darkness, ambient, rt.light), flicker, rims
    this.light.flames = this.entities.flames;
    this.light.update(s);
    this.light.flicker(this.time, cam.x, cam.y, this.settings.reduceMotion);
    this.light.draw(g, view, this.settings.lightSmoothing);
    this.light.drawEmissive(g, view, sky);
    // 4. above the darkness: pips, overlays, plug-ins
    if (lod.strategic) this.entities.drawPips(g, ctx, z);
    this.overlays.draw(g, s, view, ctx);
    for (const f of BUS.draw.overlay) f(g, s, view, this.time);
    if (!lod.calm) { g.globalCompositeOperation = 'lighter'; this.particles.draw(g, true, view); g.globalCompositeOperation = 'source-over'; }
    // 5. screen space
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawScreen(g, cam, ui);
    const ms = performance.now() - t0;
    this.frames++; this.frameMs += (ms - this.frameMs) * 0.1; if (ms > this.frameMax) this.frameMax = ms;
    this.lastMs = ms;
  }

  drawScreen(g, cam, ui) {
    if (ui.press) {
      const p = ui.press, u = Math.min(1, (performance.now() - p.t) / 480);
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
  }

  stats() {
    const t = this.terrain, st = t.st, b = this.cfg.bands;
    const held = {};
    for (let k = 0; k < b.length; k++) held[b[k].name] = t.heldCount(k);
    return {
      band: t.band >= 0 ? b[t.band].name : null, held, heldMB: +(t.heldBytes() / 1048576).toFixed(1),
      bakes: st.bakes, bakeAvgMs: st.bakes ? +(st.bakeMs / st.bakes).toFixed(2) : 0, bakeMaxMs: +st.bakeMax.toFixed(2),
      evictions: st.evictions, released: st.released, patches: st.patches, placeholderRects: st.placeholderRects,
      blankRects: st.blankRects, failedBakes: st.failed, visibleChunks: t.visible || 0,
      light: { full: this.light.st.full, tiles: this.light.st.tiles, lastMs: +this.light.st.lastMs.toFixed(2), ppt: this.light.ppt },
      sprites: { MB: +(SP.spriteMemory() / 1048576).toFixed(1) },
      frames: this.frames, frameMs: +this.frameMs.toFixed(2), frameMaxMs: +this.frameMax.toFixed(2), drawn: this.entities.st.drawn,
    };
  }
}
