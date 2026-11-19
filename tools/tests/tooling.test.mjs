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

test('balance report: XP rank days, the soak Grandmaster window, threat mix per storyteller', async () => {
  const { balanceReport } = await import('../lib/bot2.mjs');
  const res = (seed, master, gm, majors = [], st = null) => ({ seed, storyteller: st, metrics: { xp: { firstMaster: master, firstGrandmaster: gm, maxSkill: 16 }, majors, threatMix: Object.fromEntries(majors.map((m) => [m.inc, 1])), warnMinH: 12, majorGapMinD: 3, series: [{ day: 25, alive: 5, stacks: 90, blobKB: 30, wealth: 9000, tier: 1 }] } });
  const main = [res(1, 30, null, [{ inc: 'hollow_horde' }]), res(2, 41, null), res(3, 55, null)];
  const soak = { seed: 1, days: 300, ...res(1, 30, 150) };
  let { report, text } = balanceReport(main, soak, [res(1, 33, null, [{ inc: 'reaver_raid' }], 'wandering')]);
  assert.ok(report.ok, text);
  assert.ok(report.threatMix.steady && report.threatMix.wandering && report.threatMix.wandering.incidents.reaver_raid === 1, JSON.stringify(report.threatMix));
  main[1].metrics.xp.firstGrandmaster = 90;                      // a level 20 before day 100
  ({ report } = balanceReport(main, { ...soak, metrics: { ...soak.metrics, xp: { firstMaster: 30, firstGrandmaster: 230, maxSkill: 20 } } }));
  assert.deepEqual(report.checks.filter((c) => !c.ok).map((c) => c.name.slice(0, 12)), ['no level 20 ', 'soak: first ']);
});

test('summarise2: rows judged over the seeds ("4 of 5", "3 of 5"), only the bot\'s own rows enforced', async () => {
  const { summarise2 } = await import('../lib/bot2.mjs');
  const m = (ham, nemR) => ({ checks: [{ name: 'ran to the end', ok: true }], series: Array(100).fill(0), colonists: { alive: 5, peak: 6 }, deathCauses: {}, idle10: 0.2, unhauled: { violations: 0, worstH: 0 }, mood60: 50, hamletDay: ham, villageDay: null,
    majors: Array(14).fill({}), majorGapMinD: 3, warnMinH: 12, nemesis: { made: 1, returns: nemR, slain: 0 }, flowMax: 2, herd40: 5 });
  const rows = summarise2([20, 22, 24, 30, 21].map((h, k) => ({ metrics: m(h, k < 3 ? 1 : 0) })));
  const row = (n) => rows.find((x) => x.name.startsWith(n));
  assert.ok(row('Hamlet by day 25').ok, row('Hamlet by day 25').detail);      // 4 of 5
  assert.ok(row('a nemesis returns').ok);                                     // 3 of 5
  assert.ok(!row('Village by day 70').ok && !row('Village by day 70').enforced);
  assert.deepEqual(rows.filter((x) => x.enforced).map((x) => x.owner), ['J', 'J']);
});
