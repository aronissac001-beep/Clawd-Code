// Hold verb: the winch and shaft (EMBERCROWN-FORTRESS.md 2.3, 3.7 vertical logistics; step Z2.4). Owner K.
//
// A winch (structure 'winch', staged in js/data/addons.js STRUCTURES for G) is a hatch built over a shaft: the
// voxel below it is open air (or a stair), and the shaft runs down through open air to the first level a
// colonist can stand on, the foot. Stacks left on the winch's landing (the tile in front of it: south at rot 0,
// then west, north, east) are lowered to the foot tile under the winch, and stacks left on the foot tile are
// raised to the landing: up to WINCH.stacks a trip, WINCH.ticksPerLevel a level (2 s at 1x). It
// is the vertical hauling shortcut: a hauler drops a load on one end instead of carrying it up the stairs.
// Stacks a trip has just landed stay put (they are not sent back) until someone moves them; forbidden stacks
// and stacks a job has claimed are never loaded.
//
// Saved state (plain JSON on the colony record, created lazily when the first winch works, so every old save and
// every hold without a winch has none):
//   s.colony.winch = { v: 1, uses, stacks, trips: [{ b, dir: 'down'|'up', to, eta, cargo: [bundle] }],
//                      landed: { bId: [item ids] } }
// Determinism: buildings in s.bld order, stacks in tile order; no rng, no rt key (the winch list is a pure scan).
//
// Hooks into other owners' code (requests in the Z2.4 report):
//   apply.js (A)      the placement rule winchPlaceWhy (installWinch pushes it on BUS.canPlace; it needs the level)
//   haul.js (E)       winchRoute(s, from, to): a haul whose source and store are on different levels of one
//                     winch's shaft may drop at winchEnd(s, b, z) instead of climbing (the bot's 50 uses)
//   bot4 (J)          builds a winch over the deep shaft and reads winchUses(s)

import { TER, idx, tx, ty, tz, inB } from '../../core/grid.js';
import { BUS } from '../../core/bus.js';
import { walkable } from '../../world/terrain.js';
import { stacksOn, getItem, take, put, freeCount } from '../../work/items.js';

export const WINCH = Object.freeze({ id: 'winch', stacks: 3, ticksPerLevel: 40, scanTicks: 20 });

const isOpen = (t) => t === TER.AIR || t === TER.STAIR_D || t === TER.STAIR_UD || t === TER.STAIR_U;
/** The foot level of a winch at (x, y, z): the first standable level below the open shaft, or -1 (no shaft). */
export function shaftFoot(s, x, y, z) {
  if (z <= 0) return -1;
  const L = s.L;
  if (!isOpen(L.terrain[idx(x, y, z - 1)])) return -1;
  for (let k = z - 1; k >= 0; k--) {
    const i = idx(x, y, k);
    const t = L.terrain[i];
    if (t === TER.AIR) continue;
    return walkable(s, i) || isOpen(t) ? k : -1;
  }
  return -1;
}
/** Why a winch cannot stand at (x, y) on level z (null when it can). */
export function winchPlaceWhy(s, d, x, y, rot = 0, z = null) {
  if (!d || d.id !== WINCH.id || z === null || z === undefined) return null;
  if (!inB(x, y, z)) return 'off the map';
  const lx = x + LX[rot & 3], ly = y + LY[rot & 3];
  if (!inB(lx, ly, z)) return 'its landing is off the map';
  return shaftFoot(s, x, y, z | 0) < 0 ? 'build it over a shaft: open air below, down to a floor' : null;
}
const placeHook = (s, d, x, y, rot, z) => { const why = winchPlaceWhy(s, d, x, y, rot, z); return why ? { ok: false, reason: why } : null; };
export function installWinch() { if (!BUS.canPlace.includes(placeHook)) BUS.canPlace.push(placeHook); }
export function uninstallWinch() { const k = BUS.canPlace.indexOf(placeHook); if (k >= 0) BUS.canPlace.splice(k, 1); }

const isWinch = (b) => !!b && b.st === 'done' && b.def === WINCH.id;
/** The record, created on first use. */
export function winchOf(s) {
  let r = s.colony.winch;
  if (!r) r = s.colony.winch = { v: 1, uses: 0, stacks: 0, trips: [], landed: {} };
  return r;
}
/** Trips made so far (the oracle: >= 50 by day 100 in the bot). */
export const winchUses = (s) => (s.colony.winch ? s.colony.winch.uses : 0);
const LX = [0, -1, 0, 1], LY = [1, 0, -1, 0];
/** The landing voxel of winch b (the tile in front of it on its level). */
export const landingOf = (b) => idx(b.x + LX[(b.rot | 0) & 3], b.y + LY[(b.rot | 0) & 3], b.z | 0);
/** The voxel at the end of winch b on level z (the landing on its level, the foot tile at the foot), or -1. */
export function winchEnd(s, b, z) {
  const foot = shaftFoot(s, b.x, b.y, b.z | 0);
  if (foot < 0) return -1;
  if (z === (b.z | 0)) return landingOf(b);
  return z === foot ? idx(b.x, b.y, foot) : -1;
}
/** A winch whose two ends serve voxels `from` and `to` (levels differ, both ends on those levels), or null. */
export function winchRoute(s, from, to) {
  const za = tz(from), zb = tz(to);
  if (za === zb) return null;
  for (const b of s.bld) {
    if (!isWinch(b)) continue;
    const foot = shaftFoot(s, b.x, b.y, b.z | 0);
    if (foot < 0) continue;
    const top = b.z | 0;
    if ((za === top && zb === foot) || (za === foot && zb === top)) return b;
  }
  return null;
}

/** Loadable stacks on voxel i: not forbidden, unclaimed, not just landed. */
function loadable(s, i, landed) {
  const out = [];
  for (const id of stacksOn(s, i)) {
    const it = getItem(s, id);
    if (!it || it.f || landed.includes(id)) continue;
    if (freeCount(s, id) < it.n) continue;
    out.push(id);
    if (out.length >= WINCH.stacks) break;
  }
  return out;
}
function startTrip(s, r, b) {
  const foot = shaftFoot(s, b.x, b.y, b.z | 0);
  if (foot < 0) return false;
  const top = landingOf(b), bot = idx(b.x, b.y, foot);
  const landed = (r.landed[b.id] || []).filter((id) => { const it = getItem(s, id); return it && (idx(it.x, it.y, it.z | 0) === top || idx(it.x, it.y, it.z | 0) === bot); });
  if (landed.length) r.landed[b.id] = landed; else delete r.landed[b.id];
  let dir = 'down', ids = loadable(s, top, landed), to = bot;
  if (!ids.length) { dir = 'up'; ids = loadable(s, bot, landed); to = top; }
  if (!ids.length) return false;
  const cargo = [];
  for (const id of ids) { const it = getItem(s, id); const bn = take(s, id, it.n); if (bn) cargo.push(bn); }
  if (!cargo.length) return false;
  r.trips.push({ b: b.id, dir, to, eta: s.tick + WINCH.ticksPerLevel * ((b.z | 0) - foot), cargo });
  r.uses++; r.stacks += cargo.length;
  return true;
}
function land(s, r, trip) {
  const ids = [];
  for (const bn of trip.cargo) {
    const id = put(s, bn, tx(trip.to), ty(trip.to), { z: tz(trip.to) });
    if (id >= 0) ids.push(id);
  }
  const l = r.landed[trip.b] || (r.landed[trip.b] = []);
  for (const id of ids) if (!l.includes(id)) l.push(id);
}

/** Tick (slot 'colony', through verbs/index.js): land the trips that arrive, then load idle winches. */
function tick(s) {
  const r = s.colony.winch;
  if (r && r.trips.length) {
    const keep = [];
    for (const t of r.trips) if (t.eta <= s.tick) land(s, r, t); else keep.push(t);
    r.trips = keep;
  }
  if (s.tick % WINCH.scanTicks !== 0) return;
  for (const b of s.bld) {
    if (!isWinch(b)) continue;
    const rr = winchOf(s);
    if (rr.trips.some((t) => t.b === b.id)) continue;
    startTrip(s, rr, b);
  }
}

export const VERB = Object.freeze({ id: 'winch', tick });
