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
