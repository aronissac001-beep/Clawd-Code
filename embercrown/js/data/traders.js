// Trader caravan types (doc 9.8; owner G, logic K). buyPct/sellPct: the price the colony pays and
// gets, as a percent of base value, before the Envoy's Social adjusts it.
export const DATA = {
  trader: [
    { id: 'pedlar', name: 'Pedlar', tier: 'camp', faction: 'league', sells: ['rawfood', 'cloth', 'tools'], buys: ['goods', 'art', 'meals'],
      buyPct: 140, sellPct: 60, text: 'A lone pedlar with a mule: a little of everything.' },
    { id: 'ironmonger', name: 'Ironmonger', tier: 'hamlet', faction: 'league', sells: ['ingots', 'tools', 'weapons'], buys: ['ore', 'gems', 'goods'],
      buyPct: 140, sellPct: 60, text: 'Metals, tools and weapons.' },
  ],
};
