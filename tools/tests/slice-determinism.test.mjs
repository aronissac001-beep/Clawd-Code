// Determinism (gate 14.4 (a)-(e)) on the Stage 1a slice, in Node (owner A; 14.6 row A). The same
// suite (tools/tests/slice-scene.mjs) runs unchanged in a Playwright WebKit page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSliceSuite } from './slice-scene.mjs';

test('slice: (a) repeat, (b) save/load at 5 ticks, (c) 1x = 5x, (d) reservations, (e) caches (Node)', async () => {
  const r = await runSliceSuite({ ticks: 2400, engine: 'node-test' });
  for (const c of r.checks) assert.ok(c.ok, `${c.name}: ${c.detail}`);
});
