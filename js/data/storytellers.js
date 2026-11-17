// Storytellers (doc 9.1). OWNER H.
// majorD: days between majors (rolled when one ends); warnH: omen lead in hours; minors and boons
// per 10 days (Stage 2); ptsPct: threat points; floorPct: how fast the points floor rises.
export const DATA = {
  storyteller: [
    { id: 'steady', name: 'The Steady Flame', default: true, majorD: [5, 7], warnH: [12, 24], minors: [3, 3], boons: [3, 3], ptsPct: 100, floorPct: 100,
      text: 'Majors every 5 to 7 days with long warnings. The default.' },
    { id: 'wandering', name: 'The Wandering Ember', majorD: [2, 11], warnH: [6, 24], minors: [2, 6], boons: [2, 6], ptsPct: 100, floorPct: 100,
      text: 'Majors any time from 2 to 11 days apart, never two within 2 days. For stories and surprises.' },
    { id: 'long_night', name: 'The Long Night', majorD: [4, 6], warnH: [6, 12], minors: [4, 4], boons: [2, 2], ptsPct: 130, floorPct: 200,
      text: 'For veterans: harder, more often, shorter warnings.' },
  ],
};
