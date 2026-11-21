// Rooms: role detection, impressiveness tiers and room stamps (doc 7.11, 10.11; owner G, logic B).
// Roles match in `order` (lowest first); thoughts are the six tier thoughts (Squalid..Majestic).
// Stamps (14.6 slice: Bedroom, Store, Workshop, Plain room): walls, a door and floors, then the
// furnish list inside (a zone def paints that zone over the interior with the stamp's preset).
// Stage 2 (7.11; B's rooms with roles, stats and tiers): every Camp to Village role, the Cellar
// among them (casks or barrel racks underground; the Cooper's ageing comes with Stage 3 specs),
// and stamps for them. A stamp's `stage` is the build stage whose menus offer it (default 1a).
// HALLS (Z2.8, 3.13; js/game/colony/visitors.js reads them): the three halls that draw visitors. A hall is a room
// whose role is one of `roles` (or, with no `roles`, any room not in `notRoles`) at tier `minTier` or better that
// holds one finished building of every group in `has` (ids not yet in the content are skipped: a bar counter, an
// altar and a bookshelf are G requests), plus:
//   drink: the hold's stock of drink (items with food.kind 'drink') is at least this
//   books: at least this many books (items `bookKinds`) lie on shelf tiles (`shelves`) in the room
// The tavern takes the Dining role too: a table in the room makes it a dining hall (order 50 before 90), and the
// role order stays as it is so no existing room changes role.
// LOCKUP_ROLE (Z2.12, 3.9; js/game/colony/justice.js reads it): a room with a cell bed (and a door) is a Lockup,
// where the Warden of Law confines offenders. It sits before Bedroom so a cell with a cot in it stays a Lockup. The
// role is in DATA.room only while a `cellbed` structure exists (js/data/laws.js CELL_BED; a G request to add the
// row to structures/housing.js), so the registry never names a missing structure.
import { DATA as HOUSING } from './structures/housing.js';
export const LOCKUP_ROLE = Object.freeze({ id: 'lockup', name: 'Lockup', order: 38, match: { any: ['cellbed'] }, thoughts: [-3, -2, -1, 0, 1, 2],
  text: 'A cell bed behind a door: where the Warden of Law confines offenders.' });
const HAS_CELLBED = HOUSING.structure.some((r) => r.id === 'cellbed');

export const HALLS = Object.freeze([
  { id: 'tavern', name: 'Tavern', roles: ['tavern', 'dining'], minTier: 'plain', has: [['bar', 'tavern', 'dicetable', 'stage'], ['table', 'longtable']], drink: 5 },
  { id: 'temple', name: 'Temple', roles: ['temple'], minTier: 'plain', has: [['altar', 'shrine', 'temple']] },
  { id: 'library', name: 'Library', notRoles: ['bedroom', 'barracks', 'tomb', 'infirmary', 'nursery'], minTier: 'plain',
    has: [['desk', 'study', 'scriptorium']], shelves: ['bookshelf', 'shelf'], books: 5, bookKinds: ['book', 'tablet'] },
]);

export const DATA = {
  room: [
    { id: 'infirmary', name: 'Infirmary', order: 10, match: { any: ['infirmary', 'surgery'] }, thoughts: [-4, 0, 1, 2, 3, 4],
      text: 'Infirmary beds or a surgery table. Its tier improves tending.' },
    { id: 'barracks', name: 'Barracks', order: 20, match: { any: ['bunk', 'barracks'], count: 2 }, thoughts: [-4, -2, 0, 1, 2, 3],
      text: 'Two bunks or more. Soldiers mind it less than others.' },
    ...(HAS_CELLBED ? [LOCKUP_ROLE] : []),
    { id: 'bedroom', name: 'Bedroom', order: 40, match: { any: ['bed', 'doublebed', 'cot', 'bedroll'], count: 1 }, thoughts: [-4, 0, 2, 4, 6, 8] },
    // Z2.8 (3.13): a room with cradles and no bed; newborns are laid in its cradles
    { id: 'nursery', name: 'Nursery', order: 45, match: { any: ['cradle'] }, thoughts: [-3, 0, 1, 2, 3, 5],
      text: 'Cradles and no beds: where the hold\'s youngest sleep.' },
    { id: 'dining', name: 'Dining hall', order: 50, match: { any: ['table', 'longtable'] }, thoughts: [-3, 0, 2, 4, 6, 9],
      text: 'A table and seats, and no beds.' },
    { id: 'kitchen', name: 'Kitchen', order: 60, match: { any: ['campfire', 'stove'] }, thoughts: [-2, 0, 1, 2, 3, 4],
      text: 'A campfire or a stove. A clean kitchen poisons fewer meals.' },
    { id: 'workshop', name: 'Workshop', order: 70, match: { workbench: true }, thoughts: [-2, 0, 1, 2, 3, 4],
      text: 'A workbench. Fine and better workshops add quality to what is made there.' },
    { id: 'cellar', name: 'Cellar', order: 75, match: { any: ['cask', 'barrelrack'], underground: true }, thoughts: [0, 0, 1, 2, 3, 4],
      text: 'Casks or barrel racks underground: food and drink keep cool.' },
    { id: 'storeroom', name: 'Storeroom', order: 80, match: { any: ['shelf', 'granary', 'stockpile', 'strongbox'] }, thoughts: [0, 0, 0, 1, 2, 3],
      text: 'Shelves or a stockpile over most of the floor.' },
    { id: 'temple', name: 'Temple', order: 85, match: { any: ['shrine', 'temple'] }, thoughts: [-2, 0, 2, 3, 4, 6], text: 'A shrine or a temple.' },
    { id: 'tavern', name: 'Tavern', order: 90, match: { any: ['dicetable', 'tavern', 'stage'] }, thoughts: [-2, 0, 2, 3, 5, 7], text: 'Games, music or a tap.' },
    { id: 'tomb', name: 'Tomb', order: 95, match: { any: ['grave', 'sarcophagus', 'crypt'] }, thoughts: [-3, -1, 0, 1, 2, 3], text: 'Where the dead lie.' },
    { id: 'hall', name: 'Hall', order: 100, match: { fallback: true } },
  ],
  roomTier: [
    { id: 'squalid', name: 'Squalid', min: 0 },
    { id: 'plain', name: 'Plain', min: 20 },
    { id: 'decent', name: 'Decent', min: 40 },
    // (Z2: 60, was 65: a 5 x 5 bedroom with two beds, a flagstone floor, a wardrobe, an end table and a sconce scores
    // 61; at 65 it took fine-quality furniture or statues, and Fine gates births, so no ordinary hold had a child)
    { id: 'fine', name: 'Fine', min: 60 },
    { id: 'grand', name: 'Grand', min: 90 },
    { id: 'majestic', name: 'Majestic', min: 130 },
  ],
  stamp: [
    { id: 'bedroom', name: 'Bedroom', room: 'bedroom', minSize: 3, furnish: [{ def: 'bed' }] },
    { id: 'workshop', name: 'Workshop', room: 'workshop', minSize: 3, bench: true, furnish: [] },
    { id: 'store', name: 'Store', room: 'hall', minSize: 3, preset: 'all', furnish: [{ def: 'stockpile' }] },
    { id: 'plain', name: 'Plain room', room: 'hall', minSize: 3, furnish: [] },
    // Stage 2
    { id: 'dining', name: 'Dining hall', room: 'dining', minSize: 4, furnish: [{ def: 'table', per: 12 }, { def: 'chair', per: 6 }], stage: '2' },
    { id: 'kitchen', name: 'Kitchen', room: 'kitchen', minSize: 3, furnish: [{ def: 'campfire' }], stage: '2' },
    { id: 'barracks', name: 'Barracks', room: 'barracks', minSize: 4, furnish: [{ def: 'bunk', per: 8 }], stage: '2' },
    { id: 'storeroom', name: 'Storeroom', room: 'storeroom', minSize: 3, preset: 'all', furnish: [{ def: 'stockpile' }, { def: 'shelf', per: 6 }], stage: '2' },
    { id: 'foodstore', name: 'Food store', room: 'storeroom', minSize: 3, preset: 'store', furnish: [{ def: 'stockpile' }], stage: '2' },
    { id: 'infirmary', name: 'Infirmary', room: 'infirmary', minSize: 4, furnish: [{ def: 'infirmary', per: 8 }], stage: '2' },
    { id: 'cellar', name: 'Cellar', room: 'cellar', minSize: 3, furnish: [{ def: 'cask', per: 4 }], stage: '2' },
    { id: 'shrine', name: 'Shrine room', room: 'temple', minSize: 3, furnish: [{ def: 'shrine' }], stage: '2' },
  ],
};
