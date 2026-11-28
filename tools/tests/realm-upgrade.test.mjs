// History for W2-era worlds (EMBERCROWN-WORLD.md 9.2, 12.5 step W3.7; record.js recVersion path, realmstore.js).
// A W2 fixture world (a recVersion 1 record with no history) holds two embarked holds (one founded by foundColony,
// one stub fortress), each standing in a region where an unsettled history would have put a site. The first hold
// loaded grows the record: history over the stored fields with both regions settled and empty; the record is
// rewritten (recVersion 2, `base` = the old CRCs) and the roles are bound as in 9.4 step 4. The second hold finds
// the grown record by its `base`. Local states stay byte-identical; save and reload continues identically.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { stateHash, checkState, entitiesJSON, valueHash } from '../../js/game/core/state.js';
import { LAYERS as GRID_LAYERS } from '../../js/game/core/grid.js';
import { realmField } from '../../js/game/core/setup.js';
import { saveBlob, loadBlob, forgetPristine } from '../../js/game/save/colonysave.js';
import { pristineOf } from '../../js/game/save/pristine.js';
import * as slots from '../../js/game/save/slots.js';
import * as RS from '../../js/game/save/realmstore.js';
import * as R from '../../js/game/realm/record.js';
import { buildRealm, realmHash } from '../../js/game/realm/gen.js';
import { historyHash } from '../../js/game/realm/history.js';
import { idx as ridx, isEmbarkable, siteOf } from '../../js/game/realm/query.js';
import { ROLE_IDS } from '../../js/game/colony/factions.js';
import { stubFortress, digFortress } from './fortress-stub.mjs';

const HOUR = 600;
installSim({ stage: '2' });
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, clear: () => m.clear() };
}
const layerHashes = (s) => GRID_LAYERS.map((l) => valueHash(s.L[l.name]));
const entNoRealm = (s) => { const o = JSON.parse(entitiesJSON(s)); delete o.realm; return JSON.stringify(o); };
const local = (s) => ({ L: layerHashes(s), ent: entNoRealm(s), pcrc: pristineOf(s).crc.slice(), fac: JSON.stringify(s.colony.factions) });
const run = (s, ticks) => { const t = s.tick + ticks; while (s.tick < t && s.colony.fallen !== true) tick(s); return s; };

const W2 = buildRealm({ seed: 11 }, { history: false });   // the W2 fixture world: fields only
let A, B, sA, sB, v1bytes, oldCrc, grown;
before(async () => {
  slots.setBackends({ localStorage: fakeStorage(), clock: () => 1_700_000_000_000, resetIdb: true });
  forgetPristine();
  // two embarkable regions where an unsettled history places a living site (so "settled and empty" is tested)
  const open = buildRealm(W2.params, { history: true });
  const picks = open.tables.sites.filter((x) => x.razed === null && isEmbarkable(open, ridx(open, x.x, x.y))).map((x) => [x.x, x.y]);
  assert.ok(picks.length >= 2, 'the open history has sites on embarkable land');
  [A, B] = [picks[0], picks.find((p) => Math.max(Math.abs(p[0] - picks[0][0]), Math.abs(p[1] - picks[0][1])) > 3)];
  // the store holds the W2 record as W2 wrote it (recVersion 1)
  v1bytes = await R.encodeRecord(W2); v1bytes[4] = 1;
  const w = await RS.writeRealm(v1bytes); oldCrc = w.crc;
  // hold A: founded in the world by W2 (embarkYear 0, nothing bound); hold B: a stub fortress in another region
  sA = foundColony({ seed: 'x', name: 'Hold A', realm: W2, rx: A[0], ry: A[1], start: null, d: 20 }); sA.id = 'ha'; run(sA, HOUR);   // played an hour under W2 (a save made at the founding tick itself does not continue identically today: see the W3.7 report)
  sB = stubFortress(5); sB.id = 'hb'; sB.realm = realmField(W2, B[0], B[1]); digFortress(sB);
  for (const s of [sA, sB]) {
    await slots.ensurePristineStored(s);
    await slots.writeSlot(s.id, await saveBlob(s), slots.cardOf(s));
    await RS.noteHold(W2.wid, s.id, s.realm.rx, s.realm.ry, { name: W2.params.name, size: W2.n });
  }
  // the regenerated history the grown record must equal: createRealm with both regions settled
  grown = buildRealm(W2.params, { history: true, settled: [ridx(W2, A[0], A[1]), ridx(W2, B[0], B[1])] });
});

test('the recVersion path: a v1 record reads; a W2 world needs history, a W3 one does not', async () => {
  const h = R.readRecordHeader(v1bytes);
  assert.equal(h.recVersion, 1); assert.equal(h.years, 0);
  const d = await R.decodeRecord(v1bytes);
  assert.equal(realmHash(d), realmHash(W2));
  assert.equal(R.needsHistory(d), true); assert.equal(R.hasHistory(d), false);
  assert.equal(R.needsHistory(grown), false); assert.equal(R.hasHistory(grown), true);
  assert.deepEqual(R.recordParts(W2).crc, R.recordParts(d).crc, 'no `base`: the TABLES bytes of a plain record are unchanged');
  assert.throws(() => R.historyLater(grown).next(), /history already/);
});

test('gated: HISTORY off (the dark flag) or a realm-less hold changes nothing', async () => {
  const s = await loadBlob((await slots.readSlot('ha')).bytes, { pristine: slots.pristineResolver('ha') });
  const h = stateHash(s);
  assert.equal(RS.holdNeedsHistory(s, { on: false }), false);
  assert.equal(await RS.upgradeHold(s, { on: false }), null);
  assert.equal(RS.holdNeedsHistory(s, { on: true }), true);
  assert.equal(RS.holdNeedsHistory({ ...s, realm: null }, { on: true }), false);
  assert.equal(stateHash(s), h);
});

test('hold A grows the W2 world: history over the stored fields, both holds settled and empty, roles bound, local state byte-identical', async () => {
  const s = await loadBlob((await slots.readSlot('ha')).bytes, { pristine: slots.pristineResolver('ha') });
  const was = local(s);
  let frames = 0;
  const t0 = performance.now();
  const out = await RS.upgradeHold(s, { on: true, frame: async () => { frames++; }, budgetMs: 0 });
  const ms = performance.now() - t0;
  assert.equal(out.from, 'grew');
  assert.ok(frames >= 10, `grown in steps (${frames} frames)`);
  const realm = out.realm;
  // the world gained its history, equal to the generator's with the two regions settled
  assert.ok(realm.tables.civs.length > 0 && realm.years === 250 && R.hasHistory(realm));
  assert.equal(historyHash(realm), historyHash(grown), 'history over the stored fields = createRealm({ history, settled })');
  assert.equal(realmHash(realm), realmHash(grown));
  assert.equal(siteOf(realm, A[0], A[1]), null, 'hold A\'s region holds no site');
  assert.equal(siteOf(realm, B[0], B[1]), null, 'hold B\'s region holds no site');
  assert.deepEqual(realm.base, oldCrc, 'base = the W2 record\'s CRCs');
  // the record is rewritten (recVersion 2) and the world row keeps its holds
  const stored = await RS.readRealmBytes(W2.wid), h = R.readRecordHeader(stored);
  assert.equal(h.recVersion, R.REC_VERSION); assert.equal(h.years, 250); assert.equal(h.wid, W2.wid >>> 0);
  assert.deepEqual(R.recordParts(realm).crc, h.crc);
  const row = await RS.readWorld(W2.wid);
  assert.deepEqual(row.holds.map((x) => x[0]), ['ha', 'hb']); assert.equal(row.year, 250);
  // the hold: its reference, years, roles and liege; nothing else
  const f = s.realm;
  assert.deepEqual(f.crc, h.crc); assert.equal(f.embarkYear, 250); assert.equal(f.year, 250 + Math.floor(s.tick / (HOUR * 24 * 40)));
  for (const r of ROLE_IDS) assert.ok(Number.isInteger(f.bind[r]), `role ${r} bound`);
  assert.equal(f.civ, f.bind.hearthwatch); assert.equal(realm.tables.civs[f.civ].people, 'human');
  assert.equal(s.rt.realm, realm);
  assert.deepEqual(local(s), was, 'every L layer, the pristine CRCs, every entity and the goodwill');
  assert.deepEqual(checkState(s), []);
  console.log(`# W3.7 grow: ${realm.tables.civs.length} civs, ${realm.tables.sites.length} sites, ${R.eventsBytes(realm).length / 12} events, record ${stored.length} B, ${ms.toFixed(0)} ms (history, encode, write, read back)`);
  // determinism from the upgraded state: save, reload (record from the store by the new reference) and continue
  const saved = await saveBlob(s);   // (same tick as slot a: the slot pick by tick would not see it as newer)
  const t = await loadBlob(saved, { pristine: slots.pristineResolver('ha') });
  assert.equal(stateHash(t), stateHash(s));
  const back = await RS.resolveRealm({ ref: t.realm, colonyId: 'ha' });
  assert.equal(back.from, 'store'); assert.ok(!back.grown);
  t.rt.realm = back.realm;
  assert.equal(await RS.upgradeHold(t, { on: true }), null, 'done once');
  run(s, 2 * HOUR); run(t, 2 * HOUR);
  assert.equal(stateHash(t), stateHash(s), 'continues identically after save and reload');
});

test('hold B finds the grown record by its base: no second rewrite, the same history, its own roles', async () => {
  const s = await loadBlob((await slots.readSlot('hb')).bytes, { pristine: slots.pristineResolver('hb') });
  const was = local(s), before = await RS.readRealmBytes(W2.wid);
  assert.deepEqual(s.realm.crc, oldCrc, 'B still references the W2 record');
  const out = await RS.upgradeHold(s, { on: true });
  assert.equal(out.from, 'grown');
  assert.deepEqual(await RS.readRealmBytes(W2.wid), before, 'the record is not rewritten again');
  assert.equal(historyHash(out.realm), historyHash(grown));
  assert.equal(s.realm.embarkYear, 250);
  for (const r of ROLE_IDS) assert.ok(Number.isInteger(s.realm.bind[r]), `role ${r} bound`);
  assert.deepEqual(local(s), was);
  // a reference matching neither the grown record nor its base is still never served it
  assert.equal((await RS.resolveRealm({ ref: { wid: W2.wid, crc: [1, 2, 3] } })).realm, null);
});

test('a missing record changes nothing: the hold loads as today', async () => {
  const s = stubFortress(9); s.id = 'hc'; s.realm = { ...realmField(W2, 5, 5), crc: [1, 2, 3] };   // no copy (nor a regeneration) fits
  const h = stateHash(s);
  const out = await RS.upgradeHold(s, { on: true, colonyId: 'no-such-hold' });
  assert.equal(out.from, 'missing'); assert.equal(out.realm, null);
  assert.equal(stateHash(s), h); assert.equal(s.realm.embarkYear, 0);
});
