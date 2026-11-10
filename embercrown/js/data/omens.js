// Omens of Ruin: optional hardships for a run, open after the first victory
// (meta.wins >= 1). Any number may be taken together; each adds Ruin, and every
// point of Ruin raises the Embers banked at the end of the run by RUIN_EMBER_STEP.
// Effect fields (applied by js/game/meta/citadel.js):
//   mods          added to every region's modifiers (DEFAULT_MODS keys)
//   nightMult     night length multiplier
//   enemyGuard    fraction: the Hollow take this much less damage
//   sovMaxHp      fraction: Sovereign max health (negative)
//   sightMult     sight and fog-reveal radius multiplier
//   farmMult      farm food multiplier
//   stoneGather   multiplier on the stone masons bring home
//   winterUpkeep  food upkeep multiplier in winter
//   bloodEvery    an extra Blood Moon on every Nth night (not in boss regions)
//   extraBand     an extra Hollow band each night, this fraction of the smallest band
//   startGold     the run's starting gold is set to this
//   shopMult      merchant price multiplier (needs the shop integration; hidden until present)
export const RUIN_EMBER_STEP = 0.15;

export const OMENS = {
  longer_nights: {
    id: 'longer_nights', name: 'Longer Nights', ruin: 1, icon: 'moon',
    text: 'Nights last 25% longer.', nightMult: 1.25,
  },
  hungry_winters: {
    id: 'hungry_winters', name: 'Hungry Winters', ruin: 1, icon: 'food',
    text: 'In winter your people eat 50% more food.', winterUpkeep: 1.5,
  },
  thicker_fog: {
    id: 'thicker_fog', name: 'Thicker Fog', ruin: 1, icon: 'eye',
    text: 'Your people see 25% less far through the fog.', sightMult: 0.75,
  },
  scarce_stone: {
    id: 'scarce_stone', name: 'Scarce Stone', ruin: 1, icon: 'stone',
    text: 'Quarries bring home 30% less stone.', stoneGather: 0.7,
  },
  frail_walls: {
    id: 'frail_walls', name: 'Frail Walls', ruin: 1, icon: 'wall',
    text: 'Walls and Gates have 25% less health.', mods: { wallHp: -0.25 },
  },
  weary_builders: {
    id: 'weary_builders', name: 'Weary Builders', ruin: 1, icon: 'hammer',
    text: 'Builders work 15% slower.', mods: { buildSpeed: -0.15 },
  },
  empty_coffers: {
    id: 'empty_coffers', name: 'Empty Coffers', ruin: 1, icon: 'gold',
    text: 'Begin the run with no gold, and House taxes and Market income are 20% lower.', startGold: 0, mods: { goldMult: -0.2 },
  },
  greedy_merchants: {
    id: 'greedy_merchants', name: 'Greedy Merchants', ruin: 1, icon: 'merchant',
    text: 'Merchant Caravan prices are 30% higher.', shopMult: 1.3,
  },
  armored_hollow: {
    id: 'armored_hollow', name: 'Armored Hollow', ruin: 2, icon: 'shield',
    text: 'The Hollow take 15% less damage.', enemyGuard: 0.15,
  },
  no_second_chances: {
    id: 'no_second_chances', name: 'No Second Chances', ruin: 2, icon: 'crown',
    text: 'The Ember-Sovereign has 30% less max health.', sovMaxHp: -0.3,
  },
  faster_hollowing: {
    id: 'faster_hollowing', name: 'Faster Hollowing', ruin: 2, icon: 'skull',
    text: 'Every wave is 20% larger.', mods: { waveMult: 0.2 },
  },
  lean_harvests: {
    id: 'lean_harvests', name: 'Lean Harvests', ruin: 2, icon: 'farm',
    text: 'Farms grow 20% less food.', farmMult: 0.8,
  },
  swift_hollow: {
    id: 'swift_hollow', name: 'Swift Hollow', ruin: 2, icon: 'fast',
    text: 'The Hollow move 15% faster.', mods: { enemySpeed: 0.15 },
  },
  hollow_fury: {
    id: 'hollow_fury', name: 'Hollow Fury', ruin: 2, icon: 'sword',
    text: 'The Hollow deal 20% more damage.', mods: { enemyDmg: 0.2 },
  },
  restless_dead: {
    id: 'restless_dead', name: 'Restless Dead', ruin: 3, icon: 'moon',
    text: 'A Blood Moon also rises on every 4th night (not in boss regions).', bloodEvery: 4,
  },
  hollow_tide: {
    id: 'hollow_tide', name: 'Hollow Tide', ruin: 3, icon: 'omen',
    text: 'Each night one extra Hollow band attacks from an unused side: half the size of the smallest band (at least 2).', extraBand: 0.5,
  },
};
export const OMEN_LIST = Object.values(OMENS).sort((a, b) => a.ruin - b.ruin);
