// Hold verb: Garrisons and sallies (EMBERCROWN-FORTRESS.md 1.2, 3.10). Owner K.
// Once a charter's signature mechanic; since Stage 2.9 every hold has it, and renown only changes how
// often its visitors come. Stage 0 skeleton.
// Soldiers hold a Keep or Gatehouse as a permanent garrison; a Sally order strikes a siege camp's
// engine (with H's orders).
// Commands it will apply: garrison, order kind sally.

export const VERB = Object.freeze({
  id: 'garrisons',
  /** Per-tick work (slot 'colony', through verbs/index.js). */
  tick: () => {},
});
