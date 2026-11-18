// Gate check "Determinism" in Node (V8): node tools/determinism.mjs [--scenes=slice,bot,raid|stub] [--ticks=N] [--json]
// The suite lives in tools/determinism-lib.mjs and runs unchanged in WebKit (determinism-webkit.mjs).
// Scenes: 'stub' (the Stage 0 contract fixture, run alone: --scenes=stub), and from Stage 1a (default) the real sim: 'slice' (A's slice
// log, tools/tests/slice-scene.mjs) and 'bot' (the colony bot's command log, tools/lib/bot.mjs).
import { runAll } from './determinism-lib.mjs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const res = await runAll({ scenes: arg('scenes', 'slice,bot,raid').split(','), ticks: +arg('ticks', 3000), engine: 'node ' + process.version });
if (process.argv.includes('--json')) console.log(JSON.stringify(res));
else {
  for (const c of res.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  console.log(`determinism [${res.engine}]: ${res.ok ? 'PASS' : 'FAIL'}  hash ${res.hash}  ${res.ticks} ticks  ${res.ms} ms`);
}
process.exit(res.ok ? 0 : 1);
