// ===== ai.js : computer opponents =====
function aiTakeTurn(G, pid) {
  const mine = G.units.filter(u => u.owner === pid);
  // settlers act first so escorts can follow them to their new position
  mine.sort((a, b) => (UNITS[b.type].founds ? 1 : 0) - (UNITS[a.type].founds ? 1 : 0));
  for (const u of mine) {
    if (!G.units.includes(u)) continue;
    u.ai = u.ai || {};
    if (UNITS[u.type].founds) aiSettler(G, u);
    else if (UNITS[u.type].recon) aiScout(G, u);
    else aiGuard(G, u);
  }
  computeVisibility(G, pid);
}

function aiPickSite(G, u, myCities) {
  const g = G._grid, pid = u.owner, ex = G.players[pid].explored, map = G.map;
  const R = myCities.length ? 9 : 3;
  const bad = u.ai.bad || [];
  const taken = G.units.filter(o => o.owner === pid && o !== u && o.ai && o.ai.target != null).map(o => o.ai.target);
  const tiles = g.within(u.tile, R).slice(), dd = tiles.map(t => g.dst[t]);
  let best = null, bestS = -Infinity, here = -Infinity;
  for (let k = 0; k < tiles.length; k++) {
    const t = tiles[k];
    if (!ex[t] || bad.includes(t)) continue;
    if (!foundCheck(G, pid, t).ok) continue;
    if (taken.some(x => g.dist(x, t) < MIN_CITY_DIST)) continue;
    let s = siteScore(map, g, t);
    let ov = 0; for (const o of g.within(t, 2)) if (map.owner[o] >= 0) ov++;
    s -= ov * 1.2;
    if (myCities.length) {
      let dmin = 99; for (const c of myCities) dmin = Math.min(dmin, g.dist(c.tile, t));
      if (dmin > 8) continue;
      s -= Math.max(0, dmin - 5) * 1.5;
      for (const c of G.cities) if (c.owner !== pid && g.dist(c.tile, t) < 6) s -= 5;
    }
    s -= dd[k] * (myCities.length ? 1.2 : 2.5);
    if (t === u.tile) here = s;
    if (s > bestS) { bestS = s; best = t; }
  }
  if (!myCities.length && here > -Infinity && here >= bestS - 3) return u.tile;
  return best;
}

function aiSettler(G, u) {
  const pid = u.owner, myCities = G.cities.filter(c => c.owner === pid);
  if (u.ai.target != null && !foundCheck(G, pid, u.ai.target).ok) u.ai.target = null;
  if (u.ai.target == null) u.ai.target = aiPickSite(G, u, myCities);
  if (u.ai.target == null) { u.order = { t: 'explore' }; runOrder(G, u); u.order = null; return; }
  if (u.tile !== u.ai.target) {
    const r = advanceToward(G, u, u.ai.target);
    if (r.failed) { (u.ai.bad = u.ai.bad || []).push(u.ai.target); u.ai.target = null; return; }
  }
  if (u.tile === u.ai.target && u.moves > 0) {
    if (canFoundCity(G, u).ok) foundCity(G, u);
    else u.ai.target = null;
  }
}

function aiScout(G, u) {
  if (u.ai.idleUntil && G.turn < u.ai.idleUntil) return aiReturnHome(G, u);
  u.order = { t: 'explore' };
  runOrder(G, u);
  if (!u.order) { u.ai.idleUntil = G.turn + 10; aiReturnHome(G, u); }
}

function aiReturnHome(G, u) {
  const g = G._grid, myCities = G.cities.filter(c => c.owner === u.owner);
  if (!myCities.length) return;
  let best = null, bd = 1e9;
  for (const c of myCities) { const d = g.dist(c.tile, u.tile); if (d < bd) { bd = d; best = c; } }
  if (bd > 2) advanceToward(G, u, best.tile);
}

function aiGuard(G, u) {
  const pid = u.owner, g = G._grid, myCities = G.cities.filter(c => c.owner === pid);
  if (!myCities.length) {
    const s = G.units.find(o => o.owner === pid && UNITS[o.type].founds);
    if (s) { if (u.tile !== s.tile) advanceToward(G, u, s.tile); return; }
    return aiScout(G, u);
  }
  const here = G._cityAt.get(u.tile);
  if (here && here.owner === pid && G._mil.get(u.tile) === u) { u.order = { t: 'fortify' }; return; }
  const open = myCities.filter(c => { const m = G._mil.get(c.tile); return !m; });
  if (open.length) {
    open.sort((a, b) => g.dist(a.tile, u.tile) - g.dist(b.tile, u.tile));
    u.order = null;
    const r = advanceToward(G, u, open[0].tile);
    if (u.tile === open[0].tile) u.order = { t: 'fortify' };
    if (!r.failed) return;
  }
  // every city has a defender: escort the nearest unescorted settler, else patrol near home
  const settler = G.units.find(o => o.owner === pid && UNITS[o.type].founds && !G._mil.has(o.tile));
  if (settler) { u.order = null; if (u.tile !== settler.tile) advanceToward(G, u, settler.tile); return; }
  u.order = null;
  let near = myCities[0]; for (const c of myCities) if (g.dist(c.tile, u.tile) < g.dist(near.tile, u.tile)) near = c;
  if (g.dist(near.tile, u.tile) > 4) advanceToward(G, u, near.tile);
}

HX.aiTakeTurn = aiTakeTurn;
