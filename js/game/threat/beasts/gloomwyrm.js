// Great beast (legend): Gloomwyrm (EMBERCROWN-FORTRESS.md 3.12). Owner H. Stage Z3 feature; Stage 2.9 stub.
// Lair: a cliff eyrie in the heights. Cause: Rumour of wealth at a high weight (it is a hoarder).
// Body: winged; breath of fire (sets fires, ignites stockpiles); darkness aura; flies, so it comes down
// open shafts and cannot enter `cover >= 1`. No scripted phases: it flees to its eyrie when hurt.

export const BEAST = Object.freeze({
  id: 'gloomwyrm',
  legend: true,
  /** Spawn the beast for an incident whose cause holds (Z3). */
  spawn: () => null,
  /** Per-tick behaviour while on the map (Z3). */
  tick: () => {},
});
