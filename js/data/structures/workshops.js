// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
// autoBills are the smart default bills (5.7): building the bench adds them at once.
export const DATA = {
  structure: [
    { id: 'carpenter', name: "Carpenter's bench", cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 40 }, work: 60, hp: 200,
      tech: 'carpentry', tier: 'camp', workbench: { workType: 'craft', specs: ['joiner'] }, flags: ['flammable'], art: 'struct.carpenter', stage: '1a',
      levels: [{ name: 'Joinery', tier: 'hamlet', cost: { wood: 40, 'ingot:iron': 10 }, work: 120 }],
      text: 'Wooden beds, tables, chairs and props. Placing furniture with none in stock adds a bill here.' },
    { id: 'mason', name: "Mason's bench", cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 20, stone: 2 }, work: 60, hp: 300,
      tech: 'masonry', tier: 'camp', workbench: { workType: 'craft', specs: ['stonecutter'], autoBills: [{ recipe: 'cut_blocks', mode: 'until', n: 100 }] },
      art: 'struct.mason', stage: '1a', levels: [{ name: 'Stoneyard', tier: 'hamlet', cost: { block: 40, 'ingot:iron': 10 }, work: 120 }],
      text: 'Cuts rough stone into blocks (until 100 by default), and makes pillars and stone furniture.' },
    { id: 'campfire', name: 'Campfire', cat: 'workshops', kind: 'construct', size: [1, 1], cost: { wood: 20 }, work: 20, hp: 80, tier: 'camp',
      light: { lvl: 2, r: 4, fuel: { k: 'wood', perDay: 4 } }, heat: 60,
      workbench: { workType: 'cook', autoBills: [{ recipe: 'simple_meal', mode: 'until', n: 2, perCol: true }] },
      flags: ['flammable', 'light'], art: 'struct.campfire', stage: '1b', text: 'Cooks simple meals (until 2 per colonist by default). Light and warmth.' },
  ],
};
