// The 3D world generator (owner B; EMBERCROWN-FORTRESS.md 2.2, Stage Z1 step E10). Seeded, deterministic and pure:
// every step draws from its own `gen3:<step>` stream, derived from the colony seed ALONE (never from a live RNG
// stream), so a native world regenerates bit-identically (the pristine fallback, 5.1) and the migration (5.4)
// generates the levels below a Stage 2 plane from the seed and its baseMask only. No Math.random, no inexact
// Math (check-mapgen.mjs): + - * / on integers and floats, the Bhaskara sinX and table lookups only.
//
// World: W x H x D voxels, the valley floor at zS (128 x 128 x 20, zS = 14). Steps (2.2):
//   1. the surface plane (the Stage 2 surface passes, ported: massif, river, lake, hills, soils, forests, berries,
//      the start site, ruins, the surface blight) and the heightmap: a massif column of planar depth d rises
//      ceil(d / 6) levels (1..5); auto ramps on one-level steps facing open ground (1 in 3)
//   2. column fill (bandFill, the E9 "basic band fill"): soil (loam, clay, sand under water) at -1 and -2 under the
//      valley, the wet-sand aquifer (fluid source) at -2 under the lowland, stone bands by level with +-1 wobble
//   3. the caverns: the Glowcap Hollows (-7 floor, -6 ledges), the Sunless Mere (-10 floor with its lake, -9 cliffs,
//      ledges and rock bridges), the Hollow Reach (-13, blighted); natural ramps, chasms, deep passages to the map
//      edge, pools, glowcaps and natural pillars (no open voxel under rock is more than 4 from support, 2.5)
//   4. ember pools on the ember layer (-12) and the springs (middle stone, and one high in the heights)
//   5. 3D ore and gem veins
//   6. the Old Crown vaults, the Hollow seeps, the Seal-stone and the Sleep (-14)
//   7. (step 1)
//   8. dormant content rows [kind, voxel, seed] for the pristine meta (dens, barrows, the Lamplost camp, lairs and
//      the generated beasts' seeds, passages, springs, crypts)
//   9. the guarantees (checkGuarantees); a failing step re-rolls only itself, at most GEN3.guarantee.rerolls times
//
//   generate3(s, opts)          writes s.L (13 layers, `fluid` included) and the generated buildings of a fresh
//                               createColony(seed, { d, zS }) state; returns the info (site, Hearth, loot, meta, stats)
//   generateWorld3(s, opts)     generate3 + the pristine world + the Hearth + initRuntime + loot + the opening reveal
//   regenerate3(header)         the regeneration fallback (registered with pristine.setRegenerator at import)
//   bandFill(L, baseMask, seed) step 2 alone (levels 0..zS-1); generateBelow(L, baseMask, seed, ctx) steps 2-6 and 8
//   baseMaskOf(...)             the W x H u8 mask (bits 0-2 height, bit 3 water, bit 4 massif) of 5.4
//   previewSurface(seed, opts)  step 1 alone (surfacePass with its re-rolls): the zS plane and a colour-index plane for
//                               the region card (EMBERCROWN-WORLD.md 3.7); equal to generate3's zS plane tile by tile
// GEN3 v2 (EMBERCROWN-WORLD.md 3.6, W2.3): opts.region (js/game/realm/region.js regionOpts) drives the massif side
// (n, e, s or w) and thickness, the heights, the river's entry and exit edges and width, the lakes, the sea band of a
// shore, the soils and aquifer, the stone provinces and ore weights, the ember layer, springs, blight, ruins, dens and
// beasts, and the biome's knob row (GEN3.biomes). Without opts.region the v1 path runs unchanged: same streams, same
// draws, same world (the legacy-hash rule, 12.1).
// No map-sized buffers at import (D1): everything is allocated per call.

import { W, H, D, N, PLANE, zS, TER, TER_BUILDABLE, TER_PASSABLE, TER_WATER, TER_FLOOR, idx, setMapSize, allocLayers } from '../core/grid.js';
import { rint, rnd, hashString } from '../core/rand.js';
import { newBuilding } from '../core/schema.js';
import { initRuntime } from '../core/state.js';
import { GEN, GEN3, WORLD, DATA as GEN_DATA } from '../../data/worldgen.js';
import { chamfer } from './pass.js';
import { stoneId, depositId, plantCode, structDef, sizeOf } from './defs.js';
import { installWorld } from './terrain.js';
import { revealAround } from './fog.js';
import { seedBlight } from './blight.js';
import { spawn as spawnItem } from '../work/items.js';
import { buildPristine, attachPristine, setRegenerator } from '../save/pristine.js';
import { WORLD_KIND } from '../save/codec.js';

/** The plane index of (x, y). */
const ix = (x, y) => y * W + x;

// ---- Small deterministic helpers -------------------------------------------------------------------
/** A private generator over one u32 seed (rand.js functions read r.rng.g). */
const gen = (seed) => ({ rng: { g: seed >>> 0 || 0x9e3779b9 } });
const ri = (R, a, b) => rint(R, 'g', a, b);
const rf = (R) => rnd(R, 'g');

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
/** Value noise in [0, 1) at (x, y) with lattice spacing `cell`. */
function vnoise(x, y, cell, seed) {
  const fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy);
  const u = smooth(fx - x0), v = smooth(fy - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** 3-octave fractal value noise in [0, 1). */
function fbm(x, y, cell, seed) {
  return (vnoise(x, y, cell, seed) * 4 + vnoise(x, y, cell / 2, seed ^ 0x51ed27) * 2 + vnoise(x, y, cell / 4, seed ^ 0x2b79f5)) / 7;
}
/**
 * Sine by Bhaskara's rational approximation (max error 0.0016). Only + - * / and % are used, which
 * IEEE 754 rounds exactly on every engine, so a seed makes the same map in V8 and JavaScriptCore
 * (Math.sin is not specified bit-exactly). Every other generation step is integer or exact too.
 */
function sinX(x) {
  const PI = 3.141592653589793;
  let t = x % (2 * PI);
  if (t < 0) t += 2 * PI;
  let sg = 1;
  if (t >= PI) { t -= PI; sg = -1; }
  const p = t * (PI - t);
  return (sg * 16 * p) / (5 * PI * PI - 4 * p);
}
/** 1-D smooth wave in [-1, 1] along t: two sines with seeded phases plus value noise. */
function wave(t, len, seed) {
  const p1 = hash2(1, 2, seed) * 6.283, p2 = hash2(3, 4, seed) * 6.283;
  const k = 6.283 / Math.max(16, len);
  return 0.45 * sinX(t * k * 1.3 + p1) + 0.3 * sinX(t * k * 3.1 + p2) + 0.5 * (vnoise(t, 0, Math.max(6, len / 8), seed) - 0.5);
}
/**
 * About the value at quantile q (0..1) of numbers in [0, 1): a 4,096-bin histogram, so O(n) and
 * exact-arithmetic (the threshold is a bin edge; the share it selects is within 1/4096 of q).
 */
function quantile(vals, q) {
  if (!vals.length) return 1;
  const B = 4096, hist = new Uint32Array(B);
  for (let k = 0; k < vals.length; k++) { const b = Math.floor(vals[k] * B); hist[b < 0 ? 0 : b >= B ? B - 1 : b]++; }
  const want = Math.floor(vals.length * q);
  let acc = 0;
  for (let b = 0; b < B; b++) { if (acc + hist[b] > want) return b / B; acc += hist[b]; }
  return 1;
}

// ---- Side frames -------------------------------------------------------------------------------------
// The massif lies along side `side`. In its frame, `a` is the distance from that map edge (0 at the
// edge, growing toward the open land) and `t` runs along the edge. A and T are the frame's sizes.
function frameOf(side) {
  if (side === 'e') return { A: W, T: H, xy: (a, t) => [W - 1 - a, t], at: (x, y) => [W - 1 - x, y] };
  if (side === 'w') return { A: W, T: H, xy: (a, t) => [a, t], at: (x, y) => [x, y] };
  if (side === 's') return { A: H, T: W, xy: (a, t) => [t, H - 1 - a], at: (x, y) => [H - 1 - y, x] };
  return { A: H, T: W, xy: (a, t) => [t, a], at: (x, y) => [y, x] }; // 'n'
}

// ---- Step 1: the massif and its guarantee -------------------------------------------------------------
function massifPass(L, fr, R, seed, sc, minThick) {
  const G = GEN.massif;
  const tp = RG ? RG.massif : G.thickPct;
  const mean = (ri(R, tp[0], tp[1]) * fr.A) / 100;
  const amp = (G.wavePct * Math.max(W, H)) / 100;
  const thick = new Float64Array(fr.T);
  for (let t = 0; t < fr.T; t++) thick[t] = Math.max(minThick, mean + amp * wave(t, fr.T, seed));
  const mask = new Uint8Array(PLANE);
  const rough = 2.5 * Math.max(0.5, sc);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [a, t] = fr.at(x, y);
    const e = thick[t] - a + rough * (fbm(x, y, 9 * Math.max(0.5, sc), seed ^ 0x6a09e667) - 0.5) * 2;
    // the guarantee floor is hard: noise never thins the massif below minThick
    if (e > 0 || a < minThick) mask[ix(x, y)] = 1;
  }
  return { mask, thick, mean };
}
function depthStats(depth, rock, under) {
  let max = 0, deep = 0;
  for (let i = 0; i < PLANE; i++) { if (!rock[i]) continue; const d = depth[i]; if (d > max) max = d; if (d >= under) deep++; }
  return { max, deep };
}

// ---- Step 7: the surface ---------------------------------------------------------------------------------
function riverPass(L, fr, thick, R, seed, sc) {
  const G = GEN.river;
  const off = ri(R, Math.round(G.offFace[0] * sc), Math.round(G.offFace[1] * sc));
  const w = ri(R, G.width[0], G.width[1]);
  const amp = G.wave * sc;
  const centre = new Float64Array(fr.T);
  for (let t = 0; t < fr.T; t++) centre[t] = Math.min(fr.A - 4, thick[t] + off + amp * wave(t, fr.T, seed ^ 0x3c6ef372));
  const nf = ri(R, G.fords[0], G.fords[1]), fords = [];
  for (let k = 0; k < nf; k++) {
    const base = Math.round(((k + 1) * fr.T) / (nf + 1));
    fords.push(Math.max(2, Math.min(fr.T - 3, base + ri(R, -Math.round(fr.T / 12), Math.round(fr.T / 12)))));
  }
  const fw = G.fordWidth >> 1;
  const isFord = (t) => fords.some((f) => Math.abs(t - f) <= fw);
  const river = new Uint8Array(PLANE);
  for (let t = 0; t < fr.T; t++) {
    const c = centre[t], ford = isFord(t);
    const a0 = Math.round(c - w / 2), a1 = a0 + w - 1;
    for (let a = a0 - 2; a <= a1 + 2; a++) {
      if (a < 0 || a >= fr.A) continue;
      const [x, y] = fr.xy(a, t), i = ix(x, y);
      if (L.terrain[i] === TER.ROCK) continue;
      if (a < a0 - 1 || a > a1 + 1) { if (L.terrain[i] === TER.GRASS) L.terrain[i] = TER.SAND; continue; }
      L.terrain[i] = ford || a < a0 || a > a1 ? TER.SHALLOW : TER.DEEP;
      river[i] = 1;
    }
  }
  return { river, centre, fords, off, w };
}
function lakePass(L, fr, centre, R, seed, sc) {
  const G = GEN.lake;
  const r = ri(R, Math.round(G.radius[0] * sc), Math.round(G.radius[1] * sc)) + 1;
  const t = ri(R, Math.round(fr.T * 0.2), Math.round(fr.T * 0.8));
  const amin = Math.round(centre[t] + 8 * sc + r), amax = fr.A - r - 3;
  if (amax <= amin) return null;
  const a = ri(R, amin, amax);
  const [cx, cy] = fr.xy(a, t);
  const rb = r * (0.6 + 0.4 * rf(R));
  for (let y = Math.max(0, cy - 3 * r); y <= Math.min(H - 1, cy + 3 * r); y++) {
    for (let x = Math.max(0, cx - 3 * r); x <= Math.min(W - 1, cx + 3 * r); x++) {
      const i = ix(x, y);
      if (L.terrain[i] !== TER.GRASS) continue;
      const [la, lt] = fr.at(x, y);
      const ea = (la - a) / r, et = (lt - t) / rb;
      const e = ea * ea + et * et + 0.5 * (vnoise(x, y, 4, seed ^ 0x1f83d9ab) - 0.5);
      if (e < 0.5) L.terrain[i] = TER.DEEP;
      else if (e < 1) L.terrain[i] = TER.SHALLOW;
      else if (e < 1.6 && vnoise(x, y, 3, seed ^ 0x5be0cd19) > 0.45) L.terrain[i] = TER.MARSH;
    }
  }
  return { x: cx, y: cy, r };
}
// ---- GEN3 v2 surface passes (EMBERCROWN-WORLD.md 1.3, 3.6): the sea band, the region river, rock outcrops, ravines ----
const OPP = Object.freeze({ n: 's', s: 'n', e: 'w', w: 'e' });
const edgeLen = (e) => (e === 'n' || e === 's' ? W : H);
const edgePoint = (e, p) => (e === 'n' ? [p, 0] : e === 's' ? [p, H - 1] : e === 'w' ? [0, p] : [W - 1, p]);
/** The edge ('n', 'e', 's', 'w') a border cell lies on, or '' (corners count for their row). */
const edgeOf = (x, y) => (y === 0 ? 'n' : y === H - 1 ? 's' : x === 0 ? 'w' : x === W - 1 ? 'e' : '');
/** The sea of a shore region along edge `side`: deep water, a shallow strip, then a beach of sand and salt marsh. */
function seaPass(L, side, R, seed, sc) {
  const S = GEN3.sea, fr = frameOf(side), base = ri(R, Math.round(S.deep[0] * sc), Math.round(S.deep[1] * sc));
  const sea = new Uint8Array(PLANE);
  for (let t = 0; t < fr.T; t++) {
    const d = Math.max(2, Math.round(base + 3 * sc * wave(t, fr.T, seed ^ 0x2545f491)));
    for (let a = 0; a < d + S.shallow + S.beach && a < fr.A; a++) {
      const [x, y] = fr.xy(a, t), i = ix(x, y);
      if (L.terrain[i] === TER.ROCK) continue;
      if (a < d + S.shallow) { L.terrain[i] = a < d ? TER.DEEP : TER.SHALLOW; sea[i] = 1; }
      else if (L.terrain[i] === TER.GRASS) L.terrain[i] = vnoise(x, y, 4, seed ^ 0x6c62272e) * 100 < RG.marshPct ? TER.MARSH : TER.SAND;
    }
  }
  return { sea, width: base };
}
/**
 * The river of a region (3.6): water enters on edge RG.river.in and leaves on RG.river.out, RG.river.cls sets the width.
 * Both ends on the side edges of the massif frame: the classic course along the face (as v1). Otherwise a wavy line
 * from end to end; where it crosses the massif it cuts a gorge (the channel only; the banks stay rock).
 * Without a river the course is still drawn (`centre`, for the lake and the hills) but nothing is written.
 */
function regionRiver(L, fr, thick, R, seed, sc, side) {
  const G = GEN.river, rvr = RG.river;
  const off = ri(R, Math.round(G.offFace[0] * sc), Math.round(G.offFace[1] * sc));
  const centre = new Float64Array(fr.T);
  for (let t = 0; t < fr.T; t++) centre[t] = Math.min(fr.A - 4, thick[t] + off);
  const river = new Uint8Array(PLANE);
  if (!rvr) return { river, centre, fords: [], off, w: 0, edges: [] };
  const w = GEN3.riverWidth[rvr.cls - 1], amp = G.wave * sc;
  const e0 = edgeOf(...fr.xy(fr.A >> 1, 0)), e1 = OPP[e0];   // the frame's side edges: t = 0 and t = T - 1
  const pts = [], classic = (rvr.in === e0 && rvr.out === e1) || (rvr.in === e1 && rvr.out === e0);
  if (classic) {
    for (let t = 0; t < fr.T; t++) {
      const c = Math.min(fr.A - 4, thick[t] + off + amp * wave(t, fr.T, seed ^ 0x3c6ef372));
      const [x, y] = fr.xy(c, t);
      pts.push(x, y);
    }
  } else {
    const end = (e) => {
      if (e === e0 || e === e1) { const t = e === e0 ? 0 : fr.T - 1; return fr.xy(Math.round(centre[t]), t); }
      const len = edgeLen(e);
      return edgePoint(e, ri(R, Math.round(len * 0.3), Math.round(len * 0.7)));
    };
    const [sx, sy] = end(rvr.in), [ex, ey] = end(rvr.out), dx = ex - sx, dy = ey - sy;
    const m = Math.max(Math.abs(dx), Math.abs(dy), 1), ns = 2 * m + 2, px = -dy / m, py = dx / m;
    for (let k = 0; k <= ns; k++) {
      const u = k / ns, wv = amp * wave(u * m, m, seed ^ 0x3c6ef372) * 4 * u * (1 - u);
      pts.push(sx + dx * u + px * wv, sy + dy * u + py * wv);
    }
  }
  const np = pts.length >> 1, best = new Float64Array(PLANE).fill(1e9), near = new Int32Array(PLANE).fill(-1);
  const r0 = w / 2, rr = r0 + 2, lo2 = r0 * r0, mid2 = (r0 + 1) * (r0 + 1), hi2 = rr * rr;
  for (let k = 0; k < np; k++) {
    const qx = pts[2 * k], qy = pts[2 * k + 1];
    for (let y = Math.max(0, Math.floor(qy - rr)); y <= Math.min(H - 1, Math.ceil(qy + rr)); y++) for (let x = Math.max(0, Math.floor(qx - rr)); x <= Math.min(W - 1, Math.ceil(qx + rr)); x++) {
      const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy), i = ix(x, y);
      if (d2 < best[i]) { best[i] = d2; near[i] = k; }
    }
  }
  // fords: G.fords crossings spread along the course, G.fordWidth tiles wide (samples are 1 tile apart on the classic
  // course and about half a tile on the line)
  const nf = ri(R, G.fords[0], G.fords[1]), fords = [], fordK = (G.fordWidth >> 1) * (classic ? 1 : 2);
  for (let k = 0; k < nf; k++) fords.push(Math.max(2, Math.min(np - 3, Math.round(((k + 1) * np) / (nf + 1)) + ri(R, -Math.round(np / 12), Math.round(np / 12)))));
  const isFord = (k) => fords.some((f) => Math.abs(k - f) <= fordK);
  for (let i = 0; i < PLANE; i++) {
    const d2 = best[i];
    if (d2 > hi2) continue;
    const t = L.terrain[i];
    if (t === TER.ROCK) { if (d2 <= lo2) { L.terrain[i] = isFord(near[i]) ? TER.SHALLOW : TER.DEEP; river[i] = 1; } continue; }
    if (d2 <= lo2) { L.terrain[i] = isFord(near[i]) ? TER.SHALLOW : TER.DEEP; river[i] = 1; }
    else if (d2 <= mid2) { if (t !== TER.DEEP) L.terrain[i] = TER.SHALLOW; river[i] = 1; }
    else if (t === TER.GRASS) L.terrain[i] = TER.SAND;
  }
  const edges = [];
  for (let i = 0; i < PLANE; i++) { if (!river[i]) continue; const e = edgeOf(i % W, (i / W) | 0); if (e && !edges.includes(e)) edges.push(e); }
  return { river, centre, fords, off, w, edges: edges.sort() };
}
/** Small rock outcrops on open grass (moor: "rock clusters up"); rock of height 1, mask 2 like the hills. */
function rockPass(L, R, seed, mask, count) {
  const G = GEN3.rocks, n = ri(R, count[0], count[1]);
  let made = 0;
  for (let t = 0; t < 300 && made < n; t++) {
    const r = ri(R, G.r[0], G.r[1]), cx = ri(R, r + 3, W - r - 4), cy = ri(R, r + 3, H - r - 4);
    let ok = true;
    for (let dy = -r - 2; dy <= r + 2 && ok; dy++) for (let dx = -r - 2; dx <= r + 2 && ok; dx++) if (L.terrain[ix(cx + dx, cy + dy)] !== TER.GRASS) ok = false;
    if (!ok) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + (hash2(cx + dx, cy + dy, seed ^ 0x9e3779b1) < 0.5 ? 1 : 0)) continue;
      const i = ix(cx + dx, cy + dy);
      L.terrain[i] = TER.ROCK; mask[i] = 2;
    }
    made++;
  }
  return made;
}
/**
 * Ravines (redscar): one-level channels cut in the open valley. The zS cells become AIR (RAMP_TOP at both ends); the
 * floor at zS - 1 is written by generate3 after the column fill (DIRT, RAMP under the ends). Returns { cells, ends, n }.
 */
function ravinePass(L, R, seed, sc, count) {
  const G = GEN3.ravine, n = ri(R, count[0], count[1]), cells = [], ends = [];
  const waterD = new Uint8Array(PLANE);
  for (let i = 0; i < PLANE; i++) waterD[i] = TER_WATER[L.terrain[i]] || L.terrain[i] === TER.MARSH || L.terrain[i] === TER.ROCK ? 0 : 255;
  chamfer(waterD, 0, 0, W - 1, H - 1, 255);
  const DX8 = [0, 1, 1, 1, 0, -1, -1, -1], DY8 = [-1, -1, 0, 1, 1, 1, 0, -1];
  let made = 0;
  for (let tries = 0; tries < 80 && made < n; tries++) {
    const len = Math.max(8, Math.round(ri(R, G.len[0], G.len[1]) * sc)), wd = ri(R, G.width[0], G.width[1]);
    let x = ri(R, 4, W - 5), y = ri(R, 4, H - 5), d = ri(R, 0, 7);
    if (waterD[ix(x, y)] < 4) continue;
    const seg = [];
    for (let k = 0; k < len; k++) {
      if (x < 3 || y < 3 || x > W - 4 || y > H - 4 || waterD[ix(x, y)] < 3) break;
      const i = ix(x, y), j = (d & 1) || d === 0 || d === 4 ? ix(x + 1, y) : ix(x, y + 1);
      if (L.terrain[i] !== TER.GRASS) break;
      seg.push(i);
      if (wd > 1 && L.terrain[j] === TER.GRASS && waterD[j] >= 3) seg.push(j);
      L.terrain[i] = TER.AIR; if (wd > 1 && L.terrain[j] === TER.GRASS && waterD[j] >= 3) L.terrain[j] = TER.AIR;
      const h = hash2(k, made, seed ^ 0x45d9f3b);
      if (h < 0.18) d = (d + 1) & 7; else if (h > 0.82) d = (d + 7) & 7;
      x += DX8[d]; y += DY8[d];
    }
    if (seg.length < len >> 1) { for (const i of seg) L.terrain[i] = TER.GRASS; continue; }
    const a = seg[0], b = seg[seg.length - 1];
    L.terrain[a] = TER.RAMP_TOP; L.terrain[b] = TER.RAMP_TOP; ends.push(a, b);
    cells.push(...seg);
    made++;
  }
  return { cells, ends, n: made };
}
function hillPass(L, fr, centre, R, seed, sc, mask, count = null) {
  const G = GEN.hills, cn = count || G.count;
  const n = ri(R, cn[0], cn[1]), out = [];
  const waterD = new Uint8Array(PLANE);
  for (let i = 0; i < PLANE; i++) waterD[i] = TER_WATER[L.terrain[i]] || L.terrain[i] === TER.MARSH ? 0 : 255;
  chamfer(waterD, 0, 0, W - 1, H - 1, 255);
  for (let k = 0; k < n; k++) {
    const r = ri(R, Math.round(G.radius[0] * sc), Math.round(G.radius[1] * sc)) + 2;
    for (let attempt = 0; attempt < 20; attempt++) {
      const t = ri(R, 0, fr.T - 1);
      const amin = Math.round(centre[t] + 6 * sc + r * 0.5), amax = fr.A - 1;
      if (amax <= amin) break;
      const a = ri(R, amin, amax);
      const [cx, cy] = fr.xy(a, t);
      if (waterD[ix(cx, cy)] < r * 0.6) continue;
      let made = 0;
      for (let y = Math.max(0, cy - 2 * r); y <= Math.min(H - 1, cy + 2 * r); y++) {
        for (let x = Math.max(0, cx - 2 * r); x <= Math.min(W - 1, cx + 2 * r); x++) {
          const i = ix(x, y);
          if (L.terrain[i] !== TER.GRASS || waterD[i] < 3) continue;
          // sqrt(d2) / r + noise < 1, without the square root (exact on every engine)
          const k2 = r * (1 - 0.7 * (fbm(x, y, 6, seed ^ (0x9b05688c + k)) - 0.5)), d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (k2 > 0 && d2 < k2 * k2) { L.terrain[i] = TER.ROCK; mask[i] = 2; made++; }
        }
      }
      if (made) { out.push({ x: cx, y: cy, r, tiles: made }); break; }
    }
  }
  return out;
}
function soilPass(L, R, seed, waterNear) {
  const open = [];
  for (let i = 0; i < PLANE; i++) if (L.terrain[i] === TER.GRASS) open.push(i);
  const nv = (i, cell, sd) => fbm(i % W, (i / W) | 0, cell, sd);
  const paint = (pct, cell, sd, ter) => {
    if (!open.length) return;
    const vals = open.map((i) => nv(i, cell, sd));
    const th = quantile(vals, 1 - pct / 100);
    for (let k = 0; k < open.length; k++) if (vals[k] >= th && L.terrain[open[k]] === TER.GRASS) L.terrain[open[k]] = ter;
  };
  // marsh near water first, then meadows, rich soil and dirt patches
  for (const i of open) if (waterNear[i] > 0 && waterNear[i] <= 3 && nv(i, 3, seed ^ 0x7137449) > 0.56) L.terrain[i] = TER.MARSH;
  if (RG && RG.sandPct) paint(RG.sandPct, 9, seed ^ 0x3a11, TER.SAND);
  paint(RG ? RG.meadowPct : GEN.meadowPct, 11, seed ^ 0x2f13, TER.MEADOW);
  paint(RG ? RG.richSoilPct : GEN.richPct, 5, seed ^ 0x8e1b, TER.RICH);
  paint(5, 6, seed ^ 0x4d6a, TER.DIRT);
  void R;
}
function forestPass(L, R, seed) {
  const open = [];
  for (let i = 0; i < PLANE; i++) { const t = L.terrain[i]; if (t === TER.GRASS || t === TER.MEADOW || t === TER.DIRT || t === TER.RICH) open.push(i); }
  if (!open.length) return 0;
  const vals = open.map((i) => fbm(i % W, (i / W) | 0, 14, seed ^ 0x510e527f));
  const th = quantile(vals, 1 - (RG ? RG.forestPct : GEN.forestPct) / 100);
  const oak = plantCode('oak'), pine = plantCode('pine');
  let trees = 0;
  for (let k = 0; k < open.length; k++) {
    const i = open[k], x = i % W, y = (i / W) | 0;
    const inForest = vals[k] >= th;
    const p = hash2(x, y, seed ^ 0x9b05);
    if (inForest ? p < 0.55 : p < 0.018) {
      const kind = (RG && RG.pines) || vnoise(x, y, 10, seed ^ 0x1f83) > 0.55 ? pine : oak;
      if (!kind) continue;
      L.plant[i] = kind;
      L.growth[i] = hash2(x, y, seed ^ 0x77) < 0.85 ? 255 : 110 + ri(R, 0, 140);
      trees++;
    }
  }
  return trees;
}

// ---- Step 9: the start site ---------------------------------------------------------------------------
/** Sliding-window minimum of `a` over size x size squares; out[y*W+x] = min over the square with top-left (x, y). */
// Berry bushes (Stage 1b; 3.2 step 7): GEN.berryClumps clumps of 3-7 bushes on meadow and grass,
// most already ripe. Skipped while plants.js has no 'berry' entry (it needs G's berries item).
const BERRY_SOIL = (t) => t === TER.MEADOW || t === TER.GRASS || t === TER.RICH;
function berryClump(L, R, cx, cy, n, code) {
  let put = 0;
  for (let k = 0; k < n * 4 && put < n; k++) {
    const x = cx + ri(R, -2, 2), y = cy + ri(R, -2, 2);
    if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
    const i = ix(x, y);
    if (L.plant[i] || !BERRY_SOIL(L.terrain[i])) continue;
    L.plant[i] = code; L.growth[i] = rf(R) < 0.7 ? 255 : 80 + ri(R, 0, 150); put++;
  }
  return put;
}
function berryPass(L, R, sc) {
  const code = plantCode('berry');
  if (!code) return 0;
  const [lo, hi] = GEN.berryClumps;
  const clumps = Math.max(1, Math.round(ri(R, lo, hi) * sc * sc));
  let bushes = 0;
  for (let c = 0, tries = 0; c < clumps && tries < 400; tries++) {
    const x = ri(R, 2, W - 3), y = ri(R, 2, H - 3);
    if (L.terrain[ix(x, y)] !== TER.MEADOW) continue;
    bushes += berryClump(L, R, x, y, ri(R, 3, 7), code);
    c++;
  }
  return bushes;
}

function windowMin(a, size) {
  const row = new Uint16Array(PLANE), out = new Uint16Array(PLANE).fill(65535);
  for (let y = 0; y < H; y++) for (let x = 0; x + size <= W; x++) {
    let m = 65535;
    for (let k = 0; k < size; k++) { const v = a[y * W + x + k]; if (v < m) m = v; }
    row[y * W + x] = m;
  }
  for (let x = 0; x + size <= W; x++) for (let y = 0; y + size <= H; y++) {
    let m = 65535;
    for (let k = 0; k < size; k++) { const v = row[(y + k) * W + x]; if (v < m) m = v; }
    out[y * W + x] = m;
  }
  return out;
}
function edgesReached(L, from, blocked) {
  const seen = new Uint8Array(PLANE), q = new Int32Array(PLANE);
  let h = 0, t = 0;
  const pass = (i) => TER_PASSABLE[L.terrain[i]] === 1 && !(blocked && blocked[i]);
  const starts = [];
  if (pass(from)) starts.push(from);
  else { const x = from % W, y = (from / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && pass(ix(xx, yy))) starts.push(ix(xx, yy)); } }
  for (const s0 of starts) if (!seen[s0]) { seen[s0] = 1; q[t++] = s0; }
  let n = 0, e = 0, so = 0, wst = 0;
  while (h < t) {
    const i = q[h++], x = i % W, y = (i / W) | 0;
    if (y === 0) n = 1; if (y === H - 1) so = 1; if (x === 0) wst = 1; if (x === W - 1) e = 1;
    if (x > 0 && !seen[i - 1] && pass(i - 1)) { seen[i - 1] = 1; q[t++] = i - 1; }
    if (x < W - 1 && !seen[i + 1] && pass(i + 1)) { seen[i + 1] = 1; q[t++] = i + 1; }
    if (y > 0 && !seen[i - W] && pass(i - W)) { seen[i - W] = 1; q[t++] = i - W; }
    if (y < H - 1 && !seen[i + W] && pass(i + W)) { seen[i + W] = 1; q[t++] = i + W; }
  }
  return { count: n + e + so + wst, n: !!n, e: !!e, s: !!so, w: !!wst };
}
function sitePass(L, fr, mask, river, R, sc) {
  const G = GEN.site;
  const size = Math.max(8, Math.min(G.size, Math.round(G.size * Math.max(sc, 0.5)), W - 4, H - 4));
  // distance maps (Chebyshev) to the massif face and to the river
  const toFace = new Uint8Array(PLANE), toRiver = new Uint8Array(PLANE), bad = new Uint16Array(PLANE);
  for (let i = 0; i < PLANE; i++) {
    toFace[i] = mask[i] === 1 && L.terrain[i] === TER.ROCK ? 0 : 255;
    toRiver[i] = river[i] ? 0 : 255;
    const t = L.terrain[i];
    bad[i] = TER_BUILDABLE[t] && t !== TER.ROCK ? 0 : 1;
  }
  chamfer(toFace, 0, 0, W - 1, H - 1, 255);
  chamfer(toRiver, 0, 0, W - 1, H - 1, 255);
  // summed-area table of unbuildable tiles
  const sat = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) sat[(y + 1) * (W + 1) + x + 1] = bad[y * W + x] + sat[y * (W + 1) + x + 1] + sat[(y + 1) * (W + 1) + x] - sat[y * (W + 1) + x];
  const badIn = (x0, y0) => sat[(y0 + size) * (W + 1) + x0 + size] - sat[y0 * (W + 1) + x0 + size] - sat[(y0 + size) * (W + 1) + x0] + sat[y0 * (W + 1) + x0];
  const faceMin = windowMin(toFace, size);
  const faceMax = G.faceMax + 1, riverMax = Math.round(G.riverMax * Math.max(sc, 0.5));
  const cands = [];
  for (let y0 = 1; y0 + size < H; y0++) for (let x0 = 1; x0 + size < W; x0++) {
    const k = y0 * W + x0, nb = badIn(x0, y0);
    if (nb > 0) continue;
    const fd = faceMin[k];
    if (fd > faceMax) continue;
    // the river is measured from the site centre (where the Hearth stands), not its nearest corner
    const rd = toRiver[(y0 + (size >> 1)) * W + x0 + (size >> 1)];
    const [, tMid] = fr.at(x0 + (size >> 1), y0 + (size >> 1));
    const lateral = Math.abs(tMid - fr.T / 2);
    const score = lateral * 4 + fd * 3 + (rd >= riverMax ? 400 + rd : 0); // 1 tile of slack: the Hearth centre is off the site centre by one
    cands.push([score, k]);
  }
  cands.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { size, cands, toFace, toRiver, riverMax };
}
// =====================================================================================================
// The 3D world (Stage Z1 E10)
// =====================================================================================================

/** The u32 seed of step `step`, attempt n, of world `seed`: a pure function of the seed (2.2, 5.4). */
const st = (seed, step, n = 0) => hashString(`gen3:${step}:${n}:${seed >>> 0}`);
const SUP_R = 4;                                              // STONE_SUPPORT (js/data/levels.js, 2.5)
const isVert = (t) => t >= TER.STAIR_U && t <= TER.RAMP_TOP;
const isSupT = (t) => t === TER.ROCK || t === TER.RUBBLE || (t >= TER.STAIR_U && t <= TER.RAMP);
const skyT = (t) => t === TER.VOID || t === TER.AIR || t === TER.RAMP_TOP;
const zOf = (rel) => zS + rel;
const FLW = Object.freeze({ EMBER: 8, SOURCE: 16 });          // pass.js FL bits (2.8)
const OFF4 = () => [-W, 1, W, -1];
const rowSeed = (kind, v, seed) => hashString(`gen3:row:${kind}:${v}:${seed >>> 0}`);
const chebC = (a, b) => Math.max(Math.abs((a % W) - (b % W)), Math.abs(((a / W) | 0) - ((b / W) | 0)));

let MATS = null;
function mats() {
  if (MATS) return MATS;
  const m = {};
  for (const n of ['sandstone', 'limestone', 'granite', 'slate', 'basalt', 'marble', 'duskstone', 'loam', 'clay', 'sand', 'emberrock', 'greystone', 'sealstone']) m[n] = stoneId(n);
  // stone id -> band name for the deposit table (the first row holding the stone wins: duskstone is underdeep)
  const band = new Map();
  for (const [name, row] of Object.entries(GEN3.stone)) for (const n of row.stones) if (!band.has(m[n])) band.set(m[n], name);
  m.band = band;
  m.noOre = new Set([m.loam, m.clay, m.sand, m.emberrock, m.greystone, m.sealstone]);
  MATS = m;
  return m;
}
/** The stone row name (GEN3.stone, or the region's table) holding relative level r. */
function stoneRowName(r) {
  for (const [name, row] of Object.entries(STONE())) if (r >= row.rel[0] && r <= row.rel[1]) return name;
  return r > 0 ? 'outer' : 'hollow';
}

// ---- GEN3 v2: the region inputs (EMBERCROWN-WORLD.md 3.6) ------------------------------------------------------------
// RG is the resolved opts.region of the world being generated, or null on the v1 path. generate3 and previewSurface set
// it for the length of one synchronous call and restore it after, so bandFill and generateBelow called on their own (the
// v3 -> v4 migration, the regeneration of a v1 world) always run the v1 path.
let RG = null;
const H3 = () => (RG ? RG.heights : GEN3.heights);
const STONE = () => (RG ? RG.stone : GEN3.stone);
const clampI = (v, a, b) => (v < a ? a : v > b ? b : v);
const intOr = (v, d) => (typeof v === 'number' && v === v ? Math.round(v) : d);
const pairOr = (v, d) => (Array.isArray(v) && v.length === 2 && v[0] <= v[1] ? [intOr(v[0], d[0]), intOr(v[1], d[1])] : d);
const scalePct = (k, pct) => Math.round((k * pct) / 100);
/** opts.region (a plain object, js/game/realm/region.js) -> the knobs the passes read; unknown or bad fields fall back to today's. */
export function resolveRegion(region) {
  const r = region || {}, B = GEN3.biomes[r.biome] || {}, sides = GEN.massif.regionSides;
  const side = sides.includes(r.side) ? r.side : 'n';
  const mp = clampI(intOr(r.massifPct, 30), GEN3.massifPct[0], GEN3.massifPct[1]);
  const heights = { ...GEN3.heights, max: clampI(intOr(r.heights, GEN3.heights.max), 2, GEN3.heights.max), perLevel: B.heightsPerLevel || GEN3.heights.perLevel };
  const rv = r.river;
  const river = rv && sides.includes(rv.in) && sides.includes(rv.out) && rv.in !== rv.out ? { in: rv.in, out: rv.out, cls: clampI(intOr(rv.cls, 1), 1, 3) } : null;
  const emberRel = r.ember && r.ember.rel === -11 ? -11 : -12;
  // the stone table: the province's swaps by band; a shallow ember layer (rel -11) trades places with the underdeep stone
  const stone = {};
  for (const [name, row] of Object.entries(GEN3.stone)) {
    const sw = r.stones && Array.isArray(r.stones[name]) && r.stones[name].length ? r.stones[name].slice(0, 2) : null;
    stone[name] = { ...row, stones: sw || row.stones };
  }
  if (emberRel === -11) { stone.underdeep = { ...stone.underdeep, rel: [-12, -12] }; stone.ember = { ...stone.ember, rel: [-11, -11] }; }
  const veinRel = {};
  if (emberRel === -11) for (const v of GEN3.veins) if (v.rel[0] === -11 && v.rel[1] === -11) veinRel[v.id] = [-12, -12];
  const ores = {};
  if (r.ores) for (const [k, v] of Object.entries(r.ores)) ores[k] = Math.max(100, intOr(v, 100));
  const rich = clampI(intOr(r.caverns, 1), 0, 2), richPct = [50, 100, 150][rich];
  const blight = clampI(intOr(r.blight, WORLD.blight.startPct), 0, 30);
  const soil = r.soil || {};
  const sea = B.sea && sides.includes(r.sea) && r.sea !== side ? r.sea : null;
  return {
    biome: GEN3.biomes[r.biome] ? r.biome : 'greenvale', side, massif: [clampI(mp - 3, GEN3.massifPct[0], GEN3.massifPct[1]), clampI(mp + 3, GEN3.massifPct[0], GEN3.massifPct[1])], massifPct: mp,
    heights, river, sea, lakes: clampI(intOr(B.lakes, 1) + (r.lake ? 1 : 0), 0, 3),
    aquiferPct: clampI(intOr(r.aquiferPct, GEN3.soil.aquiferNearPct), 0, 100),
    soil: { clay: clampI(intOr(soil.clay, GEN3.soil.topClayPct), 0, 90), sand: clampI(intOr(soil.sand, 0), 0, 90) },
    ember: { pools: pairOr(r.ember && r.ember.pools, GEN3.ember.pools), rel: emberRel }, springs: pairOr(r.springs, GEN3.springs.count), seeps: pairOr(r.seeps, GEN3.seeps),
    stone, veinRel, ores, blight, blightCalls: Math.round(blight / WORLD.blight.startPct),
    wildPct: 50 + ((clampI(intOr(r.wild, 85), 0, 255) * 150) / 255 | 0), richPct, glowPct: (6 * richPct) / 100,
    ruins: clampI(intOr(B.ruins, 3) + (Array.isArray(r.ruins) ? r.ruins.length : 0), 0, 8),
    relics: Array.isArray(r.relics) ? r.relics : [], lairs: Array.isArray(r.lairs) ? r.lairs : [],
    forestPct: intOr(B.forestPct, GEN.forestPct), meadowPct: intOr(B.meadowPct, GEN.meadowPct), richSoilPct: intOr(B.richPct, GEN.richPct),
    pines: !!B.pines, hills: B.hills || null, rocks: B.rocks || null, ravines: B.ravines || null, sandPct: intOr(B.sandPct, 0), marshPct: intOr(B.marshPct, 0),
    bandAt: null, bandNames: Object.keys(stone),
  };
}
function withRegion(region, fn) {
  const prev = RG;
  RG = region ? resolveRegion(region) : null;
  try { return fn(); } finally { RG = prev; }
}

// ---- Plane helpers ----------------------------------------------------------------------------------
/** Chebyshev distance (capped at 255) from every cell to the nearest set cell of `a`. */
function distTo(a) {
  const d = new Uint8Array(PLANE);
  for (let c = 0; c < PLANE; c++) d[c] = a[c] ? 0 : 255;
  chamfer(d, 0, 0, W - 1, H - 1, 255);
  return d;
}
/** Distance from each open cell of `a` to the nearest closed cell. */
function distIn(a) {
  const d = new Uint8Array(PLANE);
  for (let c = 0; c < PLANE; c++) d[c] = a[c] ? 255 : 0;
  chamfer(d, 0, 0, W - 1, H - 1, 255);
  return d;
}
/** 4-connected parts of the set cells: { lab (part id + 1 per cell), parts: [{ id, size, first }] by index of first cell }. */
function label(a) {
  const lab = new Int32Array(PLANE), q = new Int32Array(PLANE), parts = [];
  for (let s0 = 0; s0 < PLANE; s0++) {
    if (!a[s0] || lab[s0]) continue;
    const id = parts.length + 1;
    let h = 0, t = 0;
    q[t++] = s0; lab[s0] = id;
    while (h < t) {
      const c = q[h++], x = c % W;
      if (c >= W && a[c - W] && !lab[c - W]) { lab[c - W] = id; q[t++] = c - W; }
      if (c < PLANE - W && a[c + W] && !lab[c + W]) { lab[c + W] = id; q[t++] = c + W; }
      if (x > 0 && a[c - 1] && !lab[c - 1]) { lab[c - 1] = id; q[t++] = c - 1; }
      if (x < W - 1 && a[c + 1] && !lab[c + 1]) { lab[c + 1] = id; q[t++] = c + 1; }
    }
    parts.push({ id, size: t, first: s0 });
  }
  return { lab, parts };
}
/** Keep the `max` largest parts of at least `min` cells (ties by first cell). */
function keepParts(a, max, min) {
  const { lab, parts } = label(a);
  const keep = parts.filter((p) => p.size >= min).sort((p, q) => q.size - p.size || p.first - q.first).slice(0, max);
  const ok = new Uint8Array(parts.length + 1);
  for (const p of keep) ok[p.id] = 1;
  const out = new Uint8Array(PLANE);
  for (let c = 0; c < PLANE; c++) if (lab[c] && ok[lab[c]]) out[c] = 1;
  return out;
}
/** Set cells whose 8 neighbours are all set (the map edge counts as unset). */
function erode(a) {
  const e = new Uint8Array(PLANE);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const c = y * W + x;
    if (a[c] && a[c - 1] && a[c + 1] && a[c - W] && a[c + W] && a[c - W - 1] && a[c - W + 1] && a[c + W - 1] && a[c + W + 1]) e[c] = 1;
  }
  return e;
}
/**
 * Cellular-automata cave plane (2.2 step 3): a seeded fill of fillPct +- noisePct (large-scale value noise), then
 * GEN3.caverns.steps passes of the 3 x 3 majority rule (>= 5 of 9 open). Cells outside `mask` and within the
 * border stay closed.
 */
function caPlane(R, seed, fillPct, noisePct, mask) {
  const B = GEN3.caverns.border;
  let a = new Uint8Array(PLANE), b = new Uint8Array(PLANE);
  const inside = (x, y, c) => x >= B && y >= B && x < W - B && y < H - B && (!mask || mask[c]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x;
    if (!inside(x, y, c)) { rf(R); continue; }
    const p = fillPct + (vnoise(x, y, 24, seed) - 0.5) * 2 * noisePct;
    a[c] = rf(R) * 100 < p ? 1 : 0;
  }
  for (let k = 0; k < GEN3.caverns.steps; k++) {
    b.fill(0);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const c = y * W + x;
      if (!inside(x, y, c)) continue;
      const n = a[c - W - 1] + a[c - W] + a[c - W + 1] + a[c - 1] + a[c] + a[c + 1] + a[c + W - 1] + a[c + W] + a[c + W + 1];
      b[c] = n >= 5 ? 1 : 0;
    }
    const t = a; a = b; b = t;
  }
  return a;
}

// ---- Step 1: the surface plane and the heights ------------------------------------------------------------
/** Planar depth into the massif (rock cells), 0 elsewhere; the map edge counts as rock (R2 3.2). */
function depth2Of(rockPlane) {
  const d = new Uint8Array(PLANE);
  for (let c = 0; c < PLANE; c++) d[c] = rockPlane[c] ? 255 : 0;
  chamfer(d, 0, 0, W - 1, H - 1, 255);
  return d;
}
/** Levels a massif column of planar depth d rises above the valley floor (2.2, 5.4): ceil(d / 6) in 1..5. */
export function heightOf(d) {
  const G = H3(), top = Math.max(0, Math.min(G.max, D - 1 - zS));
  if (d <= 0) return 0;
  const h = ((d + G.perLevel - 1) / G.perLevel) | 0;
  return h < 1 ? 1 : h > top ? top : h;
}
/**
 * The W x H base mask (5.4): bits 0-2 the column height (heightOf the planar depth), bit 3 water (river, lake,
 * marsh, ford or ice), bit 4 massif. `massif` (u8 per column, 1 = massif) defaults to the plane's ROCK cells.
 */
export function baseMaskOf(terrainPlane, massif = null) {
  const rock = massif || Uint8Array.from(terrainPlane, (t) => (t === TER.ROCK ? 1 : 0));
  const d = depth2Of(rock), m = new Uint8Array(PLANE);
  for (let c = 0; c < PLANE; c++) {
    const t = terrainPlane[c];
    m[c] = (rock[c] ? heightOf(d[c]) | 16 : 0) | (TER_WATER[t] || t === TER.MARSH ? 8 : 0);
  }
  return { mask: m, depth2: d };
}
const landT = (t) => TER_PASSABLE[t] === 1 && !TER_WATER[t] && t !== TER.MARSH && t !== TER.ROCK;
/** Auto ramps (2.3): one-level steps whose slope faces open ground at the same level, 1 in GEN3.heights.rampIn. */
function rampPass(P, hgt, seed) {
  const out = [], off = OFF4(), lv = (c) => (hgt[c] ? zS + hgt[c] : zS);
  const land = (c) => hgt[c] > 0 || landT(P.terrain[c]);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const c = y * W + x;
    if (!land(c)) continue;
    const a = lv(c);
    if (a + 1 > D - 1 || hash2(x, y, seed) * H3().rampIn >= 1) continue;
    for (let k = 0; k < 4; k++) {
      const n = c + off[k], o = c - off[k];
      if (!hgt[n] || lv(n) !== a + 1 || !land(o) || lv(o) !== a) continue;
      out.push(c);
      if (a === zS) { P.terrain[c] = TER.RAMP; P.plant[c] = 0; P.growth[c] = 0; }
      break;
    }
  }
  return out;
}

/** The Stage 2 surface passes (mapgen.js steps 1, 7, 9 and the Stage 2 ruins and blight), ported onto one plane. */
function surfacePass(seed, n, opts = {}) {
  const P = {};
  for (const k of ['terrain', 'mat', 'ore', 'roof', 'plant', 'growth', 'blight']) P[k] = new Uint8Array(PLANE);
  const L = P;
  L.terrain.fill(TER.GRASS);
  const sc = Math.min(W, H) / 128;
  const G = GEN.massif;
  const rSide = gen(st(seed, 'side', n));
  const side = opts.side || (RG ? RG.side : G.sides[ri(rSide, 0, G.sides.length - 1)]);
  const fr = frameOf(side);
  const minThick = Math.max(4, Math.round(G.minThick * sc));
  const maxDepthMin = Math.round(G.maxDepthMin * sc), underMin = Math.round(G.underdeepMin * sc * sc), under = Math.round(G.underdeep * sc);
  // 1. massif with the planar guarantee (as Stage 2: re-roll only the mask)
  let m = null, rerolls = 0, depth = null, ds = null;
  const surfSeed = st(seed, 'surface', n);
  for (let k = 0; k <= G.rerolls; k++) {
    const sd = st(seed, `massif:${k}`, n);
    m = massifPass(L, fr, gen(sd), sd, sc, minThick + (k === G.rerolls ? 6 * sc : 0));
    for (let i = 0; i < PLANE; i++) L.terrain[i] = m.mask[i] ? TER.ROCK : TER.GRASS;
    depth = depth2Of(m.mask);
    ds = depthStats(depth, m.mask, under);
    if (ds.max >= maxDepthMin && ds.deep >= underMin) break;
    rerolls = k + 1;
  }
  const mask = m.mask;
  m.thick.forEach((v, t) => { m.thick[t] = Math.ceil(v); });
  // 7a. river and lake, then the hills
  let massifTiles = 0;
  for (let i = 0; i < PLANE; i++) if (mask[i] === 1) massifTiles++;
  const sea = RG && RG.sea ? seaPass(L, RG.sea, gen(st(seed, 'sea', n)), surfSeed, sc) : null;
  const rv = RG ? regionRiver(L, fr, m.thick, gen(st(seed, 'river', n)), surfSeed, sc, side) : riverPass(L, fr, m.thick, gen(st(seed, 'river', n)), surfSeed, sc);
  const lakes = [];
  if (!RG) { const lk = lakePass(L, fr, rv.centre, gen(st(seed, 'lake', n)), surfSeed, sc); if (lk) lakes.push(lk); }
  else for (let k = 0; k < RG.lakes; k++) { const lk = lakePass(L, fr, rv.centre, gen(st(seed, k ? `lake:${k}` : 'lake', n)), (surfSeed + k * 0x61c88647) >>> 0, sc); if (lk) lakes.push(lk); }
  const lake = lakes[0] || null;
  const hills = hillPass(L, fr, rv.centre, gen(st(seed, 'hills', n)), surfSeed, sc, mask, RG && RG.hills);
  const rocks = RG && RG.rocks ? rockPass(L, gen(st(seed, 'rocks', n)), surfSeed, mask, RG.rocks) : 0;
  const ravines = RG && RG.ravines ? ravinePass(L, gen(st(seed, 'ravines', n)), surfSeed, sc, RG.ravines) : null;
  // the heights and the auto ramps (before the soils, so the site and the forests see the ramps)
  let rockP = Uint8Array.from(L.terrain, (t) => (t === TER.ROCK ? 1 : 0));
  depth = depth2Of(rockP);
  let hgt = Uint8Array.from(depth, (d, c) => (rockP[c] ? heightOf(d) : 0));
  let ramps = rampPass(L, hgt, st(seed, 'ramps', n));
  // 7b. soils, marsh near water, forests and lone trees, berries
  const waterNear = new Uint8Array(PLANE);
  for (let i = 0; i < PLANE; i++) waterNear[i] = TER_WATER[L.terrain[i]] ? 0 : 255;
  chamfer(waterNear, 0, 0, W - 1, H - 1, 255);
  soilPass(L, null, surfSeed, waterNear);
  const trees = forestPass(L, gen(st(seed, 'forest', n)), surfSeed);
  const berries = berryPass(L, gen(st(seed, 'berries', n)), sc);
  // 9. the start site
  const rSite = gen(st(seed, 'site', n));
  const site = sitePass(L, fr, mask, rv.river, rSite, sc);
  const hearthDef = structDef('hearth');
  const [hw, hh] = sizeOf(hearthDef || { size: [3, 3] });
  let pick = null, edges = null, tried = 0;
  const needEdges = sea ? 2 : 3;   // a shore's sea edge is never reached on foot
  const foot = new Uint8Array(PLANE);
  for (const [, k] of site.cands) {
    if (tried++ > 60) break;
    const x0 = k % W, y0 = (k / W) | 0;
    const hx = x0 + ((site.size - hw) >> 1), hy = y0 + ((site.size - hh) >> 1);
    foot.fill(0);
    for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + hw; x++) foot[ix(x, y)] = 1;
    const e = edgesReached(L, ix(hx - 1, hy - 1), foot);
    if (e.count >= needEdges) { pick = { x0, y0, hx, hy }; edges = e; break; }
    if (!pick) pick = { x0, y0, hx, hy, weak: true }, edges = e;
  }
  let fixed = 0;
  if (!pick) {
    const [fx, fy] = fr.xy(Math.min(fr.A - site.size - 2, m.thick[fr.T >> 1] + 2), Math.max(1, (fr.T >> 1) - (site.size >> 1)));
    const x0 = Math.max(1, Math.min(W - site.size - 1, side === 'e' ? fx - site.size + 1 : fx));
    const y0 = Math.max(1, Math.min(H - site.size - 1, fy));
    for (let y = y0; y < y0 + site.size; y++) for (let x = x0; x < x0 + site.size; x++) {
      const i = ix(x, y);
      if (L.terrain[i] !== TER.GRASS) { L.terrain[i] = TER.GRASS; L.mat[i] = 0; L.ore[i] = 0; fixed++; }
    }
    pick = { x0, y0, hx: x0 + ((site.size - hw) >> 1), hy: y0 + ((site.size - hh) >> 1) };
    edges = edgesReached(L, ix(pick.hx - 1, pick.hy - 1), null);
  }
  if (edges.count < needEdges) {
    const tm = fr.T >> 1;
    for (let t = Math.max(0, tm - 2); t <= Math.min(fr.T - 1, tm + 2); t++) for (let a = 0; a < fr.A; a++) {
      const [x, y] = fr.xy(a, t), i = ix(x, y);
      if (L.terrain[i] === TER.DEEP && rv.river[i]) { L.terrain[i] = TER.SHALLOW; fixed++; }
    }
    edges = edgesReached(L, ix(pick.hx - 1, pick.hy - 1), null);
  }
  // clear plants near the Hearth, then >= 3 trees and a berry patch within 12 tiles of it
  const hcx = pick.hx + (hw >> 1), hcy = pick.hy + (hh >> 1);
  const clearR = GEN.site.clear + (hw >> 1);
  for (let y = hcy - clearR; y <= hcy + clearR; y++) for (let x = hcx - clearR; x <= hcx + clearR; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = ix(x, y); L.plant[i] = 0; L.growth[i] = 0;
  }
  const near = Math.round(GEN.site.near * Math.max(sc, 0.5));
  const countNear = (pred) => {
    let k = 0;
    for (let y = hcy - near; y <= hcy + near; y++) for (let x = hcx - near; x <= hcx + near; x++) if (x >= 0 && y >= 0 && x < W && y < H && pred(L.plant[ix(x, y)])) k++;
    return k;
  };
  const oak = plantCode('oak');
  let planted = 0;
  for (let guard = 0; countNear((p) => p && p <= 2) < GEN.site.trees && guard < 200; guard++) {
    const x = hcx + ri(rSite, -near, near), y = hcy + ri(rSite, -near, near);
    if (x < 0 || y < 0 || x >= W || y >= H || Math.max(Math.abs(x - hcx), Math.abs(y - hcy)) <= clearR) continue;
    const i = ix(x, y);
    if (L.plant[i] || !TER_BUILDABLE[L.terrain[i]] || L.terrain[i] === TER.ROCK) continue;
    L.plant[i] = oak; L.growth[i] = 255; planted++;
  }
  const berry = plantCode('berry');
  if (berry) {
    const rBerry = gen(st(seed, 'site:berries', n));
    for (let guard = 0; countNear((p) => p === berry) < 3 * GEN.site.berries && guard < 60; guard++) {
      const x = hcx + ri(rBerry, -near + 2, near - 2), y = hcy + ri(rBerry, -near + 2, near - 2);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || Math.max(Math.abs(x - hcx), Math.abs(y - hcy)) <= clearR + 2) continue;
      const i = ix(x, y);
      if (!TER_BUILDABLE[L.terrain[i]] || L.terrain[i] === TER.ROCK) continue;
      berryClump(L, rBerry, x, y, 4, berry);
    }
  }
  if (fixed) {
    rockP = Uint8Array.from(L.terrain, (t) => (t === TER.ROCK ? 1 : 0));
    depth = depth2Of(rockP);
    hgt = Uint8Array.from(depth, (d, c) => (rockP[c] ? heightOf(d) : 0));
    ramps = ramps.filter((c) => L.terrain[c] === TER.RAMP || hgt[c] > 0);
  }
  // Stage 2 surface ruins (broken watchtower rings far from the site) and the starting blight
  const ruins = [], loot = [], bld = [];
  const rr = gen(st(seed, 'ruins', n));
  const taken = new Uint8Array(PLANE);
  for (let tries = 0; tries < 200 && ruins.length < (RG ? RG.ruins : 3); tries++) {
    const cx = ri(rr, 4, W - 5), cy = ri(rr, 4, H - 5);
    if (Math.max(Math.abs(cx - hcx), Math.abs(cy - hcy)) < 26) continue;
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) {
      const i = ix(cx + dx, cy + dy);
      if (!TER_BUILDABLE[L.terrain[i]] || L.terrain[i] === TER.ROCK || TER_WATER[L.terrain[i]] || taken[i]) ok = false;
    }
    if (!ok) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      const i = ix(cx + dx, cy + dy);
      L.plant[i] = 0; L.growth[i] = 0;
      if (rf(rr) < 0.35) continue;
      taken[i] = 1;
      bld.push(['wall', cx + dx, cy + dy, 'granite', { hp: 120 + ri(rr, 0, 200), name: 'Ruined wall' }]);
    }
    loot.push(['block', 'granite', 10 + ri(rr, 0, 10), cx, cy, null], ['coins', null, 8 + ri(rr, 0, 12), cx + 1, cy, null]);
    ruins.push(ix(cx, cy));
  }
  const rb = gen(st(seed, 'blight', n));
  let blight = RG && !RG.blightCalls ? 0 : seedBlight(L, hcx, hcy, () => rf(rb));
  if (RG) for (let k = 1; k < RG.blightCalls; k++) blight += seedBlight(L, hcx, hcy, () => rf(rb));
  // the site's distance to the face (the guarantee: within GEN.site.faceMax tiles of ground)
  let faceMin = 255;
  for (let y = pick.y0; y < pick.y0 + site.size; y++) for (let x = pick.x0; x < pick.x0 + site.size; x++) {
    const v = site.toFace[ix(x, y)];
    if (v < faceMin) faceMin = v;
  }
  return {
    P, side, depth, hgt, ramps, rerolls, bld, loot, ruins, blight, fixed, trees, berries, planted, edges,
    site: { x0: pick.x0, y0: pick.y0, size: site.size, weak: !!pick.weak, faceMin },
    hearth: { x: pick.hx, y: pick.hy, cx: hcx, cy: hcy, w: hw, h: hh },
    lake: lake ? { x: lake.x, y: lake.y } : null, river: { fords: rv.fords.length, width: rv.w }, hills: hills.length,
    riverDist: site.toRiver[ix(hcx, hcy)], maxDepth: ds.max,
    ...(RG ? { lakes: lakes.length, rocks, ravines, massifTiles, sea: sea ? { side: RG.sea, width: sea.width } : null, riverEdges: rv.edges || [] } : {}),
  };
}
const siteOk = (sf) => !sf.fixed && sf.site.faceMin <= GEN.site.faceMax + 1;

/** Heights stone: outer stones near the face (planar depth <= faceOuter), granite and slate in the core (2.2). */
function heightStone(c, d, seed) {
  const M = mats(), x = c % W, y = (c / W) | 0, row = d <= H3().faceOuter ? STONE().outer : STONE().middle;
  return M[row.stones[fbm(x, y, 7, seed) * 100 > row.split ? 1 : 0]];
}
/** Write the surface plane at zS and the massif above it (rock up to zS + h - 1, a rough top at zS + h), with the ramps. */
function writeSurface(L, sf, seed) {
  const { P, hgt, depth } = sf, bS = zS * PLANE, sH = st(seed, 'heights');
  for (let c = 0; c < PLANE; c++) {
    const h = hgt[c];
    if (!h) {
      const i = bS + c;
      L.terrain[i] = P.terrain[c]; L.mat[i] = P.mat[c]; L.plant[i] = P.plant[c]; L.growth[i] = P.growth[c]; L.blight[i] = P.blight[c];
      continue;
    }
    const mt = heightStone(c, depth[c], sH);
    for (let z = zS; z < zS + h; z++) { L.terrain[z * PLANE + c] = TER.ROCK; L.mat[z * PLANE + c] = mt; }
    if (zS + h < D) { L.terrain[(zS + h) * PLANE + c] = TER.ROUGH; L.mat[(zS + h) * PLANE + c] = mt; }
  }
  for (const c of sf.ramps) {
    const a = hgt[c] ? zS + hgt[c] : zS;
    L.terrain[a * PLANE + c] = TER.RAMP; L.terrain[(a + 1) * PLANE + c] = TER.RAMP_TOP;
    L.plant[a * PLANE + c] = 0; L.growth[a * PLANE + c] = 0;
  }
}

// ---- Step 2: column fill (the basic band fill; E9 uses it alone) ----------------------------------------------
/** The aquifer columns (2.2, 2.8): water columns plus aquiferNearPct of the valley columns nearest them. */
function aquiferMask(baseMask) {
  const water = Uint8Array.from(baseMask, (m) => (m & 8 ? 1 : 0)), d = distTo(water), aq = new Uint8Array(PLANE);
  const hist = new Uint32Array(256);
  let valley = 0, any = 0;
  for (let c = 0; c < PLANE; c++) { if (water[c]) { any = 1; continue; } if (baseMask[c] & 16) continue; valley++; hist[d[c]]++; }
  if (!any || (RG && !RG.aquiferPct)) return aq;
  const want = Math.floor((valley * (RG ? RG.aquiferPct : GEN3.soil.aquiferNearPct)) / 100);
  let th = 0, acc = 0;
  for (let k = 1; k < 256; k++) { acc += hist[k]; th = k; if (acc >= want) break; }
  for (let c = 0; c < PLANE; c++) if (water[c] || (!(baseMask[c] & 16) && d[c] <= th)) aq[c] = 1;
  return aq;
}
/**
 * Step 2 (2.2): fill levels 0..zS-1 of every column. Under the valley: loam with clay pockets at -1 (sand under
 * water), clay and loam at -2 with the wet-sand aquifer (fluid source bit) under the lowland; under the massif
 * outer stone. Below: the stone bands of GEN3.stone by level, their edges wobbled by -1..+1 per column (2-D noise),
 * the ember layer, the Reach's duskstone and the Hollow's greystone. Every written voxel is ROCK with its mat; ore,
 * plants, blight and fluid are cleared. `levels` (a Set of z) limits the fill (a re-rolled cavern refills its own).
 * A pure function of (seed, baseMask): the migration (5.4) calls it with the save's mask.
 */
export function bandFill(L, baseMask, seed, levels = null) {
  const M = mats(), sW = st(seed, 'wobble'), sS = st(seed, 'stone'), sSoil = st(seed, 'soil');
  if (!L.fluid || L.fluid.length !== N) L.fluid = new Uint8Array(N);
  const wob = new Int8Array(PLANE), topV = new Float64Array(PLANE), subV = new Float64Array(PLANE), tv = [], sv = [];
  // per band: the stone id of each column (two-stone bands split by value noise), so the voxel loop only looks up
  const ST = STONE(), names = Object.keys(ST), pick = {};
  for (let k = 0; k < names.length; k++) {
    const row = ST[names[k]], a = new Uint8Array(PLANE).fill(M[row.stones[0]]);
    if (row.stones.length > 1) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (vnoise(x + k * 97, y + k * 61, 7, sS) * 100 > row.split) a[y * W + x] = M[row.stones[1]];
    pick[names[k]] = a;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = y * W + x, v = vnoise(x, y, 23, sW);
    wob[c] = v < 0.36 ? -1 : v > 0.64 ? 1 : 0;
    if (!(baseMask[c] & 16)) { topV[c] = vnoise(x, y, 6, sSoil); subV[c] = vnoise(x, y, 8, sSoil ^ 0x5bd1e995); tv.push(topV[c]); sv.push(subV[c]); }
  }
  const topTh = quantile(tv, 1 - (RG ? RG.soil.clay : GEN3.soil.topClayPct) / 100), subTh = quantile(sv, 1 - GEN3.soil.subClayPct / 100);
  const aq = aquiferMask(baseMask);
  const relName = new Map();
  for (let r = -40; r <= 0; r++) relName.set(r, stoneRowName(r));
  // GEN3 v2: the rel -1 sand share of the region's soil mix, a flat (unwobbled) shallow ember layer, and the stone row of
  // every voxel (the vein pass reads its band from there, since a province swap can put one stone in two bands)
  let sandV = null, sandTh = 2, wobLo = -11;
  if (RG) {
    if (RG.soil.sand) {
      sandV = new Float64Array(PLANE); const vs = [];
      for (let c = 0; c < PLANE; c++) if (!(baseMask[c] & 16)) { sandV[c] = vnoise(c % W, (c / W) | 0, 9, sSoil ^ 0x27d4eb2f); vs.push(sandV[c]); }
      sandTh = quantile(vs, 1 - RG.soil.sand / 100);
    }
    if (RG.ember.rel === -11) wobLo = -10;
    if (!RG.bandAt || RG.bandAt.length !== N) RG.bandAt = new Uint8Array(N);
  }
  const rowIx = RG ? Object.fromEntries(names.map((nm, k) => [nm, k])) : null;
  for (let z = 0; z < zS; z++) {
    if (levels && !levels.has(z)) continue;
    const rel = z - zS, base = z * PLANE;
    for (let c = 0; c < PLANE; c++) {
      const i = base + c, massif = (baseMask[c] & 16) !== 0;
      let mt, fl = 0;
      let rn = 'outer';
      if (rel >= -2 && massif) mt = pick.outer[c];
      else if (rel === -1) mt = baseMask[c] & 8 ? M.sand : sandV && sandV[c] >= sandTh ? M.sand : topV[c] >= topTh ? M.clay : M.loam;
      else if (rel === -2) { if (aq[c]) { mt = M.sand; fl = FLW.SOURCE; } else mt = subV[c] >= subTh ? M.clay : M.loam; }
      else {
        let r = rel;
        if (rel >= wobLo && rel <= -3) { r = rel + wob[c]; if (r > -3) r = -3; if (r < wobLo) r = wobLo; }
        rn = relName.get(r) || stoneRowName(r);
        mt = pick[rn][c];
      }
      if (rowIx) RG.bandAt[i] = rowIx[rn];
      L.terrain[i] = TER.ROCK; L.mat[i] = mt; L.ore[i] = 0; L.plant[i] = 0; L.growth[i] = 0; L.blight[i] = 0; L.fluid[i] = fl;
    }
  }
  return { aquifer: aq };
}

// ---- Step 3: the caverns ---------------------------------------------------------------------------------------
/** Natural pillars on level z (2.5): every open voxel under a solid ceiling ends within SUP_R of a support. */
function pillarsLevel(L, z, prot) {
  const base = z * PLANE, sup = new Uint8Array(PLANE), cov = new Uint8Array(PLANE);
  const ceil = z + 1 < D;
  for (let c = 0; c < PLANE; c++) sup[c] = isSupT(L.terrain[base + c]) ? 0 : 7;
  chamfer(sup, 0, 0, W - 1, H - 1, 7);
  for (let c = 0; c < PLANE; c++) cov[c] = sup[c] <= SUP_R ? 1 : 0;
  const need = (c) => {
    const t = L.terrain[base + c];
    return !cov[c] && TER_FLOOR[t] === 1 && !isSupT(t) && ceil && !skyT(L.terrain[base + PLANE + c]);
  };
  const plain = (c) => { const t = L.terrain[base + c]; return TER_FLOOR[t] === 1 && !isVert(t) && !prot[base + c]; };
  let n = 0, miss = 0;
  for (let c = 0; c < PLANE; c++) {
    if (!need(c)) continue;
    const x = c % W, y = (c / W) | 0;
    let p = -1;
    for (let d = SUP_R; d >= 0 && p < 0; d--) { const q = Math.min(H - 1, y + d) * W + Math.min(W - 1, x + d); if (plain(q)) p = q; }
    if (p < 0) { miss++; continue; }
    const i = base + p;
    L.terrain[i] = TER.ROCK; L.plant[i] = 0; L.growth[i] = 0; L.fluid[i] = 0; L.blight[i] = 0; n++;
    const px = p % W, py = (p / W) | 0;
    for (let yy = Math.max(0, py - SUP_R); yy <= Math.min(H - 1, py + SUP_R); yy++) for (let xx = Math.max(0, px - SUP_R); xx <= Math.min(W - 1, px + SUP_R); xx++) cov[yy * W + xx] = 1;
  }
  return { n, miss };
}
/** Open (non-rock) cells of level z and their 4-connected parts. */
function levelOpen(L, z) {
  const base = z * PLANE, a = new Uint8Array(PLANE);
  let n = 0;
  for (let c = 0; c < PLANE; c++) if (L.terrain[base + c] !== TER.ROCK && L.terrain[base + c] !== TER.VOID) { a[c] = 1; n++; }
  return { a, n, parts: label(a).parts.length };
}
/** Deep passages (2.10): 2-4 tunnels from the cavern floor at level z to the map edge; rows ['passage', edge voxel]. */
function passages(L, z, floorT, R, seed, prot, rows) {
  const base = z * PLANE, K = GEN3.caverns, k = ri(R, K.passages[0], K.passages[1]);
  const edges = ['n', 'e', 's', 'w'];
  for (let a = 3; a > 0; a--) { const b = ri(R, 0, a); const t = edges[a]; edges[a] = edges[b]; edges[b] = t; }
  const out = [];
  for (let e = 0; e < k; e++) {
    const side = edges[e], along = side === 'n' || side === 's' ? W : H, t = ri(R, 8, along - 9);
    const ex = side === 'w' ? 0 : side === 'e' ? W - 1 : t, ey = side === 'n' ? 0 : side === 's' ? H - 1 : t;
    let best = -1, bd = 1e9;
    for (let c = 0; c < PLANE; c++) {
      const tt = L.terrain[base + c];
      if (tt === TER.ROCK || !TER_FLOOR[tt] || isVert(tt) || L.fluid[base + c]) continue;
      const d = Math.abs((c % W) - ex) + Math.abs(((c / W) | 0) - ey);
      if (d < bd) { bd = d; best = c; }
    }
    if (best < 0) break;
    let x = ex, y = ey;
    const tx = best % W, ty = (best / W) | 0;
    for (let guard = 0; guard < W + H; guard++) {
      const i = base + y * W + x;
      if (L.terrain[i] !== TER.ROCK && !(x === ex && y === ey)) break;
      L.terrain[i] = floorT; L.ore[i] = 0; L.fluid[i] = 0; prot[i] = 1;
      if (x === tx && y === ty) break;
      if (Math.abs(tx - x) >= Math.abs(ty - y)) x += tx > x ? 1 : -1; else y += ty > y ? 1 : -1;
    }
    const v = base + ey * W + ex;
    rows.push(['passage', v, rowSeed('passage', v, seed)]);
    out.push(v);
  }
  return out;
}
/** Is (x, y) of level z a dry plain floor (dens, pools, rows)? */
const dryFloor = (L, i) => { const t = L.terrain[i]; return TER_FLOOR[t] === 1 && !isVert(t) && !L.fluid[i] && t !== TER.AIR; };

/**
 * A two-level cavern (Caverns I and II) or the one-level Reach. Floor: CA, the 3 largest parts kept; Mere: the lake
 * (fluid water, deep in the middle) with the air above it; ledge level: the hall air above the floor (the upper
 * CA masked by the floor's open area eroded by 1: chasms and overlooks), ledges (shelves over rock within
 * ledgeReach of that air), natural ramps joining them (every ledge part over 40 voxels gets one), rock bridges
 * over the Mere's narrows; deep passages; pools and glowcaps in the Hollows; natural pillars. Returns the stats.
 */
function cavern(L, seed, id, n, prot, rows) {
  const C = GEN3.caverns[id], K = GEN3.caverns, M = mats();
  const zf = zOf(C.floor), zl = C.ledge !== undefined ? zOf(C.ledge) : -1, bf = zf * PLANE, bl = zl * PLANE;
  const R = gen(st(seed, `cavern:${id}`, n)), s0 = st(seed, `cavern:${id}:noise`, n);
  const floorT = id === 'hollows' ? TER.MOSS : TER.ROUGH;
  // the floor: CA, the largest parts kept; the fill steps toward openPct (at most 4 tries, same stream)
  let F = null, fill = C.fill;
  for (let k = 0; k < 8; k++) {
    F = keepParts(caPlane(R, s0 + k, fill, C.noise, null), C.maxParts, K.minPart);
    let o = 0;
    for (let c = 0; c < PLANE; c++) o += F[c];
    const pct = (o * 100) / PLANE, mid = (C.openPct[0] + C.openPct[1]) / 2;
    if (pct >= C.openPct[0] && pct <= C.openPct[1]) break;
    fill += Math.max(-6, Math.min(6, Math.round((mid - pct) / 4))) || (pct < mid ? 1 : -1);
  }
  const dF = distIn(F);
  // the Mere: the lake on the floor's deepest cells (lakePct of the floor), deep water 2 in from its shore
  let lake = null, lakeN = 0;
  if (C.lakePct) {
    lake = new Uint8Array(PLANE);
    const hist = new Uint32Array(256);
    let fn = 0;
    for (let c = 0; c < PLANE; c++) if (F[c]) { hist[dF[c]]++; fn++; }
    const want = Math.floor((fn * C.lakePct) / 100);
    let th = 255, acc = 0;
    for (let k = 255; k >= 2; k--) { if (acc + hist[k] > want) break; acc += hist[k]; th = k; }
    for (let c = 0; c < PLANE; c++) if (F[c] && dF[c] >= th) { lake[c] = 1; lakeN++; }
    lake.th = th;
  }
  for (let c = 0; c < PLANE; c++) {
    if (!F[c]) continue;
    const i = bf + c;
    L.terrain[i] = floorT; L.ore[i] = 0;
    if (lake && lake[c]) L.fluid[i] = dF[c] >= lake.th + 2 ? 5 : 2;
  }
  const out = { id, zf, zl, ramps: 0, bigParts: 0, bigRamped: 0, bridges: 0, pools: 0, lake: lakeN, pillars: 0, ledge: 0, air: 0 };
  // Hollows pools (blindfish): 2-4 small pools well inside the floor
  if (C.pools) {
    const want = ri(R, C.pools[0], C.pools[1]), placed = [];
    for (let t = 0; t < 400 && placed.length < want; t++) {
      const c = ri(R, 0, PLANE - 1);
      if (!F[c] || dF[c] < 3 || placed.some((p) => chebC(p, c) < 12)) continue;
      for (const d of [0, -1, 1, -W, W]) { const i = bf + c + d; if (dryFloor(L, i)) { L.terrain[i] = TER.ROUGH; L.fluid[i] = 2; } }
      placed.push(c);
    }
    out.pools = placed.length;
  }
  if (zl >= 0) {
    // hall air: the upper CA masked by the floor eroded by 1 (so the air always has floor under it), plus the lake
    const A = caPlane(R, s0 ^ 0x2545f491, C.airFill, C.noise, null), E = erode(F);
    for (let c = 0; c < PLANE; c++) A[c] = (A[c] && E[c]) || (lake && lake[c]) ? 1 : 0;
    // ledges: shelves over rock within ledgeReach of the floor; parts that touch no floor (no ramp can reach them) stay rock
    const dF0 = distTo(F), L2 = caPlane(R, s0 ^ 0x6c8e9cf5, C.ledgeFill, C.noise, null);
    const LG0 = new Uint8Array(PLANE);
    for (let c = 0; c < PLANE; c++) if (!F[c] && L2[c] && dF0[c] <= C.ledgeReach) LG0[c] = 1;
    const LG = keepParts(LG0, 1 << 20, K.minPart);
    {
      // a part must touch the floor; at most ledgeBig parts over ledgePartRamp voxels stay (each gets a ramp)
      const { lab, parts } = label(LG), keep = new Uint8Array(parts.length + 1);
      for (let c = 0; c < PLANE; c++) if (LG[c] && dF0[c] === 1) keep[lab[c]] = 1;
      const big = parts.filter((p) => keep[p.id] && p.size > K.ledgePartRamp).sort((p, q) => q.size - p.size || p.first - q.first);
      for (const p of big.slice(K.ledgeBig)) keep[p.id] = 0;
      for (let c = 0; c < PLANE; c++) if (LG[c] && !keep[lab[c]]) LG[c] = 0;
    }
    const ledgeT = floorT;
    for (let c = 0; c < PLANE; c++) {
      const i = bl + c;
      if (A[c]) { L.terrain[i] = TER.AIR; L.ore[i] = 0; L.fluid[i] = 0; out.air++; }
      else if (LG[c]) { L.terrain[i] = ledgeT; L.ore[i] = 0; L.fluid[i] = 0; out.ledge++; }
    }
    // natural ramps: RAMP on a dry floor voxel next to the rock under a ledge, RAMP_TOP above it beside the ledge
    const { lab, parts } = label(LG), off = OFF4(), used = new Uint8Array(PLANE);
    const cands = parts.map(() => []);
    for (let c = 0; c < PLANE; c++) {
      if (!LG[c]) continue;
      for (let k = 0; k < 4; k++) {
        const x = c + off[k];
        if (x < 0 || x >= PLANE || (k === 1 && x % W === 0) || (k === 3 && c % W === 0)) continue;
        if (!F[x] || L.terrain[bf + x] !== floorT || L.fluid[bf + x] || LG[x]) continue;
        const up = L.terrain[bl + x];
        if (up !== TER.AIR && up !== TER.ROCK) continue;
        cands[lab[c] - 1].push(x);
      }
    }
    const put = (x) => {
      L.terrain[bf + x] = TER.RAMP; L.terrain[bl + x] = TER.RAMP_TOP; L.plant[bf + x] = 0; prot[bf + x] = 1; prot[bl + x] = 1;
      const px = x % W, py = (x / W) | 0;
      for (let yy = Math.max(0, py - 3); yy <= Math.min(H - 1, py + 3); yy++) for (let xx = Math.max(0, px - 3); xx <= Math.min(W - 1, px + 3); xx++) used[yy * W + xx] = 1;
      out.ramps++;
    };
    const tryPart = (pi) => {
      const cs = cands[pi].filter((x) => !used[x] && L.terrain[bf + x] === floorT);
      if (!cs.length) return false;
      put(cs[ri(R, 0, cs.length - 1)]);
      return true;
    };
    const order = parts.map((p, k) => k).sort((a, b) => parts[b].size - parts[a].size || parts[a].first - parts[b].first);
    for (const pi of order) if (parts[pi].size > K.ledgePartRamp) { out.bigParts++; if (tryPart(pi)) out.bigRamped++; }
    const target = ri(R, C.ramps[0], C.ramps[1]);
    for (let t = 0; t < 200 && out.ramps < target && order.length; t++) tryPart(order[ri(R, 0, order.length - 1)]);
    // the Mere's rock bridges: runs of air over the lake between two ledge voxels, short enough to hang from support
    if (lake && C.bridges) {
      const sup = new Uint8Array(PLANE);
      for (let c = 0; c < PLANE; c++) sup[c] = isSupT(L.terrain[bl + c]) ? 0 : 7;
      chamfer(sup, 0, 0, W - 1, H - 1, 7);
      const ledgeAt = (c) => LG[c] && L.terrain[bl + c] === ledgeT;
      const airLake = (c) => F[c] && !LG[c] && (L.terrain[bl + c] === TER.AIR || L.terrain[bl + c] === TER.ROCK);
      const runs = [];
      for (const [step, len, other] of [[1, W, H], [W, H, W]]) {
        for (let o = 1; o < other - 1; o++) for (let a = 1; a < len - 2; a++) {
          const c0 = step === 1 ? o * W + a : a * W + o;
          if (!ledgeAt(c0) || !airLake(c0 + step)) continue;
          let k = 1;
          while (a + k < len - 1 && airLake(c0 + k * step)) k++;
          const c1 = c0 + k * step, cells = [];
          for (let j = 1; j < k; j++) cells.push(c0 + j * step);
          const air = cells.filter((c) => L.terrain[bl + c] === TER.AIR).length;
          if (a + k < len - 1 && ledgeAt(c1) && cells.length >= 3 && cells.length <= C.bridgeMax && air * 2 >= cells.length && cells.every((c) => sup[c] <= SUP_R)) runs.push(cells);
        }
      }
      runs.sort((p, q) => p.length - q.length || p[0] - q[0]);
      const want = ri(R, C.bridges[0], C.bridges[1]), mids = [];
      for (const cells of runs) {
        if (out.bridges >= want) break;
        const mid = cells[cells.length >> 1];
        if (mids.some((m) => chebC(m, mid) < 10)) continue;
        for (const c of cells) { L.terrain[bl + c] = TER.ROUGH; L.mat[bl + c] = L.mat[bl + c] || M.basalt; prot[bl + c] = 1; }
        mids.push(mid); out.bridges++;
      }
    }
  }
  out.passages = passages(L, zf, floorT, R, seed, prot, rows).length;
  out.pillars = pillarsLevel(L, zf, prot).n + (zl >= 0 ? pillarsLevel(L, zl, prot).n : 0);
  if (id === 'hollows') {
    const glow = plantCode('glowcap');
    if (glow) for (const z of [zf, zl]) for (let c = 0; c < PLANE; c++) {
      const i = z * PLANE + c;
      if (L.terrain[i] === TER.MOSS && !prot[i] && rf(R) * 100 < (RG ? RG.glowPct : 6)) { L.plant[i] = glow; L.growth[i] = 128 + ri(R, 0, 127); }
    }
  }
  if (id === 'reach') for (let c = 0; c < PLANE; c++) if (L.terrain[bf + c] !== TER.ROCK) L.blight[bf + c] = 255;
  const lo = levelOpen(L, zf);
  out.open = lo.n; out.parts = lo.parts; out.openPct = Math.round((lo.n * 100) / PLANE);
  return out;
}
/** The 2.2 cavern guarantees for one cavern's stats: [] when it passes. */
function cavernFails(c) {
  const C = GEN3.caverns[c.id], f = [];
  if (c.open < C.minOpen) f.push(`${c.id}: ${c.open} open voxels < ${C.minOpen}`);
  if (c.parts > C.maxParts) f.push(`${c.id}: ${c.parts} parts > ${C.maxParts}`);
  if (c.zl >= 0 && c.ramps < 4) f.push(`${c.id}: ${c.ramps} natural ramps < 4`);
  if (c.zl >= 0 && c.bigRamped < c.bigParts) f.push(`${c.id}: ${c.bigParts - c.bigRamped} ledge parts over ${GEN3.caverns.ledgePartRamp} voxels without a ramp`);
  return f;
}

// ---- Step 4: ember pools and springs ----------------------------------------------------------------------------
/** Every voxel of the box (cx +- rx, cy +- ry) on levels z0..z1 is natural rock and unprotected. */
function rockBox(L, prot, cx, cy, rx, ry, z0, z1) {
  if (cx - rx < 1 || cy - ry < 1 || cx + rx > W - 2 || cy + ry > H - 2 || z0 < 0 || z1 >= D) return false;
  for (let z = z0; z <= z1; z++) for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
    const i = idx(x, y, z);
    if (L.terrain[i] !== TER.ROCK || prot[i]) return false;
  }
  return true;
}
function emberPools(L, seed, prot, rows) {
  const E = GEN3.ember, R = gen(st(seed, 'ember')), z = zOf(RG ? RG.ember.rel : -12), M = mats(), pools = RG ? RG.ember.pools : E.pools;
  if (z < 1) return 0;
  const want = ri(R, pools[0], pools[1]);
  let made = 0, biggest = -1, bigN = 0;
  for (let t = 0; t < 300 && made < want; t++) {
    const r = ri(R, E.r[0], E.r[1]), cx = ri(R, r + 2, W - r - 3), cy = ri(R, r + 2, H - r - 3);
    if (!rockBox(L, prot, cx, cy, r + 1, r + 1, z - 1, z + 1)) continue;
    let k = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 1) continue;
      const i = idx(cx + dx, cy + dy, z);
      L.terrain[i] = TER.ROUGH; L.mat[i] = M.emberrock; L.ore[i] = 0; L.fluid[i] = FLW.EMBER | FLW.SOURCE | E.depth; prot[i] = 1; k++;
    }
    if (k > bigN) { bigN = k; biggest = idx(cx, cy, z); }
    made++;
  }
  if (biggest >= 0) rows.push(['forge_site', biggest, rowSeed('forge_site', biggest, seed)]);
  return made;
}
function springs(L, seed, hgt, prot, rows) {
  const S = GEN3.springs, R = gen(st(seed, 'springs')), z = zOf(S.rel);
  const cnt = RG ? RG.springs : S.count, want = ri(R, cnt[0], cnt[1]), wet = FLW.SOURCE | S.depth;
  let made = 0;
  for (let t = 0; t < 300 && made < want; t++) {
    const cx = ri(R, 4, W - 5), cy = ri(R, 4, H - 5);
    if (!rockBox(L, prot, cx, cy, 3, 3, z - 1, z + 1)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const m = Math.abs(dx) + Math.abs(dy);
      if (m > 2) continue;
      const i = idx(cx + dx, cy + dy, z);
      L.terrain[i] = TER.MOSS; L.ore[i] = 0; L.fluid[i] = m <= 1 ? wet : 0; prot[i] = 1;
    }
    const v = idx(cx, cy, z);
    rows.push(['spring', v, rowSeed('spring', v, seed)]);
    made++;
  }
  // the high spring in the heights (a column three levels up or more)
  if (hgt && S.high) {
    const cols = [];
    for (let c = 0; c < PLANE; c++) if (hgt[c] >= 3) cols.push(c);
    for (let t = 0; t < 200 && cols.length; t++) {
      const c = cols[ri(R, 0, cols.length - 1)], cx = c % W, cy = (c / W) | 0, zh = zS + 1;
      if (!rockBox(L, prot, cx, cy, 2, 2, zh - 1, zh + 1)) continue;
      for (const d of [0, -1, 1, -W, W]) { const i = zh * PLANE + c + d; L.terrain[i] = TER.MOSS; L.ore[i] = 0; L.fluid[i] = wet; prot[i] = 1; }
      const v = zh * PLANE + c;
      rows.push(['spring', v, rowSeed('spring', v, seed)]);
      made++;
      break;
    }
  }
  return made;
}

// ---- Step 5: 3D veins ---------------------------------------------------------------------------------------------
/** Old depth (tiles into rock) -> band name, through GEN3.bandDepth (2.2 ore tables). */
const bandOfDepth = (d) => { for (const [hi, name] of GEN3.bandDepth) if (d <= hi) return name; return 'underdeep'; };
function veinRules(belowOnly) {
  const out = [];
  for (const d of GEN_DATA.deposit) {
    const bands = new Set();
    for (let k = d.depth[0]; k <= d.depth[1]; k++) bands.add(bandOfDepth(k));
    out.push({ id: d.id, ore: depositId(d.id), veins: d.veins, gem: false, bands, massif: !belowOnly, mlo: d.depth[0], mhi: Math.min(d.depth[1], 12) });
  }
  for (const v of GEN3.veins) out.push({ id: v.id, ore: depositId(v.id), veins: v.veins, gem: !!v.gem, rel: (RG && RG.veinRel[v.id]) || v.rel, massif: !!v.massif && !belowOnly, mlo: 1, mhi: 12 });
  return out.filter((r) => r.ore > 0);
}
function veinPass3(L, seed, n, depth2, baseMask, belowOnly) {
  const M = mats(), R = gen(st(seed, 'veins', n)), V = GEN3.vein, written = [], stats = {};
  const area = (W * H) / (128 * 128);
  for (const rule of veinRules(belowOnly)) {
    const ok = (i) => {
      if (L.terrain[i] !== TER.ROCK || L.ore[i] || M.noOre.has(L.mat[i])) return false;
      const z = (i / PLANE) | 0, c = i % PLANE;
      if (z >= zS) return rule.massif && (baseMask[c] & 16) !== 0 && depth2[c] >= rule.mlo && depth2[c] <= rule.mhi;
      if (rule.bands) return rule.bands.has(RG && RG.bandAt ? RG.bandNames[RG.bandAt[i]] : M.band.get(L.mat[i]));
      const rel = z - zS;
      return rel >= rule.rel[0] && rel <= rule.rel[1];
    };
    // levels a vein may start on
    const zs = [];
    for (let z = 0; z < D; z++) {
      if (z >= zS) { if (rule.massif) zs.push(z); continue; }
      const rel = z - zS;
      if (rule.rel ? rel >= rule.rel[0] && rel <= rule.rel[1] : rel <= -3) zs.push(z);
    }
    if (!zs.length) continue;
    const bandsN = rule.bands ? rule.bands.size + (rule.massif ? 1 : 0) : 1;
    let want = Math.max(1, Math.round(ri(R, rule.veins[0], rule.veins[1]) * bandsN * V.perBand * area));
    if (RG && RG.ores[rule.id]) want = Math.max(1, scalePct(want, RG.ores[rule.id]));
    let placed = 0, cells = 0;
    for (let v = 0; v < want; v++) {
      let cur = -1;
      for (let k = 0; k < V.tries; k++) {
        const z = zs[ri(R, 0, zs.length - 1)], i = z * PLANE + ri(R, 0, PLANE - 1);
        if (ok(i)) { cur = i; break; }
      }
      if (cur < 0) continue;
      const len = rule.gem ? ri(R, V.gem[0], V.gem[1]) : ri(R, V.len[0], V.len[1]);
      let got = 1;
      L.ore[cur] = rule.ore; written.push(cur);
      for (let step = 0; step < len * 4 && got < len; step++) {
        const x = cur % W, y = ((cur % PLANE) / W) | 0, z = (cur / PLANE) | 0;
        let nx = x, ny = y, nz = z;
        if (rf(R) * 100 < V.upPct) nz += rf(R) < 0.5 ? -1 : 1;
        else { const d = ri(R, 0, 3); nx += d === 1 ? 1 : d === 3 ? -1 : 0; ny += d === 2 ? 1 : d === 0 ? -1 : 0; }
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1 || nz < 0 || nz >= D) continue;
        const j = idx(nx, ny, nz);
        if (L.ore[j] === rule.ore) { cur = j; continue; }
        if (!ok(j)) continue;
        L.ore[j] = rule.ore; written.push(j); cur = j; got++;
      }
      cells += got; placed++;
    }
    stats[rule.id] = { veins: placed, voxels: cells };
  }
  return { written, stats };
}
/** The ore guarantees (2.2): coal and copper within 3 levels and 40 tiles of the start; iron above z 8. */
function oreFails(L, ctx) {
  const G = GEN3.guarantee, coal = depositId('coal'), copper = depositId('copper'), iron = depositId('iron');
  let hasCoal = false, hasCopper = false, hasIron = false;
  const zIron = Math.max(0, zS - 6);   // z 8 at zS = 14
  for (let z = Math.min(zIron + 1, Math.max(0, zS - G.oreNearLevels)); z < D; z++) {
    const base = z * PLANE, near = z <= zS + G.oreNearLevels;
    for (let c = 0; c < PLANE; c++) {
      const o = L.ore[base + c];
      if (!o) continue;
      if (o === iron && z > zIron) hasIron = true;
      if (!near || ctx.hx === undefined) continue;
      if (Math.max(Math.abs((c % W) - ctx.hx), Math.abs(((c / W) | 0) - ctx.hy)) > G.oreNearTiles) continue;
      if (o === coal) hasCoal = true; else if (o === copper) hasCopper = true;
    }
  }
  if (ctx.hx === undefined) hasCoal = hasCopper = true;
  const f = [];
  if (!hasCoal) f.push('no coal within 3 levels and 40 tiles of the start');
  if (!hasCopper) f.push('no copper within 3 levels and 40 tiles of the start');
  if (!hasIron) f.push(`no iron above z ${zIron}`);
  return f;
}

// ---- Step 6: vaults, seeps, the Seal and the Sleep ---------------------------------------------------------------
function vaults(L, seed, prot, rows, bld, loot) {
  const V = GEN3.vaults, R = gen(st(seed, 'vaults')), M = mats();
  const want = ri(R, V.count[0], V.count[1]), hx = V.size[0] >> 1, hy = V.size[1] >> 1;
  let made = 0;
  for (let t = 0; t < 300 && made < want; t++) {
    const z = zOf(V.rel[ri(R, 0, V.rel.length - 1)]), cx = ri(R, hx + 2, W - hx - 3), cy = ri(R, hy + 2, H - hy - 3);
    if (!rockBox(L, prot, cx, cy, hx + 1, hy + 1, z - 1, z + 1)) continue;
    for (let dy = -hy; dy <= hy; dy++) for (let dx = -hx; dx <= hx; dx++) {
      const i = idx(cx + dx, cy + dy, z);
      L.terrain[i] = TER.ROUGH; L.ore[i] = 0; L.mat[i] = M.marble; prot[i] = 1;
      if (Math.abs(dx) === hx || Math.abs(dy) === hy) bld.push(['wall', cx + dx, cy + dy, 'marble', { name: 'Old Crown wall' }, z]);
    }
    if (structDef('strongbox')) bld.push(['strongbox', cx, cy, null, { name: 'Sealed chest' }, z]);
    loot.push(['coins', null, 60, cx - 2, cy, null, z], ['cutgem', null, 2, cx + 2, cy, null, z], ['book', null, 1, cx, cy - 1, 'Old Crown tablet', z]);
    const v = idx(cx, cy, z);
    rows.push(['vault', v, rowSeed('vault', v, seed)]);
    made++;
  }
  return made;
}
/** The Sleep (a 5 x 5 vault on the Hollow level) under the Seal-stone (3 x 3, in its greystone lid); 2.2, 3.12. */
function sealSleep(L, seed, n, ctx, prot, rows) {
  const S = GEN3.seal, R = gen(st(seed, 'seal', n)), M = mats(), z0 = zOf(-14), z1 = zOf(-13);
  if (z0 < 0 || z1 < 0) return null;
  const site = ctx.site;
  for (let t = 0; t < 600; t++) {
    const cx = ri(R, 4, W - 5), cy = ri(R, 4, H - 5);
    if (ctx.hx !== undefined && Math.max(Math.abs(cx - ctx.hx), Math.abs(cy - ctx.hy)) < S.far) continue;
    if (site && cx + 3 >= site.x0 && cx - 3 < site.x0 + site.size && cy + 3 >= site.y0 && cy - 3 < site.y0 + site.size) continue;
    if (!rockBox(L, prot, cx, cy, 3, 3, z1, z1)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i0 = idx(cx + dx, cy + dy, z0), i1 = idx(cx + dx, cy + dy, z1), core = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
      L.terrain[i0] = TER.ROUGH; L.mat[i0] = M.greystone; L.ore[i0] = 0; prot[i0] = 1;
      L.terrain[i1] = TER.ROCK; L.mat[i1] = core ? M.sealstone : M.greystone; L.ore[i1] = 0; prot[i1] = 1;
    }
    const sleep = idx(cx, cy, z0), sealV = idx(cx, cy, z1);
    rows.push(['sleep', sleep, rowSeed('sleep', sleep, seed)], ['seal', sealV, rowSeed('seal', sealV, seed)]);
    for (const [k, dx, dy] of [['relic', -2, -2], ['relic', 2, -2], ['hoard', 0, 2]]) { const v = idx(cx + dx, cy + dy, z0); rows.push([k, v, rowSeed(k, v, seed)]); }
    return { x: cx, y: cy, sleep, seal: sealV };
  }
  return null;
}
function sealFails(seal, ctx) {
  if (!seal) return ['no place for the Seal'];
  const f = [];
  if (ctx.hx !== undefined && Math.max(Math.abs(seal.x - ctx.hx), Math.abs(seal.y - ctx.hy)) < GEN3.seal.far) f.push('the Seal is nearer than 30 tiles to the start');
  const s = ctx.site;
  if (s && seal.x >= s.x0 && seal.x < s.x0 + s.size && seal.y >= s.y0 && seal.y < s.y0 + s.size) f.push('the Seal is under the start site');
  return f;
}

// ---- Step 8: dormant content -----------------------------------------------------------------------------------
/** Dry floor voxels of level z (optionally only ledges: floors over rock with hall air or a drop nearby). */
function floorCells(L, z, ledgeOnly = false) {
  const base = z * PLANE, out = [];
  for (let c = 0; c < PLANE; c++) {
    const i = base + c;
    if (!dryFloor(L, i) || L.terrain[i] === TER.ROCK) continue;
    if (ledgeOnly && (z === 0 || L.terrain[i - PLANE] !== TER.ROCK)) continue;
    out.push(i);
  }
  return out;
}
function spread(R, cells, k, minD, taken) {
  const out = [];
  for (let t = 0; t < 400 && out.length < k && cells.length; t++) {
    const v = cells[ri(R, 0, cells.length - 1)];
    if (taken.some((u) => (u / PLANE | 0) === (v / PLANE | 0) && chebC(u % PLANE, v % PLANE) < minD)) continue;
    out.push(v); taken.push(v);
  }
  return out;
}
function dormant(L, seed, hgt, prot, rows) {
  const T = GEN3.dormant, R = gen(st(seed, 'dormant')), taken = [];
  const caves = { hollows: GEN3.caverns.hollows, mere: GEN3.caverns.mere, reach: GEN3.caverns.reach };
  const floors = {};
  for (const [id, C] of Object.entries(caves)) floors[id] = zOf(C.floor) >= 0 ? floorCells(L, zOf(C.floor)) : [];
  for (const id of Object.keys(caves)) for (const [kind, lo, hi] of T[id]) { const k = ri(R, lo, hi); for (const v of spread(R, floors[id], RG ? scalePct(k, RG.richPct) : k, 10, taken)) rows.push([kind, v, rowSeed(kind, v, seed)]); }
  // the Lamplost camp on a ledge of the Mere
  const mereLedge = floorCells(L, zOf(GEN3.caverns.mere.ledge), true);
  for (const v of spread(R, mereLedge, 1, 1, taken)) rows.push(['lamplost', v, rowSeed('lamplost', v, seed)]);
  // generated great beasts (3.12): a lair voxel in a cavern; the row's seed generates the body (gen3:beasts)
  const RB = gen(st(seed, 'beasts')), all = [].concat(floors.hollows, floors.mere, floors.reach);
  const nb = ri(RB, T.beasts[0], T.beasts[1]);
  for (const v of spread(RB, all, RG ? Math.max(1, scalePct(nb, RG.wildPct)) : nb, 20, taken)) rows.push(['lair', v, rowSeed('lair', v, seed)]);
  // the Gloomwyrm's cliff eyrie: a top voxel of the highest heights
  if (hgt) {
    let top = 0;
    for (let c = 0; c < PLANE; c++) if (hgt[c] > top) top = hgt[c];
    const cols = [];
    for (let c = 0; c < PLANE; c++) if (hgt[c] === top && top > 0 && zS + top < D && L.terrain[(zS + top) * PLANE + c] === TER.ROUGH) cols.push((zS + top) * PLANE + c);
    if (cols.length) { const v = cols[ri(RB, 0, cols.length - 1)]; rows.push(['lair_gloomwyrm', v, rowSeed('lair_gloomwyrm', v, seed)]); }
  }
  // the Bone Colossus: a 5 x 5 lair under the deep stone, below the Mere
  const zc = zOf(-11), M = mats();
  for (let t = 0; t < 400 && zc >= 1; t++) {
    const cx = ri(RB, 4, W - 5), cy = ri(RB, 4, H - 5);
    if (!rockBox(L, prot, cx, cy, 3, 3, zc - 1, zc + 1)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = idx(cx + dx, cy + dy, zc); L.terrain[i] = TER.ROUGH; L.ore[i] = 0; L.mat[i] = L.mat[i] || M.duskstone; prot[i] = 1; }
    const v = idx(cx, cy, zc);
    rows.push(['lair_colossus', v, rowSeed('lair_colossus', v, seed)]);
    break;
  }
}

/**
 * Steps 2-6 and 8 (2.2): everything below the surface, from the seed and the base mask only (5.4). ctx:
 *   { hx, hy }   the start (Hearth centre) for the ore and Seal guarantees (omit: unchecked)
 *   site         { x0, y0, size } the start site, kept clear of the Seal
 *   depth2, hgt  the planar massif depth and the column heights (native; default from the mask)
 *   belowOnly    true for the migration: nothing is written at z >= zS (no massif veins, no high spring)
 *   ruins        surface ruin cells (plane indexes): a crypt row under each
 * Returns { rows, bld, loot, info }; bld rows are [def, x, y, mat, init, z], loot rows [k, m, n, x, y, name, z].
 */
export function generateBelow(L, baseMask, seed, ctx = {}) {
  const G = GEN3.guarantee, prot = new Uint8Array(N), rows = [], bld = [], loot = [];
  const depth2 = ctx.depth2 || depth2Of(Uint8Array.from(baseMask, (m) => (m & 16 ? 1 : 0)));
  const hgt = ctx.belowOnly ? null : ctx.hgt || Uint8Array.from(baseMask, (m) => m & 7);
  const info = { rerolls: { caverns: 0, veins: 0, seal: 0 }, fails: [], caverns: {} };
  bandFill(L, baseMask, seed);
  // 3. caverns, each re-rolled alone while it fails
  for (const id of ['hollows', 'mere', 'reach']) {
    const C = GEN3.caverns[id];
    if (zOf(C.floor) < 0) continue;
    const lv = new Set([zOf(C.floor)]);
    if (C.ledge !== undefined) lv.add(zOf(C.ledge));
    let res = null;
    for (let n = 0; n <= G.rerolls; n++) {
      if (n) { bandFill(L, baseMask, seed, lv); for (const z of lv) prot.fill(0, z * PLANE, (z + 1) * PLANE); for (let k = rows.length - 1; k >= 0; k--) if (lv.has((rows[k][1] / PLANE) | 0)) rows.splice(k, 1); info.rerolls.caverns++; }
      res = cavern(L, seed, id, n, prot, rows);
      res.fails = cavernFails(res);
      if (!res.fails.length) break;
      (info.tried || (info.tried = [])).push(...res.fails);
    }
    info.caverns[id] = res;
    info.fails.push(...res.fails);
  }
  // 4. ember pools, springs
  info.ember = emberPools(L, seed, prot, rows);
  info.springs = springs(L, seed, hgt, prot, rows);
  // 5. veins, re-rolled while an ore guarantee fails
  let vr = null;
  for (let n = 0; n <= G.rerolls; n++) {
    if (vr) { for (const i of vr.written) L.ore[i] = 0; info.rerolls.veins++; }
    vr = veinPass3(L, seed, n, depth2, baseMask, !!ctx.belowOnly);
    const f = oreFails(L, ctx);
    if (!f.length) break;
    (info.tried || (info.tried = [])).push(...f);
    if (n === G.rerolls) info.fails.push(...f);
  }
  info.veins = vr.stats;
  // 6. vaults, the Seal and the Sleep, the seeps
  info.vaults = vaults(L, seed, prot, rows, bld, loot);
  let seal = null;
  for (let n = 0; n <= G.rerolls; n++) {
    seal = sealSleep(L, seed, n, ctx, prot, rows);
    if (!sealFails(seal, ctx).length) break;
    info.rerolls.seal++;
    if (seal) {   // undo: refill the lid and the room, drop their rows
      bandFill(L, baseMask, seed, new Set([zOf(-14)]));
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = idx(seal.x + dx, seal.y + dy, zOf(-13)); L.mat[i] = mats().duskstone; prot[i] = 0; }
      for (let k = rows.length - 1; k >= 0; k--) if (['sleep', 'seal', 'relic', 'hoard'].includes(rows[k][0])) rows.splice(k, 1);
      seal = null;
    }
  }
  info.fails.push(...sealFails(seal, ctx));
  info.seal = seal ? { x: seal.x, y: seal.y } : null;
  const zr = zOf(GEN3.caverns.reach.floor);
  if (zr >= 0) {
    const sp = RG ? RG.seeps : GEN3.seeps, R = gen(st(seed, 'seeps')), cells = floorCells(L, zr), seeps = spread(R, cells, ri(R, sp[0], sp[1]), 24, []);
    for (const v of seeps) rows.push(['seep', v, rowSeed('seep', v, seed)]);
    info.seeps = seeps.length;
  }
  // 8. dormant content, and a crypt under each surface ruin (buried ruins in the topsoil)
  dormant(L, seed, hgt, prot, rows);
  if (ctx.ruins) for (const c of ctx.ruins) { const v = (zS - 1) * PLANE + c; rows.push(['crypt', v, rowSeed('crypt', v, seed)]); }
  return { rows, bld, loot, info };
}

/** The 2.2 guarantees on a generated world (tests and the generator): the failure texts, [] when it passes. */
export function checkGuarantees(L, info) {
  const f = [];
  if (info.site && info.site.faceMin > GEN.site.faceMax + 1) f.push(`the start site is ${info.site.faceMin - 1} tiles from the face`);
  return f.concat(info.below.fails);
}

// ---- The whole world ------------------------------------------------------------------------------------------------
function checkShape() {
  if (D < 2 || zS < 14 || zS >= D - 1) throw new Error(`mapgen3: needs a world with zS >= 14 and at least one level above it (got D ${D}, zS ${zS})`);
}
/**
 * Generate a fresh fortress world into s (a createColony(seed, { d, zS }) state): writes all 13 voxel layers of s.L
 * (adding `fluid`) and pushes the generated buildings (ruin walls, vault walls and chests) into s.bld with z.
 * Returns the info: site, Hearth, loot rows, the pristine meta ({ dormant, amendments }), stats and re-rolls.
 */
export function generate3(s, opts = {}) {
  return withRegion(opts.region || null, () => generateIn(s, opts));
}
/** Step 1 with its re-rolls (the surface is re-rolled whole while the start site fails), as generate3 runs it. */
function surfaceRolled(seed, opts) {
  let sf = null, surfRerolls = 0;
  for (let n = 0; n <= GEN3.guarantee.rerolls; n++) { sf = surfacePass(seed, n, opts); if (siteOk(sf)) break; surfRerolls = n + 1; }
  return { sf, surfRerolls };
}
/** GEN3 v2 rows of the pristine meta: the region's lost artifacts (in a vault, else over a crypt) and its world beasts' surface lairs. */
function regionRows(L, seed, sf, rows) {
  const spots = rows.filter((r) => r[0] === 'vault' || r[0] === 'crypt').map((r) => r[1]);
  RG.relics.forEach((rl, k) => {
    if (!spots.length) return;
    const v = spots[k % spots.length], key = String(rl && rl.key !== undefined ? rl.key : rl);
    rows.push(['world_relic', v, rowSeed('world_relic', v + k, seed), key]);
  });
  const R = gen(st(seed, 'wlairs')), h = sf.hearth;
  RG.lairs.forEach((lr, k) => {
    const key = String(lr && lr.key !== undefined ? lr.key : lr);
    for (let t = 0; t < 300; t++) {
      const x = ri(R, 3, W - 4), y = ri(R, 3, H - 4), v = zS * PLANE + ix(x, y);
      if (!landT(L.terrain[v]) || Math.max(Math.abs(x - h.cx), Math.abs(y - h.cy)) < 30) continue;
      rows.push(['world_lair', v, rowSeed('world_lair', v + k, seed), key]);
      break;
    }
  });
}
function generateIn(s, opts) {
  checkShape();
  const seed = s.seed >>> 0, L = s.L;
  if (!L.fluid || L.fluid.length !== N) L.fluid = new Uint8Array(N);
  for (const k of Object.keys(L)) L[k].fill(0);
  L.terrain.fill(TER.AIR);
  const { sf, surfRerolls } = surfaceRolled(seed, opts);
  writeSurface(L, sf, seed);
  const { mask: baseMask } = baseMaskOf(sf.P.terrain);
  const below = generateBelow(L, baseMask, seed, { hx: sf.hearth.cx, hy: sf.hearth.cy, site: sf.site, depth2: sf.depth, hgt: sf.hgt, ruins: sf.ruins });
  if (RG && sf.ravines) {   // the ravine floors one level down (DIRT; a RAMP under each end's RAMP_TOP)
    const b = (zS - 1) * PLANE;
    for (const c of sf.ravines.cells) { const i = b + c; L.terrain[i] = TER.DIRT; L.ore[i] = 0; L.fluid[i] = 0; }
    for (const c of sf.ravines.ends) L.terrain[b + c] = TER.RAMP;
  }
  if (RG) regionRows(L, seed, sf, below.rows);
  for (const [def, x, y, mat, init] of sf.bld) s.bld.push(newBuilding(s.bld.length, def, x, y, 0, mat, { ...init, st: 'done', z: zS }));
  for (const [def, x, y, mat, init, z] of below.bld) s.bld.push(newBuilding(s.bld.length, def, x, y, 0, mat, { ...init, st: 'done', z }));
  const loot = sf.loot.map(([k, m, n, x, y, name]) => [k, m, n, x, y, name, zS]).concat(below.loot);
  const info = {
    seed, side: sf.side, site: sf.site, hearth: sf.hearth, edges: sf.edges, ramps: sf.ramps.length, rerolls: { surface: surfRerolls, ...below.info.rerolls },
    massifRerolls: sf.rerolls, ruins: sf.ruins.length, blight: sf.blight, trees: sf.trees, lake: sf.lake, river: sf.river, hills: sf.hills, riverDist: sf.riverDist,
    below: below.info, loot, meta: { dormant: below.rows, amendments: [] }, baseMask,
    genVersion: RG ? GEN3.version : GEN3.legacyVersion,
  };
  if (RG) {
    info.region = {
      biome: RG.biome, side: sf.side, sea: sf.sea, lakes: sf.lakes, rocks: sf.rocks, ravines: sf.ravines ? sf.ravines.n : 0, massifTiles: sf.massifTiles,
      riverEdges: sf.riverEdges, ember: RG.ember, aquiferPct: RG.aquiferPct, soil: RG.soil, blightPct: RG.blight, ruins: RG.ruins,
      heights: RG.heights.max, edges: (opts.region && opts.region.edges) || null, climate: (opts.region && opts.region.climate) || null,
    };
  }
  info.fails = checkGuarantees(L, info);
  return info;
}

// ---- The region card preview (EMBERCROWN-WORLD.md 3.7) ---------------------------------------------------------------
/** The colour keys of previewSurface's index plane (the renderer maps each to a palette colour). */
export const PREVIEW_KEYS = Object.freeze(['grass', 'meadow', 'dirt', 'sand', 'rich', 'marsh', 'shallow', 'deep', 'ice', 'tree', 'bush',
  'rock1', 'rock2', 'rock3', 'rock4', 'rock5', 'ramp', 'ravine', 'blight', 'hearth', 'other']);
const PK = Object.freeze(Object.fromEntries(PREVIEW_KEYS.map((k, i) => [k, i])));
/**
 * The surface of the hold that generate3(s with s.seed = seed, opts) would make, without the levels below: step 1 with
 * its re-rolls, then the zS plane as writeSurface writes it (terrain, plant, growth, blight; massif columns ROCK) and a
 * W x H colour-index plane (PREVIEW_KEYS). Cosmetic and never saved; the map size must be the hold's (128 x 128 x 20).
 * Returns { w, h, side, colour, terrain, plant, growth, blight, hgt, hearth, site }.
 */
export function previewSurface(seed, opts = {}) {
  checkShape();
  return withRegion(opts.region || null, () => {
    const { sf } = surfaceRolled(seed >>> 0, opts), P = sf.P, hgt = sf.hgt;
    const terrain = new Uint8Array(PLANE), plant = new Uint8Array(PLANE), growth = new Uint8Array(PLANE), blight = new Uint8Array(PLANE), colour = new Uint8Array(PLANE);
    for (let c = 0; c < PLANE; c++) {
      if (hgt[c]) { terrain[c] = TER.ROCK; continue; }
      terrain[c] = P.terrain[c]; plant[c] = P.plant[c]; growth[c] = P.growth[c]; blight[c] = P.blight[c];
    }
    for (const c of sf.ramps) if (!hgt[c]) { terrain[c] = TER.RAMP; plant[c] = 0; growth[c] = 0; }
    const oak = plantCode('oak'), pine = plantCode('pine'), byTer = {
      [TER.GRASS]: PK.grass, [TER.MEADOW]: PK.meadow, [TER.DIRT]: PK.dirt, [TER.SAND]: PK.sand, [TER.RICH]: PK.rich, [TER.MARSH]: PK.marsh,
      [TER.SHALLOW]: PK.shallow, [TER.DEEP]: PK.deep, [TER.ICE]: PK.ice, [TER.RAMP]: PK.ramp, [TER.AIR]: PK.ravine, [TER.RAMP_TOP]: PK.ravine,
    };
    const hh = sf.hearth;
    for (let c = 0; c < PLANE; c++) {
      const x = c % W, y = (c / W) | 0, t = terrain[c], p = plant[c];
      let k;
      if (x >= hh.x && x < hh.x + hh.w && y >= hh.y && y < hh.y + hh.h) k = PK.hearth;
      else if (hgt[c]) k = PK.rock1 + Math.min(5, hgt[c]) - 1;
      else if (t === TER.ROCK) k = PK.rock1;
      else if (p && (p === oak || p === pine)) k = PK.tree;
      else if (p) k = PK.bush;
      else if (blight[c]) k = PK.blight;
      else k = byTer[t] !== undefined ? byTer[t] : PK.other;
      colour[c] = k;
    }
    return { w: W, h: H, side: sf.side, colour, terrain, plant, growth, blight, hgt: Uint8Array.from(hgt), hearth: { ...sf.hearth }, site: { ...sf.site } };
  });
}

/** n open voxels next to the Hearth on the surface for the starting band (deterministic ring order). */
export function startSpots3(s, n = 3) {
  const h = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
  const cx = h ? h.x + 1 : W >> 1, cy = h ? h.y + 1 : H >> 1, out = [];
  for (let r = 2; r < 10 && out.length < n; r++) {
    for (let dy = -r; dy <= r && out.length < n; dy++) for (let dx = -r; dx <= r && out.length < n; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || ((dx + dy) & 1)) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = idx(x, y, zS);
      if (s.rt.walkCost[i] && s.rt.walkCost[i] < 15 && !s.L.plant[i]) out.push(i);
    }
  }
  return out;
}

/**
 * The new-fortress world (what the founding flow calls after createColony(seed, { d: 20, zS: 14 })): generate3, the
 * pristine world built from it and attached, the Hearth (s.colony.hearth), initRuntime, the loot stacks and the
 * opening reveal around the Hearth. Returns the generation info (plus spawn voxels and the pristine world).
 */
export function generateWorld3(s, opts = {}) {
  installWorld();
  const info = generate3(s, opts);
  const p = attachPristine(s, buildPristine(s, { worldKind: WORLD_KIND.NATIVE, genVersion: info.genVersion, meta: info.meta }));
  const h = info.hearth;
  if (structDef('hearth') && !s.bld.some((b) => b && b.def === 'hearth')) {
    const id = s.bld.length;
    s.bld.push(newBuilding(id, 'hearth', h.x, h.y, 0, null, { st: 'done', z: zS }));
    s.colony.hearth.id = id;
  }
  initRuntime(s);
  for (const [k, m, n, x, y, name, z] of info.loot) spawnItem(s, k, m, 0, n, x, y, name ? { name, z } : { z });
  revealAround(s, idx(h.cx, h.cy, zS), Math.round(GEN.site.revealR * Math.max(Math.min(W, H) / 128, 0.5)), true);
  s.rt.dirty.light = true;
  info.spawn = startSpots3(s, 3);
  info.pristine = p;
  return info;
}

/**
 * The regeneration fallback (5.1): the pristine layers of a native world from its header and seed. A GEN3 v2 world
 * (genVersion >= 2) also needs its opts.region (s.realm.embark) as `region`; without it there is nothing to rebuild from,
 * so this throws and pristine.regeneratePristine returns null (the other fallbacks of 9.3 apply).
 */
export function regenerate3({ seed, w, h, d, zS: zs, genVersion = 0, region = null }) {
  if ((genVersion | 0) >= 2 && !region) throw new Error('mapgen3: a region world needs its region inputs to regenerate');
  setMapSize(w, h, d, zs);
  const L = allocLayers();
  L.fluid = new Uint8Array(w * h * d);
  const s = { seed: seed >>> 0, w, h, d, zS: zs, L, bld: [] };
  const info = generate3(s, region ? { region } : {});
  return { w, h, d, zS: zs, L, pristineMeta: info.meta };
}
setRegenerator(regenerate3);
