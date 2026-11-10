// Phase 4 foes: six new enemies that make biomes, seasons and acts feel different.
// Shapes match js/data/enemies.js (hp, dmg, dmgType, rate, range, speed, aggro, tags,
// cost = wave-budget price, radius, prefers) so every weapon, card and the Codex handle
// them. They are kept out of the core wave roll (noWave) and joined to tonight's plan by
// js/game/systems/foes.js (BUS.wavePlan) using FOE_ROSTER below, which can read the
// region's biome, act and season (the core roll cannot). Behaviour numbers are in FOE_RULES.
//
// Damage-type reminders (MATCHUPS in balance.js): infantry takes +40% from arrows; spirit
// takes +80% fire, +30% magic, -40% arrows, -30% mauls; beast takes +120% from Spearmen.

export const FOES = {
  goblin: {
    id: 'goblin', name: 'Goblin Raider', color: '#7f9a3e', noWave: true,
    desc: 'A quick, greedy scavenger the Hollow has half-swallowed. It ignores your soldiers and runs for the nearest store (a House, Granary, Windmill, Market or the Hearth), grabs what it can carry and flees back the way it came, off the edge of the map. Kill it before it escapes and you get the loot back with a little extra. Walls stop it: it can only hack slowly at them.',
    debut: 'Goblin Raiders tonight: they steal from your stores and run for the map edge. Kill them to get the loot back.',
    weak: 'Archers, towers, fast Spearmen',
    hp: 22, dmg: 3, dmgType: 'blade', rate: 1.0, range: 0.7, speed: 2.1, aggro: 0,
    tags: ['hollow', 'infantry'], cost: 1.2, radius: 5, prefers: 'any',
  },
  riftspawner: {
    id: 'riftspawner', name: 'Riftspawner', color: '#6a4f8e', noWave: true,
    desc: 'A slow, bloated Hollow hauling a torn piece of the Rift on its back. Every few seconds the tear opens and two Husks crawl out beside it. Arrows sink deep into its swollen hide: shoot it first.',
    debut: 'A Riftspawner comes tonight: it births Husks as it walks. Arrows deal +50% to it. Kill it first.',
    weak: 'Archers and towers (arrows deal +50%)',
    hp: 180, dmg: 10, dmgType: 'crush', rate: 1.6, range: 0.9, speed: 0.6, aggro: 1.4,
    tags: ['hollow'], cost: 6, radius: 10, prefers: 'any', drawScale: 1.4,
  },
  wyvern: {
    id: 'wyvern', name: 'Ash Wyvern', color: '#8a5a48', noWave: true, flying: true,
    desc: 'A lean, grey-winged drake of the Hollow. It flies straight over your walls toward the Hearth and swoops to claw at the buildings in its path. Blades cannot reach it on the wing: arrows, bolts, towers and the Hearth can. While it dives to strike, every weapon can.',
    debut: 'Ash Wyverns tonight: they fly over walls and swoop on buildings. Archers and towers hit them in the air; melee only while they dive.',
    weak: 'Archers, towers; Spearmen while it dives',
    hp: 95, dmg: 11, dmgType: 'blade', rate: 1.3, range: 0.9, speed: 1.6, aggro: 0,
    tags: ['hollow', 'beast'], cost: 4.5, radius: 9, prefers: 'any', drawScale: 1.5,
  },
  bogwitch: {
    id: 'bogwitch', name: 'Bog Witch', color: '#5f7a4a', noWave: true,
    desc: 'A hunched hag of the drowned pools with a marsh-light lantern. She hexes from four tiles away, and her curse saps courage: your soldiers, heroes and the Sovereign deal 20% less damage while they stand within 3.5 tiles of her.',
    debut: 'A Bog Witch walks tonight: her curse cuts the damage of nearby soldiers by 20%. Towers and archers can out-range it.',
    weak: 'Towers, archers from range, fire',
    hp: 70, dmg: 9, dmgType: 'magic', rate: 2.0, range: 4, speed: 0.95, aggro: 4.5,
    tags: ['hollow'], cost: 3, radius: 7, prefers: 'living',
  },
  frostwraith: {
    id: 'frostwraith', name: 'Frost Wraith', color: '#a8d4ee', noWave: true,
    desc: 'A pale-blue ghost of the deep winter. Its freezing touch chills anyone it strikes: the victim moves 40% slower and attacks 25% slower for 3 seconds. Fire melts it (+80%); arrows find little to hit (-40%).',
    debut: 'Frost Wraiths ride the winter tonight: their touch slows your people and soldiers. Fire and magic melt them.',
    weak: 'Fire, Braziers, Mage Spires',
    hp: 60, dmg: 7, dmgType: 'magic', rate: 1.2, range: 0.8, speed: 1.35, aggro: 2.5,
    tags: ['hollow', 'spirit'], cost: 2.2, radius: 7, prefers: 'living',
  },
  ashimp: {
    id: 'ashimp', name: 'Ash Imp', color: '#e0602a', noWave: true,
    desc: 'A small, fast imp of glowing cinders that runs in packs of three. Born of fire, it takes half damage from fire. When it is slain it bursts for 10 fire damage, scorching your people, soldiers and buildings within about a tile (other Hollow are spared).',
    debut: 'Ash Imps run in packs tonight. They burst into flame when slain: keep your melee from crowding them. Fire barely hurts them.',
    weak: 'Archers, Spearmen at a distance (not fire)',
    hp: 20, dmg: 4, dmgType: 'fire', rate: 0.8, range: 0.7, speed: 2.2, aggro: 2.5,
    tags: ['hollow'], cost: 0.8, radius: 5, prefers: 'living',
  },
};

/** Behaviour numbers. Distances in tiles, times in seconds. */
export const FOE_RULES = {
  goblin: {
    stores: { hearth: 'any', granary: 'food', windmill: 'food', market: 'gold', house: 'gold' },
    // Loot per raid: base + perNight * region night, never more than maxShare of the stock.
    steal: { gold: [6, 1], food: [8, 2], wood: [8, 2], stone: [5, 1] },
    maxShare: 0.25,
    stealTime: 1,        // seconds spent rummaging at the store
    burdened: 0.85,      // speed while carrying loot
    bonus: 0.25,         // killed carrying loot: returned with this much extra (at least +2)
    minBonus: 2,
    reach: 0.6,          // tiles from a building's edge to steal from it
    direct: 4,           // tiles: run straight at the store when this close
    trailMax: 160,
  },
  riftspawner: {
    every: 7,            // seconds between births
    first: 3,            // first birth this long after it arrives
    brood: 2,            // Husks per birth
    aliveCap: 4,         // at most this many of its Husks alive at once
    lifeCap: 8,          // and this many in its whole life
    pierce: 1.5,         // arrows deal this much more
  },
  wyvern: {
    cruise: 22,          // flying height (world units)
    low: 9,              // below this it can be struck by melee
    dive: 0.5, climb: 0.6, // seconds
    strikes: 3,          // claws per swoop
    rest: 2,             // seconds of flight before it looks for the next target
    look: 5,             // tiles: swoops on buildings this close (ahead of it, toward the Hearth)
    reach: 0.4,          // tiles from a building's edge where it dives
  },
  bogwitch: { curse: 0.8, radius: 3.5 },
  frostwraith: { slow: 0.4, rate: 0.25, time: 3 },
  ashimp: { pack: 3, blast: 1.3, dmg: 10, bDmg: 10, fire: 0.5 },
};

// Who joins tonight's plan (systems/foes.js BUS.wavePlan). Each new foe is paid for by
// removing plain Husks (then Gloom Hounds) of equal wave-budget cost, so the night's size
// stays the same and the dusk telegraph shows the real roster. Each map-edge front rolls
// every eligible rule in turn (`chance` per front, at most `perNight` picks a night); a band
// the night cannot pay for shrinks (by whole packs) or is skipped. On a rule's `from` night a
// foe the run has not met yet is guaranteed once (not for `rare` rules). `from` = first region
// night (by act where an array: [act I, act II, act III+]). `biomes` maps biome -> chance
// multiplier (a Hollowed Ruins node counts as its act's land at half chance). `count(n, act)`
// = foes per pick, n = tonight's night number.
export const FOE_ROSTER = [
  { type: 'ashimp', biomes: { ashlands: 1 }, from: 1, chance: 0.7, count: (n) => FOE_RULES.ashimp.pack * Math.min(2, 1 + Math.floor(n / 3)) },
  { type: 'bogwitch', biomes: { elderwood: 1 }, from: 2, chance: 0.55, count: () => 1 },
  { type: 'frostwraith', season: 'winter', from: 2, chance: 0.6, count: (n) => Math.min(3, 1 + Math.floor(n / 2)) },
  { type: 'wyvern', minAct: 2, from: [99, 2, 2], chance: 0.4, count: (n, act) => (act >= 3 && n >= 4 ? 2 : 1), perNight: 2 },
  { type: 'riftspawner', from: [4, 3, 3], chance: 0.45, count: () => 1, perNight: [1, 1, 2] },
  { type: 'bogwitch', biomes: { greenvale: 1 }, from: 4, chance: 0.08, count: () => 1, perNight: 1, rare: true },
  { type: 'frostwraith', biomes: { elderwood: 1 }, from: 3, chance: 0.08, count: () => 1, perNight: 1, rare: true },
  { type: 'goblin', from: [4, 3, 3], chance: 0.3, count: (n) => Math.min(3, 1 + Math.floor(n / 4)) },
];

/** Hero experience per kill (merged into KILL_XP; the core gives 6 to anything unlisted). Husk 4, Knight 14. */
export const FOE_XP = { goblin: 5, riftspawner: 16, wyvern: 12, bogwitch: 9, frostwraith: 8, ashimp: 3 };

/** Land each act's Hollowed Ruins nodes stand in (for biome rules). */
export const ACT_BIOME = { 1: 'greenvale', 2: 'elderwood', 3: 'ashlands' };
