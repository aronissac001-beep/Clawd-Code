// The gate (doc 14.4): runs every check that exists at the given stage. Must pass on every merge.
//   node tools/gate.mjs [--stage=0|1a|1b|2|3 (default 2)] [--no-browser] [--browser=webkit|chromium] [--strict] [--quick]
// Exit 0 when every enforced check passes. A browser check whose browser is not installed reports
// UNAVAILABLE (a failure with --strict); --browser=chromium runs the browser checks in Chromium as
// a stand-in for WebKit (reported as such). Checks that start at a later stage are listed as
// "later"; checks not yet enforced at this stage run as INFO (their result never fails the gate).
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, unlinkSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const has = (f) => process.argv.includes(f);
const STAGES = ['0', '1a', '1b', '2', '3'];
const stage = arg('stage', '2');    // the current stage (14.8); pass --stage=1b, 1a or 0 for the earlier sets
if (!STAGES.includes(stage)) { console.error(`gate: unknown stage ${stage} (${STAGES.join(', ')})`); process.exit(2); }
const atLeast = (s) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
const browser = arg('browser', 'webkit');
const noBrowser = has('--no-browser');
const strict = has('--strict');
// --quick (Stage 2): the v2 bot for 30 days and no soak, for a fast local check; a merge runs the full set
const quick = has('--quick');

// Determinism runs the Stage 0 stub fixture in Stage 0, and the real sim from Stage 1a (A's slice log
// and the colony bot v0's log); from Stage 1b also the 'raid' scene (bot v1 through the first night,
// with saves at Sighted and with hostiles in melee). Bot: v0 for 5 days in Stage 1a, v1 for 10 days
// from Stage 1b (14.6, 14.7).
// From Stage 2 also 'raid2': bot v2 (the Stage 2 policy, every Stage 2 system) through day 8 on seed 1, with
// saves mid-raid. Stage 2 adds the v2 bot (100 days on seeds 1-5, four at a time), the 300-day soak and the
// balance report (14.4, 14.8 J); v1 keeps running its 1b targets as a regression check.
const detScenes = atLeast('2') ? 'slice,bot,raid,raid2' : atLeast('1b') ? 'slice,bot,raid' : atLeast('1a') ? 'slice,bot' : 'stub';
const OUT = 'tools/out/colonybot';
const v2Days = quick ? 30 : 100;
const botDays = atLeast('1b') ? 10 : 5;
const CHECKS = [
  { name: 'Imports', starts: '0', file: 'tools/check-imports.mjs', args: ['--quiet'] },
  { name: 'Unit tests', starts: '0', node: ['--test', 'tools/tests/**/*.test.mjs'] },
  { name: 'Data', starts: '0', file: 'tools/validate-data.mjs', owner: 'G' },
  { name: 'Determinism (Node)', starts: '0', file: 'tools/determinism.mjs', args: [`--scenes=${detScenes}`] },
  { name: `Determinism (${browser === 'webkit' ? 'WebKit' : browser + ' stand-in'})`, starts: '0', file: 'tools/determinism-webkit.mjs', args: [`--browser=${browser}`, `--scenes=${detScenes}`], browser: true },
  { name: 'Service worker', starts: '1a', file: 'tools/check-sw.mjs', args: noBrowser ? [] : ['--runtime', `--browser=${browser}`], infoBefore: true },
  { name: 'Phone UI', starts: '1a', file: 'tools/ui-phone.mjs', args: [`--browser=${browser}`, ...(atLeast('1a') ? [] : ['--flows=title'])], browser: true, infoBefore: true },
  // Stage 2: every Stage 2 screen at every gate viewport and at 100% and 130% text (14.8 row I)
  { name: 'Phone UI (Stage 2 screens)', starts: '2', file: 'tools/ui-phone2.mjs', args: [`--browser=${browser}`, '--quick'], browser: true },
  { name: 'Bench', starts: '1a', file: 'tools/bench.mjs', args: atLeast('1a') ? ['--enforce', `--stage=${stage}`] : [], infoBefore: true },
  { name: atLeast('2') ? 'Colony bot v1 (1b rules)' : 'Colony bot', starts: '1a', file: 'tools/colonybot.mjs', args: ['--seeds=1-5', `--days=${botDays}`, `--stage=${atLeast('1b') ? '1b' : '1a'}`] },
  { name: `Colony bot v2 (${v2Days} days)`, starts: '2', file: 'tools/colonybot.mjs', args: ['--stage=2', '--seeds=1-5', `--days=${v2Days}`, `--jobs=${quick ? 4 : 3}`, `--out=${OUT}/stage2.json`] },
  // the soak runs for about half an hour: it starts in the background with the gate (one core) and is
  // read here
  { name: 'Soak (300 days)', starts: '2', file: 'tools/colonybot.mjs', args: ['--soak', '--seeds=1', '--days=300', `--out=${OUT}/soak.json`], skip: quick ? '--quick' : null, bg: true, timeout: 3600000 },
  { name: 'Persistence', starts: '1a', file: 'tools/persist.mjs', args: [`--browser=${browser}`], browser: true },
  { name: 'Render memory and battery', starts: '1a', file: 'tools/render-check.mjs', args: [`--browser=${browser}`], browser: true },
  { name: 'Balance report', starts: '2', file: 'tools/colonybot.mjs', args: ['--report', `--from=${OUT}/stage2.json,${OUT}/soak.json`, '--jobs=4', `--out=${OUT}/balance.json`, ...(quick ? ['--no-soak'] : [])], owner: 'F', skip: quick ? '--quick' : null },
];

// the balance report reads this run's v2 and soak results: clear the old ones first
if (atLeast('2') && !quick) for (const f of ['stage2.json', 'soak.json']) { try { unlinkSync(join(ROOT, OUT, f)); } catch (_) { /* none yet */ } }

// background checks: started now, each writing to tools/out/gate/<n>.log, read at their row
const bgRuns = new Map();
for (const c of CHECKS) {
  if (!c.bg || !atLeast(c.starts) || c.skip || (c.browser && noBrowser) || !existsSync(join(ROOT, c.file))) continue;
  mkdirSync(join(ROOT, 'tools/out/gate'), { recursive: true });
  const log = join(ROOT, 'tools/out/gate', c.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '.log');
  const fd = openSync(log, 'w');
  const t0 = Date.now();
  const child = spawn(process.execPath, [join(ROOT, c.file), ...(c.args || [])], { cwd: ROOT, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const timer = setTimeout(() => child.kill('SIGKILL'), c.timeout || 1800000);
  bgRuns.set(c, new Promise((resolve) => child.on('exit', (code) => { clearTimeout(timer); resolve({ status: code, log, ms: Date.now() - t0 }); })));
}

const rows = [];
let failed = 0;
const t00 = Date.now();
for (const c of CHECKS) {
  const enforced = atLeast(c.starts);
  const info = !enforced && c.infoBefore;
  if (!enforced && !info) { rows.push([c.name, 'later', `starts at Stage ${c.starts}`]); continue; }
  if (c.browser && noBrowser) { rows.push([c.name, 'SKIP', '--no-browser']); continue; }
  if (c.skip) { rows.push([c.name, 'SKIP', c.skip]); continue; }
  if (c.file && !existsSync(join(ROOT, c.file))) {
    const status = enforced && !c.owner ? 'FAIL' : 'MISSING';
    if (status === 'FAIL') failed++;
    rows.push([c.name, status, `${c.file} does not exist yet${c.owner ? ` (owner ${c.owner})` : ''}`]);
    continue;
  }
  const t0 = Date.now();
  let p, ms;
  if (bgRuns.has(c)) { const r = await bgRuns.get(c); p = { status: r.status, stdout: readFileSync(r.log, 'utf8'), stderr: '' }; ms = r.ms; }
  else { p = spawnSync(process.execPath, c.node || [join(ROOT, c.file), ...(c.args || [])], { cwd: ROOT, encoding: 'utf8', timeout: c.timeout || 1800000, maxBuffer: 64 << 20 }); ms = Date.now() - t0; }
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
