// ===== victory.js : world wonders, great projects, score, victory, history =====
// Wonders are one-per-world buildings; projects are one-per-civ buildings that drive victories.
// fx keys reuse the policy effect system (see polFx); once = one-time effects on completion.
const WONDERS = [
  { key: 'stone_circle', name: 'Stone Circle', tech: 'mysticism', cost: 150, y: { fa: 3, c: 1 }, fx: { templeFaith: 1 }, glyph: '🪨', desc: '+3 faith, +1 culture. Temples in all your cities give +1 faith.' },
  { key: 'terraced_gardens', name: 'Terraced Gardens', tech: 'pottery', cost: 170, y: { f: 3 }, fx: { keepFood: 5 }, glyph: '🌿', desc: '+3 food. All your cities keep 5% more food when they grow.' },
  { key: 'tide_colossus', name: 'Tide Colossus', tech: 'bronze_working', cost: 180, coastal: true, y: { g: 3 }, fx: { routeGold: 1 }, glyph: '🗽', desc: '+3 gold. Your trade routes give +1 gold. Coastal city.' },
  { key: 'archive_of_ages', name: 'Archive of Ages', tech: 'writing', cost: 190, y: { s: 3 }, once: { freeTech: 1 }, glyph: '📜', desc: '+3 science. Finishes your current research.' },
  { key: 'builders_ziggurat', name: "Builders' Ziggurat", tech: 'masonry', cost: 230, y: { p: 2, c: 1 }, fx: { cityProd: 1 }, glyph: '🛕', desc: '+2 production, +1 culture. +1 production in every city you own.' },
  { key: 'hall_of_champions', name: 'Hall of Champions', tech: 'iron_working', cost: 220, y: { p: 1, c: 1 }, fx: { xp: 15 }, glyph: '🏟️', desc: 'All new military units start with +15 experience.' },
  { key: 'oracle_spring', name: 'Oracle Spring', tech: 'philosophy', cost: 260, y: { c: 3, fa: 2 }, once: { freePolicy: 1 }, glyph: '⛲', desc: '+3 culture, +2 faith. Grants culture for one free policy.' },
  { key: 'star_dial', name: 'Star Dial', tech: 'calendar', cost: 240, y: { s: 2, f: 2 }, fx: { specSci: 1 }, glyph: '🌗', desc: '+2 science, +2 food. Specialists give +1 science.' },
  { key: 'grand_circus', name: 'Grand Circus', tech: 'construction', cost: 260, h: 4, fx: { venueHappy: 1 }, glyph: '🎪', desc: '+4 happiness. Each Amphitheater and Arena gives +1 more.' },
  { key: 'beacon_of_tides', name: 'Beacon of Tides', tech: 'shipbuilding', cost: 250, coastal: true, y: { p: 1, g: 2 }, fx: { navalMoves: 1 }, glyph: '🗼', desc: '+2 gold, +1 production. All your ships get +1 move. Coastal city.' },
  { key: 'jade_court', name: 'Jade Court', tech: 'civil_service', cost: 330, h: 2, y: { c: 2 }, fx: { happy: 4 }, glyph: '🏯', desc: '+2 culture, +6 happiness in total.' },
  { key: 'grand_basilica', name: 'Grand Basilica', tech: 'theology', cost: 360, y: { fa: 4, c: 2 }, fx: { faithPct: 15 }, glyph: '⛪', desc: '+4 faith, +2 culture. +15% faith in every city.' },
  { key: 'knights_citadel', name: "Knights' Citadel", tech: 'chivalry', cost: 360, y: { p: 2 }, fx: { milProdPct: 15 }, glyph: '🏰', desc: '+2 production. +15% production toward military units everywhere.' },
  { key: 'scholars_tower', name: "Scholars' Tower", tech: 'education', cost: 400, y: { s: 4 }, fx: { sciPct: 10 }, glyph: '🎓', desc: '+4 science. +10% science in every city.' },
  { key: 'golden_bazaar', name: 'Golden Bazaar', tech: 'banking', cost: 460, y: { g: 5 }, fx: { goldPct: 10 }, glyph: '🪙', desc: '+5 gold. +10% gold in every city.' },
  { key: 'celestial_lens', name: 'Celestial Lens', tech: 'astronomy', cost: 480, y: { s: 5 }, once: { freeTech: 1 }, glyph: '🔭', desc: '+5 science. Finishes your current research.' },
  { key: 'admirals_compass', name: "Admiral's Compass", tech: 'navigation', cost: 470, coastal: true, y: { g: 2, p: 2 }, fx: { navalMoves: 1, routeGold: 1 }, glyph: '🧭', desc: '+2 gold, +2 production. Ships +1 move, trade routes +1 gold. Coastal city.' },
  { key: 'gallery_of_muses', name: 'Gallery of Muses', tech: 'humanism', cost: 520, y: { c: 5 }, fx: { culPct: 15 }, glyph: '🖼️', desc: '+5 culture. +15% culture in every city.' },
  { key: 'grand_arsenal', name: 'Grand Arsenal', tech: 'gunpowder', cost: 500, y: { p: 3 }, fx: { milProdPct: 20, xp: 10 }, glyph: '💣', desc: '+3 production. Military units are built 20% faster and start with +10 experience.' },
  { key: 'clockwork_foundry', name: 'Clockwork Foundry', tech: 'industrialization', cost: 700, y: { p: 6 }, fx: { prodPct: 10 }, glyph: '⚙️', desc: '+6 production. +10% production in every city.' },
  { key: 'tower_of_accord', name: 'Tower of Accord', tech: 'economics', cost: 680, y: { c: 3, g: 3 }, fx: { attBonus: 2 }, glyph: '🕊️', desc: '+3 culture, +3 gold. Every civilization feels 2 points warmer toward you.' },
  { key: 'lightning_spire', name: 'Lightning Spire', tech: 'electricity', cost: 820, y: { s: 4, p: 4 }, fx: { sciPct: 10 }, glyph: '⚡', desc: '+4 science, +4 production. +10% science in every city.' },
  { key: 'cloud_harbor', name: 'Cloud Harbor', tech: 'flight', cost: 900, y: { g: 6 }, fx: { goldPct: 10, attBonus: 1 }, glyph: '🛩️', desc: '+6 gold. +10% gold everywhere, and every civilization feels 1 point warmer toward you.' },
  { key: 'peoples_hall', name: "People's Hall", tech: 'sanitation', cost: 720, h: 4, fx: { happyPerCity: 1 }, glyph: '🏛️', desc: '+4 happiness, plus +1 for every city you own.' },
];
const PROJECTS = [
  { key: 'hall_of_nations', name: 'Hall of Nations', tech: 'economics', cost: 650, glyph: '🌐', victory: 'diplomacy', desc: 'Starts the diplomatic clock: stay allied with at least half of the surviving civilizations for 20 turns.' },
  { key: 'grand_exhibition', name: 'Grand Exhibition', tech: 'humanism', cost: 1900, glyph: '🎭', victory: 'culture', needTrees: 4, desc: 'Culture victory. Needs four completed policy trees.' },
  { key: 'skyward_gantry', name: 'Skyward Gantry', tech: 'grand_theory', cost: 850, glyph: '🏗️', victory: 'science', desc: 'Part 1 of 3 of the Skyward Project. Science victory when all three parts are built.' },
  { key: 'skyward_habitat', name: 'Skyward Habitat', tech: 'grand_theory', cost: 850, glyph: '🛰️', victory: 'science', desc: 'Part 2 of 3 of the Skyward Project.' },
  { key: 'skyward_engine', name: 'Skyward Engine', tech: 'grand_theory', cost: 850, glyph: '🚀', victory: 'science', desc: 'Part 3 of 3 of the Skyward Project.' },
];
for (const W of WONDERS) BUILDINGS.push(Object.assign({ wonder: true, upkeep: 0 }, W));
for (const W of PROJECTS) BUILDINGS.push(Object.assign({ project: true, upkeep: 0 }, W));
for (const B of BUILDINGS) BLDI[B.key] = BUILDINGS.indexOf(B);
const SKYWARD = ['skyward_gantry', 'skyward_habitat', 'skyward_engine'];
const VIC = { dipTurns: 20, relShare: 0.6, relTurns: 15 };

function isWonder(key) { const B = BUILDINGS[BLDI[key]]; return !!(B && B.wonder); }
function isProject(key) { const B = BUILDINGS[BLDI[key]]; return !!(B && B.project); }
// Wonders a player currently owns (follows city ownership). Cached on the player; refreshed on any change.
function refreshWonders(G) {
  for (const P of G.players) P._wonders = [];
  for (const c of G.cities) for (const k of c.buildings) if (isWonder(k)) G.players[c.owner]._wonders.push(k);
  for (const P of G.players) { P._wonders.sort(); P._fx = null; }
  G._att = null;
}
function wonderFxList(P) { return (P._wonders || []).map(k => BUILDINGS[BLDI[k]].fx || {}); }
function projectsOf(G, pid) { const out = []; for (const c of G.cities) if (c.owner === pid) for (const k of c.buildings) if (isProject(k)) out.push(k); return out; }
function projectBuilt(G, pid, key) { return G.cities.some(c => c.owner === pid && c.buildings.includes(key)); }

// Can this city start this wonder or project?
function wonderStatus(G, c, B) {
  const P = G.players[c.owner];
  if (B.wonder) {
    const w = G.wonders[B.key];
    if (w) return { ok: false, why: `Built by the ${CIVS[G.players[w.pid].civ].name}.` };
  }
  if (B.project) {
    if (!G.cfg.victories[B.victory]) return { ok: false, why: 'That victory is turned off.' };
    if (projectBuilt(G, c.owner, B.key)) return { ok: false, why: 'Already built.' };
    if (B.needTrees && P.treesDone.length < B.needTrees) return { ok: false, why: `Needs ${B.needTrees} completed policy trees (you have ${P.treesDone.length}).` };
  }
  const other = G.cities.find(x => x !== c && x.owner === c.owner && ((x.build && x.build.key === B.key) || x.queue.some(q => q.key === B.key)));
  if (other) return { ok: false, why: `Already under way in ${other.name}.` };
  return { ok: true };
}
// Called when a city finishes a wonder or project.
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
    // everyone else loses the race; their production stays in the city
    for (const x of G.cities) {
      if (x.owner === c.owner && x === c) continue;
      if (x.build && x.build.key === key) {
        x.build = null; while (x.queue.length && !x.build) { const nx = x.queue.shift(); if (canBuildItem(G, x, nx).ok) x.build = nx; }
        if (G.players[x.owner].human) logEvent(G, x.owner, `${x.name} lost the race for the ${B.name}. Its ${Math.floor(x.prod)} production carries over to the next build.`, x.tile);
      }
      x.queue = x.queue.filter(q => q.key !== key);
    }
    for (const Q of G.players) if (Q.human && Q.id !== c.owner) logEvent(G, Q.id, Q.met.includes(c.owner) ? `The ${CIVS[P.civ].name} completed the ${B.name}.` : `A distant civilization completed the ${B.name}.`, -1);
    refreshWonders(G);
  } else if (B.project) {
    for (const Q of G.players) if (Q.human && Q.id !== c.owner && !Q.barbarian) logEvent(G, Q.id, `The ${Q.met.includes(c.owner) ? CIVS[P.civ].name : 'unknown civilization'} built the ${B.name}${B.victory === 'science' ? ` (${SKYWARD.filter(k => projectBuilt(G, c.owner, k)).length} of 3 Skyward parts)` : ''}.`, -1);
  }
}

// ---- score ----
function scoreOf(G, pid) {
  const P = G.players[pid]; if (!P.alive) return 0;
  const cs = G.cities.filter(c => c.owner === pid);
  let land = 0; for (const c of cs) land += c.tiles.length;
  const pop = cs.reduce((a, c) => a + c.pop, 0);
  const relCities = P.religion !== null ? G.cities.filter(c => cityReligion(G, c).major === P.religion).length : 0;
  return Math.round(cs.length * 8 + pop * 2 + P.techs.length * 4 + (P._wonders || []).length * 20 + P.policies.length * 3 + P.treesDone.length * 10
    + land / 8 + (P.religion !== null ? 10 + relCities : 0) + projectsOf(G, pid).length * 25);
}
function scoreParts(G, pid) {
  const P = G.players[pid], cs = G.cities.filter(c => c.owner === pid);
  let land = 0; for (const c of cs) land += c.tiles.length;
  const relCities = P.religion !== null ? G.cities.filter(c => cityReligion(G, c).major === P.religion).length : 0;
  return [['Cities', cs.length * 8], ['Citizens', cs.reduce((a, c) => a + c.pop, 0) * 2], ['Technologies', P.techs.length * 4], ['Wonders', (P._wonders || []).length * 20],
    ['Policies', P.policies.length * 3 + P.treesDone.length * 10], ['Territory', Math.round(land / 8)], ['Religion', P.religion !== null ? 10 + relCities : 0], ['Great projects', projectsOf(G, pid).length * 25]];
}

// ---- victory progress (0..1) and text, per type ----
function victoryProgress(G, pid) {
  const P = G.players[pid], majors = majorPlayers(G), alive = majors.filter(Q => Q.alive), rivals = majors.filter(Q => Q.id !== pid);
  const out = {};
  // domination: hold every rival's original capital
  const caps = G.cities.filter(c => c.origCap !== undefined && c.origCap !== pid && !isBarb(G, c.origCap) && !G.players[c.origCap].minor);
  const held = caps.filter(c => c.owner === pid).length;
  out.domination = { pct: caps.length ? held / caps.length : 0, text: `${held} of ${caps.length} rival capitals held` };
  // science
  const parts = SKYWARD.filter(k => projectBuilt(G, pid, k)).length;
  const gt = hasTech(P, 'grand_theory');
  out.science = { pct: (P.techs.length / TECHS.length) * 0.6 + parts / 3 * 0.4, text: gt ? `Skyward Project: ${parts} of 3 parts built` : `${P.techs.length} of ${TECHS.length} technologies; Grand Theory unlocks the Skyward Project` };
  // culture
  const ex = projectBuilt(G, pid, 'grand_exhibition');
  out.culture = { pct: Math.min(4, P.treesDone.length) / 4 * 0.8 + (ex ? 0.2 : 0), text: `${P.treesDone.length} of 4 policy trees complete${P.treesDone.length >= 4 ? '; build the Grand Exhibition' : ''}` };
  // religion
  if (P.religion === null) out.religion = { pct: 0, text: 'Found a religion first' };
  else {
    let civsWon = 0; const lines = [];
    for (const Q of alive) {
      const cs = G.cities.filter(c => c.owner === Q.id); if (!cs.length) continue;
      const n = cs.filter(c => cityReligion(G, c).major === P.religion).length;
      if (n / cs.length > VIC.relShare) civsWon++;
    }
    const need = alive.filter(Q => G.cities.some(c => c.owner === Q.id)).length, hold = Math.round(VIC.relTurns * paceOf(G));
    const all = need && civsWon >= need;
    out.religion = { pct: need ? (civsWon / need) * 0.8 + (all ? Math.min(1, (P.relTurns || 0) / hold) * 0.2 : 0) : 0, full: all,
      text: `${relById(G, P.religion).name} is followed in over 60% of the cities of ${civsWon} of ${need} civilizations` + (all ? `; held ${P.relTurns || 0} of ${hold} turns` : '') + (hasTech(P, 'theology') ? '' : '. Needs Theology') };
  }
  // diplomacy
  const others = alive.filter(Q => Q.id !== pid), allies = others.filter(Q => allied(G, pid, Q.id)).length, needA = Math.max(1, Math.ceil(others.length / 2));
  const hall = projectBuilt(G, pid, 'hall_of_nations');
  out.diplomacy = { pct: hall ? Math.min(1, allies / needA) * 0.5 + Math.min(1, (P.dipTurns || 0) / Math.round(VIC.dipTurns * paceOf(G))) * 0.5 : Math.min(1, allies / needA) * 0.3,
    text: hall ? `${allies} of ${needA} allies needed; ${P.dipTurns || 0} of ${Math.round(VIC.dipTurns * paceOf(G))} turns held` : `${allies} of ${needA} allies. Build the Hall of Nations to start the clock` };
  out.score = { pct: 0, text: `Score ${scoreOf(G, pid)}. Highest score wins on turn ${G.cfg.turnLimit}` };
  const best = Math.max(1, ...alive.map(Q => scoreOf(G, Q.id))); out.score.pct = scoreOf(G, pid) / best;
  return out;
}
function checkVictory(G, pid) {
  const P = G.players[pid], V = G.cfg.victories, majors = majorPlayers(G), alive = majors.filter(Q => Q.alive);
  if (!P.alive) return null;
  if (V.domination) {
    const caps = G.cities.filter(c => c.origCap !== undefined && c.origCap !== pid && !isBarb(G, c.origCap) && !G.players[c.origCap].minor);
    if (majors.length > 1 && caps.length && caps.every(c => c.owner === pid)) return 'domination';
    if (alive.length === 1 && majors.length > 1) return 'domination';
  }
  if (V.science && SKYWARD.every(k => projectBuilt(G, pid, k))) return 'science';
  if (V.culture && projectBuilt(G, pid, 'grand_exhibition')) return 'culture';
  if (V.religion && P.religion !== null && alive.length >= 2 && hasTech(P, 'theology') && (P.relTurns || 0) >= Math.round(VIC.relTurns * paceOf(G))) return 'religion';
  if (V.diplomacy && (P.dipTurns || 0) >= Math.round(VIC.dipTurns * paceOf(G))) return 'diplomacy';
  return null;
}
// ---- once per round ----
function victoryRound(G) {
  refreshWonders(G);
  // history every other turn
  if (G.turn % 2 === 0) {
    G.hist.t.push(G.turn);
    for (const P of G.players) {
      if (P.barbarian) continue;
      const arr = G.hist.p[P.id] || (G.hist.p[P.id] = []);
      const cs = G.cities.filter(c => c.owner === P.id);
      arr.push([scoreOf(G, P.id), Math.round(P.lastSci || 0), Math.round(P.lastCul || 0), Math.round(militaryPower(G, P.id)), cs.length, cs.reduce((a, c) => a + c.pop, 0), P.techs.length, Math.round(P.gold)]);
    }
  }
  // diplomatic clock
  for (const P of majorPlayers(G)) {
    if (!P.alive) continue;
    const others = majorPlayers(G).filter(Q => Q.alive && Q.id !== P.id), allies = others.filter(Q => allied(G, P.id, Q.id)).length;
    const ok = projectBuilt(G, P.id, 'hall_of_nations') && others.length && allies >= Math.max(1, Math.ceil(others.length / 2));
    P.dipTurns = ok ? (P.dipTurns || 0) + 1 : 0;
    const rp = P.religion !== null && G.cfg.victories.religion ? victoryProgress(G, P.id).religion : null;
    const was = P.relTurns || 0;
    P.relTurns = rp && rp.full && hasTech(P, 'theology') ? was + 1 : 0;
    if (P.relTurns === 1) for (const Q of G.players) if (Q.human) logEvent(G, Q.id, Q.id === P.id ? `Your faith now leads in every civilization. Hold it for ${Math.round(VIC.relTurns * paceOf(G))} turns to win.` : `Warning: the ${Q.met.includes(P.id) ? CIVS[P.civ].name : 'unknown'} faith leads in every civilization. Use Inquisitors, your own Missionaries or war to stop a religious victory.`, -1);
  }
  if (G.over) return;
  for (const P of majorPlayers(G)) { const v = checkVictory(G, P.id); if (v) return endGame(G, P.id, v); }
  if (G.turn > G.cfg.turnLimit) {
    const alive = majorPlayers(G).filter(Q => Q.alive).sort((a, b) => scoreOf(G, b.id) - scoreOf(G, a.id));
    return endGame(G, alive[0].id, G.cfg.victories.score ? 'score' : 'time');
  }
  // warnings when someone is close
  for (const P of majorPlayers(G)) {
    if (!P.alive || P.human) continue;
    const parts = SKYWARD.filter(k => projectBuilt(G, P.id, k)).length;
    const key = 'warn' + P.id + parts;
    if (parts === 2 && !G.warned.includes(key)) { G.warned.push(key); for (const Q of G.players) if (Q.human) logEvent(G, Q.id, `Warning: the ${CIVS[P.civ].name} have two of three Skyward parts. Capture their capital or win first!`, -1); }
  }
}
function endGame(G, pid, type) {
  G.over = { winner: pid, type, turn: G.turn, seen: false };
  for (const Q of G.players) if (Q.human) logEvent(G, Q.id, pid === Q.id ? `Victory! You won a ${victoryName(type)} victory.` : `The ${CIVS[G.players[pid].civ].name} won a ${victoryName(type)} victory.`, -1);
}
function victoryName(type) { const v = VICTORIES.find(x => x.key === type); return v ? v.name : type === 'time' ? 'time' : type; }

Object.assign(HX, { WONDERS, PROJECTS, SKYWARD, isWonder, isProject, scoreOf, scoreParts, victoryProgress, checkVictory, victoryName, projectBuilt, refreshWonders, wonderStatus });
