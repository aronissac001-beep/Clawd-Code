// Seizures of craft: the moods family (EMBERCROWN-FORTRESS.md 3.3, F16). OWNER F.
// Not a registry kind: js/game/people/seizures.js imports it directly. The Ember-touched demand tables stay in
// data/embertouch.js (registry kind emberDemand) until G retires that file; Brooding and Hollow-whispered use these.
// Every item kind and material named here is checked against the registry by tools/tests/people-z2.test.mjs.

/**
 * Tuning. Chances are per mille a day per eligible colonist, before the pace factor
 * max(0, 1 + floor(pop / popPer) - artifacts) (memorials do not count as artifacts).
 */
export const SEIZE = Object.freeze({
  popPer: 5,
  brooding: { minLvl: 4, chancePermille: 120, withinDays: 10, deadlineDays: 5, workH: 8, tokenN: 1 },
  whispered: { minLvl: 4, dreadAt: 40, dreadDays: 3, touchedPermille: 10, chancePermille: 150, workH: 8, takeStacks: 2, takeN: 10 },
  likedN: { block: 20, ingot: 8, wood: 30 },
  greyR: 4,
});

/** Brooding demands by skill: 1-3 of these (rolled) plus a token of the dead. Keys as data/embertouch.js. */
export const BROODING_DEMAND = Object.freeze({
  smithing: { 'ingot:iron': 10, 'ingot:copper': 6, coal: 6 },
  woodcraft: { wood: 30, leather: 2, beeswax: 2 },
  masonry: { 'block:granite': 20, 'block:marble': 10, block: 20 },
  tailoring: { cloth: 10, leather: 6, wool: 10 },
  art: { block: 15, wood: 15, clay: 10 },
  cooking: { meat: 10, berries: 10, honey: 4 },
});
/** Hollow-whispered takes from the stores: item kinds it may seize, in order of preference. */
export const WHISPER_TAKES = Object.freeze(['cutgem', 'ingot', 'block', 'bone', 'leather', 'cloth', 'wood', 'clay']);

/** Artifact names (original; picked by hash). A memorial adds ", in memory of {name}". */
export const MEMORIAL_NAMES = Object.freeze(['The Long Watch', 'Hearthless', 'The Quiet Stone', 'Last Ember', 'The Empty Chair',
  'Ashen Vow', 'Stillwater', 'The Lantern Kept', 'Grief-in-Iron', 'The Unsung', 'Evensong', 'The Folded Cloak']);
export const GREY_NAMES = Object.freeze(['The Listening Thing', 'Greymouth', 'The Hollow Gift', 'Murmur', 'The Edge-Glass',
  'Ashwhisper', 'Pale Offering', 'The Unlit', 'Nightcall', 'The Grey Bargain']);
/** What a Brooding memorial is by skill (item kinds; G's art items), and a grey artifact. */
export const MEMORIAL_KIND = Object.freeze({ smithing: 'amulet', woodcraft: 'statue', masonry: 'bigstatue', tailoring: 'tapestry', art: 'figurine', cooking: 'figurine' });
export const GREY_KIND = Object.freeze({ smithing: 'circlet', woodcraft: 'figurine', masonry: 'statue', tailoring: 'banner', art: 'figurine', cooking: 'figurine' });
