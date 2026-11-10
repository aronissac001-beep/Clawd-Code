// ===== economy.js : sponsor confidence, stipend taper, payroll, rising prices, contracts, purchases =====
const BUYOUT = { easy: 3000, normal: 6000, hard: 10000 };
const PAYROLL = { easy: 0.2, normal: 0.3, hard: 0.45 };
const TAPER_MIN = { easy: 0.6, normal: 0.5, hard: 0.4 };
function confMult(G) { return 0.4 + clamp(G.conf === undefined ? 60 : G.conf, 0, 100) / 100; }
function addConf(G, d, why) {
  const before = G.conf; G.conf = clamp(Math.round((G.conf + d) * 10) / 10, 0, 100);
  if (why && Math.abs(d) >= 3) log(G, 'Sponsor confidence ' + (d > 0 ? 'rises' : 'falls') + ' to ' + Math.round(G.conf) + ' (' + why + ').', d > 0 ? 'good' : 'warn');
  return G.conf - before;
}
// the sponsor pays less as the colony matures: it is expected to earn its own way
function stipendTaper(G) { const sol = solOf(G.tick); return sol <= 30 ? 1 : Math.max(TAPER_MIN[G.cfg.difficulty], 1 - (sol - 30) / 140); }
function stipendNow(G) { const SP = SPONSORS[G.cfg.sponsor], DF = DIFFICULTY[G.cfg.difficulty]; return Math.round(SP.stipend * DF.funds * (1 + M(G, 'funding')) * stipendTaper(G) * confMult(G)); }
// Earth-side payroll and insurance for every adult colonist who came from home
function payrollNow(G) { let n = 0; for (const c of G.colonists) if (c.born === undefined && stage(c) !== 'child') n++; return Math.round(n * PAYROLL[G.cfg.difficulty] * Math.max(0.5, 1 + M(G, 'payroll')) * 10) / 10; }
function priceInflation(G) { return 1 + Math.min(0.4, solOf(G.tick) * 0.002); }
function arkEscalation(G) { return Math.min(2, 1 + 0.04 * (G.st.arks || 0)); }
function buyoutCost(G) { return BUYOUT[G.cfg.difficulty]; }

// ---- contracts: the sponsor asks for something by a deadline ----
const CONTRACTS = {
  rare: { name: 'Rare metal shipment', make: (G, r) => { const n = 20 + 10 * r.int(3) + Math.floor(solOf(G.tick) / 20) * 5; return { need: n, sols: 12 + r.int(5), reward: 40 * n, text: 'Ship ' + n + ' rare metals home on returning rockets.' }; }, cond: G => G.deposits.some(d => d.type === 'rare' && depKnown(G, d)) },
  kessite: { name: 'Kessite samples', make: (G, r) => { const n = 6 + 2 * r.int(4); return { need: n, sols: 18 + r.int(6), reward: 150 * n, text: 'Ship ' + n + ' Kessite crystals home.' }; }, cond: G => techDone(G, 'kessite') && G.deposits.some(d => d.type === 'crystal' && depKnown(G, d)) },
  pop: { name: 'Settlement quota', make: (G, r) => { const n = G.colonists.length + 15 + 5 * r.int(3); return { need: n, sols: 16 + r.int(6), reward: 600 + 12 * n, text: 'Reach ' + n + ' colonists.' }; }, cond: G => G.st.everColonists },
  tech: { name: 'Research milestone', make: (G, r) => { const n = 2 + r.int(2); return { need: techCount(G) + n, sols: 12 + r.int(6), reward: 350 + 120 * n, text: 'Complete ' + n + ' more technologies.' }; }, cond: () => true },
  self: { name: 'Self-reliance audit', make: (G, r) => ({ need: 5, sols: 14, reward: 900, text: 'Go 5 sols in a row with no shortages and no imported food, parts or metals.' }), cond: G => G.colonists.length >= 20 },
  births: { name: 'Next generation', make: (G, r) => { const n = 2 + r.int(3); return { need: G.st.births + n, sols: 20, reward: 300 + 200 * n, text: 'Welcome ' + n + ' births on Kessa.' }; }, cond: G => G.colonists.length >= 25 },
};
function contractProgress(G, c) {
  if (c.kind === 'rare' || c.kind === 'kessite') return c.got || 0;
  if (c.kind === 'pop') return G.colonists.length;
  if (c.kind === 'tech') return techCount(G);
  if (c.kind === 'self') return countSelf(G);
  if (c.kind === 'births') return G.st.births;
  return 0;
}
function offerContract(G) {
  const r = rng(G), kinds = Object.keys(CONTRACTS).filter(k => CONTRACTS[k].cond(G));
  if (!kinds.length) return;
  const kind = r.pick(kinds), m = CONTRACTS[kind].make(G, r);
  const scale = DIFFICULTY[G.cfg.difficulty].funds * (1 + solOf(G.tick) / 120);
  G.contracts.offer = { id: G.nextId++, kind, name: CONTRACTS[kind].name, need: m.need, sols: m.sols, reward: Math.round(m.reward * scale / 10) * 10, text: m.text, expires: G.tick + 48 };
  log(G, 'The sponsor offers a contract: ' + m.text + ' Reward ' + G.contracts.offer.reward + ' funding. See Rockets → Sponsor.', 'info');
  fx(G, { k: 'contract' });
}
function acceptContract(G) {
  const o = G.contracts.offer; if (!o || G.contracts.active) return false;
  o.start = G.tick; o.due = G.tick + o.sols * HOURS_PER_SOL; o.got = 0;
  G.contracts.active = o; G.contracts.offer = null;
  log(G, 'Contract accepted: ' + o.text + ' Due sol ' + solOf(o.due) + '.', 'info');
  return true;
}
function declineContract(G) { if (!G.contracts.offer) return false; G.contracts.offer = null; return true; }
function contractExport(G, exp) {
  const c = G.contracts.active; if (!c) return;
  if (c.kind === 'rare') c.got += exp.rare; if (c.kind === 'kessite') c.got += exp.crystals;
}
function contractHour(G) {
  const C = G.contracts;
  if (C.offer && G.tick >= C.offer.expires) { C.offer = null; }
  const c = C.active;
  if (c) {
    if (contractProgress(G, c) >= c.need) {
      G.funds += c.reward; noteProd(G, 'funds', c.reward); G.st.contractsWon = (G.st.contractsWon || 0) + 1; C.active = null;
      log(G, 'Contract fulfilled: ' + c.name + '. The sponsor pays ' + c.reward + ' funding.', 'good'); addConf(G, 8, 'contract fulfilled'); fx(G, { k: 'milestone' });
    } else if (G.tick >= c.due) {
      G.st.contractsLost = (G.st.contractsLost || 0) + 1; C.active = null;
      log(G, 'Contract missed: ' + c.name + '.', 'bad'); addConf(G, -12, 'contract missed');
    }
  }
  if (!C.offer && !C.active && G.tick >= (C.next || 0)) {
    if (C.next) offerContract(G);
    C.next = G.tick + (10 + rng(G).int(7)) * HOURS_PER_SOL;
  }
}
// ---- purchases from the sponsor ----
function grantPrice(G) { return Math.round(300 * (1 + 0.25 * (G.st.grants || 0)) * priceInflation(G)); }
function grantAmount(G) { return 200 + 15 * techCount(G); }
function buyGrant(G) {
  const p = grantPrice(G); if (G.funds < p) return { err: 'Not enough funding' };
  G.funds -= p; noteUse(G, 'funds', p); G.st.grants = (G.st.grants || 0) + 1;
  const amt = grantAmount(G); G.research.pool = (G.research.pool || 0) + amt;
  log(G, 'Research grant: sponsor universities add ' + amt + ' research.', 'good');
  return { ok: true, amt };
}
function recruitPrice(G) { return Math.round(250 * priceInflation(G)); }
function recruit(G, spec) {
  const p = recruitPrice(G); if (!SPECS[spec] || spec === 'none') return { err: 'Pick a specialization' };
  if (G.funds < p) return { err: 'Not enough funding' };
  G.funds -= p; noteUse(G, 'funds', p);
  for (let i = 0; i < 6; i++) { const a = makePerson(G, { spec }); a.aid = G.nextId++; G.applicants.unshift(a); }
  G.applicants = G.applicants.slice(0, 36);
  log(G, 'A recruiting drive at home finds 6 ' + SPECS[spec].name.toLowerCase() + 's for the applicant pool.', 'good');
  return { ok: true };
}
function economySol(G) {
  const stip = stipendNow(G), pay = payrollNow(G);
  G.funds += stip; noteProd(G, 'funds', stip);
  G.funds -= pay; noteUse(G, 'funds', pay);
  G.st.lastStipend = stip; G.st.lastPayroll = pay;
  // confidence drifts back toward 60, and falls while the colony is in debt
  if (G.funds < 0) addConf(G, -3, 'the colony is in debt');
  else G.conf += (60 - G.conf) * 0.03;
}
Object.assign(KC, { BUYOUT, CONTRACTS, stipendNow, payrollNow, stipendTaper, priceInflation, arkEscalation, buyoutCost, confMult, addConf, acceptContract, declineContract, contractProgress, grantPrice, grantAmount, buyGrant, recruitPrice, recruit });
