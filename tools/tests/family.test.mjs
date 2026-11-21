// Step Z2.8 (EMBERCROWN-FORTRESS.md 3.13, 8.4): births, children and teens. Owner F.
//   node --test tools/tests/family.test.mjs
// Oracle (scripted here): a child is born to a Fine-bedroom couple; a teen works at half speed; the population
// stays under the hard cap at day 300 (children at one half). Births are on by default and can be turned off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step, tick } from '../../js/game/core/sim.js';
import { installContent } from '../../js/game/core/content.js';
import { registerSystem, tickSystems } from '../../js/game/core/bus.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { stateHash } from '../../js/game/core/state.js';
import { WORK_IDS, SKILL_IDS } from '../../js/game/core/schema.js';
import { idx } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON } from '../../js/game/core/time.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { workHooks } from '../../js/game/work/jobs.js';
import { rebuildFromJobs } from '../../js/game/work/reserve.js';
import { spawn } from '../../js/game/work/items.js';
import { roomInfoAt } from '../../js/game/world/rooms.js';
import { generateColonist, spawnColonist } from '../../js/game/people/colonists.js';
import { setKind, kindOf } from '../../js/game/people/social.js';
import { kill } from '../../js/game/people/health.js';
import { workSpeed } from '../../js/game/people/skills.js';
import { psyOf } from '../../js/game/people/personality.js';
import { legendOf } from '../../js/game/colony/legends.js';
import { buildRegistry } from '../../js/data/schema.js';
import { ENTRIES, CONTENT } from '../../js/data/index.js';
import { CAPS } from '../../js/data/balance.js';
import * as DV from '../../js/data/visitors.js';
import * as FM from '../../js/game/people/family.js';

const REG = buildRegistry([...ENTRIES, { path: 'visitors.js', owner: 'G', mod: DV }]);
const SEASON = DAYS_PER_SEASON * TICKS_PER_DAY;
function colony(seed = 'F-Z28') {
  installSim({ stage: '2', reset: true });
  installContent({ reg: REG });
  FM.installFamily();
  if (!tickSystems().some((x) => x.name === 'family')) registerSystem('social', 'family', FM.familySystem, 30);
  const s = foundColony({ seed, name: 'Kin Hold' });
  const hb = hearth(s);
  while (s.col.length < 5) spawnColonist(s, generateColonist(s), hb.x, hb.y + 2);
  return s;
}
const hearth = (s) => s.bld[s.colony.hearth.id];
const stopAll = (s) => { for (const c of s.col) { c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); c.job = null; } s.rt.res = rebuildFromJobs(s); };
/** A walled granite room (size x size) with furniture [[dx, dy, def]]; statues at q 6 make it fine. */
function room(s, furn, size = 7, dx = 6, dy = 6) {
  const hb = hearth(s);
  const [x0, y0] = findSite(s, hb.x + dx, hb.y + dy, size, size, 1);
  for (let x = x0; x < x0 + size; x++) for (let y = y0; y < y0 + size; y++) {
    if (x === x0 || y === y0 || x === x0 + size - 1 || y === y0 + size - 1) completeBuilding(s, addBuilding(s, 'wall', x, y, 0, 'granite'));
  }
  const out = [];
  for (const [fx, fy, d, q = 6] of furn) { const b = addBuilding(s, d, x0 + fx, y0 + fy, 0, 'granite'); b.q = q; completeBuilding(s, b); out.push(b); }
  for (let k = 0; k < 3; k++) tick(s);
  return { x0, y0, i: idx(x0 + 1, y0 + 1, hb.z | 0), b: out };
}
const fineBed = (s) => room(s, [[1, 1, 'statue'], [3, 1, 'statue'], [5, 1, 'statue'], [1, 4, 'doublebed']]);
const plainBed = (s) => room(s, [[1, 4, 'doublebed', 0]], 7, -14, 6);
function marry(s, a, b, bed) { setKind(s, a.id, b.id, 'spouse'); a.bed = bed.id; b.bed = bed.id; a.age = 26; b.age = 31; }
const atSeason = (s, k = 1) => { s.tick = (Math.floor(s.tick / SEASON) + k) * SEASON + DV.FAMILY.seasonHour * TICKS_PER_HOUR; FM.familySystem(s); };
const feed = (s) => { const hb = hearth(s); spawn(s, 'meal', null, 2, 400, hb.x - 3, hb.y + 3); for (let k = 0; k < 2; k++) tick(s); };

test('Z2.8 data: family thoughts and words register; the nursery role reads cradles', () => {
  assert.deepEqual(REG.errors, []);
  for (const id of ['child_born', 'birth_in_hold', 'child_died', 'lost_child']) assert.ok(REG.get('thought', id), id);
  for (const id of ['chron_birth', 'chron_grown']) assert.ok(REG.get('text', id), id);
  assert.ok(CONTENT.all('room').some((r) => r.id === 'nursery' && r.match.any.includes('cradle')));
  assert.ok(CONTENT.get('structure', 'cradle') && CONTENT.get('structure', 'doublebed'));
  assert.equal(DV.FAMILY.childTo, 12); assert.equal(DV.FAMILY.teenTo, 16); assert.equal(DV.FAMILY.teenPct, 50);
});

test('oracle: a child is born to a couple sharing a Fine bedroom, kin to both, off work', () => {
  const s = colony();
  stopAll(s); feed(s);
  const r = fineBed(s);
  const info = roomInfoAt(s, r.i);
  assert.ok(info && info.role === 'bedroom' && info.tierIdx >= 3, `a Fine bedroom (${info && info.role} ${info && info.tier})`);
  const [a, b] = s.col;
  marry(s, a, b, r.b[3]);
  assert.ok(FM.birthsOn(s), 'births on by default');
  assert.ok(FM.sharedFineBedroom(s, a, b));
  const n0 = s.col.length;
  let k = 0;
  while (s.col.length === n0 && k++ < 20) atSeason(s);
  assert.equal(s.col.length, n0 + 1, `born within ${k} seasons`);
  const c = s.col.find((x) => x.age === 0);
  assert.ok(c, 'a newborn');
  assert.equal(FM.lifeStage(c), 'child');
  assert.equal(kindOf(s, c.id, a.id), 'kin'); assert.equal(kindOf(s, c.id, b.id), 'kin');
  assert.deepEqual(FM.parentsOf(s, c.id).sort(), [a.id, b.id].sort());
  assert.ok(c.prio.every((p) => p === 0) && c.custom, 'a child does no work');
  assert.ok(!FM.canSoldier(c));
  assert.ok(c.sk.every((x) => x[0] === 0), 'no skill levels at birth');
  const bearer = a.age <= b.age ? a : b;
  assert.equal(c.name.split(' ').slice(1).join(' '), bearer.name.split(' ').slice(1).join(' '), 'the bearer\'s family name');
  for (const p of [a, b]) assert.ok(p.thoughts.some((t) => t[0] === 'child_born'), 'parents');
  assert.ok(s.col.filter((x) => x !== a && x !== b && x !== c).every((x) => x.thoughts.some((t) => t[0] === 'birth_in_hold')));
  // facets: each one parent's +-1
  const fc = psyOf(s, c).f, fa = psyOf(s, a).f, fb = psyOf(s, b).f;
  for (let i = 0; i < fc.length; i++) assert.ok(Math.min(Math.abs(fc[i] - fa[i]), Math.abs(fc[i] - fb[i])) <= 1, `facet ${i}`);
  const rec = legendOf(s, 'c' + c.id.toString(36));
  assert.ok(rec && rec.links.includes('c' + a.id.toString(36)), 'Annals: a record linked to the parents');
  assert.ok(s.chron.some((e) => e[2] === 'chron_birth'));
  // light work for the bearer
  assert.equal(FM.familyWorkPct(s, bearer), DV.FAMILY.lightPct);
  s.tick += (DV.FAMILY.lightDays + 1) * TICKS_PER_DAY;
  assert.equal(FM.familyWorkPct(s, bearer), 100, 'light work ends');
  // one child per birthGapDays at most
  const n1 = s.col.length;
  for (let k = 0; k < 3; k++) atSeason(s);
  assert.ok(s.col.length <= n1 + 1, 'no second child within the gap');
});

test('no birth without a Fine bedroom, with births off, or past the hard cap', () => {
  const s = colony('F-Z28-none');
  stopAll(s); feed(s);
  const r = plainBed(s);
  const [a, b, c, d] = s.col;
  marry(s, a, b, r.b[0]);
  assert.ok(!FM.sharedFineBedroom(s, a, b), 'a plain bedroom');
  const f = fineBed(s);
  marry(s, c, d, f.b[3]);
  FM.setBirths(s, false);
  assert.equal(FM.birthPermille(s), 0);
  const n0 = s.col.length;
  for (let k = 0; k < 20; k++) atSeason(s);
  assert.equal(s.col.length, n0, 'births off: none in 20 seasons');
  FM.setBirths(s, true);
  assert.ok(FM.birthPermille(s) > 0);
  // the cap: children count one half
  const hb = hearth(s);
  while (FM.headCount(s) < CAPS.colonistsHard) spawnColonist(s, generateColonist(s), hb.x, hb.y + 2);
  assert.equal(FM.birthPermille(s), 0, 'at the hard cap');
  const last = s.col[s.col.length - 1]; last.age = 3;
  assert.equal(FM.headCount(s), CAPS.colonistsHard - 1, 'a child counts one half (rounded down)');
  assert.ok(FM.birthPermille(s) > 0, 'room for a half');
});

test('oracle: a teen works at half speed and never soldiers; a child is off work until 12', () => {
  const s = colony('F-Z28-teen');
  const [a, ch] = s.col;
  const toil = { sk: 'construction' };
  const base = workSpeed(s, ch, toil);
  assert.ok(workHooks().speed.family, 'the hook wraps workSpeed');
  assert.equal(workHooks().speed(s, ch, toil), base, 'an adult at full speed');
  ch.age = 13;
  assert.equal(FM.lifeStage(ch), 'teen');
  assert.equal(workHooks().speed(s, ch, toil), Math.max(1, Math.floor(base / 2)), 'half speed');
  assert.ok(!FM.canSoldier(ch));
  // a child in the kids list: off work, then back at 12
  ch.age = 11; ch.soldier = true;
  FM.ensureFamily(s).kids.push([ch.id, 0, a.id, -1, 0]);
  FM.familyDay(s);
  assert.ok(ch.prio.every((p) => p === 0) && !ch.soldier);
  ch.age = 12;
  FM.familyDay(s);
  assert.ok(ch.prio.some((p) => p > 0) && !ch.custom, 'the roles come back at 12');
  assert.ok(!ch.soldier);
  ch.age = 16; FM.familyDay(s);
  assert.equal(FM.familyRec(s).kids[0][4], 2);
  assert.ok(s.chron.some((e) => e[2] === 'chron_grown'), 'came of age');
});

test('a child learns by watching (x0.25 of a parent\'s XP); a child\'s death is the hold\'s worst grief', () => {
  const s = colony('F-Z28-xp');
  const [a, b, ch] = s.col;
  ch.age = 6;
  for (const x of ch.sk) { x[0] = 0; x[1] = 0; x[3] = 0; }
  FM.ensureFamily(s).kids.push([ch.id, 0, a.id, b.id, 0]);
  setKind(s, ch.id, a.id, 'kin'); setKind(s, ch.id, b.id, 'kin');
  const si = SKILL_IDS.indexOf('masonry');
  const before = ch.sk[si][1];
  const xp = workHooks().xp;
  for (let t = 0; t < 400; t++) { s.tick++; xp(s, a, 'masonry', 1); }
  const got = ch.sk[si][1] - before;
  assert.ok(got > 0 || ch.sk[si][0] > 0, 'the child learned');
  assert.ok(ch.sk[si][3] >= 80 && ch.sk[si][3] <= 120, `about a quarter of 400 ticks watched (${ch.sk[si][3]})`);
  kill(s, ch, 'cut', null);
  assert.ok(a.thoughts.some((t) => t[0] === 'lost_child') && a.thoughts.some((t) => t[0] === 'kin_died'), 'Kin x2 for a parent');
  const other = s.col.find((x) => x !== a && x !== b && x !== ch && !x.hp.dead);
  assert.ok(other.thoughts.some((t) => t[0] === 'child_died'));
});

test('oracle: 300 days of births with four Fine-bedroom couples stay under the hard cap', () => {
  const s = colony('F-Z28-cap');
  stopAll(s); feed(s);
  const r = room(s, [[1, 1, 'statue'], [3, 1, 'statue'], [5, 1, 'statue'], [7, 1, 'statue'], [9, 1, 'statue'], [9, 3, 'statue'], [9, 5, 'statue'], [9, 7, 'statue'], [9, 9, 'statue'], [5, 9, 'statue'], [1, 4, 'doublebed'], [4, 4, 'doublebed'], [7, 4, 'doublebed'], [1, 7, 'doublebed']], 11);
  const info = roomInfoAt(s, r.i);
  assert.ok(info.role === 'bedroom' && info.tierIdx >= 3, `fine (${info.tier})`);
  const hb = hearth(s);
  while (s.col.length < 8) spawnColonist(s, generateColonist(s), hb.x, hb.y + 2);
  for (let k = 0; k < 4; k++) marry(s, s.col[2 * k], s.col[2 * k + 1], r.b[4 + k]);
  while (s.col.length < 34) spawnColonist(s, generateColonist(s), hb.x, hb.y + 2);
  const start = s.tick, n0 = s.col.length;
  let maxHead = 0;
  for (let day = 1; day <= 300; day++) {
    s.tick = start + day * TICKS_PER_DAY;
    if (day % 40 === 0) for (const c of s.col) if (!c.hp.dead) c.age++;   // a year (health.js birthdays)
    s.tick = Math.floor(s.tick / TICKS_PER_DAY) * TICKS_PER_DAY + DV.FAMILY.dayHour * TICKS_PER_HOUR; FM.familySystem(s);
    s.tick = Math.floor(s.tick / TICKS_PER_DAY) * TICKS_PER_DAY + DV.FAMILY.seasonHour * TICKS_PER_HOUR; FM.familySystem(s);
    maxHead = Math.max(maxHead, FM.headCount(s));
  }
  const born = s.col.length - n0;
  assert.ok(born >= 4, `children born (${born})`);
  assert.ok(maxHead <= CAPS.colonistsHard, `head count ${maxHead} <= ${CAPS.colonistsHard}`);
  console.log(`# 300 days: ${born} born, head count max ${maxHead}, living ${s.col.filter((c) => !c.hp.dead).length}`);
});

test('a save carries the family record and continues identically; old saves gain it on the first day', () => {
  const s = colony('F-Z28-save');
  stopAll(s); feed(s);
  const r = fineBed(s);
  marry(s, s.col[0], s.col[1], r.b[3]);
  assert.equal(s.colony.family, undefined, 'none before the first family step');
  const s0 = loadBlobSync(saveBlobSync(s));
  step(s, TICKS_PER_DAY); step(s0, TICKS_PER_DAY);
  assert.ok(s.colony.family && s.colony.family.on === true);
  assert.equal(stateHash(s0), stateHash(s));
  FM.birth(s, s.col[0], s.col[1]);
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(s2.colony.family, s.colony.family);
  step(s, TICKS_PER_DAY); step(s2, TICKS_PER_DAY);
  assert.equal(stateHash(s2), stateHash(s));
});
