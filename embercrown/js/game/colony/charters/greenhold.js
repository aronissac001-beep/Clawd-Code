// Charter mechanic: Greenhold (doc 8.3). Owner K. Stage 3 feature; Stage 0 skeleton.
// Herds and seasonal migration: herds graze outside the walls from Thaw to Ashfall; in Deepcold a herd drive (2 herders, letter-resolved) takes them off-map and brings them back 50% larger.
// Commands it will apply: letter (herd drive).

export const MECHANIC = Object.freeze({
  id: 'greenhold',
  /** Per-tick work while chartered (slot 'colony', through charters.js). */
  tick: () => {},
});
