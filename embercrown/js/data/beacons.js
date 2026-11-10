// Beacon bonuses: run-long boons. Lighting a region's Beacon offers 1 of 3.
// `mods` are added to s.mods at the start of every later region (same rules as
// relics: lightMult multiplies, every other key adds). `start` is a one-shot
// bonus granted at the start of every later region. `stackable` bonuses may be
// offered and taken more than once; all others leave the pool once chosen.

export const BEACONS = {
  fertile: {
    id: 'fertile', name: 'Fertile Fields', icon: 'farm', stackable: true,
    text: 'Farms grow 10% more food in every region.',
    mods: { farmYield: 0.1 },
  },
  settlers: {
    id: 'settlers', name: 'Hopeful Settlers', icon: 'pop', stackable: true,
    text: 'Start each region with 1 extra villager.',
    start: { villagers: 1 },
  },
  spires: {
    id: 'spires', name: 'High Spires', icon: 'tower',
    text: 'Watchtowers and Ballistae gain +1 range.',
    mods: { towerRange: 1 },
  },
  hearthward: {
    id: 'hearthward', name: 'Hearthward', icon: 'shield',
    text: 'The Hearth has 25% more health.',
    mods: { hearthHp: 0.25 },
  },
  ramparts: {
    id: 'ramparts', name: 'Stout Ramparts', icon: 'wall',
    text: 'Walls and Gates have 25% more health.',
    mods: { wallHp: 0.25 },
  },
  drillyard: {
    id: 'drillyard', name: 'Drill Yard', icon: 'sword', stackable: true,
    text: 'Soldiers deal 10% more damage.',
    mods: { soldierDmg: 0.1 },
  },
  guild: {
    id: 'guild', name: 'Builders Guild', icon: 'hammer',
    text: 'Builders work 15% faster.',
    mods: { buildSpeed: 0.15 },
  },
  tithe: {
    id: 'tithe', name: 'Dawn Tithe', icon: 'gold', stackable: true,
    text: 'Gain +15 gold every dawn.',
    mods: { dawnGold: 15 },
  },
  frugal: {
    id: 'frugal', name: 'Frugal Larders', icon: 'food',
    text: 'Villagers and soldiers eat 15% less food.',
    mods: { upkeep: -0.15 },
  },
  novafocus: {
    id: 'novafocus', name: 'Kindled Will', icon: 'nova',
    text: 'Heartflame Nova recharges 5 s faster.',
    mods: { novaCd: 5 },
  },
  stockpile: {
    id: 'stockpile', name: 'Supply Caravan', icon: 'wood', stackable: true,
    text: 'Start each region with +50 wood and +25 stone.',
    start: { wood: 50, stone: 25 },
  },
  woodsmen: {
    id: 'woodsmen', name: 'Sure Axes', icon: 'axe',
    text: 'Woodcutters and masons gather 15% faster.',
    mods: { chopSpeed: 0.15 },
  },
  archery: {
    id: 'archery', name: 'Fletchers Row', icon: 'tower',
    text: 'All arrows deal 10% more damage.',
    mods: { rangedDmg: 0.1 },
  },
  royalguard: {
    id: 'royalguard', name: 'Royal Vigil', icon: 'crown',
    text: 'The Sovereign deals 20% more damage.',
    mods: { sovDmg: 0.2 },
  },
  markets: {
    id: 'markets', name: 'Busy Markets', icon: 'house',
    text: 'House taxes and Market income +15%.',
    mods: { goldMult: 0.15 },
  },
  brightway: {
    id: 'brightway', name: 'Bright Way', icon: 'brazier',
    text: 'Braziers light +1 tile farther.',
    mods: { lightRadius: 1 },
  },
};
