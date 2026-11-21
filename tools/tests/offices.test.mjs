// Step Z2.2 (EMBERCROWN-FORTRESS.md 3.4, 8.4): offices and nobles. Owner K.
//   node --test tools/tests/offices.test.mjs
// Oracle (scripted here): the Steward turns "keep 40 meals" into a kitchen bill; the Thane has the highest summed
// opinion. (Bot targets: a Thane by day 120 and a Lord by day 250 on 3 of 5 seeds, measured by the step's report run.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { installContent } from '../../js/game/core/content.js';
import { registerSystem, tickSystems } from '../../js/game/core/bus.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { stateHash } from '../../js/game/core/state.js';
import { FIX } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON, DAYS_PER_YEAR } from '../../js/game/core/time.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn, recomputeStock } from '../../js/game/work/items.js';
import { grantTech } from '../../js/game/colony/research.js';
import { tierIndex } from '../../js/game/colony/tiers.js';
import { generateColonist, spawnColonist } from '../../js/game/people/colonists.js';
import { addOpinion } from '../../js/game/people/social.js';
import { setPsy } from '../../js/game/people/personality.js';
import { ensurePeople } from '../../js/game/people/peoplerec.js';
import { buildRegistry } from '../../js/data/schema.js';
import { ENTRIES, CONTENT } from '../../js/data/index.js';
import * as DOFF from '../../js/data/offices.js';
import * as O from '../../js/game/colony/offices.js';

// the office thoughts are registered once offices.js is in DATA_FILES (G request); until then, here
const REG = buildRegistry([...ENTRIES, { path: 'offices.js', owner: 'K', mod: DOFF }]);
function colony(seed = 'K-Z22', n = 0) {
  installSim({ stage: '2', reset: true });
  installContent({ reg: REG });
  if (!tickSystems().some((x) => x.name === 'offices')) registerSystem('colony', 'offices', O.officesSystem, 135);
  const s = foundColony({ seed, name: 'Office Hold' });
  while (s.col.length < n) addCol(s);
  return s;
}
function addCol(s) { const h = hearth(s), c = generateColonist(s); spawnColonist(s, c, h.x, h.y + 2); return c; }
const hearth = (s) => s.bld[s.colony.hearth.id];
function built(s, defId, dx = 4, dy = 4, mat = null) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const at = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 1);
  const b = addBuilding(s, defId, at[0], at[1], 0, mat);
  completeBuilding(s, b);
  return b;
}
const atHour = (s, h = 1) => { s.tick = (Math.floor(s.tick / TICKS_PER_HOUR) + h) * TICKS_PER_HOUR; O.officesSystem(s); };
const atDay = (s, d = 1) => { s.tick = (Math.floor(s.tick / TICKS_PER_DAY) + d) * TICKS_PER_DAY; O.officesSystem(s); };
const stack = (c, id) => { const t = c.thoughts.find((x) => x[0] === id); return t ? t[2] : 0; };

test('Z2.2 data: every office need names real structures and room roles, thoughts validate, no Warden row', () => {
  assert.deepEqual(REG.errors, []);
  const roles = new Set(CONTENT.all('room').map((r) => r.id));
  for (const o of DOFF.OFFICES) for (const n of o.needs) assert.ok(DOFF.NEEDS[n], `${o.id}: need ${n}`);
  for (const [id, n] of Object.entries(DOFF.NEEDS)) {
    for (const d of [...(n.build || []), ...((n.room && n.room.has) || []).flat()]) assert.ok(CONTENT.get('structure', d), `${id}: ${d}`);
    if (n.room && n.room.role) assert.ok(roles.has(n.room.role), `${id}: role ${n.room.role}`);
    for (const r of (n.room && n.room.notRole) || []) assert.ok(roles.has(r), `${id}: role ${r}`);
  }
  for (const t of DOFF.DATA.thought) assert.ok(REG.get('thought', t.id), t.id);
  assert.ok(!DOFF.OFFICES.some((o) => o.id === 'warden'), 'the Warden of Law is Z2.12');
  for (const k of DOFF.MANDATE.kinds) assert.ok(CONTENT.get('item', k), k);
  for (const [k, m] of DOFF.KEEP_KINDS) { assert.ok(CONTENT.get('item', k), k); if (m) assert.ok(CONTENT.get('material', m), m); }
  assert.deepEqual(O.APPOINTED, ['steward', 'reckoner', 'marshal', 'healer', 'keeper']);
});

test('appointing: offices open by population; one office a colonist; the Thane and Lord are not appointed', () => {
  const s = colony('K-appoint');
  while (s.col.length > 3) s.col.pop();
  const [a, b] = s.col;
  assert.match(O.appoint(s, 'steward', a.id).reason, /not open/);
  addCol(s);
  assert.equal(O.appoint(s, 'steward', a.id).ok, true);
  assert.equal(O.holderOf(s, 'steward'), a);
  assert.equal(O.officeOf(s, a.id), 'steward');
  assert.match(O.appoint(s, 'thane', b.id).reason, /not appointed/);
  while (s.col.length < 6) addCol(s);
  assert.equal(O.appoint(s, 'reckoner', a.id).ok, true, 'moves');
  assert.equal(O.holderOf(s, 'steward'), null);
  assert.equal(O.officeOf(s, a.id), 'reckoner');
  assert.match(O.appoint(s, 'marshal', b.id).reason, /not open/, 'no squad yet');
  ensurePeople(s).squads.push([1, 'First', null]);
  assert.equal(O.appoint(s, 'marshal', b.id).ok, true);
  assert.equal(O.appoint(s, 'marshal', null).ok, true);
  assert.equal(O.holderOf(s, 'marshal'), null);
  assert.deepEqual(Object.keys(s.colony.offices), ['reckoner'], 'canonical keys');
  // the dead leave their office at the next hour
  a.hp.dead = true;
  atHour(s);
  assert.equal(O.holderOf(s, 'reckoner'), null);
  assert.deepEqual(s.colony.offices, {});
});

test('ORACLE the Steward turns "keep 40 meals" into a kitchen bill (and only with a Steward)', () => {
  const s = colony('K-steward', 5);
  const fire = built(s, 'campfire', 5, 3);
  const before = fire.bills.length;
  assert.equal(O.setStockTarget(s, 'meal', null, 40).ok, true);
  atHour(s);
  assert.equal(fire.bills.length, before, 'without a Steward, only bills');
  assert.equal(O.stewardPlan(s)[0].why, 'no Steward');
  assert.equal(O.appoint(s, 'steward', s.col[0].id).ok, true);
  atHour(s);
  const bill = fire.bills.find((x) => x.steward);
  assert.ok(bill, 'a Steward bill');
  assert.deepEqual([bill.recipe, bill.mode, bill.n, bill.steward], ['simple_meal', 'until', 40, 'meal:']);
  const plan = O.stewardPlan(s)[0];
  assert.deepEqual([plan.bench, plan.benchDef, plan.recipe, plan.why], [fire.id, 'campfire', 'simple_meal', null]);
  atHour(s);
  assert.equal(fire.bills.filter((x) => x.steward).length, 1, 'one bill, not one an hour');
  O.setStockTarget(s, 'meal', null, 60); atHour(s);
  assert.equal(fire.bills.find((x) => x.steward).n, 60, 'the target moves the bill');
  // 200 blocks: a mason (with masonry) takes it; a kind no bench makes is reported, not billed
  grantTech(s, 'masonry');
  const mason = built(s, 'mason', -6, 3);
  O.setStockTarget(s, 'block', null, 200);
  O.setStockTarget(s, 'ring', null, 3);
  atHour(s);
  const bb = mason.bills.find((x) => x.steward);
  assert.ok(bb && bb.n === 200 && /blocks/.test(bb.recipe), JSON.stringify(mason.bills));
  assert.equal(O.stewardPlan(s).find((p) => p.k === 'ring').why, 'no bench in the hold can make it');
  // clamped to the benches: a full bench is passed over
  O.setStockTarget(s, 'ring', null, 0); O.setStockTarget(s, 'block', null, 0); atHour(s);
  assert.ok(!mason.bills.some((x) => x.steward), 'a removed target takes its bill down');
  // the Steward leaves: the Steward's bills come down, the player's stay
  O.appoint(s, 'steward', null); atHour(s);
  assert.equal(fire.bills.filter((x) => x.steward).length, 0);
  assert.equal(fire.bills.length, before);
});

test('the Reckoner: counts above 20 are rounded without one, exact with one', () => {
  const s = colony('K-reck', 6);
  assert.equal(O.stockLabel(s, 17), '17');
  assert.equal(O.stockLabel(s, 43), 'about 40');
  assert.equal(O.stockLabel(s, 1234), 'about 1200');
  O.appoint(s, 'reckoner', s.col[1].id);
  assert.equal(O.stockLabel(s, 43), '43');
});

test('ORACLE the Thane has the highest summed opinion, chosen at 15 and again at the Year\'s Turning', () => {
  const s = colony('K-thane', 14);
  atHour(s);
  assert.equal(O.holderOf(s, 'thane'), null, 'not open below 15');
  const c15 = addCol(s);
  const pick = s.col[7];
  for (const o of s.col) if (o !== pick) addOpinion(s, o.id, pick.id, 30);
  addOpinion(s, s.col[2].id, s.col[3].id, 90);
  const want = O.electThane(s);
  let best = null, bv = -Infinity;
  for (const c of s.col) { const v = O.summedOpinion(s, c); if (v > bv) { bv = v; best = c; } }
  assert.equal(want, best);
  assert.equal(want, pick);
  atHour(s);
  assert.equal(O.holderOf(s, 'thane'), pick, 'chosen when the office opens');
  assert.ok(pick.thoughts.some((t) => t[0] === 'chosen_thane'));
  // opinions change: the Thane stays until the Year's Turning, then the colonists choose again
  for (const o of s.col) if (o !== c15) addOpinion(s, o.id, c15.id, 80);
  atDay(s);
  assert.equal(O.holderOf(s, 'thane'), pick);
  s.tick = DAYS_PER_YEAR * TICKS_PER_DAY - TICKS_PER_HOUR; atHour(s);
  assert.equal(O.holderOf(s, 'thane'), c15);
  assert.equal(O.electThane(s), c15);
  // a Thane in good spirits: Well led for all
  c15.mood = 80 * FIX; atDay(s);
  assert.ok(s.col.filter((c) => !c.hp.dead).every((c) => c.thoughts.some((t) => t[0] === 'well_led')));
  c15.mood = 10 * FIX; atDay(s);
  assert.ok(!s.col.some((c) => c.thoughts.some((t) => t[0] === 'well_led')));
});

test('the Lord or Lady arrives at the Hold rank with 20 colonists, with two retainers, once', () => {
  const s = colony('K-lord', 20);
  atHour(s);
  assert.equal(O.holderOf(s, 'lord'), null, 'not before the Hold rank');
  s.colony.tier = tierIndex('hold');
  const n0 = s.col.length;
  atHour(s);
  const lord = O.holderOf(s, 'lord');
  assert.ok(lord, 'arrived');
  assert.equal(s.col.length, n0 + 3);
  assert.equal(O.officeRec(s).lord.retainers.length, 2);
  assert.ok(['Lord of the Hold', 'Lady of the Hold'].includes(O.officeName(s, 'lord')));
  assert.notEqual(O.holderOf(s, 'thane'), lord, 'the Lord is never the Thane');
  atHour(s);
  assert.equal(s.col.length, n0 + 3, 'once');
  lord.hp.dead = true;
  atDay(s, 5);
  assert.equal(O.holderOf(s, 'lord'), null, 'not replaced within a year');
  s.tick += DAYS_PER_YEAR * TICKS_PER_DAY; atHour(s);
  assert.ok(O.holderOf(s, 'lord') && O.holderOf(s, 'lord') !== lord, 'a new Lord after a year');
});

test('requests: needs met by rooms (an office serves one holder); unmet 10 days gives -4, then -2 more a season', () => {
  const s = colony('K-needs', 15);
  const room = (id, role, tier, defs, beds = []) => ({ id, info: { role, tier }, defs: new Set(defs), beds, ti: ['squalid', 'plain', 'decent', 'fine', 'grand', 'majestic'].indexOf(tier) });
  atHour(s);   // the Thane is chosen
  const thane = O.holderOf(s, 'thane');
  const [a, b] = s.col.filter((c) => c !== thane);
  O.appoint(s, 'steward', a.id); O.appoint(s, 'keeper', b.id);
  let v = O.needsView(s, [room(1, 'dining', 'fine', ['table', 'chair'])]);
  assert.equal(v.thane.find((n) => n.id === 'office_fine').met, true, 'the Thane (first in precedence) takes the Fine office');
  assert.equal(v.steward[0].met, false, 'an office serves one holder');
  assert.equal(v.thane.find((n) => n.id === 'dining_fine').met, true, 'a dining seat is shared');
  v = O.needsView(s, [room(1, 'dining', 'fine', ['table', 'chair']), room(2, 'hall', 'plain', ['table', 'stool'])]);
  assert.equal(v.steward[0].met, true);
  assert.equal(O.needsView(s, [room(3, 'bedroom', 'fine', ['bed', 'table', 'chair'])]).steward[0].met, false, 'a bedroom is no office');
  assert.equal(O.needsView(s, [room(4, 'bedroom', 'fine', ['bed'], [thane.id])]).thane.find((n) => n.id === 'bedroom_fine').met, true);
  assert.equal(O.needsView(s, [room(4, 'bedroom', 'fine', ['bed'], [a.id])]).thane.find((n) => n.id === 'bedroom_fine').met, false, 'their own bed');
  assert.equal(O.needsView(s, [room(5, 'hall', 'plain', ['study'])]).keeper[0].met, true);
  // the clock: this hold has none of it
  atDay(s);
  assert.equal(stack(a, 'office_unmet'), 0, 'not before 10 days');
  atDay(s, 10);
  assert.equal(stack(a, 'office_unmet'), 2, '-4 after 10 days');
  atDay(s, DAYS_PER_SEASON);
  assert.equal(stack(a, 'office_unmet'), 3, '-6 a season later');
  assert.ok(stack(s.col.find((c) => c !== thane && !O.officeOf(s, c.id)), 'office_unmet') === 0, 'only holders');
  // nobles unmet: Order-valuing colonists feel it; the Hearthwatch's goodwill falls
  const ord = s.col.find((c) => c !== thane && !O.officeOf(s, c.id));
  setPsy(s, ord, { v: [0, 0, 2, 0] });
  const g0 = s.colony.factions.hearthwatch;
  atDay(s);
  assert.equal(stack(ord, 'nobles_poorly_kept'), 1);
  assert.ok(s.colony.factions.hearthwatch < g0);
  // a holder who leaves the office loses the thought
  O.appoint(s, 'steward', null); atDay(s);
  assert.equal(stack(a, 'office_unmet'), 0);
});

test('mandates: a Make mandate from the noble\'s liked kind; met by making it; broken without justice touches Order', () => {
  const s = colony('K-mandate', 15);
  grantTech(s, 'carpentry');
  built(s, 'carpenter', 5, -5);
  atHour(s);
  const thane = O.holderOf(s, 'thane');
  setPsy(s, thane, { p: [['item', 'chair'], ['material', 'granite']] });
  const md = O.makeMandateFor(s, thane, 'thane');
  assert.deepEqual([md.kind, md.k, md.n, md.days], ['make', 'chair', 3, 10]);
  // open one (the daily hash decides the day; run days until it opens)
  let k = 0;
  while (!O.mandatesOf(s).length && k++ < 60) atDay(s);
  assert.equal(O.mandatesOf(s).length, 1, 'a mandate opened');
  const m = O.mandatesOf(s)[0];
  assert.ok(m.open - O.officeRec(s).holderSince.thane >= DOFF.MANDATE.gapDays * TICKS_PER_DAY - TICKS_PER_DAY, 'not before the gap');
  const h = hearth(s);
  if (m.kind === 'make') {
    spawn(s, m.k, m.m || 'wood', 0, m.n, h.x + 2, h.y + 2); recomputeStock(s);
    assert.ok(O.mandateMade(s, m) >= m.n, `made ${O.mandateMade(s, m)}`);
  }
  atDay(s);
  if (m.kind === 'make') {
    assert.equal(O.mandatesOf(s).length, 0, 'met');
    assert.ok(thane.thoughts.some((t) => t[0] === 'mandate_met'));
    assert.ok(O.mandateRenown(s).reduce((x, y) => x + y, 0) === 2);
  }
  // a broken one: Order-valuing colonists get "Mandate ignored" (no justice), unless the justice hook takes it
  const ord = s.col.find((c) => c !== thane); setPsy(s, ord, { v: [0, 0, 2, 0] });
  s.colony.mandates.length = 0;
  s.colony.mandates.push({ id: 99, by: thane.id, office: 'thane', kind: 'make', k: 'statue', m: null, n: 3, base: 0, open: s.tick, due: s.tick + TICKS_PER_HOUR, sold: false });
  atDay(s);
  assert.ok(thane.thoughts.some((t) => t[0] === 'mandate_broken'));
  assert.ok(ord.thoughts.some((t) => t[0] === 'mandate_ignored'));
  let seen = null;
  O.setMandateBrokenHook((st, x) => { seen = x.id; return true; });
  ord.thoughts = ord.thoughts.filter((t) => t[0] !== 'mandate_ignored');
  s.colony.mandates.length = 0;
  s.colony.mandates.push({ id: 100, by: thane.id, office: 'thane', kind: 'make', k: 'statue', m: null, n: 3, base: 0, open: s.tick, due: s.tick + TICKS_PER_HOUR, sold: false });
  atDay(s);
  assert.equal(seen, 100);
  assert.ok(!ord.thoughts.some((t) => t[0] === 'mandate_ignored'), 'a case instead');
  O.setMandateBrokenHook(null);
  // Keep: bars trade, a sale breaks it
  s.colony.mandates.length = 0;
  s.colony.mandates.push({ id: 101, by: thane.id, office: 'thane', kind: 'keep', k: 'ingot', m: 'steel', n: 0, base: 0, open: s.tick, due: s.tick + 5 * TICKS_PER_DAY, sold: false });
  assert.equal(O.mandateBars(s, 'ingot', 'steel'), true);
  assert.equal(O.mandateBars(s, 'ingot', 'iron'), false);
  O.noteTradeOut(s, 'ingot', 'steel', 2);
  atDay(s);
  assert.equal(O.mandatesOf(s).length, 0);
});

test('state: old saves load with no office fields and continue; offices round-trip; the run is deterministic', () => {
  const run = () => {
    const s = colony('K-det', 16);
    O.setStockTarget(s, 'meal', null, 40);
    O.appoint(s, 'steward', s.col[2].id);
    for (let t = 0; t < 2 * TICKS_PER_DAY; t++) { if (s.tick % 600 === 0) s.st.queue.length = 0; tick(s); }
    return s;
  };
  const a = run(), b = run();
  assert.equal(stateHash(a), stateHash(b));
  assert.ok(O.holderOf(a, 'thane'), 'the sim system chose a Thane');
  const s2 = loadBlobSync(saveBlobSync(a));
  assert.equal(stateHash(s2), stateHash(a));
  assert.deepEqual(s2.colony.offices, a.colony.offices);
  assert.deepEqual(s2.colony.officeRec, a.colony.officeRec);
  for (let t = 0; t < TICKS_PER_DAY; t++) { tick(a); tick(s2); }
  assert.equal(stateHash(s2), stateHash(a), 'continues identically');
  // an old save (no office fields) loads and the system creates them on its hour
  const old = colony('K-old', 5);
  delete old.colony.offices; delete old.colony.mandates; delete old.colony.officeRec;
  const o2 = loadBlobSync(saveBlobSync(old));
  assert.equal(O.officesView(o2).length, DOFF.OFFICES.length, 'the screen reads an old save');
  assert.equal(o2.colony.officeRec, undefined, 'reading writes nothing');
  for (let t = 0; t < TICKS_PER_HOUR + 1; t++) tick(o2);
  assert.ok(o2.colony.officeRec && o2.colony.offices);
});
