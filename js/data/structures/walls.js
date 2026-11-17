// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). Stage 0: sample entries.
export const DATA = {
  structure: [
    { id: 'wall', name: 'Wall', cat: 'walls', kind: 'construct', size: [1, 1], costByMat: [{ cat: 'blocks', n: 5 }, { cat: 'wood', n: 8 }],
      work: 20, hp: 300, tier: 'camp', flags: ['wall', 'support'], art: 'struct.wall', text: 'Strength follows the material.' },
    { id: 'door', name: 'Door', cat: 'walls', kind: 'construct', size: [1, 1], cost: { wood: 20 }, work: 30, hp: 150, tier: 'camp',
      flags: ['door', 'flammable'], art: 'struct.door', text: 'Colonists pass; hostiles must break it.' },
    { id: 'f_planks', name: 'Plank floor', cat: 'walls', kind: 'construct', size: [1, 1], cost: { wood: 3 }, work: 8, tier: 'camp',
      beauty: 1, flags: ['floor', 'flammable'], art: 'struct.f_planks' },
  ],
};
