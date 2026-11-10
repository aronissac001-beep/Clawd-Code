// Headless checks for the Exodus engine. Run: node games/exodus/tools/test-engine.mjs
import { loadEngine } from './load-engine.mjs';
const { HX, ev } = loadEngine();
const TERRAIN = ev('TERRAIN'), MAPSIZE = ev('MAPSIZE'), UNITS = ev('UNITS'), TECHS = ev('TECHS'), TECHI = ev('TECHI'), CIVS = ev('CIVS'), BUILDINGS = ev('BUILDINGS'), LINES = ev('LINES');
let fails = 0, passes = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } else passes++; };
const majors = G => G.players.filter(P => !P.barbarian && !P.minor);
const round = G => { const s = HX.serializeGame(G); return HX.serializeGame(HX.deserializeGame(s)) === s; };
const t0 = Date.now();

// ---- data sanity ----
check(TECHS.length >= 61, `tech web has 60+ techs (${TECHS.length - 1} plus Landfall)`);
check(TECHS.every(t => t.pre.concat(t.any).every(k => TECHI[k] !== undefined)), 'every tech link points at a real tech');
check(TECHS.filter(t => t.any.length).length >= 16, 'web branches open from either neighbor');
check(Object.keys(LINES).every(l => ['communion', 'lattice', 'lineage'].every(a => UNITS[LINES[l].t2[a]] && UNITS[LINES[l].t3[a]])), 'every unit line splits three ways');
check(HX.VIRTUE_TREES.length === 4 && HX.VIRTUE_TREES.every(t => t.virtues.length === 8 && t.depth.length === 3), 'four virtue trees with depth synergies');
check(CIVS.filter(c => !c.barb && !c.minor).length === 8, 'eight factions');
check(HX.PROJECTS.length === 4 && ev('VICTORIES').length === 6, 'six victories, four projects');
check(BUILDINGS.every(B => !B.tech || TECHI[B.tech] !== undefined), 'every building names a real tech');
check(Object.values(UNITS).every(U => !U.tech || TECHI[U.tech] !== undefined), 'every unit names a real tech');

// ---- maps ----
const sizes = ['small', 'medium', 'large'], scripts = ['continents', 'pangaea', 'archipelago', 'islands'];
let maps = 0;
for (const size of sizes) for (const script of scripts) for (let s = 0; s < 3; s++) {
  const rivals = MAPSIZE[size].maxCivs - 1;
  const G = HX.makeGame({ size, script, rivals, seed: `t-${size}-${script}-${s}`, difficulty: 3 }, { allAI: true });
  maps++;
  const m = G.map, N = m.W * m.H;
  let veil = 0, land = 0; for (let i = 0; i < N; i++) if (TERRAIN[m.terrain[i]].land) { land++; if (m.veil[i]) veil++; }
  check(majors(G).length === rivals + 1 && G.players.some(P => P.barbarian), 'player count');
  for (const P of majors(G)) {
    const st = G.units.find(u => u.owner === P.id && u.type === 'settler');
    check(st && TERRAIN[m.terrain[st.tile]].land && !m.veil[st.tile], `colony pod on land outside the Veil ${size}/${script}/${s}`);
    check(P.landing && P.landing.length >= 1, 'landing sites offered');
    check(P.loadout && P.loadout.col && P.loadout.cargo && P.loadout.ship, 'loadout chosen');
  }
  check(veil > land * 0.03 && veil < land * 0.3, `the Veil covers part of the land (${(veil / land * 100).toFixed(0)}%)`);
  check(G.sites.filter(x => x.kind === 'vault').length >= 3, 'Echo Vaults placed');
  check(G.sites.some(x => x.kind === 'wreck') && G.sites.some(x => x.kind === 'ruin'), 'crash sites and ruins placed');
  check(G.camps.length >= 2, `fauna nests at start (${G.camps.length})`);
}
console.log(`generated ${maps} maps in ${Date.now() - t0}ms`);
const a = HX.makeGame({ size: 'medium', script: 'continents', seed: 'det-check', rivals: 3 });
const b = HX.makeGame({ size: 'medium', script: 'continents', seed: 'det-check', rivals: 3 });
check(HX.serializeGame(a) === HX.serializeGame(b), 'same seed gives identical game');
check(round(a), 'fresh game save round trip');

// ---- all-AI play: capitals, exploration, stacking ----
for (const size of ['small', 'medium']) for (const script of scripts) {
  const G = HX.makeGame({ size, script, rivals: MAPSIZE[size].maxCivs - 1, seed: 'ai-' + size + script, difficulty: 3 }, { allAI: true });
  const capTurn = {};
  while (G.turn <= 50) {
    const pid = G.active;
    HX.aiTakeTurn(G, pid);
    if (!capTurn[pid] && G.cities.some(c => c.owner === pid)) capTurn[pid] = G.turn;
    HX.endPlayerTurn(G);
    const seen = new Set();
    for (const u of G.units) {
      const key = (UNITS[u.type].civilian ? 'c' : 'm') + u.tile;
      if (seen.has(key)) { check(false, `stacked ${key} on turn ${G.turn} ${size}/${script}`); break; }
      seen.add(key);
    }
  }
  for (const P of majors(G)) check(capTurn[P.id] && capTurn[P.id] <= 4, `capital by turn 4 for p${P.id} on ${size}/${script}`);
  check(majors(G).every(P => P.landed), 'AI factions choose a landing site');
  check(round(G), 'AI game save round trip ' + size + script);
}

// ---- a long all-AI game: economy invariants and the new systems ----
{
  const G = HX.makeGame({ size: 'medium', script: 'pangaea', rivals: 4, seed: 'long-1' }, { allAI: true });
  let bad = 0, maxSats = 0, tamed = 0, upgrades = new Set(), peakRage = 0;
  while (G.turn <= 200 && !G.over) {
    HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G);
    maxSats = Math.max(maxSats, G.sats.length);
    for (const u of G.units) if (UNITS[u.type].tier >= 2) upgrades.add(u.type);
    for (const P of majors(G)) peakRage = Math.max(peakRage, P.rage);
    if (G.turn % 20 === 0 && G.active === 0) for (const c of G.cities) {
      const used = new Set();
      if (c.pop < 1) { bad++; check(false, 'colony pop below 1'); }
      for (const t of c.worked) { if (G.map.ocity[t] !== c.id || G.map.owner[t] !== c.owner) { bad++; check(false, `${c.name} works a tile it does not own`); break; } if (used.has(t)) { bad++; break; } used.add(t); }
      if (c.worked.length > c.pop) { bad++; check(false, 'more worked tiles than citizens'); }
    }
    if (G.turn % 20 === 0 && G.active === 0) for (const P of majors(G)) {
      if (P.gold < 0) { bad++; check(false, 'negative treasury'); }
      for (const k of P.techs) { const T0 = TECHS[TECHI[k]]; if (!T0.pre.every(q => P.techs.includes(q)) || (T0.any.length && !T0.any.some(q => P.techs.includes(q)))) { bad++; check(false, `tech ${k} learned without its links`); break; } }
    }
  }
  const P0 = majors(G)[0];
  check(bad === 0, 'economy invariants hold');
  check(majors(G).every(P => P.techs.length >= 20) || !!G.over, 'research progresses');
  check(majors(G).some(P => ['communion', 'lattice', 'lineage'].some(a => HX.affLevel(P, a) >= 5)), 'factions climb affinity levels');
  check(majors(G).every(P => P.policies.length >= 6), 'AI adopts virtues');
  check(majors(G).some(P => P.treesDone.length > 0), 'synergies are reached');
  check(majors(G).every(P => (P.story || []).length >= 4), 'story quests fire and are answered');
  check(majors(G).every(P => (P.qfx || []).length >= 3), 'story choices leave permanent effects');
  check(maxSats >= 2, `satellites are launched (${maxSats} at once)`);
  check(upgrades.size >= 3, `affinity units appear (${Array.from(upgrades).join(', ')})`);
  check(majors(G).some(P => (P.stats.digs || 0) >= 2), 'Explorers excavate sites');
  check(majors(G).some(P => (P.studied || []).length >= 1), 'Explorers study nests');
  check(G.players.filter(P => P.minor).length >= 2, 'outposts arrive over time');
  check(G.routes.length > 0, 'convoy routes run');
  check(peakRage > 15, `fauna anger rises (${Math.round(peakRage)})`);
  check(Object.keys(G.wonders).length >= 5, 'wonders get built');
  check(round(G), 'long game save round trip');
}

// ---- virtues ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'pol', rivals: 1 });
  const P = G.players[0], s = G.units.find(u => u.owner === 0 && u.type === 'settler');
  HX.foundCity(G, s); const c = G.cities.find(x => x.owner === 0);
  P.culturePool = 5000;
  check(!HX.adoptPolicy(G, 0, 'field_medics'), 'tier 2 needs a tier 1 virtue first');
  check(!HX.adoptPolicy(G, 0, 'heavy_industry'), 'tier 3 is phase-gated');
  const before = HX.cityReport(G, c); check(HX.adoptPolicy(G, 0, 'founders_creed'), "adopt Founders' Creed");
  const after = HX.cityReport(G, c); check(after.cul >= before.cul + 3 && after.food >= before.food + 2, "Founders' Creed boosts the capital");
  const c1 = HX.policyCost(G, 0); HX.adoptPolicy(G, 0, 'common_tables'); check(HX.policyCost(G, 0) > c1, 'virtue costs rise');
  HX.adoptPolicy(G, 0, 'festivals'); check(P.treesDone.includes('kinship3'), 'depth synergy at three virtues');
  for (const k of ['drill_corps', 'workshop_shifts', 'open_data']) HX.adoptPolicy(G, 0, k);
  check(HX.harmonyLevel(P) === 1 && P.treesDone.includes('harmony1'), 'harmony synergy across all trees');
  check(round(G), 'virtues survive save and load');
}

// ---- tech web, affinity, perks ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'web', rivals: 1 });
  const P = G.players[0];
  check(HX.techAvailable(P, 'hydroponics') && !HX.techAvailable(P, 'gene_weaving'), 'only first-ring branches are open at landfall');
  P.techs.push('xenobiology');
  check(HX.techAvailable(P, 'gene_weaving'), 'a branch opens from the neighboring sector');
  const path = HX.techPath(P, 'rootsong_theory');
  check(path[path.length - 1] === 'rootsong_theory' && path.length >= 3, `path to Rootsong Theory (${path.join(' > ')})`);
  const k0 = HX.techCost(G, 'gene_weaving', 0); P.techs.push('hydroponics', 'fabrication', 'robotics'); check(HX.techCost(G, 'gene_weaving', 0) > k0, 'tech costs rise with techs known');
  const lv0 = HX.affLevel(P, 'communion'); HX.gainAff(G, 0, 'communion', 60);
  check(HX.affLevel(P, 'communion') > lv0 && HX.polFx(P).veilImmune, 'affinity levels grant perks (Communion 2: Veil immunity)');
  check(HX.primaryAff(P) === 'communion', 'primary affinity follows experience');
  check(round(G), 'affinity survives save and load');
}

// ---- the Veil, Riggers, satellites ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'veil', rivals: 1 });
  const P = G.players[0], s = G.units.find(u => u.owner === 0 && u.type === 'settler'); HX.foundCity(G, s);
  const c = G.cities.find(x => x.owner === 0);
  check(G._grid.within(c.tile, 1).every(t => !G.map.veil[t]), 'founding a colony clears the Veil around it');
  const m = G.units.find(u => u.owner === 0 && UNITS[u.type].line === 'infantry');
  const vt = G._grid.within(c.tile, 6).find(t => G.map.veil[t] && ev('passableTerrain')(G, t) && !G._mil.has(t));
  if (vt !== undefined && m) {
    ev('placeUnit')(G, m, vt); m.hp = 100; m.acted = true;
    ev('healAndRecover')(G, 0); check(m.hp === 90, `the Veil hurts unadapted units (${m.hp})`);
    HX.gainAff(G, 0, 'communion', 60); m.acted = true; ev('healAndRecover')(G, 0); check(m.hp === 90, 'Communion 2 makes units immune');
  } else check(false, 'found a Veil tile for the damage test');
  P.techs.push('biocontainment');
  const rg = ev('spawnUnit')(G, 'builder', 0, c.tile);
  const vt2 = G._grid.within(c.tile, 3).find(t => G.map.veil[t] && ev('passableTerrain')(G, t));
  if (vt2 !== undefined) { ev('placeUnit')(G, rg, vt2); rg.moves = 12; const act = HX.builderActions(G, rg).find(x => x.kind === 'scour'); check(act && HX.doBuilderAction(G, rg, act) && !G.map.veil[vt2] && P.stats.scoured === 1, 'Riggers scour the Veil'); }
  P.techs.push('orbital_launch');
  const sat = ev('spawnUnit')(G, 'sat_helio', 0, c.tile);
  const ts = HX.launchTargets(G, sat); check(ts.length > 10, 'satellites have launch sites');
  const pBefore = HX.cityReport(G, c).prod;
  check(HX.launchSat(G, sat, c.tile) && G.sats.length === 1 && !G.units.includes(sat), 'launch a satellite');
  check(HX.cityReport(G, c).prod > pBefore, 'Helio Lens adds production under it');
  G.sats[0].until = G.turn; ev('satRound')(G); check(G.sats.length === 0, 'satellites burn up');
  check(round(G), 'veil and satellites survive save and load');
}

// ---- excavation, vaults, nests, taming, story ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'dig', rivals: 1 });
  const P = G.players[0], s = G.units.find(u => u.owner === 0 && u.type === 'settler'); HX.foundCity(G, s);
  check(HX.pendingStory(G, 0) && HX.pendingStory(G, 0).key === 'first_night', 'founding the first colony opens a story quest');
  const q0 = P.qfx.length; check(HX.resolveStory(G, 0, 1) && P.qfx.length === q0 + 1 && !HX.pendingStory(G, 0), 'answering a story quest keeps its effect');
  const ex = G.units.find(u => u.owner === 0 && UNITS[u.type].recon);
  const wreck = G.sites.find(x => x.kind === 'wreck');
  ev('placeUnit')(G, ex, wreck.tile); ex.moves = 18;
  check(HX.digStatus(G, ex).ok && HX.startDig(G, ex), 'Explorers start an excavation');
  const g0 = P.gold, d0 = P.stats.digs || 0;
  for (let k = 0; k < 3; k++) ev('digTurn')(G, 0);
  check((P.stats.digs || 0) === d0 + 1 && !G.sites.includes(wreck), 'the excavation finishes and pays');
  const vault = G.sites.find(x => x.kind === 'vault');
  ev('placeUnit')(G, ex, vault.tile); ex.moves = 18; ex.charges = 2; ex.order = null;
  HX.startDig(G, ex); ev('digTurn')(G, 0);
  check(P.vaults.length === 0 && (P.vaultHeard || []).includes(vault.id), 'vaults only record a hum before Deep Resonance');
  P.techs.push('deep_resonance'); ex.moves = 18; ex.order = null;
  check(HX.startDig(G, ex), 'decode a vault after Deep Resonance'); ev('digTurn')(G, 0);
  check(P.vaults.includes(vault.id), 'the vault is decoded');
  const camp = G.camps[0], adj = G._grid.neighbors(camp.tile).find(t => ev('passableTerrain')(G, t) && !G._civ.has(t) && !G._mil.has(t));
  if (adj !== undefined) { ev('placeUnit')(G, ex, adj); ex.moves = 18; ex.order = null; check(HX.studyNest(G, ex) && P.studied.includes(camp.id), 'Explorers study a nest'); }
  // taming needs Communion 4 and Fauna Ethology
  const B = G.players.findIndex(Q => Q.barbarian), beast = G.units.find(u => u.owner === B && UNITS[u.type].cls === 'melee');
  const mar = G.units.find(u => u.owner === 0 && UNITS[u.type].line === 'infantry');
  if (beast && mar) {
    const spot = G._grid.neighbors(beast.tile).find(t => ev('passableTerrain')(G, t) && !G._mil.has(t));
    if (spot !== undefined) {
      ev('placeUnit')(G, mar, spot); mar.moves = 12;
      check(!HX.tameStatus(G, mar), 'no taming without Communion');
      HX.gainAff(G, 0, 'communion', 200); P.techs.push('fauna_ethology'); P.gold = 500;
      check(HX.tameFauna(G, mar) && beast.owner === 0, 'Communion tames a wild beast');
    }
  }
  check(round(G), 'excavations and stories survive save and load');
}

// ---- combat, capture, affinity upgrades, fauna anger ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'war', rivals: 1 });
  const [A, Bp] = majors(G);
  for (const P of [A, Bp]) HX.foundCity(G, G.units.find(u => u.owner === P.id && u.type === 'settler'));
  const ca = G.cities.find(c => c.owner === A.id), cb = G.cities.find(c => c.owner === Bp.id);
  A.met.push(Bp.id); Bp.met.push(A.id); A._vis.fill(1);
  const a1 = ev('spawnUnit')(G, 'militia', A.id, G._grid.neighbors(cb.tile).find(t => ev('passableTerrain')(G, t) && !G._mil.has(t)));
  A._vis.fill(1);
  check(!HX.attackStatus(G, a1, cb.tile).ok && HX.attackStatus(G, a1, cb.tile).peace === Bp.id, 'no attacks at peace');
  check(HX.declareWar(G, A.id, Bp.id) && HX.atWar(G, A.id, Bp.id), 'declare war');
  const g = G._mil.get(cb.tile); if (g) ev('removeUnit')(G, g);
  cb.hp = 1; a1.moves = 12; A._vis.fill(1);
  const r = HX.doAttack(G, a1, cb.tile);
  check(r && r.captured && cb.owner === A.id, 'melee attack captures a colony at zero health');
  check(!Bp.alive, 'losing the last colony eliminates the faction');
  // affinity upgrade
  const mil = G.units.find(u => u.owner === A.id && u.type === UNITS.militia.key) || a1;
  A.techs.push('combat_doctrine'); HX.gainAff(G, A.id, 'lattice', 80); A.gold = 1000;
  ev('placeUnit')(G, mil, ca.tile); mil.moves = 12;
  const opts = HX.upgradeOptions(G, mil);
  check(opts.length === 3 && opts.find(o => o.aff === 'lattice').ok && !opts.find(o => o.aff === 'communion').ok, 'upgrades split by affinity level');
  check(HX.upgradeUnit(G, mil, 'servitor') && mil.type === 'servitor', 'upgrade a Marine to a Servitor Frame');
  // fauna anger
  const B = G.players.findIndex(Q => Q.barbarian), beast = ev('spawnUnit')(G, 'skitter', B, G._grid.within(ca.tile, 3).find(t => ev('passableTerrain')(G, t) && !G._mil.has(t) && !G._cityAt.has(t)));
  const r0 = A.rage; beast.hp = 1;
  const att = G.units.find(u => u.owner === A.id && UNITS[u.type].military && UNITS[u.type].cls !== 'recon' && !UNITS[u.type].ranged && u.id !== mil.id) || mil;
  ev('placeUnit')(G, att, G._grid.neighbors(beast.tile).find(t => ev('passableTerrain')(G, t) && !G._mil.has(t)) ?? att.tile); att.moves = 12;
  A._vis.fill(1); const rr = HX.doAttack(G, att, beast.tile);
  if (!rr) console.log('fauna attack failed', HX.attackStatus(G, att, beast.tile), att.type, G._grid.dist(att.tile, beast.tile));
  check(rr && A.rage > r0, `attacking fauna raises their anger (${r0} → ${A.rage})`);
  A.rage = 90; check(HX.faunaHostile(G, A.id), 'angry fauna hunt you');
  A.rage = 0; check(!HX.faunaHostile(G, A.id, ca.tile) || G.camps.some(c => G._grid.dist(c.tile, ca.tile) <= 2), 'calm fauna leave you alone away from nests');
  check(round(G), 'combat state survives save and load');
}

// ---- outposts ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'out', rivals: 1 }, { allAI: true });
  const n0 = G.players.filter(P => P.minor).length;
  while (G.turn < 45) { HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G); }
  check(G.players.filter(P => P.minor).length > n0, 'new outposts land during the game');
  const M = G.players.find(P => P.minor && P.alive), A = majors(G)[0];
  A.met.push(M.id); M.inf[A.id] = 100; A.gold = 2000;
  check(HX.minorAlly(G, M.id) === A.id && HX.absorbStatus(G, A.id, M.id).ok, 'an ally with high influence can absorb an outpost');
  const city = G.cities.find(c => c.owner === M.id);
  check(HX.absorbOutpost(G, A.id, M.id) && city.owner === A.id && !M.alive, 'absorbing transfers the colony');
  check(round(G), 'outposts survive save and load');
}

// ---- victory projects and Dominion ----
{
  const G = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'vic', rivals: 2 });
  const [A, B2, C2] = majors(G);
  for (const P of [A, B2, C2]) HX.foundCity(G, G.units.find(u => u.owner === P.id && u.type === 'settler'));
  const ca = G.cities.find(c => c.owner === A.id);
  A.techs.push('rootsong_theory'); A.techs.push('xenobiology', 'gene_weaving', 'neural_symbiosis');
  check(!HX.canBuildItem(G, ca, { k: 'b', key: 'heartbloom' }).ok, 'the Heartbloom needs Communion 8');
  HX.gainAff(G, A.id, 'communion', 400);
  check(HX.canBuildItem(G, ca, { k: 'b', key: 'heartbloom' }).ok, 'Communion 8 and Rootsong Theory open the Heartbloom');
  ca.build = { k: 'b', key: 'heartbloom' }; ca.prod = 99999; ev('completeBuild')(G, ca);
  check(HX.projectBuilt(G, A.id, 'heartbloom'), 'the Heartbloom is grown');
  const need = HX.clockNeed(G, HX.PROJECTS[0]);
  for (let k = 0; k < need - 1; k++) { ev('victoryRound')(G); G.turn++; }
  check(!G.over && A.clock.rootsong === need - 1, 'the Rootsong clock runs');
  ev('victoryRound')(G);
  check(G.over && G.over.type === 'rootsong' && G.over.winner === A.id, 'holding the Heartbloom wins a Rootsong victory');
  const G2 = HX.makeGame({ size: 'small', script: 'pangaea', seed: 'dom', rivals: 2 });
  const ps = majors(G2); for (const P of ps) HX.foundCity(G2, G2.units.find(u => u.owner === P.id && u.type === 'settler'));
  const caps = G2.cities.filter(c => c.owner !== ps[0].id && ps.some(P => P.id === c.owner));
  caps[0].owner = ps[0].id; for (const t of caps[0].tiles) G2.map.owner[t] = ps[0].id;
  for (let k = 0; k < 30 && !G2.over; k++) { ev('victoryRound')(G2); G2.turn++; }
  check(G2.over && G2.over.type === 'domination', 'holding half the rival first colonies wins Dominion');
}

console.log(`${passes} checks passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (fails) process.exit(1);
