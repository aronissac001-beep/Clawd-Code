// Step Z3.5 (EMBERCROWN-FORTRESS.md 8.5): threats on levels in the UI (owner I). Pure parts only; the phone
// walk is tools/ui-phone-z3.mjs. The chip carries level and cause; a deep threat is the 'breach' alert whose
// target is the [x, y, z] tile at its entry level (one tap there); route chevrons mark level changes;
// flood and ember alerts name their level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { PLANE, W, zS, idx } from '../../js/game/core/grid.js';
import { newEntry } from '../../js/game/threat/incidents.js';
import { ensureWorld } from '../../js/game/world/worldrec.js';
import { chipView, threatZ, routeChevrons, causeName } from '../../js/ui/threatui.js';
import { ALERT_RULES } from '../../js/ui/alerts.js';

function fort() {
  installSim({ stage: '2', reset: true, checks: false });
  return foundColony({ seed: 'Z35', name: 'Deep Hold', d: 20 });
}
const rule = (id) => ALERT_RULES.find((r) => r.id === id);
function breachAt(s, rel, stage = 'sighted') {
  const z = zS + rel, i = idx(40, 50, z);
  const e = newEntry(901, 'deep_breach', s.tick, s.tick + 9 * 600, { stage, plan: { pts: 100, edge: { side: 'deep', i }, goal: 'people', members: ['husk'] }, cause: ['seep', 'seep'], why: 'A seep woke.' });
  s.st.queue.push(e);
  return { z, i };
}

test('Z3.5 the chip names the level and the cause of a deep threat', () => {
  const s = fort();
  const { z } = breachAt(s, -13);
  const c = chipView(s);
  assert.ok(c, 'a chip');
  assert.equal(c.z, z);
  assert.equal(c.cause, 'Woken seep');
  assert.match(c.text, /-13$/);
  assert.match(c.label, /Level -13/);
  assert.match(c.label, /Cause: Woken seep/);
  assert.equal(threatZ(c.view), z);
  assert.equal(causeName(s, c.view), 'Woken seep');
});

test('Z3.5 a deep threat is the breach alert with an [x, y, z] target at its level; the raid alert skips it', () => {
  const s = fort();
  const { z } = breachAt(s, -13, 'imminent');
  const a = rule('breach').test(s);
  assert.ok(a);
  assert.deepEqual(a.target.tile, [40, 50, z]);
  assert.equal(z - zS, -13);
  assert.match(a.text, /Level -13/);
  assert.equal(rule('raid').test(s), null);
});

test('Z3.5 route chevrons: one pair per level change, leaving toward the next level and back at arrival', () => {
  const s = fort();
  const r = [idx(10, 10, 5), idx(11, 10, 5), idx(11, 10, 6), idx(12, 10, 6), idx(12, 10, 7)];
  const ch = routeChevrons(s, { route: r });
  assert.equal(ch.length, 4);
  assert.deepEqual(ch.filter((c) => !c.back).map((c) => [c.from, c.to, c.x]), [[5, 6, 11], [6, 7, 12]]);
  assert.deepEqual(ch.filter((c) => c.back).map((c) => [c.from, c.to]), [[6, 5], [7, 6]]);
  assert.deepEqual(routeChevrons(s, { route: [idx(1, 1, 3), idx(2, 1, 3)] }), []);
});

test('Z3.5 flood and ember alerts name the level of the moving fluid; sources do not count', () => {
  const s = fort();
  assert.equal(rule('flood').test(s), null);
  const w = ensureWorld(s);
  const a = idx(20, 20, zS - 3), b = idx(30, 30, zS - 9), src = idx(5, 5, zS - 1);
  s.L.fluid[src] = 16 | 7; s.L.fluid[a] = 5; s.L.fluid[b] = 8 | 3;
  w.fluid = { act: [src, a, b].sort((p, q) => p - q), idle: [0, 0, 0], q: [], cur: 0 };
  const f = rule('flood').test(s), e = rule('ember').test(s);
  assert.deepEqual(f.target.tile, [20, 20, zS - 3]);
  assert.match(f.text, /Level -3/);
  assert.deepEqual(e.target.tile, [30, 30, zS - 9]);
  assert.match(e.text, /Level -9/);
  void PLANE; void W;
});
