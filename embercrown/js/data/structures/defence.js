// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
export const DATA = {
  structure: [
    { id: 'sconce', name: 'Torch sconce', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 10 }, work: 15, hp: 60, tier: 'camp',
      needs: ['wallAdjacent'], light: { lvl: 2, r: 4, fuel: { k: 'wood', perDay: 2 } }, flags: ['light', 'flammable'], art: 'struct.sconce', stage: '1a',
      text: 'A torch beside a wall: light 2 within 4 tiles. Tunnels need it.' },
    { id: 'brazier', name: 'Brazier', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 10, stone: 1 }, work: 20, hp: 150, tier: 'camp',
      light: { lvl: 3, r: 5, fuel: { k: 'wood', perDay: 6 } }, heat: 60, flags: ['light'], art: 'struct.brazier', stage: '1b',
      text: 'Bright light. The Hollow take more damage in it.' },
    { id: 'spiketrap', name: 'Spike trap', cat: 'defence', kind: 'construct', size: [1, 1], cost: { wood: 15 }, work: 30, hp: 60, tier: 'camp',
      flags: ['trap'], art: 'struct.spiketrap', stage: '2', text: 'Strikes the first hostile to step on it; a hauler rearms it.' },
  ],
};
