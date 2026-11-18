// Construction (doc 5.1 Build, 7.1; owner E): blueprint > frame > done, deliveries, deconstruction,
// and the carve-hall pillars planned on rock.
//
// Building records (schema C2): st 'bp' (a blueprint: nothing delivered yet), 'frame' (at least one
// delivery), 'done'. need { needKey: n } comes from A's needOf (furniture: its item kind; constructs:
// their cost, a kind, 'kind:material' or a category such as 'blocks'); got { itemKind: n } records
// what was delivered by actual item kind, so A's removeBuilding drops exactly those items when a
// frame is cancelled (5.4: a frame cancelled mid-build drops its materials). work is the build
// progress (x100 work units), kept on the building so a builder change or a save resumes it.
//
// Jobs: 'deliver' (fetch a needed material, then put it into one or more blueprints nearby that
// need the same thing), 'construct' (all materials in: work, then done) and 'deconstruct'. Every
// target building is claimed exclusively (keyBld) for the whole job, so one builder serves a frame
// at a time and a cancelled blueprint ends the job through endJobsOn.

import { W, H, idx, tx, ty } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { emit } from '../core/events.js';
import { bldById } from '../core/state.js';
import { def, all, structDef, hasFlag } from '../core/content.js';
import { TICKS_PER_MIN } from '../core/time.js';
import { addBuilding, removeBuilding, checkPlace, needOf, floorIdOf } from '../core/apply.js';
import { setOcc, setFloor, passable } from '../world/terrain.js';
import { footprint } from '../world/pass.js';
import {
  WORK, RUN, NEXT, END, T, makeJob, registerToil, registerEffect, keyBld, keyItem, keyId, myClaim, workHooks, isReserved,
} from './jobs.js';
import { itemDef, categoryOf, take, put, carried, spawn, freeCount, stackAt } from './items.js';
import { release, colTile } from './reserve.js';
import { refreshBuildingIndex, standSpot, distTo, reachableFrom } from './windex.js';
export { footprint };

// ---- Needs ------------------------------------------------------------------------------------------
/** Material groups an item kind can carry (items.js def `mat`: a group or a list of groups). */
function groupsOfKind(k) {
  const d = def('item', k);
  if (!d || !d.mat) return [];
  return Array.isArray(d.mat) ? d.mat : [d.mat];
}
const groupOfMat = (m) => { const d = m ? def('material', m) : null; return d ? d.group : null; };
/** Kinds whose category is `cat` (data order). */
const kindsOfCat = (cat) => all('item').filter((d) => d.cat === cat).map((d) => d.id);

/**
 * Item filter for a need key on building b: { k } for a kind, { k, m } for 'kind:material', { cat }
 * for a category. When the building has a material and the needed items can carry that material's
 * group (blocks for a granite wall), the filter asks for that exact material. Only structures whose
 * material is chosen (costByMat: walls, floors) are locked to it; a fixed-cost structure (a bloomery's
 * 6 rough stone) takes any stone, whatever its first delivery was (1b: a frame no longer waits for a
 * stone that is all used up).
 */
export function needFilter(key, b = null) {
  let f;
  if (key.includes(':')) { const [k, m] = key.split(':'); f = { k, m }; }
  else if (def('item', key)) f = { k: key };
  else f = { cat: key };
  const sd = b ? structDef(b.def) || {} : {};
  if (b && b.mat && f.m === undefined && sd.costByMat) {
    const g = groupOfMat(b.mat);
    const groups = f.k ? groupsOfKind(f.k) : kindsOfCat(f.cat).flatMap(groupsOfKind);
    if (g && groups.includes(g) && sd.kind !== 'furniture') f.m = b.mat;
  }
  return f;
}
/** Does an item (kind k, material m) satisfy need key `key` of building b? */
export function fitsNeed(key, k, m, b = null) {
  const f = needFilter(key, b);
  if (f.k ? f.k !== k : categoryOf(k) !== f.cat) return false;
  return f.m === undefined || f.m === null || f.m === m;
}
/** Units of need key `key` delivered to b. */
export function gotFor(b, key) {
  const f = needFilter(key);
  let n = 0;
  for (const k of Object.keys(b.got || {}).sort()) if (f.k ? f.k === k : categoryOf(k) === f.cat) n += b.got[k] | 0;
  return n;
}
/** Units still to deliver for need key `key`. */
export const remaining = (b, key) => Math.max(0, ((b.need && b.need[key]) | 0) - gotFor(b, key));
/** Need keys of b with something left to deliver (sorted). */
export const openNeeds = (b) => Object.keys(b.need || {}).sort().filter((k) => remaining(b, k) > 0);
/** All materials delivered? */
export const supplied = (b) => openNeeds(b).length === 0;

/** Build work of b in work units x100 (game minutes x material work% x ticks per minute x 100). */
export function buildWork(b) {
  const d = structDef(b.def);
  const min = d && d.work ? d.work : d && d.kind === 'furniture' ? WORK.installMin : WORK.installMin;
  const md = b.mat ? def('material', b.mat) : null;
  const pct = md && md.work ? md.work : 100;
  return Math.max(1, Math.floor((min * pct) / 100)) * TICKS_PER_MIN * 100;
}

/** Carry capacity in units of kind k for a colonist (5.6: 35 mass x Might factor). */
export function capUnits(col, k) {
  const might = col.at ? col.at[0] | 0 : 2;
  const massCap = Math.floor((WORK.carryMass * (100 + WORK.carryMightPct * (might - 2))) / 100);
  const m = itemDef(k).mass;
  if (!(m > 0)) return 1 << 20;
  return Math.max(1, Math.floor(massCap / m));
}

// ---- Delivery plans --------------------------------------------------------------------------------------
/** Matching stacks free for `col`, in col's component, nearest by straight distance (at most k). */
function sourcesFor(s, col, f, k = WORK.candidatesK) {
  const b = s.rt.idx.items;
  const bucket = f.k ? b[f.k] : b['@' + f.cat];
  if (!bucket) return [];
  const ci = colTile(col), cx = tx(ci), cy = ty(ci);
  const out = [];
  for (const id of bucket) {
    const it = s.items[id];
    if (it.f || (f.k && f.cat && categoryOf(it.k) !== f.cat)) continue;
    if (f.m !== undefined && f.m !== null && it.m !== f.m) continue;
    if (freeCount(s, id, col.id) <= 0) continue;
    if (!reachableFrom(s, col, idx(it.x, it.y))) continue;
    out.push([(it.x - cx) * (it.x - cx) + (it.y - cy) * (it.y - cy), id]);
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return out.slice(0, k).map((p) => s.items[p[1]]);
}

/**
 * A delivery for blueprint b: the nearest (region-graph) source stack of its first open need that
 * has one, the amount, extra blueprints within WORK.deliverR needing the same thing, and a top-up.
 * @returns {null | { job, claims }}
 */
export function deliveryJob(s, col, b) {
  for (const key of openNeeds(b)) {
    const f = needFilter(key, b);
    const src = sourcesFor(s, col, f);
    if (!src.length) continue;
    let it = null, bd = Infinity;
    for (const c of src) { const d = distTo(s, col, idx(c.x, c.y)); if (d < bd) { bd = d; it = c; } }
    if (!it) continue;
    const cap = capUnits(col, it.k);
    // targets: b first, then other open blueprints nearby with the same need and material
    const targets = [[b, Math.min(remaining(b, key), cap)]];
    let total = targets[0][1];
    if (total < cap && (structDef(b.def) || {}).kind !== 'furniture') {
      const near = [];
      for (const o of s.bld) {
        if (!o || o === b || o.st === 'done' || o.dcon || Math.max(Math.abs(o.x - b.x), Math.abs(o.y - b.y)) > WORK.deliverR) continue;
        if (!o.need || !(key in o.need) || remaining(o, key) <= 0) continue;
        const of = needFilter(key, o);
        if (of.m !== undefined && of.m !== it.m) continue;
        if (isReserved(s, keyBld(o.id), col.id)) continue;
        near.push([Math.max(Math.abs(o.x - b.x), Math.abs(o.y - b.y)), o.id, o]);
      }
      near.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      for (const [, , o] of near) {
        if (targets.length >= WORK.deliverMax || total >= cap) break;
        const n = Math.min(remaining(o, key), cap - total);
        targets.push([o, n]); total += n;
      }
    }
    const take1 = Math.min(total, freeCount(s, it.id, col.id));
    if (take1 <= 0) continue;
    const toils = [T.goto(idx(it.x, it.y)), T.pickup(it.id, take1)];
    const claims = [[keyItem(it.id), take1]];
    let got = take1;
    // top-up: same kind, material and quality within WORK.topUpR of the first stack
    if (got < total) {
      for (const o of sourcesFor(s, col, { k: it.k, m: it.m })) {
        if (o.id === it.id || o.q !== it.q || Math.max(Math.abs(o.x - it.x), Math.abs(o.y - it.y)) > WORK.topUpR) continue;
        const n2 = Math.min(total - got, freeCount(s, o.id, col.id));
        if (n2 <= 0) continue;
        toils.push(T.goto(idx(o.x, o.y)), T.pickup(o.id, n2));
        claims.push([keyItem(o.id), n2]);
        got += n2;
        break;
      }
    }
    // trim targets to what is carried
    let left = got;
    const fin = [];
    for (const [o, n] of targets) { if (left <= 0) break; const m = Math.min(n, left); fin.push([o, m]); left -= m; }
    for (const [o, m] of fin) {
      const st = standSpot(s, col, footprint(s, o));
      if (st.i < 0) { if (o === b) return null; continue; }
      toils.push({ t: 'carry', i: st.i, adj: 0 }, { t: 'deliver', b: o.id, n: m });
      claims.push([keyBld(o.id), 0]);
    }
    return { job: makeJob('deliver', keyBld(b.id), toils), claims };
  }
  return null;
}

/** A construct job for a fully supplied blueprint or frame. */
export function constructJob(s, col, b) {
  const st = standSpot(s, col, footprint(s, b));
  if (st.i < 0) return null;
  return { job: makeJob('construct', keyBld(b.id), [T.goto(st.i), { t: 'construct', b: b.id, sk: 'construction' }]), claims: [[keyBld(b.id), 0]] };
}
/** A deconstruct job for a finished building marked dcon. */
export function deconstructJob(s, col, b) {
  const st = standSpot(s, col, footprint(s, b));
  if (st.i < 0) return null;
  const n = Math.max(1, Math.floor(buildWork(b) / 200));   // half the build work, in ticks
  return { job: makeJob('deconstruct', keyBld(b.id), [T.goto(st.i), T.work(n, { sk: 'construction', fx: 'deconstruct', key: keyBld(b.id) })]), claims: [[keyBld(b.id), 0]] };
}

// ---- Toils -------------------------------------------------------------------------------------------
const nearBld = (s, col, b) => {
  const ci = colTile(col), x = tx(ci), y = ty(ci);
  for (const i of footprint(s, b)) if (Math.max(Math.abs(tx(i) - x), Math.abs(ty(i) - y)) <= 1) return true;
  return false;
};
registerToil('deliver', (s, col, job, toil) => {
  const b = bldById(s, toil.b);
  if (!b || b.st === 'done') return END.TARGET_GONE;
  if (myClaim(s, keyBld(b.id), col.id) < 0) return 'lostClaim';
  const c = carried(col);
  if (!c) return NEXT;
  if (!nearBld(s, col, b)) return 'notThere';
  let n = Math.min(c.n, toil.n);
  for (const key of openNeeds(b)) {
    if (n <= 0) break;
    if (!fitsNeed(key, c.k, c.m, b)) continue;
    const amt = Math.min(n, remaining(b, key));
    if (amt <= 0) continue;
    c.n -= amt; n -= amt;
    b.got[c.k] = (b.got[c.k] | 0) + amt;
    if (!b.mat && c.m) b.mat = c.m;
    if ((structDef(b.def) || {}).kind === 'furniture') { b.q = c.q | 0; if (c.maker !== null && c.maker !== undefined) b.maker = c.maker; if (c.name) b.name = c.name; }
    if (b.st === 'bp') b.st = 'frame';
  }
  if (c.n <= 0) job.carry = null;
  return NEXT;
});
registerToil('construct', (s, col, job, toil) => {
  const b = bldById(s, toil.b);
  if (!b || b.st === 'done') return END.TARGET_GONE;
  if (myClaim(s, keyBld(b.id), col.id) < 0) return 'lostClaim';
  if (!supplied(b)) return 'needsMaterials';
  if (!nearBld(s, col, b)) return 'notThere';
  const h = workHooks();
  const sp = h.speed(s, col, toil) | 0;
  if (sp > 0) b.work += sp;
  if (h.xp) h.xp(s, col, toil.sk, 1);
  if (b.work < buildWork(b)) return RUN;
  release(s, col, keyBld(b.id));
  completeBuilding(s, b, col);
  return NEXT;
});

/** Move stacks off a finished building's footprint, and colonists out of a footprint that now blocks. */
function clearFootprint(s, b) {
  for (const i of footprint(s, b)) {
    const it = stackAt(s, i);
    if (!it) continue;
    const bundle = take(s, it.id, it.n);
    if (bundle) put(s, bundle, tx(i), ty(i));
  }
}
function pushOutColonists(s, b) {
  const fp = footprint(s, b);
  for (const c of s.col) {
    const ci = colTile(c);
    if (!fp.includes(ci) || passable(s, ci, 0)) continue;
    const to = nearestOpen(s, tx(ci), ty(ci));
    if (to >= 0) { c.x = tx(to) * 32 + 16; c.y = ty(to) * 32 + 16; c.path = null; }
  }
}
function nearestOpen(s, x, y) {
  for (let r = 1; r <= 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      if (passable(s, idx(xx, yy), 0)) return idx(xx, yy);
    }
  }
  return -1;
}

/** Blueprint or frame done: floors go into the floor layer, everything else becomes a finished building. */
export function completeBuilding(s, b, col = null) {
  const d = structDef(b.def);
  if (hasFlag(d, 'floor')) {
    b.st = 'done';
    const fid = floorIdOf(b.def);
    for (const i of footprint(s, b)) setFloor(s, i, fid);
    for (const fn of BUS.built) fn(s, b);
    emit(s, 'built', { bId: b.id, def: b.def, colId: col ? col.id : null });
    removeBuilding(s, b);
    return;
  }
  // B's setOcc derives walk, support and opacity changes by comparing the tiles before and after
  // the call, so the footprint is lifted, the record changed, and the footprint put back.
  setOcc(s, b, false);
  b.st = 'done';
  b.got = {}; b.need = {}; b.work = 0;
  const md = b.mat ? def('material', b.mat) : null;
  if (d && d.hp) b.hp = Math.floor((d.hp * (md && md.hp ? md.hp : 100)) / 100);
  setOcc(s, b, true);
  clearFootprint(s, b);
  pushOutColonists(s, b);
  refreshBuildingIndex(s, b);
  for (const fn of BUS.built) fn(s, b);
  emit(s, 'built', { bId: b.id, def: b.def, colId: col ? col.id : null });
}

/** What deconstructing b returns: [[kind, mat, q, n]]. Furniture: its item; constructs: refundPct of the cost. */
export function refundOf(b) {
  const d = structDef(b.def);
  if (!d) return [];
  if (d.kind === 'furniture') return def('item', d.item || d.id) ? [[d.item || d.id, b.mat, b.q | 0, 1]] : [];
  const out = [];
  const cost = needOf(d, b.mat);
  for (const key of Object.keys(cost).sort()) {
    const n = Math.floor(((cost[key] | 0) * WORK.refundPct) / 100);
    if (n <= 0) continue;
    let k = key, m = b.mat;
    if (key.includes(':')) [k, m] = key.split(':');
    if (!def('item', k)) { const ks = kindsOfCat(key); if (!ks.length) continue; k = ks[0]; }
    const groups = groupsOfKind(k), g = groupOfMat(m);
    out.push([k, g && groups.includes(g) ? m : null, 0, n]);
  }
  return out;
}
registerEffect('deconstruct', (s, col, job) => {
  const b = bldById(s, keyId(job.target));
  if (!b || b.st !== 'done' || !b.dcon) return END.TARGET_GONE;
  const back = refundOf(b);
  const x = b.x, y = b.y;
  release(s, col, keyBld(b.id));
  removeBuilding(s, b);
  for (const [k, m, q, n] of back) spawn(s, k, m, q, n, x, y);
  return undefined;
});

// ---- Carve-hall pillars on rock (A's plans: colony.plans[].pillars minus natural) -------------------------
const supportDef = (pattern) => {
  const sup = all('structure').filter((d) => hasFlag(d, 'support') && !hasFlag(d, 'wall') && !hasFlag(d, 'door'));
  const want = pattern === 'prop' ? 'prop' : 'pillar';
  return sup.find((d) => d.id.includes(want)) || sup.find((d) => d.id.includes(want === 'prop' ? 'pillar' : 'prop')) || null;
};
/** Tile i was just mined: if a carve plan wants a built pillar or prop there, plan its blueprint now. */
export function placePlannedSupport(s, i) {
  for (const p of s.colony.plans || []) {
    if (p.kind !== 'carve' || !p.pillars.includes(i) || p.natural.includes(i)) continue;
    if (p.pattern !== 'pillar' && p.pattern !== 'prop') continue;
    const d = supportDef(p.pattern);
    if (!d) return null;
    if (checkPlace(s, d.id, tx(i), ty(i), 0)) return null;
    const b = addBuilding(s, d.id, tx(i), ty(i), 0, null);
    if (Array.isArray(p.built)) p.built.push(b.id);
    return b.id;
  }
  return null;
}

/** Ranking key for a Build candidate (region-graph distance to its standing spot). */
export function buildDist(s, col, b) { return standSpot(s, col, footprint(s, b)).d; }
