// ============================================================================
// ZONEFALL 3 — Rust-style building. 3 m foundations on a global grid, walls /
// doorways / windows / low walls on cell edges, floors (roofs) on cells, high
// external walls + gates, free-placed deployables. Tiers twig→wood→stone→
// metal→armored.
//
// Storeys: walls and floors stack up to three storeys (st 0..2). A wall of
// storey s stands on a foundation (s = 0) or on a floor of storey s-1; the
// floor ("ceiling") of storey s is the roof of that storey and the walking
// surface of storey s+1. Stairs fill one cell of a storey and climb to the next
// floor level (a ramp you walk up, entered from the low end). Ladders are
// deployables leant on an edge; you climb them (player: p.ladder, AI: a.climb).
// Every collider carries a height band (ylo/yhi) so a wall upstairs never
// blocks anyone downstairs and vice versa.
//
// Also: Tool Cupboard privilege + upkeep + decay (any owner: you or an AI
// survivor), base storage, ovens, production, looting other people's boxes,
// and the raider flow field (cheapest path to the Tool Cupboard).
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { G } from './state.js';
import { CELL, FOUND_H, WALL_H, STOREY, MAX_ST, TIER, TIERS, PIECES, DOORS, HIGHWALLS, DEPLOY, TC_RANGE, OVENS, ITEMS, UPKEEP, DECAY } from './data.js';
import { Inv, scaleCost } from './inventory.js';
import { addDoor, removeDoor, setOnDoorDestroyed } from './doors.js';
import { Heap, clamp, angDiff, dist } from './util.js';
import { Sfx } from './audio.js';
import { Home, isLit } from './homestead.js';

let Models = null;
export function setBuildModels(m) { Models = m; }

let PID = 1;
const ek = (e, i, j, s) => s ? e + ',' + i + ',' + j + ',' + s : e + ',' + i + ',' + j;
const ck = (i, j) => i + ',' + j;
const ceilK = s => s ? 'ceil' + s : 'ceil';
const stairK = s => 'stair' + (s || 0);
/** stairs: the way you walk to go up — 0 +x, 1 +z, 2 -x, 3 -z */
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** does collider c block someone whose feet are at height y? (same rule as moveActor) */
export function bandHit(c, y) { return c.yhi === undefined || y === undefined || (y < c.yhi - 0.3 && y + 1.7 > c.ylo); }
const SOLIDB = y => c => c.solid && !c.off && bandHit(c, y);
// explosive damage multipliers per tier (mirrors combat.js) — bots use it to plan raids
export const BOOM_MULT = { twig: 3, wood: 1.25, stone: 1, metal: 0.8, armored: 0.6 };
const doorTier = k => k === 'door_wood' || k === 'gate_wood' ? 'wood' : k === 'door_armored' ? 'armored' : k === 'gate_stone' ? 'stone' : 'metal';
const TIER_RES = { twig: 'wood', wood: 'wood', stone: 'stone', metal: 'metal', armored: 'hqm' };
const NONE = new Set();
const noBake = p => p.type === 'ceiling' || p.type === 'tri_ceiling'; // floors keep their own (see-through) meshes
// ---------------------------------------------------------------- triangle geometry
// Triangles (3 m equilateral) live off the square grid: a "tri cell" is keyed by its rounded centroid and
// holds a triangle foundation and/or floors per storey. Triangle edges that lie on a grid edge reuse the
// grid key ('h'/'v'); every other edge is a 'd' edge keyed by its rounded midpoint (x20).
export const TRI_H = CELL * Math.sqrt(3) / 2;
const r3 = v => Math.round(v * 1000) / 1000;
const triKey = V => 't' + Math.round((V[0][0] + V[1][0] + V[2][0]) / 3 * 20) + ',' + Math.round((V[0][1] + V[1][1] + V[2][1]) / 3 * 20);
function inTri(V, x, z) {
  const s = (a, b) => (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const d1 = s(V[0], V[1]), d2 = s(V[1], V[2]), d3 = s(V[2], V[0]);
  return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6));
}
/** centroid + one point 55 % of the way to each corner (overlap tests) */
function triSamples(V) { const cx = (V[0][0] + V[1][0] + V[2][0]) / 3, cz = (V[0][1] + V[1][1] + V[2][1]) / 3; return [[cx, cz], ...V.map(v => [cx + (v[0] - cx) * 0.55, cz + (v[1] - cz) * 0.55])]; }
function triEdgesOf(V) { return [0, 1, 2].map(k => ({ a: V[k], b: V[(k + 1) % 3], opp: V[(k + 2) % 3] })); }
/** canonical key of a 3 m segment: a grid edge keeps 'h'/'v' (i, j); anything else is 'd' at its midpoint */
export function segKey(x0, z0, x1, z1) {
  const on = v => Math.abs(v / CELL - Math.round(v / CELL)) < 0.004;
  if (Math.abs(z0 - z1) < 0.01 && on(z0) && on(x0) && on(x1) && Math.abs(Math.abs(x1 - x0) - CELL) < 0.02) return { e: 'h', i: Math.round(Math.min(x0, x1) / CELL), j: Math.round(z0 / CELL) };
  if (Math.abs(x0 - x1) < 0.01 && on(x0) && on(z0) && on(z1) && Math.abs(Math.abs(z1 - z0) - CELL) < 0.02) return { e: 'v', i: Math.round(x0 / CELL), j: Math.round(Math.min(z0, z1) / CELL) };
  return { e: 'd', i: Math.round((x0 + x1) * 10), j: Math.round((z0 + z1) * 10) };
}
function segDist(x, z, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / L2, 0, 1); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); }
/** the triangle that hangs off segment a-b on the side away from `inside` */
function triOff(a, b, inside) {
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
  if ((inside[0] - mx) * nx + (inside[1] - mz) * nz > 0) { nx = -nx; nz = -nz; }
  return [[r3(a[0]), r3(a[1])], [r3(b[0]), r3(b[1])], [r3(mx + nx * TRI_H), r3(mz + nz * TRI_H)]];
}

export const Build = {
  cells: new Map(),   // "i,j" -> { found, ceil, ceil1, ceil2, stair0, stair1, stair2 }
  edges: new Map(),   // "h|v,i,j[,storey]" -> piece
  deploys: [],
  tcells: new Map(),  // triangle cells: "t<cx*20>,<cz*20>" -> { v, cx, cz, level, found, ceil, ceil1, ceil2 }
  triEdges: new Map(), // edge key (no storey) -> Set of triangle cells on that edge
  triGrid: new Map(),  // "i,j" -> Set of triangle cells overlapping that grid cell
  tc: null,
  dirty: true,        // flow field needs rebuild
  ff: null,
  reset() {
    for (const p of this.allPieces()) this._kill(p, true);
    this.tcells.clear(); this.triEdges.clear(); this.triGrid.clear();
    for (const d of [...this.deploys]) this.removeDeploy(d, true);
    for (const r of this.regions.values()) if (r.baked) { G.scene.remove(r.baked); disposeBaked(r.baked); }
    this.regions.clear();
    this.cells.clear(); this.edges.clear(); this.deploys.length = 0; this.tc = null; this.dirty = true; this.ff = null; this._upkClock = undefined;
    Home.reset();
  },
  // ---------------------------------------------------------------- queries
  cell(i, j) { return this.cells.get(ck(i, j)); },
  found(i, j) { const c = this.cells.get(ck(i, j)); return c ? c.found : null; },
  ceilAt(i, j, s = 0) { const c = this.cells.get(ck(i, j)); return c ? c[ceilK(s)] || null : null; },
  stairAt(i, j, s = 0) { const c = this.cells.get(ck(i, j)); return c ? c[stairK(s)] || null : null; },
  edge(e, i, j, s = 0) { return this.edges.get(ek(e, i, j, s)); },
  /** every live building piece (foundations, floors, stairs, walls, high walls) */
  allPieces() {
    const out = [...this.edges.values()];
    for (const c of this.cells.values()) { if (c.found) out.push(c.found); for (let s = 0; s < MAX_ST; s++) { const q = c[ceilK(s)]; if (q) out.push(q); const st = c[stairK(s)]; if (st) out.push(st); } }
    for (const c of this.tcells.values()) { if (c.found) out.push(c.found); for (let s = 0; s < MAX_ST; s++) { const q = c[ceilK(s)]; if (q) out.push(q); } }
    return out;
  },
  /** world XZ centre of any piece */
  pieceXZ(p) {
    if (p.tk) { const v = p.verts; return [(v[0][0] + v[1][0] + v[2][0]) / 3, (v[0][1] + v[1][1] + v[2][1]) / 3]; }
    if (p.edge === 'd') return [(p.seg[0] + p.seg[2]) / 2, (p.seg[1] + p.seg[3]) / 2];
    if (p.edge) return this.edgeCenter(p.edge, p.ci, p.cj);
    return [p.ci * CELL + CELL / 2, p.cj * CELL + CELL / 2];
  },
  /** the Build.edges key of an edge piece */
  edgeKeyOf(p) { return p.edge === 'd' ? ek('d', p.mi, p.mj, p.st) : ek(p.edge, p.ci, p.cj, p.st); },
  /** {e, i, j} of a build target on an edge */
  edgeKeyT(t) { return t.edge === 'd' ? segKey(t.seg[0], t.seg[1], t.seg[2], t.seg[3]) : { e: t.edge, i: t.ci, j: t.cj }; },
  // ---------------------------------------------------------------- triangle cells
  triAt(x, z) { const l = this.triGrid.get(ck(Math.floor(x / CELL), Math.floor(z / CELL))); if (l) for (const c of l) if (inTri(c.v, x, z)) return c; return null; },
  triPiece(tk, kind, st = 0) { const c = this.tcells.get(tk); return c ? (kind === 'f' ? c.found : c[ceilK(st)] || null) : null; },
  trisNear(x, z) { const out = new Set(); const i = Math.floor(x / CELL), j = Math.floor(z / CELL); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const l = this.triGrid.get(ck(i + di, j + dj)); if (l) for (const c of l) out.add(c); } return out; },
  addTriCell(V, level) {
    const v = V.map(q => [r3(q[0]), r3(q[1])]); const key = triKey(v);
    const c = { key, v, cx: (v[0][0] + v[1][0] + v[2][0]) / 3, cz: (v[0][1] + v[1][1] + v[2][1]) / 3, level, found: null, ceil: null, up: true, eks: [] };
    for (const e of triEdgesOf(v)) { const K = segKey(e.a[0], e.a[1], e.b[0], e.b[1]); const k = ek(K.e, K.i, K.j, 0); c.eks.push(k); if (!this.triEdges.has(k)) this.triEdges.set(k, new Set()); this.triEdges.get(k).add(c); }
    const xs = v.map(q => q[0]), zs = v.map(q => q[1]); c.grid = [];
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) for (let j = Math.floor(Math.min(...zs) / CELL); j <= Math.floor(Math.max(...zs) / CELL); j++) { const k = ck(i, j); if (!this.triGrid.has(k)) this.triGrid.set(k, new Set()); this.triGrid.get(k).add(c); c.grid.push(k); }
    this.tcells.set(key, c); return c;
  },
  dropTriCell(c) {
    if (c.found || [0, 1, 2].some(s => c[ceilK(s)])) return;
    this.tcells.delete(c.key);
    for (const k of c.eks) { const s = this.triEdges.get(k); if (s) { s.delete(c); if (!s.size) this.triEdges.delete(k); } }
    for (const k of c.grid) { const s = this.triGrid.get(k); if (s) { s.delete(c); if (!s.size) this.triGrid.delete(k); } }
  },
  /** is the area of triangle V free of foundations (square or triangle) — or with floors=true, of anything at all */
  triFree(V, skipKey, floors) {
    const sm = triSamples(V);
    for (const [x, z] of sm) if (this.found(Math.floor(x / CELL), Math.floor(z / CELL))) return false;
    for (const c of this.trisNear(sm[0][0], sm[0][1])) {
      if (c.key === skipKey || !(c.found || floors)) continue;
      if (sm.some(q => inTri(c.v, q[0], q[1])) || triSamples(c.v).some(q => inTri(V, q[0], q[1]))) return false;
    }
    return true;
  },
  /** does a square cell overlap any triangle foundation? */
  triOverlapsCell(ci, cj) {
    const l = this.triGrid.get(ck(ci, cj)); if (!l) return false; const x0 = ci * CELL + 0.05, z0 = cj * CELL + 0.05, x1 = x0 + CELL - 0.1, z1 = z0 + CELL - 0.1;
    for (const c of l) { if (!c.found) continue; if (triSamples(c.v).some(([x, z]) => x > x0 && x < x1 && z > z0 && z < z1)) return true; }
    return false;
  },
  /** levels of the cells holding up an edge at storey st (foundations for st 0, floors / stairs of st-1 above that) */
  edgeSupport(e, i, j, st) {
    const out = [];
    if (e !== 'd') for (const [ci, cj] of this.edgeCells(e, i, j)) { const f = this.found(ci, cj); if (!f) continue; if (st === 0 || this.ceilAt(ci, cj, st - 1) || this.stairAt(ci, cj, st - 1)) out.push(f.level); }
    const ts = this.triEdges.get(ek(e, i, j, 0)); if (ts) for (const c of ts) if (st === 0 ? c.found : c[ceilK(st - 1)]) out.push(c.level);
    return out;
  },
  /** a triangle floor without a foundation hangs off a neighbouring floor of the same storey (returns that floor's level) */
  triCeilSupport(V, st, key) {
    for (const e of triEdgesOf(V)) {
      const K = segKey(e.a[0], e.a[1], e.b[0], e.b[1]);
      if (K.e !== 'd') for (const [ci, cj] of this.edgeCells(K.e, K.i, K.j)) if (this.ceilAt(ci, cj, st) && this.found(ci, cj)) return this.found(ci, cj).level;
      const ts = this.triEdges.get(ek(K.e, K.i, K.j, 0)); if (ts) for (const c of ts) if (c.key !== key && c[ceilK(st)]) return c.level;
    }
    return null;
  },
  /** a triangle foundation snapped to the free edge nearest the crosshair */
  triFoundTarget(x, z) {
    let best = null, bd = 4.2 * 4.2;
    const consider = (a, b, inside, level) => {
      const V = triOff(a, b, inside); const cx = (V[0][0] + V[1][0] + V[2][0]) / 3, cz = (V[0][1] + V[1][1] + V[2][1]) / 3; const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d >= bd) return; const c = this.tcells.get(triKey(V)); if ((c && c.found) || !this.triFree(V, triKey(V))) return;
      bd = d; best = { tri: V, level };
    };
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) {
      const f = this.found(i, j); if (!f) continue; const X = i * CELL, Z = j * CELL, ins = [X + CELL / 2, Z + CELL / 2];
      for (const [a, b, ni, nj] of [[[X, Z], [X + CELL, Z], i, j - 1], [[X, Z + CELL], [X + CELL, Z + CELL], i, j + 1], [[X, Z], [X, Z + CELL], i - 1, j], [[X + CELL, Z], [X + CELL, Z + CELL], i + 1, j]]) if (!this.found(ni, nj)) consider(a, b, ins, f.level);
    }
    for (const c of this.trisNear(x, z)) if (c.found) for (const e of triEdgesOf(c.v)) consider(e.a, e.b, e.opp, c.level);
    return best;
  },
  /** a triangle floor: over the triangle you aim at, or hanging off the edge of the floor you stand on */
  triCeilTarget(x, z, y) {
    const c = this.triAt(x, z);
    if (c) return { tri: c.v, level: c.level, st: this.storeyAtLevel(c.level, y) };
    const P = G.player; if (!P) return null; let best = null, bd = 4.2 * 4.2;
    const consider = (a, b, inside, level, st) => {
      if (st < 0 || st >= MAX_ST) return;
      const V = triOff(a, b, inside); const cx = (V[0][0] + V[1][0] + V[2][0]) / 3, cz = (V[0][1] + V[1][1] + V[2][1]) / 3; const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d >= bd || this.tcells.get(triKey(V)) || !this.triFree(V, null, true)) return;
      bd = d; best = { tri: V, level, st };
    };
    const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
    for (let i = i0 - 2; i <= i0 + 2; i++) for (let j = j0 - 2; j <= j0 + 2; j++) {
      const f = this.found(i, j); if (!f) continue; const st = this.storeyAtLevel(f.level, P.y) - 1; if (st < 0 || !this.ceilAt(i, j, st)) continue;
      const X = i * CELL, Z = j * CELL, ins = [X + CELL / 2, Z + CELL / 2];
      for (const [a, b, ni, nj] of [[[X, Z], [X + CELL, Z], i, j - 1], [[X, Z + CELL], [X + CELL, Z + CELL], i, j + 1], [[X, Z], [X, Z + CELL], i - 1, j], [[X + CELL, Z], [X + CELL, Z + CELL], i + 1, j]]) if (!this.found(ni, nj)) consider(a, b, ins, f.level, st);
    }
    for (const t of this.trisNear(x, z)) { const st = this.storeyAtLevel(t.level, P.y) - 1; if (st >= 0 && t[ceilK(st)]) for (const e of triEdgesOf(t.v)) consider(e.a, e.b, e.opp, t.level, st); }
    return best;
  },
  /** height of the floor of storey s in cell (i,j) (foundation top for s = 0), or null */
  floorBase(i, j, s = 0) { const f = this.found(i, j); return f ? f.level + FOUND_H + s * STOREY : null; },
  /** cells adjacent to an edge */
  edgeCells(e, i, j) { return e === 'h' ? [[i, j - 1], [i, j]] : [[i - 1, j], [i, j]]; },
  edgeCenter(e, i, j) { return e === 'h' ? [i * CELL + CELL / 2, j * CELL] : [i * CELL, j * CELL + CELL / 2]; },
  /** ramp height of a stairs piece at (x, z) */
  stairY(st, x, z) {
    const [dx, dz] = DIRS[st.dir || 0]; const x0 = st.ci * CELL, z0 = st.cj * CELL;
    const u = dx ? (dx > 0 ? x - x0 : x0 + CELL - x) : (dz > 0 ? z - z0 : z0 + CELL - z);
    return st.base + STOREY * clamp(u / CELL, 0, 1);
  },
  /** world points of a stairs piece: bottom (just outside the low end), top (just past the high end) */
  stairEnds(st) {
    const [dx, dz] = DIRS[st.dir || 0]; const cx = st.ci * CELL + CELL / 2, cz = st.cj * CELL + CELL / 2;
    return { bx: cx - dx * (CELL / 2 + 0.55), bz: cz - dz * (CELL / 2 + 0.55), by: st.base, tx: cx + dx * (CELL / 2 + 0.6), tz: cz + dz * (CELL / 2 + 0.6), ty: st.base + STOREY, ix: cx - dx * (CELL / 2 - 0.4), iz: cz - dz * (CELL / 2 - 0.4) };
  },
  /** floor height at a point for someone at height y (undefined = the ground floor): terrain, foundations, floors, stairs, monuments, vehicles */
  floorY(x, z, y) {
    const c = this.cells.get(ck(Math.floor(x / CELL), Math.floor(z / CELL)));
    let t = G.W.height(x, z);
    if (this.triGrid.size) { const tl = this.triGrid.get(ck(Math.floor(x / CELL), Math.floor(z / CELL))); if (tl) for (const tc of tl) {
      if (!inTri(tc.v, x, z)) continue; const L = tc.level + FOUND_H; if (tc.found && L > t) t = L;
      if (y !== undefined) for (let s = 0; s < MAX_ST; s++) if (tc[ceilK(s)]) { const top = L + (s + 1) * STOREY; if (y >= top - 0.9 && top > t) t = top; }
    } }
    if (G.train) { const ty = G.train.floorAt(x, z, y); if (ty !== null) t = Math.max(t, ty); }
    if (G.cargo) { const cy = G.cargo.floorAt(x, z, y); if (cy !== null) t = Math.max(t, cy); }
    if (G.infra) { const by = G.infra.floorAt(x, z, y); if (by !== null) t = Math.max(t, by); }
    if (G.floors && G.floorAt) { const my = G.floorAt(x, z, y); if (my !== null) t = Math.max(t, my); }
    if (G.decks) for (const d of G.decks) if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) { t = Math.max(t, d.y); break; }
    const f = c && c.found; if (!f) return t;
    t = Math.max(t, f.level + FOUND_H);
    if (y === undefined || !c.up) return t;
    // upper floors and stairs: height-aware (you stand on one when you come from above it or step up onto it)
    const L = f.level + FOUND_H;
    for (let s = 0; s < MAX_ST; s++) {
      if (c[ceilK(s)]) { const top = L + (s + 1) * STOREY; if (y >= top - 0.9 && top > t) t = top; }
      const st = c[stairK(s)]; if (st) { const fy = this.stairY(st, x, z); if (y >= fy - 0.9 && fy > t) t = fy; }
    }
    return t;
  },
  /** which storey (0..2) of cell (i,j) a point at height y is on */
  storeyAt(i, j, y) {
    const f = this.found(i, j); if (!f || y === undefined) return 0;
    return this.storeyAtLevel(f.level, y);
  },
  storeyAtLevel(level, y) { return y === undefined ? 0 : clamp(Math.round((y - (level + FOUND_H)) / STOREY), 0, MAX_ST - 1); },
  inPrivilege(x, z) { const t = this.tc; return !!t && (t.x - x) ** 2 + (t.z - z) ** 2 < TC_RANGE * TC_RANGE; },
  /** the cupboard that claims (x, z) for this owner, or null */
  tcFor(owner, x, z) { for (const d of this.deploys) if (d.type === 'tc' && d.owner === owner && !d.dead && (d.x - x) ** 2 + (d.z - z) ** 2 < TC_RANGE * TC_RANGE) return d; return null; },
  /** nearest edge to point (optionally only edges valid for type) */
  pickEdge(x, z, type, y) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL); const fx = x / CELL - i, fz = z / CELL - j;
    const cands = [['h', i, j, fz], ['h', i, j + 1, 1 - fz], ['v', i, j, fx], ['v', i + 1, j, 1 - fx]].map(c => ({ edge: c[0], ci: c[1], cj: c[2], d: c[3] * CELL }));
    // triangle edges near the crosshair (the triangle you aim into first)
    if (!HIGHWALLS[type] && this.tcells.size) {
      const inT = this.triAt(x, z);
      for (const c of this.trisNear(x, z)) for (const e of triEdgesOf(c.v)) {
        const d = segDist(x, z, e.a, e.b) - (c === inT ? 1.5 : 0); if (d > 1.6) continue;
        const K = segKey(e.a[0], e.a[1], e.b[0], e.b[1]);
        if (K.e !== 'd') { const dup = cands.find(q => q.edge === K.e && q.ci === K.i && q.cj === K.j); if (dup) { dup.d = Math.min(dup.d, d); dup.level = c.level; continue; } cands.push({ edge: K.e, ci: K.i, cj: K.j, d, level: c.level }); continue; }
        if (cands.some(q => q.edge === 'd' && q.mi === K.i && q.mj === K.j)) continue;
        cands.push({ edge: 'd', seg: [e.a[0], e.a[1], e.b[0], e.b[1]], mi: K.i, mj: K.j, ci: Math.floor((e.a[0] + e.b[0]) / 2 / CELL), cj: Math.floor((e.a[1] + e.b[1]) / 2 / CELL), d, level: c.level });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    const stOf = c => { if (HIGHWALLS[type] || y === undefined) return 0; if (c.level !== undefined) return this.storeyAtLevel(c.level, y); const [[ai, aj], [bi, bj]] = this.edgeCells(c.edge, c.ci, c.cj); const f = this.found(i, j) ? [i, j] : this.found(ai, aj) ? [ai, aj] : [bi, bj]; return this.storeyAt(f[0], f[1], y); };
    const mk = (c, st) => c.edge === 'd' ? { edge: 'd', seg: c.seg, ci: c.ci, cj: c.cj, st } : { edge: c.edge, ci: c.ci, cj: c.cj, st };
    if (type) for (const c of cands) { const t = mk(c, stOf(c)); if (this.check(type, t).ok) return t; }
    return mk(cands[0], stOf(cands[0]));
  },
  pickCell(x, z, y) { const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL); return { ci, cj, st: this.storeyAt(ci, cj, y) }; },
  /** stairs direction from a view yaw (+ the build-mode rotation) */
  dirFromYaw(yaw) { return ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4; },
  /** world target for a build type at point x,z (y = height of the floor the crosshair is on) */
  target(type, x, z, ry = 0, y) {
    if (PIECES[type]) {
      if (PIECES[type].kind === 'tri') return (type === 'tri_foundation' ? this.triFoundTarget(x, z) : this.triCeilTarget(x, z, y)) || { none: true, x, z };
      if (PIECES[type].kind !== 'cell') return this.pickEdge(x, z, type, y);
      const t = this.pickCell(x, z, y);
      if (type === 'stairs') { const P = G.player; t.dir = this.dirFromYaw((P ? P.yaw ?? P.ang : 0) + ry); }
      return t;
    }
    if (HIGHWALLS[type]) return this.pickEdge(x, z, type);
    if (DOORS[type]) {
      // nearest doorway (or highwall edge for gates) without a door
      const want = DOORS[type].gate ? 'highgate' : 'doorway';
      let best = null, bd = 9;
      for (const p of this.edges.values()) {
        if (p.door || p.owner !== 'player') continue;
        if (want === 'doorway' && p.type !== 'doorway') continue;
        if (want === 'highgate' && !p.hw) continue;
        const [cx, cz] = this.pieceXZ(p); const dy = y === undefined ? 0 : (p.base ?? p.level) - y;
        const d = (cx - x) ** 2 + (cz - z) ** 2 + dy * dy * 2; if (d < bd) { bd = d; best = p; }
      }
      return best ? { edge: best.edge, ci: best.ci, cj: best.cj, st: best.st || 0, piece: best } : { none: true, x, z };
    }
    if (DEPLOY[type] && DEPLOY[type].ladder) return this.ladderTarget(G.player) || { none: true, x, z };
    return { x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4, ry, y };
  },
  // ---------------------------------------------------------------- validation
  check(type, t, owner = 'player') {
    const W = G.W;
    if (PIECES[type] && PIECES[type].kind === 'tri') {
      if (t.none || !t.tri) return { ok: false, why: type === 'tri_foundation' ? 'Aim next to a foundation edge' : 'Aim at a triangle, or off the edge of the floor you stand on' };
      const V = t.tri, key = triKey(V), c = this.tcells.get(key), st = type === 'tri_foundation' ? 0 : (t.st || 0);
      const cx = (V[0][0] + V[1][0] + V[2][0]) / 3, cz = (V[0][1] + V[1][1] + V[2][1]) / 3;
      if (type === 'tri_foundation') {
        if (c && c.found) return { ok: false, why: 'Occupied' };
        if (!this.triFree(V, key)) return { ok: false, why: 'Occupied' };
        const lv = t.level; if (lv === undefined) return { ok: false, why: 'Needs a foundation next to it' };
        const pts = [...V, ...triSamples(V)]; const hs = pts.map(q => W.height(q[0], q[1]));
        if (Math.max(...hs) > lv + 0.35) return { ok: false, why: 'Terrain too high' };
        if (Math.min(...hs) < lv - 2.3) return { ok: false, why: 'Too steep' };
        if (pts.some(q => W.isWater(q[0], q[1]))) return { ok: false, why: 'In water' };
        if (owner !== 'fort' && this.blockedArea(cx, cz, 0.9)) return { ok: false, why: 'Blocked' };
        if (W.onRail && W.onRail(cx, cz, 2.6)) return { ok: false, why: 'On the railway' };
        if (owner !== 'fort') { const m = this.nearMonument(cx, cz, 8); if (m) return { ok: false, why: 'Too close to ' + m.name }; }
        return { ok: true, level: lv };
      }
      if (st < 0 || st >= MAX_ST) return { ok: false, why: 'Too high (3 storeys max)' };
      if (c && c[ceilK(st)]) return { ok: false, why: 'Occupied' };
      if (c && c.found) { if (st > 0 && !c[ceilK(st - 1)]) return { ok: false, why: 'Needs a floor below' }; return { ok: true }; }
      if (c && st > 0 && c[ceilK(st - 1)]) return { ok: true };
      if (this.triCeilSupport(V, st, key) === null) return { ok: false, why: 'Needs a floor next to it' };
      if (!c && !this.triFree(V, null, true)) return { ok: false, why: 'Occupied' };
      return { ok: true };
    }
    if (PIECES[type] && PIECES[type].kind === 'cell') {
      const { ci, cj } = t; const c = this.cell(ci, cj); const st = t.st || 0;
      if (type === 'foundation') {
        if (c && c.found) return { ok: false, why: 'Occupied' };
        if (this.triOverlapsCell(ci, cj)) return { ok: false, why: 'Occupied' };
        const lv = this.levelFor(ci, cj); if (!lv.ok) return lv;
        const x0 = ci * CELL, z0 = cj * CELL;
        for (const [ox, oz] of [[0.3, 0.3], [2.7, 0.3], [0.3, 2.7], [2.7, 2.7], [1.5, 1.5]]) {
          if (W.isWater(x0 + ox, z0 + oz)) return { ok: false, why: 'In water' };
        }
        if (owner !== 'fort' && this.blockedArea(x0 + 1.5, z0 + 1.5, 1.45)) return { ok: false, why: 'Blocked' };
        if (W.onRail && W.onRail(x0 + 1.5, z0 + 1.5, 3.2)) return { ok: false, why: 'On the railway' };
        if (owner !== 'fort') { const m = this.nearMonument(x0 + 1.5, z0 + 1.5, 8); if (m) return { ok: false, why: 'Too close to ' + m.name }; }
        return { ok: true, level: lv.level };
      }
      if (!c || !c.found) return { ok: false, why: 'Needs a foundation' };
      if (st < 0 || st >= MAX_ST) return { ok: false, why: 'Too high (3 storeys max)' };
      if (type === 'stairs') {
        if (c[stairK(st)]) return { ok: false, why: 'Occupied' };
        if (c[ceilK(st)]) return { ok: false, why: 'Take the floor above out first' };
        if (st > 0 && !c[ceilK(st - 1)]) return { ok: false, why: 'Needs a floor to stand on' };
        if (owner !== 'fort' && this.blockedCell(ci, cj, this.floorBase(ci, cj, st))) return { ok: false, why: 'Blocked' };
        return { ok: true };
      }
      // floor / roof
      if (c[ceilK(st)]) return { ok: false, why: 'Occupied' };
      if (c[stairK(st)]) return { ok: false, why: 'Stairs are here' };
      if (st > 0 && !c[ceilK(st - 1)] && !c[stairK(st - 1)]) return { ok: false, why: 'Needs a floor below' };
      return { ok: true };
    }
    if ((PIECES[type] && PIECES[type].kind === 'edge') || HIGHWALLS[type]) {
      if (t.edge === 'd' && HIGHWALLS[type]) return { ok: false, why: 'Not on foundations' };
      const K = this.edgeKeyT(t); const st = HIGHWALLS[type] ? 0 : (t.st || 0);
      if (this.edges.get(ek(K.e, K.i, K.j, st))) return { ok: false, why: 'Occupied' };
      if (HIGHWALLS[type]) {
        const { edge, ci, cj } = t; const [[ai, aj], [bi, bj]] = this.edgeCells(edge, ci, cj); const [cx, cz] = this.edgeCenter(edge, ci, cj);
        if (this.found(ai, aj) || this.found(bi, bj) || this.triEdges.has(ek(edge, ci, cj, 0))) return { ok: false, why: 'Not on foundations' };
        for (const s of [-1.2, 0, 1.2]) { const px = edge === 'h' ? cx + s : cx, pz = edge === 'h' ? cz : cz + s; if (W.isWater(px, pz)) return { ok: false, why: 'In water' }; }
        if (this.blockedEdge(edge, ci, cj)) return { ok: false, why: 'Blocked' };
        if (owner === 'player') { const m = this.nearMonument(cx, cz, 6); if (m) return { ok: false, why: 'Too close to ' + m.name }; }
        return { ok: true };
      }
      if (st >= MAX_ST) return { ok: false, why: 'Too high (3 storeys max)' };
      const sup = this.edgeSupport(K.e, K.i, K.j, st);
      if (!sup.length) return { ok: false, why: st ? 'Needs a floor below' : 'Needs a foundation' };
      if (Math.max(...sup) - Math.min(...sup) > 1.7) return { ok: false, why: st ? 'Uneven floors' : 'Uneven foundations' };
      const base = Math.max(...sup) + FOUND_H + st * STOREY;
      if (K.e === 'd' ? this.blockedSeg(t.seg, base) : st > 0 ? this.blockedEdgeUp(K.e, K.i, K.j, base) : this.blockedEdge(K.e, K.i, K.j, true)) return { ok: false, why: 'Blocked' };
      return { ok: true };
    }
    if (DOORS[type]) {
      if (t.none || !t.piece) return { ok: false, why: DOORS[type].gate ? 'Needs a gateway in a high wall' : 'Needs an empty doorway' };
      return { ok: true };
    }
    if (DEPLOY[type]) {
      const D = DEPLOY[type]; const info = deployInfo(type);
      if (D.ladder) {
        if (t.none) return { ok: false, why: 'Look at a wall or a floor edge' };
        for (const d of this.deploys) if (d.type === 'ladder' && (d.x - t.x) ** 2 + (d.z - t.z) ** 2 < 0.8 * 0.8) return { ok: false, why: 'Too close' };
        if (G.phys.overlaps(t.x, t.z, 0.18, SOLIDB(t.y0 + 0.1))) return { ok: false, why: 'Blocked' };
        if (W.isWater(t.x, t.z) && t.y0 < 0.3) return { ok: false, why: 'In water' };
        return { ok: true };
      }
      if (D.unique && this.deploys.some(d => d.type === type && d.owner === owner)) return { ok: false, why: 'You already have one' };
      if (D.max && this.deploys.filter(d => d.type === type && d.owner === owner).length >= D.max) return { ok: false, why: 'Limit ' + D.max };
      const fy = this.floorY(t.x, t.z, t.y);
      if (W.isWater(t.x, t.z) && fy < 0.3) return { ok: false, why: 'In water' };
      if ((W.onRail && W.onRail(t.x, t.z, 2.2)) || (G.train && G.train.floorAt(t.x, t.z) !== null)) return { ok: false, why: 'Not on the railway' };
      if (type === 'tc' && !this.found(Math.floor(t.x / CELL), Math.floor(t.z / CELL)) && !(this.triAt(t.x, t.z) || {}).found) return { ok: false, why: 'Place it on a foundation' };
      const r = info.r || Math.max(info.w, info.d) / 2;
      if (info.solid !== false) {
        const hit = G.phys.overlaps(t.x, t.z, Math.min(r, 0.5) * 0.9, SOLIDB(fy + 0.05));
        if (hit) return { ok: false, why: 'Blocked' };
      }
      for (const d of this.deploys) if (Math.abs((d.y ?? fy) - fy) < 1.5 && (d.x - t.x) ** 2 + (d.z - t.z) ** 2 < (r + (d.r || 0.5)) ** 2 * 0.7) return { ok: false, why: 'Too close' };
      if (owner === 'player') { const m = this.nearMonument(t.x, t.z, 4); if (m) return { ok: false, why: 'Too close to ' + m.name }; }
      return { ok: true };
    }
    return { ok: false, why: '?' };
  },
  levelFor(ci, cj) {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.found(ci + di, cj + dj); if (n) {
        const lo = this.terrainRange(ci, cj);
        if (lo.max <= n.level + 0.35) { if (lo.min < n.level - 2.3) return { ok: false, why: 'Too steep' }; return { ok: true, level: n.level }; }
        // terrain rises: step this foundation up (stairs-like) if it isn't too far
        if (lo.max > n.level + 1.6) return { ok: false, why: 'Terrain too high' };
        if (lo.max - lo.min > 2.2) return { ok: false, why: 'Too steep' };
        return { ok: true, level: lo.max };
      }
    }
    const r = this.terrainRange(ci, cj);
    if (r.max - r.min > 2.2) return { ok: false, why: 'Too steep' };
    return { ok: true, level: r.max };
  },
  terrainRange(ci, cj) { let mn = 99, mx = -99; for (const [ox, oz] of [[0, 0], [3, 0], [0, 3], [3, 3], [1.5, 1.5], [1.5, 0], [0, 1.5], [3, 1.5], [1.5, 3]]) { const h = G.W.height(ci * CELL + ox, cj * CELL + oz); mn = Math.min(mn, h); mx = Math.max(mx, h); } return { min: mn, max: mx }; },
  nearMonument(x, z, pad) { for (const m of G.monuments) if ((m.x - x) ** 2 + (m.z - z) ** 2 < (m.size + pad) ** 2) return m; return null; },
  blockedArea(x, z, r) {
    let bad = false;
    G.phys.query(x - r, z - r, x + r, z + r, c => { if (c.kind === 'piece' || c.kind === 'door' || c.off) return; if (c.solid) { bad = true; return false; } });
    return bad;
  },
  /** something solid standing in a cell at floor height y (stairs need the cell clear) */
  blockedCell(ci, cj, y) {
    const x0 = ci * CELL + 0.2, z0 = cj * CELL + 0.2, x1 = x0 + CELL - 0.4, z1 = z0 + CELL - 0.4; let bad = false;
    G.phys.query(x0, z0, x1, z1, c => { if (c.off || !c.solid || c.kind === 'piece' || c.kind === 'door') return; if (!bandHit(c, y + 0.05)) return; bad = true; return false; });
    if (bad) return true;
    for (const a of G.actors) if (!a.dead && a.x > x0 && a.x < x1 && a.z > z0 && a.z < z1 && Math.abs((a.y ?? y) - y) < 1.5) return true;
    return false;
  },
  blockedEdge(e, i, j, onFound) {
    const [cx, cz] = this.edgeCenter(e, i, j); const hw = e === 'h' ? 1.4 : 0.12, hd = e === 'h' ? 0.12 : 1.4; let bad = false;
    G.phys.query(cx - hw, cz - hd, cx + hw, cz + hd, c => { if (c.off || !c.solid) return; if (c.ylo !== undefined && c.ylo > (c.y0 ?? 0) - 1) return; /* raised (upstairs) */ if (onFound && c.kind === 'deploy') { bad = true; return false; } if (c.kind === 'piece' || c.kind === 'door') return; bad = true; return false; });
    if (bad) return true;
    const lo = this.found(...this.edgeCells(e, i, j)[0]) || this.found(...this.edgeCells(e, i, j)[1]); const base = lo ? lo.level + FOUND_H : null;
    for (const a of G.actors) if (!a.dead && Math.abs(a.x - cx) < hw + a.r && Math.abs(a.z - cz) < hd + a.r && (base === null || Math.abs((a.y ?? base) - base) < 2)) return true;
    return false;
  },
  /** a triangle's off-grid edge: things standing on it at that height */
  blockedSeg(sg, y) {
    const a = [sg[0], sg[1]], b = [sg[2], sg[3]];
    for (const q of G.actors) if (!q.dead && segDist(q.x, q.z, a, b) < q.r + 0.12 && Math.abs((q.y ?? y) - y) < 1.4) return true;
    for (let k = 0; k <= 6; k++) { const x = a[0] + (b[0] - a[0]) * k / 6, z = a[1] + (b[1] - a[1]) * k / 6; if (G.phys.overlaps(x, z, 0.14, c => c.solid && !c.off && c.kind !== 'piece' && c.kind !== 'door' && bandHit(c, y + 0.05))) return true; }
    return false;
  },
  /** an edge upstairs: deployables and people standing on that floor */
  blockedEdgeUp(e, i, j, y) {
    const [cx, cz] = this.edgeCenter(e, i, j); const hw = e === 'h' ? 1.4 : 0.12, hd = e === 'h' ? 0.12 : 1.4; let bad = false;
    G.phys.query(cx - hw, cz - hd, cx + hw, cz + hd, c => { if (c.off || !c.solid || c.kind === 'piece' || c.kind === 'door') return; if (!bandHit(c, y + 0.05)) return; bad = true; return false; });
    if (bad) return true;
    for (const a of G.actors) if (!a.dead && Math.abs(a.x - cx) < hw + a.r && Math.abs(a.z - cz) < hd + a.r && Math.abs((a.y ?? 0) - y) < 1.4) return true;
    return false;
  },
  // ---------------------------------------------------------------- ladders
  /** a ladder placement along the player's view: the first edge ahead with a floor to climb onto */
  ladderTarget(p) {
    if (!p) return null;
    const yaw = p.yaw ?? p.ang, fx = Math.cos(yaw), fz = Math.sin(yaw);
    let pi = Math.floor(p.x / CELL), pj = Math.floor(p.z / CELL);
    for (let t = 0.15; t <= 3.6; t += 0.08) {
      const x = p.x + fx * t, z = p.z + fz * t; const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
      if (i === pi && j === pj) continue;
      if (i !== pi && j !== pj) { pi = i; pj = j; continue; } // a corner: no ladder there
      const spec = this.ladderSpec(pi, pj, i, j, x, z, p.y);
      if (spec) return spec;
      pi = i; pj = j;
    }
    return null;
  },
  /** ladder from cell A (climber side) onto a floor in cell B, crossing their shared edge near (x, z) */
  ladderSpec(ai, aj, bi, bj, x, z, py) {
    const fb = this.found(bi, bj); if (!fb) return null;
    const nx = bi - ai, nz = bj - aj; // unit normal A -> B
    const e = nx ? 'v' : 'h', ei = nx ? Math.max(ai, bi) : ai, ej = nz ? Math.max(aj, bj) : aj;
    const [ecx, ecz] = this.edgeCenter(e, ei, ej);
    // along the edge, snapped to 0.5 m and kept off the corners
    let along = nx ? z - (ecz - CELL / 2) : x - (ecx - CELL / 2); along = clamp(Math.round(along * 2) / 2, 0.5, CELL - 0.5);
    const lx = nx ? ecx - nx * 0.32 : ecx - CELL / 2 + along, lz = nx ? ecz - CELL / 2 + along : ecz - nz * 0.32;
    const footY = this.floorY(lx - nx * 0.15, lz - nz * 0.15, (py ?? 0) + 0.6);
    for (let s = 0; s < MAX_ST; s++) {
      if (!this.ceilAt(bi, bj, s)) continue;
      const top = fb.level + FOUND_H + (s + 1) * STOREY; const h = top - footY;
      if (h < 1.1) continue; if (h > 6.6) break;
      // the climber's side must be open from the foot to the top
      let open = true; for (let k = 0; k < MAX_ST; k++) { const q = this.ceilAt(ai, aj, k); if (!q) continue; const qt = this.found(ai, aj).level + FOUND_H + (k + 1) * STOREY; if (qt > footY + 0.5 && qt < top + 2) { open = false; break; } }
      if (!open) continue;
      // nothing blocking the step over the top
      const above = this.edge(e, ei, ej, s + 1); if (above && above.type !== 'doorway') continue;
      return { x: lx, z: lz, ry: Math.atan2(nz, nx), y0: footY, top, y: footY, e, ei, ej, st: s };
    }
    return null;
  },
  ladders() { return this.deploys.filter(d => d.type === 'ladder' && !d.dead); },
  ladderFoot(d, k = 0.45) { return { x: d.x - Math.cos(d.ry) * k, z: d.z - Math.sin(d.ry) * k }; },
  ladderExit(d) { return { x: d.x + Math.cos(d.ry) * 0.95, z: d.z + Math.sin(d.ry) * 0.95 }; },
  /** the player on a ladder (also grabs one you walk into). Returns true while the ladder holds you */
  climb(p, dt, Input) {
    let L = p.ladder;
    const mv = Input ? Input.moveVec() : { x: 0, y: 0 };
    if (!L) { // walk into the foot of a ladder, facing it, to grab on
      if (!(mv.y > 0.5) || p.vehicle || p.zip || p.airY > 0) return false;
      for (const d of this.deploys) {
        if (d.type !== 'ladder' || d.dead) continue;
        const f = this.ladderFoot(d, 0.4); if ((p.x - f.x) ** 2 + (p.z - f.z) ** 2 > 0.55 * 0.55 || Math.abs(p.y - d.state.y0) > 0.7) continue;
        if (Math.abs(angDiff(p.yaw ?? p.ang, d.ry)) > 0.9) continue;
        L = p.ladder = { d, y: clamp(p.y - d.state.y0, 0, 0.3) }; Sfx.tone && Sfx.tone(300, 0.05, 0.04, 'square'); break;
      }
      if (!L) return false;
    }
    const d = L.d;
    if (p.dead || p.vehicle || d.dead) { p.ladder = null; return false; }
    if (Input && Input.pressed.jump) { this.letGo(p); return false; }
    const h = d.state.top - d.state.y0;
    L.y = clamp(L.y + (mv.y || 0) * 2.5 * dt, 0, h);
    const fx = Math.cos(d.ry), fz = Math.sin(d.ry);
    p.x = d.x - fx * 0.14; p.z = d.z - fz * 0.14; p.y = d.state.y0 + L.y; p.airY = 0; p.vy = 0; p.speedNow = Math.abs(mv.y || 0) * 2;
    if ((L.step = (L.step || 0) - Math.abs(mv.y || 0) * dt) < 0) { L.step = 0.32; Sfx.tone && Sfx.tone(160 + Math.random() * 40, 0.04, 0.03, 'square'); }
    if (L.y >= h - 0.01 && (mv.y || 0) > 0.3) { const e = this.ladderExit(d); p.x = e.x; p.z = e.z; p.y = this.floorY(e.x, e.z, d.state.top + 0.4); p.ladder = null; return false; } // step off at the top
    if (L.y <= 0.01 && (mv.y || 0) < -0.3) { const f = this.ladderFoot(d, 0.75); p.x = f.x; p.z = f.z; p.y = this.floorY(f.x, f.z, d.state.y0 + 0.4); p.ladder = null; return false; }
    return true;
  },
  letGo(p) { const fy = this.floorY(p.x, p.z, p.y); p.airY = Math.max(0, p.y - fy); p.y = fy; p.vy = 0; p.ladder = null; },
  // ---------------------------------------------------------------- interactions (ladders, other people's boxes)
  interacts(p, push) {
    if (p.ladder) { push({ s: 0, kind: 'build', o: { act: 'letgo' }, label: 'Let go (jump)', icon: 'hand' }); return; }
    const yaw = p.yaw ?? p.ang;
    const score = (x, z, r) => { const d = dist(p.x, p.z, x, z); if (d > r) return null; const a = Math.abs(angDiff(yaw, Math.atan2(z - p.z, x - p.x))); if (a > 0.85 && d > 0.9) return null; return d * 0.6 + a * 1.6; };
    for (const d of this.deploys) {
      if (d.dead) continue;
      if (d.type === 'ladder') {
        const f = this.ladderFoot(d), e = this.ladderExit(d);
        if (Math.abs(p.y - d.state.y0) < 1.0) { const s = score(f.x, f.z, 1.3); if (s !== null) push({ s: s - 0.1, kind: 'build', o: { act: 'climb', d }, label: 'Climb the ladder', icon: 'hand' }); }
        else if (Math.abs(p.y - d.state.top) < 0.9) { const s = score(e.x, e.z, 1.4); if (s !== null || dist(p.x, p.z, e.x, e.z) < 0.8) push({ s: (s ?? 0.5) - 0.1, kind: 'build', o: { act: 'down', d }, label: 'Climb down the ladder', icon: 'hand' }); }
        continue;
      }
      if (d.owner === 'player' || !d.inv || !(d.type === 'box_small' || d.type === 'box_large' || d.type === 'tc')) continue;
      if (!d.bot && d.owner !== 'fort') continue;
      if (Math.abs((d.y ?? p.y) - p.y) > 1.7) continue;
      const s = score(d.x, d.z, (d.r || 0.5) + 1.5); if (s === null) continue;
      // no reaching through walls
      if (!G.phys.los(p.x, p.z, d.x, d.z, c => !c.off && (c.kind === 'piece' || c.kind === 'door') && bandHit(c, p.y + 0.1))) continue;
      push({ s, kind: 'build', o: { act: 'loot', d }, label: 'Open ' + this.ownerName(d) + (d.type === 'tc' ? ' Tool Cupboard' : ' box'), icon: d.type === 'tc' ? 'tc' : 'box' });
    }
  },
  ownerName(d) { const b = d.bot && G.bots ? G.bots.byOwner(d.owner) : null; return b ? b.name + '\'s' : d.owner === 'fort' ? 'the outlaws\'' : 'their'; },
  interact(p, o) {
    if (o.act === 'letgo') { this.letGo(p); return; }
    if (o.act === 'climb') { p.ladder = { d: o.d, y: clamp(p.y - o.d.state.y0, 0, 0.3) }; p.airY = 0; p.vy = 0; Sfx.tone && Sfx.tone(300, 0.05, 0.04, 'square'); return; }
    if (o.act === 'down') { p.ladder = { d: o.d, y: o.d.state.top - o.d.state.y0 - 0.05 }; p.airY = 0; p.vy = 0; return; }
    if (o.act === 'loot') {
      const d = o.d; if (d.dead || !d.inv) return;
      const b = d.bot && G.bots ? G.bots.byOwner(d.owner) : null;
      if (b && G.bots.onBaseLooted) G.bots.onBaseLooted(b, d, p);
      G.ui.openStorage(d, (b ? b.name + '\'s ' : '') + (DEPLOY[d.type] ? DEPLOY[d.type].name : 'Box'));
    }
  },
  // ---------------------------------------------------------------- costs
  costOf(type, tier) {
    if (PIECES[type]) { const c = scaleCost(TIER[tier].cost, PIECES[type].mult); return G.run && G.run.perks.includes('engineer') ? scaleCost(c, 0.8) : c; }
    if (HIGHWALLS[type]) return HIGHWALLS[type].cost;
    if (DOORS[type]) return DOORS[type].cost;
    if (DEPLOY[type]) return DEPLOY[type].cost;
    return {};
  },
  maxHp(type, tier) {
    const eng = G.run && G.run.perks.includes('engineer') ? 1.25 : 1;
    if (PIECES[type]) return Math.round(TIER[tier].hp * PIECES[type].hpMult * eng);
    if (HIGHWALLS[type]) return Math.round(HIGHWALLS[type].hp * eng);
    if (type === 'highgate') return Math.round(HIGHWALLS.highwall_wood.hp * 0.6 * eng);
    if (DEPLOY[type]) return DEPLOY[type].hp;
    return 100;
  },
  // ---------------------------------------------------------------- placing
  place(type, t, tier = 'twig', owner = 'player', opts = {}) {
    const chk = this.check(type, t, owner); if (!chk.ok && !opts.force) return null;
    if (DOORS[type]) return this.placeDoor(type, t.piece, owner, opts);
    if (DEPLOY[type]) return this.placeDeploy(type, t.x, t.z, t.ry || 0, owner, Object.assign({ y: t.y, state: DEPLOY[type].ladder ? { y0: t.y0, top: t.top } : undefined }, opts));
    if (PIECES[type] && PIECES[type].kind === 'tri') return this.placeTri(type, t, tier, owner, opts, chk);
    const st = HIGHWALLS[type] || type === 'foundation' ? 0 : clamp(t.st || 0, 0, MAX_ST - 1);
    const p = { id: PID++, sk: 'piece', type, tier: HIGHWALLS[type] ? HIGHWALLS[type].tier : tier, owner, ci: t.ci, cj: t.cj, edge: t.edge || null, st, placedAt: G.t, cols: [], mon: opts.mon || null };
    if (HIGHWALLS[type]) p.hw = type;
    p.maxhp = p.hp = this.maxHp(type, p.tier);
    if (type === 'foundation') { p.level = chk.level ?? opts.level ?? this.levelFor(t.ci, t.cj).level; const c = this.cells.get(ck(t.ci, t.cj)) || { found: null, ceil: null }; c.found = p; this.cells.set(ck(t.ci, t.cj), c); }
    else if (type === 'ceiling' || type === 'stairs') {
      const c = this.cell(t.ci, t.cj); if (!c || !c.found) return null;
      p.level = c.found.level; p.base = p.level + FOUND_H + st * STOREY;
      if (type === 'stairs') { p.dir = ((t.dir ?? 0) % 4 + 4) % 4; c[stairK(st)] = p; } else c[ceilK(st)] = p;
      c.up = true;
    } else {
      const K = this.edgeKeyT(t);
      if (HIGHWALLS[type]) { const [cx, cz] = this.edgeCenter(t.edge, t.ci, t.cj); p.level = Math.min(G.W.height(cx - (t.edge === 'h' ? 1.4 : 0), cz - (t.edge === 'v' ? 1.4 : 0)), G.W.height(cx + (t.edge === 'h' ? 1.4 : 0), cz + (t.edge === 'v' ? 1.4 : 0)), G.W.height(cx, cz)); p.base = p.level; }
      else {
        let sup = this.edgeSupport(K.e, K.i, K.j, st); if (!sup.length && opts.force) sup = this.edgeSupport(K.e, K.i, K.j, 0);
        if (!sup.length) { if (!opts.force || opts.level === undefined) return null; sup = [opts.level]; }
        p.level = Math.max(...sup); p.base = p.level + FOUND_H + st * STOREY;
      }
      if (K.e === 'd') { p.edge = 'd'; p.seg = t.seg.map(r3); p.mi = K.i; p.mj = K.j; const [mx, mz] = this.pieceXZ(p); p.ci = Math.floor(mx / CELL); p.cj = Math.floor(mz / CELL); }
      this.edges.set(ek(K.e, K.i, K.j, st), p);
    }
    this.makeColliders(p); this.makeMesh(p);
    this.dirty = true;
    return p;
  },
  placeTri(type, t, tier, owner, opts, chk) {
    const V = t.tri, key = triKey(V); let c = this.tcells.get(key);
    const st = type === 'tri_foundation' ? 0 : clamp(t.st || 0, 0, MAX_ST - 1);
    if (type === 'tri_foundation' ? c && c.found : c && c[ceilK(st)]) return null;
    let level = t.level ?? opts.level ?? (chk && chk.level);
    if (c) level = c.level; else if (level === undefined && type === 'tri_ceiling') level = this.triCeilSupport(V, st, key);
    if (level === undefined || level === null) return null;
    if (!c) c = this.addTriCell(V, level);
    const p = { id: PID++, sk: 'piece', type, tier, owner, ci: Math.floor(c.cx / CELL), cj: Math.floor(c.cz / CELL), edge: null, st, tk: key, verts: c.v, level: c.level, placedAt: G.t, cols: [], mon: opts.mon || null };
    p.maxhp = p.hp = this.maxHp(type, tier);
    if (type === 'tri_foundation') c.found = p; else { c[ceilK(st)] = p; p.base = c.level + FOUND_H + st * STOREY; }
    this.makeMesh(p); this.dirty = true;
    return p;
  },
  /** high wall edge converted to a gateway (gate hole) */
  placeGateway(t, stoneOrWood, owner = 'player') {
    const p = this.place(stoneOrWood === 'stone' ? 'highwall_stone' : 'highwall_wood', t, 'wood', owner); if (!p) return null;
    p.type = 'highgate'; this._rebuild(p); return p;
  },
  placeDoor(type, piece, owner = 'player', opts = {}) {
    if (DOORS[type].gate && piece.type !== 'highgate') { piece.type = 'highgate'; this._rebuild(piece); }
    const [cx, cz] = this.pieceXZ(piece);
    if (piece.edge === 'd') { // a doorway on a triangle's slanted edge: the door turns to match it
      const ang = Math.atan2(piece.seg[3] - piece.seg[1], piece.seg[2] - piece.seg[0]);
      if (opts.flip === undefined) { // lock side (model +Z, i.e. (-sin, cos)) toward the room: the nearest floored triangle
        let best = null, bd = 9;
        for (const c of this.trisNear(cx, cz)) { if (!c.found) continue; const dd = (c.cx - cx) ** 2 + (c.cz - cz) ** 2; if (dd < bd) { bd = dd; best = c; } }
        opts.flip = !!best && (-(best.cx - cx) * Math.sin(ang) + (best.cz - cz) * Math.cos(ang)) < 0;
      }
      const d = addDoor({ x: cx, z: cz, y: piece.base, ang, kind: type, owner, piece, flip: !!opts.flip });
      for (const c of d.cols) { c.ylo = piece.st ? piece.base - 0.05 : piece.base - 30; c.yhi = piece.base + STOREY; }
      if (G.run && G.run.perks.includes('engineer')) { d.hp = d.maxhp = Math.round(d.maxhp * 1.25); }
      piece.door = d; this.dirty = true; return d;
    }
    // the lock side (model +Z) should face the inside of the building
    if (opts.flip === undefined && piece.type !== 'highgate') {
      const [[ai, aj], [bi, bj]] = this.edgeCells(piece.edge, piece.ci, piece.cj); // a = north/west, b = south/east
      const s = piece.st || 0;
      const inside = (i, j) => { const c = this.cell(i, j); return c ? (c.found ? 1 : 0) + (c[ceilK(s)] ? 2 : 0) : 0; };
      const ia = inside(ai, aj), ib = inside(bi, bj);
      // default lock side: 'h' doors -> south (b); 'v' doors -> west (a)
      opts.flip = piece.edge === 'h' ? ia > ib : ib > ia;
    }
    const d = addDoor({ x: cx, z: cz, y: piece.type === 'highgate' ? piece.level : piece.base, axis: piece.edge === 'h' ? 'x' : 'z', kind: type, owner, piece, flip: opts.flip });
    if (G.run && G.run.perks.includes('engineer')) { d.hp = d.maxhp = Math.round(d.maxhp * 1.25); }
    if (d.col) { const b = piece.type === 'highgate' ? piece.level : piece.base; d.col.ylo = piece.st ? b - 0.05 : b - 30; d.col.yhi = b + (piece.hw ? 4.5 : STOREY); }
    piece.door = d; this.dirty = true; return d;
  },
  placeDeploy(type, x, z, ry = 0, owner = 'player', opts = {}) {
    const D = DEPLOY[type], info = deployInfo(type);
    const d = { id: PID++, sk: 'deploy', type, x, z, ry, owner, hp: D.hp, maxhp: D.hp, r: info.r || Math.max(info.w, info.d) / 2, mon: opts.mon || null, placedAt: G.t, state: {} };
    if (D.ladder) {
      const st = opts.state || {}; d.state.y0 = st.y0 ?? this.floorY(x, z, opts.y); d.state.top = st.top ?? d.state.y0 + STOREY; d.y = d.state.y0; d.r = 0.35;
    } else d.y = this.floorY(x, z, opts.y);
    if (D.slots) d.inv = new Inv(D.slots);
    if (D.oven) { d.inv = new Inv(OVENS[D.oven].slots); d.state.lit = false; d.state.prog = 0; }
    if (type === 'water_barrel') d.state.water = 40;
    if (type === 'tc' && owner === 'player') this.tc = d;
    if (owner.startsWith && owner.startsWith('bot:')) d.bot = owner;
    if (info.solid !== false && !D.ladder) {
      // upstairs things only block people up there; things on the ground block everyone below their top
      const raised = d.y > this.floorY(x, z) + 1.5;
      const band = c => { c.ylo = raised ? d.y - 0.05 : d.y - 30; c.yhi = d.y + Math.max(info.h || 1, 1.8); return c; };
      if (info.r) d.col = band(G.phys.addCircle(x, z, info.r, { h: info.h, kind: 'deploy', ref: d, opaque: info.h > 1.2, y0: d.y }));
      else { const rot = Math.abs(Math.round(ry / (Math.PI / 2))) % 2 === 1; const w = rot ? info.d : info.w, dd = rot ? info.w : info.d; d.col = band(G.phys.addBox(x - w / 2, z - dd / 2, x + w / 2, z + dd / 2, { h: info.h, kind: 'deploy', ref: d, opaque: info.h > 1.2, y0: d.y })); }
    }
    let obj = null;
    try { obj = D.ladder ? (Models && Models.makeLadder ? Models.makeLadder(d.state.top - d.state.y0) : null) : Models && Models.makeDeployable ? Models.makeDeployable(type) : null; } catch (e) { console.warn('makeDeployable', type, e); }
    if (!obj && D.ladder) { obj = new THREE.Group(); const hh = d.state.top - d.state.y0 + 0.5; for (const s of [-0.28, 0.28]) M.add(obj, M.box(0.06, hh, 0.06), M.surf('plank'), 0, hh / 2, s); for (let y = 0.3; y < hh; y += 0.3) M.add(obj, M.box(0.05, 0.05, 0.56), M.surf('plank'), 0, y, 0); }
    if (!obj) { obj = new THREE.Group(); M.add(obj, M.box(info.w || 0.8, info.h || 0.8, info.d || 0.8), M.surf('plank'), 0, (info.h || 0.8) / 2, 0); }
    obj.position.set(x, d.y, z); obj.rotation.y = -ry; G.cull.add(obj, x, z, D.ladder ? 'big' : 'mid'); d.mesh = obj;
    this.deploys.push(d); this.dirty = true;
    Home.onPlace(d, opts); // power sockets + cable id, planter plots, cooking pot
    return d;
  },
  makeColliders(p) {
    for (const c of p.cols) G.phys.remove(c); p.cols = [];
    if (p.type === 'foundation' || p.type === 'ceiling' || p.tk) return;
    const base = p.base ?? p.level, lo = p.st ? base - 0.05 : base - 30;
    if (p.edge === 'd') { // a slanted wall: a row of overlapping posts (the physics only has boxes and circles)
      const [x0, z0, x1, z1] = p.seg; const L = Math.hypot(x1 - x0, z1 - z0) || 1, ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      const run = (a, b, h, opaque = true) => { for (let u = a; u <= b + 1e-6; u += 0.28) { const c = G.phys.addCircle(x0 + ux * u, z0 + uz * u, 0.16, { h, kind: 'piece', ref: p, y0: base, opaque }); c.ylo = lo; c.yhi = base + (h > 2 ? STOREY : h); p.cols.push(c); } };
      switch (p.type) {
        case 'wall': run(0, CELL, WALL_H); break;
        case 'doorway': run(0, 0.84, WALL_H); run(2.16, CELL, WALL_H); break;
        case 'window': run(0, 0.9, WALL_H); run(2.1, CELL, WALL_H); run(1.0, 2.0, 1.0, false); break;
        case 'lowwall': run(0, CELL, 1.1, false); break;
      }
      return;
    }
    if (p.type === 'stairs') {
      // you get on at the low end only: the high end's underside and the sides block people at the bottom
      const [dx, dz] = DIRS[p.dir || 0]; const x0 = p.ci * CELL, z0 = p.cj * CELL, hi = base + 1.0;
      const seg = (u0, u1, w0, w1) => {
        let ax0, ax1, az0, az1;
        if (dx) { ax0 = dx > 0 ? x0 + u0 : x0 + CELL - u1; ax1 = dx > 0 ? x0 + u1 : x0 + CELL - u0; az0 = z0 + w0; az1 = z0 + w1; }
        else { az0 = dz > 0 ? z0 + u0 : z0 + CELL - u1; az1 = dz > 0 ? z0 + u1 : z0 + CELL - u0; ax0 = x0 + w0; ax1 = x0 + w1; }
        const c = G.phys.addBox(ax0, az0, ax1, az1, { h: hi - base, kind: 'piece', ref: p, y0: base, opaque: false }); c.ylo = lo; c.yhi = hi; p.cols.push(c);
      };
      seg(1.3, CELL, 0.06, CELL - 0.06); seg(0.9, 1.3, 0, 0.12); seg(0.9, 1.3, CELL - 0.12, CELL);
      return;
    }
    const [cx, cz] = this.edgeCenter(p.edge, p.ci, p.cj);
    const H = p.edge === 'h';
    const box = (a, b, th, o) => { // a..b along the edge (0..3), thickness th
      const s0 = (H ? cx : cz) - CELL / 2 + a, s1 = (H ? cx : cz) - CELL / 2 + b;
      o.y0 = base;
      const c = H ? G.phys.addBox(s0, cz - th / 2, s1, cz + th / 2, o) : G.phys.addBox(cx - th / 2, s0, cx + th / 2, s1, o);
      c.ref = p; c.ylo = p.hw ? base - 30 : lo; c.yhi = base + (o.band ?? o.h); p.cols.push(c); return c;
    };
    const t = 0.24, ext = 0.1;
    switch (p.type) {
      case 'wall': box(-ext, CELL + ext, t, { h: WALL_H, band: STOREY, kind: 'piece' }); break;
      case 'doorway': box(-ext, 0.9, t, { h: WALL_H, band: STOREY, kind: 'piece' }); box(2.1, CELL + ext, t, { h: WALL_H, band: STOREY, kind: 'piece' }); break;
      case 'window': box(-ext, 0.95, t, { h: WALL_H, band: STOREY, kind: 'piece' }); box(2.05, CELL + ext, t, { h: WALL_H, band: STOREY, kind: 'piece' }); box(0.95, 2.05, t, { h: 1.0, kind: 'piece', opaque: false }); break;
      case 'lowwall': box(-ext, CELL + ext, t, { h: 1.1, kind: 'piece', opaque: false }); break;
      case 'highwall_wood': case 'highwall_stone': box(-0.05, CELL + 0.05, 0.5, { h: 4.5, kind: 'piece' }); break;
      case 'highgate': box(-0.05, 0.15, 0.5, { h: 4.5, kind: 'piece' }); box(2.85, CELL + 0.05, 0.5, { h: 4.5, kind: 'piece' }); break;
    }
  },
  makeMesh(p) {
    if (p.mesh) { G.scene.remove(p.mesh); if (!noBake(p)) this.regionRemove(p); }
    let obj = null;
    const mtype = p.hw && p.type === 'highgate' ? 'highwall' : p.hw ? 'highwall' : p.type;
    const mtier = p.hw ? (p.hw === 'highwall_stone' ? 'stone' : 'wood') : p.tier;
    if (p.type !== 'highgate') { try { obj = Models && Models.makePiece ? Models.makePiece(mtype, mtier) : null; } catch (e) { obj = null; } }
    if (p.type === 'highgate') { // two tall posts framing the gate
      obj = new THREE.Group(); const stone = p.hw === 'highwall_stone'; const mat = M.surf(stone ? 'stone' : 'log', { cut: true });
      for (const sx of [-1.42, 1.42]) { M.add(obj, M.box(0.36, 6.2, 0.62), mat, sx, 1.6, 0); M.add(obj, stone ? M.box(0.5, 0.3, 0.75) : M.cone(0.26, 0.6, 6), mat, sx, 4.85, 0); }
    }
    if (!obj) obj = fallbackPiece(p.type, p.tier);
    if (p.tk) { // triangle: the model's first edge (local -Z side) goes on verts[0]-verts[1]
      const [cx, cz] = this.pieceXZ(p), v = p.verts; const ux = (v[0][0] + v[1][0]) / 2 - cx, uz = (v[0][1] + v[1][1]) / 2 - cz;
      obj.position.set(cx, p.type === 'tri_foundation' ? p.level : p.base, cz); obj.rotation.y = Math.atan2(-ux, -uz);
    } else if (p.type === 'foundation' || p.type === 'ceiling' || p.type === 'stairs') {
      obj.position.set(p.ci * CELL + CELL / 2, p.type === 'foundation' ? p.level : p.base ?? p.level + FOUND_H, p.cj * CELL + CELL / 2);
      if (p.type === 'stairs') obj.rotation.y = -Math.atan2(DIRS[p.dir || 0][1], DIRS[p.dir || 0][0]);
    } else {
      const [cx, cz] = this.pieceXZ(p);
      obj.position.set(cx, p.base, cz); obj.rotation.y = p.edge === 'd' ? -Math.atan2(p.seg[3] - p.seg[1], p.seg[2] - p.seg[0]) : p.edge === 'h' ? 0 : -Math.PI / 2;
    }
    obj.traverse(o => { o.userData.piece = p; });
    G.scene.add(obj); p.mesh = obj;
    if (!noBake(p)) this.regionAdd(p);
  },
  /** ghost / highlight pose for a build target */
  ghostPose(type, t) {
    if (t.none) return null;
    const segRy = sg => -Math.atan2(sg[3] - sg[1], sg[2] - sg[0]);
    if (t.tri) {
      const V = t.tri, cx = (V[0][0] + V[1][0] + V[2][0]) / 3, cz = (V[0][1] + V[1][1] + V[2][1]) / 3, ux = (V[0][0] + V[1][0]) / 2 - cx, uz = (V[0][1] + V[1][1]) / 2 - cz;
      return { x: cx, z: cz, y: type === 'tri_foundation' ? t.level : t.level + FOUND_H + (t.st || 0) * STOREY, ry: Math.atan2(-ux, -uz) };
    }
    if (t.piece && DOORS[type]) { const q = t.piece; const [x, z] = this.pieceXZ(q); return { x, z, y: q.type === 'highgate' ? q.level : q.base ?? q.level, ry: q.edge === 'd' ? segRy(q.seg) : q.edge === 'h' ? 0 : -Math.PI / 2 }; }
    if (t.edge && (PIECES[type] || HIGHWALLS[type])) {
      const [cx, cz] = t.edge === 'd' ? [(t.seg[0] + t.seg[2]) / 2, (t.seg[1] + t.seg[3]) / 2] : this.edgeCenter(t.edge, t.ci, t.cj); const ry = t.edge === 'd' ? segRy(t.seg) : t.edge === 'h' ? 0 : -Math.PI / 2;
      if (HIGHWALLS[type]) return { x: cx, z: cz, y: G.W.height(cx, cz), ry };
      const K = this.edgeKeyT(t), st = t.st || 0; let sup = this.edgeSupport(K.e, K.i, K.j, st); if (!sup.length) sup = this.edgeSupport(K.e, K.i, K.j, 0);
      return { x: cx, z: cz, y: sup.length ? Math.max(...sup) + FOUND_H + st * STOREY : G.W.height(cx, cz), ry };
    }
    if (PIECES[type] && PIECES[type].kind === 'cell') {
      const f = this.found(t.ci, t.cj); const x = t.ci * CELL + CELL / 2, z = t.cj * CELL + CELL / 2;
      if (type === 'foundation') { const lv = this.levelFor(t.ci, t.cj); return { x, z, y: lv.level ?? G.W.height(x, z), ry: 0 }; }
      const y = f ? f.level + FOUND_H + (t.st || 0) * STOREY : G.W.height(x, z);
      return { x, z, y, ry: type === 'stairs' ? -Math.atan2(DIRS[t.dir || 0][1], DIRS[t.dir || 0][0]) : 0 };
    }
    return null;
  },
  // ---------------------------------------------------------------- batching (merge piece meshes per 48 m region)
  regions: new Map(),
  regionKey(p) { return Math.floor(p.ci / 16) + ',' + Math.floor(p.cj / 16); },
  regionAdd(p) { const k = this.regionKey(p); let r = this.regions.get(k); if (!r) { r = { pieces: new Set(), baked: null, dirty: false, t: 0 }; this.regions.set(k, r); } r.pieces.add(p); this.regionDirty(r); },
  regionRemove(p) { const r = this.regions.get(this.regionKey(p)); if (!r) return; r.pieces.delete(p); this.regionDirty(r); },
  regionDirty(r) {
    if (!r.dirty) { r.dirty = true; if (r.baked) { G.scene.remove(r.baked); disposeBaked(r.baked); r.baked = null; } for (const q of r.pieces) if (q.mesh) q.mesh.visible = true; }
    r.t = 0;
  },
  tickRegions(dt) {
    for (const r of this.regions.values()) {
      if (!r.dirty) continue; r.t += dt; if (r.t < 0.45) continue;
      r.dirty = false; const objs = [...r.pieces].filter(q => !q.dead && q.mesh).map(q => q.mesh);
      if (objs.length < 3) continue; // not worth it
      r.baked = bakeObjects(objs); if (!r.baked) continue; G.scene.add(r.baked);
      for (const o of objs) o.visible = false;
    }
  },
  _rebuild(p) { this.makeColliders(p); this.makeMesh(p); this.dirty = true; },
  // ---------------------------------------------------------------- change
  upgrade(p, tier, silent) { p.tier = tier; p.maxhp = p.hp = this.maxHp(p.type, tier); this.makeMesh(p); this.dirty = true; if (!silent) Sfx.upgrade(); },
  repairCost(p) { const base = this.costOf(p.type, p.tier); return scaleCost(base, 0.5 * (1 - p.hp / p.maxhp)); },
  damage(p, amt) {
    if (p.dead) return;
    p.hp -= amt; p.hitT = 0.2; this.dirty = this.dirty || amt > 30;
    if (p.hp <= 0) this.destroy(p);
  },
  destroy(p, silent) {
    if (p.dead) return;
    const [px, pz] = p.mesh ? [p.mesh.position.x, p.mesh.position.z] : this.pieceXZ(p);
    if (!silent && G.fx) G.fx.debris(px, (p.base ?? p.level) + 1, pz, p.tier);
    if (!silent) Sfx.thud(px, pz);
    this._kill(p);
    // structural collapse: whatever stood on this piece goes with it
    const c = this.cell(p.ci, p.cj), st = p.st || 0;
    const sqKeys = (i, j) => [{ e: 'h', i, j }, { e: 'h', i, j: j + 1 }, { e: 'v', i, j }, { e: 'v', i: i + 1, j }];
    const triKeys = V => triEdgesOf(V).map(e => segKey(e.a[0], e.a[1], e.b[0], e.b[1]));
    // walls on these edges at storey s that nothing holds up any more
    const killEdges = (keys, s) => { for (const K of keys) { const ep = this.edges.get(ek(K.e, K.i, K.j, s)); if (ep && !ep.hw && !this.edgeSupport(K.e, K.i, K.j, s).length) this.destroy(ep, silent); } };
    // triangle floors hanging off these edges
    const hangers = (keys, s) => { for (const K of keys) { const ts = this.triEdges.get(ek(K.e, K.i, K.j, 0)); if (ts) for (const q of [...ts]) { const f = q[ceilK(s)]; if (f && !q.found && !(s > 0 && q[ceilK(s - 1)]) && this.triCeilSupport(q.v, s, q.key) === null) this.destroy(f, silent); } } };
    const inCell = d => Math.floor(d.x / CELL) === p.ci && Math.floor(d.z / CELL) === p.cj;
    if (p.type === 'foundation') {
      if (c) for (let s = 0; s < MAX_ST; s++) { if (c[ceilK(s)]) this.destroy(c[ceilK(s)], silent); if (c[stairK(s)]) this.destroy(c[stairK(s)], silent); }
      killEdges(sqKeys(p.ci, p.cj), 0);
      // deployables standing on it fall to the ground
      for (const d of [...this.deploys]) if (inCell(d)) this.dropDeploy(d);
    } else if (p.type === 'ceiling' || p.type === 'stairs') {
      // the floor above loses its support, and so do walls standing only on this floor
      if (c && st + 1 < MAX_ST) { const up = c[ceilK(st + 1)]; if (up && !c[ceilK(st)] && !c[stairK(st)]) this.destroy(up, silent); const us = c[stairK(st + 1)]; if (us && !c[ceilK(st)]) this.destroy(us, silent); }
      if (st + 1 < MAX_ST) killEdges(sqKeys(p.ci, p.cj), st + 1);
      if (p.type === 'ceiling') hangers(sqKeys(p.ci, p.cj), st);
      for (const d of [...this.deploys]) if (inCell(d) && d.y > p.base + 0.5) this.dropDeploy(d);
    } else if (p.type === 'tri_foundation') {
      const q = this.tcells.get(p.tk); if (q) for (let s = 0; s < MAX_ST; s++) if (q[ceilK(s)]) this.destroy(q[ceilK(s)], silent);
      killEdges(triKeys(p.verts), 0);
      for (const d of [...this.deploys]) if (inTri(p.verts, d.x, d.z)) this.dropDeploy(d);
    } else if (p.type === 'tri_ceiling') {
      const q = this.tcells.get(p.tk);
      if (q && st + 1 < MAX_ST && q[ceilK(st + 1)] && (q.found || this.triCeilSupport(q.v, st + 1, q.key) === null)) this.destroy(q[ceilK(st + 1)], silent);
      if (st + 1 < MAX_ST) killEdges(triKeys(p.verts), st + 1);
      hangers(triKeys(p.verts), st);
      for (const d of [...this.deploys]) if (inTri(p.verts, d.x, d.z) && d.y > p.base + 0.5) this.dropDeploy(d);
    }
  },
  /** a deployable whose floor went away falls to whatever is below (ladders just fall over) */
  dropDeploy(d) {
    if (d.dead) return;
    if (d.type === 'ladder') { this.removeDeploy(d); return; }
    const y = this.floorY(d.x, d.z, d.y - 0.5); if (Math.abs(y - d.y) < 0.05) return;
    d.y = y; if (d.mesh) d.mesh.position.y = d.y;
    if (d.col) { d.col.y0 = y; d.col.top = undefined; d.col.ylo = y > this.floorY(d.x, d.z) + 1.5 ? y - 0.05 : y - 30; d.col.yhi = y + Math.max(deployInfo(d.type).h || 1, 1.8); }
  },
  _kill(p, quiet) {
    p.dead = true;
    for (const c of p.cols) G.phys.remove(c); p.cols = [];
    if (p.mesh) G.scene.remove(p.mesh);
    if (!noBake(p)) this.regionRemove(p);
    if (p.door) { removeDoor(p.door); p.door = null; }
    const c = this.cell(p.ci, p.cj), st = p.st || 0;
    if (p.tk) { const q = this.tcells.get(p.tk); if (q) { if (p.type === 'tri_foundation') { if (q.found === p) q.found = null; } else if (q[ceilK(st)] === p) q[ceilK(st)] = null; this.dropTriCell(q); } }
    else if (p.type === 'foundation') { if (c && c.found === p) c.found = null; }
    else if (p.type === 'ceiling') { if (c && c[ceilK(st)] === p) c[ceilK(st)] = null; }
    else if (p.type === 'stairs') { if (c && c[stairK(st)] === p) c[stairK(st)] = null; }
    else { const k = this.edgeKeyOf(p); if (this.edges.get(k) === p) this.edges.delete(k); }
    this.dirty = true;
    if (!quiet && G.onPieceDestroyed) G.onPieceDestroyed(p);
  },
  removeDeploy(d, quiet) {
    if (d.dead) return; d.dead = true;
    if (d.col) G.phys.remove(d.col); if (d.mesh) d.mesh.removeFromParent();
    const i = this.deploys.indexOf(d); if (i >= 0) this.deploys.splice(i, 1);
    if (d === this.tc) this.tc = null;
    this.dirty = true; Home.onRemove(d);
    if (!quiet && G.onDeployDestroyed) G.onDeployDestroyed(d);
  },
  damageDeploy(d, amt) { if (d.dead) return; d.hp -= amt; d.hitT = 0.2; if (d.hp <= 0) { if (G.fx) G.fx.debris(d.x, d.y + 0.5, d.z, 'wood'); this.removeDeploy(d); } },
  // ---------------------------------------------------------------- base storage
  storages() { // TC + boxes inside privilege (player-owned)
    const out = []; if (!this.tc) return out; out.push(this.tc.inv);
    for (const d of this.deploys) if (d.owner === 'player' && d !== this.tc && d.inv && (d.type === 'box_small' || d.type === 'box_large') && this.inPrivilege(d.x, d.z)) out.push(d.inv);
    return out;
  },
  storageCount(id) { let n = 0; for (const v of this.storages()) n += v.count(id); return n; },
  storageTake(id, n) { let got = 0; for (const v of this.storages()) { if (got >= n) break; got += v.take(id, n - got); } return got; },
  wbTier(x, z) { let t = 0; for (const d of this.deploys) { const w = DEPLOY[d.type].wbTier; if (w && d.owner === 'player' && (d.x - x) ** 2 + (d.z - z) ** 2 < 9 * 9) t = Math.max(t, w); } return t; },
  /** under a roof? (y: someone standing at that height — a roof below you doesn't count) */
  isInside(x, z, y) {
    const c = this.cell(Math.floor(x / CELL), Math.floor(z / CELL)); if (!c || !c.found) return false;
    for (let s = 0; s < MAX_ST; s++) if (c[ceilK(s)] && (y === undefined || c.found.level + FOUND_H + (s + 1) * STOREY > y + 1)) return true;
    return false;
  },
  /** does a floor slab (square or triangle) cut the line between two points at different heights? (AI sight between storeys) */
  /** does a line cross a walking surface that isn't open ground (monument floors, decks, roofs, the ship, storeys)? */
  floorBetween(x0, z0, y0, x1, z1, y1) {
    if (Math.abs(y1 - y0) < 0.3) return false;
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.min(30, Math.ceil(L / 1.2)));
    let prevY = y0;
    for (let k = 1; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
      const g = G.W.height(x, z) + 0.3, below = this.floorY(x, z, prevY - 0.89), now = this.floorY(x, z, y - 0.89);
      if ((y < below - 0.02 && below > g) || (now > prevY + 0.02 && now > g)) return true; // down through a floor / up through a ceiling
      prevY = y;
    }
    return false;
  },
  slabBetween(x0, z0, y0, x1, z1, y1) {
    if (Math.abs(y1 - y0) < 0.3 || !(this.cells.size || this.tcells.size)) return false;
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / 0.6));
    for (let k = 0; k < n; k++) {
      const ya = y0 + (y1 - y0) * k / n, yb = y0 + (y1 - y0) * (k + 1) / n, lo = Math.min(ya, yb) - 0.05, hi = Math.max(ya, yb) + 0.05;
      const t = (k + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const c = this.cells.get(ck(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (c && c.found && c.up) { const B0 = c.found.level + FOUND_H; for (let s = 0; s < MAX_ST; s++) if (c[ceilK(s)]) { const top = B0 + (s + 1) * STOREY; if (top >= lo && top - 0.25 <= hi) return true; } }
      if (this.tcells.size) { const q = this.triAt(x, z); if (q) { const B0 = q.level + FOUND_H; for (let s = 0; s < MAX_ST; s++) if (q[ceilK(s)]) { const top = B0 + (s + 1) * STOREY; if (top >= lo && top - 0.25 <= hi) return true; } } }
    }
    return false;
  },
  // ---------------------------------------------------------------- upkeep
  /** everything a cupboard keeps from decaying: same owner, within range (doors and high walls too) */
  claimed(tc) {
    const out = []; const R2 = TC_RANGE * TC_RANGE;
    for (const p of this.allPieces()) {
      if (p.owner !== tc.owner || p.dead) continue;
      const [x, z] = this.pieceXZ(p); if ((x - tc.x) ** 2 + (z - tc.z) ** 2 > R2) continue;
      out.push(p);
    }
    return out;
  },
  /** upkeep of a cupboard: { perDay: {res: n}, pieces, lasts (days, Infinity if free), rate } */
  upkeep(tc) {
    const pieces = this.claimed(tc); const tot = {}; let n = 0;
    const add = (cost) => { for (const k in cost) tot[k] = (tot[k] || 0) + cost[k]; n++; };
    for (const p of pieces) {
      if (PIECES[p.type]) add(scaleCost(TIER[p.tier].cost, PIECES[p.type].mult)); else if (HIGHWALLS[p.hw || p.type]) add(HIGHWALLS[p.hw || p.type].cost);
      if (p.door && !p.door.dead && DOORS[p.door.kind]) add(DOORS[p.door.kind].cost);
    }
    // blended share: the first pieces are cheap, every extra one costs more
    let left = n, share = 0; for (const [k, r] of UPKEEP.brackets) { const m = Math.min(left, k); share += m * r; left -= m; if (left <= 0) break; }
    const rate = n ? share / n : 0; const perDay = {};
    for (const k in tot) { const v = tot[k] * rate; if (v > 0.05) perDay[k] = v; }
    let lasts = Infinity; for (const k in perDay) lasts = Math.min(lasts, (tc.inv ? tc.inv.count(k) : 0) / perDay[k]);
    return { perDay, pieces: n, lasts, rate };
  },
  /** charge every cupboard for the time that passed; pieces it can't pay for (or outside any claim) decay */
  tickUpkeep(step) {
    const clock = G.clock ?? 0; const prev = this._upkClock ?? clock; this._upkClock = clock;
    let days = ((clock - prev) % 1 + 1) % 1; if (days > 0.5) days = 0; // a big jump (load / skip) isn't charged
    const owners = new Map(); // owner -> list of cupboards
    for (const d of this.deploys) if (d.type === 'tc' && !d.dead && d.inv && (d.owner === 'player' || d.bot)) { if (!owners.has(d.owner)) owners.set(d.owner, []); owners.get(d.owner).push(d); }
    const unpaid = new Map(); // tc -> Set(res)
    for (const list of owners.values()) for (const tc of list) {
      const u = this.upkeep(tc); const acc = tc.state.upk || (tc.state.upk = {}); const miss = new Set();
      for (const k in u.perDay) {
        acc[k] = (acc[k] || 0) + u.perDay[k] * days; const want = Math.floor(acc[k]);
        if (want > 0) { const got = tc.inv.take(k, want); acc[k] -= got; if (got < want) { miss.add(k); acc[k] = Math.min(acc[k], u.perDay[k] * 0.25); } }
        if (tc.inv.count(k) <= 0 && u.perDay[k] >= 1) miss.add(k);
      }
      for (const k in acc) if (!u.perDay[k]) delete acc[k];
      tc.state.unpaid = [...miss]; tc.state.perDay = Object.fromEntries(Object.entries(u.perDay).map(([k, v]) => [k, Math.round(v)])); tc.state.lasts = Number.isFinite(u.lasts) ? Math.round(u.lasts * 10) / 10 : -1;
      unpaid.set(tc, miss);
    }
    // decay
    for (const p of this.allPieces()) {
      if (p.owner !== 'player' && !(p.owner && p.owner.startsWith && p.owner.startsWith('bot:'))) continue;
      if (G.t - p.placedAt < 90) continue;
      const [x, z] = this.pieceXZ(p); const tc = this.tcFor(p.owner, x, z);
      const miss = tc ? unpaid.get(tc) || NONE : null;
      const dr = p.door; if (dr && !dr.dead && (!tc || miss.has(TIER_RES[doorTier(dr.kind)]))) this.decayDoor(dr, step);
      if (tc && !miss.has(TIER_RES[p.tier] || 'wood')) continue;
      this.damage(p, p.maxhp * (DECAY[p.tier] || DECAY.wood) * step);
    }
    // ladders whose floor went away fall over
    for (const d of this.ladders()) { const e = this.ladderExit(d); if (Math.abs(this.floorY(e.x, e.z, d.state.top + 0.3) - d.state.top) > 0.4) this.removeDeploy(d); }
  },
  decayDoor(d, step) { d.hp -= d.maxhp * (DECAY[doorTier(d.kind)] || DECAY.wood) * step; if (d.hp <= 0) { removeDoor(d); if (d.piece) d.piece.door = null; this.dirty = true; } },
  // ---------------------------------------------------------------- tick
  tick(dt) {
    this.tickRegions(dt);
    this._decayT = (this._decayT || 0) + dt;
    if (this._decayT > 5) { const step = this._decayT; this._decayT = 0; this.tickUpkeep(step); }
    for (const d of this.deploys) {
      const D = DEPLOY[d.type];
      if (D.oven) this.tickOven(d, dt);
      if (d.mesh && d.mesh.userData) {
        if (d.mesh.userData.setLit) { const lit = isLit(d); if (d._litShown !== lit) { d.mesh.userData.setLit(lit); d._litShown = lit; } }
      }
    }
    Home.tick(dt); // electricity, crops, cooking pots (once a second)
  },
  tickOven(d, dt) {
    const O = OVENS[DEPLOY[d.type].oven]; const s = d.state;
    if (!s.lit) return;
    if (d.inv.count(O.fuel) <= 0) { s.lit = false; return; }
    s.fuelAcc = (s.fuelAcc || 0) + O.burn * dt;
    while (s.fuelAcc >= 1) { s.fuelAcc -= 1; d.inv.take(O.fuel, 1); if (d.type === 'furnace' || d.type === 'campfire') { if (Math.random() < 0.5) d.inv.add('charcoal', 1); } }
    s.prog = (s.prog || 0) + O.rate * dt;
    while (s.prog >= 1) {
      s.prog -= 1; let did = false;
      for (const k in O.cooks) { if (k === O.fuel) continue; if (d.inv.count(k) > 0 && d.inv.room(O.cooks[k]) > 0) { d.inv.take(k, 1); d.inv.add(O.cooks[k], 1); did = true; } }
      if (!did) { if (d.inv.count(O.fuel) === 0) s.lit = false; break; }
    }
  },
  /** dawn production (quarries, water; planters grow by themselves: farming.js) */
  dawn() {
    for (const d of this.deploys) {
      if (d.owner !== 'player') continue;
      const D = DEPLOY[d.type];
      if (d.type === 'water_barrel') d.state.water = Math.min(100, (d.state.water || 0) + 60);
      if (D.prod && d.type === 'quarry') { const inv = this.tc ? this.tc.inv : null; if (inv) for (const k in D.prod) inv.add(k, D.prod[k]); }
    }
  },
  // ---------------------------------------------------------------- raiding maths (bots plan raids with it)
  /** satchels needed to blow through one structure */
  satchelsFor(o) {
    const tier = o.sk === 'door' ? doorTier(o.kind) : o.tier; const per = 210 * (BOOM_MULT[tier] ?? 1) * 0.85; // satchel struct, minus some splash falloff
    return Math.max(1, Math.ceil((o.hp ?? 100) / per));
  },
  /** satchels to reach a cupboard along the cheapest path (the raider flow field) */
  raidCost(tc) {
    tc = tc || this.tc; if (!tc) return 0;
    const save = this.tc; this.tc = tc; const f = this.flowField(); this.tc = save; if (tc !== save) { this.ff = null; this.dirty = true; }
    if (!f) return 0;
    // walk the field in from 40 m out in eight directions; take the cheapest way in
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2; let x = tc.x + Math.cos(a) * 40, z = tc.z + Math.sin(a) * 40; const seen = new Set(); let n = 0;
      for (let step = 0; step < 120; step++) {
        const i = Math.floor(x) - f.ox, j = Math.floor(z) - f.oz; if (i < 1 || j < 1 || i >= f.S - 1 || j >= f.S - 1) break;
        const k0 = j * f.S + i; if (f.dist[k0] === 0) break; // at the cupboard
        const r = f.ref[k0]; if (r && !seen.has(r) && r !== tc) { seen.add(r); n += this.satchelsFor(r); }
        let bd = f.dist[k0], bi = 0, bj = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const d = f.dist[(j + dj) * f.S + i + di]; if (d < bd) { bd = d; bi = di; bj = dj; } }
        if (!bi && !bj) break; x += bi; z += bj;
      }
      if ((x - tc.x) ** 2 + (z - tc.z) ** 2 < 3.5 * 3.5 && n > 0) best = Math.min(best, n); // only probes that actually got in count (an open base costs nothing)
      else if ((x - tc.x) ** 2 + (z - tc.z) ** 2 < 3.5 * 3.5) best = 0;
    }
    return Number.isFinite(best) ? best : 3;
  },
  // ---------------------------------------------------------------- raider flow field
  /** Dijkstra from the Tool Cupboard over a 1 m grid; structure cells cost their HP */
  flowField() {
    if (!this.tc) { this.ff = null; return null; }
    if (!this.dirty && this.ff && this.ff.tcId === this.tc.id) return this.ff;
    if (this.ff && G.t - (this.ffT || -99) < 1.5 && this.ff.tcId === this.tc.id) return this.ff;
    this.dirty = false; this.ffT = G.t;
    const S = 150, half = S / 2; const ox = Math.floor(this.tc.x) - half, oz = Math.floor(this.tc.z) - half;
    const n = S * S; const cost = new Float32Array(n).fill(1); const ref = new Array(n).fill(null);
    // static obstacles (ground level only: walls upstairs don't stand in a raider's way)
    G.phys.query(ox, oz, ox + S, oz + S, c => {
      if (c.off) return;
      if (c.ylo !== undefined && c.y0 !== undefined && c.ylo > c.y0 - 1) return; // raised
      const isStruct = c.kind === 'piece' || c.kind === 'door' || (c.kind === 'deploy' && c.ref && c.ref.owner === this.tc.owner);
      if (!c.solid && !isStruct) return;
      const x0 = Math.max(0, Math.floor(c.minx - ox)), x1 = Math.min(S - 1, Math.floor(c.maxx - ox - 1e-3)), z0 = Math.max(0, Math.floor(c.minz - oz)), z1 = Math.min(S - 1, Math.floor(c.maxz - oz - 1e-3));
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const k = j * S + i;
        if (isStruct) { const o = c.ref; const hp = o.hp ?? 500; const v = 2 + hp / 5; if (cost[k] !== Infinity && v > cost[k]) { cost[k] = v; ref[k] = o; } }
        else { cost[k] = Infinity; ref[k] = null; }
      }
    });
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = j * S + i; if (cost[k] !== Infinity && !G.W.walkable(ox + i + 0.5, oz + j + 0.5)) cost[k] = Infinity; }
    const dist = new Float64Array(n).fill(Infinity); const heap = new Heap();
    const ti = Math.floor(this.tc.x) - ox, tj = Math.floor(this.tc.z) - oz;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const k = (tj + dj) * S + (ti + di); dist[k] = 0; heap.push(k, 0); }
    const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (heap.size) {
      const k = heap.pop(); const d0 = dist[k]; const i = k % S, j = (k / S) | 0;
      for (const [di, dj, w] of N8) {
        const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= S || nj >= S) continue;
        if (di && dj && (cost[j * S + ni] > 1.5 || cost[nj * S + i] > 1.5)) continue; // no corner cutting past walls
        const nk = nj * S + ni; const c = cost[nk]; if (c === Infinity) continue;
        const nd = d0 + w * c; if (nd < dist[nk]) { dist[nk] = nd; heap.push(nk, nd); }
      }
    }
    this.ff = { ox, oz, S, dist, ref, cost, tcId: this.tc.id };
    return this.ff;
  },
  /** next step for a raider at (x,z): {dx,dz, block: structure or null} */
  ffStep(x, z) {
    const f = this.flowField(); if (!f) return null;
    const i = Math.floor(x) - f.ox, j = Math.floor(z) - f.oz; if (i < 1 || j < 1 || i >= f.S - 1 || j >= f.S - 1) return null;
    const k0 = j * f.S + i; let best = f.dist[k0], bi = 0, bj = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const k = (j + dj) * f.S + (i + di); const d = f.dist[k];
      if (di && dj && (f.cost[j * f.S + i + di] > 1.5 || f.cost[(j + dj) * f.S + i] > 1.5)) continue;
      if (d < best) { best = d; bi = di; bj = dj; }
    }
    if (!bi && !bj) return { dx: 0, dz: 0, block: f.ref[k0] };
    const nk = (j + bj) * f.S + (i + bi);
    const blk = f.ref[nk] && !f.ref[nk].dead && !(f.ref[nk].col && f.ref[nk].col.off) ? f.ref[nk] : null;
    return { dx: bi, dz: bj, block: blk, tx: f.ox + i + bi + 0.5, tz: f.oz + j + bj + 0.5 };
  },
  /** follow the field up to n cells ahead while the path is free; returns {x,z} or null */
  ffAhead(x, z, n = 6) {
    let cx = x, cz = z, got = null;
    for (let i = 0; i < n; i++) { const s = this.ffStep(cx, cz); if (!s || s.block || (!s.dx && !s.dz)) break; cx = Math.floor(cx) + s.dx + 0.5; cz = Math.floor(cz) + s.dz + 0.5; got = { x: cx, z: cz }; }
    return got;
  },
  // ---------------------------------------------------------------- save / load
  serialize() {
    const pieces = [];
    const keep = o => o && o.owner !== 'fort' && o.owner !== 'mon';
    for (const p of this.allPieces()) if (keep(p)) pieces.push(sp(p));
    const deps = this.deploys.filter(keep).map(d => ({ type: d.type, owner: d.owner, x: d.x, z: d.z, y: d.y, ry: d.ry, hp: d.hp, inv: d.inv ? d.inv.toJSON() : null, state: d.state, lastSpawn: d.lastSpawn || 0 }));
    return { pieces, deps, upkClock: this._upkClock };
    function sp(p) { return { owner: p.owner, type: p.type, tier: p.tier, ci: p.ci, cj: p.cj, edge: p.edge, st: p.st || 0, dir: p.dir, tri: p.verts, seg: p.seg, hp: Math.round(p.hp), level: p.level, hw: p.hw || null, door: p.door ? { kind: p.door.kind, hp: Math.round(p.door.hp), flip: p.door.flip } : null }; }
  },
  restore(data) {
    if (!data) return;
    // supports first: foundations, then each storey's walls before the floors and stairs that rest on them
    const rank = s => s.type === 'foundation' || s.type === 'tri_foundation' ? 0 : (s.st || 0) * 3 + (s.type === 'ceiling' || s.type === 'stairs' || s.type === 'tri_ceiling' ? 2 : 1);
    const list = [...data.pieces].sort((a, b) => rank(a) - rank(b));
    for (const s of list) {
      let p;
      if (s.type === 'highgate') { p = this.place(s.hw || 'highwall_wood', { edge: s.edge, ci: s.ci, cj: s.cj }, 'wood', s.owner || 'player', { force: true }); if (p) { p.type = 'highgate'; this._rebuild(p); } }
      else p = this.place(s.hw || s.type, s.tri ? { tri: s.tri, level: s.level, st: s.st || 0 } : s.seg ? { edge: 'd', seg: s.seg, st: s.st || 0 } : { edge: s.edge, ci: s.ci, cj: s.cj, st: s.st || 0, dir: s.dir }, s.tier, s.owner || 'player', { force: true, level: s.level });
      if (!p) continue; if (s.type === 'foundation' && s.level !== undefined) { p.level = s.level; this.makeMesh(p); }
      p.hp = s.hp; p.placedAt = -999;
      if (s.door) { const d = this.placeDoor(s.door.kind, p, s.owner || 'player', { flip: s.door.flip }); d.hp = s.door.hp; }
    }
    for (const s of data.deps) {
      const d = this.placeDeploy(s.type, s.x, s.z, s.ry, s.owner || 'player', { y: s.y !== undefined ? s.y + 0.05 : undefined, state: s.state }); d.hp = s.hp; d.state = s.state || d.state; d.lastSpawn = s.lastSpawn || 0;
      if (s.inv && d.inv) d.inv = Inv.from(s.inv, d.inv.size);
    }
    if (data.upkClock !== undefined) this._upkClock = data.upkClock;
    this.dirty = true;
  },
};

export function deployInfo(type) {
  const info = Models && Models.DEPLOY_INFO && Models.DEPLOY_INFO[type];
  return info || FALLBACK_INFO[type] || { w: 1, d: 1, h: 1, solid: true };
}
const FALLBACK_INFO = {
  tc: { w: 0.9, d: 0.5, h: 1.8 }, sleeping_bag: { w: 0.9, d: 2.0, h: 0.2, solid: false }, campfire: { r: 0.6, h: 0.5, solid: false }, box_small: { w: 0.8, d: 0.5, h: 0.5 },
  box_large: { w: 1.5, d: 0.8, h: 0.8 }, furnace: { w: 1, d: 1, h: 1.4 }, workbench1: { w: 1.8, d: 0.9, h: 0.9 }, workbench2: { w: 2, d: 1, h: 1 }, workbench3: { w: 2.4, d: 1.2, h: 1.2 },
  research: { w: 1.5, d: 0.8, h: 1 }, recycler: { w: 1.6, d: 1.6, h: 1.8 }, bed: { w: 1.2, d: 2.2, h: 0.6 }, water_barrel: { r: 0.45, h: 1 }, planter: { w: 3, d: 1, h: 0.5 },
  lantern: { r: 0.2, h: 0.6, solid: false }, floodlight: { w: 0.6, d: 0.6, h: 2.5 }, spikes: { w: 3, d: 0.8, h: 0.6, solid: false }, landmine: { r: 0.25, h: 0.1, solid: false },
  shotgun_trap: { w: 0.6, d: 0.6, h: 0.8 }, auto_turret: { w: 0.8, d: 0.8, h: 1.2 }, quarry: { w: 2.4, d: 2.4, h: 2.6 }, ladder: { w: 0.2, d: 0.7, h: 3, solid: false },
};
function fallbackPiece(type, tier) {
  const g = new THREE.Group(); const s = { twig: 'twig', wood: 'plank', stone: 'stone', metal: 'corrugated', armored: 'armor' }[tier] || 'plank';
  const mat = M.surf(s, { cut: type !== 'foundation' });
  if (type === 'foundation') M.add(g, M.box(3, 2.6, 3), M.surf(s), 0, 0.6 - 1.3, 0);
  else if (type === 'ceiling') M.add(g, M.box(3, 0.2, 3), mat, 0, 2.7, 0);
  else if (type === 'tri_foundation' || type === 'tri_ceiling') M.add(g, M.cyl(1.73, 1.73, 0.2, 3), mat, 0, type === 'tri_foundation' ? 0.5 : 2.7, 0);
  else if (type === 'stairs') { for (let i = 0; i < 10; i++) M.add(g, M.box(0.3, 0.28 * (i + 1), 2.7), mat, -1.35 + i * 0.3, 0.14 * (i + 1), 0); }
  else if (type === 'lowwall') M.add(g, M.box(3, 1.1, 0.2), mat, 0, 0.55, 0);
  else if (type.startsWith('highwall') || type === 'highgate') M.add(g, M.box(3, 6, 0.5), mat, 0, 1.5, 0);
  else M.add(g, M.box(3, 2.6, 0.2), mat, 0, 1.3, 0);
  return g;
}
setOnDoorDestroyed(d => { if (d.piece) d.piece.door = null; Build.dirty = true; if (G.onDoorDestroyed) G.onDoorDestroyed(d); });
void TIERS; void ITEMS;

/** merge the meshes of several objects into one mesh per material */
function bakeObjects(objs) {
  const byMat = new Map();
  for (const root of objs) {
    const was = root.visible; root.visible = true; root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld); if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
      const m = o.material; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k) || (k === 'color' && !m.vertexColors)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(g);
    });
    root.visible = was;
  }
  const out = new THREE.Group(); out.name = 'baked-pieces';
  for (const [m, list] of byMat) {
    let merged = null; try { merged = mergeGeometries(list, false); } catch (e) { merged = null; }
    for (const g of list) g.dispose();
    if (!merged) { disposeBaked(out); return null; }
    const mesh = new THREE.Mesh(merged, m); mesh.castShadow = true; mesh.receiveShadow = true; out.add(mesh);
  }
  return out;
}
function disposeBaked(g) { g.traverse(o => { if (o.isMesh) o.geometry.dispose(); }); }
