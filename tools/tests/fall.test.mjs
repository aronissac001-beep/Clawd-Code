// The fall and the Ruin, and Hard instead of Ironhold (EMBERCROWN-FORTRESS.md 1.3, F8, F9; step S9.4, owner A).
// Oracle: 1.3. A colony falls when no colonist is free and able for 24 consecutive game hours ("able": not
// dead, not downed without a rescuer, not in an extreme break, not captured); then tick() is a no-op, so the
// state hash stops changing, and the fall survives a save and reload. Hard replaces Ironhold.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick, step } from '../../js/game/core/sim.js';
import { createColony, stateHash, checkState } from '../../js/game/core/state.js';
import { DIFFICULTIES, normDifficulty } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { damage } from '../../js/game/people/health.js';
import { holdsOn, isFallen, fallSummary, fallClockHours, FALL_HOURS } from '../../js/game/colony/fall.js';
import { chronLine } from '../../js/game/colony/chronicle.js';
import * as shell from '../../js/main.js';

const HOUR = TICKS_PER_HOUR;
function colony(seed = 'FALL-1') {
  installSim({ stage: '2', reset: true });
  const s = foundColony({ seed, name: 'Fall Hold', w: 64 });
  s.st.queue.length = 0;   // a quiet storyteller: no wanderer walks in to rescue anyone
  return s;
}
/** Down a colonist where they stand: frost on both arms and legs (pain 90 > 80, no bleeding, no lethal part). */
function downHard(s, c) {
  for (const p of ['lleg', 'rleg', 'larm', 'rarm']) damage(s, c, p, 'frost', 30);
  assert.ok(c.hp.down && !c.hp.dead, `${c.name} downed`);
}
/** Step to the next whole game hour (where the fall check runs), keeping the storyteller quiet. */
function toNextHour(s) { do { tick(s); s.st.queue.length = 0; } while (s.tick % HOUR !== 0 && !isFallen(s)); }

test('holdsOn: dead, downed where they fell, extreme breaks and captives do not hold on; a downed colonist in bed and a minor break do', () => {
  const s = colony();
  const c = s.col[0];
  assert.equal(holdsOn(s, c), true);
  c.breakState = { id: 'sulk', sev: 'minor', until: s.tick + HOUR }; assert.equal(holdsOn(s, c), true, 'a minor break passes');
  c.breakState = { id: 'catatonic', sev: 'extreme', until: s.tick + HOUR }; assert.equal(holdsOn(s, c), false, 'an extreme break');
  c.breakState = null;
  c.hp.down = true; assert.equal(holdsOn(s, c), false, 'downed with no rescuer');
  c.job = { type: 'bedrest', target: 0, bed: 0, toils: [{ t: 'bedrest' }], i: 0, work: 0, haul: null };
  assert.equal(holdsOn(s, c), true, 'downed but laid in a bed (rescued)');
  c.job = null; c.hp.down = false;
  c.hp.captured = true; assert.equal(holdsOn(s, c), false, 'captured'); delete c.hp.captured;
  c.hp.dead = true; assert.equal(holdsOn(s, c), false, 'dead'); c.hp.dead = false;
});

test('with all colonists downed and no rescuer for 24 h, fallen is set and the hash stops changing', () => {
  const s = colony();
  assert.ok(s.col.length >= 3);
  for (const c of s.col) downHard(s, c);
  toNextHour(s);
  const t0 = s.tick;
  assert.equal(s.colony.fallSince, t0, 'the fall clock starts at the first hourly check with no one standing');
  for (let h = 1; h < FALL_HOURS; h++) {
    toNextHour(s);
    assert.equal(isFallen(s), false, `not fallen after ${h} h`);
    assert.equal(fallClockHours(s), h);
    for (const c of s.col) assert.ok(!holdsOn(s, c), `${c.name} still down at ${h} h`);
  }
  toNextHour(s);
  assert.equal(isFallen(s), true, 'fallen after 24 consecutive hours');
  assert.equal(s.colony.fallenAt, t0 + FALL_HOURS * HOUR);
  assert.equal(s.tick, s.colony.fallenAt);
  assert.ok(!('fallSince' in s.colony));
  const line = s.chron[s.chron.length - 1];
  assert.deepEqual([line[1], line[2]], ['fallen', 'chron_fell']);
  assert.ok(chronLine(line).length > 0);
  assert.deepEqual(checkState(s), []);
  // the sim stops: tick() is a no-op, the hash never changes again
  const h = stateHash(s), tk = s.tick;
  step(s, 3 * HOUR);
  assert.equal(s.tick, tk);
  assert.equal(stateHash(s), h);
  // and the fall survives a save and reload
  const t = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(t), h);
  assert.equal(isFallen(t), true);
  step(t, HOUR);
  assert.equal(stateHash(t), h);
});

test('one colonist free and able holds the hold; standing up again resets the 24 hours (they must be consecutive)', () => {
  const s = colony('FALL-2');
  const [keep, ...rest] = s.col;
  for (const c of rest) downHard(s, c);
  for (let h = 0; h < 30; h++) toNextHour(s);
  assert.equal(isFallen(s), false);
  assert.ok(!('fallSince' in s.colony), 'no fall clock while someone stands');
  assert.ok(holdsOn(s, keep));
  // (the one standing carried the others to bed meanwhile: a downed colonist in a bed is rescued and holds on)
  // now everyone is down where they lie, out of bed, for 12 hours; then one gets up
  const u = colony('FALL-2b');
  for (const c of u.col) downHard(u, c);
  for (let h = 0; h < 12; h++) toNextHour(u);
  fallAgain(u, u.col[0]);
});
function fallAgain(s, keep) {
  assert.ok('fallSince' in s.colony);
  assert.equal(fallClockHours(s), 11);
  keep.hp.wounds = []; keep.hp.parts = keep.hp.parts.map(() => 20); keep.hp.down = false;
  toNextHour(s);
  assert.ok(!('fallSince' in s.colony), 'the clock is gone once someone stands');
  downHard(s, keep);
  for (let h = 0; h < FALL_HOURS; h++) { toNextHour(s); assert.equal(isFallen(s), false, `a fresh 24 hours: not fallen at ${h + 1}`); }
  toNextHour(s);
  assert.equal(isFallen(s), true);
}

test('determinism: a save in the middle of the fall clock continues to the same fall tick and hash', () => {
  const s = colony('FALL-3');
  for (const c of s.col) downHard(s, c);
  for (let h = 0; h < 10; h++) toNextHour(s);
  step(s, 137);
  const t = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(t), stateHash(s));
  for (const x of [s, t]) { let n = 0; while (!isFallen(x) && n++ < 40 * HOUR) tick(x); }
  assert.equal(s.colony.fallenAt, t.colony.fallenAt);
  assert.equal(stateHash(t), stateHash(s));
});

test('a colony that never had a colonist never falls (test scaffolding), and a fallen colony refuses commands', async () => {
  installSim({ stage: '2', reset: true });
  const e = createColony('EMPTY', { w: 32 });
  e.tick = 0;
  step(e, 26 * HOUR);
  assert.equal(isFallen(e), false);
  assert.ok(!('fallSince' in e.colony));
  // the shell refuses every command for a ruin (the sim would not run it anyway)
  const s = colony('FALL-4');
  s.colony.fallen = true; s.colony.fallenAt = s.tick;
  shell.app.s = s;
  const r = shell.send({ t: 'speed', v: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /fallen/);
  assert.equal(shell.isRuin(s), true);
  shell.app.s = null;
});

test('the final screen summary: years lived, the dead with causes, deeds, artifacts, the last Chronicle page', () => {
  const s = colony('FALL-5');
  const victim = s.col[0];
  damage(s, victim, 'head', 'blunt', 999);
  assert.ok(victim.hp.dead);
  for (const c of s.col.slice(1)) downHard(s, c);
  let n = 0; while (!isFallen(s) && n++ < 30 * HOUR) { tick(s); s.st.queue.length = 0; }
  const sum = fallSummary(s);
  assert.equal(sum.fallen, true);
  assert.equal(sum.fellAt, s.colony.fallenAt);
  assert.match(sum.fellText, /^Year 1, Thaw day \d+$/);
  assert.equal(sum.yearsLived, 0);
  assert.ok(sum.daysLived >= 1);
  assert.ok(sum.dead.some((d) => d.name === victim.name && /crushing blow/.test(d.cause)), JSON.stringify(sum.dead));
  assert.ok(Array.isArray(sum.deeds) && Array.isArray(sum.artifacts) && Array.isArray(sum.beasts));
  assert.equal(sum.lastPage[sum.lastPage.length - 1][2], 'chron_fell');
  assert.ok(Number.isInteger(sum.deepest) && sum.deepest >= 0);
});

test('Hard replaces Ironhold: founded with hard, ironhold refused, Stage 2 ironhold and iron: true read as hard', () => {
  assert.deepEqual(DIFFICULTIES, ['hearthkeeper', 'warden', 'steadfast', 'hard']);
  installSim({ stage: '2', reset: true });
  const s = foundColony({ seed: 'HARD-1', difficulty: 'hard', w: 64 });
  assert.equal(s.colony.difficulty, 'hard');
  assert.notEqual(s.colony.iron, true, 'no Ironhold on a new colony (the retired key stays false until the S9.7 migration drops it)');
  assert.throws(() => foundColony({ seed: 'x', difficulty: 'ironhold', w: 32 }), /unknown difficulty/);
  assert.equal(normDifficulty('ironhold'), 'hard');
  assert.equal(normDifficulty('steadfast', true), 'hard');
  assert.equal(normDifficulty('standard'), 'steadfast');
  assert.equal(normDifficulty('warden'), 'warden');
  assert.equal(normDifficulty('nonsense'), 'steadfast');
});
