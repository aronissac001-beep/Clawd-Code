// Hollow blight and its cleansing (owner B; doc 3.1, 9.3, 9.7; tuning WORLD.blight; Stage 2).
//
//   L.blight (0-255, saved) marks grey Hollow-blight. Blighted tiles (>= 1) are infertile (canSow,
//   plants.js), cost room beauty (rooms.js), darken mood nearby (F reads blightNear) and, as an unlit
//   patch of WORLD.blight.huskPatch (30)+ tiles, can raise Husks at night (H reads huskSites).
//   Generation (Stage 2 maps, mapgen.js): seedBlight lays patches over about startPct (6%) of the map's
//   open land, each at least startMin tiles, none within nearSite tiles of the Hearth.
//   blightSystem (tick slot 'blight') runs once a day at midnight:
//     - cleansing: a blighted tile lit at level >= lit (2) at midnight (lit through the night, so
//       lit all day: daylight covers the rest) or inside a Waystone's claim disc loses cleansePerDay;
//     - spread: in Ashfall (edgeSeason) the Grey Edge creeps in: land tiles on the map border catch
//       blight, and every fully blighted tile (255) may blight one 4-neighbour (a hash of tile and
//       day decides which, and whether: 1 in 4), so patches creep about spreadPerDay tiles a day
//       toward the hold unless they are lit or claimed; outside Ashfall patches hold still.
//   Both are pure functions of the saved state and the day (no RNG stream), so saves continue
//   identically. Writes go through terrain.setBlight (render patches).

import { W, H, N, TER, TER_WATER, TER_PASSABLE } from '../core/grid.js';
import { TICKS_PER_DAY, dayOf, seasonOf } from '../core/time.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { WORLD } from '../../data/worldgen.js';
import { ensureWorld, worldStage2, hash3 } from './worldrec.js';
import { structDef } from './defs.js';

export const BLIGHT = WORLD.blight;
let setBlightFn = null;
/** terrain.js hands its setBlight over (avoids an import cycle). */
export function bindBlightTerrain(fn) { setBlightFn = fn; }

const land = (t) => TER_PASSABLE[t] === 1 && !TER_WATER[t] && t !== TER.ROCK && t !== TER.RUBBLE;
export const blighted = (s, i) => s.L.blight[i] > 0;
/** Number of blighted tiles within Chebyshev r of tile i (F's "Blight nearby" thought). */
export function blightNear(s, i, r = 3) {
  const x = i % W, y = (i / W) | 0;
  let n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) if (s.L.blight[yy * W + xx]) n++;
  return n;
}
export function blightCount(s) { let n = 0; for (let i = 0; i < N; i++) if (s.L.blight[i]) n++; return n; }

/** Waystone discs [cx, cy, r] (claim sources whose def is a waystone). */
function waystoneDiscs(s) {
  const out = [];
  for (const b of s.bld) {
    if (!b || b.st !== 'done' || b.def !== 'waystone') continue;
    const d = structDef(b.def);
    out.push([b.x, b.y, (d && d.claimR) | 0]);
  }
  return out;
}

/**
 * Patches of blight that could raise a Husk now: 4-connected blighted (>= 64) open tiles, at least
 * huskPatch of them, none lit (rt.light 0). Returns [{ i: first tile, n }] in index order.
 */
export function huskSites(s) {
  const seen = new Uint8Array(N), out = [], q = [];
  const L = s.L, light = s.rt.light;
  for (let st = 0; st < N; st++) {
    if (seen[st] || L.blight[st] < 64 || !land(L.terrain[st])) continue;
    q.length = 0; q.push(st); seen[st] = 1;
    let lit = false;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % W, y = (c / W) | 0;
      if (light && light[c] > 0) lit = true;
      const nb = [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < H - 1 ? c + W : -1];
      for (const j of nb) if (j >= 0 && !seen[j] && L.blight[j] >= 64 && land(L.terrain[j])) { seen[j] = 1; q.push(j); }
    }
    if (!lit && q.length >= BLIGHT.huskPatch) out.push({ i: st, n: q.length });
  }
  return out;
}

/** H's blight surge (9.7): one creep step out of season (every full tile may spread). Returns tiles blighted. */
export function blightSurge(s) { return creep(s, dayOf(s.tick), s.rt.light, (i, v) => (setBlightFn ? setBlightFn(s, i, v) : (s.L.blight[i] = v))); }
function creep(s, day, light, set) {
  const L = s.L, full = [];
  let spread = 0;
  for (let i = 0; i < N; i++) if (L.blight[i] === 255) full.push(i);
  for (const i of full) {
    const h = hash3(i, day, 0xb1);
    if (h % 4 !== 0) continue;
    const d = (h >>> 2) & 3, x = i % W, y = (i / W) | 0;
    const nx = x + [0, 1, 0, -1][d], ny = y + [-1, 0, 1, 0][d];
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = ny * W + nx;
    if (L.blight[j] || !land(L.terrain[j]) || (light && light[j] >= BLIGHT.lit)) continue;
    set(j, 255); spread++;
  }
  return spread;
}

/** The daily step (also exported for tests). Returns { cleansed, spread }. */
export function blightDay(s) {
  const L = s.L, day = dayOf(s.tick), light = s.rt.light;
  const discs = waystoneDiscs(s);
  let cleansed = 0, spread = 0;
  const set = (i, v) => { if (setBlightFn) setBlightFn(s, i, v); else L.blight[i] = v; };
  // cleansing first (light and Waystones), in index order
  for (let i = 0; i < N; i++) {
    const v = L.blight[i];
    if (!v) continue;
    let clean = light && light[i] >= BLIGHT.lit;
    if (!clean) {
      const x = i % W, y = (i / W) | 0;
      for (const [cx, cy, r] of discs) if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) { clean = true; break; }
    }
    if (clean) { set(i, Math.max(0, v - BLIGHT.cleansePerDay)); cleansed++; }
  }
  if (seasonOf(s.tick) === BLIGHT.edgeSeason) {
    // the Grey Edge: border land catches blight (1 tile in 8 a day)
    for (let x = 0; x < W; x++) for (const y of [0, H - 1]) edgeCatch(s, y * W + x, day, set);
    for (let y = 1; y < H - 1; y++) for (const x of [0, W - 1]) edgeCatch(s, y * W + x, day, set);
    // full tiles creep: decided from the full tiles before this step
    spread += creep(s, day, light, set);
  }
  return { cleansed, spread };
}
function edgeCatch(s, i, day, set) {
  if (s.L.blight[i] || !land(s.L.terrain[i])) return;
  if (hash3(i, day, 0xed) % 8 === 0) set(i, 255);
}

/** Tick system (slot 'blight'): the daily step at midnight. */
export function blightSystem(s) {
  if (!worldStage2() || s.tick % TICKS_PER_DAY !== 0) return;
  const w = ensureWorld(s), day = dayOf(s.tick);
  if (w.blightDay === day) return;
  w.blightDay = day;
  blightDay(s);
}

/**
 * Generation (Stage 2 maps): blight patches over about startPct of the open land, each at least
 * startMin tiles (grown by a seeded flood from a centre), none within nearSite of (hx, hy).
 * Writes L.blight directly (before initRuntime). `rand()` is mapgen's seeded generator.
 * @returns {number} blighted tiles
 */
export function seedBlight(L, hx, hy, rand) {
  let landN = 0;
  for (let i = 0; i < N; i++) if (land(L.terrain[i])) landN++;
  const want = Math.floor((landN * BLIGHT.startPct) / 100);
  let done = 0;
  for (let tries = 0; tries < 80 && done < want; tries++) {
    const cx = Math.floor(rand() * W), cy = Math.floor(rand() * H), c = cy * W + cx;
    if (!land(L.terrain[c]) || L.blight[c] || Math.max(Math.abs(cx - hx), Math.abs(cy - hy)) < BLIGHT.nearSite) continue;
    const size = BLIGHT.startMin + Math.floor(rand() * BLIGHT.startMin * 2);
    const patch = [c];
    L.blight[c] = 255;
    for (let h = 0; h < patch.length && patch.length < size; h++) {
      const p = patch[h], x = p % W, y = (p / W) | 0;
      for (let d = 0; d < 4 && patch.length < size; d++) {
        const nx = x + [0, 1, 0, -1][d], ny = y + [-1, 0, 1, 0][d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (L.blight[j] || !land(L.terrain[j]) || Math.max(Math.abs(nx - hx), Math.abs(ny - hy)) < BLIGHT.nearSite) continue;
        if (rand() < 0.3) continue;
        L.blight[j] = 160 + Math.floor(rand() * 96);
        patch.push(j);
      }
    }
    done += patch.length;
  }
  return done;
}

export function installBlight() {
  if (!tickSystems().some((x) => x.slot === 'blight' && x.name === 'blight')) registerSystem('blight', 'blight', blightSystem, 0);
}
