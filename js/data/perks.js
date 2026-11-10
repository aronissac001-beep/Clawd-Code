// Starting perks: chosen on the New Realm screen (Campaign and Endless), one per
// perk slot (1 at first; the Citadel's Perk Slot II and III raise it to 3).
// `requires` names a Citadel upgrade that unlocks the perk; without it the perk
// is available from the start. Effect fields (applied by js/game/meta/citadel.js):
//   mods     added to every region's modifiers (DEFAULT_MODS keys)
//   start    added at every region start { food, wood, stone, villagers, caches }
//   gold     added to the run's starting gold
//   relic    rarity of a relic granted at run start
//   militia  soldiers of this type join every region at the Hearth (militiaCount of them)
//   herbal   health per second regained by soldiers with no Hollow nearby
//   shopMult merchant price multiplier (needs the shop integration; hidden until present)
export const PERKS = {
  quartermaster: {
    id: 'quartermaster', name: 'Quartermaster', icon: 'relic',
    text: 'Start the run with a random common relic.', relic: 'common',
  },
  ironwood: {
    id: 'ironwood', name: 'Ironwood Tools', icon: 'hammer',
    text: 'Builders work 15% faster.', mods: { buildSpeed: 0.15 },
  },
  militia_levy: {
    id: 'militia_levy', name: 'Militia Levy', icon: 'shield',
    text: 'Every region begins with a free squad of 3 Militia at the Hearth.', militia: 'militia', militiaCount: 3,
  },
  night_watch: {
    id: 'night_watch', name: 'Night Watch', icon: 'tower',
    text: 'Watchtowers and Ballistae have +1 range.', mods: { towerRange: 1 },
  },
  full_granary: {
    id: 'full_granary', name: 'Full Granary', icon: 'food',
    text: 'Every region starts with +60 food.', start: { food: 60 },
  },
  treasury_writ: {
    id: 'treasury_writ', name: 'Treasury Writ', icon: 'gold',
    text: 'Begin the run with +70 gold.', gold: 70,
  },
  bright_braziers: {
    id: 'bright_braziers', name: 'Bright Braziers', icon: 'brazier',
    text: 'Braziers light ground 1 tile farther.', mods: { lightRadius: 1 },
  },
  pathfinder: {
    id: 'pathfinder', name: 'Pathfinder', icon: 'eye',
    text: 'Every region hides 2 extra supply caches in the fog.', start: { caches: 2 },
  },
  lucky_star: {
    id: 'lucky_star', name: 'Lucky Star', icon: 'sun', requires: 'c_scholar',
    text: '+1 option in every blueprint draft and Dawn Offering.', mods: { draftExtra: 1 },
  },
  herbalist: {
    id: 'herbalist', name: 'Herbalist', icon: 'heart', requires: 'u_faith',
    text: 'Wounded soldiers heal 2 health per second while no Hollow is within 4 tiles.', herbal: 2,
  },
  drillmaster: {
    id: 'drillmaster', name: 'Drillmaster', icon: 'sword', requires: 'u_ranges',
    text: 'Soldiers deal 12% more damage.', mods: { soldierDmg: 0.12 },
  },
  stonewright: {
    id: 'stonewright', name: 'Stonewright', icon: 'wall', requires: 'c_quarry',
    text: 'Walls and Gates have +30% health, and every region starts with +30 stone.', mods: { wallHp: 0.3 }, start: { stone: 30 },
  },
  heartfire: {
    id: 'heartfire', name: 'Heartfire', icon: 'nova', requires: 'c_crownguard',
    text: 'Heartflame Nova deals 25% more damage and recharges 8 s sooner.', mods: { novaDmg: 0.25, novaCd: 8 },
  },
  tax_collector: {
    id: 'tax_collector', name: 'Tax Collector', icon: 'house', requires: 'u_artisans',
    text: 'House taxes and Market income +20%.', mods: { goldMult: 0.2 },
  },
  merchant_friend: {
    id: 'merchant_friend', name: 'Merchant Friend', icon: 'merchant', requires: 'c_mint',
    text: 'Merchant Caravan prices are 15% lower.', shopMult: 0.85,
  },
};
export const PERK_LIST = Object.values(PERKS);
