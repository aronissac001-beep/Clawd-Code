// Content installation (owner A; doc 13.1, 13.4). G's registry (js/data/index.js, contract C11) is
// built purely at import; installContent() hands it to every module that looks content up:
//   commands (setContentLookup), items (setItemDefs), work balance (setWorkBalance), people,
//   threat, colony and world registries (B's world/defs.js drives the terrain API's structure
//   footprints and passability from the same registry).
// Idempotent; call once at boot and again after a test swaps the registry. Nothing runs at import.

import { CONTENT, validateContent } from '../../data/index.js';
import { commandLookup, itemDefLookup, balanceOf } from '../../data/schema.js';
import { setContentLookup } from './commands.js';
import { idx, inB } from './grid.js';
import { setItemDefs } from '../work/items.js';
import { setWorkBalance, WORK } from '../work/jobs.js';
import { setPeopleContent } from '../people/defs.js';
import { setThreatContent } from '../threat/defs.js';
import { setColonyContent } from '../colony/defs.js';
import { setWorldContent } from '../world/defs.js';

let REG = CONTENT;
export const registry = () => REG;
export const def = (kind, id) => (id === null || id === undefined ? null : REG.get(kind, id));
export const all = (kind) => REG.all(kind);
/** A structure def, or null. */
export const structDef = (id) => def('structure', id);
export const hasFlag = (d, f) => !!(d && d.flags && d.flags.includes(f));

// ---- Structure geometry (the same rule as B's footprint in world/pass.js: (x, y) is the top-left tile)
/** Footprint size [w, h] of a def at rotation rot (0-3; odd rotations swap w and h). */
export function sizeOf(d, rot = 0) {
  const sz = (d && d.size) || [1, 1];
  return rot & 1 ? [sz[1], sz[0]] : [sz[0], sz[1]];
}
/** Tile indexes covered by a structure whose top-left tile is (x, y). Off-map tiles are skipped. */
export function tilesOf(d, x, y, rot = 0) {
  const [w, h] = sizeOf(d, rot), out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) if (inB(x + dx, y + dy)) out.push(idx(x + dx, y + dy));
  return out;
}

/**
 * Install `reg` (default: G's CONTENT) everywhere. Returns the registry.
 * @param {{ reg?: object }} [opts]
 */
export function installContent({ reg = CONTENT } = {}) {
  REG = reg;
  setContentLookup(commandLookup(reg));
  setItemDefs(itemDefLookup(reg));
  const work = balanceOf(reg, 'work');
  // only the keys the work engine knows (balance.js may carry keys for later stages)
  if (work) setWorkBalance(Object.fromEntries(Object.keys(work).filter((k) => k in WORK && Number.isInteger(work[k])).map((k) => [k, work[k]])));
  setPeopleContent(reg); setThreatContent(reg); setColonyContent(reg);
  setWorldContent(reg === CONTENT ? null : reg);
  return reg;
}

/** Full data validation (debug builds; validate-data runs the same in the gate). */
export const validate = () => validateContent();
