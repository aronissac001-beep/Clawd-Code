// Hollow Lords registry (doc 9.6). Owner H. Stage 3 feature; Stage 0 skeleton.
// A Lord is challenged at the Challenge Pyre (the `challenge` command) or comes on its own two
// seasons after its tier is reached; a defeated Lord goes into s.colony.lordsDone.

import { LORD as gloomwyrm } from './gloomwyrm.js';
import { LORD as colossus } from './colossus.js';
import { LORD as hollowking } from './hollowking.js';

export const LORDS = Object.freeze({ gloomwyrm, colossus, hollowking });
export const LORD_IDS = Object.freeze(['gloomwyrm', 'colossus', 'hollowking']);
export const lordOf = (id) => LORDS[id] || null;
export const defeated = (s, id) => s.colony.lordsDone.includes(id);
