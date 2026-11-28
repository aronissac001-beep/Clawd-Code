// The mapgen determinism lint (EMBERCROWN-FORTRESS.md 2.2; Stage Z1 step E10, in the gate).
//   node tools/check-mapgen.mjs [--json]
// The world generators must give the same world on every engine (the pristine regeneration fallback, 5.1, and
// the Node / WebKit equality test), so their files may use only + - * / (exact under IEEE 754), integer ops,
// the repo's sinX and table lookups. Flagged in code (comments and strings are skipped):
//   Math.sin cos tan asin acos atan atan2 sinh cosh tanh exp expm1 pow log log2 log10 log1p sqrt cbrt hypot
//   fround random; the ** operator; Date and performance (wall-clock); Intl and toLocale* (locale).
// Files: js/game/world/mapgen*.js, js/data/worldgen.js and (W2.1) every file of js/game/realm/ and js/data/realm/. The D = 1 generator left the shipped game in Z2 (now
// tools/lib/mapgen1.js, tools and tests only; its hillPass Math.sqrt is correctly rounded by IEEE 754), so there
// are no allowances: the 3D generator compares squares instead.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANNED = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'exp', 'expm1', 'pow', 'log', 'log2', 'log10', 'log1p', 'sqrt', 'cbrt', 'hypot', 'fround', 'random'];
const ALLOW = {};   // none: the D = 1 generator (and its Math.sqrt) moved to tools/lib/mapgen1.js, out of the shipped game

/** Source with comments, strings and template literal text blanked (newlines kept, so line numbers hold). */
export function codeOnly(src) {
  let out = '', i = 0;
  const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; out += blank(src.slice(i, j)); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; out += blank(src.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += c + blank(src.slice(i + 1, j)) + (j < n ? c : ''); i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Findings for one file's source: [{ line, what }]. */
export function lintSource(src, rel = '') {
  const code = codeOnly(src), lines = code.split('\n'), out = [], allow = { ...(ALLOW[rel] || {}) };
  const re = new RegExp(`\\bMath\\s*\\.\\s*(${BANNED.join('|')})\\b|\\*\\*|\\b(Date|performance|Intl)\\b|\\.toLocale\\w*`, 'g');
  lines.forEach((ln, k) => {
    for (const m of ln.matchAll(re)) {
      const what = m[1] ? `Math.${m[1]}` : m[0];
      if (allow[what] > 0) { allow[what]--; continue; }
      out.push({ line: k + 1, what });
    }
  });
  return out;
}

export function lintAll() {
  const files = readdirSync(join(ROOT, 'js/game/world')).filter((f) => /^mapgen.*\.js$/.test(f)).map((f) => `js/game/world/${f}`).concat(['js/data/worldgen.js']);
  // the realm generators and their tables (EMBERCROWN-WORLD.md 1.2, W2.1): every file of js/game/realm/ and js/data/realm/
  for (const dir of ['js/game/realm', 'js/data/realm']) {
    if (existsSync(join(ROOT, dir))) files.push(...readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.js')).sort().map((f) => `${dir}/${f}`));
  }
  const findings = [];
  for (const rel of files) for (const f of lintSource(readFileSync(join(ROOT, rel), 'utf8'), rel)) findings.push({ file: rel, ...f });
  return { files, findings };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, findings } = lintAll();
  if (process.argv.includes('--json')) console.log(JSON.stringify({ files, findings }));
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.what} (inexact or non-deterministic in a world generator)`);
  console.log(`check-mapgen: ${findings.length ? 'FAIL' : 'OK'} - ${files.length} files, ${findings.length} findings`);
  process.exit(findings.length ? 1 : 0);
}
