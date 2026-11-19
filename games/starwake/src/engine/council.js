// ===== council.js : the Concord of Stars, a galactic council that votes on resolutions in the mid game =====
// It convenes in year 25. Every three years the chair (rotating, strongest voices first) puts one resolution to
// the vote; members have a year to vote, weighted by their voice, and may spend influence to rally support.
// Passed resolutions apply timed modifiers to every member (or to one censured empire) for their term.
var COUNCIL_START = DAYS_YEAR * 25, COUNCIL_EVERY = DAYS_YEAR * 3, COUNCIL_VOTE = DAYS_YEAR, RALLY_COST = 60;
// pref: how much each archetype likes it; ok: when it may be proposed; fx: modifiers for one member (or null)
var RESOLUTIONS = {
  open_archives: { name: 'Charter of Open Archives', years: 20, desc: 'Every member shares its libraries: +10% research.',
    pref: { scholarly: 2, isolationist: 0.6, mercantile: 0.8, expansionist: 0.3, militarist: -0.2, zealot: -0.6 }, fx: () => ({ 'research%': 10 }) },
  frontier_act: { name: 'Frontier Claims Act', years: 20, desc: 'Unclaimed stars are fair game: -25% outpost cost and +5% growth for every member.',
    pref: { expansionist: 2.2, zealot: 0.8, militarist: 0.4, mercantile: 0.2, scholarly: -0.2, isolationist: -1.2 }, fx: () => ({ 'outpostCost%': -25, 'growth%': 5 }) },
  armistice: { name: 'Armistice of the Lanes', years: 15, desc: 'War is made costly: warships cost 20% more, and every member gains +5 stability.',
    pref: { mercantile: 1.6, scholarly: 1.2, isolationist: 1.4, expansionist: 0.2, zealot: -1.2, militarist: -2.2 }, fx: () => ({ 'shipCost%': 20, 'stability+': 5 }) },
  shipwrights: { name: "Shipwrights' Covenant", years: 15, desc: 'Shared yards and standard parts: warships cost 15% less for every member.',
    pref: { militarist: 2, zealot: 1.2, expansionist: 0.4, isolationist: 0.3, mercantile: -0.6, scholarly: -0.8 }, fx: () => ({ 'shipCost%': -15 }) },
  market_concord: { name: 'Concord of the Markets', years: 20, desc: 'Open trade between members: +10% energy and +10% goods.',
    pref: { mercantile: 2.2, expansionist: 0.6, scholarly: 0.6, militarist: 0.2, zealot: 0.1, isolationist: -1 }, fx: () => ({ 'energy%': 10, 'goods%': 10 }) },
  sanctuary: { name: 'Sanctuary Rights', years: 20, desc: 'Every border is respected: +30% starbase strength and +2 planetary fortification.',
    pref: { isolationist: 2.4, scholarly: 0.8, mercantile: 0.6, expansionist: -0.2, zealot: -0.8, militarist: -1.6 }, fx: () => ({ 'sbDef%': 30, 'fort+': 2 }) },
  colonial_aid: { name: 'Colonial Aid Fund', years: 15, desc: 'Members with fewer colonies than the median get +20% growth and +10% minerals; the others pay 5% of their energy into the fund.',
    pref: { isolationist: 0.6, scholarly: 0.4, mercantile: -0.4, expansionist: -1, militarist: -0.2, zealot: 0 },
    fx: (G, e) => colonies(G, e).length < medianColonies(G) ? { 'growth%': 20, 'minerals%': 10 } : { 'energy%': -5 } },
  beacon_watch: { name: 'Beacon Watch Accord', years: 25, desc: 'Members watch over the Wake Beacons: every Beacon vigil takes 3 years longer while it holds.',
    ok: G => (G.beacons || []).length > 0 && alive(G).some(x => beaconsOwned(G, x) >= 2 || x.beaconDays > 0),
    pref: { militarist: 0.4, mercantile: 0.6, expansionist: 0.4, scholarly: -0.4, isolationist: 0.2, zealot: 0.2 }, fx: () => null },
  censure: { name: 'Censure', years: 12, desc: 'The council censures the strongest empire: -2 influence per month and -10% research for it.',
    ok: G => alive(G).length >= 4, target: G => alive(G).slice().sort((a, b) => scoreOf(G, b).total - scoreOf(G, a).total)[0],
    pref: { militarist: 0.4, zealot: 0.4, expansionist: 0.2, mercantile: 0.2, scholarly: 0.2, isolationist: 0.4 },
    fx: (G, e, c) => e.id === c.target ? { 'influence+': -2, 'research%': -10 } : null },
  choir_pact: { name: 'Pact against the Choir', years: 15, desc: 'Every member pools its fleets against the Hollow Choir: +10% weapon damage and +10% hull.',
    ok: G => G.crisis.stage === 2, pref: { militarist: 2, zealot: 2, expansionist: 2, mercantile: 2, scholarly: 2, isolationist: 2 }, fx: () => ({ 'fleetDmg%': 10, 'hull%': 10 }) },
};
var RESOLUTION_KEYS = Object.keys(RESOLUTIONS);
function medianColonies(G) { const n = alive(G).map(e => colonies(G, e).length).sort((a, b) => a - b); return n.length ? n[n.length >> 1] : 0; }
// voice: a member's votes count by its size; rallying support adds half again
function councilVoice(G, e) { return 1 + Math.floor(colonies(G, e).length / 4) + Math.floor(totalPops(G, e) / 150); }
SW.councilVoice = councilVoice;
function resolutionTitle(G, c) { const R = RESOLUTIONS[c.k]; return c.k === 'censure' && G.empires[c.target] ? `${R.name} of the ${G.empires[c.target].name}` : R.name; }
SW.resolutionTitle = resolutionTitle;
function resolutionActive(G, k) { return !!(G.council && G.council.active.some(a => a.k === k && a.until > G.day)); }
SW.resolutionActive = resolutionActive;
function eligibleResolutions(G) { return RESOLUTION_KEYS.filter(k => !resolutionActive(G, k) && (!RESOLUTIONS[k].ok || RESOLUTIONS[k].ok(G))); }
// how much an AI member wants a resolution: archetype taste plus its own situation
function aiResolutionScore(G, e, c) {
  const R = RESOLUTIONS[c.k]; let s = (R.pref[e.persona] || 0) * 1.0;
  if (c.k === 'censure') s += e.id === c.target ? -6 : (atWar(G, e.id, c.target) ? 2 : 0) - opinion(G, e.id, c.target).total / 60;
  if (c.k === 'beacon_watch') s += e.beaconDays > 0 || beaconsOwned(G, e) >= 2 ? -5 : 1.4;
  if (c.k === 'colonial_aid') s += colonies(G, e).length < medianColonies(G) ? 2 : -0.8;
  if (c.k === 'armistice' || c.k === 'shipwrights') s += (warsOf(G, e.id).length ? (c.k === 'armistice' ? 0.8 : 1) : 0);
  const chair = G.empires[G.council.chair];
  if (chair && chair.id !== e.id && chair.alive) s += opinion(G, e.id, chair.id).total / 100;
  return s;
}
function councilMonthly(G) {
  const C = G.council;
  if (!C) {
    if (G.day < COUNCIL_START || alive(G).length < 3) return;
    G.council = { formed: G.day, chair: -1, next: G.day + DAYS_MONTH * 6, cur: null, active: [], log: [], order: 0 };
    log(G, -1, 'The Concord of Stars has convened: every empire now has a seat and a voice. Resolutions will be put to the vote every three years.', -1, 'major');
    for (const e of alive(G)) startEvent(G, e, 'council_formed', {});
    return;
  }
  C.active = C.active.filter(a => a.until > G.day);
  if (C.cur && G.day >= C.cur.until) tallyResolution(G);
  if (!C.cur && G.day >= C.next) {
    // the chair passes in turn to the empire with the loudest voice that has not chaired recently
    const ms = alive(G).slice().sort((a, b) => councilVoice(G, b) - councilVoice(G, a) || a.id - b.id);
    const chair = ms[C.order % ms.length]; C.order++; C.chair = chair.id; C.next = G.day + COUNCIL_EVERY;
    const pool = eligibleResolutions(G); if (!pool.length) return;
    const choices = []; const bag = pool.slice();
    while (choices.length < 3 && bag.length) choices.push(bag.splice(Math.floor(rnd(G) * bag.length), 1)[0]);
    if (!chair.ai) { startEvent(G, chair, 'council_chair', { choices }); return; }
    const opts = choices.map(k => mkResolution(G, k));
    let best = opts[0], bs = -1e9; for (const c of opts) { const s = aiResolutionScore(G, chair, c) + rnd(G) * 0.6; if (s > bs) { bs = s; best = c; } }
    proposeResolution(G, chair, best);
  }
}
function mkResolution(G, k) { const R = RESOLUTIONS[k], c = { k }; if (R.target) { const t = R.target(G); c.target = t ? t.id : -1; } return c; }
function proposeResolution(G, chair, c) {
  const C = G.council;
  C.cur = Object.assign(c, { by: chair.id, at: G.day, until: G.day + COUNCIL_VOTE, votes: {}, rally: {} });
  C.cur.votes[chair.id] = 1;
  for (const e of alive(G)) if (e.ai && e.id !== chair.id) { const s = aiResolutionScore(G, e, C.cur); C.cur.votes[e.id] = s > 0.35 ? 1 : s < -0.35 ? -1 : 0; if (Math.abs(s) > 2.2 && e.res.influence > RALLY_COST + 120) { C.cur.rally[e.id] = 1; addResource(G, e, 'influence', -RALLY_COST); } }
  log(G, -1, `${chair.name} put a resolution to the Concord: ${resolutionTitle(G, C.cur)}. Members vote within a year.`, -1, 'major');
}
SW.proposeResolution = (G, e, k) => { const C = G.council; if (!C || C.cur || C.chair !== e.id) return 'You do not hold the chair'; if (!eligibleResolutions(G).includes(k)) return 'That resolution cannot be proposed now'; proposeResolution(G, e, mkResolution(G, k)); return null; };
function councilTally(G) {
  const C = G.council, c = C && C.cur; if (!c) return null;
  let yes = 0, no = 0, abst = 0;
  for (const e of alive(G)) { const w = councilVoice(G, e) * (c.rally[e.id] ? 1.5 : 1), v = c.votes[e.id] || 0; if (v > 0) yes += w; else if (v < 0) no += w; else abst += w; }
  return { yes: Math.round(yes * 10) / 10, no: Math.round(no * 10) / 10, abst: Math.round(abst * 10) / 10 };
}
SW.councilTally = councilTally;
function tallyResolution(G) {
  const C = G.council, c = C.cur, t = councilTally(G), R = RESOLUTIONS[c.k];
  C.cur = null;
  const passed = t.yes > t.no;
  C.log.push({ k: c.k, target: c.target, by: c.by, at: G.day, passed, yes: t.yes, no: t.no });
  if (C.log.length > 12) C.log.shift();
  if (!passed) { log(G, -1, `The Concord rejected the ${resolutionTitle(G, c)} (${t.yes} for, ${t.no} against).`, -1, 'major'); return; }
  const until = G.day + DAYS_YEAR * R.years;
  C.active.push({ k: c.k, target: c.target, until });
  for (const e of alive(G)) { const m = R.fx(G, e, c); if (m) addTimed(G, e, 'Concord: ' + R.name, m, DAYS_YEAR * R.years); }
  log(G, -1, `The Concord passed the ${resolutionTitle(G, c)} (${t.yes} for, ${t.no} against). It holds until ${dateStr(until)}.`, -1, 'major');
}
SW.councilVote = (G, e, v) => { const c = G.council && G.council.cur; if (!c) return 'No resolution is before the council'; c.votes[e.id] = v; return null; };
SW.councilRally = (G, e) => { const c = G.council && G.council.cur; if (!c) return 'No resolution is before the council'; if (c.rally[e.id]) return 'You already rallied support'; if (e.res.influence < RALLY_COST) return `Needs ${RALLY_COST} influence`; addResource(G, e, 'influence', -RALLY_COST); c.rally[e.id] = 1; return null; };
SW.RALLY_COST = RALLY_COST; SW.RESOLUTIONS = RESOLUTIONS;
// beacon vigils are longer while the Beacon Watch Accord holds
function beaconWatchYears(G) { return resolutionActive(G, 'beacon_watch') ? 3 : 0; }
EVENTS.council_formed = { title: 'The Concord of Stars', art: 'council',
  text: (G, e) => `Envoys of every known people have gathered in a hall of glass built in neutral space. They call it the Concord of Stars. Every three years one member takes the chair and puts a resolution to the vote; votes are weighed by each empire's size, and influence can rally waverers. What passes binds us all.`,
  opts: () => [{ t: 'Take our seat', ai: 1, fx: () => {} }] };
EVENTS.council_chair = { title: 'The Chair Is Ours', art: 'council',
  text: (G, e, c) => `It is our turn to hold the chair of the Concord. We may put one resolution before the members; they will have a year to vote.`,
  opts: (G, e, c) => c.choices.map(k => { const x = mkResolution(G, k); return { t: `Propose the ${resolutionTitle(G, x)}: ${RESOLUTIONS[k].desc}`, ai: 1, fx: (G2, e2) => { if (!G2.council.cur) proposeResolution(G2, e2, x); } }; }).concat([{ t: 'Pass the gavel without a proposal', ai: 0, fx: () => {} }]) };
