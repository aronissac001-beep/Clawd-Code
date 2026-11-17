// Rooms: role detection, impressiveness tiers and room stamps (doc 7.11, 10.11; owner G, logic B).
// Roles match in `order` (lowest first); thoughts are the six tier thoughts (Squalid..Majestic).
// Stamps (14.6 slice: Bedroom, Store, Workshop, Plain room): walls, a door and floors, then the
// furnish list inside (a zone def paints that zone over the interior with the stamp's preset).
export const DATA = {
  room: [
    { id: 'bedroom', name: 'Bedroom', order: 40, match: { any: ['bed'], count: 1 }, thoughts: [-4, 0, 2, 4, 6, 8] },
    { id: 'kitchen', name: 'Kitchen', order: 60, match: { any: ['campfire'] } },
    { id: 'workshop', name: 'Workshop', order: 70, match: { workbench: true } },
    { id: 'hall', name: 'Hall', order: 100, match: { fallback: true } },
  ],
  roomTier: [
    { id: 'squalid', name: 'Squalid', min: 0 },
    { id: 'plain', name: 'Plain', min: 20 },
    { id: 'decent', name: 'Decent', min: 40 },
    { id: 'fine', name: 'Fine', min: 65 },
    { id: 'grand', name: 'Grand', min: 90 },
    { id: 'majestic', name: 'Majestic', min: 130 },
  ],
  stamp: [
    { id: 'bedroom', name: 'Bedroom', room: 'bedroom', minSize: 3, furnish: [{ def: 'bed' }] },
    { id: 'workshop', name: 'Workshop', room: 'workshop', minSize: 3, bench: true, furnish: [] },
    { id: 'store', name: 'Store', room: 'hall', minSize: 3, preset: 'all', furnish: [{ def: 'stockpile' }] },
    { id: 'plain', name: 'Plain room', room: 'hall', minSize: 3, furnish: [] },
  ],
};
