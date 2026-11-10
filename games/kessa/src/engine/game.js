// ===== game.js : game state, modifiers, grids, placement and player actions =====
function def(b) { return b.mod ? MODULES[b.t] : BUILDINGS[b.t]; }
function rng(G) { if (!G._rng) G._rng = new RNG(G.rng); return G._rng; }
function syncRng(G) { if (G._rng) G.rng = G._rng.state(); }
function log(G, m, k = 'info', at) { const e = { t: G.tick, m, k }; if (at) { e.x = at.x; e.y = at.y; } G.log.push(e); if (G.log.length > 250) G.log.splice(0, G.log.length - 250); (G._fx = G._fx || []).push({ k: 'log', e }); }
function fx(G, e) { (G._fx = G._fx || []).push(e); }

function newGame(cfg) {
  cfg = Object.assign({ seed: 'basalt-basin-101', sponsor: 'orrin', commander: 'engineer', difficulty: 'normal', tutorial: true }, cfg || {});
  const T = genTerrain(cfg.seed), F = genFeatures(cfg.seed, T);
  const SP = SPONSORS[cfg.sponsor], CM = COMMANDERS[cfg.commander], DF = DIFFICULTY[cfg.difficulty];
  const G = {
    format: SAVE_FORMAT, version: KC_VERSION, seed: cfg.seed, cfg, tick: 7, rng: RNG.fromSeed(cfg.seed + '/game').state(), nextId: 1,
    deposits: F.deps, anomalies: F.anomalies, land: F.land,
    sectors: [], survey: [], cable: new Uint8Array(MAP_N * MAP_N), pipe: new Uint8Array(MAP_N * MAP_N),
    buildings: [], colonists: [], vehicles: [], rockets: [], applicants: [],
    res: {}, funds: Math.round(SP.funds * DF.funds), prefabs: {}, probes: 2,
    research: { cur: null, queue: [], done: {}, prog: {}, found: [] },
    hz: { next: {}, upcoming: [], active: [], n: 0 }, log: [], ms: {}, hist: [], rate: {},
    st: { births: 0, deaths: 0, arrived: 0, left: 0, exportFunds: 0, anomalies: 0, peakPop: 0, everColonists: false, sat: [] },
    exportOn: true, reserve: { metals: 12, parts: 8, polymers: 4, sinter: 6, electronics: 0 }, over: null, flags: {}, sol: { prod: {}, use: {}, short: {} },
  };
  for (const k of MATS) G.res[k] = 0;
  const s = DF.start;
  Object.assign(G.res, { metals: Math.round(50 * s) + (SP.start.metals || 0), sinter: Math.round(30 * s), parts: Math.round(22 * s), polymers: Math.round(14 * s), electronics: Math.round(6 * s), fuel: 20, food: 0 });
  G.prefabs = { hub: 1, airsynth: 1, icedrill: 1 };
  for (let i = 0; i < (MAP_N / SECTOR) ** 2; i++) G.sectors.push({ st: 0, p: 0 });
  hydrate(G);
  // lander and starting vehicles
  const L = addBuilding(G, 'lander', F.land.x, F.land.y, true);
  L.drones = BUILDINGS.lander.hub.drones + ((CM.start && CM.start.drones) || 0);
  L.charge = 10;
  addVehicle(G, 'crawler', F.land.x + 4, F.land.y + 1);
  addVehicle(G, 'pathfinder', F.land.x - 1, F.land.y + 4);
  for (let i = 0; i < SP.rockets; i++) G.rockets.push({ id: i + 1, st: 'home', t: 0, cargo: null, ark: [], leavers: [], exp: null });
  // the sectors around the landing site are pre-surveyed
  const ls = sectorOf(F.land.x + 1, F.land.y + 1);
  for (let sy = -1; sy <= 1; sy++) for (let sx = -1; sx <= 1; sx++) { const i = sectorIndex(ls.sx + sx, ls.sy + sy); if (i >= 0) G.sectors[i].st = 1; }
  // and the sectors holding the guaranteed starter deposits (the first three rolled)
  for (const d of F.deps.slice(0, 3)) { const s = sectorOf(d.x, d.y); G.sectors[sectorIndex(s.sx, s.sy)].st = 1; }
  // starting techs
  const start = [].concat(CM.techs || []);
  if (SP.start.techs) { const r = RNG.fromSeed(cfg.seed + '/st'); const pool = Object.values(TECHS).filter(t => t.tier === 1 && !start.includes(t.id)); for (let i = 0; i < SP.start.techs; i++) start.push(r.pick(pool.filter(t => !start.includes(t.id))).id); }
  for (const id of start) G.research.done[id] = 0;
  hydrate(G);
  refreshApplicants(G, 24);
  scheduleHazards(G, true);
  log(G, 'Touchdown. The lander settles onto the dust of Kessa.', 'good');
  G.ms.landing = 1;
  syncRng(G);
  return G;
}

// rebuild everything derived (grids, caches) after creation or load
function hydrate(G) {
  G._T = genTerrain(G.seed);
  G._dep = depositGrid(G);
  G._byId = new Map(); for (const b of G.buildings) G._byId.set(b.id, b);
  G._cById = new Map(); for (const c of G.colonists) G._cById.set(c.id, c);
  rebuildOcc(G); computeMods(G); G._netDirty = true; G._jobsDirty = true; G._fx = [];
  G._rng = null;
}
function rebuildOcc(G) {
  const occ = new Int32Array(MAP_N * MAP_N);
  for (const b of G.buildings) if (!b.mod) for (let y = b.y; y < b.y + b.s; y++) for (let x = b.x; x < b.x + b.s; x++) occ[y * MAP_N + x] = b.id;
  G._occ = occ;
}
function computeMods(G) {
  const m = {};
  const add = o => { for (const k in o) m[k] = (m[k] || 0) + o[k]; };
  add(SPONSORS[G.cfg.sponsor].mods); add(COMMANDERS[G.cfg.commander].mods);
  for (const id in G.research.done) add(TECHS[id].mods);
  G._mods = m;
}
const M = (G, k) => G._mods[k] || 0;
const bById = (G, id) => G._byId.get(id);
const cById = (G, id) => G._cById.get(id);

function sectorOf(x, y) { return { sx: Math.floor(x / SECTOR), sy: Math.floor(y / SECTOR) }; }
function sectorIndex(sx, sy) { const k = MAP_N / SECTOR; return sx < 0 || sy < 0 || sx >= k || sy >= k ? -1 : sy * k + sx; }
function scannedAt(G, x, y) { const s = sectorOf(x, y); return G.sectors[sectorIndex(s.sx, s.sy)].st === 1; }
function depKnown(G, d) { return scannedAt(G, d.x, d.y) && (!d.deep || M(G, 'deep') > 0); }
function depAt(G, x, y) { if (x < 0 || y < 0 || x >= MAP_N || y >= MAP_N) return null; const i = G._dep[y * MAP_N + x]; return i >= 0 ? G.deposits[i] : null; }
function techDone(G, id) { return id in G.research.done; }
function unlocked(G, type) { const d = BUILDINGS[type] || MODULES[type]; return !d.tech || techDone(G, d.tech); }
function storageCap(G) { let c = 0; for (const b of G.buildings) if (b.built && def(b).storage) c += def(b).storage; return c + (M(G, 'storage') || 0); }
function center(b) { return { x: b.x + b.s / 2, y: b.y + b.s / 2 }; }

function costOf(G, type, isMod) {
  const d = isMod ? MODULES[type] : BUILDINGS[type];
  let mult = 1 + M(G, 'buildCost'); if (d.dome) mult += M(G, 'domeCost');
  const c = {}; for (const k in d.cost) c[k] = Math.max(d.cost[k] > 0 ? 0.25 : 0, Math.round(d.cost[k] * Math.max(0.4, mult) * 4) / 4);
  return c;
}
function canAfford(G, cost) { for (const k in cost) if ((G.res[k] || 0) < cost[k] - 1e-9) return false; return true; }
function pay(G, cost) { for (const k in cost) { G.res[k] -= cost[k]; noteUse(G, k, cost[k]); } }
function refund(G, cost, f) { for (const k in cost) G.res[k] += cost[k] * f; }

function addBuilding(G, type, x, y, built) {
  const d = BUILDINGS[type];
  const b = { id: G.nextId++, t: type, x, y, s: d.size, built: !!built, prog: built ? d.work : 0, paid: !!built, on: true, prio: d.cat === 'life' || d.dome ? 2 : 1, wear: 0, broken: false };
  if (d.jobs) { b.shifts = [true, true, false]; b.jobs = [[], [], []]; }
  if (d.battery) b.charge = 0;
  if (d.tank) { b.water = 0; b.oxygen = 0; }
  if (d.hub) b.drones = 0;
  if (d.deposit) { for (let yy = y; yy < y + d.size; yy++) for (let xx = x; xx < x + d.size; xx++) { const dp = depAt(G, xx, yy); if (dp && d.deposit.split('|').includes(dp.type)) { b.dep = dp.id; break; } } }
  G.buildings.push(b); if (G._byId) G._byId.set(b.id, b);
  if (G._occ) for (let yy = y; yy < y + b.s; yy++) for (let xx = x; xx < x + b.s; xx++) G._occ[yy * MAP_N + xx] = b.id;
  if (built) absorbLines(G, b);
  G._netDirty = true; G._jobsDirty = true;
  return b;
}

// lines under a finished building are absorbed into it (it conducts anyway)
function absorbLines(G, b) { if (b.mod) return; for (let yy = b.y; yy < b.y + b.s; yy++) for (let xx = b.x; xx < b.x + b.s; xx++) { G.cable[yy * MAP_N + xx] = 0; G.pipe[yy * MAP_N + xx] = 0; } }
function canPlace(G, type, x, y) {
  const d = BUILDINGS[type];
  if (!d || d.unbuildable || d.line) return { ok: false, why: 'Cannot be built' };
  if (!unlocked(G, type)) return { ok: false, why: 'Needs research: ' + TECHS[d.tech].name };
  if (d.unique && G.buildings.some(b => b.t === type)) return { ok: false, why: 'Only one allowed' };
  const s = d.size, T = G._T;
  if (x < 0 || y < 0 || x + s > MAP_N || y + s > MAP_N) return { ok: false, why: 'Off the map' };
  let depOk = !d.deposit;
  for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) {
    const i = yy * MAP_N + xx;
    if (G._occ[i]) return { ok: false, why: 'Space is taken' };
    if (T.slope[i] > SLOPE_BUILD) return { ok: false, why: 'Ground too steep' };
    if (G.anomalies.some(a => !a.done && a.x === xx && a.y === yy)) return { ok: false, why: 'An anomaly is in the way' };
    const dp = depAt(G, xx, yy);
    if (dp) {
      const known = depKnown(G, dp);
      if (d.deposit && known && d.deposit.split('|').includes(dp.type) && dp.amount > 0) depOk = true;
      else if (DEPOSITS[dp.type].surface && dp.amount > 0) return { ok: false, why: 'Surface deposit in the way (drones will mine it)' };
      else if (known && !d.deposit) return { ok: false, why: 'Keep deposits clear for extractors' };
    }
  }
  if (!depOk) return { ok: false, why: 'Must cover a surveyed ' + d.deposit.split('|').map(t => DEPOSITS[t].name.toLowerCase()).join(' or ') + ' deposit' };
  return { ok: true };
}
function place(G, type, x, y) {
  const c = canPlace(G, type, x, y); if (!c.ok) return { err: c.why };
  const b = addBuilding(G, type, x, y, false);
  if (G.prefabs[type] > 0) { G.prefabs[type]--; b.prefab = true; b.paid = true; }
  return b;
}

function domeSlots(G, dome) { return BUILDINGS[dome.t].dome.slots + M(G, 'domeSlots'); }
function domeModules(G, dome) { return G.buildings.filter(b => b.mod && b.dome === dome.id); }
function domeFree(G, dome) { let u = 0; for (const m of domeModules(G, dome)) u += MODULES[m.t].slots; return domeSlots(G, dome) - u; }
function canAddModule(G, domeId, t) {
  const dome = bById(G, domeId), d = MODULES[t];
  if (!dome || !BUILDINGS[dome.t].dome) return { ok: false, why: 'Not a dome' };
  if (!unlocked(G, t)) return { ok: false, why: 'Needs research: ' + TECHS[d.tech].name };
  if (domeFree(G, dome) < d.slots) return { ok: false, why: 'Not enough free slots' };
  return { ok: true };
}
function addModule(G, domeId, t) {
  const c = canAddModule(G, domeId, t); if (!c.ok) return { err: c.why };
  const d = MODULES[t];
  const b = { id: G.nextId++, t, mod: true, dome: domeId, x: 0, y: 0, s: 0, built: false, prog: 0, paid: false, on: true, prio: 1, wear: 0, broken: false };
  if (d.jobs) { b.shifts = [true, true, false]; b.jobs = [[], [], []]; }
  G.buildings.push(b); G._byId.set(b.id, b); G._jobsDirty = true;
  return b;
}

function linePath(x0, y0, x1, y1) {
  const out = [], sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  let x = x0, y = y0; out.push([x, y]);
  while (x !== x1) { x += sx; out.push([x, y]); }
  while (y !== y1) { y += sy; out.push([x, y]); }
  return out;
}
function lineTileOk(G, kind, x, y) {
  if (x < 0 || y < 0 || x >= MAP_N || y >= MAP_N) return false;
  const i = y * MAP_N + x; if (G._occ[i]) return 'skip';
  if (G._T.slope[i] > SLOPE_LINE) return false;
  return G[kind][i] ? 'skip' : true;
}
function checkLine(G, kind, tiles) {
  let n = 0;
  for (const [x, y] of tiles) { const r = lineTileOk(G, kind, x, y); if (r === false) return { ok: false, why: 'Ground too steep for a line', n }; if (r === true) n++; }
  if (!n) return { ok: false, why: 'Nothing new to build', n };
  return { ok: true, n, cost: { metals: Math.round(n * BUILDINGS[kind].cost.metals * 100) / 100 } };
}
function placeLine(G, kind, tiles) {
  const c = checkLine(G, kind, tiles); if (!c.ok) return { err: c.why };
  for (const [x, y] of tiles) if (lineTileOk(G, kind, x, y) === true) G[kind][y * MAP_N + x] = 3;
  return { n: c.n };
}
function removeLine(G, kind, x, y) { const i = y * MAP_N + x; if (!G[kind][i]) return false; G[kind][i] = 0; G._netDirty = true; return true; }

function demolish(G, id) {
  const b = bById(G, id); if (!b || b.t === 'lander') return false;
  const d = def(b);
  if (d.dome) for (const m of domeModules(G, b)) demolish(G, m.id);
  if (b.paid && !b.prefab) refund(G, costOf(G, b.t, b.mod), b.built ? 0.5 : 1);
  if (b.prefab && !b.built) G.prefabs[b.t] = (G.prefabs[b.t] || 0) + 1;
  if (b.jobs) for (const sh of b.jobs) for (const cid of sh) { const c = cById(G, cid); if (c) c.job = null; }
  if (d.dome) for (const c of G.colonists) if (c.home === b.id) c.home = null;
  if (d.hub && b.drones) { const L = G.buildings.find(x => x.t === 'lander'); L.drones += b.drones; }
  G.buildings.splice(G.buildings.indexOf(b), 1); G._byId.delete(id);
  if (!b.mod) for (let yy = b.y; yy < b.y + b.s; yy++) for (let xx = b.x; xx < b.x + b.s; xx++) G._occ[yy * MAP_N + xx] = 0;
  G._netDirty = true; G._jobsDirty = true;
  if (d.dome) rehome(G);
  return true;
}
function setOn(G, id, on) { const b = bById(G, id); if (!b) return; b.on = !!on; G._jobsDirty = true; }
function setPrio(G, id, p) { const b = bById(G, id); if (!b) return; b.prio = clamp(p | 0, 0, 2); G._jobsDirty = true; }
function setShift(G, id, s, on) { const b = bById(G, id); if (!b || !b.shifts) return; b.shifts[s] = !!on; G._jobsDirty = true; }

// ---- networks: power over cables, life support over pipes; built buildings conduct both ----
function computeNets(G) {
  const n = MAP_N, N = n * n;
  for (const kind of ['cable', 'pipe']) {
    const net = new Int32Array(N).fill(-1), L = G[kind], occ = G._occ;
    const cond = i => { if (L[i] === 1 || (kind === 'pipe' && L[i] === 2)) return true; const id = occ[i]; if (!id) return false; const b = bById(G, id); return b && b.built; };
    let id = 0; const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (net[s] >= 0 || !cond(s)) continue;
      let qh = 0, qt = 0; q[qt++] = s; net[s] = id;
      while (qh < qt) {
        const i = q[qh++], x = i % n, y = (i / n) | 0;
        if (x > 0 && net[i - 1] < 0 && cond(i - 1)) { net[i - 1] = id; q[qt++] = i - 1; }
        if (x < n - 1 && net[i + 1] < 0 && cond(i + 1)) { net[i + 1] = id; q[qt++] = i + 1; }
        if (y > 0 && net[i - n] < 0 && cond(i - n)) { net[i - n] = id; q[qt++] = i - n; }
        if (y < n - 1 && net[i + n] < 0 && cond(i + n)) { net[i + n] = id; q[qt++] = i + n; }
      }
      id++;
    }
    G['_' + kind + 'Net'] = net;
  }
  for (const b of G.buildings) {
    if (b.mod) continue;
    const i = b.y * MAP_N + b.x;
    b._pn = b.built ? G._cableNet[i] : -1; b._wn = b.built ? G._pipeNet[i] : -1;
  }
  for (const b of G.buildings) if (b.mod) { const d = bById(G, b.dome); b._pn = d ? d._pn : -1; b._wn = d ? d._wn : -1; }
  G._netDirty = false;
}

// ---- research ----
function techAvailable(G, id) {
  const t = TECHS[id]; if (!t || techDone(G, id)) return false;
  if (t.breakthrough && !G.research.found.includes(id)) return false;
  return t.req.every(r => techDone(G, r));
}
function setResearch(G, id) { if (!techAvailable(G, id) && !(TECHS[id] && !techDone(G, id))) return false; if (techAvailable(G, id)) { G.research.cur = id; G.research.queue = G.research.queue.filter(q => q !== id); return true; } return queueResearch(G, id); }
// queue a tech together with any missing prerequisites
function queueResearch(G, id) {
  const t = TECHS[id]; if (!t || techDone(G, id) || (t.breakthrough && !G.research.found.includes(id))) return false;
  const need = [];
  const walk = x => { if (techDone(G, x) || need.includes(x)) return; for (const r of TECHS[x].req) walk(r); need.push(x); };
  walk(id);
  for (const x of need) if (!G.research.queue.includes(x) && G.research.cur !== x) G.research.queue.push(x);
  if (!G.research.cur) nextResearch(G);
  return true;
}
function nextResearch(G) {
  G.research.cur = null;
  const i = G.research.queue.findIndex(x => techAvailable(G, x));
  if (i >= 0) { G.research.cur = G.research.queue[i]; G.research.queue.splice(i, 1); }
}
function techCost(G, id) { return TECHS[id].cost; }
function completeTech(G, id) {
  G.research.done[id] = G.tick; delete G.research.prog[id];
  computeMods(G);
  if (TECHS[id].mods.deep) { G._dep = depositGrid(G); }
  log(G, 'Research complete: ' + TECHS[id].name + '. ' + TECHS[id].desc, 'good');
  fx(G, { k: 'tech', id });
}

// ---- surveying ----
function queueSurvey(G, si) { if (si < 0 || G.sectors[si].st === 1 || G.survey.includes(si)) return false; G.survey.push(si); return true; }
function useProbe(G, si) { if (G.probes <= 0 || G.sectors[si].st === 1) return false; G.probes--; finishSurvey(G, si); return true; }
function surveyCost(G, si) { const k = MAP_N / SECTOR, sx = si % k, sy = (si / k) | 0; const c = sectorOf(G.land.x + 1, G.land.y + 1); return 14 + 5 * Math.max(Math.abs(sx - c.sx), Math.abs(sy - c.sy)); }
function finishSurvey(G, si) {
  if (G.sectors[si].st === 1) return;
  G.sectors[si].st = 1; G.survey = G.survey.filter(x => x !== si);
  const k = MAP_N / SECTOR, x0 = (si % k) * SECTOR, y0 = ((si / k) | 0) * SECTOR;
  const deps = G.deposits.filter(d => d.x >= x0 && d.x < x0 + SECTOR && d.y >= y0 && d.y < y0 + SECTOR && depKnown(G, d));
  const an = G.anomalies.filter(a => !a.done && a.x >= x0 && a.x < x0 + SECTOR && a.y >= y0 && a.y < y0 + SECTOR);
  const parts = [];
  if (deps.length) parts.push(deps.length + ' deposit' + (deps.length > 1 ? 's' : ''));
  if (an.length) parts.push(an.length + ' anomal' + (an.length > 1 ? 'ies' : 'y'));
  log(G, 'Sector ' + sectorName(si) + ' surveyed' + (parts.length ? ': ' + parts.join(', ') + '.' : ', nothing of note.'), an.length ? 'good' : 'info', { x: x0 + SECTOR / 2, y: y0 + SECTOR / 2 });
}
function sectorName(si) { const k = MAP_N / SECTOR; return String.fromCharCode(65 + (si % k)) + (1 + ((si / k) | 0)); }

Object.assign(KC, { def, newGame, hydrate, computeMods, M, bById, cById, canPlace, place, canAddModule, addModule, linePath, checkLine, placeLine, removeLine, demolish, setOn, setPrio, setShift,
  computeNets, techAvailable, setResearch, queueResearch, techDone, techCost, unlocked, costOf, canAfford, storageCap, domeSlots, domeModules, domeFree, depAt, depKnown, scannedAt,
  sectorOf, sectorIndex, sectorName, queueSurvey, useProbe, surveyCost, center, log });
