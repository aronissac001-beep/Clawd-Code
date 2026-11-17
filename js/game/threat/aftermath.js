// Aftermath (doc 9.10): what a major leaves behind. Owner H. Provisional API; Stage 2 content.
//
// Each major rolls 0-2 entries from its incident's `after` list (stream 'story'). Handlers register
// by id: fn(s, raid) -> a short record for s.st.history (or null when nothing was left).
// Ids: siege_camp, captive, blight_scar, stolen_heirloom, wreckage, heros_memory.

import { nextU32 } from '../core/rand.js';

export const AFTERMATH_IDS = Object.freeze(['siege_camp', 'captive', 'blight_scar', 'stolen_heirloom', 'wreckage', 'heros_memory']);
const HANDLERS = new Map();
export function registerAftermath(id, fn) { HANDLERS.set(id, fn); }
export const aftermathHandler = (id) => HANDLERS.get(id) || null;

/** Roll and apply 0-2 aftermath entries for a raid that ended. @returns {string[]} applied ids */
export function rollAftermath(s, raid, inc) {
  const list = (inc && inc.after) || [];
  if (!list.length) return [];
  const n = nextU32(s, 'story') % 3;
  const out = [];
  for (let k = 0; k < n && k < list.length; k++) {
    const id = list[(nextU32(s, 'story') % list.length)];
    if (out.includes(id)) continue;
    const h = HANDLERS.get(id);
    if (h) h(s, raid);
    out.push(id);
  }
  return out;
}
