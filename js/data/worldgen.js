// World generation tables (doc 3.2; OWNER B). Read by js/game/world/mapgen.js and defs.js.
//
// The numeric ids written in the tile layers are fixed here and are append-only (they are saved):
//   L.mat  = index in STONES      (0 none)
//   L.ore  = index in DEPOSITS    (0 none)
// DATA (validated by js/data/schema.js, C11) holds the rock layers and the deposits generated in the
// current stage; GEN holds the generation shape numbers (not content, so not in DATA).

/** L.mat ids (append only). The renderer's placeholder stone colours use the same order. */
export const STONES = Object.freeze(['', 'sandstone', 'limestone', 'granite', 'slate', 'basalt', 'marble', 'duskstone',
  // Stage Z1 E10 (EMBERCROWN-FORTRESS.md 2.2): the soils of the topsoil and subsoil (solid ROCK voxels whose mat is
  // a soil), the ember layer's rock, the Hollow's unmineable greystone and the Seal-stone plug
  'loam', 'clay', 'sand', 'emberrock', 'greystone', 'sealstone']);
/** L.ore ids (append only): metals first (the renderer's ore glint order), then the rest of 3.2. */
export const DEPOSITS = Object.freeze(['', 'coal', 'copper', 'tin', 'iron', 'silver', 'gold', 'lumenite', 'clay',
  'amber', 'garnet', 'sapphire', 'emerald', 'ruby', 'heartstone']);

export const DATA = {
  // 3.2 step 3: stone of each rock tile by depth (tiles into rock); work = mining game minutes at speed 1.0
  rockLayer: [
    { id: 'outer', name: 'Outer', depth: [1, 4], stones: ['sandstone', 'limestone'], work: 12 },
    { id: 'middle', name: 'Middle', depth: [5, 12], stones: ['granite', 'slate'], work: 20 },
    { id: 'deep', name: 'Deep', depth: [13, 22], stones: ['basalt', 'marble'], work: 30 },
    { id: 'underdeep', name: 'Underdeep', depth: [23, 255], stones: ['duskstone'], work: 45 },
  ],
  // 3.2 step 4: ore veins (random walks of 6-20 tiles). Stage 1a generates the four slice deposits;
  // silver, gold, lumenite, clay and gems join when their items exist (Stage 1b / 2).
  deposit: [
    { id: 'coal', item: 'coal', depth: [2, 14], veins: [10, 14], yield: 6 },
    { id: 'copper', item: 'ore', mat: 'copper', depth: [2, 12], veins: [6, 8], yield: 4 },
    { id: 'tin', item: 'ore', mat: 'tin', depth: [3, 12], veins: [4, 6], yield: 4 },
    { id: 'iron', item: 'ore', mat: 'iron', depth: [6, 20], veins: [7, 10], yield: 4 },
  ],
};

/**
 * Generation shape (numbers for a 128 map; mapgen scales lengths by W / 128 and counts by area).
 * Percentages are integers.
 */
export const GEN = Object.freeze({
  // step 1: the massif along one side (N, E or W), plus 1-2 small hills
  massif: {
    sides: ['n', 'e', 'w'],    // the v1 roll (no opts.region) picks from these three, so v1 worlds keep their hash
    regionSides: ['n', 'e', 's', 'w'], // GEN3 v2 (EMBERCROWN-WORLD.md 3.6): opts.region.side may also be 's'
    thickPct: [27, 33],        // mean thickness as % of the map's cross size (about 25-35% cover)
    wavePct: 7,                // face wave amplitude, % of the map size
    minThick: 34,              // tiles at 128: the guarantee floor (>= 30 to the edge, 3.2)
    rerolls: 4,                // gen:massif:<n>
    maxDepthMin: 30,           // acceptance (14.6): max depth >= 30
    underdeepMin: 300,         // and >= 300 tiles at depth 23+
    underdeep: 23,
  },
  hills: { count: [1, 2], radius: [14, 17], keepOff: 14 }, // radius in tiles at 128 (about 4-6% of the map each); keepOff from the site
  // step 4
  vein: { len: [6, 20], tries: 400 },
  // step 5 (Stage 1a: one cavern; 3-5 in Stage 2)
  cavern: { count: 1, minDepth: 9, size: [40, 250], box: 18, fill: 47, steps: 4, pool: 6, glowcapPct: 8 },
  // step 7
  river: { width: [2, 3], fords: [2, 3], fordWidth: 3, offFace: [30, 40], wave: 9 },
  lake: { radius: [5, 8] },
  forestPct: 20, meadowPct: 14, richPct: 5, berryClumps: [6, 9], herbClumps: [5, 8],
  // step 9: the start site
  site: { size: 20, faceMax: 6, riverMax: 25, near: 12, trees: 3, berries: 1, clear: 3, revealR: 20 },
  // step 10: spawn edges
  edges: { segMin: 3, segMax: 5, segLen: 6 },
});

/**
 * Stage 2 world rules (doc 3.1, 3.4, 3.6, 7.8, 9.7; read by js/game/world/{weather,fire,blight,
 * mechanisms,support}.js). Integers only: percents, per-mille, ticks, game hours and days.
 */
export const WORLD = Object.freeze({
  // Weather (9.7): one roll at 06:00 each day (a hash of the seed and the day, no RNG stream), per
  // season in time.js order [Thaw, Highsun, Ashfall, Deepcold]. Rain in Deepcold falls as snow.
  // offset: degrees added to the outdoor base; growthPct: crop and tree growth on open sky;
  // light: the daylight level cap while it lasts (overcast); fireOut: per-mille per fire step that
  // an outdoor flame is put out; spreadPct: fire spread on open sky.
  weather: {
    rainPct: [30, 14, 26, 18], rainH: [4, 14],
    coldSnapPct: [0, 0, 6, 12], coldSnapD: [2, 4],
    droughtPct: [0, 8, 0, 0], droughtD: [3, 6],
    kinds: {
      clear: { offset: 0, growthPct: 100, light: 3, fireOut: 0, spreadPct: 100 },
      rain: { offset: -2, growthPct: 125, light: 2, fireOut: 350, spreadPct: 30 },
      snow: { offset: -3, growthPct: 100, light: 2, fireOut: 250, spreadPct: 30 },
      coldsnap: { offset: -15, growthPct: 100, light: 3, fireOut: 0, spreadPct: 100 },
      drought: { offset: 4, growthPct: 40, light: 3, fireOut: 0, spreadPct: 200 },
    },
    frostKillBelow: 8,      // annual crops die when the tile is this many degrees under their minTemp
    lightningPct: 15, lightningFar: 20,   // a drought day may set a tree alight (percent), at least this far from the Hearth
    freezeSeason: 3,        // shallow water freezes to ice in Deepcold and thaws in Thaw
  },
  // Fire (5.1, 7.x, 9.7): flames live on tiles; each step (every `every` ticks) a flame burns `burnPerStep`
  // of its fuel, damages what stands there and may spread to each flammable 8-neighbour with
  // spreadPermille (x the weather's spreadPct). Overhead mountain roofs never catch from outside.
  fire: {
    every: 20, spreadPermille: 70, max: 256, heat: 60,
    fuel: { plant: 400, grass: 160, bld: 900, item: 300 },   // ticks a flame burns on each kind of fuel
    bldDmg: 6, colDmg: 4, light: { lvl: 2, r: 3 }, startHeat: 40,
    extinguish: 40,          // fuel ticks removed per beat of a firefighter (E's fire emergency)
  },
  // Cave-ins (3.4): tiles rumble 40 ticks (2 s) then collapse; colonists there take 20-45 blunt.
  cave: { rumble: 40, dmg: [20, 45] },
  // Blight (3.1): spreads 1 tile a day from seeds (Hollow seeps, the edge in Ashfall); tiles lit at
  // level >= 2 all day, or inside a Waystone, lose cleansePerDay; a patch of huskPatch+ unlit tiles can
  // raise a Husk at night (H spawns it: blight.huskSites).
  blight: { spreadPerDay: 1, cleansePerDay: 20, lit: 2, huskPatch: 30, edgeSeason: 2, startPct: 6, startMin: 70, nearSite: 30 },
  // Mechanisms (7.8): a lever or plate drives up to `links` gates, doors and linkable traps within `linkR`
  // tiles (auto-linked to the nearest lever or plate when built); a deadfall deals `deadfall` blunt.
  mech: { links: 4, linkR: 12, deadfall: 60, plateCooldown: 200 },
  // Waystones (3.1): how many a colony may raise by prosperity tier (tiers.js order).
  waystones: { camp: 1, hamlet: 3, village: 6, hold: 10, stronghold: 16, crownhold: 999 },
});

/**
 * The 3D generator's tables (Stage Z1 E10; EMBERCROWN-FORTRESS.md 2.2; read by js/game/world/mapgen3.js only).
 * Levels are RELATIVE (rel = z - zS: 0 the surface, -1..-14 the depths). Numbers are for a 128 x 128 x 20 world;
 * counts scale with the map area. Integers and plain fractions only (the mapgen lint, check-mapgen.mjs).
 */
export const GEN3 = Object.freeze({
  // 2 (EMBERCROWN-WORLD.md 3.6, W2.3): opts.region drives the generator. A world made without opts.region runs the v1
  // path unchanged and is stamped legacyVersion, so its pristine header, legends and hashes are as before.
  version: 2,
  legacyVersion: 1,
  // the heights: a massif column of planar depth d (tiles into the massif, the Stage 2 transform) rises
  // ceil(d / perLevel) levels, 1..max, above the valley floor; 1 in rampIn one-level steps facing open ground get a ramp
  heights: { perLevel: 6, max: 5, rampIn: 3, faceOuter: 4 },
  // rock by relative level (band edges wobble by -1..+1 with 2-D noise, caverns excepted)
  stone: {
    outer: { rel: [-4, -3], stones: ['sandstone', 'limestone'], split: 50 },
    middle: { rel: [-7, -5], stones: ['granite', 'slate'], split: 50 },
    deep: { rel: [-10, -8], stones: ['basalt', 'marble'], split: 68 },
    underdeep: { rel: [-11, -11], stones: ['duskstone'] },
    ember: { rel: [-12, -12], stones: ['emberrock'] },
    reach: { rel: [-13, -13], stones: ['duskstone'] },
    hollow: { rel: [-99, -14], stones: ['greystone'] },
  },
  // mining work (game min at speed 1.0) of the new stones; 0 = unmineable (greystone)
  stoneWork: { loam: 6, clay: 6, sand: 6, emberrock: 45, greystone: 0, sealstone: 60 },
  // soils under the valley: rel -1 loam with clay pockets (sand under water); rel -2 clay and loam, and the
  // wet-sand aquifer under the lowland (water columns plus aquiferNearPct of the valley columns nearest them)
  soil: { topClayPct: 18, subClayPct: 45, aquiferNearPct: 40 },
  // two-level caverns: floor level (CA, 5 passes) fill and noise; ledge level fill; ramps; parts
  caverns: {
    hollows: { floor: -7, ledge: -6, fill: 48, noise: 14, airFill: 55, ledgeFill: 52, ledgeReach: 3, ramps: [4, 10], minOpen: 600, maxParts: 3, openPct: [25, 40], pools: [2, 4] },
    mere: { floor: -10, ledge: -9, fill: 48, noise: 14, airFill: 55, ledgeFill: 52, ledgeReach: 3, ramps: [4, 10], minOpen: 600, maxParts: 3, openPct: [25, 40], lakePct: 35, bridges: [1, 2], bridgeMax: 8 },
    reach: { floor: -13, fill: 46, noise: 14, minOpen: 600, maxParts: 3, openPct: [20, 40] },
    steps: 5, border: 3, minPart: 8, ledgePartRamp: 40, ledgeBig: 8, passages: [2, 4],
  },
  // ember pools on the ember layer (fluid ember, static until Z3) and springs (sources) in the middle stone and the heights
  ember: { pools: [3, 5], r: [2, 3], depth: 4 },
  springs: { count: [1, 2], rel: -5, high: 1, depth: 2 },
  // 3-D veins (random walks; gems 1-3 voxels): the DATA.deposit rows read their depth columns through the band
  // map (depth 1-4 outer, 5-12 middle, 13-22 deep, 23+ underdeep and lower; inside the massif at rel >= 0 the
  // planar depth, capped at the middle stone); the rows below add the deeper finds by relative level
  vein: { len: [6, 20], gem: [1, 3], tries: 600, upPct: 12, perBand: 1 },
  bandDepth: [[4, 'outer'], [12, 'middle'], [22, 'deep'], [255, 'underdeep']],
  veins: [
    { id: 'silver', rel: [-10, -8], veins: [6, 9] },
    { id: 'gold', rel: [-11, -8], veins: [4, 7] },
    { id: 'lumenite', rel: [-11, -11], veins: [4, 6] },
    { id: 'clay', rel: [-4, -3], veins: [6, 10] },
    { id: 'amber', rel: [-4, -2], veins: [6, 10], gem: true, massif: true },
    { id: 'garnet', rel: [-7, -3], veins: [8, 12], gem: true, massif: true },
    { id: 'sapphire', rel: [-10, -5], veins: [6, 10], gem: true },
    { id: 'emerald', rel: [-10, -8], veins: [5, 8], gem: true },
    { id: 'ruby', rel: [-11, -11], veins: [5, 8], gem: true },
    { id: 'heartstone', rel: [-13, -11], veins: [4, 6], gem: true },
  ],
  // Old Crown vaults (sealed rooms of worked marble; rel lists the levels one may sit on), the seeps, the Seal and the Sleep
  vaults: { count: [1, 2], rel: [-5, -8], size: [9, 7] },
  seeps: [2, 3],
  seal: { far: 30, room: 7 },
  // dormant content (2.2 step 8): rows [kind, voxel, seed] in the pristine meta; a system that has not shipped ignores them
  dormant: {
    hollows: [['den_glowbeetle', 2, 3], ['den_cave_spider', 2, 2], ['den_great_spider', 1, 1], ['den_blindfish', 1, 2]],
    mere: [['den_blindfish', 2, 2], ['den_mire_leech', 2, 2], ['den_shellback', 2, 2]],
    reach: [['den_gloom_hound', 2, 3], ['husk_barrow', 2, 3], ['den_grey_bat', 1, 1]],
    beasts: [4, 6],
  },
  // the guarantees (2.2 step 9): a failing step re-rolls at most `rerolls` times
  guarantee: { rerolls: 4, oreNearLevels: 3, oreNearTiles: 40, ironAboveZ: 8 },
  // ---- GEN3 v2: region inputs (EMBERCROWN-WORLD.md 1.3, 3.6; W2.3) ----------------------------------------------
  // The knob row of each region biome (keyed by js/data/realm/biomes.js id), relative to today's GEN / GEN3; a key
  // left out keeps today's value (greenvale is the reference row). Surface knobs: forestPct, meadowPct, richPct (% of
  // open ground), pines (conifers only), hills and rocks ([lo, hi] counts of hills and of small rock outcrops),
  // ravines ([lo, hi] one-level channels), sandPct (% of open ground that is sand), ruins (surface ruin count),
  // marshPct (salt marsh share of the sea shore band). Region knobs that js/game/realm/region.js folds into
  // opts.region: massifPct ([lo, hi] mean massif thickness, % of the cross size), heightsPerLevel, aquiferPct,
  // topClayPct and topSandPct (the rel -1 soil mix), lakes (base lake count), ember ({ pools, rel }), blightPct
  // ([lo, hi]), and the climate words (fronts; read by weather.js and temperature.js, W2.4 and W5).
  biomes: {
    greenvale: {},
    elderwood: { forestPct: 45, meadowPct: 6, fronts: ['fog', 'fog'] },
    ruins: { blightPct: [12, 20], ruins: 6, forestPct: 12 },
    ashlands: { ember: { pools: [6, 8], rel: -11 }, aquiferPct: 0, forestPct: 6, fronts: ['ashfall'] },
    fen: { aquiferPct: 80, lakes: 2, topClayPct: 40, forestPct: 10, fronts: ['fog', 'fog'] },
    moor: { forestPct: 4, meadowPct: 30, hills: [3, 3], rocks: [8, 12], wind: 40 },
    taiga: { pines: true, winter: -10, fronts: ['snow', 'snow', 'snow'] },
    tundra: { forestPct: 1, pines: true, frozenSoil: true, season: 15 },
    saltflat: { topSandPct: 60, sandPct: 30, forestPct: 2, fronts: ['drought', 'drought', 'drought'] },
    redscar: { massifPct: [42, 48], hills: [3, 4], ravines: [3, 4], forestPct: 3 },
    shore: { sea: true, sandPct: 8, marshPct: 30 },
    highcrag: { massifPct: [45, 55], heightsPerLevel: 4, season: -20 },
  },
  // region shapes: the sea band of a shore region (tiles at 128: deep, then shallow, then the beach); rock outcrops
  // (radius); ravines (length at 128 and width; a ramp at each end); river width by realm class 1-3
  sea: { deep: [9, 13], shallow: 2, beach: 3 },
  rocks: { r: [2, 3] },
  ravine: { len: [18, 34], width: [1, 2] },
  riverWidth: [2, 3, 5],
  // massif thickness of a region: the 3.6 range (the 34-tile floor of GEN.massif.minThick still holds)
  massifPct: [27, 55],
  // rock provinces (realm `geo`: 0 basin, 1 shield, 2 basalt flood, 3 metamorphic belt, 4 ash field): stone swaps by
  // band and ore vein weights (% of today's vein count; never below 100, so the ore guarantees hold)
  provinces: [
    { stones: {}, ores: { coal: 200, copper: 150 } },
    { stones: { outer: ['granite', 'limestone'] }, ores: { gold: 200, silver: 200 } },
    { stones: { outer: ['basalt', 'slate'] }, ores: {} },
    { stones: {}, ores: { iron: 200, garnet: 150, sapphire: 150, emerald: 150, ruby: 150, amber: 150 } },
    { stones: {}, ores: { lumenite: 200 } },
  ],
});

