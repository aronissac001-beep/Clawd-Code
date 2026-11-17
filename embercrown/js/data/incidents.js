// Incidents (schema C12 is H in js/game/threat/incidents.js; data fields per C11) (doc 9.1). OWNER H.
// Stage 0 placeholder written by workstream G so every 13.4 file exists and validate-data checks
// the C11 schema end to end. The owner replaces these sample entries freely (keep export DATA).
export const DATA = {
  incident: [
    { id: 'hollow_horde', cat: 'major', minTier: 'camp', seasons: 'TBAD', weight: 10, cooldownD: 3, pts: { min: 40, mult: 100 }, warnH: [12, 24],
      arrive: 'night', tags: ['hollow'], after: ['blight_scar'], letter: 'inc_hollow_horde' },
    { id: 'sapper_raid', cat: 'major', minTier: 'village', seasons: 'TBAD', weight: 6, cooldownD: 8, pts: { min: 150, mult: 100 }, warnH: [12, 24],
      arrive: 'night', tags: ['sapper', 'thief'], letter: 'inc_sapper_raid' },
    { id: 'siege', cat: 'major', minTier: 'hold', seasons: 'TBA', weight: 4, cooldownD: 20, pts: { min: 600, mult: 120 }, warnH: [24, 36],
      arrive: 'day', tags: ['siege', 'reaver'], after: ['siege_camp'], letter: 'inc_siege' },
  ],
};
