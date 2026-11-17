// Workstream H (threats and defence), Stage 0 skeletons and the first Stage 1a acceptance checks
// (14.6 row H): a whole-tick flow field equals a reference Dijkstra; a saved and reloaded field is
// byte-identical. Also: threat points (9.2), the scripted first omen and arrival (9.1), raid end,
// the lit-tile bonus, cast selectors and nemesis cap.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createColony, initRuntime, raidLive } from '../../js/game/core/state.js';
import { step } from '../../js/game/core/sim.js';
import { resetBus, BUS, product } from '../../js/game/core/bus.js';
import { resetAppliers, applyCommand } from '../../js/game/core/commands.js';
import { newColonist, newFoe, FIX } from '../../js/game/core/schema.js';
import { idx, TER, W, H, N, DX8, DY8, ctrW } from '../../js/game/core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { installWorld } from '../../js/game/world/terrain.js';
import { stepCost, SIDE } from '../../js/game/world/pass.js';
import { saveBlobSync, loadBlobSync } from '../../js/game/save/colonysave.js';
import { installWork } from '../../js/game/work/index.js';
import { installPeople } from '../../js/game/people/index.js';
import { installThreat, flow, raidplan, raiders, cast, nemesis } from '../../js/game/threat/index.js';
import { installDefence, braziers } from '../../js/game/defence/index.js';

beforeEach(() => { resetBus(); resetAppliers(); installWorld(); });

/** 32 x 32 grass with a rock wall at x = 12 (a gap at y = 20) and marsh patches. */
function walled(seed = 'H-1') {
  const s = createColony(seed, { w: 32 });
  for (let y = 0; y < 32; y++) if (y !== 20) s.L.terrain[idx(12, y)] = TER.ROCK;
  for (let y = 3; y < 9; y++) for (let x = 20; x < 26; x++) s.L.terrain[idx(x, y)] = TER.MARSH;
  initRuntime(s);
  return s;
}

/** Reference: binary-heap Dijkstra with the same step rule as flow.js. */
function referenceField(s, goals) {
  const wc = s.rt.walkCost, f = new Array(N).fill(0xffff), heap = [];
  const push = (d, t) => { heap.push([d, t]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const sc = (i) => stepCost(wc[i], SIDE.HOS);
  for (const g of goals) { f[g] = 0; push(0, g); }
  while (heap.length) {
    const [d, t] = pop();
    if (d !== f[t]) continue;
    const c0 = sc(t), enter = c0 === 0 ? (goals.includes(t) ? 10 : 0) : c0;
    if (!enter) continue;
    const tx = t % W, ty = (t / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = tx + DX8[k], ny = ty + DY8[k];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!sc(j)) continue;
      if (k >= 4 && (!sc(ty * W + nx) || !sc(ny * W + tx))) continue;
      const nd = d + (k >= 4 ? ((enter * 14 + 5) / 10) | 0 : enter);
      if (nd < f[j]) { f[j] = nd; push(nd, j); }
    }
  }
  return f;
}

test('a whole-tick flow field equals a reference Dijkstra', () => {
  const s = walled();
  for (const goals of [[idx(28, 28)], [idx(2, 2), idx(30, 1)], [idx(12, 5)]]) {
    const f = flow.buildFlowField(s, goals);
    assert.deepEqual(Array.from(f), referenceField(s, goals));
  }
  const f = flow.buildFlowField(s, [idx(28, 28)]);
  assert.equal(f[idx(12, 5)], flow.FLOW_UNREACHED, 'rock is unreachable');
  assert.ok(f[idx(2, 2)] < flow.FLOW_UNREACHED, 'the gap connects both sides');
  let i = idx(2, 2), steps = 0;                     // walking downhill reaches the goal
  while (f[i] > 0 && steps < 200) { i = flow.flowStep(f, i); steps++; }
  assert.equal(i, idx(28, 28));
});

test('threat points follow 9.2', () => {
  const s = walled();
  assert.equal(raidplan.threatPoints(s, { wealth: 2000, able: 3, day: 5, difficultyPct: 100, storytellerPct: 100, adjPct: 100 }), 66);
  assert.equal(raidplan.threatPoints(s, { wealth: 60000, able: 8, day: 30, difficultyPct: 100, storytellerPct: 100, adjPct: 100 }), 40 + 430 + 70 + 60);
  assert.equal(raidplan.threatPoints(s, { wealth: 0, able: 0, day: 0, difficultyPct: 35, storytellerPct: 100, adjPct: 100 }), 40, 'never below the minimum');
  assert.equal(raidplan.threatPoints(s, { wealth: 1e9, able: 40, day: 900, difficultyPct: 140, storytellerPct: 130, adjPct: 115 }), 4000, 'never above the maximum');
});

test('first omen day 2 18:00, sighted, arrival day 3 21:00, repelled; the saved field reloads byte-identical', () => {
  installThreat({ storyteller: true });
  const s = walled('H-STORY');
  s.col.push(newColonist(1, { x: ctrW(28), y: ctrW(28) })); s.next.col = 2;
  const omen = TICKS_PER_DAY + 18 * TICKS_PER_HOUR, arrive = 2 * TICKS_PER_DAY + 21 * TICKS_PER_HOUR;
  step(s, omen - 1);
  assert.equal(s.st.queue[0].stage, 'queued');
  step(s, 1);
  assert.equal(s.st.queue[0].stage, 'omen');
  assert.ok(s.rt.events.some((e) => e.name === 'raidWarn' && e.data.arriveTick === arrive));
  assert.equal(s.raids[0].stage, 'warned'); assert.equal(raidLive(s), false);
  step(s, arrive - 4 * TICKS_PER_HOUR - s.tick);
  assert.equal(s.raids[0].stage, 'sighted'); assert.equal(raidLive(s), true);
  assert.equal(s.rt.flow.length, 1, 'the route preview field exists from Sighted');
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.equal(s2.rt.flow.length, 1);
  assert.ok(s2.rt.flow[0].f instanceof Uint16Array);
  assert.deepEqual(Buffer.from(s2.rt.flow[0].f.buffer), Buffer.from(s.rt.flow[0].f.buffer), 'byte-identical after save and load');
  assert.equal(s2.rt.flow[0].built, s.rt.flow[0].built);
  step(s, arrive - s.tick);
  const r = s.raids[0];
  assert.equal(r.stage, 'active');
  assert.ok(r.members.length >= 2 && s.foes.length === r.members.length, `members ${r.members.length}`);
  assert.ok(r.pts <= 60);
  step(s, 40);
  for (const f of s.foes.slice()) raiders.damageFoe(s, f, 1000, 'cut', null);
  step(s, 1);
  assert.equal(s.raids.length, 0);
  assert.equal(s.st.history.length, 1); assert.equal(s.st.history[0].result, 'repelled');
  assert.ok(s.rt.events.some((e) => e.name === 'raidEnd'));
  assert.equal(s.rt.flow.length, 0, 'fields drop when no raid is live');
});

test('Hollow take +25% on lit tiles (BUS.dmgMult)', () => {
  installDefence();
  const s = walled();
  const husk = newFoe(1, 'husk', { x: ctrW(5), y: ctrW(5), hp: { hp: 40, max: 40 } });
  assert.equal(product(BUS.dmgMult, s, null, husk, 'cut'), 1);
  s.rt.light[idx(5, 5)] = 2;
  assert.equal(product(BUS.dmgMult, s, null, husk, 'cut'), 1.25);
  const delver = newFoe(2, 'delver', { x: ctrW(5), y: ctrW(5), hp: { hp: 50, max: 50 } });
  assert.equal(braziers.litBonus(s, null, delver), 1, 'only the Hollow');
});

test('cast selectors break ties by colonist id; the nemesis cap retires the oldest', () => {
  const s = walled();
  for (let id = 1; id <= 4; id++) s.col.push(newColonist(id, { mood: (id === 3 ? 20 : 60) * FIX }));
  assert.equal(cast.select(s, 'lowestMood'), 3);
  assert.equal(cast.select(s, 'newest'), 4);
  s.col[1].sk[4][0] = 9; s.col[3].sk[4][0] = 9;
  assert.equal(cast.select(s, 'bestCrafter:smithing'), 2);
  assert.deepEqual(cast.selectCast(s, { target: 'lowestMood', kin: 'newest' }), { kin: 4, target: 3 });
  for (let k = 0; k < 7; k++) nemesis.makeNemesis(s, { kind: 'reaver' });
  assert.equal(s.st.nemeses.length, 6);
  assert.equal(s.st.nemeses[0].id, 2, 'the first one retired');
});

test('drafted colonists take a Move order through E\'s jobs', () => {
  installWork({ think: false, stubMove: true }); installPeople(); installThreat();
  const s = walled();
  s.col.push(newColonist(1, { x: ctrW(2), y: ctrW(2) })); s.next.col = 2;
  assert.equal(applyCommand(s, { t: 'order', colIds: [1], kind: 'move', target: { x: 6, y: 2 } }).ok, false, 'needs drafting');
  assert.ok(applyCommand(s, { t: 'draft', colIds: [1], on: true }).ok);
  assert.ok(applyCommand(s, { t: 'order', colIds: [1], kind: 'move', target: { x: 6, y: 2 } }).ok);
  assert.equal(s.col[0].job.type, 'order');
  step(s, 200);
  assert.equal(Math.floor(s.col[0].x / 32), 6);
});

// ---- Stage 1a (14.6 row H): the storyteller's majors behind the flag; flow fields on a real map ----
import { storyteller } from '../../js/game/threat/index.js';
import { dayOf, hourOf } from '../../js/game/core/time.js';
import { foundColony, installSim } from '../../js/game/core/setup.js';
import { rtEqual } from '../../js/game/core/rtcontract.js';

const repel = (s) => { for (const f of s.foes.slice()) raiders.damageFoe(s, f, 1000, 'cut', null); step(s, 1); };

test('The Steady Flame: after the first horde, the next major lands 5-7 days later with a 12-24 h omen at night', () => {
  installThreat({ storyteller: true });
  const s = walled('H-STEADY');
  s.col.push(newColonist(1, { x: ctrW(28), y: ctrW(28) })); s.next.col = 2;
  step(s, 2 * TICKS_PER_DAY + 21 * TICKS_PER_HOUR - s.tick);
  assert.equal(s.raids[0].stage, 'active');
  step(s, 20); repel(s);
  assert.equal(s.st.lastMajorDay, 2); assert.equal(s.st.tension, 40);
  step(s, TICKS_PER_HOUR - (s.tick % TICKS_PER_HOUR));     // the next hourly run rolls the window
  const md = s.st.cooldowns.majorDay;
  assert.ok(md >= 2 + 5 && md <= 2 + 7, `next major day ${md}`);
  let guard = 0;
  while (!s.st.queue.length && guard++ < 24 * 12) step(s, TICKS_PER_HOUR);
  const e = s.st.queue[0];
  assert.ok(e, 'a major is queued');
  assert.equal(e.inc, 'hollow_horde');
  assert.equal(hourOf(e.arriveTick), 21, 'a horde arrives at night');
  assert.ok(dayOf(e.arriveTick) >= md, 'not before the window');
  const lead = (e.arriveTick - e.warnTick) / TICKS_PER_HOUR;
  assert.ok(lead >= 12 && lead <= 24, `warned ${lead} h ahead`);
  assert.ok(e.warnTick >= s.tick, 'the omen is still ahead');
  assert.equal(s.st.cooldowns['inc:hollow_horde'], dayOf(e.arriveTick) + 3, 'the incident cooldown');
  assert.equal(storyteller.majorPending(s), true);
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(s2.st.queue, s.st.queue, 'the queue survives a save');
  assert.equal(s2.st.cooldowns.majorDay, md);
});

test('tension above 60 pushes the next major back a day at a time; it decays 8 a day; a death adds 20', () => {
  installThreat({ storyteller: true });
  const s = walled('H-TENSION');
  s.col.push(newColonist(1, { x: ctrW(28), y: ctrW(28) })); s.next.col = 2;
  s.st.history.push({ inc: 'hollow_horde', cat: 'major', day: 0, result: 'repelled', deaths: 0, downed: false, after: [] });
  s.st.lastMajorDay = 0; s.st.tension = 100;
  step(s, TICKS_PER_HOUR - (s.tick % TICKS_PER_HOUR));
  const md0 = s.st.cooldowns.majorDay;
  assert.ok(md0 >= 5 && md0 <= 7);
  step(s, md0 * TICKS_PER_DAY + TICKS_PER_HOUR - s.tick);
  // tension fell 8 at each midnight: 100 - 8 x md0 > 60 while md0 <= 4 days, so check the rule directly
  assert.equal(s.st.tension, Math.max(0, 100 - 8 * md0));
  if (s.st.tension > 60) assert.equal(s.st.queue.length, 0, 'pushed back');
  s.st.queue.length = 0; s.raids.length = 0; s.st.cooldowns.majorDay = dayOf(s.tick); s.st.tension = 61;
  step(s, TICKS_PER_HOUR);
  assert.equal(s.st.queue.length, 0, 'tension 61: no major');
  assert.equal(s.st.cooldowns.majorDay, dayOf(s.tick) + 1, 'moved back one day');
  s.st.tension = 60; s.st.cooldowns.majorDay = dayOf(s.tick); delete s.st.cooldowns['inc:hollow_horde'];
  step(s, TICKS_PER_HOUR);
  assert.equal(s.st.queue.length, 1, 'tension 60: scheduled');
  const t0 = s.st.tension;
  for (const fn of BUS.kill) fn(s, s.col[0], null);
  assert.equal(s.st.tension, Math.min(100, t0 + 20));
  for (const fn of BUS.kill) fn(s, newFoe(9, 'husk'), null);
  assert.equal(s.st.tension, Math.min(100, t0 + 20), 'a dead foe is not a death in the colony');
});

test('Stage 1a installs no storyteller: nothing hostile is ever queued on a founded colony', () => {
  resetBus(); resetAppliers();
  installSim({ stage: '1a', reset: true });
  const s = foundColony({ seed: 'H-1A' });
  step(s, 3 * TICKS_PER_DAY);
  assert.equal(s.st.queue.length, 0); assert.equal(s.raids.length, 0); assert.equal(s.foes.length, 0);
  assert.equal(s.rt.flow.length, 0);
});

test('flow field on a generated 128 map: equals the reference Dijkstra, builds in one tick, reloads byte-identical mid-raid', () => {
  resetBus(); resetAppliers();
  installSim({ stage: '1b', reset: true });
  const s = foundColony({ seed: 'H-MAP' });
  const goals = flow.goalTiles(s, 'core');
  const f = flow.buildFlowField(s, goals);
  const ref = referenceField(s, goals);
  let same = 0, reach = 0;
  for (let i = 0; i < N; i++) { if (f[i] === ref[i]) same++; if (f[i] !== flow.FLOW_UNREACHED) reach++; }
  assert.equal(same, N, 'every tile equals the reference');
  assert.ok(reach > N / 4, `reachable ${reach}`);
  for (let k = 0; k < 20; k++) flow.buildFlowField(s, goals, SIDE.HOS, f);   // warm up
  const t0 = process.hrtime.bigint();
  const runs = 50;
  for (let k = 0; k < runs; k++) flow.buildFlowField(s, goals, SIDE.HOS, f);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
  console.log(`# flow field whole build at 128: ${ms.toFixed(3)} ms (bench gate < 0.6 ms desktop)`);
  assert.ok(ms < 3, `${ms} ms`);
  // a live raid: field in rt.flow, saved, loaded, identical; the raid continues identically
  step(s, TICKS_PER_DAY + 18 * TICKS_PER_HOUR - s.tick);
  step(s, 2 * TICKS_PER_DAY + 21 * TICKS_PER_HOUR - 3 * TICKS_PER_HOUR - s.tick);
  assert.ok(raidLive(s), 'sighted');
  assert.equal(s.rt.flow.length, 1);
  const fl = s.rt.flow[0];
  assert.deepEqual(Array.from(fl.f), referenceField(s, flow.goalTiles(s, fl.goal)), 'the live field equals the reference');
  const s2 = loadBlobSync(saveBlobSync(s));
  assert.deepEqual(Buffer.from(s2.rt.flow[0].f.buffer), Buffer.from(fl.f.buffer));
  assert.equal(s2.rt.flow[0].stamp, fl.stamp); assert.equal(s2.rt.flow[0].built, fl.built);
  step(s, 3 * TICKS_PER_HOUR + 200); step(s2, 3 * TICKS_PER_HOUR + 200);
  assert.ok(s.foes.length > 0, 'the horde is on the map');
  assert.deepEqual(s2.foes.map((x) => [x.id, x.x, x.y]), s.foes.map((x) => [x.id, x.x, x.y]), 'foes walk the same after a reload');
  assert.ok(rtEqual(s2.rt.flow, s.rt.flow));
});
