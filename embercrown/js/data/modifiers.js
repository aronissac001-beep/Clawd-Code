// Region modifiers (Phase 3): lasting quirks of a region, rolled onto Realm Map nodes
// when an act's map is made and shown on the map panel before the player travels.
//   mods   additive DEFAULT_MODS keys (lightMult multiplies), folded into params.mods
//   start  one-shot region start bonuses (params.start keys: food, wood, stone, gold, caches ...)
//   flags  plain markers other systems read from s.ext.modifiers (seasons.js reads
//          'endless_winter' by id)
//   tone   'good' | 'bad' | 'mixed'  (cursed nodes favour 'bad')
//   excludes  ids that cannot share a node with this one
// Behaviour beyond mods/start lives in js/game/systems/director.js, keyed by id.

export const MODIFIERS = {
  ley_surge: {
    id: 'ley_surge', name: 'Ley Line Surge', icon: 'nova', tone: 'mixed', weight: 3,
    text: 'Raw magic runs under the soil. Mage Spires deal 50% more damage, but more Shades walk the nights.',
    short: 'Mage Spires +50% damage, more Shades',
  },
  haunted_woods: {
    id: 'haunted_woods', name: 'Haunted Woods', icon: 'skull', tone: 'bad', weight: 3,
    text: 'The trees whisper names. Shades walk from the first night, and Dread rises at every dusk.',
    short: 'Shades from night 1, Dread rises at dusk',
  },
  endless_winter: {
    id: 'endless_winter', name: 'Endless Winter', icon: 'moon', tone: 'bad', weight: 2, flags: ['endless_winter'],
    text: 'Frost that never thaws. The season is always winter here.', short: 'It is always winter',
    excludes: ['fertile_floodplain'],
  },
  gold_rush: {
    id: 'gold_rush', name: 'Gold Rush', icon: 'gold', tone: 'good', weight: 3,
    mods: { goldMult: 0.5 }, start: { gold: 30, caches: 3 },
    text: 'Nuggets glint in every stream. Taxes and markets pay 50% more, you start with 30 extra gold, and 3 more caches lie hidden.',
    short: 'Gold +50%, +30 gold, 3 extra caches',
  },
  dragon_shadow: {
    id: 'dragon_shadow', name: "Dragon's Shadow", icon: 'wyrm', tone: 'bad', weight: 2,
    text: 'A wyvern circles high above. Every day at noon its shadow passes over one building (announced at dawn) and scorches it for 15% of its health.',
    short: 'A wyvern scorches one building each day',
  },
  fertile_floodplain: {
    id: 'fertile_floodplain', name: 'Fertile Floodplain', icon: 'farm', tone: 'good', weight: 3,
    mods: { farmYield: 0.3 }, text: 'Black river silt. Farms yield 30% more food.', short: 'Farms +30%',
    excludes: ['blighted_soil', 'endless_winter'],
  },
  blighted_soil: {
    id: 'blighted_soil', name: 'Blighted Soil', icon: 'skull', tone: 'bad', weight: 3,
    mods: { farmYield: -0.3 }, text: 'Grey roots in grey earth. Farms yield 30% less food.', short: 'Farms -30%',
    excludes: ['fertile_floodplain'],
  },
  twin_moons: {
    id: 'twin_moons', name: 'Twin Moons', icon: 'moon', tone: 'mixed', weight: 2,
    text: 'Two moons rise here. Every 3rd night is a Blood Moon, and each Blood Moon dawn pays double gold.',
    short: 'Blood Moon every 3rd night, double loot',
  },
  fog_of_ages: {
    id: 'fog_of_ages', name: 'Fog of Ages', icon: 'eye', tone: 'bad', weight: 3,
    text: 'An old mist clings to the land. All sight is halved: the fog of war lifts slowly.',
    short: 'Sight halved',
  },
  ancient_battlefield: {
    id: 'ancient_battlefield', name: 'Ancient Battlefield', icon: 'sword', tone: 'mixed', weight: 2,
    start: { caches: 2 },
    text: 'Old armies sleep under the turf. Every cache holds 40 extra war-gold and 2 more caches lie hidden, but Husks claw out of the old battlefield every night (shown at dusk).',
    short: 'Caches +40 gold (2 extra), Husks rise at dusk',
  },
  restless_earth: {
    id: 'restless_earth', name: 'Restless Earth', icon: 'quarry', tone: 'mixed', weight: 2,
    text: 'The ground grumbles. Masons bring home 40% more stone, but a tremor at each dusk cracks walls and gates for 10% of their health.',
    short: 'Stone +40%, dusk tremors crack walls',
  },
  bountiful_woods: {
    id: 'bountiful_woods', name: 'Bountiful Woods', icon: 'wood', tone: 'good', weight: 3,
    text: 'Ancient, generous trees. Every tree holds 50% more wood.', short: 'Trees hold +50% wood',
  },
  iron_veins: {
    id: 'iron_veins', name: 'Iron Veins', icon: 'stone', tone: 'good', weight: 2,
    mods: { wallHp: 0.15 }, text: 'Rich rock. Every boulder holds 50% more stone, and walls are 15% sturdier.',
    short: 'Rocks +50% stone, walls +15% health',
  },
  starfall: {
    id: 'starfall', name: 'Starfall Plain', icon: 'flame', tone: 'mixed', weight: 2,
    mods: { enemyHp: 0.1, lootMult: 0.3 },
    text: 'Fallen stars harden the Hollow (10% more health) but enrich the land: gold and Ember rewards +30%.',
    short: 'Hollow +10% health, loot +30%',
  },
};

export const MODIFIER_LIST = Object.values(MODIFIERS);

/** Can modifier id join a node that already carries `ids`? */
export function modifierFits(id, ids) {
  const m = MODIFIERS[id];
  if (!m || ids.includes(id)) return false;
  for (const o of ids) {
    if ((m.excludes || []).includes(o)) return false;
    if (((MODIFIERS[o] && MODIFIERS[o].excludes) || []).includes(id)) return false;
  }
  return true;
}

/** Map-panel line: 'Twin Moons: Blood Moon every 3rd night, double loot'. */
export function modifierLine(id) {
  const m = MODIFIERS[id];
  return m ? `${m.name}: ${m.short}` : '';
}
