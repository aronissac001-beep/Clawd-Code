// Vertical art (owner D; EMBERCROWN-FORTRESS.md 4.1, 4.2, 6.3; Stage Z1 E6): stairs and ramps with their
// chevrons, the dim over the level seen below through open air, the 2 px cliff lip, the ceiling hatch,
// the band void tints and the pattern fill of uniform (unknown rock) chunks.
//
//   BANDS                     the bands of the world by relative level (2.2), each { id, name (<= 10
//                             chars), glyph, tint, tint2 }: a fallback table until js/data/levels.js
//                             (B, G) lands; bandOfLevel reads that table when it is installed
//   bandOfLevel(rel)          the band at relative level rel (0 = the surface, -1.. the depths)
//   setLevelTable(rows)       install js/data/levels.js rows ({ id, name, glyph, tint, rel: [lo, hi] })
//   paintStair(g, tx, ty, kind)      steps and the chevrons: up ▲, down ▼, both for UD (TER ids 17-19)
//   paintRamp(g, tx, ty, top)        a ramp (TER 20) with an up chevron, or a ramp top (21) with a down one
//   paintDim(g, tx, ty)              the 55% dark overlay on a tile that shows the level below
//   paintLip(g, tx, ty, mask)        the 2 px cliff lip on the open-air sides that meet standing ground
//                                    (mask: N 1, E 2, S 4, W 8)
//   paintHatch(g, tx, ty)            the faint diagonal hatch of a floor with no ceiling on an underground level
//   paintVoid(g, tx, ty, band, air)  one unknown-rock tile in the band's void tint (air: seen through open air)
//   voidPattern(g, band, air)        a repeat pattern of paintVoid in world units (32 per tile), for uniform chunks
//   voidColour(band, air)            the flat colour of the tint (placeholder, minimap)
//
// Contrast (4.1): every tint is dark (relative luminance under 0.05) and the chevrons (bone, gold) and
// the lip (slate3) are light, so each tint keeps at least 3:1 against both (tools/tests/render-levels.test.mjs).
// Everything draws inside its own tile square (tx * 32 .. + 32), so a clipped patch repaints exactly.
// Nothing runs at import; canvases are created on first use (browser only).

import { TILE } from '../../game/core/grid.js';
import { PAL } from './palette.js';
import { tileCanvas } from './pixel.js';

const T = TILE;
const put = (g, c, tx, ty) => g.drawImage(c, tx * T, ty * T, T, T);

// ---- bands (2.2) -----------------------------------------------------------------------------------
// tint: the void behind unknown rock; tint2: its flecks. rel: the relative levels the band covers.
export const BANDS = Object.freeze([
  Object.freeze({ id: 'heights', name: 'Heights', glyph: 'peak', tint: '#24283a', tint2: '#2e3448', rel: [1, 99] }),
  Object.freeze({ id: 'surface', name: 'Surface', glyph: 'sun', tint: '#22202e', tint2: '#2e2e40', rel: [0, 0] }),
  Object.freeze({ id: 'topsoil', name: 'Topsoil', glyph: 'root', tint: '#33221a', tint2: '#402c20', rel: [-1, -1] }),
  Object.freeze({ id: 'subsoil', name: 'Subsoil', glyph: 'clay', tint: '#2e1f18', tint2: '#3c291e', rel: [-2, -2] }),
  Object.freeze({ id: 'outer', name: 'Sandstone', glyph: 'strata', tint: '#1e2538', tint2: '#273047', rel: [-4, -3] }),
  Object.freeze({ id: 'middle', name: 'Granite', glyph: 'speckle', tint: '#1b2236', tint2: '#252d44', rel: [-5, -5] }),
  Object.freeze({ id: 'cavern1', name: 'Glowcaps', glyph: 'cap', tint: '#102c2c', tint2: '#173a38', rel: [-7, -6] }),
  Object.freeze({ id: 'deep', name: 'Deep stone', glyph: 'column', tint: '#27223a', tint2: '#322c47', rel: [-8, -8] }),
  Object.freeze({ id: 'cavern2', name: 'Mere', glyph: 'wave', tint: '#0f2a30', tint2: '#16373d', rel: [-10, -9] }),
  Object.freeze({ id: 'underdeep', name: 'Duskstone', glyph: 'glint', tint: '#251a30', tint2: '#30223d', rel: [-11, -11] }),
  Object.freeze({ id: 'ember', name: 'Ember', glyph: 'flame', tint: '#341210', tint2: '#451a15', rel: [-12, -12] }),
  Object.freeze({ id: 'cavern3', name: 'Reach', glyph: 'hound', tint: '#132628', tint2: '#1b3133', rel: [-13, -13] }),
  Object.freeze({ id: 'hollow', name: 'Hollow', glyph: 'seal', tint: '#262628', tint2: '#313133', rel: [-99, -14] }),
]);
let TABLE = BANDS;
/** Install js/data/levels.js rows (same shape as BANDS); null returns to the fallback table. */
export function setLevelTable(rows) { TABLE = rows && rows.length ? rows : BANDS; VOIDC.clear(); }
/** The band at relative level rel (the first row whose rel range holds it; the ends extend outward). */
export function bandOfLevel(rel) {
  for (let k = 0; k < TABLE.length; k++) { const r = TABLE[k].rel; if (rel >= r[0] && rel <= r[1]) return TABLE[k]; }
  return rel > 0 ? TABLE[0] : TABLE[TABLE.length - 1];
}

// ---- colour helpers ----------------------------------------------------------------------------------
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
/** The dim of the level below: 55% of ink over the colour. */
export const DIM = 0.55;
const DIM_RGB = hex(PAL.ink);
/** c darkened as the below-level dim does (the placeholder and the minimap use it). */
export function dimmed(c) { const v = hex(c); return toHex(...v.map((x, k) => Math.round(x * (1 - DIM) + DIM_RGB[k] * DIM))); }
const VOIDC = new Map();
/** The flat colour of a band's void tint; air: seen through open air (dimmed once more). */
export function voidColour(band, air = false) {
  const k = band.id + (air ? '|a' : '');
  let c = VOIDC.get(k);
  if (!c) { c = air ? dimmed(band.tint) : band.tint; VOIDC.set(k, c); }
  return c;
}
/** WCAG relative luminance of '#rrggbb' (tests). */
export function luminance(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hex(c);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** The light colours drawn over the tints (chevrons, lip): the contrast test reads them. */
export const MARKS = Object.freeze({ chevron: PAL.bone, chevron2: PAL.gold, lip: PAL.slate3 });

// ---- tile painters -----------------------------------------------------------------------------------
// Chevrons in 16 px art: ▲ is a 7 px wide, 4 px high wedge; ▼ its mirror; outlined in ink for any floor.
function chevron(p, cx, cy, upward, c) {
  for (let r = 0; r < 4; r++) {
    const y = upward ? cy + r : cy + 3 - r, w = 1 + r * 2;
    p.hl(cx - r - 1, y, w + 2, PAL.ink);
  }
  for (let r = 0; r < 3; r++) {
    const y = upward ? cy + 1 + r : cy + 2 - r, w = 1 + r * 2;
    p.hl(cx - r, y, w, c);
  }
}
const STAIR_KEY = ['v:st:u', 'v:st:d', 'v:st:ud'];
/** Steps and chevrons of a stair voxel. kind: TER.STAIR_U 17, STAIR_D 18, STAIR_UD 19. */
export function paintStair(g, tx, ty, kind) {
  const k = kind - 17;
  put(g, tileCanvas(STAIR_KEY[k] || STAIR_KEY[2], (p) => {
    // four treads: light edge, dark riser
    for (let s = 0; s < 4; s++) { p.hl(2, 2 + s * 3, 12, PAL.slate3); p.hl(2, 3 + s * 3, 12, PAL.slate0); }
    p.vl(1, 2, 12, PAL.ink); p.vl(14, 2, 12, PAL.ink);
    if (k !== 1) chevron(p, 7, 1, true, MARKS.chevron);          // up
    if (k !== 0) chevron(p, 7, 11, false, MARKS.chevron2);       // down
  }), tx, ty);
}
/** A ramp (top false: TER.RAMP, an up chevron) or a ramp top (top true: TER.RAMP_TOP, a down chevron). */
export function paintRamp(g, tx, ty, top) {
  put(g, tileCanvas(top ? 'v:rp:t' : 'v:rp:b', (p) => {
    if (!top) for (let s = 0; s < 5; s++) { p.hl(1 + s, 13 - s * 3, 14 - s * 2, PAL.slate2); p.hl(1 + s, 14 - s * 3, 14 - s * 2, PAL.slate0); }
    else { p.hl(1, 1, 14, PAL.slate2); p.vl(1, 1, 14, PAL.slate2); }
    chevron(p, 7, top ? 9 : 2, !top, top ? MARKS.chevron2 : MARKS.chevron);
  }), tx, ty);
}
let DIM_STYLE = null;
/** The 55% dark overlay of the level below (inside the tile). */
export function paintDim(g, tx, ty) {
  if (!DIM_STYLE) DIM_STYLE = `rgba(${DIM_RGB[0]},${DIM_RGB[1]},${DIM_RGB[2]},${DIM})`;
  g.fillStyle = DIM_STYLE; g.fillRect(tx * T, ty * T, T, T);
}
/** The 2 px (native) cliff lip on the sides of an open-air tile that meet standing ground on its level. */
export function paintLip(g, tx, ty, mask) {
  if (!mask) return;
  put(g, tileCanvas('v:lip:' + mask, (p) => {
    if (mask & 1) { p.hl(0, 0, 16, MARKS.lip); p.hl(0, 1, 16, PAL.slate1); }
    if (mask & 4) { p.hl(0, 15, 16, MARKS.lip); p.hl(0, 14, 16, PAL.slate1); }
    if (mask & 8) { p.vl(0, 0, 16, MARKS.lip); p.vl(1, 0, 16, PAL.slate1); }
    if (mask & 2) { p.vl(15, 0, 16, MARKS.lip); p.vl(14, 0, 16, PAL.slate1); }
  }), tx, ty);
}
/** A faint diagonal hatch: this floor has no ceiling (open to the sky or a shaft) on an underground level. */
export function paintHatch(g, tx, ty) {
  put(g, tileCanvas('v:hatch', (p) => { for (let k = 0; k < 32; k += 4) for (let y = 0; y < 16; y++) { const x = k - y; if (x >= 0 && x < 16 && (y & 1) === 0) p.px(x, y, 'rgba(201,203,212,0.28)'); } }), tx, ty);
}
function voidTile(band, air) {
  return tileCanvas('v:void:' + band.id + (air ? ':a' : ''), (p) => {
    const a = air ? dimmed(band.tint) : band.tint, b = air ? dimmed(band.tint2) : band.tint2;
    p.rect(0, 0, 16, 16, a);
    // a sparse, stable fleck so a deep level still reads as rock of its band
    for (const [x, y] of [[2, 3], [9, 1], [13, 6], [5, 10], [11, 12], [1, 14], [7, 6]]) { p.px(x, y, b); p.px(x + 1, y, b); }
  });
}
/** One unknown-rock tile in its band's void tint. */
export function paintVoid(g, tx, ty, band, air = false) { put(g, voidTile(band, air), tx, ty); }
const PATS = new Map();
/** A repeating pattern of the void tile at world scale (32 units per tile), anchored at the world origin. */
export function voidPattern(g, band, air = false) {
  const k = band.id + (air ? '|a' : '');
  let p = PATS.get(k);
  if (p) return p;
  const c = document.createElement('canvas'); c.width = c.height = T;
  const cg = c.getContext('2d'); cg.imageSmoothingEnabled = false; cg.drawImage(voidTile(band, air), 0, 0, T, T);
  p = g.createPattern(c, 'repeat');
  PATS.set(k, p);
  return p;
}
