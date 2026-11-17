// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
export const DATA = {
  structure: [
    { id: 'stockpile', name: 'Stockpile', cat: 'storage', kind: 'zone', size: [1, 1], tier: 'camp', art: 'overlay.stockpile', stage: '1a',
      text: 'Filtered storage. Pick a preset; Customise opens the full filter.' },
    { id: 'dump', name: 'Dumping zone', cat: 'storage', kind: 'zone', size: [1, 1], tier: 'camp', beauty: -2, art: 'overlay.dump', stage: '2',
      text: 'Takes chunks, rubble and corpses.' },
  ],
};
