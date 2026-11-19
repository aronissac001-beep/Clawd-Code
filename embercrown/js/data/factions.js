// World factions and towns (doc 9.8; owner G, logic K in colony/factions.js). Not the old
// ancestry factions: ancestries live in ancestries.js (F). goodwill: the faction keeps a
// -100..100 standing with the colony; start is its value at a new colony.
// Stage 2 (14.8 row G): the five world factions of 9.8 and their towns (caravan and envoy targets).
// s.colony.factions keeps a standing for the goodwill factions only (league, hearthwatch, gutterkin).
export const DATA = {
  faction: [
    { id: 'league', name: 'River League', kind: 'traders', goodwill: true, start: 0, text: 'Barge-traders of the lower river. Goodwill moves their prices.' },
    { id: 'hearthwatch', name: 'Hearthwatch', kind: 'knights', goodwill: true, start: 10, text: 'The remnant knights of the old watch: envoys, refugees and requests.' },
    { id: 'gutterkin', name: 'Gutterkin', kind: 'thieves', goodwill: true, start: -20, text: 'Tunnel thieves. 200 coins halves their raids for a season.' },
    { id: 'ashfang', name: 'Ashfang Reavers', kind: 'raiders', goodwill: false, start: -100, text: 'Warbands from the Grey Edge. They do not parley; they burn and carry off.' },
    { id: 'pilgrims', name: 'Grey Pilgrims', kind: 'pilgrims', goodwill: false, start: 0, text: 'Tainted wanderers who walk toward the Hollow. Neither friend nor foe, until they are.' },
  ],
  town: [
    { id: 'saltford', name: 'Saltford', faction: 'league', days: [3, 5], text: 'A river market two days downstream.' },
    { id: 'greywatch', name: 'Greywatch', faction: 'hearthwatch', days: [4, 6], text: 'The last tower of the watch.' },
    { id: 'millbrook', name: 'Millbrook', faction: 'league', days: [2, 4], text: 'A mill town on the near bank: grain, flour and gossip.' },
    { id: 'lanternmere', name: 'Lanternmere', faction: 'league', days: [5, 7], text: 'A lake port where the League keeps its counting houses.' },
    { id: 'emberford', name: 'Emberford', faction: 'hearthwatch', days: [3, 5], text: 'A walled crossing held by the watch\'s last knights.' },
    { id: 'drainhollow', name: 'Drainhollow', faction: 'gutterkin', days: [2, 3], text: 'A warren under an old city: the Gutterkin\'s market, if they let you in.' },
  ],
};

// ---- LEGACY (roguelite) -------------------------------------------------------------------
// The old ancestry factions below are still imported by roguelite modules (js/game/sim.js,
// systems/factions.js, systems/military.js, ui/infocard.js, ui/codexui.js). They are not
// colony content (not in DATA) and go when those modules are deleted (A, doc 13.5).
// Factions. Ids and the links below (unit, building, heroClass) are fixed;
// js/game/systems/factions.js implements the passives and drawbacks.
// `open: true` = playable on the very first run; the others are Ember Citadel unlocks
// (u_<id>, see js/game/meta/citadel.js factionUnlocked). `playable` = in the game at all.
// (Mirefolk and the Pale Court were cut in the rework: both rested on systems that are gone.)
export const FACTIONS = {
  dawnhold: {
    id: 'dawnhold', name: 'Dawnhold', people: 'Humans', playable: true, open: true,
    passive: 'Royal architects: +1 option in every blueprint draft. Unique: Dawn Lancers (charging cavalry) and the Cathedral of Dawn (faster work and healing).',
    drawback: 'None. A balanced realm.',
    unit: 'lancer', building: 'cathedral', heroClass: 'paladin',
    colors: ['#c8902e', '#2f4d7a'], sigil: 'sun',
  },
  sylvari: {
    id: 'sylvari', name: 'Sylvari', people: 'Elves', playable: true,
    passive: 'Forest-kin: woodcutters also bring home food (1 for every 2 wood), and felled trees regrow after 3 nights. Unique: Thornwardens (longbows) and the Heart Tree (healing).',
    drawback: 'Stone costs 25% more.',
    unit: 'thornwarden', building: 'hearttree', heroClass: 'ranger',
    colors: ['#5f9a4a', '#2c4a3a'], sigil: 'antler',
  },
  deepforge: {
    id: 'deepforge', name: 'Deepforge', people: 'Dwarves', playable: true,
    passive: 'Deep veins: quarries yield double stone. Unique: Ironshields (shield wall) and the Runeforge (stronger towers).',
    drawback: 'Builders work 20% slower.',
    unit: 'ironshield', building: 'runeforge', heroClass: 'runesmith',
    colors: ['#9aa0a8', '#5a3a24'], sigil: 'tower',
  },
  emberkin: {
    id: 'emberkin', name: 'Emberkin', people: 'Orcs', playable: true,
    passive: 'Blood and plunder: every kill pays gold (1, 3 for armored foes, 25 for a boss). Unique: Berserkers (frenzy) and the War Drum (night fury).',
    drawback: 'Houses hold 1 fewer villager.',
    unit: 'berserker', building: 'wardrum', heroClass: 'warlord',
    colors: ['#b8503e', '#3a2a24'], sigil: 'flame',
  },
};
export const PLAYABLE_FACTIONS = Object.values(FACTIONS).filter((f) => f.playable).map((f) => f.id);
/** Factions open on a first run, before any Citadel unlock. */
export const OPEN_FACTIONS = Object.values(FACTIONS).filter((f) => f.open).map((f) => f.id);
