// Bench (gate 14.4; thresholds enforced from Stage 1a with --enforce). Desktop Node numbers.
//   node tools/bench.mjs [scene ...] [--enforce] [--stage=1a|1b|2|3 (default 1b)] [--json]
// The day-200 synthetic save numbers are the Stage 3 scale: before --stage=3 they are reported as
// warnings (the stage's own scene, bot day 5 in Stage 1a, carries the enforced save thresholds).
// Scenes
//   save    snapshot + deflate of the synthetic day-200 colony (tools/lib/synthetic.mjs); thresholds:
//           snapshot + deflate < 25 ms; blob size reported against the day-200 budget (< 100 KB)
//   tick    tick time of the registered systems on the synthetic colony (Stage 0: only stubs exist)
//   trunc   B's A* truncation check (0 of 400 reachable pairs truncated at 128); needs B's pathing API
//   bot     the colony bot's colony (tools/lib/bot.mjs, seed 1): Stage 1a, bot v0 at day 5: blob < 40 KB;
//           from Stage 1b, bot v1 at day 30: blob < 60 KB; from Stage 2, bot v2 (tools/lib/bot2.mjs, every
//           Stage 2 system) at day 30: blob < 60 KB. All: snapshot + deflate < 25 ms, and tick
//           p95 < 1.0 ms over the next 2,400 ticks with every system of the stage
//   maze    the tunnel-maze scene (B's stub map 'maze': solid rock cut by a perfect maze of 1-tile
//           tunnels, the worst case for A*; from Stage 1b): 400 reachable pairs searched directly (path
//           p95 < 1.5 ms, 0 truncated at the N/2 cap), then through the saved queue and the shared
//           budget (no search starts once 8,000 expansions are spent in a tick); and the hostile flow
//           field's whole build (< 0.6 ms) on the maze and on the bot's day-30 map. The result
//           carries the HPA-lite decision of 12.3: hierarchical paths are needed only if this misses.
//   maze3d  (Stage Z1 E3; tools/lib/bench3d.mjs) the prototype's 128 x 128 x 20 fortress: link-heuristic A* against
//           plain 3D A* on 400 pairs (same reachability, cost mean <= 1.08x and p95 <= 1.15x, link A* p95
//           < 0.6 ms, max expansions < 4,000, 0 over the 8,192 cap), the link Dijkstra (p95 < 0.3 ms, and the
//           batched mean of 100 runs per sample), the region full rebuild and 64 dirty clusters (6.2, reported)
//   miners6 (Stage Z1 E3) 6 miners tunnelling for 2 game hours on maze3d: link Dijkstra per tick p95 < 0.3 ms,
//           fewer than 1 linkStamp bump per 8 mined voxels
//   particles (W1.8; tools/lib/bench-particles.mjs) the pixel FX particles: no arc( / fillText in particles.js,
//           0 bytes allocated per frame by update + draw at 900 particles (node), draw time <= the W0 engine
//           at 900 particles (Chromium, 390 x 664 x 3); its failures fail the run even without --enforce
//   realmtick (W3.8; EMBERCROWN-WORLD.md 2.8) the season tick (js/game/realm/tick.js seasonStep) on 3 worlds with
//           history x 4 of their busiest regions x 30 seasons (300 days), after one warm-up season: p95 < 2 ms
//           desktop (2.8's < 5 ms on an A15) and the four delta arrays <= 16 KB at the end; only when named
//   Scenes may also be named with --scene=a,b.
// Default: save tick trunc bot, plus maze from Stage 1b.
import { syntheticColony } from './lib/synthetic.mjs';
import { snapshot, saveBlob, loadBlob } from '../js/game/save/colonysave.js';
import { encodeBlob, COMP } from '../js/game/save/codec.js';
import { tick } from '../js/game/core/sim.js';
import { stateHash } from '../js/game/core/state.js';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
let scenes = argv.filter((a) => !a.startsWith('--'));
for (const a of argv) if (a.startsWith('--scene=')) scenes.push(...a.slice(8).split(',').filter(Boolean));
const stageEarly = (argv.find((a) => a.startsWith('--stage=')) || '--stage=1b').split('=')[1];
if (!scenes.length) scenes = ['save', 'tick', 'trunc', 'bot', ...(['1b', '2', '3'].includes(stageEarly) ? ['maze'] : [])];
const out = { scenes: {}, failures: [] };
const p95 = (a) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * 0.95))]; };
const ms = (t0) => performance.now() - t0;
const fail = (msg) => out.failures.push(msg);
const STAGES = ['0', '1a', '1b', '2', '3'];
const stageArg = stageEarly;
const at1b = STAGES.indexOf(stageArg) >= STAGES.indexOf('1b');
const at2 = STAGES.indexOf(stageArg) >= STAGES.indexOf('2');
/** The bot's colony for the stage: v2 from Stage 2, else v1 (1b) or v0 (1a). */
async function stageBotColony(days) {
  if (at2) { const { runBot2 } = await import('./lib/bot2.mjs'); return (await runBot2({ seed: 1, days })).s; }
  const { botColony } = await import('./lib/bot.mjs'); return botColony(1, days, at1b ? '1b' : '1a');
}
out.warnings = [];
const failFrom = (st, msg) => (STAGES.indexOf(stageArg) >= STAGES.indexOf(st) ? fail(msg) : out.warnings.push(msg + ` (enforced from Stage ${st})`));

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
  if (r.snapshotP95ms + r.deflateP95ms >= 25) failFrom('3', `save: day-200 snapshot + deflate ${(r.snapshotP95ms + r.deflateP95ms).toFixed(1)} ms >= 25 ms`);
  if (r.blobKB >= 100) failFrom('3', `save: day-200 blob ${r.blobKB} KB >= 100 KB`);
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

let botMapForFlow = null;
if (scenes.includes('bot')) {
  const t00 = performance.now();
  const botDay = at1b ? 30 : 5, botKB = at1b ? 60 : 40;
  const s = await stageBotColony(botDay);
  botMapForFlow = s;
  const botMs = ms(t00);
  const snapT = [], defT = [];
  let blob = null;
  for (let k = 0; k < 23; k++) {
    const keep = k >= 3;
    let t0 = performance.now(); const snap = snapshot(s); if (keep) snapT.push(ms(t0));
    t0 = performance.now(); blob = await encodeBlob(snap.header, snap.payload, COMP.DEFLATE); if (keep) defT.push(ms(t0));
  }
  const t = [];
  for (let k = 0; k < 2400; k++) { const t0 = performance.now(); tick(s); t.push(ms(t0)); }
  const r = { day: Math.floor(s.tick / 14400), colonists: s.col.length, stacks: s.items.filter(Boolean).length, buildings: s.bld.filter(Boolean).length,
    blobKB: +(blob.length / 1024).toFixed(1), snapshotP95ms: +p95(snapT).toFixed(2), deflateP95ms: +p95(defT).toFixed(2), tickP95ms: +p95(t).toFixed(4), tickMaxMs: +Math.max(...t).toFixed(2), botRunMs: Math.round(botMs) };
  out.scenes.bot = r;
  r.stage = at2 ? '2' : at1b ? '1b' : '1a'; r.alive = s.col.filter((c) => !c.hp.dead).length;
  if (r.blobKB >= botKB) fail(`bot: day-${botDay} blob ${r.blobKB} KB >= ${botKB} KB`);
  if (r.snapshotP95ms + r.deflateP95ms >= 25) fail(`bot: snapshot + deflate ${(r.snapshotP95ms + r.deflateP95ms).toFixed(1)} ms >= 25 ms`);
  if (r.tickP95ms >= 1.0) fail(`bot: tick p95 ${r.tickP95ms} ms >= 1.0 ms`);
}

if (scenes.includes('maze')) {
  const P = await import('../js/game/systems/pathing.js');
  const r = await P.benchTruncation({ size: 128, pairs: 400, scene: 'maze', seed: 11, now: () => performance.now() });
  // the hostile flow field's whole build (H's buildFlowField with wall smashing), on the maze and on
  // the bot's map, to the Hearth (the 'core' goal); see flowTime for the rounds
  const F = await import('../js/game/threat/flow.js');
  const { createColony, initRuntime } = await import('../js/game/core/state.js');
  const { buildStubMap } = await import('../js/game/world/stubmap.js');
  const { N } = await import('../js/game/core/grid.js');
  // 3 rounds of 100 samples (after 30 JIT warm-ups); a sample is the fastest of 3 back-to-back builds
  // (the build allocates nothing, so the slower two only add preemption by other processes on a shared
  // machine), and the p95 is the best round's; every round's p95 and the raw single-build median are
  // reported. The build itself is the same work every time (same map, same goals).
  const flowTime = (st, goals) => {
    const out = new Uint16Array(N), rounds = [];
    let all = [];
    for (let k = 0; k < 30; k++) F.buildFlowField(st, goals, undefined, out, true);
    for (let rd = 0; rd < 3; rd++) {
      const t = [];
      for (let k = 0; k < 100; k++) {
        let best = Infinity;
        for (let m = 0; m < 3; m++) { const t0 = performance.now(); F.buildFlowField(st, goals, undefined, out, true); const d = ms(t0); all.push(d); if (d < best) best = d; }
        t.push(best);
      }
      rounds.push(+p95(t).toFixed(3));
    }
    let reached = 0; for (let i = 0; i < N; i++) if (out[i] !== F.FLOW_UNREACHED) reached++;
    return { p95ms: Math.min(...rounds), roundsP95: rounds, medianMs: +all.slice().sort((a, b) => a - b)[all.length >> 1].toFixed(3), maxms: +Math.max(...all).toFixed(3), reached };
  };
  const mz = createColony('MAZE-11', { w: 128 }); buildStubMap(mz, 'maze', 11); initRuntime(mz);
  let g0 = -1; for (let i = 0; i < N && g0 < 0; i++) if (P.blockedFor(mz, i, 1) === false) g0 = i;
  const flow = { maze: flowTime(mz, [g0]) };
  if (!botMapForFlow) botMapForFlow = await stageBotColony(at1b ? 30 : 5);
  const core = F.goalTiles(botMapForFlow, 'core');
  flow.botMap = core && core.length ? flowTime(botMapForFlow, core) : { skipped: 'no core goal tiles' };
  const q = r.queue;
  const pass = { p95: r.p95ms < 1.5, trunc: r.truncated === 0 && r.failed === 0, budget: q.startedAtMax < P.PATH.BUDGET && q.searchMax <= r.cap && q.delivered === r.pairs,
    flow: flow.maze.p95ms < 0.6 && (!flow.botMap.p95ms || flow.botMap.p95ms < 0.6) };
  r.flow = flow;
  // the worst queue tick: run-to-completion lets the last search started under the budget overshoot it
  // (12.3 by design); its time is estimated from the measured cost per expansion
  r.queue.worstTickMsEst = +((r.avgms / Math.max(1, r.expandedAvg)) * q.spentMaxPerTick).toFixed(3);
  // the same tick on an iPhone 13, from the 12.3 calibration (8,000 expansions ~ 1.5 ms on an A15)
  r.queue.worstTickA15MsEst = +(q.spentMaxPerTick * (1.5 / 8000)).toFixed(2);
  r.queue.overshootNote = q.spentMaxPerTick > P.PATH.BUDGET ? `run-to-completion overshoot: ${q.spentMaxPerTick} expansions in the worst tick (budget ${P.PATH.BUDGET}); a carried debt (next tick's budget minus the overshoot) would cap the 2-tick average at the budget` : 'no overshoot';
  r.hpaLite = pass.p95 && pass.trunc && pass.budget ? 'not needed: flat A* holds the budget on the tunnel maze (12.3); Stage 2 keeps flat A*'
    : 'NEEDED: the tunnel maze misses the A* budget; Stage 2 (B) adds hierarchical paths over region links (12.3)';
  out.scenes.maze = r;
  if (!pass.p95) failFrom('1b', `maze: path p95 ${r.p95ms} ms >= 1.5 ms`);
  if (!pass.trunc) failFrom('1b', `maze: ${r.truncated} truncated, ${r.failed} failed of ${r.pairs} reachable pairs`);
  if (!pass.budget) failFrom('1b', `maze: a search started at ${q.startedAtMax} expansions (budget ${P.PATH.BUDGET}), search max ${q.searchMax} (cap ${r.cap}), ${q.delivered}/${r.pairs} delivered`);
  if (!pass.flow) failFrom('1b', `maze: flow field whole build p95 ${flow.maze.p95ms} ms (maze) / ${flow.botMap.p95ms} ms (bot map) >= 0.6 ms`);
}

if (scenes.includes('maze3d') || scenes.includes('miners6')) {
  const B3 = await import('./lib/bench3d.mjs');
  for (const [name, fn] of [['maze3d', B3.runMaze3d], ['miners6', B3.runMiners6]]) {
    if (!scenes.includes(name)) continue;
    const { r, fails, warns = [] } = fn();
    out.scenes[name] = r;
    for (const f of fails) fail(f);
    for (const w of warns) out.warnings.push(w);
  }
}

if (scenes.includes('realmtick')) {
  const [{ installSim, foundColony, realmField }, { buildRealm }, { isEmbarkable }, T, { REALM_DELTA_CAP }] = await Promise.all([
    import('../js/game/core/setup.js'), import('../js/game/realm/gen.js'), import('../js/game/realm/query.js'), import('../js/game/realm/tick.js'), import('../js/game/core/schema.js')]);
  const times = [];
  let worstBytes = 0, holds = 0;
  for (let w = 1; w <= 3; w++) {
    const R = buildRealm({ seed: w }, { history: true }), busy = [];
    for (let i = 0; i < R.n * R.n; i++) {
      if (!isEmbarkable(R, i)) continue;
      const x = i % R.n, y = (i / R.n) | 0;
      let k = 0;
      for (const t of R.tables.sites) if (t.razed === null && Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 16) k++;
      busy.push([k, i]);
    }
    busy.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    for (const [, i] of busy.filter((_, j) => j % 97 === 0).slice(0, 4)) {
      installSim({ stage: '2', reset: true, checks: false });
      const s = foundColony({ seed: `BENCH-RT:${w}:${i}`, name: 'Bench Hold' });
      s.realm = realmField(R, i % R.n, (i / R.n) | 0); s.rt.realm = R; holds++;
      const warm = JSON.parse(JSON.stringify(s.realm));
      s.tick = T.SEASON_TICKS; T.realmTickSystem(s); s.realm = warm;   // warm-up: the travel field and the JIT
      for (let t = T.SEASON_TICKS; t <= 300 * 14400; t += T.SEASON_TICKS) { s.tick = t; const t0 = performance.now(); T.realmTickSystem(s); times.push(ms(t0)); }
      worstBytes = Math.max(worstBytes, T.deltaBytes(s.realm));
    }
  }
  const r = { holds, ticks: times.length, p95ms: +p95(times).toFixed(3), meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(3), maxMs: +Math.max(...times).toFixed(3), worstDeltaBytes: worstBytes };
  out.scenes.realmtick = r;
  if (!(r.p95ms < 2)) fail(`realmtick: season tick p95 ${r.p95ms} ms >= 2 ms`);
  if (worstBytes > REALM_DELTA_CAP) fail(`realmtick: deltas ${worstBytes} B > ${REALM_DELTA_CAP} B after 300 days`);
}

let hardFail = false;
if (scenes.includes('particles')) {
  const { runParticles } = await import('./lib/bench-particles.mjs');
  const { r, fails, warns } = await runParticles({ browserName: (argv.find((a) => a.startsWith('--browser=')) || '--browser=chromium').split('=')[1] });
  out.scenes.particles = r;
  for (const f of fails) fail(f);
  for (const w of warns) out.warnings.push(w);
  hardFail = fails.length > 0;
}

if (flags.has('--json')) console.log(JSON.stringify(out, null, 1));
else {
  for (const [k, v] of Object.entries(out.scenes)) console.log(`${k}: ${JSON.stringify(v)}`);
  for (const f of out.failures) console.log((flags.has('--enforce') ? 'FAIL ' : 'over ') + f);
  for (const w of out.warnings) console.log('warn ' + w);
  console.log(`bench: ${out.failures.length ? out.failures.length + ' threshold(s) missed' : 'all thresholds met'}${out.warnings.length ? `, ${out.warnings.length} warning(s)` : ''}${flags.has('--enforce') ? '' : ' (not enforced before Stage 1a)'}`);
}
process.exit((flags.has('--enforce') && out.failures.length) || hardFail ? 1 : 0);
