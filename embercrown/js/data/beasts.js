// Wild beasts of the untamed zones (Phase 3, territory). They are not Hollow:
// they never join night waves (noWave), light does not burn them, and they
// keep to their lairs (e.guard), sleeping close by day and prowling wider at
// night. `wild: true` marks them for territory.js (pack bonus, webs, regen).
// Shapes match js/data/enemies.js so every weapon and card handles them.

export const BEASTS = {
  direwolf: {
    id: 'direwolf', name: 'Dire Wolf', color: '#7d7468', wild: true, noWave: true,
    desc: 'A grey pack hunter of the wild zones. Fast, and fiercer for every packmate at its side.',
    weak: 'Spearmen, the Beastmaster',
    hp: 58, dmg: 7, dmgType: 'blade', rate: 0.8, range: 0.7, speed: 2.4, aggro: 3,
    tags: ['beast'], cost: 99, radius: 7, prefers: 'living',
  },
  spider: {
    id: 'spider', name: 'Giant Spider', color: '#4a3e4e', wild: true, noWave: true,
    desc: 'A slow, bloated hunter that binds its prey in sticky web, slowing whatever it bites.',
    weak: 'Archers, fire',
    hp: 84, dmg: 6, dmgType: 'pierce', rate: 1.3, range: 0.8, speed: 0.95, aggro: 2.5,
    tags: ['beast'], cost: 99, radius: 8, prefers: 'living',
  },
  troll: {
    id: 'troll', name: 'Cave Troll', color: '#6f7a5e', wild: true, noWave: true,
    desc: 'A hulking brute of the deep caves. Its wounds knit closed as you watch: strike hard and fast.',
    weak: 'Massed soldiers, Militia mauls',
    hp: 270, dmg: 18, dmgType: 'crush', rate: 1.7, range: 0.9, speed: 0.8, aggro: 2,
    tags: ['beast', 'armored'], cost: 99, radius: 10, prefers: 'living',
  },
};

// The den itself: a stationary enemy structure, so squads, heroes and bounty
// flags can target it like any foe (the Hollow Rift works the same way).
export const LAIR_DEF = {
  id: 'lair', name: 'Beast Lair', color: '#4a3a2e', noWave: true, stationary: true,
  desc: 'A den of wild beasts that holds this land. Destroy it to claim the zone and plunder what lies inside.',
  weak: 'Any weapon: the den cannot fight back, but its guardians can',
  hp: 600, dmg: 0, dmgType: 'crush', rate: 99, range: 0, speed: 0, aggro: 0,
  tags: ['beast', 'lair'], cost: 99, radius: 16, prefers: 'any',
};

// Lair kinds: who guards it, and how its art reads.
export const LAIR_KINDS = {
  wolves: { id: 'wolves', name: 'Wolf Den', guards: ['direwolf'], weight: 3 },
  spiders: { id: 'spiders', name: 'Spider Nest', guards: ['spider', 'spider', 'direwolf'], weight: 2 },
  troll: { id: 'troll', name: 'Troll Cave', guards: ['troll', 'direwolf', 'direwolf'], weight: 1.5, minStep: 1 },
};

// Behaviour numbers for the beasts (territory.js reads these).
export const BEAST_RULES = {
  guardDay: 2.6,      // tiles: guard radius by day (they doze near the den)
  guardNight: 5,      // tiles: they hunt farther at night
  packBonus: 0.12,    // Dire Wolf: +damage per packmate within packRange
  packMax: 3,
  packRange: 3,       // tiles
  webSlow: 0.45,      // Giant Spider: movement lost while webbed
  webTime: 2.5,       // seconds
  trollRegen: 6,      // hp per second, always
  trollScale: 1.35,   // drawn (and hit) larger
};
