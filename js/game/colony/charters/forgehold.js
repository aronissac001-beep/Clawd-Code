// Charter mechanic: Forgehold (doc 8.3). Owner K. Stage 3 feature; Stage 0 skeleton.
// Commissions and artifacts: each season an envoy brings a commission (a named item of a kind and quality by a deadline) that pays in rare goods, a tech tablet or a colonist.
// Commands it will apply: letter (commission choices).

export const MECHANIC = Object.freeze({
  id: 'forgehold',
  /** Per-tick work while chartered (slot 'colony', through charters.js). */
  tick: () => {},
});
