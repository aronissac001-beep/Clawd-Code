// ============================================================================
// ZONEFALL 3 — Rust-style building. 3 m foundations on a global grid, walls /
// doorways / windows / low walls on cell edges, roofs on cells, high external
// walls + gates, free-placed deployables. Tiers twig→wood→stone→metal→armored.
// Also: Tool Cupboard privilege + decay, base storage, ovens, production,
// and the raider flow field (cheapest path to the Tool Cupboard).
// ============================================================================
import { THREE, M } from './gfx/materials.js';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { G } from './state.js';
import { CELL, FOUND_H, WALL_H, TIER, TIERS, PIECES, DOORS, HIGHWALLS, DEPLOY, TC_RANGE, OVENS, ITEMS } from './data.js';
import { Inv, scaleCost } from './inventory.js';
import { addDoor, removeDoor, setOnDoorDestroyed } from './doors.js';
import { Heap, clamp } from './util.js';
import { Sfx } from './audio.js';

let Models = null;
export function setBuildModels(m) { Models = m; }

let PID = 1;
const ek = (e, i, j) => e + ',' + i + ',' + j;
const ck = (i, j) => i + ',' + j;

export const Build = {
  cells: new Map(),   // "i,j" -> { found, ceil }
  edges: new Map(),   // "h|v,i,j" -> piece
  deploys: [],
  tc: null,
  dirty: true,        // flow field needs rebuild
  ff: null,
  reset() {
    for (const c of this.cells.values()) { if (c.found) this._kill(c.found, true); if (c.ceil) this._kill(c.ceil, true); }
    for (const p of [...this.edges.values()]) this._kill(p, true);
    for (const d of [...this.deploys]) this.removeDeploy(d, true);
    for (const r of this.regions.values()) if (r.baked) { G.scene.remove(r.baked); disposeBaked(r.baked); }
    this.regions.clear();
    this.cells.clear(); this.edges.clear(); this.deploys.length = 0; this.tc = null; this.dirty = true; this.ff = null;
  },
  // ---------------------------------------------------------------- queries
  cell(i, j) { return this.cells.get(ck(i, j)); },
  found(i, j) { const c = this.cells.get(ck(i, j)); return c ? c.found : null; },
  edge(e, i, j) { return this.edges.get(ek(e, i, j)); },
  /** cells adjacent to an edge */
  edgeCells(e, i, j) { return e === 'h' ? [[i, j - 1], [i, j]] : [[i - 1, j], [i, j]]; },
  edgeCenter(e, i, j) { return e === 'h' ? [i * CELL + CELL / 2, j * CELL] : [i * CELL, j * CELL + CELL / 2]; },
  /** visual floor height at a point: foundation top if standing on one */
  floorY(x, z, y) {
    const f = this.found(Math.floor(x / CELL), Math.floor(z / CELL));
    let t = G.W.height(x, z);
    if (G.train) { const ty = G.train.floorAt(x, z, y); if (ty !== null) t = Math.max(t, ty); }
    if (G.cargo) { const cy = G.cargo.floorAt(x, z, y); if (cy !== null) t = Math.max(t, cy); }
    if (G.infra) { const by = G.infra.floorAt(x, z, y); if (by !== null) t = Math.max(t, by); }
    if (G.floors && G.floorAt) { const my = G.floorAt(x, z, y); if (my !== null) t = Math.max(t, my); }
    if (G.decks) for (const d of G.decks) if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) { t = Math.max(t, d.y); break; }
    return f ? Math.max(t, f.level + FOUND_H) : t;
  },
  inPrivilege(x, z) { const t = this.tc; return !!t && (t.x - x) ** 2 + (t.z - z) ** 2 < TC_RANGE * TC_RANGE; },
  /** nearest edge to point (optionally only edges valid for type) */
  pickEdge(x, z, type) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL); const fx = x / CELL - i, fz = z / CELL - j;
    const cands = [['h', i, j, fz], ['h', i, j + 1, 1 - fz], ['v', i, j, fx], ['v', i + 1, j, 1 - fx]];
    cands.sort((a, b) => a[3] - b[3]);
    if (type) for (const c of cands) { if (this.check(type, { edge: c[0], ci: c[1], cj: c[2] }).ok) return { edge: c[0], ci: c[1], cj: c[2] }; }
    return { edge: cands[0][0], ci: cands[0][1], cj: cands[0][2] };
  },
  pickCell(x, z) { return { ci: Math.floor(x / CELL), cj: Math.floor(z / CELL) }; },
  /** world target for a build type at point x,z */
  target(type, x, z, ry = 0) {
    if (PIECES[type]) return PIECES[type].kind === 'cell' ? this.pickCell(x, z) : this.pickEdge(x, z, type);
    if (HIGHWALLS[type]) return this.pickEdge(x, z, type);
    if (DOORS[type]) {
      // nearest doorway (or highwall edge for gates) without a door
      const want = DOORS[type].gate ? 'highgate' : 'doorway';
      let best = null, bd = 9;
      for (const p of this.edges.values()) {
        if (p.door || p.owner !== 'player') continue;
        if (want === 'doorway' && p.type !== 'doorway') continue;
        if (want === 'highgate' && !p.hw) continue;
        const [cx, cz] = this.edgeCenter(p.edge, p.ci, p.cj); const d = (cx - x) ** 2 + (cz - z) ** 2; if (d < bd) { bd = d; best = p; }
      }
      return best ? { edge: best.edge, ci: best.ci, cj: best.cj, piece: best } : { none: true, x, z };
    }
    return { x: Math.round(x * 4) / 4, z: Math.round(z * 4) / 4, ry };
  },
  // ---------------------------------------------------------------- validation
  check(type, t, owner = 'player') {
    const W = G.W;
    if (PIECES[type] && PIECES[type].kind === 'cell') {
      const { ci, cj } = t; const c = this.cell(ci, cj);
      if (type === 'foundation') {
        if (c && c.found) return { ok: false, why: 'Occupied' };
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
      // ceiling
      if (!c || !c.found) return { ok: false, why: 'Needs a foundation' };
      if (c.ceil) return { ok: false, why: 'Occupied' };
      return { ok: true };
    }
    if ((PIECES[type] && PIECES[type].kind === 'edge') || HIGHWALLS[type]) {
      const { edge, ci, cj } = t; if (this.edge(edge, ci, cj)) return { ok: false, why: 'Occupied' };
      const [[ai, aj], [bi, bj]] = this.edgeCells(edge, ci, cj);
      const fa = this.found(ai, aj), fb = this.found(bi, bj);
      const [cx, cz] = this.edgeCenter(edge, ci, cj);
      if (HIGHWALLS[type]) {
        if (fa || fb) return { ok: false, why: 'Not on foundations' };
        for (const s of [-1.2, 0, 1.2]) { const px = edge === 'h' ? cx + s : cx, pz = edge === 'h' ? cz : cz + s; if (W.isWater(px, pz)) return { ok: false, why: 'In water' }; }
        if (this.blockedEdge(edge, ci, cj)) return { ok: false, why: 'Blocked' };
        if (owner === 'player') { const m = this.nearMonument(cx, cz, 6); if (m) return { ok: false, why: 'Too close to ' + m.name }; }
        return { ok: true };
      }
      if (!fa && !fb) return { ok: false, why: 'Needs a foundation' };
      if (fa && fb && Math.abs(fa.level - fb.level) > 1.7) return { ok: false, why: 'Uneven foundations' };
      if (this.blockedEdge(edge, ci, cj, true)) return { ok: false, why: 'Blocked' };
      return { ok: true };
    }
    if (DOORS[type]) {
      if (t.none || !t.piece) return { ok: false, why: DOORS[type].gate ? 'Needs a gateway in a high wall' : 'Needs an empty doorway' };
      return { ok: true };
    }
    if (DEPLOY[type]) {
      const D = DEPLOY[type]; const info = deployInfo(type);
      if (D.unique && this.deploys.some(d => d.type === type && d.owner === owner)) return { ok: false, why: 'You already have one' };
      if (D.max && this.deploys.filter(d => d.type === type && d.owner === owner).length >= D.max) return { ok: false, why: 'Limit ' + D.max };
      if (W.isWater(t.x, t.z)) return { ok: false, why: 'In water' };
      if ((W.onRail && W.onRail(t.x, t.z, 2.2)) || (G.train && G.train.floorAt(t.x, t.z) !== null)) return { ok: false, why: 'Not on the railway' };
      if (type === 'tc' && !this.found(Math.floor(t.x / CELL), Math.floor(t.z / CELL))) return { ok: false, why: 'Place it on a foundation' };
      const r = info.r || Math.max(info.w, info.d) / 2;
      if (info.solid !== false) {
        const hit = G.phys.overlaps(t.x, t.z, Math.min(r, 0.5) * 0.9);
        if (hit) return { ok: false, why: 'Blocked' };
      }
      for (const d of this.deploys) if ((d.x - t.x) ** 2 + (d.z - t.z) ** 2 < (r + (d.r || 0.5)) ** 2 * 0.7) return { ok: false, why: 'Too close' };
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
  blockedEdge(e, i, j, onFound) {
    const [cx, cz] = this.edgeCenter(e, i, j); const hw = e === 'h' ? 1.4 : 0.12, hd = e === 'h' ? 0.12 : 1.4; let bad = false;
    G.phys.query(cx - hw, cz - hd, cx + hw, cz + hd, c => { if (c.off || !c.solid) return; if (onFound && c.kind === 'deploy') { bad = true; return false; } if (c.kind === 'piece' || c.kind === 'door') return; bad = true; return false; });
    if (bad) return true;
    for (const a of G.actors) if (!a.dead && Math.abs(a.x - cx) < hw + a.r && Math.abs(a.z - cz) < hd + a.r) return true;
    return false;
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
    if (DEPLOY[type]) return this.placeDeploy(type, t.x, t.z, t.ry || 0, owner, opts);
    const p = { id: PID++, sk: 'piece', type, tier: HIGHWALLS[type] ? HIGHWALLS[type].tier : tier, owner, ci: t.ci, cj: t.cj, edge: t.edge || null, placedAt: G.t, cols: [], mon: opts.mon || null };
    if (HIGHWALLS[type]) p.hw = type;
    p.maxhp = p.hp = this.maxHp(type, p.tier);
    if (type === 'foundation') { p.level = chk.level ?? opts.level ?? this.levelFor(t.ci, t.cj).level; const c = this.cells.get(ck(t.ci, t.cj)) || { found: null, ceil: null }; c.found = p; this.cells.set(ck(t.ci, t.cj), c); }
    else if (type === 'ceiling') { const c = this.cell(t.ci, t.cj); p.level = c.found.level; c.ceil = p; }
    else {
      const [[ai, aj], [bi, bj]] = this.edgeCells(t.edge, t.ci, t.cj); const fa = this.found(ai, aj), fb = this.found(bi, bj);
      if (HIGHWALLS[type]) { const [cx, cz] = this.edgeCenter(t.edge, t.ci, t.cj); p.level = Math.min(G.W.height(cx - (t.edge === 'h' ? 1.4 : 0), cz - (t.edge === 'v' ? 1.4 : 0)), G.W.height(cx + (t.edge === 'h' ? 1.4 : 0), cz + (t.edge === 'v' ? 1.4 : 0)), G.W.height(cx, cz)); p.base = p.level; }
      else { if (!fa && !fb) return null; p.level = Math.max(fa ? fa.level : -99, fb ? fb.level : -99); p.base = p.level + FOUND_H; }
      this.edges.set(ek(t.edge, t.ci, t.cj), p);
    }
    this.makeColliders(p); this.makeMesh(p);
    this.dirty = true;
    return p;
  },
  /** high wall edge converted to a gateway (gate hole) */
  placeGateway(t, stoneOrWood, owner = 'player') {
    const p = this.place(stoneOrWood === 'stone' ? 'highwall_stone' : 'highwall_wood', t, 'wood', owner); if (!p) return null;
    p.type = 'highgate'; this._rebuild(p); return p;
  },
  placeDoor(type, piece, owner = 'player', opts = {}) {
    if (DOORS[type].gate && piece.type !== 'highgate') { piece.type = 'highgate'; this._rebuild(piece); }
    const [cx, cz] = this.edgeCenter(piece.edge, piece.ci, piece.cj);
    // the lock side (model +Z) should face the inside of the building
    if (opts.flip === undefined && piece.type !== 'highgate') {
      const [[ai, aj], [bi, bj]] = this.edgeCells(piece.edge, piece.ci, piece.cj); // a = north/west, b = south/east
      const inside = (i, j) => { const c = this.cell(i, j); return c ? (c.found ? 1 : 0) + (c.ceil ? 2 : 0) : 0; };
      const ia = inside(ai, aj), ib = inside(bi, bj);
      // default lock side: 'h' doors -> south (b); 'v' doors -> west (a)
      opts.flip = piece.edge === 'h' ? ia > ib : ib > ia;
    }
    const d = addDoor({ x: cx, z: cz, y: piece.type === 'highgate' ? piece.level : piece.base, axis: piece.edge === 'h' ? 'x' : 'z', kind: type, owner, piece, flip: opts.flip });
    if (G.run && G.run.perks.includes('engineer')) { d.hp = d.maxhp = Math.round(d.maxhp * 1.25); }
    piece.door = d; this.dirty = true; return d;
  },
  placeDeploy(type, x, z, ry = 0, owner = 'player', opts = {}) {
    const D = DEPLOY[type], info = deployInfo(type);
    const d = { id: PID++, sk: 'deploy', type, x, z, ry, owner, hp: D.hp, maxhp: D.hp, r: info.r || Math.max(info.w, info.d) / 2, mon: opts.mon || null, placedAt: G.t, state: {} };
    d.y = this.floorY(x, z);
    if (D.slots) d.inv = new Inv(D.slots);
    if (D.oven) { d.inv = new Inv(OVENS[D.oven].slots); d.state.lit = false; d.state.prog = 0; }
    if (type === 'planter') d.state.growth = 0;
    if (type === 'water_barrel') d.state.water = 40;
    if (type === 'tc' && owner === 'player') this.tc = d;
    if (owner.startsWith && owner.startsWith('bot:')) d.bot = owner;
    if (info.solid !== false) {
      if (info.r) d.col = G.phys.addCircle(x, z, info.r, { h: info.h, kind: 'deploy', ref: d, opaque: info.h > 1.2, y0: d.y });
      else { const rot = Math.abs(Math.round(ry / (Math.PI / 2))) % 2 === 1; const w = rot ? info.d : info.w, dd = rot ? info.w : info.d; d.col = G.phys.addBox(x - w / 2, z - dd / 2, x + w / 2, z + dd / 2, { h: info.h, kind: 'deploy', ref: d, opaque: info.h > 1.2, y0: d.y }); }
    }
    let obj = null; try { obj = Models && Models.makeDeployable ? Models.makeDeployable(type) : null; } catch (e) { console.warn('makeDeployable', type, e); }
    if (!obj) { obj = new THREE.Group(); M.add(obj, M.box(info.w || 0.8, info.h || 0.8, info.d || 0.8), M.surf('plank'), 0, (info.h || 0.8) / 2, 0); }
    obj.position.set(x, d.y, z); obj.rotation.y = -ry; G.cull.add(obj, x, z, 'mid'); d.mesh = obj;
    this.deploys.push(d); this.dirty = true;
    return d;
  },
  makeColliders(p) {
    for (const c of p.cols) G.phys.remove(c); p.cols = [];
    if (p.type === 'foundation' || p.type === 'ceiling') return;
    const [cx, cz] = this.edgeCenter(p.edge, p.ci, p.cj);
    const H = p.edge === 'h';
    const box = (a, b, th, o) => { // a..b along the edge (0..3), thickness th
      const s0 = (H ? cx : cz) - CELL / 2 + a, s1 = (H ? cx : cz) - CELL / 2 + b;
      o.y0 = p.base ?? p.level;
      const c = H ? G.phys.addBox(s0, cz - th / 2, s1, cz + th / 2, o) : G.phys.addBox(cx - th / 2, s0, cx + th / 2, s1, o);
      c.ref = p; p.cols.push(c); return c;
    };
    const t = 0.24, ext = 0.1;
    switch (p.type) {
      case 'wall': box(-ext, CELL + ext, t, { h: WALL_H, kind: 'piece' }); break;
      case 'doorway': box(-ext, 0.9, t, { h: WALL_H, kind: 'piece' }); box(2.1, CELL + ext, t, { h: WALL_H, kind: 'piece' }); break;
      case 'window': box(-ext, 0.95, t, { h: WALL_H, kind: 'piece' }); box(2.05, CELL + ext, t, { h: WALL_H, kind: 'piece' }); box(0.95, 2.05, t, { h: 1.0, kind: 'piece', opaque: false }); break;
      case 'lowwall': box(-ext, CELL + ext, t, { h: 1.1, kind: 'piece', opaque: false }); break;
      case 'highwall_wood': case 'highwall_stone': box(-0.05, CELL + 0.05, 0.5, { h: 4.5, kind: 'piece' }); break;
      case 'highgate': box(-0.05, 0.15, 0.5, { h: 4.5, kind: 'piece' }); box(2.85, CELL + 0.05, 0.5, { h: 4.5, kind: 'piece' }); break;
    }
  },
  makeMesh(p) {
    if (p.mesh) { G.scene.remove(p.mesh); if (p.type !== 'ceiling') this.regionRemove(p); }
    let obj = null;
    const mtype = p.hw && p.type === 'highgate' ? 'highwall' : p.hw ? 'highwall' : p.type;
    const mtier = p.hw ? (p.hw === 'highwall_stone' ? 'stone' : 'wood') : p.tier;
    if (p.type !== 'highgate') { try { obj = Models && Models.makePiece ? Models.makePiece(mtype, mtier) : null; } catch (e) { obj = null; } }
    if (p.type === 'highgate') { // two tall posts framing the gate
      obj = new THREE.Group(); const stone = p.hw === 'highwall_stone'; const mat = M.surf(stone ? 'stone' : 'log', { cut: true });
      for (const sx of [-1.42, 1.42]) { M.add(obj, M.box(0.36, 6.2, 0.62), mat, sx, 1.6, 0); M.add(obj, stone ? M.box(0.5, 0.3, 0.75) : M.cone(0.26, 0.6, 6), mat, sx, 4.85, 0); }
    }
    if (!obj) obj = fallbackPiece(p.type, p.tier);
    if (p.type === 'foundation' || p.type === 'ceiling') {
      obj.position.set(p.ci * CELL + CELL / 2, p.type === 'foundation' ? p.level : p.level + FOUND_H, p.cj * CELL + CELL / 2);
    } else {
      const [cx, cz] = this.edgeCenter(p.edge, p.ci, p.cj);
      obj.position.set(cx, p.base, cz); obj.rotation.y = p.edge === 'h' ? 0 : -Math.PI / 2;
    }
    obj.traverse(o => { o.userData.piece = p; });
    G.scene.add(obj); p.mesh = obj;
    if (p.type !== 'ceiling') this.regionAdd(p);
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
    if (!silent && G.fx) G.fx.debris(p.mesh ? p.mesh.position.x : 0, (p.base ?? p.level) + 1, p.mesh ? p.mesh.position.z : 0, p.tier);
    if (!silent) Sfx.thud(p.mesh ? p.mesh.position.x : 0, p.mesh ? p.mesh.position.z : 0);
    this._kill(p);
    // structural collapse: edges with no foundation left, ceilings on lost foundations, door in lost doorway
    if (p.type === 'foundation') {
      const c = this.cell(p.ci, p.cj); if (c && c.ceil) this.destroy(c.ceil, silent);
      for (const [e, i, j] of [['h', p.ci, p.cj], ['h', p.ci, p.cj + 1], ['v', p.ci, p.cj], ['v', p.ci + 1, p.cj]]) {
        const ep = this.edge(e, i, j); if (!ep || ep.hw) continue;
        const [[ai, aj], [bi, bj]] = this.edgeCells(e, i, j); if (!this.found(ai, aj) && !this.found(bi, bj)) this.destroy(ep, silent);
      }
      // deployables standing on it fall to the ground
      for (const d of this.deploys) if (Math.floor(d.x / CELL) === p.ci && Math.floor(d.z / CELL) === p.cj) { d.y = G.W.height(d.x, d.z); if (d.mesh) d.mesh.position.y = d.y; }
    }
  },
  _kill(p, quiet) {
    p.dead = true;
    for (const c of p.cols) G.phys.remove(c); p.cols = [];
    if (p.mesh) G.scene.remove(p.mesh);
    if (p.type !== 'ceiling') this.regionRemove(p);
    if (p.door) { removeDoor(p.door); p.door = null; }
    if (p.type === 'foundation') { const c = this.cell(p.ci, p.cj); if (c && c.found === p) c.found = null; }
    else if (p.type === 'ceiling') { const c = this.cell(p.ci, p.cj); if (c && c.ceil === p) c.ceil = null; }
    else this.edges.delete(ek(p.edge, p.ci, p.cj));
    this.dirty = true;
    if (!quiet && G.onPieceDestroyed) G.onPieceDestroyed(p);
  },
  removeDeploy(d, quiet) {
    if (d.dead) return; d.dead = true;
    if (d.col) G.phys.remove(d.col); if (d.mesh) d.mesh.removeFromParent();
    const i = this.deploys.indexOf(d); if (i >= 0) this.deploys.splice(i, 1);
    if (d === this.tc) this.tc = null;
    this.dirty = true;
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
  isInside(x, z) { const c = this.cell(Math.floor(x / CELL), Math.floor(z / CELL)); return !!(c && c.ceil); },
  // ---------------------------------------------------------------- tick
  tick(dt) {
    this.tickRegions(dt);
    // decay outside privilege (twig decays fast)
    this._decayT = (this._decayT || 0) + dt;
    if (this._decayT > 5) {
      const step = this._decayT; this._decayT = 0;
      const all = [...this.edges.values()]; for (const c of this.cells.values()) { if (c.found) all.push(c.found); if (c.ceil) all.push(c.ceil); }
      for (const p of all) {
        if (p.owner !== 'player') continue;
        const [x, z] = p.edge ? this.edgeCenter(p.edge, p.ci, p.cj) : [p.ci * CELL + 1.5, p.cj * CELL + 1.5];
        if (this.inPrivilege(x, z)) continue;
        const rate = p.tier === 'twig' ? 0.02 : 0.004; // fraction per second
        if (G.t - p.placedAt > 90) this.damage(p, p.maxhp * rate * step);
      }
    }
    for (const d of this.deploys) {
      const D = DEPLOY[d.type];
      if (D.oven) this.tickOven(d, dt);
      if (d.mesh && d.mesh.userData) {
        if (d.mesh.userData.setLit) { const lit = D.oven ? d.state.lit : true; if (d._litShown !== lit) { d.mesh.userData.setLit(lit); d._litShown = lit; } }
        if (d.mesh.userData.setGrowth && d.type === 'planter' && d._gShown !== d.state.growth) { d.mesh.userData.setGrowth(d.state.growth); d._gShown = d.state.growth; }
      }
    }
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
  /** dawn production (planters, quarries, water) */
  dawn() {
    for (const d of this.deploys) {
      if (d.owner !== 'player') continue;
      const D = DEPLOY[d.type];
      if (d.type === 'planter') d.state.growth = 1;
      if (d.type === 'water_barrel') d.state.water = Math.min(100, (d.state.water || 0) + 60);
      if (D.prod && d.type === 'quarry') { const inv = this.tc ? this.tc.inv : null; if (inv) for (const k in D.prod) inv.add(k, D.prod[k]); }
    }
  },
  // ---------------------------------------------------------------- raider flow field
  /** Dijkstra from the Tool Cupboard over a 1 m grid; structure cells cost their HP */
  flowField() {
    if (!this.tc) { this.ff = null; return null; }
    if (!this.dirty && this.ff) return this.ff;
    if (this.ff && G.t - (this.ffT || -99) < 1.5 && this.ff.tcId === this.tc.id) return this.ff;
    this.dirty = false; this.ffT = G.t;
    const S = 150, half = S / 2; const ox = Math.floor(this.tc.x) - half, oz = Math.floor(this.tc.z) - half;
    const n = S * S; const cost = new Float32Array(n).fill(1); const ref = new Array(n).fill(null);
    // static obstacles
    G.phys.query(ox, oz, ox + S, oz + S, c => {
      if (c.off) return;
      const isStruct = c.kind === 'piece' || c.kind === 'door' || (c.kind === 'deploy' && c.ref && c.ref.owner === 'player');
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
    for (const c of this.cells.values()) { if (keep(c.found)) pieces.push(sp(c.found)); if (keep(c.ceil)) pieces.push(sp(c.ceil)); }
    for (const p of this.edges.values()) if (keep(p)) pieces.push(sp(p));
    const deps = this.deploys.filter(keep).map(d => ({ type: d.type, owner: d.owner, x: d.x, z: d.z, ry: d.ry, hp: d.hp, inv: d.inv ? d.inv.toJSON() : null, state: d.state, lastSpawn: d.lastSpawn || 0 }));
    return { pieces, deps };
    function sp(p) { return { owner: p.owner, type: p.type, tier: p.tier, ci: p.ci, cj: p.cj, edge: p.edge, hp: Math.round(p.hp), level: p.level, hw: p.hw || null, door: p.door ? { kind: p.door.kind, hp: Math.round(p.door.hp), flip: p.door.flip } : null }; }
  },
  restore(data) {
    if (!data) return;
    const order = { foundation: 0, ceiling: 2 };
    const list = [...data.pieces].sort((a, b) => (order[a.type] ?? 1) - (order[b.type] ?? 1));
    for (const s of list) {
      let p;
      if (s.type === 'highgate') { p = this.place(s.hw || 'highwall_wood', { edge: s.edge, ci: s.ci, cj: s.cj }, 'wood', s.owner || 'player', { force: true }); if (p) { p.type = 'highgate'; this._rebuild(p); } }
      else p = this.place(s.hw || s.type, { edge: s.edge, ci: s.ci, cj: s.cj }, s.tier, s.owner || 'player', { force: true, level: s.level });
      if (!p) continue; if (s.type === 'foundation' && s.level !== undefined) { p.level = s.level; this.makeMesh(p); }
      p.hp = s.hp; p.placedAt = -999;
      if (s.door) { const d = this.placeDoor(s.door.kind, p, s.owner || 'player', { flip: s.door.flip }); d.hp = s.door.hp; }
    }
    for (const s of data.deps) {
      const d = this.placeDeploy(s.type, s.x, s.z, s.ry, s.owner || 'player'); d.hp = s.hp; d.state = s.state || d.state; d.lastSpawn = s.lastSpawn || 0;
      if (s.inv && d.inv) d.inv = Inv.from(s.inv, d.inv.size);
    }
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
  shotgun_trap: { w: 0.6, d: 0.6, h: 0.8 }, auto_turret: { w: 0.8, d: 0.8, h: 1.2 }, quarry: { w: 2.4, d: 2.4, h: 2.6 },
};
function fallbackPiece(type, tier) {
  const g = new THREE.Group(); const s = { twig: 'twig', wood: 'plank', stone: 'stone', metal: 'corrugated', armored: 'armor' }[tier] || 'plank';
  const mat = M.surf(s, { cut: type !== 'foundation' });
  if (type === 'foundation') M.add(g, M.box(3, 2.6, 3), M.surf(s), 0, 0.6 - 1.3, 0);
  else if (type === 'ceiling') M.add(g, M.box(3, 0.2, 3), mat, 0, 2.7, 0);
  else if (type === 'lowwall') M.add(g, M.box(3, 1.1, 0.2), mat, 0, 0.55, 0);
  else if (type.startsWith('highwall') || type === 'highgate') M.add(g, M.box(3, 6, 0.5), mat, 0, 1.5, 0);
  else M.add(g, M.box(3, 2.6, 0.2), mat, 0, 1.3, 0);
  return g;
}
setOnDoorDestroyed(d => { if (d.piece) d.piece.door = null; Build.dirty = true; if (G.onDoorDestroyed) G.onDoorDestroyed(d); });
void clamp; void TIERS; void ITEMS;

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
