// Balance report from many full all-AI games, run in parallel worker processes.
// Run: node hexarch/tools/balance.mjs [games=100] [workers=4] [size=medium] [prefix=bal]
// Mixes map types (continents, pangaea, archipelago, islands) across games.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './load-engine.mjs';
const SCRIPTS = ['continents', 'pangaea', 'archipelago', 'islands'];
if (process.argv[2] === '--worker') {
  const [, , , size, pre, ...ids] = process.argv;
  const { HX, ev } = loadEngine();
  const CIVS = ev('CIVS'), MAPSIZE = ev('MAPSIZE'), UNITS = ev('UNITS'), BUILDINGS = ev('BUILDINGS');
  for (const id of ids.map(Number)) {
    process.send({ start: id });
    const script = SCRIPTS[id % SCRIPTS.length];
    const G = HX.makeGame({ size, script, rivals: MAPSIZE[size].maxCivs - 1, seed: `${pre}-${id}`, difficulty: 1 }, { allAI: true });
    let t100 = null, lastTurn = -1; const built = {};
    while (!G.over && G.turn <= G.cfg.turnLimit + 2) {
      if (G.turn !== lastTurn) { lastTurn = G.turn; process.send({ beat: id, turn: G.turn, active: G.active }); }
      HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G);
      if (G.turn === 100 && !t100) t100 = HX.majorPlayers(G).map(P => HX.scoreOf(G, P.id));
      for (const u of G.units) if (!u._seen) { u._seen = 1; if (UNITS[u.type].military) built[u.type] = (built[u.type] || 0) + 1; }
    }
    const civs = HX.majorPlayers(G).map(P => ({ civ: CIVS[P.civ].key, alive: P.alive, score: HX.scoreOf(G, P.id), cities: G.cities.filter(c => c.owner === P.id).length, techs: P.techs.length, trees: P.treesDone.length, wonders: (P._wonders || []).length }));
    const bld = {}; for (const c of G.cities) for (const k of c.buildings) bld[k] = (bld[k] || 0) + 1;
    process.send({ id, script, over: G.over, winner: G.over && G.over.winner >= 0 ? CIVS[G.players[G.over.winner].civ].key : null, civs, t100, units: built, bld, ncities: G.cities.length });
  }
  process.exit(0);
}
const games = +(process.argv[2] || 100), workers = +(process.argv[3] || 4), size = process.argv[4] || 'medium', pre = process.argv[5] || 'bal';
const self = fileURLToPath(import.meta.url), results = [], hung = [], t0 = Date.now();
// Each worker plays its share; a watchdog kills a worker whose game stops advancing and restarts it on the rest.
const runWorker = ids => new Promise(res => {
  if (!ids.length) return res();
  const ch = fork(self, ['--worker', size, pre, ...ids.map(String)]);
  let cur = null, last = Date.now(), info = null; const done = new Set();
  const dog = setInterval(() => {
    if (Date.now() - last < 120000) return;
    hung.push({ id: cur, ...info }); console.error(`\nwatchdog: game ${cur} stuck at ${JSON.stringify(info)}; restarting worker`);
    clearInterval(dog); ch.kill('SIGKILL');
    runWorker(ids.filter(i => !done.has(i) && i !== cur)).then(res);
  }, 5000);
  ch.on('message', m => {
    last = Date.now();
    if (m.start !== undefined) { cur = m.start; return; }
    if (m.beat !== undefined) { info = { turn: m.turn, active: m.active }; return; }
    done.add(m.id); results.push(m); process.stderr.write(`\r${results.length}/${games} games (${((Date.now() - t0) / 1000).toFixed(0)}s)   `);
  });
  ch.on('exit', () => { clearInterval(dog); if (done.size + (hung.some(h => ids.includes(h.id)) ? 1 : 0) >= ids.length || ch.signalCode !== 'SIGKILL') res(); });
});
await Promise.all(Array.from({ length: workers }, (_, w) => { const ids = []; for (let i = w; i < games; i += workers) ids.push(i); return runWorker(ids); }));
if (hung.length) console.log('HUNG GAMES:', JSON.stringify(hung));
console.error('');
const n = results.length, pct = x => (x / n * 100).toFixed(0) + '%';
const wins = {}, types = {}, played = {}, turns = [];
for (const r of results) {
  if (r.winner) wins[r.winner] = (wins[r.winner] || 0) + 1;
  const ty = r.over ? r.over.type : 'none'; types[ty] = (types[ty] || 0) + 1; if (r.over) turns.push(r.over.turn);
  for (const c of r.civs) played[c.civ] = (played[c.civ] || 0) + 1;
}
console.log(`\n${n} games, ${size} maps, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
console.log('win rate when present:'); for (const k of Object.keys(played).sort()) console.log(`  ${k.padEnd(11)} ${String(wins[k] || 0).padStart(3)} wins / ${String(played[k]).padStart(3)} games = ${((wins[k] || 0) / played[k] * 100).toFixed(0)}%   share of all wins ${pct(wins[k] || 0)}`);
console.log('victory types:', Object.entries(types).map(([k, v]) => `${k} ${pct(v)}`).join(', '));
turns.sort((a, b) => a - b); console.log(`end turn: min ${turns[0]}, median ${turns[turns.length >> 1]}, max ${turns[turns.length - 1]}`);
for (const sc of SCRIPTS) { const rs = results.filter(r => r.script === sc); if (!rs.length) continue; const w = {}; rs.forEach(r => { if (r.winner) w[r.winner] = (w[r.winner] || 0) + 1; }); const t = {}; rs.forEach(r => { const k = r.over ? r.over.type : 'none'; t[k] = (t[k] || 0) + 1; }); console.log(`  ${sc.padEnd(11)} wins ${JSON.stringify(w)} types ${JSON.stringify(t)}`); }
// contested at turn 100: how far is the leader ahead of the median civ?
const gaps = results.filter(r => r.t100).map(r => { const s = r.t100.slice().sort((a, b) => b - a); return s[0] / Math.max(1, s[s.length >> 1]); }).sort((a, b) => a - b);
console.log(`turn-100 leader/median score ratio: median ${gaps[gaps.length >> 1].toFixed(2)}, 90th pct ${gaps[Math.floor(gaps.length * 0.9)].toFixed(2)}`);
const elim = results.reduce((a, r) => a + r.civs.filter(c => !c.alive).length, 0); console.log(`civs eliminated per game: ${(elim / n).toFixed(2)}`);
// unit and building usage
const ut = {}; for (const r of results) for (const k in r.units) ut[k] = (ut[k] || 0) + r.units[k];
const totU = Object.values(ut).reduce((a, b) => a + b, 0);
console.log('military units built (share):', Object.entries(ut).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / totU * 100).toFixed(1)}%`).join(', '));
const bt = {}, totC = results.reduce((a, r) => a + r.ncities, 0); for (const r of results) for (const k in r.bld) bt[k] = (bt[k] || 0) + r.bld[k];
console.log('buildings (share of cities that have one):', Object.entries(bt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / totC * 100).toFixed(0)}%`).join(', '));
