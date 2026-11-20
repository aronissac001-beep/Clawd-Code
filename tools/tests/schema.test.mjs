// Schema round trip (14.5 A acceptance): factory > JSON > factory, for every entity kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../js/game/core/schema.js';

const samples = () => ({
  col: S.newColonist(7, { name: 'Bryn Ashward', x: 1234.5678, y: 99.125, job: S.newJob('mine', 4242, [['goto', 4242], ['work', 120]], { i: 1, work: 33 }), path: S.newPath([1, 2, 3, 130], 2), unreach: [[4242, 9000]], traits: ['hardworking'] }),
  items: S.newStack(3, 'stone', 'granite', 0, 10, 40, 41, { name: null }),
  bld: S.newBuilding(12, 'wall', 50, 60, 1, 'granite', { st: 'frame', need: { blocks: 2 }, bills: [S.newBill('blocks_granite')] }),
  zones: S.newZone(1, 'stockpile', { name: 'Store', filter: { cats: ['raw'], mats: [], q: [0, 6] } }),
  anim: S.newAnimal(2, 'glowbeetle', { x: 10, y: 20, tame: true }),
  foes: S.newFoe(9, 'reaver', { raid: 1, x: 300, y: 400 }),
  raids: S.newRaid(1, 'raid_small', { pts: 400, members: [9] }),
  nem: S.newNemesis(4, { name: 'Varr', epithet: 'the Scarred', grudge: 7 }),
});

test('every entity kind: defaults are schema-valid', () => {
  for (const kind of Object.keys(S.FIELDS)) assert.deepEqual(S.checkEntity(kind, S.make(kind)), [], kind);
});

test('factory > JSON > factory round trip (plain form)', () => {
  for (const [kind, e] of Object.entries(samples())) {
    assert.deepEqual(S.checkEntity(kind, e), [], kind);
    const back = S.fromPlain(kind, JSON.parse(JSON.stringify(S.toPlain(kind, e))));
    assert.deepStrictEqual(back, e, kind);
    assert.deepEqual(S.checkEntity(kind, back), [], kind);
  }
});

test('positional row form round trips too', () => {
  for (const [kind, e] of Object.entries(samples())) {
    const row = JSON.parse(JSON.stringify(S.toRow(kind, e)));
    assert.ok(Array.isArray(row));
    assert.deepStrictEqual(S.fromRow(kind, row), e, kind);
  }
});

test('typed fields come back typed', () => {
  const c = S.fromPlain('col', JSON.parse(JSON.stringify(S.toPlain('col', samples().col))));
  assert.ok(c.sched instanceof Uint8Array && c.sched.length === 24);
  assert.ok(c.prio instanceof Uint8Array && c.prio.length === S.WORK_IDS.length);
  assert.ok(c.path.tiles instanceof Uint32Array);
});

test('missing fields take defaults (forward-compatible additions); unknown init keys throw', () => {
  const c = S.fromPlain('col', { id: 1, name: 'A' });
  assert.deepEqual(S.checkEntity('col', c), []);
  assert.throws(() => S.newColonist(1, { nmae: 'typo' }), /no field nmae/);
});

test('C2-core fields exist on Colonist, Stack, Building and Zone (C2 v3: z on every positioned entity)', () => {
  const core = (kind) => S.FIELDS[kind].filter((f) => f.core).map((f) => f.name);
  assert.deepEqual(core('col'), ['id', 'name', 'bed', 'x', 'y', 'job', 'path', 'z']);
  assert.deepEqual(core('items'), ['id', 'k', 'n', 'x', 'y', 'z']);
  assert.deepEqual(core('bld'), ['id', 'def', 'x', 'y', 'rot', 'st', 'owner', 'z']);
  for (const k of ['anim', 'foes']) assert.ok(S.FIELDS[k].some((f) => f.name === 'z' && f.core && f.def === 0), k);
  assert.deepEqual(core('zones'), ['id', 'type']);
});

test('fixed orders: 15 skills, 13 work types, 5 needs, 3 attributes, 6 body parts', () => {
  assert.equal(S.SKILL_IDS.length, 15); assert.equal(S.WORK_IDS.length, 13); assert.equal(S.NEED_IDS.length, 5);
  assert.equal(S.ATTR_IDS.length, 3); assert.equal(S.PART_IDS.length, 6); assert.equal(S.PART_HP.length, 6);
  assert.deepEqual(S.RNG_STREAMS, ['main', 'story', 'gen', 'names', 'combat']);
});

test('colony and story records round trip', () => {
  const c = S.newColonyRecord(); c.techs[3] = 0b101; c.claims.push({ id: 1 });
  assert.deepStrictEqual(S.colonyFromPlain(JSON.parse(JSON.stringify(S.colonyToPlain(c)))), c);
  const st = S.newStoryRecord(); st.nemeses.push(samples().nem); st.cooldowns.raid = 3;
  assert.deepStrictEqual(S.storyFromPlain(JSON.parse(JSON.stringify(S.storyToPlain(st)))), st);
});
