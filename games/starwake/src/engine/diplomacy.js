// ===== diplomacy.js : contact, opinion, treaties, war, war exhaustion, peace =====
var TREATIES = {
  nap: { name: 'Non-Aggression Pact', desc: 'Neither side may declare war without breaking the pact. +10 opinion.' },
  research: { name: 'Research Agreement', desc: '+5% research for both (+10% if they know more than you).' },
  trade: { name: 'Trade Pact', desc: 'Both gain energy each month, more for larger partners.' },
  alliance: { name: 'Defensive Alliance', desc: 'Each joins the other’s defensive wars.' },
};
var WAR_GOALS = {
  conquest: { name: 'Conquest', desc: 'If they yield, they cede up to three border systems, planets included.' },
  humiliate: { name: 'Humiliation', desc: 'If they yield, they lose influence and stability; you gain influence and a triumph.' },
  plunder: { name: 'Plunder', desc: 'If they yield, they hand over 40% of their energy, minerals and alloys.' },
};
function rel(G, a, b) {
  const A = G.empires[a]; let r = A.rel[b];
  if (!r) r = A.rel[b] = { contact: -1, treaties: {}, op: [], truce: 0, ask: 0 };
  return r;
}
SW.rel = rel;
function hasContact(G, a, b) { const r = G.empires[a].rel[b]; return !!(r && r.contact >= 0); }
SW.hasContact = hasContact;
function meet(G, a, b) {
  if (a === b) return;
  const A = G.empires[a], B = G.empires[b];
  if (A.kind !== 'major' || B.kind !== 'major' || !A.alive || !B.alive) return;
  if (hasContact(G, a, b)) return;
  rel(G, a, b).contact = G.day; rel(G, b, a).contact = G.day;
  for (const [x, y] of [[A, B], [B, A]]) {
    if (!x.ai) { log(G, x.id, `First contact with the ${y.name}.`, G.planets[y.capital] ? G.planets[y.capital].sys : -1, 'major'); startEvent(G, x, 'first_contact', { other: y.id }); }
    // contact reveals the other capital
    if (y.capital >= 0) x.known[G.planets[y.capital].sys] = 1;
  }
}
SW.meet = meet;
function warKeyCache(G) {
  if (!G._wp) { G._wp = new Set(); for (const w of G.wars) for (const a of w.att) for (const b of w.def) { G._wp.add(a + ',' + b); G._wp.add(b + ',' + a); } }
  return G._wp;
}
function atWar(G, a, b) { return warKeyCache(G).has(a + ',' + b); }
SW.atWar = atWar;
function warBetween(G, a, b) { return G.wars.find(w => (w.att.includes(a) && w.def.includes(b)) || (w.def.includes(a) && w.att.includes(b))); }
SW.warBetween = warBetween;
function warsOf(G, a) { return G.wars.filter(w => w.att.includes(a) || w.def.includes(a)); }
SW.warsOf = warsOf;
function sideOf(w, a) { return w.att.includes(a) ? 'att' : w.def.includes(a) ? 'def' : null; }
function warExhaustionOf(G, a) { let x = 0; for (const w of G.wars) { const s = sideOf(w, a); if (s) x = Math.max(x, w.exh[s]); } return x; }
SW.warExhaustionOf = warExhaustionOf;
function addExhaustion(G, loser, winner, v) {
  const w = warBetween(G, loser, winner); if (!w) return;
  const s = sideOf(w, loser), L = G.empires[loser];
  w.exh[s] = Math.min(100, w.exh[s] + v * (1 + mv(empMods(G, L), 'exhaust%') / 100) * (G.cfg.size === 'small' ? 1.2 : 1));
}
function bordering(G, a, b) {
  for (const sid of ownedSystems(G, G.empires[a])) for (const w of G.systems[sid].lanes) if (G.systems[w].owner === b) return true;
  return false;
}
SW.bordering = bordering;
function addOpinion(G, e, towards, k, v, days) {
  const r = rel(G, e.id, towards); const old = r.op.find(x => x.k === k);
  if (old) { old.v = Math.max(-100, Math.min(100, old.v + v)); old.until = G.day + days; } else r.op.push({ k, v, until: G.day + days });
}
SW.addOpinion = addOpinion;
// a's opinion of b, with reasons
function opinion(G, a, b) {
  const A = G.empires[a], B = G.empires[b], parts = [];
  const add = (k, v) => { if (v) parts.push([k, Math.round(v)]); };
  add('Their reputation', mv(empMods(G, B), 'opinion+'));
  for (const x of A.ethos) { if (B.ethos.includes(x)) add('Shared ethos: ' + ETHOS[x].name, 15); if (B.ethos.includes(ETHOS[x].opp)) add('Opposed ethos: ' + ETHOS[ETHOS[x].opp].name, -15); }
  if (A.persona === 'zealot' && !B.ethos.includes('zealous') && !B.ethos.includes('devout')) add('Unbelievers', -15);
  if (A.persona === 'isolationist') add('Distrust of outsiders', -10);
  if (bordering(G, a, b)) add('Border friction', A.persona === 'expansionist' || A.persona === 'militarist' ? -20 : -10);
  const r = A.rel[b];
  if (r) {
    if (r.treaties.nap) add('Non-aggression pact', 10);
    if (r.treaties.research) add('Research agreement', 10);
    if (r.treaties.trade) add('Trade pact', A.ethos.includes('mercantile') ? 20 : 12);
    if (r.treaties.alliance) add('Alliance', 30);
    if (r.truce > G.day) add('Recent war', -20);
    for (const o of r.op) if (o.until > G.day) add(o.k, o.v * Math.min(1, (o.until - G.day) / 1800 + 0.3));
  }
  if (atWar(G, a, b)) add('At war', -80);
  // common enemies bring empires together
  if (warsOf(G, a).some(w => { const s = sideOf(w, a); const enemies = s === 'att' ? w.def : w.att; return enemies.some(x => x !== b && atWar(G, b, x)); })) add('Common enemy', 25);
  const total = sum(parts, p => p[1]);
  return { total, parts };
}
SW.opinion = opinion;
function attitude(v) { return v >= 50 ? 'Friendly' : v >= 15 ? 'Cordial' : v > -15 ? 'Neutral' : v > -50 ? 'Wary' : 'Hostile'; }
SW.attitude = attitude;

// ---------- treaties ----------
function treatyCost(k) { return k === 'alliance' ? 50 : 25; }
SW.treatyCost = treatyCost;
// will b accept treaty k proposed by a? returns {ok, score, parts}
function evalTreaty(G, a, b, k) {
  const B = G.empires[b], A = G.empires[a];
  const op = opinion(G, b, a), parts = [['Opinion', op.total]];
  const P = B.persona ? PERSONAS[B.persona] : PERSONAS.mercantile;
  if (k === 'nap') { parts.push(['Base', 10]); if (P.war > 1.2 && bordering(G, a, b) && empirePower(G, A) < empirePower(G, B) * 0.8) parts.push(['They see you as prey', -30]); }
  if (k === 'research') { parts.push(['Base', -5]); const d = A.stats.techs - B.stats.techs; if (d < -8) parts.push(['You lag behind them', d]); if (d > 4) parts.push(['You know more', 10]); }
  if (k === 'trade') { parts.push(['Base', B.ethos.includes('mercantile') ? 25 : 10]); }
  if (k === 'alliance') { parts.push(['Base', -40]); if (!rel(G, b, a).treaties.nap) parts.push(['No non-aggression pact', -15]); }
  parts.push(['Their temperament', Math.round((P.treaty - 1) * 30)]);
  if (atWar(G, a, b)) parts.push(['At war', -1000]);
  if (rel(G, b, a).truce > G.day && k === 'alliance') parts.push(['Recent war', -30]);
  if (B.res.influence < treatyCost(k) * 0.5) parts.push(['They lack influence', -20]);
  const score = sum(parts, p => p[1]);
  return { ok: score >= 0, score, parts };
}
SW.evalTreaty = evalTreaty;
function canPropose(G, a, b, k) {
  if (!TREATIES[k]) return 'Unknown treaty';
  if (!hasContact(G, a, b)) return 'No contact';
  if (atWar(G, a, b)) return 'You are at war';
  if (rel(G, a, b).treaties[k]) return 'Already signed';
  if (G.empires[a].res.influence < treatyCost(k)) return 'Needs ' + treatyCost(k) + ' influence';
  if ((rel(G, a, b).ask || 0) > G.day) return 'They will not hear another proposal yet';
  return null;
}
SW.canPropose = canPropose;
function signTreaty(G, a, b, k) {
  rel(G, a, b).treaties[k] = 1; rel(G, b, a).treaties[k] = 1;
  G.empires[a].res.influence -= treatyCost(k); G.empires[b].res.influence = Math.max(0, G.empires[b].res.influence - treatyCost(k) * 0.5);
  dirty(G.empires[a]); dirty(G.empires[b]);
  const A = G.empires[a], B = G.empires[b];
  log(G, a, `${TREATIES[k].name} signed with the ${B.name}.`, -1, 'diplo'); log(G, b, `${TREATIES[k].name} signed with the ${A.name}.`, -1, 'diplo');
}
function propose(G, a, b, k) {
  const err = canPropose(G, a, b, k); if (err) return { ok: false, err };
  const B = G.empires[b];
  if (!B.ai) return { ok: false, err: 'They decide for themselves' };
  const ev = evalTreaty(G, a, b, k);
  if (ev.ok) { signTreaty(G, a, b, k); return { ok: true }; }
  rel(G, a, b).ask = G.day + 90;
  return { ok: false, err: 'They declined', ev };
}
SW.propose = propose; SW.signTreaty = signTreaty;
function cancelTreaty(G, a, b, k) {
  if (!rel(G, a, b).treaties[k]) return 'No such treaty';
  delete rel(G, a, b).treaties[k]; delete rel(G, b, a).treaties[k];
  addOpinion(G, G.empires[b], a, 'Cancelled a treaty', -15, 1800);
  dirty(G.empires[a]); dirty(G.empires[b]);
  log(G, a, `${TREATIES[k].name} with the ${G.empires[b].name} cancelled.`, -1, 'diplo'); log(G, b, `The ${G.empires[a].name} cancelled our ${TREATIES[k].name}.`, -1, 'diplo');
  return null;
}
SW.cancelTreaty = cancelTreaty;
function giftCost() { return { energy: 100 }; }
function sendGift(G, a, b) {
  const A = G.empires[a]; if (A.res.energy < 100) return 'Needs 100 energy';
  A.res.energy -= 100; G.empires[b].res.energy += 100; addOpinion(G, G.empires[b], a, 'Gifts', 15, 2400); log(G, a, `Gift sent to the ${G.empires[b].name}.`, -1, 'diplo'); return null;
}
function insult(G, a, b) {
  addOpinion(G, G.empires[b], a, 'Insulted us', -40, 3600); G.empires[a].res.influence += 10;
  log(G, a, `We insulted the ${G.empires[b].name}. (+10 influence)`, -1, 'diplo'); log(G, b, `The ${G.empires[a].name} has insulted us!`, -1, 'diplo'); return null;
}
SW.sendGift = sendGift; SW.insult = insult;
function researchAgreementBonus(G, e) {
  let b = 0; for (const k in e.rel) if (e.rel[k].treaties && e.rel[k].treaties.research) { const o = G.empires[k]; if (!o || !o.alive) continue; b += o.stats.techs > e.stats.techs ? 0.1 : 0.05; }
  return Math.min(0.3, b);
}

// ---------- war ----------
var WAR_INFLUENCE = 25;
function canDeclare(G, a, b) {
  const A = G.empires[a], B = G.empires[b];
  if (!B || B.kind !== 'major' || !B.alive) return 'Invalid target';
  if (!hasContact(G, a, b)) return 'No contact';
  if (atWar(G, a, b)) return 'Already at war';
  if (rel(G, a, b).truce > G.day) return 'Truce until ' + dateStr(rel(G, a, b).truce);
  if (rel(G, a, b).treaties.alliance) return 'You are allied';
  if (A.res.influence < WAR_INFLUENCE) return 'Needs ' + WAR_INFLUENCE + ' influence';
  return null;
}
SW.canDeclare = canDeclare;
function declareWar(G, a, b, goal) {
  const err = canDeclare(G, a, b); if (err) return err;
  if (!WAR_GOALS[goal]) goal = 'conquest';
  const A = G.empires[a], B = G.empires[b];
  A.res.influence -= WAR_INFLUENCE;
  if (rel(G, a, b).treaties.nap) {
    delete rel(G, a, b).treaties.nap; delete rel(G, b, a).treaties.nap;
    for (const e of alive(G)) if (e.id !== a) addOpinion(G, e, a, 'Broke a pact', e.id === b ? -60 : -20, 3600);
  }
  for (const k of ['trade', 'research']) { delete rel(G, a, b).treaties[k]; delete rel(G, b, a).treaties[k]; }
  const w = { id: nextId(G, 'war'), att: [a], def: [b], goal, lead: [a, b], start: G.day, exh: { att: 0, def: 0 }, name: `${A.adj}-${B.adj} War` };
  // defensive allies join
  for (const e of alive(G)) if (e.id !== a && e.id !== b && rel(G, b, e.id).treaties.alliance && !rel(G, e.id, a).treaties.alliance) { w.def.push(e.id); }
  G.wars.push(w); G._wp = null;
  for (const x of w.att) for (const y of w.def) { delete rel(G, x, y).treaties.nap; delete rel(G, y, x).treaties.nap; dirty(G.empires[x]); dirty(G.empires[y]); }
  log(G, -1, `The ${A.name} has declared war on the ${B.name} (${WAR_GOALS[goal].name}).`, G.planets[B.capital] ? G.planets[B.capital].sys : -1, 'war');
  if (w.def.length > 1) log(G, -1, `${w.def.slice(1).map(x => G.empires[x].name).join(', ')} joined the war to defend their ally.`, -1, 'war');
  if (!B.ai) startEvent(G, B, 'war_declared', { other: a, goal });
  return null;
}
SW.declareWar = declareWar;
// peace evaluation. terms: 'status' | 'surrender' (they yield to us) | 'concede' (we yield)
function evalPeace(G, a, w, terms) {
  const as = sideOf(w, a), bs = as === 'att' ? 'def' : 'att';
  const other = as === 'att' ? w.def : w.att;
  const pow = side => sum(side, x => empirePower(G, G.empires[x]) + 1);
  const myP = pow(as === 'att' ? w.att : w.def), thP = pow(other);
  const parts = [];
  const exT = w.exh[bs], exM = w.exh[as];
  const years = (G.day - w.start) / DAYS_YEAR;
  if (terms === 'concede') return { ok: true, parts: [['They accept your surrender', 100]] };
  if (terms === 'status') {
    parts.push(['Their war exhaustion', Math.round(exT * 0.9)]);
    parts.push(['Your war exhaustion', -Math.round(exM * 0.4)]);
    parts.push(['Balance of power', Math.round(clamp((myP / thP - 1) * 30, -40, 40))]);
    parts.push(['War length', Math.round(Math.min(30, years * 3))]);
    parts.push(['Base', -25]);
  } else {
    parts.push(['Their war exhaustion', Math.round(exT * 1.0)]);
    parts.push(['Your war exhaustion', -Math.round(exM * 0.6)]);
    parts.push(['Balance of power', Math.round(clamp((myP / thP - 1) * 30, -50, 50))]);
    parts.push(['Base', -60]);
  }
  if (exT >= 100) parts.push(['They are exhausted', 100]);
  const score = sum(parts, p => p[1]);
  return { ok: score >= 0, score, parts };
}
SW.evalPeace = evalPeace;
function proposePeace(G, a, w, terms) {
  const as = sideOf(w, a); if (!as) return { ok: false, err: 'Not in this war' };
  const otherLead = as === 'att' ? w.lead[1] : w.lead[0];
  const O = G.empires[otherLead];
  if (!O.ai) return { ok: false, err: 'They decide for themselves' };
  const ev = evalPeace(G, a, w, terms);
  if (!ev.ok) return { ok: false, err: 'They refused', ev };
  endWar(G, w, terms === 'status' ? 'status' : 'win', terms === 'surrender' ? as : terms === 'concede' ? (as === 'att' ? 'def' : 'att') : null);
  return { ok: true };
}
SW.proposePeace = proposePeace;
function endWar(G, w, outcome, winnerSide) {
  const i = G.wars.indexOf(w); if (i < 0) return;
  G.wars.splice(i, 1); G._wp = null;
  const all = w.att.concat(w.def);
  for (const x of all) for (const y of all) if (x !== y && sideOf(w, x) !== sideOf(w, y)) rel(G, x, y).truce = G.day + DAYS_YEAR * 8;
  for (const x of all) dirty(G.empires[x]);
  const lead = w.lead.map(x => G.empires[x]);
  if (outcome === 'win' && winnerSide) {
    const W = winnerSide === 'att' ? lead[0] : lead[1], L = winnerSide === 'att' ? lead[1] : lead[0];
    const goal = winnerSide === 'att' ? w.goal : 'humiliate';
    applyWarGoal(G, W, L, goal);
    log(G, -1, `The ${w.name} is over: the ${L.name} yielded to the ${W.name} (${WAR_GOALS[goal].name}).`, -1, 'peace');
  } else log(G, -1, `The ${w.name} ended in a white peace.`, -1, 'peace');
}
SW.endWar = endWar;
function applyWarGoal(G, W, L, goal) {
  if (!W.alive || !L.alive) return;
  if (goal === 'humiliate') {
    const inf = Math.min(L.res.influence, 150); L.res.influence -= inf; W.res.influence += 100;
    addTimed(G, W, 'Triumph', { 'stability+': 5, 'unity%': 10 }, 3600); addTimed(G, L, 'Humiliated', { 'stability+': -10 }, 1800);
  } else if (goal === 'plunder') {
    for (const r of ['energy', 'minerals', 'alloys']) { const v = Math.floor(L.res[r] * 0.4); L.res[r] -= v; W.res[r] += v; }
  } else {
    // conquest: up to three of the loser's systems that border the winner (not the capital system)
    const capSys = L.capital >= 0 ? G.planets[L.capital].sys : -1;
    const cand = ownedSystems(G, L).filter(sid => sid !== capSys && G.systems[sid].lanes.some(w2 => G.systems[w2].owner === W.id));
    cand.sort((x, y) => G.systems[y].planets.filter(p => G.planets[p].col).length - G.systems[x].planets.filter(p => G.planets[p].col).length);
    for (const sid of cand.slice(0, 3)) cedeSystem(G, G.systems[sid], L, W);
  }
}
function cedeSystem(G, s, L, W) {
  for (const pid of s.planets) { const p = G.planets[pid]; if (p.col && p.col.owner === L.id) { transferPlanet(G, p, W.id, false); } }
  if (s.owner === L.id) { s.owner = W.id; if (s.sb) { s.sb.owner = W.id; s.sb.queue = []; s.sb.dis = 0; } updateOwnership(G); }
  checkElimination(G, L);
}
function diplomacyMonthly(G) {
  const es = alive(G);
  // contact through shared borders
  for (const e of es) for (const sid of ownedSystems(G, e)) { e.known[sid] = 1; for (const w of G.systems[sid].lanes) { e.known[w] = 1; const o = G.systems[w].owner; if (o >= 0 && o !== e.id && G.empires[o].kind === 'major' && !hasContact(G, e.id, o)) meet(G, e.id, o); } }
  for (const w of G.wars.slice()) {
    w.exh.att = Math.min(100, w.exh.att + 0.35); w.exh.def = Math.min(100, w.exh.def + 0.35);
    // occupied enemy colonies weigh on the defender
    if (w.exh.att >= 100 && w.exh.def >= 100) { endWar(G, w, 'status'); continue; }
    if (w.exh.att >= 100) { endWar(G, w, 'win', 'def'); continue; }
    if (w.exh.def >= 100) { endWar(G, w, 'win', 'att'); continue; }
  }
  for (const e of es) for (const k in e.rel) { const r = e.rel[k]; if (r.op.length) r.op = r.op.filter(o => o.until > G.day); }
}
