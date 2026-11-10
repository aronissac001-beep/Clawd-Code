// Hidden adjacency combos (Phase 3). Certain arrangements of buildings and
// terrain quietly transform into something better (or worse). The sim
// (js/game/systems/combos.js) evaluates each `test` pattern and applies its
// `effect`; the art (js/engine/comboart.js) links the members on the map.
//
// "Touching" always means sharing a tile edge (diagonal corners do not count).
// Only finished buildings (b.built) take part. Building ids that do not exist in
// this game simply never match.
//
// test kinds:
//   { kind: 'touch', anchor, other: [types], min }   an anchor touching >= min distinct `other` buildings
//   { kind: 'touchTerrain', anchor, terrain, min }    an anchor touching >= min tiles of that terrain
//   { kind: 'touchNode', anchor, node, min, full? }   an anchor touching >= min resource nodes of that kind
//   { kind: 'sides', anchor, other: [types], min }    >= min of the anchor's 4 sides fully lined by `other`
//   { kind: 'cluster', type, min }                    >= min buildings of `type` connected edge to edge
//   { kind: 'line', type, min, gap }                  >= min of `type` on one row or column, each <= gap tiles apart
//   { kind: 'grove', size }                           size x size untouched tree tiles inside the territory (checked at dawn)
//
// effect keys (per-building bonuses go to the members named by `on`):
//   on: 'anchor' | 'others' | 'all'     which members get the per-building bonuses
//   bonusRange (tiles), bonusDmg (fraction), bonusLight (tiles), bonusChain (extra jumps), hpMult (fraction of max health)
//   farm (fraction, farms among the members), gather: { res: fraction }, marketGold (fraction of a Market's income)
//   taxes (fraction, global), baseMorale (global), moralePerMin (global), dreadPerNight (global)
//   reveal (tiles: fog reveal radius around the anchor), flags: { name: value } (s.ext.combos.flags), fey: true
// Global effects apply once while at least one instance stands; they never stack across instances.

export const COMBOS = {
  goldenFields: {
    id: 'goldenFields', name: 'Golden Fields', icon: 'farm', good: true, color: '#ffd45a',
    text: 'Three or more Farms touching a Granary: each of those Farms grows +50% food.',
    hint: 'Where the store-house is ringed by grain, the grain grows proud.',
    test: { kind: 'touch', anchor: 'granary', other: ['farm'], min: 3 },
    effect: { on: 'others', farm: 0.5 },
  },
  riversideMill: {
    id: 'riversideMill', name: 'Riverside Mill', icon: 'farm', good: true, color: '#8fd3ff',
    text: 'A Farm touching river water: +30% food from that Farm.',
    hint: 'Fields that drink from the river never thirst.',
    test: { kind: 'touchTerrain', anchor: 'farm', terrain: 4, min: 1 },
    effect: { on: 'anchor', farm: 0.3 },
  },
  eagleEyrie: {
    id: 'eagleEyrie', name: 'Eagle Eyrie', icon: 'eye', good: true, color: '#ffe9a8',
    text: 'A Watchtower touching crag: +1.5 range, and it lifts the fog for 12 tiles around.',
    hint: 'Raise a watch where only eagles nest.',
    test: { kind: 'touchTerrain', anchor: 'tower', terrain: 5, min: 1 },
    effect: { on: 'anchor', bonusRange: 1.5, reveal: 12 },
  },
  townSquare: {
    id: 'townSquare', name: 'Town Square', icon: 'house', good: true, color: '#ffc46a',
    text: 'Six or more Houses joined wall to wall: the level Morale settles toward rises by 6, and taxes +10%.',
    hint: 'Six hearths shoulder to shoulder make a market of gossip.',
    test: { kind: 'cluster', type: 'house', min: 6 },
    effect: { on: 'all', baseMorale: 6, taxes: 0.1 },
  },
  marketSquare: {
    id: 'marketSquare', name: 'Market Square', icon: 'gold', good: true, color: '#ffd76a',
    text: 'A Market touching three or more Houses: that Market earns +50% gold.',
    hint: 'Stalls do best where doors open onto them.',
    test: { kind: 'touch', anchor: 'market', other: ['house'], min: 3 },
    effect: { on: 'anchor', marketGold: 0.5 },
  },
  adventurersQuarter: {
    id: 'adventurersQuarter', name: "Adventurers' Quarter", icon: 'crown', good: true, color: '#ffb86a',
    text: 'A Tavern touching a Barracks: heroes gain +50% experience.',
    hint: 'Old soldiers tell the best tales, if the ale is close.',
    test: { kind: 'touch', anchor: 'tavern', other: ['barracks'], min: 1 },
    effect: { on: 'all', flags: { heroXp: 1.5 } },
  },
  arcaneNexus: {
    id: 'arcaneNexus', name: 'Arcane Nexus', icon: 'nova', good: true, color: '#7ff0e0',
    text: 'A Mage Spire touching two or more Braziers: its bolts leap to 2 more foes and deal +20% damage.',
    hint: 'Glass drinks fire, and gives it back as lightning.',
    test: { kind: 'touch', anchor: 'spire', other: ['brazier'], min: 2 },
    effect: { on: 'anchor', bonusChain: 2, bonusDmg: 0.2 },
  },
  bastion: {
    id: 'bastion', name: 'Bastion', icon: 'shield', good: true, color: '#ffe0a0',
    text: 'A Watchtower with Walls or Gates on at least 3 of its 4 sides: +50% health and +25% damage.',
    hint: 'A tower that cannot be reached cannot be felled.',
    test: { kind: 'sides', anchor: 'tower', other: ['wall', 'gate'], min: 3 },
    effect: { on: 'anchor', hpMult: 0.5, bonusDmg: 0.25 },
  },
  lanternRow: {
    id: 'lanternRow', name: 'Lantern Row', icon: 'brazier', good: true, color: '#ffcf70',
    text: 'Three or more Braziers in a straight row or column, each at most 3 tiles from the next: each lights +1.5 tiles further.',
    hint: 'Light that walks in a line walks further.',
    test: { kind: 'line', type: 'brazier', min: 3, gap: 3 },
    effect: { on: 'all', bonusLight: 1.5 },
  },
  emberWard: {
    id: 'emberWard', name: 'Ember Ward', icon: 'flame', good: true, color: '#ff9a50',
    text: 'A Brazier touching the Hearth: the Hearth\'s ember bolts deal +20% damage.',
    hint: 'Feed the Heartflame a little fire of its own.',
    test: { kind: 'touch', anchor: 'hearth', other: ['brazier'], min: 1 },
    effect: { on: 'anchor', bonusDmg: 0.2 },
  },
  stonewrightYard: {
    id: 'stonewrightYard', name: 'Stonewright Yard', icon: 'quarry', good: true, color: '#d8d2c8',
    text: 'A Quarry touching two or more boulders: its masons bring back +40% stone. Breaks if the boulders run out.',
    hint: 'Cut the stone where it lies, not where it was carried.',
    test: { kind: 'touchNode', anchor: 'quarry', node: 'rock', min: 2 },
    effect: { on: 'anchor', gather: { stone: 0.4 } },
  },
  dawnChorus: {
    id: 'dawnChorus', name: 'Dawn Chorus', icon: 'sun', good: true, color: '#fff0b0',
    text: 'A Cathedral of Dawn touching two or more Houses: the level Morale settles toward rises by 4.',
    hint: 'Bells sound sweetest to those who sleep beneath them.',
    test: { kind: 'touch', anchor: 'cathedral', other: ['house'], min: 2 },
    effect: { on: 'all', baseMorale: 4 },
  },
  feyGrove: {
    id: 'feyGrove', name: 'Fey Grove', icon: 'heart', good: true, color: '#b8ff9a',
    text: 'A 3 x 3 block of untouched forest inside your land: at each dawn the fey leave a blessing (food and wood, gold, or Morale), or play a prank (a building loses 20% of its health).',
    hint: 'Leave nine trees unbothered, and something will notice.',
    test: { kind: 'grove', size: 3 },
    effect: { fey: true, blessing: 0.7 },
  },
  // ---- Backfires -------------------------------------------------------------------------------------
  chokingSmoke: {
    id: 'chokingSmoke', name: 'Choking Smoke', icon: 'lumber', good: false, color: '#a77ad8',
    text: 'Three or more Lumber Camps joined edge to edge: their smoke costs 1 Morale a minute.',
    hint: 'Too many fires of green wood make a sorry sky.',
    test: { kind: 'cluster', type: 'lumber', min: 3 },
    effect: { on: 'all', moralePerMin: -1 },
  },
  graveQuarter: {
    id: 'graveQuarter', name: 'Grave Quarter', icon: 'skull', good: false, color: '#9a6ad0',
    text: 'Two or more Barracks joined edge to edge: Dread +1 every night.',
    hint: 'Where soldiers sleep in rows, so do their ghosts.',
    test: { kind: 'cluster', type: 'barracks', min: 2 },
    effect: { on: 'all', dreadPerNight: 1 },
  },
};

export const COMBO_ORDER = Object.keys(COMBOS);

// Tuning for effects that are not a simple number in the table above.
export const COMBO_TUNE = {
  validateEvery: 40,   // ticks between checks of terrain/node-dependent combos (boulders, groves) and fog reveal
  maxGroves: 3,        // at most this many Fey Groves are tracked at once
  prank: 0.2,          // share of max health a prank takes (never below 1 health)
  blessings: [
    { res: { food: 25, wood: 15 }, text: 'The fey left baskets of berries and a stack of fallen wood.' },
    { res: { gold: 20 }, text: 'Fey gold glitters among the roots: +20 gold.' },
    { morale: 4, text: 'Fey lanterns danced in the grove all night. Morale +4.' },
  ],
};
