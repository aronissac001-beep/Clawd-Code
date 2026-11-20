// ===== world.js : the wider Kessa. Rival colonies of other sponsors grow beside yours and race you to milestones,
// trade with you and send you their troubles; remote sites on the world map are reached by expedition rockets.
// Everything here draws from its own seeded random stream (G.world.rng), so the colony's own stream is untouched.
const WORLD = { sites: 4, maxSites: 6, offers: 3, tradeFirst: 6, evFirst: 14 };
// the rival colonies: one per sponsor that is not yours, each with its own colony name, colour and habits
const RIVALS = {
  orrin: { colony: 'Vask Landing', style: 'trade', color: '#e8c25a', growth: 1.02, sci: 1, desc: 'A busy freight town. Buys precious goods, sells parts and circuitry.' },
  union: { colony: 'Concord Ring', style: 'people', color: '#7fd0ff', growth: 1.08, sci: 0.9, desc: 'Grows fastest: cheap arks and big families. Hungry for food.' },
  meridian: { colony: 'Lyceum Station', style: 'science', color: '#b48cff', growth: 0.94, sci: 1.35, desc: 'Researchers first. Sells research, wants electronics and Kessite.' },
  tessaline: { colony: 'Deepcut', style: 'mining', color: '#ff8a5a', growth: 1.0, sci: 0.95, desc: 'Miners in a canyon. Sells metals and rare ore, wants parts and fuel.' },
  pilgrim: { colony: 'Hope Hollow', style: 'faith', color: '#9fdc6a', growth: 0.88, sci: 0.85, desc: 'Poor but tireless. Trades sinter and metals for food.' },
};
const RIVAL_DIFF = { easy: { n: 2, g: 0.86 }, normal: { n: 3, g: 1 }, hard: { n: 3, g: 1.1 } };
// the race: the first colony on Kessa to get there takes the prize (a sponsor bonus) and the bragging rights
const RACES = [
  { k: 'dome', name: 'First dome on Kessa', prize: 250 },
  { k: 'pop50', name: 'First to 50 colonists', prize: 350 },
  { k: 'expedition', name: 'First expedition home', prize: 250 },
  { k: 'pop100', name: 'First to 100 colonists', prize: 550 },
  { k: 'techs25', name: 'First to 25 technologies', prize: 450 },
  { k: 'wonder', name: 'First wonder raised', prize: 450 },
  { k: 'independence', name: 'First free colony', prize: 0 },
];
// what goods are worth between colonies (per unit, in funding)
const TRADE_VAL = { metals: 6, sinter: 4.5, parts: 14, polymers: 15, electronics: 27, food: 2.5, fuel: 5, rare: 26, crystals: 75, rp: 1.1 };
const TRADE_STYLE = {
  trade: { sell: ['parts', 'electronics', 'polymers'], buy: ['rare', 'crystals', 'food'] },
  people: { sell: ['polymers', 'food', 'sinter'], buy: ['food', 'parts', 'metals'] },
  science: { sell: ['rp', 'electronics', 'parts'], buy: ['electronics', 'crystals', 'rare'] },
  mining: { sell: ['metals', 'rare', 'sinter'], buy: ['parts', 'fuel', 'polymers'] },
  faith: { sell: ['sinter', 'metals', 'food'], buy: ['food', 'polymers', 'fuel'] },
};
// remote sites on the world map: who they need, how long the work takes, how risky it is and what it pays
const SITES = {
  wreck: { name: 'Derelict freighter', icon: 'parts', crew: ['engineer', 'engineer'], drones: 3, sols: 2, risk: 0.14, reward: { res: { parts: 30, electronics: 10, metals: 40 } }, text: 'A cargo hauler that never made orbit. Its holds are still sealed.' },
  glacier: { name: 'Glacier cave', icon: 'water', crew: ['geologist', 'engineer'], drones: 2, sols: 3, risk: 0.18, reward: { res: { fuel: 45, polymers: 14 } }, text: 'Blue ice under a cliff, rich in volatiles. Refined on site into fuel and resin.' },
  kessite: { name: 'Kessite field', icon: 'crystals', crew: ['geologist', 'geologist'], drones: 4, sols: 3, risk: 0.24, reward: { res: { crystals: 14, rare: 18 } }, text: 'Pink crystal spires break the surface for kilometres.' },
  ruins: { name: 'Pillar ruins', icon: 'star', crew: ['scientist', 'scientist'], drones: 2, sols: 4, risk: 0.28, reward: { relic: 1, rp: 350 }, text: 'Fallen basalt pillars carved with lines no instrument made. Something was kept here.' },
  beacon: { name: 'Distress beacon', icon: 'warn', crew: ['medic', 'security'], rover: true, sols: 2, risk: 0.2, reward: { survivors: 5 }, fades: 14, text: 'A stranded crew of prospectors is calling for help. Their air will not last forever.' },
  rift: { name: 'Deep rift', icon: 'quake', crew: ['scientist', 'geologist'], drones: 3, sols: 4, risk: 0.38, reward: { breakthrough: 1, rp: 250 }, text: 'A crack in the crust breathing warm gas. Dangerous, and full of answers.' },
  drop: { name: 'Lost supply drop', icon: 'rockets', crew: ['engineer'], drones: 2, sols: 1, risk: 0.08, reward: { prefab: 'dome_s', probes: 2 }, text: 'An old sponsor drop pod, off course by two hundred kilometres.' },
  crater: { name: 'Fresh impact crater', icon: 'meteor', crew: ['geologist', 'scientist'], drones: 3, sols: 3, risk: 0.24, reward: { res: { rare: 30 }, rp: 200 }, text: 'Last month\'s impact threw up metal-rich glass and deep rock.' },
};
// relics from the ruins: each gives the colony a small, lasting bonus; three of them reveal the Great Orrery
const RELICS = {
  shard: { name: 'Singing Shard', mods: { research: 0.05 }, text: 'A sliver of basalt that rings when the wind blows. Research +5%.' },
  compass: { name: 'Glass Compass', mods: { vehicleSpeed: 0.2, scan: 0.2 }, text: 'Always points at the nearest ruin. Vehicles +20%, surveys +20%.' },
  seed: { name: 'Ember Seedpod', mods: { farm: 0.06 }, text: 'Still warm after ages. Farms +6%.' },
  tablet: { name: 'Charter Tablet', mods: { morale: 3 }, text: 'A law of some vanished people, carved in glass. +3 morale.' },
  pearl: { name: 'Storm Pearl', mods: { dustWear: -0.1 }, text: 'Dust slides off it. Storms wear buildings 10% less.' },
  idol: { name: 'Basalt Idol', mods: { comfort: 2 }, text: 'A squat, smiling figure. Colonists like it. +2 comfort.' },
  lens: { name: 'Orrery Lens', mods: { expSafe: 0.05 }, text: 'Shows the sky as it was. Expeditions are a little safer.' },
};
const XPAD = { fuel: 8, fuelPer: 4 };

function wrng(G) { const W = G.world; return W._r || (W._r = new RNG(W.rng)); }
function worldOf(G) { if (!G.world) worldInit(G); return G.world; }
function rivalOf(G, k) { return G.world && G.world.rivals.find(r => r.k === k); }
function mapDist(a, b) { return Math.hypot((a.x - b.x) * 2, a.y - b.y); }
function siteTravel(G, s) { const P0 = G.world.home; return clamp(Math.round(0.6 + mapDist(P0, s) * 3.2), 1, 3); }
function worldInit(G) {
  const r = RNG.fromSeed(G.seed + '/world'), DR = RIVAL_DIFF[G.cfg.difficulty] || RIVAL_DIFF.normal;
  const home = { x: 0.4 + r.next() * 0.2, y: 0.42 + r.next() * 0.16 };
  const pool = r.shuffle(Object.keys(RIVALS).filter(k => k !== G.cfg.sponsor)).slice(0, DR.n), rivals = [];
  pool.forEach((k, i) => {
    const a = (i / pool.length + r.next() * 0.18) * 6.283 + 0.4, d = 0.2 + r.next() * 0.12;
    rivals.push({ k, name: RIVALS[k].colony, x: clamp(home.x + Math.cos(a) * d * 0.62, 0.08, 0.92), y: clamp(home.y + Math.sin(a) * d, 0.12, 0.88), pop: 0, techs: 2, domes: 0, rel: 50, st: 'founding', ms: {},
      domeAt: 8 + r.int(8), landAt: 0, g: RIVALS[k].growth * DR.g * (0.94 + r.next() * 0.12), down: 0, claim: null, trades: 0 });
  });
  for (const rv of rivals) rv.landAt = rv.domeAt + 4 + r.int(5);
  G.world = { rng: r.state(), home, rivals, races: {}, sites: [], offers: [], exps: [], relics: [], nextSite: 0, nextTrade: WORLD.tradeFirst * HOURS_PER_SOL, nextEv: WORLD.evFirst * HOURS_PER_SOL, n: 0, log: [] };
  const W = G.world; W._r = r;
  for (let i = 0; i < WORLD.sites; i++) addSite(G, i === 0 ? 'drop' : null);
  // a colony from before rivals existed: the others have been growing all along
  const sol = solOf(G.tick);
  for (let s = 1; s < sol; s++) { for (const rv of W.rivals) rivalSol(G, rv, s, true); raceCheck(G, s, true); }
  W.nextTrade = Math.max(W.nextTrade, G.tick + 2 * HOURS_PER_SOL); W.nextEv = Math.max(W.nextEv, G.tick + 4 * HOURS_PER_SOL);
  W.rng = W._r.state();
  return W;
}
// a new remote site, somewhere open on the map
function addSite(G, kind) {
  const W = G.world, r = wrng(G), sol = solOf(G.tick);
  if (!kind) { const kinds = Object.keys(SITES).filter(k => (k !== 'beacon' || sol >= 15) && !W.sites.some(s => s.kind === k && !s.claimed)); kind = r.pick(kinds.length ? kinds : Object.keys(SITES)); }
  let best = null;
  for (let k = 0; k < 60 && !best; k++) { const p = { x: 0.06 + r.next() * 0.88, y: 0.1 + r.next() * 0.8 }; if (mapDist(p, W.home) < 0.14 || mapDist(p, W.home) > 0.62 || W.rivals.some(rv => mapDist(p, rv) < 0.09) || W.sites.some(s => !s.claimed && mapDist(p, s) < 0.12)) continue; best = p; }
  if (!best) best = { x: clamp(W.home.x + r.range(-0.35, 0.35), 0.05, 0.95), y: clamp(W.home.y + r.range(-0.35, 0.35), 0.08, 0.92) };
  W.n++;
  const s = { id: W.n, kind, x: Math.round(best.x * 1000) / 1000, y: Math.round(best.y * 1000) / 1000, found: sol, claimed: null, by: null, exp: null, rv: null };
  if (SITES[kind].fades) s.fades = sol + SITES[kind].fades;
  W.sites.push(s);
  if (W.sites.length > 18) { const i = W.sites.findIndex(x => x.claimed && !x.exp && !W.exps.some(e => e.site === x.id)); if (i >= 0) W.sites.splice(i, 1); }
  return s;
}
// one sol of a rival colony: it founds a dome, takes colonists, grows, researches, suffers setbacks and reaches milestones
function rivalSol(G, rv, sol, quiet) {
  const r = wrng(G), DF = DIFFICULTY[G.cfg.difficulty], R0 = RIVALS[rv.k];
  if (sol >= rv.domeAt && !rv.domes) { rv.domes = 1; rv.ms.dome = sol; rv.st = 'growing'; }
  if (sol >= rv.landAt && !rv.pop) { rv.pop = 9 + r.int(4); if (!quiet) wlog(G, rv.name + ' welcomed its first colonists.'); }
  if (rv.pop > 0) {
    const g = rv.g * (rv.down > 0 ? 0.35 : 1);
    rv.pop = Math.min(320, rv.pop + g * (1 + 0.011 * rv.pop) * r.range(0.5, 1.5));
    rv.techs = Math.min(70, rv.techs + 0.27 * rv.g * R0.sci * r.range(0.6, 1.4) * (rv.down > 0 ? 0.5 : 1));
    rv.domes = 1 + Math.floor(rv.pop / 22);
    if (rv.down > 0 && --rv.down === 0) rv.st = rv.ms.independence ? 'free' : 'growing';
    // setbacks: storms, breaches and epidemics hit rivals too
    if (rv.down <= 0 && sol > 25 && r.chance(0.028)) {
      const lost = Math.max(2, Math.round(rv.pop * r.range(0.04, 0.1)));
      rv.pop = Math.max(6, rv.pop - lost); rv.down = 4 + r.int(4); rv.st = 'struggling';
      if (!quiet) { wlog(G, r.pick(['A dust storm', 'A dome breach', 'A fever', 'A reactor fire']) + ' at ' + rv.name + ' cost them ' + lost + ' colonists.'); if (G.colonists.length >= 20 && !G.event && r.chance(0.45)) worldEvent(G, 'w_refugees', rv, { n: Math.min(6, 2 + Math.round(lost / 3)) }); }
    }
    if (!rv.ms.pop50 && rv.pop >= 50) rv.ms.pop50 = sol;
    if (!rv.ms.pop100 && rv.pop >= 100) rv.ms.pop100 = sol;
    if (!rv.ms.techs25 && rv.techs >= 25) rv.ms.techs25 = sol;
    if (!rv.ms.wonder && rv.techs >= 22 && rv.pop >= 70 && r.chance(0.05)) { rv.ms.wonder = sol; if (!quiet) wlog(G, rv.name + ' has raised a wonder: ' + r.pick(['a sky mirror', 'a listening array', 'a cathedral of glass', 'a deep reactor']) + '.'); }
    if (!rv.ms.independence && rv.pop >= DF.pop && rv.techs >= 25 && sol >= 95 && r.chance(0.07)) { rv.ms.independence = sol; rv.st = 'free'; if (!quiet) wlog(G, rv.name + ' has declared its independence from ' + SPONSORS[rv.k].name + '.'); }
  }
  // rival expeditions go after the open sites nearest to them
  if (rv.pop >= 18 && !rv.claim && r.chance(0.055 * rv.g)) {
    const W = G.world, open = W.sites.filter(s => !s.claimed && !s.rv).sort((a, b) => mapDist(a, rv) - mapDist(b, rv));
    const s = open[0];
    if (s && mapDist(s, rv) < 0.5) {
      const sols = 2 * clamp(Math.round(0.6 + mapDist(s, rv) * 3.2), 1, 3) + SITES[s.kind].sols;
      s.rv = { r: rv.k, at: G.tick + sols * HOURS_PER_SOL + (quiet ? 0 : 0) }; rv.claim = s.id;
      if (!quiet) wlog(G, rv.name + ' has sent an expedition to the ' + SITES[s.kind].name.toLowerCase() + ' (it should get there in about ' + sols + ' sols).', 'warn');
    }
  }
}
function wlog(G, m, k) { const W = G.world; W.log.push({ t: G.tick, m }); if (W.log.length > 40) W.log.shift(); log(G, m, k || 'info'); }
// has the player reached a race goal (by the given sol)?
function playerRace(G, k, sol) {
  const by = v => v !== undefined && v <= sol;
  if (k === 'dome' || k === 'pop50' || k === 'pop100' || k === 'independence') return by(G.ms[k]);
  if (k === 'techs25') { if (techCount(G) >= 25 && sol >= solOf(G.tick) - 1) return true; const h0 = G.hist.find(x => x.techs >= 25); return !!h0 && h0.sol <= sol; }
  if (k === 'wonder') return G.buildings.some(b => b.built && WONDERS.includes(b.t));
  if (k === 'expedition') return (G.st.expeditions || 0) > 0;
  return false;
}
function raceCheck(G, sol, quiet) {
  const W = G.world;
  for (const R0 of RACES) {
    if (W.races[R0.k]) continue;
    if (playerRace(G, R0.k, sol)) {
      W.races[R0.k] = { who: 'you', sol };
      if (!quiet) { const prize = Math.round(R0.prize * DIFFICULTY[G.cfg.difficulty].funds); if (prize) { G.funds += prize; noteProd(G, 'funds', prize); } addConf(G, 4); log(G, 'Rivalry: you won the race "' + R0.name + '"' + (prize ? '. Your sponsor pays a prize of ' + prize + '.' : '.'), 'good'); fx(G, { k: 'milestone', id: 'race' }); }
      continue;
    }
    const w = W.rivals.filter(rv => rv.ms[R0.k] !== undefined && rv.ms[R0.k] <= sol).sort((a, b) => a.ms[R0.k] - b.ms[R0.k])[0];
    if (w) { W.races[R0.k] = { who: w.k, sol: w.ms[R0.k] }; if (!quiet) { addConf(G, -1); log(G, 'Rivalry: ' + w.name + ' won the race "' + R0.name + '".', 'warn'); } }
  }
}
// ---- trade offers between colonies ----
function relFactor(rv) { return 1 - clamp((rv.rel - 50) / 50, -1, 1) * 0.12; }
function makeOffer(G) {
  const W = G.world, r = wrng(G), live = W.rivals.filter(rv => rv.pop > 0 && rv.rel >= 15);
  if (!live.length) return null;
  const rv = r.weighted(live, x => 0.5 + x.rel / 50), st = TRADE_STYLE[RIVALS[rv.k].style], scale = 1 + solOf(G.tick) / 150, rf = relFactor(rv);
  const value = Math.round((180 + r.int(260)) * scale);
  const o = { id: ++W.n, r: rv.k, give: {}, take: {}, until: G.tick + 3 * HOURS_PER_SOL };
  const kind = r.next();
  if (kind < 0.5) { const k = r.pick(st.sell), n = Math.max(1, Math.round(value / TRADE_VAL[k])); o.give[k] = n; o.take.funds = Math.round(n * TRADE_VAL[k] * 0.85 * rf / 5) * 5; o.kind = 'sell'; }
  else if (kind < 0.85) { const k = r.pick(st.buy), n = Math.max(1, Math.round(value / TRADE_VAL[k] * 0.8)); o.take[k] = n; o.give.funds = Math.round(n * TRADE_VAL[k] * 0.72 / rf / 5) * 5; o.kind = 'buy'; }
  else { const a = r.pick(st.sell.filter(k => k !== 'rp')), b = r.pick(st.buy.filter(k => k !== a)), na = Math.max(1, Math.round(value / TRADE_VAL[a])), nb = Math.max(1, Math.round(value / TRADE_VAL[b] * 0.85 * rf)); o.give[a] = na; o.take[b] = nb; o.kind = 'swap'; }
  W.offers.push(o);
  log(G, rv.name + ' offers a trade: ' + offerText(o) + '. See World → Trade.', 'info');
  fx(G, { k: 'trade' });
  return o;
}
function goodsText(o) { return Object.entries(o).map(([k, n]) => k === 'funds' ? n + ' funding' : k === 'rp' ? n + ' research' : n + ' ' + RES[k].name.toLowerCase()).join(', '); }
function offerText(o) { return 'you get ' + goodsText(o.give) + ' for ' + goodsText(o.take); }
function offerCheck(G, o) {
  if (!o) return { ok: false, why: 'The offer has expired.' };
  for (const [k, n] of Object.entries(o.take)) if (have(G, k) < n) return { ok: false, why: 'You need ' + n + ' ' + (k === 'funds' ? 'funding' : RES[k].name.toLowerCase()) + '.' };
  return { ok: true };
}
function acceptOffer(G, id) {
  const W = worldOf(G), o = W.offers.find(x => x.id === id), c = offerCheck(G, o); if (!c.ok) return { err: c.why };
  const rv = rivalOf(G, o.r);
  for (const [k, n] of Object.entries(o.take)) { if (k === 'funds') G.funds -= n; else G.res[k] -= n; noteUse(G, k, n); }
  for (const [k, n] of Object.entries(o.give)) {
    if (k === 'funds') { G.funds += n; noteProd(G, 'funds', n); }
    else if (k === 'rp') G.research.pool = (G.research.pool || 0) + n;
    else { G.res[k] += n; G.sol.imp = G.sol.imp || {}; G.sol.imp[k] = (G.sol.imp[k] || 0) + n; }
  }
  W.offers = W.offers.filter(x => x !== o); G.st.trades = (G.st.trades || 0) + 1;
  if (rv) { rv.rel = clamp(rv.rel + 5, 0, 100); rv.trades++; }
  log(G, 'Trade with ' + (rv ? rv.name : 'a rival') + ': ' + offerText(o) + '.', 'good');
  return { ok: true };
}
function declineOffer(G, id) { const W = worldOf(G), n = W.offers.length; W.offers = W.offers.filter(x => x.id !== id); return { ok: W.offers.length < n }; }
// ---- rivalry decisions: shown like any other colony decision, with the rival's name in them ----
const evRival = G => (G.event && G.event.r && rivalOf(G, G.event.r)) || (G.world && G.world.rivals[0]) || { name: 'A rival colony', rel: 50, k: 'orrin' };
const relAdd = (G, d) => { const rv = evRival(G); if (rv && rv.k) rv.rel = clamp(rv.rel + d, 0, 100); };
const W_EVENTS = {
  w_aid: { title: G => 'Storm damage at ' + evRival(G).name, text: G => 'A dust storm tore open a dome at ' + evRival(G).name + '. Their engineers ask whether you can spare 8 parts and 10 polymers to seal it before night.',
    choices: [{ label: 'Send the aid (8 parts, 10 polymers)', note: 'they will remember it', ok: G => G.res.parts >= 8 && G.res.polymers >= 10, run: G => { G.res.parts -= 8; G.res.polymers -= 10; relAdd(G, 16); addConf(G, 2); } },
      { label: 'Wish them luck', note: 'relations cool', run: G => relAdd(G, -6) }] },
  w_poach: { title: G => evRival(G).name + ' is hiring', text: G => evRival(G).name + '\'s recruiters are offering your colonists double pay to move over. One of your engineers is packing a bag.',
    cond: G => G.colonists.some(c => stage(c) === 'adult' && c.born === undefined),
    choices: [{ label: 'Match the offer (200 funding)', note: 'they stay', ok: G => G.funds >= 200, run: G => { G.funds -= 200; } },
      { label: 'Let them go', note: 'you lose a colonist', run: G => { const list = G.colonists.filter(c => stage(c) === 'adult' && c.born === undefined && !c.pinJob); const c = list.length ? wrng(G).pick(list) : null; if (c) { removeColonist(G, c); G.st.left++; log(G, c.name + ' left for ' + evRival(G).name + '.', 'warn'); rehome(G); } relAdd(G, 3); } }] },
  w_joint: { title: 'A joint survey', text: G => evRival(G).name + ' proposes pooling satellite time over the region. Each colony pays 250 funding and both get the data.',
    choices: [{ label: 'Join in (250 funding)', note: 'research and survey data', ok: G => G.funds >= 250, run: G => { G.funds -= 250; G.research.pool = (G.research.pool || 0) + 350; let n = 0; for (let i = 0; i < G.sectors.length && n < 2; i++) if (!G.sectors[i].st) { finishSurvey(G, i); n++; } relAdd(G, 8); } },
      { label: 'Decline', run: G => relAdd(G, -2) }] },
  w_refugees: { title: G => 'Survivors from ' + evRival(G).name, text: G => ((G.event && G.event.n) || 4) + ' colonists from ' + evRival(G).name + '\'s wrecked outpost walked to your lander. They ask to stay on with you.',
    choices: [{ label: 'Take them in', note: 'they need beds and food', run: G => { const n = (G.event && G.event.n) || 4; for (let i = 0; i < n; i++) { const p = makePerson(G, { age: 24 + wrng(G).int(20) }); const c = addColonist(G, p, null); c.sanity = 60; c.refugee = true; } G.st.arrived += n; rehome(G); relAdd(G, 14); } },
      { label: 'Send them home with supplies (15 food)', ok: G => G.res.food >= 15, run: G => { G.res.food -= 15; relAdd(G, 4); } },
      { label: 'Turn them away', note: 'relations sour', run: G => relAdd(G, -12) }] },
  w_spy: { title: 'Sensor logs for sale', text: G => 'A survey team from ' + evRival(G).name + ' offers you their regional sensor logs for 180 funding, no questions asked.',
    choices: [{ label: 'Buy the logs (180 funding)', note: 'two sectors and a new site', ok: G => G.funds >= 180, run: G => { G.funds -= 180; let n = 0; for (let i = G.sectors.length - 1; i >= 0 && n < 2; i--) if (!G.sectors[i].st) { finishSurvey(G, i); n++; } if (G.world) addSite(G); relAdd(G, 3); } },
      { label: 'No thanks' }] },
};
for (const k in W_EVENTS) { W_EVENTS[k].world = true; W_EVENTS[k].story = true; }
Object.assign(EVENTS, W_EVENTS);
function worldEvent(G, id, rv, extra) {
  if (G.event) return false;
  G.event = Object.assign({ id, at: G.tick, r: rv ? rv.k : null }, extra || {});
  log(G, 'Decision needed: ' + eventInfo(G).title + '.', 'warn'); fx(G, { k: 'event' });
  return true;
}
// ---- expeditions: crew, drones and sometimes a rover fly out on the skimmer, work the site and come back ----
function padOf(G) { return G.buildings.find(b => b.t === 'xpad'); }
function expFuel(G, s) { return XPAD.fuel + XPAD.fuelPer * siteTravel(G, s); }
function crewFor(G, s) {
  const need = SITES[s.kind].crew, used = new Set(), out = [];
  const pool = G.colonists.filter(c => canWork(c) && c.health > 60 && !c.rest && !c.leaving).sort((a, b) => (b.health + b.morale) - (a.health + a.morale));
  for (const sp of need) {
    let c = pool.find(x => !used.has(x.id) && x.spec === sp);
    let stand = false;
    if (!c) { c = pool.find(x => !used.has(x.id) && x.spec === 'none') || pool.find(x => !used.has(x.id)); stand = true; }
    if (!c) return { err: 'Not enough healthy adults to crew it.', out };
    used.add(c.id); out.push({ id: c.id, spec: sp, stand });
  }
  return { out };
}
function dronesFree(G) { let n = 0; for (const b of G.buildings) if (!b.mod && b.built && BUILDINGS[b.t].hub) n += b.drones; return n; }
function expCheck(G, siteId) {
  const W = worldOf(G), s = W.sites.find(x => x.id === siteId); if (!s) return { ok: false, why: 'No such site.' };
  const D = SITES[s.kind], pad = padOf(G);
  const res = { ok: false, site: s, fuel: expFuel(G, s), drones: D.drones || 0, travel: siteTravel(G, s), crew: [] };
  if (s.claimed) return Object.assign(res, { why: s.claimed === 'you' ? 'Your crews have already worked this site.' : 'Claimed by ' + rivalOf(G, s.claimed).name + '.' });
  if (s.exp) return Object.assign(res, { why: 'Your expedition is already on its way there.' });
  const cr = crewFor(G, s); res.crew = cr.out; res.stand = cr.out.filter(c => c.stand).length;
  if (!pad) return Object.assign(res, { why: 'Build an Expedition Pad (Build → Base) to launch expeditions.' });
  if (!pad.built) return Object.assign(res, { why: 'The Expedition Pad is still being built.' });
  if (pad.broken || !pad.on || pad.pw < 0.5) return Object.assign(res, { why: 'The Expedition Pad has no power or is broken.' });
  if (W.exps.length) return Object.assign(res, { why: 'The skimmer is away on another expedition.' });
  if (cr.err) return Object.assign(res, { why: cr.err });
  if (G.res.fuel < res.fuel) return Object.assign(res, { why: 'Needs ' + res.fuel + ' fuel for the skimmer.' });
  if (D.drones && dronesFree(G) < D.drones + 4) return Object.assign(res, { why: 'Needs ' + D.drones + ' drones to spare (and 4 to stay home).' });
  if (D.rover && !G.vehicles.some(v => v.t === 'pathfinder' && !v.path.length && !v.task)) return Object.assign(res, { why: 'Needs an idle Pathfinder rover to carry the survivors.' });
  res.chance = expChance(G, s, res.stand, 0); res.ok = true;
  return res;
}
function expChance(G, s, stand, extra) { const D = SITES[s.kind]; return clamp(0.92 - D.risk - 0.12 * stand + 0.04 * Math.min(2, extra || 0) + M(G, 'expSafe'), 0.2, 0.97); }
function launchExpedition(G, siteId, crewIds) {
  const c = expCheck(G, siteId); if (!c.ok) return { err: c.why };
  const W = G.world, s = c.site, D = SITES[s.kind];
  let crew = c.crew;
  if (crewIds && crewIds.length === crew.length) crew = crewIds.map((id, i) => { const p = cById(G, id); return p && canWork(p) ? { id, spec: crew[i].spec, stand: p.spec !== crew[i].spec } : null; }).filter(Boolean);
  if (crew.length !== c.crew.length || new Set(crew.map(x => x.id)).size !== crew.length) return { err: 'Pick a different colonist for each seat.' };
  G.res.fuel -= c.fuel; noteUse(G, 'fuel', c.fuel);
  const people = [];
  for (const x of crew) { const p = cById(G, x.id); removeColonist(G, p); p.job = null; p.shift = null; p.pinJob = null; p.expSpec = x.spec; people.push(p); }
  // drones come from the best-stocked hubs
  let left = D.drones || 0;
  while (left > 0) { const h0 = G.buildings.filter(b => !b.mod && b.built && BUILDINGS[b.t].hub).sort((a, b) => b.drones - a.drones)[0]; if (!h0 || h0.drones <= 0) break; h0.drones--; left--; }
  let rover = null;
  if (D.rover) { const v = G.vehicles.find(v => v.t === 'pathfinder' && !v.path.length && !v.task); if (v) { rover = v; G.vehicles.splice(G.vehicles.indexOf(v), 1); } }
  const stand = crew.filter(x => x.stand).length;
  const e = { id: ++W.n, site: s.id, crew: people, drones: (D.drones || 0) - left, rover, phase: 'out', t: c.travel * HOURS_PER_SOL, travel: c.travel, stand, chance: expChance(G, s, stand, 0), res: null, at: G.tick };
  W.exps.push(e); s.exp = e.id;
  G.st.expLaunched = (G.st.expLaunched || 0) + 1; rehome(G); G._jobsDirty = true;
  log(G, 'The skimmer lifted off for the ' + D.name.toLowerCase() + ' with ' + people.map(p => p.name).join(', ') + (e.drones ? ' and ' + e.drones + ' drones' : '') + (rover ? ' and the Pathfinder' : '') + '. Back in about ' + (2 * c.travel + D.sols) + ' sols.', 'info', landingSpotOf(G));
  fx(G, { k: 'xlaunch' });
  return { ok: true, exp: e };
}
function rewardText(rw) {
  const p = [];
  if (rw.res) p.push(Object.entries(rw.res).map(([k, n]) => n + ' ' + RES[k].name.toLowerCase()).join(', '));
  if (rw.rp) p.push(rw.rp + ' research'); if (rw.survivors) p.push(rw.survivors + ' survivors'); if (rw.relic) p.push('a relic'); if (rw.breakthrough) p.push('a breakthrough');
  if (rw.prefab) p.push('a prefab ' + BUILDINGS[rw.prefab].name); if (rw.probes) p.push(rw.probes + ' orbital probes');
  return p.join(', ');
}
function scaleReward(rw, f) { const o = {}; if (rw.res) { o.res = {}; for (const k in rw.res) o.res[k] = Math.round(rw.res[k] * f); } if (rw.rp) o.rp = Math.round(rw.rp * f); if (rw.survivors) o.survivors = Math.max(f >= 0.5 ? 2 : 0, Math.round(rw.survivors * f)); if (f >= 0.5) { if (rw.relic) o.relic = 1; if (rw.prefab) o.prefab = rw.prefab; if (rw.probes) o.probes = rw.probes; } if (f >= 1 && rw.breakthrough) o.breakthrough = 1; return o; }
function expPhaseEnd(G, e) {
  const W = G.world, s = W.sites.find(x => x.id === e.site), D = SITES[s.kind], r = wrng(G);
  if (e.phase === 'out') {
    if (s.claimed && s.claimed !== 'you') { e.res = { kind: 'claimed', by: s.claimed, rw: scaleReward(D.reward, 0.2) }; e.phase = 'back'; e.t = e.travel * HOURS_PER_SOL; log(G, 'The expedition reached the ' + D.name.toLowerCase() + ', but ' + rivalOf(G, s.claimed).name + ' had already stripped it. They salvage what is left and turn home.', 'warn'); return; }
    e.phase = 'work'; e.t = D.sols * HOURS_PER_SOL; s.working = true;
    log(G, 'The expedition landed at the ' + D.name.toLowerCase() + ' and started work.', 'info'); return;
  }
  if (e.phase === 'work') {
    s.working = false; s.claimed = 'you'; s.by = solOf(G.tick);
    const roll = r.next(), p = e.chance; let out;
    if (roll < p) out = { kind: 'success', rw: scaleReward(D.reward, 1) };
    else if (roll < p + (1 - p) * 0.6) out = { kind: 'partial', rw: scaleReward(D.reward, 0.5), hurt: 1 };
    else out = { kind: 'mishap', rw: scaleReward(D.reward, 0.25), hurt: 1 + r.int(2), lost: Math.min(e.drones, 1 + r.int(2)), death: D.risk >= 0.28 && r.chance(0.35) };
    for (let i = 0; i < (out.hurt || 0) && e.crew.length; i++) { const c = r.pick(e.crew); c.health = Math.max(8, c.health - 45); }
    if (out.death && e.crew.length > 1) { const c = r.pick(e.crew); e.crew.splice(e.crew.indexOf(c), 1); G.st.deaths++; G.st.deathsBy = G.st.deathsBy || {}; G.st.deathsBy.expedition = (G.st.deathsBy.expedition || 0) + 1; out.died = c.name; addConf(G, -1.5); }
    if (out.lost) e.drones -= out.lost;
    e.res = out; e.phase = 'back'; e.t = e.travel * HOURS_PER_SOL;
    log(G, 'Expedition report from the ' + D.name.toLowerCase() + ': ' + (out.kind === 'success' ? 'complete success.' : out.kind === 'partial' ? 'the work is done, but someone was hurt.' : 'an accident' + (out.died ? ': ' + out.died + ' was killed' : '') + (out.lost ? ', ' + out.lost + ' drones lost' : '') + '.') + ' Heading home with ' + (rewardText(out.rw) || 'nothing') + '.', out.kind === 'success' ? 'good' : 'warn');
    return;
  }
  // home again
  expHome(G, e);
}
function expHome(G, e) {
  const W = G.world, s = W.sites.find(x => x.id === e.site), D = SITES[s.kind], rw = (e.res && e.res.rw) || {};
  for (const c of e.crew) { delete c.expSpec; c.home = null; c.job = null; c.shift = null; c.trips = (c.trips || 0) + 1; G.colonists.push(c); G._cById.set(c.id, c); }
  const L = G.buildings.find(b => b.t === 'lander'); if (L) L.drones += Math.max(0, e.drones);
  if (e.rover) { const p = landingSpotOf(G) || { x: 32, y: 32 }; const q = nearestFree(G, p.x + 3, p.y + 3); Object.assign(e.rover, { x: q.x, y: q.y, path: [], task: null, prog: 0 }); delete e.rover.px; delete e.rover.py; G.vehicles.push(e.rover); }
  const got = [];
  if (rw.res) for (const [k, n] of Object.entries(rw.res)) { G.res[k] += n; }
  if (rw.rp) G.research.pool = (G.research.pool || 0) + rw.rp;
  if (rw.prefab) G.prefabs[rw.prefab] = (G.prefabs[rw.prefab] || 0) + 1;
  if (rw.probes) G.probes += rw.probes;
  if (rw.breakthrough) { const bt = grantBreakthrough(G); if (bt) got.push('breakthrough "' + TECHS[bt].name + '"'); }
  if (rw.relic) { const left = Object.keys(RELICS).filter(k => !W.relics.includes(k)); if (left.length) { const k = wrng(G).pick(left); W.relics.push(k); got.push('the ' + RELICS[k].name + ' (' + RELICS[k].text + ')'); computeMods(G); relicCheck(G); } }
  if (rw.survivors) { for (let i = 0; i < rw.survivors; i++) { const p = makePerson(G, { age: 26 + wrng(G).int(22) }); const c = addColonist(G, p, null); c.sanity = 70; c.rescued = true; } G.st.arrived += rw.survivors; G.st.rescued = (G.st.rescued || 0) + rw.survivors; }
  W.exps = W.exps.filter(x => x !== e); s.exp = null;
  if (e.res && e.res.kind !== 'claimed') G.st.expeditions = (G.st.expeditions || 0) + 1;
  rehome(G); G._jobsDirty = true;
  log(G, 'The skimmer is home from the ' + D.name.toLowerCase() + '. ' + (rewardText(rw) ? 'Brought back: ' + rewardText(rw) + '.' : 'They brought back nothing.') + (got.length ? ' Found: ' + got.join('; ') + '.' : ''), 'good', landingSpotOf(G));
  fx(G, { k: 'xland' });
}
// three relics reveal what the ruins were for: the Great Orrery
function relicCheck(G) {
  const W = G.world;
  if (W.relics.length >= 3 && !techDone(G, 'myst_orrery')) { G.research.done.myst_orrery = G.tick; computeMods(G); log(G, 'The three relics fit together: a lens, a ring and a key of an orrery that tracked Kessa\'s sky long before anyone came. Engineers can build the Great Orrery (Science).', 'good'); fx(G, { k: 'milestone' }); }
}
function worldMods(G) { const m = {}, W = G.world; if (!W) return m; for (const k of W.relics) for (const [x, v] of Object.entries(RELICS[k].mods)) m[x] = (m[x] || 0) + v; return m; }
// ---- the hourly and daily world ----
function worldHour(G) {
  const W = G.world; if (!W) return;
  for (const e of W.exps.slice()) { e.t--; if (e.t <= 0) expPhaseEnd(G, e); }
  if (W.offers.length && G.tick % 6 === 0) W.offers = W.offers.filter(o => o.until > G.tick);
  const pad = padOf(G); if (pad) pad._home = !W.exps.length;
}
function worldSol(G) {
  const W = worldOf(G), r = wrng(G), sol = solOf(G.tick) - 1;
  for (const rv of W.rivals) rivalSol(G, rv, sol, false);
  // rival expeditions arrive: whoever finishes the work first takes the site
  for (const s of W.sites) {
    if (!s.rv || G.tick < s.rv.at) continue;
    const rv = rivalOf(G, s.rv.r); s.rv = null; if (rv) rv.claim = null;
    if (s.claimed || s.working) { if (rv && s.working) { rv.rel = clamp(rv.rel - 3, 0, 100); wlog(G, rv.name + '\'s expedition found your crew already at work at the ' + SITES[s.kind].name.toLowerCase() + ' and turned back.'); } continue; }
    s.claimed = rv.k; s.by = sol; rv.ms.expedition = rv.ms.expedition || sol;
    if (s.kind === 'beacon') rv.pop += 5; else rv.techs += 0.6;
    wlog(G, rv.name + ' claimed the ' + SITES[s.kind].name.toLowerCase() + '.', 'warn');
  }
  for (const s of W.sites) if (s.fades && !s.claimed && !s.exp && sol >= s.fades) { s.claimed = 'lost'; wlog(G, 'The distress beacon fell silent. Nobody reached the stranded prospectors in time.', 'warn'); }
  if (sol >= W.nextSite && W.sites.filter(s => !s.claimed).length < WORLD.maxSites) { const s = addSite(G); W.nextSite = sol + 6 + r.int(5); if (sol > 3) wlog(G, 'Orbital scans found a new remote site: the ' + SITES[s.kind].name.toLowerCase() + '. See World.'); }
  raceCheck(G, sol, false);
  // trade offers and rivalry decisions
  if (G.tick >= W.nextTrade) { if (W.offers.length < WORLD.offers && G.st.everColonists) makeOffer(G); W.nextTrade = G.tick + (5 + r.int(5)) * HOURS_PER_SOL; }
  if (G.tick >= W.nextEv && !G.event && G.colonists.length >= 12) {
    const live = W.rivals.filter(rv => rv.pop > 0);
    const ids = ['w_aid', 'w_poach', 'w_joint', 'w_spy'].filter(id => !W_EVENTS[id].cond || W_EVENTS[id].cond(G));
    if (live.length && ids.length) { const rv = r.pick(live), id = rv.rel < 35 ? (r.chance(0.6) ? 'w_poach' : r.pick(ids)) : r.pick(ids); worldEvent(G, id, rv); }
    W.nextEv = G.tick + (11 + r.int(7)) * HOURS_PER_SOL;
  }
  // relations drift back towards neutral
  for (const rv of W.rivals) rv.rel = Math.round((rv.rel + (50 - rv.rel) * 0.02) * 10) / 10;
}
// for the rivalry board: where every colony stands
function rivalBoard(G) {
  const W = worldOf(G);
  const you = { k: 'you', name: 'Your colony', pop: G.colonists.length + W.exps.reduce((s, e) => s + e.crew.length, 0), techs: techCount(G), domes: G.buildings.filter(b => !b.mod && b.built && BUILDINGS[b.t].dome).length, st: G.ms.independence ? 'free' : 'growing', you: true };
  return [you].concat(W.rivals.map(rv => ({ k: rv.k, name: rv.name, pop: Math.floor(rv.pop), techs: Math.floor(rv.techs), domes: rv.domes, st: rv.st, rel: rv.rel, color: RIVALS[rv.k].color })));
}
function raceLeader(G, k) {
  const W = worldOf(G), you = G.colonists.length, rv = W.rivals;
  const val = { dome: x => x.domes ? 1 : 0, pop50: x => x.pop / 50, pop100: x => x.pop / 100, techs25: x => x.techs / 25, wonder: x => x.ms.wonder ? 1 : x.techs / 30, expedition: x => x.ms.expedition ? 1 : 0, independence: x => x.ms.independence ? 1 : Math.min(x.pop / DIFFICULTY[G.cfg.difficulty].pop, x.techs / 25) };
  const mine = { dome: G.ms.dome ? 1 : 0, pop50: you / 50, pop100: you / 100, techs25: techCount(G) / 25, wonder: 0, expedition: G.st.expeditions ? 1 : 0, independence: Math.min(you / DIFFICULTY[G.cfg.difficulty].pop, techCount(G) / 25) }[k] || 0;
  let best = { who: 'you', f: mine };
  for (const x of rv) { const f = val[k](x); if (f > best.f) best = { who: x.k, f }; }
  return { who: best.who, f: Math.min(1, best.f), you: Math.min(1, mine) };
}
const WONDERS = ['mirror', 'array', 'vault', 'undergrove', 'relay', 'orrery'];
function worldScore(G) { const W = G.world; if (!W) return 0; return Object.values(W.races).filter(x => x.who === 'you').length * 100 + W.relics.length * 80 + (G.st.expeditions || 0) * 30 + (G.st.rescued || 0) * 10; }
Object.assign(KC, { WORLD, RIVALS, RACES, SITES, RELICS, TRADE_VAL, XPAD, WONDERS, worldOf, worldInit, rivalOf, siteTravel, expCheck, expChance, launchExpedition, acceptOffer, declineOffer, offerCheck, offerText, goodsText, rewardText, rivalBoard, raceLeader, worldMods, mapDist, padOf, crewFor, dronesFree, worldEvent, W_EVENTS });
