// Materials (doc 6.1; owner G). A material is a property of items, walls, floors and furniture.
// hp, work and value are integer percents of the base def (100 = x1.0); beauty is added.
// Stage 0: sample entries; the full 6.1 table lands in Stage 1a (stone and wood) and 1b (metals).
export const DATA = {
  material: [
    { id: 'wood', name: 'Wood', group: 'wood', hp: 100, work: 100, beauty: 1, value: 100, tags: ['flammable', 'fuel'], tint: '#9a6b3f' },
    { id: 'granite', name: 'Granite', group: 'stone', hp: 170, work: 140, beauty: 1, value: 120, tint: '#8c8784' },
    { id: 'iron', name: 'Iron', group: 'metal', hp: 140, work: 120, beauty: 1, value: 300, tint: '#7b7f86' },
    { id: 'steel', name: 'Steel', group: 'metal', hp: 200, work: 140, beauty: 1, value: 600, tint: '#a9b0b8' },
  ],
};
