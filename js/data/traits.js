// Traits (doc 4.3). OWNER F. Exclusive pairs point at each other (excl); weight is the relative
// chance at generation; mods use the modifier keys of 13.3 (roots from schema MOD_ROOTS). Flags are
// read by js/game/people/* (and E / H for work, quality and combat keys, listed per trait).
// Stage 1a shipped the four slice traits (Hardworking, Lazy, Quick Learner, Dark-sighted); Stage 2
// completes the 24 of the 4.3 table. Colonists generated before Stage 2 roll only the slice traits
// (STAGE1_TRAITS), so a Stage 1b colony is exactly as it was.
export const STAGE1_TRAITS = Object.freeze(['hardworking', 'lazy', 'quick_learner', 'dark_sighted']);
export const DATA = {
  trait: [
    { id: 'hardworking', name: 'Hardworking', excl: 'lazy', weight: 10, mods: [{ key: 'work.speed', op: 'pct', value: 15 }], text: 'Works 15% faster.' },
    { id: 'lazy', name: 'Lazy', excl: 'hardworking', weight: 10, mods: [{ key: 'work.speed', op: 'pct', value: -15 }], text: 'Works 15% slower.' },
    { id: 'quick_learner', name: 'Quick Learner', excl: 'slow', weight: 8, mods: [{ key: 'learn.xp', op: 'pct', value: 40 }], text: 'Learns every skill 40% faster.' },
    { id: 'dark_sighted', name: 'Dark-sighted', excl: 'fearful_dark', weight: 6, mods: [{ key: 'work.dark', op: 'flag', value: true }], text: 'No work penalty and no dread in darkness.' },
    // Stage 2
    { id: 'slow', name: 'Slow', excl: 'quick_learner', weight: 8, mods: [{ key: 'learn.xp', op: 'pct', value: -30 }], text: 'Learns every skill 30% slower.' },
    { id: 'steady', name: 'Steady', excl: 'volatile', weight: 8, mods: [{ key: 'break.threshold', op: 'add', value: -5 }], text: 'Breaks only when things are 5 points worse.' },
    { id: 'volatile', name: 'Volatile', excl: 'steady', weight: 8, mods: [{ key: 'break.threshold', op: 'add', value: 6 }], text: 'Breaks when things are 6 points better than others would.' },
    { id: 'cheerful', name: 'Cheerful', excl: 'gloomy', weight: 8, mods: [{ key: 'mood.base', op: 'add', value: 6 }], text: 'Mood 6 higher.' },
    { id: 'gloomy', name: 'Gloomy', excl: 'cheerful', weight: 8, mods: [{ key: 'mood.base', op: 'add', value: -6 }], text: 'Mood 6 lower.' },
    { id: 'brave', name: 'Brave', excl: 'craven', weight: 6, mods: [{ key: 'break.brave', op: 'flag', value: true }, { key: 'dmg.melee', op: 'pct', value: 10 }],
      text: 'Never flees; 10% more melee damage.' },
    { id: 'craven', name: 'Craven', excl: 'brave', weight: 6, mods: [{ key: 'break.craven', op: 'flag', value: true }],
      text: 'Flees when badly hurt and will not be drafted while mood is under 40.' },
    { id: 'night_owl', name: 'Night Owl', weight: 6, mods: [{ key: 'work.nightOwl', op: 'flag', value: true }],
      text: 'Keeps the night watch: no dark-work penalty at night, unhappy working in daylight.' },
    { id: 'firekeeper', name: 'Firekeeper', weight: 6, mods: [{ key: 'mood.firekeeper', op: 'flag', value: true }],
      text: 'Happy near a lit Hearth or brazier; never starts fires on a break.' },
    { id: 'fearful_dark', name: 'Fearful of the Dark', excl: 'dark_sighted', weight: 6, mods: [{ key: 'need.light', op: 'pct', value: 100 }],
      text: 'Dread grows twice as fast in darkness.' },
    { id: 'glutton', name: 'Glutton', weight: 6, mods: [{ key: 'need.food', op: 'pct', value: 40 }, { key: 'break.binge', op: 'flag', value: true }],
      text: 'Hungry 40% sooner; comfort binges come easily.' },
    { id: 'ascetic', name: 'Ascetic', excl: 'greedy', weight: 5, mods: [{ key: 'thought.ascetic', op: 'flag', value: true }],
      text: 'Ignores comfort and beauty; dislikes a Fine or better bedroom.' },
    { id: 'greedy', name: 'Greedy', excl: 'ascetic', weight: 5, mods: [{ key: 'thought.greedy', op: 'flag', value: true }],
      text: 'Wants a Fine or better bedroom, or sulks about it.' },
    { id: 'kind', name: 'Kind', excl: 'abrasive', weight: 6, mods: [{ key: 'mood.kind', op: 'flag', value: true }],
      text: 'Opinions grow half again as fast; others enjoy talking with them.' },
    { id: 'abrasive', name: 'Abrasive', excl: 'kind', weight: 6, mods: [{ key: 'mood.abrasive', op: 'flag', value: true }],
      text: 'Says the wrong thing: every chat costs the other 5 opinion.' },
    { id: 'green_thumb', name: 'Green Thumb', weight: 5, mods: [{ key: 'yield.grow', op: 'pct', value: 20 }], text: 'Harvests 20% more.' },
    { id: 'iron_stomach', name: 'Iron Stomach', weight: 5, mods: [{ key: 'need.rawOk', op: 'flag', value: true }],
      text: 'Eats raw food without complaint and never gets food poisoning.' },
    { id: 'tough', name: 'Tough', excl: 'delicate', weight: 5, mods: [{ key: 'dmg.taken', op: 'pct', value: -25 }], text: 'Takes a quarter less damage.' },
    { id: 'delicate', name: 'Delicate', excl: 'tough', weight: 5, mods: [{ key: 'dmg.taken', op: 'pct', value: 25 }, { key: 'hp.heal', op: 'pct', value: 20 }],
      text: 'Takes a quarter more damage, but heals a fifth faster.' },
    { id: 'hollow_touched', name: 'Hollow-Touched', weight: 3, mods: [{ key: 'hp.taintSurvive', op: 'flag', value: true }, { key: 'dmg.hollow', op: 'pct', value: -20 },
      { key: 'mood.hearthWarm', op: 'flag', value: true }], text: 'Lives through a Grey Taint once; the Hollow hurt them less; the Hearth feels too warm.' },
    { id: 'craftmaster', name: 'Craftmaster', weight: 4, mods: [{ key: 'quality.step', op: 'flag', value: true }], text: 'One crafted item in five comes out a step better.' },
    { id: 'pyromaniac', name: 'Pyromaniac', weight: 3, mods: [{ key: 'fire.pyro', op: 'flag', value: true }], text: 'Loves fire; on a bad break sets things alight.' },
    { id: 'beauty_lover', name: 'Beauty-Lover', weight: 5, mods: [{ key: 'beauty.lover', op: 'flag', value: true }], text: 'Feels beauty and ugliness twice as much.' },
    { id: 'loner', name: 'Loner', weight: 5, mods: [{ key: 'mood.loner', op: 'flag', value: true }],
      text: 'Never lonely and gets no joy from chats; dislikes crowded halls, likes their own room.' },
    { id: 'devout', name: 'Devout', weight: 5, mods: [{ key: 'mood.devout', op: 'flag', value: true }], text: 'Prays for joy, and shrines and temples please them twice as much.' },
  ],
};
