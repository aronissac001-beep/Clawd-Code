// The Ember Citadel: permanent upgrades bought with banked Embers between runs.
// kind 'unlock'   opens content tagged `unlock: '<id>'` (buildings, relics, hero
//                 classes) or a faction (u_<factionId>).
// kind 'passive'  a lasting bonus applied at run or region start (js/game/meta/citadel.js).
// kind 'cosmetic' a banner (heraldry colours) the realm may fly; pick it in the Citadel.
// Effect fields (read by js/game/meta/citadel.js):
//   start: { food, wood, stone, villagers }  added at every region start
//   gold          added to the run's starting gold
//   sovMaxHp      fraction: Sovereign max health
//   heroLevel     the starting hero begins at this level
//   draftFirst    extra options in the run's first blueprint draft
//   perkSlots     total perk slots once owned (highest wins)
//   emberMult     fraction: more Embers banked
//   sovRest       extra fraction of max health the Sovereign recovers between regions
//   blueprints    extra random blueprints known from the start of each run
//   soldierGuard  fraction: soldiers take less damage
//   mods          added to region modifiers (DEFAULT_MODS keys)
//   heraldry      { field, charge, second } banner colours
//   art           which piece of the Citadel picture it builds or lights

/** Upgrades in this tier need this many Citadel upgrades already built. */
export const TIER_GATE = { 1: 0, 2: 2, 3: 6, 4: 12 };
export const TIER_NAMES = { 1: 'Foundations', 2: 'Town', 3: 'Bastion', 4: 'Crown' };
/** Perk slots before any Perk Slot upgrade. */
export const BASE_PERK_SLOTS = 1;

export const CITADEL_UPGRADES = {
  // ---- Tier 1: Foundations -----------------------------------------------------------
  c_larder: {
    id: 'c_larder', name: 'Stocked Larder', tier: 1, cost: 50, requires: [], kind: 'passive', icon: 'food',
    text: 'Every region starts with +40 food.', start: { food: 40 }, art: 'larder',
  },
  c_timber: {
    id: 'c_timber', name: 'Timber Yard', tier: 1, cost: 50, requires: [], kind: 'passive', icon: 'wood',
    text: 'Every region starts with +40 wood.', start: { wood: 40 }, art: 'timber',
  },
  c_mint: {
    id: 'c_mint', name: 'Royal Mint', tier: 1, cost: 60, requires: [], kind: 'passive', icon: 'gold',
    text: 'Begin each run with +60 gold.', gold: 60, art: 'mint',
  },
  c_hardy: {
    id: 'c_hardy', name: 'Hardy Folk', tier: 1, cost: 80, requires: [], kind: 'passive', icon: 'pop',
    text: 'Every region starts with +1 villager.', start: { villagers: 1 }, art: 'cottages',
  },
  u_artisans: {
    id: 'u_artisans', name: "Artisans' Quarter", tier: 1, cost: 70, requires: [], kind: 'unlock', icon: 'hammer',
    text: 'Unlocks the Mine, Alchemist and Library blueprints.', art: 'workshop',
  },
  u_ranges: {
    id: 'u_ranges', name: 'Training Fields', tier: 1, cost: 80, requires: [], kind: 'unlock', icon: 'sword',
    text: 'Unlocks the Archery Range and Stable blueprints.', art: 'ranges',
  },
  c_banner_dawn: {
    id: 'c_banner_dawn', name: 'Banner of First Light', tier: 1, cost: 40, requires: [], kind: 'cosmetic', icon: 'banner',
    text: 'Fly a sky-blue and gold banner over your realms.',
    heraldry: { field: '#2c5f9e', charge: '#f2c14e', second: '#e8e0c8' }, art: 'banner',
  },

  // ---- Tier 2: Town ---------------------------------------------------------------------
  c_crownguard: {
    id: 'c_crownguard', name: 'Crown Guard', tier: 2, cost: 140, requires: [], kind: 'passive', icon: 'crown',
    text: 'The Ember-Sovereign has +15% max health.', sovMaxHp: 0.15, art: 'walls',
  },
  c_veteran: {
    id: 'c_veteran', name: 'Veteran Hero', tier: 2, cost: 160, requires: ['c_hardy'], kind: 'passive', icon: 'up',
    text: 'Your starting hero begins at level 2.', heroLevel: 2, art: 'barracks',
  },
  c_scholar: {
    id: 'c_scholar', name: "Scholar's Desk", tier: 2, cost: 120, requires: ['u_artisans'], kind: 'passive', icon: 'book',
    text: 'The first blueprint draft of each run offers +1 option.', draftFirst: 1, art: 'library',
  },
  c_slot2: {
    id: 'c_slot2', name: 'Perk Slot II', tier: 2, cost: 150, requires: [], kind: 'passive', icon: 'plus',
    text: 'Take 2 starting perks into each run instead of 1.', perkSlots: 2, art: 'towerL',
  },
  c_quarry: {
    id: 'c_quarry', name: 'Quarry Rights', tier: 2, cost: 120, requires: ['c_timber'], kind: 'passive', icon: 'stone',
    text: 'Every region starts with +30 stone.', start: { stone: 30 }, art: 'quarry',
  },
  c_shield: {
    id: 'c_shield', name: "Shieldwrights' Hall", tier: 2, cost: 180, requires: ['u_ranges'], kind: 'passive', icon: 'shield',
    text: 'Your soldiers take 10% less damage.', soldierGuard: 0.1, art: 'gatehouse',
  },
  u_faith: {
    id: 'u_faith', name: 'House of Vigil', tier: 2, cost: 150, requires: [], kind: 'unlock', icon: 'flame',
    text: 'Unlocks the Temple and Obelisk blueprints.', art: 'temple',
  },
  u_guild1: {
    id: 'u_guild1', name: "Heroes' Guild", tier: 2, cost: 180, requires: [], kind: 'unlock', icon: 'trophy',
    text: 'Skalds and Druids can be recruited at the Tavern.', art: 'guild1',
  },
  u_mirefolk: {
    id: 'u_mirefolk', name: 'Mire Embassy', tier: 2, cost: 200, requires: [], kind: 'unlock', icon: 'map',
    text: 'Unlocks the Mirefolk as a playable faction.', art: 'mire',
  },
  u_reliquary1: {
    id: 'u_reliquary1', name: 'Reliquary', tier: 2, cost: 160, requires: [], kind: 'unlock', icon: 'relic',
    text: 'Adds 7 new relics to events, ruins and merchants.', art: 'reliquary1',
  },
  c_banner_deep: {
    id: 'c_banner_deep', name: 'Banner of the Deep Forge', tier: 2, cost: 120, requires: [], kind: 'cosmetic', icon: 'banner',
    text: 'Fly a soot-black and copper banner over your realms.',
    heraldry: { field: '#2a2629', charge: '#d4793a', second: '#6b6f78' }, art: 'banner',
  },

  // ---- Tier 3: Bastion --------------------------------------------------------------------
  c_tithe: {
    id: 'c_tithe', name: 'Ember Tithe', tier: 3, cost: 300, requires: [], kind: 'passive', icon: 'flame',
    text: 'Bank +10% Embers at the end of every run.', emberMult: 0.1, art: 'braziers',
  },
  c_secondwind: {
    id: 'c_secondwind', name: 'Second Wind', tier: 3, cost: 260, requires: ['c_crownguard'], kind: 'passive', icon: 'heart',
    text: 'Between regions the Sovereign heals 50% of max health instead of 30%.', sovRest: 0.2, art: 'spring',
  },
  c_cache: {
    id: 'c_cache', name: 'Blueprint Cache', tier: 3, cost: 280, requires: ['c_scholar'], kind: 'passive', icon: 'book',
    text: 'Start each run knowing one extra random blueprint.', blueprints: 1, art: 'vault',
  },
  c_slot3: {
    id: 'c_slot3', name: 'Perk Slot III', tier: 3, cost: 380, requires: ['c_slot2'], kind: 'passive', icon: 'plus',
    text: 'Take 3 starting perks into each run.', perkSlots: 3, art: 'towerR',
  },
  c_hearthstone: {
    id: 'c_hearthstone', name: 'Hearthstone Keep', tier: 3, cost: 250, requires: [], kind: 'passive', icon: 'castle',
    text: 'Your Hearth has +20% health in every region.', mods: { hearthHp: 0.2 }, art: 'keep',
  },
  u_siege: {
    id: 'u_siege', name: 'Siege Engineers', tier: 3, cost: 300, requires: ['u_ranges'], kind: 'unlock', icon: 'tower',
    text: 'Unlocks the Siege Workshop blueprint.', art: 'siege',
  },
  u_palecourt: {
    id: 'u_palecourt', name: 'Bone Pact', tier: 3, cost: 350, requires: [], kind: 'unlock', icon: 'skull',
    text: 'Unlocks the Pale Court as a playable faction.', art: 'pale',
  },
  u_reliquary2: {
    id: 'u_reliquary2', name: 'Grand Reliquary', tier: 3, cost: 320, requires: ['u_reliquary1'], kind: 'unlock', icon: 'relic',
    text: 'Adds 7 more relics to events, ruins and merchants.', art: 'reliquary2',
  },
  u_guild2: {
    id: 'u_guild2', name: 'Masters of the Guild', tier: 3, cost: 300, requires: ['u_guild1'], kind: 'unlock', icon: 'trophy',
    text: 'Duelists and Frostwardens can be recruited at the Tavern.', art: 'guild2',
  },

  // ---- Tier 4: Crown ---------------------------------------------------------------------------
  u_wonders: {
    id: 'u_wonders', name: 'Hall of Wonders', tier: 4, cost: 650, requires: ['u_artisans', 'u_faith'], kind: 'unlock', icon: 'sun',
    text: 'Unlocks the Wonders: the Sunspire, the World Forge and the Moonwell.', art: 'wonder',
  },
  c_charter: {
    id: 'c_charter', name: "Founders' Charter", tier: 4, cost: 600, requires: [], kind: 'passive', icon: 'house',
    text: 'Every region starts with +1 villager and +30 food, wood and stone.', start: { villagers: 1, food: 30, wood: 30, stone: 30 }, art: 'hall',
  },
  c_banner_ash: {
    id: 'c_banner_ash', name: 'Banner of the Ashen Crown', tier: 4, cost: 500, requires: [], kind: 'cosmetic', icon: 'banner',
    text: 'Fly an ember-red and silver banner over your realms.',
    heraldry: { field: '#8e1f24', charge: '#ece6d6', second: '#2a2226' }, art: 'banner',
  },
};

export const CITADEL_LIST = Object.values(CITADEL_UPGRADES).sort((a, b) => a.tier - b.tier || a.cost - b.cost);
/** The unlock ids other modules tag content with. */
export const UNLOCK_IDS = ['u_mirefolk', 'u_palecourt', 'u_artisans', 'u_faith', 'u_ranges', 'u_siege', 'u_wonders', 'u_reliquary1', 'u_reliquary2', 'u_guild1', 'u_guild2'];
