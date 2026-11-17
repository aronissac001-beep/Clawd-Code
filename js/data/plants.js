// Plants: crops, trees and wild plants (doc 6.5). OWNER B.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  plant: [
    { id: 'hearthroot', name: 'Hearthroot', kind: 'crop', days: 6, yield: { hearthroot: 10 }, minTemp: 0, sow: true, art: 'plant.hearthroot' },
    { id: 'oak', name: 'Oak', kind: 'tree', days: 30, yield: { wood: 25 }, minTemp: 0, sow: false, art: 'plant.oak' },
  ],
};
