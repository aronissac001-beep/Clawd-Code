// The determinism suite (14.4 (a)-(e)) on the Stage 0 stub world, in Node. The same suite runs in
// WebKit via tools/determinism-webkit.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSuite } from '../determinism-lib.mjs';
test('determinism suite passes on the stubs (Node)', async () => {
  const r = await runSuite({ ticks: 1500, engine: 'node-test' });
  for (const c of r.checks) assert.ok(c.ok, `${c.name} ${c.detail}`);
});
