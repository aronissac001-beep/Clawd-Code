// Hold verbs (EMBERCROWN-FORTRESS.md 1.2, 3.10). Owner K. The five former charter mechanics, which
// every hold now has: nothing is chosen, and renown (js/data/renown.js, colony/renown.js) only steers who
// visits. Step Z2.4 adds two verbs every hold has: research by doing (discovery.js: a third of the techs can be
// discovered by working a material, reading a vault tablet or hosting a scholar) and the winch (winch.js: the
// vertical hauling shortcut, 2.3). Both are inert until their state exists (a counted deed, a built winch), so
// a hold that has neither ticks exactly as before.

import { VERB as commissions } from './commissions.js';
import { VERB as herds } from './herds.js';
import { VERB as lightnet } from './lightnet.js';
import { VERB as outbound } from './outbound.js';
import { VERB as garrisons } from './garrisons.js';
import { VERB as discovery } from './discovery.js';
import { VERB as winch } from './winch.js';

export const VERBS = Object.freeze({ commissions, herds, lightnet, outbound, garrisons, discovery, winch });
/** The five former charter mechanics. */
export const VERB_IDS = Object.freeze(['commissions', 'herds', 'lightnet', 'outbound', 'garrisons']);
/** Every verb the system ticks: the five, then Z2.4's research by doing and the winch. */
export const TICK_IDS = Object.freeze([...VERB_IDS, 'discovery', 'winch']);

/** Tick system (slot 'colony'): each verb's tick, in TICK_IDS order. */
export function verbsSystem(s) { for (const id of TICK_IDS) VERBS[id].tick(s); }
