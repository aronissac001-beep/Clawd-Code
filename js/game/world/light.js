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
//
// Levels (Stage Z1 E4; EMBERCROWN-FORTRESS.md 2.6, 6.2). At D > 1:
//   - per-level flood: the same 8-way kernel on one plane at base z * PLANE (sources on their own level:
//     buildings by b.z, flames, lumenite faces, ember pools from the fluid layer: light 2, radius 3).
//   - sky light: a voxel is sky-lit when z >= skyZ of its column (vertical.js); from there daylight spills
//     one level per tile under ceilings, as the roof spill does at D = 1. A shaft lights its bottom by day.
//   - between levels: after the planar floods one vertical pass carries light through stair pairs, ramp
//     pairs and open air (a voxel at z +- 1 linked to a lit voxel gets its planar light - 1; one level only).
//   - dirty levels: the pass relights only the levels the tick's writes touched (pass.addDirtyLevels: z, or
//     z +- 1 for vertical connectivity, plus a moved sky line), the levels whose light sources changed (a
//     per-level source signature kept on the light array, lightAux(rt.light).sig, compared each pass: fuel, flames,
//     buildings), and one level from the day-phase queue; each relit plane also refreshes the final light of
//     its neighbours. An ordinary mine relights 1 level, a channel 3.
//   - day-phase relight is spread: when the sky value (DAY[phase] capped by the weather) changes, every
//     sky-exposed level (z >= the lowest skyZ) is queued top-down in s.colony.world.lightQ = { sky, q: [[z,
//     shown]] } (saved state: a load mid-sequence continues exactly) and relit one level per tick. A level
//     still in q is lit with its `shown` sky, every other level with `sky`, so lightRebuild(s) of the saved
//     state always equals the live map (C13).

import { W, H, N, ROOF, TER, DX8, DY8 } from '../core/grid.js';
import { registerRebuild } from '../core/rtcontract.js';
import { registerEndOfTick, registerSystem, tickSystems } from '../core/bus.js';
import { phaseOf } from '../core/time.js';
import { isOpaque, occRebuild, addDirtyLevels, emberVoxels } from './pass.js';
import { D, PLANE, TER_UP, TER_DOWN, TER_OPAQUE } from '../core/grid.js';
import { skyZRebuild } from './vertical.js';
import { ensureWorld } from './worldrec.js';
import { FLUID } from '../../data/levels.js';
import { structDef, depositId, hearthLevelOf } from './defs.js';
import { isBurning } from './fuel.js';
import { worldRec } from './worldrec.js';
import { skyCap } from './weather.js';
import { WORLD } from '../../data/worldgen.js';

export const LIGHT_MAX = 3;
export const LIT_MIN = 2;
export const DAY = Object.freeze({ day: 3, dawn: 1, dusk: 1, night: 0 });

/**
 * Light def of a building ({ lvl, r } or null): only finished buildings shine, and from Stage 1b
 * only while they have fuel (fuel.js: a cold Hearth or an empty brazier gives no light). The Hearth
 * shines with its level's light (hearthLevel rows, 8.4).
 */
export function lightOf(s, b) {
  if (!b || b.st !== 'done') return null;
  const d = structDef(b.def);
  if (!d || !d.light) return null;
  if (!isBurning(s, b)) return null;
  if (b.def === 'hearth' && s.colony && s.colony.hearth && s.colony.hearth.id === b.id) {
    const lv = hearthLevelOf(s.colony.hearth.lvl | 0);
    if (lv && lv.light) return lv.light;
  }
  return d.light;
}

let opq = null, best = null, qa = null, qb = null, seen = null, gen = 0;
function bufs() {
  if (!opq || opq.length !== N) { opq = new Uint8Array(N); best = new Uint16Array(N); qa = new Int32Array(N); qb = new Int32Array(N); seen = new Uint32Array(N); gen = 0; }
}

/** Light map from scratch (a pure function of saved state and s.tick). */
export function lightRebuild(s, occ = s.rt.occ) {
  if (D > 1) return lightRebuild3(s, occ);
  bufs();
  const L = s.L, out = new Uint8Array(N);
  for (let i = 0; i < N; i++) opq[i] = isOpaque(s, i, occ) ? 1 : 0;
  // daylight: open sky, then spill under roofs by BFS levels
  // Stage 2: overcast skies (rain, snow) cap daylight (weather.skyCap; 3 when clear or before Stage 2)
  const sky = Math.min(DAY[phaseOf(s.tick)] || 0, skyCap(s));
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
  // flames (fire.js, Stage 2) shine like a small campfire, in tile order
  const FL = WORLD.fire.light;
  for (const e of worldRec(s).fire) floodFrom(s, out, e[0] % W, (e[0] / W) | 0, FL.lvl, FL.r, occ);
  const lum = depositId('lumenite');
  if (lum) for (let i = 0; i < N; i++) if (L.ore[i] === lum && L.terrain[i] === TER.ROCK) glowRock(out, i);
  return out;
}

/** Octile Dijkstra (bucket queue) from (x, y) on the level at `base` over non-opaque tiles, max level `lvl`, radius r. */
function floodFrom(s, out, x, y, lvl, r, occ, base = 0) {
  if (lvl <= 0 || r < 0 || x < 0 || y < 0 || x >= W || y >= H) return;
  const src = base + y * W + x, R10 = 10 * r, D = R10 + 10;
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
      const cx = (c - base) % W, cy = ((c - base) / W) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX8[d], ny = cy + DY8[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = base + ny * W + nx;
        if (opq[j] && j !== src) continue;
        if (d >= 4 && (opq[base + cy * W + nx] || opq[base + ny * W + cx])) continue; // no corner cutting
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
  const base = i - (i % PLANE), x = i % W, y = ((i % PLANE) / W) | 0;
  for (let d = 0; d < 4; d++) {
    const nx = x + DX8[d], ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = base + ny * W + nx;
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
  if (D > 1) { lightPass3(s); return; }
  const rt = s.rt;
  rt.light = lightRebuild(s);
  const lit = rt.lit instanceof Uint8Array && rt.lit.length === N ? rt.lit : new Uint8Array(N);
  for (let i = 0; i < N; i++) lit[i] = rt.light[i] >= LIT_MIN ? 1 : 0;
  rt.lit = lit;
}

/** Sets the light flag on the first tick of every day phase (dawn, day, dusk, night); weather.js sets it when the sky changes. */
export function lightPhaseSystem(s) {
  if (D > 1) { lightQueueSystem(s); return; }
  if (s.tick > 0 && phaseOf(s.tick) !== phaseOf(s.tick - 1)) s.rt.dirty.light = true;
}

// ---- Levels (D > 1) ----------------------------------------------------------------------------------------
/** The sky value now: DAY[phase] capped by the weather. */
export const skyNow = (s) => Math.min(DAY[phaseOf(s.tick)] || 0, skyCap(s));
/** The saved relight record { sky, q } (null before the first fortress tick). */
export const lightQueue = (s) => (s.colony && s.colony.world && s.colony.world.lightQ) || null;
/** The sky value level z is lit with (a level still queued keeps the value it shows). */
export function skyOfLevel(s, z, rec = lightQueue(s)) {
  if (!rec) return skyNow(s);
  for (let k = 0; k < rec.q.length; k++) if (rec.q[k][0] === z) return rec.q[k][1];
  return rec.sky;
}

let opqStamp = null, passGen = 0;
function bufs3() {
  bufs();
  if (!opqStamp || opqStamp.length !== D) { opqStamp = new Uint32Array(D); passGen = 0; }
  if (++passGen >= 0xffffffff) { opqStamp.fill(0); passGen = 1; }
}
function levelOpq(s, z, occ) {
  if (opqStamp[z] === passGen) return;
  opqStamp[z] = passGen;
  const b0 = z * PLANE, b1 = b0 + PLANE, ter = s.L.terrain;
  for (let i = b0; i < b1; i++) opq[i] = TER_OPAQUE[ter[i]] === 1 ? 1 : occ[i] < 0 ? 0 : isOpaque(s, i, occ) ? 1 : 0;
}
/** Light sources by level: z -> [[kind, x, y, lvl, r]] (buildings by id, flames by tile), with a signature string. */
export function lightSources(s) {
  const by = Array.from({ length: D }, () => []);
  for (const b of s.bld) {
    const l = lightOf(s, b);
    if (!l) continue;
    const d = structDef(b.def), w = d.size ? d.size[(b.rot | 0) & 1] : 1, h = d.size ? d.size[((b.rot | 0) & 1) ^ 1] : 1;
    const z = Math.max(0, Math.min(D - 1, b.z | 0));
    by[z].push([0, b.x + (w >> 1), b.y + (h >> 1), l.lvl | 0, l.r | 0]);
  }
  const FLm = WORLD.fire.light;
  for (const e of worldRec(s).fire) { const z = (e[0] / PLANE) | 0; by[z].push([1, e[0] % W, ((e[0] % PLANE) / W) | 0, FLm.lvl, FLm.r]); }
  return by;
}
const sigOf = (list) => list.map((e) => e.join(',')).join(';');
/** Planar light of level z into `pl` (sky with its spill, sources, lumenite faces, ember pools). */
function planar(s, z, occ, skyZ, src, rec, pl, nz) {
  levelOpq(s, z, occ);
  const L = s.L, b0 = z * PLANE, b1 = b0 + PLANE;
  pl.fill(0, b0, b1);
  const sky = skyOfLevel(s, z, rec);
  if (sky > 0) {
    let na = 0;
    for (let c = 0; c < PLANE; c++) { const i = b0 + c; if (!opq[i] && z >= skyZ[c]) { pl[i] = sky; qa[na++] = i; } }
    for (let lv = sky - 1; lv > 0 && na; lv--) {
      let nb = 0;
      for (let k = 0; k < na; k++) {
        const c = qa[k] - b0, cx = c % W, cy = (c / W) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = b0 + ny * W + nx;
          if (opq[j] || pl[j] >= lv) continue;
          pl[j] = lv; qb[nb++] = j;
        }
      }
      const t = qa; qa = qb; qb = t; na = nb;
    }
  }
  for (const e of src[z]) floodFrom(s, pl, e[1], e[2], e[3], e[4], occ, b0);
  if (L.fluid) for (const i of emberVoxels(s)) if (i >= b0 && i < b1) floodFrom(s, pl, i % W, ((i % PLANE) / W) | 0, FLUID.emberLight.lvl, FLUID.emberLight.r, occ, b0);
  const lum = depositId('lumenite');
  if (lum) for (let i = b0; i < b1; i++) if (L.ore[i] === lum && L.terrain[i] === TER.ROCK) glowRock(pl, i);
  let n = 0;
  for (let i = b0; i < b1; i++) if (pl[i]) n++;
  nz[z] = n;
}
/** Terrain lets light pass between lo (level z) and hi = lo + PLANE: a stair or ramp pair, or open air above. */
const linkTer = (ter, lo, hi) => (TER_UP[ter[lo]] === 1 && TER_DOWN[ter[hi]] === 1) || ter[hi] === TER.AIR || ter[hi] === TER.RAMP_TOP;
/**
 * Final light of level z into out from the stored planar light `pl` of z and z +- 1: planar, plus planar - 1
 * from linked voxels one level up and down (neither voxel opaque). Opaque voxels hold 0, so only voxels with
 * planar light in the neighbour level can raise anything, and the opacity test runs only there.
 */
function finalLevel(s, z, out, pl, occ, nz) {
  const b0 = z * PLANE, b1 = b0 + PLANE, ter = s.L.terrain;
  out.set(pl.subarray(b0, b1), b0);
  if (z + 1 < D && nz[z + 1] > 0) {
    for (let i = b0; i < b1; i++) {
      const v = pl[i + PLANE] - 1;
      if (v <= out[i] || !linkTer(ter, i, i + PLANE) || isOpaque(s, i, occ)) continue;
      out[i] = v;
    }
  }
  if (z > 0 && nz[z - 1] > 0) {
    for (let i = b0; i < b1; i++) {
      const v = pl[i - PLANE] - 1;
      if (v <= out[i] || !linkTer(ter, i - PLANE, i) || isOpaque(s, i, occ)) continue;
      out[i] = v;
    }
  }
}
/** D > 1 light map from scratch (every level), with the planar light (rt.light.pl) and source signature (rt.light.sig) attached. */
export function lightRebuild3(s, occ = s.rt.occ) {
  bufs3();
  const out = new Uint8Array(N), pl = new Uint8Array(N), nz = new Int32Array(D), skyZ = skyZRebuild(s), src = lightSources(s), rec = lightQueue(s);
  for (let z = 0; z < D; z++) planar(s, z, occ, skyZ, src, rec, pl, nz);
  for (let z = 0; z < D; z++) finalLevel(s, z, out, pl, occ, nz);
  const fz = new Int32Array(D);
  for (let i = 0; i < N; i++) if (out[i]) fz[(i / PLANE) | 0]++;
  AUX.set(out, { pl, nz, fz, sig: src.map(sigOf) });
  return out;
}
/**
 * The planar light and the source signature of a light map (a side table keyed by the array, so the map stays
 * a plain Uint8Array: rtEqual compares its elements). A map without an entry (a copy) is rebuilt whole.
 */
const AUX = new WeakMap();
export const lightAux = (light) => AUX.get(light) || null;
/** The last light pass (tests and the bench): `dirty` the levels relit, `levels` every level whose final light was refreshed. */
export const lastRelit = { dirty: [], levels: [] };
/** The D > 1 endOfTick light pass: re-flood the dirty levels, then refresh their finals and their neighbours'. */
export function lightPass3(s) {
  const rt = s.rt, d = rt.dirty;
  const aux = rt.light instanceof Uint8Array && rt.light.length === N ? AUX.get(rt.light) : null;
  if (!aux || d.lightAll) { rt.light = lightRebuild3(s); relit(s, null); return; }
  bufs3();
  const skyZ = rt.skyZ && rt.skyZ.length === PLANE ? rt.skyZ : skyZRebuild(s);
  const levels = new Set();
  for (let k = 0; k < d.tiles.length; k++) addDirtyLevels(s, d.tiles[k], levels, skyZ);
  const src = lightSources(s), sig = src.map(sigOf), old = aux.sig;
  for (let z = 0; z < D; z++) if (sig[z] !== old[z]) levels.add(z);
  const rec = lightQueue(s);
  if (rec && rec.q.length) levels.add(rec.q.shift()[0]);
  const pl = aux.pl, nz = aux.nz, fz = aux.fz;
  const was = new Map();
  for (const z of levels) { was.set(z, nz[z]); planar(s, z, rt.occ, skyZ, src, rec, pl, nz); }
  const fin = new Set();
  for (const z of levels) {
    fin.add(z);
    // a neighbour's final light reads this level's planar light: only when it had or has some
    if (was.get(z) === 0 && nz[z] === 0) continue;
    if (z > 0) fin.add(z - 1); if (z + 1 < D) fin.add(z + 1);
  }
  const order = [...fin].sort((a, b) => a - b), lg = rt.light;
  if (!(rt.lit instanceof Uint8Array) || rt.lit.length !== N) rt.lit = new Uint8Array(N);
  const lt = rt.lit;
  for (const z of order) {
    const b0 = z * PLANE, b1 = b0 + PLANE;
    const dark = nz[z] === 0 && (z + 1 >= D || nz[z + 1] === 0) && (z === 0 || nz[z - 1] === 0);
    if (dark) { if (fz[z]) { lg.fill(0, b0, b1); lt.fill(0, b0, b1); fz[z] = 0; } continue; }
    finalLevel(s, z, lg, pl, rt.occ, nz);
    let n = 0;
    for (let i = b0; i < b1; i++) { const v = lg[i]; if (v) n++; lt[i] = v >= LIT_MIN ? 1 : 0; }
    fz[z] = n;
  }
  aux.sig = sig;
  lastRelit.levels = order; lastRelit.dirty = [...levels].sort((a, b) => a - b);
}
function relit(s, order, dirty = null) {
  const rt = s.rt;
  if (!(rt.lit instanceof Uint8Array) || rt.lit.length !== N) rt.lit = new Uint8Array(N);
  const zs = order || Array.from({ length: D }, (_, z) => z);
  const lt = rt.lit, lg = rt.light;
  for (const z of zs) for (let i = z * PLANE, e = i + PLANE; i < e; i++) lt[i] = lg[i] >= LIT_MIN ? 1 : 0;
  lastRelit.levels = order ? [...new Set(order)] : zs;
  lastRelit.dirty = dirty || zs;
}
/** The lowest z the sky reaches anywhere (sky-exposed levels are this and above). */
function lowestSky(s) {
  const sz = s.rt.skyZ && s.rt.skyZ.length === PLANE ? s.rt.skyZ : skyZRebuild(s);
  let m = D;
  for (let c = 0; c < PLANE; c++) if (sz[c] < m) m = sz[c];
  return m;
}
/** D > 1 (tick slot 'movement'): queue the sky-exposed levels top-down when the sky value changes; one relights per tick. */
export function lightQueueSystem(s) {
  const w = ensureWorld(s), cur = skyNow(s);
  if (!w.lightQ) { w.lightQ = { sky: cur, q: [] }; s.rt.dirty.light = true; s.rt.dirty.lightAll = true; return; }
  const rec = w.lightQ;
  if (rec.sky !== cur) {
    const have = new Set(rec.q.map((e) => e[0]));
    for (let z = D - 1, lo = lowestSky(s); z >= lo; z--) if (!have.has(z)) rec.q.push([z, rec.sky]);
    rec.q.sort((a, b) => b[0] - a[0]);
    rec.sky = cur;
  }
  if (rec.q.length) s.rt.dirty.light = true;
}

export function installLight() {
  registerRebuild('light', (s) => lightRebuild(s, occRebuild(s)));
  registerRebuild('lit', (s) => litRebuild(s, lightRebuild(s, occRebuild(s))));
  registerEndOfTick('light', (s) => lightPass(s));
  if (!tickSystems().some((x) => x.slot === 'movement' && x.name === 'light-phase')) registerSystem('movement', 'light-phase', lightPhaseSystem, 60);
}
