// Overlays (owner C; doc 12.4, 13.1 NEW): zones, designations, blueprints, room outlines, and the
// previews and order lines the tools hand in. Drawn after the darkness so they always read.
// Only visible tiles are walked. Zones show only while the 'zones' overlay is on (the Zones menu or
// a selected zone); designations always, at 50% alpha (12.4).
//
// setOverlay(name, value) (C9, index.js) stores the per-overlay state here:
//   'zones'   true | false | zoneId (highlight one)
//   'rooms'   true | false (outline rooms from s.rt.room)
//   'preview' { tiles: [i...], ok: [bool...] } | { rect: {x0,y0,x1,y1}, ok } | null (stamp, carve, place)
//   'stripes' [i...] | null (support plan: orange stripes on tiles whose mining would leave a roof unsupported)
//   'path'    [i...] | null (order line / route preview)
//   'chunks'  true | false (debug: chunk borders of the active band)

import { TILE, W, H, DESIG } from '../../game/core/grid.js';

const T = TILE;
const ZONE_TINT = ['rgba(240,200,90,0.28)', 'rgba(110,190,240,0.28)', 'rgba(150,220,120,0.28)', 'rgba(220,130,220,0.28)', 'rgba(240,140,90,0.28)'];
const DESIG_STYLE = [
  [DESIG.MINE, 'rgba(255,214,120,1)'], [DESIG.CHOP, 'rgba(150,230,120,1)'], [DESIG.HARVEST, 'rgba(240,200,90,1)'],
  [DESIG.SMOOTH, 'rgba(190,220,255,1)'], [DESIG.ENGRAVE, 'rgba(220,180,255,1)'], [DESIG.PROSPECT, 'rgba(255,170,90,1)'],
];

export class OverlayLayer {
  constructor() {
    this.state = { zones: false, rooms: false, preview: null, stripes: null, path: null, chunks: false };
    this.stripeC = null;
  }
  set(name, v) { this.state[name] = v; }
  get(name) { return this.state[name]; }

  draw(g, s, view, ctx) {
    const L = s.L, st = this.state;
    const tx0 = Math.max(0, Math.floor(view.x0 / T)), tx1 = Math.min(W - 1, Math.floor(view.x1 / T));
    const ty0 = Math.max(0, Math.floor(view.y0 / T)), ty1 = Math.min(H - 1, Math.floor(view.y1 / T));
    const k = 1 / view.z;
    // Zones.
    if (st.zones) {
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const z = L.zone[y * W + x];
        if (!z || (st.zones !== true && st.zones !== z)) continue;
        g.fillStyle = ZONE_TINT[z % ZONE_TINT.length]; g.fillRect(x * T, y * T, T, T);
      }
    }
    // Designations at 50% alpha: a corner-bracket mark in the kind's colour.
    g.globalAlpha = 0.5;
    g.lineWidth = Math.max(2, 2 * k);
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const d = L.desig[y * W + x];
      if (!(d & 0x3f)) continue;
      for (const [bit, col] of DESIG_STYLE) {
        if (!(d & bit)) continue;
        const bx = x * T + 4, by = y * T + 4, s2 = T - 8, c = 7;
        g.strokeStyle = col;
        g.beginPath();
        g.moveTo(bx, by + c); g.lineTo(bx, by); g.lineTo(bx + c, by);
        g.moveTo(bx + s2 - c, by); g.lineTo(bx + s2, by); g.lineTo(bx + s2, by + c);
        g.moveTo(bx + s2, by + s2 - c); g.lineTo(bx + s2, by + s2); g.lineTo(bx + s2 - c, by + s2);
        g.moveTo(bx + c, by + s2); g.lineTo(bx, by + s2); g.lineTo(bx, by + s2 - c);
        if (bit === DESIG.MINE) { g.moveTo(bx + 8, by + 8); g.lineTo(bx + s2 - 8, by + s2 - 8); }
        g.stroke();
        break;
      }
    }
    g.globalAlpha = 1;
    // Blueprints: a translucent ghost of the footprint.
    for (const b of s.bld) {
      if (!b || b.st !== 'bp') continue;
      const sz = ctx.sizeOf(b);
      if ((b.x + sz) * T < view.x0 || b.x * T > view.x1 || (b.y + sz) * T < view.y0 || b.y * T > view.y1) continue;
      g.fillStyle = 'rgba(120,190,255,0.22)'; g.fillRect(b.x * T, b.y * T, sz * T, sz * T);
      g.strokeStyle = 'rgba(160,210,255,0.85)'; g.lineWidth = 1.5 * k; g.setLineDash([5 * k, 4 * k]);
      g.strokeRect(b.x * T + 1, b.y * T + 1, sz * T - 2, sz * T - 2); g.setLineDash([]);
    }
    // Rooms: outline where the room id changes between neighbours.
    if (st.rooms && s.rt.room) {
      const R = s.rt.room;
      g.strokeStyle = 'rgba(255,230,170,0.7)'; g.lineWidth = 2 * k; g.beginPath();
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const i = y * W + x, r = R[i];
        if (!r) continue;
        if (x === W - 1 || R[i + 1] !== r) { g.moveTo((x + 1) * T, y * T); g.lineTo((x + 1) * T, (y + 1) * T); }
        if (x === 0 || R[i - 1] !== r) { g.moveTo(x * T, y * T); g.lineTo(x * T, (y + 1) * T); }
        if (y === H - 1 || R[i + W] !== r) { g.moveTo(x * T, (y + 1) * T); g.lineTo((x + 1) * T, (y + 1) * T); }
        if (y === 0 || R[i - W] !== r) { g.moveTo(x * T, y * T); g.lineTo((x + 1) * T, y * T); }
      }
      g.stroke();
    }
    // Support-plan stripes.
    if (st.stripes && st.stripes.length) {
      g.save();
      g.strokeStyle = 'rgba(255,150,40,0.85)'; g.lineWidth = 2;
      for (const i of st.stripes) {
        const x = (i % W) * T, y = ((i / W) | 0) * T;
        g.save(); g.beginPath(); g.rect(x, y, T, T); g.clip();
        g.beginPath(); for (let d = -T; d < T; d += 8) { g.moveTo(x + d, y + T); g.lineTo(x + d + T, y); } g.stroke();
        g.restore();
      }
      g.restore();
    }
    // Previews (stamp, carve, place).
    const pv = st.preview;
    if (pv) {
      const tile = (i, ok) => {
        const x = (i % W) * T, y = ((i / W) | 0) * T;
        g.fillStyle = ok ? 'rgba(120,230,120,0.30)' : 'rgba(240,80,70,0.36)'; g.fillRect(x, y, T, T);
        g.strokeStyle = ok ? 'rgba(160,255,160,0.9)' : 'rgba(255,120,110,0.9)'; g.lineWidth = 1.5 * k; g.strokeRect(x + 1, y + 1, T - 2, T - 2);
      };
      if (pv.tiles) for (let j = 0; j < pv.tiles.length; j++) tile(pv.tiles[j], pv.ok ? pv.ok[j] !== false : true);
      else if (pv.rect) for (let y = pv.rect.y0; y <= pv.rect.y1; y++) for (let x = pv.rect.x0; x <= pv.rect.x1; x++) tile(y * W + x, pv.ok !== false);
    }
    // Route / order line.
    if (st.path && st.path.length > 1) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      for (let j = 0; j < st.path.length; j++) { const i = st.path[j], x = (i % W + 0.5) * T, y = ((i / W | 0) + 0.5) * T; if (j) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = 'rgba(10,8,6,0.55)'; g.lineWidth = 5 * k; g.stroke();
      g.strokeStyle = 'rgba(255,230,160,0.95)'; g.lineWidth = 2.5 * k; g.setLineDash([7 * k, 6 * k]); g.lineDashOffset = -ctx.time * 26 * k; g.stroke();
      g.setLineDash([]); g.lineDashOffset = 0;
    }
    // Debug chunk borders.
    if (st.chunks && ctx.chunkSize) {
      const S = ctx.chunkSize;
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1 * k; g.beginPath();
      for (let x = Math.floor(view.x0 / S) * S; x <= view.x1; x += S) { g.moveTo(x, Math.max(0, view.y0)); g.lineTo(x, Math.min(H * T, view.y1)); }
      for (let y = Math.floor(view.y0 / S) * S; y <= view.y1; y += S) { g.moveTo(Math.max(0, view.x0), y); g.lineTo(Math.min(W * T, view.x1), y); }
      g.stroke();
    }
  }
}
