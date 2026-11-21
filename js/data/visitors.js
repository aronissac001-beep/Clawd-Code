// Families and the halls that draw visitors (EMBERCROWN-FORTRESS.md 3.13; step Z2.8). Data owner G for F and K;
// logic js/game/people/family.js (F) and js/game/colony/visitors.js (K). The hall rules live in js/data/rooms.js
// (HALLS); the nursery is a room role there.
//
// FAMILY: births (on by default; Settings > Hold can turn them off), children, teens and the population count.
//   ages:     a child is 0-11, a teen 12-15, an adult from 16 (one game year per year of age: health.js birthdays)
//   birth:    per season, per pair of spouses sharing a Fine+ bedroom: permille; x bigPct when more than bigHold
//             colonists live, x lowFoodPct under lowFoodDays of food; no birth would take the head count (children
//             at one half) over the R2 hard cap (balance CAPS.colonistsHard); a bearer is 18-50 and has at most one
//             child a year
//   bearer:   on light work for lightDays (work at lightPct)
//   child:    no work, no soldiering; learns x childXpPct of the XP their parents earn (by watching)
//   teen:     teenPct work speed, no soldiering
//   facets:   each facet one parent's +-1
// VISITOR_KINDS: who each hall draws (3.13). skill: the visitor's trade (raised to minSkill); domain: the renown
//   domain their skills match (a petition needs it to be one the hold is known for); pay: coins a day [lo, hi].
// VISITS: arrivals, stays and petitions. POWERS: the powers of the vale an altar is raised to.
// DATA.thought and DATA.text register once this file is in DATA_FILES (G request); tests register it themselves.

export const FAMILY = Object.freeze({
  childTo: 12, teenTo: 16,
  birthPermille: 350, bigHold: 40, bigPct: 25, lowFoodDays: 10, lowFoodPct: 40,
  bearerAge: [18, 50], birthGapDays: 40,
  lightDays: 10, lightPct: 50,
  childXpPct: 25, teenPct: 50,
  childHeadPct: 50, facetSpread: 1, fineTier: 3,
  seasonHour: 20, dayHour: 1,
});

export const VISITOR_KINDS = Object.freeze([
  { id: 'traveller', name: 'traveller', hall: 'tavern', skill: 'social', domain: 'trade', pay: [4, 10], weight: 4 },
  { id: 'bard', name: 'bard', hall: 'tavern', skill: 'art', domain: 'lore', pay: [6, 14], weight: 2 },
  { id: 'mercenary', name: 'mercenary', hall: 'tavern', skill: 'melee', domain: 'arms', pay: [2, 8], weight: 2 },
  { id: 'pilgrim', name: 'pilgrim', hall: 'temple', skill: 'growing', domain: 'growing', pay: [2, 6], weight: 3 },
  { id: 'priest', name: 'priest', hall: 'temple', skill: 'medicine', domain: 'lore', pay: [4, 10], weight: 1 },
  { id: 'scholar', name: 'scholar', hall: 'library', skill: 'lore', domain: 'lore', pay: [6, 16], weight: 1 },
  { id: 'delver', name: 'deep-trader', hall: 'tavern', skill: 'mining', domain: 'delving', pay: [6, 14], weight: 1, passage: true },
  { id: 'smith', name: 'journeyman smith', hall: 'tavern', skill: 'smithing', domain: 'smithing', pay: [4, 10], weight: 1 },
]);

export const VISITS = Object.freeze({
  hour: 8,                 // the daily step (arrivals, pay, leaving, petitions)
  arrivePermille: 120,     // per qualifying hall per day
  stayDays: [2, 10],
  maxVisitors: 6, maxPerHall: 2,
  minSkill: 6,
  petitionDays: 5, petitionHours: 24,
  petitionPct: 35,         // a matching visitor who has stayed petitionDays asks with this chance (once a stay)
  knownWeight: 3,          // a kind whose domain the hold is known for is this much likelier
  drinkPerDay: 1,          // a tavern visitor drinks from the hold's stock; with none left they leave
  scholarBookDay: 3,       // a scholar writes a book on this day of their stay (once)
  passagePct: 50,          // once Cavern II is open, this share comes up the Lamplost passage
  hallJoyHourly: true,
});

export const POWERS = Object.freeze(['the Ember Mother', 'the Deep Warden', 'the Lantern-Bearer', 'Old Granitebrow', 'the Mere Lady', 'the Ashen Smith']);

/** Renown domain of each skill (a petitioner's skills match the hold's renown when their best skill's is known). */
export const SKILL_DOMAIN = Object.freeze({
  mining: 'delving', masonry: 'delving', construction: 'delving', smithing: 'smithing', woodcraft: 'smithing', tailoring: 'trade',
  cooking: 'growing', growing: 'growing', animals: 'growing', medicine: 'lore', lore: 'lore', art: 'lore', social: 'trade', melee: 'arms', archery: 'arms',
});

/** Words (letters, the Chronicle, the Annals). */
export const WORDS = Object.freeze({
  birthTitle: 'A child is born',
  birthText: '{name} was born to {a} and {b}.',
  petitionTitle: 'A visitor asks to stay',
  petitionText: '{name}, a {kind} who has spent {days} days in the {hall}, asks to stay in the hold for good. {history}',
  petitionChoices: ['Let them stay', 'Not now'],
  history: [
    'Once of {place}, {name} has walked the vale for {years} years.',
    '{name} left {place} {years} years ago and has not settled since.',
    'They speak of {place}, where {name} lived {years} years before the road.',
  ],
  noPlace: 'the far roads',
  bookName: 'The Book of {who}',
  halls: { tavern: 'tavern', temple: 'temple', library: 'library' },
  entry: { edge: 'by the vale road', passage: 'up the Lamplost passage' },
});

export const DATA = {
  thought: [
    { id: 'child_born', label: 'My child was born', value: 12, durationH: 240, tags: ['social', 'v_kin'], text: 'A child of their own, in the hold.' },
    { id: 'birth_in_hold', label: 'A birth in the hold', value: 3, durationH: 72, tags: ['social', 'v_kin'] },
    { id: 'child_died', label: 'A child of the hold died', value: -8, durationH: 240, stack: { max: 3, decay: 50 }, tags: ['grief', 'v_kin'], text: 'The worst news a hold can have.' },
    { id: 'lost_child', label: 'My child died', value: -15, durationH: 480, stack: { max: 3, decay: 50 }, tags: ['grief', 'v_kin'], text: 'Kin twice over.' },
    { id: 'revelry', label: 'Revelry in the tavern', value: 3, durationH: 12, tags: ['joy', 'social'] },
    { id: 'read_quietly', label: 'Read in the library', value: 2, durationH: 12, tags: ['joy', 'v_craft'] },
  ],
  text: [
    { id: 'chron_birth', text: '{name} was born to {a} and {b}.', vars: ['name', 'a', 'b'] },
    { id: 'chron_grown', text: '{name} came of age.', vars: ['name'] },
    { id: 'chron_visitor', text: 'A {kind}, {name}, came {entry} to the {hall}.', vars: ['kind', 'name', 'entry', 'hall'] },
    { id: 'chron_visitor_left', text: '{name} the {kind} went on their way.', vars: ['name', 'kind'] },
    { id: 'chron_petition', text: '{name} the {kind} asked to stay, and stayed.', vars: ['name', 'kind'] },
    { id: 'chron_book', text: '{name} wrote {book} in the library.', vars: ['name', 'book'] },
  ],
};
