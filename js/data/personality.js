// Personalities, preferences, life goals and memories (EMBERCROWN-FORTRESS.md 3.2, F15). OWNER F.
// Not a registry kind: js/game/people/personality.js imports it directly (like deeds-col.js). Every
// id below that names content (materials, items, animals, thoughts) is checked by
// tools/tests/people-z2.test.mjs against the registry. Original names only; no emoji.

/** Facets: positional (saved by position in s.colony.people.psy; never reorder, only append). */
export const FACETS = Object.freeze(['sociability', 'temper', 'nerve', 'diligence', 'fancy', 'reverence']);
/** Values: positional. */
export const VALUES = Object.freeze(['craft', 'kin', 'order', 'valour']);

/** How a facet reads on the Bio tab, from -3 to +3 (index f + 3; 0 is never shown). */
export const FACET_TEXT = Object.freeze({
  sociability: ['Shuns company', 'Keeps to themselves', 'A little reserved', '', 'Enjoys a chat', 'Loves company', 'Cannot bear to be alone'],
  temper: ['Never rattled', 'Slow to anger', 'Even-tempered', '', 'Short-tempered', 'Quick to anger', 'A furnace of a temper'],
  nerve: ['Jumps at shadows', 'Easily frightened', 'A little nervous', '', 'Steady', 'Brave', 'Fearless'],
  diligence: ['Bone idle', 'Easily tired of work', 'Likes a short day', '', 'Hard-working', 'Tireless', 'Works until they drop'],
  fancy: ['Blind to beauty', 'Plain in taste', 'Not fussy', '', 'Likes fine things', 'Has an eye for beauty', 'Lives for beauty'],
  reverence: ['Mocks the old powers', 'Has little faith', 'Doubtful', '', 'Devout', 'Deeply devout', 'Lives by the old rites'],
});
export const VALUE_TEXT = Object.freeze({
  craft: ['Thinks little of craft', 'Cares little for craft', '', 'Values good work', 'Lives for the craft'],
  kin: ['Cares little for family', 'Keeps family at a distance', '', 'Values family', 'Family is everything'],
  order: ['Scorns rules', 'Bends the rules', '', 'Values order', 'Lives by the law'],
  valour: ['Thinks fighting is folly', 'Avoids a fight', '', 'Values courage', 'Lives for glory'],
});

/**
 * Facet rules (3.2). All small integers; the logic multiplies by them.
 *   chatPct: chat chance +x% per point of Sociability; lonelyNever: at or below this, never Lonely.
 *   fancyPct / reverencePct: thought multipliers per point; shiftH: work hours tolerated at Diligence 0.
 *   driftPct: chance a facet drifts by 1 after a friend's death (Temper up).
 */
export const FACET_RULES = Object.freeze({ chatPct: 15, lonelyNever: -2, fancyPct: 20, reverencePct: 25, shiftH: 14, driftPct: 10 });

/** Thought tags each facet scales (x(1 + pct x f / 100)). */
export const FACET_TAGS = Object.freeze({ fancy: ['room', 'beauty'], reverence: ['reverence'] });
/** Thought tags each value colours: at +2 the thought counts double, at -2 half. */
export const VALUE_TAGS = Object.freeze({ craft: 'v_craft', kin: 'v_kin', order: 'v_order', valour: 'v_valour' });

/**
 * Preference pools (3.2): 5 liked (one of each kind but `drink` or `item`, which share a slot by weight)
 * and 1 disliked. Entries are [id, weight]. `byAnc` multiplies weights (x100) for an ancestry.
 * Kinds: material (stone or metal), gem, food, drink, creature, item; disliked: creature or food.
 */
export const PREF_POOLS = Object.freeze({
  material: [['granite', 10], ['marble', 8], ['slate', 8], ['basalt', 6], ['limestone', 6], ['sandstone', 5], ['duskstone', 3],
    ['iron', 8], ['copper', 6], ['bronze', 5], ['steel', 5], ['silver', 4], ['gold', 3], ['elderwood', 4], ['wood', 6]],
  gem: [['amber', 8], ['garnet', 8], ['sapphire', 6], ['emerald', 6], ['ruby', 5], ['heartstone', 2]],
  food: [['meat', 8], ['bread', 8], ['berries', 8], ['cheese', 6], ['honey', 6], ['apple', 6], ['fish', 5], ['glowcap', 3],
    ['smokedmeat', 4], ['finemeal', 4], ['egg', 4], ['hearthroot', 4]],
  drink: [['ale', 10], ['mead', 8], ['wine', 6], ['milk', 3]],
  creature: [['hen', 6], ['goat', 6], ['sheep', 6], ['ox', 5], ['deer', 6], ['hare', 6], ['boar', 3], ['wolf', 3], ['beetle', 3]],
  item: [['chair', 5], ['table', 5], ['bed', 4], ['statue', 5], ['figurine', 5], ['tapestry', 5], ['axe', 4], ['sword', 4],
    ['ring', 4], ['amulet', 4], ['finepottery', 4], ['book', 4], ['banner', 3], ['shortbow', 3], ['hammer', 3]],
  dislikeCreature: [['spider', 10], ['wolf', 5], ['boar', 4], ['beetle', 5], ['hen', 1], ['goat', 1]],
  dislikeFood: [['egg', 4], ['fish', 5], ['cheese', 4], ['glowcap', 5], ['hearthroot', 3], ['greens', 4]],
});
export const PREF_BY_ANC = Object.freeze({
  deepforge: { granite: 200, basalt: 200, iron: 160, steel: 160, gold: 160, ale: 200, glowcap: 200, heartstone: 200, hammer: 200 },
  sylvari: { wood: 250, elderwood: 250, berries: 200, apple: 200, deer: 200, hare: 160, wine: 160, tapestry: 160 },
  emberkin: { basalt: 200, copper: 160, ruby: 200, garnet: 160, smokedmeat: 200, sword: 160 },
  human: { bread: 160, ale: 140, chair: 140 },
});
/** The six slots in order: [kind, pools to draw from]. Slot 4 is a drink or an item kind. */
export const PREF_SLOTS = Object.freeze([['material'], ['gem'], ['food'], ['drink', 'item'], ['creature'], ['dislike']]);

/** Preference thoughts (ids in data/thoughts.js) and their ranges. */
export const PREF_RULES = Object.freeze({ seeR: 6, loathR: 4, fineTier: 3 });

/**
 * Life goals (3.2, edition 4): one per adult, drawn at arrival weighted by values and skills. `test` is
 * read by personality.js goalMet; `w` is the base weight; `val` the value that doubles the weight
 * per point; `sk` a skill whose level adds weight.
 */
export const GOALS = Object.freeze([
  { id: 'masterwork', label: 'Craft a masterwork', val: 'craft', w: 4, test: { deed: 'forged_master', n: 1, orQ: 5 } },
  { id: 'master', label: 'Become a master of their craft', val: 'craft', w: 6, test: { lvl: 15 } },
  { id: 'family', label: 'Raise a family', val: 'kin', w: 4, test: { spouse: true } },
  { id: 'friends', label: 'Have three true friends', val: 'kin', w: 5, test: { friends: 3 } },
  { id: 'crownhold', label: 'See the hold reach Stronghold', val: 'order', w: 4, test: { tier: 4 } },
  { id: 'great_beast', label: 'Slay a great beast', val: 'valour', w: 2, test: { thought: 'slew_beast_blow' } },
  { id: 'warrior', label: 'Slay twenty foes', val: 'valour', w: 4, test: { deed: 'kills', n: 20 } },
  { id: 'deep', label: 'Walk the deepest level', val: null, w: 3, test: { depth: 8 } },
  { id: 'artifact', label: 'See a thing of legend made', val: 'craft', w: 3, test: { artifact: true } },
]);
/** Life goal tuning: the year of joy, the age a goal is given up at. */
export const GOAL_RULES = Object.freeze({ metDays: 40, unfinishedAge: 70 });

/**
 * Memories (3.2): thought id -> the recurrence thought it leaves. Only these 12 leave one. A memory is
 * [thoughtId, year, season, value]; at most 8 a colonist (the weakest gives way); once a season each
 * rolls its recurrence at half value; each season it fades by 1 and drops at 0.
 */
export const MEMORY_OF = Object.freeze({
  friend_died: 'rem_grief', lover_died: 'rem_grief', kin_died: 'rem_grief', turned: 'rem_dark', saw_rise: 'rem_dark',
  raid_repelled: 'rem_victory', lost_limb: 'rem_battle', wedding: 'rem_joy', married: 'rem_joy', festival: 'rem_joy',
  ember_made: 'rem_pride', slew_beast_blow: 'rem_pride',
});
export const MEMORY_RULES = Object.freeze({ max: 8, rollPct: 60 });

/** Heat (2.6): Sweltering above hot C, worse above hotter; Heatstroke after strokeH hours above stroke C. */
export const HEAT = Object.freeze({ hot: 35, hotter: 45, stroke: 50, strokeH: 2, workPct: 70 });

/** Teaching (3.1): within r tiles of a Master (lvl) of the same skill, XP x pct / 100. */
export const TEACH = Object.freeze({ r: 3, lvl: 15, pct: 125 });
