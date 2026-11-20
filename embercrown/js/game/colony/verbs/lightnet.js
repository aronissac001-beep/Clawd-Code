// Hold verb: The light network and Vigils (EMBERCROWN-FORTRESS.md 1.2, 3.10). Owner K.
// Once a charter's signature mechanic; since Stage 2.9 every hold has it, and renown only changes how
// often its visitors come. Stage 0 skeleton.
// Lumen Conduits link lamps into a network that shares fuel; a Lore 8+ colonist leads a Vigil at a
// Warding Circle for one night of +1 light everywhere.
// Commands it will apply: vigil.

export const VERB = Object.freeze({
  id: 'lightnet',
  /** Per-tick work (slot 'colony', through verbs/index.js). */
  tick: () => {},
});
