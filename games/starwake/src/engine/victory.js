// ===== victory.js : score, history, victory conditions =====
var VICTORY_TYPES = {
  conquest: { name: 'Conquest', desc: 'Be the last empire standing, or hold the homeworlds of more than half of all empires (your own included) for 5 unbroken years (3 after the Convergence).' },
  beacon: { name: 'Wake Beacons', desc: 'Research Wakefield Theory, then hold 3 Wake Beacon systems, each with a Keep or better starbase, for 15 unbroken years (longer for a vigil begun before year 80: half a year more for each year earlier). During the Convergence two Beacons are enough, and three need only 9 years. Beacon Keeps do not count against starbase capacity.' },
  score: { name: 'Score', desc: 'Have the highest score when the final year arrives.' },
  defeat: { name: 'Defeat', desc: 'Your empire has fallen.' },
};
var BEACON_NEED = 3, BEACON_DAYS = DAYS_YEAR * 15;
// a Beacon counts once you own its system and have raised a Keep (or better) there
// The Convergence (last quarter of the game) and the Resonance Spire shorten the vigil
// During the Convergence two attuned Beacons start a vigil; three make it 40% shorter
function beaconNeed(G) { return G && G.convergence ? BEACON_NEED - 1 : BEACON_NEED; }
function convergenceDay(G) { return Math.floor(G.endDay * 0.65 / DAYS_MONTH) * DAYS_MONTH; }
SW.beaconNeed = beaconNeed; SW.convergenceDay = convergenceDay;
function beaconDaysFor(e, G, n) {
  let d = e.perks && e.perks.includes('wake_resonance') ? DAYS_YEAR * 10 : BEACON_DAYS;
  if (e.projects && e.projects.resonance_spire && e.projects.resonance_spire.done) d -= DAYS_YEAR * 3;
  if (n == null) n = beaconsHeld(G, e);
  if (G && G.convergence && n >= BEACON_NEED) d = Math.round(d * 0.6 / DAYS_MONTH) * DAYS_MONTH;
  if (G) {
    // a young galaxy resists waking: a vigil begun before year 80 runs half a year longer for each year earlier
    const start = e.beaconDays > 0 && e.beaconStart != null ? e.beaconStart : G.day;
    d += Math.round(Math.max(0, DAYS_YEAR * 80 - start) * 0.5 / DAYS_MONTH) * DAYS_MONTH;
    d += beaconWatchYears(G) * DAYS_YEAR;
  }
  return d;
}
function dominionDays(G) { return DAYS_YEAR * (G.convergence ? 3 : 5); }
SW.dominionDays = dominionDays;
SW.beaconDaysFor = beaconDaysFor;
function beaconsHeld(G, e) { const spire = e.projects && e.projects.resonance_spire && e.projects.resonance_spire.done; return (G.beacons || []).filter(sid => G.systems[sid].owner === e.id && (spire || (G.systems[sid].sb && G.systems[sid].sb.lvl >= 1))).length; }
function beaconsOwned(G, e) { return (G.beacons || []).filter(sid => G.systems[sid].owner === e.id).length; }
SW.beaconsOwned = beaconsOwned;
SW.beaconsHeld = beaconsHeld;
function homeworldsNeeded(G) { return Math.floor(majors(G).length / 2) + 1; }
function homeworldsHeld(G, e) { return G.planets.filter(p => p.home && p.col && p.col.owner === e.id).length; }
SW.homeworldsNeeded = homeworldsNeeded; SW.homeworldsHeld = homeworldsHeld;
function scoreOf(G, e) {
  if (e.kind !== 'major') return 0;
  const pops = totalPops(G, e), sys = ownedSystems(G, e).length, tr = tradPicks(e);
  const parts = [['Pops', Math.round(pops * 1.2)], ['Systems', sys], ['Technology', e.stats.techs * 5], ['Traditions', tr * 5], ['Fleet strength', Math.round(empirePower(G, e) / 80)],
    ['Conquests', e.stats.planetsTaken * 3], ['Wake Beacons', beaconsHeld(G, e) * 20], ['Great projects', Object.values(e.projects || {}).filter(p => p.done).length * 40], ['Against the Choir', Math.round(e.stats.crisisKills * 0.6) + (e.flags.lightbringer ? 100 : 0)]];
  return { total: Math.round(sum(parts, p => p[1])), parts };
}
SW.scoreOf = scoreOf;
function recordHistory(G) {
  const row = { d: G.day, s: {} };
  for (const e of majors(G)) {
    if (!e.alive) { row.s[e.id] = [0, 0, 0, 0, 0]; continue; }
    const net = empireEcon(G, e).net;
    row.s[e.id] = [scoreOf(G, e).total, totalPops(G, e), ownedSystems(G, e).length, empirePower(G, e), Math.round((net.lumen || 0) + (net.vita || 0) + (net.forge || 0))];
  }
  G.hist.push(row);
}
SW.recordHistory = recordHistory;
function setWinner(G, e, type) {
  if (G.over) return;
  G.over = true; G.winner = { e: e ? e.id : -1, type, day: G.day };
  recordHistory(G);
  log(G, -1, e ? `${e.name} has won a ${VICTORY_TYPES[type].name} victory!` : 'The game has ended.', -1, 'major');
}
function checkVictory(G) {
  if (G.over) return;
  const es = alive(G);
  const human = G.empires.find(e => e.kind === 'major' && !e.ai);
  if (human && !human.alive) { G.over = true; G.winner = { e: -1, type: 'defeat', day: G.day }; recordHistory(G); return; }
  // beacons
  for (const e of es) {
    const n = beaconsHeld(G, e);
    if (n >= beaconNeed(G) && e.techs.wakefield) {
      const need = beaconDaysFor(e, G, n);
      if (!e.beaconDays) e.beaconStart = G.day;
      if (!e.beaconDays) log(G, -1, `${e.name} has attuned ${n} Wake Beacons. In ${Math.round(need / DAYS_YEAR)} years they will wake the starlanes and win.`, -1, 'major');
      e.beaconDays += DAYS_MONTH;
      if (e.beaconDays % (DAYS_YEAR * 2) === 0 && e.beaconDays < need) log(G, -1, `${e.name}: ${Math.round((need - e.beaconDays) / DAYS_YEAR)} years until the Beacons wake.`, -1, 'major');
      if (e.beaconDays >= need) return setWinner(G, e, 'beacon');
    } else if (e.beaconDays) { e.beaconDays = 0; log(G, -1, `${e.name} has lost control of the Wake Beacons.`, -1, 'major'); }
  }
  // conquest
  if (es.length === 1 && majors(G).length > 1) return setWinner(G, es[0], 'conquest');
  const need = homeworldsNeeded(G);
  for (const e of es) {
    if (homeworldsHeld(G, e) >= need) {
      if (!e.domDays) log(G, -1, `${e.name} holds ${need} homeworlds. In ${dominionDays(G) / DAYS_YEAR} years their dominion will be complete.`, -1, 'major');
      e.domDays = (e.domDays || 0) + DAYS_MONTH;
      if (e.domDays >= dominionDays(G)) return setWinner(G, e, 'conquest');
    } else if (e.domDays) { e.domDays = 0; log(G, -1, `${e.name} no longer holds enough homeworlds for dominion.`, -1, 'major'); }
  }
  if (!es.length) return setWinner(G, null, 'score');
  // the Convergence: in the last quarter the Beacons flare and every claim to victory hurries
  if (!G.convergence && G.day >= convergenceDay(G)) {
    G.convergence = G.day;
    log(G, -1, 'The Convergence has begun: the Wake Beacons burn bright. Two attuned Beacons now start a vigil, three finish it far sooner, and dominions take only 3 years.', -1, 'major');
    for (const e of es) startEvent(G, e, 'convergence', {});
  }
  // time
  if (G.day >= G.endDay) {
    const best = es.slice().sort((a, b) => scoreOf(G, b).total - scoreOf(G, a).total)[0];
    return setWinner(G, best, 'score');
  }
}
SW.checkVictory = checkVictory;
