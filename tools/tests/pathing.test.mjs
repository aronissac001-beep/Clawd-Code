// Workstream B (js/game/systems/pathing.js): A* with the 8,000-expansion shared budget, the N/2
// per-search cap (the doc's N*N/2 for side N: 8,192 at 128), the saved request queue, and the
// truncation check of doc 14.5 row B (0 of 400 reachable pairs truncated at 128).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { resetBus } from '../../js/game/core/bus.js';
import { idx, TER, TILE, W } from '../../js/game/core/grid.js';
import { newColonist, newFoe, newBuilding } from '../../js/game/core/schema.js';
import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
import { installWorld, setOcc } from '../../js/game/world/terrain.js';
import { buildStubMap } from '../../js/game/world/stubmap.js';
import {
  findPath, requestPath, cancelPath, pathPending, pathSystem, installPathing, pathFailed, pathReady, searchCap,
  PATH, GOAL, pathStats, resetPathStats, benchTruncation, losClear, smoothPath, pathMover,
} from '../../js/game/systems/pathing.js';

function flat(w = 32) {
  resetBus(); installWorld(); installPathing();
  const s = createColony('PATH-' + w, { w });
  return s;
}
const at = (x, y) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });

test('the per-search cap is half the tiles: 8,192 at 128, and the budget is 8,000', () => {
  flat(128);
  assert.equal(searchCap(), 8192);
  assert.equal(PATH.BUDGET, 8000);
});

test('straight and diagonal paths cost integers; no corner cutting', () => {
  const s = flat();
  const r = findPath(s, idx(2, 2), idx(12, 2));
  assert.equal(r.status, 'ok');
  assert.equal(r.tiles.length, 10);
  assert.equal(r.cost, 10 * 100);
  assert.equal(r.tiles[r.tiles.length - 1], idx(12, 2));
  const d = findPath(s, idx(2, 2), idx(7, 7));
  assert.equal(d.tiles.length, 5);
  assert.equal(d.cost, 5 * 140);
  // two rock tiles touching at a corner: the diagonal between them is not taken
  s.L.terrain[idx(5, 4)] = TER.ROCK; s.L.terrain[idx(4, 5)] = TER.ROCK; initRuntime(s);
  const c = findPath(s, idx(4, 4), idx(5, 5));
  assert.equal(c.status, 'ok');
  assert.ok(c.tiles.length > 1 && c.cost > 140, 'walks around the corner');
  // a ring of rock: rejected by the region graph without an A* expansion
  for (const [x, y] of [[20, 20], [21, 20], [22, 20], [20, 21], [22, 21], [20, 22], [21, 22], [22, 22]]) s.L.terrain[idx(x, y)] = TER.ROCK;
  initRuntime(s);
  const u = findPath(s, idx(2, 2), idx(21, 21));
  assert.equal(u.status, 'unreachable');
  assert.equal(u.expanded, 0);
  // without the region check A* floods the whole component: past the cap it truncates, uncapped it fails
  assert.equal(findPath(s, idx(2, 2), idx(21, 21), GOAL.TILE, 0, searchCap(), { noRegionCheck: true }).status, 'trunc');
  assert.equal(findPath(s, idx(2, 2), idx(21, 21), GOAL.TILE, 0, Infinity, { noRegionCheck: true }).status, 'fail', 'A* agrees');
  assert.equal(findPath(s, idx(2, 2), idx(2, 2)).status, 'here');
});

test('doors: colonists path through, hostiles are rejected before searching', () => {
  const s = flat();
  for (let y = 0; y < 32; y++) {
    const b = newBuilding(s.bld.length, y === 16 ? 'door_wood' : 'wall_stone', 10, y, 0, 'granite', { st: 'done' });
    s.bld.push(b); setOcc(s, b, true);
  }
  tick(s);
  const col = findPath(s, idx(2, 2), idx(20, 2), GOAL.TILE, 'col');
  assert.equal(col.status, 'ok');
  assert.ok(Array.from(col.tiles).includes(idx(10, 16)), 'through the door');
  const hos = findPath(s, idx(2, 2), idx(20, 2), GOAL.TILE, 'hos');
  assert.equal(hos.status, 'unreachable');
  assert.equal(hos.expanded, 0);
  assert.ok(losClear(s, at(2, 2).x, at(2, 2).y, at(8, 9).x, at(8, 9).y, 'col'));
  assert.ok(!losClear(s, at(2, 2).x, at(2, 2).y, at(20, 3).x, at(20, 3).y, 'col'), 'a wall blocks the line');
  const sm = smoothPath(s, idx(2, 2), col.tiles, 'col');
  assert.ok(sm.length < col.tiles.length && sm[sm.length - 1] === idx(20, 2));
});

test('ADJ4 goals reach the face of a rock tile; small caps truncate', () => {
  const s = flat();
  for (let y = 0; y < 32; y++) for (let x = 20; x < 32; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  initRuntime(s);
  const r = findPath(s, idx(2, 10), idx(20, 10), GOAL.ADJ4);
  assert.equal(r.status, 'ok');
  assert.equal(r.tiles[r.tiles.length - 1], idx(19, 10));
  assert.equal(findPath(s, idx(2, 10), idx(20, 10), GOAL.TILE).status, 'unreachable');
  assert.equal(findPath(s, idx(2, 10), idx(25, 10), GOAL.ADJ4).status, 'unreachable', 'interior rock has no open face');
  const t = findPath(s, idx(0, 0), idx(19, 31), GOAL.TILE, 0, 5);
  assert.equal(t.status, 'trunc');
  assert.equal(t.expanded, 5);
});

/** A 128 maze (the A* worst case) with open tiles listed, so the budget binds. */
function maze() {
  const s = flat(128);
  buildStubMap(s, 'maze', 11);
  initRuntime(s);
  const open = [];
  for (let i = 0; i < s.rt.walkCost.length; i++) if (s.rt.walkCost[i]) open.push(i);
  return { s, open, atI: (i) => at(i % W, (i / W) | 0) };
}

test('the saved queue: FIFO, one request per mover, the budget stops new searches, results on the mover', () => {
  const { s, open, atI } = maze();
  for (let k = 0; k < 30; k++) s.col.push(newColonist(k, { name: 'C' + k, ...atI(open[k * 37]) }));
  s.foes.push(newFoe(0, 'husk', atI(open[5])));
  for (let k = 0; k < 30; k++) requestPath(s, 'c', k, open[open.length - 1 - k * 53]);
  requestPath(s, 'c', 3, open[1000]);                    // re-aim keeps the slot
  assert.equal(s.rt.pathQ.length, 30);
  assert.deepEqual(s.rt.pathQ[3], ['c', 3, open[1000], 0]);
  requestPath(s, 'f', 0, open[4000]);
  requestPath(s, 'c', 29, open[7]);
  assert.ok(cancelPath(s, 'c', 29) && !pathPending(s, 'c', 29));
  assert.ok(pathPending(s, 'c', 0));
  resetPathStats();
  let ticks = 0;
  while (s.rt.pathQ.length) {
    const before = s.rt.pathQ.slice();
    const spent = pathSystem(s);
    ticks++;
    assert.ok(pathStats.startedAtMax < PATH.BUDGET, 'no search starts once 8,000 are spent');
    assert.ok(spent <= PATH.BUDGET - 1 + searchCap());
    // FIFO: what is left is a suffix of what was there
    assert.deepEqual(before.slice(before.length - s.rt.pathQ.length), s.rt.pathQ);
  }
  assert.ok(ticks >= 3, `the budget spread the work over ${ticks} ticks`);
  for (let k = 0; k < 29; k++) assert.ok(pathReady(s.col[k].path), `colonist ${k}`);
  assert.equal(s.col[29].path, null, 'cancelled');
  assert.ok(pathReady(s.foes[0].path));
  const p = s.col[0].path;
  assert.equal(p.tiles[p.tiles.length - 1], open[open.length - 1]);
  // a failed search leaves the FAILED marker
  s.L.terrain[open[2000]] = TER.ROCK; initRuntime(s);
  requestPath(s, 'c', 1, open[2000]);
  pathSystem(s);
  assert.ok(pathFailed(s.col[1].path));
});

test('a save mid-queue resumes with identical paths (pathQ is saved, C13)', async () => {
  const { s, open, atI } = maze();
  for (let k = 0; k < 40; k++) s.col.push(newColonist(k, { name: 'C' + k, ...atI(open[k * 29]) }));
  for (let k = 0; k < 40; k++) requestPath(s, 'c', k, open[open.length - 1 - k * 41]);
  tick(s);
  assert.ok(s.rt.pathQ.length > 0, 'work left in the queue');
  const t = await loadBlob(await saveBlob(s));
  assert.deepEqual(t.rt.pathQ, s.rt.pathQ);
  for (let k = 0; k < 40; k++) { tick(s); tick(t); }
  assert.equal(s.rt.pathQ.length, 0);
  assert.equal(stateHash(t), stateHash(s));
});

test('truncation check: 0 of 400 reachable pairs truncated at 128 (bench scene)', async () => {
  const r = await benchTruncation({ size: 128, pairs: 400, scene: 'bench' });
  assert.equal(r.pairs, 400);
  assert.equal(r.truncated, 0);
  assert.equal(r.failed, 0, 'every pair the regions call reachable is found');
  assert.equal(r.queue.delivered, 400);
  assert.ok(r.queue.startedAtMax < PATH.BUDGET);
  assert.equal(W, 128);
});

test("pathMover fits E's Mover hook: request, status, stop", () => {
  const s = flat();
  for (let y = 0; y < 32; y++) for (let x = 20; x < 32; x++) s.L.terrain[idx(x, y)] = TER.ROCK;
  initRuntime(s);
  const c = newColonist(0, { name: 'M', ...at(2, 2) });
  s.col.push(c);
  assert.equal(pathMover.request(s, c, idx(25, 5), true), false, 'interior rock: rejected with no A* call');
  assert.equal(pathMover.status(s, c), 'none');
  assert.equal(pathMover.request(s, c, idx(20, 5), true), true);
  assert.equal(pathMover.status(s, c), 'pending');
  tick(s);
  assert.equal(pathMover.status(s, c), 'moving');
  assert.equal(c.path.tiles[c.path.tiles.length - 1], idx(19, 5));
  pathMover.stop(s, c);
  assert.equal(pathMover.status(s, c), 'none');
});
