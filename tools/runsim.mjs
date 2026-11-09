// Headless whole-run auto-play: travels the Realm Map with a scripted player,
// resolves every node type and plays each region with a simple builder bot.
//   node tools/runsim.mjs [runs=8] [difficulty=standard] [--verbose]
import '../js/game/content.js';
import { createNewRun, travelOptions, enterNode, resolveEvent, buyItem, resolveShrine, finishRegion, beaconOptions, takeBeacon, currentNode } from '../js/game/run.js';
import { serializeRun, deserializeRun } from '../js/game/runflow.js';
import { tick, applyCommand, canPlace } from '../js/game/sim.js';

const RUNS = +(process.argv[2] || 8);
const DIFF = process.argv[3] || 'standard';
const VERBOSE = process.argv.includes('--verbose');
const ORDER = ['farm', 'lumber', 'house', 'quarry', 'tower', 'barracks', 'farm', 'house', 'tower', 'brazier', 'ballista', 'house', 'spire', 'tower', 'granary', 'market', 'farm', 'tower', 'trap', 'tower', 'house', 'ballista'];

function tryBuild(s, type) {
  const h = s.rt.hearth;
  for (let r = 3; r < 11; r++) for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2 + r;
    const tx = Math.round(h.tx + 1 + Math.cos(ang) * r), ty = Math.round(h.ty + 1 + Math.sin(ang) * r);
    if (canPlace(s, type, tx, ty).ok) return applyCommand(s, { t: 'place', type, tiles: [[tx, ty]] }).ok;
  }
  return false;
}

function playRegion(s, log) {
  let step = 0, ticks = 0;
  const limit = 20 * 60 * 30;
  while (!s.outcome && ticks < limit) {
    if (s.pending) {
      // Prefer military/defense blueprints, otherwise the first option.
      let i = 0;
      if (s.pending.kind === 'blueprint') { const pref = ['barracks', 'ballista', 'brazier', 'spire']; const j = s.pending.options.findIndex((t) => pref.includes(t)); if (j >= 0) i = j; }
      applyCommand(s, { t: 'choose', i });
    }
    if (ticks % 60 === 0) {
      for (let k = 0; k < ORDER.length; k++) { const t = ORDER[(step + k) % ORDER.length]; if (tryBuild(s, t)) { step++; break; } }
      const b = s.buildings.find((x) => x.type === 'barracks' && x.built);
      if (b && s.res.gold > 40) applyCommand(s, { t: 'train', id: b.id, u: ['spearman', 'militia', 'archer'][(ticks / 60) % 3 | 0] });
      if (s.sovereign && s.sovereign.novaCd <= 0 && s.enemies.filter((e) => !e.stationary).length > 4) applyCommand(s, { t: 'ability', name: 'nova' });
      // Rift objective: march the squad and Sovereign at the rift by day.
      const rift = s.enemies.find((e) => e.type === 'rift' && e.alive);
      if (rift && s.cycle.phase === 'day' && s.cycle.t > 30) {
        for (const q of s.squads) applyCommand(s, { t: 'squadAttack', id: q.id, target: rift.id });
        if (s.sovereign && s.sovereign.hp > s.sovereign.maxHp * 0.6) applyCommand(s, { t: 'sovAttack', target: rift.id });
      }
      if (s.cycle.phase === 'day' && s.cycle.t > 40 && !s.beaconReady) applyCommand(s, { t: 'callNight' });
      if (s.beaconReady && s.cycle.phase === 'day') applyCommand(s, { t: 'lightBeacon' });
    }
    tick(s); s.rt.fx.length = 0; ticks++;
  }
  if (!s.outcome) { log.push(`  region timed out (${s.objective.type}, night ${s.cycle.night}, ${JSON.stringify(s.objective).slice(0, 120)})`); s.outcome = { result: 'defeat', reason: 'timeout' }; }
  return ticks;
}

const results = [];
for (let k = 0; k < RUNS; k++) {
  let run = createNewRun({ seedText: 'RUN-' + k, difficulty: DIFF });
  const log = [];
  let guard = 0, ticks = 0;
  const t0 = Date.now();
  while (!run.outcome && guard++ < 30) {
    const opts = travelOptions(run);
    if (!opts.length) { log.push('  no travel options!'); break; }
    // Prefer shrines when hurt, merchants when rich, otherwise regions.
    const pref = (id) => { const n = run.map.nodes[id]; let sc = { region: 5, ruin: 4, mystery: 3, cursed: 2, merchant: run.gold > 90 ? 6 : 1, shrine: run.sov.hp < run.sov.maxHp * 0.5 ? 7 : 2, boss: 9 }[n.type] || 0; return sc; };
    const id = opts.slice().sort((a, b) => pref(b) - pref(a))[0];
    const res = enterNode(run, id);
    const node = currentNode(run);
    // Round-trip the run through JSON at every node, as a reload would.
    run = deserializeRun(JSON.parse(JSON.stringify(serializeRun(run))));
    if (res.kind === 'region') {
      const s = run.region;
      ticks += playRegion(s, log);
      const sum = finishRegion(run, s);
      log.push(`  step ${node.step} ${node.type}/${s.objective.type}: ${sum.result} after ${sum.nights} nights, +${sum.embers} embers, sov ${run.sov.hp}/${run.sov.maxHp}, gold ${run.gold}${sum.loot.length ? ', loot: ' + sum.loot.join('; ') : ''}`);
      if (!run.outcome) { const b = beaconOptions(run); if (b.length) takeBeacon(run, b[0]); }
    } else if (res.kind === 'event') {
      const r = resolveEvent(run, res.event, 0);
      log.push(`  step ${node.step} event ${res.event.id}: ${r.lines.join('; ')}`);
    } else if (res.kind === 'merchant') {
      res.shop.items.forEach((it, i) => { if (it.kind === 'relic' && run.gold >= it.price) buyItem(run, res.shop, i); });
      log.push(`  step ${node.step} merchant: relics ${run.relics.map((r) => r.id).join(',')}, gold ${run.gold}`);
    } else if (res.kind === 'shrine') {
      const r = resolveShrine(run, run.sov.hp < run.sov.maxHp * 0.6 ? 'heal' : 'gamble');
      log.push(`  step ${node.step} shrine: ${r.lines.join('; ')}`);
    }
  }
  const node = currentNode(run);
  results.push({ seed: 'RUN-' + k, outcome: run.outcome ? run.outcome.result : 'unfinished', step: node ? node.step : -1, regions: run.regionsCleared, relics: run.relics.length, embers: run.embers, minutes: Math.round(ticks / 20 / 60), ms: Date.now() - t0 });
  if (VERBOSE || !run.outcome) console.log('RUN-' + k + '\n' + log.join('\n'));
}
console.table(results);
const wins = results.filter((r) => r.outcome === 'victory').length;
console.log(`${DIFF}: ${wins}/${RUNS} runs beat the Gloomwyrm; avg regions ${(results.reduce((a, r) => a + r.regions, 0) / RUNS).toFixed(1)}; avg game minutes ${(results.reduce((a, r) => a + r.minutes, 0) / RUNS).toFixed(0)}`);
