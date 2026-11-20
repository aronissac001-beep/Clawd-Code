// Contract test `cache-drop` (C13 v3, EMBERCROWN-FORTRESS.md 7.3 and F25; owner J, in the gate from Stage Z1
// step E1). Bot v2 plays; at seeded ticks the state is cloned, EVERY key initRuntime rebuilds (end-of-tick,
// incremental, per-tick and derived caches: droppableKeys) is dropped, initRuntime runs, the saved keys go back
// exactly as a load puts them, and the clone continues 2,000 ticks on the same command log. Its stateHash must
// equal the undisturbed run's every 100 ticks. A failure names the first rt key whose rebuild differs from the
// live value at the drop (or says none did: then a hidden cache outside s.rt decided something).
// Scenes at D = 1: plain play (seeds 1-3, 2 game days, 20 seeded ticks each), mid-raid (seed 1, the first
// horde, 8 ticks while the raid is live) and day-phase changes (seed 2, ticks either side of dawn and dusk).
// "Mid-raid on two levels" and "6 miners digging" join with the z-level steps (E3, E11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initRuntime, stateHash, raidLive } from '../../js/game/core/state.js';
import { droppableKeys, savedKeys, rtEqual } from '../../js/game/core/rtcontract.js';
import { rint } from '../../js/game/core/rand.js';
import { installSim } from '../../js/game/core/setup.js';
import { runBot2 } from '../lib/bot2.mjs';
import { botFound } from '../lib/bot.mjs';
import { runLog } from './slice-scene.mjs';

const DAY = 14400, HOUR = 600, SPAN = 2000, EVERY = 100;

/** A load-like clone: saved state copied, rt rebuilt by initRuntime, saved rt keys put back (as loadBlob does). */
export function dropClone(s) {
  const { rt, ...rest } = s;
  const c = structuredClone(rest);
  initRuntime(c);
  for (const k of savedKeys(raidLive(s))) c.rt[k] = structuredClone(rt[k]);
  return c;
}

/**
 * Play bot seed `seed` for `days`, then replay its log; at each tick of `pick(s)` (returns true to drop there)
 * fork a dropped clone; continue every clone SPAN ticks and compare hashes every EVERY ticks.
 */
async function scene(seed, days, pick, maxDrops) {
  installSim({ stage: '2', reset: true });
  const bot = await runBot2({ seed, days });
  const log = bot.log, start = botFound(seed, '2').tick, end = start + days * DAY;
  const ref = new Map(), forks = [];
  await runLog(botFound(seed, '2'), log, end + SPAN, {
    onTickEnd: (s) => {
      if (s.tick % EVERY === 0) ref.set(s.tick, stateHash(s));
      if (s.tick < end && forks.length < maxDrops && pick(s, s.tick - start)) {
        const c = dropClone(s);
        const differ = droppableKeys().filter((k) => !rtEqual(s.rt[k], c.rt[k]));
        forks.push({ at: s.tick, c, differ, raid: raidLive(s) });
      }
    },
  });
  const bad = [];
  for (const f of forks) {
    let first = -1;
    await runLog(f.c, log, f.at + SPAN, {
      onTickEnd: (s) => { if (first < 0 && s.tick % EVERY === 0 && ref.has(s.tick) && ref.get(s.tick) !== stateHash(s)) first = s.tick; },
    });
    if (first >= 0) bad.push(`drop at ${f.at}: hash differs at ${first}; ${f.differ.length ? 'rebuild differs for ' + f.differ.join(', ') : 'no rt key differs at the drop (a cache outside s.rt?)'}`);
  }
  return { forks, bad, checks: forks.length * (SPAN / EVERY) };
}

const seeded = (seed, lo, hi, n) => {
  const r = { rng: { m: (0xcd0 + seed) >>> 0 } }, out = new Set();
  while (out.size < n) out.add(rint(r, 'm', lo, hi));
  return out;
};

for (const seed of [1, 2, 3]) {
  test(`cache-drop, plain play: bot seed ${seed}, 2 days, 20 seeded drops, continued ${SPAN} ticks`, async () => {
    const at = seeded(seed, 200, 2 * DAY - 200, 20);
    const phase = seed === 2 ? new Set([5, 6, 7, 18, 19, 20, 21].flatMap((h) => [DAY + h * HOUR - 1, DAY + h * HOUR])) : new Set();   // by clock time
    const r = await scene(seed, 2, (s, t) => at.has(t) || phase.has(s.tick % DAY + DAY), 40);
    assert.ok(r.forks.length >= 20, `${r.forks.length} drops`);
    assert.deepEqual(r.bad, [], r.bad.slice(0, 3).join('\n'));
  });
}

test('cache-drop, mid-raid: bot seed 1, 8 drops while the first horde is live', async () => {
  let live = 0;
  const r = await scene(1, 10, (s) => raidLive(s) && s.foes.length > 0 && (++live % 97 === 1), 8);
  assert.ok(r.forks.length === 8 && r.forks.every((f) => f.raid), `${r.forks.length} drops mid-raid`);
  assert.deepEqual(r.bad, [], r.bad.slice(0, 3).join('\n'));
});
