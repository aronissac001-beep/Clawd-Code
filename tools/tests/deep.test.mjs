// Step Z3.1 (EMBERCROWN-FORTRESS.md 2.10, 8.5): deep entries and cavern threats. Owner H.
// Oracle cases: nothing comes through a passage before its cavern is opened; a breach enters at its seep's z;
// the Opened cavern, Near lair and Woken seep causes; cavern packs and the Lamplost; every deep threat warned >= 6 h.
// (The bot oracle, an underground threat by day 200 on 4 of 5 seeds: DEEP_BOT=1.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { PLANE, D as gridD, setBit } from '../../js/game/core/grid.js';
import * as C from '../../js/game/threat/causes.js';
import { planRaid, deepEntry, CAVE_PACKS } from '../../js/game/threat/raidplan.js';
import { incidentDef, logicOf } from '../../js/game/threat/incidents.js';
import { eligible } from '../../js/game/threat/storyteller.js';
import { all } from '../../js/game/threat/defs.js';
import { addLegend } from '../../js/game/colony/legends.js';
import { stateHash } from '../../js/game/core/state.js';

const zOf = (v) => (v / PLANE) | 0;
function fort(seed = 'Z31') {
  installSim({ stage: '2', reset: true, checks: false });
  return foundColony({ seed, name: 'Deep Hold', d: 20 });
}
const fresh = (s) => { s.st.causesDay = -1; return C.liveCauses(s); };
const has = (s, k, sub) => fresh(s).some((c) => c[0] === k && (sub === undefined || c[1] === sub));
const open = (s, cav) => { addLegend(s, 'l', C.cavernZs()[cav][0]); s.st.causesDay = -1; };

test('Z3.1 a closed cavern lets nothing through its passages; an opened one sends its pack up a passage', () => {
  const s = fort();
  assert.ok(gridD > 1);
  const hp = C.passagesOf(s, 'hollows');
  assert.ok(hp.length >= 2, 'the Hollows have deep passages');
  assert.equal(C.openedCaverns(s).length, 0);
  assert.ok(!has(s, 'opened_cavern'));
  for (const id of ['cavern_pack', 'lamplost_thieves', 'lamplost_trade']) assert.equal(eligible(s, incidentDef(id)), false, `${id} before any cavern is open`);
  assert.equal(deepEntry(s, { inc: 'cavern_pack' }, 'hollows'), -1);
  const p0 = planRaid(s, { inc: 'cavern_pack' }, 200);
  assert.notEqual(p0.edge.side, 'deep', 'no passage entry before the cavern is opened');
  open(s, 'hollows');
  assert.ok(has(s, 'opened_cavern', 'hollows'));
  assert.ok(!has(s, 'opened_cavern', 'mere'));
  assert.equal(eligible(s, incidentDef('lamplost_thieves')), false, 'the Lamplost need the Mere');
  assert.ok(logicOf('cavern_pack').requires(s));
  const p = planRaid(s, { inc: 'cavern_pack', cause: ['opened_cavern', 'hollows'] }, 200);
  assert.equal(p.edge.side, 'deep');
  assert.ok(hp.includes(p.edge.i), 'enters at a Hollows passage');
  assert.equal(p.cav, 'hollows');
  for (const m of p.members) assert.ok(CAVE_PACKS.hollows.includes(m) || m === 'great_spider', m);
  assert.ok(C.causeLine(s, ['opened_cavern', 'hollows']).includes('the Hollows'));
});

test('Z3.1 the Lamplost come up the Mere passage nearest their camp; their trade leaves goods', () => {
  const s = fort();
  open(s, 'mere');
  assert.ok(logicOf('lamplost_thieves').requires(s) && logicOf('lamplost_trade').requires(s));
  const p = planRaid(s, { inc: 'lamplost_thieves' }, 200);
  assert.equal(p.edge.side, 'deep');
  assert.ok(C.passagesOf(s, 'mere').includes(p.edge.i));
  assert.ok(p.members.length > 0);
  const goods = () => s.items.reduce((n, it) => n + (it && ['glowspirit', 'fish', 'gem'].includes(it.k) ? it.n | 0 : 0), 0);
  const n0 = goods();
  logicOf('lamplost_trade').start(s, {});
  assert.ok(goods() > n0, 'goods left at the Hearth');
});

test('Z3.1 a woken seep: the breach enters at its seep\'s z, below the hold; near a lair: Near lair', () => {
  const s = fort();
  const seeps = C.dormantRows(s, 'seep');
  assert.ok(seeps.length > 0);
  assert.equal(C.wokenSeeps(s).length, 0);
  assert.ok(!has(s, 'seep'));
  const v = seeps[0][1];
  setBit(s.L.fog, v + PLANE + 3, 1);   // a found voxel one level up, 3 tiles off
  assert.deepEqual(C.wokenSeeps(s), [v]);
  assert.ok(has(s, 'seep', 'seep'));
  const p = planRaid(s, { inc: 'deep_breach' }, 300);
  assert.equal(p.edge.side, 'deep');
  assert.equal(zOf(p.edge.i), zOf(v), 'at the seep\'s level');
  assert.ok(zOf(p.edge.i) < 14 - 10, 'deep below the surface');
  const lairs = C.dormantRows(s, ['lair', 'lair_colossus']);
  assert.ok(lairs.length > 0);
  setBit(s.L.fog, lairs[0][1], 1);
  assert.ok(has(s, 'near_lair', 'lair:' + lairs[0][1]));
});

test('Z3.1 every deep threat is warned >= 6 h and has a cause; no beast can be scheduled by these rows', () => {
  installSim({ stage: '2', reset: true, checks: false });
  for (const id of ['cavern_pack', 'lamplost_thieves', 'deep_breach']) {
    const d = incidentDef(id);
    assert.ok(d.warnH[0] >= 6, `${id} warned >= 6 h`);
    assert.ok(C.causedIncidents().has(id));
  }
  for (const st of all('storyteller')) assert.ok(st.warnH[0] >= 6, st.id);
  assert.deepEqual(C.allowsOf('near_lair', 'lair:1'), []);
});

test('Z3.1 determinism: the same world plans the same deep raids', () => {
  const run = () => { const s = fort('Z31d'); open(s, 'hollows'); open(s, 'mere'); const a = planRaid(s, { inc: 'cavern_pack' }, 220), b = planRaid(s, { inc: 'lamplost_thieves' }, 120); return JSON.stringify([a, b, fresh(s), stateHash(s)]); };
  assert.equal(run(), run());
});
