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
  while (s.tick < end) {
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
  const [setup, slice, bot, rtc] = await Promise.all([import('../js/game/core/setup.js'), import('./tests/slice-scene.mjs'), import('./lib/bot.mjs'), import('../js/game/core/rtcontract.js')]);
  return { installSim: setup.installSim, runSliceSuite: slice.runSliceSuite, runLog: slice.runLog, runBot: bot.runBot, botFound: bot.botFound, dirtyClear: rtc.dirtyClear };
};
const hashOf = stateHash, stateErrors = checkState, rebuilder = rebuilderOf, same = rtEqual, cachesBad = verifyCaches, rtKeys = checkRt;

export async function runBotSuite({ seed = 1, ticks = 7200, engine = 'node' } = {}) {
  const t0 = now();
  const { installSim, runLog, runBot, botFound, dirtyClear } = await real();
  installSim({ stage: '1a', reset: true });
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const bot = await runBot({ seed, ticks });
  const log = bot.log, start = botFound(seed).tick, end = start + ticks;
  const a = await runLog(botFound(seed), log, end);
  const b = await runLog(botFound(seed), log, end);
  const ha = hashOf(a);
  add('(a) same seed and bot log twice', ha === hashOf(b), `${ha} vs ${hashOf(b)}`);
  add('replaying the bot log reproduces the bot run', ha === bot.hash, `${ha} vs ${bot.hash}; ${log.length} commands`);
  const errs = stateErrors(a), rk = rtKeys(a.rt);
  add('state valid at end', errs.length === 0 && rk.unlisted.length === 0 && rk.missing.length === 0, errs.slice(0, 3).join('; ') + rk.unlisted.join(','));
  const r = { rng: { m: 0xb07 } };
  const saveAt = new Set(); while (saveAt.size < 5) saveAt.add(start + rint(r, 'm', 30, ticks - 30));
  const c = await runLog(botFound(seed), log, end, { saveAt });
  add('(b) save and load at 5 ticks, then continue', hashOf(c) === ha, `saves at ${[...saveAt].sort((x, y) => x - y).join(', ')}`);
  const d = await runLog(botFound(seed), log, end, { perFrame: 5 });
  add('(c) 1x and 5x identical', hashOf(d) === ha);
  const r2 = { rng: { m: 0xe0b } };
  const cacheAt = new Set(); while (cacheAt.size < 20) cacheAt.add(start + rint(r2, 'm', 1, ticks));
  const resRebuild = rebuilder('res');
  let resBad = 0, dirtyBad = 0; const cacheBad = [];
  await runLog(botFound(seed), log, end, {
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
 * The scenes: 'stub' (the Stage 0 contract fixture; run it on its own or first), 'slice' (A's slice
 * log) and 'bot' (the colony bot's log); Stage 1a runs slice and bot. Checks are prefixed with the
 * scene name.
 */
export async function runAll({ scenes = ['slice', 'bot'], ticks = 3000, sliceTicks = 2400, botTicks = 7200, engine = 'node' } = {}) {
  const t0 = now();
  const out = { engine, ok: true, checks: [], hashes: {}, ticks: 0 };
  for (const sc of scenes) {
    let res;
    try {
      if (sc === 'stub') res = await runSuite({ ticks, engine });
      else if (sc === 'slice') { const R = await real(); R.installSim({ stage: '1a', reset: true }); res = await R.runSliceSuite({ ticks: sliceTicks, engine }); }
      else if (sc === 'bot') res = await runBotSuite({ ticks: botTicks, engine });
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
