// Traps (doc 7.7): spike traps, ember pits and tunnel deadfalls. Owner H. Stage 2 feature; Stage 0
// skeleton. A trap strikes the first hostile on its tile once, then waits for a hauler to rearm it
// (a Haul job by E's giver contract); deadfalls are single use and rebuilt.

export const TRAP_DEFS = Object.freeze(['spiketrap', 'emberpit', 'deadfall']);
export const isTrap = (b) => !!b && b.st === 'done' && TRAP_DEFS.includes(b.def);
/** Tick system (slot 'defence'). Stage 2: foes on armed trap tiles (rt.occ) take the trap's damage. */
export function trapsSystem() {}
