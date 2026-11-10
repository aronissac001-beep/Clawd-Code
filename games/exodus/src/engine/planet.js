// ===== planet.js : the Spore Veil, landing, loadouts, crash sites, Precursor ruins, Echo Vaults, excavation, nests =====

// ---- the Veil: a creeping haze of spores that hurts unadapted units ----
// Placed with its own RNG stream; clumps on fungal forest and marsh, never on the landing sites.
function generateVeil(G, starts) {
  const m = G.map, g = G._grid, N = g.N, rng = RNG.fromSeed(G.seed + '|veil');
  m.veil = m.veil || new Uint8Array(N);
  if (G.cfg.veil === false) return;
  const land = []; for (let t = 0; t < N; t++) if (TERRAIN[m.terrain[t]].land && !TERRAIN[m.terrain[t]].impassable) land.push(t);
  const want = Math.round(land.length * 0.17), seeds = rng.shuffle(land.filter(t => m.terrain[t] === T.FOREST || m.terrain[t] === T.MARSH)).slice(0, Math.max(4, Math.round(want / 9)));
  let n = 0;
  const safe = t => !starts.some(s => g.dist(s, t) <= 3);
  for (const s of seeds) {
    const q = [s];
    for (let h = 0; h < q.length && n < want; h++) {
      const t = q[h]; if (m.veil[t] || !safe(t)) continue;
      m.veil[t] = 1; n++;
      if (q.length > 14) continue;
      for (const k of g.neighbors(t)) if (TERRAIN[m.terrain[k]].land && !TERRAIN[m.terrain[k]].impassable && !m.veil[k] && rng.chance(m.terrain[k] === T.FOREST || m.terrain[k] === T.MARSH ? 0.75 : 0.42)) q.push(k);
    }
    if (n >= want) break;
  }
}
const veilAt = (G, t) => !!(G.map.veil && G.map.veil[t]);
function veilImmune(G, u) {
  const U = UNITS[u.type]; if (U.fauna) return true;
  const P = G.players[u.owner]; if (P.barbarian) return true;
  const fx = polFx(P); if (fx.veilImmune) return true;
  if (u.promos && u.promos.includes('veilwalk')) return true;
  if (U.key === 'veil_chanter') return true;
  return false;
}
// Damage a unit takes for starting its turn in the Veil.
function veilDamage(G, u) {
  if (!veilAt(G, u.tile) || veilImmune(G, u) || isEmbarked(G, u)) return 0;
  const fx = polFx(G.players[u.owner]);
  return fx.veilHalf ? 5 : 10;
}
function scourVeil(G, pid, t) {
  if (!G.map.veil[t]) return false;
  G.map.veil[t] = 0;
  const P = G.players[pid]; if (!P) return true;
  P.stats.scoured = (P.stats.scoured || 0) + 1;
  const fx = polFx(P);
  if (fx.scourCul) P.culturePool += Math.round(fx.scourCul * paceOf(G));
  if (P.stats.scoured % 4 === 0) gainAff(G, pid, 'lineage', 2, 'scouring the Veil');
  if (P.stats.scoured === 3) offerStory(G, pid, 'first_scour');
  return true;
}
function seedVeil(G, pid, t) {
  if (G.map.veil[t] || G._cityAt.has(t)) return false;
  G.map.veil[t] = 1;
  const P = G.players[pid]; if (P) { P.stats.seeded = (P.stats.seeded || 0) + 1; if (P.stats.seeded % 3 === 0) gainAff(G, pid, 'communion', 2, 'seeding the Veil'); }
  return true;
}
function veilInBorders(G, pid) { const m = G.map; let n = 0; for (const c of G.cities) if (c.owner === pid) for (const t of c.tiles) if (m.veil[t]) n++; return n; }
// Veil inside your borders unsettles colonists who have not made peace with it: -1 morale for every 4 tiles.
function veilUnrest(G, pid) {
  const P = G.players[pid]; if (!P || P.minor) return 0;
  if (affLevel(P, 'communion') >= 2 || polFx(P).veilImmune) return 0;
  return Math.floor(veilInBorders(G, pid) / 4);
}
// Once per round: the Veil creeps from nests and old growth; satellites tick.
function planetRound(G) {
  const m = G.map, g = G._grid, rng = G._rng;
  if (G.cfg.veil !== false) {
    let land = 0, veil = 0; for (let t = 0; t < g.N; t++) if (TERRAIN[m.terrain[t]].land) { land++; if (m.veil[t]) veil++; }
    if (veil < land * 0.24 && G.turn % 3 === 0) {
      for (const camp of G.camps) if (rng.chance(0.35)) { const opts = g.neighbors(camp.tile).filter(t => passableTerrain(G, t) && !m.veil[t] && !G._cityAt.has(t) && m.owner[t] < 0); if (opts.length) m.veil[opts[rng.int(opts.length)]] = 1; }
      for (let k = 0; k < 6; k++) { const t = rng.int(g.N); if (!m.veil[t]) continue; const opts = g.neighbors(t).filter(n => passableTerrain(G, n) && !m.veil[n] && !G._cityAt.has(n) && (m.terrain[n] === T.FOREST || m.terrain[n] === T.MARSH || m.owner[n] < 0)); if (opts.length) m.veil[opts[rng.int(opts.length)]] = 1; }
    }
  }
  satRound(G);
  projectRound(G);
}

// ---- loadouts ----
function pickLoadout(cfg, P, rng, pid) {
  const want = P.human && pid === 0 ? (cfg.loadout || {}) : (P.human && cfg.hotseatLoadouts && cfg.hotseatLoadouts[pid - 1]) || {};
  const pick = (grp, k) => { const list = LOADOUT[grp]; return list.some(x => x.key === k) ? k : list[rng.int(list.length)].key; };
  return { col: pick('colonists', want.col), cargo: pick('cargo', want.cargo), ship: pick('ships', want.ship) };
}
// One-time effects at landing (before the first colony).
function applyLoadoutStart(G, pid, s) {
  const P = G.players[pid], L = P.loadout; if (!L) return;
  if (L.cargo === 'credits') P.gold += Math.round(120 * paceOf(G));
  if (L.cargo === 'datacore') P.progress._bank = (P.progress._bank || 0) + Math.round(40 * paceOf(G));
  if (L.cargo === 'artifact') { const pool = relicsLeft(G, pid, false); if (pool.length) { P.relics = P.relics || []; P.relics.push(pool[RNG.fromSeed(G.seed + '|lart' + pid).int(pool.length)].key); P._fx = null; } }
  if (L.ship === 'survey') for (const t of G._grid.within(s, 7)) P.explored[t] = 1;
  if (L.ship === 'orbital') G.sats.push({ id: G.nextId++, type: 'sat_survey', owner: pid, tile: s, until: G.turn + Math.round(30 * Math.max(0.6, paceOf(G))) });
}
// Effects that need the first colony.
function applyLoadoutColony(G, pid, c) {
  const P = G.players[pid], L = P.loadout; if (!L) return;
  if (L.cargo === 'seed_vault' && !c.buildings.includes('granary')) c.buildings.push('granary');
  if (L.ship === 'fortress' && !c.buildings.includes('walls')) { c.buildings.push('walls'); c.hp = cityMaxHp(G, c); }
}

// ---- landfall: three candidate sites near the arrival point ----
function landingSites(G, s, pid) {
  const g = G._grid, m = G.map, out = [s];
  const cands = g.within(s, 6).filter(t => t !== s && g.dst[t] >= 3 && TERRAIN[m.terrain[t]].land && !TERRAIN[m.terrain[t]].impassable && m.terrain[t] !== T.MARSH);
  const scored = cands.map(t => ({ t, v: siteScore(m, g, t) - (m.veil[t] ? 6 : 0) })).sort((a, b) => b.v - a.v);
  for (const c of scored) {
    if (out.length >= 3) break;
    if (out.some(o => g.dist(o, c.t) < 3)) continue;
    if (G.players.some((Q, k) => k !== pid && Q.landing && Q.landing.some(o => g.dist(o, c.t) < 6))) continue;
    if (G.units.some(u => u.owner !== pid && g.dist(u.tile, c.t) < 5)) continue;
    out.push(c.t);
  }
  return out;
}
// Summary of a candidate site for the landfall screen.
function landingInfo(G, pid, t) {
  const g = G._grid, m = G.map, tiles = g.within(t, 2);
  let f = 0, p = 0, gold = 0, lux = 0, strat = 0, veil = 0, water = 0;
  for (const k of tiles) { const y = tileYield(m, k); f += y.f; p += y.p; gold += y.g; const r = m.res[k]; if (r >= 0) { if (RES[r].kind === 'luxury') lux++; if (RES[r].kind === 'strategic') strat++; } if (m.veil[k]) veil++; if (TERRAIN[m.terrain[k]].water) water++; }
  return { tile: t, score: Math.round(siteScore(m, g, t)), f, p, g: gold, lux, strat, veil, coast: isCoastal(m, g, t), fresh: isFreshWater(m, g, t), terrain: TERRAIN[m.terrain[t]].name, water };
}
// Move the landing party to another candidate before the first colony is founded.
function chooseLanding(G, pid, idx) {
  const P = G.players[pid]; if (P.landed || !P.landing || !P.landing[idx]) return false;
  const to = P.landing[idx], from = P.landing[0];
  if (to === from) { P.landed = true; return true; }
  const mine = G.units.filter(u => u.owner === pid);
  for (const u of mine) { const m = occMap(G, u); if (m.get(u.tile) === u) m.delete(u.tile); u.tile = -1; }
  for (const u of mine) {
    const civ = isCivilianUnit(u), occ = civ ? G._civ : G._mil;
    const spot = G._grid.within(to, 2).find(t => passableTerrain(G, t) && !occ.has(t));
    u.tile = spot === undefined ? to : spot; occ.set(u.tile, u); u.order = null;
  }
  for (const t of G._grid.within(to, 1)) G.map.veil[t] = 0;
  for (const st of G.sats) if (st.owner === pid && st.tile === from) st.tile = to;
  if (P.loadout && P.loadout.ship === 'survey') for (const t of G._grid.within(to, 7)) P.explored[t] = 1;
  P.landing = [to].concat(P.landing.filter(t => t !== to));
  P.landed = true;
  computeVisibility(G, pid);
  return true;
}

// ---- crash sites, Precursor ruins and Echo Vaults ----
const SITE_KINDS = {
  wreck: { name: 'Crash Site', glyph: '🛸', desc: 'Debris from a lander that never made it down. An Explorer can salvage it.' },
  ruin: { name: 'Precursor Ruins', glyph: '🏛️', desc: 'Strange architecture from those who came before. An Explorer can excavate it for artifacts and insight.' },
  vault: { name: 'Echo Vault', glyph: '🔮', desc: 'A sealed alien vault that hums at the edge of hearing. After Deep Resonance, an Explorer can decode it.' },
};
const SITE_COUNT = { small: [6, 3, 3], medium: [9, 5, 4], large: [12, 6, 5], huge: [15, 8, 6] };
function placeSites(G, starts) {
  G.sites = [];
  const m = G.map, g = G._grid, rng = RNG.fromSeed(G.seed + '|sites'), [nw, nr, nv] = SITE_COUNT[G.cfg.size] || SITE_COUNT.medium;
  const nat = new Set((G.natural || []).map(n => n.tile)), cands = [];
  for (let t = 0; t < g.N; t++) {
    if (!passableTerrain(G, t) || nat.has(t) || m.owner[t] >= 0 || ruinAt(G, t)) continue;
    if (starts.some(s => g.dist(s, t) < 4)) continue;
    cands.push(t);
  }
  rng.shuffle(cands);
  const want = [['vault', nv, 7], ['ruin', nr, 5], ['wreck', nw, 4]];
  for (const [kind, n, gap] of want) {
    let k = 0;
    for (const t of cands) {
      if (k >= n) break;
      if (G.sites.some(s => s.tile === t || g.dist(s.tile, t) < (s.kind === kind ? gap : 2))) continue;
      if (kind === 'vault' && starts.some(s => g.dist(s, t) < 8)) continue;
      G.sites.push({ id: G.nextId++, kind, tile: t }); k++;
    }
  }
}
function siteAt(G, t) { for (const s of G.sites || []) if (s.tile === t) return s; return null; }
function siteKnown(G, pid, s) { return !!G.players[pid].explored[s.tile]; }
// Can this unit dig here now?
function digStatus(G, u) {
  const U = UNITS[u.type], P = G.players[u.owner];
  if (!U.recon) return { ok: false, why: 'Only Explorers can excavate.' };
  let s = siteAt(G, u.tile);
  if (!s && hasTech(P, 'deep_resonance')) for (const n of G._grid.neighbors(u.tile)) { const v = siteAt(G, n); if (v && v.kind === 'vault' && !P.vaults.includes(v.id)) { s = v; break; } } // vaults can be heard from next door
  if (!s) return { ok: false, why: 'Nothing to excavate here.' };
  if ((u.charges || 0) <= 0 && !(s.kind === 'vault' && hasTech(P, 'deep_resonance') && !P.vaults.includes(s.id))) return { ok: false, why: 'No expedition kits left. Explorers restock in a colony with a Field Lab.' };
  if (u.moves <= 0) return { ok: false, why: 'No moves left this turn.' };
  if (s.kind === 'vault') {
    if (P.vaults.includes(s.id)) return { ok: false, why: 'You have already decoded this vault.' };
    if (!hasTech(P, 'deep_resonance')) { if ((P.vaultHeard || []).includes(s.id)) return { ok: false, why: 'Its hum is recorded. Decoding it needs Deep Resonance.' }; return { ok: true, site: s, turns: 1, text: 'Record its hum: +science now. Decoding it needs Deep Resonance.' }; }
    return { ok: true, site: s, turns: 1, text: 'Decode the vault (counts toward an Awakening victory). Uses no kit.' };
  }
  const fast = polFx(P).digFast;
  return { ok: true, site: s, turns: fast ? 1 : 2, text: s.kind === 'vault' ? 'Decode the vault (counts toward an Awakening victory).' : s.kind === 'ruin' ? 'Excavate the ruins for an artifact or insight.' : 'Salvage the wreck for supplies.' };
}
function startDig(G, u) {
  const st = digStatus(G, u); if (!st.ok) return false;
  u.order = { t: 'dig', site: st.site.id, left: st.turns }; u.moves = 0; u.acted = true;
  return true;
}
// Called at the start of each player's turn: digs advance.
function digTurn(G, pid) {
  for (const u of G.units.slice()) {
    if (u.owner !== pid || !u.order || u.order.t !== 'dig') continue;
    const s = (G.sites || []).find(x => x.id === u.order.site);
    if (!s || (s.tile !== u.tile && !(s.kind === 'vault' && G._grid.dist(s.tile, u.tile) <= 1))) { u.order = null; continue; }
    if (--u.order.left > 0) { u.moves = 0; continue; }
    u.order = null; finishDig(G, u, s);
  }
}
function finishDig(G, u, s) {
  const P = G.players[u.owner], pid = u.owner, pace = paceOf(G), fx = polFx(P), k = 1 + (fx.digPct || 0) / 100;
  u.charges = Math.max(0, (u.charges || 1) - 1);
  P.stats.digs = (P.stats.digs || 0) + 1;
  const era = playerEra(P);
  let text = '';
  if (s.kind === 'wreck') {
    const roll = G._rng.int(4);
    if (roll === 0) { const n = Math.round((60 + 25 * era) * pace * k); P.gold += n; text = `salvaged cargo worth ${n} credits`; }
    else if (roll === 1 && P.research) { const n = Math.round(techCost(G, P.research, pid) * 0.4 * k); P.progress[P.research] = (P.progress[P.research] || 0) + n; text = `an intact data core: +${n} science`; }
    else if (roll === 2 && G.cities.some(c => c.owner === pid)) { const c = nearestOwnCity(G, pid, u.tile), n = Math.round((40 + 20 * era) * pace * k); c.prod += n; text = `fabricator parts: +${n} production in ${c.name}`; }
    else { const type = eraUnitFor(G, pid), t = freeNear(G, u.tile, type, null, 2); if (t >= 0) { spawnUnit(G, type, pid, t); text = `survivors in cryosleep, who join you as a ${UNITS[type].name}`; } else { P.gold += 50; text = 'a few supplies: +50 credits'; } }
    G.sites.splice(G.sites.indexOf(s), 1);
  } else if (s.kind === 'ruin') {
    const pool = relicsLeft(G, pid, true).filter(r => !r.cursed);
    const aff = AFF_KEYS[(s.id * 7 + pid) % 3];
    if (pool.length && G._rng.chance(0.6)) { const R = pool[G._rng.int(pool.length)]; grantRelic(G, pid, R.key, 'from Precursor ruins'); text = `the ${R.name}`; }
    else { const n = Math.round((50 + 20 * era) * pace * k); P.culturePool += n; text = `murals of an unknown people: +${n} culture`; }
    const xp = gainAff(G, pid, aff, Math.round(8 * k), 'ruins');
    text += ` and +${xp} ${AFFINITIES[AFFI[aff]].name} experience`;
    G.sites.splice(G.sites.indexOf(s), 1);
    offerStory(G, pid, 'first_ruin');
  } else if (s.kind === 'vault') {
    if (!hasTech(P, 'deep_resonance')) {
      const n = Math.round((P.research ? techCost(G, P.research, pid) * 0.25 : 30) * k);
      if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + n; else P.progress._bank = (P.progress._bank || 0) + n;
      text = `a recording of the vault's song: +${n} science. Deep Resonance would let you decode it`;
      P.vaultHeard = (P.vaultHeard || []).concat(s.id);
      u.charges = Math.min(UNITS[u.type].charges || 2, u.charges + 1); // nothing was opened, the kit is kept
    } else {
      P.vaults.push(s.id); u.charges = Math.min(UNITS[u.type].charges || 2, u.charges + 1); // decoding is listening, not digging: the kit is kept
      for (const a of AFF_KEYS) gainAff(G, pid, a, 5, 'an Echo Vault');
      text = P.vaults.length >= 3 ? `the vault opened and spoke. ${P.vaults.length} Echo Vaults decoded, enough for the Listening Array` : `the vault opened and spoke. ${P.vaults.length} of 3 Echo Vaults decoded`;
      for (const Q of G.players) if (Q.human && Q.id !== pid && Q.met.includes(pid) && P.vaults.length >= 2) logEvent(G, Q.id, `The ${CIVS[P.civ].name} have decoded ${P.vaults.length} Echo Vaults.`, -1);
      offerStory(G, pid, 'first_vault');
    }
  }
  logEvent(G, pid, `${SITE_KINDS[s.kind].name}: ${text}.`, s.tile);
  if ((u.charges || 0) <= 0 && P.human) logEvent(G, pid, 'That Explorer has used its last expedition kit. It can restock in a colony with a Field Lab.', u.tile);
  computeVisibility(G, pid);
}
// Explorers refill their kits in a colony with a Field Lab, once per visit.
function restockExplorer(G, u) {
  const c = G._cityAt.get(u.tile), U = UNITS[u.type];
  if (!U.recon || !c || c.owner !== u.owner || !c.buildings.includes('library')) return false;
  const max = U.charges || 2; if ((u.charges || 0) >= max) return false;
  u.charges = max; return true;
}

// ---- fauna nests ----
function placeNests(G, starts) {
  if (G.cfg.barbarians === 'off') return;
  const m = G.map, g = G._grid, rng = RNG.fromSeed(G.seed + '|nests'), want = Math.round((CAMP_MAX[G.cfg.size] || 8) * 0.6);
  const cands = [];
  for (let t = 0; t < g.N; t++) {
    if (!passableTerrain(G, t) || m.owner[t] >= 0 || G._mil.has(t) || G._civ.has(t) || siteAt(G, t) || ruinAt(G, t)) continue;
    if (starts.some(s => g.dist(s, t) < 6)) continue;
    cands.push(t);
  }
  rng.shuffle(cands);
  const B = barbPid(G);
  for (const t of cands) {
    if (G.camps.length >= want) break;
    if (G.camps.some(c => g.dist(c.tile, t) < 6) || G.cities.some(c => g.dist(c.tile, t) < 5)) continue;
    const id = G.nextId++;
    G.camps.push({ id, tile: t, timer: 4 + rng.int(4), hoard: ((id * 2654435761) >>> 0) % 100 < 25 });
    if (B >= 0) { const u = spawnUnit(G, rng.chance(0.5) ? 'skitter' : 'spinemaw', B, t); u.camp = id; }
    m.veil[t] = 1;
  }
}
// An Explorer next to a nest can study it once: science and Communion experience.
function studyStatus(G, u) {
  if (!UNITS[u.type].recon) return null;
  const P = G.players[u.owner];
  const camp = G.camps.find(c => G._grid.dist(c.tile, u.tile) <= 1 && !P.studied.includes(c.id));
  if (!camp) return null;
  return { ok: u.moves > 0, camp, why: u.moves > 0 ? '' : 'No moves left this turn.' };
}
function studyNest(G, u) {
  const st = studyStatus(G, u); if (!st || !st.ok) return false;
  const P = G.players[u.owner], fx = polFx(P), k = 1 + (fx.nestSci || 0) / 100;
  P.studied.push(st.camp.id); u.moves = 0; u.acted = true;
  const n = Math.round((P.research ? techCost(G, P.research, u.owner) * 0.2 : 25 * paceOf(G)) * k);
  if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + n; else P.progress._bank = (P.progress._bank || 0) + n;
  const xp = gainAff(G, u.owner, 'communion', Math.round(6 * k), 'studying a nest');
  P.rage = Math.max(0, (P.rage || 0) - 3);
  logEvent(G, u.owner, `Your Explorer studied a fauna nest: +${n} science and +${xp} Communion experience.`, st.camp.tile);
  if (P.studied.length === 1) offerStory(G, u.owner, 'first_study');
  return true;
}

Object.assign(HX, { veilAt, veilImmune, veilDamage, scourVeil, seedVeil, veilInBorders, veilUnrest, landingInfo, chooseLanding, SITE_KINDS, siteAt, siteKnown, digStatus, startDig, studyStatus, studyNest, restockExplorer, LOADOUT });
