// The W0 save fixtures (EMBERCROWN-WORLD.md 12.2 step W0.1; owner J). Each tools/fixtures/v4-z3-*.ecsave is a real
// state v4 save of a 128 x 128 x 20 hold made by colony bot v4 with every Z3 system on (tools/capture-fixture.mjs
// --bot=v4), on the commit its .json sidecar names; the sidecar records what that build did next: the stateHash after
// 1 game hour (and every colonist's mood), 1 game day and 2 game days of continuation with no commands.
//   v4-z3-day120  bot seed 3 at the end of game day 120
//   v4-z3-flood   a flood in progress (the fluid active set at least 8 for 30 ticks running)
//   v4-z3-beast   a great beast loose (a great beast on the map for 30 ticks running)
// This tree must load each one, continue identically after a save and reload, and reproduce the sidecar exactly.
// A step that changes behaviour on purpose re-baselines with `node tools/capture-fixture.mjs --root=. --rebaseline
// --out=<fixture>` (the `rebaselined` block; the original `continue` block is never rewritten) and says so; the
// legacy-hash rule (12.1) allows that only to W0.5 (hauling, before the W0 baseline), W4.8, W5.1 and W5.9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { continueBlob, HOUR, DAY } from '../capture-fixture.mjs';
import { readAnyHeader } from '../../js/game/save/codec.js';
import { loadBlob } from '../../js/game/save/colonysave.js';
import { installSim } from '../../js/game/core/setup.js';
import { activeCount } from '../../js/game/world/fluids.js';
import { W, H } from '../../js/game/core/grid.js';

const FIX = new URL('../fixtures/', import.meta.url);
const NAMES = ['v4-z3-day120', 'v4-z3-flood', 'v4-z3-beast'];
const bytesOf = (n) => new Uint8Array(readFileSync(new URL(`${n}.ecsave`, FIX)));
const metaOf = (n) => JSON.parse(readFileSync(new URL(`${n}.json`, FIX), 'utf8'));

test('the three W0 fixtures and their sidecars are present (W0.1: day120, flood, beast)', () => {
  for (const n of NAMES) {
    assert.ok(existsSync(new URL(`${n}.ecsave`, FIX)), `${n}.ecsave missing`);
    assert.ok(existsSync(new URL(`${n}.json`, FIX)), `${n}.json missing`);
  }
});

for (const name of NAMES) {
  const bytes = bytesOf(name), meta = metaOf(name);
  const want = meta.rebaselined || meta.continue;

  test(`${name}: header and sidecar agree (made by ${meta.commit})`, () => {
    const { header } = readAnyHeader(bytes);
    assert.equal(bytes.length, meta.bytes);
    assert.equal(header.stateVersion, meta.stateVersion);
    assert.equal(header.formatVersion, meta.formatVersion);
    assert.equal(header.tick, meta.tick);
    assert.equal(meta.stateVersion, 4, 'a W0 fixture is state version 4');
    assert.equal(meta.bot, 'v4');
    assert.equal(meta.dirty, false, 'made from a clean tree');
    assert.deepEqual([meta.fortress.w, meta.fortress.d], [128, 20], 'a 128 x 128 x 20 hold');
    const c = meta.continue.checks;
    assert.ok(c.reloadAtHourSameDayHash && c.reloadAtHourSameDay2Hash && c.stateValidAtDay, 'the capturing build itself continued identically');
    assert.ok(meta.continue.day2 && want.day2, 'the sidecar records the 2-day hash');
  });

  test(`${name}: loads, continues 2 days identically after a save and reload, and matches ${meta.rebaselined ? `the re-baseline (${meta.rebaselined.commit})` : meta.commit}`, async () => {
    const c = await continueBlob(bytes, { days2: true });
    assert.deepEqual(c.checks.errs, [], 'state valid after a day');
    assert.ok(c.checks.reloadAtHourSameDayHash, 'a save and reload at +1 h continues to the same day hash');
    assert.ok(c.checks.reloadAtHourSameDay2Hash, 'a save and reload at +1 h continues to the same 2-day hash');
    assert.equal(c.tick, meta.tick);
    assert.equal(c.hour.tick, meta.tick + HOUR);
    assert.equal(c.day.tick, meta.tick + DAY);
    assert.equal(c.day2.tick, meta.tick + 2 * DAY);
    if (!meta.rebaselined) assert.equal(c.hashAtLoad, meta.hashAtSave, 'the loaded state hashes as the build saved it');
    assert.deepEqual(c.hour.moods.map((m) => [m.id, m.name, m.mood, m.dead]), want.hour.moods.map((m) => [m.id, m.name, m.mood, m.dead]), 'moods after 1 h');
    assert.equal(c.hour.hash, want.hour.hash, 'stateHash after 1 h');
    assert.equal(c.day.hash, want.day.hash, 'stateHash after 1 day');
    assert.equal(c.day2.hash, want.day2.hash, 'stateHash after 2 days');
  });
}

test('v4-z3-day120: bot v4 seed 3 at the end of day 120, a living hold', () => {
  const meta = metaOf('v4-z3-day120');
  assert.equal(meta.seed, 3);
  assert.equal(meta.at.day, 120);
  assert.ok(meta.alive > 0, `${meta.alive} alive`);
});

test('v4-z3-flood: water is moving when it loads', async () => {
  const meta = metaOf('v4-z3-flood');
  assert.ok(meta.at.fluidActive >= meta.at.fluidMin && meta.at.forTicks >= 30, JSON.stringify(meta.at));
  installSim({ stage: '2' });
  const s = await loadBlob(bytesOf('v4-z3-flood'));
  assert.equal(s.L.terrain.length, W * H * 20);
  assert.equal(activeCount(s), meta.at.fluidActive, 'the fluid active set is saved');
});

test('v4-z3-beast: a great beast is on the map when it loads', async () => {
  const meta = metaOf('v4-z3-beast');
  assert.ok(meta.at.beasts.length > 0 && meta.at.forTicks >= 30, JSON.stringify(meta.at));
  installSim({ stage: '2' });
  const s = await loadBlob(bytesOf('v4-z3-beast'));
  const ids = s.foes.filter((f) => f && f.st && f.st.gb).map((f) => f.id);
  assert.deepEqual(ids, meta.at.beasts.map((b) => b.id), 'the same great beasts');
});
