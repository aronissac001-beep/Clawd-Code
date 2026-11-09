// Day > Dusk > Night > Dawn state machine.
import { BAL } from '../../data/balance.js';
import { BOONS } from '../../data/boons.js';
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
      const clear = s.spawnQueue.length === 0 && s.enemies.length === 0;
      if ((clear && c.t >= C.nightMin) || c.t >= C.nightMax) toDawn(s);
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
}

function toNight(s) {
  s.cycle.phase = 'night'; s.cycle.t = 0;
  startNightSpawns(s);
  emit(s, { t: 'night', blood: s.wave.blood });
}

function toDawn(s) {
  const c = s.cycle;
  const blood = s.wave.blood;
  c.phase = 'dawn'; c.t = 0; c.night++;
  s.spawnQueue.length = 0;
  // Ordinary Hollow burn away in the sunrise; Blood Moon spawn fight on.
  if (!blood) for (const e of s.enemies) { if (e.alive) { e.alive = false; emit(s, { t: 'burn', x: e.x, y: e.y }); } }
  const gold = BAL.dawnGold.base + BAL.dawnGold.perNight * c.night;
  s.res.gold += gold;
  for (const u of s.soldiers) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.4);
  if (c.night >= s.objective.nights && !s.beaconReady) { s.beaconReady = true; emit(s, { t: 'beaconReady' }); }
  if (s.beaconReady) s.bonusNights = c.night - s.objective.nights;
  s.pending = makeBoonChoice(s);
  emit(s, { t: 'dawn', night: c.night, gold, blood });
}

function toDay(s) {
  s.cycle.phase = 'day'; s.cycle.t = 0;
  planNight(s);
  emit(s, { t: 'day', day: s.cycle.night + 1 });
}

export function makeBoonChoice(s) {
  const r = rng(s);
  const has = (type) => s.buildings.some((b) => b.type === type && b.built);
  const damaged = s.buildings.some((b) => b.built && b.hp < b.maxHp * 0.8);
  const pool = BOONS.filter((b) => !(b.once && s.usedBoons.includes(b.id)) && (!b.needsBuilding || has(b.needsBuilding)) && (!b.needsDamage || damaged));
  const picks = [];
  const avail = pool.slice();
  while (picks.length < 3 && avail.length) {
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
  for (const e of s.enemies) kill(s, e);
  s.spawnQueue.length = 0;
  s.cycle.t = BAL.cycle.nightMax;
}
