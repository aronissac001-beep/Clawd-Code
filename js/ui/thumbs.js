// Pixel-art thumbnails for the UI (owner I; UI pass 2): a build card's structure or furniture, a stamp's
// main piece and the colonist sheet's medallion figure, drawn with the world's own painters
// (js/engine/art) into a small canvas at the device's pixel ratio, nearest-neighbour. Every helper
// returns null when a key has no art, so a caller falls back to its SVG icon.
import { h } from './kit.js';
import { kitSprite, drawArt, colonistSprite } from '../engine/art/index.js';
import { artMeta } from '../engine/art/keys.js';

const TILE = 16;   // world units per tile (grid.js TILE)

function surface(size) {
  const dpr = Math.min(3, Math.max(1, Math.round((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1)));
  const c = h('canvas.ec-thumb', { width: String(size * dpr), height: String(size * dpr), 'aria-hidden': 'true' });
  c.style.width = c.style.height = size + 'px';
  const g = c.getContext('2d');
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.scale(dpr, dpr);
  return { c, g };
}

/** Fit a baked sprite record { c, w, h } (world units) into a size x size canvas, centred, feet low. */
function fitSprite(sp, size, pad = 2) {
  const out = surface(size);
  if (!out || !sp || !sp.c) return null;
  const k = Math.min((size - pad * 2) / sp.w, (size - pad * 2) / sp.h);
  const w = sp.w * k, hh = sp.h * k;
  out.g.drawImage(sp.c, Math.round((size - w) / 2), Math.round(size - pad - hh), w, hh);
  return out.c;
}

const keyOf = (d) => (d && d.art && artMeta(d.art) ? d.art : d && artMeta(d.id) ? d.id : null);

/** A size x size canvas of a structure def's art (one tile of a floor or ground), or null. */
export function defThumb(d, size = 44) {
  try {
    const key = keyOf(d);
    if (!key) return null;
    const meta = artMeta(key);
    if (meta.kind === 'struct' || meta.kind === 'item') return fitSprite(kitSprite(key, 2, {}), size);
    if (meta.kind === 'floor' || meta.kind === 'ground') {
      const out = surface(size);
      if (!out) return null;
      const inset = 6, k = (size - inset * 2) / TILE;
      out.g.save(); out.g.translate(inset, inset); out.g.scale(k, k);
      drawArt(out.g, key, 0, 0, { tx: 0, ty: 0 });
      out.g.restore();
      return out.c;
    }
  } catch (_) { /* no art for this key: the icon stands in */ }
  return null;
}

/** The colonist's own pixel figure for a portrait medallion, or null. */
export function colonistThumb(c, size = 56) {
  try { return fitSprite(colonistSprite(c, 0, false, 2), size, 0); } catch (_) { return null; }
}
