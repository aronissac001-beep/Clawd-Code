// Prosperity tiers and Hearth levels (doc 8.4; owner G, logic K). File order is tier order.
// waystones -1 = unlimited. A tier is reached when wealth, colonists and Hearth level all hold for a day.
// Hearth levels: the Hearth structure def (structures/utility.js) lists the same costs as its upgrade
// `levels` (validate-data checks they match). Stage 2: levels 1-3. Level 4 (Brightflame) is built in Z2;
// there is no level 5 and no win state (EMBERCROWN-FORTRESS.md 1.4, 3.11). Tiers are prosperity ranks:
// Crownhold needs wealth, colonists and the Hearth only (no slain beast).
// Deviation from 8.4: Banked costs no rough gem (a Camp colony may have no gem vein in reach, and
// Hamlet needs Hearth level 2); the gems move to Roaring.
// Deviation from 8.4 (X 2.7 balance, bot v2 over seeds 1-5): Hamlet at 6,000 wealth (was 8,000) and Village
// at 20,000 (was 25,000). A careful 5-7 colonist hold has about 6,000 at day 25 and 20,000 by day 60-70
// (items at full value, buildings at half); at the doc's figures no seed reached Hamlet by day 25 or
// Village by day 70 (14.8 G).
export const DATA = {
  tier: [
    { id: 'camp', name: 'Camp', abbr: 'C', i: 0, wealth: 0, colonists: 0, hearth: 1, waystones: 1, text: 'Kindling era, small Hollow hordes, beasts and thieves.' },
    { id: 'hamlet', name: 'Hamlet', abbr: 'H', i: 1, wealth: 6000, colonists: 5, hearth: 2, waystones: 3, text: 'Hearth era, caravans and reavers.' },
    { id: 'village', name: 'Village', abbr: 'V', i: 2, wealth: 20000, colonists: 9, hearth: 2, waystones: 6, text: 'Hold era, sappers, migrant groups and Rifts.' },
    { id: 'hold', name: 'Hold', abbr: 'Ho', i: 3, wealth: 70000, colonists: 14, hearth: 3, waystones: 10, text: 'Crown era, sieges and breaches from the deep.' },
    { id: 'stronghold', name: 'Stronghold', abbr: 'S', i: 4, wealth: 160000, colonists: 20, hearth: 4, waystones: 16, text: 'A name in the vale: larger raids and richer visitors.' },
    { id: 'crownhold', name: 'Crownhold', abbr: 'Cr', i: 5, wealth: 350000, colonists: 26, hearth: 4, waystones: -1, text: 'The crown of the vale. There is no end here, only the years to come.' },
  ],
  hearthLevel: [
    { id: 'kindled', name: 'Kindled', lvl: 1, light: { lvl: 3, r: 8 }, claim: 14, shot: { dmg: 6, every: 30, targets: 1 }, text: 'Warms 6 tiles around it.' },
    { id: 'banked', name: 'Banked', lvl: 2, cost: { block: 80, 'ingot:iron': 20 }, light: { lvl: 3, r: 10 }, claim: 16, shot: { dmg: 9, every: 30, targets: 1 },
      text: 'Dread is one level lower within 20 tiles.' },
    { id: 'roaring', name: 'Roaring', lvl: 3, cost: { block: 120, 'ingot:steel': 30, 'ingot:silver': 20, cutgem: 2 }, light: { lvl: 3, r: 12 }, claim: 18,
      shot: { dmg: 14, every: 30, targets: 2 }, text: 'Grey taint is cured twice as fast by rest within 12 tiles. Needed for the Hold tier.' },
  ],
};
