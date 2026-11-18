// Needs, in the fixed core order NEED_IDS (doc 4.4). OWNER F.
// fallPerDay: points (0-100) lost per game day: food always, rest while awake, joy always (Stage 2),
// light ("dread") while the colonist stands in darkness (rt.light 0; dim light 1 falls at
// NEEDS.light.dimPct of it, lit tiles restore it). Warmth falls only below PEOPLE.warmth.below C, by
// PEOPLE.warmth.perDegree a day for every degree under it. thoughts: condition thoughts by threshold;
// the lowest `below` that holds is the one shown (Starving replaces Ravenous replaces Hungry).
// stage: the build stage whose sim runs the need (people/needs.js activeNeeds).
export const DATA = {
  need: [
    { id: 'food', name: 'Food', fallPerDay: 33, stage: '1b',
      thoughts: [{ below: 25, thought: 'hungry' }, { below: 10, thought: 'ravenous' }, { below: 1, thought: 'starving' }],
      text: 'Falls about a third a day. A simple meal gives 20, raw food 4 a unit.' },
    { id: 'rest', name: 'Rest', fallPerDay: 99, stage: '1b',
      thoughts: [{ below: 30, thought: 'tired' }, { below: 10, thought: 'exhausted' }],
      text: 'Falls while awake. Sleep in a bed restores it fully; on the ground at 60%.' },
    { id: 'joy', name: 'Joy', fallPerDay: 30, stage: '2', thoughts: [{ below: 30, thought: 'bored' }, { below: 10, thought: 'joyless' }],
      text: 'Chats, ale, games, prayer and an hour by the Hearth. Joy hours and low joy send colonists to it.' },
    { id: 'warmth', name: 'Warmth', fallPerDay: 0, stage: '2', thoughts: [{ below: 30, thought: 'chilly' }, { below: 10, thought: 'freezing' }],
      text: 'Falls below 10 C, faster the colder it is; clothes slow it. Warm rooms, fires and the Hearth restore it.' },
    { id: 'light', name: 'Light', fallPerDay: 180, stage: '1b',
      thoughts: [{ below: 40, thought: 'uneasy' }, { below: 20, thought: 'dread' }, { below: 5, thought: 'terror' }],
      text: 'Dread: falls in darkness and faster near the Hollow; lit tiles and the Hearth restore it.' },
  ],
};

/**
 * Stage 2 people tuning (doc 4.4-4.8, 8.1; read by js/game/people/*). Integers: points are need or
 * mood points (0-100), times in game hours or days, chances in per-mille or percent as named.
 */
export const PEOPLE = Object.freeze({
  // Joy (4.4): what an hour of each kind restores; chats add `chat` to both (a friend counts double).
  joy: { hearth: 12, shrine: 14, games: 16, spar: 12, admire: 10, wander: 6, chat: 4, ale: 0, devoutPct: 200, seekBelow: 35, until: 85, maxH: 2, hearthR: 4,
    lonelyDays: 3 },
  // Warmth (4.4, 3.6): below `below` C it falls perDegree a day per degree; above, it returns warmPerDay.
  // insulPct: each point of apparel insulation (item wear.insul) cuts the fall by this percent (max maxInsulPct).
  warmth: { below: 10, perDegree: 8, warmPerDay: 240, seekBelow: 25, seekTo: 70, seekTemp: 14, seekR: 40, insulPct: 3, maxInsulPct: 80,
    frostEveryH: 3, frostDmg: 4 },
  // Rooms and surroundings (7.11, 4.4): checked once a game hour per colonist.
  rooms: { sharedBedroom: 'shared_bedroom', barracks: 'slept_barracks', crowd: 8, blightR: 3, corpseR: 6 },
  // Health (4.6): infection, Grey Taint, illness, healing.
  health: {
    infectH: 12, tendedSafePct: 60, infectPerDay: 25, tendedCurePerDay: 20, tendDayH: 24,
    taintChancePct: 15, taintPerDay: 34, taintBedPerDay: 15, taintRestPerDay: 50, taintRestHearthLvl: 2, taintRestR: 12, taintAlerts: [50, 80],
    healInfirmaryPct: 200, scarPct: 10, scarDmg: 10,
    caveDmg: [20, 45], burnDmg: 4,
  },
  // Illnesses (4.6, incidents): severity and immunity in points a day; contagious ones spread to
  // colonists who sleep in the same room (chance per day, percent).
  illness: [
    { id: 'grey_cough', name: 'Grey Cough', sevPerDay: 18, immPerDay: 16, restPct: 60, tendPct: 70, contagionPct: 20, workPct: 70 },
    { id: 'rot_fever', name: 'Rot Fever', sevPerDay: 22, immPerDay: 18, restPct: 60, tendPct: 60, contagionPct: 0, workPct: 60 },
    { id: 'food_poisoning', name: 'Food poisoning', sevPerDay: 40, immPerDay: 80, restPct: 80, tendPct: 80, contagionPct: 0, workPct: 50, maxSev: 60 },
  ],
  // Breaks (4.5) beyond the 1b pair: how far and how hard.
  breaks: { tantrumHits: [1, 3], tantrumDmg: 30, darkR: 30, insultOp: [5, 10], whisperTaint: 25, firestarterR: 12, catatonicBedH: 48 },
  // Inspirations (4.5): mood >= NEEDS.inspireAt for NEEDS.inspireHours, then inspireChancePerDayPct a day.
  inspo: { fervourDays: 2, fervourPct: 150, tradeDays: 10, teachingDays: 1, teachingPct: 200, teachingR: 6 },
  // Relationships (4.7)
  social: { chatR: 3, chatPermille: 600, opMin: 1, opMax: 5, kindPct: 150, abrasive: -5, sameAnc: 1, samePassion: 1, loverOp: 60, loverPermille: 20,
    griefFriend: 'friend_died', griefLover: 'lover_died', griefKin: 'kin_died', rivalRoom: 'rival_near' },
  // Death and burial (4.8): an unburied corpse in darkness for riseDays rises as a Husk at night.
  death: { riseDays: 2, corpseCheckH: 1, buryWork: 30 },
  // Ember-touched (4.5)
  ember: { minLvl: 6, minMood: 30, chancePermille: 15, afterMajorDays: 3, cooldownDays: 20, deadlineDays: 5, workH: 10, moodDays: 10,
    unmetEvery: 24, touchedPct: 10, artifactQ: [4, 5] },
});
