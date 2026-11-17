// The light map (owner B; doc 3.3, 12.3, 12.4, 13.3). rt.light (Uint8 0-3) is the single source of
// light for the sim and the renderer: a flood from every light source, blocked by walls, closed
// doors and rock, combined with daylight. rt.lit (Uint8 0/1) marks tiles at level >= LIT_MIN for
// combat (the Hollow take more damage in light, 9.5).
//   Sources: finished buildings whose def has `light: { lvl, r }` (the Hearth, sconces, braziers,
//   campfires), and lumenite ore in a wall (glow through rock comes in Stage 3). Level at octile
//   distance d (tenths of a tile) from a source of level lvl and radius r: ceil(lvl * (10r + 10 - d)
//   / (10r + 10)), for d <= 10r. The flood moves 8-way but never cuts the corner of an opaque tile,
//   so light never crosses a 1-tile rock wall.
//   Daylight: open-sky tiles take DAY[phase] (day 3, dawn and dusk 1, night 0); it spills under
//   roofs, losing one level per tile (a tunnel mouth is lit, the tunnel beyond it is dark).
//   Opaque tiles hold 0 (the renderer lights a wall's faces from its open neighbours, 12.4).
// Updates: the endOfTick 'light' pass recomputes the whole map when rt.dirty.light is set (by the
// terrain API on walls, doors, rock, roofs and light buildings, and by lightPhaseSystem on day-phase
// ticks). A full rebuild is about 0.2 ms at 128 x 128, under the 0.5 ms budget, and exact (C13).

import { W, H, N, ROOF, TER, DX8, DY8 } from '../core/grid.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick, registerSystem, tickSystems } from '../core/bus.js';
import { phaseOf } from '../core/time.js';
import { isOpaque, occRebuild } from './pass.js';
import { structDef, depositId } from './defs.js';

export const LIGHT_MAX = 3;
export const LIT_MIN = 2;
export const DAY = Object.freeze({ day: 3, dawn: 1, dusk: 1, night: 0 });

/** Light def of a building ({ lvl, r } or null): only finished buildings shine. */
export function lightOf(s, b) {
  if (!b || b.st !== 'done') return null;
  const d = structDef(b.def);
  if (!d || !d.light) return null;
  return d.light;
}

let opq = null, best = null, qa = null, qb = null, seen = null, gen = 0;
function bufs() {
  if (!opq || opq.length !== N) { opq = new Uint8Array(N); best = new Uint16Array(N); qa = new Int32Array(N); qb = new Int32Array(N); seen = new Uint32Array(N); gen = 0; }
}

/** Light map from scratch (a pure function of saved state and s.tick). */
export function lightRebuild(s, occ = s.rt.occ) {
  bufs();
  const L = s.L, out = new Uint8Array(N);
  for (let i = 0; i < N; i++) opq[i] = isOpaque(s, i, occ) ? 1 : 0;
  // daylight: open sky, then spill under roofs by BFS levels
  const sky = DAY[phaseOf(s.tick)] || 0;
  if (sky > 0) {
    let na = 0;
    for (let i = 0; i < N; i++) if (!opq[i] && L.roof[i] === ROOF.OPEN) { out[i] = sky; qa[na++] = i; }
    for (let lv = sky - 1; lv > 0 && na; lv--) {
      let nb = 0;
      for (let k = 0; k < na; k++) {
        const c = qa[k], cx = c % W, cy = (c / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (opq[j] || out[j] >= lv) continue;
          out[j] = lv; qb[nb++] = j;
        }
      }
      const t = qa; qa = qb; qb = t; na = nb;
    }
  }
  // sources, in building id order (then lumenite tiles in index order)
  for (const b of s.bld) {
    const l = lightOf(s, b);
    if (!l) continue;
    const d = structDef(b.def), w = d.size ? d.size[(b.rot | 0) & 1] : 1, h = d.size ? d.size[((b.rot | 0) & 1) ^ 1] : 1;
    floodFrom(s, out, b.x + (w >> 1), b.y + (h >> 1), l.lvl | 0, l.r | 0, occ);
  }
  const lum = depositId('lumenite');
  if (lum) for (let i = 0; i < N; i++) if (L.ore[i] === lum && L.terrain[i] === TER.ROCK) glowRock(out, i);
  return out;
}

/** Octile Dijkstra (bucket queue) from (x, y) over non-opaque tiles, max level `lvl`, radius r. */
function floodFrom(s, out, x, y, lvl, r, occ) {
  if (lvl <= 0 || r < 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  const src = y * W + x, R10 = 10 * r, D = R10 + 10;
  if (++gen >= 0xffffffff) { seen.fill(0); gen = 1; }
  // buckets by distance (0..R10): small, allocated per call (r <= 12 in data)
  const buckets = Array.from({ length: R10 + 1 }, () => []);
  best[src] = 0; seen[src] = gen; buckets[0].push(src);
  // a source inside an opaque footprint (the Hearth body) still shines out of it
  for (let dist = 0; dist <= R10; dist++) {
    const bk = buckets[dist];
    for (let k = 0; k < bk.length; k++) {
      const c = bk[k];
      if (best[c] !== dist) continue;
      const lv = Math.ceil((lvl * (D - dist)) / D);
      if (lv > out[c] && !opq[c]) out[c] = lv;
      const cx = c % W, cy = (c / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (opq[j] && j !== src) continue;
        if (d >= 4 && (opq[cy * W + nx] || opq[ny * W + cx])) continue; // no corner cutting
        const nd = dist + (d < 4 ? 10 : 14);
        if (nd > R10) continue;
        if (seen[j] === gen && best[j] <= nd) continue;
        seen[j] = gen; best[j] = nd; buckets[nd].push(j);
      }
    }
  }
}
/** Lumenite in a wall lights its open neighbours to level 1 (Stage 3 adds glow through 3 tiles of rock). */
function glowRock(out, i) {
  const x = i % W, y = (i / W) | 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (!opq[j] && out[j] < 1) out[j] = 1;
  }
}

export function litRebuild(s, light = lightRebuild(s)) {
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) a[i] = light[i] >= LIT_MIN ? 1 : 0;
  return a;
}

/** The endOfTick 'light' pass. */
export function lightPass(s) {
  const rt = s.rt;
  rt.light = lightRebuild(s);
  const lit = rt.lit instanceof Uint8Array && rt.lit.length === N ? rt.lit : new Uint8Array(N);
  for (let i = 0; i < N; i++) lit[i] = rt.light[i] >= LIT_MIN ? 1 : 0;
  rt.lit = lit;
}

/** Sets the light flag on the first tick of every day phase (dawn, day, dusk, night). */
export function lightPhaseSystem(s) {
  if (s.tick > 0 && phaseOf(s.tick) !== phaseOf(s.tick - 1)) s.rt.dirty.light = true;
}

export function installLight() {
  registerRebuild('light', (s) => lightRebuild(s, occRebuild(s)));
  registerRebuild('lit', (s) => litRebuild(s, lightRebuild(s, occRebuild(s))));
  registerEndOfTick('light', (s) => lightPass(s));
  if (!tickSystems().some((x) => x.slot === 'movement' && x.name === 'light-phase')) registerSystem('movement', 'light-phase', lightPhaseSystem, 60);
}
