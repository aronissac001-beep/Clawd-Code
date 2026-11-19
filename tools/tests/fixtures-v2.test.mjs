// The Stage 2 save fixtures (EMBERCROWN-FORTRESS.md 8.2 step S9.0; owner J). Each tools/fixtures/v2-s2-*.ecsave
// is a real save made by build 078cb71 (tools/capture-fixture.mjs), and its .json sidecar records what that
// build did next: the stateHash after 1 game day of continuation and every colonist's mood after 1 game hour.
// This tree must load each one (through the state migrations), continue identically after a save and reload,
// and reproduce the sidecar exactly.
//
// A later step that changes behaviour on purpose (Stage 2.9 removals, the v2 to v3 migration) re-baselines a
// fixture with `node tools/capture-fixture.mjs --root=. --rebaseline --out=<fixture>` (the `rebaselined`
// block; the original `continue` block from 078cb71 is never rewritten). Then the day hash and the moods
// must equal the re-baseline exactly, and every mood must stay within 5 points of the 078cb71 value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { continueBlob, HOUR, DAY } from '../capture-fixture.mjs';
import { readHeader } from '../../js/game/save/codec.js';
import { loadBlob } from '../../js/game/save/colonysave.js';
import { installSim } from '../../js/game/core/setup.js';
import { STATE_VERSION } from '../../js/game/core/schema.js';

const FIX = new URL('../fixtures/', import.meta.url);
const NAMES = readdirSync(FIX).filter((f) => /^v2-s2-.*\.ecsave$/.test(f)).sort();
const MOOD_DRIFT = 5 * 100;   // 5 mood points (mood is fixed-point x100, schema.js FIX)

test('the three Stage 2 fixtures are present (S9.0: day60, midraid, iron)', () => {
  for (const n of ['v2-s2-day60.ecsave', 'v2-s2-midraid.ecsave', 'v2-s2-iron.ecsave']) assert.ok(NAMES.includes(n), `${n} missing`);
});

for (const name of NAMES) {
  const bytes = new Uint8Array(readFileSync(new URL(name, FIX)));
  const meta = JSON.parse(readFileSync(new URL(name.replace(/\.ecsave$/, '.json'), FIX), 'utf8'));
  const want = meta.rebaselined || meta.continue;

  test(`${name}: header and sidecar agree (made by ${meta.commit})`, () => {
    const { header } = readHeader(bytes);
    assert.equal(bytes.length, meta.bytes);
    assert.equal(header.stateVersion, meta.stateVersion);
    assert.equal(header.formatVersion, meta.formatVersion);
    assert.equal(header.tick, meta.tick);
    assert.equal(meta.stateVersion, 2, 'a Stage 2 fixture is state version 2');
    assert.ok(meta.continue.checks.reloadAtHourSameDayHash && meta.continue.checks.stateValidAtDay, 'the capturing build itself continued identically');
  });

  test(`${name}: loads, continues 1 day identically after a save and reload, and matches ${meta.rebaselined ? `the re-baseline (${meta.rebaselined.commit})` : meta.commit}`, async () => {
    const c = await continueBlob(bytes);
    assert.deepEqual(c.checks.errs, [], 'state valid after a day');
    assert.ok(c.checks.stateValidAtDay);
    assert.ok(c.checks.reloadAtHourSameDayHash, 'a save and reload at +1 h continues to the same day hash');
    assert.equal(c.tick, meta.tick);
    assert.equal(c.hour.tick, meta.tick + HOUR);
    assert.equal(c.day.tick, meta.tick + DAY);
    if (!meta.rebaselined) assert.equal(c.hashAtLoad, meta.hashAtSave, 'the loaded state hashes as the old build saved it');
    assert.deepEqual(c.hour.moods.map((m) => [m.id, m.name]), want.hour.moods.map((m) => [m.id, m.name]), 'the same colonists');
    for (let k = 0; k < c.hour.moods.length; k++) {
      const m = c.hour.moods[k];
      assert.equal(m.mood, want.hour.moods[k].mood, `${m.name}: mood after 1 h`);
      assert.equal(m.dead, want.hour.moods[k].dead, `${m.name}: dead after 1 h`);
      if (meta.rebaselined) assert.ok(Math.abs(m.mood - meta.continue.hour.moods[k].mood) <= MOOD_DRIFT, `${m.name}: mood within 5 of ${meta.commit}`);
    }
    assert.equal(c.hour.hash, want.hour.hash, 'stateHash after 1 h');
    assert.equal(c.day.hash, want.day.hash, 'stateHash after 1 day');
  });
}

test('v2-s2-iron: an Ironhold colony with one untaken perk choice', async () => {
  const meta = JSON.parse(readFileSync(new URL('v2-s2-iron.json', FIX), 'utf8'));
  assert.equal(meta.colony.difficulty, 'ironhold');
  assert.equal(meta.colony.iron, true);
  assert.equal(meta.at.choices.length, 1);
  installSim({ stage: '2' });
  const s = await loadBlob(new Uint8Array(readFileSync(new URL('v2-s2-iron.ecsave', FIX))));
  const col = s.col.find((c) => c.id === meta.at.col);
  assert.ok(col, `colonist ${meta.at.colName}`);
  const held = meta.at.choices[0].options.filter((p) => col.perks.includes(p));
  // state v2: the choice is still open; from the Stage 2.9 migration (state v3, 5.3 step 2) it is resolved
  if (STATE_VERSION <= 2) assert.equal(held.length, 0, 'the choice is still pending');
  else assert.equal(held.length, 1, 'the migration resolved the pending choice to exactly one perk');
});

test('v2-s2-midraid: a live reaver raid with a reaver in melee', () => {
  const meta = JSON.parse(readFileSync(new URL('v2-s2-midraid.json', FIX), 'utf8'));
  assert.ok(meta.raids.some((r) => r.startsWith('reaver_raid:')), meta.raids.join(','));
  assert.ok(meta.reavers > 0 && meta.at.meleeTicks >= 30);
});
