// ===== vehicles.js : rovers, pathfinding, anomalies =====
function addVehicle(G, t, x, y) {
  const p = nearestFree(G, x, y);
  const v = { id: G.nextId++, t, x: p.x, y: p.y, path: [], task: null, prog: 0 };
  if (t === 'crawler') v.drones = VEHICLES.crawler.hub.drones;
  v.vehicle = true;
  G.vehicles.push(v); return v;
}
function passable(G, x, y) {
  if (x < 0 || y < 0 || x >= MAP_N || y >= MAP_N) return false;
  const i = y * MAP_N + x; return G._T.slope[i] <= SLOPE_DRIVE && !G._occ[i];
}
function nearestFree(G, x, y) {
  for (let r = 0; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (passable(G, x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return { x, y };
}
// A* over 8 directions; returns list of [x,y] excluding the start
function findPath(G, sx, sy, tx, ty) {
  const n = MAP_N, N = n * n, start = sy * n + sx, goal = ty * n + tx;
  if (!passable(G, tx, ty)) return null;
  const g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const heap = []; const push = (i, f) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const hfn = i => { const x = i % n, y = (i / n) | 0, dx = Math.abs(x - tx), dy = Math.abs(y - ty); return Math.max(dx, dy) + 0.41 * Math.min(dx, dy); };
  g[start] = 0; push(start, hfn(start));
  while (heap.length) {
    const [, i] = pop(); if (closed[i]) continue; closed[i] = 1;
    if (i === goal) break;
    const x = i % n, y = (i / n) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy; if (!passable(G, xx, yy)) continue;
      if (dx && dy && (!passable(G, x + dx, y) || !passable(G, x, y + dy))) continue;
      const j = yy * n + xx; if (closed[j]) continue;
      const ng = g[i] + (dx && dy ? 1.414 : 1) + G._T.slope[j] * 8;
      if (ng < g[j]) { g[j] = ng; came[j] = i; push(j, ng + hfn(j)); }
    }
  }
  if (!closed[goal]) return null;
  const out = []; let c = goal; while (c !== start && c >= 0) { out.push([c % n, (c / n) | 0]); c = came[c]; }
  return out.reverse();
}
function moveVehicle(G, id, tx, ty, task) {
  const v = G.vehicles.find(x => x.id === id); if (!v) return { err: 'No such vehicle' };
  const t = nearestFree(G, tx, ty);
  const sx = Math.round(v.x), sy = Math.round(v.y);
  const p = findPath(G, sx, sy, t.x, t.y);
  if (!p) return { err: 'No route there' };
  v.x = sx; v.y = sy; v.path = p; v.task = task || null; v.prog = 0;
  return { ok: true, len: p.length };
}
function sendToAnomaly(G, vid, aid) {
  const a = G.anomalies.find(x => x.id === aid), v = G.vehicles.find(x => x.id === vid);
  if (!a || a.done || !v || v.t !== 'pathfinder') return { err: 'Only a Pathfinder can investigate' };
  return moveVehicle(G, vid, a.x, a.y, { k: 'anomaly', id: aid });
}
function vehicleStep(G) {
  for (const v of G.vehicles) {
    v.px = v.x; v.py = v.y;
    if (v.path.length) {
      let mv = VEHICLES[v.t].speed * (1 + M(G, 'vehicleSpeed')) * (G._env.dust ? 0.7 : 1);
      while (mv > 0 && v.path.length) {
        const [nx, ny] = v.path[0], dx = nx - v.x, dy = ny - v.y, d = Math.hypot(dx, dy);
        if (d <= mv) { v.x = nx; v.y = ny; v.path.shift(); mv -= d; }
        else { v.x += dx / d * mv; v.y += dy / d * mv; mv = 0; }
      }
      v.x = Math.round(v.x * 1000) / 1000; v.y = Math.round(v.y * 1000) / 1000;
      continue;
    }
    if (v.t === 'pathfinder') {
      if (v.task && v.task.k === 'anomaly') {
        const a = G.anomalies.find(x => x.id === v.task.id);
        if (!a || a.done) { v.task = null; continue; }
        if (cheb(v.x, v.y, a.x, a.y) <= 1.5) { v.prog++; if (v.prog >= 6) { resolveAnomaly(G, a); v.task = null; v.prog = 0; } }
        else v.task = null;
      } else {
        const s = sectorOf(Math.round(v.x), Math.round(v.y)), si = sectorIndex(s.sx, s.sy);
        if (si >= 0 && !G.sectors[si].st) { G.sectors[si].p += 3 * (1 + M(G, 'scan')); if (G.sectors[si].p >= surveyCost(G, si)) finishSurvey(G, si); }
      }
    }
  }
}
function grantBreakthrough(G) {
  const r = rng(G), pool = Object.keys(BREAKTHROUGHS).filter(id => !G.research.found.includes(id));
  if (!pool.length) return null;
  const id = r.pick(pool); G.research.found.push(id);
  return id;
}
function resolveAnomaly(G, a) {
  a.done = true; G.st.anomalies++;
  G.ms.anomaly = G.ms.anomaly || solOf(G.tick);
  const r = rng(G), v = a.roll % 2;
  let msg = '';
  const give = (o) => { for (const k in o) G.res[k] += o[k]; };
  if (a.kind === 'signal') {
    if (v) { const bt = grantBreakthrough(G); msg = bt ? 'The signal decodes into a schematic: breakthrough "' + TECHS[bt].name + '" can now be researched.' : ''; }
    if (!msg) { const pts = 250 + r.int(250); G.research.pool = (G.research.pool || 0) + pts; msg = 'The signal is a pulsar echo. Its data adds ' + pts + ' research.'; }
  } else if (a.kind === 'cache') {
    if (v) { give({ metals: 30, parts: 12, polymers: 8 }); msg = 'A sealed supply cache from an old survey: 30 metals, 12 parts, 8 polymers.'; }
    else { G.prefabs.dome_s = (G.prefabs.dome_s || 0) + 1; msg = 'A crated dome kit, never deployed. You gain a prefab Bubble Dome.'; }
  } else if (a.kind === 'warden') {
    const bt = G.research.found.includes('bt_hum') ? grantBreakthrough(G) : (G.research.found.push('bt_hum'), 'bt_hum');
    msg = bt ? 'The Warden\'s hum resolves into a pattern. Breakthrough "' + TECHS[bt].name + '" can now be researched.' : 'The Warden falls silent as the Pathfinder approaches.';
    if (!bt) { G.funds += 300; msg += ' Sponsor scientists pay 300 for the recordings.'; }
  } else if (a.kind === 'bloom') {
    give({ food: 30 }); G.research.pool = (G.research.pool || 0) + 150;
    msg = 'Fossil Pale Bloom: dormant spores revive in warm water. 30 food and 150 research.';
  } else if (a.kind === 'wreck') {
    if (v) { const L = G.buildings.find(b => b.t === 'lander'); L.drones += 3; give({ electronics: 6 }); msg = 'Three drones from the wreck still boot up, plus 6 electronics.'; }
    else { G.probes += 2; give({ electronics: 4 }); msg = 'The wreck\'s spare orbital probes are intact: +2 probes and 4 electronics.'; }
  } else if (a.kind === 'vent') {
    if (v) { const bt = grantBreakthrough(G); msg = bt ? 'Microbes thrive in the vent. Breakthrough "' + TECHS[bt].name + '" can now be researched.' : ''; }
    if (!msg) { G.funds += 450; msg = 'Geothermal data sells well at home: +450 funding.'; }
  }
  log(G, ANOMALIES[a.kind].name + ': ' + msg, 'good', a);
  fx(G, { k: 'anomaly', id: a.id });
}
Object.assign(KC, { addVehicle, findPath, moveVehicle, sendToAnomaly, passable });
