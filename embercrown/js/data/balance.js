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

  // Stream E (day economy). Starting stock: Day 1 opens with 3+ real choices (Farm, Lumber Camp,
  // House, Quarry, a Watchtower or Brazier) and still has wood after the first four, and six
  // villagers so the new camps are staffed while the first buildings go up (tools/economy.mjs).
  start: { food: 70, wood: 160, stone: 40, gold: 40, villagers: 6 },

  // Stream E. Producers pay part of their output at once (the trickle, so villager work still
  // reads) and bank the rest, which arrives as one visible lump at dawn (event 'incomeLump').
  economy: {
    trickle: { food: 0.7, wood: 0.6, stone: 0.6, gold: 0.5 }, // share of each delivery and of taxes paid at once
    firstDayTrickle: 0.7,  // ... on a region's first day (no dawn behind it: the town is being founded)
    affordSoon: 8,         // s: the day does not end early while work under way pays for a choice this soon
    walkGuess: 3.5,        // s: a gatherer's walk to the tree or rock and back, for that estimate
    campMinWood: 150,      // a Lumber Camp needs this much standing wood within its radius
    campMinStone: 0,       // a Quarry only needs some rock in range
    campReach: 3,          // tiles past its radius a camp's workers walk before it is depleted
    campLowShare: 0.2,     // warn once when a camp's standing wood falls below this share of placement
    softlockAfter: 6,      // seconds of daylight with no wood income and no wood before the prompt
    giftAfter: 10,         // ... and, when gold cannot buy the trade either, a free cart of logs
    giftWood: 25,
  },

  difficulty: {
    story:    { label: 'Story',    nights: 5, waveMult: 0.6,  enemyHp: 0.8,  startMult: 1.3, emberMult: 0.7, desc: 'Gentle tides. For learning the realm.' },
    standard: { label: 'Standard', nights: 7, waveMult: 1.0,  enemyHp: 1.0,  startMult: 1.0, emberMult: 1.0, desc: 'The intended challenge.' },
    brutal:   { label: 'Brutal',   nights: 8, waveMult: 1.4,  enemyHp: 1.15, startMult: 0.9, emberMult: 1.5, desc: 'The Hollow does not forgive.' },
  },

  villager: {
    speed: 1.75,          // tiles per second
    hp: 30,
    foodPerMin: 2,
    // The day is 35 s, not 90: building and gathering run faster so a day still pays for about
    // six decisions (stream E; measured with tools/economy.mjs).
    buildPerSec: 1.4,     // build work units per second per builder
    maxBuilders: 3,
    chopTime: 2.4,
    mineTime: 2.6,
    farmCycle: 5,
    carryWood: 6,
    carryStone: 5,
    farmYield: 1,         // food per farm cycle per worker  (12/min)
    growthInterval: 10,   // seconds of daylight between newcomers (only while a job is open)
    growthFoodMin: 20,    // need this much food in store to attract newcomers
    growthFoodCost: 6,
    starveInterval: 14,   // at zero food, one villager leaves this often
    fadeTime: 0.25,       // seconds to fade into or out of a shelter at its door
    repairPerSec: 4,      // hp restored per builder per second (paid: see BAL.repair)
    sight: 2.5,
    workRadius: 6,        // lumber/quarry search radius from the camp
  },

  // Stream E. Repairs cost the building's material and wounds carry across nights.
  repair: {
    hpPerRes: 8,          // hit points restored per 1 wood (wood buildings) or 1 stone (stone ones)
    below: 0.85,          // builders repair a building below this share of its health
    calm: 6,              // ... once it has not been hit for this long
    maxBuilders: 2,       // villagers mending one building at once (construction takes 3)
  },

  soldierFoodPerMin: 1.2,

  // Wave budget by region night and global depth d (see RUN.depth), in cost units (Husk 1,
  // Hound 1.3, Shade 1.7, Knight 4.5). At depth 0 that is a crowd of 10 / about 17 / about 35 foes
  // plus the Long Night's elite Warden. Measured with tools/pacing.mjs (10-20 seeds):
  //  - The plan's 10/16/26 were foe counts. A 26-foe Long Night peaked below 20 alive at once and
  //    an idle realm (3 buildings, no orders) still held it in about half the seeds; 44 units
  //    (about 35 foes) makes the idle realm fall in 17-20 of 20 while the modest bot holds 19 of 20.
  //  - Growth is about 10% per depth, not the plan's 25%: every region is a fresh settlement, so
  //    a player's town does not grow with depth (relics, gold and Dawn Cards do). At +8 per depth
  //    on the Long Night the modest bot's region win rate fell 95% / 80% / 50% / 10% over depths
  //    0-3; at +5 it is 95% / 95% / 90% / 70%. Raise it once Dawn Cards (stream H2) carry power.
  // Every region's last night is its Long Night (it replaced the every-6th-night Blood Moon);
  // Endless and long standalone regions have one every 3rd night.
  waves: {
    budget: { n1: [10, 2], n2: [21, 3], long: [44, 5] },   // [base, per depth]
    longEvery: 3,
    riftShare: 0.25,    // a live Rift's band replaces this share of the fronts (it adds ~1/3)
    bloodMoonEvery: 3,  // legacy alias of longEvery (HUD moon countdown)
    bloodMoonMult: 1.8, // legacy: the Moonwell wonder's blessing size
    fronts: { early: [1, 1, 2], late: [2, 2, 3], lateFromDepth: 4 },
    // Each front arrives as one dense crowd (the Warden leads it on the Long Night) and then
    // smaller bands, so the night keeps fighting: the share of the front's foes in each pulse,
    // pulseGap seconds apart.
    pulses: { n1: [0.25, 0.2, 0.2, 0.2, 0.15], n2: [0.4, 0.15, 0.15, 0.15, 0.15], long: [0.7, 0.1, 0.07, 0.07, 0.06] },
    pulseGap: 10,        // seconds (or { n1, n2, long })
    spawnInterval: 0.2,  // seconds between foes of one pulse
    frontStagger: 1.5,   // seconds between fronts
    // First "effective night" (region night 1-3, plus depth x unlockPerDepth) a type may join.
    // Hollow Knights (and the Knight Warden) wait for effective night 5, a Long Night at depth 4
    // or more (Act II once acts are 3 regions): at 4 they reached the 3rd region and cut the
    // modest bot's win rate there from 90% to 70%.
    unlockNight: { husk: 1, hound: 2, shade: 3, knight: 5 },
    unlockPerDepth: 0.5,
    eliteFromNight: 5,
    wardenHearthCap: 0.4, // a Warden deals at most this share of the Hearth's max health a night
    wardenKnightFrom: 5,  // the Warden is a Shade until this effective night, then a Hollow Knight
    // Spawn points 12.5-15 tiles from the Hearth's centre, at most 1.3x the straight line and
    // 18 tiles on foot (the plan's 1.4x / 30 tiles is too far for a Husk, 1.15 tiles/s, to come
    // within 6 tiles of the Hearth in 10 s).
    spawnRing: [12.5, 15], spawnMaxDetour: 1.3, spawnMaxFlow: 18,
    spawnKeepOut: 1,      // tiles around a spawn point where nothing can be built
  },

  // Stream B (combat behaviour): fighters commit, hold and spread out; walls get sieged.
  combat: {
    aggroRadius: 3.2,     // a soldier engages a foe within this of itself...
    leash: 5.5,           // ...that is within this of its squad's working rally point
    releasePad: 1,        // and lets it go only beyond leash + this (hysteresis)
    minTargetHold: 1,     // seconds a fighter keeps a target before it may switch
    losGiveUp: 1,         // seconds a melee fighter beside its foe, with a wall in the way, keeps trying
    holdAfterKill: [0.8, 1.2], // seconds a fighter stands and faces the spot of its last kill
    slotsSmall: 3,        // most melee attackers on one foe at once
    slotsBig: 4,          // ...on a big one (Hollow Knight, elites, bosses)
    retarget: 2,          // tiles: a melee fighter turned away by a full foe looks this far for another
    zoneRadius: 7,        // tiles: each squad defends this area around its ordered point
    zoneEvery: 0.3,       // seconds between guard-zone checks
    zoneReturn: 3,        // seconds after the last threat before the squad walks back
    zoneHurry: 1.25,      // speed factor of a squad hurrying to a threat in its zone (more than 2 tiles off)
    wallFormation: 0.7,   // formation spacing factor while the squad lines up behind a besieged building
    siegeSeen: 1.5,       // a building hit this recently counts as besieged
    marchMax: 8,          // seconds a squad on a new order ignores its zone (until it arrives)
    sovAggro: 4,          // tiles: with no order the Sovereign fights within this of where it stands
    sovMarchMax: 12,      // seconds a Sovereign move order may ignore foes before it fights where it is
    sovZone: 6,           // tiles: a building besieged this near where the Sovereign stands draws it there
    sovZoneReturn: 8,     // ...and it walks back this long after the last blow (no running round the Hearth)
    siegeCommit: 2.5,     // seconds a Hollow keeps smashing the tile that blocked its bite
    biteRelease: 2,       // tiles past its aggro a Hollow chases a living target
    bitePad: 6,           // world units of give a planted biter allows before it steps again
    plantedSep: 1.2,      // separation radius (x body radius) of a Hollow planted on a bite or a siege
    flankTime: 1.5,       // seconds a blocked Gloom Hound ignores living targets and flanks instead
    retreatHp: 0.25,      // Sovereign falls back below this fraction
    lightBonus: 0.25,     // Hollow take +25% damage in light
    separation: 9,        // world units (movement.js raises it to 14 for soldiers, 10 for villagers)
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
  stepsPerAct: 4,          // steps before the boss: region, region, crossroads (Mystery or Merchant), region (stream H2)
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

// =============================================================================================
// Colony balance (doc 13.4; owner G). Every tuning number of the colony game, by section. BAL,
// MATCHUPS, DEFAULT_MODS and RUN above are the roguelite tables, still imported by legacy
// modules; they are deleted with them (A, 13.5). Integers only (percents, ticks, per-mille).
// Sections whose numbers come from the Stage 0 device spike (RENDER S1/S2, SAVE S3, LAYOUT S5)
// hold the doc's planning values until the spike owners send measured ones.
// =============================================================================================

/** Calendar tuning (2.2). Contract values (ticks per hour, day, season) live in core/time.js. */
export const TIME = {
  speeds: [0, 1, 2, 3, 5],    // speed multipliers offered: pause, 1x, 2x, 3x, 5x
  maxTicksPerFrame: 4,
  dawnH: [5, 7], duskH: [19, 21], nightH: [21, 5], deepcoldNightH: [20, 6],
  autoPauseYears: 1,          // auto-pause on major letters during the first year
};
/** Needs, mood and breaks (4.4, 4.5, 5.3). Needs are 0..100 stored x100 (core FIX). */
export const NEEDS = {
  every: 20,                  // each colonist updates when tick % 20 == id % 20
  fallPerDay: { food: 33, rest: 99, joy: 30 },
  urgent: { food: 25, rest: 15, warmth: 20, light: 15 },
  schedule: { rest: 90, joy: 80 }, fallback: 60,
  moodBase: 50, moodSmoothEvery: 60,
  breakAt: { minor: 35, major: 20, extreme: 8 }, breakCheckEvery: 600, breakChancePerHourPct: [2, 4, 8],
  inspireAt: 85, inspireHours: 12, inspireChancePerDayPct: 3,
  // Stage 1b: eating (6.5). A colonist eats until about eatTo; a meal takes eatMinMeal game minutes,
  // raw food eatMinRaw a unit. Food within tableR tiles of a table is carried there (else "Ate without a table").
  eat: { eatTo: 90, eatMinMeal: 10, eatMinRaw: 2, tableR: 12, bingeMeals: 2 },
  // Sleep (4.4): rest restored per game hour in a bed (x bed quality later); the ground gives groundPct of it.
  // Colonists wake when rested (wakeAt) outside sleep hours, or full; collapse where they stand at 0.
  sleep: { perHour: 13, groundPct: 60, wakeAt: 90, bedSearchR: 60 },
  // Light / dread (4.4): fallPerDay of the need applies in darkness (rt.light 0); dimPct of it in dim light
  // (level 1); lit tiles (level >= 2) restore litPerDay; within hollowR tiles of a hostile it falls an extra
  // hollowPerDay. Seeking light ends at seekTo.
  light: { dimPct: 40, litPerDay: 600, hollowR: 8, hollowPerDay: 480, seekTo: 60, seekR: 40 },
  // Condition thoughts are refreshed every thoughtEvery ticks (staggered by colonist id).
  thoughtEvery: 60, painThought: 15,
  // Breaks (4.5): a sulk wanders within sulkR tiles of the Hearth and stands sulkWaitMin game minutes.
  sulkR: 8, sulkWaitMin: 45,
};
/** Health (4.6). Blood and pain thresholds; bleeding is blood x100 per hour per damage point. */
export const HEALTH = {
  every: 20, downBlood: 40, downPain: 80,
  bleedPerDmg: { cut: 30, stab: 40, blunt: 5, burn: 0, bite: 30, frost: 0, taint: 10 },
  // Stage 1b (no Medicine yet): wounds clot by themselves after clotH game hours; an hour of bed rest
  // tends them (bedTendH, quality bedTendPct); parts heal 1 HP per healH hours in bed; blood comes back
  // bloodPerDay a day while nothing bleeds. Starving (food 0) costs starveBloodPerDay a day.
  clotH: 8, bedTendH: 1, bedTendPct: 30, healH: 4, bloodPerDay: 60, starveBloodPerDay: 50,
};
/** Work (5.3, 5.4, 12.3). Keys match js/game/work/jobs.js WORK exactly (setWorkBalance). */
export const WORK = {
  thinksPerTick: 6, candidatesK: 12, unreachTicks: 600, rethinkTicks: 60, idleWaitTicks: 60,
  maxToilSteps: 8, gotoRetries: 3, spillRadius: 6, stockRecompute: 14400,
  // Stage 1a: mining yield (3.4), carrying (4.2, 5.6), construction deliveries and refunds
  stoneYieldPct: 70, stonePileR: 2, rubbleMin: 6, oreWorkPct: 125, carryMass: 35, carryMightPct: 15, topUpR: 3,
  deliverR: 8, deliverMax: 4, installMin: 10, refundPct: 50, zoneGroups: 8, scanMax: 1536,
};
/** Skills and XP (4.2): speed = (60 + 7 x level)%; XP(n) = round(1100 x 1.28^n). */
export const SKILL = {
  speedBasePct: 60, speedPerLvlPct: 7, xpBase: 1100, xpGrowthPermille: 1280, dailyFullTicks: 3600, dailyAfterPct: 30,
  passionPct: [50, 100, 150], learnPerWitsPct: 8, miningPerMightPct: 3, darkWorkPct: 80, toolPct: { bronze: 5, iron: 10, steel: 15 },
};
/** Quality rolls (5.8). */
export const QUALITY = { rollSdX100: 250, tierBonus: 1, legendaryMinLvl: 16, legendaryChancePct: 10 };
/** Pathing (12.3). */
export const PATH = { budgetPerTick: 8000, searchCapDiv: 2, leaderRepathTicks: 40 };
/** Threat points (9.2); rates in per mille. */
export const THREAT = {
  base: 40, min: 40, max: 4000, wealthKnee: 50000, wealthLoPermille: 8, wealthKneePts: 400, wealthHiPermille: 3,
  popPer: 14, popFree: 3, floorPerDay: 2, yearEndPts: 40, wallWealthPct: 50,
  lossAdjPct: 85, winAdjPct: 115, winAdjMaxPct: 130, maxPerRaid: 60, maxHostiles: 80, maxWarnH: 36,
  difficultyPct: { hearthkeeper: 35, warden: 70, steadfast: 100, ironhold: 140 },
  // Storyteller (9.1): tension 0-100; the scripted first major of a start (story.firstMajorD)
  tensionDecayPerDay: 8, pushBackTension: 60, tensionPerMajor: 40, tensionPerDeath: 20,
  firstOmenH: 18, firstArriveH: 21, firstRaidPts: 60,
  arriveH: { day: 10, dusk: 19, night: 21 },     // arrival hour by incident `arrive` ('any': a seeded hour)
  // Raids on the map (9.3): foe speed in world units per tick at speed 100
  foeSpeed: 2,
};
/** Colony wealth (6.7, 9.2; K's colony/wealth.js): structures count at bldPct, colonists add
 *  coinsPer10Levels coins per 10 skill levels; a full recompute every recomputeEvery ticks. */
export const WEALTH = { bldPct: 50, coinsPer10Levels: 50, recomputeEvery: 14400 };
/** Temperature (3.6), degrees C. Mirrors world/terrain.js TEMP (B moves to this section). */
export const TEMP = {
  season: [10, 22, 8, -6], night: -4, under: 12, underDepth: 5, min: -30, max: 45, coldSnap: -15,
  heat: { hearth: 600, fireplace: 120, forge: 80, bloomery: 80, brazier: 60, stove: 40 }, heatRadius: 3, hearthHeatRadius: 6,
};
/** Caps (12.1). */
export const CAPS = { colonistsSoft: 30, colonistsHard: 40, hostiles: 80, animals: 60, stacks: 4000, buildings: 3000, flames: 64, particles: 900, flowFields: 3, nemeses: 6 };
/** Saving (11.4); S3 confirms the budgets on a device. */
export const SAVE = { autosaveSec: 60, snapshotBudgetMs: 8, putBudgetMs: 50, blobTargetKB: 100, backupMaxAgeSec: 60 };
/** Rendering (12.4, 12.5); S1 and S2 confirm on a device. */
export const RENDER = { dprCap: 2, chunksNear: 36, chunksMid: 27, chunksFar: 48, stillFps: 30, pausedFps: 10, lightPxPerTile: 2, lightSmoothing: 1 };
/** Phone layout (10.1), in pt; S5 confirms the viewports. */
export const LAYOUT = { topBar: 44, rail: 52, bottomBar: 56, peek: 120, minTarget: 44, minTextPx: 14, worldMin: 480, worldMinPeek: 400, landscapePanel: 320 };

/** Registry view of the sections above (validate-data and core/content.js read this). */
export const DATA = {
  balance: [
    { id: 'time', values: TIME }, { id: 'needs', values: NEEDS }, { id: 'health', values: HEALTH }, { id: 'work', values: WORK }, { id: 'skill', values: SKILL },
    { id: 'quality', values: QUALITY }, { id: 'path', values: PATH }, { id: 'threat', values: THREAT }, { id: 'wealth', values: WEALTH }, { id: 'temp', values: TEMP },
    { id: 'caps', values: CAPS }, { id: 'save', values: SAVE }, { id: 'render', values: RENDER }, { id: 'layout', values: LAYOUT },
  ],
};
