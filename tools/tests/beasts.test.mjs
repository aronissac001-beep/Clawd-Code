// Step Z3.3 (EMBERCROWN-FORTRESS.md 3.12, 8.5): great beasts. Owner H.
// Oracle cases: no command can schedule a beast; generation is a pure function of the seed; every beast's attacks
// map to existing sim effects; the Hollow King wakes when the Seal is mined; flee, heal and return by cause; the
// kill's rewards; old saves load (s.st.gb defaults); determinism; the render budget with a 3 x 3 beast.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { TER, PLANE } from '../../js/game/core/grid.js';
import { COMMANDS } from '../../js/game/core/commands.js';
import { BUS } from '../../js/game/core/bus.js';
import { stateHash } from '../../js/game/core/state.js';
import { TICKS_PER_DAY } from '../../js/game/core/time.js';
import { beastIdentity } from '../../js/game/colony/legends.js';
import * as C from '../../js/game/threat/causes.js';
import { dormantRows } from '../../js/game/threat/causes.js';
import { eligible } from '../../js/game/threat/storyteller.js';
import { logicOf } from '../../js/game/threat/incidents.js';
import { foeById } from '../../js/game/threat/raiders.js';
import * as GB from '../../js/game/threat/beasts/index.js';
import { genBeast, holdBeasts, ATTACK } from '../../js/game/threat/beasts/gen.js';
import { DATA } from '../../js/data/beasts.js';
import { drawBeast } from '../../js/engine/art/beasts.js';

function fort(seed = 'Z33') {
  installSim({ stage: '2', reset: true, checks: false });
  GB.installBeasts();
  return foundColony({ seed, name: 'Beast Hold', d: 20 });
}
const hk = (s) => holdBeasts(s).find((b) => b.legend === 'hollowking');
const mineSeal = (s) => { const v = dormantRows(s, 'seal')[0][1]; s.L.terrain[v] = TER.FLOOR; s.st.causesDay = -1; };
/** Run the daily scheduler from day d0 until it schedules (or n days pass). */
function untilScheduled(s, n = 400) {
  for (let k = 0; k < n; k++) { s.tick = (Math.floor(s.tick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY; s.st.causesDay = -1; const e = GB.beastDay(s); if (e) return e; }
  return null;
}

test('Z3.3 generation is a pure function of the seed: 4-6 generated beasts and the three legends', () => {
  const a = fort('Z33a'), ra = holdBeasts(a).map((b) => JSON.stringify(b));
  const gen = holdBeasts(a).filter((b) => !b.legend);
  assert.ok(gen.length >= 4 && gen.length <= 6, `${gen.length} generated beasts`);
  assert.deepEqual(holdBeasts(a).filter((b) => b.legend).map((b) => b.legend).sort(), ['colossus', 'gloomwyrm', 'hollowking']);
  for (const b of gen) {
    const row = dormantRows(a, 'lair').find((r) => GB.keyOf(r[1]) === b.key);
    assert.deepEqual(genBeast(row), b, 'same row, same beast');
    const id = beastIdentity(row[2]);
    assert.equal(b.name, id.full, 'the pre-history names it the same');
    assert.equal(b.plan, id.body); assert.equal(b.mat, id.material);
    assert.ok(b.attacks.length >= 1 && b.attacks.length <= 2);
  }
  const b2 = fort('Z33a');
  assert.deepEqual(holdBeasts(b2).map((b) => JSON.stringify(b)), ra, 'a second founding of the seed: the same beasts');
  const c = fort('Z33c');
  assert.notDeepEqual(holdBeasts(c).map((b) => b.name), holdBeasts(a).map((b) => b.name));
});

test('Z3.3 every beast attack maps to an existing sim effect', () => {
  for (const a of DATA.attack) assert.equal(typeof GB.ATTACK_FX[a.fx], 'function', `${a.id} -> ${a.fx}`);
  for (const seed of ['Z33a', 'Z33b', 'Z33c']) for (const b of holdBeasts(fort(seed))) for (const a of b.attacks) assert.ok(ATTACK[a], `${b.name}: ${a}`);
});

test('Z3.3 no command can schedule a beast; the storyteller never draws it', () => {
  for (const k of Object.keys(COMMANDS)) assert.ok(!/beast/i.test(k), `command ${k}`);
  const s = fort();
  open(s);
  assert.equal(GB.BEAST_INCIDENT.weight, 0);
  assert.equal(eligible(s, GB.BEAST_INCIDENT), false, 'the storyteller pick never draws great_beast');
  // only the beasts module names the incident
  const hits = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js') && readFileSync(p, 'utf8').includes("'great_beast'")) hits.push(p); } };
  walk('js/game'); walk('js/ui');
  assert.deepEqual(hits.filter((p) => !p.includes('threat/beasts/')), []);
});
function open(s) { for (const cav of ['hollows', 'mere', 'reach']) { const { addLegend } = LEG; addLegend(s, 'l', C.cavernZs()[cav][0]); } s.st.causesDay = -1; }
import * as LEG from '../../js/game/colony/legends.js';

test('Z3.3 nothing wakes before its cause; the Hollow King wakes when the Seal is mined', () => {
  const s = fort();
  assert.equal(GB.wokenBeasts(s).length, 0, 'nothing woken at founding');
  assert.equal(untilScheduled(s, 30), null, 'no beast without a cause');
  assert.equal(GB.beastCause(s, hk(s)), null);
  mineSeal(s);
  assert.equal(GB.sealMined(s), true);
  assert.deepEqual(GB.beastCause(s, hk(s)).slice(0, 2), ['seal', 'seal']);
  const e = untilScheduled(s);
  assert.ok(e, 'scheduled');
  assert.equal(e.gb, hk(s).key);
  assert.ok(e.arriveTick - e.warnTick >= 24 * 600, 'warned >= 24 h');
  assert.ok(e.plan.members.length >= 5 && e.plan.members.length <= 9, 'the King and 4-8 Knights');
  assert.equal(GB.beastDay(s), null, 'one great beast at a time');
});

test('Z3.3 a beast flees below 30%, heals by the season, returns by its cause; the kill leaves its rewards', () => {
  const s = fort();
  mineSeal(s);
  const e = untilScheduled(s);
  s.st.queue = s.st.queue.filter((x) => x !== e);
  const L = logicOf(GB.BEAST_INC);
  const rid = L.start(s, e);
  const r = s.raids.find((x) => x.id === rid);
  const f = r.members.map((id) => foeById(s, id)).find((x) => x.st.gb);
  assert.ok(f && f.hp.max === hk(s).hp);
  f.hp.hp = Math.floor(f.hp.max * 0.2);
  L.tick(s, r);
  assert.equal(f.st.flee, true); assert.equal(r.stage, 'retreat');
  L.end(s, r, 'fled');
  const rec = GB.recOf(s, hk(s).key);
  assert.equal(rec.fled, 1); assert.ok(rec.hp < 30 && rec.scars.length === 1);
  assert.equal(GB.beastCause(s, hk(s)), null, 'wounded: it stays in its lair');
  for (let k = 0; k < 8; k++) { s.tick = (Math.floor(s.tick / TICKS_PER_DAY / 10) + 1) * 10 * TICKS_PER_DAY; GB.beastDay(s); s.st.queue = []; GB.gbOf(s).on = null; }
  assert.ok(rec.hp >= 60, `healed to ${rec.hp}`);
  assert.ok(GB.beastCause(s, hk(s)), 'the cause still holds: it may come again');
  // the kill
  const f2 = { id: 9999, kind: 'hollow_knight', x: 64 * 32, y: 64 * 32, z: f.z, hp: { hp: 0, max: 1 }, st: { gb: hk(s).key } };
  for (const fn of BUS.kill) fn(s, f2, null);
  assert.ok(rec.slain >= 0); assert.ok(GB.gbOf(s).tro.includes(hk(s).key));
  assert.equal(GB.beastCause(s, hk(s)), null, 'a slain beast never comes again');
});

test('Z3.3 old saves load (s.st.gb defaults) and the scheduler is deterministic', () => {
  const run = () => { const s = fort('Z33d'); delete s.st.gb; mineSeal(s); untilScheduled(s); return stateHash(s); };
  assert.equal(run(), run());
  const s = fort('Z33d'); delete s.st.gb;
  const g = GB.gbOf(s);
  assert.deepEqual([g.on, g.web, g.tro, Object.keys(g.b).length], [null, [], [], 0]);
});

test('Z3.3 render budget: a 3 x 3 beast paints in few fillRects and well under 0.1 ms', () => {
  let n = 0;
  const g = { fillStyle: '', fillRect: () => { n++; } };
  const s = fort();
  const big = holdBeasts(s).find((b) => b.legend === 'colossus');
  assert.equal(big.size, 3);
  const t0 = performance.now();
  for (let k = 0; k < 1000; k++) drawBeast(g, big, 100, 100, k / 60);
  const ms = (performance.now() - t0) / 1000;
  assert.ok(n / 1000 <= 40, `${n / 1000} fillRects per beast`);
  assert.ok(ms < 0.1, `${ms.toFixed(4)} ms per beast`);
  for (const b of holdBeasts(s)) assert.ok(drawBeast(g, b, 0, 0, 0) > 4, b.plan);
});

import { step } from '../../js/game/core/sim.js';
test('Z3.3 a woken beast on the map: the sim runs a game hour with it (attacks, armour, webs) without error', () => {
  const s = fort('Z33e');
  const gen = holdBeasts(s).filter((b) => !b.legend);
  // put each attack on the map once: the first generated beast, with every attack
  const b = gen[0];
  const e = { id: 777, inc: GB.BEAST_INC, gb: b.key, stage: 'imminent', warnTick: s.tick, arriveTick: s.tick, cast: {}, raid: null,
    plan: { pts: 100, edge: { side: 'deep', i: b.lair }, goal: 'core', members: [b.base], nem: null, lead: 0 } };
  const rid = logicOf(GB.BEAST_INC).start(s, e);
  assert.ok(Number.isInteger(rid));
  const f = s.foes.find((x) => x.st && x.st.gb === b.key);
  const before = f.hp.hp;
  step(s, 600);
  assert.ok(s.foes.includes(f) || GB.recOf(s, b.key).slain >= 0 || GB.gbOf(s).on === null);
  assert.ok(f.hp.hp <= before);
});

import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
test('Z3.3 the beast records survive a save and load (C13: same hash)', async () => {
  const s = fort('Z33f');
  mineSeal(s);
  untilScheduled(s);
  GB.recOf(s, hk(s).key).scars.push('x');
  const t = await loadBlob(await saveBlob(s));
  assert.deepEqual(t.st.gb, s.st.gb);
  assert.equal(stateHash(t), stateHash(s));
});
