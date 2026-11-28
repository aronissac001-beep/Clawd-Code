// Civ ethics (EMBERCROWN-WORLD.md 4.4, G13; OWNER G). Read by js/game/realm/civs.js and history.js.
//
// A civ's ethic vector is 8 numbers, -2..+2, in the axis order below (APPEND-ONLY: the vector is saved in the
// realm record's civ rows). Until W4 gives js/data/ancestries.js its `ethic` field, PEOPLE_ETHIC holds the four
// existing peoples' vectors here; a people missing from both is neutral (all 0, G12).

export const ETHIC_AXES = Object.freeze(['trees', 'deep', 'fire', 'water', 'beasts', 'dead', 'coin', 'law']);

/** Base vectors per people id (4.3 Values column, read as ethics); W4 moves these to the ancestry rows. */
export const PEOPLE_ETHIC = Object.freeze({
  human: [0, 0, 0, 0, 0, 1, 1, 1],
  sylvari: [2, -1, 0, 0, 1, 0, 0, 0],
  deepforge: [0, 2, 1, 0, 0, 1, 0, 0],
  emberkin: [-1, 0, 2, 0, -1, 0, 0, -1],
});

/**
 * Relation numbers (2.3 step 2, 4.4): rel = base - perDist * L1(ethics) + sharedHome + pact bonuses + amity
 * - compete - grievances. `amity` accrues `amityRate` a year of peaceful contact up to `amityMax` (it is what
 * lets neighbours of one mind reach the pact line); grievances fade `griefFade` a year.
 */
export const REL = Object.freeze({
  base: 40, perDist: 8, sharedHome: 5, compete: 10, competeGap: 3, pact: 10,
  amityRate: 1, amityMax: 40, griefFade: 1, griefMax: 120,
  /** grievance added for: a site razed, a site taken, tribute paid, an oath broken, a split, a kin figure slain. */
  grief: { razed: 25, taken: 15, tribute: 8, oath: 30, split: 20, kin: 10 },
  /** a civ's vector: its people's plus up to +-1 on `jitterAxes` seeded axes, clamped to -2..2 (4.4). */
  jitterAxes: 2,
});

/** Oath names (4.4): "the <a>-and-<b> pact" or "the <c> <d>"; original wording. */
export const OATH_PARTS = Object.freeze({
  a: ['Salt', 'Ash', 'Iron', 'Reed', 'Ember', 'Stone', 'Horn', 'Bread', 'Lamp', 'Thorn', 'Wool', 'Copper'],
  b: ['Ash', 'Water', 'Oak', 'Bone', 'Honey', 'Slate', 'Ember', 'Barley', 'Silver', 'Ice'],
  c: ['Open', 'Long', 'Quiet', 'Twin', 'Grey', 'Kept', 'Bright', 'Low', 'First', 'Mended'],
  d: ['Hand', 'Road', 'Cup', 'Knot', 'Gate', 'Fire', 'Table', 'Bridge', 'Hearth', 'Word'],
});
