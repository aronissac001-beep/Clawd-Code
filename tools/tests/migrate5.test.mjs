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
