// Items, stockpile categories, stockpile presets and outfits (doc 5.5, 5.6, 6.2, 6.6; owner G).
// value is in tenths of a coin per unit; mass per unit (carry capacity 35 x Might factor, 5.6);
// stack is the stack limit (1 = unique); mat names the material group a stack carries (k + m).
// mat may list several groups (furniture in wood or stone); the stack's m is the exact material.
// Stage 1a: the category tree in full and every slice kind (14.6 Items). Stage 1b: food, the forge.
// Stage 2 (14.8 row G): every Camp, Hamlet and Village kind of 6.2: the food chain (farming,
// cooking, brewing, preserving), cloth and leather, medicine, apparel, armour, weapons, tools, the
// Stage 2 furniture of section 7, art and trade goods. Weapon, wear, tool and medicine numbers are
// the 6.6 table (fields in schema.js). Lumenite, spidersilk and the Hold-tier gear are Stage 3.
//
// Category notes for consumers:
//   - Raw food (cat 'rawfood', food.kind 'raw') holds every edible raw kind, meat and fish included,
//     so F's eat search (meals, rawfood) and the campfire's "5 raw food" keep working.
//   - Made food is 'meals' (meal, finemeal, feast, bread), 'preserved' (rations, smoked, pickles,
//     cheese: food.kind 'preserved') and 'drink' (ale, mead, wine: food.kind 'drink'). F: the eat
//     search should add 'preserved' (and 'drink' for joy) in Stage 2.
//   - Smelting fuel is cat 'fuel' (coal, charcoal): the bloomery and blast furnace take { cat: 'fuel' }.
//   - Components (cat 'parts': iron bands, jars, candles, millstones, carpet kits) are never eaten,
//     worn or smelted; recipes and structure costs name them by kind.
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
    // ---- Stage 2 (appended leaves) ----
    { id: 'fuel', name: 'Fuel', parent: 'raw' },
    { id: 'fibre', name: 'Fibre', parent: 'raw' },
    { id: 'herbs', name: 'Herbs', parent: 'raw' },
    { id: 'parts', name: 'Components', parent: 'materials' },
  ],
  item: [
    // ---- Raw (Stage 1a: wood, rough stone as stone piles, ore and coal) ----
    { id: 'wood', name: 'Wood', cat: 'wood', stack: 75, mass: 3, value: 12, mat: 'wood', tags: ['fuel'], fuel: 100, art: 'item.wood', text: 'Logs from felled trees. Walls, floors, doors and wooden furniture.' },
    { id: 'stone', name: 'Rough stone', cat: 'stone', stack: 10, mass: 12, value: 5, mat: 'stone', art: 'item.stone',
      text: 'A stone pile from mining. Hauled only when a bill or a frame needs it; a mason cuts it into blocks.' },
    { id: 'ore', name: 'Ore', cat: 'ore', stack: 50, mass: 1, value: 15, mat: 'metal', art: 'item.ore', text: 'Copper, tin, iron, silver or gold ore. Smelted into ingots at a bloomery.' },
    { id: 'coal', name: 'Coal', cat: 'fuel', stack: 50, mass: 1, value: 10, tags: ['fuel'], fuel: 200, art: 'item.coal', text: 'Burns hot: bloomery and blast furnace fuel.' },
    // ---- Materials ----
    { id: 'block', name: 'Stone blocks', cat: 'blocks', stack: 75, mass: 1, value: 9, mat: 'stone', art: 'item.block', text: 'Cut stone for walls, flagstone floors, pillars and stone furniture.' },
    { id: 'ingot', name: 'Ingots', cat: 'ingots', stack: 75, mass: 1, value: 40, mat: 'metal', art: 'item.ingot' },
    // ---- Food (doc 6.5). nutr is need points (0-100): a colonist needs about 33 a day, so about 1.6 simple
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
      mods: [{ key: 'work.mine', op: 'pct', value: 25 }], text: 'A metal pick: a miner who carries one digs faster.' },
    { id: 'spear', name: 'Spear', cat: 'weapons', stack: 1, mass: 3, value: 250, mat: 'metal', tags: ['weapon', 'unique'], art: 'sword',
      weapon: { dmg: 9, speed: 90, reach: 15, mods: [{ key: 'dmg.beast', op: 'pct', value: 50 }] }, text: 'Reach and first strike; strong against hounds.' },
    // Furniture (crafted, then installed: D8). Wood or stone; the material comes from the ingredients.
    { id: 'bed', name: 'Bed', cat: 'furniture', stack: 1, mass: 30, value: 600, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'item.bed' },
    { id: 'table', name: 'Table', cat: 'furniture', stack: 1, mass: 25, value: 450, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'item.table' },
    { id: 'chair', name: 'Chair', cat: 'furniture', stack: 1, mass: 10, value: 240, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'item.chair' },
    { id: 'prop', name: 'Wooden prop', cat: 'furniture', stack: 1, mass: 15, value: 300, mat: 'wood', tags: ['installable', 'unique'], art: 'item.prop',
      text: 'A timber roof support: holds the roof within 4 tiles. It burns.' },
    { id: 'pillar', name: 'Stone pillar', cat: 'furniture', stack: 1, mass: 30, value: 380, mat: 'stone', tags: ['installable', 'unique'], art: 'item.pillar',
      text: 'A cut stone roof support: holds the roof within 4 tiles.' },

    // =================== Stage 2 (Camp to Village) ===================
    // Art: until D registers item.<id>, an icon stands in and the renderer draws item.<id> once it exists
    // (art/index.js itemKey falls back to item.<kind>).
    // ---- Raw ----
    { id: 'charcoal', name: 'Charcoal', cat: 'fuel', stack: 50, mass: 1, value: 12, tags: ['fuel'], fuel: 200, art: 'flame', text: 'Burnt wood from a charcoal kiln: fuel for smelting, steel and the Hearth.' },
    { id: 'clay', name: 'Clay', cat: 'clay', stack: 50, mass: 2, value: 3, art: 'stone', text: 'Dug from clay seams. A potter shapes it; a kiln fires it into bricks.' },
    { id: 'sand', name: 'Sand', cat: 'sand', stack: 50, mass: 2, value: 2, art: 'stone', text: 'Scooped from river banks and sand. Glass begins here.' },
    { id: 'gem', name: 'Rough gem', cat: 'gems', stack: 25, mass: 1, value: 10, mat: 'gem', tags: ['trade'], art: 'gold', text: 'Amber, garnet, sapphire, emerald, ruby or heartstone, uncut. A jeweller cuts it.' },
    { id: 'hide', name: 'Hide', cat: 'animal', stack: 25, mass: 2, value: 8, art: 'crate', text: 'A raw hide from butchering. A tannery turns two hides into leather.' },
    { id: 'pelt', name: 'Pelt', cat: 'animal', stack: 25, mass: 2, value: 14, art: 'crate', text: 'A furred pelt from wolves, boars and deer. Cured into fur.' },
    { id: 'bone', name: 'Bone', cat: 'animal', stack: 50, mass: 1, value: 2, art: 'skull', text: 'From butchering. Carved into figurines.' },
    { id: 'tallow', name: 'Tallow', cat: 'animal', stack: 50, mass: 1, value: 4, tags: ['fuel'], art: 'food', text: 'Rendered fat: candles and ember-pit fuel.' },
    { id: 'beeswax', name: 'Beeswax', cat: 'animal', stack: 50, mass: 1, value: 8, art: 'food', text: 'From beehives: candles and salves.' },
    { id: 'hay', name: 'Hay', cat: 'animal', stack: 75, mass: 1, value: 1, tags: ['feed'], art: 'farm', text: 'Dried grain stalks: winter feed for penned animals.' },
    { id: 'wool', name: 'Raw wool', cat: 'fibre', stack: 50, mass: 1, value: 6, art: 'crate', text: 'Shorn from sheep. A loom weaves it into warm cloth.' },
    { id: 'flax', name: 'Flax fibre', cat: 'fibre', stack: 50, mass: 1, value: 4, art: 'farm', text: 'Harvested flax. A loom weaves it into linen.' },
    { id: 'herbs', name: 'Herbs', cat: 'herbs', stack: 50, mass: 1, value: 6, shelfD: 20, tags: ['medicine'], med: 40, art: 'heart',
      text: 'Healing herbs, grown or gathered wild. A poor dressing alone; an apothecary makes them into poultices.' },
    // ---- Materials ----
    { id: 'brick', name: 'Bricks', cat: 'blocks', stack: 75, mass: 1, value: 8, mat: 'stone', art: 'wall', text: 'Fired clay: walls and tiled floors. Kiln bricks are always of brick.' },
    { id: 'cloth', name: 'Cloth', cat: 'cloth', stack: 75, mass: 1, value: 10, mat: 'cloth', tags: ['trade'], art: 'crate', text: 'Linen or wool cloth from a loom: clothes, bandages, carpets and tapestries.' },
    { id: 'leather', name: 'Leather', cat: 'leather', stack: 75, mass: 1, value: 16, mat: 'hide', art: 'crate', text: 'Tanned leather or cured fur: jerkins, caps, boots and mantles.' },
    { id: 'glass', name: 'Glass', cat: 'glass', stack: 75, mass: 1, value: 15, art: 'eye', text: 'Window panes, lanterns and vials.' },
    { id: 'cutgem', name: 'Cut gem', cat: 'gems', stack: 25, mass: 1, value: 30, mat: 'gem', tags: ['trade'], art: 'gold', text: 'A faceted gem: jewellery, Waystones and the Hearth.' },
    { id: 'ironbands', name: 'Iron bands', cat: 'parts', stack: 50, mass: 1, value: 110, tags: ['component'], art: 'gear', text: 'Strapping for reinforced walls and iron-bound gates.' },
    { id: 'jar', name: 'Jar', cat: 'parts', stack: 25, mass: 1, value: 15, tags: ['component'], art: 'crate', text: 'A clay jar for pickling.' },
    { id: 'candle', name: 'Candles', cat: 'parts', stack: 50, mass: 1, value: 8, tags: ['component', 'fuel'], art: 'flame', text: 'Lantern fuel: one candle lasts a lantern two days.' },
    { id: 'millstone', name: 'Millstone', cat: 'parts', stack: 1, mass: 40, value: 420, mat: 'stone', tags: ['component', 'unique'], art: 'wheel', text: 'A dressed grinding stone for a windmill or a watermill.' },
    { id: 'carpetkit', name: 'Carpet roll', cat: 'parts', stack: 10, mass: 2, value: 120, mat: 'cloth', tags: ['component'], art: 'floor', text: 'Lays one tile of carpet.' },
    // ---- Raw food (all in 'rawfood', see the header) ----
    { id: 'grain', name: 'Grain', cat: 'rawfood', stack: 75, mass: 1, value: 4, shelfD: 60, food: { kind: 'raw', nutr: 4 }, art: 'farm', text: 'Keeps for a season. Milled into flour, brewed into ale.' },
    { id: 'greens', name: 'Greens', cat: 'rawfood', stack: 75, mass: 1, value: 4, shelfD: 5, food: { kind: 'raw', nutr: 3 }, art: 'farm', text: 'Leafy and fast to grow; spoils fast. Pickle it.' },
    { id: 'apple', name: 'Apples', cat: 'rawfood', stack: 75, mass: 1, value: 5, shelfD: 15, food: { kind: 'raw', nutr: 4, joy: 1 }, art: 'food', text: 'From orchard trees, once a year in Highsun.' },
    { id: 'glowcap', name: 'Glowcap', cat: 'rawfood', stack: 75, mass: 1, value: 6, shelfD: 10, food: { kind: 'raw', nutr: 4 }, art: 'food', text: 'A cave mushroom that grows only in the dark.' },
    { id: 'fish', name: 'Fish', cat: 'rawfood', stack: 75, mass: 1, value: 6, shelfD: 3, food: { kind: 'raw', nutr: 4 }, art: 'food', text: 'From a fisher\'s hut on the shore.' },
    { id: 'milk', name: 'Milk', cat: 'rawfood', stack: 50, mass: 1, value: 4, shelfD: 3, food: { kind: 'raw', nutr: 3 }, art: 'food', text: 'From goats. Make cheese before it turns.' },
    { id: 'honey', name: 'Honey', cat: 'rawfood', stack: 50, mass: 1, value: 10, shelfD: 300, food: { kind: 'raw', nutr: 5, joy: 2 }, art: 'food', text: 'From beehives. Mead, salves and feasts.' },
    { id: 'flour', name: 'Flour', cat: 'rawfood', stack: 75, mass: 1, value: 6, shelfD: 30, food: { kind: 'raw', nutr: 3 }, art: 'food', text: 'Milled grain. Baked into bread.' },
    // ---- Meals, preserved food and drink ----
    { id: 'finemeal', name: 'Fine meal', cat: 'meals', stack: 10, mass: 1, value: 60, shelfD: 4, food: { kind: 'meal', nutr: 25, joy: 3 }, art: 'item.meal', text: 'Meat and greens cooked well. Lifts the mood more than a simple meal.' },
    { id: 'feast', name: 'Feast', cat: 'meals', stack: 5, mass: 2, value: 160, shelfD: 3, food: { kind: 'meal', nutr: 40, joy: 8 }, art: 'item.meal', text: 'A lavish spread: the best mood a meal can give.' },
    { id: 'bread', name: 'Bread', cat: 'meals', stack: 20, mass: 1, value: 20, shelfD: 8, food: { kind: 'meal', nutr: 12 }, art: 'food', text: 'Baked loaves: a cooked meal that keeps for 8 days.' },
    { id: 'ration', name: 'Trail ration', cat: 'preserved', stack: 20, mass: 1, value: 28, shelfD: 60, food: { kind: 'preserved', nutr: 15 }, art: 'food', text: 'Dried meat and grain: keeps for two seasons.' },
    { id: 'smokedmeat', name: 'Smoked meat', cat: 'preserved', stack: 75, mass: 1, value: 8, shelfD: 24, food: { kind: 'preserved', nutr: 4 }, art: 'item.meat', text: 'Keeps six times as long as fresh meat.' },
    { id: 'smokedfish', name: 'Smoked fish', cat: 'preserved', stack: 75, mass: 1, value: 9, shelfD: 18, food: { kind: 'preserved', nutr: 4 }, art: 'food', text: 'Keeps six times as long as fresh fish.' },
    { id: 'pickles', name: 'Pickles', cat: 'preserved', stack: 75, mass: 1, value: 7, shelfD: 40, food: { kind: 'preserved', nutr: 3 }, art: 'food', text: 'Greens kept in a jar for 40 days.' },
    { id: 'cheese', name: 'Cheese', cat: 'preserved', stack: 50, mass: 1, value: 14, shelfD: 30, food: { kind: 'preserved', nutr: 8, joy: 1 }, art: 'food', text: 'Goat milk made to keep.' },
    { id: 'alewort', name: 'Ale wort', cat: 'drink', stack: 5, mass: 4, value: 40, shelfD: 20, art: 'food', text: 'Unfermented: load it into a cask for 4 days.' },
    { id: 'meadwort', name: 'Mead wort', cat: 'drink', stack: 5, mass: 4, value: 70, shelfD: 20, art: 'food', text: 'Honey wort: load it into a cask for 4 days.' },
    { id: 'winewort', name: 'Berry wine wort', cat: 'drink', stack: 5, mass: 4, value: 50, shelfD: 20, art: 'food', text: 'Fruit wort: load it into a cask for 4 days.' },
    { id: 'ale', name: 'Ale', cat: 'drink', stack: 25, mass: 1, value: 12, shelfD: 60, food: { kind: 'drink', nutr: 2, joy: 6 }, tags: ['trade'], art: 'food', text: 'A mug of ale: joy, and a tavern\'s trade.' },
    { id: 'mead', name: 'Mead', cat: 'drink', stack: 25, mass: 1, value: 18, shelfD: 90, food: { kind: 'drink', nutr: 2, joy: 7 }, tags: ['trade'], art: 'food', text: 'Honey wine. Sells well.' },
    { id: 'wine', name: 'Berry wine', cat: 'drink', stack: 25, mass: 1, value: 15, shelfD: 90, food: { kind: 'drink', nutr: 2, joy: 7 }, tags: ['trade'], art: 'food', text: 'Wine of berries or apples.' },
    // ---- Medicine (4.6): bandage < poultice < salve; the draught helps the wounded sleep ----
    { id: 'bandage', name: 'Bandages', cat: 'medicine', stack: 25, mass: 1, value: 10, tags: ['medicine'], med: 60, art: 'heart', text: 'Stops bleeding. Better than nothing.' },
    { id: 'poultice', name: 'Herbal poultice', cat: 'medicine', stack: 25, mass: 1, value: 22, shelfD: 30, tags: ['medicine'], med: 100, art: 'heart', text: 'Herbs bound to a wound: tends well and staves off infection.' },
    { id: 'salve', name: 'Healing salve', cat: 'medicine', stack: 25, mass: 1, value: 50, shelfD: 60, tags: ['medicine'], med: 140, art: 'heart', text: 'Herbs in wax or honey: the best tending before ember tonic.' },
    { id: 'draught', name: 'Sleeping draught', cat: 'medicine', stack: 25, mass: 1, value: 40, shelfD: 60, tags: ['medicine'], med: 80, art: 'moon', text: 'The wounded rest deeply and heal faster in bed.' },
    // ---- Apparel (slots 6.6; material cloth or hide) ----
    { id: 'tunic', name: 'Tunic', cat: 'apparel', stack: 1, mass: 2, value: 280, mat: ['cloth', 'hide'], slot: 'body', wear: { armour: 2, insul: 4 }, tags: ['unique'], art: 'crate' },
    { id: 'robe', name: 'Robe', cat: 'apparel', stack: 1, mass: 3, value: 440, mat: ['cloth', 'hide'], slot: 'body', wear: { armour: 2, insul: 7 }, tags: ['unique'], art: 'crate' },
    { id: 'jerkin', name: 'Leather jerkin', cat: 'apparel', stack: 1, mass: 4, value: 600, mat: 'hide', slot: 'body', wear: { armour: 10, insul: 5 }, tags: ['unique'], art: 'shield' },
    { id: 'gambeson', name: 'Gambeson', cat: 'apparel', stack: 1, mass: 5, value: 560, mat: 'cloth', slot: 'body', wear: { armour: 14, insul: 6 }, tags: ['unique'], art: 'shield' },
    { id: 'cloak', name: 'Cloak', cat: 'apparel', stack: 1, mass: 3, value: 460, mat: ['cloth', 'hide'], slot: 'outer', wear: { armour: 1, insul: 10 }, tags: ['unique'], art: 'crate' },
    { id: 'furmantle', name: 'Fur mantle', cat: 'apparel', stack: 1, mass: 4, value: 680, mat: 'hide', slot: 'outer', wear: { armour: 3, insul: 18 }, tags: ['unique'], art: 'crate', text: 'Cut from fur: the warmest thing to wear in Deepcold.' },
    { id: 'hood', name: 'Hood', cat: 'apparel', stack: 1, mass: 1, value: 120, mat: ['cloth', 'hide'], slot: 'head', wear: { armour: 1, insul: 3 }, tags: ['unique'], art: 'crate' },
    { id: 'boots', name: 'Boots', cat: 'apparel', stack: 1, mass: 2, value: 220, mat: ['cloth', 'hide'], slot: 'feet', wear: { armour: 3, insul: 4 }, tags: ['unique'], art: 'crate' },
    // ---- Armour ----
    { id: 'leathercap', name: 'Leather cap', cat: 'armour', stack: 1, mass: 1, value: 190, mat: 'hide', slot: 'head', wear: { armour: 8, insul: 2 }, tags: ['unique'], art: 'shield' },
    { id: 'ironhelm', name: 'Iron helm', cat: 'armour', stack: 1, mass: 3, value: 700, mat: 'metal', slot: 'head', wear: { armour: 18, insul: 0 }, tags: ['unique'], art: 'shield' },
    { id: 'steelhelm', name: 'Steel helm', cat: 'armour', stack: 1, mass: 3, value: 1100, mat: 'metal', slot: 'head', wear: { armour: 24, insul: 0 }, tags: ['unique'], art: 'shield' },
    { id: 'mailshirt', name: 'Mail shirt', cat: 'armour', stack: 1, mass: 10, value: 1800, mat: 'metal', slot: 'outer', wear: { armour: 28, insul: 0 }, tags: ['unique'], art: 'shield',
      mods: [{ key: 'move.speed', op: 'pct', value: -5 }], text: 'Rings of metal over the body: the best a Village smith can make.' },
    { id: 'woodshield', name: 'Wooden shield', cat: 'armour', stack: 1, mass: 4, value: 260, mat: 'wood', slot: 'hands', wear: { armour: 10, insul: 0 }, tags: ['unique'], art: 'shield' },
    { id: 'ironshield', name: 'Iron shield', cat: 'armour', stack: 1, mass: 6, value: 900, mat: 'metal', slot: 'hands', wear: { armour: 18, insul: 0 }, tags: ['unique'], art: 'shield' },
    { id: 'towershield', name: 'Tower shield', cat: 'armour', stack: 1, mass: 9, value: 1400, mat: 'metal', slot: 'hands', wear: { armour: 26, insul: 0 }, tags: ['unique'], art: 'shield',
      mods: [{ key: 'move.speed', op: 'pct', value: -10 }] },
    // ---- Weapons (6.6 table: dmg, speed percent, reach in tenths of a tile) ----
    { id: 'club', name: 'Club', cat: 'weapons', stack: 1, mass: 2, value: 120, mat: 'wood', tags: ['weapon', 'unique'], weapon: { dmg: 7, speed: 100, reach: 10 }, art: 'sword', text: 'Crude, but anyone can swing it.' },
    { id: 'dagger', name: 'Dagger', cat: 'weapons', stack: 1, mass: 1, value: 260, mat: 'metal', tags: ['weapon', 'unique'], weapon: { dmg: 6, speed: 140, reach: 10 }, art: 'sword', text: 'Fast.' },
    { id: 'axe', name: 'War axe', cat: 'weapons', stack: 1, mass: 3, value: 420, mat: 'metal', tags: ['weapon', 'unique'], weapon: { dmg: 11, speed: 90, reach: 10, mods: [{ key: 'dmg.shield', op: 'pct', value: 30 }] }, art: 'axe',
      text: 'Bites through shields.' },
    { id: 'sword', name: 'Sword', cat: 'weapons', stack: 1, mass: 2, value: 620, mat: 'metal', tags: ['weapon', 'unique'], weapon: { dmg: 12, speed: 100, reach: 10, mods: [{ key: 'dmg.parry', op: 'add', value: 10 }] }, art: 'sword',
      text: 'Parries one blow in ten.' },
    { id: 'maul', name: 'Maul', cat: 'weapons', stack: 1, mass: 6, value: 800, mat: 'metal', tags: ['weapon', 'unique'], weapon: { dmg: 15, speed: 70, reach: 10, mods: [{ key: 'dmg.armourBreak', op: 'flag', value: true }] }, art: 'hammer',
      text: 'Breaks armour and knocks foes back: the answer to Hollow Knights.' },
    { id: 'halberd', name: 'Halberd', cat: 'weapons', stack: 1, mass: 6, value: 980, mat: 'metal', tags: ['weapon', 'unique'], weapon: { dmg: 14, speed: 75, reach: 15, mods: [{ key: 'dmg.armourBreak', op: 'flag', value: true }] }, art: 'sword',
      text: 'Reach and armour break together.' },
    { id: 'shortbow', name: 'Shortbow', cat: 'weapons', stack: 1, mass: 1, value: 300, mat: 'wood', tags: ['weapon', 'ranged', 'unique'], weapon: { dmg: 7, speed: 100, reach: 80 }, art: 'sword', text: 'Shoots 8 tiles: husks fall before they reach the door.' },
    { id: 'longbow', name: 'Longbow', cat: 'weapons', stack: 1, mass: 2, value: 560, mat: 'wood', tags: ['weapon', 'ranged', 'unique'], weapon: { dmg: 10, speed: 80, reach: 120 }, art: 'sword', text: 'Shoots 12 tiles.' },
    { id: 'crossbow', name: 'Crossbow', cat: 'weapons', stack: 1, mass: 3, value: 900, mat: 'wood', tags: ['weapon', 'ranged', 'unique'], weapon: { dmg: 14, speed: 50, reach: 100, mods: [{ key: 'dmg.pierce', op: 'flag', value: true }] }, art: 'sword',
      text: 'Slow, but its bolt pierces armour.' },
    // ---- Tools (carried: their modifiers apply to the work) ----
    { id: 'fellingaxe', name: 'Felling axe', cat: 'tools', stack: 1, mass: 3, value: 200, mat: 'metal', tags: ['tool', 'unique'], mods: [{ key: 'work.chop', op: 'pct', value: 25 }], art: 'axe' },
    { id: 'hammer', name: 'Hammer', cat: 'tools', stack: 1, mass: 2, value: 160, mat: 'metal', tags: ['tool', 'unique'], mods: [{ key: 'work.build', op: 'pct', value: 15 }], art: 'hammer' },
    { id: 'sickle', name: 'Sickle', cat: 'tools', stack: 1, mass: 1, value: 150, mat: 'metal', tags: ['tool', 'unique'], mods: [{ key: 'work.grow', op: 'pct', value: 20 }], art: 'hoe' },
    { id: 'tongs', name: 'Smith\'s tongs', cat: 'tools', stack: 1, mass: 2, value: 170, mat: 'metal', tags: ['tool', 'unique'], mods: [{ key: 'work.smith', op: 'pct', value: 15 }], art: 'gear' },
    { id: 'needles', name: 'Needle set', cat: 'tools', stack: 1, mass: 1, value: 120, mat: 'metal', tags: ['tool', 'unique'], mods: [{ key: 'work.tailor', op: 'pct', value: 15 }], art: 'gear' },
    { id: 'surgeonkit', name: 'Surgeon\'s kit', cat: 'tools', stack: 1, mass: 2, value: 600, mat: 'metal', tags: ['tool', 'unique'], mods: [{ key: 'tend.quality', op: 'pct', value: 20 }], art: 'heart' },
    // ---- Furniture (installable; section 7) ----
    { id: 'bedroll', name: 'Bedroll', cat: 'furniture', stack: 1, mass: 4, value: 90, mat: ['wood', 'cloth', 'hide'], tags: ['installable', 'unique'], art: 'bed', text: 'Straw or cloth on the floor: better than the ground.' },
    { id: 'cot', name: 'Cot', cat: 'furniture', stack: 1, mass: 15, value: 300, mat: 'wood', tags: ['installable', 'unique'], art: 'bed' },
    { id: 'doublebed', name: 'Double bed', cat: 'furniture', stack: 1, mass: 50, value: 1000, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'bed' },
    { id: 'bunk', name: 'Bunk', cat: 'furniture', stack: 1, mass: 40, value: 800, mat: 'wood', tags: ['installable', 'unique'], art: 'bed' },
    { id: 'wardrobe', name: 'Wardrobe', cat: 'furniture', stack: 1, mass: 30, value: 600, mat: 'wood', tags: ['installable', 'unique'], art: 'crate' },
    { id: 'endtable', name: 'End table', cat: 'furniture', stack: 1, mass: 12, value: 300, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'table' },
    { id: 'shelf', name: 'Shelf', cat: 'furniture', stack: 1, mass: 18, value: 360, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'crate' },
    { id: 'longtable', name: 'Long table', cat: 'furniture', stack: 1, mass: 45, value: 900, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'table' },
    { id: 'stool', name: 'Stool', cat: 'furniture', stack: 1, mass: 5, value: 120, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'chair' },
    { id: 'bench', name: 'Bench', cat: 'furniture', stack: 1, mass: 15, value: 300, mat: ['wood', 'stone'], tags: ['installable', 'unique'], art: 'chair' },
    { id: 'cradle', name: 'Cradle', cat: 'furniture', stack: 1, mass: 12, value: 360, mat: 'wood', tags: ['installable', 'unique'], art: 'bed' },
    { id: 'medbed', name: 'Infirmary bed', cat: 'furniture', stack: 1, mass: 30, value: 760, mat: 'wood', tags: ['installable', 'unique'], art: 'bed' },
    { id: 'sarcophagus', name: 'Sarcophagus', cat: 'furniture', stack: 1, mass: 60, value: 700, mat: 'stone', tags: ['installable', 'unique'], art: 'skull' },
    { id: 'waystone', name: 'Waystone', cat: 'furniture', stack: 1, mass: 50, value: 1200, mat: 'stone', tags: ['installable', 'unique'], art: 'beacon', text: 'A carved stone with a gem set in it: it claims land around it.' },
    // ---- Art (installable statues, wall hangings, jewellery as trinkets) ----
    { id: 'statue', name: 'Small statue', cat: 'art', stack: 1, mass: 25, value: 900, mat: ['stone', 'wood', 'metal'], tags: ['installable', 'unique', 'art', 'trade'], art: 'trophy',
      text: 'Carved after a Chronicle moment; beauty by quality.' },
    { id: 'bigstatue', name: 'Grand statue', cat: 'art', stack: 1, mass: 90, value: 3000, mat: ['stone', 'metal'], tags: ['installable', 'unique', 'art', 'trade'], art: 'trophy' },
    { id: 'figurine', name: 'Figurine', cat: 'art', stack: 1, mass: 1, value: 160, mat: ['stone', 'mineral'], tags: ['unique', 'art', 'trade'], art: 'trophy', text: 'Small carved work for traders.' },
    { id: 'tapestry', name: 'Tapestry', cat: 'art', stack: 1, mass: 4, value: 1100, mat: 'cloth', tags: ['installable', 'unique', 'art', 'trade'], art: 'banner' },
    { id: 'banner', name: 'Banner', cat: 'art', stack: 1, mass: 2, value: 420, mat: 'cloth', tags: ['installable', 'unique', 'art'], art: 'banner', text: 'The hold\'s colours: beauty, and a rallying point for soldiers.' },
    { id: 'ring', name: 'Ring', cat: 'art', stack: 1, mass: 0, value: 900, mat: 'metal', slot: 'trinket', tags: ['unique', 'art', 'trade'], art: 'gold' },
    { id: 'amulet', name: 'Amulet', cat: 'art', stack: 1, mass: 0, value: 1800, mat: 'metal', slot: 'trinket', tags: ['unique', 'art', 'trade'], art: 'gold' },
    { id: 'circlet', name: 'Circlet', cat: 'art', stack: 1, mass: 1, value: 3200, mat: 'metal', slot: 'trinket', tags: ['unique', 'art', 'trade'], art: 'crown' },
    // ---- Trade goods ----
    { id: 'coins', name: 'Coins', cat: 'coins', stack: 500, mass: 0, value: 10, tags: ['trade'], art: 'gold', text: 'Struck silver and gold: what traders want.' },
    { id: 'finepottery', name: 'Fine pottery', cat: 'goods', stack: 1, mass: 3, value: 260, tags: ['unique', 'trade'], art: 'crate', text: 'Glazed ware for traders; value by quality.' },
    { id: 'book', name: 'Book', cat: 'goods', stack: 1, mass: 2, value: 1000, tags: ['unique', 'trade'], art: 'book', text: 'A copied book: joy to read, and a trader\'s prize.' },
    { id: 'vials', name: 'Glass vials', cat: 'goods', stack: 25, mass: 1, value: 30, tags: ['trade'], art: 'eye', text: 'Traders pay well for clear glass.' },
    // ---- Corpses ----
    { id: 'carcass', name: 'Carcass', cat: 'corpses', stack: 1, mass: 30, value: 20, tags: ['corpse', 'unique'], art: 'skull', text: 'A slain animal. A butcher cuts it into meat, hide, bone and tallow.' },
    { id: 'corpse', name: 'Corpse', cat: 'corpses', stack: 1, mass: 60, value: 0, tags: ['corpse', 'unique'], art: 'skull', text: 'Bury the dead, or they may rise as Husks.' },
    // ---- Stage Z2.4 (EMBERCROWN-FORTRESS.md 3.7, appended): the deep chains and the surviving add-ons ----
    // (the chain items in traded categories, and the forge add-ons' gear, are STAGED below)
    // Ember salts: steel and ember salts make embersteel at an ember forge
    { id: 'embersalts', name: 'Ember salts', cat: 'ore', stack: 50, mass: 1, value: 30, tags: ['deep'], art: 'flame', text: 'A crust from the ember layer. Steel and ember salts make embersteel at an ember forge.' },
    // Lye and soap
    { id: 'ash', name: 'Ash', cat: 'parts', stack: 75, mass: 1, value: 1, tags: ['component'], art: 'flame', text: 'Wood ash from the charcoal kiln. The apothecary leaches lye from it.' },
    { id: 'lye', name: 'Lye', cat: 'parts', stack: 25, mass: 1, value: 6, tags: ['component'], art: 'eye', text: 'Leached from ash. With tallow it makes soap.' },
    { id: 'soap', name: 'Soap', cat: 'parts', stack: 25, mass: 1, value: 10, tags: ['component'], art: 'heart', text: 'An infirmary stocked with soap is kept half as dirty again.' },
    // Glass and clay
    { id: 'lens', name: 'Lens', cat: 'glass', stack: 25, mass: 0, value: 40, tags: ['component'], art: 'eye', text: 'Ground glass: survey lenses and observatory parts.' },
    { id: 'glasslantern', name: 'Glass lantern', cat: 'parts', stack: 10, mass: 1, value: 45, tags: ['component'], art: 'beacon', text: 'A glazed lantern: lantern posts and light mirrors take them.' },
    { id: 'urn', name: 'Storage urn', cat: 'furniture', stack: 1, mass: 8, value: 120, tags: ['unique'], art: 'crate', text: 'A sealed clay urn: food stored in it rots half as fast.' },
    { id: 'burialurn', name: 'Burial urn', cat: 'furniture', stack: 1, mass: 6, value: 160, tags: ['unique'], art: 'skull', text: 'A glazed urn for the ashes of the dead: a crypt slot without a sarcophagus.' },
    { id: 'keystone', name: 'Keystone bricks', cat: 'parts', stack: 50, mass: 1, value: 10, mat: 'stone', tags: ['component'], art: 'wall', text: 'Wedge bricks from the vault kiln: a brick vault is built of them.' },
    // Shell and bone crafts
    { id: 'bonecraft', name: 'Bone and shell craft', cat: 'goods', stack: 10, mass: 1, value: 60, tags: ['trade'], art: 'trophy', text: 'Combs, beads and carved shell: small goods for traders.' },
    // The Herbalist's set
    { id: 'calmingtea', name: 'Calming tea', cat: 'parts', stack: 10, mass: 1, value: 15, shelfD: 30, tags: ['component'], art: 'heart',
      text: 'The herbalist\'s tea: handed to a sulking or binging colonist, it ends a minor break.' },
  ],
  zonePreset: [
    { id: 'all', name: 'All', cats: ['raw', 'materials', 'food', 'medicine', 'apparel', 'weapons', 'armour', 'tools', 'furniture', 'art', 'gems', 'coins', 'goods'], pri: 1,
      text: 'Takes everything except chunks and corpses.' },
    { id: 'raw', name: 'Raw', cats: ['raw'], pri: 1, text: 'Wood, stone, ore and other raw goods.' },
    { id: 'goods', name: 'Workshop goods', cats: ['materials', 'furniture', 'tools'], pri: 1, text: 'Blocks, ingots and furniture waiting to be installed.' },
    { id: 'store', name: 'Food store', cats: ['food'], pri: 2, text: 'Food and drink, at higher priority.' },
    { id: 'armoury', name: 'Armoury', cats: ['weapons', 'armour', 'apparel'], pri: 1, text: 'Weapons, armour and clothes.' },
    { id: 'dump', name: 'Dump', cats: ['chunks', 'corpses'], pri: 0, text: 'Chunks and corpses, out of the way.' },
    // Stage 2
    { id: 'medicine', name: 'Medicine', cats: ['medicine', 'herbs'], pri: 2, text: 'Herbs, bandages and salves, near the infirmary.' },
    { id: 'valuables', name: 'Valuables', cats: ['gems', 'coins', 'art', 'goods'], pri: 1, text: 'Gems, coins, art and trade goods: keep them behind a door.' },
  ],
  outfit: [
    { id: 'worker', name: 'Worker', allow: ['apparel', 'tools'] },
    { id: 'soldier', name: 'Soldier', allow: ['apparel', 'armour', 'weapons'] },
    { id: 'any', name: 'Any' },
  ],
};

// Stage Z2.4 items STAGED for the Z2 switch (G moves them into DATA.item when the gate re-baselines): each is in a
// category a trader sells (rawfood, drink, fibre, animal, weapons, armour), and a new kind there changes caravan
// stock, so the v2 fixtures' continuation hashes. Every row validates against the item schema (renown.test).
export const STAGED = {
  item: [
    // Fungus brewing: drink for a hold that never sees the sun (dimroot ale is ale brewed from dimroot wort)
    { id: 'dimroot', name: 'Dimroot', cat: 'rawfood', stack: 75, mass: 1, value: 5, shelfD: 15, food: { kind: 'raw', nutr: 3 }, tags: ['deep'], art: 'food',
      text: 'A pale cave tuber. Edible raw; a brewery makes ale wort of it.' },
    { id: 'glowspirit', name: 'Glowcap spirit', cat: 'drink', stack: 25, mass: 1, value: 22, shelfD: 120, food: { kind: 'drink', nutr: 1, joy: 8 }, tags: ['trade', 'deep'], art: 'food',
      text: 'Glowcaps steeped and stilled: a faint light in the cup.' },
    // Silk and shell: the deep's cloth and armour
    { id: 'silk', name: 'Spider silk', cat: 'fibre', stack: 50, mass: 1, value: 12, tags: ['deep'], art: 'farm', text: 'Spun by tamed cave spiders on a Silk frame. A loom weaves it into spidersilk.' },
    { id: 'shell', name: 'Shell plates', cat: 'animal', stack: 25, mass: 2, value: 14, mat: 'hide', tags: ['deep'], art: 'shield', text: 'Cut from a shellback by the butcher: lamellar and ember-proof gear.' },
    // The forge's add-ons: the Weaponsmith's master set, the Armourer's stand (ember-proof gear), the hardening vat
    { id: 'warpick', name: 'War pick', cat: 'weapons', stack: 1, mass: 3, value: 700, mat: 'metal', tags: ['weapon', 'unique'], weapon: { dmg: 13, speed: 90, reach: 10, mods: [{ key: 'dmg.armour', op: 'pct', value: 25 }] }, art: 'pick',
      text: 'A smith-master\'s pick for war: it punches through plate.' },
    { id: 'glaive', name: 'Glaive', cat: 'weapons', stack: 1, mass: 4, value: 900, mat: 'metal', tags: ['weapon', 'unique'], weapon: { dmg: 14, speed: 85, reach: 15 }, art: 'sword',
      text: 'A blade on a pole: strikes from the second rank.' },
    { id: 'brigandine', name: 'Brigandine', cat: 'armour', stack: 1, mass: 8, value: 1500, mat: 'metal', slot: 'outer', wear: { armour: 24, insul: 3 }, tags: ['unique'], art: 'shield',
      text: 'Plates riveted inside cloth: refitted from what raiders leave behind.' },
    { id: 'lamellar', name: 'Lamellar', cat: 'armour', stack: 1, mass: 7, value: 900, mat: 'hide', slot: 'outer', wear: { armour: 20, insul: 2 }, tags: ['unique'], art: 'shield',
      text: 'Laced plates of hardened leather or shellback shell.' },
    { id: 'emberward', name: 'Emberward coat', cat: 'armour', stack: 1, mass: 8, value: 1600, mat: 'hide', slot: 'outer', wear: { armour: 18, insul: 0 }, tags: ['unique', 'deep'], art: 'shield',
      text: 'Shell plates sealed with ember salts: its wearer ignores Sweltering and ember splash.' },
    { id: 'emberhood', name: 'Emberward hood', cat: 'armour', stack: 1, mass: 2, value: 600, mat: 'hide', slot: 'head', wear: { armour: 10, insul: 0 }, tags: ['unique', 'deep'], art: 'shield',
      text: 'The coat\'s hood: the face kept from the ember\'s breath.' },
  ],
};
