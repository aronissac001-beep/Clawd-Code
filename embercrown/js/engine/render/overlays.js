// Overlays (owner C; doc 12.4, 13.1 NEW): zones, designations, blueprints, room outlines, and the
// previews and order lines the tools hand in. Drawn after the darkness so they always read.
// Only visible tiles are walked. Zones show only while the 'zones' overlay is on (the Zones menu or
// a selected zone); designations always, at 50% alpha (12.4).
//
// setOverlay(name, value) (C9, index.js) stores the per-overlay state here:
//   'zones'   true | false | zoneId (highlight one)
//   'rooms'   true | false | roomId (outline every room from s.rt.room in its role's colour, or one room
//             brighter and the rest faint; Stage 2 roles from B's roomInfo, cached for 2 s)
//   'preview' { tiles: [i...], ok: [bool...] } | { rect: {x0,y0,x1,y1}, ok } | null (stamp, carve, place)
//   'stripes' [i...] | null (support plan: orange stripes on tiles whose mining would leave a roof unsupported)
//   'path'    [i...] | null (order line / route preview)
//   'chunks'  true | false (debug: chunk borders of the active band)
// On a D > 1 map (Stage Z1 E6) s is the view level's level view (levelview.js): zones, designations and rooms
// are that level's; the index lists ('preview' tiles, 'stripes', 'path') hold VOXEL indexes (C3 v3) and only
// those on the view level draw; a preview rect with a `z` draws only on its level; blueprints filter by b.z.

import { TILE, W, H, PLANE, DESIG } from '../../game/core/grid.js';
import * as SP from '../sprites.js';
import { PAL } from '../art/palette.js';
import { roomInfo } from '../../game/world/rooms.js';

/** Room outline colour by role (doc 7.11): what a room is for reads at a glance. */
export const ROOM_COLOUR = Object.freeze({ bedroom: PAL.moss3, barracks: PAL.moss3, dining: PAL.gold, kitchen: PAL.orange, workshop: PAL.tan, cellar: PAL.umber3,
  storeroom: PAL.sand, infirmary: PAL.teal, temple: PAL.violet, tavern: PAL.peach, tomb: PAL.slate3, hall: PAL.bone });

const T = TILE;
const ZONE_TINT = ['rgba(240,200,90,0.28)', 'rgba(110,190,240,0.28)', 'rgba(150,220,120,0.28)', 'rgba(220,130,220,0.28)', 'rgba(240,140,90,0.28)'];
const DESIG_STYLE = [
  [DESIG.MINE, 'rgba(255,214,120,1)'], [DESIG.CHOP, 'rgba(150,230,120,1)'], [DESIG.HARVEST, 'rgba(240,200,90,1)'],
  [DESIG.SMOOTH, 'rgba(190,220,255,1)'], [DESIG.ENGRAVE, 'rgba(220,180,255,1)'], [DESIG.PROSPECT, 'rgba(255,170,90,1)'],
];

const MARK_KEY = 0x7c000000;
/** Zone type (C2 zone.type) to the art key suffix of its overlay ('stockpile', 'growzone', 'dump'). */
const zoneType = (kind) => (kind === 'grow' || kind === 'growzone' ? 'growzone' : kind === 'dump' ? 'dump' : 'stockpile');
const MARK = { kit: null, m: null, k: 1 };
/** One designation mark in a tile-sized sprite (kit mark, or the stand-in corner brackets). */
function drawMark(g) {
  const { kit, m, k } = MARK;
  if (kit) { kit.drawDesigMark(g, m[1], 0, 0, k); return; }
  const bit = m[0], bx = 4, by = 4, s2 = T - 8, c = 7;
  g.lineWidth = Math.max(2, 2 * k); g.strokeStyle = m[1];
  g.beginPath();
  g.moveTo(bx, by + c); g.lineTo(bx, by); g.lineTo(bx + c, by);
  g.moveTo(bx + s2 - c, by); g.lineTo(bx + s2, by); g.lineTo(bx + s2, by + c);
  g.moveTo(bx + s2, by + s2 - c); g.lineTo(bx + s2, by + s2); g.lineTo(bx + s2 - c, by + s2);
  g.moveTo(bx + c, by + s2); g.lineTo(bx, by + s2); g.lineTo(bx, by + s2 - c);
  if (bit === DESIG.MINE) { g.moveTo(bx + 8, by + 8); g.lineTo(bx + s2 - 8, by + s2 - 8); }
  g.stroke();
}

export class OverlayLayer {
  constructor() {
    this.state = { zones: false, rooms: false, preview: null, stripes: null, path: null, chunks: false };
    this.stripeC = null;
    this.roomRole = []; this.roomRef = null; this.roomAt = -1e9;
  }
  /** Role colour of each room id (recomputed when the room table changes, else every 2 s). */
  roomColours(s, time) {
    const rooms = s.rt.rooms;
    if (rooms === this.roomRef && time - this.roomAt < 2) return this.roomRole;
    this.roomRef = rooms; this.roomAt = time;
    const out = this.roomRole; out.length = 0;
    if (!rooms) return out;
    for (let id = 1; id < rooms.length; id++) {
      if (!rooms[id]) continue;
      let role = 'hall';
      try { const inf = roomInfo(s, id); if (inf) role = inf.role; } catch (_) { /* before Stage 2 room data */ }
      out[id] = ROOM_COLOUR[role] || PAL.bone;
    }
    return out;
  }
  set(name, v) { this.state[name] = v; }
  get(name) { return this.state[name]; }

  draw(g, s, view, ctx) {
    const L = s.L, st = this.state;
    const lz = s.__lvl === undefined ? 0 : s.__lvl, onLv = (i) => ((i / PLANE) | 0) === lz;
    const lvList = (a) => { if (!a || !a.length || (lz === 0 && s.__lvl === undefined)) return a; const o = []; for (const i of a) if (onLv(i)) o.push(i % PLANE); return o; };
    const tx0 = Math.max(0, Math.floor(view.x0 / T)), tx1 = Math.min(W - 1, Math.floor(view.x1 / T));
    const ty0 = Math.max(0, Math.floor(view.y0 / T)), ty1 = Math.min(H - 1, Math.floor(view.y1 / T));
    const k = 1 / view.z;
    // Zones.
    const K = ctx.kit;
    if (st.zones) {
      const pix = !!(K && K.zoneSprite), types = this.types || (this.types = []);
      types.length = 0;
      if (pix && s.zones) for (const zn of s.zones) if (zn) types[zn.id] = zoneType(zn.type);
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const i = y * W + x, z = L.zone[i];
        if (!z || (st.zones !== true && st.zones !== z)) continue;
        if (pix) { // D's pixel zone tile: a dithered tint and dashed borders where the zone ends
          const type = types[z] || 'stockpile';
          const edges = (y === 0 || L.zone[i - W] !== z ? 1 : 0) | (x === W - 1 || L.zone[i + 1] !== z ? 2 : 0) | (y === H - 1 || L.zone[i + W] !== z ? 4 : 0) | (x === 0 || L.zone[i - 1] !== z ? 8 : 0);
          const sp = K.zoneSprite(type, edges, z);
          g.drawImage(sp.c, x * T, y * T, sp.w, sp.h);
          continue;
        }
        g.fillStyle = ZONE_TINT[z % ZONE_TINT.length]; g.fillRect(x * T, y * T, T, T);
      }
    }
    // Designations at 50% alpha: a corner-bracket mark in the kind's colour (D's marks when its kit is
    // in). Each mark is a cached tile sprite per kind and line-width step, so a big carve plan costs
    // one drawImage per tile.
    g.globalAlpha = 0.5;
    const kitMarks = !!(K && K.drawDesigMark && K.DESIG_MARKS);
    const M = kitMarks ? K.DESIG_MARKS : DESIG_STYLE;
    const kq = k <= 1 ? 1 : Math.round(k * 2) / 2;
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const d = L.desig[y * W + x];
      if (!(d & 0x3f)) continue;
      for (let m = 0; m < M.length; m++) {
        if (!(d & M[m][0])) continue;
        if (kitMarks && K.markSprite) { const sp = K.markSprite(M[m][1]); g.drawImage(sp.c, x * T, y * T, sp.w, sp.h); break; }
        MARK.kit = kitMarks ? K : null; MARK.m = M[m]; MARK.k = kq;
        const sp = SP.sprite(MARK_KEY + (kitMarks ? 0x8000 : 0) + m * 256 + ((kq * 2) | 0), ctx.scale, T, T, 0, 0, drawMark);
        g.drawImage(sp.c, x * T, y * T, T, T);
        break;
      }
    }
    g.globalAlpha = 1;
    // Blueprints: a translucent ghost of the footprint.
    for (const b of s.bld) {
      if (!b || b.st !== 'bp' || (s.__lvl !== undefined && (b.z | 0) !== lz)) continue;
      const f = ctx.footOf ? ctx.footOf(b) : null, bw = f ? f[0] : ctx.sizeOf(b), bh = f ? f[1] : bw;
      if ((b.x + bw) * T < view.x0 || b.x * T > view.x1 || (b.y + bh) * T < view.y0 || b.y * T > view.y1) continue;
      if (K && K.ghostSprite) { const sp = K.ghostSprite(bw, bh); g.drawImage(sp.c, b.x * T, b.y * T, sp.w, sp.h); continue; }
      g.fillStyle = 'rgba(120,190,255,0.22)'; g.fillRect(b.x * T, b.y * T, bw * T, bh * T);
      g.strokeStyle = 'rgba(160,210,255,0.85)'; g.lineWidth = 1.5 * k; g.setLineDash([5 * k, 4 * k]);
      g.strokeRect(b.x * T + 1, b.y * T + 1, bw * T - 2, bh * T - 2); g.setLineDash([]);
    }
    // Rooms: outline where the room id changes between neighbours, in the room's role colour; with one
    // room chosen (a selected tile, wall or bench in it) that room is solid and the others faint.
    if (st.rooms && s.rt.room) {
      const R = s.rt.room, one = st.rooms === true ? 0 : st.rooms | 0;
      const col = this.roomColours(s, ctx.time || 0);
      // 1 art pixel (2 world units) lines just inside the room's edge; 2 px for the chosen room
      const lw = Math.max(2, Math.round(k) * 2);
      let last = -1;
      for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
        const i = y * W + x, r = R[i];
        if (!r) continue;
        if (r !== last) { last = r; g.fillStyle = col[r] || PAL.bone; g.globalAlpha = one && r !== one ? 0.35 : 0.85; }
        const w2 = one && r === one ? lw * 2 : lw;
        if (x === W - 1 || R[i + 1] !== r) g.fillRect((x + 1) * T - w2, y * T, w2, T);
        if (x === 0 || R[i - 1] !== r) g.fillRect(x * T, y * T, w2, T);
        if (y === H - 1 || R[i + W] !== r) g.fillRect(x * T, (y + 1) * T - w2, T, w2);
        if (y === 0 || R[i - W] !== r) g.fillRect(x * T, y * T, T, w2);
      }
      g.globalAlpha = 1;
    }
    // Support-plan stripes.
    const stripes = lvList(st.stripes);
    if (stripes && st.stripes.length && K && K.stripeSprite) {
      const sp = K.stripeSprite();
      for (const i of stripes) g.drawImage(sp.c, (i % W) * T, ((i / W) | 0) * T, sp.w, sp.h);
    } else if (stripes && stripes.length) {
      g.save();
      g.strokeStyle = 'rgba(255,150,40,0.85)'; g.lineWidth = 2;
      for (const i of stripes) {
        const x = (i % W) * T, y = ((i / W) | 0) * T;
        g.save(); g.beginPath(); g.rect(x, y, T, T); g.clip();
        g.beginPath(); for (let d = -T; d < T; d += 8) { g.moveTo(x + d, y + T); g.lineTo(x + d + T, y); } g.stroke();
        g.restore();
      }
      g.restore();
    }
    // Previews (stamp, carve, place).
    const pv = st.preview;
    if (pv && !(pv.rect && pv.rect.z !== undefined && s.__lvl !== undefined && pv.rect.z !== lz)) {
      const tile = (i, ok) => {
        const x = (i % W) * T, y = ((i / W) | 0) * T;
        if (K && K.previewSprite) { const sp = K.previewSprite(ok); g.drawImage(sp.c, x, y, sp.w, sp.h); return; }
        g.fillStyle = ok ? 'rgba(120,230,120,0.30)' : 'rgba(240,80,70,0.36)'; g.fillRect(x, y, T, T);
        g.strokeStyle = ok ? 'rgba(160,255,160,0.9)' : 'rgba(255,120,110,0.9)'; g.lineWidth = 1.5 * k; g.strokeRect(x + 1, y + 1, T - 2, T - 2);
      };
      if (pv.tiles) for (let j = 0; j < pv.tiles.length; j++) { const i = pv.tiles[j]; if (s.__lvl === undefined) tile(i, pv.ok ? pv.ok[j] !== false : true); else if (onLv(i)) tile(i % PLANE, pv.ok ? pv.ok[j] !== false : true); }
      else if (pv.rect) for (let y = pv.rect.y0; y <= pv.rect.y1; y++) for (let x = pv.rect.x0; x <= pv.rect.x1; x++) tile(y * W + x, pv.ok !== false);
    }
    // Route / order line.
    const path = lvList(st.path);
    if (path && path.length > 1 && K && K.pixelPath) K.pixelPath(g, path, W, ctx.time);
    else if (path && path.length > 1) {
      g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      for (let j = 0; j < path.length; j++) { const i = path[j], x = (i % W + 0.5) * T, y = ((i / W | 0) + 0.5) * T; if (j) g.lineTo(x, y); else g.moveTo(x, y); }
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
