// Hidden adjacency combos (Phase 3). Arrangements of finished buildings and
// terrain listed in js/data/combos.js transform into something better (or
// worse) while they stand.
//
// Region state (plain JSON): s.ext.combos = {
//   active: [{ id, ids: [buildingIds], cx, cy, key, tx?, ty? }],   cx/cy in world units; tx/ty = grove top-left tile
//   found:  [comboIds discovered in this region],
//   rec:    { [buildingId]: { r, d, l, c, h, m } }   exactly what this module added to that building
//                                                   (bonusRange, bonusDmg, bonusLight, bonusChain, max-health add, resulting maxHp)
//   morale: number                                   what this module added to mood(s).baseMorale
//   flags:  { heroXp?: 1.5 }                         read-only for other modules (see FLAGS below)
//   nodes:  number                                   resource-node signature (count and id sum) at the last recompute (boulder/tree changes)
// }
// Cache (not saved; derived purely from the saved state when missing, so a load changes nothing): s.rt.combo = { ver, nodes, farm: Map, gather: Map, market: [], ... }.
//
// Every recompute starts from scratch and applies only the difference from the
// recorded contribution, so effects never stack twice and never disturb bonuses
// other modules add to the same fields (the Runeforge does the same).
//
// FLAGS (s.ext.combos.flags), for other modules to read:
//   heroXp: multiplier for hero experience gain while an Adventurers' Quarter stands (absent = 1).
import { BUS } from '../hooks.js';
import { BUILDINGS } from '../../data/buildings.js';
import { COMBOS, COMBO_ORDER, COMBO_TUNE } from '../../data/combos.js';
import { T, N, idx, inB } from '../grid.js';
import { emit, getB, mood, moodAdd, flowRes, markLightDirty } from './common.js';
import { revealAround } from './fog.js';

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const BASE_MORALE_DEFAULT = 50;

// ---- State -----------------------------------------------------------------------------------------
/** The region's combo state (created on first use). */
export function comboState(s) {
  const X = s.ext.combos || (s.ext.combos = { active: [], found: [], rec: {}, morale: 0, flags: {} });
  if (!X.active) X.active = [];
  if (!X.found) X.found = [];
  if (!X.rec) X.rec = {};
  if (typeof X.morale !== 'number') X.morale = 0;
  if (!X.flags) X.flags = {};
  return X;
}
/** Is at least one instance of this combo standing? */
export function comboActive(s, id) {
  const X = s.ext.combos;
  if (!X) return false;
  for (const a of X.active) if (a.id === id) return true;
  return false;
}
/** Active combos a building belongs to (for cards and art). */
export function combosOf(s, b) {
  const X = s.ext.combos;
  const out = [];
  if (!X || !b) return out;
  for (const a of X.active) if (a.ids.includes(b.id)) out.push(a);
  return out;
}
/** A combo flag (see FLAGS above), or `dflt`. */
export function comboFlag(s, name, dflt = 1) {
  const X = s.ext.combos;
  const v = X && X.flags ? X.flags[name] : undefined;
  return typeof v === 'number' ? v : dflt;
}

// ---- Geometry helpers --------------------------------------------------------------------------------
const cxOf = (b) => (b.tx + b.size / 2) * T;
const cyOf = (b) => (b.ty + b.size / 2) * T;
const isUp = (b) => !!(b && b.alive && b.built);

/** Calls fn(tx, ty) for every tile sharing an edge with the building's footprint. */
function perimeter(b, fn) {
  const x0 = b.tx, y0 = b.ty, n = b.size;
  for (let x = x0; x < x0 + n; x++) { fn(x, y0 - 1); fn(x, y0 + n); }
  for (let y = y0; y < y0 + n; y++) { fn(x0 - 1, y); fn(x0 + n, y); }
}
function bAt(s, x, y) {
  if (!inB(x, y)) return null;
  const id = s.occ[idx(x, y)];
  return id ? getB(s, id) : null;
}
/** Distinct finished buildings of the given types touching b (edge contact), sorted by id. */
function touching(s, b, types) {
  const out = [];
  perimeter(b, (x, y) => {
    const o = bAt(s, x, y);
    if (o && o !== b && isUp(o) && types.includes(o.type) && !out.includes(o.id)) out.push(o.id);
  });
  return out.sort((a, c) => a - c);
}
function defined(type) { return !!BUILDINGS[type]; }

// ---- Pattern tests -----------------------------------------------------------------------------------
// Each returns a list of { ids, anchor, members } (members = building ids that receive per-building bonuses
// are chosen later by effect.on).
function testTouch(s, t) {
  const out = [];
  if (!defined(t.anchor)) return out;
  for (const b of s.buildings) {
    if (b.type !== t.anchor || !isUp(b)) continue;
    const others = touching(s, b, t.other);
    if (others.length >= t.min) out.push({ anchor: b.id, others });
  }
  return out;
}
function testTerrain(s, t) {
  const out = [];
  if (!defined(t.anchor)) return out;
  for (const b of s.buildings) {
    if (b.type !== t.anchor || !isUp(b)) continue;
    let n = 0;
    perimeter(b, (x, y) => { if (inB(x, y) && s.terrain[idx(x, y)] === t.terrain) n++; });
    if (n >= t.min) out.push({ anchor: b.id, others: [] });
  }
  return out;
}
function testNode(s, t) {
  const out = [];
  if (!defined(t.anchor)) return out;
  for (const b of s.buildings) {
    if (b.type !== t.anchor || !isUp(b)) continue;
    const seen = [];
    perimeter(b, (x, y) => {
      if (!inB(x, y)) return;
      const nid = s.nodeGrid[idx(x, y)];
      if (!nid || seen.includes(nid)) return;
      const n = s.rt.nById.get(nid);
      if (n && n.kind === t.node && n.amount > 0) seen.push(nid);
    });
    if (seen.length >= t.min) out.push({ anchor: b.id, others: [] });
  }
  return out;
}
function testSides(s, t) {
  const out = [];
  if (!defined(t.anchor)) return out;
  for (const b of s.buildings) {
    if (b.type !== t.anchor || !isUp(b)) continue;
    const n = b.size, ids = [];
    let sides = 0;
    const side = (tiles) => {
      const here = [];
      for (const [x, y] of tiles) {
        const o = bAt(s, x, y);
        if (!o || !isUp(o) || !t.other.includes(o.type)) return;
        if (!here.includes(o.id)) here.push(o.id);
      }
      sides++;
      for (const id of here) if (!ids.includes(id)) ids.push(id);
    };
    const top = [], bot = [], lef = [], rig = [];
    for (let k = 0; k < n; k++) {
      top.push([b.tx + k, b.ty - 1]); bot.push([b.tx + k, b.ty + n]);
      lef.push([b.tx - 1, b.ty + k]); rig.push([b.tx + n, b.ty + k]);
    }
    side(top); side(bot); side(lef); side(rig);
    if (sides >= t.min) out.push({ anchor: b.id, others: ids.sort((a, c) => a - c) });
  }
  return out;
}
function testCluster(s, t) {
  const out = [];
  if (!defined(t.type)) return out;
  const seen = new Set();
  for (const b of s.buildings) {
    if (b.type !== t.type || !isUp(b) || seen.has(b.id)) continue;
    const comp = [b.id];
    seen.add(b.id);
    for (let i = 0; i < comp.length; i++) {
      const cur = getB(s, comp[i]);
      for (const id of touching(s, cur, [t.type])) if (!seen.has(id)) { seen.add(id); comp.push(id); }
    }
    if (comp.length >= t.min) {
      comp.sort((a, c) => a - c);
      out.push({ anchor: comp[0], others: comp.slice(1) });
    }
  }
  return out;
}
function testLine(s, t) {
  const out = [];
  if (!defined(t.type)) return out;
  const list = s.buildings.filter((b) => b.type === t.type && isUp(b));
  if (list.length < t.min) return out;
  // Rows (same ty, walk along tx), then columns (same tx, walk along ty).
  for (const [lane, along] of [['ty', 'tx'], ['tx', 'ty']]) {
    const groups = new Map();
    for (const b of list) {
      const k = b[lane];
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(b);
    }
    const keys = [...groups.keys()].sort((a, c) => a - c);
    for (const k of keys) {
      const g = groups.get(k).sort((a, c) => a[along] - c[along] || a.id - c.id);
      let run = [g[0]];
      const flush = () => {
        if (run.length >= t.min) {
          const ids = run.map((b) => b.id).sort((a, c) => a - c);
          out.push({ anchor: ids[0], others: ids.slice(1) });
        }
      };
      for (let i = 1; i < g.length; i++) {
        const gap = g[i][along] - (g[i - 1][along] + g[i - 1].size - 1);
        if (gap >= 1 && gap <= t.gap) run.push(g[i]);
        else { flush(); run = [g[i]]; }
      }
      flush();
    }
  }
  return out;
}

// Fey Grove: size x size tree tiles, every tree untouched (amount at max), every tile inside the territory.
function groveOk(s, tx, ty, size) {
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
    if (!inB(x, y)) return false;
    const nid = s.nodeGrid[idx(x, y)];
    if (!nid) return false;
    const n = s.rt.nById.get(nid);
    if (!n || n.kind !== 'tree' || n.amount < (n.max || n.amount)) return false;
    if (!BUS.query.inTerritory(s, (x + 0.5) * T, (y + 0.5) * T)) return false;
  }
  return true;
}
function scanGroves(s, size, keep) {
  const used = new Uint8Array(N * N);
  const out = [];
  const mark = (tx, ty) => { for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) used[idx(x, y)] = 1; };
  for (const g of keep) { mark(g.tx, g.ty); out.push(g); }
  for (let ty = 0; ty <= N - size && out.length < COMBO_TUNE.maxGroves; ty++) {
    for (let tx = 0; tx <= N - size && out.length < COMBO_TUNE.maxGroves; tx++) {
      let free = true;
      for (let y = ty; y < ty + size && free; y++) for (let x = tx; x < tx + size; x++) if (used[idx(x, y)]) { free = false; break; }
      if (!free || !groveOk(s, tx, ty, size)) continue;
      mark(tx, ty);
      out.push({ tx, ty });
    }
  }
  return out;
}

const TESTS = { touch: testTouch, touchTerrain: testTerrain, touchNode: testNode, sides: testSides, cluster: testCluster, line: testLine };

// ---- Recompute -----------------------------------------------------------------------------------------
/**
 * Re-evaluate every combo from scratch and apply only the difference.
 * `scan` = also look for new Fey Groves (dawn); otherwise standing groves are only re-validated.
 */
export function recomputeCombos(s, scan = false) {
  const X = comboState(s);
  const prevKeys = new Set(X.active.map((a) => a.key));
  const next = [];
  for (const id of COMBO_ORDER) {
    const def = COMBOS[id];
    const t = def.test;
    if (t.kind === 'grove') {
      const keep = X.active.filter((a) => a.id === id && groveOk(s, a.tx, a.ty, t.size)).map((a) => ({ tx: a.tx, ty: a.ty }));
      const groves = scan ? scanGroves(s, t.size, keep) : keep;
      for (const g of groves) {
        next.push({ id, ids: [], cx: (g.tx + t.size / 2) * T, cy: (g.ty + t.size / 2) * T, key: `${id}:${g.tx},${g.ty}`, tx: g.tx, ty: g.ty });
      }
      continue;
    }
    const fn = TESTS[t.kind];
    if (!fn) continue;
    for (const m of fn(s, t)) {
      const ids = [m.anchor, ...m.others];
      let sx = 0, sy = 0;
      for (const bid of ids) { const b = getB(s, bid); sx += cxOf(b); sy += cyOf(b); }
      next.push({ id, ids, cx: Math.round(sx / ids.length), cy: Math.round(sy / ids.length), key: `${id}:${ids.join(',')}` });
    }
  }
  X.active = next;
  applyEffects(s, X);
  // Announce combos that are new to this region.
  for (const a of next) {
    if (prevKeys.has(a.key) || X.found.includes(a.id)) continue;
    X.found.push(a.id);
    const def = COMBOS[a.id];
    emit(s, { t: 'combo', id: a.id, name: def.name, x: a.cx, y: a.cy, good: def.good });
    emit(s, { t: 'toast', text: `${def.name}: ${def.text}`, tone: def.good ? 'good' : 'bad', icon: def.icon });
    if (def.effect.reveal) { const b = getB(s, a.ids[0]); if (b) revealAround(s, cxOf(b), cyOf(b), def.effect.reveal); }
  }
  return next;
}

/**
 * Pure: fold the active list into the runtime cache (fx), the wanted per-building bonuses and the flags.
 * Never touches state, so it can rebuild the cache after a load without changing anything.
 */
function derive(s, X) {
  const want = new Map();          // buildingId -> { r, d, l, c, h }
  const doneFor = new Set();       // `${comboId}:${buildingId}`: one bonus per combo per building
  const globalIds = new Set();
  const fx = {
    ver: ++verSeq, nodes: typeof X.nodes === 'number' ? X.nodes : nodeSig(s),
    farm: new Map(), gather: new Map(), market: [], marketFrac: [], reveal: [],
    taxes: 0, moralePerMin: 0, dreadPerNight: 0, morale: 0, groves: 0, groveDeps: false, nodeDeps: false,
  };
  const flags = {};
  for (const a of X.active) {
    const def = COMBOS[a.id];
    const e = def.effect;
    if (def.test.kind === 'grove') { fx.groves++; fx.groveDeps = true; continue; }
    if (def.test.kind === 'touchNode') fx.nodeDeps = true;
    const members = e.on === 'anchor' ? [a.ids[0]] : e.on === 'others' ? a.ids.slice(1) : a.ids;
    for (const bid of members) {
      const k = `${a.id}:${bid}`;
      if (doneFor.has(k)) continue;
      doneFor.add(k);
      const w = want.get(bid) || { r: 0, d: 0, l: 0, c: 0, h: 0 };
      w.r += e.bonusRange || 0; w.d += e.bonusDmg || 0; w.l += e.bonusLight || 0; w.c += e.bonusChain || 0; w.h += e.hpMult || 0;
      want.set(bid, w);
      if (e.farm) fx.farm.set(bid, (fx.farm.get(bid) || 1) * (1 + e.farm));
      if (e.gather) {
        const g = fx.gather.get(bid) || {};
        for (const rk in e.gather) g[rk] = (g[rk] || 1) * (1 + e.gather[rk]);
        fx.gather.set(bid, g);
      }
      if (e.marketGold) { fx.market.push(bid); fx.marketFrac.push(e.marketGold); }
      if (e.reveal) fx.reveal.push(bid, e.reveal);
    }
    if (!globalIds.has(a.id)) {
      globalIds.add(a.id);
      fx.taxes += e.taxes || 0;
      fx.moralePerMin += e.moralePerMin || 0;
      fx.dreadPerNight += e.dreadPerNight || 0;
      fx.morale += e.baseMorale || 0;
      if (e.flags) for (const f in e.flags) flags[f] = e.flags[f];
    }
  }
  return { fx, want, flags };
}
let verSeq = 0;

/** Apply the difference between what we recorded and what the active list wants; refresh the cache. */
function applyEffects(s, X) {
  X.nodes = nodeSig(s);
  const { fx, want, flags } = derive(s, X);
  // Per-building deltas: union of what we recorded before and what we want now.
  let light = false;
  const rec = X.rec;
  const ids = new Set([...Object.keys(rec).map(Number), ...want.keys()]);
  for (const bid of [...ids].sort((a, c) => a - c)) {
    const b = getB(s, bid);
    if (!b) { delete rec[bid]; continue; }
    const w = want.get(bid) || { r: 0, d: 0, l: 0, c: 0, h: 0 };
    const p = rec[bid] || { r: 0, d: 0, l: 0, c: 0, h: 0, m: 0 };
    if (p.r !== w.r) b.bonusRange = r6((b.bonusRange || 0) - p.r + w.r);
    if (p.d !== w.d) b.bonusDmg = r6((b.bonusDmg || 0) - p.d + w.d);
    if (p.l !== w.l) { b.bonusLight = r6((b.bonusLight || 0) - p.l + w.l); light = true; }
    if (p.c !== w.c) b.bonusChain = r6((b.bonusChain || 0) - p.c + w.c);
    // Max health: if something else rebuilt maxHp since (an upgrade), our old add is already gone.
    const prevAdd = p.h && b.maxHp === p.m ? p.h : 0;
    const base = b.maxHp - prevAdd;
    const add = w.h ? Math.round(base * w.h) : 0;
    if (add !== prevAdd) {
      const ratio = b.maxHp > 0 ? b.hp / b.maxHp : 1;
      b.maxHp = base + add;
      b.hp = Math.max(1, Math.min(b.maxHp, r6(b.maxHp * ratio)));
    }
    if (w.r || w.d || w.l || w.c || add) rec[bid] = { r: w.r, d: w.d, l: w.l, c: w.c, h: add, m: b.maxHp };
    else delete rec[bid];
  }
  if (light) markLightDirty(s);
  // baseMorale: apply only the difference from what we added before.
  const dm = fx.morale - X.morale;
  if (dm) {
    const m = mood(s);
    if (typeof m.baseMorale !== 'number') m.baseMorale = BASE_MORALE_DEFAULT;
    m.baseMorale = r6(m.baseMorale + dm);
    X.morale = fx.morale;
  }
  X.flags = flags;
  s.rt.combo = fx;
}

/** The runtime cache; after a load (fresh s.rt) it is derived from the saved active list, with no side effects. */
function fxOf(s) {
  return s.rt.combo || (s.rt.combo = derive(s, comboState(s)).fx);
}
const peek = fxOf;

// ---- Validation of terrain/node-dependent combos ---------------------------------------------------------
/**
 * Cheap signature of the resource-node set: count plus a mixed id sum, so a boulder running out and a
 * tree regrowing in the same check window still reads as a change (a plain count would not).
 */
function nodeSig(s) {
  const L = s.nodes;
  let h = 0;
  for (let i = 0; i < L.length; i++) h = (h + Math.imul(L[i].id | 0, 2654435761)) | 0;
  return ((h >>> 0) % 1000003) * 4096 + (L.length & 4095);
}
function stillValid(s, fx) {
  if (fx.nodes !== nodeSig(s)) return false;
  const X = s.ext.combos;
  if (!X) return true;
  if (fx.groveDeps) {
    for (const a of X.active) if (a.id === 'feyGrove' && !groveOk(s, a.tx, a.ty, COMBOS.feyGrove.test.size)) return false;
  }
  return true;
}

// ---- BUS handlers -----------------------------------------------------------------------------------------
function onBuilt(s) { recomputeCombos(s, false); }
function onRemoved(s) { recomputeCombos(s, false); }

function onPhase(s, phase) {
  if (phase === 'dawn') {
    recomputeCombos(s, true);
    feyDawn(s);
  } else if (phase === 'night') {
    const fx = fxOf(s);
    if (fx.dreadPerNight) {
      moodAdd(s, 0, fx.dreadPerNight);
      emit(s, { t: 'toast', text: `Grave Quarter: the barracks dead stir. Dread +${fx.dreadPerNight}.`, tone: 'bad', icon: 'skull' });
    }
  }
}

function feyDawn(s) {
  const X = s.ext.combos;
  if (!X) return;
  const r = s.rt.rng;
  for (const a of X.active) {
    if (a.id !== 'feyGrove') continue;
    if (r.chance(COMBOS.feyGrove.effect.blessing)) {
      const bl = r.pick(COMBO_TUNE.blessings);
      if (bl.res) for (const k in bl.res) flowRes(s, k, bl.res[k]);
      if (bl.morale) moodAdd(s, bl.morale, 0);
      emit(s, { t: 'toast', text: `Fey Grove: ${bl.text}`, tone: 'good', icon: 'heart' });
      emit(s, { t: 'feyGrove', x: a.cx, y: a.cy, good: true });
    } else {
      const pool = s.buildings.filter((b) => isUp(b) && b.type !== 'hearth' && !BUILDINGS[b.type].isWall);
      if (!pool.length) continue;
      const b = r.pick(pool);
      b.hp = Math.max(1, r6(b.hp - b.maxHp * COMBO_TUNE.prank));
      b.hitT = 0.3;
      emit(s, { t: 'toast', text: `Fey Grove: the fey played a prank on your ${BUILDINGS[b.type].name} (-${Math.round(COMBO_TUNE.prank * 100)}% health).`, tone: 'bad', icon: 'heart' });
      emit(s, { t: 'feyGrove', x: cxOf(b), y: cyOf(b), good: false });
    }
  }
}

function onTick(s, dt) {
  let fx = fxOf(s);
  if (s.tick % COMBO_TUNE.validateEvery === 0) {
    if (!stillValid(s, fx)) { recomputeCombos(s, false); fx = s.rt.combo; }
    const rv = fx.reveal;
    for (let i = 0; i < rv.length; i += 2) { const b = getB(s, rv[i]); if (b) revealAround(s, cxOf(b), cyOf(b), rv[i + 1]); }
  }
  if (fx.moralePerMin) moodAdd(s, (fx.moralePerMin / 60) * dt, 0);
  const mk = fx.market;
  for (let i = 0; i < mk.length; i++) {
    const b = getB(s, mk[i]);
    if (b && b.built && b.goldRate > 0) flowRes(s, 'gold', ((b.goldRate * fx.marketFrac[i]) / 60) * dt);
  }
}

function farmMult(s, farm) {
  const v = peek(s).farm.get(farm.id);
  return v || 1;
}
function gatherMult(s, b, k) {
  if (!b) return 1;
  const g = peek(s).gather.get(b.id);
  return g && g[k] ? g[k] : 1;
}
function goldMult(s) {
  const t = peek(s).taxes;
  return t ? 1 + t : 1;
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  BUS.built.push(onBuilt);
  BUS.removed.push(onRemoved);
  BUS.phase.push(onPhase);
  BUS.tick.push(onTick);
  BUS.farmMult.push(farmMult);
  BUS.gatherMult.push(gatherMult);
  BUS.goldMult.push(goldMult);
}
