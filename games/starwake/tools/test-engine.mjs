// Headless engine checks. Run: node games/starwake/tools/test-engine.mjs
import { loadEngine } from './load-engine.mjs';
const { SW, ev } = loadEngine();
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok:', m); };
const t0 = Date.now();

// 1. galaxy generation across sizes and shapes
for (const size of ['small', 'medium', 'large']) for (const shape of ['spiral2', 'spiral4', 'elliptical', 'ring']) {
  const G = SW.newGame({ seed: 'gen-' + size + shape, size, shape, allAI: true });
  const n = G.systems.length, want = ev('GALAXY_SIZES')[size].n;
  const d = SW.jumpDist(G, [0]);
  const connected = Array.from(d).every(x => x >= 0);
  const lanes = G.systems.reduce((a, s) => a + s.lanes.length, 0) / 2;
  const caps = SW.majors(G).map(e => G.planets[e.capital]);
  check(n >= want * 0.95 && n <= want && connected && lanes >= n - 1 && caps.every(p => p && p.col && p.col.pops === 20) && G.beacons.length >= 4,
    `${size}/${shape}: ${n} stars, ${lanes} lanes, connected, ${caps.length} capitals, ${G.beacons.length} beacons, ${G.planets.length} bodies`);
}
// 2. a player game: commands work
{
  const G = SW.newGame({ seed: 'cmd', size: 'small', player: ev('SPECIES_PRESETS')[1] });
  const e = G.empires[0], cap = G.planets[e.capital];
  check(!e.ai && G.species[e.species].name === 'Ollvae', 'player empire uses the chosen species');
  check(SW.queueBuild(G, e, cap, 'd', 'habitat') === null, 'queue a district');
  e.res.minerals += 400; check(SW.queueBuild(G, e, cap, 'b', 'foundry') === null, 'queue a building');
  const surv = G.fleets.find(f => f.owner === 0 && f.kind === 'survey');
  const tgt = G.systems[cap.sys].lanes[0];
  check(SW.orderFleet(G, surv, { t: 'survey', sys: tgt }) === null, 'order a survey');
  SW.chooseTech(G, e, 'lumen', e.research.lumen.opts[0]); SW.chooseTech(G, e, 'vita', e.research.vita.opts[0]); SW.chooseTech(G, e, 'forge', e.research.forge.opts[0]);
  for (let i = 0; i < 600; i++) { SW.advanceDay(G); for (const p of SW.playerEvents(G, 0)) SW.resolveEvent(G, p.id, 0); }
  check(e.surv[tgt] === 1, 'survey completes');
  check(cap.col.dist.habitat === 2 && cap.col.bld.includes('foundry'), 'district and building complete');
  check(e.stats.techs >= 1, 'research completes (' + e.stats.techs + ')');
  const yard = G.planets[e.capital].sys;
  check(SW.sbQueue(G, e, yard, 'ship', SW.bestDesign(G, e, 'picket')) === null, 'queue a warship');
  const before = G.fleets.filter(f => f.owner === 0 && f.kind === 'war').reduce((a, f) => a + f.ships.length, 0);
  for (let i = 0; i < 80; i++) SW.advanceDay(G);
  check(G.fleets.filter(f => f.owner === 0 && f.kind === 'war').reduce((a, f) => a + f.ships.length, 0) === before + 1, 'warship launched');
  check(SW.marketTrade(G, e, 'minerals', 10, true) === null, 'market trade');
  e.res.unity = 1000; check(SW.takeTradition(G, e, 'expanse') === null && e.trads.expanse === 1, 'adopt a tradition');
  e.res.influence = 500; check(SW.enactEdict(G, e, 'mining_drive') === null, 'enact an edict');
  const d = SW.saveDesign(G, e, 'picket', ['slug', 'slug', 'ceramite', 'booster'], 'Test');
  check(d && d.id, 'save a custom ship design');
}
// 2b. war: declare, win the orbit, invade, take the planet, make peace
{
  const G = SW.newGame({ seed: 'war', size: 'small', player: ev('SPECIES_PRESETS')[0] });
  const A = G.empires[0], B = G.empires[1];
  SW.meet(G, 0, 1); G.pending = [];
  A.res.influence = 200;
  check(SW.declareWar(G, 0, 1, 'conquest') === null && SW.atWar(G, 0, 1), 'declare war with a war goal');
  const target = G.planets[B.capital], tsys = target.sys;
  for (const f of G.fleets.filter(f => f.owner === 1 && f.kind === 'war')) SW.disbandFleet(G, f);
  const big = SW.bestDesign(G, A, 'picket'); const fl = SW.makeFleet(G, 0, tsys, Array(30).fill(big), 'war');
  let n = 0; while (G.systems[tsys].sb && !G.systems[tsys].sb.dis && n++ < 400) SW.advanceDay(G);
  check(G.systems[tsys].sb.dis === 1, 'fleet disables the enemy starbase (' + n + ' days)');
  check(SW.orderFleet(G, fl, { t: 'bombard', planet: target.id }) === null, 'order bombardment');
  for (let i = 0; i < 60; i++) SW.advanceDay(G);
  check(target.col.fort < 100, 'bombardment lowers fortification (' + Math.round(target.col.fort) + '%)');
  const army = SW.makeFleet(G, 0, tsys, Array(12).fill(0).map(() => ({ d: 'legion', hp: 180 })), 'army');
  check(SW.orderFleet(G, army, { t: 'invade', planet: target.id }) === null, 'order invasion');
  n = 0; while (target.col.owner === 1 && n++ < 300) SW.advanceDay(G);
  check(target.col.owner === 0, 'invasion captures the enemy capital (' + n + ' days)');
  check(G.systems[tsys].owner === 0 || G.systems[tsys].planets.some(id => G.planets[id].col && G.planets[id].col.owner === 1), 'system changes hands once its colonies fall');
  const w = SW.warBetween(G, 0, 1);
  if (w) { w.exh.def = 95; const r = SW.proposePeace(G, 0, w, 'surrender'); check(r.ok && !SW.atWar(G, 0, 1), 'beaten enemy accepts surrender'); }
  else check(!B.alive, 'war ended with the enemy destroyed');
}
// 3. full AI-only games: no exceptions, wars and peace happen, game ends
let warsSeen = 0, peaceSeen = 0, techMax = 0;
for (const [seed, size] of [['ai-1', 'small'], ['ai-2', 'medium']]) {
  const G = SW.newGame({ seed, size, allAI: true, years: 200 });
  let err = null;
  try { while (!G.over) SW.advanceDay(G); } catch (e) { err = e; console.log(e.stack); }
  check(!err, `${size} AI game runs to the end without exceptions (${Math.round(G.day / 360)} years, winner ${G.winner && G.winner.type})`);
  warsSeen += G.log.filter(l => /declared war/.test(l.m)).length; peaceSeen += G.log.filter(l => /white peace|yielded/.test(l.m)).length;
  techMax = Math.max(techMax, ...SW.majors(G).map(e => e.stats.techs));
  check(G.hist.length >= 10, 'history recorded each year');
  check(SW.majors(G).some(e => e.stats.anomalies > 0), 'anomalies studied');
}
check(warsSeen > 0 && peaceSeen > 0, `AI declares war (${warsSeen}) and makes peace (${peaceSeen})`);
check(techMax > 40, 'AI researches (max techs ' + techMax + ')');
// 4. save round trip and determinism
{
  const A = SW.newGame({ seed: 'det', size: 'small', allAI: true });
  for (let i = 0; i < 360 * 15; i++) SW.advanceDay(A);
  const s1 = SW.serializeGame(A);
  const B = SW.deserializeGame(s1);
  check(SW.serializeGame(B) === s1, `save/load round trip is identical (${(s1.length / 1024).toFixed(0)} KB)`);
  for (let i = 0; i < 360 * 5; i++) { SW.advanceDay(A); SW.advanceDay(B); }
  check(SW.serializeGame(A) === SW.serializeGame(B), 'loaded game continues identically');
  const C = SW.newGame({ seed: 'det', size: 'small', allAI: true });
  for (let i = 0; i < 360 * 20; i++) SW.advanceDay(C);
  check(SW.serializeGame(C) === SW.serializeGame(A), 'same seed gives the same game (determinism)');
}
console.log(`\n${fails ? fails + ' FAILED' : 'all engine checks passed'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(fails ? 1 : 0);
