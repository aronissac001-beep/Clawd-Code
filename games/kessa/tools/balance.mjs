// Bot balance: plays seeds e-<from>..e-<to-1> on one difficulty for 200 sols and counts wins and losses.
// usage: node tools/balance.mjs [normal|hard|easy] [from=0] [to=8|5|3] [sols=200]
// The README's results are normal 0-8, hard 0-5 and easy 0-3; split a range over several processes to run in parallel.
import { loadEngine } from './load-engine.mjs';
const { KC, ctx } = loadEngine();
const diff = process.argv[2] || 'normal', from = +(process.argv[3] || 0), to = +(process.argv[4] || ({ normal: 8, hard: 5, easy: 3 }[diff] || 8)), SOLS = +(process.argv[5] || 200);
const sps = ['orrin', 'union', 'meridian', 'tessaline', 'pilgrim'];
let wins = 0, losses = 0;
for (let i = from; i < to; i++) {
  const sp = sps[i % (diff === 'hard' ? 5 : 4)];
  const G = KC.newGame({ seed: 'e-' + i, sponsor: sp, commander: ['engineer', 'financier', 'roboticist', 'agronomist'][i % 4], difficulty: diff }), B = {};
  for (let h = 0; h < SOLS * 24; h++) { if (h % 4 === 0) ctx.BOT.turn(G, B); if (G.event) ctx.BOT.event(G, B); KC.step(G); if (G.over) break; }
  if (G.over && G.over.win) wins++; if (G.over && !G.over.win) losses++;
  const W = G.world;
  console.log(('e-' + i).padEnd(5), sp.padEnd(10), G.over ? (G.over.win ? 'WON  sol ' + G.over.sol : 'LOST sol ' + G.over.sol) : 'alive     ', 'pop', String(G.colonists.length).padStart(3), 'deaths', String(G.st.deaths).padStart(3), 'trades', G.st.trades || 0, 'laws', G.assembly ? G.assembly.history.length : '-', 'races won', Object.values(W.races).filter(r => r.who === 'you').length + '/' + Object.keys(W.races).length);
}
console.log(diff + ' (' + (to - from) + ' colonies, ' + SOLS + ' sols): ' + wins + ' won, ' + losses + ' lost');
