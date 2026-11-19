// Trader caravan types (doc 9.8; owner G, logic K). buyPct/sellPct: the price the colony pays and
// gets, as a percent of base value, before the Envoy's Social adjusts it.
// Stage 2 (14.8 row G): the Camp pedlar and the five Hamlet and Village caravans of 9.8. river: the
// caravan comes by barge and needs a river on the map.
export const DATA = {
  trader: [
    { id: 'pedlar', name: 'Pedlar', tier: 'camp', faction: 'league', sells: ['rawfood', 'cloth', 'tools', 'herbs', 'gems'], buys: ['goods', 'art', 'meals'],
      buyPct: 140, sellPct: 60, text: 'A lone pedlar with a mule: a little of everything, now and then a gem.' },
    { id: 'ironmonger', name: 'Ironmonger', tier: 'hamlet', faction: 'league', sells: ['ingots', 'tools', 'weapons', 'fuel'], buys: ['ore', 'gems', 'goods'],
      buyPct: 140, sellPct: 60, text: 'Metals, tools and weapons.' },
    { id: 'clothier', name: 'Clothier', tier: 'hamlet', faction: 'league', sells: ['cloth', 'leather', 'apparel', 'fibre'], buys: ['animal', 'goods', 'art'],
      buyPct: 140, sellPct: 60, text: 'Cloth, leather and clothes; buys hides, wool and fine work.' },
    { id: 'grainbarge', name: 'Grain barge', tier: 'hamlet', faction: 'league', sells: ['rawfood', 'preserved', 'drink', 'animal'], buys: ['goods', 'tools', 'ingots'],
      buyPct: 130, sellPct: 60, river: true, text: 'Comes up the river with grain, seed, salted food and livestock.' },
    { id: 'hunters', name: 'Hollow-hunter company', tier: 'hamlet', faction: 'hearthwatch', sells: ['weapons', 'armour', 'medicine'], buys: ['meals', 'preserved', 'drink', 'medicine'],
      buyPct: 150, sellPct: 60, text: 'Veterans of the watch: silver weapons and medicine, and a soldier for hire.' },
    { id: 'gembroker', name: 'Gem broker', tier: 'village', faction: 'league', sells: ['gems', 'art'], buys: ['art', 'gems', 'goods'],
      buyPct: 150, sellPct: 70, text: 'Gems and jewellery; pays well for art.' },
  ],
};
