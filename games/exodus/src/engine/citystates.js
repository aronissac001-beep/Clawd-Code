// ===== citystates.js : independent Outposts. Late arks land over time; befriend them with credits and convoys, absorb them, or conquer them =====
const MINOR_TYPES = {
  cultural: { name: 'Sanctuary', glyph: '🕯️', what: 'culture' },
  scientific: { name: 'Research Station', glyph: '🔬', what: 'science' },
  mercantile: { name: 'Trading Post', glyph: '💠', what: 'credits' },
  maritime: { name: 'Hydro Hub', glyph: '🌾', what: 'food in your capital' },
  industrial: { name: 'Refinery', glyph: '🏭', what: 'production in your capital' },
  militaristic: { name: 'Militia Camp', glyph: '⚔️', what: 'a free military unit every 12 turns (ally only)' },
};
const MINOR_DEFS = [
  ['perihelion', 'Perihelion', 'cultural', '#d9a8e8'], ['nadir', 'Nadir Station', 'scientific', '#9ec7ff'], ['tollhaven', 'Tollhaven', 'mercantile', '#f0cf6a'],
  ['greenhouse_9', 'Greenhouse Nine', 'maritime', '#7fe0c7'], ['slagport', 'Slagport', 'industrial', '#f0a070'], ['redwatch', 'Redwatch', 'militaristic', '#e88f7a'],
  ['quietus', 'Quietus', 'cultural', '#c792ea'], ['aphelion', 'Aphelion Lab', 'scientific', '#82b1ff'], ['brokers_rest', "Broker's Rest", 'mercantile', '#e6c35c'],
  ['seawell', 'Seawell', 'maritime', '#64d8cb'], ['cinder_works', 'Cinder Works', 'industrial', '#e89060'], ['last_rampart', 'Last Rampart', 'militaristic', '#e57373'],
];
for (const [key, name, type, color] of MINOR_DEFS) CIVS.push({ key: 'free_' + key, name: name + ' Outpost', adj: name, leader: 'The Overseer of ' + name, color, dark: shadeHex(color), minor: type, cities: [name] });
CIVS.forEach((c, i) => { if (CIVI[c.key] === undefined) CIVI[c.key] = i; });
function shadeHex(c) { const n = parseInt(c.slice(1), 16), f = v => Math.round(v * 0.35).toString(16).padStart(2, '0'); return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255); }
PERSONA.minor = { f: 1.1, p: 1.1, g: 0.9, s: 1.0, c: 0.9, expand: 0 };
const MINOR = { friend: 30, ally: 60, absorb: 90, decay: 1, count: { small: 3, medium: 4, large: 6, huge: 8 }, first: 18, every: 22 };
function isMinor(G, pid) { return pid >= 0 && !!G.players[pid].minor; }
function minorType(G, pid) { return CIVS[G.players[pid].civ].minor; }
// One outpost is there at landfall; the rest arrive on later arks.
function addCityStates(G, starts) {
  if (G.cfg.cityStates === false) return;
  G.minorQueue = RNG.fromSeed(G.seed + '|free').shuffle(MINOR_DEFS.map((d, i) => i)).slice(0, MINOR.count[G.cfg.size] || 3);
  landOutpost(G, starts);
}
function landOutpost(G, avoid) {
  if (!G.minorQueue || !G.minorQueue.length) return null;
  const m = G.map, g = G._grid, rng = RNG.fromSeed(G.seed + '|out' + G.turn), N = m.W * m.H;
  const taken = (avoid || []).concat(G.cities.map(c => c.tile));
  const cands = []; for (let t = 0; t < N; t++) if (passableTerrain(G, t) && m.res[t] < 0 && m.owner[t] < 0 && !G._mil.has(t) && !G._civ.has(t) && !siteAt(G, t) && !campAt(G, t)) cands.push(t);
  if (!cands.length) return null;
  let best = -1, bs = -Infinity;
  for (let k = 0; k < 500; k++) {
    const t = cands[rng.int(cands.length)];
    if (taken.some(x => g.dist(x, t) < 7) || (G.natural || []).some(n => n.tile === t)) continue;
    if (g.within(t, 2).some(x => m.owner[x] >= 0)) continue;
    const s = siteScore(m, g, t); if (s > bs) { bs = s; best = t; }
  }
  if (best < 0) return null;
  const di = G.minorQueue.shift();
  const pid = G.players.length, P = newPlayer(pid, CIVI['free_' + MINOR_DEFS[di][0]], false, N);
  P.minor = true; P.inf = {}; G.players.push(P); P._vis = new Uint8Array(N);
  const u = spawnUnit(G, 'settler', pid, best); const c = foundCity(G, u);
  if (!c) { removeUnit(G, u); G.players.pop(); return null; }
  for (const type of ['skirmisher', 'militia']) { const t = freeTileNear(G, best, type); if (t >= 0) spawnUnit(G, type, pid, t); }
  if (G.turn > 1) for (const Q of G.players) if (Q.human) logEvent(G, Q.id, `A late ark has landed: ${CIVS[P.civ].name}, a ${MINOR_TYPES[CIVS[P.civ].minor].name}.`, Q.explored[best] ? best : -1);
  return P;
}
function influence(G, minor, pid) { return (G.players[minor].inf || {})[pid] || 0; }
function minorAlly(G, minor) { const inf = G.players[minor].inf || {}; let best = -1, bv = MINOR.ally - 0.01; for (const k in inf) if (inf[k] > bv && !atWar(G, +k, minor)) { bv = inf[k]; best = +k; } return best; }
function minorStatus(G, minor, pid) {
  if (atWar(G, pid, minor)) return 'war';
  if (minorAlly(G, minor) === pid) return 'ally';
  return influence(G, minor, pid) >= MINOR.friend ? 'friend' : 'neutral';
}
function giftInfluence(G, pid, gold) { return Math.round(gold / (2.6 + playerEra(G.players[pid]) * 0.6)); }
function giftGold(G, pid, minor, gold) {
  const P = G.players[pid], M = G.players[minor];
  if (!M.alive || !M.minor || atWar(G, pid, minor) || P.gold < gold || gold <= 0) return false;
  const before = minorStatus(G, minor, pid);
  P.gold -= gold; M.gold += Math.round(gold * 0.5);
  M.inf[pid] = Math.min(120, (M.inf[pid] || 0) + giftInfluence(G, pid, gold));
  const after = minorStatus(G, minor, pid);
  if (P.human && after !== before) logEvent(G, pid, `${CIVS[M.civ].name} ${after === 'ally' ? 'is now your ally' : 'now counts you as a friend'}.`, -1);
  return true;
}
// An ally with very high influence can be absorbed: the outpost joins you peacefully.
function absorbCost(G, pid, minor) { const c = G.cities.find(x => x.owner === minor); return Math.round((150 + (c ? c.pop * 40 : 0)) * paceOf(G)); }
function absorbStatus(G, pid, minor) {
  const M = G.players[minor]; if (!M || !M.minor || !M.alive) return { ok: false, why: 'Gone.' };
  if (minorAlly(G, minor) !== pid) return { ok: false, why: 'Only their ally can absorb them.' };
  if (influence(G, minor, pid) < MINOR.absorb) return { ok: false, why: `Needs ${MINOR.absorb} influence (you have ${Math.round(influence(G, minor, pid))}).` };
  const cost = absorbCost(G, pid, minor);
  if (G.players[pid].gold < cost) return { ok: false, why: `Costs ${cost} credits.`, cost };
  return { ok: true, cost };
}
function absorbOutpost(G, pid, minor) {
  const st = absorbStatus(G, pid, minor); if (!st.ok) return false;
  const P = G.players[pid], M = G.players[minor];
  P.gold -= st.cost;
  for (const c of G.cities.filter(x => x.owner === minor)) {
    c.owner = pid; c.capital = false; c.buildings = c.buildings.filter(k => k !== 'palace'); c.unrest = 0; c.build = null; c.queue = [];
    for (const t of c.tiles) G.map.owner[t] = pid;
    assignWorkers(G, c);
  }
  for (const u of G.units.filter(x => x.owner === minor)) { u.owner = pid; u.moves = 0; }
  G.routes = G.routes.filter(r => { const a = cityById(G, r.from), b = cityById(G, r.to); return a && b; });
  M.alive = false;
  for (const k of Object.keys(G.war)) { const [a, b] = k.split('-').map(Number); if (a === minor || b === minor) delete G.war[k]; }
  for (const Q of G.players) if (Q.human) logEvent(G, Q.id, Q.id === pid ? `${CIVS[M.civ].name} has joined your colonies.` : `${CIVS[M.civ].name} was absorbed by the ${CIVS[P.civ].name}.`, -1);
  refreshWonders(G); computeVisibility(G, pid);
  return true;
}
// Once per round: arrivals, influence decay, bonuses for friends and allies.
function minorRound(G) {
  if (G.cfg.cityStates !== false && G.minorQueue && G.minorQueue.length && G.turn >= Math.round(MINOR.first * paceOf(G)) && (G.turn - Math.round(MINOR.first * paceOf(G))) % Math.round(MINOR.every * paceOf(G)) === 0)
    landOutpost(G, G.players.filter(P => !P.barbarian).flatMap(P => P.landing || []));
  for (const M of G.players) {
    if (!M.minor || !M.alive) continue;
    const type = minorType(G, M.id), ally = minorAlly(G, M.id);
    for (const r of G.routes) { const b = cityById(G, r.to); if (b && b.owner === M.id) M.inf[r.owner] = Math.min(120, (M.inf[r.owner] || 0) + 1.5); }
    for (const k in M.inf) {
      const pid = +k, Q = G.players[pid];
      if (!Q.alive) { delete M.inf[k]; continue; }
      if (atWar(G, pid, M.id)) { M.inf[k] = Math.min(M.inf[k], -40); continue; }
      M.inf[k] += M.inf[k] > 0 ? -MINOR.decay : 0.5;
      const st = pid === ally ? 2 : M.inf[k] >= MINOR.friend ? 1 : 0; if (!st) continue;
      const amt = st * (2 + playerEra(Q));
      const cap = G.cities.find(c => c.owner === pid && c.capital);
      if (type === 'cultural') Q.culturePool += amt;
      else if (type === 'scientific') { if (Q.research) Q.progress[Q.research] = (Q.progress[Q.research] || 0) + amt; }
      else if (type === 'mercantile') Q.gold += amt;
      else if (type === 'maritime') { if (cap) cap.food += amt; }
      else if (type === 'industrial') { if (cap && cap.build) cap.prod += Math.ceil(amt / 2); }
      else if (type === 'militaristic' && st === 2 && (G.turn + M.id) % 12 === 0) {
        if (!cap) continue;
        const opts = availableItems(G, cap).filter(it => it.k === 'u' && UNITS[it.key].military && !UNITS[it.key].naval && UNITS[it.key].cls !== 'recon' && UNITS[it.key].cls !== 'siege');
        const best = opts.sort((a, b) => UNITS[b.key].str - UNITS[a.key].str)[0]; if (!best) continue;
        const t = spawnTileFor(G, cap, best.key); if (t < 0) continue;
        spawnUnit(G, best.key, pid, t); if (Q.human) logEvent(G, pid, `${CIVS[M.civ].name} sent you a ${UNITS[best.key].name}.`, t);
      }
    }
    const majors = majorPlayers(G).filter(P => P.alive);
    for (const T0 of TECHS) if (!hasTech(M, T0.key) && majors.filter(P => hasTech(P, T0.key)).length * 2 >= majors.length && T0.r !== 'l3') M.techs.push(T0.key);
  }
}
// An outpost defends itself and builds; it never starts wars.
function minorTurn(G, pid) {
  const mine = G.units.filter(u => u.owner === pid), military = [];
  for (const u of mine) { u.ai = u.ai || {}; if (UNITS[u.type].charges && !UNITS[u.type].recon) aiBuilder(G, u); else if (isMil(u)) military.push(u); else if (UNITS[u.type].founds || UNITS[u.type].orbital) removeUnit(G, u); }
  aiMilitaryTurn(G, pid, military);
  aiCityBombard(G, pid);
  for (const Q of majorPlayers(G)) if (atWar(G, pid, Q.id) && !Q.human && G.turn - warRecord(G, pid, Q.id).since > 12) makePeace(G, pid, Q.id);
  computeVisibility(G, pid);
}
// AI majors buy the friendship of outposts that suit them, and absorb those they can.
function aiCityStates(G, pid) {
  const P = G.players[pid];
  for (const M of G.players) if (M.minor && M.alive && absorbStatus(G, pid, M.id).ok && P.gold > absorbCost(G, pid, M.id) + 60) { absorbOutpost(G, pid, M.id); return; }
  if ((G.turn + pid) % 5 !== 0 || P.gold < 220) return;
  const w = personaOf(G, pid), pref = { cultural: w.c, scientific: w.s, mercantile: w.g, maritime: w.f, industrial: w.p, militaristic: (AGGRESSION[civKey(P)] || 1) };
  let best = -1, bs = 0;
  for (const M of G.players) {
    if (!M.minor || !M.alive || !P.met.includes(M.id) || atWar(G, pid, M.id)) continue;
    const inf = influence(G, M.id, pid); if (inf > 100) continue;
    const s = pref[minorType(G, M.id)] * (inf >= MINOR.friend - 15 ? 1.4 : 1) * (minorAlly(G, M.id) === pid ? 1.2 : 1); if (s > bs) { bs = s; best = M.id; }
  }
  if (best >= 0) giftGold(G, pid, best, Math.min(Math.floor(P.gold / 3), Math.round(120 * paceOf(G))));
}
Object.assign(HX, { MINOR_TYPES, MINOR, isMinor, minorType, influence, minorAlly, minorStatus, giftGold, giftInfluence, absorbStatus, absorbOutpost, absorbCost });
