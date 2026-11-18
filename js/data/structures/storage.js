// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
// Stage 2 (7.4): shelves, racks and storehouses carry `store` (stacks held, categories taken, rot
// percent, theft slowdown; E's stockpiles read it). An icon stands in as art until D registers struct.<id>.
export const DATA = {
  structure: [
    { id: 'stockpile', name: 'Stockpile', cat: 'storage', kind: 'zone', size: [1, 1], tier: 'camp', art: 'overlay.stockpile', stage: '1a',
      text: 'Filtered storage. Pick a preset; Customise opens the full filter.' },
    { id: 'dump', name: 'Dumping zone', cat: 'storage', kind: 'zone', size: [1, 1], tier: 'camp', beauty: -2, art: 'overlay.dump', stage: '2',
      text: 'Takes chunks, rubble and corpses.' },
    // ---- Stage 2 ----
    { id: 'shelf', name: 'Shelf', cat: 'storage', kind: 'furniture', size: [1, 1], tier: 'camp', flags: ['storage'], store: { stacks: 3 }, art: 'crate', stage: '2',
      text: 'Holds 3 stacks on one tile. Stands inside a stockpile and takes its filter.' },
    { id: 'barrelrack', name: 'Barrel rack', cat: 'storage', kind: 'construct', size: [2, 1], cost: { wood: 30 }, work: 60, hp: 150, tier: 'hamlet', tech: 'brewing',
      flags: ['storage', 'flammable'], store: { stacks: 4, cats: ['food'], rotPct: 66 }, art: 'crate', stage: '2', text: 'Four stacks of food or drink; they keep half again as long.' },
    { id: 'granary', name: 'Granary', cat: 'storage', kind: 'construct', size: [3, 3], cost: { wood: 80, block: 30 }, work: 300, hp: 600, tier: 'hamlet',
      flags: ['storage', 'shell'], store: { stacks: 12, cats: ['rawfood', 'preserved'], rotPct: 50, vermin: true }, art: 'house', stage: '2',
      text: 'Twelve stacks of raw and preserved food: rot halved, and vermin cannot get in.' },
    { id: 'weaponrack', name: 'Armoury rack', cat: 'storage', kind: 'construct', size: [2, 1], cost: { wood: 30, 'ingot:iron': 4 }, work: 60, hp: 200, tier: 'hamlet',
      flags: ['storage'], store: { stacks: 6, cats: ['weapons', 'armour', 'apparel'] }, art: 'shield', stage: '2',
      text: 'Six weapons, armour or clothes. Colonists swap to their outfit here.' },
    { id: 'strongbox', name: 'Strongbox', cat: 'storage', kind: 'construct', size: [1, 1], cost: { block: 20, ironbands: 2 }, work: 60, hp: 500, tier: 'village', tech: 'masonry2',
      flags: ['storage'], store: { stacks: 4, cats: ['gems', 'coins', 'art', 'goods'], theftPct: 300 }, art: 'lock', stage: '2',
      text: 'Four stacks of valuables. Thieves need three times as long to open it.' },
    { id: 'icehouse', name: 'Ice house', cat: 'storage', kind: 'construct', size: [3, 3], cost: { block: 120 }, work: 480, hp: 800, tier: 'village', needs: ['underground'],
      flags: ['storage', 'shell'], store: { stacks: 12, cats: ['food'], rotPct: 0 }, art: 'house', stage: '2', text: 'Dug deep and packed cold: food in it never rots.' },
  ],
};
