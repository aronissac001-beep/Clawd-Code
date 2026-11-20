// Great beasts registry (EMBERCROWN-FORTRESS.md 3.12, F13). Owner H. Stage Z3 feature; Stage 2.9 stubs.
// A great beast is never summoned and never gates anything: it is an incident of category `beast`
// with a live cause in the world (2.10), warned as a major, and it fights with the same wound model
// as colonists. Most beasts are generated from the seed (gen.js, Z3; tables in js/data/beasts.js);
// the three legends below are the unique, hand-made bodies. Slaying one is a legend and a trophy,
// never a requirement: there is no win state. Art: js/engine/art/beasts.js (owner D).

import { BEAST as gloomwyrm } from './gloomwyrm.js';
import { BEAST as colossus } from './colossus.js';
import { BEAST as hollowking } from './hollowking.js';

export const LEGENDS = Object.freeze({ gloomwyrm, colossus, hollowking });
export const LEGEND_IDS = Object.freeze(['gloomwyrm', 'colossus', 'hollowking']);
export const beastOf = (id) => LEGENDS[id] || null;
