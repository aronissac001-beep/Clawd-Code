// Materials (doc 6.1; owner G). A material is a property of items, walls, floors and furniture.
// hp, work and value are integer percents of the base def (100 = x1.0); beauty is added.
// Stage 0: sample entries; the full 6.1 table lands in Stage 1a (stone and wood) and 1b (metals).
export const DATA = {
  material: [
    { id: 'wood', name: 'Wood', group: 'wood', hp: 100, work: 100, beauty: 1, value: 100, tags: ['flammable', 'fuel'], tint: '#9a6b3f' },
    { id: 'sandstone', name: 'Sandstone', group: 'stone', hp: 120, work: 100, beauty: 1, value: 100, tint: '#b89a6e' },
    { id: 'limestone', name: 'Limestone', group: 'stone', hp: 130, work: 100, beauty: 1, value: 100, tint: '#c2bba8' },
    { id: 'granite', name: 'Granite', group: 'stone', hp: 170, work: 140, beauty: 1, value: 120, tint: '#8c8784' },
    { id: 'slate', name: 'Slate', group: 'stone', hp: 150, work: 140, beauty: 2, value: 120, tint: '#5d6470' },
    { id: 'basalt', name: 'Basalt', group: 'stone', hp: 190, work: 160, beauty: 1, value: 130, tint: '#45464a' },
    { id: 'marble', name: 'Marble', group: 'stone', hp: 120, work: 130, beauty: 4, value: 200, tint: '#dcd8d2' },
    { id: 'duskstone', name: 'Duskstone', group: 'stone', hp: 220, work: 190, beauty: 2, value: 250, tint: '#3b3348' },
    { id: 'copper', name: 'Copper', group: 'metal', hp: 90, work: 100, beauty: 1, value: 200, tint: '#b8734a' },
    { id: 'tin', name: 'Tin', group: 'metal', hp: 80, work: 100, beauty: 1, value: 150, tint: '#a7aaa6' },
    { id: 'iron', name: 'Iron', group: 'metal', hp: 140, work: 120, beauty: 1, value: 300, tint: '#7b7f86' },
    { id: 'steel', name: 'Steel', group: 'metal', hp: 200, work: 140, beauty: 1, value: 600, tint: '#a9b0b8' },
  ],
};
