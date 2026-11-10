// Determinism + save round-trip check:
//  1. Two runs from the same seed with the same commands end identical.
//  2. A run serialised to JSON mid-night and restored continues identically.
//   node tools/determinism.mjs
import '../js/game/content.js';
import { createRun, serializeState, deserializeState } from '../js/game/state.js';
import { tick, applyCommand, canPlace } from '../js/game/sim.js';

function script(s, t) {
  if (s.pending) applyCommand(s, { t: 'choose', i: t % 3 });
  if (t % 80 === 0) {
    const h = s.rt.hearth;
    for (const type of ['farm', 'lumber', 'house', 'tower', 'barracks', 'brazier']) {
      for (let r = 3; r < 9; r++) for (let a = 0; a < 12; a++) {
        const tx = h.tx + 1 + Math.round(Math.cos(a + r) * r), ty = h.ty + 1 + Math.round(Math.sin(a + r) * r);
        if (canPlace(s, type, tx, ty).ok) { applyCommand(s, { t: 'place', type, tiles: [[tx, ty]] }); r = 99; break; }
      }
    }
    const b = s.buildings.find((x) => x.type === 'barracks' && x.built);
    if (b) applyCommand(s, { t: 'train', id: b.id, u: 'archer' });
    const foe = s.enemies.find((e) => !e.guard && !e.stationary);
    if (s.sovereign && foe) applyCommand(s, { t: 'sovAttack', target: foe.id });
  }
}
function fingerprint(s) {
  return JSON.stringify([s.tick, s.cycle, s.res, s.stats, s.villagers.map((v) => [v.x.toFixed(3), v.y.toFixed(3), v.st]), s.enemies.map((e) => [e.type, e.x.toFixed(3), e.hp.toFixed(3)]), s.buildings.map((b) => [b.type, b.hp.toFixed(2)]), s.rt.rng.getState()]);
}
const N = 20 * 60 * 9; // ~9 minutes of game time
const a = createRun({ seedText: 'DET-1', difficulty: 'standard' });
const b = createRun({ seedText: 'DET-1', difficulty: 'standard' });
let c = null;
for (let t = 0; t < N; t++) {
  script(a, t); tick(a); a.rt.fx.length = 0;
  script(b, t); tick(b); b.rt.fx.length = 0;
  if (c) { script(c, t); tick(c); c.rt.fx.length = 0; }
  if (!c && a.cycle.phase === 'night' && a.cycle.t > 10) {
    c = deserializeState(JSON.parse(JSON.stringify(serializeState(b))));
    console.log('snapshot taken at tick', a.tick, 'night', a.cycle.night + 1, 'enemies', a.enemies.length);
  }
}
const fa = fingerprint(a), fb = fingerprint(b), fc = c ? fingerprint(c) : '';
console.log('same seed identical:', fa === fb);
console.log('save/restore identical:', fa === fc);
console.log('ended at night', a.cycle.night, 'kills', a.stats.kills, 'outcome', a.outcome && a.outcome.result);
const m1 = createRun({ seedText: 'MAP-A' }), m2 = createRun({ seedText: 'MAP-A' }), m3 = createRun({ seedText: 'MAP-B' });
console.log('same seed same map:', m1.terrain.join() === m2.terrain.join() && JSON.stringify(m1.nodes) === JSON.stringify(m2.nodes), '| different seed differs:', m1.terrain.join() !== m3.terrain.join());
if (fa !== fb || fa !== fc) process.exit(1);
