// ===== game.js : new game, empires, species, day loop, log, save format =====
var START_YEAR = 3000;
var DIFFICULTY = { easy: { ai: -0.15, label: 'Easy' }, normal: { ai: 0, label: 'Normal' }, hard: { ai: 0.2, label: 'Hard' }, brutal: { ai: 0.4, label: 'Brutal' } };
var GAME_LENGTHS = { 120: 'Short · 120 years', 200: 'Standard · 200 years', 300: 'Long · 300 years' };
var SPECIES_PRESETS = [
  { name: 'Thessari', body: 'Saurian', pref: 'dune', traits: ['industrious', 'hardy', 'quarrelsome'], ethos: ['vanguard', 'frontier'], gov: 'warhost', empire: 'Thessari Hegemony', portrait: [28, 0, 2, 1, 3, 0, 2, 210, 1] },
  { name: 'Ollvae', body: 'Aquatic', pref: 'tidal', traits: ['brilliant', 'charismatic', 'fragile'], ethos: ['ascendant', 'concord'], gov: 'lattice', empire: 'Ollvae Concordance', portrait: [195, 1, 4, 2, 0, 2, 1, 250, 2] },
  { name: 'Kreth', body: 'Arthropod', pref: 'mesa', traits: ['industrious', 'fertile', 'solitary'], ethos: ['zealous', 'devout'], gov: 'synod', empire: 'Holy Kreth Covenant', portrait: [8, 2, 1, 4, 2, 3, 3, 330, 0] },
  { name: 'Ysmeri', body: 'Avian', pref: 'highland', traits: ['thrifty', 'devoted', 'wayfaring'], ethos: ['mercantile', 'frontier'], gov: 'syndicate', empire: 'Ysmeri Trade Compact', portrait: [48, 1, 3, 2, 1, 1, 0, 180, 3] },
  { name: 'Vuul', body: 'Fungoid', pref: 'fen', traits: ['fertile', 'agrarian', 'adaptable', 'languid'], ethos: ['devout', 'insular'], gov: 'assembly', empire: 'Vuul Mycelial Union', portrait: [290, 0, 5, 3, 4, 4, 4, 140, 1] },
  { name: 'Aurenn', body: 'Mammalian', pref: 'taiga', traits: ['adaptable', 'enduring'], ethos: ['concord', 'mercantile'], gov: 'assembly', empire: 'Aurenn Commonwealth', portrait: [215, 2, 0, 0, 5, 1, 2, 20, 2] },
];

function log(G, eid, msg, sys, kind) {
  G.log.push({ d: G.day, e: eid, m: msg, s: sys == null ? -1 : sys, k: kind || 'info' });
  if (G.log.length > 600) G.log.splice(0, G.log.length - 500);
}
SW.log = log;
function dateOf(day) { const y = START_YEAR + Math.floor(day / DAYS_YEAR), m = Math.floor((day % DAYS_YEAR) / DAYS_MONTH) + 1, d = day % DAYS_MONTH + 1; return { y, m, d }; }
function dateStr(day) { const t = dateOf(day); return t.y + '.' + String(t.m).padStart(2, '0') + '.' + String(t.d).padStart(2, '0'); }
SW.dateStr = dateStr; SW.dateOf = dateOf;

function makeSpecies(G, o, spec) {
  const used = new Set(G.species.map(s => s.name));
  const name = spec && spec.name || makeName(o, used, 4);
  const sp = { id: G.species.length, name, pref: spec && spec.pref || rpick(o, HAB_TYPES), traits: spec && spec.traits ? spec.traits.slice() : [], body: spec && spec.body || rpick(o, BODY_TYPES),
    portrait: spec && spec.portrait ? spec.portrait.slice() : randomPortrait(o) };
  G.species.push(sp); return sp;
}
function randomPortrait(o) { return [rint(o, 0, 359), rint(o, 0, 2), rint(o, 0, 5), rint(o, 0, 4), rint(o, 0, 5), rint(o, 0, 4), rint(o, 0, 4), rint(o, 0, 359), rint(o, 0, 3)]; }
SW.randomPortrait = (seed) => randomPortrait({ rng: rngState(seed) });
function randomTraits(o, persona) {
  const pref = { expansionist: ['fertile', 'wayfaring', 'adaptable'], militarist: ['hardy', 'industrious'], scholarly: ['brilliant', 'charismatic'], mercantile: ['thrifty', 'charismatic', 'agrarian'], isolationist: ['enduring', 'industrious', 'devoted'], zealot: ['devoted', 'hardy', 'fertile'] }[persona] || [];
  const pos = Object.keys(TRAITS).filter(k => TRAITS[k].cost > 0), neg = Object.keys(TRAITS).filter(k => TRAITS[k].cost < 0);
  const out = []; let pts = TRAIT_POINTS;
  if (rchance(o, 0.6)) { const n = rpick(o, neg); out.push(n); pts += 1; }
  const order = rshuffle(o, pref.slice()).concat(rshuffle(o, pos.slice()));
  for (const k of order) {
    if (out.includes(k) || TRAITS[k].cost > pts || out.length >= TRAIT_MAX) continue;
    if (out.some(x => TRAITS[x].opp === k || TRAITS[k].opp === x)) continue;
    out.push(k); pts -= TRAITS[k].cost; if (pts <= 0) break;
  }
  return out;
}
function validTraits(traits) {
  let pts = TRAIT_POINTS;
  for (const k of traits) { if (!TRAITS[k]) return false; pts -= TRAITS[k].cost; }
  if (traits.length > TRAIT_MAX || pts < 0) return false;
  for (const a of traits) for (const b of traits) if (TRAITS[a].opp === b) return false;
  return new Set(traits).size === traits.length;
}
SW.validTraits = validTraits;
SW.traitPointsLeft = traits => TRAIT_POINTS - sum(traits, k => TRAITS[k].cost);

function blankEmpire(G, id, kind) {
  return { id, kind, name: '', adj: '', color: '#888', ai: true, alive: true, species: -1, ethos: [], gov: null, persona: null,
    res: { energy: 0, minerals: 0, food: 0, alloys: 0, goods: 0, influence: 0, unity: 0 }, capital: -1,
    techs: {}, rep: { lumen: 0, vita: 0, forge: 0 }, research: { lumen: { opts: [], cur: null, prog: 0 }, vita: { opts: [], cur: null, prog: 0 }, forge: { opts: [], cur: null, prog: 0 } },
    trads: {}, edicts: {}, timed: [], designs: [], surv: [], known: [], rel: {}, deficit: {}, stats: { shipsLost: 0, shipsKilled: 0, planetsTaken: 0, techs: 0, crisisKills: 0, anomalies: 0 },
    flags: {}, beaconDays: 0, ai_: { }, autoDesign: true };
}
function newGame(cfgIn) {
  const cfg = Object.assign({ size: 'medium', shape: 'spiral2', difficulty: 'normal', years: 200, crisis: 'normal', allAI: false, seed: 'starwake', player: null, events: true }, cfgIn || {});
  const nE = cfg.empires || GALAXY_SIZES[cfg.size].empires;
  const G = { v: SAVE_FORMAT, seed: String(cfg.seed), cfg, rng: rngState(cfg.seed + ':game'), day: 0, endDay: cfg.years * DAYS_YEAR, ids: {}, systems: [], planets: [], species: [], empires: [], fleets: [], wars: [], log: [], pending: [], crisis: { stage: 0 }, winner: null, over: false, hist: [], uiLog: 0 };
  const o = genGalaxy(G);
  // capitals: well connected systems, not in the core
  const cands = G.systems.filter(s => s.lanes.length >= 2 && hyp(s.x, s.y) > G.R * 0.25).map(s => s.id);
  const capitals = spreadPick(G, o, cands, nE, null, 0);
  // empires
  const personas = rshuffle(o, Object.keys(PERSONAS).slice());
  const colors = EMPIRE_COLORS.slice();
  for (let i = 0; i < nE; i++) G.empires.push(blankEmpire(G, i, 'major'));
  const fauna = blankEmpire(G, nE, 'fauna'); fauna.name = 'Wild Fauna'; fauna.color = '#9aa3b5'; fauna.adj = 'Wild'; G.empires.push(fauna); G.faunaId = nE;
  const crisis = blankEmpire(G, nE + 1, 'crisis'); crisis.name = 'The Hollow Choir'; crisis.adj = 'Hollow'; crisis.color = '#b46cff'; crisis.alive = false; G.empires.push(crisis); G.crisisId = nE + 1;
  placeSpecials(G, o, capitals);
  for (let i = 0; i < nE; i++) {
    const e = G.empires[i], human = i === 0 && !cfg.allAI;
    const pc = human ? (cfg.player || SPECIES_PRESETS[0]) : null;
    e.ai = !human;
    e.persona = human ? null : personas[(i - (cfg.allAI ? 0 : 1) + personas.length) % personas.length];
    let color = human && pc.color ? pc.color : null;
    if (!color) color = colors.find(c => !G.empires.some(x => x.color === c));
    e.color = color;
    const P = e.persona ? PERSONAS[e.persona] : null;
    const sp = makeSpecies(G, o, human ? pc : { traits: randomTraits(o, e.persona) });
    e.species = sp.id;
    e.ethos = human ? pc.ethos.slice() : P.ethos.slice();
    if (!human && rchance(o, 0.35)) { // some variety in the second ethos
      const alt = rpick(o, Object.keys(ETHOS)); if (alt !== e.ethos[0] && ETHOS[alt].opp !== e.ethos[0]) e.ethos[1] = alt;
    }
    e.gov = human ? pc.gov : (rchance(o, 0.75) ? P.gov : rpick(o, Object.keys(GOVS)));
    const form = rpick(o, EMPIRE_FORMS);
    e.name = human && pc.empire ? pc.empire : (rchance(o, 0.5) ? sp.name + ' ' + form : form + ' of ' + makeName(o, null, 4));
    e.adj = sp.name;
    setupEmpire(G, o, e, capitals[i]);
  }
  for (const e of G.empires) { e.surv = new Array(G.systems.length).fill(0); if (!e.known.length) e.known = new Array(G.systems.length).fill(0); }
  for (const e of majors(G)) { e.surv[G.planets[e.capital].sys] = 1; revealAround(G, e, G.planets[e.capital].sys, 2); for (const k of RESEARCH) drawOptions(G, e, k); }
  updateOwnership(G);
  log(G, -1, 'The year is ' + START_YEAR + '. The starlanes are open.', -1, 'major');
  return G;
}
SW.newGame = newGame;
function majors(G) { return G.empires.filter(e => e.kind === 'major'); }
function alive(G) { return G.empires.filter(e => e.kind === 'major' && e.alive); }
SW.majors = majors; SW.alive = alive;

function setupEmpire(G, o, e, capSys) {
  const sys = G.systems[capSys], sp = G.species[e.species];
  const p = setHabitable(G, o, sys, sp.pref, 18); p.home = 1; p.name = makeName(o, null, 4);
  // two more habitable worlds nearby
  const near = jumpDist(G, [capSys], 3);
  const ring = G.systems.filter(s => near[s.id] >= 1 && near[s.id] <= 3 && !s.special && !G.empires.some(x => x.capital >= 0 && G.planets[x.capital].sys === s.id));
  rshuffle(o, ring);
  let got = ring.filter(s => s.planets.some(id => { const q = G.planets[id]; return PLANET_TYPES[q.type].hab && PLANET_TYPES[q.type].climate === PLANET_TYPES[sp.pref].climate && !q.prim; })).length;
  for (const s of ring) {
    if (got >= 2) break;
    if (s.planets.some(id => PLANET_TYPES[G.planets[id].type].hab)) continue;
    const t = rchance(o, 0.5) ? sp.pref : rpick(o, CLIMATES[PLANET_TYPES[sp.pref].climate]);
    setHabitable(G, o, s, t, rint(o, 10, 17)); got++;
  }
  // a couple of resource rocks in the home system
  const rocks = sys.planets.map(id => G.planets[id]).filter(q => !PLANET_TYPES[q.type].hab && q.type !== 'beacon');
  if (rocks[0]) rocks[0].dep = { minerals: 2 };
  if (rocks[1]) rocks[1].dep = { energy: 2 };
  e.capital = p.id; e.home = capSys;
  e.res = { energy: 150, minerals: 300, food: 150, alloys: 150, goods: 80, influence: 120, unity: 20 };
  for (const t of START_TECHS) e.techs[t] = 1;
  p.col = newColony(G, e, p, 20);
  p.col.dist = { habitat: 1, generator: 3, mining: 3, farming: 2, industrial: 1 };
  p.col.bld = ['seat', 'lab'];
  p.col.desig = 'auto';
  sys.owner = e.id;
  sys.sb = { owner: e.id, lvl: 1, mods: ['shipyard', 'anchorage'], hp: 0, sh: 0, queue: [], dis: 0 };
  sbReset(G, sys);
  // starting designs and ships
  autoDesigns(G, e);
  const civ = (hull) => e.designs.find(d => d.hull === hull).id;
  makeFleet(G, e.id, capSys, [civ('surveyor')], 'survey');
  makeFleet(G, e.id, capSys, [civ('surveyor')], 'survey');
  makeFleet(G, e.id, capSys, [civ('builder')], 'builder');
  const war = bestDesign(G, e, 'picket');
  makeFleet(G, e.id, capSys, [war, war, war], 'war');
  e.known = new Array(G.systems.length).fill(0);
}
function newColony(G, e, p, pops) {
  return { owner: e.id, sp: e.species, pops, grow: 0, dist: { habitat: 0, generator: 0, mining: 0, farming: 0, industrial: 0 }, bld: ['hub'], queue: [], desig: 'auto', auto: !!e.ai, def: 0, fort: 100, founded: G.day, unrest: 0 };
}
function revealAround(G, e, sysId, radius) {
  const d = jumpDist(G, [sysId], radius);
  for (let i = 0; i < d.length; i++) if (d[i] >= 0) e.known[i] = 1;
}
// recompute empire territory caches after ownership changes
function updateOwnership(G) {
  G._ownVer = (G._ownVer || 0) + 1;
  for (const e of G.empires) { e._sys = null; e._cols = null; e._mods = null; e._econ = null; }
}
SW.updateOwnership = updateOwnership;
function ownedSystems(G, e) {
  if (!e._sys) { e._sys = []; for (const s of G.systems) if (s.owner === e.id) e._sys.push(s.id); }
  return e._sys;
}
function colonies(G, e) {
  if (!e._cols) { e._cols = []; for (const p of G.planets) if (p.col && p.col.owner === e.id) e._cols.push(p); }
  return e._cols;
}
SW.ownedSystems = ownedSystems; SW.colonies = colonies;
function totalPops(G, e) { return sum(colonies(G, e), p => p.col.pops); }
SW.totalPops = totalPops;

// ---------- the day loop ----------
function advanceDay(G) {
  if (G.over) return;
  G.day++;
  G._shots = G._shots || {};
  moveFleets(G);
  fleetOrdersDay(G);
  buildDay(G);
  combatDay(G);
  groundDay(G);
  if (G.day % 3 === 0) monstersDay(G);
  if (G.day % DAYS_MONTH === 0) monthly(G);
  for (const e of G.empires) {
    if (e.kind !== 'major' || !e.alive || !e.ai) continue;
    if ((G.day + e.id * 4) % DAYS_MONTH === 0) aiMonthly(G, e);
    if ((G.day + e.id) % 5 === 0) aiMilitary(G, e);
    if ((G.day + e.id * 2) % 10 === 0) aiCivilians(G, e);
  }
  for (const e of G.empires) if (e.kind === 'major' && e.alive && !e.ai && (G.day + e.id) % 10 === 0) autoCivilians(G, e);
  firePending(G);
  if (G.day % DAYS_YEAR === 0) yearly(G);
}
SW.advanceDay = advanceDay;
function monthly(G) {
  for (const e of G.empires) {
    if (e.kind !== 'major' || !e.alive) continue;
    monthlyEconomy(G, e);
    monthlyResearch(G, e);
    expireTimed(G, e);
  }
  diplomacyMonthly(G);
  actorsMonthly(G);
  randomEventsMonthly(G);
  checkVictory(G);
}
function yearly(G) {
  recordHistory(G);
}
SW.monthly = monthly;

// ---------- save format ----------
function serializeGame(G) { return JSON.stringify(G, (k, v) => (k.charCodeAt(0) === 95 ? undefined : v)); }
function deserializeGame(str) {
  const G = JSON.parse(str);
  if (!G || G.v !== SAVE_FORMAT || !Array.isArray(G.systems)) throw new Error('Not a Starwake save');
  updateOwnership(G);
  return G;
}
SW.serializeGame = serializeGame; SW.deserializeGame = deserializeGame;
