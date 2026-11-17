// Hollow Rifts (doc 9.3): a tear on blighted land that spawns a horde each night until closed by a
// colonist with Lore 6+ channelling for one game hour while guarded. Owner H. Stage 2 feature.
// The roguelite's RIFT_DEF and rift behaviour move here from systems/objectives.js when A deletes
// that file (13.5); until then this is the skeleton of the API.
//
// A rift is a Building (def 'rift') with hp and a nightly spawn; closing it is a Care-free job
// ('closeRift', E's C7 giver contract, registered by H in Stage 2).

export const RIFT = Object.freeze({ closeLore: 6, closeTicks: 600 });

/** Rifts on the map (building ids, ascending). */
export function riftIds(s) { const out = []; for (const b of s.bld) if (b && b.def === 'rift') out.push(b.id); return out; }
/** Tick system (slot 'raids'). Stage 2: nightly spawns, channelling progress. */
export function riftSystem() {}
