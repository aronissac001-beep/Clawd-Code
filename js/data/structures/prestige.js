// Prestige buildings and ancestry monuments (EMBERCROWN-FORTRESS.md 3.11; owner G; renamed from
// monuments.js in Stage 2.9). Optional, unique projects with rare inputs: each gives room value, a name
// and an Annals page, and none has a percentage effect (no `mods`). They are never a goal and never
// gate anything. The `prestige` flag marks the multi-stage prestige buildings; Sunspire, Moonwell and
// the Gilded Exchange arrive with the world facts they need (Z2). The Deep Gate and the Ember Seal are
// the only mechanisms (Z3).
// size [w, h] in tiles; cost is per structure; work is game minutes at speed 1.0 x the material work
// percent. art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)).
// Z2.9 (F27, ranks not unlocks): no row has a `tier` gate. `band` is the rank a row was written for (a
// content label for menus and tests, never read by a placement gate); a row is paced by its materials,
// its `tech` and, for furniture, its recipe's minSkill (js/data/recipes.js). A row that must wait for an
// arrival (a noble's rooms) would keep `tier` with the `arrival` flag; none does yet.
export const DATA = {
  structure: [
    { id: 'cathedral', name: 'Cathedral of Dawn', cat: 'prestige', kind: 'construct', size: [5, 5], cost: { block: 400, 'ingot:iron': 40 }, work: 2400,
      hp: 4000, band: 'village', tech: 'masonry2', ancestry: 'human', flags: ['unique'], art: 'struct.cathedral', stage: '3',
      text: 'The human faith in stone: a Grand temple room, and a page in the Annals.' },
    { id: 'worldforge', name: 'World Forge', cat: 'prestige', kind: 'construct', size: [4, 4], band: 'hold', tech: 'steel', flags: ['unique', 'prestige'], art: 'struct.worldforge', stage: '3',
      stages: [{ name: 'Foundations', cost: { block: 600 }, work: 4000 }, { name: 'The great bellows', cost: { 'ingot:steel': 200 }, work: 6000 }],
      text: 'A Grand forge room raised over the ember: its builders and its masterworks go into the Annals.' },
    { id: 'bastion', name: 'Ember Bastion', cat: 'prestige', kind: 'construct', size: [5, 5], band: 'hold', tech: 'siegecraft', flags: ['unique', 'prestige'], art: 'struct.bastion', stage: '3',
      stages: [{ name: 'Curtain wall', cost: { block: 800 }, work: 5000 }, { name: 'Ember keep', cost: { block: 600, 'ingot:steel': 120 }, work: 6000 }],
      text: 'A Grand gatehouse on the surface entry. Its walls are ordinary walls of their stone.' },
  ],
};
