// W3.2 (EMBERCROWN-WORLD.md 12.5): the history text of js/data/text/realm.js (2.6).
// Oracle: every event of 3 seeds renders with no unfilled slot and no string over 160 characters; links open
// the right record (the record's name is in the line); the text is the same after the record round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRealm } from '../../js/game/realm/gen.js';
import { encodeRecordSync, decodeRecordSync } from '../../js/game/realm/record.js';
import { EVENT_TYPES } from '../../js/data/realm/events.js';
import * as RT from '../../js/data/text/realm.js';

const SEEDS = [{ seed: 1 }, { seed: 'Ashmark', size: 'small', sea: 2 }, { seed: 90210, size: 'large', hollowing: 'high', wildness: 'low' }];
const realms = new Map();
const realmOf = (p) => { const k = JSON.stringify(p); if (!realms.has(k)) realms.set(k, buildRealm(p, { history: true })); return realms.get(k); };
const KNOWN = new Set(['a', 'b', 'site', 'kind', 'n', 'oath', 'fall', 'places', 'pa', 'sa', 'cause', 'artdesc', 'by']);
const CAUSE_KNOWN = new Set(['pa', 'sa', 'kin', 'k', 'ky', 'p', 'e', 'o']);

test('every event type has a grammar row; the first tier has 2-6 variants; every slot is a known one', () => {
  for (const t of EVENT_TYPES) {
    const g = RT.GRAMMAR[t.key];
    assert.ok(g, `grammar row for ${t.key}`);
    const tiers = [g.v, ...Object.values(g.byArg || {})];
    for (const tier of tiers) {
      assert.ok(tier[0].length >= 1 && tier[0].length <= 6, `${t.key} first tier size`);
      for (const tpl of tier.flat()) for (const m of tpl.matchAll(/\{([a-z]+)\}/g)) assert.ok(KNOWN.has(m[1]), `${t.key}: unknown slot {${m[1]}}`);
    }
    if (!g.byArg) assert.ok(g.v[0].length >= 2, `${t.key}: at least 2 variants`);
  }
  for (const rows of RT.CAUSE_TEXT) for (const tpl of rows) for (const m of tpl.matchAll(/\{([a-z]+)\}/g)) assert.ok(CAUSE_KNOWN.has(m[1]), `cause slot {${m[1]}}`);
});

for (const p of SEEDS) {
  test(`seed ${p.seed}: every event renders, filled, <= ${RT.MAX_LINE} characters, ASCII, and its links name the right records`, () => {
    const r = realmOf(p), n = RT.eventCount(r);
    assert.ok(n > 500, `history has events (${n})`);
    let links = 0, maxLen = 0;
    for (let k = 0; k < n; k++) {
      const e = RT.eventText(r, k);
      assert.ok(!/[{}]|undefined|null|NaN|\[object/.test(e.text), `event ${k} ${e.key}: unfilled: ${e.text}`);
      assert.ok(e.text.length <= RT.MAX_LINE, `event ${k}: ${e.text.length} characters`);
      assert.ok(/^[\x20-\x7e]+$/.test(e.text), `event ${k}: plain text`);
      assert.ok(!/no one remembers|The world turned/.test(e.text), `event ${k} ${e.key}: fell back to the last-resort line`);
      assert.match(e.text, /^[A-Z]/);
      maxLen = Math.max(maxLen, e.text.length);
      const low = e.text.toLowerCase();
      for (const key of e.links) {
        const rec = RT.recordOf(r, key), pk = RT.parseWorldKey(key);
        assert.ok(rec, `event ${k}: link ${key} opens a record`);
        assert.equal(rec.id, pk.id, `event ${k}: link ${key} is that row`);
        if (pk.kind === 'war') assert.ok([rec.a, rec.b].some((c) => low.includes(r.tables.civs[c].name.toLowerCase())), `event ${k}: war link ${key} names a side`);
        else assert.ok(low.includes(RT.recordName(r, key).toLowerCase()), `event ${k}: link ${key} (${RT.recordName(r, key)}) is named in "${e.text}"`);
        links++;
      }
    }
    assert.ok(links > n, `events link their records (${links})`);
    assert.ok(RT.cachedLines(r) <= RT.CACHE_SIZE, 'the string cache stays at 200');
    assert.ok(maxLen > 60);
  });
}

test('every named record has a name; the per-record index holds each figure\'s deeds and each war\'s declaration', () => {
  const r = realmOf(SEEDS[0]), T = r.tables;
  for (const [kind, rows] of [['civ', T.civs], ['site', T.sites], ['fig', T.figures], ['art', T.artifacts], ['beast', T.beasts], ['war', T.wars]]) {
    for (const row of rows) {
      const key = RT.worldKey(kind, row.id), nm = RT.recordName(r, key);
      assert.ok(nm && nm.length >= 3 && nm.length <= 80 && !/undefined|null/.test(nm), `${key}: ${nm}`);
      assert.deepEqual(RT.parseWorldKey(key), { kind, id: row.id });
    }
  }
  for (const f of T.figures) {
    const ev = RT.eventsOf(r, RT.worldKey('fig', f.id));
    for (const d of f.deeds) assert.ok(ev.includes(d), `figure ${f.id}: deed row ${d} is indexed`);
  }
  for (const w of T.wars) assert.ok(RT.eventsOf(r, RT.worldKey('war', w.id)).some((k) => RT.eventText(r, k).key === 'war.declared'), `war ${w.id} declared`);
  assert.equal(RT.parseWorldKey('p3'), null);
  assert.equal(RT.recordOf(r, 'wf99999'), null);
});

test('deed lines carry their cause (2.5); the text is the same after the record round trip', () => {
  const r = realmOf(SEEDS[0]), n = RT.eventCount(r);
  let caused = 0;
  for (let k = 0; k < n; k++) { const e = RT.eventText(r, k); if (/, (to avenge|in vengeance|for the burning|in the war|for (her|his) people|keeping the pact|true to|to keep|to shield|seeking|for the glory|hungry)/.test(e.text)) caused++; }
  assert.ok(caused >= 20, `deeds with causes: ${caused}`);
  const back = decodeRecordSync(encodeRecordSync(r));
  for (let k = 0; k < n; k += 7) assert.equal(RT.eventText(back, k).text, RT.eventText(r, k).text, `event ${k} after the round trip`);
  const again = buildRealm(SEEDS[0], { history: true });
  for (let k = 0; k < n; k += 11) assert.equal(RT.eventText(again, k).text, RT.eventText(r, k).text, 'the same world reads the same');
});

test('words: years, names, oaths', () => {
  assert.equal(RT.yearText(231), 'Year 231');
  assert.equal(RT.yearText(-41), '41 years before the Fall');
  assert.equal(RT.oathText(10102), 'the Ash-and-Oak pact');
  assert.equal(RT.oathText(20304), 'the Twin Gate');
  assert.equal(RT.fallName(0), 'the First Breach');
  assert.equal(RT.artifactDesc({ kind: 'helm', mat: 'obsidian' }), 'an obsidian helm');
  assert.equal(RT.peopleWord('sylvari'), 'Thornwake');
});
