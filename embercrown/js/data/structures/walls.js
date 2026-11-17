// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
// Order matters: the first 'wall' def is the stamp wall (core/apply.js), and floor defs map to the
// floor layer ids by their order among floors (f_planks 1, f_flag 2): append new floors at the end.
export const DATA = {
  structure: [
    { id: 'wall', name: 'Wall', cat: 'walls', kind: 'construct', size: [1, 1], costByMat: [{ cat: 'blocks', n: 5 }, { cat: 'wood', n: 8 }],
      work: 20, hp: 300, tier: 'camp', flags: ['wall', 'support'], art: 'struct.wall', stage: '1a',
      text: 'Wood or stone blocks. Strength follows the material; it holds up the roof.' },
    { id: 'door', name: 'Door', cat: 'walls', kind: 'construct', size: [1, 1], cost: { wood: 20 }, work: 30, hp: 150, tier: 'camp',
      flags: ['door', 'flammable'], art: 'struct.door', stage: '1a', text: 'Colonists pass; hostiles must break it.' },
    { id: 'f_planks', name: 'Plank floor', cat: 'walls', kind: 'construct', size: [1, 1], cost: { wood: 3 }, work: 8, tier: 'camp',
      beauty: 1, flags: ['floor', 'flammable'], art: 'struct.f_planks', stage: '1a', text: 'Warm boards underfoot. It burns.' },
    { id: 'f_flag', name: 'Flagstone', cat: 'walls', kind: 'construct', size: [1, 1], costByMat: [{ cat: 'blocks', n: 4 }], work: 12, tier: 'camp',
      beauty: 1, flags: ['floor'], art: 'struct.f_flag', stage: '1a', text: 'Laid stone blocks. It does not burn.' },
    { id: 'prop', name: 'Wooden prop', cat: 'walls', kind: 'furniture', size: [1, 1], tier: 'camp', flags: ['support', 'flammable'],
      art: 'struct.prop', stage: '1a', text: 'Holds the roof within 4 tiles. Made at a carpenter; it burns.' },
    { id: 'pillar', name: 'Stone pillar', cat: 'walls', kind: 'furniture', size: [1, 1], tier: 'camp', beauty: 1, flags: ['support'],
      art: 'struct.pillar', stage: '1a', text: 'Holds the roof within 4 tiles. Made at a mason.' },
  ],
};
