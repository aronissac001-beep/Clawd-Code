// Stage 2 acceptance for workstreams H and D (doc 14.8): storytellers and difficulties, the Stage 2
// raids (thieves, beasts, reavers with morale and capture, sappers digging 4x slower than miners, the
// Rift, the breach), minors, disasters and visitors with choice letters, cast, nemeses and aftermath,
// squads (formation, guard, retreat), towers, traps, the ballista, multi-goal flow fields (never more
// than 3 live) and saves mid-raid; D: every Stage 2 art key resolves and draws through a kit part,
// with at most 45 new parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { stateHash } from '../../js/game/core/state.js';
import { idx, ctrW, tileOfW, W, H, TER } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../../js/game/core/time.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { spawn as spawnItem, totals } from '../../js/game/work/items.js';
import { mineTicks } from '../../js/game/work/givers/mine.js';
import { weatherKind } from '../../js/game/world/weather.js';
import { storyteller, raiders, raidplan, flow, letters, nemesis, sappers, raids2, events2 } from '../../js/game/threat/index.js';
import { incidentList, isHostile } from '../../js/game/threat/incidents.js';
import { formationTile } from '../../js/game/threat/orders.js';
import { traps, ballista, towers } from '../../js/game/defence/index.js';
import { CONTENT } from '../../js/data/index.js';
import { ART, KIT_PARTS, STAGE2_PARTS, artMeta, hasArtKey } from '../../js/engine/art/keys.js';
import { logicOf } from '../../js/game/threat/incidents.js';

const H1 = TICKS_PER_HOUR;
function colony(seed = 'HD-2', opts = {}) {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'HD Hold', ...opts });
}
const hearth = (s) => s.bld[s.colony.hearth.id];
const stepTo = (s, t) => { if (t > s.tick) step(s, t - s.tick); };
function built(s, defId, dx, dy, mat = null) {
  const hb = hearth(s), d = CONTENT.get('structure', defId);
  const p = findSite(s, hb.x + dx, hb.y + dy, d.size[0], d.size[1], 0);
  const b = addBuilding(s, defId, p[0], p[1], 0, mat);
  completeBuilding(s, b);
  return b;
}
/** Queue an incident now (replacing the queue) that arrives in `inH` hours with these members. */
function raid(s, inc, members, goal, inH = 1, side = 'w') {
  s.st.queue.length = 0;
  const e = storyteller.scheduleIncident(s, inc, s.tick, s.tick + inH * H1);
  let sd = side, i = raidplan.edgeTile(s, sd);
  for (const x of ['w', 's', 'e', 'n']) if (i === null) { sd = x; i = raidplan.edgeTile(s, x); }
  e.plan = { pts: 100, edge: { side: sd, i }, goal, members, nem: null };
  return e;
}
const toArrival = (s, e) => stepTo(s, e.arriveTick + 1);

test('H: the data has every Stage 2 incident class with its logic; hostile ones have points', () => {
  colony();
  const ids = incidentList().map((d) => d.id);
  for (const id of ['thieves', 'manhunters', 'reaver_raid', 'sapper_raid', 'hollow_rift', 'deep_breach', 'fire', 'blight_surge', 'crop_blight', 'grey_cough',
    'deep_tremor', 'cold_snap', 'drought', 'flood', 'vermin', 'wanderer', 'migrants', 'refugees', 'herd_passing']) assert.ok(ids.includes(id), id);
  const cats = new Set(incidentList().map((d) => d.cat));
  for (const c of ['major', 'minor', 'disaster', 'visitor', 'boon']) assert.ok(cats.has(c), c);
  assert.ok(incidentList().filter((d) => d.cat === 'major').every((d) => isHostile(d)));
});

test('H: storytellers: majors at least 2 days apart (Wandering Ember 2-11 d); Long Night floor rises twice as fast; difficulty scales points', () => {
  const s = colony('HD-ST');
  s.colony.storyteller = 'wandering';
  s.st.queue.length = 0; s.st.lastMajorDay = 3; s.st.history.push({ inc: 'hollow_horde', cat: 'major', day: 3, result: 'repelled', deaths: 0, downed: false, after: [] });
  s.st.lastMajorArrive = 3 * TICKS_PER_DAY + 21 * H1;
  s.st.cooldowns.majorDay = 3; s.tick = 3 * TICKS_PER_DAY + 22 * H1;
  const e = storyteller.scheduleMajor(s);
  assert.ok(e.arriveTick - s.st.lastMajorArrive >= 0 && e.arriveTick >= 3 * TICKS_PER_DAY + 21 * H1 + 2 * TICKS_PER_DAY, `gap ${(e.arriveTick - (3 * TICKS_PER_DAY + 21 * H1)) / TICKS_PER_DAY} d`);
  assert.ok((e.arriveTick - e.warnTick) / H1 >= 6, 'warned >= 6 h');
  const base = { wealth: 0, able: 3, day: 50, difficultyPct: 100, storytellerPct: 100, adjPct: 100 };
  const steady = raidplan.threatPoints(s, { ...base, floorPct: 100 }), night = raidplan.threatPoints(s, { ...base, floorPct: 200 });
  assert.equal(night - steady, 2 * 50 + 40, 'the Long Night floor (and the year-end step): x2');
  assert.equal(raidplan.threatPoints(s, { ...base, difficultyPct: 35, floorPct: 100 }), Math.max(40, Math.floor((steady * 35) / 100)));
});

test('H: minors and boons per 10-day block follow the storyteller ranges and start on day 4', () => {
  const s = colony('HD-SMALL');
  s.tick = 10 * TICKS_PER_DAY + 6 * H1;
  const p = storyteller.smallPlan(s);
  assert.equal(p.minor.length, 3); assert.equal(p.boon.length, 3);   // the Steady Flame: 3 / 3
  for (const d of [...p.minor, ...p.boon]) assert.ok(d >= 10 && d < 20);
  s.tick = 2 * TICKS_PER_DAY + 6 * H1; s.st.small = null;
  assert.equal(storyteller.smallCheck(s).length, 0, 'nothing small before day 4');
});

test('H: sappers dig 4x slower than miners; the dig field runs through rock', () => {
  const s = colony('HD-SAP');
  let rock = -1;
  for (let i = W; i < W * (H - 1) && rock < 0; i++) if (s.L.terrain[i] === TER.ROCK && s.rt.walkCost[i - 1] !== 0) rock = i;
  assert.ok(rock >= 0);
  assert.equal(sappers.digTicks(s, rock), 4 * mineTicks(s, rock));
  const f = { id: 99, kind: 'delver', st: { dig: null } };
  let n = 0;
  while (!sappers.digStep(s, f, rock)) n++;
  assert.equal(n + 1, 4 * mineTicks(s, rock));
  assert.notEqual(s.L.terrain[rock], TER.ROCK, 'the tunnel stays');
  const goals = [idx(5, 5)];
  const walk = flow.buildFlowField(s, goals, 1, null, true, false), dig = flow.buildFlowField(s, goals, 1, null, true, true);
  let reachable = 0, digReach = 0;
  for (let i = 0; i < walk.length; i++) { if (walk[i] !== flow.FLOW_UNREACHED) reachable++; if (dig[i] !== flow.FLOW_UNREACHED) digReach++; }
  assert.ok(digReach > reachable, 'rock is priced on the dig field');
});

test('H: multi-goal fields: the loot field draws to the richest stack; at most 3 fields live', () => {
  const s = colony('HD-FLOW');
  stepTo(s, 20 * H1);
  s.st.queue.length = 0;
  const hb = hearth(s);
  spawnItem(s, 'coins', null, 0, 400, hb.x - 6, hb.y);
  const seeds = flow.goalTiles(s, 'loot');
  const rich = seeds.find((g) => g[0] === idx(hb.x - 6, hb.y));
  assert.ok(rich && rich[1] === 0, 'the coins seed at 0');
  assert.ok(seeds.some((g) => g[1] > 0), 'poorer stacks seed higher');
  for (const [inc, goal, m] of [['hollow_horde', 'core', ['husk']], ['thieves', 'loot', ['gutter_thief']], ['sapper_raid', 'dig', ['delver']], ['manhunters', 'people', ['wolf']]]) {
    const e = storyteller.scheduleIncident(s, inc, s.tick, s.tick + H1);
    e.plan = { pts: 40, edge: { side: 'w', i: raidplan.edgeTile(s, 'w') }, goal, members: m, nem: null };
  }
  let max = 0;
  for (let k = 0; k < H1 + 40; k++) { step(s, 1); max = Math.max(max, s.rt.flow.length); }
  assert.ok(s.raids.length >= 4, `${s.raids.length} raids`);
  assert.equal(max, 3, 'never more than 3 live');
});

test('H: thieves grab a stack and run; a thief that dies drops it', () => {
  const s = colony('HD-THIEF');
  const hb = hearth(s);
  spawnItem(s, 'coins', null, 0, 40, hb.x - 4, hb.y + 1);
  const e = raid(s, 'thieves', ['gutter_thief'], 'loot', 1);
  toArrival(s, e);
  const f = s.foes[0];
  f.x = ctrW(hb.x - 4); f.y = ctrW(hb.y + 1);
  for (const c of s.col) { c.x = ctrW(2); c.y = ctrW(2); }
  step(s, 12);
  assert.ok(f.st.carry && f.st.carry.k === 'coins', 'it took the coins');
  assert.ok(f.st.flee, 'and runs');
  const coins = () => s.items.reduce((n, it) => n + (it && it.k === 'coins' ? it.n : 0), 0);
  const before = coins();
  raiders.killFoe(s, f, null);
  assert.ok(coins() > before, 'the coins fall where it died');
});

test('H: a reaver warband breaks at 50% losses and flees; a downed reaver becomes a captive letter; recruiting adds a colonist', () => {
  const s = colony('HD-REAV');
  const e = raid(s, 'reaver_raid', ['reaver_club', 'reaver_club', 'reaver_bow', 'reaver_spear'], 'people', 1);
  toArrival(s, e);
  const r = s.raids[0];
  assert.equal(r.stage, 'active');
  const [a, b] = s.foes;
  raiders.downFoe(s, a, s.col[0]);
  raiders.killFoe(s, b, s.col[0]);
  step(s, 1);
  assert.equal(r.stage, 'retreat', `morale ${r.morale}`);
  const n0 = s.col.length;
  while (s.raids.length) { for (const f of s.foes) if (!f.st.down) { f.x = ctrW(0); f.y = f.y; } step(s, 1); }
  const l = letters.pendingLetters(s).find((x) => x.data.k === 'captive');
  assert.ok(l, 'a captive letter');
  assert.ok(!s.foes.some((f) => f.st && f.st.down), 'the captive left the map');
  assert.ok(applyCommand(s, { t: 'letter', id: l.id, choice: 0 }).ok);
  assert.equal(s.col.length, n0 + 1, 'recruited');
});

test('H: an elite alive at dawn is named a nemesis with a grudge; when due it leads the next major with one more affix', () => {
  const s = colony('HD-NEM');
  stepTo(s, 21 * H1);
  s.colony.hearth.fuel = 0;
  const e = raid(s, 'hollow_horde', ['gloom_hound', 'husk'], 'core', 1);
  e.plan.lead = 0; e.plan.aff = ['warden'];
  toArrival(s, e);
  const lead = s.foes.find((f) => f.st.lead);
  assert.ok(lead && lead.st.aff.includes('warden') && lead.hp.max > 45, 'a warden elite');
  raiders.damageFoe(s, lead, 5, 'cut', s.col[1]);
  for (const f of s.foes) f.target = null;
  for (const c of s.col) { c.x = ctrW(2); c.y = ctrW(2); }
  stepTo(s, TICKS_PER_DAY + 5 * H1 + 2);
  assert.equal(s.st.nemeses.length, 1, 'named at first light');
  const n = s.st.nemeses[0];
  assert.equal(n.grudge, s.col[1].id); assert.ok(typeof n.scar === 'string', 'its worst wound');
  n.nextTick = s.tick;
  s.st.queue.length = 0; s.st.cooldowns.majorDay = 0; s.st.tension = 0;
  for (const r of s.raids.slice()) raiders.endRaid(s, r, 'fled');
  const m = storyteller.scheduleMajor(s);
  assert.equal(m.nem, n.id); assert.equal(m.inc, 'hollow_horde');
  stepTo(s, m.arriveTick + 1);
  assert.equal(n.returns, 1); assert.deepEqual(n.affixes, ['armoured']);
  const nf = s.foes.find((f) => f.nem === n.id);
  assert.ok(nf, 'the nemesis leads it');
  raiders.killFoe(s, nf, s.col[0]);
  assert.equal(s.st.nemeses.length, 0, 'slain');
  assert.ok(s.items.some((it) => it && it.name && it.name.startsWith(n.name)), 'a named trophy');
});

test('H: letters: a wanderer asks to join (Accept adds them); an unanswered letter takes its default', () => {
  const s = colony('HD-LET');
  const n0 = s.col.length;
  events2.installEvents2();
  const e = storyteller.scheduleIncident(s, 'wanderer', s.tick, s.tick + H1);
  stepTo(s, e.arriveTick + 1);
  const l = letters.pendingLetters(s)[0];
  assert.ok(l && l.choices.length === 2);
  assert.ok(applyCommand(s, { t: 'letter', id: l.id, choice: 0 }).ok);
  assert.equal(s.col.length, n0 + 1);
  storyteller.scheduleIncident(s, 'wanderer', s.tick, s.tick + H1);
  stepTo(s, s.tick + 27 * H1);
  assert.equal(letters.pendingLetters(s).length, 0, 'expired');
  assert.equal(s.col.length, n0 + 1, 'refused by default');
});

test('H: disasters: a cold snap sets the weather; vermin spoil a fifth of loose food; a flood recedes after 2 days', () => {
  const s = colony('HD-DIS');
  const hb = hearth(s);
  storyteller.scheduleIncident(s, 'cold_snap', s.tick, s.tick + H1);
  stepTo(s, s.tick + 2 * H1 + 1);
  assert.equal(weatherKind(s), 'coldsnap');
  const meals = () => s.items.reduce((n, it) => n + (it && it.k === 'meal' ? it.n : 0), 0);
  spawnItem(s, 'meal', null, 0, 20, hb.x - 3, hb.y + 4);
  const m0 = meals();
  logicOf('vermin').start(s, {});
  assert.equal(m0 - meals(), Math.ceil(20 / 5) + (m0 - 20 > 0 ? Math.ceil((m0 - 20) / 5) : 0));
  let river = -1;
  for (let i = 0; i < W * H && river < 0; i++) if (s.L.terrain[i] === TER.DEEP && s.L.roof[i] === 0) river = i;
  if (river >= 0) {
    logicOf('flood').start(s, {});
    const d = s.st.dis.find((x) => x.k === 'flood');
    assert.ok(d && d.tiles.length > 0, 'land under water');
    const [i0, t0] = d.tiles[0];
    assert.equal(s.L.terrain[i0], TER.SHALLOW);
    stepTo(s, d.until + H1 + 1);
    assert.equal(s.L.terrain[i0], t0, 'the water went down');
  }
});

test('H: defences: a spike trap strikes once and waits for a rearm; the ballista pierces a line; a manned tower adds range and warning', () => {
  const s = colony('HD-DEF');
  stepTo(s, 21 * H1);
  const tr = built(s, 'spiketrap', -6, 0);
  assert.notEqual(s.rt.walkCost[tr.y * W + tr.x], 0, 'a trap is stepped on, not walked around (X 2.7)');
  const e = raid(s, 'hollow_horde', ['husk', 'husk', 'husk'], 'core', 1);
  toArrival(s, e);
  const [f1, f2, f3] = s.foes;
  f1.x = ctrW(tr.x); f1.y = ctrW(tr.y); f1.target = null;
  const hp = f1.hp.hp;
  traps.trapsSystem(s);
  assert.equal(hp - f1.hp.hp, traps.TRAP.spike); assert.ok(traps.spent(tr));
  assert.ok(traps.REARM_GIVER.work === 'haul');
  const bl = built(s, 'ballista', 6, -6);
  const c = s.col[0];
  applyCommand(s, { t: 'draft', colIds: [c.id], on: true });
  c.x = ctrW(bl.x - 1); c.y = ctrW(bl.y);
  c.sk[11][0] = 20;   // archery
  for (const [k, f] of [[0, f2], [1, f3]]) { f.x = ctrW(bl.x + 1 + (k + 1) * 3); f.y = ctrW(bl.y + 1); }
  let hit = [];
  for (let k = 0; k < 20 && hit.length < 2; k++) hit = ballista.fireBallista(s, bl);
  assert.ok(hit.length >= 2, `pierced ${hit.length}`);
  const tw = built(s, 'tower', -10, -10);
  c.x = ctrW(tw.x - 1); c.y = ctrW(tw.y);
  assert.ok(towers.towerOf(s, c), 'manned');
  c.soldier = true;
  const side = tw.x < W / 2 ? 'w' : 'e';
  assert.ok(towers.warningBonusH(s, side) >= 2);
});

test('H: squads keep formation; Guard and Retreat are their own orders', () => {
  const s = colony('HD-SQ');
  const ids = s.col.map((c) => c.id);
  applyCommand(s, { t: 'draft', colIds: ids, on: true });
  const hb = hearth(s), t = { x: hb.x - 5, y: hb.y + 5 };
  const tiles = ids.map((_, k) => formationTile(s, t.x, t.y, k)).map((p) => idx(p.x, p.y));
  assert.equal(new Set(tiles).size, ids.length, 'distinct tiles');
  assert.ok(applyCommand(s, { t: 'order', colIds: ids, kind: 'guard', target: t }).ok);
  assert.ok(s.col.every((c) => c.job && c.job.order === 'guard'));
  assert.ok(applyCommand(s, { t: 'order', colIds: ids, kind: 'retreat' }).ok);
  assert.ok(s.col.every((c) => c.job && c.job.order === 'retreat'));
});

test('H: Hearthkeeper: raiders down colonists but never kill them with a blow', () => {
  const s = colony('HD-HK', { difficulty: 'hearthkeeper' });
  stepTo(s, 21 * H1);
  s.colony.hearth.fuel = 0;
  const e = raid(s, 'hollow_horde', ['hollow_knight', 'hollow_knight', 'hollow_knight'], 'core', 1);
  toArrival(s, e);
  assert.equal(s.foes.length, 3);
  const c = s.col[0];
  for (const f of s.foes) { f.x = c.x + 10; f.y = c.y; f.target = c.id; }
  for (let k = 0; k < 2000 && !c.hp.down && s.foes.length; k++) { for (const f of s.foes) { f.x = c.x + 10; f.y = c.y; f.target = c.id; f.hp.hp = f.hp.max; } step(s, 1); }
  assert.ok(c.hp.down, 'downed');
  assert.ok(!c.hp.dead, 'alive');
  assert.ok(c.hp.parts[0] > 0 && c.hp.parts[1] > 0);
});

test('H: a save mid-raid (reavers: ranged, downed, fleeing) continues identically', () => {
  const run = (save) => {
    let s = colony('HD-DET');
    const e = raid(s, 'reaver_raid', ['reaver_club', 'reaver_bow', 'reaver_spear', 'reaver_captain'], 'people', 2);
    const ids = s.col.map((c) => c.id);
    while (s.tick < e.arriveTick + 3 * H1) {
      if (s.tick === e.arriveTick - 30) applyCommand(s, { t: 'draft', colIds: ids, on: true });
      if (s.tick === e.arriveTick + 40 && s.foes.length) applyCommand(s, { t: 'order', colIds: ids, kind: 'attack', target: { id: s.foes[0].id, kind: 'foe' } });
      step(s, 1);
      if (save && s.tick % 397 === 0 && s.raids.length) s = loadBlobSync(saveBlobSync(s));
    }
    return stateHash(s);
  };
  assert.equal(run(true), run(false));
});

test('D: every Stage 2 structure, crop, animal and foe resolves to an art key drawn by a kit part; at most 45 new parts', async () => {
  const tiers = new Set(['camp', 'hamlet', 'village']);
  const missing = [];
  for (const d of CONTENT.all('structure')) {
    if (!tiers.has(d.tier) || d.kind === 'zone' || d.stage === '3' || d.cat === 'prestige') continue;
    const k = artMeta(d.art) && ['struct', 'floor'].includes(artMeta(d.art).kind) ? d.art : `struct.${d.id}`;
    if (!ART[k] || ART[k].placeholder) missing.push(d.id);
  }
  assert.deepEqual(missing, []);
  for (const r of CONTENT.all('raider')) assert.ok(hasArtKey(r.art), r.art);
  for (const a of ['hen', 'goat', 'sheep', 'ox', 'wolf', 'boar', 'deer', 'spider']) assert.ok(ART[`animal.${a}`], a);
  for (const c of ['hearthroot', 'grain', 'greens', 'flax', 'herb', 'glowcap', 'berry', 'apple']) assert.ok(ART[`plant.${c}`], c);
  assert.ok(STAGE2_PARTS.length <= 45, `${STAGE2_PARTS.length} new parts`);
  for (const p of STAGE2_PARTS) assert.ok(KIT_PARTS.includes(p), p);
  const { missingParts } = await import('../../js/engine/art/index.js');
  assert.deepEqual(missingParts(), []);
});

test('H: a Hollow Rift opens on blighted land, spawns its Hollow each night, and a Lore 6+ colonist channels it shut in a game hour', () => {
  const s = colony('HD-RIFT');
  s.colony.tier = 2;
  const hb = hearth(s);
  for (let y = 4; y < 20; y++) for (let x = 2; x < 20; x++) { const i = idx(x, y); if (s.L.roof[i] === 0 && s.rt.walkCost[i]) s.L.blight[i] = 200; }
  stepTo(s, 20 * H1 + 1);
  s.st.queue.length = 0;
  const e = storyteller.scheduleIncident(s, 'hollow_rift', s.tick, s.tick + H1);
  stepTo(s, e.arriveTick + 1);
  const rf = s.foes.find((f) => f.kind === 'rift');
  assert.ok(rf, 'the Rift is on the map');
  assert.ok(s.L.blight[idx(tileOfW(rf.x), tileOfW(rf.y))] > 0, 'on blight');
  for (const f of s.foes.slice()) if (f !== rf) raiders.killFoe(s, f, null);
  const c = s.col[0];
  applyCommand(s, { t: 'draft', colIds: [c.id], on: true });
  c.sk[13][0] = 8;   // lore
  c.x = rf.x - 32; c.y = rf.y;
  assert.ok(applyCommand(s, { t: 'order', colIds: [c.id], kind: 'attack', target: { id: rf.id, kind: 'foe' } }).ok);
  for (let k = 0; k < 700 && s.foes.includes(rf); k++) { c.x = rf.x - 32; c.y = rf.y; for (const f of s.foes.slice()) if (f !== rf) raiders.killFoe(s, f, null); step(s, 1); }
  assert.ok(!s.foes.includes(rf), 'closed');
  assert.ok(hb, 'the hold stands');
});
