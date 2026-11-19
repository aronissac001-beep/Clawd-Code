// ============================================================================
// ZONEFALL — local navigation for NPCs, animals and AI survivors.
//
// steer() in ai.js walks straight at its target while the way is clear (two
// look-ahead rays + a floor-continuity check, cached for a moment). When the
// line is blocked, the target is on another floor, or the walker is stuck, it
// asks Nav for a path: a weighted A* over a 0.5 m grid in a window around the
// walker and the goal (at most 40 x 40 m), "2.5D" — every grid node carries a
// floor height from Build.floorY, so stairs (ramps), foundations, floors
// upstairs and monument stairs just work; steps up more than ~0.9 m are walls,
// drops of up to ~4.5 m are allowed (at a cost); ladders are extra edges from
// their foot to the floor at their top. Colliders are tested with their height
// band at the node's height, doors the walker may open count as open.
// Searches are budgeted (a few per frame) and capped in expansions, so dozens
// of actors stay cheap; the path is string-pulled to a few waypoints.
// ============================================================================
import { G } from './state.js';
import { Build, bandHit } from './build.js';
import { canOpen } from './doors.js';
import { Heap, clamp } from './util.js';

const GS = 0.5;          // grid step (m)
const MAXC = 80;         // max cells per side of a search window (40 m)
const NB = 8;            // height buckets per cell (1.4 m each: three storeys fit)
const SIZE = MAXC * MAXC * NB;
const gCost = new Float32Array(SIZE), hAt = new Float32Array(SIZE), par = new Int32Array(SIZE), lad = new Int16Array(SIZE);
const seen = new Uint32Array(SIZE), closed = new Uint32Array(SIZE), evS = new Uint32Array(SIZE), evH = new Float32Array(SIZE);
let stamp = 1;
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

/** a collider filter for walker a standing at height y (doors it may open don't count) */
export function blocks(a, y) {
  return c => c.solid && !c.off && bandHit(c, y) && !(c.kind === 'door' && c.ref && canOpen(c.ref, a));
}

export const Nav = {
  stats: { searches: 0, expanded: 0, ms: 0 },
  /** a few searches per frame, shared by everyone */
  budgetOk() { if (this.bt !== G.t) { this.bt = G.t; this.left = 1; } return this.left-- > 0; }, // one search a frame (a long one is ~10-18 ms on a phone)
  /**
   * path from (sx,sz,sy) to (tx,tz,ty) for walker a: { pts: [{x,z,y,ladder?,up?}], partial } or null.
   * opt.r: how close counts as there (default 0.9), opt.maxExp: expansion cap.
   */
  findPath(a, sx, sz, sy, tx, tz, ty, opt = {}) {
    // a small window first; if it is a dead end (a long wall, a big building), look wider
    let r = null;
    for (const pad of [6, 14, 22]) { r = this.search(a, sx, sz, sy, tx, tz, ty, opt, pad); if (!r.exhausted) break; }
    return r.res;
  },
  search(a, sx, sz, sy, tx, tz, ty, opt, pad) {
    const t0 = performance.now(); this.stats.searches++;
    const span = (MAXC - 1) * GS;
    let x0 = Math.min(sx, tx) - pad, x1 = Math.max(sx, tx) + pad, z0 = Math.min(sz, tz) - pad, z1 = Math.max(sz, tz) + pad;
    // too big: centre the window between the walker and the goal (or on the walker, for a far goal)
    if (x1 - x0 > span) { const m = Math.abs(tx - sx) < span - 8 ? (sx + tx) / 2 : sx + Math.sign(tx - sx) * (span / 2 - 4); x0 = m - span / 2; x1 = m + span / 2; }
    if (z1 - z0 > span) { const m = Math.abs(tz - sz) < span - 8 ? (sz + tz) / 2 : sz + Math.sign(tz - sz) * (span / 2 - 4); z0 = m - span / 2; z1 = m + span / 2; }
    const ox = Math.floor(x0 / GS) * GS, oz = Math.floor(z0 / GS) * GS;
    const W = Math.min(MAXC, Math.ceil((x1 - ox) / GS) + 1), H = Math.min(MAXC, Math.ceil((z1 - oz) / GS) + 1);
    const gx = clamp(tx, ox + GS, ox + (W - 1) * GS), gz = clamp(tz, oz + GS, oz + (H - 1) * GS);
    const partialGoal = Math.abs(gx - tx) > 0.01 || Math.abs(gz - tz) > 0.01;
    const yb0 = Math.min(sy, ty) - 1.6;
    const bk = h => clamp(Math.floor((h - yb0) / 1.4), 0, NB - 1);
    const idx = (i, j, b) => (j * W + i) * NB + b;
    const cx = i => ox + (i + 0.5) * GS, cz = j => oz + (j + 0.5) * GS;
    stamp++; if (stamp > 4e9) { stamp = 1; seen.fill(0); closed.fill(0); evS.fill(0); }
    let curH = sy; const filt = c => c.solid && !c.off && bandHit(c, curH) && !(c.kind === 'door' && c.ref && canOpen(c.ref, a));
    const walk = G.W.walkable;
    // floor height of cell (i,j) for someone arriving at height fromH (NaN = blocked); cached per search
    const evalCell = (i, j, fromH) => {
      const k = idx(i, j, bk(fromH)); if (evS[k] === stamp) return evH[k];
      const x = cx(i), z = cz(j); let h = Build.floorY(x, z, fromH + 0.05);
      curH = h; let ok = !G.phys.overlaps(x, z, 0.26, filt);
      if (ok && !walk(x, z) && h < G.W.height(x, z) + 0.3) ok = false;
      evS[k] = stamp; evH[k] = ok ? h : NaN; return evH[k];
    };
    // ladders in the window: extra edges (foot <-> top)
    const ladders = Build.ladders(), ladMap = new Map(), ladList = [];
    for (const d of ladders) {
      const f = Build.ladderFoot(d, 0.5), e = Build.ladderExit(d);
      const fi = Math.floor((f.x - ox) / GS), fj = Math.floor((f.z - oz) / GS), ei = Math.floor((e.x - ox) / GS), ej = Math.floor((e.z - oz) / GS);
      if (fi < 0 || fj < 0 || fi >= W || fj >= H || ei < 0 || ej < 0 || ei >= W || ej >= H) continue;
      const id = ladList.length; ladList.push(d); const h = d.state.top - d.state.y0;
      const add = (ci, from, ti, tj, toH, up) => { if (!ladMap.has(ci)) ladMap.set(ci, []); ladMap.get(ci).push({ from, ti, tj, toH, up, id, cost: 1.5 + h * 1.2 }); };
      add(fj * W + fi, d.state.y0, ei, ej, d.state.top, true); add(ej * W + ei, d.state.top, fi, fj, d.state.y0, false);
    }
    const heap = new Heap();
    const si = clamp(Math.floor((sx - ox) / GS), 0, W - 1), sj = clamp(Math.floor((sz - oz) / GS), 0, H - 1);
    const heur = (i, j, h) => (Math.hypot(cx(i) - gx, cz(j) - gz) + Math.abs(h - ty) * 0.8) * 1.25;
    const s0 = idx(si, sj, bk(sy)); seen[s0] = stamp; gCost[s0] = 0; hAt[s0] = sy; par[s0] = -1; lad[s0] = -1; heap.push(s0, heur(si, sj, sy));
    const R = opt.r ?? 0.9, maxExp = opt.maxExp ?? 1200; let n = 0, goal = -1, best = s0, bestH = heur(si, sj, sy);
    while (heap.size) {
      const k = heap.pop(); if (closed[k] === stamp) continue; closed[k] = stamp;
      const b = k % NB, c = (k - b) / NB, i = c % W, j = (c - i) / W, h = hAt[k];
      if (Math.hypot(cx(i) - gx, cz(j) - gz) < R && Math.abs(h - ty) < 1.2) { goal = k; break; }
      const hh = heur(i, j, h); if (hh < bestH) { bestH = hh; best = k; }
      if (++n > maxExp) break;
      for (const [di, dj, w] of N8) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const h2 = evalCell(ni, nj, h); if (h2 !== h2) continue;
        if (di && dj) { const ha = evalCell(i + di, j, h), hb = evalCell(i, j + dj, h); if (ha !== ha || hb !== hb) continue; }
        const dh = h2 - h; if (dh > 0.95) continue;
        let cost = w * GS; if (dh < -1.3) { if (dh < -4.5) continue; cost += 2 - dh; }
        const nk = idx(ni, nj, bk(h2)); const ng = gCost[k] + cost;
        if (seen[nk] !== stamp || ng < gCost[nk]) { seen[nk] = stamp; gCost[nk] = ng; hAt[nk] = h2; par[nk] = k; lad[nk] = -1; heap.push(nk, ng + heur(ni, nj, h2)); }
      }
      const L = ladMap.get(c);
      if (L) for (const e of L) {
        if (Math.abs(h - e.from) > 0.9) continue;
        const nk = idx(e.ti, e.tj, bk(e.toH)); const ng = gCost[k] + e.cost;
        if (seen[nk] !== stamp || ng < gCost[nk]) { seen[nk] = stamp; gCost[nk] = ng; hAt[nk] = e.toH; par[nk] = k; lad[nk] = e.id * 2 + (e.up ? 1 : 0); heap.push(nk, ng + heur(e.ti, e.tj, e.toH)); }
      }
    }
    this.stats.expanded += n; this.stats.ms += performance.now() - t0;
    let end = goal, partial = partialGoal;
    const exhausted = goal < 0 && n <= maxExp && (W < MAXC || H < MAXC); // ran out of window, not of effort
    if (end < 0) { if (best === s0) return { res: null, exhausted }; end = best; partial = true; }
    const pts = [];
    for (let k = end; k >= 0; k = par[k]) {
      const b = k % NB, c = (k - b) / NB, i = c % W, j = (c - i) / W; const p = { x: cx(i), z: cz(j), y: hAt[k] };
      if (lad[k] >= 0) { p.ladder = ladList[lad[k] >> 1]; p.up = !!(lad[k] & 1); }
      pts.push(p); if (par[k] < 0) break;
    }
    pts.reverse(); pts[0] = { x: sx, z: sz, y: sy };
    if (!partial && pts.length) { const last = pts[pts.length - 1]; if (!last.ladder && Math.abs(last.y - ty) < 0.6) pts.push({ x: tx, z: tz, y: ty }); }
    return { res: { pts: this.smooth(a, pts), partial }, exhausted };
  },
  /** string-pull: keep only the waypoints needed to walk straight between them */
  smooth(a, pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]]; let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 16);
      for (let k = i + 1; k <= j; k++) if (pts[k].ladder) { j = k; break; }
      while (j > i + 1 && (pts[j].ladder || !this.walkLine(a, pts[i], pts[j]))) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  },
  /** can a walker go straight from p to q (both on floors)? samples every 0.35 m */
  walkLine(a, p, q) {
    const L = Math.hypot(q.x - p.x, q.z - p.z); const n = Math.max(1, Math.ceil(L / 0.35)); let h = p.y;
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t;
      const fh = Build.floorY(x, z, h + 0.05); if (fh - h > 0.95 || h - fh > 0.6) return false;
      if (G.phys.overlaps(x, z, 0.3, blocks(a, fh))) return false;
      h = fh;
    }
    return Math.abs(h - q.y) < 0.6;
  },
  /** is the straight line from a to (tx,tz) walkable? (two rays a body-width apart + no big steps or drops) */
  lineClear(a, tx, tz, ty) {
    const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz); if (d < 0.8) return true;
    const f = blocks(a, a.y ?? 0), nx = -dz / d * 0.28, nz = dx / d * 0.28;
    for (const s of [-1, 1]) if (G.phys.raycast(a.x + nx * s, a.z + nz * s, tx + nx * s, tz + nz * s, f)) return false;
    const n = Math.min(14, Math.ceil(d / 1.5)); let h = a.y ?? 0;
    for (let k = 1; k <= n; k++) { const t = k / n, fh = Build.floorY(a.x + dx * t, a.z + dz * t, h + 0.3); if (fh - h > 0.95 || h - fh > 1.3) return false; h = fh; }
    if (ty !== undefined && Math.abs(h - ty) > 1.2) return false;
    return true;
  },
  /** the next point to head for along a planned path (plans / replans as needed); 'climb' while starting a ladder */
  follow(a, N, tx, tz, ty) {
    const moved = !N.path || Math.hypot((N.gx ?? 1e9) - tx, (N.gz ?? 1e9) - tz) > 1.5 || Math.abs((N.gy ?? ty) - ty) > 1.2;
    const done = N.path && N.pi >= N.path.length;
    if (((moved || done || N.replan) && G.t - (N.planT ?? -9) > 0.45) || (moved && !N.path)) {
      if (this.budgetOk()) {
        const p = this.findPath(a, a.x, a.z, a.y ?? 0, tx, tz, ty, { r: N.r ?? 0.9 });
        N.planT = G.t; N.replan = false; N.gx = tx; N.gz = tz; N.gy = ty;
        if (p && p.pts.length > 1) { N.path = p.pts; N.pi = 1; N.partial = p.partial; N.fails = 0; } else { N.path = null; N.fails = (N.fails || 0) + 1; }
      }
    }
    if (!N.path) return null;
    while (N.pi < N.path.length) {
      const w = N.path[N.pi]; if (w.ladder) break;
      if (Math.hypot(w.x - a.x, w.z - a.z) < 0.55 && Math.abs(w.y - (a.y ?? 0)) < 1.0) N.pi++; else break;
    }
    if (N.pi >= N.path.length) { if (N.partial) N.replan = true; return null; }
    const w = N.path[N.pi];
    if (w.ladder) {
      const L = w.ladder; if (L.dead) { N.path = null; return null; }
      const st = w.up ? Build.ladderFoot(L, 0.45) : Build.ladderExit(L);
      if (Math.hypot(st.x - a.x, st.z - a.z) < 0.6) { a.climb = { d: L, dir: w.up ? 1 : -1, y: w.up ? L.state.y0 : L.state.top }; N.pi++; return 'climb'; }
      return { x: st.x, z: st.z, y: w.up ? L.state.y0 : L.state.top };
    }
    return w;
  },
  /** an NPC on a ladder: up or down at a steady pace, then step off */
  climbStep(a, dt) {
    const C = a.climb, d = C && C.d; if (!d || d.dead) { a.climb = null; return; }
    const fx = Math.cos(d.ry), fz = Math.sin(d.ry);
    a.x = d.x - fx * 0.3; a.z = d.z - fz * 0.3; a.ang = d.ry; a.speedNow = 1.2;
    C.y += C.dir * 1.7 * dt; a.y = C.y;
    if (C.dir > 0 && C.y >= d.state.top) { const e = Build.ladderExit(d); a.x = e.x; a.z = e.z; a.y = d.state.top; a.climb = null; }
    else if (C.dir < 0 && C.y <= d.state.y0) { const f = Build.ladderFoot(d, 0.75); a.x = f.x; a.z = f.z; a.y = Build.floorY(f.x, f.z, d.state.y0 + 0.3); a.climb = null; }
  },
};
G.nav = Nav; // tests / debugging
