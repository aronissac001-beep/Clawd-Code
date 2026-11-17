// Backstories (childhood and adult) (doc 4.1). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  backstory: [
    { id: 'mine_born', name: 'Mine-Born', slot: 'child', title: 'Miner', skills: { mining: 4, construction: 2 } },
    { id: 'crown_archivist', name: 'Crown Archivist', slot: 'adult', title: 'Archivist', skills: { lore: 5, social: 2 }, disables: ['mine', 'haul'] },
    { id: 'river_ferryman', name: 'River Ferryman', slot: 'adult', title: 'Ferryman', skills: { animals: 2, social: 2, construction: 2 } },
  ],
};
