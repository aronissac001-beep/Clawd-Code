// The bands of the world in depth (EMBERCROWN-FORTRESS.md 2.2, 2.6, 2.7; Stage Z1 step E4). Owner G (band
// rows written by B in E4 on G's leave), read by B's world systems (temperature, support, light, discovery),
// C's band void tints and I's band plate. Plain data: nothing here allocates or reads the map.
//
// Bands are keyed by the RELATIVE level (rel = z - zS: 0 the surface, +1..+5 the heights, -1..-14 the
// depths), so a world of any depth reads the same rows. A rel outside every row takes the nearest end row.
// Two-level caverns are their own bands on the levels they occupy (Cavern I at -6, -7 inside the middle
// stone; Cavern II at -9, -10 inside the deep stone): mapgen3 (E10) carves them, the rows give their
// climate and names.
//
// Fields:
//   id, name       stable id; the band plate's name (original names, 2.2)
//   short          the ruler's short label (<= 8 letters, text only)
//   rel            [lo, hi] inclusive relative levels
//   temp           base temperature in C under full cover (2.6; cover >= 3 sits at it)
//   soil           true where the band is soil: a soil ceiling holds only SOIL_SUPPORT (2) tiles (2.5)
//   tint           the band void tint (C, 6.3) and the ruler swatch (I)
//   disc           the discovery kind written the first time a colonist reaches the band (2.7), or null
//   cavern         true for a cavern band (Opening it warns of its creatures, 2.10)
export const LEVELS = Object.freeze([
  { id: 'heights', name: 'The Heights', short: 'Heights', rel: [1, 99], temp: 12, soil: false, tint: '#6d6a72', disc: null, cavern: false },
  { id: 'surface', name: 'The Valley Floor', short: 'Surface', rel: [0, 0], temp: 12, soil: true, tint: '#5f7a45', disc: null, cavern: false },
  { id: 'topsoil', name: 'Topsoil', short: 'Topsoil', rel: [-1, -1], temp: 12, soil: true, tint: '#7a5a3c', disc: 'soil', cavern: false },
  { id: 'subsoil', name: 'Subsoil and Aquifer', short: 'Subsoil', rel: [-2, -2], temp: 12, soil: true, tint: '#6b5238', disc: 'aquifer', cavern: false },
  { id: 'outer', name: 'Outer Stone', short: 'Outer', rel: [-4, -3], temp: 12, soil: false, tint: '#8f7f62', disc: 'outer', cavern: false },
  { id: 'middle', name: 'Middle Stone', short: 'Middle', rel: [-5, -5], temp: 12, soil: false, tint: '#6e6b6a', disc: 'middle', cavern: false },
  { id: 'hollows', name: 'The Glowcap Hollows', short: 'Hollows', rel: [-7, -6], temp: 11, soil: false, tint: '#3f5a55', disc: 'hollows', cavern: true },
  { id: 'deep', name: 'Deep Stone', short: 'Deep', rel: [-8, -8], temp: 12, soil: false, tint: '#45464a', disc: 'deep', cavern: false },
  { id: 'mere', name: 'The Sunless Mere', short: 'Mere', rel: [-10, -9], temp: 10, soil: false, tint: '#2f4256', disc: 'mere', cavern: true },
  { id: 'underdeep', name: 'The Underdeep', short: 'Under', rel: [-11, -11], temp: 8, soil: false, tint: '#3b3348', disc: 'underdeep', cavern: false },
  { id: 'ember', name: 'The Ember Layer', short: 'Ember', rel: [-12, -12], temp: 38, soil: false, tint: '#5a2a22', disc: 'ember', cavern: false },
  { id: 'reach', name: 'The Hollow Reach', short: 'Reach', rel: [-13, -13], temp: 2, soil: false, tint: '#4a4a50', disc: 'reach', cavern: true },
  { id: 'hollow', name: 'The Hollow', short: 'Hollow', rel: [-99, -14], temp: -10, soil: false, tint: '#26262b', disc: 'seal', cavern: false },
]);

/** The band row for a relative level (rel = z - zS). */
export function bandOfRel(rel) {
  for (const b of LEVELS) if (rel >= b.rel[0] && rel <= b.rel[1]) return b;
  return rel > 0 ? LEVELS[0] : LEVELS[LEVELS.length - 1];
}

/** Support radius (Chebyshev, tiles) under a stone ceiling and under a soil ceiling (2.5). */
export const STONE_SUPPORT = 4;
export const SOIL_SUPPORT = 2;

/** Sounding (2.7): Mining skill needed, work in game minutes at speed 1.0, levels revealed below, radius. */
export const SOUNDING = Object.freeze({ skill: 6, work: 120, levels: 3, r: 3 });

/** Sight across levels (2.7): through a stair pair, and down through open air from a lip. */
export const SIGHT3 = Object.freeze({ stair: 2, lip: 3 });

/** Static fluid (2.8): walk cost multipliers by water depth (index 0-7), the seep depth a mined aquifer leaves. */
export const FLUID = Object.freeze({ walkPct: Object.freeze([100, 200, 200, 300, 0, 0, 0, 0]), seepDepth: 2, emberLight: Object.freeze({ lvl: 2, r: 3 }), emberHeat: 440 });

/** Heat (2.6): the clamp at D > 1 (Sweltering and Heatstroke need values above 45 C). */
export const TEMP3 = Object.freeze({ min: -30, max: 70, iceRel: -6 });
