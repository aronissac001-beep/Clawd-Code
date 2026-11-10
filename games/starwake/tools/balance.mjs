// Parallel all-AI balance harness. Run: node games/starwake/tools/balance.mjs [games] [sizes=small,medium] [workers=4] [seedPrefix]
// Reports win share per archetype, victory types, conquest years and mid-game strength per archetype.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { loadEngine } from './load-engine.mjs';

let ENGINE = null;
function playOne(job) {
  const { SW } = ENGINE || (ENGINE = loadEngine());
  const G = SW.newGame({ seed: job.seed, size: job.size, years: 200, allAI: true, shape: ['spiral2', 'spiral4', 'elliptical', 'ring'][job.i % 4] });
  const snap = {};
  while (!G.over) {
    SW.advanceDay(G);
    if (G.day % (360 * 50) === 0) {
      const y = G.day / 360;
      for (const e of SW.majors(G)) { const k = e.persona; snap[y] = snap[y] || {}; const s = snap[y][k] = snap[y][k] || { n: 0, cols: 0, pops: 0, sys: 0, pow: 0, techs: 0 };
        s.n++; s.cols += SW.colonies(G, e).length; s.pops += SW.totalPops(G, e); s.sys += SW.ownedSystems(G, e).length; s.pow += SW.empirePower(G, e); s.techs += e.stats.techs; }
    }
  }
  const W = G.winner.e >= 0 ? G.empires[G.winner.e] : null;
  return { size: job.size, seed: job.seed, winner: W ? W.persona : null, type: G.winner.type, year: Math.round(G.day / 360), personas: SW.majors(G).map(e => e.persona),
    wars: G.log.filter(l => /declared war/.test(l.m)).length, peace: G.log.filter(l => /white peace|yielded/.test(l.m)).length, crisis: G.crisis.stage, snap };
}

if (!isMainThread) {
  for (const job of workerData.jobs) parentPort.postMessage(playOne(job));
} else {
  const N = +(process.argv[2] || 40), sizes = (process.argv[3] || 'small,medium').split(','), W = +(process.argv[4] || Math.min(4, os.cpus().length)), pre = process.argv[5] || 'bal';
  const jobs = []; for (let i = 0; i < N; i++) jobs.push({ i, seed: pre + i, size: sizes[i % sizes.length] });
  const per = Array.from({ length: W }, () => []); jobs.forEach((j, i) => per[i % W].push(j));
  const results = []; const t0 = Date.now();
  await Promise.all(per.map(js => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs: js } });
    w.on('message', r => { results.push(r); console.log(`${results.length}/${N} ${r.size} ${r.winner} by ${r.type} in year ${r.year} (${((Date.now() - t0) / 1000).toFixed(0)}s)`); });
    w.on('error', rej); w.on('exit', res);
  })));
  const report = (rs, label) => {
    const wins = {}, pres = {}, types = {};
    for (const r of rs) { if (r.winner) wins[r.winner] = (wins[r.winner] || 0) + 1; for (const p of new Set(r.personas)) pres[p] = (pres[p] || 0) + 1; types[r.type] = (types[r.type] || 0) + 1; }
    console.log(`\n== ${label}: ${rs.length} games ==`);
    for (const k of Object.keys(pres).sort((a, b) => (wins[b] || 0) - (wins[a] || 0))) console.log(`  ${k.padEnd(13)} ${(((wins[k] || 0) / rs.length) * 100).toFixed(0).padStart(3)}% of games (${wins[k] || 0}/${rs.length}), present in ${pres[k]}`);
    console.log('  victory types:', JSON.stringify(types));
    const cq = rs.filter(r => r.type === 'conquest').map(r => r.year).sort((a, b) => a - b);
    console.log('  conquest years:', cq.join(', ') || 'none');
  };
  report(results, 'all sizes');
  for (const s of sizes) report(results.filter(r => r.size === s), s);
  for (const y of [50, 100]) {
    const agg = {};
    for (const r of results) { const sn = r.snap[y]; if (!sn) continue; for (const k in sn) { const a = agg[k] = agg[k] || { n: 0, cols: 0, pops: 0, sys: 0, pow: 0, techs: 0 }; for (const f in sn[k]) a[f] += sn[k][f]; } }
    console.log(`\nyear ${y} averages per empire:`);
    for (const k in agg) { const a = agg[k]; console.log(`  ${k.padEnd(13)} colonies ${(a.cols / a.n).toFixed(1).padStart(5)} pops ${(a.pops / a.n).toFixed(0).padStart(5)} systems ${(a.sys / a.n).toFixed(0).padStart(4)} power ${(a.pow / a.n / 1000).toFixed(1).padStart(6)}k techs ${(a.techs / a.n).toFixed(0)}`); }
  }
  console.log(`\nwars per game ${(results.reduce((a, r) => a + r.wars, 0) / results.length).toFixed(1)}, peace deals per game ${(results.reduce((a, r) => a + r.peace, 0) / results.length).toFixed(1)}, crisis defeated in ${results.filter(r => r.crisis >= 3).length}/${results.length}`);
  console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
