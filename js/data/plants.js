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
  ],
};

/** Plant layer codes by id (index + 1). */
export const PLANT_CODE = Object.freeze(Object.fromEntries(DATA.plant.map((p, i) => [p.id, i + 1])));
