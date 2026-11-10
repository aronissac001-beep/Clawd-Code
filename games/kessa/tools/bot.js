// ===== bot.js : an automated player for headless tests. Uses only the public KC actions. =====
var BOT = (() => {
  const N = KC.MAP_N, B_ = KC.BUILDINGS, MOD = KC.MODULES;
  const RESEARCH = ['swarm', 'polychem', 'microbes', 'sintering', 'schooling', 'photovolt', 'vaultdome', 'commerce', 'family', 'dronefab', 'algae', 'circuits', 'uplink',
    'nutrition', 'thermal', 'reclaim', 'meteorology', 'thinfilm', 'deepsound', 'holo', 'stacking', 'shiftpsy', 'seals', 'spa', 'canopy', 'suites', 'media', 'civics', 'charter', 'meteorology', 'thinfilm',
    'automine', 'vertical', 'medicine', 'heavycrawler', 'deepsound', 'institute', 'hiveracks', 'geneedit', 'leanfab', 'identity'];
  const lander = G => G.buildings.find(b => b.t === 'lander');
  const count = (G, t, builtOnly) => G.buildings.filter(b => b.t === t && (!builtOnly || b.built)).length;
  const sites = G => G.buildings.filter(b => !b.built).length;
  const occ = (G, x, y) => x >= 0 && y >= 0 && x < N && y < N && G._occ[y * N + x];
  function hubs(G) {
    const out = [];
    for (const b of G.buildings) if (!b.mod && B_[b.t].hub && b.built) { const c = KC.center(b); out.push({ x: c.x, y: c.y, r: B_[b.t].hub.radius + KC.M(G, 'hubRange') - 0.5 }); }
    for (const v of G.vehicles) if (v.t === 'crawler' && !v.path.length) out.push({ x: v.x + 0.5, y: v.y + 0.5, r: KC.VEHICLES.crawler.hub.radius - 0.5, crawler: true });
    return out;
  }
  const inRange = (H, x, y) => H.some(h => KC.cheb(h.x, h.y, x, y) <= h.r);
  function touches(G, x, y, s) {
    for (let i = -1; i <= s; i++) for (const [xx, yy] of [[x + i, y - 1], [x + i, y + s], [x - 1, y + i], [x + s, y + i]]) {
      if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue;
      if (i === -1 && (yy === y - 1 || yy === y + s) && (xx === x - 1 || xx === x + s)) continue;
      const k = yy * N + xx; if (G._occ[k] || G.cable[k] === 1 || G.cable[k] === 3) return true;
    }
    return false;
  }
  // the nearest valid spot that touches the base and is in drone range
  function spot(G, type, near, opt = {}) {
    const s = B_[type].size, H = hubs(G);
    let best = null, bd = 1e9;
    const R = opt.R || 22;
    for (let y = Math.max(0, Math.round(near.y - R)); y < Math.min(N, near.y + R); y++) for (let x = Math.max(0, Math.round(near.x - R)); x < Math.min(N, near.x + R); x++) {
      const cx = x + s / 2, cy = y + s / 2, d = Math.hypot(cx - near.x, cy - near.y);
      if (d >= bd) continue;
      if (!opt.anyRange && !inRange(H, cx, cy)) continue;
      if (!KC.canPlace(G, type, x, y).ok) continue;
      if (!opt.loose && !touches(G, x, y, s)) continue;
      if (opt.gap && !gapOk(G, x, y, s)) continue;
      best = { x, y }; bd = d;
    }
    return best;
  }
  // keep one free row around big buildings so later lines and extractors can get through
  function gapOk(G, x, y, s) { let blocked = 0; for (let i = 0; i < s; i++) { if (occ(G, x + i, y - 1)) blocked++; if (occ(G, x + i, y + s)) blocked++; if (occ(G, x - 1, y + i)) blocked++; if (occ(G, x + s, y + i)) blocked++; } return blocked < s * 2; }
  let cramped = false;
  function build(G, type, near, opt) {
    const p = spot(G, type, near, opt) || (opt && opt.fallback !== false ? spot(G, type, near, Object.assign({}, opt, { loose: true })) : null);
    if (!p) { cramped = true; return null; }
    const b = KC.place(G, type, p.x, p.y);
    if (b.err) return null;
    if (!touches(G, p.x, p.y, b.s)) connect(G, b);
    return b;
  }
  // run cable and pipe from a building to the nearest part of the grid
  function connect(G, b, mainNet) {
    const s = b.s, start = [], seen = new Int32Array(N * N).fill(-1), Lb = lander(G), mainW = Lb._wn;
    const mine = (x, y) => x >= b.x && y >= b.y && x < b.x + s && y < b.y + s;
    const goal = (x, y) => { for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= N || yy >= N || mine(xx, yy)) continue; const k = yy * N + xx; if (G._occ[k] && G._occ[k] !== b.id && (mainNet === undefined || (G._cableNet[k] === mainNet && G._pipeNet[k] === mainW))) return true; } const k = y * N + x; if (mainNet !== undefined) return false; return (G.cable[k] === 1 || G.cable[k] === 3) && !mine(x, y); };
    const ok = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !G._occ[y * N + x] && G._T.slope[y * N + x] <= KC.SLOPE_LINE;
    for (let i = 0; i < s; i++) for (const [x, y] of [[b.x + i, b.y - 1], [b.x + i, b.y + s], [b.x - 1, b.y + i], [b.x + s, b.y + i]]) if (ok(x, y)) { start.push([x, y]); seen[y * N + x] = -2; }
    const q = start.slice(); let end = null;
    while (q.length) { const [x, y] = q.shift(); if (goal(x, y)) { end = [x, y]; break; } for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (ok(xx, yy) && seen[yy * N + xx] === -1) { seen[yy * N + xx] = y * N + x; q.push([xx, yy]); } } }
    if (!end) return false;
    const path = []; let c = end[1] * N + end[0];
    while (c >= 0) { path.push([c % N, (c / N) | 0]); c = seen[c]; }
    KC.placeLine(G, 'cable', path); KC.placeLine(G, 'pipe', path);
    return true;
  }
  function depositSpot(G, type, buildType, from) {
    const s = B_[buildType].size, H = hubs(G);
    const deps = G.deposits.filter(d => d.type === type && d.amount > 50 && KC.depKnown(G, d) && !G.buildings.some(b => b.dep === d.id))
      .sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
    for (const d of deps) {
      for (let y = d.y - s + 1 - d.r; y <= d.y + d.r; y++) for (let x = d.x - s + 1 - d.r; x <= d.x + d.r; x++) {
        if (!KC.canPlace(G, buildType, x, y).ok) continue;
        if (!inRange(H, x + s / 2, y + s / 2)) return { x, y, needHub: true, d };
        return { x, y, d };
      }
    }
    return null;
  }
  function buildOnDeposit(G, type, buildType, B) {
    const L = lander(G), base = KC.center(L);
    const p = depositSpot(G, type, buildType, base);
    if (!p) return null;
    if (p.needHub) {
      const nh = G.buildings.filter(b => b.t === 'hub').length;
      if (sites(G) > 6 || G.buildings.some(b => b.t === 'hub' && !b.built) || (nh >= 2 + Math.floor(G.colonists.length / 20) && !(B.urgent === type) && !(type === 'rare' && !G.buildings.some(b => b.t === 'raremine'))) || G.res.metals < 15) return null;
      // a hub between the base and the deposit
      // the in-range spot closest to the deposit, so each new hub reaches further
      const sp = spot(G, 'hub', { x: p.x + 1, y: p.y + 1 }, { R: 40, loose: true }) || spot(G, 'hub', { x: p.x + 1, y: p.y + 1 }, { R: 6, loose: true, anyRange: true });
      if (sp) { const h = KC.place(G, 'hub', sp.x, sp.y); if (!h.err) { KC.setPrio(G, h.id, 2); if (!touches(G, sp.x, sp.y, 2)) connect(G, h); } }
      return null;
    }
    const b = KC.place(G, buildType, p.x, p.y);
    if (b.err) return null;
    if (buildType === 'icedrill') KC.setPrio(G, b.id, 2);
    if (!touches(G, p.x, p.y, b.s)) connect(G, b);
    return b;
  }
  // a new hub at the edge of coverage where there is open, flat ground
  function expandHub(G) {
    const H = hubs(G).filter(h => !h.crawler); const cands = [];
    for (let y = 2; y < N - 3; y += 2) for (let x = 2; x < N - 3; x += 2) {
      const dmin = Math.min(...H.map(h => KC.cheb(h.x, h.y, x + 1, y + 1)));
      if (dmin < 8 || dmin > 13) continue;
      if (!KC.canPlace(G, 'hub', x, y).ok) continue;
      let free = 0;
      for (let yy = y - 6; yy <= y + 7; yy++) for (let xx = x - 6; xx <= x + 7; xx++) { if (xx < 0 || yy < 0 || xx >= N || yy >= N) continue; const k = yy * N + xx; if (!G._occ[k] && G._T.slope[k] <= KC.SLOPE_BUILD && !inRange(H, xx, yy)) free++; }
      const L = lander(G), d = Math.hypot(x - L.x, y - L.y), sc = free - d * 1.5;
      cands.push({ x, y, sc });
    }
    cands.sort((a, b) => b.sc - a.sc);
    const cr = G.vehicles.find(v => v.t === 'crawler');
    let best = null;
    for (const c of cands.slice(0, 6)) { if (!cr || KC.findPath(G, Math.round(cr.x), Math.round(cr.y), c.x + 2, c.y)) { best = c; break; } }
    if (!best) return null;
    const h = KC.place(G, 'hub', best.x, best.y);
    if (h.err) return null;
    KC.setPrio(G, h.id, 2);
    connect(G, h);
    return h;
  }
  function genCap(G) {
    let p = 0;
    for (const b of G.buildings) {
      if (b.mod) continue; const d = B_[b.t]; if (!d.gen) continue;
      if (d.gen.kind === 'solar') p += d.gen.amt * 0.37 * (1 + KC.M(G, 'solar'));
      else if (d.gen.kind === 'wind') p += d.gen.amt * 1.4;
      else if (d.gen.kind === 'fuel') p += G.res.fuel > 10 ? d.gen.amt * 0.5 : 0;
      else p += d.gen.amt * 0.9;
    }
    return p + 3;
  }
  function powerDemand(G) {
    let p = 0;
    for (const b of G.buildings) { const d = KC.def(b); if (d.use && d.use.power) p += d.use.power * (d.jobs && !d.auto ? 0.75 : 1); }
    return p;
  }
  function waterCap(G) { let w = 0; for (const b of G.buildings) { if (b.t === 'icedrill') { const dp = G.deposits[b.dep]; if (dp && dp.amount > 30) w += 2.4; } if (b.t === 'condenser') w += 0.75; if (b.t === 'reclaimer') w += 1; } return w; }
  function waterDemand(G, extraPop) { let w = (G.colonists.length + extraPop) * 0.07; for (const b of G.buildings) { const d = KC.def(b); if (d.use && d.use.water) w += d.use.water * (d.dome ? 1 + KC.M(G, 'domeAir') : 1); } return w; }
  function airCap(G) { return count(G, 'airsynth') * 2 * (1 + KC.M(G, 'oxygen')) + count(G, 'algae') * 2.5; }
  function airDemand(G, extraPop) { let o = (G.colonists.length + extraPop) * 0.1 * (1 + KC.M(G, 'o2Use')); for (const b of G.buildings) { const d = KC.def(b); if (d.dome) o += d.use.oxygen * (1 + KC.M(G, 'domeAir')); } return o; }
  function domes(G, built) { return G.buildings.filter(b => !b.mod && B_[b.t].dome && (!built || b.built)); }
  function housing(G) { let h = 0; for (const b of G.buildings) if (b.mod && MOD[b.t].housing) h += MOD[b.t].housing; return h; }
  function foodRate(G) { let f = 0; for (const b of G.buildings) { const d = KC.def(b); if (d.prod && d.prod.out && d.prod.out.food) f += d.prod.out.food * 16 * (d.jobs ? 0.9 : 1) * (1 + KC.M(G, 'farm')); } return f; }
  function modCount(G, dome, t) { return KC.domeModules(G, dome).filter(m => m.t === t).length; }
  function addMod(G, t, pred) {
    for (const d of domes(G).sort((a, b) => KC.domeFree(G, b) - KC.domeFree(G, a))) { if (pred && !pred(d)) continue; if (KC.canAddModule(G, d.id, t).ok) return KC.addModule(G, d.id, t); }
    return null;
  }
  function workers(G) { const adults = G.colonists.filter(c => KC.canWork(c)).length; let slots = 0; for (const b of G.buildings) { const d = KC.def(b); if (d.jobs) slots += KC.staffSlots(G, d) * (b.shifts ? b.shifts.filter(Boolean).length : 2); } return { adults, slots, idle: G.colonists.filter(c => KC.canWork(c) && !c.job).length }; }

  function turn(G, B) {
    G.autoResearch = false;
    const L = lander(G), base = KC.center(L), sol = KC.solOf(G.tick);
    B.log = B.log || [];
    // reconnect buildings stranded off the main grid
    B.turns = (B.turns || 0) + 1;
    if (B.turns % 6 === 0 && G._pnets) {
      const main = L._pn;
      if (G._netDirty) KC.computeNets(G);
      for (const b of G.buildings) if (b.built && !b.mod && (b._pn !== main || b._wn !== L._wn) && b._pn >= 0 && (KC.def(b).use || KC.def(b).make)) connect(G, b, main);
    }
    // give up on sites nobody has started for a long time (unreachable or starved)
    B.age = B.age || {};
    for (const b of G.buildings.slice()) { if (b.built || b.paid) { delete B.age[b.id]; continue; } B.age[b.id] = (B.age[b.id] || 0) + 1; if (B.age[b.id] > 36) { KC.demolish(G, b.id); delete B.age[b.id]; } }
    // clear out exhausted extractors
    for (const b of G.buildings.slice()) if (b.built && KC.BUILDINGS[b.t] && KC.BUILDINGS[b.t].deposit) { const dp = G.deposits[b.dep]; if (!dp || dp.amount <= 0) KC.demolish(G, b.id); }
    // research
    if (!G.research.cur && !G.research.queue.length) {
      const bt = G.research.found.find(id => !KC.techDone(G, id));
      const next = bt || RESEARCH.find(id => !KC.techDone(G, id)) || Object.keys(KC.TECHS).find(id => KC.techAvailable(G, id));
      if (next) KC.queueResearch(G, next);
    }
    // keep sites manageable
    const busy = sites(G);
    const pop = G.colonists.length, ark = G.rockets.filter(r => r.st === 'out').reduce((s, r) => s + r.ark.length, 0);
    const want = (cond, fn) => { if (cond && sites(G) < 7 && G.buildings.filter(b => !b.built && !b.paid).length < 3) fn(); };
    // ---- phase 1: robots ----
    want(count(G, 'solar') < 2, () => build(G, 'solar', base));
    want(count(G, 'sinterer') < 1, () => buildOnDeposit(G, 'regolith', 'sinterer', B));
    want(count(G, 'battery') < 1, () => build(G, 'battery', base));
    want(count(G, 'hub') < 1 && G.prefabs.hub, () => { const ice = G.deposits.find(d => d.type === 'ice' && KC.depKnown(G, d)); const t = ice ? { x: base.x * 0.4 + ice.x * 0.6, y: base.y * 0.4 + ice.y * 0.6 } : base; build(G, 'hub', t, { R: 9 }); });
    want(count(G, 'icedrill') < 1, () => buildOnDeposit(G, 'ice', 'icedrill', B));
    want(count(G, 'airsynth') < 1, () => build(G, 'airsynth', base));
    want(count(G, 'watertank') < 1 && count(G, 'icedrill') > 0, () => build(G, 'watertank', base));
    want(count(G, 'airtank') < 1 && count(G, 'airsynth') > 0, () => build(G, 'airtank', base));
    const nd = domes(G).length;
    want(nd < 1 && count(G, 'icedrill') && count(G, 'airsynth'), () => build(G, 'dome_s', base, { gap: true }));
    // power and life support capacity with a margin for what is coming
    const extra = ark + (G.rockets.some(r => r.st === 'home') && pop < 200 ? 10 : 0);
    if (genCap(G) < powerDemand(G) * 1.3 + 2) want(true, () => { const useWind = G.res.parts > 60 && count(G, 'wind') < 4; if (KC.techDone(G, 'thinfilm') && G.res.polymers > 10) build(G, 'thinfilm', base) || build(G, 'solar', base); else build(G, useWind ? 'wind' : 'solar', base); });
    // storm-proof power for life support: wind (stronger in storms) and fuel generators
    const essential = G.buildings.reduce((sum, b) => { const d = KC.def(b); if (!d.use || !d.use.power) return sum; const life = d.cat === 'life' || d.dome || b.mod || (d.hub && !b.mod); return sum + (life ? d.use.power : 0); }, 0);
    const stormCap = G.buildings.reduce((sum, b) => { if (b.mod) return sum; const d = B_[b.t]; if (!d.gen) return sum; if (d.gen.kind === 'wind') return sum + d.gen.amt * 1.4 * 1.5; if (d.gen.kind === 'fuel') return sum + (G.res.fuel > 15 ? d.gen.amt : 0); if (d.gen.kind === 'solar') return sum + d.gen.amt * 0.37 * 0.25; return sum + d.gen.amt * 0.8; }, 3);
    if (pop > 0 && stormCap < essential * 1.15) want(true, () => { if (G.res.parts > 15 && count(G, 'wind') < 10 + pop / 6) build(G, 'wind', base, { loose: true }); else if (count(G, 'refinery', true)) build(G, 'fuelgen', base); });
    // shed industry and science during storms and cold waves so life support keeps its power
    const rough = G.hz.active.some(a => a.kind === 'dust' || a.kind === 'cold') || G.hz.upcoming.some(u => (u.kind === 'dust' || u.kind === 'cold') && u.at - G.tick < 6);
    for (const b of G.buildings) { const d = KC.def(b); if (!b.built || !d.jobs || d.cat === 'life' || (b.mod && (MOD[b.t].service || MOD[b.t].prod)) || b.t === 'greenhouse') continue; const want0 = rough ? 0 : 1; if (b.prio !== want0 && b.prio !== 2) KC.setPrio(G, b.id, want0); }
    const batCap = G.buildings.filter(b => B_[b.t] && B_[b.t].battery && b.t !== 'lander').length * 60;
    want(batCap < powerDemand(G) * 9 && count(G, 'battery') < 30, () => build(G, 'battery', base));
    B.urgent = waterCap(G) < waterDemand(G, 0) * 1.1 ? 'ice' : null;
    // life support jumps the queue and ignores the construction reserve
    const urgent = (fn) => { if (G.buildings.filter(b => !b.built && b.prio === 2).length < 3) { const b = fn(); if (b && b.id) KC.setPrio(G, b.id, 2); } };
    if ((count(G, 'icedrill') || domes(G).length) && waterCap(G) < waterDemand(G, extra) * 1.3 + 0.5) urgent(() => buildOnDeposit(G, 'ice', 'icedrill', B) || (G.res.sinter > 6 && count(G, 'condenser') < 4 + pop / 4 && build(G, 'condenser', base, { loose: true })));
    if ((count(G, 'airsynth') || domes(G).length) && airCap(G) < airDemand(G, extra) * 1.25 + 0.2) urgent(() => build(G, 'airsynth', base, { loose: true }));
    want(count(G, 'watertank') < Math.ceil(waterDemand(G, 0) / 1.5), () => build(G, 'watertank', base));
    want(count(G, 'airtank') < Math.ceil(airDemand(G, 0) / 0.8), () => build(G, 'airtank', base));
    // storage
    want(KC.storageCap(G) < 80 + 120 * Math.min(6, 1 + Math.floor(sol / 12)) && G.res.sinter > 8 && count(G, 'depot', false) - count(G, 'depot', true) === 0, () => build(G, 'depot', base));
    want(count(G, 'sinterer') < 2 + Math.floor(pop / 40) && G.res.sinter < 40, () => buildOnDeposit(G, 'regolith', 'sinterer', B));
    // ---- domes and modules: each dome follows a template ----
    const TPL = {
      dome_s: ['quarters', 'canteen', 'quarters', 'hydro', 'lounge', 'arboretum', 'clinic', 'gym'],
      dome_m: ['quarters', 'canteen', 'quarters', 'lounge', 'hydro', 'clinic', 'apartments', 'arboretum', 'gym', 'security', 'hydro', 'market', 'arcade', 'school', 'nursery', 'labmod'],
      dome_l: ['apartments', 'canteen', 'apartments', 'lounge', 'vfarm', 'clinic', 'arboretum', 'gym', 'security', 'market', 'arcade', 'spa', 'apartments', 'school', 'nursery', 'vfarm', 'medcenter', 'labmod', 'hydro'],
    };
    for (const d of domes(G, true)) {
      if (KC.domeModules(G, d).some(m => !m.built)) continue;
      const have = {}; for (const m of KC.domeModules(G, d)) have[m.t] = (have[m.t] || 0) + 1;
      const seen = {};
      for (let t of TPL[d.t]) {
        seen[t] = (seen[t] || 0) + 1;
        if ((have[t] || 0) >= seen[t]) continue;
        if (!KC.unlocked(G, t)) { if (t === 'apartments') t = 'quarters'; else if (t === 'vfarm') t = 'hydro'; else continue; }
        if (KC.canAddModule(G, d.id, t).ok && KC.canAffordReserve(G, KC.costOf(G, t, true), 1)) { KC.addModule(G, d.id, t); break; }
        break;
      }
    }
    const homes = housing(G);
    const pendingDome = domes(G).some(d => !d.built);
    if (homes < pop + extra + 6 && !pendingDome && sites(G) < 6 && G.res.metals > 25) {
      const big = KC.unlocked(G, 'dome_l') && G.res.polymers > 22 && G.res.sinter > 70 && G.res.electronics > 5 ? 'dome_l' : KC.unlocked(G, 'dome_m') && G.res.polymers > 10 && G.res.sinter > 35 ? 'dome_m' : 'dome_s';
      const fullish = domes(G, true).every(d => KC.domeFree(G, d) <= 1);
      if (fullish || !domes(G).length) { const order = G.prefabs.dome_s ? ['dome_s'] : [...new Set([big, 'dome_m', 'dome_s'])].filter(t => KC.unlocked(G, t)); for (const t of order) if (build(G, t, base, { gap: true, R: 30 }) || build(G, t, base, { R: 30, loose: true })) break; }
    }
    // food: hydroponics in domes, greenhouses outside
    const eat = (pop + extra) * 1.3 + 4;
    if (foodRate(G) < eat && (pop > 0 || ark)) {
      want(G.res.polymers > 4 && G.buildings.filter(b => b.t === 'greenhouse' && !b.built).length === 0, () => build(G, 'greenhouse', base, { gap: true }));
    }
    // ---- industry and science, once there are people ----
    const W = workers(G);
    const jobsShort = W.idle > 2 || W.slots < W.adults + 10;
    if (pop >= 6) {
      want(count(G, 'works') < 1 + Math.floor(pop / 30) && (jobsShort || G.res.parts < 25), () => build(G, 'works', base, { gap: true }));
      want(count(G, 'oremine') < 1 + Math.floor(pop / 25) && (jobsShort || G.res.metals < 60), () => buildOnDeposit(G, 'metal', 'oremine', B));
      want(count(G, 'lab') < Math.floor(pop / 12) && (jobsShort || G.res.parts > 20), () => build(G, 'lab', base, { gap: true }));
      want(pop >= 8 && (count(G, 'refinery') < 1 || (count(G, 'refinery') < 1 + Math.floor(pop / 70) && (jobsShort || G.res.fuel < 10))), () => build(G, 'refinery', base));
      want(pop >= 8 && count(G, 'raremine') < 1 + Math.floor(pop / 25) && (jobsShort || G.funds < 1500 || count(G, 'raremine') < 1), () => buildOnDeposit(G, 'rare', 'raremine', B));
      want(pop >= 20 && KC.unlocked(G, 'polymer') && count(G, 'polymer') < 1 + Math.floor(pop / 70) && (jobsShort || G.res.polymers < 15), () => build(G, 'polymer', base, { gap: true }));
      want(pop >= 30 && KC.unlocked(G, 'foundry') && count(G, 'foundry') < 1 + Math.floor(pop / 80) && (jobsShort || G.res.electronics < 10), () => build(G, 'foundry', base, { gap: true }));
      if (jobsShort && W.idle > 4) addMod(G, 'labmod') || addMod(G, 'workshop');
      want(pop >= 25 && count(G, 'mast') < 1, () => build(G, 'mast', base));
      want(KC.unlocked(G, 'assembler') && count(G, 'assembler') < 1 && pop >= 30, () => build(G, 'assembler', base));
      want(KC.unlocked(G, 'heater') && count(G, 'heater') < Math.floor(pop / 40), () => build(G, 'heater', base, { loose: true }));
      want(KC.unlocked(G, 'reclaimer') && count(G, 'reclaimer') < 1 + Math.floor(pop / 35) && G.res.polymers > 6, () => build(G, 'reclaimer', base));
      if (KC.unlocked(G, 'spire') && count(G, 'spire') < 1 && pop >= 60) { if (KC.storageCap(G) < 140) build(G, 'depot', base); const sp = build(G, 'spire', base, { gap: true, R: 30 }) || build(G, 'spire', base, { loose: true, R: 30 }) || build(G, 'spire', base, { loose: true, R: 30, anyRange: true }); if (sp && sp.id) KC.setPrio(G, sp.id, 2); }
      if (G.buildings.some(b => b.t === 'spire' && !b.paid)) { if (G.res.electronics < 32) B.short.electronics = 1; }
    }
    for (const mega of ['array', 'mirror']) if (KC.unlocked(G, mega) && !G.buildings.some(b => b.t === mega) && pop >= 50 && G.funds > KC.BUILDINGS[mega].cost.funds + savingFor(G) + 500) { const m = build(G, mega, base, { gap: true, R: 30 }) || build(G, mega, base, { loose: true, R: 30, anyRange: true }); if (m && m.id) KC.setPrio(G, m.id, 2); }
    // the Warden mystery: research Harmonics when it is offered
    if (G.research.found.includes('myst_harmonics') && !KC.techDone(G, 'myst_harmonics') && !G.research.queue.includes('myst_harmonics') && G.research.cur !== 'myst_harmonics' && KC.techCount(G) > 12) KC.queueResearch(G, 'myst_harmonics');
    // too many idle hands: turn on third shifts
    if (W.idle > 6) for (const b of G.buildings) if (b.shifts && !b.shifts[2] && b.built) { KC.setShift(G, b.id, 2, true); break; }
    // food emergencies: farms get first pick of workers
    const hungry = G.res.food < (pop + 5) * 3;
    for (const b of G.buildings) if (b.built && (b.t === 'hydro' || b.t === 'greenhouse' || b.t === 'vfarm') && b.prio !== (hungry ? 2 : 1)) KC.setPrio(G, b.id, hungry ? 2 : 1);
    // ---- shortages: build producers before stocks run dry ----
    const net = k => (G.rate[k] || []).reduce((a, b) => a + b, 0);
    const low = (k, lvl) => G.res[k] < lvl && net(k) < 2;
    B.short = {};
    if (low('sinter', 70)) { B.short.sinter = 1; want(true, () => buildOnDeposit(G, 'regolith', 'sinterer', B)); }
    if (low('metals', 70) && pop >= 4) { B.short.metals = 1; want(true, () => buildOnDeposit(G, 'metal', 'oremine', B)); }
    if (low('parts', 35) && pop >= 6) { B.short.parts = 1; want(count(G, 'works') - count(G, 'works', true) === 0 && G.buildings.filter(b => b.t === 'works' && b.built && b.jobs && !b.jobs.some(j => j.length)).length === 0, () => build(G, 'works', base, { gap: true })); addMod(G, 'workshop', d => KC.domeFree(G, d) >= 2); }
    if (low('polymers', 25) && KC.unlocked(G, 'polymer') && pop >= 15) { B.short.polymers = 1; want(count(G, 'polymer') - count(G, 'polymer', true) === 0, () => build(G, 'polymer', base, { gap: true })); }
    if (low('electronics', 10) && KC.unlocked(G, 'foundry') && pop >= 25) { B.short.electronics = 1; want(count(G, 'foundry') - count(G, 'foundry', true) === 0, () => build(G, 'foundry', base, { gap: true })); }
    if (G.res.rare < 5 && count(G, 'foundry') && count(G, 'raremine') < 2) want(true, () => buildOnDeposit(G, 'rare', 'raremine', B));
    // share drones: starved hubs borrow from the richest
    const hb = G.buildings.filter(b => b.built && !b.mod && B_[b.t].hub);
    for (const h of hb) if (h.drones < 3) { const rich = hb.slice().sort((a, b) => b.drones - a.drones)[0]; if (rich && rich.drones > 4) KC.moveDrones(G, rich.id, h.id, Math.min(3 - h.drones, rich.drones - 4)); }
    if (cramped && !G.buildings.some(b => b.t === 'hub' && !b.built) && G.res.metals > 20) expandHub(G);
    cramped = false;
    // ---- vehicles: pathfinder explores, crawler parks at remote sites ----
    for (const v of G.vehicles) {
      if (v.path.length || v.task) continue;
      if (v.t === 'pathfinder') {
        const a = G.anomalies.filter(a => !a.done && KC.scannedAt(G, a.x, a.y)).sort((p, q) => Math.hypot(p.x - v.x, p.y - v.y) - Math.hypot(q.x - v.x, q.y - v.y))[0];
        if (a) { KC.sendToAnomaly(G, v.id, a.id); continue; }
        const s = KC.sectorOf(Math.round(v.x), Math.round(v.y)), si = KC.sectorIndex(s.sx, s.sy);
        if (si >= 0 && !G.sectors[si].st) continue;
        // drive to the nearest unsurveyed sector
        let best = -1, bd = 1e9; const k = N / KC.SECTOR;
        for (let i = 0; i < G.sectors.length; i++) if (!G.sectors[i].st) { const cx = (i % k) * KC.SECTOR + 4, cy = ((i / k) | 0) * KC.SECTOR + 4, dd = Math.hypot(cx - v.x, cy - v.y); if (dd < bd) { bd = dd; best = i; } }
        if (best >= 0) KC.moveVehicle(G, v.id, (best % k) * KC.SECTOR + 4, ((best / k) | 0) * KC.SECTOR + 4);
      } else if (v.t === 'crawler') {
        const H = hubs(G).filter(h => !h.crawler);
        const far = G.buildings.filter(b => !b.built && !b.mod && !inRange(H, b.x + b.s / 2, b.y + b.s / 2)).sort((a, b) => (b.t === 'hub') - (a.t === 'hub'))[0];
        if (far && KC.cheb(v.x, v.y, far.x + far.s / 2, far.y + far.s / 2) > 3) {
          const c = { x: far.x + far.s / 2, y: far.y + far.s / 2 }, r = Math.ceil(far.s / 2) + 1;
          for (const [dx, dy] of [[r, 0], [0, r], [-r, 0], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r], [r + 2, 0], [0, r + 2]]) { const res = KC.moveVehicle(G, v.id, Math.round(c.x + dx), Math.round(c.y + dy)); if (res.ok && res.len < 60) break; }
        }
      }
    }
    if (!G.survey.length) { const k = N / KC.SECTOR; let best = -1, bd = 1e9; for (let i = 0; i < G.sectors.length; i++) if (!G.sectors[i].st) { const cx = (i % k) * KC.SECTOR + 4, cy = ((i / k) | 0) * KC.SECTOR + 4, dd = Math.hypot(cx - base.x, cy - base.y); if (dd < bd) { bd = dd; best = i; } } if (best >= 0) KC.queueSurvey(G, best); }
    if (G.probes > 0 && sol > 3) { const k = N / KC.SECTOR; for (let i = 0; i < G.sectors.length; i++) if (!G.sectors[i].st) { const cx = (i % k) * KC.SECTOR + 4, cy = ((i / k) | 0) * KC.SECTOR + 4; if (Math.hypot(cx - base.x, cy - base.y) < 22) { KC.useProbe(G, i); break; } } }
    // ---- rockets ----
    const free = G.rockets.find(r => r.st === 'home');
    if (free) {
      const cargo = {}; let w = 0; const cap = KC.rocketCap(G);
      const add = (k, n) => { for (let i = 0; i < n; i++) { if (w + KC.CARGO[k].w > cap) return; cargo[k] = (cargo[k] || 0) + 1; w += KC.CARGO[k].w; } };
      const need = (k, lvl) => G.res[k] < lvl;
      const homesFree = housing(G) - pop - ark;
      const Wk = workers(G); B.why = { ready: KC.arkReady(G), homes: homesFree >= 6, funds: G.funds > KC.arkPrice(G) + 150, food: foodRate(G) + G.res.food / 4 > pop + 8, jobs: (pop < 10 || Wk.slots > Wk.adults + 4), parts: G.res.parts > 6, short: !Object.keys(B.short || {}).length, health: G.colonists.every(c => c.health > 60) };
      const lsOk = airCap(G) >= airDemand(G, ark + KC.arkSize(G)) * 1.1 && waterCap(G) >= waterDemand(G, ark + KC.arkSize(G)) * 1.05;
      B.why.ls = lsOk;
      const wantArk = lsOk && KC.arkReady(G) && homesFree >= 6 && G.funds > KC.arkPrice(G) + 150 + savingFor(G) * 0.5 && foodRate(G) + G.res.food / 4 > pop + 8 && (pop < 10 || Wk.slots > Wk.adults + 4) && G.colonists.every(c => c.health > 60) && !(G.sol.short.food || G.sol.short.oxygen || G.sol.short.water);
      const rich = G.funds > 1400 + savingFor(G) + (wantArk ? KC.arkPrice(G) : 0);
      const proving = G.buildings.some(b => b.t === 'spire' && b.built) && pop >= KC.DIFFICULTY[G.cfg.difficulty].pop;
      if (proving) { /* independence: only non-essential cargo from now on */ }
      else if (G.funds > 2500 && need('metals', 200)) add('metals', 4);
      if (rich && !proving) { if (need('metals', 150)) add('metals', 3); if (need('sinter', 150)) add('sinter', 2); if (need('polymers', 40)) add('polymers', 2); if (need('electronics', 20)) add('electronics', 2); }
      const spireSite = G.buildings.find(b => b.t === 'spire' && !b.paid);
      if (spireSite) { const c = KC.costOf(G, 'spire'); for (const k of ['electronics', 'polymers', 'parts', 'metals', 'sinter']) if (G.res[k] < c[k] + (G.reserve[k] || 0) + 5) add(k, 3); }
      if (!proving && need('parts', 30)) add('parts', 4);
      if (need('polymers', 20)) add('polymers', 2);
      if (need('electronics', 8)) add('electronics', 1);
      if (!proving && need('metals', 50)) add('metals', 3);
      if (need('sinter', 60)) add('sinter', 3);
      if (!proving && need('food', (pop + 10) * 3) && (pop > 0 || wantArk || domes(G, true).length)) add('food', 2);
      if (pop >= 4 && need('fuel', 10) && count(G, 'refinery', true) === 0) add('fuel', 1);
      const drones = G.buildings.filter(b => b.built && !b.mod && B_[b.t].hub).reduce((s, b) => s + b.drones, 0);
      const hubN = G.buildings.filter(b => b.built && !b.mod && B_[b.t].hub).length;
      if (drones < hubN * 6) add('drone', Math.min(6, hubN * 6 - drones));
      const ids = wantArk ? G.applicants.slice().sort((a, b) => scoreApp(G, b) - scoreApp(G, a)).slice(0, Math.min(KC.arkSize(G), homesFree)).map(a => a.aid) : [];
      const s = KC.orderSummary(G, cargo, ids);
      const critical = G.res.parts < 12 || G.res.metals < 20 || G.res.food < pop * 2;
      // while the colony is small, routine imports wait: people (arks) come first
      const growing = pop < KC.DIFFICULTY[G.cfg.difficulty].pop && !critical && G.funds < KC.arkPrice(G) * 1.6 && KC.arkReady(G);
      if (growing && !ids.length) for (const k in cargo) if (k !== 'drone' || drones > 2) cargo[k] = 0;
      const reserve = critical ? 0 : (wantArk ? 0 : KC.arkPrice(G) * (pop > 0 ? 0.6 : 1.2)) + (proving ? KC.buyoutCost(G) : 0);
      if (critical && s.price > G.funds && !ids.length) { for (const k of ['electronics', 'polymers', 'sinter', 'drone', 'fuel', 'food', 'metals', 'parts']) while (cargo[k] && KC.orderSummary(G, cargo, []).price > G.funds) cargo[k]--; }
      const s2 = KC.orderSummary(G, cargo, ids);
      if (s2.price !== s.price) Object.assign(s, s2);
      if ((Object.values(cargo).some(v => v > 0) || ids.length) && s.price <= G.funds - (ids.length ? 0 : reserve)) {
        const r = KC.orderRocket(G, cargo, ids);
        if (r.err) B.log.push(sol + ': rocket ' + r.err);
      } else if (ids.length && KC.orderSummary(G, {}, ids).price <= G.funds) KC.orderRocket(G, {}, ids);
    }
  }
  function scoreApp(G, a) {
    let s = 0; for (const t of a.traits) s += KC.TRAITS[t].good ? 2 : -3;
    const want = { engineer: 3, scientist: 2.5, botanist: 3, geologist: 2, medic: 1, security: 1, none: 1.5 };
    const have = {}; for (const c of G.colonists) have[c.spec] = (have[c.spec] || 0) + 1;
    s += want[a.spec] / (1 + (have[a.spec] || 0) / 6);
    if (a.age > 50) s -= 1.5;
    return s;
  }
  // events: take the first affordable option unless it would starve a reserve, else the do-nothing option
  function event(G, B) {
    const ch = KC.eventChoices(G); if (!ch.length) return;
    const saving = savingFor(G);
    let pick = ch.length - 1;
    for (const c of ch) { if (!c.ok) continue; const m = /\((\d+)/.exec(c.label); const cost = m && /funding|\d\)$/.test(c.label) && !/parts|polymers|food/.test(c.label) ? +m[1] : 0; if (G.funds - cost >= saving) { pick = c.i; break; } }
    if (/Sell the data/.test(ch[0].label)) pick = G.funds < 300 ? 0 : 1;
    KC.resolveEvent(G, pick);
  }
  // money the bot keeps back: the buyout once Independence is in sight
  function savingFor(G) { return G.buildings.some(b => b.t === 'spire' && b.built) && G.colonists.length >= KC.DIFFICULTY[G.cfg.difficulty].pop * 0.9 ? KC.buyoutCost(G) : 0; }
  function economy(G, B) {
    const C = G.contracts, pop = G.colonists.length;
    if (C.offer && !C.active) {
      const o = C.offer, okKinds = { tech: true, births: pop >= 30, pop: G.rockets.length >= 1 && G.funds > KC.arkPrice(G) * 2, rare: G.buildings.some(b => b.t === 'raremine' && b.built), kessite: G.buildings.some(b => b.t === 'harvester' && b.built), self: pop >= 30 };
      if (okKinds[o.kind]) KC.acceptContract(G); else KC.declineContract(G);
    }
    const saving = savingFor(G);
    if (G.funds > saving + KC.grantPrice(G) + 2500 && G.research.cur && pop >= 40) KC.buyGrant(G);
  }
  return { turn: (G, B) => { turn(G, B); economy(G, B); if (G.event) event(G, B); }, event, savingFor };
})();
