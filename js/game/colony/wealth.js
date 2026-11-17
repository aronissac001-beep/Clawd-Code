// Colony wealth (doc 8.4, 9.2). Owner K. Provisional API.
//
// Wealth in COINS (item values in js/data/items.js are tenths of a coin per unit):
//   items  = sum over live stacks of value x n x material value% x quality value% (q > 0 only)
//   bld    = sum over finished buildings of their materials' worth (cost / costByMat)
//   total  = items + bld                       (tiers, the HUD)
//   threat = total with walls, floors and defences at THREAT.wallWealthPct (9.2; H's raidplan reads it)
// s.rt.wealth (C13 class 'derived', owner K) = { total, items, bld, threat }.
// Stage 0 stand-in for the incremental rule: the 'colony' tick system recomputes it every tick
// (O(stacks + buildings); both are empty in Stage 0), so the live value always equals the
// registered rebuild. Stage 1a goes incremental once E's item API gains a change hook (a C6
// addition requested from E) and B's building API reports placements (BUS.built / removed).
// Sim decisions (threat points, tiers) call computeWealth(s) or read rt.wealth; both are exact.

import { registerRebuild } from '../core/rtcontract.js';
import { def, all, bal } from './defs.js';

const valueCache = new Map(); // structure def id + mat -> tenths of a coin (code cache, not state)
export function resetWealthCache() { valueCache.clear(); }

const matPct = (m) => { const d = def('material', m); return d ? d.value : 100; };
const qualPct = (q) => { if (!q) return 100; const l = all('quality'); return l[q] ? l[q].value : 100; };
/** Item kind for a cost key 'item' or 'item:material', with the material's value percent. */
function costValue(key, n) {
  const [k, m] = key.split(':');
  const d = def('item', k);
  return d ? Math.floor((d.value * n * (m ? matPct(m) : 100)) / 100) : 0;
}

/** Tenths of a coin for one stack. */
export function stackValue(it) {
  const d = def('item', it.k);
  if (!d) return 0;
  return Math.floor((((d.value * it.n * matPct(it.m)) / 100) * qualPct(it.q)) / 100);
}
/** Tenths of a coin for one finished building (its materials' worth). */
export function buildingValue(b) {
  const key = b.def + ':' + (b.mat || '');
  if (valueCache.has(key)) return valueCache.get(key);
  const d = def('structure', b.def);
  let v = 0;
  if (d && d.cost) for (const k of Object.keys(d.cost).sort()) v += costValue(k, d.cost[k]);
  if (d && d.costByMat && d.costByMat.length) {
    const c = d.costByMat[0];
    const it = all('item').find((x) => x.cat === c.cat);
    if (it) v += Math.floor((it.value * c.n * (b.mat ? matPct(b.mat) : 100)) / 100);
  }
  valueCache.set(key, v);
  return v;
}
/** Walls, floors and defences count at the wall rate for threat points (9.2). */
export function wallLike(b) {
  const d = def('structure', b.def);
  if (!d) return false;
  const f = d.flags || [];
  return d.cat === 'defence' || f.includes('wall') || f.includes('floor') || f.includes('door');
}

/** Full recompute from saved state: { total, items, bld, threat } in coins. */
export function computeWealth(s) {
  let items = 0, bld = 0, walls = 0;
  for (const it of s.items) if (it) items += stackValue(it);
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const v = buildingValue(b);
    bld += v;
    if (wallLike(b)) walls += v;
  }
  const pct = bal('threat').wallWealthPct === undefined ? 50 : bal('threat').wallWealthPct;
  const total = Math.floor((items + bld) / 10);
  const threat = Math.floor((items + bld - Math.floor((walls * (100 - pct)) / 100)) / 10);
  return { total, items: Math.floor(items / 10), bld: Math.floor(bld / 10), threat };
}

/** Tick system (slot 'colony'): keep rt.wealth exact (Stage 0 full recompute; see header). */
export function wealthSystem(s) { s.rt.wealth = computeWealth(s); }

/** Register the C13 rebuild for rt.wealth (installColony calls it). */
export function installWealthRebuild() { registerRebuild('wealth', computeWealth); }
