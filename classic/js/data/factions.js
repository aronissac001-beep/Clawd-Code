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
