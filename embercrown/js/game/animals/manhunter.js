// Manhunters (doc 9.3, beasts): an animal pack turned hostile, or a tamed animal gone wild.
// Owner K (AI), with H's beast incidents (incidents.js, cat major, tag 'beast'). Stage 2 feature;
// Stage 0 skeleton. A manhunter targets the nearest colonist (people goal, A* per pack leader) and
// wanders off after one day.

export const MANHUNT_TICKS = 14400;
export const isManhunter = (a) => !!(a.st && a.st.mode === 'manhunt');
/** Turn an animal hostile until tick + MANHUNT_TICKS. */
export function enrage(s, a) { a.st = { mode: 'manhunt', until: s.tick + MANHUNT_TICKS, target: null }; return a; }
/** Tick system (slot 'animals'). Stage 2: hunt the nearest colonist; calm down at `until`. */
export function manhunterSystem(s) { for (const a of s.anim) if (isManhunter(a) && s.tick >= a.st.until) a.st = { mode: 'wander', until: 0, target: null }; }
