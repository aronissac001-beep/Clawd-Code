// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)).
export const DATA = {
  structure: [
    { id: 'growzone', name: 'Growing zone', cat: 'farming', kind: 'zone', size: [1, 1], tier: 'camp', art: 'overlay.growzone', stage: '1b',
      text: 'Pick a crop; growers sow and harvest it.' },
    { id: 'farm', name: 'Tilled field', cat: 'farming', kind: 'construct', size: [4, 4], cost: { wood: 10 }, work: 60, tier: 'camp',
      art: 'struct.farm', stage: '2', text: 'A growing zone on better soil, with a scarecrow post.' },
  ],
};
