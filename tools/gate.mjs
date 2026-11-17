// The gate (doc 14.4): runs every check that exists at the given stage. Must pass on every merge.
//   node tools/gate.mjs [--stage=0|1a|1b|2|3] [--no-browser] [--browser=webkit|chromium] [--strict]
// Exit 0 when every enforced check passes. A browser check whose browser is not installed reports
// UNAVAILABLE (a failure with --strict); --browser=chromium runs the browser checks in Chromium as
// a stand-in for WebKit (reported as such). Checks that start at a later stage are listed as
// "later"; checks not yet enforced at this stage run as INFO (their result never fails the gate).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const has = (f) => process.argv.includes(f);
const STAGES = ['0', '1a', '1b', '2', '3'];
const stage = arg('stage', '0');
if (!STAGES.includes(stage)) { console.error(`gate: unknown stage ${stage} (${STAGES.join(', ')})`); process.exit(2); }
const atLeast = (s) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
const browser = arg('browser', 'webkit');
const noBrowser = has('--no-browser');
const strict = has('--strict');

// Determinism runs the Stage 0 stub fixture in Stage 0, and the real sim from Stage 1a (A's slice log
// and the colony bot's log). Bot days: 5 in Stage 1a, 10 from Stage 1b (14.6, 14.7).
const detScenes = atLeast('1a') ? 'slice,bot' : 'stub';
const botDays = atLeast('1b') ? 10 : 5;
const CHECKS = [
  { name: 'Imports', starts: '0', file: 'tools/check-imports.mjs', args: ['--quiet'] },
  { name: 'Unit tests', starts: '0', node: ['--test', 'tools/tests/**/*.test.mjs'] },
  { name: 'Data', starts: '0', file: 'tools/validate-data.mjs', owner: 'G' },
  { name: 'Determinism (Node)', starts: '0', file: 'tools/determinism.mjs', args: [`--scenes=${detScenes}`] },
  { name: `Determinism (${browser === 'webkit' ? 'WebKit' : browser + ' stand-in'})`, starts: '0', file: 'tools/determinism-webkit.mjs', args: [`--browser=${browser}`, `--scenes=${detScenes}`], browser: true },
  { name: 'Service worker', starts: '1a', file: 'tools/check-sw.mjs', args: noBrowser ? [] : ['--runtime', `--browser=${browser}`], infoBefore: true },
  { name: 'Phone UI', starts: '1a', file: 'tools/ui-phone.mjs', args: [`--browser=${browser}`, ...(atLeast('1a') ? [] : ['--flows=title'])], browser: true, infoBefore: true },
  { name: 'Bench', starts: '1a', file: 'tools/bench.mjs', args: atLeast('1a') ? ['--enforce', `--stage=${stage}`] : [], infoBefore: true },
  { name: 'Colony bot', starts: '1a', file: 'tools/colonybot.mjs', args: ['--seeds=1-5', `--days=${botDays}`] },
  { name: 'Persistence', starts: '1a', file: 'tools/persist.mjs', args: [`--browser=${browser}`], browser: true },
  { name: 'Render memory and battery', starts: '1a', file: 'tools/render-check.mjs', args: [`--browser=${browser}`], browser: true },
  { name: 'Balance report', starts: '2', file: 'tools/colonybot.mjs', args: ['--report'] },
];

const rows = [];
let failed = 0;
const t00 = Date.now();
for (const c of CHECKS) {
  const enforced = atLeast(c.starts);
  const info = !enforced && c.infoBefore;
  if (!enforced && !info) { rows.push([c.name, 'later', `starts at Stage ${c.starts}`]); continue; }
  if (c.browser && noBrowser) { rows.push([c.name, 'SKIP', '--no-browser']); continue; }
  if (c.file && !existsSync(join(ROOT, c.file))) {
    const status = enforced && !c.owner ? 'FAIL' : 'MISSING';
    if (status === 'FAIL') failed++;
    rows.push([c.name, status, `${c.file} does not exist yet${c.owner ? ` (owner ${c.owner})` : ''}`]);
    continue;
  }
  const t0 = Date.now();
  const p = spawnSync(process.execPath, c.node || [join(ROOT, c.file), ...(c.args || [])], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
  const ms = Date.now() - t0;
  const outLines = ((p.stdout || '') + (p.stderr || '')).trim().split('\n').filter(Boolean);
  let last = outLines.slice(-1)[0] || '';
  if (c.node) { const pass = outLines.find((l) => /^# pass/.test(l)), fail = outLines.find((l) => /^# fail/.test(l)); last = `${pass || ''} ${fail || ''}`.trim(); }
  let status;
  if (p.status === 0) status = info ? 'INFO ok' : 'PASS';
  else if (p.status === 2 && c.browser) { status = 'UNAVAILABLE'; if (strict && enforced) failed++; }
  else if (info) status = 'INFO over';
  else { status = 'FAIL'; failed++; }
  rows.push([c.name, status, `${last.slice(0, 150)} (${(ms / 1000).toFixed(1)} s)`]);
  if (status === 'FAIL' || status === 'INFO over') rows.push(['', '', outLines.filter((l) => /ERROR|FAIL|not ok|Error/.test(l)).slice(0, 10).map((l) => l.trim().slice(0, 220)).join('\n' + ' '.repeat(40))]);
}

const w = Math.max(...rows.map((r) => r[0].length));
console.log(`\nEmbercrown gate - Stage ${stage}${browser !== 'webkit' ? ` (browser checks in ${browser} as a WebKit stand-in)` : ''}\n`);
for (const [n, s, d] of rows) if (n || d) console.log(`${n.padEnd(w)}  ${s.padEnd(11)}  ${d}`);
const unavailable = rows.some((r) => r[1] === 'UNAVAILABLE');
console.log(`\ngate: ${failed ? `RED (${failed} failing)` : unavailable ? 'GREEN with UNAVAILABLE browser checks (install Playwright WebKit, or rerun with --browser=chromium)' : 'GREEN'} in ${((Date.now() - t00) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
