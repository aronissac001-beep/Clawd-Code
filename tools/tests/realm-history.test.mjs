// World history (EMBERCROWN-WORLD.md W3.1a; 2.1-2.4, 1.2 step 10, 1.4): the tables of G data, then on 100 Standard
// seeds: no site owned by a fallen civ, every razed site a ruin, wars began <= ended, the caps, every road joins
// two friendly sites, the layers agree with the tables; the guarantees with re-rolls; determinism, the event log,
// the history time (< 60 ms desktop at 64 x 64 and 250 years) and the hash in Chromium equal to Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRealm, realmHash } from '../../js/game/realm/gen.js';
import { runHistory, settleHistory, checkHistory, historyHash, eventAt, eventCount, historyGen } from '../../js/game/realm/history.js';
import { oathText, ethicDistance } from '../../js/game/realm/civs.js';
import { roadPath } from '../../js/game/realm/roads.js';
import { CIVKINDS, HISTORY_GEN, HISTORY_PEOPLES, SITE_KINDS, ROSTER } from '../../js/data/realm/civkinds.js';
import { ETHIC_AXES, PEOPLE_ETHIC } from '../../js/data/realm/ethics.js';
import { EVENT_TYPES, EVENT_INDEX, EVENT_BYTES } from '../../js/data/realm/events.js';
import { CIV_COUNT } from '../../js/data/realm/params.js';
import { REALM_BIOMES } from '../../js/data/realm/biomes.js';
import { DATA as ANCESTRIES } from '../../js/data/ancestries.js';
import { encodeRecord, decodeRecord, recordSizes } from '../../js/game/realm/record.js';
import { checkFigures, CAUSE, CAUSE_KEYS, DEED_SLOT, FIG } from '../../js/game/realm/figures.js';
import { beastName, BEAST } from '../../js/game/realm/beasts.js';
import { beastIdentity } from '../../js/game/colony/legends.js';
import { regionOpts } from '../../js/game/realm/region.js';

const FIXTURES = [{ seed: 1, size: 'standard' }, { seed: 'Ashmark', size: 'small', sea: 2 }, { seed: 90210, size: 'large', hollowing: 'high', wildness: 'low' }];
const BASE = new Map();
const realmOf = (p) => { const r = buildRealm(p); settleHistory(r); return r; };

test('G data: civ kinds, peoples, ethics and event types are well formed', () => {
  assert.equal(CIVKINDS.length, 12);
  assert.equal(new Set(CIVKINDS.map((k) => k.id)).size, 12);
  const anc = new Set((ANCESTRIES.ancestry || []).map((a) => a.id));
  for (const p of Object.keys(HISTORY_PEOPLES)) {
    if (anc.size) assert.ok(anc.has(p), `history people ${p} is an ancestry`);
    for (const b of Object.keys(HISTORY_PEOPLES[p].homeBiomes)) assert.ok(REALM_BIOMES.some((x) => x.id === b), `${p} home ${b}`);
    const e = PEOPLE_ETHIC[p];
    assert.equal(e.length, ETHIC_AXES.length);
    assert.ok(e.every((v) => Number.isInteger(v) && v >= -2 && v <= 2));
  }
  for (const [p, k] of ROSTER) assert.ok(p === '*' || HISTORY_PEOPLES[p], `roster people ${p}`), assert.ok(CIVKINDS.some((x) => x.id === k));
  assert.equal(new Set(EVENT_TYPES.map((t) => t.key)).size, EVENT_TYPES.length);
  assert.ok(EVENT_TYPES.length < 256 && EVENT_TYPES.every((t) => t.imp >= 0 && t.imp <= 3));
  assert.equal(new Set(SITE_KINDS).size, SITE_KINDS.length);
  assert.equal(ethicDistance([2, 2, 2, 2, 2, 2, 2, 2], [-2, -2, -2, -2, -2, -2, -2, -2]), 32);
  assert.match(oathText(10102), /^the \w+-and-\w+ pact$/);
  assert.match(oathText(20304), /^the \w+ \w+$/);
});

test('100 Standard seeds: the W3.1a oracle', () => {
  const tally = { warned: 0, rerolls: 0, civs: 0, alive: 0, sites: 0, ruins: 0, wars: 0, roads: 0, events: 0, pacts: 0 };
  for (let seed = 1; seed <= 100; seed++) {
    const r = buildRealm({ seed });
    const before = realmHash(r);
    tally.rerolls += settleHistory(r);
    if (r.warnings.length) tally.warned++;
    if (FIXTURES[0].seed === seed) BASE.set('fixture0', historyHash(r));
    const T = r.tables, n = r.n, f = r.fields, C = Math.min(HISTORY_GEN.caps.civsMax, CIV_COUNT[r.params.peoples] + HISTORY_GEN.caps.civsExtra);
    const at = `seed ${seed}`;
    // caps (2.2)
    assert.ok(T.civs.length <= C, `${at}: ${T.civs.length} civs`);
    assert.ok(T.sites.length <= HISTORY_GEN.caps.sites, `${at}: ${T.sites.length} sites`);
    assert.ok(T.wars.length <= HISTORY_GEN.caps.wars, `${at}: ${T.wars.length} wars`);
    assert.ok(T.figures.length <= HISTORY_GEN.caps.figures, `${at}: figures`);
    assert.ok(eventCount(r) <= HISTORY_GEN.caps.events, `${at}: events`);
    assert.equal(r.years, 250);
    for (const s of T.sites) {
      // no site is owned by a fallen civ; every razed site is a ruin
      if (s.civ !== null) assert.equal(T.civs[s.civ].fell, null, `${at}: site ${s.id} owned by fallen civ ${s.civ}`);
      if (s.razed !== null) { assert.equal(s.kind, 'ruin', `${at}: razed site ${s.id} is ${s.kind}`); assert.equal(s.civ, null); assert.ok(s.razed >= s.founded); }
      if (s.kind === 'ruin') assert.notEqual(s.razed, null);
      assert.ok(s.size >= 0 && s.size <= 5);
      assert.equal(f.site[s.y * n + s.x], s.id + 1, `${at}: site layer at site ${s.id}`);
    }
    let marked = 0;
    for (let i = 0; i < n * n; i++) {
      if (f.site[i]) marked++;
      const o = f.owner[i];
      if (o) assert.equal(T.civs[o - 1].fell, null, `${at}: region ${i} owned by a fallen civ`);
      if (o) assert.ok(f.elev[i] >= 0);
    }
    assert.equal(marked, T.sites.length, `${at}: one site a region`);
    for (const c of T.civs) {
      if (c.fell !== null) { assert.ok(c.fell >= c.founded); assert.ok(!T.sites.some((s) => s.civ === c.id)); assert.equal(c.pacts.length, 0); }
      else assert.ok(T.sites.some((s) => s.civ === c.id), `${at}: living civ ${c.id} has a site`);
      for (const o of c.pacts) assert.ok(T.civs[o].pacts.includes(c.id), `${at}: pacts are mutual`);
      for (const fid of c.rulers) assert.equal(T.figures[fid].civ, c.id);
    }
    for (const g of T.figures) if (g.died !== null) assert.ok(g.died >= g.born, `${at}: figure ${g.id} dies after birth`);
    // every war has began <= ended; at most one open war a pair
    const open = new Set();
    for (const w of T.wars) {
      if (w.ended !== null) assert.ok(w.began <= w.ended, `${at}: war ${w.id} ${w.began}..${w.ended}`);
      else { const k = Math.min(w.a, w.b) + ':' + Math.max(w.a, w.b); assert.ok(!open.has(k)); open.add(k); assert.equal(T.civs[w.a].fell, null); assert.equal(T.civs[w.b].fell, null); }
      assert.ok(w.cause === -1 || w.cause < eventCount(r));
    }
    // every road joins two friendly sites: living, of one civ or of two civs bound by a pact and not at war
    for (const [a, b] of T.roads) {
      const sa = T.sites[a], sb = T.sites[b];
      assert.ok(sa.civ !== null && sb.civ !== null && sa.razed === null && sb.razed === null, `${at}: road ${a}-${b} ends at a living site`);
      const k = Math.min(sa.civ, sb.civ) + ':' + Math.max(sa.civ, sb.civ);
      assert.ok(sa.civ === sb.civ || (T.civs[sa.civ].pacts.includes(sb.civ) && !open.has(k)), `${at}: road ${a}-${b} joins friends`);
      assert.ok(f.road[sa.y * n + sa.x] && f.road[sb.y * n + sb.x], `${at}: road ${a}-${b} is laid`);
    }
    // the road layer is symmetric (N 1, E 2, S 4, W 8) and never on the sea
    for (let i = 0; i < n * n; i++) {
      const v = f.road[i];
      if (!v) continue;
      assert.ok(f.elev[i] >= r.seaLevel, `${at}: road on the sea`);
      const x = i % n;
      if (v & 2) assert.ok(x + 1 < n && f.road[i + 1] & 8);
      if (v & 4) assert.ok(f.road[i + n] & 1);
    }
    // the event log: rows in year order, known types
    let last = -32768;
    for (let k = 0; k < eventCount(r); k++) { const e = eventAt(r, k); assert.ok(e.type < EVENT_TYPES.length); assert.ok(e.year >= last && e.year <= 250); last = e.year; }
    assert.notEqual(realmHash(r), before);
    tally.civs += T.civs.length; tally.alive += T.civs.filter((c) => c.fell === null).length; tally.sites += T.sites.length;
    tally.ruins += T.sites.filter((s) => s.kind === 'ruin').length; tally.wars += T.wars.length; tally.roads += T.roads.length;
    tally.events += eventCount(r); tally.pacts += T.civs.reduce((a, c) => a + c.pacts.length, 0) / 2;
  }
  console.log('# 100 seeds:', JSON.stringify(Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, k === 'warned' || k === 'rerolls' ? v : +(v / 100).toFixed(1)]))));
  assert.equal(tally.warned, 0, 'no world accepted with a history warning');
});

// W3.1b (2.3 steps 5, 6, 10; 2.5): figures, deeds, beasts and artifacts
test('100 Standard seeds: the W3.1b oracle (figures, deeds and causes by replay, artifacts, beasts)', () => {
  const tally = { figures: 0, alive: 0, deeds: 0, artifacts: 0, lost: 0, beasts: 0, slain: 0, events: 0 }, causes = {}, mins = { figures: 1e9, artifacts: 1e9, beasts: 1e9 };
  let maxEv = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const r = buildRealm({ seed });
    settleHistory(r);
    const T = r.tables, at = `seed ${seed}`, sc = r.n / 64;
    // the replay oracle: lives, deeds inside lives, causes true at their year, one holder or one lost place, beasts
    assert.deepEqual(checkFigures(r), [], at);
    // caps (2.2)
    assert.ok(T.figures.length <= HISTORY_GEN.caps.figures, `${at}: ${T.figures.length} figures`);
    assert.ok(T.beasts.length <= Math.round(BEAST.max * sc * sc), `${at}: ${T.beasts.length} beasts`);
    assert.ok(T.artifacts.filter((a) => a.kind !== 'trophy').length <= Math.round(FIG.art * sc * sc), `${at}: artifacts`);
    for (const f of T.figures) {
      const [, , max] = HISTORY_PEOPLES[f.people].lifespan;
      assert.ok((f.died === null ? r.years : f.died) - f.born <= max, `${at}: figure ${f.id} outlives its people`);
      assert.ok(f.civ >= 0 && f.civ < T.civs.length && T.sites[f.home], `${at}: figure ${f.id} civ and home`);
      if (f.kin[1] >= 0) assert.equal(T.figures[f.kin[1]].kin[1], f.id, `${at}: marriages are mutual`);
    }
    for (const b of T.beasts) assert.equal(b.name, beastIdentity(b.seed).full, `${at}: beast ${b.id} name`);
    // the deed rows: a cause on every deed, none on other rows
    for (let k = 0; k < eventCount(r); k++) {
      const e = eventAt(r, k), code = e.flags & 7;
      if (DEED_SLOT[e.key]) { assert.ok(code >= CAUSE.avenge && code <= CAUSE.ambition, `${at}: row ${k} ${e.key} has a cause`); causes[CAUSE_KEYS[code]] = (causes[CAUSE_KEYS[code]] || 0) + 1; }
      else assert.equal(code, 0, `${at}: row ${k} ${e.key} carries no cause`);
    }
    maxEv = Math.max(maxEv, eventCount(r));
    tally.figures += T.figures.length; tally.alive += T.figures.filter((f) => f.died === null).length; tally.deeds += T.figures.reduce((a, f) => a + f.deeds.length, 0);
    tally.artifacts += T.artifacts.length; tally.lost += T.artifacts.filter((a) => a.lost).length; tally.beasts += T.beasts.length; tally.slain += T.beasts.filter((b) => !b.alive).length;
    tally.events += eventCount(r);
    mins.figures = Math.min(mins.figures, T.figures.length); mins.artifacts = Math.min(mins.artifacts, T.artifacts.length); mins.beasts = Math.min(mins.beasts, T.beasts.length);
  }
  console.log('# W3.1b 100 seeds:', JSON.stringify(Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, +(v / 100).toFixed(1)]))), 'min', JSON.stringify(mins), 'max events', maxEv);
  console.log('# deed causes:', JSON.stringify(causes));
  assert.ok(tally.figures / 100 >= 250 && mins.beasts >= BEAST.min && mins.artifacts >= 20, 'figures, beasts and artifacts in their ranges');
  assert.ok(Object.keys(causes).length === 6, 'every cause kind occurs');
});

test('history feeds the region inputs: lost artifacts are relics, living beasts lairs (3.6); the record stays < 60 KB', async () => {
  const r = realmOf(FIXTURES[0]), T = r.tables;
  const lost = T.artifacts.find((a) => a.lost && typeof a.x === 'number');
  assert.ok(lost, 'a lost artifact');
  assert.ok(regionOpts(r, lost.x, lost.y).relics.some((x) => x.key === lost.id));
  const b = T.beasts.find((x) => x.alive);
  assert.ok(b, 'a living beast');
  assert.ok(regionOpts(r, b.x, b.y).lairs.some((x) => x.key === b.id));
  const slain = T.beasts.find((x) => !x.alive);
  if (slain) {
    const tr = T.artifacts.find((a) => a.kind === 'trophy' && a.beast === slain.id);
    assert.ok(tr && tr.made === slain.slain, 'a slain beast leaves a trophy');
    assert.ok(tr.holders.length || (tr.lost[1] === slain.site && tr.x === slain.x && tr.y === slain.y), 'lost at its lair until a figure finds it');
  }
  const z = await recordSizes(r);
  console.log(`# realm record with history (seed 1, Standard): tables ${z.tables} B, events ${z.events} B raw; ${z.record} B deflated`);
  assert.ok(z.record < 60_000, `${z.record} B`);
});

test('a cause is a fact of its year: tampering with a figure or a war is caught by the replay', () => {
  const r = realmOf(FIXTURES[0]), T = r.tables;
  let hit = 0;
  for (let k = 0; k < eventCount(r) && hit < 2; k++) {
    const e = eventAt(r, k), code = e.flags & 7;
    if (code === CAUSE.duty && !hit) { const w = T.wars[e.arg], keep = w.began; w.began = e.year + 1; assert.ok(checkFigures(r).some((f) => f.rule === 'cause')); w.began = keep; hit++; }
  }
  assert.ok(hit, 'a duty deed in the fixture');
  const f = T.figures.find((g) => g.deeds.length);
  const keep = f.born; f.born = r.years + 1;
  assert.ok(checkFigures(r).some((x) => x.rule === 'deed.life'));
  f.born = keep;
  assert.deepEqual(checkFigures(r), []);
});

test('guarantees: civs alive, a human civ, every start near its people (W3 peoples)', () => {
  for (const p of FIXTURES) {
    const r = realmOf(p);
    assert.deepEqual(checkHistory(r), [], JSON.stringify(p));
    assert.ok(r.tables.civs.filter((c) => c.fell === null).length >= HISTORY_GEN.guard.alive[r.params.size]);
  }
});

test('determinism: same params, same history; re-roll index changes it; fields 1-8 untouched', () => {
  const a = buildRealm({ seed: 42 }), b = buildRealm({ seed: 42 });
  const keep = ['elev', 'temp', 'rain', 'flow', 'biome', 'taint', 'wild'].map((k) => Buffer.from(a.fields[k].buffer).toString('base64'));
  runHistory(a); runHistory(b);
  assert.equal(historyHash(a), historyHash(b));
  assert.deepEqual(['elev', 'temp', 'rain', 'flow', 'biome', 'taint', 'wild'].map((k) => Buffer.from(a.fields[k].buffer).toString('base64')), keep);
  const c = buildRealm({ seed: 42 });
  runHistory(c, 1);
  assert.notEqual(historyHash(c), historyHash(a));
  // re-running over an already settled realm gives the same result (the layers are reset first)
  runHistory(a);
  assert.equal(historyHash(a), historyHash(b));
  // the generator yields every 25 years and ends at the last year
  const d = buildRealm({ seed: 42 }), steps = [...historyGen(d)];
  assert.equal(steps[steps.length - 1].year, 250);
  assert.ok(steps.length >= 10);
  assert.equal(historyHash(d), historyHash(b));
});

test('every param row runs within the caps (Small few 150, Large many 400)', () => {
  for (const p of [{ seed: 3, size: 'small', peoples: 'few', history: 150 }, { seed: 4, size: 'large', peoples: 'many', history: 400, hollowing: 'high' }]) {
    const r = realmOf(p), T = r.tables, sc = r.n / 64;
    assert.equal(r.years, p.history);
    assert.ok(T.sites.length <= Math.round(HISTORY_GEN.caps.sites * sc * sc));
    assert.ok(T.civs.length <= HISTORY_GEN.caps.civsMax && T.wars.length <= HISTORY_GEN.caps.wars && eventCount(r) <= HISTORY_GEN.caps.events);
    assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
  }
});

test('record: a settled realm round-trips through the realm record (tables and 12-byte event rows)', async () => {
  const r = realmOf(FIXTURES[1]);
  const back = await decodeRecord(await encodeRecord(r));
  assert.equal(back.events.length, r.events.length);
  assert.equal(back.events.length % EVENT_BYTES, 0);
  assert.deepEqual(back.tables.wars, r.tables.wars);
  assert.equal(back.tables.civs.length, r.tables.civs.length);
  assert.equal(back.years, r.years);
  assert.equal(eventAt(back, 0).type, EVENT_INDEX['world.hollowing']);
});

test('roads: A* path is 4-connected, land only, and none crosses the sea', () => {
  const r = buildRealm({ seed: 5 }), n = r.n, N = n * n;
  const land = []; for (let i = 0; i < N; i += 97) if (r.fields.elev[i] >= r.seaLevel) land.push(i);
  const S = { g: new Int32Array(N), from: new Int32Array(N), stamp: new Int32Array(N), k: 0 };
  let found = 0;
  for (let k = 0; k + 1 < land.length && k < 20; k++) {
    const p = roadPath(r, land[k], land[k + 1], S);
    if (!p) continue;
    found++;
    assert.equal(p[0], land[k]); assert.equal(p[p.length - 1], land[k + 1]);
    for (let j = 1; j < p.length; j++) { const d = Math.abs(p[j] - p[j - 1]); assert.ok(d === 1 || d === n); assert.ok(r.fields.elev[p[j]] >= r.seaLevel); }
  }
  assert.ok(found > 0);
});

test('time: history < 60 ms desktop at 64 x 64 and 250 years (median of 15 after warm-up)', () => {
  const realms = []; for (let k = 0; k < 20; k++) realms.push(buildRealm({ seed: 700 + k }));
  const ms = realms.map((r) => { const t0 = performance.now(); runHistory(r); return performance.now() - t0; });
  const med = ms.slice(5).sort((a, b) => a - b)[7];
  console.log(`# history median ${med.toFixed(1)} ms, max ${Math.max(...ms.slice(5)).toFixed(1)} ms`);
  assert.ok(med < 60, `${med.toFixed(1)} ms`);
});

test('engines: the history hash of the 3 fixtures is equal in Node and Chromium', async (t) => {
  const { launch } = await import('../lib/browsers.mjs');
  const browser = await launch('chromium').catch(() => null);
  if (!browser) { t.skip('Chromium (Playwright) is not installed'); return; }
  const { serve } = await import('../lib/static-server.mjs');
  const srv = await serve(0);
  try {
    const page = await browser.newPage();
    await page.goto(srv.url + 'tools/check-realm.mjs');
    const got = await page.evaluate(async (fx) => {
      const g = await import('/js/game/realm/gen.js'), h = await import('/js/game/realm/history.js');
      return fx.map((p) => { const r = g.buildRealm(p); h.settleHistory(r); return h.historyHash(r); });
    }, FIXTURES);
    const node = FIXTURES.map((p) => historyHash(realmOf(p)));
    console.log('# history hashes', node.join(' '));
    assert.deepEqual(got, node);
    if (BASE.has('fixture0')) assert.equal(node[0], BASE.get('fixture0'));
  } finally { await browser.close(); await srv.close(); }
});
