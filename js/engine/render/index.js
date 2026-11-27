// Renderer (owner C). Contract C9 (reviewers D, I; provisional until the 1a fun review):
//   new Renderer(canvas)            the frame orchestrator (camera transform, layer order, y-sort)
//   r.resize(w, h, dpr)             CSS px size and device pixel ratio (capped at 2 by the caller)
//   r.setState(s)                   bind a colony; subscribes markDirty to the terrain API (C5)
//   r.draw(s, cam, alpha, dt, ui)   one frame; ui: { press, tapMark } (screen feedback)
//   r.markDirty(tx, ty)             queue a 3 x 3 terrain patch redraw (also called via C5 onRenderDirty)
//   r.setOverlay(name, value)       overlays.js: zones, rooms, preview, stripes, path, chunks
//   registerArt(key, entry)         art key lookup: key is a structure def's `art` key ('struct.wall') or its
//                                   id; entry { sprite(scale, b) -> SP sprite } or { draw(g, b, ctx) };
//                                   D's js/engine/art/keys.js registers its kit here. Without an entry a
//                                   structure draws its kit.js stand-in (old roguelite art for the Hearth)
//   registerTileArt(kind, fn)       baked tile painters ('rock', 'floor', 'rough'; terrain.js header)
//   artFor(b), footOf(b), sizeOf(b) lookups: footOf -> [w, h] tiles after rotation (data size), sizeOf -> w
//   lodOf(zoom) / r.lod / r.onLod(fn)  LOD hooks: { band, bandName, strategic, calm }; fn(lod, prev) on change
//   r.pipAt(sx, sy)                 strategic view: the colonist (or foe) whose pip's 44 pt hit area holds
//                                   the screen point (CSS px), else null: { kind: 'colonist'|'foe', id }
//   r.stats()                       counters for the gate (render-check) and the spike
//   r.minimap                       the W x H tile-colour canvas (also the chunk placeholder)
//   r.drawMinimap(canvas, opts)     the minimap: tile colours, fog, colonists (refreshed every 2 s) and
//                                   the view rectangle, scaled into canvas (minimap.js)
//   r.wantsFast(s)                  true when combat is on screen (a foe or projectile in view; loop.js throttle: 60 fps)
//   r.threat                        threat.js: the edge marker and route preview from H's threatViews (9.4)
//   r.weather                       weather.js (Stage 2): fire and smoke on burning tiles, rain and snow, the
//                                   cold snap and drought cast; the season palette is painted into the chunks
//                                   (terrain.js setSeason, from the calendar)
//   r.setViewLevel(z)               the one level drawn on a D > 1 map (Stage Z1 E6; doc 6.3): the terrain, light,
//                                   entities, weather, overlays and minimap all show level z. The camera's
//                                   `level` (UI memory, js/engine/camera.js) is followed each frame, so the UI may
//                                   set cam.setLevel(z) instead. A D = 1 map is always level 0.
//   r.viewZ                         the view level; r.levelInfo() { z, rel, band, ready } for the UI (E7)
//   r.drawZStrip(canvas, opts)      the minimap's z-strip (4.5): one row per level, the view level lit, warm
//                                   ticks for colonists and red for hostiles on each level
//   r.settings.batterySaver         set by the UI from the setting: no idle pre-bake (6.3)
// Layer order: terrain chunks (season palette) > entities (y-sorted) > BUS.draw.world > fire and smoke > particles > light texture >
// Hollow rims > over-dark bars > rain, snow and weather cast > pips and raid blobs (strategic) > overlays > threat warnings (edge marker,
// route preview) > BUS.draw.overlay > additive particles > screen feedback.
// Render only: nothing here writes sim state; js/game/ never imports this folder (check-imports).

import { TILE, W, H, D, PLANE, zS } from '../../game/core/grid.js';
import { BUS } from '../../game/core/bus.js';
import { structDef, sizeOf as defSize } from '../../game/core/content.js';
import { onRenderDirty } from '../../game/world/terrain.js';
import { BIOMES } from '../../data/biomes.js';
import * as BALM from '../../data/balance.js';
import { Particles } from '../particles.js';
import * as SP from '../sprites.js';
import { renderConfig } from './config.js';
import { TerrainLayer, bandFor, registerTileArt, setGroundArt } from './terrain.js';
import { Minimap } from './minimap.js';
import { LevelViews } from './levelview.js';
import { bandOfLevel } from '../art/vertical.js';
import { LightLayer, ambientOf } from './light.js';
import { EntityLayer } from './entities.js';
import { OverlayLayer } from './overlays.js';
import { ThreatLayer } from './threat.js';
import { WeatherLayer } from './weather.js';
import { seasonOf } from '../../game/core/time.js';
import { installColonySounds } from '../audio.js';

export { renderConfig, patchRenderConfig, RENDER_DEFAULTS } from './config.js';
export { PLANT } from './entities.js';
export { registerTileArt };

const T = TILE;
const VOID = '#17151f';
const DEFAULT_HER = Object.freeze({ field: '#a3242b', charge: '#e8b63c', second: '#2c4f8c', division: 'plain', sigil: 'flame', name: 'Hold' });

// ---- Art key lookup (C9) -----------------------------------------------------------------------
const ART = new Map();
/** Register the art of a structure (D's kit) by art key ('struct.bed') or def id. entry: { sprite(scale, b) | draw(g, b, ctx) }; null removes. */
export function registerArt(key, entry) { if (entry) ART.set(key, entry); else ART.delete(key); }
/** Roguelite art standing in for the Hearth (and the old ids of the flat debug scene) until D's kit lands. */
const OLD_ART = { hearth: ['hearth', 3], house: ['house', 1], farm: ['farm', 2], lumber: ['lumber', 2], quarry: ['quarry', 2],
  gate: ['gate', 1], tower: ['tower', 1], brazier: ['brazier', 1], barracks: ['barracks', 2] };
const oldEntries = new Map();
let her = DEFAULT_HER;
/** The registered art of b, or the roguelite stand-in, or null (then entities.js draws kit.js). */
export function artFor(b) {
  const d = structDef(b.def);
  const e = (d && d.art && ART.get(d.art)) || ART.get(b.def);
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
// ---- D's art kit (js/engine/art/index.js), installed when it loads -------------------------------
// Until it loads (or if it fails to), every structure, tile, item, colonist, pip and mark draws its
// kit.js / roguelite stand-in. Loading is a dynamic import so a broken kit never blanks the game.
let KIT = null, kitLoad = null;
const kitUsers = new Set();
/** D's kit module once installed, else null (entities.js and overlays.js read it per frame). */
export function artKit() { return KIT; }
/** Install a kit module: its installKit(registerArt, registerTileArt, { state }) and its item, colonist, pip and mark drawers. */
export function useArtKit(mod) {
  KIT = mod || null;
  setGroundArt(KIT && KIT.GROUND_ART ? KIT.GROUND_ART : null);
  if (KIT && typeof KIT.installKit === 'function') {
    try { KIT.installKit(registerArt, registerTileArt, { state: () => kitState }); } catch (e) { console.warn('art kit install failed; stand-ins in use:', e && e.message); KIT = null; }
  }
  FOOT.clear();
  for (const r of kitUsers) r.onArt();
  return KIT;
}
let kitState = null;
function loadKit() {
  if (!kitLoad) kitLoad = import('../art/index.js').then((m) => useArtKit(m)).catch((e) => { console.warn('art kit not loaded; stand-ins in use:', e && e.message); return null; });
  return kitLoad;
}
/** Resolves when the kit is installed (or failed): tests and the bench wait on it. */
export const artKitReady = () => loadKit();

const FOOT = new Map();
/** Footprint [w, h] in tiles after rotation: the def's data size, else the old art's square size, else 1 x 1. Cached (no allocation per call). */
export function footOf(b) {
  const rot = b.rot & 3, k = b.def + (rot & 1 ? '|1' : '|0');
  let f = FOOT.get(k);
  if (!f) {
    const d = structDef(b.def);
    if (d && d.size) f = defSize(d, rot);
    else { const o = OLD_ART[b.def]; f = o ? [o[1], o[1]] : [1, 1]; }
    FOOT.set(k, f);
  }
  return f;
}
/** Footprint width in tiles (kept for older callers; use footOf for [w, h]). */
export function sizeOf(b) { return footOf(b)[0]; }

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
    this.threat = new ThreatLayer(this.cfg);
    this.weather = new WeatherLayer();
    this.particles = new Particles();
    this.time = 0;
    this.w = 1; this.h = 1; this.dpr = 1;
    this.settings = { reduceMotion: false, colorblind: false, batterySaver: false, lightSmoothing: this.cfg.pixelLight ? false : this.cfg.lightSmoothing };
    // levels (D > 1): the view level, its views, the stillness clock of the idle pre-bake
    this.levels = new LevelViews(); this.d3 = false; this.viewZ = 0; this.levelT = -1e9;
    this.lights = new Map();   // D > 1: light textures of the view level and the pre-built z +- 1 (6.3)
    this.still = 0; this.lastCam = [NaN, NaN, NaN]; this.lastTick = -1; this.tickStill = 0;
    this.lod = null; this.lodFns = [];
    this.unsub = null;
    this.frames = 0; this.frameMs = 0; this.frameMax = 0;
    this.mini = new Minimap(this.terrain);
    kitUsers.add(this);
    if (!KIT && opts.kit !== false) loadKit();
    this.levelOf = (i) => (this.light.lv ? this.light.lv[i] : 3);
    // Per-frame context handed to the layers (reused; no per-frame allocation).
    this.ctx = { state: null, kit: null, scale: 1, alpha: 0, time: 0, pal: null, her: DEFAULT_HER, carve: false, reduceMotion: false, chunkSize: 0, pixel: true, select: null, dpr: 1,
      artFor, sizeOf, footOf, occlude: (x0, y0, x1, y1) => this.occlude(x0, y0, x1, y1) };
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
  }

  setState(s, opts = {}) {
    this.state = s; kitState = s;
    this.pal = BIOMES[opts.biome || s.biome || 'greenvale'] || BIOMES.greenvale;
    her = opts.heraldry || s.heraldry || DEFAULT_HER;
    oldEntries.clear(); FOOT.clear();
    this.ctx.pal = this.pal; this.ctx.her = her;
    this.d3 = D > 1;
    this.levels.setState(s);
    this.viewZ = this.d3 ? Math.max(0, Math.min(D - 1, opts.level !== undefined ? opts.level | 0 : zS)) : 0;
    const vs = this.d3 ? this.levels.get(this.viewZ) : s;
    this.terrain.setState(s, this.pal, seasonOf(s.tick), this.d3 ? this.levels : null, this.viewZ);
    this.weather.setState(vs);
    this.light.setState(vs, { ppt: opts.lightPxPerTile });
    for (const l of this.lights.values()) if (l !== this.light) freeLight(l);
    this.lights.clear();
    if (this.d3) this.lights.set(this.viewZ, this.light);
    this.entities.setState(s);
    this.threat.setState(s);
    this.mini.setState(s);
    if (opts.sounds !== false) installColonySounds(this);
    this.particles.clear();
    if (this.unsub) this.unsub();
    this.unsub = onRenderDirty(this.d3 ? (i) => this.markVoxel(i) : (i) => this.markDirty(i % W, (i / W) | 0));
    this.lod = null;
  }
  dispose() { if (this.unsub) this.unsub(); this.unsub = null; kitUsers.delete(this); }
  /** New art installed: held chunks rebake with it (the placeholder covers them meanwhile). */
  onArt() { this.terrain.rebakeAll(); }

  /** D > 1: a write at voxel i (the terrain API sink): patches z and its neighbours; light and weather if on the view level. */
  markVoxel(i) {
    this.levels.touch(i);
    this.terrain.markVoxel(i);
    const p = i - this.viewZ * PLANE;
    if (p >= 0 && p < PLANE) { this.light.markTile(p); this.weather.markTile(p); }
  }
  /**
   * Show level z (D > 1; clamped). The terrain switches at once (held chunks, else the level's placeholder),
   * the light texture rebuilds for the level, and the change counts as motion for 0.5 s (6.3 Battery).
   */
  setViewLevel(z) {
    if (!this.d3) return false;
    z = Math.max(0, Math.min(D - 1, z | 0));
    if (z === this.viewZ) return false;
    const t0 = performance.now();
    this.viewZ = z;
    this.terrain.setLevel(z);
    const t1 = performance.now();
    const vs = this.levels.get(z);
    const t2 = performance.now();
    // the light texture: the one pre-built for z (it catches up by its own per-tick diff), else rebuilt
    const amb = this.light.ambOverride;
    let lt = this.lights.get(z);
    if (lt) { this.lights.delete(z); this.lights.set(z, lt); }
    else { lt = this.spareLight(z); lt.setState(vs, { ppt: this.light.ppt }); this.lights.set(z, lt); }
    if (lt.ambOverride !== amb) lt.setAmbient(amb);
    this.light = lt;
    this.trimLights();
    this.weather.setState(vs);
    this.mini.setState(this.state);
    this.levelT = performance.now();
    const sw = this.switchMs || (this.switchMs = { n: 0, terrain: 0, view: 0, rest: 0, max: 0 });
    sw.n++; sw.terrain += t1 - t0; sw.view += t2 - t1; sw.rest += this.levelT - t2; if (this.levelT - t0 > sw.max) sw.max = this.levelT - t0;
    this.still = 0;
    return true;
  }
  /** A light layer for level z: one no longer next to the view level, else a new one. */
  spareLight(z) {
    for (const [k, l] of this.lights) if (Math.abs(k - z) > 1 && Math.abs(k - this.viewZ) > 1 && l !== this.light) { this.lights.delete(k); return l; }
    return new LightLayer(this.cfg);
  }
  /** Keep the light textures of z - 1, z and z + 1 only (each W x H x 64 px: 4 MB of canvas plus its pixels). */
  trimLights() {
    for (const [k, l] of this.lights) if (Math.abs(k - this.viewZ) > 1) { freeLight(l); this.lights.delete(k); }
  }
  /** Idle pre-build of the light texture of z - 1 or z + 1 (one per still frame, after the chunk pre-bake did nothing this frame). */
  preBuildLight(s) {
    for (const zz of [this.viewZ - 1, this.viewZ + 1]) {
      if (zz < 0 || zz >= D || this.lights.has(zz)) continue;
      const v = this.levels.get(zz), lt = this.spareLight(zz);
      lt.setState(v, { ppt: this.light.ppt });
      if (this.light.ambOverride !== null) lt.setAmbient(this.light.ambOverride);
      lt.update(v);
      this.lights.set(zz, lt);
      this.lightPrebuilds = (this.lightPrebuilds || 0) + 1;
      return true;
    }
    return false;
  }
  /** Bytes of the held light textures (canvas plus its image data). */
  lightBytes() { let n = 0; for (const l of (this.d3 ? this.lights.values() : [this.light])) if (l.c) n += l.c.width * l.c.height * 8; return n; }
  /** For the UI (E7): the view level, its relative level, its band row and whether its visible chunks are all held. */
  levelInfo() {
    const z = this.viewZ, rel = z - zS;
    return { z, rel: this.d3 ? rel : 0, band: this.d3 ? bandOfLevel(rel) : null, ready: this.view ? this.terrain.readyAt(z, this.view) : false };
  }
  /** The z-strip beside the minimap (4.5): see Minimap.drawZStrip. */
  drawZStrip(canvas, opts) { return this.mini.drawZStrip(canvas, this.state, this.viewZ, this.time, opts); }
  /** C9: queue a terrain patch (3 x 3) and the light texture refresh of the tile. */
  markDirty(tx, ty) {
    this.terrain.markDirty(tx, ty);
    if (tx >= 0 && ty >= 0 && tx < W && ty < H) { this.light.markTile(ty * W + tx); this.weather.markTile(ty * W + tx); }
  }
  /** Overlays (overlays.js); 'select' { kind: 'colonist', id } | null draws the pixel selection ring under that colonist. */
  setOverlay(name, value) { if (name === 'select') this.ctx.select = value || null; else this.overlays.set(name, value); }
  onLod(fn) { this.lodFns.push(fn); return () => { const k = this.lodFns.indexOf(fn); if (k >= 0) this.lodFns.splice(k, 1); }; }
  get minimap() { return this.terrain.minimap; }
  /** Draw the minimap into canvas (its own pixel size): tiles, fog, colonists every 2 s, the view rect. opts: { view: true, force: false }. */
  drawMinimap(canvas, opts) { return this.mini.draw(canvas, this.d3 ? this.levels.get(this.viewZ) : this.state, this.view, this.time, opts, this.d3 && this.viewZ !== zS ? null : this.threat.edges); }
  /** Strategic view hit test (screen CSS px): { kind, id } of the pip under the point within its 44 pt hit area, nearest first; else null. */
  pipAt(sx, sy) { return this.entities.pipAt(sx, sy); }
  /**
   * Combat on screen (doc 12.4 "a hostile or a projectile in view"): a foe (or a projectile, when the
   * sim has them) inside the view, with a margin of two tiles so a hostile stepping in starts at 60.
   * The loop renders at 60 fps then; paused, fpsTarget keeps the paused rate (nothing moves).
   */
  wantsFast(s) {
    if (!s || !this.view) return false;
    const v = this.view, m = 2 * T;
    const lz = this.d3 ? this.viewZ : -1;
    if (s.foes && s.foes.length) for (const f of s.foes) if ((lz < 0 || (f.z | 0) === lz) && f.x > v.x0 - m && f.x < v.x1 + m && f.y > v.y0 - m && f.y < v.y1 + m) return true;
    const pr = s.proj;
    if (pr && pr.length) for (const p of pr) if (p && (lz < 0 || (p.z | 0) === lz) && p.x > v.x0 && p.x < v.x1 && p.y > v.y0 && p.y < v.y1) return true;
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
    // levels (D > 1): follow the camera's level, then draw from the view level's level view
    const real = s;
    if (this.d3) {
      if (typeof cam.level === 'number' && cam.level !== this.viewZ) this.setViewLevel(cam.level);
      this.preBakeGate(s, cam, dt, ui);
      if (t0 - this.levelT < 500) cam.moving = true;   // a level change counts as motion for 0.5 s
      s = this.levels.get(this.viewZ);
    }
    const g = this.g, dpr = this.dpr, z = cam.zoom, cfg = this.cfg, ctx = this.ctx;
    // LOD hooks.
    const lod = lodOf(z, cfg, this.terrain.band);
    if (!this.lod || lod.band !== this.lod.band || lod.strategic !== this.lod.strategic || lod.calm !== this.lod.calm) {
      const prev = this.lod; this.lod = lod;
      for (const fn of this.lodFns) fn(lod, prev);
    }
    ctx.state = s; ctx.kit = KIT; ctx.lvl = this.d3 ? this.viewZ : -1;
    ctx.scale = SP.scaleBucket(z * dpr); ctx.dpr = dpr; ctx.alpha = alpha; ctx.time = this.time; ctx.reduceMotion = this.settings.reduceMotion;
    SP.spriteFrame();
    SP.EMIS.length = 0;
    const sky = this.light.ambOverride !== null ? this.light.ambOverride : ambientOf(s.tick);
    ctx.carve = sky < 2.9;
    this.particles.reduced = !!this.settings.reduceMotion;
    if (!lod.calm) this.particles.update(dt);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = VOID; g.fillRect(0, 0, this.w, this.h);
    // Pixel art: the world origin lands on a whole device pixel, and at a pixel-perfect zoom (one art
    // pixel = a whole number of device px, camera.js) everything draws with smoothing off; below the
    // pixel zoom (the strategic view) chunks and sprites scale smoothly instead.
    const oxd = Math.round((this.w / 2 - cam.x * z + (cam.sx || 0)) * dpr), oyd = Math.round((this.h / 2 - cam.y * z + (cam.sy || 0)) * dpr);
    const ox = oxd / dpr, oy = oyd / dpr;
    g.setTransform(z * dpr, 0, 0, z * dpr, oxd, oyd);
    const kpx = 2 * z * dpr;
    this.pixelPerfect = Math.abs(kpx - Math.round(kpx)) < 0.01;
    g.imageSmoothingEnabled = !this.pixelPerfect;
    ctx.pixel = this.pixelPerfect;
    const view = this.view || (this.view = { x0: 0, y0: 0, x1: 0, y1: 0, z: 1 });
    view.x0 = cam.x - this.w / 2 / z; view.x1 = cam.x + this.w / 2 / z;
    view.y0 = cam.y - this.h / 2 / z; view.y1 = cam.y + this.h / 2 / z; view.z = z;
    // 1. terrain (and the water shimmer over it)
    this.terrain.time = this.time; this.terrain.calm = lod.strategic || this.settings.reduceMotion;
    this.terrain.setSeason(seasonOf(s.tick));
    this.bakes0 = this.terrain.st.bakes;
    this.terrain.draw(g, view, z, cam.x, cam.y);
    g.imageSmoothingEnabled = !this.pixelPerfect;
    ctx.chunkSize = cfg.bands[this.terrain.band].chunk * T;
    // 2. entities, y-sorted
    this.entities.draw(g, s, view, ctx);
    for (const f of BUS.draw.world) f(g, real, view, this.time);
    // Stage 2: fire and smoke on burning tiles (their light is the sim's, in the light texture)
    ctx.lowDetail = lod.calm;
    this.weather.update(s, this.time);
    this.weather.drawFire(g, s, view, ctx);
    this.weather.fireFlames(this.entities.flames);
    if (!lod.calm) this.particles.draw(g, false, view);
    // 3. light texture (fog, roof darkness, ambient, rt.light), flicker, rims
    this.light.flames = this.entities.flames;
    this.light.update(s);
    if (this.d3 && this.terrain.prebake && !this.terrain.scrubbing() && this.terrain.st.bakes === this.bakes0) this.preBuildLight(s);
    this.light.flicker(this.time, cam.x, cam.y, this.settings.reduceMotion);
    this.light.draw(g, view, this.settings.lightSmoothing);
    g.imageSmoothingEnabled = !this.pixelPerfect;
    if (!lod.strategic) this.entities.drawOverDark(g, this.levelOf);
    this.light.drawEmissive(g, view, sky);
    this.weather.drawSky(g, s, view, ctx);
    this.weather.drawRumble(g, s, view, ctx);
    // 4. above the darkness: pips, overlays, plug-ins
    if (lod.strategic) this.entities.drawPips(g, ctx, z, ox, oy); else { this.entities.pipN = 0; this.entities.blobN = 0; }
    this.overlays.draw(g, s, view, ctx);
    this.threat.update(real);
    this.threat.draw(g, view, ctx, z, ox, oy, dpr);
    for (const f of BUS.draw.overlay) f(g, real, view, this.time);
    if (!lod.calm) { g.globalCompositeOperation = 'lighter'; this.particles.draw(g, true, view); g.globalCompositeOperation = 'source-over'; }
    // 5. screen space
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawScreen(g, cam, ui);
    const ms = performance.now() - t0;
    this.frames++; this.frameMs += (ms - this.frameMs) * 0.1; if (ms > this.frameMax) this.frameMax = ms;
    this.lastMs = ms;
  }

  /**
   * The idle pre-bake gate (6.3): on while the camera and the level are still, for at most 3 s of stillness;
   * never under Battery saver (settings.batterySaver or ui.saver) and never while paused and still (ui.paused,
   * else the tick standing for 0.5 s).
   */
  preBakeGate(s, cam, dt, ui) {
    const L = this.lastCam, moved = cam.x !== L[0] || cam.y !== L[1] || cam.zoom !== L[2];
    L[0] = cam.x; L[1] = cam.y; L[2] = cam.zoom;
    if (moved) this.still = 0; else this.still += dt;
    if (s.tick !== this.lastTick) { this.lastTick = s.tick; this.tickStill = 0; } else this.tickStill += dt;
    const paused = ui.paused !== undefined ? !!ui.paused : this.tickStill > 0.5;
    const saver = !!(this.settings.batterySaver || ui.saver);
    this.terrain.prebake = !moved && !saver && !paused && this.still < 3;
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
      evictions: st.evictions, released: st.released, patches: st.patches, patchSkips: st.patchSkips, patchAvgMs: st.patches ? +(st.patchMs / st.patches).toFixed(3) : 0, placeholderRects: st.placeholderRects,
      blankRects: st.blankRects, failedBakes: st.failed, visibleChunks: t.visible || 0,
      light: { full: this.light.st.full, tiles: this.light.st.tiles, lastMs: +this.light.st.lastMs.toFixed(2), fullMs: +this.light.st.fullMs.toFixed(2), ppt: this.light.ppt },
      weather: { kind: this.weather.kind, fires: this.weather.st.fires, puffs: this.weather.st.puffs, drops: this.weather.st.drops, season: this.terrain.season },
      pips: this.entities.pipN, blobs: this.entities.blobN, threat: { views: this.threat.views.length, edges: this.threat.edges.length, routeTiles: this.threat.st.routeTiles },
      sprites: { MB: +(SP.spriteMemory() / 1048576).toFixed(1) },
      level: this.d3 ? { z: this.viewZ, rel: this.viewZ - zS, byLevel: t.heldByLevel(), phBuilds: st.phBuilds, phAvgMs: st.phBuilds ? +(st.phMs / st.phBuilds).toFixed(2) : 0, prebakes: st.prebakes,
        uniformRects: st.uniformRects, light: { fullMs: +this.light.st.fullMs.toFixed(2), held: [...this.lights.keys()], MB: +(this.lightBytes() / 1048576).toFixed(1), prebuilds: this.lightPrebuilds || 0 }, switchMs: this.switchMs ? { n: this.switchMs.n, terrain: +(this.switchMs.terrain / this.switchMs.n).toFixed(2), view: +(this.switchMs.view / this.switchMs.n).toFixed(2), rest: +(this.switchMs.rest / this.switchMs.n).toFixed(2), max: +this.switchMs.max.toFixed(2) } : null, scrubFrames: st.scrubFrames, switches: st.levelSwitches, missing: st.missing, prebake: t.prebake, views: this.levels.builds } : null,
      frames: this.frames, frameMs: +this.frameMs.toFixed(2), frameMaxMs: +this.frameMax.toFixed(2), drawn: this.entities.st.drawn,
    };
  }
}

// Debug scenes (?debug=1&scene=flat|spike-map|tunnels|art, scenes.js). js/main.js (owner A) does not
// dispatch them, and js/ui/app.js stands aside when a scene is named, so the renderer boots it.
// Browser only (no location in Node): check-imports sees no side effect.
if (typeof location !== 'undefined' && typeof document !== 'undefined') {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has('debug') && q.get('scene')) import('./scenes.js').then((m) => m.bootScene(q.get('scene'), q)).catch((e) => console.error('scene failed:', e && e.message));
  } catch (_) { /* no URL API */ }
}

/** Free a light layer's canvas (iOS frees canvas memory reliably only at size 0). */
function freeLight(l) { if (l && l.c) { l.c.width = l.c.height = 0; l.img = null; l.px = null; } }
