// The Stage Z1 E3 bench scenes (EMBERCROWN-FORTRESS.md 8.3 E3, 6.0, 6.2; run by tools/bench.mjs):
//   maze3d   the prototype's 128 x 128 x 20 fortress (tools/lib/maze3d.mjs): 400 seeded pairs in the Hearth's
//            component. Plain 3D A* (the optimum, E2) against link-heuristic A* (each search with a cold link
//            Dijkstra for its goal, as a new goal costs; a pair's time is the fastest of 3 cold rounds): same
//            reachability, cost ratio mean <= 1.08 and p95 <= 1.15, link A* p95 < 0.6 ms, max expansions
//            < 4,000, 0 over the 8,192 cap. Reported: the fully settled link Dijkstra (p95 per run, and the
//            batched mean of 100 runs per sample that 6.0 asks for), the region full rebuild (6.2: < 4.5 ms) and
//            64 dirty clusters (6.2: < 0.5 ms), both label sets and both graphs.
//   miners6  6 miners tunnelling non-stop through the maze3d rock for 2 game hours (1,200 ticks): each dig asks
//            a path to its next face through the saved queue from a seeded spot of the Hearth level (back from
//            a haul; ADJ4 goal: a new goal and a cold link Dijkstra per dig), then mines it. Link Dijkstra time per tick
//            p95 < 0.3 ms (over all ticks, and also reported over the ticks that built one), fewer than 1
//            linkStamp bump per 8 mined voxels. Only the regions pass runs at the tick end (the rest is E4's).
import { maze3dColony } from './maze3d.mjs';
import { N, W, H, PLANE, CLUSTERS, TILE, TER } from '../../js/game/core/grid.js';
import { installWorld, mineTile } from '../../js/game/world/terrain.js';
import { installMovement, findPath, GOAL, searchCap, requestPath, pathSystem, pathReady } from '../../js/game/systems/pathing.js';
import { compOf, regionsPass, relabelAll, updateGraph, labelClusterBoth, lastHostileCount } from '../../js/game/world/regions.js';
import { linkDijkstra, linkSettleAll, linkStats, setLinkClock, linkCacheClear } from '../../js/game/world/regiongraph.js';
import { newDirty } from '../../js/game/core/rtcontract.js';
import { newColonist } from '../../js/game/core/schema.js';
import { mulberry32 } from '../../spike/z.mjs';

const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : 0; };
const r3 = (v) => +(+v).toFixed(3);
const now = () => performance.now();

export function runMaze3d() {
  installWorld(); installMovement();
  const { s, hearth } = maze3dColony(99);
  const lab = s.rt.region, g = s.rt.regionGraph.col;
  const hc = compOf(s, hearth), cand = [];
  for (let i = 0; i < N; i++) if (lab[i] && compOf(s, i) === hc) cand.push(i);
  const rng = mulberry32(7), pick = () => cand[(rng() * cand.length) | 0];
  const pairs = []; for (let k = 0; k < 400; k++) pairs.push([pick(), pick()]);
  const warm = []; for (let k = 0; k < 60; k++) warm.push([pick(), pick()]);
  const cap = searchCap();
  for (const [a, b] of warm) { findPath(s, a, b, GOAL.TILE, 0, 1e9, { heur: 'plain' }); findPath(s, a, b, GOAL.TILE, 0, cap); }
  // plain A*: the optimum
  const plain = pairs.map(([a, b]) => { const t0 = now(); const r = findPath(s, a, b, GOAL.TILE, 0, 1e9, { heur: 'plain' }); return { ...r, ms: now() - t0 }; });
  // link A*: a cold Dijkstra per search (a fresh link set identity each run: the table is rebuilt by value)
  const link = [], dij = [];
  // 3 rounds, each from a cold cache; a pair's time is its fastest round (a shared machine's preemption only
  // adds time; every round does the same work), as the maze scene's flow timing
  for (let rd = 0; rd < 3; rd++) {
    linkCacheClear();
    pairs.forEach(([a, b], k) => {
      const t0 = now(); const r = findPath(s, a, b, GOAL.TILE, 0, cap); const ms = now() - t0;
      if (rd === 0) link.push({ ...r, ms }); else if (ms < link[k].ms) link[k].ms = ms;
    });
  }
  // again with the Dijkstra clock on (a cold cache again; the clock adds its own overhead, so timed apart)
  linkCacheClear(); setLinkClock(now);
  for (const [a, b] of pairs) { const m0 = linkStats.ms; findPath(s, a, b, GOAL.TILE, 0, cap); dij.push(linkStats.ms - m0); }
  setLinkClock(null);
  let sameReach = 0, over = 0, maxExp = 0;
  const ratio = [], cross = [];
  pairs.forEach(([a, b], k) => {
    const p = plain[k], l = link[k];
    if ((p.status === 'ok' || p.status === 'here') === (l.status === 'ok' || l.status === 'here')) sameReach++;
    if (l.status === 'trunc') over++;
    if (l.expanded > maxExp) maxExp = l.expanded;
    ratio.push(p.cost ? l.cost / p.cost : 1);
    if (((a / PLANE) | 0) !== ((b / PLANE) | 0)) cross.push(l.ms);
  });
  // the link Dijkstra alone: per run (cold goal), and batched (100 runs per sample, 20 samples)
  const goals = cand.filter((_, k) => k % 7 === 3);
  let gi = 0;
  const one = [];
  for (let k = 0; k < 300; k++) { const t0 = now(); linkSettleAll(linkDijkstra(g, lab, goals[gi++ % goals.length], 0, 0)); one.push(now() - t0); }
  const batch = [];
  for (let k = 0; k < 20; k++) { const t0 = now(); for (let m = 0; m < 100; m++) linkSettleAll(linkDijkstra(g, lab, goals[gi++ % goals.length], 0, 0)); batch.push((now() - t0) / 100); }
  // regions: the full relabel of both sides with both graphs (what a load does), and 64 dirty clusters (relabel both sides + patch both graphs)
  const full = [];
  for (let k = 0; k < 8; k++) { const t0 = now(); relabelAll(s); full.push(now() - t0); }
  const mark = new Uint8Array(CLUSTERS), nc = new Uint8Array(CLUSTERS), nh = new Uint8Array(CLUSTERS), live = [];
  for (let c = 0; c < CLUSTERS; c++) if (g.nreg[c]) live.push(c);
  const dirty = [];
  for (let k = 0; k < 60; k++) {
    mark.fill(0);
    for (let m = 0; m < 64; m++) mark[live[(k * 64 + m) * 37 % live.length]] = 1;
    const t0 = now();
    for (let c = 0; c < CLUSTERS; c++) if (mark[c]) { nc[c] = labelClusterBoth(s.rt.walkCost, s.rt.region, s.rt.regionH, c); nh[c] = lastHostileCount(); }
    s.rt.regionGraph = { col: updateGraph(s.rt.regionGraph.col, s.rt.region, s.L.terrain, mark, nc), hos: updateGraph(s.rt.regionGraph.hos, s.rt.regionH, s.L.terrain, mark, nh) };
    if (k >= 20) dirty.push(now() - t0);           // 20 warm-ups
  }
  const P = (a) => r3(pct(a, 0.95));
  const r = {
    N, reachable: cand.length, links: g.links.length, vertLinks: [...g.links].filter((_, l) => g.tb[l] - g.ta[l] === PLANE).length, regionCount: g.regions,
    pairs: pairs.length, sameReach, crossLevel: cross.length,
    plain: { p95ms: P(plain.map((x) => x.ms)), expP95: pct(plain.map((x) => x.expanded), 0.95), expMax: Math.max(...plain.map((x) => x.expanded)) },
    link: { p50ms: r3(pct(link.map((x) => x.ms), 0.5)), p95ms: P(link.map((x) => x.ms)), maxms: r3(Math.max(...link.map((x) => x.ms))), p95CrossMs: P(cross), expP95: pct(link.map((x) => x.expanded), 0.95), expMax: maxExp, overCap: over, cap,
      dijInSearchP95ms: P(dij), costRatioMean: r3(ratio.reduce((x, y) => x + y, 0) / ratio.length), costRatioP95: r3(pct(ratio, 0.95)), costRatioMax: r3(Math.max(...ratio)) },
    dijkstra: { p95ms: P(one), batchedMeanMs: r3(batch.reduce((x, y) => x + y, 0) / batch.length), batchedP95ms: P(batch) },
    regions: { fullRebuildMs: r3(Math.min(...full)), dirty64P95ms: P(dirty) },
  };
  const fails = [];
  if (sameReach !== pairs.length) fails.push(`maze3d: reachability differs on ${pairs.length - sameReach} pairs`);
  if (r.link.costRatioMean > 1.08) fails.push(`maze3d: link cost ratio mean ${r.link.costRatioMean} > 1.08`);
  if (r.link.costRatioP95 > 1.15) fails.push(`maze3d: link cost ratio p95 ${r.link.costRatioP95} > 1.15`);
  if (r.link.p95ms >= 0.6) fails.push(`maze3d: link A* p95 ${r.link.p95ms} ms >= 0.6 ms`);
  if (maxExp >= 4000) fails.push(`maze3d: link A* max expansions ${maxExp} >= 4,000`);
  if (over) fails.push(`maze3d: ${over} link searches over the ${cap} cap`);
  // the 6.2 region budgets (both label sets and both graphs), reported until J retunes them for two sides
  const warns = [];
  // a goal's Dijkstra is lazy (it settles what its searches need: dijInSearchP95ms); the fully settled one is reported
  if (r.dijkstra.p95ms >= 0.3) warns.push(`maze3d: fully settled link Dijkstra p95 ${r.dijkstra.p95ms} ms >= 0.3 ms (6.2; lazy per search ${r.link.dijInSearchP95ms} ms)`);
  if (r.regions.fullRebuildMs >= 4.5) warns.push(`maze3d: region full rebuild (both sides) ${r.regions.fullRebuildMs} ms >= 4.5 ms (6.2)`);
  if (r.regions.dirty64P95ms >= 0.5) warns.push(`maze3d: 64 dirty clusters (both sides) ${r.regions.dirty64P95ms} ms >= 0.5 ms (6.2)`);
  return { r, fails, warns };
}

export function runMiners6({ ticks = 1200, digEvery = 20 } = {}) {
  installWorld(); installMovement();
  const { s, hearth } = maze3dColony(99);
  const rng = mulberry32(61);
  const walk = s.rt.walkCost, ter = s.L.terrain;
  // 6 miners on open floor of the Hearth level, spread around the Hearth
  const hz = (hearth / PLANE) | 0, base = hz * PLANE;
  const spots = [];
  for (let i = base; i < base + PLANE; i++) if (walk[i] && compOf(s, i) === compOf(s, hearth)) spots.push(i);
  const miners = [];
  for (let k = 0; k < 6; k++) {
    const at = spots[(k * 7919 + 17) % spots.length];
    const c = newColonist(k, { x: (at % W) * TILE + 16, y: (((at % PLANE) / W) | 0) * TILE + 16 });
    c.z = hz; s.col.push(c);
    miners.push({ id: k, at, dir: k % 4, wait: k * 3, target: -1 });
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  // next face: the rock voxel ahead of the miner's tunnel (turning on a seeded coin, or when blocked)
  const face = (m) => {
    for (let tries = 0; tries < 8; tries++) {
      if (rng() < 0.2 || tries > 0) m.dir = (m.dir + (rng() < 0.5 ? 1 : 3)) % 4;
      const x = m.at % W + DX[m.dir], y = (((m.at % PLANE) / W) | 0) + DY[m.dir];
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      const i = base + y * W + x;
      if (ter[i] === TER.ROCK) return i;
      if (walk[i]) { m.at = i; tries--; if (tries < -40) return -1; }
    }
    return -1;
  };
  setLinkClock(now);
  let mined = 0, bumps = 0, stamp = s.rt.regionGraph.col.stamp, builds0 = linkStats.builds;
  const perTick = [], built = [], tickMs = [], regionsMs = [];
  for (let t = 0; t < ticks; t++) {
    const m0 = linkStats.ms, b0 = linkStats.builds, t0 = now();
    for (const m of miners) {
      if (m.target >= 0) {
        const c = s.col[m.id];
        if (pathReady(c.path) || (c.path && c.path.i === -1)) {
          if (pathReady(c.path) && c.path.tiles.length) m.at = c.path.tiles[c.path.tiles.length - 1];
          c.path = null;
          if (mineTile(s, m.target)) { mined++; m.at = m.target; }
          m.target = -1; m.wait = digEvery;
        }
        continue;
      }
      if (--m.wait > 0) continue;
      const f = face(m);
      if (f < 0) { m.wait = digEvery; continue; }
      m.target = f;
      // the miner comes back from a haul: it starts at a seeded spot of the Hearth level (a real search per dig)
      const c = s.col[m.id], from = spots[(rng() * spots.length) | 0];
      c.x = (from % W) * TILE + 16; c.y = (((from % PLANE) / W) | 0) * TILE + 16; c.z = hz;
      requestPath(s, 'c', m.id, f, GOAL.ADJ4);
    }
    pathSystem(s);
    // the regions pass only: the other endOfTick passes (rooms, temperature, light) are E4's per-level work
    const r0 = now();
    if (s.rt.dirty.regions) regionsPass(s);
    regionsMs.push(now() - r0);
    s.rt.dirty = newDirty();
    s.tick++;
    tickMs.push(now() - t0);
    const st = s.rt.regionGraph.col.stamp;
    if (st !== stamp) { bumps++; stamp = st; }
    const dm = linkStats.ms - m0;
    perTick.push(dm);
    if (linkStats.builds > b0) built.push(dm);
  }
  setLinkClock(null);
  const r = {
    ticks, mined, stampBumps: bumps, minedPerBump: bumps ? r3(mined / bumps) : mined, dijkstraBuilds: linkStats.builds - builds0,
    dijPerTickP95ms: r3(pct(perTick, 0.95)), dijBuildTickP95ms: r3(pct(built, 0.95)), dijPerTickMaxms: r3(Math.max(...perTick)),
    tickP95ms: r3(pct(tickMs, 0.95)), regionsPassP95ms: r3(pct(regionsMs, 0.95)), regionsPassMaxms: r3(Math.max(...regionsMs)),
  };
  const fails = [];
  if (r.dijPerTickP95ms >= 0.3) fails.push(`miners6: link Dijkstra per tick p95 ${r.dijPerTickP95ms} ms >= 0.3 ms`);
  if (mined < 8 * bumps + 1 && bumps) fails.push(`miners6: ${bumps} linkStamp bumps for ${mined} mined voxels (needs < 1 per 8)`);
  if (mined < 200) fails.push(`miners6: only ${mined} voxels mined`);
  return { r, fails };
}
