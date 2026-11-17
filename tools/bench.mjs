// Bench (gate 14.4; thresholds enforced from Stage 1a with --enforce). Desktop Node numbers.
//   node tools/bench.mjs [scene ...] [--enforce] [--json]
// Scenes
//   save    snapshot + deflate of the synthetic day-200 colony (tools/lib/synthetic.mjs); thresholds:
//           snapshot + deflate < 25 ms; blob size reported against the day-200 budget (< 100 KB)
//   tick    tick time of the registered systems on the synthetic colony (Stage 0: only stubs exist)
//   trunc   B's A* truncation check (0 of 400 reachable pairs truncated at 128); needs B's pathing API
//   legacy  the Stage 0 measurement scripts on the old engine (tools/bench/legacy/, run from classic/)
// Default: save tick trunc.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { syntheticColony } from './lib/synthetic.mjs';
import { snapshot, saveBlob, loadBlob } from '../js/game/save/colonysave.js';
import { encodeBlob, COMP } from '../js/game/save/codec.js';
import { tick } from '../js/game/core/sim.js';
import { stateHash } from '../js/game/core/state.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
let scenes = argv.filter((a) => !a.startsWith('--'));
if (!scenes.length) scenes = ['save', 'tick', 'trunc'];
const out = { scenes: {}, failures: [] };
const p95 = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * 0.95))]; };
const ms = (t0) => performance.now() - t0;
const fail = (msg) => out.failures.push(msg);

if (scenes.includes('save')) {
  const { s, mined } = syntheticColony();
  const snapT = [], defT = [], rleT = [];
  let blob = null, rle = null, rawLen = 0;
  // 3 warm-up iterations (first-use compilation) are not counted, then 40 measured ones (p95 = 3rd worst).
  for (let k = 0; k < 43; k++) {
    const keep = k >= 3;
    let t0 = performance.now(); const snap = snapshot(s); if (keep) snapT.push(ms(t0)); rawLen = snap.payload.length;
    t0 = performance.now(); blob = await encodeBlob(snap.header, snap.payload, COMP.DEFLATE); if (keep) defT.push(ms(t0));
    t0 = performance.now(); rle = await encodeBlob(snap.header, snap.payload, COMP.RLE); if (keep) rleT.push(ms(t0));
  }
  const back = await loadBlob(await saveBlob(s));
  const r = {
    colonists: s.col.length, stacks: s.items.length, buildings: s.bld.length, minedTiles: mined, flowFields: s.rt.flow.length,
    rawPayloadKB: +(rawLen / 1024).toFixed(1), blobKB: +(blob.length / 1024).toFixed(1), rleKB: +(rle.length / 1024).toFixed(1),
    snapshotP95ms: +p95(snapT).toFixed(2), deflateP95ms: +p95(defT).toFixed(2), rleP95ms: +p95(rleT).toFixed(2),
    roundTrip: stateHash(back) === stateHash(s),
  };
  out.scenes.save = r;
  if (!r.roundTrip) fail('save: load(save(s)) hash differs');
  if (r.snapshotP95ms + r.deflateP95ms >= 25) fail(`save: snapshot + deflate ${(r.snapshotP95ms + r.deflateP95ms).toFixed(1)} ms >= 25 ms`);
  if (r.blobKB >= 100) fail(`save: day-200 blob ${r.blobKB} KB >= 100 KB`);
}

if (scenes.includes('tick')) {
  const { s } = syntheticColony();
  const t = [];
  for (let k = 0; k < 400; k++) { const t0 = performance.now(); tick(s); t.push(ms(t0)); }
  out.scenes.tick = { ticks: t.length, p95ms: +p95(t).toFixed(4), note: 'Stage 0: only the core tick and endOfTick exist (no systems registered)' };
  if (p95(t) >= 1.0) fail(`tick: p95 ${p95(t).toFixed(3)} ms >= 1.0 ms`);
}

if (scenes.includes('trunc')) {
  // B provides `benchPairs(s, n)` or `astar` in js/game/systems/pathing.js once it is adapted to the colony map.
  let P = null;
  try { P = await import('../js/game/systems/pathing.js'); } catch (e) { P = { error: String(e.message || e).split('\n')[0] }; }
  if (P && typeof P.benchTruncation === 'function') {
    const r = await P.benchTruncation({ size: 128, pairs: 400 });
    out.scenes.trunc = r;
    if (r.truncated > 0) fail(`trunc: ${r.truncated} of ${r.pairs} reachable pairs truncated`);
  } else {
    out.scenes.trunc = { skipped: true, reason: P && P.error ? `pathing.js does not import: ${P.error}` : 'pathing.js has no benchTruncation({ size, pairs }) export yet (B, Stage 0)' };
  }
}

if (scenes.includes('legacy')) {
  const res = {};
  for (const [name, args] of [['bench', ['128']], ['trunc', ['128']], ['save', ['128']], ['stress', ['128']]]) {
    const p = spawnSync(process.execPath, [join(HERE, 'bench/legacy', name + '.mjs'), ...args], { encoding: 'utf8', timeout: 300000 });
    res[name] = (p.stdout || p.stderr || '').trim().split('\n').slice(-6);
  }
  out.scenes.legacy = res;
}

if (flags.has('--json')) console.log(JSON.stringify(out, null, 1));
else {
  for (const [k, v] of Object.entries(out.scenes)) console.log(`${k}: ${JSON.stringify(v)}`);
  for (const f of out.failures) console.log((flags.has('--enforce') ? 'FAIL ' : 'over ') + f);
  console.log(`bench: ${out.failures.length ? out.failures.length + ' threshold(s) missed' : 'all thresholds met'}${flags.has('--enforce') ? '' : ' (not enforced before Stage 1a)'}`);
}
process.exit(flags.has('--enforce') && out.failures.length ? 1 : 0);
