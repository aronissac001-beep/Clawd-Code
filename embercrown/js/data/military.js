// Phase 4 military content: seven units and three training buildings. Same schemas as
// UNITS (js/data/units.js) and BUILDINGS (js/data/buildings.js); js/game/systems/military.js
// merges them in and runs every special rule named in the texts below.
//
// The counter loop, told against the Hollow (soldiers never fight each other):
//   Spears beat cavalry   Spearmen skewer Gloom Hounds, the Hollow's fast riders, and the
//                         Hounds (and every other non-boss beast) hamstring our horses:
//                         Knights and Scouts take +50% from them.
//   Cavalry beats archers Knights ride down Husks and the drifting Shades that pick at our
//                         lines, and their sweeping blows catch a second foe.
//   Archers beat infantry Arrows and bolts shred massed Husks (pierce vs infantry).
//   Infantry beats spears Mauls and shield-bosses (crush) cave in Hollow Knight plate.
//   Magic beats armor     Battlemage fire-orbs burn through plate (magic vs armored).
//   Armor beats arrows    Hollow plate turns arrows aside; our own armoured troops (Knight,
//                         Shieldwall) take 40% less damage from anything piercing.
//
// Unit keys used by military.js beyond the core schema (all optional):
//   tags        ['cavalry'] (beasts deal more), ['armored'] (less pierce damage taken)
//   aura        Shieldwall: { radius, cut } damage cut for allies within radius tiles
//   heal        Field Healer: hp a second on the most wounded ally within healRange tiles
//   splash      Battlemage: { radius, share } of the hit dealt to foes around the target
//   reveal      Scout: tiles of fog lifted around it (soldiers normally see 3.5)
//   vsBoss      Ballista Cart: damage multiplier against bosses and Hollow structures
//   noFlying    Ballista Cart: never targets, and cannot hurt, foes on the wing
//   shot        projectile look and flight: { kind, speed, arc }

export const MILITARY_TUNE = {
  cavalryBeastMult: 1.5,   // Gloom Hounds (beast tag) vs units tagged cavalry
  armorPierceMult: 0.6,    // pierce damage taken by units tagged armored
  healEvery: 5,            // ticks between healing pulses (4 a second)
  healerFlee: 1.4,         // tiles: a Healer backs away from a foe closer than this
  revealEvery: 10,         // ticks between Scout fog reveals
  splashMax: 6,            // most extra foes one Battlemage orb can splash
  thinkEvery: 0.3,         // seconds between target choices for Healers and Ballista Carts
};

export const MILITARY_UNITS = {
  crossbow: {
    id: 'crossbow', name: 'Crossbowman', role: 'Heavy crossbow',
    desc: 'A steel crossbow cranked by hand. Slow to reload, but each heavy bolt punches through Hollow plate that turns ordinary arrows aside.',
    strong: 'Hollow Knights (for a bow), Husks', weak: 'Gloom Hounds up close, Shades',
    cost: { gold: 20, food: 10, wood: 12 }, train: 7,
    hp: 50, armor: 0.1, dmg: 14, dmgType: 'pierce', rate: 2.0, range: 5.5, speed: 1.4, sight: 5.5,
    bonus: { armored: 2 }, ranged: true,
    shot: { kind: 'qbolt', speed: 16, arc: 0.35 },
  },
  cavalier: {
    id: 'cavalier', name: 'Knight', role: 'Heavy cavalry', tags: ['cavalry', 'armored'],
    desc: 'A plated rider on a barded warhorse. Fast and hard to kill, and arrows glance off the plate; rides down Husks and Shades, and each sweeping blow catches a second foe. Gloom Hounds and other beasts hamstring the horse (+50% damage), and Hollow Knight plate blunts the sword.',
    strong: 'Husks, Shades', weak: 'Gloom Hounds, Hollow Knights',
    cost: { gold: 34, food: 16, wood: 10 }, train: 9,
    hp: 110, armor: 0.2, dmg: 10, dmgType: 'blade', rate: 1.1, range: 1.0, speed: 2.5, sight: 4.5,
    bonus: { infantry: 1.3, spirit: 1.5 }, ranged: false, cleave: 2,
  },
  shieldwall: {
    id: 'shieldwall', name: 'Shieldwall', role: 'Shield infantry', tags: ['armored'],
    desc: 'A tower shield and a short iron mace. Very hard to break and slow to hurt anything; allies fighting within 1.5 tiles of a Shieldwall take 15% less damage, and arrows barely scratch it.',
    strong: 'Husk swarms (guards the line)', weak: 'Shades, anything that runs past it',
    cost: { gold: 18, food: 10, wood: 8 }, train: 7,
    hp: 100, armor: 0.4, dmg: 4, dmgType: 'crush', rate: 1.2, range: 0.85, speed: 1.25, sight: 3.5,
    bonus: {}, ranged: false,
    aura: { radius: 1.5, cut: 0.15 },
  },
  healer: {
    id: 'healer', name: 'Field Healer', role: 'Battle medic',
    desc: 'Carries salves and a lantern-staff instead of a weapon. Mends the most wounded ally within 4 tiles for 8 health a second, and keeps well back from the fighting. Several Healers share out the wounded instead of all mending the same one.',
    strong: 'Long, grinding fights (mends the wounded)', weak: 'Being caught alone (cannot fight)',
    cost: { gold: 22, food: 14 }, train: 8,
    hp: 40, armor: 0.05, dmg: 0, dmgType: 'magic', rate: 1, range: 3.5, speed: 1.6, sight: 4.5,
    bonus: {}, ranged: true,
    heal: 8, healRange: 4,
  },
  battlemage: {
    id: 'battlemage', name: 'Battlemage', role: 'War-mage',
    desc: 'Hurls orbs of ember-fire that burst on impact: magic burns through Hollow plate and Shades, and foes within a tile of the target take 30% of the hit. Frail and slow between casts, and Gloom Hounds are too quick to burn well.',
    strong: 'Hollow Knights, packed Husks, Shades', weak: 'Gloom Hounds, being caught',
    cost: { gold: 32, food: 12, stone: 8 }, train: 8,
    hp: 44, armor: 0.05, dmg: 9, dmgType: 'magic', rate: 1.7, range: 4.5, speed: 1.4, sight: 5,
    bonus: { beast: 0.75 }, ranged: true,
    splash: { radius: 1, share: 0.3 },
    shot: { kind: 'mageorb', speed: 9, arc: 0.2 },
  },
  scout: {
    id: 'scout', name: 'Scout', role: 'Mounted outrider', tags: ['cavalry'],
    desc: 'A light rider with a short bow. The fastest thing in the realm: lifts the fog 8 tiles around it, so move its squad to explore. A weak shot, and Gloom Hounds and other beasts hamstring the pony (+50% damage).',
    strong: 'Stragglers (and it lifts the fog)', weak: 'Gloom Hounds, any real fight',
    cost: { gold: 14, food: 8 }, train: 4,
    hp: 46, armor: 0.05, dmg: 3, dmgType: 'pierce', rate: 1.2, range: 3.5, speed: 2.9, sight: 8,
    bonus: {}, ranged: true,
    reveal: 8,
  },
  ballistacart: {
    id: 'ballistacart', name: 'Ballista Cart', role: 'Siege engine',
    desc: 'A great crossbow on a wheeled carriage, cranked by a crew of two. Very long range and slow, with bolts that pierce Hollow plate and hit bosses and structures (Rifts, beast lairs) 75% harder. It cannot aim at foes on the wing.',
    strong: 'Bosses, Rifts and lairs, from afar', weak: 'Flying foes, Gloom Hounds, swarms',
    cost: { gold: 30, food: 6, wood: 30, stone: 20 }, train: 10,
    hp: 90, armor: 0.2, dmg: 30, dmgType: 'pierce', rate: 3.2, range: 8, speed: 1.0, sight: 7,
    bonus: { armored: 2.5 }, ranged: true,
    vsBoss: 1.75, noFlying: true,
    shot: { kind: 'ballista', speed: 17, arc: 0.25 },
  },
};

// Support troops raised at the core Barracks (see trainsExtra in military.js).
export const BARRACKS_EXTRA = ['shieldwall', 'healer'];

// Level keys read by military.js beyond the core schema (all optional):
//   rangedBonus  Archery Range: +fraction damage for every Archer and Crossbowman in the
//                region (the best standing Range counts; several do not stack)
//   siegeBonus   Siege Workshop: +fraction damage for every Ballista Cart and Battlemage
// squadCap and trainSpeed are the core keys (squad size, training speed multiplier).
export const MILITARY_BUILDINGS = {
  archery: {
    id: 'archery', name: 'Archery Range', cat: 'military', size: 2, solid: true, draftable: true, unlock: 'u_ranges',
    trains: ['archer', 'crossbow'],
    desc: 'Straw butts and a covered firing line. Trains Archers and Crossbowmen. From level 2 every Archer and Crossbowman in the region shoots harder (several Ranges do not stack).',
    levels: [
      { cost: { wood: 45, stone: 15, gold: 10 }, work: 14, hp: 300, squadCap: 6, sight: 4, light: 1.4 },
      { cost: { wood: 30, stone: 30, gold: 25 }, work: 16, hp: 420, squadCap: 7, sight: 5, light: 1.6, trainSpeed: 1.25, rangedBonus: 0.1 },
      { cost: { wood: 30, stone: 45, gold: 40 }, work: 18, hp: 540, squadCap: 8, sight: 6, light: 1.8, trainSpeed: 1.5, rangedBonus: 0.2 },
    ],
  },
  stable: {
    id: 'stable', name: 'Stable', cat: 'military', size: 2, solid: true, draftable: true, unlock: 'u_ranges',
    trains: ['cavalier', 'scout'],
    desc: 'Stalls, hay and a fenced paddock. Trains Knights (heavy cavalry) and Scouts (fast riders who lift the fog). Horses are costly, so cavalry squads are small.',
    levels: [
      { cost: { wood: 55, stone: 15, gold: 15 }, work: 16, hp: 340, squadCap: 4, sight: 4, light: 1.4 },
      { cost: { wood: 35, stone: 30, gold: 30 }, work: 18, hp: 480, squadCap: 6, sight: 5, light: 1.6, trainSpeed: 1.3 },
    ],
  },
  siegeworks: {
    id: 'siegeworks', name: 'Siege Workshop', cat: 'military', size: 2, solid: true, draftable: true, unlock: 'u_siege',
    trains: ['ballistacart', 'battlemage'],
    desc: 'Heavy timber, a crane and an ember-forge: the heavy answer to heavy foes. Builds Ballista Carts and trains Battlemages. From level 2 both deal more damage.',
    levels: [
      { cost: { wood: 60, stone: 35, gold: 20 }, work: 18, hp: 380, squadCap: 3, sight: 4, light: 1.6 },
      { cost: { wood: 30, stone: 45, gold: 35 }, work: 20, hp: 520, squadCap: 5, sight: 5, light: 1.8, trainSpeed: 1.25, siegeBonus: 0.15 },
      { cost: { stone: 60, gold: 50 }, work: 22, hp: 660, squadCap: 6, sight: 6, light: 2, trainSpeed: 1.5, siegeBonus: 0.3 },
    ],
  },
};

export const MILITARY_ORDER = { military: ['archery', 'stable', 'siegeworks'] };
