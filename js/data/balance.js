// Every tunable number lives here so balance passes never touch logic code.
// Units: distances in tiles, times in seconds, rates per minute unless noted.

// =============================================================================================
// Colony balance (doc 13.4; owner G). Every tuning number of the colony game, by section. (The
// roguelite's tables went with the roguelite in Stage 2.9, EMBERCROWN-FORTRESS.md 1.1.) Integers only (percents, ticks, per-mille).
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
// (2.9b) burning passion x1.15 XP (was x1.5): once the hold had stone to cut all year, a burning, Wits 6
// miner at full shifts was a Grandmaster on day 89 (Warden) and 97 (Steadfast) of seed 1, against the
// 4.2 targets "first Grandmaster on day 110-200, no level 20 before day 100". Keen (x1.0) sets the first
// Master (days 46-53 on seeds 2-5, all keen) and is unchanged; burning keeps its +3 joy an hour.
export const SKILL = {
  speedBasePct: 60, speedPerLvlPct: 7, xpBase: 1100, xpGrowthPermille: 1280, dailyFullTicks: 3600, dailyAfterPct: 30,
  passionPct: [50, 100, 115], learnPerWitsPct: 8, miningPerMightPct: 3, darkWorkPct: 80, toolPct: { bronze: 5, iron: 10, steel: 15 },
};
/** Quality rolls (5.8). */
export const QUALITY = { rollSdX100: 250, tierBonus: 1, legendaryMinLvl: 16, legendaryChancePct: 10 };
/** Pathing (12.3). */
export const PATH = { budgetPerTick: 8000, searchCapDiv: 2, leaderRepathTicks: 40 };
/** Threat points (9.2); rates in per mille. */
export const THREAT = {
  base: 40, min: 40, max: 4000, wealthKnee: 50000, wealthLoPermille: 8, wealthKneePts: 400, wealthHiPermille: 3,
  popPer: 14, popFree: 3, floorPerDay: 2, yearEndPts: 40, wallWealthPct: 50,
  // the floor's cap per difficulty (Stage 2.9b; raidplan.threatPoints): reached about day 110 (Hearthkeeper),
  // 160 (Warden), 210 (Steadfast); Hard has none
  floorMax: { hearthkeeper: 300, warden: 450, steadfast: 600 },
  lossAdjPct: 85, winAdjPct: 115, winAdjMaxPct: 130, maxPerRaid: 60, maxHostiles: 80, maxWarnH: 36,
  difficultyPct: { hearthkeeper: 35, warden: 70, steadfast: 100, hard: 140 },
  // Storyteller (9.1): tension 0-100; the scripted first major of a start (story.firstMajorD)
  tensionDecayPerDay: 8, pushBackTension: 60, tensionPerMajor: 40, tensionPerDeath: 20,
  firstOmenH: 18, firstArriveH: 21, firstRaidPts: 60,
  arriveH: { day: 10, dusk: 19, night: 21 },     // arrival hour by incident `arrive` ('any': a seeded hour)
  // Raids on the map (9.3): foe speed in world units per tick at speed 100
  foeSpeed: 2,
  // Hollow morale and the rout (EMBERCROWN-FORTRESS.md 2.10; threat/horde.js hollowMorale, Stage 2.9b):
  // a member lost costs max(lossPer, lossHalf / starting members) (a horde that loses half breaks), the
  // leader leadPct, and every lightSecs member-seconds in light lightLvl+ cost 1; at routAt it routs
  hollowMorale: { lossPer: 3, lossHalf: 150, leadPct: 30, lightLvl: 3, lightSecs: 10, routAt: 25 },
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
