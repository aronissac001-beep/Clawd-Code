// Z2b fire (EMBERCROWN-FORTRESS.md 2.9; R2 5.1): a colonist on a burning tile steps out of the flames instead of burning
// to death where they stand.   node --test tools/tests/fire-flee.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { idx, inB, TER_BUILDABLE, TER_WATER } from '../../js/game/core/grid.js';
import { makeJob, T } from '../../js/game/work/jobs.js';
import { beginJob, endJob } from '../../js/game/work/reserve.js';
import { spawnAt } from '../../js/game/work/items.js';
import { ignite, burning } from '../../js/game/world/fire.js';

const hearth = (s) => s.bld[s.colony.hearth.id];
const place = (c, x, y, z) => { c.x = x * 32 + 16; c.y = y * 32 + 16; c.z = z; };
const tileOf = (c) => idx(Math.floor(c.x / 32), Math.floor(c.y / 32), c.z | 0);
function openSpot(s, x0, y0, z) {
  for (let r = 0; r < 40; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = x0 + dx, y = y0 + dy;
    let ok = true;
    for (let yy = y - 2; yy <= y + 2 && ok; yy++) for (let xx = x - 2; xx <= x + 2 && ok; xx++) {
      if (!inB(xx, yy, z)) { ok = false; break; }
      const i = idx(xx, yy, z), t = s.L.terrain[i];
      if (!TER_BUILDABLE[t] || TER_WATER[t] || s.rt.occ[i] >= 0 || s.rt.itemAt[i] >= 0) ok = false;
    }
    if (ok) return [x, y];
  }
  return null;
}
const burns = (c) => c.hp.wounds.filter((w) => w.kind === 'burn').reduce((n, w) => n + (w.dmg | 0), 0);

for (const D of [1, 20]) test(`a colonist standing in flames walks out and lives (D = ${D})`, () => {
  installSim({ stage: '2', reset: true });
  const s = foundColony({ seed: 'F-fire-flee', name: 'Ash Hold', d: D });
  const hb = hearth(s), z = hb.z | 0;
  const [x, y] = openSpot(s, hb.x + 8, hb.y + 8, z);
  const i = idx(x, y, z);
  spawnAt(s, 'wood', null, 0, 20, i);
  const a = s.col[0];
  for (const o of s.col.slice(1)) { if (o.job) endJob(s, o); o.drafted = true; }   // nobody fights the fire
  if (a.job) endJob(s, a);
  place(a, x, y, z);
  beginJob(s, a, makeJob('idleTest', -1, [T.wait(100000)]));
  assert.ok(ignite(s, i, 80), 'the woodpile is alight');
  let left = -1;
  for (let k = 0; k < 600; k++) { tick(s); if (left < 0 && tileOf(a) !== i) left = k; }
  assert.ok(!a.hp.dead, 'alive');
  assert.ok(left >= 0 && left < 100, `left the burning tile (tick ${left})`);
  assert.ok(!burning(s, tileOf(a)), 'not standing in fire');
  assert.ok(burns(a) <= 8, `at most two burns (${burns(a)})`);
});
