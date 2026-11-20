// Stage Z1 E2 (owner B): plain 3D A* (js/game/systems/pathing.js, opts.heur 'plain') against a brute-force 3D
// Dijkstra on the flat3d and tower3d stub maps (EMBERCROWN-FORTRESS.md 8.3 E2 Oracle: equal cost on every one
// of 200 seeded pairs per map), path legality, followPath across stairs, and D = 1 unchanged.
// Stage Z1 E3 (owner B; the prototype's proto/suite.mjs ported): link-heuristic A* (the default at D > 1)
// against plain A* on the stub maps and the 3D maze (same reachability on every pair, mean cost <= 1.08x,
// p95 <= 1.15x, max expansions < 4,000, none over the cap); the lazy link Dijkstra answers exactly as a full
// one and a cold cache answers as a warm one; regionDist in 3D; the request-counted goal cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { resetBus } from '../../js/game/core/bus.js';
import { idx, TER, TILE, W, H, D, N, PLANE, DX8, DY8, TER_UP, TER_DOWN } from '../../js/game/core/grid.js';
import { newColonist } from '../../js/game/core/schema.js';
import { rint } from '../../js/game/core/rand.js';
import { installWorld } from '../../js/game/world/terrain.js';
import { buildStubMap } from '../../js/game/world/stubmap.js';
import { stepCost, passW } from '../../js/game/world/pass.js';
import { findPath, installMovement, followPath, requestPath, pathSystem, GOAL, PATH } from '../../js/game/systems/pathing.js';

function world(kind, seed, w = 48, d = 5) {
  resetBus(); installWorld(); installMovement();
  const s = createColony('P3-' + kind + seed, { w, d });
  buildStubMap(s, kind, seed);
  initRuntime(s);
  return s;
}

// ---- The reference: brute-force 3D Dijkstra (no heuristic, array scan for the minimum) --------------------
// Written from the rules of 2.3, independent of pathing.js: 8 planar moves with no corner cutting at
// walk x 10 / x 14, and a vertical move from a TER_UP voxel to the TER_DOWN voxel directly above (and back)
// at PATH.VERT x walk / 10.
function dijkstraAll(s, from, side = 0) {
  const walk = s.rt.walkCost, ter = s.L.terrain;
  const dist = new Float64Array(N).fill(Infinity), done = new Uint8Array(N);
  dist[from] = 0;
  // bucketed by exact distance (costs are integers): a simple sorted frontier map
  const buckets = new Map(); const keys = [];
  const add = (i, d) => { let b = buckets.get(d); if (!b) { buckets.set(d, (b = [])); keys.push(d); } b.push(i); };
  add(from, 0);
  while (keys.length) {
    let m = 0; for (let k = 1; k < keys.length; k++) if (keys[k] < keys[m]) m = k;
    const d = keys[m]; keys.splice(m, 1);
    const b = buckets.get(d); buckets.delete(d);
    for (const cur of b) {
      if (done[cur] || dist[cur] !== d) continue;
      done[cur] = 1;
      const z = Math.floor(cur / PLANE), base = z * PLANE, x = cur % W, y = Math.floor((cur - base) / W);
      const relax = (ni, step) => { const nd = d + step; if (nd < dist[ni]) { dist[ni] = nd; add(ni, nd); } };
      for (let k = 0; k < 8; k++) {
        const nx = x + DX8[k], ny = y + DY8[k];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = base + ny * W + nx, c = stepCost(walk[ni], side);
        if (!c) continue;
        if (k >= 4 && (!passW(walk[base + y * W + nx], side) || !passW(walk[base + ny * W + x], side))) continue;
        relax(ni, c * (k < 4 ? 10 : 14));
      }
      if (z < D - 1 && TER_UP[ter[cur]] && TER_DOWN[ter[cur + PLANE]]) { const c = stepCost(walk[cur + PLANE], side); if (c) relax(cur + PLANE, (c * PATH.VERT) / 10); }
      if (z > 0 && TER_DOWN[ter[cur]] && TER_UP[ter[cur - PLANE]]) { const c = stepCost(walk[cur - PLANE], side); if (c) relax(cur - PLANE, (c * PATH.VERT) / 10); }
    }
  }
  return dist;
}

/** Every step of a path is a legal move and the summed cost equals r.cost. */
function checkPath(s, from, r) {
  const walk = s.rt.walkCost, ter = s.L.terrain;
  let prev = from, cost = 0;
  for (const t of r.tiles) {
    const pz = Math.floor(prev / PLANE), tz = Math.floor(t / PLANE), c = stepCost(walk[t], 0);
    assert.ok(c > 0, 'steps onto a passable voxel');
    if (pz !== tz) {
      assert.equal(t % PLANE, prev % PLANE, 'a vertical step stays in its column');
      if (tz > pz) assert.ok(TER_UP[ter[prev]] && TER_DOWN[ter[t]], 'up from an up voxel to a down voxel');
      else assert.ok(TER_DOWN[ter[prev]] && TER_UP[ter[t]], 'down from a down voxel to an up voxel');
      assert.equal(Math.abs(tz - pz), 1);
      cost += (c * PATH.VERT) / 10;
    } else {
      const dx = Math.abs((t % W) - (prev % W)), dy = Math.abs(Math.floor((t % PLANE) / W) - Math.floor((prev % PLANE) / W));
      assert.ok(dx <= 1 && dy <= 1 && dx + dy > 0, 'a planar step is to an 8-neighbour');
      cost += c * (dx + dy === 2 ? 14 : 10);
    }
    prev = t;
  }
  assert.equal(cost, r.cost, 'path cost adds up');
}

for (const [kind, w, d] of [['flat3d', 48, 5], ['tower3d', 32, 8]]) {
  test(`${kind}: A* cost equals a brute-force 3D Dijkstra on 200 seeded pairs`, () => {
    const s = world(kind, 11, w, d);
    const open = [];
    for (let i = 0; i < N; i++) if (passW(s.rt.walkCost[i], 0)) open.push(i);
    const R = { rng: { main: 0x5eed } };
    // 20 sources x 10 goals = 200 pairs: one Dijkstra per source
    let pairs = 0, reach = 0, multi = 0, maxExp = 0;
    for (let a = 0; a < 20; a++) {
      const from = open[rint(R, 'main', 0, open.length - 1)];
      const dist = dijkstraAll(s, from);
      for (let b = 0; b < 10; b++) {
        const goal = open[rint(R, 'main', 0, open.length - 1)];
        const r = findPath(s, from, goal, GOAL.TILE, 0, N, { heur: 'plain' });
        pairs++;
        if (r.expanded > maxExp) maxExp = r.expanded;
        if (dist[goal] === Infinity) { assert.equal(r.status, 'unreachable', 'unreachable goal: the region graph rejects it (E3)'); continue; }
        if (from === goal) { assert.equal(r.status, 'here'); continue; }
        assert.equal(r.status, 'ok');
        assert.equal(r.cost, dist[goal], `pair ${from} -> ${goal}`);
        checkPath(s, from, r);
        reach++;
        if (Math.floor(from / PLANE) !== Math.floor(goal / PLANE)) multi++;
      }
    }
    assert.equal(pairs, 200);
    assert.ok(reach >= 100, `most pairs reachable (${reach})`);
    assert.ok(multi >= 60, `many pairs cross levels (${multi})`);
    console.log(`# ${kind}: 200 pairs, ${reach} reachable (${multi} across levels), all costs equal; max expansions ${maxExp}`);
  });
}

test('the heuristic counts levels: a goal straight above in tower3d costs the detour, and one in rock fails', () => {
  const s = world('tower3d', 2, 32, 6);
  const a = idx(3, 3, 0), b = idx(3, 3, 5);
  const r = findPath(s, a, b, GOAL.TILE, 0, N, { heur: 'plain' });
  assert.equal(r.status, 'ok');
  assert.equal(r.cost, dijkstraAll(s, a)[b]);
  const z = r.tiles.map((t) => Math.floor(t / PLANE));
  for (let k = 1; k < z.length; k++) assert.ok(Math.abs(z[k] - z[k - 1]) <= 1);
  assert.equal(findPath(s, a, idx(30, 30, 3), GOAL.TILE, 0, N).status, 'unreachable', 'rock: rejected by the region graph (E3)');
  assert.equal(findPath(s, a, idx(30, 30, 3), GOAL.TILE, 0, N, { noRegionCheck: true }).status, 'fail');
});

test('ADJ goals stay on the goal level', () => {
  const s = world('flat3d', 4);
  // a rock voxel with open floor beside it on z 2, and open floor straight below on z 1
  const z = 2;
  let goal = -1;
  for (let i = z * PLANE + W + 1; i < (z + 1) * PLANE - W - 1 && goal < 0; i++) {
    if (s.L.terrain[i] === TER.ROCK && passW(s.rt.walkCost[i + 1], 0) && passW(s.rt.walkCost[i - PLANE], 0)) goal = i;
  }
  assert.ok(goal >= 0);
  const r = findPath(s, idx(1, 1, 0), goal, GOAL.ADJ4, 0, N);
  if (r.status === 'ok') {
    const end = r.tiles[r.tiles.length - 1];
    assert.equal(Math.floor(end / PLANE), z);
    assert.equal(Math.abs((end % W) - (goal % W)) + Math.abs(Math.floor((end % PLANE) / W) - Math.floor((goal % PLANE) / W)), 1);
  }
});

test('followPath climbs stairs: z changes, the walk takes the path cost in effort, and ends at the goal', () => {
  const s = world('tower3d', 5, 32, 4);
  const from = idx(3, 3, 0), goal = idx(4, 3, 3);
  const c = newColonist(0, { x: 3 * TILE + 16, y: 3 * TILE + 16 });
  c.z = 0;
  s.col.push(c);
  requestPath(s, 'c', 0, goal, GOAL.TILE);
  pathSystem(s);
  assert.ok(c.path && c.path.i === 0);
  const cost = findPath(s, from, goal, GOAL.TILE, 0, N).cost;   // the same search the queue ran (link heuristic)
  const levels = new Set();
  let ticks = 0;
  while (c.path && ticks < 5000) { followPath(s, c); levels.add(c.z); ticks++; }
  assert.equal(c.z, 3);
  assert.equal(Math.floor(c.x / TILE), 4); assert.equal(Math.floor(c.y / TILE), 3);
  assert.deepEqual([...levels].sort(), [0, 1, 2, 3]);
  // effort: 5 units per tick on normal ground = 100 path cost per 6.4 ticks. Whole units per tick lose some
  // effort on diagonals (k 140: 3 units of 3.57) and climbs (k 400: 1 unit of 1.25), as Stage 2's diagonals do
  const expect = (cost * 32) / 100 / 5;
  assert.ok(ticks >= expect - 2 && ticks <= 1.15 * expect + 4, `ticks ${ticks} vs ${expect.toFixed(1)}`);
});

test('D = 1: a planar search is unchanged (the heap grows instead of 8N)', () => {
  resetBus(); installWorld(); installMovement();
  const s = createColony('P3-D1', { w: 64 });
  buildStubMap(s, 'maze', 3); initRuntime(s);
  let a = -1, b = -1;
  for (let i = 0; i < N; i++) if (passW(s.rt.walkCost[i], 0)) { if (a < 0) a = i; b = i; }
  const r = findPath(s, a, b);
  assert.equal(r.status, 'ok');
  checkPath(s, a, r);
  assert.equal(r.cost, dijkstraAll(s, a)[b]);
});

// ---- Stage Z1 E3: the link heuristic (proto/suite.mjs) ----------------------------------------------------
import { compOf, regionDist, reachable, linkStamp } from '../../js/game/world/regions.js';
import { linkDijkstra, linkSettleAll, linkBest, linkCacheClear } from '../../js/game/world/regiongraph.js';
import { maze3dColony } from '../lib/maze3d.mjs';

const pct = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
/** Link A* against plain A* on `n` seeded pairs of one component; returns the stats. */
function linkVsPlain(s, cand, n, seed) {
  const R = { rng: { main: seed } };
  const ratio = [];
  let same = 0, maxExp = 0, over = 0, multi = 0;
  for (let k = 0; k < n; k++) {
    const a = cand[rint(R, 'main', 0, cand.length - 1)], b = cand[rint(R, 'main', 0, cand.length - 1)];
    const p = findPath(s, a, b, GOAL.TILE, 0, N, { heur: 'plain' });
    const l = findPath(s, a, b, GOAL.TILE, 0, searchCap());
    if (p.status === l.status) same++;
    if (l.status === 'trunc') over++;
    if (l.status === 'ok') { checkPath(s, a, l); ratio.push(p.cost ? l.cost / p.cost : 1); }
    if (l.expanded > maxExp) maxExp = l.expanded;
    if (Math.floor(a / PLANE) !== Math.floor(b / PLANE)) multi++;
  }
  return { same, n, maxExp, over, multi, mean: ratio.reduce((x, y) => x + y, 0) / ratio.length, p95: pct(ratio, 0.95), max: Math.max(...ratio) };
}
import { searchCap } from '../../js/game/systems/pathing.js';

test('E3 maze3d (128 x 128 x 20 fortress): link A* matches plain A* reachability on 200 pairs, cost mean <= 1.08x, p95 <= 1.15x, < 4,000 expansions', () => {
  resetBus(); installWorld(); installMovement();
  const { s, hearth } = maze3dColony(99);
  const hc = compOf(s, hearth), cand = [];
  for (let i = 0; i < N; i++) if (s.rt.region[i] && compOf(s, i) === hc) cand.push(i);
  const other = [];
  for (let i = 0; i < N && other.length < 50; i += 97) if (s.rt.region[i] && compOf(s, i) !== hc) other.push(i);
  const r = linkVsPlain(s, cand.concat(other.slice(0, 20)), 200, 0xe3);
  console.log(`# maze3d: ${r.same}/${r.n} same status (${r.multi} across levels), cost mean ${r.mean.toFixed(3)} p95 ${r.p95.toFixed(3)} max ${r.max.toFixed(3)}, max expansions ${r.maxExp}`);
  assert.equal(r.same, r.n, 'same reachability on every pair');
  assert.ok(r.mean <= 1.08, `mean ${r.mean}`);
  assert.ok(r.p95 <= 1.15, `p95 ${r.p95}`);
  assert.ok(r.maxExp < 4000 && r.over === 0, `max expansions ${r.maxExp}, ${r.over} over the cap`);
  assert.ok(r.multi >= 100);
});

for (const [kind, w, d] of [['flat3d', 48, 5], ['tower3d', 32, 8]]) {
  test(`E3 ${kind}: link A* has plain A*'s reachability on 200 pairs and stays near its cost`, () => {
    const s = world(kind, 11, w, d);
    const open = [];
    for (let i = 0; i < N; i++) if (passW(s.rt.walkCost[i], 0)) open.push(i);
    const r = linkVsPlain(s, open, 200, 0x5eed);
    console.log(`# ${kind}: link A* ${r.same}/${r.n} same status, cost mean ${r.mean.toFixed(3)} p95 ${r.p95.toFixed(3)}`);
    assert.equal(r.same, r.n);
    assert.ok(r.mean <= 1.08 && r.p95 <= 1.15, `mean ${r.mean} p95 ${r.p95}`);
  });
}

test('E3 the lazy link Dijkstra answers exactly as a fully settled one, and a cold cache answers as a warm one', () => {
  resetBus(); installWorld(); installMovement();
  const { s, hearth } = maze3dColony(99);
  const g = s.rt.regionGraph.col, lab = s.rt.region;
  const R = { rng: { main: 77 } }, open = [];
  for (let i = 0; i < N; i++) if (lab[i]) open.push(i);
  for (let k = 0; k < 20; k++) {
    const goal = open[rint(R, 'main', 0, open.length - 1)];
    linkCacheClear();
    const lazy = linkDijkstra(g, lab, goal, 0, 0);
    const probes = []; for (let m = 0; m < 30; m++) probes.push(open[rint(R, 'main', 0, open.length - 1)]);
    const a = probes.map((i) => linkBest(lazy, lab, i));
    linkCacheClear();
    const full = linkSettleAll(linkDijkstra(g, lab, goal, 0, 0));
    assert.deepEqual(probes.map((i) => linkBest(full, lab, i)), a, `goal ${goal}`);
  }
  // paths: warm cache, then cold, then warm again
  const pairs = []; for (let k = 0; k < 40; k++) pairs.push([open[rint(R, 'main', 0, open.length - 1)], open[rint(R, 'main', 0, open.length - 1)]]);
  const run = () => pairs.map(([a, b]) => { const r = findPath(s, a, b); return r.status + ':' + r.cost + ':' + (r.tiles ? Array.from(r.tiles).join(',') : ''); });
  const warm = run(); linkCacheClear(); const cold = run(); const again = run();
  assert.deepEqual(cold, warm); assert.deepEqual(again, warm);
  void hearth;
});

test('E3 regionDist in 3D: finite exactly when reachable, levels cost 20 tenths each, same region is the octile', () => {
  const s = world('tower3d', 3, 32, 6);
  const a = idx(3, 3, 0), b = idx(3, 3, 5), c = idx(4, 3, 0);
  assert.ok(reachable(s, a, b));
  const d = regionDist(s, a, b);
  assert.ok(Number.isFinite(d) && d >= 5 * 20, `5 levels at least 100 tenths: ${d}`);
  const plain = findPath(s, a, b, GOAL.TILE, 0, N, { heur: 'plain' }).cost / 10;
  assert.ok(d >= plain * 0.8 && d <= plain * 1.5, `regionDist ${d} near the true ${plain}`);
  assert.equal(regionDist(s, a, c), 10, 'same region: the octile');
  assert.equal(regionDist(s, a, idx(30, 30, 3)), Infinity);
  // symmetric
  assert.equal(regionDist(s, b, a), regionDist(s, a, b));
});

test('E3 goal cap: at most 6 distinct goals start searches per tick (counted by requests); the rest wait in order', () => {
  const s = world('flat3d', 7, 48, 3);
  const open = [];
  for (let i = 0; i < PLANE; i++) if (passW(s.rt.walkCost[i], 0)) open.push(i);
  for (let k = 0; k < 10; k++) { const c = newColonist(k, { x: (open[k] % W) * TILE + 16, y: Math.floor(open[k] / W) * TILE + 16 }); c.z = 0; s.col.push(c); }
  // 10 movers, goals: 0-3 share goal A, 4-9 each their own (7 distinct goals in all)
  const A = open[400], goals = [A, A, A, A, open[500], open[600], open[700], open[800], open[900], open[1000]];
  goals.forEach((g, k) => requestPath(s, 'c', k, g, GOAL.TILE));
  pathSystem(s);
  const served = s.col.map((c) => !!(c.path && c.path.i >= 0));
  assert.deepEqual(served, [true, true, true, true, true, true, true, true, true, false], 'the 7th distinct goal waits');
  assert.deepEqual(s.rt.pathQ.map((q) => q[1]), [9]);
  pathSystem(s);
  assert.ok(s.col[9].path && s.col[9].path.i >= 0);
  assert.equal(s.rt.pathQ.length, 0);
});

test('E3 a 3-level stair column links z..z-2 and nothing else; a channel over rock makes a ramp link', async () => {
  const { setTerrain, digStair } = await import('../../js/game/world/terrain.js');
  const { tick } = await import('../../js/game/core/sim.js');
  const s = world('tower3d', 9, 32, 5);
  // a fresh column at (10, 10): stair down at z 3, up-down at z 2, up at z 1 (floor voxels of each room)
  const x = 10, y = 10;
  for (const z of [1, 2, 3]) assert.ok(passW(s.rt.walkCost[idx(x, y, z)], 0) || s.L.terrain[idx(x, y, z)] === TER.ROCK);
  const before = linkStamp(s);
  for (const [z, k] of [[3, TER.STAIR_D], [2, TER.STAIR_UD], [1, TER.STAIR_U]]) {
    digStair(s, idx(x, y, z), k);
    // floor -> stair keeps the walk cost: terrain.js does not flag the regions yet (request E3 -> B)
    if (!s.rt.dirty.tiles.includes(idx(x, y, z))) { s.rt.dirty.regions = true; s.rt.dirty.tiles.push(idx(x, y, z)); }
  }
  tick(s);
  assert.notEqual(linkStamp(s), before, 'the link set changed');
  const g = s.rt.regionGraph.col;
  const col = [];
  for (let l = 0; l < g.links.length; l++) if (g.tb[l] - g.ta[l] === PLANE && g.ta[l] % PLANE === idx(x, y, 0)) col.push(Math.floor(g.ta[l] / PLANE));
  assert.deepEqual(col.sort(), [1, 2], 'links 1-2 and 2-3 at the column, none to z 0 or z 4');
  void setTerrain;
});
