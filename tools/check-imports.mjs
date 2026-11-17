// Gate check "Imports" (14.4, from Stage 0).
//   node tools/check-imports.mjs [--legacy] [--json] [--quiet]
// For every module under js/:
//   1. its imports resolve to files that exist;
//   2. js/game/ never imports js/engine/render/ (or the old js/engine/render.js) or js/main.js;
//   3. sim purity (14.1) for js/game/ except controller.js, tools/ and save/: no Math.random, Date,
//      performance.now, requestAnimationFrame or timers, and no reads of s.rt.render;
//   4. it imports headless in Node (own child process) with no side effects: no throw, no
//      map-sized allocation (>= 4096 elements), no new globals, no timers and no console output.
// Files whose content still equals the roguelite baseline (tools/legacy-baseline.json) are LEGACY:
// they await adaptation by their owner and only produce warnings (rules 1-3; rule 4 with --legacy).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const baseline = JSON.parse(readFileSync(join(ROOT, 'tools/legacy-baseline.json'), 'utf8')).files;

const files = walk(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).sort();
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const PURITY_EXEMPT = [/^js\/game\/controller\.js$/, /^js\/game\/tools\//, /^js\/game\/save\//];
const PURITY = [
  [/\bMath\.random\s*\(/, 'Math.random'], [/\bDate\.now\s*\(/, 'Date.now'], [/\bnew\s+Date\s*\(/, 'new Date'],
  [/\bperformance\.now\s*\(/, 'performance.now'], [/\brequestAnimationFrame\s*\(/, 'requestAnimationFrame'],
  [/\bset(?:Timeout|Interval|Immediate)\s*\(/, 'timer'], [/\brt\.render\b/, 's.rt.render (render-only)'],
];
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const specifiers = (src) => {
  const out = [];
  for (const m of src.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
};

const errors = [], warns = [];
let legacyCount = 0, checked = 0;
const probeList = [];
for (const f of files) {
  const r = rel(f);
  const buf = readFileSync(f);
  const legacy = baseline[r] === sha1(buf);
  if (legacy) legacyCount++; else checked++;
  const push = (msg) => (legacy ? warns : errors).push(`${r}: ${msg}`);
  const src = stripComments(buf.toString('utf8'));
  for (const sp of specifiers(src)) {
    if (!sp.startsWith('.')) { push(`bare import '${sp}' (no npm in the shipped game)`); continue; }
    const target = resolve(dirname(f), sp);
    const t = rel(target);
    if (!existsSync(target)) push(`import '${sp}' does not exist`);
    if (r.startsWith('js/game/') && (t.startsWith('js/engine/render/') || t === 'js/engine/render.js')) push(`js/game/ imports render code '${sp}'`);
    if (r.startsWith('js/game/') && t === 'js/main.js') push('js/game/ imports js/main.js');
  }
  if (r.startsWith('js/game/') && !PURITY_EXEMPT.some((re) => re.test(r))) {
    for (const [re, what] of PURITY) if (re.test(src)) push(`sim purity: uses ${what}`);
  }
  if (!legacy || args.has('--legacy')) probeList.push({ r, legacy });
}

const PROBE = join(ROOT, 'tools/lib/import-probe.mjs');
for (const { r, legacy } of probeList) {
  const p = spawnSync(process.execPath, [PROBE, join(ROOT, r)], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
  const push = (msg) => (legacy ? warns : errors).push(`${r}: ${msg}`);
  let rep = null;
  try { rep = JSON.parse(p.stdout.trim().split('\n').pop()); } catch (_) { push(`import probe failed: ${(p.stderr || p.stdout || '').slice(0, 300)}`); continue; }
  if (!rep.ok) push(`does not import headless: ${rep.error}`);
  for (const a of rep.allocs) push(`map-sized allocation at import: ${a}`);
  if (rep.globals.length) push(`adds globals at import: ${rep.globals.join(', ')}`);
  if (rep.timers) push(`starts ${rep.timers} timer(s) at import`);
  if (rep.console) push(`writes to the console at import (${rep.console}x)`);
}

if (args.has('--json')) {
  console.log(JSON.stringify({ ok: !errors.length, checked, legacy: legacyCount, errors, warnings: warns }, null, 1));
} else {
  if (!args.has('--quiet')) for (const w of warns) console.log('warn  ' + w);
  for (const e of errors) console.log('ERROR ' + e);
  console.log(`check-imports: ${checked} module(s) checked, ${legacyCount} legacy (warnings: ${warns.length}), errors: ${errors.length}`);
}
process.exit(errors.length ? 1 : 0);
