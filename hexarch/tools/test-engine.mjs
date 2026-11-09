// Headless checks for the engine. Run: node hexarch/tools/test-engine.mjs
import { loadEngine } from './load-engine.mjs';
const { HX, ev } = loadEngine();
const TERRAIN = ev('TERRAIN'), MAPSIZE = ev('MAPSIZE'), RES = ev('RES');
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };
const majors = G => G.players.filter(P => !P.barbarian);

const sizes = ['small', 'medium', 'large'], scripts = ['continents', 'pangaea', 'archipelago', 'islands'];
const dist = {};
let t0 = Date.now(), maps = 0;
for (const size of sizes) for (const script of scripts) for (let s = 0; s < 6; s++) {
  const rivals = MAPSIZE[size].maxCivs - 1;
  const G = HX.makeGame({ size, script, rivals, seed: `t-${size}-${script}-${s}`, difficulty: 3 }, { allAI: true });
  maps++;
  const m = G.map, N = m.W * m.H;
  const cnt = new Array(10).fill(0); let rivers = 0, res = 0;
  for (let i = 0; i < N; i++) { cnt[m.terrain[i]]++; if (m.river[i]) rivers++; if (m.res[i] >= 0) res++; }
  const land = cnt.slice(0, 8).reduce((a, b) => a + b, 0);
  const key = script; dist[key] = dist[key] || { n: 0, land: 0, t: new Array(10).fill(0), rivers: 0 };
  dist[key].n++; dist[key].land += land / N; dist[key].rivers += rivers;
  for (let k = 0; k < 8; k++) dist[key].t[k] += cnt[k] / land;
  check(majors(G).length === rivals + 1 && G.players.some(P => P.barbarian), 'player count');
  // each civ starts with a settler on land
  for (const P of majors(G)) {
    const st = G.units.find(u => u.owner === P.id && u.type === 'settler');
    check(st && TERRAIN[m.terrain[st.tile]].land, `settler on land ${size}/${script}/${s}`);
  }
  check(rivers > 0, `rivers exist ${size}/${script}/${s}`);
  // fairness: start landmass size and start quality spread
  const landMask = new Uint8Array(N); for (let i = 0; i < N; i++) landMask[i] = TERRAIN[m.terrain[i]].land && m.terrain[i] !== 7 ? 1 : 0;
  const comp = ev('components')(G._grid, landMask);
  const starts = majors(G).map(P => G.units.find(u => u.owner === P.id && u.type === 'settler').tile);
  const minLand = Math.min(...starts.map(t => comp.sizes[comp.id[t]]));
  if (script === 'continents' || script === 'pangaea') check(minLand >= 40, `start landmass >= 40 on ${size}/${script}/${s} (got ${minLand})`);
  const sc = starts.map(t => HX.siteScore(m, G._grid, t));
  dist[key].spread = Math.max(dist[key].spread || 0, Math.min(...sc) / Math.max(...sc));
  dist[key].worst = Math.min(dist[key].worst ?? 1, Math.min(...sc) / Math.max(...sc));
}
console.log(`generated ${maps} maps in ${Date.now() - t0}ms`);
for (const k in dist) {
  const d = dist[k];
  console.log(k.padEnd(12), 'land', (d.land / d.n * 100).toFixed(1) + '%', 'riverTiles', (d.rivers / d.n).toFixed(0),
    TERRAIN.slice(0, 8).map((T, i) => T.key + ':' + (d.t[i] / d.n * 100).toFixed(0)).join(' '), 'worstStartRatio', d.worst.toFixed(2));
}

// determinism: same seed => same map
const a = HX.makeGame({ size: 'medium', script: 'continents', seed: 'det-check', rivals: 3 });
const b = HX.makeGame({ size: 'medium', script: 'continents', seed: 'det-check', rivals: 3 });
check(HX.serializeGame(a) === HX.serializeGame(b), 'same seed gives identical game');

// all-AI play: every civ founds a capital quickly and explores
for (const size of sizes) for (const script of scripts) {
  const G = HX.makeGame({ size, script, rivals: MAPSIZE[size].maxCivs - 1, seed: 'ai-' + size + script, difficulty: 3 }, { allAI: true });
  const capTurn = {};
  const t1 = Date.now();
  while (G.turn <= 60) {
    const pid = G.active;
    HX.aiTakeTurn(G, pid);
    if (!capTurn[pid] && G.cities.some(c => c.owner === pid)) capTurn[pid] = G.turn;
    HX.endPlayerTurn(G);
    const seenTiles = new Set();
    for (const u of G.units) {
      const civ = ev('UNITS')[u.type].civilian, key = (civ ? 'c' : 'm') + u.tile;
      if (seenTiles.has(key)) { check(false, `stacked ${key} on turn ${G.turn} ${size}/${script}`); break; }
      seenTiles.add(key);
      if ((civ ? G._civ : G._mil).get(u.tile) !== u) { check(false, `occupancy index out of sync on ${size}/${script}`); break; }
    }
  }
  const N = G.map.W * G.map.H;
  const expl = majors(G).map(P => (P.explored.reduce((x, y) => x + y, 0) / N * 100).toFixed(0) + '%');
  const cities = majors(G).map(P => G.cities.filter(c => c.owner === P.id).length);
  console.log(`${size}/${script}: capitals on turns ${JSON.stringify(capTurn)} cities ${cities} explored ${expl} (${Date.now() - t1}ms)`);
  for (const P of majors(G)) check(capTurn[P.id] && capTurn[P.id] <= 4, `capital by turn 4 for p${P.id} on ${size}/${script}`);
  // each civ has seen most of the landmass its capital sits on (scouts are not stuck)
  const lm = new Uint8Array(N); for (let i = 0; i < N; i++) lm[i] = TERRAIN[G.map.terrain[i]].land && G.map.terrain[i] !== 7 ? 1 : 0;
  const comp = ev('components')(G._grid, lm);
  const own = majors(G).map(P => { const c = G.cities.find(x => x.owner === P.id); let a = 0, b = 0;
    for (let i = 0; i < N; i++) if (comp.id[i] === comp.id[c.tile]) { b++; if (P.explored[i]) a++; } return { f: a / b, a, b }; });
  console.log('   own-landmass explored', own.map(x => (x.f * 100).toFixed(0) + '% of ' + x.b).join(', '));
  for (const [k, x] of own.entries()) check(x.a >= Math.min(0.5 * x.b, 300), `p${k} explored enough of home landmass on ${size}/${script} (${x.a}/${x.b})`);
  // save round trip
  const s1 = HX.serializeGame(G), G2 = HX.deserializeGame(s1), s2 = HX.serializeGame(G2);
  check(s1 === s2, 'serialize round trip ' + size + script);
}
// ---- economy invariants over a long all-AI game ----
{
  const TECHS = ev('TECHS'), TECHI = ev('TECHI');
  const G = HX.makeGame({ size: 'medium', script: 'pangaea', rivals: 4, seed: 'econ-inv', difficulty: 1 }, { allAI: true });
  let bad = 0;
  while (G.turn <= 180) {
    HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G);
    if (G.active !== 0) continue;
    const used = new Set();
    for (const c of G.cities) {
      if (c.pop < 1) { bad++; check(false, 'city pop below 1'); }
      for (const t of c.worked) {
        if (G.map.ocity[t] !== c.id || G.map.owner[t] !== c.owner) { bad++; check(false, `${c.name} works a tile it does not own`); break; }
        if (used.has(t)) { bad++; check(false, 'tile worked twice'); break; }
        used.add(t);
      }
      if (c.worked.length > c.pop) { bad++; check(false, 'more worked tiles than citizens'); }
    }
    for (const P of G.players) {
      if (P.gold < 0) { bad++; check(false, 'negative treasury'); }
      P.techs.forEach((k, i) => TECHS[TECHI[k]].pre.forEach(q => { if (P.techs.indexOf(q) < 0 || P.techs.indexOf(q) > i) { bad++; check(false, `tech ${k} learned before ${q}`); } }));
    }
    if (bad > 5) break;
  }
  const P0 = G.players[0];
  check(P0.techs.length >= 25, `research progresses (${P0.techs.length} techs by turn 180)`);
  check(G.cities.every(c => c.pop >= 1) && G.cities.some(c => c.pop >= 8), 'cities grow');
  check(G.cities.some(c => c.buildings.length > 4), 'cities construct buildings');
  check(G.routes.length > 0, 'trade routes are established');
  let imp = 0, road = 0; for (let i = 0; i < G.map.improv.length; i++) { if (G.map.improv[i]) imp++; if (G.map.road[i]) road++; }
  check(imp > 50 && road > 10, `builders improve land (${imp} improvements, ${road} roads)`);
  const s1 = HX.serializeGame(G); check(HX.serializeGame(HX.deserializeGame(s1)) === s1, 'economy save round trip');

  // a build-1 save (format 1) still loads
  const G1 = HX.makeGame({ size: 'small', script: 'continents', rivals: 2, seed: 'v1' });
  const o = JSON.parse(HX.serializeGame(G1));
  o.format = 1; delete o.map.improv; delete o.map.road; delete o.routes;
  o.units.forEach(u => { u.moves = Math.round(u.moves / 6); delete u.charges; });
  o.players.forEach(p => { for (const k of ['gold', 'techs', 'research', 'rqueue', 'progress', 'insights', 'cultureTotal', 'lastEcon']) delete p[k]; p.stats = { founded: 0 }; });
  let G2 = null; try { G2 = HX.deserializeGame(JSON.stringify(o)); } catch (e) { console.log(e); }
  check(G2 && G2.players[0].gold >= 0 && G2.units[0].moves === G2.units[0].moves && Array.isArray(G2.players[0].techs), 'build-1 save migrates');
  if (G2) { HX.endPlayerTurn(G2); while (!G2.players[G2.active].human) { HX.aiTakeTurn(G2, G2.active); HX.endPlayerTurn(G2); } check(G2.turn === 2, 'migrated game keeps playing'); }
}
// ---- policies and tile control ----
{
  const POLICY_TREES = ev('POLICY_TREES');
  const G = HX.makeGame({ size: 'small', script: 'pangaea', rivals: 1, seed: 'pol' });
  const P = G.players[0], s0 = G.units.find(u => u.owner === 0 && u.type === 'settler');
  HX.foundCity(G, s0);
  const c = G.cities.find(x => x.owner === 0);
  P.culturePool = 100000;
  check(!HX.adoptPolicy(G, 0, 'aristocracy'), 'cannot skip a tree opener');
  check(!HX.adoptPolicy(G, 0, 'commerce'), 'Commerce is era-gated');
  const before = HX.cityReport(G, c);
  check(HX.adoptPolicy(G, 0, 'tradition'), 'adopt Tradition');
  const after = HX.cityReport(G, c);
  check(after.cul >= before.cul + 3 && after.food >= before.food + 2, 'Tradition boosts capital culture and food');
  const c1 = HX.policyCost(G, 0); HX.adoptPolicy(G, 0, 'expansion'); check(HX.policyCost(G, 0) > c1, 'policy costs rise');
  for (const k of ['aristocracy', 'landed_elite', 'monarchy', 'legalism']) HX.adoptPolicy(G, 0, k);
  check(P.treesDone.includes('tradition'), 'finishing a tree records it');
  check(c.buildings.includes('monument'), 'Legalism grants a Monument');
  const nUnits = G.units.filter(u => u.owner === 0).length;
  for (const k of ['citizenship', 'collective_rule', 'republic', 'meritocracy']) HX.adoptPolicy(G, 0, k);
  check(G.units.filter(u => u.owner === 0).length >= nUnits + 2, 'Citizenship and the Expansion finisher grant units');
  check(HX.itemCost(G, { k: 'u', key: 'settler' }, 0) < HX.itemCost(G, { k: 'u', key: 'settler' }), 'Collective Rule discounts Settlers');
  P.techs.push('education'); // Medieval era opens Enlightenment
  const nt = P.techs.length;
  for (const k of ['enlightenment', 'scholasticism', 'academies', 'free_thought', 'patronage']) HX.adoptPolicy(G, 0, k);
  check(P.techs.length === nt + 1, 'Enlightenment finisher grants a free tech');

  // tile control
  c.pop = 3; for (const t of G._grid.within(c.tile, 2)) if (G.map.owner[t] < 0) { G.map.owner[t] = 0; G.map.ocity[t] = c.id; c.tiles.push(t); }
  HX.assignWorkers(G, c);
  const tiles = HX.workableTiles(G, c), unworked = tiles.find(t => !c.worked.includes(t));
  check(HX.toggleTileWork(G, c, unworked) && c.worked.includes(unworked) && c.locked.includes(unworked), 'pinning a tile works it');
  check(HX.toggleTileWork(G, c, unworked) && !c.locked.includes(unworked), 'tapping a pinned tile releases it');
  HX.setForcedSpec(G, c, 2); check(c.worked.length === 1, 'forced scholars leave tiles');
  HX.resetTiles(G, c); check(c.worked.length === 3 && !c.forcedSpec, 'automatic restores the focus');
  const buy = G._grid.within(c.tile, 3).find(t => HX.tileBuyCost(G, c, t) !== null);
  P.gold = 1000;
  check(buy !== undefined && HX.buyTile(G, c, buy) && G.map.owner[buy] === 0 && P.gold < 1000, 'buying a tile claims it');
  const sv = HX.serializeGame(G); check(HX.serializeGame(HX.deserializeGame(sv)) === sv, 'policies and pins survive save and load');
}
// ---- religion ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', rivals: 1, seed: 'rel' });
  for (const P of majors(G)) { const st = G.units.find(u => u.owner === P.id && u.type === 'settler'); HX.foundCity(G, st); }
  const [A, B] = majors(G), ca = G.cities.find(c => c.owner === 0), cb = G.cities.find(c => c.owner === 1);
  A.techs.push('mysticism', 'philosophy', 'theology'); B.techs.push('mysticism');
  A.faith = 30; B.faith = 30;
  check(!HX.pickPantheon(G, 0, 'nonsense'), 'unknown pantheon rejected');
  check(HX.pickPantheon(G, 0, 'sun_altar'), 'pick a pantheon');
  check(!HX.pickPantheon(G, 1, 'sun_altar'), 'pantheons are exclusive');
  const f0 = HX.cityReport(G, ca).faith; check(f0 >= 1, 'Sun Altar adds faith (' + f0 + ')');
  A.faith = 1000; ev('checkProphet')(G, 0);
  const pr = G.units.find(u => u.owner === 0 && u.type === 'prophet');
  check(!!pr, 'a Prophet appears with enough faith after Philosophy');
  ev('placeUnit')(G, pr, ca.tile); pr.moves = 12;
  const rel = HX.foundReligion(G, pr, 0, 'tithe', 'scriptoria');
  check(rel && HX.cityReligion(G, ca).major === rel.id, 'found a religion; holy city follows it');
  check(!HX.freeBeliefs(G, 'founder').includes('tithe'), 'beliefs are exclusive');
  A.faith = 1000; ev('checkProphet')(G, 0);
  const pr2 = G.units.find(u => u.owner === 0 && u.type === 'prophet');
  check(pr2 && HX.enhanceReligion(G, pr2, 'peace_gardens', 'missionary_zeal'), 'enhance with a second Prophet after Theology');
  // missionary converts the rival's city
  cb.pop = 3; A.faith = 1000;
  check(HX.buyWithFaith(G, ca, { k: 'u', key: 'missionary' }), 'buy a Missionary with faith');
  const ms = G.units.find(u => u.owner === 0 && u.type === 'missionary');
  const stand = G._grid.neighbors(cb.tile).find(t => ev('passableTerrain')(G, t) && !G._civ.has(t));
  ev('placeUnit')(G, ms, stand); ms.moves = 18;
  check(HX.spreadReligion(G, ms, cb.id) && HX.cityReligion(G, cb).major === rel.id, 'missionary converts a nearby city');
  B.techs.push('theology'); B.faith = 1000;
  check(HX.buyWithFaith(G, cb, { k: 'u', key: 'inquisitor' }), 'rival buys an Inquisitor');
  const iq = G.units.find(u => u.owner === 1 && u.type === 'inquisitor'); ev('placeUnit')(G, iq, cb.tile); iq.moves = 18;
  check(HX.purgeHeresy(G, iq, cb.id) && HX.cityReligion(G, cb).major === null, 'Inquisitor clears other faiths');
  // natural spread over time to a city within range
  const site = G._grid.within(ca.tile, 7).find(t => G._grid.dist(t, ca.tile) >= 5 && HX.foundCheck(G, 1, t).ok);
  const st2 = ev('spawnUnit')(G, 'settler', 1, site); const near = HX.foundCity(G, st2); near.pop = 4;
  for (let k = 0; k < 40; k++) ev('religionRound')(G);
  check((HX.cityReligion(G, near).followers[rel.id] || 0) > 0, 'religion spreads to a nearby city on its own');
  G.players.forEach((P, k) => HX.computeVisibility(G, k));
  check(HX.civReport(G, 0).rfx.g >= 0 && HX.civHappiness(G, 0).net !== undefined, 'religion effects compute');
  const sv = HX.serializeGame(G); check(HX.serializeGame(HX.deserializeGame(sv)) === sv, 'religion survives save and load');
}
// ---- combat ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', rivals: 1, seed: 'war', barbarians: 'off' });
  for (const P of majors(G)) { const st = G.units.find(u => u.owner === P.id && u.type === 'settler'); HX.foundCity(G, st); }
  const [A, B] = majors(G), ca = G.cities.find(c => c.owner === A.id), cb = G.cities.find(c => c.owner === B.id);
  const spawn = ev('spawnUnit'), g = G._grid;
  A.met.push(B.id); B.met.push(A.id);
  const near = (t, k) => g.within(t, 3).filter(x => ev('passableTerrain')(G, x) && !G._mil.has(x) && !G._cityAt.has(x) && g.dist(x, t) === k);
  let pair = null;
  for (const t1 of near(cb.tile, 1)) { const t2 = near(cb.tile, 2).find(x => g.dist(x, t1) === 1); if (t2 !== undefined) { pair = [t2, t1]; break; } }
  const a1 = spawn(G, 'swordsman', A.id, pair[0]);
  const b1 = spawn(G, 'militia', B.id, pair[1]);
  HX.computeVisibility(G, A.id);
  check(!HX.attackStatus(G, a1, b1.tile).ok && HX.attackStatus(G, a1, b1.tile).peace === B.id, 'no attacks at peace');
  check(HX.declareWar(G, A.id, B.id) && HX.atWar(G, A.id, B.id), 'declare war');
  const pv = HX.combatPreview(G, a1, b1.tile);
  check(pv.ok && pv.dmgToTarget > pv.dmgToAttacker, `stronger unit wins the exchange (${pv.dmgToTarget} vs ${pv.dmgToAttacker})`);
  const res = HX.doAttack(G, a1, b1.tile);
  check(res && res.dmgT > 0 && a1.moves === 0 && a1.xp > 0, 'attack resolves, ends moves, grants experience');
  // ranged attack takes no damage
  const ar = spawn(G, 'archer', A.id, near(cb.tile, 2).find(t => t !== a1.tile && !G._mil.has(t)));
  HX.computeVisibility(G, A.id);
  const hp0 = ar.hp, r2 = HX.doAttack(G, ar, cb.tile);
  check(r2 && cb.hp < HX.cityMaxHp(G, cb) && ar.hp === hp0, 'ranged attack on a city costs the archer nothing');
  // capture a city once its health is gone
  cb.hp = 1; const gar = G._mil.get(cb.tile); if (gar) ev('removeUnit')(G, gar);
  const cap = spawn(G, 'swordsman', A.id, near(cb.tile, 1).find(t => !G._mil.has(t))); cap.moves = 12;
  HX.computeVisibility(G, A.id);
  const r3 = HX.doAttack(G, cap, cb.tile);
  check(r3 && r3.captured && cb.owner === A.id && cap.tile === cb.tile, 'melee attack captures a city at zero health');
  check(!B.alive || G.units.some(u => u.owner === B.id && u.type === 'settler') || G.cities.some(c => c.owner === B.id), 'elimination only when no cities or settlers');
  check(!B.alive, 'losing the last city eliminates the civilization');
  // promotions and upgrades
  cap.xp = 40; const ch = HX.promoChoices(G, cap);
  check(ch.length > 0 && HX.promote(G, cap, ch[0]) && cap.promos.length === 1, 'promote with enough experience');
  const mil = spawn(G, 'militia', A.id, ca.tile); A.techs.push('bronze_working'); A.gold = 500; mil.moves = 12;
  check(HX.upgradeUnit(G, mil) && mil.type === 'cohort_spear' || mil.type === 'spearman', 'upgrade to the next unit (unique if any)');
  // embarkation needs Sailing; landing ends movement
  const coastT = g.within(ca.tile, 6).find(t => G.map.terrain[t] === 8 && !G.map.lake[t] && g.neighbors(t).some(n => ev('passableTerrain')(G, n) && !G._mil.has(n)));
  if (coastT !== undefined) {
    const shore = g.neighbors(coastT).find(n => ev('passableTerrain')(G, n) && !G._mil.has(n));
    const em = spawn(G, 'militia', A.id, shore);
    check(!ev('passableFor')(G, em, coastT), 'cannot embark without Sailing');
    A.techs.push('sailing');
    check(ev('passableFor')(G, em, coastT) && ev('stepCost')(G, em, shore, coastT) >= ev('STOP'), 'embarking ends movement');
  }
  G.players.forEach((P, k) => HX.computeVisibility(G, k));
  const sv = HX.serializeGame(G); check(HX.serializeGame(HX.deserializeGame(sv)) === sv, 'combat state survives save and load');
}
// barbarians spawn and AI wars happen
{
  const G = HX.makeGame({ size: 'small', script: 'continents', rivals: 3, seed: 'barb', barbarians: 'raging' }, { allAI: true });
  let camps = 0, wars = 0; const seen = new Set();
  while (G.turn <= 120) { HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G); for (const c of G.camps) seen.add(c.id); for (const k in G.war) seen.add('w' + k + G.war[k].since); }
  for (const k of seen) if (typeof k === 'number') camps++; else wars++;
  check(camps >= 3, `barbarian camps appear (${camps})`);
  check(G.units.some(u => u.owner === G.players.findIndex(P => P.barbarian)) || camps > 0, 'barbarian units exist');
  check(wars >= 1, `AI civilizations go to war (${wars})`);
  const sv = HX.serializeGame(G); check(HX.serializeGame(HX.deserializeGame(sv)) === sv, 'late-game war save round trip');
}
console.log(fails ? `${fails} failures` : 'all checks passed');
process.exit(fails ? 1 : 0);
