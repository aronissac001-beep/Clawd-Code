// 2D camera with clamped pinch-zoom, inertial panning and smooth focus (owner C).
// A tile is 32 world units and zoom 1 is 1 pt per unit (12.4). The map size is live (core/grid.js),
// so the world size is read per call. Zoom range 0.3-2.0 (the three chunk bands, 12.4).
// Render-only state: Math.random in the shake is fine (never read by js/game/).
// Pixel art (docs/ART-STYLE.md): one art pixel is 2 world units, so at zoom z and device pixel ratio
// dpr it covers 2 * z * dpr device px. From RENDER pixelZoomMin (0.5) up, the zoom the renderer uses
// snaps to the nearest step where that is a whole number (dpr 2: 0.5, 0.75, 1, 1.25 ... 2); below it
// (the strategic view) the zoom is continuous and chunks scale smoothly. Pinch and wheel move a
// continuous target (zt), so slow gestures still step; `zoom` is always the snapped value.
import { TILE, W as MW, H as MH } from '../game/core/grid.js';
import { RENDER_DEFAULTS } from './render/config.js';

const worldW = () => MW * TILE, worldH = () => MH * TILE;

export class Camera {
  constructor() {
    this.x = worldW() / 2; this.y = worldH() / 2;
    this.minZoom = RENDER_DEFAULTS.zoomMin; this.maxZoom = RENDER_DEFAULTS.zoomMax;
    this.zt = 1.1; this.z = 1.1; this.pixelMin = RENDER_DEFAULTS.pixelZoomMin || 0.5;
    this.moving = false;                // panned, zoomed or animating this frame (loop.js throttle)
    this.vw = 1; this.vh = 1; this.dpr = 1;
    this.vx = 0; this.vy = 0;          // inertia velocity (world units / s)
    this.focus = null;                  // {x,y,t} smooth pan target
    this.shake = 0; this.sx = 0; this.sy = 0;
  }
  resize(w, h, dpr) { this.vw = w; this.vh = h; this.dpr = dpr; this.z = this.snap(this.zt); this.clamp(); }
  get scale() { return this.zoom; }
  /** The zoom the view uses: snapped to whole device px per art pixel at or above pixelMin. */
  get zoom() { return this.z; }
  set zoom(v) { this.zt = Math.max(this.minZoom, Math.min(this.maxZoom, v)); this.z = this.snap(this.zt); }
  /** The nearest pixel-perfect zoom to z (z itself below pixelMin). */
  snap(z) {
    if (z < this.pixelMin) return z;
    const k = 2 * (this.dpr || 1), s = Math.round(z * k) / k;
    return Math.max(this.pixelMin, Math.min(this.maxZoom, s));
  }
  // Level of detail used by the renderer: 0 far, 1 normal, 2 close.
  get lod() { return this.zoom < 0.7 ? 0 : this.zoom > 1.5 ? 2 : 1; }
  worldToScreen(wx, wy) { return { x: (wx - this.x) * this.zoom + this.vw / 2, y: (wy - this.y) * this.zoom + this.vh / 2 }; }
  screenToWorld(sx, sy) { return { x: (sx - this.vw / 2) / this.zoom + this.x, y: (sy - this.vh / 2) / this.zoom + this.y }; }
  panBy(dsx, dsy) { this.x -= dsx / this.zoom; this.y -= dsy / this.zoom; this.focus = null; this.moving = true; this.clamp(); }
  /** Set the zoom directly (clamped), keeping the centre. */
  setZoom(z) { this.zoom = z; this.moving = true; this.clamp(); }
  zoomAt(factor, sx, sy) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = this.zt * factor;
    this.moving = true;
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x; this.y += before.y - after.y;
    this.clamp();
  }
  centerOn(x, y, smooth = true) {
    if (smooth) this.focus = { x, y };
    else { this.x = x; this.y = y; this.clamp(); }
  }
  addShake(a) { this.shake = Math.min(14, this.shake + a); }
  update(dt) {
    const wx = this.x, wy = this.y;
    if (this.focus) {
      const k = 1 - Math.pow(0.0008, dt);
      this.x += (this.focus.x - this.x) * k; this.y += (this.focus.y - this.y) * k;
      if (Math.hypot(this.focus.x - this.x, this.focus.y - this.y) < 1) this.focus = null;
      this.clamp();
    } else if (this.vx || this.vy) {
      this.x += this.vx * dt; this.y += this.vy * dt;
      const damp = Math.pow(0.02, dt);
      this.vx *= damp; this.vy *= damp;
      if (Math.hypot(this.vx, this.vy) < 4) { this.vx = 0; this.vy = 0; }
      this.clamp();
    }
    if (this.shake > 0) {
      this.sx = (Math.random() * 2 - 1) * this.shake; this.sy = (Math.random() * 2 - 1) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 30);
    } else { this.sx = 0; this.sy = 0; }
    if (this.x !== wx || this.y !== wy || this.shake > 0) this.moving = true;
  }
  /** True when the view moved since the last call (then resets): the loop renders at 60 fps. */
  takeMoving() { const m = this.moving; this.moving = false; return m; }
  clamp() {
    // Allow a margin past the map edge so edge tiles can sit mid-screen above the HUD.
    const m = 160;
    const hw = this.vw / 2 / this.zoom, hh = this.vh / 2 / this.zoom;
    const WW = worldW(), WH = worldH();
    const minX = Math.min(hw - m, WW / 2), maxX = Math.max(WW - hw + m, WW / 2);
    const minY = Math.min(hh - m, WH / 2), maxY = Math.max(WH - hh + m, WH / 2);
    this.x = Math.max(minX, Math.min(maxX, this.x));
    this.y = Math.max(minY, Math.min(maxY, this.y));
  }
}
