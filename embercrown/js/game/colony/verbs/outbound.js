// Hold verb: Outbound caravans (EMBERCROWN-FORTRESS.md 1.2, 3.10). Owner K.
// Once a charter's signature mechanic; since Stage 2.9 every hold has it, and renown only changes how
// often its visitors come. Stage 0 skeleton.
// 2-4 colonists with pack animals and goods travel to a named town for 3-6 days; a caravan letter
// resolves the trip (caravans.js).
// Commands it will apply: caravan, letter.

export const VERB = Object.freeze({
  id: 'outbound',
  /** Per-tick work (slot 'colony', through verbs/index.js). */
  tick: () => {},
});
