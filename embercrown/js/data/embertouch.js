// Ember-touched demand tables (doc 4.5). OWNER F.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  emberDemand: [
    { id: 'smithing_camp', skill: 'smithing', tier: 'camp', mats: { 'ingot:iron': 20, coal: 10 }, deep: { 'ingot:steel': 5 } },
    { id: 'masonry_camp', skill: 'masonry', tier: 'camp', mats: { 'block:granite': 40 }, deep: { 'ingot:iron': 5 } },
  ],
};
