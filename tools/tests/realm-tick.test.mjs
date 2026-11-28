// W3.8 the season tick and the news (EMBERCROWN-WORLD.md 2.8, G5, G6; step W3.8, owners L and K).
// Oracle: < 2 ms desktop a tick (the bench scene realmtick measures it; this test keeps a loose mean); deltas
// <= 16 KB after a 300-day soak; a hold saved at any tick continues identically after a reload; no tick creates a
// threat directly (G6): it writes only s.realm and goodwill. Holds are one-plane test holds with a world region's
// s.realm and the decoded record in s.rt.realm, from worlds built with history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, realmField } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { stateHash } from '../../js/game/core/state.js';
import { checkRealmField, REALM_DELTA_CAP } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../js/game/core/time.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { buildRealm } from '../../js/game/realm/gen.js';
import { isEmbarkable } from '../../js/game/realm/query.js';
import { EVENT_INDEX as E } from '../../js/data/realm/events.js';
import * as T from '../../js/game/realm/tick.js';
import * as N from '../../js/game/colony/news.js';
import { sitesNow, goodwill, factionOfCiv } from '../../js/game/colony/factions.js';

const SEASON = T.SEASON_TICKS, D1 = TICKS_PER_DAY;
const WORLDS = +(process.env.TICK_WORLDS || 4), PER = 3;
const worlds = new Map();
const worldOf = (seed) => worlds.get(seed) || worlds.set(seed, buildRealm({ seed }, { history: true })).get(seed);
/** The PER embarkable regions with the most record sites within 16 regions (the busiest neighbourhoods). */
function regionsOf(R) {
  const all = [];
  for (let i = 0; i < R.n * R.n; i++) {
    if (!isEmbarkable(R, i)) continue;
    const x = i % R.n, y = (i / R.n) | 0;
    let k = 0;
    for (const t of R.tables.sites) if (t.razed === null && Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 16) k++;
    all.push([k, i]);
  }
  all.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return all.filter((_, j) => j % 97 === 0).slice(0, PER).map(([, i]) => [i % R.n, (i / R.n) | 0]);
}
function hold(R, rx, ry, seed = 'W38') {
  installSim({ stage: '2', reset: true, checks: true });
  T.installRealmTick(); N.installNews();
  const s = foundColony({ seed: `${seed}:${R.seed}:${rx},${ry}`, name: 'Test Hold' });
  s.realm = realmField(R, rx, ry);
  s.rt.realm = R;
  return s;
}
const holds = function* () { for (let w = 1; w <= WORLDS; w++) { const R = worldOf(w); for (const [rx, ry] of regionsOf(R)) yield { R, rx, ry }; } };
/** Run season ticks directly (the tick system at each season's first tick) through `days`. */
function soak(s, days) {
  const times = [];
  for (let t = SEASON; t <= days * D1; t += SEASON) { s.tick = t; const t0 = performance.now(); T.realmTickSystem(s); times.push(performance.now() - t0); }
  return times;
}

test('W3.8: a realm-less hold is untouched by the tick and the news', () => {
  const R = worldOf(1), [[rx, ry]] = regionsOf(R), s = hold(R, rx, ry);
  s.realm = null;
  s.tick = SEASON;
  const h = stateHash(s);
  assert.equal(T.realmTickSystem(s), null);
  s.tick = SEASON + TICKS_PER_HOUR; assert.equal(N.newsSystem(s), null);
  s.tick = SEASON; assert.equal(stateHash(s), h);
});

test('W3.8: 300-day soak: deltas <= 16 KB, valid rows, the world moves, the year advances', () => {
  const tot = { wars: 0, ended: 0, sites: 0, dead: 0, rumours: 0 }, all = [];
  let worst = 0;
  for (const { R, rx, ry } of holds()) {
    const s = hold(R, rx, ry);
    all.push(...soak(s, 300));
    const sr = s.realm, bytes = T.deltaBytes(sr);
    worst = Math.max(worst, bytes);
    assert.deepEqual(checkRealmField(sr), [], `${R.seed} ${rx},${ry}`);
    assert.ok(bytes <= REALM_DELTA_CAP, `deltas ${bytes} B`);
    assert.equal(sr.year, sr.embarkYear + 7, 'year after 300 days');
    for (const w of sr.wars) { assert.ok(w[3] === null || w[2] <= w[3], 'began <= ended'); tot.wars++; if (w[3] !== null) tot.ended++; }
    const now = sitesNow(s, R);
    for (const d of sr.sites) {
      tot.sites++;
      assert.ok(d[1] === -1 || (R.tables.civs[d[1]] && R.tables.civs[d[1]].fell === null), 'a site owner is a living civ of the record');
      assert.equal(now[d[0]].civ, d[1] < 0 ? null : d[1]);
    }
    // no open war involves a civ with no living site
    const live = new Set(now.filter((x) => x.civ !== null).map((x) => x.civ));
    for (const w of sr.wars) if (w[3] === null) assert.ok(live.has(w[0]) && live.has(w[1]), 'an open war between living civs');
    for (const w of R.tables.wars) if (w.ended === null && !sr.wars.some((d) => d[0] === Math.min(w.a, w.b) && d[2] === w.began)) assert.ok(live.has(w.a) && live.has(w.b));
    tot.dead += sr.dead.reduce((n, x) => { let c = 0; for (let v = x >>> 0; v; v >>>= 1) c += v & 1; return n + c; }, 0);
    for (const r of sr.ev) { assert.equal(r.length, 7); if (r[6] & T.EV_FLAG.rumour) { tot.rumours++; assert.ok(r[1] >= 0); } }
  }
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  console.log(`realm-tick soak: ${JSON.stringify(tot)}; worst deltas ${worst} B; tick mean ${mean.toFixed(3)} ms, max ${Math.max(...all).toFixed(2)} ms over ${all.length}`);
  assert.ok(tot.wars > 0 && tot.dead > 0 && tot.rumours > 0, 'wars, deaths and rumours happen');
  assert.ok(mean < 2, `tick mean ${mean} ms`);
});

test('W3.8: the deltas stay under the cap when the world is busy (fold)', () => {
  const R = worldOf(2), [[rx, ry]] = regionsOf(R), s = hold(R, rx, ry);
  for (let k = 0; k < 900; k++) s.realm.ev.push([k, E['war.battle'], 1, 2, 3, -1, T.EV_FLAG.rumour]);
  soak(s, 40);
  const sum = s.realm.ev.find((r) => r[1] === T.HOLD_EV.summary);
  assert.ok(sum && sum[2] >= 500, 'the oldest rows folded into the summary');
  assert.ok(s.realm.ev.filter((r) => r[1] >= 0 || r[1] < T.HOLD_EV.base).length <= T.TICK.evCap);
  assert.ok(T.deltaBytes(s.realm) <= REALM_DELTA_CAP - T.TICK.byteHead);
});

test('W3.8: the tick is deterministic and touches only s.realm and goodwill (no threat, G6)', () => {
  for (const { R, rx, ry } of [...holds()].slice(0, 4)) {
    const a = hold(R, rx, ry), b = hold(R, rx, ry);
    const st0 = JSON.stringify(a.st), raids0 = JSON.stringify(a.raids || null);
    const col0 = JSON.stringify({ ...a.colony, factions: null, techs: null });
    soak(a, 300); soak(b, 300);
    assert.equal(JSON.stringify(a.realm), JSON.stringify(b.realm), 'same world, same deltas');
    assert.equal(JSON.stringify(a.st), st0, 'the story record (queue, letters, nemeses) is untouched');
    assert.equal(JSON.stringify(a.raids || null), raids0, 'no raid');
    assert.equal(JSON.stringify({ ...a.colony, factions: null, techs: null }), col0, 'the colony record is untouched but goodwill');
  }
});

test('W3.8: saved at any tick, a hold continues identically after a reload', () => {
  const R = worldOf(1), [[rx, ry]] = regionsOf(R), s = hold(R, rx, ry), B = 4 * SEASON - 900;
  s.tick = B;                                   // just before a season's first tick (the tick runs in the sim)
  s.colony.ledger.total = { ...(s.colony.ledger.total || {}), artifacts: 1 };
  for (const at of [300, 900, 1500]) {          // saved before, at and after the season tick
    step(s, B + at - s.tick);
    const t = loadBlobSync(saveBlobSync(s));
    t.rt.realm = R;
    assert.equal(stateHash(t), stateHash(s), `hash after load at +${at}`);
    step(s, 600); step(t, 600);
    assert.equal(stateHash(t), stateHash(s), `the same 600 ticks later (saved at +${at})`);
    assert.equal(JSON.stringify(t.realm), JSON.stringify(s.realm));
  }
  assert.ok(s.realm.year === s.realm.embarkYear + 1 && s.realm.ev.some((r) => r[1] === T.HOLD_EV.base), 'the season tick ran in the sim');
});

test('W3.8: news arrives only with a traveller who came after it; the record lost says so', () => {
  const R = worldOf(1), [[rx, ry]] = regionsOf(R), s = hold(R, rx, ry);
  const site = R.tables.sites.find((x) => x.razed === null), civ = site.civ, H1 = TICKS_PER_HOUR;
  s.realm.ev.push([10, E['site.razed'], civ, civ, site.id, -1, T.EV_FLAG.rumour], [10, E['war.declared'], civ, civ, 0xffff, -1, T.EV_FLAG.rumour]);
  s.tick = SEASON + 3 * H1;
  assert.equal(N.newsSystem(s), null, 'no traveller');
  if (!s.colony.trade) s.colony.trade = { visits: [] };
  s.colony.trade.visits.push({ id: 900, trader: 'x', until: SEASON + 5 * H1, stock: [], coins: 0 });   // came a day before the rumour
  assert.equal(N.newsSystem(s), null, 'a caravan that came before the news');
  s.colony.trade.visits.push({ id: 901, trader: 'x', until: SEASON + 2 * H1 + D1, stock: [], coins: 0, site: site.id });
  const l = N.newsSystem(s);
  assert.ok(l && l.kind === 'minor' && l.text.includes(site.name), l && l.text);
  assert.ok(l.title.includes(site.name), l.title);
  assert.equal(N.pendingRumours(s).length, 0);
  s.realm.ev.push([10, E['war.declared'], civ, civ, 0xffff, -1, T.EV_FLAG.rumour]);
  s.rt.realm = null;
  s.tick += H1;
  assert.equal(N.newsSystem(s).text, N.NEWS_WORDS.lost, 'the record lost');
});

test('W3.8: the hold\'s deeds become world rows and move goodwill by ethics; renown raises standing', () => {
  let moved = 0, rows = 0;
  for (const { R, rx, ry } of [...holds()].slice(0, 6)) {
    const s = hold(R, rx, ry);
    s.tick = SEASON; T.realmTickSystem(s);               // the base row (first season: counts from 0)
    const base = s.realm.ev.find((r) => r[1] === T.HOLD_EV.base);
    assert.ok(base, 'base row');
    const civs = R.tables.civs.map((c) => c.id), before = civs.map((c) => goodwill(s, factionOfCiv(s, c)));
    s.colony.ledger.total = { ...(s.colony.ledger.total || {}), artifacts: 2, raidsRepelled: 1 };
    s.colony.renown = { known: ['smithing'] };
    s.tick = 2 * SEASON; T.realmTickSystem(s);
    rows += s.realm.ev.filter((r) => r[1] === T.HOLD_EV.artifact || r[1] === T.HOLD_EV.siege).length;
    moved += civs.filter((c, k) => goodwill(s, factionOfCiv(s, c)) !== before[k]).length;
    s.tick = 3 * SEASON; T.realmTickSystem(s);
    assert.equal(s.realm.ev.filter((r) => r[1] === T.HOLD_EV.artifact).length, 2, 'a deed is posted once');
  }
  assert.ok(rows > 0 && moved > 0, `deed rows ${rows}, goodwill moved ${moved}`);
});
