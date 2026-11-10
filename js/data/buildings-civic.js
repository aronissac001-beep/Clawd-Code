// Phase 4 civic buildings: three economy buildings (Windmill, Fisher's Hut, Mine),
// four civic buildings (Temple, Library, Alchemist, Ley Obelisk) and three Wonders.
// Same schema as js/data/buildings.js; js/game/systems/civic.js merges them in and
// runs their logic. Content tagged `unlock` stays locked until the Citadel upgrade
// of that id is bought (u_artisans, u_faith, u_wonders).
//
// Level keys read by civic.js (all optional):
//   farmBoost      Windmill: +fraction food for Farms whose centre is within `radius`
//   perTile, cap   Fisher's Hut: food a minute per river tile within `radius`, up to `cap`
//   goldShare      Mine: gold for every stone a miner brings home (before multipliers)
//   stoneMult      Mine: share of the stone a Quarry would bring
//   morale         Temple: the level Morale settles toward rises by this while it stands
//   heal           Temple / Alchemist: health a second for friends within `radius`
//   dawnDread      Temple: Dread eased at every dawn
//   draftExtra     Library: +options in blueprint drafts and Dawn Offerings (once, however many)
//   heroXp         Library: +fraction experience for every hero in the region
//   brew           Alchemist: { every, wood, gold, min } turns wood into gold
//   magic          Ley Obelisk: +fraction magic damage to Hollow within `radius`
//   glow           Ley Obelisk / Sunspire: radius of lit ground (counts as light in combat)
// Wonders (wonder: true) carry their run-long blessing in WONDER_INFO below.

export const CIVIC_TUNE = {
  riverTerrain: 4,
  wonderArmor: 0.1,        // World Forge: damage taken as if armor were this much higher
  wonderArmorL2: 0.15,     // ... while a level-2 World Forge stands in this region
  sunNight: 0.7,           // Sunspire: night length multiplier for the rest of the run
  sunNightL2: 0.6,         // ... while a level-2 Sunspire stands in this region
  moonDawn: { morale: 8, dread: 8, gold: 50 }, // Moonwell: blessings at a Blood Moon's dawn
  moonL2: { morale: 2, dread: 2 },             // Moonwell level 2: every dawn while it stands
  wonderMorale: 10,        // Morale when a Wonder is completed
  armorCap: 0.85,          // never more than this much armor in total
  healEvery: 10,           // ticks between healing pulses
};

export const CIVIC_BUILDINGS = {
  // ---- Economy -------------------------------------------------------------------------------
  windmill: {
    id: 'windmill', name: 'Windmill', cat: 'economy', size: 2, solid: true, draftable: true,
    desc: 'Great sails grind the harvest. Farms in range grow more food (+20%, +30% at level 2, +40% at level 3). Several Windmills do not stack.',
    levels: [
      { cost: { wood: 40, stone: 15 }, work: 12, hp: 230, radius: 4, farmBoost: 0.2, sight: 3 },
      { cost: { wood: 30, stone: 25, gold: 15 }, work: 14, hp: 310, radius: 5, farmBoost: 0.3, sight: 3 },
      { cost: { wood: 30, stone: 35, gold: 30 }, work: 18, hp: 400, radius: 6, farmBoost: 0.4, sight: 4 },
    ],
  },
  fisher: {
    id: 'fisher', name: "Fisher's Hut", cat: 'economy', size: 2, solid: true, draftable: true,
    desc: 'Nets and a jetty on the riverbank. Must stand within 2 tiles of a river. Brings in food on its own, more for every river tile within reach (no villager needed, and the river never freezes).',
    levels: [
      { cost: { wood: 35 }, work: 9, hp: 170, radius: 3, perTile: 0.8, cap: 8, sight: 3 },
      { cost: { wood: 25, stone: 15 }, work: 11, hp: 230, radius: 3, perTile: 1.1, cap: 12, sight: 3 },
      { cost: { wood: 30, stone: 25, gold: 15 }, work: 14, hp: 300, radius: 3, perTile: 1.4, cap: 16, sight: 4 },
    ],
  },
  mine: {
    id: 'mine', name: 'Mine', cat: 'economy', size: 2, solid: true, needs: 'rock', draftable: true, unlock: 'u_artisans',
    desc: 'Miners dig into boulders in range like masons, bringing back 80% of the stone a Quarry would, but a vein of gold with every load (0.4 gold per stone, more at higher levels). Place it near grey rock.',
    levels: [
      { cost: { wood: 40, stone: 10 }, work: 12, hp: 220, workers: 2, radius: 5, stoneMult: 0.8, goldShare: 0.4, sight: 3 },
      { cost: { wood: 25, stone: 25, gold: 15 }, work: 14, hp: 300, workers: 3, radius: 6, stoneMult: 0.8, goldShare: 0.45, sight: 3 },
      { cost: { stone: 40, gold: 30 }, work: 16, hp: 400, workers: 4, radius: 7, stoneMult: 0.8, goldShare: 0.5, sight: 4 },
    ],
  },
  // ---- Civic ---------------------------------------------------------------------------------
  temple: {
    id: 'temple', name: 'Temple', cat: 'civic', size: 2, solid: true, draftable: true, unlock: 'u_faith',
    desc: 'A quiet house of the Heartflame. While it stands Morale settles higher, and soldiers and heroes nearby slowly heal. At level 2 its vigil also eases Dread at every dawn. Several Temples do not stack.',
    levels: [
      { cost: { wood: 50, stone: 35, gold: 20 }, work: 16, hp: 360, morale: 4, radius: 4.5, heal: 1, light: 1.8, sight: 4 },
      { cost: { stone: 45, gold: 35 }, work: 20, hp: 500, morale: 7, radius: 5, heal: 2, dawnDread: 3, light: 2.2, sight: 4 },
    ],
  },
  library: {
    id: 'library', name: 'Library', cat: 'civic', size: 2, solid: true, draftable: true, unlock: 'u_artisans',
    desc: 'Scholars copy old plans by lamplight. While it stands every blueprint draft and Dawn Offering shows one more option (several Libraries do not stack). At level 2 heroes in the region gain 25% more experience.',
    levels: [
      { cost: { wood: 50, stone: 30, gold: 25 }, work: 16, hp: 280, draftExtra: 1, light: 1.4, sight: 3 },
      { cost: { stone: 40, gold: 40 }, work: 18, hp: 380, draftExtra: 1, heroXp: 0.25, light: 1.8, sight: 4 },
    ],
  },
  alchemist: {
    id: 'alchemist', name: 'Alchemist', cat: 'civic', size: 2, solid: true, draftable: true, unlock: 'u_artisans',
    desc: 'Retorts bubble day and night. Every minute it turns 20 wood into 10 gold while you hold more than 60 wood. At level 2 it turns 30 wood into 16 gold and brews salves: the Sovereign and soldiers nearby heal 1 health a second.',
    levels: [
      { cost: { wood: 40, stone: 30, gold: 15 }, work: 14, hp: 240, brew: { every: 60, wood: 20, gold: 10, min: 60 }, light: 1.4, sight: 3 },
      { cost: { stone: 35, gold: 30 }, work: 16, hp: 320, brew: { every: 60, wood: 30, gold: 16, min: 60 }, radius: 5, heal: 1, light: 1.8, sight: 3 },
    ],
  },
  obelisk: {
    id: 'obelisk', name: 'Ley Obelisk', cat: 'civic', size: 1, solid: true, draftable: true, unlock: 'u_faith',
    desc: 'A standing stone humming on a ley line. Hollow within its reach take +25% magic damage (+35% at level 3) from Mage Spires, battlemages, hexcasters and magic heroes, and its glow lights the ground like a Brazier.',
    levels: [
      { cost: { stone: 35, gold: 20 }, work: 10, hp: 220, radius: 4, magic: 0.25, glow: 3, light: 3, sight: 4 },
      { cost: { stone: 30, gold: 30 }, work: 12, hp: 300, radius: 5, magic: 0.25, glow: 4, light: 4, sight: 5 },
      { cost: { stone: 40, gold: 45 }, work: 14, hp: 400, radius: 6, magic: 0.35, glow: 5, light: 5, sight: 6 },
    ],
  },
  // ---- Wonders (one per run) -----------------------------------------------------------------
  sunspire: {
    id: 'sunspire', name: 'Sunspire', cat: 'civic', size: 3, solid: true, draftable: true, wonder: true, unlock: 'u_wonders',
    desc: 'A Wonder: a needle of gold glass that drinks the noon. Once finished, every night for the rest of the run is 30% shorter, in every region. It lights the ground around it. One Wonder per run.',
    levels: [
      { cost: { wood: 320, stone: 260, gold: 160 }, work: 120, hp: 1400, glow: 6, light: 6, sight: 8 },
      { cost: { stone: 120, gold: 120 }, work: 60, hp: 1900, glow: 7.5, light: 7.5, sight: 9 },
    ],
  },
  worldforge: {
    id: 'worldforge', name: 'World Forge', cat: 'civic', size: 3, solid: true, draftable: true, wonder: true, unlock: 'u_wonders',
    desc: 'A Wonder: an anvil the size of a hall, beaten by a hundred hammers. Once finished, your soldiers, heroes and the Sovereign take damage as if they had +10% armor, for the rest of the run, in every region. One Wonder per run.',
    levels: [
      { cost: { wood: 300, stone: 300, gold: 150 }, work: 120, hp: 1600, light: 3, sight: 6 },
      { cost: { stone: 140, gold: 110 }, work: 60, hp: 2200, light: 3.6, sight: 7 },
    ],
  },
  moonwell: {
    id: 'moonwell', name: 'Moonwell', cat: 'civic', size: 3, solid: true, draftable: true, wonder: true, unlock: 'u_wonders',
    desc: 'A Wonder: a silver pool that holds the moon. Once finished, Blood Moons become blessings for the rest of the run: their waves are no longer doubled, and their dawn brings Morale, gold and healing. One Wonder per run.',
    levels: [
      { cost: { wood: 300, stone: 250, gold: 180 }, work: 120, hp: 1300, light: 3.5, sight: 7 },
      { cost: { stone: 110, gold: 130 }, work: 60, hp: 1800, light: 4.2, sight: 8 },
    ],
  },
};

/** Player-facing text for each Wonder's blessing (run-long) and its level-2 bonus (this region only). */
export const WONDER_INFO = {
  sunspire: {
    icon: 'sun', color: '#ffd45a',
    blessing: 'Nights are 30% shorter for the rest of the run.',
    crown: 'Nights are 40% shorter instead, while it stands in this region.',
  },
  worldforge: {
    icon: 'shield', color: '#ff9a50',
    blessing: 'Your soldiers, heroes and the Sovereign take damage as if they had +10% armor, for the rest of the run.',
    crown: '+15% armor instead, while it stands in this region.',
  },
  moonwell: {
    icon: 'moon', color: '#a8c8ff',
    blessing: 'Blood Moon waves are no longer doubled, and a Blood Moon dawn brings +8 Morale, -8 Dread, +50 gold and heals every fighter.',
    crown: 'Every dawn also brings +2 Morale and eases Dread by 2, while it stands in this region.',
  },
};

export const CIVIC_ORDER = {
  economy: ['windmill', 'fisher', 'mine'],
  civic: ['temple', 'library', 'alchemist', 'obelisk', 'sunspire', 'worldforge', 'moonwell'],
};
