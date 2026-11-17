// The loupe (owner I; doc 10.2): during any tool drag a 120 pt loupe appears 80 pt above the finger
// showing the tiles at 2x with the rectangle edges, and the rectangle size ("6 x 4, 18 tiles") in
// 16 px text. It copies the already-drawn world canvas (so it shows the preview overlay too). When
// the finger is too near the top, the loupe goes beside the finger instead, never under it.
import { h } from './kit.js';
import { SIZES } from './layout.js';

export class Loupe {
  constructor(host) {
    const d = SIZES.loupe;
    this.node = h('div.ec-loupe', { hidden: true, 'aria-hidden': 'true' });
    this.cv = h('canvas.ec-loupe-cv');
    this.label = h('div.ec-loupe-label');
    this.node.append(this.cv, this.label);
    host.append(this.node);
    this.d = d;
    this.dpr = 1;
    this.pos = null;
  }
  show() { this.node.hidden = false; }
  hide() { this.node.hidden = true; this.pos = null; }
  get visible() { return !this.node.hidden; }
  /**
   * Update for a finger at (fx, fy) in page px over `src` (the world canvas, whose CSS rect is
   * `srcRect`). `bounds` is the world rect the loupe must stay inside.
   */
  update(src, srcRect, fx, fy, text, bounds) {
    const d = this.d, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.dpr !== dpr || this.cv.width !== Math.round(d * dpr)) { this.dpr = dpr; this.cv.width = this.cv.height = Math.round(d * dpr); }
    // placement: centred 80 pt above the finger; beside it when that would leave the world rect
    let cx = fx, cy = fy - SIZES.loupeLift - d / 2;
    if (cy - d / 2 < bounds.y + 4) { cy = Math.max(bounds.y + 4 + d / 2, fy - d / 2); cx = fx + (fx < bounds.x + bounds.width / 2 ? 1 : -1) * (SIZES.loupeLift + d / 2 - 20); }
    cx = Math.max(bounds.x + d / 2 + 4, Math.min(bounds.x + bounds.width - d / 2 - 4, cx));
    this.node.style.left = `${Math.round(cx - d / 2)}px`;
    this.node.style.top = `${Math.round(cy - d / 2)}px`;
    this.pos = { x: cx, y: cy, fx, fy };
    // contents: the source pixels around the finger at 2x
    const g = this.cv.getContext('2d');
    const k = src.width / srcRect.width;           // canvas px per CSS px
    const span = d / SIZES.loupeZoom;              // CSS px of world shown across the loupe
    const sx = (fx - srcRect.left - span / 2) * k, sy = (fy - srcRect.top - span / 2) * k;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#17151f'; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.imageSmoothingEnabled = false;
    try { g.drawImage(src, sx, sy, span * k, span * k, 0, 0, this.cv.width, this.cv.height); } catch (_) { /* zero-size source */ }
    // crosshair at the finger point
    const c = this.cv.width / 2, u = dpr;
    g.strokeStyle = 'rgba(255,240,200,0.95)'; g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(c - 10 * u, c); g.lineTo(c - 3 * u, c); g.moveTo(c + 3 * u, c); g.lineTo(c + 10 * u, c);
    g.moveTo(c, c - 10 * u); g.lineTo(c, c - 3 * u); g.moveTo(c, c + 3 * u); g.lineTo(c, c + 10 * u); g.stroke();
    this.label.textContent = text || '';
    this.label.hidden = !text;
  }
}
