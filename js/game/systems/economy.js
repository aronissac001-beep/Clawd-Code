// The day economy (EMBERCROWN-REWORK.md, stream E): upkeep, taxes, the dawn income lump,
// population growth, starvation, caches, the no-wood soft-lock guard and the per-minute
// resource flow shown in the HUD.
//
// Income. Producers (farms, camps, quarries, houses, markets) pay a share of what they make at
// once (BAL.economy.trickle, so villager work still reads) and bank the rest on the building
// (b.bank, b.bankK) and in s.econ.bank. The bank pays out as one visible lump at dawn, after the
// dawn's card is picked: event { t:'incomeLump', items:[{ id, type, x, y, k, a }], total:{k:a} }
// (stream G draws it as flying icons). Food in the bank feeds the realm before anyone starves.
//
// Plain JSON on s.econ = { bank:{food,wood,stone,gold}, paid (night whose lump was paid),
//   softlock: null | { k, kind:'trade'|'camp', price, amount, gold }, slT, giftN, idle, warned:{} }.
// Every field is defaulted here, so older saves load without a migration.
//
// Contracts exposed to other streams (also on BUS.query):
//   anyAffordable(s)               stream D: the day may end early when this is false.
//   placeInfo(s, type, tx, ty)     stream F: what a gatherer camp would reach from there.
//   needsRepair(s) / repairCost(b) stream H2 (events) and F (cards): is anything damaged, and
//                                  what a building's full repair costs.
//   idleCount(s)                   stream F: the HUD's "idle: N".
//   s.econ.softlock + event { t:'softlock', k, kind, price, amount, canPay } / { t:'softlock',
//                                  clear:true }: stream F shows the inline Hearth trade button.
import { BAL } from '../../data/balance.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { UNITS } from '../../data/units.js';
import { T, ctr } from '../grid.js';
import { flowRes, popCap, spawnVillager, emit, RES_KEYS, canAfford, costOf } from './common.js';
import { HOOKS, BUS, isLocked } from '../hooks.js';

const E = () => BAL.economy;

/** s.econ with every field present (older saves have none of it). */
export function econ(s) {
  let e = s.econ;
  if (!e || typeof e !== 'object') e = s.econ = {};
  if (!e.bank || typeof e.bank !== 'object') e.bank = { food: 0, wood: 0, stone: 0, gold: 0 };
  for (const k of RES_KEYS) if (typeof e.bank[k] !== 'number' || !isFinite(e.bank[k])) e.bank[k] = 0;
  if (typeof e.paid !== 'number') e.paid = s.cycle ? s.cycle.night : 0;
  if (e.softlock === undefined) e.softlock = null;
  if (typeof e.slT !== 'number') e.slT = 0;
  if (typeof e.giftN !== 'number') e.giftN = -1;
  if (typeof e.idle !== 'number') e.idle = 0;
  if (!e.warned || typeof e.warned !== 'object') e.warned = {};
  return e;
}

function trickleOf(k) {
  const t = E().trickle;
  return typeof t === 'number' ? t : (t && typeof t[k] === 'number' ? t[k] : 1);
}

/** A producer made `a` of resource k: part now (returned, for the floater), the rest banked. */
export function produce(s, b, k, a) {
  if (!(a > 0)) return 0;
  const now = a * trickleOf(k);
  const rest = a - now;
  if (now > 0) flowRes(s, k, now);
  if (rest > 0) {
    if (s.stats.produced) s.stats.produced[k] = (s.stats.produced[k] || 0) + rest;
    econ(s).bank[k] += rest;
    if (b) { if (b.bankK && b.bankK !== k) b.bank2 = (b.bank2 || 0) + rest; else { b.bankK = k; b.bank = (b.bank || 0) + rest; } }
  }
  return now;
}

/** Pay the banked output as one lump (at dawn). Returns the totals paid. */
export function payLump(s) {
  const e = econ(s);
  const total = { food: 0, wood: 0, stone: 0, gold: 0 };
  let any = false;
  for (const k of RES_KEYS) {
    const a = e.bank[k];
    if (a > 0.0001) { total[k] = a; any = true; s.res[k] += a; s.flow[k] += a; }
    e.bank[k] = 0;
  }
  const items = [];
  const left = { ...total };
  for (const b of s.buildings) {
    if (b.bank > 0 && b.bankK && b.alive) {
      const a = Math.min(b.bank, left[b.bankK]);
      if (a > 0.5) { items.push({ id: b.id, type: b.type, x: (b.tx + b.size / 2) * T, y: (b.ty + b.size / 2) * T - 16, k: b.bankK, a: Math.round(a) }); left[b.bankK] -= a; }
    }
    b.bank = 0; b.bank2 = 0;
  }
  // Whatever lost its building (demolished, destroyed) or came from a second resource: the Hearth.
  const h = s.rt.hearth;
  if (h) for (const k of RES_KEYS) if (left[k] > 0.5) items.push({ id: h.id, type: 'hearth', x: (h.tx + 1.5) * T, y: (h.ty + 1.5) * T - 20, k, a: Math.round(left[k]) });
  e.paid = s.cycle.night;
  if (any) {
    for (const k of RES_KEYS) total[k] = Math.round(total[k]);
    emit(s, { t: 'incomeLump', items, total, night: s.cycle.night });
  }
  return total;
}

export function updateEconomy(s, dt) {
  const V = BAL.villager;
  const e = econ(s);
  const villagers = s.villagers.length;
  const soldiers = s.soldiers.length;

  // The dawn lump, once the dawn's card has been picked (a choice freezes the tick, so the lump
  // lands when the player is looking at the town again).
  if (s.cycle.phase === 'dawn' && !s.pending && e.paid !== s.cycle.night) payLump(s);
  else if (s.cycle.phase === 'day' && e.paid < s.cycle.night) payLump(s); // a dawn skipped by a debug jump

  // Food upkeep, continuous.
  const upkeep = Math.max(0.3, 1 + (s.mods.upkeep || 0) - (HOOKS.upkeepCut ? HOOKS.upkeepCut(s) : 0));
  const heroes = s.heroes ? s.heroes.length : 0;
  flowRes(s, 'food', -((villagers * V.foodPerMin + (soldiers + heroes) * BAL.soldierFoodPerMin) / 60) * dt * upkeep * (s.rt.upkeepMult ?? 1));
  // The store feeds the realm before anyone goes hungry: banked food comes out early.
  if (s.res.food < 5 && e.bank.food > 0) {
    const a = Math.min(e.bank.food, 5 - s.res.food);
    e.bank.food -= a; s.res.food += a;
  }

  // House taxes.
  for (const b of s.buildings) {
    if (!b.built || b.type !== 'house') continue;
    const g = (levelStats('house', b.level).gold / 60) * dt * (1 + (s.mods.goldMult || 0)) * (s.rt.goldMult || 1);
    produce(s, b, 'gold', g);
  }

  // Newcomers arrive by day while there is room, food and work for them.
  const cap = popCap(s);
  s.stats.peakPop = Math.max(s.stats.peakPop, villagers);
  const open = openJobs(s);
  if (s.cycle.phase === 'day' && villagers >= cap && open > 0 && !s.timers.capWarned && s.cycle.t > 12) {
    s.timers.capWarned = true;
    emit(s, { t: 'toast', text: 'Every house is full. Build Houses so newcomers can settle.', icon: 'house' });
  }
  if (villagers < cap) s.timers.capWarned = false;
  if (s.cycle.phase === 'day' && villagers < cap && open > 0 && s.res.food >= V.growthFoodMin) {
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

  if (s.tick % 10 === 0) { e.idle = idleCount(s); softlockGuard(s, e, dt * 10); }

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

// ---- Jobs and idle villagers ---------------------------------------------------------------

/** Job slots the realm offers: wanted workers at built workplaces that still have work. */
export function jobSlots(s) {
  let n = 0;
  for (const b of s.buildings) if (b.alive && b.built && !b.noRes && b.wantW > 0) n += b.wantW;
  return n;
}
/** Slots no villager fills yet (newcomers only settle while this is above 0). */
export function openJobs(s) { return jobSlots(s) - s.villagers.length; }

/** Villagers with nothing to do by day (no job and nothing to build). */
export function idleCount(s) {
  let n = 0;
  for (const v of s.villagers) if (v.alive && !v.job && !v.build && (v.st === 'idle' || v.st === 'home' || v.st === 'athome' || v.st === 'wander')) n++;
  return n;
}

// ---- Affordability (stream D ends the day early when nothing is) -----------------------------

/** Buildings the player could place in this region (blueprints, locks, faction). */
function placeable(s, t) {
  const def = BUILDINGS[t];
  if (!def || !def.cat) return false;
  const bp = s.blueprints && s.blueprints.length ? s.blueprints : null;
  if (bp && !bp.includes(t)) return false;
  if (isLocked(s, 'buildings', t)) return false;
  if (def.faction && def.faction !== s.faction) return false;
  return true;
}

/** Can the player afford a real choice: a building (walls aside: 5 wood a segment is no
 *  decision), an upgrade or a soldier at a Barracks with room? */
export function anyAffordable(s) {
  for (const t of Object.keys(BUILDINGS)) {
    const def = BUILDINGS[t];
    if (def.line || !placeable(s, t)) continue;
    if (canAfford(s.res, costOf(s, t, 0))) return true;
  }
  let trains = false;
  for (const b of s.buildings) {
    if (!b.alive || !b.built || b.upg) continue;
    const def = BUILDINGS[b.type];
    if (def && def.levels && def.levels[b.level + 1] && !def.line && canAfford(s.res, costOf(s, b.type, b.level + 1))) return true;
    if (Array.isArray(b.train) && levelStats(b.type, b.level).squadCap) trains = true;
  }
  if (trains) for (const u of Object.values(UNITS)) if (u.cost && u.train && canAfford(s.res, u.cost)) return true;
  return false;
}

// ---- Gatherer camps: placement needs enough to harvest ----------------------------------------

/** Standing resource of kind ('tree'|'rock') within r world units of (cx, cy). Woods under the
 *  fog count too: a camp's workers walk into them (and their walking reveals them). */
export function standing(s, kind, cx, cy, r) {
  let total = 0, n = 0;
  const r2 = r * r;
  for (const nd of s.nodes) {
    if (nd.kind !== kind || nd.amount <= 0) continue;
    const dx = ctr(nd.tx) - cx, dy = ctr(nd.ty) - cy;
    if (dx * dx + dy * dy <= r2) { total += nd.amount; n++; }
  }
  return { total, n };
}

/** What a camp of this type would reach from (tx, ty): null for buildings that need nothing.
 *  { needs:'tree'|'rock', res:'wood'|'stone', total, nodes, min, radius (tiles), ok } */
export function placeInfo(s, type, tx, ty) {
  const def = BUILDINGS[type];
  if (!def || !def.needs) return null;
  const st = levelStats(type, 0);
  const cx = (tx + def.size / 2) * T, cy = (ty + def.size / 2) * T;
  const { total, n } = standing(s, def.needs, cx, cy, st.radius * T);
  const min = def.needs === 'tree' ? E().campMinWood : E().campMinStone;
  return { needs: def.needs, res: def.needs === 'tree' ? 'wood' : 'stone', total: Math.round(total), nodes: n, min, radius: st.radius, ok: n > 0 && total >= min };
}

/** BUS.canPlace veto: a Lumber Camp must reach at least campMinWood of standing wood. */
function campVeto(s, type, tx, ty) {
  const def = BUILDINGS[type];
  if (!def || def.needs !== 'tree') return null;
  const info = placeInfo(s, type, tx, ty);
  if (!info || !info.nodes || info.ok) return null; // no trees at all: canPlace's own reason
  return { ok: false, reason: `Only ${info.total} wood in reach (a camp needs ${info.min})`, info };
}

// ---- Repairs -------------------------------------------------------------------------------

/** What repairs a building: its def.repairWith, else the material most of its cost was paid in. */
export function repairMaterial(b) {
  const def = BUILDINGS[b.type];
  if (!def) return 'wood';
  if (def.repairWith) return def.repairWith;
  let w = 0, st = 0;
  for (let i = 0; i <= Math.min(b.level || 0, def.levels.length - 1); i++) {
    const c = def.levels[i].cost || {};
    w += c.wood || 0; st += c.stone || 0;
  }
  return st > w ? 'stone' : 'wood';
}
/** Material cost of restoring hp hit points. */
export function repairPrice(hp) { return hp / BAL.repair.hpPerRes; }
/** { k, a } to repair b to full (a rounded up), or null when undamaged. */
export function repairCost(b) {
  if (!b || !b.built || b.hp >= b.maxHp) return null;
  return { k: repairMaterial(b), a: Math.ceil(repairPrice(b.maxHp - b.hp)) };
}
/** Is any building damaged (an event that repairs must check this before charging)? */
export function needsRepair(s) {
  for (const b of s.buildings) if (b.alive && b.built && b.hp < b.maxHp - 0.5) return true;
  return false;
}

// ---- The no-wood soft-lock guard -------------------------------------------------------------

/** Is wood coming in, or about to? A camp that is working or being built, or wood on the way. */
export function woodIncoming(s) {
  for (const b of s.buildings) {
    if (!b.alive || BUILDINGS[b.type]?.needs !== 'tree') continue;
    if (!b.built || b.upg) return true;
    if (!b.noRes && b.wantW > 0) return true;
  }
  for (const v of s.villagers) if (v.alive && v.carryK === 'wood') return true;
  return false;
}
/** Wood the cheapest wood producer the player may place costs. */
export function cheapestWoodProducer(s) {
  let best = Infinity;
  for (const t of Object.keys(BUILDINGS)) {
    if (BUILDINGS[t].needs !== 'tree' || !placeable(s, t)) continue;
    best = Math.min(best, costOf(s, t, 0).wood || 0);
  }
  return isFinite(best) ? best : (BUILDINGS.lumber ? costOf(s, 'lumber', 0).wood || 0 : 0);
}
function tradeWoodPrice(s) { return BAL.trade.wood.price + BAL.trade.priceStep * ((s.trades && s.trades.wood) || 0); }

function softlockGuard(s, e, dt) {
  const day = s.cycle.phase === 'day';
  const need = cheapestWoodProducer(s);
  const stuck = day && !woodIncoming(s);
  const short = s.res.wood < need;
  let kind = null;
  if (stuck) kind = short ? 'trade' : 'camp';
  if (!kind) {
    e.slT = 0;
    if (e.softlock && (!day || !stuck)) { e.softlock = null; emit(s, { t: 'softlock', k: 'wood', clear: true }); }
    return;
  }
  e.slT += dt;
  if (e.slT < E().softlockAfter) return;
  const price = tradeWoodPrice(s), amount = BAL.trade.wood.amount;
  const canPay = s.res.gold >= price;
  const cur = e.softlock;
  if (!cur || cur.kind !== kind || cur.canPay !== canPay || cur.price !== price) {
    e.softlock = { k: 'wood', kind, price, amount, canPay, need };
    emit(s, { t: 'softlock', k: 'wood', kind, price, amount, canPay, need });
    const key = kind + s.cycle.night;
    if (!e.warned[key]) {
      e.warned = { [key]: 1 }; // one line a day per kind, never a pile
      emit(s, kind === 'camp'
        ? { t: 'toast', text: 'No wood is coming in. Build a Lumber Camp beside a forest.', tone: 'bad', icon: 'wood' }
        : { t: 'toast', text: canPay ? `Out of wood. Trade ${price} gold for ${amount} wood at the Hearth.` : 'Out of wood and gold. Hold on: a carter is coming.', tone: 'bad', icon: 'wood' });
    }
  }
  // Nothing can buy the way out: a carter brings enough logs for a camp (once a day).
  if (kind === 'trade' && !canPay && e.slT >= E().giftAfter && e.giftN !== s.cycle.night) {
    e.giftN = s.cycle.night;
    const a = Math.max(E().giftWood, Math.ceil(need - s.res.wood));
    s.res.wood += a;
    const h = s.rt.hearth;
    emit(s, { t: 'toast', text: `A carter from the next valley leaves a load of logs: +${a} wood.`, tone: 'good', icon: 'wood' });
    if (h) emit(s, { t: 'gain', k: 'wood', a, x: (h.tx + 1.5) * T, y: h.ty * T - 10 });
  }
}

// Contracts on the plug-in bus (this module is always loaded with the simulation).
if (!BUS.query.placeInfo) {
  BUS.query.anyAffordable = anyAffordable;
  BUS.query.placeInfo = placeInfo;
  BUS.query.needsRepair = needsRepair;
  BUS.query.repairCost = repairCost;
  BUS.query.idleVillagers = idleCount;
  BUS.canPlace.push(campVeto);
}
