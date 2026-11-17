// Contract C13 test (13.3): every s.rt key is classed; runs against the stub rt of Stage 0.
// A new rt field must be added to js/game/core/rtcontract.js in the same change that adds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { RT, RT_KEYS, checkRt, savedKeys, keysOfClass, verifyCaches, dirtyClear, rebuildKeys } from '../../js/game/core/rtcontract.js';
import { newStack } from '../../js/game/core/schema.js';
import { idx } from '../../js/game/core/grid.js';

const CLASSES = new Set(Object.values(RT));

test('no unlisted rt key on a fresh colony, and nothing missing', () => {
  const s = createColony('RT-1');
  const r = checkRt(s.rt);
  assert.deepEqual(r.unlisted, [], `unlisted rt keys: ${r.unlisted.join(', ')} (add them to rtcontract.js)`);
  assert.deepEqual(r.missing, []);
});

test('no unlisted rt key after ticks and after a reload of the runtime', () => {
  const s = createColony('RT-2');
  for (let i = 0; i < 50; i++) tick(s);
  assert.deepEqual(checkRt(s.rt).unlisted, []);
  initRuntime(s);
  assert.deepEqual(checkRt(s.rt).unlisted, []);
});

test('every key has a known class, an owner and a rule', () => {
  for (const [k, v] of Object.entries(RT_KEYS)) {
    assert.ok(CLASSES.has(v.cls), `${k}: class ${v.cls}`);
    assert.match(v.owner, /^[A-K]$/, `${k}: owner`);
    assert.ok(v.rule && v.rule.length > 5, `${k}: rule`);
    assert.equal(typeof v.alloc, 'function', `${k}: alloc`);
  }
});

test('the 13.3 table is covered', () => {
  for (const k of ['region', 'regionH', 'regionGraph', 'room', 'rooms', 'roomTemp', 'heat', 'light', 'lit', 'occ', 'itemAt', 'support', 'depth', 'walkCost', 'idx', 'zoneField', 'zoneFree', 'spatial', 'res', 'itemFree', 'stock', 'wealth', 'thinkQ', 'pathQ', 'flow']) assert.ok(k in RT_KEYS, k);
  assert.deepEqual(savedKeys(false).sort(), ['pathQ', 'thinkQ']);
  assert.deepEqual(savedKeys(true).sort(), ['flow', 'pathQ', 'thinkQ']);
  assert.deepEqual(keysOfClass(RT.DERIVED_EXACT), ['res']);
});

test('dirty flags are clear at every tick end', () => {
  const s = createColony('RT-3');
  s.rt.dirty.light = true; s.rt.dirty.tiles.push(5);
  tick(s);
  assert.ok(dirtyClear(s.rt.dirty));
});

test('registered rebuilds equal the live caches on the stub rt (gate check (e))', () => {
  const s = createColony('RT-4');
  assert.ok(rebuildKeys().includes('itemAt') && rebuildKeys().includes('res'));
  s.items[0] = newStack(0, 'wood', 'pine', 0, 5, 3, 4); s.rt.itemAt[idx(3, 4)] = 0;
  assert.deepEqual(verifyCaches(s), []);
  s.rt.itemAt[idx(9, 9)] = 0; // a stale cache entry must be caught
  assert.deepEqual(verifyCaches(s), ['itemAt']);
});
