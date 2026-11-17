const R = new URL('../../../classic/js/', import.meta.url).href;
const { BAL } = await import(R + 'data/balance.js'); BAL.mapSize = +(process.argv[2] || 128);
await import(R + 'game/content.js');
const { createRun } = await import(R + 'game/state.js');
const P = await import(R + 'game/systems/pathing.js');
const { N, idx } = await import(R + 'game/grid.js');
const s = createRun({ seedText: 'BENCH-1' });
// connected component of the hearth (friend passability), to only test reachable pairs
const comp = new Uint8Array(N * N); const h = s.rt.hearth; const q = [idx(h.tx + 1, h.ty + 3)]; comp[q[0]] = 1;
while (q.length) { const i = q.pop(), x = i % N, y = (i / N) | 0; for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue; const j = idx(nx, ny); if (!comp[j] && !P.solidForFriend(s, j)) { comp[j] = 1; q.push(j); } } }
const reach = []; for (let i = 0; i < N * N; i++) if (comp[i]) reach.push(i);
let seed = 3; const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
let trunc = 0, tot = 0, tA = 0, tB = 0; const far = [];
for (let k = 0; k < 400; k++) {
  const a = reach[(r() * reach.length) | 0], b = reach[(r() * reach.length) | 0];
  const ax = a % N, ay = (a / N) | 0, bx = b % N, by = (b / N) | 0;
  let t0 = performance.now(); const p = P.astar(s, ax, ay, bx, by, bx, by, 2000, false); tA += performance.now() - t0;
  t0 = performance.now(); const p2 = P.astar(s, ax, ay, bx, by, bx, by, 1e9, false); tB += performance.now() - t0;
  tot++; const end = p && p.length ? p[p.length - 1] : a; const ex = end % N, ey = (end / N) | 0;
  if (Math.max(Math.abs(ex - bx), Math.abs(ey - by)) > 1) trunc++;
}
console.log(`N=${N} reachable ${reach.length}; cap 2000: ${trunc}/${tot} reachable goals NOT reached (truncated); avg ${(tA / tot).toFixed(3)} ms capped vs ${(tB / tot).toFixed(3)} ms uncapped (no smoothing)`);
