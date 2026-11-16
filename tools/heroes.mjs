// Hero acceptance (rework Stream C), headless:
//   1. a new run has no heroes (no free starter)
//   2. the hero pick at dawn (the Recruit card) spawns one; takeHeroCard/recruitHero respect the cap
//   3. an idle hero at its post (and one guarding the Hearth) moves < 1 tile a minute over 90 s of day
//   4. no perk (or any hero) choice is ever pending while the phase is 'night' (20+ nights)
//   5. a hero given no orders survives night 1 in every one of 10 seeds
//   6. a move order takes the hero to within 1 tile of the spot; save/load keeps hero play identical
//   node tools/heroes.mjs [seeds=10]
import '../js/game/content.js';
import { createNewRun, travelOptions, enterNode } from '../js/game/run.js';
import { tick, applyCommand, canPlace } from '../js/game/sim.js';
import { serializeState, deserializeState } from '../js/game/state.js';
import { recruitHero, takeHeroCard, heroCards, gainXp, HERO_RULES } from '../js/game/systems/heroes.js';
import { HERO_CLASS_IDS } from '../js/data/heroes.js';
import { T } from '../js/game/grid.js';

const SEEDS = +(process.argv[2] || 10);
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

function firstRegion(seed) {
  const run = createNewRun({ seedText: seed, difficulty: 'standard', faction: 'dawnhold' });
  const id = travelOptions(run).find((n) => run.map.nodes[n].type === 'region') ?? travelOptions(run)[0];
  const res = enterNode(run, id);
  const s = res.region;
  if (s.pending) applyCommand(s, { t: 'choose', i: 0 }); // the opening blueprint draft
  return { run, s };
}
function step(s, n = 1) { for (let i = 0; i < n; i++) { tick(s); s.rt.fx.length = 0; } }
function tryBuild(s, type) {
  const h = s.rt.hearth;
  for (let r = 3; r < 11; r++) for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2 + r;
    const tx = Math.round(h.tx + 1 + Math.cos(ang) * r), ty = Math.round(h.ty + 1 + Math.sin(ang) * r);
    if (canPlace(s, type, tx, ty).ok) return applyCommand(s, { t: 'place', type, tiles: [[tx, ty]] }).ok;
  }
  return false;
}
const ORDER = ['farm', 'lumber', 'house', 'lumber', 'farm', 'quarry', 'barracks', 'tower', 'house', 'brazier', 'tower'];
/** The modest bot's day work (builds, trains, Nova) but never an order to a hero. */
function botTurn(s, ticks) {
  if (ticks % 40) return;
  const want = {};
  for (const t of ORDER) { want[t] = (want[t] || 0) + 1; if (s.buildings.filter((b) => b.type === t).length < want[t] && (t === 'farm' || t === 'lumber' || t === 'house' || t === 'quarry' || s.blueprints.includes(t))) { tryBuild(s, t); break; } }
  const b = s.buildings.find((x) => x.type === 'barracks' && x.built);
  if (b && s.res.gold >= 20 && s.res.food > 30) applyCommand(s, { t: 'train', id: b.id, u: ['spearman', 'archer', 'militia'][(ticks / 40) % 3 | 0] });
  if (s.sovereign && s.sovereign.novaCd <= 0 && s.enemies.filter((e) => !e.stationary && !e.flying).length > 4) applyCommand(s, { t: 'ability', name: 'nova' });
}
/** Answer a pending choice: hero picks take the first option (recruit / perk), others option 0. */
function answer(s) {
  if (!s.pending) return;
  if (!applyCommand(s, { t: 'choose', i: 0 }).ok) for (const j of [1, 2, 3]) if (applyCommand(s, { t: 'choose', i: j }).ok) break;
}

// 1. No free starter hero.
{
  let total = 0, roster = 0;
  for (let k = 0; k < SEEDS; k++) { const { run, s } = firstRegion('HERO-' + k); total += s.heroes.length; roster += run.ext.heroes.length; }
  check(total === 0 && roster === 0, `a new run has 0 heroes (${total} on the map, ${roster} on the roster across ${SEEDS} seeds)`);
}

// 2. The dawn hero pick recruits; the cap holds.
{
  const { s } = firstRegion('HERO-PICK');
  let kinds = [];
  let ticks = 0;
  while (s.cycle.night < 1 || s.cycle.phase !== 'dawn') {
    botTurn(s, ticks++); step(s);
    if (s.pending) { kinds.push(s.pending.kind); if (s.pending.kind !== 'heroDawn') answer(s); }
    if (s.pending && s.pending.kind === 'heroDawn') break;
    if (s.outcome || ticks > 20 * 400) break;
  }
  const p = s.pending;
  const recruit = p && p.kind === 'heroDawn' ? p.options.findIndex((o) => o.act === 'recruit') : -1;
  check(recruit >= 0, `dawn 1 offers a Recruit card (pending ${p ? p.kind : 'none'}: ${p ? p.options.map((o) => o.act || o.id || o).join(', ') : ''})`);
  const before = s.heroes.length;
  if (recruit >= 0) applyCommand(s, { t: 'choose', i: recruit });
  check(s.heroes.length === before + 1 && s.heroes[0].alive, `picking it spawns a hero (${before} -> ${s.heroes.length}: ${s.heroes.map((e) => e.name + ' the ' + e.cls).join(', ')})`);
  check(!s.pending, 'and that was the dawn\'s only pick');
  const e2 = recruitHero(s, 'ranger');
  const e3 = recruitHero(s, 'cleric');
  const cards = heroCards(s, 2);
  check(!!e2 && !e3 && s.heroes.length === HERO_RULES.maxHeroes && !cards.some((c) => c.act === 'recruit'), `cap of ${HERO_RULES.maxHeroes}: a third recruit is refused and no Recruit card is offered`);
  const bad = takeHeroCard(s, { kind: 'hero', act: 'recruit', cls: 'paladin', name: 'X', trait: 'brave' });
  check(!bad.ok, 'takeHeroCard refuses a recruit at the cap');
}

// 3. Calm at the post: movement over 90 s of daylight.
function calm(seed, posted) {
  const { s } = firstRegion(seed);
  for (const t of ['farm', 'lumber', 'house', 'house']) { s.res.wood += 200; s.res.stone += 100; tryBuild(s, t); }
  const e = recruitHero(s, HERO_CLASS_IDS[seed.length % 8]);
  const h = s.rt.hearth;
  if (posted) applyCommand(s, { t: 'heroMove', id: e.id, x: (h.tx + 1.5) * T + 4.2 * T, y: (h.ty + 1.5) * T - 1.5 * T });
  // Keep it day (no Hollow), let the hero settle for 10 s, then measure 90 s.
  const day = () => { s.cycle.phase = 'day'; s.cycle.t = Math.min(s.cycle.t, 5); };
  for (let i = 0; i < 200; i++) { day(); step(s); answer(s); }
  let path = 0, px = e.x, py = e.y, maxStep = 0;
  for (let i = 0; i < 20 * 90; i++) {
    day(); step(s); answer(s);
    const d = Math.hypot(e.x - px, e.y - py); path += d; maxStep = Math.max(maxStep, d); px = e.x; py = e.y;
  }
  return { tilesPerMin: path / T / 1.5, maxStep, gk: e.gk, alive: e.alive };
}
{
  const rows = [];
  for (let k = 0; k < Math.min(SEEDS, 6); k++) for (const posted of [true, false]) rows.push({ seed: 'CALM-' + k, posted, ...calm('CALM-' + k, posted) });
  const worst = Math.max(...rows.map((r) => r.tilesPerMin));
  console.table(rows.map((r) => ({ ...r, tilesPerMin: +r.tilesPerMin.toFixed(3), maxStep: +r.maxStep.toFixed(2) })));
  check(worst < 1, `an idle hero at its post moves < 1 tile/min over 90 s of day (worst ${worst.toFixed(3)} tiles/min)`);
}

// 4 + 5. Nights with heroes and no orders: no choice pending at night; no night-1 death.
{
  let nights = 0, nightPending = 0, deaths1 = 0, perksOffered = 0;
  const rows = [];
  for (let k = 0; k < SEEDS; k++) {
    const { s } = firstRegion('NIGHT-' + k);
    const e = recruitHero(s, HERO_CLASS_IDS[k % HERO_CLASS_IDS.length]);
    recruitHero(s, HERO_CLASS_IDS[(k + 3) % HERO_CLASS_IDS.length]);
    let ticks = 0, died1 = false, lastNight = 0, xpGiven = false;
    while (!s.outcome && ticks < 20 * 60 * 14) {
      botTurn(s, ticks); step(s); ticks++;
      if (s.cycle.phase === 'night') {
        if (s.pending) nightPending++;
        // Level the heroes up mid-night: their perks must wait for the dawn.
        if (!xpGiven && s.cycle.t > 3) { for (const h of s.heroes) if (h.alive) gainXp(s, h, 60); xpGiven = true; }
      } else xpGiven = false;
      if (s.cycle.night !== lastNight) { lastNight = s.cycle.night; nights++; }
      if (s.cycle.night <= 1 && !e.alive && s.cycle.phase !== 'day') died1 = true;
      if (s.pending) { if (s.pending.kind === 'heroDawn' && s.pending.options.some((o) => o.act === 'perk')) perksOffered++; answer(s); }
      if (s.beaconReady && s.cycle.phase === 'day') applyCommand(s, { t: 'lightBeacon' });
    }
    if (died1) deaths1++;
    rows.push({ seed: 'NIGHT-' + k, cls: e.cls, nights: s.cycle.night, outcome: s.outcome ? s.outcome.result : 'none', heroAlive: e.alive, level: e.level, perks: e.perks.length, owed: (e.owedPerks || []).length, diedNight1: died1 });
  }
  console.table(rows);
  check(nightPending === 0, `no choice pending during ${nights} nights (night-time pending ticks: ${nightPending}); perk picks offered at dawn: ${perksOffered}`);
  check(deaths1 === 0, `a hero with no orders dies on night 1 in ${deaths1} of ${SEEDS} seeds`);
}

// 6. Move order accuracy and save/load identity with heroes.
{
  const { s } = firstRegion('HERO-MOVE');
  const e = recruitHero(s, 'paladin');
  const h = s.rt.hearth;
  const tx = (h.tx + 1.5) * T - 5 * T, ty = (h.ty + 1.5) * T + 2 * T;
  applyCommand(s, { t: 'heroMove', id: e.id, x: tx, y: ty });
  let tArr = -1;
  for (let i = 0; i < 20 * 8; i++) { step(s); answer(s); if (tArr < 0 && Math.hypot(e.x - tx, e.y - ty) < T) tArr = i / 20; }
  check(tArr >= 0 && tArr < 4 && Math.hypot(e.x - tx, e.y - ty) < T, `a 5-tile move order: within 1 tile after ${tArr} s, ${(Math.hypot(e.x - tx, e.y - ty) / T).toFixed(2)} tiles off after 8 s`);
  // Save mid-play with two heroes and orders, restore, run both: identical.
  recruitHero(s, 'pyromancer');
  for (let i = 0; i < 20 * 50; i++) { botTurn(s, i); step(s); answer(s); }
  const snap = JSON.stringify(serializeState(s));
  const s2 = deserializeState(JSON.parse(snap));
  for (let i = 0; i < 20 * 60; i++) { botTurn(s, i); botTurn(s2, i); step(s); step(s2); answer(s); answer(s2); }
  const a = JSON.stringify(serializeState(s)), b = JSON.stringify(serializeState(s2));
  check(a === b, `save/restore with heroes stays identical (${s.heroes.length} heroes, night ${s.cycle.night})`);
}

console.log(fails ? `${fails} check(s) failed` : 'all hero checks passed');
process.exit(fails ? 1 : 0);
