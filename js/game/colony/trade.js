// Trade with visiting caravans (doc 9.8). Owner K.
// A visit (trader type from js/data/traders.js) stays one game day at the trade post or the Hearth.
// Prices: base value x buyPct / sellPct, adjusted by the faction's goodwill and the Envoy's Social.
//
// Stage 2. K's saved record s.colony.trade = { next, visits: [Visit], envoy: Envoy | null, nextEnvoy,
// paidGutterkin } (created by the first Stage 2 colony tick).
//   Visit = { id (s.next.visit), trader, until, stock: [{ k, m, q, n }], coins }
//   Schedule: a pedlar every VISIT.campD days at Camp; from Hamlet a caravan every VISIT.hamletD days
//   (types of the colony's tier or lower; the grain barge only on a map with water). Arrival emits a
//   'letter' (kind 'trader'); the visit leaves at `until`.
//   The trade command { visitId, buy, sell } (C3): the colony pays in coins (item 'coins', 1 coin
//   each) from its stockpiles and receives coins for what it sells; goods move through E's item API
//   (sold goods leave from the stockpiles, bought goods and coins land by the trade post or the Hearth).
//   The trader must deal in a good's category, hold it (buy) and have the coins (sell). Every trade
//   raises the faction's goodwill by 1, is counted (ledger 'traded') and gets a Chronicle line.
//   Envoys (9.8, from Hamlet, one a season): a goodwill faction asks for `n` of an item kind by a
//   deadline; at the deadline the goods are taken from the stockpiles if they are there (+10 goodwill
//   and a coin reward), else the faction is let down (-5). The letter and the Chronicle tell it.
//   Gutterkin (9.8): payGutterkin(s) takes 200 coins and halves their raids for a season
//   (gutterkinRaidPct, for H's storyteller weights).
//
// W3.3a (EMBERCROWN-WORLD.md 2.7 caravans row, G6, G7). In a hold whose realm record with history is loaded
// (factions.js realmRec), the roles are bound once (ensureBound) and caravans come from real towns: caravans.js
// caravanSources (friendly towns and cities within 12 travel days). Each source site keeps a row [site, next tick] in
// rec.sites (only realm holds have the key): its first caravan arrives after max(4, its travel days) days, the next
// one its cadence (travel days x 2 + 5, at least a season) after the last arrival; one arrival an hour, one visit
// per site at a time. The trader type is one of the tier's (a river barge only from a site on a great river) that the site's
// role deals through when it has one; its stock leans to the goods of the site's people and biome, x1.5 by barge.
// The visit records { site, fac, barge }: prices and goodwill go to `fac` (the bound role key, or the civ's 'c<n>').
// A realm-less hold (or a lost record, 9.2) runs the legacy schedule above, draw for draw.

import { noteTradeOut } from './offices.js';
import { registerApplier } from '../core/commands.js';
import { emit } from '../core/events.js';
import { nextU32 } from '../core/rand.js';
import { nextId, bldById } from '../core/state.js';
import { TICKS_PER_DAY, DAYS_PER_SEASON } from '../core/time.js';
import { TER_WATER, N } from '../core/grid.js';
import { def, all } from './defs.js';
import { goodwillPricePct, addGoodwill, GOODWILL_IDS, seedGoodwill, ensureBound, realmRec } from './factions.js';
import { caravanSources, REALM_CARAVAN } from './caravans.js';
import { atLeast, tierIndex } from './tiers.js';
import { bump } from './ledger.js';
import { addChron } from './chronicle.js';
import { spawn, take, forEachItem, inStockpile, categoryOf } from '../work/items.js';
import { catChain } from '../work/stockpiles.js';
import { level } from '../people/skills.js';
import { didDeed } from '../people/coldeeds.js';
import { idx } from '../core/grid.js';

export const VISIT = Object.freeze({ campD: 12, hamletD: 8, stayD: 1, firstD: 4, kinds: [5, 8], coins: [300, 900], envoyD: 6, gutterkinCost: 200 });

/** Price in tenths of a coin the colony pays for `n` of an item from a trader (`fac`: the visit's faction, visitFaction). */
export function buyPrice(s, traderId, k, n, fac = null) {
  const t = def('trader', traderId), d = def('item', k);
  if (!t || !d) return 0;
  return Math.ceil((d.value * n * t.buyPct * goodwillPricePct(s, fac || t.faction) * (100 - envoyPct(s))) / 1000000);
}
/** Price the colony gets for `n` of an item. */
export function sellPrice(s, traderId, k, n, fac = null) {
  const t = def('trader', traderId), d = def('item', k);
  if (!t || !d) return 0;
  return Math.floor((d.value * n * t.sellPct * (200 - goodwillPricePct(s, fac || t.faction)) * (100 + envoyPct(s))) / 1000000);
}
/** The faction a visit trades for: a realm caravan's `fac` (role key or 'c<n>'), else its trader type's faction. */
export function visitFaction(s, v) {
  if (v && typeof v.fac === 'string') return v.fac;
  const t = v ? def('trader', v.trader) : null;
  return t ? t.faction : null;
}
/** Where a realm caravan came from, for its letter and the trade sheet: { site, name, civ, civName, barge } or null. */
export function visitFrom(s, v) {
  const R = v && Number.isInteger(v.site) ? realmRec(s) : null, x = R ? R.tables.sites[v.site] : null;
  if (!x) return null;
  const c = Number.isInteger(x.civ) ? R.tables.civs[x.civ] : null;
  return { site: v.site, name: x.name || '', civ: c ? c.id : null, civName: c ? c.name : '', barge: v.barge === true };
}
/** The Envoy's Social bonus percent (the best Social of the living colonists): -5 at 0, +15 at 20. */
export function envoyPct(s) {
  let best = 0;
  for (const c of s.col) if (!c.hp.dead) best = Math.max(best, level(c, 'social'));
  return Math.max(-5, Math.min(15, best - 5));
}
/** Coins that must change hands (paid plus got) for a trade to count as the envoy's bargain. */
export const TRADE_DEED_COINS = 10;
/**
 * The colonist who strikes the bargain: the best Social of those standing (not dead or downed; the first in
 * s.col on a tie), else the best of the living. They are credited with the trade (the `trades` deed: Silver
 * Tongue, EMBERCROWN-FORTRESS.md 3.1). null with no one alive.
 */
export function envoyOf(s) {
  let best = null, bl = -1, up = false;
  for (const c of s.col) {
    if (c.hp.dead) continue;
    const stand = !c.hp.down, lv = level(c, 'social');
    if ((stand && !up) || (stand === up && lv > bl)) { best = c; bl = lv; up = stand; }
  }
  return best;
}

/** K's trade record (created by the colony tick). */
export function tradeRec(s) {
  if (!s.colony.trade) seedGoodwill(s);
  if (!s.colony.trade) s.colony.trade = { next: s.tick + VISIT.firstD * TICKS_PER_DAY, visits: [], envoy: null, nextEnvoy: -1, paidGutterkin: -1 };
  return s.colony.trade;
}
export const visitById = (s, id) => (s.colony.trade ? s.colony.trade.visits.find((v) => v.id === id) || null : null);
const rint = (s, a, b) => a + (nextU32(s, 'main') % (b - a + 1));
let waterCache = new WeakMap();
const hasWater = (s) => { let v = waterCache.get(s.rt); if (v === undefined) { v = false; for (let i = 0; i < N && !v; i++) if (TER_WATER[s.L.terrain[i]]) v = true; waterCache.set(s.rt, v); } return v; };

const dealsIn = (cats, k) => catChain(categoryOf(k)).some((c) => cats.includes(c));
/** Trader types that may come now. */
export function tradersNow(s) {
  return all('trader').filter((t) => atLeast(s, t.tier) && (!t.river || hasWater(s)) && (tierIndex('hamlet') > s.colony.tier ? t.tier === 'camp' : true));
}
/**
 * A trader's goods: kinds from its `sells` categories, a stack's worth each (fewer of the dear ones). A realm caravan
 * (`src`, caravans.js caravanSources row) also carries its people's and biome's goods: half its kinds (rounded up) come
 * from those when it has them, and a barge brings 1.5x of each.
 */
function stockFor(s, t, src = null) {
  const ok = (d, cats) => d.value > 0 && d.cat !== 'coins' && dealsIn(cats, d.id) && !(d.tags || []).includes('corpse');
  const kinds = all('item').filter((d) => ok(d, t.sells) || (src && ok(d, src.goods)));
  const out = [];
  const n = Math.min(kinds.length, rint(s, VISIT.kinds[0], VISIT.kinds[1]));
  const pool = kinds.slice();
  const fav = src ? pool.filter((d) => ok(d, src.goods)) : [];
  const nFav = Math.min(fav.length, Math.ceil(n / 2));
  for (let j = 0; j < n; j++) {
    let d;
    if (j < nFav) { d = fav.splice(nextU32(s, 'main') % fav.length, 1)[0]; pool.splice(pool.indexOf(d), 1); }
    else { d = pool.splice(nextU32(s, 'main') % pool.length, 1)[0]; }
    const lim = Math.max(1, d.stack | 0);
    let cnt = lim === 1 ? rint(s, 1, 2) : Math.max(1, Math.min(lim, Math.floor(3000 / Math.max(1, d.value)) + rint(s, 0, 10)));
    if (src && src.barge) cnt = Math.floor(cnt * REALM_CARAVAN.barge);
    out.push({ k: d.id, m: null, q: lim === 1 ? 1 : 0, n: cnt });
  }
  return out;
}
/** A caravan arrives now (also for tests and incidents). Returns the visit. `src`: a realm source site (caravanSources row). */
export function arrive(s, traderId, src = null) {
  const t = def('trader', traderId);
  if (!t) return null;
  const rec = tradeRec(s);
  const v = { id: nextId(s, 'visit'), trader: t.id, until: s.tick + VISIT.stayD * TICKS_PER_DAY, stock: stockFor(s, t, src), coins: rint(s, VISIT.coins[0], VISIT.coins[1]) };
  if (src) { v.site = src.site; v.fac = src.fac; v.barge = src.barge === true; if (src.barge) v.coins = Math.floor(v.coins * REALM_CARAVAN.barge); }
  rec.visits.push(v);
  emit(s, 'letter', src ? { letterId: nextId(s, 'letter'), kind: 'trader', visitId: v.id, trader: t.id, site: src.site, civ: src.civ, barge: v.barge }
    : { letterId: nextId(s, 'letter'), kind: 'trader', visitId: v.id, trader: t.id });
  return v;
}

// ---- Realm caravans (W3.3a) ----------------------------------------------------------------------------------
/** The trader types a realm source may send now: the tier's (a barge only from a great river), its role's when it has any. */
export function tradersFrom(s, src) {
  const ts = all('trader').filter((t) => atLeast(s, t.tier) && (!t.river || src.barge) && (tierIndex('hamlet') > s.colony.tier ? t.tier === 'camp' : true));
  const own = ts.filter((t) => t.faction === src.fac);
  return own.length ? own : ts;
}
/** Hourly, in a realm hold: schedule each source site and let the earliest due caravan arrive (one an hour). */
function realmArrivals(s, rec, R) {
  if (!Array.isArray(rec.sites)) rec.sites = [];
  const srcs = caravanSources(s, R), D = TICKS_PER_DAY;
  for (const c of srcs) {
    if (rec.sites.some((r) => r[0] === c.site)) continue;
    rec.sites.push([c.site, s.tick + Math.max(REALM_CARAVAN.first, Math.ceil(c.days)) * D]);
    rec.sites.sort((a, b) => a[0] - b[0]);
  }
  let due = null, row = null;
  for (const c of srcs) {
    const r = rec.sites.find((x) => x[0] === c.site);
    if (!r || s.tick < r[1] || rec.visits.some((v) => v.site === c.site)) continue;
    if (!row || r[1] < row[1]) { due = c; row = r; }
  }
  if (!due) return;
  const ts = tradersFrom(s, due);
  if (!ts.length) { row[1] = s.tick + due.cadence * D; return; }
  arrive(s, ts[nextU32(s, 'main') % ts.length].id, due);
  row[1] = s.tick + due.cadence * D;
}

// ---- Colony goods ------------------------------------------------------------------------------------------
/** Stockpiled, non-forbidden stacks matching { k, m, q } (ids ascending). */
function colonyStacks(s, g) {
  const out = [];
  const a = s.rt.idx.items[g.k];
  if (a) for (const id of a) { const it = s.items[id]; if (!it.f && inStockpile(s, idx(it.x, it.y, it.z | 0)) && (g.m === undefined || g.m === null || it.m === g.m) && (g.q === undefined || g.q === null || it.q === g.q)) out.push(it); }
  return out;
}
const haveN = (s, g) => colonyStacks(s, g).reduce((n, it) => n + it.n, 0);
function takeGoods(s, g, n) {
  let left = n;
  for (const it of colonyStacks(s, g)) { if (left <= 0) break; const b = take(s, it.id, Math.min(left, it.n)); if (b) left -= b.n; }
  return n - left;
}
/** Where traded goods land: the trade post (nearest finished one), else the Hearth. */
function dropSpot(s) {
  for (const b of s.bld) if (b && b.st === 'done' && b.def === 'tradepost') return [b.x + 1, b.y + 3];
  const h = s.colony.hearth, hb = h && h.id !== null ? bldById(s, h.id) : null;
  return hb ? [hb.x + 1, hb.y + 3] : [s.w >> 1, s.h >> 1];
}
export const colonyCoins = (s) => haveN(s, { k: 'coins' });

/** Check a trade (no change): null or the reason, plus the coin totals. */
export function checkTrade(s, c) {
  const v = visitById(s, c.visitId);
  if (!v || s.tick >= v.until) return { why: 'no trader is visiting' };
  const t = def('trader', v.trader), fac = visitFaction(s, v);
  let pay = 0, get = 0;
  for (const g of c.buy || []) {
    const have = v.stock.filter((x) => x.k === g.k && (g.m === undefined || g.m === null || x.m === g.m)).reduce((n, x) => n + x.n, 0);
    if (have < g.n) return { why: `the ${t.name} has only ${have} of that` };
    pay += buyPrice(s, t.id, g.k, g.n, fac);
  }
  for (const g of c.sell || []) {
    if (!dealsIn(t.buys, g.k)) return { why: `the ${t.name} does not buy that` };
    if (haveN(s, g) < g.n) return { why: 'not enough of that in the stockpiles' };
    get += sellPrice(s, t.id, g.k, g.n, fac);
  }
  const payC = Math.ceil(pay / 10), getC = Math.floor(get / 10);
  if (payC > getC && colonyCoins(s) < payC - getC) return { why: 'not enough coins' };
  if (getC > payC && v.coins < getC - payC) return { why: `the ${t.name} cannot pay that much` };
  return { why: null, payC, getC };
}
/** The trade command applier. */
export function tradeCmd(s, c) {
  const chk = checkTrade(s, c);
  if (chk.why) return { ok: false, reason: chk.why };
  const v = visitById(s, c.visitId), t = def('trader', v.trader);
  const [x, y] = dropSpot(s);
  for (const g of c.sell || []) { takeGoods(s, g, g.n); noteTradeOut(s, g.k, g.m ?? null, g.n); /* Z2: a Keep mandate broken */ const st = v.stock.find((e) => e.k === g.k && e.m === (g.m ?? null)); if (st) st.n += g.n; else v.stock.push({ k: g.k, m: g.m ?? null, q: g.q | 0, n: g.n }); }
  for (const g of c.buy || []) {
    let left = g.n;
    for (const e of v.stock) { if (left <= 0) break; if (e.k !== g.k || (g.m !== undefined && g.m !== null && e.m !== g.m)) continue; const n = Math.min(left, e.n); e.n -= n; left -= n; spawn(s, e.k, e.m, e.q | 0, n, x, y); }
    v.stock = v.stock.filter((e) => e.n > 0);
  }
  const net = chk.getC - chk.payC;
  if (net < 0) takeGoods(s, { k: 'coins' }, -net);
  else if (net > 0) spawn(s, 'coins', null, 0, net, x, y);
  v.coins -= net;
  addGoodwill(s, visitFaction(s, v), 1);
  bump(s, 'traded');
  // a bargain worth the name (TRADE_DEED_COINS or more changed hands) is the envoy's deed; a token swap is not
  const envoy = chk.payC + chk.getC >= TRADE_DEED_COINS ? envoyOf(s) : null;
  if (envoy) didDeed(s, envoy, 'trades');
  addChron(s, 'trade', 'chron_trade', { trader: t.name, coins: net });
  return { ok: true, paid: chk.payC, got: chk.getC };
}

// ---- Envoys and the Gutterkin -------------------------------------------------------------------------------
const ENVOY_ASKS = Object.freeze({ league: ['bread', 'ale', 'finepottery', 'meal'], hearthwatch: ['spear', 'bandage', 'meal', 'ingot'] });
function newEnvoy(s) {
  const fs = GOODWILL_IDS.filter((f) => ENVOY_ASKS[f]);
  const f = fs[nextU32(s, 'main') % fs.length];
  const ks = ENVOY_ASKS[f].filter((k) => def('item', k));
  if (!ks.length) return null;
  const k = ks[nextU32(s, 'main') % ks.length];
  const d = def('item', k);
  const n = (d.stack | 0) <= 1 ? rint(s, 2, 5) : rint(s, 10, 30);
  return { faction: f, k, n, until: s.tick + VISIT.envoyD * TICKS_PER_DAY, reward: Math.max(20, Math.floor((d.value * n * 15) / 100)) };
}
/** Pay the Gutterkin off (200 coins): their raids are halved for a season. null or the reason. */
export function payGutterkin(s) {
  if (colonyCoins(s) < VISIT.gutterkinCost) return 'not enough coins';
  takeGoods(s, { k: 'coins' }, VISIT.gutterkinCost);
  tradeRec(s).paidGutterkin = s.tick + DAYS_PER_SEASON * TICKS_PER_DAY;
  addGoodwill(s, 'gutterkin', 10);
  return null;
}
/** Weight percent for Gutterkin raids (H's storyteller): 50 while paid off. */
export const gutterkinRaidPct = (s) => (s.colony.trade && s.colony.trade.paidGutterkin > s.tick ? 50 : 100);

/** Tick system (slot 'colony', every hour): caravans come and go, envoys ask and are answered. */
export function tradeSystem(s) {
  if (s.tick % 600 !== 0) return;
  ensureBound(s);   // W3.3a: a realm hold's roles are bound once (no-op without a realm record)
  const rec = tradeRec(s);
  // departures
  if (rec.visits.length) rec.visits = rec.visits.filter((v) => v.until > s.tick);
  // arrivals: from the realm's towns (W3.3a), else the legacy schedule
  const R = realmRec(s);
  if (R) realmArrivals(s, rec, R);
  else if (s.tick >= rec.next) {
    const ts = tradersNow(s);
    if (ts.length && !rec.visits.length) arrive(s, ts[nextU32(s, 'main') % ts.length].id);
    rec.next = s.tick + (atLeast(s, 'hamlet') ? VISIT.hamletD : VISIT.campD) * TICKS_PER_DAY;
  }
  // envoys (from Hamlet, once a season)
  if (atLeast(s, 'hamlet') && tierIndex('hamlet') >= 0) {
    if (rec.nextEnvoy < 0) rec.nextEnvoy = s.tick + 2 * TICKS_PER_DAY;
    if (!rec.envoy && s.tick >= rec.nextEnvoy) {
      rec.envoy = newEnvoy(s);
      rec.nextEnvoy = s.tick + DAYS_PER_SEASON * TICKS_PER_DAY;
      if (rec.envoy) {
        const fd = def('faction', rec.envoy.faction), id = def('item', rec.envoy.k);
        emit(s, 'letter', { letterId: nextId(s, 'letter'), kind: 'envoy', faction: rec.envoy.faction, k: rec.envoy.k, n: rec.envoy.n });
        addChron(s, 'envoy', 'chron_envoy', { faction: fd ? fd.name : rec.envoy.faction, what: `${rec.envoy.n} ${id ? id.name : rec.envoy.k}` });
      }
    } else if (rec.envoy && s.tick >= rec.envoy.until) {
      const e = rec.envoy;
      rec.envoy = null;
      if (haveN(s, { k: e.k }) >= e.n) {
        takeGoods(s, { k: e.k }, e.n);
        const [x, y] = dropSpot(s);
        if (def('item', 'coins')) spawn(s, 'coins', null, 0, e.reward, x, y);
        addGoodwill(s, e.faction, 10);
        emit(s, 'letter', { letterId: nextId(s, 'letter'), kind: 'envoyMet', faction: e.faction });
      } else {
        addGoodwill(s, e.faction, -5);
        emit(s, 'letter', { letterId: nextId(s, 'letter'), kind: 'envoyFailed', faction: e.faction });
      }
    }
  }
}

export function installTradeCommands() { registerApplier('trade', tradeCmd); }
void forEachItem;
