// Workstream H, Stage 2.9b (the soak survives): worn armour counts in a fight, the Hollow rout by
// morale (EMBERCROWN-FORTRESS.md 2.10), and the threat floor stops at its difficulty's cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installSim, foundColony } from '../../js/game/core/setup.js';
import { step } from '../../js/game/core/sim.js';
import { ctrW } from '../../js/game/core/grid.js';
import { TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { storyteller, raiders, raidplan } from '../../js/game/threat/index.js';
import { armourPct, ARMOUR } from '../../js/game/threat/fight.js';
import { hollowMorale, moraleTuning } from '../../js/game/threat/horde.js';

const H1 = TICKS_PER_HOUR;
function colony(seed = 'H-29B', opts = {}) {
  installSim({ stage: '2', reset: true, checks: true });
  return foundColony({ seed, name: 'Test Hold', ...opts });
}
const stepTo = (s, t) => { if (t > s.tick) step(s, t - s.tick); };
function raid(s, inc, members, goal = 'core', inH = 1) {
  s.st.queue.length = 0;
  const e = storyteller.scheduleIncident(s, inc, s.tick, s.tick + inH * H1);
  let sd = 'w', i = raidplan.edgeTile(s, sd);
  for (const x of ['s', 'e', 'n']) if (i === null) { sd = x; i = raidplan.edgeTile(s, x); }
  e.plan = { pts: 100, edge: { side: sd, i }, goal, members, nem: null };
  return e;
}

test('H 2.9b: worn armour takes its share off a blow to the parts it covers', () => {
  const s = colony();
  const c = s.col[0];
  c.gear = { slots: {}, outfit: null };
  assert.equal(armourPct(c, 0, 'cut'), 0, 'nothing worn');
  c.gear.slots.head = { k: 'ironhelm', q: 1, n: 1 };
  assert.equal(armourPct(c, 0, 'blunt'), 18, 'an iron helm on the head');
  assert.equal(armourPct(c, 1, 'blunt'), 0, 'not on the torso');
  assert.equal(armourPct(c, 0, 'taint'), 0, 'the taint passes through');
  c.gear.slots.hands = { k: 'ironshield', q: 1, n: 1 };
  assert.equal(armourPct(c, 1, 'cut'), 9, 'a shield guards every part at half');
  c.gear.slots.outer = { k: 'mailshirt', q: 5, n: 1 };
  c.gear.slots.body = { k: 'gambeson', q: 1, n: 1 };
  assert.equal(armourPct(c, 1, 'stab'), ARMOUR.maxPct, 'capped');
  // in a fight: a knight's blows on an armoured colonist land lighter than on a bare one
  const blows = (armoured) => {
    const t = colony('H-29B-F');
    stepTo(t, 21 * H1);
    const e = raid(t, 'hollow_horde', ['hollow_knight'], 'core', 1);
    stepTo(t, e.arriveTick + 1);
    const k = t.col[0];
    k.gear = { slots: armoured ? { head: { k: 'ironhelm', q: 1, n: 1 }, outer: { k: 'mailshirt', q: 1, n: 1 }, hands: { k: 'ironshield', q: 1, n: 1 } } : {}, outfit: null };
    const f = t.foes[0];
    let dealt = 0;
    for (let n = 0; n < 600 && !k.hp.down && !k.hp.dead; n++) {
      f.x = k.x + 10; f.y = k.y; f.target = k.id; f.hp.hp = f.hp.max;
      const before = k.hp.wounds.length;
      step(t, 1);
      for (const w of k.hp.wounds.slice(before)) dealt += w.dmg;
    }
    return dealt;
  };
  const bare = blows(false), armoured = blows(true);
  assert.ok(armoured < bare, `armoured ${armoured} < bare ${bare}`);
});

test('H 2.9b: a Hollow horde that loses about half its number routs back to its edge', () => {
  const s = colony('H-29B-M');
  stepTo(s, 21 * H1);
  const e = raid(s, 'hollow_horde', new Array(10).fill('husk'), 'core', 1);
  stepTo(s, e.arriveTick + 1);
  const r = s.raids.find((x) => x.id === e.id);
  assert.equal(r.stage, 'active');
  const M = moraleTuning();
  // keep them out of the light and away from the hold
  const away = () => { for (const id of r.members) { const f = raiders.foeById(s, id); if (f) { f.x = ctrW(2); f.y = ctrW(2); } } };
  away();
  const per = Math.max(M.lossPer, Math.floor(M.lossHalf / 10));
  const need = Math.ceil((100 - M.routAt) / per);
  for (let k = 0; k < need - 1; k++) raiders.killFoe(s, raiders.foeById(s, r.members[r.members.length - 1]));
  s.tick += 20 - (s.tick % 20); away();
  hollowMorale(s, r);
  assert.equal(r.stage, 'active', `morale ${r.morale} after ${need - 1} lost`);
  raiders.killFoe(s, raiders.foeById(s, r.members[r.members.length - 1]));
  s.tick += 20; away();
  hollowMorale(s, r);
  assert.ok(r.morale <= M.routAt, `morale ${r.morale}`);
  assert.equal(r.stage, 'retreat', 'routed');
});

test('H 2.9b: the threat floor stops at its difficulty cap; Hard has none', () => {
  const s = colony('H-29B-P');
  const base = { wealth: 0, able: 3, day: 300, difficultyPct: 100, storytellerPct: 100, adjPct: 100, floorPct: 100 };
  const capped = raidplan.threatPoints(s, { ...base, floorMax: 600 });
  assert.equal(capped, 40 + 600);
  const open = raidplan.threatPoints(s, { ...base, floorMax: Infinity });
  assert.equal(open, 40 + 600 + 40 * 7);
  s.colony.difficulty = 'warden';
  assert.equal(raidplan.threatPoints(s, { ...base, difficultyPct: 100 }), 40 + 450);
  s.colony.difficulty = 'hard';
  assert.equal(raidplan.threatPoints(s, { ...base, difficultyPct: 100 }), 40 + 600 + 280);
});
