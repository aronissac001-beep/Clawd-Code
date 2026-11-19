// Stage 2 gap fixes before Stage 3 (FIX): one test per rule changed.
// - worn armour takes its share off a blow to a part it covers (6.6); fire and the taint pass through
// - a stack is offered to anyone with Haul enabled once it waited URGENT_H (8) hours
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { damage, armourPct, ARMOUR, PART } from '../../js/game/people/health.js';
import { STALE_H, URGENT_H } from '../../js/game/work/haul.js';

function colony(seed = 'FIX-3') {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'Fix Hold' });
}
const wear = (c, slots) => { c.gear = { slots, outfit: 'any' }; };

test('armour covers parts by slot, scales with quality and is capped', () => {
  const s = colony();
  const c = s.col[0];
  wear(c, {});
  assert.equal(armourPct(c, PART.head), 0);
  wear(c, { head: { k: 'ironhelm', q: 1, n: 1 }, body: { k: 'jerkin', q: 1, n: 1 } });
  assert.equal(armourPct(c, PART.head), 18);
  assert.equal(armourPct(c, PART.torso), 10);
  assert.equal(armourPct(c, PART.lleg), 0);
  // a Legendary helm (x1.5) and a shield (half its value on every part)
  wear(c, { head: { k: 'ironhelm', q: 5, n: 1 }, hands: { k: 'woodshield', q: 1, n: 1 } });
  assert.equal(armourPct(c, PART.head), 27 + 5);
  assert.equal(armourPct(c, PART.rleg), 5);
  wear(c, { body: { k: 'gambeson', q: 5, n: 1 }, outer: { k: 'mailshirt', q: 5, n: 1 }, hands: { k: 'towershield', q: 5, n: 1 } });
  assert.equal(armourPct(c, PART.torso), ARMOUR.maxPct);
});

test('a blow to an armoured part loses the armour share; a burn does not', () => {
  const s = colony();
  const [a, b] = s.col;
  wear(a, {});
  wear(b, { body: { k: 'gambeson', q: 1, n: 1 }, outer: { k: 'mailshirt', q: 1, n: 1 } });   // torso 14 + 28 = 42%
  damage(s, a, PART.torso, 'cut', 10);
  damage(s, b, PART.torso, 'cut', 10);
  assert.equal(a.hp.wounds[0].dmg, 10);
  assert.equal(b.hp.wounds[0].dmg, 5);
  assert.ok(b.hp.wounds[0].bleed < a.hp.wounds[0].bleed, 'less damage, less bleeding');
  damage(s, b, PART.torso, 'burn', 10);
  assert.equal(b.hp.wounds[1].dmg, 10);
});

test('stale and urgent hauls come after 4 and 8 hours', () => {
  assert.equal(STALE_H, 4);
  assert.equal(URGENT_H, 8);
});
