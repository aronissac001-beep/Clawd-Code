// Gate check "Imports" (14.4, from Stage 0).
//   node tools/check-imports.mjs [--json] [--quiet]
// For every module under js/:
//   1. its imports resolve to files that exist;
//   2. js/game/ never imports js/engine/render/ (or the old js/engine/render.js) or js/main.js;
//   3. sim purity (14.1) for js/game/ except controller.js, tools/ and save/: no Math.random, Date,
//      performance.now, requestAnimationFrame or timers, and no reads of s.rt.render;
//   4. it imports headless in Node (own child process) with no side effects: no throw, no
//      map-sized allocation (>= 4096 elements), no new globals, no timers and no console output.
// Every module is held to every rule: the roguelite's legacy baseline (and its warning-only mode) went
// with the roguelite itself in Stage 2.9 (EMBERCROWN-FORTRESS.md 1.1).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (p) => relative(ROOT, p).split('\\').join('/');

const files = walk(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).sort();
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

const errors = [];
const push = (r, msg) => errors.push(`${r}: ${msg}`);
for (const f of files) {
  const r = rel(f);
  const src = stripComments(readFileSync(f, 'utf8'));
  for (const sp of specifiers(src)) {
    if (!sp.startsWith('.')) { push(r, `bare import '${sp}' (no npm in the shipped game)`); continue; }
    const target = resolve(dirname(f), sp);
    const t = rel(target);
    if (!existsSync(target)) push(r, `import '${sp}' does not exist`);
    if (r.startsWith('js/game/') && (t.startsWith('js/engine/render/') || t === 'js/engine/render.js')) push(r, `js/game/ imports render code '${sp}'`);
    if (r.startsWith('js/game/') && t === 'js/main.js') push(r, 'js/game/ imports js/main.js');
  }
  if (r.startsWith('js/game/') && !PURITY_EXEMPT.some((re) => re.test(r))) {
    for (const [re, what] of PURITY) if (re.test(src)) push(r, `sim purity: uses ${what}`);
  }
}

const PROBE = join(ROOT, 'tools/lib/import-probe.mjs');
for (const f of files) {
  const r = rel(f);
  const p = spawnSync(process.execPath, [PROBE, join(ROOT, r)], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
  let rep = null;
  try { rep = JSON.parse(p.stdout.trim().split('\n').pop()); } catch (_) { push(r, `import probe failed: ${(p.stderr || p.stdout || '').slice(0, 300)}`); continue; }
  if (!rep.ok) push(r, `does not import headless: ${rep.error}`);
  for (const a of rep.allocs) push(r, `map-sized allocation at import: ${a}`);
  if (rep.globals.length) push(r, `adds globals at import: ${rep.globals.join(', ')}`);
  if (rep.timers) push(r, `starts ${rep.timers} timer(s) at import`);
  if (rep.console) push(r, `writes to the console at import (${rep.console}x)`);
}

if (args.has('--json')) {
  console.log(JSON.stringify({ ok: !errors.length, checked: files.length, errors }, null, 1));
} else {
  for (const e of errors) console.log('ERROR ' + e);
  console.log(`check-imports: ${files.length} module(s) checked, errors: ${errors.length}`);
}
process.exit(errors.length ? 1 : 0);
