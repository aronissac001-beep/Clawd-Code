// Stage Z1 E2 (owner B): plain 3D A* (js/game/systems/pathing.js) against a brute-force 3D Dijkstra on the
// flat3d and tower3d stub maps (EMBERCROWN-FORTRESS.md 8.3 E2 Oracle: equal cost on every one of 200 seeded
// pairs per map), path legality, followPath across stairs, and D = 1 unchanged.
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
        const r = findPath(s, from, goal, GOAL.TILE, 0, N);
        pairs++;
        if (r.expanded > maxExp) maxExp = r.expanded;
        if (dist[goal] === Infinity) { assert.equal(r.status, 'fail', 'unreachable goal: the open set runs dry'); continue; }
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
  const r = findPath(s, a, b, GOAL.TILE, 0, N);
  assert.equal(r.status, 'ok');
  assert.equal(r.cost, dijkstraAll(s, a)[b]);
  const z = r.tiles.map((t) => Math.floor(t / PLANE));
  for (let k = 1; k < z.length; k++) assert.ok(Math.abs(z[k] - z[k - 1]) <= 1);
  assert.equal(findPath(s, a, idx(30, 30, 3), GOAL.TILE, 0, N).status, 'fail');
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
  const cost = findPath(s, from, goal, GOAL.TILE, 0, N).cost;
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
