// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). Stage 0: sample entries.
export const DATA = {
  structure: [
    { id: 'bed', name: 'Bed', cat: 'housing', kind: 'furniture', size: [1, 2], tier: 'camp', comfort: 80, roomRole: 'bedroom', cap: 1,
      flags: ['bed'], art: 'struct.bed', text: 'Rest at full speed. One bed makes a bedroom.' },
    { id: 'hut', name: 'Cottage', cat: 'housing', kind: 'construct', size: [3, 3], cost: { wood: 60 }, work: 240, hp: 400, tier: 'camp',
      flags: ['shell', 'flammable'], art: 'struct.hut', text: 'A walled and roofed room with a door: quick housing for the first nights.' },
  ],
};
