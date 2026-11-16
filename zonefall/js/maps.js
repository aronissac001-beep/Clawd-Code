'use strict';
// ============================================================================
// ZONEFALL — maps: tile grid, objects, procedural Zone + home base generation,
// line of sight and the raider flow field.
// ============================================================================

const T = { GROUND: 0, WALL: 1, WATER: 2, FLOOR: 3, FENCE: 4, KEYDOOR: 5, ROAD: 6, CONCRETE: 7 };
const SOLID_T = new Uint8Array(8); SOLID_T[T.WALL] = SOLID_T[T.WATER] = SOLID_T[T.FENCE] = SOLID_T[T.KEYDOOR] = 1;
const OPAQUE_T = new Uint8Array(8); OPAQUE_T[T.WALL] = OPAQUE_T[T.KEYDOOR] = 1;

class GameMap {
  constructor(w, h, kind) {
    this.w = w; this.h = h; this.kind = kind;
    this.tiles = new Uint8Array(w * h);
    this.indoor = new Uint8Array(w * h);
    this.reserved = new Uint8Array(w * h);
    this.seen = new Uint8Array(w * h);
    this.objs = []; this.ogrid = new Array(w * h);
    this.containers = []; this.anoms = []; this.radZones = []; this.extracts = []; this.keydoors = [];
    this.groups = []; this.spawn = { x: w * TILE / 2, y: h * TILE / 2 };
    this.struct = null; this.ground = null;
    this.wkind = new Uint8Array(w * h); this.fkind = new Uint8Array(w * h); this.roofs = []; this.groundItems = [];
  }
  idx(tx, ty) { return ty * this.w + tx; }
  inb(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  t(tx, ty) { return this.inb(tx, ty) ? this.tiles[ty * this.w + tx] : T.WALL; }
  set(tx, ty, v) { if (this.inb(tx, ty)) this.tiles[ty * this.w + tx] = v; }
  st(tx, ty) { return this.struct && this.inb(tx, ty) ? this.struct[ty * this.w + tx] : null; }
  // movement blocking for a given mover ('player' passes doors)
  blocked(tx, ty, who) {
    if (!this.inb(tx, ty)) return true;
    const i = ty * this.w + tx;
    if (SOLID_T[this.tiles[i]]) return true;
    if (this.struct) {
      const s = this.struct[i];
      if (s) { const d = STRUCTS[s.type]; if (d.block && !(d.door && who === 'player')) return true; }
    }
    return false;
  }
  opaqueAt(tx, ty) {
    if (!this.inb(tx, ty)) return true;
    const i = ty * this.w + tx;
    if (OPAQUE_T[this.tiles[i]]) return true;
    if (this.struct) { const s = this.struct[i]; if (s && STRUCTS[s.type].opaque) return true; }
    return false;
  }
  // bullets: returns true if bullet stops at this tile
  bulletBlock(tx, ty) { return this.opaqueAt(tx, ty); }
  addObj(o) {
    if (o.v === undefined) o.v = (Math.random() * 97) | 0;
    this.objs.push(o);
    this.forObjTiles(o, i => { (this.ogrid[i] || (this.ogrid[i] = [])).push(o); });
    return o;
  }
  removeObj(o) {
    o.dead = true;
    this.forObjTiles(o, i => { const a = this.ogrid[i]; if (a) { const k = a.indexOf(o); if (k >= 0) a.splice(k, 1); } });
    const k = this.objs.indexOf(o); if (k >= 0) this.objs.splice(k, 1);
  }
  forObjTiles(o, fn) {
    const x0 = Math.floor((o.x - o.r) / TILE), x1 = Math.floor((o.x + o.r) / TILE);
    const y0 = Math.floor((o.y - o.r) / TILE), y1 = Math.floor((o.y + o.r) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.inb(x, y)) fn(y * this.w + x);
  }
  objsNear(x, y) { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE); return this.inb(tx, ty) ? (this.ogrid[ty * this.w + tx] || []) : []; }
  // tile-stepping line of sight
  los(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1); const steps = Math.ceil(d / (TILE * 0.4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps; const tx = Math.floor((x0 + (x1 - x0) * t) / TILE), ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
      if (this.opaqueAt(tx, ty)) return false;
    }
    return true;
  }
  isIndoor(x, y) { const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE); return this.inb(tx, ty) && this.indoor[ty * this.w + tx] === 1; }
  freeTile(tx, ty, pad = 0) {
    for (let y = ty - pad; y <= ty + pad; y++) for (let x = tx - pad; x <= tx + pad; x++) {
      if (!this.inb(x, y)) return false;
      const i = y * this.w + x; if (this.reserved[i] || SOLID_T[this.tiles[i]] || (this.ogrid[i] && this.ogrid[i].length)) return false;
    }
    return true;
  }
  reserveRect(x, y, w, h, pad = 1) {
    for (let j = y - pad; j < y + h + pad; j++) for (let i = x - pad; i < x + w + pad; i++) if (this.inb(i, j)) this.reserved[j * this.w + i] = 1;
  }
  rectFree(x, y, w, h, pad = 1) {
    if (x - pad < 2 || y - pad < 2 || x + w + pad > this.w - 2 || y + h + pad > this.h - 2) return false;
    for (let j = y - pad; j < y + h + pad; j++) for (let i = x - pad; i < x + w + pad; i++) {
      const k = j * this.w + i; if (this.reserved[k] || this.tiles[k] === T.WATER) return false;
    }
    return true;
  }
  addContainer(type, x, y, lootKey) {
    const c = { type, x, y, items: null, loot: lootKey || CONTAINERS[type].loot, searched: 0, broken: false, r: 11 };
    this.containers.push(c); return c;
  }
}

// ---------------------------------------------------------------------------
// LOOT ROLLING
// ---------------------------------------------------------------------------
function makeItem(id, n = 1) {
  const it = { id, n };
  if (WEAPONS[id]) it.m = Math.random() < 0.5 ? 0 : randi(0, WEAPONS[id].mag);
  return it;
}
function rollLoot(key, bonus = 0) {
  const t = LOOT[key]; if (!t) return [];
  const out = []; let rolls = randi(t.rolls[0], t.rolls[1]) + bonus;
  if (Game.hasPerk && Game.hasPerk('scavenger') && rolls > 0) rolls++;
  for (let i = 0; i < rolls; i++) {
    let [id, , a, b] = weighted(t.items);
    if (id === 'bp_t1' || id === 'bp_t2' || id === 'bp_t3') id = pick(BP_BY_TIER[+id[4]]);
    if (id === 'art_any') id = pick(ART_IDS);
    const n = randi(a, b);
    const ex = out.find(o => o.id === id && ITEMS[id].stack > 1);
    if (ex) ex.n = Math.min(ITEMS[id].stack, ex.n + n); else out.push(makeItem(id, n));
  }
  return out;
}

// ---------------------------------------------------------------------------
// ZONE GENERATION
// ---------------------------------------------------------------------------
function genZone(zone) {
  const S = zone.size; const m = new GameMap(S, S, 'zone'); m.zone = zone;
  // water ponds
  const ponds = randi(1, 3);
  for (let p = 0; p < ponds; p++) blob(m, randi(8, S - 8), randi(8, S - 8), randi(3, 6), T.WATER);
  // roads
  if (zone.roads) {
    const hy = randi(Math.floor(S * 0.3), Math.floor(S * 0.7)); road(m, 0, hy, S - 1, hy + randi(-6, 6));
    const vx = randi(Math.floor(S * 0.3), Math.floor(S * 0.7)); road(m, vx, 0, vx + randi(-6, 6), S - 1);
  }
  // player spawn and extracts on edges (decided early so monuments avoid them)
  const sides = shuffle([0, 1, 2, 3]);
  const edgePt = side => {
    const a = randi(8, S - 9);
    return side === 0 ? { tx: a, ty: 3 } : side === 1 ? { tx: S - 4, ty: a } : side === 2 ? { tx: a, ty: S - 4 } : { tx: 3, ty: a };
  };
  const sp = edgePt(sides[0]);
  m.spawn = { x: sp.tx * TILE + 16, y: sp.ty * TILE + 16 };
  m.reserveRect(sp.tx - 3, sp.ty - 3, 7, 7, 0);
  const exNames = ['Old Rail Tunnel', 'Collapsed Bridge', 'Smuggler Path', 'Drainage Pipe', 'Checkpoint Gap', 'Ridge Trail'];
  shuffle(exNames);
  for (let i = 1; i <= 2 + (zone.tier >= 3 ? 1 : 0) && i < 4; i++) {
    const e = edgePt(sides[i]); clearArea(m, e.tx, e.ty, 3);
    m.extracts.push({ x: e.tx * TILE + 16, y: e.ty * TILE + 16, r: 56, name: exNames[i] });
    m.reserveRect(e.tx - 3, e.ty - 3, 7, 7, 0);
  }
  // monument
  if (zone.monument) buildMonument(m, zone);
  if (zone.prefabs) placePrefabs(m, zone.prefabs);
  // houses / sheds
  const lootW = Object.entries(zone.loot).map(([k, w]) => [k, w]);
  for (let i = 0, tries = 0; i < zone.houses && tries < 400; tries++) {
    const w = randi(7, 11), h = randi(6, 9), x = randi(3, S - w - 3), y = randi(3, S - h - 3);
    if (!m.rectFree(x, y, w, h, 2)) continue;
    buildHouse(m, x, y, w, h, lootW, randi(1, 3)); i++;
  }
  for (let i = 0, tries = 0; i < zone.sheds && tries < 300; tries++) {
    const w = randi(4, 5), h = randi(4, 5), x = randi(3, S - w - 3), y = randi(3, S - h - 3);
    if (!m.rectFree(x, y, w, h, 2)) continue;
    buildHouse(m, x, y, w, h, lootW, 1, true); i++;
  }
  // nature
  scatterNature(m, zone.trees, zone.rocks, zone.ores, zone.tier, zone.treeKinds);
  // wrecks along roads
  for (let i = 0; i < 8; i++) {
    const tx = randi(4, S - 5), ty = randi(4, S - 5);
    if (m.t(tx, ty) === T.ROAD && m.freeTile(tx, ty, 1)) { m.addObj({ type: 'car', x: tx * TILE + 16, y: ty * TILE + 16, r: 20, solid: true, cover: 18 }); m.reserveRect(tx - 1, ty - 1, 3, 3, 0); }
  }
  // barrels and outdoor crates
  placeOutdoor(m, 'barrel', zone.barrels);
  placeOutdoor(m, 'crate', Math.floor(zone.crates / 2));
  placeOutdoor(m, 'cache', zone.caches, true);
  // anomalies with artifacts
  for (let i = 0; i < zone.anomalies; i++) {
    const p = freeSpot(m, 2); if (!p) continue;
    const kind = pick(['burner', 'gravity', 'electro']);
    const artChance = 0.35 + zone.tier * 0.12;
    m.anoms.push({ x: p.x, y: p.y, r: 46 + randi(0, 20), kind, art: chance(artChance) ? pick(ART_IDS) : null, cd: 0, ph: Math.random() * 6 });
    m.reserveRect(Math.floor(p.x / TILE) - 2, Math.floor(p.y / TILE) - 2, 5, 5, 0);
  }
  // radiation pockets
  for (let i = 0; i < zone.rads; i++) {
    const p = freeSpot(m, 0, true); if (!p) continue;
    m.radZones.push({ x: p.x, y: p.y, r: randi(90, 170), pow: zone.radPow });
  }
  // enemy groups (away from player spawn)
  for (const [type, groups, [a, b]] of zone.spawns) {
    for (let g = 0; g < groups; g++) {
      let p = null;
      for (let k = 0; k < 40; k++) { const q = freeSpot(m, 0, true); if (q && dist(q.x, q.y, m.spawn.x, m.spawn.y) > 700) { p = q; break; } }
      if (p) m.groups.push({ type, x: p.x, y: p.y, n: randi(a, b) });
    }
  }
  return m;
}

function blob(m, cx, cy, r, tile) {
  for (let y = cy - r - 2; y <= cy + r + 2; y++) for (let x = cx - r - 2; x <= cx + r + 2; x++) {
    const d = Math.hypot(x - cx, y - cy) + Math.sin(x * 1.7 + y) * 0.8;
    if (d < r && m.inb(x, y) && x > 1 && y > 1 && x < m.w - 2 && y < m.h - 2) m.set(x, y, tile);
  }
}
function road(m, x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(lerp(x0, x1, i / n)), y = Math.round(lerp(y0, y1, i / n));
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (m.inb(x + a, y + b) && m.t(x + a, y + b) !== T.WALL) m.set(x + a, y + b, T.ROAD);
  }
}
function clearArea(m, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (m.inb(x, y) && m.t(x, y) === T.WATER) m.set(x, y, T.GROUND);
}
function freeSpot(m, pad = 0, allowReservedOutdoor = false) {
  for (let k = 0; k < 200; k++) {
    const tx = randi(4, m.w - 5), ty = randi(4, m.h - 5);
    const t = m.t(tx, ty);
    if (t === T.WATER || t === T.WALL || t === T.FENCE || m.indoor[m.idx(tx, ty)]) continue;
    if (!allowReservedOutdoor && !m.freeTile(tx, ty, pad)) continue;
    if (allowReservedOutdoor && (m.ogrid[m.idx(tx, ty)] || []).length) continue;
    return { x: tx * TILE + 16, y: ty * TILE + 16, tx, ty };
  }
  return null;
}
function placeOutdoor(m, type, n, nearTrees) {
  for (let i = 0; i < n; i++) {
    let p = null;
    for (let k = 0; k < 30 && !p; k++) {
      const q = freeSpot(m, 0); if (!q) break;
      if (nearTrees) { const near = m.objs.some(o => o.type === 'tree' && dist2(o.x, o.y, q.x, q.y) < 70 * 70); if (!near) continue; }
      p = q;
    }
    if (!p) continue;
    const c = m.addContainer(type, p.x + rand(-6, 6), p.y + rand(-6, 6)); if (type === 'barrel' && chance(0.3)) c.red = true;
    m.reserved[m.idx(p.tx, p.ty)] = 1;
  }
}
function scatterNature(m, trees, rocks, ores, tier, kinds = [['pine', 3], ['oak', 1]]) {
  for (let ty = 2; ty < m.h - 2; ty++) for (let tx = 2; tx < m.w - 2; tx++) {
    const i = m.idx(tx, ty); if (m.reserved[i] || m.tiles[i] !== T.GROUND) continue;
    const r = Math.random();
    const x = tx * TILE + 16 + rand(-6, 6), y = ty * TILE + 16 + rand(-6, 6);
    if (r < trees) { if (m.freeTile(tx, ty, 1)) m.addObj({ type: 'tree', style: weighted(kinds)[0], x, y, r: 10, solid: true, cover: 7, res: 'wood', amt: randi(60, 110) }); }
    else if (r < trees + rocks) { if (m.freeTile(tx, ty, 1)) m.addObj({ type: 'rock', x, y, r: 14, solid: true, cover: 14, res: 'stone', amt: randi(80, 140), seed: Math.random() * 99 }); }
    else if (r < trees + rocks + ores) {
      if (!m.freeTile(tx, ty, 1)) continue;
      const sulfur = Math.random() < 0.45;
      m.addObj({ type: sulfur ? 'ore_sulfur' : 'ore_metal', x, y, r: 14, solid: true, cover: 14, res: sulfur ? 'sulfur_ore' : 'metal_ore', amt: randi(70, 120) + tier * 20, seed: Math.random() * 99 });
    } else if (r < trees + rocks + ores + 0.05) {
      m.addObj({ type: 'bush', x, y, r: 10, solid: false });
    } else if (r < trees + rocks + ores + 0.056) {
      m.addObj({ type: pick(['log', 'tire', 'pallet']), x, y, r: 8, solid: false });
    }
  }
}
const HOUSE_STYLES = {
  brick: { w: 0, f: 0, roof: 'roof_red' }, brick2: { w: 0, f: 1, roof: 'roof_red' }, plank: { w: 1, f: 0, roof: 'roof_brown' },
  shed: { w: 1, f: 0, roof: 'roof_tin' }, concrete: { w: 2, f: 2, roof: 'roof_flat' }, office: { w: 2, f: 1, roof: 'roof_flat' },
};
function buildHouse(m, x, y, w, h, lootW, nLoot, small, style) {
  const tier = m.zone ? m.zone.tier : 1;
  style = HOUSE_STYLES[style || (small ? (tier >= 3 ? 'concrete' : 'shed') : tier >= 3 ? pick(['concrete', 'office']) : pick(['brick', 'brick2', 'plank']))];
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const edge = i === x || j === y || i === x + w - 1 || j === y + h - 1; const k = m.idx(i, j);
    m.set(i, j, edge ? T.WALL : T.FLOOR); m.indoor[k] = 1; m.wkind[k] = style.w; m.fkind[k] = style.f;
  }
  // doors (never on the top wall's corners)
  const doors = small ? 1 : randi(1, 2);
  const sides = shuffle([2, 2, 1, 3, 0]);
  for (let d = 0; d < doors; d++) {
    const sd = sides[d];
    if (sd === 0) m.set(randi(x + 1, x + w - 2), y, T.FLOOR);
    if (sd === 1) m.set(x + w - 1, randi(y + 1, y + h - 2), T.FLOOR);
    if (sd === 2) m.set(randi(x + 1, x + w - 2), y + h - 1, T.FLOOR);
    if (sd === 3) m.set(x, randi(y + 1, y + h - 2), T.FLOOR);
  }
  if (!small && w >= 8) { // interior partition with a doorway
    const px = x + Math.floor(w / 2);
    for (let j = y + 1; j < y + h - 1; j++) m.set(px, j, T.WALL);
    m.set(px, randi(y + 1, y + h - 2), T.FLOOR);
  }
  for (let k = 0; k < nLoot; k++) {
    const type = weighted(lootW)[0];
    const cx = randi(x + 1, x + w - 2), cy = randi(y + 1, y + h - 2);
    if (m.t(cx, cy) !== T.FLOOR || m.containers.some(c => Math.floor(c.x / TILE) === cx && Math.floor(c.y / TILE) === cy)) continue;
    m.addContainer(type, cx * TILE + 16, cy * TILE + 18);
  }
  if (chance(0.7)) floorLoot(m, x, y, w, h);
  m.roofs.push({ x, y, w, h, kind: style.roof });
  m.reserveRect(x, y, w, h, 1);
}
const FLOOR_LOOT = [['pistol_ammo', 6, 4, 10], ['shell', 3, 2, 5], ['bandage', 5, 1, 1], ['scrap', 6, 3, 8], ['canned', 4, 1, 1], ['cigs', 3, 1, 1], ['rope', 2, 1, 1], ['tape', 2, 1, 1], ['cloth', 3, 3, 8], ['rotgut', 1, 1, 1], ['antirad', 1, 1, 1]];
function floorLoot(m, x, y, w, h) {
  for (let k = 0; k < 6; k++) {
    const cx = randi(x + 1, x + w - 2), cy = randi(y + 1, y + h - 2); if (m.t(cx, cy) !== T.FLOOR) continue;
    const [id, , a, b] = weighted(FLOOR_LOOT); m.groundItems.push({ x: cx * TILE + rand(8, 24), y: cy * TILE + rand(10, 26), item: makeItem(id, randi(a, b)) }); return;
  }
}

// ---------------------------------------------------------------------------
// HAND-DESIGNED POINTS OF INTEREST
// '#' wall  '.' floor  ',' leave terrain  'c' concrete  '=' road  'f' fence
// containers: C crate, T toolbox, M medbox, A ammobox, X military, B barrel, k cache
// props: v car wreck, s sandbag, p pallet, t tire, L loose loot
// roofs: [x, y, w, h] building rectangles (also marks the interior as indoors)
// ---------------------------------------------------------------------------
const PREFABS = {
  cabin: { style: 'plank', rows: [
    ',,,,,,,,',
    ',######,',
    ',#.C..#,',
    ',#...L#,',
    ',#M...#,',
    ',###.##,',
    ',,,,p,,,'], roofs: [[1, 1, 6, 5]] },
  farm: { style: 'brick', rows: [
    ',,,,,,,,,,,,,,,,,,,,',
    ',#######,,,,,#######',
    ',#..C..#,,,,,#.....#',
    ',#.....#,,,,,#..C..#',
    ',#L...M#,,,,,#.....#',
    ',###.###,,,,,#.T.L.#',
    ',,,,,,,,,,,,,###.###',
    ',,,ffffffff,,,,,,,,,',
    ',,,f,,,,,,f,,,,p,t,,',
    ',,,f,,B,,,f,,,,,,,,,',
    ',,,ffff,fff,,,,,,,,,'], roofs: [[1, 1, 7, 5], [13, 1, 7, 6]], barn: 1 },
  gas: { style: 'office', rows: [
    'cccccccccccccccccc',
    'c#########cccccccc',
    'c#..C..A.#ccvccccc',
    'c#L......#cccccccc',
    'c#..M..T.#ccBccBcc',
    'c####.####cccccccc',
    'ccccccccccccBccBcc',
    'ccccvcccccccccccss',
    '=================='], roofs: [[1, 1, 9, 5]] },
  checkpoint: { style: 'concrete', rows: [
    'ss,ccccccc,ss',
    ',,ccccccccc,,',
    ',,c#####ccc,,',
    ',,c#.X.#ccc,,',
    ',,c#A.L#cBc,,',
    ',,c##.##ccc,,',
    ',,cccccccvc,,',
    'ss,ccccccc,ss'], roofs: [[3, 2, 5, 4]] },
  warehouse: { style: 'concrete', rows: [
    ',cccccccccccccccc,',
    ',c##############c,',
    ',c#.C..X...C...#c,',
    ',c#............#c,',
    ',c#..CC....A.L.#c,',
    ',c#............#c,',
    ',c#.T.....M..C.#c,',
    ',c######..######c,',
    ',cccccpccccccBccc,'], roofs: [[2, 1, 14, 7]] },
};
function stampPrefab(m, key, ox, oy) {
  const pf = PREFABS[key]; const rows = pf.rows; const H = rows.length, W = rows[0].length;
  const style = HOUSE_STYLES[pf.style];
  const inRoof = (x, y) => pf.roofs.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh);
  const cmap = { C: 'crate', T: 'toolbox', M: 'medbox', A: 'ammobox', X: 'military', B: 'barrel', k: 'cache' };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x] || ','; const tx = ox + x, ty = oy + y; if (!m.inb(tx, ty)) continue; const k = m.idx(tx, ty);
    const indoor = inRoof(x, y); const under = indoor ? T.FLOOR : (pf.rows.some(r => r.includes('c')) ? T.CONCRETE : T.GROUND);
    if (ch === '#') { m.set(tx, ty, T.WALL); m.wkind[k] = style.w; m.fkind[k] = style.f; m.indoor[k] = 1; continue; }
    if (ch === 'f') { m.set(tx, ty, T.FENCE); continue; }
    if (ch === 'c') { m.set(tx, ty, T.CONCRETE); continue; }
    if (ch === '=') { m.set(tx, ty, T.ROAD); continue; }
    if (ch === ',') { if (m.t(tx, ty) === T.WATER) m.set(tx, ty, T.GROUND); continue; }
    if (indoor) { m.set(tx, ty, T.FLOOR); m.indoor[k] = 1; m.fkind[k] = style.f; } else if (ch !== '.') { if (m.t(tx, ty) === T.WATER || m.t(tx, ty) === T.WALL) m.set(tx, ty, under); }
    const wx = tx * TILE + 16, wy = ty * TILE + 18;
    if (cmap[ch]) { const c = m.addContainer(cmap[ch], wx, wy); if (ch === 'B' && chance(0.4)) c.red = true; }
    else if (ch === 'L') { const [id, , a, b] = weighted(FLOOR_LOOT); m.groundItems.push({ x: wx, y: wy, item: makeItem(id, randi(a, b)) }); }
    else if (ch === 'v') m.addObj({ type: 'car', x: wx, y: wy, r: 20, solid: true, cover: 18 });
    else if (ch === 's') m.addObj({ type: 'sandbag', x: wx, y: wy, r: 14, solid: true, cover: 14 });
    else if (ch === 'p') m.addObj({ type: 'pallet', x: wx, y: wy, r: 8, solid: false });
    else if (ch === 't') m.addObj({ type: 'tire', x: wx, y: wy, r: 6, solid: false });
  }
  for (const [rx, ry, rw, rh] of pf.roofs) m.roofs.push({ x: ox + rx, y: oy + ry, w: rw, h: rh, kind: pf.barn ? 'roof_brown' : style.roof });
  m.reserveRect(ox, oy, W, H, 1);
}
function placePrefabs(m, list) {
  for (const key of list) {
    const pf = PREFABS[key]; const W = pf.rows[0].length, H = pf.rows.length;
    for (let tries = 0; tries < 200; tries++) {
      const x = randi(3, m.w - W - 3), y = randi(3, m.h - H - 3);
      if (!m.rectFree(x, y, W, H, 1)) continue;
      stampPrefab(m, key, x, y); break;
    }
  }
}

// room with a keycard door and vault crates
function buildVault(m, x, y, w, h, key, lootList, arts) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
    const edge = i === x || j === y || i === x + w - 1 || j === y + h - 1; const k = m.idx(i, j);
    m.set(i, j, edge ? T.WALL : T.FLOOR); m.indoor[k] = 1; m.wkind[k] = 2; m.fkind[k] = 1;
  }
  m.roofs.push({ x, y, w, h, kind: 'roof_flat' });
  const dx = x + Math.floor(w / 2), dy = y + h - 1;
  m.set(dx, dy, T.KEYDOOR); m.keydoors.push({ tx: dx, ty: dy, key, open: false });
  // keep the approach clear
  for (let k = 1; k <= 2; k++) if (m.t(dx, dy + k) === T.WALL) m.set(dx, dy + k, T.FLOOR);
  let i = 0;
  for (const l of lootList) {
    const cx = x + 1 + (i % (w - 2)), cy = y + 1 + Math.floor(i / (w - 2)); i++;
    m.addContainer(l === 'elite' ? 'elite' : l === 'ammobox' ? 'ammobox' : 'military', cx * TILE + 16, cy * TILE + 16, l);
  }
  for (let a = 0; a < (arts || 0); a++) {
    const c = m.addContainer('cache', (x + w - 2) * TILE + 16, (y + 1 + a) * TILE + 16, 'cache');
    c.items = [makeItem(pick(ART_IDS))]; c.name = 'Lead Container';
  }
}
function buildMonument(m, zone) {
  const S = m.w, c = Math.floor(S / 2);
  if (zone.monument === 'radar') {
    const R = 13, x0 = c - R, y0 = c - R, W = R * 2;
    for (let j = y0; j <= y0 + W; j++) for (let i = x0; i <= x0 + W; i++) {
      const edge = i === x0 || j === y0 || i === x0 + W || j === y0 + W;
      m.set(i, j, edge ? T.FENCE : T.CONCRETE);
    }
    for (const [gx, gy] of [[c, y0], [c, y0 + W], [x0, c], [x0 + W, c]]) for (let k = -1; k <= 1; k++) m.set(gx + (gy === c ? 0 : k), gy + (gy === c ? k : 0), T.CONCRETE);
    buildVault(m, c - 4, c - 5, 9, 6, zone.vault.key, zone.vault.loot, zone.vault.artifacts);
    m.reserveRect(x0, y0, W + 1, W + 1, 1);
    // dishes and side huts
    for (const [dx, dy] of [[-8, 7], [8, 7]]) m.addObj({ type: 'dish', x: (c + dx) * TILE, y: (c + dy) * TILE, r: 30, solid: true, cover: 28 });
    buildHouse(m, x0 + 2, y0 + 2, 5, 4, [['ammobox', 1], ['toolbox', 1]], 2, true, 'concrete');
    buildHouse(m, x0 + W - 7, y0 + 2, 5, 4, [['military', 1], ['medbox', 1]], 2, true, 'concrete');
    for (let k = 0; k < 6; k++) m.addContainer('barrel', (x0 + 3 + k * 4) * TILE, (y0 + W - 3) * TILE);
    m.radZones.push({ x: c * TILE, y: c * TILE, r: zone.radCenter * TILE, pow: zone.radPow });
    m.groups.push({ type: 'soldier', x: c * TILE, y: (c + 5) * TILE, n: 2 });
  } else if (zone.monument === 'garrison') {
    const W = 32, H = 26, x0 = c - W / 2, y0 = c - H / 2;
    for (let j = y0; j <= y0 + H; j++) for (let i = x0; i <= x0 + W; i++) {
      const edge = i === x0 || j === y0 || i === x0 + W || j === y0 + H;
      m.set(i, j, edge ? T.WALL : T.CONCRETE); m.wkind[m.idx(i, j)] = 2;
    }
    for (let k = -1; k <= 1; k++) { m.set(c + k, y0 + H, T.CONCRETE); m.set(x0, c + k, T.CONCRETE); m.set(x0 + W, c + k, T.CONCRETE); }
    buildVault(m, c - 4, y0 + 2, 9, 6, zone.vault.key, zone.vault.loot);
    buildHouse(m, x0 + 2, y0 + 2, 8, 6, [['military', 2], ['ammobox', 2], ['medbox', 1]], 3, false, 'concrete');
    buildHouse(m, x0 + W - 10, y0 + 2, 8, 6, [['military', 2], ['ammobox', 1], ['toolbox', 1]], 3, false, 'concrete');
    buildHouse(m, x0 + 2, y0 + H - 8, 7, 6, [['ammobox', 1], ['crate', 1]], 2, false, 'office');
    buildHouse(m, x0 + W - 9, y0 + H - 8, 7, 6, [['military', 1], ['medbox', 1]], 2, false, 'office');
    m.addObj({ type: 'tank', x: (c + 8) * TILE, y: (c + 8) * TILE, r: 34, solid: true, cover: 30 });
    for (let k = 0; k < 8; k++) m.addObj({ type: 'sandbag', x: (x0 + 6 + k * 3) * TILE, y: (c + 3 + (k % 2) * 3) * TILE, r: 14, solid: true, cover: 14 });
    for (let k = 0; k < 5; k++) m.addContainer('barrel', (x0 + 12 + k * 2) * TILE, (y0 + H - 2) * TILE);
    m.reserveRect(x0, y0, W + 1, H + 1, 1);
    m.groups.push({ type: zone.boss, x: c * TILE, y: (c + 1) * TILE, n: 1, boss: true });
    m.groups.push({ type: 'soldier', x: (c - 5) * TILE, y: (c + 2) * TILE, n: 2 });
    m.groups.push({ type: 'soldier', x: (c + 5) * TILE, y: (c + 2) * TILE, n: 2 });
  } else if (zone.monument === 'reactor') {
    const W = 22, H = 18, x0 = c - W / 2, y0 = c - H / 2;
    for (let j = y0 - 3; j <= y0 + H + 3; j++) for (let i = x0 - 3; i <= x0 + W + 3; i++) if (m.inb(i, j) && m.t(i, j) !== T.WALL) m.set(i, j, T.CONCRETE);
    for (let j = y0; j <= y0 + H; j++) for (let i = x0; i <= x0 + W; i++) {
      const edge = i === x0 || j === y0 || i === x0 + W || j === y0 + H;
      const kk = m.idx(i, j); m.set(i, j, edge ? T.WALL : T.FLOOR); m.indoor[kk] = 1; m.wkind[kk] = 2; m.fkind[kk] = 2;
    }
    m.roofs.push({ x: x0, y: y0, w: W + 1, h: H + 1, kind: 'roof_flat' });
    for (let k = -1; k <= 1; k++) { m.set(c + k, y0 + H, T.FLOOR); m.set(x0, c + 3 + k, T.FLOOR); }
    // inner hall walls
    for (let i = x0 + 1; i < x0 + W; i++) if (i < c - 1 || i > c + 1) { m.set(i, y0 + 9, T.WALL); m.wkind[m.idx(i, y0 + 9)] = 2; }
    buildVault(m, c - 4, y0 + 2, 9, 6, zone.vault.key, zone.vault.loot, zone.vault.artifacts);
    for (let k = 0; k < 4; k++) m.addContainer(pick(['military', 'medbox', 'ammobox', 'toolbox']), (x0 + 2 + k * 5) * TILE + 16, (y0 + H - 2) * TILE + 16);
    for (const [dx, dy] of [[-16, -10], [16, -10]]) if (m.inb(c + dx, c + dy)) m.addObj({ type: 'tower', x: (c + dx) * TILE, y: (c + dy) * TILE, r: 64, solid: true, cover: 60 });
    m.reserveRect(x0 - 3, y0 - 3, W + 7, H + 7, 1);
    m.radZones.push({ x: c * TILE, y: c * TILE, r: zone.radCenter * TILE, pow: zone.radPow });
    m.groups.push({ type: 'lurker', x: c * TILE, y: (c + 5) * TILE, n: 2 });
    m.groups.push({ type: 'soldier', x: c * TILE, y: (y0 + H + 4) * TILE, n: 3 });
  }
}

// ---------------------------------------------------------------------------
// HOME BASE MAP
// ---------------------------------------------------------------------------
const BASE_SIZE = 56;
function genBase() {
  const S = BASE_SIZE, m = new GameMap(S, S, 'base'); const c = S / 2;
  m.struct = new Array(S * S).fill(null);
  m.center = { tx: c, ty: c };
  blob(m, randi(6, 12), randi(6, 12), 4, T.WATER);
  blob(m, randi(S - 12, S - 6), randi(S - 14, S - 6), 3, T.WATER);
  m.reserveRect(c - 15, c - 15, 31, 31, 0);
  m.spawn = { x: c * TILE + 16, y: (c + 2) * TILE + 16 };
  regrowBase(m, true);
  // scenery outside the claim
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * 6.283, d = rand(17, 25); const tx = Math.round(c + Math.cos(a) * d), ty = Math.round(c + Math.sin(a) * d);
    if (!m.inb(tx, ty) || m.t(tx, ty) !== T.GROUND || (m.ogrid[m.idx(tx, ty)] || []).length) continue;
    const type = pick(['log', 'log', 'tire', 'pallet', 'car']); m.addObj({ type, x: tx * TILE + 16, y: ty * TILE + 16, r: type === 'car' ? 20 : 8, solid: type === 'car', cover: type === 'car' ? 18 : 0 });
  }
  return m;
}
// re-seed resource nodes outside the claim area (called at dawn)
function regrowBase(m, initial) {
  const c = m.w / 2; const counts = { tree: 0, rock: 0, ore: 0 };
  for (const o of m.objs) { if (o.type === 'tree') counts.tree++; else if (o.type === 'rock') counts.rock++; else if (o.type.startsWith('ore')) counts.ore++; }
  const want = { tree: 70, rock: 26, ore: 14 };
  const place = (type) => {
    for (let k = 0; k < 60; k++) {
      const tx = randi(3, m.w - 4), ty = randi(3, m.h - 4);
      const d = Math.hypot(tx - c, ty - c); if (d < (initial ? 9 : 16)) continue;
      if (m.t(tx, ty) !== T.GROUND || m.st(tx, ty)) continue;
      if (!m.freeTile(tx, ty, 1) && !(d > 15 && !(m.ogrid[m.idx(tx, ty)] || []).length)) continue;
      const x = tx * TILE + 16 + rand(-5, 5), y = ty * TILE + 16 + rand(-5, 5);
      if (type === 'tree') m.addObj({ type: 'tree', style: chance(0.7) ? 'pine' : 'oak', x, y, r: 10, solid: true, cover: 7, res: 'wood', amt: randi(60, 110) });
      else if (type === 'rock') m.addObj({ type: 'rock', x, y, r: 14, solid: true, cover: 14, res: 'stone', amt: randi(90, 150), seed: Math.random() * 99 });
      else { const s = Math.random() < 0.45; m.addObj({ type: s ? 'ore_sulfur' : 'ore_metal', x, y, r: 14, solid: true, cover: 14, res: s ? 'sulfur_ore' : 'metal_ore', amt: randi(60, 100), seed: Math.random() * 99 }); }
      return true;
    }
    return false;
  };
  const regrow = initial ? 1 : 0.35;
  for (const k of ['tree', 'rock', 'ore']) {
    const n = Math.ceil((want[k] - counts[k]) * regrow);
    for (let i = 0; i < n; i++) place(k);
  }
}

// Dijkstra flow field from the core toward every tile, costs include
// walls (raiders will chew through the cheapest path).
function buildFlowField(m) {
  const W = m.w, H = m.h, N = W * H; const distA = new Float64Array(N).fill(1e9);
  const core = m.coreTile; if (!core) return null;
  const heap = []; // binary heap of [d, i]
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break;[heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (; ;) { const l = 2 * k + 1, r = l + 1; let s = k; if (l < heap.length && heap[l][0] < heap[s][0]) s = l; if (r < heap.length && heap[r][0] < heap[s][0]) s = r; if (s === k) break;[heap[s], heap[k]] = [heap[k], heap[s]]; k = s; } } return top; };
  const ci = core.ty * W + core.tx; distA[ci] = 0; push(0, ci);
  const cost = i => {
    const t = m.tiles[i]; if (SOLID_T[t]) return Infinity;
    const og = m.ogrid[i]; if (og && og.some(o => o.solid && dist2(o.x, o.y, (i % m.w) * TILE + 16, ((i / m.w) | 0) * TILE + 16) < (o.r + 10) ** 2)) return Infinity;
    const s = m.struct[i];
    if (s) { const d = STRUCTS[s.type]; if (d.block) return 1 + s.hp / 45; }
    return 1;
  };
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1]];
  while (heap.length) {
    const [d, i] = pop(); if (d > distA[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy, w] of DIRS) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      // moving ni -> i (toward the core) pays the cost of entering tile i
      const nd = d + (i === ci ? 1 : cost(i) * w);
      if (nd < distA[ni]) { distA[ni] = nd; push(nd, ni); }
    }
  }
  return distA;
}
