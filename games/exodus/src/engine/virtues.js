// ===== virtues.js : culture buys Virtues in four trees; depth and breadth synergies; the shared effect system =====
// fx fields are summed across virtues, synergies, faction, loadout, wonders, artifacts, story choices and affinity perks.
const VIRTUE_TREES = [
  { key: 'resolve', name: 'Resolve', glyph: '🛡️', color: '#ff7a6b', desc: 'Discipline, defense and armies that hold.',
    virtues: [
      { key: 'drill_corps', name: 'Drill Corps', tier: 1, fx: { milCostPct: -20, combatPct: 5 }, text: 'Military units cost 20% less production. +5% combat strength.' },
      { key: 'garrison_law', name: 'Garrison Law', tier: 1, fx: { happyGarrison: 1, garrisonCul: 1 }, text: '+1 morale and +1 culture for each colony with a military unit inside.' },
      { key: 'field_medics', name: 'Field Medics', tier: 2, fx: { healAll: 10 }, text: 'All your units heal 10 more each turn.' },
      { key: 'logistics', name: 'Logistics', tier: 2, fx: { freeUnits: 3 }, text: '3 more units free of upkeep.' },
      { key: 'veteran_cadres', name: 'Veteran Cadres', tier: 3, fx: { xp: 15, milProdPct: 20 }, text: 'New units start with 15 experience. +20% production toward military units.' },
      { key: 'fortress_colonies', name: 'Fortress Colonies', tier: 3, fx: { cityStrPct: 25, homeCombat: 10 }, text: 'Colonies +25% defense. Units +10% strength in your territory.' },
      { key: 'total_mobilization', name: 'Total Mobilization', tier: 4, fx: { combatPct: 10, milCostPct: -15 }, text: '+10% combat strength. Military units cost 15% less.' },
      { key: 'iron_resolve', name: 'Iron Resolve', tier: 4, fx: { garrisonGold: 2, happyGarrison: 1 }, text: 'Garrisoned colonies +2 credits and +1 more morale.' },
    ], depth: [{ n: 3, fx: { combatPct: 5 }, text: '+5% combat strength.' }, { n: 6, fx: { xp: 15 }, text: 'New units start with 15 more experience.' }, { n: 8, fx: { combatPct: 10, freeUnits: 2 }, text: '+10% combat strength, 2 more free units.' }] },
  { key: 'industry', name: 'Industry', glyph: '⚙️', color: '#ffb36b', desc: 'Expansion, production and the work of building a world.',
    virtues: [
      { key: 'prospectors', name: 'Prospectors', tier: 1, fx: { settlerCostPct: -25 }, text: 'Colony Pods cost 25% less production.' },
      { key: 'workshop_shifts', name: 'Workshop Shifts', tier: 1, fx: { cityProd: 1 }, text: '+1 production in every colony.' },
      { key: 'rigger_guilds', name: 'Rigger Guilds', tier: 2, fx: { builderCharges: 1, freeBuilder: 1 }, text: 'A free Rigger. Riggers get +1 charge.' },
      { key: 'supply_chains', name: 'Supply Chains', tier: 2, fx: { connGold: 1, capProdPct: 15 }, text: 'Capital +15% production. Colonies linked to the capital earn +1 more credit.' },
      { key: 'heavy_industry', name: 'Heavy Industry', tier: 3, fx: { prodPct: 8 }, text: '+8% production everywhere.' },
      { key: 'frontier_grants', name: 'Frontier Grants', tier: 3, fx: { freeSettler: 1, happyPerCity: 0.5 }, text: 'A free Colony Pod. +1 morale for every two colonies.' },
      { key: 'mass_production', name: 'Mass Production', tier: 4, fx: { bldPct: 10 }, text: '+10% production toward buildings.' },
      { key: 'planetary_works', name: 'Planetary Works', tier: 4, fx: { 'i.mine.p': 1, 'i.quarry.p': 1, 'i.lumbermill.p': 1 }, text: 'Drill Rigs, Quarries and Spore Mills +1 production.' },
    ], depth: [{ n: 3, fx: { prodPct: 3 }, text: '+3% production.' }, { n: 6, fx: { prodPct: 5 }, text: '+5% production.' }, { n: 8, fx: { bldPct: 5, settlerCostPct: -15 }, text: '+5% toward buildings; Colony Pods 15% cheaper.' }] },
  { key: 'inquiry', name: 'Inquiry', glyph: '🔬', color: '#7fc4ff', desc: 'Science, study and the hunger to understand Veyra.',
    virtues: [
      { key: 'open_data', name: 'Open Data', tier: 1, fx: { sciPct: 8 }, text: '+8% science.' },
      { key: 'field_notes', name: 'Field Notes', tier: 1, fx: { digPct: 50, nestSci: 50 }, text: 'Excavations and nest studies give 50% more.' },
      { key: 'scholar_stipends', name: 'Scholar Stipends', tier: 2, fx: { specSci: 1 }, text: 'Scholars give +1 science each.' },
      { key: 'lab_networks', name: 'Lab Networks', tier: 2, fx: { libSci: 1 }, text: 'Field Labs and Xeno Institutes +1 science each.' },
      { key: 'peer_review', name: 'Peer Review', tier: 3, fx: { insightHalf: 1 }, text: 'Breakthroughs cut technology costs by half instead of a third.' },
      { key: 'deep_survey', name: 'Deep Survey', tier: 3, fx: { labSci: 2, sciPct: 5 }, text: 'Sky Arrays and Quantum Labs +2 science. +5% science.' },
      { key: 'paradigm_shift', name: 'Paradigm Shift', tier: 4, fx: { freeTech: 1 }, text: 'Finishes your current research at once.' },
      { key: 'xeno_curiosity', name: 'Xeno Curiosity', tier: 4, fx: { affPct_all: 15 }, text: '+15% affinity experience from every source.' },
    ], depth: [{ n: 3, fx: { sciPct: 5 }, text: '+5% science.' }, { n: 6, fx: { citySci: 1 }, text: '+1 science in every colony.' }, { n: 8, fx: { sciPct: 10 }, text: '+10% science.' }] },
  { key: 'kinship', name: 'Kinship', glyph: '🤝', color: '#e6a3ff', desc: 'Growth, culture and colonists who look after each other.',
    virtues: [
      { key: 'founders_creed', name: "Founders' Creed", tier: 1, fx: { capCul: 3, capFood: 2 }, text: 'Capital +3 culture and +2 food.' },
      { key: 'common_tables', name: 'Common Tables', tier: 1, fx: { keepFood: 10 }, text: 'Colonies keep 10% of their food when they grow.' },
      { key: 'festivals', name: 'Festivals', tier: 2, fx: { venueHappy: 1, happy: 2 }, text: '+2 morale. Commons Domes and Holo Arenas +1 morale each.' },
      { key: 'civic_pride', name: 'Civic Pride', tier: 2, fx: { happyPerCity: 1 }, text: '+1 morale for every colony you own.' },
      { key: 'living_archives', name: 'Living Archives', tier: 3, fx: { culPct: 15 }, text: '+15% culture.' },
      { key: 'open_markets', name: 'Open Markets', tier: 3, fx: { routeGold: 2, marketGold: 1 }, text: 'Each convoy route +2 credits. Credit Exchanges +1 credit.' },
      { key: 'one_people', name: 'One People', tier: 4, fx: { happy: 4, luxExtra: 1 }, text: '+4 morale. Each luxury gives 1 more morale.' },
      { key: 'diaspora', name: 'Diaspora', tier: 4, fx: { cityCul: 2 }, text: '+2 culture in every colony.' },
    ], depth: [{ n: 3, fx: { capCul: 2 }, text: 'Capital +2 culture.' }, { n: 6, fx: { culPct: 10 }, text: '+10% culture.' }, { n: 8, fx: { happy: 4 }, text: '+4 morale.' }] },
];
// Breadth synergy: having at least n virtues in every tree.
const HARMONY = [
  { n: 1, fx: { happy: 2 }, text: '+2 morale.' },
  { n: 2, fx: { sciPct: 5, prodPct: 5 }, text: '+5% science and production.' },
  { n: 3, fx: { culPct: 10, goldPct: 10 }, text: '+10% culture and credits.' },
  { n: 4, fx: { affPct_all: 10, combatPct: 5 }, text: '+10% affinity experience, +5% combat strength.' },
];
const POLICY = {}; const POLICY_TREE_OF = {};
VIRTUE_TREES.forEach(tr => tr.virtues.forEach(p => { POLICY[p.key] = p; POLICY_TREE_OF[p.key] = tr; }));
const POLICY_TREES = VIRTUE_TREES; // older code and the UI read this name
const ONE_SHOT = ['freeBuilder', 'freeSettler', 'freeTech'];
const TIER_EPOCH = [0, 0, 0, 1, 2];

function playerEra(P) { return Math.max(0, Math.min(ERAS.length - 1, Math.floor(Math.max(0, P.techs.length - 1) / 11))); }
function treeCount(P, tr) { return tr.virtues.filter(v => P.policies.includes(v.key)).length; }
function harmonyLevel(P) { return Math.min(...VIRTUE_TREES.map(tr => treeCount(P, tr))); }
// Synergies held right now (keys like 'resolve3', 'harmony2'), kept in P.treesDone for scoring and display.
function synergiesOf(P) {
  const out = [];
  for (const tr of VIRTUE_TREES) { const n = treeCount(P, tr); for (const d of tr.depth) if (n >= d.n) out.push(tr.key + d.n); }
  const hl = harmonyLevel(P); for (const hm of HARMONY) if (hl >= hm.n) out.push('harmony' + hm.n);
  return out;
}
function synergyFx(key) {
  if (key.startsWith('harmony')) { const n = +key.slice(7); const hm = HARMONY.find(x => x.n === n); return hm ? hm.fx : {}; }
  const tr = VIRTUE_TREES.find(t => key.startsWith(t.key)); if (!tr) return {};
  const d = tr.depth.find(x => x.n === +key.slice(tr.key.length)); return d ? d.fx : {};
}
// Summed effects of everything a player has. Cached until something changes.
function polFx(P) {
  const lv = affLevels(P);
  const sig = P.techs.length + '|' + P.policies.length + '|' + P.treesDone.length + '|' + (P._wonders ? P._wonders.join(',') : '') + '|' + (P.relics || []).length + '|' + (P.curses || []).length + '|' + (P.qfx || []).length + '|' + lv.join(',') + '|' + (P._omenFx ? 1 : 0);
  if (P._fx && P._fxN === sig) return P._fx;
  const fx = {};
  const add = o => { if (o) for (const k in o) fx[k] = (fx[k] || 0) + o[k]; };
  const civ = CIVS[P.civ];
  if (civ && !P.minor && !P.barbarian) add(civ.fx);
  if (P.loadout) for (const [grp, k] of [['colonists', P.loadout.col], ['ships', P.loadout.ship]]) { const L = LOADOUT[grp].find(x => x.key === k); if (L) add(L.fx); }
  for (const k of P.techs) { const t = TECHS[TECHI[k]]; if (t && t.fx) add(t.fx); }
  for (const k of P.policies) if (POLICY[k]) add(POLICY[k].fx);
  for (const k of P.treesDone) add(synergyFx(k));
  for (const w of wonderFxList(P)) add(w);
  for (const r of relicFxList(P)) add(r);
  for (const q of P.qfx || []) add(q);
  for (const f of affinityFxList(P)) add(f);
  P._fx = fx; P._fxN = sig;
  return fx;
}
function policyCost(G, pid) {
  const P = G.players[pid], n = P.policies.length, cities = Math.max(1, ownCities(G, pid).length);
  let c = (25 + Math.pow(6 * n, 1.6)) * (1 + 0.07 * (cities - 1)) * paceOf(G);
  if (hasTech(P, 'civics')) c *= 0.9;
  return Math.floor(c);
}
function policyStatus(G, pid, key) {
  const P = G.players[pid], pol = POLICY[key], tr = POLICY_TREE_OF[key];
  if (!pol) return { ok: false, why: 'Unknown virtue.' };
  if (P.policies.includes(key)) return { ok: false, adopted: true, why: 'Adopted.' };
  if (playerEra(P) < TIER_EPOCH[pol.tier]) return { ok: false, why: `Tier ${pol.tier} opens in the ${ERAS[TIER_EPOCH[pol.tier]]} phase.` };
  if (pol.tier > 1 && !tr.virtues.some(v => v.tier === pol.tier - 1 && P.policies.includes(v.key))) return { ok: false, why: `Adopt a tier ${pol.tier - 1} ${tr.name} virtue first.` };
  const cost = policyCost(G, pid);
  if (P.culturePool < cost) return { ok: false, why: `Needs ${cost} culture.`, cost, affordable: false, open: true };
  return { ok: true, cost };
}
function adoptPolicy(G, pid, key) {
  const st = policyStatus(G, pid, key); if (!st.ok) return false;
  const P = G.players[pid];
  P.culturePool -= st.cost; P.policies.push(key);
  applyOneShots(G, pid, POLICY[key].fx);
  const before = P.treesDone.slice(); P.treesDone = synergiesOf(P); P._fx = null;
  for (const k of P.treesDone) if (!before.includes(k)) {
    applyOneShots(G, pid, synergyFx(k));
    if (P.human) logEvent(G, pid, `Synergy reached: ${synergyName(k)}. ${synergyText(k)}`, -1);
  }
  applyFreeBuildings(G, pid);
  for (const c of ownCities(G, pid)) assignWorkers(G, c);
  if (P.human) logEvent(G, pid, `Virtue adopted: ${POLICY[key].name}.`, -1);
  return true;
}
function synergyName(k) { if (k.startsWith('harmony')) return `Balance ${k.slice(7)}`; const tr = VIRTUE_TREES.find(t => k.startsWith(t.key)); return tr ? `${tr.name} ${k.slice(tr.key.length)}` : k; }
function synergyText(k) { if (k.startsWith('harmony')) { const hm = HARMONY.find(x => x.n === +k.slice(7)); return hm ? hm.text : ''; } const tr = VIRTUE_TREES.find(t => k.startsWith(t.key)); const d = tr && tr.depth.find(x => x.n === +k.slice(tr.key.length)); return d ? d.text : ''; }
function applyOneShots(G, pid, fx) {
  const P = G.players[pid], cap = ownCities(G, pid).find(c => c.capital);
  if (fx.freeBuilder && cap) { const t = spawnTileFor(G, cap, 'builder'); if (t >= 0) spawnUnit(G, 'builder', pid, t); }
  if (fx.freeSettler && cap) { const t = spawnTileFor(G, cap, 'settler'); if (t >= 0) spawnUnit(G, 'settler', pid, t); }
  if (fx.freeTech) {
    let k = P.research;
    if (!k) { const av = availableTechs(P).sort((a, b) => techCost(G, a, pid) - techCost(G, b, pid)); k = av[0]; }
    if (k) { P.progress[k] = techCost(G, k, pid); learnTech(G, pid, k); }
  }
  computeVisibility(G, pid);
}
// Free buildings from virtues or the loadout (none by default; kept for story effects).
function applyFreeBuildings(G, pid) {
  const n = polFx(G.players[pid]).freeMonuments || 0; if (!n) return;
  const cs = ownCities(G, pid).sort((a, b) => a.founded - b.founded || a.id - b.id).slice(0, n);
  for (const c of cs) if (!c.buildings.includes('monument')) { c.buildings.push('monument'); if (c.build && c.build.key === 'monument') c.build = c.queue.shift() || null; c.queue = c.queue.filter(q => q.key !== 'monument'); }
}
function cityGarrisoned(G, c) { const m = G._mil.get(c.tile); return !!m && m.owner === c.owner; }

// ---- AI ----
const AI_TREES = {
  halcyon: { inquiry: 2.2, industry: 2.1, kinship: 1.7, resolve: 0.9 },
  kestrel: { kinship: 2.2, industry: 2.0, inquiry: 1.6, resolve: 0.8 },
  brightwater: { kinship: 2.6, industry: 1.6, inquiry: 1.3, resolve: 0.9 },
  ironveil: { resolve: 2.8, industry: 1.8, kinship: 1.1, inquiry: 1.0 },
  choir: { kinship: 2.4, inquiry: 1.8, industry: 1.2, resolve: 0.9 },
  forgeborn: { industry: 1.8, resolve: 1.6, inquiry: 1.5, kinship: 1.4 },
  tidecall: { industry: 2.0, kinship: 1.8, resolve: 1.4, inquiry: 1.2 },
  pathfinder: { industry: 1.8, inquiry: 1.8, kinship: 1.5, resolve: 1.2 },
};
function aiPolicies(G, pid) {
  const P = G.players[pid], w = AI_TREES[civKey(P)], hap = civHappiness(G, pid).net;
  if (!w) return; // outposts do not adopt virtues
  for (let guard = 0; guard < 3 && P.culturePool >= policyCost(G, pid); guard++) {
    let best = null, bs = 0;
    const hl = harmonyLevel(P);
    for (const tr of VIRTUE_TREES) for (const p of tr.virtues) {
      if (!policyStatus(G, pid, p.key).ok) continue;
      let v = w[tr.key] || 1;
      const n = treeCount(P, tr);
      if (tr.depth.some(d => d.n === n + 1)) v *= 1.35; // one short of a depth synergy
      if (n === hl) v *= 1.15; // keeps harmony growing
      if (p.fx.happy || p.fx.happyPerCity || p.fx.venueHappy || p.fx.happyGarrison) v *= hap < 2 ? 1.8 : 1;
      v *= 1 + (G._rng.next() * 0.1);
      if (v > bs) { bs = v; best = p.key; }
    }
    if (!best || !adoptPolicy(G, pid, best)) break;
  }
}

Object.assign(HX, { policyCost, policyStatus, adoptPolicy, polFx, playerEra, treeCount, harmonyLevel, synergiesOf, synergyName, synergyText, VIRTUE_TREES, HARMONY });
