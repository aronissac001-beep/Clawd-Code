// Long-run soak test: the bot plays one colony for many sols (it keeps going after Independence and then reshapes Kessa).
// Checks that late games stay fast, bounded and free of errors. usage: node tools/soak.mjs [sols=420] [seed=e-0]
import { loadEngine } from './load-engine.mjs';
const { KC, ctx } = loadEngine(); const BOT = ctx.BOT;
const SOLS = +(process.argv[2] || 420), seed = process.argv[3] || 'e-0';
let oks = 0, fails = 0; const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else oks++; };
const G = KC.newGame({ seed, sponsor: 'orrin', commander: 'engineer', difficulty: 'normal' }), B = {};
const t0 = Date.now(); let err = null, stepMs = 0, botMs = 0, early = 0, late = 0, bMax = 0;
try {
  for (let h = 0; h < SOLS * 24; h++) {
    let a = performance.now(); if (h % 4 === 0) BOT.turn(G, B); if (G.event) BOT.event(G, B); botMs += performance.now() - a;
    a = performance.now(); KC.step(G); const dt = performance.now() - a; stepMs += dt;
    const sol = KC.solOf(G.tick); if (sol > 20 && sol <= 70) early += dt; if (sol > SOLS - 50) late += dt; bMax = Math.max(bMax, G.buildings.length);
    if (G.over && G.over.win) G.over.continued = true; if (G.over && !G.over.win) break;
    if (h % (60 * 24) === 60 * 24 - 1) { const T = G.terra; console.log('  sol ' + sol + ': pop ' + G.colonists.length + ', ' + G.buildings.length + ' buildings, engine ' + (stepMs / 1440).toFixed(2) + ' ms/h, bot ' + (botMs / 1440).toFixed(1) + ' ms/h, Veil/Warmth/Water/Verdure ' + ['veil', 'warm', 'water', 'life'].map(k => T[k].toFixed(0)).join('/') + ', stages ' + Object.keys(T.st).length); stepMs = 0; botMs = 0; }
  }
} catch (e) { err = e; console.log(e.stack); }
const save = KC.serialize(G), T = G.terra, earlyH = early / (50 * 24), lateH = late / (50 * 24);
check(!err, 'no exceptions in ' + SOLS + ' sols');
check(!(G.over && !G.over.win) && G.colonists.length > 0, 'the colony is alive at the end (' + G.colonists.length + ' colonists)');
check(!!G.ms.independence, 'Independence was won (sol ' + G.ms.independence + ')');
check(lateH < Math.max(8, earlyH * 4), 'the simulation stays fast: ' + lateH.toFixed(2) + ' ms per hour late vs ' + earlyH.toFixed(2) + ' early');
check(save.length < 450 * 1024, 'the save stays compact (' + Math.round(save.length / 1024) + ' KB)');
check(G.log.length <= 250 && (G._fx || []).length < 200, 'the log and effect queue stay bounded');
check(G.buildings.length <= bMax && bMax < 900, 'buildings stay bounded (' + G.buildings.length + ', peak ' + bMax + ')');
const bad = []; const scan = (o, p, d) => { if (d > 6 || !o || typeof o !== 'object') return; for (const k in o) { const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p + k); else if (v && typeof v === 'object' && !ArrayBuffer.isView(v)) scan(v, p + k + '.', d + 1); } };
scan(JSON.parse(save), '', 0); check(!bad.length, 'no NaN or infinite numbers in the save' + (bad.length ? ': ' + bad.slice(0, 5).join(', ') : ''));
check(Object.keys(T.st).length >= 5, 'the independent colony reshaped Kessa (' + Object.keys(T.st).join(', ') + ')');
const G2 = KC.deserialize(save); for (let h = 0; h < 48; h++) KC.step(G2); check(G2.colonists.length > 0, 'the late save loads and keeps running');
console.log('\nsoak (' + seed + ', ' + SOLS + ' sols) in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
console.log(oks + ' checks passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
