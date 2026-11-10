// All-AI games for balance. Run: node games/starwake/tools/sim.mjs [games] [size] [years] [seedPrefix]
import { loadEngine } from './load-engine.mjs';
const N = +(process.argv[2] || 10), size = process.argv[3] || 'small', years = +(process.argv[4] || 200), pre = process.argv[5] || 'sim';
const { SW, ev } = loadEngine();
const wins = {}, present = {}, types = {}, ends = [], crisis = { ended: 0, arrived: 0 };
let wars = 0, peaces = 0, elim = 0;
const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const G = SW.newGame({ seed: pre + g, size, years, allAI: true, shape: ['spiral2', 'spiral4', 'elliptical', 'ring'][g % 4] });
  while (!G.over) SW.advanceDay(G);
  const w = G.winner, W = w.e >= 0 ? G.empires[w.e] : null;
  for (const e of SW.majors(G)) present[e.persona] = (present[e.persona] || 0) + 1;
  if (W) wins[W.persona] = (wins[W.persona] || 0) + 1;
  types[w.type] = (types[w.type] || 0) + 1;
  ends.push(Math.round(G.day / 360));
  wars += G.log.filter(l => /declared war/.test(l.m)).length; peaces += G.log.filter(l => /white peace|yielded/.test(l.m)).length;
  elim += G.log.filter(l => /has been destroyed\.$/.test(l.m)).length;
  if (G.crisis.stage >= 2) crisis.arrived++; if (G.crisis.stage >= 3) crisis.ended++;
  const sc = SW.alive(G).map(e => `${e.persona}:${SW.scoreOf(G, e).total}`).join(' ');
  console.log(`game ${g + 1}: ${W ? W.persona + ' (' + W.name + ')' : 'none'} by ${w.type} in year ${Math.round(G.day / 360)} | crisis ${G.crisis.stage} | ${sc} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log('\nwin rate when present:');
for (const k of Object.keys(present)) console.log(`  ${k.padEnd(13)} ${((wins[k] || 0) / N * 100).toFixed(0).padStart(3)}% of games (${wins[k] || 0}/${N}), present ${present[k]}`);
console.log('victory types:', JSON.stringify(types));
console.log('median end year:', ends.sort((a, b) => a - b)[Math.floor(ends.length / 2)]);
console.log(`wars declared ${wars}, peace deals ${peaces}, empires destroyed ${elim}, crisis arrived ${crisis.arrived}/${N}, defeated ${crisis.ended}/${N}`);
