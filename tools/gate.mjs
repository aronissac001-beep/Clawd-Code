// The gate (doc 14.4): runs every check that exists at the given stage. Must pass on every merge.
//   node tools/gate.mjs [--stage=0|1a|1b|2|2.9|z1|z2|z3|3 (default 2.9)] [--no-browser] [--browser=webkit|chromium] [--strict] [--quick]
// Exit 0 when every enforced check passes. A browser check whose browser is not installed reports
// UNAVAILABLE (a failure with --strict); --browser=chromium runs the browser checks in Chromium as
// a stand-in for WebKit (reported as such). Checks that start at a later stage are listed as
// "later"; checks not yet enforced at this stage run as INFO (their result never fails the gate).
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, unlinkSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const has = (f) => process.argv.includes(f);
const STAGES = ['0', '1a', '1b', '2', '2.9', 'z1', 'z2', 'z3', '3'];
const stage = arg('stage', '2.9');    // the current stage (14.8; EMBERCROWN-FORTRESS.md 8.2); pass --stage=2, 1b, 1a or 0 for the earlier sets
if (!STAGES.includes(stage)) { console.error(`gate: unknown stage ${stage} (${STAGES.join(', ')})`); process.exit(2); }
const atLeast = (s) => STAGES.indexOf(stage) >= STAGES.indexOf(s);
// Stage 2.9 ships on the Stage 2 engine: tools that take a sim stage get '2'
const simStage = stage === '2.9' || stage === 'z1' || stage === 'z2' || stage === 'z3' ? '2' : stage;
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
// Stage Z1 (EMBERCROWN-FORTRESS.md 8.3 E12): also 'fortress': bot v3 on a 128 x 128 x 20 fortress through day 8, saves (EC3) mid-raid.
const detScenes = atLeast('z1') ? 'slice,bot,raid,raid2,fortress' : atLeast('2') ? 'slice,bot,raid,raid2' : atLeast('1b') ? 'slice,bot,raid' : atLeast('1a') ? 'slice,bot' : 'stub';
const OUT = 'tools/out/colonybot';
const v2Days = quick ? 30 : 100;
const botDays = atLeast('1b') ? 10 : 5;
const CHECKS = [
  { name: 'Imports', starts: '0', file: 'tools/check-imports.mjs', args: ['--quiet'] },
  { name: 'Unit tests', starts: '0', node: ['--test', 'tools/tests/**/*.test.mjs'] },
  { name: 'Data', starts: '0', file: 'tools/validate-data.mjs', owner: 'G' },
  // Stage 2.9 (EMBERCROWN-FORTRESS.md 8.2): the four save fixtures (v1-1b-midraid and the three v2-s2 ones made by
  // 078cb71) migrate to state v3 and continue identically after a save and reload; and the removal greps are empty
  { name: 'Save fixtures (v1 + three v2, state v4)', starts: '2.9', node: ['--test', 'tools/tests/fixtures-v2.test.mjs', 'tools/tests/state-v3.test.mjs', 'tools/tests/save-2.test.mjs'] },
  { name: 'Removals (greps)', starts: '2.9', fn: () => removalGreps() },
  { name: 'Determinism (Node)', starts: '0', file: 'tools/determinism.mjs', args: [`--scenes=${detScenes}`] },
  { name: `Determinism (${browser === 'webkit' ? 'WebKit' : browser + ' stand-in'})`, starts: '0', file: 'tools/determinism-webkit.mjs', args: [`--browser=${browser}`, `--scenes=${detScenes}`], browser: true },
  { name: 'Service worker', starts: '1a', file: 'tools/check-sw.mjs', args: noBrowser ? [] : ['--runtime', `--browser=${browser}`], infoBefore: true },
  { name: 'Phone UI', starts: '1a', file: 'tools/ui-phone.mjs', args: [`--browser=${browser}`, ...(atLeast('1a') ? [] : ['--flows=title'])], browser: true, infoBefore: true },
  // Stage 2: every Stage 2 screen at every gate viewport and at 100% and 130% text (14.8 row I)
  { name: 'Phone UI (Stage 2 screens)', starts: '2', file: 'tools/ui-phone2.mjs', args: [`--browser=${browser}`, '--quick'], browser: true },
  { name: 'Bench', starts: '1a', file: 'tools/bench.mjs', args: atLeast('1a') ? ['--enforce', `--stage=${simStage}`] : [], infoBefore: true },
  { name: atLeast('2') ? 'Colony bot v1 (1b rules)' : 'Colony bot', starts: '1a', file: 'tools/colonybot.mjs', args: ['--seeds=1-5', `--days=${botDays}`, `--stage=${atLeast('1b') ? '1b' : '1a'}`] },
  { name: `Colony bot v2 (${v2Days} days)`, starts: '2', file: 'tools/colonybot.mjs', args: ['--stage=2', '--seeds=1-5', `--days=${v2Days}`, `--jobs=${quick ? 4 : 3}`, `--out=${OUT}/stage2.json`] },
  // Stage 2.9 (S9.7 oracle): survival, tier days and idle share within 10% of the S9.0 baseline (078cb71's own run)
  { name: 'Bot v2 against the S9.0 baseline', starts: '2.9', fn: () => botVsBaseline(), skip: quick ? '--quick' : null },
  // the soak runs for about half an hour: it starts in the background with the gate (one core) and is
  // read here
  { name: 'Soak (300 days)', starts: '2', file: 'tools/colonybot.mjs', args: ['--soak', '--seeds=1', '--days=300', `--out=${OUT}/soak.json`], skip: quick ? '--quick' : null, bg: true, timeout: 3600000 },
  // Stage Z1 (EMBERCROWN-FORTRESS.md 8.3, the Z1 gate): bot v3 on fortresses (item 1), the 3D generator's guarantees on
  // seeds 1-100 (E10), the Z1 bench scenes (E3, E11), the fortress render and level UI (E6, E7)
  // its "one raid fought below the surface" row is info since Z3 (a breach from below now needs a woken seep, Z3.1)
  { name: 'Colony bot v3 (fortress, 30 days)', starts: 'z1', file: 'tools/colonybot.mjs', args: ['--bot=v3', '--seeds=1-5', `--days=${quick ? 10 : 30}`, `--jobs=${quick ? 5 : 3}`, `--out=${OUT}/z1.json`] },
  { name: 'Mapgen3 (seeds 1-100)', starts: 'z1', file: 'tools/check-mapgen.mjs', args: [] },
  { name: 'Bench (Z1 scenes)', starts: 'z1', file: 'tools/bench.mjs', args: ['--scene=maze3d,miners6,hflow', '--stage=2'] },
  { name: 'Render (fortress)', starts: 'z1', file: 'tools/render-check.mjs', args: ['--fortress', `--browser=${browser}`], browser: true },
  { name: 'Phone UI (fortress)', starts: 'z1', file: 'tools/ui-phone.mjs', args: ['--fortress', `--browser=${browser}`], browser: true },
  // Stage Z2 (EMBERCROWN-FORTRESS.md 8.4, the Z2 gate; step Z2.11): bot v4 for 200 days on seeds 1-5 with every Z2
  // row (people, offices, renown and the winch, military, burial, halls and petitions, justice, the Annals), save
  // < 110 KB and tick p95 < 1.0 ms; it runs in the background from the start (about half an hour on 3 cores)
  { name: `Colony bot v4 (fortress, ${quick ? 60 : 200} days)`, starts: 'z2', file: 'tools/colonybot.mjs', args: ['--bot=v4', '--seeds=1-5', `--days=${quick ? 60 : 200}`, '--jobs=2', `--out=${OUT}/z2.json`], bg: true, startAfter: 'Bench', timeout: 5400000, ends: 'z2' },
  // Stage Z3 (EMBERCROWN-FORTRESS.md 8.5, step Z3.6): the same bot for 300 days on seeds 1-5 with every Z3 system on
  // (deep causes, cavern packs, the Lamplost, breaches, great beasts, fluids): save < 130 KB, stacks < 2,500, tick
  // p95 < 1.2 ms, the fluid active set < 4,096 at every tick; the Z2 rows and the Z3 balance report as info. It
  // replaces the 200-day v4 row (about 90 min on 3 cores, from the Bench on)
  { name: `Z3 soak (bot v4, ${quick ? 60 : 300} days, seeds 1-5)`, starts: 'z3', file: 'tools/colonybot.mjs', args: ['--stage=z3', '--bot=v4', '--seeds=1-5', `--days=${quick ? 60 : 300}`, '--jobs=3', `--out=${OUT}/z3.json`], bg: true, startAfter: 'Bench', timeout: 9000000 },
  // determinism and cache-drop mid-flood and mid-beast (the Z3 gate) and the Z3 phone flows (Z3.5)
  { name: 'Z3 mid-flood and mid-beast (save, cache drop)', starts: 'z3', node: ['--test', 'tools/tests/z3-midflood.test.mjs'] },
  { name: 'Phone UI (Z3 threats on levels)', starts: 'z3', file: 'tools/ui-phone-z3.mjs', args: [`--browser=${browser}`], browser: true },
  { name: 'Persistence', starts: '1a', file: 'tools/persist.mjs', args: [`--browser=${browser}`], browser: true },
  { name: 'Render memory and battery', starts: '1a', file: 'tools/render-check.mjs', args: [`--browser=${browser}`], browser: true },
  { name: 'Balance report', starts: '2', file: 'tools/colonybot.mjs', args: ['--report', `--from=${OUT}/stage2.json,${OUT}/soak.json`, '--jobs=4', `--out=${OUT}/balance.json`, ...(quick ? ['--no-soak'] : [])], owner: 'F', skip: quick ? '--quick' : null },
];

// ---- Stage 2.9 checks (EMBERCROWN-FORTRESS.md 8.2) -----------------------------------------------------------------
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const relOf = (p) => p.slice(ROOT.length + 1).split('\\').join('/');
/** The 8.2 greps: what each finds must be only the files listed (the storage row; the migration and compat code). */
const GREPS = [
  { what: 'classic (S9.2)', re: /classic/, in: ['js', 'sw.js', 'index.html'], allow: ['js/game/save/slots.js', 'js/ui/colonies.js', 'js/main.js'], why: 'the one-release Old roguelite saves row' },
  { what: 'ironhold|pendingChoices|challenge|lordsDone|wonder (S9.5)', re: /ironhold|pendingChoices|challenge|lordsDone|wonder/, in: ['js'], allow: ['js/game/core/state.js', 'js/game/core/schema.js'], why: 'migration code' },
  { what: 'roguelite tables and pickers (1.1, 1.2)', re: /\b(MATCHUPS|DEFAULT_MODS|takePerk|letter_charter)\b|kind: 'perk'/, in: ['js'], allow: [], why: '' },
];
function removalGreps() {
  const bad = [];
  if (existsSync(join(ROOT, 'classic'))) bad.push('classic/ exists');
  for (const g of GREPS) {
    const files = g.in.flatMap((p) => { const a = join(ROOT, p); return statSync(a).isDirectory() ? walk(a).filter((f) => f.endsWith('.js')) : [a]; });
    for (const f of files) {
      const r = relOf(f);
      if (g.allow.includes(r)) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => { if (g.re.test(l)) bad.push(`${g.what}: ${r}:${i + 1}`); });
    }
  }
  return bad.length ? { ok: false, detail: `${bad.length} hits`, lines: bad } : { ok: true, detail: `${GREPS.length + 1} greps empty outside ${[...new Set(GREPS.flatMap((g) => g.allow))].length} allowed files (${GREPS.filter((g) => g.why).map((g) => g.why).join('; ')})` };
}
/** Means over the seeds of one stage2.json: survival (alive at the end), the Hamlet and Village days, idle share at 10 colonists. */
function botSummary(r) {
  const res = r.results || [];
  const mean = (f) => { const v = res.map(f); return v.reduce((a, b) => a + b, 0) / (v.length || 1); };
  const day = (x) => (x === null || x === undefined ? r.days : x);   // a tier never reached counts as the last day
  return {
    seeds: res.map((x) => x.seed), days: r.days,
    alive: mean((x) => x.metrics.colonists.alive), hamletDay: mean((x) => day(x.metrics.hamletDay)), villageDay: mean((x) => day(x.metrics.villageDay)),
    idle10: mean((x) => x.metrics.idle10 || 0),
  };
}
const BASELINE = 'tools/fixtures/v2-bot-baseline.json';
function botVsBaseline() {
  const base = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8'));
  const cur = botSummary(JSON.parse(readFileSync(join(ROOT, OUT, 'stage2.json'), 'utf8')));
  if (cur.days !== base.summary.days || cur.seeds.join() !== base.summary.seeds.join()) return { ok: false, detail: `ran seeds ${cur.seeds} for ${cur.days} days; the baseline is seeds ${base.summary.seeds} for ${base.summary.days}` };
  const rows = ['alive', 'hamletDay', 'villageDay', 'idle10'].map((k) => {
    const b = base.summary[k], c = cur[k], d = b ? (c - b) / b : 0;
    // Stage 2.9b changes behaviour on purpose: survival and idle share are held one-sided (no worse than 10%),
    // tier days stay within 10% both ways
    return { k, b, c, d, ok: k === 'alive' ? d >= -0.10 : k === 'idle10' ? d <= 0.10 : Math.abs(d) <= 0.10 };
  });
  const f = (x, k) => (k === 'idle10' ? `${(x * 100).toFixed(1)}%` : x.toFixed(k === 'alive' ? 1 : 2));
  const detail = rows.map((x) => `${x.k} ${f(x.c, x.k)} vs ${f(x.b, x.k)} (${x.d >= 0 ? '+' : ''}${(x.d * 100).toFixed(1)}%)`).join(', ');
  return { ok: rows.every((x) => x.ok), detail: `${detail}; baseline ${base.commit}`, lines: rows.filter((x) => !x.ok).map((x) => `FAIL ${x.k} worse than the baseline by more than 10%`) };
}

// the balance report reads this run's v2 and soak results: clear the old ones first
if (atLeast('2') && !quick) for (const f of ['stage2.json', 'soak.json']) { try { unlinkSync(join(ROOT, OUT, f)); } catch (_) { /* none yet */ } }

// background checks: started now, each writing to tools/out/gate/<n>.log, read at their row
// a check with `startAfter` starts once that row has run (bot v4 waits for the Bench, which is timed and must not share
// the CPU with more than the soak)
const bgRuns = new Map();
const retired = (c) => !!c.ends && STAGES.indexOf(stage) > STAGES.indexOf(c.ends);
function startBg(after) {
for (const c of CHECKS) {
  if ((c.startAfter || null) !== after) continue;
  if (!c.bg || !atLeast(c.starts) || retired(c) || c.skip || (c.browser && noBrowser) || !existsSync(join(ROOT, c.file))) continue;
  mkdirSync(join(ROOT, 'tools/out/gate'), { recursive: true });
  const log = join(ROOT, 'tools/out/gate', c.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + '.log');
  const fd = openSync(log, 'w');
  const t0 = Date.now();
  const child = spawn(process.execPath, [join(ROOT, c.file), ...(c.args || [])], { cwd: ROOT, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const timer = setTimeout(() => child.kill('SIGKILL'), c.timeout || 1800000);
  bgRuns.set(c, new Promise((resolve) => child.on('exit', (code) => { clearTimeout(timer); resolve({ status: code, log, ms: Date.now() - t0 }); })));
}
}
startBg(null);

const rows = [];
let failed = 0;
const t00 = Date.now();
let prevRow = null;
for (const c of CHECKS) {
  if (prevRow) startBg(prevRow);
  prevRow = c.name;
  const enforced = atLeast(c.starts);
  const info = !enforced && c.infoBefore;
  if (!enforced && !info) { rows.push([c.name, 'later', `starts at Stage ${c.starts}`]); continue; }
  if (retired(c)) { rows.push([c.name, 'retired', `ran through Stage ${c.ends}; a later row covers it`]); continue; }
  if (c.browser && noBrowser) { rows.push([c.name, 'SKIP', '--no-browser']); continue; }
  if (c.skip) { rows.push([c.name, 'SKIP', c.skip]); continue; }
  if (c.fn) {
    const t0 = Date.now();
    let r;
    try { r = c.fn(); } catch (e) { r = { ok: false, detail: String(e && e.message || e) }; }
    const st = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) failed++;
    rows.push([c.name, st, `${r.detail} (${((Date.now() - t0) / 1000).toFixed(1)} s)`]);
    if (!r.ok && r.lines && r.lines.length) rows.push(['', '', r.lines.slice(0, 12).join('\n' + ' '.repeat(40))]);
    continue;
  }
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
