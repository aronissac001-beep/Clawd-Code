// Phase 4 relics: 26 more run-long artifacts (45 in all) and two new relic sets.
// Same schema as js/data/relics.js. Effects that DEFAULT_MODS cannot express are
// implemented in js/game/systems/relics-p4.js, keyed by relic id and driven by the
// numbers in RP4 below (player text is built from the same numbers, so they cannot drift).
// `unlock` tags: u_reliquary1 / u_reliquary2 (Citadel); untagged relics drop from the start.

/** Tuning for every hook-driven relic effect (read by the relic system). */
export const RP4 = {
  killGold: 1,          // r4_tallyknife: gold per Hollow slain
  graveGold: 2,         // r4_gravespade: gold per Hollow slain (cursed)
  trainFaster: 0.25,    // r4_drillbook: training speed bonus
  wallCost: 0.6,        // r4_mortarpail: Wall and Gate cost multiplier
  towerLight: 2,        // r4_watchfire: tiles of combat light around each Watchtower
  firstNightCut: 0.25,  // r4_firstward: damage cut for your people on the first night
  salveDawn: true,      // r4_salve: soldiers fully healed at dawn
  heroXp: 0.25,         // r4_sagabook: extra kill experience for heroes
  moonGold: 75, moonStone: 50, // r4_moonhoard: paid at the dawn after a Blood Moon
  sightMult: 1.2,       // r4_crowfeather
  lifesteal: 2,         // r4_signet: Sovereign health per foe struck
  hearthLow: 0.4, hearthHeal: 0.4, // r4_threshold: once per region
  vanguardDmg: 0.2, vanguardRange: 3, // r4_vanguard
  sigilDmg: 0.15, sigilCut: 0.1,      // r4_sigil
  kegDiscount: 0.3,     // r4_keg: Tavern prices
  execDmg: 0.3, execBelow: 0.5,       // r4_headsman
  crownXp: 0.5, crownRegen: 2,        // r4_sagacrown
  everLitDmg: 0.15,     // r4_everwatch: lit Hollow take this much more (on top of the usual 25%)
  forgeCost: 0.9,       // r4_dawnforge: every building cost multiplier
  pactDmg: 0.35, pactDread: 3,        // r4_blackpact
  sagaRegen: 2, sagaXp: 0.25,         // The Saga set
};
const pct = (v) => `${Math.round(v * 100)}%`;
const R = RP4;

export const RELICS_P4 = {
  // ---- Common ------------------------------------------------------------------------------
  r4_tallyknife: {
    id: 'r4_tallyknife', name: 'Tallyman’s Knife', rarity: 'common', icon: 'gold', tags: ['coin'],
    text: `Gain ${R.killGold} gold for every Hollow slain.`,
  },
  r4_drillbook: {
    id: 'r4_drillbook', name: 'Drillmaster’s Daybook', rarity: 'common', icon: 'barracks', tags: ['war'],
    text: `Barracks and other halls train soldiers ${pct(R.trainFaster)} faster.`,
  },
  r4_seedpouch: {
    id: 'r4_seedpouch', name: 'Sower’s Seed Pouch', rarity: 'common', icon: 'farm', tags: ['harvest'],
    text: 'Start each region with 1 extra villager and +30 food.',
    start: { villagers: 1, food: 30 },
  },
  r4_stonecart: {
    id: 'r4_stonecart', name: 'Quarrier’s Handcart', rarity: 'common', icon: 'stone', tags: ['ward'],
    text: 'Start each region with +50 stone.',
    start: { stone: 50 },
  },
  r4_dawnbell: {
    id: 'r4_dawnbell', name: 'Cockcrow Bell', rarity: 'common', icon: 'sun', tags: ['coin'],
    text: 'Gain 10 more gold every dawn.',
    mods: { dawnGold: 10 },
  },
  r4_salve: {
    id: 'r4_salve', name: 'Field Surgeon’s Salve', rarity: 'common', icon: 'heart', tags: ['war'],
    text: 'Soldiers return to full health at every dawn.',
  },
  r4_firstward: {
    id: 'r4_firstward', name: 'Threshold Chalk', rarity: 'common', icon: 'shield', tags: ['ward'],
    text: `On each region’s first night, your people take ${pct(R.firstNightCut)} less damage.`,
  },
  r4_mortarpail: {
    id: 'r4_mortarpail', name: 'Bottomless Mortar Pail', rarity: 'common', icon: 'wall', tags: ['ward'], unlock: 'u_reliquary1',
    text: `Walls and Gates cost ${pct(1 - R.wallCost)} less to build and upgrade.`,
  },
  r4_sagabook: {
    id: 'r4_sagabook', name: 'Book of Small Sagas', rarity: 'common', icon: 'book', tags: ['hero'], unlock: 'u_reliquary1',
    text: `Heroes gain ${pct(R.heroXp)} more experience from kills.`,
  },
  r4_moonhoard: {
    id: 'r4_moonhoard', name: 'Red Moon Reliquary', rarity: 'common', icon: 'moon', tags: ['coin'], unlock: 'u_reliquary1',
    text: `At the dawn after each Blood Moon, gain ${R.moonGold} gold and ${R.moonStone} stone.`,
  },
  r4_crowfeather: {
    id: 'r4_crowfeather', name: 'Crow-Feather Charm', rarity: 'common', icon: 'eye', tags: [], unlock: 'u_reliquary2',
    text: `Your people and buildings see ${pct(R.sightMult - 1)} farther.`,
  },
  r4_watchfire: {
    id: 'r4_watchfire', name: 'Watchfire Oil', rarity: 'common', icon: 'tower', tags: ['light'], unlock: 'u_reliquary2',
    text: `Watchtowers light the ground within ${R.towerLight} tiles (lit Hollow take 25% more damage).`,
  },

  // ---- Rare -----------------------------------------------------------------------------------
  r4_signet: {
    id: 'r4_signet', name: 'Sanguine Signet', rarity: 'rare', icon: 'crown', tags: ['war'],
    text: `The Sovereign heals ${R.lifesteal} health for each foe it strikes.`,
  },
  r4_threshold: {
    id: 'r4_threshold', name: 'Ward of the Last Door', rarity: 'rare', icon: 'flame', tags: ['ward'],
    text: `Once per region, when the Hearth falls below ${pct(R.hearthLow)} health, it regains ${pct(R.hearthHeal)}.`,
  },
  r4_ledger: {
    id: 'r4_ledger', name: 'Gilded Ledger', rarity: 'rare', icon: 'gold', tags: ['coin'],
    text: 'House taxes and Market income +25%, and gain 15 more gold every dawn.',
    mods: { goldMult: 0.25, dawnGold: 15 },
  },
  r4_sigil: {
    id: 'r4_sigil', name: 'Sigil of Champions', rarity: 'rare', icon: 'sword', tags: ['hero'], unlock: 'u_reliquary1',
    text: `Heroes deal ${pct(R.sigilDmg)} more damage and take ${pct(R.sigilCut)} less.`,
  },
  r4_keg: {
    id: 'r4_keg', name: 'Bottomless Keg', rarity: 'rare', icon: 'house', tags: ['hero'], unlock: 'u_reliquary1',
    text: `Heroes at the Tavern ask ${pct(R.kegDiscount)} less gold to be hired.`,
  },
  r4_granarykey: {
    id: 'r4_granarykey', name: 'Granary Key', rarity: 'rare', icon: 'food', tags: ['harvest'], unlock: 'u_reliquary1',
    text: 'Food upkeep is 20% lower and farms grow 10% more food.',
    mods: { upkeep: -0.2, farmYield: 0.1 },
  },
  r4_headsman: {
    id: 'r4_headsman', name: 'Headsman’s Axe', rarity: 'rare', icon: 'axe', tags: ['war'], unlock: 'u_reliquary2',
    text: `Soldiers, heroes and the Sovereign deal ${pct(R.execDmg)} more damage to foes below half health.`,
  },
  r4_vanguard: {
    id: 'r4_vanguard', name: 'Standard of the Vanguard', rarity: 'rare', icon: 'banner', tags: ['war'], unlock: 'u_reliquary2',
    text: `Soldiers within ${R.vanguardRange} tiles of the Sovereign deal ${pct(R.vanguardDmg)} more damage.`,
  },

  // ---- Legendary -------------------------------------------------------------------------------
  r4_dawnforge: {
    id: 'r4_dawnforge', name: 'Heart of the Dawnforge', rarity: 'legendary', icon: 'hammer', tags: ['fire'],
    text: `Hearth bolts +6 damage. Every building and upgrade costs ${pct(1 - R.forgeCost)} less.`,
    mods: { hearthDmg: 6 },
  },
  r4_sagacrown: {
    id: 'r4_sagacrown', name: 'Crown of the Saga-Kings', rarity: 'legendary', icon: 'crown', tags: ['hero'], unlock: 'u_reliquary2',
    text: `Heroes gain ${pct(R.crownXp)} more experience from kills and heal ${R.crownRegen} health a second.`,
  },
  r4_everwatch: {
    id: 'r4_everwatch', name: 'Eye of the Everwatch', rarity: 'legendary', icon: 'sun', tags: ['light'], unlock: 'u_reliquary2',
    text: `Brazier and Hearth light reach 25% farther. Lit Hollow take ${pct(R.everLitDmg)} more damage.`,
    mods: { lightMult: 1.25 },
  },

  // ---- Cursed: a real upside paired with a real downside ----------------------------------------
  r4_gravespade: {
    id: 'r4_gravespade', name: 'Gravedigger’s Spade', rarity: 'cursed', icon: 'hoe', tags: ['coin', 'curse'],
    text: `Gain ${R.graveGold} gold for every Hollow slain, but Hollow deal 15% more damage.`,
    mods: { enemyDmg: 0.15 },
  },
  r4_hungerstone: {
    id: 'r4_hungerstone', name: 'Hungering Stone', rarity: 'cursed', icon: 'pick', tags: ['harvest', 'curse'], unlock: 'u_reliquary1',
    text: 'Builders, woodcutters and masons work 25% faster, but food upkeep is 30% higher.',
    mods: { buildSpeed: 0.25, chopSpeed: 0.25, upkeep: 0.3 },
  },
  r4_blackpact: {
    id: 'r4_blackpact', name: 'The Black Pact', rarity: 'cursed', icon: 'skull', tags: ['hero', 'curse'], unlock: 'u_reliquary2',
    text: `Heroes deal ${pct(R.pactDmg)} more damage, but Dread rises by ${R.pactDread} every night.`,
  },
};

/** New relic sets (pushed onto RELIC_SETS by register()). The Saga's effect lives in the relic system. */
export const RELIC_SETS_P4 = [
  {
    id: 'saga', name: 'The Saga', tag: 'hero', count: 3,
    text: `Heroes heal ${RP4.sagaRegen} health a second and gain ${pct(RP4.sagaXp)} more experience from kills.`,
  },
  {
    id: 'bulwark', name: 'The Bulwark', tag: 'ward', count: 3,
    text: 'Walls, Gates and the Hearth have 20% more health.',
    mods: { wallHp: 0.2, hearthHp: 0.2 },
  },
];
