// Hold verbs (EMBERCROWN-FORTRESS.md 1.2, 3.10). Owner K. The five former charter mechanics, which
// every hold now has: nothing is chosen, and renown (js/data/renown.js) only steers who visits.

import { VERB as commissions } from './commissions.js';
import { VERB as herds } from './herds.js';
import { VERB as lightnet } from './lightnet.js';
import { VERB as outbound } from './outbound.js';
import { VERB as garrisons } from './garrisons.js';

export const VERBS = Object.freeze({ commissions, herds, lightnet, outbound, garrisons });
export const VERB_IDS = Object.freeze(['commissions', 'herds', 'lightnet', 'outbound', 'garrisons']);

/** Tick system (slot 'colony'): each verb's tick, in VERB_IDS order. */
export function verbsSystem(s) { for (const id of VERB_IDS) VERBS[id].tick(s); }
