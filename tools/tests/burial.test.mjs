// Workstream F, Stage Z2 step Z2.6 (EMBERCROWN-FORTRESS.md 3.6, 8.4): burial and the dead.
// Oracle (scripted here): a lost body named on a slab clears Unrested. (Bot target: no colonist Unrested for
// > 10 days at day 200: death.unrestedDays(s) <= 10, read by the bot report.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { FIX, WORK_IDS, SKILL_IDS } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../js/game/core/time.js';
import { stateHash } from '../../js/game/core/state.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { destroy as destroyStack } from '../../js/game/work/items.js';
import { rebuildFromJobs } from '../../js/game/work/reserve.js';
import { CONTENT } from '../../js/data/index.js';
import { health, social, death, mood } from '../../js/game/people/index.js';
import { restLine, deadRows } from '../../js/ui/burialui.js';

function colony(seed = 'F-Z26') {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'F Hold' });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
function built(s, defId, dx = 4, dy = 4) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const at = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 1);
  const b = addBuilding(s, defId, at[0], at[1], 0, null);
  completeBuilding(s, b);
  return b;
}
function calm(s, n, until = () => false) {
  for (let k = 0; k < n; k++) { if (s.tick % 600 === 0) s.st.queue.length = 0; tick(s); if (until()) return true; }
  return false;
}
const stopAll = (s) => { for (const c of s.col) { c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); c.job = null; } s.rt.res = rebuildFromJobs(s); };
const UNREST = () => (CONTENT.get('thought', 'unrested') ? 'unrested' : 'unburied');
const STONE = () => (CONTENT.get('thought', 'remembered_stone') ? 'remembered_stone' : 'laid_to_rest');
/** Make the dead one's grace run out now (5 days in one step). */
function age(s, colId, days = death.REST_DAYS) {
  const e = s.colony.people.rest.find((x) => x[0] === colId);
  e[1] -= days * TICKS_PER_DAY;
}

test('Z2.6: an unburied friend makes the living Unrested after 5 days; burial clears it with Laid to rest', () => {
  const s = colony();
  stopAll(s);
  const [a, b, c] = s.col;
  social.addOpinion(s, b.id, a.id, 60);
  health.kill(s, a, 'wounds');
  assert.deepEqual(s.colony.people.rest.map((e) => e[0]), [a.id], 'the dead go on the rest list');
  calm(s, TICKS_PER_HOUR * 2);
  assert.ok(!mood.hasThought(b, UNREST()), 'not within the 5-day grace');
  age(s, a.id);
  calm(s, TICKS_PER_HOUR);
  assert.ok(mood.hasThought(b, UNREST()), 'Unrested after 5 days');
  assert.ok(!mood.hasThought(c, UNREST()), 'only friends and kin');
  const t = b.thoughts.find((x) => x[0] === UNREST());
  assert.ok(mood.thoughtValueFor(s, b, t) < 0, 'a sad thought');
  assert.ok(death.unrestedDays(s) >= 0 && death.unrestedDays(s) < 1);
  assert.equal(deadRows(s)[0].name, a.name, 'the dead list names them');
  // a save in the middle holds and continues
  const back = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(back), stateHash(s));
  // burial
  const g = built(s, 'grave', -6, 4);
  c.custom = true; c.prio[WORK_IDS.indexOf('haul')] = 1;
  assert.ok(calm(s, TICKS_PER_DAY, () => death.graveNames(s, g.id).length > 0), 'buried');
  assert.ok(!mood.hasThought(b, UNREST()), 'Unrested lifts at burial');
  assert.ok(mood.hasThought(b, 'laid_to_rest'));
  assert.equal(s.colony.people.rest.length, 0);
  assert.match(restLine(s, g), new RegExp(a.name));
});

test('Z2.6 oracle: a lost body named on a memorial slab clears Unrested ("Remembered in stone")', () => {
  const s = colony('F-Z26b');
  stopAll(s);
  const [a, b, c] = s.col;
  social.setKind(s, b.id, a.id, 'kin');
  health.kill(s, a, 'wounds');
  destroyStack(s, death.corpseOf(s, a.id).id);   // fell into ember: the body is lost
  assert.ok(death.bodyLost(s, a.id));
  age(s, a.id, death.REST_DAYS + 1);
  calm(s, TICKS_PER_HOUR);
  assert.ok(mood.hasThought(b, UNREST()), 'kin Unrested');
  const slabDef = death.SLAB_DEFS.find((id) => CONTENT.get('structure', id));
  assert.ok(slabDef, 'a memorial slab in the content');
  const slab = built(s, slabDef, 5, -3);
  c.custom = true; c.prio[WORK_IDS.indexOf('craft')] = 1;
  const ms = c.sk[SKILL_IDS.indexOf('masonry')]; ms[0] = Math.max(ms[0], 4);
  assert.ok(calm(s, TICKS_PER_DAY, () => death.slabNames(s, slab.id).length > 0), 'a mason engraves the name');
  assert.deepEqual(death.slabNames(s, slab.id), [a.name]);
  assert.ok(!mood.hasThought(b, UNREST()), 'Unrested cleared');
  assert.ok(mood.hasThought(b, STONE()), 'Remembered in stone');
  assert.equal(death.unrestedDays(s), 0);
  assert.match(restLine(s, slab), new RegExp(a.name));
  // the slab is an Annals place (legend kind t), and the hold saves and loads
  if (typeof s.legend === 'string') assert.ok(s.legend.split(' ').some((r) => r.startsWith('t')), 'a place record');
  const back = loadBlobSync(saveBlobSync(s));
  assert.equal(stateHash(back), stateHash(s));
});

test('Z2.6 migration: an older hold with its dead but no rest list gets one with a 5-day grace; untouched holds gain no field', () => {
  const s = colony('F-Z26c');
  stopAll(s);
  calm(s, TICKS_PER_HOUR * 2);
  assert.ok(!s.colony.people || !('rest' in s.colony.people), 'no dead, no new field (hashes of untouched holds hold)');
  const [a, b] = s.col;
  social.addOpinion(s, b.id, a.id, 60);
  health.kill(s, a, 'wounds');
  delete s.colony.people.rest; delete s.colony.people.slabs; delete s.colony.people.funeral;
  a.hp.diedT -= 30 * TICKS_PER_DAY;   // long dead in the old save
  const back = loadBlobSync(saveBlobSync(s));
  calm(back, TICKS_PER_HOUR);
  const e = back.colony.people.rest.find((x) => x[0] === a.id);
  assert.ok(e && back.tick - e[1] <= TICKS_PER_HOUR, 'the clock starts at the upgrade');
  assert.ok(!mood.hasThought(back.col.find((x) => x.id === b.id), UNREST()));
  // determinism: the same run twice
  const s2 = loadBlobSync(saveBlobSync(back));
  calm(back, TICKS_PER_HOUR * 3); calm(s2, TICKS_PER_HOUR * 3);
  assert.equal(stateHash(back), stateHash(s2));
});

test('Z2.6: a funeral calls friends and kin to the tomb for an hour; they come away "Mourned"', () => {
  const s = colony('F-Z26d');
  stopAll(s);
  const [a, b, c] = s.col;
  social.addOpinion(s, b.id, a.id, 60);
  b.custom = true; b.prio[WORK_IDS.indexOf('haul')] = 1;
  c.custom = true; c.prio[WORK_IDS.indexOf('haul')] = 1;
  health.kill(s, a, 'wounds');
  const g = built(s, 'grave', -6, 4);
  destroyStack(s, death.corpseOf(s, a.id).id);
  const f = death.startFuneral(s, g, a.id);
  calm(s, TICKS_PER_HOUR * 2);
  assert.deepEqual(f[3], [b.id], 'the friend came, the stranger did not');
  const FUN = CONTENT.get('thought', 'funeral') ? 'funeral' : 'laid_to_rest';
  assert.ok(mood.hasThought(b, FUN));
  assert.equal(s.colony.people.funeral, null, 'over');
});
