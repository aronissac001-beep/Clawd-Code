// Orders for drafted colonists (doc 9.5): the `order` command (C3). Owner H. Provisional API.
//
// An order is a job of type 'order' (E's C7 job and toils), started with E's beginJob after ending
// any current order through E's single exit. Every drafted colonist holds one (fight.js gives a
// Hold job to a drafted colonist with none). Job fields: order ('move' | 'attack' | 'hold'),
// hx, hy (world units: the spot a Hold keeps; a Move's destination), foe (an Attack's foe id).
//   Move:   goto the tile, then the 'stand' toil (hold there).
//   Attack: goto next to the foe's tile, then stand; fight.js closes in, strikes and re-paths.
//   Hold:   stand where the colonist is and strike what comes (fight.js).
// Guard, Retreat and Sally arrive with squads (Stage 2) and the Bulwark charter (Stage 3); they are
// accepted and treated as Hold until then. 'stand' is a toil registered here: it never finishes.

import { registerApplier } from '../core/commands.js';
import { colById, bldById } from '../core/state.js';
import { W, idx, tileOfW, ctrW, inB } from '../core/grid.js';
import { T, END, RUN, makeJob, keyTile, registerToil } from '../work/jobs.js';
import { beginJob, endJob } from '../work/reserve.js';
import { foeById } from './raiders.js';

export const STAND = Object.freeze({ t: 'stand' });
let toilOn = false;
/** Register the 'stand' toil (idempotent). */
export function installStandToil() { if (!toilOn) { registerToil('stand', () => RUN); toilOn = true; } }
export function resetStandToil() { toilOn = false; }

/** Tile of an order target ({x, y} tile, or {id, kind}), or -1. */
export function targetTile(s, t) {
  if (!t) return -1;
  if (!('id' in t)) return inB(t.x, t.y) ? idx(t.x, t.y) : -1;
  const e = t.kind === 'col' ? colById(s, t.id) : t.kind === 'foe' ? foeById(s, t.id) : t.kind === 'bld' ? bldById(s, t.id) : null;
  if (!e) return -1;
  return t.kind === 'bld' ? idx(e.x, e.y) : idx(tileOfW(e.x), tileOfW(e.y));
}

/**
 * Start an order job now (ends the current one). direct: an Attack that closes in without a path
 * (fight.js steers it). Returns true when the job started.
 */
export function startOrder(s, col, kind, target, direct = false) {
  installStandToil();
  if (col.job) endJob(s, col, END.CANCEL);
  col.path = null;
  if (kind === 'move' || kind === 'attack') {
    const i = targetTile(s, target);
    if (i < 0) return false;
    const toils = direct ? [STAND] : [T.goto(i, kind === 'attack'), STAND];
    const job = makeJob('order', keyTile(i), toils, { order: kind, hx: ctrW(i % W), hy: ctrW((i / W) | 0), foe: kind === 'attack' && target && 'id' in target ? target.id : null });
    return beginJob(s, col, job, []);
  }
  return holdHere(s, col);
}
/** A Hold order where the colonist stands. */
export function holdHere(s, col) {
  installStandToil();
  if (col.job) endJob(s, col, END.CANCEL);
  col.path = null;
  const i = idx(tileOfW(col.x), tileOfW(col.y));
  return beginJob(s, col, makeJob('order', keyTile(i), [STAND], { order: 'hold', hx: col.x, hy: col.y, foe: null }), []);
}

/** Give one drafted colonist an order. null on success, else the reason. */
export function giveOrder(s, col, kind, target) {
  if (!col.drafted) return 'not drafted';
  if (kind === 'move' || kind === 'attack') return startOrder(s, col, kind, target) ? null : 'cannot start the order';
  return holdHere(s, col) ? null : 'cannot start the order'; // hold, guard, retreat, sally: stand (Stage 2 / 3 add their jobs)
}

export function installOrderCommands() {
  installStandToil();
  registerApplier('order', (s, c) => {
    for (const id of c.colIds) if (!colById(s, id).drafted) return { ok: false, reason: 'draft them first' };
    if ((c.kind === 'move' || c.kind === 'attack') && targetTile(s, c.target) < 0) return { ok: false, reason: 'no such target' };
    if (c.kind === 'attack' && !(c.target && c.target.kind === 'foe')) return { ok: false, reason: 'attack a hostile' };
    for (const id of c.colIds) { const r = giveOrder(s, colById(s, id), c.kind, c.target); if (r) return { ok: false, reason: r }; }
    return { ok: true };
  });
}
