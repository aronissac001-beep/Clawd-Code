// Civ kinds, the peoples of history, site kinds and the history sim's numbers (EMBERCROWN-WORLD.md 2.2-2.3,
// 4.5; OWNER G). Read by js/game/realm/civs.js, history.js and roads.js.
//
// CIVKINDS and SITE_KINDS are APPEND-ONLY: a civ row stores its kind id and a site row its kind id in the realm
// record (9.2). Names are original wording.

/**
 * The 12 civ kinds of 4.5. `peoples`: who may form one ('*' any); `role`: the faction role key it can fill (G7;
 * null = its own `c<n>` faction); `style`: `noun` gives "the <name> <noun>", `of` gives "<noun> of <name>".
 * `aggr` raises the yearly war chance (2.3 step 3): each point of the two kinds' sum adds half the base chance.
 * Until W4 the kingdom (`realm`) also stands for the Deepforge, Thornwake and Emberkin homelands (their own
 * kinds come with their peoples); kinds whose peoples do not exist yet are never rolled.
 */
export const CIVKINDS = Object.freeze([
  { id: 'realm', peoples: ['human', 'deepforge', 'sylvari', 'emberkin'], role: 'hearthwatch', noun: 'Kingdom', style: 'of', aggr: 0 },
  { id: 'league', peoples: ['human', 'murrow'], role: 'league', noun: 'League', style: 'noun', aggr: 0 },
  { id: 'band', peoples: ['*'], role: 'gutterkin', noun: 'Band', style: 'noun', aggr: 1 },
  { id: 'clans', peoples: ['human', 'emberkin', 'wendrel'], role: 'ashfang', noun: 'Clans', style: 'noun', aggr: 2 },
  { id: 'pilgrims', peoples: ['greyborn', 'human'], role: 'pilgrims', noun: 'Pilgrims', style: 'noun', aggr: 0 },
  { id: 'warren', peoples: ['murrow'], role: null, noun: 'Warrens', style: 'noun', aggr: 0 },
  { id: 'court', peoples: ['tarnfolk'], role: null, noun: 'Court', style: 'noun', aggr: 0 },
  { id: 'synod', peoples: ['kilnfolk'], role: null, noun: 'Synod', style: 'noun', aggr: 0 },
  { id: 'drovers', peoples: ['wendrel'], role: null, noun: 'Drovers', style: 'noun', aggr: 1 },
  { id: 'wardens', peoples: ['sylvari'], role: null, noun: 'Wardens', style: 'noun', aggr: 1 },
  { id: 'choir', peoples: ['greyborn'], role: null, noun: 'Choir', style: 'noun', aggr: 1 },
  { id: 'lamps', peoples: ['lamplost'], role: null, noun: 'Lamps', style: 'noun', aggr: 0 },
]);
export const CIVKIND_INDEX = Object.freeze(Object.fromEntries(CIVKINDS.map((k, i) => [k.id, i])));

/**
 * The peoples history can found civs of, with their history fields (W4 moves these to js/data/ancestries.js,
 * 4.1, and adds the six new peoples): homeBiomes (biome fit weights 0-3; a biome not listed fits at `other`),
 * settle (site style), lifespan [adult, old, max] years, water (needs a river, lake or coast), open (avoids open
 * plains: -1 fit on lowland greenvale and moor), relief (+fit on upland and highland regions), guard (a defender's bonus at its sites: dug-in holds).
 */
export const HISTORY_PEOPLES = Object.freeze({
  human: { homeBiomes: { greenvale: 3, shore: 3, moor: 2, taiga: 1, fen: 1, elderwood: 1 }, settle: 'town', lifespan: [18, 60, 90] },
  sylvari: { homeBiomes: { elderwood: 3, greenvale: 2, taiga: 2 }, settle: 'grove', lifespan: [30, 140, 220] },
  deepforge: { homeBiomes: { highcrag: 3, redscar: 3, moor: 1, tundra: 1 }, settle: 'hold', lifespan: [25, 110, 180], relief: 1, guard: 3 },
  emberkin: { homeBiomes: { ashlands: 3, redscar: 2, saltflat: 2 }, settle: 'town', lifespan: [16, 50, 75] },
});
/** Biome fit of a biome no people lists (0-3 scale). */
export const OTHER_FIT = 0.5;

/**
 * The opening roster (2.2): civ k of a world takes row k while rows last (so every world has a kingdom of each
 * playable people and the five faction roles fill early), then a seeded pick of `extra`. `*` is a seeded people.
 */
export const ROSTER = Object.freeze([
  ['human', 'realm'], ['deepforge', 'realm'], ['sylvari', 'realm'], ['emberkin', 'clans'], ['human', 'league'],
  ['*', 'band'], ['human', 'pilgrims'], ['sylvari', 'wardens'], ['deepforge', 'realm'], ['human', 'clans'],
]);
export const ROSTER_EXTRA = Object.freeze([['human', 'realm'], ['deepforge', 'realm'], ['emberkin', 'realm'], ['human', 'league'], ['*', 'band'], ['emberkin', 'clans']]);

/** The people each start preset needs a civ of within `GUARD.startReach` regions (1.4; 3.8). null: any civ; kind: a civ of that kind. */
export const START_PEOPLE = Object.freeze({
  hearthwatch: null, deepforge: { people: 'deepforge' }, lone_ember: null, murrow_warren: { people: 'murrow' },
  tarn_shore: { people: 'tarnfolk' }, wendrel_drovers: { people: 'wendrel' }, refugees: null, crown_charter: { kind: 'realm' },
});

/** Site kinds of 2.2 (APPEND-ONLY). */
export const SITE_KINDS = Object.freeze(['camp', 'hamlet', 'village', 'town', 'city', 'hold', 'grove', 'stilt', 'nomad', 'tower', 'shrine', 'lair', 'ruin', 'battlefield', 'vault']);
/** The kind of a living site by its people's settle style and its size 0-5. */
export const SETTLE_KINDS = Object.freeze({
  town: ['camp', 'hamlet', 'village', 'town', 'city', 'city'],
  hold: ['camp', 'hold', 'hold', 'hold', 'hold', 'hold'],
  grove: ['camp', 'grove', 'grove', 'grove', 'town', 'town'],
  stilt: ['camp', 'stilt', 'stilt', 'stilt', 'town', 'town'],
  nomad: ['nomad', 'nomad', 'nomad', 'nomad', 'nomad', 'nomad'],
  warren: ['camp', 'hamlet', 'village', 'village', 'town', 'town'],
  kiln: ['camp', 'hold', 'hold', 'town', 'town', 'town'],
});

/** Civ and site names (original wording): civ "<a><b>", site "<c><d>". */
export const PLACE_PARTS = Object.freeze({
  human: { a: ['Varn', 'Ald', 'Bryn', 'Hal', 'Mer', 'Ost', 'Tam', 'Cor', 'Wen', 'Gar', 'Lis', 'Ross'], b: ['holt', 'mark', 'ford', 'wick', 'stead', 'mere', 'dale', 'burh'] },
  sylvari: { a: ['Ilw', 'Sael', 'Thes', 'Veyr', 'Ori', 'Fael', 'Lir', 'Nys'], b: ['wyn', 'aleth', 'ondel', 'irin', 'avel', 'esse'] },
  deepforge: { a: ['Dur', 'Kor', 'Hesk', 'Bram', 'Thra', 'Gis', 'Hold', 'Brok'], b: ['grund', 'delve', 'hall', 'vault', 'deep', 'karn'] },
  emberkin: { a: ['Ruk', 'Szar', 'Grosh', 'Vek', 'Taz', 'Krev', 'Zhan', 'Bor'], b: ['maw', 'kar', 'ash', 'tusk', 'zhar', 'gor'] },
});
export const SITE_PARTS = Object.freeze({
  c: ['Thorn', 'Ash', 'Ember', 'Brook', 'Stone', 'Elm', 'Hollow', 'Raven', 'Salt', 'Cinder', 'Moss', 'Iron', 'Fern', 'Rush', 'Briar', 'Cold', 'Red', 'Grey', 'High', 'Mill'],
  d: ['mark', 'ford', 'wick', 'stead', 'gate', 'hill', 'wood', 'barrow', 'combe', 'well', 'ridge', 'field', 'cross', 'haven', 'stair', 'reach'],
});

/** The history sim's numbers (2.3). Distances are regions at the Standard size; the sim scales them by n / 64. */
export const HISTORY_GEN = Object.freeze({
  /** caps (2.2): sites and events at the Standard size (sites scale by area); civs = the params count + `civsExtra`, at most `civsMax`. */
  caps: { sites: 160, events: 6000, wars: 25, figures: 600, civsExtra: 3, civsMax: 16 },
  /** events past these row counts drop importance 0, then 1 (2.4); importance 2-3 are always logged. */
  logFloor: [4200, 5400],
  capital: { minGap: 9, taintMax: 150 },
  /** growth: chance a year = base + perFit * fit (fit 0-3), size cap by fit. */
  grow: { base: 0.02, perFit: 0.03, capByFit: [2, 3, 4, 5], daughter: 0.06, reach: 6, gap: 2, taintMax: 150 },
  /** territory radius (Chebyshev) by site size 0-5. */
  claim: [1, 1, 2, 2, 3, 3],
  contact: 3,
  /** war (2.3 step 3): a defender adds `ground` by the target's elevation band (sea, lowland, upland, highland, peak) and `capital` at its capital. */
  war: { perRel: 400, lenMin: 3, lenRnd: 12, battlesMax: 2, front: 5, rnd: 4, cooldown: 8, ground: [0, 0, 2, 4, 4], capital: 2,
    outcome: { taken: 40, razed: 35, tribute: 25 } },
  ruler: { heirPct: 80, splitPct: 30, splitMin: 4, aggrPct: 25 },
  hollow: { advance: 0.04, recede: 0.03, ringMax: 6, ringMin: -3, perRing: 12, falls: 200 },
  plague: 0.01, famine: 0.01,
  pact: { rel: 60, chance: 0.05 },
  /** roads (1.2 step 10): cost in half-days, plains 2, hills 4, mountains 6, a river barge 1; a road joins sites within `reach`. */
  road: { plain: 2, hill: 4, mount: 6, river: 1, reach: 14, perCiv: 6 },
  /** the guarantees of 1.4 that history answers for. */
  guard: { alive: { small: 3, standard: 4, large: 4 }, startReach: 10 },
  /** figures, deeds and artifacts (2.3 steps 5 and 10, 2.5; read by js/game/realm/figures.js, which documents each key). */
  figures: Object.freeze({
    deedPct: 0.06, founders: 2, birthsMax: 3, target: { base: 7, perSites: 2, max: 14 }, reserve: 6, pace: 30,
    roles: Object.freeze({ hero: 3, smith: 2, scholar: 1, bard: 1, outlaw: 1, priest: 1, envoy: 1 }),
    deeds: Object.freeze({
      ruler: { slew: 1, wed: 2, sang: 0, wrote: 0.5 }, hero: { slew: 4, hunt: 3, found: 1, wed: 1 }, smith: { forged: 5, wed: 1 },
      scholar: { wrote: 5, found: 2, wed: 1 }, bard: { sang: 5, wed: 1 }, outlaw: { slew: 3, exiled: 2, found: 1 },
      priest: { healed: 4, wrote: 1, wed: 1 }, envoy: { wed: 3, wrote: 2 },
    }),
    warSlew: 3, pactForge: 2, pactWed: 2, plagueHeal: 3, plagueYears: 3,
    battle: { perHero: 1, perRen: 0.25, renMax: 8, max: 6, dieLose: 0.2, dieWin: 0.06 },
    far: 6, found: 8, hunt: { reach: 6, slay: 0.2, perRen: 0.06, renMax: 8, wound: 0.35 },
    ren: { slew: 2, hunt: 4, wound: 1, forged: 2, found: 2, other: 1 },
    art: 50, artMin: 20, plague: [1, 3], kinGrief: 10,
  }),
  /** beasts and lairs (2.3 step 6; read by js/game/realm/beasts.js, which documents each key). */
  beasts: Object.freeze({
    count: Object.freeze({ low: 5, normal: 8, high: 11 }), min: 4, max: 12, first: 0.75, wake: [20, 20],
    wild: 90, gap: 8, siteGap: 3, roam: [5, 20], reach: 4, kill: 0.35, ancient: [40, 600],
  }),
  /** artifact words (stored as ids, APPEND-ONLY): kinds, materials, name parts `a` + `b` (an artifact's `nm`), kind ids by role. */
  artifacts: Object.freeze({
    kinds: Object.freeze(['blade', 'axe', 'spear', 'hammer', 'bow', 'shield', 'helm', 'crown', 'ring', 'amulet', 'chalice', 'tome', 'harp', 'banner', 'trophy']),
    mats: Object.freeze(['iron', 'steel', 'bronze', 'silver', 'gold', 'bone', 'oak', 'obsidian', 'emberglass', 'jade', 'moonstone', 'horn']),
    a: Object.freeze(['Dawn', 'Grief', 'Ember', 'Hollow', 'Oath', 'Thorn', 'Ash', 'Star', 'Frost', 'Iron', 'Hearth', 'Storm', 'Gloam', 'Bright', 'Cinder', 'Vigil']),
    b: Object.freeze(['bane', 'song', 'warden', 'keeper', 'fall', 'light', 'call', 'mourn', 'ward', 'brand', 'heart', 'tide', 'reach', 'mark']),
    byRole: Object.freeze({ smith: [0, 1, 2, 3, 4, 5, 6, 8, 9, 10], scholar: [11], bard: [12], priest: [10, 9], ruler: [7, 13] }),
  }),
});
