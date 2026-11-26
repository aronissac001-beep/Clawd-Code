// The ruler's section view (owner C/I; EMBERCROWN-FORTRESS.md 4.1, Stage Z4): a side cut through the hold
// along one row (axis 'x': west to east at y = line) or one column (axis 'y': north to south at x = line),
// every level from zHi down to zLo at once, so the shape of the fortress reads at a glance.
//   sectionImage(s, axis, line, zLo, zHi)  -> { n, rows, data: Uint8ClampedArray (n x rows RGBA) }; row 0 is zHi
//   sectionColour(s, i)                    -> [r, g, b] of voxel i (unknown voxels: the band's void tint)
//   drawSection(canvas, img, o)            draws it scaled (crisp pixels) with level labels, the view level,
//                                          the camera mark and colonist dots; returns the layout { gx, top, rowH, cellW }
// Render only and read-only: it reads s.L and s.col, never writes, and is never read by js/game/.

import { W, H, PLANE, zS, TER, getBit } from '../../game/core/grid.js';
import { bandOfRel } from '../../data/levels.js';
import { levelText } from '../../game/tools/levels.js';
import { tileTables } from './terrain.js';
import { PAL } from '../art/palette.js';

const FL_DEPTH = 7, FL_EMBER = 8;
const hex = (c) => { const n = parseInt(String(c).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const CACHE = new Map();
const rgb = (c) => { let v = CACHE.get(c); if (!v) { v = hex(c); CACHE.set(c, v); } return v; };
const darker = (c, k) => { const v = rgb(c); return [Math.round(v[0] * k), Math.round(v[1] * k), Math.round(v[2] * k)]; };
const VOID = new Map();
const voidOf = (z) => { const b = bandOfRel(z - zS); let v = VOID.get(b.id); if (!v) { v = darker(b.tint, 0.55); VOID.set(b.id, v); } return v; };
const GREEN = new Set([TER.GRASS, TER.MEADOW, TER.MOSS, TER.MARSH, TER.TILLED]);
let STONES = null;
const stoneOf = (m) => { if (!STONES) { try { STONES = tileTables().stone; } catch (_) { STONES = []; } } return STONES[m] || PAL.stone1; };

/** The flat colour of voxel i in the cut. */
export function sectionColour(s, i) {
  const L = s.L, z = (i / PLANE) | 0;
  const seen = (L.known && getBit(L.known, i)) || (L.fog && getBit(L.fog, i));
  if (!seen) return voidOf(z);
  const fl = L.fluid ? L.fluid[i] : 0;
  if (fl & FL_DEPTH) return rgb((fl & FL_EMBER) ? PAL.orange : (fl & FL_DEPTH) > 3 ? PAL.water : PAL.shallow);
  const t = L.terrain[i];
  switch (t) {
    case TER.ROCK: return rgb(stoneOf(L.mat[i]));
    case TER.AIR: case TER.RAMP_TOP: case TER.VOID: return z >= zS ? rgb('#2a3346') : rgb(PAL.ink);
    case TER.STAIR_U: case TER.STAIR_D: case TER.STAIR_UD: case TER.RAMP: return rgb(PAL.gold);
    case TER.LAVA: return rgb(PAL.orange);
    case TER.SHALLOW: return rgb(PAL.shallow);
    case TER.DEEP: return rgb(PAL.water);
    case TER.ICE: return rgb(PAL.mist);
    case TER.ROUGH: case TER.RUBBLE: return rgb(PAL.stone0);
    default:
      if (L.floor && L.floor[i]) return rgb(PAL.tan);
      return GREEN.has(t) ? rgb(PAL.moss2) : rgb(PAL.umber3);
  }
}

/** The cut as an RGBA image: n voxels across (W or H), one row per level, zHi first. */
export function sectionImage(s, axis, line, zLo, zHi) {
  const n = axis === 'y' ? H : W, rows = Math.max(0, zHi - zLo + 1);
  const data = new Uint8ClampedArray(n * rows * 4);
  const ln = Math.max(0, Math.min((axis === 'y' ? W : H) - 1, line | 0));
  for (let r = 0; r < rows; r++) {
    const z = zHi - r;
    for (let k = 0; k < n; k++) {
      const i = axis === 'y' ? z * PLANE + k * W + ln : z * PLANE + ln * W + k;
      const c = sectionColour(s, i), o = (r * n + k) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
  }
  return { n, rows, zLo, zHi, axis, line: ln, data };
}

/**
 * Draw the cut into a canvas sized by CSS (its client box). o: { viewZ, mark (camera position along the cut,
 * tiles), cols ([{ k, z }]: colonists near the cut), pick (a level to highlight), ts (text scale) }.
 */
export function drawSection(cv, img, o = {}) {
  const dpr = Math.min(3, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  const cw = Math.max(1, cv.clientWidth), ch = Math.max(1, cv.clientHeight);
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
  const g = cv.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#1c171a'; g.fillRect(0, 0, cw, ch);
  const ts = o.ts || 1, font = Math.round(14 * ts);
  const gx = Math.round(font * 3.2), rows = Math.max(1, img.rows);
  const rowH = Math.max(6, Math.min(28, Math.floor((ch - 4) / rows)));
  const cellW = (cw - gx - 4) / img.n, top = Math.max(2, Math.floor((ch - rowH * rows) / 2));
  if (img.rows) {
    const off = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(img.n, img.rows) : Object.assign(document.createElement('canvas'), { width: img.n, height: img.rows });
    off.getContext('2d').putImageData(new ImageData(img.data, img.n, img.rows), 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(off, gx, top, cellW * img.n, rowH * rows);
  }
  // the view level and the picked level
  const rowY = (z) => top + (img.zHi - z) * rowH;
  if (o.viewZ >= img.zLo && o.viewZ <= img.zHi) { g.strokeStyle = PAL.bone; g.lineWidth = 2; g.strokeRect(gx - 1, rowY(o.viewZ) - 1, cw - gx - 2, rowH + 2); }
  if (o.pick !== undefined && o.pick !== null && o.pick >= img.zLo && o.pick <= img.zHi) { g.fillStyle = 'rgba(244, 177, 60, 0.35)'; g.fillRect(gx, rowY(o.pick), cw - gx - 4, rowH); }
  // the surface line, the camera mark, colonists
  if (zS >= img.zLo && zS <= img.zHi) { g.fillStyle = PAL.moss3; g.fillRect(gx, rowY(zS) + rowH - 1, cw - gx - 4, 1); }
  if (o.mark >= 0) { g.fillStyle = 'rgba(241, 234, 216, 0.55)'; g.fillRect(gx + (o.mark + 0.5) * cellW - 0.5, top, 1, rowH * rows); }
  for (const c of o.cols || []) {
    if (c.z < img.zLo || c.z > img.zHi) continue;
    const d = Math.max(3, Math.min(rowH - 2, 6));
    g.fillStyle = PAL.flame; g.fillRect(gx + (c.k + 0.5) * cellW - d / 2, rowY(c.z) + (rowH - d) / 2, d, d);
  }
  // level labels: as many as fit at the text size (the view level, the surface and the ends always)
  g.font = `${font}px system-ui, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'right';
  const every = Math.max(1, Math.ceil((font + 4) / rowH));
  const ys = [];
  const label = (z) => { const y = rowY(z) + rowH / 2; if (ys.some((v) => Math.abs(v - y) < font + 2)) return; g.fillStyle = z === o.viewZ ? PAL.bone : '#cdbb98'; g.fillText(levelText(z), gx - 6, y); ys.push(y); };
  for (const z of [o.viewZ, zS, img.zHi, img.zLo]) if (z >= img.zLo && z <= img.zHi) label(z);
  for (let z = img.zHi; z >= img.zLo; z -= every) label(z);
  return { gx, top, rowH, cellW };
}
