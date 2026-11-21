// Step Z2.8 (EMBERCROWN-FORTRESS.md 3.13, 8.4): taverns, temples and libraries, and their visitors. Owner K.
//   node --test tools/tests/visitors.test.mjs
// Oracle (scripted here): a petitioner's yes adds a colonist with an Annals history. (Bot targets: by day 150 a
// tavern and one other hall on 4 of 5 seeds, and >= 2 petitioners accepted: Z2.11's bot v4 builds the halls and
// answers the letters; a scripted 150-day hold below shows the rates.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step, tick } from '../../js/game/core/sim.js';
import { installContent } from '../../js/game/core/content.js';
import { registerSystem, tickSystems } from '../../js/game/core/bus.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { stateHash } from '../../js/game/core/state.js';
import { SKILL_IDS, WORK_IDS } from '../../js/game/core/schema.js';
import { idx } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, dayOf } from '../../js/game/core/time.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { rebuildFromJobs } from '../../js/game/work/reserve.js';
import { spawn } from '../../js/game/work/items.js';
import { roomInfoAt } from '../../js/game/world/rooms.js';
import { generateColonist, spawnColonist } from '../../js/game/people/colonists.js';
import { pendingLetters, answer } from '../../js/game/threat/letters.js';
import { legendOf } from '../../js/game/colony/legends.js';
import { ensureRenown, DOMAINS } from '../../js/game/colony/renown.js';
import { buildRegistry } from '../../js/data/schema.js';
import { ENTRIES, CONTENT } from '../../js/data/index.js';
import { HALLS } from '../../js/data/rooms.js';
import * as DV from '../../js/data/visitors.js';
import * as VS from '../../js/game/colony/visitors.js';

const REG = buildRegistry([...ENTRIES, { path: 'visitors.js', owner: 'G', mod: DV }]);
function colony(seed = 'K-Z28') {
  installSim({ stage: '2', reset: true });
  installContent({ reg: REG });
  VS.installVisitors();
  if (!tickSystems().some((x) => x.name === 'visitors')) registerSystem('colony', 'visitors', VS.visitorsSystem, 137);
  const s = foundColony({ seed, name: 'Hall Hold' });
  for (const c of s.col) { c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); c.job = null; }
  s.rt.res = rebuildFromJobs(s);
  return s;
}
const count = (s, k) => s.items.reduce((n, it) => n + (it && it.k === k ? it.n : 0), 0);
const hearth = (s) => s.bld[s.colony.hearth.id];
function room(s, furn, dx, dy, size = 7) {
  const hb = hearth(s);
  const [x0, y0] = findSite(s, hb.x + dx, hb.y + dy, size, size, 1);
  for (let x = x0; x < x0 + size; x++) for (let y = y0; y < y0 + size; y++) {
    if (x === x0 || y === y0 || x === x0 + size - 1 || y === y0 + size - 1) completeBuilding(s, addBuilding(s, 'wall', x, y, 0, 'granite'));
  }
  const b = [];
  for (const [fx, fy, d, q = 4] of furn) { const o = addBuilding(s, d, x0 + fx, y0 + fy, 0, 'granite'); o.q = q; completeBuilding(s, o); b.push(o); }
  for (let k = 0; k < 3; k++) tick(s);
  return { x0, y0, z: hb.z | 0, i: idx(x0 + 3, y0 + 3, hb.z | 0), b };
}
const tavern = (s) => room(s, [[1, 1, 'statue'], [5, 1, 'statue'], [3, 4, 'dicetable'], [1, 4, 'table']], 6, 6);
const temple = (s) => room(s, [[1, 1, 'statue'], [5, 1, 'statue'], [3, 3, 'shrine']], -14, 6);
const library = (s) => room(s, [[1, 1, 'statue'], [5, 1, 'statue'], [1, 3, 'study'], [5, 4, 'shelf'], [5, 5, 'shelf']], 6, -14);
// drink counts as stock on a storage tile: a row of shelves (3 stacks of 25 each)
function ale(s, n = 20) {
  if (!s._shelves) {
    const hb = hearth(s), [x0, y0] = findSite(s, hb.x - 12, hb.y - 10, 8, 1, 1);
    s._shelves = [];
    for (let k = 0; k < 8; k++) { const b = addBuilding(s, 'shelf', x0 + k, y0, 0, 'granite'); completeBuilding(s, b); s._shelves.push(b); }
  }
  for (const b of s._shelves) {
    while (n > 0 && s.items.filter((it) => it && it.x === b.x && it.y === b.y).length < 3) { const m = Math.min(25, n); spawn(s, 'ale', null, 2, m, b.x, b.y); n -= m; }
  }
  for (let k = 0; k < 2; k++) tick(s);
}
const atDay = (s, d = 1) => { s.tick = (Math.floor(s.tick / TICKS_PER_DAY) + d) * TICKS_PER_DAY + DV.VISITS.hour * TICKS_PER_HOUR; VS.visitorsSystem(s); };
/** A visitor who will ask (petitionRoll); the others go home at once. */
function asker(s, first, kind) {
  for (let k = 0; k < 50; k++) {
    const v = VS.arrive(s, 'tavern', first, kind);
    if (VS.petitionRoll(s, v)) { v.leave = v.day + 9; return v; }
    s.colony.visitors.splice(s.colony.visitors.indexOf(v), 1);
  }
  throw new Error('no asker');
}
const known = (s, ...ids) => { const r = ensureRenown(s); r.known = ids.slice(); };

test('Z2.8 data: visitor kinds, halls and words name real content', () => {
  assert.deepEqual(REG.errors, []);
  for (const k of DV.VISITOR_KINDS) {
    assert.ok(SKILL_IDS.includes(k.skill), k.id);
    assert.ok(DOMAINS.includes(k.domain), k.id);
    assert.ok(HALLS.some((h) => h.id === k.hall), k.id);
    assert.ok(k.pay[0] <= k.pay[1]);
  }
  for (const h of HALLS) for (const g of h.has) assert.ok(g.some((d) => CONTENT.get('structure', d)), `${h.id}: one of ${g} exists`);
  for (const h of HALLS) assert.ok(DV.VISITOR_KINDS.some((k) => k.hall === h.id), `${h.id} draws someone`);
  for (const id of Object.keys(DV.SKILL_DOMAIN)) assert.ok(SKILL_IDS.includes(id) && DOMAINS.includes(DV.SKILL_DOMAIN[id]), id);
  for (const id of ['revelry', 'read_quietly', 'prayed']) assert.ok(REG.get('thought', id), id);
  for (const id of ['chron_visitor', 'chron_visitor_left', 'chron_petition', 'chron_book']) assert.ok(REG.get('text', id), id);
});

test('halls: a tavern needs a game, a table and drink; a temple an altar; a library a desk and 5 shelved books', () => {
  const s = colony();
  const t = tavern(s), te = temple(s), l = library(s);
  assert.equal(VS.hallsOf(s).filter((h) => h.id === 'tavern').length, 0, 'no drink: no tavern');
  assert.equal(VS.hallNeed(s, HALLS[0], roomInfoAt(s, t.i)), 'drink');
  ale(s);
  for (let k = 0; k < 3; k++) spawn(s, 'book', null, 2, 1, l.b[3].x, l.b[3].y);
  assert.equal(VS.hallNeed(s, HALLS[2], roomInfoAt(s, l.i)), 'books');
  for (let k = 0; k < 2; k++) spawn(s, 'book', null, 2, 1, l.b[4].x, l.b[4].y);
  tick(s);
  assert.equal(VS.shelvedBooks(s, roomInfoAt(s, l.i).id), 5);
  const ids = VS.hallsOf(s).map((h) => h.id).sort();
  assert.deepEqual(ids, ['library', 'tavern', 'temple'], `${ids}`);
  assert.ok(DV.POWERS.includes(VS.altarPower(s, te.b[2].id)), 'the altar is raised to a power of the vale');
  const v = VS.hallsView(s);
  assert.deepEqual(v.map((x) => x.count), [1, 1, 1]);
});

test('visitors come to a hall, pay, drink, take part in its joy and go on their way', () => {
  const s = colony('K-Z28-visit');
  const t = tavern(s); ale(s, 25);
  const coins0 = count(s, 'coins');
  let k = 0;
  while (!VS.visitorsOf(s).length && k++ < 40) atDay(s);
  const v = VS.visitorsOf(s)[0];
  assert.ok(v, `a visitor within ${k} days`);
  assert.equal(v.hall, 'tavern'); assert.equal(v.entry, 'edge');
  assert.ok(!s.col.some((c) => c.id === v.id), 'not a colonist');
  assert.ok(legendOf(s, 'v' + v.id.toString(36)), 'an Annals visitor record');
  assert.ok(s.chron.some((e) => e[2] === 'chron_visitor'));
  const stock0 = s.rt.stock.ale | 0;
  atDay(s);
  assert.ok(count(s, 'coins') > coins0, 'they pay');
  tick(s);
  assert.ok((s.rt.stock.ale | 0) < stock0, 'they drink');
  // joy: a colonist in the tavern
  const c = s.col[0];
  c.x = (t.x0 + 3) * 32 + 16; c.y = (t.y0 + 2) * 32 + 16;
  s.tick = Math.floor(s.tick / TICKS_PER_HOUR + 1) * TICKS_PER_HOUR; VS.hallJoy(s);
  assert.ok(c.thoughts.some((x) => x[0] === 'revelry'), 'revelry');
  // nobody known for trade and no renown: no petition; they leave after their stay
  for (let d = 0; d < 12 && VS.visitorById(s, v.id); d++) atDay(s);
  assert.equal(VS.visitorById(s, v.id), null, 'gone');
  assert.equal(pendingLetters(s).filter((l) => l.data.k === 'petition').length, 0);
  assert.ok(s.chron.some((e) => e[2] === 'chron_visitor_left'));
});

test('oracle: a petitioner\'s yes adds a colonist with an Annals history; a no leaves them a visitor', () => {
  const s = colony('K-Z28-pet');
  const t = tavern(s); ale(s, 25);
  atDay(s, 0);
  known(s, 'trade');
  const first = VS.hallsOf(s)[0].first;
  const v = asker(s, first, 'traveller');
  const n0 = s.col.length;
  for (let d = 0; d < DV.VISITS.petitionDays; d++) atDay(s);
  const l = pendingLetters(s).find((x) => x.data.k === 'petition' && x.data.visitorId === v.id);
  assert.ok(l, 'asks to stay after 5 days');
  assert.match(l.text, new RegExp(v.name));
  assert.deepEqual(l.choices, DV.WORDS.petitionChoices);
  assert.equal(answer(s, l, 0), null);
  assert.equal(s.col.length, n0 + 1);
  const c = s.col.find((x) => x.id === v.id);
  assert.ok(c && c.name === v.name, 'the visitor is a colonist, same id and name');
  assert.ok(c.sk[SKILL_IDS.indexOf('social')][0] >= DV.VISITS.minSkill);
  const rec = legendOf(s, 'c' + c.id.toString(36));
  assert.ok(rec && rec.links.includes('v' + v.id.toString(36)), 'linked to the visitor record');
  assert.ok(rec.text && rec.text.length > 20, `a history: ${rec.text}`);
  assert.ok(s.legend.split(' ').some((r) => r[0] === 'J' && r.includes('c' + c.id.toString(36))), 'a petition event');
  assert.equal(VS.visitRec(s).accepted, 1);
  assert.equal(VS.visitorById(s, v.id), null);
  // a no
  const w = asker(s, first, 'traveller');
  for (let d = 0; d < DV.VISITS.petitionDays; d++) atDay(s);
  const l2 = pendingLetters(s).find((x) => x.data.visitorId === w.id);
  assert.ok(l2);
  answer(s, l2, 1);
  assert.ok(!s.col.some((x) => x.id === w.id));
  assert.equal(VS.visitorById(s, w.id).asked, -2, 'stays a visitor until they go');
  // unmatched renown: a bard (lore) at a hold known only for arms does not ask
  known(s, 'arms');
  const b = asker(s, first, 'bard');
  b.plain.sk = b.plain.sk.map((x, i) => (SKILL_IDS[i] === 'art' ? [12, 0, 0, 0] : [0, 0, 0, 0]));
  for (let d = 0; d < DV.VISITS.petitionDays + 1; d++) atDay(s);
  assert.ok(!pendingLetters(s).some((x) => x.data.visitorId === b.id), 'no match, no petition');
});

test('a scholar writes a book named for a legend and teaches; a save with visitors continues identically', () => {
  const s = colony('K-Z28-lib');
  const l = library(s);
  for (let k = 0; k < 3; k++) spawn(s, 'book', null, 2, 1, l.b[3].x, l.b[3].y);
  for (let k = 0; k < 2; k++) spawn(s, 'book', null, 2, 1, l.b[4].x, l.b[4].y);
  tick(s);
  atDay(s, 0);
  const first = VS.hallsOf(s).find((h) => h.id === 'library').first;
  const v = VS.arrive(s, 'library', first, 'scholar');
  const books0 = count(s, 'book');
  for (let d = 0; d < DV.VISITS.scholarBookDay; d++) atDay(s);
  tick(s);
  assert.ok(v.book, 'wrote a book');
  assert.equal(count(s, 'book'), books0 + 1);
  const named = s.items.find((it) => it && it.k === 'book' && /^The Book of /.test(it.name || ''));
  assert.ok(named, 'named for a legend record');
  console.log(`# ${named.name}`);
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(s2.colony.visitors, s.colony.visitors);
  step(s, TICKS_PER_DAY); step(s2, TICKS_PER_DAY);
  assert.equal(stateHash(s2), stateHash(s));
});

test('scripted hold: a tavern and a temple draw visitors over 150 days and >= 2 petitioners are accepted', () => {
  const s = colony('K-Z28-150');
  tavern(s); temple(s); ale(s, 150);
  known(s, 'trade', 'growing');
  let asked = 0;
  for (let d = 0; d < 150; d++) {
    atDay(s);
    for (const l of pendingLetters(s)) if (l.data.k === 'petition') { asked++; answer(s, l, 0); }
    if ((s.rt.stock.ale | 0) < 20) ale(s, 150);
  }
  const r = VS.visitRec(s);
  console.log(`# 150 days: ${r.came} came, ${asked} asked, ${r.accepted} accepted, ${r.left} left`);
  assert.ok(r.came >= 10, `${r.came} visitors`);
  assert.ok(r.accepted >= 2, `${r.accepted} accepted`);
});
