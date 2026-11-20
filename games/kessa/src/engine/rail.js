// ===== rail.js : the monorail. Track is laid tile by tile between Rail Stations; stations joined by track form a line,
// and trains shuttle along it. A running line lets colonists commute to work near any of its stations, lets drone hubs
// near its stations share their drones, and ships the output of extractors near a station (+15%) when the line also
// reaches the lander or a depot. Trains move one game hour at a time; the screen interpolates between hours.
const RAIL = { speed: 7, dwell: 1, reach: 10, hubLink: 7, freight: 0.15, perTrain: 3, maxTrains: 4 };
const FREIGHT = new Set(['oremine', 'raremine', 'automine', 'harvester', 'sinterer']);
function isStation(G, i) { const id = G._occ[i]; if (!id) return false; const b = bById(G, id); return !!(b && b.t === 'station'); }
// track networks and the stations on them; recomputed when track or stations change
function computeRail(G) {
  const n = MAP_N, N = n * n, net = new Int32Array(N).fill(-1), L = G.rail, occ = G._occ;
  const cond = i => L[i] === 1 || (occ[i] && (() => { const b = bById(G, occ[i]); return b && b.t === 'station' && b.built; })());
  let id = 0; const q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (net[s] >= 0 || !(L[s] === 1 || occ[s]) || !cond(s)) continue;
    let qh = 0, qt = 0; q[qt++] = s; net[s] = id;
    while (qh < qt) { const i = q[qh++], x = i % n, y = (i / n) | 0; for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) if (j >= 0 && net[j] < 0 && (L[j] === 1 || occ[j]) && cond(j)) { net[j] = id; q[qt++] = j; } }
    id++;
  }
  const nets = new Map();
  for (const b of G.buildings) {
    if (b.t !== 'station') continue; b._rn = -1;
    if (!b.built) continue;
    const k = net[b.y * n + b.x]; b._rn = k;
    let N0 = nets.get(k); if (!N0) { N0 = { id: k, st: [], key: b.id }; nets.set(k, N0); }
    N0.st.push(b); N0.key = Math.min(N0.key, b.id);
  }
  // each line visits its stations in order along the track (from one end), then comes back
  for (const N0 of nets.values()) {
    if (N0.st.length < 2) { N0.route = N0.st.slice(); continue; }
    const d0 = railDist(G, net, N0.st[0]); let end = N0.st[0]; for (const b of N0.st) if ((d0.get(b.id) || 0) > (d0.get(end.id) || 0)) end = b;
    const d1 = railDist(G, net, end); N0.route = N0.st.slice().sort((a, b) => (d1.get(a.id) || 0) - (d1.get(b.id) || 0) || a.id - b.id);
  }
  G._rail = { net, nets, paths: new Map() };
  G._railDirty = false; G._railGen = (G._railGen || 0) + 1;
  return G._rail;
}
// distance along the track from one station to every other station on its network
function railDist(G, net, from) {
  const n = MAP_N, k = net[from.y * n + from.x], dist = new Int32Array(n * n).fill(-1), q = [];
  for (let y = from.y; y < from.y + from.s; y++) for (let x = from.x; x < from.x + from.s; x++) { dist[y * n + x] = 0; q.push(y * n + x); }
  for (let h = 0; h < q.length; h++) { const i = q[h], x = i % n, y = (i / n) | 0; for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) if (j >= 0 && dist[j] < 0 && net[j] === k) { dist[j] = dist[i] + 1; q.push(j); } }
  const out = new Map(); for (const b of G.buildings) if (b.t === 'station' && b.built) out.set(b.id, dist[b.y * n + b.x]); return out;
}
// the tile path a train takes from one station to the next (centres of tiles), cached until the track changes
function railPath(G, a, b) {
  const R0 = G._rail, key = a.id + '-' + b.id; let p = R0.paths.get(key); if (p) return p;
  const n = MAP_N, net = R0.net, k = net[a.y * n + a.x], prev = new Int32Array(n * n).fill(-2), q = [];
  const inB = i => { const x = i % n, y = (i / n) | 0; return x >= b.x && y >= b.y && x < b.x + b.s && y < b.y + b.s; };
  const ca = [a.x + a.s / 2 - 0.5, a.y + a.s / 2 - 0.5];
  for (let y = a.y; y < a.y + a.s; y++) for (let x = a.x; x < a.x + a.s; x++) { prev[y * n + x] = -1; q.push(y * n + x); }
  let end = -1;
  for (let h = 0; h < q.length && end < 0; h++) { const i = q[h], x = i % n, y = (i / n) | 0; for (const j of [x > 0 ? i - 1 : -1, x < n - 1 ? i + 1 : -1, y > 0 ? i - n : -1, y < n - 1 ? i + n : -1]) if (j >= 0 && prev[j] === -2 && net[j] === k) { prev[j] = i; if (inB(j)) { end = j; break; } q.push(j); } }
  const tiles = [];
  for (let c = end; c >= 0; c = prev[c]) tiles.push([c % n, (c / n) | 0]);
  tiles.reverse();
  // from platform centre to platform centre, through the track tiles between
  const pts = [ca].concat(tiles.filter(([x, y]) => !(x >= a.x && y >= a.y && x < a.x + a.s && y < a.y + a.s) && !(x >= b.x && y >= b.y && x < b.x + b.s && y < b.y + b.s)), [[b.x + b.s / 2 - 0.5, b.y + b.s / 2 - 0.5]]);
  let len = 0; const cum = [0]; for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
  p = { pts, cum, len: end < 0 ? 0 : len }; R0.paths.set(key, p); return p;
}
function railOf(G) { if (!G._rail || G._railDirty) computeRail(G); return G._rail; }
const stationLive = b => b.built && !b.broken && b.on && (b.pw === undefined || b.pw >= 0.5);
// how many trains each line runs, and keep the train list in step with the lines
function trainsWanted(N0) { return N0.st.length < 2 ? 0 : Math.min(RAIL.maxTrains, 1 + Math.floor((N0.st.length - 2) / RAIL.perTrain)); }
function syncTrains(G) {
  const R0 = G._rail; if (!G.trains) G.trains = [];
  const keep = [];
  for (const N0 of R0.nets.values()) {
    const want = trainsWanted(N0), have = G.trains.filter(t => t.line === N0.key);
    for (let i = 0; i < Math.min(want, have.length); i++) { const t = have[i]; if (t.at >= N0.route.length) { t.at = 0; t.dir = 1; t.d = 0; } keep.push(t); }
    for (let i = have.length; i < want; i++) { const t = { id: G.nextId++, line: N0.key, at: Math.min(N0.route.length - 1, i % N0.route.length), dir: 1, d: 0, wait: i, pax: 0, cargo: 0, trips: 0 }; if (t.at === N0.route.length - 1) t.dir = -1; keep.push(t); }
  }
  G.trains = keep;
}
function lineOf(G, t) { const R0 = railOf(G); for (const N0 of R0.nets.values()) if (N0.key === t.line) return N0; return null; }
// a line runs while it has trains and at least two working stations
function lineRunning(N0) { return N0.st.length >= 2 && N0.st.filter(stationLive).length >= 2; }
function railHour(G, env) {
  if (!G.trains || (!G.trains.length && !G._railDirty && G._railSynced === G._railGen)) { G._freight = null; G._commuteKey = ''; return; }
  const R0 = railOf(G), speed = RAIL.speed * (env && env.dust ? 0.7 : 1);
  // the train list follows the lines only here, in the hourly tick (never from a screen that happened to look at the track)
  if (G._railSynced !== G._railGen) { syncTrains(G); G._railSynced = G._railGen; }
  for (const t of G.trains) {
    const N0 = lineOf(G, t); t._stop = false; if (!N0 || N0.route.length < 2) continue;
    // a line that starts or stops running changes who can commute: jobs are reassigned
    const run = lineRunning(N0); if (t.run !== run) { t.run = run; G._jobsDirty = true; }
    if (t.wait > 0) { t.wait--; continue; }
    const a = N0.route[t.at], b = N0.route[t.at + t.dir];
    if (!a || !b) { t.dir = -t.dir; continue; }
    if (!stationLive(a) || !stationLive(b)) { t._stop = true; continue; }
    const p = railPath(G, a, b); if (!p.len) { t._stop = true; continue; }
    t.d += speed;
    if (t.d >= p.len) {
      t.d = 0; t.at += t.dir; t.trips++; t.wait = RAIL.dwell;
      if (t.at <= 0 || t.at >= N0.route.length - 1) t.dir = t.at <= 0 ? 1 : -1;
      t.pax = Math.min(48, Math.round((G._railPax || 0) / Math.max(1, G.trains.length)));
      t.cargo = Math.min(9, Math.round((G._railCargo || 0) * 2));
      G.st.trainTrips = (G.st.trainTrips || 0) + 1;
    }
  }
  // freight: extractors near a station on a running line that also serves the lander or a depot
  const fr = new Set(); G._railCargo = 0;
  for (const N0 of R0.nets.values()) {
    if (!lineRunning(N0) || !G.trains.some(t => t.line === N0.key)) continue;
    const live = N0.st.filter(stationLive);
    const store = live.some(s => G.buildings.some(b => (b.t === 'lander' || (b.t === 'depot' && b.built)) && cheb(center(b).x, center(b).y, center(s).x, center(s).y) <= RAIL.reach));
    if (!store) continue;
    for (const b of G.buildings) if (b.built && FREIGHT.has(b.t) && live.some(s => cheb(center(b).x, center(b).y, center(s).x, center(s).y) <= RAIL.reach)) fr.add(b.id);
  }
  G._freight = fr.size ? fr : null;
}
// stations a dome's residents can ride to: every station on a running line that has a stop within the dome's reach
function commuteMap(G) {
  const map = new Map(); if (!G.trains || !G.trains.length) return map;
  const R0 = railOf(G);
  for (const N0 of R0.nets.values()) {
    if (!lineRunning(N0) || !G.trains.some(t => t.line === N0.key)) continue;
    const live = N0.st.filter(stationLive), pts = live.map(center);
    for (const d of G.buildings) {
      if (d.mod || !d.built || !BUILDINGS[d.t].dome) continue;
      const dc = center(d), reach = BUILDINGS[d.t].dome.reach + d.s / 2;
      if (!pts.some(p => cheb(p.x, p.y, dc.x, dc.y) <= reach)) continue;
      const list = map.get(d.id) || []; for (const p of pts) list.push(p); map.set(d.id, list);
    }
  }
  return map;
}
function railReach(G, w, dome) {
  const list = G._commute && G._commute.get(dome.id); if (!list) return false;
  const wc = center(w); for (const p of list) if (cheb(p.x, p.y, wc.x, wc.y) <= RAIL.reach) return true; return false;
}
// drone hubs near stations of one running line pool their drones
function hubLinks(G, hubs) {
  if (!G.trains || !G.trains.length) return;
  const R0 = railOf(G);
  for (const N0 of R0.nets.values()) {
    if (!lineRunning(N0) || !G.trains.some(t => t.line === N0.key)) continue;
    const pts = N0.st.filter(stationLive).map(center);
    const linked = hubs.filter(h => !h.src.vehicle && pts.some(p => cheb(p.x, p.y, h.x, h.y) <= RAIL.hubLink));
    if (linked.length < 2) continue;
    for (const h of linked) h.alt = (h.alt || []).concat(linked.filter(o => o !== h));
  }
}
// where a train is drawn: a point along its current leg (frac: 0..1 of the coming hour), and its heading
function trainPos(G, t, frac) {
  const N0 = lineOf(G, t); if (!N0 || N0.route.length < 2) return null;
  const a = N0.route[t.at], b = N0.route[t.at + t.dir] || N0.route[t.at - t.dir]; if (!a || !b) return null;
  const p = railPath(G, a, b); if (!p.len) { const c = center(a); return { x: c.x - 0.5, y: c.y - 0.5, dx: 1, dy: 0, stop: true }; }
  const moving = !t.wait && !t._stop, d = clamp(t.d + (moving ? RAIL.speed * (frac || 0) : 0), 0, p.len - 0.001);
  return Object.assign(pointAt(p, d), { stop: !moving, path: p, d });
}
function pointAt(p, d) {
  let i = 1; while (i < p.cum.length - 1 && p.cum[i] < d) i++;
  const a = p.pts[i - 1], b = p.pts[i], seg = (p.cum[i] - p.cum[i - 1]) || 1, f = clamp((d - p.cum[i - 1]) / seg, 0, 1);
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, dx: b[0] - a[0], dy: b[1] - a[1] };
}
// a track route between two stations: around buildings and slopes, reusing existing track where it can
function railRoute(G, aId, bId) {
  const a = bById(G, aId), b = bById(G, bId); if (!a || !b || a.t !== 'station' || b.t !== 'station') return { err: 'Pick two stations.' };
  if (a === b) return { err: 'Pick another station.' };
  const n = MAP_N, N = n * n, cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const inF = (s, x, y) => x >= s.x && y >= s.y && x < s.x + s.s && y < s.y + s.s;
  const ok = (x, y) => { if (inF(a, x, y) || inF(b, x, y)) return 0.01; const r = lineTileOk(G, 'rail', x, y); return r === false ? 0 : G.rail[y * n + x] ? 0.3 : 1; };
  const heap = []; const push = (i, c) => { heap.push([c, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  for (let y = a.y; y < a.y + a.s; y++) for (let x = a.x; x < a.x + a.s; x++) { cost[y * n + x] = 0; push(y * n + x, 0); }
  let end = -1;
  while (heap.length) {
    const [c, i] = pop(); if (c > cost[i]) continue;
    const x = i % n, y = (i / n) | 0; if (inF(b, x, y)) { end = i; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
      const w = ok(xx, yy); if (!w) continue;
      const j = yy * n + xx, nc = c + w + (prev[i] >= 0 && (prev[i] % n !== x) !== (dx !== 0) ? 0.25 : 0);
      if (nc < cost[j]) { cost[j] = nc; prev[j] = i; push(j, nc); }
    }
  }
  if (end < 0) return { err: 'No route for track between these stations (slopes, water or buildings in the way).' };
  const tiles = []; for (let c = end; c >= 0; c = prev[c]) { const x = c % n, y = (c / n) | 0; if (!inF(a, x, y) && !inF(b, x, y)) tiles.push([x, y]); }
  tiles.reverse();
  const fresh = tiles.filter(([x, y]) => !G.rail[y * n + x]).length;
  return { ok: true, tiles, n: fresh, cost: railCost(G, fresh) };
}
function railCost(G, n) { const c = BUILDINGS.rail.cost, o = {}; for (const k in c) o[k] = Math.round(n * c[k] * 100) / 100; return o; }
function layTrack(G, aId, bId) {
  const r = railRoute(G, aId, bId); if (r.err) return r;
  if (!r.n) return { ok: true, n: 0, tiles: r.tiles };
  const p = placeLine(G, 'rail', r.tiles); if (p.err) return p;
  log(G, r.n + ' tiles of monorail track planned between stations #' + aId + ' and #' + bId + '. Drones will lay it.', 'info');
  return Object.assign(r, { ok: true });
}
// for the panels: what the network is doing
function railStats(G) {
  const R0 = railOf(G), lines = [];
  for (const N0 of R0.nets.values()) lines.push({ key: N0.key, stations: N0.st.length, live: N0.st.filter(stationLive).length, running: lineRunning(N0), trains: (G.trains || []).filter(t => t.line === N0.key).length, route: N0.route.map(b => b.id) });
  let track = 0, planned = 0; for (let i = 0; i < G.rail.length; i++) { if (G.rail[i] === 1) track++; else if (G.rail[i] === 3) planned++; }
  return { lines, track, planned, pax: G._railPax || 0, freight: G._freight ? G._freight.size : 0, trips: G.st.trainTrips || 0 };
}
Object.assign(KC, { RAIL, FREIGHT, computeRail, railOf, railPath, trainPos, railRoute, layTrack, railStats, commuteMap, lineRunning, stationLive, railCost });
