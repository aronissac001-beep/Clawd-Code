// The colony bot (gate 14.4 "Colony bot", from Stage 1a; owner J). v0: a scripted sandbox.
//   node tools/colonybot.mjs [--seeds=1-5] [--days=5] [--json] [--out=FILE] [--verbose] [--twice]
//   node tools/colonybot.mjs --report            (Stage 2 balance report: not yet; exits 0 with a note)
// The player script, meters and targets live in tools/lib/bot.mjs (browser-safe); see its header.
// Exit 0 when every seed meets every 1a target (doc 14.6), 1 otherwise.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBot, TARGETS_1A } from './lib/bot.mjs';
export * from './lib/bot.mjs';

// ---- CLI -------------------------------------------------------------------------------------------
function parseSeeds(v) {
  const out = [];
  for (const part of String(v).split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let k = +m[1]; k <= +m[2]; k++) out.push(k); else if (part) out.push(isNaN(+part) ? part : +part);
  }
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
  const has = (f) => process.argv.includes(f);
  if (has('--report')) { console.log('colonybot --report: the balance report starts at Stage 2 (bot v2); nothing to report in Stage 1a'); process.exit(0); }
  const seeds = parseSeeds(arg('seeds', '1-5'));
  const days = +arg('days', 5);
  const results = [];
  for (const seed of seeds) {
    const r = await runBot({ seed, days });
    if (has('--twice')) {
      const r2 = await runBot({ seed, days });
      r.metrics.checks.push({ name: 'deterministic', ok: r2.hash === r.hash && r2.log.length === r.log.length, detail: `${r.hash} vs ${r2.hash}` });
      r.ok = r.metrics.ok = r.metrics.checks.every((c) => c.ok || c.info);
    }
    results.push(r);
    const m = r.metrics;
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} seed ${seed}: ${days} days in ${r.ms} ms, ${r.log.length} commands (${r.refused.length} refused), hash ${r.hash}`);
    for (const c of m.checks) console.log(`      ${c.ok ? 'ok  ' : c.info ? 'warn' : 'FAIL'} ${c.name}: ${c.detail}`);
    if (has('--verbose')) {
      console.log('      buildings', JSON.stringify(m.buildings), 'stock', JSON.stringify(m.stock));
      console.log('      bedrooms', JSON.stringify(m.bedrooms.map((b) => [b.beds, b.pending, b.room])));
      for (const n of r.notes) console.log('      note', n);
      for (const x of r.refused.slice(0, 10)) console.log('      refused', JSON.stringify(x));
    }
  }
  const pass = results.filter((r) => r.ok).length;
  const table = results.map((r) => ({ seed: r.seed, ok: r.ok, hash: r.hash, mined: r.metrics.mined.byColonists, hallOpen: r.metrics.hall.open, hallValid: r.metrics.hall.valid, bedrooms: r.metrics.bedroomsDone, beds: r.metrics.bedsInstalled, idleWork: r.metrics.idle.work, idleAll: r.metrics.idle.all, haulMedianH: r.metrics.haul.medianH, haulStoredMedianH: r.metrics.haul.medianStoredH, commands: r.log.length, refused: r.refused.length, ms: r.ms }));
  const out = arg('out', null);
  const json = { stage: '1a', days, seeds, targets: TARGETS_1A, pass, of: results.length, table, results: results.map((r) => ({ seed: r.seed, ok: r.ok, hash: r.hash, metrics: { ...r.metrics, stock: r.metrics.stock }, notes: r.notes, refused: r.refused.slice(0, 30) })) };
  if (out) writeFileSync(out, JSON.stringify(json, null, 1));
  if (has('--json')) console.log(JSON.stringify(json));
  console.log(`colonybot v0 [1a, ${days} days]: ${pass}/${results.length} seeds meet every target${pass === results.length ? ' - PASS' : ' - FAIL'}`);
  process.exit(pass === results.length ? 0 : 1);
}
