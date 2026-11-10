// Building definitions. Each level lists its full stats; level 0 is the base
// building. `cost` on level N is the price to reach that level. `work` is how
// many builder-seconds construction or the upgrade takes.

export const BUILDINGS = {
  hearth: {
    id: 'hearth', name: 'Hearth', cat: null, size: 3, solid: true,
    desc: 'The Heartflame burns here. If it falls, the realm is lost. Shelters villagers and hurls ember bolts at the Hollow.',
    levels: [
      { hp: 1500, pop: 6, light: 6, sight: 8, shelter: 99, attack: { range: 5, dmg: 8, rate: 1.1, type: 'fire' } },
      { cost: { stone: 60, gold: 40 }, work: 30, hp: 2300, pop: 8, light: 7, sight: 9, shelter: 99, attack: { range: 5.5, dmg: 12, rate: 0.95, type: 'fire' } },
    ],
  },
  house: {
    id: 'house', name: 'House', cat: 'economy', size: 1, solid: true,
    desc: 'Home for villagers. Raises the population cap and pays a little gold in taxes.',
    levels: [
      { cost: { wood: 30 }, work: 8, hp: 160, pop: 3, gold: 6, shelter: 4, light: 1.4, sight: 2 },
      { cost: { wood: 25, stone: 15 }, work: 10, hp: 240, pop: 4, gold: 9, shelter: 5, light: 1.6, sight: 2 },
      { cost: { wood: 30, stone: 30, gold: 20 }, work: 14, hp: 340, pop: 5, gold: 13, shelter: 6, light: 1.8, sight: 2 },
    ],
  },
  farm: {
    id: 'farm', name: 'Farm', cat: 'economy', size: 2, solid: true,
    desc: 'Farmers tend the fields by day. Each farmer grows about 12 food a minute.',
    levels: [
      { cost: { wood: 25 }, work: 8, hp: 150, workers: 1, yieldMult: 1, sight: 2 },
      { cost: { wood: 25, gold: 10 }, work: 10, hp: 200, workers: 2, yieldMult: 1.1, sight: 2 },
      { cost: { wood: 30, stone: 20, gold: 20 }, work: 14, hp: 260, workers: 3, yieldMult: 1.25, sight: 2 },
    ],
  },
  lumber: {
    id: 'lumber', name: 'Lumber Camp', cat: 'economy', size: 2, solid: true, needs: 'tree',
    desc: 'Woodcutters fell nearby trees and haul logs back. Place it near a forest.',
    levels: [
      { cost: { wood: 20 }, work: 7, hp: 150, workers: 2, radius: 6, sight: 3 },
      { cost: { wood: 20, stone: 10 }, work: 9, hp: 200, workers: 3, radius: 7, sight: 3 },
      { cost: { wood: 25, stone: 20, gold: 15 }, work: 12, hp: 260, workers: 4, radius: 8, sight: 3 },
    ],
  },
  quarry: {
    id: 'quarry', name: 'Quarry', cat: 'economy', size: 2, solid: true, needs: 'rock',
    desc: 'Masons cut stone from boulders in range. Place it near grey rock.',
    levels: [
      { cost: { wood: 30 }, work: 9, hp: 180, workers: 2, radius: 5, sight: 3 },
      { cost: { wood: 20, stone: 15 }, work: 11, hp: 240, workers: 3, radius: 6, sight: 3 },
      { cost: { wood: 30, stone: 25, gold: 15 }, work: 14, hp: 320, workers: 4, radius: 7, sight: 3 },
    ],
  },
  wall: {
    id: 'wall', name: 'Wall', cat: 'defense', size: 1, solid: true, line: true, isWall: true,
    desc: 'Blocks the Hollow. Draw a line by dragging the round handle. Shades slip through walls that stand in darkness.',
    levels: [
      { cost: { wood: 5 }, work: 2, hp: 220 },
      { cost: { stone: 6 }, work: 3, hp: 480 },
      { cost: { stone: 10, gold: 2 }, work: 4, hp: 820 },
    ],
  },
  gate: {
    id: 'gate', name: 'Gate', cat: 'defense', size: 1, solid: true, isWall: true, isGate: true,
    desc: 'A wall your own people can walk through. The Hollow must break it.',
    levels: [
      { cost: { wood: 12 }, work: 4, hp: 260 },
      { cost: { stone: 10 }, work: 5, hp: 520 },
      { cost: { stone: 16, gold: 4 }, work: 6, hp: 880 },
    ],
  },
  tower: {
    id: 'tower', name: 'Watchtower', cat: 'defense', size: 1, solid: true,
    desc: 'An archer post that fires on its own. Arrows shred Husks but glance off Hollow Knights.',
    levels: [
      { cost: { wood: 30, stone: 15 }, work: 10, hp: 240, sight: 7, light: 2.2, attack: { range: 5.5, dmg: 8, rate: 1.0, type: 'pierce', shots: 1 } },
      { cost: { wood: 20, stone: 30 }, work: 12, hp: 340, sight: 8, light: 2.4, attack: { range: 6.5, dmg: 11, rate: 0.9, type: 'pierce', shots: 1 } },
      { cost: { stone: 40, gold: 30 }, work: 15, hp: 460, sight: 9, light: 2.6, attack: { range: 7, dmg: 12, rate: 0.85, type: 'pierce', shots: 2 } },
    ],
  },
  brazier: {
    id: 'brazier', name: 'Brazier', cat: 'defense', size: 1, solid: true,
    desc: 'Lights the night. The Hollow takes 25% more damage in light, and Shades cannot phase through lit walls.',
    levels: [
      { cost: { wood: 15, stone: 5 }, work: 4, hp: 120, light: 4, sight: 3 },
      { cost: { wood: 15, stone: 15 }, work: 6, hp: 180, light: 5.5, sight: 4 },
      { cost: { stone: 25, gold: 20 }, work: 8, hp: 240, light: 7, sight: 5, burn: { radius: 2.2, dps: 4 } },
    ],
  },
  barracks: {
    id: 'barracks', name: 'Barracks', cat: 'military', size: 2, solid: true,
    desc: 'Trains a squad of soldiers. Tap it to recruit Militia, Spearmen or Archers.',
    levels: [
      { cost: { wood: 50, stone: 20 }, work: 14, hp: 360, squadCap: 6, sight: 3, light: 1.6 },
      { cost: { wood: 30, stone: 40, gold: 30 }, work: 16, hp: 520, squadCap: 8, sight: 4, light: 1.8, trainSpeed: 1.4 },
    ],
  },
};

export const BUILD_ORDER = {
  economy: ['house', 'farm', 'lumber', 'quarry'],
  defense: ['wall', 'gate', 'tower', 'brazier'],
  military: ['barracks'],
};

export const CATEGORIES = [
  { id: 'economy', name: 'Economy', icon: 'farm' },
  { id: 'defense', name: 'Defense', icon: 'tower' },
  { id: 'military', name: 'Military', icon: 'sword' },
];

/** Units a built building can train: def.trains, plus the faction unit at a Barracks. */
export function trainsAt(type, faction, factionUnit) {
  const def = BUILDINGS[type];
  if (!def) return [];
  if (type === 'barracks') return ['militia', 'spearman', 'archer', ...(factionUnit ? [factionUnit] : [])];
  return def.trains || [];
}

export function levelStats(type, level) {
  const def = BUILDINGS[type];
  return def.levels[Math.min(level, def.levels.length - 1)];
}
