// Workstream E, contract C6 (js/game/work/items.js): stacks, lowest free index, merge and spill,
// take, stock totals, work index buckets, search, and C13 rebuild equality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime, stateHash, checkState } from '../../js/game/core/state.js';
import { verifyCaches, rtEqual } from '../../js/game/core/rtcontract.js';
import { newZone } from '../../js/game/core/schema.js';
import { idx, TER } from '../../js/game/core/grid.js';
import { rint } from '../../js/game/core/rand.js';
import * as I from '../../js/game/work/items.js';
import '../../js/game/work/reserve.js';

const colony = (seed = 'E-ITEMS') => createColony(seed, { w: 32 });
const live = (s) => s.items.filter(Boolean);
const units = (s, k) => live(s).filter((it) => it.k === k).reduce((a, it) => a + it.n, 0);

test('spawn takes the lowest free index, frees reuse it, trailing slots are trimmed', () => {
  const s = colony();
  const a = I.spawn(s, 'wood', 'pine', 0, 5, 1, 1), b = I.spawn(s, 'wood', 'pine', 0, 5, 3, 1), c = I.spawn(s, 'wood', 'pine', 0, 5, 5, 1);
  assert.deepEqual([a, b, c], [0, 1, 2]);
  I.destroy(s, 1);
  assert.equal(s.items[1], null); assert.deepEqual(s.rt.itemFree, [1]);
  assert.equal(I.spawn(s, 'stone', 'granite', 0, 3, 7, 7), 1, 'reuses the lowest free slot');
  I.destroy(s, 2); I.destroy(s, 1);
  assert.equal(s.items.length, 1, 'trailing free slots trimmed'); assert.deepEqual(s.rt.itemFree, []);
  assert.equal(I.checkItems(s), null); assert.deepEqual(verifyCaches(s), []);
});

test('spawn merges into a matching stack and spills in fixed ring order past the stack limit', () => {
  const s = colony();
  const id = I.spawn(s, 'stone', 'granite', 0, 4, 10, 10);
  assert.equal(I.spawn(s, 'stone', 'granite', 0, 4, 10, 10), id, 'merged');
  assert.equal(s.items[id].n, 8);
  I.spawn(s, 'stone', 'granite', 0, 25, 10, 10);          // limit 10: 2 fill the pile, 23 spill
  assert.equal(s.items[id].n, 10);
  assert.equal(units(s, 'stone'), 33);
  assert.ok(live(s).every((it) => it.n <= I.stackLimit('stone')));
  // the first spill tile is ring 1, top-left corner
  assert.equal(I.stackAt(s, idx(9, 9)).n, 10);
  // different material never merges
  I.spawn(s, 'stone', 'slate', 0, 1, 20, 20);
  assert.equal(I.spawn(s, 'stone', 'granite', 0, 1, 20, 20) !== I.stackAt(s, idx(20, 20)).id, true);
  assert.deepEqual(verifyCaches(s), []);
});

test('spill skips tiles that cannot hold items (rock)', () => {
  const s = colony();
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) if (x !== 5 || y !== 5) s.L.terrain[idx(x, y)] = TER.ROCK;
  I.spawn(s, 'stone', 'granite', 0, 15, 5, 5);
  for (const it of live(s)) assert.equal(I.canHold(s, idx(it.x, it.y)), true);
  assert.equal(units(s, 'stone'), 15);
});

test('take shrinks or removes a stack; bundles keep kind, material and quality', () => {
  const s = colony();
  const id = I.spawn(s, 'wood', 'oak', 2, 30, 2, 2);
  const b = I.take(s, id, 12);
  assert.deepEqual([b.k, b.m, b.q, b.n], ['wood', 'oak', 2, 12]);
  assert.equal(s.items[id].n, 18);
  const c = I.take(s, id, 99);
  assert.equal(c.n, 18); assert.equal(s.items[id] ?? null, null);
  assert.equal(s.rt.itemAt[idx(2, 2)], -1);
  assert.equal(I.take(s, id, 1), null);
  assert.deepEqual(verifyCaches(s), []);
});

test('stock counts non-forbidden units on stockpile tiles, exactly, through forbid and zone edits', () => {
  const s = colony();
  s.zones.push(newZone(1, 'stockpile'));
  const tiles = [];
  for (let x = 0; x < 4; x++) tiles.push(idx(x, 0));
  I.withZoneEdit(s, tiles, () => { for (const i of tiles) s.L.zone[i] = 1; });
  const a = I.spawn(s, 'wood', 'pine', 0, 20, 0, 0);
  I.spawn(s, 'wood', 'pine', 0, 7, 10, 10);               // outside: not stock
  assert.equal(I.totals(s, 'wood'), 20);
  I.setForbidden(s, a, true); assert.equal(I.totals(s, 'wood'), 0);
  I.setForbidden(s, a, false); assert.equal(I.totals(s, 'wood'), 20);
  I.take(s, a, 5); assert.equal(I.totals(s, 'wood'), 15);
  I.withZoneEdit(s, [idx(0, 0)], () => { s.L.zone[idx(0, 0)] = 0; });
  assert.equal(I.totals(s, 'wood'), 0);
  assert.deepEqual(verifyCaches(s), []);
  assert.ok(rtEqual(s.rt.stock, I.rebuildStock(s)));
});

test('findNearest and candidates: nearest first, ties by id, filters and region', () => {
  const s = colony();
  const far = I.spawn(s, 'wood', 'pine', 0, 5, 20, 20);
  const t1 = I.spawn(s, 'wood', 'pine', 0, 5, 12, 10), t2 = I.spawn(s, 'wood', 'pine', 0, 5, 8, 10);
  const oak = I.spawn(s, 'wood', 'oak', 0, 5, 10, 11);
  const from = idx(10, 10);
  assert.equal(I.findNearest(s, { k: 'wood' }, from).id, oak);
  assert.deepEqual(I.candidates(s, { k: 'wood' }, from, null, 3).map((x) => x.id), [oak, t1, t2]);
  assert.equal(I.findNearest(s, { k: 'wood', m: 'pine' }, from).id, t1, 'tie at distance 2: lower id');
  assert.equal(I.findNearest(s, { cat: 'wood' }, from).id, oak);
  I.setForbidden(s, oak, true);
  assert.equal(I.findNearest(s, { k: 'wood' }, from).id, t1);
  assert.equal(I.findNearest(s, { k: 'wood', forbidden: true }, from).id, oak);
  s.rt.region[idx(20, 20)] = 7;
  assert.equal(I.findNearest(s, { k: 'wood' }, from, 7).id, far);
  assert.equal(I.findNearest(s, { k: 'wood' }, from, (i) => i === idx(8, 10)).id, t2);
  assert.equal(I.findNearest(s, { k: 'coal' }, from), null);
});

test('seeded churn: every item cache equals its rebuild, initRuntime restores them, same seed same hash', () => {
  const churn = (seed) => {
    const s = colony(seed);
    s.zones.push(newZone(1, 'stockpile'));
    const zt = []; for (let x = 0; x < 32; x++) zt.push(idx(x, 3));
    I.withZoneEdit(s, zt, () => { for (const i of zt) s.L.zone[i] = 1; });
    const kinds = ['wood', 'stone', 'block', 'coins', 'chair'];
    for (let n = 0; n < 1500; n++) {
      const op = rint(s, 'main', 0, 9), ids = live(s).map((it) => it.id);
      if (op < 4 || !ids.length) I.spawn(s, kinds[rint(s, 'main', 0, 4)], rint(s, 'main', 0, 1) ? 'a' : 'b', 0, rint(s, 'main', 1, 30), rint(s, 'main', 0, 31), rint(s, 'main', 0, 31));
      else if (op < 8) I.take(s, ids[rint(s, 'main', 0, ids.length - 1)], rint(s, 'main', 1, 20));
      else if (op < 9) I.setForbidden(s, ids[rint(s, 'main', 0, ids.length - 1)], rint(s, 'main', 0, 1) === 1);
      else I.destroy(s, ids[rint(s, 'main', 0, ids.length - 1)]);
      if (s.rt.itemFree.length) s.sawFree = (s.sawFree || 0) + 1;
      if (n % 100 === 0) { assert.deepEqual(verifyCaches(s), [], `tick ${n}`); assert.equal(I.checkItems(s), null); }
    }
    const saw = s.sawFree; delete s.sawFree;
    return [s, saw];
  };
  const [s, saw] = churn('E-CHURN');
  assert.ok(live(s).length > 30 && saw > 100, `churn did something (${live(s).length} stacks, free slots seen on ${saw} steps)`);
  const before = { free: s.rt.itemFree.slice(), stock: { ...s.rt.stock }, idx: JSON.parse(JSON.stringify(s.rt.idx)), at: Array.from(s.rt.itemAt) };
  initRuntime(s);
  assert.deepEqual(s.rt.itemFree, before.free); assert.deepEqual(s.rt.stock, before.stock);
  assert.ok(rtEqual(s.rt.idx, before.idx), 'work index rebuilt equal (order-free)'); assert.deepEqual(Array.from(s.rt.itemAt), before.at);
  assert.deepEqual(checkState(s), []);
  assert.equal(stateHash(churn('E-CHURN')[0]), stateHash(s));
});
