// Gate check "Data" (doc 13.4, 14.4; owner G). Validates every colony data file in js/data/:
//   - every DATA_FILES entry exists, imports, and exports DATA = { kind: [defs] } (js/data/schema.js);
//   - every def matches its C11 schema (unknown fields, types, integer percents, no emoji);
//   - no duplicate ids per kind (across files), every reference resolves (items, materials,
//     benches, techs, tiers, add-ons, recipes, renown, ancestries, rooms, text ids, skills, work types);
//   - fixed orders (skills, work types, needs, quality), furniture items, add-on links,
//     one default start and storyteller, exclusive traits, perk levels, role coverage;
//   - checks against other workstreams' code registries: event names (C8, core/events.js), biomes,
//     balance WORK keys (E's jobs.js), toils (E), work-giver files (E, K), art keys (D).
//     A registry that does not exist yet is a WARNING ("not checked"); --strict makes every
//     warning an error (the gate should pass --strict from Stage 1a, J).
//
//   node tools/validate-data.mjs [--strict] [--json] [--quiet] [--self-test]
// Exit 0 when there are no errors. The last line is the summary the gate prints.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'js/data');
const args = new Set(process.argv.slice(2));
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const S = await imp('js/data/schema.js');

/** Load every manifest entry: [{ ...entry, mod, loadError }]. */
async function loadEntries() {
  const out = [];
  for (const e of S.DATA_FILES) {
    const file = join(DATA_DIR, e.path);
    if (!existsSync(file)) { out.push({ ...e, mod: null, loadError: 'file does not exist' }); continue; }
    try { out.push({ ...e, mod: await import(pathToFileURL(file).href) }); } catch (err) { out.push({ ...e, mod: null, loadError: String(err && err.message || err).split('\n')[0] }); }
  }
  return out;
}

/** Checks that need files or other workstreams' code. Pushes to errors / warnings / notes. */
async function envChecks(reg, entries, errors, warnings, notes) {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  // 1. Every js/data file is in the manifest (or a known legacy / infrastructure file).
  const listed = new Set([...S.DATA_FILES.map((e) => e.path), ...S.LEGACY_DATA_FILES, 'schema.js', 'index.js']);
  for (const f of walk(DATA_DIR).filter((p) => p.endsWith('.js')).map((p) => relative(DATA_DIR, p).split('\\').join('/')).sort()) {
    if (!listed.has(f)) warnings.push(`js/data/${f}: not in DATA_FILES (add it to js/data/schema.js, or delete it)`);
  }
  const legacy = S.LEGACY_DATA_FILES.filter((f) => existsSync(join(DATA_DIR, f)));
  if (legacy.length) notes.push(`${legacy.length} roguelite data files still present (A deletes them with their importers, 13.5): ${legacy.join(', ')}`);
  // 2. js/data/index.js imports exactly the non-reuse manifest files.
  const idxFile = join(DATA_DIR, 'index.js');
  if (!existsSync(idxFile)) errors.push('js/data/index.js is missing');
  else {
    const src = readFileSync(idxFile, 'utf8');
    const got = new Set([...src.matchAll(/import \* as \w+ from '\.\/([^']+)'/g)].map((m) => m[1]));
    for (const e of S.DATA_FILES) if (!e.reuse && !got.has(e.path)) errors.push(`js/data/index.js: does not import ${e.path}`);
    for (const p of got) if (!S.DATA_FILES.some((e) => e.path === p && !e.reuse)) errors.push(`js/data/index.js: imports ${p}, which is not a DATA_FILES entry`);
  }
  // 3. Event names (C8).
  try {
    const { EVENT_NAMES } = await imp('js/game/core/events.js');
    for (const d of reg.all('deed')) if (!EVENT_NAMES.includes(d.goal.event)) errors.push(`deeds.js: deed '${d.id}' goal.event '${d.goal.event}' is not a C8 event`);
    for (const t of reg.all('tech')) if (t.discover && !EVENT_NAMES.includes(t.discover.event)) errors.push(`research.js: tech '${t.id}' discover.event '${t.discover.event}' is not a C8 event`);
  } catch (err) { warnings.push(`event names not checked: core/events.js did not import (${err.message})`); }
  // 4. Biomes (reused palettes).
  try {
    const { BIOMES } = await imp('js/data/biomes.js');
    const { EXTRA_BIOMES } = await imp('js/data/biomes-ext.js');
    const ids = new Set([...Object.keys(BIOMES || {}), ...Object.keys(EXTRA_BIOMES || {})]);
    for (const st of reg.all('start')) if (!ids.has(st.map.biome)) errors.push(`starts.js: start '${st.id}' map.biome '${st.map.biome}' is not a biome (biomes.js, biomes-ext.js)`);
  } catch (err) { warnings.push(`biomes not checked (${err.message})`); }
  // 5. Balance WORK keys against E's jobs.js (setWorkBalance throws on unknown keys).
  const work = S.balanceOf(reg, 'work');
  try {
    const { WORK } = await imp('js/game/work/jobs.js');
    if (work) {
      for (const k of Object.keys(work)) {
        if (!(k in WORK)) errors.push(`balance.js WORK.${k}: not a key of js/game/work/jobs.js WORK (setWorkBalance would throw)`);
        else if (!Number.isInteger(work[k]) || work[k] < 0) errors.push(`balance.js WORK.${k}: must be a non-negative integer`);
      }
      for (const k of Object.keys(WORK)) if (!(k in work)) warnings.push(`balance.js WORK: missing key '${k}' (jobs.js default used)`);
    }
  } catch (err) { warnings.push(`balance WORK not checked: work/jobs.js did not import (${err.message})`); }
  // 6. Balance TEMP against B's terrain.js TEMP (B moves the numbers here; they must agree meanwhile).
  try {
    const { TEMP } = await imp('js/game/world/terrain.js');
    const t = S.balanceOf(reg, 'temp');
    if (t && TEMP) {
      const pairs = [['SEASON', 'season'], ['NIGHT', 'night'], ['UNDER', 'under'], ['UNDER_DEPTH', 'underDepth'], ['MIN', 'min'], ['MAX', 'max']];
      for (const [a, b] of pairs) if (JSON.stringify(TEMP[a]) !== JSON.stringify(t[b])) warnings.push(`balance.js TEMP.${b} (${JSON.stringify(t[b])}) differs from world/terrain.js TEMP.${a} (${JSON.stringify(TEMP[a])})`);
    }
  } catch (err) { notes.push(`TEMP not compared (${err.message})`); }
  // 7. Toils named by add-ons and perks (E's toil registry).
  const toilRefs = [...reg.all('addon').flatMap((sp) => ((sp.adds && sp.adds.toils) || []).map((x) => [`add-on '${sp.id}'`, x])),
    ...reg.all('perk').filter((p) => p.grants && p.grants.toil).map((p) => [`perk '${p.id}'`, p.grants.toil])];
  if (toilRefs.length) {
    try {
      await imp('js/game/work/toils.js');
      const { toilNames } = await imp('js/game/work/jobs.js');
      const names = new Set(toilNames());
      for (const [who, x] of toilRefs) if (!names.has(x)) warnings.push(`${who}: toil '${x}' is not registered (js/game/work/toils.js)`);
    } catch (err) { warnings.push(`toils not checked (${err.message})`); }
  }
  // 8. Work-giver modules (E; animals.js is K's).
  const gdir = join(ROOT, 'js/game/work/givers');
  const givers = [...new Set(reg.all('worktype').flatMap((w) => w.givers))];
  if (!existsSync(gdir)) warnings.push(`work givers not checked: js/game/work/givers/ does not exist yet (E, K; ${givers.length} givers named)`);
  else for (const w of reg.all('worktype')) for (const g of w.givers) if (!existsSync(join(gdir, `${g}.js`))) warnings.push(`worktypes.js: work type '${w.id}' giver '${g}' has no js/game/work/givers/${g}.js`);
  // 9. Art keys (D's registry js/engine/art/keys.js: export ART_KEYS (array or object) or hasArtKey(key)).
  const artRefs = [];
  for (const kind of reg.kinds()) for (const d of reg.all(kind)) for (const f of ['art', 'icon', 'look']) if (typeof d[f] === 'string') artRefs.push([`${reg.srcOf(kind, d.id)}: ${kind} '${d.id}'`, d[f]]);
  const keysFile = join(ROOT, 'js/engine/art/keys.js');
  if (!existsSync(keysFile)) warnings.push(`art keys not checked: js/engine/art/keys.js does not exist yet (D; ${artRefs.length} keys named)`);
  else {
    try {
      const m = await imp('js/engine/art/keys.js');
      const has = typeof m.hasArtKey === 'function' ? m.hasArtKey
        : Array.isArray(m.ART_KEYS) ? (k) => m.ART_KEYS.includes(k) : m.ART_KEYS ? (k) => k in m.ART_KEYS : null;
      if (!has) warnings.push('art keys not checked: js/engine/art/keys.js exports neither hasArtKey nor ART_KEYS');
      else for (const [who, k] of artRefs) if (!has(k)) warnings.push(`${who}: art key '${k}' is not registered (D)`);
    } catch (err) { warnings.push(`art keys not checked (${err.message})`); }
  }
  // 10. Rule hooks: the names are the C11 list (schema.js RULE_IDS); code registries come with F, E, K.
  const rules = new Set([...reg.all('addon').flatMap((sp) => (sp.adds && sp.adds.rules) || []), ...reg.all('perk').map((p) => p.grants && p.grants.rule).filter(Boolean)]);
  if (rules.size) notes.push(`rule hooks named by content (implementation not yet checked): ${[...rules].sort().join(', ')}`);
}

/** Self-test: a broken data set must produce the expected errors. */
async function selfTest() {
  const real = await loadEntries();
  const mod = (path, DATA) => ({ path, owner: 'G', mod: { DATA } });
  const base = real.filter((e) => !e.reuse).map((e) => ({ ...e }));
  const swap = (path, DATA) => { const i = base.findIndex((e) => e.path === path); base[i] = { ...base[i], mod: { DATA } }; };
  const items = real.find((e) => e.path === 'items.js').mod.DATA;
  swap('items.js', { ...items, item: [...items.item, { ...items.item[0] }, { id: 'bad_item', name: 'Bad \u{1F525}', cat: 'raw', stack: 1.5, mass: 1, value: 1, zz: 1 },
    { id: 'odd_mats', name: 'Odd mats', cat: 'wood', stack: 1, mass: 1, value: 1, mat: ['wood', 'cheese'] }] });
  const rec = real.find((e) => e.path === 'recipes.js').mod.DATA;
  swap('recipes.js', { recipe: [...rec.recipe, { id: 'ghost', name: 'Ghost', bench: ['nowhere'], in: [{ k: 'wood', cat: 'wood', n: 1 }], out: [{ k: 'meal', n: 1, matFrom: 3 }], skill: 'flying', work: 10, minSkill: 0, quality: false, tech: 'nope', stage: '1a' },
    { id: 'too_early', name: 'Too early', bench: ['campfire'], in: [{ k: 'meat', n: 1 }], out: [{ k: 'meal', n: 1 }], skill: 'cooking', work: 10, minSkill: 0, quality: false, stage: '1a' },
    { id: 'no_stage', name: 'No stage', bench: ['campfire'], in: [{ k: 'meat', n: 1 }], out: [{ k: 'meal', n: 1 }], skill: 'cooking', work: 10, minSkill: 0, quality: false }] });
  const sk = real.find((e) => e.path === 'skills.js').mod.DATA;
  swap('skills.js', { skill: [sk.skill[1], sk.skill[0], ...sk.skill.slice(2)] });
  swap('starts.js', { start: real.find((e) => e.path === 'starts.js').mod.DATA.start.map((x) => ({ ...x, default: true })) });
  swap('starts.js', { start: real.find((e) => e.path === 'starts.js').mod.DATA.start.map((x) => ({ ...x, default: true, items: { ...x.items, 'ingot:granite': 1 } })) });
  swap('text/help.js', { text: [{ id: 'help_bad', text: 'Hello {who}' }] });
  const tr = real.find((e) => e.path === 'traits.js').mod.DATA;
  swap('traits.js', { trait: [...tr.trait, { id: 'odd', name: 'Odd', weight: 1, mods: [{ key: 'sparkle.speed', op: 'times', value: 1.5 }], text: 'Odd.' }] });
  base.push(mod('extra.js', { wonky: [{ id: 'x' }] }));
  base.push({ path: 'missing.js', owner: 'F', mod: null });
  const reg = S.buildRegistry(base);
  const { errors } = S.validate(reg, base);
  const expect = [
    [/duplicate item id 'wood'/, 'duplicate id'], [/emoji/, 'emoji'], [/must be an integer/, 'integer percent'], [/\.zz: unknown field/, 'unknown field'],
    [/cat 'raw' is a group/, 'leaf category'], [/unknown structure 'nowhere'/, 'unknown bench'], [/exactly one of k or cat/, 'k or cat'],
    [/matFrom: points past/, 'matFrom'], [/unknown skill 'flying'/, 'unknown skill'], [/unknown tech 'nope'/, 'unknown tech'],
    [/skill: ids must be exactly/, 'skill order'], [/exactly one start must be default/, 'one default start'],
    [/unknown kind 'wonky'/, 'unknown kind'], [/missing.js: missing/, 'missing file'],
    [/item 'ingot' does not come in stone material 'granite'/, 'item-material fit'], [/placeholder \{who\} is not listed/, 'text placeholders'],
    [/root must be one of/, 'modifier key root'], [/op: must be one of/, 'modifier op'],
    [/odd_mats' \.mat: must be a material group/, 'item material groups'], [/too_early': stage 1a but no bench/, 'recipe stage vs bench stage'],
    [/no_stage' \.stage: is required/, 'stage required'],
  ];
  let bad = 0;
  for (const [re, what] of expect) { const ok = errors.some((e) => re.test(e)); if (!ok) bad++; console.log(`${ok ? 'ok    ' : 'MISSED'} ${what}`); }
  const realReg = S.buildRegistry(real), realRes = S.validate(realReg, real);
  console.log(`${realRes.errors.length ? 'MISSED' : 'ok    '} shipped data validates (${realRes.errors.length} errors)`);
  if (realRes.errors.length) bad++;
  console.log(`validate-data self-test: ${bad ? `FAIL (${bad} missed)` : `OK (${expect.length + 1} cases, ${errors.length} errors raised on the broken set)`}`);
  process.exit(bad ? 1 : 0);
}

if (args.has('--self-test')) await selfTest();

const t0 = Date.now();
const entries = await loadEntries();
const errors = [], warnings = [], notes = [];
for (const e of entries) if (e.loadError) errors.push(`js/data/${e.path}: ${e.loadError} (owner ${e.owner})`);
const reg = S.buildRegistry(entries);
const res = S.validate(reg, entries);
// buildRegistry reports a module that did not load as "missing"; the load error above says why.
const failed = new Set(entries.filter((e) => e.loadError).map((e) => e.path));
for (const m of res.errors) if (!failed.has(m.split(':')[0])) errors.push(`js/data/${m}`);
for (const w of res.warnings) warnings.push(w);
await envChecks(reg, entries, errors, warnings, notes);
if (args.has('--strict')) { errors.push(...warnings.map((w) => `(strict) ${w}`)); warnings.length = 0; }

const files = entries.filter((e) => !e.reuse).length;
const kinds = reg.kinds().length;
if (args.has('--json')) {
  console.log(JSON.stringify({ ok: !errors.length, files, kinds, defs: res.defs, errors, warnings, notes }, null, 1));
} else {
  if (!args.has('--quiet')) {
    for (const n of notes) console.log(`note   ${n}`);
    for (const w of warnings) console.log(`WARN   ${w}`);
  }
  for (const e of errors) console.log(`ERROR  ${e}`);
  console.log(`validate-data: ${errors.length ? 'FAIL' : 'OK'} - ${files} files, ${kinds} kinds, ${res.defs} defs, ${errors.length} errors, ${warnings.length} warnings (${Date.now() - t0} ms)`);
}
process.exit(errors.length ? 1 : 0);
