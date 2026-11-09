// Full all-AI games to the end: who wins, how and when. Run: node hexarch/tools/vicsim.mjs [games] [size] [script] [seedPrefix] [turnLimit]
import { loadEngine } from './load-engine.mjs';
const games = +(process.argv[2] || 2), size = process.argv[3] || 'medium', script = process.argv[4] || 'continents', pre = process.argv[5] || 'vic', limit = +(process.argv[6] || 350);
const { HX, ev } = loadEngine();
const CIVS = ev('CIVS'), MAPSIZE = ev('MAPSIZE');
const wins = {}, types = {};
for (let gi = 0; gi < games; gi++) {
  const G = HX.makeGame({ size, script, rivals: MAPSIZE[size].maxCivs - 1, seed: pre + '-' + gi, difficulty: 1, turnLimit: limit }, { allAI: true });
  const t0 = Date.now(); let slow = 0;
  while (!G.over && G.turn <= limit + 2) { const a = Date.now(); HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G); slow = Math.max(slow, Date.now() - a); }
  const o = G.over || { winner: -1, type: 'none', turn: G.turn };
  const wk = o.winner >= 0 ? CIVS[G.players[o.winner].civ].key : 'none';
  wins[wk] = (wins[wk] || 0) + 1; types[o.type] = (types[o.type] || 0) + 1;
  const wl = {}; for (const k in G.wonders) { const c = CIVS[G.players[G.wonders[k].pid].civ].key; wl[c] = (wl[c] || 0) + 1; }
  console.log(`game ${gi}: ${wk} ${o.type} on turn ${o.turn} (${((Date.now() - t0) / 1000).toFixed(0)}s, slowest ${slow}ms) wonders ${Object.keys(G.wonders).length} ${JSON.stringify(wl)}`);
  console.log('   ', HX.majorPlayers(G).map(P => `${CIVS[P.civ].key.slice(0, 5)} ${P.alive ? HX.scoreOf(G, P.id) : 'dead'} t${P.techs.length} tr${P.treesDone.length}${HX.SKYWARD.filter(k => HX.projectBuilt(G, P.id, k)).length ? ' sky' + HX.SKYWARD.filter(k => HX.projectBuilt(G, P.id, k)).length : ''}`).join(' | '));
  const vp = HX.majorPlayers(G).filter(P => P.alive).map(P => { const v = HX.victoryProgress(G, P.id); return CIVS[P.civ].key.slice(0, 5) + ' ' + ['domination', 'science', 'culture', 'religion', 'diplomacy'].map(k => k.slice(0, 3) + Math.round(v[k].pct * 100)).join(' '); });
  console.log('    progress:', vp.join(' | '));
}
console.log('wins', JSON.stringify(wins), 'types', JSON.stringify(types));
