// Great beast (legend): Hollow King (EMBERCROWN-FORTRESS.md 3.12; step Z3.3). Owner H.
// Lair: the Sleep, under the Seal-stone. Cause: the Seal-stone mined (the UI raises one confirmation letter
// first, js/ui/letters.js sealAgreed: owner decision 3), a found voxel within kingR tiles planar and kingDz
// levels of the Sleep, or (unless the Ember Seal holds) year >= kingYear with the Hollow's hunger high.
// Body: steps through darkness (beasts/index.js darkStep: between dark voxels within darkStepR tiles, so lit
// halls stop it); darkness aura; 4-8 Knights come with it, the only escort any beast has.

export const BEAST = Object.freeze({
  id: 'hollowking',
  legend: true,
  /** The waking cause now ([kind, subject, weight]) or null (pure in s). */
  cause(s, b, cs, { hasCause, sealMined, emberSealHolds, nearFound, K, yearOf }) {
    if (sealMined(s)) return ['seal', 'seal', 12];
    if (nearFound(s, b.lair, K.kingR, K.kingDz)) return ['near_lair', 'sleep', K.kingR];
    const h = hasCause(cs, 'hunger', 'hollow');
    if (h && h[2] >= K.kingHunger && yearOf(s.tick) >= K.kingYear && !emberSealHolds(s)) return h;
    return null;
  },
});
