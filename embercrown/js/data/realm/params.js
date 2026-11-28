// Realm generation parameters and shape numbers (EMBERCROWN-WORLD.md 1.1-1.5; OWNER G).
// Read by js/game/realm/*. Bump REALM_GEN.version whenever a change here or in the generator would change the
// realm of a seed: the version is part of every step's stream (1.2) and of the world id (9.1), and the record's
// CRCs (9.2) only accept a regeneration made by the same version.

export const REALM_GEN = Object.freeze({ version: 1 });

/** World sizes (1.5): regions per side. */
export const SIZES = Object.freeze({ small: 48, standard: 64, large: 96 });

/** The Create world fields (1.5): allowed values and the default of each. */
export const PARAM_ROWS = Object.freeze({
  size: { values: ['small', 'standard', 'large'], def: 'standard' },
  history: { values: [150, 250, 400], def: 250 },
  peoples: { values: ['few', 'normal', 'many'], def: 'normal' },
  wildness: { values: ['low', 'normal', 'high'], def: 'normal' },
  hollowing: { values: ['low', 'normal', 'high'], def: 'normal' },
  sea: { values: [1, 2, 3, 'random'], def: 'random' },
});
/** Civ counts per `peoples` setting (1.5; used by the history step, W3). */
export const CIV_COUNT = Object.freeze({ few: 6, normal: 9, many: 13 });

/** Parts of the generated world name offered on the Create world sheet (original wording). */
export const NAME_PARTS = Object.freeze({
  a: ['Ash', 'Ember', 'Thorn', 'Grey', 'Rime', 'Gold', 'Iron', 'Mire', 'High', 'Deep', 'Wind', 'Stone', 'Red', 'Salt', 'Elder', 'Cold'],
  b: ['mark', 'reach', 'fell', 'vale', 'wold', 'moor', 'march', 'shire', 'water', 'holt', 'mere', 'down', 'scar', 'land'],
});

/** Generation shape numbers. Distances are in regions at the Standard size; the generator scales them by n / 64. */
export const GEN = Object.freeze({
  plates: { count: [8, 14], oceanicPct: 60, inlandOceanicPct: 10, oceanReach: 0.3, oldPct: 50, baseOcean: [70, 95], baseLand: [105, 140],
    drift: 3, width: 3, ridge: 3.2, rift: 1.6 },
  elev: { noise: 110, cell: 16, coast: 13, coastDrop: 150, coastJitter: 7, rim: 5, rimRise: 6, inland: 2, landPct: [55, 70] },
  islandMin: 6,
  /** Land elevation bands by percentile of non-lake land (permille from the top): peak, highland, upland. */
  bands: { peak: 45, highland: 140, upland: 380 },
  temp: { north: -7, south: 33, lapse: 8, noise: 6, min: -60, max: 60 },
  amp: { base: 5, perRegion: 0.5, maxDist: 24, north: 4 },
  rain: { westSea: 175, westLand: 110, seaCap: 215, pick: 0.25, base: 0.012, lift: 0.006, maxDrop: 0.6, fromAir: 0.75,
    fromDrop: 4, lake: 6, southDry: 0.55, noise: 50 },
  drain: { base: 112, noise: 150, slope: 5, basin: 7, lake: 70 },
  /** Flow accumulation per region is 1 + rain / perRain; class thresholds T1 (stream), T2 (river), T3 (great river). */
  river: { perRain: 32, t1: 60, t2: 170, t3: 520, lakeDepth: 4, lakeMax: 36 },
  volc: { hotspots: [2, 5], radius: [4, 8], boundary: 16, noise: 30 },
  taint: { falls: { low: [1, 2], normal: [2, 4], high: [4, 6] }, peak: { low: 205, normal: 235, high: 250 }, radius: [4, 6], noise: 40 },
  wild: { base: 40, noise: 120, taint: 5, offset: { low: -40, normal: 0, high: 40 } },
  /** Classification thresholds of 1.3. */
  classify: { ruinsTaint: 160, ashVolc: 180, ashRain: 90, frigid: -5, cold: 4, temperate: 14, warm: 22,
    arid: 40, dry: 90, moist: 160, lowDrain: 80, ashGeo: 170 },
  /** Step 11 (1.4). */
  guarantee: { embark: { small: 70, standard: 120, large: 120 }, biomes: { small: 5, standard: 6, large: 6 }, rerolls: 4 },
});

/**
 * What a region needs to fit each start preset (3.8), read by the guarantee step and the site finder (3.4).
 * relief 'thick': upland or higher, or a peak or highland next to it; deepSoil: lowland, drainage at least the
 * classify lowDrain, not saltflat or ashlands; water: a river, lake or coast; civ: needs a civ in reach (W3; the
 * W2 world has no civs, so this part is not checked yet).
 */
export const START_FIT = Object.freeze({
  hearthwatch: {},
  deepforge: { relief: 'thick' },
  lone_ember: {},
  murrow_warren: { deepSoil: true },
  tarn_shore: { water: true },
  wendrel_drovers: { biomes: ['moor', 'saltflat', 'highcrag'] },
  refugees: {},
  crown_charter: { civ: 'realm' },
});
