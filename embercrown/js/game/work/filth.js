// Filth and cleaning (doc 5.1 Haul "clean filth", 7.11 room Cleanliness; owner E; Stage 2).
//
// Filth lives on floored, roofed tiles (indoors) in E's saved record s.colony.work.filth =
// [[tile, amount]] sorted by tile (amount 1..FILTH.perTile; at most FILTH.max entries). Sources:
//   - colonists walking indoors track dirt in (filthSystem, every FILTH.every ticks: a walking colonist
//     on a floored, roofed tile adds 1 with FILTH.walkPct percent, from a hash of (tick, id), so no RNG
//     stream moves and a saved game continues identically);
//   - cooking and butchering leave mess at the bench (bills.js calls addFilth);
// Cleaning is a Haul job (givers/clean.js): stand on the tile, FILTH.cleanMin game minutes per unit.
// Read API for B's rooms (Cleanliness) and I's room card: filthAt(s, i), filthOf(s, tiles).
// Reads never create the record (a UI read cannot change state).

import { W, tx, ty } from '../core/grid.js';
import { worldStage2 } from '../world/worldrec.js';
import { colTile } from './reserve.js';

export const FILTH = Object.freeze({ perTile: 5, max: 800, every: 120, walkPct: 6, cleanMin: 4, cookPct: 30 });

/** E's saved colony record (created on first write). */
export function workRec(s) {
  const c = s.colony;
  if (!c.work) c.work = { filth: [] };
  if (!c.work.filth) c.work.filth = [];
  return c.work;
}
const list = (s) => (s.colony.work && s.colony.work.filth) || null;
function find(a, i) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m][0] < i) lo = m + 1; else hi = m; }
  return lo;
}
/** Filth units on tile i (0 none). */
export function filthAt(s, i) { const a = list(s); if (!a) return 0; const k = find(a, i); return a[k] && a[k][0] === i ? a[k][1] : 0; }
/** Total filth units over a tile list (a room's tiles). */
export function filthOf(s, tiles) { let n = 0; for (const i of tiles) n += filthAt(s, i); return n; }
/** Filthy tiles, ascending (read only). */
export const filthTiles = (s) => { const a = list(s); return a ? a.map((e) => e[0]) : []; };
/** Can filth lie on tile i (a constructed floor under a roof)? */
export const filthable = (s, i) => s.L.floor[i] !== 0 && s.L.roof[i] !== 0;
/** Add n units of filth on tile i (indoor floors only; capped). Returns true when any was added. */
export function addFilth(s, i, n = 1) {
  if (!worldStage2() || !filthable(s, i)) return false;
  const a = workRec(s).filth, k = find(a, i);
  if (a[k] && a[k][0] === i) { const v = Math.min(FILTH.perTile, a[k][1] + n); if (v === a[k][1]) return false; a[k][1] = v; return true; }
  if (a.length >= FILTH.max) return false;
  a.splice(k, 0, [i, Math.min(FILTH.perTile, n)]);
  return true;
}
/** Remove up to n units on tile i. Returns units removed. */
export function cleanFilth(s, i, n = FILTH.perTile) {
  const a = list(s);
  if (!a) return 0;
  const k = find(a, i);
  if (!a[k] || a[k][0] !== i) return 0;
  const got = Math.min(n, a[k][1]);
  a[k][1] -= got;
  if (a[k][1] <= 0) a.splice(k, 1);
  return got;
}
/** Deterministic percent roll from (tick, id, salt) with no RNG stream. */
export function hashPct(a, b, c) {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) % 100;
}
/** The 'filth' system (slot 'jobs', after the toils): walking colonists track dirt indoors. */
export function filthSystem(s) {
  if (!worldStage2() || s.tick % FILTH.every !== 0) return;
  for (const c of s.col) {
    if (c.hp.dead || !c.path || c.path.i < 0) continue;
    const i = colTile(c);
    if (filthable(s, i) && hashPct(s.tick, c.id, 1) < FILTH.walkPct) addFilth(s, i, 1);
  }
}
/** Mess at a bench (a cook's spill, a butcher's blood), with pct percent. */
export function benchMess(s, b, n, pct, salt) {
  if (hashPct(s.tick, b.id, salt) >= pct) return false;
  return addFilth(s, b.y * W + b.x, n) || addFilth(s, (b.y + 1) * W + b.x, n);
}
export { tx, ty };
