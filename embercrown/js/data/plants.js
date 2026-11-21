// Plants: trees, bushes, crops and wild plants (doc 3.2 step 7, 6.5; OWNER B).
// The value in the `plant` tile layer is the index in DATA.plant plus 1 (0 = none), so this list is
// APPEND-ONLY (the layer is saved).
// `growth` (tile layer) runs 0-255: 255 is mature (choppable / harvestable); days = days to mature.
// Yields are the full-grown amounts; a younger plant yields growth / 255 of them (rounded down,
// at least 1 once half grown).
// Stage 1a: the two trees and hearthroot. Stage 2 (G's food chain, 6.5): berry bushes (wild, they
// regrow after picking), grain, greens and flax (sown in grow zones), healing herbs (wild and sown)
// and glowcaps (a cave mushroom sown underground in the dark). minTemp: growth stops below it, and an
// annual crop dies of frost WORLD.weather.frostKillBelow degrees under it (plants.js).
export const DATA = {
  plant: [
    { id: 'oak', name: 'Oak', kind: 'tree', days: 30, yield: { wood: 25 }, minTemp: 0, sow: false, art: 'plant.oak' },
    { id: 'pine', name: 'Pine', kind: 'tree', days: 26, yield: { wood: 20 }, minTemp: -10, sow: false, art: 'plant.pine' },
    { id: 'hearthroot', name: 'Hearthroot', kind: 'crop', days: 6, yield: { hearthroot: 10 }, minTemp: 0, sow: true, art: 'plant.hearthroot' },
    // Stage 2 (append only)
    { id: 'berry', name: 'Berry bush', kind: 'bush', days: 8, yield: { berries: 8 }, minTemp: 0, sow: false, perennial: true, art: 'plant.berry' },
    { id: 'grain', name: 'Grain', kind: 'crop', days: 10, yield: { grain: 12 }, minTemp: 4, sow: true },
    { id: 'greens', name: 'Greens', kind: 'crop', days: 5, yield: { greens: 8 }, minTemp: 2, sow: true },
    { id: 'flax', name: 'Flax', kind: 'crop', days: 9, yield: { flax: 8 }, minTemp: 4, sow: true },
    { id: 'herb', name: 'Healing herb', kind: 'wild', days: 8, yield: { herbs: 4 }, minTemp: 2, sow: true },
    { id: 'glowcap', name: 'Glowcap', kind: 'wild', days: 7, yield: { glowcap: 6 }, minTemp: 4, sow: true, underground: true, dark: true },
    // Stage Z2.7 (EMBERCROWN-FORTRESS.md 2.10, 3.7; append only): the cavern flora of the Glowcap Hollows and the
    // Sunless Mere. `underground` plants need no light and grow (and are sown) on cave loam (plants.js caveLoam).
    // Greyshank is the giant grey fungus of Cavern I: felled like a tree, it yields shankwood (plants.js CAVE.mat
    // until the plant schema has `mat`). Mere-reed is the Mere's cloth fibre (flax until a reed item exists);
    // shore lichen glows faintly on the Mere's shores (light 1 once light.js reads plant light).
    { id: 'greyshank', name: 'Greyshank', kind: 'tree', days: 24, yield: { wood: 18 }, minTemp: 2, sow: false, underground: true },
    { id: 'merereed', name: 'Mere-reed', kind: 'wild', days: 9, yield: { flax: 6 }, minTemp: 2, sow: true, underground: true, perennial: true },
    { id: 'lichen', name: 'Shore lichen', kind: 'wild', days: 12, yield: { herbs: 1 }, minTemp: 0, sow: false, underground: true, perennial: true },
    // Z2 switch (append only): dimroot, the Mere's brewing tuber, a cave crop
    { id: 'dimroot', name: 'Dimroot', kind: 'crop', days: 8, yield: { dimroot: 10 }, minTemp: 2, sow: true, underground: true },
  ],
};

// Stage Z2.7 rows once STAGED: in DATA.plant since the Z2 switch (the export stays, empty, for old readers).
export const STAGED = { plant: [] };

/** Plant layer codes by id (index + 1). */
export const PLANT_CODE = Object.freeze(Object.fromEntries(DATA.plant.map((p, i) => [p.id, i + 1])));
