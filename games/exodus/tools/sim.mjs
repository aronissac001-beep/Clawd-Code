// All-AI simulation. Run: node games/exodus/tools/sim.mjs [games] [turns] [size] [script]
import { loadEngine } from './load-engine.mjs';
const games = +(process.argv[2] || 1), turns = +(process.argv[3] || 250), size = process.argv[4] || 'medium', script = process.argv[5] || 'continents';
const { HX, ev } = loadEngine();
const CIVS = ev('CIVS'), TECHS = ev('TECHS'), TECHI = ev('TECHI'), ERAS = ev('ERAS'), MAPSIZE = ev('MAPSIZE');
const playerEra = ev('playerEra'), eraOf = P => playerEra(P);
for (let gi = 0; gi < games; gi++) {
  const G = HX.makeGame({ size, script, rivals: MAPSIZE[size].maxCivs - 1, seed: 'sim-' + gi, difficulty: 1 }, { allAI: true });
  const t0 = Date.now(); let slow = 0;
  const firstEra = G.players.map(() => ({}));
  while (G.turn <= turns) {
    const a = Date.now();
    const pid = G.active;
    HX.aiTakeTurn(G, pid);
    HX.endPlayerTurn(G);
    slow = Math.max(slow, Date.now() - a);
    G.players.forEach((P, k) => { if (P.barbarian || P.minor) return; const e = eraOf(P), fe = firstEra[k] || (firstEra[k] = {}); if (fe[e] === undefined) fe[e] = G.turn; });
    if (G.active === 0 && (G.turn % 50 === 0) && G._lastRep !== G.turn) {
      G._lastRep = G.turn;
      console.log(`--- game ${gi} turn ${G.turn} (${((Date.now() - t0) / 1000).toFixed(1)}s, slowest AI turn ${slow}ms)`);
      for (const P of G.players) {
        if (P.barbarian || P.minor) continue;
        const cs = G.cities.filter(c => c.owner === P.id), rep = HX.civReport(G, P.id);
        const blds = cs.reduce((a, c) => a + c.buildings.length - (c.capital ? 1 : 0), 0);
        let imp = 0; for (const c of cs) for (const t of c.tiles) if (G.map.improv[t]) imp++;
        console.log(`${CIVS[P.civ].key.padEnd(10)} cities ${String(cs.length).padStart(2)} pop ${String(cs.reduce((a, c) => a + c.pop, 0)).padStart(3)} techs ${String(P.techs.length).padStart(2)} (${ERAS[eraOf(P)]}) sci ${rep.sci.toFixed(0).padStart(3)} gold ${String(Math.round(P.gold)).padStart(4)} (${rep.goldNet >= 0 ? '+' : ''}${rep.goldNet.toFixed(0)}) morale ${rep.hap.net} aff ${['communion', 'lattice', 'lineage'].map(a => HX.affLevel(P, a)).join('/')} blds ${blds} improv ${imp} routes ${G.routes.filter(r => r.owner === P.id).length} units ${G.units.filter(u => u.owner === P.id).length} pol ${P.policies.length} trees ${P.treesDone.length} cul ${Math.round(P.lastCul || 0)}`);
      }
    }
  }
  console.log('phase arrival turns:', firstEra.map((e, k) => e && Object.keys(e).length ? CIVS[G.players[k].civ].key + ' ' + JSON.stringify(e) : null).filter(Boolean).join(' | '));
}
