// Minimap (owner C; doc 12.4 "Minimap"): the W x H tile-colour texture (terrain.js, which is also the
// chunk placeholder and is patched per dirty tile) with unexplored tiles darkened, colonists drawn
// over it every 2 s (render time), and the view rectangle drawn every call. One W x H composite
// canvas; drawing it into the UI's canvas is one scaled drawImage plus a few dots and a rectangle.
//   r.drawMinimap(canvas, { view = true, force = false, colonists = true })   (hostiles: red squares; the
//   threat edge marker: a red wedge on the border from the Omen on, from render/threat.js)
// The UI (I) owns the DOM canvas and its size; tap-to-pan maps canvas px to world with
// world = px / canvas.width * W * TILE (the composite covers the whole map, no margins).
// Render only: never read by js/game/. Nothing allocates at import.

import { TILE, W, H, getBit } from '../../game/core/grid.js';
import { PAL } from '../art/palette.js';

const FOG_RGB = [23, 21, 31];
const REFRESH = 2; // seconds of render time between composite and colonist refreshes

export class Minimap {
  constructor(terrain) {
    this.terrain = terrain;
    this.c = null; this.g = null; this.img = null;
    this.s = null;
    this.next = 0; this.ver = -1; this.fogSum = -1;
    this.dots = new Float32Array(2 * 64); this.nDots = 0; this.nFoes = 0;
    this.st = { builds: 0, lastMs: 0 };
  }
  setState(s) { this.s = s; this.next = 0; this.ver = -1; this.fogSum = -1; }

  /** Rebuild the composite from the tile-colour texture and the fog bits (about 0.2 ms at 128). */
  build(s) {
    const t0 = performance.now();
    const T = this.terrain;
    if (!T.phImg) return;
    if (!this.c) { this.c = document.createElement('canvas'); this.g = this.c.getContext('2d'); }
    if (this.c.width !== W || this.c.height !== H) { this.c.width = W; this.c.height = H; this.img = null; }
    if (!this.img) this.img = this.g.createImageData(W, H);
    const src = T.phImg.data, d = this.img.data, fog = s.L.fog;
    for (let i = 0, o = 0; i < W * H; i++, o += 4) {
      if (getBit(fog, i)) { d[o] = src[o]; d[o + 1] = src[o + 1]; d[o + 2] = src[o + 2]; }
      else { d[o] = (src[o] * 0.12 + FOG_RGB[0] * 0.88) | 0; d[o + 1] = (src[o + 1] * 0.12 + FOG_RGB[1] * 0.88) | 0; d[o + 2] = (src[o + 2] * 0.12 + FOG_RGB[2] * 0.88) | 0; }
      d[o + 3] = 255;
    }
    this.g.putImageData(this.img, 0, 0);
    this.ver = T.phVer;
    this.st.builds++; this.st.lastMs = performance.now() - t0;
  }
  /** Colonist positions (tile units), refreshed with the composite. */
  sampleColonists(s) {
    const n = s.col.length, nf = s.foes ? s.foes.length : 0;
    if (this.dots.length < (n + nf) * 2) this.dots = new Float32Array((n + nf) * 2 + 32);
    for (let k = 0; k < n; k++) { this.dots[k * 2] = s.col[k].x / TILE; this.dots[k * 2 + 1] = s.col[k].y / TILE; }
    for (let k = 0; k < nf; k++) { this.dots[(n + k) * 2] = s.foes[k].x / TILE; this.dots[(n + k) * 2 + 1] = s.foes[k].y / TILE; }
    this.nDots = n; this.nFoes = nf;
  }

  /** Draw into canvas (its own pixel size). time: render time in seconds (the renderer's clock). */
  draw(canvas, s, view, time = 0, opts = {}, edges = null) {
    if (!s || !canvas) return false;
    if (opts.force || time >= this.next || !this.c) {
      this.next = time + REFRESH;
      if (opts.force || !this.c || this.ver !== this.terrain.phVer || this.fogChanged(s)) this.build(s);
      this.sampleColonists(s);
    }
    if (!this.c) return false;
    const g = canvas.getContext('2d'), cw = canvas.width, ch = canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.c, 0, 0, cw, ch);
    const kx = cw / W, ky = ch / H;
    if (opts.colonists !== false && this.nDots) {
      const r = Math.max(2, Math.min(kx, ky) * 1.4);
      g.fillStyle = PAL.flame; g.strokeStyle = PAL.ink; g.lineWidth = Math.max(1, r * 0.4);
      for (let k = 0; k < this.nDots; k++) {
        g.beginPath(); g.arc(this.dots[k * 2] * kx, this.dots[k * 2 + 1] * ky, r, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
    if (opts.colonists !== false && this.nFoes) { // hostiles: red squares (sampled with the colonists)
      const r = Math.max(2, Math.min(kx, ky) * 1.3);
      g.fillStyle = PAL.danger;
      for (let k = this.nDots; k < this.nDots + this.nFoes; k++) g.fillRect(this.dots[k * 2] * kx - r, this.dots[k * 2 + 1] * ky - r, r * 2, r * 2);
    }
    if (edges && edges.length) { // the threat edge marker (9.4 Omen): a red wedge on the map border, pointing in
      const a = Math.max(5, Math.min(cw, ch) / 14);
      for (const e of edges) {
        const x = (e.x + 0.5) * kx, y = (e.y + 0.5) * ky;
        const dx = e.side === 'w' ? 1 : e.side === 'e' ? -1 : 0, dy = e.side === 'n' ? 1 : e.side === 's' ? -1 : 0;
        const bx = Math.max(a / 2, Math.min(cw - a / 2, x)), by = Math.max(a / 2, Math.min(ch - a / 2, y));
        const tx = bx + dx * a, ty = by + dy * a, px = -dy * a * 0.6, py = dx * a * 0.6;
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(bx + px, by + py); g.lineTo(bx - px, by - py); g.closePath();
        g.fillStyle = PAL.danger; g.fill(); g.strokeStyle = PAL.ink; g.lineWidth = Math.max(1, a / 6); g.stroke();
      }
    }
    if (opts.view !== false && view) {
      const sx = cw / (W * TILE), sy = ch / (H * TILE);
      g.strokeStyle = PAL.gold; g.lineWidth = Math.max(1.5, cw / 120);
      g.strokeRect(view.x0 * sx, view.y0 * sy, (view.x1 - view.x0) * sx, (view.y1 - view.y0) * sy);
    }
    return true;
  }
  /** Cheap fog change test: a rolling sum of the fog bytes (checked only at refresh time). */
  fogChanged(s) {
    const f = s.L.fog;
    let h = 0;
    for (let k = 0; k < f.length; k++) h = (h * 31 + f[k]) | 0;
    if (h === this.fogSum) return false;
    this.fogSum = h;
    return true;
  }
}
