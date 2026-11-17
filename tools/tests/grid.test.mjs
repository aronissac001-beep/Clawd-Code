import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../js/game/core/grid.js';

test('live W/H/N follow setMapSize', () => {
  assert.equal(G.setMapSize(128), 16384);
  assert.equal(G.W, 128); assert.equal(G.N, 16384); assert.equal(G.CW, 8);
  G.setMapSize(96, 96);
  assert.equal(G.N, 9216); assert.equal(G.idx(5, 2), 2 * 96 + 5);
  assert.equal(G.tx(G.idx(7, 9)), 7); assert.equal(G.ty(G.idx(7, 9)), 9);
  G.setMapSize(128);
  assert.throws(() => G.setMapSize(3)); assert.throws(() => G.setMapSize(100.5));
});

test('terrain tables cover all 16 terrain ids', () => {
  assert.equal(G.TER_IDS.length, G.TER_COUNT);
  assert.equal(G.TER_NAMES.length, G.TER_COUNT);
  for (const t of [G.TER_PASSABLE, G.TER_MINEABLE, G.TER_BUILDABLE, G.TER_ROOFABLE, G.TER_OPAQUE, G.TER_WATER, G.TER_FERTILE, G.TER_WALK10]) assert.equal(t.length, G.TER_COUNT);
  assert.equal(G.TER_PASSABLE[G.TER.ROCK], 0); assert.equal(G.TER_MINEABLE[G.TER.ROCK], 1);
  assert.equal(G.TER_PASSABLE[G.TER.ROUGH], 1); assert.equal(G.TER_BUILDABLE[G.TER.ROUGH], 1);
  for (let t = 0; t < 16; t++) assert.equal(G.TER_PASSABLE[t] === 1, G.TER_WALK10[t] > 0, `walk cost agrees with passable for ${G.TER_IDS[t]}`);
});

test('layers: 12 in the 11.3 order, ids 1..12, fog and known are bitsets', () => {
  assert.deepEqual(G.LAYER_NAMES, ['terrain', 'mat', 'ore', 'floor', 'roof', 'plant', 'growth', 'blight', 'zone', 'desig', 'fog', 'known']);
  assert.deepEqual(G.LAYERS.map((l) => l.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  G.setMapSize(128);
  const L = G.allocLayers();
  assert.equal(L.terrain.length, 16384); assert.equal(L.fog.length, 2048); assert.equal(L.known.length, 2048);
  G.setBit(L.fog, 77, 1); assert.equal(G.getBit(L.fog, 77), 1); assert.equal(G.getBit(L.fog, 78), 0);
  G.setBit(L.fog, 77, 0); assert.equal(G.getBit(L.fog, 77), 0);
});

test('designation bits are distinct powers of two', () => {
  const v = Object.values(G.DESIG);
  assert.equal(new Set(v).size, 8); for (const b of v) assert.equal(b & (b - 1), 0);
  assert.deepEqual(Object.values(G.DESIG_KINDS).sort((a, b) => a - b), v.sort((a, b) => a - b));
});

test('clipRect normalises and clips', () => {
  G.setMapSize(128);
  assert.deepEqual(G.clipRect({ x0: 10, y0: 5, x1: -3, y1: 200 }), { x0: 0, y0: 5, x1: 10, y1: 127 });
  assert.equal(G.clipRect({ x0: 200, y0: 200, x1: 300, y1: 300 }), null);
  assert.equal(G.rectArea({ x0: 3, y0: 3, x1: 1, y1: 1 }), 9);
});
