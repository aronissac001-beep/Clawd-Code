// Creatures and plants (owner D; docs/ART-STYLE.md): the Hollow and other foes, animals, trees,
// bushes and crops, drawn as native pixel sprites with the same outline, palette and top-left light
// as the colonists. Foes read cool (blue-grey Hollow flesh, violet eyes that glow at night through
// pixel.js pixelRim); animals and plants read warm and green.
//
//   foeSprite(kind, frame, flip)      kind: raider id ('husk', 'gloom_hound', 'delver', 'gloomwyrm', 'colossus')
//                                     or the old unit names ('husk', 'hound', 'shade', 'knight'); frame 0 idle,
//                                     1-2 walk, 3 strike. 24 x 24 px (bosses 32 x 32), anchor at the feet.
//   animalSprite(kind, frame, flip)   'hen' | 'goat' | 'wolf' (others: a generic beast)
//   treeSprite(kind, v, stage)        'oak' | 'pine'; v 0-2 (shape variant); stage 0 sapling, 1 young, 2 grown
//   bushSprite(v, ripe)               a berry bush (berries when ripe)
//   cropSprite(kind, stage)           'hearthroot' (others: a generic leafy crop); stage 0-2
//   stageOf(growth)                   growth (0-255) -> stage 0-2
// Every record is the sprites.js shape in world units (pixel.js bake).

import { PAL, RAMP, dith } from './palette.js';
import { bake, skey, peek } from './pixel.js';

const P = PAL;
const H = RAMP.hollow;
/** Hollow flesh, dark to light: lighter than the rock ramps so a husk reads on a mined floor (no tone above lum 190, so only the bone eyes glow). */
const PALLID = [P.slate1, P.slate2, P.slate3];

// ---- Foes ------------------------------------------------------------------------------------------
const FOE_N = { husk: 0, hound: 1, delver: 2, wyrm: 3, colossus: 4 };
const FOE_ALIAS = { gloom_hound: 'hound', hound: 'hound', husk: 'husk', delver: 'delver', shade: 'wyrm', gloomwyrm: 'wyrm', knight: 'colossus', colossus: 'colossus' };
/** A foe sprite (cached). */
export function foeSprite(kind, frame = 0, flip = false) {
  const k = FOE_ALIAS[kind] || 'husk', f = frame & 3;
  const key = skey('foe', FOE_N[k] * 8 + f * 2 + (flip ? 1 : 0)), hit = peek(key);
  if (hit) return hit;
  const big = k === 'wyrm' || k === 'colossus', w = big ? 32 : 24, h = big ? 32 : 24, ax = w / 2, ay = big ? 29 : 20;
  return bake(key, w, h, ax, ay, (p) => {
    if (flip) { p.g.translate(w, 0); p.g.scale(-1, 1); }
    FOES[k](p, f);
    if (flip) p.g.setTransform(1, 0, 0, 1, 0, 0);
  }, { after: (p) => p.shadow(ax, ay + 1, big ? 8 : 5, 1.4, 8) });
}
const FOES = {
  husk(p, f) { // a Hollow shambler (restyled from the roguelite husk): gaunt lavender-grey flesh, stooped
    // forward, the skull pushed ahead of the shoulders, one arm reaching, the other hanging past the
    // knee, a plum loincloth in rags, bone eyes in dark sockets (they glow at night through pixelRim)
    const st = f === 1 ? 1 : f === 2 ? -1 : 0, atk = f === 3, F = PALLID;
    // thin legs with a knee, the far one darker; bare feet
    p.vl(10 - st, 14, 5, F[0]); p.px(11 - st, 16, F[0]); p.hl(9 - st, 19, 2, F[0]);
    p.vl(13 + st, 14, 5, F[1]); p.px(12 + st, 16, F[1]); p.hl(13 + st, 19, 2, F[1]);
    // the rags at the hip (jagged hem)
    p.rect(9, 12, 5, 3, P.plum0); p.hl(9, 12, 3, P.plum1); p.px(9, 15, P.plum0); p.px(12, 15, P.plum0);
    // the stooped torso, lit from the top-left; ribs
    p.rect(10, 7, 5, 2, F[1]); p.rect(9, 9, 5, 3, F[1]);
    p.hl(10, 7, 4, F[2]); p.vl(9, 9, 2, F[2]); p.px(10, 8, F[2]);
    p.px(12, 9, F[0]); p.px(11, 10, F[0]); p.px(12, 11, F[0]); p.vl(14, 7, 2, F[0]); p.vl(13, 9, 3, F[0]);
    // the skull ahead of the shoulders: sockets, bone eyes, a gaping jaw
    p.rect(14, 3, 4, 4, F[1]); p.hl(14, 3, 3, F[2]); p.px(14, 4, F[2]); p.px(18, 4, F[1]); p.px(18, 5, F[1]);
    p.hl(15, 7, 3, F[0]); p.px(17, 7, P.ink);
    p.px(15, 4, P.ink); p.px(17, 4, P.ink); p.px(15, 5, P.bone); p.px(17, 5, P.bone);
    if (atk) { // both arms flung up and forward, claws out
      p.line(14, 8, 20, 4, F[1]); p.line(11, 8, 19, 7, F[0]);
      p.px(21, 3, P.bone); p.px(21, 5, P.bone); p.px(20, 7, P.bone); p.px(20, 8, P.bone);
    } else { // the front arm reaching ahead, the back arm hanging past the knee, swaying with the walk
      p.line(14, 8, 17, 10 + (st > 0 ? 1 : 0), F[1]); p.px(18, 11 + (st > 0 ? 1 : 0), P.bone); p.px(17, 11 + (st > 0 ? 1 : 0), P.bone);
      p.vl(8, 8, 8 + (st < 0 ? 1 : 0), F[0]); p.px(9, 8, F[1]); p.px(8, 16 + (st < 0 ? 1 : 0), F[2]);
    }
  },
  hound(p, f) { // a gloom hound (restyled from the roguelite hound): a lean, low Hollow beast with a deep
    // chest, a ridge of dark spines, a long jaw of bone teeth and a whip tail
    const st = f === 1 ? 1 : f === 2 ? -1 : 0, atk = f === 3, y = atk ? -1 : 0, F = PALLID;
    // legs (the far pair darker), the walk swings them; claws
    p.rect(6 - st, 15, 2, 4, F[0]); p.rect(15 + st, 15, 2, 4, F[0]);
    p.rect(8 + st, 15 + y, 2, 4 - y, F[1]); p.rect(17 - st, 15 + y, 2, 4 - y, F[1]);
    p.px(9 + st, 18, P.bone); p.px(18 - st, 18, P.bone);
    // body: haunch, a tucked waist and the deep chest
    p.ellipse(10, 12.5 + y, 5, 2.6, F[1]); p.ellipse(16, 12 + y, 3.4, 3.6, F[1]);
    p.hl(7, 10 + y, 10, F[2]); p.px(6, 11 + y, F[2]); p.hl(8, 15 + y, 10, F[0]); p.dither(7, 14 + y, 12, 1, F[0], 8);
    p.px(12, 12 + y, F[0]); p.px(13, 13 + y, F[0]); p.px(15, 13 + y, F[0]);     // ribs
    for (let x = 7; x <= 16; x += 2) { p.px(x, 9 + y, P.plum1); p.px(x, 8 + y, P.plum0); } // spine ridge
    // head: skull, swept-back ear, long snout, the jaw (open when it strikes)
    p.rect(18, 8 + y, 4, 4, F[1]); p.hl(18, 8 + y, 4, F[2]); p.px(18, 7 + y, F[1]); p.px(17, 6 + y, F[0]);
    p.rect(22, 9 + y, 2, 2, F[1]); p.px(23, 9 + y, F[2]);
    p.px(19, 9 + y, P.ink); p.px(20, 9 + y, P.bone);                              // socket and eye (glows at night)
    if (atk) { p.hl(19, 13 + y, 5, F[0]); p.px(21, 12 + y, P.bone); p.px(23, 12 + y, P.bone); p.px(22, 13 + y, P.bone); }
    else { p.hl(19, 12 + y, 5, F[0]); p.px(21, 11 + y, P.bone); p.px(23, 11 + y, P.bone); }
    p.line(5, 12 + y, 2, 9 + y, F[1]); p.px(1, 8 + y, F[2]);                      // tail
  },
  delver(p, f) { // a gutterkin sapper: small and hunched, a pick and a lamp
    const st = f === 1 ? 1 : f === 2 ? -1 : 0, atk = f === 3;
    p.rect(10 - st, 17, 2, 3, P.umber1); p.rect(13 + st, 17, 2, 3, P.umber2);
    p.rect(9, 12, 7, 5, P.moss1); p.vl(9, 12, 5, P.moss2); p.hl(9, 16, 7, P.moss0);
    p.rect(10, 8, 6, 5, P.moss2); p.px(11, 8, P.moss3); p.px(12, 10, P.gold); p.px(14, 10, P.gold);
    p.px(9, 9, P.moss2); p.px(16, 9, P.moss2);                                    // ears
    p.rect(7, 13, 2, 3, P.slate1); p.px(7, 12, P.flame);                          // lamp
    if (atk) { p.line(16, 12, 20, 8, P.umber2); p.line(18, 7, 21, 10, P.slate3); }
    else { p.line(16, 13, 19, 16, P.umber2); p.line(18, 18, 21, 15, P.slate3); }
  },
  wyrm(p, f) { // the Gloomwyrm (placeholder until Stage 3): a serpent with ragged wings
    const flap = f & 1;
    p.rect(6, 16, 18, 6, H[2]); p.hl(6, 16, 18, H[3]); p.hl(6, 21, 18, H[1]);
    p.line(5, 20, 1, 26, H[1]); p.line(24, 18, 28, 14, H[2]);
    p.rect(25, 11, 6, 5, H[2]); p.px(29, 12, P.bone); p.px(27, 12, P.bone);
    const wy = flap ? 6 : 10;
    p.line(10, 16, 6, wy, H[1]); p.line(6, wy, 18, wy + 2, H[1]); p.line(18, wy + 2, 18, 16, H[1]);
    p.dither(8, wy + 1, 10, 16 - wy - 1, P.slate0, 10);
  },
  colossus(p, f) { // the Bone Colossus (placeholder until Stage 3): a great skeleton
    const st = f === 1 ? 1 : f === 2 ? -1 : 0;
    p.rect(11 - st, 22, 3, 7, P.mist); p.rect(18 + st, 22, 3, 7, P.slate3);
    p.rect(10, 12, 12, 10, P.night); for (let y = 13; y < 21; y += 2) p.hl(11, y, 10, P.mist);
    p.vl(16, 12, 10, P.bone);
    p.rect(12, 4, 8, 8, P.mist); p.hl(12, 4, 8, P.bone); p.rect(13, 7, 2, 2, P.ink); p.rect(17, 7, 2, 2, P.ink); p.px(14, 8, P.violet); p.px(18, 8, P.violet);
    p.rect(7, 12, 3, 10, P.slate3); p.rect(22, 12, 3, 10, P.slate3);
  },
};

// ---- Animals -----------------------------------------------------------------------------------------
/** An animal sprite (cached). */
export function animalSprite(kind, frame = 0, flip = false) {
  const k = ANIMALS[kind] ? kind : 'wolf', f = frame & 3;
  const key = skey(k, f * 2 + (flip ? 1 : 0)), hit = peek(key);
  if (hit) return hit;
  return bake(key, 24, 24, 12, 20, (p) => {
    if (flip) { p.g.translate(24, 0); p.g.scale(-1, 1); }
    ANIMALS[k](p, f);
    if (flip) p.g.setTransform(1, 0, 0, 1, 0, 0);
  }, { after: (p) => p.shadow(12, 21, k === 'hen' ? 3 : 5, 1.2, 8) });
}
const ANIMALS = {
  hen(p, f) {
    const st = f === 1 || f === 2;
    p.px(11, 19, P.gold); p.px(13, 19 - (st ? 1 : 0), P.gold); p.vl(11, 17, 2, P.gold); p.vl(13, 17, 2, P.gold);
    p.rect(9, 12, 7, 5, P.bone); p.hl(9, 16, 7, P.mist); p.rect(8, 11, 2, 3, P.mist); // body, tail
    p.rect(14, 9, 3, 4, P.bone); p.px(15, 8, P.danger); p.px(16, 8, P.danger); p.px(17, 11, P.gold); p.px(15, 10, P.ink); p.px(16, 13, P.danger);
    p.px(11, 13, P.mist);
  },
  goat(p, f) {
    const st = f === 1 ? 1 : f === 2 ? -1 : 0;
    p.rect(7 + st, 16, 2, 4, P.slate3); p.rect(10 - st, 16, 2, 4, P.mist); p.rect(14 + st, 16, 2, 4, P.slate3); p.rect(16 - st, 16, 2, 4, P.mist);
    p.rect(6, 11, 13, 6, P.mist); p.hl(6, 11, 13, P.bone); p.hl(6, 16, 13, P.slate3);
    p.rect(17, 7, 4, 5, P.mist); p.hl(17, 7, 4, P.bone); p.px(19, 9, P.ink); p.px(20, 12, P.slate3); p.px(20, 13, P.slate3);
    p.line(17, 6, 15, 4, P.stone1); p.line(19, 6, 18, 3, P.stone1);
    p.px(5, 11, P.mist);
  },
  wolf(p, f) {
    const st = f === 1 ? 1 : f === 2 ? -1 : 0;
    const r = RAMP.slate;
    p.rect(6 + st, 16, 2, 4, r[1]); p.rect(9 - st, 16, 2, 4, r[2]); p.rect(14 + st, 16, 2, 4, r[1]); p.rect(16 - st, 16, 2, 4, r[2]);
    p.rect(5, 11, 13, 6, r[2]); p.hl(5, 11, 13, r[3]); p.hl(5, 16, 13, r[1]); p.hl(6, 15, 10, P.mist);
    p.rect(17, 8, 5, 5, r[2]); p.hl(17, 8, 5, r[3]); p.rect(21, 10, 2, 2, r[2]); p.px(19, 9, P.gold); p.px(22, 11, P.ink);
    p.px(18, 7, r[2]); p.px(20, 7, r[2]);
    p.line(4, 12, 1, 15, r[2]);
  },
};

// ---- Plants -------------------------------------------------------------------------------------------
/** Growth (0-255) to a stage: 0 sapling, 1 young, 2 grown. */
export const stageOf = (gr) => (gr < 90 ? 0 : gr < 190 ? 1 : 2);

/** Canopy clusters shaded from the top-left with a dither between the tones (r: dark .. light ramp). */
function clusters(p, list, r) {
  // list: [cx, cy, radius] discs; every pixel takes the light of the nearest-front disc
  let x0 = 99, y0 = 99, x1 = -99, y1 = -99;
  for (const [cx, cy, rr] of list) { x0 = Math.min(x0, cx - rr); y0 = Math.min(y0, cy - rr); x1 = Math.max(x1, cx + rr); y1 = Math.max(y1, cy + rr); }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    let best = -1, lit = 0;
    for (let k = 0; k < list.length; k++) {
      const [cx, cy, rr] = list[k], dx = (x + 0.5 - cx) / rr, dy = (y + 0.5 - cy) / rr, d = dx * dx + dy * dy;
      if (d > 1) continue;
      best = k; lit = -(dx * 0.62 + dy * 0.78) * 0.9 + (1 - d) * 0.35; // later discs sit in front
    }
    if (best < 0) continue;
    const t = (lit + 0.6) * 2.2; // ~0..3.5
    const lv = Math.max(0, Math.min(3, Math.floor(t))), f = t - Math.floor(t);
    const c = lv < 3 && f > 0.55 && dith(x, y, 8) ? r[lv + 1] : r[lv];
    p.px(x, y, c);
  }
}
const LEAF = [P.moss0, P.moss1, P.moss2, P.moss3];
const NEEDLE = [P.moss0, P.moss0, P.moss1, P.moss2];
/** A tree (cached). Grown oak: 28 x 32 px, the trunk base at the anchor (the tile centre, a little low). */
export function treeSprite(kind = 'oak', v = 0, stage = 2) {
  const pine = kind === 'pine', vv = v % 3, st = Math.max(0, Math.min(2, stage | 0));
  const key = skey('tree', (pine ? 9 : 0) + vv * 3 + st), hit = peek(key);
  if (hit) return hit;
  return bake(key, 28, 34, 14, 31, (p) => {
    const s = [0.45, 0.72, 1][st];
    const tr = RAMP.darkwood;
    const th = Math.round(7 * s) + 2, tw = st ? 4 : 2, base = 31;
    p.rect(14 - (tw >> 1), base - th, tw, th, tr[1]); p.vl(14 - (tw >> 1), base - th, th, tr[2]); if (tw > 2) p.vl(14 + (tw >> 1) - 1, base - th, th, tr[0]);
    if (st === 2) { p.px(12, base - 1, tr[1]); p.px(17, base - 1, tr[1]); }
    const top = base - th;
    if (pine) {
      const tiers = st === 2 ? 4 : st === 1 ? 3 : 2;
      for (let k = 0; k < tiers; k++) {
        const w = Math.round((11 - k * 2.2) * s + 2), y = top - k * Math.round(5 * s + 1) + 1, hgt = Math.round(6 * s + 2);
        for (let j = 0; j < hgt; j++) {
          const hw = Math.max(1, Math.round((w * (j + 1)) / hgt));
          for (let x = 14 - hw; x < 14 + hw; x++) {
            const right = x >= 14 + (vv - 1), c = j === 0 ? NEEDLE[3] : right ? (dith(x, y + j - hgt, 6) ? NEEDLE[0] : NEEDLE[1]) : x < 14 - hw + 2 ? NEEDLE[3] : NEEDLE[2];
            p.px(x, y - hgt + j, c);
          }
        }
      }
      p.px(14, top - tiers * Math.round(5 * s + 1) - Math.round(6 * s + 2) + 2, NEEDLE[3]);
      return;
    }
    const R = (a) => a * s;
    const shapes = [
      [[14, top - R(5), R(8)], [8, top - R(8), R(6)], [20, top - R(8), R(6)], [11, top - R(13), R(6.5)], [17, top - R(14), R(6)]],
      [[14, top - R(6), R(8.5)], [9, top - R(10), R(6)], [19, top - R(10), R(7)], [14, top - R(15), R(6)]],
      [[13, top - R(5), R(7)], [19, top - R(6), R(6)], [10, top - R(11), R(6)], [17, top - R(12), R(7)], [13, top - R(16), R(4.5)]],
    ];
    clusters(p, shapes[vv].map(([x, y, r]) => [x, y, Math.max(2, r)]), LEAF);
  });
}
/** A berry bush (cached): a low cluster with red berries when ripe. */
export function bushSprite(v = 0, ripe = true) {
  const key = skey('bush', (v % 3) * 2 + (ripe ? 1 : 0)), hit = peek(key);
  if (hit) return hit;
  return bake(key, 16, 14, 8, 12, (p) => {
    clusters(p, [[5, 8, 4], [11, 8, 4], [8, 5, 4.5]], LEAF);
    if (ripe) for (const [x, y] of [[3, 7], [7, 4], [10, 6], [11, 9], [5, 10], [8, 8]].slice(0, 4 + (v % 3))) { p.rect(x, y, 2, 2, P.danger); p.px(x, y, P.peach); p.px(x + 1, y + 1, P.ember1); }
  });
}
/**
 * A crop at its stage (cached), 16 x 16 px with its base on a soil mound: stage 0 sown (two sprouts),
 * 1 young (a fan of leaves), 2 grown. Hearthroot shows its orange crowns at the soil and ember-tipped
 * leaves when grown; other crops a generic leafy plant with gold seed heads.
 */
export function cropSprite(kind = 'hearthroot', stage = 2) {
  const st = Math.max(0, Math.min(2, stage | 0));
  const key = skey(kind === 'hearthroot' ? 'crop' : `crop:${kind}`, st), hit = peek(key);
  if (hit) return hit;
  return bake(key, 16, 16, 8, 13, (p) => {
    // the mound of tilled soil
    p.rect(3, 12, 10, 2, P.umber1); p.hl(4, 11, 8, P.umber2); p.px(5, 11, P.umber3); p.px(10, 13, P.umber0);
    const leaf = (x, y, dx, hgt, c, tip) => { for (let k = 0; k < hgt; k++) p.px(x + Math.round((dx * k) / hgt), y - k, k === hgt - 1 && tip ? tip : c); };
    if (st === 0) { leaf(7, 11, -1, 3, P.moss3); leaf(9, 11, 1, 3, P.moss2); p.px(6, 9, P.moss3); p.px(10, 9, P.moss3); return; }
    const h = st === 1 ? 5 : 8, ember = kind === 'hearthroot' && st === 2 ? P.orange : null;
    leaf(6, 11, -4, h - 1, P.moss1, ember); leaf(10, 11, 4, h - 1, P.moss1, ember);
    leaf(7, 11, -2, h, P.moss2, ember); leaf(9, 11, 2, h, P.moss2, ember);
    leaf(8, 11, 0, h + 1, P.moss3, ember);
    if (st === 2 && kind === 'hearthroot') { // the crowns of the roots breaking the soil
      p.rect(5, 11, 2, 2, P.orange); p.px(5, 11, P.gold); p.rect(9, 11, 3, 2, P.orange); p.px(9, 11, P.gold); p.px(11, 12, P.ember1);
    }
    if (st === 2 && kind !== 'hearthroot') { p.px(4, 4, P.gold); p.px(12, 4, P.gold); p.px(8, 2, P.gold); }
  });
}
