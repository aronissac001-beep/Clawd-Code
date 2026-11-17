const R = new URL('../../../classic/js/', import.meta.url).href;
const size = +(process.argv[2] || 128);
const { BAL } = await import(R + 'data/balance.js'); BAL.mapSize = size;
await import(R + 'game/content.js');
const { createRun } = await import(R + 'game/state.js');
const { tick, applyCommand, canPlace } = await import(R + 'game/sim.js');
const C = await import(R + 'game/systems/common.js');
const { N, T } = await import(R + 'game/grid.js');
const s = createRun({ seedText: 'BENCH-1' });
const h = s.rt.hearth;
// a modest town
let placed = 0;
for (const type of ['farm','farm','lumber','lumber','quarry','house','house','house','house','house','tower','tower','tower','brazier','brazier','barracks','wall','wall','wall','wall']) {
  outer: for (let r = 3; r < 12; r++) for (let a = 0; a < 24; a++) { const tx = Math.round(h.tx + 1 + Math.cos(a / 24 * 6.283 + r) * r), ty = Math.round(h.ty + 1 + Math.sin(a / 24 * 6.283 + r) * r); if (canPlace(s, type, tx, ty).ok && applyCommand(s, { t: 'place', type, tiles: [[tx, ty]] }).ok) { placed++; break outer; } }
}
s.res.wood = s.res.stone = s.res.gold = s.res.food = 9999;
for (let i = 0; i < 34; i++) C.spawnVillager(s, (h.tx + 1) * T + (i % 8 - 4) * 16, (h.ty + 4) * T + ((i / 8) | 0) * 16);
for (let k = 0; k < 20 * 60; k++) tick(s);
console.log('placed', placed, 'built', s.buildings.filter(b => b.built).length, 'villagers', s.villagers.length);
// day ticks with 40 villagers working
{ const t0 = performance.now(); for (let k = 0; k < 20 * 30; k++) tick(s); console.log('day tick, 40 villagers, ms', ((performance.now() - t0) / 600).toFixed(3)); }
// 40 raiders converging from map edges
const ET = ['husk', 'hound', 'knight', 'shade'];
s.cycle.phase = 'night'; s.cycle.t = 0;
for (let i = 0; i < 40; i++) { const sp = s.spawns[i % s.spawns.length]; C.spawnEnemy(s, ET[i % 4], (sp.tx + 0.5) * T + (i % 5) * 6, (sp.ty + 0.5) * T); }
{ let mx = 0; const t0 = performance.now(); for (let k = 0; k < 20 * 40; k++) { const a = performance.now(); tick(s); mx = Math.max(mx, performance.now() - a); } console.log('night tick, 40 villagers + 40 raiders, avg ms', ((performance.now() - t0) / 800).toFixed(3), 'max', mx.toFixed(2), 'alive foes', s.enemies.filter(e => e.alive).length); }
// flow dirty every second (mining a tile per second would do that)
{ const t0 = performance.now(); for (let k = 0; k < 20 * 20; k++) { if (k % 20 === 0) s.rt.flowDirty = true; tick(s); } console.log('tick with flow rebuild every 1 s, avg ms', ((performance.now() - t0) / 400).toFixed(3)); }
