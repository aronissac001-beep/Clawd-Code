// Territory (Phase 3): the region is split into 10-16 zones, Northgard-style.
// The Hearth's zone starts owned; the realm grows by claiming bordering zones
// for food and gold (rising with every claim). Buildings must stand on owned
// land, and friendly fighters strike harder at home. Some outer zones hold a
// beast lair: a stationary den guarded by wild beasts that must be destroyed
// before the zone can be claimed. Destroying a den pays its loot.
//
// Region state (plain JSON): s.ext.territory = {
//   grid: [zoneId per tile, 0 = none] (N*N ints), claims, ver (bumped on any
//   ownership/lair change), beasts (living wild beasts), webbed: [ids],
//   zones: [{ id, name, cx, cy, tiles, area, forest, rock, owned, lair, lairKind,
//             cleared, adj: [ids], half? }] }   (zones[id - 1] has that id)
// Caches: s.rt.terrCnt (Int32Array scratch for node counts).
import { BUS } from '../hooks.js';
import { ENEMIES } from '../../data/enemies.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { BAL } from '../../data/balance.js';
import { BEASTS, LAIR_DEF, LAIR_KINDS, BEAST_RULES as BR } from '../../data/beasts.js';
import { T, N, idx, inB, ctr, TER_PASSABLE, TER_BUILDABLE } from '../grid.js';
import { emit, spawnEnemy, getE, canAfford, spend, flowRes, markFlowDirty } from './common.js';

// Every tunable territory number.
export const TERRITORY = {
  zonesMin: 10, zonesMax: 16,
  startRadius: 6.5,        // tiles around the Hearth centre that always belong to the start zone
  seedGap: 2.5,            // other zone seeds keep at least this far outside the start disc
  startWeight: 2,          // the start zone grows past its disc this much slower than other zones
  seedSpacing: 7,          // min tiles between zone seeds
  seedsMin: 12, seedsMax: 15,
  minLand: 36,             // zones with fewer passable tiles merge into a neighbour
  minLandTight: 24,        // ... on cramped maps (crag mazes) where 36 leaves too few zones
  attempts: 10,            // zone layouts tried; the first that fits (count, outer lair zones) wins
  claimFood: 30, claimFoodStep: 20,
  claimGold: 15, claimGoldStep: 15,
  halfPrice: 0.5,          // a neighbour holding the start's missing wood/stone opens at half price
  homeDmg: 1.15,           // soldiers, heroes and the Sovereign inside the realm's land
  lairsMin: 2, lairsMax: 4,
  guardsMin: 3, guardsMax: 6,
  lairHpPerStep: 0.08,
  lairLoot: { wood: [50, 80], stone: [30, 50], gold: [35, 60] },
  lootPerStep: 0.12,
  forestEvery: 40,         // ticks between tree/rock recounts per zone
};

const ZONE_A = ['Ash', 'Bram', 'Cinder', 'Dusk', 'Elder', 'Fern', 'Glim', 'Heath', 'Iron', 'Juniper', 'Kestrel', 'Lark', 'Moss', 'Nettle', 'Oak', 'Pike', 'Quill', 'Rook', 'Sedge', 'Thorn', 'Umber', 'Wren', 'Willow', 'Yew'];
const ZONE_B = ['moor', 'fold', 'glen', 'reach', 'mere', 'holt', 'down', 'wold', 'fen', 'brook', 'field', 'combe'];
const VETO = Object.freeze({ ok: false, reason: 'Outside your territory' });

// ---- Queries (fast, allocation-free) ---------------------------------------------------------
export function territoryOf(s) { return (s.ext && s.ext.territory) || null; }
export function zoneById(s, id) { const X = territoryOf(s); return X && id > 0 ? X.zones[id - 1] || null : null; }
export function zoneIdAt(s, tx, ty) { const X = territoryOf(s); return X && inB(tx, ty) ? X.grid[idx(tx, ty)] : 0; }
export function zoneAt(s, tx, ty) { return zoneById(s, zoneIdAt(s, tx, ty)); }
export function ownedTile(s, tx, ty) {
  const X = territoryOf(s);
  if (!X) return true;
  if (!inB(tx, ty)) return false;
  const z = X.grid[idx(tx, ty)];
  return z > 0 && X.zones[z - 1].owned;
}
/** BUS.query.inTerritory: is this world point on the realm's land? (true when the region has no zones) */
export function inTerritory(s, x, y) { return ownedTile(s, Math.floor(x / T), Math.floor(y / T)); }

export function borders(s, z) {
  const X = territoryOf(s);
  for (const a of z.adj) if (X.zones[a - 1].owned) return true;
  return false;
}
export function lairAlive(s, z) { return !!(z.lair && !z.cleared && getE(s, z.lair)); }
/** Price of claiming zone z now. */
export function claimCost(s, z) {
  const X = territoryOf(s), n = X ? X.claims : 0;
  const k = z && z.half ? TERRITORY.halfPrice : 1;
  return {
    food: Math.round((TERRITORY.claimFood + TERRITORY.claimFoodStep * n) * k),
    gold: Math.round((TERRITORY.claimGold + TERRITORY.claimGoldStep * n) * k),
  };
}
/** Why zone z cannot be claimed (ignoring cost), or null. */
export function claimBlock(s, z) {
  if (!z) return 'No land here';
  if (z.owned) return 'Already yours';
  if (!borders(s, z)) return 'Claim a zone that borders it first';
  if (lairAlive(s, z)) return `A ${LAIR_KINDS[z.lairKind] ? LAIR_KINDS[z.lairKind].name : 'beast lair'} holds this land: destroy it first`;
  const rule = BUS.query.claimRule ? BUS.query.claimRule(s, z) : null;
  return rule || null;
}

// ---- Command ------------------------------------------------------------------------------------
function cmdClaim(s, c) {
  const X = territoryOf(s);
  if (!X) return { ok: false, msg: 'This region has no territories.' };
  const z = zoneById(s, c.zone | 0);
  const why = claimBlock(s, z);
  if (why) return { ok: false, msg: why + '.' };
  const cost = claimCost(s, z);
  if (!canAfford(s.res, cost)) return { ok: false, msg: `Claiming ${z.name} needs ${cost.food} food and ${cost.gold} gold.` };
  spend(s, cost);
  z.owned = true; X.claims++; X.ver++;
  revealZone(s, z.id);
  emit(s, { t: 'sfx', k: 'coin', x: ctr(z.cx), y: ctr(z.cy) });
  emit(s, { t: 'zoneClaimed', zone: z.id, x: ctr(z.cx), y: ctr(z.cy) });
  emit(s, { t: 'toast', text: `${z.name} is now part of the realm.`, tone: 'good', icon: 'map' });
  return { ok: true };
}

function revealZone(s, id) {
  const X = territoryOf(s);
  for (let i = 0; i < N * N; i++) if (X.grid[i] === id) s.fog[i] = 1;
  s.rt.fogDirty = true;
}

// ---- Zone generation ----------------------------------------------------------------------------
// Minimal binary heap over (key, value) pairs in parallel arrays.
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

function hearthCentre(s) {
  const h = s.rt.hearth;
  return h ? { x: h.tx + h.size / 2, y: h.ty + h.size / 2 } : { x: N / 2, y: N / 2 };
}

/** Split the map into zones. Pure function of the state's terrain and the given RNG. */
export function buildZones(s, r) {
  const NN = N * N;
  const pass = new Uint8Array(NN);
  for (let i = 0; i < NN; i++) pass[i] = TER_PASSABLE[s.terrain[i]];
  const hc = hearthCentre(s);
  // Land reachable on foot from the Hearth (trees and rock can be cleared, so only terrain blocks).
  const reach = new Uint8Array(NN);
  const st = [idx(Math.floor(hc.x), Math.floor(hc.y))];
  reach[st[0]] = 1;
  while (st.length) {
    const i = st.pop(), x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of D4) {
      const nx = x + dx, ny = y + dy;
      if (!inB(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!reach[j] && pass[j]) { reach[j] = 1; st.push(j); }
    }
  }
  const R0 = TERRITORY.startRadius;
  const dHome = (x, y) => Math.hypot(x + 0.5 - hc.x, y + 0.5 - hc.y);
  let owner = null, best = null, bestScore = -1e9;
  const riftAt = s.objective && s.objective.type === 'rift' && s.objective.tx !== undefined ? idx(s.objective.tx, s.objective.ty) : -1;
  for (let attempt = 0; attempt < TERRITORY.attempts; attempt++) {
    const a6 = attempt % 6;
    const want = r.int(TERRITORY.seedsMin, TERRITORY.seedsMax) + a6 * 2;
    const gap = Math.max(4, TERRITORY.seedSpacing - a6 * 0.7);
    const minLand = attempt < 6 ? TERRITORY.minLand : TERRITORY.minLandTight;
    // 1. Seeds: the start disc plus well-spaced reachable tiles outside it.
    const cands = [];
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = idx(x, y);
      if (reach[i] && dHome(x, y) >= R0 + TERRITORY.seedGap) cands.push(i);
    }
    r.shuffle(cands);
    const seeds = [];
    for (const i of cands) {
      if (seeds.length >= want) break;
      const x = i % N, y = (i / N) | 0;
      let ok = true;
      for (const j of seeds) if (Math.hypot((j % N) - x, ((j / N) | 0) - y) < gap) { ok = false; break; }
      if (ok) seeds.push(i);
    }
    // 2. Weighted geodesic Voronoi over passable land (water and crag split zones).
    owner = new Int16Array(NN);
    const dist = new Float32Array(NN).fill(1e9);
    const w = [0, TERRITORY.startWeight];
    const heap = new Heap();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (dHome(x, y) > R0) continue;
      const i = idx(x, y);
      owner[i] = 1;
      if (reach[i]) { dist[i] = 0; heap.push(0, i); }
    }
    seeds.forEach((i, k) => { owner[i] = k + 2; dist[i] = 0; w.push(r.float(0.8, 1.2)); heap.push(0, i); });
    while (heap.size) {
      const i = heap.pop();
      const x = i % N, y = (i / N) | 0, o = owner[i], d0 = dist[i];
      for (const [dx, dy, c] of D8) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const j = idx(nx, ny);
        if (!reach[j]) continue;
        if (dx && dy && (!reach[idx(x + dx, y)] || !reach[idx(x, y + dy)])) continue;
        const nd = d0 + c * w[o];
        if (nd < dist[j] && !(owner[j] === 1 && dist[j] === 0)) { dist[j] = nd; owner[j] = o; heap.push(nd, j); }
      }
    }
    // 3. Water, crag and sealed pockets join whichever zone reaches them first.
    const q = [];
    for (let i = 0; i < NN; i++) if (owner[i]) q.push(i);
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const j = idx(nx, ny);
        if (!owner[j]) { owner[j] = owner[i]; q.push(j); }
      }
    }
    // 4. Merge slivers, cap the count, and keep every zone's land in one walkable piece.
    for (let round = 0; round < 6; round++) {
      mergeSmall(owner, reach, seeds.length + 1, minLand);
      if (!fixFragments(owner, reach)) break;
    }
    // Score: zone count inside the range first, then enough outer zones (not touching the start
    // zone, not holding the Rift) to host the lairs.
    const { count, outer } = rateLayout(owner, reach, riftAt);
    const inRange = count >= TERRITORY.zonesMin && count <= TERRITORY.zonesMax;
    const score = (inRange ? 1000 : -Math.abs(count - TERRITORY.zonesMin) * 10) + Math.min(outer, TERRITORY.lairsMin) * 100 + count;
    if (score > bestScore) { bestScore = score; best = owner; }
    if (inRange && outer >= TERRITORY.lairsMin) break;
  }
  owner = best;
  // 5. Renumber 1..n (the start zone stays 1) and describe each zone.
  const map = new Map([[1, 1]]);
  const grid = new Array(NN);
  for (let i = 0; i < NN; i++) {
    const o = owner[i];
    if (!map.has(o)) map.set(o, map.size + 1);
    grid[i] = map.get(o);
  }
  const n = map.size;
  const zones = [];
  const sx = new Float64Array(n + 1), sy = new Float64Array(n + 1), land = new Int32Array(n + 1), area = new Int32Array(n + 1);
  for (let i = 0; i < NN; i++) {
    const z = grid[i];
    area[z]++;
    if (reach[i]) { land[z]++; sx[z] += i % N; sy[z] += (i / N) | 0; }
  }
  const adj = Array.from({ length: n + 1 }, () => new Set());
  for (let i = 0; i < NN; i++) {
    if (!reach[i]) continue;
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inB(nx, ny)) continue;
      const j = idx(nx, ny);
      if (reach[j] && grid[j] !== grid[i]) { adj[grid[i]].add(grid[j]); adj[grid[j]].add(grid[i]); }
    }
  }
  const names = new Set();
  for (let z = 1; z <= n; z++) {
    const mx = land[z] ? sx[z] / land[z] : hc.x, my = land[z] ? sy[z] / land[z] : hc.y;
    // Label tile: the zone's own land tile nearest its centre of mass.
    let best = -1, bd = 1e9;
    for (let i = 0; i < NN; i++) {
      if (grid[i] !== z || !reach[i]) continue;
      const d = Math.hypot((i % N) - mx, ((i / N) | 0) - my);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) best = idx(Math.floor(hc.x), Math.floor(hc.y));
    let name = '';
    for (let k = 0; k < 8 && (!name || names.has(name)); k++) name = r.pick(ZONE_A) + r.pick(ZONE_B);
    names.add(name);
    zones.push({
      id: z, name: name.charAt(0).toUpperCase() + name.slice(1), cx: best % N, cy: (best / N) | 0, tiles: land[z], area: area[z],
      forest: 0, rock: 0, owned: z === 1, lair: 0, lairKind: null, cleared: false, adj: [...adj[z]].sort((a, b) => a - b),
    });
  }
  return { grid, zones, reach };
}

// Merge zones below minLand passable tiles into their most-bordering neighbour (start zone last
// resort), then merge the smallest while there are more than zonesMax.
// Zone count and how many zones lie two or more steps from the start zone with room for a den.
function rateLayout(owner, reach, riftAt) {
  const NN = N * N;
  const land = new Map(), adj = new Map();
  const link = (a, b) => { let m = adj.get(a); if (!m) adj.set(a, (m = new Set())); m.add(b); };
  for (let i = 0; i < NN; i++) {
    const o = owner[i];
    if (!land.has(o)) land.set(o, 0);
    if (!reach[i]) continue;
    land.set(o, land.get(o) + 1);
    const x = i % N, y = (i / N) | 0;
    if (x + 1 < N && reach[i + 1] && owner[i + 1] !== o) { link(o, owner[i + 1]); link(owner[i + 1], o); }
    if (y + 1 < N && reach[i + N] && owner[i + N] !== o) { link(o, owner[i + N]); link(owner[i + N], o); }
  }
  const near = adj.get(1) || new Set();
  const rift = riftAt >= 0 ? owner[riftAt] : -1;
  let outer = 0;
  for (const [z, l] of land) if (z !== 1 && z !== rift && !near.has(z) && adj.has(z) && l >= 20) outer++;
  return { count: land.size, outer };
}

function mergeSmall(owner, reach, maxId, minLand = TERRITORY.minLand) {
  const NN = N * N;
  const stats = () => {
    const land = new Map(), shared = new Map();
    for (let i = 0; i < NN; i++) {
      const o = owner[i];
      if (reach[i]) land.set(o, (land.get(o) || 0) + 1);
      else if (!land.has(o)) land.set(o, 0);
      const x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (!inB(x + dx, y + dy)) continue;
        const j = idx(x + dx, y + dy), p = owner[j];
        if (p === o) continue;
        const wgt = reach[i] && reach[j] ? 10 : 1; // land contact counts far more than across water
        for (const [a, b] of [[o, p], [p, o]]) {
          let m = shared.get(a);
          if (!m) shared.set(a, (m = new Map()));
          m.set(b, (m.get(b) || 0) + wgt);
        }
      }
    }
    return { land, shared };
  };
  const into = (from, shared) => {
    const m = shared.get(from);
    if (!m) return 1;
    let best = 0, bv = -1;
    for (const [z, v] of m) { const sc = z === 1 ? v * 0.05 : v; if (sc > bv || (sc === bv && z < best)) { bv = sc; best = z; } }
    return best || 1;
  };
  for (let guard = 0; guard < maxId + 4; guard++) {
    const { land, shared } = stats();
    let victim = 0, vl = 1e9;
    for (const [z, l] of land) if (z !== 1 && l < minLand && (l < vl || (l === vl && z < victim))) { vl = l; victim = z; }
    if (!victim && land.size > TERRITORY.zonesMax) {
      for (const [z, l] of land) if (z !== 1 && (l < vl || (l === vl && z < victim))) { vl = l; victim = z; }
    }
    if (!victim) return;
    const to = into(victim, shared);
    for (let i = 0; i < NN; i++) if (owner[i] === victim) owner[i] = to;
  }
}

// A zone's land split into pieces (diagonal-only links, merges across water): every piece but the
// largest joins the neighbour it touches most on land. Returns true if anything moved.
function fixFragments(owner, reach) {
  const NN = N * N;
  const comp = new Int32Array(NN).fill(-1);
  const size = [], zoneOf = [];
  for (let i = 0; i < NN; i++) {
    if (!reach[i] || comp[i] >= 0) continue;
    const c = size.length, o = owner[i];
    let n = 0;
    const st = [i]; comp[i] = c;
    while (st.length) {
      const k = st.pop(); n++;
      const x = k % N, y = (k / N) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const j = idx(nx, ny);
        if (reach[j] && comp[j] < 0 && owner[j] === o) { comp[j] = c; st.push(j); }
      }
    }
    size.push(n); zoneOf.push(o);
  }
  const main = new Map();
  for (let c = 0; c < size.length; c++) { const m = main.get(zoneOf[c]); if (m === undefined || size[c] > size[m]) main.set(zoneOf[c], c); }
  let moved = false;
  for (let c = 0; c < size.length; c++) {
    if (main.get(zoneOf[c]) === c) continue;
    const touch = new Map();
    for (let i = 0; i < NN; i++) {
      if (comp[i] !== c) continue;
      const x = i % N, y = (i / N) | 0;
      for (const [dx, dy] of D4) {
        const nx = x + dx, ny = y + dy;
        if (!inB(nx, ny)) continue;
        const j = idx(nx, ny);
        if (reach[j] && owner[j] !== zoneOf[c]) touch.set(owner[j], (touch.get(owner[j]) || 0) + 1);
      }
    }
    let to = 0, tv = -1;
    for (const [z, v] of touch) if (v > tv || (v === tv && z < to)) { tv = v; to = z; }
    if (!to) continue; // an island with no land neighbour stays where it is
    for (let i = 0; i < NN; i++) if (comp[i] === c) owner[i] = to;
    moved = true;
  }
  return moved;
}

// ---- Start-zone supplies ------------------------------------------------------------------------
/**
 * What can be built inside zone `zid` without claiming: 2x2 spots, and how many of them can host
 * a Lumber Camp / Quarry (a tree / rock within work range; `fogged` false requires it explored).
 */
export function zoneSupply(s, zid = 1, fogged = true) {
  const X = territoryOf(s);
  const lumberR = levelStats('lumber', 0).radius * T, quarryR = levelStats('quarry', 0).radius * T;
  const trees = s.nodes.filter((n) => n.kind === 'tree' && n.amount > 0 && (fogged || s.fog[idx(n.tx, n.ty)]));
  const rocks = s.nodes.filter((n) => n.kind === 'rock' && n.amount > 0 && (fogged || s.fog[idx(n.tx, n.ty)]));
  const treeSet = new Set(), rockSet = new Set();
  let spots2 = 0, spots1 = 0, lumberSpots = 0, quarrySpots = 0;
  const free = (x, y) => {
    if (!inB(x, y)) return false;
    const i = idx(x, y);
    return X.grid[i] === zid && TER_BUILDABLE[s.terrain[i]] && !s.nodeGrid[i] && !s.occ[i];
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!free(x, y)) continue;
    spots1++;
    if (!free(x + 1, y) || !free(x, y + 1) || !free(x + 1, y + 1)) continue;
    spots2++;
    const cx = (x + 1) * T, cy = (y + 1) * T;
    let lt = false, qr = false;
    for (const n of trees) if (Math.hypot(ctr(n.tx) - cx, ctr(n.ty) - cy) <= lumberR) { lt = true; treeSet.add(n.id); }
    for (const n of rocks) if (Math.hypot(ctr(n.tx) - cx, ctr(n.ty) - cy) <= quarryR) { qr = true; rockSet.add(n.id); }
    if (lt) lumberSpots++;
    if (qr) quarrySpots++;
  }
  return { spots1, spots2, lumberSpots, quarrySpots, trees: treeSet.size, rocks: rockSet.size };
}

// ---- Lairs ---------------------------------------------------------------------------------------
function placeLairs(s, r, X, reach) {
  const zones = X.zones;
  // Zone graph distance from the start zone.
  const gd = new Array(zones.length + 1).fill(99);
  gd[1] = 0;
  const q = [1];
  for (let h = 0; h < q.length; h++) for (const a of zones[q[h] - 1].adj) if (gd[a] > gd[q[h]] + 1) { gd[a] = gd[q[h]] + 1; q.push(a); }
  const hc = hearthCentre(s);
  const o = s.objective;
  const rift = o && o.type === 'rift' && o.tx !== undefined ? { x: o.tx, y: o.ty } : null;
  const spawnAt = new Set(s.spawns.map((p) => idx(p.tx, p.ty)));
  const cacheAt = new Set(s.caches.map((p) => idx(p.tx, p.ty)));
  let cands = [];
  for (const minLand of [40, 20]) {
    cands = [];
    for (const z of zones) {
      if (z.id === 1 || gd[z.id] < 2 || gd[z.id] === 99 || z.tiles < minLand) continue;
      if (z.adj.includes(1)) continue;
      if (rift && X.grid[idx(rift.x, rift.y)] === z.id) continue;
      cands.push({ z, score: gd[z.id] * 6 + Math.hypot(z.cx + 0.5 - hc.x, z.cy + 0.5 - hc.y) * 0.5 + r.float(0, 6) });
    }
    if (cands.length >= TERRITORY.lairsMin) break;
  }
  cands.sort((a, b) => b.score - a.score || a.z.id - b.z.id);
  const want = Math.min(cands.length, r.int(TERRITORY.lairsMin, TERRITORY.lairsMax));
  const step = s.step || 0;
  let placed = 0;
  for (const { z } of cands) {
    if (placed >= want) break;
    // Den tile: open ground in the zone, away from the map edge, spawns, caches and the Rift.
    let best = -1, bs = -1e9;
    for (let i = 0; i < N * N; i++) {
      if (X.grid[i] !== z.id || !reach[i] || s.occ[i] || spawnAt.has(i) || cacheAt.has(i)) continue;
      const x = i % N, y = (i / N) | 0;
      if (x < 3 || y < 3 || x > N - 4 || y > N - 4) continue;
      if (rift && Math.hypot(x - rift.x, y - rift.y) < 5) continue;
      let open = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const j = idx(x + dx, y + dy);
        if (reach[j] && !s.nodeGrid[j] && !s.occ[j]) open += Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? 2 : 1;
      }
      const sc = open - Math.hypot(x - z.cx, y - z.cy) * 0.6 + r.float(0, 1);
      if (sc > bs) { bs = sc; best = i; }
    }
    if (best < 0) continue;
    const tx = best % N, ty = (best / N) | 0;
    clearNodes(s, tx, ty);
    const kinds = Object.values(LAIR_KINDS).filter((k) => !k.minStep || step >= k.minStep);
    const kind = r.weighted(kinds, (k) => k.weight);
    const lair = spawnEnemy(s, 'lair', ctr(tx), ctr(ty), null);
    const hp = Math.round(lair.maxHp * (1 + TERRITORY.lairHpPerStep * step));
    lair.hp = hp; lair.maxHp = hp;
    lair.stationary = true; lair.tx = tx; lair.ty = ty; lair.scale = 1.5;
    lair.lairOf = z.id; lair.lairKind = kind.id;
    const L = TERRITORY.lairLoot, lk = 1 + TERRITORY.lootPerStep * step;
    lair.loot = { wood: Math.round(r.int(L.wood[0], L.wood[1]) * lk), stone: Math.round(r.int(L.stone[0], L.stone[1]) * lk), gold: Math.round(r.int(L.gold[0], L.gold[1]) * lk) };
    z.lair = lair.id; z.lairKind = kind.id;
    const n = Math.max(TERRITORY.guardsMin, Math.min(TERRITORY.guardsMax, TERRITORY.guardsMin + r.int(0, 1) + Math.floor(step / 2)));
    for (let k = 0; k < n; k++) {
      const type = kind.guards[k % kind.guards.length];
      const a = (k / n) * Math.PI * 2 + r.float(-0.3, 0.3), rr = r.float(1.2, 1.9) * T;
      let x = ctr(tx) + Math.cos(a) * rr, y = ctr(ty) + Math.sin(a) * rr;
      const ti = idx(Math.max(0, Math.min(N - 1, Math.floor(x / T))), Math.max(0, Math.min(N - 1, Math.floor(y / T))));
      if (!TER_PASSABLE[s.terrain[ti]] || s.nodeGrid[ti]) { x = ctr(tx) + r.float(-8, 8); y = ctr(ty) + 12 + r.float(-4, 4); }
      spawnBeast(s, type, x, y, lair);
    }
    placed++;
  }
}

function clearNodes(s, tx, ty) {
  let any = false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!inB(tx + dx, ty + dy)) continue;
    const i = idx(tx + dx, ty + dy);
    const id = s.nodeGrid[i];
    if (!id) continue;
    const n = s.rt.nById.get(id);
    if (n) { n.amount = 0; s.rt.nById.delete(id); }
    s.nodeGrid[i] = 0; any = true;
  }
  if (any) { s.nodes = s.nodes.filter((n) => n.amount > 0); markFlowDirty(s); }
}

/** Spawn a wild beast that guards the given lair entity. */
export function spawnBeast(s, type, x, y, lair) {
  const e = spawnEnemy(s, type, x, y, null);
  const night = s.cycle.phase === 'night' || s.cycle.phase === 'dusk';
  // Each beast keeps its own resting spot around the den, so the pack spreads out.
  e.guard = { x, y, r: (night ? BR.guardNight : BR.guardDay) * T };
  e.wild = true; e.lairId = lair.id; e.pack = 0;
  if (type === 'troll') { e.scale = BR.trollScale; e.r = ENEMIES.troll.radius * BR.trollScale; }
  const X = territoryOf(s);
  if (X) X.beasts++;
  return e;
}

// ---- Lifecycle hooks -----------------------------------------------------------------------------
function onRegionInit(s) {
  if (territoryOf(s)) return;
  const r = s.rt.rng.fork('territory');
  const { grid, zones, reach } = buildZones(s, r);
  const X = s.ext.territory = { grid, zones, claims: 0, ver: 1, beasts: 0, webbed: [] };
  refreshCounts(s);
  revealZone(s, 1);
  // The opening build order must work without claiming: if the start zone has no Lumber Camp or
  // Quarry spot, the best bordering zone for that resource opens at half price.
  const sup = zoneSupply(s, 1, false);
  const helpWith = (key) => {
    let best = null;
    for (const a of zones[0].adj) { const z = zones[a - 1]; if (!best || z[key] > best[key]) best = z; }
    if (best && best[key] > 0) { best.half = true; best.halfWhy = key; }
  };
  if (!sup.lumberSpots) helpWith('forest');
  if (!sup.quarrySpots) helpWith('rock');
  placeLairs(s, r, X, reach);
  refreshCounts(s);
  // The lairs put foes on the map before the first tick; SpatialHash starts with head[] = 0 (not
  // -1) until its first clear(), so a hash query before tick 1 (e.g. a Nova) would read garbage.
  // Clearing the region's fresh runtime hashes is harmless (they are rebuilt every tick).
  if (s.rt.enemyHash && s.rt.enemyHash.clear) s.rt.enemyHash.clear();
  if (s.rt.friendHash && s.rt.friendHash.clear) s.rt.friendHash.clear();
}

// Trees and rock per zone (trees are felled and regrow, so recount now and then).
function refreshCounts(s) {
  const X = territoryOf(s);
  const n = X.zones.length + 1;
  let c = s.rt.terrCnt;
  if (!c || c.length < n * 2) c = s.rt.terrCnt = new Int32Array(n * 2);
  c.fill(0);
  for (const nd of s.nodes) {
    if (nd.amount <= 0) continue;
    const z = X.grid[idx(nd.tx, nd.ty)];
    if (z) c[z * 2 + (nd.kind === 'tree' ? 0 : 1)]++;
  }
  for (const z of X.zones) {
    const f = c[z.id * 2], k = c[z.id * 2 + 1];
    if (z.forest !== f) z.forest = f;
    if (z.rock !== k) z.rock = k;
  }
}

// Wild beasts are not part of the night's attack, but the core's night-end check and dawn burn
// count every non-stationary foe. On the tick before the night would end (all Hollow dead after
// nightMin, or nightMax reached) the beasts doze: flagged stationary so the core neither waits for
// them nor burns them at dawn. The flag lives from this BUS.tick to the next cycle update only
// (cleared at the next phase change or the next territory tick), so guard AI never misses a tick
// when dawn comes as predicted.
function wakeBeasts(s, X) {
  if (!X.doze) return;
  X.doze = 0;
  for (const e of s.enemies) if (e.doze) { e.doze = false; e.stationary = false; }
}
function nightEndCheck(s, X, dt) {
  const c = s.cycle;
  if (c.phase !== 'night') return;
  const C = BAL.cycle;
  let beasts = 0;
  if (c.t + dt < C.nightMax * (c.nm || 1)) {
    if (c.t + dt < C.nightMin * (c.nm || 1) || s.spawnQueue.length) return;
    for (const e of s.enemies) {
      if (!e.alive || e.stationary) continue;
      if (!e.wild) return; // Hollow still afoot: the core decides
      beasts++;
    }
  } else for (const e of s.enemies) if (e.alive && e.wild && !e.stationary) beasts++;
  if (!beasts) return;
  for (const e of s.enemies) if (e.alive && e.wild && !e.stationary) { e.stationary = true; e.doze = true; }
  X.doze = 1;
}

function onTick(s, dt) {
  const X = territoryOf(s);
  if (!X) return;
  wakeBeasts(s, X);
  if (X.beasts > 0) nightEndCheck(s, X, dt);
  if (s.tick % TERRITORY.forestEvery === 0) refreshCounts(s);
  // Webbed friendlies lose part of this tick's movement.
  const W = X.webbed;
  if (W.length) {
    for (let k = W.length - 1; k >= 0; k--) {
      const e = getE(s, W[k]);
      if (!e || !(e.webT > s.time)) { if (e) e.webT = 0; W.splice(k, 1); continue; }
      e.x = e.px + (e.x - e.px) * (1 - BR.webSlow);
      e.y = e.py + (e.y - e.py) * (1 - BR.webSlow);
    }
  }
  if (X.beasts <= 0) return;
  const slow = s.tick % 10 === 0;
  for (const e of s.enemies) {
    if (!e.wild || !e.alive || e.doze) continue;
    if (e.type === 'spider') {
      // updateGuard sets atkT = 0.2 on the tick it bites.
      if (e.atkT > 0.199 && e.webTick !== s.tick) {
        e.webTick = s.tick;
        const t = getE(s, e.targetId);
        if (t && t.kind !== 'enemy') {
          if (!(t.webT > s.time)) W.push(t.id);
          t.webT = s.time + BR.webTime;
        }
      }
    } else if (!slow) continue;
    else if (e.type === 'troll') { if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + BR.trollRegen * dt * 10); }
    else if (e.type === 'direwolf') { packSelf = e; packN = 0; s.rt.enemyHash.each(e.x, e.y, BR.packRange * T, countPack); e.pack = Math.min(BR.packMax, packN); }
  }
}
let packSelf = null, packN = 0;
function countPack(o) { if (o !== packSelf && o.type === 'direwolf') packN++; return false; }

function onPhase(s, phase) {
  const X = territoryOf(s);
  if (!X) return;
  wakeBeasts(s, X);
  if (X.beasts <= 0) return;
  const r = (phase === 'night' || phase === 'dusk' ? BR.guardNight : BR.guardDay) * T;
  for (const e of s.enemies) {
    if (!e.wild) continue;
    // Wild beasts are not Hollow: the sunrise must not burn them (core versions that burn every
    // non-stationary foe at dawn mark them dead without a kill; bring those back).
    if (phase === 'dawn' && !e.alive && e.hp > 0) { e.alive = true; s.rt.eById.set(e.id, e); }
    if (e.guard) e.guard.r = r;
  }
}

function onKill(s, v) {
  const X = territoryOf(s);
  if (!X || v.kind !== 'enemy') return;
  if (v.wild) { X.beasts = Math.max(0, X.beasts - 1); return; }
  if (v.type !== 'lair' || !v.lairOf) return;
  const z = zoneById(s, v.lairOf);
  if (z) z.cleared = true;
  X.ver++;
  const parts = [];
  for (const k in v.loot || {}) {
    const a = v.loot[k];
    if (typeof a !== 'number' || a <= 0 || !(k in s.res)) continue;
    flowRes(s, k, a);
    parts.push(`+${a} ${k}`);
  }
  const name = LAIR_KINDS[v.lairKind] ? LAIR_KINDS[v.lairKind].name : 'Beast Lair';
  emit(s, { t: 'sfx', k: 'coin', x: v.x, y: v.y });
  emit(s, { t: 'lairCleared', zone: v.lairOf, x: v.x, y: v.y });
  emit(s, { t: 'toast', text: `${name} destroyed${parts.length ? ': ' + parts.join(', ') : ''}. ${z ? z.name + ' can now be claimed.' : ''}`, tone: 'good', icon: 'gold' });
}

// ---- Rules on the bus ------------------------------------------------------------------------------
function vetoPlace(s, type, tx, ty) {
  const X = territoryOf(s);
  if (!X) return null;
  const def = BUILDINGS[type];
  const size = def ? def.size : 1;
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
    if (!inB(x, y)) continue; // the core reports "Outside the region"
    const z = X.grid[idx(x, y)];
    if (!z || !X.zones[z - 1].owned) return VETO;
  }
  return null;
}

function dmgMult(s, a, t) {
  const X = territoryOf(s);
  if (!X) return 1;
  let m = 1;
  if (a) {
    const k = a.kind;
    if (k === 'soldier' || k === 'hero' || k === 'sovereign') {
      const tx = Math.floor(a.x / T), ty = Math.floor(a.y / T);
      if (inB(tx, ty)) { const z = X.grid[idx(tx, ty)]; if (z && X.zones[z - 1].owned) m *= TERRITORY.homeDmg; }
    } else if (k === 'enemy' && a.pack > 0 && a.type === 'direwolf') m *= 1 + BR.packBonus * a.pack;
  }
  // Light pins the Hollow, not wild beasts: cancel the core's light bonus for them.
  if (t.wild) {
    const tx = Math.floor(t.x / T), ty = Math.floor(t.y / T);
    if (inB(tx, ty) && s.lit[idx(tx, ty)]) m /= 1 + BAL.combat.lightBonus;
  }
  return m;
}

// ---- Registration -------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  for (const [id, def] of Object.entries(BEASTS)) ENEMIES[id] = { ...def };
  ENEMIES.lair = { ...LAIR_DEF };
  BUS.regionInit.push(onRegionInit);
  BUS.tick.push(onTick);
  BUS.phase.push(onPhase);
  BUS.kill.push(onKill);
  BUS.canPlace.push(vetoPlace);
  BUS.dmgMult.push(dmgMult);
  BUS.commands.claimZone = cmdClaim;
  BUS.query.inTerritory = inTerritory;
}
