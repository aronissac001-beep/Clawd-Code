// Colony wealth (doc 6.7, 8.4, 9.2). Owner K. Provisional API.
//
// Wealth in COINS (item values in js/data/items.js are tenths of a coin per unit):
//   items  = sum over live stacks of value x n x material value% x quality value%       (tenths)
//   bld    = sum over finished buildings of their materials' worth (cost / costByMat)    (tenths)
//   pop    = WEALTH.coinsPer10Levels per 10 skill levels of each colonist (6.7)         (coins)
//   total  = (items + bld x WEALTH.bldPct%) / 10 + pop                                    (tiers, the HUD)
//   threat = total with walls, floors, doors and defences at THREAT.wallWealthPct (9.2; H's raidplan)
// s.rt.wealth (C13 class 'derived', owner K) = { total, items, bld, pop, threat } in coins.
//
// Incremental (C13): the 'colony' tick system (last in the tick) keeps per-slot memos of every
// stack, building and colonist it has counted, compares each slot with a few reference and integer
// checks (no value maths for unchanged slots) and applies only the deltas of the slots that
// changed. A deterministic full recompute replaces the memo every WEALTH.recomputeEvery ticks
// (14,400: once a game day), at load (the memo lives outside the state, keyed by s.rt, so a loaded
// state starts with none) and whenever content is swapped (resetWealthCache). The memo is a code
// cache, not state: the values are a pure function of saved state either way, so live equals
// computeWealth(s) after every tick (gate check (e)). When E's item API grows a change hook (a C6
// addition), noteStack can replace the stack scan without changing any result.
// Sim decisions (threat points, tiers) call computeWealth(s) or read rt.wealth; both are exact.

import { registerRebuild } from '../core/rtcontract.js';
import { def, all, bal } from './defs.js';

const valueCache = new Map(); // structure def id + mat -> tenths of a coin (code cache, not state)
let memos = new WeakMap();    // s.rt -> Memo (code cache, not state)
/** Forget every cached value and memo (content swapped in tests). */
export function resetWealthCache() { valueCache.clear(); memos = new WeakMap(); }

const W = () => { const w = bal('wealth'); return { bldPct: w.bldPct ?? 50, coinsPer10Levels: w.coinsPer10Levels ?? 50, recomputeEvery: w.recomputeEvery || 14400 }; };
const wallPct = () => (bal('threat').wallWealthPct === undefined ? 50 : bal('threat').wallWealthPct);

const matPct = (m) => { const d = m ? def('material', m) : null; return d ? d.value : 100; };
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
/** Tenths of a coin for one finished building (its materials' worth; furniture: its item's worth). */
export function buildingValue(b) {
  const key = b.def + ':' + (b.mat || '') + ':' + (b.q | 0);
  if (valueCache.has(key)) return valueCache.get(key);
  const d = def('structure', b.def);
  let v = 0;
  if (d && d.cost) for (const k of Object.keys(d.cost).sort()) v += costValue(k, d.cost[k]);
  if (d && d.costByMat && d.costByMat.length) {
    // the costByMat entry matching the material's group (wood walls cost wood, stone walls blocks)
    const g = b.mat && def('material', b.mat) ? def('material', b.mat).group : null;
    const items = all('item');
    const pick = d.costByMat.find((c) => { const it = items.find((x) => x.cat === c.cat); return it && g && [].concat(it.mat || []).includes(g); }) || d.costByMat[0];
    const it = items.find((x) => x.cat === pick.cat);
    if (it) v += Math.floor((it.value * pick.n * (b.mat ? matPct(b.mat) : 100)) / 100);
  }
  if (d && d.kind === 'furniture') {
    const it = def('item', d.item || d.id);
    if (it) v += Math.floor((((it.value * (b.mat ? matPct(b.mat) : 100)) / 100) * qualPct(b.q)) / 100);
  }
  valueCache.set(key, v);
  return v;
}
/** Walls, floors, doors and defences count at the wall rate for threat points (9.2). */
export function wallLike(b) {
  const d = def('structure', b.def);
  if (!d) return false;
  const f = d.flags || [];
  return d.cat === 'defence' || f.includes('wall') || f.includes('floor') || f.includes('door');
}
/** Sum of a colonist's 15 skill levels. */
export function levelSum(c) { let n = 0; for (const x of c.sk) n += x[0]; return n; }
const colWorth = (c, per10) => (c.hp && c.hp.dead ? 0 : Math.floor((levelSum(c) * per10) / 10));

/** The coin totals from the four tenths/coin sums (shared by the full and the incremental path). */
function finish(items, bld, walls, pop) {
  const w = W(), wp = wallPct();
  const bldCounted = Math.floor((bld * w.bldPct) / 100), wallsCounted = Math.floor((walls * w.bldPct) / 100);
  const total = Math.floor((items + bldCounted) / 10) + pop;
  const threat = Math.floor((items + bldCounted - Math.floor((wallsCounted * (100 - wp)) / 100)) / 10) + pop;
  return { total, items: Math.floor(items / 10), bld: Math.floor(bldCounted / 10), pop, threat };
}

/** Full recompute from saved state: { total, items, bld, pop, threat } in coins. */
export function computeWealth(s) {
  let items = 0, bld = 0, walls = 0, pop = 0;
  const per10 = W().coinsPer10Levels;
  for (const it of s.items) if (it) items += stackValue(it);
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const v = buildingValue(b);
    bld += v;
    if (wallLike(b)) walls += v;
  }
  for (const c of s.col) pop += colWorth(c, per10);
  return finish(items, bld, walls, pop);
}

// ---- The incremental path ------------------------------------------------------------------------
/**
 * Memo = per-slot snapshots of what was counted (typed arrays grown by doubling, never read past
 * their length, so the scan stays a tight loop):
 *   iRef[i], iN[i], iQ[i], iV[i]   the stack object in s.items[i], its n and q, and its value
 *   bRef[i], bSt[i], bDef[i], bMat[i], bQ[i], bV[i], bWall[i]   the same for s.bld[i] (bV 0 unless done)
 *   items, bld, walls              running sums (tenths); pop is recomputed (<= 40 x 15 adds)
 */
function newMemo() {
  return { ni: 0, nb: 0, iRef: [], iN: new Int32Array(0), iQ: new Int8Array(0), iV: new Int32Array(0),
    bRef: [], bSt: [], bDef: [], bMat: [], bQ: new Int8Array(0), bV: new Int32Array(0), bWall: new Int32Array(0), items: 0, bld: 0, walls: 0 };
}
const grownI32 = (a, n) => { const b = new Int32Array(n); b.set(a); return b; };
const grownI8 = (a, n) => { const b = new Int8Array(n); b.set(a); return b; };
function growItems(m, n) {
  if (n <= m.iN.length) { while (m.ni < n) { m.iRef.push(null); m.ni++; } return; }
  const cap = Math.max(64, n, m.iN.length * 2);
  m.iN = grownI32(m.iN, cap); m.iQ = grownI8(m.iQ, cap); m.iV = grownI32(m.iV, cap);
  while (m.ni < n) { m.iRef.push(null); m.ni++; }
}
function growBld(m, n) {
  if (n > m.bV.length) { const cap = Math.max(64, n, m.bV.length * 2); m.bQ = grownI8(m.bQ, cap); m.bV = grownI32(m.bV, cap); m.bWall = grownI32(m.bWall, cap); }
  while (m.nb < n) { m.bRef.push(null); m.bSt.push(null); m.bDef.push(null); m.bMat.push(null); m.nb++; }
}
function memoFromScratch(s) {
  const m = newMemo();
  growItems(m, s.items.length); growBld(m, s.bld.length);
  for (let i = 0; i < s.items.length; i++) setStackSlot(m, i, s.items[i]);
  for (let i = 0; i < s.bld.length; i++) setBldSlot(m, i, s.bld[i]);
  return m;
}
function setStackSlot(m, i, it) {
  const v = it ? stackValue(it) : 0;
  m.items += v - m.iV[i];
  m.iRef[i] = it || null; m.iN[i] = it ? it.n : 0; m.iQ[i] = it ? it.q : 0; m.iV[i] = v;
}
function setBldSlot(m, i, b) {
  const v = b && b.st === 'done' ? buildingValue(b) : 0;
  const wl = v && wallLike(b) ? v : 0;
  m.bld += v - m.bV[i];
  m.walls += wl - m.bWall[i];
  m.bRef[i] = b || null; m.bSt[i] = b ? b.st : null; m.bDef[i] = b ? b.def : null; m.bMat[i] = b ? b.mat : null; m.bQ[i] = b ? b.q : 0;
  m.bV[i] = v; m.bWall[i] = wl;
}

/** Bring the memo of state s up to date (only changed slots are revalued). Returns it. */
export function updateWealthMemo(s) {
  let m = memos.get(s.rt);
  if (!m) { m = memoFromScratch(s); memos.set(s.rt, m); return m; }
  const items = s.items, ni = items.length;
  if (ni > m.ni) growItems(m, ni);
  const iRef = m.iRef, iN = m.iN, iQ = m.iQ;
  for (let i = 0; i < ni; i++) {
    const it = items[i];
    if (it !== iRef[i] || (it !== null && (it.n !== iN[i] || it.q !== iQ[i]))) setStackSlot(m, i, it);
  }
  for (let i = ni; i < m.ni; i++) if (iRef[i] !== null) setStackSlot(m, i, null);
  const bl = s.bld, nb = bl.length;
  if (nb > m.nb) growBld(m, nb);
  const bRef = m.bRef, bSt = m.bSt, bMat = m.bMat, bQ = m.bQ;
  for (let i = 0; i < nb; i++) {
    const b = bl[i];
    // a building keeps its def for life (a new def is a new building object); st, mat and q may change in place
    if (b !== bRef[i] || (b !== null && (b.st !== bSt[i] || b.mat !== bMat[i] || b.q !== bQ[i]))) setBldSlot(m, i, b);
  }
  for (let i = nb; i < m.nb; i++) if (bRef[i] !== null) setBldSlot(m, i, null);
  return m;
}
/** Mark one stack slot as changed now (for an item-API change hook; optional, results are identical). */
export function noteStack(s, id) { const m = memos.get(s.rt); if (m && id >= 0) { if (id >= m.ni) growItems(m, id + 1); setStackSlot(m, id, s.items[id] || null); } }

/** The live wealth from the memo (same shape and values as computeWealth). */
export function liveWealth(s) {
  const m = updateWealthMemo(s);
  const per10 = W().coinsPer10Levels;
  let pop = 0;
  for (const c of s.col) pop += colWorth(c, per10);
  return finish(m.items, m.bld, m.walls, pop);
}

/** Tick system (slot 'colony', last): keep rt.wealth exact; a full recompute once a game day. */
export function wealthSystem(s) {
  if (s.tick % W().recomputeEvery === 0) memos.delete(s.rt);
  s.rt.wealth = liveWealth(s);
}

/** The HUD value (coins), as last computed by the tick. */
export const wealthOf = (s) => (s.rt.wealth && s.rt.wealth.total) || 0;

/** Register the C13 rebuild for rt.wealth (installColony calls it). */
export function installWealthRebuild() { registerRebuild('wealth', computeWealth); }
