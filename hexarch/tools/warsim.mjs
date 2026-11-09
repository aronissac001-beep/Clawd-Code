// War behaviour report for all-AI games. Run: node hexarch/tools/warsim.mjs [games] [turns] [size] [script]
import { loadEngine } from './load-engine.mjs';
const games = +(process.argv[2] || 3), turns = +(process.argv[3] || 250), size = process.argv[4] || 'medium', script = process.argv[5] || 'continents';
const { HX, ev } = loadEngine();
const CIVS = ev('CIVS'), MAPSIZE = ev('MAPSIZE');
let totalWars = 0, totalCaps = 0, totalElim = 0;
for (let gi = 0; gi < games; gi++) {
  const G = HX.makeGame({ size, script, rivals: MAPSIZE[size].maxCivs - 1, seed: 'war-' + gi, difficulty: 1, barbarians: 'normal' }, { allAI: true });
  const majors = G.players.filter(P => !P.barbarian);
  let wars = 0, peaces = 0, caps = 0, kills = 0, campsMade = 0, barbKills = 0, sacks = 0, slow = 0;
  const seenWars = new Set(), owner0 = new Map(G.cities.map(c => [c.id, c.owner])), campIds = new Set();
  const capLog = [];
  while (G.turn <= turns) {
    const nUnits = G.units.length, t0 = Date.now();
    HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G);
    slow = Math.max(slow, Date.now() - t0);
    for (const k of Object.keys(G.war)) { const key = k + '@' + G.war[k].since; if (!seenWars.has(key)) { seenWars.add(key); wars++; } }
    for (const c of G.cities) { const o = owner0.get(c.id); if (o === undefined) owner0.set(c.id, c.owner); else if (o !== c.owner) { caps++; capLog.push(`T${G.turn} ${CIVS[G.players[c.owner].civ].key} took ${c.name} from ${CIVS[G.players[o].civ].key}`); owner0.set(c.id, c.owner); } }
    for (const cp of G.camps) campIds.add(cp.id);
  }
  const elim = majors.filter(P => !P.alive).length;
  totalWars += wars; totalCaps += caps; totalElim += elim;
  console.log(`game ${gi}: ${wars} wars, ${caps} cities captured, ${elim} civs eliminated, ${campIds.size} barbarian camps (${G.camps.length} left), slowest turn ${slow}ms`);
  for (const l of capLog.slice(0, 8)) console.log('   ' + l);
  console.log('   final:', majors.map(P => `${CIVS[P.civ].key.slice(0, 5)} ${P.alive ? G.cities.filter(c => c.owner === P.id).length + 'c ' + G.units.filter(u => u.owner === P.id && UNITS_MIL(u)).length + 'm' : 'dead'}`).join(' | '),
    '| at war now:', Object.keys(G.war).length);
  function UNITS_MIL(u) { const U = ev('UNITS')[u.type]; return U.military && U.cls !== 'recon'; }
}
console.log(`avg wars ${(totalWars / games).toFixed(1)}, captures ${(totalCaps / games).toFixed(1)}, eliminations ${(totalElim / games).toFixed(1)}`);
