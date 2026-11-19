// Map generation (owner B; doc 3.2, 14.6). Seeded and deterministic: every step draws from its own
// fork of the colony's `gen` stream (fork(s, 'gen', 'gen:<step>')), never Math.random.
//
// Stage 1a runs the slice steps: 1 elevation and the massif (with the massif guarantee), 2 depth,
// 3 rock layers, 4 ore veins, 5 one cavern, 7 the surface (river with fords, lake, marsh, sand,
// meadows, rich soil, forests), 9 the start site with the Hearth, 10 spawn edges (spawnEdges()).
// Stage 2 (worldrec.worldStage2; stage2Features, run after the site so a Stage 1b map is unchanged
// except for these additions): the other caverns (3-5 in all) with glowcaps, 1-2 underground springs,
// 3 surface ruins, 1 Old Crown vault and the starting blight (blight.seedBlight).
//
//   generateMap(s, opts)    writes the saved tile layers of a fresh colony (s.L; before initRuntime,
//                           like stubmap.js) and returns the generation info (site, Hearth, stats).
//   generateWorld(s, opts)  generateMap + the Hearth building + initRuntime + the opening reveal:
//                           what the new-colony flow calls after createColony(seed).
//   spawnEdges(s)           raid and visitor entry segments on the map border (step 10), a pure
//                           function of the live state (reachability labels), so nothing is stored.
// No map-sized buffers at import (D1): everything is allocated per call.

import { W, H, N, TER, TER_BUILDABLE, TER_PASSABLE, TER_WATER, ROOF, idx } from '../core/grid.js';
import { fork, rint, rnd } from '../core/rand.js';
import { newBuilding } from '../core/schema.js';
import { initRuntime } from '../core/state.js';
import { GEN, DATA as GEN_DATA } from '../../data/worldgen.js';
import { depthRebuild, chamfer, SUPPORT_RADIUS } from './pass.js';
import { stoneId, depositId, layerOfDepth, plantCode, structDef, sizeOf } from './defs.js';
import { compOf } from './regions.js';
import { installWorld } from './terrain.js';
import { revealAround } from './fog.js';
import { worldStage2 } from './worldrec.js';
import { seedBlight } from './blight.js';
import { spawn as spawnItem } from '../work/items.js';

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
  return { A: H, T: W, xy: (a, t) => [t, a], at: (x, y) => [y, x] }; // 'n'
}

// ---- Step 1: the massif and its guarantee -------------------------------------------------------------
function massifPass(L, fr, R, seed, sc, minThick) {
  const G = GEN.massif;
  const mean = (ri(R, G.thickPct[0], G.thickPct[1]) * fr.A) / 100;
  const amp = (G.wavePct * Math.max(W, H)) / 100;
  const thick = new Float64Array(fr.T);
  for (let t = 0; t < fr.T; t++) thick[t] = Math.max(minThick, mean + amp * wave(t, fr.T, seed));
  const mask = new Uint8Array(N);
  const rough = 2.5 * Math.max(0.5, sc);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [a, t] = fr.at(x, y);
    const e = thick[t] - a + rough * (fbm(x, y, 9 * Math.max(0.5, sc), seed ^ 0x6a09e667) - 0.5) * 2;
    // the guarantee floor is hard: noise never thins the massif below minThick
    if (e > 0 || a < minThick) mask[idx(x, y)] = 1;
  }
  return { mask, thick, mean };
}
function depthStats(depth, rock, under) {
  let max = 0, deep = 0;
  for (let i = 0; i < N; i++) { if (!rock[i]) continue; const d = depth[i]; if (d > max) max = d; if (d >= under) deep++; }
  return { max, deep };
}

// ---- Step 5: one cavern (cellular automata) --------------------------------------------------------------
function cavernPass(L, depth, R, sc) {
  const C = GEN.cavern;
  const box = Math.max(8, Math.round(C.box * Math.max(0.5, sc)));
  const minD = Math.max(3, Math.round(C.minDepth * Math.min(1, sc * 1.4)));
  const lo = Math.max(8, Math.round(C.size[0] * sc * sc)), hi = Math.max(lo + 8, Math.round(C.size[1] * sc * sc));
  // candidate centres: tiles whose whole box sits in rock at depth >= minD. Depth is a Chebyshev
  // distance, so depth(centre) >= minD + half puts every tile of the box in rock at depth >= minD.
  const half = box >> 1;
  let cands = [];
  for (let need = minD + half; need >= 3 + half && !cands.length; need -= 2) {
    for (let y = half + 1; y < H - half - 1; y++) for (let x = half + 1; x < W - half - 1; x++) {
      const i = idx(x, y);
      if (L.terrain[i] === TER.ROCK && depth[i] >= need) cands.push(i);
    }
  }
  if (!cands.length) return null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const c0 = cands[ri(R, 0, cands.length - 1)], cx = c0 % W, cy = (c0 / W) | 0;
    // random fill, then smoothing steps (4-5 rule) inside the box
    const bw = box + 1, cell = new Uint8Array(bw * bw), nxt = new Uint8Array(bw * bw);
    for (let y = 0; y < bw; y++) for (let x = 0; x < bw; x++) {
      const dx = x - half, dy = y - half, r2 = (dx * dx + dy * dy) / (half * half);
      cell[y * bw + x] = r2 < 1 && rf(R) * 100 < C.fill + (1 - r2) * 18 ? 1 : 0;
    }
    for (let k = 0; k < C.steps; k++) {
      for (let y = 0; y < bw; y++) for (let x = 0; x < bw; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < bw && yy < bw && cell[yy * bw + xx]) n++;
        }
        nxt[y * bw + x] = n >= 5 || (cell[y * bw + x] && n >= 4) ? 1 : 0;
      }
      cell.set(nxt);
    }
    // largest 4-connected component, trimmed to `hi` tiles by BFS order from its first tile
    const seen = new Uint8Array(bw * bw);
    let best = null;
    for (let s0 = 0; s0 < bw * bw; s0++) {
      if (!cell[s0] || seen[s0]) continue;
      const comp = [s0]; seen[s0] = 1;
      for (let q = 0; q < comp.length; q++) {
        const c = comp[q], x = c % bw, y = (c / bw) | 0;
        const nb = [x > 0 ? c - 1 : -1, x < bw - 1 ? c + 1 : -1, y > 0 ? c - bw : -1, y < bw - 1 ? c + bw : -1];
        for (const n2 of nb) if (n2 >= 0 && cell[n2] && !seen[n2]) { seen[n2] = 1; comp.push(n2); }
      }
      if (!best || comp.length > best.length) best = comp;
    }
    if (!best || best.length < lo) continue;
    if (best.length > hi) best.length = hi;
    const ox = cx - half, oy = cy - half, tiles = [];
    for (const c of best) tiles.push(idx(ox + (c % bw), oy + ((c / bw) | 0)));
    tiles.sort((a, b) => a - b);
    for (const i of tiles) { L.terrain[i] = TER.MOSS; L.ore[i] = 0; L.roof[i] = ROOF.MOUNTAIN; }
    // natural pillars: a cavern stands under an overhead roof, so no tile may be more than
    // SUPPORT_RADIUS from rock (3.4); the first uncovered tile in index order stays rock, and so on
    const nearRock = (i) => {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -SUPPORT_RADIUS; dy <= SUPPORT_RADIUS; dy++) for (let dx = -SUPPORT_RADIUS; dx <= SUPPORT_RADIUS; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H || L.terrain[yy * W + xx] === TER.ROCK) return true;
      }
      return false;
    };
    let pillars = 0;
    for (let k = 0; k < tiles.length; k++) {
      const i = tiles[k];
      if (L.terrain[i] === TER.ROCK || nearRock(i)) continue;
      // put the pillar R tiles further on (down-right) where it covers the most new ground
      const x = i % W, y = (i / W) | 0;
      let p = i;
      for (let d = SUPPORT_RADIUS; d > 0; d--) { const j = Math.min(H - 1, y + d) * W + Math.min(W - 1, x + d); if (L.terrain[j] === TER.MOSS) { p = j; break; } }
      L.terrain[p] = TER.ROCK; pillars++;
    }
    const open = tiles.filter((i) => L.terrain[i] !== TER.ROCK);
    tiles.length = 0; for (const i of open) tiles.push(i);
    // a small underground pool at the tiles nearest the centre (shallow water: wadeable)
    const ctr = idx(cx, cy);
    const byNear = tiles.slice().sort((a, b) => {
      const da = Math.max(Math.abs((a % W) - cx), Math.abs(((a / W) | 0) - cy)), db = Math.max(Math.abs((b % W) - cx), Math.abs(((b / W) | 0) - cy));
      return da - db || a - b;
    });
    const pool = Math.min(C.pool, tiles.length >> 3);
    for (let k = 0; k < pool; k++) L.terrain[byNear[k]] = TER.SHALLOW;
    void ctr;
    return { x: cx, y: cy, size: tiles.length, pool, pillars, tiles };
  }
  return null;
}

// ---- Step 4: ore veins -----------------------------------------------------------------------------------
function veinPass(L, depth, R, sc) {
  const out = {};
  const area = (W * H) / (128 * 128);
  for (const d of GEN_DATA.deposit) {
    const id = depositId(d.id);
    if (!id) continue;
    const n = Math.max(1, Math.round(ri(R, d.veins[0], d.veins[1]) * area));
    let placed = 0, tiles = 0;
    const dlo = Math.max(1, Math.round(d.depth[0] * Math.min(1, sc * 1.4))), dhi = Math.max(dlo + 1, Math.round(d.depth[1] * Math.min(1, sc * 1.4)));
    const okTile = (i, slack) => L.terrain[i] === TER.ROCK && !L.ore[i] && depth[i] >= dlo - slack && depth[i] <= dhi + slack;
    for (let v = 0; v < n; v++) {
      let start = -1;
      for (let k = 0; k < GEN.vein.tries; k++) { const i = ri(R, 0, N - 1); if (okTile(i, 0)) { start = i; break; } }
      if (start < 0) continue;
      const len = ri(R, GEN.vein.len[0], GEN.vein.len[1]);
      let cur = start, got = 0;
      L.ore[cur] = id; got++;
      for (let step = 0; step < len * 3 && got < len; step++) {
        const dir = ri(R, 0, 3), x = cur % W, y = (cur / W) | 0;
        const nx = x + (dir === 1 ? 1 : dir === 3 ? -1 : 0), ny = y + (dir === 2 ? 1 : dir === 0 ? -1 : 0);
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const j = ny * W + nx;
        if (L.ore[j] === id) { cur = j; continue; }
        if (!okTile(j, 1)) continue;
        L.ore[j] = id; cur = j; got++;
      }
      tiles += got;
      if (got >= 4) placed++;
    }
    out[d.id] = { veins: placed, tiles };
  }
  return out;
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
  const river = new Uint8Array(N);
  for (let t = 0; t < fr.T; t++) {
    const c = centre[t], ford = isFord(t);
    const a0 = Math.round(c - w / 2), a1 = a0 + w - 1;
    for (let a = a0 - 2; a <= a1 + 2; a++) {
      if (a < 0 || a >= fr.A) continue;
      const [x, y] = fr.xy(a, t), i = idx(x, y);
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
      const i = idx(x, y);
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
function hillPass(L, fr, centre, R, seed, sc, mask) {
  const G = GEN.hills;
  const n = ri(R, G.count[0], G.count[1]), out = [];
  const waterD = new Uint8Array(N);
  for (let i = 0; i < N; i++) waterD[i] = TER_WATER[L.terrain[i]] || L.terrain[i] === TER.MARSH ? 0 : 255;
  chamfer(waterD, 0, 0, W - 1, H - 1, 255);
  for (let k = 0; k < n; k++) {
    const r = ri(R, Math.round(G.radius[0] * sc), Math.round(G.radius[1] * sc)) + 2;
    for (let attempt = 0; attempt < 20; attempt++) {
      const t = ri(R, 0, fr.T - 1);
      const amin = Math.round(centre[t] + 6 * sc + r * 0.5), amax = fr.A - 1;
      if (amax <= amin) break;
      const a = ri(R, amin, amax);
      const [cx, cy] = fr.xy(a, t);
      if (waterD[idx(cx, cy)] < r * 0.6) continue;
      let made = 0;
      for (let y = Math.max(0, cy - 2 * r); y <= Math.min(H - 1, cy + 2 * r); y++) {
        for (let x = Math.max(0, cx - 2 * r); x <= Math.min(W - 1, cx + 2 * r); x++) {
          const i = idx(x, y);
          if (L.terrain[i] !== TER.GRASS || waterD[i] < 3) continue;
          const e = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / r + 0.7 * (fbm(x, y, 6, seed ^ (0x9b05688c + k)) - 0.5);
          if (e < 1) { L.terrain[i] = TER.ROCK; mask[i] = 2; made++; }
        }
      }
      if (made) { out.push({ x: cx, y: cy, r, tiles: made }); break; }
    }
  }
  return out;
}
function soilPass(L, R, seed, waterNear) {
  const open = [];
  for (let i = 0; i < N; i++) if (L.terrain[i] === TER.GRASS) open.push(i);
  const nv = (i, cell, sd) => fbm(i % W, (i / W) | 0, cell, sd);
  const paint = (pct, cell, sd, ter) => {
    if (!open.length) return;
    const vals = open.map((i) => nv(i, cell, sd));
    const th = quantile(vals, 1 - pct / 100);
    for (let k = 0; k < open.length; k++) if (vals[k] >= th && L.terrain[open[k]] === TER.GRASS) L.terrain[open[k]] = ter;
  };
  // marsh near water first, then meadows, rich soil and dirt patches
  for (const i of open) if (waterNear[i] > 0 && waterNear[i] <= 3 && nv(i, 3, seed ^ 0x7137449) > 0.56) L.terrain[i] = TER.MARSH;
  paint(GEN.meadowPct, 11, seed ^ 0x2f13, TER.MEADOW);
  paint(GEN.richPct, 5, seed ^ 0x8e1b, TER.RICH);
  paint(5, 6, seed ^ 0x4d6a, TER.DIRT);
  void R;
}
function forestPass(L, R, seed) {
  const open = [];
  for (let i = 0; i < N; i++) { const t = L.terrain[i]; if (t === TER.GRASS || t === TER.MEADOW || t === TER.DIRT || t === TER.RICH) open.push(i); }
  if (!open.length) return 0;
  const vals = open.map((i) => fbm(i % W, (i / W) | 0, 14, seed ^ 0x510e527f));
  const th = quantile(vals, 1 - GEN.forestPct / 100);
  const oak = plantCode('oak'), pine = plantCode('pine');
  let trees = 0;
  for (let k = 0; k < open.length; k++) {
    const i = open[k], x = i % W, y = (i / W) | 0;
    const inForest = vals[k] >= th;
    const p = hash2(x, y, seed ^ 0x9b05);
    if (inForest ? p < 0.55 : p < 0.018) {
      const kind = vnoise(x, y, 10, seed ^ 0x1f83) > 0.55 ? pine : oak;
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
    const i = idx(x, y);
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
    if (L.terrain[idx(x, y)] !== TER.MEADOW) continue;
    bushes += berryClump(L, R, x, y, ri(R, 3, 7), code);
    c++;
  }
  return bushes;
}

function windowMin(a, size) {
  const row = new Uint16Array(N), out = new Uint16Array(N).fill(65535);
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
  const seen = new Uint8Array(N), q = new Int32Array(N);
  let h = 0, t = 0;
  const pass = (i) => TER_PASSABLE[L.terrain[i]] === 1 && !(blocked && blocked[i]);
  const starts = [];
  if (pass(from)) starts.push(from);
  else { const x = from % W, y = (from / W) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && pass(idx(xx, yy))) starts.push(idx(xx, yy)); } }
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
  const toFace = new Uint8Array(N), toRiver = new Uint8Array(N), bad = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
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

/**
 * Generate the map of a fresh colony (s from createColony): writes terrain, mat, ore, roof, plant
 * and growth (fog and known are set by generateWorld's reveal). Returns the generation info.
 * @param {object} s
 * @param {{ side?: 'n'|'e'|'w' }} [opts]
 */
export function generateMap(s, opts = {}) {
  const L = s.L;
  for (const k of ['terrain', 'mat', 'ore', 'floor', 'roof', 'plant', 'growth', 'blight', 'zone', 'desig', 'fog', 'known']) L[k].fill(0);
  L.terrain.fill(TER.GRASS);
  const sc = Math.min(W, H) / 128;
  const G = GEN.massif;
  const rSide = gen(fork(s, 'gen', 'gen:side'));
  const side = opts.side || G.sides[ri(rSide, 0, G.sides.length - 1)];
  const fr = frameOf(side);
  const minThick = Math.max(4, Math.round(G.minThick * sc));
  const maxDepthMin = Math.round(G.maxDepthMin * sc), underMin = Math.round(G.underdeepMin * sc * sc), under = Math.round(G.underdeep * sc);

  // 1. massif with the guarantee (re-roll only the massif mask, at most G.rerolls times)
  let m = null, rerolls = 0, depth = null, ds = null;
  const surfSeed = fork(s, 'gen', 'gen:surface');
  for (let n = 0; n <= G.rerolls; n++) {
    const seed = fork(s, 'gen', `gen:massif:${n}`);
    m = massifPass(L, fr, gen(seed), seed, sc, minThick + (n === G.rerolls ? 6 * sc : 0));
    // quick guarantee estimate on the massif alone (the full check runs after the surface)
    for (let i = 0; i < N; i++) L.terrain[i] = m.mask[i] ? TER.ROCK : TER.GRASS;
    depth = depthRebuild(s);
    ds = depthStats(depth, m.mask, under);
    if (ds.max >= maxDepthMin && ds.deep >= underMin) break;
    rerolls = n + 1;
  }
  const mask = m.mask;
  m.thick.forEach((v, t) => { m.thick[t] = Math.ceil(v); });

  // 7a. river and lake (before the hills, so rock never cuts the river), then the hills
  const rRiver = gen(fork(s, 'gen', 'gen:river'));
  const rv = riverPass(L, fr, m.thick, rRiver, surfSeed, sc);
  const lake = lakePass(L, fr, rv.centre, gen(fork(s, 'gen', 'gen:lake')), surfSeed, sc);
  const hills = hillPass(L, fr, rv.centre, gen(fork(s, 'gen', 'gen:hills')), surfSeed, sc, mask);

  // 2. depth over all rock; 3. stones and roofs by depth
  depth = depthRebuild(s);
  ds = depthStats(depth, Uint8Array.from(L.terrain, (t) => (t === TER.ROCK ? 1 : 0)), under);
  const stoneSeed = fork(s, 'gen', 'gen:stone');
  for (let i = 0; i < N; i++) {
    if (L.terrain[i] !== TER.ROCK) continue;
    const d = depth[i];
    const layer = layerOfDepth(Math.max(1, Math.round(d / Math.max(sc, 0.25))));
    const st = layer.stones;
    const v = fbm(i % W, (i / W) | 0, 7, stoneSeed);
    const pick = st.length > 1 && v > (layer.id === 'deep' ? 0.62 : 0.5) ? st[1] : st[0];
    L.mat[i] = stoneId(pick);
    L.roof[i] = d >= 5 ? ROOF.MOUNTAIN : ROOF.THIN;
  }
  // 4. ore veins; 5. one cavern
  const veins = veinPass(L, depth, gen(fork(s, 'gen', 'gen:ore')), sc);
  const caverns = [];
  for (let k = 0; k < GEN.cavern.count; k++) {
    const c = cavernPass(L, depth, gen(fork(s, 'gen', `gen:cavern:${k}`)), sc);
    if (c) { caverns.push({ x: c.x, y: c.y, size: c.size, pool: c.pool, pillars: c.pillars }); }
  }

  // 7b. soils, marsh near water, forests and lone trees
  const waterNear = new Uint8Array(N);
  for (let i = 0; i < N; i++) waterNear[i] = TER_WATER[L.terrain[i]] ? 0 : 255;
  chamfer(waterNear, 0, 0, W - 1, H - 1, 255);
  soilPass(L, null, surfSeed, waterNear);
  const trees = forestPass(L, gen(fork(s, 'gen', 'gen:forest')), surfSeed);
  const berries = berryPass(L, gen(fork(s, 'gen', 'gen:berries')), sc);

  // 9. the start site: 20 x 20 buildable within 6 of the face, river within 25, reaching 3 edges
  const rSite = gen(fork(s, 'gen', 'gen:site'));
  const site = sitePass(L, fr, mask, rv.river, rSite, sc);
  const hearthDef = structDef('hearth');
  const [hw, hh] = sizeOf(hearthDef || { size: [3, 3] });
  let pick = null, edges = null, tried = 0;
  const foot = new Uint8Array(N);
  for (const [, k] of site.cands) {
    if (tried++ > 60) break;
    const x0 = k % W, y0 = (k / W) | 0;
    const hx = x0 + ((site.size - hw) >> 1), hy = y0 + ((site.size - hh) >> 1);
    foot.fill(0);
    for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + hw; x++) foot[idx(x, y)] = 1;
    const e = edgesReached(L, idx(hx - 1, hy - 1), foot);
    if (e.count >= 3) { pick = { x0, y0, hx, hy }; edges = e; break; }
    if (!pick) pick = { x0, y0, hx, hy, weak: true }, edges = e;
  }
  let fixed = 0;
  if (!pick) {
    // no clean candidate (tiny test maps): flatten a site next to the centre of the face
    const [fx, fy] = fr.xy(Math.min(fr.A - site.size - 2, m.thick[fr.T >> 1] + 2), Math.max(1, (fr.T >> 1) - (site.size >> 1)));
    const x0 = Math.max(1, Math.min(W - site.size - 1, side === 'e' ? fx - site.size + 1 : fx));
    const y0 = Math.max(1, Math.min(H - site.size - 1, side === 'n' ? fy : fy));
    for (let y = y0; y < y0 + site.size; y++) for (let x = x0; x < x0 + site.size; x++) {
      const i = idx(x, y);
      if (L.terrain[i] !== TER.GRASS) { L.terrain[i] = TER.GRASS; L.mat[i] = 0; L.ore[i] = 0; L.roof[i] = 0; fixed++; }
    }
    pick = { x0, y0, hx: x0 + ((site.size - hw) >> 1), hy: y0 + ((site.size - hh) >> 1) };
    edges = edgesReached(L, idx(pick.hx - 1, pick.hy - 1), null);
  }
  if (edges.count < 3) {
    // open every ford wider and add one more crossing in the middle of the river (deep -> shallow)
    const tm = fr.T >> 1;
    for (let t = Math.max(0, tm - 2); t <= Math.min(fr.T - 1, tm + 2); t++) for (let a = 0; a < fr.A; a++) {
      const [x, y] = fr.xy(a, t), i = idx(x, y);
      if (L.terrain[i] === TER.DEEP && rv.river[i]) { L.terrain[i] = TER.SHALLOW; fixed++; }
    }
    edges = edgesReached(L, idx(pick.hx - 1, pick.hy - 1), null);
  }
  // clear plants near the Hearth, then make sure of >= 3 trees within 12 tiles of it
  const hcx = pick.hx + (hw >> 1), hcy = pick.hy + (hh >> 1);
  const clearR = GEN.site.clear + (hw >> 1);
  for (let y = hcy - clearR; y <= hcy + clearR; y++) for (let x = hcx - clearR; x <= hcx + clearR; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = idx(x, y); L.plant[i] = 0; L.growth[i] = 0;
  }
  const near = Math.round(GEN.site.near * Math.max(sc, 0.5));
  const treeNear = () => {
    let n = 0;
    for (let y = hcy - near; y <= hcy + near; y++) for (let x = hcx - near; x <= hcx + near; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = L.plant[idx(x, y)]; if (p && p <= 2) n++;
    }
    return n;
  };
  let planted = 0;
  for (let guard = 0; treeNear() < GEN.site.trees && guard < 200; guard++) {
    const x = hcx + ri(rSite, -near, near), y = hcy + ri(rSite, -near, near);
    if (x < 0 || y < 0 || x >= W || y >= H || Math.max(Math.abs(x - hcx), Math.abs(y - hcy)) <= clearR) continue;
    const i = idx(x, y);
    if (L.plant[i] || !TER_BUILDABLE[L.terrain[i]] || L.terrain[i] === TER.ROCK) continue;
    L.plant[i] = plantCode('oak'); L.growth[i] = 255; planted++;
  }
  // and >= GEN.site.berries berry patch within 12 tiles (Stage 1b; skipped without the berry plant)
  const berry = plantCode('berry');
  let berryPlanted = 0;
  if (berry) {
    const rBerry = gen(fork(s, 'gen', 'gen:site:berries'));
    const berryNear = () => {
      let n = 0;
      for (let y = hcy - near; y <= hcy + near; y++) for (let x = hcx - near; x <= hcx + near; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H && L.plant[idx(x, y)] === berry) n++;
      }
      return n;
    };
    for (let guard = 0; berryNear() < 3 * GEN.site.berries && guard < 60; guard++) {
      const x = hcx + ri(rBerry, -near + 2, near - 2), y = hcy + ri(rBerry, -near + 2, near - 2);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || Math.max(Math.abs(x - hcx), Math.abs(y - hcy)) <= clearR + 2) continue;
      const i = idx(x, y);
      if (!TER_BUILDABLE[L.terrain[i]] || L.terrain[i] === TER.ROCK) continue;
      berryPlanted += berryClump(L, rBerry, x, y, 4, berry);
    }
  }
  // depth and roofs again if the site fix-up removed rock (tiny maps only)
  if (fixed) depth = depthRebuild(s);
  // Stage 2 features (after the site, so the rest of the map is as in Stage 1b)
  const extra = worldStage2() ? stage2Features(s, L, depth, caverns, hcx, hcy, sc) : null;

  const info = {
    side, rerolls, minThick, maxDepth: ds.max, underdeep: ds.deep, veins, caverns, hills: hills.length,
    lake: lake ? { x: lake.x, y: lake.y } : null, river: { fords: rv.fords.length, width: rv.w },
    site: { x0: pick.x0, y0: pick.y0, size: site.size, weak: !!pick.weak, faceDist: site.toFace[idx(pick.hx, pick.hy)] },
    hearth: { x: pick.hx, y: pick.hy, cx: hcx, cy: hcy, w: hw, h: hh }, edges, trees, planted, fixed, berries, berryPlanted,
    riverDist: site.toRiver[idx(hcx, hcy)], stage2: extra,
  };
  return info;
}

// ---- Stage 2: caverns, springs, ruins, a vault and the blight (3.2 steps 5, 6, 8; 3.1) -------------------
const S2 = Object.freeze({ caverns: [3, 5], glowcapPct: 8, springs: [1, 2], springDepth: [6, 12], ruins: 3, ruinFar: 26, vaultDepth: [10, 20] });
/** Rock tiles whose (2r+1) box is all rock with depth in [lo, hi] at the centre (sorted). */
function rockSpots(L, depth, r, lo, hi) {
  const out = [];
  for (let y = r + 1; y < H - r - 1; y++) for (let x = r + 1; x < W - r - 1; x++) {
    const i = idx(x, y), d = depth[i];
    if (L.terrain[i] !== TER.ROCK || d < lo || d > hi || d < r + 2) continue;
    let rock = true;
    for (let dy = -r; dy <= r && rock; dy++) for (let dx = -r; dx <= r && rock; dx++) if (L.terrain[i + dy * W + dx] !== TER.ROCK) rock = false;
    if (rock) out.push(i);
  }
  return out;
}
function stage2Features(s, L, depth, caverns, hcx, hcy, sc) {
  const out = { caverns: 0, glowcaps: 0, springs: 0, ruins: 0, vault: null, blight: 0, loot: [] };
  // caverns: up to 3-5 in all (one was cut in step 5)
  const rc = gen(fork(s, 'gen', 'gen:s2:caverns'));
  const want = ri(rc, S2.caverns[0], S2.caverns[1]);
  for (let k = caverns.length; k < want; k++) {
    const c = cavernPass(L, depth, gen(fork(s, 'gen', `gen:cavern:${k}`)), sc);
    if (c) caverns.push({ x: c.x, y: c.y, size: c.size, pool: c.pool, pillars: c.pillars });
  }
  out.caverns = caverns.length;
  // glowcaps on cavern moss
  const glow = plantCode('glowcap');
  if (glow) for (let i = 0; i < N; i++) if (L.terrain[i] === TER.MOSS && !L.plant[i] && rf(rc) * 100 < S2.glowcapPct) { L.plant[i] = glow; L.growth[i] = 128 + ri(rc, 0, 127); out.glowcaps++; }
  // springs: a 5-tile pool with a ring of moss, sealed in the middle layer (a well beside it is the
  // hold's clean water, 3.2 step 6)
  const rs = gen(fork(s, 'gen', 'gen:s2:springs'));
  const nSpr = ri(rs, S2.springs[0], S2.springs[1]);
  for (let k = 0; k < nSpr; k++) {
    const spots = rockSpots(L, depth, 3, S2.springDepth[0], S2.springDepth[1]);
    if (!spots.length) break;
    const c = spots[ri(rs, 0, spots.length - 1)], cx = c % W, cy = (c / W) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const m = Math.abs(dx) + Math.abs(dy);
      if (m > 2) continue;
      const i = idx(cx + dx, cy + dy);
      L.terrain[i] = m <= 1 ? TER.SHALLOW : TER.MOSS; L.ore[i] = 0; L.roof[i] = ROOF.MOUNTAIN;
    }
    out.springs++;
  }
  // the Old Crown vault: a sealed 7 x 5 room of worked marble walls at depth 10-20, a strongbox and
  // its loot (coins, a cut gem, a lore tablet: a named book until Stage 3's tablets)
  const rv = gen(fork(s, 'gen', 'gen:s2:vault'));
  const vs = rockSpots(L, depth, 5, S2.vaultDepth[0], S2.vaultDepth[1]);
  if (vs.length) {
    const c = vs[ri(rv, 0, vs.length - 1)], cx = c % W, cy = (c / W) | 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -4; dx <= 4; dx++) {
      const i = idx(cx + dx, cy + dy);
      L.terrain[i] = TER.ROUGH; L.ore[i] = 0; L.mat[i] = stoneId('marble') || L.mat[i]; L.roof[i] = ROOF.MOUNTAIN;
      if (Math.abs(dx) === 4 || Math.abs(dy) === 3) s.bld.push(newBuilding(s.bld.length, 'wall', cx + dx, cy + dy, 0, 'marble', { st: 'done', name: 'Old Crown wall' }));
    }
    if (structDef('strongbox')) s.bld.push(newBuilding(s.bld.length, 'strongbox', cx, cy, 0, null, { st: 'done', name: 'Sealed chest' }));
    out.loot.push(['coins', null, 60, cx - 2, cy], ['cutgem', null, 2, cx + 2, cy], ['book', null, 1, cx, cy - 1, 'Old Crown tablet']);
    out.vault = { x: cx, y: cy };
  }
  // surface ruins: broken 5 x 5 watchtower rings of granite, far from the site, with a little loot
  const rr = gen(fork(s, 'gen', 'gen:s2:ruins'));
  for (let tries = 0; tries < 200 && out.ruins < S2.ruins; tries++) {
    const cx = ri(rr, 4, W - 5), cy = ri(rr, 4, H - 5);
    if (Math.max(Math.abs(cx - hcx), Math.abs(cy - hcy)) < S2.ruinFar) continue;
    let ok = true;
    for (let dy = -3; dy <= 3 && ok; dy++) for (let dx = -3; dx <= 3 && ok; dx++) {
      const i = idx(cx + dx, cy + dy);
      if (!TER_BUILDABLE[L.terrain[i]] || L.terrain[i] === TER.ROCK || TER_WATER[L.terrain[i]] || s.bld.some((b) => b && b.x === cx + dx && b.y === cy + dy)) ok = false;
    }
    if (!ok) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      const i = idx(cx + dx, cy + dy);
      L.plant[i] = 0; L.growth[i] = 0;
      if (rf(rr) < 0.35) continue;                                   // fallen stones: gaps in the ring
      s.bld.push(newBuilding(s.bld.length, 'wall', cx + dx, cy + dy, 0, 'granite', { st: 'done', hp: 120 + ri(rr, 0, 200), name: 'Ruined wall' }));
    }
    out.loot.push(['block', 'granite', 10 + ri(rr, 0, 10), cx, cy], ['coins', null, 8 + ri(rr, 0, 12), cx + 1, cy]);
    out.ruins++;
  }
  // the starting blight (3.1): about 6% of the open land, away from the site
  // two caverns cut into each other can leave a hall too wide: natural pillars where a roofed open
  // tile has no rock within SUPPORT_RADIUS (built walls count; index order, like cavernPass)
  const wallAt = new Uint8Array(N);
  for (const b of s.bld) if (b && b.def === 'wall') wallAt[idx(b.x, b.y)] = 1;
  const R = SUPPORT_RADIUS;
  for (let i = 0; i < N; i++) {
    if (L.terrain[i] === TER.ROCK || L.roof[i] !== ROOF.MOUNTAIN || wallAt[i]) continue;
    const x = i % W, y = (i / W) | 0;
    let ok = false;
    for (let dy = -R; dy <= R && !ok; dy++) for (let dx = -R; dx <= R && !ok; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) { ok = true; break; }
      const j = yy * W + xx;
      if (L.terrain[j] === TER.ROCK || wallAt[j]) ok = true;
    }
    if (!ok) { L.terrain[i] = TER.ROCK; L.plant[i] = 0; L.growth[i] = 0; out.pillars = (out.pillars | 0) + 1; }
  }
  const rb = gen(fork(s, 'gen', 'gen:s2:blight'));
  out.blight = seedBlight(L, hcx, hcy, () => rf(rb));
  return out;
}

/**
 * The new-colony world: map, the Hearth (s.bld[0], s.colony.hearth), runtime caches and the opening
 * reveal around the Hearth. Call on a fresh createColony(seed) state. Returns the generation info.
 */
export function generateWorld(s, opts = {}) {
  installWorld();
  const info = generateMap(s, opts);
  const h = info.hearth;
  if (structDef('hearth') && !s.bld.some((b) => b && b.def === 'hearth')) {
    const id = s.bld.length;
    s.bld.push(newBuilding(id, 'hearth', h.x, h.y, 0, null, { st: 'done' }));
    s.colony.hearth.id = id;
  }
  initRuntime(s);
  if (info.stage2) for (const [k, m, n, x, y, name] of info.stage2.loot) spawnItem(s, k, m, 0, n, x, y, name ? { name } : {});
  revealAround(s, idx(h.cx, h.cy), Math.round(GEN.site.revealR * Math.max(Math.min(W, H) / 128, 0.5)), true);
  s.rt.dirty.light = true; // the first endOfTick lights the Hearth (initRuntime already rebuilt it)
  info.spawn = startSpots(s, 3);
  return info;
}

/** n open tiles next to the Hearth for the starting band (deterministic ring order). */
export function startSpots(s, n = 3) {
  const h = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
  const cx = h ? h.x + 1 : W >> 1, cy = h ? h.y + 1 : H >> 1;
  const out = [];
  for (let r = 2; r < 10 && out.length < n; r++) {
    for (let dy = -r; dy <= r && out.length < n; dy++) for (let dx = -r; dx <= r && out.length < n; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || ((dx + dy) & 1)) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = idx(x, y);
      if (s.rt.walkCost[i] && s.rt.walkCost[i] < 15 && !s.L.plant[i]) out.push(i);
    }
  }
  return out;
}

// ---- Step 10: spawn edges -------------------------------------------------------------------------------
/**
 * Entry segments on each map edge: border tiles a colonist could walk to from the Hearth, split
 * into up to GEN.edges.segMax segments per edge (at least segLen tiles each where the land allows).
 * @returns {{ edge: 'n'|'e'|'s'|'w', tiles: number[] }[]} in edge order n, e, s, w; tiles in border order
 */
export function spawnEdges(s, side = 0) {
  const h = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
  let ref = 0;
  if (h) {
    for (let dy = -1; dy <= 3 && !ref; dy++) for (let dx = -1; dx <= 3 && !ref; dx++) {
      const x = h.x + dx, y = h.y + dy;
      if (x >= 0 && y >= 0 && x < W && y < H) ref = compOf(s, idx(x, y), side);
    }
  }
  const G = GEN.edges, out = [];
  const lines = {
    n: Array.from({ length: W }, (_, x) => idx(x, 0)), e: Array.from({ length: H }, (_, y) => idx(W - 1, y)),
    s: Array.from({ length: W }, (_, x) => idx(x, H - 1)), w: Array.from({ length: H }, (_, y) => idx(0, y)),
  };
  for (const edge of ['n', 'e', 's', 'w']) {
    const runs = [];
    let cur = null;
    for (const i of lines[edge]) {
      const ok = ref ? compOf(s, i, side) === ref : compOf(s, i, side) !== 0;
      if (ok) { if (!cur) runs.push((cur = [])); cur.push(i); } else cur = null;
    }
    const total = runs.reduce((a, r) => a + r.length, 0);
    if (!total) continue;
    const segLen = Math.max(G.segLen, Math.ceil(total / G.segMax));
    const segs = [];
    for (const r of runs) for (let k = 0; k < r.length; k += segLen) segs.push(r.slice(k, Math.min(r.length, k + segLen)));
    // merge the shortest neighbours until at most segMax remain
    while (segs.length > G.segMax) {
      let best = 0;
      for (let k = 1; k < segs.length; k++) if (segs[k].length < segs[best].length) best = k;
      const j = best === 0 ? 1 : best === segs.length - 1 ? best - 1 : segs[best - 1].length <= segs[best + 1].length ? best - 1 : best + 1;
      const a = Math.min(best, j);
      segs.splice(a, 2, segs[a].concat(segs[a + 1]));
    }
    for (const t of segs) out.push({ edge, tiles: t });
  }
  return out;
}
