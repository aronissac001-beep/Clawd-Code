// tools/tests/art-keys.test.mjs (owner J; written by D). Headless checks of D's art kit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const ROOT = new URL('../../', import.meta.url).href;
const K = await import(ROOT + 'js/engine/art/keys.js');
const I = await import(ROOT + 'js/engine/art/index.js');
const P = await import(ROOT + 'js/engine/art/people.js');
const { CONTENT } = await import(ROOT + 'js/data/index.js');

test('every art / icon / look key named by the data resolves', () => {
  const bad = [];
  for (const k of CONTENT.kinds()) for (const d of CONTENT.all(k)) for (const f of ['art', 'icon', 'look']) if (typeof d[f] === 'string' && !K.hasArtKey(d[f])) bad.push(`${k}:${d.id}.${f}=${d[f]}`);
  assert.deepEqual(bad, []);
});
test('every kit part has a drawer', () => assert.deepEqual(I.missingParts(), []));
test('every slice structure def gets a renderer entry, plus the three tile painters', () => {
  const keys = [], tiles = [];
  I.installKit((k) => keys.push(k), (k) => tiles.push(k));
  for (const d of CONTENT.all('structure')) if (d.stage === '1a' && K.artMeta(d.art).kind !== 'zone') assert.ok(keys.includes(d.art), d.id);
  assert.deepEqual(tiles.sort(), ['floor', 'rock', 'rough']);
});
test('colonist sprite keys are distinct integers for every human look', () => {
  const seen = new Set();
  for (let skin = 0; skin < 6; skin++) for (let hair = 0; hair < 4; hair++) for (let hairC = 0; hairC < 6; hairC++) for (let beard = 0; beard < 5; beard++) for (let cloth = 0; cloth < 6; cloth++) {
    const k = P.colonistKey('human', { skin, hair, hairC, beard, cloth }, 0, false, '', '');
    assert.equal(typeof k, 'number'); assert.ok(!seen.has(k)); seen.add(k);
  }
  assert.equal(seen.size, 6 * 4 * 6 * 5 * 6);
});
test('floor layer ids map to the floor art keys in data order', () => {
  assert.equal(I.floorKeyOf(1), 'struct.f_planks');
  assert.equal(I.floorKeyOf(2), 'struct.f_flag');
  assert.equal(I.floorKeyOf(0), null);
});
