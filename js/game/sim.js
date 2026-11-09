// The simulation driver: one fixed-timestep tick and the command interface.
// The UI never mutates state directly; it calls applyCommand(), which is the
// only entry point for player intent. That keeps runs reproducible.
import { BAL } from '../data/balance.js';
import { BUILDINGS, levelStats } from '../data/buildings.js';
import { UNITS } from '../data/units.js';
import { BOONS } from '../data/boons.js';
import { T, N, idx, inB, ctr, tileOf, clamp, TER_BUILDABLE, WORLD } from './grid.js';
import { buildFlowField } from './systems/pathing.js';
import { canAfford, spend, refund, createBuilding, removeBuilding, compact, emit, getB, getE, spawnVillager, spawnEnemy, spawnSoldier, markLightDirty, footprintFree } from './systems/common.js';
import { updateCycle, callNight, forceDawn } from './systems/cycle.js';
import { planNight } from './systems/waves.js';
import { updateBuildings, squadFor, squadSize, trainTime } from './systems/buildings.js';
import { updateVillagers, refreshNoRes } from './systems/villagers.js';
import { updateUnits, castAbility } from './systems/units.js';
import { updateEnemies } from './systems/enemies.js';
import { updateProjectiles } from './systems/combat.js';
import { updateEconomy } from './systems/economy.js';
import { updateFog, computeLight } from './systems/fog.js';

export const DT = 1 / BAL.tickRate;

export function tick(s) {
  if (s.outcome || s.pending) return;
  const dt = DT;
  const rt = s.rt;
  s.tick++; s.time += dt;
  rt.pathBudget = 6;

  for (const e of s.villagers) { e.px = e.x; e.py = e.y; }
  for (const e of s.soldiers) { e.px = e.x; e.py = e.y; }
  for (const e of s.enemies) { e.px = e.x; e.py = e.y; }
  const sv = s.sovereign;
  if (sv) { sv.px = sv.x; sv.py = sv.y; }

  if (rt.lightDirty) computeLight(s);
  if (rt.flowDirty) {
    buildFlowField(s, rt.fieldN, false);
    buildFlowField(s, rt.fieldP, true);
    rt.flowDirty = false;
  }

  rt.friendHash.clear();
  for (const v of s.villagers) if (v.alive && v.st !== 'sheltered') rt.friendHash.insert(v);
  for (const u of s.soldiers) if (u.alive) rt.friendHash.insert(u);
  if (sv && sv.alive) rt.friendHash.insert(sv);
  rt.enemyHash.clear();
  for (const e of s.enemies) if (e.alive) rt.enemyHash.insert(e);

  updateCycle(s, dt);
  updateBuildings(s, dt);
  updateVillagers(s, dt);
  updateUnits(s, dt);
  updateEnemies(s, dt);
  updateProjectiles(s, dt);
  updateEconomy(s, dt);
  updateFog(s);
  if (s.tick % 40 === 0) refreshNoRes(s);

  compact(s, s.villagers);
  compact(s, s.soldiers);
  compact(s, s.enemies);
}

// ---- Placement rules (shared by the ghost preview and the command) ---------
export function canPlace(s, type, tx, ty) {
  const def = BUILDINGS[type];
  const size = def.size;
  for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) {
    if (!inB(x, y)) return { ok: false, reason: 'Outside the region' };
    const i = idx(x, y);
    if (!s.fog[i]) return { ok: false, reason: 'Unexplored land' };
    if (!TER_BUILDABLE[s.terrain[i]]) return { ok: false, reason: 'Cannot build here' };
    if (s.nodeGrid[i]) return { ok: false, reason: 'Blocked by trees or rock' };
    if (s.occ[i]) return { ok: false, reason: 'Space is occupied' };
  }
  if (def.needs) {
    const st = levelStats(type, 0);
    const cx = (tx + size / 2) * T, cy = (ty + size / 2) * T;
    let found = 0;
    for (const n of s.nodes) if (n.kind === def.needs && s.fog[idx(n.tx, n.ty)] && Math.hypot(ctr(n.tx) - cx, ctr(n.ty) - cy) <= st.radius * T) found++;
    if (!found) return { ok: false, reason: def.needs === 'tree' ? 'No trees in range' : 'No rock in range' };
    return { ok: true, found };
  }
  return { ok: true };
}

// Straight wall line from a to b, snapped to 8 directions, max 14 segments.
export function lineTiles(ax, ay, bx, by) {
  let dx = bx - ax, dy = by - ay;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (adx > ady * 2) dy = 0; else if (ady > adx * 2) dx = 0; else { const m = Math.max(adx, ady); dx = Math.sign(dx) * m; dy = Math.sign(dy) * m; }
  const len = Math.min(13, Math.max(Math.abs(dx), Math.abs(dy)));
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const out = [];
  for (let i = 0; i <= len; i++) out.push([ax + sx * i, ay + sy * i]);
  return out;
}

// ---- Commands -----------------------------------------------------------------
export function applyCommand(s, c) {
  switch (c.t) {
    case 'place': return cmdPlace(s, c);
    case 'upgrade': {
      const b = getB(s, c.id);
      if (!b || !b.built || b.upg) return { ok: false };
      const def = BUILDINGS[b.type];
      const next = def.levels[b.level + 1];
      if (!next) return { ok: false, msg: 'Already at the highest level.' };
      if (!canAfford(s.res, next.cost)) return { ok: false, msg: 'Not enough resources.' };
      spend(s, next.cost);
      b.upg = true; b.progress = 0; b.need = next.work;
      emit(s, { t: 'sfx', k: 'build', x: ctr(b.tx), y: ctr(b.ty) });
      return { ok: true };
    }
    case 'demolish': {
      const b = getB(s, c.id);
      if (!b || b.type === 'hearth') return { ok: false };
      const base = BUILDINGS[b.type].levels[0].cost;
      refund(s, base, b.built ? 0.5 : 1);
      removeBuilding(s, b, false);
      emit(s, { t: 'sfx', k: 'demolish', x: ctr(b.tx), y: ctr(b.ty) });
      return { ok: true };
    }
    case 'workers': {
      const b = getB(s, c.id);
      if (!b) return { ok: false };
      const max = levelStats(b.type, b.level).workers || 0;
      b.wantW = clamp(b.wantW + c.d, 0, max);
      return { ok: true };
    }
    case 'train': {
      const b = getB(s, c.id);
      if (!b || !b.built || b.type !== 'barracks') return { ok: false };
      const d = UNITS[c.u];
      const cap = levelStats('barracks', b.level).squadCap;
      if (squadSize(s, b) + b.train.length >= cap) return { ok: false, msg: 'This squad is full. Upgrade the Barracks for more.' };
      if (!canAfford(s.res, d.cost)) return { ok: false, msg: 'Not enough resources.' };
      spend(s, d.cost);
      b.train.push({ u: c.u, t: trainTime(c.u), total: trainTime(c.u) });
      squadFor(s, b);
      return { ok: true };
    }
    case 'squadMove': {
      const q = s.squads.find((x) => x.id === c.id);
      if (!q) return { ok: false };
      q.rx = clamp(c.x, 8, WORLD - 8); q.ry = clamp(c.y, 8, WORLD - 8); q.targetId = 0;
      for (const u of s.soldiers) if (u.squad === q.id) { u.targetId = 0; u.path = null; u.think = 0.3; }
      return { ok: true };
    }
    case 'squadAttack': {
      const q = s.squads.find((x) => x.id === c.id);
      const t = getE(s, c.target);
      if (!q || !t) return { ok: false };
      q.targetId = t.id;
      for (const u of s.soldiers) if (u.squad === q.id) { u.targetId = t.id; u.path = null; }
      return { ok: true };
    }
    case 'sovMove': {
      const v = s.sovereign;
      if (!v) return { ok: false };
      v.rx = clamp(c.x, 8, WORLD - 8); v.ry = clamp(c.y, 8, WORLD - 8);
      v.orderTarget = 0; v.targetId = 0; v.path = null; v.retreat = false; v.orderT = s.time; v.think = 0.4;
      return { ok: true };
    }
    case 'sovAttack': {
      const v = s.sovereign;
      const t = getE(s, c.target);
      if (!v || !t) return { ok: false };
      v.orderTarget = t.id; v.targetId = t.id; v.retreat = false; v.orderT = s.time; v.path = null;
      return { ok: true };
    }
    case 'ability': return castAbility(s, c.name);
    case 'callNight': callNight(s); return { ok: s.cycle.phase === 'dusk' };
    case 'choose': {
      if (!s.pending) return { ok: false };
      const o = s.pending.options[c.i];
      if (!o) return { ok: false };
      const def = BOONS.find((b) => b.id === o.id);
      def.apply(s, o.amount, { spawnVillager: (st) => spawnVillager(st), markLightDirty });
      s.usedBoons.push(o.id);
      s.pending = null;
      emit(s, { t: 'boon', id: o.id });
      return { ok: true };
    }
    case 'lightBeacon': {
      if (!s.beaconReady || s.outcome) return { ok: false };
      s.outcome = { result: 'victory', reason: 'The Beacon blazes over Greenvale. The Hollow recoils from the light.' };
      return { ok: true };
    }
    case 'debug': return debugCmd(s, c);
    default: return { ok: false };
  }
}

function cmdPlace(s, c) {
  const def = BUILDINGS[c.type];
  if (!def || !def.cat) return { ok: false };
  const cost = def.levels[0].cost;
  let placed = 0, reason = '';
  for (const [tx, ty] of c.tiles) {
    const v = canPlace(s, c.type, tx, ty);
    if (!v.ok) { reason = v.reason; continue; }
    if (!canAfford(s.res, cost)) { reason = 'Not enough resources'; break; }
    if (!footprintFree(s, c.type, tx, ty)) continue;
    spend(s, cost);
    createBuilding(s, c.type, tx, ty, false);
    placed++;
  }
  if (placed) emit(s, { t: 'sfx', k: 'place', x: ctr(c.tiles[0][0]), y: ctr(c.tiles[0][1]) });
  return { ok: placed > 0, placed, msg: placed ? '' : reason };
}

function debugCmd(s, c) {
  switch (c.what) {
    case 'res': for (const k in s.res) s.res[k] += 500; break;
    case 'night': if (s.cycle.phase === 'day') callNight(s); else if (s.cycle.phase === 'dusk') s.cycle.t = BAL.cycle.duskLen; else forceDawn(s); break;
    case 'reveal': s.fog.fill(1); s.rt.fogDirty = true; break;
    case 'boss': {
      const sp = s.spawns[0];
      spawnEnemy(s, 'knight', ctr(sp.tx), ctr(sp.ty), 'warden');
      emit(s, { t: 'toast', text: 'Debug: a Hollow Warden approaches from the ' + sp.side, tone: 'bad' });
      break;
    }
    case 'stress': {
      for (let i = 0; i < 160; i++) {
        const sp = s.spawns[i % s.spawns.length];
        spawnEnemy(s, ['husk', 'hound', 'shade', 'knight'][i % 4], ctr(sp.tx) + (i % 7) * 3, ctr(sp.ty) + (i % 5) * 3, null);
      }
      let b = s.buildings.find((x) => x.type === 'barracks' && x.built);
      if (!b) {
        const h = s.rt.hearth;
        for (let r = 4; r < 12 && !b; r++) for (let a = 0; a < 16 && !b; a++) {
          const tx = Math.round(h.tx + 1 + Math.cos(a) * r), ty = Math.round(h.ty + 1 + Math.sin(a) * r);
          if (canPlace(s, 'barracks', tx, ty).ok) b = createBuilding(s, 'barracks', tx, ty, true);
        }
      }
      if (b) {
        const sq = squadFor(s, b);
        for (let i = 0; i < 60; i++) {
          const u = ['militia', 'spearman', 'archer'][i % 3];
          spawnSoldier(s, u, sq, ctr(b.tx) + (i % 8) * 4, ctr(b.ty + 2) + ((i / 8) | 0) * 4);
        }
      }
      break;
    }
    case 'blood': if (s.cycle.phase === 'day') { s.cycle.night = Math.max(s.cycle.night, BAL.waves.bloodMoonEvery - 1); planNight(s); } break;
    case 'win': s.cycle.night = s.objective.nights; s.beaconReady = true; emit(s, { t: 'beaconReady' }); break;
  }
  return { ok: true };
}
void N; void tileOf;
