// Deeds: the hold's lasting goals and Chronicle highlights (owner G, logic K in colony/deeds.js;
// replaces the roguelite achievements). goal counts an event (C8 names, core/events.js).
export const DATA = {
  deed: [
    { id: 'first_night', name: 'Through the first night', cat: 'founding', goal: { event: 'raidEnd', n: 1 }, text: 'Repel the first Hollow horde.' },
    { id: 'deep_seam', name: 'A seam of iron', cat: 'depth', goal: { event: 'oreFound', n: 1, k: 'iron' }, text: 'Find the first iron vein.' },
    { id: 'masterwork', name: 'A masterwork', cat: 'craft', goal: { event: 'masterwork', n: 1 }, text: 'Craft the first Masterwork.' },
  ],
};
