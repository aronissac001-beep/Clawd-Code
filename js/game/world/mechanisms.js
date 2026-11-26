// Mechanisms: levers, pressure plates, locked gates and linked deadfalls (owner B; doc 7.8, 7.12
// research 'mechanisms', 9.5; data js/data/structures/utility.js lever + plate, walls.js gate,
// defence.js deadfall; tuning WORLD.mech; Stage 2).
//
//   Links: a gate, door or linkable trap names its lever or plate in Building.link (C2). A lever or
//   plate drives at most WORLD.mech.links (4) of them. When a lockable gate or a linkable trap is
//   finished it links itself to the nearest lever or plate within linkR (12) that has a free link;
//   when a lever or plate is finished it takes the nearest unlinked lockable gates and linkable traps
//   within linkR (doors only link by the `link` command). Removing either end clears the link.
//
//   Gate modes (saved in s.colony.world.mech as [bldId, mode], sorted by id; no entry = 0):
//     0 closed   a normal door: colonists pass, hostiles see a wall they must break (12.3)
//     1 open     held open: everyone passes, light and sight go through
//     2 locked   a wall to everyone until broken (sappers and breakers still smash it)
//   pass.js reads gateMode() for every door-flagged building, so walk costs, regions (both label
//   sets), rooms and light all follow, and every rebuild from saved state agrees (C13).
//   Levers keep their own entry [leverId, mode]: the mode they hold their gates in. pullLever cycles
//   closed > locked > open > closed; setLever sets one mode (the `lever` command, once A adds it).
//   Plates: when a hostile stands on a finished plate (checked every tick in the 'mechanisms' slot,
//   foes in id order), its linked gates lock and its linked deadfalls drop, then it rests
//   WORLD.mech.plateCooldown ticks (entry [plateId, readyTick]).
//   Deadfalls: a linked deadfall drops WORLD.mech.deadfall blunt on every hostile on its tile and the
//   8 around it (through onTrapFire listeners: H's damageFoe; without one, hp is reduced here and H's
//   systems see the result), then it is spent and removed (single use; rebuild it). A deadfall with no
//   link is H's own trap (9.5).
//
//   API: gateMode(s, b), isGate(b), linksOf(s, srcId), link(s, bId, srcId) -> null | reason,
//   pullLever(s, id), setLever(s, id, mode), firePlate(s, id), mechState(s, id), onTrapFire(fn).

import { W, H } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { COMMANDS, registerApplier } from '../core/commands.js';
import { WORLD } from '../../data/worldgen.js';
import { worldRec, ensureWorld, worldStage2, getKey, putKey, dropKey } from './worldrec.js';
import { structDef, hasFlag } from './defs.js';
import { doorMode, footprint } from './pass.js';
import { installFluids, activateBuilding } from './fluids.js';
import { installPumps } from './pumps.js';
import { removeBuilding } from '../core/apply.js';

export const MECH = WORLD.mech;
export const GATE = Object.freeze({ CLOSED: 0, OPEN: 1, LOCKED: 2 });
const GATE_NAMES = ['closed', 'open', 'locked'];
export const gateModeName = (m) => GATE_NAMES[m] || 'closed';

const flagOf = (b, f) => !!b && hasFlag(structDef(b.def), f);
export const isLever = (b) => flagOf(b, 'lever');
export const isPlate = (b) => flagOf(b, 'plate');
// Z3.4: floodgates (never pass creatures, pass fluid only when open) and raising bridges (raised = LOCKED) are
// worked like gates; a link is a building id pair, so a lever may sit on any level.
// Z4: a pump links like a gate (a lever holding it LOCKED stops it; pumps.js).
export const isGate = (b) => flagOf(b, 'door') || flagOf(b, 'floodgate') || flagOf(b, 'liftbridge') || flagOf(b, 'pump');
export const isLockable = (b) => flagOf(b, 'lockable');
export const isLinkableTrap = (b) => flagOf(b, 'linkable');
const isSource = (b) => isLever(b) || isPlate(b);

/** The saved state of a mechanism building (0 when none). */
export function mechState(s, id) { const e = getKey(worldRec(s).mech, id); return e ? e[1] : 0; }
/** The mode a door-flagged building is in (GATE.*). Pure: reads only saved state. */
export const gateMode = (s, b) => (b && isGate(b) ? doorMode(s, b) : GATE.CLOSED);

let refreshFn = null;
/** terrain.js hands its refreshBuilding over (avoids an import cycle). */
export function bindMechTerrain(refresh) { refreshFn = refresh; }

const trapListeners = [];
/** fn(s, deadfall, foeIds, dmg) -> true when the listener applied the damage (H). Returns an unsubscribe. */
export function onTrapFire(fn) { trapListeners.push(fn); return () => { const k = trapListeners.indexOf(fn); if (k >= 0) trapListeners.splice(k, 1); }; }

/** Buildings linked to source id (finished or not), sorted by id. */
export function linksOf(s, srcId) {
  const out = [];
  for (const b of s.bld) if (b && b.link === srcId && b.id !== srcId && (isGate(b) || isLinkableTrap(b))) out.push(b);
  return out;
}
/** Link building bId (a gate, door or linkable trap) to the lever or plate srcId; srcId null unlinks. */
export function link(s, bId, srcId) {
  const b = s.bld[bId];
  if (!b || !(isGate(b) || isLinkableTrap(b))) return 'only gates, doors and traps can be linked';
  if (srcId === null || srcId === undefined) { b.link = null; return null; }
  const src = s.bld[srcId];
  if (!isSource(src)) return 'link it to a lever or a pressure plate';
  if (isLever(src) && isLinkableTrap(b) && !isGate(b)) return 'a lever cannot drop a trap; use a pressure plate';
  if (b.link !== srcId && linksOf(s, srcId).length >= MECH.links) return `a ${structDef(src.def).name.toLowerCase()} drives at most ${MECH.links} links`;
  b.link = srcId;
  if (isLever(src) && isGate(b)) setGate(s, b, mechState(s, srcId));
  return null;
}

function setGate(s, b, mode) {
  const w = ensureWorld(s);
  const before = mechState(s, b.id);
  if (before === mode) return false;
  if (mode === GATE.CLOSED) dropKey(w.mech, b.id); else putKey(w.mech, [b.id, mode]);
  if (refreshFn && b.st === 'done') refreshFn(s, b);
  if (b.st === 'done') activateBuilding(s, b, footprint(s, b));   // a toggle wakes the fluid around it (2.8 Z3)
  return true;
}
/** Hold every gate of lever `id` in `mode`. Returns the number of gates that changed. */
export function setLever(s, id, mode) {
  const lv = s.bld[id];
  if (!isLever(lv) || !(mode in GATE_NAMES)) return 0;
  const w = ensureWorld(s);
  if (mode === GATE.CLOSED) dropKey(w.mech, id); else putKey(w.mech, [id, mode]);
  let n = 0;
  for (const g of linksOf(s, id)) if (isGate(g) && setGate(s, g, mode)) n++;
  return n;
}
/** Pull a lever: closed > locked > open > closed. Returns the new mode. */
export function pullLever(s, id) {
  const next = [GATE.LOCKED, GATE.CLOSED, GATE.OPEN][mechState(s, id)];
  setLever(s, id, next);
  return next;
}

/** A plate fires: its gates lock, its deadfalls drop. Returns { gates, traps } changed. */
export function firePlate(s, id) {
  const p = s.bld[id];
  if (!isPlate(p)) return { gates: 0, traps: 0 };
  const w = ensureWorld(s);
  putKey(w.mech, [id, s.tick + MECH.plateCooldown]);
  let gates = 0, traps = 0;
  for (const b of linksOf(s, id)) {
    if (b.st !== 'done') continue;
    if (isGate(b)) { if (setGate(s, b, GATE.LOCKED)) gates++; } else if (isLinkableTrap(b)) { springDeadfall(s, b); traps++; }
  }
  return { gates, traps };
}
const foeTileOf = (f) => Math.min(H - 1, Math.max(0, Math.floor(f.y / 32))) * W + Math.min(W - 1, Math.max(0, Math.floor(f.x / 32)));
/** Drop a deadfall: every hostile on its tile or next to it takes WORLD.mech.deadfall; it is spent. */
export function springDeadfall(s, b) {
  const ids = [];
  for (const f of s.foes) {
    if (!f || !f.hp || f.hp.hp <= 0) continue;
    const i = foeTileOf(f);
    if (Math.max(Math.abs((i % W) - b.x), Math.abs(((i / W) | 0) - b.y)) <= 1) ids.push(f.id);
  }
  let done = false;
  for (const fn of trapListeners) if (fn(s, b, ids, MECH.deadfall)) { done = true; break; }
  if (!done) for (const f of s.foes) if (ids.includes(f.id)) f.hp.hp = Math.max(0, f.hp.hp - MECH.deadfall);
  dropKey(ensureWorld(s).mech, b.id);
  removeBuilding(s, b, true);
  return ids;
}

/** Tick system (slot 'mechanisms'): hostiles on finished plates fire them. */
export function mechanismSystem(s) {
  if (!worldStage2() || !s.foes.length) return;
  for (const f of s.foes) {
    if (!f || !f.hp || f.hp.hp <= 0) continue;
    const id = s.rt.occ[foeTileOf(f)];
    if (id < 0) continue;
    const p = s.bld[id];
    if (!isPlate(p) || p.st !== 'done') continue;
    if (s.tick < mechState(s, id)) continue;          // resting
    firePlate(s, id);
  }
}

// ---- Auto-linking and clean-up (BUS.built, BUS.removed) ------------------------------------------------
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
function onBuilt(s, b) {
  if (!worldStage2() || !b || b.st !== 'done') return;
  if ((isLockable(b) || isLinkableTrap(b)) && (b.link === null || b.link === undefined)) {
    let best = null, bd = MECH.linkR + 1;
    for (const o of s.bld) {
      if (!o || o.st !== 'done' || !isSource(o) || cheb(o, b) >= bd) continue;
      if (isLever(o) && !isGate(b)) continue;
      if (linksOf(s, o.id).length >= MECH.links) continue;
      bd = cheb(o, b); best = o;
    }
    if (best) link(s, b.id, best.id);
  } else if (isSource(b)) {
    const cands = [];
    for (const o of s.bld) {
      if (!o || o.st !== 'done' || (o.link !== null && o.link !== undefined) || cheb(o, b) > MECH.linkR) continue;
      if (!(isLockable(o) || (isPlate(b) && isLinkableTrap(o)))) continue;
      cands.push(o);
    }
    cands.sort((p, q) => cheb(p, b) - cheb(q, b) || p.id - q.id);
    for (const o of cands.slice(0, MECH.links)) link(s, o.id, b.id);
  }
}
function onRemoved(s, b) {
  const w = s.colony.world;
  if (w) dropKey(w.mech, b.id);
  if (isSource(b)) for (const o of s.bld) if (o && o.link === b.id && o.id !== b.id) o.link = null;
}

export function installMechanisms() {
  installFluids(footprint);
  installPumps();
  if (!tickSystems().some((x) => x.slot === 'mechanisms' && x.name === 'plates')) registerSystem('mechanisms', 'plates', mechanismSystem, 10);
  if (!BUS.built.includes(onBuilt)) BUS.built.push(onBuilt);
  if (!BUS.removed.includes(onRemoved)) BUS.removed.push(onRemoved);
  // Commands (A adds them to C3: `lever { bId, mode? }` and `link { bId, to }`); registered when present.
  if (COMMANDS.lever) registerApplier('lever', (s, c) => {
    if (!isLever(s.bld[c.bId])) return { ok: false, reason: 'that is not a lever' };
    const mode = c.mode === undefined || c.mode === null ? pullLever(s, c.bId) : (setLever(s, c.bId, c.mode), c.mode);
    return { ok: true, mode };
  });
  if (COMMANDS.link) registerApplier('link', (s, c) => { const r = link(s, c.bId, c.to); return r ? { ok: false, reason: r } : { ok: true }; });
}
