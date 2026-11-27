// The strings layer (W1.1, EMBERCROWN-WORLD.md 8.10 and G25; owner I). Every new UI string goes through
// t(key, vars); old modules are converted when they are touched (W1.x, W7.7). English only for now: the
// table is strings-en.js. Pure and render-side: no DOM, no state, no sim reads, nothing at import time.
//   t('hud.clock.day', { n: 3 })     a string row with {name} placeholders filled from vars
//   t('unit.day', { n: 2 })          a plural row: the form is picked by Intl.PluralRules('en') on vars.n
//                                    (exact forms such as "=0" win); type: 'ordinal' rows use the ordinal rules
//   list(['Ada', 'Bo', 'Cy'])        "Ada, Bo and Cy"; list(names, 3) adds "and 2 others"
// A missing key renders as the key itself (visible, never a crash) and is remembered for missingKeys();
// a missing var leaves its {name} in place. Numbers are written with String(), so output never depends on
// the device locale. node tools/check-strings.mjs checks that every literal key exists and every key is used.
import { EN } from './strings-en.js';

let table = EN;
const missing = new Set();
const rules = {};

/** English plural rules without Intl (old engines): the same answers as Intl.PluralRules('en') (tested). */
export function englishPlural(n, type = 'cardinal') {
  const a = Math.abs(n);
  if (type === 'ordinal') {
    if (!Number.isInteger(a)) return 'other';
    const d = a % 10, c = a % 100;
    if (d === 1 && c !== 11) return 'one';
    if (d === 2 && c !== 12) return 'two';
    if (d === 3 && c !== 13) return 'few';
    return 'other';
  }
  return a === 1 ? 'one' : 'other';
}

/** The English plural category of n ('one', 'other'; ordinal also 'two', 'few'). */
export function pluralCategory(n, type = 'cardinal') {
  if (!(type in rules)) {
    let r = null;
    try { if (typeof Intl === 'object' && Intl.PluralRules) r = new Intl.PluralRules('en', { type }); } catch (e) { r = null; }
    rules[type] = r;
  }
  return rules[type] ? rules[type].select(n) : englishPlural(n, type);
}

const fill = (text, vars) => (vars ? text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : text);

/** The form of a plural row for count n. */
function form(row, n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return row.other;
  const exact = row['=' + n];
  if (exact !== undefined) return exact;
  const f = row[pluralCategory(n, row.type === 'ordinal' ? 'ordinal' : 'cardinal')];
  return f === undefined ? row.other : f;
}

/** The text for key, with vars filled in. */
export function t(key, vars) {
  const row = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  if (row === undefined) { missing.add(key); return key; }
  return fill(typeof row === 'string' ? row : form(row, vars ? vars.n : undefined), vars);
}

/** Whether the table has key. */
export const has = (key) => Object.prototype.hasOwnProperty.call(table, key);

/** Keys asked for at runtime that the table lacks (a dev and test aid), sorted. */
export const missingKeys = () => [...missing].sort();

/**
 * Names joined as English does: "A", "A and B", "A, B and C". With max, names past max become
 * "and N others" ("A, B, C and 2 others").
 */
export function list(items, max = Infinity) {
  const xs = items.map(String);
  let shown = xs, rest = 0;
  if (xs.length > max && max >= 1) { shown = xs.slice(0, max); rest = xs.length - max; }
  const tail = rest ? [...shown, t('list.more', { n: rest })] : shown;
  if (tail.length === 0) return '';
  if (tail.length === 1) return tail[0];
  let head = tail[0];
  for (let i = 1; i < tail.length - 1; i++) head = t('list.sep', { a: head, b: tail[i] });
  return t('list.pair', { a: head, b: tail[tail.length - 1] });
}

/** Swap the table (tests and a future second language); returns the previous one. Clears missingKeys(). */
export function useTable(next) {
  const prev = table;
  table = next || EN;
  missing.clear();
  return prev;
}
