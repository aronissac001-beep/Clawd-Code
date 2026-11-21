// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
// Stage 2 (7.7, Camp to Village; the emberthrower, mage spire, lumen lamp and mirror are Stage 3).
// Towers: cap = archers manned; mods name the range and warning numbers H reads. Traps: 'trap';
// a 'linkable' trap fires from a linked pressure plate (B's mechanisms). An icon stands in as art
// until D registers struct.<id>.
// Z2.9 (F27, ranks not unlocks): no row has a `tier` gate. `band` is the rank a row was written for (a
// content label for menus and tests, never read by a placement gate); a row is paced by its materials,
// its `tech` and, for furniture, its recipe's minSkill (js/data/recipes.js). A row that must wait for an
// arrival (a noble's rooms) would keep `tier` with the `arrival` flag; none does yet.
export const DATA = {
  structure: [
    { id: 'sconce', name: 'Torch sconce', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 10 }, work: 15, hp: 60, band: 'camp',
      needs: ['wallAdjacent'], light: { lvl: 2, r: 4, fuel: { k: 'wood', perDay: 2 } }, flags: ['light', 'flammable'], art: 'struct.sconce', stage: '1a',
      text: 'A torch beside a wall: light 2 within 4 tiles. Tunnels need it.' },
    { id: 'brazier', name: 'Brazier', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 10, stone: 1 }, work: 20, hp: 150, band: 'camp',
      light: { lvl: 3, r: 5, fuel: { k: 'wood', perDay: 6 } }, heat: 60, flags: ['light'], art: 'struct.brazier', stage: '1b',
      text: 'Bright light. The Hollow take more damage in it.' },
    { id: 'spiketrap', name: 'Spike trap', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 15 }, work: 30, hp: 60, band: 'camp',
      flags: ['trap'], art: 'struct.spiketrap', stage: '2', text: 'Strikes the first hostile to step on it for 35; a hauler rearms it.' },
    // ---- Stage 2 ----
    { id: 'tower', name: 'Watchtower', cat: 'defence', kind: 'construct', size: [2, 2], cost: { wood: 80 }, work: 180, hp: 500, band: 'camp', cap: 1,
      flags: ['tower', 'flammable'], mods: [{ key: 'dmg.range', op: 'add', value: 3 }, { key: 'warn.edge', op: 'add', value: 2 }], art: 'tower', stage: '2',
      text: 'One archer: 3 tiles more range and sight 12. Raids from its edge are seen 2 hours sooner.' },
    { id: 'barricade', name: 'Log barricade', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 12 }, work: 15, hp: 200, band: 'camp',
      flags: ['flammable'], mods: [{ key: 'armour.ranged', op: 'add', value: 40, when: 'behind' }, { key: 'move.speed', op: 'pct', value: -60, when: 'here' }], art: 'wall', stage: '2',
      text: 'Low cover: arrows hit 40% less behind it. It can be climbed over, slowly.' },
    { id: 'platform', name: 'Archer platform', cat: 'defence', kind: 'construct', size: [2, 2], cost: { wood: 100 }, work: 200, hp: 400, band: 'hamlet', tech: 'watchtowers', cap: 2,
      flags: ['tower', 'flammable'], mods: [{ key: 'dmg.range', op: 'add', value: 2 }], art: 'tower', stage: '2', text: 'Two archers on a raised wooden stage. It burns.' },
    { id: 'deadfall', name: 'Deadfall', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 20, stone: 2 }, work: 60, hp: 60, band: 'hamlet', tech: 'watchtowers', needs: ['roofed'],
      flags: ['trap', 'linkable'], art: 'skull', stage: '2', text: 'In a roofed tunnel: drops rock for 60 on the first hostile. Single use; rebuild it. A pressure plate can trigger it.' },
    { id: 'barracks', name: 'Barracks', cat: 'defence', kind: 'construct', size: [4, 3], cost: { wood: 120, block: 40 }, work: 480, hp: 900, band: 'hamlet', tech: 'watchtowers', cap: 6,
      roomRole: 'barracks', flags: ['shell'], mods: [{ key: 'mood.soldier', op: 'add', value: 3, when: 'here' }], art: 'barracks', stage: '2',
      text: 'A walled hall with six bunks: soldiers sleep happier and answer the draft faster.' },
    { id: 'alarmbell', name: 'Alarm bell', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 20, 'ingot:copper': 10 }, work: 40, hp: 100, band: 'hamlet', tech: 'watchtowers',
      art: 'alert', stage: '2', text: 'Tap it: everyone who is not drafted runs to their safe room, and soldiers draft.' },
    { id: 'stonetower', name: 'Stone tower', cat: 'defence', kind: 'construct', size: [3, 3], cost: { block: 200 }, work: 600, hp: 1500, band: 'village', tech: 'siegecraft', cap: 3,
      flags: ['tower'], mods: [{ key: 'dmg.range', op: 'add', value: 4 }, { key: 'warn.edge', op: 'add', value: 3 }], art: 'tower', stage: '2',
      text: 'Three archers behind stone: it does not burn.' },
    { id: 'ballista', name: 'Ballista', cat: 'defence', kind: 'construct', size: [2, 2], cost: { wood: 60, 'ingot:iron': 20 }, work: 400, hp: 600, band: 'village', tech: 'siegecraft', cap: 1,
      flags: ['tower'], art: 'tower', stage: '2', text: 'An Archery operator looses a heavy bolt that pierces through a line of foes.' },
    { id: 'emberpit', name: 'Ember pit', cat: 'defence', kind: 'construct', size: [1, 1], cost: { block: 10, tallow: 5 }, work: 60, hp: 80, band: 'village', tech: 'mechanisms',
      flags: ['trap', 'linkable'], light: { lvl: 2, r: 2, fuel: { k: 'tallow', perDay: 1 } }, art: 'flame', stage: '2', text: 'Flares for 10 seconds under a hostile; refuelled with tallow.' },
    { id: 'lantern', name: 'Lantern post', cat: 'defence', kind: 'construct', size: [1, 1], cost: { 'ingot:iron': 4, glass: 4 }, work: 40, hp: 120, band: 'village', tech: 'lanterns',
      light: { lvl: 2, r: 5, fuel: { k: 'candle', perDay: 1 } }, flags: ['light'], art: 'brazier', stage: '2', text: 'A glass lantern: light 2 within 5 tiles on one candle every two days.' },
    { id: 'wardstone', name: 'Ward stone', cat: 'defence', kind: 'construct', size: [1, 1], cost: { block: 40, cutgem: 1 }, work: 240, hp: 800, band: 'village', tech: 'lanterns',
      mods: [{ key: 'threat.phase', op: 'flag', value: false, when: 'near' }], art: 'beacon', stage: '2', text: 'Shades cannot phase through rock within 6 tiles; blight falls back within 9.' },
    { id: 'beacon', name: 'Signal beacon', cat: 'defence', kind: 'construct', size: [2, 2], cost: { wood: 60, block: 40 }, work: 240, hp: 500, band: 'village', tech: 'lanterns', needs: ['openSky'],
      light: { lvl: 2, r: 6, fuel: { k: 'wood', perDay: 4 } }, flags: ['light'], mods: [{ key: 'warn.all', op: 'add', value: 6 }], art: 'beacon', stage: '2',
      text: 'On a hill or a tower top: every raid is seen 6 hours sooner.' },
    // Stage 2.9: once a charter structure (structures/charter.js, removed); now any hold may build it.
    { id: 'keep', name: 'Keep', cat: 'defence', kind: 'construct', size: [5, 5], cost: { block: 500 }, work: 1800, hp: 6000, band: 'hamlet', tech: 'supports',
      flags: ['shell'], art: 'struct.keep', stage: '3', text: 'A stone shell for the garrison and a last stand.' },
  ],
};
