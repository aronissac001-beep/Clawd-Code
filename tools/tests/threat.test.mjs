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
