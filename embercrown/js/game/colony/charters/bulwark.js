// Charter mechanic: Bulwark (doc 8.3). Owner K. Stage 3 feature; Stage 0 skeleton.
// Garrisons and counter-sallies: soldiers hold a Keep or Gatehouse as a permanent garrison; a Sally order strikes a siege camp's engine (with H's orders).
// Commands it will apply: garrison, order kind sally.

export const MECHANIC = Object.freeze({
  id: 'bulwark',
  /** Per-tick work while chartered (slot 'colony', through charters.js). */
  tick: () => {},
});
