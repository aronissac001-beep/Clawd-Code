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
const FOE_N = { husk: 0, hound: 1, delver: 2, wyrm: 3, colossus: 4, swift: 5, shade: 6, knight: 7, rift: 8, thief: 9, reaver: 10, reaver_spear: 11, reaver_bow: 12,
  reaver_xbow: 13, captain: 14, wolf: 15, boar: 16, spider: 17, great_spider: 18 };
const FOE_ALIAS = { gloom_hound: 'hound', hound: 'hound', husk: 'husk', delver: 'delver', gloomwyrm: 'wyrm', colossus: 'colossus',
  // Stage 2: raider ids and art key names
  swift_husk: 'swift', shade: 'shade', hollow_knight: 'knight', knight: 'knight', rift: 'rift', gutter_thief: 'thief', thief: 'thief',
  reaver_club: 'reaver', reaver: 'reaver', reaver_spear: 'reaver_spear', reaver_bow: 'reaver_bow', reaver_xbow: 'reaver_xbow', reaver_captain: 'captain', captain: 'captain',
  wolf: 'wolf', boar: 'boar', cave_spider: 'spider', spider: 'spider', great_spider: 'great_spider' };
/** Foe kinds drawn on a 32 px canvas. */
const BIG = new Set(['wyrm', 'colossus', 'great_spider', 'rift']);
/** A foe sprite (cached). */
export function foeSprite(kind, frame = 0, flip = false) {
  const k = FOE_ALIAS[kind] || 'husk', f = frame & 3;
  const key = skey('foe', FOE_N[k] * 8 + f * 2 + (flip ? 1 : 0)), hit = peek(key);
  if (hit) return hit;
  const big = BIG.has(k), w = big ? 32 : 24, h = big ? 32 : 24, ax = w / 2, ay = big ? 29 : 20;
  return bake(key, w, h, ax, ay, (p) => {
    if (flip) { p.g.translate(w, 0); p.g.scale(-1, 1); }
    FOES[k](p, f);
    if (flip) p.g.setTransform(1, 0, 0, 1, 0, 0);
  }, { after: (p) => { if (k !== 'rift' && k !== 'shade') p.shadow(ax, ay + 1, big ? 8 : 5, 1.4, 8); } });
}
// ---- Stage 2 foes: people-shaped raiders share one rig (Ashfang reavers in rust and black leather,
// the Gutterkin small and green), the Hollow variants restyle the husk, beasts reuse the animals with
// a hostile red eye.
/** A raider rig: legs, body in `cloth`, a head, then the weapon by `arm` ('club' | 'spear' | 'bow' | 'xbow' | 'sword' | 'sack'). */
function raiderRig(p, f, o) {
  const st = f === 1 ? 1 : f === 2 ? -1 : 0, atk = f === 3, sm = o.small ? 2 : 0, y0 = sm;
  const legs = o.legs || P.umber1, body = o.cloth, skin = o.skin, x = 12;
  p.rect(x - 3 - st, 15 + y0, 2, 5 - y0, legs); p.rect(x + 1 + st, 15 + y0, 2, 5 - y0, legs); p.hl(x - 4 - st, 19, 3, P.umber0); p.hl(x + 1 + st, 19, 3, P.umber0);
  p.rect(x - 4, 8 + y0, 8, 7, body[1]); p.vl(x - 4, 8 + y0, 7, body[2]); p.vl(x + 3, 8 + y0, 7, body[0]); p.hl(x - 4, 13 + y0, 8, P.umber0);
  if (o.trim) { p.line(x - 3, 8 + y0, x + 2, 12 + y0, o.trim); p.hl(x - 4, 12 + y0, 8, o.trim); }
  p.rect(x - 3, 3 + y0, 6, 5, skin[1]); p.hl(x - 3, 3 + y0, 6, skin[2]); p.px(x + 1, 5 + y0, P.ink); p.px(x - 2, 5 + y0, P.ink);
  if (o.hood) { p.hl(x - 4, 2 + y0, 8, o.hood); p.vl(x - 4, 2 + y0, 4, o.hood); p.vl(x + 3, 2 + y0, 3, o.hood); }
  if (o.ears) { p.px(x - 4, 4 + y0, skin[1]); p.px(x + 3, 4 + y0, skin[1]); p.px(x - 5, 3 + y0, skin[2]); p.px(x + 4, 3 + y0, skin[2]); }
  if (o.helm) { p.rect(x - 3, 2 + y0, 6, 2, P.slate2); p.hl(x - 3, 2 + y0, 6, P.slate3); p.px(x, 1 + y0, o.plume || P.danger); }
  const hx = x + 4, hy = 10 + y0;
  switch (o.arm) {
    case 'club': if (atk) p.line(hx, hy, hx + 6, hy - 6, RAMP.wood[1]); else p.line(hx, hy, hx + 2, hy + 6, RAMP.wood[1]); p.rect(atk ? hx + 5 : hx + 1, atk ? hy - 8 : hy + 6, 3, 3, RAMP.wood[2]); break;
    case 'spear': if (atk) { p.line(hx - 4, hy, hx + 8, hy, RAMP.wood[1]); p.px(hx + 9, hy, P.mist); p.px(hx + 8, hy - 1, P.mist); } else { p.vl(hx, hy - 10, 14, RAMP.wood[1]); p.px(hx, hy - 11, P.mist); p.px(hx, hy - 12, P.bone); } break;
    case 'bow': p.line(hx + 1, hy - 6, hx + 3, hy, RAMP.wood[2]); p.line(hx + 3, hy, hx + 1, hy + 6, RAMP.wood[2]); p.vl(hx + (atk ? -1 : 1), hy - 5, 11, P.bone); if (atk) p.hl(hx - 2, hy, 6, RAMP.wood[3]); break;
    case 'xbow': p.hl(hx - 2, hy, 7, RAMP.darkwood[1]); p.vl(hx + 4, hy - 3, 7, P.slate2); if (atk) p.px(hx + 6, hy, P.mist); break;
    case 'sword': if (atk) p.line(hx, hy, hx + 7, hy - 7, P.mist); else p.vl(hx + 1, hy - 1, 8, P.mist); p.hl(hx - 1, atk ? hy : hy - 1, 3, P.gold); break;
    case 'sack': p.rect(x - 9, 7 + y0, 5, 6, RAMP.sandy[1]); p.hl(x - 9, 7 + y0, 5, RAMP.sandy[2]); p.px(x - 7, 6 + y0, RAMP.sandy[0]); break;
    default: break;
  }
}
const REAVER = { cloth: RAMP.red, legs: P.umber0, skin: RAMP.skin, trim: P.ink, hood: null };
const GUTTER = { cloth: RAMP.grass, legs: P.umber1, skin: [P.moss1, P.moss2, P.moss3], small: true, ears: true };
const FOES2 = {
  swift(p, f) { // a swift husk: leaner, bent low, legs mid-stride (the husk rig shifted)
    FOES.husk(p, f === 0 ? 1 : f);
    p.px(19, 4, P.danger);
  },
  shade(p, f) { // a shade: a ragged dark shroud with no legs, violet eyes, wisps trailing
    const sway = f === 1 ? 1 : f === 2 ? -1 : 0, F = [P.ink, P.night, P.slate0];
    for (let y = 4; y < 20; y++) { const hw = Math.round(2 + (y - 4) * 0.35), x0 = 12 - hw + (y > 14 ? sway : 0); p.hl(x0, y, hw * 2, y < 8 ? F[2] : F[1]); p.px(x0, y, P.slate1); }
    for (let x = 7; x < 18; x += 2) p.px(x + sway, 20 + ((x >> 1) & 1), F[0]);
    p.px(10, 7, P.violet); p.px(13, 7, P.violet);
    if (f === 3) { p.line(15, 10, 21, 6, F[1]); p.px(22, 5, P.violet); }
  },
  knight(p, f) { // a Hollow knight: plate in pallid iron, a horned helm, a great blade
    const st = f === 1 ? 1 : f === 2 ? -1 : 0, atk = f === 3, A = RAMP.iron;
    p.rect(9 - st, 15, 3, 5, A[0]); p.rect(13 + st, 15, 3, 5, A[1]);
    p.rect(8, 7, 9, 8, A[1]); p.vl(8, 7, 8, A[2]); p.hl(8, 7, 9, A[2]); p.vl(16, 7, 8, A[0]); p.hl(9, 11, 7, A[0]);
    p.rect(9, 1, 7, 6, A[1]); p.hl(9, 1, 7, A[2]); p.hl(10, 4, 5, P.ink); p.px(11, 4, P.bone); p.px(14, 4, P.bone);
    p.px(8, 0, P.bone); p.px(16, 0, P.bone); p.px(7, -1, P.bone); p.px(17, -1, P.bone);
    if (atk) p.line(17, 9, 23, 2, P.mist); else p.vl(18, 6, 12, P.mist);
    p.hl(17, atk ? 9 : 10, 3, P.slate1);
  },
  rift(p, f) { // the Hollow Rift: a standing tear of violet and teal light, ragged black edges
    const pulse = f & 1;
    for (let y = 4; y < 30; y++) {
      const t = (y - 4) / 26, hw = Math.round(1 + Math.sin(t * Math.PI) * (5 + pulse));
      p.hl(16 - hw - 1, y, hw * 2 + 2, P.ink);
      p.hl(16 - hw, y, hw * 2, (y + f) % 3 ? P.violet : P.plum1);
      if (hw > 2) p.hl(16 - 1, y, 2, y % 2 ? P.teal : P.bone);
    }
    for (const [x, y] of [[9, 8], [23, 12], [8, 22], [24, 25], [12, 3]]) p.px(x + pulse, y, P.violet);
  },
  thief(p, f) { raiderRig(p, f, { ...GUTTER, arm: 'sack' }); p.px(10, 7, P.gold); p.px(13, 7, P.gold); },
  reaver(p, f) { raiderRig(p, f, { ...REAVER, arm: 'club', hood: P.umber0 }); },
  reaver_spear(p, f) { raiderRig(p, f, { ...REAVER, arm: 'spear', helm: true, plume: P.ember1 }); },
  reaver_bow(p, f) { raiderRig(p, f, { ...REAVER, cloth: RAMP.earth, arm: 'bow', hood: P.ember0 }); },
  reaver_xbow(p, f) { raiderRig(p, f, { ...REAVER, cloth: RAMP.iron, arm: 'xbow', helm: true }); },
  captain(p, f) { // the captain: a red cloak, a plumed helm, a sword
    p.rect(6, 8, 3, 9, P.ember1); p.vl(6, 8, 9, P.ember0);
    raiderRig(p, f, { ...REAVER, cloth: RAMP.iron, arm: 'sword', helm: true, plume: P.gold, trim: P.gold });
  },
  wolf(p, f) { ANIMALS.wolf(p, f); p.px(19, 9, P.danger); },
  boar(p, f) { ANIMALS.boar(p, f); p.px(18, 11, P.danger); },
  spider(p, f) { ANIMALS.spider(p, f); p.px(17, 12, P.danger); p.px(19, 12, P.danger); },
  great_spider(p, f) { // a great spider on the 32 px canvas: the cave spider twice the size, a pale hourglass
    const st = f & 1, B = RAMP.plum;
    for (let k = 0; k < 4; k++) { const y = 18 + k * 2; p.line(14, y, 3 + k * 2, y + 6 + (st ^ (k & 1)) * 2, P.ink); p.line(18, y, 29 - k * 2, y + 6 + ((st + k) & 1) * 2, P.ink); }
    p.ellipse(16, 20, 8, 6, B[0]); p.ellipse(16, 19, 6, 4, B[1]); p.px(14, 17, B[2]);
    p.rect(15, 18, 2, 4, P.bone); p.ellipse(16, 13, 4, 3, B[0]);
    p.px(14, 12, P.danger); p.px(17, 12, P.danger); p.px(15, 11, P.danger); p.px(16, 11, P.danger);
    if (f === 3) { p.px(13, 16, P.bone); p.px(19, 16, P.bone); }
  },
};
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
  }, { after: (p) => p.shadow(12, 21, k === 'hen' || k === 'hare' || k === 'beetle' ? 3 : k === 'ox' ? 8 : 5, 1.2, 8) });
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
  // ---- Stage 2 ----
  sheep(p, f) { // a woolly bone-white body in lumps, a dark face and legs
    const st = f === 1 ? 1 : f === 2 ? -1 : 0;
    for (const x of [7 + st, 10 - st, 14 + st, 16 - st]) p.rect(x, 16, 2, 4, P.slate1);
    p.ellipse(12, 12.5, 7, 4.2, P.mist);
    for (const [x, y] of [[7, 10], [10, 9], [13, 9], [16, 10], [8, 14], [12, 14], [15, 14]]) { p.px(x, y, P.bone); p.px(x + 1, y + 1, P.slate3); }
    p.rect(18, 9, 4, 4, P.slate2); p.hl(18, 9, 4, P.slate3); p.px(21, 10, P.ink); p.px(17, 9, P.mist); p.px(21, 12, P.peach);
  },
  ox(p, f) { // a heavy brown ox: deep body, pale horns, a darker hump
    const st = f === 1 ? 1 : f === 2 ? -1 : 0, r = RAMP.earth;
    for (const x of [4 + st, 7 - st, 15 + st, 18 - st]) p.rect(x, 16, 3, 4, r[0]);
    p.rect(3, 9, 18, 8, r[2]); p.hl(3, 9, 18, r[3]); p.hl(3, 16, 18, r[0]); p.dither(12, 10, 9, 6, r[1], 6); p.rect(6, 7, 6, 3, r[1]);
    p.rect(19, 8, 5, 6, r[2]); p.hl(19, 8, 5, r[3]); p.px(21, 10, P.ink); p.rect(22, 12, 2, 2, P.peach);
    p.line(19, 7, 17, 4, P.bone); p.line(23, 7, 24, 4, P.bone); p.line(2, 10, 1, 15, r[1]);
  },
  deer(p, f) { // a slender tan deer: white tail, antlers
    const st = f === 1 ? 1 : f === 2 ? -1 : 0;
    for (const x of [7 + st, 9 - st, 15 + st, 17 - st]) p.vl(x, 15, 5, P.umber2);
    p.ellipse(12, 12, 6, 3.4, P.tan); p.hl(7, 9, 10, P.sand); p.hl(8, 15, 8, P.umber2); p.px(6, 10, P.bone);
    p.rect(17, 6, 3, 6, P.tan); p.rect(19, 5, 4, 3, P.tan); p.px(21, 6, P.ink); p.px(23, 7, P.umber0);
    p.line(19, 4, 17, 0, P.umber2); p.px(16, 1, P.umber2); p.line(21, 4, 22, 0, P.umber2); p.px(23, 1, P.umber2);
  },
  boar(p, f) { // a dark bristly boar: humped back, tusks
    const st = f === 1 ? 1 : f === 2 ? -1 : 0, r = RAMP.darkwood;
    for (const x of [6 + st, 9 - st, 14 + st, 16 - st]) p.rect(x, 16, 2, 4, r[0]);
    p.ellipse(11, 12.5, 7, 4, r[1]); for (let x = 6; x < 16; x += 2) p.px(x, 8 + ((x >> 1) & 1), r[0]); p.hl(6, 10, 9, r[2]);
    p.rect(17, 10, 5, 5, r[1]); p.rect(21, 12, 2, 2, P.peach); p.px(19, 11, P.ink); p.px(22, 14, P.bone); p.px(22, 15, P.bone);
    p.line(4, 11, 3, 13, r[0]);
  },
  spider(p, f) { // a cave spider: plum body, eight legs in two lines
    const st = f & 1, B = RAMP.plum;
    for (let k = 0; k < 4; k++) { const y = 12 + k; p.line(10, y, 3 + k, y + 4 + ((st + k) & 1), P.ink); p.line(14, y, 21 - k, y + 4 + ((st + k + 1) & 1), P.ink); }
    p.ellipse(12, 14, 5, 3.5, B[0]); p.ellipse(12, 13, 4, 2.5, B[1]); p.px(11, 12, B[2]);
    p.ellipse(17, 12, 2.5, 2, B[0]); p.px(17, 12, P.bone); p.px(19, 12, P.bone);
  },
  hare(p, f) { // a small tan hare with long ears
    const st = f === 1 || f === 2;
    p.ellipse(11, 16, 4, 2.6, P.tan); p.hl(8, 14, 6, P.sand); p.px(7, 15, P.bone);
    p.rect(14, 12, 3, 3, P.tan); p.px(16, 13, P.ink); p.vl(14, 8, 4, P.tan); p.vl(15, 8 - (st ? 1 : 0), 4, P.sand);
    p.rect(9 + (st ? 1 : 0), 18, 3, 1, P.umber2);
  },
  beetle(p, f) { // a cave beetle: a domed dark shell with a teal sheen
    const st = f & 1;
    for (let k = 0; k < 3; k++) { p.line(9, 14 + k * 2, 6, 16 + k * 2 + st, P.ink); p.line(15, 14 + k * 2, 18, 16 + k * 2 + (st ^ 1), P.ink); }
    p.ellipse(12, 15, 4.5, 4, P.night); p.vl(12, 11, 8, P.ink); p.px(10, 13, P.teal); p.px(14, 13, P.teal); p.px(11, 12, P.slate2);
    p.rect(11, 9, 3, 2, P.night); p.px(10, 8, P.slate1); p.px(14, 8, P.slate1);
  },
};

// ---- Plants -------------------------------------------------------------------------------------------
/** Growth (0-255) to a stage: 0 sown or sapling, 1 young, 2 grown, 3 ripe (255: ready to harvest).
 *  Trees have three looks (3 draws as 2). */
export const stageOf = (gr) => (gr < 90 ? 0 : gr < 190 ? 1 : gr < 255 ? 2 : 3);

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
 * A crop at its stage (cached), 16 x 16 px with its base on a soil mound: stage 0 sown (sprouts),
 * 1 young, 2 grown, 3 ripe (ready to harvest). Eight looks (doc 6.5): hearthroot (orange crowns at the
 * soil), grain (stalks that turn gold), greens (a leafy rosette), flax (thin stems, blue flowers),
 * herb (a bushy clump, white flowers), glowcap (teal caps that glow, on cave moss), berry (a bush
 * with red berries), apple (a young fruit tree with red apples); other ids: a generic leafy crop.
 */
export const CROP_KINDS = Object.freeze(['hearthroot', 'grain', 'greens', 'flax', 'herb', 'glowcap', 'berry', 'apple']);
export function cropSprite(kind = 'hearthroot', stage = 2) {
  const st = Math.max(0, Math.min(3, stage | 0));
  const kn = CROP_KINDS.includes(kind) ? kind : 'generic';
  const key = skey(kind === 'hearthroot' ? 'crop' : `crop:${kn}`, st), hit = peek(key);
  if (hit) return hit;
  return bake(key, 16, 20, 8, 17, (p) => {
    const Y = 4; // the art sits 4 px lower in the 20 px canvas (tall crops reach up)
    const leaf = (x, y, dx, hgt, c, tip) => { for (let k = 0; k < hgt; k++) p.px(x + Math.round((dx * k) / hgt), y - k, k === hgt - 1 && tip ? tip : c); };
    // the mound (cave moss for glowcaps)
    if (kn === 'glowcap') { p.rect(3, 12 + Y, 10, 2, P.moss0); p.hl(4, 11 + Y, 8, P.moss1); }
    else { p.rect(3, 12 + Y, 10, 2, P.umber1); p.hl(4, 11 + Y, 8, P.umber2); p.px(5, 11 + Y, P.umber3); p.px(10, 13 + Y, P.umber0); }
    const b = 11 + Y;
    if (st === 0) { // sprouts (glowcap: pinhead caps)
      if (kn === 'glowcap') { p.px(6, b - 1, P.bone); p.px(9, b - 1, P.teal); p.px(11, b - 1, P.bone); return; }
      leaf(7, b, -1, 3, P.moss3); leaf(9, b, 1, 3, P.moss2); p.px(6, b - 2, P.moss3); p.px(10, b - 2, P.moss3); return;
    }
    const h = st === 1 ? 5 : 8, ripe = st === 3;
    switch (kn) {
      case 'grain': {
        const c = ripe ? P.gold : st === 2 ? P.moss3 : P.moss2;
        for (const x of [4, 6, 8, 10, 12]) { p.vl(x, b - h - (x & 2 ? 1 : 0), h + (x & 2 ? 1 : 0), ripe ? P.tan : P.moss2); if (st >= 2) { p.rect(x - (x === 12 ? 1 : 0), b - h - 3 - (x & 2 ? 1 : 0), 2, 3, c); p.px(x, b - h - 4 - (x & 2 ? 1 : 0), ripe ? P.sand : P.moss3); } }
        return;
      }
      case 'greens': {
        const w = st === 1 ? 3 : st === 2 ? 5 : 6;
        p.ellipse(8, b - 2, w, Math.max(2, w - 2), P.moss2); p.ellipse(8, b - 3, w - 1, Math.max(1, w - 3), P.moss3); p.vl(8, b - 4, 3, P.moss1);
        if (ripe) { p.px(5, b - 4, P.bone); p.px(11, b - 3, P.moss1); p.ellipse(8, b - 4, 2, 1.5, P.moss3); }
        return;
      }
      case 'flax': {
        for (const x of [5, 7, 9, 11]) leaf(x, b, (x - 8) >> 1, h + 1, P.moss2);
        if (st >= 2) for (const [x, y] of [[4, b - h - 1], [7, b - h - 2], [10, b - h - 1], [12, b - h]]) { p.px(x, y, ripe ? P.water : P.shallow); if (ripe) { p.px(x + 1, y, P.shallow); p.px(x, y - 1, P.mist); } }
        return;
      }
      case 'herb': {
        p.ellipse(8, b - 2, st === 1 ? 3 : 5, st === 1 ? 2 : 4, P.moss1); p.dither(4, b - 6, 9, 5, P.moss2, 8); p.px(6, b - 4, P.moss3); p.px(10, b - 5, P.moss3);
        if (st >= 2) for (const [x, y] of [[5, b - 6], [9, b - 7], [12, b - 4]]) p.px(x, y, ripe ? P.bone : P.mist);
        return;
      }
      case 'glowcap': {
        const caps = st === 1 ? [[7, 3]] : st === 2 ? [[6, 4], [10, 3]] : [[5, 5], [9, 6], [12, 3]];
        for (const [x, hh] of caps) { p.vl(x, b - hh, hh, P.bone); p.rect(x - 2, b - hh - 2, 5, 2, ripe ? P.teal : P.shallow); p.hl(x - 1, b - hh - 3, 3, ripe ? P.mist : P.teal); p.px(x - 2, b - hh - 1, P.slate1); }
        return;
      }
      case 'berry': {
        const r = st === 1 ? 3 : st === 2 ? 4.5 : 5;
        p.ellipse(8, b - r, r + 1, r, P.moss1); p.ellipse(7, b - r - 1, r, r - 1, P.moss2); p.px(6, b - r - 2, P.moss3); p.px(9, b - r - 3, P.moss3);
        if (st >= 2) for (const [x, y] of [[5, b - 4], [9, b - 6], [11, b - 3], [7, b - 2]]) { p.px(x, y, ripe ? P.danger : P.moss3); if (ripe) p.px(x + 1, y + 1, P.ember1); }
        return;
      }
      case 'apple': {
        const tr = RAMP.darkwood, th = st === 1 ? 4 : 6;
        p.rect(7, b - th, 2, th, tr[1]); p.vl(7, b - th, th, tr[2]);
        const r = st === 1 ? 3 : 5;
        p.ellipse(8, b - th - r + 1, r + 1, r, P.moss1); p.ellipse(7, b - th - r, r, r - 1, P.moss2); p.px(6, b - th - r - 1, P.moss3);
        if (st >= 2) for (const [x, y] of [[5, b - th - 2], [10, b - th - 4], [8, b - th - 1], [11, b - th - 1]]) p.px(x, y, ripe ? P.danger : P.moss3);
        if (ripe) { p.px(6, b - 1, P.danger); }
        return;
      }
      default: break;
    }
    // hearthroot and the generic leafy crop
    const ember = kind === 'hearthroot' && st >= 2 ? P.orange : null;
    leaf(6, b, -4, h - 1, P.moss1, ember); leaf(10, b, 4, h - 1, P.moss1, ember);
    leaf(7, b, -2, h, P.moss2, ember); leaf(9, b, 2, h, P.moss2, ember);
    leaf(8, b, 0, h + 1, P.moss3, ember);
    if (kind === 'hearthroot' && ripe) { // the crowns of the roots breaking the soil
      p.rect(5, b, 2, 2, P.orange); p.px(5, b, P.gold); p.rect(9, b, 3, 2, P.orange); p.px(9, b, P.gold); p.px(11, b + 1, P.ember1);
    }
    if (kn === 'generic' && st >= 2) { p.px(4, b - 7, ripe ? P.gold : P.moss3); p.px(12, b - 7, ripe ? P.gold : P.moss3); p.px(8, b - 9, ripe ? P.gold : P.moss3); }
  });
}

// Stage 2 foes join the table once both FOES and ANIMALS exist (module order).
Object.assign(FOES, FOES2);
