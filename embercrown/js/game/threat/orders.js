// Orders for drafted colonists (doc 9.5): the `order` command (C3). Owner H. Provisional API.
//
// An order is a job of type 'order' (E's C7 job and toils), started with E's beginJob after ending
// any current order through E's single exit. Move: goto the tile. Attack: goto next to the target
// (combat through systems/engage.js in 1b). Hold: no job (stand and fire at will). Guard, Retreat
// and Sally arrive with squads (Stage 2) and the Bulwark charter (Stage 3); they are accepted and
// treated as Hold until then.

import { registerApplier } from '../core/commands.js';
import { colById, bldById } from '../core/state.js';
import { idx, tileOfW, inB } from '../core/grid.js';
import { T, END, makeJob, keyTile } from '../work/jobs.js';
import { beginJob, endJob } from '../work/reserve.js';
import { foeById } from './raiders.js';

/** Tile of an order target ({x, y} tile, or {id, kind}), or -1. */
export function targetTile(s, t) {
  if (!t) return -1;
  if (!('id' in t)) return inB(t.x, t.y) ? idx(t.x, t.y) : -1;
  const e = t.kind === 'col' ? colById(s, t.id) : t.kind === 'foe' ? foeById(s, t.id) : t.kind === 'bld' ? bldById(s, t.id) : null;
  if (!e) return -1;
  return t.kind === 'bld' ? idx(e.x, e.y) : idx(tileOfW(e.x), tileOfW(e.y));
}

/** Give one drafted colonist an order. null on success, else the reason. */
export function giveOrder(s, col, kind, target) {
  if (!col.drafted) return 'not drafted';
  if (col.job) endJob(s, col, END.CANCEL);
  if (kind === 'move' || kind === 'attack') {
    const i = targetTile(s, target);
    if (i < 0) return 'no such target';
    const job = makeJob('order', keyTile(i), [T.goto(i, kind === 'attack')], { order: kind });
    return beginJob(s, col, job, []) ? null : 'cannot start the order';
  }
  return null; // hold, guard, retreat, sally: stand (Stage 2 / 3 add their jobs)
}

export function installOrderCommands() {
  registerApplier('order', (s, c) => {
    for (const id of c.colIds) if (!colById(s, id).drafted) return { ok: false, reason: 'draft them first' };
    if ((c.kind === 'move' || c.kind === 'attack') && targetTile(s, c.target) < 0) return { ok: false, reason: 'no such target' };
    for (const id of c.colIds) { const r = giveOrder(s, colById(s, id), c.kind, c.target); if (r) return { ok: false, reason: r }; }
    return { ok: true };
  });
}
