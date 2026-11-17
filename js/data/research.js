// Research: eras and techs (doc 7.12; owner G, logic K). cost in lore points; discover halves or
// zeroes the cost when an event happens (event names are C8, core/events.js).
export const DATA = {
  era: [
    { id: 'kindling', name: 'Kindling', tier: 'camp' },
    { id: 'hearth', name: 'Hearth', tier: 'hamlet' },
    { id: 'hold', name: 'Hold', tier: 'village' },
    { id: 'crown', name: 'Crown', tier: 'hold' },
  ],
  tech: [
    { id: 'masonry', name: 'Masonry', era: 'kindling', cost: 0, text: 'Mason bench, stone blocks and stone walls.' },
    { id: 'carpentry', name: 'Carpentry', era: 'kindling', cost: 0, text: 'Carpenter bench, beds and tables.' },
    { id: 'smelting', name: 'Smelting', era: 'hearth', cost: 200, discover: { event: 'oreFound', effect: 'free' }, text: 'Bloomery: ore becomes ingots.' },
  ],
};
