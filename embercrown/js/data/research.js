// Research: eras and techs (doc 7.12; owner G, logic K). cost in lore points; discover halves or
// zeroes the cost when an event happens (event names are C8, core/events.js; k narrows it to one
// kind, as deed goals do).
// The tech list is POSITIONAL: s.colony.techs is a bitset by index in this list (K, research.js), so
// it is APPEND ONLY. Stage 2 (14.8 row G): the Kindling, Hearth and Hold eras, Mechanisms included.
// The Crown era (Hold tier) lands in Stage 3.
// Deviation from the 7.12 table: the bloomery's own tech, Bloomery smelting, is a Kindling tech
// (the 1b bloomery is a Camp building, and Hearth level 2, which Hamlet needs, costs iron), free
// on the first ore. Smelting stays the Hearth-era tech of 7.12 and opens the alloys (bronze).
export const DATA = {
  era: [
    { id: 'kindling', name: 'Kindling', tier: 'camp' },
    { id: 'hearth', name: 'Hearth', tier: 'hamlet' },
    { id: 'hold', name: 'Hold', tier: 'village' },
    { id: 'crown', name: 'Crown', tier: 'hold' },
  ],
  tech: [
    // 0-2: Stages 1a and 1b (do not move)
    { id: 'masonry', name: 'Masonry', era: 'kindling', cost: 0, text: 'Mason bench, stone blocks and stone walls.' },
    { id: 'carpentry', name: 'Carpentry', era: 'kindling', cost: 0, text: 'Carpenter bench, beds and tables.' },
    { id: 'smelting', name: 'Smelting', era: 'hearth', cost: 200, discover: { event: 'oreFound', effect: 'free' }, text: 'Alloys at the bloomery: copper and tin become bronze.' },
    // ---- Kindling (Camp) ----
    { id: 'cooking', name: 'Cooking', era: 'kindling', cost: 0, text: 'Campfire meals and the butcher\'s table.' },
    { id: 'fletching', name: 'Fletching', era: 'kindling', cost: 80, text: 'The fletcher\'s bench: shortbows and longbows.' },
    { id: 'tanning', name: 'Tanning', era: 'kindling', cost: 80, discover: { event: 'butchered', effect: 'free' }, text: 'The tannery: leather and fur. Free after the first butchering.' },
    { id: 'pottery', name: 'Pottery', era: 'kindling', cost: 80, discover: { event: 'oreFound', k: 'clay', effect: 'half' }, text: 'Potter\'s wheel and brick kiln: jars, fine pottery and bricks. Half cost once clay is mined.' },
    { id: 'charcoal', name: 'Charcoal', era: 'kindling', cost: 60, text: 'The charcoal kiln: wood becomes smelting fuel.' },
    { id: 'hunting', name: 'Hunting', era: 'kindling', cost: 60, text: 'Hunting game, the hunter\'s lodge and the fisher\'s hut.' },
    { id: 'herbalism', name: 'Herbalism', era: 'kindling', cost: 100, discover: { event: 'harvested', k: 'herbs', effect: 'half' }, text: 'The apothecary: poultices and candles. Half cost after the first herbs are picked.' },
    { id: 'roofing', name: 'Roofing', era: 'kindling', cost: 60, text: 'Build roofs over open ground; cottages and the palisade.' },
    // ---- Hearth (Hamlet) ----
    { id: 'smithing', name: 'Smithing', era: 'hearth', cost: 250, text: 'Bronze, iron tools, axes, swords, helms, shields and iron bands.' },
    { id: 'brewing', name: 'Brewing', era: 'hearth', cost: 150, text: 'The brewery and fermenting casks: ale, mead and berry wine.' },
    { id: 'milling', name: 'Milling', era: 'hearth', cost: 150, text: 'The windmill, flour and bread.' },
    { id: 'weaving', name: 'Weaving', era: 'hearth', cost: 150, text: 'The loom: linen and wool cloth.' },
    { id: 'tailoring', name: 'Tailoring', era: 'hearth', cost: 150, text: 'The tailor\'s bench: clothes, leather gear, bandages and carpets.' },
    { id: 'husbandry', name: 'Animal husbandry', era: 'hearth', cost: 200, discover: { event: 'tamed', effect: 'half' }, text: 'Pens, coops, troughs and cheese. Half cost after the first taming.' },
    { id: 'smokehouse', name: 'Smokehouse', era: 'hearth', cost: 120, text: 'Smoked meat and fish keep six times as long; trail rations.' },
    { id: 'supports', name: 'Support pillars', era: 'hearth', cost: 120, discover: { event: 'caveRumble', effect: 'free' }, text: 'Mine headframes and stone doors. Free after the first cave-in warning.' },
    { id: 'watchtowers', name: 'Watchtowers', era: 'hearth', cost: 150, text: 'Archer platforms, barracks, the alarm bell and deadfalls.' },
    // ---- Hold (Village) ----
    { id: 'steel', name: 'Steel', era: 'hold', cost: 500, text: 'The blast furnace: steel, steel helms, tower shields and halberds.' },
    { id: 'glassblowing', name: 'Glassblowing', era: 'hold', cost: 300, text: 'The glassworks: glass, windows, lanterns and vials.' },
    { id: 'jewellery', name: 'Jewellery', era: 'hold', cost: 350, discover: { event: 'gemFound', effect: 'half' }, text: 'The jeweller: cut gems, rings, amulets and circlets. Half cost on the first gem.' },
    { id: 'sculpture', name: 'Sculpture', era: 'hold', cost: 300, text: 'The sculptor\'s studio: statues and figurines.' },
    { id: 'medicine2', name: 'Medicine II: salves', era: 'hold', cost: 300, text: 'Healing salves, sleeping draughts and the surgery table.' },
    { id: 'prospecting', name: 'Prospecting', era: 'hold', cost: 250, discover: { event: 'discovery', k: 'vault', effect: 'free' }, text: 'Silver and gold smelting and the survey table. Free on the first vault.' },
    { id: 'waterworks', name: 'Waterworks', era: 'hold', cost: 350, text: 'The watermill and the water wheel.' },
    { id: 'masonry2', name: 'Masonry II', era: 'hold', cost: 300, text: 'Reinforced walls, iron-bound gates and stone houses.' },
    { id: 'siegecraft', name: 'Siegecraft', era: 'hold', cost: 450, text: 'The ballista, the stone tower and the crossbow.' },
    { id: 'lanterns', name: 'Lantern-making', era: 'hold', cost: 250, text: 'Lantern posts, signal beacons and ward stones.' },
    { id: 'mechanisms', name: 'Mechanisms', era: 'hold', cost: 400, text: 'Levers, pressure plates, locked gates and linked deadfalls.' },
    // ---- Kindling, appended ----
    { id: 'bloomery', name: 'Bloomery smelting', era: 'kindling', cost: 60, discover: { event: 'oreFound', effect: 'free' }, text: 'The bloomery and the forge: ore and coal become ingots, ingots become picks and spears. Free once ore is found.' },
  ],
};
