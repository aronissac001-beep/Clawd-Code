// Stage Z1 step E11 (EMBERCROWN-FORTRESS.md 8.3; owner H): hierarchical flow and threats on levels. Oracle:
//   - a horde reaches the Hearth on z-3 by the stairs;
//   - with the stairs blocked by a locked gate it smashes the gate;
//   - an underground raid that loses half its members routs;
//   - cache-drop mid-raid on two levels (hflow caches are pure: a cold clone continues to the same hashes);
//   - region-level flow < 0.6 ms, local fields p95 < 40 us, worst-case uncapped tick (60 foes in distinct
//     regions) < 2 ms desktop, on the 128 x 128 x 20 stub fortress (hflow-scene.mjs; bench --scene=hflow).
// Plus: from every hostile-walkable voxel the flow walk ends at the goal without a loop, exactly where the
// region components say it can; entries at the surface z of an edge column; combat on the same z only;
// daylight harms only sky-exposed voxels; D = 1 is untouched (the D = 1 tests cover it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim } from '../../js/game/core/setup.js';
import { createColony, initRuntime, stateHash, raidLive } from '../../js/game/core/state.js';
import { step } from '../../js/game/core/sim.js';
import { idx, TER, PLANE, W, ctrW } from '../../js/game/core/grid.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { newColonist } from '../../js/game/core/schema.js';
import { savedKeys } from '../../js/game/core/rtcontract.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { storyteller, raidplan, raiders } from '../../js/game/threat/index.js';
import * as flow from '../../js/game/threat/flow.js';
import * as HF from '../../js/game/threat/hflow.js';
import { unroofed } from '../../js/game/threat/horde.js';
import { link, setLever, GATE } from '../../js/game/world/mechanisms.js';
import { hflowBench } from './hflow-scene.mjs';

const H1 = TICKS_PER_HOUR, Z_TOP = 4, Z_HALL = 1;
/**
 * A 32 x 32 x 5 hold: open grass on z 4 (the surface), rock below; a stair column at (8, 8) from z 4 down to
 * z 1; on z 1 a 2-wide corridor east (x 9-14, y 8-9) into a hall (x 15-24, y 4-13) with the Hearth at (19, 7).
 * gate: an iron-bound gate across the corridor at x 10 (out of the Hearth's night shot), locked by a lever.
 */
function hold({ gate = false, seed = 'E11' } = {}) {
  installSim({ stage: '2', reset: true });
  const s = createColony(seed, { w: 32, d: 5, zS: Z_TOP, terrain: TER.ROCK });
  s.L.mat.fill(3);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) s.L.terrain[idx(x, y, Z_TOP)] = TER.GRASS;
  s.L.terrain[idx(8, 8, Z_TOP)] = TER.STAIR_D;
  for (let z = Z_HALL + 1; z < Z_TOP; z++) s.L.terrain[idx(8, 8, z)] = TER.STAIR_UD;
  s.L.terrain[idx(8, 8, Z_HALL)] = TER.STAIR_U;
  for (let y = 8; y <= 9; y++) for (let x = 9; x <= 14; x++) s.L.terrain[idx(x, y, Z_HALL)] = TER.ROUGH;
  for (let y = 4; y <= 13; y++) for (let x = 15; x <= 24; x++) s.L.terrain[idx(x, y, Z_HALL)] = TER.ROUGH;
  s.L.fog.fill(255);
  s.tick = 21 * H1;   // 21:00, night
  initRuntime(s);
  const hb = addBuilding(s, 'hearth', 19, 7, 0, null, { st: 'done', z: Z_HALL });
  s.colony.hearth = { id: hb.id, lvl: 1, fuel: 5000 };
  if (gate) {
    const g = addBuilding(s, 'gate', 10, 8, 1, 'granite', { st: 'done', z: Z_HALL });
    const lv = addBuilding(s, 'lever', 20, 12, 0, 'iron', { st: 'done', z: Z_HALL });
    assert.equal(link(s, g.id, lv.id), null);
    setLever(s, lv.id, GATE.LOCKED);
    s.gateId = g.id;
  }
  initRuntime(s);
  return s;
}
function horde(s, members, inH = 1) {
  s.st.queue.length = 0;
  const e = storyteller.scheduleIncident(s, 'hollow_horde', s.tick, s.tick + inH * H1);
  const i = raidplan.edgeTile(s, 'w');
  e.plan = { pts: 100, edge: { side: 'w', i }, goal: 'core', members, nem: null };
  return e;
}
const stepTo = (s, t) => { if (t > s.tick) step(s, t - s.tick); };
const hearthNear = (s, f) => (f.z | 0) === Z_HALL && Math.max(Math.abs(raiders.foeTile(f) % W - 20), Math.abs((((raiders.foeTile(f) % PLANE) / W) | 0) - 8)) <= 2;

test('E11: raids enter at the surface z of an edge column', () => {
  const s = hold();
  const i = raidplan.edgeTile(s, 'w');
  assert.equal((i / PLANE) | 0, Z_TOP, 'the entry is on the surface level');
  assert.equal(i % W, 0);
  const e = horde(s, ['husk', 'husk']);
  stepTo(s, e.arriveTick + 1);
  assert.ok(s.foes.length === 2 && s.foes.every((f) => f.z === Z_TOP), 'members stand on the surface');
  assert.equal(s.rt.flow.length, 0, 'D > 1: no flow field in rt (F5: never saved)');
});

test('E11: the flow walk from every hostile voxel ends at the goal, exactly where the components allow', () => {
  const s = hold();
  const goals = flow.goalTiles(s, 'core');
  const lvl = flow.hfield(s, 'core');
  assert.ok(lvl && lvl.h);
  const lab = s.rt.regionH, comp = s.rt.regionGraph.hos.comp;
  // the components that touch the Hearth
  const near = new Set();
  for (const g of goals) for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) { const r = lab[g + d]; if (r) near.add(comp[r]); }
  let walked = 0, reach = 0;
  for (let i = 0; i < lab.length; i++) {
    if (!lab[i]) continue;
    const ok = near.has(comp[lab[i]]), v = HF.hValue(s, lvl, i);
    assert.equal(v < HF.INF, ok, `reachability at ${i}`);
    if (!ok) continue;
    reach++;
    let j = i, n = 0, last = v;
    for (; n < 400; n++) {
      const k = HF.hStep(s, lvl, j);
      if (k < 0) break;
      if (!lab[k]) { j = k; break; }   // the Hearth itself (claw it)
      const kv = HF.hValue(s, lvl, k);
      assert.ok(lab[k] !== lab[j] || kv < last, 'strictly downhill inside a region');
      j = k; last = kv;
    }
    assert.ok(n < 400, 'no loop');
    assert.ok(goals.includes(j), `the walk from ${i} ends on the Hearth (at ${j})`);
    walked++;
  }
  assert.ok(reach > 300 && walked === reach, `walked ${walked} of ${reach}`);
});

test('E11: a horde reaches the Hearth on z-3 by the stairs', () => {
  const s = hold();
  const e = horde(s, ['husk', 'husk', 'husk']);
  stepTo(s, e.arriveTick + 1);
  const route = flow.routeTiles(s, s.raids[0]);
  assert.ok(route.length > 20 && ((route[route.length - 1] / PLANE) | 0) === Z_HALL, 'the route preview goes down to the hall');
  let at = -1;
  for (let t = 0; t < 4 * H1 && at < 0; t++) { step(s, 1); if (s.foes.some((f) => hearthNear(s, f) && f.st.bt === s.colony.hearth.id)) at = t; }
  assert.ok(at >= 0, 'a husk claws the Hearth');
  const hb = s.bld[s.colony.hearth.id];
  stepTo(s, s.tick + 200);
  assert.ok(hb.hp < 3000, 'the Hearth is scarred');
  assert.ok(s.foes.every((f) => f.z === Z_HALL), 'every member came down');
});

test('E11: with the stairs blocked by a locked gate the horde smashes the gate', () => {
  const s = hold({ gate: true });
  const g = s.bld[s.gateId];
  assert.ok(flow.smashable(g), 'a locked gate is a wall to hostiles until broken');
  const e = horde(s, ['husk', 'husk', 'husk', 'husk', 'husk', 'husk']);
  stepTo(s, e.arriveTick + 1);
  let broke = -1, clawed = -1;
  for (let t = 0; t < 8 * H1 && clawed < 0; t++) {
    step(s, 1);
    if (broke < 0 && !s.bld[s.gateId]) broke = t;
    if (broke >= 0 && s.foes.some((f) => hearthNear(s, f))) clawed = t;
  }
  assert.ok(broke >= 0, 'the gate was smashed');
  assert.ok(clawed > broke, 'then they reached the Hearth');
});

test('E11: an underground raid that loses half its members routs, and climbs back out', () => {
  const s = hold();
  const e = horde(s, ['husk', 'husk', 'husk', 'husk', 'husk', 'husk']);
  stepTo(s, e.arriveTick + 1);
  const r = s.raids[0];
  for (let t = 0; t < 3 * H1 && !s.foes.every((f) => f.z < Z_TOP); t++) step(s, 1);
  assert.ok(s.foes.every((f) => f.z < Z_TOP), 'all underground');
  for (const f of s.foes.slice(0, 3)) raiders.killFoe(s, f, null);
  stepTo(s, s.tick + 40);
  assert.equal(r.stage, 'retreat', `routed (morale ${r.morale})`);
  assert.ok(r.morale <= 25);
  let out = false;
  for (let t = 0; t < 3 * H1 && !out; t++) { step(s, 1); out = !s.raids.includes(r) || s.foes.some((f) => f.z === Z_TOP); }
  assert.ok(out, 'the survivors climb back to the surface');
});

test('E11: daylight harms only on sky-exposed voxels; combat on the same z', () => {
  const s = hold();
  const e = horde(s, ['husk', 'husk']);
  stepTo(s, e.arriveTick + 1);
  const [a, b] = s.foes;
  b.z = Z_HALL; b.x = ctrW(20); b.y = ctrW(12);
  assert.equal(unroofed(s, a), true, 'on the surface');
  assert.equal(unroofed(s, b), false, 'in the hall: no sky');
  // a colonist right under a surface husk is not its target
  const c = newColonist(s.next.col++, { name: 'Under', x: a.x, y: a.y, z: Z_TOP - 1 });
  s.col.push(c);
  assert.equal(raiders.foeTarget(s, a), null, 'no target through rock');
  c.z = Z_TOP;
  s.tick += (5 - ((s.tick + a.id) % 5)) % 5;
  assert.equal(raiders.foeTarget(s, a), c, 'same level: target');
});

/** A load-like clone (cache-drop.test.mjs dropClone): rt rebuilt by initRuntime, saved keys put back. */
function dropClone(s) {
  const { rt, ...rest } = s;
  const c = structuredClone(rest);
  initRuntime(c);
  for (const k of savedKeys(raidLive(s))) c.rt[k] = structuredClone(rt[k]);
  return c;
}
test('E11: cache-drop mid-raid on two levels', () => {
  const s = hold({ gate: true });
  const e = horde(s, ['husk', 'husk', 'husk', 'husk', 'husk', 'husk']);
  stepTo(s, e.arriveTick + 1);
  let two = false;
  for (let t = 0; t < 3 * H1 && !two; t++) { step(s, 1); const zs = new Set(s.foes.map((f) => f.z)); two = zs.size >= 2 && zs.has(Z_TOP); }
  assert.ok(two, 'members on two levels');
  const drops = [];
  for (let k = 0; k < 4; k++) { drops.push({ at: s.tick, c: dropClone(s) }); step(s, 37 + k * 11); }
  const ref = new Map();
  const end = s.tick + 1500;
  for (; s.tick < end;) { step(s, 1); if (s.tick % 100 === 0) ref.set(s.tick, stateHash(s)); }
  for (const d of drops) {
    const c = d.c;
    let bad = -1;
    for (; c.tick < end;) { step(c, 1); if (c.tick % 100 === 0 && ref.has(c.tick) && ref.get(c.tick) !== stateHash(c)) { bad = c.tick; break; } }
    assert.equal(bad, -1, `drop at ${d.at}: hash differs at ${bad}`);
  }
});

// Timings are only enforced with HFLOW_BENCH=1 (or `node tools/tests/hflow-scene.mjs`, the bench's hflow scene):
// the gate runs the unit tests in parallel, where a wall-clock threshold is noise. Here: the scenes and reachability.
const TIMED = process.env.HFLOW_BENCH === '1';
for (const scene of ['stub', 'mapgen3']) {
  test(`E11: hflow bench scene (${scene})${TIMED ? ': region level < 0.6 ms, local p95 < 40 us, 60 foes in 60 regions < 2 ms' : ''}`, () => {
    const R = hflowBench({ scene, seed: scene === 'stub' ? 7 : 3 });
    console.log('hflow', scene, JSON.stringify(R));
    assert.ok(R.reachHearth, 'the scene Hearth is reachable from the surface edge');
    assert.equal(R.foes, 60);
    if (!TIMED) return;
    assert.ok(R.regionLevelP95Ms < 0.6, `region level p95 ${R.regionLevelP95Ms} ms`);
    assert.ok(R.localP95Us < 40, `local p95 ${R.localP95Us} us`);
    assert.ok(R.worst60Ms < 2, `worst tick ${R.worst60Ms} ms`);
  });
}
