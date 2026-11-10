// ===== religion.js : faith, pantheons, religions, spread =====
const PANTHEONS = [
  { key: 'sun_altar', name: 'Sun Altar', text: '+1 faith in every city.' },
  { key: 'forest_spirits', name: 'Forest Spirits', text: 'Worked Forest tiles +1 faith.' },
  { key: 'mountain_kin', name: 'Mountain Kin', text: 'Worked Hills +1 faith. Cities next to Mountains +2 faith.' },
  { key: 'river_blessing', name: 'River Blessing', text: 'Cities with fresh water +2 faith.' },
  { key: 'sea_spirits', name: 'Sea Spirits', text: 'Worked water tiles +1 faith.' },
  { key: 'herd_totem', name: 'Herd Totem', text: 'Pastures +1 faith and +1 gold.' },
  { key: 'fertility_rites', name: 'Fertility Rites', text: 'Cities keep 10% more food when they grow.' },
  { key: 'ancestor_shrines', name: 'Ancestor Shrines', text: 'Monuments +2 faith.' },
  { key: 'warrior_cult', name: 'Warrior Cult', text: '+2 faith in cities with a military unit inside.' },
  { key: 'desert_stars', name: 'Desert Stars', text: 'Worked Desert +1 faith. Desert by rivers +1 food.' },
];
const FOUNDER_BELIEFS = [
  { key: 'tithe', name: 'Tithe', text: '+1 gold for every 4 followers of your religion in the world.' },
  { key: 'scholar_monks', name: 'Scholar Monks', text: '+2 science for every city that follows your religion.' },
  { key: 'pilgrim_routes', name: 'Pilgrim Routes', text: '+3 faith for every foreign city that follows your religion.' },
  { key: 'ceremonial_rites', name: 'Ceremonial Rites', text: '+1 happiness for every 2 cities that follow your religion.' },
  { key: 'church_council', name: 'Church Council', text: '+1 culture for every city that follows your religion.' },
  { key: 'holy_see', name: 'Holy See', text: 'Holy city +5 faith, +3 culture and +3 gold.' },
];
const FOLLOWER_BELIEFS = [
  { key: 'peace_gardens', name: 'Peace Gardens', text: 'Follower cities +1 happiness for their owner.' },
  { key: 'feed_the_world', name: 'Feed the World', text: 'Shrines and Temples +1 food.' },
  { key: 'choral_music', name: 'Choral Music', text: 'Temples +2 culture.' },
  { key: 'guild_halls', name: 'Guild Halls', text: '+2 production in follower cities with a Temple.' },
  { key: 'bazaar_of_faith', name: 'Bazaar of Faith', text: 'Markets +2 gold.' },
  { key: 'scriptoria', name: 'Scriptoria', text: 'Libraries +2 science.' },
  { key: 'wayside_inns', name: 'Wayside Inns', text: 'Trade routes from follower cities +1 gold and +1 food.' },
  { key: 'ascetic_vows', name: 'Ascetic Vows', text: 'Shrines +1 happiness.' },
];
const ENHANCER_BELIEFS = [
  { key: 'missionary_zeal', name: 'Missionary Zeal', text: 'Missionaries spread 50% more.' },
  { key: 'holy_order', name: 'Holy Order', text: 'Missionaries and Inquisitors cost 30% less faith.' },
  { key: 'sacred_texts', name: 'Sacred Texts', text: 'Your religion spreads 40% more strongly by itself.' },
  { key: 'itinerant_preachers', name: 'Itinerant Preachers', text: 'Your religion reaches 4 tiles farther.' },
  { key: 'defender_of_faith', name: 'Defender of the Faith', text: 'Other religions spread half as strongly into your cities.' },
  { key: 'pilgrim_fleets', name: 'Pilgrim Fleets', text: 'Trade routes carry your religion twice as strongly.' },
];
const BELIEF = {};
for (const [list, kind] of [[PANTHEONS, 'pantheon'], [FOUNDER_BELIEFS, 'founder'], [FOLLOWER_BELIEFS, 'follower'], [ENHANCER_BELIEFS, 'enhancer']]) for (const b of list) BELIEF[b.key] = Object.assign({ kind }, b);
const RELIGION_NAMES = [
  { name: 'Way of Embers', glyph: '🔥' }, { name: 'Path of Tides', glyph: '🌊' }, { name: 'Circle of Leaves', glyph: '🍃' },
  { name: 'Order of the Sun', glyph: '☀️' }, { name: 'Veil of Stars', glyph: '✨' }, { name: 'Hearth Covenant', glyph: '🕯️' },
  { name: 'Moonward Faith', glyph: '🌙' }, { name: 'Stonebound Creed', glyph: '🗿' },
];
const REL = { unbeliefPop: 25, decay: 0.97, base: 6, holyMul: 2, self: 3, range: 10, route: 4, unbelief: 40, missionary: 250, prophetSpread: 500, foundPts: 400 };

function relById(G, id) { for (const r of G.religions) if (r.id === id) return r; return null; }
function relHas(rel, key) { return !!rel && (rel.founder === key || rel.follower === key || rel.follower2 === key || rel.enhancer === key); }
function maxReligions(G) { return Math.ceil(G.players.filter(P => !P.barbarian && !P.minor).length / 2); }
// Followers per religion and the majority religion (if any religion has more than half the citizens).
function cityReligion(G, c) {
  let total = 0; for (const k in c.rel) total += c.rel[k];
  const followers = {}; let major = null, best = 0;
  for (const k in c.rel) {
    const n = Math.floor(c.pop * c.rel[k] / (total + REL.unbelief + REL.unbeliefPop * c.pop) + 0.5); // bigger cities hold on to old ways
    if (n > 0) followers[k] = n;
    if (n * 2 > c.pop && n > best) { best = n; major = +k; }
  }
  return { major, followers };
}
function majorityRel(G, c) { const m = cityReligion(G, c).major; return m === null ? null : relById(G, m); }

// ---- costs ----
function pantheonCost(G, pid) { return Math.round(25 * paceOf(G) * (civKey(G.players[pid]) === 'verdant' ? 0.8 : 1)); }
function prophetCost(G, pid) { return Math.round((150 + 130 * (G.players[pid].prophets || 0)) * paceOf(G)); }
function faithUnitCost(G, pid, type) {
  const P = G.players[pid], rel = relById(G, P.religion);
  return Math.round(UNITS[type].faithCost * paceOf(G) * (relHas(rel, 'holy_order') ? 0.7 : 1));
}
function faithBuildingCost(G, key) { return Math.round(BUILDINGS[BLDI[key]].faithBuy * paceOf(G)); }

// ---- pantheon ----
function pantheonStatus(G, pid) {
  const P = G.players[pid];
  if (P.pantheon) return { ok: false, why: 'You already have a pantheon.' };
  if (!hasTech(P, 'mysticism')) return { ok: false, why: 'Pantheons need Mysticism.' };
  const cost = pantheonCost(G, pid);
  if (P.faith < cost) return { ok: false, why: `Needs ${cost} faith.`, cost };
  return { ok: true, cost };
}
function pantheonTaken(G, key) { return G.players.some(P => P.pantheon === key); }
function pickPantheon(G, pid, key) {
  const st = pantheonStatus(G, pid); if (!st.ok || pantheonTaken(G, key) || !PANTHEONS.some(p => p.key === key)) return false;
  const P = G.players[pid]; P.faith -= st.cost; P.pantheon = key;
  for (const c of ownCities(G, pid)) assignWorkers(G, c);
  logEvent(G, pid, `Your people now worship ${BELIEF[key].name}.`, -1);
  for (const Q of G.players) if (Q.id !== pid && Q.human && Q.met.includes(pid)) logEvent(G, Q.id, `The ${CIVS[P.civ].name} adopted the ${BELIEF[key].name} pantheon.`, -1);
  return true;
}

// ---- prophets and founding ----
function prophetUseful(G, pid) {
  const P = G.players[pid];
  if (!hasTech(P, 'philosophy')) return false;
  if (P.religion === null) return G.religions.length < maxReligions(G);
  const rel = relById(G, P.religion);
  return !rel.enhancer && hasTech(P, 'theology');
}
function checkProphet(G, pid) {
  const P = G.players[pid];
  if (!prophetUseful(G, pid) || G.units.some(u => u.owner === pid && u.type === 'prophet')) return;
  const cost = prophetCost(G, pid); if (P.faith < cost) return;
  const cs = ownCities(G, pid); const home = cs.find(c => c.capital) || cs[0]; if (!home) return;
  const t = spawnTileFor(G, home, 'prophet'); if (t < 0) return;
  P.faith -= cost; P.prophets = (P.prophets || 0) + 1;
  const u = spawnUnit(G, 'prophet', pid, t); u.moves = 0;
  if (P.human) logEvent(G, pid, `A Prophet has appeared in ${home.name}.`, t);
}
function freeReligionNames(G) { return RELIGION_NAMES.map((r, i) => i).filter(i => !G.religions.some(r => r.nameIdx === i)); }
function freeBeliefs(G, kind) {
  const used = new Set(); for (const r of G.religions) for (const k of [r.founder, r.follower, r.follower2, r.enhancer]) if (k) used.add(k);
  const list = kind === 'founder' ? FOUNDER_BELIEFS : kind === 'follower' ? FOLLOWER_BELIEFS : ENHANCER_BELIEFS;
  return list.filter(b => !used.has(b.key)).map(b => b.key);
}
function foundStatus(G, u) {
  const P = G.players[u.owner], c = G._cityAt.get(u.tile);
  if (u.type !== 'prophet') return { ok: false, why: 'Only a Prophet can found a religion.' };
  if (P.religion !== null) return { ok: false, why: 'You already have a religion.' };
  if (!hasTech(P, 'philosophy')) return { ok: false, why: 'Founding a religion needs Philosophy.' };
  if (G.religions.length >= maxReligions(G)) return { ok: false, why: 'Every religion slot in the world is taken.' };
  if (!c || c.owner !== u.owner) return { ok: false, why: 'Move the Prophet into one of your cities; it becomes the holy city.' };
  return { ok: true, city: c };
}
function foundReligion(G, u, nameIdx, founder, follower) {
  const st = foundStatus(G, u); if (!st.ok) return null;
  if (!freeReligionNames(G).includes(nameIdx) || !freeBeliefs(G, 'founder').includes(founder) || !freeBeliefs(G, 'follower').includes(follower)) return null;
  const P = G.players[u.owner], N = RELIGION_NAMES[nameIdx];
  const rel = { id: G.nextId++, nameIdx, name: N.name, glyph: N.glyph, owner: u.owner, holy: st.city.id, founder, follower, follower2: null, enhancer: null, turn: G.turn };
  G.religions.push(rel); P.religion = rel.id;
  st.city.rel[rel.id] = (st.city.rel[rel.id] || 0) + REL.foundPts;
  removeUnit(G, u); computeVisibility(G, u.owner);
  for (const Q of G.players) if (Q.human) logEvent(G, Q.id, Q.id === u.owner ? `You founded the ${rel.name} in ${st.city.name}.` : `The ${CIVS[P.civ].name} founded the ${rel.name}.`, Q.id === u.owner || Q.explored[st.city.tile] ? st.city.tile : -1);
  return rel;
}
function enhanceStatus(G, u) {
  const P = G.players[u.owner], rel = relById(G, P.religion);
  if (u.type !== 'prophet') return { ok: false, why: 'Only a Prophet can enhance a religion.' };
  if (!rel) return { ok: false, why: 'Found a religion first.' };
  if (rel.enhancer) return { ok: false, why: 'Your religion is already enhanced.' };
  if (!hasTech(P, 'theology')) return { ok: false, why: 'Enhancing needs Theology.' };
  return { ok: true, rel };
}
function enhanceReligion(G, u, follower2, enhancer) {
  const st = enhanceStatus(G, u); if (!st.ok) return false;
  if (!freeBeliefs(G, 'follower').includes(follower2) || !freeBeliefs(G, 'enhancer').includes(enhancer)) return false;
  st.rel.follower2 = follower2; st.rel.enhancer = enhancer;
  removeUnit(G, u); computeVisibility(G, u.owner);
  if (G.players[u.owner].human) logEvent(G, u.owner, `The ${st.rel.name} is enhanced: ${BELIEF[follower2].name} and ${BELIEF[enhancer].name}.`, -1);
  return true;
}

// ---- religious units ----
function nearbyCities(G, t) {
  const out = []; const here = G._cityAt.get(t); if (here) out.push(here);
  for (const n of G._grid.neighbors(t)) { const c = G._cityAt.get(n); if (c) out.push(c); }
  return out;
}
function unitReligion(G, u) { return u.rel !== undefined ? u.rel : G.players[u.owner].religion; }
function spreadTargets(G, u) {
  const R = unitReligion(G, u); if (R === null || R === undefined || !relById(G, R)) return [];
  if (u.type !== 'missionary' && u.type !== 'prophet') return [];
  return nearbyCities(G, u.tile).filter(c => { const cr = cityReligion(G, c); return cr.major !== R || (cr.followers[R] || 0) < c.pop; });
}
function spreadReligion(G, u, cityId) {
  const c = spreadTargets(G, u).find(x => x.id === cityId); if (!c || u.moves <= 0) return false;
  const R = unitReligion(G, u), rel = relById(G, R);
  const before = cityReligion(G, c).major;
  const amt = u.type === 'prophet' ? REL.prophetSpread : REL.missionary * (relHas(rel, 'missionary_zeal') ? 1.5 : 1);
  c.rel[R] = (c.rel[R] || 0) + amt;
  u.moves = 0; u.charges = (u.charges || 1) - 1;
  const after = cityReligion(G, c).major;
  if (G.players[u.owner].human) logEvent(G, u.owner, after === R && before !== R ? `${c.name} now follows the ${rel.name}.` : `The ${rel.name} spreads in ${c.name}.`, c.tile);
  if (c.owner !== u.owner && G.players[c.owner].human) logEvent(G, c.owner, `A ${CIVS[G.players[u.owner].civ].adj} ${UNITS[u.type].name} preached the ${rel.name} in ${c.name}.`, c.tile);
  if (u.charges <= 0 || u.type === 'prophet') { removeUnit(G, u); computeVisibility(G, u.owner); }
  return true;
}
function purgeTargets(G, u) {
  if (u.type !== 'inquisitor') return [];
  const R = unitReligion(G, u);
  return nearbyCities(G, u.tile).filter(c => c.owner === u.owner && Object.keys(c.rel).some(k => +k !== R && c.rel[k] > 0));
}
function purgeHeresy(G, u, cityId) {
  const c = purgeTargets(G, u).find(x => x.id === cityId); if (!c || u.moves <= 0) return false;
  const R = unitReligion(G, u);
  for (const k of Object.keys(c.rel)) if (+k !== R) delete c.rel[k];
  u.moves = 0; u.charges = (u.charges || 1) - 1;
  if (G.players[u.owner].human) logEvent(G, u.owner, `Other faiths were driven out of ${c.name}.`, c.tile);
  if (u.charges <= 0) { removeUnit(G, u); computeVisibility(G, u.owner); }
  return true;
}
function faithBuyOptions(G, c) {
  const P = G.players[c.owner], out = [];
  for (const type of ['missionary', 'inquisitor']) {
    const U = UNITS[type], cost = faithUnitCost(G, c.owner, type);
    let why = null;
    if (U.tech && !hasTech(P, U.tech)) why = `Needs ${TECHS[TECHI[U.tech]].name}.`;
    else if (type === 'missionary' && P.religion === null) why = 'Found a religion first.';
    else if (P.faith < cost) why = `Needs ${cost} faith.`;
    out.push({ k: 'u', key: type, cost, ok: !why, why });
  }
  for (const B of BUILDINGS) {
    if (!B.faithBuy) continue;
    const chk = canBuildItem(G, c, { k: 'b', key: B.key }); if (!chk.ok && chk.why !== `Needs ${TECHS[TECHI[B.tech]].name}.`) continue;
    const cost = faithBuildingCost(G, B.key);
    out.push({ k: 'b', key: B.key, cost, ok: chk.ok && P.faith >= cost, why: !chk.ok ? chk.why : P.faith < cost ? `Needs ${cost} faith.` : null });
  }
  return out;
}
function buyWithFaith(G, c, item) {
  const opt = faithBuyOptions(G, c).find(o => o.k === item.k && o.key === item.key);
  if (!opt || !opt.ok) return false;
  const P = G.players[c.owner];
  if (item.k === 'u') {
    const t = spawnTileFor(G, c, item.key); if (t < 0) return false;
    P.faith -= opt.cost;
    const u = spawnUnit(G, item.key, c.owner, t); u.rel = P.religion; u.moves = 0;
  } else {
    P.faith -= opt.cost; c.buildings.push(item.key);
    if (c.build && sameItem(c.build, item)) c.build = c.queue.shift() || null;
    c.queue = c.queue.filter(q => !sameItem(q, item));
  }
  if (P.human) logEvent(G, c.owner, `${c.name} received a ${itemName(item)} for ${opt.cost} faith.`, c.tile);
  return true;
}

// ---- belief and pantheon effects ----
// Extra yields for one city from its owner's pantheon, its majority religion's follower beliefs and the founder's Holy See.
function religionCityFx(G, c) {
  const P = G.players[c.owner], fx = { fa: 0, f: 0, p: 0, g: 0, s: 0, c: 0, keep: 0, routeG: 0, routeF: 0 };
  const has = k => c.buildings.includes(k);
  switch (P.pantheon) {
    case 'sun_altar': fx.fa += 1; break;
    case 'mountain_kin': if (adjacentMountains(G, c.tile) > 0) fx.fa += 2; break;
    case 'river_blessing': if (isFreshWater(G.map, G._grid, c.tile)) fx.fa += 2; break;
    case 'fertility_rites': fx.keep += 10; break;
    case 'ancestor_shrines': if (has('monument')) fx.fa += 2; break;
    case 'warrior_cult': if (cityGarrisoned(G, c)) fx.fa += 2; break;
  }
  const rel = majorityRel(G, c);
  if (rel) {
    const f = k => rel.follower === k || rel.follower2 === k;
    if (f('feed_the_world')) fx.f += (has('shrine') ? 1 : 0) + (has('temple') ? 1 : 0);
    if (f('choral_music') && has('temple')) fx.c += 2;
    if (f('guild_halls') && has('temple')) fx.p += 2;
    if (f('bazaar_of_faith') && has('market')) fx.g += 2;
    if (f('scriptoria') && has('library')) fx.s += 2;
    if (f('wayside_inns')) { fx.routeG += 1; fx.routeF += 1; }
  }
  for (const r of G.religions) if (r.holy === c.id && r.owner === c.owner && r.founder === 'holy_see') { fx.fa += 5; fx.c += 3; fx.g += 3; }
  return fx;
}
// Empire-wide extras: founder beliefs and happiness from follower beliefs in your cities.
function religionCivFx(G, pid) {
  const P = G.players[pid], out = { g: 0, s: 0, fa: 0, c: 0, h: 0, followerCities: 0, foreignCities: 0, followers: 0 };
  for (const c of G.cities) {
    const cr = cityReligion(G, c), rel = cr.major === null ? null : relById(G, cr.major);
    if (c.owner === pid && rel) {
      if (rel.follower === 'peace_gardens' || rel.follower2 === 'peace_gardens') out.h += 1;
      if ((rel.follower === 'ascetic_vows' || rel.follower2 === 'ascetic_vows') && c.buildings.includes('shrine')) out.h += 1;
    }
    if (P.religion !== null) {
      out.followers += cr.followers[P.religion] || 0;
      if (cr.major === P.religion) { out.followerCities++; if (c.owner !== pid) out.foreignCities++; }
    }
  }
  const rel = relById(G, P.religion);
  if (rel && rel.owner === pid) {
    if (rel.founder === 'tithe') out.g += Math.floor(out.followers / 4);
    if (rel.founder === 'scholar_monks') out.s += 2 * out.followerCities;
    if (rel.founder === 'pilgrim_routes') out.fa += 3 * out.foreignCities;
    if (rel.founder === 'ceremonial_rites') out.h += Math.floor(out.followerCities / 2);
    if (rel.founder === 'church_council') out.c += out.followerCities;
  }
  return out;
}

// ---- spread, once per round ----
function religionRound(G) {
  if (!G.religions.length) return;
  const g = G._grid, before = new Map(), inc = new Map();
  for (const c of G.cities) before.set(c.id, cityReligion(G, c).major);
  const add = (c, R, q) => { let m = inc.get(c.id); if (!m) inc.set(c.id, m = {}); m[R] = (m[R] || 0) + q; };
  const ownerRel = c => relById(G, G.players[c.owner].religion);
  const holyOf = new Map(); for (const rel of G.religions) holyOf.set(rel.holy, rel.id);
  // A civ with its own religion resists others (more with Defender of the Faith); holy cities resist most.
  const incoming = (dst, R, q, src) => {
    const def = ownerRel(dst);
    if (src && src.owner !== dst.owner) q *= 0.5; // faith crosses borders slowly
    if (!def && G.players[dst.owner].pantheon) q *= 0.8; // old gods hold on
    if (def && def.id !== R && def.owner === dst.owner) q *= def.enhancer === 'defender_of_faith' ? 0.25 : 0.5;
    const holy = holyOf.get(dst.id); if (holy !== undefined && holy !== R) q *= 0.25;
    add(dst, R, q);
  };
  for (const src of G.cities) {
    const R = before.get(src.id); if (R === null) continue;
    const rel = relById(G, R); if (!rel) continue;
    let p = REL.base * (src.id === rel.holy ? REL.holyMul : 1) * (rel.enhancer === 'sacred_texts' ? 1.4 : 1);
    const range = REL.range + (rel.enhancer === 'itinerant_preachers' ? 4 : 0);
    for (const dst of G.cities) { if (dst !== src && g.dist(src.tile, dst.tile) <= range) incoming(dst, R, p, src); }
    add(src, R, REL.self);
  }
  for (const r of G.routes) {
    const a = cityById(G, r.from), b = cityById(G, r.to); if (!a || !b) continue;
    for (const [x, y] of [[a, b], [b, a]]) { const R = before.get(x.id); if (R === null) continue; const rel = relById(G, R); incoming(y, R, REL.route * (rel.enhancer === 'pilgrim_fleets' ? 2 : 1)); }
  }
  for (const rel of G.religions) { const h = cityById(G, rel.holy); if (h) add(h, rel.id, 20); }
  for (const c of G.cities) {
    for (const k of Object.keys(c.rel)) { c.rel[k] *= REL.decay; if (c.rel[k] < 1) delete c.rel[k]; }
    const m = inc.get(c.id); if (m) for (const k in m) c.rel[k] = (c.rel[k] || 0) + m[k];
    const now = cityReligion(G, c).major, was = before.get(c.id);
    if (now !== was && now !== null) {
      const rel = relById(G, now), P = G.players[c.owner];
      if (P.human) logEvent(G, c.owner, `${c.name} now follows the ${rel.name}.`, c.tile);
      const F = G.players[rel.owner];
      if (F.human && rel.owner !== c.owner && F.explored[c.tile]) logEvent(G, rel.owner, `${c.name} has converted to your ${rel.name}.`, c.tile);
    }
  }
}
function religionStats(G) {
  return G.religions.map(rel => {
    let cities = 0, followers = 0; const byCiv = {};
    for (const c of G.cities) { const cr = cityReligion(G, c); followers += cr.followers[rel.id] || 0; if (cr.major === rel.id) { cities++; byCiv[c.owner] = (byCiv[c.owner] || 0) + 1; } }
    return { rel, cities, followers, byCiv };
  });
}

Object.assign(HX, {
  pantheonCost, prophetCost, faithUnitCost, faithBuildingCost, pantheonStatus, pantheonTaken, pickPantheon,
  foundStatus, foundReligion, enhanceStatus, enhanceReligion, freeReligionNames, freeBeliefs, maxReligions,
  spreadTargets, spreadReligion, purgeTargets, purgeHeresy, faithBuyOptions, buyWithFaith,
  cityReligion, majorityRel, religionCityFx, religionCivFx, religionStats, relById, unitReligion,
});
