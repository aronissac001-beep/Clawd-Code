// Stage Z2 step Z2.5 (EMBERCROWN-FORTRESS.md 3.8, 8.4): squads with uniforms, alert levels, orders on
// any level (Station, Patrol, Defend refuge) and training. Oracle cases:
//   - a squad on Muster equips from armoury racks within 1 game hour;
//   - a patrol across 2 levels loops;
// plus Drilled after 3 drills a season, Shelter and Peace, the squad command, saves mid-muster that
// continue identically, and a hold with no military record staying untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step, tick } from '../../js/game/core/sim.js';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { newColonist } from '../../js/game/core/schema.js';
import { idx, ctrW, TER } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../js/game/core/time.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn } from '../../js/game/work/items.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { CONTENT } from '../../js/data/index.js';
import * as D from '../../js/game/people/draft.js';
import { squadOrderCmd } from '../../js/game/people/draft.js';

const H1 = TICKS_PER_HOUR;
function colony(seed) { installSim({ stage: '2', reset: true, checks: true }); return foundColony({ seed, name: 'Mil Hold' }); }
const hearth = (s) => s.bld[s.colony.hearth.id];
function built(s, defId, dx, dy) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const p = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 0);
  const b = addBuilding(s, defId, p[0], p[1], 0, null);
  completeBuilding(s, b);
  return b;
}
const able = (s) => s.col.filter((c) => !c.hp.dead && !c.hp.down);
function squadOf(s, n, k) {
  const ids = able(s).slice(0, k).map((c) => c.id);
  assert.ok(D.squadCmd(s, { id: 1, add: ids }).ok);
  for (const id of ids) s.col.find((c) => c.id === id).soldier = true;
  return ids.map((id) => s.col.find((c) => c.id === id));
}

test('a squad on Muster equips from the armoury racks within 1 game hour', () => {
  const s = colony('MIL-EQ');
  const rack = built(s, 'weaponrack', -6, 6);
  const sq = squadOf(s, 1, 2);
  for (const c of sq) c.gear = { slots: {}, outfit: null };
  for (let k = 0; k < 2; k++) { spawn(s, 'spear', 'iron', 1, 1, rack.x, rack.y); spawn(s, 'ironhelm', 'iron', 1, 1, rack.x + 1, rack.y); }
  const r = D.squadCmd(s, { id: 1, uniform: { weapon: ['spear', 0, null], helm: ['any', 0, null] } });
  assert.ok(r.ok, r.reason);
  assert.equal(D.uniformShortfall(s).length, 0, 'the racks hold enough');
  assert.equal(D.setAlert(s, 'muster'), null);
  const t0 = s.tick;
  let done = -1;
  for (let t = 0; t < H1; t++) { tick(s); if (sq.every((c) => D.missingSlots(s, c).length === 0)) { done = s.tick - t0; break; } }
  assert.ok(done > 0, `every member is in uniform within an hour (${sq.map((c) => JSON.stringify(c.gear.slots)).join(' | ')})`);
  for (const c of sq) { assert.ok(c.drafted, 'mustered soldiers are drafted'); assert.equal(c.gear.slots.weapon.k, 'spear'); assert.equal(c.gear.slots.head.k, 'ironhelm'); }
  console.log(`# muster equip: ${done} ticks (${(done / H1).toFixed(2)} game hours) for ${sq.length} soldiers, 2 pieces each`);
  // a missing piece is named: a third member with no helm left
  const third = able(s).find((c) => !c.squad);
  D.squadCmd(s, { id: 1, add: [third.id] });
  third.gear = { slots: {}, outfit: null };
  const sh = D.uniformShortfall(s);
  assert.ok(sh.some((x) => x.slot === 'helm' && x.n === 1 && /lacks 1 helm$/.test(x.text)), JSON.stringify(sh));
  // Peace stands them down
  D.setAlert(s, 'peace');
  step(s, 40);
  for (const c of sq) assert.ok(!c.drafted, 'peace undrafts the squad');
});

function twoLevels(seed = 'MIL-3D') {
  installSim({ stage: '2', reset: true, checks: true });
  const w = 32, d = 3;
  const s = createColony(seed, { w, d, zS: 2, terrain: TER.ROCK });
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) s.L.terrain[idx(x, y, 2)] = TER.ROUGH;
  for (let y = 2; y < 30; y++) for (let x = 2; x < 30; x++) s.L.terrain[idx(x, y, 1)] = TER.ROUGH;   // a hall under the surface
  s.L.terrain[idx(16, 16, 2)] = TER.STAIR_D; s.L.terrain[idx(16, 16, 1)] = TER.STAIR_U;
  s.L.mat.fill(3); s.L.fog.fill(255);
  initRuntime(s);
  for (let k = 0; k < 3; k++) { const id = s.next.col++; const c = newColonist(id, { name: `S${id}`, x: ctrW(6 + k), y: ctrW(6), z: 2 }); c.soldier = true; s.col.push(c); }
  return s;
}
test('a patrol across 2 levels loops', () => {
  const s = twoLevels();
  assert.ok(D.squadCmd(s, { id: 1, add: s.col.map((c) => c.id), uniform: { weapon: null } }).ok);
  const A = idx(5, 5, 2), B = idx(25, 25, 1);
  assert.ok(squadOrderCmd(s, { kind: 'patrol', squad: 1, pts: [A, B] }).ok);
  const lead = s.col[0], seen = [];
  for (let t = 0; t < 12000; t++) {
    if (t % 2000 === 0) for (const c of s.col) c.need.fill(9000);   // no food down there: keep them fed
    tick(s);
    const at = ((lead.x / 32) | 0) === 5 && ((lead.y / 32) | 0) === 5 && lead.z === 2 ? 'A' : ((lead.x / 32) | 0) === 25 && ((lead.y / 32) | 0) === 25 && lead.z === 1 ? 'B' : null;
    if (at && seen[seen.length - 1] !== at) seen.push(at);
  }
  console.log(`# patrol: the leader's stops in 12000 ticks: ${seen.join(' ')}`);
  assert.ok(seen.length >= 5 && seen.slice(0, 5).join('') === 'ABABA', `loops A B A B A (${seen.join(' ')})`);
  for (const c of s.col) assert.ok(c.drafted, 'a standing order keeps the squad on duty');
  // Hold relieves the standing order; Peace then stands them down
  assert.ok(squadOrderCmd(s, { kind: 'hold', squad: 1 }).ok);
  step(s, 40);
  for (const c of s.col) assert.ok(!c.drafted);
  // a Station on the lower level puts the squad in formation there
  assert.ok(squadOrderCmd(s, { kind: 'station', squad: 1, pts: [idx(20, 10, 1)] }).ok);
  step(s, 2000);
  for (const c of s.col) { assert.equal(c.z, 1); assert.ok(Math.abs(((c.x / 32) | 0) - 20) <= 1 && Math.abs(((c.y / 32) | 0) - 10) <= 1, 'in formation at the station'); }
});

test('a squad drills on its schedule at a training yard, gains XP and becomes Drilled after 3 drills', () => {
  const s = colony('MIL-TR');
  built(s, 'trainingyard', 6, -6);
  const sq = squadOf(s, 1, 2);
  const mel0 = sq.map((c) => c.sk[10][0] * 1e6 + c.sk[10][1]);
  assert.ok(D.squadCmd(s, { id: 1, sched: [10, 10, 10, 10], uniform: { weapon: null } }).ok);
  step(s, H1);
  assert.ok(sq.every((c) => !c.drafted), 'no Marshal, no drill');
  const marshal = able(s).find((c) => !c.squad);
  s.colony.offices = { marshal: marshal.id };   // K's offices.js record (Z2.2)
  assert.ok(!D.squadDrilled(s, 1));
  step(s, 3 * TICKS_PER_DAY + 2 * H1);
  console.log(`# training: ${D.drillsThisSeason(s, 1)} drills in 3 days; melee ${mel0.join(',')} -> ${sq.map((c) => c.sk[10][0] * 1e6 + c.sk[10][1]).join(',')}`);
  assert.ok(D.drillsThisSeason(s, 1) >= 3);
  assert.ok(D.squadDrilled(s, 1));
  sq.forEach((c, k) => assert.ok(c.sk[10][0] * 1e6 + c.sk[10][1] > mel0[k], 'melee XP gained'));
  // with the Marshal gone, no training is scheduled
  s.colony.offices = {};
  step(s, H1);
  for (const c of sq) assert.ok(!c.drafted || c.job.by !== 'mil' || c.job.order !== 'train');
});

test('Shelter sends civilians to the refuge until Peace; saves mid-muster continue identically', () => {
  const s = colony('MIL-SH');
  squadOf(s, 1, 1);
  D.setAlert(s, 'shelter');
  step(s, 100);
  const civ = able(s).filter((c) => !c.squad);
  assert.ok(civ.length >= 1);
  for (const c of civ) assert.ok(c.drafted && c.job && c.job.order === 'retreat', 'civilians shelter');
  D.squadCmd(s, { id: 1, uniform: { helm: ['any', 0, null] } });
  const a = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(a.colony.mil, s.colony.mil, 'the military record is saved');
  step(s, 2000); step(a, 2000);
  assert.equal(stateHash(a), stateHash(s), 'a load mid-shelter continues identically');
  D.setAlert(s, 'peace');
  step(s, 40);
  for (const c of civ) assert.ok(!c.drafted, 'peace sends them back to work');
});

test('the squad command checks slots and numbers; a hold with no military record is untouched', () => {
  const s = colony('MIL-CMD');
  const c = able(s)[0];
  assert.equal(D.squadCmd(s, { id: 5 }).ok, false, 'squad 5 needs a War Room');
  assert.equal(D.squadCmd(s, { id: 1, add: [c.id], uniform: { helm: ['spear', 0, null] } }).ok, false, 'a spear is no helm');
  const t = foundColony({ seed: 'MIL-NONE', name: 'Quiet' });
  step(t, 2 * H1);
  assert.equal(t.colony.mil, undefined, 'no military record appears by itself');
});
