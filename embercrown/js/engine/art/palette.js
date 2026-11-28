// The shared pixel-art palette (owner D; docs/ART-STYLE.md). Every art function in js/engine/art/*
// and js/engine/render/* takes its colours from here: 33 colours in named ramps (dark to light),
// warm firelight and ember accents, cool greys and blue-greys for rock and the Hollow, muted greens
// and browns for the surface, and a few signal colours (danger red, magic teal, Hollow violet).
// W2.5 (the world map and the biome ground sets) adds three: rose (heather), frost (rime, salt crust)
// and leaf (blue-green conifers, sea glass): 37 of the 38 G19 allows.
// Material tints (js/data/materials.js `tint`) map to a 3-4 shade ramp of these colours (rampOf).
//
// Pure data and small helpers: no DOM, no canvas, nothing allocated per call at runtime.
//   PAL                 name -> '#rrggbb' (the 37 colours)
//   PAL_LIST            the colours in palette order (docs and the contact sheet swatch)
//   RAMP                ramp name -> [dark, ..., light] (3-4 colours each)
//   STONE_RAMP          stone id -> 4-shade ramp + accent (motif and fleck colours)
//   ORE_PX              ore id -> [dark, mid, glint] (1-2 px sparkles on rock)
//   rampOf(mat, fam)    a material id (wood, granite, copper ...) -> its ramp; unknown: by family
//   BAYER4              the 4 x 4 ordered-dither threshold matrix (values 0-15)
//   dith(x, y, level)   true when pixel (x, y) is on at dither level 0-16 (0 none, 16 all)
//   rgbOf(hex)          [r, g, b] (cached)

export const PAL = Object.freeze({
  // cool neutrals: outlines, night, rock, the Hollow
  ink: '#15131c', night: '#22202e', slate0: '#2e2e40', slate1: '#474960', slate2: '#6b6e86', slate3: '#9599ab', mist: '#c9cbd4', bone: '#f1ead8',
  // warm greys (granite, limestone, mortar)
  stone0: '#594f47', stone1: '#8a7e6f',
  // earth and wood
  umber0: '#2f2019', umber1: '#4d3226', umber2: '#714a32', umber3: '#9a6a42', tan: '#c08f56', sand: '#e0bb80', peach: '#f0c9a4',
  // firelight and ember
  ember0: '#6e2419', ember1: '#b23f26', orange: '#e8762e', gold: '#f4b13c', flame: '#ffe07a',
  // surface greens
  moss0: '#1f2e1f', moss1: '#34492c', moss2: '#557038', moss3: '#86a04c',
  // water
  deep: '#1b2c48', water: '#2d5878', shallow: '#4f8aa6',
  // cloth and duskstone
  plum0: '#3e2a48', plum1: '#74466e',
  // signals
  danger: '#dc3a3a', teal: '#3cc8b4', violet: '#a48cf0',
  // W2.5 biome colours: heather, rime and salt, conifer
  rose: '#a85a78', frost: '#dce8ee', leaf: '#2f5a4e',
});
export const PAL_LIST = Object.freeze(Object.keys(PAL));

const P = PAL;
/** Ramps, dark to light. */
export const RAMP = Object.freeze({
  slate: Object.freeze([P.slate0, P.slate1, P.slate2, P.slate3]),
  cold: Object.freeze([P.night, P.slate0, P.slate1, P.slate2]),
  pale: Object.freeze([P.slate3, P.mist, P.bone, P.bone]),
  warmgrey: Object.freeze([P.stone0, P.stone1, P.mist, P.bone]),
  granite: Object.freeze([P.slate1, P.stone0, P.stone1, P.slate3]),
  wood: Object.freeze([P.umber1, P.umber2, P.umber3, P.tan]),
  darkwood: Object.freeze([P.umber0, P.umber1, P.umber2, P.umber3]),
  earth: Object.freeze([P.umber0, P.umber1, P.umber2, P.umber3]),
  sandy: Object.freeze([P.umber2, P.umber3, P.tan, P.sand]),
  skin: Object.freeze([P.umber2, P.umber3, P.tan, P.peach]),
  fire: Object.freeze([P.ember1, P.orange, P.gold, P.flame]),
  ember: Object.freeze([P.ember0, P.ember1, P.orange, P.gold]),
  grass: Object.freeze([P.moss0, P.moss1, P.moss2, P.moss3]),
  water: Object.freeze([P.deep, P.water, P.shallow, P.mist]),
  plum: Object.freeze([P.night, P.plum0, P.plum1, P.violet]),
  copper: Object.freeze([P.ember0, P.umber3, P.orange, P.sand]),
  tin: Object.freeze([P.slate1, P.slate3, P.mist, P.bone]),
  iron: Object.freeze([P.slate0, P.slate1, P.slate2, P.slate3]),
  steel: Object.freeze([P.slate1, P.slate2, P.mist, P.bone]),
  gold: Object.freeze([P.umber2, P.tan, P.gold, P.flame]),
  hollow: Object.freeze([P.ink, P.slate0, P.slate1, P.slate2]),
  teal: Object.freeze([P.deep, P.water, P.teal, P.mist]),
  red: Object.freeze([P.ember0, P.ember1, P.danger, P.orange]),
  // W2.5 biome ramps (world map and the hold's ground sets)
  heather: Object.freeze([P.plum0, P.plum1, P.rose, P.peach]),
  rime: Object.freeze([P.slate2, P.slate3, P.frost, P.bone]),
  pine: Object.freeze([P.moss0, P.leaf, P.moss2, P.teal]),
  rust: Object.freeze([P.ember0, P.umber2, P.ember1, P.tan]),
  peat: Object.freeze([P.umber0, P.umber1, P.moss1, P.umber2]),
});

/**
 * Stones (L.mat order of worldgen STONES): ramp [r0 dark .. r3 light], fleck (motif accent) and the
 * motif the rock painter draws. unknown: rock not yet seen (dim, no motif).
 */
export const STONE_RAMP = Object.freeze({
  sandstone: { r: RAMP.sandy, fleck: P.sand, motif: 'strata' },
  limestone: { r: RAMP.warmgrey, fleck: P.bone, motif: 'fossil' },
  granite: { r: RAMP.granite, fleck: P.tan, motif: 'speckle' },
  slate: { r: RAMP.slate, fleck: P.slate3, motif: 'cleave' },
  basalt: { r: RAMP.cold, fleck: P.slate2, motif: 'column' },
  marble: { r: RAMP.pale, fleck: P.slate2, motif: 'vein' },
  duskstone: { r: RAMP.plum, fleck: P.violet, motif: 'glint' },
  unknown: { r: Object.freeze([P.ink, P.night, P.slate0, P.slate1]), fleck: P.slate0, motif: 'none' },
});
/** Ore glints: [dark, body, sparkle]. Coal is matt black with a pale sheen. */
export const ORE_PX = Object.freeze({
  coal: [P.ink, P.night, P.slate3], copper: [P.ember0, P.orange, P.flame], tin: [P.slate2, P.mist, P.bone], iron: [P.ember0, P.ember1, P.sand],
  silver: [P.slate2, P.mist, P.bone], gold: [P.umber3, P.gold, P.flame], lumenite: [P.water, P.teal, P.bone], clay: [P.umber2, P.tan, P.sand],
  amber: [P.umber3, P.gold, P.flame], garnet: [P.ember0, P.danger, P.peach], sapphire: [P.deep, P.shallow, P.mist], emerald: [P.moss1, P.teal, P.bone],
  ruby: [P.ember0, P.danger, P.peach], heartstone: [P.ember1, P.orange, P.flame],
});

/** Ramps of the materials in js/data/materials.js (by id); others fall back by family. */
const MAT_RAMP = {
  wood: RAMP.wood, sandstone: RAMP.sandy, limestone: RAMP.warmgrey, granite: RAMP.granite, slate: RAMP.slate,
  basalt: RAMP.cold, marble: RAMP.pale, duskstone: RAMP.plum, copper: RAMP.copper, tin: RAMP.tin, iron: RAMP.iron, steel: RAMP.steel,
  silver: RAMP.tin, gold: RAMP.gold, bronze: RAMP.copper,
};
/** The ramp of a material id; unknown ids use the family default (wood, stone: granite, metal: iron). */
export function rampOf(mat, fam = 'wood') {
  if (mat && MAT_RAMP[mat]) return MAT_RAMP[mat];
  return fam === 'stone' ? RAMP.granite : fam === 'metal' ? RAMP.iron : RAMP.wood;
}

/** The 4 x 4 Bayer matrix (ordered dither thresholds 0-15). */
export const BAYER4 = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
/** Ordered dither: is pixel (x, y) on at level 0-16? (absolute coordinates keep patterns stable across tiles). */
export const dith = (x, y, level) => BAYER4[((y & 3) << 2) | (x & 3)] < level;

const RGB = new Map();
/** [r, g, b] of a '#rrggbb' colour (cached). */
export function rgbOf(hex) {
  let v = RGB.get(hex);
  if (!v) { const n = parseInt(hex.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; RGB.set(hex, v); }
  return v;
}
/** 'rgba(...)' of a palette colour at alpha a (cached by the caller where it matters). */
export function rgba(hex, a) { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; }
