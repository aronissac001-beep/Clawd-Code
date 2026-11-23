// Z3.6 (EMBERCROWN-FORTRESS.md 8.5, the Z3 gate): determinism and cache-drop mid-flood and mid-beast on a
// 128 x 128 x 20 hold with every Z3 system installed. One hold: a woken generated beast on the map and a river
// tile mined from below (water pours down a level). From that tick three copies run on: the original, a save and
// load (C13), and a cache drop (saved state, rt rebuilt by initRuntime); their state hashes must agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { PLANE, TER_MINEABLE } from '../../js/game/core/grid.js';
import { step } from '../../js/game/core/sim.js';
import { initRuntime, stateHash, raidLive } from '../../js/game/core/state.js';
import { savedKeys } from '../../js/game/core/rtcontract.js';
import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
import { mineTile } from '../../js/game/world/terrain.js';
import { logicOf } from '../../js/game/threat/incidents.js';
import { activeCount } from '../../js/game/world/fluids.js';
import * as GB from '../../js/game/threat/beasts/index.js';
import { holdBeasts } from '../../js/game/threat/beasts/gen.js';

function dropClone(s) {
  const { rt, ...rest } = s;
  const c = structuredClone(rest);
  initRuntime(c);
  for (const k of savedKeys(raidLive(s))) c.rt[k] = structuredClone(rt[k]);
  return c;
}

test('Z3 gate: save and cache drop mid-flood and mid-beast continue identically', async () => {
  installSim({ stage: '2', reset: true, checks: false });
  const s = foundColony({ seed: 'Z36', name: 'Soak Hold', d: 20 });
  // the beast
  const b = holdBeasts(s).find((x) => !x.legend);
  const e = { id: 9001, inc: GB.BEAST_INC, gb: b.key, stage: 'imminent', warnTick: s.tick, arriveTick: s.tick, cast: {}, raid: null,
    plan: { pts: 100, edge: { side: 'deep', i: b.lair }, goal: 'core', members: [b.base], nem: null, lead: 0 } };
  logicOf(GB.BEAST_INC).start(s, e);
  // the flood: the first water voxel over mineable rock
  let hole = -1;
  for (let i = PLANE; i < s.L.fluid.length && hole < 0; i++) if ((s.L.fluid[i] & 7) >= 2 && TER_MINEABLE[s.L.terrain[i - PLANE]]) hole = i - PLANE;
  assert.ok(hole >= 0, 'a water voxel over rock');
  mineTile(s, hole);
  step(s, 40);
  assert.ok(activeCount(s) > 0, `mid-flood (${activeCount(s)} active)`);
  assert.ok(s.foes.some((f) => f.st && f.st.gb === b.key), 'mid-beast');
  const loaded = await loadBlob(await saveBlob(s));
  const dropped = dropClone(s);
  assert.equal(stateHash(loaded), stateHash(s));
  for (let k = 0; k < 4; k++) {
    step(s, 150); step(loaded, 150); step(dropped, 150);
    const h = stateHash(s);
    assert.equal(stateHash(loaded), h, `save/load differs at +${(k + 1) * 150}`);
    assert.equal(stateHash(dropped), h, `cache drop differs at +${(k + 1) * 150}`);
  }
});
