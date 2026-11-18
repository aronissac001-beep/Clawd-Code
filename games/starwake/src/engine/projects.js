// ===== projects.js : Great Projects, multi-stage works built at the capital (some unique in the galaxy) =====
var PROJECTS = {
  sun_lattice: { name: 'Sun Lattice', tech: 'zero_point', stages: 3, cost: { alloys: 250, minerals: 400 }, days: 300, mods: { 'energy%': 20, 'minerals%': 10 }, desc: 'A web of collectors woven around your home star. +20% energy, +10% minerals.' },
  echo_archive: { name: 'Archive of Echoes', tech: 'lattice_comp', stages: 3, cost: { alloys: 250, minerals: 350 }, days: 300, mods: { 'research%': 15, 'unity%': 10 }, desc: 'A vault that records every thought spoken near it. +15% research, +10% unity.' },
  halo_habitat: { name: 'Halo Habitat', tech: 'arcology', stages: 3, cost: { alloys: 300, minerals: 500 }, days: 360, mods: { 'growth%': 15 }, housing: 30, desc: 'A ring of cities circling your capital world. +30 housing and +3 building slots on the capital, +15% growth.' },
  wake_arch: { name: 'Wake Arch', tech: 'fold_drive', stages: 2, cost: { alloys: 300, minerals: 300 }, days: 300, mods: { 'speed%': 10 }, desc: 'Opens a permanent starlane from your capital to your farthest system, and +10% ship speed.' },
  skyward_bastion: { name: 'Skyward Bastion', tech: 'bastion_starbase', unique: true, stages: 3, cost: { alloys: 450, minerals: 300 }, days: 360, mods: { 'sbDef%': 50, 'naval+': 25, 'cmd+': 10 }, desc: 'Unique in the galaxy: a fortress shipyard. +50% starbase strength, +25 naval capacity, +10 fleet command.' },
  resonance_spire: { name: 'Resonance Spire', tech: 'wakefield', unique: true, stages: 3, cost: { alloys: 400, minerals: 400 }, days: 360, mods: {}, desc: 'Unique in the galaxy: your Beacons count as attuned without Keeps, and the Beacon vigil is 3 years shorter.' },
  silencing_bell: { name: 'Silencing Bell', tech: 'intercept', unique: true, crisis: true, stages: 2, cost: { alloys: 350, minerals: 250 }, days: 240, mods: { 'monsterDmg%': 75, 'hull%': 10 }, desc: 'Unique in the galaxy, only once the stars go dark: +75% damage against monsters and the Hollow Choir, +10% hull.' },
};
var PROJECT_KEYS = Object.keys(PROJECTS);
function projectTaken(G, k) { for (const e of G.empires) if (e.alive && e.projects && e.projects[k] && (e.projects[k].done || e.projects[k].active || e.projects[k].stage > 0)) return e; return null; }
function canProject(G, e, k) {
  const P = PROJECTS[k]; if (!P) return 'Unknown';
  const st = e.projects && e.projects[k];
  if (st && st.done) return 'Completed';
  if (!e.techs[P.tech]) return 'Requires ' + TECHS[P.tech].name;
  if (P.crisis && G.crisis.stage < 1) return 'Only once the stars go dark';
  if (P.unique) { const o = projectTaken(G, k); if (o && o !== e) return (o.projects[k].done ? 'Completed by ' : 'Under construction by ') + o.name; }
  if (e.capital < 0) return 'Needs a capital';
  if (st && st.active) return 'Under construction';
  if (Object.values(e.projects || {}).some(x => x.active)) return 'Another project is under construction';
  if (!canAfford(e, scaleCost(G, e, P.cost))) return 'Needs ' + costText0(scaleCost(G, e, P.cost));
  return null;
}
function costText0(c) { return Object.keys(c).map(r => c[r] + ' ' + RES_INFO[r].name.toLowerCase()).join(', '); }
// starts (or continues with) the next stage; each stage is paid when it begins
function startProject(G, e, k) {
  const err = canProject(G, e, k); if (err) return err;
  const P = PROJECTS[k]; e.projects = e.projects || {};
  const st = e.projects[k] || (e.projects[k] = { stage: 0, prog: 0, active: 0, done: 0 });
  pay(e, scaleCost(G, e, P.cost)); st.active = 1; st.prog = 0;
  if (st.stage === 0) log(G, P.unique ? -1 : e.id, P.unique ? `The ${e.name} has begun the ${P.name}.` : `Work begins on the ${P.name}.`, G.planets[e.capital] ? G.planets[e.capital].sys : -1, P.unique ? 'major' : 'build');
  return null;
}
function projectDays(G, e, k) { return buildDays(G, e, PROJECTS[k].days); }
function projectsDay(G) {
  for (const e of G.empires) {
    if (!e.projects || !e.alive) continue;
    for (const k in e.projects) {
      const st = e.projects[k]; if (!st.active) continue;
      st.prog++;
      if (st.prog < projectDays(G, e, k)) continue;
      st.active = 0; st.stage++; st.prog = 0;
      const P = PROJECTS[k];
      if (st.stage >= P.stages) { st.done = 1; dirty(e); completeProject(G, e, k); }
      else if (!e.ai) log(G, e.id, `${P.name}: stage ${st.stage} of ${P.stages} complete. Fund the next stage to continue.`, -1, 'build');
    }
  }
}
function completeProject(G, e, k) {
  const P = PROJECTS[k];
  log(G, P.unique ? -1 : e.id, P.unique ? `The ${e.name} has completed the ${P.name}!` : `${P.name} completed.`, G.planets[e.capital] ? G.planets[e.capital].sys : -1, P.unique ? 'major' : 'good');
  if (k === 'halo_habitat' && G.planets[e.capital]) G.planets[e.capital].ring = 1;
  if (k === 'wake_arch') {
    const cap = G.planets[e.capital]; if (!cap) return;
    const d = jumpDist(G, [cap.sys]);
    const far = ownedSystems(G, e).filter(sid => d[sid] >= 3 && !G.systems[cap.sys].lanes.includes(sid)).sort((a, b) => d[b] - d[a])[0];
    if (far != null) { G.systems[cap.sys].lanes.push(far); G.systems[far].lanes.push(cap.sys); G.folded = (G.folded || []).concat([[cap.sys, far]]); log(G, -1, `A Wake Arch now links ${G.systems[cap.sys].name} and ${G.systems[far].name}.`, cap.sys, 'major'); }
  }
}
function projectMods(e) { const m = {}; if (e.projects) for (const k in e.projects) if (e.projects[k].done) { const pm = PROJECTS[k].mods; for (const x in pm) m[x] = (m[x] || 0) + pm[x]; } return m; }
SW.canProject = canProject; SW.startProject = startProject; SW.projectDays = projectDays; SW.projectTaken = projectTaken;

// ===== first-decade goals for human players: a short checklist with small rewards =====
var GOALS = [
  { k: 'research', t: 'Pick a project in all three research streams', hint: 'Research → tap a card in Lumen, Vita and Forge', ok: (G, e) => RESEARCH.every(s => e.research[s].cur) || e.stats.techs >= 3, reward: { unity: 40 } },
  { k: 'survey', t: 'Survey 12 systems', hint: 'Surveyors explore on their own; send them toward unknown stars', ok: (G, e) => e.surv.filter(x => x).length >= 12, reward: { lumen: 80 } },
  { k: 'claim', t: 'Own 5 systems', hint: 'Tap a surveyed star next to your borders → Claim system', ok: (G, e) => ownedSystems(G, e).length >= 5, reward: { influence: 50 } },
  { k: 'capital', t: 'Build a district or building on your capital', hint: 'Outliner → your capital → + on a district', ok: (G, e) => { const p = G.planets[e.capital]; return p && p.col && (p.col.bld.length > 2 || Object.values(p.col.dist).reduce((a, b) => a + b, 0) > 9); }, reward: { energy: 120 } },
  { k: 'colony', t: 'Found a second colony', hint: 'Tap Colonize on a habitable world (green %)', ok: (G, e) => colonies(G, e).length >= 2, reward: { minerals: 250 } },
  { k: 'tradition', t: 'Adopt a tradition', hint: 'Empire → Traditions', ok: (G, e) => tradPicks(e) >= 1, reward: { influence: 30 } },
  { k: 'contact', t: 'Meet another empire', hint: 'Keep exploring; contact happens when your ships or borders meet theirs', ok: (G, e) => Object.keys(e.rel).some(x => e.rel[x].contact >= 0), reward: { influence: 30 } },
  { k: 'treaty', t: 'Sign a treaty', hint: 'Diplomacy → an empire → a proposal they would accept', ok: (G, e) => Object.keys(e.rel).some(x => Object.keys(e.rel[x].treaties || {}).some(t => e.rel[x].treaties[t])), reward: { energy: 150 } },
  { k: 'fleet', t: 'Command 10 warships', hint: 'Military → Shipyards → ×5', ok: (G, e) => G.fleets.filter(f => f.owner === e.id && f.kind === 'war').reduce((a, f) => a + f.ships.length, 0) >= 10, reward: { alloys: 120 } },
  { k: 'starbase', t: 'Add a starbase module or upgrade a starbase', hint: 'Tap your capital → Keep → add a module', ok: (G, e) => ownedSystems(G, e).some(sid => { const sb = G.systems[sid].sb; return sb && sb.owner === e.id && (sb.lvl >= 2 || sb.mods.length >= 3 || (sb.lvl >= 1 && sid !== (G.planets[e.capital] || {}).sys)); }), reward: { alloys: 100 } },
];
function goalsMonthly(G) {
  if (G.day > DAYS_YEAR * 12) return;
  for (const e of G.empires) {
    if (e.kind !== 'major' || e.ai || !e.alive) continue;
    e.goals = e.goals || {};
    for (const g of GOALS) if (!e.goals[g.k] && g.ok(G, e)) {
      e.goals[g.k] = G.day; for (const r in g.reward) addResource(G, e, r, g.reward[r]);
      log(G, e.id, `Goal reached: ${g.t}. Reward: ${Object.keys(g.reward).map(r => '+' + g.reward[r] + ' ' + RES_INFO[r].name.toLowerCase()).join(', ')}.`, -1, 'good');
    }
  }
}
SW.GOALS = GOALS;
