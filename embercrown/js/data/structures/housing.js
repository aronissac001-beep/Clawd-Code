// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
export const DATA = {
  structure: [
    { id: 'bed', name: 'Bed', cat: 'housing', kind: 'furniture', size: [1, 2], tier: 'camp', comfort: 80, roomRole: 'bedroom', cap: 1,
      flags: ['bed'], art: 'struct.bed', stage: '1a', text: 'Rest at full speed. One bed makes a bedroom. Wood from a carpenter, stone from a mason.' },
    { id: 'hut', name: 'Cottage', cat: 'housing', kind: 'construct', size: [3, 3], cost: { wood: 60 }, work: 240, hp: 400, tier: 'camp',
      flags: ['shell', 'flammable'], art: 'struct.hut', stage: '2', text: 'A walled and roofed room with a door: quick housing for the first nights.' },
  ],
};
