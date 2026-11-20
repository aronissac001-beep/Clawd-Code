// Deed sources wired at the Stage 2.9 release (EMBERCROWN-FORTRESS.md 3.1; S9.7): the counters that perks are
// earned by, counted where the deed happens. Field Surgeon (wounds first tended), Ember Hands (a downed
// colonist's bleeding stopped), Taintbreaker (a tainted patient tended), Fever Watch (an infected wound cured
// by its doctor), Fire Arrows (a ranged hit) and Deep Reader (the scholar who finishes a research).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tend } from '../../js/game/people/health.js';
import { deedCount } from '../../js/game/people/coldeeds.js';
import { studyYield } from '../../js/game/work/givers/lore.js';
import { canResearch, hasTech, startResearch } from '../../js/game/colony/research.js';
import { tapEvents } from '../../js/game/colony/ledger.js';
import { SKILL_IDS } from '../../js/game/core/schema.js';
import { all } from '../../js/game/people/defs.js';

function colony(seed) {
  installSim({ stage: '2', reset: true });
  const s = foundColony({ seed, name: 'Deed Hold' });
  s.st.queue.length = 0;
  return s;
}
const wound = (init = {}) => ({ part: 1, kind: 'cut', dmg: 5, bleed: 300, tended: 0, infected: 0, age: 0, ...init });

test('tend: the doctor counts wounds first tended and a downed patient whose bleeding stopped; a tainted patient counts once a visit', () => {
  const s = colony('deeds-tend');
  const [doc, pat] = s.col;
  pat.hp.wounds.push(wound(), wound({ part: 2 }));
  pat.hp.down = true;
  tend(s, doc, pat, null, 50);
  assert.equal(deedCount(doc, 'wounds_tended'), 2);
  assert.equal(deedCount(doc, 'bleeds_stopped'), 1);
  tend(s, doc, pat, null, 50);
  assert.equal(deedCount(doc, 'wounds_tended'), 2, 're-tending does not count again');
  assert.equal(deedCount(doc, 'bleeds_stopped'), 1);
  pat.hp.taint = 500;
  tend(s, doc, pat, null, 50);
  assert.equal(deedCount(doc, 'taint_tended'), 1);
  tend(s, pat, pat, null, 50);
  assert.equal(deedCount(pat, 'wounds_tended'), 0, 'bed rest (no doctor) counts nothing');
});

test('an infected wound tended by a doctor credits the cure to that doctor', () => {
  const s = colony('deeds-cure');
  const [doc, pat] = s.col;
  const w = wound({ tended: 40, bleed: 0, infected: 5, rolled: 1, infx: 1 });
  pat.hp.wounds.push(w);
  tend(s, doc, pat, null, 60);
  assert.equal(w.doc, doc.id);
  // the cure itself is the health step's (stage2Health): drive it the way the game does, by ticking
  return import('../../js/game/core/sim.js').then(({ step }) => {
    for (let k = 0; k < 40 && pat.hp.wounds.includes(w) && w.infected > 0; k++) { tend(s, doc, pat, null, 60); step(s, 600); }
    assert.equal(w.infected, 0, 'cured');
    assert.equal(deedCount(doc, 'infections_cured'), 1);
  });
});

test('a tech the hold learns is its lead scholar\'s deed (the best Lore standing), whoever studied; banked lore counts too', () => {
  const s = colony('deeds-lore');
  const t = all('tech').find((x) => !hasTech(s, x.id) && canResearch(s, x.id) === null);
  assert.ok(t, 'a tech to research');
  s.colony.research = { cur: t.id, pts: 0 };   // as the research command sets it
  const col = s.col[1];
  col.sk[SKILL_IDS.indexOf('lore')][0] = 12;
  for (let k = 0; k < 2000 && s.colony.research.cur; k++) studyYield(s, s.col[0], null, 5);
  assert.equal(s.colony.research.cur, null, 'the research finished');
  tapEvents(s);
  assert.equal(deedCount(col, 'researched'), 1, 'the best Lore');
  assert.equal(deedCount(s.col[0], 'researched'), 0);
  // the one who studied counts the hours (60 points an hour; the rest carries)
  const pts = s.col[0].done[COL_DEEDS.find((d) => d.id === 'study_acc').slot] + 60 * deedCount(s.col[0], 'study_hours');
  assert.ok(deedCount(s.col[0], 'study_hours') >= 1 && pts % 5 === 0, 'study hours from the points studied');
  const h0 = deedCount(s.col[0], 'study_hours');
  for (let k = 0; k < 24; k++) studyYield(s, s.col[0], null, 5);
  assert.equal(deedCount(s.col[0], 'study_hours'), h0 + 2, '120 more points: two more hours');
  // a tech bought at once from banked lore (the research command) is counted the same way
  const t2 = all('tech').find((x) => !hasTech(s, x.id) && canResearch(s, x.id) === null);
  s.colony.lore = 100000;
  s.rt.events.length = 0;
  assert.equal(startResearch(s, t2.id), null);
  const learned = s.rt.events.filter((e) => e.name === 'researched').length;
  tapEvents(s);
  assert.ok(hasTech(s, t2.id) && learned >= 1);
  assert.equal(deedCount(col, 'researched'), 1 + learned, 'one per tech learned');
});

// ---- Stage 2.9b: every deed has a source -----------------------------------------------------------------------
// The property: every shown deed row of js/data/deeds-col.js is counted somewhere in the game (a didDeed call
// with its id, or coldeeds' own hooks), so no perk waits on a deed nothing can do. PENDING names a deed whose
// counting site lives in another owner's file and is requested (it must say where); the test reports it as a
// todo and fails for any other unsourced row. Then each new source is driven for real.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COL_DEEDS } from '../../js/data/deeds-col.js';
import { PERK_EARN } from '../../js/game/people/perks.js';
import { CONTENT } from '../../js/data/index.js';
import { findSite } from '../../js/game/core/setup.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { tryGiver } from '../../js/game/work/think.js';
import { stepJob } from '../../js/game/work/toils.js';
import { REPAIR_GIVER, maxHp, needsRepair } from '../../js/game/work/givers/repair.js';
import { SMOOTH_GIVER, ENGRAVE_GIVER, smoothTile, engraveTile, smoothId, engravedId } from '../../js/game/work/givers/stone.js';
import { TABLET_GIVER, isTablet, readTablet } from '../../js/game/work/givers/lore.js';
import { spawn } from '../../js/game/work/items.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { trade } from '../../js/game/colony/index.js';
import { W, TER, DESIG, ctrW } from '../../js/game/core/grid.js';
import { colTile } from '../../js/game/work/reserve.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PENDING = Object.freeze({ persuaded: 'requested of H (SURVIVE): threat/capture.js onChoice captive Recruit credits trade.envoyOf(s)' });
function jsFiles(dir, out = []) {
  for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) jsFiles(p, out); else if (f.endsWith('.js')) out.push(p); }
  return out;
}
/** Deed ids counted in the game code: didDeed(s, who, 'id' ...) literals in js/game/**. */
function countedDeeds() {
  const ids = new Set();
  for (const f of jsFiles(join(ROOT, 'js', 'game'))) for (const m of readFileSync(f, 'utf8').matchAll(/didDeed\(\s*[\w.]+\s*,\s*[\w.()[\]]+\s*,\s*'([a-z_]+)'/g)) ids.add(m[1]);
  return ids;
}

test('property: every deed row a perk can need has a source in the game code (and every perk deed is a row)', () => {
  const counted = countedDeeds();
  const shown = COL_DEEDS.filter((d) => !d.internal).map((d) => d.id);
  assert.deepEqual(shown.filter((id) => !counted.has(id) && !PENDING[id]), [], 'deeds with no counting site');
  for (const id of Object.keys(PENDING)) assert.ok(shown.includes(id) && /\.js/.test(PENDING[id]), `${id}: a pending deed names the file that will count it`);
  // the other way: every deed a perk names is a shown row
  for (const [p, e] of Object.entries(PERK_EARN)) for (const d of e.all || e.any) assert.ok(shown.includes(d.deed), `${p}: ${d.deed}`);
});
for (const id of Object.keys(PENDING)) {
  const sourced = countedDeeds().has(id);
  test(`deed ${id} has its source`, sourced ? {} : { todo: PENDING[id] }, () => { assert.ok(countedDeeds().has(id), PENDING[id]); });
}

// floors the stone work lays (G's walls.js defs; appended here in this process when the data does not carry them yet)
for (const [id, beauty] of [['f_smooth', 1], ['f_engraved', 3]]) {
  if (!CONTENT.all('structure').some((d) => d.id === id)) CONTENT.all('structure').push({ id, name: id, cat: 'walls', kind: 'designation', size: [1, 1], cost: {}, work: 1, tier: 'camp', beauty, flags: ['floor'], art: 'floor.smooth', stage: '2' });
}
const hearthOf = (s) => s.bld[s.colony.hearth.id];
function wallNear(s) {
  const hb = hearthOf(s), at = findSite(s, hb.x + 5, hb.y + 5, 1, 1, 1);
  const b = addBuilding(s, 'wall', at[0], at[1], 0, null);
  completeBuilding(s, b);
  return b;
}
/** Run the colonist's job by its toils until it ends (the colonist walks: teleported to each goto). */
function runJob(s, col, max = 20000) {
  for (let k = 0; k < max && col.job; k++) {
    const toil = col.job.toils[col.job.i];
    if (toil && toil.t === 'goto') { col.x = ctrW(toil.i % W); col.y = ctrW((toil.i / W) | 0); col.path = null; col.job.i++; col.job.work = 0; continue; }
    stepJob(s, col);
  }
}

test('repair: a damaged wall is made whole by a builder; finished in a live raid it counts raid_repairs; a scratch is left alone', () => {
  const s = colony('deeds-repair');
  const col = s.col[0];
  for (const c of s.col) c.job = null;
  const b = wallNear(s);
  const full = maxHp(b);
  assert.ok(full > 0 && b.hp >= full);
  assert.deepEqual(s.bld.filter((x) => x && needsRepair(x)).map((x) => x.def), [], 'a new hold has nothing to repair');
  b.hp = full - 5;
  assert.equal(needsRepair(b), false, 'a scratch is not worth a job');
  b.hp = Math.floor(full / 3);
  assert.ok(needsRepair(b));
  assert.ok(tryGiver(s, col, REPAIR_GIVER), 'the builder takes the repair');
  assert.equal(col.job.type, 'repair');
  runJob(s, col);
  assert.equal(b.hp, full, 'whole again');
  assert.equal(deedCount(col, 'raid_repairs'), 0, 'no raid: not a raid repair');
  // in a raid (a live raid record; no foe on this side of the wall)
  s.raids.push({ id: 77, inc: 'test', pts: 0, edge: null, goal: null, morale: 100, members: [], stage: 'assault' });
  b.hp = Math.floor(full / 2);
  assert.ok(tryGiver(s, col, REPAIR_GIVER));
  runJob(s, col);
  assert.equal(b.hp, full);
  assert.equal(deedCount(col, 'raid_repairs'), 1);
});

test('smooth and engrave: a rough floor marked Smooth becomes smoothed stone (Masonry), then Engrave carves it (Art); the deeds count', () => {
  const s = colony('deeds-stone');
  const col = s.col[0];
  for (const c of s.col) c.job = null;
  assert.ok(smoothId() > 0 && engravedId() > 0, 'the worked-stone floors are in the content');
  // a rough floor tile the colonist can reach (the nearest one, else one made beside the colonist)
  const ci = colTile(col);
  let i = -1;
  for (let r = 1; r < 30 && i < 0; r++) for (let dy = -r; dy <= r && i < 0; dy++) for (let dx = -r; dx <= r; dx++) { const j = ci + dy * W + dx; if (j > 0 && j < s.L.terrain.length && s.L.terrain[j] === TER.ROUGH && !s.L.floor[j] && s.rt.occ[j] < 0) { i = j; break; } }
  if (i < 0) { i = ci + 2; s.L.terrain[i] = TER.ROUGH; s.L.floor[i] = 0; }
  const rect = { x0: i % W, y0: (i / W) | 0, x1: i % W, y1: (i / W) | 0 };
  assert.ok(applyCommand(s, { t: 'designate', kind: 'smooth', rect, add: true }).ok);
  assert.ok(tryGiver(s, col, SMOOTH_GIVER), 'a mason takes the smoothing');
  runJob(s, col);
  assert.equal(s.L.floor[i], smoothId(), 'smoothed stone');
  assert.equal(s.L.desig[i] & DESIG.SMOOTH, 0, 'the mark is cleared');
  assert.equal(deedCount(col, 'stone_worked'), 1);
  assert.ok(applyCommand(s, { t: 'designate', kind: 'engrave', rect, add: true }).ok);
  assert.ok(tryGiver(s, col, ENGRAVE_GIVER), 'an artist takes the engraving');
  runJob(s, col);
  assert.equal(s.L.floor[i], engravedId());
  assert.deepEqual([deedCount(col, 'stone_worked'), deedCount(col, 'walls_engraved')], [2, 1]);
  assert.equal(smoothTile(s, col, i) || engraveTile(s, col, i), false, 'done once');
});

test('a lore tablet: a scholar reads it where it lies, the hold learns a tech, the tablet is kept and marked read; tablets_read counts', () => {
  const s = colony('deeds-tablet');
  const col = s.col[0];
  for (const c of s.col) c.job = null;
  const ci = colTile(col);
  spawn(s, 'book', null, 0, 1, (ci % W) + 1, (ci / W) | 0, { name: 'Ashen Deep tablet' });
  const it = s.items.find((x) => x && x.name === 'Ashen Deep tablet');
  assert.ok(it && isTablet(it));
  const known = all('tech').filter((x) => hasTech(s, x.id)).length;
  assert.ok(tryGiver(s, col, TABLET_GIVER), 'a scholar takes the tablet');
  runJob(s, col);
  assert.equal(all('tech').filter((x) => hasTech(s, x.id)).length, known + 1, 'one tech learned');
  assert.equal(it.name, 'Ashen Deep tablet (read)');
  assert.equal(isTablet(it), false);
  assert.equal(deedCount(col, 'tablets_read'), 1);
  assert.ok(!TABLET_GIVER.candidates(s, col, 4).some((c) => c.id === it.id), 'a read tablet is not read again');
  assert.deepEqual(readTablet(s, col, it), [], 'and readTablet refuses it');
});

test('a trade: the envoy (best Social standing) strikes the bargain and counts it; a token trade does not', () => {
  const s = colony('deeds-trade');
  trade.tradeRec(s);
  const v = trade.arrive(s, 'pedlar');
  const hb = hearthOf(s);
  // coins in a stockpile (the trade pays from stock)
  let z = null;
  for (let r = 4; r < 30 && !(z && z.ok); r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    z = applyCommand(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: hb.x + dx, y0: hb.y + dy, x1: hb.x + dx + 2, y1: hb.y + dy + 2 }, preset: 'all' });
    if (z.ok) break;
  }
  assert.ok(z && z.ok, 'a stockpile');
  const zt = []; for (let i = 0; i < s.L.zone.length; i++) if (s.L.zone[i] === z.zoneId) zt.push(i);
  spawn(s, 'coins', null, 0, 2000, zt[0] % W, (zt[0] / W) | 0);
  const env = trade.envoyOf(s);
  assert.ok(env);
  // the pedlar's goods worth 10+ coins in one trade
  let buy = null;
  for (const g of v.stock) for (let n = 1; n <= g.n && !buy; n++) if (trade.buyPrice(s, v.trader, g.k, n) >= 10 * trade.TRADE_DEED_COINS) buy = { k: g.k, n };
  assert.ok(buy, 'a bargain on offer');
  const res = applyCommand(s, { t: 'trade', visitId: v.id, buy: [buy], sell: [] });
  assert.ok(res.ok, res.reason);
  assert.ok(res.paid + res.got >= trade.TRADE_DEED_COINS, 'a bargain worth the name');
  assert.equal(deedCount(env, 'trades'), 1);
  // a token trade (1 coin's worth) is no bargain
  const cheap = v.stock.find((x) => x.n > 0 && trade.buyPrice(s, v.trader, x.k, 1) < 10 * trade.TRADE_DEED_COINS);
  if (cheap) { assert.ok(applyCommand(s, { t: 'trade', visitId: v.id, buy: [{ k: cheap.k, n: 1 }], sell: [] }).ok); assert.equal(deedCount(env, 'trades'), 1); }
  for (const c of s.col) if (c !== env) assert.equal(deedCount(c, 'trades'), 0, 'only the envoy');
});
