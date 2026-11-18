// Next-steps advice rules (doc 10.10; owner G, card I). when(s) and score(s) read state only and
// must be pure (no randomness, no clock, no writes). The card shows the top 3 by score that were not
// dismissed in the last cooldownD game days (default 2). go opens a panel or a tool.
// Stage 1b: the first 10 rules (food, fuel, beds, light, smithing, the first horde, the downed).
// About 30 rules ship in Stage 2.
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
  ],
};
