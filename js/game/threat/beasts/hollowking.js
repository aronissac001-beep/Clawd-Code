// Great beast (legend): Hollow King (EMBERCROWN-FORTRESS.md 3.12). Owner H. Stage Z3 feature; Stage 2.9 stub.
// Lair: the Sleep, under the Seal-stone. Cause: the Seal-stone mined (one confirmation letter first), a
// fortress voxel within 12 tiles planar and 1 level of the Sleep, or (unless the Ember Seal is complete)
// year >= 6 with the Hollow's hunger high.
// Body: steps through darkness (moves between dark voxels within 6 tiles, so lit halls stop it); darkness
// aura; summons 4-8 Knights from its budget, the only escort any beast has.

export const BEAST = Object.freeze({
  id: 'hollowking',
  legend: true,
  /** Spawn the beast and its Knights for an incident whose cause holds (Z3). */
  spawn: () => null,
  /** Per-tick behaviour while on the map (Z3). */
  tick: () => {},
});
