// Combat numbers (doc 6.6, 9.2, 9.3, 9.5). Owner H. Provisional: the raider rows move to
// js/data/raiders.js once the C11 raider schema (G, js/data/schema.js) takes the fields below, and
// COMBAT moves to balance.js THREAT. Until then they live here so no data file carries an unknown field.
//
// Units: speed in world units per tick (TILE = 32; a colonist walks 5 on plain ground), reach and
// distances in world units unless named in tiles, `every` in ticks between blows (20 ticks = 1 s
// at 1x), dmg in hit points (colonist parts: PART_HP; foes: raider hp).
// Raider fields: speed, dmg, kind (wound kind), every, reach, aggro and leash (tiles), hit (percent),
// smash (breaks walls and doors in its way), tier (the colony tier index it first comes at: 0 Camp,
// 1 Hamlet, 2 Village, 3 Hold), ranged (keeps its distance; shots, not blows), dig (digs rock: the
// sapper's 4x-slower-than-a-miner rate, sappers.js), steal (grabs a stack and runs, thieves.js),
// still (never moves: the Rift), compose (false: never drawn by the composer), gear (the item it
// drops when it falls: loot, 9.5), elite (a leader that may be named a nemesis, 9.10).

const R = (o) => Object.freeze({ speed: 2, dmg: 4, kind: 'cut', every: 30, reach: 28, aggro: 3, leash: 3, hit: 60, smash: false, tier: 0, ranged: false, dig: false, steal: false, still: false, compose: true, gear: null, ...o });

/** Per raider id. Husks swarm the Hearth; Gloom Hounds hunt colonists outside (9.3). */
export const FOE_STATS = Object.freeze({
  husk: R({ speed: 2, dmg: 4, kind: 'cut', every: 30, reach: 28, aggro: 3, leash: 3, hit: 60, smash: true }),
  swift_husk: R({ speed: 3, dmg: 4, kind: 'cut', every: 24, reach: 28, aggro: 4, leash: 3, hit: 60, smash: true, tier: 0 }),
  gloom_hound: R({ speed: 4, dmg: 4, kind: 'bite', every: 20, reach: 26, aggro: 7, leash: 4, hit: 60, smash: false }),
  shade: R({ speed: 3, dmg: 6, kind: 'cut', every: 26, reach: 28, aggro: 5, leash: 4, hit: 65, smash: false, tier: 1 }),
  hollow_knight: R({ speed: 2, dmg: 9, kind: 'blunt', every: 34, reach: 32, aggro: 4, leash: 3, hit: 65, smash: true, tier: 2 }),
  rift: R({ speed: 0, dmg: 0, kind: 'taint', every: 999, reach: 0, aggro: 0, leash: 0, hit: 0, still: true, compose: false, tier: 2 }),
  gutter_thief: R({ speed: 4, dmg: 3, kind: 'cut', every: 22, reach: 26, aggro: 2, leash: 2, hit: 55, steal: true }),
  delver: R({ speed: 2, dmg: 6, kind: 'blunt', every: 24, reach: 28, aggro: 3, leash: 3, hit: 65, smash: true, dig: true, tier: 2, gear: 'pick' }),
  reaver_club: R({ speed: 3, dmg: 6, kind: 'blunt', every: 24, reach: 30, aggro: 7, leash: 5, hit: 65, smash: true, tier: 1, gear: 'club' }),
  reaver_spear: R({ speed: 3, dmg: 8, kind: 'stab', every: 26, reach: 46, aggro: 7, leash: 5, hit: 65, smash: true, tier: 1, gear: 'spear' }),
  reaver_bow: R({ speed: 3, dmg: 6, kind: 'stab', every: 30, reach: 224, aggro: 9, leash: 4, hit: 55, ranged: true, tier: 1, gear: 'shortbow' }),
  reaver_xbow: R({ speed: 3, dmg: 11, kind: 'stab', every: 46, reach: 256, aggro: 10, leash: 4, hit: 60, ranged: true, tier: 2, gear: 'crossbow' }),
  reaver_captain: R({ speed: 3, dmg: 10, kind: 'cut', every: 24, reach: 32, aggro: 8, leash: 6, hit: 70, smash: true, tier: 1, gear: 'sword', elite: true, compose: false }),
  wolf: R({ speed: 4, dmg: 5, kind: 'bite', every: 22, reach: 26, aggro: 9, leash: 6, hit: 60 }),
  boar: R({ speed: 3, dmg: 7, kind: 'stab', every: 28, reach: 28, aggro: 6, leash: 5, hit: 60 }),
  cave_spider: R({ speed: 3, dmg: 5, kind: 'bite', every: 24, reach: 26, aggro: 6, leash: 5, hit: 60, tier: 1 }),
  great_spider: R({ speed: 3, dmg: 12, kind: 'bite', every: 30, reach: 32, aggro: 8, leash: 6, hit: 65, tier: 2, elite: true, compose: false }),
});
export const foeStats = (kind) => FOE_STATS[kind] || FOE_STATS.husk;

/** Affixes (9.2 warden, 9.10 nemesis returns): hp, damage and speed percents; burning sets fires. */
export const AFFIX_FX = Object.freeze({
  warden: Object.freeze({ hpPct: 160, dmgPct: 125, speedPct: 100 }),
  armoured: Object.freeze({ hpPct: 140, dmgPct: 100, speedPct: 100, armourPct: 70 }),
  swift: Object.freeze({ hpPct: 100, dmgPct: 100, speedPct: 140 }),
  rallying: Object.freeze({ hpPct: 110, dmgPct: 110, speedPct: 100 }),
  burning: Object.freeze({ hpPct: 110, dmgPct: 120, speedPct: 100 }),
});
/** Combined affix multipliers (percent) of a foe (foe.st.aff). */
export function affixPct(f, field) {
  const a = f && f.st && f.st.aff;
  if (!a || !a.length) return 100;
  let v = 100;
  for (const x of a) { const fx = AFFIX_FX[x]; if (fx && fx[field] !== undefined) v = Math.floor((v * fx[field]) / 100); }
  return v;
}
/** The foe's move speed now (affixes; a fleeing thief runs a little faster). */
export const foeSpeed = (f) => { const st = foeStats(f.kind); return (st.speed * affixPct(f, 'speedPct')) / 100; };

/**
 * Colonist weapons by item kind (col.gear.slots.weapon). The data row's `weapon` (items.js: dmg, speed
 * percent, reach in tenths of a tile) wins when present; these are the 1b defaults and bare hands.
 * every = 2300 / speed (ticks), reach = tenths x 3.2 world units; reach 30+ tenths is a ranged weapon.
 */
export const WEAPONS = Object.freeze({
  fists: Object.freeze({ dmg: 6, kind: 'blunt', every: 20, reach: 38 }),
  spear: Object.freeze({ dmg: 10, kind: 'stab', every: 26, reach: 50 }),
});

export const COMBAT = Object.freeze({
  hitBasePct: 60, hitPerLvlPct: 3, hitMaxPct: 95,  // colonist hit chance: base + Melee level x per, capped
  dmgPerLvl: 4,                                     // +1 damage per this many Melee levels
  xpPerSwing: 26,                                   // Melee XP (work ticks) per swing
  colSpeed: 5,                                      // a drafted colonist closing in (world units per tick)
  holdAggro: 4, holdLeash: 6,                       // tiles: a holding colonist steps out to foes this near its spot, never farther than leash
  chaseTiles: 6,                                    // an Attack order closes in directly within this (with line of sight), else re-paths
  chaseEvery: 40,                                   // ticks between re-paths of an Attack order
  retarget: 5,                                      // ticks between a foe's target searches (staggered by id)
  coldHearthPct: 125,                               // the Hollow hit 25% harder while the Hearth is cold (8.4)
  sunPctPerSec: 3,                                  // dawn: Hollow on unroofed tiles lose 3% max hp a second (9.3)
  hearthMinHp: 1,                                   // the Hearth cannot be broken (blows only scar it)
  partWeights: Object.freeze([10, 40, 12, 12, 13, 13]), // head, torso, larm, rarm, lleg, rleg (PART_IDS order)
  // Stage 2
  coverPct: 60,                                     // ranged hits on a colonist in cover (beside a barricade, wall or embrasure): x0.6 (9.5: -40%)
  towerCoverPct: 50, towerRangeTiles: 3,            // a colonist on a tower: ranged hits on them x0.5, +3 tiles of range
  guardTiles: 6,                                    // a Guard order defends this radius around its spot
  rangedHitPct: 55,                                 // a colonist's ranged base hit chance (+ Shooting level x hitPerLvlPct)
  beastPct: 150,                                    // spears x1.5 against beasts (6.6)
  captureDownPct: 40,                               // a reaver brought to 0 hp is downed (capturable) this often
  fleeHpPct: 25,                                    // an elite or nemesis below this share of hp breaks off and flees
  moraleBreak: 50,                                  // a reaver warband flees below this morale (50% losses, or the captain down)
});
