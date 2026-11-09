// ===== policies.js : culture-bought policies in six trees =====
// fx fields are summed across adopted policies and finished trees; see polFx() users in economy.js.
const POLICY_TREES = [
  { key: 'tradition', name: 'Tradition', glyph: '👑', era: 0, desc: 'A strong, fast-growing capital.',
    policies: [
      { key: 'tradition', name: 'Tradition', entry: true, fx: { capCul: 3, capFood: 2 }, text: 'Capital +3 culture and +2 food.' },
      { key: 'aristocracy', name: 'Aristocracy', fx: { capProdPct: 15 }, text: 'Capital +15% production.' },
      { key: 'landed_elite', name: 'Landed Elite', fx: { capFood: 2, capKeep: 15 }, text: 'Capital +2 food and keeps 15% more food when it grows.' },
      { key: 'monarchy', name: 'Monarchy', fx: { capGoldPer2Pop: 1, happy: 2 }, text: 'Capital +1 gold per 2 citizens. +2 happiness.', h: 1 },
      { key: 'legalism', name: 'Legalism', fx: { freeMonuments: 4 }, text: 'A free Monument in each of your first 4 cities, including ones founded later.' },
    ], finisher: { fx: { keepFood: 10, capCul: 2 }, text: 'All cities keep 10% more food when they grow. Capital +2 culture.' } },
  { key: 'expansion', name: 'Expansion', glyph: '🧭', era: 0, desc: 'Many cities, settled quickly.',
    policies: [
      { key: 'expansion', name: 'Expansion', entry: true, fx: { cityCul: 1 }, text: '+1 culture in every city.' },
      { key: 'citizenship', name: 'Citizenship', fx: { freeBuilder: 1, builderCharges: 1 }, text: 'A free Builder appears in your capital. Builders get +1 charge.' },
      { key: 'collective_rule', name: 'Collective Rule', fx: { settlerCostPct: -33 }, text: 'Settlers cost 33% less production.' },
      { key: 'republic', name: 'Republic', fx: { cityProd: 1 }, text: '+1 production in every city.' },
      { key: 'meritocracy', name: 'Meritocracy', fx: { happyPerCity: 1 }, text: '+1 happiness for every city you own.', h: 1 },
    ], finisher: { fx: { freeSettler: 1, connGold: 1 }, text: 'A free Settler. Cities linked to the capital earn +1 more gold.' } },
  { key: 'warfare', name: 'Warfare', glyph: '⚔️', era: 0, desc: 'An army that pays for itself and fights harder.',
    policies: [
      { key: 'warfare', name: 'Warfare', entry: true, fx: { milCostPct: -25, combatPct: 10 }, text: 'Military units cost 25% less production. +10% combat strength.' },
      { key: 'logistics', name: 'Logistics', fx: { freeUnits: 3 }, text: '3 more units free of upkeep.' },
      { key: 'garrisons', name: 'Garrisons', fx: { happyGarrison: 1 }, text: '+1 happiness for each city with a military unit inside.', h: 1 },
      { key: 'drill_grounds', name: 'Drill Grounds', fx: { milProdPct: 25, xp: 15 }, text: '+25% production toward military units. New units start with 15 experience.' },
      { key: 'martial_honor', name: 'Martial Honor', fx: { garrisonCul: 2 }, text: '+2 culture in cities with a military unit inside.' },
    ], finisher: { fx: { garrisonGold: 2, combatPct: 15 }, text: '+2 gold in cities with a military unit inside. +15% combat strength.' } },
  { key: 'commerce', name: 'Commerce', glyph: '💰', era: 1, desc: 'Gold, trade and markets.',
    policies: [
      { key: 'commerce', name: 'Commerce', entry: true, fx: { capGoldPct: 25 }, text: 'Capital +25% gold.' },
      { key: 'trade_guilds', name: 'Trade Guilds', fx: { routes: 1 }, text: '+1 trade route.' },
      { key: 'mercantilism', name: 'Mercantilism', fx: { buyPct: -25 }, text: 'Buying with gold costs 25% less.' },
      { key: 'caravansary', name: 'Caravansary', fx: { routeGold: 2 }, text: 'Each of your trade routes earns +2 gold.' },
      { key: 'banking_houses', name: 'Banking Houses', fx: { marketGold: 2 }, text: 'Markets +2 gold.' },
    ], finisher: { fx: { luxExtra: 2 }, text: 'Each improved luxury type gives 2 more happiness.' } },
  { key: 'faith', name: 'Faith', glyph: '⛩️', era: 1, desc: 'Temples, festivals and a devout, content people.',
    policies: [
      { key: 'faith', name: 'Faith', entry: true, fx: { happy: 3, cityFaith: 1 }, text: '+3 happiness. +1 faith in every city.', h: 1 },
      { key: 'monasteries', name: 'Monasteries', fx: { templeCul: 2, templeFaith: 1 }, text: 'Temples +2 culture and +1 faith.' },
      { key: 'pilgrimage', name: 'Pilgrimage', fx: { templeFood: 2 }, text: 'Cities with a Temple +2 food.' },
      { key: 'tithe', name: 'Tithe', fx: { templeGold: 2 }, text: 'Temples +2 gold.' },
      { key: 'festivals', name: 'Festivals', fx: { venueHappy: 1 }, text: 'Amphitheaters and Arenas +1 happiness each.', h: 1 },
    ], finisher: { fx: { culPct: 15, faithPct: 15 }, text: '+15% culture and +15% faith in all cities.' } },
  { key: 'enlightenment', name: 'Enlightenment', glyph: '📜', era: 2, desc: 'Science and scholarship.',
    policies: [
      { key: 'enlightenment', name: 'Enlightenment', entry: true, fx: { sciPct: 10 }, text: '+10% science in all cities.' },
      { key: 'scholasticism', name: 'Scholasticism', fx: { libSci: 1 }, text: 'Libraries and Universities +1 science each.' },
      { key: 'academies', name: 'Academies', fx: { specSci: 1 }, text: 'Scholars +1 science each.' },
      { key: 'free_thought', name: 'Free Thought', fx: { labSci: 3 }, text: 'Observatories and Laboratories +3 science each.' },
      { key: 'patronage', name: 'Patronage', fx: { insightHalf: 1 }, text: 'Insights cut costs by half instead of a third.' },
    ], finisher: { fx: { freeTech: 1 }, text: 'One free technology.' } },
];
const POLICY = {}; const POLICY_TREE_OF = {};
POLICY_TREES.forEach(tr => tr.policies.forEach(p => { POLICY[p.key] = p; POLICY_TREE_OF[p.key] = tr; }));
const ONE_SHOT = ['freeBuilder', 'freeSettler', 'freeTech'];

function playerEra(P) { let e = 0; for (const k of P.techs) e = Math.max(e, TECHS[TECHI[k]].era); return e; }
// Summed effects of everything adopted. Cached until policies change.
function polFx(P) {
  const n = P.policies.length + P.treesDone.length * 100 + (P._wonders ? P._wonders.length * 10000 : 0);
  if (P._fx && P._fxN === n) return P._fx;
  const fx = {};
  const add = o => { for (const k in o) fx[k] = (fx[k] || 0) + o[k]; };
  for (const k of P.policies) add(POLICY[k].fx);
  for (const t of P.treesDone) add(POLICY_TREES.find(x => x.key === t).finisher.fx);
  for (const w of wonderFxList(P)) add(w); // world wonders use the same effect keys
  P._fx = fx; P._fxN = n;
  return fx;
}
function policyCost(G, pid) {
  const P = G.players[pid], n = P.policies.length, cities = Math.max(1, ownCities(G, pid).length);
  let c = (25 + Math.pow(6 * n, 1.62)) * (1 + 0.08 * (cities - 1)) * paceOf(G);
  if (hasTech(P, 'civil_service')) c *= 0.9;
  return Math.floor(c);
}
function policyStatus(G, pid, key) {
  const P = G.players[pid], pol = POLICY[key], tr = POLICY_TREE_OF[key];
  if (P.policies.includes(key)) return { ok: false, adopted: true, why: 'Adopted.' };
  if (playerEra(P) < tr.era) return { ok: false, why: `Opens in the ${ERAS[tr.era]} era.` };
  if (!pol.entry && !P.policies.includes(tr.policies[0].key)) return { ok: false, why: `Adopt ${tr.policies[0].name} first.` };
  const cost = policyCost(G, pid);
  if (P.culturePool < cost) return { ok: false, why: `Needs ${cost} culture.`, cost, affordable: false, open: true };
  return { ok: true, cost };
}
function adoptPolicy(G, pid, key) {
  const st = policyStatus(G, pid, key); if (!st.ok) return false;
  const P = G.players[pid], tr = POLICY_TREE_OF[key];
  P.culturePool -= st.cost; P.policies.push(key);
  applyOneShots(G, pid, POLICY[key].fx);
  applyFreeBuildings(G, pid);
  if (tr.policies.every(p => P.policies.includes(p.key)) && !P.treesDone.includes(tr.key)) {
    P.treesDone.push(tr.key);
    applyOneShots(G, pid, tr.finisher.fx);
    if (P.human) logEvent(G, pid, `${tr.name} completed: ${tr.finisher.text}`, -1);
  }
  for (const c of ownCities(G, pid)) assignWorkers(G, c);
  if (P.human) logEvent(G, pid, `Policy adopted: ${POLICY[key].name}.`, -1);
  return true;
}
function applyOneShots(G, pid, fx) {
  const P = G.players[pid], cap = ownCities(G, pid).find(c => c.capital);
  if (fx.freeBuilder && cap) { const t = spawnTileFor(G, cap, 'builder'); if (t >= 0) spawnUnit(G, 'builder', pid, t); }
  if (fx.freeSettler && cap) { const t = spawnTileFor(G, cap, 'settler'); if (t >= 0) spawnUnit(G, 'settler', pid, t); }
  if (fx.freeTech) {
    let k = P.research;
    if (!k) { const av = availableTechs(P).sort((a, b) => techCost(G, a) - techCost(G, b)); k = av[0]; }
    if (k) { P.progress[k] = techCost(G, k); learnTech(G, pid, k); }
  }
  computeVisibility(G, pid);
}
// Legalism: Monuments in the first N cities by founding order.
function applyFreeBuildings(G, pid) {
  const n = polFx(G.players[pid]).freeMonuments || 0; if (!n) return;
  const cs = ownCities(G, pid).sort((a, b) => a.founded - b.founded || a.id - b.id).slice(0, n);
  for (const c of cs) if (!c.buildings.includes('monument')) { c.buildings.push('monument'); if (c.build && c.build.key === 'monument') c.build = c.queue.shift() || null; c.queue = c.queue.filter(q => q.key !== 'monument'); }
}
function cityGarrisoned(G, c) { const m = G._mil.get(c.tile); return !!m && m.owner === c.owner; }

// ---- AI ----
const AI_TREES = {
  aurelian: { enlightenment: 3, tradition: 2.2, commerce: 1.4, expansion: 1.2, faith: 1.0, warfare: 0.7 },
  thornwall: { tradition: 2.4, warfare: 2.0, faith: 1.5, enlightenment: 1.4, commerce: 1.0, expansion: 0.9 },
  sunreach: { expansion: 2.6, warfare: 2.2, commerce: 1.3, tradition: 1.0, enlightenment: 1.1, faith: 0.8 },
  meridian: { commerce: 3, expansion: 1.6, tradition: 1.3, enlightenment: 1.3, faith: 1.0, warfare: 0.7 },
  verdant: { faith: 2.2, tradition: 1.6, enlightenment: 1.5, expansion: 1.3, commerce: 1.1, warfare: 0.8 },
  emberforge: { expansion: 2.0, tradition: 1.8, warfare: 1.6, enlightenment: 1.4, commerce: 1.2, faith: 0.9 },
  frostmark: { tradition: 2.4, warfare: 1.7, expansion: 1.5, faith: 1.3, enlightenment: 1.2, commerce: 1.0 },
  coralline: { commerce: 2.4, expansion: 1.8, enlightenment: 1.5, tradition: 1.2, faith: 1.0, warfare: 0.9 },
};
function aiPolicies(G, pid) {
  const P = G.players[pid], w = AI_TREES[civKey(P)], hap = civHappiness(G, pid).net;
  if (!w) return; // free cities do not adopt policies
  for (let guard = 0; guard < 3 && P.culturePool >= policyCost(G, pid); guard++) {
    let best = null, bs = 0;
    for (const tr of POLICY_TREES) for (const p of tr.policies) {
      if (!policyStatus(G, pid, p.key).ok) continue;
      let v = w[tr.key] || 1;
      const done = tr.policies.filter(x => P.policies.includes(x.key)).length;
      v *= 1 + done * 0.15; // finishing trees pays off
      if (p.h && hap < 2) v *= 1.8;
      if (v > bs) { bs = v; best = p.key; }
    }
    if (!best || !adoptPolicy(G, pid, best)) break;
  }
}

Object.assign(HX, { policyCost, policyStatus, adoptPolicy, polFx, playerEra });
