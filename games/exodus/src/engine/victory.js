// ===== victory.js : planetary wonders, victory projects, score, victory, history =====
// Wonders are one-per-world buildings; projects are one-per-faction buildings that start a victory clock.
// fx keys reuse the shared effect system (see polFx); once = one-time effects on completion.
const WONDERS = [
  { key: 'first_light', name: 'First Light Beacon', tech: 'hydroponics', cost: 160, y: { f: 3 }, fx: { keepFood: 5 }, glyph: '🗼', desc: '+3 food. All your colonies keep 5% more food when they grow.' },
  { key: 'memory_vault', name: 'Ark Memory Vault', tech: 'colonial_charter', cost: 180, y: { c: 2, s: 1 }, once: { freePolicy: 1 }, glyph: '💾', desc: '+2 culture, +1 science. Grants culture for one free virtue.' },
  { key: 'xeno_garden', name: 'Xenobotanic Garden', tech: 'xenobiology', cost: 190, y: { f: 2, s: 2 }, fx: { 'i.camp.g': 1 }, glyph: '🌺', desc: '+2 food, +2 science. Harvest Camps +1 credit.' },
  { key: 'great_foundry', name: 'The Great Foundry', tech: 'geomechanics', cost: 230, y: { p: 2, c: 1 }, fx: { cityProd: 1 }, glyph: '🏭', desc: '+2 production, +1 culture. +1 production in every colony.' },
  { key: 'credit_nexus', name: 'Credit Nexus', tech: 'commerce', cost: 200, y: { g: 3 }, fx: { routeGold: 1 }, glyph: '💠', desc: '+3 credits. Your convoy routes give +1 credit.' },
  { key: 'war_college', name: 'Concord War College', tech: 'ballistics', cost: 220, y: { p: 1, c: 1 }, fx: { xp: 15 }, glyph: '🎖️', desc: 'All new military units start with +15 experience.' },
  { key: 'spore_choir', name: 'Spore Choir Cathedral', tech: 'spore_lore', cost: 240, y: { c: 3 }, fx: { happy: 2, veilHalf: 1 }, glyph: '🎶', desc: '+3 culture, +2 morale. The Veil deals half damage to your units.' },
  { key: 'stellar_archive', name: 'Stellar Archive', tech: 'signal_analysis', cost: 240, y: { s: 3 }, once: { freeTech: 1 }, glyph: '📚', desc: '+3 science. Finishes your current research.' },
  { key: 'lodestar_array', name: 'Lodestar Array', tech: 'marine_tech', cost: 230, coastal: true, y: { p: 1, g: 2 }, fx: { navalMoves: 1 }, glyph: '🛰️', desc: '+2 credits, +1 production. All your ships get +1 move. Coastal colony.' },
  { key: 'tidewall', name: 'The Tidewall', tech: 'tidal_power', cost: 260, coastal: true, y: { g: 3, p: 1 }, fx: { routeGold: 1 }, glyph: '🌊', desc: '+3 credits, +1 production. Convoy routes +1 credit. Coastal colony.' },
  { key: 'grand_arena', name: 'Zero-G Grand Arena', tech: 'civics', cost: 270, h: 4, fx: { venueHappy: 1 }, glyph: '🎪', desc: '+4 morale. Each Commons Dome and Holo Arena gives +1 more.' },
  { key: 'the_weave', name: 'The Weave', tech: 'gene_weaving', cost: 300, y: { f: 2, c: 2 }, fx: { affPct_communion: 20 }, glyph: '🧶', desc: '+2 food, +2 culture. +20% Communion experience.' },
  { key: 'machine_oracle', name: 'Machine Oracle', tech: 'machine_learning', cost: 300, y: { s: 3, p: 2 }, fx: { affPct_lattice: 20 }, glyph: '🔮', desc: '+3 science, +2 production. +20% Lattice experience.' },
  { key: 'genetic_ark', name: 'Genetic Ark', tech: 'genetic_medicine', cost: 330, y: { f: 3 }, h: 2, fx: { affPct_lineage: 20 }, glyph: '🧬', desc: '+3 food, +2 morale. +20% Lineage experience.' },
  { key: 'concord_hall', name: 'Concord Hall', tech: 'finance', cost: 340, h: 2, y: { c: 2 }, fx: { happy: 4 }, glyph: '🏛️', desc: '+2 culture, +6 morale in total.' },
  { key: 'iron_citadel', name: 'Iron Citadel', tech: 'heavy_alloys', cost: 360, y: { p: 2 }, fx: { milProdPct: 15, cityStrPct: 10 }, glyph: '🏰', desc: '+2 production. +15% production toward military units; colonies +10% defense.' },
  { key: 'quantum_spire', name: 'Quantum Spire', tech: 'quantum_theory', cost: 400, y: { s: 4 }, fx: { sciPct: 10 }, glyph: '🗼', desc: '+4 science. +10% science in every colony.' },
  { key: 'deep_eye', name: 'Deep Eye Telescope', tech: 'gravitics', cost: 480, y: { s: 5 }, once: { freeTech: 1 }, glyph: '🔭', desc: '+5 science. Finishes your current research.' },
  { key: 'abyssal_harbor', name: 'Abyssal Harbor', tech: 'hydrodynamics', cost: 470, coastal: true, y: { g: 2, p: 2 }, fx: { navalMoves: 1, routeGold: 1 }, glyph: '⚓', desc: '+2 credits, +2 production. Ships +1 move, convoy routes +1 credit. Coastal colony.' },
  { key: 'muse_dome', name: 'Dome of Muses', tech: 'planetary_media', cost: 520, y: { c: 5 }, fx: { culPct: 15 }, glyph: '🎨', desc: '+5 culture. +15% culture in every colony.' },
  { key: 'world_engine', name: 'World Engine', tech: 'fusion_power', cost: 700, y: { p: 6 }, fx: { prodPct: 10 }, glyph: '⚙️', desc: '+6 production. +10% production in every colony.' },
  { key: 'accord_tower', name: 'Accord Tower', tech: 'cultural_memory', cost: 680, y: { c: 3, g: 3 }, fx: { attBonus: 2 }, glyph: '🕊️', desc: '+3 culture, +3 credits. Every faction feels 2 points warmer toward you.' },
  { key: 'sentinel_grid', name: 'Sentinel Grid', tech: 'autonomous_war', cost: 700, y: { p: 3 }, fx: { combatPct: 10 }, glyph: '🛡️', desc: '+3 production. +10% combat strength.' },
  { key: 'resonance_lens', name: 'Resonance Lens', tech: 'unified_field', cost: 820, y: { s: 4, p: 4 }, fx: { sciPct: 10 }, glyph: '💫', desc: '+4 science, +4 production. +10% science in every colony.' },
  { key: 'garden_years', name: 'Garden of Long Years', tech: 'longevity', cost: 720, h: 4, fx: { happyPerCity: 1 }, glyph: '🌳', desc: '+4 morale, plus +1 for every colony you own.' },
  { key: 'mind_garden', name: 'Mind Garden', tech: 'biosphere_mind', cost: 760, y: { s: 4, c: 4 }, fx: { happy: 3 }, glyph: '🌸', desc: '+4 science, +4 culture, +3 morale.' },
  { key: 'ring_city', name: 'Ring City', tech: 'megastructures', cost: 780, y: { p: 3 }, h: 3, fx: { cityProd: 2 }, glyph: '⭕', desc: '+3 production, +3 morale. +2 production in every colony.' },
  { key: 'skyhook', name: 'Skyhook', tech: 'star_lift', cost: 900, y: { g: 6 }, fx: { goldPct: 10, satLife: 20 }, glyph: '🚡', desc: '+6 credits. +10% credits; satellites last 20 turns longer.' },
];
const PROJECTS = [
  { key: 'heartbloom', name: 'The Heartbloom', tech: 'rootsong_theory', aff: ['communion', 8], cost: 2900, glyph: '🌺', victory: 'rootsong', turns: 15,
    desc: 'A living flower the size of a mountain, grown from the planet\'s own roots. Seeds the Veil around it. Hold it for 15 turns to win a Rootsong victory.' },
  { key: 'lattice_core', name: 'The Lattice Core', tech: 'singularity_mesh', aff: ['lattice', 8], cost: 3300, glyph: '💠', victory: 'convergence', turns: 15,
    desc: 'A crystal mind that every colonist can upload into. While it runs, a quarter of your science feeds the uplink. Hold it for 15 turns to win a Convergence victory.' },
  { key: 'genesis_engine', name: 'The Genesis Engine', tech: 'genesis_protocol', aff: ['lineage', 8], cost: 2900, glyph: '🌍', victory: 'genesis', turns: 15,
    desc: 'Atmosphere plants that remake Veyra for human lungs. Scours the Veil from your land; the clock only runs while at most 10 Veil tiles remain inside your borders. Hold it for 15 turns to win a Genesis victory.' },
  { key: 'listening_array', name: 'The Listening Array', tech: 'deep_resonance', cost: 2600, glyph: '📡', victory: 'awakening', turns: 18, needVaults: 3,
    desc: 'A field of antennae tuned to the Echo Vaults. Needs 3 decoded vaults. Hold it for 18 turns until the Sleepers answer, for an Awakening victory.' },
];
for (const W of WONDERS) BUILDINGS.push(Object.assign({ wonder: true, upkeep: 0 }, W));
for (const W of PROJECTS) BUILDINGS.push(Object.assign({ project: true, upkeep: 0 }, W));
for (const B of BUILDINGS) BLDI[B.key] = BUILDINGS.indexOf(B);
const PROJECT_OF = {}; for (const W of PROJECTS) PROJECT_OF[W.victory] = W;
const SKYWARD = PROJECTS.map(p => p.key);
const VIC = {};

function isWonder(key) { const B = BUILDINGS[BLDI[key]]; return !!(B && B.wonder); }
function isProject(key) { const B = BUILDINGS[BLDI[key]]; return !!(B && B.project); }
// Wonders a player currently owns (follows colony ownership). Cached on the player; refreshed on any change.
function refreshWonders(G) {
  for (const P of G.players) P._wonders = [];
  for (const c of G.cities) for (const k of c.buildings) if (isWonder(k)) G.players[c.owner]._wonders.push(k);
  for (const P of G.players) { P._wonders.sort(); P._fx = null; }
  G._att = null;
}
function wonderFxList(P) { return (P._wonders || []).map(k => BUILDINGS[BLDI[k]].fx || {}); }
function projectsOf(G, pid) { const out = []; for (const c of G.cities) if (c.owner === pid) for (const k of c.buildings) if (isProject(k)) out.push(k); return out; }
function projectBuilt(G, pid, key) { return G.cities.some(c => c.owner === pid && c.buildings.includes(key)); }
// Dominion: hold the first colonies of half of the rival factions (rounded down, at least one) for a while.
function domNeed(G, pid) { return Math.max(1, Math.floor((majorPlayers(G).length - 1) / 2)); }
function domTurns(G) { return Math.max(6, Math.round(10 * Math.max(0.7, paceOf(G)))); }
function domHeld(G, pid) { return G.cities.filter(c => c.origCap !== undefined && c.origCap !== pid && !isBarb(G, c.origCap) && !G.players[c.origCap].minor && c.owner === pid).length; }
function projectCity(G, pid, key) { return G.cities.find(c => c.owner === pid && c.buildings.includes(key)) || null; }
function clockNeed(G, B) { return Math.max(6, Math.round(B.turns * Math.max(0.7, paceOf(G)))); }

// Can this colony start this wonder or project?
function wonderStatus(G, c, B) {
  const P = G.players[c.owner];
  if (B.wonder) {
    const w = G.wonders[B.key];
    if (w) return { ok: false, why: `Built by the ${CIVS[G.players[w.pid].civ].name}.` };
  }
  if (B.project) {
    if (!G.cfg.victories[B.victory]) return { ok: false, why: 'That victory is turned off.' };
    if (projectBuilt(G, c.owner, B.key)) return { ok: false, why: 'Already built.' };
    if (B.aff && !affOk(P, B.aff)) return { ok: false, why: `Needs ${AFFINITIES[AFFI[B.aff[0]]].name} level ${B.aff[1]} (you have ${affLevel(P, B.aff[0])}).` };
    if (B.needVaults && (P.vaults || []).length < B.needVaults) return { ok: false, why: `Needs ${B.needVaults} decoded Echo Vaults (you have ${(P.vaults || []).length}).` };
  }
  const other = G.cities.find(x => x !== c && x.owner === c.owner && ((x.build && x.build.key === B.key) || x.queue.some(q => q.key === B.key)));
  if (other) return { ok: false, why: `Already under way in ${other.name}.` };
  return { ok: true };
}
// Called when a colony finishes a wonder or project.
function onGreatWork(G, c, key) {
  const B = BUILDINGS[BLDI[key]], P = G.players[c.owner];
  if (B.wonder) {
    G.wonders[key] = { pid: c.owner, city: c.id, turn: G.turn };
    const once = B.once || {};
    if (once.freeTech) {
      const tk = P.research && !hasTech(P, P.research) ? P.research : availableTechs(P)[0];
      if (tk) learnTech(G, c.owner, tk);
    }
    if (once.freePolicy) P.culturePool += policyCost(G, c.owner);
    for (const x of G.cities) {
      if (x.owner === c.owner && x === c) continue;
      if (x.build && x.build.key === key) {
        x.build = null; while (x.queue.length && !x.build) { const nx = x.queue.shift(); if (canBuildItem(G, x, nx).ok) x.build = nx; }
        if (G.players[x.owner].human) logEvent(G, x.owner, `${x.name} lost the race for the ${B.name}. Its ${Math.floor(x.prod)} production carries over to the next build.`, x.tile);
      }
      x.queue = x.queue.filter(q => q.key !== key);
    }
    for (const Q of G.players) if (Q.human && Q.id !== c.owner) logEvent(G, Q.id, Q.met.includes(c.owner) ? `The ${CIVS[P.civ].name} completed the ${B.name}.` : `A distant faction completed the ${B.name}.`, -1);
    refreshWonders(G);
  } else if (B.project) {
    P.clock = P.clock || {}; P.clock[B.victory] = 0;
    for (const Q of G.players) if (Q.human && !Q.barbarian) logEvent(G, Q.id, Q.id === c.owner ? `${B.name} is complete in ${c.name}. Hold it for ${clockNeed(G, B)} turns to win.` :
      `Warning: the ${Q.met.includes(c.owner) ? CIVS[P.civ].name : 'unknown faction'} completed ${B.name} in ${Q.explored[c.tile] ? c.name : 'a distant colony'}. Capture it within ${clockNeed(G, B)} turns, or they win a ${victoryName(B.victory)} victory!`, Q.explored[c.tile] ? c.tile : -1);
  }
}
// The Convergence uplink takes a share of science while it runs.
function uplinkShare(G, pid) { return projectBuilt(G, pid, 'lattice_core') ? 0.25 : 0; }
// Once per round: projects act on the world.
function projectRound(G) {
  const g = G._grid, m = G.map;
  for (const c of G.cities) {
    if (c.buildings.includes('heartbloom')) { let n = 0; for (const t of g.within(c.tile, 2)) { if (n >= 2) break; if (!m.veil[t] && t !== c.tile && passableTerrain(G, t) && !G._cityAt.has(t)) { m.veil[t] = 1; n++; } } }
    if (c.buildings.includes('genesis_engine')) { let n = 0; for (const x of G.cities) if (x.owner === c.owner) for (const t of x.tiles) { if (n >= 4) break; if (m.veil[t]) { scourVeil(G, c.owner, t); n++; } } }
  }
}

// ---- score ----
function scoreOf(G, pid) {
  const P = G.players[pid]; if (!P.alive) return 0;
  const cs = G.cities.filter(c => c.owner === pid);
  let land = 0; for (const c of cs) land += c.tiles.length;
  const pop = cs.reduce((a, c) => a + c.pop, 0), aff = affLevels(P).reduce((a, b) => a + b, 0);
  return Math.round(cs.length * 8 + pop * 2 + P.techs.length * 4 + (P._wonders || []).length * 20 + P.policies.length * 3 + P.treesDone.length * 6
    + land / 8 + aff * 3 + (P.vaults || []).length * 10 + projectsOf(G, pid).length * 25);
}
function scoreParts(G, pid) {
  const P = G.players[pid], cs = G.cities.filter(c => c.owner === pid);
  let land = 0; for (const c of cs) land += c.tiles.length;
  return [['Colonies', cs.length * 8], ['Citizens', cs.reduce((a, c) => a + c.pop, 0) * 2], ['Technologies', P.techs.length * 4], ['Wonders', (P._wonders || []).length * 20],
    ['Virtues and synergies', P.policies.length * 3 + P.treesDone.length * 6], ['Territory', Math.round(land / 8)], ['Affinity levels', affLevels(P).reduce((a, b) => a + b, 0) * 3],
    ['Echo Vaults', (P.vaults || []).length * 10], ['Victory projects', projectsOf(G, pid).length * 25]];
}

// ---- victory progress (0..1) and text, per type ----
function victoryProgress(G, pid) {
  const P = G.players[pid], majors = majorPlayers(G), alive = majors.filter(Q => Q.alive);
  const out = {};
  const caps = G.cities.filter(c => c.origCap !== undefined && c.origCap !== pid && !isBarb(G, c.origCap) && !G.players[c.origCap].minor);
  const held = caps.filter(c => c.owner === pid).length, needC = domNeed(G, pid), dc = (P.clock && P.clock.domination) || 0, dn = domTurns(G);
  out.domination = { pct: needC ? Math.min(1, held / needC) * 0.7 + Math.min(1, dc / dn) * 0.3 : 0, text: `${held} of ${needC} rival first colonies needed` + (held >= needC ? `; held ${dc} of ${dn} turns` : ''), clock: dc, need: dn, built: held >= needC };
  for (const W of PROJECTS) {
    const v = W.victory, built = projectBuilt(G, pid, W.key), need = clockNeed(G, W), clock = (P.clock && P.clock[v]) || 0;
    const tech = hasTech(P, W.tech), lv = W.aff ? affLevel(P, W.aff[0]) : 0;
    let pct, text;
    if (built) { pct = 0.7 + 0.3 * Math.min(1, clock / need); text = `${W.name} built: ${clock} of ${need} turns held` + (v === 'genesis' && veilInBorders(G, pid) > 10 ? ` (paused: ${veilInBorders(G, pid)} Veil tiles in your land)` : ''); }
    else if (W.aff) { pct = Math.min(1, lv / W.aff[1]) * 0.45 + (tech ? 0.2 : 0); text = `${AFFINITIES[AFFI[W.aff[0]]].name} ${lv} of ${W.aff[1]}; ${tech ? `${TECHS[TECHI[W.tech]].name} known: build ${W.name}` : `research ${TECHS[TECHI[W.tech]].name}`}`; }
    else { const nv = Math.min(3, (P.vaults || []).length); pct = (tech ? 0.25 : 0) + nv / 3 * 0.4; text = `${nv} of 3 Echo Vaults decoded; ` + (tech ? 'Deep Resonance known' : 'research Deep Resonance') + (tech && nv >= 3 ? ': build the Listening Array' : ''); }
    out[v] = { pct, text, clock, need, built };
  }
  out.score = { pct: 0, text: `Score ${scoreOf(G, pid)}. Highest score wins on turn ${G.cfg.turnLimit}` };
  const best = Math.max(1, ...alive.map(Q => scoreOf(G, Q.id))); out.score.pct = scoreOf(G, pid) / best;
  return out;
}
function checkVictory(G, pid) {
  const P = G.players[pid], V = G.cfg.victories, majors = majorPlayers(G), alive = majors.filter(Q => Q.alive);
  if (!P.alive) return null;
  if (V.domination) {
    if (((P.clock && P.clock.domination) || 0) >= domTurns(G)) return 'domination';
    if (alive.length === 1 && majors.length > 1) return 'domination';
  }
  for (const W of PROJECTS) if (V[W.victory] && projectBuilt(G, pid, W.key) && ((P.clock && P.clock[W.victory]) || 0) >= clockNeed(G, W)) return W.victory;
  return null;
}
// ---- once per round ----
function victoryRound(G) {
  refreshWonders(G);
  if (G.turn % 2 === 0) {
    G.hist.t.push(G.turn);
    for (const P of G.players) {
      if (P.barbarian || P.minor) continue;
      const arr = G.hist.p[P.id] || (G.hist.p[P.id] = []);
      const cs = G.cities.filter(c => c.owner === P.id);
      arr.push([scoreOf(G, P.id), Math.round(P.lastSci || 0), Math.round(P.lastCul || 0), Math.round(militaryPower(G, P.id)), cs.length, cs.reduce((a, c) => a + c.pop, 0), P.techs.length, Math.round(P.gold)]);
    }
  }
  // project clocks: a captured project is lost; the clock resets
  for (const P of majorPlayers(G)) {
    if (!P.alive) continue;
    P.clock = P.clock || {};
    const dh = domHeld(G, P.id) >= domNeed(G, P.id) && majorPlayers(G).length > 1;
    const was = P.clock.domination || 0; P.clock.domination = dh ? was + 1 : 0;
    if (dh && P.clock.domination === 1) for (const Q of G.players) if (Q.human) logEvent(G, Q.id, Q.id === P.id ? `You hold enough rival first colonies for Dominion. Keep them for ${domTurns(G)} turns.` : `Warning: the ${Q.met.includes(P.id) ? CIVS[P.civ].name : 'unknown faction'} hold half the rival first colonies. In ${domTurns(G)} turns they win a Dominion victory.`, -1);
    for (const W of PROJECTS) {
      const v = W.victory;
      if (!projectBuilt(G, P.id, W.key)) { P.clock[v] = 0; continue; }
      if (v === 'genesis' && veilInBorders(G, P.id) > 10) continue;
      P.clock[v] = (P.clock[v] || 0) + 1;
      const need = clockNeed(G, W);
      if (P.clock[v] === need - 3) for (const Q of G.players) if (Q.human && Q.id !== P.id) logEvent(G, Q.id, `Warning: the ${Q.met.includes(P.id) ? CIVS[P.civ].name : 'unknown faction'} will win a ${victoryName(v)} victory in 3 turns unless ${W.name} is taken.`, -1);
    }
  }
  // a captured project burns: it cannot be used by its new owner
  for (const c of G.cities) for (const W of PROJECTS) if (c.buildings.includes(W.key) && c.projOwner !== undefined && c.projOwner !== c.owner) { c.buildings = c.buildings.filter(k => k !== W.key); }
  for (const c of G.cities) if (PROJECTS.some(W => c.buildings.includes(W.key))) c.projOwner = c.owner;
  if (G.over) return;
  for (const P of majorPlayers(G)) { const v = checkVictory(G, P.id); if (v) return endGame(G, P.id, v); }
  if (G.turn > G.cfg.turnLimit) {
    const alive = majorPlayers(G).filter(Q => Q.alive).sort((a, b) => scoreOf(G, b.id) - scoreOf(G, a.id));
    return endGame(G, alive[0].id, G.cfg.victories.score ? 'score' : 'time');
  }
  for (const P of majorPlayers(G)) {
    if (!P.alive || P.human) continue;
    for (const W of PROJECTS) {
      const key = 'start' + W.key + P.id;
      if (G.warned.includes(key)) continue;
      const c = G.cities.find(x => x.owner === P.id && x.build && x.build.key === W.key);
      if (!c) continue;
      G.warned.push(key);
      for (const Q of G.players) if (Q.human) logEvent(G, Q.id, `Warning: ${Q.met.includes(P.id) ? 'the ' + CIVS[P.civ].name : 'an unknown faction'} began ${W.name}. Finish your own victory first, or prepare to take ${Q.explored[c.tile] ? c.name : 'their colony'}.`, -1);
    }
  }
}
function endGame(G, pid, type) {
  G.over = { winner: pid, type, turn: G.turn, seen: false };
  for (const Q of G.players) if (Q.human) logEvent(G, Q.id, pid === Q.id ? `Victory! You won a ${victoryName(type)} victory.` : `The ${CIVS[G.players[pid].civ].name} won a ${victoryName(type)} victory.`, -1);
}
function victoryName(type) { const v = VICTORIES.find(x => x.key === type); return v ? v.name : type === 'time' ? 'time' : type; }

Object.assign(HX, { WONDERS, PROJECTS, PROJECT_OF, SKYWARD, isWonder, isProject, scoreOf, scoreParts, victoryProgress, checkVictory, victoryName, projectBuilt, projectCity, refreshWonders, wonderStatus, clockNeed, uplinkShare });
