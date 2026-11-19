// A colonist's deeds: the counters perks are earned by (EMBERCROWN-FORTRESS.md 3.1, F10). OWNER G (data),
// logic F (js/game/people/coldeeds.js). Not a registry kind: coldeeds.js and people/perks.js import it directly.
//
// col.done is a positional array of DONE_LEN unsigned 16-bit counters (saturating at 65,535): COL_DEEDS[k]
// lives at col.done[COL_DEEDS[k].slot]. Slots are saved by position: never reorder or reuse one, only
// append (as with the schema's positional arrays). `internal` slots hold small state the counting needs
// (they are never shown). `by` says which system counts it: 'F coldeeds' are counted today from existing
// hooks; any other owner calls coldeeds.didDeed(s, col, id, n) at the source (open requests, S9.3 report).
//
// Player-facing text: `past` ends the "has learned" toast and the Chronicle line ("Bryn has learned Seam
// Follower: mined 150 ore"); `prog` is the Skills tab's "next" line ("mined 112 of 150 ore"). No emoji.

/** Length of col.done (the schema field, owner A). 37 slots are used; the rest are room to append. */
export const DONE_LEN = 48;
/** Counters saturate here (Uint16). */
export const DONE_MAX = 65535;

export const COL_DEEDS = Object.freeze([
  // ---- mining ----
  { id: 'mined', slot: 0, past: 'mined {n} tiles of rock', prog: 'mined {have} of {n} tiles of rock', by: 'F coldeeds (onMined)' },
  { id: 'ore_mined', slot: 1, past: 'followed {n} ore seams', prog: 'mined {have} of {n} ore', by: 'F coldeeds (onMined)' },
  { id: 'gems_mined', slot: 2, past: 'cut {n} gems from the rock', prog: 'mined {have} of {n} gems', by: 'F coldeeds (onMined)' },
  { id: 'caveins_near', slot: 3, past: 'lived through {n} cave-ins close by', prog: 'near {have} of {n} cave-ins', by: 'F coldeeds (onCaveIn)' },
  { id: 'halls_carved', slot: 4, past: 'carved {n} halls', prog: 'carved {have} of {n} halls', by: 'F coldeeds (onMined: the last tile of a carve plan of 40+ tiles)' },
  // ---- construction ----
  { id: 'supports_built', slot: 5, past: 'set {n} props and pillars', prog: 'built {have} of {n} props or pillars', by: 'F coldeeds (built event)' },
  { id: 'deconstructed', slot: 6, past: 'took down {n} structures', prog: 'took down {have} of {n} structures', by: 'F coldeeds (BUS.removed)' },
  { id: 'walls_built', slot: 7, past: 'raised {n} walls', prog: 'built {have} of {n} walls', by: 'F coldeeds (built event)' },
  { id: 'raid_repairs', slot: 8, past: 'repaired {n} structures under attack', prog: 'repaired {have} of {n} structures in raids', by: 'E repair (request)' },
  // ---- smithing ----
  { id: 'ore_smelted', slot: 9, past: 'smelted {n} loads of ore', prog: 'smelted {have} of {n} loads of ore', by: 'F coldeeds (crafted event: ingots)' },
  { id: 'forged_fine', slot: 10, past: 'forged {n} pieces of Superior work or better', prog: 'forged {have} of {n} Superior pieces', by: 'F coldeeds (crafted event: weapons, armour, tools)' },
  { id: 'forged_master', slot: 11, past: 'forged {n} masterworks', prog: 'forged {have} of {n} masterworks', by: 'F coldeeds (crafted event: weapons, armour, tools)' },
  { id: 'forged_kills', slot: 12, past: 'armed the hands that slew {n} Hollow', prog: 'their blades slew {have} of {n} Hollow', by: 'F coldeeds (BUS.kill: the weapon maker)' },
  // ---- medicine ----
  { id: 'wounds_tended', slot: 13, past: 'tended {n} wounds', prog: 'tended {have} of {n} wounds', by: 'F health.tend (wounds first tended)' },
  { id: 'infections_cured', slot: 14, past: 'cured {n} infections', prog: 'cured {have} of {n} infections', by: 'F health (the last doctor of a cured infected wound)' },
  { id: 'taint_tended', slot: 15, past: 'tended {n} taint wounds', prog: 'tended {have} of {n} taint wounds', by: 'F health.tend (a tainted patient)' },
  { id: 'bleeds_stopped', slot: 16, past: 'kept {n} fallen colonists from bleeding out', prog: 'saved {have} of {n} from bleeding out', by: 'F health.tend (a downed patient whose bleeding stopped)' },
  // ---- melee ----
  { id: 'choke_raids', slot: 17, past: 'held a narrow way in {n} raids', prog: 'held a 1-tile choke in {have} of {n} raids', by: 'F coldeeds (choke scan during raids)' },
  { id: 'elites_felled', slot: 18, past: 'felled {n} captains and elites', prog: 'felled {have} of {n} captains or elites', by: 'F coldeeds (BUS.kill); H downFoe (request)' },
  { id: 'recovered', slot: 19, past: 'fell and rose again {n} times', prog: 'downed and recovered {have} of {n} times', by: 'F coldeeds (downed event, then up again)' },
  { id: 'kills', slot: 20, past: 'slew {n} foes', prog: 'slew {have} of {n} foes', by: 'F coldeeds (BUS.kill)' },
  // ---- archery ----
  { id: 'shots_hit', slot: 21, past: 'landed {n} shots', prog: 'hit {have} of {n} shots', by: 'H fight.swing (a ranged hit)' },
  { id: 'post_kills', slot: 22, past: 'made {n} kills from a tower or on Hold', prog: 'made {have} of {n} kills from a tower or on Hold', by: 'F coldeeds (BUS.kill)' },
  { id: 'volley_kills', slot: 23, past: 'made {n} kills beside fellow archers', prog: 'made {have} of {n} kills in a squad of archers', by: 'F coldeeds (BUS.kill)' },
  // ---- signature deeds ----
  { id: 'traps_set', slot: 24, past: 'built or rearmed {n} traps', prog: 'built or rearmed {have} of {n} traps', by: 'F coldeeds (built event); H/E rearm (request)' },
  { id: 'stone_worked', slot: 25, past: 'smoothed or engraved {n} tiles of stone', prog: 'smoothed or engraved {have} of {n} tiles', by: 'E smooth / engrave (request)' },
  { id: 'garments', slot: 26, past: 'sewed {n} garments', prog: 'sewed {have} of {n} garments', by: 'F coldeeds (crafted event: apparel)' },
  { id: 'fine_meals', slot: 27, past: 'cooked {n} fine meals', prog: 'cooked {have} of {n} fine meals', by: 'F coldeeds (crafted event: fine meals, feasts)' },
  { id: 'harvested', slot: 28, past: 'harvested {n} plants', prog: 'harvested {have} of {n} plants', by: 'F coldeeds (harvested event)' },
  { id: 'tamed', slot: 29, past: 'tamed {n} animals', prog: 'tamed {have} of {n} animals', by: 'F coldeeds (tamed event)' },
  { id: 'researched', slot: 30, past: 'brought the hold {n} new techs', prog: 'researched {have} of {n} techs', by: 'E lore giver (the scholar who finishes a research)' },
  { id: 'tablets_read', slot: 31, past: 'read {n} lore tablets', prog: 'read {have} of {n} lore tablets', by: 'K lore tablets (request)' },
  { id: 'walls_engraved', slot: 32, past: 'engraved {n} walls with the hold\'s story', prog: 'engraved {have} of {n} walls', by: 'E art giver (request)' },
  { id: 'trades', slot: 33, past: 'struck {n} bargains', prog: 'made {have} of {n} trades', by: 'K trade (request)' },
  { id: 'persuaded', slot: 34, past: 'won over {n} prisoners', prog: 'persuaded {have} of {n} prisoners', by: 'H capture (request)' },
  // ---- internal state (never shown) ----
  { id: 'downed_open', slot: 35, internal: true, by: 'F coldeeds: 1 while a downing waits for the colonist to stand again' },
  { id: 'choke_mark', slot: 36, internal: true, by: 'F coldeeds: (raid id mod 65,535) + 1 of the last raid counted in choke_raids' },
]);

/**
 * How each of the 33 perks is earned (3.1 table): the skill level (the perk row's lvl) and the deeds.
 * `all` must every one hold; `any` is "or" (one is enough). Keyed by perk id (js/data/perks.js).
 */
export const PERK_EARN = Object.freeze({
  // Mining
  cave_sense: { lvl: 10, any: [{ deed: 'caveins_near', n: 2 }, { deed: 'mined', n: 400 }] },
  seam_follower: { lvl: 10, all: [{ deed: 'ore_mined', n: 150 }] },
  stonefriend: { lvl: 20, all: [{ deed: 'halls_carved', n: 3 }] },
  heartdelver: { lvl: 20, all: [{ deed: 'gems_mined', n: 40 }] },
  // Construction
  quick_shoring: { lvl: 10, all: [{ deed: 'supports_built', n: 20 }] },
  salvager: { lvl: 10, all: [{ deed: 'deconstructed', n: 60 }] },
  master_builder: { lvl: 20, all: [{ deed: 'walls_built', n: 300 }] },
  siege_engineer: { lvl: 20, all: [{ deed: 'raid_repairs', n: 40 }] },
  // Smithing
  reforger: { lvl: 10, all: [{ deed: 'ore_smelted', n: 40 }] },
  temperer: { lvl: 10, all: [{ deed: 'forged_fine', n: 10 }] },
  crownsmith: { lvl: 20, all: [{ deed: 'forged_master', n: 3 }] },
  ashquencher: { lvl: 20, all: [{ deed: 'forged_kills', n: 30 }] },
  // Medicine
  field_surgeon: { lvl: 10, all: [{ deed: 'wounds_tended', n: 40 }] },
  fever_watch: { lvl: 10, all: [{ deed: 'infections_cured', n: 5 }] },
  taintbreaker: { lvl: 20, all: [{ deed: 'taint_tended', n: 15 }] },
  ember_hands: { lvl: 20, all: [{ deed: 'bleeds_stopped', n: 5 }] },
  // Melee
  shieldwall: { lvl: 10, all: [{ deed: 'choke_raids', n: 3 }] },
  duelist: { lvl: 10, all: [{ deed: 'elites_felled', n: 3 }] },
  unbroken: { lvl: 20, all: [{ deed: 'recovered', n: 2 }] },
  warcry: { lvl: 20, all: [{ deed: 'kills', n: 60 }] },
  // Archery
  fire_arrows: { lvl: 10, all: [{ deed: 'shots_hit', n: 150 }] },
  overwatch: { lvl: 10, all: [{ deed: 'post_kills', n: 20 }] },
  deadeye: { lvl: 20, all: [{ deed: 'elites_felled', n: 5 }] },
  volley_captain: { lvl: 20, all: [{ deed: 'volley_kills', n: 30 }] },
  // Signature perks (15)
  trapwright: { lvl: 15, all: [{ deed: 'traps_set', n: 30 }] },
  stone_carver: { lvl: 15, all: [{ deed: 'stone_worked', n: 200 }] },
  banner_maker: { lvl: 15, all: [{ deed: 'garments', n: 20 }] },
  hearth_cook: { lvl: 15, all: [{ deed: 'fine_meals', n: 200 }] },
  graft_hand: { lvl: 15, all: [{ deed: 'harvested', n: 300 }] },
  beast_friend: { lvl: 15, all: [{ deed: 'tamed', n: 5 }] },
  deep_reader: { lvl: 15, any: [{ deed: 'researched', n: 10 }, { deed: 'tablets_read', n: 2 }] },
  chronicler: { lvl: 15, all: [{ deed: 'walls_engraved', n: 20 }] },
  silver_tongue: { lvl: 15, any: [{ deed: 'trades', n: 20 }, { deed: 'persuaded', n: 2 }] },
});

/** Counting rules the logic reads (numbers live in data). */
export const DEED_RULES = Object.freeze({
  caveInR: 6,            // Chebyshev tiles from a collapsed tile that count as "close by"
  hallMinTiles: 40,      // a carve plan of at least this many tiles (rect minus kept natural pillars) is a hall
  elitePts: 90,          // a foe worth this many threat points (or a nemesis) is an elite
  volleyArchers: 2,      // archers (the killer counted) in the killer's squad for a volley kill
  chokeEveryTicks: 20,   // the choke scan's cadence during a live raid (1 s)
  rangedReach: 30,       // an item weapon with reach >= this is ranged (threat/fight.js dataWeapon)
  gemDeposits: ['amber', 'garnet', 'sapphire', 'emerald', 'ruby', 'heartstone'],
  notOre: ['clay'],      // deposits whose mining is not an "ore seam"
  smithCats: ['weapons', 'armour', 'tools'],
  smeltCats: ['ingots'],
  garmentCats: ['apparel'],
  fineMeals: ['finemeal', 'feast'],
  forgedFineQ: 3,        // quality index: 3 Superior (the "Excellent or better" of 3.1), 4 Masterwork
  masterQ: 4,
  logCap: 20,            // col.log keeps this many lines
  checkEveryTicks: 600,  // the earn check: once a game hour
});
