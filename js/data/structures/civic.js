// Structure defs (doc 7.1 schema; owner G). size [w, h] in tiles; cost is per tile for walls and
// floors, otherwise per structure; work is game minutes at speed 1.0 x the material work percent.
// art is a key in the art registry (D, js/engine/art/keys.js). stage: the build stage that
// introduces the def (schema STAGES; menus show availableIn(def, stage)).
// Stage 2 (7.9, Camp to Village; throne, bathhouse, fountain and hall of records are Hold tier,
// Stage 3). Joy sources say their kind in mods (joy.<kind>); F's joy need reads them. An icon
// stands in as art until D registers struct.<id>.
// Z2.9 (F27, ranks not unlocks): no row has a `tier` gate. `band` is the rank a row was written for (a
// content label for menus and tests, never read by a placement gate); a row is paced by its materials,
// its `tech` and, for furniture, its recipe's minSkill (js/data/recipes.js). A row that must wait for an
// arrival (a noble's rooms) would keep `tier` with the `arrival` flag; none does yet.
export const DATA = {
  structure: [
    { id: 'table', name: 'Table', cat: 'civic', kind: 'furniture', size: [2, 1], band: 'camp', beauty: 1, flags: ['table'], art: 'struct.table', stage: '1a',
      text: 'Eating at a table avoids the "ate without a table" thought. Wood or stone.' },
    { id: 'chair', name: 'Chair', cat: 'civic', kind: 'furniture', size: [1, 1], band: 'camp', comfort: 60, flags: ['seat'], art: 'struct.chair', stage: '1a',
      text: 'A seat at a table or a bench. Wood or stone.' },
    { id: 'shrine', name: 'Shrine', cat: 'civic', kind: 'construct', size: [1, 1], cost: { block: 20 }, work: 60, band: 'camp', beauty: 2,
      art: 'struct.shrine', stage: '2', mods: [{ key: 'need.light.restore', op: 'pct', value: 20, when: 'near' }, { key: 'need.joy.prayer', op: 'add', value: 1 }],
      text: 'A place to pray: joy, and it eases dread within 4 tiles.' },
    // ---- Stage 2 ----
    { id: 'stool', name: 'Stool', cat: 'civic', kind: 'furniture', size: [1, 1], band: 'camp', comfort: 40, flags: ['seat'], art: 'chair', stage: '2', text: 'A quick seat.' },
    { id: 'bench', name: 'Bench', cat: 'civic', kind: 'furniture', size: [2, 1], band: 'camp', comfort: 50, cap: 2, flags: ['seat'], art: 'chair', stage: '2', text: 'Seats two at a long table.' },
    { id: 'longtable', name: 'Long table', cat: 'civic', kind: 'furniture', size: [3, 2], band: 'hamlet', beauty: 2, cap: 6, flags: ['table'], art: 'table', stage: '2',
      text: 'Six can eat at it: the heart of a dining hall.' },
    { id: 'dicetable', name: 'Dice board', cat: 'civic', kind: 'construct', size: [1, 1], cost: { wood: 20 }, work: 40, hp: 60, band: 'hamlet', beauty: 1, flags: ['flammable'],
      mods: [{ key: 'need.joy.games', op: 'add', value: 1 }], art: 'dice', stage: '2', text: 'Joy from games, best with company.' },
    { id: 'tavern', name: 'Tavern', cat: 'civic', kind: 'construct', size: [4, 3], cost: { wood: 140, block: 30 }, work: 540, hp: 900, band: 'hamlet', tech: 'brewing',
      flags: ['shell', 'flammable'], mods: [{ key: 'need.joy.rate', op: 'pct', value: 30, when: 'here' }, { key: 'mood.chat', op: 'pct', value: 100, when: 'here' }], art: 'house', stage: '2',
      text: 'A walled taproom that serves ale: joy a third faster, twice the talk, and wanderers come more often.' },
    { id: 'tradepost', name: 'Trade post', cat: 'civic', kind: 'construct', size: [3, 3], cost: { wood: 100, block: 20 }, work: 360, hp: 600, band: 'hamlet',
      flags: ['flammable'], art: 'merchant', stage: '2', text: 'Caravans trade here, selling from the stock within 12 tiles.' },
    { id: 'garden', name: 'Flower garden', cat: 'civic', kind: 'zone', size: [1, 1], band: 'hamlet', tech: 'herbalism', beauty: 3, art: 'overlay.growzone', stage: '2',
      text: 'Flowers in planters and beds: beauty, and joy for a walk.' },
    { id: 'infirmary', name: 'Infirmary bed', cat: 'civic', kind: 'furniture', size: [1, 2], item: 'medbed', band: 'hamlet', comfort: 80, roomRole: 'infirmary', cap: 1, flags: ['bed'],
      mods: [{ key: 'tend.quality', op: 'pct', value: 15 }, { key: 'hp.heal', op: 'pct', value: 20 }], art: 'bed', stage: '2',
      text: 'The sick and wounded heal faster here, and tending goes better.' },
    { id: 'temple', name: 'Temple', cat: 'civic', kind: 'construct', size: [3, 3], cost: { block: 150, wood: 40 }, work: 720, hp: 1200, band: 'village', tech: 'masonry2',
      beauty: 4, flags: ['shell'], mods: [{ key: 'need.joy.prayer', op: 'add', value: 2 }, { key: 'mood.funeral', op: 'add', value: 2 }], art: 'shrine', stage: '2',
      text: 'Prayer and rites: weddings, funerals (+2), and rest here cures grey taint.' },
    { id: 'stage', name: 'Skald\'s stage', cat: 'civic', kind: 'construct', size: [2, 2], cost: { wood: 60 }, work: 150, hp: 300, band: 'village', tech: 'brewing', flags: ['flammable'],
      mods: [{ key: 'need.joy.music', op: 'add', value: 2 }], art: 'banner', stage: '2', text: 'When a colonist with Art 6 or more performs, eight others take joy.' },
    { id: 'arena', name: 'Sparring pit', cat: 'civic', kind: 'construct', size: [4, 4], cost: { wood: 60, block: 30 }, work: 240, hp: 400, band: 'village', tech: 'watchtowers',
      mods: [{ key: 'need.joy.sport', op: 'add', value: 2 }, { key: 'learn.melee', op: 'pct', value: 25, when: 'here' }], art: 'sword', stage: '2',
      text: 'Joy and Melee practice; the hold may hold a tournament.' },
    { id: 'statue', name: 'Statue', cat: 'civic', kind: 'furniture', size: [1, 1], band: 'village', beauty: 6, art: 'trophy', stage: '2',
      text: 'A carved work from the sculptor: beauty by quality.' },
    { id: 'bigstatue', name: 'Grand statue', cat: 'civic', kind: 'furniture', size: [2, 2], band: 'village', beauty: 15, art: 'trophy', stage: '2',
      text: 'A great carved work for a hall.' },
    { id: 'tapestry', name: 'Tapestry', cat: 'civic', kind: 'furniture', size: [1, 1], band: 'village', beauty: 5, needs: ['wallAdjacent'], flags: ['flammable'], art: 'banner', stage: '2',
      text: 'Woven with a story of the hold; hangs on a wall.' },
    { id: 'banner', name: 'Banner', cat: 'civic', kind: 'furniture', size: [1, 1], band: 'hamlet', beauty: 2, needs: ['wallAdjacent'], flags: ['flammable'],
      mods: [{ key: 'mood.soldier', op: 'add', value: 1, when: 'room' }], art: 'banner', stage: '2', text: 'The hold\'s colours on a wall.' },
    { id: 'surgery', name: 'Surgery table', cat: 'civic', kind: 'construct', size: [2, 1], cost: { wood: 30, 'ingot:iron': 10 }, work: 90, hp: 200, band: 'village', tech: 'medicine2',
      roomRole: 'infirmary', mods: [{ key: 'tend.quality', op: 'pct', value: 25 }], art: 'heart', stage: '2', text: 'Doctors tend better here; surgery comes later.' },
    { id: 'memorial_slab', name: 'Memorial slab', cat: 'civic', kind: 'construct', size: [1, 1], cost: { block: 10 }, work: 90, hp: 600, band: 'camp', beauty: 1,
      art: 'struct.grave', stage: '2', text: 'A mason engraves the names of the lost here, six to a slab: a body that was never found is remembered and rests.' },
    { id: 'memorial', name: 'Memorial obelisk', cat: 'civic', kind: 'construct', size: [1, 1], cost: { block: 60 }, work: 240, hp: 1000, band: 'village', tech: 'sculpture', beauty: 4,
      mods: [{ key: 'mood.mourning', op: 'add', value: 2 }], art: 'beacon', stage: '2', text: 'Carved with the names of the dead: mourners feel 2 better.' },
    { id: 'observatory', name: 'Observatory', cat: 'civic', kind: 'construct', size: [3, 3], cost: { block: 120, glass: 12, 'ingot:bronze': 10 }, work: 600, hp: 900, band: 'village', tech: 'glassblowing',
      needs: ['openSky'], mods: [{ key: 'warn.all', op: 'add', value: 6 }, { key: 'research.night', op: 'pct', value: 10 }], art: 'eye', stage: '2',
      text: 'Raids are seen 6 hours sooner; research at night goes 10% faster.' },
    // Stage 2.9: once a charter structure (structures/charter.js, removed); now any hold may build it.
    { id: 'greatanvil', name: 'Great Anvil', cat: 'civic', kind: 'construct', size: [2, 2], cost: { 'ingot:steel': 60, block: 40 }, work: 600, hp: 2000,
      band: 'hamlet', tech: 'smithing', art: 'struct.greatanvil', stage: '3', mods: [{ key: 'quality.forge', op: 'add', value: 1, when: 'near' }],
      text: 'Smiths working within 6 tiles strike masterworks more often.' },
  ],
};
