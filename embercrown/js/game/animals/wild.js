// Wild animal AI (doc 6.5, 9.3): grazing, wandering, fleeing, hunting packs. Owner K.
// Stage 2 feature; Stage 0 skeleton. Movers use B's requestPath (kind 'a') and movement; every
// decision is a function of the state and the 'main' stream, at a per-animal cadence
// (tick % 20 == id % 20), like colonists' needs.

export const THINK_EVERY = 20;
/** Tick system (slot 'animals'). Stage 2: wander / graze / flee decisions for wild animals. */
export function wildSystem() {}
