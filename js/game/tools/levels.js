// Level helpers for the UI (owner I; EMBERCROWN-FORTRESS.md 4.1-4.5, Stage Z1 step E7). Pure: they read the
// colony and return plain data for js/ui/levels.js (the capsule, the depth ruler, the ghost column) and the
// tools (toolbar.js). No DOM, no clocks, never a write: the view level is UI memory (cam.level), not sim state.
//   levelText(z)              "-3", "0", "+2" (relative to the surface zS)
//   levelSummary(s)           per level: colonists, hostiles, pending work (designations, vertical digs and
//                             blueprints), known (any known or explored voxel), solid (a known non-AIR voxel)
//   exploredRange(sum)        { lo, hi, deepest }: the navigation limits of 4.1 (lo = deepest known level - 1)
//   interestingLevels(sum, extra)  the detent levels: colonists, work, alerts, the surface, the deepest dig
//   nextInteresting(set, z, dir, lo, hi)  hold on the arrows: the next interesting level that way
//   rulerRows(sum, range)     the depth ruler's rows, top first, unexplored runs folded into one row
//   Scrub                     the chip's relative scrub: acceleration and detents (pt of travel -> levels)
//   stackPlan(s, rect, z, kind, levels, dir)  the levels a Stairs, Channel or Mine stack reaches, with the stop
//   toolLevels(s, kind)       the levels holding designations of one tool (the ghost column)
//   nearestStair(s, z, x, y)  the nearest stair or ramp voxel on level z
import { W, D, PLANE, zS, TER, DESIG, TER_MINEABLE, idx, inB } from '../core/grid.js';
import { vdigList, VD_NAMES } from '../work/vdig.js';

/** The relative level as the chip shows it: "-3", "0", "+2". */
export function levelText(z) { const r = z - zS; return r > 0 ? `+${r}` : String(r); }
const isStair = (t) => t === TER.STAIR_U || t === TER.STAIR_D || t === TER.STAIR_UD || t === TER.RAMP || t === TER.RAMP_TOP;

/**
 * Per-level counts for the capsule badges, the ruler and the detents. About 0.4 ms at D = 20 (two bitset
 * scans and one pass over the designation layer); the UI calls it once a second, not per frame.
 * @returns {{ d, col: Int16Array, foe: Int16Array, work: Int32Array, known: Uint8Array, solid: Uint8Array, dug: Uint8Array }}
 */
export function levelSummary(s) {
  const d = D, L = s.L;
  const col = new Int16Array(d), foe = new Int16Array(d), work = new Int32Array(d), known = new Uint8Array(d), solid = new Uint8Array(d), dug = new Uint8Array(d);
  for (const c of s.col) if (c && !(c.hp && c.hp.dead)) { const z = c.z | 0; if (z >= 0 && z < d) col[z]++; }
  if (s.foes) for (const f of s.foes) if (f) { const z = f.z | 0; if (z >= 0 && z < d) foe[z]++; }
  const kb = L.known, fb = L.fog, bytes = PLANE >> 3, ter = L.terrain;
  for (let z = 0; z < d; z++) {
    const b0 = z * bytes;
    let any = 0, sol = 0, walk = 0;
    for (let k = 0; k < bytes; k++) {
      const v = (kb ? kb[b0 + k] : 0) | (fb ? fb[b0 + k] : 0);
      if (!v) continue;
      any = 1;
      if (sol && walk) break;
      for (let bit = 0; bit < 8; bit++) {
        if (!((v >> bit) & 1)) continue;
        const t = ter[(b0 + k) * 8 + bit];
        if (t !== TER.AIR) sol = 1;
        if (z < zS && !TER_MINEABLE[t] && t !== TER.AIR && t !== TER.VOID) walk = 1;   // an opened voxel below the surface
      }
    }
    known[z] = any; solid[z] = sol; dug[z] = walk;
  }
  const dz = L.desig;
  for (let z = 0; z < d; z++) {
    let n = 0;
    for (let i = z * PLANE, e = i + PLANE; i < e; i++) if (dz[i] & (DESIG.MINE | DESIG.CHOP | DESIG.HARVEST | DESIG.SMOOTH | DESIG.ENGRAVE)) n++;
    work[z] = n;
  }
  for (const [i] of vdigList(s)) { const z = (i / PLANE) | 0; if (z < d) work[z]++; }
  for (const b of s.bld) if (b && b.st !== 'done') { const z = b.z | 0; if (z >= 0 && z < d) work[z]++; }
  return { d, col, foe, work, known, solid, dug };
}

/**
 * The navigation limits (4.1): down stops at the deepest level with a known voxel, plus 1; up stops at the
 * highest level holding a known non-AIR voxel. The surface is always inside. deepest: the deepest dig (the
 * lowest level below the surface with an opened, known voxel), or null.
 */
export function exploredRange(sum) {
  let lo = zS, hi = zS, deepest = null;
  for (let z = 0; z < sum.d; z++) if (sum.known[z] || sum.col[z]) { lo = Math.min(lo, z); break; }
  for (let z = sum.d - 1; z >= 0; z--) if (sum.solid[z] || sum.col[z]) { hi = Math.max(hi, z); break; }
  for (let z = 0; z < zS; z++) if (sum.dug[z] || sum.col[z]) { deepest = z; break; }
  return { lo: Math.max(0, lo - 1), hi, deepest };
}

/** The interesting levels (hold on an arrow, the scrub's detents): colonists, work, alerts, the surface, the deepest dig. */
export function interestingLevels(sum, extra = []) {
  const out = new Set([zS]);
  for (let z = 0; z < sum.d; z++) if (sum.col[z] || sum.foe[z] || sum.work[z]) out.add(z);
  const r = exploredRange(sum);
  if (r.deepest !== null) out.add(r.deepest);
  for (const z of extra) if (z >= 0 && z < sum.d) out.add(z);
  return out;
}
/** The next interesting level from z in direction dir (+1 up, -1 down) inside [lo, hi]; the end of the range when none. */
export function nextInteresting(set, z, dir, lo, hi) {
  for (let k = z + dir; k >= lo && k <= hi; k += dir) if (set.has(k)) return k;
  return dir > 0 ? hi : lo;
}

/**
 * The depth ruler's rows, top first (4.1): one row per explored level from hi down to lo; a run of levels
 * with no known voxel between them folds into one row; the levels below lo fold into a last row.
 * Row: { kind: 'level', z } | { kind: 'fold', top, bottom, n } (top >= bottom; folds are not targets).
 */
export function rulerRows(sum, range) {
  const rows = [];
  let run = null;
  const flush = () => { if (run) { rows.push({ kind: 'fold', top: run.top, bottom: run.bottom, n: run.top - run.bottom + 1 }); run = null; } };
  for (let z = range.hi; z >= range.lo; z--) {
    const open = sum.known[z] || sum.col[z] || z === zS || z === range.lo || z === range.hi;
    if (open) { flush(); rows.push({ kind: 'level', z }); }
    else if (run) run.bottom = z; else run = { top: z, bottom: z };
  }
  flush();
  if (range.lo > 0) rows.push({ kind: 'fold', top: range.lo - 1, bottom: 0, n: range.lo });
  return rows;
}

/**
 * The relative scrub of the level chip (4.1): 1 level per `slow` pt of travel, 1 per `fast` pt above
 * `fastSpeed` pt/s; at a detent level the scrub holds for `hold` pt of travel. A finger moving up (dy < 0)
 * goes up a level. Pure: feed it (dy, dt) and it returns the level.
 */
export class Scrub {
  constructor(z, lo, hi, detents = new Set(), o = {}) {
    this.z = z; this.lo = lo; this.hi = hi; this.detents = detents;
    this.slow = o.slow || 20; this.fast = o.fast || 8; this.fastSpeed = o.fastSpeed || 300; this.holdPt = o.hold || 12;
    this.acc = 0; this.hold = 0; this.snapped = false;
  }
  /** Travel dy pt (screen; down is positive) over dtMs. Returns the level after it. */
  move(dy, dtMs) {
    const speed = dtMs > 0 ? Math.abs(dy) / (dtMs / 1000) : 0;
    const step = speed > this.fastSpeed ? this.fast : this.slow;
    let left = Math.abs(dy);
    const dir = dy < 0 ? 1 : -1;
    this.snapped = false;
    if (Math.sign(this.acc) !== 0 && Math.sign(this.acc) !== Math.sign(-dir)) this.acc = 0;   // turned round: start the step afresh
    while (left > 0) {
      if (this.hold > 0) { const u = Math.min(this.hold, left); this.hold -= u; left -= u; continue; }
      const need = step - Math.abs(this.acc), u = Math.min(need, left);
      this.acc += u * -dir; left -= u;
      if (Math.abs(this.acc) >= step) {
        this.acc = 0;
        const nz = this.z + dir;
        if (nz < this.lo || nz > this.hi) { left = 0; break; }
        this.z = nz;
        if (this.detents.has(nz)) { this.hold = this.holdPt; this.snapped = true; }
      }
    }
    return this.z;
  }
}

/**
 * The levels a stack reaches from (rect, z) (4.4): Stairs, Channel and Mine with a Levels count. levels: the
 * number of levels including z (Stairs "Down 3" is 4); dir 'down' | 'up' (Channel is always down). A column
 * stops at the map edge, a fluid voxel or unmineable greystone; the stack ends at the first level where any
 * column stops (the red end mark).
 * @returns {{ zs: number[], voxels: number, stop: number | null, w: number, h: number }}
 */
export function stackPlan(s, rect, z, kind, levels, dir = 'down') {
  const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1), y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const up = dir === 'up' && kind !== 'channel';
  const zs = [];
  let stop = null;
  const L = s.L;
  for (let k = 0; k < Math.max(1, levels | 0); k++) {
    const zz = up ? z + k : z - k;
    if (zz < 0 || zz >= D) { stop = zz < 0 ? 0 : D - 1; break; }
    let blocked = false;
    for (let y = y0; y <= y1 && !blocked; y++) for (let x = x0; x <= x1; x++) {
      if (!inB(x, y, zz)) { blocked = true; break; }
      const i = idx(x, y, zz), t = L.terrain[i];
      if ((L.fluid && L.fluid[i]) || t === TER.VOID || t === TER.DEEP) { blocked = true; break; }
    }
    if (blocked) { stop = zz; break; }
    zs.push(zz);
  }
  return { zs, voxels: zs.length * w * h, stop, w, h };
}
/** "3 x 3 · 4 levels · 36 voxels" (the loupe line of a stack, 4.4). */
export function stackLabel(p) {
  const n = p.zs.length;
  return `${p.w} x ${p.h} · ${n} ${n === 1 ? 'level' : 'levels'} · ${p.voxels} ${p.voxels === 1 ? 'voxel' : 'voxels'}${p.stop !== null ? ' · stops at ' + levelText(p.stop) : ''}`;
}

/** The levels holding designations of one tool (the ghost column, 4.4): 'mine' and 'carve' read the Mine bit, the rest the vertical digs. */
export function toolLevels(s, kind) {
  const out = new Set();
  if (kind === 'mine' || kind === 'carve') {
    const dz = s.L.desig;
    for (let z = 0; z < D; z++) for (let i = z * PLANE, e = i + PLANE; i < e; i++) if (dz[i] & DESIG.MINE) { out.add(z); break; }
    return out;
  }
  const want = VD_NAMES[kind];
  if (!want) return out;
  for (const [i, k] of vdigList(s)) if (k === want) out.add((i / PLANE) | 0);
  return out;
}

/** The nearest stair or ramp voxel on level z to tile (x, y), or null: { x, y, i }. */
export function nearestStair(s, z, x, y) {
  const ter = s.L.terrain, b = z * PLANE;
  let best = null, bd = Infinity;
  for (let p = 0; p < PLANE; p++) {
    if (!isStair(ter[b + p])) continue;
    const px = p % W, py = (p / W) | 0, d = (px - x) * (px - x) + (py - y) * (py - y);
    if (d < bd) { bd = d; best = { x: px, y: py, i: b + p }; }
  }
  return best;
}
/** Can a mover on voxel i go up (or down) a level here? (the stair peek's Go up / Go down) */
export function stairDirs(s, i) {
  const t = s.L.terrain[i];
  const upOk = (t === TER.STAIR_U || t === TER.STAIR_UD || t === TER.RAMP) && i + PLANE < s.L.terrain.length;
  const downOk = (t === TER.STAIR_D || t === TER.STAIR_UD || t === TER.RAMP_TOP) && i - PLANE >= 0;
  return { up: upOk, down: downOk };
}
