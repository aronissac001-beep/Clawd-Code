// Factions. Ids and the links below (unit, building, heroClass) are fixed;
// js/game/systems/factions.js implements the passives and drawbacks.
// Four are playable from the start; Mirefolk and the Pale Court unlock later (Phase 4).
export const FACTIONS = {
  dawnhold: {
    id: 'dawnhold', name: 'Dawnhold', people: 'Humans', playable: true,
    passive: 'Royal architects: +1 option in every blueprint draft.',
    drawback: 'None. A balanced realm.',
    unit: 'lancer', building: 'cathedral', heroClass: 'paladin',
    colors: ['#c8902e', '#2f4d7a'], sigil: 'sun',
  },
  sylvari: {
    id: 'sylvari', name: 'Sylvari', people: 'Elves', playable: true,
    passive: 'Forest-kin: woodcutters also gather food, and felled trees regrow.',
    drawback: 'Stone costs 25% more.',
    unit: 'thornwarden', building: 'hearttree', heroClass: 'ranger',
    colors: ['#5f9a4a', '#2c4a3a'], sigil: 'antler',
  },
  deepforge: {
    id: 'deepforge', name: 'Deepforge', people: 'Dwarves', playable: true,
    passive: 'Deep veins: quarries yield double; winter upkeep -30%.',
    drawback: 'Build 20% slower; forested land must be cleared before it can be claimed.',
    unit: 'ironshield', building: 'runeforge', heroClass: 'runesmith',
    colors: ['#9aa0a8', '#5a3a24'], sigil: 'tower',
  },
  emberkin: {
    id: 'emberkin', name: 'Emberkin', people: 'Orcs', playable: true,
    passive: 'Blood and plunder: every kill pays gold; raided lairs give double loot.',
    drawback: 'Morale falls faster; one fewer villager at the start of each region.',
    unit: 'berserker', building: 'wardrum', heroClass: 'warlord',
    colors: ['#b8503e', '#3a2a24'], sigil: 'flame',
  },
  mirefolk: {
    id: 'mirefolk', name: 'Mirefolk', people: 'Swamp-dwellers', playable: false,
    passive: 'Build on swamp; attacks poison.', drawback: 'Weak in winter.',
    unit: null, building: null, heroClass: 'beastmaster', colors: ['#5a7a4a', '#2a3a2a'], sigil: 'key',
  },
  palecourt: {
    id: 'palecourt', name: 'Pale Court', people: 'Undead', playable: false,
    passive: 'Villagers need no food, but need Souls from kills.', drawback: 'No Morale; Dread rises faster.',
    unit: null, building: null, heroClass: 'cleric', colors: ['#cfc6b8', '#3a3448'], sigil: 'crown',
  },
};
export const PLAYABLE_FACTIONS = Object.values(FACTIONS).filter((f) => f.playable).map((f) => f.id);
