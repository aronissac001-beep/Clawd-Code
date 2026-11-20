// Hold verb: Commissions (EMBERCROWN-FORTRESS.md 1.2, 3.10). Owner K.
// Once a charter's signature mechanic; since Stage 2.9 every hold has it, and renown only changes how
// often its visitors come. Stage 0 skeleton.
// Envoys (more often to a hold known for Smithing) bring commissions: a named item of a kind and
// quality by a deadline, paid in rare goods, a tech tablet or a colonist.
// Commands it will apply: letter (commission answers).

export const VERB = Object.freeze({
  id: 'commissions',
  /** Per-tick work (slot 'colony', through verbs/index.js). */
  tick: () => {},
});
