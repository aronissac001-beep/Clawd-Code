// Workstream F, Stage Z2 step Z2.1 (EMBERCROWN-FORTRESS.md 8.4): people. Personalities, preferences, life goals and
// memories (3.2), the seizures of craft (3.3), teaching (3.1), Sweltering and Heatstroke (2.6).
// Oracle (scripted here): a liked-granite colonist in a granite Fine room gets +4; a Brooding colonist met with a
// token makes a memorial. (Bot targets: 2-4 artifacts by day 200 on 4 of 5 seeds, average mood > 45 at day 100.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step, tick } from '../../js/game/core/sim.js';
import { FIX, SKILL_IDS, WORK_IDS, SCHED } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON } from '../../js/game/core/time.js';
import { stateHash } from '../../js/game/core/state.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { tickSystems } from '../../js/game/core/bus.js';
import { idx } from '../../js/game/core/grid.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn } from '../../js/game/work/items.js';
import { rebuildFromJobs } from '../../js/game/work/reserve.js';
import { roomInfoAt } from '../../js/game/world/rooms.js';
import { CONTENT } from '../../js/data/index.js';
import { DATA as THOUGHTS } from '../../js/data/thoughts.js';
import { PREF_POOLS, GOALS, MEMORY_OF, FACETS, VALUES } from '../../js/data/personality.js';
import { BROODING_DEMAND, WHISPER_TAKES, MEMORIAL_KIND, GREY_KIND } from '../../js/data/seizures.js';
import { COL_DEEDS } from '../../js/data/deeds-col.js';
import * as P from '../../js/game/people/personality.js';
import * as SZ from '../../js/game/people/seizures.js';
import { mood, social, perks } from '../../js/game/people/index.js';
import { setKind, addOpinion } from '../../js/game/people/social.js';
import { kill } from '../../js/game/people/health.js';
import { peopleRec } from '../../js/game/people/peoplerec.js';

const sk = (id) => SKILL_IDS.indexOf(id);
function colony(seed = 'F-Z2') {
  installSim({ stage: '2', reset: true, checks: true });
  const s = foundColony({ seed, name: 'F Hold' });
  // run the Z2 seizures in the 'embertouch' tick slot (people/embertouch.js re-exports seizures.js once F's
  // one-line request lands; until then this test puts them there itself)
  const e = tickSystems().find((x) => x.name === 'embertouch');
  if (e) e.fn = SZ.emberSystem;
  return s;
}
const stopAll = (s) => { for (const c of s.col) { c.custom = true; c.prio = new Uint8Array(WORK_IDS.length); c.job = null; } s.rt.res = rebuildFromJobs(s); };
const hearth = (s) => s.bld[s.colony.hearth.id];
function built(s, defId, dx = 4, dy = 4, mat = null) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const at = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 1);
  const b = addBuilding(s, defId, at[0], at[1], 0, mat);
  completeBuilding(s, b);
  return b;
}
function calm(s, n, until = () => false) {
  for (let k = 0; k < n; k++) { if (s.tick % 600 === 0) s.st.queue.length = 0; tick(s); if (until()) return true; }
  return false;
}
const value = (c, id) => { const t = c.thoughts.find((x) => x[0] === id); return t ? mood.thoughtValue(t) / FIX : null; };

// ---- data ----------------------------------------------------------------------------------------------------
test('Z2.1 data: every preference, goal, memory and seizure id names real content', () => {
  const kinds = { material: 'material', gem: 'material', food: 'item', drink: 'item', item: 'item', creature: 'animal', dislikeFood: 'item', dislikeCreature: 'animal' };
  for (const [pool, rows] of Object.entries(PREF_POOLS)) for (const [id] of rows) {
    const k = kinds[pool];
    const ok = CONTENT.get(k, id) || (pool === 'item' && CONTENT.get('structure', id));
    assert.ok(ok, `${pool}: ${id} is a ${k}`);
  }
  for (const g of GOALS) if (g.test.deed) assert.ok(COL_DEEDS.some((d) => d.id === g.test.deed), g.id);
  const tid = new Set(THOUGHTS.thought.map((t) => t.id));
  for (const [a, b] of Object.entries(MEMORY_OF)) { assert.ok(tid.has(a), a); assert.ok(tid.has(b), b); }
  assert.equal(Object.keys(MEMORY_OF).length, 12, 'the 12 strongest event thoughts leave memories');
  for (const id of ['admired_material', 'admired_material_fine', 'sweltering', 'sweltering2', 'heatstroke', 'brooding', 'melancholy', 'memorial_raised', 'goal_met', 'life_unfinished', 'overworked'])
    assert.ok(tid.has(id), id);
  for (const tbl of Object.values(BROODING_DEMAND)) for (const key of Object.keys(tbl)) { const [k, m] = key.split(':'); assert.ok(CONTENT.get('item', k), key); if (m) assert.ok(CONTENT.get('material', m), key); }
  for (const k of WHISPER_TAKES) assert.ok(CONTENT.get('item', k), k);
  for (const k of [...Object.values(MEMORIAL_KIND), ...Object.values(GREY_KIND)]) assert.ok(CONTENT.get('item', k), k);
});

// ---- personality ------------------------------------------------------------------------------------------------
test('personality: generated from the seed and id alone, in range, and written once the sim reaches it', () => {
  const s = colony();
  const c = s.col[0];
  const a = P.genPsy(s, c), b = P.genPsy(s, c);
  assert.deepEqual(a, b, 'pure');
  assert.equal(a.f.length, FACETS.length); assert.equal(a.v.length, VALUES.length);
  for (const f of a.f) assert.ok(f >= -3 && f <= 3);
  for (const v of a.v) assert.ok(v >= -2 && v <= 2);
  assert.equal(a.p.length, 6); assert.equal(a.p[5][0], 'dislike');
  assert.ok(GOALS.some((g) => g.id === a.g));
  assert.ok(!peopleRec(s).psy, 'nothing written before the first Z2 day');
  assert.deepEqual(P.psyOf(s, c).f, a.f, 'UI reads the generated record');
  // a spread over many colonists: not all the same
  const fs = new Set();
  for (let id = 1; id < 60; id++) fs.add(P.genPsy(s, { ...c, id }).f.join(','));
  assert.ok(fs.size > 30, `${fs.size} distinct facet sets`);
  calm(s, TICKS_PER_DAY + 61);
  assert.equal(peopleRec(s).psy.length, s.col.filter((x) => !x.hp.dead).length, 'every colonist recorded on the first day');
  assert.ok(P.describe(s, c).every((t) => typeof t === 'string' && t.length));
});
test('personality: a save carries the records, memories and goals, and continues identically', () => {
  const s = colony('F-Z2-SAVE');
  calm(s, TICKS_PER_DAY + 61);
  P.remember(s, P.ensurePsy(s, s.col[1]), 'friend_died', 12);
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(peopleRec(s2).psy, peopleRec(s).psy);
  step(s, TICKS_PER_DAY); step(s2, TICKS_PER_DAY);
  assert.equal(stateHash(s2), stateHash(s));
});

// ---- preferences (oracle) -----------------------------------------------------------------------------------------
function graniteRoom(s) {
  const hb = hearth(s), z = hb.z | 0;
  const [x0, y0] = findSite(s, hb.x + 6, hb.y + 6, 7, 7, 1);
  for (let x = x0; x < x0 + 7; x++) for (let y = y0; y < y0 + 7; y++) {
    if (x === x0 || y === y0 || x === x0 + 6 || y === y0 + 6) completeBuilding(s, addBuilding(s, 'wall', x, y, 0, 'granite'));
  }
  for (const [dx, dy, d] of [[1, 1, 'statue'], [5, 1, 'statue'], [3, 1, 'statue'], [1, 4, 'bed']]) { const b = addBuilding(s, d, x0 + dx, y0 + dy, 0, 'granite'); b.q = 6; completeBuilding(s, b); }
  for (let k = 0; k < 3; k++) tick(s);
  return { i: idx(x0 + 3, y0 + 3, z), x: x0 + 3, y: y0 + 3 };
}
test('oracle: a liked-granite colonist in a granite Fine room gets +4 ("Admired the fine work here")', () => {
  const s = colony();
  stopAll(s);
  const room = graniteRoom(s);
  const info = roomInfoAt(s, room.i);
  assert.ok(info && info.tierIdx >= 3, `a Fine room (${info && info.tier})`);
  assert.ok(P.roomMaterials(s, info.id).includes('granite'));
  const [c, d] = s.col;
  for (const col of [c, d]) { col.x = room.x * 32 + 16; col.y = room.y * 32 + 16; }
  P.setPsy(s, c, { f: [0, 0, 0, 0, 0, 0], p: [['material', 'granite'], ['gem', 'amber'], ['food', 'bread'], ['drink', 'ale'], ['creature', 'hen'], ['dislike', 'spider']] });
  P.setPsy(s, d, { f: [0, 0, 0, 0, 0, 0], p: [['material', 'marble'], ['gem', 'ruby'], ['food', 'bread'], ['drink', 'ale'], ['creature', 'hen'], ['dislike', 'spider']] });
  P.personalityHour(s, c); P.personalityHour(s, d);
  assert.equal(value(c, 'admired_material_fine'), 4, '+4 in a Fine room');
  assert.equal(mood.thoughtValueFor(s, c, c.thoughts.find((t) => t[0] === 'admired_material_fine')), 4 * FIX);
  assert.equal(value(d, 'admired_material_fine'), null, 'a marble-lover feels nothing');
  // Fancy scales room thoughts: +3 Fancy is x1.6
  P.setPsy(s, d, { f: [0, 0, 0, 0, 3, 0] });
  mood.addThought(s, d, 'bedroom_t3');
  assert.equal(mood.thoughtValueFor(s, d, d.thoughts.find((t) => t[0] === 'bedroom_t3')), Math.trunc((4 * FIX * 160) / 100));
  // a value of +2 doubles its thoughts, -2 halves
  P.setPsy(s, d, { v: [0, 2, 0, -2] });
  mood.addThought(s, d, 'married'); mood.addThought(s, d, 'raid_repelled');
  assert.equal(mood.thoughtValueFor(s, d, d.thoughts.find((t) => t[0] === 'married')), 24 * FIX);
  assert.equal(mood.thoughtValueFor(s, d, d.thoughts.find((t) => t[0] === 'raid_repelled')), 3 * FIX);
});
test('preferences: a favourite dish, a loathed creature; Sociability scales chats; Diligence and Overworked', () => {
  const s = colony();
  stopAll(s);
  const c = s.col[0];
  P.setPsy(s, c, { f: [-2, 0, 0, -3, 0, 0], p: [['material', 'granite'], ['gem', 'amber'], ['food', 'berries'], ['drink', 'ale'], ['creature', 'hen'], ['dislike', 'spider']] });
  c.job = { type: 'eat', carry: { k: 'berries', n: 1 } };
  mood.addThought(s, c, 'ate_raw');
  assert.equal(value(c, 'ate_favourite'), 3);
  c.job = null;
  assert.equal(P.chatPct(s, c), 70);
  P.personalityHour(s, c);
  assert.ok(mood.hasThought(c, 'overworked'), 'Diligence -3 tolerates 11 h; the default day is 12');
  assert.equal(P.longestShift(c.sched), 12);
  mood.addThought(s, c, 'lonely');
  P.personalityHour(s, c);
  assert.ok(!mood.hasThought(c, 'lonely'), 'never Lonely at Sociability -2');
});

// ---- memories and life goals -------------------------------------------------------------------------------------
test('memories: a friend\'s death leaves one; each season it may recur at half value and fades by 1', () => {
  const s = colony();
  stopAll(s);
  const c = s.col[0];
  mood.addThought(s, c, 'friend_died');
  const p = P.ensurePsy(s, c);
  assert.deepEqual(p.m.map((m) => [m[0], m[3]]), [['friend_died', 12]]);
  for (let k = 0; k < 10; k++) P.remember(s, p, 'raid_repelled', 1 + k);
  assert.equal(p.m.length, 8, 'at most 8');
  assert.ok(p.m.some((m) => m[0] === 'friend_died'), 'the strongest stays');
  P.recur(s, c, 'rem_grief', 6);
  assert.equal(value(c, 'rem_grief'), -6, 'half of -12');
  // the season step: everyone's memories fade by one
  p.m = [['friend_died', 0, 0, 12]];
  s.tick = DAYS_PER_SEASON * TICKS_PER_DAY;
  P.personalityDay(s);
  assert.deepEqual(P.psyOf(s, c).m.map((m) => m[3]), [11]);
});
test('life goals: met once, "Lived to see it" for a year then lasting; never met by 70, "A life unfinished"', () => {
  const s = colony();
  stopAll(s);
  const [c, d] = s.col;
  P.setPsy(s, c, { g: 'master', gm: -1 });
  P.setPsy(s, d, { g: 'great_beast', gm: -1 });
  c.sk[sk('mining')][0] = 15;
  d.age = 70;
  P.personalityDay(s);
  P.personalityHour(s, c); P.personalityHour(s, d);
  assert.ok(P.psyOf(s, c).gm >= 0 && mood.hasThought(c, 'goal_met'));
  assert.ok(s.chron.some((e) => e[2] === 'chron_life_goal'));
  assert.ok(mood.hasThought(d, 'life_unfinished'));
  s.tick += 41 * TICKS_PER_DAY;
  P.personalityHour(s, c);
  assert.ok(!mood.hasThought(c, 'goal_met') && mood.hasThought(c, 'goal_met_lasting'));
  assert.equal(P.goalLine(s, c).met, true);
});

// ---- heat (2.6) and teaching (3.1) --------------------------------------------------------------------------------
test('heat: Sweltering above 35 C, worse above 45, Heatstroke after 2 h above 50 (work x0.7)', () => {
  const s = colony();
  const c = s.col[0];
  P.heatConditions(s, c, 40, 60);
  assert.ok(mood.hasThought(c, 'sweltering'));
  for (let k = 0; k < 2 * TICKS_PER_HOUR / 60; k++) P.heatConditions(s, c, 55, 60);
  assert.ok(mood.hasThought(c, 'sweltering2') && mood.hasThought(c, 'heatstroke'));
  assert.equal(P.heatWorkPct(c), 70);
  for (let k = 0; k < 2 * TICKS_PER_HOUR / 60; k++) P.heatConditions(s, c, 20, 60);
  assert.ok(!mood.hasThought(c, 'heatstroke') && !mood.hasThought(c, 'sweltering'));
});
test('teaching: within 3 tiles of a Master of the same skill, x1.25 and one "Learned from" line a day', () => {
  const s = colony();
  const [a, b] = s.col;
  b.sk[sk('masonry')][0] = 16; a.sk[sk('masonry')][0] = 3;
  b.x = a.x + 64; b.y = a.y; b.z = a.z;
  assert.equal(perks.teachPct(s, a, 'masonry'), 125);
  assert.equal(perks.teachPct(s, b, 'masonry'), 100, 'the master learns nothing from themselves');
  assert.equal(perks.teachPct(s, a, 'mining'), 100);
  const n = a.log.length;
  perks.teachPct(s, a, 'masonry');
  assert.equal(a.log.length, n, 'one line a day');
  b.x = a.x + 5 * 32;
  assert.equal(perks.teachPct(s, a, 'masonry'), 100, 'too far');
});

// ---- seizures of craft (3.3) --------------------------------------------------------------------------------------
function griefScene(seed = 'F-Z2-BROOD') {
  const s = colony(seed);
  stopAll(s);
  const [c, dead, friend] = s.col;
  c.sk[sk('masonry')][0] = 6;
  c.custom = false; c.prio = new Uint8Array(WORK_IDS.length).fill(3);
  const bench = built(s, 'mason', 5, 2);
  addOpinion(s, c.id, dead.id, 60);
  addOpinion(s, friend.id, dead.id, 60);
  const hb = hearth(s);
  const keep = spawn(s, 'figurine', null, 3, 1, hb.x - 3, hb.y + 5, { maker: dead.id });
  dead.hp.turned = true;   // no corpse to rise as a Husk in these scenes (the grief is the same)
  kill(s, dead, 'cut', null);
  return { s, c, dead, friend, bench, keep };
}
test('oracle: a Brooding colonist met with a token of the dead makes a memorial ("in memory of")', () => {
  const { s, c, dead, friend, bench } = griefScene();
  assert.equal(SZ.griefOf(s, c), dead);
  const em = SZ.startBrooding(s, c);
  assert.equal(em.kind, 'brooding'); assert.equal(em.bench, bench.id);
  assert.ok(em.demand.some((d) => d[0] === 'token' && d[1] === dead.id), 'a token of the dead');
  assert.ok(em.demand.length >= 2 && em.demand.length <= 4, '1-3 materials and the token');
  assert.equal(SZ.demandCard(s).find((r) => r.k === 'token').ok, true, 'the figurine they made serves');
  const hb = hearth(s);
  for (const [k, m, n] of em.demand) if (k !== 'token') spawn(s, k, m, 0, n, hb.x - 4, hb.y + 4);
  let art = null;
  calm(s, 4 * TICKS_PER_DAY, () => !!(art = s.items.find((it) => it && it.maker === c.id && it.name && /in memory of/.test(it.name)) || null));
  assert.ok(art, 'a memorial artifact');
  assert.ok(art.name.includes(String(dead.name).split(' ')[0]), art.name);
  assert.ok(SZ.memorialFor(s, dead.id));
  assert.ok(mood.hasThought(c, 'memorial_made'));
  assert.ok(mood.hasThought(friend, 'memorial_raised'), 'friends of the dead +6');
  assert.equal(s.colony.ember, null);
  assert.equal(peopleRec(s).seizeN | 0, 0, 'memorials do not count against the pace');
});
test('Brooding unmet: Melancholy until a memorial is raised', () => {
  const { s, c, dead, keep } = griefScene('F-Z2-BROOD');
  s.items[keep].f = true;   // forbid the token
  SZ.startBrooding(s, c).demand.unshift(['ingot', 'gold', 50]);   // and ask for what the hold cannot give
  calm(s, 6 * TICKS_PER_DAY, () => s.colony.ember === null);
  assert.ok(mood.hasThought(c, 'melancholy'));
  SZ.recordMemorial(s, 1e6 + 1, dead.id);
  assert.ok(!mood.hasThought(c, 'melancholy'));
});
test('Hollow-whispered: takes what it wants and makes a grey artifact; drafted mid-work, Grey-raging', () => {
  const { s, c } = griefScene('F-Z2-GREY');
  const hb = hearth(s);
  spawn(s, 'block', 'granite', 0, 30, hb.x - 4, hb.y + 4);
  const em = SZ.startWhispered(s, c);
  assert.equal(em.kind, 'whispered');
  let art = null;
  calm(s, 4 * TICKS_PER_DAY, () => !!(art = s.items.find((it) => it && it.maker === c.id && it.q === 5 && it.name) || null));
  assert.ok(art, 'a grey artifact');
  assert.equal(peopleRec(s).seizeN, 1);
  assert.deepEqual(peopleRec(s).grey.map((g) => g[0]), [art.id]);
  // interrupted
  SZ.startWhispered(s, c);
  s.colony.ember.met = s.tick;
  c.drafted = true;
  SZ.emberStep(s);
  assert.equal(s.colony.ember, null);
  assert.ok(c.breakState && c.breakState.sev === 'extreme', `Grey-raging (${c.breakState && c.breakState.id})`);
});
test('pace: max(0, 1 + floor(pop / 5) - artifacts) gates the daily chance; the liked stone joins an Ember demand', () => {
  const s = colony();
  const rec = peopleRec(s);
  const pop = s.col.filter((c) => !c.hp.dead).length;
  s.colony.people = s.colony.people || {};
  s.colony.people.seizeN = 1 + Math.floor(pop / 5);
  assert.equal(SZ.paceFactor(s), 0);
  s.colony.people.seizeN = 0;
  assert.equal(SZ.paceFactor(s), 1 + Math.floor(pop / 5));
  const c = s.col[0];
  P.setPsy(s, c, { p: [['material', 'granite'], ['gem', 'amber'], ['food', 'bread'], ['drink', 'ale'], ['creature', 'hen'], ['dislike', 'spider']] });
  spawn(s, 'block', 'granite', 0, 5, hearth(s).x - 3, hearth(s).y + 3);
  const dem = SZ.rollDemand(s, c, 'masonry');
  assert.ok(dem.some((d) => d[0] === 'block' && d[1] === 'granite'), JSON.stringify(dem));
  assert.ok(rec || true);
});
