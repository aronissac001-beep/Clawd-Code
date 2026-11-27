// W1.1 (EMBERCROWN-WORLD.md 8.10 and 12.3; owner I): the strings layer. t() fills {name} vars, picks plural
// forms with Intl.PluralRules('en') (exact "=n" forms first; ordinal rows by the ordinal rules), shows a
// missing key as the key; the no-Intl fallback agrees with Intl on English; list() joins names as the UI
// does; the lint finds literal keys (aliases, namespaces, not comments), rejects dynamic keys without a
// t-keys declaration, flags missing and unused keys and bad rows; and the repo passes it with 0 missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { t, has, list, missingKeys, useTable, pluralCategory, englishPlural } from '../../js/ui/strings.js';
import { EN } from '../../js/ui/strings-en.js';
import { checkStrings, validateTable, scanCalls, splitSource, importsOfT } from '../check-strings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NS = [...Array(202).keys()].map((i) => i - 1).concat([0.5, 1.5, 2.25, 11, 12, 13, 111, 112, 113, 1001, 1e6 + 1, -11, -21]);
const FIX = {
  'hud.clock.day': 'Day {n}',
  'unit.day': { one: '{n} day', other: '{n} days' },
  'people.count': { '=0': 'Nobody', one: '{n} soul', other: '{n} souls' },
  'rank.place': { type: 'ordinal', one: '{n}st', two: '{n}nd', few: '{n}rd', other: '{n}th' },
  'letter.from': '{who} writes from {where}.',
};

test('t fills vars, leaves unknown vars, shows a missing key as itself', () => {
  const prev = useTable(FIX);
  try {
    assert.equal(t('hud.clock.day', { n: 3 }), 'Day 3');
    assert.equal(t('letter.from', { who: 'Ada', where: 'Greyfold' }), 'Ada writes from Greyfold.');
    assert.equal(t('letter.from', { who: 'Ada' }), 'Ada writes from {where}.');
    assert.equal(t('hud.clock.day'), 'Day {n}');
    assert.equal(t('no.such.key'), 'no.such.key');
    assert.equal(t('toString'), 'toString'); // no prototype leaks
    assert.deepEqual(missingKeys(), ['no.such.key', 'toString']);
    assert.ok(has('unit.day') && !has('no.such.key'));
  } finally { useTable(prev); }
  assert.deepEqual(missingKeys(), []);
});

test('plural forms follow Intl.PluralRules(en), exact forms first, ordinal rows by ordinal rules', () => {
  const prev = useTable(FIX);
  try {
    assert.equal(t('unit.day', { n: 1 }), '1 day');
    assert.equal(t('unit.day', { n: 0 }), '0 days');
    assert.equal(t('unit.day', { n: 1.5 }), '1.5 days');
    assert.equal(t('people.count', { n: 0 }), 'Nobody');
    assert.equal(t('people.count', { n: 1 }), '1 soul');
    assert.equal(t('unit.day', {}), '{n} days'); // no count: "other"
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((n) => t('rank.place', { n })),
      ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  } finally { useTable(prev); }
});

test('Intl.PluralRules agrees on every English row (the real table and the fixture rows)', () => {
  let checked = 0;
  for (const tbl of [EN, FIX]) {
    const prev = useTable(tbl);
    try {
      for (const [k, row] of Object.entries(tbl)) {
        if (typeof row !== 'object') continue;
        const pr = new Intl.PluralRules('en', { type: row.type || 'cardinal' });
        assert.deepEqual(Object.keys(row).filter((f) => f !== 'type' && !f.startsWith('=')).sort(), [...pr.resolvedOptions().pluralCategories].sort(), k);
        for (const n of NS) {
          const want = (row['=' + n] !== undefined ? row['=' + n] : row[pr.select(n)]).replace('{n}', String(n));
          assert.equal(t(k, { n }), want, `${k} n=${n}`);
          checked++;
        }
      }
    } finally { useTable(prev); }
  }
  assert.ok(checked >= 4 * NS.length);
});

test('the no-Intl fallback gives the same categories as Intl on English', () => {
  for (const type of ['cardinal', 'ordinal']) {
    const pr = new Intl.PluralRules('en', { type });
    for (const n of NS.concat([...Array(1200).keys()])) {
      assert.equal(englishPlural(n, type), pr.select(n), `${type} ${n}`);
      assert.equal(pluralCategory(n, type), pr.select(n));
    }
  }
});

test('list joins names as the UI does', () => {
  assert.equal(list([]), '');
  assert.equal(list(['Ada']), 'Ada');
  assert.equal(list(['Ada', 'Bo']), 'Ada and Bo');
  assert.equal(list(['Ada', 'Bo', 'Cy']), 'Ada, Bo and Cy');
  assert.equal(list(['Ada', 'Bo', 'Cy', 'Di', 'Ed'], 3), 'Ada, Bo, Cy and 2 others');
  assert.equal(list(['Ada', 'Bo', 'Cy', 'Di'], 3), 'Ada, Bo, Cy and 1 other');
  assert.equal(list(['Ada', 'Bo', 'Cy'], 3), 'Ada, Bo and Cy');
  assert.deepEqual(missingKeys(), []);
});

test('the lint scanner: literal keys, aliases and namespaces, no comments, dynamic keys flagged', () => {
  const src = [
    "import { h } from './kit.js';",
    "import { t as tr, list } from './strings.js';",
    "import * as S from '../ui/strings.js';",
    "// tr('in.a.comment') is not a use",
    "/* tr('also.not') */",
    "const a = tr('hud.clock.day', { n: 3 }) + S.t(\"unit.day\", { n });",
    "const b = tr(`letter.from`);",
    "const c = tr('speed.' + id); const d = tr(key); const e = tr(`x.${y}`);",
    "const f = part('not.t'); const g = obj.tr('not.either');",
    "const u = 'tr(\"inside.a.string\")';",
  ].join('\n');
  const { code } = splitSource(src);
  const imp = importsOfT(code, 'js/ui/demo.js');
  assert.deepEqual(imp, { calls: ['tr'], spaces: ['S'] });
  const { keys, dynamic } = scanCalls(code, imp.calls, imp.spaces);
  assert.deepEqual(keys.map((k) => k.key), ['hud.clock.day', 'unit.day', 'letter.from']);
  assert.deepEqual(dynamic, [8, 8, 8]);
  assert.deepEqual(importsOfT(splitSource("import { t } from './other/strings.js';").code, 'js/ui/x.js'), { calls: [], spaces: [] });
  // calls inside template expressions count; quotes inside regex literals and template text do not derail it
  const src2 = "const re = /['\"`]/g; const x = `${a ? t('in.tmpl', { n: `${b}` }) : ''} t('tmpl.text')`; const y = n / 2; t('after.all');";
  const s2 = splitSource(src2);
  assert.deepEqual(scanCalls(s2.code, ['t'], [], s2.mask).keys.map((k) => k.key), ['in.tmpl', 'after.all']);
});

test('the lint: missing, unused, undeclared dynamic keys and bad rows are errors', () => {
  const files = [
    ['js/ui/a.js', "import { t } from './strings.js';\nt('hud.clock.day'); t('gone.key');"],
    ['js/ui/b.js', "// t-keys: rank.*\nimport { t } from './strings.js';\nt('rank.' + k);"],
    ['js/ui/c.js', "import { t } from './strings.js';\nt(k);"],
    ['js/ui/d.js', "// t-keys: nothing.*\nimport { t } from './strings.js';\nt(k);"],
  ];
  const r = checkStrings({ table: FIX, files });
  assert.equal(r.missing, 1);
  const has1 = (re) => assert.ok(r.errors.some((e) => re.test(e)), re);
  has1(/a\.js:2: missing key "gone\.key"/); has1(/c\.js:2: t\(\) key is not a literal/); has1(/"nothing\.\*" matches no key/);
  has1(/unused key "unit\.day"/); has1(/unused key "people\.count"/);
  assert.ok(!r.errors.some((e) => /rank\.place|hud\.clock\.day/.test(e)));
  const bad = validateTable({
    'Hud.x': 'a', 'nodot': 'a', 'a.empty': '', 'a.brace': 'Day {n', 'a.space': 'Day { n }', 'a.emoji': 'Fire \u{1F525}',
    'a.noother': { one: '{n} day' }, 'a.few': { one: 'a', few: 'b', other: 'c' }, 'a.ord': { type: 'ordinal', one: 'a', other: 'b' }, 'a.form': { one: 'a', other: 'b', lots: 'c' }, 'a.arr': ['x'],
  });
  for (const re of [/Hud\.x: not a dotted id/, /nodot: not a dotted id/, /a\.empty/, /a\.brace: malformed/, /a\.space: malformed/, /a\.emoji: emoji/, /a\.noother: plural row lacks "other"/,
    /a\.few: "few" is not an English cardinal/, /a\.ord: plural row lacks "two"/, /a\.form: unknown plural form "lots"/, /a\.arr: neither/]) assert.ok(bad.some((e) => re.test(e)), re);
  assert.deepEqual(validateTable(FIX), []);
});

test('the repo passes the lint with 0 missing keys', () => {
  const p = spawnSync(process.execPath, [join(ROOT, 'tools/check-strings.mjs'), '--json'], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const r = JSON.parse(p.stdout);
  assert.equal(r.missing, 0); assert.deepEqual(r.errors, []); assert.equal(r.used, r.keys); assert.ok(r.plural >= 1);
});
