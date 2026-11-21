// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)).
// Stage 2 (7.8, Camp to Village; floodgate and ore track are Stage 3). The Hearth's `levels` are its
// upgrades to Hearth levels 2 and 3 (the costs of tiers.js hearthLevel; validate-data checks they
// match). Mechanisms (B, 7.8): a lever links up to 4 lockable gates, doors and linkable traps; a
// pressure plate fires its links when a hostile steps on it.
// Z2.9 (F27, ranks not unlocks): no row has a `tier` gate. `band` is the rank a row was written for (a
// content label for menus and tests, never read by a placement gate); a row is paced by its materials,
// its `tech` and, for furniture, its recipe's minSkill (js/data/recipes.js). A row that must wait for an
// arrival (a noble's rooms) would keep `tier` with the `arrival` flag; none does yet.
export const DATA = {
  structure: [
    { id: 'hearth', name: 'The Hearth', cat: 'utility', kind: 'construct', size: [3, 3], hp: 3000, band: 'camp', claim: true, claimR: 14,
      light: { lvl: 3, r: 8, fuel: { k: 'wood', perDay: 10 } }, heat: 600, flags: ['start', 'unique', 'light'], art: 'struct.hearth', stage: '1a',
      levels: [
        { name: 'Banked', tech: 'masonry', cost: { block: 80, 'ingot:iron': 20 }, work: 600 },
        { name: 'Roaring', tech: 'steel', cost: { block: 120, 'ingot:steel': 30, 'ingot:silver': 20, cutgem: 2 }, work: 1200 },
      ],
      text: 'The heart of the hold: it claims land, lights the dark and fires on the Hollow at night. Bank it to reach Hamlet.' },
    { id: 'well', name: 'Well', cat: 'utility', kind: 'construct', size: [1, 1], cost: { block: 20 }, work: 90, hp: 300, band: 'camp',
      needs: ['nearWater'], mods: [{ key: 'fire.fight', op: 'pct', value: 100, when: 'near' }], art: 'struct.well', stage: '2',
      text: 'Firefighters within 15 tiles work twice as fast. A brewery and a bathhouse need one.' },
    // ---- Stage 2 ----
    { id: 'waystone', name: 'Waystone', cat: 'utility', kind: 'furniture', size: [1, 1], band: 'camp', claim: true, claimR: 9, beauty: 2,
      mods: [{ key: 'claim.blight', op: 'pct', value: -40, when: 'near' }], art: 'beacon', stage: '2',
      text: 'Claims land within 9 tiles and cleanses blight. Carved at a mason; the rank limits how many stand.' },
    { id: 'grave', name: 'Grave', cat: 'utility', kind: 'construct', size: [1, 2], cost: { wood: 5 }, work: 60, band: 'camp', cap: 1, flags: ['grave'], art: 'skull', stage: '2',
      text: 'A buried colonist rests here and will not rise. Mourners visit.' },
    { id: 'burial', name: 'Burial zone', cat: 'utility', kind: 'zone', size: [1, 1], band: 'camp', flags: ['burial'], art: 'overlay.dump', stage: '2',
      text: 'Graves are dug here, and the dead laid in it do not rise as Husks.' },
    { id: 'sarcophagus', name: 'Sarcophagus', cat: 'utility', kind: 'furniture', size: [1, 2], band: 'hamlet', cap: 1, beauty: 3, flags: ['grave'], art: 'skull', stage: '2',
      text: 'A carved stone tomb: mourners take comfort from it.' },
    { id: 'bellows', name: 'Bellows', cat: 'utility', kind: 'construct', size: [1, 1], cost: { wood: 20, leather: 6 }, work: 40, hp: 80, band: 'hamlet', tech: 'smithing', needs: ['nearForge'],
      flags: ['flammable'], mods: [{ key: 'work.smith', op: 'pct', value: 20, when: 'adjacent' }], art: 'flame', stage: '2',
      text: 'Beside a forge or bloomery: smithing 20% faster there (40% with a water wheel in range).' },
    { id: 'headframe', name: 'Mine headframe', cat: 'utility', kind: 'construct', size: [3, 3], cost: { wood: 100, block: 20 }, work: 300, hp: 600, band: 'hamlet', tech: 'supports', needs: ['tunnelMouth'],
      flags: ['storage', 'flammable'], store: { stacks: 6, cats: ['ore', 'fuel', 'stone', 'gems'] }, mods: [{ key: 'work.mine', op: 'pct', value: 10, when: 'near' }], art: 'pick', stage: '2',
      text: 'At a tunnel mouth: ore is hauled here, stone piles within 20 tiles count as stored, and miners within 20 work 10% faster.' },
    { id: 'crypt', name: 'Crypt', cat: 'utility', kind: 'construct', size: [3, 3], cost: { block: 160 }, work: 600, hp: 1200, band: 'village', tech: 'masonry2', cap: 8, needs: ['underground'],
      flags: ['grave', 'shell'], art: 'skull', stage: '2', text: 'A stone vault under the hold for eight of the dead.' },
    { id: 'waterwheel', name: 'Water wheel', cat: 'utility', kind: 'construct', size: [2, 1], cost: { wood: 60, 'ingot:iron': 10 }, work: 200, hp: 400, band: 'village', tech: 'waterworks',
      needs: ['riverEdge'], flags: ['flammable'], mods: [{ key: 'work.bench', op: 'pct', value: 25, when: 'near' }], art: 'wheel', stage: '2',
      text: 'On a river edge: benches within 6 tiles work 25% faster (bellows, mill, loom).' },
    { id: 'lever', name: 'Lever', cat: 'utility', kind: 'construct', size: [1, 1], cost: { 'ingot:iron': 6, wood: 5 }, work: 40, hp: 100, band: 'village', tech: 'mechanisms',
      flags: ['lever'], art: 'lock', stage: '2', text: 'Opens, closes and locks up to 4 linked gates and doors from afar. A locked gate is a wall to hostiles until broken.' },
    { id: 'plate', name: 'Pressure plate', cat: 'utility', kind: 'construct', size: [1, 1], cost: { 'ingot:iron': 4, block: 4 }, work: 40, hp: 100, band: 'village', tech: 'mechanisms',
      flags: ['plate'], art: 'lock', stage: '2', text: 'When a hostile steps on it, its linked deadfalls, ember pits and gates fire.' },
  ],
};
