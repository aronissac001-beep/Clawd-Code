// Stage 1b UI logic (owner I; doc 9.4, 10.6, 10.10, 10.9): the threat chip view and the stage watcher,
// the alert rules (starving, idle, raid, Hearth fuel) with snoozes, Next steps from G's advice rules,
// and the A2HS rule. Headless: these read state only (localStorage is absent in Node: the per-colony
// UI memory then lasts for the process, as in a private tab).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { stateHash } from '../../js/game/core/state.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { chipView, threatWatch, firstOmen } from '../../js/ui/threatui.js';
import { alertTracker, ALERT_RULES } from '../../js/ui/alerts.js';
import { nextSteps, ledgerLines } from '../../js/ui/ledger.js';
import { a2hsDue, firstRoomBuilt } from '../../js/ui/cards.js';

const at = (d, h) => (d - 1) * TICKS_PER_DAY + h * TICKS_PER_HOUR;
const run = (s, t) => { while (s.tick < t) tick(s); };

test('threat chip: none before the omen; hours from the omen; the watcher reports omen, imminent and active once each', () => {
  installSim({ stage: '1b', reset: true });
  const s = foundColony({ seed: 'UI1B-1', name: 'Chip Hold' });
  const w = threatWatch(s);
  assert.equal(chipView(s), null);
  run(s, at(2, 18) + 1);
  const v = chipView(s);
  assert.ok(v, 'a chip at the omen');
  assert.equal(v.stage, 'omen');
  assert.equal(v.text, '27h');
  assert.match(v.label, /Hollow horde in 27 hours from the (north|east|south|west)/);
  assert.equal(firstOmen(s), true);
  const evs = w.poll();
  assert.deepEqual(evs.map((e) => e.kind), ['omen']);
  assert.deepEqual(w.poll(), [], 'reported once');
  run(s, at(3, 20) + 1);
  assert.deepEqual(w.poll().map((e) => e.kind), ['imminent']);
  assert.equal(chipView(s).tone, 'bad');
  run(s, at(3, 21) + 2);
  const act = w.poll().map((e) => e.kind);
  assert.ok(act.includes('active'), JSON.stringify(act));
  assert.equal(chipView(s).text, 'here');
});

test('alerts: Hearth fuel under a day, starving, raid on the map, idle after a game hour; snooze hides one for a day; no state change', () => {
  installSim({ stage: '1b', reset: true });
  const s = foundColony({ seed: 'UI1B-2', name: 'Alert Hold' });
  const tr = alertTracker(s);
  // the 1b rules stay, in this order, among the Stage 2 list (10.6)
  assert.deepEqual(ALERT_RULES.map((r) => r.id).filter((id) => ['raid', 'starving', 'hearth', 'idle'].includes(id)), ['raid', 'starving', 'idle', 'hearth']);
  const h0 = stateHash(s);
  assert.deepEqual(tr.update().map((a) => a.id), [], 'a fresh colony has no alert');
  assert.equal(stateHash(s), h0, 'alerts never write state');
  s.colony.hearth.fuel = 5 * TICKS_PER_HOUR;
  s.col[0].need[0] = 0;
  const ids = tr.update().map((a) => a.id);
  assert.ok(ids.includes('hearth') && ids.includes('starving'), ids.join(','));
  const hearth = tr.list().find((a) => a.id === 'hearth');
  assert.equal(hearth.text, 'Hearth fuel: 5 h left');
  assert.deepEqual(hearth.target, { building: s.colony.hearth.id });
  tr.snooze('hearth');
  assert.ok(!tr.update().some((a) => a.id === 'hearth'), 'snoozed for a day');
  // idle: a colonist with no job for a game hour (the tracker times it on the UI side)
  const idleRule = ALERT_RULES.find((x) => x.id === 'idle');
  const c0 = s.col[1];
  c0.job = null; c0.drafted = false;
  assert.equal(idleRule.test(s, { idleSince: new Map([[c0.id, s.tick - 10]]) }), null, 'not after 10 ticks');
  const a = idleRule.test(s, { idleSince: new Map([[c0.id, s.tick - TICKS_PER_HOUR]]) });
  assert.ok(a && a.target.colonist === c0.id, 'after a game hour');
  // raid: run to the arrival
  const s2 = foundColony({ seed: 'UI1B-3', name: 'Raid Hold' });
  const tr2 = alertTracker(s2);
  run(s2, at(3, 20) + 1);
  const r = tr2.update().find((a) => a.id === 'raid');
  assert.ok(r, 'raid alert at Imminent');
  assert.match(r.text, /Hollow horde in 1 h from the/);
});

test('Next steps: the top 3 advice rules by score, a dismissed rule waits its cooldown; the ledger lines follow the dawn roll', () => {
  installSim({ stage: '1b', reset: true });
  const s = foundColony({ seed: 'UI1B-4', name: 'Advice Hold' });
  const steps = nextSteps(s);
  assert.equal(steps.length, 3);
  for (let k = 1; k < steps.length; k++) assert.ok(steps[k - 1].score >= steps[k].score);
  const top = steps[0].id;
  const after = nextSteps(s, { [top]: s.tick });
  assert.ok(!after.some((x) => x.id === top), 'dismissed now: hidden');
  assert.ok(nextSteps(s, { [top]: s.tick - 3 * TICKS_PER_DAY }).some((x) => x.id === top), 'back after the cooldown');
  assert.ok(steps.every((x) => x.go), 'every step has a Go target');
  assert.deepEqual(ledgerLines(s), [], 'no ledger before the first dawn roll');
  run(s, at(2, 6) + 1);
  assert.ok(Array.isArray(ledgerLines(s)));
});

test('A2HS: not before the first room is built, never in the Home Screen app', () => {
  installSim({ stage: '1b', reset: true });
  const s = foundColony({ seed: 'UI1B-5', name: 'Card Hold' });
  assert.equal(firstRoomBuilt(s), false);
  assert.equal(a2hsDue(s, false), false);
  assert.equal(a2hsDue(s, true), false);
});
