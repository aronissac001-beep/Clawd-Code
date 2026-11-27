// W0 gate fix (owner E, care.js): a rescue across levels. The Care giver's carry used to move the patient in x and y
// only, so a colonist downed on one level and carried down the stairs to a bed on another stayed on the old level and
// was laid down inside the rock under the bed: nobody could reach them, and they starved (Z3 soak, seeds 3 and 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim } from '../../js/game/core/setup.js';
import { createColony, initRuntime } from '../../js/game/core/state.js';
import { tick } from '../../js/game/core/sim.js';
import { newColonist, WORK_IDS, FIX } from '../../js/game/core/schema.js';
import { idx, ctrW, tileOfW, TER } from '../../js/game/core/grid.js';
import { addBuilding } from '../../js/game/core/apply.js';
import { completeBuilding } from '../../js/game/work/construct.js';
import { colTile } from '../../js/game/work/reserve.js';
import { health } from '../../js/game/people/index.js';

test('a colonist downed on one level is carried down the stairs to a bed and laid down on the bed\'s level', () => {
  installSim({ stage: '1b', reset: true, checks: true });
  const w = 32, d = 6;
  const s = createColony('W0-RESCUE-3D', { w, d, zS: d - 1, terrain: TER.ROCK });
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) s.L.terrain[idx(x, y, d - 1)] = TER.ROUGH;
  // a hall on z 4 (the patient) and one on z 1 (the bed), joined by a stair column at (4, 4)
  for (let y = 2; y < 12; y++) for (let x = 2; x < 12; x++) { s.L.terrain[idx(x, y, 4)] = TER.ROUGH; s.L.terrain[idx(x, y, 1)] = TER.ROUGH; }
  s.L.terrain[idx(4, 4, 1)] = TER.STAIR_U; s.L.terrain[idx(4, 4, 2)] = TER.STAIR_UD; s.L.terrain[idx(4, 4, 3)] = TER.STAIR_UD; s.L.terrain[idx(4, 4, 4)] = TER.STAIR_D;
  s.L.mat.fill(3); s.L.fog.fill(255);
  initRuntime(s);
  const add = (x, y, z, works) => {
    const c = newColonist(s.next.col++, { name: `C${s.next.col}`, x: ctrW(x), y: ctrW(y), z });
    c.prio.fill(0); c.custom = true;
    for (const wk of works) c.prio[WORK_IDS.indexOf(wk)] = 1;
    s.col.push(c);
    return c;
  };
  const p = add(9, 9, 4, []), doc = add(7, 9, 4, ['care']);
  // two beds on z 1 (the doctor sleeps in one at night)
  const beds = [[9, 8], [6, 8]].map(([x, y]) => { const b = addBuilding(s, 'bed', x, y, 0, null, { z: 1 }); completeBuilding(s, b); return b; });
  assert.deepEqual(beds.map((b) => b.z), [1, 1]);
  health.damage(s, p, 'torso', 'cut', 24);
  p.hp.blood = 30 * FIX;
  health.checkDowned(s, p);
  assert.ok(p.hp.down, 'the patient is downed');
  let laid = false;
  for (let k = 0; k < 20000; k++) { tick(s); if (p.job && p.job.type === 'bedrest') { laid = true; break; } }
  assert.ok(laid, 'the Care giver carried the patient to the bed');
  const bed = beds.find((b) => b.id === p.job.bed) || beds.find((b) => b.x === tileOfW(p.x) && b.y === tileOfW(p.y));
  assert.ok(bed, 'in one of the beds');
  assert.deepEqual([tileOfW(p.x), tileOfW(p.y), p.z], [bed.x, bed.y, 1], 'laid down in the bed, on its level');
  assert.notEqual(s.L.terrain[colTile(p)], TER.ROCK, 'not inside the rock');
});
