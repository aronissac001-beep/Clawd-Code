// Strings lint (W1.1, EMBERCROWN-WORLD.md 8.10 and 12.3; owner I).
//   node tools/check-strings.mjs [--json]
// 1. The table (js/ui/strings-en.js): keys are dotted ids; values are non-empty strings with well-formed
//    {name} placeholders and no emoji, or plural rows whose forms are exactly the categories that
//    Intl.PluralRules('en') reports for the row's type (cardinal: one, other; ordinal: one, two, few, other),
//    plus optional exact forms ("=0").
// 2. Every key a module asks for exists: every literal t('...') call in a js/ module that imports t from
//    js/ui/strings.js (also by alias or namespace), and in strings.js itself.
// 3. Every key is used. A call whose key is not a plain literal (t('speed.' + id)) is an error unless the
//    file declares the keys it can reach in a comment: "t-keys: speed.* menu.save" (exact keys, or prefixes
//    ending in ".*"); declared patterns count as uses and each must match at least one key.
// Exit 1 on any error.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, resolve, posix } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRINGS = 'js/ui/strings.js';
const TABLE = 'js/ui/strings-en.js';
const KEY_RE = /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-zA-Z0-9_]*)+$/;
const CATS = ['zero', 'one', 'two', 'few', 'many', 'other'];
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

/**
 * Split source into code (comments blanked, strings kept), mask (code with string, template-text and regex
 * interiors blanked too, template ${...} expressions kept) and comment text. Offsets match the source.
 */
export function splitSource(src) {
  const n = src.length, code = src.split(''), mask = src.split(''), comments = [];
  const blank = (arr, i, j) => { for (let k = i; k < j; k++) if (arr[k] !== '\n') arr[k] = ' '; };
  const stack = []; // open template-expression brace depths
  let i = 0, prev = '';
  const regexOk = () => prev === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(prev);
  const quoted = (q, at) => { let j = at + 1; while (j < n && src[j] !== q && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } return Math.min(j, n - 1); };
  const tmpl = (at) => { // from just after a backtick or a closing }: to the closing backtick or the next ${
    let j = at;
    while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) { if (src[j] === '\\') j++; j++; }
    blank(mask, at, Math.min(j, n));
    if (j < n && src[j] === '$') { stack.push(0); return j + 2; }
    return j + 1;
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; comments.push(src.slice(i + 2, j)); blank(code, i, j); blank(mask, i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; comments.push(src.slice(i + 2, j - 2)); blank(code, i, j); blank(mask, i, j); i = j; continue; }
    if (c === "'" || c === '"') { const j = quoted(c, i); blank(mask, i + 1, j); i = j + 1; prev = 'a'; continue; }
    if (c === '`') { i = tmpl(i + 1); prev = 'a'; continue; }
    if (c === '/' && regexOk()) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n' && (cls || src[j] !== '/')) { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      blank(mask, i + 1, j); i = j + 1; prev = 'a'; continue;
    }
    if (stack.length) {
      if (c === '{') stack[stack.length - 1]++;
      else if (c === '}') { if (stack[stack.length - 1] === 0) { stack.pop(); i = tmpl(i + 1); prev = 'a'; continue; } stack[stack.length - 1]--; }
    }
    if (!/\s/.test(c)) { const w = src.slice(i).match(/^[A-Za-z_$][\w$]*/); if (w) { prev = w[0]; i += w[0].length; continue; } prev = c; }
    i++;
  }
  return { code: code.join(''), mask: mask.join(''), comments: comments.join('\n') };
}

/** Local names under which a module's code reaches t: { calls: ['t', 'tr'], spaces: ['S'] }. */
export function importsOfT(code, fromFile) {
  const calls = [], spaces = [];
  for (const m of code.matchAll(/\bimport\s*([^'"`;]*?)\s*from\s*(['"])([^'"]+)\2/g)) {
    const spec = m[3];
    if (!spec.startsWith('.')) continue;
    const target = posix.normalize(posix.join(posix.dirname(fromFile), spec));
    if (target !== STRINGS) continue;
    const clause = m[1];
    const ns = clause.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/);
    if (ns) spaces.push(ns[1]);
    const named = clause.match(/\{([^}]*)\}/);
    if (named) for (const part of named[1].split(',')) {
      const p = part.trim().match(/^t(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (p) calls.push(p[1] || 't');
    }
  }
  return { calls, spaces };
}

/** The keys of every t call in code: { keys: [{ key, line }], dynamic: [line] }. */
export function scanCalls(code, names, spaces = [], mask = splitSource(code).mask) {
  const keys = [], dynamic = [];
  const esc = (s) => s.replace(/\$/g, '\\$');
  const heads = [...names.map((x) => `(?<![\\w$.])${esc(x)}`), ...spaces.map((x) => `(?<![\\w$.])${esc(x)}\\s*\\.\\s*t`)];
  if (!heads.length) return { keys, dynamic };
  const re = new RegExp(`(?<!function\\s+)(?:${heads.join('|')})\\s*\\(\\s*`, 'g');
  const lineAt = (i) => code.slice(0, i).split('\n').length;
  for (const m of mask.matchAll(re)) {
    const at = m.index + m[0].length, q = code[at], line = lineAt(m.index);
    if (q !== "'" && q !== '"' && q !== '`') { dynamic.push(line); continue; }
    let j = at + 1;
    while (j < code.length && code[j] !== q) { if (code[j] === '\\') j++; j++; }
    const lit = code.slice(at + 1, j);
    const next = code.slice(j + 1).match(/^\s*([,)])/);
    if (!next || /\\/.test(lit) || (q === '`' && lit.includes('${'))) { dynamic.push(line); continue; }
    keys.push({ key: lit, line });
  }
  return { keys, dynamic };
}

/** Declared t-keys patterns in comment text. */
export const declaredPatterns = (comments) => [...comments.matchAll(/\bt-keys:\s*([^\n]*)/g)].flatMap((m) => m[1].trim().split(/[\s,]+/).filter(Boolean));
const matches = (pat, key) => (pat.endsWith('.*') ? key.startsWith(pat.slice(0, -1)) : key === pat);

/** Errors in a strings table (an object of key -> row). */
export function validateTable(tbl) {
  const errs = [];
  const text = (k, s, where) => {
    if (typeof s !== 'string' || !s.length) { errs.push(`${k}${where}: not a non-empty string`); return; }
    const bare = s.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
    if (/[{}]/.test(bare)) errs.push(`${k}${where}: malformed placeholder in "${s}"`);
    if (/\p{Extended_Pictographic}/u.test(s)) errs.push(`${k}${where}: emoji in "${s}"`);
  };
  for (const [k, row] of Object.entries(tbl)) {
    if (!KEY_RE.test(k)) errs.push(`${k}: not a dotted id`);
    if (typeof row === 'string') { text(k, row, ''); continue; }
    if (!row || typeof row !== 'object' || Array.isArray(row)) { errs.push(`${k}: neither a string nor a plural row`); continue; }
    const type = row.type === undefined ? 'cardinal' : row.type;
    if (type !== 'cardinal' && type !== 'ordinal') { errs.push(`${k}: plural type "${type}"`); continue; }
    const need = new Intl.PluralRules('en', { type }).resolvedOptions().pluralCategories;
    for (const c of need) if (!(c in row)) errs.push(`${k}: plural row lacks "${c}"`);
    for (const [f, s] of Object.entries(row)) {
      if (f === 'type') continue;
      if (CATS.includes(f)) { if (!need.includes(f)) errs.push(`${k}: "${f}" is not an English ${type} category`); }
      else if (!/^=-?\d+$/.test(f)) { errs.push(`${k}: unknown plural form "${f}"`); continue; }
      text(k, s, `.${f}`);
    }
  }
  return errs;
}

/** The whole check on the repo (or on a given table and file set): { errors, keys, plural, files, used }. */
export function checkStrings({ table, files } = {}) {
  const errors = validateTable(table);
  const used = new Set(), patterns = [];
  let scanned = 0;
  for (const [file, src] of files) {
    const { code, mask, comments } = splitSource(src);
    const imp = file === STRINGS ? { calls: ['t'], spaces: [] } : importsOfT(code, file);
    if (!imp.calls.length && !imp.spaces.length) continue;
    scanned++;
    const { keys, dynamic } = scanCalls(code, imp.calls, imp.spaces, mask);
    const pats = declaredPatterns(comments);
    for (const { key, line } of keys) {
      if (!Object.prototype.hasOwnProperty.call(table, key)) errors.push(`${file}:${line}: missing key "${key}"`);
      used.add(key);
    }
    if (dynamic.length && !pats.length) for (const line of dynamic) errors.push(`${file}:${line}: t() key is not a literal and the file declares no "t-keys:" patterns`);
    for (const p of pats) patterns.push({ p, file });
  }
  const keys = Object.keys(table);
  for (const { p, file } of patterns) {
    const hit = keys.filter((k) => matches(p, k));
    if (!hit.length) errors.push(`${file}: t-keys pattern "${p}" matches no key`);
    for (const k of hit) used.add(k);
  }
  for (const k of keys) if (!used.has(k)) errors.push(`${TABLE}: unused key "${k}"`);
  const missing = errors.filter((e) => /missing key/.test(e)).length;
  return { errors, keys: keys.length, plural: keys.filter((k) => typeof table[k] === 'object').length, files: scanned, used: used.size, missing };
}

async function main() {
  const json = process.argv.includes('--json');
  const { EN } = await import(pathToFileURL(join(ROOT, TABLE)).href);
  const files = walk(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).sort().map((f) => [rel(f), readFileSync(f, 'utf8')]);
  const r = checkStrings({ table: EN, files });
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const e of r.errors) console.log('  ' + e);
    console.log(`strings: ${r.keys} keys (${r.plural} plural), ${r.files} files using t, ${r.missing} missing, ${r.keys - r.used} unused, ${r.errors.length} errors`);
  }
  process.exit(r.errors.length ? 1 : 0);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
