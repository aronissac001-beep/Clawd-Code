// Bench: run the real Embercrown sim/pathing at a larger map size.
const R = new URL('../../../classic/js/', import.meta.url).href;
const size = +(process.argv[2] || 128);
const { BAL } = await import(R + 'data/balance.js');
BAL.mapSize = size;
await import(R + 'game/content.js');
const { createRun, serializeState } = await import(R + 'game/state.js');
const { tick, applyCommand, canPlace } = await import(R + 'game/sim.js');
const P = await import(R + 'game/systems/pathing.js');
const { N, idx } = await import(R + 'game/grid.js');
console.log('N =', N);
let s;
try { s = createRun({ seedText: 'BENCH-1' }); } catch (e) { console.log('createRun failed:', e.message); process.exit(1); }
const h = s.rt.hearth;
console.log('hearth at', h.tx, h.ty, 'nodes', s.nodes.length, 'spawns', s.spawns.length);
let open = 0; for (let i = 0; i < N * N; i++) if (!P.terrainBlocked(s, i)) open++;
console.log('open tiles', open, 'of', N * N);
// A*: random passable pairs, unlimited expansions and default 2000.
function rndOpen(r) { for (;;) { const x = (r() * N) | 0, y = (r() * N) | 0; if (!P.solidForFriend(s, idx(x, y))) return [x, y]; } }
let seed = 7; const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
for (const [label, maxE] of [['default 2000', 2000], ['unbounded', 1e9]]) {
  const pairs = []; for (let k = 0; k < 400; k++) pairs.push([rndOpen(r), rndOpen(r)]);
  for (let k = 0; k < 20; k++) P.astar(s, ...pairs[k][0], ...pairs[k][1], ...pairs[k][1], maxE); // warm
  const times = []; let fails = 0, lens = 0;
  for (const [[sx, sy], [gx, gy]] of pairs) {
    const t0 = performance.now();
    const p = P.astar(s, sx, sy, gx, gy, gx, gy, maxE);
    times.push(performance.now() - t0);
    if (!p || !p.length) fails++; else lens += p.length;
  }
  times.sort((a, b) => a - b);
  const sum = times.reduce((a, b) => a + b, 0);
  console.log(`A* ${label}: mean ${(sum / times.length).toFixed(3)} ms p50 ${times[200].toFixed(3)} p95 ${times[380].toFixed(3)} max ${times[399].toFixed(3)} (no/partial path ${fails})`);
}
// Long cross-map A* corner to corner
{ const near=(fx,fy)=>{for(let d=0;d<N;d++)for(let y=0;y<=d;y++)for(let x=0;x<=d;x++){const tx=Math.round(fx*(N-1))+(fx<0.5?x:-x),ty=Math.round(fy*(N-1))+(fy<0.5?y:-y);if(tx>=0&&ty>=0&&tx<N&&ty<N&&!P.solidForFriend(s,idx(tx,ty)))return[tx,ty];}}; const a = near(0.03,0.03), b = near(0.97,0.97);
  const t0 = performance.now(); let p; for (let k = 0; k < 20; k++) p = P.astar(s, a[0], a[1], b[0], b[1], b[0], b[1], 1e9); console.log('A* corner-to-corner x20 avg', ((performance.now() - t0) / 20).toFixed(3), 'ms, waypoints', p && p.length); }
// Flow field build (two fields per rebuild in sim.js).
{ const f = P.createField(); P.buildFlowField(s, f, false); const t0 = performance.now(); for (let k = 0; k < 20; k++) P.buildFlowField(s, f, false); console.log('flow field build avg', ((performance.now() - t0) / 20).toFixed(2), 'ms (sim rebuilds 2 per change)'); }
// Sim ticks
{ const t0 = performance.now(); let n = 0; for (; n < 20 * 120; n++) tick(s); console.log('sim tick avg over 120 s (start colony)', ((performance.now() - t0) / n).toFixed(3), 'ms'); }
// Save size
const ser = serializeState(s); const js = JSON.stringify(ser);
console.log('save JSON bytes', js.length, 'typed arrays share', ['terrain','nodeGrid','occ','fog','lit'].map(k => k + ':' + JSON.stringify(ser[k]).length).join(' '), 'nodes json', JSON.stringify(ser.nodes).length);
const zlib = await import('node:zlib'); console.log('deflate-raw bytes', zlib.deflateRawSync(js).length);
