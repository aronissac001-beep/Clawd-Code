import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../js/game/core/time.js';
test('calendar (2.2)', () => {
  assert.equal(T.TICKS_PER_DAY, 14400); assert.equal(T.hourOf(600 * 13), 13);
  assert.equal(T.dayOf(14400 * 3 + 5), 3); assert.equal(T.seasonOf(14400 * 10), 1); assert.equal(T.yearOf(14400 * 40), 1);
  assert.equal(T.phaseOf(600 * 12), 'day'); assert.equal(T.phaseOf(600 * 22), 'night'); assert.equal(T.phaseOf(600 * 5), 'dawn'); assert.equal(T.phaseOf(600 * 20), 'dusk');
  const winter = 14400 * 30; assert.equal(T.phaseOf(winter + 600 * 20), 'night'); assert.equal(T.phaseOf(winter + 600 * 5), 'night');
  assert.equal(T.dateText(14400 * 24), 'Year 1, Ashfall day 5'); assert.equal(T.clockText(600 * 7 + 50), '07:05');
});
