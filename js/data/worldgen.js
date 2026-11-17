// World generation tables (doc 3.2; OWNER B). Read by js/game/world/mapgen.js and defs.js.
//
// The numeric ids written in the tile layers are fixed here and are append-only (they are saved):
//   L.mat  = index in STONES      (0 none)
//   L.ore  = index in DEPOSITS    (0 none)
// DATA (validated by js/data/schema.js, C11) holds the rock layers and the deposits generated in the
// current stage; GEN holds the generation shape numbers (not content, so not in DATA).

/** L.mat ids (append only). The renderer's placeholder stone colours use the same order. */
export const STONES = Object.freeze(['', 'sandstone', 'limestone', 'granite', 'slate', 'basalt', 'marble', 'duskstone']);
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
    sides: ['n', 'e', 'w'],
    thickPct: [27, 33],        // mean thickness as % of the map's cross size (about 25-35% cover)
    wavePct: 7,                // face wave amplitude, % of the map size
    minThick: 34,              // tiles at 128: the guarantee floor (>= 30 to the edge, 3.2)
    rerolls: 4,                // gen:massif:<n>
    maxDepthMin: 30,           // acceptance (14.6): max depth >= 30
    underdeepMin: 300,         // and >= 300 tiles at depth 23+
    underdeep: 23,
  },
  hills: { count: [1, 2], radius: [9, 13], keepOff: 14 },  // radius in tiles at 128; keepOff from the site
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
