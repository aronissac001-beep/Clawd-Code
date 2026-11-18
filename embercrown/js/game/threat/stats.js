// Combat numbers for Stage 1b (doc 9.2, 9.3, 9.5). Owner H. Provisional: the raider rows move to
// js/data/raiders.js once the C11 raider schema (G, js/data/schema.js) takes the fields
// speed / dmg / kind / every / reach / aggro / leash / hit / smash, and COMBAT moves to balance.js
// THREAT. Until then they live here so no data file carries an unknown field.
//
// Units: speed in world units per tick (TILE = 32; a colonist walks 5 on plain ground), reach and
// distances in world units unless named in tiles, `every` in ticks between blows (20 ticks = 1 s
// at 1x), dmg in hit points (colonist parts: PART_HP; foes: raider hp).

/** Per raider id. Husks swarm the Hearth; Gloom Hounds hunt colonists outside (9.3). */
export const FOE_STATS = Object.freeze({
  husk: Object.freeze({ speed: 2, dmg: 4, kind: 'cut', every: 30, reach: 28, aggro: 3, leash: 3, hit: 60, smash: true }),
  gloom_hound: Object.freeze({ speed: 4, dmg: 4, kind: 'bite', every: 20, reach: 26, aggro: 7, leash: 4, hit: 60, smash: false }),
  delver: Object.freeze({ speed: 2, dmg: 6, kind: 'blunt', every: 24, reach: 28, aggro: 3, leash: 3, hit: 65, smash: true }),
});
export const foeStats = (kind) => FOE_STATS[kind] || FOE_STATS.husk;

/** Colonist weapons by item kind (col.gear.slots.weapon); bare hands otherwise. */
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
  hearthMinHp: 1,                                   // the Hearth cannot be broken in 1b (blows only scar it)
  partWeights: Object.freeze([10, 40, 12, 12, 13, 13]), // head, torso, larm, rarm, lleg, rleg (PART_IDS order)
});
