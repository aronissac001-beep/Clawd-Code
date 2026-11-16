// Save migration check (v3 -> v4, the rework cuts): a real v3 run save with two active
// bounty flags (tools/fixtures/v3-bounties.json, captured before the cuts) must load, refund
// the escrowed bounty gold, drop every cut system's state and keep playing deterministically.
//   node tools/migrate.mjs
import { readFileSync } from 'fs';
import '../js/game/content.js';
import { STATE_VERSION, CUT_EXT_KEYS, CUT_FOES, serializeState, deserializeState } from '../js/game/state.js';
import { deserializeRun, serializeRun } from '../js/game/runflow.js';
import { tick } from '../js/game/sim.js';
import { BUS, each } from '../js/game/hooks.js';

let ok = true;
const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
const raw = JSON.parse(readFileSync(new URL('./fixtures/v3-bounties.json', import.meta.url), 'utf8')).state;

// What the v3 save holds.
const v3 = raw.region;
const escrow = v3.ext.heroes.bounties.reduce((a, b) => a + b.gold, 0);
check(v3.v === 3 && v3.ext.heroes.bounties.length === 2, `fixture is a v3 region with 2 bounties (${escrow} gold escrowed)`);

function load(data) {
  const run = deserializeRun(JSON.parse(JSON.stringify(data)));
  each(BUS.runLoad, run, {});
  return run;
}

// 1. The region loads and the escrow comes home.
const run = load(raw);
const s = run.region;
check(s.v === STATE_VERSION && STATE_VERSION === 4, `region migrated to v${s.v}`);
check(Math.abs(s.res.gold - (v3.res.gold + escrow)) < 1e-9, `gold ${v3.res.gold.toFixed(2)} -> ${s.res.gold.toFixed(2)} (+${escrow} refunded)`);
check(!(s.ext.heroes.bounties || []).length, 'no bounty flags left (the escrow was refunded)');
check(s.heroes.every((e) => !('purse' in e) && !('bountyId' in e) && !('skipB' in e) && !('skipT' in e) && e.gk !== 'bounty'), 'hero bounty fields gone');
check(CUT_EXT_KEYS.every((k) => !(k in s.ext)), `cut ext keys gone (had: ${CUT_EXT_KEYS.filter((k) => k in v3.ext).join(', ')})`);
check(!('storyteller' in s) && !('storyteller' in run), 'storyteller gone');
check(!s.enemies.some((e) => CUT_FOES.includes(e.type) || e.wild), `lairs and wild beasts gone (${v3.enemies.length} -> ${s.enemies.length} enemies)`);
check(['mood', 'decrees', 'calendar', 'wxCarry'].every((k) => !(k in run.ext)) && run.ext.heroes.every((h) => !('purse' in h)), 'run-level cut state and roster purse gone');
check(s.objective.type !== 'survive' || s.objective.nights <= Math.max(3, s.cycle.night + 1), `survive objective now ends on its Long Night (${v3.objective.nights} -> ${s.objective.nights} nights)`);
// A second migration pass changes nothing (no double refund).
const again = deserializeState(serializeState(s));
check(Math.abs(again.res.gold - s.res.gold) < 1e-9, 'reloading the migrated save does not refund twice');

// 2. Pending choices of cut kinds are dropped; others survive.
const pend = JSON.parse(JSON.stringify(raw));
pend.region.pending = { kind: 'decree', options: ['a', 'b'] };
pend.region.pendingQueue = [{ kind: 'regionEvent', id: 'x', options: [0] }, { kind: 'boon', options: ['food'] }];
const p2 = load(pend).region;
check(p2.pending && p2.pending.kind === 'boon' && p2.pendingQueue.length === 0, `cut pending kinds dropped, the next choice moves up (${p2.pending && p2.pending.kind})`);

// 3. It keeps playing, deterministically, through a save round-trip.
const a = load(raw).region, b = load(raw).region;
let c = null, err = null;
try {
  for (let t = 0; t < 20 * 240; t++) {
    tick(a); a.rt.fx.length = 0;
    tick(b); b.rt.fx.length = 0;
    if (c) { tick(c); c.rt.fx.length = 0; }
    if (t === 20 * 60) c = deserializeRun(JSON.parse(JSON.stringify(serializeRun({ ...run, region: b })))).region;
    if (a.outcome) break;
  }
} catch (e) { err = e; }
check(!err, `4 minutes of play after migration without errors${err ? ': ' + err.stack : ''}`);
const fp = (x) => JSON.stringify([x.tick, x.cycle, x.res, x.stats, x.enemies.map((e) => [e.type, e.x.toFixed(3), e.hp.toFixed(3)]), x.rt.rng.getState()]);
check(fp(a) === fp(b) && fp(a) === fp(c), `migrated region plays deterministically (night ${a.cycle.night}, outcome ${a.outcome ? a.outcome.result : 'none'})`);

process.exit(ok ? 0 : 1);
