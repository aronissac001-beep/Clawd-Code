// Next-steps advice rules (doc 10.10; owner G, card I). when(s) and score(s) read state only and
// must be pure (no randomness, no clock, no writes). The card shows the top 3 by score that were not
// dismissed in the last cooldownD game days (default 2). go opens a panel or a tool.
// Stage 1b: the first 10 rules (food, fuel, beds, light, smithing, the first horde, the downed).
// Stage 2 (14.8 row G): 30 rules in all. go.def names the structure a 'place' tool starts with (I's
// card can open { kind: 'place', def } from it); panels the card does not know open the Hold tab.
// Rules on joy and warmth read needs that run from Stage 2 (in 1b they stay full, so those rules sleep).
// Every Stage 2 rule carries stage: '2' (I's card may filter with availableIn(rule, STAGE)) and also
// holds only while researchOn(s), so a Stage 1b build never shows it, whatever the card does.
import { DATA as ITEMS } from './items.js';

const DAY = 14400;                                      // ticks per game day (core/time.js)
const FOOD_PER_DAY = 33;                                // need points a colonist eats a day (needs.js)
const NUTR = Object.freeze(Object.fromEntries(ITEMS.item.filter((d) => d.food).map((d) => [d.id, d.food.nutr])));

const alive = (s) => (s.col || []).filter((c) => c && !(c.hp && c.hp.dead));
const done = (s, defId) => (s.bld || []).some((b) => b && b.def === defId && b.st === 'done');
const planned = (s, defId) => (s.bld || []).some((b) => b && b.def === defId);
const stockOf = (s, k, m = null) => { let n = 0; for (const it of s.items || []) if (it && !it.f && it.k === k && (m === null || it.m === m)) n += it.n; return n; };
/** Days of food (meals and raw food on the map, not forbidden) for the living colonists (6.5 HUD chip). */
export function foodDays(s) {
  let pts = 0;
  for (const it of s.items || []) if (it && !it.f && NUTR[it.k]) pts += NUTR[it.k] * it.n;
  const n = alive(s).length;
  return n ? pts / (FOOD_PER_DAY * n) : 99;
}
const hearthFuelDays = (s) => { const h = s.colony && s.colony.hearth; return h && h.id !== null && h.id !== undefined ? (h.fuel | 0) / DAY : 99; };
const idleCount = (s) => alive(s).filter((c) => !c.drafted && !(c.hp && c.hp.down) && (!c.job || c.job.type === 'idle')).length;
const beds = (s) => (s.bld || []).filter((b) => b && b.def === 'bed').length;
const hasZone = (s, type) => (s.zones || []).some((z) => z && z.type === type);
const NEED_JOY = 2, NEED_WARMTH = 3;                    // core NEED_IDS order (food, rest, joy, warmth, light)
const count = (s, defId) => { let n = 0; for (const b of s.bld || []) if (b && b.def === defId) n++; return n; };
const stockCat = (s, ks) => ks.reduce((n, k) => n + stockOf(s, k), 0);
const tierI = (s) => (s.colony && s.colony.tier) | 0;
const lifetimeOf = (s, key) => { const l = s.colony && s.colony.ledger; return (l && l.total && l.total[key]) | 0; };
/** Stacks lying outside every stockpile (not forbidden; furniture waiting to be installed counts too). */
function unstored(s) {
  const L = s.L && s.L.zone, w = s.w | 0;
  if (!L || !w) return 0;
  const piles = new Set((s.zones || []).filter((z) => z && z.type === 'stockpile').map((z) => z.id));
  let n = 0;
  for (const it of s.items || []) if (it && !it.f && it.k !== 'stone' && !piles.has(L[it.y * w + it.x])) n++;
  return n;
}
const growTiles = (s) => { const L = s.L && s.L.zone; if (!L) return 0; const g = new Set((s.zones || []).filter((z) => z && z.type === 'grow').map((z) => z.id)); let n = 0; for (let i = 0; i < L.length; i++) if (L[i] && g.has(L[i])) n++; return n; };
const lowNeed = (s, k, below) => alive(s).some((c) => c.need && c.need[k] < below * 100);
const wounded = (s) => alive(s).some((c) => c.hp && Array.isArray(c.hp.wounds) && c.hp.wounds.length > 0);
const wild = (s) => (s.anim || []).some((a) => a && !a.tame);
const tamed = (s) => (s.anim || []).filter((a) => a && a.tame).length;
const hasCrop = (s, crop) => (s.zones || []).some((z) => z && z.type === 'grow' && z.crop === crop);
const hearthLvl = (s) => ((s.colony && s.colony.hearth && s.colony.hearth.lvl) | 0) || 1;
/** The Stage 2 sim is running: K's research has granted the free Kindling techs (it is not installed in 1b). */
const researchOn = (s) => { const t = s.colony && s.colony.techs; if (!t) return false; for (let i = 0; i < t.length; i++) if (t[i]) return true; return false; };
const hordeComing = (s) => ((s.st && s.st.queue) || []).some((q) => q && q.stage !== 'queued') || (s.raids || []).some((r) => r && r.stage !== 'ended');

export const DATA = {
  advice: [
    { id: 'hearth_fuel', text: 'The Hearth burns low: haulers bring it wood. Keep wood in a stockpile.', when: (s) => hearthFuelDays(s) < 1,
      score: (s) => (hearthFuelDays(s) <= 0 ? 100 : 90), go: { panel: 'hold' } },
    { id: 'first_stockpile', text: 'Mark a stockpile so haulers have somewhere to go.', when: (s) => !(s.zones || []).some((z) => z && z.type === 'stockpile'),
      score: () => 60, go: { tool: 'zone' }, cooldownD: 2 },
    { id: 'food_grow', text: 'Food runs short: paint a grow zone for hearthroot.', when: (s) => foodDays(s) < 4 && !hasZone(s, 'grow'),
      score: (s) => 95 - Math.floor(foodDays(s) * 5), go: { tool: 'zone' } },
    { id: 'campfire', text: 'Build a campfire: cooked meals keep longer and lift the mood.', when: (s) => !planned(s, 'campfire'),
      score: () => 70, go: { panel: 'build' } },
    { id: 'beds', text: 'Not everyone has a bed: sleeping on the ground sours the mood.', when: (s) => beds(s) < alive(s).length,
      score: (s) => 50 + 5 * (alive(s).length - beds(s)), go: { panel: 'build' } },
    { id: 'dark_tunnels', text: 'The tunnels are dark: torch sconces keep dread away.', when: (s) => alive(s).some((c) => c.need && c.need[4] < 3000),
      score: () => 65, go: { panel: 'build' }, cooldownD: 1 },
    { id: 'iron_bloomery', text: 'Iron ore is stocked: build a bloomery to smelt it.', when: (s) => stockOf(s, 'ore', 'iron') >= 10 && !planned(s, 'bloomery'),
      score: () => 45, go: { panel: 'build' } },
    { id: 'ingots_forge', text: 'Ingots are ready: a forge makes spears for the first night.', when: (s) => stockOf(s, 'ingot') >= 12 && done(s, 'bloomery') && !planned(s, 'forge'),
      score: () => 40, go: { panel: 'build' } },
    { id: 'horde_braziers', text: 'The Hollow are coming for the Hearth: build braziers by it and draft at dusk.', when: hordeComing,
      score: () => 85, go: { panel: 'build' }, cooldownD: 1 },
    { id: 'downed', text: 'Someone is down: a Doctor carries them to a bed.', when: (s) => alive(s).some((c) => c.hp && c.hp.down),
      score: () => 99, go: { panel: 'work' }, cooldownD: 0 },
    { id: 'idle_hands', text: 'Some colonists are idle: give them a role.', when: (s) => idleCount(s) > 0, score: (s) => 40 + 10 * idleCount(s), go: { panel: 'work' } },
    // ---- Stage 2 (19 more: 30 in all) ----
    { id: 'mason_bench', text: 'Rough stone piles up: a Mason\'s bench cuts it into blocks.', when: (s) => researchOn(s) && stockOf(s, 'stone') >= 10 && !planned(s, 'mason'),
      score: () => 55, go: { tool: 'place', def: 'mason' }, stage: '2' },
    { id: 'carpenter_bench', text: 'Build a Carpenter\'s bench: beds, tables and chairs come from it.', when: (s) => researchOn(s) && stockOf(s, 'wood') >= 40 && !planned(s, 'carpenter'),
      score: () => 58, go: { tool: 'place', def: 'carpenter' }, stage: '2' },
    { id: 'study_desk', text: 'A study desk lets a scholar research new crafts.', when: (s) => researchOn(s) && !planned(s, 'study') && (s.tick | 0) >= 3 * DAY,
      score: () => 42, go: { tool: 'place', def: 'study' }, stage: '2' },
    { id: 'pick_research', text: 'Nobody is researching: pick something to learn.', when: (s) => researchOn(s) && done(s, 'study') && !(s.colony && s.colony.research && s.colony.research.cur),
      score: () => 48, go: { panel: 'research' }, stage: '2' },
    { id: 'hearth_upgrade', text: 'Bank the Hearth: blocks and iron are stocked, and Hamlet needs it.', when: (s) => researchOn(s) && hearthLvl(s) < 2 && stockOf(s, 'block') >= 80 && stockOf(s, 'ingot', 'iron') >= 20,
      score: () => 62, go: { panel: 'hold' }, stage: '2' },
    { id: 'smelt_fuel', text: 'The bloomery has no fuel: mine coal, or burn wood in a charcoal kiln.', when: (s) => researchOn(s) && done(s, 'bloomery') && stockOf(s, 'ore') >= 10 && stockCat(s, ['coal', 'charcoal']) < 4,
      score: () => 50, go: { tool: 'place', def: 'charkiln' }, stage: '2' },
    { id: 'tables', text: 'There is no table: eating at one lifts the mood.', when: (s) => researchOn(s) && done(s, 'campfire') && count(s, 'table') + count(s, 'longtable') === 0,
      score: () => 45, go: { tool: 'place', def: 'table' }, stage: '2' },
    { id: 'apothecary', text: 'Wounds need dressing: an apothecary makes herbal poultices.', when: (s) => researchOn(s) && wounded(s) && !planned(s, 'apothecary') && tierI(s) >= 1,
      score: () => 66, go: { tool: 'place', def: 'apothecary' }, stage: '2' },
    { id: 'cold', text: 'Someone is cold: a fireplace warms a room, and wool keeps the cold out.', when: (s) => researchOn(s) && lowNeed(s, NEED_WARMTH, 30),
      score: () => 72, go: { tool: 'place', def: 'hearthfire' }, stage: '2', cooldownD: 1 },
    { id: 'joy', text: 'Spirits are low: a shrine or a dice board gives joy.', when: (s) => researchOn(s) && lowNeed(s, NEED_JOY, 25),
      score: () => 52, go: { tool: 'place', def: 'shrine' }, stage: '2' },
    { id: 'grow_more', text: 'Food is still short: a bigger grow zone feeds more mouths.', when: (s) => researchOn(s) && foodDays(s) < 5 && growTiles(s) > 0 && growTiles(s) < 30 * alive(s).length,
      score: (s) => 80 - Math.floor(foodDays(s) * 4), go: { tool: 'zone' }, stage: '2' },
    { id: 'hunting', text: 'Game roams nearby: a hunter brings meat, hides and pelts.', when: (s) => researchOn(s) && wild(s) && stockOf(s, 'meat') === 0 && tierI(s) >= 1,
      score: () => 35, go: { panel: 'work' }, stage: '2' },
    { id: 'pen_animals', text: 'Tamed animals wander: paint a pen and fence it in.', when: (s) => researchOn(s) && tamed(s) > 0 && !hasZone(s, 'pen'),
      score: () => 50, go: { tool: 'zone' }, stage: '2' },
    { id: 'watchtower', text: 'The raids will grow: a watchtower sees them coming sooner.', when: (s) => researchOn(s) && lifetimeOf(s, 'raidsRepelled') >= 1 && !planned(s, 'tower'),
      score: () => 44, go: { tool: 'place', def: 'tower' }, stage: '2' },
    { id: 'tradepost', text: 'Caravans come to a trade post: build one to trade.', when: (s) => researchOn(s) && tierI(s) >= 1 && !planned(s, 'tradepost'),
      score: () => 40, go: { tool: 'place', def: 'tradepost' }, stage: '2' },
    { id: 'stockpile_more', text: 'Goods lie outside the stockpiles: mark a bigger one.', when: (s) => researchOn(s) && unstored(s) >= 30,
      score: (s) => 40 + Math.min(30, unstored(s) >> 2), go: { tool: 'zone' }, stage: '2' },
    { id: 'brewery', text: 'Grain is stocked: a brewery and casks turn it into ale.', when: (s) => researchOn(s) && tierI(s) >= 1 && stockOf(s, 'grain') >= 24 && !planned(s, 'brewery'),
      score: () => 38, go: { tool: 'place', def: 'brewery' }, stage: '2' },
    { id: 'sow_grain', text: 'Grain feeds the mill and the brewery: sow a field of it.', when: (s) => researchOn(s) && tierI(s) >= 1 && hasZone(s, 'grow') && !hasCrop(s, 'grain'),
      score: () => 36, go: { tool: 'zone' }, stage: '2' },
    { id: 'forge_picks', text: 'A forged pick makes a miner dig faster.', when: (s) => researchOn(s) && done(s, 'forge') && stockOf(s, 'pick') === 0 && stockOf(s, 'ingot') >= 12,
      score: () => 34, go: { panel: 'build' }, stage: '2' },
  ],
};
