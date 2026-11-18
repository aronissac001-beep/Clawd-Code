// Stage 1b acceptance for workstreams H and K (doc 14.7): the Steady Flame's first horde and its
// three warnings (Omen, Sighted, Imminent) with the chip, edge and route-preview data; foes on the
// map (flow field with wall smash costs, closing in, breaking walls); drafting with Move, Attack and
// Hold through the engage step; the Hearth's night shot and the brazier lit-tile bonus; the dawn
// retreat; saves mid-raid (Sighted, melee, retreat) continue identically (determinism b). K: tier
// Camp; the Dawn Ledger counters roll at 06:00 and survive a save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { stateHash } from '../../js/game/core/state.js';
import { BUS, product } from '../../js/game/core/bus.js';
import { idx, ctrW, tileOfW, W } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY, hourOf, dayOf } from '../../js/game/core/time.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { drain } from '../../js/game/core/events.js';
import { storyteller, raiders, raidplan, flow, warnings, fight, horde } from '../../js/game/threat/index.js';
import { ledger, tiers } from '../../js/game/colony/index.js';
import { CONTENT } from '../../js/data/index.js';

const H1 = TICKS_PER_HOUR;
function colony(seed = 'HK-1B') {
  installSim({ stage: '1b', reset: true, checks: true });
  return foundColony({ seed, name: 'HK Hold' });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
const at = (day, hour) => (day - 1) * TICKS_PER_DAY + hour * H1;
const stepTo = (s, t) => { if (t > s.tick) step(s, t - s.tick); };
/** A done structure of def near the Hearth (offset dx, dy). */
function built(s, defId, dx, dy) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const p = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 0);
  const b = addBuilding(s, defId, p[0], p[1], 0, defId === 'wall' ? 'wood' : null);
  completeBuilding(s, b);
  return b;
}
/** Queue a horde now (replacing the scripted first one) that arrives in `inH` hours with these members. */
function horde_(s, members, inH = 1, side = null) {
  s.st.queue.length = 0;
  const e = storyteller.scheduleIncident(s, 'hollow_horde', s.tick, s.tick + inH * H1);
  let sd = side || 'w', i = raidplan.edgeTile(s, sd);
  for (const x of ['w', 's', 'e', 'n']) if (i === null) { sd = x; i = raidplan.edgeTile(s, x); }
  e.plan = { pts: 60, edge: { side: sd, i }, goal: 'core', members, nem: null };
  return e;
}
/** Put foes of an arrived raid at tile (x, y). */
function placeFoes(s, x, y) { for (const f of s.foes) { f.x = ctrW(x); f.y = ctrW(y); } }

test('Steady Flame: first omen day 2 18:00, Sighted 17:00 and Imminent 20:00 on day 3, arrival 21:00 (27 h warned); chip, edge, size, route and composition by stage', () => {
  const s = colony('HK-STAGES');
  assert.equal(storyteller.storytellerDef(s).id, 'steady');
  stepTo(s, at(2, 18) - 1);
  assert.equal(warnings.threatChip(s), null, 'no chip before the omen');
  step(s, 1);
  let v = warnings.threatChip(s);
  assert.equal(v.stage, 'omen'); assert.equal(v.hours, 27); assert.equal(v.chip, 'Hollow horde: 27 h');
  assert.ok(v.edge && ['n', 'e', 's', 'w'].includes(v.edge.side) && v.edge.word, 'the edge marker');
  assert.equal(v.size, null, 'no size at the omen'); assert.equal(v.route, null);
  assert.match(warnings.omenText(s, v), /Grey shapes gather to the (north|east|south|west)\. A Hollow horde will reach the hold in 27 hours\./);
  const e = s.st.queue[0];
  assert.deepEqual(e.plan.members, ['husk', 'husk', 'husk'], 'the first horde: 60 points, three Husks');
  assert.ok((e.arriveTick - e.warnTick) / H1 >= 12, 'warned at least 12 h');
  stepTo(s, at(3, 17));
  v = warnings.threatChip(s);
  assert.equal(v.stage, 'sighted'); assert.equal(v.size.text, '3'); assert.deepEqual(v.types, ['Husk']);
  assert.ok(v.route.length > 5, `route preview ${v.route.length} tiles`);
  assert.equal(v.route[0], e.plan.edge.i, 'the route starts at the edge');
  const fl = flow.fieldFor(s, 'core');
  assert.equal(fl.f[v.route[v.route.length - 1]], 0, 'the route ends at the Hearth');
  assert.equal(v.comp, null);
  stepTo(s, at(3, 20));
  v = warnings.threatChip(s);
  assert.equal(v.stage, 'imminent'); assert.deepEqual(v.comp, [{ id: 'husk', name: 'Husk', n: 3 }]);
  assert.ok(drain(s).some((x) => x.name === 'raidStage' && x.data.stage === 'imminent'), 'the UI drops to 1x on this event');
  stepTo(s, at(3, 21));
  v = warnings.threatChip(s);
  assert.equal(v.stage, 'active'); assert.equal(v.onMap, 3); assert.equal(v.chip, 'Hollow horde: on the map');
  assert.equal(s.foes.length, 3);
});

test('the Hearth night shot and the brazier bonus kill an undefended horde at the Hearth; repelled ends the raid with thought and ledger', () => {
  const s = colony('HK-SHOT');
  stepTo(s, at(1, 21));
  horde_(s, ['husk'], 1);
  stepTo(s, at(1, 22));
  const f = s.foes[0];
  const hb = hearth(s);
  placeFoes(s, hb.x - 3, hb.y + 1);
  const hp0 = f.hp.hp;
  // the shot: 6 every 30 ticks, x1.25 on the Hearth's lit tiles
  let hits = 0;
  for (let k = 0; k < 60 && s.foes.length; k++) { const h = f.hp.hp; step(s, 1); if (f.hp.hp < h) hits++; }
  assert.ok(hits >= 1 && hp0 - f.hp.hp >= 7, `shot ${hp0 - f.hp.hp}`);
  assert.equal(product(BUS.dmgMult, s, null, f, 'fire'), 1.25, 'Hollow on a lit tile take +25%');
  step(s, 600);
  assert.equal(s.raids.length, 0, 'the Hearth alone killed one Husk');
  assert.equal(s.st.history.at(-1).result, 'repelled');
  assert.ok(s.col.every((c) => c.thoughts.some((t) => t[0] === 'raid_repelled')), 'Repelled the Hollow');
  assert.equal(ledger.today(s, 'raidsRepelled'), 1); assert.ok(ledger.today(s, 'kills') >= 1);
  // a cold Hearth does not fire
  const s2 = colony('HK-COLD');
  stepTo(s2, at(1, 21)); horde_(s2, ['husk'], 1); stepTo(s2, at(1, 22));
  s2.colony.hearth.fuel = 0;
  placeFoes(s2, hearth(s2).x - 3, hearth(s2).y + 1);
  const h2 = s2.foes[0].hp.hp; step(s2, 40);
  assert.ok(s2.foes[0].hp.hp === h2 || s2.foes[0].target !== null, 'no shot from a cold Hearth');
});

test('a brazier lights its tiles: a drafted colonist deals +25% to the Hollow there', () => {
  const s = colony('HK-BRAZ');
  const b = built(s, 'brazier', -6, 0);
  step(s, 1);
  assert.ok(s.rt.light[idx(b.x, b.y + 1)] >= 2, 'lit next to the brazier');
  const foe = { id: 99, kind: 'husk', raid: 1, x: ctrW(b.x), y: ctrW(b.y + 1), hp: { hp: 40, max: 40 } };
  assert.equal(product(BUS.dmgMult, s, s.col[0], foe, 'blunt'), 1.25);
});

test('drafting: Move then Hold strikes what comes; Attack closes in and kills; undraft at the raid end', () => {
  const s = colony('HK-DRAFT');
  stepTo(s, at(1, 21));
  horde_(s, ['husk', 'husk'], 1);
  const ids = s.col.map((c) => c.id);
  assert.ok(applyCommand(s, { t: 'draft', colIds: ids, on: true }).ok);
  const hb = hearth(s);
  const spot = findSite(s, hb.x - 4, hb.y, 1, 1, 0);
  assert.ok(applyCommand(s, { t: 'order', colIds: [ids[0]], kind: 'move', target: { x: spot[0], y: spot[1] } }).ok);
  step(s, 300);
  const c0 = s.col[0];
  assert.equal(c0.job.type, 'order'); assert.equal(c0.job.order, 'move');
  assert.equal(tileOfW(c0.x), spot[0], 'arrived'); assert.equal(c0.job.toils[c0.job.i].t, 'stand', 'holds there');
  assert.equal(s.col[1].job.order, 'hold', 'drafted with no order: Hold where they stand');
  stepTo(s, at(1, 22));
  assert.equal(s.foes.length, 2);
  s.colony.hearth.fuel = 0;   // no Hearth shot: the colonists do the work
  // the foes come to the colonist on Move/Hold: put them 2 tiles away
  placeFoes(s, spot[0] - 2, spot[1]);
  s.foes[1].x += 8;
  const target = s.foes[1].id;
  assert.ok(applyCommand(s, { t: 'order', colIds: [ids[1], ids[2]], kind: 'attack', target: { id: target, kind: 'foe' } }).ok);
  assert.equal(s.col[1].job.foe, target);
  let guard = 0;
  while (s.foes.length && guard++ < 4000) step(s, 1);
  assert.equal(s.foes.length, 0, 'both Husks dead');
  assert.ok(s.col.every((c) => !c.hp.dead), 'nobody died');
  assert.ok(s.col[0].sk[11][1] > 0 || s.col[0].sk[11][0] > 0, 'Melee XP');
  step(s, 2);
  assert.equal(s.raids.length, 0);
  assert.ok(s.col.every((c) => !c.drafted), 'undrafted at the raid end');
  assert.equal(applyCommand(s, { t: 'order', colIds: [ids[0]], kind: 'attack', target: { x: 3, y: 3 } }).ok, false);
});

test('a wall in the way: the field prices it by hp band, the Husk breaks it and walks on', () => {
  const s = colony('HK-WALL');
  stepTo(s, at(1, 21));
  const hb = hearth(s);
  // a ring of wooden walls around the Hearth at distance 3 (a closed pen: no other way in)
  const walls = [];
  for (let y = hb.y - 3; y <= hb.y + 5; y++) for (let x = hb.x - 3; x <= hb.x + 5; x++) {
    if (x !== hb.x - 3 && x !== hb.x + 5 && y !== hb.y - 3 && y !== hb.y + 5) continue;
    const i = idx(x, y);
    if (s.rt.occ[i] >= 0 || s.rt.walkCost[i] === 0) continue;
    const b = addBuilding(s, 'wall', x, y, 0, 'wood'); completeBuilding(s, b); walls.push(b);
  }
  for (const c of s.col) { c.path = null; c.x = ctrW(hb.x - 2); c.y = ctrW(hb.y - 2); }   // inside the pen: out of the Husk's sight
  horde_(s, ['husk'], 1);
  stepTo(s, at(1, 22));
  const fl = flow.fieldFor(s, 'core');
  const f = s.foes[0];
  assert.ok(fl.f[raiders.foeTile(f)] < flow.FLOW_UNREACHED, 'the walled Hearth is reachable through a wall');
  const w = walls[0];
  assert.equal(flow.hostileCosts(s).cost[idx(w.x, w.y)], flow.SMASH.base + flow.SMASH.perBand * flow.hpBand(w));
  s.colony.hearth.fuel = 0;                        // no Hearth shot
  for (const b of walls) b.hp = 20;                // weak walls (band 1): quick to break
  placeFoes(s, hb.x - 6, hb.y + 1);
  const n0 = walls.filter((b) => s.bld[b.id] === b).length;
  let guard = 0;
  while (s.foes.length && walls.filter((b) => s.bld[b.id] === b).length === n0 && guard++ < 6000) step(s, 1);
  assert.ok(walls.filter((b) => s.bld[b.id] === b).length < n0, 'a wall was broken');
});

test('dawn retreat: at 05:00 the horde turns, burns in the open and leaves by the edge ("fled"); a save mid-retreat continues identically', () => {
  const s = colony('HK-DAWN');
  stepTo(s, at(1, 21));
  s.colony.hearth.fuel = 0;                       // no night shot: the horde lives to dawn
  for (const c of s.col) { c.x = ctrW(5); c.y = ctrW(5); }
  horde_(s, ['husk', 'husk'], 1);
  stepTo(s, at(2, 4) + 30);
  assert.equal(s.raids[0].stage, 'active');
  for (const f of s.foes) { f.target = null; f.hp.hp = f.hp.max; }
  stepTo(s, at(2, 5) + 2);
  assert.equal(s.raids[0].stage, 'retreat');
  assert.ok(flow.fieldFor(s, 'edge'), 'the edge field');
  assert.equal(warnings.threatChip(s).chip, 'Hollow horde: fleeing');
  const hp = s.foes.map((f) => f.hp.hp);
  step(s, 21);
  assert.ok(s.foes.every((f, k) => f.hp.hp < hp[k]), 'the sun burns them');
  const s2 = loadBlobSync(saveBlobSync(s));
  let guard = 0;
  while (s.raids.length && guard++ < 6 * H1) { step(s, 1); step(s2, 1); }
  assert.equal(s.raids.length, 0);
  assert.ok(['fled', 'repelled'].includes(s.st.history.at(-1).result));
  assert.equal(stateHash(s2), stateHash(s), 'identical after a save mid-retreat');
});

test('determinism (b): saves at Sighted and with hostiles in melee continue identically', () => {
  const run = (saveAt) => {
    const s0 = colony('HK-DET');
    let s = s0;
    const ids = s.col.map((c) => c.id);
    let melee = 0;
    while (s.tick < at(4, 2)) {
      if (s.tick === at(3, 20) + 1) { applyCommand(s, { t: 'draft', colIds: ids, on: true }); }
      if (s.tick === at(3, 21) + 20 && s.foes.length) applyCommand(s, { t: 'order', colIds: ids, kind: 'attack', target: { id: s.foes[0].id, kind: 'foe' } });
      step(s, 1);
      if (!saveAt) continue;
      const r = s.raids[0];
      if (r && r.stage === 'sighted' && s.tick === at(3, 18) + 7) s = loadBlobSync(saveBlobSync(s));
      const inMelee = s.foes.some((f) => f.target !== null && s.col.some((c) => c.id === f.target && (f.x - c.x) ** 2 + (f.y - c.y) ** 2 < 40 * 40));
      if (inMelee && melee < 3 && s.tick % 13 === 0) { melee++; s = loadBlobSync(saveBlobSync(s)); }
    }
    return { h: stateHash(s), melee };
  };
  const a = run(false), b = run(true);
  assert.equal(b.h, a.h);
  assert.ok(b.melee >= 1, `saves with hostiles in melee: ${b.melee}`);
});

test('K: tier Camp; ledger counters roll at 06:00 into the Dawn Ledger and survive a save', () => {
  const s = colony('HK-LEDGER');
  assert.equal(s.colony.tier, 0);
  const tv = tiers.tierView(s);
  assert.equal(tv.id, 'camp'); assert.equal(tv.next.id, 'hamlet'); assert.deepEqual(tv.next.hearth, [1, 2]);
  ledger.bump(s, 'built', 2); ledger.bump(s, 'mined');
  assert.equal(ledger.today(s, 'built'), 2);
  stepTo(s, at(1, 20));
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(s2.colony.ledger, s.colony.ledger, 'saved with the colony record');
  const day1 = { ...ledger.ledgerOf(s).day };
  assert.ok(day1.built >= 2 && day1.mined >= 1);
  stepTo(s, at(2, 6) - 1);
  assert.equal(ledger.dawnLedger(s), null, 'no card before the first 06:00');
  const before = { ...ledger.ledgerOf(s).day };
  step(s, 1);
  assert.equal(hourOf(s.tick), 6); assert.equal(dayOf(s.tick), 1);
  const l = ledger.ledgerOf(s);
  assert.equal(l.since, s.tick);
  assert.ok(ledger.LEDGER_KEYS.every((k) => l.day[k] === 0), 'the day counters reset at 06:00');
  assert.deepEqual(l.prev, before, 'yesterday is kept for the card');
  assert.ok(l.total.built >= before.built, 'lifetime totals keep counting');
  const card = ledger.dawnLedger(s);
  assert.ok(card.rows.some((r) => r[0] === 'built' && r[2] === before.built));
  const s3 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(ledger.dawnLedger(s3), card, 'the card survives a save');
  step(s, 600); step(s3, 600);
  assert.deepEqual(s3.colony.ledger, s.colony.ledger, 'and counting continues identically');
});

test('K: the events tap counts crafted, meals and hauled of the current tick only', () => {
  const s = colony('HK-TAP');
  const l = ledger.ledgerOf(s);
  const c0 = l.day.crafted, m0 = l.day.meals, h0 = l.day.hauled;
  s.rt.events.push({ name: 'crafted', tick: s.tick - 1, data: { k: 'meal' } });    // an older tick: ignored
  s.rt.events.push({ name: 'crafted', tick: s.tick, data: { k: 'meal' } });
  s.rt.events.push({ name: 'hauled', tick: s.tick, data: {} });
  ledger.tapEvents(s);
  assert.equal(l.day.crafted, c0 + 1); assert.equal(l.day.meals, m0 + 1); assert.equal(l.day.hauled, h0 + 1);
  assert.ok(W > 0 && horde.HORDE_ID === 'hollow_horde' && typeof fight.fightSystem === 'function');
});
