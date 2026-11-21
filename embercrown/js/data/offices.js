// Offices and nobles (EMBERCROWN-FORTRESS.md 3.4, F17; step Z2.2). Data owner G for K; logic
// js/game/colony/offices.js (K); screen js/ui/officesui.js (I).
//
// OFFICES: file order is precedence (the Lord first in lists, then the Thane, then the appointed offices).
//   opens: { pop } living colonists, { squad } the first squad, { tier } a prosperity rank (tiers.js id).
//   by: 'player' (the office command), 'colonists' (the Thane: highest summed opinion, each Year's Turning),
//   'arrives' (the Lord or Lady of the Hold, sent by the Hearthwatch with two retainers).
//   needs: ids in NEEDS (the requests shown with a met or unmet mark). The Warden of Law row is Z2.12's.
// NEEDS: each is one test over rooms and buildings (offices.js needMet):
//   room: { has: [[def, ...], ...] every group has one finished building in the room, role: room role,
//           notRole: roles that do not count, tier: room tier id or better, bed: the holder's own bed is in it,
//           own: the room serves one holder only (offices are not shared) }
//   build: [def, ...] a finished building of one of these anywhere in the hold.
//   The doc's "desk" is a table: the hold has no desk structure (a G request if one is wanted).
// MANDATE: the Thane's and the Lord's mandates (3.4). KEEP_KINDS: what a Keep mandate may bar from trade.
// DOMAIN_OF: the renown domain a met mandate adds to (+2, read by renown.js in Z2.4).
// DATA.thought: the office thoughts (registered once offices.js is in DATA_FILES; G request).

export const OFFICES = Object.freeze([
  { id: 'lord', name: 'Lord of the Hold', nameAlt: 'Lady of the Hold', opens: { pop: 20, tier: 'hold' }, by: 'arrives', needs: ['bedroom_grand', 'dining_grand', 'office_majestic', 'tomb'],
    verb: 'Larger mandates; a yearly tribute from the Hearthwatch while kept well.', open: 'Reach the Hold rank with 20 colonists: the Hearthwatch sends a Lord.' },
  { id: 'thane', name: 'Thane', opens: { pop: 15 }, by: 'colonists', needs: ['office_fine', 'bedroom_fine', 'dining_fine'],
    verb: 'Mandates and requests; a Thane in good spirits makes the hold feel well led.', open: 'Chosen by the colonists once the hold has 15, and again each Year\'s Turning.' },
  { id: 'steward', name: 'Steward', opens: { pop: 4 }, by: 'player', needs: ['office_plain'],
    verb: 'Keeps stock targets: "keep 40 meals" becomes a bill at a bench that can make it.', open: 'Opens at 4 colonists.' },
  { id: 'reckoner', name: 'Reckoner', opens: { pop: 6 }, by: 'player', needs: ['desk'],
    verb: 'Exact counts in the Stock tab, with trends. Without one, counts above 20 are rounded.', open: 'Opens at 6 colonists.' },
  { id: 'marshal', name: 'Marshal', opens: { squad: true }, by: 'player', needs: ['weaponrack', 'barracks'],
    verb: 'Squad training schedules, uniforms and alert levels.', open: 'Opens with the first squad.' },
  { id: 'healer', name: 'Chief Healer', opens: { pop: 8 }, by: 'player', needs: ['infirmary_decent'],
    verb: 'Tends the worst first and soldiers first; keeps the infirmary supplied.', open: 'Opens at 8 colonists.' },
  { id: 'keeper', name: 'Keeper of Records', opens: { pop: 10 }, by: 'player', needs: ['study_plain'],
    verb: 'Fuller Annals and a yearly summary letter.', open: 'Opens at 10 colonists.' },
]);

const BEDS = ['bed', 'doublebed', 'cot', 'bedroll'];
const TABLES = ['table', 'longtable'];
const SEATS = ['chair', 'stool', 'bench'];
const NOT_OFFICE = ['bedroom', 'barracks', 'kitchen', 'infirmary', 'tomb'];

export const NEEDS = Object.freeze({
  office_plain: { label: 'An office: a table and a chair, Plain or better', room: { has: [TABLES, SEATS], notRole: NOT_OFFICE, tier: 'plain', own: true } },
  office_fine: { label: 'A Fine office', room: { has: [TABLES, SEATS], notRole: NOT_OFFICE, tier: 'fine', own: true } },
  office_majestic: { label: 'A Majestic office (a throne hall)', room: { has: [TABLES, SEATS], notRole: NOT_OFFICE, tier: 'majestic', own: true } },
  desk: { label: 'A desk (a table) in any room', room: { has: [TABLES] } },
  weaponrack: { label: 'An armoury rack', build: ['weaponrack'] },
  barracks: { label: 'A barracks', room: { role: 'barracks' } },
  infirmary_decent: { label: 'An infirmary, Decent or better', room: { role: 'infirmary', tier: 'decent' } },
  study_plain: { label: 'A study or library, Plain or better', room: { has: [['study', 'scriptorium']], tier: 'plain' } },
  bedroom_fine: { label: 'A Fine bedroom of their own', room: { bed: true, tier: 'fine' } },
  bedroom_grand: { label: 'A Grand bedroom of their own', room: { bed: true, tier: 'grand' } },
  dining_fine: { label: 'A seat at a Fine dining table', room: { role: 'dining', tier: 'fine' } },
  dining_grand: { label: 'A Grand dining hall', room: { role: 'dining', tier: 'grand' } },
  tomb: { label: 'A tomb prepared', build: ['sarcophagus', 'crypt'] },
});
export const BED_DEFS = Object.freeze(BEDS);

/** Requests and mandates (3.4). Days are game days. */
export const RULES = Object.freeze({
  unmetGraceDays: 10,     // a need unmet this long gives the holder -4 ...
  unmetStart: 2,          // ... as stack 2 of office_unmet (-2 a stack) ...
  unmetPerSeason: 1,      // ... growing by one stack (-2) a season
  unmetMax: 10,
  nobleGoodwill: -1,      // Hearthwatch goodwill a day while a noble's need is unmet past the grace
  wellLedMood: 50,        // the Thane's mood at or above this: "Well led" for all
  orderMin: 1,            // "Poorly kept nobles" and "Mandate ignored" touch colonists with Order >= this
  lordRetainers: 2,
  lordEveryDays: 40,      // a Lord arrives at most once a year (a dead Lord is replaced after a year)
  tributeGoodwill: 15,    // the Hearthwatch pays tribute at the Year's Turning when goodwill is at least this ...
  tributeSilver: 20,      // ... 20 silver ingots, or 3 cut gems, or a colonist, in turn by year
  tributeGems: 3,
  goodwillMet: 3, goodwillBroken: -5,
});

export const MANDATE = Object.freeze({
  gapDays: 12,            // days after a noble's last mandate before the next may open
  openPct: 35,            // the daily chance (a hash of the seed, the day and the noble) once the gap has passed
  keepPct: 25,            // of mandates, the share that are Keep mandates
  make: { thane: { n: 3, days: 10 }, lord: { n: 5, days: 15 } },
  // the kinds a Make mandate falls back on when none of the noble's liked kinds has a bench in the hold
  kinds: ['chair', 'table', 'statue', 'figurine', 'ring', 'amulet', 'tapestry', 'axe', 'sword', 'hammer', 'finepottery', 'banner', 'shortbow', 'bed', 'book'],
});
export const KEEP_KINDS = Object.freeze([['ingot', 'steel'], ['ingot', 'silver'], ['ingot', 'gold'], ['ingot', 'iron'], ['cutgem', null], ['ingot', 'bronze']]);
export const DOMAIN_OF = Object.freeze({
  axe: 'smithing', sword: 'smithing', hammer: 'smithing', ring: 'smithing', amulet: 'smithing', ingot: 'smithing',
  statue: 'smithing', figurine: 'smithing', chair: 'smithing', table: 'smithing', bed: 'smithing', finepottery: 'smithing',
  tapestry: 'trade', banner: 'arms', shortbow: 'arms', book: 'lore', cutgem: 'delving',
});
export const RENOWN_DOMAINS = Object.freeze(['smithing', 'growing', 'lore', 'trade', 'arms', 'delving']);

/** Words for letters and the screen. */
export const TEXT = Object.freeze({
  thaneChosen: '{name} is chosen as Thane',
  thaneChosenText: 'The colonists have spoken at the Year\'s Turning: {name} is held in the highest regard, and will speak for the hold.',
  thaneFirstText: 'The hold is large enough to need a voice. The colonists have chosen {name}, the one they hold in the highest regard, as their Thane.',
  thaneKept: '{name} remains Thane',
  lordArrives: '{title} {name} arrives',
  lordArrivesText: 'The Hearthwatch has sent {title} {name} to take the seat of the hold, with {retainers}. The Thane keeps the title, but the Lord takes precedence.',
  mandateMake: '{title} {name} asks for {n} {what} within {days} days.',
  mandateKeep: '{title} {name} forbids trading away any {what} this season.',
  mandateMet: 'The mandate is met: {what}. {name} is pleased.',
  mandateBroken: 'The mandate of {name} was not met: {what}.',
  tribute: 'Tribute from the Hearthwatch',
  tributeText: 'Pleased with how {name} is kept, the Hearthwatch sends {what}.',
  summary: 'The Keeper\'s summary of the year',
  summaryText: 'Year {year}: {alive} colonists, {born} came to the hold and {died} were lost. The hold is a {rank}. {extra}',
});

export const DATA = {
  thought: [
    { id: 'office_unmet', label: 'My office is poorly kept', value: -2, durationH: 0, stack: { max: 10, decay: 100 }, tags: ['office', 'v_order'], text: 'A request of their office has gone unmet for days.' },
    { id: 'well_led', label: 'Well led', value: 2, durationH: 0, tags: ['office', 'v_order'], text: 'The Thane is in good spirits.' },
    { id: 'nobles_poorly_kept', label: 'Our nobles are poorly kept', value: -1, durationH: 0, tags: ['office'], text: 'A noble\'s request goes unmet.' },
    { id: 'mandate_met', label: 'My mandate was met', value: 6, durationH: 240, tags: ['office'] },
    { id: 'mandate_broken', label: 'My mandate was ignored', value: -8, durationH: 240, tags: ['office'] },
    { id: 'mandate_ignored', label: 'Mandate ignored', value: -2, durationH: 120, tags: ['office'], text: 'A noble\'s mandate went unmet, and nobody answered for it.' },
    { id: 'chosen_thane', label: 'Chosen as Thane', value: 6, durationH: 240, tags: ['office', 'v_order'] },
  ],
};
