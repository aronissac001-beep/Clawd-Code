// Charter mechanic: Tradehold (doc 8.3). Owner K. Stage 3 feature; Stage 0 skeleton.
// Outbound caravans: 2-4 colonists with pack animals and goods travel to a named town for 3-6 days; a caravan letter resolves the trip.
// Commands it will apply: caravan (caravans.js), letter.

export const MECHANIC = Object.freeze({
  id: 'tradehold',
  /** Per-tick work while chartered (slot 'colony', through charters.js). */
  tick: () => {},
});
