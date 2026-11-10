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
  independence: { name: 'Independence', desc: 'Declare an independent Kessa.', grant: 0, score: 1000 },
};
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
    { k: 'self', name: 'Five sols with no shortages and no imported food, parts or metals', have: okSols ? 5 : Math.min(5, countSelf(G)), need: 5, ok: okSols },
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
  const mult = { easy: 0.8, normal: 1, hard: 1.4 }[G.cfg.difficulty] * (G.cfg.sponsor === 'pilgrim' ? 1.3 : 1);
  if (G.over && G.over.win) s += Math.max(500, 4000 - G.over.sol * 15);
  return Math.max(0, Math.round(s * mult));
}
function solStep(G) {
  const sol = solOf(G.tick) - 1; // the sol that just ended
  const SP = SPONSORS[G.cfg.sponsor], DF = DIFFICULTY[G.cfg.difficulty];
  // stipend plus a settlement grant for every colonist living on Kessa
  const stip = Math.round((SP.stipend + 1.5 * G.colonists.length) * DF.funds * (1 + M(G, 'funding')));
  G.funds += stip;
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
  // independence
  if (!G.over && independence(G).every(c => c.ok)) {
    G.ms.independence = sol;
    G.over = { win: true, sol, reason: 'Kessa declares independence. The colony no longer needs its sponsor.' };
    G.over.score = score(G);
    log(G, G.over.reason, 'good'); fx(G, { k: 'over' });
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
Object.assign(KC, { MILESTONES, checkMilestones, independence, score, techCount });
