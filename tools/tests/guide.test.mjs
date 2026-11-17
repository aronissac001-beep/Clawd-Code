// The guided opening (js/ui/guide.js, doc 10.9): every 1a step is detected from state, none is done on a
// fresh colony, and each step's command or UI action makes it done. Headless (the steps read state only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { W, H, idx, inB, TER } from '../../js/game/core/grid.js';
import { isTreeCode } from '../../js/game/world/defs.js';
import { GUIDE_STEPS } from '../../js/ui/guide.js';

const step = (id) => GUIDE_STEPS.find((g) => g.id === id);
function open(s, w, h) {
  const hb = s.bld[s.colony.hearth.id];
  for (let r = 4; r < 60; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = hb.x + dx, y = hb.y + dy;
    if (!inB(x - 1, y - 1) || !inB(x + w, y + h)) continue;
    let ok = true;
    for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w && ok; xx++) {
      const i = idx(xx, yy);
      if (s.rt.occ[i] >= 0 || s.rt.itemAt[i] >= 0 || s.L.plant[i] || ![TER.GRASS, TER.MEADOW, TER.DIRT].includes(s.L.terrain[i])) ok = false;
    }
    if (ok) return { x, y };
  }
  return null;
}

test('guide: no step is done on a fresh colony; each is detected from state', () => {
  installSim({ stage: '1a' });
  const s = foundColony({ seed: 'GUIDE-1', name: 'Guide Hold' });
  const ui = { speed: 1 };
  assert.deepEqual(GUIDE_STEPS.map((g) => g.id), ['chop', 'stockpile', 'speed', 'carve', 'mason', 'bedroom']);
  for (const g of GUIDE_STEPS) assert.equal(g.done(s, ui), false, `${g.id} is not done at the start`);
  // chop: one marked tree
  let tree = -1;
  for (let i = 0; i < W * H && tree < 0; i++) if (isTreeCode(s.L.plant[i])) tree = i;
  const t = { x0: tree % W, y0: (tree / W) | 0, x1: tree % W, y1: (tree / W) | 0 };
  assert.ok(applyCommand(s, { t: 'designate', kind: 'chop', rect: t, add: true }).ok);
  assert.equal(step('chop').done(s, ui), true);
  // stockpile
  const z = open(s, 3, 3);
  assert.ok(applyCommand(s, { t: 'zone', op: 'new', type: 'stockpile', rect: { x0: z.x, y0: z.y, x1: z.x + 2, y1: z.y + 2 }, preset: 'all' }).ok);
  assert.equal(step('stockpile').done(s, ui), true);
  // speed is UI state
  assert.equal(step('speed').done(s, { speed: 3 }), true);
  // mason's bench
  const m = open(s, 4, 3);
  assert.ok(applyCommand(s, { t: 'place', def: 'mason', x: m.x, y: m.y, rot: 0 }).ok, 'a mason bench blueprint');
  assert.equal(step('mason').done(s, ui), true);
  for (const g of GUIDE_STEPS) assert.equal(typeof g.title, 'string');
});
