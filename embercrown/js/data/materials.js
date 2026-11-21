// Materials (doc 6.1; owner G). A material is a property of items, walls, floors and furniture.
// hp, work and value are integer percents of the base def (100 = x1.0); beauty is added.
// Stage 1a: stone and wood; 1b: metals. Stage 2 (Camp to Village, 14.8): bronze, silver and gold,
// cloth (linen, wool), hide (leather, fur), the six gems, brick, and the two cavern and old-tree woods.
// Lumensteel comes with the Underdeep (Z3). Stage Z2.4: shankwood, spidersilk, shell, electrum, embersteel.
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
    // ---- Stage 2 (appended) ----
    { id: 'elderwood', name: 'Elderwood', group: 'wood', hp: 150, work: 120, beauty: 3, value: 300, tags: ['flammable', 'slow', 'fuel'], tint: '#6e4a2c' },
    { id: 'capwood', name: 'Capwood', group: 'wood', hp: 70, work: 80, beauty: 1, value: 100, tags: ['glows'], tint: '#7d8f8a' },
    { id: 'brick', name: 'Brick', group: 'stone', hp: 140, work: 90, beauty: 2, value: 110, tint: '#9c5a44' },
    { id: 'bronze', name: 'Bronze', group: 'metal', hp: 120, work: 100, beauty: 2, value: 300, tint: '#a8803e' },
    { id: 'silver', name: 'Silver', group: 'metal', hp: 80, work: 100, beauty: 4, value: 1000, tags: ['hollowbane'], vsHollow: 130, tint: '#c9ccd1' },
    { id: 'gold', name: 'Gold', group: 'metal', hp: 70, work: 100, beauty: 6, value: 2000, tags: ['soft'], tint: '#d8b04a' },
    { id: 'linen', name: 'Linen', group: 'cloth', hp: 100, work: 100, beauty: 1, value: 100, tags: ['flammable'], insul: 100, tint: '#d6ccb4' },
    { id: 'wool', name: 'Wool', group: 'cloth', hp: 110, work: 100, beauty: 1, value: 130, tags: ['flammable', 'warm'], insul: 150, tint: '#b9ad97' },
    { id: 'leather', name: 'Leather', group: 'hide', hp: 120, work: 100, beauty: 1, value: 150, tags: ['flammable'], insul: 120, armour: 110, tint: '#8a5a36' },
    { id: 'fur', name: 'Fur', group: 'hide', hp: 100, work: 100, beauty: 1, value: 200, tags: ['flammable', 'warm'], insul: 200, tint: '#6f5844' },
    { id: 'amber', name: 'Amber', group: 'gem', hp: 100, work: 100, beauty: 6, value: 1500, tint: '#d9902e' },
    { id: 'garnet', name: 'Garnet', group: 'gem', hp: 100, work: 100, beauty: 8, value: 2500, tint: '#8c2a36' },
    { id: 'sapphire', name: 'Sapphire', group: 'gem', hp: 100, work: 100, beauty: 12, value: 5000, tint: '#2f5aa6' },
    { id: 'emerald', name: 'Emerald', group: 'gem', hp: 100, work: 100, beauty: 12, value: 5500, tint: '#2f8a52' },
    { id: 'ruby', name: 'Ruby', group: 'gem', hp: 100, work: 100, beauty: 14, value: 7000, tint: '#b3263a' },
    { id: 'heartstone', name: 'Heartstone', group: 'gem', hp: 100, work: 100, beauty: 20, value: 12000, tags: ['glows', 'fuel'], fuelD: 10, tint: '#e2552e' },
    // ---- Stage Z2.4 (EMBERCROWN-FORTRESS.md 3.7, appended): the deep chains' materials ----
    // shankwood: greyshank felled in Cavern I (Z2.7's plant), a wood with no surface (beauty 1 below plain wood)
    { id: 'shankwood', name: 'Shankwood', group: 'wood', hp: 90, work: 100, beauty: 0, value: 90, tags: ['flammable', 'fuel'], tint: '#7a7f74' },
    // spidersilk: spun on a Silk frame (the Silkhouse add-on) from the silk of tamed cave spiders
    { id: 'spidersilk', name: 'Spidersilk', group: 'cloth', hp: 150, work: 110, beauty: 3, value: 450, tags: ['flammable'], insul: 110, armour: 115, tint: '#e4e2da' },
    // shell: shellback plates from the butcher (a hide-group material: lamellar, ember-proof gear)
    { id: 'shell', name: 'Shell', group: 'hide', hp: 160, work: 120, beauty: 2, value: 260, insul: 80, armour: 140, tint: '#8f7f62' },
    // electrum: silver and gold at the Alloyer's crucible; keeps silver's bite against the Hollow
    { id: 'electrum', name: 'Electrum', group: 'metal', hp: 90, work: 100, beauty: 5, value: 1500, tags: ['hollowbane'], vsHollow: 120, tint: '#d9c27a' },
    // embersteel: steel and ember salts, made only at an ember forge (built beside an ember pool)
    { id: 'embersteel', name: 'Embersteel', group: 'metal', hp: 260, work: 160, beauty: 3, value: 1400, tags: ['glows'], tint: '#c4553a' },
  ],
};
