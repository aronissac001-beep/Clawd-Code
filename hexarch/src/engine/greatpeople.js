// ===== greatpeople.js : Great People born from buildings, trade, specialists and battle =====
const GREAT = {
  scientist: { name: 'Great Scientist', glyph: '🧪', unit: 'great_scientist', act: 'Discover', desc: 'Discover: a large boost to your current research.' },
  engineer: { name: 'Great Engineer', glyph: '⚙️', unit: 'great_engineer', act: 'Construct', desc: 'Construct: in one of your cities, add a lot of production (great for wonders).' },
  merchant: { name: 'Great Merchant', glyph: '💰', unit: 'great_merchant', act: 'Trade mission', desc: 'Trade mission: a large sum of gold, larger in a foreign city you are at peace with.' },
  artist: { name: 'Great Artist', glyph: '🎨', unit: 'great_artist', act: 'Masterwork', desc: 'Masterwork: culture worth half a policy, plus +2 happiness in the city for good.' },
  general: { name: 'Great General', glyph: '🎖️', unit: 'great_general', desc: 'Your military units within 2 tiles fight at +15%.' },
};
const GREAT_KEYS = Object.keys(GREAT);
for (const k of GREAT_KEYS) UNITS[GREAT[k].unit] = { key: GREAT[k].unit, name: GREAT[k].name, civilian: true, moves: k === 'general' ? 3 : 2, sight: 2, strength: 0, glyph: GREAT[k].glyph, great: k };
// Points per turn toward each kind.
function greatRates(G, pid) {
  const r = { scientist: 0, engineer: 0, merchant: 0, artist: 0, general: 0 };
  const has = (c, k) => c.buildings.includes(k) ? 1 : 0;
  for (const c of ownCities(G, pid)) {
    r.scientist += has(c, 'library') + has(c, 'university') * 2 + has(c, 'observatory') * 2 + has(c, 'laboratory') * 3 + has(c, 'printing');
    r.engineer += has(c, 'workshop') * 2 + has(c, 'factory') * 3 + c.tiles.filter(t => G.map.improv[t] === IMPI.mine && c.worked.includes(t)).length * 0.5;
    r.merchant += has(c, 'market') + has(c, 'bank') * 2 + has(c, 'stock_exchange') * 3 + has(c, 'harbor');
    r.artist += has(c, 'monument') * 0.5 + has(c, 'amphitheater') * 2 + has(c, 'opera') * 2 + has(c, 'museum') * 3;
    const spec = Math.max(0, c.pop - c.worked.length); r.scientist += spec * 0.5;
  }
  r.merchant += G.routes.filter(x => x.owner === pid).length;
  return r;
}
function greatThreshold(G, P, k) { const n = (P.gpBorn && P.gpBorn[k]) || 0; return Math.round((k === 'general' ? 120 : 160) * (1 + 1.6 * n) * paceOf(G)); }
// Once per turn: add points; a Great Person is born when a threshold is reached.
function greatTurn(G, pid) {
  const P = G.players[pid]; if (P.barbarian) return;
  P.gp = P.gp || {}; P.gpBorn = P.gpBorn || {};
  const rates = greatRates(G, pid);
  for (const k of GREAT_KEYS) {
    P.gp[k] = (P.gp[k] || 0) + rates[k];
    const need = greatThreshold(G, P, k);
    if (P.gp[k] < need) continue;
    const cs = ownCities(G, pid); if (!cs.length) continue;
    const home = cs.find(c => c.capital) || cs[0];
    const t = spawnTileFor(G, home, GREAT[k].unit); if (t < 0) continue;
    P.gp[k] -= need; P.gpBorn[k] = (P.gpBorn[k] || 0) + 1;
    spawnUnit(G, GREAT[k].unit, pid, t);
    if (P.human) logEvent(G, pid, `A ${GREAT[k].name} has been born in ${home.name}! ${GREAT[k].desc}`, t);
  }
}
function gainGeneralPoints(G, pid, n) { const P = G.players[pid]; if (!P || P.barbarian) return; P.gp = P.gp || {}; P.gp.general = (P.gp.general || 0) + n; }
// +15% for military units within 2 tiles of one of their own Great Generals.
function generalBonus(G, u) {
  for (const x of G.units) if (x.owner === u.owner && UNITS[x.type].great === 'general' && G._grid.dist(x.tile, u.tile) <= 2) return 15;
  return 0;
}
function greatAction(G, u) {
  const k = UNITS[u.type].great, P = G.players[u.owner], c = G._cityAt.get(u.tile), pace = paceOf(G);
  switch (k) {
    case 'scientist': return P.research ? { ok: true, text: `+${Math.round(techCost(G, P.research) * 0.6)} science toward ${TECHS[TECHI[P.research]].name}` } : { ok: false, why: 'Choose a research first.' };
    case 'engineer': return c && c.owner === u.owner ? { ok: !!c.build, why: c.build ? '' : 'The city has nothing in production.', text: `+${Math.round(160 * pace)} production in ${c.name}` } : { ok: false, why: 'Move the Engineer into one of your cities.' };
    case 'merchant': { const foreign = c && c.owner !== u.owner && !atWar(G, u.owner, c.owner) && !isBarb(G, c.owner); return { ok: true, text: `+${Math.round((foreign ? 220 : 140) * pace)} gold${foreign ? ' (foreign city bonus)' : ' (more inside a foreign city)'}` }; }
    case 'artist': return c && c.owner === u.owner ? { ok: true, text: `+${Math.round(policyCost(G, u.owner) * 0.5)} culture and +2 happiness here` } : { ok: false, why: 'Move the Artist into one of your cities.' };
  }
  return { ok: false, why: 'Generals inspire nearby units just by being there.' };
}
function useGreat(G, u) {
  const st = greatAction(G, u); if (!st.ok) return false;
  const k = UNITS[u.type].great, P = G.players[u.owner], c = G._cityAt.get(u.tile), pace = paceOf(G);
  if (k === 'scientist') P.progress[P.research] = (P.progress[P.research] || 0) + Math.round(techCost(G, P.research) * 0.6);
  if (k === 'engineer') c.prod += Math.round(160 * pace);
  if (k === 'merchant') { const foreign = c && c.owner !== u.owner && !atWar(G, u.owner, c.owner) && !isBarb(G, c.owner); P.gold += Math.round((foreign ? 220 : 140) * pace); }
  if (k === 'artist') { P.culturePool += Math.round(policyCost(G, u.owner) * 0.5); c.masterworks = (c.masterworks || 0) + 1; }
  if (P.human) logEvent(G, u.owner, `${UNITS[u.type].name}: ${st.text}.`, u.tile);
  removeUnit(G, u);
  return true;
}
// AI: use Great People right away (engineers in the best city building something big), keep generals with the army.
function aiGreat(G, pid) {
  for (const u of G.units.filter(x => x.owner === pid && UNITS[x.type].great)) {
    const k = UNITS[u.type].great;
    if (k === 'general') {
      const army = G.units.filter(x => x.owner === pid && isMil(x));
      if (army.length) { const near = army.sort((a, b) => G._grid.dist(a.tile, u.tile) - G._grid.dist(b.tile, u.tile))[Math.min(2, army.length - 1)]; if (G._grid.dist(near.tile, u.tile) > 1) advanceToward(G, u, near.tile); }
      continue;
    }
    if (k === 'engineer') {
      const cs = ownCities(G, pid).filter(c => c.build), target = cs.find(c => c.build && (isWonder(c.build.key) || isProject(c.build.key))) || cs.sort((a, b) => itemCost(G, b.build, pid) - itemCost(G, a.build, pid))[0];
      if (target && u.tile !== target.tile) { advanceToward(G, u, target.tile); }
    }
    if (k === 'artist' && !(G._cityAt.get(u.tile) && G._cityAt.get(u.tile).owner === pid)) { const c = nearestOwnCity(G, pid, u.tile); if (c) advanceToward(G, u, c.tile); }
    if (k === 'scientist' && !G.players[pid].research) { const av = availableTechs(G.players[pid]); if (av.length) G.players[pid].research = av[0]; }
    useGreat(G, u);
  }
}
Object.assign(HX, { GREAT, greatRates, greatThreshold, greatAction, useGreat, generalBonus });
