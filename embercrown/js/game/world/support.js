// Roof support, the planning preview and cave-ins (owner B; doc 3.4, 10.11, 13.3).
//
// The rule (3.4): a tile under a ROCK roof (thin 2 or overhead 3) is supported when a support (natural
// rock or rubble, a built wall, a support pillar, a wooden prop) lies within Chebyshev distance
// SUPPORT_RADIUS (4). rt.support (pass.js, incremental, capped at 7) holds the distance to the nearest
// support for every tile, so a check is one read. Built roofs (1) never cave in.
//
//   wouldUnsupport(s, i)       true when mining rock tile i NOW would leave a rock-roofed open tile
//                              (i itself included) unsupported. E's Mine giver skips such tiles unless
//                              the tile carries the risky-ok designation bit (mineAllowed).
//   mineAllowed(s, i)          the giver's test: risky-ok, or mining i keeps every roof supported.
//   planUnsupported(s, rect)   the designation preview (striped orange, 3.4): the tiles that would be
//                              left unsupported once every Mine-designated tile (plus `extra` tiles,
//                              e.g. a drag in progress) is mined; natural pillars are rock that stays.
//   pillarsFor(s, rect, opts)  natural pillars for a hall (the Carve tool, 10.11): a minimal-ish set of
//                              rock tiles inside the rect to leave standing so the whole hall is
//                              supported; deterministic, on a 9-tile lattice first, then gap fill.
//   Cave-ins: after any write that removes a support (mineTile in risky mode, a pillar or prop removed,
//   rubble mined), checkCollapse(s, i) finds the rock-roofed open tiles around i that lost their last
//   support. They collapse to rubble. When the C13 table lists `caveQ` (a SAVED runtime key that A adds
//   to rtcontract.js), they first rumble for CAVE.rumble ticks (40 = 2 s; the renderer shows cracks)
//   and collapse in the caveSystem; until then they collapse at once in the same call (deterministic,
//   no hidden state). A collapse emits `caveIn` { tiles } and calls every onCaveIn(fn) listener with
//   (s, tiles) in tile order: F applies the 20-45 blunt damage, E destroys or buries the items. B
//   pushes colonists standing there to the nearest open tile.

import { W, H, N, TER, ROOF } from '../core/grid.js';
import { RT_KEYS } from '../core/rtcontract.js';
import { emit } from '../core/events.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { SUPPORT_RADIUS, isSupport } from './pass.js';

export const CAVE = Object.freeze({ rumble: 40 });
const R = SUPPORT_RADIUS;

/** A tile whose roof is rock (thin or overhead). */
export const rockRoofed = (s, i) => { const r = s.L.roof[i]; return r === ROOF.THIN || r === ROOF.MOUNTAIN; };
/** An open (non-support) tile under a rock roof: the kind of tile that needs support. */
const needsSupport = (s, i) => rockRoofed(s, i) && !isSupport(s, i);
const MINE_BIT = 1, RISKY_BIT = 64;

/** Is there a support within R of (x, y), not counting the tiles for which `gone(j)` is true? */
function hasSupportNear(s, x, y, gone) {
  const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
  // the map edge counts as rock (3.2 step 2): a window clipped by the edge always has support
  if (x - R < 0 || y - R < 0 || x + R >= W || y + R >= H) return true;
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const j = yy * W + xx;
    if (isSupport(s, j) && !gone(j)) return true;
  }
  return false;
}

/**
 * Would mining rock tile i now leave a rock-roofed open tile unsupported? Checks i itself (it becomes
 * an open roofed tile) and every roofed open tile within R whose nearest support might be i.
 * At most 81 x 81 support checks (3.4), usually far fewer: tiles with a nearer support are skipped.
 */
export function wouldUnsupport(s, i) {
  if (!isSupport(s, i)) return false;
  const x = i % W, y = (i / W) | 0, sup = s.rt.support;
  const gone = (j) => j === i;
  if (!hasSupportNear(s, x, y, gone)) return true;
  const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const j = yy * W + xx;
    if (j === i || !needsSupport(s, j)) continue;
    const d = Math.max(Math.abs(xx - x), Math.abs(yy - y));
    if (sup[j] < d) continue;                         // a nearer support than i exists
    if (!hasSupportNear(s, xx, yy, gone)) return true;
  }
  return false;
}

/** E's Mine giver test (3.4): risky-ok tiles always; otherwise only when no roof is left unsupported. */
export const mineAllowed = (s, i) => (s.L.desig[i] & RISKY_BIT) !== 0 || !wouldUnsupport(s, i);

/**
 * The planning preview: tiles inside `rect` (inclusive {x0, y0, x1, y1}) that would be unsupported
 * once every Mine-designated tile and every tile in `extra` (array or Set of indexes) is mined.
 * Only tiles that are, or will be, open under a rock roof are reported. Sorted by index.
 */
export function planUnsupported(s, rect, extra = null) {
  const x0 = Math.max(0, Math.min(rect.x0, rect.x1)), x1 = Math.min(W - 1, Math.max(rect.x0, rect.x1));
  const y0 = Math.max(0, Math.min(rect.y0, rect.y1)), y1 = Math.min(H - 1, Math.max(rect.y0, rect.y1));
  if (x0 > x1 || y0 > y1) return [];
  const ex = extra ? (extra instanceof Set ? extra : new Set(extra)) : null;
  const planned = (j) => (s.L.desig[j] & MINE_BIT) !== 0 || (ex !== null && ex.has(j));
  const gone = (j) => planned(j) && (s.L.terrain[j] === TER.ROCK || s.L.terrain[j] === TER.RUBBLE);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const j = y * W + x;
    if (gone(j)) { /* will be open under a rock roof */ } else if (isSupport(s, j) || !rockRoofed(s, j)) continue;
    if (!hasSupportNear(s, x, y, gone)) out.push(j);
  }
  return out;
}

/**
 * Natural pillars for a hall carved in `rect`: rock tiles inside it to leave standing so that every
 * tile of the hall ends up supported (support within 4). Rock outside the rect that stays (not Mine-
 * designated) counts, as do supporting buildings. Points sit on a lattice of pitch 2R+1 (9) centred on
 * the rect, then any tile still uncovered gets a pillar R tiles further along (row-major scan), so a
 * 9 x 9 hall needs none when its walls stay, and a 20 x 20 hall gets 4. Only tiles that are rock now
 * can be natural pillars; `opts.any` returns positions on open ground too (for built pillars or props).
 * @returns {number[]} tile indexes, sorted
 */
export function pillarsFor(s, rect, opts = {}) {
  const x0 = Math.max(0, Math.min(rect.x0, rect.x1)), x1 = Math.min(W - 1, Math.max(rect.x0, rect.x1));
  const y0 = Math.max(0, Math.min(rect.y0, rect.y1)), y1 = Math.min(H - 1, Math.max(rect.y0, rect.y1));
  if (x0 > x1 || y0 > y1) return [];
  const P = 2 * R + 1, pil = new Set();
  const cx = (x0 + x1) >> 1, cy = (y0 + y1) >> 1;
  const inRect = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const supportAt = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;            // map edge
    const j = y * W + x;
    if (inRect(x, y)) return pil.has(j) || (isSupport(s, j) && s.L.terrain[j] !== TER.ROCK && s.L.terrain[j] !== TER.RUBBLE);
    return isSupport(s, j) && !((s.L.desig[j] & MINE_BIT) && (s.L.terrain[j] === TER.ROCK || s.L.terrain[j] === TER.RUBBLE));
  };
  const covered = (x, y) => {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (supportAt(x + dx, y + dy)) return true;
    return false;
  };
  const okPillar = (x, y) => opts.any || s.L.terrain[y * W + x] === TER.ROCK;
  // lattice points, but only where the tile would otherwise be uncovered
  for (let y = cy - P * Math.ceil((cy - y0) / P); y <= y1; y += P) {
    if (y < y0) continue;
    for (let x = cx - P * Math.ceil((cx - x0) / P); x <= x1; x += P) {
      if (x < x0 || !okPillar(x, y)) continue;
      if (!covered(x, y)) pil.add(y * W + x);
    }
  }
  // gap fill: an uncovered tile gets a pillar up to R tiles right and down of it (inside the rect)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (pil.has(y * W + x) || covered(x, y)) continue;
    let placed = false;
    for (let d = R; d >= 0 && !placed; d--) {
      const px = Math.min(x + d, x1), py = Math.min(y + d, y1);
      if (okPillar(px, py)) { pil.add(py * W + px); placed = true; }
    }
    if (!placed && okPillar(x, y)) pil.add(y * W + x);
  }
  return [...pil].sort((a, b) => a - b);
}

// ---- Cave-ins ------------------------------------------------------------------------------------------
const caveListeners = [];
/** fn(s, tiles) after tiles collapsed (tiles sorted). F: damage; E: items. Returns an unsubscribe. */
export function onCaveIn(fn) { caveListeners.push(fn); return () => { const k = caveListeners.indexOf(fn); if (k >= 0) caveListeners.splice(k, 1); }; }
const hasCaveQ = () => 'caveQ' in RT_KEYS;

/** Rock-roofed open tiles within R of tile i that have no support within R (after a support was lost). */
export function unsupportedNear(s, i) {
  const x = i % W, y = (i / W) | 0, sup = s.rt.support, out = [];
  for (let yy = Math.max(0, y - R); yy <= Math.min(H - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(W - 1, x + R); xx++) {
    const j = yy * W + xx;
    if (sup[j] > R && needsSupport(s, j) && !hasSupportNear(s, xx, yy, () => false)) out.push(j);
  }
  return out;
}

/**
 * Called by terrain.js after a support source at i disappeared (rt.support already patched). Queues
 * (or performs) the collapse of the tiles that lost their last support.
 * @returns {number[]} the tiles that will collapse (or did)
 */
export function checkCollapse(s, i) {
  const tiles = unsupportedNear(s, i);
  if (!tiles.length) return tiles;
  if (hasCaveQ() && Array.isArray(s.rt.caveQ)) {
    const q = s.rt.caveQ, at = s.tick + CAVE.rumble;
    for (const j of tiles) if (!q.some((e) => e[0] === j)) q.push([j, at]);
    emit(s, 'caveRumble', { tiles });
    return tiles;
  }
  collapse(s, tiles);
  return tiles;
}

let setTerrainFn = null;
/** terrain.js hands its setTerrain over (avoids an import cycle). */
export function bindTerrain(fn) { setTerrainFn = fn; }

/** Collapse tiles to rubble (still-supported ones are skipped: a pillar may have been built meanwhile). */
export function collapse(s, tiles) {
  const done = [];
  for (const j of tiles.slice().sort((a, b) => a - b)) {
    if (!needsSupport(s, j)) continue;
    if (hasSupportNear(s, j % W, (j / W) | 0, () => false)) continue;
    if (setTerrainFn) setTerrainFn(s, j, TER.RUBBLE);
    done.push(j);
  }
  if (!done.length) return done;
  pushOut(s, done);
  emit(s, 'caveIn', { tiles: done });
  for (let k = 0; k < caveListeners.length; k++) caveListeners[k](s, done);
  return done;
}

/** Colonists, animals and foes standing on collapsed tiles move to the nearest walkable tile (ring order). */
function pushOut(s, tiles) {
  const set = new Set(tiles);
  for (const list of [s.col, s.anim, s.foes]) {
    for (const e of list) {
      if (!e || typeof e.x !== 'number') continue;
      const ex = Math.min(W - 1, Math.max(0, Math.floor(e.x / 32))), ey = Math.min(H - 1, Math.max(0, Math.floor(e.y / 32)));
      if (!set.has(ey * W + ex)) continue;
      const to = nearestOpen(s, ex, ey);
      if (to >= 0) { e.x = (to % W) * 32 + 16; e.y = ((to / W) | 0) * 32 + 16; if (e.path) e.path = null; }
    }
  }
}
function nearestOpen(s, x, y) {
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (s.rt.walkCost[j] !== 0) return j;
    }
  }
  return -1;
}

/** Collapses due this tick (only when the C13 table has caveQ). Runs in the 'mechanisms' slot. */
export function caveSystem(s) {
  const q = s.rt.caveQ;
  if (!Array.isArray(q) || !q.length) return;
  const due = [];
  let w = 0;
  for (let k = 0; k < q.length; k++) { if (q[k][1] <= s.tick) due.push(q[k][0]); else q[w++] = q[k]; }
  q.length = w;
  if (due.length) collapse(s, due);
}

export function installSupport() {
  if (!tickSystems().some((x) => x.slot === 'mechanisms' && x.name === 'cave-in')) registerSystem('mechanisms', 'cave-in', caveSystem, 0);
}

/** Debug: count of rock-roofed open tiles that are unsupported right now (0 in a healthy hold). */
export function unsupportedCount(s) {
  let n = 0;
  for (let j = 0; j < N; j++) if (needsSupport(s, j) && s.rt.support[j] > R) n++;
  return n;
}
