// Orders for drafted colonists (doc 9.5): the `order` command (C3). Owner H. Provisional API.
//
// An order is a job of type 'order' (E's C7 job and toils), started with E's beginJob after ending
// any current order through E's single exit. Every drafted colonist holds one (fight.js gives a
// Hold job to a drafted colonist with none). Job fields: order ('move' | 'attack' | 'hold'),
// hx, hy (world units: the spot a Hold keeps; a Move's destination), foe (an Attack's foe id).
//   Move:   goto the tile, then the 'stand' toil (hold there).
//   Attack: goto next to the foe's tile, then stand; fight.js closes in, strikes and re-paths.
//   Hold:   stand where the colonist is and strike what comes (fight.js).
//   Guard (Stage 2): goto the tile, then hold it, defending COMBAT.guardTiles around it (fight.js).
//   Retreat (Stage 2): goto the shelter spot (a Shelter zone's first tile when the colony has one,
//           else beside the Hearth), then stand; a retreating colonist only strikes what is in reach.
// Squads (9.5): an order to several colonists keeps a formation: the first (the leader, the lowest
// id) takes the target tile, the others the next open tiles of FORMATION around it, so a squad
// never piles onto one tile. Sally (Bulwark, Stage 3) is accepted and treated as Hold.
// 'stand' is a toil registered here: it never finishes.

import { registerApplier } from '../core/commands.js';
import { colById, bldById } from '../core/state.js';
import { W, PLANE, idx, tileOfW, ctrW, inB } from '../core/grid.js';
const xyz = (i) => { const z = (i / PLANE) | 0, p = i - z * PLANE; return { x: p % W, y: (p / W) | 0, z }; };
import { T, END, RUN, makeJob, keyTile, keyItem, registerToil } from '../work/jobs.js';
import { awardXp } from '../people/skills.js';
import { structDef } from '../core/content.js';
import { beginJob, endJob } from '../work/reserve.js';
import { foeById } from './raiders.js';
import { stage2 } from '../people/defs.js';

export const STAND = Object.freeze({ t: 'stand' });
let toilOn = false;
/** Register the 'stand' toil (idempotent). */
export function installStandToil() {
  if (toilOn) return;
  registerToil('stand', () => RUN);
  // Z2.5 drill (3.8): a drilling soldier gains Melee or Archery XP (the normal daily cap) every tick it drills
  registerToil('drill', (s, col, job, toil) => { job.dr = (job.dr | 0) + 1; if ((s.tick + col.id) % 10 === 0) awardXp(s, col, toil.sk || 'melee', 10); return RUN; });
  toilOn = true;
}
export function resetStandToil() { toilOn = false; }

/** Tile of an order target ({x, y} tile, or {id, kind}), or -1. */
export function targetTile(s, t) {
  if (!t) return -1;
  if (!('id' in t)) return inB(t.x, t.y, t.z | 0) ? idx(t.x, t.y, t.z | 0) : -1;
  const e = t.kind === 'col' ? colById(s, t.id) : t.kind === 'foe' ? foeById(s, t.id) : t.kind === 'bld' ? bldById(s, t.id) : null;
  if (!e) return -1;
  return t.kind === 'bld' ? idx(e.x, e.y, e.z | 0) : idx(tileOfW(e.x), tileOfW(e.y), e.z | 0);
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
    const job = makeJob('order', keyTile(i), toils, { order: kind, hx: ctrW(i % W), hy: ctrW(((i % PLANE) / W) | 0), foe: kind === 'attack' && target && 'id' in target ? target.id : null });
    return beginJob(s, col, job, []);
  }
  return holdHere(s, col);
}
/** A Hold order where the colonist stands. */
export function holdHere(s, col) {
  installStandToil();
  if (col.job) endJob(s, col, END.CANCEL);
  col.path = null;
  const i = idx(tileOfW(col.x), tileOfW(col.y), col.z | 0);
  return beginJob(s, col, makeJob('order', keyTile(i), [STAND], { order: 'hold', hx: col.x, hy: col.y, foe: null }), []);
}

/** Formation offsets (tiles) around a squad's target: the leader first, then rings. */
export const FORMATION = Object.freeze([[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 1], [-2, 1], [1, 2]]);
const open = (s, x, y, z = 0) => inB(x, y, z) && s.rt.walkCost[idx(x, y, z)] !== 0;
/** The tile for member k of a squad ordered to tile (x, y): the k-th open FORMATION offset. */
export function formationTile(s, x, y, k, z = 0) {
  let n = 0;
  for (const [dx, dy] of FORMATION) { if (!open(s, x + dx, y + dy, z)) continue; if (n++ === k) return z ? { x: x + dx, y: y + dy, z } : { x: x + dx, y: y + dy }; }
  return z ? { x, y, z } : { x, y };
}
/** Where a Retreat goes: the first tile (lowest index) of a Shelter zone (zone type 'shelter', once A adds
 *  it to ZONE_TYPES), else beside the Hearth. */
export function shelterTile(s) {
  const sh = s.zones.filter((z) => z && (z.type === 'refuge' || z.type === 'shelter')).map((z) => z.id);
  if (sh.length) { const L = s.L.zone; for (let i = 0; i < L.length; i++) if (L[i] && sh.includes(L[i])) { const p = xyz(i); return p.z ? p : { x: p.x, y: p.y }; } }
  const hb = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
  return hb ? (hb.z ? { x: hb.x + 1, y: hb.y + 3, z: hb.z } : { x: hb.x + 1, y: hb.y + 3 }) : null;
}
/** A goto-then-stand order job of kind 'guard' or 'retreat' to tile t ({ x, y }). */
function standOrder(s, col, kind, t) {
  installStandToil();
  if (!t || !inB(t.x, t.y, t.z | 0)) return holdHere(s, col);
  if (col.job) endJob(s, col, END.CANCEL);
  col.path = null;
  const i = idx(t.x, t.y, t.z | 0);
  return beginJob(s, col, makeJob('order', keyTile(i), [T.goto(i, false), STAND], { order: kind, hx: ctrW(t.x), hy: ctrW(t.y), foe: null }), []);
}

/** Give one drafted colonist an order (k: its place in the squad's formation). null on success, else the reason. */
export function giveOrder(s, col, kind, target, k = 0) {
  if (!col.drafted) return 'not drafted';
  const S2 = stage2();
  if (S2 && k > 0 && (kind === 'move' || kind === 'guard') && target && !('id' in target)) target = formationTile(s, target.x, target.y, k, target.z | 0);
  if (kind === 'move' || kind === 'attack') return startOrder(s, col, kind, target) ? null : 'cannot start the order';
  if (S2 && kind === 'guard') { const t = target && 'id' in target ? (() => { const i = targetTile(s, target); return i < 0 ? null : xyz(i); })() : target; return standOrder(s, col, 'guard', t) ? null : 'cannot start the order'; }
  if (S2 && kind === 'retreat') { const t = shelterTile(s); return standOrder(s, col, 'retreat', t ? formationTile(s, t.x, t.y, k, t.z | 0) : null) ? null : 'cannot start the order'; }
  return holdHere(s, col) ? null : 'cannot start the order'; // hold, sally: stand (Stage 3 adds the sally)
}

// ---- Z2.5 military orders (EMBERCROWN-FORTRESS.md 3.8) ----------------------------------------------------
// Jobs the military system (people/draft.js) gives carry by: 'mil' and a key mk; orders the player gives one
// colonist at a time carry by: 'p' and are left alone until they end. Every order works on any level.
/** A goto-then-stand military order of `kind` ('station', 'patrol', 'guard', 'retreat') to tile t. */
export function milOrder(s, col, kind, t, extra = {}) {
  installStandToil();
  if (col.job) endJob(s, col, END.CANCEL);
  col.path = null;
  if (!t || !inB(t.x, t.y, t.z | 0)) { const ok = holdHere(s, col); if (ok) Object.assign(col.job, { by: 'mil', ...extra }); return ok; }
  const i = idx(t.x, t.y, t.z | 0);
  return beginJob(s, col, makeJob('order', keyTile(i), [T.goto(i, false), STAND], { order: kind, hx: ctrW(t.x), hy: ctrW(t.y), foe: null, by: 'mil', ...extra }), []);
}
/** Fetch and put on a uniform piece: goto (toils.js reaches a blocking rack from beside it), pick it up, wear it (outfit.js), then stand. */
export function equipOrder(s, col, it, adj = false) {
  installStandToil();
  if (col.job) endJob(s, col, END.CANCEL);
  col.path = null;
  const i = idx(it.x, it.y, it.z | 0);
  const job = makeJob('order', keyItem(it.id), [T.goto(i, false), T.pickup(it.id, 1), { t: 'wear' }, STAND], { order: 'equip', hx: ctrW(it.x), hy: ctrW(it.y), foe: null, by: 'mil', mk: 'eq' });
  return beginJob(s, col, job, [[keyItem(it.id), 1]]);
}
/** Drill at tile t (a training yard): goto, then the 'drill' toil (job.dr counts the ticks drilled). */
export function trainOrder(s, col, t, sk = 'melee') {
  installStandToil();
  if (col.job) endJob(s, col, END.CANCEL);
  col.path = null;
  const i = idx(t.x, t.y, t.z | 0);
  return beginJob(s, col, makeJob('order', keyTile(i), [T.goto(i, false), { t: 'drill', sk }], { order: 'train', hx: ctrW(t.x), hy: ctrW(t.y), foe: null, by: 'mil', mk: 'tr', dr: 0 }), []);
}
/** The doors (door flag) touching a Refuge zone, as their tiles { x, y, z }, by building id. */
export function refugeDoors(s) {
  const ids = s.zones.filter((z) => z && (z.type === 'refuge' || z.type === 'shelter')).map((z) => z.id);
  if (!ids.length) return [];
  const L = s.L.zone, out = [];
  for (const b of s.bld) {
    if (!b || (b.st !== undefined && b.st !== 'done')) continue;
    const d = structDef(b.def);
    if (!d || !d.flags || !d.flags.includes('door')) continue;
    const z = b.z | 0;
    let hit = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = b.x + dx, y = b.y + dy; if (inB(x, y, z) && ids.includes(L[idx(x, y, z)])) { hit = true; break; } }
    if (hit) out.push({ x: b.x, y: b.y, z });
  }
  return out;
}
let squadOrderFn = null;
/** people/draft.js hands over its squad-order applier (an `order` with `squad`; avoids an import cycle). */
export function bindSquadOrder(fn) { squadOrderFn = fn; }

export function installOrderCommands() {
  installStandToil();
  registerApplier('order', (s, c) => {
    if (c.squad !== undefined && c.squad !== null) return squadOrderFn ? squadOrderFn(s, c) : { ok: false, reason: 'squads are not ready' };
    for (const id of c.colIds) if (!colById(s, id).drafted) return { ok: false, reason: 'draft them first' };
    if ((c.kind === 'move' || c.kind === 'attack') && targetTile(s, c.target) < 0) return { ok: false, reason: 'no such target' };
    if (c.kind === 'attack' && !(c.target && c.target.kind === 'foe')) return { ok: false, reason: 'attack a hostile' };
    const ids = c.colIds.slice().sort((a, b) => a - b);
    for (let k = 0; k < ids.length; k++) { const col = colById(s, ids[k]); const r = giveOrder(s, col, c.kind, c.target, k); if (r) return { ok: false, reason: r }; if (col.job) col.job.by = 'p'; }
    return { ok: true };
  });
}
