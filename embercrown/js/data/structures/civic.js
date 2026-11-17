// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)).
export const DATA = {
  structure: [
    { id: 'table', name: 'Table', cat: 'civic', kind: 'furniture', size: [2, 1], tier: 'camp', beauty: 1, flags: ['table'], art: 'struct.table', stage: '1a',
      text: 'Eating at a table avoids the "ate without a table" thought. Wood or stone.' },
    { id: 'chair', name: 'Chair', cat: 'civic', kind: 'furniture', size: [1, 1], tier: 'camp', comfort: 60, flags: ['seat'], art: 'struct.chair', stage: '1a',
      text: 'A seat at a table or a bench. Wood or stone.' },
    { id: 'shrine', name: 'Shrine', cat: 'civic', kind: 'construct', size: [1, 1], cost: { block: 20 }, work: 60, tier: 'camp', beauty: 2,
      art: 'struct.shrine', stage: '2', mods: [{ key: 'need.light.restore', op: 'pct', value: 20, when: 'near' }], text: 'A place to pray; it eases dread nearby.' },
  ],
};
