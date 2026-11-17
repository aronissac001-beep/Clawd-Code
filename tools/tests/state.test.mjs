import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, checkState, stateHash, initRuntime, nextId } from '../../js/game/core/state.js';
import { N, W } from '../../js/game/core/grid.js';
import { ROOT_KEYS } from '../../js/game/core/schema.js';

test('createColony(seed) returns an empty valid state', () => {
  const s = createColony('EMBER-1');
  assert.deepEqual(checkState(s), []);
  assert.equal(s.tick, 0); assert.equal(s.col.length, 0); assert.equal(s.items.length, 0);
  assert.deepEqual(Object.keys(s).filter((k) => k !== 'rt'), ROOT_KEYS.slice());
  assert.equal(W, 128); assert.equal(N, 16384); assert.equal(s.L.terrain.length, N);
});

test('map size is a header field (96 and 160)', () => {
  const a = createColony(1, { w: 96 }); assert.equal(N, 9216); assert.deepEqual(checkState(a), []);
  const b = createColony(1, { w: 160 }); assert.equal(N, 25600); assert.deepEqual(checkState(b), []);
  createColony(1);
});

test('seeds: same seed same state, different seed different rng', () => {
  const a = createColony('S'), b = createColony('S'), c = createColony('T');
  assert.equal(stateHash(a), stateHash(b));
  assert.notDeepEqual(a.rng, c.rng);
  assert.equal(new Set(Object.values(a.rng)).size, 5, 'five distinct streams');
});

test('initRuntime is repeatable and keeps saved runtime', () => {
  const s = createColony('R');
  s.rt.thinkQ.push(4, 5);
  initRuntime(s);
  assert.deepEqual(s.rt.thinkQ, [4, 5]);
});

test('nextId is monotonic per kind', () => {
  const s = createColony('I');
  assert.equal(nextId(s, 'col'), 1); assert.equal(nextId(s, 'col'), 2); assert.equal(nextId(s, 'raid'), 1);
});
