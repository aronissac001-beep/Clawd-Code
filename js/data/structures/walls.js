// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
// Order matters: the first 'wall' def is the stamp wall (core/apply.js), and floor defs map to the
// floor layer ids by their order among floors (f_planks 1, f_flag 2): append new floors at the end.
// Stage 2 (7.3, Camp to Village; appended): f_brick is floor id 3, f_carpet 4, road 5, bridge 6.
// The Build roof zone (7.3) is not a def: a roof needs a zone type or a designation bit from A (open issue).
// Z2.9 (F27, ranks not unlocks): no row has a `tier` gate. `band` is the rank a row was written for (a
// content label for menus and tests, never read by a placement gate); a row is paced by its materials,
// its `tech` and, for furniture, its recipe's minSkill (js/data/recipes.js). A row that must wait for an
// arrival (a noble's rooms) would keep `tier` with the `arrival` flag; none does yet.
export const DATA = {
  structure: [
    { id: 'wall', name: 'Wall', cat: 'walls', kind: 'construct', size: [1, 1], costByMat: [{ cat: 'blocks', n: 5 }, { cat: 'wood', n: 8 }],
      work: 20, hp: 300, band: 'camp', flags: ['wall', 'support'], art: 'struct.wall', stage: '1a',
      text: 'Wood, stone blocks or bricks. Strength follows the material; it holds up the roof.' },
    { id: 'door', name: 'Door', cat: 'walls', kind: 'construct', size: [1, 1], cost: { wood: 20 }, work: 30, hp: 150, band: 'camp',
      flags: ['door', 'flammable'], art: 'struct.door', stage: '1a', text: 'Colonists pass; hostiles must break it.' },
    { id: 'f_planks', name: 'Plank floor', cat: 'walls', kind: 'construct', size: [1, 1], cost: { wood: 3 }, work: 8, band: 'camp',
      beauty: 1, flags: ['floor', 'flammable'], art: 'struct.f_planks', stage: '1a', text: 'Warm boards underfoot. It burns.' },
    { id: 'f_flag', name: 'Flagstone', cat: 'walls', kind: 'construct', size: [1, 1], costByMat: [{ cat: 'blocks', n: 4 }], work: 12, band: 'camp',
      beauty: 1, flags: ['floor'], art: 'struct.f_flag', stage: '1a', text: 'Laid stone blocks. It does not burn.' },
    { id: 'prop', name: 'Wooden prop', cat: 'walls', kind: 'furniture', size: [1, 1], band: 'camp', flags: ['support', 'flammable'],
      art: 'struct.prop', stage: '1a', text: 'Holds the roof within 4 tiles. Made at a carpenter; it burns.' },
    { id: 'pillar', name: 'Stone pillar', cat: 'walls', kind: 'furniture', size: [1, 1], band: 'camp', beauty: 1, flags: ['support'],
      art: 'struct.pillar', stage: '1a', text: 'Holds the roof within 4 tiles. Made at a mason.' },
    // ---- Stage 2 ----
    { id: 'palisade', name: 'Palisade', cat: 'walls', kind: 'construct', size: [1, 1], cost: { wood: 6 }, work: 12, hp: 120, band: 'camp',
      flags: ['wall', 'flammable'], art: 'wall', stage: '2', text: 'Sharpened stakes: quick and cheap, but weak, and it burns. Holds no roof.' },
    { id: 'rwall', name: 'Reinforced wall', cat: 'walls', kind: 'construct', size: [1, 1], cost: { block: 5, ironbands: 2 }, work: 40, hp: 900, band: 'village', tech: 'masonry2',
      flags: ['wall', 'support'], mods: [{ key: 'hp.sapper', op: 'pct', value: 300 }], art: 'wall', stage: '2', text: 'Stone bound with iron: twice the strength, and sappers dig through it 4 times slower.' },
    { id: 'embrasure', name: 'Arrow-slit wall', cat: 'walls', kind: 'construct', size: [1, 1], cost: { block: 6 }, work: 30, hp: 300, band: 'hamlet', tech: 'watchtowers',
      flags: ['wall', 'support'], mods: [{ key: 'armour.ranged', op: 'add', value: 50, when: 'behind' }], art: 'wall', stage: '2',
      text: 'Archers behind it shoot out and take half the damage from arrows.' },
    { id: 'stonedoor', name: 'Stone door', cat: 'walls', kind: 'construct', size: [1, 1], cost: { block: 30 }, work: 60, hp: 400, band: 'hamlet', tech: 'supports',
      flags: ['door'], mods: [{ key: 'move.door', op: 'pct', value: -30 }], art: 'door', stage: '2', text: 'Does not burn, holds four times longer; slower to pass through.' },
    { id: 'gate', name: 'Iron-bound gate', cat: 'walls', kind: 'construct', size: [2, 1], cost: { block: 40, ironbands: 4 }, work: 120, hp: 900, band: 'village', tech: 'masonry2',
      flags: ['door', 'lockable'], art: 'gate', stage: '2', text: 'A wide gate that can be locked: a wall to hostiles until they break it. A lever can work it.' },
    { id: 'window', name: 'Window', cat: 'walls', kind: 'construct', size: [1, 1], cost: { glass: 6 }, work: 30, hp: 80, band: 'village', tech: 'glassblowing', needs: ['onWall'],
      beauty: 2, flags: ['window'], art: 'wall', stage: '2', text: 'Set into a wall: daylight into the room and a view.' },
    { id: 'f_brick', name: 'Tiled floor', cat: 'walls', kind: 'construct', size: [1, 1], cost: { brick: 4 }, work: 12, band: 'hamlet', tech: 'pottery',
      beauty: 2, flags: ['floor'], mods: [{ key: 'beauty.clean', op: 'pct', value: 20 }], art: 'floor', stage: '2', text: 'Fired tiles: easy to keep clean.' },
    { id: 'f_carpet', name: 'Carpet', cat: 'walls', kind: 'construct', size: [1, 1], cost: { carpetkit: 1 }, work: 6, band: 'village', tech: 'tailoring',
      beauty: 3, comfort: 10, flags: ['floor', 'flammable'], art: 'floor', stage: '2', text: 'Soft underfoot and handsome. It burns.' },
    { id: 'road', name: 'Road', cat: 'walls', kind: 'construct', size: [1, 1], cost: { block: 2 }, work: 6, band: 'camp',
      flags: ['floor', 'road'], mods: [{ key: 'move.speed', op: 'pct', value: 25 }], art: 'floor', stage: '2', text: 'Packed stone: walk a quarter faster on it.' },
    { id: 'bridge', name: 'Bridge', cat: 'walls', kind: 'construct', size: [1, 1], costByMat: [{ cat: 'wood', n: 10 }, { cat: 'blocks', n: 8 }], work: 30, hp: 300, band: 'camp', needs: ['onWater'],
      flags: ['floor', 'bridge'], art: 'floor', stage: '2', text: 'Walkable over shallow or deep water. Wood or stone.' },
  ],
};
