// Threat warnings on the map (owner C; doc 9.4 Omen and Sighted, 14.7 row C): the edge marker from the
// Omen on, and the route preview line from Sighted (edge -> goal down the goal's flow field). The data
// is H's read-only view (js/game/threat/warnings.js threatViews), refreshed every REFRESH ticks or when
// a threat changes stage, never per frame. Drawn above the darkness (it is a warning, not a light).
//   ThreatLayer.update(s)            refresh the cached views (cheap when nothing changed)
//   ThreatLayer.draw(g, view, ctx, z, ox, oy, dpr)   g in the world transform
//   ThreatLayer.edges                [{ side, x, y (tile), stage }] for the minimap
//   ThreatLayer.views                the cached ThreatViews (tests, the raid scene)
//   ThreatLayer.insets               { t, r, b, l } css px kept clear of the HUD when clamping the marker
// Level of detail: the route is pixel dashes (D's PATH_ROUTE) at zoom >= strategicZoom and a dashed
// line of constant screen width below it; the edge marker is a constant-size chevron (3 css px per
// art px), clamped to the screen border when the edge is off screen so the player knows where to look.
// Render only: nothing here writes sim state.

import { TILE, W } from '../../game/core/grid.js';
import { threatViews } from '../../game/threat/warnings.js';
import { PAL } from '../art/palette.js';

const T = TILE;
const REFRESH = 10;         // ticks between refreshes of the views (a route moves at most once per flow rebuild)
const MARK_PX = 3;          // css px per art px of the edge marker (15 px -> 45 pt)
// a raid on the map shows itself (foes, rims, the strategic blob): the warnings end when it arrives
const ROUTE_STAGES = { sighted: 1, imminent: 1 };
const EDGE_STAGES = { omen: 1, sighted: 1, imminent: 1 };

export class ThreatLayer {
  constructor(cfg) {
    this.cfg = cfg;
    this.views = [];
    this.edges = [];
    this.last = -1; this.sig = '';
    this.st = { refreshes: 0, routeTiles: 0 };
    this.source = threatViews;   // the views provider (H's threatViews; a debug scene may stand in)
    // screen insets (css px) an off-screen edge marker is clamped inside: the HUD's bars cover the
    // canvas there. I may set them from its layout (r.threat.insets = { t, r, b, l }).
    this.insets = { t: 100, r: 30, b: 76, l: 30 };
  }
  setState() { this.views = []; this.edges = []; this.last = -1; this.sig = ''; }
  /** Stage signature: refresh at once when any threat appears, moves a stage or ends. */
  signature(s) {
    let sig = '';
    for (const e of s.st.queue) if (e.stage !== 'queued') sig += `${e.id}${e.stage[0]}`;
    for (const r of s.raids) sig += `${r.id}${r.stage[0]}`;
    return sig;
  }
  update(s) {
    if (!s || !s.st || !s.st.queue) { this.views = []; this.edges = []; return; }
    if (s.tick === this.last) return;
    const sig = this.signature(s);
    if (sig === this.sig && this.last >= 0 && s.tick - this.last < REFRESH && s.tick >= this.last) return;
    this.sig = sig; this.last = s.tick;
    if (!sig && this.source === threatViews) { this.views = []; this.edges = []; return; }
    let v = [];
    try { v = this.source(s); } catch (_) { v = []; }
    this.views = v;
    this.edges.length = 0;
    let n = 0;
    for (const t of v) {
      if (t.edge && EDGE_STAGES[t.stage]) this.edges.push({ side: t.edge.side, x: t.edge.x, y: t.edge.y, stage: t.stage });
      if (t.route && ROUTE_STAGES[t.stage]) n += t.route.length;
    }
    this.st.refreshes++; this.st.routeTiles = n;
  }

  draw(g, view, ctx, z, ox, oy, dpr) {
    if (!this.views.length) return;
    const K = ctx.kit, strategic = z < this.cfg.strategicZoom;
    // 1. routes (world transform)
    for (const t of this.views) {
      if (!t.route || t.route.length < 2 || !ROUTE_STAGES[t.stage]) continue;
      if (!strategic && K && K.pixelPath && K.PATH_ROUTE) { K.pixelPath(g, t.route, W, ctx.reduceMotion ? 0 : ctx.time, K.PATH_ROUTE); continue; }
      const k = 1 / z;
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      for (let j = 0; j < t.route.length; j++) { const i = t.route[j], x = (i % W + 0.5) * T, y = ((i / W | 0) + 0.5) * T; if (j) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = PAL.ink; g.lineWidth = 6 * k; g.stroke();
      g.strokeStyle = PAL.danger; g.lineWidth = 3 * k; g.setLineDash([8 * k, 6 * k]); g.lineDashOffset = ctx.reduceMotion ? 0 : -ctx.time * 20 * k; g.stroke();
      g.setLineDash([]); g.lineDashOffset = 0;
    }
    // 2. edge markers (screen space, constant size)
    if (!this.edges.length || !(K && K.edgeMarker)) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sm = g.imageSmoothingEnabled; g.imageSmoothingEnabled = false;
    const sw = (view.x1 - view.x0) * z, sh = (view.y1 - view.y0) * z, ins = this.insets;
    const bright = !ctx.reduceMotion && ((ctx.time * 2) | 0) % 2 === 0;
    for (const e of this.edges) {
      // the marker sits one tile inside the map edge it points from
      const wx = (e.x + 0.5) * T, wy = (e.y + 0.5) * T;
      let sx = ox + wx * z, sy = oy + wy * z;
      sx = Math.max(ins.l, Math.min(sw - ins.r, sx)); sy = Math.max(ins.t, Math.min(sh - ins.b, sy));
      const sp = K.edgeMarker(e.side, bright);
      const pw = sp.c.width * MARK_PX, ph = sp.c.height * MARK_PX;
      g.drawImage(sp.c, Math.round((sx - pw / 2) * dpr) / dpr, Math.round((sy - ph / 2) * dpr) / dpr, pw, ph);
    }
    g.imageSmoothingEnabled = sm;
    g.setTransform(z * dpr, 0, 0, z * dpr, ox * dpr, oy * dpr);
  }
}
