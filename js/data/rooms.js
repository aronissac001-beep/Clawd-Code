// Rooms: role detection, impressiveness tiers and room stamps (doc 7.11, 10.11; owner G, logic B).
// Roles match in `order` (lowest first); thoughts are the six tier thoughts (Squalid..Majestic).
// Stamps (14.6 slice: Bedroom, Store, Workshop, Plain room): walls, a door and floors, then the
// furnish list inside (a zone def paints that zone over the interior with the stamp's preset).
// Stage 2 (7.11; B's rooms with roles, stats and tiers): every Camp to Village role, the Cellar
// among them (casks or barrel racks underground; the Cooper's ageing comes with Stage 3 specs),
// and stamps for them. A stamp's `stage` is the build stage whose menus offer it (default 1a).
export const DATA = {
  room: [
    { id: 'infirmary', name: 'Infirmary', order: 10, match: { any: ['infirmary', 'surgery'] }, thoughts: [-4, 0, 1, 2, 3, 4],
      text: 'Infirmary beds or a surgery table. Its tier improves tending.' },
    { id: 'barracks', name: 'Barracks', order: 20, match: { any: ['bunk', 'barracks'], count: 2 }, thoughts: [-4, -2, 0, 1, 2, 3],
      text: 'Two bunks or more. Soldiers mind it less than others.' },
    { id: 'bedroom', name: 'Bedroom', order: 40, match: { any: ['bed', 'doublebed', 'cot', 'bedroll'], count: 1 }, thoughts: [-4, 0, 2, 4, 6, 8] },
    { id: 'dining', name: 'Dining hall', order: 50, match: { any: ['table', 'longtable'] }, thoughts: [-3, 0, 2, 4, 6, 9],
      text: 'A table and seats, and no beds.' },
    { id: 'kitchen', name: 'Kitchen', order: 60, match: { any: ['campfire', 'stove'] }, thoughts: [-2, 0, 1, 2, 3, 4],
      text: 'A campfire or a stove. A clean kitchen poisons fewer meals.' },
    { id: 'workshop', name: 'Workshop', order: 70, match: { workbench: true }, thoughts: [-2, 0, 1, 2, 3, 4],
      text: 'A workbench. Fine and better workshops add quality to what is made there.' },
    { id: 'cellar', name: 'Cellar', order: 75, match: { any: ['cask', 'barrelrack'], underground: true }, thoughts: [0, 0, 1, 2, 3, 4],
      text: 'Casks or barrel racks underground: food and drink keep cool.' },
    { id: 'storeroom', name: 'Storeroom', order: 80, match: { any: ['shelf', 'granary', 'stockpile', 'strongbox'] }, thoughts: [0, 0, 0, 1, 2, 3],
      text: 'Shelves or a stockpile over most of the floor.' },
    { id: 'temple', name: 'Temple', order: 85, match: { any: ['shrine', 'temple'] }, thoughts: [-2, 0, 2, 3, 4, 6], text: 'A shrine or a temple.' },
    { id: 'tavern', name: 'Tavern', order: 90, match: { any: ['dicetable', 'tavern', 'stage'] }, thoughts: [-2, 0, 2, 3, 5, 7], text: 'Games, music or a tap.' },
    { id: 'tomb', name: 'Tomb', order: 95, match: { any: ['grave', 'sarcophagus', 'crypt'] }, thoughts: [-3, -1, 0, 1, 2, 3], text: 'Where the dead lie.' },
    { id: 'hall', name: 'Hall', order: 100, match: { fallback: true } },
  ],
  roomTier: [
    { id: 'squalid', name: 'Squalid', min: 0 },
    { id: 'plain', name: 'Plain', min: 20 },
    { id: 'decent', name: 'Decent', min: 40 },
    { id: 'fine', name: 'Fine', min: 65 },
    { id: 'grand', name: 'Grand', min: 90 },
    { id: 'majestic', name: 'Majestic', min: 130 },
  ],
  stamp: [
    { id: 'bedroom', name: 'Bedroom', room: 'bedroom', minSize: 3, furnish: [{ def: 'bed' }] },
    { id: 'workshop', name: 'Workshop', room: 'workshop', minSize: 3, bench: true, furnish: [] },
    { id: 'store', name: 'Store', room: 'hall', minSize: 3, preset: 'all', furnish: [{ def: 'stockpile' }] },
    { id: 'plain', name: 'Plain room', room: 'hall', minSize: 3, furnish: [] },
    // Stage 2
    { id: 'dining', name: 'Dining hall', room: 'dining', minSize: 4, furnish: [{ def: 'table', per: 12 }, { def: 'chair', per: 6 }], stage: '2' },
    { id: 'kitchen', name: 'Kitchen', room: 'kitchen', minSize: 3, furnish: [{ def: 'campfire' }], stage: '2' },
    { id: 'barracks', name: 'Barracks', room: 'barracks', minSize: 4, furnish: [{ def: 'bunk', per: 8 }], stage: '2' },
    { id: 'storeroom', name: 'Storeroom', room: 'storeroom', minSize: 3, preset: 'all', furnish: [{ def: 'stockpile' }, { def: 'shelf', per: 6 }], stage: '2' },
    { id: 'foodstore', name: 'Food store', room: 'storeroom', minSize: 3, preset: 'store', furnish: [{ def: 'stockpile' }], stage: '2' },
    { id: 'infirmary', name: 'Infirmary', room: 'infirmary', minSize: 4, furnish: [{ def: 'infirmary', per: 8 }], stage: '2' },
    { id: 'cellar', name: 'Cellar', room: 'cellar', minSize: 3, furnish: [{ def: 'cask', per: 4 }], stage: '2' },
    { id: 'shrine', name: 'Shrine room', room: 'temple', minSize: 3, furnish: [{ def: 'shrine' }], stage: '2' },
  ],
};
