// Villager AI. Villagers are fully autonomous: they build, repair, staff
// workplaces, haul resources, shelter at dusk and flee danger.
import { BAL } from '../../data/balance.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { T, N, idx, ctr, tileOf, distToRect } from '../grid.js';
import { MOVE, requestPath, followPath, stepToward, separate } from './movement.js';
import { emit, flowRes, finishConstruction, getB, rng, markFlowDirty } from './common.js';
import { HOOKS, BUS, product } from '../hooks.js';

const V = BAL.villager;

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
    if (v.shelter) shelters.set(v.shelter, (shelters.get(v.shelter) || 0) + 1);
  }
  const night = s.cycle.phase === 'dusk' || s.cycle.phase === 'night';
  for (const v of s.villagers) {
    if (!v.alive) continue;
    v.hitT = Math.max(0, v.hitT - dt);
    if (v.st === 'sheltered') {
      if (!night && !(s.wave && s.wave.blood && s.enemies.some((e) => e.alive && !e.stationary && !e.guard))) leaveShelter(s, v);
      continue;
    }
    think(s, v, dt, night);
    act(s, v, dt);
    if (v.st !== 'sheltered') separate(s, v, rt.friendHash, 7, 'friend');
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
  if (v.st === 'idle' || v.st === 'wander') chooseTask(s, v);
}

function chooseTask(s, v) {
  const rt = s.rt;
  // Leave a job the player has reduced.
  if (v.job) {
    const jb = getB(s, v.job);
    if (!jb || (rt.workers.get(v.job) || 0) > jb.wantW) { if (jb) rt.workers.set(v.job, rt.workers.get(v.job) - 1); v.job = 0; }
  }
  // 1. Construction, upgrades and (by day, when safe) repairs.
  let best = null, bd = 1e9;
  for (const b of s.buildings) {
    const needsWork = !b.built || b.upg;
    const needsRepair = b.built && !b.upg && b.hp < b.maxHp * 0.85 && s.time - (b.lastHit || -99) > 6;
    if (!needsWork && !needsRepair) continue;
    if ((rt.builders.get(b.id) || 0) >= V.maxBuilders) continue;
    const d = distToRect(v.x, v.y, b) + (needsRepair ? T * 6 : 0);
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
  // 3. Nothing to do: stroll around the Hearth.
  if (v.st !== 'wander') {
    const h = s.rt.hearth;
    if (!h) return;
    const r = rng(s);
    const a = r.float(0, Math.PI * 2), d = r.float(2.2, 3.6) * T;
    v.wx = (h.tx + 1.5) * T + Math.cos(a) * d; v.wy = (h.ty + 1.5) * T + Math.sin(a) * d;
    v.st = 'wander';
  }
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

function leaveShelter(s, v) {
  const b = getB(s, v.shelter);
  v.shelter = 0; v.st = 'idle'; v.think = rng(s).float(0, 1.5); v.path = null;
  if (b) { v.x = (b.tx + b.size / 2) * T + rng(s).float(-8, 8); v.y = (b.ty + b.size) * T + 5; v.px = v.x; v.py = v.y; }
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

function act(s, v, dt) {
  v.act = null;
  switch (v.st) {
    case 'wander': {
      const r = stepToward(s, v, v.wx, v.wy, V.speed * 0.5, dt, 'friend');
      if (r !== MOVE.MOVING) v.st = 'idle';
      break;
    }
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
        b.hp = Math.min(b.maxHp, b.hp + V.repairPerSec * (s.rt.workMult || 1) * dt);
        if (b.hp >= b.maxHp) { v.st = 'idle'; v.build = 0; }
      }
      break;
    }
    case 'toWork': {
      const b = getB(s, v.job);
      if (!b) { v.st = 'idle'; v.job = 0; break; }
      const def = BUILDINGS[b.type];
      if (def.needs) {
        // Gatherers: pick a node in range, walk to it.
        let n = v.node ? s.rt.nById.get(v.node) : null;
        if (!n || n.amount <= 0) { n = findNode(s, b, def.needs); v.node = n ? n.id : 0; v.path = null; }
        if (!n) { b.noRes = true; v.job = 0; v.st = 'idle'; v.think = 2; emit(s, { t: 'noRes', id: b.id }); break; }
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
        const st = levelStats('farm', b.level);
        const amt = V.farmYield * 2 * st.yieldMult * (1 + s.mods.farmYield + (HOOKS.farmBonus ? HOOKS.farmBonus(s, b) : 0)) * product(BUS.farmMult, s, b);
        flowRes(s, 'food', amt);
        emit(s, { t: 'gain', k: 'food', a: amt, x: v.x, y: v.y - 12 });
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
      if (Math.abs(ctr(n.tx) - v.x) > 1) v.face = ctr(n.tx) < v.x ? -1 : 1;
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
      if (walkToBuilding(s, v, b, dt)) {
        if (v.carryK) {
          if (BUS.gatherMult.length) v.carryA *= product(BUS.gatherMult, s, b, v.carryK);
          flowRes(s, v.carryK, v.carryA);
          emit(s, { t: 'gain', k: v.carryK, a: v.carryA, x: v.x, y: v.y - 12 });
          v.carryK = null; v.carryA = 0;
        }
        v.st = 'idle'; v.think = 0;
      }
      break;
    }
    case 'toShelter': {
      const b = getB(s, v.target);
      if (!b) { v.st = 'idle'; v.think = 0; break; }
      if (walkToBuilding(s, v, b, dt) || (v.st === 'idle')) {
        if (v.st === 'idle') break;
        // Deposit anything carried, then go inside.
        if (v.carryK) { flowRes(s, v.carryK, v.carryA); v.carryK = null; v.carryA = 0; }
        v.st = 'sheltered'; v.shelter = b.id; v.path = null;
        v.x = (b.tx + b.size / 2) * T; v.y = (b.ty + b.size / 2) * T;
      }
      break;
    }
    case 'flee': case 'idle': default:
      break;
  }
}

function faceToward(v, b) {
  const cx = (b.tx + b.size / 2) * T;
  if (Math.abs(cx - v.x) > 2) v.face = cx < v.x ? -1 : 1;
}

function findNode(s, b, kind) {
  const st = levelStats(b.type, b.level);
  const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
  const R = st.radius * T;
  let best = null, bd = 1e9;
  for (const n of s.nodes) {
    if (n.kind !== kind || n.amount <= 0) continue;
    const d = Math.hypot(ctr(n.tx) - cx, ctr(n.ty) - cy);
    if (d > R) continue;
    if (!s.fog[idx(n.tx, n.ty)]) continue;
    const res = s.rt.nodeRes.get(n.id) || 0;
    const sc = d + res * T * 3;
    if (res < 2 && sc < bd) { bd = sc; best = n; }
  }
  if (best) s.rt.nodeRes.set(best.id, (s.rt.nodeRes.get(best.id) || 0) + 1);
  return best;
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

// Re-check nodes for camps flagged "no resources" (e.g. after fog reveals more).
export function refreshNoRes(s) {
  for (const b of s.buildings) {
    if (!b.noRes) continue;
    const def = BUILDINGS[b.type];
    const st = levelStats(b.type, b.level);
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    for (const n of s.nodes) {
      if (n.kind === def.needs && n.amount > 0 && s.fog[idx(n.tx, n.ty)] && Math.hypot(ctr(n.tx) - cx, ctr(n.ty) - cy) <= st.radius * T) { b.noRes = false; break; }
    }
  }
}
void N; void tileOf;
