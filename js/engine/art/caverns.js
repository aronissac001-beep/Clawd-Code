// Cavern flora and fauna (owner D; EMBERCROWN-FORTRESS.md 2.10, 7.6, step Z2.7). Pixel sprites in the beings.js style:
// the same palette, the same canvases (animals 24 x 24 anchored at the feet 12, 20; plants 16 x 20 anchored at 8, 17)
// and the same bake cache, so the renderer can draw them exactly as it draws animalSprite and cropSprite. Pure render
// code: no sim state, no randomness.
//
//   caveAnimalSprite(kind, frame, flip)  great_spider | blindfish | mire_leech | shellback; frame 0-3 (walk cycle)
//   cavePlantSprite(kind, stage)         greyshank | merereed | lichen | dimroot; stage 0-3 (sprout .. mature)
//   CAVE_ANIMAL_KINDS, CAVE_PLANT_KINDS  the kinds drawn here (art index routes animal.<kind> / plant.<kind> to them)
//   caveGlow(kind)                       [radius px, colour] of a faint light pool for glowing kinds, or null
// Original designs: a pale long-legged spider, an eyeless white fish, a banded leech, a domed armoured crab, a giant
// grey fungus with a ribbed stalk, pale reeds, glowing lichen crusts and a tuber's leaf rosette.
import { PAL } from './palette.js';
import { bake, skey, peek } from './pixel.js';

const P = PAL;
export const CAVE_ANIMAL_KINDS = Object.freeze(['great_spider', 'blindfish', 'mire_leech', 'shellback']);
export const CAVE_PLANT_KINDS = Object.freeze(['greyshank', 'merereed', 'lichen', 'dimroot']);

const ANIMALS = {
  great_spider(p, f) {
    // eight legs in two fans, the gait alternating; a pale abdomen with a plum mark
    const a = f & 1 ? 1 : -1;
    for (const [x0, y0, x1, y1] of [[9, 13, 3, 9 + a], [9, 14, 2, 14 - a], [9, 15, 3, 19 + a], [10, 16, 5, 21 - a],
      [15, 13, 21, 9 - a], [15, 14, 22, 14 + a], [15, 15, 21, 19 - a], [14, 16, 19, 21 + a]]) p.line(x0, y0, x1, y1, P.slate1);
    p.ellipse(12, 16, 5, 4, P.slate3); p.ellipse(12, 15, 4, 3, P.mist); p.rect(11, 15, 3, 2, P.plum1);
    p.ellipse(12, 11, 3, 2, P.slate2); p.px(11, 10, P.danger); p.px(13, 10, P.danger); p.px(12, 9, P.ink);
  },
  blindfish(p, f) {
    // seen from above in the water: a pale body that flexes, no eyes, a faint ripple
    const b = f === 1 ? 1 : f === 3 ? -1 : 0;
    p.hl(6, 19, 12, P.shallow);
    p.ellipse(12, 15, 5, 2, P.bone); p.hl(8, 15, 8, P.mist);
    p.px(17 + b, 14, P.mist); p.px(18 + b, 15, P.mist); p.px(17 + b, 16, P.mist);   // tail
    p.px(6, 15, P.peach); p.px(10, 13, P.slate3); p.px(10, 17, P.slate3);
  },
  mire_leech(p, f) {
    // a banded worm that inches along: its body bunches on frames 1 and 3
    const k = f & 1 ? 2 : 0;
    for (let x = 6 + k; x <= 17 - k; x++) { const y = 16 - (k && x > 9 && x < 14 ? 1 : 0); p.px(x, y, (x & 1) ? P.plum0 : P.umber1); p.px(x, y + 1, P.ink); }
    p.px(17 - k, 15, P.danger); p.px(18 - k, 16, P.umber2);
  },
  shellback(p, f) {
    // a domed armoured cave crab: six short legs, two claws, the shell plates in ridges
    const st = f & 1 ? 1 : 0;
    for (const x of [7, 10, 14, 17]) p.vl(x + (x < 12 ? -st : st), 18, 2, P.stone0);
    p.ellipse(12, 15, 7, 4, P.stone1); p.ellipse(12, 14, 6, 3, P.slate3);
    p.hl(7, 14, 10, P.slate2); p.hl(8, 12, 8, P.mist); p.px(12, 13, P.slate1); p.px(9, 13, P.slate1); p.px(15, 13, P.slate1);
    p.rect(3, 13 - st, 3, 2, P.stone1); p.rect(18, 13 + st, 3, 2, P.stone1); p.px(4, 12 - st, P.mist); p.px(19, 12 + st, P.mist);
    p.px(11, 11, P.ink); p.px(13, 11, P.ink);
  },
};

/** A cavern animal sprite (24 x 24, anchor 12, 20). Unknown kinds draw as the great spider. */
export function caveAnimalSprite(kind, frame = 0, flip = false) {
  const k = ANIMALS[kind] ? kind : 'great_spider', f = frame & 3;
  const key = skey(`cave:${k}`, f * 2 + (flip ? 1 : 0)), hit = peek(key);
  if (hit) return hit;
  return bake(key, 24, 24, 12, 20, (p) => {
    if (flip) { p.g.translate(24, 0); p.g.scale(-1, 1); }
    ANIMALS[k](p, f);
    if (flip) p.g.setTransform(1, 0, 0, 1, 0, 0);
  }, { after: (p) => { if (k !== 'blindfish') p.shadow(12, 21, k === 'mire_leech' ? 4 : k === 'shellback' ? 7 : 8, 1.2, 8); } });
}

const PLANTS = {
  greyshank(p, st, b) {
    // a giant grey fungus: a ribbed stalk and a wide cap with gills; a sapling is a button
    if (st === 0) { p.ellipse(8, b - 1, 2, 1, P.slate3); p.px(8, b - 2, P.mist); return; }
    const h = st === 1 ? 6 : st === 2 ? 10 : 13, w = st === 1 ? 4 : st === 2 ? 6 : 7;
    p.rect(7, b - h, 3, h, P.slate2); p.vl(7, b - h, h, P.slate3); p.vl(9, b - h + 1, h - 1, P.slate1);
    p.ellipse(8, b - h, w, 2, P.slate3); p.hl(8 - w + 1, b - h - 1, 2 * w - 1, P.mist); p.hl(8 - w + 1, b - h + 1, 2 * w - 1, P.slate1);
    if (st === 3) { p.px(3, b - h, P.slate1); p.px(13, b - h, P.slate1); p.px(5, b - h - 1, P.bone); p.px(11, b - h - 1, P.bone); }
  },
  merereed(p, st, b) {
    // pale reeds in a clump on the shore; seed heads when ripe
    const h = [3, 6, 9, 11][st];
    for (const [x, dh, c] of [[5, -2, P.slate3], [7, 0, P.mist], [9, -1, P.slate3], [11, -3, P.mist]]) p.vl(x, b - h - dh + 1, Math.max(1, h + dh), c);
    if (st === 3) for (const x of [7, 9]) { p.rect(x, b - h - 2, 1, 2, P.tan); }
    p.hl(4, b, 9, P.shallow);
  },
  lichen(p, st, b) {
    // a crust of faint teal light on the ground, growing in rings
    const r = [1, 2, 3, 4][st];
    p.ellipse(8, b - 1, r + 1, Math.max(1, r - 1), P.slate1);
    p.ellipse(8, b - 1, r, Math.max(1, r - 2), P.teal);
    if (st >= 2) { p.px(8 - r, b - 1, P.mist); p.px(8 + r, b - 2, P.mist); p.px(8, b - 2, P.bone); }
  },
  dimroot(p, st, b) {
    // a low rosette of grey-violet leaves over a pale tuber that shows when ripe
    const w = [1, 3, 4, 5][st];
    p.ellipse(8, b - 2, w, Math.max(1, w - 2), P.plum0); p.ellipse(8, b - 3, Math.max(1, w - 1), Math.max(1, w - 3), P.plum1);
    p.vl(8, b - 3 - st, st + 1, P.slate3);
    if (st === 3) { p.ellipse(8, b, 3, 1, P.peach); p.px(7, b, P.bone); }
  },
};

/** A cavern plant sprite (16 x 20, anchor 8, 17): stage 0 sprout .. 3 mature. Unknown kinds draw as greyshank. */
export function cavePlantSprite(kind, stage = 2) {
  const st = Math.max(0, Math.min(3, stage | 0)), k = PLANTS[kind] ? kind : 'greyshank';
  const key = skey(`cave:${k}`, st), hit = peek(key);
  if (hit) return hit;
  return bake(key, 16, 20, 8, 17, (p) => {
    const b = 15;
    if (k !== 'merereed') { p.rect(3, b + 1, 10, 2, P.moss0); p.hl(4, b, 8, P.slate0); }   // cave floor under it
    PLANTS[k](p, st, b);
  });
}

/** [radius px, colour] of the faint light pool a glowing cavern kind casts (drawn by the light layer), or null. */
export function caveGlow(kind) {
  if (kind === 'lichen') return [14, P.teal];
  return null;
}
