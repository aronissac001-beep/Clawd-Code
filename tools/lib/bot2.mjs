// The colony bot v2 (Stage 2; owner J; doc 14.8 row J, 14.4 "Colony bot" and "Balance report").
// Pure ESM with relative imports and no Node built-ins (runs in Node and in a browser page).
//
// v2 is a POLICY, not a script: every game hour (a few rules every think) it reads the colony and
// answers with C3 commands through applyCommand, like a careful player. The base infrastructure of v1
// (tools/lib/bot.mjs makePlayer in policy mode: the dig plan and carved hall, the first stockpile,
// chop orders, the workshop stamp, the campfire, the first grow zone and dorm, braziers, the smithy
// and the ore tunnels, more stockpiles and dug rooms) runs under these rules:
//   defence     draft at Imminent and while a raid is fresh (3 h), else only while a hostile is within
//               16 tiles of the Hearth or of a colonist (stand down past 26): a far-off thief or a pack
//               lingering at the edge does not hold the whole hold drafted; only colonists the draft
//               accepts (not in a break) and who are fit (not ill, infected or tainted); the line is kept
//               full (the recovered rejoin) and the badly hurt are stood down; beasts are met in a dug room
//   letters     wanderers, migrants and refugees are accepted while the hold has room (POP_CAP) and
//               food; captives recruited; a stolen heirloom bought back when the coins allow
//   roles       every 12 game hours, or when the living set, the slots or the hurt change: slots by
//               colony size and by what is built (builder, cook, miner, grower, hauler, smith, scholar,
//               doctor, crafter, herder, then second slots), a grower right after the builder while food
//               is short; filled greedily by skill with hysteresis; second roles from the slots still
//               open; care at 2 for everyone while anyone is hurt; the sick sleep all day
//   research    the next open tech of a fixed priority list whenever nothing is being researched
//   bills       per finished bench, 'until' bills from a stock-target table that scales with the
//               colony (blocks, ingots, tools and weapons per colonist, clothes, bandages, leather,
//               charcoal, ale, bread ...), only for recipes whose tech is known; what burns or carves
//               wood waits while wood is short (it is the Hearth's fuel); trade goods and art (ashlar,
//               furniture, pottery, statues, jewellery) grow with the days, a step more for every game
//               day a tenth of the work hours went idle (a careful player keeps idle hands busy)
//   workshops   the next bench whose tech, tier and materials allow (study first), one an hour
//   housing     beds for every colonist (and one spare) in the dug rooms, with a sconce each (flagstone
//               floors in them were tried: over 9 seeds x 60 days they cost lives, 66 -> 42 alive)
//   food        grow zones scaled by colonists (hearthroot, then herbs, flax and grain once the
//               techs that use them are known); a second cook fire at 7 colonists
//   animals     a pen zone by the Hearth from day 5, and a second at 6 animals
//   hearth      the Hearth upgrade to Banked when blocks and iron allow (and Roaring at Village)
//   ores        a new tunnel to the nearest vein when iron, copper, tin or coal run low
//   burial      graves kept ahead of the corpses
// Not used, and why (reported to their owners): spike traps and deadfalls (a finished trap blocks the
// tile like a wall, world/pass.js, so nothing ever steps on it: B/G); bed rest for the ill (nothing
// sends the ill, the infected or the tainted to bed: F's needjobs urgentHook only does for bleeding).
// The same seed gives the same command log and the same final hash (--twice checks it); runBot2
// returns the accepted command log, which replays the run exactly on botFound(seed, '2').
//
// Meters (read only): everything v1 measures, plus majors and their warnings, nemesis returns, live
// flow fields, mood (hourly mean of the living), XP ranks (first Master, Grandmaster, level 20),
// tiers by day, herd size, idle share while the hold has 10+ colonists, stacks left unhauled over a
// game day while storage has room, deaths by cause, and a daily series (colonists, stacks, buildings,
// wealth, tier, mood, food days, tick p95, blob size every `blobEvery` days, the size of every state
// key for the growth check).
import { applyCommand } from '../../js/game/core/commands.js';
import { tick } from '../../js/game/core/sim.js';
import { tickSystems } from '../../js/game/core/bus.js';
import { stateHash, checkState } from '../../js/game/core/state.js';
import { W, H, idx, inB, TER, TER_MINEABLE, TER_PASSABLE, TER_WATER, DESIG } from '../../js/game/core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../../js/game/core/time.js';
import { all, def, structDef, sizeOf } from '../../js/game/core/content.js';
import { SKILL_IDS, WORK_IDS } from '../../js/game/core/schema.js';
import { disabledWork } from '../../js/game/people/roles.js';
import { needsTending } from '../../js/game/people/health.js';
import { totals, totalsMat, liveCount } from '../../js/game/work/items.js';
import { depositId } from '../../js/game/world/defs.js';
import { pendingLetters } from '../../js/game/threat/letters.js';
import { incidentDef, isHostile } from '../../js/game/threat/incidents.js';
import { hasTech, canResearch } from '../../js/game/colony/research.js';
import { computeWealth } from '../../js/game/colony/wealth.js';
import { tierIndex } from '../../js/game/colony/tiers.js';
import { foodDays } from '../../js/game/work/givers/animals.js';
import { haulable } from '../../js/game/work/haul.js';
import { CHRON_CAP } from '../../js/game/colony/chronicle.js';
import { LETTER_CAP } from '../../js/game/threat/letters.js';
import { makePlayer, makeMeter, botFound, bedRooms, idleHaul, median, findOpenSite, rectTiles, clampR, hearthOf, THINK } from './bot.mjs';

const WORK_IDX = Object.fromEntries(WORK_IDS.map((w, i) => [w, i]));
const SK = Object.fromEntries(SKILL_IDS.map((k, i) => [k, i]));
export const POP_CAP = 18;

/**
 * Stage 2 targets. Own (J, 14.8): the soak. The others are the 14.8 acceptance of other rows that
 * the bot measures (owner in brackets); each is reported per seed and over the seeds as the row asks.
 */
export const TARGETS_2 = Object.freeze({
  days: 100,
  // per seed, every seed (the bot's own health: the policy keeps a colony alive and growing)
  alive: 3,                 // colonists alive at the end
  // across seeds (14.8 rows)
  idleMax10: 0.25,          // E: idle share < 25% at 10 colonists
  unhauledMaxDays: 1,       // E: no item unhauled > 1 game day when space exists
  mood60: 45,               // F: average mood > 45 at day 60
  hamletDay: 25, villageDay: 70, tierSeeds: 4,   // G: Hamlet by day 25 and Village by day 70 on 4 of 5 seeds
  majors: [12, 20],         // H: 12-20 majors in 100 days (Steadfast)
  majorGapD: 2,             // H: no two majors closer than 2 days
  warnMinH: 6,              // H: every major warned >= 6 h
  nemesisSeeds: 3,          // H: a nemesis returns on 3 of 5 seeds
  flowMax: 3,               // H: flow fields never exceed 3 live
  herd: 4, herdDay: 40,     // K: a herd of >= 4 by day 40 on Greenvale seeds
});
/** The soak (14.8 J): at day 300. */
export const SOAK = Object.freeze({ days: 300, blobKB: 100, stacks: 2500, tickP95ms: 1.0, growthPct: 25, growthMinB: 4096 });
/** Balance report targets (14.4). */
export const BALANCE = Object.freeze({ masterDay: [25, 60], noL20Before: 100, grandmasterDay: [110, 200] });

// ---- the policy ------------------------------------------------------------------------------------
const TECH_ORDER = ['bloomery', 'herbalism', 'hunting', 'roofing', 'tanning', 'charcoal', 'fletching', 'pottery',
  'smithing', 'tailoring', 'weaving', 'husbandry', 'brewing', 'watchtowers', 'supports', 'milling', 'smokehouse', 'smelting',
  'masonry2', 'medicine2', 'steel', 'siegecraft', 'lanterns', 'prospecting', 'sculpture', 'glassblowing', 'jewellery', 'waterworks', 'mechanisms'];
// benches the policy adds, in order: [def, condition(Q) -> bool]
const BENCHES = [
  ['study', (Q) => Q.day >= 2],
  ['carpenter', (Q) => Q.day >= 3 && Q.stock('wood') >= 60],
  ['shrine', (Q) => Q.day >= 4 && Q.stock('block') >= 20],
  ['dicetable', (Q) => Q.n >= 5],
  ['butcher', (Q) => Q.day >= 4 && Q.tech('cooking')],
  ['apothecary', (Q) => Q.tech('herbalism') && Q.stock('block') >= 10],
  ['charkiln', (Q) => Q.tech('charcoal') && Q.stock('block') >= 30],
  ['tannery', (Q) => Q.tech('tanning') && Q.stock('hide') > 0],
  ['fletcher', (Q) => Q.tech('fletching') && Q.n >= 5],
  ['loom', (Q) => Q.tech('weaving') && (Q.stock('flax') > 0 || Q.stock('wool') > 0)],
  ['tailor', (Q) => Q.tech('tailoring') && Q.stock('cloth') >= 10],
  ['stove', (Q) => Q.tech('cooking') && Q.tier >= 1 && Q.stock('block') >= 30 && Q.ingot('iron') >= 10],
  ['brewery', (Q) => Q.tech('brewing') && Q.ingot('copper') >= 10 && Q.n >= 6],
  ['cask', (Q) => Q.tech('brewing') && Q.has('brewery')],
  ['kiln', (Q) => Q.tech('pottery') && Q.stock('clay') >= 10 && Q.stock('block') >= 40],
  ['smokehouse', (Q) => Q.tech('smokehouse') && Q.stock('block') >= 20 && Q.n >= 7],
  ['windmill', (Q) => Q.tech('milling') && Q.stock('millstone') > 0],
  ['granary', (Q) => Q.tier >= 1 && Q.stock('block') >= 30 && Q.n >= 8],
  ['sculptor', (Q) => Q.tech('sculpture') && Q.stock('block') >= 40],
  ['blastfurnace', (Q) => Q.tech('steel') && Q.stock('brick') >= 60 && Q.ingot('iron') >= 20],
  ['potter', (Q) => Q.tech('pottery') && Q.stock('block') >= 20],
  ['jeweller', (Q) => Q.tech('jewellery') && Q.ingot('iron') >= 20],
];
// the work sink (a careful player keeps idle hands busy): trade goods and art whose targets grow with
// the days, so there is always something worth making once the needs are met
// (Q.busy: 1-4, raised a step each game day while a tenth or more of the work hours went idle)
const lux = (Q, per, cap) => Math.min(cap * Q.busy, Math.floor(Q.day * per * Q.busy));
// bills: bench -> [[recipe, n(Q)]], 'until' bills (n 0: none)
const BILLS = {
  mason: [['cut_blocks', (Q) => 160 + (Q.hearthLvl < 2 ? 80 : 0) + Q.n * 10], ['make_millstone', (Q) => (Q.tech('milling') && !Q.has('windmill') ? 1 : 0)],
    ['ashlar_blocks', (Q) => lux(Q, 3, 400)], ['stone_table', (Q) => Math.ceil(Q.n / 4)], ['stone_endtable', (Q) => lux(Q, 0.1, 12)], ['make_pillar', (Q) => lux(Q, 0.05, 6)]],
  carpenter: [['make_chair', (Q) => Q.n], ['make_table', (Q) => Math.ceil(Q.n / 4)], ['make_endtable', (Q) => Math.ceil(Q.n / 2)], ['make_shelf', (Q) => lux(Q, 0.05, 6)],
    ['make_wardrobe', (Q) => lux(Q, 0.05, 6)], ['make_woodshield', (Q) => Math.ceil(Q.n / 3)]],
  potter: [['fine_pottery', (Q) => lux(Q, 0.6, 80)], ['make_jar', () => 6]],
  jeweller: [['cut_gem', () => 4], ['make_ring', (Q) => lux(Q, 0.1, 12)], ['make_amulet', (Q) => lux(Q, 0.05, 6)]],
  campfire: [['simple_meal', (Q) => Q.n * 3]],
  stove: [['stove_meal', (Q) => Q.n * 3], ['bake_bread', (Q) => (Q.stock('flour') ? 20 : 0)]],
  bloomery: [['smelt_iron', (Q) => 60 + Q.n * 4], ['smelt_copper', () => 30], ['smelt_tin', () => 12], ['make_bronze', (Q) => (Q.tech('smelting') ? 20 : 0)]],
  forge: [['forge_pick', (Q) => Math.ceil(Q.n / 4)], ['forge_spear', (Q) => Math.ceil(Q.n / 3)], ['forge_sword', (Q) => Math.ceil(Q.n / 3)],
    ['forge_ironhelm', (Q) => Math.ceil(Q.n / 3)], ['forge_fellingaxe', (Q) => Math.ceil(Q.n / 6)], ['forge_bands', (Q) => (Q.tech('masonry2') ? 8 : 0)]],
  tannery: [['tan_leather', () => 30], ['cure_fur', () => 10]],
  loom: [['weave_linen', () => 60], ['weave_wool', () => 40]],
  tailor: [['make_bandages', () => 12], ['sew_tunic', (Q) => Q.n], ['sew_boots', (Q) => Math.ceil(Q.n / 2)], ['sew_jerkin', (Q) => Math.ceil(Q.n / 4)]],
  apothecary: [['make_poultice', (Q) => Q.n * 2], ['make_candles', () => 20]],
  charkiln: [['make_charcoal', () => 40]],
  brewery: [['ale_wort', () => 2], ['wine_wort', () => 2]],
  cask: [['ferment_ale', (Q) => Q.n * 2], ['ferment_wine', (Q) => Q.n]],
  windmill: [['grind_flour', () => 40]],
  smokehouse: [['smoke_meat', () => 40]],
  kiln: [['fire_bricks', () => 80]],
  fletcher: [['make_shortbow', (Q) => Math.ceil(Q.n / 4)]],
  sculptor: [['carve_statue', (Q) => 2 + lux(Q, 0.1, 16)], ['carve_figurine', (Q) => lux(Q, 0.2, 30)]],
  blastfurnace: [['make_steel', () => 40]],
};
// recipes that eat wood (paused under WOOD_RESERVE + 20 a colonist)
const WOODY = new Set(['make_chair', 'make_table', 'make_endtable', 'make_shelf', 'make_wardrobe', 'make_woodshield', 'make_charcoal', 'make_shortbow']);
const WOOD_RESERVE = 200;
// role -> [skill(s), work type]
const ROLE_SKILL = {
  builder: [['construction'], 'build'], cook: [['cooking'], 'cook'], miner: [['mining'], 'mine'], grower: [['growing'], 'grow'],
  hauler: [[], 'haul'], smith: [['smithing'], 'smith'], scholar: [['lore'], 'lore'], doctor: [['medicine'], 'care'],
  crafter: [['woodcraft', 'masonry', 'tailoring'], 'craft'], herder: [['animals'], 'animals'], artisan: [['art'], 'art'],
  soldier: [['melee', 'archery'], null],
};
/** Role slots for a colony of n, in importance order (Q: what is built). */
function roleSlots(Q) {
  const n = Q.n, out = [];
  const add = (r, min, cond = true) => { if (n >= min && cond) out.push(r); };
  // short of food (under 3 days, or ripe crops waiting): a grower comes right after the builder (a
  // grower as a second role never harvests while the first role has work: mining always has)
  if (Q.food < 3) { add('builder', 1); add('grower', 2); if (Q.food < 1 && n >= 4) add('grower', 4); add('cook', 3); }
  else { add('builder', 1); add('cook', 2); }
  add('crafter', 3, Q.has('mason') || Q.has('carpenter')); add('miner', 3); if (Q.food >= 3) add('grower', 5);
  add('smith', 5, Q.has('bloomery')); add('scholar', 6, Q.has('study')); add('hauler', 7); add('doctor', 7);
  add('herder', 8, Q.pens > 0); add('grower', 9); add('hauler', 10); add('builder', 11); add('crafter', 12); add('artisan', 12, Q.has('sculptor'));
  add('soldier', 13); add('cook', 13); add('miner', 14); add('hauler', 15); add('scholar', 16); add('soldier', 17);
  return out;
}

/**
 * The v2 policy. step() is called every THINK ticks and returns the commands to send now.
 * @param {object} s  the colony (read only)
 */
export function makePolicy(s) {
  const base = makePlayer(s, '2', { policy: true, zoneMax: 6, maxDigs: 80 });
  const P = base.notes, api = base.api;
  const Q = { n: 0, food: 9, busy: 1, idleW: [0, 0], idleDay: 0, day: 0, tier: 0, hearthLvl: 1, pens: 0, rooms: [], bedrooms: [], placed: new Map(), answered: new Set(), sched: new Map(), roleAt: 0, roleKey: '', groupKey: '',
    benchAt: 0, growAt: 0, hearthAt: 0, oreAt: 0, billAt: 0, bedAt: 0, penAt: 0, graveAt: 0, grows: [], fire2: false, notes: P.notes };
  Q.tech = (id) => hasTech(s, id);
  Q.stock = (k) => totals(s, k);
  Q.ingot = (m) => totalsMat(s, 'ingot', m);
  Q.has = (d) => s.bld.some((b) => b && b.def === d && b.st === 'done');
  Q.any = (d) => s.bld.some((b) => b && b.def === d);
  const note = (t) => P.notes.push(`${s.tick}: ${t}`);
  const hx = hearthOf(s).x, hy = hearthOf(s).y;
  const living = () => s.col.filter((c) => !c.hp.dead);
  const lvl = (c, sk) => (sk in SK ? c.sk[SK[sk]][0] + 3 * c.sk[SK[sk]][2] : 0);
  const can = (c, w) => w === null || !disabledWork(c).includes(WORK_IDX[w]);
  const site = (w, h, ox = 0, oy = 0) => { const r = findOpenSite(s, hx + ox, hy + oy, w, h, P.taken); if (r) P.taken.push(r); return r; };

  function refresh() {
    const L = living();
    // idle hands in work hours (sampled every think): a step more trade goods and art per idle day
    const h = Math.floor((s.tick % TICKS_PER_DAY) / TICKS_PER_HOUR);
    for (const c of L) if (!c.drafted && (c.sched[h] === 1 || c.sched[h] === 3)) { Q.idleW[0]++; if (!c.job || c.job.type === 'idle') Q.idleW[1]++; }
    const d = Math.floor(s.tick / TICKS_PER_DAY);
    if (d !== Q.idleDay) {
      const share = Q.idleW[0] ? Q.idleW[1] / Q.idleW[0] : 0;
      if (share >= 0.1 && Q.busy < 4) { Q.busy++; note(`idle ${(share * 100).toFixed(0)}% of work hours: trade goods and art x${Q.busy}`); }
      else if (share < 0.03 && Q.busy > 1) Q.busy--;
      Q.idleW = [0, 0]; Q.idleDay = d;
    }
    Q.n = L.length; Q.day = Math.floor(s.tick / TICKS_PER_DAY); Q.tier = s.colony.tier | 0; Q.hearthLvl = s.colony.hearth.lvl | 0;
    Q.pens = s.zones.filter((z) => z.type === 'pen').length;
    Q.food = foodDays(s);
    P.zoneMax = 6 + Math.floor(Q.n / 2);
  }

  // letters: accept people while there is room and food
  function letters() {
    const cmds = [];
    for (const l of pendingLetters(s)) {
      if (!l.choices || Q.answered.has(l.id)) continue;
      const k = l.data && l.data.k;
      let ch = null;
      if (k === 'join') {
        const more = (l.data.people || []).length;
        const ok = Q.n + more <= POP_CAP && (foodDays(s) >= 2 || Q.n < 6) && (!l.data.pursued || Q.n >= 5);
        ch = ok ? 0 : 1;
      } else if (k === 'captive') ch = Q.n < POP_CAP ? 0 : l.choices.length - 1;
      else if (k === 'heirloom') ch = totals(s, 'coins') >= ((l.data && l.data.price) || 0) + 100 ? 0 : 1;
      if (ch === null) continue;
      Q.answered.add(l.id);
      cmds.push({ t: 'letter', id: l.id, choice: ch });
      note(`letter ${l.id} ${k} ${l.inc || ''}: ${l.choices[ch]}`);
    }
    return cmds;
  }

  // roles: slots by size and buildings, greedy by skill, hysteresis for the current holder
  function roles() {
    const L = living().slice().sort((a, b) => a.id - b.id);
    const key = L.map((c) => c.id).join(',');
    const slots = roleSlots(Q);
    const hurt = L.some((c) => c.hp.down || needsTending(c));
    const gkey = `${key}|${slots.join(',')}|${hurt}`;   // (slots change with the food band too)
    if (s.tick < Q.roleAt && gkey === Q.groupKey) return [];
    Q.roleAt = s.tick + (hurt ? 2 : 12) * TICKS_PER_HOUR; Q.groupKey = gkey;
    const score = (c, r) => { const [sks] = ROLE_SKILL[r]; return sks.length ? Math.max(...sks.map((k) => lvl(c, k))) : 0; };
    const prim = new Map(), used = new Set();
    for (const r of slots) {
      let best = null, bs = -1;
      for (const c of L) {
        if (used.has(c.id) || !can(c, ROLE_SKILL[r][1])) continue;
        const sc = score(c, r) + (c.role[0] === r ? 3 : 0);
        if (sc > bs) { bs = sc; best = c; }
      }
      if (best) { used.add(best.id); prim.set(best.id, r); }
    }
    for (const c of L) if (!prim.has(c.id)) prim.set(c.id, can(c, 'haul') ? 'hauler' : 'generalist');
    // second roles: the slots a bigger colony would fill next, by skill; else hauler (grower for haulers)
    const open = roleSlots({ ...Q, n: POP_CAP }).filter((r, i, a) => a.indexOf(r) === i && ![...prim.values()].includes(r));
    if (hurt && open.includes('doctor')) { open.splice(open.indexOf('doctor'), 1); open.unshift('doctor'); }
    const sec = new Map();
    for (const r of open) {
      let best = null, bs = -1;
      for (const c of L) { if (sec.has(c.id) || prim.get(c.id) === r || !can(c, ROLE_SKILL[r][1]) || r === 'soldier') continue; const sc = score(c, r); if (sc > bs) { bs = sc; best = c; } }
      if (best) sec.set(best.id, r);
    }
    const cmds = [];
    // care: while anyone is hurt, ill or downed, everyone who can tends and rescues at 2 (custom
    // priorities); once all are well the role command puts the computed priorities back
    for (const c of L) {
      const p = prim.get(c.id);
      let q = sec.get(c.id) || (p === 'hauler' ? 'grower' : 'hauler');
      if (q === p) q = null;
      const care = hurt && can(c, 'care');
      if (c.role[0] !== p || c.role[1] !== q || (c.custom && !care)) cmds.push({ t: 'role', colId: c.id, primary: p, ...(q ? { secondary: q } : {}) });
      if (care && c.prio[WORK_IDX.care] > 2) cmds.push({ t: 'prio', colId: c.id, work: 'care', p: 2 });
      // a colonist who needs tending but is up sleeps all day (the Care giver tends only patients in
      // bed or downed, and nothing else sends the infected, the ill or the tainted to bed: reported to F)
      const sick = needsTending(c) && !c.hp.down;
      if (sick && !Q.sched.has(c.id)) { Q.sched.set(c.id, Array.from(c.sched)); cmds.push({ t: 'sched', colId: c.id, hours: new Array(24).fill(0) }); }
      else if (!sick && Q.sched.has(c.id)) { cmds.push({ t: 'sched', colId: c.id, hours: Q.sched.get(c.id) }); Q.sched.delete(c.id); }
      // everyone may carry weapons and armour (the Worker outfit carries none)
      if (!c.gear || c.gear.outfit !== 'any') cmds.push({ t: 'outfit', colId: c.id, outfit: 'any' });
    }
    if (cmds.length) note(`roles ${[...prim].map(([id, r]) => `${id}:${r}/${sec.get(id) || '-'}`).join(' ')}${hurt ? ' (care 2)' : ''}`);
    return cmds;
  }

  function research() {
    const r = s.colony.research;
    if (!r || r.cur) return [];
    for (const id of TECH_ORDER) if (def('tech', id) && !canResearch(s, id)) { note(`research ${id}`); return [{ t: 'research', tech: id }]; }
    return [];
  }

  // workshops: the next bench whose condition holds, one an hour
  function workshops() {
    if (s.tick < Q.benchAt || !P.smithy) return [];
    Q.benchAt = s.tick + TICKS_PER_HOUR;
    const cmds = [];
    for (const [d, cond] of BENCHES) {
      const sd = structDef(d);
      if (Q.placed.has(d) || !sd || (sd.tech && !hasTech(s, sd.tech)) || (sd.tier && tierIndex(sd.tier) > Q.tier) || !cond(Q)) continue;
      const [w, h] = sizeOf(structDef(d), 0);
      const r = site(w, h, 6, 6);
      Q.placed.set(d, r);
      if (!r) { note(`no site for ${d}`); continue; }
      cmds.push({ t: 'place', def: d, x: r.x0, y: r.y0, rot: 0 });
      note(`bench ${d} at ${r.x0},${r.y0}`);
      break;
    }
    // a second cook fire at 7 colonists
    if (!Q.fire2 && Q.n >= 7) { Q.fire2 = true; const r = site(1, 1, 3, 3); if (r) cmds.push({ t: 'place', def: 'campfire', x: r.x0, y: r.y0, rot: 0 }); }
    return cmds;
  }

  // bills: 'until' targets per finished bench
  function bills() {
    if (s.tick < Q.billAt) return [];
    Q.billAt = s.tick + 2 * TICKS_PER_HOUR;
    const cmds = [];
    for (const b of s.bld) {
      if (!b || b.st !== 'done' || !b.bills || !BILLS[b.def]) continue;
      let nb = b.bills.length;
      for (const [rid, nf] of BILLS[b.def]) {
        const r = def('recipe', rid);
        if (!r || !r.bench.includes(b.def) || (r.tech && !hasTech(s, r.tech))) continue;
        // wood is fuel first (the Hearth, braziers, sconces, the campfire): what burns or carves wood
        // waits while the stock is low
        const woody = WOODY.has(rid) && Q.stock('wood') < WOOD_RESERVE + Q.n * 20;
        const n = woody ? 0 : Math.min(9999, Math.max(0, nf(Q) | 0));
        const i = b.bills.findIndex((x) => x.recipe === rid);
        if (i < 0) { if (n > 0 && nb < 10) { cmds.push({ t: 'bill', op: 'add', bId: b.id, bill: { recipe: rid, mode: 'until', n } }); nb++; } }
        else if (b.bills[i].mode === 'until' && b.bills[i].n !== n && !b.bills[i].perCol) cmds.push({ t: 'bill', op: 'edit', bId: b.id, bill: { i, n } });
        else if (b.bills[i].perCol && rid.endsWith('meal') && b.bills[i].n !== 3) cmds.push({ t: 'bill', op: 'edit', bId: b.id, bill: { i, n: 3 } });
      }
    }
    return cmds;
  }

  // housing: rooms the base dug become bedrooms with beds and a sconce
  function housing() {
    if (s.tick < Q.bedAt) return [];
    Q.bedAt = s.tick + TICKS_PER_HOUR;
    // beds in the dug rooms only: underground they sit at a steady 12 C through Deepcold (the surface
    // dorm of the first nights freezes in winter)
    const inRoom = (b) => Q.rooms.some((q) => q.use === 'bedroom' && b.x >= q.rect.x0 && b.x <= q.rect.x1 && b.y >= q.rect.y0 && b.y <= q.rect.y1);
    const beds = s.bld.filter((b) => b && (b.def === 'bed' || b.def === 'cot' || b.def === 'bunk' || b.def === 'doublebed') && inRoom(b)).length;
    if (beds >= Q.n + 1) return [];
    const cmds = [];
    const open = (r) => rectTiles(r).every((i) => s.L.terrain[i] !== TER.ROCK && s.L.terrain[i] !== TER.RUBBLE && TER_PASSABLE[s.L.terrain[i]]);
    const room = Q.rooms.find((q) => !q.use && open(q.rect) && (q.rect.x1 - q.rect.x0 + 1) * (q.rect.y1 - q.rect.y0 + 1) >= 9);
    if (!room) return [];
    room.use = 'bedroom';
    const r = room.rect, w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    const rows = h >= 4 ? [r.y0, r.y1 - 1] : [r.y0];
    let k = 0;
    for (const y of rows) for (let x = r.x0; x <= r.x1; x += 2) {
      if (beds + k >= Q.n + 3) break;
      if (x === r.x0 + 1 && y === r.y0) continue;
      cmds.push({ t: 'place', def: 'bed', x, y, rot: 0 }); k++;
    }
    if (w >= 2) cmds.push({ t: 'place', def: 'sconce', x: r.x0 + 1, y: r.y0, rot: 0 });
    note(`bedroom ${JSON.stringify(r)}: ${k} beds`);
    return cmds;
  }

  // food: grow zones scaled by colonists, crops by tech
  function food() {
    if (s.tick < Q.growAt) return [];
    Q.growAt = s.tick + 6 * TICKS_PER_HOUR;
    const cmds = [];
    // set the crop of each zone the bot painted (the zone id is known once the zone exists)
    for (const g of Q.grows) {
      const zid = s.L.zone[idx(g.rect.x0, g.rect.y0)];
      const z = zid ? s.zones.find((x) => x.id === zid && x.type === 'grow') : null;
      if (z && g.crop && z.crop !== g.crop) cmds.push({ t: 'zoneCfg', zoneId: z.id, patch: { crop: g.crop } });
    }
    const area = (crop) => Q.grows.filter((g) => g.crop === crop).reduce((a, g) => a + rectTiles(g.rect).length, 0) + (crop === 'hearthroot' ? 35 : 0);
    const want = [['hearthroot', Math.max(90, Math.min(320, Q.n * 20))], ['herb', Q.day >= 6 ? 24 : 0], ['flax', Q.tech('weaving') ? 70 : 0], ['grain', Q.tech('brewing') || Q.tech('milling') ? 70 : 0]];
    for (const [crop, a] of want) {
      if (!def('crop', crop) && !all('plant').some((p) => p.id === crop)) continue;
      if (area(crop) >= a) continue;
      const r = site(7, 5, -4, 10);
      if (!r) { note(`no site for a ${crop} zone`); continue; }
      cmds.push({ t: 'zone', op: 'new', type: 'grow', rect: r });
      Q.grows.push({ rect: r, crop });
      note(`grow ${crop} ${JSON.stringify(r)}`);
      break;
    }
    return cmds;
  }

  function animals() {
    if (s.tick < Q.penAt || Q.day < 5) return [];
    Q.penAt = s.tick + 12 * TICKS_PER_HOUR;
    const tame = s.anim.filter((a) => a && a.tame && !(a.hp && a.hp.dead)).length;
    if (Q.pens >= 1 && !(Q.pens === 1 && tame >= 6)) return [];
    const r = site(7, 7, -12, 4);
    if (!r) { note('no site for a pen'); return []; }
    note(`pen ${JSON.stringify(r)}`);
    return [{ t: 'zone', op: 'new', type: 'pen', rect: r }];
  }

  function hearth() {
    if (s.tick < Q.hearthAt) return [];
    Q.hearthAt = s.tick + 6 * TICKS_PER_HOUR;
    const h = s.colony.hearth, b = h && h.id !== null ? s.bld[h.id] : null;
    if (!b || b.st !== 'done') return [];
    const lvlDef = all('hearthLevel').find((x) => x.lvl === h.lvl + 1);
    if (!lvlDef || !lvlDef.cost) return [];
    for (const [key, n] of Object.entries(lvlDef.cost)) {
      const [k, m] = key.split(':');
      if ((m ? totalsMat(s, k, m) : totals(s, k)) < n) return [];
    }
    note(`hearth upgrade to ${lvlDef.id}`);
    return [{ t: 'upgrade', bId: b.id }];
  }

  // ores: a new tunnel when a metal or coal runs low (at most one vein a game day)
  function ores() {
    if (s.tick < Q.oreAt || !P.smithy) return [];
    Q.oreAt = s.tick + TICKS_PER_DAY;
    const low = [['iron', totalsMat(s, 'ore', 'iron') < 20 && Q.ingot('iron') < 60 + Q.n * 4], ['coal', totals(s, 'coal') < 12], ['copper', totalsMat(s, 'ore', 'copper') < 10 && Q.ingot('copper') < 30], ['tin', totalsMat(s, 'ore', 'tin') < 10 && Q.ingot('tin') < 12]];
    for (const [k, isLow] of low) {
      if (!isLow) continue;
      const v = api.oreDig(depositId(k));
      if (!v || !v.length) continue;
      note(`ore ${k}: ${v.length} tiles`);
      return v.map((i) => ({ t: 'designate', kind: 'mine', rect: { x0: i % W, y0: (i / W) | 0, x1: i % W, y1: (i / W) | 0 }, add: true }));
    }
    return [];
  }

  // graves (cap 1 each): an unburied colonist corpse in the dark rises as a Husk after 2 days, so
  // the hold keeps two empty graves more than the corpses waiting, in a graveyard row by the hold
  function burial() {
    if (s.tick < Q.graveAt) return [];
    Q.graveAt = s.tick + 2 * TICKS_PER_HOUR;
    const corpses = s.items.filter((it) => it && it.k === 'corpse').length;
    if (!corpses && Q.day < 10) return [];
    const graves = s.bld.filter((b) => b && b.def === 'grave');
    const rec = s.colony.people && s.colony.people.graves;
    const used = (b) => { const e = rec ? rec.find((x) => x[0] === b.id) : null; return e ? e[1].length : 0; };
    const empty = graves.filter((b) => used(b) < 1).length;
    if (empty >= corpses + 2) return [];
    const cmds = [];
    for (let k = 0; k < Math.min(4, corpses + 2 - empty); k++) {
      const r = site(1, 2, 12, -10);
      if (!r) { note('no site for a grave'); break; }
      cmds.push({ t: 'place', def: 'grave', x: r.x0, y: r.y0, rot: 0 });
    }
    if (cmds.length) note(`${cmds.length} graves (${corpses} corpses, ${empty} empty)`);
    return cmds;
  }

  return {
    notes: P, Q,
    step() {
      refresh();
      // beasts (manhunters, wolves) hunt the colonists themselves: hold inside a dug room, where its
      // 1-tile doorway lets one beast in at a time; everything else is met by the Hearth (v1's spot)
      if (P.holdAt && !Q.hold0) Q.hold0 = P.holdAt;
      const next = s.st.queue.find((e) => e.stage !== 'queued' && isHostile(incidentDef(e.inc)));
      const beast = next && (incidentDef(next.inc).tags || []).includes('beast');
      const den = Q.rooms.find((q) => q.use === 'bedroom');
      if (Q.hold0 && !P.drafted) P.holdAt = beast && den ? { x: (den.rect.x0 + den.rect.x1) >> 1, y: (den.rect.y0 + den.rect.y1) >> 1 } : Q.hold0;
      const cmds = base.step();
      // remember the rooms the base digs (bedrooms later)
      for (const c of cmds) if (c.t === 'designate' && c.kind === 'mine' && c.add && (c.rect.x1 - c.rect.x0 + 1) * (c.rect.y1 - c.rect.y0 + 1) >= 9 && !(P.plan && c.rect === P.plan.tunnel)) Q.rooms.push({ rect: c.rect, use: null });
      cmds.push(...letters(), ...roles(), ...research());
      if (s.tick % TICKS_PER_HOUR === 0 || P.phase === 1) cmds.push(...hearth(), ...workshops(), ...bills(), ...housing(), ...food(), ...animals(), ...ores(), ...burial());
      return cmds;
    },
  };
}

// ---- measuring (read only) -------------------------------------------------------------------------
const p95 = (a) => { if (!a.length) return null; const b = Float64Array.from(a).sort(); return b[Math.min(b.length - 1, Math.floor(b.length * 0.95))]; };
/** Byte sizes of the state's saved keys (JSON of the plain form), for the growth check. */
function stateSizes(s) {
  const out = {};
  const sz = (v) => { try { return JSON.stringify(v, (k, x) => (x && x.buffer instanceof ArrayBuffer ? Array.from(x) : x)).length; } catch (_) { return -1; } };
  for (const k of ['items', 'bld', 'zones', 'anim', 'foes', 'raids', 'rel', 'chron', 'next']) out[k] = sz(s[k]);
  // colonists: the living are bounded by the colonist cap; the dead are records kept for good (the
  // growth check flags them when they keep growing)
  out['col.living'] = sz(s.col.filter((c) => !c.hp.dead)); out['col.dead'] = sz(s.col.filter((c) => c.hp.dead));
  for (const k of Object.keys(s.colony).sort()) out[`colony.${k}`] = sz(s.colony[k]);
  for (const k of Object.keys(s.st).sort()) out[`st.${k}`] = sz(s.st[k]);
  return out;
}
/** Collection lengths with a known cap (C2, 12.1, the owners' caps). */
function capCounts(s) {
  const L = s.col;
  return {
    living: L.filter((c) => !c.hp.dead).length, dead: L.filter((c) => c.hp.dead).length, stacks: liveCount(s), chron: Array.isArray(s.chron) ? s.chron.length : (s.chron && s.chron.lines ? s.chron.lines.length : 0), letters: (s.st.letters || []).length,
    history: (s.st.history || []).length, zones: s.zones.length, raids: s.raids.length, foes: s.foes.length, anim: s.anim.filter((a) => a && !(a.hp && a.hp.dead)).length, col: s.col.length,
    thoughtsMax: Math.max(0, ...L.map((c) => c.thoughts.length)), logMax: Math.max(0, ...L.map((c) => c.log.length)), unreachMax: Math.max(0, ...L.map((c) => c.unreach.length)),
    woundsMax: Math.max(0, ...L.map((c) => c.hp.wounds.length)), flow: s.rt.flow ? s.rt.flow.length : 0, bld: s.bld.filter(Boolean).length, bldSlots: s.bld.length, itemSlots: s.items.length,
  };
}
export const CAPS = Object.freeze({ living: 40, stacks: 4000, chron: CHRON_CAP, letters: LETTER_CAP, history: 40, zones: 254, flow: 3, anim: 60, bld: 3000 });

function makeMeter2(s, opts = {}) {
  const M = makeMeter(s);
  const X = { majors: new Map(), nem: [], ranks: [], tierUp: [], deaths: [], artifacts: 0, broke: 0, researched: [], idle10: [0, 0], flowMax: 0,
    moodH: [], day: [], series: [], tickMs: [], unhauled: { violations: 0, worstH: 0, kinds: {} }, joins: 0, lastAlive: 0 };
  M.onEvent = (e) => {
    const d = e.data || {};
    if (e.name === 'raidWarn') {
      const q = s.st.queue.find((x) => x.id === d.raidId);
      const inc = q ? incidentDef(q.inc) : null;
      if (!X.majors.has(d.raidId)) X.majors.set(d.raidId, { id: d.raidId, inc: q ? q.inc : '?', cat: inc ? inc.cat : '?', warn: s.tick, arrive: d.arriveTick, nem: q && q.nem !== undefined ? q.nem : null, active: null, result: null });
    } else if (e.name === 'raidStage' && d.stage === 'active') { const m = X.majors.get(d.raidId); if (m && m.active === null) m.active = s.tick; }
    else if (e.name === 'raidEnd') { const m = X.majors.get(d.raidId); if (m) m.result = d.result; }
    else if (e.name === 'nemesis') X.nem.push({ tick: s.tick, id: d.nemId, what: d.what });
    else if (e.name === 'rankUp') X.ranks.push({ tick: s.tick, colId: d.colId, skill: d.skill, lvl: d.lvl });
    else if (e.name === 'tierUp') X.tierUp.push({ tick: s.tick, tier: d.tier });
    else if (e.name === 'died') { const c = s.col.find((x) => x.id === d.id); if (c && c.hp.dead && !X.deaths.some((x) => x.id === d.id)) X.deaths.push({ tick: s.tick, id: d.id, cause: d.cause }); }
    else if (e.name === 'artifact') X.artifacts++;
    else if (e.name === 'broke') X.broke++;
    else if (e.name === 'researched') X.researched.push({ tick: s.tick, tech: d.tech });
  };
  const after = M.afterTick;
  let t0 = 0;
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => 0;
  M.beforeTick2 = () => { t0 = now(); };
  M.afterTick2 = () => {
    X.tickMs.push(now() - t0);
    after();
    const fl = s.rt.flow ? s.rt.flow.length : 0;
    if (fl > X.flowMax) X.flowMax = fl;
    if (s.tick % 60 === 0) {
      let n = 0, idle = 0, mood = 0;
      for (const c of s.col) if (!c.hp.dead) { n++; mood += c.mood; if (!c.job || c.job.type === 'idle') idle++; }
      if (n >= 10) { const h = (s.tick % TICKS_PER_DAY) / TICKS_PER_HOUR; for (const c of s.col) if (!c.hp.dead) { const cell = c.sched ? c.sched[h | 0] : 1; if (cell === 1 || cell === 3) { X.idle10[0]++; if (!c.job || c.job.type === 'idle') X.idle10[1]++; } } }
      if (s.tick % TICKS_PER_HOUR === 0 && n) X.moodH.push(mood / n / 100);
    }
    // stacks waiting over a game day while storage has room
    if (s.tick % TICKS_PER_HOUR === 0) {
      let free = 0; for (let i = 0; i < s.L.zone.length && free < 1; i++) if (s.L.zone[i] && s.rt.itemAt[i] < 0 && s.rt.occ[i] < 0 && s.zones.some((z) => z.id === s.L.zone[i] && (z.type === 'stockpile' || z.type === 'dump'))) free++;
      // (stacks on unexplored ground, a vault's or a ruin's loot nobody has seen, do not count)
      // (and only stacks some colonist could carry now: reachable, unclaimed, with a better store; a
      // stack nobody can reach, a vault's beyond a locked gate, is not a hauling failure)
      if (free) for (const w of M.waiting.values()) {
        const age = s.tick - w.t0; const wi = w.ref ? idx(w.ref.x, w.ref.y) : -1;
        if (age <= TICKS_PER_DAY || wi < 0 || !(s.L.fog[wi >> 3] & (1 << (wi & 7)))) continue;
        if (!s.col.some((c) => !c.hp.dead && !c.hp.down && haulable(s, c, w.ref))) continue;
        X.unhauled.violations++; X.unhauled.worstH = Math.max(X.unhauled.worstH, +(age / TICKS_PER_HOUR).toFixed(1));
        const k = w.ref.k; X.unhauled.kinds[k] = (X.unhauled.kinds[k] || 0) + 1;
      }
    }
  };
  M.onDay = async (day, blobFn) => {
    const L = s.col.filter((c) => !c.hp.dead);
    const ms = X.tickMs; X.tickMs = [];
    const maxSkill = Math.max(0, ...L.map((c) => Math.max(...c.sk.map((k) => k[0]))));
    const moodDay = X.moodH.slice(-24);
    const row = { day, alive: L.length, total: s.col.length, stacks: liveCount(s), bld: s.bld.filter(Boolean).length, zones: s.zones.length, anim: s.anim.length, tame: s.anim.filter((a) => a && a.tame).length,
      wealth: computeWealth(s).total, tier: s.colony.tier | 0, hearth: s.colony.hearth.lvl | 0, mood: moodDay.length ? +(moodDay.reduce((a, b) => a + b, 0) / moodDay.length).toFixed(1) : null,
      food: foodDays(s), maxSkill, tickP95: ms.length ? +p95(ms).toFixed(3) : null, tickMean: ms.length ? +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(3) : null, techs: X.researched.length };
    if (blobFn && opts.blobEvery && day % opts.blobEvery === 0) { const b = await blobFn(s); row.blobKB = +(b.length / 1024).toFixed(1); row.sizes = stateSizes(s); row.caps = capCounts(s); }
    X.series.push(row);
  };
  M.X = X;
  return M;
}

/** Evaluate one seed's run (Stage 2). */
function evaluate2(s, M, P, days) {
  const X = M.X, T = TARGETS_2, r = {};
  const L = s.col.filter((c) => !c.hp.dead);
  r.colonists = { alive: L.length, total: s.col.length, peak: Math.max(0, ...X.series.map((x) => x.alive)) };
  r.deaths = X.deaths;
  r.deathCauses = X.deaths.reduce((o, d) => { o[d.cause] = (o[d.cause] || 0) + 1; return o; }, {});
  const majors = [...X.majors.values()].filter((m) => m.cat === 'major' && m.active !== null).sort((a, b) => a.active - b.active);
  r.majors = majors.map((m) => ({ inc: m.inc, day: +(m.active / TICKS_PER_DAY).toFixed(2), warnH: +((m.active - m.warn) / TICKS_PER_HOUR).toFixed(1), result: m.result, nem: m.nem }));
  const gaps = []; for (let i = 1; i < majors.length; i++) gaps.push((majors[i].active - majors[i - 1].active) / TICKS_PER_DAY);
  r.majorGapMinD = gaps.length ? +Math.min(...gaps).toFixed(2) : null;
  r.warnMinH = r.majors.length ? Math.min(...r.majors.map((m) => m.warnH)) : null;
  r.threatMix = {}; for (const m of X.majors.values()) if (m.active !== null) r.threatMix[m.inc] = (r.threatMix[m.inc] || 0) + 1;
  r.nemesis = { made: X.nem.filter((x) => x.what === 'made').length, returns: X.nem.filter((x) => x.what === 'returns').length, slain: X.nem.filter((x) => x.what === 'slain').length };
  r.flowMax = X.flowMax;
  const dayOfT = (t) => +(t / TICKS_PER_DAY).toFixed(2);
  r.tiers = X.tierUp.map((x) => ({ tier: x.tier, day: dayOfT(x.tick) }));
  const tierDay = (id) => { const t = X.tierUp.find((x) => x.tier === id); return t ? dayOfT(t.tick) : null; };
  r.hamletDay = tierDay('hamlet'); r.villageDay = tierDay('village');
  const rankDay = (lv) => { const x = X.ranks.find((k) => k.lvl >= lv); return x ? dayOfT(x.tick) : null; };
  r.xp = { firstMaster: rankDay(15), firstGrandmaster: rankDay(20), maxSkill: Math.max(0, ...L.map((c) => Math.max(...c.sk.map((k) => k[0])))) };
  const moodAt = (d) => { const row = X.series.find((x) => x.day === d); return row ? row.mood : null; };
  r.mood60 = moodAt(60);
  const herdAt = (d) => { const row = X.series.find((x) => x.day === d); return row ? row.tame : null; };
  r.herd40 = herdAt(40);
  r.idle10 = X.idle10[0] ? +(X.idle10[1] / X.idle10[0]).toFixed(4) : null;
  r.unhauled = X.unhauled;
  r.unhauled.waitingOverDay = {}; for (const w of M.waiting.values()) if (s.tick - w.t0 > TICKS_PER_DAY && w.ref && (s.L.fog[idx(w.ref.x, w.ref.y) >> 3] & (1 << (idx(w.ref.x, w.ref.y) & 7))) && s.col.some((c) => !c.hp.dead && !c.hp.down && haulable(s, c, w.ref))) { const k = `${w.ref.k}${w.ref.f ? '(f)' : ''}`; r.unhauled.waitingOverDay[k] = (r.unhauled.waitingOverDay[k] || 0) + 1; }
  Object.assign(r, idleHaul(s, M));
  r.research = X.researched.map((x) => x.tech);
  r.artifacts = X.artifacts; r.breaks = X.broke;
  r.stacks = liveCount(s);
  r.wealth = computeWealth(s).total;
  r.series = X.series;
  r.rooms = bedRooms(s);
  const stock = {}; for (const it of s.items) if (it) stock[it.k] = (stock[it.k] || 0) + it.n; r.stock = stock;
  const full = days >= T.days;
  r.checks = [
    ['ran to the end', X.series.length >= days, `${X.series.length} of ${days} days`],
    ['colony alive (J/F/H)', L.length >= T.alive, `${L.length} of ${s.col.length} alive (peak ${r.colonists.peak}) (>= ${T.alive}); deaths ${JSON.stringify(r.deathCauses)}`],
    ['flow fields <= 3 (H)', X.flowMax <= T.flowMax, `${X.flowMax} live at most (<= ${T.flowMax})`],
    ['majors warned >= 6 h (H)', r.warnMinH === null || r.warnMinH >= T.warnMinH, `shortest warning ${r.warnMinH} h of ${r.majors.length} majors (>= ${T.warnMinH} h)`],
    ['majors >= 2 days apart (H)', r.majorGapMinD === null || r.majorGapMinD >= T.majorGapD - 0.01, `closest majors ${r.majorGapMinD} days apart (>= ${T.majorGapD})`],
    [`majors ${T.majors[0]}-${T.majors[1]} in 100 days (H)${full ? '' : ' (info)'}`, r.majors.length >= T.majors[0] * Math.min(1, days / 100) && r.majors.length <= T.majors[1], `${r.majors.length} majors: ${JSON.stringify(r.threatMix)}`],
    ['no item unhauled > 1 day with space (E)', X.unhauled.violations === 0, `${X.unhauled.violations} stack-hours over a day (worst ${X.unhauled.worstH} h)`],
    ['idle < 25% at 10 colonists (E)', r.idle10 === null ? 'na' : r.idle10 < T.idleMax10, r.idle10 === null ? 'never 10 colonists' : `idle ${(r.idle10 * 100).toFixed(1)}% of work hours with 10+ colonists`],
    ['mood > 45 at day 60 (F)', r.mood60 === null ? 'na' : r.mood60 > T.mood60, `mean mood ${r.mood60} on day 60`],
    ['Hamlet by day 25 (G, 4 of 5)', r.hamletDay !== null && r.hamletDay <= T.hamletDay, `Hamlet on day ${r.hamletDay}`],
    ['Village by day 70 (G, 4 of 5)', r.villageDay !== null && r.villageDay <= T.villageDay, `Village on day ${r.villageDay}`],
    ['herd >= 4 by day 40 (K)', r.herd40 === null ? 'na' : r.herd40 >= T.herd, `${r.herd40} tame animals on day 40`],
    ['nemesis returns (H, 3 of 5)', r.nemesis.returns > 0, `${r.nemesis.made} made, ${r.nemesis.returns} returns, ${r.nemesis.slain} slain`],
  ].map(([name, ok, detail]) => ({ name, ok: ok === true, na: ok === 'na', detail }));
  // only the bot's own health fails a seed; other rows' targets are judged over the seeds (summarise2)
  for (const c of r.checks) if (c.name !== 'ran to the end') c.info = true;
  r.ok = r.checks.every((c) => c.ok || c.info || c.na);
  return r;
}

/**
 * Run bot v2 on one seed. Returns { seed, ok, hash, log, refused, metrics, s }.
 * opts: days, storyteller, difficulty, blobFn (async s -> Uint8Array: save size in the series, Node or
 * a page passes the codec), blobEvery (days), onDay(s, day), tickP95At: after the run, measure the tick
 * p95 over this many extra ticks (the soak's day-300 figure; not part of the log or hash).
 */
export async function runBot2({ seed = 1, days = 100, ticks = null, storyteller = null, difficulty = null, blobFn = null, blobEvery = 0, onDay = null, onTick = null, tickP95At = 0 } = {}) {
  const now = typeof performance !== 'undefined' ? () => performance.now() : () => 0;
  const t0 = now();
  const s = botFound(seed, '2', { storyteller, difficulty });
  const start = s.tick, end = start + (ticks !== null ? ticks : days * TICKS_PER_DAY);
  const player = makePolicy(s);
  const M = makeMeter2(s, { blobEvery });
  const log = [], refused = [];
  let error = null;
  try {
    while (s.tick < end) {
      if ((s.tick - start) % THINK === 0) for (const cmd of player.step()) { const res = applyCommand(s, cmd, log); if (!res.ok) refused.push([s.tick, cmd.t, res.reason]); }
      M.beforeTick(); M.beforeTick2();
      tick(s);
      M.afterTick2();
      if (onTick) onTick(s, player);
      if ((s.tick - start) % TICKS_PER_DAY === 0) { const d = (s.tick - start) / TICKS_PER_DAY; await M.onDay(d, blobFn); if (onDay) onDay(s, d, M.X.series[M.X.series.length - 1]); }
    }
  } catch (e) { error = `tick ${s.tick}: ${e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e}`; }
  const metrics = evaluate2(s, M, player.notes, Math.floor((end - start) / TICKS_PER_DAY));
  const errs = checkState(s);
  if (errs.length) metrics.checks.push({ name: 'state valid', ok: false, detail: errs.slice(0, 3).join('; ') });
  if (error) metrics.checks.push({ name: 'no exception', ok: false, detail: error });
  metrics.ok = metrics.checks.every((c) => c.ok || c.info || c.na);
  const hash = stateHash(s);
  const ms = Math.round(now() - t0);
  if (tickP95At > 0 && !error) {
    // the day-end tick cost with every Stage 2 system (bench style: the colony is copied by a save
    // round trip by the caller when it must stay untouched; here the run is over)
    const t = [];
    for (let k = 0; k < tickP95At; k++) { const a = now(); tick(s); t.push(now() - a); }
    metrics.tickP95End = +p95(t).toFixed(4); metrics.tickMaxEnd = +Math.max(...t).toFixed(3);
    // where the time goes: every tick system (and the end-of-tick passes as one) over the same number
    // of ticks again, mean and max in ms, the costliest first (names their owners' systems in a report)
    const sys = tickSystems(), keep = sys.map((x) => x.fn), acc = sys.map(() => [0, 0]);
    sys.forEach((x, k) => { const f = keep[k]; x.fn = (st) => { const a = now(); f(st); const d = now() - a; acc[k][0] += d; if (d > acc[k][1]) acc[k][1] = d; }; });
    let all = 0;
    try { for (let k = 0; k < tickP95At; k++) { const a = now(); tick(s); all += now() - a; } } finally { sys.forEach((x, k) => { x.fn = keep[k]; }); }
    const eot = all - acc.reduce((a, x) => a + x[0], 0);
    metrics.tickProfile = sys.map((x, k) => ({ sys: `${x.slot}/${x.name}`, meanMs: +(acc[k][0] / tickP95At).toFixed(4), maxMs: +acc[k][1].toFixed(3) }))
      .concat([{ sys: 'endOfTick (all passes) and the tick loop', meanMs: +(eot / tickP95At).toFixed(4), maxMs: null }])
      .sort((a, b) => b.meanMs - a.meanMs).slice(0, 12);
  }
  return { seed, days, ok: metrics.ok, hash, ticks: end - start, ms, log, refused, notes: player.notes.notes, metrics, s };
}

/**
 * Judge the Stage 2 rows over the seeds (14.8: "4 of 5", "3 of 5", per-seed rows on every seed).
 * Returns [{ name, owner, ok, detail, enforced }]. enforced: the bot's own (J) checks; the rest are
 * other rows' acceptance measured by the bot (reported; never fail J's gate check).
 */
export function summarise2(results) {
  const T = TARGETS_2, n = results.length;
  const M = results.map((r) => r.metrics);
  const cnt = (f) => M.filter(f).length;
  const out = [];
  const add = (name, owner, ok, detail, enforced = false) => out.push({ name, owner, ok: !!ok, detail, enforced });
  add('every seed ran to the end', 'J', M.every((m) => m.checks.some((c) => c.name === 'ran to the end' && c.ok)), M.map((m) => (m.series.length)).join(' '), true);
  add('colony alive at the end (>= 3; alive/peak)', 'J/F/H', cnt((m) => m.colonists.alive >= T.alive) === n, M.map((m) => `${m.colonists.alive}/${m.colonists.peak}`).join(' ') + '; deaths ' + JSON.stringify(M.reduce((o, m) => { for (const [k, v] of Object.entries(m.deathCauses)) o[k] = (o[k] || 0) + v; return o; }, {})));
  add('no exception, state valid', 'J', M.every((m) => !m.checks.some((c) => (c.name === 'no exception' || c.name === 'state valid') && !c.ok)), M.map((m) => (m.checks.find((c) => c.name === 'no exception' && !c.ok) || {}).detail || 'ok').join(' | ').slice(0, 300), true);
  add('idle < 25% at 10 colonists', 'E', M.every((m) => m.idle10 === null || m.idle10 < T.idleMax10) && M.some((m) => m.idle10 !== null), M.map((m) => (m.idle10 === null ? 'n/a' : (m.idle10 * 100).toFixed(1) + '%')).join(' '));
  add('no item unhauled > 1 game day when space exists', 'E', M.every((m) => m.unhauled.violations === 0), M.map((m) => `${m.unhauled.violations}/${m.unhauled.worstH}h`).join(' '));
  add('average mood > 45 at day 60', 'F', M.every((m) => m.mood60 !== null && m.mood60 > T.mood60), M.map((m) => m.mood60).join(' '));
  const ham = cnt((m) => m.hamletDay !== null && m.hamletDay <= T.hamletDay), vil = cnt((m) => m.villageDay !== null && m.villageDay <= T.villageDay);
  add('Hamlet by day 25 on 4 of 5 seeds', 'G', ham >= Math.ceil(n * T.tierSeeds / 5), `${ham}/${n}: days ${M.map((m) => m.hamletDay).join(' ')}`);
  add('Village by day 70 on 4 of 5 seeds', 'G', vil >= Math.ceil(n * T.tierSeeds / 5), `${vil}/${n}: days ${M.map((m) => m.villageDay).join(' ')}`);
  add('12-20 majors in 100 days (Steadfast)', 'H', M.every((m) => m.majors.length >= T.majors[0] && m.majors.length <= T.majors[1]), M.map((m) => m.majors.length).join(' '));
  add('no two majors closer than 2 days', 'H', M.every((m) => m.majorGapMinD === null || m.majorGapMinD >= T.majorGapD - 0.01), M.map((m) => m.majorGapMinD).join(' '));
  add('every major warned >= 6 h', 'H', M.every((m) => m.warnMinH === null || m.warnMinH >= T.warnMinH), M.map((m) => m.warnMinH).join(' '));
  const nem = cnt((m) => m.nemesis.returns > 0);
  add('a nemesis returns on 3 of 5 seeds', 'H', nem >= Math.ceil(n * T.nemesisSeeds / 5), `${nem}/${n}: ${M.map((m) => `${m.nemesis.made}m/${m.nemesis.returns}r`).join(' ')}`);
  add('flow fields never exceed 3 live', 'H', M.every((m) => m.flowMax <= T.flowMax), M.map((m) => m.flowMax).join(' '));
  add('a herd of >= 4 by day 40 (Greenvale)', 'K', M.every((m) => m.herd40 !== null && m.herd40 >= T.herd), M.map((m) => m.herd40).join(' '));
  return out;
}

// owners (14.2) of tick systems by slot and of saved keys, so a failing soak line names whose code it is
const SLOT_OWNER = { movement: 'B', plants: 'B', path: 'B', fire: 'B', weather: 'B', blight: 'B', mechanisms: 'B', jobs: 'E', think: 'E', rot: 'E',
  needs: 'F', mood: 'F', health: 'F', social: 'F', spatial: 'F', colony: 'K', animals: 'K', defence: 'H', storyteller: 'H', raids: 'H', engage: 'H' };
const SYS_OWNER = { 'movement/foes': 'H', 'path/pen-guard': 'K' };
const ownerOfSys = (sys) => SYS_OWNER[sys] || SLOT_OWNER[String(sys).split('/')[0]] || (String(sys).startsWith('endOfTick') ? 'A' : '?');
const ownerOfKey = (k) => (k.startsWith('col.') ? 'A/F' : k === 'items' || k === 'bld' ? 'E' : k === 'chron' || k === 'anim' || k.startsWith('colony.') ? 'K' : k.startsWith('st.') || k === 'foes' || k === 'raids' ? 'H' : 'A');

/** The soak's judgement at its last day (14.8 J). series rows carry blobKB/sizes/caps on blob days. */
export function judgeSoak(r) {
  const m = r.metrics, S = SOAK, out = [];
  const blobRows = m.series.filter((x) => x.blobKB !== undefined);
  const last = blobRows[blobRows.length - 1] || null;
  const add = (name, ok, detail) => out.push({ name, ok: !!ok, detail });
  add('ran to the end with no exception', !m.checks.some((c) => (c.name === 'no exception' || c.name === 'state valid') && !c.ok), (m.checks.find((c) => !c.ok && (c.name === 'no exception' || c.name === 'state valid')) || {}).detail || `${r.days} days`);
  add(`save < ${S.blobKB} KB at day ${r.days}`, last && last.blobKB < S.blobKB, last ? `${last.blobKB} KB on day ${last.day}` : 'no blob measured');
  add(`item stacks < ${S.stacks} at day ${r.days}`, m.stacks < S.stacks, `${m.stacks} stacks (peak ${Math.max(...m.series.map((x) => x.stacks))})`);
  const top = (m.tickProfile || []).slice(0, 3).map((x) => `${x.sys} ${x.meanMs} ms (${ownerOfSys(x.sys)})`).join(', ');
  add(`tick p95 < ${S.tickP95ms} ms at day ${r.days}`, m.tickP95End !== undefined && m.tickP95End < S.tickP95ms, `p95 ${m.tickP95End} ms, max ${m.tickMaxEnd} ms over the next ticks; last day's in-run p95 ${m.series.length ? m.series[m.series.length - 1].tickP95 : '?'} ms${top ? `; costliest (mean): ${top}` : ''}`);
  // (info) the busiest days: the colony may have shrunk by day 300, so the worst daily in-run p95 while
  // 10 or more colonists lived is shown too (in-run figures include the machine's other load)
  const busy = m.series.filter((x) => x.alive >= 10 && x.tickP95 !== null);
  const worst = busy.length ? busy.reduce((a, b) => (b.tickP95 > a.tickP95 ? b : a)) : null;
  out.push({ name: `worst daily tick p95 with 10+ colonists (info)`, ok: !worst || worst.tickP95 < S.tickP95ms, info: true, detail: worst ? `${worst.tickP95} ms on day ${worst.day} (${worst.alive} colonists); ${busy.length} such days` : 'never 10 colonists' });
  // caps: every capped collection within its cap at every blob day
  const over = [];
  for (const row of blobRows) for (const [k, cap] of Object.entries(CAPS)) if (row.caps && row.caps[k] > cap) over.push(`${k} ${row.caps[k]} > ${cap} (day ${row.day})`);
  add('capped collections within their caps', !over.length, over.length ? over.slice(0, 5).join('; ') : Object.entries(CAPS).map(([k, c]) => `${k} ${last && last.caps ? last.caps[k] : '?'}/${c}`).join(', '));
  // growth: no state key keeps growing through the last third (> growthPct% and > growthMinB bytes)
  const grow = [];
  if (blobRows.length >= 3) {
    const mid = blobRows.find((x) => x.day >= Math.floor(r.days * 2 / 3)) || blobRows[blobRows.length - 2];
    // (a key whose collection has a cap and stays within it may grow up to that cap: chron, items ...)
    const capped = { chron: 'chron', items: 'stacks', bld: 'bld', anim: 'anim', zones: 'zones', 'st.letters': 'letters', 'st.history': 'history', 'col.living': 'living' };
    for (const [k, v] of Object.entries(last.sizes)) {
      if (capped[k] && last.caps && last.caps[capped[k]] <= CAPS[capped[k]]) continue;
      const a = mid.sizes[k] || 0;
      if (v - a > S.growthMinB && v > a * (1 + S.growthPct / 100)) grow.push(`${k} ${a} -> ${v} B (day ${mid.day} -> ${last.day}; ${ownerOfKey(k)})`);
    }
  }
  add('no state growth beyond caps (last third)', !grow.length, grow.length ? grow.join('; ') : 'every saved key flat or within 25% / 4 KB over the last third');
  return out;
}

// ---- balance report (14.4) -------------------------------------------------------------------------
/**
 * The balance report (gate 14.4, from Stage 2): XP ranks (first Master, no level 20 before day 100,
 * the soak's first Grandmaster), the threat mix per storyteller (charters are Stage 3), and item
 * stacks and save size over time. main: the 100-day v2 results (seeds 1-5); soak: the 300-day result
 * or null; others: v2 results under the other storytellers (each with .storyteller). Plain results
 * (as colonybot writes them). Returns { report, text }; report.ok when every check holds.
 */
export function balanceReport(main, soak, others = []) {
  const B = BALANCE, lines = [], checks = [];
  const M = main.filter((r) => r.metrics).map((r) => r.metrics);
  const med = (a) => { const b = a.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
  const masters = M.map((m) => m.xp.firstMaster);
  const l20 = M.map((m) => m.xp.firstGrandmaster);
  const mMed = med(masters);
  checks.push({ name: `first Master on day ${B.masterDay[0]}-${B.masterDay[1]} (median of the seeds)`, owner: 'F', ok: mMed !== null && mMed >= B.masterDay[0] && mMed <= B.masterDay[1], detail: `days ${masters.join(' ')} (median ${mMed})` });
  checks.push({ name: `no level 20 before day ${B.noL20Before}`, owner: 'F', ok: l20.every((d) => d === null || d >= B.noL20Before) && (!soak || !soak.metrics || soak.metrics.xp.firstGrandmaster === null || soak.metrics.xp.firstGrandmaster >= B.noL20Before), detail: `first level 20: ${l20.join(' ')}${soak && soak.metrics ? `; soak ${soak.metrics.xp.firstGrandmaster}` : ''}` });
  if (soak && soak.metrics) {
    const g = soak.metrics.xp.firstGrandmaster;
    checks.push({ name: `soak: first Grandmaster on day ${B.grandmasterDay[0]}-${B.grandmasterDay[1]}`, owner: 'F', ok: g !== null && g >= B.grandmasterDay[0] && g <= B.grandmasterDay[1], detail: `day ${g} (max skill at day ${soak.days}: ${soak.metrics.xp.maxSkill})` });
  }
  // threat mix per storyteller (charters are Stage 3: none yet)
  const mix = {};
  for (const r of [...main, ...others]) {
    if (!r.metrics) continue;
    const k = r.storyteller || 'steady';
    const e = mix[k] || (mix[k] = { seeds: 0, majors: 0, incidents: {}, warnMinH: Infinity, gapMinD: Infinity });
    e.seeds++; e.majors += r.metrics.majors.length;
    for (const [inc, n] of Object.entries(r.metrics.threatMix)) e.incidents[inc] = (e.incidents[inc] || 0) + n;
    if (r.metrics.warnMinH !== null) e.warnMinH = Math.min(e.warnMinH, r.metrics.warnMinH);
    if (r.metrics.majorGapMinD !== null) e.gapMinD = Math.min(e.gapMinD, r.metrics.majorGapMinD);
  }
  // stacks and save size over time
  const series = (r) => (r && r.metrics ? r.metrics.series.filter((x) => x.blobKB !== undefined).map((x) => ({ day: x.day, alive: x.alive, stacks: x.stacks, blobKB: x.blobKB, wealth: x.wealth, tier: x.tier, tickP95: x.tickP95 })) : []);
  const report = { checks, threatMix: mix, charters: 'Stage 3 (no charters in Stage 2)', sizeSeries: { main: main.map((r) => ({ seed: r.seed, rows: series(r) })), soak: soak ? series(soak) : [] },
    xp: M.map((m, i) => ({ seed: main[i].seed, firstMaster: m.xp.firstMaster, firstGrandmaster: m.xp.firstGrandmaster, maxSkill: m.xp.maxSkill })) };
  lines.push('Balance report (14.4)');
  for (const c of checks) lines.push(`  ${c.ok ? 'ok  ' : 'miss'} [${c.owner}] ${c.name}: ${c.detail}`);
  lines.push('  threat mix per storyteller (majors and minors that arrived, over the seeds):');
  for (const [k, e] of Object.entries(mix)) lines.push(`    ${k}: ${e.seeds} seeds, ${e.majors} majors (${(e.majors / e.seeds).toFixed(1)} a seed), shortest warning ${e.warnMinH} h, closest majors ${e.gapMinD} d; ${Object.entries(e.incidents).sort((a, b) => b[1] - a[1]).map(([i, n]) => `${i} ${n}`).join(', ')}`);
  lines.push('  stacks and save size over time:');
  for (const r of report.sizeSeries.main) lines.push(`    seed ${r.seed}: ${r.rows.map((x) => `d${x.day} ${x.alive}col ${x.stacks}st ${x.blobKB}KB`).join(' | ')}`);
  if (soak) lines.push(`    soak seed ${soak.seed}: ${report.sizeSeries.soak.filter((x, i) => i % 3 === 2 || i === report.sizeSeries.soak.length - 1).map((x) => `d${x.day} ${x.alive}col ${x.stacks}st ${x.blobKB}KB`).join(' | ')}`);
  report.ok = checks.every((c) => c.ok);
  return { report, text: lines.join('\n') };
}
