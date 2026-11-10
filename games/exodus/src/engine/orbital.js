// ===== orbital.js : satellites launched from colonies over nearby tiles, with area effects and lifetimes =====
function satLife(G, P, type) { return Math.round((SATS[type].life + (polFx(P).satLife || 0)) * Math.max(0.6, paceOf(G))); }
// Tiles a satellite waiting in a colony can be launched over.
function launchTargets(G, u) {
  const U = UNITS[u.type]; if (!U.orbital) return [];
  const c = G._cityAt.get(u.tile); if (!c || c.owner !== u.owner) return [];
  const P = G.players[u.owner], out = [];
  for (const t of G._grid.within(c.tile, SAT_RANGE)) {
    if (!P.explored[t]) continue;
    if (G.sats.some(s => s.owner === u.owner && s.type === u.type && G._grid.dist(s.tile, t) < 2)) continue;
    out.push(t);
  }
  return out;
}
function launchSat(G, u, t) {
  if (!launchTargets(G, u).includes(t)) return false;
  const P = G.players[u.owner];
  G.sats.push({ id: G.nextId++, type: u.type, owner: u.owner, tile: t, until: G.turn + satLife(G, P, u.type) });
  P.stats.sats = (P.stats.sats || 0) + 1;
  removeUnit(G, u); G._satVer = (G._satVer || 0) + 1;
  if (P.human) logEvent(G, u.owner, `${SATS[u.type].name} launched. It will stay in orbit for ${satLife(G, P, u.type)} turns.`, t);
  if (P.stats.sats === 1) offerStory(G, u.owner, 'first_sat');
  for (const c of ownCities(G, u.owner)) assignWorkers(G, c);
  computeVisibility(G, u.owner);
  return true;
}
// Coverage map per owner and type, rebuilt when satellites change.
function satCovers(G, pid, type, t) {
  if (!G.sats || !G.sats.length) return false;
  const ver = (G._satVer || 0) + ':' + G.sats.length;
  if (!G._satCov || G._satCov.ver !== ver) G._satCov = { ver, maps: new Map() };
  const key = pid + type; let arr = G._satCov.maps.get(key);
  if (!arr) {
    arr = new Uint8Array(G._grid.N);
    for (const s of G.sats) if (s.owner === pid && s.type === type) for (const k of G._grid.within(s.tile, SATS[type].radius)) arr[k] = 1;
    G._satCov.maps.set(key, arr);
  }
  return arr[t] === 1;
}
function satsOver(G, t) { return (G.sats || []).filter(s => G._grid.dist(s.tile, t) <= SATS[s.type].radius); }
// Once per round: satellites act, then old ones burn up.
function satRound(G) {
  if (!G.sats || !G.sats.length) return;
  const g = G._grid, m = G.map;
  for (const s of G.sats) {
    const owner = s.owner;
    if (s.type === 'sat_sentinel') {
      for (const t of g.within(s.tile, SATS.sat_sentinel.radius)) {
        const u = G._mil.get(t); if (!u || u.owner === owner || !atWar(G, owner, u.owner)) continue;
        u.hp -= 10;
        if (u.hp <= 0) { if (UNITS[u.type].fauna) G.players[owner].stats.kills = (G.players[owner].stats.kills || 0) + 1; killUnit(G, u, owner); }
      }
    } else if (s.type === 'sat_scrubber') {
      let n = 0; for (const t of g.within(s.tile, SATS.sat_scrubber.radius)) { if (n >= 2) break; if (m.veil[t] && !G.camps.some(c => c.tile === t)) { scourVeil(G, owner, t); n++; } }
    } else if (s.type === 'sat_seeder') {
      for (const t of g.within(s.tile, SATS.sat_seeder.radius)) { if (!m.veil[t] && passableTerrain(G, t) && !G._cityAt.has(t)) { m.veil[t] = 1; break; } }
    }
  }
  const gone = G.sats.filter(s => s.until <= G.turn);
  if (gone.length) {
    G.sats = G.sats.filter(s => s.until > G.turn); G._satVer = (G._satVer || 0) + 1;
    for (const s of gone) {
      if (G.players[s.owner] && G.players[s.owner].human) logEvent(G, s.owner, `Your ${SATS[s.type].name} has burned up in the atmosphere.`, s.tile);
      for (const c of ownCities(G, s.owner)) assignWorkers(G, c);
    }
  }
}
// AI: launch over the spot that helps most.
function aiLaunch(G, u) {
  const ts = launchTargets(G, u); if (!ts.length) return false;
  const pid = u.owner, m = G.map, g = G._grid;
  let best = -1, bs = -Infinity;
  for (const t of ts) {
    let s = 0;
    const R = SATS[u.type].radius;
    for (const k of g.within(t, R)) {
      const c = cityById(G, m.ocity[k]), mine = c && c.owner === pid, worked = mine && c.worked.includes(k);
      if (u.type === 'sat_helio' || u.type === 'sat_relay') s += worked ? 1 : 0;
      else if (u.type === 'sat_survey' || u.type === 'sat_haven') s += G._cityAt.get(k) && G._cityAt.get(k).owner === pid ? 4 : 0;
      else if (u.type === 'sat_scrubber') s += m.veil[k] && m.owner[k] === pid ? 1.5 : m.veil[k] ? 0.3 : 0;
      else if (u.type === 'sat_seeder') s += mine && !m.veil[k] ? 1 : 0;
      else if (u.type === 'sat_sentinel') { const e = G._mil.get(k); if (e && atWar(G, pid, e.owner)) s += 3; if (G._cityAt.get(k) && G._cityAt.get(k).owner === pid) s += 1; }
    }
    s -= g.dist(t, u.tile) * 0.05;
    if (s > bs) { bs = s; best = t; }
  }
  return best >= 0 && launchSat(G, u, best);
}
Object.assign(HX, { SATS, launchTargets, launchSat, satCovers, satsOver, satLife });
