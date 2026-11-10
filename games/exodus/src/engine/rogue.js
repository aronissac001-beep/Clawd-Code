// ===== rogue.js : supply pods, Precursor artifacts, directives, and the Odyssey run mode =====
// Supply pods from the arks are scattered over the world; the first land unit to reach one opens it.
// Artifacts are permanent boons that feed the same effect keys as virtues (see polFx). Each exists once in the world.
// Odyssey mode adds a boon draft at landfall and at every new phase, perils that scale with Peril level,
// ironman saves (enforced by the UI) and a run score multiplier.

const RELICS = [
  { key: 'sunstone', name: 'Resonant Monolith', glyph: '🗿', fx: { cityProd: 1 }, text: '+1 production in every colony.' },
  { key: 'star_chart', name: 'Precursor Star Chart', glyph: '🌠', fx: { sciPct: 10 }, text: '+10% science.' },
  { key: 'golden_scarab', name: 'Living Coin', glyph: '🪲', fx: { goldPct: 15 }, text: '+15% credits.' },
  { key: 'muse_lyre', name: 'Singing Shell', glyph: '🐚', fx: { cityCul: 1 }, text: '+1 culture in every colony.' },
  { key: 'weeping_icon', name: 'Seed of the Weave', glyph: '🌱', fx: { affPct_communion: 25 }, text: '+25% Communion experience.' },
  { key: 'horn_plenty', name: 'Bottomless Pod', glyph: '🫛', fx: { capFood: 3, keepFood: 5 }, text: 'Capital +3 food. Colonies keep 5% more food when they grow.' },
  { key: 'war_banner', name: 'Precursor Blade', glyph: '🗡️', fx: { combatPct: 8 }, text: '+8% combat strength for all your units.' },
  { key: 'drill_manual', name: 'Tactical Engram', glyph: '💽', fx: { xp: 10, milProdPct: 15 }, text: 'New units start with 10 experience. +15% production toward military units.' },
  { key: 'ledger', name: 'Ark Ledger', glyph: '📒', fx: { buyPct: -15 }, text: 'Buying with credits costs 15% less.' },
  { key: 'laughing_mask', name: 'Dreaming Mask', glyph: '🎭', fx: { happy: 3 }, text: '+3 morale.' },
  { key: 'astrolabe', name: 'Tide Compass', glyph: '🧭', fx: { navalMoves: 1, sciPct: 4 }, text: 'Ships +1 move. +4% science.' },
  { key: 'old_crown', name: 'Crown of the Sleepers', glyph: '👑', fx: { capProdPct: 15, capGoldPct: 15 }, text: 'Capital +15% production and +15% credits.' },
  { key: 'founders_cart', name: 'Ark Lander Core', glyph: '🛸', fx: { settlerCostPct: -25 }, text: 'Colony Pods cost 25% less.' },
  { key: 'golden_bough', name: 'Lattice Shard', glyph: '💠', fx: { affPct_lattice: 25 }, text: '+25% Lattice experience.' },
  { key: 'prayer_wheel', name: 'Genome Codex', glyph: '🧬', fx: { affPct_lineage: 25 }, text: '+25% Lineage experience.' },
  { key: 'starmetal_anvil', name: 'Starmetal Anvil', glyph: '⚒️', fx: { prodPct: 6 }, text: '+6% production.' },
  { key: 'dowsing_rod', name: 'Ark Beacon Key', glyph: '🔑', fx: {}, text: 'Shows every supply pod in the world. Pods you open give two rewards.' },
  // Double-edged artifacts: a strong upside with a real cost.
  { key: 'blood_crown', name: 'Hungering Crystal', glyph: '🩸', cursed: true, fx: { prodPct: 15, happy: -4 }, text: '+15% production. −4 morale.' },
  { key: 'hungry_coin', name: 'Debt Engine', glyph: '🪙', cursed: true, fx: { goldPct: 30, culPct: -10 }, text: '+30% credits. −10% culture.' },
  { key: 'mad_skull', name: 'Whispering Skull', glyph: '💀', cursed: true, fx: { culPct: 25, sciPct: -8 }, text: '+25% culture. −8% science.' },
  { key: 'iron_oath', name: 'Iron Oath', glyph: '⛓️', cursed: true, fx: { combatPct: 15, goldPct: -12 }, text: '+15% combat strength. −12% credits.' },
];
const RELI = {}; RELICS.forEach((r, i) => RELI[r.key] = r);

// Odyssey perils: Peril N applies the first N. Each level adds 25% to the run score.
const CURSES = [
  { key: 'raiders', name: 'Restless Wild', glyph: '🦗', text: 'Fauna are restless (unless you turned them off).' },
  { key: 'bold_rivals', name: 'Bold Rivals', glyph: '😠', text: 'Rivals play one difficulty level higher.' },
  { key: 'lean', name: 'Hard Landing', glyph: '🎒', text: 'You land with no Explorer and no credits.' },
  { key: 'dark_omens', name: 'Spore Season', glyph: '🌫️', fx: { happy: -2 }, text: '−2 morale for the whole game.' },
  { key: 'crowded', name: 'Crowded Orbit', glyph: '👥', text: 'One more rival, if the map has room.' },
  { key: 'iron_rivals', name: 'Armed Rivals', glyph: '🛡️', text: 'Every rival lands with an extra Skirmisher and Marine.' },
];
const MAX_HEAT = CURSES.length;
const CURSI = {}; CURSES.forEach(c => CURSI[c.key] = c);

// One-off boons offered in drafts next to artifacts.
const BOONS = [
  { key: 'treasure', name: 'Cargo Drop', glyph: '💠', text: (G, pid) => `+${boonGold(G, pid)} credits now.` },
  { key: 'inspiration', name: 'Datacache', glyph: '💡', ok: (G, pid) => !!G.players[pid].research, text: (G, pid) => `+${boonSci(G, pid)} science toward ${TECHS[TECHI[G.players[pid].research]].name}.` },
  { key: 'muster', name: 'Cryo Squad', glyph: '⚔️', ok: (G, pid) => ownCities(G, pid).length > 0, text: (G, pid) => `Two ${UNITS[eraUnitFor(G, pid)].name} units appear in your capital, with 15 experience.` },
  { key: 'migrants', name: 'Late Sleepers', glyph: '🧺', ok: (G, pid) => ownCities(G, pid).length > 0, text: () => '+1 citizen in each of up to three colonies.' },
  { key: 'renaissance', name: 'Archive Recovered', glyph: '📯', text: (G, pid) => `+${boonCul(G, pid)} culture now.` },
  { key: 'pioneers', name: 'Second Lander', glyph: '🏕️', ok: (G, pid) => G.turn < 120, text: () => 'A free Colony Pod and Rigger.' },
];
const BOONI = {}; BOONS.forEach(b => BOONI[b.key] = b);
const boonGold = (G, pid) => Math.round(90 * (1 + playerEra(G.players[pid]) * 0.8) * paceOf(G));
const boonSci = (G, pid) => { const P = G.players[pid]; return P.research ? Math.round(techCost(G, P.research, pid) * 0.6) : 0; };
const boonCul = (G, pid) => Math.round(70 * (1 + playerEra(G.players[pid]) * 0.7) * paceOf(G));

// Planetary conditions: one rule for every faction for the whole game.
const OMENS = [
  { key: 'reason', name: 'Clear Skies', glyph: '🔭', fx: { sciPct: 15 }, text: 'Every faction gets +15% science.' },
  { key: 'gold_rush', name: 'Rich Crust', glyph: '⛏️', fx: { goldPct: 20 }, text: 'Every faction gets +20% credits.' },
  { key: 'zeal', name: 'The Long Bloom', glyph: '🌸', fx: { affPct_all: 20 }, text: 'Every faction gets +20% affinity experience.' },
  { key: 'muses', name: 'Aurora Years', glyph: '🌌', fx: { culPct: 15 }, text: 'Every faction gets +15% culture.' },
  { key: 'iron', name: 'Hunting Season', glyph: '🗡️', fx: { combatPct: 10, milProdPct: 20 }, text: 'All units +10% combat strength; military units are 20% cheaper to build.' },
  { key: 'plenty', name: 'Fertile Rains', glyph: '🌧️', fx: { keepFood: 15 }, text: 'Every colony keeps 15% more food when it grows.' },
  { key: 'industry', name: 'Magnetic Storms', glyph: '🧲', fx: { prodPct: 8 }, text: 'Every faction gets +8% production.' },
  { key: 'calm', name: 'Quiet Moons', glyph: '🌗', fx: { happy: 3 }, text: 'Every faction gets +3 morale.' },
  { key: 'wanderlust', name: 'Scattered Fleet', glyph: '📦', fx: {}, text: 'Twice as many supply pods.' },
  { key: 'relics', name: 'Age of Precursors', glyph: '🏺', fx: {}, text: 'Every faction lands with a random artifact.' },
];
const OMENI = {}; OMENS.forEach(o => OMENI[o.key] = o);
const omenOf = G => G.cfg.omen && OMENI[G.cfg.omen] || null;

const RUIN_COUNT = { small: 9, medium: 14, large: 20, huge: 28 };

// ---- effects ----
// Combined effect of a player's relics and curses, folded into polFx.
function relicFxList(P) {
  const out = [];
  for (const k of P.relics || []) if (RELI[k]) out.push(RELI[k].fx);
  for (const k of P.curses || []) if (CURSI[k] && CURSI[k].fx) out.push(CURSI[k].fx);
  if (P._omenFx) out.push(P._omenFx);
  return out;
}
const hasRelic = (P, k) => !!(P.relics && P.relics.includes(k));
function grantRelic(G, pid, key, how) {
  const P = G.players[pid]; P.relics = P.relics || [];
  if (P.relics.includes(key) || !RELI[key]) return false;
  P.relics.push(key); P._fx = null;
  const R = RELI[key];
  logEvent(G, pid, `Artifact found: ${R.glyph} ${R.name}${how ? ' (' + how + ')' : ''}. ${R.text}`, -1);
  return true;
}
function relicsLeft(G, pid, cursedOk) {
  const P = G.players[pid], held = new Set();
  for (const Q of G.players) for (const k of Q.relics || []) held.add(k); // each relic exists once in the world
  return RELICS.filter(r => !held.has(r.key) && (cursedOk || !r.cursed) && !(P.relics || []).includes(r.key));
}

// ---- ruins ----
// Placed with its own RNG stream so existing seeds keep the same land, starts and wonders.
function placeRuins(G, starts) {
  G.ruins = [];
  if (G.cfg.ruins === false) return;
  const m = G.map, g = G._grid, rng = RNG.fromSeed(G.seed + '|ruins'), want = (RUIN_COUNT[G.cfg.size] || 12) * (G.cfg.omen === 'wanderlust' ? 2 : 1);
  const nat = new Set((G.natural || []).map(n => n.tile)), cands = [];
  for (let t = 0; t < m.W * m.H; t++) {
    if (!passableTerrain(G, t) || nat.has(t) || m.owner[t] >= 0) continue;
    if (starts.some(s => g.dist(s, t) < 4)) continue;
    cands.push(t);
  }
  rng.shuffle(cands);
  for (const t of cands) {
    if (G.ruins.length >= want) break;
    if (G.ruins.some(r => g.dist(r, t) < (G.cfg.omen === 'wanderlust' ? 4 : 6))) continue;
    G.ruins.push(t);
  }
  G._ruinSet = null;
}
function ruinAt(G, t) {
  if (!G.ruins || !G.ruins.length) return false;
  if (!G._ruinSet || G._ruinSet.n !== G.ruins.length) { G._ruinSet = new Set(G.ruins); G._ruinSet.n = G.ruins.length; }
  return G._ruinSet.has(t);
}
function eraUnitFor(G, pid) {
  const P = G.players[pid], ck = civKey(P), lean = primaryAff(P);
  if (lean) for (const t of ['t3', 't2']) { const k = LINES.infantry[t][lean], U = UNITS[k]; if (hasTech(P, U.tech) && affLevel(P, lean) >= U.affLvl && !U.res) return k; }
  return unitFor(ck, 'militia');
}
// A free tile near `center` for a new unit, never one of `avoid` (a moving unit's tiles are not in the maps yet).
function freeNear(G, center, type, avoid, r) {
  const civ = UNITS[type].civilian, occ = civ ? G._civ : G._mil;
  for (const t of G._grid.within(center, r || 2)) {
    if (avoid && avoid.includes(t)) continue;
    if (!passableTerrain(G, t) || occ.has(t) || G._cityAt.has(t)) continue;
    return t;
  }
  return -1;
}
function nearestOwnCity(G, pid, t) {
  let best = null, bd = 1e9;
  for (const c of G.cities) if (c.owner === pid) { const d = G._grid.dist(c.tile, t); if (d < bd) { bd = d; best = c; } }
  return best;
}
// The reward table. Each entry: weight, whether it can happen, and what it does (returns the log text).
const RUIN_REWARDS = [
  { key: 'gold', w: 22, run: (G, u, P) => { const n = Math.round((40 + 20 * G._rng.int(3)) * (1 + playerEra(P) * 0.6) * paceOf(G)); P.gold += n; return `a credit cache: +${n} credits`; } },
  { key: 'science', w: 16, ok: (G, u, P) => !!P.research, run: (G, u, P) => { const n = Math.round(techCost(G, P.research, P.id) * 0.35); P.progress[P.research] = (P.progress[P.research] || 0) + n; return `research data: +${n} science toward ${TECHS[TECHI[P.research]].name}`; } },
  { key: 'culture', w: 12, run: (G, u, P) => { const n = Math.round(35 * (1 + playerEra(P) * 0.5) * paceOf(G)); P.culturePool += n; return `letters and recordings from home: +${n} culture`; } },
  { key: 'affinity', w: 10, run: (G, u, P) => { const a = AFF_KEYS[G._rng.int(3)], n = gainAff(G, P.id, a, 6, 'a pod'); return `a sealed sample case: +${n} ${AFFINITIES[AFFI[a]].name} experience`; } },
  { key: 'map', w: 10, run: (G, u, P) => { let n = 0; for (const t of G._grid.within(u.tile, 7)) if (!P.explored[t]) { P.explored[t] = 1; n++; } return `an orbital survey chip: ${n} tiles revealed`; } },
  { key: 'unit', w: 10, run: (G, u, P, avoid) => { const k = eraUnitFor(G, P.id), t = freeNear(G, u.tile, k, avoid); if (t < 0) { P.gold += 50; return 'an empty weapons locker: +50 credits'; } spawnUnit(G, k, P.id, t); return `cryo-sleepers who wake and join you: a free ${UNITS[k].name}`; } },
  { key: 'builder', w: 6, ok: (G) => G.turn < 80, run: (G, u, P, avoid) => { const t = freeNear(G, u.tile, 'builder', avoid); if (t < 0) { P.gold += 40; return 'spare tools: +40 credits'; } spawnUnit(G, 'builder', P.id, t); return 'a work crew: a free Rigger'; } },
  { key: 'pop', w: 8, ok: (G, u, P) => G.cities.some(c => c.owner === P.id), run: (G, u, P) => { const c = nearestOwnCity(G, P.id, u.tile); c.pop++; assignWorkers(G, c); return `stranded colonists who settle in ${c.name}: +1 citizen`; } },
  { key: 'veteran', w: 8, ok: (G, u) => !!UNITS[u.type].military && UNITS[u.type].cls !== 'recon', run: (G, u) => { u.xp = (u.xp || 0) + 25; u.hp = 100; return `a combat simulator: your ${UNITS[u.type].name} gains 25 experience and heals`; } },
  { key: 'relic', w: 6, ok: (G, u, P) => (P.ruinRelics || 0) < 2 && relicsLeft(G, P.id, true).length > 0, run: (G, u, P) => { const pool = relicsLeft(G, P.id, true), R = pool[G._rng.int(pool.length)]; P.ruinRelics = (P.ruinRelics || 0) + 1; grantRelic(G, P.id, R.key, 'from a supply pod'); return `an artifact someone packed for safekeeping: the ${R.name}`; } },
  { key: 'ambush', w: 7, ok: (G, u) => G.turn >= 15 && G.cfg.barbarians !== 'off' && !UNITS[u.type].civilian && barbPid(G) >= 0, run: (G, u, P, avoid) => {
    const B = barbPid(G), set = BARB_UNITS[Math.min(BARB_UNITS.length - 1, playerEra(P))]; let n = 0;
    for (let k = 0; k < 2; k++) { const type = set[G._rng.int(set.length)], t = freeNear(G, u.tile, type, avoid, 1); if (t >= 0) { spawnUnit(G, type, B, t); n++; } }
    u.moves = 0; G._zocVer = (G._zocVer || 0) + 1; enrage(G, P.id, 10);
    return n ? `fauna had nested in it! ${n} angry beast${n > 1 ? 's' : ''} burst out` : 'nothing but spores and rust'; } },
];
// A unit steps onto a ruin. `avoid` lists tiles the moving unit occupies but has not yet registered.
function enterRuin(G, u, avoid) {
  const P = G.players[u.owner];
  if (P.barbarian || P.minor || UNITS[u.type].naval || !ruinAt(G, u.tile)) return null;
  const t = u.tile;
  G.ruins.splice(G.ruins.indexOf(t), 1);
  P.stats.ruins = (P.stats.ruins || 0) + 1;
  const rolls = hasRelic(P, 'dowsing_rod') ? 2 : 1, got = [], used = new Set();
  for (let r = 0; r < rolls; r++) {
    const opts = RUIN_REWARDS.filter(x => !used.has(x.key) && (!x.ok || x.ok(G, u, P)) && !(r > 0 && x.key === 'ambush'));
    let sum = 0; for (const x of opts) sum += x.w;
    let roll = G._rng.next() * sum, pick = opts[opts.length - 1];
    for (const x of opts) { roll -= x.w; if (roll <= 0) { pick = x; break; } }
    used.add(pick.key);
    got.push({ key: pick.key, text: pick.run(G, u, P, avoid || [u.tile]) });
  }
  const text = 'Supply pod! ' + got.map(x => x.text[0].toUpperCase() + x.text.slice(1)).join('. ') + '.';
  logEvent(G, u.owner, text, t);
  if (got.some(x => x.key === 'ambush' || x.key === 'unit')) for (const Q of G.players) computeVisibility(G, Q.id);
  return { tile: t, text, keys: got.map(x => x.key) };
}
// Does this player know about (and can see on the map) the ruin at t?
function ruinKnown(G, pid, t) { const P = G.players[pid]; return ruinAt(G, t) && (P.explored[t] || hasRelic(P, 'dowsing_rod')); }

// ---- expedition ----
function expHeat(G) { return G.cfg.expedition ? Math.max(0, Math.min(MAX_HEAT, G.cfg.expedition.heat | 0)) : 0; }
function cursesFor(heat) { return CURSES.slice(0, heat).map(c => c.key); }
// Config changes that must happen before the map is made.
function expeditionConfig(cfg) {
  if (cfg.omen === 'random' || (cfg.expedition && !cfg.omen)) { // the same seed always brings the same omen
    if (!cfg.seed || !String(cfg.seed).trim()) cfg.seed = randomSeedString();
    cfg.omen = OMENS[RNG.fromSeed(String(cfg.seed).trim() + '|omen').int(OMENS.length)].key;
  }
  if (cfg.omen && !OMENI[cfg.omen]) cfg.omen = null;
  if (!cfg.expedition) return;
  const curses = cursesFor(Math.max(0, Math.min(MAX_HEAT, cfg.expedition.heat | 0)));
  cfg.ironman = true;
  cfg.ruins = true;
  if (curses.includes('raiders') && cfg.barbarians !== 'off') cfg.barbarians = 'raging';
  if (curses.includes('bold_rivals')) cfg.difficulty = Math.min(DIFFICULTY.length - 1, (cfg.difficulty | 0) + 1);
  if (curses.includes('crowded')) cfg.rivals = (cfg.rivals | 0) + 1;
}
// After the players exist: apply starting curses and open the first draft.
function applyOmen(G) { // effect objects are transient (not saved); rebuilt on load
  const O = omenOf(G); for (const P of G.players) { P._omenFx = O && !P.barbarian && !P.minor ? O.fx : null; P._fx = null; }
}
function setupExpedition(G) {
  applyOmen(G);
  if (G.cfg.omen === 'relics') for (const P of G.players) if (!P.barbarian && !P.minor) { const pool = relicsLeft(G, P.id, false); if (pool.length) { const R = pool[RNG.fromSeed(G.seed + '|omr' + P.id).int(pool.length)]; P.relics = P.relics || []; P.relics.push(R.key); P._fx = null; } }
  { const O = omenOf(G); if (O) logEvent(G, -1, `Planetary condition: ${O.glyph} ${O.name}. ${O.text}`, -1); }
  if (!G.cfg.expedition) return;
  const curses = cursesFor(expHeat(G));
  G.players.forEach((P, pid) => {
    if (P.barbarian || P.minor) return;
    if (P.human) {
      P.curses = curses.slice(); P._fx = null;
      if (curses.includes('lean')) {
        P.gold = 0;
        for (const u of G.units.slice()) if (u.owner === pid && UNITS[u.type].recon) removeUnit(G, u);
      }
      offerDraft(G, pid, 'The Odyssey begins', 'Choose a boon to carry down to Veyra.');
    } else if (curses.includes('iron_rivals')) {
      const s = G.units.find(u => u.owner === pid && UNITS[u.type].founds);
      if (s) for (const k of ['skirmisher', 'militia']) { const t = freeNear(G, s.tile, k, null, 2); if (t >= 0) spawnUnit(G, k, pid, t); }
    }
  });
}
// Three choices: mostly relics, sometimes a one-off boon, now and then a double-edged relic.
function draftChoices(G, pid) {
  const rng = G._rng, out = [];
  const plain = rng.shuffle(relicsLeft(G, pid, false).slice()), cursed = rng.shuffle(relicsLeft(G, pid, true).filter(r => r.cursed));
  const boons = rng.shuffle(BOONS.filter(b => !b.ok || b.ok(G, pid)).slice());
  if (cursed.length && rng.chance(0.35)) out.push({ k: 'relic', key: cursed[0].key });
  while (out.length < 2 && plain.length) out.push({ k: 'relic', key: plain.shift().key });
  if (boons.length) out.push({ k: 'boon', key: boons.shift().key });
  while (out.length < 3 && plain.length) out.push({ k: 'relic', key: plain.shift().key });
  while (out.length < 3 && boons.length) out.push({ k: 'boon', key: boons.shift().key });
  return out;
}
function offerDraft(G, pid, title, text) {
  const P = G.players[pid], choices = draftChoices(G, pid);
  if (!choices.length) return;
  P.drafts = P.drafts || [];
  P.drafts.push({ title, text, choices, turn: G.turn });
}
function choiceInfo(G, pid, ch) {
  if (ch.k === 'relic') { const R = RELI[ch.key]; return { kind: R.cursed ? 'Cursed relic' : 'Relic', name: R.name, glyph: R.glyph, text: R.text, cursed: !!R.cursed }; }
  const B = BOONI[ch.key]; return { kind: 'Boon', name: B.name, glyph: B.glyph, text: B.text(G, pid) };
}
function pendingDraft(G, pid) {
  const P = G.players[pid], d = P.drafts && P.drafts[0]; if (!d) return null;
  return { title: d.title, text: d.text, choices: d.choices.map((ch, i) => Object.assign({ i }, choiceInfo(G, pid, ch))) };
}
function applyBoon(G, pid, key) {
  const P = G.players[pid], cap = G.cities.find(c => c.owner === pid && c.capital) || G.cities.find(c => c.owner === pid);
  switch (key) {
    case 'treasure': P.gold += boonGold(G, pid); break;
    case 'inspiration': if (P.research) P.progress[P.research] = (P.progress[P.research] || 0) + boonSci(G, pid); break;
    case 'muster': if (cap) { const k = eraUnitFor(G, pid); for (let n = 0; n < 2; n++) { const t = freeNear(G, cap.tile, k, null, 2); if (t >= 0) { const u = spawnUnit(G, k, pid, t); u.xp = 15; } } } break;
    case 'migrants': ownCities(G, pid).sort((a, b) => a.pop - b.pop).slice(0, 3).forEach(c => { c.pop++; assignWorkers(G, c); }); break;
    case 'renaissance': P.culturePool += boonCul(G, pid); break;
    case 'pioneers': {
      const at = cap ? cap.tile : (G.units.find(u => u.owner === pid) || {}).tile;
      if (at === undefined) { P.gold += 100; break; }
      for (const k of ['settler', 'builder']) { const t = freeNear(G, at, k, null, 3); if (t >= 0) spawnUnit(G, k, pid, t); }
      break;
    }
  }
}
function resolveDraft(G, pid, i) {
  const P = G.players[pid], d = P.drafts && P.drafts[0]; if (!d) return false;
  const ch = d.choices[i]; if (!ch) return false;
  P.drafts.shift();
  if (ch.k === 'relic') grantRelic(G, pid, ch.key, 'chosen');
  else { applyBoon(G, pid, ch.key); logEvent(G, pid, `Boon: ${BOONI[ch.key].glyph} ${BOONI[ch.key].name}.`, -1); }
  computeVisibility(G, pid);
  return true;
}
// Called at the start of each player's turn: a new era opens a draft in Expedition mode and a quest offer for humans.
function rogueTurn(G, pid) {
  const P = G.players[pid]; if (P.barbarian || P.minor) return;
  const era = playerEra(P);
  if (P.eraSeen === undefined) P.eraSeen = era;
  if (era > P.eraSeen) {
    P.eraSeen = era;
    if (G.cfg.expedition && P.human) offerDraft(G, pid, `The ${ERAS[era]} Phase`, 'A new phase of the colony brings a new boon. Choose one.');
    if (P.human) offerQuest(G, pid);
  }
  if (P.human && G.turn === Math.round(18 * paceOf(G)) + 2) offerQuest(G, pid); // the first quest, before the first new era
  if (P.quest) checkQuest(G, pid);
}

// ---- quests ----
// Optional objectives with a deadline. Offered to human players: two to choose from (or neither) at each new era.
const questTurns = (G, n) => Math.max(12, Math.round(n * paceOf(G)));
const QUESTS = [
  { key: 'ruins', name: 'Pod Recovery', glyph: '📦', ok: (G, pid) => G.ruins && G.ruins.length >= 3, make: (G, pid, P) => ({ need: 2, base: P.stats.ruins || 0, turns: 30 }),
    cur: (G, pid, P, q) => (P.stats.ruins || 0) - q.base, text: q => `Open ${q.need} supply pods.` },
  { key: 'settle', name: 'New Horizons', glyph: '🏕️', ok: (G, pid) => G.turn < 160 * paceOf(G), make: (G, pid, P) => ({ need: 2, base: P.stats.founded || 0, turns: 35 }),
    cur: (G, pid, P, q) => (P.stats.founded || 0) - q.base, text: q => `Found ${q.need} new colonies.` },
  { key: 'grow', name: 'Great Colony', glyph: '🏙️', ok: (G, pid) => ownCities(G, pid).length > 0, make: (G, pid) => { const m = Math.max(...ownCities(G, pid).map(c => c.pop)); return { need: m + (m >= 10 ? 2 : 3), base: 0, turns: 30 }; },
    cur: (G, pid) => Math.max(0, ...ownCities(G, pid).map(c => c.pop)), text: q => `Grow a colony to size ${q.need}.` },
  { key: 'scholar', name: 'Age of Learning', glyph: '📚', ok: (G, pid, P) => availableTechs(P).length > 0, make: (G, pid, P) => ({ need: 3, base: P.techs.length, turns: 30 }),
    cur: (G, pid, P, q) => P.techs.length - q.base, text: q => `Research ${q.need} technologies.` },
  { key: 'wonder', name: 'Monument to Veyra', glyph: '🗼', ok: (G, pid) => ownCities(G, pid).length > 0, make: (G, pid, P) => ({ need: 1, base: (P._wonders || []).length, turns: 45 }),
    cur: (G, pid, P, q) => (P._wonders || []).length - q.base, text: () => 'Complete a planetary wonder.' },
  { key: 'hunter', name: 'Clear the Nests', glyph: '🦗', ok: (G, pid, P) => G.camps.some(c => P.explored[c.tile]), make: (G, pid, P) => ({ need: 1, base: P.stats.camps || 0, turns: 25 }),
    cur: (G, pid, P, q) => (P.stats.camps || 0) - q.base, text: () => 'Destroy a fauna nest.' },
  { key: 'statecraft', name: 'Statecraft', glyph: '📜', ok: (G, pid, P) => P.policies.length < 30, make: (G, pid, P) => ({ need: 2, base: P.policies.length, turns: 35 }),
    cur: (G, pid, P, q) => P.policies.length - q.base, text: q => `Adopt ${q.need} virtues.` },
  { key: 'treasury', name: 'Reserve Fund', glyph: '💠', ok: () => true, make: (G, pid, P) => ({ need: Math.round(P.gold + 220 * (1 + playerEra(P)) * paceOf(G)), base: 0, turns: 30 }),
    cur: (G, pid, P) => Math.floor(P.gold), text: q => `Hold ${q.need} credits at once.` },
  { key: 'builder', name: 'Master Builder', glyph: '🛠️', ok: (G, pid) => ownCities(G, pid).length > 0, make: (G, pid) => ({ need: 4, base: ownCities(G, pid).reduce((a, c) => a + c.buildings.length, 0), turns: 30 }),
    cur: (G, pid, P, q) => ownCities(G, pid).reduce((a, c) => a + c.buildings.length, 0) - q.base, text: q => `Construct ${q.need} buildings.` },
  { key: 'digger', name: 'Expedition Season', glyph: '⛏️', ok: (G, pid, P) => (G.sites || []).some(s => P.explored[s.tile]), make: (G, pid, P) => ({ need: 2, base: P.stats.digs || 0, turns: 30 }),
    cur: (G, pid, P, q) => (P.stats.digs || 0) - q.base, text: q => `Complete ${q.need} excavations with Explorers.` },
  { key: 'scourer', name: 'Burn It Back', glyph: '🔥', ok: (G, pid, P) => hasTech(P, 'biocontainment') && veilInBorders(G, pid) >= 3, make: (G, pid, P) => ({ need: 4, base: P.stats.scoured || 0, turns: 25 }),
    cur: (G, pid, P, q) => (P.stats.scoured || 0) - q.base, text: q => `Scour ${q.need} Veil tiles.` },
];
const QUESTI = {}; QUESTS.forEach(q => QUESTI[q.key] = q);
function questReward(G, pid) {
  const pool = relicsLeft(G, pid, false);
  if (pool.length && G._rng.chance(0.6)) return { relic: pool[G._rng.int(pool.length)].key };
  return { gold: Math.round(120 * (1 + playerEra(G.players[pid]) * 0.8) * paceOf(G)) };
}
function offerQuest(G, pid) {
  const P = G.players[pid];
  if (G.cfg.quests === false || P.quest || P.questOffer) return;
  const opts = G._rng.shuffle(QUESTS.filter(q => q.key !== P.lastQuest && q.ok(G, pid, P)).slice()).slice(0, 2);
  if (!opts.length) return;
  P.questOffer = opts.map(Q => { const q = Object.assign({ key: Q.key }, Q.make(G, pid, P)); q.reward = questReward(G, pid); return q; });
}
function rewardText(r) { return r.relic ? `${RELI[r.relic].glyph} ${RELI[r.relic].name} (artifact)` : `${r.gold} credits`; }
function questInfo(G, pid, q) {
  const Q = QUESTI[q.key], P = G.players[pid];
  return { key: q.key, name: Q.name, glyph: Q.glyph, text: Q.text(q), reward: rewardText(q.reward), cur: Math.max(0, Q.cur(G, pid, P, q)), need: q.need,
    left: q.until !== undefined ? q.until - G.turn : questTurns(G, q.turns) };
}
function pendingQuestOffer(G, pid) { const P = G.players[pid]; return P.questOffer ? P.questOffer.map(q => questInfo(G, pid, q)) : null; }
function acceptQuest(G, pid, i) {
  const P = G.players[pid]; if (!P.questOffer) return false;
  const q = i >= 0 ? P.questOffer[i] : null;
  P.questOffer = null;
  if (!q) return true; // declined
  q.until = G.turn + questTurns(G, q.turns);
  P.quest = q; P.lastQuest = q.key;
  logEvent(G, pid, `Directive accepted: ${QUESTI[q.key].name}. ${QUESTI[q.key].text(q)} Reward: ${rewardText(q.reward)}.`, -1);
  return true;
}
function activeQuest(G, pid) { const P = G.players[pid]; return P.quest ? questInfo(G, pid, P.quest) : null; }
function checkQuest(G, pid) {
  const P = G.players[pid], q = P.quest, Q = QUESTI[q.key];
  if (Q.cur(G, pid, P, q) >= q.need) {
    P.quest = null; P.stats.quests = (P.stats.quests || 0) + 1;
    const r = q.reward;
    if (r.relic && !grantRelic(G, pid, r.relic, 'quest reward')) { r.relic = null; r.gold = Math.round(150 * paceOf(G)); }
    if (r.gold) P.gold += r.gold;
    logEvent(G, pid, `Directive complete: ${Q.name}!` + (r.gold ? ` +${r.gold} credits.` : ''), -1);
  } else if (G.turn > q.until) {
    P.quest = null;
    logEvent(G, pid, `Directive failed: ${Q.name}. Time ran out.`, -1);
  }
}
function runMultiplier(G) { return 1 + 0.25 * expHeat(G); }
function runScore(G, pid, won) { return Math.round(scoreOf(G, pid) * runMultiplier(G) + (won ? 250 * runMultiplier(G) : 0)); }

Object.assign(HX, { OMENS, OMENI, omenOf, applyOmen, QUESTS, pendingQuestOffer, acceptQuest, activeQuest, offerQuest, RELICS, RELI, CURSES, CURSI, BOONS, MAX_HEAT, ruinAt, ruinKnown, enterRuin, grantRelic, pendingDraft, resolveDraft, relicsLeft,
  expHeat, cursesFor, runMultiplier, runScore, hasRelic, eraUnitFor });
