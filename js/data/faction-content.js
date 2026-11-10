// Faction-unique units and buildings (Phase 3). Same schemas as UNITS
// (js/data/units.js) and BUILDINGS (js/data/buildings.js);
// js/game/systems/factions.js merges them in and runs their effects.
// Building defs carry `faction` (the only faction that may build them) and
// `unique: true`; every other field is the core schema.
//
// Counter loop kept intact: spears beat cavalry, so Lancers fear Gloom Hounds.

export const FACTION_UNITS = {
  // Dawnhold cavalry. First blow after a run of 3+ tiles is a lance charge (x2.5).
  lancer: {
    id: 'lancer', name: 'Dawn Lancer', role: 'Charging cavalry',
    desc: 'Knights of the sunrise on white chargers. After riding 3 tiles or more, the first blow is a lance charge for 2.5x damage. Rides down Husks and scatters Shades, but Gloom Hounds hamstring the horses.',
    strong: 'Husks, Shades', weak: 'Gloom Hounds',
    cost: { gold: 24, food: 12, wood: 6 }, train: 7,
    hp: 84, armor: 0.15, dmg: 9, dmgType: 'blade', rate: 1.1, range: 1.0, speed: 2.6, sight: 4,
    bonus: { infantry: 1.4, spirit: 1.5, beast: 0.8 }, ranged: false,
  },
  // Sylvari longbow. Outranges every tower in the Watch.
  thornwarden: {
    id: 'thornwarden', name: 'Thornwarden', role: 'Longbow sentinel',
    desc: 'Elven wardens with thornwood longbows. Slow, heavy arrows from 7 tiles away, long before the Hollow can close.',
    strong: 'Husks, anything far away', weak: 'Hollow Knights, Gloom Hounds up close',
    cost: { gold: 22, food: 10, wood: 14 }, train: 7,
    hp: 46, armor: 0.05, dmg: 11, dmgType: 'pierce', rate: 1.7, range: 7, speed: 1.5, sight: 7,
    bonus: {}, ranged: true,
  },
  // Deepforge shield wall. Allies within 1.5 tiles take 20% less damage.
  ironshield: {
    id: 'ironshield', name: 'Ironshield', role: 'Shield-wall guard',
    desc: 'A dwarf behind a tower shield of forged steel. Slow and hard to kill; soldiers fighting within 1.5 tiles of an Ironshield take 20% less damage. The hammer cracks Hollow plate.',
    strong: 'Hollow Knights, holding a gate', weak: 'Shades, anything it cannot catch',
    cost: { gold: 24, food: 12, stone: 10 }, train: 8,
    hp: 150, armor: 0.45, dmg: 6, dmgType: 'crush', rate: 1.25, range: 0.9, speed: 1.15, sight: 3.5,
    bonus: {}, ranged: false,
  },
  // Emberkin shock troops. Below half health they attack 40% faster.
  berserker: {
    id: 'berserker', name: 'Berserker', role: 'Frenzied axeman',
    desc: 'Emberkin raiders with twin bone-hafted axes and no armour to speak of. Huge damage, and below half health the blood-rage takes them: they strike much faster.',
    strong: 'Gloom Hounds, Husks', weak: 'Hollow Knights, being swarmed',
    cost: { gold: 20, food: 14 }, train: 6,
    hp: 70, armor: 0, dmg: 11, dmgType: 'blade', rate: 1.05, range: 0.9, speed: 1.75, sight: 3.5,
    bonus: { beast: 1.3 }, ranged: false,
  },
};

// Tuning shared by the systems (kept here so balance passes never touch logic).
export const FACTION_TUNING = {
  chargeTiles: 3,          // Lancer: tiles ridden before a charge is ready
  chargeMult: 2.5,         // Lancer: charge damage multiplier
  chargeForget: 2,         // Lancer: seconds standing still before the charge is lost
  beastVsLancer: 1.5,      // Lancer: Gloom Hounds (beast tag) deal this much more to Lancers
  frenzyAt: 0.5,           // Berserker: health fraction below which the frenzy starts
  frenzyCd: 0.6,           // Berserker: attack cooldown multiplier in frenzy
  shieldRadius: 1.5,       // Ironshield: guard radius in tiles
  shieldCut: 0.2,          // Ironshield: damage reduction for guarded allies
  sylvariFoodPerWood: 0.5, // Sylvari: food brought home per wood
  sylvariStone: 1.25,      // Sylvari: stone cost multiplier
  regrowNights: 3,         // Sylvari: dawns before a stump grows back
  quarryMult: 2,           // Deepforge: stone per quarry trip multiplier
  winterUpkeep: 0.7,       // Deepforge: food upkeep multiplier in winter
  buildSlow: 0.2,          // Deepforge: builders this much slower
  forestClaim: 6,          // Deepforge: zones with more tree tiles than this must be cleared first
  plunder: { base: 1, armored: 3, boss: 25 }, // Emberkin: gold per kill
  moraleDrop: 1.5,         // Emberkin: morale losses multiplied by this
};

export const FACTION_BUILDINGS = {
  cathedral: {
    id: 'cathedral', name: 'Cathedral of Dawn', cat: 'economy', size: 2, solid: true,
    faction: 'dawnhold', unique: true,
    desc: 'The bells of the sunrise. While it stands the realm\'s morale settles higher (+8 per level), and wounded soldiers nearby slowly heal.',
    levels: [
      { cost: { wood: 60, stone: 40, gold: 30 }, work: 18, hp: 420, morale: 8, radius: 4, heal: 1.5, light: 2.2, sight: 4 },
      { cost: { stone: 50, gold: 45 }, work: 22, hp: 600, morale: 16, radius: 4.5, heal: 2.5, light: 2.6, sight: 5 },
    ],
  },
  hearttree: {
    id: 'hearttree', name: 'Heart Tree', cat: 'economy', size: 2, solid: true,
    faction: 'sylvari', unique: true,
    desc: 'An elder tree with a slow golden heartbeat. Soldiers, heroes and the Sovereign within its reach mend about 4 health a second.',
    levels: [
      { cost: { wood: 55, food: 25, gold: 20 }, work: 16, hp: 380, radius: 4.5, heal: 4, light: 1.8, sight: 4 },
      { cost: { wood: 45, stone: 10, gold: 35 }, work: 18, hp: 520, radius: 5.5, heal: 6, light: 2.2, sight: 5 },
    ],
  },
  runeforge: {
    id: 'runeforge', name: 'Runeforge', cat: 'defense', size: 2, solid: true,
    faction: 'deepforge', unique: true,
    desc: 'Dwarven smiths carve runes into every bolt and bowstave. Watchtowers, Ballistae and Mage Spires within 5 tiles deal +25% damage and reach +0.5 tiles further (+40% and +1 tile at level 2). Several forges do not stack.',
    levels: [
      { cost: { wood: 30, stone: 60, gold: 25 }, work: 18, hp: 460, radius: 5, dmgBonus: 0.25, rangeBonus: 0.5, light: 2, sight: 3 },
      { cost: { stone: 50, gold: 40 }, work: 20, hp: 640, radius: 5, dmgBonus: 0.4, rangeBonus: 1, light: 2.4, sight: 4 },
    ],
  },
  wardrum: {
    id: 'wardrum', name: 'War Drum', cat: 'military', size: 1, solid: true,
    faction: 'emberkin', unique: true,
    desc: 'A great hide drum beaten through the dark. At night, soldiers, heroes and the Sovereign within 6 tiles deal +20% damage (+30% within 7 tiles at level 2).',
    levels: [
      { cost: { wood: 35, food: 15, gold: 15 }, work: 10, hp: 220, radius: 6, nightDmg: 0.2, light: 1.6, sight: 3 },
      { cost: { wood: 25, stone: 15, gold: 25 }, work: 12, hp: 320, radius: 7, nightDmg: 0.3, light: 1.8, sight: 4 },
    ],
  },
};
