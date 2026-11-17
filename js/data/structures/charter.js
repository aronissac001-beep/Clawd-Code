// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). Stage 0: sample entries.
export const DATA = {
  structure: [
    { id: 'greatanvil', name: 'Great Anvil', cat: 'charter', kind: 'construct', size: [2, 2], cost: { 'ingot:steel': 60, block: 40 }, work: 600, hp: 2000,
      tier: 'hamlet', path: 'forgehold', art: 'struct.greatanvil', mods: [{ key: 'quality.forge', op: 'add', value: 1, when: 'near' }],
      text: 'Smiths working within 6 tiles strike masterworks more often.' },
    { id: 'keep', name: 'Keep', cat: 'charter', kind: 'construct', size: [5, 5], cost: { block: 500 }, work: 1800, hp: 6000, tier: 'hamlet', path: 'bulwark',
      flags: ['shell'], art: 'struct.keep', text: 'A stone shell for the garrison and a last stand.' },
  ],
};
