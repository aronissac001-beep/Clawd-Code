// The colony's app icons (owner D; docs/ART-STYLE.md): the Embercrown crest, a gold crown with the
// Hearth flame rising out of it, as 32 x 32 pixel art on a dithered ember glow. tools/make-icons.mjs
// renders it to icons/ at whole-number scales (the crest at 4x in 192 and 180, 12x in 512, 9x inside
// the maskable 512's safe circle; the field at the same scale). Colours come from palette.js only.
// Browser only (canvases); nothing runs at import.
//   drawAppIcon(size, maskable)  a size x size canvas
//   paintCrest(p, ox, oy)        the 32 x 32 crest into a Px painter at (ox, oy) (title, contact sheet)
//   paintField(p, n)             the n x n background glow

import { PAL, dith } from './palette.js';
import { Px } from './pixel.js';

/** Fill a polygon (native px vertices) with colour c, or with fn(x, y) -> colour. */
function poly(p, pts, c) {
  let y0 = Infinity, y1 = -Infinity;
  for (let k = 1; k < pts.length; k += 2) { y0 = Math.min(y0, pts[k]); y1 = Math.max(y1, pts[k]); }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yc = y + 0.5, xs = [];
    for (let k = 0; k < pts.length; k += 2) {
      const ax = pts[k], ay = pts[k + 1], bx = pts[(k + 2) % pts.length], by = pts[(k + 3) % pts.length];
      if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) p.px(x, y, typeof c === 'function' ? c(x, y) : c);
  }
}

/** The background: a warm glow low in the middle fading to night at the edges, in dithered steps. */
export function paintField(p, n) {
  const cx = n / 2, cy = n * 0.5;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5 - cx) / n, dy = (y + 0.5 - cy) / n, d = Math.sqrt(dx * dx + dy * dy) * 2.2; // 0 centre .. ~1.6 corner
    const steps = [PAL.ember0, PAL.plum0, PAL.night, PAL.ink];
    const f = Math.min(2.999, d * 2.2), k = Math.floor(f), t = f - k;
    p.px(x, y, dith(x, y, Math.round(t * 16)) ? steps[Math.min(3, k + 1)] : steps[k]);
  }
}

/** The 32 x 32 crest at (ox, oy): flame behind, crown in front, 1 px ink outline, lit from the top-left. */
export function paintCrest(p0, ox = 0, oy = 0) {
  const p = new Px(p0.g, p0.ox + ox, p0.oy + oy);
  // the flame (behind the crown): outer orange, gold, a pale core
  const flame = (x, y, w, c) => poly(p, [x, y, x + w * 0.62, y + w * 0.9, x + w * 0.5, y + w * 1.55, x, y + w * 1.75, x - w * 0.5, y + w * 1.55, x - w * 0.62, y + w * 0.9], c);
  flame(16, 1, 9, PAL.ember1);
  flame(16, 3.5, 7.5, PAL.orange);
  flame(16, 7, 5.2, PAL.gold);
  flame(16, 11, 3, PAL.flame);
  // the crown: two tall side points and a small middle one; gold ramp lit from the left
  const crown = [3.5, 7, 10.5, 15, 16, 12, 21.5, 15, 28.5, 7, 26, 22, 6, 22];
  poly(p, crown, (x, y) => (x < 8 ? PAL.flame : x < 22 ? PAL.gold : x === 22 && dith(x, y, 8) ? PAL.gold : PAL.tan));
  // the band, its rivets and the jewels
  p.rect(5, 21, 22, 5, PAL.gold); p.hl(5, 21, 22, PAL.flame); p.hl(5, 25, 22, PAL.umber3); p.vl(26, 21, 5, PAL.umber3); p.vl(5, 21, 5, PAL.flame);
  p.rect(14, 22, 4, 3, PAL.danger); p.px(14, 22, PAL.peach); p.px(17, 24, PAL.ember0);
  p.rect(8, 22, 3, 3, PAL.teal); p.px(8, 22, PAL.mist);
  p.rect(21, 22, 3, 3, PAL.teal); p.px(21, 22, PAL.mist);
  // knobs on the points
  for (const [x, y] of [[3, 5], [27, 5]]) { p.rect(x, y, 2, 2, PAL.gold); p.px(x, y, PAL.flame); p.px(x + 1, y + 1, PAL.tan); p.rect(x, y + 2, 2, 1, x < 16 ? PAL.flame : PAL.tan); }
  // shading lines down the crown's right faces
  p.line(21, 15, 25, 10, PAL.umber3); p.line(10, 15, 6, 10, PAL.flame);
  p.outline(PAL.ink);
}

/** A size x size canvas of the icon (see the header for the scales). */
export function drawAppIcon(size, maskable = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  // native field and crest scales: a whole number of device px per art pixel
  const crestK = Math.max(1, Math.floor((size * (maskable ? 0.6 : 0.8)) / 34));
  const fieldK = crestK;
  const fn = Math.ceil(size / fieldK);
  const f = document.createElement('canvas'); f.width = f.height = fn;
  const fg = f.getContext('2d');
  paintField(new Px(fg), fn);
  g.drawImage(f, 0, 0, fn * fieldK, fn * fieldK);
  const cr = document.createElement('canvas'); cr.width = cr.height = 34;
  const cg = cr.getContext('2d');
  paintCrest(new Px(cg), 1, 1);
  const off = Math.round((size - 34 * crestK) / 2);
  g.drawImage(cr, off, off + Math.round(crestK * 0.5), 34 * crestK, 34 * crestK);
  f.width = f.height = 0; cr.width = cr.height = 0;
  return c;
}
