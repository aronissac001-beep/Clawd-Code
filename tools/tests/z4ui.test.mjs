// Stage Z4 UI track: the "No bed for the sick" alert, the section view cut, the depth and season ambience.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idx } from '../../js/game/core/grid.js';
import { stubFortress, digFortress } from './fortress-stub.mjs';
import { ALERT_RULES } from '../../js/ui/alerts.js';
import { sectionImage, sectionColour } from '../../js/engine/render/section.js';
import { ambienceBand, ambienceParams, AMBIENCE_KINDS } from '../../js/engine/audio/ambience.js';
import { bandOfRel } from '../../js/data/levels.js';

const rule = (id) => ALERT_RULES.find((r) => r.id === id);

test('no bed for the sick: an infected or tainted colonist resting on the ground', () => {
  const s = digFortress(stubFortress(7));
  const nobed = rule('nobed');
  assert.ok(nobed, 'the rule exists');
  assert.equal(nobed.test(s), null, 'nobody resting on the ground');
  const c = s.col[0];
  c.job = { type: 'bedrest', ground: 1, bed: -1, toils: [{ t: 'bedrest' }], i: 0 };
  assert.equal(nobed.test(s), null, 'resting on the ground but not sick');
  c.hp.taint = 5000;
  const a = nobed.test(s);
  assert.ok(a && /No bed for the sick/.test(a.text));
  assert.deepEqual(a.target, { colonist: c.id }, 'the tap goes to them');
  c.job = { type: 'bedrest', bed: 3, toils: [{ t: 'bedrest' }], i: 0 };
  assert.equal(nobed.test(s), null, 'in a bed: no alert');
});

test('the section cut: one row per level, known rock coloured, unknown voxels in the band tint', () => {
  const s = digFortress(stubFortress(7));
  const img = sectionImage(s, 'x', 60, 2, 16);
  assert.equal(img.n, 128); assert.equal(img.rows, 15); assert.equal(img.data.length, 128 * 15 * 4);
  // the stair shaft at (60, 60) is dug down to z 0 and known: its colour is the stair gold, not a void tint
  const z = 11, i = idx(60, 60, z);
  const want = sectionColour(s, i), o = ((16 - z) * 128 + 60) * 4;
  assert.deepEqual([img.data[o], img.data[o + 1], img.data[o + 2]], want);
  const a = sectionImage(s, 'y', 60, 2, 16), b = sectionImage(s, 'y', 60, 2, 16);
  assert.deepEqual(a.data, b.data, 'pure: the same cut twice');
  const far = idx(2, 60, 3);   // deep rock nobody has seen
  s.L.known[far >> 3] &= ~(1 << (far & 7)); s.L.fog[far >> 3] &= ~(1 << (far & 7));
  assert.notDeepEqual(sectionColour(s, far), want, 'an unseen voxel shows the band tint, not what is there');
});

test('ambience: five depth kinds, and seasons change the surface and the stone', () => {
  assert.equal(ambienceBand(2, bandOfRel(2)), 'surface');
  assert.equal(ambienceBand(0, bandOfRel(0)), 'surface');
  assert.equal(ambienceBand(-1, bandOfRel(-1)), 'soil');
  assert.equal(ambienceBand(-4, bandOfRel(-4)), 'stone');
  assert.equal(ambienceBand(-6, bandOfRel(-6)), 'caverns');
  assert.equal(ambienceBand(-12, bandOfRel(-12)), 'ember');
  for (const k of AMBIENCE_KINDS) for (let se = 0; se < 4; se++) { const p = ambienceParams(k, se); assert.equal(p.kind, k); assert.ok(p.nGain > 0 && p.evPerMin > 0); }
  assert.notEqual(ambienceParams('surface', 3).ev, ambienceParams('surface', 0).ev, 'Deepcold wind, not birds');
  assert.ok(ambienceParams('stone', 0).evPerMin > ambienceParams('stone', 3).evPerMin, 'Thaw drips more than Deepcold');
});
