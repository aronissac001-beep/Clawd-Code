// Outbound caravans (doc 8.3, Tradehold): send 2-4 colonists with goods to a named town for 3-6
// days; a caravan letter resolves the trip. Owner K. Stage 3 feature; Stage 0 skeleton.

import { registerApplier } from '../core/commands.js';
import { hasCharter } from './charters.js';

export const CARAVAN = Object.freeze({ minColonists: 2, maxColonists: 4, daysMin: 3, daysMax: 6 });
export function installCaravanCommands() {
  registerApplier('caravan', (s) => ({ ok: false, reason: hasCharter(s, 'tradehold') ? 'caravans arrive with the Tradehold content' : 'needs the Tradehold charter' }));
}
