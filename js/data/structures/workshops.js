// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)). Stage 1a: the slice
// structures of 14.6 are tagged '1a'; the rest are early samples for later stages.
// autoBills are the smart default bills (5.7): building the bench adds them at once.
// Stage 2 (7.6, Camp to Village; the blast furnace is Village here, not Hold, because steel is a
// Hold-era (Village) tech and Hearth level 3 needs it; the mint, runeforge and siege workshop are
// Stage 3). workplace benches have no bills: the work type works at them (woodyard, quarry, study).
// An icon stands in as art until D registers struct.<id> (the renderer then draws it on its own).
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
    // Art: the 'flame' and 'hammer' icons stand in (the renderer then draws kit.js) until D registers struct.bloomery and struct.forge.
    { id: 'bloomery', name: 'Bloomery', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { stone: 6, wood: 20 }, work: 90, hp: 400, tier: 'camp', tech: 'bloomery',
      heat: 80, workbench: { workType: 'smith', autoBills: [{ recipe: 'smelt_iron', mode: 'until', n: 60 }] }, art: 'flame', stage: '1b',
      text: 'Smelts ore with coal into copper, tin and iron ingots. By default: iron while ore is stocked, until 60 iron ingots.' },
    { id: 'forge', name: 'Forge and anvil', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { stone: 4, wood: 30 }, work: 90, hp: 400, tier: 'camp', tech: 'bloomery',
      heat: 80, workbench: { workType: 'smith' }, art: 'hammer', stage: '1b',
      text: 'Hammers ingots into picks and spears.' },
    // ---- Stage 2: fire and food ----
    { id: 'butcher', name: 'Butcher\'s table', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 30 }, work: 60, hp: 150, tier: 'camp', tech: 'cooking',
      workbench: { workType: 'cook', autoBills: [{ recipe: 'butcher', mode: 'forever', n: 1 }] }, flags: ['flammable'], beauty: -1, art: 'food', stage: '2',
      text: 'Cuts carcasses into meat, hide, bone and tallow (forever by default, while carcasses exist).' },
    { id: 'stove', name: 'Hearthstove kitchen', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { block: 30, 'ingot:iron': 10 }, work: 120, hp: 400, tier: 'hamlet', tech: 'cooking',
      heat: 80, workbench: { workType: 'cook', autoBills: [{ recipe: 'stove_meal', mode: 'until', n: 2, perCol: true }] }, art: 'flame', stage: '2',
      text: 'A proper kitchen: fine meals, feasts, stews, bread, rations and cheese. Simple meals until 2 per colonist by default.' },
    { id: 'smokehouse', name: 'Smokehouse', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { wood: 60, block: 20 }, work: 150, hp: 300, tier: 'hamlet', tech: 'smokehouse',
      workbench: { workType: 'cook' }, flags: ['flammable'], art: 'flame', stage: '2', text: 'Smokes meat and fish to keep six times as long. Loaded, it works unattended.' },
    { id: 'windmill', name: 'Windmill', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { wood: 80, millstone: 1 }, work: 240, hp: 400, tier: 'hamlet', tech: 'milling', needs: ['openSky'],
      workbench: { workType: 'cook' }, flags: ['flammable'], art: 'wheel', stage: '2', text: 'Grinds grain into flour under the open sky.' },
    { id: 'watermill', name: 'Watermill', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { wood: 80, block: 40, millstone: 1 }, work: 300, hp: 600, tier: 'village', tech: 'waterworks',
      needs: ['riverEdge'], workbench: { workType: 'cook' }, mods: [{ key: 'work.bench', op: 'pct', value: 25, when: 'near' }], art: 'wheel', stage: '2',
      text: 'Grinds grain on the river, and its wheel drives benches next to it 25% faster.' },
    { id: 'brewery', name: 'Brewery', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { wood: 60, 'ingot:copper': 10 }, work: 150, hp: 300, tier: 'hamlet', tech: 'brewing',
      workbench: { workType: 'cook' }, flags: ['flammable'], art: 'food', stage: '2', text: 'Boils grain, honey or fruit into wort for the casks.' },
    { id: 'cask', name: 'Fermenting cask', cat: 'workshops', kind: 'construct', size: [1, 1], cost: { wood: 25 }, work: 40, hp: 100, tier: 'hamlet', tech: 'brewing',
      workbench: { workType: 'cook' }, flags: ['flammable'], art: 'crate', stage: '2', text: 'Load one wort: 4 days later it holds 6 drinks. Cool cellars age it well.' },
    // ---- Stage 2: wood ----
    { id: 'woodyard', name: 'Woodcutter\'s yard', cat: 'workshops', kind: 'construct', size: [3, 3], cost: { wood: 50 }, work: 120, hp: 300, tier: 'camp',
      workbench: { workType: 'chop', workplace: true }, flags: ['flammable', 'storage'], store: { stacks: 6, cats: ['wood'] },
      mods: [{ key: 'work.chop', op: 'pct', value: 20, when: 'near' }], art: 'lumber', stage: '2', text: 'Choppers within 12 tiles work 20% faster; it stores six stacks of logs.' },
    { id: 'fletcher', name: 'Fletcher\'s bench', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 40 }, work: 60, hp: 200, tier: 'hamlet', tech: 'fletching',
      workbench: { workType: 'craft' }, flags: ['flammable'], art: 'saw', stage: '2', text: 'Shortbows, longbows and crossbows.' },
    { id: 'charkiln', name: 'Charcoal kiln', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { block: 30, wood: 10 }, work: 90, hp: 300, tier: 'camp', tech: 'charcoal',
      heat: 40, workbench: { workType: 'craft' }, art: 'flame', stage: '2', text: 'Burns wood slowly into charcoal. Loaded, it works unattended.' },
    // ---- Stage 2: stone ----
    { id: 'quarry', name: 'Surface quarry', cat: 'workshops', kind: 'construct', size: [3, 3], cost: { wood: 40 }, work: 120, hp: 400, tier: 'camp', needs: ['rockFace'],
      workbench: { workType: 'mine', workplace: true }, art: 'quarry', stage: '2', text: 'Against a rock face: miners cut rough stone here slowly, without end. Stone piles near it count as stored.' },
    { id: 'sculptor', name: 'Sculptor\'s studio', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { block: 40, wood: 20 }, work: 120, hp: 300, tier: 'village', tech: 'sculpture',
      workbench: { workType: 'art' }, art: 'trophy', stage: '2', text: 'Statues of the hold\'s stories, and figurines for traders.' },
    // ---- Stage 2: metal ----
    { id: 'blastfurnace', name: 'Blast furnace', cat: 'workshops', kind: 'construct', size: [2, 3], cost: { brick: 60, block: 40, 'ingot:iron': 20 }, work: 300, hp: 800, tier: 'village', tech: 'steel',
      heat: 120, workbench: { workType: 'smith' }, art: 'flame', stage: '2', text: 'Iron and charcoal become steel.' },
    // ---- Stage 2: cloth ----
    { id: 'tannery', name: 'Tannery', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { wood: 50 }, work: 120, hp: 200, tier: 'hamlet', tech: 'tanning',
      workbench: { workType: 'tailor' }, beauty: -2, flags: ['flammable'], art: 'crate', stage: '2', text: 'Hides become leather and pelts fur. Loaded, a batch cures for a day.' },
    { id: 'loom', name: 'Loom', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 50 }, work: 90, hp: 150, tier: 'hamlet', tech: 'weaving',
      workbench: { workType: 'tailor' }, flags: ['flammable'], art: 'crate', stage: '2', text: 'Flax becomes linen, wool becomes wool cloth.' },
    { id: 'tailor', name: 'Tailor\'s bench', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 40, cloth: 10 }, work: 90, hp: 150, tier: 'hamlet', tech: 'tailoring',
      workbench: { workType: 'tailor', autoBills: [{ recipe: 'make_bandages', mode: 'until', n: 10 }] }, flags: ['flammable'], art: 'crate', stage: '2',
      text: 'Clothes, leather gear, bandages (until 10 by default), carpets and banners.' },
    // ---- Stage 2: earth ----
    { id: 'potter', name: 'Potter\'s wheel', cat: 'workshops', kind: 'construct', size: [1, 1], cost: { wood: 30, block: 10 }, work: 60, hp: 120, tier: 'hamlet', tech: 'pottery',
      workbench: { workType: 'craft' }, art: 'wheel', stage: '2', text: 'Jars, pickles and fine pottery for traders.' },
    { id: 'kiln', name: 'Brick kiln', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { block: 40 }, work: 120, hp: 500, tier: 'hamlet', tech: 'pottery',
      heat: 60, workbench: { workType: 'craft' }, art: 'flame', stage: '2', text: 'Fires clay into bricks.' },
    { id: 'glassworks', name: 'Glassworks', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { brick: 40, block: 20 }, work: 180, hp: 500, tier: 'village', tech: 'glassblowing',
      heat: 80, workbench: { workType: 'craft' }, art: 'eye', stage: '2', text: 'Sand and charcoal become glass: windows, lanterns and vials.' },
    // ---- Stage 2: care, fine work and lore ----
    { id: 'apothecary', name: 'Apothecary', cat: 'workshops', kind: 'construct', size: [2, 2], cost: { wood: 50, block: 10 }, work: 120, hp: 200, tier: 'hamlet', tech: 'herbalism',
      workbench: { workType: 'care', autoBills: [{ recipe: 'make_poultice', mode: 'until', n: 2, perCol: true }] }, flags: ['flammable'], art: 'heart', stage: '2',
      text: 'Poultices (until 2 per colonist by default), salves, sleeping draughts and candles.' },
    { id: 'jeweller', name: 'Jeweller\'s bench', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 30, 'ingot:iron': 10 }, work: 120, hp: 200, tier: 'village', tech: 'jewellery',
      workbench: { workType: 'art' }, art: 'gold', stage: '2', text: 'Cuts gems and sets them in rings, amulets and circlets.' },
    { id: 'study', name: 'Study desk', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 40 }, work: 60, hp: 150, tier: 'camp',
      workbench: { workType: 'lore', workplace: true }, flags: ['flammable'], art: 'book', stage: '2', text: 'A scholar studies here: lore points for the current research.' },
    { id: 'surveytable', name: 'Survey table', cat: 'workshops', kind: 'construct', size: [2, 1], cost: { wood: 40, cloth: 10 }, work: 90, hp: 150, tier: 'village', tech: 'prospecting',
      workbench: { workType: 'lore', workplace: true }, flags: ['flammable'], art: 'map', stage: '2', text: 'Maps the rock: a surveyor reveals ore veins within 12 tiles of a chosen spot.' },
    { id: 'scriptorium', name: 'Scriptorium', cat: 'workshops', kind: 'construct', size: [3, 2], cost: { wood: 80, block: 40 }, work: 240, hp: 400, tier: 'village',
      workbench: { workType: 'lore' }, mods: [{ key: 'research.speed', op: 'pct', value: 25, when: 'here' }], flags: ['flammable'], art: 'book', stage: '2',
      text: 'Copies books for joy and trade; research here goes a quarter faster.' },
    { id: 'trainingyard', name: 'Training yard', cat: 'workshops', kind: 'construct', size: [4, 4], cost: { wood: 80 }, work: 180, hp: 300, tier: 'village', tech: 'watchtowers',
      flags: ['flammable'], mods: [{ key: 'learn.melee', op: 'pct', value: 50, when: 'here' }, { key: 'learn.archery', op: 'pct', value: 50, when: 'here' }],
      art: 'sword', stage: '2', text: 'Soldiers spar and shoot at butts in their joy hours: Melee and Archery at half speed.' },
  ],
};
