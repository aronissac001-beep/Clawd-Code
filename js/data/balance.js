// Every tunable number lives here so balance passes never touch logic code.
// Units: distances in tiles, times in seconds, rates per minute unless noted.

export const BAL = {
  tile: 32,             // world units per tile
  mapSize: 40,          // tiles per side
  tickRate: 20,         // simulation ticks per second

  cycle: {
    dayLen: 90,
    duskLen: 10,
    nightMax: 60,       // remaining Hollow burn away at this point (not on Blood Moons)
    nightMin: 18,       // a night lasts at least this long
    dawnLen: 4,
    nightTimeScaleAtNightEnd: 1,
  },

  start: { food: 70, wood: 90, stone: 30, gold: 40, villagers: 5 },

  difficulty: {
    story:    { label: 'Story',    nights: 5, waveMult: 0.6,  enemyHp: 0.8,  startMult: 1.3, emberMult: 0.7, desc: 'Gentle tides. For learning the realm.' },
    standard: { label: 'Standard', nights: 7, waveMult: 1.0,  enemyHp: 1.0,  startMult: 1.0, emberMult: 1.0, desc: 'The intended challenge.' },
    brutal:   { label: 'Brutal',   nights: 8, waveMult: 1.4,  enemyHp: 1.15, startMult: 0.9, emberMult: 1.5, desc: 'The Hollow does not forgive.' },
  },

  villager: {
    speed: 1.75,          // tiles per second
    hp: 30,
    foodPerMin: 2,
    buildPerSec: 1,       // build work units per second per builder
    maxBuilders: 3,
    chopTime: 3.2,
    mineTime: 3.8,
    farmCycle: 5,
    carryWood: 5,
    carryStone: 3,
    farmYield: 1,         // food per farm cycle per worker  (12/min)
    growthInterval: 16,   // seconds of daylight between newcomers
    growthFoodMin: 20,    // need this much food in store to attract newcomers
    growthFoodCost: 6,
    starveInterval: 14,   // at zero food, one villager leaves this often
    repairPerSec: 10,     // hp restored per builder per second
    sight: 2.5,
    workRadius: 6,        // lumber/quarry search radius from the camp
  },

  soldierFoodPerMin: 1.2,

  waves: {
    base: 4, linear: 3.0, quad: 0.32,
    bloodMoonEvery: 6, bloodMoonMult: 1.8,
    spawnInterval: 0.6,
    groupsByNight: [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5],
    unlockNight: { husk: 1, hound: 2, shade: 3, knight: 4 },
    eliteFromNight: 5,
  },

  combat: {
    aggroRadius: 3.2,     // soldiers engage within this of their rally point
    leash: 5.5,           // and give up chasing past this
    retreatHp: 0.25,      // Sovereign falls back below this fraction
    lightBonus: 0.25,     // Hollow take +25% damage in light
    separation: 9,        // world units
    buildingDmgMult: { crush: 2 },
  },

  sovereign: {
    regenNearHearth: 6, regenIdle: 0.8, idleDelay: 5, hearthRange: 5,
    respawnLock: 0,
  },

  rateWindow: 60,         // seconds used for the per-minute resource display

  embers: { perNight: 8, objective: 25, perBonusNight: 12, bonusGrowth: 1.25, lossShare: 0.5 },

  dawnGold: { base: 15, perNight: 5 },

  fog: { hearthSight: 8, updateEvery: 10 },
};

// Damage-type matchups. Values multiply damage dealt; missing entries = 1.
// Read as: attacker damage type -> defender tag -> multiplier.
export const MATCHUPS = {
  pierce: { armored: 0.4, spirit: 0.6, infantry: 1.4 },
  blade:  { armored: 0.7 },
  crush:  { armored: 1.5, spirit: 0.7 },
  fire:   { armored: 1.4, spirit: 1.8 },
};
