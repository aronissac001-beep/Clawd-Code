// Draftable buildings added in Phase 2. Same schema as BUILDINGS; content.js
// merges them in at boot and js/game/systems/structures.js runs their logic.
// `selfFire: true` marks towers whose shots structures.js handles itself.

export const EXTRA_BUILDINGS = {
  market: {
    id: 'market', name: 'Market', cat: 'economy', size: 2, solid: true, draftable: true,
    desc: 'Traders set up stalls and pay gold every minute, more for every House nearby.',
    levels: [
      { cost: { wood: 45, stone: 15 }, work: 12, hp: 220, goldBase: 4, goldPerHouse: 2, radius: 5, sight: 3, light: 1.4 },
      { cost: { wood: 30, stone: 25, gold: 20 }, work: 14, hp: 300, goldBase: 6, goldPerHouse: 3, radius: 6, sight: 3, light: 1.6 },
      { cost: { wood: 30, stone: 40, gold: 40 }, work: 18, hp: 400, goldBase: 9, goldPerHouse: 4, radius: 7, sight: 4, light: 1.8 },
    ],
  },
  granary: {
    id: 'granary', name: 'Granary', cat: 'economy', size: 2, solid: true, draftable: true,
    desc: 'Stores the harvest. Farms in range grow more food, and the realm eats less.',
    levels: [
      { cost: { wood: 40, stone: 15 }, work: 12, hp: 240, radius: 5, farmBonus: 0.15, upkeepCut: 0.1, sight: 3 },
      { cost: { wood: 30, stone: 25, gold: 15 }, work: 14, hp: 320, radius: 6, farmBonus: 0.25, upkeepCut: 0.15, sight: 3 },
      { cost: { wood: 30, stone: 40, gold: 30 }, work: 18, hp: 420, radius: 7, farmBonus: 0.35, upkeepCut: 0.2, sight: 4 },
    ],
  },
  trap: {
    id: 'trap', name: 'Spike Trap', cat: 'defense', size: 1, solid: false, walkable: true, draftable: true,
    desc: 'Iron spikes in a low frame. Everyone walks over it; the Hollow is cut and slowed. It wears down and needs repair.',
    levels: [
      { cost: { wood: 15, stone: 5 }, work: 3, hp: 140, dps: 10, slow: 0.4, wear: 4 },
      { cost: { wood: 10, stone: 12 }, work: 4, hp: 220, dps: 14, slow: 0.5, wear: 4 },
      { cost: { stone: 18, gold: 10 }, work: 5, hp: 320, dps: 20, slow: 0.55, wear: 3 },
    ],
  },
  ballista: {
    id: 'ballista', name: 'Ballista', cat: 'defense', size: 1, solid: true, draftable: true, selfFire: true,
    desc: 'A great crossbow on a stone plinth. Slow, long-ranged bolts that punch through Hollow Knight plate.',
    levels: [
      { cost: { wood: 40, stone: 25 }, work: 12, hp: 260, sight: 8, light: 1.6, attack: { range: 8, dmg: 30, rate: 2.6, type: 'pierce', bonus: { armored: 3 } } },
      { cost: { wood: 25, stone: 35, gold: 15 }, work: 14, hp: 360, sight: 9, light: 1.8, attack: { range: 8.5, dmg: 42, rate: 2.4, type: 'pierce', bonus: { armored: 3 } } },
      { cost: { stone: 45, gold: 35 }, work: 16, hp: 480, sight: 10, light: 2, attack: { range: 9, dmg: 56, rate: 2.2, type: 'pierce', bonus: { armored: 3 } } },
    ],
  },
  spire: {
    id: 'spire', name: 'Mage Spire', cat: 'defense', size: 1, solid: true, draftable: true, selfFire: true,
    desc: 'A slender spire of teal glass. Its arcane bolts leap from foe to foe, and burn through armour and spirits alike.',
    levels: [
      { cost: { wood: 25, stone: 30, gold: 20 }, work: 12, hp: 200, sight: 7, light: 1.8, attack: { range: 5.5, dmg: 10, rate: 1.4, type: 'magic', chain: 2, chainRange: 2.2 } },
      { cost: { stone: 35, gold: 25 }, work: 14, hp: 280, sight: 8, light: 2, attack: { range: 6, dmg: 13, rate: 1.3, type: 'magic', chain: 2, chainRange: 2.5 } },
      { cost: { stone: 45, gold: 40 }, work: 16, hp: 380, sight: 9, light: 2.2, attack: { range: 6.5, dmg: 16, rate: 1.2, type: 'magic', chain: 3, chainRange: 2.8 } },
    ],
  },
};
