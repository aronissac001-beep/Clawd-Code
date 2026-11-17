import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashString as h1, RNG } from '../../js/engine/rng.js';
import { hashString as h2, initStreams, rnd, rint } from '../../js/game/core/rand.js';
test('core rand is bit-identical to the reused engine RNG', () => {
  for (const t of ['', 'a', 'EMBER-1234', 'gen:river']) assert.equal(h2(t), h1(t));
  const r = new RNG(12345), s = { rng: { main: 12345 } };
  for (let i = 0; i < 1000; i++) assert.equal(rnd(s, 'main'), r.next());
  const s2 = { rng: initStreams('X') };
  for (let i = 0; i < 1000; i++) { const v = rint(s2, 'gen', 3, 9); assert.ok(v >= 3 && v <= 9); }
});
