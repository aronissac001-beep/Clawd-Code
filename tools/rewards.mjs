// Reward cadence test (rework stream H2). Plays whole runs headless with the runsim bot and
// records every pending choice the realm raises:
//   - exactly one pick per dawn (a Dawn Card), the Long Night's dawn giving the Beacon reward
//     instead, so exactly one region-end pick per region (in the region, or owed on the map);
//   - no pick in any other phase, except the run's very first region opening on its 3-card
//     blueprint pick;
//   - every Dawn Card option passes hasEffect when it is offered.
//   node tools/rewards.mjs [runs=4] [nights=20]
import '../js/game/content.js';
import { createNewRun, travelOptions, enterNode, resolveEvent, buyItem, finishRegion, beaconOptions, takeBeacon, currentNode, advanceAct } from '../js/game/run.js';
import { serializeRun, deserializeRun } from '../js/game/runflow.js';
import { playRegion } from './runsim-lib.mjs';
import { BUS } from '../js/game/hooks.js';
import { hasEffect } from '../js/game/systems/dawncards.js';

const RUNS = +(process.argv[2] || 4);
const NIGHTS = +(process.argv[3] || 20);
let fails = 0;
const fail = (msg) => { fails++; if (fails < 30) console.log('FAIL  ' + msg); };

// Count dawns as the simulation enters them (a plug-in observer: reads only).
let dawns = 0;
BUS.phase.push((s, phase) => { if (phase === 'dawn') dawns++; });

const tot = { nights: 0, dawns: 0, dawnPicks: 0, beaconInRegion: 0, beaconOnMap: 0, regions: 0, regionEnds: 0, startPicks: 0, other: 0, kinds: {} };
for (let k = 0; k < RUNS && tot.nights < NIGHTS * RUNS; k++) {
  let run = createNewRun({ seedText: 'REWARDS-' + k, difficulty: 'story', faction: 'dawnhold' });
  let guard = 0, nights = 0;
  while (!run.outcome && guard++ < 60 && nights < NIGHTS) {
    const opts = travelOptions(run);
    if (!opts.length) break;
    const pref = (id) => ({ region: 5, cursed: 3, mystery: 2, merchant: 1, boss: 9 }[run.map.nodes[id].type] || 0);
    const id = opts.slice().sort((a, b) => pref(b) - pref(a))[0];
    const first = run.regionsCleared === 0 && !run.visited.length;
    const res = enterNode(run, id);
    const node = currentNode(run);
    run = deserializeRun(JSON.parse(JSON.stringify(serializeRun(run))));
    if (res.kind === 'region') {
      const s = run.region;
      tot.regions++;
      // Per region: the dawn of each pick, keyed by night; a pick seen twice is the same pick.
      const seen = new Set();
      let regionPicks = 0, beaconHere = 0;
      const d0 = dawns;
      const onPending = (st) => {
        const p = st.pending;
        const key = `${st.cycle.night}/${p.kind}/${st.tick}`;
        if (seen.has(key)) return;
        seen.add(key);
        tot.kinds[p.kind] = (tot.kinds[p.kind] || 0) + 1;
        const atStart = st.tick === 0 && st.cycle.phase === 'day' && st.cycle.night === 0;
        if (atStart) {
          tot.startPicks++;
          if (!(first && p.kind === 'blueprint')) fail(`[${run.seedText} ${node.id}] a pick at region start (${p.kind}) outside the run's first region`);
          return;
        }
        if (st.cycle.phase !== 'dawn') { tot.other++; fail(`[${run.seedText} ${node.id}] a ${p.kind} pick in the ${st.cycle.phase} (night ${st.cycle.night})`); return; }
        regionPicks++;
        if (p.kind === 'dawnCard') { tot.dawnPicks++; for (const o of p.options) if (!hasEffect(st, o)) fail(`[${run.seedText}] offered a card with no effect: ${JSON.stringify(o)}`); }
        else if (p.kind === 'beaconPick') { tot.beaconInRegion++; beaconHere++; }
        else { tot.other++; fail(`[${run.seedText} ${node.id}] dawn pick of kind ${p.kind}`); }
      };
      playRegion(s, [], onPending);
      const regionDawns = dawns - d0;
      tot.dawns += regionDawns; tot.nights += s.cycle.night; nights += s.cycle.night;
      // Exactly one pick per dawn. The game ends at the dawn a boss falls or the Hearth falls,
      // so a defeated region's last dawn may have none; a dawn with no card left is reported.
      if (regionPicks !== regionDawns) fail(`[${run.seedText} ${node.id} ${node.type}] ${regionPicks} picks over ${regionDawns} dawns (${s.outcome ? s.outcome.result : '?'})`);
      if (beaconHere > 1) fail(`[${run.seedText} ${node.id}] ${beaconHere} Beacon picks in one region`);
      const sum = finishRegion(run, s);
      if (!run.outcome) {
        const b = beaconOptions(run);
        if (b.length) { tot.beaconOnMap++; takeBeacon(run, b[0]); }
        const ends = beaconHere + (b.length ? 1 : 0);
        tot.regionEnds++;
        if (ends !== 1) fail(`[${run.seedText} ${node.id} ${node.type}] ${ends} region-end picks (in region ${beaconHere}, on the map ${b.length ? 1 : 0}); ${sum.result}`);
      }
      if (run.actDone) { run.actDone = null; advanceAct(run); }
    } else if (res.kind === 'event') {
      for (let ci = 0; ci < res.event.choices.length; ci++) if (resolveEvent(run, res.event, ci)) break;
      run.pending = null;
    } else if (res.kind === 'merchant') {
      res.shop.items.forEach((it, i) => { if (it.kind === 'relic' && run.gold >= it.price) buyItem(run, res.shop, i); });
      run.pending = null;
    }
  }
}
console.log(JSON.stringify(tot));
console.log(`${tot.nights} nights, ${tot.dawns} dawns: ${tot.dawnPicks} Dawn Card picks + ${tot.beaconInRegion} Beacon picks at the Long Night's dawn; ${tot.regionEnds} region ends with ${tot.beaconInRegion + tot.beaconOnMap} region-end picks (${tot.beaconOnMap} owed on the map); ${tot.startPicks} region-start pick(s); ${tot.other} other picks`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
