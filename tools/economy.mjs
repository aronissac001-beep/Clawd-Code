// Day-economy acceptance (EMBERCROWN-REWORK.md, stream E): plays region 1 headless with the
// tools/pacing.mjs players and a few scripted scenarios, and measures the economy targets.
//   node tools/economy.mjs [seeds=10] [difficulty=standard] [--verbose]
// Players:
//   modest  the tools/runsim.mjs builder (one decision every 2 s), as in tools/pacing.mjs.
//   afk     places a Farm, a Lumber Camp and a House, then does nothing.
//   nowood  builds Houses and Farms only (never a Lumber Camp): the no-wood soft-lock guard.
// Scenarios: 500 Hearth damage repaired on a calm day (material spent), shelter pops.
import '../js/game/content.js';
import { createNewRun, travelOptions, enterNode } from '../js/game/run.js';
import { tick, applyCommand, canPlace } from '../js/game/sim.js';
import { BAL } from '../js/data/balance.js';
import { anyAffordable, idleCount, placeInfo } from '../js/game/systems/economy.js';
import { T } from '../js/game/grid.js';

const args = process.argv.slice(2);
const SEEDS = +(args.find((a) => /^\d+$/.test(a)) || 10);
const DIFF = args.find((a) => /^(story|standard|brutal)$/.test(a)) || 'standard';
const VERBOSE = args.includes('--verbose');
const TRACE = args.includes('--trace'); // print the modest bot's day, check by check (first seed)

function firstRegion(seed) {
  const run = createNewRun({ seedText: seed, difficulty: DIFF, faction: 'dawnhold' });
  const opts = travelOptions(run);
  const id = opts.find((x) => run.map.nodes[x].type === 'region') || opts[0];
  enterNode(run, id);
  // No free starter hero (stream C removes it; a no-op once it has).
  for (const e of run.region.heroes) e.alive = false;
  return run.region;
}
function tryBuild(s, type) {
  const h = s.rt.hearth;
  for (let r = 3; r < 11; r++) for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2 + r;
    const tx = Math.round(h.tx + 1 + Math.cos(ang) * r), ty = Math.round(h.ty + 1 + Math.sin(ang) * r);
    if (canPlace(s, type, tx, ty).ok) return applyCommand(s, { t: 'place', type, tiles: [[tx, ty]] }).ok;
  }
  return false;
}
function choose(s) {
  let i = 0;
  if (s.pending.kind === 'blueprint') for (const t of ['barracks', 'ballista', 'brazier', 'spire', 'granary']) { const j = s.pending.options.indexOf(t); if (j >= 0) { i = j; break; } }
  if (!applyCommand(s, { t: 'choose', i }).ok) for (const j of [0, 1, 2, 3, 4, 5, -1]) if (applyCommand(s, { t: 'choose', i: j }).ok) break;
}
const CORE = ['farm', 'lumber', 'house', 'lumber', 'farm', 'quarry'];
const LATER = ['tower', 'house', 'brazier', 'ballista', 'tower', 'farm', 'spire', 'house', 'granary', 'tower', 'market', 'trap', 'tower', 'ballista', 'house', 'tower'];
const count = (s, t) => s.buildings.filter((b) => b.type === t).length;
function nextBuild(s) {
  const have = {};
  for (const t of CORE) { have[t] = (have[t] || 0) + 1; if (count(s, t) < have[t]) return t; }
  if (s.blueprints.includes('barracks') && count(s, 'barracks') === 0) return 'barracks';
  const want = {};
  for (const t of LATER) { want[t] = (want[t] || 0) + 1; if ((!s.blueprints.length || s.blueprints.includes(t)) && count(s, t) < want[t]) return t; }
  return null;
}
/** The modest player; returns the number of useful actions it took this decision. */
function modest(s, ticks, M) {
  if (ticks % 40 !== 0) return 0;
  let n = 0;
  if (s.cycle.phase === 'day' && s.cycle.night === 0) { M.checks++; if (anyAffordable(s)) M.affordable++; }
  const t = nextBuild(s);
  if (t) { if (tryBuild(s, t)) n++; else for (const k of ['wood', 'stone']) if (s.res[k] < 50 && s.res.gold > 70 && applyCommand(s, { t: 'trade', k }).ok) n++; }
  if (s.res.food < 30 && s.res.gold > 60 && applyCommand(s, { t: 'trade', k: 'food' }).ok) n++;
  const b = s.buildings.find((x) => x.type === 'barracks' && x.built);
  if (b && s.res.gold >= 20 && s.res.food > 30 && applyCommand(s, { t: 'train', id: b.id, u: ['spearman', 'archer', 'militia', 'archer'][(ticks / 40) % 4 | 0] }).ok) n++;
  const up = s.buildings.find((x) => x.built && !x.upg && x.type === 'tower' && x.level < 2);
  if (up && s.res.wood > 60 && s.res.stone > 50 && applyCommand(s, { t: 'upgrade', id: up.id }).ok) n++;
  if (s.sovereign && s.sovereign.novaCd <= 0 && s.enemies.filter((e) => !e.stationary && !e.flying).length > 4) applyCommand(s, { t: 'ability', name: 'nova' });
  if (s.sovereign && s.sovereign.bannerCd <= 0 && s.cycle.phase === 'night' && s.enemies.length > 6) applyCommand(s, { t: 'ability', name: 'banner' });
  if (s.beaconReady && s.cycle.phase === 'day') applyCommand(s, { t: 'lightBeacon' });
  return n;
}
function afk(s, ticks, st) {
  if (st.placed < 3 && ticks % 20 === 0) { if (tryBuild(s, ['farm', 'lumber', 'house'][st.placed])) st.placed++; }
  return 0;
}
function nowood(s, ticks) {
  if (ticks % 40 !== 0) return 0;
  const t = count(s, 'farm') < 2 ? 'farm' : 'house';
  return tryBuild(s, t) ? 1 : 0;
}

/** Play region 1 with a player and measure the economy. */
function play(s, player) {
  const M = { checks: 0, affordable: 0, days: [], dayIdle: 0, dayVill: 0, pops: 0, popMax: 0, capBad: 0, lumps: 0, softlocks: 0, gifts: 0 };
  let ticks = 0, day = null;
  const st = { placed: 0 };
  const prev = new Map();
  const cap = BAL.villager.maxBuilders * BAL.villager.repairPerSec;
  while (!s.outcome && ticks < 20 * 60 * 12 && s.cycle.night < 3) {
    if (s.pending) choose(s);
    const n = player === 'modest' ? modest(s, ticks, M) : player === 'afk' ? afk(s, ticks, st) : nowood(s, ticks);
    if (day) day.actions += n;
    if (TRACE && player === 'modest' && ticks % 40 === 0 && s.cycle.phase === 'day') console.log(`d${s.cycle.night + 1} t${s.cycle.t.toFixed(0)} res ${Object.values(s.res).map((x) => x | 0).join('/')} +${n} next ${nextBuild(s)} aff ${anyAffordable(s)} bank ${Object.values((s.econ || { bank: {} }).bank).map((x) => x | 0).join('/')} pop ${s.villagers.length} idle ${idleCount(s)}`);
    tick(s); ticks++;
    for (const ev of s.rt.fx) {
      if (ev.t === 'incomeLump') M.lumps++;
      if (ev.t === 'softlock' && !ev.clear) { M.softlocks++; if (day) day.prompt = true; }
      if (ev.t === 'toast' && /carter/.test(ev.text)) M.gifts++;
    }
    s.rt.fx.length = 0;
    const h = s.rt.hearth;
    // Day bookkeeping: actions, wood produced, Hearth health at the start and at dusk.
    if (s.cycle.phase === 'day' && (!day || day.n !== s.cycle.night)) {
      day = { n: s.cycle.night, actions: 0, wood0: s.stats.produced.wood, hp0: h ? h.hp : 0, len: 0, prompt: !!(s.econ && s.econ.softlock), wm: 1 };
      M.days.push(day);
    }
    if (day && s.cycle.phase === 'day') { day.len += 0.05; day.wm = Math.max(day.wm, s.rt.workMult || 1); }
    if (day && s.cycle.phase === 'dusk' && day.hpDusk === undefined) {
      day.hpDusk = h ? h.hp : 0;
      day.wood = s.stats.produced.wood - day.wood0;
      if (day.hpDusk > day.hp0 + cap * day.len * day.wm + 0.5) M.capBad++;
    }
    // Idle share of villager daylight.
    if (s.cycle.phase === 'day') {
      for (const v of s.villagers) { if (!v.alive) continue; M.dayVill++; if (!v.job && !v.build && (v.st === 'idle' || v.st === 'home' || v.st === 'athome' || v.st === 'wander')) M.dayIdle++; }
    }
    // Pops: any villager moving more than 24 units in one tick.
    for (const v of s.villagers) {
      const p = prev.get(v.id);
      if (p) { const d = Math.hypot(v.x - p[0], v.y - p[1]); if (d > 24) M.pops++; if (d > M.popMax) M.popMax = d; }
      prev.set(v.id, [v.x, v.y]);
    }
  }
  M.outcome = s.outcome ? s.outcome.result : 'n' + s.cycle.night;
  return M;
}

/** 500 Hearth damage at the start of a day with nothing else to do: repairs cost material. */
function repairScenario(seed) {
  const s = firstRegion(seed);
  while (s.pending) choose(s);
  // Skip to the day after night 1 without building anything.
  let g = 0;
  while (s.cycle.night < 1 && g++ < 20 * 400) { if (s.pending) choose(s); tick(s); s.rt.fx.length = 0; }
  while (s.cycle.phase !== 'day' && g++ < 20 * 400) { if (s.pending) choose(s); tick(s); s.rt.fx.length = 0; }
  const h = s.rt.hearth;
  h.hp = Math.max(1, h.maxHp - 500); h.lastHit = s.time - 100;
  s.res.stone = 200;
  const hp0 = h.hp, stone0 = s.res.stone, wood0 = s.res.wood;
  while (s.cycle.phase === 'day' && g++ < 20 * 400) { if (s.pending) choose(s); tick(s); s.rt.fx.length = 0; }
  return { healed: h.hp - hp0, stone: stone0 - s.res.stone, wood: wood0 - s.res.wood };
}

const out = { idle: [], afford: [], minActions: [], capBad: 0, pops: 0, popMax: 0, woodZeroNoPrompt: 0, lumps: 0, nowoodPrompt: 0, nowoodGift: 0, outcomes: [] };
const rows = [];
for (let k = 0; k < SEEDS; k++) {
  const seed = 'PACE-' + k;
  if (TRACE && k) break;
  for (const player of (TRACE ? ['modest'] : ['modest', 'afk', 'nowood'])) {
    const s = firstRegion(seed);
    const M = play(s, player);
    const idle = M.dayVill ? (100 * M.dayIdle) / M.dayVill : 0;
    out.capBad += M.capBad; out.pops += M.pops; out.popMax = Math.max(out.popMax, M.popMax);
    for (const d of M.days) if (d.wood === 0 && !d.prompt && d.len > 5) out.woodZeroNoPrompt++;
    if (player === 'modest') {
      out.idle.push(idle); out.afford.push(M.checks ? (100 * M.affordable) / M.checks : 0);
      const full = M.days.filter((d) => d.hpDusk !== undefined);
      out.minActions.push(full.length ? Math.min(...full.map((d) => d.actions)) : 0);
      out.lumps += M.lumps; out.outcomes.push(M.outcome);
    }
    if (player === 'afk') out.idle.push(idle);
    if (player === 'nowood') { if (M.softlocks) out.nowoodPrompt++; if (M.gifts) out.nowoodGift++; }
    rows.push({ seed, player, outcome: M.outcome, idle: idle.toFixed(0) + '%', afford: M.checks ? ((100 * M.affordable) / M.checks).toFixed(0) + '%' : '-', actions: M.days.map((d) => d.actions).join('/'), wood: M.days.map((d) => Math.round(d.wood || 0)).join('/'), hearth: M.days.map((d) => `${Math.round(d.hp0)}>${Math.round(d.hpDusk ?? 0)}`).join(' '), lumps: M.lumps, softlock: M.softlocks, pops: M.pops });
  }
}
const rep = [];
for (let k = 0; k < Math.min(SEEDS, 5); k++) rep.push(repairScenario('PACE-' + k));
// A Lumber Camp beside a thin copse is refused, and the ghost can show the wood in reach.
const probe = (() => {
  const s = firstRegion('PACE-0');
  const h = s.rt.hearth;
  let refused = 0, allowed = 0, shown = 0;
  for (let ty = h.ty - 11; ty <= h.ty + 11; ty++) for (let tx = h.tx - 11; tx <= h.tx + 11; tx++) {
    const v = canPlace(s, 'lumber', tx, ty);
    const info = placeInfo(s, 'lumber', tx, ty);
    if (info && typeof info.total === 'number') shown++;
    if (v.ok) { allowed++; if (info.total < BAL.economy.campMinWood) refused = -999; } else if (info && info.nodes && info.total < BAL.economy.campMinWood) refused++;
  }
  return { refused, allowed, shown };
})();

console.table(rows);
if (VERBOSE) console.log('repair scenarios', rep);
const lines = [
  ['Villager idle share of daylight (modest and AFK, region 1)', `max ${Math.max(...out.idle).toFixed(0)}% median ${out.idle.sort((a, b) => a - b)[out.idle.length >> 1].toFixed(0)}%`, Math.max(...out.idle) < 20],
  ['Day-1 build checks with something affordable (modest)', `min ${Math.min(...out.afford).toFixed(0)}%`, Math.min(...out.afford) >= 60],
  ['Useful actions per day, every day of region 1 (modest)', `min ${Math.min(...out.minActions)}`, Math.min(...out.minActions) >= 6],
  ['Days with no wood income and no soft-lock prompt', `${out.woodZeroNoPrompt}`, out.woodZeroNoPrompt === 0],
  ['No-wood player gets the prompt / the carter', `${out.nowoodPrompt}/${SEEDS} prompt, ${out.nowoodGift}/${SEEDS} carter`, out.nowoodPrompt === SEEDS],
  ['Repairing 500 Hearth HP spends stone', rep.map((r) => `${Math.round(r.healed)}hp:${r.stone.toFixed(1)}st`).join(' '), rep.every((r) => r.healed > 0 && Math.abs(r.stone - r.healed / BAL.repair.hpPerRes) < 1)],
  ['Hearth HP at dusk above dawn HP + repair capacity', `${out.capBad} days`, out.capBad === 0],
  ['Villager moves of more than 24 units in one tick', `${out.pops} (largest ${out.popMax.toFixed(1)})`, out.pops === 0],
  ['Dawn income lumps paid (modest, nights 1-2)', `${out.lumps}`, out.lumps >= SEEDS * 2],
  ['Lumber Camp beside less than 150 wood is refused', `${probe.refused} spots refused, ${probe.allowed} allowed`, probe.refused > 0],
];
console.log(`\nEconomy acceptance (${DIFF}, ${SEEDS} seeds; modest outcomes ${out.outcomes.join(' ')}):`);
let bad = 0;
for (const [k, v, ok] of lines) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k}: ${v}`); if (!ok) bad++; }
process.exit(bad ? 1 : 0);
