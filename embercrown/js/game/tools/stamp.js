// Room stamps (owner I; doc 10.11, 13.1 `js/game/tools/stamp.js`). The planner behind the stamp
// preview: what `stamp {kind, rect, wallMat, floorMat, door, furnish, bench}` (C3; applied by A's
// core/apply.js) will place, computed read-only with the same rules (checkPlace, stampDoor, the
// border order, furniture first-fit, floors around the furniture). The UI draws the plan, lets the
// player drag the door marker, then sends the one command.
import { idx as gidx, inB, TER, PLANE } from '../core/grid.js';
import { def, all, structDef, hasFlag, sizeOf, tilesOf } from '../core/content.js';
import { checkPlace, stampDoor, borderOf, rectN, floorIdOf, atLevelOf } from '../core/apply.js';
import { sumNeeds } from './place.js';

/** Stamp defs (rooms.js `stamp`), data order. */
export const stampDefs = () => all('stamp');
/** Workbenches a Workshop stamp can hold (structures with a workbench, in data order). */
export const benchDefs = () => all('structure').filter((d) => d.workbench);

// Levels (Stage Z1, EMBERCROWN-FORTRESS.md 4.4; E13 gate fix): with o.rect.z the plan reads that level, through the
// appliers' own level (atLevelOf), so checkPlace and stampDoor see what the applier will; tile indexes are voxels.
let PZ = 0;
const idx = (x, y) => gidx(x, y, PZ);
const tilesAtZ = (d, x, y, rot) => { const a = tilesOf(d, x, y, rot); if (PZ) for (let k = 0; k < a.length; k++) a[k] += PZ * PLANE; return a; };

const STRUCTS = (flag) => all('structure').filter((d) => hasFlag(d, flag));
export const wallDefId = () => (STRUCTS('wall').find((d) => !hasFlag(d, 'door')) || { id: 'wall' }).id;
export const doorDefId = () => (STRUCTS('door')[0] || { id: 'door' }).id;
const groupOf = (m) => { const d = m ? def('material', m) : null; return d ? d.group : null; };
const CAT_OF_GROUP = { wood: 'wood', stone: 'blocks', metal: 'ingots', cloth: 'cloth', hide: 'leather' };
/** The floor def a floor material lays (the applier's floorDefFor). */
export function floorDefFor(mat) {
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
const isWallAt = (s, i) => {
  const t = s.L.terrain[i];
  if (t === TER.ROCK || t === TER.RUBBLE) return true;
  const b = s.rt.occ[i] >= 0 ? s.bld[s.rt.occ[i]] : null;
  return !!b && (hasFlag(structDef(b.def), 'wall') || hasFlag(structDef(b.def), 'door'));
};
const isCorner = (q, x, y) => (x === q.x0 || x === q.x1) && (y === q.y0 || y === q.y1);
/** Is (x, y) a tile the door may sit on (a side of q, not a corner)? */
export function doorSpotOk(q, x, y) {
  const onSide = (x === q.x0 || x === q.x1) ? y >= q.y0 && y <= q.y1 : (y === q.y0 || y === q.y1) && x >= q.x0 && x <= q.x1;
  return onSide && !isCorner(q, x, y);
}
/** The door spot on q's sides nearest to tile (x, y) (for dragging the door marker). */
export function snapDoor(q, x, y) {
  let best = null, bd = Infinity;
  for (const [bx, by] of borderOf(q)) {
    if (isCorner(q, bx, by)) continue;
    const d = (bx - x) * (bx - x) + (by - y) * (by - y);
    if (d < bd) { bd = d; best = { x: bx, y: by }; }
  }
  return best;
}

/**
 * The plan of one stamp, read-only.
 * @param {object} s     the colony
 * @param {object} o     { kind, rect, wallMat?, floorMat?, door?: {x,y}, furnish, bench? }
 * @returns {{ ok, why, q, inner, walls: [{x,y,i,st}], door: {x,y,ok,why}|null, floors: [{i,ok}],
 *   furniture: [{def,x,y,rot,tiles,ok}], zone: boolean, need: object, counts: object }}
 *   wall st: 'new' (a blueprint), 'reuse' (rock or a wall already there), 'blocked' (with why).
 */
export function stampPlan(s, o) {
  const z = o && o.rect ? o.rect.z | 0 : 0;
  if (!z) return planAt(s, o);
  const keep = PZ;
  PZ = z;
  try { return atLevelOf(z, () => planAt(s, o)); } finally { PZ = keep; }
}
function planAt(s, o) {
  const sd = def('stamp', o.kind);
  const q = rectN(o.rect);
  const w = q.x1 - q.x0 + 1, h = q.y1 - q.y0 + 1;
  const min = sd ? sd.minSize : 3;
  const plan = { ok: false, why: null, q, inner: null, walls: [], door: null, floors: [], furniture: [], zone: false, need: {}, counts: { walls: 0, floors: 0, furniture: 0, reused: 0, blocked: 0 } };
  if (w < min || h < min) { plan.why = `a ${sd ? sd.name.toLowerCase() : 'room'} needs at least ${min} x ${min}`; return plan; }
  const inner = { x0: q.x0 + 1, y0: q.y0 + 1, x1: q.x1 - 1, y1: q.y1 - 1 };
  plan.inner = inner;
  if (o.door && !doorSpotOk(q, o.door.x, o.door.y)) { plan.why = 'the door must be on a side of the room'; return plan; }
  const doorAt = stampDoor(s, q, o.door || null);
  const wdef = wallDefId(), ddef = doorDefId();
  const costs = [];
  const taken = new Set();
  for (const [x, y] of borderOf(q)) {
    const i = idx(x, y);
    const isDoor = !!doorAt && doorAt[0] === x && doorAt[1] === y;
    if (isDoor) {
      const b = s.rt.occ[i] >= 0 ? s.bld[s.rt.occ[i]] : null;
      let why = null;
      if (b && hasFlag(structDef(b.def), 'door')) why = null;
      else if (!(b && b.st !== 'done')) why = checkPlace(s, ddef, x, y, 0);
      plan.door = { x, y, i, ok: !why, why };
      if (!why && !(b && hasFlag(structDef(b.def), 'door'))) costs.push([ddef, null]);
      taken.add(i);
      continue;
    }
    if (isWallAt(s, i)) { plan.walls.push({ x, y, i, st: 'reuse' }); plan.counts.reused++; continue; }
    const why = checkPlace(s, wdef, x, y, 0);
    if (why) { plan.walls.push({ x, y, i, st: 'blocked', why }); plan.counts.blocked++; continue; }
    plan.walls.push({ x, y, i, st: 'new' }); plan.counts.walls++; costs.push([wdef, o.wallMat || null]);
    taken.add(i);
  }
  // furniture first (the tile inside the door stays free), then floors around it
  const inTaken = new Set();
  if (doorAt) {
    const [dx, dy] = doorAt;
    const ix = dx === q.x0 ? dx + 1 : dx === q.x1 ? dx - 1 : dx, iy = dy === q.y0 ? dy + 1 : dy === q.y1 ? dy - 1 : dy;
    if (inB(ix, iy)) inTaken.add(idx(ix, iy));
  }
  const area = (inner.x1 - inner.x0 + 1) * (inner.y1 - inner.y0 + 1);
  if (o.furnish && sd && inner.x1 >= inner.x0 && inner.y1 >= inner.y0) {
    const list = [];
    if (sd.bench && o.bench) list.push(o.bench);
    for (const f of sd.furnish) {
      const n = f.per ? Math.max(1, Math.floor(area / f.per)) : 1;
      for (let k = 0; k < n; k++) list.push(f.def);
    }
    for (const fdef of list) {
      const fd = structDef(fdef);
      if (fd && fd.kind === 'zone') { plan.zone = true; continue; }
      const spot = fitFurniture(s, fdef, inner, inTaken);
      if (!spot) { plan.furniture.push({ def: fdef, x: inner.x0, y: inner.y0, rot: 0, tiles: [], ok: false, why: `no room for ${fd ? fd.name : fdef}` }); continue; }
      plan.furniture.push({ def: fdef, ...spot, ok: true });
      plan.counts.furniture++;
      costs.push([fdef, null]);
      for (const i of spot.tiles) inTaken.add(i);
    }
  }
  const fdef = floorDefFor(o.floorMat || null);
  if (fdef && inner.x1 >= inner.x0 && inner.y1 >= inner.y0) {
    const fid = floorIdOf(fdef);
    for (let y = inner.y0; y <= inner.y1; y++) for (let x = inner.x0; x <= inner.x1; x++) {
      const i = idx(x, y);
      if (inTaken.has(i) && plan.furniture.some((f) => f.tiles.includes(i))) continue;
      if (s.rt.occ[i] >= 0) continue;
      if (s.L.floor[i] === fid) continue;
      const why = checkPlace(s, fdef, x, y, 0);
      plan.floors.push({ i, ok: !why, why });
      if (!why) { plan.counts.floors++; costs.push([fdef, o.floorMat || null]); }
    }
  }
  plan.need = sumNeeds(costs);
  const anything = plan.counts.walls + plan.counts.floors + plan.counts.furniture + (plan.door && plan.door.ok ? 1 : 0) + (plan.zone ? 1 : 0);
  if (!anything) {
    const firstBad = plan.walls.find((x) => x.st === 'blocked') || plan.floors.find((x) => !x.ok);
    plan.why = firstBad ? firstBad.why : 'nothing to build there';
  } else plan.ok = true;
  return plan;
}

/** First fit inside `inner` in scan order, rotation 0 then 1, avoiding `taken` (the applier's rule). */
function fitFurniture(s, defId, inner, taken) {
  const d = structDef(defId);
  if (!d) return null;
  for (const rot of [0, 1]) {
    const [w, h] = sizeOf(d, rot);
    for (let y = inner.y0; y + h - 1 <= inner.y1; y++) {
      for (let x = inner.x0; x + w - 1 <= inner.x1; x++) {
        const tiles = tilesAtZ(d, x, y, rot);
        if (tiles.some((i) => taken.has(i))) continue;
        if (checkPlace(s, defId, x, y, rot)) continue;
        return { x, y, rot, tiles };
      }
    }
  }
  return null;
}

/** The command for a plan (C3 `stamp`). */
export function stampCommand(o, plan) {
  const c = { t: 'stamp', kind: o.kind, rect: { x0: plan.q.x0, y0: plan.q.y0, x1: plan.q.x1, y1: plan.q.y1 }, furnish: !!o.furnish };
  if (o.rect && o.rect.z !== undefined) c.rect.z = o.rect.z;
  if (o.wallMat) c.wallMat = o.wallMat;
  if (o.floorMat) c.floorMat = o.floorMat;
  if (o.door) c.door = { x: o.door.x, y: o.door.y };
  if (o.bench) c.bench = o.bench;
  return c;
}

/** "Bedroom 5 x 4: 12 walls, a door, 6 floor tiles, bed" for the hint and the loupe. */
export function stampLabel(o, plan) {
  const sd = def('stamp', o.kind);
  const name = sd ? sd.name : 'Room';
  const w = plan.q.x1 - plan.q.x0 + 1, h = plan.q.y1 - plan.q.y0 + 1;
  if (!plan.ok) return `${name} ${w} x ${h}: ${plan.why}`;
  const parts = [];
  if (plan.counts.walls) parts.push(`${plan.counts.walls} wall${plan.counts.walls === 1 ? '' : 's'}`);
  if (plan.door && plan.door.ok) parts.push('a door');
  if (plan.counts.floors) parts.push(`${plan.counts.floors} floor`);
  for (const f of plan.furniture) if (f.ok) { const d = structDef(f.def); parts.push(d ? d.name.toLowerCase() : f.def); }
  if (plan.zone) parts.push('a stockpile');
  return `${name} ${w} x ${h}: ${parts.join(', ')}`;
}

