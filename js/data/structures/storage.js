// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). Stage 0: sample entries.
export const DATA = {
  structure: [
    { id: 'stockpile', name: 'Stockpile', cat: 'storage', kind: 'zone', size: [1, 1], tier: 'camp', art: 'overlay.stockpile',
      text: 'Filtered storage. Pick a preset; Customise opens the full filter.' },
    { id: 'dump', name: 'Dumping zone', cat: 'storage', kind: 'zone', size: [1, 1], tier: 'camp', beauty: -2, art: 'overlay.dump',
      text: 'Takes chunks, rubble and corpses.' },
  ],
};
