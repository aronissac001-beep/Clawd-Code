// ===== goals.js : the end of each sol, milestones, independence, defeat, score =====
const MILESTONES = {
  landing: { name: 'Touchdown', desc: 'Land on Kessa.', grant: 0, score: 10 },
  power: { name: 'First Light', desc: 'Build a power source.', grant: 100, score: 20 },
  hub: { name: 'Swarm Online', desc: 'Build a Drone Hub.', grant: 100, score: 20 },
  water: { name: 'First Water', desc: 'Build an Ice Drill or Frost Condenser.', grant: 150, score: 20 },
  air: { name: 'Breath of Kessa', desc: 'Build an Air Synthesizer.', grant: 150, score: 20 },
  dome: { name: 'Under Glass', desc: 'Complete a dome.', grant: 300, score: 50 },
  colonists: { name: 'First Footsteps', desc: 'Colonists arrive.', grant: 300, score: 80 },
  pop25: { name: 'Settlement', desc: 'Reach 25 colonists.', grant: 300, score: 80 },
  pop50: { name: 'Township', desc: 'Reach 50 colonists.', grant: 500, score: 150 },
  pop100: { name: 'Colony', desc: 'Reach 100 colonists.', grant: 800, score: 300 },
  birth: { name: 'Kessa-Born', desc: 'The first child born on Kessa.', grant: 400, score: 100 },
  births10: { name: 'Next Generation', desc: '10 births.', grant: 600, score: 200 },
  anomaly: { name: 'Strange Findings', desc: 'Investigate an anomaly.', grant: 100, score: 40 },
  techs5: { name: 'Inquiry', desc: 'Research 5 technologies.', grant: 200, score: 60 },
  techs15: { name: 'Discovery', desc: 'Research 15 technologies.', grant: 400, score: 150 },
  techs30: { name: 'Mastery', desc: 'Research 30 technologies.', grant: 600, score: 300 },
  parts: { name: 'Made on Kessa', desc: 'Produce machine parts locally.', grant: 200, score: 50 },
  export: { name: 'First Export', desc: 'Sell rare metals or Kessite at home.', grant: 0, score: 60 },
  storm: { name: 'Weathered', desc: 'Survive a dust storm.', grant: 150, score: 40 },
  selfFood: { name: 'Self-Fed', desc: 'Five sols without hunger or food imports, with 20+ colonists.', grant: 500, score: 150 },
  spire: { name: 'Charter Spire', desc: 'Raise the Charter Spire.', grant: 0, score: 300 },
  choir: { name: 'The Choir Answers', desc: 'Solve the mystery of the Wardens.', grant: 0, score: 300 },
  halcyon: { name: 'The Halcyon Wakes', desc: 'Wake the Halcyon sleepers.', grant: 0, score: 300 },
  bloom: { name: 'The Bloom Below', desc: 'Grow the Undergrove from the heart of the Pale Bloom.', grant: 0, score: 300 },
  moon: { name: 'The Ninth Moon Answers', desc: 'Raise the Skyward Relay.', grant: 0, score: 300 },
  orrery: { name: 'The Orrery Turns', desc: 'Rebuild the Great Orrery from three relics.', grant: 0, score: 300 },
  independence: { name: 'Independence', desc: 'Declare an independent Kessa.', grant: 0, score: 1000 },
};
// after Independence: open-ended goals for a free Kessa, and the Great Storm
const FREE_GOALS = [
  { k: 'city', name: 'A city of 250', have: G => G.colonists.length, need: 250 },
  { k: 'born', name: '50 children born on Kessa', have: G => G.st.births, need: 50 },
  { k: 'mysteries', name: 'Solve both mysteries', have: G => (G.myst.stage >= 4 ? 1 : 0) + (G.myst2 && G.myst2.stage >= 4 ? 1 : 0), need: 2 },
  { k: 'wonders', name: 'Orbital Mirror, Resonance Array and Revival Vault', have: G => ['mirror', 'array', 'vault'].filter(t => G.buildings.some(b => b.t === t && b.built)).length, need: 3 },
  { k: 'storm', name: 'Weather the Great Storm with no deaths', have: G => G.ms.greatStorm ? 1 : 0, need: 1 },
  { k: 'stories', name: 'Solve the Bloom Below and the Ninth Moon', have: G => (G.ms.bloom ? 1 : 0) + (G.ms.moon ? 1 : 0), need: 2 },
  { k: 'wonders2', name: 'The Undergrove, the Skyward Relay and the Great Orrery', have: G => ['undergrove', 'relay', 'orrery'].filter(t => G.buildings.some(b => b.t === t && b.built)).length, need: 3 },
];
function freeGoals(G) { return FREE_GOALS.map(f => ({ k: f.k, name: f.name, have: f.have(G), need: f.need, ok: !!(G.free && G.free[f.k]) || f.have(G) >= f.need })); }
function freeSol(G) {
  if (!G.ms.independence) return;
  G.free = G.free || {};
  freeSettlers(G);
  for (const f of freeGoals(G)) if (f.ok && !G.free[f.k]) { G.free[f.k] = solOf(G.tick); log(G, 'Free Kessa goal reached: ' + f.name + '.', 'good'); fx(G, { k: 'milestone', id: f.k }); }
  const due = G.flags.greatStorm;
  if (!G.ms.greatStorm && (due === undefined ? solOf(G.tick) >= G.ms.independence + 6 : due > 1 && G.tick >= due) && !G.hz.active.some(a => a.kind === 'dust') && !G.hz.upcoming.some(u => u.kind === 'dust')) {
    G.flags.greatStorm = 1;
    const L = G.land;
    G.hz.upcoming.push({ kind: 'dust', at: G.tick + 48, sev: 0.95, dur: 100, great: true, x: L.x, y: L.y });
    log(G, 'Long-range sensors show a planet-wide storm front: the Great Storm arrives in 48 hours and lasts about 4 sols. Solar will be nearly useless. Stock fuel and batteries, build Wind Masts, and keep life support on High priority.', 'bad');
    fx(G, { k: 'warn', kind: 'dust' });
  }
}
// a free Kessa draws people of its own: every three sols, settlers from Earth and the other colonies fill empty beds in
// domes that breathe, if the colony is a happy place, until it is back to its largest size. Without this the founding generation grew old together and the
// population fell by half late in long games (immigration had ended with the sponsor and births need free beds).
function freeSettlers(G) {
  if (solOf(G.tick) % 3) return;
  const info = G._domes || domeInfo(G); let free = 0;
  for (const I of info.values()) if (I.ok && lifeOK(I.b)) free += Math.max(0, I.cap - I.res.length);
  // they replace the people the colony has lost (to old age, accidents or the road home): up to its largest size so far
  const pop = G.colonists.length, mor = pop ? G.colonists.reduce((s, c) => s + c.morale, 0) / pop : 0, gap = Math.max(G.st.peakPop, DIFFICULTY[G.cfg.difficulty].pop) - pop;
  if (free < 4 || gap < 2 || mor < 45 || G.sol.short.food || G.sol.short.oxygen || G.sol.short.water) return;
  const n = Math.min(6, Math.floor(free / 2), gap), r = rng(G);
  for (let i = 0; i < n; i++) { const p = makePerson(G, { age: Math.round(r.range(19, 40) * 10) / 10 }); const c = addColonist(G, p, null); c.settler = true; c.sanity = Math.max(c.sanity, 80); }
  G.st.arrived += n; G.st.settlers = (G.st.settlers || 0) + n; rehome(G);
  log(G, n + ' settlers have come to live in a free Kessa.', 'good');
}
function techCount(G) { return Object.keys(G.research.done).length; }
function hasBuilt(G, pred) { return G.buildings.some(b => b.built && pred(b)); }
function checkMilestones(G) {
  const sol = solOf(G.tick), pop = G.colonists.length, nt = techCount(G);
  const conds = {
    power: () => hasBuilt(G, b => !b.mod && BUILDINGS[b.t].gen && b.t !== 'lander'), hub: () => hasBuilt(G, b => b.t === 'hub'),
    water: () => hasBuilt(G, b => b.t === 'icedrill' || b.t === 'condenser'), air: () => hasBuilt(G, b => b.t === 'airsynth'),
    dome: () => hasBuilt(G, b => !b.mod && !!BUILDINGS[b.t].dome), colonists: () => G.st.everColonists,
    pop25: () => pop >= 25, pop50: () => pop >= 50, pop100: () => pop >= 100, birth: () => G.st.births >= 1, births10: () => G.st.births >= 10,
    techs5: () => nt >= 5, techs15: () => nt >= 15, techs30: () => nt >= 30, parts: () => G.hist.some(h => h.made && h.made.parts > 0) || (G.sol.prod.parts > 0 && hasBuilt(G, b => b.t === 'works' || b.t === 'workshop')),
    selfFood: () => pop >= 20 && G.hist.length >= 5 && G.hist.slice(-5).every(h => h.pop >= 20 && !h.short.food && !(h.imp && h.imp.food)),
    spire: () => hasBuilt(G, b => b.t === 'spire'),
  };
  for (const k in conds) if (!G.ms[k] && conds[k]()) {
    G.ms[k] = sol; const m = MILESTONES[k];
    if (m.grant) { const g = Math.round(m.grant * DIFFICULTY[G.cfg.difficulty].funds); G.funds += g; }
    addConf(G, 3);
    log(G, 'Milestone: ' + m.name + '. ' + m.desc + (m.grant ? ' The sponsor sends a grant of ' + Math.round(m.grant * DIFFICULTY[G.cfg.difficulty].funds) + '.' : ''), 'good');
    fx(G, { k: 'milestone', id: k });
  }
}
// what Independence needs, with progress
function independence(G) {
  const DF = DIFFICULTY[G.cfg.difficulty], last = G.hist.slice(-5), pop = G.colonists.length;
  const okSols = last.length >= 5 && last.every(selfSol);
  return [
    { k: 'pop', name: 'Population ' + DF.pop, have: pop, need: DF.pop, ok: pop >= DF.pop },
    { k: 'tech', name: '25 technologies', have: techCount(G), need: 25, ok: techCount(G) >= 25 },
    { k: 'spire', name: 'Charter Spire built', have: G.ms.spire ? 1 : 0, need: 1, ok: !!G.ms.spire },
    { k: 'buyout', name: 'Buy out the sponsor\'s stake: ' + buyoutCost(G) + ' funding', have: Math.max(0, G.funds), need: buyoutCost(G), ok: G.funds >= buyoutCost(G) },
    { k: 'self', name: 'Five sols with no shortages and no imported food, parts or metals', have: okSols ? 5 : Math.min(5, countSelf(G)), need: 5, ok: okSols },
    { k: 'assembly', name: 'The Assembly backs a declaration (mood ' + ASM.backing + '+)', have: backing(G), need: ASM.backing, ok: backing(G) >= ASM.backing },
  ];
}
// a self-sufficient sol: nobody went short of food, air or water, and no food, parts or metals were imported
function selfSol(h) { const imp = h.imp || {}; return !h.short.food && !h.short.oxygen && !h.short.water && !imp.food && !imp.parts && !imp.metals && h.pop > 0; }
function countSelf(G) { let n = 0; for (let i = G.hist.length - 1; i >= 0; i--) { if (selfSol(G.hist[i])) n++; else break; } return n; }
function score(G) {
  let s = 0;
  for (const k in G.ms) s += (MILESTONES[k] || { score: 0 }).score;
  s += G.colonists.length * 10 + G.st.births * 15 + techCount(G) * 25 + Math.floor(G.tick / 24) * 2 + Math.round(G.st.exportFunds / 50);
  s -= G.st.deaths * 10;
  s += Object.keys(G.free || {}).length * 250 + (G.myst2 && G.myst2.stage >= 4 ? 300 : 0);
  s += (G.st.contractsWon || 0) * 60 + (G.myst && G.myst.stage >= 4 ? 500 : 0) + Math.round((G.conf || 0) * 2);
  s += worldScore(G);
  const mult = { easy: 0.8, normal: 1, hard: 1.4 }[G.cfg.difficulty] * (G.cfg.sponsor === 'pilgrim' ? 1.3 : 1);
  if (G.over && G.over.win) s += Math.max(500, 4000 - G.over.sol * 15);
  return Math.max(0, Math.round(s * mult));
}
function solStep(G) {
  const sol = solOf(G.tick) - 1; // the sol that just ended
  const SP = SPONSORS[G.cfg.sponsor], DF = DIFFICULTY[G.cfg.difficulty];
  economySol(G);
  eventsSol(G);
  storySol(G);
  colonistSol(G);
  systemFailures(G);
  if (sol % 5 === 0) { const r = rng(G); for (const a of G.applicants) if (r.chance(0.35)) a.stale = true; refreshApplicants(G, 24); }
  const pop = G.colonists.length;
  G.st.peakPop = Math.max(G.st.peakPop, pop);
  const S = G.sol;
  const net = k => round2((S.prod[k] || 0) - (S.use[k] || 0));
  G.hist.push({ sol, pop, funds: Math.round(G.funds), food: net('food'), made: { parts: round2(S.prod.parts || 0), metals: round2(S.prod.metals || 0), food: round2(S.prod.food || 0) }, spent: { parts: round2(S.use.parts || 0) },
    short: Object.assign({}, S.short), imp: Object.assign({}, S.imp || {}), rp: round2(S.prod.rp || 0), power: round2(S.prod.power || 0), techs: techCount(G), births: G.st.births, deaths: G.st.deaths });
  if (G.hist.length > 400) G.hist.shift();
  G.sol = { prod: {}, use: {}, short: {} };
  G._jobsDirty = true;
  checkMilestones(G);
  freeSol(G);
  worldSol(G);
  // independence
  if (!G.over && independence(G).every(c => c.ok)) {
    G.ms.independence = sol;
    G.funds -= buyoutCost(G);
    G.over = { win: true, sol, reason: 'Kessa buys out its sponsor and declares independence. The colony no longer needs anyone\'s permission.' };
    G.over.score = score(G);
    log(G, G.over.reason, 'good'); fx(G, { k: 'over' });
    // the sponsor's answer to the declaration depends on how much it still trusts the colony
    const cf = G.conf === undefined ? 60 : G.conf, gift = cf >= 60 ? 1500 : cf >= 35 ? 0 : -1500; G.funds += gift; G.st.sponsorAnswer = gift;
    log(G, gift > 0 ? 'The sponsor accepts the declaration with grace and sends a parting grant of 1500.' : gift < 0 ? 'The sponsor takes the declaration badly and claws back 1500 funding in penalties.' : 'The sponsor accepts the declaration coldly. No more grants will come.', gift < 0 ? 'bad' : 'info');
  }
  // defeat
  const arkInFlight = G.rockets.some(r => r.st === 'out' && r.ark.length);
  if (!G.over && G.st.everColonists && pop === 0 && !arkInFlight) {
    G.flags.empty = (G.flags.empty || 0) + 1;
    if (G.flags.empty === 1) log(G, 'Kessa has no living colonists. The sponsor will recall the mission in 3 sols unless an ark is sent.', 'bad');
    if (G.flags.empty >= 3) lose(G, sol, 'The colony is empty. The sponsor has recalled the mission.');
  } else G.flags.empty = 0;
  if (!G.over && !G.st.everColonists) {
    const left = DF.patience - sol;
    if (left === 15 || left === 5) log(G, 'The sponsor expects colonists within ' + left + ' sols, or the mission will be recalled.', 'bad');
    if (left <= 0) lose(G, sol, 'No colonists arrived in time. The sponsor has recalled the mission.');
  }
}
function lose(G, sol, reason) { G.over = { win: false, sol, reason }; G.over.score = score(G); log(G, reason, 'bad'); fx(G, { k: 'over' }); }
Object.assign(KC, { FREE_GOALS, freeGoals, MILESTONES, checkMilestones, independence, score, techCount });
