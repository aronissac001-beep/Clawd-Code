// Factions. Ids and the links below (unit, building, heroClass) are fixed;
// js/game/systems/factions.js implements the passives and drawbacks.
// Four are playable from the start; Mirefolk and the Pale Court unlock later (Phase 4).
export const FACTIONS = {
  dawnhold: {
    id: 'dawnhold', name: 'Dawnhold', people: 'Humans', playable: true,
    passive: 'Royal architects: +1 option in every blueprint draft. Unique: Dawn Lancers (charging cavalry) and the Cathedral of Dawn (morale and healing).',
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
    passive: 'Deep veins: quarries yield double stone; food upkeep in winter is 30% lower. Unique: Ironshields (shield wall) and the Runeforge (stronger towers).',
    drawback: 'Builders work 20% slower; land with more than 6 trees must be cleared before it can be claimed.',
    unit: 'ironshield', building: 'runeforge', heroClass: 'runesmith',
    colors: ['#9aa0a8', '#5a3a24'], sigil: 'tower',
  },
  emberkin: {
    id: 'emberkin', name: 'Emberkin', people: 'Orcs', playable: true,
    passive: 'Blood and plunder: every kill pays gold (1, 3 for armored foes, 25 for a boss); raided lairs give double loot. Unique: Berserkers (frenzy) and the War Drum (night fury).',
    drawback: 'Morale falls 50% faster; one fewer villager at the start of each region.',
    unit: 'berserker', building: 'wardrum', heroClass: 'warlord',
    colors: ['#b8503e', '#3a2a24'], sigil: 'flame',
  },
  // Unlocked in the Ember Citadel (u_mirefolk, u_palecourt): playable stays false here and
  // BUS.factionUnlocked (or Sandbox mode) opens them on the New Realm screen.
  mirefolk: {
    id: 'mirefolk', name: 'Mirefolk', people: 'Swamp-dwellers', playable: false,
    passive: 'Build on the shallows: any building may stand in the River where it touches the bank. Every hit from your fighters and defences poisons the Hollow (3 damage a second for 4 s). Unique: Hexcasters (cursing marsh-witches) and the Bog Shrine (slows the Hollow).',
    drawback: 'Weak in winter: soldiers, heroes and the Sovereign deal 25% less damage and all work is 15% slower.',
    unit: 'hexcaster', building: 'bogshrine', heroClass: 'beastmaster',
    colors: ['#7fae5a', '#24382c'], sigil: 'lotus',
  },
  palecourt: {
    id: 'palecourt', name: 'Pale Court', people: 'Undead', playable: false,
    passive: 'The dead need no food: villagers, soldiers and heroes eat nothing. Every Hollow slain yields a Soul; each villager spends 1 Soul every 4 minutes and a newcomer costs 3. Unique: the Bone Legion (cheap swarm infantry) and the Ossuary (stores Souls, raises Bone Legionaries).',
    drawback: 'No Morale: it stays at 50 whatever happens, so no festivals or volunteers. Dread rises 50% faster. Out of Souls, a villager fades away every 40 s.',
    unit: 'bonelegion', building: 'ossuary', heroClass: 'cleric',
    colors: ['#d8d0c0', '#2e2a3c'], sigil: 'skull',
  },
};
export const PLAYABLE_FACTIONS = Object.values(FACTIONS).filter((f) => f.playable).map((f) => f.id);
