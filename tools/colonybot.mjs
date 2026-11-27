// The colony bot (gate 14.4 "Colony bot" from Stage 1a and "Balance report" from Stage 2; owner J).
//   node tools/colonybot.mjs [--stage=2|1b|1a] [--seeds=1-5] [--days=N] [--jobs=4] [--storyteller=id]
//                            [--json] [--out=FILE] [--verbose] [--twice]
//   node tools/colonybot.mjs --soak [--seeds=1] [--days=300] [--difficulty=warden] [--out=FILE]  (Stage 2 soak, 14.8 J)
//   node tools/colonybot.mjs --report [--from=FILE,FILE] [--jobs=4] [--out=FILE]  (balance report, 14.4)
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

// ---- CLI -------------------------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const stage = arg('stage', '2');
  const jobs = +arg('jobs', 1);
  const out = arg('out', null);
  const storyteller = arg('storyteller', null);
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
