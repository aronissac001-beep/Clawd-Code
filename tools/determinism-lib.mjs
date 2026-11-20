// The determinism suite (gate 14.4 (a)-(e)), shared by Node (tools/determinism.mjs) and the
// Playwright WebKit page (tools/determinism-webkit.mjs -> tools/web/determinism.html).
// It only uses relative imports of the game, so it runs unchanged in both engines.
//
// Stage 0: the real systems do not exist yet, so the suite installs a STUB WORLD (fixture systems
// that use every RNG stream, sin/cos movement, layer writes, entity churn, an endOfTick pass with
// a registered rebuild, a 'designate' applier). From Stage 1a, `opts.scene` selects real scenes
// and the stubs are dropped. The checks themselves do not change.
//   (a) same seed and command log twice: identical state hash
//   (b) save (EC2 blob, deflate) at 5 seeded random ticks, load, continue: identical to the uninterrupted run
//   (c) 1x and 5x (1 vs 5 ticks per frame, the same log): identical hash
//   (d) reservations equal the rebuild from jobs at every tick end
//   (e) at 20 seeded random ticks every registered end-of-tick / incremental cache equals a rebuild

import { createColony, stateHash, checkState } from '../js/game/core/state.js';
import { tick } from '../js/game/core/sim.js';
import { applyCommand, registerApplier, resetAppliers } from '../js/game/core/commands.js';
import { registerSystem, registerEndOfTick, resetBus } from '../js/game/core/bus.js';
import { registerRebuild, rebuilderOf, rtEqual, verifyCaches, checkRt } from '../js/game/core/rtcontract.js';
import { rnd, rint } from '../js/game/core/rand.js';
import { newColonist, newStack } from '../js/game/core/schema.js';
import { idx, W, H, N, TILE, DESIG_KINDS as GRID_DESIG } from '../js/game/core/grid.js';
import { saveBlob, loadBlob } from '../js/game/save/colonysave.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

// ---- Stub world -------------------------------------------------------------------------------
function lightRebuild(s) {
  const a = new Uint8Array(N);
  for (const it of s.items) if (it) { const i = idx(it.x, it.y); a[i] = Math.min(3, a[i] + 1); }
  for (let i = 0; i < N; i++) if (s.L.desig[i] & GRID_DESIG.mine) a[i] = Math.max(a[i], 1);
  return a;
}
export function installStubWorld() {
  resetBus(); resetAppliers();
  registerSystem('movement', 'stub-walk', (s) => {
    for (const c of s.col) {
      const a = rnd(s, 'main') * Math.PI * 2;
      c.x = Math.min(Math.max(c.x + Math.cos(a) * 3.7, 0), W * TILE - 1);
      c.y = Math.min(Math.max(c.y + Math.sin(a) * 3.7, 0), H * TILE - 1);
    }
  });
  registerSystem('colony', 'stub-spawn', (s) => {
    if (s.tick % 37 === 0 && s.items.filter(Boolean).length < 60) {
      const x = rint(s, 'gen', 0, W - 1), y = rint(s, 'gen', 0, H - 1);
      if (s.rt.itemAt[idx(x, y)] < 0) {
        const id = s.rt.itemFree.length ? s.rt.itemFree.shift() : s.items.length;
        s.items[id] = newStack(id, 'stone', 'granite', 0, rint(s, 'combat', 1, 10), x, y);
        s.rt.itemAt[idx(x, y)] = id; s.rt.dirty.light = true;
      }
    }
    if (s.tick % 53 === 0) {
      const live = s.items.filter(Boolean);
      if (live.length > 8) {
        const it = live[rint(s, 'story', 0, live.length - 1)];
        s.rt.itemAt[idx(it.x, it.y)] = -1; s.items[it.id] = null;
        let k = 0; while (k < s.rt.itemFree.length && s.rt.itemFree[k] < it.id) k++;
        s.rt.itemFree.splice(k, 0, it.id); s.rt.dirty.light = true;
      }
    }
    if (s.tick % 300 === 0) s.chron.push([s.tick, 'stub', 'tick', [rint(s, 'names', 0, 999)]]);
  });
  registerSystem('think', 'stub-queue', (s) => {
    if (s.tick % 20 === 0) for (const c of s.col) s.rt.thinkQ.push(c.id);
    s.rt.thinkQ.splice(0, 6);
  });
  registerEndOfTick('light', (s) => { s.rt.light = lightRebuild(s); });
  registerRebuild('light', lightRebuild);
  registerApplier('designate', (s, c) => {
    const bit = GRID_DESIG[c.kind];
    const x0 = Math.min(c.rect.x0, c.rect.x1), x1 = Math.max(c.rect.x0, c.rect.x1), y0 = Math.min(c.rect.y0, c.rect.y1), y1 = Math.max(c.rect.y0, c.rect.y1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = idx(x, y); s.L.desig[i] = c.add ? s.L.desig[i] | bit : s.L.desig[i] & ~bit; }
    s.rt.dirty.light = true;
    return { ok: true };
  });
}

/** A fresh stub colony with 6 colonists. */
export function stubColony(seed) {
  const s = createColony(seed, { w: 128 });
  for (let i = 0; i < 6; i++) s.col.push(newColonist(s.next.col++, { name: 'Stub ' + i, x: 2000 + i * 40, y: 2000 }));
  return s;
}

/** A seeded command log [[tick, cmd]] (valid designations, some invalid ones that must be dropped). */
export function makeLog(seed, ticks) {
  const r = { rng: { main: seed >>> 0 } };
  const log = [];
  for (let t = 5; t < ticks; t += 17 + (rint(r, 'main', 0, 40))) {
    const x = rint(r, 'main', 0, 120), y = rint(r, 'main', 0, 120);
    const kinds = ['mine', 'chop', 'harvest', 'smooth'];
    log.push([t, { t: 'designate', kind: kinds[rint(r, 'main', 0, 3)], rect: { x0: x, y0: y, x1: x + rint(r, 'main', 0, 7), y1: y + rint(r, 'main', 0, 7) }, add: rint(r, 'main', 0, 4) > 0 }]);
    if (rint(r, 'main', 0, 5) === 0) log.push([t, { t: 'designate', kind: 'nope', rect: { x0: 0, y0: 0, x1: 1, y1: 1 }, add: true }]);
  }
  return log;
}

/** Run a state forward to `end`, applying log entries at their ticks; `perFrame` ticks per frame. */
export async function run(s, log, end, { perFrame = 1, onTickEnd = null, saveAt = null } = {}) {
  let li = 0;
  while (li < log.length && log[li][0] < s.tick) li++;
  while (s.tick < end && s.colony.fallen !== true) {   // a fallen hold no longer ticks (EMBERCROWN-FORTRESS.md 1.3)
    for (let k = 0; k < perFrame && s.tick < end; k++) {
      while (li < log.length && log[li][0] === s.tick) applyCommand(s, log[li++][1]);
      tick(s);
      if (onTickEnd) onTickEnd(s);
      if (saveAt && saveAt.has(s.tick)) { s = await loadBlob(await saveBlob(s)); }
    }
  }
  return s;
}

export async function runSuite({ seed = 'DET-1', ticks = 3000, engine = 'node' } = {}) {
  const t0 = now();
  installStubWorld();
  const log = makeLog(0xdec0de, ticks);
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });

  // (a)
  const a = await run(stubColony(seed), log, ticks);
  const b = await run(stubColony(seed), log, ticks);
  const ha = stateHash(a), hb = stateHash(b);
  add('(a) same seed and log twice', ha === hb, `${ha} vs ${hb}`);
  add('state valid at end', checkState(a).length === 0 && checkRt(a.rt).unlisted.length === 0, checkState(a).slice(0, 3).join('; '));
  add('stub world did something', a.items.some(Boolean) && a.L.desig.some((v) => v) && a.chron.length > 0, `items ${a.items.filter(Boolean).length}, chron ${a.chron.length}`);
  const other = await run(stubColony(seed + 'x'), log, ticks);
  add('different seed differs', stateHash(other) !== ha);

  // (b) saves at 5 seeded random ticks
  const r = { rng: { main: 0x5a5e } };
  const saveAt = new Set(); while (saveAt.size < 5) saveAt.add(rint(r, 'main', 50, ticks - 50));
  const c = await run(stubColony(seed), log, ticks, { saveAt });
  add('(b) save/load at 5 ticks then continue', stateHash(c) === ha, `saves at ${[...saveAt].sort((x, y) => x - y).join(', ')}`);

  // (c) 1x vs 5x
  const d = await run(stubColony(seed), log, ticks, { perFrame: 5 });
  add('(c) 1x and 5x identical', stateHash(d) === ha);

  // (d) reservations equal rebuildFromJobs at every tick end; (e) caches at 20 seeded ticks
  const r2 = { rng: { main: 0xe0e } };
  const cacheAt = new Set(); while (cacheAt.size < 20) cacheAt.add(rint(r2, 'main', 1, ticks));
  let resBad = 0, cacheBad = [], resRebuild = rebuilderOf('res');
  await run(stubColony(seed), log, ticks, {
    onTickEnd: (s) => {
      if (resRebuild && !rtEqual(s.rt.res, resRebuild(s))) resBad++;
      if (cacheAt.has(s.tick)) { const bad = verifyCaches(s); if (bad.length) cacheBad.push(`${s.tick}:${bad.join('/')}`); }
    },
  });
  add('(d) reservations equal rebuild at every tick end', resRebuild && resBad === 0, resRebuild ? `${resBad} mismatching ticks` : 'no res rebuild registered');
  add('(e) caches equal rebuild at 20 ticks', cacheBad.length === 0, cacheBad.slice(0, 3).join(', '));

  return { engine, ok: checks.every((x) => x.ok), hash: ha, ticks, ms: Math.round(now() - t0), checks };
}

// ---- Stage 1a scenes: the real sim ----------------------------------------------------------------
// 'slice' is A's slice suite (tools/tests/slice-scene.mjs: the real founding and a seeded slice log).
// 'bot' replays the colony bot's command log (tools/lib/bot.mjs: a scripted player's real orders)
// under the same checks (a)-(e), and also checks that replaying the log reproduces the bot's own run
// (the bot only sends commands).
// The real-sim modules are imported on first use: importing them registers their C13 rebuilds,
// which the stub world does not maintain (so the stub scene runs alone, before any real scene).
const real = async () => {
  const [setup, slice, bot, rtc, bot2] = await Promise.all([import('../js/game/core/setup.js'), import('./tests/slice-scene.mjs'), import('./lib/bot.mjs'), import('../js/game/core/rtcontract.js'), import('./lib/bot2.mjs')]);
  return { installSim: setup.installSim, runSliceSuite: slice.runSliceSuite, runLog: slice.runLog, runBot: bot.runBot, runBot2: bot2.runBot2, botFound: bot.botFound, dirtyClear: rtc.dirtyClear };
};
const hashOf = stateHash, stateErrors = checkState, rebuilder = rebuilderOf, same = rtEqual, cachesBad = verifyCaches, rtKeys = checkRt;

export async function runBotSuite({ seed = 1, ticks = 7200, engine = 'node' } = {}) {
  const t0 = now();
  const { installSim, runLog, runBot, botFound, dirtyClear } = await real();
  installSim({ stage: '1a', reset: true });
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const bot = await runBot({ seed, ticks, stage: '1a' });
  const found = () => botFound(seed, '1a');
  const log = bot.log, start = found().tick, end = start + ticks;
  const a = await runLog(found(), log, end);
  const b = await runLog(found(), log, end);
  const ha = hashOf(a);
  add('(a) same seed and bot log twice', ha === hashOf(b), `${ha} vs ${hashOf(b)}`);
  add('replaying the bot log reproduces the bot run', ha === bot.hash, `${ha} vs ${bot.hash}; ${log.length} commands`);
  const errs = stateErrors(a), rk = rtKeys(a.rt);
  add('state valid at end', errs.length === 0 && rk.unlisted.length === 0 && rk.missing.length === 0, errs.slice(0, 3).join('; ') + rk.unlisted.join(','));
  const r = { rng: { m: 0xb07 } };
  const saveAt = new Set(); while (saveAt.size < 5) saveAt.add(start + rint(r, 'm', 30, ticks - 30));
  const c = await runLog(found(), log, end, { saveAt });
  add('(b) save and load at 5 ticks, then continue', hashOf(c) === ha, `saves at ${[...saveAt].sort((x, y) => x - y).join(', ')}`);
  const d = await runLog(found(), log, end, { perFrame: 5 });
  add('(c) 1x and 5x identical', hashOf(d) === ha);
  const r2 = { rng: { m: 0xe0b } };
  const cacheAt = new Set(); while (cacheAt.size < 20) cacheAt.add(start + rint(r2, 'm', 1, ticks));
  const resRebuild = rebuilder('res');
  let resBad = 0, dirtyBad = 0; const cacheBad = [];
  await runLog(found(), log, end, {
    onTickEnd: (s) => {
      if (!resRebuild || !same(s.rt.res, resRebuild(s))) resBad++;
      if (!dirtyClear(s.rt.dirty)) dirtyBad++;
      if (cacheAt.has(s.tick)) { const bad = cachesBad(s); if (bad.length) cacheBad.push(`${s.tick}:${bad.join('/')}`); }
    },
  });
  add('(d) reservations equal rebuildFromJobs at every tick end', resRebuild && resBad === 0, `${resBad} mismatching ticks`);
  add('(e) every cache equals a rebuild at 20 ticks', cacheBad.length === 0, cacheBad.slice(0, 3).join(', '));
  add('dirty flags clear at every tick end', dirtyBad === 0, `${dirtyBad} ticks`);
  return { engine, ok: checks.every((x) => x.ok), hash: ha, ticks, ms: Math.round(now() - t0), commands: log.length, checks };
}


/**
 * The 1b raid scene (gate 14.4 (b) "from 1b, at least two saves mid-raid"): bot v1 (stage 1b) from
 * founding through the first night (seed 2: the omen on day 2 at 18:00, the horde at 21:00 on day 3,
 * repelled before dawn). A first uninterrupted run finds the Sighted tick and the ticks with a hostile
 * in melee reach of a colonist; then (a)-(e) run as in the bot scene, with (b) saving at Sighted + 7,
 * at 3 melee ticks and at 3 seeded random ticks.
 */
export async function runRaidSuite({ seed = 2, ticks = 41400, engine = 'node', stage = '1b' } = {}) {
  const t0 = now();
  const { installSim, runLog, runBot, runBot2, botFound, dirtyClear } = await real();
  installSim({ stage, reset: true });
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const found = () => botFound(seed, stage);
  const bot = stage === '2' ? await runBot2({ seed, ticks }) : await runBot({ seed, ticks, stage });
  const log = bot.log, start = found().tick, end = start + ticks;
  let sighted = -1, ended = -1;
  const melee = [], sightedAll = [], seen = new Set();
  const a = await runLog(found(), log, end, {
    onTickEnd: (s) => {
      if (sighted < 0 && s.raids.some((r) => r.stage === 'sighted')) sighted = s.tick;
      // (Stage 2: every raid's Sighted tick, so a later raid, a breach from the deep, is saved too)
      for (const r of s.raids) if (r.stage === 'sighted' && !seen.has(r.id)) { seen.add(r.id); sightedAll.push(s.tick); }
      if (s.foes.length && melee.length < 4000) {
        for (const f of s.foes) { if (s.col.some((c) => !c.hp.dead && Math.abs(c.x - f.x) <= 48 && Math.abs(c.y - f.y) <= 48)) { melee.push(s.tick); break; } }
      }
      if (ended < 0 && s.st.history.some((h) => h.cat === 'major')) ended = s.tick;
    },
  });
  const ha = hashOf(a);
  const hist = a.st.history.filter((h) => h.cat === 'major');
  add('the first raid ran: sighted, melee, ended', sighted > 0 && melee.length > 0 && hist.length > 0, `sighted at ${sighted}, ${melee.length} melee ticks, ended at ${ended} (${hist.map((h) => h.result).join(',') || 'not ended'})`);
  const b = await runLog(found(), log, end);
  add('(a) same seed and bot log twice', ha === hashOf(b), `${ha} vs ${hashOf(b)}`);
  add('replaying the bot log reproduces the bot run', ha === bot.hash, `${ha} vs ${bot.hash}; ${log.length} commands`);
  const errs = stateErrors(a), rk = rtKeys(a.rt);
  add('state valid at end', errs.length === 0 && rk.unlisted.length === 0 && rk.missing.length === 0, errs.slice(0, 3).join('; ') + rk.unlisted.join(','));
  const saveAt = new Set();
  if (sighted > 0) saveAt.add(sighted + 7);
  if (stage !== '1b') for (const t of sightedAll.slice(1, 3)) if (t + 11 < end) saveAt.add(t + 11);
  for (const k of [0, melee.length >> 1, melee.length - 1]) if (melee.length) saveAt.add(melee[k]);
  const r = { rng: { m: 0x7a1d } };
  while (saveAt.size < (stage === '1b' ? 7 : 9)) saveAt.add(start + rint(r, 'm', 30, ticks - 30));
  const c = await runLog(found(), log, end, { saveAt });
  const mid = [...saveAt].filter((t) => t === sighted + 7 || melee.includes(t) || sightedAll.some((x) => t === x + 11)).length;
  add('(b) saves mid-raid (Sighted, hostiles in melee) and at random ticks, then continue', hashOf(c) === ha && mid >= 2, `${mid} saves mid-raid; saves at ${[...saveAt].sort((x, y) => x - y).join(', ')}`);
  const d = await runLog(found(), log, end, { perFrame: 5 });
  add('(c) 1x and 5x identical', hashOf(d) === ha);
  const r2 = { rng: { m: 0xe0c } };
  const cacheAt = new Set(melee.filter((_, k) => k % 50 === 0).slice(0, 5)); while (cacheAt.size < 20) cacheAt.add(start + rint(r2, 'm', 1, ticks));
  const resRebuild = rebuilder('res');
  let resBad = 0, dirtyBad = 0; const cacheBad = [];
  await runLog(found(), log, end, {
    onTickEnd: (s) => {
      if (!resRebuild || !same(s.rt.res, resRebuild(s))) resBad++;
      if (!dirtyClear(s.rt.dirty)) dirtyBad++;
      if (cacheAt.has(s.tick)) { const bad = cachesBad(s); if (bad.length) cacheBad.push(`${s.tick}:${bad.join('/')}`); }
    },
  });
  add('(d) reservations equal rebuildFromJobs at every tick end', resRebuild && resBad === 0, `${resBad} mismatching ticks`);
  add('(e) every cache equals a rebuild at 20 ticks (5 in melee)', cacheBad.length === 0, cacheBad.slice(0, 3).join(', '));
  add('dirty flags clear at every tick end', dirtyBad === 0, `${dirtyBad} ticks`);
  return { engine, ok: checks.every((x) => x.ok), hash: ha, ticks, ms: Math.round(now() - t0), commands: log.length, checks };
}

/**
 * The scenes: 'stub' (the Stage 0 contract fixture; run it on its own or first), 'slice' (A's slice
 * log), 'bot' (the colony bot v0's 1a log) and 'raid' (bot v1's 1b log through the first night, saves
 * mid-raid); Stage 1a runs slice and bot, Stage 1b adds raid. Checks are prefixed with the
 * scene name.
 */
export async function runAll({ scenes = ['slice', 'bot'], ticks = 3000, sliceTicks = 2400, botTicks = 7200, engine = 'node', seeds = null } = {}) {
  const t0 = now();
  const out = { engine, ok: true, checks: [], hashes: {}, ticks: 0 };
  for (const sc of scenes) {
    let res;
    try {
      if (sc === 'stub') res = await runSuite({ ticks, engine });
      else if (sc === 'slice') { const R = await real(); R.installSim({ stage: '1a', reset: true }); res = await R.runSliceSuite({ ticks: sliceTicks, engine }); }
      else if (sc === 'bot') res = await runBotSuite({ ticks: botTicks, engine });
      else if (sc === 'raid') res = await runRaidSuite({ engine });
      // Stage 2: bot v2 (tools/lib/bot2.mjs) on seed 1 through day 8: the first horde and a breach from the deep
      else if (sc === 'raid2') res = await runRaidSuite({ engine, stage: '2', seed: 1, ticks: 8 * 14400 });
      // Stage Z1 (E1): bot v2 seeds (default 1-5) against the D = 1 baseline, checkpoint by checkpoint (Node only)
      else if (sc === 'd1base') res = await runBaselineSuite({ engine, seeds: seeds || [1, 2, 3, 4, 5], base: await readBaseline() });
      else throw new Error(`unknown scene ${sc}`);
    } catch (e) { res = { ok: false, hash: '-', ticks: 0, checks: [{ name: 'ran', ok: false, detail: String(e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e) }] }; }
    out.hashes[sc] = res.hash; out.ticks += res.ticks || 0;
    for (const c of res.checks) out.checks.push({ ...c, name: `${sc}: ${c.name}` });
    if (!res.ok) out.ok = false;
  }
  out.hash = Object.values(out.hashes).join('/');
  out.ms = Math.round(now() - t0);
  return out;
}

// ---- Stage Z1 D = 1 oracle (EMBERCROWN-FORTRESS.md 8.3 E1) ---------------------------------------
// Bot v2 on seeds 1-5 for BASE_DAYS days, stateHash every BASE_EVERY ticks. The baseline
// (tools/fixtures/z1-d1-baseline.json) was recorded with the value hash on the unchanged Stage 2.9 code
// (4d49940); every Z1 engine step that changes no D = 1 behaviour must reproduce it at every checkpoint
// (E5 re-baselines it once, on purpose: the zone fields go). In Node only (the page has no fixture reader).
export const BASE_DAYS = 20, BASE_EVERY = 2400;
export const BASELINE_FILE = 'fixtures/z1-d1-baseline.json';
async function readBaseline() {
  const fs = await import('node:fs');
  return JSON.parse(fs.readFileSync(new URL(BASELINE_FILE, import.meta.url), 'utf8'));
}
export async function botCheckpoints(seed, { days = BASE_DAYS, every = BASE_EVERY } = {}) {
  const { runBot2 } = await import('./lib/bot2.mjs');
  const hashes = [];
  const r = await runBot2({ seed, days, onTick: (s) => { if (s.tick % every === 0) hashes.push(stateHash(s)); } });
  return { seed, days, every, hashes, final: r.hash };
}
export const parseSeeds = (v) => {
  const out = [];
  for (const part of String(v).split(',')) { const m = part.match(/^(\d+)-(\d+)$/); if (m) for (let k = +m[1]; k <= +m[2]; k++) out.push(k); else if (part) out.push(+part); }
  return out;
};
/** Compare bot seeds against the baseline: checks named per seed with the first differing checkpoint. */
export async function runBaselineSuite({ seeds = [1, 2, 3, 4, 5], base, engine = 'node' } = {}) {
  const t0 = now();
  const checks = [];
  for (const seed of seeds) {
    const want = base.seeds[String(seed)];
    if (!want) { checks.push({ name: `seed ${seed}: in the baseline`, ok: false, detail: 'no baseline row' }); continue; }
    const got = await botCheckpoints(seed, { days: base.days, every: base.every });
    const k = got.hashes.findIndex((h, j) => h !== want.hashes[j]);
    const ok = k < 0 && got.hashes.length === want.hashes.length && got.final === want.final;
    checks.push({ name: `seed ${seed}: ${want.hashes.length} checkpoints equal the Stage 2.9 baseline`, ok,
      detail: ok ? `final ${got.final}` : k >= 0 ? `first difference at tick ${(k + 1) * base.every}: ${got.hashes[k]} vs ${want.hashes[k]}` : `${got.hashes.length} vs ${want.hashes.length} checkpoints, final ${got.final} vs ${want.final}` });
  }
  return { engine, ok: checks.every((c) => c.ok), hash: checks.length + ' seeds', ms: Math.round(now() - t0), checks };
}
