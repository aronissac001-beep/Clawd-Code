// Day > Dusk > Night > Dawn state machine.
import { BAL } from '../../data/balance.js';
import { BOONS } from '../../data/boons.js';
import { BUILDINGS } from '../../data/buildings.js';
import { HOOKS, BUS, each, product, first, isLocked } from '../hooks.js';
import { planNight, startNightSpawns, updateSpawns } from './waves.js';
import { emit, rng, kill } from './common.js';

export function updateCycle(s, dt) {
  const C = BAL.cycle;
  const c = s.cycle;
  c.t += dt;
  switch (c.phase) {
    case 'day':
      if (c.t >= C.dayLen) toDusk(s);
      break;
    case 'dusk':
      if (c.t >= C.duskLen) toNight(s);
      break;
    case 'night': {
      updateSpawns(s);
      let foes = 0, boss = false;
      for (const e of s.enemies) { if (!e.alive || e.stationary || e.guard) continue; foes++; if (e.boss) boss = true; }
      const clear = s.spawnQueue.length === 0 && foes === 0 && !(s.boss && s.boss.state !== 'dormant' && s.boss.state !== 'slain' && s.boss.state !== 'withdrawn' && boss);
      const nm = c.nm || 1;
      if ((clear && c.t >= C.nightMin * nm) || c.t >= C.nightMax * nm) toDawn(s);
      break;
    }
    case 'dawn':
      if (c.t >= C.dawnLen) toDay(s);
      break;
  }
}

export function toDusk(s) {
  s.cycle.phase = 'dusk'; s.cycle.t = 0;
  emit(s, { t: 'dusk', blood: s.wave.blood });
  each(BUS.phase, s, 'dusk');
}

function toNight(s) {
  s.cycle.phase = 'night'; s.cycle.t = 0;
  s.cycle.nm = BUS.nightMult.length ? Math.max(0.3, product(BUS.nightMult, s)) : 1;
  startNightSpawns(s);
  emit(s, { t: 'night', blood: s.wave.blood });
  each(BUS.phase, s, 'night');
}

function toDawn(s) {
  const c = s.cycle;
  const blood = s.wave.blood;
  c.phase = 'dawn'; c.t = 0; c.night++;
  s.spawnQueue.length = 0;
  // Ordinary Hollow burn away in the sunrise; Blood Moon spawn fight on.
  if (!blood) for (const e of s.enemies) { if (e.alive && !e.stationary && !e.boss && !e.guard) { e.alive = false; emit(s, { t: 'burn', x: e.x, y: e.y }); } }
  let gold = Math.round((BAL.dawnGold.base + BAL.dawnGold.perNight * c.night + (s.mods.dawnGold || 0)) * (1 + (s.mods.lootMult || 0)));
  if (s.mods.interest) gold += Math.min(30, Math.floor(s.res.gold * s.mods.interest));
  s.res.gold += gold;
  for (const u of s.soldiers) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.4);
  if (s.objective.type === 'survive' && c.night >= s.objective.nights) s.objective.done = true;
  checkBeacon(s);
  if (s.beaconReady) s.bonusNights = Math.max(0, c.night - s.readyNight);
  // Every 2nd dawn brings a blueprint draft while there are blueprints left to learn.
  const draft = !s.standalone && c.night % 2 === 0 ? makeDraft(s, false, false) : null;
  s.pending = draft || makeBoonChoice(s);
  if (HOOKS.relicHook) HOOKS.relicHook(s, 'onDawn');
  emit(s, { t: 'dawn', night: c.night, gold, blood });
  each(BUS.phase, s, 'dawn');
}

function toDay(s) {
  s.cycle.phase = 'day'; s.cycle.t = 0;
  planNight(s);
  emit(s, { t: 'day', day: s.cycle.night + 1 });
  each(BUS.phase, s, 'day');
}

// The Beacon may be lit once the objective is met, but never in the dark.
export function checkBeacon(s) {
  if (s.beaconReady || !s.objective || !s.objective.done) return;
  if (s.cycle.phase !== 'day' && s.cycle.phase !== 'dawn') return;
  s.beaconReady = true; s.readyNight = s.cycle.night;
  emit(s, { t: 'beaconReady' });
}

/** Blueprint draft: 3 options, +1 for Dawnhold, + mods.draftExtra. Null if nothing is left. */
export function makeDraft(s, start, first) {
  const known = s.blueprints || [];
  // Other factions' unique buildings are never offered.
  const pool = Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].cat && !known.includes(t) && (!BUILDINGS[t].faction || BUILDINGS[t].faction === s.faction) && !isLocked(s, 'buildings', t) && !(BUS.draftVeto.length && first(BUS.draftVeto, s, t)));
  if (!pool.length) return null;
  const r = rng(s);
  const n = Math.min(pool.length, 3 + (s.faction === 'dawnhold' ? 1 : 0) + (s.mods.draftExtra || 0));
  const picks = [];
  if (first) for (const t of ['barracks', 'brazier']) if (pool.includes(t)) picks.push(t);
  const rest = r.shuffle(pool.filter((t) => !picks.includes(t)));
  while (picks.length < n && rest.length) picks.push(rest.shift());
  return { kind: 'blueprint', options: picks, start: !!start };
}

export function makeBoonChoice(s) {
  const r = rng(s);
  const has = (type) => s.buildings.some((b) => b.type === type && b.built);
  const damaged = s.buildings.some((b) => b.built && b.hp < b.maxHp * 0.8);
  const pool = BOONS.filter((b) => !(b.once && s.usedBoons.includes(b.id)) && (!b.needsBuilding || has(b.needsBuilding)) && (!b.needsDamage || damaged));
  const picks = [];
  const avail = pool.slice();
  while (picks.length < 3 + (s.mods.draftExtra || 0) && avail.length) {
    const b = r.weighted(avail, (x) => x.weight);
    avail.splice(avail.indexOf(b), 1);
    picks.push({ id: b.id, amount: b.amount(s.cycle.night) });
  }
  return { kind: 'boon', options: picks };
}

// Used by the "Call the Night" button: skip the rest of the day.
export function callNight(s) {
  if (s.cycle.phase === 'day') toDusk(s);
}

// Debug: end the current night immediately.
export function forceDawn(s) {
  if (s.cycle.phase !== 'night') return;
  for (const e of s.enemies) if (!e.stationary && !e.boss && !e.guard) kill(s, e);
  s.spawnQueue.length = 0;
  s.cycle.t = BAL.cycle.nightMax * (s.cycle.nm || 1);
}
