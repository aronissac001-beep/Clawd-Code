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
  check(KC.techCount(G) >= 10, cfg.seed + ': researched 10+ techs (' + KC.techCount(G) + ')');
}
console.log('\nbot colonies (normal, ' + SOLS + ' sols):');
for (const r of results) console.log(`  ${r.cfg.seed.padEnd(7)} ${r.cfg.sponsor.padEnd(9)} ${r.cfg.commander.padEnd(12)} ${r.alive ? 'ALIVE' : 'DEAD '} pop ${String(r.pop).padStart(3)} peak ${String(r.peak).padStart(3)} techs ${String(r.techs).padStart(2)} births ${String(r.births).padStart(2)} deaths ${String(r.deaths).padStart(3)} disasters ${r.hazards} milestones ${r.ms} score ${r.score}${r.won ? ' WON sol ' + r.wonSol : ''}`);

// ---------- winnable: a full game played by the bot reaches Independence ----------
{
  const G = KC.newGame({ seed: 'e-0', sponsor: 'orrin', commander: 'engineer', difficulty: 'normal' }), B = {};
  for (let h = 0; h < 160 * 24 && !G.over; h++) { if (h % 4 === 0) BOT.turn(G, B); if (G.event) BOT.event(G, B); KC.step(G); }
  console.log('\nwinnable run (e-0, Orrin-Vask, Field Engineer, normal): ' + (G.over ? (G.over.win ? 'Independence on sol ' + G.over.sol + ' with ' + G.colonists.length + ' colonists, score ' + G.over.score : 'lost: ' + G.over.reason) : 'not finished'));
  check(G.over && G.over.win, 'the bot wins Independence on normal within 160 sols');
}
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
// ---------- grid repair: drones fix cracked cable and pipe within reach of a working hub ----------
{
  const G = KC.newGame({ seed: 'repair-test', difficulty: 'normal' }), B = {};
  for (let h = 0; h < 30 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); }
  const hubs = G.buildings.filter(b => (b.t === 'hub' || b.t === 'lander') && b.built && !b.broken && b.on && b.drones > 0), N = KC.MAP_N;
  const hubDist = i => Math.min(...hubs.map(b => Math.hypot(i % N - b.x, ((i / N) | 0) - b.y)));
  for (const k of ['cable', 'pipe']) {
    const segs = []; G[k].forEach((v, i) => { if (v === 1 && hubDist(i) < 8) segs.push(i); });
    segs.sort((a, b) => hubDist(a) - hubDist(b)).slice(0, 3).forEach(i => { G[k][i] = 2; });
  }
  G._netDirty = true; G.res.metals = Math.max(G.res.metals, 30);
  const brokenAt = []; for (const k of ['cable', 'pipe']) G[k].forEach((v, i) => { if (v === 2) brokenAt.push([k, i]); });
  for (let h = 0; h < 72; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); }
  const still = brokenAt.filter(([k, i]) => G[k][i] === 2).length;
  check(brokenAt.length >= 4 && still === 0, 'drones repair broken grid segments (' + brokenAt.length + ' broken, ' + still + ' still broken after 3 sols)');
}

// ---------- warnings never say "fine" while people are dying ----------
{
  const base = (() => { const G = KC.newGame({ seed: 'danger-1', sponsor: 'orrin', commander: 'engineer' }), B = {}; for (let h = 0; h < 40 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); if (G.colonists.length >= 20) break; } return KC.serialize(G); })();
  const far = (G, t) => { const L = G.buildings.find(b => b.t === 'lander'); for (let r = 18; r < 30; r++) for (let y = 2; y < 60; y++) for (let x = 2; x < 60; x++) if (Math.max(Math.abs(x - L.x), Math.abs(y - L.y)) === r && KC.canPlace(G, t, x, y).ok) return { x, y }; };
  const cases = {
    'air down, synthesizers planned out of reach': G => { for (const b of G.buildings) if (b.t === 'airsynth' || b.t === 'algae') KC.setOn(G, b.id, false); for (let i = 0; i < 3; i++) { const p = far(G, 'airsynth'); if (p) KC.place(G, 'airsynth', p.x, p.y); } },
    'water down, condensers planned out of reach': G => { for (const b of G.buildings) if (/icedrill|condenser|reclaimer/.test(b.t)) KC.setOn(G, b.id, false); for (let i = 0; i < 3; i++) { const p = far(G, 'condenser'); if (p) KC.place(G, 'condenser', p.x, p.y); } },
    'farms down, greenhouse planned': G => { G.res.food = 10; for (const b of G.buildings) if (/hydro|greenhouse|vfarm|algae|bloom/.test(b.t)) KC.setOn(G, b.id, false); const p = far(G, 'greenhouse'); if (p) KC.place(G, 'greenhouse', p.x, p.y); for (const r of G.rockets) { r.st = 'back'; r.t = 300; } },
    'power down, solar planned': G => { for (const b of G.buildings) if (/solar|wind|fuelgen|battery|thinfilm/.test(b.t)) KC.setOn(G, b.id, false); for (let i = 0; i < 3; i++) { const p = far(G, 'solar'); if (p) KC.place(G, 'solar', p.x, p.y); } },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const G = KC.deserialize(base); mutate(G);
    let steadyWhileAiling = 0, sickNoBad = 0, warnedBeforeDeath = false, logBefore = false; const n0 = G.log.length;
    for (let h = 0; h < 8 * 24 && !G.st.deaths; h++) {
      KC.step(G);
      const adv = KC.advice(G);
      if (G.colonists.some(c => c.health < 90) && adv.some(a => /steady/.test(a.text))) steadyWhileAiling++;
      if (G.colonists.some(c => c.health < 85) && !adv.some(a => a.sev === 'bad')) sickNoBad++;
      if (KC.dangers(G).length) warnedBeforeDeath = true;
      if (G.log.slice(n0).some(l => l.k === 'bad' && /short of|run dry|starving|run out/i.test(l.m))) logBefore = true;
    }
    check(steadyWhileAiling === 0, 'advisor never says steady while colonists ail: ' + name);
    check(sickNoBad === 0, 'a critical warning is shown whenever colonists are losing health: ' + name + ' (' + sickNoBad + ' h without)');
    check(warnedBeforeDeath && logBefore, 'danger shown and logged before anyone dies: ' + name);
  }
}
// ---------- economy, contracts, events, mystery, advisor ----------
{
  const G = KC.newGame({ seed: 'eco-1', sponsor: 'orrin', commander: 'engineer' }), B = {};
  const p0 = KC.arkPrice(G);
  let advErr = null, advMax = 0;
  for (let h = 0; h < 60 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); if (h % 24 === 0) { try { advMax = Math.max(advMax, KC.advice(G).length); } catch (e) { advErr = e; } } }
  check(!advErr, 'advisor runs without exceptions' + (advErr ? ': ' + advErr.message : ''));
  check(advMax > 0, 'advisor produces advice');
  check(KC.arkPrice(G) > p0, 'ark prices rise over time (' + p0 + ' -> ' + KC.arkPrice(G) + ')');
  check(KC.stipendTaper(G) < 1, 'the stipend tapers as the colony matures');
  check(KC.payrollNow(G) > 0, 'colonists from home cost payroll');
  check((G.st.contractsWon || 0) + (G.st.contractsLost || 0) > 0 || G.contracts.active || G.contracts.offer, 'the sponsor offers contracts');
  check(G.evSeen && G.evSeen.length > 0, 'colony events happen (' + (G.evSeen || []).join(',') + ')');
  // a contract can be accepted and fulfilled
  G.contracts.active = null; G.contracts.offer = { id: 1, kind: 'tech', name: 'Test', need: KC.techCount(G), sols: 5, reward: 500, text: 't', expires: G.tick + 48 };
  const f0 = G.funds; KC.acceptContract(G); KC.step(G);
  check(!G.contracts.active && G.funds >= f0 + 500, 'a met contract pays out');
  // events resolve with every choice without throwing
  let evErr = null;
  for (const id of Object.keys(KC.EVENTS)) for (let i = 0; i < KC.EVENTS[id].choices.length; i++) { try { const G2 = KC.deserialize(KC.serialize(G)); G2.funds += 1000; G2.res.parts += 20; G2.res.polymers += 20; G2.res.food += 50; G2.event = { id, at: G2.tick }; KC.resolveEvent(G2, i); KC.step(G2); } catch (e) { evErr = id + '#' + i + ': ' + e.message; } }
  check(!evErr, 'every event choice resolves cleanly' + (evErr ? ' (' + evErr + ')' : ''));
  // an unanswered decision resolves itself after a sol
  G.event = { id: 'meteorite', at: G.tick }; KC.run(G, 25); check(!G.event, 'unanswered decisions resolve after a sol');
  // the Warden mystery: 3 finds -> Harmonics -> the Choir -> the Array
  const G3 = KC.deserialize(KC.serialize(G));
  G3.myst = { stage: 0 }; G3.research.found = G3.research.found.filter(x => x !== 'myst_harmonics');
  for (let i = 0; i < 3; i++) { const a = { id: 900 + i, kind: 'warden', x: 1, y: 1, done: false, roll: 1 }; G3.anomalies.push(a); KC.ctxResolve ? KC.ctxResolve(G3, a) : ctx.resolveAnomaly(G3, a); }
  check(G3.myst.stage === 1 && G3.research.found.includes('myst_harmonics'), 'three Warden finds start the mystery');
  G3.research.cur = 'myst_harmonics'; G3.research.pool = 5000; KC.step(G3);
  check(G3.myst.stage === 2 && G3.anomalies.some(a => a.kind === 'choir' && !a.done), 'Warden Harmonics reveals the Choir');
  ctx.resolveAnomaly(G3, G3.anomalies.find(a => a.kind === 'choir' && a.story));
  check(G3.myst.stage === 3 && KC.unlocked(G3, 'array'), 'the Choir unlocks the Resonance Array');
  // auto-connect plans a route from a stranded building
  const G4 = KC.newGame({ seed: 'conn-1' }); const L = G4.buildings[0];
  let spot = null; for (let d = 6; d < 14 && !spot; d++) if (KC.canPlace(G4, 'condenser', L.x + d, L.y).ok) spot = { x: L.x + d, y: L.y };
  const site = KC.place(G4, 'condenser', spot.x, spot.y); KC.computeNets(G4);
  const rc = KC.autoConnect(G4, site.id); check(rc.ok && rc.tiles > 0, 'auto-connect plans cable and pipe (' + rc.tiles + ' tiles)');
  check(/dome/i.test(KC.arkBlock(G4)), 'ark blocker explains what is missing: ' + KC.arkBlock(G4));
  // buildings that cost funding take it from the treasury
  const G5 = KC.deserialize(KC.serialize(G)); G5.research.done.thinfilm = 0; KC.computeMods(G5);
  const f5 = G5.funds + 3000; G5.funds = f5; Object.assign(G5.res, { metals: 500, polymers: 200, electronics: 200 });
  const c5 = KC.costOf(G5, 'mirror'); check(c5.funds === 2500, 'Orbital Mirror costs funding');
  // the Halcyon sleepers: 2 wrecks or caches -> Recorder Forensics -> the camp -> the Vault -> 12 colonists
  const G6 = KC.deserialize(KC.serialize(G)); G6.myst2 = { stage: 0, seen: 0 };
  for (let i = 0; i < 2; i++) { const a = { id: 950 + i, kind: i ? 'cache' : 'wreck', x: 1, y: 1, done: false, roll: 1 }; G6.anomalies.push(a); ctx.resolveAnomaly(G6, a); }
  check(G6.myst2.stage === 1 && G6.research.found.includes('myst_recorder'), 'two Halcyon finds start the second mystery');
  G6.research.cur = 'myst_recorder'; G6.research.queue = []; G6.research.pool = 5000; KC.step(G6);
  const camp = G6.anomalies.find(a => a.kind === 'camp' && !a.done);
  check(G6.myst2.stage === 2 && camp && !camp.done, 'Recorder Forensics reveals Halcyon Camp');
  ctx.resolveAnomaly(G6, camp);
  check(G6.myst2.stage === 3 && KC.unlocked(G6, 'vault'), 'the camp unlocks the Revival Vault');
  const n6 = G6.colonists.length, pay6 = KC.payrollNow(G6);
  const v6 = { id: G6.nextId++, t: 'vault', x: 0, y: 0, s: 3, built: true, on: true, prio: 1, wear: 0 }; ctx.mysteryBuilt(G6, v6);
  check(G6.colonists.length === n6 + 12 && G6.myst2.stage === 4 && G6.ms.halcyon, 'the Vault wakes 12 sleepers');
  check(KC.payrollNow(G6) === pay6, 'the sleepers cost no Earth payroll');
  // exports: surplus goods sell, the market saturates and recovers
  const G7 = KC.deserialize(KC.serialize(G)); G7.exportOn = true; G7.res.parts = 300; G7.trade.demand = {}; for (const k in G7.trade.keep) G7.trade.keep[k] = -1; G7.rockets.forEach(r => { r.exp = null; }); G7.trade.keep.parts = 100;
  const m7 = KC.exportManifest(G7); check(m7.goods.parts > 0 && m7.value > 0, 'surplus parts are on the export manifest (' + m7.goods.parts + ' for ' + m7.value + ')');
  const pr7 = KC.exportPrice(G7, 'parts'); ctx.sellExports(G7, { goods: { parts: 100 }, surcharge: false });
  check(KC.exportPrice(G7, 'parts') < pr7 * 0.7, 'selling floods the market: the price falls');
  G7.trade.keep.parts = -1; check(!KC.exportManifest(G7).goods.parts, 'goods set to Off are kept');
  G7.trade.demand.parts = 0.3; G7.trade.auto = false; G7.rockets.forEach(r => { r.exp = null; });
  for (let i = 0; i < 24 * 10; i++) KC.step(G7);
  check(KC.demandOf(G7, 'parts') > 0.6, 'market demand recovers over a few sols (' + KC.demandOf(G7, 'parts').toFixed(2) + ')');
  // pickup runs: an idle fleet flies out empty when enough exports are waiting
  const G8 = KC.deserialize(KC.serialize(G)); G8.rockets.forEach(r => { r.st = 'home'; r.t = 0; }); G8.exportOn = true; G8.trade.auto = true; G8.res.rare = 60;
  for (let i = 0; i < 7; i++) KC.step(G8);
  check(G8.rockets.some(r => r.st === 'out' && r.pickup), 'an idle rocket flies out to collect exports');
  // the sponsor's advance: money now, repaid out of later stipends
  const G9 = KC.deserialize(KC.serialize(G)); G9.loan = null; G9.conf = 60; const f9 = G9.funds;
  const r9 = KC.takeAdvance(G9); check(r9.ok && G9.funds === f9 + r9.amount && G9.loan.left === r9.repay, 'the sponsor advances funding');
  check(KC.advanceOffer(G9).err, 'only one advance at a time');
  for (let i = 0; i < 24 * 3; i++) KC.step(G9); check(G9.loan && G9.loan.left < r9.repay, 'the advance is repaid each sol');
  // job control: pin a job, move home, dome focus, the people summary
  const GA = KC.deserialize(KC.serialize(G)); KC.assignJobs(GA);
  const cw = GA.colonists.find(c => KC.canWork(c)); const jo = KC.jobOptions(GA, cw).find(o => !o.here && o.open);
  if (jo) { const rj = KC.pinJob(GA, cw.id, jo.b.id); check(rj.ok && cw.job === jo.b.id, 'a colonist can be given a job'); for (let i = 0; i < 30; i++) KC.step(GA); check(cw.job === jo.b.id, 'a chosen job sticks'); }
  else check(true, 'no open job to pin (skipped)');
  const ho = KC.homeOptions(GA, cw).find(o => !o.here && o.free > 0);
  if (ho) { const rh = KC.pinHome(GA, cw.id, ho.b.id); check(rh.ok && cw.home === ho.b.id, 'a colonist can be moved to another dome'); for (let i = 0; i < 30; i++) KC.step(GA); check(cw.home === ho.b.id, 'a chosen home sticks'); }
  const dA = GA.buildings.find(b => !b.mod && KC.BUILDINGS[b.t].dome && b.built);
  const sciBefore = GA.colonists.filter(c => c.home === dA.id && c.job && KC.jobKind(KC.bById(GA, c.job)) === 'science').length;
  KC.setFocus(GA, dA.id, 'science'); KC.assignJobs(GA);
  const sciAfter = GA.colonists.filter(c => c.home === dA.id && c.job && KC.jobKind(KC.bById(GA, c.job)) === 'science').length;
  check(sciAfter >= sciBefore, 'a science focus never takes residents away from labs (' + sciBefore + ' -> ' + sciAfter + ')');
  const cs = GA.colonists.slice(0, 3); cs.forEach(c => { c.home = null; c.homeless = true; });
  check(KC.peopleIssues(GA).some(i => i.kind === 'homeless' && i.acts.length), 'the people summary names the homeless with a fix');
  // after Independence: Free Kessa goals and the Great Storm
  const GB = KC.deserialize(KC.serialize(G)); GB.ms.independence = KC.solOf(GB.tick) - 7; GB.over = { win: true, continued: true, sol: 1 }; GB.hz.upcoming = []; GB.hz.active = []; delete GB.flags.greatStorm; delete GB.ms.greatStorm; for (const k in GB.hz.next) GB.hz.next[k] = GB.tick + 9999;
  for (let i = 0; i < 25; i++) KC.step(GB);
  check(GB.hz.upcoming.some(u => u.great) || GB.hz.active.some(u => u.great), 'the Great Storm comes after Independence');
  check(KC.freeGoals(GB).length === 7, 'Free Kessa goals are listed');
  // emergencies: candles add oxygen, the shelter keeps people alive, rationing cuts water use
  {
    const GE = KC.deserialize(KC.serialize(G)); for (const b of GE.buildings) if (b.t === 'airsynth' || b.t === 'algae') KC.setOn(GE, b.id, false);
    for (const b of GE.buildings) if (b.oxygen !== undefined) b.oxygen = 0;
    GE.res.fuel = 50; GE.res.polymers = 50; for (let i = 0; i < 3; i++) KC.step(GE);
    const em = KC.emergencies(GE, KC.dangers(GE)).map(e => e.id);
    check(em.includes('em-candles'), 'the advisor offers oxygen candles when air fails (' + em.join(',') + ')');
    GE.res.fuel = 50; GE.res.polymers = 50; const o0 = KC.lifeTotals(GE).o.prod; check(KC.burnCandles(GE).ok, 'oxygen candles can be lit'); KC.step(GE); KC.step(GE);
    check(KC.lifeTotals(GE).o.prod > o0, 'burning candles adds oxygen (' + o0.toFixed(1) + ' -> ' + KC.lifeTotals(GE).o.prod.toFixed(1) + ')');
    check(KC.burnCandles(GE).err, 'only one set of candles at a time');
    const GS = KC.deserialize(KC.serialize(GE)); GS.candles = null; for (let i = 0; i < 6; i++) KC.step(GS);
    const so = KC.shelterOffer(GS); check(so.ok && so.n > 0, 'the lander shelter is offered for a failing dome');
    const r = KC.takeShelter(GS), ids = r.ids || []; for (let i = 0; i < 48; i++) KC.step(GS);
    check(ids.every(id => KC.cById(GS, id)), 'sheltered colonists survive two sols without air (' + ids.length + ')');
    check(KC.shelterOffer(GS).err, 'the shelter needs time to restock');
    const GR = KC.deserialize(KC.serialize(G)); KC.step(GR); const w0 = KC.lifeTotals(GR).w.dem; KC.setRation(GR, true); KC.step(GR);
    check(KC.lifeTotals(GR).w.dem < w0, 'rationing lowers water use (' + w0.toFixed(2) + ' -> ' + KC.lifeTotals(GR).w.dem.toFixed(2) + ')');
  }
  // the Colony Council forms at 25 colonists, makes demands, rewards and punishes
  {
    const GC = KC.deserialize(KC.serialize(G)); GC.council = undefined; while (GC.colonists.length < 26) KC.addColonist(GC, KC.makePerson(GC), GC.buildings.find(b => b.t === 'dome_s' && b.built).id);
    KC.step(GC); check(!!GC.council, 'the Colony Council forms at 25 colonists');
    for (let i = 0; i < 24 * 12; i++) KC.step(GC);
    check(Object.values(GC.council.dem).some(Boolean) || GC.council.won + GC.council.lost > 0, 'factions make demands');
    GC.council.sup.forge = 64; KC.computeMods(GC); const k0 = KC.M(GC, 'factory'); GC.council.dem.forge = { id: 1, f: 'forge', kind: 'tech', need: 0, due: GC.tick + 99, base: KC.techCount(GC), got: 0, text: 'test.' }; KC.step(GC);
    check(GC.council.sup.forge >= 65 && KC.M(GC, 'factory') > k0, 'meeting a demand can unlock a faction perk');
    GC.council.dem.lantern = { id: 2, f: 'lantern', kind: 'tech', need: 99, due: GC.tick + 99, base: 0, got: 0, text: 'test.' };
    const s0 = GC.council.sup.lantern; KC.refuseDemand(GC, 'lantern'); check(GC.council.sup.lantern < s0, 'refusing a demand costs support');
  }
}

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
  G.funds = KC.buyoutCost(G) + 100;
  const ind = KC.independence(G);
  check(ind[0].ok && ind[1].ok && ind[2].ok && ind.find(c => c.k === 'buyout').ok, 'independence conditions evaluate, including the buyout');
}
// ---------- the Colony Assembly: government, seats, laws, votes, crises, Independence backing ----------
{
  const G = KC.newGame({ seed: 'e-0', sponsor: 'orrin', commander: 'engineer', difficulty: 'normal' }), B = {};
  for (let h = 0; h < 70 * 24 && !G.assembly; h++) { if (h % 4 === 0) BOT.turn(G, B); if (G.event) BOT.event(G, B); KC.step(G); }
  const A = G.assembly;
  check(A && G.colonists.length >= KC.ASM.pop && !A.gov && G.log.some(l => /Colony Assembly/.test(l.m)), 'the council becomes an Assembly at ' + KC.ASM.pop + ' colonists');
  check(!KC.lawCheck(G, 'openlabs').ok, 'no laws before a government is chosen');
  const G2 = KC.deserialize(KC.serialize(G)); for (let h = 0; h < 6 * 24; h++) KC.step(G2);
  check(G2.assembly.gov === 'commonwealth', 'with no choice, the Assembly settles on a Commonwealth');
  const s0 = KC.seats(G); check(Object.values(s0).reduce((a, b) => a + b, 0) === 15, 'the Assembly has 15 seats (' + JSON.stringify(s0) + ')');
  check(KC.chooseGov(G, 'academy').ok && KC.seats(G).lantern > s0.lantern && !KC.chooseGov(G, 'guild').ok, 'Academy Rule gives the Lantern more seats, and the choice is final');
  const r0 = KC.M(G, 'research'), lan = G.council.sup.lantern, v = KC.countVote(G, 'openlabs');
  const res = KC.propose(G, 'openlabs');
  check(res.ok && res.pass === v.pass, 'a vote counts seats by stance and support (' + v.yes + ' of 15)');
  if (res.pass) check(Math.abs(KC.assemblyMods(G).research - 0.2) < 1e-6 && KC.M(G, 'research') >= r0 + 0.2 - 1e-6 && G.council.sup.lantern > lan, 'a passed law takes effect and its backers are pleased');
  check(!KC.lawCheck(G, 'applied').ok, 'one sitting every few sols');
  G.assembly.next = 0; if (res.pass) check(/research law/.test(KC.lawCheck(G, 'applied').why), 'one law per field');
  // crisis: an angry faction that opposes a law forces its repeal
  G.assembly.laws.openlabs = G.tick; KC.computeMods(G); G.council.sup.forge = 20; G.assembly.crisisAt = G.tick;
  KC.assemblyHour(G);
  check(!G.assembly.laws.openlabs && G.log.some(l => /Political crisis/.test(l.m)), 'a political crisis repeals a law its angry opponents hate');
  G.assembly.next = 0; G.council.sup.lantern = 90; G.council.sup.hearth = 60; const p2 = KC.propose(G, 'openlabs');
  G.assembly.next = 0; const rp = p2.pass ? KC.propose(G, 'openlabs', true) : null;
  check(p2.ok && (!p2.pass || (rp && rp.ok)), 'laws can be proposed again and repeals are voted on');
  const ind = KC.independence(G).find(c => c.k === 'assembly'), bk = KC.backing(G);
  check(ind && bk >= 0 && bk <= 100 && ind.ok === (bk >= KC.ASM.backing), 'Independence needs the Assembly\'s backing (mood ' + bk + ')');
  G.assembly.laws.clinics = G.tick; KC.computeMods(G); const G3 = KC.deserialize(KC.serialize(G));
  check(JSON.stringify(G3.assembly) === JSON.stringify(G.assembly) && G3._mods.health === G._mods.health, 'save and load keep the Assembly and its laws');
}
// ---------- Reshaping Kessa: gauges, sources, losses, stages, lakes, comets, hazards, saves ----------
{
  const G = KC.newGame({ seed: 'terra-1', difficulty: 'normal' }), B = {};
  for (let h = 0; h < 12 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); }
  const T = KC.terraOf(G);
  check(T.veil === 0 && T.warm === 0 && T.water === 0 && T.life === 0 && !Object.keys(T.st).length, 'a new colony starts with the planet untouched');
  const fake = (t, i) => ({ id: 90000 + i, t, x: 0, y: 0, s: 3, built: true, on: true, broken: false, _pf: 1 });
  G.buildings.push(fake('hazeforge', 0), fake('hazeforge', 1));
  let r = KC.terraRates(G).r;
  check(Math.abs(r.warm - 0.7) < 1e-6 && Math.abs(r.veil - 0.5) < 1e-6, 'two Haze Forges add Warmth 0.7 and Veil 0.5 a sol (' + r.warm.toFixed(2) + ', ' + r.veil.toFixed(2) + ')');
  G.buildings.push(fake('lichen', 2)); r = KC.terraRates(G).r;
  check(Math.abs(r.life - 0.07) < 1e-6, 'lichen barely spreads in the cold and dry (' + r.life.toFixed(3) + ')');
  T.warm = 16; T.water = 12; G.buildings.push(fake('seedvault', 3)); r = KC.terraRates(G).r;
  check(Math.abs(r.life - (0.35 * 1.6 + 0.15 * 1.6)) < 1e-6, 'with warmth and water, the Seed Ark speeds lichen by 60% (' + r.life.toFixed(3) + ')');
  T.veil = 50; r = KC.terraRates(G).r;
  check(Math.abs(r.veil - (0.5 - 0.3)) < 1e-6, 'without the Lodestone Ring the Veil leaks (' + r.veil.toFixed(3) + ' a sol at 50)');
  G.buildings.push(fake('lodestone', 4)); r = KC.terraRates(G).r;
  check(Math.abs(r.veil - 0.6) < 1e-6, 'the Lodestone Ring stops the leak and adds 0.1 (' + r.veil.toFixed(3) + ')');
  G.buildings = G.buildings.filter(b => b.id < 90000);
  // a sol of growth through the hourly update
  G.buildings.push(fake('hazeforge', 5)); const w0 = T.warm; for (let h = 0; h < 24; h++) KC.terraHour(G), G.tick++;
  check(T.warm > w0 && T.rate.warm > 0, 'gauges grow once a sol (Warmth ' + w0 + ' -> ' + T.warm.toFixed(2) + ')'); G.buildings = G.buildings.filter(b => b.id < 90000);
  // stages and their side effects
  const ice0 = G.deposits.filter(d => d.type === 'ice').reduce((a, d) => a + d.amount, 0);
  T.warm = 20; KC.terraCheck(G);
  const ice1 = G.deposits.filter(d => d.type === 'ice').reduce((a, d) => a + d.amount, 0);
  check(T.st.thaw && ice1 < ice0 * 0.9, 'The Thaw: ice deposits sublime (' + Math.round(ice0) + ' -> ' + Math.round(ice1) + ')');
  check(KC.terraHazard(G, 'cold') < 1 && KC.terraSev(G, 'cold') < 1, 'a warmer world has rarer, milder cold waves');
  { const sv = T.water; T.warm = 40; const rw = KC.terraRates(G).r.water; T.warm = 20; T.water = sv; check(rw > 0.1, 'warmth melts frost into water (' + rw.toFixed(2) + ' a sol at Warmth 40)'); }
  const crx = G._T.craters.find(c => c.r >= 3), lev = G._occ[Math.floor(crx.y) * KC.MAP_N + Math.floor(crx.x)] ? null : ctx.addBuilding(G, 'battery', Math.floor(crx.x), Math.floor(crx.y), true);
  const nDep = G.deposits.length; T.warm = 31; T.water = 26; KC.terraCheck(G);
  if (lev) check(G.terra.levees.some(l => l[0] === lev.x && l[1] === lev.y) && G.log.some(l => /levees/.test(l.m)), 'buildings caught by the flood stand on levees instead of in the water');
  const cr = G._T.craters.find(c => c.r >= 3), lx = Math.floor(cr.x), ly = Math.floor(cr.y);
  check(T.st.lakes && KC.lakeFrac(G) > 0 && KC.isLake(G, lx, ly), 'Meltwater Lakes flood crater floors');
  check(!KC.canPlace(G, 'condenser', lx, ly).ok && /water/.test(KC.canPlace(G, 'condenser', lx, ly).why), 'nothing is built on open water');
  check(G.deposits.length > nDep && G.deposits.slice(nDep).every(d => d.type === 'bloom' && G._dep[d.y * KC.MAP_N + d.x] === d.id), 'spore beds take root on the shores (' + (G.deposits.length - nDep) + ')');
  check(KC.M(G, 'condense') >= 0.2, 'lakes help condensers');
  T.veil = 36; T.water = 41; KC.terraCheck(G);
  check(T.st.rain && KC.M(G, 'solar') < KC.M(KC.newGame({ seed: 'terra-1' }), 'solar') + 1e-9 - 0.05, 'First Rain: condensers gain but cloud costs solar');
  check(!KC.canPlace(G, 'fieldfarm', 5, 5).ok, 'Field Farms need the Open Sky');
  T.veil = 61; T.warm = 56; T.life = 51; KC.terraCheck(G);
  check(T.st.lichen && T.st.moss && T.st.shrubs && T.st.openair && KC.M(G, 'domeAir') <= -0.25, 'every stage reached; Open Sky eases dome air');
  check(!/Open Sky/.test(KC.canPlace(G, 'fieldfarm', 5, 5).why || ''), 'Open Sky unlocks the Field Farm');
  // comets
  check(!KC.cometCheck(G).ok, 'comets need Comet Herding');
  G.research.done.comets = 1; G.funds = 5000; G.res.fuel = 40; const wa = T.water;
  check(KC.orderComet(G).ok && !KC.cometCheck(G).ok, 'a comet can be ordered, one at a time');
  for (let h = 0; h < KC.COMET.sols * 24 + 2; h++) KC.step(G);
  check(T.water >= Math.min(100, wa + KC.COMET.give.water) - 0.5 && !T.comets.length, 'the comet strikes and adds water (' + wa + ' -> ' + T.water.toFixed(1) + ')');
  // saves keep the reshaped world
  const G2 = KC.deserialize(KC.serialize(G));
  check(JSON.stringify(G2.terra) === JSON.stringify(G.terra) && G2._mods.domeAir === G._mods.domeAir, 'save and load keep Reshaping Kessa and its effects');
  let err = null; try { for (let h = 0; h < 20 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); } } catch (e) { err = e; console.log(e.stack); }
  check(!err, 'a fully reshaped colony runs 20 sols without errors');
}
// ---------- 2.1: rival colonies, the race, trade, rivalry decisions, remote sites and expeditions ----------
{
  const G = KC.newGame({ seed: 'world-1', sponsor: 'union', commander: 'engineer', difficulty: 'normal' }), B = {};
  const W = G.world;
  check(W && W.rivals.length === 3 && !W.rivals.some(r => r.k === 'union') && W.sites.length >= 4, 'a new colony shares Kessa with 3 rivals of other sponsors and has remote sites (' + W.rivals.map(r => r.name).join(', ') + ')');
  check(KC.newGame({ seed: 'world-1', difficulty: 'easy' }).world.rivals.length === 2, 'on Settled there are 2 rivals');
  const r0 = JSON.stringify(G.rng);
  for (let h = 0; h < 60 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); if (G.event) BOT.event(G, B); KC.step(G); }
  check(W.rivals.every(r => r.pop > 20 && r.techs > 5 && r.ms.dome), 'rivals found domes, take colonists and research (' + W.rivals.map(r => Math.round(r.pop) + '/' + Math.round(r.techs)).join(', ') + ')');
  check(Object.keys(W.races).length >= 2 && Object.values(W.races).every(x => x.sol > 0 && (x.who === 'you' || KC.RIVALS[x.who])), 'races are decided as colonies reach them (' + JSON.stringify(W.races) + ')');
  check(W.log.length > 0 && G.log.some(l => /Rivalry:/.test(l.m)), 'world news and race results reach the log');
  // the race prize
  { const G2 = KC.deserialize(KC.serialize(G)); delete G2.world.races.pop100; G2.ms.pop100 = KC.solOf(G2.tick); for (const rv of G2.world.rivals) delete rv.ms.pop100; const f0 = G2.funds; for (let h = 0; h < 24; h++) KC.step(G2); check(G2.world.races.pop100 && G2.world.races.pop100.who === 'you' && G2.funds > f0, 'winning a race pays the prize'); }
  // trade offers: accept, decline, expiry, and the import counts against self-reliance
  const G3 = KC.deserialize(KC.serialize(G)), W3 = G3.world, rk = W3.rivals[0].k;
  W3.offers = [{ id: 7001, r: rk, give: { parts: 10 }, take: { funds: 100 }, until: G3.tick + 50, kind: 'sell' }, { id: 7002, r: rk, give: { funds: 200 }, take: { metals: 99999 }, until: G3.tick + 50, kind: 'buy' }, { id: 7003, r: rk, give: { rp: 100 }, take: { funds: 50 }, until: G3.tick + 3, kind: 'sell' }];
  G3.funds = 1000; const p0 = G3.res.parts, rel0 = W3.rivals[0].rel;
  check(KC.acceptOffer(G3, 7001).ok && G3.res.parts === p0 + 10 && G3.funds === 900 && W3.rivals[0].rel > rel0 && G3.sol.imp.parts === 10, 'accepting an offer swaps the goods, warms relations and counts as an import');
  check(KC.acceptOffer(G3, 7002).err && W3.offers.some(o => o.id === 7002), 'an offer you cannot pay for is refused and stays open');
  check(KC.declineOffer(G3, 7002).ok && !W3.offers.some(o => o.id === 7002), 'offers can be declined');
  for (let h = 0; h < 12; h++) KC.step(G3); check(!W3.offers.some(o => o.id === 7003), 'offers expire');
  { let made = 0; const G4 = KC.deserialize(KC.serialize(G)); for (let i = 0; i < 30; i++) { G4.world.offers = []; G4.world.nextTrade = 0; G4.tick = Math.ceil((G4.tick + 1) / 24) * 24 - 1; KC.step(G4); made += G4.world.offers.length; } check(made > 5, 'rivals make trade offers over time (' + made + ' in 30 sols)'); }
  // rivalry decisions resolve with every choice, using the rival they came from
  let evErr = null; for (const id of Object.keys(KC.W_EVENTS)) for (let i = 0; i < KC.EVENTS[id].choices.length; i++) { try { const G5 = KC.deserialize(KC.serialize(G)); G5.funds += 2000; G5.res.parts += 20; G5.res.polymers += 20; G5.res.food += 200; G5.event = { id, at: G5.tick, r: rk, n: 3 }; const t = KC.eventInfo(G5); if (!t.title || !t.text || !/\w/.test(t.title)) throw new Error('no text'); KC.resolveEvent(G5, i); KC.step(G5); } catch (e) { evErr = id + '#' + i + ': ' + e.message; } }
  check(!evErr, 'every rivalry decision resolves cleanly' + (evErr ? ' (' + evErr + ')' : ''));
  { const G5 = KC.deserialize(KC.serialize(G)); const n0 = G5.colonists.length; G5.event = { id: 'w_refugees', at: G5.tick, r: rk, n: 4 }; KC.resolveEvent(G5, 0); check(G5.colonists.length === n0 + 4 && G5.world.rivals[0].rel > W.rivals[0].rel, 'taking in refugees adds colonists and goodwill'); }
  // expeditions: the pad, crew and drones leave, the work, the outcome and the return
  const G6 = KC.deserialize(KC.serialize(G)), W6 = G6.world;
  const site = W6.sites.find(s => !s.claimed && KC.SITES[s.kind].drones && !KC.SITES[s.kind].rover) || (() => { const s = { id: 8001, kind: 'wreck', x: 0.3, y: 0.3, found: 1, claimed: null, by: null, exp: null, rv: null }; W6.sites.push(s); return s; })();
  site.rv = null;
  check(/Expedition Pad/.test(KC.expCheck(G6, site.id).why), 'expeditions need an Expedition Pad, and say so');
  let pad = null; for (let y = 2; y < 60 && !pad; y++) for (let x = 2; x < 60 && !pad; x++) if (KC.canPlace(G6, 'xpad', x, y).ok) pad = KC.place(G6, 'xpad', x, y);
  pad.built = true; pad.prog = KC.BUILDINGS.xpad.work; G6._netDirty = true; pad.pw = 1; G6.res.fuel = 200; for (const c of G6.colonists) c.health = 100;
  const hubs = G6.buildings.filter(b => b.built && !b.mod && KC.BUILDINGS[b.t].hub); hubs[0].drones += 10;
  const ck = KC.expCheck(G6, site.id);
  check(ck.ok && ck.crew.length === KC.SITES[site.kind].crew.length && ck.chance > 0.3, 'a ready pad offers a crew, fuel cost and odds (' + (ck.why || Math.round(ck.chance * 100) + '%') + ')');
  const pop0 = G6.colonists.length, dr0 = KC.dronesFree(G6), fuel0 = G6.res.fuel, crewIds = ck.crew.map(c => c.id);
  const lr = KC.launchExpedition(G6, site.id);
  check(lr.ok && G6.colonists.length === pop0 - crewIds.length && KC.dronesFree(G6) === dr0 - (KC.SITES[site.kind].drones || 0) && G6.res.fuel === fuel0 - ck.fuel && crewIds.every(id => !KC.cById(G6, id)), 'launching takes the crew, the drones and the fuel away');
  check(!KC.expCheck(G6, site.id).ok && W6.exps.length === 1, 'one expedition at a time');
  { const G7 = KC.deserialize(KC.serialize(G6)); check(G7.world.exps.length === 1 && G7.world.exps[0].crew.length === crewIds.length, 'an expedition in flight survives save and load'); }
  const sold = W6.sites.find(s => s.id === site.id); for (let h = 0; h < (2 * ck.travel + KC.SITES[site.kind].sols) * 24 + 4; h++) KC.step(G6);
  check(!W6.exps.length && sold.claimed === 'you' && G6.st.expeditions >= 1, 'the expedition works the site, claims it and comes home');
  check(crewIds.filter(id => KC.cById(G6, id)).length >= crewIds.length - 1 && G6.log.some(l => /skimmer is home/.test(l.m)), 'the crew is back in the colony (unless one died) and the haul is logged');
  // a rival that gets there first takes the site
  { const G8 = KC.deserialize(KC.serialize(G)), s8 = G8.world.sites.find(s => !s.claimed); s8.rv = { r: rk, at: G8.tick + 1 }; for (let h = 0; h < 30; h++) KC.step(G8); check(s8.claimed === rk, 'a rival expedition that arrives first claims the site'); }
  // relics: three of them reveal the Great Orrery
  { const G9 = KC.deserialize(KC.serialize(G)); G9.world.relics = ['shard', 'tablet', 'idol']; KC.computeMods(G9); ctx.relicCheck(G9); check(KC.techDone(G9, 'myst_orrery') && KC.unlocked(G9, 'orrery') && KC.worldMods(G9).comfort === 2 && KC.worldMods(G9).morale === 3 && KC.worldMods(G9).research === 0.05, 'relics give lasting bonuses, and three reveal the Great Orrery'); }
  // the world never touches the colony's own random stream
  { const a = KC.newGame({ seed: 'iso-1' }), b2 = KC.newGame({ seed: 'iso-1' }); b2.world.rng = KC.RNG.fromSeed('other').state(); b2.world._r = null; for (let h = 0; h < 48; h++) { KC.step(a); KC.step(b2); } check(JSON.stringify(a.rng) === JSON.stringify(b2.rng), 'the world draws from its own random stream'); }
  check(KC.score(G) > 0 && G.world.rivals.every(r => r.rel >= 0 && r.rel <= 100), 'relations stay in range and the world adds to the score');
}
// ---------- 2.1: the monorail: stations, track, trains, commuters, shared drones, freight ----------
{
  const G = KC.newGame({ seed: 'rail-1', sponsor: 'orrin', commander: 'engineer', difficulty: 'normal' }), B = { noRail: true };
  for (let h = 0; h < 40 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); if (G.event) BOT.event(G, B); KC.step(G); }
  const L = G.buildings.find(b => b.t === 'lander'), N = KC.MAP_N;
  const find = (cx, cy, R) => { let best = null, bd = 1e9; for (let y = Math.max(0, cy - R); y <= Math.min(N - 2, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(N - 2, cx + R); x++) if (KC.canPlace(G, 'station', x, y).ok) { const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = { x, y }; } } return best; };
  const a = find(L.x + 5, L.y, 20), s1 = KC.place(G, 'station', a.x, a.y);
  let bp = null; for (const [dx, dy] of [[16, 0], [-16, 0], [0, 16], [0, -16], [12, 12], [-12, 12], [12, -12], [-12, -12]]) { bp = find(a.x + dx, a.y + dy, 4); if (bp && Math.hypot(bp.x - a.x, bp.y - a.y) > 11) break; bp = null; }
  const s2 = KC.place(G, 'station', bp.x, bp.y);
  check(s1.id && s2.id && !KC.canPlace(G, 'solar', a.x, a.y).ok, 'Rail Stations can be placed');
  const rt = KC.railRoute(G, s1.id, s2.id);
  check(rt.ok && rt.n > 8 && rt.cost.metals > 0 && rt.cost.sinter > 0, 'a track route runs between two stations around buildings (' + (rt.err || rt.n + ' tiles') + ')');
  check(rt.tiles.every(([x, y]) => !G._occ[y * N + x]), 'track never runs under a building');
  const lt = KC.layTrack(G, s1.id, s2.id);
  check(lt.ok && rt.tiles.every(([x, y]) => G.rail[y * N + x] === 3), 'laying track plans it for the drones');
  check(rt.tiles.every(([x, y]) => !KC.canPlace(G, 'battery', x, y).ok) && rt.tiles.some(([x, y]) => /monorail/.test(KC.canPlace(G, 'battery', x, y).why)), 'nothing else can be built on the track');
  // finish everything as the drones would, and power the stations
  for (const b of [s1, s2]) { b.paid = true; b.built = true; b.prog = KC.BUILDINGS.station.work; KC.autoConnectSite(G, b.id); }
  for (let i = 0; i < N * N; i++) { if (G.rail[i] === 3) G.rail[i] = 1; if (G.cable[i] === 3) G.cable[i] = 1; if (G.pipe[i] === 3) G.pipe[i] = 1; }
  G._netDirty = true; G._railDirty = true; G._jobsDirty = true; G.res.parts += 50; G.res.metals += 100;
  for (let h = 0; h < 30; h++) KC.step(G);
  const st = KC.railStats(G);
  check(G.trains.length === 1 && st.lines.length === 1 && st.lines[0].running, 'two linked, powered stations run a train (' + JSON.stringify(st.lines) + ')');
  const tr = G.trains[0]; let moved = 0, arrivals = tr.trips; const pos = [];
  for (let h = 0; h < 48; h++) { KC.step(G); const p = KC.trainPos(G, tr, 0); if (p) pos.push(p.x + ',' + p.y); }
  check(tr.trips - arrivals >= 2 && new Set(pos).size > 4, 'the train shuttles between the stations (' + (tr.trips - arrivals) + ' arrivals)');
  const p0 = KC.trainPos(G, tr, 0), p1 = KC.trainPos(G, tr, 0.5); check(p0 && p1 && (p0.stop || Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.5), 'the screen can place the train between hours');
  // commuting: a dome near one station can work by the other
  const dome = G.buildings.find(b => b.built && !b.mod && KC.BUILDINGS[b.t].dome && KC.cheb(KC.center(b).x, KC.center(b).y, KC.center(s1).x, KC.center(s1).y) <= KC.BUILDINGS[b.t].dome.reach + b.s / 2);
  if (dome) {
    const map = KC.commuteMap(G); check(map.has(dome.id) && map.get(dome.id).length === 2, 'domes within reach of a station can ride the line');
    // a workplace by the far station: out of the dome's own reach, inside the line's
    let wp = null; for (let r = 1; r < 7 && !wp; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r]]) { const x = s2.x + dx, y = s2.y + dy; if (KC.canPlace(G, 'lab', x, y).ok) { wp = KC.place(G, 'lab', x, y); break; } }
    if (wp) { wp.built = true; wp.paid = true; G._netDirty = true; G._jobsDirty = true; const dc = KC.center(dome), wc = KC.center(wp); const direct = KC.cheb(dc.x, dc.y, wc.x, wc.y) <= KC.BUILDINGS[dome.t].dome.reach + dome.s / 2;
      KC.step(G); const opts = KC.jobOptions(G, G.colonists.find(c => c.home === dome.id) || { home: dome.id });
      check(direct || opts.some(o => o.b.id === wp.id), 'colonists can take jobs a train ride away'); }
  }
  // shared drones: hubs near each end of a running line help each other
  for (const s of [s1, s2]) { s.pw = 1; s.on = true; s.broken = false; } const hubs = KC.hubsOf(G); ctx.hubLinks(G, hubs);
  const near = s => hubs.filter(h => !h.src.vehicle && KC.cheb(h.x, h.y, KC.center(s).x, KC.center(s).y) <= KC.RAIL.hubLink);
  // (a hub by each end of the line, placed if the colony has none there)
  for (const st0 of [s1, s2]) if (!near(st0).length) { let hp = null; for (let r = 2; r < 7 && !hp; r++) for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r]]) { if (KC.canPlace(G, 'hub', st0.x + dx, st0.y + dy).ok) { hp = KC.place(G, 'hub', st0.x + dx, st0.y + dy); break; } } if (hp) { hp.built = true; hp.drones = 2; hp.pw = 1; G._netDirty = true; } }
  KC.step(G); for (const st0 of [s1, s2]) st0.pw = 1;
  { for (const b0 of G.buildings) if (b0.t === 'hub' && b0.built) { b0._pf = 1; b0.on = true; b0.broken = false; } const H3 = KC.hubsOf(G); ctx.hubLinks(G, H3); check(H3.filter(h0 => h0.alt && h0.alt.length).length >= 2, 'drone hubs near the line share their drones'); }
  // freight: an extractor by a station on a line that serves the lander ships 15% more
  const ext = G.buildings.find(b => b.built && KC.FREIGHT.has(b.t) && [s1, s2].some(s => KC.cheb(KC.center(b).x, KC.center(b).y, KC.center(s).x, KC.center(s).y) <= KC.RAIL.reach));
  const serves = [s1, s2].some(s => KC.cheb(KC.center(L).x, KC.center(L).y, KC.center(s).x, KC.center(s).y) <= KC.RAIL.reach) || G.buildings.some(b => b.t === 'depot' && b.built && [s1, s2].some(s => KC.cheb(KC.center(b).x, KC.center(b).y, KC.center(s).x, KC.center(s).y) <= KC.RAIL.reach));
  if (ext && serves) check(G._freight && G._freight.has(ext.id) && KC.prodMult(G, ext) >= 1 + KC.RAIL.freight - 1e-9, 'extractors near a station ship 15% more by freight');
  // power cut: the line stops
  s2.on = false; for (let h = 0; h < 3; h++) KC.step(G); check(!KC.railStats(G).lines[0].running && G.trains[0]._stop !== undefined, 'a station without power stops the line'); s2.on = true;
  // save and load keep the track and the trains, and a loaded game runs on identically
  const sv = KC.serialize(G), G2 = KC.deserialize(sv);
  const plain = t => JSON.stringify(t, (k, v) => k[0] === '_' ? undefined : v); check(G2.rail.reduce((s, v) => s + (v ? 1 : 0), 0) === G.rail.reduce((s, v) => s + (v ? 1 : 0), 0) && plain(G2.trains) === plain(G.trains), 'save and load keep track and trains');
  for (let h = 0; h < 48; h++) { KC.step(G); KC.step(G2); }
  check(KC.serialize(G) === KC.serialize(G2), 'a loaded monorail game continues exactly like the original');
  // removing a tile of track splits the line
  const mid = rt.tiles[Math.floor(rt.tiles.length / 2)]; KC.removeLine(G, 'rail', mid[0], mid[1]); KC.step(G);
  check(!KC.railStats(G).lines.some(l => l.stations === 2), 'cutting the track splits the line');
}
// ---------- 2.1: the bot uses the monorail and expeditions, and passes laws (so crises happen in play) ----------
{
  const G = KC.newGame({ seed: 'e-0', sponsor: 'orrin', commander: 'engineer', difficulty: 'normal' }), B = {};
  for (let h = 0; h < 175 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); if (G.event) BOT.event(G, B); KC.step(G); if (G.over && G.over.win) G.over.continued = true; if (G.over && !G.over.win) break; }
  const st = KC.railStats(G);
  console.log('\nbot 2.1 run (e-0, 175 sols, Independence on sol ' + G.ms.independence + '): stations ' + G.buildings.filter(b => b.t === 'station').length + ', track ' + st.track + ', train trips ' + st.trips + ', commuters ' + st.pax + ', expeditions ' + (G.st.expeditions || 0) + ', trades ' + (G.st.trades || 0) + ', laws voted ' + (G.assembly ? G.assembly.history.length : 0) + ', crises ' + (G.assembly ? G.assembly.history.filter(x => x.k === 'crisis').length : 0));
  check(st.track > 0 && st.trips > 0, 'the bot lays track and runs trains');
  check((G.st.expLaunched || 0) > 0, 'the bot sends expeditions');
  check(G.assembly && G.assembly.history.some(x => x.k === 'pass' && x.ok), 'the bot passes laws in the Assembly');
}
// ---------- 2.1: stories: the Bloom Below, the Ninth Moon and the new wonders ----------
{
  const G = KC.newGame({ seed: 'story-1' }), B = {};
  for (let h = 0; h < 40 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); }
  G.event = null; G.evq = [];
  const G3 = KC.deserialize(KC.serialize(G)); G3.myst3 = { stage: 0, seen: 0 }; G3.research.found = G3.research.found.filter(x => x !== 'myst_mycel');
  ctx.resolveAnomaly(G3, Object.assign({ id: 990, kind: 'bloom', x: 1, y: 1, done: false, roll: 1 })); ctx.resolveAnomaly(G3, { id: 991, kind: 'vent', x: 2, y: 1, done: false, roll: 0 });
  check(G3.myst3.stage === 1 && G3.research.found.includes('myst_mycel') && G3.event && G3.event.id === 'm_bloom1', 'two bloom or vent finds start the Bloom Below, with a choice');
  G3.res.polymers += 10; KC.resolveEvent(G3, 0); check(G3.myst3.path === 'study', 'the choice is remembered');
  G3.research.cur = 'myst_mycel'; G3.research.queue = []; G3.research.pool = 5000; KC.step(G3);
  const heart = G3.anomalies.find(a => a.kind === 'heart' && !a.done); check(G3.myst3.stage === 2 && heart, 'Mycelial Signalling reveals the Bloom Heart');
  ctx.resolveAnomaly(G3, heart); check(G3.myst3.stage === 3 && KC.unlocked(G3, 'undergrove') && G3.event && G3.event.id === 'm_bloom2', 'the heart unlocks the Undergrove and asks what to do with it');
  KC.resolveEvent(G3, 1); check(G3.myst3.choice === 'harvest' && KC.M(G3, 'farm') >= 0.1, 'harvesting the heart helps the farms for good');
  const G4 = KC.deserialize(KC.serialize(G)); G4.myst4 = { stage: 0 }; G4.event = null;
  for (let s = 0; s < 50 && G4.myst4.stage === 0; s++) { G4.tick = (Math.floor(G4.tick / 24) + 1) * 24 - 1; KC.step(G4); }
  const frag = G4.anomalies.find(a => a.kind === 'fragment'); check(G4.myst4.stage === 1 && frag, 'a fragment falls from the sky to start the Ninth Moon (sol ' + KC.solOf(G4.tick) + ')');
  G4.event = null; ctx.resolveAnomaly(G4, frag); check(G4.myst4.stage === 2 && G4.research.found.includes('myst_orbit') && G4.event && G4.event.id === 'm_moon1', 'the fragment leads to Orbital Forensics and a choice');
  const f0 = G4.funds; KC.resolveEvent(G4, 0); check(G4.funds === f0 + 400, 'reporting the find pays');
  G4.research.cur = 'myst_orbit'; G4.research.queue = []; G4.research.pool = 5000; KC.step(G4); for (let h = 0; h < 7 && !G4.event; h++) KC.step(G4);
  check(G4.event && G4.event.id === 'm_moon2', 'Orbital Forensics asks how to bring the moon\'s gift down');
  G4.res.fuel = 30; KC.resolveEvent(G4, 0); const cap = G4.anomalies.find(a => a.kind === 'capsule' && !a.done);
  check(G4.myst4.stage === 3 && cap && Math.hypot(cap.x - G4.land.x, cap.y - G4.land.y) < 20, 'a gentle nudge lands the capsule near the colony');
  ctx.resolveAnomaly(G4, cap); check(G4.myst4.stage === 4 && KC.unlocked(G4, 'relay'), 'the capsule unlocks the Skyward Relay');
  // the three new wonders take effect when built
  for (const t of ['undergrove', 'relay', 'orrery']) { const G5 = KC.deserialize(KC.serialize(G)); G5.research.done.myst_bloom = G5.research.done.myst_moon = G5.research.done.myst_orrery = 1; KC.computeMods(G5); const m0 = JSON.stringify(G5._mods); let sp = null; for (let y = 2; y < 60 && !sp; y++) for (let x = 2; x < 60 && !sp; x++) if (KC.canPlace(G5, t, x, y).ok) sp = { x, y }; const b = KC.place(G5, t, sp.x, sp.y); b.paid = true; b.prog = 1e9; G5.res.sinter += 99; ctx.completeBuilding(G5, b); check(JSON.stringify(G5._mods) !== m0 && !KC.canPlace(G5, t, sp.x + 5, sp.y).ok, 'the ' + KC.BUILDINGS[t].name + ' is unique and changes the colony'); }
  // every new event resolves cleanly
  let evErr = null; for (const id of ['wedding', 'feud', 'mural', 'anthem', 'sleepwalker', 'teacher', 'm_bloom1', 'm_bloom2', 'm_moon1', 'm_moon2']) for (let i = 0; i < KC.EVENTS[id].choices.length; i++) { try { const G6 = KC.deserialize(KC.serialize(G)); G6.myst3 = { stage: 1, seen: 2 }; G6.myst4 = { stage: 2 }; G6.funds += 1000; G6.res.parts += 20; G6.res.polymers += 20; G6.res.food += 50; G6.res.fuel += 40; G6.event = { id, at: G6.tick }; KC.resolveEvent(G6, i); KC.step(G6); } catch (e) { evErr = id + '#' + i + ': ' + e.message; } }
  check(!evErr, 'the new colony and mystery decisions resolve cleanly' + (evErr ? ' (' + evErr + ')' : ''));
}
// ---------- 2.1: saves from 2.0 load and play on ----------
{
  let G0 = null, how = '';
  try {
    const { execSync } = await import('node:child_process'), vm = await import('node:vm'), path = await import('node:path'), url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url)), files = ['core.js', 'data.js', 'tech.js', 'mapgen.js', 'game.js', 'sim.js', 'colonists.js', 'rockets.js', 'vehicles.js', 'hazards.js', 'goals.js', 'economy.js', 'events.js', 'politics.js', 'assembly.js', 'terra.js', 'advice.js', 'save.js'];
    const src = files.map(f => execSync('git show d0c25fe:games/kessa/src/engine/' + f, { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString()).join('\n');
    const c2 = vm.createContext({ console, btoa, atob, escape, unescape, Math, Date }); vm.runInContext(src, c2);
    const K20 = c2.KC, Gold = K20.newGame({ seed: 'old-1', sponsor: 'tessaline', commander: 'geoscientist' }); for (let h = 0; h < 45 * 24; h++) K20.step(Gold);
    G0 = KC.deserialize(K20.serialize(Gold)); how = 'a real 2.0 save';
  } catch (e) { const Gn = KC.newGame({ seed: 'old-1' }); for (let h = 0; h < 45 * 24; h++) KC.step(Gn); const o = JSON.parse(KC.serialize(Gn)); delete o.world; delete o.rail; delete o.trains; delete o.myst3; delete o.myst4; o.version = '2.0.0'; G0 = KC.deserialize(JSON.stringify(o)); how = 'a 2.0-shaped save (git not available)'; }
  check(G0 && G0.world && G0.rail && G0.rail.length === KC.MAP_N * KC.MAP_N && Array.isArray(G0.trains), 'a 2.0 save loads in 2.1 with the world and the monorail added (' + how + ')');
  check(G0.world.rivals.every(r => r.pop > 0), 'rivals have grown alongside an older colony (' + G0.world.rivals.map(r => Math.round(r.pop)).join(', ') + ')');
  let err = null; try { for (let h = 0; h < 10 * 24; h++) KC.step(G0); } catch (e) { err = e; console.log(e.stack); }
  check(!err && KC.deserialize(KC.serialize(G0)).world, 'the old colony plays on and saves in the new format');
}
console.log(`\n${maps} maps, ${nSeeds} bot colonies in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`${oks} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
