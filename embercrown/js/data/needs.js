// Needs, in the fixed core order NEED_IDS (doc 4.4). OWNER F.
// fallPerDay: points (0-100) lost per game day: food always, rest while awake, joy always (Stage 2),
// light ("dread") while the colonist stands in darkness (rt.light 0; dim light 1 falls at
// NEEDS.light.dimPct of it, lit tiles restore it). thoughts: condition thoughts by threshold; the
// lowest `below` that holds is the one shown (Starving replaces Ravenous replaces Hungry).
// stage: the build stage whose sim runs the need (people/needs.js activeNeeds).
export const DATA = {
  need: [
    { id: 'food', name: 'Food', fallPerDay: 33, stage: '1b',
      thoughts: [{ below: 25, thought: 'hungry' }, { below: 10, thought: 'ravenous' }, { below: 1, thought: 'starving' }],
      text: 'Falls about a third a day. A simple meal gives 20, raw food 4 a unit.' },
    { id: 'rest', name: 'Rest', fallPerDay: 99, stage: '1b',
      thoughts: [{ below: 30, thought: 'tired' }, { below: 10, thought: 'exhausted' }],
      text: 'Falls while awake. Sleep in a bed restores it fully; on the ground at 60%.' },
    { id: 'joy', name: 'Joy', fallPerDay: 30, stage: '2', thoughts: [], text: 'Chats, ale, games and prayer (Stage 2).' },
    { id: 'warmth', name: 'Warmth', fallPerDay: 0, stage: '2', thoughts: [], text: 'Falls below 10 C (Stage 2).' },
    { id: 'light', name: 'Light', fallPerDay: 180, stage: '1b',
      thoughts: [{ below: 40, thought: 'uneasy' }, { below: 20, thought: 'dread' }, { below: 5, thought: 'terror' }],
      text: 'Dread: falls in darkness and faster near the Hollow; lit tiles and the Hearth restore it.' },
  ],
};
