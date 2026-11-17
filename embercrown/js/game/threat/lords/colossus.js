// Hollow Lord: Bone Colossus (doc 9.6). Owner H. Stage 3 feature; Stage 0 skeleton.
// Available from tier 'stronghold'. Behaviour (adapted from the roguelite boss module in Stage 3):
// walks through walls, slam telegraph, weak spot on its back.
// Lord logic plugs into lords/index.js with registerLord(); this file only describes it.

export const LORD = Object.freeze({
  id: 'colossus',
  tier: 'stronghold',
  /** Spawn the Lord and its escort for a queue entry (Stage 3). */
  spawn: () => null,
  /** Per-tick behaviour while on the map (Stage 3). */
  tick: () => {},
});
