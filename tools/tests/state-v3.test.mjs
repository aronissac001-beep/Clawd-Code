// State v3: the Stage 2.9 migration v2 -> v3 (EMBERCROWN-FORTRESS.md 5.3; step S9.7, owner A).
//   1. iron: true (and the old 'ironhold' id) becomes difficulty 'hard'; colony.iron is gone
//   2. a pending perk choice is settled to exactly one perk of the pair (the nearer deed), with a Chronicle line
//   3. Colonist.done exists at zero (u16 counters, no back-fill)
//   4. lordsDone, charters and the test-only spec fields (Building.spec) are dropped
//   5. colony.fallen = false
// Fixture test (5.3): v2-s2-iron loads, migrates, continues 2 days, saves, reloads and continues to an identical hash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate, migrations, stateHash, checkState } from '../../js/game/core/state.js';
import { STATE_VERSION, FIELDS, newColonyRecord, SKILL_IDS } from '../../js/game/core/schema.js';
import { DONE_LEN } from '../../js/data/deeds-col.js';
import { installSim } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { loadBlob, saveBlob } from '../../js/game/save/colonysave.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';

const FIX = (n) => new Uint8Array(readFileSync(new URL(`../fixtures/${n}`, import.meta.url)));
const SIDE = (n) => JSON.parse(readFileSync(new URL(`../fixtures/${n}`, import.meta.url), 'utf8'));
const step = (s, n) => { for (let k = 0; k < n && s.colony.fallen !== true; k++) tick(s); };

test('state version 3: two ordered migrations; the colony record has no iron, lordsDone or charters and an explicit fallen', () => {
  assert.equal(STATE_VERSION, 3);
  assert.equal(migrations.length, STATE_VERSION - 1);
  const c = newColonyRecord();
  for (const k of ['iron', 'lordsDone', 'charters']) assert.ok(!(k in c), `no colony.${k}`);
  assert.equal(c.fallen, false);
  const done = FIELDS.col.find((f) => f.name === 'done');
  assert.ok(done, 'Colonist.done is a schema field');
  assert.equal(done.type, `u16:${DONE_LEN}`);
  assert.equal(FIELDS.col[FIELDS.col.length - 1].name, 'done', 'appended last (positional rows only append)');
  assert.ok(!FIELDS.bld.some((f) => f.name === 'spec'), 'no Building.spec');
});

test('v2 -> v3 on a synthetic ENTITIES object: Hard, dropped keys and column, explicit fall, a settled perk', () => {
  const colNames = FIELDS.col.filter((f) => f.name !== 'done').map((f) => f.name);
  const bldNames = ['id', 'def', 'x', 'y', 'rot', 'mat', 'q', 'hp', 'st', 'need', 'got', 'work', 'lvl', 'spec', 'owner', 'fuel', 'bills', 'link', 'name', 'maker', 'dcon'];
  const sk = SKILL_IDS.map(() => [0, 0, 0, 0]);
  sk[SKILL_IDS.indexOf('construction')][0] = 10;
  const colRow = colNames.map((n) => (n === 'id' ? 4 : n === 'name' ? 'Bryn Ashdown' : n === 'sk' ? sk : n === 'perks' ? [] : null));
  const wall = bldNames.map((n) => (n === 'id' ? 0 : n === 'def' ? 'wall_stone' : n === 'spec' ? ['joiner'] : n === 'maker' ? 4 : n === 'st' ? 'done' : 0));
  const ent = {
    fl: { col: colNames.slice(), bld: bldNames.slice() },
    meta: { v: 2, tick: 5000 },
    colony: { difficulty: 'ironhold', iron: true, lordsDone: ['gloomwyrm'], charters: ['forgehold'], tier: 1 },
    col: [colRow], bld: [wall], chron: [],
  };
  const out = migrate(ent, 2);
  assert.equal(out.colony.difficulty, 'hard');
  for (const k of ['iron', 'lordsDone', 'charters']) assert.ok(!(k in out.colony), `colony.${k} dropped`);
  assert.equal(out.colony.fallen, false);
  assert.equal(out.colony.tier, 1, 'the rest is kept');
  assert.ok(!out.fl.bld.includes('spec'), 'the spec column is gone from the field list');
  assert.equal(out.bld[0].length, bldNames.length - 1, 'and from the row');
  assert.equal(out.bld[0][out.fl.bld.indexOf('maker')], 4, 'later columns keep their values');
  const perks = out.col[0][colNames.indexOf('perks')];
  assert.equal(perks.length, 1, 'exactly one perk of the pair');
  assert.ok(['quick_shoring', 'salvager'].includes(perks[0]));
  const line = out.chron[out.chron.length - 1];
  assert.deepEqual([line[0], line[1], line[2], line[3].name, line[3].colId], [5000, 'perk', 'chron_perk_settled', 'Bryn', 4]);
  // a colonist with no open choice, and a non-iron colony, are left alone
  const plain = migrate({ meta: { v: 2 }, colony: { difficulty: 'warden', iron: false }, col: [], chron: [] }, 2);
  assert.equal(plain.colony.difficulty, 'warden');
  assert.deepEqual(plain.chron, []);
  // a fallen v2 hold stays fallen
  assert.equal(migrate({ meta: { v: 2 }, colony: { fallen: true, fallenAt: 9 } }, 2).colony.fallen, true);
});

test('v2-s2-iron migrates: Hard, no iron, the pending choice settled to exactly one perk with a Chronicle line, zero deed counters', async () => {
  installSim({ stage: '2', reset: true });
  const meta = SIDE('v2-s2-iron.json');
  const s = await loadBlob(FIX('v2-s2-iron.ecsave'));
  assert.deepEqual(checkState(s), []);
  assert.equal(s.v, 3);
  assert.equal(s.colony.difficulty, 'hard');
  assert.ok(!('iron' in s.colony) && !('lordsDone' in s.colony) && !('charters' in s.colony));
  assert.equal(s.colony.fallen, false);
  const col = s.col.find((c) => c.id === meta.at.col);
  const held = meta.at.choices[0].options.filter((p) => col.perks.includes(p));
  assert.equal(held.length, 1, `${col.name} holds exactly one of ${meta.at.choices[0].options}`);
  assert.ok(s.chron.some((e) => e[2] === 'chron_perk_settled' && e[3].colId === col.id), 'the Chronicle says so');
  for (const c of s.col) { assert.ok(c.done instanceof Uint16Array && c.done.length === DONE_LEN); assert.ok(c.done.every((v) => v === 0), 'no back-fill'); }
});

test('v2-s2-iron: load, migrate, continue 2 days, save, reload, continue to an identical hash (5.3)', async () => {
  installSim({ stage: '2', reset: true });
  const s = await loadBlob(FIX('v2-s2-iron.ecsave'));
  step(s, 2 * TICKS_PER_DAY);
  const bytes = await saveBlob(s);
  const r = await loadBlob(bytes);
  assert.equal(stateHash(r), stateHash(s), 'the reload hashes as saved');
  step(s, 6 * TICKS_PER_HOUR); step(r, 6 * TICKS_PER_HOUR);
  assert.equal(stateHash(r), stateHash(s), 'and continues identically');
  assert.deepEqual(checkState(r), []);
  assert.ok(s.col.some((c) => c.done.some((v) => v > 0)), 'deeds are being counted');
});

test('every v2 fixture and the v1 fixture reach state v3 with the v3 shape', async () => {
  installSim({ stage: '2', reset: true });
  for (const n of ['v1-1b-midraid.ecsave', 'v2-s2-day60.ecsave', 'v2-s2-midraid.ecsave']) {
    const s = await loadBlob(FIX(n));
    assert.deepEqual(checkState(s), [], n);
    assert.equal(s.v, 3, n);
    assert.ok(!('iron' in s.colony) && s.colony.fallen === false, n);
    assert.ok(s.bld.every((b) => b === null || !('spec' in b)), `${n}: no Building.spec`);
  }
});
