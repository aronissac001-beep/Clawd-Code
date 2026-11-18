// Starts (doc 8.5; owner G). band: one entry per colonist (anc or any, optional skill floor);
// items: the starting stock (food for about 6 days at 33 a colonist a day: meals 20, raw food 4 a unit,
// so the first grow zone and campfire matter by day 5); map: generation preferences (biome ids from biomes.js).
export const DATA = {
  start: [
    { id: 'hearthwatch', name: 'Hearthwatch Remnant', default: true,
      band: [{ anc: 'human', req: { skill: 'construction', min: 6 } }, { anc: 'human' }, { anc: 'human' }],
      items: { wood: 300, meal: 12, 'ingot:steel': 20, hearthroot: 120 }, map: { biome: 'greenvale', mountainD: 6 },
      story: { firstMajorD: 3 }, text: 'Three survivors of the old watch. A balanced start, and the tutorial.' },
    { id: 'deepforge', name: 'Deepforge Delve',
      band: [{ anc: 'deepforge' }, { anc: 'deepforge' }, { anc: 'human' }],
      items: { wood: 150, meal: 10, 'ingot:iron': 30, 'stone:granite': 60, hearthroot: 100 }, map: { biome: 'greenvale', mountainD: 0, cavernD: 25 },
      story: { firstMajorD: 4 }, text: 'Start against the mountain face: a miner and smith opening, with fewer trees.' },
    { id: 'lone_ember', name: 'Lone Ember', hard: true, band: [{ any: true }], items: { wood: 50, meal: 6, hearthroot: 40 }, map: { biome: 'greenvale' },
      story: { firstMajorD: 4, wandererD: 3 }, text: 'One colonist of your choice. The storyteller sends a wanderer within 3 days.' },
  ],
};
