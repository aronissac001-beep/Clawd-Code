// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)).
export const DATA = {
  structure: [
    { id: 'cathedral', name: 'Cathedral of Dawn', cat: 'monuments', kind: 'construct', size: [5, 5], cost: { block: 400, 'ingot:iron': 40 }, work: 2400,
      hp: 4000, tier: 'village', ancestry: 'human', flags: ['unique'], art: 'struct.cathedral', stage: '3',
      mods: [{ key: 'work.speed', op: 'pct', value: 10, when: 'near' }], text: 'Work goes faster within 12 tiles; soldiers heal here.' },
    { id: 'worldforge', name: 'World Forge', cat: 'monuments', kind: 'construct', size: [4, 4], tier: 'hold', flags: ['unique', 'wonder'], art: 'struct.worldforge', stage: '3',
      stages: [{ name: 'Foundations', cost: { block: 600 }, work: 4000 }, { name: 'The great bellows', cost: { 'ingot:steel': 200 }, work: 6000 }],
      text: 'A Wonder of Forgehold: every metal good comes out one quality better.' },
    { id: 'bastion', name: 'Ember Bastion', cat: 'monuments', kind: 'construct', size: [5, 5], tier: 'hold', flags: ['unique', 'wonder'], art: 'struct.bastion', stage: '3',
      stages: [{ name: 'Curtain wall', cost: { block: 800 }, work: 5000 }, { name: 'Ember keep', cost: { block: 600, 'ingot:steel': 120 }, work: 6000 }],
      text: 'A Wonder of the Bulwark: walls and gates gain half again their strength.' },
  ],
};
