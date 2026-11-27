// Stage 2 save fixtures (EMBERCROWN-FORTRESS.md 8.2 step S9.0; owner J). Captures a real Stage 2 save
// from a given build of the game and records, in a JSON sidecar, what THAT build does next: the
// stateHash after 1 game day of continuation (loaded from the blob, no commands) and each colonist's
// mood after 1 game hour. The sidecar is the oracle the later steps migrate against (5.3, 5.4, S9.7).
//
//   node tools/capture-fixture.mjs --root=../ec-078 --seed=3 --day=60 --out=tools/fixtures/v2-s2-day60.ecsave
//   node tools/capture-fixture.mjs --root=../ec-078 --at=midraid --seed=3 --out=tools/fixtures/v2-s2-midraid.ecsave
//   node tools/capture-fixture.mjs --root=../ec-078 --at=pending --difficulty=ironhold --seed=3 --out=tools/fixtures/v2-s2-iron.ecsave
//   node tools/capture-fixture.mjs --root=. --rebaseline --out=tools/fixtures/v2-s2-day60.ecsave
//
// --root      the game tree whose code makes the save and the continuation (a `git worktree` of the
//             build; default: this tree). Every game module is imported from there, never from here.
// --at        what to capture: day (the end of --day, default), midraid (a live reaver raid with a
//             reaver foe in melee reach of a standing colonist, after --melee=N melee ticks, default
//             30) or pending (the first tick a colonist has an untaken perk choice).
// --seed, --difficulty, --storyteller, --max-days (search limit for midraid/pending, default 120)
// --rebaseline  keep the .ecsave and the original sidecar block; recompute the continuation with
//             --root's code into `rebaselined` (a step that changes behaviour on purpose does this,
//             and says so in its report; the original `continue` block is never overwritten).
// --bot       v2 (default: colony bot v2, tools/lib/bot2.mjs of --root, the same player the Stage 2 gate runs) or v4
//             (colony bot v4 on a 128 x 128 x 20 hold with every Z3 system, tools/lib/bot4.mjs; W0.1 of
//             EMBERCROWN-WORLD.md). v4 also takes --at=flood (the fluid active set >= --fluid=N, default 8, for
//             --for=M ticks in a row, default 30) and --at=beast (a great beast on the map for --for ticks), and
//             its sidecar also records the hash after 2 game days of continuation (`day2`, the legacy-hash rule).
//             --breach-day=D (with --at=flood): bot v4 plays no flood in its first 120 days on seed 3, so at the
//             start of game day D water is let in from below, as a miner would (the rock under the first water voxel over
//             mineable rock, lowest level first, is mined out, as the Z3 gate mid-flood test does); the flood is captured once it runs.
// --days2     record `day2` for a v2 capture too.
// The continuation runs in a fresh child process (--continue), as a player's reload would.
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT_HERE = join(dirname(SELF), '..');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const has = (f) => process.argv.includes(f);
const root = resolve(arg('root', ROOT_HERE));
const mod = (p) => import(pathToFileURL(join(root, p)).href);

export const HOUR = 600, DAY = 14400;   // TICKS_PER_HOUR, TICKS_PER_DAY (js/game/core/time.js)

/** Load `bytes` with --root's code and continue 1 game hour (moods), then to 1 game day (hash). */
async function continueBlob(bytes, { days2 = false } = {}) {
  const [{ installSim }, { stateHash, checkState }, { tick }, { saveBlob, loadBlob }, codec] = await Promise.all([
    mod('js/game/core/setup.js'), mod('js/game/core/state.js'), mod('js/game/core/sim.js'), mod('js/game/save/colonysave.js'), mod('js/game/save/codec.js'),
  ]);
  installSim({ stage: '2' });
  // EC3 (a fortress) or EC2
  const { header } = (codec.readAnyHeader || codec.readHeader)(bytes);
  const run = async (reloadAtHour) => {
    let s = await loadBlob(bytes);
    const t0 = s.tick, hashAtLoad = stateHash(s);
    while (s.tick < t0 + HOUR && s.colony.fallen !== true) tick(s);
    const moods = s.col.map((c) => ({ id: c.id, name: c.name, mood: c.mood, dead: !!(c.hp && c.hp.dead) }));
    const hashHour = stateHash(s);
    if (reloadAtHour) s = await loadBlob(await saveBlob(s));
    while (s.tick < t0 + DAY && s.colony.fallen !== true) tick(s);
    const hashDay = stateHash(s), tickDay = s.tick, errs = checkState(s);
    let day2 = null;
    if (days2) { while (s.tick < t0 + 2 * DAY && s.colony.fallen !== true) tick(s); day2 = { tick: s.tick, hash: stateHash(s) }; }
    return { t0, hashAtLoad, hashHour, moods, hashDay, tickDay, errs, day2 };
  };
  const a = await run(false), b = await run(true);
  const two = days2 ? { day2: a.day2 } : {};
  return {
    stateVersion: header.stateVersion, formatVersion: header.formatVersion, compression: header.comp, tick: a.t0, hashAtLoad: a.hashAtLoad,
    hour: { tick: a.t0 + HOUR, hash: a.hashHour, moods: a.moods },
    day: { tick: a.tickDay, hash: a.hashDay },
    ...two,
    checks: { reloadAtHourSameDayHash: a.hashDay === b.hashDay, stateValidAtDay: a.errs.length === 0, errs: a.errs.slice(0, 3), ...(days2 ? { reloadAtHourSameDay2Hash: a.day2.hash === b.day2.hash } : {}) },
  };
}

function commitOf(dir) {
  try { return execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch (_) { return 'unknown'; }
}
function dirtyOf(dir) {
  try { return execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no', '--', 'js'], { encoding: 'utf8' }).trim().length > 0; } catch (_) { return null; }
}
function continueInChild(file, days2 = false) {
  const r = spawnSync(process.execPath, [SELF, `--root=${root}`, `--continue=${file}`, ...(days2 ? ['--days2'] : [])], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`continuation failed (${r.status}): ${(r.stderr || r.stdout).slice(-2000)}`);
  const line = r.stdout.trim().split('\n').pop();
  return JSON.parse(line);
}

/** Run bot v2 from founding and capture the first tick where `want(s)` holds. */
async function capture({ at, seed, day, difficulty, storyteller, maxDays, meleeTicks, bot, fluidMin, forTicks }) {
  const [{ runBot2 }, { snapshot, saveBlob }, codec, grid, perks, { raidLive, stateHash }] = await Promise.all([
    mod('tools/lib/bot2.mjs'), mod('js/game/save/colonysave.js'), mod('js/game/save/codec.js'), mod('js/game/core/grid.js'),
    mod('js/game/people/perks.js'), mod('js/game/core/state.js'),
  ]);
  const v4 = bot === 'v4';
  const fluids = v4 ? await mod('js/game/world/fluids.js') : null;
  const runBot = v4 ? (await mod('tools/lib/bot4.mjs')).runBot4 : runBot2;
  const breachDay = arg('breach-day', null) === null ? null : +arg('breach-day', '0');
  const [{ mineTile }] = breachDay !== null ? await Promise.all([mod('js/game/world/terrain.js')]) : [{}];
  let start = null, snap = null, info = null, melee = 0, held = 0, breach = null;
  const beastFoes = (s) => s.foes.filter((f) => f && f.st && f.st.gb);
  const STOP = { stop: true };
  const standing = (c) => c.hp && !c.hp.dead && !c.hp.down;
  const isReaver = (f) => String(f.kind).startsWith('reaver');   // the Ashfang reaver rows (js/data/raiders.js, kind 'reaver')
  const inMelee = (s) => {
    if (!raidLive(s)) return null;
    for (const f of s.foes) {
      if (!isReaver(f) || f.raid === null || f.raid === undefined) continue;
      const fx = grid.tileOfW(f.x), fy = grid.tileOfW(f.y);
      for (const c of s.col) if (standing(c) && grid.cheb(fx, fy, grid.tileOfW(c.x), grid.tileOfW(c.y)) <= 1) return { foe: f.id, kind: f.kind, col: c.id, colName: c.name };
    }
    return null;
  };
  const want = (s) => {
    if (start === null) start = s.tick - 1;
    const d = (s.tick - start) / DAY;
    if (at === 'day') return d === day ? { day } : null;
    if (at === 'midraid') { const m = inMelee(s); if (!m) { melee = 0; return null; } return ++melee >= meleeTicks ? { ...m, meleeTicks: melee } : null; }
    // W0.1 (bot v4): a flood in progress (the fluid active set at least fluidMin for forTicks ticks running) and a
    // great beast loose (a great beast foe on the map for forTicks ticks running)
    if (at === 'flood' && breachDay !== null && breach === null && d >= breachDay - 1) {
      const { PLANE, TER_MINEABLE } = grid;
      let hole = -1;
      for (let i = PLANE; i < s.L.fluid.length && hole < 0; i++) if ((s.L.fluid[i] & 7) >= 2 && TER_MINEABLE[s.L.terrain[i - PLANE]]) hole = i - PLANE;
      if (hole < 0) throw new Error('--breach-day: no water voxel over mineable rock');
      mineTile(s, hole);
      breach = { tick: s.tick, voxel: hole, x: hole % grid.W, y: Math.floor(hole / grid.W) % grid.H, z: Math.floor(hole / PLANE) };
    }
    if (at === 'flood') { const n = fluids.activeCount(s); if (n < fluidMin) { held = 0; return null; } return ++held >= forTicks ? { fluidActive: n, fluidMin, forTicks: held, ...(breach ? { breach } : {}) } : null; }
    if (at === 'beast') {
      const b = beastFoes(s);
      if (!b.length) { held = 0; return null; }
      return ++held >= forTicks ? { beasts: b.map((f) => ({ id: f.id, kind: f.kind, gb: f.st.gb, x: grid.tileOfW(f.x), y: grid.tileOfW(f.y), z: f.z })), forTicks: held } : null;
    }
    if (at === 'pending') {
      for (const c of s.col) { if (!standing(c)) continue; const p = perks.pendingChoices(c); if (p.length) return { col: c.id, colName: c.name, choices: p, perks: c.perks.slice() }; }
      return null;
    }
    throw new Error(`unknown --at=${at}`);
  };
  const res = await runBot({
    seed, ticks: (at === 'day' ? day : maxDays) * DAY + 1, storyteller, ...(difficulty !== null || !v4 ? { difficulty } : {}),
    onTick: (s) => { const w = want(s); if (w) { snap = snapshot(s); info = { ...w, hash: stateHash(s), tick: s.tick }; throw STOP; } },
  });
  if (!snap) throw new Error(`capture --at=${at}: condition never held in ${at === 'day' ? day : maxDays} days on seed ${seed} (${res.metrics.checks.filter((c) => !c.ok && !c.info).map((c) => c.name).join(', ')})`);
  const s = res.s;   // the bot stopped at the captured tick (the sentinel ends its loop)
  // v4: the EC3 blob with the pristine world embedded (as a dawn backup or an export is), so the fixture loads alone
  const bytes = v4 ? await saveBlob(s, undefined, { embed: true }) : await codec.encodeBlob(snap.header, snap.payload);
  const facts = {
    tick: s.tick, colonists: s.col.map((c) => c.name), alive: s.col.filter((c) => !c.hp.dead).length,
    foes: s.foes.length, reavers: s.foes.filter(isReaver).length, items: s.items.filter(Boolean).length, buildings: s.bld.filter(Boolean).length,
    raids: s.raids.map((r) => `${r.inc}:${r.stage}`), commands: res.log.length,
    colony: { difficulty: s.colony.difficulty, iron: s.colony.iron, storyteller: s.colony.storyteller },
    perks: Object.fromEntries(s.col.filter((c) => c.perks.length).map((c) => [c.name, c.perks.slice()])),
    ...(v4 ? { bot: 'v4', pristineEmbedded: true, fortress: { w: grid.W, d: s.L.terrain.length / (grid.W * grid.H), zS: s.zS }, fluidActive: fluids.activeCount(s), beasts: beastFoes(s).length } : {}),
  };
  return { bytes, info, facts };
}

const WHAT = {
  day: (o) => `A real Stage 2 save: colony bot v2, seed ${o.seed}, at the end of game day ${o.day}.`,
  midraid: (o) => `A real Stage 2 save mid-raid: colony bot v2, seed ${o.seed}, a live Ashfang reaver raid with a reaver in melee reach of a standing colonist for ${o.meleeTicks} ticks.`,
  v4day: (o) => `A real Stage Z3 save: colony bot v4 (every Z3 system on), seed ${o.seed}, a 128 x 128 x 20 hold at the end of game day ${o.day}.`,
  flood: (o) => `A real Stage Z3 save with a flood in progress: colony bot v4, seed ${o.seed}, ${o.breachDay !== null ? `water let in from below (the rock under the first water voxel over mineable rock, lowest level first, mined out) at the start of day ${o.breachDay}, then ` : ''}the fluid active set at least ${o.fluidMin} for ${o.forTicks} ticks running.`,
  beast: (o) => `A real Stage Z3 save with a great beast loose: colony bot v4, seed ${o.seed}, a great beast on the map for ${o.forTicks} ticks running.`,
  pending: (o) => `A real Stage 2 save with an untaken perk choice: colony bot v2, seed ${o.seed}, difficulty ${o.difficulty || 'default'}, at the first tick a colonist reached a key-skill perk level (bot v2 never answers perk letters).`,
};

async function main() {
  const cont = arg('continue', null);
  if (cont) { const r = await continueBlob(new Uint8Array(readFileSync(cont)), { days2: has('--days2') }); console.log(JSON.stringify(r)); return; }
  const out = arg('out', null);
  if (!out) { console.error('capture-fixture: --out=<file.ecsave> is required'); process.exit(2); }
  const sidecar = out.replace(/\.ecsave$/, '') + '.json';
  const commit = commitOf(root), dirty = dirtyOf(root);
  if (has('--rebaseline')) {
    const meta = JSON.parse(readFileSync(sidecar, 'utf8'));
    const c = continueInChild(out, !!meta.continue.day2);
    meta.rebaselined = { commit, dirty, date: new Date().toISOString().slice(0, 10), note: arg('note', ''), hour: c.hour, day: c.day, ...(c.day2 ? { day2: c.day2 } : {}), checks: c.checks };
    writeFileSync(sidecar, JSON.stringify(meta, null, 1) + '\n');
    console.log(`rebaselined ${basename(sidecar)} with ${commit}${dirty ? ' (dirty)' : ''}: day hash ${c.day.hash} (original ${meta.continue.day.hash})`);
    return;
  }
  const o = {
    at: arg('at', 'day'), seed: +arg('seed', '3'), day: +arg('day', '60'), difficulty: arg('difficulty', null), storyteller: arg('storyteller', null),
    maxDays: +arg('max-days', '120'), meleeTicks: +arg('melee', '30'),
    breachDay: arg('breach-day', null) === null ? null : +arg('breach-day', '0'), bot: arg('bot', 'v2'), fluidMin: +arg('fluid', '8'), forTicks: +arg('for', '30'),
  };
  if (!['v2', 'v4'].includes(o.bot)) { console.error(`capture-fixture: unknown --bot=${o.bot} (v2, v4)`); process.exit(2); }
  if ((o.at === 'flood' || o.at === 'beast') && o.bot !== 'v4') { console.error(`capture-fixture: --at=${o.at} needs --bot=v4`); process.exit(2); }
  const days2 = o.bot === 'v4' || has('--days2');
  const t0 = Date.now();
  const { bytes, info, facts } = await capture(o);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, bytes);
  const c = continueInChild(out, days2);
  const ok = c.hashAtLoad === info.hash && c.checks.reloadAtHourSameDayHash && c.checks.stateValidAtDay && (!days2 || c.checks.reloadAtHourSameDay2Hash);
  const meta = {
    file: basename(out),
    what: WHAT[o.bot === 'v4' && o.at === 'day' ? 'v4day' : o.at]({ ...o, meleeTicks: info.meleeTicks, forTicks: info.forTicks }),
    made: `node tools/capture-fixture.mjs ${process.argv.slice(2).filter((x) => !x.startsWith('--root=')).join(' ')} --root=<worktree of ${commit}>`,
    commit, dirty, bytes: bytes.length,
    stateVersion: c.stateVersion, formatVersion: c.formatVersion, compression: c.compression === 1 ? 'deflate-raw' : c.compression === 2 ? 'rle' : c.compression, seed: o.seed, tick: info.tick, hashAtSave: info.hash,
    at: info, ...facts,
    continue: { what: 'loaded from the blob by the capturing build in a fresh process, ticked with no commands', hour: c.hour, day: c.day, ...(c.day2 ? { day2: c.day2 } : {}), checks: c.checks },
    ms: Date.now() - t0,
  };
  writeFileSync(sidecar, JSON.stringify(meta, null, 1) + '\n');
  console.log(`${ok ? 'ok' : 'FAILED'} ${basename(out)}: ${bytes.length} B, tick ${info.tick}, save hash ${info.hash}, load hash ${c.hashAtLoad}, day hash ${c.day.hash}, reload-at-hour same: ${c.checks.reloadAtHourSameDayHash}`);
  if (!ok) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
export { continueBlob };
