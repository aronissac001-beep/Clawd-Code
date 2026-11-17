// Traits (doc 4.3). OWNER F. Exclusive pairs point at each other (excl); weight is the relative
// chance at generation; mods use the modifier keys of 13.3 (work.speed, learn.xp, work.dark, ...).
// Stage 1a ships the four slice traits (14.6): Hardworking, Lazy, Quick Learner, Dark-sighted.
// Slow (Quick Learner's pair) and the other 19 of the 4.3 table arrive with needs and mood (1b, 2).
export const DATA = {
  trait: [
    { id: 'hardworking', name: 'Hardworking', excl: 'lazy', weight: 10, mods: [{ key: 'work.speed', op: 'pct', value: 15 }], text: 'Works 15% faster.' },
    { id: 'lazy', name: 'Lazy', excl: 'hardworking', weight: 10, mods: [{ key: 'work.speed', op: 'pct', value: -15 }], text: 'Works 15% slower.' },
    { id: 'quick_learner', name: 'Quick Learner', weight: 8, mods: [{ key: 'learn.xp', op: 'pct', value: 40 }], text: 'Learns every skill 40% faster.' },
    { id: 'dark_sighted', name: 'Dark-sighted', weight: 6, mods: [{ key: 'work.dark', op: 'flag', value: true }], text: 'No work penalty and no dread in darkness.' },
  ],
};
