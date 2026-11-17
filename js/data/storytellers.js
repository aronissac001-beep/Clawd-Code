// Storytellers (doc 9.1). OWNER H.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  storyteller: [
    { id: 'steady', name: 'The Steady Flame', default: true, majorD: [5, 7], warnH: [12, 24], minors: [3, 3], boons: [3, 3], ptsPct: 100, floorPct: 100,
      text: 'Majors every 5 to 7 days with long warnings. The default.' },
    { id: 'long_night', name: 'The Long Night', majorD: [4, 6], warnH: [6, 12], minors: [4, 4], boons: [2, 2], ptsPct: 130, floorPct: 200,
      text: 'For veterans: harder, more often, shorter warnings.' },
  ],
};
