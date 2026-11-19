// The colony bot (gate 14.4 "Colony bot" from Stage 1a and "Balance report" from Stage 2; owner J).
//   node tools/colonybot.mjs [--stage=2|1b|1a] [--seeds=1-5] [--days=N] [--jobs=4] [--storyteller=id]
//                            [--json] [--out=FILE] [--verbose] [--twice]
//   node tools/colonybot.mjs --soak [--seeds=1] [--days=300] [--out=FILE]        (Stage 2 soak, 14.8 J)
//   node tools/colonybot.mjs --report [--from=FILE,FILE] [--jobs=4] [--out=FILE]  (balance report, 14.4)
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
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { runBot, TARGETS_1A, TARGETS_1B } from './lib/bot.mjs';
import { runBot2, summarise2, judgeSoak, TARGETS_2, SOAK, BALANCE } from './lib/bot2.mjs';
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
async function v2Seed(seed, days, { storyteller = null, soak = false } = {}) {
  const { saveBlob } = await import('../js/game/save/colonysave.js');
  // progress on stderr every 25 days (a soak runs for minutes)
  const onDay = (s, d, row) => { if (d % 25 === 0 && (soak || has('--progress'))) process.stderr.write(`  [seed ${seed}${storyteller ? ' ' + storyteller : ''}] day ${d}: ${row.alive}/${row.total} colonists, ${row.stacks} stacks, tier ${row.tier}, tick p95 ${row.tickP95} ms${row.blobKB !== undefined ? `, ${row.blobKB} KB` : ''}\n`); };
  const r = await runBot2({ seed, days, storyteller, blobFn: saveBlob, blobEvery: soak ? 10 : 25, tickP95At: soak ? 2400 : 0, onDay });
  let blobKB = null;
  try { blobKB = +((await saveBlob(r.s)).length / 1024).toFixed(1); } catch (_) { /* reported as null */ }
  const out = { seed, days, storyteller, ok: r.ok, hash: r.hash, ms: r.ms, commands: r.log.length, refused: r.refused.length, refusedTop: topRefused(r.refused), blobKB, notes: r.notes.slice(-40), metrics: r.metrics };
  if (soak) out.soak = judgeSoak(r);
  return out;
}
const topRefused = (list) => { const m = new Map(); for (const [, t, why] of list) { const k = `${t}: ${why}`; m.set(k, (m.get(k) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8); };

/** Seeds in parallel child processes (each runs `--one`), or in this process when jobs <= 1. */
async function v2Seeds(seeds, days, { jobs = 1, storyteller = null, soak = false } = {}) {
  if (jobs <= 1 || seeds.length <= 1) { const out = []; for (const sd of seeds) out.push(await v2Seed(sd, days, { storyteller, soak })); return out; }
  const results = new Array(seeds.length);
  let next = 0;
  const one = (k) => new Promise((resolve) => {
    const file = join(OUT_DIR, `.seed-${process.pid}-${k}.json`);
    const args = [fileURLToPath(import.meta.url), '--one', `--seeds=${seeds[k]}`, `--days=${days}`, `--out=${file}`, ...(storyteller ? [`--storyteller=${storyteller}`] : []), ...(soak ? ['--soak'] : [])];
    const p = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', () => { try { results[k] = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { results[k] = { seed: seeds[k], ok: false, error: `child failed: ${e.message}`, metrics: null }; } resolve(); });
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

// ---- balance report (14.4) -------------------------------------------------------------------------
function balanceReport(main, soak, others) {
  const B = BALANCE, lines = [], checks = [];
  const M = main.filter((r) => r.metrics).map((r) => r.metrics);
  const med = (a) => { const b = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
  const masters = M.map((m) => m.xp.firstMaster);
  const l20 = M.map((m) => m.xp.firstGrandmaster);
  const mMed = med(masters);
  checks.push({ name: `first Master on day ${B.masterDay[0]}-${B.masterDay[1]} (median of the seeds)`, owner: 'F', ok: mMed !== null && mMed >= B.masterDay[0] && mMed <= B.masterDay[1], detail: `days ${masters.join(' ')} (median ${mMed})` });
  checks.push({ name: `no level 20 before day ${B.noL20Before}`, owner: 'F', ok: l20.every((d) => d === null || d >= B.noL20Before) && (!soak || !soak.metrics || soak.metrics.xp.firstGrandmaster === null || soak.metrics.xp.firstGrandmaster >= B.noL20Before), detail: `first level 20: ${l20.join(' ')}${soak && soak.metrics ? `; soak ${soak.metrics.xp.firstGrandmaster}` : ''}` });
  if (soak && soak.metrics) {
    const g = soak.metrics.xp.firstGrandmaster;
    checks.push({ name: `soak: first Grandmaster on day ${B.grandmasterDay[0]}-${B.grandmasterDay[1]}`, owner: 'F', ok: g !== null && g >= B.grandmasterDay[0] && g <= B.grandmasterDay[1], detail: `day ${g} (max skill at day ${soak.days}: ${soak.metrics.xp.maxSkill})` });
  }
  // threat mix per storyteller (charters are Stage 3: none yet)
  const mix = {};
  for (const r of [...main, ...others]) {
    if (!r.metrics) continue;
    const k = r.storyteller || 'steady';
    const e = mix[k] || (mix[k] = { seeds: 0, majors: 0, incidents: {}, warnMinH: Infinity, gapMinD: Infinity });
    e.seeds++; e.majors += r.metrics.majors.length;
    for (const [inc, n] of Object.entries(r.metrics.threatMix)) e.incidents[inc] = (e.incidents[inc] || 0) + n;
    if (r.metrics.warnMinH !== null) e.warnMinH = Math.min(e.warnMinH, r.metrics.warnMinH);
    if (r.metrics.majorGapMinD !== null) e.gapMinD = Math.min(e.gapMinD, r.metrics.majorGapMinD);
  }
  // stacks and save size over time
  const series = (r) => (r && r.metrics ? r.metrics.series.filter((x) => x.blobKB !== undefined).map((x) => ({ day: x.day, alive: x.alive, stacks: x.stacks, blobKB: x.blobKB, wealth: x.wealth, tier: x.tier, tickP95: x.tickP95 })) : []);
  const report = { checks, threatMix: mix, charters: 'Stage 3 (no charters in Stage 2)', sizeSeries: { main: main.map((r) => ({ seed: r.seed, rows: series(r) })), soak: soak ? series(soak) : [] },
    xp: M.map((m, i) => ({ seed: main[i].seed, firstMaster: m.xp.firstMaster, firstGrandmaster: m.xp.firstGrandmaster, maxSkill: m.xp.maxSkill })) };
  lines.push('Balance report (14.4)');
  for (const c of checks) lines.push(`  ${c.ok ? 'ok  ' : 'miss'} [${c.owner}] ${c.name}: ${c.detail}`);
  lines.push('  threat mix per storyteller (majors and minors that arrived, over the seeds):');
  for (const [k, e] of Object.entries(mix)) lines.push(`    ${k}: ${e.seeds} seeds, ${e.majors} majors (${(e.majors / e.seeds).toFixed(1)} a seed), shortest warning ${e.warnMinH} h, closest majors ${e.gapMinD} d; ${Object.entries(e.incidents).sort((a, b) => b[1] - a[1]).map(([i, n]) => `${i} ${n}`).join(', ')}`);
  lines.push('  stacks and save size over time:');
  for (const r of report.sizeSeries.main) lines.push(`    seed ${r.seed}: ${r.rows.map((x) => `d${x.day} ${x.alive}col ${x.stacks}st ${x.blobKB}KB`).join(' | ')}`);
  if (soak) lines.push(`    soak seed ${soak.seed}: ${report.sizeSeries.soak.filter((x, i) => i % 3 === 2 || i === report.sizeSeries.soak.length - 1).map((x) => `d${x.day} ${x.alive}col ${x.stacks}st ${x.blobKB}KB`).join(' | ')}`);
  report.ok = checks.every((c) => c.ok);
  return { report, text: lines.join('\n') };
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
    const r = await v2Seed(seed, +arg('days', 100), { storyteller, soak: has('--soak') });
    save(out, r);
    process.exit(0);
  }
  if (has('--soak')) {
    const seeds = parseSeeds(arg('seeds', '1')), days = +arg('days', SOAK.days);
    const results = await v2Seeds(seeds, days, { jobs, soak: true });
    printV2(results, days);
    let ok = true;
    for (const r of results) {
      console.log(`\nsoak seed ${r.seed}, ${days} days:`);
      for (const c of r.soak || [{ name: 'ran', ok: false, detail: r.error }]) { console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`); if (!c.ok) ok = false; }
      if (r.metrics) for (const x of r.metrics.series.filter((y) => y.blobKB !== undefined)) console.log(`    day ${x.day}: ${x.alive}/${x.total} colonists, ${x.stacks} stacks, ${x.bld} buildings, ${x.blobKB} KB, wealth ${x.wealth}, tier ${x.tier}, tick p95 ${x.tickP95} ms`);
    }
    if (out) save(out, { kind: 'soak', days, seeds, targets: SOAK, ok, results });
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
    if (!soak && !has('--no-soak')) soak = (await v2Seeds([1], SOAK.days, { soak: true }))[0];
    const others = [];
    for (const st of ['wandering', 'long_night']) others.push(...(await v2Seeds([1, 2], TARGETS_2.days, { jobs: Math.max(1, jobs), storyteller: st })).map((r) => ({ ...r, storyteller: st })));
    const { report, text } = balanceReport(main, soak, others);
    console.log(text);
    if (out) save(out, report);
    console.log(`colonybot balance report: ${report.ok ? 'PASS' : 'targets missed (see above; owners in brackets)'}`);
    process.exit(report.ok ? 0 : 1);
  }
  const seeds = parseSeeds(arg('seeds', '1-5'));
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
