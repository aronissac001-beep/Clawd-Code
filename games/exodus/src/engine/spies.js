// ===== spies.js : steal technology or sabotage production in a rival city =====
UNITS.spy = { key: 'spy', name: 'Spy', civilian: true, moves: 3, sight: 2, strength: 0, glyph: '🕵️', cost: 70, tech: 'printing', spy: true, military: false, naval: false, ranged: false };
BUILDABLE_UNITS.push('spy');
// Foreign cities next to the spy (or under it) that it could work against.
function spyTargets(G, u) {
  const out = [];
  for (const c of G.cities) if (c.owner !== u.owner && !G.players[c.owner].barbarian && G._grid.dist(c.tile, u.tile) <= 1) out.push(c);
  return out;
}
function stealableTech(G, pid, owner) {
  const P = G.players[pid], Q = G.players[owner];
  return Q.techs.filter(k => !hasTech(P, k) && techAvailable(P, k)).sort((a, b) => techCost(G, a) - techCost(G, b))[0] || null;
}
// Chance of success falls with the city's defenses; a failed mission is noticed.
function spyChance(G, u, c) { let ch = 0.7; if (c.buildings.includes('walls')) ch -= 0.1; if (c.buildings.includes('castle')) ch -= 0.1; if (c.capital) ch -= 0.1; return Math.max(0.3, ch); }
function spyOptions(G, u) {
  const out = [];
  for (const c of spyTargets(G, u)) {
    const tk = stealableTech(G, u.owner, c.owner), ch = Math.round(spyChance(G, u, c) * 100);
    out.push({ city: c.id, kind: 'steal', ok: !!tk, label: tk ? `Steal ${TECHS[TECHI[tk]].name} from ${c.name} (${ch}%)` : `${c.name} has nothing you can learn`, tech: tk });
    out.push({ city: c.id, kind: 'sabotage', ok: c.prod > 5, label: `Sabotage ${c.name}'s production (${ch}%)` });
  }
  return out;
}
function spyAct(G, u, cityId, kind) {
  const c = cityById(G, cityId); if (!c || G._grid.dist(c.tile, u.tile) > 1 || u.moves <= 0) return null;
  const P = G.players[u.owner], Q = G.players[c.owner], ok = G._rng.chance(spyChance(G, u, c));
  let text = '';
  if (ok && kind === 'steal') { const tk = stealableTech(G, u.owner, c.owner); if (!tk) return null; learnTech(G, u.owner, tk); text = `Your spy stole ${TECHS[TECHI[tk]].name} from ${c.name}.`; }
  else if (ok && kind === 'sabotage') { const lost = Math.floor(c.prod * 0.6); c.prod -= lost; text = `Your spy sabotaged ${c.name}: it lost ${lost} production.`; if (Q.human) logEvent(G, c.owner, `Saboteurs struck ${c.name}! ${lost} production was lost.`, c.tile); }
  else {
    text = `Your spy was caught in ${c.name}.`;
    if (!Q.minor && !Q.barbarian) { memOf(G, u.owner, c.owner).demand = G.turn; G._att = null; }
    if (Q.human) logEvent(G, c.owner, `A ${CIVS[P.civ].adj} spy was caught in ${c.name}.`, c.tile);
  }
  if (P.human) logEvent(G, u.owner, text, c.tile);
  removeUnit(G, u);
  return { ok, text };
}
// AI: scholarly civs send a spy at the nearest richer rival and steal.
function aiSpy(G, u) {
  const pid = u.owner, opts = spyOptions(G, u).filter(o => o.ok && o.kind === 'steal');
  if (opts.length) { spyAct(G, u, opts[0].city, 'steal'); return; }
  let best = null, bd = 1e9;
  for (const c of G.cities) { if (c.owner === pid || isBarb(G, c.owner) || G.players[c.owner].minor || !stealableTech(G, pid, c.owner) || !G.players[pid].seen[c.tile]) continue; const d = G._grid.dist(c.tile, u.tile); if (d < bd) { bd = d; best = c; } }
  if (best) { const t = G._grid.neighbors(best.tile).find(n => passableFor(G, u, n) && !G._civ.has(n)); if (t !== undefined) advanceToward(G, u, t); }
}
Object.assign(HX, { spyOptions, spyAct });
