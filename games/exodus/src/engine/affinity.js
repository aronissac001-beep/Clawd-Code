// ===== affinity.js : Communion, Lattice and Lineage. Experience from techs, quests and discoveries; levels unlock perks =====
const AFF_LEVELS = [15, 40, 72, 110, 155, 210, 275, 350, 430, 515, 605, 700]; // cumulative experience for levels 1..12
const AFF_MAX = AFF_LEVELS.length;
const AFF_KEYS = ['communion', 'lattice', 'lineage'];
const AFF_SHORT = { C: 'communion', L: 'lattice', G: 'lineage' };
// What each level grants. fx feeds polFx; text is shown in the Affinity screen.
const AFF_PERKS = {
  communion: [
    { fx: { veilHalf: 1 }, text: 'The Veil deals half damage to your units.' },
    { fx: { veilImmune: 1 }, text: 'The Veil no longer harms your units. Symbiont Gardens and Biowells unlocked.' },
    { fx: { faunaCalm: 1, cityFood: 1 }, text: 'Second-tier Communion units. Fauna only hunt you when their anger runs high. +1 food in every colony.' },
    { fx: { tame: 1, veilHealAll: 10 }, text: 'Tame wild fauna (needs Fauna Ethology). Your units heal 10 more on Veil tiles.' },
    { fx: { veilSci: 1, sciPct: 3 }, text: 'Worked Veil tiles give +1 science. +3% science.' },
    { fx: { cityFood: 1 }, text: 'Gaia Node unlocked. +1 food in every colony.' },
    { fx: { faunaPeace: 1 }, text: 'Third-tier Communion units. Fauna never start fights with you.' },
    { fx: { culPct: 5 }, text: 'The Heartbloom can be grown (Rootsong victory). +5% culture.' },
    { fx: { sciPct: 5 }, text: '+5% science.' },
    { fx: { cityFood: 1 }, text: '+1 food in every colony.' },
    { fx: { culPct: 10 }, text: '+10% culture.' },
    { fx: { combatPct: 10 }, text: '+10% combat strength.' },
  ],
  lattice: [
    { fx: { prodPct: 2 }, text: '+2% production.' },
    { fx: { capSci: 2 }, text: 'Neural Hubs and Data Nodes unlocked. Capital +2 science.' },
    { fx: { prodPct: 3 }, text: 'Second-tier Lattice units. +3% production.' },
    { fx: { healAll: 10 }, text: 'Repair nanites: your units heal 10 more everywhere.' },
    { fx: { cityProd: 1 }, text: '+1 production in every colony.' },
    { fx: { prodPct: 3 }, text: 'Assembler Core unlocked. +3% production.' },
    { fx: { combatPct: 5 }, text: 'Third-tier Lattice units. +5% combat strength.' },
    { fx: { goldPct: 5 }, text: 'The Lattice Core can be built (Convergence victory). +5% credits.' },
    { fx: { sciPct: 4 }, text: '+4% science.' },
    { fx: { prodPct: 3 }, text: '+3% production.' },
    { fx: { combatPct: 5 }, text: '+5% combat strength.' },
    { fx: { sciPct: 6 }, text: '+6% science.' },
  ],
  lineage: [
    { fx: { happy: 2, capProd: 2 }, text: '+2 morale. Capital +2 production.' },
    { fx: { scourCul: 5 }, text: 'Heritage Halls and Arcadia Terraces unlocked. Scouring the Veil gives +5 culture.' },
    { fx: { goldPct: 5, happy: 1 }, text: 'Second-tier Lineage units. +5% credits, +1 morale.' },
    { fx: { homeCombat: 15, foodPct: 5 }, text: 'Your units fight at +15% inside your territory. +5% food.' },
    { fx: { cityCul: 1, cityProd: 1, prodPct: 3 }, text: '+1 culture and +1 production in every colony. +3% production.' },
    { fx: { keepFood: 5, sciPct: 3 }, text: 'Arcology unlocked. Colonies keep 5% more food on growth. +3% science.' },
    { fx: { cityStrPct: 20, prodPct: 5 }, text: 'Third-tier Lineage units. Colonies +20% defense. +5% production.' },
    { fx: { goldPct: 5, happy: 2 }, text: 'The Genesis Engine can be built (Genesis victory). +5% credits, +2 morale.' },
    { fx: { happy: 3, sciPct: 3 }, text: '+3 morale, +3% science.' },
    { fx: { culPct: 10 }, text: '+10% culture.' },
    { fx: { cityProd: 1 }, text: '+1 production in every colony.' },
    { fx: { combatPct: 10 }, text: '+10% combat strength.' },
  ],
};
function affXp(P, a) { return (P.aff && P.aff[a]) || 0; }
function levelFor(xp) { let lv = 0; while (lv < AFF_MAX && xp >= AFF_LEVELS[lv]) lv++; return lv; }
function affLevel(P, a) { return levelFor(affXp(P, a)); }
function affLevels(P) { return AFF_KEYS.map(a => affLevel(P, a)); }
// The affinity a faction leans to most (null before level 1).
function primaryAff(P) {
  let best = null, bx = -1;
  for (const a of AFF_KEYS) { const x = affXp(P, a); if (affLevel(P, a) >= 1 && x > bx) { bx = x; best = a; } }
  return best;
}
function affinityFxList(P) {
  const out = [];
  for (const a of AFF_KEYS) { const lv = affLevel(P, a); for (let i = 0; i < lv; i++) out.push(AFF_PERKS[a][i].fx); }
  return out;
}
function nextLevelAt(P, a) { const lv = affLevel(P, a); return lv >= AFF_MAX ? null : AFF_LEVELS[lv]; }
// Grant affinity experience. Multipliers come from fx (affPct_<key>, affPct_all).
function gainAff(G, pid, a, n, why) {
  const P = G.players[pid]; if (!P || P.barbarian || P.minor || !n || !AFF_KEYS.includes(a)) return 0;
  P.aff = P.aff || { communion: 0, lattice: 0, lineage: 0 };
  const fx = polFx(P), mult = 1 + ((fx['affPct_' + a] || 0) + (fx.affPct_all || 0)) / 100;
  const before = affLevel(P, a), amt = Math.round(n * mult);
  P.aff[a] = (P.aff[a] || 0) + amt; P._fx = null;
  const after = affLevel(P, a);
  if (after > before) {
    const A = AFFINITIES[AFFI[a]];
    for (let lv = before + 1; lv <= after; lv++) {
      if (P.human) logEvent(G, pid, `${A.glyph} ${A.name} level ${lv}! ${AFF_PERKS[a][lv - 1].text}`, -1);
      onAffinityLevel(G, pid, a, lv);
    }
    for (const c of ownCities(G, pid)) assignWorkers(G, c);
    G._att = null;
  }
  return amt;
}
function techAffinity(key) { const t = TECHS[TECHI[key]], out = {}; for (const s in t.aff || {}) out[AFF_SHORT[s]] = t.aff[s]; return out; }
function onTechAffinity(G, pid, key) { const a = techAffinity(key); for (const k in a) gainAff(G, pid, k, a[k], TECHS[TECHI[key]].name); }
// Story quests at milestone levels; victory warnings.
function onAffinityLevel(G, pid, a, lv) {
  if (lv === 3 || lv === 6 || lv === 9) offerStory(G, pid, 'aff_' + a + lv);
  if (lv === 8) for (const Q of G.players) if (Q.human && Q.id !== pid && Q.met.includes(pid)) logEvent(G, Q.id, `The ${CIVS[G.players[pid].civ].name} reached ${AFFINITIES[AFFI[a]].name} 8 and could now begin a ${VICTORIES.find(v => v.aff === a).name} victory.`, -1);
}
// Can this player use something gated by [affinity, level]?
function affOk(P, req) { return !req || affLevel(P, req[0]) >= req[1]; }

Object.assign(HX, { AFFINITIES, AFF_LEVELS, AFF_PERKS, AFF_KEYS, affLevel, affXp, primaryAff, gainAff, techAffinity, nextLevelAt, affOk });
