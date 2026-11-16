// Pacing acceptance (EMBERCROWN-REWORK.md, stream D): plays real Campaign regions headless with
// two scripted players and measures the night/wave/objective targets.
//   node tools/pacing.mjs [seeds=10] [difficulty=standard] [--verbose] [--no-hero] [--acts]
//   --no-hero  remove any hero at region start (stream C removes the free starter hero)
//   --acts     also play whole Act I runs with the modest bot (slower)
//   --e-repair emulate stream E's capped repairs (4 hp/s per builder) where E has not landed
//   --steps N  emulate stream H2's shorter acts (RUN.stepsPerAct = N)
// Players:
//   AFK     places 3 economy buildings (Farm, Lumber Camp, House), then does nothing. Every
//           choice takes option 0. Should LOSE region 1 by the Long Night.
//   modest  the tools/runsim.mjs builder (economy, Barracks, towers, Nova/Banner). Should WIN.
import '../js/game/content.js';
import { createNewRun, travelOptions, enterNode, finishRegion, beaconOptions, takeBeacon, currentNode, advanceAct, resolveEvent, buyItem, resolveShrine } from '../js/game/run.js';
import { tick, applyCommand, canPlace } from '../js/game/sim.js';
import { T, distToRect } from '../js/game/grid.js';
import { isLongNight } from '../js/game/systems/waves.js';

const args = process.argv.slice(2);
const SEEDS = +(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--steps') || 10);
const DIFF = args.find((a) => /^(story|standard|brutal)$/.test(a)) || 'standard';
const VERBOSE = args.includes('--verbose');
const NO_HERO = args.includes('--no-hero');
const ACTS = args.includes('--acts');
// --e-repair: emulate stream E's capped repairs (4 hp/s per builder) until E lands.
if (args.includes('--e-repair')) { const { BAL } = await import('../js/data/balance.js'); if (BAL.villager.repairPerSec > 4) BAL.villager.repairPerSec = 4; }
// --steps N: emulate stream H2's shorter acts (RUN.stepsPerAct) until H2 lands.
{ const i = args.indexOf('--steps'); if (i >= 0) { const { RUN } = await import('../js/data/balance.js'); RUN.stepsPerAct = +args[i + 1]; } }

function tryBuild(s, type) {
  const h = s.rt.hearth;
  for (let r = 3; r < 11; r++) for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2 + r;
    const tx = Math.round(h.tx + 1 + Math.cos(ang) * r), ty = Math.round(h.ty + 1 + Math.sin(ang) * r);
    if (canPlace(s, type, tx, ty).ok) return applyCommand(s, { t: 'place', type, tiles: [[tx, ty]] }).ok;
  }
  return false;
}
function choose(s, pref) {
  let i = 0;
  if (pref && s.pending.kind === 'blueprint') for (const t of ['barracks', 'ballista', 'brazier', 'spire', 'granary']) { const j = s.pending.options.indexOf(t); if (j >= 0) { i = j; break; } }
  if (!applyCommand(s, { t: 'choose', i }).ok) for (const j of [0, 1, 2, 3, 4, 5, -1]) if (applyCommand(s, { t: 'choose', i: j }).ok) break;
}

// The tools/runsim.mjs modest player, one decision every 2 s.
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
function modest(s, ticks) {
  if (ticks % 40 !== 0) return;
  const t = nextBuild(s);
  if (t && !tryBuild(s, t)) for (const k of ['wood', 'stone']) if (s.res[k] < 50 && s.res.gold > 70) applyCommand(s, { t: 'trade', k });
  if (s.res.food < 30 && s.res.gold > 60) applyCommand(s, { t: 'trade', k: 'food' });
  const b = s.buildings.find((x) => x.type === 'barracks' && x.built);
  if (b && s.res.gold >= 20 && s.res.food > 30) applyCommand(s, { t: 'train', id: b.id, u: ['spearman', 'archer', 'militia', 'archer'][(ticks / 40) % 4 | 0] });
  const up = s.buildings.find((x) => x.built && !x.upg && x.type === 'tower' && x.level < 2);
  if (up && s.res.wood > 60 && s.res.stone > 50) applyCommand(s, { t: 'upgrade', id: up.id });
  if (s.sovereign && s.sovereign.novaCd <= 0 && s.enemies.filter((e) => !e.stationary && !e.flying).length > 4) applyCommand(s, { t: 'ability', name: 'nova' });
  if (s.sovereign && s.sovereign.bannerCd <= 0 && s.cycle.phase === 'night' && s.enemies.length > 6) applyCommand(s, { t: 'ability', name: 'banner' });
  const rift = s.enemies.find((e) => e.type === 'rift' && e.alive);
  if (rift && s.cycle.phase === 'day' && s.cycle.t > 20 && (s.soldiers.length >= 4 || s.cycle.night >= 2)) {
    for (const q of s.squads) applyCommand(s, { t: 'squadAttack', id: q.id, target: rift.id });
    if (s.sovereign && s.sovereign.hp > s.sovereign.maxHp * 0.6) applyCommand(s, { t: 'sovAttack', target: rift.id });
  }
  if (s.beaconReady && s.cycle.phase === 'day') applyCommand(s, { t: 'lightBeacon' });
}
function afk(s, ticks, st) {
  if (st.placed < 3 && ticks % 20 === 0) { if (tryBuild(s, ['farm', 'lumber', 'house'][st.placed])) st.placed++; }
  if (s.beaconReady && s.cycle.phase === 'day') applyCommand(s, { t: 'lightBeacon' });
}

/** Play one region with a player and measure it. */
function playMeasured(s, player) {
  if (NO_HERO) for (const e of s.heroes) e.alive = false;
  const M = { nights: [], phaseT: { day: 0, dusk: 0, night: 0, dawn: 0 }, contact: 0, total: 0, beaconEarly: false, hearthMax: s.rt.hearth.maxHp };
  let cur = null, last = s.cycle.phase, ticks = 0;
  const st = { placed: 0 };
  const limit = 20 * 60 * 25;
  while (!s.outcome && ticks < limit) {
    if (s.pending) choose(s, player === 'modest');
    if (player === 'modest') modest(s, ticks); else afk(s, ticks, st);
    const wasReady = s.beaconReady;
    tick(s); ticks++;
    if (!wasReady && s.beaconReady) {
      const L = s.objective.nights || 3;
      if (!(s.objective.held || s.cycle.night >= L) && s.objective.type !== 'boss') M.beaconEarly = true;
      M.readyAt = { night: s.cycle.night, t: ticks / 20 };
    }
    for (const ev of s.rt.fx) {
      if (!cur) continue;
      if (ev.t === 'spawn') cur.spawned++;
      else if (ev.t === 'foeBirth') cur.births += ev.n || 0;
      else if (ev.t === 'riftFallen') cur.riftFell = true;
    }
    s.rt.fx.length = 0;
    const ph = s.cycle.phase;
    M.phaseT[ph] += 0.05; M.total += 0.05;
    if (ph !== last) {
      if (ph === 'night') {
        const w = s.wave;
        cur = { n: w.n, pos: w.pos, long: !!w.long, depth: w.depth, forecast: w.total, brood: w.groups.reduce((a, g) => a + (g.brood || 0), 0), fronts: w.groups.length, spawned: 0, births: 0, first6: null, peak: 0, hearth0: s.rt.hearth ? s.rt.hearth.hp : 0, hearthLost: 0, len: 0 };
      }
      if (last === 'night' && cur) { cur.len = +cur.len.toFixed(1); M.nights.push(cur); cur = null; }
      last = ph;
    }
    // Contact: any Hollow within 8 tiles of a building (whole cycle).
    const h = s.rt.hearth;
    let alive = 0, contact = false;
    for (const e of s.enemies) {
      if (!e.alive || e.stationary || e.guard) continue;
      alive++;
      if (!contact) for (const b of s.buildings) if (b.alive && distToRect(e.x, e.y, b) <= 8 * T) { contact = true; break; }
      if (cur && cur.first6 == null && h && distToRect(e.x, e.y, h) <= 6 * T) cur.first6 = +s.cycle.t.toFixed(2);
    }
    if (contact) { M.contact += 0.05; if (cur) cur.contact = (cur.contact || 0) + 0.05; }
    if (cur) {
      cur.len = s.cycle.t;
      cur.peak = Math.max(cur.peak, alive);
      if (h) { const lost = cur.hearth0 - h.hp; if (lost > cur.hearthLost) cur.hearthLost = lost; }
    }
  }
  if (cur) { cur.cut = true; M.nights.push(cur); } // the region ended mid-night
  M.minutes = ticks / 20 / 60;
  M.outcome = s.outcome ? s.outcome.result : 'timeout';
  M.reason = s.outcome ? s.outcome.reason : '';
  M.nightsHeld = s.cycle.night;
  M.objective = s.objective.type + (s.objective.side ? '+' + s.objective.side.kind + (s.objective.side.done ? '(met)' : '') : '');
  return M;
}

function firstRegion(seed) {
  const run = createNewRun({ seedText: seed, difficulty: DIFF, faction: 'dawnhold' });
  const opts = travelOptions(run);
  const id = opts.find((x) => ['region'].includes(run.map.nodes[x].type)) || opts[0];
  const res = enterNode(run, id);
  return { run, s: res.kind === 'region' ? run.region : null };
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const out = { defeatsBy: { n1: 0, n2: 0, long: 0 }, afkLost: 0, afkLostByLong: 0, modestWon: 0, first6: [], peakLong: [], contact: [], forecastBad: 0, beaconEarly: 0, minutes: [], hearthByPos: { n1: 0, n2: 0, long: 0 } };
const rows = [];
for (let k = 0; k < SEEDS; k++) {
  const seed = 'PACE-' + k;
  // AFK
  {
    const { s } = firstRegion(seed);
    const M = playMeasured(s, 'afk');
    const lost = M.outcome === 'defeat';
    if (lost) { out.afkLost++; const n = M.nights[M.nights.length - 1]; if (n) out.defeatsBy[n.pos]++; }
    const L = s.objective.nights || 3;
    // Not won by the end of the Long Night: lost on or before it, or (a Rift left standing)
    // still fighting after it.
    if ((lost && M.nightsHeld < L) || !(M.outcome === 'victory' && M.readyAt && M.readyAt.night <= L)) out.afkLostByLong++;
    rows.push({ seed, bot: 'afk', obj: M.objective, outcome: M.outcome, held: M.nightsHeld, min: M.minutes.toFixed(1), nights: M.nights.map((n) => `${n.pos}:${n.forecast}/${n.peak}pk/${Math.round(n.hearthLost)}hp`).join(' ') });
    if (VERBOSE) console.log(seed, 'afk', M.reason);
  }
  // Modest
  {
    const { s } = firstRegion(seed);
    const M = playMeasured(s, 'modest');
    if (M.outcome === 'victory') out.modestWon++;
    else if (M.nights.length) out.defeatsBy[M.nights[M.nights.length - 1].pos]++;
    if (M.beaconEarly) out.beaconEarly++;
    out.minutes.push(M.minutes);
    out.contact.push(pct(M.contact, M.total));
    for (const n of M.nights) {
      if (n.n === 1) out.first6.push(n.first6 == null ? 99 : n.first6);
      if (n.long && n.depth === 0) out.peakLong.push(n.peak);
      const fromQueue = n.forecast - n.brood;
      if (!n.cut && !n.riftFell && (n.spawned !== fromQueue || n.births > n.brood)) { out.forecastBad++; if (VERBOSE) console.log('  forecast mismatch', seed, JSON.stringify(n)); }
      out.hearthByPos[n.pos] = (out.hearthByPos[n.pos] || 0) + n.hearthLost;
    }
    rows.push({ seed, bot: 'modest', obj: M.objective, outcome: M.outcome, held: M.nightsHeld, min: M.minutes.toFixed(1), contact: pct(M.contact, M.total) + '%', nights: M.nights.map((n) => `${n.pos}:${n.forecast}f/${n.fronts}fr/${n.peak}pk/${n.first6}s/${Math.round(n.contact || 0)}of${Math.round(n.len)}s/${Math.round(n.hearthLost)}hp`).join(' ') });
    if (VERBOSE) console.log(seed, 'modest', M.reason, JSON.stringify(M.phaseT));
  }
}

// Whole Act I with the modest bot (as tools/runsim.mjs travels the map).
let actWins = 0;
const actRows = [];
if (ACTS) {
  for (let k = 0; k < SEEDS; k++) {
    const run = createNewRun({ seedText: 'PACE-' + k, difficulty: DIFF, faction: 'dawnhold' });
    let guard = 0, minutes = 0, regions = 0, lostAt = '';
    while (!run.outcome && guard++ < 40 && run.act === 1 && !run.actDone) {
      const opts = travelOptions(run);
      if (!opts.length) break;
      const pref = (id) => ({ region: 5, ruin: 4, mystery: 3, cursed: 2, merchant: run.gold > 90 ? 6 : 1, shrine: run.sov.hp < run.sov.maxHp * 0.5 ? 7 : 2, boss: 9 }[run.map.nodes[id].type] || 0);
      const id = opts.slice().sort((a, b) => pref(b) - pref(a))[0];
      const res = enterNode(run, id);
      const node = currentNode(run);
      if (res.kind === 'region') {
        const M = playMeasured(run.region, 'modest');
        if (VERBOSE) console.log(`  PACE-${k} step ${node.step} ${node.type}/${M.objective} ${M.outcome} depth ${run.region.wave && run.region.wave.depth} mods ${JSON.stringify(node.modifiers || [])} sov ${Math.round(run.region.sovereign ? run.region.sovereign.hp : 0)} bp ${run.region.blueprints.length} built ${run.region.buildings.filter((b) => b.built).map((b) => b.type).join(',')} :: ${M.nights.map((n) => `${n.pos}:${n.forecast}f/${n.fronts}fr/${n.peak}pk/${Math.round(n.hearthLost)}hp`).join(' ')}`);
        minutes += M.minutes;
        const sum = finishRegion(run, run.region);
        if (sum.result !== 'victory') lostAt = `step ${node.step} ${node.type}/${M.objective} n${M.nightsHeld}: ${M.reason.slice(0, 40)}`;
        else regions++;
        if (!run.outcome) { const b = beaconOptions(run); if (b.length) takeBeacon(run, b[0]); }
      } else if (res.kind === 'event') {
        let r = null;
        for (let ci = 0; ci < res.event.choices.length && !r; ci++) r = resolveEvent(run, res.event, ci);
        run.pending = null;
      } else if (res.kind === 'merchant') {
        res.shop.items.forEach((it, i) => { if (it.kind === 'relic' && run.gold >= it.price) buyItem(run, res.shop, i); });
        run.pending = null;
      } else if (res.kind === 'shrine') { resolveShrine(run, run.sov.hp < run.sov.maxHp * 0.6 ? 'heal' : 'gamble'); run.pending = null; }
      else run.pending = null;
    }
    const won = !!run.actDone || run.act > 1;
    if (won) actWins++;
    actRows.push({ seed: 'PACE-' + k, actI: won ? 'won' : 'lost', regions, minutes: minutes.toFixed(1), lostAt });
  }
}

console.table(rows);
if (ACTS) console.table(actRows);
const H = out.hearthByPos, Ht = H.n1 + H.n2 + H.long;
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
const lines = [
  [`AFK bot has not won region 1 when the Long Night ends`, `${out.afkLostByLong}/${SEEDS} (lost the region ${out.afkLost})`, out.afkLostByLong >= Math.ceil(SEEDS * 0.8)],
  [`Modest bot wins region 1`, `${out.modestWon}/${SEEDS}`, out.modestWon >= Math.ceil(SEEDS * 0.8)],
  ...(ACTS ? [[`Modest bot finishes Act I`, `${actWins}/${SEEDS}`, actWins >= Math.ceil(SEEDS * 0.5)]] : []),
  [`First Hollow within 6 tiles of the Hearth (night 1), s`, `max ${Math.max(...out.first6)} median ${med(out.first6)}`, Math.max(...out.first6) <= 10],
  [`Peak Hollow alive, Long Night at depth 0`, `min ${Math.min(...out.peakLong)} median ${med(out.peakLong)}`, out.peakLong.length > 0 && Math.min(...out.peakLong) >= 20],
  [`Contact share of cycle time`, `min ${Math.min(...out.contact)}% median ${med(out.contact)}%`, Math.min(...out.contact) >= 35],
  [`Forecast total = spawned total (nights off)`, `${out.forecastBad}`, out.forecastBad === 0],
  [`Beacon ready before the Long Night was held`, `${out.beaconEarly}`, out.beaconEarly === 0],
  [`Region length at 1x, minutes`, `min ${Math.min(...out.minutes).toFixed(1)} max ${Math.max(...out.minutes).toFixed(1)}`, Math.min(...out.minutes) >= 4 && Math.max(...out.minutes) <= 6],
  [`Hearth lost (region defeats, both bots) by night position`, `n1 ${out.defeatsBy.n1} n2 ${out.defeatsBy.n2} long ${out.defeatsBy.long}`, Math.max(out.defeatsBy.n1, out.defeatsBy.n2, out.defeatsBy.long) <= 0.5 * (out.defeatsBy.n1 + out.defeatsBy.n2 + out.defeatsBy.long)],
  [`Hearth damage share (modest bot) by night position`, `n1 ${pct(H.n1, Ht)}% n2 ${pct(H.n2, Ht)}% long ${pct(H.long, Ht)}%`, Math.max(H.n1, H.n2, H.long) <= 0.5 * Ht],
];
console.log(`\nPacing acceptance (${DIFF}, ${SEEDS} seeds${NO_HERO ? ', no starter hero' : ''}):`);
for (const [what, v, ok] of lines) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}: ${v}`);
void isLongNight;
