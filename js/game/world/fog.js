// Fog and discovery (owner B; doc 3.5, 3.4). Two saved bitsets (C1): `fog` = explored, `known` =
// a rock tile's material and ore are visible.
//   Surface: explored-only fog. Each colonist reveals radius SIGHT.surface (9) around it, or
//   SIGHT.roofed (4) when it stands under a roof. Sight floods through open tiles from the
//   colonist (rock, walls and closed doors stop it), so a tunnel does not reveal the next tunnel.
//   Every opaque tile the flood touches is explored; a rock tile touched from an open tile is also
//   known (an exposed face: material and ore show). Once explored, a tile stays explored.
//   Underground: rock interiors stay unknown until mined next to (terrain.mineTile marks the 8
//   neighbours known) or surveyed (Stage 2 prospecting and the Survey Table use revealKnown).
// The fog system runs in the 'movement' tick slot after movement, every SIGHT.every ticks, for each
// colonist in s.col order (deterministic, stateless: it reads only saved state). Writes go through
// terrain.setExplored / setKnown (render patches) and emit `oreFound` for a newly known ore face.
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.7). At D > 1 `fog` and `known` are bitsets of N:
//   - a colonist reveals its own level (radius 9 under open sky, cover 0; 4 under a ceiling), one level up and
//     down through a stair or ramp pair (radius 2), and down through open air: a voxel of open air within 3
//     of it shows the floor it would fall to (radius 1 around that floor);
//   - mining marks the 6 face neighbours known (terrain.js the 8 planar ones; the onMined hook here the
//     voxels above and below), and the first voxel mined or seen in a band writes its discovery (levels.js
//     `disc`: soil, aquifer, each stone band, each cavern, the ember layer, the Seal) as `discovery`
//     { kind, i } once (s.colony.world.disc keeps the kinds met);
//   - revealKnown(s, i, r, dz) reveals a cylinder of radius r and +-dz levels (Prospect r 5 dz 1, the Survey
//     Table r 12 dz 2); sounding(s, i) reveals the column 1-3 levels below in radius 3 (Sounding, 2.7).

import { W, H, N, D, PLANE, zS, TER, ROOF, getBit, DX8, DY8 } from '../core/grid.js';
import { emit } from '../core/events.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { isOpaque } from './pass.js';
import { setExplored, setKnown, onMined } from './terrain.js';
import { linksOf, fallTarget, coverAt } from './vertical.js';
import { bandOfRel, SOUNDING, SIGHT3 } from '../../data/levels.js';
import { ensureWorld, worldRec } from './worldrec.js';

export const SIGHT = Object.freeze({ surface: 9, roofed: 4, every: 10 });

let qbuf = null, dbuf = null, mark = null, gen = 0;
function bufs() {
  if (!qbuf || qbuf.length !== N) { qbuf = new Int32Array(N); dbuf = new Uint8Array(N); mark = new Uint32Array(N); gen = 0; }
  if (++gen >= 0xffffffff) { mark.fill(0); gen = 1; }
}

/** Mark rock tile j known (and emit oreFound once for a newly seen ore face). */
function knowRock(s, j) {
  if (getBit(s.L.known, j)) return;
  setKnown(s, j, true);
  if (s.L.terrain[j] === TER.ROCK && s.L.ore[j]) emit(s, 'oreFound', { i: j, ore: s.L.ore[j] });
}

/**
 * Reveal what is visible from tile i within Euclidean radius r: a flood over open tiles (8-way,
 * no corner cutting past opaque tiles); opaque tiles reached are explored, rock faces become known.
 * quiet = true writes the bits directly (world creation: no events, no render patches).
 * @returns {number} tiles newly explored
 */
export function revealAround(s, i, r, quiet = false, lip = null) {
  bufs();
  const L = s.L, r2 = r * r, base = i - (i % PLANE), ox = i % W, oy = ((i % PLANE) / W) | 0;
  let h = 0, t = 0, fresh = 0;
  const visit = (j) => {
    if (!getBit(L.fog, j)) { fresh++; if (quiet) L.fog[j >> 3] |= 1 << (j & 7); else setExplored(s, j, true); }
  };
  const know = (j) => {
    if (L.terrain[j] !== TER.ROCK && L.terrain[j] !== TER.RUBBLE) return;
    if (quiet) L.known[j >> 3] |= 1 << (j & 7); else knowRock(s, j);
  };
  mark[i] = gen; visit(i);
  if (isOpaque(s, i)) { know(i); return fresh; }
  qbuf[t++] = i;
  while (h < t) {
    const c = qbuf[h++], cx = c % W, cy = ((c % PLANE) / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const dx = nx - ox, dy = ny - oy;
      if (dx * dx + dy * dy > r2) continue;
      const j = base + ny * W + nx;
      if (mark[j] === gen) continue;
      if (d >= 4 && isOpaque(s, base + cy * W + nx) && isOpaque(s, base + ny * W + cx)) continue; // no seeing through a diagonal gap
      mark[j] = gen;
      visit(j);
      if (isOpaque(s, j)) { know(j); continue; }
      if (lip && L.terrain[j] === TER.AIR && dx * dx + dy * dy <= SIGHT3.lip * SIGHT3.lip) lip.push(j);
      qbuf[t++] = j;
    }
  }
  return fresh;
}

/** Make rock tiles within radius r of tile i known (prospecting, the Survey Table; Stage 2 callers). */
export function revealKnown(s, i, r, dz = 0) {
  const ox = i % W, oy = ((i % PLANE) / W) | 0, oz = (i / PLANE) | 0, r2 = r * r;
  let n = 0;
  for (let z = Math.max(0, oz - dz); z <= Math.min(D - 1, oz + dz); z++) {
    const base = z * PLANE;
    for (let y = Math.max(0, oy - r); y <= Math.min(H - 1, oy + r); y++) for (let x = Math.max(0, ox - r); x <= Math.min(W - 1, ox + r); x++) {
      if ((x - ox) * (x - ox) + (y - oy) * (y - oy) > r2) continue;
      const j = base + y * W + x;
      if (s.L.terrain[j] === TER.ROCK && !getBit(s.L.known, j)) { knowRock(s, j); n++; }
    }
  }
  return n;
}
/** Prospect and the Survey Table across levels (2.7): radius 5 and +-1 level, radius 12 and +-2 levels. */
export const PROSPECT3 = Object.freeze({ prospect: { r: 5, dz: 1 }, survey: { r: 12, dz: 2 } });
/**
 * Sounding (2.7; Mining 6+, at a stair bottom, 2 game hours: E's job calls this when the work is done):
 * every voxel of the column 1..SOUNDING.levels levels below voxel i within radius SOUNDING.r becomes known
 * (open voxels too, so the player reads caverns and the aquifer before cutting into them). Returns voxels newly known.
 */
export function sounding(s, i) {
  const ox = i % W, oy = ((i % PLANE) / W) | 0, oz = (i / PLANE) | 0, r = SOUNDING.r, r2 = r * r;
  let n = 0;
  for (let z = oz - 1; z >= Math.max(0, oz - SOUNDING.levels); z--) {
    const base = z * PLANE;
    for (let y = Math.max(0, oy - r); y <= Math.min(H - 1, oy + r); y++) for (let x = Math.max(0, ox - r); x <= Math.min(W - 1, ox + r); x++) {
      if ((x - ox) * (x - ox) + (y - oy) * (y - oy) > r2) continue;
      const j = base + y * W + x;
      if (getBit(s.L.known, j)) continue;
      if (s.L.terrain[j] === TER.ROCK) knowRock(s, j); else setKnown(s, j, true);
      n++;
    }
  }
  return n;
}

const tileOf = (e) => {
  const x = Math.min(W - 1, Math.max(0, Math.floor(e.x / 32))), y = Math.min(H - 1, Math.max(0, Math.floor(e.y / 32)));
  return D > 1 ? Math.max(0, Math.min(D - 1, e.z | 0)) * PLANE + y * W + x : y * W + x;
};
/** The fog system: every SIGHT.every ticks, each colonist reveals its sight radius. */
export function fogSystem(s) {
  if (s.tick % SIGHT.every !== 0) return;
  for (const c of s.col) {
    if (!c || (c.hp && c.hp.dead)) continue;   // the dead see nothing (and cost nothing: the soak, 14.8 J)
    const i = tileOf(c);
    if (D > 1) { sight3(s, i); continue; }
    revealAround(s, i, s.L.roof[i] === ROOF.OPEN ? SIGHT.surface : SIGHT.roofed);
  }
}
/** D > 1 sight from voxel i: its level, the stair-linked levels, and floors seen down through open air. */
export function sight3(s, i) {
  const lip = [];
  let n = revealAround(s, i, coverAt(s, i) === 0 ? SIGHT.surface : SIGHT.roofed, false, lip);
  for (const j of linksOf(s, i)) n += revealAround(s, j, SIGHT3.stair);
  const seen = new Set();
  for (const j of lip) {
    const f = fallTarget(s, j);
    if (f === j || seen.has(f)) continue;
    seen.add(f);
    n += revealAround(s, f, 1);
  }
  if (n) discoverBand(s, i);
  return n;
}

// ---- Discoveries by band (2.7, D > 1) ---------------------------------------------------------------------
/** The band of voxel i is met: write its discovery once (`discovery` { kind, i }). Returns the kind or null. */
export function discoverBand(s, i) {
  if (D === 1) return null;
  const b = bandOfRel(((i / PLANE) | 0) - zS);
  if (!b.disc) return null;
  const known = worldRec(s).disc;
  if (known && known.includes(b.disc)) return null;
  const w = ensureWorld(s);
  if (!w.disc) w.disc = [];
  if (w.disc.includes(b.disc)) return null;
  w.disc.push(b.disc); w.disc.sort();
  emit(s, 'discovery', { kind: b.disc, i });
  return b.disc;
}
let minedHooked = false;
/** D > 1: a mined voxel makes the voxels above and below known too (its 6 faces) and meets its band. */
function minedFaces(s, i) {
  if (D === 1) return;
  if (i + PLANE < N) knowFace(s, i + PLANE);
  if (i >= PLANE) knowFace(s, i - PLANE);
  discoverBand(s, i);
}
function knowFace(s, j) {
  if (getBit(s.L.known, j)) return;
  if (s.L.terrain[j] === TER.ROCK) knowRock(s, j); else setKnown(s, j, true);
}
export const isExplored = (s, i) => getBit(s.L.fog, i) === 1;

export function installFog() {
  if (!minedHooked) { minedHooked = true; onMined((s, i) => minedFaces(s, i)); }
  if (tickSystems().some((x) => x.slot === 'movement' && x.name === 'fog')) return;
  registerSystem('movement', 'fog', fogSystem, 50);
}
