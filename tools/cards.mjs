// Dawn Card enumeration test (rework stream H2): every card the game could offer, in a set of
// fixture realms, must change something when taken. Also checks that the dawn draw never
// offers a card with no effect, that supplies stay a small share of the draw, and that the
// Beacon reward options are valid.
//   node tools/cards.mjs
import '../js/game/content.js';
import { createNewRun, enterNode, travelOptions } from '../js/game/run.js';
import { tick, applyCommand } from '../js/game/sim.js';
import { serializeState, deserializeState } from '../js/game/state.js';
import { candidates, hasEffect, makeDawnCards, cardText, rewardOptions, rewardText } from '../js/game/systems/dawncards.js';
import { UPGRADES, UPGRADE_LIST, SUPPLIES, validateCards } from '../js/data/cards.js';
import { recruitHero } from '../js/game/systems/heroes.js';
import { RELICS } from '../js/data/relics.js';
import { BEACONS } from '../js/data/beacons.js';
import { BUILDINGS } from '../js/data/buildings.js';
import { RNG } from '../js/engine/rng.js';
import { HOOKS } from '../js/game/hooks.js';

let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL  ' + msg); } return ok; };
validateCards();

const clone = (s) => deserializeState(JSON.parse(JSON.stringify(serializeState(s))));
function region(seed) {
  const run = createNewRun({ seedText: seed, difficulty: 'standard', faction: 'dawnhold' });
  const id = travelOptions(run).find((n) => run.map.nodes[n].type === 'region');
  const s = enterNode(run, id).region;
  // Take the opening blueprint pick (Barracks when offered).
  if (s.pending) { const j = s.pending.options.indexOf('barracks'); applyCommand(s, { t: 'choose', i: Math.max(0, j) }); }
  for (let i = 0; i < 20 * 5; i++) { tick(s); s.rt.fx.length = 0; }
  return s;
}
const build = (s, type) => { if (!s.blueprints.includes(type)) s.blueprints.push(type); };
/** What a card can change: compare this before and after taking it. */
function signature(s) {
  const X = s.ext.dawn || {};
  return JSON.stringify({
    res: s.res, bp: s.blueprints, up: X.up, mods: s.mods,
    heroes: (s.heroes || []).map((h) => [h.id, h.alive, (h.perks || []).length]),
    hp: s.buildings.map((b) => [b.id, Math.round(b.hp), Math.round(b.maxHp)]),
    sov: s.sovereign ? [Math.round(s.sovereign.hp), s.sovereign.maxHp] : null,
  });
}

// ---- Fixture realms -------------------------------------------------------------------------------
const fixtures = [];
{ const s = region('CARDS-1'); fixtures.push(['fresh region', s]); }
{
  const s = region('CARDS-2');
  for (const b of s.buildings) if (b.built) b.hp = Math.max(1, b.hp * 0.5);
  s.sovereign.hp = s.sovereign.maxHp * 0.4;
  build(s, 'tower'); build(s, 'wall'); build(s, 'barracks');
  fixtures.push(['wounded realm (buildings and Sovereign hurt)', s]);
}
{
  const s = region('CARDS-3');
  build(s, 'tower'); build(s, 'wall'); build(s, 'barracks');
  const X = s.ext.dawn;
  for (const u of UPGRADE_LIST) X.up[u.id] = u.max; // every upgrade at its top rank
  fixtures.push(['every upgrade at max rank', s]);
}
{
  const s = region('CARDS-4');
  recruitHero(s, null); recruitHero(s, null); // the cap
  fixtures.push(['two heroes (recruit cap)', s]);
}
{
  const s = region('CARDS-5');
  const h = recruitHero(s, null);
  h.level = 3; h.owedPerks = [['__none__']]; // a perk id that does not exist
  const h2 = recruitHero(s, null);
  fixtures.push(['heroes with a bad and no owed perk', s]);
  void h2;
}
{
  const s = region('CARDS-6');
  // Learn every building: no blueprint card may be offered.
  for (const t of Object.keys(BUILDINGS)) if (BUILDINGS[t].cat) build(s, t);
  fixtures.push(['every blueprint known', s]);
}
{
  const s = region('CARDS-7');
  s.sovereign.alive = false; // never offered a Sovereign card when it has fallen (defensive)
  fixtures.push(['no living Sovereign', s]);
}

let offered = 0, taken = 0;
for (const [name, s] of fixtures) {
  const pool = candidates(s);
  const all = [...pool.upgrade, ...pool.blueprint, ...pool.hero, ...pool.supplies];
  for (const card of all) {
    offered++;
    check(hasEffect(s, card), `[${name}] candidate fails hasEffect: ${JSON.stringify(card)}`);
    const t = cardText(s, card);
    check(t.title && t.text && t.title !== '?', `[${name}] card text: ${JSON.stringify(card)} -> ${JSON.stringify(t)}`);
    const c = clone(s);
    const before = signature(c);
    c.pending = { kind: 'dawnCard', options: [card] };
    const r = applyCommand(c, { t: 'choose', i: 0 });
    check(r && r.ok, `[${name}] taking ${JSON.stringify(card)} was refused: ${r && r.msg}`);
    check(signature(c) !== before, `[${name}] ${JSON.stringify(card)} changed nothing`);
    check(!c.pending, `[${name}] ${JSON.stringify(card)} left a pending choice`);
    taken++;
  }
  // Fixture-specific rules.
  if (/wounded/.test(name)) check(pool.supplies.some((c) => c.id === 'masons') && pool.supplies.some((c) => c.id === 'rest'), `[${name}] repair and rest are offered`);
  if (/fresh/.test(name)) {
    const hurt = s.buildings.some((b) => b.alive && b.built && b.hp < b.maxHp - 1);
    check(hurt || !pool.supplies.some((c) => c.id === 'masons'), `[${name}] no repair with nothing damaged`);
    check(s.sovereign.hp < s.sovereign.maxHp - 1 || !pool.supplies.some((c) => c.id === 'rest'), `[${name}] no rest at full health`);
  }
  if (/max rank/.test(name)) check(pool.upgrade.length === 0, `[${name}] no upgrade past its max (${pool.upgrade.length} offered)`);
  if (/recruit cap/.test(name)) check(!pool.hero.some((c) => c.card.act === 'recruit'), `[${name}] no recruit past the cap`);
  if (/bad and no owed perk/.test(name)) check(pool.hero.every((c) => c.card.act !== 'perk'), `[${name}] no perk card for an unknown perk`);
  if (/every blueprint/.test(name)) check(pool.blueprint.length === 0, `[${name}] no blueprint card when all are known`);
  if (/no living Sovereign/.test(name)) check(!pool.upgrade.some((c) => UPGRADES[c.id].needs.sov) && !pool.supplies.some((c) => c.id === 'rest'), `[${name}] no Sovereign card`);
  // The dawn draw: 40 draws, every option valid, no duplicates, supplies a small share.
  let sup = 0, opts = 0;
  for (let k = 0; k < 40; k++) {
    const c = clone(s);
    c.rt.rng = new RNG(1000 + k * 7919);
    const p = makeDawnCards(c);
    if (!p) continue;
    const keys = p.options.map((o) => JSON.stringify(o));
    check(new Set(keys).size === keys.length, `[${name}] duplicate option in a draw`);
    for (const o of p.options) { opts++; if (o.k === 'sup') sup++; check(hasEffect(c, o), `[${name}] draw offered a card with no effect: ${JSON.stringify(o)}`); }
    check(p.options.length >= Math.min(3, Object.values(candidates(c)).reduce((a, l) => a + l.length, 0)), `[${name}] a draw offered fewer than 3 cards while more were possible`);
  }
  if (opts) console.log(`  ${name}: ${all.length} candidates, supplies ${Math.round((100 * sup) / opts)}% of drawn options`);
}

// ---- Supplies share of the draw weight (target: at most ~15%) ------------------------------------
{
  const s = fixtures[1][1]; // wounded realm: every kind available
  let sup = 0, n = 0;
  for (let k = 0; k < 300; k++) {
    const c = clone(s);
    c.rt.rng = new RNG(5000 + k * 104729);
    const p = makeDawnCards(c);
    for (const o of p.options) { n++; if (o.k === 'sup') sup++; }
  }
  const share = sup / n;
  console.log(`  supplies share of drawn options (wounded realm, 300 dawns): ${(share * 100).toFixed(1)}%`);
  check(share <= 0.15, `supplies are ${(share * 100).toFixed(1)}% of dawn options (target <= 15%)`);
}

// ---- Beacon reward options --------------------------------------------------------------------------
{
  const s = fixtures[0][1];
  for (const type of ['region', 'cursed', 'boss']) {
    for (let k = 0; k < 30; k++) {
      const r = new RNG(((k + 1) * 2654435761) >>> 0);
      const opts = rewardOptions({ relics: [], beacons: [], locked: s.locked }, type, r);
      check(opts.length === 3, `[beacon ${type}] 3 options (${opts.length})`);
      check(opts.some((o) => o.k === 'relic') && opts.some((o) => o.k === 'bonus'), `[beacon ${type}] at least one relic and one lasting bonus`);
      for (const o of opts) {
        if (o.k === 'relic') check(RELICS[o.id] && !RELICS[o.id].retired && !(s.locked && s.locked.relics.includes(o.id)), `[beacon ${type}] relic ${o.id} is live and unlocked`);
        else check(!!BEACONS[o.id], `[beacon ${type}] bonus ${o.id} exists`);
        const t = rewardText(o);
        check(t.title && t.text, `[beacon ${type}] text for ${JSON.stringify(o)}`);
      }
    }
  }
  check(typeof HOOKS.dawnCard === 'function' && typeof HOOKS.beaconReward === 'function', 'HOOKS.dawnCard and HOOKS.beaconReward are set');
}

console.log(`cards: ${offered} candidate cards across ${fixtures.length} fixture realms; ${taken} taken on a copy, each changed the realm`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
