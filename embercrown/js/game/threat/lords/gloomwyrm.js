// Hollow Lord: Gloomwyrm (doc 9.6). Owner H. Stage 3 feature; Stage 0 skeleton.
// Available from tier 'hold'. Behaviour (adapted from the roguelite boss module in Stage 3):
// flies over walls, strafes along a telegraphed line, snuffs the lights it passes; lands to bite in the dark.
// Lord logic plugs into lords/index.js with registerLord(); this file only describes it.

export const LORD = Object.freeze({
  id: 'gloomwyrm',
  tier: 'hold',
  /** Spawn the Lord and its escort for a queue entry (Stage 3). */
  spawn: () => null,
  /** Per-tick behaviour while on the map (Stage 3). */
  tick: () => {},
});
