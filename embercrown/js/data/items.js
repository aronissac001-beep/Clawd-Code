// Items, stockpile categories, stockpile presets and outfits (doc 5.5, 5.6, 6.2, 6.6; owner G).
// value is in tenths of a coin per unit; mass per unit (carry capacity 35 x Might factor, 5.6);
// stack is the stack limit (1 = unique); mat names the material group a stack carries (k + m).
// mat may list several groups (furniture in wood or stone); the stack's m is the exact material.
// Stage 1a: the category tree in full and every slice kind (14.6 Items).
export const DATA = {
  itemCat: [
    { id: 'raw', name: 'Raw' },
    { id: 'wood', name: 'Wood', parent: 'raw' },
    { id: 'stone', name: 'Stone', parent: 'raw' },
    { id: 'ore', name: 'Ore', parent: 'raw' },
    { id: 'clay', name: 'Clay', parent: 'raw' },
    { id: 'sand', name: 'Sand', parent: 'raw' },
    { id: 'animal', name: 'Animal goods', parent: 'raw' },
    { id: 'materials', name: 'Materials' },
    { id: 'blocks', name: 'Blocks', parent: 'materials' },
    { id: 'ingots', name: 'Ingots', parent: 'materials' },
    { id: 'cloth', name: 'Cloth', parent: 'materials' },
    { id: 'leather', name: 'Leather', parent: 'materials' },
    { id: 'glass', name: 'Glass', parent: 'materials' },
    { id: 'food', name: 'Food' },
    { id: 'rawfood', name: 'Raw food', parent: 'food' },
    { id: 'meals', name: 'Meals', parent: 'food' },
    { id: 'drink', name: 'Drink', parent: 'food' },
    { id: 'preserved', name: 'Preserved', parent: 'food' },
    { id: 'medicine', name: 'Medicine' },
    { id: 'apparel', name: 'Apparel' },
    { id: 'weapons', name: 'Weapons' },
    { id: 'armour', name: 'Armour' },
    { id: 'tools', name: 'Tools' },
    { id: 'furniture', name: 'Furniture' },
    { id: 'art', name: 'Art' },
    { id: 'gems', name: 'Gems' },
    { id: 'coins', name: 'Coins' },
    { id: 'goods', name: 'Trade goods' },
    { id: 'corpses', name: 'Corpses' },
    { id: 'chunks', name: 'Chunks' },
  ],
  item: [
    // Raw (Stage 1a: wood, rough stone as stone piles, ore and coal; ore is stock only until the bloomery)
    { id: 'wood', name: 'Wood', cat: 'wood', stack: 75, mass: 3, value: 12, mat: 'wood', tags: ['fuel'], art: 'item.wood', text: 'Logs from felled trees. Walls, floors, doors and wooden furniture.' },
    { id: 'stone', name: 'Rough stone', cat: 'stone', stack: 10, mass: 12, value: 5, mat: 'stone', art: 'item.stone',
      text: 'A stone pile from mining. Hauled only when a bill or a frame needs it; a mason cuts it into blocks.' },
    { id: 'ore', name: 'Ore', cat: 'ore', stack: 50, mass: 1, value: 15, mat: 'metal', art: 'item.ore', text: 'Copper, tin or iron ore. Smelted into ingots at a bloomery (Stage 1b).' },
    { id: 'coal', name: 'Coal', cat: 'ore', stack: 50, mass: 1, value: 10, tags: ['fuel'], art: 'item.coal', text: 'Burns hot: bloomery fuel.' },
    // Materials
    { id: 'block', name: 'Stone blocks', cat: 'blocks', stack: 75, mass: 1, value: 9, mat: 'stone', art: 'item.block', text: 'Cut stone for walls, flagstone floors, pillars and stone furniture.' },
    { id: 'ingot', name: 'Ingots', cat: 'ingots', stack: 75, mass: 1, value: 40, mat: 'metal', art: 'item.ingot' },
    // Food (doc 6.5). nutr is need points (0-100): a colonist needs about 33 a day, so about 1.6 simple
    // meals or 8 raw units; 5 raw units cook into 1 meal of the same nourishment (without the raw-food thought).
    { id: 'hearthroot', name: 'Hearthroot', cat: 'rawfood', stack: 75, mass: 1, value: 4, shelfD: 30, food: { kind: 'raw', nutr: 4 }, art: 'item.hearthroot',
      text: 'A hardy root from grow zones. Edible raw; better cooked.' },
    { id: 'berries', name: 'Berries', cat: 'rawfood', stack: 75, mass: 1, value: 5, shelfD: 10, food: { kind: 'raw', nutr: 4 }, art: 'plant.berry',
      text: 'Picked from wild bushes, which grow back. Edible raw; better cooked.' },
    { id: 'meat', name: 'Meat', cat: 'rawfood', stack: 75, mass: 1, value: 5, shelfD: 4, food: { kind: 'raw', nutr: 4 }, art: 'item.meat' },
    { id: 'egg', name: 'Eggs', cat: 'rawfood', stack: 75, mass: 1, value: 5, shelfD: 15, food: { kind: 'raw', nutr: 4 }, art: 'item.egg' },
    { id: 'meal', name: 'Simple meal', cat: 'meals', stack: 10, mass: 1, value: 30, shelfD: 4, food: { kind: 'meal', nutr: 20 }, art: 'item.meal',
      text: 'Cooked at a campfire from five raw food. Eaten at a table it lifts the mood.' },
    // Art: 'pick' and 'sword' are UI icons standing in until D registers item.pick and item.spear (berries use plant.berry).
    // Tools and weapons (Stage 1b: the forge). Material from the ingots (copper, tin, iron).
    { id: 'pick', name: 'Pick', cat: 'tools', stack: 1, mass: 4, value: 200, mat: 'metal', tags: ['tool', 'unique'], art: 'pick',
      text: 'A metal pick: a miner who carries one digs faster.' },
    { id: 'spear', name: 'Spear', cat: 'weapons', stack: 1, mass: 3, value: 250, mat: 'metal', tags: ['weapon', 'unique'], art: 'sword',
      text: 'Reach and first strike; strong against hounds.' },
    // Furniture (crafted, then installed: D8). Wood or stone; the material comes from the ingredients.
    { id: 'bed', name: 'Bed', cat: 'furniture', stack: 1, mass: 30, value: 600, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'item.bed' },
    { id: 'table', name: 'Table', cat: 'furniture', stack: 1, mass: 25, value: 450, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'item.table' },
    { id: 'chair', name: 'Chair', cat: 'furniture', stack: 1, mass: 10, value: 240, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'item.chair' },
    { id: 'prop', name: 'Wooden prop', cat: 'furniture', stack: 1, mass: 15, value: 300, mat: 'wood', tags: ['installable', 'unique'], art: 'item.prop',
      text: 'A timber roof support: holds the roof within 4 tiles. It burns.' },
    { id: 'pillar', name: 'Stone pillar', cat: 'furniture', stack: 1, mass: 30, value: 380, mat: 'stone', tags: ['installable', 'unique'], art: 'item.pillar',
      text: 'A cut stone roof support: holds the roof within 4 tiles.' },
  ],
  zonePreset: [
    { id: 'all', name: 'All', cats: ['raw', 'materials', 'food', 'medicine', 'apparel', 'weapons', 'armour', 'tools', 'furniture', 'art', 'gems', 'coins', 'goods'], pri: 1,
      text: 'Takes everything except chunks and corpses.' },
    { id: 'raw', name: 'Raw', cats: ['raw'], pri: 1, text: 'Wood, stone, ore and other raw goods.' },
    { id: 'goods', name: 'Workshop goods', cats: ['materials', 'furniture', 'tools'], pri: 1, text: 'Blocks, ingots and furniture waiting to be installed.' },
    { id: 'store', name: 'Food store', cats: ['food'], pri: 2, text: 'Food and drink, at higher priority.' },
    { id: 'armoury', name: 'Armoury', cats: ['weapons', 'armour', 'apparel'], pri: 1, text: 'Weapons, armour and clothes.' },
    { id: 'dump', name: 'Dump', cats: ['chunks', 'corpses'], pri: 0, text: 'Chunks and corpses, out of the way.' },
  ],
  outfit: [
    { id: 'worker', name: 'Worker', allow: ['apparel', 'tools'] },
    { id: 'soldier', name: 'Soldier', allow: ['apparel', 'armour', 'weapons'] },
    { id: 'any', name: 'Any' },
  ],
};
