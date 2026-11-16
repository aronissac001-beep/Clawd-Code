// Combat commitment helpers (rework Stream B). Shared by squads, the Sovereign and heroes.
//
// Contract (EMBERCROWN-REWORK.md section 3.0):
//   acquire(s, e, opts)  pick a foe for friendly e. opts:
//       x, y       search origin (default: e itself); the foe nearest to it wins
//       radius     world units around the origin
//       center     { x, y } of the area being defended (squad zone, Sovereign anchor, hero post)
//       leash      world units: foes farther than this from `center` are ignored
//       los        true: melee line of sight (walls block; arrows fly over, so ranged units
//                  pass false)
//       ranged     the unit shoots (it may target flyers and needs no attack slot)
//       filter     optional extra predicate (e) => bool
//       noGuards   skip homebound beasts (e.guard)
//       front      prefer foes on the side e faces (a foe behind counts 1.5x as far), so a
//                  fighter does not spin round after every kill
//     Returns the foe or null. Melee units only get foes with a free attack slot.
//   hold(e, secs, foe)  stand still for secs after a kill, facing the last foe (e.holdT, e.hfx).
//   attackSlot(target, e)  claim (or keep) a place on the ring around target for melee
//     attacker e. Returns { x, y } of the slot, or null when 3 (small foes) or 4 (big foes)
//     attackers already hold one: the caller then picks another foe.
//   releaseSlot(e)  give up e's slot (target changed or died).
//   guardZone(s, q, hasRanged, members, opts)  update squad q's working rally point (q.wx, q.wy)
//     from threats inside its guard zone: a besieged building moves it to the inner side of that
//     building, a foe in the zone moves it to the foe; it returns to the ordered point 3 s after
//     the last threat. hasRanged: the squad can shoot flyers. members: its live soldiers (to tell
//     when a fresh order has been reached). opts (optional): { radius (world units, default
//     zoneRadius tiles), foes (default true; false: only besieged buildings count), ret (seconds
//     after the last threat before walking back; default zoneReturn) }. The
//     Sovereign uses it too, with a holder object (v.zone) and buildings only.
//
// Per-mover fields (plain JSON): slotFoe (foe id whose ring we stand on), slotA (ring angle),
//   holdT (seconds of post-kill hold left), hfx/hfy (where the last foe stood), tgtT (seconds
//   on the current target), tgtId (which target tgtT counts for).
// Squad fields (plain JSON): wx, wy (working rally point), ox, oy (last ordered point seen),
//   thr (current threat: building id or foe id), thrK ('b' | 'e'), thrT (last time it was
//   seen), zT (next zone check), march (1 while walking to a new order), sx, sy, sb (the side of
//   besieged building sb its attacker was last seen on).
// Cache (not saved): the per-tick slot registry below, rebuilt from the mover fields each tick,
//   so a save/load reproduces it exactly.
import { BAL } from '../../data/balance.js';
import { T, N, idx, tileOf, distToRect } from '../grid.js';
import { BUILDINGS } from '../../data/buildings.js';
import { losClear, solidForFriend } from './pathing.js';

const C = BAL.combat;
const LOCO_FACE_MIN = 4; // movement.js setFacing ignores |dx| at or below this

// ---- Attack slots ---------------------------------------------------------------------------
// foe id -> array of attacker ids followed by their ring angles: [id, a, id, a, ...]
const CLAIMS = new Map();
let claimTick = -1;

/** Most melee attackers a foe accepts at once. */
export function slotCap(t) {
  return (t.r || 6) >= 8 || (t.scale || 1) > 1.2 || t.boss ? C.slotsBig : C.slotsSmall;
}
function listOf(id) { let l = CLAIMS.get(id); if (!l) { l = []; CLAIMS.set(id, l); } return l; }

/** Start of the friendly update each tick: rebuild the registry from every friendly's saved
 *  claim, dropping claims on dead foes and any over the cap (in update order). */
export function beginSlots(s) {
  claimTick = s.tick;
  CLAIMS.clear();
  const add = (u) => {
    if (!u || !u.alive || !u.slotFoe) return;
    const t = s.rt.eById.get(u.slotFoe);
    if (!t || !t.alive || u.targetId !== u.slotFoe) { u.slotFoe = 0; return; }
    const l = listOf(t.id);
    if (l.length / 2 >= slotCap(t)) { u.slotFoe = 0; return; }
    l.push(u.id, u.slotA || 0);
  };
  for (const u of s.soldiers) add(u);
  add(s.sovereign);
  for (const u of s.heroes) add(u);
}
function ensure(s) { if (claimTick !== s.tick) beginSlots(s); }

/** Number of melee attackers holding a slot on foe t (not counting e). */
export function attackers(t, e) {
  const l = CLAIMS.get(t.id);
  if (!l) return 0;
  let n = l.length / 2;
  for (let i = 0; i < l.length; i += 2) if (l[i] === e.id) n--;
  return n;
}
function hasRoom(t, e) {
  if (e.slotFoe === t.id) return true;
  return attackers(t, e) < slotCap(t);
}

const SLOT = { x: 0, y: 0 };
/** Claim or keep a slot on t's ring. Returns a shared { x, y } (read at once) or null if full.
 *  reach: e's melee reach against target in world units (sets the ring radius). */
export function attackSlot(target, e, s, reach) {
  if (s) ensure(s);
  const l = listOf(target.id);
  let k = -1;
  for (let i = 0; i < l.length; i += 2) if (l[i] === e.id) { k = i; break; }
  if (k < 0) {
    if (l.length / 2 >= slotCap(target)) return null;
    if (e.slotFoe && e.slotFoe !== target.id) releaseSlot(e);
    // Approach angle, pushed apart from the angles already taken.
    let a = Math.atan2(e.y - target.y, e.x - target.x);
    const sep = (2 * Math.PI) / (slotCap(target) + 1);
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (let i = 0; i < l.length; i += 2) {
        let da = a - l[i + 1];
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) < sep) { a = l[i + 1] + (da >= 0 ? sep : -sep); moved = true; }
      }
      if (!moved) break;
    }
    a = Math.round(a * 1000) / 1000; // plain, stable numbers in the save
    l.push(e.id, a);
    k = l.length - 2;
    e.slotFoe = target.id; e.slotA = a;
  }
  const a = l[k + 1];
  const ring = (reach || meleeReach(target, e)) * 0.78;
  SLOT.x = target.x + Math.cos(a) * ring; SLOT.y = target.y + Math.sin(a) * ring;
  return SLOT;
}
/** Melee reach from e to t in world units, for a weapon range in tiles. */
export function meleeReach(t, e, rangeTiles = 0.9) { return rangeTiles * T + (t.r || 6) + (e.r || 6) * 0.5; }

export function releaseSlot(e) {
  if (!e.slotFoe) return;
  const l = CLAIMS.get(e.slotFoe);
  if (l) for (let i = 0; i < l.length; i += 2) if (l[i] === e.id) { l.splice(i, 2); break; }
  e.slotFoe = 0;
}

// ---- Target choice --------------------------------------------------------------------------
let qE = null, qO = null, qS = null, qBest = null, qBd = 0;
function consider(t) {
  const o = qO;
  if (t.flying && !o.ranged) return false;
  if (t.guard && o.noGuards) return false; // homebound beasts are left alone unless ordered
  const dx = t.x - o.ox, dy = t.y - o.oy;
  let d = dx * dx + dy * dy;
  if (o.front && qE.face && (t.x - qE.x) * qE.face < -LOCO_FACE_MIN) d *= 2.25;
  if (d >= qBd) return false;
  if (o.center && Math.hypot(t.x - o.center.x, t.y - o.center.y) > o.leash) return false;
  if (o.filter && !o.filter(t)) return false;
  if (!o.ranged && !hasRoom(t, qE)) return false;
  if (o.los && !losClear(qS, qE.x, qE.y, t.x, t.y, 'friend')) return false;
  qBd = d; qBest = t;
  return false;
}
/** The foe nearest to the search origin that passes every test (see the header). */
export function acquire(s, e, opts) {
  ensure(s);
  const o = qO = {
    ox: opts.x !== undefined ? opts.x : e.x, oy: opts.y !== undefined ? opts.y : e.y,
    center: opts.center || null, leash: opts.leash || Infinity, los: !!opts.los,
    ranged: !!opts.ranged, filter: opts.filter || null, noGuards: !!opts.noGuards, front: !!opts.front,
  };
  qE = e; qS = s; qBest = null; qBd = opts.radius * opts.radius;
  s.rt.enemyHash.each(o.ox, o.oy, opts.radius, consider);
  const best = qBest;
  qE = null; qO = null; qS = null; qBest = null;
  return best;
}

/** Can melee attacker e strike t from where it stands (reach and line of sight)? */
export function canStrike(s, e, t, reach) {
  const dx = t.x - e.x, dy = t.y - e.y;
  if (dx * dx + dy * dy > reach * reach) return false;
  return losClear(s, e.x, e.y, t.x, t.y, 'friend');
}

// ---- Hold after a kill ----------------------------------------------------------------------
export function hold(e, secs, foe) {
  e.holdT = secs;
  if (foe) { e.hfx = Math.round(foe.x * 10) / 10; e.hfy = Math.round(foe.y * 10) / 10; }
}
/** Seconds of post-kill hold for this mover (0.8-1.2 s, fixed by its id). */
export function holdSecs(e) { return C.holdAfterKill[0] + ((e.id * 7) % 5) * ((C.holdAfterKill[1] - C.holdAfterKill[0]) / 4); }

/** Bookkeeping when a mover's target changes (call once per tick with its current target). */
export function trackTarget(e, t, dt) {
  if (!t) { e.tgtId = 0; e.tgtT = 0; return; }
  if (e.tgtId !== t.id) { e.tgtId = t.id; e.tgtT = 0; } else e.tgtT = (e.tgtT || 0) + dt;
  e.hfx = Math.round(t.x * 10) / 10; e.hfy = Math.round(t.y * 10) / 10;
}

// ---- Squad guard zones ----------------------------------------------------------------------
/** A walkable point on the inner side of building b (the side facing (fx, fy)). */
function innerPoint(s, b, fx, fy, out) {
  const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
  let dx = fx - cx, dy = fy - cy, l = Math.hypot(dx, dy);
  const h = s.rt.hearth;
  if (l < 4 && h) { dx = (h.tx + h.size / 2) * T - cx; dy = (h.ty + h.size / 2) * T - cy; l = Math.hypot(dx, dy); }
  if (l < 1) { dx = 0; dy = 1; l = 1; }
  const base = Math.atan2(dy, dx);
  const r = (b.size / 2 + 0.75) * T;
  for (const da of [0, 0.6, -0.6, 1.2, -1.2, 1.6, -1.6]) {
    const x = cx + Math.cos(base + da) * r, y = cy + Math.sin(base + da) * r;
    const tx = tileOf(x), ty = tileOf(y);
    if (tx < 0 || ty < 0 || tx >= N || ty >= N || solidForFriend(s, idx(tx, ty))) continue;
    out.x = x; out.y = y; return true;
  }
  return false;
}
const PT = { x: 0, y: 0 };
/** A building under siege: hit lately, or a foe beside it is still committed to smashing it
 *  (a Bog Witch turning to shoot a defender over the wall has not given up on it). */
let qSb = 0;
const sieging = (e) => e.siege === qSb;
/** The foe nearest building b that is committed to smashing it, or null. */
function besieger(s, b) {
  qSb = b.id;
  const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
  return s.rt.enemyHash.nearest(cx, cy, (b.size / 2 + 2) * T, sieging);
}
function stillBesieged(s, b, now) {
  return now - (b.lastHit || -99) < C.siegeSeen || !!besieger(s, b);
}
/** Where defenders of building b stand: behind a wall or gate (its inner side, facing the
 *  ordered point), but beside any other building on the side its attacker is on (a Hearth or
 *  a house has no "behind": the foe is what needs meeting). */
function defendPoint(s, b, q, out) {
  const def = BUILDINGS[b.type];
  if (def && (def.isWall || def.isGate)) return innerPoint(s, b, q.rx, q.ry, out);
  const f = besieger(s, b);
  // Remember the attacker's side (q.sx, q.sy) so the point does not jump back between blows.
  if (f) { q.sx = Math.round(f.x); q.sy = Math.round(f.y); q.sb = b.id; }
  else if (q.sb !== b.id) { q.sx = q.rx; q.sy = q.ry; q.sb = b.id; }
  return innerPoint(s, b, q.sx, q.sy, out);
}
/** Update the squad's working rally point; see the header. Call every tick (cheap). */
export function guardZone(s, q, hasRanged, members, opts) {
  // A new order (or an ordered target being followed) resets the zone.
  if (q.targetId) { q.wx = q.rx; q.wy = q.ry; q.ox = q.rx; q.oy = q.ry; q.thr = 0; q.march = 0; return; }
  if (q.ox !== q.rx || q.oy !== q.ry || q.wx === undefined) {
    const fresh = q.ox !== undefined && q.wx !== undefined;
    q.ox = q.rx; q.oy = q.ry; q.wx = q.rx; q.wy = q.ry; q.thr = 0; q.thrK = ''; q.thrT = 0;
    q.march = fresh ? 1 : 0; q.mT = s.time; q.zT = 0;
  }
  if (q.march) {
    // Settled once most of the squad is near the new point (or after a while).
    let n = 0, near = 0;
    for (const u of members) { n++; if (Math.hypot(u.x - q.rx, u.y - q.ry) < T * 2.2) near++; }
    if (!n || near * 2 >= n || s.time - q.mT > C.marchMax) q.march = 0; else return;
  }
  if (s.time < (q.zT || 0)) return;
  q.zT = Math.round((s.time + C.zoneEvery) * 100) / 100;
  const Z = opts && opts.radius ? opts.radius : C.zoneRadius * T;
  const foes = !(opts && opts.foes === false);
  const now = s.time;
  // 1. Keep the current threat while it lasts.
  let found = false;
  if (q.thr) {
    if (q.thrK === 'b') {
      const b = s.rt.bById.get(q.thr);
      if (b && b.alive && stillBesieged(s, b, now) && distToRect(q.rx, q.ry, b) <= Z + T && defendPoint(s, b, q, PT)) { q.wx = PT.x; q.wy = PT.y; found = true; }
    } else {
      const e = s.rt.eById.get(q.thr);
      if (foes && e && e.alive && (!e.flying || hasRanged) && Math.hypot(e.x - q.rx, e.y - q.ry) <= Z + T) { q.wx = e.x; q.wy = e.y; found = true; }
    }
  }
  // 2. A besieged building inside the zone comes first, then the foe nearest the ordered point.
  if (!found) {
    let best = null, bd = Infinity;
    for (const b of s.buildings) {
      if (!b.alive || now - (b.lastHit || -99) >= C.siegeSeen) continue;
      const d = distToRect(q.rx, q.ry, b);
      if (d <= Z && d < bd) { bd = d; best = b; }
    }
    if (best && defendPoint(s, best, q, PT)) { q.thr = best.id; q.thrK = 'b'; q.wx = PT.x; q.wy = PT.y; found = true; }
  }
  if (!found && foes) {
    const e = s.rt.enemyHash.nearest(q.rx, q.ry, Z, (o) => (!o.flying || hasRanged) && !o.guard && losClear(s, q.rx, q.ry, o.x, o.y, 'friend'));
    if (e) { q.thr = e.id; q.thrK = 'e'; q.wx = e.x; q.wy = e.y; found = true; }
  }
  if (found) { q.thrT = now; return; }
  // 3. Nothing: go back to the ordered point a little after the last threat.
  if (q.thr && now - (q.thrT || 0) > (opts && opts.ret !== undefined ? opts.ret : C.zoneReturn)) { q.thr = 0; q.thrK = ''; q.wx = q.rx; q.wy = q.ry; }
  else if (!q.thr) { q.wx = q.rx; q.wy = q.ry; }
}
