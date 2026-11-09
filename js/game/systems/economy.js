// Upkeep, taxes, population growth, starvation, caches and the per-minute
// resource flow shown in the HUD.
import { BAL } from '../../data/balance.js';
import { levelStats } from '../../data/buildings.js';
import { T } from '../grid.js';
import { flowRes, popCap, spawnVillager, emit, RES_KEYS } from './common.js';
import { HOOKS } from '../hooks.js';

export function updateEconomy(s, dt) {
  const V = BAL.villager;
  const villagers = s.villagers.length;
  const soldiers = s.soldiers.length;

  // Food upkeep, continuous.
  const upkeep = Math.max(0.3, 1 + (s.mods.upkeep || 0) - (HOOKS.upkeepCut ? HOOKS.upkeepCut(s) : 0));
  flowRes(s, 'food', -((villagers * V.foodPerMin + soldiers * BAL.soldierFoodPerMin) / 60) * dt * upkeep);

  // House taxes.
  let gold = 0;
  for (const b of s.buildings) if (b.built && b.type === 'house') gold += levelStats('house', b.level).gold;
  flowRes(s, 'gold', (gold / 60) * dt * (1 + (s.mods.goldMult || 0)));

  // Newcomers arrive by day while there is room and food.
  const cap = popCap(s);
  s.stats.peakPop = Math.max(s.stats.peakPop, villagers);
  if (s.cycle.phase === 'day' && villagers >= cap && !s.timers.capWarned && s.cycle.t > 20) {
    s.timers.capWarned = true;
    emit(s, { t: 'toast', text: 'Every house is full. Build Houses so newcomers can settle.', icon: 'house' });
  }
  if (villagers < cap) s.timers.capWarned = false;
  if (s.cycle.phase === 'day' && villagers < cap && s.res.food >= V.growthFoodMin) {
    s.timers.growth += dt;
    if (s.timers.growth >= V.growthInterval) {
      s.timers.growth = 0;
      s.res.food -= V.growthFoodCost;
      const v = spawnVillager(s);
      emit(s, { t: 'newcomer', x: v.x, y: v.y - 20, n: villagers + 1, cap });
    }
  }

  // Starvation: people leave rather than die outright.
  if (s.res.food <= 0.01 && villagers > 0) {
    s.timers.starve += dt;
    if (s.timers.starve >= V.starveInterval) {
      s.timers.starve = 0;
      const v = s.villagers[s.villagers.length - 1];
      v.alive = false;
      emit(s, { t: 'toast', text: 'Hungry, a villager leaves for the wilds. Build Farms!', tone: 'bad', icon: 'food' });
    }
  } else s.timers.starve = 0;

  // Caches: any friendly walking within a tile claims it.
  for (const c of s.caches) {
    if (c.taken) continue;
    const cx = (c.tx + 0.5) * T, cy = (c.ty + 0.5) * T;
    const f = s.rt.friendHash.nearest(cx, cy, T * 1.1);
    if (f) {
      c.taken = true; s.stats.cachesFound++;
      const parts = [];
      for (const k in c.reward) { s.res[k] += c.reward[k]; parts.push(`+${c.reward[k]} ${k}`); }
      emit(s, { t: 'toast', text: `Cache recovered: ${parts.join(', ')}`, tone: 'good', icon: Object.keys(c.reward)[0] });
      emit(s, { t: 'cache', x: cx, y: cy });
    }
  }

  // Rate tracking in 5-second buckets.
  s.rateT += dt;
  if (s.rateT >= 5) {
    s.rateT -= 5;
    s.rateHist.push(RES_KEYS.map((k) => Math.round(s.flow[k] * 10) / 10));
    for (const k of RES_KEYS) s.flow[k] = 0;
    if (s.rateHist.length > BAL.rateWindow / 5) s.rateHist.shift();
  }
}

export function ratesPerMin(s) {
  const out = { food: 0, wood: 0, stone: 0, gold: 0 };
  const n = s.rateHist.length;
  if (!n) return out;
  for (const row of s.rateHist) RES_KEYS.forEach((k, i) => { out[k] += row[i]; });
  const minutes = (n * 5) / 60;
  for (const k of RES_KEYS) out[k] = out[k] / minutes;
  return out;
}
