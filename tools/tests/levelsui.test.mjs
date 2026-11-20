// Stage Z1 E7: the pure level helpers of the UI (js/game/tools/levels.js; EMBERCROWN-FORTRESS.md 4.1, 4.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TER, idx, setBit, PLANE } from '../../js/game/core/grid.js';
import { stubFortress, digFortress } from './fortress-stub.mjs';
import { levelSummary, exploredRange, interestingLevels, nextInteresting, rulerRows, Scrub, stackPlan, stackLabel, levelText, nearestStair, stairDirs } from '../../js/game/tools/levels.js';

const fort = () => digFortress(stubFortress(7));

test('levelText is relative to the surface', () => {
  fort();
  assert.equal(levelText(14), '0'); assert.equal(levelText(11), '-3'); assert.equal(levelText(16), '+2');
});

test('the explored range: down to the deepest known level plus 1, up to the highest known solid level', () => {
  const s = fort();
  // known: the surface (x < 70) and the halls every third level below it (z 11, 8, 5, 2)
  let sum = levelSummary(s), r = exploredRange(sum);
  assert.equal(r.lo, 1, 'deepest known hall z 2, plus one level');
  assert.equal(r.hi, 14, 'nothing known above the surface');
  assert.equal(r.deepest, 2, 'the deepest dig is the hall on z 2');
  setBit(s.L.known, idx(120, 70, 16), 1);   // a known massif voxel at +2
  sum = levelSummary(s); r = exploredRange(sum);
  assert.equal(r.hi, 16);
});

test('ruler rows fold unexplored runs and the levels below the range', () => {
  const s = fort();
  // forget the halls on z 8 and z 5: z 10..3 become one unexplored run between z 11 and z 2 (z 13, 12 were never seen)
  for (const z of [8, 5]) for (let p = 0; p < PLANE; p++) { const i = z * PLANE + p; s.L.known[i >> 3] = 0; s.L.fog[i >> 3] = 0; }
  const sum = levelSummary(s), r = exploredRange(sum), rows = rulerRows(sum, r);
  assert.deepEqual(rows.map((x) => (x.kind === 'level' ? x.z : `fold${x.n}`)), [14, 'fold2', 11, 'fold8', 2, 1, 'fold1']);
});

test('interesting levels and the hold-to-jump target', () => {
  const s = fort();
  s.col[2].z = 8;
  const sum = levelSummary(s), set = interestingLevels(sum);
  assert.ok(set.has(14) && set.has(8) && set.has(2));
  assert.equal(nextInteresting(set, 14, -1, 1, 14), 8);
  assert.equal(nextInteresting(set, 8, -1, 1, 14), 2);
  assert.equal(nextInteresting(set, 2, -1, 1, 14), 1, 'none further: the end of the range');
});

test('scrub: 20 pt per level slow, 8 pt fast, a 12 pt hold at a detent', () => {
  let sc = new Scrub(14, 0, 19);
  for (let k = 0; k < 10; k++) sc.move(6, 100);   // 60 pt/s, 60 pt down
  assert.equal(sc.z, 11);
  sc = new Scrub(14, 0, 19);
  sc.move(160, 200);   // 800 pt/s: 160 pt is 20 levels, clamped at 0
  assert.equal(sc.z, 0);
  sc = new Scrub(14, 0, 19, new Set([12]));
  for (let k = 0; k < 8; k++) sc.move(5, 100);   // 40 pt: 2 levels to the detent, then the hold eats 12 pt
  assert.equal(sc.z, 12);
  sc.move(5, 100); sc.move(5, 100);   // 50 pt total: 12 held, 8 of the next step
  assert.equal(sc.z, 12);
  sc.move(25, 300);
  assert.equal(sc.z, 11);
  sc.move(-20, 400);
  assert.equal(sc.z, 12, 'up again');
});

test('stack plan: the stop mark and the loupe line', () => {
  const s = fort();
  let p = stackPlan(s, { x0: 30, y0: 30, x1: 32, y1: 32 }, 14, 'stairs', 4, 'down');
  assert.deepEqual(p.zs, [14, 13, 12, 11]);
  assert.equal(stackLabel(p), '3 x 3 · 4 levels · 36 voxels');
  s.L.fluid[idx(31, 31, 12)] = 3;
  p = stackPlan(s, { x0: 30, y0: 30, x1: 32, y1: 32 }, 14, 'stairs', 4, 'down');
  assert.deepEqual(p.zs, [14, 13]); assert.equal(p.stop, 12);
  p = stackPlan(s, { x0: 1, y0: 1, x1: 1, y1: 1 }, 1, 'stairs', 11, 'down');
  assert.deepEqual(p.zs, [1, 0]); assert.equal(p.stop, 0);
  p = stackPlan(s, { x0: 1, y0: 1, x1: 1, y1: 1 }, 14, 'channel', 3, 'up');
  assert.deepEqual(p.zs, [14, 13, 12], 'a channel never goes up');
});

test('nearest stair and the stair directions', () => {
  const s = fort();
  const st = nearestStair(s, 11, 70, 70);
  assert.deepEqual([st.x, st.y], [60, 60]);
  assert.deepEqual(stairDirs(s, idx(60, 60, 11)), { up: true, down: true });
  assert.deepEqual(stairDirs(s, idx(60, 60, 14)), { up: false, down: true });
  assert.equal(nearestStair(s, 14, 0, 0).i, idx(60, 60, 14));
  s.L.terrain[idx(60, 60, 13)] = TER.ROCK;
  assert.deepEqual(stairDirs(s, idx(60, 60, 13)), { up: false, down: false });
});

test('pick by z: a colonist on another level is not picked; the tile is the voxel on the view level', async () => {
  const { pickAt } = await import('../../js/game/tools/pick.js');
  const s = fort();
  const c = s.col[0];   // on the surface (z 14)
  const a = pickAt(s, c.x, c.y - 10, 1, null, undefined, 14);
  assert.equal(a.kind, 'colonist');
  const b = pickAt(s, c.x, c.y - 10, 1, null, undefined, 11);
  assert.notEqual(b.kind, 'colonist');
  assert.equal(b.tile, idx(Math.floor(c.x / 32), Math.floor((c.y - 10) / 32), 11));
  assert.equal(b.z, 11);
});

test('a ghost over open air needs a floor (4.4)', async () => {
  const { ghost, NEEDS_FLOOR } = await import('../../js/game/tools/place.js');
  const { structDef } = await import('../../js/game/core/content.js');
  const s = fort();
  const { initRuntime } = await import('../../js/game/core/state.js');
  initRuntime(s);
  if (!structDef('bed')) return;   // content not loaded in this runner
  s.L.terrain[idx(30, 30, 15)] = TER.AIR;
  assert.equal(ghost(s, 'bed', 30, 30, 0, 15).why, NEEDS_FLOOR);
  assert.equal(ghost(s, 'bed', 30, 30, 0, 15).tiles[0] >= 15 * PLANE, true, 'voxel indexes on the level');
});
