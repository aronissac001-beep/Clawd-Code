// Plants: trees, bushes, crops and wild plants (doc 3.2 step 7, 6.5; OWNER B).
// The value in the `plant` tile layer is the index in DATA.plant plus 1 (0 = none), so this list is
// APPEND-ONLY (the layer is saved).
// `growth` (tile layer) runs 0-255: 255 is mature (choppable / harvestable); days = days to mature.
// Yields are the full-grown amounts; a younger plant yields growth / 255 of them (rounded down,
// at least 1 once half grown).
// Stage 1a: the two trees and hearthroot. Berry bushes, grass tufts, glowcaps and wild herbs are
// appended in Stage 1b, when their items exist (a yield must name an item, C11).
export const DATA = {
  plant: [
    { id: 'oak', name: 'Oak', kind: 'tree', days: 30, yield: { wood: 25 }, minTemp: 0, sow: false, art: 'plant.oak' },
    { id: 'pine', name: 'Pine', kind: 'tree', days: 26, yield: { wood: 20 }, minTemp: -10, sow: false, art: 'plant.pine' },
    { id: 'hearthroot', name: 'Hearthroot', kind: 'crop', days: 6, yield: { hearthroot: 10 }, minTemp: 0, sow: true, art: 'plant.hearthroot' },
  ],
};

/** Plant layer codes by id (index + 1). */
export const PLANT_CODE = Object.freeze(Object.fromEntries(DATA.plant.map((p, i) => [p.id, i + 1])));
