// Headless auto-play: runs the real simulation with a simple scripted player
// across many seeds and reports how far each run gets. Use for balance passes:
//   node tools/headless.mjs [seeds=20] [difficulty=standard]
import { createRun } from '../js/game/state.js';
import { tick, applyCommand, canPlace, DT } from '../js/game/sim.js';
import { BUILDINGS } from '../js/data/buildings.js';

const seeds = +(process.argv[2] || 20);
const diff = process.argv[3] || 'standard';

// A modest scripted build order, retried every few seconds.
const ORDER = ['farm', 'lumber', 'house', 'farm', 'quarry', 'tower', 'barracks', 'house', 'tower', 'brazier', 'farm', 'house', 'tower', 'tower', 'brazier', 'house', 'farm', 'tower', 'tower'];

function tryBuild(s, type) {
  const h = s.rt.hearth;
  for (let r = 3; r < 11; r++) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2 + r;
      const tx = Math.round(h.tx + 1 + Math.cos(ang) * r), ty = Math.round(h.ty + 1 + Math.sin(ang) * r);
      if (canPlace(s, type, tx, ty).ok) {
        const res = applyCommand(s, { t: 'place', type, tiles: [[tx, ty]] });
        if (res.ok) return true;
        return false;
      }
    }
  }
  return false;
}

const results = [];
for (let k = 0; k < seeds; k++) {
  const s = createRun({ seedText: 'SIM-' + k, difficulty: diff });
  let step = 0;
  const t0 = Date.now();
  let ticks = 0;
  while (!s.outcome && s.cycle.night < 12 && ticks < 20 * 60 * 40) {
    if (s.pending) applyCommand(s, { t: 'choose', i: 0 });
    if (ticks % 60 === 0) {
      if (step < ORDER.length && tryBuild(s, ORDER[step])) step++;
      const b = s.buildings.find((x) => x.type === 'barracks' && x.built);
      if (b && s.res.gold > 30) applyCommand(s, { t: 'train', id: b.id, u: ['militia', 'spearman', 'archer'][ticks % 3] });
      if (step >= ORDER.length && s.res.wood > 60) { const u = s.buildings.find((x) => x.built && !x.upg && x.type === 'tower' && x.level < 2); if (u) applyCommand(s, { t: 'upgrade', id: u.id }); }
      if (s.sovereign && s.sovereign.novaCd <= 0 && s.enemies.length > 4) applyCommand(s, { t: 'ability', name: 'nova' });
    }
    tick(s);
    s.rt.fx.length = 0;
    ticks++;
  }
  results.push({ seed: 'SIM-' + k, nights: s.cycle.night, outcome: s.outcome ? (s.outcome.reason.includes('Hearth') ? 'hearth' : 'sovereign') : 'alive', kills: s.stats.kills, vill: s.villagers.length, lost: s.stats.villagersLost, build: s.stats.built, ms: Date.now() - t0, res: Object.fromEntries(Object.entries(s.res).map(([a, b]) => [a, Math.round(b)])) });
}
console.table(results);
const surv = results.filter((r) => r.nights >= 7).length;
console.log(`${diff}: reached night 7 in ${surv}/${seeds}; avg nights ${(results.reduce((a, r) => a + r.nights, 0) / seeds).toFixed(1)}; avg ms/run ${(results.reduce((a, r) => a + r.ms, 0) / seeds).toFixed(0)}`);
void BUILDINGS; void DT;
