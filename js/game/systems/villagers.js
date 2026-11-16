// Villager AI. Villagers are fully autonomous: they build, repair (paying the building's
// material), staff workplaces, haul resources, shelter at dusk and flee danger.
//
// Rework (stream E):
//  - No milling around the Hearth: a villager with nothing to do walks to the door of a house
//    (the Hearth when there is none) and waits there ('home', then 'athome').
//  - Repairs cost 1 wood or stone per BAL.repair.hpPerRes hit points (see economy.js
//    repairMaterial) at BAL.villager.repairPerSec per builder; with nothing to pay, they stop.
//  - Shelter: villagers walk to the building's edge (its door) and fade out there over
//    BAL.villager.fadeTime ('entering', e.fade 1 -> 0), and fade back in on leaving while they
//    walk one tile out ('emerging', e.fade 0 -> 1). A sheltered villager keeps its door
//    position, so nobody ever pops. e.fade (0..1) is drawn by stream G; absent means 1.
//  - Gatherer camps search BAL.economy.campReach tiles past their radius before they are
//    marked depleted (b.noRes and b.depleted, a persistent badge), and warn once when their
//    standing wood or stone runs low (b.left, b.left0, b.lowWarned).
//  - Deliveries go through economy.produce: part now, the rest in the dawn lump.
import { BAL } from '../../data/balance.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { T, N, idx, ctr, tileOf, distToRect, inB } from '../grid.js';
import { MOVE, requestPath, followPath, stepToward, separate, setFacing } from './movement.js';
import { emit, flowRes, finishConstruction, getB, rng, markFlowDirty, accessTile } from './common.js';
import { produce, repairMaterial, repairPrice, standing, econ } from './economy.js';
import { HOOKS, BUS, product } from '../hooks.js';

const V = BAL.villager;
const IDLE = { idle: 1, home: 1, athome: 1, wander: 1 };

export function updateVillagers(s, dt) {
  const rt = s.rt;
  // Tallies used by job assignment, rebuilt each tick (cheap: tens of villagers).
  const builders = rt.builders || (rt.builders = new Map());
  const workers = rt.workers || (rt.workers = new Map());
  const nodeRes = rt.nodeRes || (rt.nodeRes = new Map());
  const shelters = rt.shelters || (rt.shelters = new Map());
  builders.clear(); workers.clear(); nodeRes.clear(); shelters.clear();
  for (const v of s.villagers) {
    if (!v.alive) continue;
    if (v.build) builders.set(v.build, (builders.get(v.build) || 0) + 1);
    if (v.job) workers.set(v.job, (workers.get(v.job) || 0) + 1);
    if (v.node) nodeRes.set(v.node, (nodeRes.get(v.node) || 0) + 1);
    const sh = v.shelter || (v.st === 'toShelter' || v.st === 'entering' ? v.target : 0);
    if (sh) shelters.set(sh, (shelters.get(sh) || 0) + 1);
  }
  const night = s.cycle.phase === 'dusk' || s.cycle.phase === 'night';
  const fadeStep = dt / (V.fadeTime || 0.25);
  for (const v of s.villagers) {
    if (!v.alive) continue;
    v.hitT = Math.max(0, v.hitT - dt);
    if (v.st === 'sheltered') {
      v.fade = 0;
      if (!night && !(s.wave && (s.wave.blood || s.wave.long) && s.enemies.some((e) => e.alive && !e.stationary && !e.guard))) {
        // Out in a trickle, not all on one tick.
        v.think = (v.think || 0) - dt;
        if (v.think <= 0) leaveShelter(s, v);
      }
      continue;
    }
    if (v.st === 'entering') { enter(s, v, dt, fadeStep); continue; }
    if (v.fade !== undefined && v.fade < 1) v.fade = Math.min(1, v.fade + fadeStep);
    think(s, v, dt, night);
    act(s, v, dt);
    if (v.st !== 'sheltered' && v.st !== 'entering') separate(s, v, rt.friendHash, 10, 'friend');
  }
}

function think(s, v, dt, night) {
  v.think -= dt;
  if (v.think > 0) return;
  v.think = 0.5;
  // Danger first.
  const threat = s.rt.enemyHash.nearest(v.x, v.y, T * 2.6, (e) => !e.stationary);
  if (threat && v.st !== 'flee' && v.st !== 'toShelter') { goShelter(s, v, true); return; }
  if (night) { if (v.st !== 'toShelter') goShelter(s, v, false); return; }
  if (IDLE[v.st]) chooseTask(s, v);
}

/** Does this building want (and can the realm pay for) a repair? */
function wantsRepair(s, b) {
  const R = BAL.repair;
  if (!b.built || b.upg || b.hp >= b.maxHp * R.below || s.time - (b.lastHit || -99) <= R.calm) return false;
  return (s.res[repairMaterial(b)] || 0) >= 1;
}

function chooseTask(s, v) {
  const rt = s.rt;
  // Leave a job the player has reduced.
  if (v.job) {
    const jb = getB(s, v.job);
    if (!jb || (rt.workers.get(v.job) || 0) > jb.wantW) { if (jb) rt.workers.set(v.job, rt.workers.get(v.job) - 1); v.job = 0; }
  }
  // 1. Construction, upgrades and (by day, when safe and paid for) repairs.
  let best = null, bd = 1e9;
  for (const b of s.buildings) {
    const needsWork = !b.built || b.upg;
    if (!needsWork && !wantsRepair(s, b)) continue;
    if ((rt.builders.get(b.id) || 0) >= V.maxBuilders) continue;
    const d = distToRect(v.x, v.y, b) + (needsWork ? 0 : T * 6);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) {
    v.build = best.id; rt.builders.set(best.id, (rt.builders.get(best.id) || 0) + 1);
    v.st = 'toBuild'; v.path = null;
    return;
  }
  // 2. Workplaces.
  if (!v.job) {
    const hungry = s.res.food < 40;
    let pick = null, score = -1e9;
    for (const b of s.buildings) {
      if (!b.built || !b.wantW) continue;
      const have = rt.workers.get(b.id) || 0;
      if (have >= b.wantW || b.noRes) continue;
      let sc = -distToRect(v.x, v.y, b) / T - have * 4;
      if (b.type === 'farm' && hungry) sc += 30;
      if (sc > score) { score = sc; pick = b; }
    }
    if (pick) { v.job = pick.id; rt.workers.set(pick.id, (rt.workers.get(pick.id) || 0) + 1); }
  }
  if (v.job) { v.st = 'toWork'; v.path = null; v.node = 0; return; }
  // 3. Nothing to do: wait at the door of a house (the Hearth when there is none).
  goHome(s, v);
}

/** The house this villager waits at: its last one while it stands, else the nearest. */
function homeOf(s, v) {
  const cur = getB(s, v.home);
  if (cur && cur.built) return cur;
  let best = null, bd = 1e9;
  for (const b of s.buildings) {
    if (!b.alive || !b.built || b.type !== 'house') continue;
    const d = distToRect(v.x, v.y, b);
    if (d < bd) { bd = d; best = b; }
  }
  return best || s.rt.hearth;
}

function goHome(s, v) {
  const b = homeOf(s, v);
  if (!b) { v.st = 'idle'; return; }
  if ((v.st === 'home' || v.st === 'athome') && v.home === b.id) return; // already going or there
  // The door: the free tile in front of the building (south side first).
  const cx = (b.tx + b.size / 2) * T;
  const at = accessTile(s, b, cx, (b.ty + b.size + 1) * T);
  if (!at) { v.st = 'idle'; return; }
  v.home = b.id;
  // Spread the waiting villagers a little along the door tile, fixed by id.
  const o = ((v.id * 7) % 5) - 2;
  v.wx = ctr(at.tx) + o * 4; v.wy = ctr(at.ty) + ((v.id % 2) ? 3 : -3);
  v.st = 'home'; v.path = null; v.dtx = at.tx; v.dty = at.ty;
}

function goShelter(s, v, fleeing) {
  // Nearest house with room, else the Hearth.
  let best = s.rt.hearth, bd = 1e9;
  for (const b of s.buildings) {
    if (!b.built || b.type !== 'house') continue;
    const cap = levelStats('house', b.level).shelter;
    if ((s.rt.shelters.get(b.id) || 0) >= cap) continue;
    const d = distToRect(v.x, v.y, b);
    if (d < bd) { bd = d; best = b; }
  }
  if (fleeing && s.rt.hearth && distToRect(v.x, v.y, s.rt.hearth) < bd * 1.5) best = s.rt.hearth;
  if (!best) return;
  v.st = 'toShelter'; v.target = best.id; v.path = null; v.build = 0; v.node = 0;
  s.rt.shelters.set(best.id, (s.rt.shelters.get(best.id) || 0) + 1);
}

/** At the door: step into the doorway and fade out, then go inside (position kept). */
function enter(s, v, dt, fadeStep) {
  const b = getB(s, v.target);
  if (!b) { v.st = 'idle'; v.think = 0; v.fade = 1; return; }
  v.act = null;
  // Into the doorway: toward the nearest point of the footprint, a few units at most.
  const x0 = b.tx * T, y0 = b.ty * T, x1 = x0 + b.size * T, y1 = y0 + b.size * T;
  const nx = Math.max(x0, Math.min(x1, v.x)), ny = Math.max(y0, Math.min(y1, v.y));
  if (Math.hypot(nx - v.x, ny - v.y) > 2) stepToward(s, v, nx, ny, V.speed * 0.5, dt, 'friend', false);
  v.fade = Math.max(0, (v.fade === undefined ? 1 : v.fade) - fadeStep);
  if (v.fade <= 0) {
    // Deposit anything carried (a delivery like any other), then go inside.
    if (v.carryK) deliver(s, v, getB(s, v.job));
    v.st = 'sheltered'; v.shelter = b.id; v.path = null; v.fade = 0;
    v.think = rng(s).float(0, 1.2); // leave in a trickle at dawn
  }
}

function leaveShelter(s, v) {
  const b = getB(s, v.shelter);
  v.shelter = 0; v.st = 'emerging'; v.path = null; v.fade = 0; v.think = 0.3;
  if (!b) { v.st = 'idle'; return; }
  // A villager saved inside a footprint (older saves) steps to the door while still unseen.
  if (v.x > b.tx * T && v.x < (b.tx + b.size) * T && v.y > b.ty * T && v.y < (b.ty + b.size) * T) {
    const at = accessTile(s, b, (b.tx + b.size / 2) * T, (b.ty + b.size + 1) * T);
    if (at) { v.x = ctr(at.tx); v.y = ctr(at.ty); v.px = v.x; v.py = v.y; }
  }
  // One tile out, away from the building.
  const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
  let dx = v.x - cx, dy = v.y - cy;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l; dy /= l;
  v.wx = v.x + dx * T; v.wy = v.y + dy * T;
  const tx = tileOf(v.wx), ty = tileOf(v.wy);
  if (!inB(tx, ty) || s.occ[idx(tx, ty)] || s.nodeGrid[idx(tx, ty)]) { v.wx = v.x + dx * 6; v.wy = v.y + dy * 6; }
}

// Walk toward a building's footprint; returns true on arrival.
function walkToBuilding(s, v, b, dt) {
  if (distToRect(v.x, v.y, b) < T * 0.75) return true;
  if (!v.path) { if (!requestPath(s, v, b.tx, b.ty, b.tx + b.size - 1, b.ty + b.size - 1)) return false; }
  const r = followPath(s, v, V.speed, dt);
  if (r === MOVE.ARRIVED) {
    if (distToRect(v.x, v.y, b) < T * 0.95) return true;
    // Path ended short (target walled off): give up for now.
    v.path = null; v.st = 'idle'; v.build = 0; v.think = 1.5;
  }
  return false;
}

/** Hand in what v carries: part now, the rest in the dawn lump (economy.produce). */
function deliver(s, v, b) {
  if (!v.carryK) return;
  if (b && BUS.gatherMult.length) v.carryA *= product(BUS.gatherMult, s, b, v.carryK);
  const now = produce(s, b, v.carryK, v.carryA);
  if (v.carryK === 'wood') s.stats.chopped = (s.stats.chopped || 0) + v.carryA;
  emit(s, { t: 'gain', k: v.carryK, a: now, bank: v.carryA - now, x: v.x, y: v.y - 12 });
  v.carryK = null; v.carryA = 0;
}

function act(s, v, dt) {
  v.act = null;
  switch (v.st) {
    case 'emerging': {
      if (Math.hypot(v.wx - v.x, v.wy - v.y) > 1.5) stepToward(s, v, v.wx, v.wy, V.speed * 0.6, dt, 'friend');
      v.think = Math.min(v.think, 0.3);
      if ((v.fade === undefined || v.fade >= 1) && Math.hypot(v.wx - v.x, v.wy - v.y) <= 1.5) { v.st = 'idle'; v.think = rng(s).float(0, 0.4); }
      else if (v.fade >= 1 && (v.stuck || 0) > 0.4) { v.st = 'idle'; v.think = 0; }
      break;
    }
    case 'home': {
      // Walk to the door; a door several tiles off takes a path.
      const far = Math.hypot(v.wx - v.x, v.wy - v.y) > T * 2.2;
      if (far) {
        if (!v.path) { if (!requestPath(s, v, v.dtx, v.dty)) break; }
        const r = followPath(s, v, V.speed * 0.8, dt);
        if (r === MOVE.ARRIVED) v.path = null;
        if (r === MOVE.BLOCKED && !v.path && (v.stuck || 0) > 2) { v.st = 'athome'; }
      } else {
        const r = stepToward(s, v, v.wx, v.wy, V.speed * 0.7, dt, 'friend');
        if (r === MOVE.ARRIVED || (r === MOVE.BLOCKED && (v.stuck || 0) > 0.6)) { v.st = 'athome'; v.path = null; }
      }
      break;
    }
    case 'athome': {
      // Wait facing the street; a nudge from a neighbour walks back to the spot.
      if (Math.hypot(v.wx - v.x, v.wy - v.y) > 6) stepToward(s, v, v.wx, v.wy, V.speed * 0.4, dt, 'friend');
      break;
    }
    case 'wander': { v.st = 'idle'; v.think = 0; break; } // older saves
    case 'toBuild': {
      const b = getB(s, v.build);
      if (!b) { v.st = 'idle'; v.build = 0; break; }
      if (walkToBuilding(s, v, b, dt)) { v.st = 'building'; v.timer = 0; }
      break;
    }
    case 'building': {
      const b = getB(s, v.build);
      if (!b) { v.st = 'idle'; v.build = 0; break; }
      v.act = 'hammer';
      faceToward(v, b);
      v.timer += dt;
      if (v.timer > 0.55) { v.timer = 0; emit(s, { t: 'sfx', k: 'hammer', x: v.x, y: v.y }); }
      if (!b.built || b.upg) {
        b.progress += V.buildPerSec * (1 + s.mods.buildSpeed) * (s.rt.workMult || 1) * dt;
        if (!b.built) b.hp = Math.min(b.maxHp, b.maxHp * (0.15 + 0.85 * (b.progress / b.need)));
        if (b.progress >= b.need) { finishConstruction(s, b); v.st = 'idle'; v.build = 0; v.think = 0.2; }
      } else {
        // Paid repairs: wood buildings take wood, stone ones stone.
        const k = repairMaterial(b);
        const hp = Math.min(b.maxHp - b.hp, V.repairPerSec * (s.rt.workMult || 1) * dt);
        const cost = repairPrice(hp);
        if (hp <= 0 || s.time - (b.lastHit || -99) <= BAL.repair.calm * 0.5) { v.st = 'idle'; v.build = 0; break; }
        if ((s.res[k] || 0) < cost) {
          v.st = 'idle'; v.build = 0; v.think = 1;
          warnShort(s, k, b);
          break;
        }
        flowRes(s, k, -cost);
        b.hp = Math.min(b.maxHp, b.hp + hp);
        b.repaired = (b.repaired || 0) + hp;
        if (b.hp >= b.maxHp) { v.st = 'idle'; v.build = 0; }
      }
      break;
    }
    case 'toWork': {
      const b = getB(s, v.job);
      if (!b) { v.st = 'idle'; v.job = 0; break; }
      const def = BUILDINGS[b.type];
      if (def.needs) {
        // Gatherers: pick a node in range (or a little past it), walk to it.
        let n = v.node ? s.rt.nById.get(v.node) : null;
        if (!n || n.amount <= 0) { n = findNode(s, b, def.needs); v.node = n ? n.id : 0; v.path = null; }
        if (!n) { markDepleted(s, b); v.job = 0; v.st = 'idle'; v.think = 2; break; }
        if (!v.path) { if (!requestPath(s, v, n.tx, n.ty)) break; }
        const r = followPath(s, v, V.speed, dt);
        if (r === MOVE.ARRIVED) {
          if (Math.hypot(ctr(n.tx) - v.x, ctr(n.ty) - v.y) < T * 1.6) { v.st = 'gather'; v.timer = 0; v.cycle = 0; }
          else { v.node = 0; v.path = null; }
        }
      } else if (walkToBuilding(s, v, b, dt)) { v.st = 'working'; v.timer = 0; v.wx = v.x; v.wy = v.y; }
      break;
    }
    case 'working': {
      // Farmers: tend the field, producing on each cycle.
      const b = getB(s, v.job);
      if (!b) { v.st = 'idle'; v.job = 0; break; }
      v.act = 'farm';
      v.timer += dt * (s.rt.workMult || 1);
      if (v.timer >= V.farmCycle) {
        v.timer = 0;
        const st = levelStats(b.type, b.level);
        const amt = V.farmYield * 2 * (st.yieldMult || 1) * (1 + s.mods.farmYield + (HOOKS.farmBonus ? HOOKS.farmBonus(s, b) : 0)) * product(BUS.farmMult, s, b);
        const now = produce(s, b, 'food', amt);
        emit(s, { t: 'gain', k: 'food', a: now, bank: amt - now, x: v.x, y: v.y - 12 });
        v.st = 'idle'; v.think = 0; // re-evaluate (construction may need hands)
        // Shuffle along the field edge so farmers look busy.
        const r = rng(s);
        v.wx = (b.tx + r.float(-0.3, b.size + 0.3)) * T; v.wy = (b.ty + b.size + 0.3) * T;
      } else if (Math.hypot(v.wx - v.x, v.wy - v.y) > 2) stepToward(s, v, v.wx, v.wy, V.speed * 0.35, dt, 'friend');
      break;
    }
    case 'gather': {
      const n = s.rt.nById.get(v.node);
      const b = getB(s, v.job);
      if (!n || n.amount <= 0 || !b) { v.st = b ? 'toWork' : 'idle'; v.node = 0; v.path = null; break; }
      const wood = n.kind === 'tree';
      v.act = wood ? 'chop' : 'mine';
      if (Math.abs(ctr(n.tx) - v.x) > 1) setFacing(v, ctr(n.tx) - v.x, 'target');
      v.timer += dt * (s.rt.workMult || 1); v.cycle += dt;
      if (v.cycle > 0.7) { v.cycle = 0; emit(s, { t: 'sfx', k: wood ? 'chop' : 'pick', x: v.x, y: v.y }); }
      if (v.timer >= (wood ? V.chopTime : V.mineTime) / (1 + (s.mods.chopSpeed || 0))) {
        const take = Math.min(n.amount, wood ? V.carryWood : V.carryStone);
        n.amount -= take;
        v.carryK = wood ? 'wood' : 'stone'; v.carryA = take;
        if (n.amount <= 0) depleteNode(s, n);
        v.st = 'return'; v.path = null;
      }
      break;
    }
    case 'return': {
      const b = getB(s, v.job);
      if (!b) { v.st = 'idle'; v.job = 0; break; }
      if (walkToBuilding(s, v, b, dt)) { deliver(s, v, b); v.st = 'idle'; v.think = 0; }
      break;
    }
    case 'toShelter': {
      const b = getB(s, v.target);
      if (!b) { v.st = 'idle'; v.think = 0; break; }
      if (walkToBuilding(s, v, b, dt)) { v.st = 'entering'; v.path = null; if (v.fade === undefined) v.fade = 1; }
      break;
    }
    case 'flee': case 'idle': default:
      break;
  }
}

function warnShort(s, k, b) {
  const e = econ(s);
  const key = 'rep' + k + s.cycle.night;
  if (e.warned[key]) return;
  e.warned[key] = 1;
  emit(s, { t: 'repairShort', k, id: b.id });
  emit(s, { t: 'toast', text: `Repairs have stopped: no ${k} left to mend the ${BUILDINGS[b.type].name}.`, tone: 'bad', icon: k });
}

function faceToward(v, b) {
  const cx = (b.tx + b.size / 2) * T;
  if (Math.abs(cx - v.x) > 2) setFacing(v, cx - v.x, 'target');
}

/** A camp's search radius in world units: its level radius, plus `extra` tiles. */
function campR(b, extra) { return (levelStats(b.type, b.level).radius + extra) * T; }

function findNode(s, b, kind) {
  const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
  // Inside the camp's radius first; then up to campReach tiles further before giving up.
  for (const extra of [0, BAL.economy.campReach]) {
    const R = campR(b, extra);
    let best = null, bd = 1e9;
    for (const n of s.nodes) {
      if (n.kind !== kind || n.amount <= 0) continue;
      const d = Math.hypot(ctr(n.tx) - cx, ctr(n.ty) - cy);
      if (d > R) continue;
      // Past the camp's own radius, only woods already seen.
      if (extra && !s.fog[idx(n.tx, n.ty)]) continue;
      const res = s.rt.nodeRes.get(n.id) || 0;
      const sc = d + res * T * 3;
      if (res < 2 && sc < bd) { bd = sc; best = n; }
    }
    if (best) { s.rt.nodeRes.set(best.id, (s.rt.nodeRes.get(best.id) || 0) + 1); return best; }
  }
  return null;
}

/** No node left within reach (every node may be taken by two workers: then just wait). */
function markDepleted(s, b) {
  const def = BUILDINGS[b.type];
  const left = standing(s, def.needs, (b.tx + b.size / 2) * T, (b.ty + b.size / 2) * T, campR(b, BAL.economy.campReach));
  if (left.n > 0) return; // all in use by other workers
  if (b.noRes) return;
  b.noRes = true; b.left = 0;
  if (b.left0 > 0) b.depleted = true; // it harvested here: a lasting badge
  emit(s, { t: 'noRes', id: b.id, depleted: !!b.depleted, x: (b.tx + b.size / 2) * T, y: b.ty * T });
}

export function depleteNode(s, n) {
  n.amount = 0;
  s.nodeGrid[idx(n.tx, n.ty)] = 0;
  s.rt.nById.delete(n.id);
  const i = s.nodes.indexOf(n);
  if (i >= 0) s.nodes.splice(i, 1);
  s.decals.push({ k: n.kind === 'tree' ? 'stump' : 'pebbles', x: ctr(n.tx), y: ctr(n.ty), size: 1, t: s.time, v: n.v });
  if (s.decals.length > 60) s.decals.shift();
  emit(s, { t: 'felled', x: ctr(n.tx), y: ctr(n.ty), kind: n.kind });
  markFlowDirty(s);
  s.rt.terrainDirty = true;
}

// Every 40 ticks: what each camp has left within reach (b.left), a warning when it runs low, and
// camps flagged "no resources" come back when more is revealed (fog) or regrows.
export function refreshNoRes(s) {
  const E = BAL.economy;
  for (const b of s.buildings) {
    const def = BUILDINGS[b.type];
    if (!def || !def.needs || !b.alive) continue;
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    const { total, n } = standing(s, def.needs, cx, cy, campR(b, E.campReach));
    b.left = Math.round(total);
    if (!b.built) continue;
    if (!(b.left0 >= b.left)) b.left0 = b.left;
    if (n > 0 && b.noRes) { b.noRes = false; b.depleted = false; b.lowWarned = false; b.left0 = b.left; }
    if (!b.lowWarned && !b.noRes && b.left0 > 0 && b.left < b.left0 * E.campLowShare) {
      b.lowWarned = true;
      const what = def.needs === 'tree' ? 'wood' : 'stone';
      emit(s, { t: 'campLow', id: b.id, left: b.left, k: what });
      emit(s, { t: 'toast', text: `The ${def.name} is running out: about ${b.left} ${what} left in reach.`, tone: 'bad', icon: what });
    }
  }
}
void N;
