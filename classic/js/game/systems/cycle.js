// Day > Dusk > Night > Dawn state machine.
//
// Pacing (EMBERCROWN-REWORK.md, stream D): a short day to spend (35 s, 50 s on a region's first
// day), a 6 s dusk that shows tonight's fronts and routes, a night that lasts until the wave is
// dead plus a short grace (12-75 s), and a 3 s dawn with one reward pick. Calling the Night
// early pays gold for every second skipped, and the day ends on its own when nothing is
// affordable and nothing is queued. Wounds carry over: soldiers heal only a little at dawn.
//
// Plain JSON on s.cycle = { phase, t, night, len (this phase's length, for the HUD), nm,
//   clearT (seconds the night has been clear), idleT (seconds the day has had nothing to do) }
import { BAL } from '../../data/balance.js';
import { BOONS } from '../../data/boons.js';
import { BUILDINGS } from '../../data/buildings.js';
import { UNITS } from '../../data/units.js';
import { HOOKS, BUS, each, product, first, isLocked } from '../hooks.js';
import { planNight, startNightSpawns, updateSpawns, planRoutes, longNightHeld } from './waves.js';
import { emit, rng, kill, costOf, canAfford } from './common.js';

/** Length of the current phase in seconds (also kept on s.cycle.len for the HUD). */
export function phaseLen(s) {
  const C = BAL.cycle, c = s.cycle;
  switch (c.phase) {
    case 'day': return c.night === 0 ? C.firstDayLen : C.dayLen;
    case 'dusk': return C.duskLen;
    case 'night': return C.nightMax * (c.nm || 1);
    default: return C.dawnLen;
  }
}

export function updateCycle(s, dt) {
  const C = BAL.cycle;
  const c = s.cycle;
  c.t += dt;
  if (c.len == null) c.len = phaseLen(s); // older saves
  switch (c.phase) {
    case 'day':
      if (c.t >= phaseLen(s)) { toDusk(s); break; }
      // Nothing to buy and nothing being built or trained: the day ends on its own.
      if (s.tick % 10 === 0) {
        const idle = c.t >= C.autoEndAfter && !dayHasWork(s);
        c.idleT = idle ? (c.idleT || 0) + dt * 10 : 0;
        if (c.idleT >= C.autoEndIdle) { emit(s, { t: 'toast', text: 'Nothing left to build today. Dusk falls early.', tone: '', icon: 'moon' }); callNight(s, true); }
      }
      break;
    case 'dusk':
      if (c.t >= C.duskLen) toNight(s);
      break;
    case 'night': {
      updateSpawns(s);
      let foes = 0, boss = false;
      for (const e of s.enemies) { if (!e.alive || e.stationary || e.guard) continue; foes++; if (e.boss) boss = true; }
      const clear = s.spawnQueue.length === 0 && foes === 0 && !(s.boss && s.boss.state !== 'dormant' && s.boss.state !== 'slain' && s.boss.state !== 'withdrawn' && boss);
      c.clearT = clear ? (c.clearT || 0) + dt : 0;
      const nm = c.nm || 1;
      if ((clear && c.clearT >= C.clearGrace && c.t >= C.nightMin * nm) || c.t >= C.nightMax * nm) toDawn(s);
      break;
    }
    case 'dawn':
      if (c.t >= C.dawnLen) toDay(s);
      break;
  }
}

/** Is there still something to do by day? Building or training under way, or anything affordable. */
function dayHasWork(s) {
  for (const b of s.buildings) {
    if (!b.alive) continue;
    if (!b.built || b.upg) return true;
    if (b.train && b.train.length) return true;
  }
  return anyAffordable(s);
}

/** Can the player afford anything: a building, an upgrade or a soldier? Stream E may provide a
 *  richer answer through BUS.query.anyAffordable (s) -> boolean; this is the fallback. */
export function anyAffordable(s) {
  if (BUS.query.anyAffordable) return !!BUS.query.anyAffordable(s);
  const bp = s.blueprints && s.blueprints.length ? s.blueprints : null;
  for (const t of Object.keys(BUILDINGS)) {
    const def = BUILDINGS[t];
    if (!def.cat || (bp && !bp.includes(t)) || isLocked(s, 'buildings', t)) continue;
    if (def.faction && def.faction !== s.faction) continue;
    if (canAfford(s.res, costOf(s, t, 0))) return true;
  }
  let barracks = false;
  for (const b of s.buildings) {
    if (!b.alive || !b.built) continue;
    const def = BUILDINGS[b.type];
    if (def && def.levels && def.levels[b.level + 1] && b.type !== 'hearth' && canAfford(s.res, costOf(s, b.type, b.level + 1))) return true;
    if (Array.isArray(b.train)) barracks = true;
  }
  if (barracks) for (const u of Object.values(UNITS)) if (u.cost && canAfford(s.res, u.cost)) return true;
  return false;
}

export function toDusk(s) {
  s.cycle.phase = 'dusk'; s.cycle.t = 0; s.cycle.idleT = 0; s.cycle.len = BAL.cycle.duskLen;
  planRoutes(s);
  emit(s, { t: 'dusk', blood: !!s.wave.long, long: !!s.wave.long });
  each(BUS.phase, s, 'dusk');
}

function toNight(s) {
  s.cycle.phase = 'night'; s.cycle.t = 0; s.cycle.clearT = 0;
  s.cycle.nm = BUS.nightMult.length ? Math.max(0.3, product(BUS.nightMult, s)) : 1;
  s.cycle.len = phaseLen(s);
  startNightSpawns(s);
  emit(s, { t: 'night', blood: !!s.wave.long, long: !!s.wave.long });
  each(BUS.phase, s, 'night');
}

function toDawn(s) {
  const c = s.cycle;
  const long = !!(s.wave && s.wave.long);
  c.phase = 'dawn'; c.t = 0; c.night++; c.len = BAL.cycle.dawnLen; c.clearT = 0;
  s.spawnQueue.length = 0;
  // The Hollow that still stand burn away in the sunrise (the Long Night's too).
  for (const e of s.enemies) { if (e.alive && !e.stationary && !e.boss && !e.guard) { e.alive = false; emit(s, { t: 'burn', x: e.x, y: e.y }); } }
  let gold = Math.round((BAL.dawnGold.base + BAL.dawnGold.perNight * c.night + (s.mods.dawnGold || 0)) * (1 + (s.mods.lootMult || 0)));
  if (s.mods.interest) gold += Math.min(30, Math.floor(s.res.gold * s.mods.interest));
  s.res.gold += gold;
  // Wounds stay: a night's rest heals soldiers a little; more needs a healer.
  const heal = BAL.cycle.soldierDawnHeal;
  for (const u of s.soldiers) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * heal);
  if (long && s.objective) s.objective.held = true;
  if (s.objective.type === 'survive' && c.night >= s.objective.nights) s.objective.done = true;
  if (HOOKS.updateObjective) HOOKS.updateObjective(s);
  checkBeacon(s);
  if (s.beaconReady) s.bonusNights = Math.max(0, c.night - s.readyNight);
  // One reward pick per dawn. The dawn the Beacon becomes ready is the region's end: its
  // reward is the Beacon's, so no Dawn Card then (staying on brings them back).
  const regionEnd = s.beaconReady && s.readyNight === c.night && !s.standalone && s.objective.type !== 'endless';
  if (!regionEnd) s.pending = dawnChoice(s);
  else if (HOOKS.beaconReward) s.pending = HOOKS.beaconReward(s) || null; // stream H2's region-end pick
  if (HOOKS.relicHook) HOOKS.relicHook(s, 'onDawn');
  emit(s, { t: 'dawn', night: c.night, gold, blood: long, long });
  each(BUS.phase, s, 'dawn');
}

/** The dawn's single pending choice: HOOKS.dawnCard (stream H2) when set, otherwise the
 *  classic alternation (a blueprint draft every 2nd dawn while any are left, else an Offering). */
function dawnChoice(s) {
  if (HOOKS.dawnCard) return HOOKS.dawnCard(s) || null;
  const draft = !s.standalone && s.cycle.night % 2 === 0 ? makeDraft(s, false, false) : null;
  return draft || makeBoonChoice(s);
}

function toDay(s) {
  s.cycle.phase = 'day'; s.cycle.t = 0; s.cycle.idleT = 0;
  s.cycle.len = phaseLen(s);
  planNight(s);
  emit(s, { t: 'day', day: s.cycle.night + 1 });
  each(BUS.phase, s, 'day');
}

// The Beacon may be lit once the objective is met and the region's Long Night has been held,
// but never in the dark.
export function checkBeacon(s) {
  if (s.beaconReady || !s.objective || !s.objective.done) return;
  if (s.cycle.phase !== 'day' && s.cycle.phase !== 'dawn') return;
  if (s.objective.type !== 'boss' && s.objective.type !== 'endless' && !longNightHeld(s)) return;
  s.beaconReady = true; s.readyNight = s.cycle.night;
  emit(s, { t: 'beaconReady' });
}

/** Blueprint draft: 3 options, +1 for Dawnhold, + mods.draftExtra. Null if nothing is left. */
export function makeDraft(s, start, isFirst) {
  const known = s.blueprints || [];
  // Other factions' unique buildings are never offered.
  const pool = Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].cat && !known.includes(t) && (!BUILDINGS[t].faction || BUILDINGS[t].faction === s.faction) && !isLocked(s, 'buildings', t) && !(BUS.draftVeto.length && first(BUS.draftVeto, s, t)));
  if (!pool.length) return null;
  const r = rng(s);
  const n = Math.min(pool.length, 3 + (s.faction === 'dawnhold' ? 1 : 0) + (s.mods.draftExtra || 0));
  const picks = [];
  if (isFirst) for (const t of ['barracks', 'brazier']) if (pool.includes(t)) picks.push(t);
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

/** "Call the Night": skip the rest of the day for gold (callGold per second skipped). A day
 *  that ends on its own (auto: nothing left to do) pays nothing. */
export function callNight(s, auto) {
  if (s.cycle.phase !== 'day') return 0;
  const left = Math.max(0, phaseLen(s) - s.cycle.t);
  const gold = auto ? 0 : Math.floor(left * BAL.cycle.callGold);
  if (gold > 0) {
    s.res.gold += gold;
    emit(s, { t: 'toast', text: `You call the night early: +${gold} gold.`, tone: 'good', icon: 'gold' });
  }
  toDusk(s);
  return gold;
}

// Debug: end the current night immediately.
export function forceDawn(s) {
  if (s.cycle.phase !== 'night') return;
  for (const e of s.enemies) if (!e.stationary && !e.boss && !e.guard) kill(s, e);
  s.spawnQueue.length = 0;
  s.cycle.t = BAL.cycle.nightMax * (s.cycle.nm || 1);
}

/** Debug "complete the objective": the objective and the Long Night both count as done. */
export function debugWin(s) {
  const o = s.objective;
  if (!o) return;
  o.done = true; o.held = true;
  if (o.type === 'survive') s.cycle.night = Math.max(s.cycle.night, o.nights);
}
