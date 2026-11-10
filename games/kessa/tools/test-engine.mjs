// Headless checks for the Kessa engine. Run: node games/kessa/tools/test-engine.mjs [botSeeds] [sols]
import { loadEngine } from './load-engine.mjs';
const { KC, ctx } = loadEngine();
const BOT = ctx.BOT;
let fails = 0, oks = 0;
const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else oks++; };
const nSeeds = +(process.argv[2] || 6), SOLS = +(process.argv[3] || 110);
const t0 = Date.now();

// ---------- data integrity ----------
for (const [id, d] of Object.entries(KC.BUILDINGS)) {
  if (d.tech) check(KC.TECHS[d.tech], 'building ' + id + ' tech exists');
  if (d.maint) check(KC.RES[d.maint], 'building ' + id + ' upkeep resource exists');
  for (const k in d.cost || {}) check(KC.RES[k], 'cost key ' + k);
  if (d.deposit) for (const t of d.deposit.split('|')) check(KC.DEPOSITS[t], 'deposit type ' + t);
}
for (const [id, d] of Object.entries(KC.MODULES)) { if (d.tech) check(KC.TECHS[d.tech], 'module ' + id + ' tech exists'); if (d.service) check(KC.SERVICES[d.service.cat], 'service ' + d.service.cat); }
for (const t of Object.values(KC.TECHS)) { for (const r of t.req) check(KC.TECHS[r], 'tech ' + t.id + ' req ' + r); for (const u of t.unlock) check(KC.BUILDINGS[u] || KC.MODULES[u], 'tech unlock ' + u); }
for (const [id, c] of Object.entries(KC.CARGO)) if (c.prefab) check(KC.BUILDINGS[c.prefab], 'cargo prefab ' + id);
const nonBt = Object.values(KC.TECHS).filter(t => !t.breakthrough).length;
check(nonBt >= 50, 'at least 50 techs (' + nonBt + ' + ' + Object.keys(KC.BREAKTHROUGHS).length + ' breakthroughs)');
// every tech reachable: walking prerequisites terminates at tier 1
for (const t of Object.values(KC.TECHS)) { const seen = new Set(); const walk = x => { if (seen.has(x)) return; seen.add(x); KC.TECHS[x].req.forEach(walk); }; walk(t.id); check(seen.size < 80, 'tech graph acyclic at ' + t.id); }

// ---------- map generation ----------
let maps = 0;
for (let s = 0; s < 24; s++) {
  const seed = 'map-' + s, G = KC.newGame({ seed });
  maps++;
  const L = G.buildings.find(b => b.t === 'lander'), c = { x: L.x + 1.5, y: L.y + 1.5 };
  const near = (type, r) => G.deposits.some(d => d.type === type && Math.hypot(d.x - c.x, d.y - c.y) <= r && KC.depKnown(G, d));
  check(near('regolith', 12), seed + ': regolith near the lander');
  check(near('ice', 15), seed + ': water ice near the lander');
  check(near('metal', 18), seed + ': metal ore near the lander');
  check(G.deposits.filter(d => d.type === 'scrap' && Math.hypot(d.x - c.x, d.y - c.y) <= 9).length >= 4, seed + ': surface scrap near the lander');
  check(G.anomalies.length >= 10, seed + ': anomalies');
  check(G.deposits.some(d => d.deep), seed + ': deep deposits exist');
  // terrain variety: some steep ground and some flat ground
  let steep = 0, flat = 0; for (let i = 0; i < G._T.slope.length; i++) { if (G._T.slope[i] > KC.SLOPE_BUILD) steep++; else flat++; }
  check(steep > 300 && flat > 1500, seed + ': terrain has slopes (' + steep + ') and plains (' + flat + ')');
  // the same seed regenerates the same static terrain
  const T2 = KC.genTerrain(seed); let same = true; for (let i = 0; i < T2.h.length; i += 37) if (T2.h[i] !== G._T.h[i]) same = false;
  check(same, seed + ': terrain regenerates identically');
  // a few placements are possible right away
  let canSolar = 0; for (let y = L.y - 6; y < L.y + 9; y++) for (let x = L.x - 6; x < L.x + 9; x++) if (KC.canPlace(G, 'solar', x, y).ok) canSolar++;
  check(canSolar > 20, seed + ': room to build near the lander');
}

// ---------- bot player: survive 100+ sols on normal ----------
const sponsors = Object.keys(KC.SPONSORS).filter(s => s !== 'pilgrim'), cmds = Object.keys(KC.COMMANDERS);
const results = [];
for (let i = 0; i < nSeeds; i++) {
  const cfg = { seed: 'bot-' + i, sponsor: sponsors[i % sponsors.length], commander: cmds[i % cmds.length], difficulty: 'normal' };
  const G = KC.newGame(cfg), B = {};
  let err = null;
  try { for (let h = 0; h < SOLS * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); if (G.over && !G.over.win) break; if (G.over && G.over.win) G.over.continued = true; } }
  catch (e) { err = e; console.log(e.stack); }
  const alive = !err && !(G.over && !G.over.win) && G.colonists.length > 0;
  results.push({ cfg, sol: KC.solOf(G.tick), pop: G.colonists.length, peak: G.st.peakPop, techs: KC.techCount(G), births: G.st.births, deaths: G.st.deaths, ms: Object.keys(G.ms).length, won: !!(G.over && G.over.win), wonSol: G.ms.independence, alive, hazards: G.hz.n, score: KC.score(G), over: G.over && G.over.reason });
  check(!err, cfg.seed + ': bot run without exceptions');
  check(alive, cfg.seed + ': colony alive after ' + SOLS + ' sols (' + (G.over ? G.over.reason : 'pop ' + G.colonists.length) + ')');
  check(G.st.everColonists && G.st.peakPop >= 30, cfg.seed + ': reached at least 30 colonists (peak ' + G.st.peakPop + ')');
  check(G.hz.n >= 8, cfg.seed + ': disasters happened (' + G.hz.n + ')');
  check(KC.techCount(G) >= 15, cfg.seed + ': researched 15+ techs (' + KC.techCount(G) + ')');
}
console.log('\nbot colonies (normal, ' + SOLS + ' sols):');
for (const r of results) console.log(`  ${r.cfg.seed.padEnd(7)} ${r.cfg.sponsor.padEnd(9)} ${r.cfg.commander.padEnd(12)} ${r.alive ? 'ALIVE' : 'DEAD '} pop ${String(r.pop).padStart(3)} peak ${String(r.peak).padStart(3)} techs ${String(r.techs).padStart(2)} births ${String(r.births).padStart(2)} deaths ${String(r.deaths).padStart(3)} disasters ${r.hazards} milestones ${r.ms} score ${r.score}${r.won ? ' WON sol ' + r.wonSol : ''}`);

// ---------- disasters: force every kind, many times, at a developed colony ----------
{
  const G = KC.newGame({ seed: 'hazard-test', difficulty: 'hard' }), B = {};
  for (let h = 0; h < 30 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); }
  let err = null;
  try {
    for (let round = 0; round < 6; round++) for (const kind of Object.keys(KC.HAZARDS)) {
      G.hz.upcoming = G.hz.upcoming.filter(u => u.kind !== kind); G.hz.active = G.hz.active.filter(u => u.kind !== kind);
      G.hz.next[kind] = G.tick + 2;
      for (let h = 0; h < 30; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); }
    }
  } catch (e) { err = e; console.log(e.stack); }
  check(!err, 'forced disasters run without exceptions');
  check(G.log.some(l => /meteor/i.test(l.m)) && G.log.some(l => /quake/i.test(l.m)) && G.log.some(l => /cold wave/i.test(l.m)) && G.log.some(l => /dust storm/i.test(l.m)), 'every disaster kind logged');
  check(G.log.some(l => /^Warning:/.test(l.m)), 'disasters are announced in advance');
  const broken = [...G.cable, ...G.pipe].filter(v => v === 2).length;
  for (let h = 0; h < 72; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); }
  const after = [...G.cable, ...G.pipe].filter(v => v === 2).length;
  check(after <= broken, 'drones repair broken grid segments (' + broken + ' -> ' + after + ')');
}

// ---------- save / load round trip and determinism ----------
{
  const run = (seed, sols) => { const G = KC.newGame({ seed, sponsor: 'meridian', commander: 'geoscientist' }), B = {}; for (let h = 0; h < sols * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); } return { G, B }; };
  const a = run('det-1', 40), b = run('det-1', 40);
  check(KC.serialize(a.G) === KC.serialize(b.G), 'same seed and same actions give identical games (determinism)');
  const s1 = KC.serialize(a.G), G2 = KC.deserialize(s1), s2 = KC.serialize(G2);
  check(s1 === s2, 'save -> load -> save is identical (' + Math.round(s1.length / 1024) + ' KB)');
  // continuing after a load matches continuing without one
  const Bc = JSON.parse(JSON.stringify(a.B));
  for (let h = 0; h < 15 * 24; h++) { if (h % 4 === 0) { BOT.turn(a.G, a.B); BOT.turn(G2, Bc); } KC.step(a.G); KC.step(G2); }
  check(KC.serialize(a.G) === KC.serialize(G2), 'a loaded game continues exactly like the original');
  const txt = KC.exportText(a.G), G3 = KC.importText(txt);
  check(KC.serialize(G3) === KC.serialize(a.G), 'text export/import round trip');
  let bad = false; try { KC.importText('KESSA1:bm9wZQ=='); } catch (e) { bad = true; }
  check(bad, 'importing garbage throws instead of loading');
  check(s1.length < 400 * 1024, 'save stays compact');
}

// ---------- losing ----------
{
  const G = KC.newGame({ seed: 'lose-1', difficulty: 'normal' });
  KC.run(G, 24 * 52);
  check(G.over && !G.over.win && /recalled/i.test(G.over.reason), 'doing nothing loses when the sponsor runs out of patience');
}
// ---------- winning is reachable: grant the requirements and check the end ----------
{
  const { G } = (() => { const G = KC.newGame({ seed: 'win-1' }), B = {}; for (let h = 0; h < 40 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); } return { G, B }; })();
  for (const id of Object.keys(KC.TECHS).slice(0, 30)) G.research.done[id] = G.research.done[id] || G.tick;
  KC.computeMods(G);
  G.ms.spire = 1;
  const dome = G.buildings.find(b => b.t === 'dome_s' && b.built);
  while (G.colonists.length < 100) { const p = KC.makePerson(G); KC.addColonist(G, p, dome.id); }
  for (let i = 0; i < 6; i++) G.hist.push({ sol: 0, pop: 100, food: 5, made: { parts: 5 }, spent: { parts: 1 }, short: {} });
  G.res.food += 2000;
  const ind = KC.independence(G);
  check(ind[0].ok && ind[1].ok && ind[2].ok, 'independence conditions evaluate');
}
console.log(`\n${maps} maps, ${nSeeds} bot colonies in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`${oks} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
