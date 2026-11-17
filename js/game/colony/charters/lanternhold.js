// Charter mechanic: Lanternhold (doc 8.3). Owner K. Stage 3 feature; Stage 0 skeleton.
// Light network and Vigils: Lumen Conduits link lamps into a network that shares fuel; a Lore 8+ colonist leads a Vigil at a Warding Circle for one night of +1 light everywhere.
// Commands it will apply: vigil.

export const MECHANIC = Object.freeze({
  id: 'lanternhold',
  /** Per-tick work while chartered (slot 'colony', through charters.js). */
  tick: () => {},
});
