// Thoughts (doc 4.5). OWNER F. durationH 0 = a condition thought: it lasts while its cause holds
// (people/mood.js keeps need, Hearth and pain thoughts in step with the state). Others count down.
// stack: the same thought again adds (stack - 1) x decay% of its value, up to max stacks.
// Stage 1b: about 20 thoughts (needs, food, rest, the Hearth, health, events, breaks).
export const DATA = {
  thought: [
    // needs (condition)
    { id: 'hungry', label: 'Hungry', value: -6, durationH: 0, tags: ['need'] },
    { id: 'ravenous', label: 'Ravenous', value: -12, durationH: 0, tags: ['need'] },
    { id: 'starving', label: 'Starving', value: -20, durationH: 0, tags: ['need'], text: 'No food at all: health suffers.' },
    { id: 'tired', label: 'Tired', value: -4, durationH: 0, tags: ['need'] },
    { id: 'exhausted', label: 'Exhausted', value: -10, durationH: 0, tags: ['need'] },
    { id: 'uneasy', label: 'Uneasy in the dark', value: -3, durationH: 0, tags: ['need', 'dark'] },
    { id: 'dread', label: 'Dread', value: -10, durationH: 0, tags: ['need', 'dark'] },
    { id: 'terror', label: 'Terror of the dark', value: -18, durationH: 0, tags: ['need', 'dark'] },
    // environment (condition)
    { id: 'hearth_lit', label: 'The Hearth burns', value: 3, durationH: 0, tags: ['environment'] },
    { id: 'hearth_cold', label: 'The Hearth is cold', value: -15, durationH: 0, tags: ['environment'] },
    // health (condition)
    { id: 'in_pain', label: 'In pain', value: -5, durationH: 0, tags: ['health'] },
    // food and rest (timed)
    { id: 'ate_raw', label: 'Ate raw food', value: -4, durationH: 6, tags: ['food'] },
    { id: 'ate_floor', label: 'Ate without a table', value: -2, durationH: 6, tags: ['food'] },
    { id: 'ate_meal', label: 'A hot meal', value: 2, durationH: 6, tags: ['food'] },
    { id: 'slept_ground', label: 'Slept on the ground', value: -3, durationH: 12, tags: ['rest'] },
    { id: 'slept_bed', label: 'Slept in a bed', value: 1, durationH: 12, tags: ['rest'] },
    // events (timed)
    { id: 'colonist_died', label: 'A colonist died', value: -4, durationH: 72, stack: { max: 5, decay: 50 }, tags: ['event'] },
    { id: 'was_downed', label: 'Was struck down', value: -4, durationH: 24, tags: ['event', 'health'] },
    { id: 'rescued', label: 'Carried to safety', value: 3, durationH: 24, tags: ['event'] },
    { id: 'raid_repelled', label: 'Repelled the Hollow', value: 6, durationH: 48, tags: ['event'] },
    { id: 'catharsis', label: 'Catharsis', value: 8, durationH: 24, tags: ['break'], text: 'After a break the mind is lighter for a day.' },
  ],
};
