// J's tooling (owner J): the service-worker module graph parser and the colony bot's contract
// (it only sends commands: replaying its log reproduces its run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specifiers } from '../check-sw.mjs';
import { runBot, botFound } from '../lib/bot.mjs';
import { runLog } from './slice-scene.mjs';
import { stateHash } from '../../js/game/core/state.js';

test('check-sw: module specifiers (static, re-export, bare, dynamic) and no commented-out imports', () => {
  const src = [
    "// header that mentions js/game/* and a path '/*' in prose",
    "import { a, b } from './a.js';",
    "import * as N from '../n.js'; export { x } from './x.js';",
    "export * from './star.js';",
    "import './side.js';",
    "const m = () => import('./dyn.js');",
    "// import { gone } from './gone.js';",
    " * import { doc } from './doc.js';",
    "import { ext } from 'node:fs';",
  ].join('\n');
  assert.deepEqual(specifiers(src).sort(), ['../n.js', './a.js', './dyn.js', './side.js', './star.js', './x.js']);
});

test('colony bot: replaying its command log reproduces its run (it never writes state)', async () => {
  const r = await runBot({ seed: 3, ticks: 3000 });
  assert.ok(r.log.length >= 8, `bot sent ${r.log.length} commands`);
  assert.equal(r.refused.length, 0, JSON.stringify(r.refused.slice(0, 3)));
  const s0 = botFound(3);
  const s = await runLog(s0, r.log, s0.tick + 3000);
  assert.equal(stateHash(s), r.hash);
});

test('colony bot v2 (Stage 2 policy): only commands, so its log replays its run; roles, research and bills come from the policy', async () => {
  const { runBot2 } = await import('../lib/bot2.mjs');
  const { installSim } = await import('../../js/game/core/setup.js');
  const r = await runBot2({ seed: 2, ticks: 14400 });
  const kinds = new Set(r.log.map(([, c]) => c.t));
  for (const k of ['role', 'research', 'designate', 'zone']) assert.ok(kinds.has(k), `the policy sent no ${k} command (${[...kinds].join(',')})`);
  installSim({ stage: '2' });
  const s0 = botFound(2, '2');
  const s = await runLog(s0, r.log, s0.tick + 14400);
  assert.equal(stateHash(s), r.hash);
  installSim({ stage: '1b' });
});

test('soak judge: flags a growing state key, a cap overrun and a missing tick figure', async () => {
  const { judgeSoak } = await import('../lib/bot2.mjs');
  const row = (day, k, caps) => ({ day, stacks: 10, blobKB: 20, sizes: { 'st.queue': 100, 'colony.log': k }, caps });
  const ok = { stacks: 10, chron: 5, letters: 1, history: 3, zones: 4, flow: 0 };
  const r = { days: 300, metrics: { checks: [], stacks: 10, tickP95End: 0.4, tickMaxEnd: 1, series: [row(100, 1000, ok), row(200, 1000, ok), row(300, 1100, ok)] } };
  assert.ok(judgeSoak(r).every((c) => c.ok), JSON.stringify(judgeSoak(r)));
  r.metrics.series[2] = row(300, 90000, { ...ok, letters: 13 });
  const bad = judgeSoak(r).filter((c) => !c.ok).map((c) => c.name);
  assert.ok(bad.some((n) => /growth/.test(n)) && bad.some((n) => /caps/.test(n)), bad.join(','));
  delete r.metrics.tickP95End;
  assert.ok(judgeSoak(r).some((c) => !c.ok && /tick p95/.test(c.name)));
});
