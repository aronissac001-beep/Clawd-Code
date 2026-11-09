// ===== citystates.js : Free Cities. Single-city minor powers you can befriend with gold, or conquer. =====
const MINOR_TYPES = {
  cultural: { name: 'Cultural', glyph: '🎭', what: 'culture' },
  scientific: { name: 'Scholarly', glyph: '🔬', what: 'science' },
  mercantile: { name: 'Mercantile', glyph: '💰', what: 'gold' },
  maritime: { name: 'Maritime', glyph: '🌾', what: 'food in your capital' },
  religious: { name: 'Devout', glyph: '🙏', what: 'faith' },
  militaristic: { name: 'Martial', glyph: '⚔️', what: 'a free military unit every 12 turns (ally only)' },
};
const MINOR_DEFS = [
  ['valemont', 'Valemont', 'cultural', '#d9a8e8'], ['lumenhall', 'Lumenhall', 'scientific', '#9ec7ff'], ['brassmouth', 'Brassmouth', 'mercantile', '#f0cf6a'],
  ['saltreach', 'Saltreach', 'maritime', '#7fe0c7'], ['hollowmere', 'Hollowmere', 'religious', '#f2f0e6'], ['kestrel_hold', 'Kestrel Hold', 'militaristic', '#e88f7a'],
  ['oriel', 'Oriel', 'cultural', '#c792ea'], ['quillford', 'Quillford', 'scientific', '#82b1ff'], ['marrowgate', 'Marrowgate', 'mercantile', '#e6c35c'],
  ['pelion', 'Pelion', 'maritime', '#64d8cb'], ['ashenvale', 'Ashenvale', 'religious', '#e8e2cf'], ['ironmoor', 'Ironmoor', 'militaristic', '#e57373'],
];
for (const [key, name, type, color] of MINOR_DEFS) CIVS.push({ key: 'free_' + key, name: 'Free City of ' + name, adj: name, leader: 'The Council of ' + name, color, dark: shadeHex(color), minor: type, cities: [name] });
CIVS.forEach((c, i) => { if (CIVI[c.key] === undefined) CIVI[c.key] = i; });
function shadeHex(c) { const n = parseInt(c.slice(1), 16), f = v => Math.round(v * 0.35).toString(16).padStart(2, '0'); return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255); }
PERSONA.minor = { f: 1.1, p: 1.1, g: 0.9, s: 1.0, c: 0.9, fa: 0.8, expand: 0, founder: [], follower: [], enhancer: [] };
const MINOR = { friend: 30, ally: 60, decay: 1, count: { small: 2, medium: 4, large: 6, huge: 8 } };
function isMinor(G, pid) { return pid >= 0 && !!G.players[pid].minor; }
function minorType(G, pid) { return CIVS[G.players[pid].civ].minor; }
// Placed at world creation, away from every start.
function addCityStates(G, starts) {
  if (G.cfg.cityStates === false) return;
  const want = MINOR.count[G.cfg.size] || 3, m = G.map, g = G._grid, rng = RNG.fromSeed(G.seed + '|free'), taken = starts.slice(), N = m.W * m.H;
  const defs = rng.shuffle(MINOR_DEFS.map((d, i) => i));
  const cands = []; for (let t = 0; t < N; t++) if (passableTerrain(G, t) && !TERRAIN[m.terrain[t]].water && m.res[t] < 0) cands.push(t);
  for (const di of defs) {
    if (G.players.filter(P => P.minor).length >= want) break;
    let best = -1, bs = -Infinity;
    for (let k = 0; k < 400; k++) {
      const t = cands[rng.int(cands.length)];
      if (taken.some(x => g.dist(x, t) < 7) || (G.natural || []).some(n => n.tile === t)) continue;
      const s = siteScore(m, g, t); if (s > bs) { bs = s; best = t; }
    }
    if (best < 0) continue;
    const pid = G.players.length, P = newPlayer(pid, CIVI['free_' + MINOR_DEFS[di][0]], false, N);
    P.minor = true; P.inf = {}; G.players.push(P); P._vis = new Uint8Array(N);
    const u = spawnUnit(G, 'settler', pid, best); const c = foundCity(G, u);
    if (!c) { removeUnit(G, u); G.players.pop(); continue; }
    taken.push(best);
    for (const type of ['archer', 'militia']) { const t = freeTileNear(G, best, type); if (t >= 0) spawnUnit(G, type, pid, t); }
  }
}
function influence(G, minor, pid) { return (G.players[minor].inf || {})[pid] || 0; }
function minorAlly(G, minor) { const inf = G.players[minor].inf || {}; let best = -1, bv = MINOR.ally - 0.01; for (const k in inf) if (inf[k] > bv && !atWar(G, +k, minor)) { bv = inf[k]; best = +k; } return best; }
function minorStatus(G, minor, pid) {
  if (atWar(G, pid, minor)) return 'war';
  if (minorAlly(G, minor) === pid) return 'ally';
  return influence(G, minor, pid) >= MINOR.friend ? 'friend' : 'neutral';
}
function giftInfluence(G, pid, gold) { return Math.round(gold / (2 + playerEra(G.players[pid]) * 0.5)); }
function giftGold(G, pid, minor, gold) {
  const P = G.players[pid], M = G.players[minor];
  if (!M.alive || !M.minor || atWar(G, pid, minor) || P.gold < gold || gold <= 0) return false;
  const before = minorStatus(G, minor, pid);
  P.gold -= gold; M.gold += Math.round(gold * 0.5);
  M.inf[pid] = Math.min(120, (M.inf[pid] || 0) + giftInfluence(G, pid, gold));
  const after = minorStatus(G, minor, pid);
  if (P.human && after !== before) logEvent(G, pid, `The ${CIVS[M.civ].name} ${after === 'ally' ? 'are now your allies' : 'now count you as friends'}.`, -1);
  return true;
}
// Once per round: influence decays, friends and allies receive their bonus.
function minorRound(G) {
  for (const M of G.players) {
    if (!M.minor || !M.alive) continue;
    const type = minorType(G, M.id), ally = minorAlly(G, M.id);
    for (const k in M.inf) {
      const pid = +k, Q = G.players[pid];
      if (!Q.alive) { delete M.inf[k]; continue; }
      if (atWar(G, pid, M.id)) { M.inf[k] = Math.min(M.inf[k], -40); continue; }
      M.inf[k] += M.inf[k] > 0 ? -MINOR.decay : 0.5;
      const st = pid === ally ? 2 : M.inf[k] >= MINOR.friend ? 1 : 0; if (!st) continue;
      const amt = st * (2 + playerEra(Q));
      if (type === 'cultural') Q.culturePool += amt;
      else if (type === 'scientific') { if (Q.research) Q.progress[Q.research] = (Q.progress[Q.research] || 0) + amt; }
      else if (type === 'mercantile') Q.gold += amt;
      else if (type === 'religious') Q.faith += amt;
      else if (type === 'maritime') { const cap = G.cities.find(c => c.owner === pid && c.capital); if (cap) cap.food += amt; }
      else if (type === 'militaristic' && st === 2 && (G.turn + M.id) % 12 === 0) {
        const cap = G.cities.find(c => c.owner === pid && c.capital); if (!cap) continue;
        const opts = availableItems(G, cap).filter(it => it.k === 'u' && UNITS[it.key].military && !UNITS[it.key].naval && UNITS[it.key].cls !== 'recon' && UNITS[it.key].cls !== 'siege');
        const best = opts.sort((a, b) => UNITS[b.key].str - UNITS[a.key].str)[0]; if (!best) continue;
        const t = spawnTileFor(G, cap, best.key); if (t < 0) continue;
        spawnUnit(G, best.key, pid, t); if (Q.human) logEvent(G, pid, `${CIVS[M.civ].name} sent you a ${UNITS[best.key].name}.`, t);
      }
    }
    // a free city keeps up with the world's knowledge
    const majors = majorPlayers(G).filter(P => P.alive);
    for (const T0 of TECHS) if (!hasTech(M, T0.key) && majors.filter(P => hasTech(P, T0.key)).length * 2 >= majors.length) M.techs.push(T0.key);
  }
}
// A free city defends itself and builds; it never starts wars.
function minorTurn(G, pid) {
  const mine = G.units.filter(u => u.owner === pid), military = [];
  for (const u of mine) { u.ai = u.ai || {}; if (UNITS[u.type].charges) aiBuilder(G, u); else if (isMil(u)) military.push(u); else if (UNITS[u.type].founds) removeUnit(G, u); }
  aiMilitaryTurn(G, pid, military);
  aiCityBombard(G, pid);
  // make peace when the war has gone on long enough
  for (const Q of majorPlayers(G)) if (atWar(G, pid, Q.id) && !Q.human && G.turn - warRecord(G, pid, Q.id).since > 12) makePeace(G, pid, Q.id);
  computeVisibility(G, pid);
}
// AI majors buy the friendship of free cities that suit them.
function aiCityStates(G, pid) {
  const P = G.players[pid]; if ((G.turn + pid) % 5 !== 0 || P.gold < 220) return;
  const w = personaOf(G, pid), pref = { cultural: w.c, scientific: w.s, mercantile: w.g, maritime: w.f, religious: w.fa, militaristic: (AGGRESSION[civKey(P)] || 1) };
  let best = -1, bs = 0;
  for (const M of G.players) {
    if (!M.minor || !M.alive || !P.met.includes(M.id) || atWar(G, pid, M.id)) continue;
    const inf = influence(G, M.id, pid); if (inf > 75) continue;
    const s = pref[minorType(G, M.id)] * (inf >= MINOR.friend - 15 ? 1.4 : 1); if (s > bs) { bs = s; best = M.id; }
  }
  if (best >= 0) giftGold(G, pid, best, Math.min(Math.floor(P.gold / 3), Math.round(120 * paceOf(G))));
}
Object.assign(HX, { MINOR_TYPES, MINOR, isMinor, minorType, influence, minorAlly, minorStatus, giftGold, giftInfluence });
