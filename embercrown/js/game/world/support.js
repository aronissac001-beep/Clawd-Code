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
//   support. They collapse to rubble. From Stage 2 (worldrec.worldStage2) they first rumble for
//   WORLD.cave.rumble ticks (40 = 2 s; the renderer shows cracks from rumbling()) in the saved queue
//   s.colony.world.caveQ and collapse in the caveSystem; in Stage 1a-1b they collapse at once in the
//   same call (deterministic, no hidden state). A collapse emits `caveIn` { i, tiles } and calls every
//   onCaveIn(fn) listener with (s, tiles, hit) in tile order, hit = [{ kind: 'col' | 'anim' | 'foe', id }]
//   of the movers that stood on them: F applies the 20-45 blunt damage, E destroys or buries the items.
//   B pushes the movers to the nearest open tile.
//
//   The collapse rule (Stage 2 acceptance, 14.8: a 10 x 10 unsupported room collapses, a 9 x 9 does
//   not): a rock-roofed tile is HELD when a support lies within SUPPORT_RADIUS (4), or when it sits in
//   the middle of a 9-tile span: supports exactly 5 tiles away on both sides along its row or column
//   (spanHeld). Planning (wouldUnsupport, planUnsupported, pillarsFor, the Mine giver's mineAllowed)
//   keeps the plain 4-tile rule, one tile of margin, so a planned hall never rumbles.
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.5). At D > 1 the same rules run PER LEVEL:
//   - a voxel needs support when it is open (not a support) and has a ceiling: the voxel above is a lid
//     (anything but void, open air or a ramp top: rock, a natural or constructed floor, a stair). A built
//     roof is a ceiling for cover but never caves in, as before. The roof layer's THIN and MOUNTAIN are not
//     read at D > 1.
//   - the radius is STONE_SUPPORT (4), or SOIL_SUPPORT (2) under a soil ceiling (the ceiling voxel's band is
//     soil, js/data/levels.js; at the surface only where it is not rock). bindSoilRule(fn) lets the 3D
//     generator (E10) refine it with real soil materials. The 9-span rule scales with it (R + 1 both sides),
//     so a 9 x 9 stone hall and a 5 x 5 soil room stand, a 10 x 10 and a 6 x 6 come down.
//   - hanging floors: a floor voxel (natural or built) over AIR must lie within the same radius, on its own
//     level, of an anchor: a support, or a floor voxel that stands on something (the voxel below is not
//     AIR). The span rule applies, so a bridge across a shaft is at most 9 wide.
//   - a collapse fills each unsupported voxel with rubble and turns its ceiling voxel at z+1 into AIR (a
//     sinkhole: what stood there falls); a hanging floor that lets go becomes AIR (what stood on it falls).
//     Every voxel that becomes AIR (a channel, a sinkhole, a fallen floor) re-checks the floors around it
//     on its own level and the level above, which rumble in their turn: a chain shows one level per rumble
//     and never drops a whole column in one tick. The rumble queue (caveQ) holds u32 voxel indexes.
//   - movers on a collapsed voxel are pushed to the nearest open voxel on their level.
//   - the planning reads (wouldUnsupport, planUnsupported, pillarsFor, tremor) take the level from the
//     voxel index or from rect.z; planLevels() adds the level-above stripes of 2.5.

import { W, H, N, D, PLANE, zS, TER, ROOF, TER_FLOOR, TER_UP, TER_DOWN } from '../core/grid.js';
import { STONE_SUPPORT, SOIL_SUPPORT, bandOfRel } from '../../data/levels.js';
import { TER_SKY } from './vertical.js';
import { onTileWrite, onMined } from './terrain.js';
import { setFluid, FL } from './pass.js';
import { FLUID } from '../../data/levels.js';
import { emit } from '../core/events.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { SUPPORT_RADIUS, isSupport } from './pass.js';
import { WORLD } from '../../data/worldgen.js';
import { worldStage2, worldRec, ensureWorld, putKey, findKey } from './worldrec.js';

export const CAVE = Object.freeze({ rumble: WORLD.cave.rumble, dmg: WORLD.cave.dmg });
const R = SUPPORT_RADIUS;

// ---- Level helpers (identity at D = 1: base 0, row y) --------------------------------------------------
const baseOf = (i) => i - (i % PLANE);
const yOf = (i) => ((i % PLANE) / W) | 0;

/** A ceiling over voxel i at D > 1: the voxel above is a lid (2.4; a built roof never caves in). */
export const hasCeiling = (s, i) => i + PLANE < N && TER_SKY[s.L.terrain[i + PLANE]] !== 1;
/** A tile whose roof is rock: thin or overhead at D = 1; a voxel with a natural ceiling above it at D > 1. */
export const rockRoofed = (s, i) => {
  if (D > 1) return hasCeiling(s, i);
  const r = s.L.roof[i]; return r === ROOF.THIN || r === ROOF.MOUNTAIN;
};
/** An open (non-support) tile under a rock roof: the kind of tile that needs support. */
// (D > 1: open air has no floor of its own to fill; the floors over a shaft follow the hanging rule instead)
const needsSupport = (s, i) => rockRoofed(s, i) && !isSupport(s, i) && (D === 1 || (s.L.terrain[i] !== TER.VOID && s.L.terrain[i] !== TER.AIR));
const MINE_BIT = 1, RISKY_BIT = 64;

let soilRule = null;
/** E10 (mapgen3) may refine the soil test with real soil materials: fn(s, ceilingVoxel) -> bool. */
export function bindSoilRule(fn) { soilRule = fn; }
/** Is the voxel j (a ceiling) soil? By band (2.2: topsoil, subsoil; the surface where it is not rock). */
export function soilVoxel(s, j) {
  if (soilRule) return !!soilRule(s, j);
  const z = (j / PLANE) | 0, b = bandOfRel(z - zS);
  if (!b.soil) return false;
  const t = s.L.terrain[j];
  return z !== zS || (t !== TER.ROCK && t !== TER.RUBBLE);
}
/** Support radius for voxel i: 4, or 2 under a soil ceiling (2.5). Always R at D = 1. */
export function radiusOf(s, i) {
  if (D === 1) return R;
  return i + PLANE < N && soilVoxel(s, i + PLANE) ? SOIL_SUPPORT : STONE_SUPPORT;
}

/** Is there a support within r of (x, y) on the level at `base`, not counting the tiles for which `gone(j)` is true? */
function hasSupportNear(s, x, y, gone, base = 0, r = R) {
  const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r), y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
  // the map edge counts as rock (3.2 step 2): a window clipped by the edge always has support
  if (x - r < 0 || y - r < 0 || x + r >= W || y + r >= H) return true;
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const j = base + yy * W + xx;
    if (isSupport(s, j) && !gone(j)) return true;
  }
  return false;
}

// ---- Hanging floors (2.5, D > 1) --------------------------------------------------------------------------
/** A floor voxel (natural or built, not a support) with open air under it. */
export const overAir = (s, i) => {
  if (D === 1 || i < PLANE) return false;
  const t = s.L.terrain[i];
  return TER_FLOOR[t] === 1 && !isSupport(s, i) && s.L.terrain[i - PLANE] === TER.AIR;
};
/** An anchor for hanging floors: a support, or a floor voxel standing on something (not over AIR). */
const anchor = (s, j) => {
  if (isSupport(s, j)) return true;
  const t = s.L.terrain[j];
  return TER_FLOOR[t] === 1 && (j < PLANE || s.L.terrain[j - PLANE] !== TER.AIR);
};
const anchAt = (s, base, x, y) => x < 0 || y < 0 || x >= W || y >= H || anchor(s, base + y * W + x);
/** Chebyshev distance from voxel i to the nearest anchor on its level, up to cap (cap + 1 when none). */
function anchorDist(s, i, cap) {
  const base = baseOf(i), x = i % W, y = yOf(i);
  for (let r = 0; r <= cap; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (anchAt(s, base, x + dx, y + dy)) return r;
    }
  }
  return cap + 1;
}
/** Is a hanging floor held (within R of an anchor, or in the middle of a 2R+1 span)? */
export function hangHeld(s, i) {
  if (!overAir(s, i)) return true;
  const r = STONE_SUPPORT, d = anchorDist(s, i, r + 1);
  if (d <= r) return true;
  if (d > r + 1) return false;
  const base = baseOf(i), x = i % W, y = yOf(i), k = r + 1;
  return (anchAt(s, base, x - k, y) && anchAt(s, base, x + k, y)) || (anchAt(s, base, x, y - k) && anchAt(s, base, x, y + k));
}

/**
 * Would mining rock tile i now leave a rock-roofed open tile unsupported? Checks i itself (it becomes
 * an open roofed tile) and every roofed open tile within R whose nearest support might be i.
 * At most 81 x 81 support checks (3.4), usually far fewer: tiles with a nearer support are skipped.
 */
export function wouldUnsupport(s, i) {
  if (!isSupport(s, i)) return false;
  const x = i % W, y = yOf(i), base = baseOf(i), sup = s.rt.support;
  const gone = (j) => j === i;
  if ((D === 1 || rockRoofed(s, i)) && !hasSupportNear(s, x, y, gone, base, radiusOf(s, i))) return true;
  const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R), y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
  for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
    const j = base + yy * W + xx;
    if (j === i || !needsSupport(s, j)) continue;
    const d = Math.max(Math.abs(xx - x), Math.abs(yy - y)), r = radiusOf(s, j);
    if (d > r) continue;
    if (sup[j] < d) continue;                         // a nearer support than i exists
    if (!hasSupportNear(s, xx, yy, gone, base, r)) return true;
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
  const base = D > 1 ? Math.max(0, Math.min(D - 1, rect.z | 0)) * PLANE : 0;
  const ex = extra ? (extra instanceof Set ? extra : new Set(extra)) : null;
  const planned = (j) => (s.L.desig[j] & MINE_BIT) !== 0 || (ex !== null && ex.has(j));
  const gone = (j) => planned(j) && (s.L.terrain[j] === TER.ROCK || s.L.terrain[j] === TER.RUBBLE);
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const j = base + y * W + x;
    if (gone(j)) { if (D > 1 && !rockRoofed(s, j)) continue; /* will be open under a rock roof */ } else if (isSupport(s, j) || !rockRoofed(s, j)) continue;
    if (!hasSupportNear(s, x, y, gone, base, radiusOf(s, j))) out.push(j);
  }
  return out;
}

/**
 * The 2.5 preview on two levels: { here, above }. `here` is planUnsupported on rect.z; `above` the voxels at
 * rect.z + 1 that would lose their floor: the ceilings of `here` (they would open as sinkholes) and, for
 * `channel` voxels (voxels to be channelled to AIR at rect.z), the floors at rect.z + 1 left hanging... and
 * at rect.z the floors around a channel left hanging. Sorted by index.
 */
export function planLevels(s, rect, extra = null, channel = null) {
  const here = planUnsupported(s, rect, extra);
  if (D === 1) return { here, above: [] };
  const above = new Set(), hereSet = new Set(here);
  for (const j of here) if (j + PLANE < N) above.add(j + PLANE);
  if (channel && channel.length) {
    const ch = new Set(channel), L = s.L.terrain;
    const isAirAfter = (j) => ch.has(j) || L[j] === TER.AIR;
    const anch = (j) => isSupport(s, j) || (TER_FLOOR[L[j]] === 1 && !ch.has(j) && (j < PLANE || !isAirAfter(j - PLANE)));
    const hangs = (j) => j >= PLANE && !ch.has(j) && TER_FLOOR[L[j]] === 1 && !isSupport(s, j) && isAirAfter(j - PLANE);
    const nearAnchor = (j) => {
      const base = baseOf(j), x = j % W, y = yOf(j), r = STONE_SUPPORT;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) return true;
        if (anch(base + yy * W + xx)) return true;
      }
      return false;
    };
    for (const c of ch) {
      const up = c + PLANE;
      if (up < N && hangs(up) && !nearAnchor(up)) above.add(up);
      // floors on the channel's own level that hung on it
      const base = baseOf(c), x = c % W, y = yOf(c);
      for (let dy = -STONE_SUPPORT; dy <= STONE_SUPPORT; dy++) for (let dx = -STONE_SUPPORT; dx <= STONE_SUPPORT; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = base + yy * W + xx;
        if (hangs(j) && !nearAnchor(j)) hereSet.add(j);
      }
    }
  }
  return { here: [...hereSet].sort((a, b) => a - b), above: [...above].sort((a, b) => a - b) };
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
  const base = D > 1 ? Math.max(0, Math.min(D - 1, rect.z | 0)) * PLANE : 0;
  // under soil (D > 1) the radius is 2: the lattice tightens to 5
  let R = STONE_SUPPORT;
  if (D > 1) for (let y = y0; y <= y1 && R === STONE_SUPPORT; y++) for (let x = x0; x <= x1; x++) if (radiusOf(s, base + y * W + x) < R) { R = radiusOf(s, base + y * W + x); break; }
  if (D === 1) R = SUPPORT_RADIUS;
  const P = 2 * R + 1, pil = new Set();
  const cx = (x0 + x1) >> 1, cy = (y0 + y1) >> 1;
  const inRect = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const supportAt = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return true;            // map edge
    const j = base + y * W + x;
    if (inRect(x, y)) return pil.has(j) || (isSupport(s, j) && s.L.terrain[j] !== TER.ROCK && s.L.terrain[j] !== TER.RUBBLE);
    return isSupport(s, j) && !((s.L.desig[j] & MINE_BIT) && (s.L.terrain[j] === TER.ROCK || s.L.terrain[j] === TER.RUBBLE));
  };
  const covered = (x, y) => {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (supportAt(x + dx, y + dy)) return true;
    return false;
  };
  const okPillar = (x, y) => opts.any || s.L.terrain[base + y * W + x] === TER.ROCK;
  // lattice points, but only where the tile would otherwise be uncovered
  for (let y = cy - P * Math.ceil((cy - y0) / P); y <= y1; y += P) {
    if (y < y0) continue;
    for (let x = cx - P * Math.ceil((cx - x0) / P); x <= x1; x += P) {
      if (x < x0 || !okPillar(x, y)) continue;
      if (!covered(x, y)) pil.add(base + y * W + x);
    }
  }
  // gap fill: an uncovered tile gets a pillar up to R tiles right and down of it (inside the rect)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (pil.has(base + y * W + x) || covered(x, y)) continue;
    let placed = false;
    for (let d = R; d >= 0 && !placed; d--) {
      const px = Math.min(x + d, x1), py = Math.min(y + d, y1);
      if (okPillar(px, py)) { pil.add(base + py * W + px); placed = true; }
    }
    if (!placed && okPillar(x, y)) pil.add(base + y * W + x);
  }
  return [...pil].sort((a, b) => a - b);
}

// ---- Cave-ins ------------------------------------------------------------------------------------------
const caveListeners = [];
/** fn(s, tiles, hit) after tiles collapsed (tiles sorted; hit: movers that stood there). F: damage; E: items. Returns an unsubscribe. */
export function onCaveIn(fn) { caveListeners.push(fn); return () => { const k = caveListeners.indexOf(fn); if (k >= 0) caveListeners.splice(k, 1); }; }

const supAt = (s, base, x, y) => x < 0 || y < 0 || x >= W || y >= H || isSupport(s, base + y * W + x);
/** The 9-span rule: supports exactly R + 1 tiles away on both sides along the row or the column (r + 1 for radius r). */
export function spanHeld(s, i, r = R) {
  const x = i % W, y = yOf(i), d = r + 1, base = baseOf(i);
  return (supAt(s, base, x - d, y) && supAt(s, base, x + d, y)) || (supAt(s, base, x, y - d) && supAt(s, base, x, y + d));
}
/** Is a rock-roofed open tile held up (the collapse rule)? Tiles that need no support are always held. A hanging floor too (D > 1). */
export function held(s, i) {
  if (!needsSupport(s, i)) return D === 1 || hangHeld(s, i);
  if (D > 1 && !hangHeld(s, i)) return false;
  return ceilHeld(s, i);
}
/** The ceiling rule alone (support within the radius, the map edge, or the span). */
function ceilHeld(s, i) {
  const r = radiusOf(s, i);
  if (s.rt.support[i] <= r) return true;
  const x = i % W, y = yOf(i);
  if (hasSupportNear(s, x, y, () => false, baseOf(i), r)) return true;   // the map edge counts as rock
  return s.rt.support[i] === r + 1 && spanHeld(s, i, r);
}

/** Rock-roofed open tiles within R + 1 of tile i (on its level) that are no longer held (after a support was lost). */
export function unsupportedNear(s, i) {
  const x = i % W, y = yOf(i), base = baseOf(i), sup = s.rt.support, out = [], r = R + 1;
  for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
    const j = base + yy * W + xx;
    if (D === 1) { if (sup[j] > R && !held(s, j)) out.push(j); continue; }
    if ((needsSupport(s, j) && sup[j] > radiusOf(s, j) && !ceilHeld(s, j)) || (overAir(s, j) && !hangHeld(s, j))) out.push(j);
  }
  return out;
}

/**
 * D > 1: voxel i became open air (a channel, a sinkhole, a fallen floor). The floors around it on its level and
 * the floors above it on the next level may now hang unheld: queue them (Stage 2: rumble first) as checkCollapse
 * does. Returns the voxels queued or collapsed.
 */
export function checkHanging(s, i) {
  if (D === 1) return [];
  const out = [];
  for (const c of [i, i + PLANE]) {
    if (c >= N) continue;
    for (const j of unsupportedNear(s, c)) out.push(j);
  }
  if (!out.length) return out;
  const tiles = [...new Set(out)].sort((a, b) => a - b);
  if (worldStage2()) { queueRumble(s, tiles); return tiles; }
  return collapse(s, tiles);
}
function queueRumble(s, tiles) {
  const q = ensureWorld(s).caveQ, at = s.tick + rumbleTicks(s);
  const fresh = [];
  for (const j of tiles) if (findKey(q, j) < 0) { putKey(q, [j, at]); fresh.push(j); }
  if (fresh.length) emit(s, 'caveRumble', { tiles: fresh });
}

/**
 * Called by terrain.js after a support source at i disappeared (rt.support already patched). Queues
 * (Stage 2: they rumble first) or performs the collapse of the tiles that lost their last support.
 * @returns {number[]} the tiles that will collapse (or did)
 */
export function checkCollapse(s, i) {
  const tiles = unsupportedNear(s, i);
  if (!tiles.length) return tiles;
  if (worldStage2()) {
    queueRumble(s, tiles);
    return tiles;
  }
  collapse(s, tiles);
  return tiles;
}
/**
 * How long a new rumble lasts before the roof comes down: WORLD.cave.rumble (40 ticks, 2 s), or the
 * lead F's people install binds (the Cave Sense perk, Mining 10: a living colonist with it sees the
 * cracks 2 game hours early, so the rumble starts that much sooner and a prop or pillar can be set).
 */
let leadFn = null;
export function bindRumbleLead(fn) { leadFn = fn; }
export const rumbleTicks = (s) => Math.max(CAVE.rumble, leadFn ? leadFn(s) | 0 : 0);
/** Tiles rumbling now (sorted), for the crack overlay and the Cave Sense perk. */
export const rumbling = (s) => worldRec(s).caveQ.map((e) => e[0]);

let setTerrainFn = null;
/** terrain.js hands its setTerrain over (avoids an import cycle). */
export function bindTerrain(fn) { setTerrainFn = fn; }

/**
 * H's cave-in tremor (9.7): within r tiles of tile i, every rock-roofed open tile that is only just
 * held (its nearest support exactly SUPPORT_RADIUS away, or held by the 9-span) rumbles and comes
 * down. Returns the tiles queued (Stage 2) or collapsed.
 */
export function tremor(s, i, r = 8) {
  const x = i % W, y = yOf(i), base = baseOf(i), sup = s.rt.support, out = [];
  for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) {
    const j = base + yy * W + xx;
    if (needsSupport(s, j) && sup[j] >= radiusOf(s, j)) out.push(j);
  }
  if (!out.length) return out;
  if (worldStage2()) {
    const q = ensureWorld(s).caveQ, at = s.tick + rumbleTicks(s);
    for (const j of out) putKey(q, [j, at, 1]);
    emit(s, 'caveRumble', { tiles: out });
  } else collapse(s, out, true);
  return out;
}

/** Collapse tiles to rubble (tiles held again are skipped unless forced: a pillar may have been built meanwhile). */
export function collapse(s, tiles, force = false) {
  const done = [];
  const forced = force === true ? null : force;    // a Set of forced tiles (the tremor queue entries)
  if (D === 1) {
    for (const j of tiles.slice().sort((a, b) => a - b)) {
      if (!needsSupport(s, j)) continue;
      if (held(s, j) && force !== true && !(forced && forced.has(j))) continue;
      if (setTerrainFn) setTerrainFn(s, j, TER.RUBBLE);
      done.push(j);
    }
    if (!done.length) return done;
    const hit = pushOut(s, done);
    emit(s, 'caveIn', { i: done[0], tiles: done });
    for (let k = 0; k < caveListeners.length; k++) caveListeners[k](s, done, hit);
    return done;
  }
  // D > 1: the whole unheld set is decided first, then it comes down together
  const falls = [];
  for (const j of tiles.slice().sort((a, b) => a - b)) {
    const forcedJ = force === true || (forced && forced.has(j));
    if (needsSupport(s, j) && (forcedJ || !ceilHeld(s, j))) { done.push(j); continue; }
    // a hanging floor that lets go becomes open air (what stood on it falls in setTerrain)
    if (overAir(s, j) && (forcedJ || !hangHeld(s, j))) falls.push(j);
  }
  if (!done.length && !falls.length) return done;
  // movers leave the voxels before the rubble lands (pushed on their level), then the ceilings open
  const hit = done.length ? pushOut(s, done) : [];
  if (setTerrainFn) {
    for (const j of done) setTerrainFn(s, j, TER.RUBBLE);
    for (const j of done) if (j + PLANE < N && s.L.terrain[j + PLANE] !== TER.AIR) setTerrainFn(s, j + PLANE, TER.AIR);
    for (const j of falls) setTerrainFn(s, j, TER.AIR);
  }
  for (const j of falls) done.push(j);
  done.sort((a, b) => a - b);
  emit(s, 'caveIn', { i: done[0], tiles: done });
  for (let k = 0; k < caveListeners.length; k++) caveListeners[k](s, done, hit);
  return done;
}

/** Colonists, animals and foes standing on collapsed tiles move to the nearest walkable tile (ring order). */
function pushOut(s, tiles) {
  const set = new Set(tiles), hit = [];
  for (const [kind, list] of [['col', s.col], ['anim', s.anim], ['foe', s.foes]]) {
    for (const e of list) {
      if (!e || typeof e.x !== 'number') continue;
      const ex = Math.min(W - 1, Math.max(0, Math.floor(e.x / 32))), ey = Math.min(H - 1, Math.max(0, Math.floor(e.y / 32)));
      const base = D > 1 ? Math.max(0, Math.min(D - 1, e.z | 0)) * PLANE : 0;
      if (!set.has(base + ey * W + ex)) continue;
      hit.push({ kind, id: e.id });
      const to = nearestOpen(s, ex, ey, base, set);
      if (to >= 0) { e.x = (to % W) * 32 + 16; e.y = yOf(to) * 32 + 16; if (e.path) e.path = null; }
    }
  }
  return hit;
}
function nearestOpen(s, x, y, base = 0, avoid = null) {
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = base + yy * W + xx;
      if (D > 1 && avoid && avoid.has(j)) continue;
      if (s.rt.walkCost[j] !== 0) return j;
    }
  }
  return -1;
}

/** Collapses due this tick (the saved rumble queue). Runs in the 'mechanisms' slot. */
export function caveSystem(s) {
  const w = s.colony.world;
  if (!w || !w.caveQ.length) return;
  const q = w.caveQ, due = [], forced = new Set();
  let k2 = 0;
  for (let k = 0; k < q.length; k++) { if (q[k][1] <= s.tick) { due.push(q[k][0]); if (q[k][2]) forced.add(q[k][0]); } else q[k2++] = q[k]; }
  q.length = k2;
  if (due.length) collapse(s, due, forced.size ? forced : false);
}

let airHooked = false;
export function installSupport() {
  if (!tickSystems().some((x) => x.slot === 'mechanisms' && x.name === 'cave-in')) registerSystem('mechanisms', 'cave-in', caveSystem, 0);
  // D > 1: a voxel that becomes open air re-checks the floors that may hang on it (2.5 chains)
  if (!airHooked) {
    airHooked = true;
    onTileWrite((s, i, layer, before, after) => {
      if (D === 1 || layer !== 'terrain') return;
      // a lid laid or lifted changes the cover of the column below it: temperature reads cover (2.6)
      if (TER_SKY[before] !== TER_SKY[after]) s.rt.dirty.temperature = true;
      // light crosses levels through open air and stair or ramp pairs (2.6): a change there relights z +- 1
      if (TER_SKY[before] !== TER_SKY[after] || TER_UP[before] !== TER_UP[after] || TER_DOWN[before] !== TER_DOWN[after]) { s.rt.dirty.light = true; s.rt.dirty.tiles.push(i); }
      if (after === TER.AIR && before !== TER.AIR) checkHanging(s, i);
    });
    // 2.8: mining an aquifer voxel (a source in rock) leaves a seep of water depth 2 that stays a source
    onMined((s, i) => {
      const f = s.L.fluid;
      if (f && (f[i] & FL.SOURCE) && !(f[i] & FL.DEPTH)) setFluid(s, i, (f[i] & ~FL.DEPTH) | FLUID.seepDepth);
    });
  }
}

/** Debug: count of rock-roofed open tiles that are not held right now (0 in a healthy hold). */
export function unsupportedCount(s) {
  let n = 0;
  for (let j = 0; j < N; j++) if (needsSupport(s, j) && s.rt.support[j] > radiusOf(s, j) && !held(s, j)) n++;
  return n;
}
