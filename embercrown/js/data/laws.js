// Crime and justice (EMBERCROWN-FORTRESS.md 3.9, F18; step Z2.12). Data owner G for K; logic
// js/game/colony/justice.js (K); screen js/ui/justiceui.js (I). On by default (owner decision 1): Settings > Hold
// > Laws turns it off, at most once a season.
//
// CRIMES: the acts that open a case while the laws are on. sev is the base severity (1-4); `worse` names the
//   detail that adds one (vandalism: a thing destroyed or three hits; theft: an artifact; assault: the victim was
//   downed). Without the laws the same acts happen as break behaviour, with no case.
// SENTENCE: the pure table of sentence(severity, record) (justice.js). score = sev + min(record, recordMax), where
//   record is the offender's sentenced cases in the last year. A score maps to a labour fine (the offender's work
//   is Haul and Clean only) or confinement in a Lockup; a confinement with no free cell in any Lockup is served as
//   a labour fine of commuteDays[days] days instead.
// RULES: timings (game hours and days) and the reaction sizes.
// WARDEN: the Warden of Law (3.4): opens at 12 colonists, only with the laws on; appointed by the player; wants a
//   Lockup room. (Not a row of js/data/offices.js: justice.js keeps the holder in its own record.)
// CELL_BED: the structure that makes a Lockup (the role is in js/data/rooms.js). G request: add this row to
//   js/data/structures/housing.js; rooms.js turns the Lockup role on once a `cellbed` structure exists.
// DATA.thought: the justice thoughts (registered once laws.js is in DATA_FILES; G request).

export const CRIMES = Object.freeze({
  vandalism: { name: 'Vandalism', sev: 1, worse: 'destroyed', verb: 'smashed {what}' },
  theft: { name: 'Theft', sev: 2, worse: 'artifact', verb: 'took {what}' },
  assault: { name: 'Assault', sev: 3, worse: 'downed', verb: 'hurt {victim}' },
  mandate: { name: 'A broken mandate', sev: 2, worse: null, verb: 'let the mandate for {what} fail' },
});
export const CRIME_IDS = Object.freeze(Object.keys(CRIMES));

export const SENTENCE = Object.freeze({
  recordMax: 3,
  // score -> [kind, days]; scores past the end use the last row
  byScore: [null, ['fine', 2], ['fine', 4], ['confine', 2], ['confine', 3], ['confine', 4], ['confine', 5]],
  commuteDays: [0, 3, 4, 5, 6, 6],   // confinement days -> labour fine days, when no cell is free
});

export const RULES = Object.freeze({
  hearingHours: 6,        // a case is heard this long after it opens (and once the offender is out of their break)
  lawlessDays: 3,         // a case waiting longer than this: "Lawless hold" for Order-valuing colonists
  orderMin: 1,            // Order value at or above this: the colonist reacts to justice and its lack
  victimOpinion: 10,      // the victim's opinion of the offender after the sentence
  witnessR: 8,            // tiles: a colonist this close on the same level, with a clear line, saw it
  exileCases: 3,          // cases in a year that bring the exile letter
  exileMinLeft: 4,        // never offer exile when fewer free colonists would remain
  exileHours: 48,         // the letter waits this long, then "Let them stay"
  cellRestPerHour: 13,    // Rest a confined colonist regains each sleep hour on the cell bed (the bed rate)
  caseCap: 40,            // cases kept on the record (closed ones drop oldest first)
  histCap: 60,            // sentenced-case dates kept for the records
});

export const WARDEN = Object.freeze({
  id: 'warden', name: 'Warden of Law', opens: { pop: 12 },
  verb: 'Hears each case and sentences it: confinement in a Lockup or a labour fine. No beatings and no executions.',
  open: 'Opens at 12 colonists, while the laws are on.',
  need: 'A Lockup: a room with a cell bed and a door',
});

export const CELL_BED = Object.freeze({
  id: 'cellbed', name: 'Cell bed', cat: 'housing', kind: 'construct', size: [1, 2], cost: { block: 12 }, work: 90, hp: 400, band: 'hamlet',
  art: 'bed', stage: '2', text: 'A stone bunk with a door between it and the hold. A room with one is a Lockup, where the Warden of Law confines offenders.',
});

/** Words for letters, the Annals and the screen. */
export const TEXT = Object.freeze({
  caseOpened: '{name}: {crime}',
  sentenceConfine: '{name} is confined to the lockup for {days} days ({crime}).',
  sentenceFine: '{name} is set to hauling and cleaning for {days} days ({crime}).',
  sentenceCommuted: 'No cell is free: {name} is set to hauling and cleaning for {days} days instead ({crime}).',
  sentenceTitle: 'A sentence',
  annalsCrime: '{name} {verb}',
  annalsSentence: '{name} sentenced: {what}',
  exileTitle: 'A repeat offender',
  exileText: '{name} has answered for {n} cases this year. The Warden asks whether {name} should be sent from the hold for good.',
  exileChoices: ['Exile them', 'Let them stay'],
  exiled: '{name} is sent from the hold.',
  stays: '{name} stays, under the Warden\'s eye.',
  lawsOn: 'The laws are kept: crimes are heard by the Warden of Law.',
  lawsOff: 'No laws: tantrums and thefts go unanswered.',
  bySeason: 'The laws can be changed once a season.',
  noWarden: 'No Warden of Law: cases wait.',
  common: 'Until the hold has a Warden of Law, cases are settled by common judgement.',
});

export const DATA = {
  thought: [
    { id: 'justice_done', label: 'Justice is done', value: 2, durationH: 72, tags: ['justice', 'v_order'], text: 'A case was heard and sentenced.' },
    { id: 'lawless_hold', label: 'Lawless hold', value: -3, durationH: 30, tags: ['justice', 'v_order'], text: 'A crime has waited days for a hearing.' },
    { id: 'confined', label: 'Locked in the lockup', value: -2, durationH: 24, tags: ['justice'] },
    { id: 'fined', label: 'Sentenced to labour', value: -1, durationH: 24, tags: ['justice'] },
  ],
};
