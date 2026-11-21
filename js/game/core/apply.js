// Command appliers for the Stage 1a slice (owner A; doc 13.3, 14.6). commands.js (C3) validates;
// these change saved state. installCommands() registers them; an owner may replace any of them
// later with registerApplier (the last registration wins), so installSim() runs this first.
//
// Slice commands: designate, cancelRect, place, placeLine, stamp, carve, copyRoom, paste,
// deconstruct, zone, zoneCfg, bill, prio, sched, forbid, prioritise, assign.
// (role, draft, order, research, charter, trade and caravan are registered by F, H and K.)
//
// Every applier is deterministic (14.1): scans run in tile-index or id order, ids are the lowest
// free index (buildings) or the lowest unused zone id, no object-key iteration decides anything.
// Caches stay exact in the same call (C13): buildings through B's setOcc, items through E's item
// API, stock through withZoneEdit, and the owners of other incremental indexes hear about every
// change through the BUS hooks placed / removed / designated / zoned / zoneCfg / billsChanged /
// forbidden (core/bus.js). Zone edits set rt.dirty.zoneFields for E's end-of-tick pass.
//
// Results: { ok: true, ...detail } or { ok: false, reason } (a player-readable toast).

import {
  W, H, N, idx as gidx, tx, ty, inB, TER, TER_MINEABLE, TER_BUILDABLE, TER_PASSABLE, TER_WATER, TER_FERTILE, DESIG, DESIG_KINDS, ZONE_MAX, getBit, PLANE, tz,
} from './grid.js';
import { newBuilding, newZone, newBill, WORK_IDS } from './schema.js';
import { BUS, first as firstHook } from './bus.js';
import { registerApplier } from './commands.js';
import { colById, bldById, zoneById, itemById, nextId } from './state.js';
import { def, all, structDef, hasFlag, sizeOf, tilesOf } from './content.js';
import { setOcc } from '../world/terrain.js';
import { isTreeCode, plantDef } from '../world/defs.js';
import { spawn as spawnItem, setForbidden, withZoneEdit, stackAt } from '../work/items.js';
import { endJobsOn } from '../work/reserve.js';
import { keyBld } from '../work/jobs.js';

const CAP_BUILDINGS = () => { const c = def('balance', 'caps'); return (c && c.values && c.values.buildings) || 3000; };
const MAX_TEMPLATES = 8;
const MAX_PLANS = 16;

const fail = (reason) => ({ ok: false, reason });
// Levels (C3 v3, EMBERCROWN-FORTRESS.md 7.4): every applier works on ONE level, the command's (its rect's z, or its
// z for place and paste, or its first path voxel's for placeLine); AZ holds it while the applier runs and idx(x, y)
// and the footprints below read that level. 0 on a D = 1 map, so nothing changes there.
let AZ = 0;
const idx = (x, y, z = AZ) => gidx(x, y, z);
const tilesAt = (d, x, y, rot = 0) => { const a = tilesOf(d, x, y, rot); if (AZ) for (let k = 0; k < a.length; k++) a[k] += AZ * PLANE; return a; };
const levelOfCmd = (c) => (c.rect && Number.isInteger(c.rect.z) ? c.rect.z : Number.isInteger(c.z) ? c.z : Array.isArray(c.path) && c.path[0] && Number.isInteger(c.path[0][2]) ? c.path[0][2] : 0);
/** Run fn with the applier level z (restored after). */
function atLevel(z, fn) { const keep = AZ; AZ = z | 0; try { return fn(); } finally { AZ = keep; } }
function rectN(r) {
  return { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
}
function forRect(r, fn) { const q = rectN(r); for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) fn(idx(x, y), x, y); }

// ---- Floors: structure defs flagged 'floor' <-> ids in the `floor` layer ------------------------
/** Floor layer id of a floor def (1-based position among the floor defs in data order; 0 none). */
export function floorIdOf(defId) { const f = all('structure').filter((d) => hasFlag(d, 'floor')); const k = f.findIndex((d) => d.id === defId); return k + 1; }
/** Floor def of a floor layer id, or null. */
export function floorDefOf(id) { const f = all('structure').filter((d) => hasFlag(d, 'floor')); return id > 0 ? f[id - 1] || null : null; }

// ---- Fog: placement needs explored tiles (7.1). A map with no fog data at all (tests, flat
// scenes) counts as explored everywhere.
function explored(s, i) {
  const f = s.L.fog;
  if (getBit(f, i)) return true;
  for (let k = 0; k < f.length; k++) if (f[k]) return false;
  return true;
}

// ---- Buildings ------------------------------------------------------------------------------------
const liveBuildings = (s) => s.bld.length - s.rt.bldFree.length;
function allocBld(s) {
  const f = s.rt.bldFree;
  if (f.length) return f.shift();
  s.bld.push(null);
  return s.bld.length - 1;
}
function freeBld(s, id) {
  s.bld[id] = null;
  const f = s.rt.bldFree;
  if (id === s.bld.length - 1) {
    s.bld.pop();
    while (s.bld.length && s.bld[s.bld.length - 1] === null) { s.bld.pop(); f.pop(); }
  } else {
    let lo = 0, hi = f.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (f[m] < id) lo = m + 1; else hi = m; }
    f.splice(lo, 0, id);
  }
}

/** Material group of a material id ('wood', 'stone', 'metal', ...), or null. */
const groupOf = (m) => { const d = m ? def('material', m) : null; return d ? d.group : null; };
const CAT_OF_GROUP = { wood: 'wood', stone: 'blocks', metal: 'ingots', cloth: 'cloth', hide: 'leather' };

/** What a blueprint needs delivered: { kindOrCat: n }. Furniture needs its item; constructs their cost. */
export function needOf(d, mat) {
  if (!d) return {};
  if (d.kind === 'furniture') return { [d.item || d.id]: 1 };
  if (d.cost) return { ...d.cost };
  if (d.costByMat && d.costByMat.length) {
    const g = groupOf(mat), want = g ? CAT_OF_GROUP[g] || g : null;
    const e = d.costByMat.find((x) => x.cat === want) || d.costByMat[0];
    return { [e.cat]: e.n };
  }
  return {};
}

/**
 * Why `defId` cannot be planned with its top-left at (x, y), or null when it can.
 * opts.reuse: tiles already holding a wall or rock count as fine for walls (stamps).
 */
export function checkPlace(s, defId, x, y, rot = 0, z = null) {
  if (z !== null && z !== undefined && (z | 0) !== AZ) return atLevel(z, () => checkPlace(s, defId, x, y, rot));
  const d = structDef(defId);
  if (!d) return `unknown structure ${defId}`;
  if (d.kind === 'zone') return 'paint it with the Zones tool';
  if (d.kind === 'designation') return 'use the Orders tools';
  const [w, h] = sizeOf(d, rot);
  if (!inB(x, y) || !inB(x + w - 1, y + h - 1)) return 'off the map';
  if (liveBuildings(s) >= CAP_BUILDINGS()) return 'too many buildings';
  if (hasFlag(d, 'unique') && s.bld.some((b) => b && b.def === defId)) return `there is already a ${d.name}`;
  const isFloor = hasFlag(d, 'floor');
  for (const i of tilesAt(d, x, y, rot)) {
    const t = s.L.terrain[i];
    if (!TER_BUILDABLE[t]) return t === TER.ROCK || t === TER.RUBBLE ? 'solid rock: mine it first' : TER_WATER[t] ? 'water' : 'cannot build there';
    if (!explored(s, i)) return 'unexplored ground';
    if (s.rt.occ[i] >= 0) return 'something is already there';
    if (isFloor && s.L.floor[i] === floorIdOf(defId)) return 'that floor is already laid';
  }
  const r = firstHook(BUS.canPlace, s, d, x, y, rot, AZ);   // Z2: the level (add-ons, the winch)
  return r && r.ok === false ? r.reason || 'cannot build there' : null;
}

/** Add a blueprint (or, with st 'done', a finished structure: the Hearth at founding). Returns the building. */
export function addBuilding(s, defId, x, y, rot = 0, mat = null, init = {}) {
  const d = structDef(defId);
  const id = allocBld(s);
  const st = init.st || 'bp';
  const b = newBuilding(id, defId, x, y, rot, mat, {
    need: st === 'done' ? {} : needOf(d, mat), hp: (d && d.hp) || 100, st, ...(AZ ? { z: AZ } : {}), ...init,
  });
  if (d && d.workbench && d.workbench.autoBills && !init.bills) {
    b.bills = d.workbench.autoBills.map((a) => newBill(a.recipe, { mode: a.mode, n: a.n, ...(a.perCol ? { perCol: true } : {}) }));
  }
  s.bld[id] = b;
  setOcc(s, b, true);
  for (const fn of BUS.placed) fn(s, b);
  return b;
}

/** Remove a building: jobs on it end (reservations released), delivered materials drop. */
export function removeBuilding(s, b, destroyed = false) {
  endJobsOn(s, keyBld(b.id));
  if (b.st !== 'done' && b.got) {
    for (const k of Object.keys(b.got).sort()) {
      const n = b.got[k] | 0;
      if (n > 0 && def('item', k)) spawnItem(s, k, b.mat, 0, n, b.x, b.y, { z: b.z | 0 });
    }
  }
  for (const fn of BUS.removed) fn(s, b, destroyed);
  setOcc(s, b, false);
  if (s.colony.hearth && s.colony.hearth.id === b.id) s.colony.hearth.id = null;
  for (const c of s.col) if (c.bed === b.id) c.bed = null;
  freeBld(s, b.id);
}

/** Plan one structure: { ok, id } or { ok: false, reason }. */
export function planOne(s, defId, x, y, rot = 0, mat = null) {
  const why = checkPlace(s, defId, x, y, rot);
  if (why) return fail(why);
  const b = addBuilding(s, defId, x, y, rot, mat);
  return { ok: true, id: b.id };
}

// ---- Designations ---------------------------------------------------------------------------------
function writeDesig(s, i, v) {
  const before = s.L.desig[i];
  if (before === v) return false;
  s.L.desig[i] = v;
  for (const fn of BUS.designated) fn(s, i, before, v);
  return true;
}
/** Does designation bit `bit` make sense on tile i? */
function desigFits(s, i, bit) {
  const t = s.L.terrain[i];
  switch (bit) {
    case DESIG.MINE: case DESIG.RISKY: return TER_MINEABLE[t] === 1;
    case DESIG.PROSPECT: return t === TER.ROCK;
    case DESIG.CHOP: return isTreeCode(s.L.plant[i]);
    case DESIG.HARVEST: { const p = plantDef(s.L.plant[i]); return !!p && p.kind !== 'tree'; }
    case DESIG.SMOOTH: return t === TER.ROCK || t === TER.ROUGH;
    case DESIG.ENGRAVE: return t === TER.ROCK || (s.L.desig[i] & DESIG.SMOOTH) !== 0 || s.L.floor[i] !== 0;
    case DESIG.FORBID: return true;
    default: return false;
  }
}
function designate(s, c) {
  const bit = DESIG_KINDS[c.kind];
  let n = 0;
  forRect(c.rect, (i) => {
    const v = s.L.desig[i];
    if (c.add) { if (!(v & bit) && desigFits(s, i, bit) && writeDesig(s, i, v | bit)) n++; }
    else if (v & bit) { writeDesig(s, i, v & ~bit); n++; }
  });
  if (!n) return fail(c.add ? `nothing to ${c.kind} there` : 'nothing to remove');
  return { ok: true, n };
}

// ---- Cancel ------------------------------------------------------------------------------------------
function buildingsIn(s, r, pred) {
  const q = rectN(r), out = [];
  for (const b of s.bld) {
    if (!b || !pred(b) || (b.z | 0) !== AZ) continue;
    const d = structDef(b.def), [w, h] = sizeOf(d, b.rot);
    if (b.x <= q.x1 && b.x + w - 1 >= q.x0 && b.y <= q.y1 && b.y + h - 1 >= q.y0) out.push(b);
  }
  return out;
}
function cancelRect(s, c) {
  let n = 0;
  for (const k of c.kinds) {
    if (k in DESIG_KINDS) {
      const bit = DESIG_KINDS[k];
      forRect(c.rect, (i) => { const v = s.L.desig[i]; if (v & bit) { writeDesig(s, i, v & ~bit); n++; } });
    } else if (k === 'bp') {
      for (const b of buildingsIn(s, c.rect, (x) => x.st !== 'done')) { removeBuilding(s, b); n++; }
      for (const b of buildingsIn(s, c.rect, (x) => x.st === 'done' && x.dcon)) { b.dcon = false; n++; }
    } else if (k === 'zone') {
      const byZone = new Map();
      forRect(c.rect, (i) => { const z = s.L.zone[i]; if (z) { if (!byZone.has(z)) byZone.set(z, []); byZone.get(z).push(i); } });
      for (const [z, tiles] of [...byZone].sort((a, b) => a[0] - b[0])) { n += unzoneTiles(s, zoneById(s, z), tiles); }
    } else if (k === 'bill') {
      for (const b of buildingsIn(s, c.rect, (x) => x.bills && x.bills.length > 0)) { n += b.bills.length; b.bills = []; for (const fn of BUS.billsChanged) fn(s, b); }
    }
  }
  if (!n) return fail('nothing to cancel there');
  return { ok: true, n };
}

// ---- Place -------------------------------------------------------------------------------------------
function place(s, c) {
  const r = planOne(s, c.def, c.x, c.y, c.rot, c.mat || null);
  return r;
}
function placeLine(s, c) {
  const ids = [];
  let reason = null;
  for (const [x, y] of c.path) {
    const r = planOne(s, c.def, x, y, 0, c.mat || null);
    if (r.ok) ids.push(r.id); else if (!reason) reason = r.reason;
  }
  return ids.length ? { ok: true, ids, n: ids.length } : fail(reason || 'nothing placed');
}

// ---- Stamps (10.11) ----------------------------------------------------------------------------------
const STRUCTS = (flag) => all('structure').filter((d) => hasFlag(d, flag));
/** The wall def for a stamp (flag 'wall', not a door). */
const wallDef = () => (STRUCTS('wall').find((d) => !hasFlag(d, 'door')) || { id: 'wall' }).id;
const doorDef = () => (STRUCTS('door')[0] || { id: 'door' }).id;
/** Floor def for a material: one whose cost or costByMat matches the material group, else the first floor. */
function floorDefFor(mat) {
  const f = STRUCTS('floor');
  if (!f.length) return null;
  const g = groupOf(mat), want = g ? CAT_OF_GROUP[g] || g : null;
  if (want) {
    const hit = f.find((d) => (d.cost && Object.keys(d.cost).some((k) => k === want || k === g)) || (d.costByMat && d.costByMat.some((x) => x.cat === want)));
    if (hit) return hit.id;
    if (g === 'stone') { const st = f.find((d) => d.cost && d.cost.stone); if (st) return st.id; }
  }
  return f[0].id;
}
const isWallAt = (s, i) => { const t = s.L.terrain[i]; if (t === TER.ROCK || t === TER.RUBBLE) return true; const b = s.rt.occ[i] >= 0 ? s.bld[s.rt.occ[i]] : null; return !!b && (hasFlag(structDef(b.def), 'wall') || hasFlag(structDef(b.def), 'door')); };
/** Border tiles of a rect in a fixed order (top, right, bottom, left), corners once. */
function borderOf(q) {
  const out = [];
  for (let x = q.x0; x <= q.x1; x++) out.push([x, q.y0]);
  for (let y = q.y0 + 1; y <= q.y1; y++) out.push([q.x1, y]);
  if (q.y1 > q.y0) for (let x = q.x1 - 1; x >= q.x0; x--) out.push([x, q.y1]);
  if (q.x1 > q.x0) for (let y = q.y1 - 1; y > q.y0; y--) out.push([q.x0, y]);
  return out;
}
const isCorner = (q, x, y) => (x === q.x0 || x === q.x1) && (y === q.y0 || y === q.y1);
/** The door tile: the given one, else the middle of the side nearest the Hearth, on a tile that is not rock. */
export function stampDoor(s, q, door) {
  if (door) return [door.x, door.y];
  const hb = s.colony.hearth && s.colony.hearth.id !== null ? bldById(s, s.colony.hearth.id) : null;
  const hx = hb ? hb.x + 1 : (W >> 1), hy = hb ? hb.y + 1 : (H >> 1);
  const mx = (q.x0 + q.x1) >> 1, my = (q.y0 + q.y1) >> 1;
  const sides = [[mx, q.y0], [q.x1, my], [mx, q.y1], [q.x0, my]];
  let best = null, bd = Infinity;
  for (const [x, y] of borderOf(q)) {
    if (isCorner(q, x, y)) continue;
    const t = s.L.terrain[idx(x, y)];
    if (t === TER.ROCK || t === TER.RUBBLE || !TER_BUILDABLE[t]) continue;
    // prefer side middles, then the distance to the Hearth
    const mid = sides.some(([a, b]) => a === x && b === y) ? 0 : 1;
    const dd = mid * 100000 + (x - hx) * (x - hx) + (y - hy) * (y - hy);
    if (dd < bd) { bd = dd; best = [x, y]; }
  }
  return best;
}
/** Place furniture inside the interior: first fit in scan order, rotation 0 then 1, avoiding `taken` tiles. */
function fitFurniture(s, defId, inner, taken) {
  const d = structDef(defId);
  if (!d) return null;
  for (const rot of [0, 1]) {
    const [w, h] = sizeOf(d, rot);
    for (let y = inner.y0; y + h - 1 <= inner.y1; y++) {
      for (let x = inner.x0; x + w - 1 <= inner.x1; x++) {
        const tiles = tilesAt(d, x, y, rot);
        if (tiles.some((i) => taken.has(i))) continue;
        if (checkPlace(s, defId, x, y, rot)) continue;
        return { x, y, rot, tiles };
      }
    }
  }
  return null;
}
function stamp(s, c) {
  const sd = def('stamp', c.kind);
  const q = rectN(c.rect);
  const w = q.x1 - q.x0 + 1, h = q.y1 - q.y0 + 1;
  const min = sd ? sd.minSize : 3;
  if (w < min || h < min) return fail(`a ${sd ? sd.name.toLowerCase() : 'room'} needs at least ${min} x ${min}`);
  const inner = { x0: q.x0 + 1, y0: q.y0 + 1, x1: q.x1 - 1, y1: q.y1 - 1 };
  const ids = [], skipped = [];
  const doorAt = stampDoor(s, q, c.door);
  if (c.door && (!borderOf(q).some(([x, y]) => x === c.door.x && y === c.door.y) || isCorner(q, c.door.x, c.door.y))) return fail('the door must be on a side of the room');
  // walls (existing rock and walls are reused) and the door
  const wdef = wallDef(), ddef = doorDef();
  for (const [x, y] of borderOf(q)) {
    const i = idx(x, y);
    const isDoor = doorAt && doorAt[0] === x && doorAt[1] === y;
    if (!isDoor && isWallAt(s, i)) continue;
    if (isDoor && s.rt.occ[i] >= 0) { const b = s.bld[s.rt.occ[i]]; if (b && hasFlag(structDef(b.def), 'door')) continue; if (b && b.st !== 'done') removeBuilding(s, b); }
    const r = planOne(s, isDoor ? ddef : wdef, x, y, 0, isDoor ? null : c.wallMat || null);
    if (r.ok) ids.push(r.id); else skipped.push([x, y, r.reason]);
  }
  // furniture first (so floors go around it), then floors on the remaining interior tiles
  const taken = new Set();
  if (doorAt) { // keep the tile inside the door free
    const [dx, dy] = doorAt;
    const ix = dx === q.x0 ? dx + 1 : dx === q.x1 ? dx - 1 : dx, iy = dy === q.y0 ? dy + 1 : dy === q.y1 ? dy - 1 : dy;
    if (inB(ix, iy)) taken.add(idx(ix, iy));
  }
  const area = (inner.x1 - inner.x0 + 1) * (inner.y1 - inner.y0 + 1);
  let zoneMade = null;
  if (c.furnish && sd && inner.x1 >= inner.x0 && inner.y1 >= inner.y0) {
    const list = [];
    if (sd.bench && c.bench) list.push(c.bench);
    for (const f of sd.furnish) {
      const n = f.per ? Math.max(1, Math.floor(area / f.per)) : 1;
      for (let k = 0; k < n; k++) list.push(f.def);
    }
    for (const fdef of list) {
      const fd = structDef(fdef);
      if (fd && fd.kind === 'zone') {
        const r = zoneNew(s, { type: fdef === 'dump' ? 'dump' : 'stockpile', rect: inner, preset: sd.preset || null });
        if (r.ok) zoneMade = r.zoneId;
        continue;
      }
      const spot = fitFurniture(s, fdef, inner, taken);
      if (!spot) { skipped.push([inner.x0, inner.y0, `no room for ${fd ? fd.name : fdef}`]); continue; }
      const b = addBuilding(s, fdef, spot.x, spot.y, spot.rot, null);
      ids.push(b.id);
      for (const i of spot.tiles) taken.add(i);
    }
  }
  const fdef = floorDefFor(c.floorMat || null);
  if (fdef && inner.x1 >= inner.x0 && inner.y1 >= inner.y0) {
    forRect(inner, (i, x, y) => {
      if (s.rt.occ[i] >= 0) return;
      if (checkPlace(s, fdef, x, y, 0)) return;
      ids.push(addBuilding(s, fdef, x, y, 0, c.floorMat || null).id);
    });
  }
  if (!ids.length && !zoneMade) return fail(skipped.length ? skipped[0][2] : 'nothing to build there');
  return { ok: true, ids, n: ids.length, door: doorAt, zoneId: zoneMade, skipped: skipped.length };
}

// ---- Carve hall (3.4, 10.11) ---------------------------------------------------------------------------
const SUPPORT_R = 4, GRID = 9;
const supportDef = (kind) => {
  const sup = STRUCTS('support').filter((d) => !hasFlag(d, 'wall') && !hasFlag(d, 'door'));
  return (sup.find((d) => d.id.includes(kind)) || null);
};
/**
 * The pillar plan of a hall: tile indexes inside the rect, on a 9-tile grid aligned to the rect
 * centre, plus extra points wherever a tile would be left more than 4 tiles (Chebyshev) from any
 * support (rock outside the rect that stays, a supporting structure, or a planned pillar).
 */
export function pillarPlan(s, r) {
  const q = rectN(r);
  const cx = (q.x0 + q.x1) >> 1, cy = (q.y0 + q.y1) >> 1;
  const pil = new Set();
  for (let y = cy - GRID * Math.ceil((cy - q.y0) / GRID); y <= q.y1; y += GRID) {
    if (y < q.y0) continue;
    for (let x = cx - GRID * Math.ceil((cx - q.x0) / GRID); x <= q.x1; x += GRID) if (x >= q.x0) pil.add(idx(x, y));
  }
  const inRect = (x, y) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1;
  const supportAt = (x, y) => {
    if (!inB(x, y)) return true; // the map edge is rock (3.2 step 2)
    const i = idx(x, y);
    if (inRect(x, y)) return pil.has(i);
    const t = s.L.terrain[i];
    if ((t === TER.ROCK || t === TER.RUBBLE) && !(s.L.desig[i] & DESIG.MINE)) return true;
    const b = s.rt.occ[i] >= 0 ? s.bld[s.rt.occ[i]] : null;
    return !!b && b.st === 'done' && hasFlag(structDef(b.def), 'support');
  };
  const covered = (x, y) => {
    for (let dy = -SUPPORT_R; dy <= SUPPORT_R; dy++) for (let dx = -SUPPORT_R; dx <= SUPPORT_R; dx++) if (supportAt(x + dx, y + dy)) return true;
    return false;
  };
  for (let y = q.y0; y <= q.y1; y++) {
    for (let x = q.x0; x <= q.x1; x++) {
      if (pil.has(idx(x, y)) || covered(x, y)) continue;
      pil.add(idx(Math.min(x + SUPPORT_R, q.x1), Math.min(y + SUPPORT_R, q.y1)));
    }
  }
  return [...pil].sort((a, b) => a - b);
}
function carve(s, c) {
  const q = rectN(c.rect);
  const pillars = pillarPlan(s, q);
  const pset = new Set(pillars);
  let pdef = null;
  if (c.pattern === 'pillar') pdef = supportDef('pillar');
  else if (c.pattern === 'prop') pdef = supportDef('prop');
  let mined = 0, rockInRect = 0;
  const natural = [], built = [];
  forRect(q, (i) => {
    const t = s.L.terrain[i];
    if (TER_MINEABLE[t]) rockInRect++;
    const keep = pset.has(i) && !pdef && t === TER.ROCK;
    if (keep) { natural.push(i); return; }
    if (TER_MINEABLE[t] && !(s.L.desig[i] & DESIG.MINE)) { writeDesig(s, i, s.L.desig[i] | DESIG.MINE); mined++; }
    else if (TER_MINEABLE[t]) mined++;
  });
  if (!rockInRect) return fail('carve a hall into rock');
  // built pillars and props: queued now; E's builder starts them once their tile is open
  for (const i of pillars) {
    if (natural.includes(i)) continue;
    const d = pdef || supportDef('pillar') || supportDef('prop');
    if (!d) continue;
    const id = allocPlannedSupport(s, d.id, i);
    if (id !== null) built.push(id);
  }
  if (c.smooth) {
    const ring = { x0: q.x0 - 1, y0: q.y0 - 1, x1: q.x1 + 1, y1: q.y1 + 1 };
    for (const [x, y] of borderOf(ring)) if (inB(x, y) && s.L.terrain[idx(x, y)] === TER.ROCK) { const i = idx(x, y); writeDesig(s, i, s.L.desig[i] | DESIG.SMOOTH); }
    for (const i of natural) writeDesig(s, i, s.L.desig[i] | DESIG.SMOOTH);
  }
  const plan = { id: nextId(s, 'tmpl'), kind: 'carve', rect: q, pattern: c.pattern, pillars: pillars.slice(), natural: natural.slice(), built: built.slice(), tick: s.tick };
  s.colony.plans.push(plan);
  if (s.colony.plans.length > MAX_PLANS) s.colony.plans.splice(0, s.colony.plans.length - MAX_PLANS);
  return { ok: true, mined, pillars, natural, built, planId: plan.id };
}
/**
 * A built pillar on a rock tile cannot be a blueprint yet (rock is not buildable): the plan keeps it
 * and E's builder places it when the tile is mined (colony.plans[].pillars minus natural). On open
 * ground it is planned at once.
 */
function allocPlannedSupport(s, defId, i) {
  const x = tx(i), y = ty(i);
  if (checkPlace(s, defId, x, y, 0)) return null;
  return addBuilding(s, defId, x, y, 0, null).id;
}

// ---- Copy and paste (10.11) ------------------------------------------------------------------------------
function copyRoom(s, c) {
  const rt = s.rt;
  const tiles = [];
  for (let i = 0; i < N; i++) if (rt.room[i] === c.roomId) tiles.push(i);
  if (!tiles.length) return fail('no such room');
  AZ = tz(tiles[0]);   // the room's level (restored by the wrapper in installCommands)
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (const i of tiles) { const x = tx(i), y = ty(i); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
  const cells = [], floors = [], seen = new Set();
  const inside = new Set(tiles);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = idx(x, y);
      const edge = !inside.has(i);
      const b = rt.occ[i] >= 0 ? s.bld[rt.occ[i]] : null;
      if (b && !seen.has(b.id)) {
        const d = structDef(b.def);
        if (!edge || hasFlag(d, 'wall') || hasFlag(d, 'door')) { seen.add(b.id); cells.push([b.x - x0, b.y - y0, b.def, b.rot, b.mat]); }
      }
      if (!edge && s.L.floor[i]) { const fd = floorDefOf(s.L.floor[i]); if (fd) floors.push([x - x0, y - y0, fd.id]); }
    }
  }
  const tm = { id: nextId(s, 'tmpl'), name: `Room ${s.colony.templates.length + 1}`, w: x1 - x0 + 1, h: y1 - y0 + 1, cells, floors };
  s.colony.templates.push(tm);
  if (s.colony.templates.length > MAX_TEMPLATES) s.colony.templates.splice(0, s.colony.templates.length - MAX_TEMPLATES);
  return { ok: true, templateId: tm.id, n: cells.length + floors.length };
}
/** Rotate a cell (top-left dx, dy of a w x h def) by rot quarter turns inside a W0 x H0 template. */
function rotCell(dx, dy, w, h, W0, H0, rot) {
  switch (rot & 3) {
    case 1: return [H0 - 1 - (dy + h - 1), dx];
    case 2: return [W0 - 1 - (dx + w - 1), H0 - 1 - (dy + h - 1)];
    case 3: return [dy, W0 - 1 - (dx + w - 1)];
    default: return [dx, dy];
  }
}
function paste(s, c) {
  const tm = s.colony.templates.find((t) => t.id === c.templateId);
  if (!tm) return fail('no such template');
  const ids = [];
  let reason = null;
  const put = (dx, dy, defId, rot0, mat) => {
    const d = structDef(defId), [w, h] = sizeOf(d, rot0);
    const [rx, ry] = rotCell(dx, dy, w, h, tm.w, tm.h, c.rot);
    const r = planOne(s, defId, c.x + rx, c.y + ry, (rot0 + c.rot) & 3, mat);
    if (r.ok) ids.push(r.id); else if (!reason) reason = r.reason;
  };
  for (const [dx, dy, d, rot, mat] of tm.cells) put(dx, dy, d, rot, mat);
  for (const [dx, dy, d] of tm.floors) put(dx, dy, d, 0, null);
  return ids.length ? { ok: true, ids, n: ids.length } : fail(reason || 'nothing placed');
}

// ---- Deconstruct --------------------------------------------------------------------------------------------
function deconstruct(s, c) {
  const list = c.ids ? c.ids.map((id) => bldById(s, id)).filter(Boolean) : buildingsIn(s, c.rect, () => true);
  let n = 0;
  for (const b of list) {
    const d = structDef(b.def);
    if (d && hasFlag(d, 'start') && hasFlag(d, 'unique')) continue; // the Hearth stays
    if (b.st !== 'done') { removeBuilding(s, b); n++; }
    else if (!b.dcon) { b.dcon = true; n++; for (const fn of BUS.placed) fn(s, b); }
  }
  return n ? { ok: true, n } : fail('nothing to take down there');
}

// ---- Zones (5.6) ---------------------------------------------------------------------------------------
const ZONE_NAMES = { stockpile: 'Stockpile', grow: 'Grow zone', pen: 'Pen', burial: 'Burial ground', home: 'Home area', area: 'Allowed area', dump: 'Dump' };
function zoneTileOk(s, i, type) {
  const t = s.L.terrain[i];
  if (!TER_PASSABLE[t] || TER_WATER[t]) return false;
  if (type === 'grow' && !TER_FERTILE[t]) return false;
  const b = s.rt.occ[i] >= 0 ? s.bld[s.rt.occ[i]] : null;
  if (b) { const d = structDef(b.def); if (hasFlag(d, 'wall') || hasFlag(d, 'door') || (type === 'grow' && b.st === 'done')) return false; }
  return explored(s, i);
}
function setZoneTiles(s, tiles, v) {
  if (!tiles.length) return;
  withZoneEdit(s, tiles, () => { for (const i of tiles) s.L.zone[i] = v; });
  s.rt.dirty.zoneFields = true;
}
function lowestZoneId(s) {
  const used = new Uint8Array(ZONE_MAX + 2);
  for (const z of s.zones) used[z.id] = 1;
  for (let id = 1; id <= ZONE_MAX; id++) if (!used[id]) return id;
  return 0;
}
function presetFilter(presetId) {
  const p = presetId ? def('zonePreset', presetId) : null;
  return p ? { filter: { cats: p.cats.slice(), mats: [], q: [0, 6] }, pri: p.pri } : null;
}
function zoneNew(s, c) {
  const tiles = [];
  forRect(c.rect, (i) => { if (!s.L.zone[i] && zoneTileOk(s, i, c.type)) tiles.push(i); });
  if (!tiles.length) return fail('no free ground for a zone there');
  const id = lowestZoneId(s);
  if (!id) return fail('too many zones');
  const pf = presetFilter(c.preset || (c.type === 'stockpile' ? 'all' : c.type === 'dump' ? 'dump' : null));
  const nOfType = s.zones.filter((z) => z.type === c.type).length + 1;
  const z = newZone(id, c.type, { name: `${ZONE_NAMES[c.type] || 'Zone'} ${nOfType}`, ...(pf ? { filter: pf.filter, pri: pf.pri } : {}) });
  s.zones.push(z);
  s.zones.sort((a, b) => a.id - b.id);
  setZoneTiles(s, tiles, id);
  for (const fn of BUS.zoned) fn(s, z, tiles);
  return { ok: true, zoneId: id, n: tiles.length };
}
function unzoneTiles(s, z, tiles) {
  if (!z || !tiles.length) return 0;
  setZoneTiles(s, tiles, 0);
  for (const fn of BUS.zoned) fn(s, z, tiles);
  let left = false;
  for (let i = 0; i < N && !left; i++) if (s.L.zone[i] === z.id) left = true;
  if (!left) { s.zones.splice(s.zones.indexOf(z), 1); for (const fn of BUS.zoned) fn(s, null, []); }
  return tiles.length;
}
function zone(s, c) {
  if (c.op === 'new') return zoneNew(s, c);
  const z = zoneById(s, c.zoneId);
  if (c.op === 'expand') {
    const tiles = [];
    forRect(c.rect, (i) => { if (!s.L.zone[i] && zoneTileOk(s, i, z.type)) tiles.push(i); });
    if (!tiles.length) return fail('no free ground to add');
    setZoneTiles(s, tiles, z.id);
    for (const fn of BUS.zoned) fn(s, z, tiles);
    return { ok: true, zoneId: z.id, n: tiles.length };
  }
  if (c.op === 'shrink') {
    const tiles = [];
    forRect(c.rect, (i) => { if (s.L.zone[i] === z.id) tiles.push(i); });
    if (!tiles.length) return fail('that zone is not there');
    const n = unzoneTiles(s, z, tiles);
    return { ok: true, zoneId: zoneById(s, c.zoneId) ? z.id : null, n };
  }
  // delete
  const tiles = [];
  for (let i = 0; i < N; i++) if (s.L.zone[i] === z.id) tiles.push(i);
  if (tiles.length) unzoneTiles(s, z, tiles);
  else { s.zones.splice(s.zones.indexOf(z), 1); for (const fn of BUS.zoned) fn(s, null, []); }
  return { ok: true, n: tiles.length };
}
function zoneCfg(s, c) {
  const z = zoneById(s, c.zoneId);
  const p = c.patch;
  if ('name' in p) z.name = p.name;
  if ('pri' in p) z.pri = p.pri;
  if ('filter' in p) z.filter = { cats: p.filter.cats.slice(), mats: p.filter.mats.slice(), q: p.filter.q.slice() };
  if ('crop' in p) z.crop = p.crop;
  if ('area' in p) z.area = p.area === null ? null : JSON.parse(JSON.stringify(p.area));
  if ('pri' in p || 'filter' in p) s.rt.dirty.zoneFields = true;
  for (const fn of BUS.zoneCfg) fn(s, z);
  return { ok: true };
}

// ---- Bills (5.7) -----------------------------------------------------------------------------------------
const BILL_FIELDS = ['mode', 'n', 'paused', 'minSkill', 'maxSkill', 'radius', 'quality', 'store', 'ingredients'];
function bill(s, c) {
  const b = bldById(s, c.bId);
  const d = structDef(b.def);
  if (!d || !d.workbench) return fail('that is not a workbench');
  const v = c.bill;
  if (c.op === 'add') {
    const rd = def('recipe', v.recipe);
    if (rd && rd.bench && !rd.bench.includes(b.def)) return fail(`${rd.name} is not made at a ${d.name}`);
    const init = {};
    for (const k of BILL_FIELDS) if (v[k] !== undefined) init[k] = v[k];
    b.bills.push(newBill(v.recipe, init));
  } else if (c.op === 'edit') {
    const bl = b.bills[v.i];
    for (const k of BILL_FIELDS) if (v[k] !== undefined) bl[k] = v[k];
    if (bl.minSkill > bl.maxSkill) return fail('the skill range is upside down');
  } else if (c.op === 'remove') b.bills.splice(v.i, 1);
  else { const [x] = b.bills.splice(v.i, 1); b.bills.splice(v.to, 0, x); }
  for (const fn of BUS.billsChanged) fn(s, b);
  return { ok: true, n: b.bills.length };
}

// ---- Colonist settings ------------------------------------------------------------------------------------
function prio(s, c) {
  const col = colById(s, c.colId);
  col.prio[WORK_IDS.indexOf(c.work)] = c.p;
  col.custom = true;
  return { ok: true };
}
function sched(s, c) {
  const col = colById(s, c.colId);
  col.sched = Uint8Array.from(c.hours);
  return { ok: true };
}
function assign(s, c) {
  const b = bldById(s, c.bId);
  const d = structDef(b.def);
  if (!hasFlag(d, 'bed')) return fail('only beds are assigned in this version');
  if (b.owner !== null) { const prev = colById(s, b.owner); if (prev && prev.bed === b.id) prev.bed = null; }
  b.owner = c.colId;
  if (c.colId !== null) {
    const col = colById(s, c.colId);
    if (col.bed !== null && col.bed !== b.id) { const old = bldById(s, col.bed); if (old && old.owner === col.id) old.owner = null; }
    col.bed = b.id;
  }
  return { ok: true };
}

// ---- Forbid and prioritise ----------------------------------------------------------------------------------
function forbid(s, c) {
  let n = 0;
  const one = (id) => { if (itemById(s, id) && setForbidden(s, id, c.on)) { n++; for (const fn of BUS.forbidden) fn(s, 'item', id, c.on); } };
  if (c.ids) for (const id of c.ids) one(id);
  else forRect(c.rect, (i) => { const it = stackAt(s, i); if (it) one(it.id); });
  return n ? { ok: true, n } : fail(c.on ? 'nothing to forbid there' : 'nothing to allow there');
}
function prioritise(s, c) {
  const col = colById(s, c.colId);
  if (col.drafted) return fail('drafted colonists take orders instead');
  const r = firstHook(BUS.prioritise, s, col, c.target, c.work);
  return r ? { ok: true } : fail(`nothing for ${c.work} there`);
}

// the appliers that act on a level run with AZ set to the command's level (owners who wrap them, as E's
// designateWithLevels does, get the levelled version)
const LEVELLED = new Set(['designate', 'cancelRect', 'place', 'placeLine', 'stamp', 'carve', 'copyRoom', 'paste', 'deconstruct', 'zone', 'forbid']);
const levelled = (o) => Object.fromEntries(Object.entries(o).map(([k, f]) => [k, LEVELLED.has(k) ? (s, c) => atLevel(levelOfCmd(c), () => f(s, c)) : f]));
export const SLICE_APPLIERS = Object.freeze(levelled({
  designate, cancelRect, place, placeLine, stamp, carve, copyRoom, paste, deconstruct,
  zone, zoneCfg, bill, prio, sched, forbid, prioritise, assign,
}));

/** Register the slice appliers (idempotent). Owners may replace any of them afterwards. */
export function installCommands() {
  for (const [name, fn] of Object.entries(SLICE_APPLIERS)) registerApplier(name, fn);
}

// exported for tests and the UI previews (ghost footprints, stamp and carve previews)
export { rectN, borderOf };
/** Run fn with the appliers' level set to z (planners that share the appliers' rules: tools/stamp.js). */
export function atLevelOf(z, fn) { return atLevel(z, fn); }
