// Prosperity tiers and Hearth levels (doc 8.4; owner G, logic K). File order is tier order.
// waystones -1 = unlimited. A tier is reached when wealth, colonists and Hearth level all hold for a day.
export const DATA = {
  tier: [
    { id: 'camp', name: 'Camp', abbr: 'C', i: 0, wealth: 0, colonists: 0, hearth: 1, waystones: 1, text: 'Kindling era, small Hollow hordes, beasts and thieves.' },
    { id: 'hamlet', name: 'Hamlet', abbr: 'H', i: 1, wealth: 8000, colonists: 5, hearth: 2, waystones: 3, text: 'Hearth era, the first charter, caravans and reavers.' },
    { id: 'village', name: 'Village', abbr: 'V', i: 2, wealth: 25000, colonists: 9, hearth: 2, waystones: 6, text: 'Hold era, sappers, migrant groups and Rifts.' },
    { id: 'hold', name: 'Hold', abbr: 'Ho', i: 3, wealth: 70000, colonists: 14, hearth: 3, waystones: 10, text: 'Crown era, sieges, breaches from the deep, the Gloomwyrm.' },
    { id: 'stronghold', name: 'Stronghold', abbr: 'S', i: 4, wealth: 160000, colonists: 20, hearth: 4, waystones: 16, text: 'The second charter and the Bone Colossus.' },
    { id: 'crownhold', name: 'Crownhold', abbr: 'Cr', i: 5, wealth: 350000, colonists: 26, hearth: 4, waystones: -1, lord: true, text: 'The Hollow King and the Great Hearth.' },
  ],
  hearthLevel: [
    { id: 'kindled', name: 'Kindled', lvl: 1, light: { lvl: 3, r: 8 }, claim: 14, shot: { dmg: 6, every: 30, targets: 1 }, text: 'Warms 6 tiles around it.' },
    { id: 'banked', name: 'Banked', lvl: 2, cost: { block: 80, 'ingot:iron': 20 }, light: { lvl: 3, r: 10 }, claim: 16, shot: { dmg: 9, every: 30, targets: 1 },
      text: 'Dread is one level lower within 20 tiles.' },
  ],
};
