// The colony bot (gate 14.4 "Colony bot" from Stage 1a and "Balance report" from Stage 2; owner J).
//   node tools/colonybot.mjs [--stage=2|1b|1a] [--seeds=1-5] [--days=N] [--jobs=4] [--storyteller=id]
//                            [--json] [--out=FILE] [--verbose] [--twice]
//   node tools/colonybot.mjs --soak [--seeds=1] [--days=300] [--difficulty=warden] [--out=FILE]  (Stage 2 soak, 14.8 J)
//   node tools/colonybot.mjs --report [--from=FILE,FILE] [--jobs=4] [--out=FILE]  (balance report, 14.4)
//   node tools/colonybot.mjs --realm=<seed>:<rx>,<ry> | --biomes=all [--seeds=5] [--days=60] | --realm-det  (Stage W2, see "Stage W2" below)
//   node tools/colonybot.mjs --bot=v3 [--seeds=1-5] [--days=30] [--jobs=3] [--twice] [--out=FILE]  (Stage Z1, EMBERCROWN-FORTRESS.md 8.3 E12)
// Bot v3 (tools/lib/bot3.mjs): v2's policy on the surface of a 128 x 128 x 20 fortress plus the deep plan (a stair
// shaft to -6, bedrooms on -2, a workshop hall on -3, a store at the shaft foot). Exit 0 when every seed meets the
// Z1 gate rows (8.3 "Z1 gate" item 1: alive, the shaft, roofed rooms on 3 levels, a bench below -2, raids, no
// starvation, idle, haul latency) and the save is < 85 KB at the end.
// Bots: v2 (Stage 2, the default: a role-and-bill policy, tools/lib/bot2.mjs, 100 days), v1 (--stage=1b:
// the scripted first nights, 10 days), v0 (--stage=1a: the scripted sandbox, 5 days); their players,
// meters and targets live in tools/lib/bot.mjs and tools/lib/bot2.mjs (browser-safe).
// Exit codes. v0/v1: 0 when every seed meets every target of its stage (1a: doc 14.6; 1b: the
// Stage 1 gate, 14.7). v2: 0 when the bot itself holds on every seed: it plays the whole run (100 days
// by default) with no exception and a valid state at the end. What it measures (the colony's survival,
// E idle and hauling, F mood, G tiers, H majors, warnings and nemeses, K herd) is printed per seed and
// as a table over the seeds with each row's owner (14.8), and does not change the exit code.
// --soak: 0 when the 14.8 J soak holds (save < 100 KB, stacks < 2,500, no growth beyond caps, tick
// p95 < 1.0 ms at day 300). --report: 0 when the 14.4 balance targets hold (XP ranks; the threat mix
// per storyteller and the stack and save-size series are reported).
// --jobs=N runs seeds in N child processes (same results: each seed is its own deterministic run).
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { runBot, TARGETS_1A, TARGETS_1B } from './lib/bot.mjs';
import { runBot2, summarise2, judgeSoak, balanceReport, TARGETS_2, SOAK } from './lib/bot2.mjs';
export * from './lib/bot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out', 'colonybot');

function parseSeeds(v) {
  const out = [];
  for (const part of String(v).split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let k = +m[1]; k <= +m[2]; k++) out.push(k); else if (part) out.push(isNaN(+part) ? part : +part);
  }
  return out;
}
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`)); if (a) return a.slice(k.length + 3);
  const i = process.argv.indexOf(`--${k}`); return i > 0 && process.argv[i + 1] !== undefined && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const has = (f) => process.argv.includes(f);
const save = (file, obj) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(obj, null, 1)); };

/** One v2 seed, in this process: the plain result (no state). */
async function v2Seed(seed, days, { storyteller = null, soak = false, difficulty = null } = {}) {
  const { saveBlob } = await import('../js/game/save/colonysave.js');
  // progress on stderr every 25 days (a soak runs for minutes)
  const onDay = (s, d, row) => { if (d % 25 === 0 && (soak || has('--progress'))) process.stderr.write(`  [seed ${seed}${storyteller ? ' ' + storyteller : ''}${difficulty ? ' ' + difficulty : ''}] day ${d}: ${row.alive}/${row.total} colonists, ${row.stacks} stacks, tier ${row.tier}, tick p95 ${row.tickP95} ms${row.blobKB !== undefined ? `, ${row.blobKB} KB` : ''}\n`); };
  const r = await runBot2({ seed, days, storyteller, difficulty, blobFn: saveBlob, blobEvery: soak ? 10 : 25, tickP95At: soak ? 2400 : 0, onDay });
  let blobKB = null;
  try { blobKB = +((await saveBlob(r.s)).length / 1024).toFixed(1); } catch (_) { /* reported as null */ }
  const out = { seed, days, storyteller, difficulty, ok: r.ok, hash: r.hash, ms: r.ms, commands: r.log.length, refused: r.refused.length, refusedTop: topRefused(r.refused), blobKB, notes: r.notes.slice(-40), metrics: r.metrics };
  if (soak) out.soak = judgeSoak(r);
  return out;
}
/** One v3 seed (Stage Z1), in this process: the plain result. */
async function v3Seed(seed, days) {
  const { saveBlob } = await import('../js/game/save/colonysave.js');
  const { runBot3, TARGETS_Z1 } = await import('./lib/bot3.mjs');
  const onDay = (s, d, row) => { if (d % 10 === 0 && has('--progress')) process.stderr.write(`  [v3 seed ${seed}] day ${d}: ${row.alive}/${row.total} colonists, tick p95 ${row.tickP95} ms\n`); };
  const r = await runBot3({ seed, days, onDay });
  let blobKB = null;
  try { blobKB = +((await saveBlob(r.s)).length / 1024).toFixed(1); } catch (e) { blobKB = null; }
  const checks = r.z1.checks.slice();
  checks.push({ name: `save < ${TARGETS_Z1.saveKB} KB`, ok: blobKB !== null && blobKB < TARGETS_Z1.saveKB, detail: `${blobKB} KB at day ${days}` });
  const v2bad = r.metrics.checks.filter((c) => !c.ok && !c.info && !c.na).map((c) => `${c.name}: ${c.detail}`);
  if (v2bad.length) checks.push({ name: 'the bot ran clean', ok: false, detail: v2bad.join('; ') });
  return { seed, days, bot: 'v3', ok: checks.every((c) => c.ok || c.info), hash: r.hash, ms: r.ms, commands: r.log.length, refused: r.refused.length, refusedTop: topRefused(r.refused), blobKB, checks, z1: { ...r.z1, checks: undefined }, deepNotes: r.deepNotes, tickP95: Math.max(...r.metrics.series.map((x) => x.tickP95 || 0)) };
}
/** One v4 seed (Stage Z2), in this process: the plain result. */
async function v4Seed(seed, days) {
  const { saveBlob } = await import('../js/game/save/colonysave.js');
  const { runBot4, TARGETS_Z2 } = await import('./lib/bot4.mjs');
  const onDay = (s, d, row) => { if (d % 25 === 0 && has('--progress')) process.stderr.write(`  [v4 seed ${seed}] day ${d}: ${row.alive}/${row.total} colonists, tick p95 ${row.tickP95} ms\n`); };
  // Stage Z3 (Z3.6): the same bot with every Z3 system on (deep causes, cavern packs, the Lamplost, breaches, great
  // beasts, fluids and water control); the fluid active set is read at every tick
  const z3 = arg('stage', '2') === 'z3';
  const { activeCount } = await import('../js/game/world/fluids.js');
  let fluidMax = 0, fluidAt = 0;
  const onTick = z3 ? (s) => { const n = activeCount(s); if (n > fluidMax) { fluidMax = n; fluidAt = Math.floor(s.tick / 14400); } } : null;
  const r = await runBot4({ seed, days, onDay, onTick, tickP95At: 0 });
  let blobKB = null;
  try { blobKB = +((await saveBlob(r.s)).length / 1024).toFixed(1); } catch (e) { blobKB = null; }
  const z1 = r.z1.checks.filter((c) => c.name === 'colony alive' || c.name === 'zero starvation deaths');
  // tick p95: the day-200 hold (the largest), as the soak reads it; the worst single day is reported beside it
  const ser = r.metrics.series.filter((x) => x.tickP95 !== undefined), tickP95 = ser.length ? ser[ser.length - 1].tickP95 : null, tickWorst = Math.max(0, ...ser.map((x) => x.tickP95 || 0));
  if (z3) return z3Result(seed, days, r, blobKB, tickP95, tickWorst, z1, fluidMax, fluidAt);
  const checks = z1.concat(r.z2.checks);
  checks.push({ name: `save < ${TARGETS_Z2.saveKB} KB`, ok: blobKB !== null && blobKB < TARGETS_Z2.saveKB, detail: `${blobKB} KB at day ${days}` });
  const xp = r.metrics.xp || {};
  checks.push({ name: 'no level 20 before day 100 (R2)', ok: xp.firstGrandmaster === null || xp.firstGrandmaster === undefined || xp.firstGrandmaster >= 100, detail: `first level 20: ${xp.firstGrandmaster ?? 'none'}; first Master ${xp.firstMaster ?? 'none'}` });
  checks.push({ name: `tick p95 < ${TARGETS_Z2.tickP95} ms`, ok: tickP95 !== null && tickP95 < TARGETS_Z2.tickP95, detail: `${tickP95} ms on the last day (worst day ${tickWorst} ms; seeds run side by side)` });
  const v2bad = r.metrics.checks.filter((c) => !c.ok && !c.info && !c.na).map((c) => `${c.name}: ${c.detail}`);
  if (v2bad.length) checks.push({ name: 'the bot ran clean', ok: false, detail: v2bad.join('; ') });
  return { seed, days, bot: 'v4', ok: checks.every((c) => c.ok || c.share || c.info || c.na), hash: r.hash, ms: r.ms, commands: r.log.length, refused: r.refused.length, refusedTop: topRefused(r.refused), blobKB, checks, z2: r.z2.report, deepNotes: r.deepNotes, tickP95, metrics: { colonists: r.metrics.colonists, deathCauses: r.metrics.deathCauses, xp: r.metrics.xp || null } };
}
// ---- Stage Z3 (EMBERCROWN-FORTRESS.md 8.5, step Z3.6): the 300-day soak with every Z3 system on ----------------
export const TARGETS_Z3 = Object.freeze({ days: 300, saveKB: 130, stacks: 2500, tickP95: 1.2, fluidMax: 4096 });
const DEEP_INC = ['cavern_pack', 'lamplost_thieves', 'lamplost_trade', 'great_beast', 'breach', 'seep_breach', 'river_breach'];
function z3Result(seed, days, r, blobKB, tickP95, tickWorst, z1, fluidMax, fluidAt) {
  const T = TARGETS_Z3, s = r.s, m = r.metrics;
  const peak = Math.max(0, ...m.series.map((x) => x.stacks || 0));
  const gb = (s.st && s.st.gb && s.st.gb.b) || {};
  const met = Object.values(gb).reduce((a, x) => a + (x.met || 0), 0), slain = Object.values(gb).filter((x) => x.slain >= 0).length, kinds = Object.values(gb).filter((x) => x.met > 0).length;
  const majors = m.majors || [];
  const deep = majors.filter((x) => DEEP_INC.includes(x.inc) || /cavern|lamplost|breach|beast/.test(x.inc));
  const warnMin = deep.length ? Math.min(...deep.map((x) => (x.warnH === null || x.warnH === undefined ? 99 : x.warnH))) : null;
  const beastDeaths = Object.entries(m.deathCauses || {}).filter(([k]) => /beast|wyrm|colossus|king/.test(k)).reduce((a, [, v]) => a + v, 0);
  const checks = z1.concat([
    { name: `save < ${T.saveKB} KB`, ok: blobKB !== null && blobKB < T.saveKB, detail: `${blobKB} KB at day ${days}` },
    { name: `item stacks < ${T.stacks}`, ok: peak < T.stacks, detail: `peak ${peak}, ${m.stacks} at the end` },
    { name: `tick p95 < ${T.tickP95} ms`, ok: tickP95 !== null && tickP95 < T.tickP95, detail: `${tickP95} ms on the last day (worst day ${tickWorst} ms; seeds run side by side)` },
    { name: `fluid active set < ${T.fluidMax} at every tick`, ok: fluidMax < T.fluidMax, detail: `max ${fluidMax} (day ${fluidAt})` },
    { name: 'deep threats warned >= 6 h (info)', ok: warnMin === null || warnMin >= 6, info: true, detail: `${deep.length} deep incidents, least warning ${warnMin} h` },
    { name: 'great beasts met (info)', ok: true, info: true, detail: `${met} visits by ${kinds} beasts, ${slain} slain, ${beastDeaths} deaths to beasts` },
  ]);
  const bad = m.checks.filter((c) => !c.ok && !c.info && !c.na).map((c) => `${c.name}: ${c.detail}`);
  // the Z2 rows over 300 days are reported (their day targets are the 200-day run's)
  const z2info = r.z2.checks.map((c) => ({ ...c, name: `Z2 ${c.name}`, info: true }));
  if (bad.length) z2info.push({ name: 'Z2 the bot ran clean', ok: false, info: true, detail: bad.join('; ') });
  const all = checks.concat(w0Rows(r, days), z2info);
  return { seed, days, bot: 'v4', stage: 'z3', ok: checks.every((c) => c.ok || c.info), hash: r.hash, haul: m.haul || null, tickP95Worst: tickWorst, ms: r.ms, commands: r.log.length, refused: r.refused.length, refusedTop: topRefused(r.refused), blobKB, checks: all, z2: r.z2.report, deepNotes: r.deepNotes, tickP95,
    z3: { fluidMax, stacksPeak: peak, beastsMet: met, beastKinds: kinds, beastsSlain: slain, beastDeaths, deep: deep.length, deepIncs: deep.map((x) => `${x.inc}@${x.day}`).slice(0, 12) },
    metrics: { colonists: m.colonists, deathCauses: m.deathCauses, xp: m.xp || null } };
}
// ---- Stage W0 (EMBERCROWN-WORLD.md 12.2, step W0.5): bot v4's rows for the Z2 systems in the Z3 run ---------------
// The Z2 answers (artifacts, the winch, petitions, halls) are rows of their own in the Z3 run, read at the run's length:
// the Z2 targets are 200-day targets (artifacts 2-4 by day 200, halls and petitions by day 150), so a run shorter than
// the target day reads them pro rata (at least one artifact and one accepted petitioner, a tavern and one other hall
// by the run's last day); the winch keeps its own day (50 uses by day 100). Each row holds on its share of the seeds.
export const W0_ROWS = Object.freeze({ winchUses: 50, winchBy: 100 });
function w0Rows(r, days) {
  const z = r.z2.report, f = z.first || {};
  const by = (k, d) => f[k] !== undefined && f[k] <= d;
  const short = days < 200, hallDay = Math.min(150, days), art = short ? Math.max(1, Math.floor(2 * days / 200)) : 2, pet = days < 150 ? Math.max(1, Math.floor(2 * days / 150)) : 2;
  const winch = (r.deepNotes || []).find((n) => /winch/.test(n)) || '';
  return [
    { name: `v4 artifacts: >= ${art} by day ${Math.min(200, days)} (W0.5, 4 of 5)`, ok: (z.artifacts | 0) >= art && (z.artifacts | 0) <= 4, share: true, detail: `${z.artifacts | 0} artifacts` },
    { name: `v4 the winch: >= ${W0_ROWS.winchUses} uses by day ${W0_ROWS.winchBy} (W0.5, 4 of 5)`, ok: days < W0_ROWS.winchBy || by('winch50', W0_ROWS.winchBy), share: true, na: days < W0_ROWS.winchBy, detail: `${z.winchUses} uses${f.winch50 !== undefined ? `, 50 on day ${f.winch50}` : ''}${winch ? `; ${winch}` : ''}` },
    { name: `v4 petitions: >= ${pet} accepted by day ${Math.min(150, days)} (W0.5, 4 of 5)`, ok: z.petitions && z.petitions.yes >= pet, share: true, detail: z.petitions ? `${z.petitions.yes} yes of ${z.petitions.asked}` : '?' },
    { name: `v4 halls: a tavern and one other hall by day ${hallDay} (W0.5, 4 of 5)`, ok: by('hall2', hallDay), share: true, detail: `tavern ${f.tavern === undefined ? 'never' : 'day ' + f.tavern}, two halls ${f.hall2 === undefined ? 'never' : 'day ' + f.hall2}` },
  ].map((c) => ({ ...c, ok: !!c.ok }));
}
/** The W0.5 rows over the seeds (share rows: met on `N of 5` seeds), the haul latency and the tick p95 against w0.json. */
function w0Summary(results) {
  const R = results.filter((r) => r.checks), names = [...new Set(R.flatMap((r) => r.checks.filter((c) => c.share && c.name.startsWith('v4 ')).map((c) => c.name)))];
  const rows = names.map((name) => {
    const cs = R.map((r) => r.checks.find((c) => c.name === name)).filter(Boolean);
    const m = name.match(/(\d) of 5/), need = m ? Math.min(+m[1], cs.length) : cs.length, met = cs.filter((c) => c.ok).length, na = cs.every((c) => c.na);
    return { name, met, of: cs.length, need, ok: na || met >= need, na };
  });
  const v = (f) => R.map(f).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const hm = v((r) => (r.haul ? r.haul.medianH : null)), mid = (a) => (a.length ? a[(a.length - 1) >> 1] : null), mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
  let base = null;
  try { const w = JSON.parse(readFileSync(join(HERE, 'out', 'w0.json'), 'utf8')); base = w.summary && w.summary.haulMedianH ? { medianOfSeeds: w.summary.haulMedianH.medianOfSeeds, mean: w.summary.haulMedianH.mean, commit: w.commit } : null; } catch (_) { base = null; }
  const haul = { medianOfSeeds: mid(hm), mean: mean(hm), perSeed: R.map((r) => [r.seed, r.haul ? r.haul.medianH : null]), w0: base,
    lowerPct: base && mid(hm) !== null ? +(100 * (1 - mid(hm) / base.medianOfSeeds)).toFixed(1) : null };
  const tick = { lastDayMax: Math.max(0, ...R.map((r) => r.tickP95 || 0)), worstDayMax: Math.max(0, ...R.map((r) => r.tickP95Worst || 0)) };
  const alive = R.filter((r) => r.metrics && r.metrics.colonists && r.metrics.colonists.alive > 0).length;
  return { rows, haul, tick, survival: { seedsAlive: alive, of: R.length, aliveMean: mean(R.map((r) => (r.metrics && r.metrics.colonists ? r.metrics.colonists.alive : 0))) } };
}

/** The Z3 balance report over the soak's seeds (printed; written into the --out file). */
function z3Balance(results) {
  const R = results.filter((r) => r.z3), n = R.length || 1, mean = (f) => +(R.reduce((a, r) => a + f(r), 0) / n).toFixed(2);
  const deaths = {}; for (const r of R) for (const [k, v] of Object.entries(r.metrics.deathCauses || {})) deaths[k] = (deaths[k] || 0) + v;
  return {
    seeds: R.map((r) => r.seed), alive: mean((r) => r.metrics.colonists.alive), peak: mean((r) => r.metrics.colonists.peak), deaths,
    beastsMet: mean((r) => r.z3.beastsMet), beastsMet2plus: R.filter((r) => r.z3.beastKinds >= 2).length, beastsSlain: mean((r) => r.z3.beastsSlain), beastDeathSeeds: R.filter((r) => r.z3.beastDeaths > 0).length,
    deepIncidents: mean((r) => r.z3.deep), fluidMax: Math.max(0, ...R.map((r) => r.z3.fluidMax)), saveKBMax: Math.max(0, ...R.map((r) => r.blobKB || 0)), tickP95Max: Math.max(0, ...R.map((r) => r.tickP95 || 0)),
  };
}
const topRefused = (list) => { const m = new Map(); for (const [, t, why] of list) { const k = `${t}: ${why}`; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8); };

/** Seeds in parallel child processes (each runs `--one`), or in this process when jobs <= 1. */
async function v2Seeds(seeds, days, { jobs = 1, storyteller = null, soak = false, difficulty = null } = {}) {
  if (jobs <= 1 || seeds.length <= 1) { const out = []; for (const sd of seeds) out.push(await v2Seed(sd, days, { storyteller, soak, difficulty })); return out; }
  const results = new Array(seeds.length);
  let next = 0;
  const one = (k) => new Promise((resolve) => {
    const file = join(OUT_DIR, `.seed-${process.pid}-${k}.json`);
    const args = [fileURLToPath(import.meta.url), '--one', `--seeds=${seeds[k]}`, `--days=${days}`, `--out=${file}`, ...(storyteller ? [`--storyteller=${storyteller}`] : []), ...(soak ? ['--soak'] : []), ...(difficulty ? [`--difficulty=${difficulty}`] : [])];
    if (arg('bot', 'v2') === 'v3') args.push('--bot=v3');
    if (arg('bot', 'v2') === 'v4') args.push('--bot=v4');
    if (arg('stage', '2') === 'z3') args.push('--stage=z3');
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', () => { try { results[k] = JSON.parse(readFileSync(file, 'utf8')); unlinkSync(file); } catch (e) { results[k] = { seed: seeds[k], ok: false, error: `child failed: ${e.message}`, metrics: null }; } resolve(); });
  });
  const worker = async () => { while (next < seeds.length) { const k = next++; await one(k); } };
  await Promise.all(Array.from({ length: Math.min(jobs, seeds.length) }, worker));
  return results;
}

function printV2(results, days) {
  for (const r of results) {
    if (!r.metrics) { console.log(`FAIL seed ${r.seed}: ${r.error}`); continue; }
    const m = r.metrics;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} seed ${r.seed}${r.storyteller ? ` (${r.storyteller})` : ''}: ${days} days in ${r.ms} ms, ${r.commands} commands (${r.refused} refused), hash ${r.hash}, blob ${r.blobKB} KB`);
    for (const c of m.checks) console.log(`      ${c.ok ? 'ok  ' : c.na ? 'n/a ' : c.info ? 'info' : 'FAIL'} ${c.name}: ${c.detail}`);
    if (has('--verbose')) {
      console.log('      research', m.research.join(','));
      console.log('      deaths', JSON.stringify(m.deaths));
      console.log('      majors', JSON.stringify(m.majors.map((x) => [x.inc, x.day, x.warnH, x.result])));
      console.log('      refused', JSON.stringify(r.refusedTop));
      for (const n of r.notes) console.log('      note', n);
    }
  }
}
function printSummary(rows) {
  const w = Math.max(...rows.map((x) => x.name.length));
  console.log('\nStage 2 rows measured by the bot (14.8; owner, result over the seeds):');
  for (const x of rows) console.log(`  ${x.ok ? 'ok  ' : x.enforced ? 'FAIL' : 'miss'} [${x.owner}] ${x.name.padEnd(w)}  ${x.detail}`);
}

// ---- Stage W2 (EMBERCROWN-WORLD.md 12.4, step W2.9): bot v4 in world regions -------------------------------------
//   node tools/colonybot.mjs --realm=<worldSeed>:<rx>,<ry> [--days=60] [--twice]      one hold founded in that region
//   node tools/colonybot.mjs --biomes=all|<id,id> [--seeds=5] [--days=60] [--jobs=3] [--out=FILE]
//   node tools/colonybot.mjs --realm-det [--days=6]                                   the realm determinism scene
// A realm hold is founded as the game founds it (setup.js foundColony({ realm, rx, ry }): the region's hold seed (G2),
// opts.region into mapgen3 (GEN3 v2), s.realm) and played by bot v4's whole policy (runBot4's composition, with this
// founding in place of foundFortress). --biomes picks, for each of the 12 region biomes, 5 holds: in the first 5
// worlds (world seed 1 up) that have an embarkable region of that biome, the region first in hash32(seed, rx, ry,
// 'w2bot') order. The W0 reference is bot v4 on realm-less holds, seeds 1-5, for the same days; its hashes at the
// checkpoint days must equal tools/out/baseline-w0.json (the legacy-hash rule), so it is the W0 run itself.
// Oracle (12.4 W2.9): survival = the mean of the colonists alive at the last day over a biome's 5 holds, against the
// same mean of the W0 reference: greenvale, elderwood, shore, fen and moor within 10 % of W0 (>= 90 %), the harsh
// seven >= 70 %. A biome below its row fails the run (a balance request to G, never a waiver). Exit 0 when every
// row holds and every run plays clean.
export const W2_MILD = Object.freeze(['greenvale', 'elderwood', 'shore', 'fen', 'moor']);
export const W2_HARSH = Object.freeze(['tundra', 'saltflat', 'ashlands', 'ruins', 'highcrag', 'redscar', 'taiga']);
export const W2_ROWS = Object.freeze({ mild: 0.9, harsh: 0.7, days: 60, seeds: 5 });
const W2_CHECK_DAYS = [1, 2, 5, 10, 20, 30, 60, 90, 120];
let realmCache = null;
async function realmOf(wseed, history = false) {
  if (realmCache && realmCache.seed === wseed && realmCache.history === history) return realmCache.realm;
  const { buildRealm } = await import('../js/game/realm/gen.js');
  realmCache = { seed: wseed, history, realm: buildRealm({ seed: wseed }, history ? { history: true } : undefined) };
  return realmCache.realm;
}
/** The founding of a realm hold for the bot: foundColony in the region, then the bot's two speed rows (bot3 foundFortress).
 *  `record` (W3.3a): the world is built with history and its decoded record sits in s.rt.realm (9.3 step 5). */
async function realmFounder(wseed, rx, ry, record = false) {
  const [{ installSim, foundColony }, { coverRebuild, skyZRebuild }] = await Promise.all([import('../js/game/core/setup.js'), import('../js/game/world/vertical.js')]);
  const realm = await realmOf(wseed, record);
  return (_sd, { storyteller = null, difficulty = null } = {}) => {
    installSim({ stage: '2' });
    const s = foundColony({ name: `Bot Hold ${wseed}:${rx},${ry}`, realm, rx, ry, d: 20, storyteller, difficulty });
    if (!s.rt.cover) s.rt.cover = coverRebuild(s);
    if (!s.rt.skyZ) s.rt.skyZ = skyZRebuild(s);
    if (record) s.rt.realm = realm;
    return s;
  };
}
/** bot v4 (tools/lib/bot4.mjs runBot4) on a realm hold: the same composition, founded by realmFounder. */
async function runBot4Realm({ wseed, rx, ry, days = W2_ROWS.days, onDay = null, record = false, onTick = null } = {}) {
  const [{ runBot2 }, b3, b4, { setBotLevel }] = await Promise.all([import('./lib/bot2.mjs'), import('./lib/bot3.mjs'), import('./lib/bot4.mjs'), import('./lib/bot.mjs')]);
  const found = await realmFounder(wseed, rx, ry, record);
  const R = record ? await realmOf(wseed, true) : null;
  let deep = null, X3 = null, z2 = null;
  const X4 = b4.makeMeter4();
  const r = await runBot2({
    seed: wseed, days, difficulty: b4.DIFFICULTY4,
    onDay: (s, d, row) => { X4.onDay(s, d); if (onDay) onDay(s, d, row); },
    found,
    wrap: (s, base) => { deep = b3.makeDeep(s, base); X3 = b3.makeMeter3(s); z2 = b4.makeZ2(s, deep, base); return z2; },
    onTick: (s) => { if (R && s.rt.realm !== R) s.rt.realm = R; X3.onTick(s); if (onTick) onTick(s); },
  });
  r.z1 = b3.evaluate3(r.s, r, X3.X, deep, days);
  r.z2 = b4.evaluate4(r.s, r, X4, z2, days);
  r.deepNotes = deep.D3.notes.concat(z2.Z.notes);
  r.bot = 'v4';
  setBotLevel(0);
  return r;
}
/** One W2 run in this process: a realm hold (spec { wseed, rx, ry, biome }) or the W0 reference (spec { legacy: seed }). */
async function w2Run(spec, days) {
  const [{ stateHash }] = await Promise.all([import('../js/game/core/state.js')]);
  const marks = new Set(W2_CHECK_DAYS.filter((d) => d <= days).concat([days]));
  const hashes = {};
  const onDay = (s, d) => { if (marks.has(d)) hashes[d] = stateHash(s); };
  let r;
  // W3.3a (spec.record): the realm caravans seen, by visit id: [tick, site, fac, barge]
  const arrivals = [], seenV = new Set();
  const onTick = spec.record ? (s) => { const t = s.colony.trade; if (t && t.visits.length) for (const v of t.visits) if (!seenV.has(v.id)) { seenV.add(v.id); arrivals.push([s.tick, Number.isInteger(v.site) ? v.site : null, v.fac || null, v.barge === true]); } } : null;
  if (spec.legacy !== undefined) { const { runBot4 } = await import('./lib/bot4.mjs'); r = await runBot4({ seed: spec.legacy, days, onDay }); }
  else r = await runBot4Realm({ ...spec, days, onDay, onTick });
  const m = r.metrics;
  const errors = m.checks.filter((c) => !c.ok && !c.info && !c.na && /exception|state valid/.test(c.name)).map((c) => `${c.name}: ${c.detail}`);
  const s = r.s;
  return {
    ...spec, days, hash: r.hash, hashes, ms: r.ms, errors, holdSeed: s.seed >>> 0, realm: s.realm ? { wid: s.realm.wid, rx: s.realm.rx, ry: s.realm.ry, biome: s.realm.embark && s.realm.embark.biome } : null,
    alive: m.colonists.alive, total: m.colonists.total, peak: m.colonists.peak, fallen: s.colony.fallen === true, deathCauses: m.deathCauses,
    hamletDay: m.hamletDay ?? null, tickP95: Math.max(0, ...(m.series || []).map((x) => x.tickP95 || 0)), commands: r.log.length, refused: r.refused.length,
    ...(spec.record ? { w3: await w3Caravans(s, arrivals, spec.wseed) } : {}),
  };
}
/**
 * W3.3a: a realm hold's caravans against travel days. Every arrival must come from a town in reach (a row of
 * trade.sites); for each site, the gap between two arrivals must be its cadence (caravans.js cadenceDays of its travel
 * days) +-1 day, unless the site stopped being a source in between (a gap longer by more than a day while the site was
 * out: counted as `paused`, never early). The first arrival of a site that was a source from the start: max(4, days) +-1.
 */
async function w3Caravans(s, arrivals, wseed) {
  const [{ travelField, cadenceDays, REALM_CARAVAN }, { TICKS_PER_DAY: D, START_TICK }] = await Promise.all([import('../js/game/colony/caravans.js'), import('../js/game/core/time.js')]);
  const R = await realmOf(wseed, true), tf = travelField(R, s.realm.rx, s.realm.ry, REALM_CARAVAN.reach);
  const bySite = new Map(), bad = [];
  let legacy = 0, ok = 0, early = 0, late = 0, firstOk = 0, firsts = 0;
  for (const [tick, site] of arrivals) { if (site === null) { legacy++; continue; } (bySite.get(site) || bySite.set(site, []).get(site)).push(tick); }
  for (const [site, ticks] of bySite) {
    const x = R.tables.sites[site], days = tf[x.y * R.n + x.x], cad = cadenceDays(days);
    if (!(days <= REALM_CARAVAN.reach)) { bad.push(`site ${site} at ${days} days`); continue; }
    firsts++;
    const f0 = (ticks[0] - START_TICK) / D, want = Math.max(REALM_CARAVAN.first, Math.ceil(days));
    if (Math.abs(f0 - want) <= 1) firstOk++;
    for (let k = 1; k < ticks.length; k++) {
      const g = (ticks[k] - ticks[k - 1]) / D;
      if (g < cad - 1) { early++; bad.push(`site ${site} gap ${g.toFixed(2)} < cadence ${cad}`); } else if (g <= cad + 1) ok++; else late++;
    }
  }
  const b = s.realm.bind || {};
  return { arrivals: arrivals.length - legacy, legacy, sites: bySite.size, gapsOk: ok, early, paused: late, firstOk, firsts, bound: ['hearthwatch', 'league', 'gutterkin', 'ashfang', 'pilgrims'].filter((k) => Number.isInteger(b[k])).length, bind: b, stand: (s.realm.stand || []).length, bad: bad.slice(0, 4) };
}
/** The 5 holds of each biome (see the header). */
async function w2Picks(biomes, per) {
  const [{ idx, isEmbarkable }, { regionOpts }, { hash32 }] = await Promise.all([import('../js/game/realm/query.js'), import('../js/game/realm/region.js'), import('../js/game/core/rand.js')]);
  const want = new Map(biomes.map((b) => [b, []]));
  for (let wseed = 1; wseed <= 60 && [...want.values()].some((a) => a.length < per); wseed++) {
    const realm = await realmOf(wseed), best = new Map();
    for (let ry = 0; ry < realm.n; ry++) for (let rx = 0; rx < realm.n; rx++) {
      if (!isEmbarkable(realm, idx(realm, rx, ry))) continue;
      const b = regionOpts(realm, rx, ry).biome;
      if (!want.has(b) || want.get(b).length >= per) continue;
      const k = hash32(wseed, rx, ry, 'w2bot') >>> 0, o = best.get(b);
      if (!o || k < o.k) best.set(b, { k, rx, ry });
    }
    for (const [b, o] of best) want.get(b).push({ biome: b, wseed, rx: o.rx, ry: o.ry });
  }
  return want;
}
/** Run specs in `jobs` child processes (each spec is its own deterministic run); results in spec order. */
async function w2Pool(specs, days, jobs) {
  const results = new Array(specs.length);
  mkdirSync(OUT_DIR, { recursive: true });
  let next = 0;
  const one = (k) => new Promise((resolve) => {
    const file = join(OUT_DIR, `.w2-${process.pid}-${k}.json`);
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--w2-one', `--spec=${JSON.stringify(specs[k])}`, `--days=${days}`, `--out=${file}`], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (code) => { try { results[k] = JSON.parse(readFileSync(file, 'utf8')); unlinkSync(file); } catch (e) { results[k] = { ...specs[k], days, failed: `child exit ${code}: ${e.message}` }; } resolve(); });
  });
  const worker = async () => { while (next < specs.length) { const k = next++; await one(k); if (has('--progress')) process.stderr.write(`  [w2] ${k + 1}/${specs.length} ${JSON.stringify(specs[k])}\n`); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, specs.length)) }, worker));
  return results;
}
const meanOf = (v) => (v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null);
/** --biomes: the W2 gate rows (12 biomes x 5 holds x 60 days against the W0 reference). */
async function w2Biomes() {
  const { REALM_BIOMES } = await import('../js/data/realm/biomes.js');
  const all12 = REALM_BIOMES.filter((b) => b.embark).map((b) => b.id);
  const a = arg('biomes', 'all'), biomes = a === 'all' ? all12 : a.split(',').filter(Boolean);
  for (const b of biomes) if (!all12.includes(b)) { console.error(`colonybot: unknown biome ${b} (${all12.join(', ')})`); process.exit(2); }
  const per = +arg('seeds', W2_ROWS.seeds), days = +arg('days', W2_ROWS.days), jobs = +arg('jobs', 3), t0 = Date.now();
  const picks = await w2Picks(biomes, per);
  const specs = [];
  for (let k = 1; k <= 5; k++) specs.push({ legacy: k });
  for (const b of biomes) specs.push(...picks.get(b));
  const res = await w2Pool(specs, days, jobs);
  const ref = res.filter((r) => r.legacy !== undefined), holds = res.filter((r) => r.legacy === undefined);
  // the reference is W0 itself: its checkpoint hashes equal baseline-w0.json (12.1)
  let base = null; try { base = JSON.parse(readFileSync(join(HERE, 'out', 'baseline-w0.json'), 'utf8')); } catch (_) { base = null; }
  const refBad = [];
  for (const r of ref) {
    if (r.failed) { refBad.push(`seed ${r.legacy}: ${r.failed}`); continue; }
    for (const [d, h] of Object.entries(r.hashes)) { const want = base && base.bot && base.bot[r.legacy] && base.bot[r.legacy][d]; if (want !== undefined && want !== h) refBad.push(`seed ${r.legacy} day ${d}: ${h} (baseline-w0 ${want})`); }
  }
  const w0Alive = meanOf(ref.filter((r) => !r.failed).map((r) => r.alive));
  const rows = [];
  for (const b of biomes) {
    const R = holds.filter((r) => r.biome === b), ok = R.filter((r) => !r.failed);
    const alive = meanOf(ok.map((r) => r.alive)), ratio = w0Alive ? +(alive / w0Alive).toFixed(3) : null;
    const harsh = !W2_MILD.includes(b), need = harsh ? W2_ROWS.harsh : W2_ROWS.mild;
    const clean = R.length === per && ok.length === per && ok.every((r) => !r.errors.length && r.realm && r.realm.biome === b);
    rows.push({ biome: b, kind: harsh ? 'harsh' : 'mild', need, holds: R.map((r) => `${r.wseed}:${r.rx},${r.ry}`), alive, ratio, standing: ok.filter((r) => r.alive > 0 && !r.fallen).length, of: R.length, clean, ok: clean && ratio !== null && ratio >= need, deaths: ok.reduce((m, r) => { for (const [c, n] of Object.entries(r.deathCauses || {})) m[c] = (m[c] || 0) + n; return m; }, {}), tickP95: Math.max(0, ...ok.map((r) => r.tickP95 || 0)), problems: R.flatMap((r) => (r.failed ? [r.failed] : r.errors)).slice(0, 4) });
  }
  const pass = !refBad.length && ref.length === 5 && rows.every((x) => x.ok);
  const json = { what: 'W2.9: bot v4 in world regions against the W0 reference (EMBERCROWN-WORLD.md 12.4)', days, per, rows: W2_ROWS, w0: { seeds: ref.map((r) => r.legacy), alive: ref.map((r) => r.alive), aliveMean: w0Alive, hashesMatchBaseline: !refBad.length, problems: refBad }, biomes: rows, pass, ms: Date.now() - t0, results: res };
  if (arg('out', null)) save(arg('out', null), json);
  console.log(`W0 reference (bot v4, realm-less seeds 1-5, ${days} days): alive ${ref.map((r) => r.alive).join(', ')} (mean ${w0Alive}); hashes ${refBad.length ? 'DIFFER from baseline-w0.json: ' + refBad.slice(0, 3).join('; ') : 'identical to baseline-w0.json'}`);
  for (const x of rows) console.log(`  ${x.ok ? 'ok  ' : 'FAIL'} ${x.biome.padEnd(9)} ${x.kind.padEnd(5)} alive ${String(x.alive).padStart(5)} = ${x.ratio === null ? '?' : (x.ratio * 100).toFixed(0) + ' %'} of W0 (needs >= ${x.need * 100} %), ${x.standing}/${x.of} standing, tick p95 ${x.tickP95} ms, holds ${x.holds.join(' ')}${Object.keys(x.deaths).length ? ', deaths ' + JSON.stringify(x.deaths) : ''}${x.problems.length ? ', ' + x.problems.join('; ') : ''}${!x.clean ? ' (not clean)' : ''}`);
  const low = rows.filter((x) => x.clean && !x.ok);
  if (low.length) console.log(`  balance request to G (12.4 W2.9): ${low.map((x) => `${x.biome} at ${(x.ratio * 100).toFixed(0)} %`).join(', ')}`);
  console.log(`colonybot w2 [${biomes.length} biomes x ${per} holds x ${days} days, ${((Date.now() - t0) / 60000).toFixed(1)} min]: ${rows.filter((x) => x.ok).length}/${rows.length} biome rows hold${pass ? ' - PASS' : ' - FAIL'}`);
  process.exit(pass ? 0 : 1);
}
/**
 * --realm=<worldSeed>:auto [--seeds=1-5] [--days=120] [--jobs=3] [--out=FILE] (W3.3a, EMBERCROWN-WORLD.md 12.5): bot v4
 * on hold k of each --seeds k in that world, built with history and its record loaded: the embarkable regions with a
 * caravan source in hash32(seed, rx, ry, 'w3bot') order, the k-th. Beside them, the W0 reference (realm-less seeds,
 * the same days) whose checkpoint hashes must equal baseline-w0.json. Oracle: the reference hashes are identical; every
 * hold binds the 5 roles; every caravan comes from a town within 12 travel days, no gap is early and the gaps and first
 * arrivals match the travel days +-1 (a gap is allowed to run long only while its site stopped being a source).
 */
async function w3Auto(wseed) {
  const days = +arg('days', 120), jobs = +arg('jobs', 3), t0 = Date.now();
  const seeds = parseSeeds(arg('seeds', '1-5'));
  const [{ idx, isEmbarkable }, { hash32 }, { realmField }, CV, { bindRoles }] = await Promise.all([import('../js/game/realm/query.js'), import('../js/game/core/rand.js'), import('../js/game/core/setup.js'), import('../js/game/colony/caravans.js'), import('../js/game/colony/factions.js')]);
  const realm = await realmOf(wseed, true), regions = [];
  for (let ry = 0; ry < realm.n; ry++) for (let rx = 0; rx < realm.n; rx++) if (isEmbarkable(realm, idx(realm, rx, ry))) regions.push({ rx, ry, k: hash32(wseed, rx, ry, 'w3bot') >>> 0 });
  regions.sort((a, b) => a.k - b.k || a.rx - b.rx || a.ry - b.ry);
  const picks = [];
  for (const g of regions) {
    if (picks.length >= Math.max(...seeds)) break;
    const probe = { realm: realmField(realm, g.rx, g.ry), rt: { realm }, colony: { factions: { league: 0, hearthwatch: 10, gutterkin: -20 } } };
    bindRoles(probe, realm);
    if (CV.caravanSources(probe, realm).length) picks.push(g);
  }
  const specs = seeds.map((k) => ({ legacy: k }));
  for (const k of seeds) if (picks[k - 1]) specs.push({ wseed, rx: picks[k - 1].rx, ry: picks[k - 1].ry, record: true, k });
  const res = await w2Pool(specs, days, jobs);
  let base = null; try { base = JSON.parse(readFileSync(join(HERE, 'out', 'baseline-w0.json'), 'utf8')); } catch (_) { base = null; }
  const refBad = [];
  let refChecked = 0;
  for (const r of res.filter((x) => x.legacy !== undefined)) {
    if (r.failed) { refBad.push(`seed ${r.legacy}: ${r.failed}`); continue; }
    for (const [d, h] of Object.entries(r.hashes)) { const want = base && base.bot && base.bot[r.legacy] && base.bot[r.legacy][d]; if (want === undefined) continue; refChecked++; if (want !== h) refBad.push(`seed ${r.legacy} day ${d}: ${h} (baseline-w0 ${want})`); }
  }
  const holds = res.filter((x) => x.legacy === undefined), rows = [];
  for (const r of holds) {
    const w = r.w3 || {};
    const okRow = !r.failed && !r.errors.length && w.bound === 5 && !w.early && !(w.bad || []).length && w.arrivals > 0 && w.firstOk === w.firsts;
    rows.push({ ok: okRow, r });
  }
  if (!refChecked) refBad.push('no baseline-w0.json checkpoint compared');
  const pass = !refBad.length && holds.length === seeds.length && rows.every((x) => x.ok);
  console.log(`W0 reference (bot v4, realm-less seeds ${seeds.join(',')}, ${days} days): alive ${res.filter((x) => x.legacy !== undefined).map((x) => x.alive).join(', ')}; hashes ${refBad.length ? 'DIFFER from baseline-w0.json: ' + refBad.slice(0, 3).join('; ') : 'identical to baseline-w0.json at ' + refChecked + ' seed-day checkpoints'}`);
  for (const { ok, r } of rows) {
    const w = r.w3 || {};
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} hold ${r.k} ${wseed}:${r.rx},${r.ry} (${r.realm && r.realm.biome}): ${r.alive}/${r.total} alive${r.fallen ? ', FALLEN' : ''}; roles bound ${w.bound}/5 ${JSON.stringify(w.bind)}, ${w.stand} c<n> rows; ${w.arrivals} caravans from ${w.sites} towns (${w.legacy} legacy), gaps on cadence +-1 ${w.gapsOk}, early ${w.early}, paused ${w.paused}, first arrivals on time ${w.firstOk}/${w.firsts}${r.failed ? ', ' + r.failed : ''}${(w.bad || []).length ? ', ' + w.bad.join('; ') : ''}${r.errors.length ? ', ' + r.errors.join('; ') : ''}`);
  }
  if (arg('out', null)) save(arg('out', null), { what: 'W3.3a: realm caravans and roles (EMBERCROWN-WORLD.md 12.5)', wseed, days, pass, refBad, results: res });
  console.log(`colonybot w3 realm ${wseed}:auto [${seeds.length} holds x ${days} days, ${((Date.now() - t0) / 60000).toFixed(1)} min]${pass ? ' - PASS' : ' - FAIL'}`);
  process.exit(pass ? 0 : 1);
}
/** --realm=<seed>:<rx>,<ry>: one realm hold. */
async function w2One() {
  if (/^\d+:auto$/.test(String(arg('realm', '')))) await w3Auto(+String(arg('realm', '')).split(':')[0]);
  const m = String(arg('realm', '')).match(/^(\d+):(\d+),(\d+)$/);
  if (!m) { console.error('colonybot: --realm=<worldSeed>:<rx>,<ry>'); process.exit(2); }
  const spec = { wseed: +m[1], rx: +m[2], ry: +m[3] }, days = +arg('days', W2_ROWS.days);
  const realm = await realmOf(spec.wseed);
  const [{ checkRegion }, { regionOpts }] = await Promise.all([import('../js/game/core/setup.js'), import('../js/game/realm/region.js')]);
  try { checkRegion(realm, spec.rx, spec.ry); } catch (e) { console.error(`colonybot: ${e.message}`); process.exit(2); }
  spec.biome = regionOpts(realm, spec.rx, spec.ry).biome;
  const r = await w2Run(spec, days);
  let same = null;
  if (has('--twice')) { const r2 = await w2Run(spec, days); same = r2.hash === r.hash && JSON.stringify(r2.hashes) === JSON.stringify(r.hashes); }
  if (arg('out', null)) save(arg('out', null), { ...r, twice: same });
  if (has('--json')) console.log(JSON.stringify(r));
  const ok = !r.errors.length && same !== false;
  console.log(`${ok ? 'ok  ' : 'FAIL'} realm ${spec.wseed}:${spec.rx},${spec.ry} (${spec.biome}, hold seed ${r.holdSeed}): ${days} days in ${r.ms} ms, ${r.commands} commands (${r.refused} refused), ${r.alive}/${r.total} alive (peak ${r.peak})${r.fallen ? ', FALLEN' : ''}, hash ${r.hash}${same === null ? '' : same ? ', twice identical' : ', twice DIFFERENT'}${r.errors.length ? ', ' + r.errors.join('; ') : ''}`);
  process.exit(ok ? 0 : 1);
}
/**
 * --realm-det: the realm determinism scene. A hold in world 1 is founded twice (identical hashes); bot v4 plays it
 * --days days twice (identical hashes at every day); at the end its save (EC3 with s.realm) reloads to the same hash and
 * both copies continue one game day to the same hash; and a realm-less hold of seed 1 still hashes as baseline-w0 day 1.
 */
async function w2Det() {
  const days = +arg('days', 6), t0 = Date.now(), bad = [], lines = [];
  const [{ stateHash }, { tick }, { saveBlob, loadBlob }, { regionOpts }] = await Promise.all([import('../js/game/core/state.js'), import('../js/game/core/sim.js'), import('../js/game/save/colonysave.js'), import('../js/game/realm/region.js')]);
  const picks = await w2Picks(['moor'], 1), p = picks.get('moor')[0];
  const found = await realmFounder(p.wseed, p.rx, p.ry);
  const a = found(), b = found();
  if (stateHash(a) !== stateHash(b)) bad.push('two foundings of one region differ'); else lines.push(`founded ${p.wseed}:${p.rx},${p.ry} (${regionOpts(await realmOf(p.wseed), p.rx, p.ry).biome}) twice: ${stateHash(a)}`);
  const run = async () => { const hs = []; const r = await runBot4Realm({ ...p, days, onDay: (s) => hs.push(stateHash(s)) }); return { r, hs }; };
  const x = await run(), y = await run();
  const diff = x.hs.findIndex((h, k) => h !== y.hs[k]);
  if (diff >= 0 || x.hs.length !== y.hs.length) bad.push(`bot runs differ from day ${diff + 1}`); else lines.push(`bot v4 ${days} days twice: identical at ${x.hs.length} days (${x.r.hash})`);
  const blob = await saveBlob(x.r.s), s2 = await loadBlob(blob);
  if (!s2.realm || stateHash(s2) !== stateHash(x.r.s)) bad.push(`reload: ${s2.realm ? 'hash differs' : 's.realm lost'}`);
  else {
    const end = x.r.s.tick + 14400;
    while (x.r.s.tick < end) tick(x.r.s);
    while (s2.tick < end) tick(s2);
    if (stateHash(s2) !== stateHash(x.r.s)) bad.push('save and reload then 1 day: hashes differ'); else lines.push(`save (${(blob.length / 1024).toFixed(1)} KB) and reload, then 1 day: identical (${stateHash(s2)})`);
  }
  let base = null; try { base = JSON.parse(readFileSync(join(HERE, 'out', 'baseline-w0.json'), 'utf8')); } catch (_) { base = null; }
  if (base) { const r = await w2Run({ legacy: 1 }, 1); if (r.hashes[1] !== base.bot[1][1]) bad.push(`realm-less seed 1 day 1: ${r.hashes[1]} (baseline-w0 ${base.bot[1][1]})`); else lines.push(`realm-less seed 1 day 1 hashes as baseline-w0 (${r.hashes[1]})`); }
  for (const l of lines) console.log('  ok   ' + l);
  for (const l of bad) console.log('  FAIL ' + l);
  console.log(`colonybot realm determinism [${((Date.now() - t0) / 1000).toFixed(0)} s]: ${bad.length ? 'FAIL' : 'PASS'}`);
  process.exit(bad.length ? 1 : 0);
}

// ---- CLI -------------------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stage = arg('stage', '2');
  const jobs = +arg('jobs', 1);
  const out = arg('out', null);
  const storyteller = arg('storyteller', null);
  // Stage W2 (W2.9): realm holds, the biome rows and the realm determinism scene (see "Stage W2" above)
  if (has('--w2-one')) { save(out, await w2Run(JSON.parse(arg('spec', '{}')), +arg('days', W2_ROWS.days))); process.exit(0); }
  if (arg('realm', null) !== null) await w2One();
  if (arg('biomes', null) !== null) await w2Biomes();
  if (has('--realm-det')) await w2Det();
  if (has('--one')) {
    // a child of --jobs: one v2 seed, written to --out
    const seed = parseSeeds(arg('seeds', '1'))[0];
    const r = arg('bot', 'v2') === 'v4' ? await v4Seed(seed, +arg('days', 200)) : arg('bot', 'v2') === 'v3' ? await v3Seed(seed, +arg('days', 30)) : await v2Seed(seed, +arg('days', 100), { storyteller, soak: has('--soak'), difficulty: arg('difficulty', null) });
    save(out, r);
    process.exit(0);
  }
  if (has('--soak')) {
    // (Stage 2.9b: the soak plays Warden, the difficulty a careful player should never lose on; any other
    // with --difficulty)
    const seeds = parseSeeds(arg('seeds', '1')), days = +arg('days', SOAK.days), difficulty = arg('difficulty', SOAK.difficulty);
    const results = await v2Seeds(seeds, days, { jobs, soak: true, difficulty });
    printV2(results, days);
    let ok = true;
    for (const r of results) {
      console.log(`\nsoak seed ${r.seed}, ${days} days (${difficulty}):`);
      for (const c of r.soak || [{ name: 'ran', ok: false, detail: r.error }]) { console.log(`  ${c.ok ? 'ok  ' : c.info ? 'info' : 'FAIL'} ${c.name}: ${c.detail}`); if (!c.ok && !c.info) ok = false; }
      if (r.metrics) for (const x of r.metrics.series.filter((y) => y.blobKB !== undefined)) console.log(`    day ${x.day}: ${x.alive}/${x.total} colonists, ${x.stacks} stacks, ${x.bld} buildings, ${x.blobKB} KB, wealth ${x.wealth}, tier ${x.tier}, tick p95 ${x.tickP95} ms`);
      if (r.metrics && r.metrics.tickProfile) { console.log(`  tick cost by system at day ${days} (mean / max ms over 2,400 ticks):`); for (const x of r.metrics.tickProfile) console.log(`    ${x.sys.padEnd(44)} ${x.meanMs}${x.maxMs === null ? '' : ' / ' + x.maxMs}`); }
      if (r.metrics) { const last = r.metrics.series.filter((y) => y.sizes).slice(-1)[0]; if (last) console.log(`  largest saved keys at day ${last.day}: ${Object.entries(last.sizes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)} KB`).join(', ')} (JSON, before deflate)`); }
    }
    if (out) save(out, { kind: 'soak', days, seeds, difficulty, targets: SOAK, ok, results });
    console.log(`colonybot soak [${days} days]: ${ok ? 'PASS' : 'FAIL'}`);
    process.exit(ok ? 0 : 1);
  }
  if (has('--report')) {
    // the 100-day bot on seeds 1-5 and the soak (from --from files when given, else run here), plus
    // the other two storytellers on seeds 1-2 for the threat mix
    const from = (arg('from', '') || '').split(',').filter(Boolean);
    let main = null, soak = null;
    for (const f of from) {
      if (!existsSync(f)) continue;
      const j = JSON.parse(readFileSync(f, 'utf8'));
      if (j.kind === 'soak') soak = j.results[0]; else if (j.bot === 'v2') main = j.results;
    }
    if (!main) main = await v2Seeds([1, 2, 3, 4, 5], TARGETS_2.days, { jobs: Math.max(1, jobs) });
    if (!soak && !has('--no-soak')) soak = (await v2Seeds([1], SOAK.days, { soak: true, difficulty: SOAK.difficulty }))[0];
    const others = [];
    for (const st of ['wandering', 'long_night']) others.push(...(await v2Seeds([1, 2], TARGETS_2.days, { jobs: Math.max(1, jobs), storyteller: st })).map((r) => ({ ...r, storyteller: st })));
    const { report, text } = balanceReport(main, soak, others);
    console.log(text);
    if (out) save(out, report);
    console.log(`colonybot balance report: ${report.ok ? 'PASS' : 'targets missed (see above; owners in brackets)'}`);
    process.exit(report.ok ? 0 : 1);
  }
  const seeds = parseSeeds(arg('seeds', '1-5'));
  if (stage === 'z3') {
    // Stage Z3 (Z3.6): bot v4 for 300 days on seeds 1-5 with every Z3 system on; the Z3 gate rows hold on every seed
    const days = +arg('days', TARGETS_Z3.days);
    const results = jobs <= 1 || seeds.length <= 1 ? await (async () => { const o = []; for (const sd of seeds) o.push(await v4Seed(sd, days)); return o; })() : await v2Seeds(seeds, days, { jobs });
    for (const r of results) {
      if (!r.checks) { console.log(`FAIL seed ${r.seed}: ${r.error}`); continue; }
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} seed ${r.seed}: ${days} days in ${r.ms} ms, ${r.commands} commands (${r.refused} refused), hash ${r.hash}, blob ${r.blobKB} KB, tick p95 ${r.tickP95} ms`);
      for (const c of r.checks) if (!c.info || !c.name.startsWith('Z2 ') || has('--verbose')) console.log(`      ${c.ok ? 'ok  ' : c.na ? 'n/a ' : c.info ? 'info' : c.share ? 'miss' : 'FAIL'} ${c.name}: ${c.detail}`);
      if (r.haul) console.log(`      haul latency: median ${r.haul.medianH} h (stored only ${r.haul.medianStoredH} h; ${r.haul.stored} stored, ${r.haul.stillWaiting} waiting); tick p95 ${r.tickP95} ms last day, ${r.tickP95Worst} ms worst day`);
      console.log(`      deep: ${(r.z3.deepIncs || []).join(', ')}`);
    }
    const bal = z3Balance(results);
    console.log('\nZ3 balance report: ' + JSON.stringify(bal));
    const w0 = w0Summary(results);
    console.log(`\nW0.5 rows (bot v4, seeds ${seeds.join(',')}):`);
    for (const x of w0.rows) console.log(`  ${x.na ? 'n/a ' : x.ok ? 'ok  ' : 'FAIL'} ${x.name}: ${x.met}/${x.of} (needs ${x.need})`);
    console.log(`  haul latency: median of the seeds ${w0.haul.medianOfSeeds} h (mean ${w0.haul.mean} h; ${w0.haul.perSeed.map(([sd, h]) => `${sd}: ${h}`).join(', ')})${w0.haul.w0 ? `; w0.json (${w0.haul.w0.commit}) ${w0.haul.w0.medianOfSeeds} h, ${w0.haul.lowerPct}% lower` : ''}`);
    console.log(`  tick p95: ${w0.tick.lastDayMax} ms on the last day, ${w0.tick.worstDayMax} ms on the worst day (max over the seeds${jobs > 1 ? `, ${jobs} at a time` : ''})`);
    const pass = results.every((r) => r.checks && r.ok) && w0.rows.every((x) => x.ok);
    if (out) save(out, { stage: 'z3', bot: 'v4', days, seeds, pass, balance: bal, w0, results });
    console.log(`colonybot z3 soak [${days} days, seeds ${seeds.join(',')}]: ${results.filter((r) => r.ok).length}/${results.length} seeds hold${pass ? ' - PASS' : ' - FAIL'}`);
    process.exit(pass ? 0 : 1);
  }
  if (arg('bot', 'v2') === 'v4' || stage === 'z2') {
    // Stage Z2 (Z2.11): bot v4 on fortresses for 200 days; each row holds on every seed unless it names its share
    // ("3 of 5"); info rows and rows not reached in the run (na) are reported only
    const days = +arg('days', 200);
    const results = jobs <= 1 || seeds.length <= 1 ? await (async () => { const o = []; for (const sd of seeds) o.push(await v4Seed(sd, days)); return o; })() : await v2Seeds(seeds, days, { jobs });
    if (has('--twice')) {
      const again = jobs <= 1 || seeds.length <= 1 ? await (async () => { const o = []; for (const sd of seeds) o.push(await v4Seed(sd, days)); return o; })() : await v2Seeds(seeds, days, { jobs });
      results.forEach((r, k) => { const ok = again[k].hash === r.hash && again[k].commands === r.commands; (r.checks || (r.checks = [])).push({ name: 'deterministic', ok, detail: `${r.hash} vs ${again[k].hash}` }); if (!ok) r.ok = false; });
    }
    for (const r of results) {
      if (!r.checks) { console.log(`FAIL seed ${r.seed}: ${r.error}`); continue; }
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} seed ${r.seed}: ${days} days in ${r.ms} ms, ${r.commands} commands (${r.refused} refused), hash ${r.hash}, blob ${r.blobKB} KB, tick p95 max ${r.tickP95} ms`);
      for (const c of r.checks) console.log(`      ${c.ok ? 'ok  ' : c.na ? 'n/a ' : c.info ? 'info' : c.share ? 'miss' : 'FAIL'} ${c.name}: ${c.detail}`);
      const z = r.z2 || {};
      console.log(`      report: renown [${(z.renown || []).join(', ')}], artifacts ${z.artifacts}, nobles [${(z.nobles || []).join('; ')}], births ${z.births}, cases ${z.cases}, sentences ${z.sentences}, petitions ${z.petitions ? `${z.petitions.yes}/${z.petitions.asked}` : '?'}, winch ${z.winchUses}, soldiers ${z.soldiersMax}, Annals ${z.annals}, mood@100 ${z.mood100}`);
      if (has('--verbose')) { for (const n of r.deepNotes) console.log('      deep', n); console.log('      refused', JSON.stringify(r.refusedTop)); }
    }
    // the rows over the seeds
    const names = [...new Set(results.flatMap((r) => (r.checks || []).map((c) => c.name)))];
    const rows = names.map((name) => {
      const cs = results.map((r) => (r.checks || []).find((c) => c.name === name)).filter(Boolean);
      const m = name.match(/(\d) of 5/), need = m ? Math.min(+m[1], cs.length) : cs.length;
      const met = cs.filter((c) => c.ok).length, info = cs.every((c) => c.info || c.na);
      return { name, met, of: cs.length, need, ok: info || met >= need, info };
    });
    // R2: the first Master on day 25-60 (the median of the seeds, as the balance report reads it)
    const ms = results.map((r) => r.metrics && r.metrics.xp ? r.metrics.xp.firstMaster : null).filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
    const mMed = ms.length ? ms[ms.length >> 1] : null;
    // (info here: the R2 row is the balance report's, on the v2 bot's D = 1 holds; a fortress's first Master is reported)
    rows.push({ name: `first Master on day 25-60 (R2, median of the seeds: ${mMed}; the balance report holds the row)`, met: mMed !== null && mMed >= 25 && mMed <= 60 ? 1 : 0, of: 1, need: 1, ok: true, info: true });
    console.log('\nZ2 gate rows (bot v4, seeds ' + seeds.join(',') + '):');
    for (const x of rows) console.log(`  ${x.info ? 'info' : x.ok ? 'ok  ' : 'FAIL'} ${x.name}: ${x.met}/${x.of} (needs ${x.need})`);
    const pass = rows.every((x) => x.ok) && results.every((r) => r.checks);
    if (out) save(out, { stage: 'z2', bot: 'v4', days, seeds, pass, rows, results });
    console.log(`colonybot v4 [Stage Z2 fortress, ${days} days]: ${rows.filter((x) => x.ok).length}/${rows.length} rows hold${pass ? ' - PASS' : ' - FAIL'}`);
    process.exit(pass ? 0 : 1);
  }
  if (arg('bot', 'v2') === 'v3' || stage === 'z1') {
    // Stage Z1 (E12): bot v3 on fortresses, the Z1 gate rows per seed
    const days = +arg('days', 30);
    const run = async () => { if (jobs <= 1 || seeds.length <= 1) { const o = []; for (const sd of seeds) o.push(await v3Seed(sd, days)); return o; } return v2Seeds(seeds, days, { jobs }); };
    const results = await run();
    if (has('--twice')) {
      const again = await run();
      results.forEach((r, k) => { const ok = again[k].hash === r.hash && again[k].commands === r.commands; (r.checks || (r.checks = [])).push({ name: 'deterministic', ok, detail: `${r.hash} vs ${again[k].hash}` }); if (!ok) r.ok = false; });
    }
    for (const r of results) {
      if (!r.checks) { console.log(`FAIL seed ${r.seed}: ${r.error}`); continue; }
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} seed ${r.seed}: ${days} days in ${r.ms} ms, ${r.commands} commands (${r.refused} refused), hash ${r.hash}, blob ${r.blobKB} KB, tick p95 max ${r.tickP95} ms`);
      for (const c of r.checks) console.log(`      ${c.ok ? 'ok  ' : c.info ? 'info' : 'FAIL'} ${c.name}: ${c.detail}`);
      if (has('--verbose')) { for (const n of r.deepNotes) console.log('      deep', n); console.log('      refused', JSON.stringify(r.refusedTop)); }
    }
    const pass = results.filter((r) => r.ok).length;
    if (out) save(out, { stage: 'z1', bot: 'v3', days, seeds, pass, of: results.length, results });
    console.log(`colonybot v3 [Stage Z1 fortress, ${days} days]: ${pass}/${results.length} seeds meet the Z1 gate rows${pass === results.length ? ' - PASS' : ' - FAIL'}`);
    process.exit(pass === results.length ? 0 : 1);
  }
  if (stage === '2') {
    const days = +arg('days', TARGETS_2.days);
    const results = await v2Seeds(seeds, days, { jobs, storyteller });
    if (has('--twice')) {
      const again = await v2Seeds(seeds, days, { jobs, storyteller });
      results.forEach((r, k) => { const ok = again[k].hash === r.hash && again[k].commands === r.commands; r.metrics.checks.push({ name: 'deterministic', ok, detail: `${r.hash} vs ${again[k].hash}` }); if (!ok) r.ok = false; });
    }
    printV2(results, days);
    const rows = summarise2(results.filter((r) => r.metrics));
    printSummary(rows);
    const pass = results.filter((r) => r.ok).length;
    const json = { stage, bot: 'v2', days, seeds, storyteller, targets: TARGETS_2, pass, of: results.length, rows, results };
    if (out) save(out, json);
    if (has('--json')) console.log(JSON.stringify(json));
    console.log(`colonybot v2 [stage 2, ${days} days]: ${pass}/${results.length} seeds meet the bot's own checks${pass === results.length ? ' - PASS' : ' - FAIL'}; other rows: ${rows.filter((x) => !x.enforced && x.ok).length}/${rows.filter((x) => !x.enforced).length} met`);
    process.exit(pass === results.length ? 0 : 1);
  }
  const v1 = stage !== '1a';
  const days = +arg('days', v1 ? 10 : 5);
  const results = [];
  for (const seed of seeds) {
    const r = await runBot({ seed, days, stage });
    if (has('--twice')) {
      const r2 = await runBot({ seed, days, stage });
      r.metrics.checks.push({ name: 'deterministic', ok: r2.hash === r.hash && r2.log.length === r.log.length, detail: `${r.hash} vs ${r2.hash}` });
      r.ok = r.metrics.ok = r.metrics.checks.every((c) => c.ok || c.info);
    }
    results.push(r);
    const m = r.metrics;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} seed ${seed}: ${days} days in ${r.ms} ms, ${r.log.length} commands (${r.refused.length} refused), hash ${r.hash}`);
    for (const c of m.checks) console.log(`      ${c.ok ? 'ok  ' : c.info ? 'warn' : 'FAIL'} ${c.name}: ${c.detail}`);
    if (has('--verbose')) {
      console.log('      buildings', JSON.stringify(m.buildings), 'stock', JSON.stringify(m.stock));
      if (m.bedrooms) console.log('      bedrooms', JSON.stringify(m.bedrooms.map((b) => [b.beds, b.pending, b.room])));
      if (m.raids) console.log('      raids', JSON.stringify(m.raids), 'hearth fuel days', m.hearthFuelDays);
      for (const n of r.notes) console.log('      note', n);
      for (const x of r.refused.slice(0, 10)) console.log('      refused', JSON.stringify(x));
    }
  }
  const pass = results.filter((r) => r.ok).length;
  const table = results.map((r) => (v1
    ? { seed: r.seed, ok: r.ok, hash: r.hash, alive: r.metrics.colonists.alive, mined: r.metrics.mined.byColonists, roomBeds: r.metrics.bestRoom ? r.metrics.bestRoom.beds : 0, meals: r.metrics.meals.cooked, raids: r.metrics.raids.map((x) => `${x.result}/${x.warnH}h`).join(' '), firstOmen: r.metrics.firstOmen, starved: r.metrics.deaths.filter((d) => d.cause === 'starvation').length, idleWork: r.metrics.idle.work, haulMedianH: r.metrics.haul.medianH, commands: r.log.length, refused: r.refused.length, ms: r.ms }
    : { seed: r.seed, ok: r.ok, hash: r.hash, mined: r.metrics.mined.byColonists, hallOpen: r.metrics.hall.open, hallValid: r.metrics.hall.valid, bedrooms: r.metrics.bedroomsDone, beds: r.metrics.bedsInstalled, idleWork: r.metrics.idle.work, idleAll: r.metrics.idle.all, haulMedianH: r.metrics.haul.medianH, haulStoredMedianH: r.metrics.haul.medianStoredH, commands: r.log.length, refused: r.refused.length, ms: r.ms }));
  const json = { stage, bot: v1 ? 'v1' : 'v0', days, seeds, targets: v1 ? TARGETS_1B : TARGETS_1A, pass, of: results.length, table, results: results.map((r) => ({ seed: r.seed, ok: r.ok, hash: r.hash, metrics: { ...r.metrics, stock: r.metrics.stock }, notes: r.notes, refused: r.refused.slice(0, 30) })) };
  if (out) writeFileSync(out, JSON.stringify(json, null, 1));
  if (has('--json')) console.log(JSON.stringify(json));
  console.log(`colonybot ${v1 ? 'v1' : 'v0'} [${stage}, ${days} days]: ${pass}/${results.length} seeds meet every target${pass === results.length ? ' - PASS' : ' - FAIL'}`);
  process.exit(pass === results.length ? 0 : 1);
}
