// The site finder, the reach rule and the card facts (EMBERCROWN-WORLD.md 3.2-3.4; step W2.7b; owner L).
// Oracle: finder scoring matches a brute-force filter on 3 worlds; scoring all regions takes < 1 ms; the reach
// field equals query.js travelDays; Settle blocks follow 3.2.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRealm } from '../../js/game/realm/gen.js';
import { regionOpts, regionFacts } from '../../js/game/realm/region.js';
import { idx, isEmbarkable, isSea, riverClass, isLake, startFits, travelDays } from '../../js/game/realm/query.js';
import { GEN, START_FIT } from '../../js/data/realm/params.js';
import { REALM_BIOMES } from '../../js/data/realm/biomes.js';
import * as F from '../../js/game/realm/finder.js';

const WORLDS = [{ seed: 'finder-1', size: 'standard' }, { seed: 'finder-2', size: 'small' }, { seed: 'finder-3', size: 'standard', sea: 2 }];
const realms = WORLDS.map((p) => buildRealm(p));

/** The brute force: every region straight from regionOpts / regionFacts with the rules of 3.4 written out again. */
function brute(realm, Fl, used = []) {
  const out = [];
  for (let ry = 0; ry < realm.n; ry++) for (let rx = 0; rx < realm.n; rx++) {
    const i = idx(realm, rx, ry);
    if (!isEmbarkable(realm, i) || realm.fields.site[i] || used.some((u) => u[1] === rx && u[2] === ry)) continue;
    const o = regionOpts(realm, rx, ry), fx = regionFacts(realm, rx, ry);
    if (Fl.biomes.length && !Fl.biomes.includes(fx.biome)) continue;
    const cl = fx.temp < GEN.classify.cold ? 'cold' : fx.temp >= GEN.classify.warm ? 'warm' : 'temperate';
    if (Fl.climate !== 'any' && cl !== Fl.climate) continue;
    if (Fl.river === 'need' && !fx.river) continue;
    if (Fl.river === 'none' && fx.river) continue;
    if (Fl.lake === 'need' && !fx.lake) continue;
    const aq = o.aquiferPct < 20 ? 'none' : o.aquiferPct < 50 ? 'light' : 'heavy';
    if (Fl.aquifer !== 'any' && aq !== Fl.aquifer) continue;
    const ms = o.massifPct <= 35 ? 'thin' : o.massifPct >= 42 ? 'thick' : 'mid';
    if (Fl.mountain !== 'any' && ms !== Fl.mountain) continue;
    const w = (k) => (k === 'gems' ? Math.max(100, ...['garnet', 'sapphire', 'emerald', 'ruby', 'amber'].map((g) => o.ores[g] || 0)) : o.ores[k] || 100);
    if (Fl.ores.some((k) => w(k) < 150)) continue;
    if (Fl.ember === 'shallow' && o.ember.rel !== -11) continue;
    if (Fl.ember === 'deep' && o.ember.rel === -11) continue;
    if (Fl.fit && !startFits(realm, i, Fl.fit)) continue;
    let s = 0;
    const hl = fx.taint < 100 ? 0 : fx.taint >= 160 ? 2 : 1, wl = fx.wild < 60 ? 0 : fx.wild >= 170 ? 2 : 1;
    if (Fl.hollow === 'low') s += 2 - hl; else if (Fl.hollow === 'high') s += hl;
    if (Fl.wild === 'calm') s += 2 - wl; else if (Fl.wild === 'wild') s += wl;
    if (Fl.neigh === 'isolated') s += 2;           // the W2 world has no sites: every region is isolated
    const edge = Math.min(8, rx, ry, realm.n - 1 - rx, realm.n - 1 - ry);
    const q = 4 * fx.river + (fx.lake ? 3 : 0) + edge - Math.floor(fx.taint / 64) - Math.floor(fx.wild / 64);
    out.push({ rx, ry, i, score: s, q });
  }
  return out.sort((a, b) => b.score - a.score || b.q - a.q || a.i - b.i);
}
const SETS = [
  {},
  { river: 'need' },
  { river: 'none', hollow: 'low', wild: 'calm' },
  { biomes: ['greenvale', 'elderwood'], lake: 'any', climate: 'temperate' },
  { aquifer: 'heavy', mountain: 'thin' },
  { mountain: 'thick', ores: ['iron'], ember: 'deep' },
  { ores: ['coal', 'copper'], hollow: 'high' },
  { ember: 'shallow', wild: 'wild', neigh: 'isolated' },
  { fit: 'deepforge', climate: 'cold' },
  { fit: 'lone_ember', biomes: ['tundra', 'taiga', 'moor', 'fen', 'shore'], aquifer: 'light' },
  { lake: 'need', neigh: 'traders' },
  { ores: ['gold', 'gems'] },
];

test('finder scoring matches a brute-force filter on 3 worlds (12 filter sets each)', () => {
  let rows = 0, nonEmpty = 0;
  for (const realm of realms) {
    const used = [[0, 0, 0]];
    for (const set of SETS) {
      const Fl = F.cleanFilters({ ...F.defaultFilters(), ...set });
      const got = F.findSites(realm, Fl, { used }).list;
      const want = brute(realm, Fl, used);
      assert.deepEqual(got.map((m) => [m.i, m.score, m.q]), want.map((m) => [m.i, m.score, m.q]), `${realm.params.seed} ${JSON.stringify(set)}`);
      rows += got.length; if (got.length) nonEmpty++;
    }
  }
  assert.ok(nonEmpty >= 30, `most sets match something (${nonEmpty} of 36)`);
  console.log(`# brute-force agreement: 3 worlds x ${SETS.length} sets, ${rows} matches in all, ${nonEmpty} non-empty sets`);
});

test('scoring all regions takes < 1 ms (warm, median of 25; traits are built once)', () => {
  const realm = buildRealm(WORLDS[0]);
  const t0 = performance.now(), T = F.regionTraits(realm), traitsMs = (performance.now() - t0).toFixed(1);
  const C = F.compileFilters({ ...F.defaultFilters(), river: 'need', hollow: 'low', ores: ['coal'] });
  const times = [];
  for (let k = 0; k < 25; k++) {
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < T.N; i++) if (F.scoreTraits(T, i, C) >= 0) n++;
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const full = [];
  for (let k = 0; k < 25; k++) { const t0 = performance.now(); F.findSites(realm, { ...F.defaultFilters(), river: 'need' }); full.push(performance.now() - t0); }
  full.sort((a, b) => a - b);
  console.log(`# ${T.N} regions: score pass median ${times[12].toFixed(3)} ms; findSites (score + sort) median ${full[12].toFixed(3)} ms; traits built once in ${traitsMs} ms`);
  assert.ok(times[12] < 1, `score pass ${times[12]} ms`);
  assert.ok(full[12] < 1, `findSites ${full[12]} ms`);
});

test('filters: unknown keys and values are dropped; storage form round-trips', () => {
  const c = F.cleanFilters({ biomes: ['fen', 'sea', 'nope'], river: 'maybe', ores: ['gold', 'mithral'], fit: 'tarn_shore', extra: 1 });
  assert.deepEqual(c, { ...F.defaultFilters(), biomes: ['fen'], ores: ['gold'], fit: 'tarn_shore' });
  assert.deepEqual(F.cleanFilters(JSON.parse(JSON.stringify(c))), c);
  assert.deepEqual(F.cleanFilters(null), F.defaultFilters());
  assert.equal(F.FILTERS.length, 12);
  assert.equal(F.FILTERS[0].opts.length, 12, '12 region biomes');
});

test('Settle blocks (3.2): sea, peak, site, used; the W2 world is unsettled and open', () => {
  const realm = buildRealm({ seed: 'finder-block', size: 'small' });
  const n = realm.n;
  let sea = null, land = null, peak = null;
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i - x) / n;
    if (!sea && isSea(realm, i)) sea = [x, y];
    if (!land && isEmbarkable(realm, i)) land = [x, y];
    if (!peak && !isSea(realm, i) && realm.fields.biome[i] === 1) peak = [x, y];
  }
  assert.equal(F.settleBlockOf(realm, ...sea), 'sea');
  if (peak) assert.ok(['peak', 'edge'].includes(F.settleBlockOf(realm, ...peak)));
  assert.equal(F.settleBlockOf(realm, -1, 0), 'edge');
  assert.equal(F.settleBlockOf(realm, ...land), null);
  assert.equal(F.settleBlockOf(realm, ...land, { used: [[3, land[0], land[1]]] }), 'used');
  const r = F.reachOf(realm, ...land);
  assert.equal(r.ok, true); assert.equal(r.unsettled, true);
  realm.fields.site[idx(realm, ...land)] = 1;
  assert.equal(F.settleBlockOf(realm, ...land), 'site');
});

test('the reach rule with civs: territory or a site within 12 travel days; Lone Ember and Refugees may go alone', () => {
  const realm = buildRealm({ seed: 'finder-reach', size: 'small' });
  const n = realm.n, land = [];
  for (let i = 0; i < n * n; i++) if (isEmbarkable(realm, i)) land.push(i);
  const home = land[(land.length / 2) | 0], hx = home % n, hy = (home - hx) / n;
  realm.tables.civs = [{ name: 'Test Crown', people: 'human' }];
  realm.tables.sites = [{ x: hx, y: hy, civ: 0, kind: 'town', name: 'Testford' }];
  realm.fields.site[home] = 1;
  const field = F.travelField(realm, [home]);
  // the field equals travelDays (from the town) on 40 regions
  for (let k = 0; k < 40; k++) {
    const j = land[(k * 97) % land.length], x = j % n, y = (j - x) / n;
    assert.equal(field[j], travelDays(realm, hx, hy, x, y), `days to (${x}, ${y})`);
  }
  let near = null, far = null;
  for (const j of land) { if (j === home) continue; if (!near && field[j] <= 12) near = j; if (!far && field[j] > 12) far = j; }
  assert.ok(near !== null, 'some region is within 12 days');
  const nx = near % n, ny = (near - nx) / n;
  const r = F.reachOf(realm, nx, ny);
  assert.equal(r.ok, true); assert.equal(r.unsettled, false); assert.equal(r.civs[0].civ.name, 'Test Crown');
  assert.equal(F.settleBlockOf(realm, nx, ny), null);
  if (far !== null) {
    const fx = far % n, fy = (far - fx) / n;
    assert.equal(F.reachOf(realm, fx, fy).ok, false);
    assert.equal(F.settleBlockOf(realm, fx, fy), 'reach');
    assert.equal(F.settleBlockOf(realm, fx, fy, { start: 'lone_ember' }), null);
    assert.equal(F.reachOf(realm, fx, fy, { start: 'refugees' }).alone, true);
    // the finder leaves out-of-reach regions out unless the start may go alone
    assert.ok(!F.findSites(realm, F.defaultFilters()).list.some((m) => m.i === far));
    assert.ok(F.findSites(realm, F.defaultFilters(), { start: 'lone_ember' }).list.some((m) => m.i === far));
  }
  assert.ok(!F.findSites(realm, F.defaultFilters()).list.some((m) => m.i === home), 'a site region is never a match');
});

test('card facts are built on regionFacts and regionOpts (20 regions)', () => {
  const realm = realms[0], m = F.findSites(realm, F.defaultFilters()).list;
  for (let k = 0; k < 20; k++) {
    const { rx, ry } = m[(k * 61) % m.length];
    const cf = F.cardFacts(realm, rx, ry), fx = regionFacts(realm, rx, ry), o = regionOpts(realm, rx, ry);
    assert.deepEqual(cf.facts, fx);
    assert.equal(cf.ground.massifPct, o.massifPct); assert.equal(cf.ground.aquiferPct, o.aquiferPct);
    assert.equal(!!cf.ground.river, !!o.river); assert.equal(cf.depth.caverns, o.caverns);
    assert.equal(cf.rock.ores.find((x) => x.k === 'coal').w, o.ores.coal || 100);
    assert.equal(F.localArea(realm, rx, ry).length, 9);
    assert.ok(REALM_BIOMES.some((b) => b.id === fx.biome));
    assert.equal(cf.block, null);
  }
  assert.ok(Object.keys(START_FIT).every((id) => F.FILTERS.find((r) => r.id === 'fit').opts.includes(id)));
  assert.equal(F.compass(5, 5, 5, 2), 'n'); assert.equal(F.compass(5, 5, 8, 8), 'se'); assert.equal(F.compass(5, 5, 9, 4), 'e');
  assert.ok(riverClass && isLake);
});
