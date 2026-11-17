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

import { W, H, N, TER, ROOF, getBit, DX8, DY8 } from '../core/grid.js';
import { emit } from '../core/events.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { isOpaque } from './pass.js';
import { setExplored, setKnown } from './terrain.js';

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
export function revealAround(s, i, r, quiet = false) {
  bufs();
  const L = s.L, r2 = r * r, ox = i % W, oy = (i / W) | 0;
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
    const c = qbuf[h++], cx = c % W, cy = (c / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX8[d], ny = cy + DY8[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const dx = nx - ox, dy = ny - oy;
      if (dx * dx + dy * dy > r2) continue;
      const j = ny * W + nx;
      if (mark[j] === gen) continue;
      if (d >= 4 && isOpaque(s, cy * W + nx) && isOpaque(s, ny * W + cx)) continue; // no seeing through a diagonal gap
      mark[j] = gen;
      visit(j);
      if (isOpaque(s, j)) { know(j); continue; }
      qbuf[t++] = j;
    }
  }
  return fresh;
}

/** Make rock tiles within radius r of tile i known (prospecting, the Survey Table; Stage 2 callers). */
export function revealKnown(s, i, r) {
  const ox = i % W, oy = (i / W) | 0, r2 = r * r;
  let n = 0;
  for (let y = Math.max(0, oy - r); y <= Math.min(H - 1, oy + r); y++) for (let x = Math.max(0, ox - r); x <= Math.min(W - 1, ox + r); x++) {
    if ((x - ox) * (x - ox) + (y - oy) * (y - oy) > r2) continue;
    const j = y * W + x;
    if (s.L.terrain[j] === TER.ROCK && !getBit(s.L.known, j)) { knowRock(s, j); n++; }
  }
  return n;
}

const tileOf = (e) => {
  const x = Math.min(W - 1, Math.max(0, Math.floor(e.x / 32))), y = Math.min(H - 1, Math.max(0, Math.floor(e.y / 32)));
  return y * W + x;
};
/** The fog system: every SIGHT.every ticks, each colonist reveals its sight radius. */
export function fogSystem(s) {
  if (s.tick % SIGHT.every !== 0) return;
  for (const c of s.col) {
    if (!c) continue;
    const i = tileOf(c);
    revealAround(s, i, s.L.roof[i] === ROOF.OPEN ? SIGHT.surface : SIGHT.roofed);
  }
}
export const isExplored = (s, i) => getBit(s.L.fog, i) === 1;

export function installFog() {
  if (tickSystems().some((x) => x.slot === 'movement' && x.name === 'fog')) return;
  registerSystem('movement', 'fog', fogSystem, 50);
}
