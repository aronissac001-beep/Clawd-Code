// State v5, migration part 1 (EMBERCROWN-WORLD.md 9.1, 9.4; step W2.8; owner A). v4to5 is shape only: realm = null,
// the weather record stays v1 until W5.1 (weatherToV2 waits for it), no air until W5.9. The 3 W0 fixtures load
// through it with every local byte untouched, hash as they were saved and continue to their sidecar hashes, and a
// save and reload continues identically (the legacy-hash rule, 12.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATE_VERSION } from '../../js/game/core/schema.js';
import { migrations, migrate, stateHash } from '../../js/game/core/state.js';
import { v4to5, weatherToV2, isWeatherV2 } from '../../js/game/core/migrate5.js';
import * as FLAGS from '../../js/game/core/flags.js';
import { peekEntities, loadBlob } from '../../js/game/save/colonysave.js';
import { decodeAny, unframePayload3, FLAG_PRISTINE } from '../../js/game/save/codec.js';
import { continueBlob } from '../capture-fixture.mjs';

const FIX = new URL('../fixtures/', import.meta.url);
const NAMES = ['v4-z3-day120', 'v4-z3-flood', 'v4-z3-beast'];
const bytesOf = (n) => new Uint8Array(readFileSync(new URL(`${n}.ecsave`, FIX)));
const metaOf = (n) => JSON.parse(readFileSync(new URL(`${n}.json`, FIX), 'utf8'));

test('state v5: migrations[3] is v4to5', () => {
  assert.equal(STATE_VERSION, 5);
  assert.equal(migrations.length, 4);
  assert.equal(migrations[3], v4to5);
});

test('v4to5: realm = null, weather untouched while CLIMATE2 is off, the version it came from', () => {
  const w = { kind: 'rain', since: 100, until: 700, day: 3 };
  const ent = { meta: { id: 'x' }, colony: { world: { weather: { ...w } } }, col: [] };
  v4to5(ent);
  assert.equal(ent.realm, null);
  assert.equal(ent.meta.migratedFrom, 4);
  if (FLAGS.CLIMATE2 !== true) assert.deepEqual(ent.colony.world.weather, w, 'v1 until W5.1');
  // a malformed realm value never refuses the hold: it is dropped
  for (const bad of ['x', [], { rx: 1 }, 7]) assert.equal(v4to5({ meta: {}, realm: bad }).realm, null);
  // an older save keeps the first version it came from
  assert.equal(v4to5({ meta: { migratedFrom: 2 } }).meta.migratedFrom, 2);
});

test('weatherToV2: the current kind kept, calm scalars, no front; idempotent', () => {
  const v2 = weatherToV2({ kind: 'snow', since: 600, until: 9000, day: 12 });
  assert.deepEqual(v2, { v: 2, kind: 'snow', since: 600, until: 9000, day: 12, front: null, wind: [0, 0], cloud: 0, fog: 0, wet: 0, snow: 0, hourAt: 600 });
  assert.ok(isWeatherV2(v2));
  assert.equal(weatherToV2(v2), v2);
  assert.equal(weatherToV2(undefined).kind, 'clear');
});

for (const name of NAMES) {
  test(`${name}: part 1 leaves every local byte as it was`, async () => {
    const bytes = bytesOf(name), meta = metaOf(name);
    const { header, ent } = await peekEntities(bytes);
    assert.equal(header.stateVersion, 4);
    const before = JSON.parse(JSON.stringify(ent));
    const after = migrate(ent, 4);
    assert.equal(after.realm, null);
    delete after.realm; if (after.meta) delete after.meta.migratedFrom; if (before.meta) delete before.meta.migratedFrom;
    assert.deepEqual(after, before, 'ENTITIES unchanged but for realm and meta.migratedFrom');
    // the layers and the pristine block are not read by an ENTITIES migration; the loaded state hashes as saved
    const { payload } = await decodeAny(bytes);
    const sec = unframePayload3(payload, (header.flags & FLAG_PRISTINE) !== 0);
    assert.ok(sec.entities.length > 0);
    const s = await loadBlob(bytes);
    assert.equal(s.v, 5);
    assert.ok(!s.realm, 'a realm-less hold');
    assert.equal(stateHash(s), meta.hashAtSave, 'the v5 state hashes as the v4 build saved it');
  });
}

for (const name of NAMES) {
  test(`${name}: continues through part 1 to the sidecar, and a reload at +1 h continues identically`, async () => {
    const meta = metaOf(name), want = meta.rebaselined || meta.continue;
    const c = await continueBlob(bytesOf(name), { days2: false });
    assert.deepEqual(c.checks.errs, []);
    assert.ok(c.checks.reloadAtHourSameDayHash, 'save and reload at +1 h: same day hash');
    assert.deepEqual(c.hour.moods.map((m) => [m.id, m.mood, m.dead]), want.hour.moods.map((m) => [m.id, m.mood, m.dead]), 'moods after 1 h');
    assert.equal(c.hour.hash, want.hour.hash, 'stateHash after 1 h');
    assert.equal(c.day.hash, want.day.hash, 'stateHash after 1 day');
  });
}

// ---- Part 2 (W3.6, 9.4): a world around the old hold --------------------------------------------------------
// The checks of 9.4 on the 3 W0 fixtures: local state untouched, the pinned region fits, the roles bound with
// goodwill unchanged, a pure function of the save, determinism over 2 game days across a save and reload, and
// moods within 5 of the W0 sidecar after 1 game hour. (The 60-day bot row needs colonybot --fixture=, W3.10.)
import { holdProfile, worldParams, needsWorld, migrateHold, settleWorld, chartWorld, CHRON_WORLD } from '../../js/game/core/migrate5.js';
import { installSim } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { saveBlob } from '../../js/game/save/colonysave.js';
import { pristineOf } from '../../js/game/save/pristine.js';
import { LAYERS } from '../../js/game/core/grid.js';
import { entitiesJSON, checkState, valueHash } from '../../js/game/core/state.js';
import { regionOpts } from '../../js/game/realm/region.js';
import { realmHash, buildRealm, PIN } from '../../js/game/realm/gen.js';
import { idx as ridx, isEmbarkable, riverClass, siteOf } from '../../js/game/realm/query.js';
import { decodeRecord, encodeRecord } from '../../js/game/realm/record.js';
import { ROLE_IDS } from '../../js/game/colony/factions.js';

const HOUR = 600, DAY = 14400;
installSim({ stage: '2' });
const layerHashes = (s) => LAYERS.map((l) => valueHash(s.L[l.name]));
const entNoRealm = (s) => { const o = JSON.parse(entitiesJSON(s)); delete o.realm; o.chron = o.chron.filter((e) => e[2] !== CHRON_WORLD); return JSON.stringify(o); };
const migrated = new Map();
async function migratedOf(name) {
  if (!migrated.has(name)) {
    const s = await loadBlob(bytesOf(name));
    const before = { L: layerHashes(s), ent: entNoRealm(s), pcrc: pristineOf(s).crc.slice(), fac: { ...s.colony.factions }, prof: holdProfile(s) };
    let frames = 0;
    const out = await migrateHold(s, { frame: async () => { frames++; }, budgetMs: 0 });
    migrated.set(name, { s, before, frames, ...out });
  }
  return migrated.get(name);
}

test('part 2 is gated: needsWorld only with HISTORY on, for a deep hold with no world that has not fallen', async () => {
  const s = await loadBlob(bytesOf(NAMES[0]));
  assert.equal(needsWorld(s), FLAGS.HISTORY === true, 'the flag gates the entry point (legacy-hash rule until W3.10)');
  assert.equal(needsWorld(s, { on: true }), true);
  assert.equal(needsWorld({ ...s, realm: { wid: 1 } }, { on: true }), false);
  assert.equal(needsWorld({ ...s, colony: { ...s.colony, fallen: true } }, { on: true }), false);
  assert.equal(needsWorld({ ...s, d: 1 }, { on: true }), false);
  const p = worldParams(s);
  assert.deepEqual([p.size, p.history, p.peoples, p.wildness, p.hollowing], ['standard', 250, 'normal', 'normal', 'normal']);
});

for (const name of NAMES) {
  test(`${name}: part 2 leaves the local state untouched and pins a fitting region`, async () => {
    const { s, before, realm, field, frames } = await migratedOf(name);
    assert.ok(frames > 5, 'charted in steps (one per frame)');
    // local state untouched: every layer, the pristine CRCs and every entity (only s.realm and one Chronicle row are new)
    assert.deepEqual(layerHashes(s), before.L, 'every L layer');
    assert.deepEqual(pristineOf(s).crc, before.pcrc, 'the pristine CRCs');
    assert.equal(entNoRealm(s), before.ent, 'every entity and record but realm and the Chronicle line');
    assert.equal(s.chron.filter((e) => e[2] === CHRON_WORLD).length, 1, 'the Annals line');
    assert.deepEqual(checkState(s), []);
    // the profile the generator drew (all 3 fixtures are seed 3: massif west, a river, a lake)
    assert.deepEqual(before.prof, { side: 'w', river: true, lake: true, aquiferPct: 49, biome: 'greenvale' });
    // the pinned region fits
    const { rx, ry } = realm.pin, i = ridx(realm, rx, ry), o = regionOpts(realm, rx, ry);
    assert.ok(isEmbarkable(realm, i), 'embarkable');
    assert.equal(o.biome, 'greenvale');
    assert.equal(riverClass(realm, i) > 0, before.prof.river, 'its river flag is the hold\'s');
    assert.equal(o.side, before.prof.side, 'its massif side is the hold\'s');
    assert.equal(o.lake, before.prof.lake);
    assert.ok(Math.max(Math.abs(rx - 31), Math.abs(ry - 31)) <= PIN.radius, 'within 12 regions of the centre');
    assert.equal(siteOf(realm, rx, ry), null, 'settled and empty: no site stands there');
    const human = realm.tables.sites.some((x) => x.razed === null && x.civ !== null && realm.tables.civs[x.civ].fell === null
      && realm.tables.civs[x.civ].people === 'human' && Math.max(Math.abs(x.x - rx), Math.abs(x.y - ry)) <= PIN.humanReach);
    assert.ok(human, 'a human civ within 8 regions');
    assert.deepEqual(realm.warnings, []);
    // the field: years, liege, embark for display, the weather of today
    assert.equal(field.rx, rx); assert.equal(field.ry, ry);
    assert.equal(field.embarkYear, realm.years); assert.equal(field.embarkYear, 250);
    assert.equal(field.year, 250 + Math.floor(s.tick / (DAY * 40)));
    assert.equal(field.embark.climate, null, 'the greenvale row: today\'s climate');
    assert.equal(field.embark.edges.raid.w, 0, 'the massif side is rock');
    // roles bound, goodwill unchanged
    for (const r of ROLE_IDS) assert.ok(Number.isInteger(field.bind[r]), `role ${r} bound`);
    assert.equal(new Set(ROLE_IDS.map((r) => field.bind[r])).size, 5, 'one civ per role');
    assert.equal(field.civ, field.bind.hearthwatch, 'the liege');
    assert.equal(realm.tables.civs[field.civ].people, 'human');
    assert.deepEqual(s.colony.factions, before.fac, 'goodwill unchanged');
    // the record round-trips and its CRCs are the field's
    const back = await decodeRecord(await encodeRecord(realm));
    assert.equal(realmHash(back), realmHash(realm));
  });
}

test('part 2 is a pure function of the save; a pinned world has its own id; unpinned worlds are unchanged', async () => {
  const a = await migratedOf(NAMES[0]);
  const s2 = await loadBlob(bytesOf(NAMES[0]));
  const it = chartWorld(s2); let r; do r = it.next(); while (!r.done);
  assert.equal(realmHash(r.value), realmHash(a.realm), 'the same blob charts the same world');
  assert.deepEqual(r.value.pin, a.realm.pin);
  const plain = buildRealm({ seed: a.realm.seed }, { history: false });
  assert.notEqual(plain.wid, a.realm.wid);
  assert.equal(plain.params.pin, undefined, 'no pin key without a pin');
});

test('v4-z3-day120 migrated: 2 game days continue identically across a save and reload; moods within 5 of W0 after 1 h', async () => {
  const meta = metaOf(NAMES[0]), want = meta.rebaselined || meta.continue;
  const run = async (reload) => {
    const s = await loadBlob(bytesOf(NAMES[0]));
    const { realm } = await migrateHold(s);
    const t0 = s.tick;
    while (s.tick < t0 + HOUR) tick(s);
    const moods = s.col.map((c) => [c.id, c.mood]);
    let t = s;
    while (t.tick < t0 + DAY) tick(t);
    if (reload) { t = await loadBlob(await saveBlob(t)); t.rt.realm = realm; }   // 9.3 step 5: the loader gives rt.realm back
    while (t.tick < t0 + 2 * DAY) tick(t);
    return { moods, hash: stateHash(t), errs: checkState(t), bind: t.realm.bind };
  };
  const a = await run(false), b = await run(true);
  assert.deepEqual(a.errs, []);
  assert.equal(a.hash, b.hash, 'save and reload after 1 day: the same hash after 2 days');
  const w0 = new Map(want.hour.moods.map((m) => [m.id, m.mood]));
  for (const [id, mood] of a.moods) assert.ok(Math.abs(mood - w0.get(id)) <= 5, `colonist ${id}: mood ${mood} vs W0 ${w0.get(id)}`);
});
