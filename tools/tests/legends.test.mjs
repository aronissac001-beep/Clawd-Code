// Step Z2.3 (EMBERCROWN-FORTRESS.md 3.5, 8.4): the Annals and legends. Owner K.
//   node --test tools/tests/legends.test.mjs
// Oracle: the pre-history is a pure function of the seed (zero save bytes); 1,500 records under 15 KB raw;
// every vault and every lair has a pre-history entry; the Annals list >= 30 figures (the day-200 bot figure is
// measured by the step's report run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createColony } from '../../js/game/core/state.js';
import { installSim } from '../../js/game/core/setup.js';
import { TER } from '../../js/game/core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { generateWorld3 } from '../../js/game/world/mapgen3.js';
import { saveBlobSync, loadBlob } from '../../js/game/save/colonysave.js';
import { COMP } from '../../js/game/save/codec.js';
import { attachPristine, pristineOf } from '../../js/game/save/pristine.js';
import {
  prehistory, prehistoryOf, beastIdentity, addLegend, legendEvent, legendRecords, parseLegend, legendOf, LEGEND_CAP,
  legendTap, legendKill, legendSystem, figuresOf, artifactsOf, placesOf, holdYears, relatedOf, recordName, roomName, roomNameIndex,
  EVENTS_MIN, EVENTS_MAX,
} from '../../js/game/colony/legends.js';
import { DATA as TEXT, TABLES } from '../../js/data/text/legends.js';

installSim({ stage: '3' });
const world = (seed) => { const s = createColony(seed, { d: 20, zS: 14, terrain: TER.AIR }); const info = generateWorld3(s); return { s, info }; };
const W5 = [1, 2, 3, 4, 5].map(world);
const LAIRS = ['lair', 'lair_gloomwyrm', 'lair_colossus', 'sleep'];

test('pre-history: a pure function of the seed (same twice, independent of the state, s.rng untouched, 0 save bytes)', () => {
  for (const { s, info } of W5) {
    const rng0 = JSON.stringify(s.rng), bytes0 = saveBlobSync(s, COMP.RLE);
    const a = prehistoryOf(s);
    const b = prehistory(s.seed, info.pristine.genVersion, JSON.parse(JSON.stringify(info.meta.dormant)), { w: s.w, h: s.h, zS: s.zS });
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(s.rng), rng0, 'no sim stream drawn');
    assert.ok(s.legend === undefined, 'nothing written to the state');
    const bytes1 = saveBlobSync(s, COMP.RLE);
    assert.equal(bytes1.length, bytes0.length, 'the save is the same size');
    assert.deepEqual(bytes1, bytes0, 'the save is byte-identical');
  }
  const x = prehistory(9, 1, []), y = prehistory(10, 1, []);
  assert.notDeepEqual(x.events.map((e) => e.text), y.events.map((e) => e.text), 'seeds differ');
});

test('pre-history: 40-120 events over the 300 years before the founding, oldest first', () => {
  for (const { s } of W5) {
    const p = prehistoryOf(s);
    assert.ok(p.events.length >= EVENTS_MIN && p.events.length <= EVENTS_MAX, `${p.events.length} events`);
    for (let k = 1; k < p.events.length; k++) assert.ok(p.events[k].y >= p.events[k - 1].y);
    assert.ok(p.events[0].y >= p.crownYear - 300 && p.events.at(-1).y < p.crownYear);
    for (const e of p.events) { assert.ok(e.text && !/\{|\}|undefined|null|NaN/.test(e.text), e.text); }
  }
  for (let seed = 1; seed <= 200; seed++) { const n = prehistory(seed, 1, []).events.length; assert.ok(n >= EVENTS_MIN && n <= EVENTS_MAX, `seed ${seed}: ${n}`); }
});

test('pre-history: every vault, every lair, the Sleep and every crypt has an entry naming its place', () => {
  for (const { s, info } of W5) {
    const p = prehistoryOf(s), rows = info.meta.dormant;
    const want = rows.filter((r) => r[0] === 'vault' || r[0] === 'crypt' || LAIRS.includes(r[0]));
    assert.ok(want.filter((r) => r[0] === 'vault').length >= 1 && want.filter((r) => r[0] === 'lair').length >= 4);
    for (const [kind, v] of want) {
      assert.ok(p.events.some((e) => e.place === v), `seed ${s.seed}: ${kind} at ${v} has an event`);
      assert.ok(p.places.some((q) => q.voxel === v), `seed ${s.seed}: ${kind} at ${v} is a place`);
    }
    // each generated beast's deed names it, and its name is H's (beastIdentity of the row seed)
    for (const [, v, rs] of rows.filter((r) => r[0] === 'lair')) assert.ok(p.events.some((e) => e.place === v && e.text.includes(beastIdentity(rs).full)));
    // the three legends and the faction foundings
    for (const n of ['The Hollow King', 'The Gloomwyrm', 'The Bone Colossus']) assert.ok(p.figures.some((f) => f.name === n));
    assert.equal(p.events.filter((e) => e.id === 'leg_faction_rise').length, 5);
    assert.ok(p.events.some((e) => e.id === 'leg_hollow_seal'));
  }
});

test('owner decision 4: the pre-history never mentions a hold (no earlier fallen holds)', () => {
  const bad = /\b(holds?|colon(y|ies)|hearth|fallen hold)\b/i;
  for (const { s } of W5) for (const e of prehistoryOf(s).events) assert.ok(!bad.test(e.text), e.text);
  for (const t of TEXT.text.filter((t) => !t.id.startsWith('leg_ev_'))) assert.ok(!bad.test(t.text), t.id);
  for (const k of Object.keys(TABLES)) for (const w of TABLES[k]) assert.ok(!bad.test(w), `${k}: ${w}`);
});

test('records: 1,500 records under 15 KB raw; the cap holds; parse round trip; one record per key', () => {
  const s = createColony(3, {});
  s.tick = 5;
  let n = 0;
  // a long hold's mix: 30% figures, 10% places, 5% artifacts, 55% events with 1-2 links
  for (let k = 0; n < LEGEND_CAP; k++) {
    s.tick = 6 + k * 3000;
    const m = k % 20;
    if (m < 6) { if (addLegend(s, 'c', 10 + k)) n++; }
    else if (m < 8) { if (addLegend(s, m === 6 ? 'r' : 'l', m === 6 ? 300000 + k * 97 : k, { name: roomNameIndex(3, k) })) n++; }
    else if (m < 9) { if (addLegend(s, 'a', 2000 + k, { links: ['c' + (10 + k).toString(36)], text: 'the Lamp of Quiet Hours' })) n++; }
    else if (legendEvent(s, TABLES.eventTypes[k % TABLES.eventTypes.length], k % 3 ? ['c' + (10 + k).toString(36)] : ['c' + (10 + k).toString(36), 'c' + (11 + k).toString(36)])) n++;
  }
  assert.equal(legendRecords(s).length, LEGEND_CAP);
  const raw = JSON.stringify(s.legend).length;
  assert.ok(raw < 15 * 1024, `${raw} bytes raw`);
  assert.equal(legendEvent(s, 'raid'), false, 'full: nothing more is written');
  assert.equal(addLegend(s, 'c', 99999), null);
  assert.equal(legendRecords(s).length, LEGEND_CAP);
  const t = createColony(4, {});
  t.tick = TICKS_PER_DAY * 40 + 7;
  assert.equal(addLegend(t, 'a', 77, { links: ['c5'], text: 'the Torc of Grey Mornings' }), 'a25');
  assert.equal(addLegend(t, 'a', 77, { text: 'other' }), 'a25', 'idempotent');
  assert.ok(legendEvent(t, 'office', ['c5']));
  const a = legendOf(t, 'a25');
  assert.deepEqual({ kind: a.kind, id: a.id, day: a.day, links: a.links, text: a.text }, { kind: 'a', id: 77, day: 40, links: ['c5'], text: 'the Torc of Grey Mornings' });
  const e = parseLegend(legendRecords(t)[1]);
  assert.deepEqual({ kind: e.kind, event: e.event, day: e.day, links: e.links }, { kind: 'e', event: 'office', day: 40, links: ['c5'] });
  assert.equal(legendRecords(t).length, 2);
  assert.match(roomName(roomNameIndex(1, 12345)), /^the \w+ of \w+ \w+$/);
});

test('hooks: artifacts, deaths, figures, levels; reading on an old state with no records', () => {
  const { s } = W5[0];
  const t = { ...s, col: s.col.slice(), legend: undefined };
  attachPristine(t, pristineOf(s));
  // an old save (no s.legend): every reader works and the figures come from the colonists and the pre-history
  const f0 = figuresOf(t);
  assert.ok(f0.length >= 25, `${f0.length} figures of old`);
  assert.ok(artifactsOf(t).length >= 2 && placesOf(t).length >= 8 && holdYears(t).length === 0);
  const c0 = { id: 1, name: 'Tamsin Reed', sk: {}, hp: { dead: false }, z: 8, x: 0, y: 0 }, c1 = { id: 2, name: 'Odo Vane', sk: {}, hp: { dead: false }, z: t.zS, x: 0, y: 0 };
  t.col = [c0, c1]; t.st = { ...t.st, nemeses: [] }; t.rt = { ...t.rt, rooms: [] };
  t.tick = TICKS_PER_HOUR * 30;
  legendSystem(t);
  assert.ok(legendOf(t, 'c1') && legendOf(t, 'c2') && legendOf(t, 'l8'), 'two figures and level 8 opened');
  assert.ok(!legendOf(t, 'l' + t.zS.toString(36)), 'the surface is not an opening');
  legendTap(t, { name: 'artifact', data: { itemId: 40, colId: 1, name: 'the Ember Circlet of Odo' } });
  assert.equal(recordName(t, 'a14'), 'the Ember Circlet of Odo');
  assert.ok(relatedOf(t, 'c1').includes('a14'));
  c1.hp.dead = true;
  legendKill(t, c1, null);
  const lines = holdYears(t).map((l) => l.text);
  assert.ok(lines.some((l) => /new level was opened: The Glowcap Hollows/.test(l)), lines.join(' | '));
  assert.ok(figuresOf(t).some((f) => f.name === 'Odo Vane' && f.group === 'dead'));
  assert.ok(artifactsOf(t).some((a) => a.name === 'the Ember Circlet of Odo' && a.sub === 'Made by Tamsin Reed'));
  // the hourly cadence: off the hour nothing is written
  const before = t.legend; t.tick += 1; legendSystem(t); assert.equal(t.legend, before);
});

test('a Z1 save and a v2 fixture load and read their Annals; the pre-history survives a save and load', async () => {
  const { s } = W5[1];
  const back = await loadBlob(saveBlobSync(s, COMP.RLE));
  assert.deepEqual(prehistoryOf(back), prehistoryOf(s));
  const old = await loadBlob(new Uint8Array(readFileSync(new URL('../fixtures/v2-s2-day60.ecsave', import.meta.url))));
  const p = prehistoryOf(old);
  assert.ok(p.events.length >= EVENTS_MIN);
  assert.ok(figuresOf(old).length >= 20 && artifactsOf(old).length >= 1);
  assert.equal(holdYears(old).length, 0);
});

// ---- W3.3b: the vale's chapter in world years (EMBERCROWN-WORLD.md 2.1, 2.7 vale pre-history row) ---------------
// Oracle: every re-dated vale event falls before embarkYear (vale year k -> embarkYear - (valeSpan - k)); names, kinds,
// keys and voxels are the legacy chapter's; a vault's world builder is a figure of the liege civ alive and grown at the
// vault's world year; a hold with no world keeps Crown years.
import { buildRealm } from '../../js/game/realm/gen.js';
import { idx as ridx, isEmbarkable } from '../../js/game/realm/query.js';
import { realmField } from '../../js/game/core/setup.js';
import { bindRoles, liegeCiv } from '../../js/game/colony/factions.js';
import { valeWorld, valeToWorld, valeYearText, VALE_SPAN, VALE_BUILDER } from '../../js/game/colony/legends.js';
import { HISTORY_PEOPLES } from '../../js/data/realm/civkinds.js';
import { figureName } from '../../js/data/text/realm.js';

test('W3.3b: the vale pre-history is re-dated in world years, every event before embarkYear; vault builders are world figures', () => {
  const R = buildRealm({ seed: 7 }, { history: true });
  const regs = [];
  for (let i = 0; i < R.n * R.n; i++) if (isEmbarkable(R, i)) regs.push(i);
  let builders = 0, vaults = 0, events = 0;
  for (let k = 0; k < W5.length; k++) {
    const { s } = W5[k], base = prehistory(s.seed, pristineOf(s).genVersion | 0, pristineOf(s).meta.dormant || [], { w: s.w, h: s.h, zS: s.zS });
    assert.equal(valeWorld(s), false);
    assert.deepEqual(prehistoryOf(s), base, 'no world: the legacy chapter');
    assert.equal(valeYearText(s, 812), 'Crown year 812');
    const i = regs[Math.floor(((k + 0.5) * regs.length) / W5.length)];
    s.realm = realmField(R, i % R.n, (i / R.n) | 0);
    try {
      assert.equal(prehistoryOf(s).era, 'world', 'no record: re-dated, no builders');
      s.rt.realm = R;
      bindRoles(s, R);
      const L = liegeCiv(s), ey = s.realm.embarkYear, v = prehistoryOf(s);
      assert.ok(valeWorld(s) && ey === R.years && ey > 0);
      assert.equal(v.events.length, base.events.length);
      for (let j = 0; j < v.events.length; j++) {
        const e = v.events[j], b = base.events[j];
        assert.equal(e.y, valeToWorld(ey, base.crownYear, b.y));
        assert.equal(e.y, ey - (VALE_SPAN - (b.y - base.start)));
        assert.ok(e.y < ey, `vale event ${e.id} at ${e.y} before embark ${ey}`);
        assert.equal(e.cy, b.y);
        assert.deepEqual([e.id, e.text, e.place, e.kind], [b.id, b.text, b.place, b.kind]);
        events++;
      }
      assert.deepEqual(v.figures.map((f) => [f.key, f.name, f.kind, f.title, f.place]), base.figures.map((f) => [f.key, f.name, f.kind, f.title, f.place]));
      assert.deepEqual(v.places.map((p) => [p.key, p.name, p.kind, p.voxel]), base.places.map((p) => [p.key, p.name, p.kind, p.voxel]));
      for (const f of v.figures) { assert.ok(!/Crown year/.test(f.text), f.text); if (f.to !== null && f.to !== undefined) assert.ok(f.to < ey); }
      for (const p of v.places) {
        if (p.kind !== 'vault') continue;
        vaults++;
        if (!p.by) continue;
        builders++;
        const f = R.tables.figures[+p.by.slice(2)], made = v.events.find((e) => e.id === 'leg_vault_made' && e.place === p.voxel);
        assert.equal(f.civ, L);
        assert.ok(f.born + HISTORY_PEOPLES[f.people].lifespan[0] <= made.y && (f.died === null || f.died >= made.y));
        assert.ok(made.figs.includes(p.by) && p.text.includes(figureName(f)));
        assert.equal(recordName(s, p.by), figureName(f));
      }
      assert.match(valeYearText(s, -12), /12 years before the Fall/);
      assert.equal(valeYearText(s, 40), 'Year 40');
      // the sim reads the same chapter with the record lost
      s.rt.realm = null;
      assert.deepEqual(prehistoryOf(s).places.map((p) => p.name), base.places.map((p) => p.name));
    } finally { delete s.realm; delete s.rt.realm; }
    assert.deepEqual(prehistoryOf(s), base, 'the memo follows the state');
  }
  console.log(`# W3.3b vale: ${events} events re-dated; ${builders}/${vaults} vaults raised by world figures (${VALE_BUILDER.pct} % when one fits)`);
  assert.ok(vaults > 0);
});
