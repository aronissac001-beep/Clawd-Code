// Stage Z3 step Z3.2 (EMBERCROWN-FORTRESS.md 8.5; owner H): vertical defence. Oracle:
//   - an archer on z+1 hits a foe at z through a channel and not through rock;
//   - a wyvern enters a shaft but no voxel with cover >= 1;
//   - sappers repelled on 3 of 5 seeds.
// Plus: murder holes pass shots, shots stop past 2 levels, a ledge perch gives cover, delvers cut stairs
// down (stone work x 4 per level), and the defended raid is deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim } from '../../js/game/core/setup.js';
import { createColony, initRuntime, stateHash } from '../../js/game/core/state.js';
import { step } from '../../js/game/core/sim.js';
import { idx, TER, PLANE, W, ctrW, tileOfW } from '../../js/game/core/grid.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { newColonist } from '../../js/game/core/schema.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { storyteller, raidplan } from '../../js/game/threat/index.js';
import { fightSystem } from '../../js/game/threat/fight.js';
import { coverAt as voxCover } from '../../js/game/world/vertical.js';
import { shotClear, flyStep, flyerMay, onPerch, FORT } from '../../js/game/defence/vertical.js';
import { coverAt } from '../../js/game/defence/towers.js';
import { digDown, digTicks } from '../../js/game/threat/sappers.js';
import { skillIndex } from '../../js/game/people/skills.js';

const H1 = TICKS_PER_HOUR, Z_TOP = 4, Z_HALL = 1, Z_GAL = 2;
/**
 * The E11 hold (32 x 32 x 5: grass on z 4, rock below, a stair column at (8, 8) to z 1, a corridor x 9-14,
 * y 8-9 on z 1 into a hall x 15-24, y 4-13 with the Hearth at (19, 7)), plus a sealed gallery on z 2 at
 * x 10-14, y 7 over the corridor's north wall. holes: the gallery's south voxels (x 10-14, y 8, z 2) are
 * channelled to open air over the corridor. shaft: an open shaft at (20, 10) from z 4 down into the hall.
 */
function hold({ holes = true, shaft = false, seed = 'Z32' } = {}) {
  installSim({ stage: '2', reset: true });
  const s = createColony(seed, { w: 32, d: 5, zS: Z_TOP, terrain: TER.ROCK });
  s.L.mat.fill(3);
  const T = s.L.terrain;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) T[idx(x, y, Z_TOP)] = TER.GRASS;
  T[idx(8, 8, Z_TOP)] = TER.STAIR_D;
  for (let z = Z_HALL + 1; z < Z_TOP; z++) T[idx(8, 8, z)] = TER.STAIR_UD;
  T[idx(8, 8, Z_HALL)] = TER.STAIR_U;
  for (let y = 8; y <= 9; y++) for (let x = 9; x <= 14; x++) T[idx(x, y, Z_HALL)] = TER.ROUGH;
  for (let y = 4; y <= 13; y++) for (let x = 15; x <= 24; x++) T[idx(x, y, Z_HALL)] = TER.ROUGH;
  for (let x = 10; x <= 14; x++) T[idx(x, 7, Z_GAL)] = TER.ROUGH;
  if (holes) for (let x = 10; x <= 14; x++) T[idx(x, 8, Z_GAL)] = TER.AIR;
  if (shaft) for (let z = Z_HALL + 1; z <= Z_TOP; z++) T[idx(20, 10, z)] = TER.AIR;
  s.L.fog.fill(255);
  s.tick = 21 * H1;
  initRuntime(s);
  const hb = addBuilding(s, 'hearth', 19, 7, 0, null, { st: 'done', z: Z_HALL });
  s.colony.hearth = { id: hb.id, lvl: 1, fuel: 5000 };
  initRuntime(s);
  return s;
}
const at = (x, y, z) => ({ x: ctrW(x), y: ctrW(y), z });
function archer(s, x, y, z, name = 'Archer') {
  const c = newColonist(s.next.col++, { name, x: ctrW(x), y: ctrW(y), z });
  c.drafted = true; c.soldier = true;
  c.gear = c.gear || {}; c.gear.slots = { ...(c.gear.slots || {}), weapon: 'longbow' };
  c.sk[skillIndex('archery')][0] = 8;   // a trained archer
  s.col.push(c);
  return c;
}
function raid(s, kind, members, goal) {
  s.st.queue.length = 0;
  const e = storyteller.scheduleIncident(s, kind, s.tick, s.tick + H1);
  e.plan = { pts: 150, edge: { side: 'w', i: raidplan.edgeTile(s, 'w') }, goal, members, nem: null };
  step(s, e.arriveTick + 1 - s.tick);
  return e;
}

test('Z3.2: an archer on z+1 hits a foe at z through a channel and not through rock', () => {
  for (const holes of [true, false]) {
    const s = hold({ holes });
    raid(s, 'hollow_horde', ['husk'], 'core');
    const f = s.foes[0];
    Object.assign(f, at(12, 9, Z_HALL));
    f.target = null;
    const c = archer(s, 12, 7, Z_GAL);
    assert.equal(shotClear(s, c, f), holes, holes ? 'the channel lets the shot down' : 'rock between');
    const hp0 = f.hp.hp;
    for (let k = 0; k < 400 && f.hp.hp > 0; k++) { s.tick++; Object.assign(f, at(12, 9, Z_HALL)); fightSystem(s); }
    if (holes) assert.ok(f.hp.hp < hp0, `hit through the channel (${hp0} -> ${f.hp.hp})`);
    else assert.equal(f.hp.hp, hp0, 'never hit through rock');
  }
});

test('Z3.2: shots stop past 2 levels, need an open floor, and murder holes pass them', () => {
  const s = hold();
  const top = at(12, 7, Z_GAL), low = at(12, 9, Z_HALL);
  assert.equal(shotClear(s, top, low), true);
  assert.equal(shotClear(s, low, top), true, 'symmetric');
  assert.equal(shotClear(s, at(10, 7, Z_GAL), at(8, 9, Z_HALL)), false, 'rock over the corridor mouth');
  assert.equal(shotClear(s, at(12, 9, 4), low), false, `more than ${FORT.maxDrop} levels`);
  // a murder hole: a built floor over the hole that shots pass
  const s2 = hold({ holes: false });
  const i = idx(12, 8, Z_GAL);
  s2.L.terrain[i] = TER.ROUGH;
  s2.bld.push({ id: s2.bld.length, def: 'murderhole', st: 'done', x: 12, y: 8, z: Z_GAL });
  s2.rt.occ[i] = s2.bld.length - 1;
  assert.equal(shotClear(s2, top, low), true, 'through the murder hole');
});

test('Z3.2: a ledge perch over a drop gives cover', () => {
  const s = hold();
  const c = archer(s, 12, 7, Z_GAL);
  assert.equal(onPerch(s, c), true);
  assert.ok(coverAt(s, c) < 100);
  const d = archer(s, 20, 12, Z_HALL, 'Floor');
  assert.equal(onPerch(s, d), false);
  assert.equal(coverAt(s, d), 100);
});

test('Z3.2: a wyvern enters a shaft but no voxel with cover >= 1', () => {
  const s = hold({ shaft: true });
  const f = { x: ctrW(2), y: ctrW(2), z: Z_TOP };
  let minZ = Z_TOP;
  const seen = new Set();
  const goals = [[20, 10, Z_HALL, 600], [19, 7, Z_HALL, 400], [12, 9, Z_HALL, 400]];
  for (const [gx, gy, gz, n] of goals) for (let k = 0; k < n; k++) {
    flyStep(s, f, ctrW(gx), ctrW(gy), gz, 6);
    const v = idx(tileOfW(f.x), tileOfW(f.y), f.z);
    seen.add(v);
    minZ = Math.min(minZ, f.z);
  }
  assert.equal(minZ, Z_HALL, 'down the shaft to the hall floor');
  for (const v of seen) assert.equal(voxCover(s, v), 0, `voxel ${v} has cover`);
  assert.equal(flyerMay(s, idx(21, 10, Z_HALL)), false, 'the roofed hall is closed to flyers');
});

test('Z3.2: delvers cut stairs down, stone work x 4 per level', () => {
  const s = hold();
  const f = { id: 1, x: ctrW(4), y: ctrW(20), z: Z_TOP, st: {} };
  const per = digTicks(s, idx(4, 20, Z_TOP - 1));
  let ticks = 0;
  while ((f.z | 0) > Z_HALL && ticks < 100000) { digDown(s, f, idx(4, 20, f.z), Z_HALL); ticks++; }
  assert.equal(f.z, Z_HALL);
  assert.equal(s.L.terrain[idx(4, 20, Z_TOP)], TER.STAIR_D);
  assert.equal(s.L.terrain[idx(4, 20, Z_TOP - 1)], TER.STAIR_UD);
  assert.equal(s.L.terrain[idx(4, 20, Z_HALL)], TER.STAIR_U);
  assert.ok(ticks >= 3 * per - 3 && ticks <= 3 * per + 3, `${ticks} ticks for 3 levels (${per} each)`);
  assert.equal(digDown(s, f, idx(4, 20, f.z), Z_HALL), false, 'at the goal level: nothing to cut');
});

/**
 * A sapper raid on the hold, defended (or not) by four archers in the gallery over the corridor. Repelled:
 * within a day no delver came within 2 tiles of the Hearth and every delver is gone (down, fled or left).
 */
function sapperRun(seed, defended = true) {
  const s = hold({ seed });
  if (defended) for (const x of [11, 12, 13, 14]) archer(s, x, 7, Z_GAL, `Archer ${x}`);
  raid(s, 'sapper_raid', ['delver', 'delver', 'delver'], 'core');
  let atHearth = 0, ticks = 0;
  const end = s.tick + 24 * H1;
  const live = () => s.foes.filter((f) => !(f.st && (f.st.down || f.st.flee)));
  while (s.tick < end && live().length) {
    step(s, 10); ticks += 10;
    for (const f of live()) if ((f.z | 0) === Z_HALL && Math.abs(tileOfW(f.x) - 19) <= 2 && Math.abs(tileOfW(f.y) - 7) <= 2) atHearth++;
  }
  return { repelled: atHearth === 0 && live().length === 0, atHearth, ticks, hash: stateHash(s) };
}

test('Z3.2: sappers repelled on 3 of 5 seeds; deterministic', () => {
  const seeds = ['A', 'B', 'C', 'D', 'E'].map((k) => `Z32-${k}`);
  const runs = seeds.map((k) => sapperRun(k)), open = seeds.map((k) => sapperRun(k, false));
  const ok = runs.filter((r) => r.repelled).length, okOpen = open.filter((r) => r.repelled).length;
  const fmt = (rs) => rs.map((r) => `${r.repelled ? 'R' : 'x'}(hearth ${r.atHearth}, ${r.ticks} t)`).join(' ');
  console.log(`# defended ${ok}/5: ${fmt(runs)}\n# undefended ${okOpen}/5: ${fmt(open)}`);
  assert.ok(ok >= 3, `${ok}/5`);
  assert.ok(okOpen < ok, 'the gallery archers are what repels them');
  assert.equal(sapperRun(seeds[0]).hash, runs[0].hash, 'same seed, same hash');
});
