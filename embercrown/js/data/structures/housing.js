// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
// Stage 2 (7.2, Camp to Village): an icon stands in as `art` until D registers struct.<id>; the
// renderer then draws struct.<id> on its own (art/index.js installKit falls back to the def id).
// Rest speed: mods need.rest.restore (percent); comfort is a percent (100 = a chair's 1.0).
export const DATA = {
  structure: [
    { id: 'bed', name: 'Bed', cat: 'housing', kind: 'furniture', size: [1, 2], tier: 'camp', comfort: 80, roomRole: 'bedroom', cap: 1,
      flags: ['bed'], art: 'struct.bed', stage: '1a', text: 'Rest at full speed. One bed makes a bedroom. Wood from a carpenter, stone from a mason.' },
    { id: 'hut', name: 'Cottage', cat: 'housing', kind: 'construct', size: [3, 3], cost: { wood: 60 }, work: 240, hp: 400, tier: 'camp', tech: 'roofing',
      flags: ['shell', 'flammable'], art: 'struct.hut', stage: '2', text: 'A walled and roofed room with a door: quick housing for the first nights.' },
    // ---- Stage 2 ----
    { id: 'bedroll', name: 'Bedroll', cat: 'housing', kind: 'furniture', size: [1, 1], tier: 'camp', comfort: 40, roomRole: 'bedroom', cap: 1, flags: ['bed', 'flammable'],
      mods: [{ key: 'need.rest.restore', op: 'pct', value: -20 }], art: 'bed', stage: '2', text: 'Rest at 80% speed. Better than the bare ground.' },
    { id: 'cot', name: 'Cot', cat: 'housing', kind: 'furniture', size: [1, 2], tier: 'camp', comfort: 60, roomRole: 'bedroom', cap: 1, flags: ['bed', 'flammable'],
      mods: [{ key: 'need.rest.restore', op: 'pct', value: -10 }], art: 'bed', stage: '2', text: 'Rest at 90% speed. A wooden frame off the floor.' },
    { id: 'doublebed', name: 'Double bed', cat: 'housing', kind: 'furniture', size: [2, 2], tier: 'hamlet', comfort: 90, roomRole: 'bedroom', cap: 2, flags: ['bed'],
      art: 'bed', stage: '2', text: 'Two sleepers. Spouses want to share one.' },
    { id: 'bunk', name: 'Bunk', cat: 'housing', kind: 'furniture', size: [1, 2], tier: 'hamlet', comfort: 60, roomRole: 'barracks', cap: 2, flags: ['bed', 'flammable'],
      art: 'bed', stage: '2', text: 'Two sleepers stacked. Two bunks make a barracks.' },
    { id: 'wardrobe', name: 'Wardrobe', cat: 'housing', kind: 'furniture', size: [1, 1], tier: 'hamlet', beauty: 2, comfort: 10, flags: ['flammable'],
      art: 'crate', stage: '2', text: 'Raises the comfort and beauty of a bedroom.' },
    { id: 'endtable', name: 'End table', cat: 'housing', kind: 'furniture', size: [1, 1], tier: 'hamlet', beauty: 1, flags: ['table'],
      mods: [{ key: 'need.rest.restore', op: 'pct', value: 5, when: 'adjacent' }], art: 'table', stage: '2', text: 'Beside a bed: rest 5% faster in it.' },
    { id: 'hearthfire', name: 'Fireplace', cat: 'housing', kind: 'construct', size: [2, 1], cost: { block: 40 }, work: 120, hp: 500, tier: 'camp', needs: ['wallAdjacent'],
      light: { lvl: 2, r: 3, fuel: { k: 'wood', perDay: 4 } }, heat: 120, beauty: 1, flags: ['light'], art: 'flame', stage: '2',
      text: 'Against a wall: warms its room (about 12 C in a room of 10 tiles) and lights it. Burns 4 wood a day.' },
    { id: 'longhouse', name: 'Longhouse', cat: 'housing', kind: 'construct', size: [5, 3], cost: { wood: 120, block: 20 }, work: 480, hp: 700, tier: 'hamlet', tech: 'roofing',
      flags: ['shell', 'flammable'], art: 'house', stage: '2', text: 'A walled and roofed hall with a door: room for four beds.' },
    { id: 'stonehouse', name: 'Stone house', cat: 'housing', kind: 'construct', size: [4, 4], cost: { block: 160 }, work: 720, hp: 1600, tier: 'village', tech: 'masonry2',
      flags: ['shell'], mods: [{ key: 'heat.room', op: 'add', value: 4 }], art: 'house', stage: '2', text: 'Stone walls and a slate roof: it does not burn, and it stays 4 C warmer.' },
    { id: 'cradle', name: 'Cradle', cat: 'housing', kind: 'furniture', size: [1, 1], tier: 'village', comfort: 50, flags: ['flammable'], art: 'bed', stage: '2',
      text: 'For the children of the hold, when births are on (a later setting).' },
  ],
};
