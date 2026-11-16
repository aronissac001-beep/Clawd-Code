// Every tunable number lives here so balance passes never touch logic code.
// Units: distances in tiles, times in seconds, rates per minute unless noted.

export const BAL = {
  tile: 32,             // world units per tile
  mapSize: 40,          // tiles per side
  tickRate: 20,         // simulation ticks per second

  // Stream D (pacing). One cycle is about 85-100 s at 1x and at least a third of it is fighting.
  cycle: {
    dayLen: 35,
    firstDayLen: 50,    // the first day of a region (night 0): time to found the town
    duskLen: 6,
    nightMax: 75,       // remaining Hollow burn away at this point
    nightMin: 12,       // a night lasts at least this long
    clearGrace: 3,      // the night ends this long after the last Hollow falls
    dawnLen: 3,
    callGold: 1,        // gold per second of daylight skipped by Calling the Night
    autoEndAfter: 10,   // the day may end on its own after this long ...
    autoEndIdle: 4,     // ... once nothing has been affordable or queued for this long
    soldierDawnHeal: 0.15, // share of max health soldiers recover at dawn (more needs a healer)
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

  // Wave budget by region night and global depth d (see RUN.depth): a crowd of about 10 / 17 / 30
  // foes at depth 0 plus the Long Night's elite Warden, growing about 25% per depth. Budgets are
  // in cost units (Husk 1, Hound 1.3, Shade 1.7, Knight 4.5); a mixed roster averages about 1.25
  // per foe, so nights 2 and 3 carry about 1.25x their foe counts. (The plan's 10/16/26 + 4/5/7
  // per depth were foe counts; tools/pacing.mjs tuned the rest: a 26-foe Long Night peaked
  // below 20 alive at once, and a denser middle night is what lets an idle realm fall.)
  // Every region's last night is its Long Night (it replaced the every-6th-night Blood Moon);
  // Endless and long standalone regions have one every 3rd night.
  waves: {
    budget: { n1: [10, 3], n2: [21, 5], long: [38, 8] },   // [base, per depth]
    longEvery: 3,
    riftShare: 0.25,    // a live Rift's band replaces this share of the fronts (it adds ~1/3)
    bloodMoonEvery: 3,  // legacy alias of longEvery (HUD moon countdown)
    bloodMoonMult: 1.8, // legacy: the Moonwell wonder's blessing size
    fronts: { early: [1, 1, 2], late: [2, 2, 3], lateFromDepth: 4 },
    // Each front arrives as one dense crowd (the Warden leads it on the Long Night) and then
    // smaller bands, so the night keeps fighting: the share of the front's foes in each pulse,
    // pulseGap seconds apart.
    pulses: { n1: [0.3, 0.25, 0.25, 0.2], n2: [0.45, 0.2, 0.2, 0.15], long: [0.75, 0.1, 0.08, 0.07] },
    pulseGap: 10,
    spawnInterval: 0.2,  // seconds between foes of one pulse
    frontStagger: 1.5,   // seconds between fronts
    // First "effective night" (region night 1-3, plus depth x unlockPerDepth) a type may join.
    unlockNight: { husk: 1, hound: 2, shade: 3, knight: 4 },
    unlockPerDepth: 0.5,
    eliteFromNight: 5,
    wardenHearthCap: 0.4, // a Warden deals at most this share of the Hearth's max health a night
    // Spawn points 12.5-15 tiles from the Hearth's centre, at most 1.3x the straight line and
    // 18 tiles on foot (the plan's 1.4x / 30 tiles is too far for a Husk, 1.15 tiles/s, to come
    // within 6 tiles of the Hearth in 10 s).
    spawnRing: [12.5, 15], spawnMaxDetour: 1.3, spawnMaxFlow: 18,
    spawnKeepOut: 1,      // tiles around a spawn point where nothing can be built
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
    regenNearHearth: 2, regenIdle: 0.8, idleDelay: 5, hearthRange: 5,
    respawnLock: 0,
  },

  rateWindow: 60,         // seconds used for the per-minute resource display

  embers: { perNight: 8, objective: 25, perBonusNight: 12, bonusGrowth: 1.25, lossShare: 0.5 },

  dawnGold: { base: 15, perNight: 5 },

  // Hearth supply trade: gold carried between regions buys raw materials.
  trade: { wood: { amount: 25, price: 18 }, stone: { amount: 15, price: 20 }, food: { amount: 30, price: 16 }, priceStep: 3 },

  fog: { hearthSight: 8, updateEvery: 10 },
};

// Damage-type matchups. Values multiply damage dealt; missing entries = 1.
// Read as: attacker damage type -> defender tag -> multiplier.
export const MATCHUPS = {
  pierce: { armored: 0.4, spirit: 0.6, infantry: 1.4 },
  blade:  { armored: 0.7 },
  crush:  { armored: 1.5, spirit: 0.7 },
  fire:   { armored: 1.4, spirit: 1.8 },
  magic:  { armored: 1.7, spirit: 1.3, beast: 0.8 },
};

// Region modifiers. Every region starts from a copy of DEFAULT_MODS; relics,
// Beacon bonuses, Dawn Offerings and event aftermath add to these values and
// the simulation systems read them. All additive unless marked (x) multiplier.
export const DEFAULT_MODS = {
  buildSpeed: 0,   // +fraction builder work speed
  farmYield: 0,    // +fraction farm food
  chopSpeed: 0,    // +fraction woodcutter and mason gather speed
  towerRange: 0,   // +tiles Watchtower (and Ballista) range
  towerDmg: 0,     // +fraction damage of Watchtowers, Ballistae and Mage Spires
  rangedDmg: 0,    // +fraction damage of all arrows (towers and Archers)
  soldierDmg: 0,   // +fraction damage of every soldier
  sovDmg: 0,       // +fraction Sovereign melee damage
  lightRadius: 0,  // +tiles Brazier light
  lightMult: 1,    // (x) Brazier and Hearth light radius
  hearthHp: 0,     // +fraction Hearth max health
  hearthDmg: 0,    // +flat Hearth ember-bolt damage
  wallHp: 0,       // +fraction Wall and Gate health
  popPerHouse: 0,  // +flat population per House
  goldMult: 0,     // +fraction House taxes and Market income
  dawnGold: 0,     // +flat gold every dawn
  interest: 0,     // fraction of banked gold paid as interest each dawn (max 30 gold)
  upkeep: 0,       // +fraction food upkeep (negative = cheaper)
  novaDmg: 0,      // +fraction Heartflame Nova damage
  novaCd: 0,       // -seconds Nova cooldown
  bannerDur: 0,    // +seconds Royal Banner duration
  bannerCd: 0,     // -seconds Royal Banner cooldown
  enemyHp: 0,      // +fraction Hollow health
  enemyDmg: 0,     // +fraction Hollow damage
  enemySpeed: 0,   // +fraction Hollow speed
  waveMult: 0,     // +fraction wave budget
  draftExtra: 0,   // +options in blueprint drafts and Dawn Offerings
  lootMult: 0,     // +fraction gold and Ember rewards from this region
};

// The run layer (Realm Map). Phase 2 ships Act 1.
export const RUN = {
  stepsPerAct: 6,          // steps before the boss
  // Every region plays 3 nights; the 3rd is the Long Night.
  regionNights: { region: [3, 3], cursed: [3, 3], ruin: [3, 3], boss: [0, 0] },
  // One global depth index drives waves, objectives and loot, so nothing resets at an act
  // boundary: depth = (act - 1) * (stepsPerAct + 1) + step, +1 for each Long Night already
  // held in the region (bonus nights and Endless grow harsher).
  depth: { sideGold: 40, sideGoldPerDepth: 10 },
  depthWave: 0,            // legacy (wave growth is in BAL.waves.budget now)
  actWave: 0,              // legacy
  actHp: 0.12,             // +Hollow health per act after the first
  cursed: { waveMult: 0.3, enemyHp: 0.15, lootMult: 0.6 },
  // The boss region: thinner regular waves (the wyrm is the fight) and a richer start.
  boss: { waveMult: -0.4 },
  bossStart: { wood: 120, stone: 80, food: 40, villagers: 2 },
  startGold: 40,
  regionStartGoldCap: 400,
  embers: { region: 20, cursed: 30, ruin: 12, boss: 80, perNight: 4, perBonusNight: 10, bonusGrowth: 1.25, lossShare: 0.5 },
  shopPrice: { common: 45, rare: 85, legendary: 140, blueprint: 55, heal: 35, supplies: 40, uncurse: 60 },
  bossNight: 3,            // the boss region's Gloomwyrm arrives at dusk of this night
};
