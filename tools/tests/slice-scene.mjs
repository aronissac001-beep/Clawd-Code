// The Stage 1a slice scene for the determinism checks (owner A; doc 14.4 (a)-(e), 14.6 row A).
// Not a test file itself (no .test.mjs): tools/tests/slice-determinism.test.mjs runs it in Node,
// and a WebKit page imports it unchanged (relative imports only, no Node built-ins).
//
//   sliceColony(seed)            installSim('1a') + foundColony(seed): the real new-colony flow
//   sliceLog(s, ticks, seed)     a seeded command log [[tick, cmd]] for the slice (designations,
//                                carve, stamps, zones, bills, walls, cancel, deconstruct, forbid,
//                                priorities, schedules, beds), built from the colony's own layout;
//                                a few invalid commands that must be dropped are mixed in
//   runLog(s, log, end, opts)    replay: commands at their ticks, then tick(s); opts.perFrame,
//                                opts.onTickEnd(s), opts.saveAt (Set of ticks: save + load there)
//   runSliceSuite(opts)          the checks (a)-(e) on the slice; returns { ok, hash, checks, ... }
// The log is a pure function of (initial state, seed); a command is validated when it is applied,
// so a command that no longer fits (rock already mined, tile taken) is dropped the same way in
// every run.

import { installSim, foundColony, findSite } from '../../js/game/core/setup.js';
import { tick } from '../../js/game/core/sim.js';
import { applyCommand } from '../../js/game/core/commands.js';
import { stateHash, checkState } from '../../js/game/core/state.js';
import { rebuilderOf, rebuildKeys, rtEqual, verifyCaches, checkRt, dirtyClear } from '../../js/game/core/rtcontract.js';
import { rint } from '../../js/game/core/rand.js';
import { W, H, idx, inB, TER, TER_MINEABLE } from '../../js/game/core/grid.js';
import { all, hasFlag } from '../../js/game/core/content.js';
import { saveBlob, loadBlob } from '../../js/game/save/colonysave.js';
import { TICKS_PER_DAY } from '../../js/game/core/time.js';
import { mineTile, setOcc } from '../../js/game/world/terrain.js';
import { spawn as spawnItem } from '../../js/game/work/items.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export function sliceColony(seed = 'SLICE-1', opts = {}) {
  installSim({ stage: '1a', checks: !!opts.checks });
  return foundColony({ seed, name: 'Slice Hold', ...opts.found });
}

/** Nearest rock tile to (x, y) by rings: [x, y] or null. */
function nearestRock(s, x, y) {
  for (let r = 1; r < Math.max(W, H); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (inB(xx, yy) && s.L.terrain[idx(xx, yy)] === TER.ROCK) return [xx, yy];
    }
  }
  return null;
}
/** Walk from (x, y) in direction (dx, dy) while inside rock; how deep the rock goes (max lim). */
function rockRun(s, x, y, dx, dy, lim) {
  let n = 0;
  while (n < lim && inB(x + dx * n, y + dy * n) && TER_MINEABLE[s.L.terrain[idx(x + dx * n, y + dy * n)]]) n++;
  return n;
}
const R = (x0, y0, x1, y1) => ({ x0: Math.max(0, Math.min(W - 1, x0)), y0: Math.max(0, Math.min(H - 1, y0)), x1: Math.max(0, Math.min(W - 1, x1)), y1: Math.max(0, Math.min(H - 1, y1)) });

/** A seeded slice command log for colony `s` (read only; nothing is applied). */
export function sliceLog(s, ticks = 6000, seed = 0x51ce) {
  const r = { rng: { m: seed >>> 0 } };
  const ri = (a, b) => rint(r, 'm', a, b);
  const hb = s.colony.hearth && s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null;
  const hx = hb ? hb.x + 1 : W >> 1, hy = hb ? hb.y + 1 : H >> 1;
  const log = [];
  const t0 = s.tick;  // the log starts at the colony's tick (a new colony starts at 06:00)
  const at = (t, cmd) => { if (t < ticks) log.push([t0 + t, cmd]); };
  // the rock face nearest the Hearth and the direction into the massif
  const face = nearestRock(s, hx, hy) || [hx + 10, hy];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let dir = dirs[0], best = -1;
  for (const d of dirs) { const n = rockRun(s, face[0], face[1], d[0], d[1], 40); if (n > best) { best = n; dir = d; } }
  const [fx, fy] = face, [ddx, ddy] = dir;
  const into = (k, side = 0) => [fx + ddx * k - ddy * side, fy + ddy * k + ddx * side];
  // open ground for stamps and zones near the Hearth
  const spot = (w, h, ox, oy) => findSite(s, hx + ox, hy + oy, w, h, 1) || [hx + ox, hy + oy];
  const struct = (flag) => all('structure').filter((d) => hasFlag(d, flag));
  const bench = all('structure').find((d) => d.workbench) || null;
  const wall = struct('wall').find((d) => !hasFlag(d, 'door'));
  const stamps = all('stamp').map((d) => d.id);
  // 1. a stockpile by the Hearth
  const [zx, zy] = spot(5, 5, 4, 4);
  at(3, { t: 'zone', op: 'new', type: 'stockpile', rect: R(zx, zy, zx + 4, zy + 4), preset: all('zonePreset').length ? all('zonePreset')[0].id : undefined });
  // 2. chop the nearest trees
  at(8, { t: 'designate', kind: 'chop', rect: R(hx - 16, hy - 16, hx + 16, hy + 16), add: true });
  // 3. mine a tunnel into the massif, then carve a hall at its end
  const [a0, b0] = into(0, -1), [a1, b1] = into(7, 1);
  at(12, { t: 'designate', kind: 'mine', rect: R(a0, b0, a1, b1), add: true });
  const [c0, d0] = into(8, -4), [c1, d1] = into(16, 4);
  at(30, { t: 'carve', rect: R(c0, d0, c1, d1), pattern: 'pillar', smooth: true });
  const [e0, f0] = into(4, 6), [e1, f1] = into(12, 14);
  at(45, { t: 'carve', rect: R(e0, f0, e1, f1), pattern: 'natural', smooth: false });
  // 4. room stamps on open ground
  if (stamps.length) {
    const [bx, by] = spot(5, 4, -12, 3);
    at(60, { t: 'stamp', kind: stamps.includes('bedroom') ? 'bedroom' : stamps[0], rect: R(bx, by, bx + 4, by + 3), furnish: true });
    const [wx, wy] = spot(7, 6, -14, -10);
    at(90, { t: 'stamp', kind: stamps.includes('workshop') ? 'workshop' : stamps[0], rect: R(wx, wy, wx + 6, wy + 5), furnish: true, ...(bench ? { bench: bench.id } : {}) });
    const [sx, sy] = spot(6, 5, 10, -12);
    at(120, { t: 'stamp', kind: stamps.includes('store') ? 'store' : stamps[0], rect: R(sx, sy, sx + 5, sy + 4), furnish: true });
  }
  // 5. a bench placed by hand, with bills on whatever bench exists
  if (bench) {
    const [px, py] = spot(bench.size ? bench.size[0] : 2, bench.size ? bench.size[1] : 2, -6, 10);
    at(150, { t: 'place', def: bench.id, x: px, y: py, rot: 0 });
  }
  // 6. a wall line
  if (wall) {
    const [lx, ly] = spot(6, 1, 8, 10);
    at(200, { t: 'placeLine', def: wall.id, path: [0, 1, 2, 3, 4, 5].map((k) => [lx + k, ly]) });
  }
  // 7. through the run: more digging, cancels, zone edits, forbids, priorities, bed owners
  for (let t = 240; t < ticks; t += 90 + ri(0, 120)) {
    const k = ri(0, 11);
    const [x, y] = into(ri(0, 24), ri(-10, 10));
    if (k <= 3) at(t, { t: 'designate', kind: 'mine', rect: R(x, y, x + ri(0, 4), y + ri(0, 4)), add: true });
    else if (k === 4) at(t, { t: 'cancelRect', rect: R(x, y, x + ri(1, 5), y + ri(1, 5)), kinds: ['mine', 'bp'] });
    else if (k === 5) at(t, { t: 'zone', op: 'expand', zoneId: 1, rect: R(zx - 2, zy, zx - 1, zy + 4) });
    else if (k === 6) at(t, { t: 'zoneCfg', zoneId: 1, patch: { pri: ri(0, 3) } });
    else if (k === 7) at(t, { t: 'forbid', rect: R(hx - 12, hy - 12, hx + 12, hy + 12), on: ri(0, 1) === 1 });
    else if (k === 8 && s.col.length) at(t, { t: 'prio', colId: s.col[ri(0, s.col.length - 1)].id, work: ['mine', 'build', 'haul', 'chop', 'craft'][ri(0, 4)], p: ri(1, 4) });
    else if (k === 9 && s.col.length) at(t, { t: 'sched', colId: s.col[0].id, hours: Array.from({ length: 24 }, (_, h) => (h < 6 || h >= 22 ? 0 : ri(1, 3))) });
    else if (k === 10) at(t, { t: 'deconstruct', rect: R(hx - 20, hy - 20, hx - 15, hy - 15) });
    else at(t, { t: 'designate', kind: 'chop', rect: R(hx - 24, hy - 24, hx + 24, hy + 24), add: ri(0, 3) > 0 });
    if (ri(0, 6) === 0) at(t, { t: 'designate', kind: 'nope', rect: R(0, 0, 1, 1), add: true }); // invalid: dropped
  }
  log.sort((p, q) => p[0] - q[0]); // stable: same-tick entries keep their order
  return log;
}

/** Replay `log` on `s` up to tick `end`. Returns the (possibly reloaded) state. */
export async function runLog(s, log, end, { perFrame = 1, onTickEnd = null, saveAt = null, onCommand = null } = {}) {
  let li = 0;
  while (li < log.length && log[li][0] < s.tick) li++;
  while (s.tick < end) {
    for (let k = 0; k < perFrame && s.tick < end; k++) {
      while (li < log.length && log[li][0] === s.tick) { const res = applyCommand(s, log[li++][1]); if (onCommand) onCommand(res); }
      tick(s);
      if (onTickEnd) onTickEnd(s);
      if (saveAt && saveAt.has(s.tick)) s = await loadBlob(await saveBlob(s));
    }
  }
  return s;
}

/** The determinism checks (a)-(e) on the slice. */
export async function runSliceSuite({ seed = 'SLICE-1', ticks = 6000, engine = 'node' } = {}) {
  const t0 = now();
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const fresh = () => sliceColony(seed);
  const s0 = fresh(), start = s0.tick, end = start + ticks;
  const log = sliceLog(s0, ticks);
  const stats = { accepted: 0, refused: 0 };
  // (a)
  const a = await runLog(s0, log, end, { onCommand: (r) => { if (r.ok) stats.accepted++; else stats.refused++; } });
  const b = await runLog(fresh(), log, end);
  const ha = stateHash(a), hb = stateHash(b);
  add('(a) same seed and log twice', ha === hb, `${ha} vs ${hb}`);
  const errs = checkState(a), rtk = checkRt(a.rt);
  add('state valid at end', errs.length === 0 && rtk.unlisted.length === 0 && rtk.missing.length === 0, errs.slice(0, 3).join('; ') + rtk.unlisted.join(','));
  const live = (arr) => arr.filter(Boolean).length;
  const mined = (() => { let n = 0; for (let i = 0; i < a.L.terrain.length; i++) if (a.L.terrain[i] === TER.ROUGH) n++; return n; })();
  add('the slice did something', stats.accepted >= 10, `commands ${stats.accepted} accepted / ${stats.refused} refused; bld ${live(a.bld)}, items ${live(a.items)}, zones ${a.zones.length}, rough floor ${mined}, plans ${a.colony.plans.length}`);
  const other = await runLog(sliceColony(seed + 'x'), sliceLog(sliceColony(seed + 'x'), ticks), end);
  add('a different seed differs', stateHash(other) !== ha);
  // (b) saves at 5 seeded ticks (no raids in 1a: every tick is a non-raid tick)
  const r = { rng: { m: 0x5a5e } };
  const saveAt = new Set(); while (saveAt.size < 5) saveAt.add(start + rint(r, 'm', 30, ticks - 30));
  const c = await runLog(fresh(), log, end, { saveAt });
  add('(b) save and load at 5 ticks, then continue', stateHash(c) === ha, `saves at ${[...saveAt].sort((x, y) => x - y).join(', ')}`);
  // (c) 1x and 5x
  const d = await runLog(fresh(), log, end, { perFrame: 5 });
  add('(c) 1x and 5x identical', stateHash(d) === ha);
  // (d) reservations equal rebuildFromJobs at every tick end; (e) caches at 20 seeded ticks; dirty clear
  const r2 = { rng: { m: 0xe0e } };
  const cacheAt = new Set(); while (cacheAt.size < 20) cacheAt.add(start + rint(r2, 'm', 1, ticks));
  const resRebuild = rebuilderOf('res');
  let resBad = 0, dirtyBad = 0; const cacheBad = [];
  await runLog(fresh(), log, end, {
    onTickEnd: (s) => {
      if (!resRebuild || !rtEqual(s.rt.res, resRebuild(s))) resBad++;
      if (!dirtyClear(s.rt.dirty)) dirtyBad++;
      if (cacheAt.has(s.tick)) { const bad = verifyCaches(s); if (bad.length) cacheBad.push(`${s.tick}:${bad.join('/')}`); }
    },
  });
  add('(d) reservations equal rebuildFromJobs at every tick end', resRebuild && resBad === 0, resRebuild ? `${resBad} mismatching ticks` : 'no res rebuild registered');
  add('(e) every cache equals a rebuild at 20 ticks', cacheBad.length === 0, cacheBad.slice(0, 3).join(', ') || `keys ${rebuildKeys().join(' ')}`);
  add('dirty flags clear at every tick end', dirtyBad === 0, `${dirtyBad} ticks`);
  return { engine, ok: checks.every((x) => x.ok), hash: ha, ticks, ms: Math.round(now() - t0), commands: log.length, checks };
}

/**
 * A day-5 colony for the save-size budget (blob < 40 KB at bot day 5, 14.6 row A) until J's colony
 * bot exists: the real founding and slice log for `logTicks`, then what the 1a bot targets say a
 * day-5 colony has done (>= 80 tiles mined plus a carved hall of >= 40, three bedrooms and a workshop
 * built, stone piles and wood in stock), written through the terrain and item APIs, then real ticks
 * up to day 5. Deterministic.
 */
export async function day5Colony(seed = 'DAY5-1', { logTicks = 3000, mine = 160, piles = 120, days = 5 } = {}) {
  const s0 = sliceColony(seed);
  let s = await runLog(s0, sliceLog(s0, logTicks), s0.tick + logTicks);
  // mining: every Mine designation first (the tunnel and the carved halls), then nearest rock to the Hearth
  let n = 0;
  for (let i = 0; i < s.L.desig.length && n < mine; i++) if ((s.L.desig[i] & 1) && TER_MINEABLE[s.L.terrain[i]]) { mineTile(s, i, null); s.L.desig[i] &= ~1; n++; }
  const hb = s.bld[s.colony.hearth.id];
  for (let r = 1; r < W && n < mine; r++) {
    for (let dy = -r; dy <= r && n < mine; dy++) for (let dx = -r; dx <= r && n < mine; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = hb.x + dx, y = hb.y + dy;
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      // only rock next to open floor, so the dig is one connected tunnel system
      if (s.L.terrain[i] !== TER.ROCK) continue;
      let open = false;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = inB(x + ax, y + ay) ? idx(x + ax, y + ay) : -1; if (j >= 0 && s.L.terrain[j] === TER.ROUGH) open = true; }
      if (!open) continue;
      mineTile(s, i, null); n++;
    }
  }
  // finished blueprints (the stamped rooms, the workshop, the wall line)
  for (const b of s.bld) if (b && b.st !== 'done') { setOcc(s, b, false); b.st = 'done'; b.got = { ...b.need }; b.work = 0; setOcc(s, b, true); }
  // stock: stone piles from the dig and chopped wood near the Hearth
  const stoneKind = all('item').find((d) => d.id === 'stone') ? 'stone' : all('item')[0].id;
  const woodKind = all('item').find((d) => d.id === 'wood') ? 'wood' : stoneKind;
  for (let k = 0; k < piles; k++) spawnItem(s, stoneKind, 'granite', 0, 1 + (k % 20), hb.x - 8 + (k % 16), hb.y + 6 + ((k / 16) | 0));
  for (let k = 0; k < 12; k++) spawnItem(s, woodKind, 'wood', 0, 25, hb.x + 4 + k, hb.y - 6);
  // real ticks up to day `days` (the derived caches and end-of-tick passes catch up as they would)
  const end = days * TICKS_PER_DAY;
  while (s.tick < end) tick(s);
  return { s, mined: n };
}
