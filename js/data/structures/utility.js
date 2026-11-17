// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). Stage 0: sample entries.
export const DATA = {
  structure: [
    { id: 'hearth', name: 'The Hearth', cat: 'utility', kind: 'construct', size: [3, 3], hp: 3000, tier: 'camp', claim: true, claimR: 14,
      light: { lvl: 3, r: 8, fuel: { k: 'wood', perDay: 10 } }, heat: 600, flags: ['start', 'unique', 'light'], art: 'struct.hearth',
      text: 'The heart of the hold: it claims land, lights the dark and fires on the Hollow at night.' },
    { id: 'well', name: 'Well', cat: 'utility', kind: 'construct', size: [1, 1], cost: { block: 20 }, work: 90, hp: 300, tier: 'camp',
      needs: ['nearWater'], art: 'struct.well', text: 'Firefighters nearby work twice as fast.' },
  ],
};
