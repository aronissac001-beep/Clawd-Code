// The Bone Colossus, Act II boss. A slow siege giant of grey bone that walks
// straight at the Hearth, ignoring the flow field: walls and buildings in its
// path are smashed, trees trampled, rivers waded. Its big attack, SLAM, is
// telegraphed by a red ground circle (COL.warnDur seconds), then crushes
// everything inside. After every slam its rib cage glows: the WEAK SPOT is
// exposed for COL.weakDur seconds and it takes x COL.weakMult damage.
// At dawn it collapses into a mound of bones where it stood and rises again at
// dusk from that same spot, keeping its wounds: a siege that spans nights.
// Same API as boss.js (the Gloomwyrm); the lead dispatches by s.bossType.
import { RUN } from '../../data/balance.js';
import { BUILDINGS } from '../../data/buildings.js';
import { ENEMIES } from '../../data/enemies.js';
import { T, N, WORLD, idx, inB, ctr, distToRect, clamp, tileOf } from '../grid.js';
import { BUS } from '../hooks.js';
import { emit, hurt, hurtBuilding, spawnEnemy, getE, getB } from './common.js';
import { depleteNode } from './villagers.js';
import { registerBiomes } from '../../data/biomes-ext.js';

export const COLOSSUS_DEF = {
  id: 'colossus', name: 'The Bone Colossus', color: '#cfc6b2',
  desc: 'A giant of grey bone that walks straight at the Hearth, smashing whatever stands in its way. After each ground slam its rib cage glows: strike it then.',
  weak: 'Militia mauls and fire. Every blow lands triple while its rib cage glows after a slam',
  hp: 4600, dmg: 40, dmgType: 'crush', rate: 1.7, range: 1.3, speed: 0.6, aggro: 2.5,
  tags: ['hollow', 'armored', 'boss'], cost: 0, radius: 26, prefers: 'buildings', boss: true,
};

// Bones shaken loose by the slams in phase 2+. Never rolled into ordinary waves.
export const BONEHUSK_DEF = {
  id: 'bonehusk', name: 'Bone Husk', color: '#cfc6b2',
  desc: 'Grey bones shaken loose by the Colossus and knitted into a shambling soldier. Brittle, but they come in numbers.',
  weak: 'Archers, Militia',
  hp: 40, dmg: 6, dmgType: 'blade', rate: 1.1, range: 0.75, speed: 1.05, aggro: 1.8,
  tags: ['hollow', 'infantry'], cost: 1, radius: 6, prefers: 'any', noWave: true,
};

// Tunables (tiles, seconds, multiples of COLOSSUS_DEF.dmg).
export const COL = {
  warnDur: 1.8,              // slam telegraph
  slamR: 2,                  // slam radius
  slamReach: 1.8,            // farthest slam centre from the Colossus (its fists reach that far)
  slamCd: [0, 7, 6, 6.5],    // by phase: walking time between slams
  firstSlam: 4,              // after arriving
  weakDur: 4,
  weakMult: 3,
  slamBuildingDmg: 2.4,      // per building inside the circle (then x2 crush vs buildings)
  slamUnitDmg: 1.4,          // per friendly inside the circle
  hearthMult: 0.6,           // the Hearth takes less from slams and pounding
  speedMult: [0, 1, 1, 1.5], // by phase
  wadeMult: 0.6,             // speed in water and over crags
  footR: 0.85,               // tiles: a building this close to its feet blocks the stride
  husks: [0, 0, 3, 4],       // bone husks raised per slam, by phase
  rise: 1.5,                 // seconds to stand up from its bones (it does nothing meanwhile)
  moundBlock: 1,             // tiles around the bone mound where nothing can be built by day
};

const ACTIVE = { walk: 1, windup: 1, exposed: 1 };

export function initBoss(s) {
  s.boss = { kind: 'colossus', state: 'dormant', arriveNight: RUN.bossNight, phase: 1, id: 0, warn: null, weakT: 0, slamCd: 0, timer: 0, target: 0, double: false, slams: 0, sx: null, sy: null, hp: 0, maxHp: 0, mx: null, my: null, lx: 0, ly: 0, told: false, toldWeak: false, withdrawn: false };
}

export function bossWaveNote(s, n) {
  const b = s.boss;
  if (!b || b.state === 'slain' || n < b.arriveNight) return null;
  if (b.state === 'withdrawn') return 'The Bone Colossus rises again from its bones tonight!';
  if (b.state === 'dormant') return 'The Bone Colossus walks tonight!';
  return null;
}

export function bossBar(s) {
  const b = s.boss;
  if (!b || (!ACTIVE[b.state] && b.state !== 'withdrawn')) return null;
  const e = getE(s, b.id);
  const name = COLOSSUS_DEF.name;
  if (e) {
    const note = b.weakT > 0 ? 'Weak spot exposed!' : b.state === 'windup' ? 'Slam incoming!' : null;
    return { name, hp: Math.max(0, e.hp), maxHp: e.maxHp, phase: b.phase, note, exposed: b.weakT > 0 };
  }
  if (b.state === 'withdrawn') return { name, hp: b.hp, maxHp: b.maxHp, phase: b.phase, away: true, note: 'Rises again at dusk' };
  return null;
}

/** The live Colossus entity, if any. */
export function colossusOf(s) { return s.boss && s.boss.kind === 'colossus' ? getE(s, s.boss.id) : null; }

export function updateBoss(s, dt) {
  const b = s.boss;
  if (!b || b.state === 'slain') return;
  const ph = s.cycle.phase;

  if (b.state === 'dormant' || b.state === 'withdrawn') {
    if ((ph === 'dusk' || ph === 'night') && s.cycle.night + 1 >= b.arriveNight) arrive(s, b);
    return;
  }

  const e = getE(s, b.id);
  if (!e) { slain(s, b); return; }
  b.lx = e.x; b.ly = e.y;
  e.hitT = Math.max(0, e.hitT - dt); e.atkT = Math.max(0, e.atkT - dt); e.cd -= dt;
  if (b.weakT > 0) b.weakT = Math.max(0, b.weakT - dt);

  if (ph === 'dawn' || ph === 'day') { withdraw(s, b, e); return; }
  checkPhase(s, b, e);

  if (e.rise > 0) e.rise = Math.max(0, e.rise - dt);
  else {
    switch (b.state) {
      case 'walk': doWalk(s, b, e, dt); break;
      case 'windup': doWindup(s, b, e, dt); break;
      case 'exposed': doExposed(s, b, e, dt); break;
    }
  }
  // Mirrors for the art (plain values on the entity).
  e.pose = b.state;
  e.poseT = b.warn ? Math.min(1, b.warn.t / b.warn.dur) : b.state === 'exposed' ? Math.min(1, 1 - b.timer / COL.weakDur) : 0;
  e.weak = b.weakT > 0;
  e.phase = b.phase;
  e.slamX = b.sx; e.slamY = b.sy;
}

// ---- Arrival, withdrawal and death -------------------------------------------
function hearthXY(s) {
  const h = s.rt.hearth;
  return h ? [(h.tx + h.size / 2) * T, (h.ty + h.size / 2) * T] : [WORLD / 2, WORLD / 2];
}

function arrive(s, b) {
  const r = s.rt.rng;
  const [hx, hy] = hearthXY(s);
  const back = b.state === 'withdrawn';
  let x, y;
  if (back && b.mx != null) { x = b.mx; y = b.my; }
  else {
    const m = T * 1.2, M = WORLD - T * 1.2;
    const cands = [[m, m], [WORLD / 2, m], [M, m], [M, WORLD / 2], [M, M], [WORLD / 2, M], [m, M], [m, WORLD / 2]];
    cands.sort((p, q) => Math.hypot(q[0] - hx, q[1] - hy) - Math.hypot(p[0] - hx, p[1] - hy));
    [x, y] = cands[r.int(0, 2)];
  }
  const e = spawnEnemy(s, 'colossus', x, y, null);
  Object.assign(e, { boss: true, flying: false, scale: 1, pose: 'walk', poseT: 0, weak: false, phase: b.phase, rise: COL.rise, withdrawn: false });
  e.face = hx < x ? -1 : 1;
  if (back && b.hp > 0) { e.maxHp = b.maxHp || e.maxHp; e.hp = Math.min(e.maxHp, b.hp); }
  b.id = e.id; b.state = 'walk'; b.slamCd = COL.firstSlam; b.warn = null; b.weakT = 0; b.target = 0; b.double = false; b.timer = 0;
  b.withdrawn = false; b.lx = x; b.ly = y;
  emit(s, { t: 'bossRoar', x, y, boss: 'colossus', title: 'THE BONE COLOSSUS', sub: 'It walks straight for the Hearth. Strike its glowing ribs after each slam!' });
  emit(s, { t: 'toast', text: back ? 'The Bone Colossus heaves itself up from its bones, its cracks still open!' : 'The Bone Colossus strides out of the Elderwood! It smashes everything in its path.', tone: 'bad' });
}

function withdraw(s, b, e) {
  b.hp = Math.max(1, e.hp); b.maxHp = e.maxHp;
  b.mx = clamp(e.x, T, WORLD - T); b.my = clamp(e.y, T, WORLD - T);
  e.withdrawn = true; e.alive = false; // not a kill: kill() is never called
  b.state = 'withdrawn'; b.withdrawn = true; b.warn = null; b.weakT = 0; b.id = 0; b.target = 0; b.double = false;
  emit(s, { t: 'toast', text: 'At sunrise the Bone Colossus collapses into a heap of bones. It will rise there again at dusk.', tone: 'bad' });
}

function slain(s, b) {
  b.state = 'slain'; b.warn = null; b.weakT = 0; b.id = 0; b.hp = 0; b.mx = null; b.my = null;
  emit(s, { t: 'bossSlain', x: b.lx || 0, y: b.ly || 0, boss: 'colossus' });
  emit(s, { t: 'toast', text: 'The Bone Colossus shatters into a hill of grey bones!', tone: 'good' });
  if (s.objective && s.objective.type === 'boss') s.objective.done = true;
}

function checkPhase(s, b, e) {
  const f = e.hp / e.maxHp;
  const want = f < 0.25 ? 3 : f < 0.6 ? 2 : 1;
  while (b.phase < want) {
    b.phase++;
    const sub = b.phase === 2 ? 'Every slam now shakes Bone Husks loose.' : 'It slams twice in a row and strides faster!';
    emit(s, { t: 'bossPhase', phase: b.phase, boss: 'colossus', title: 'THE COLOSSUS CRACKS', sub });
    emit(s, { t: 'toast', text: b.phase === 2 ? 'The Bone Colossus cracks! Its slams now shake Bone Husks loose.' : 'The Bone Colossus is breaking apart! It slams twice and strides faster!', tone: 'bad' });
  }
}

// ---- States ---------------------------------------------------------------------
function doWalk(s, b, e, dt) {
  const d = COLOSSUS_DEF;
  const dm = d.dmg * (e.dmgMult || 1);
  b.slamCd -= dt;
  // Swat the nearest friendly in reach, else pound whatever blocks the stride.
  let busy = false;
  if (e.cd <= 0) {
    const reach = d.range * T + e.r;
    const f = s.rt.friendHash.nearest(e.x, e.y, reach + 8);
    if (f) {
      hurt(s, f, dm, d.dmgType, null, e.x, e.y, e);
      if (Math.abs(f.x - e.x) > 1) e.face = f.x < e.x ? -1 : 1;
      e.cd = d.rate; e.atkT = 0.45; busy = true;
      emit(s, { t: 'sfx', k: 'thud', x: e.x, y: e.y });
    }
  }
  if (b.slamCd <= 0) {
    if (s.cycle.phase === 'night' && startSlam(s, b, e)) return;
    b.slamCd = 1; // nothing worth slamming yet: look again soon
  }
  const blk = getB(s, b.target);
  if (blk && distToRect(e.x, e.y, blk) <= (COL.footR + 0.6) * T) {
    if (!busy && e.cd <= 0) {
      hurtBuilding(s, blk, dm * (blk.type === 'hearth' ? COL.hearthMult : 1), d.dmgType);
      blk.lastHit = s.time;
      e.cd = d.rate; e.atkT = 0.45;
      const cx = (blk.tx + blk.size / 2) * T;
      if (Math.abs(cx - e.x) > 2) e.face = cx < e.x ? -1 : 1;
      emit(s, { t: 'sfx', k: 'thud', x: e.x, y: e.y });
    }
    return;
  }
  b.target = 0;
  // Stride straight at the Hearth.
  const [hx, hy] = hearthXY(s);
  const dx = hx - e.x, dy = hy - e.y, dd = Math.hypot(dx, dy);
  if (dd < 1) return;
  const ti = idx(clamp(tileOf(e.x), 0, N - 1), clamp(tileOf(e.y), 0, N - 1));
  const wade = s.terrain[ti] === 4 || s.terrain[ti] === 5;
  const spd = d.speed * COL.speedMult[b.phase] * (e.speedMult || 1) * (wade ? COL.wadeMult : 1);
  const step = Math.min(dd, spd * T * dt);
  const nx = e.x + (dx / dd) * step, ny = e.y + (dy / dd) * step;
  if (Math.abs(dx) > 0.5) e.face = dx < 0 ? -1 : 1;
  // A building at the feet of the next stride blocks it: smash it first.
  let bestB = null, bestD = COL.footR * T;
  for (const bd of s.buildings) {
    if (!bd.alive) continue;
    const q = distToRect(nx, ny, bd);
    if (q < bestD && q <= distToRect(e.x, e.y, bd) + 0.01) { bestD = q; bestB = bd; }
  }
  if (bestB) { b.target = bestB.id; return; }
  e.x = nx; e.y = ny;
  e.anim += step * 0.05;
  trample(s, e);
}

// Trees under the giant's feet are crushed flat.
function trample(s, e) {
  const tx0 = tileOf(e.x - T * 0.7), tx1 = tileOf(e.x + T * 0.7), ty0 = tileOf(e.y - T * 0.5), ty1 = tileOf(e.y + T * 0.5);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!inB(tx, ty)) continue;
    const i = idx(tx, ty), id = s.nodeGrid[i];
    if (!id) continue;
    const n = s.rt.nById.get(id);
    if (!n || n.kind !== 'tree') continue;
    depleteNode(s, n); // the core's own removal: stump decal, 'felled' event, flow/terrain dirty
    emit(s, { t: 'sfx', k: 'chop', x: ctr(tx), y: ctr(ty) });
  }
}

// Pick the slam centre with the most friendlies and buildings inside the circle.
function startSlam(s, b, e) {
  const R = COL.slamR * T, reach = COL.slamReach * T;
  let best = null, bestScore = 0.99;
  const tryPoint = (px, py) => {
    const dx = px - e.x, dy = py - e.y, d = Math.hypot(dx, dy);
    if (d > reach) { px = e.x + (dx / d) * reach; py = e.y + (dy / d) * reach; }
    px = clamp(px, T * 0.5, WORLD - T * 0.5); py = clamp(py, T * 0.5, WORLD - T * 0.5);
    let score = 0;
    s.rt.friendHash.each(px, py, R, (f) => { score += f.kind === 'sovereign' ? 2 : f.kind === 'villager' ? 0.7 : 1; return false; });
    for (const bd of s.buildings) {
      if (!bd.alive || distToRect(px, py, bd) > R) continue;
      score += bd.type === 'hearth' ? 2 : BUILDINGS[bd.type] && BUILDINGS[bd.type].isWall ? 0.4 : 1;
    }
    if (score > bestScore + 1e-9) { bestScore = score; best = [px, py]; }
  };
  s.rt.friendHash.each(e.x, e.y, reach + R * 0.5, (f) => { tryPoint(f.x, f.y); return false; });
  for (const bd of s.buildings) {
    if (!bd.alive || distToRect(e.x, e.y, bd) > reach + R * 0.5) continue;
    tryPoint((bd.tx + bd.size / 2) * T, (bd.ty + bd.size / 2) * T);
  }
  if (!best) return false;
  b.warn = { x: best[0], y: best[1], r: R, t: 0, dur: COL.warnDur };
  b.sx = best[0]; b.sy = best[1];
  b.state = 'windup';
  if (b.phase >= 3 && !b.double) b.double = true;
  if (Math.abs(best[0] - e.x) > 2) e.face = best[0] < e.x ? -1 : 1;
  emit(s, { t: 'bossWarn', x: best[0], y: best[1], boss: 'colossus', slam: true });
  return true;
}

function doWindup(s, b, e, dt) {
  const w = b.warn;
  if (!w) { b.state = 'walk'; return; }
  w.t += dt;
  if (w.t < w.dur) return;
  slamImpact(s, b, e, w);
  b.warn = null;
  b.weakT = COL.weakDur;
  if (!b.toldWeak) { b.toldWeak = true; emit(s, { t: 'toast', text: 'Its rib cage glows! Strike the Colossus now for triple damage.', tone: 'good' }); }
  // Phase 3: a second slam right away (still telegraphed in full).
  if (b.double === true) {
    b.double = 'done';
    if (startSlam(s, b, e)) return;
  }
  b.double = false;
  b.state = 'exposed'; b.timer = COL.weakDur;
}

function slamImpact(s, b, e, w) {
  const dm = COLOSSUS_DEF.dmg * (e.dmgMult || 1);
  const hit = [];
  for (const bd of s.buildings) if (bd.alive && distToRect(w.x, w.y, bd) <= w.r) hit.push(bd);
  for (const bd of hit) { hurtBuilding(s, bd, dm * COL.slamBuildingDmg * (bd.type === 'hearth' ? COL.hearthMult : 1), 'crush'); bd.lastHit = s.time; }
  s.rt.friendHash.each(w.x, w.y, w.r + 6, (f) => { hurt(s, f, dm * COL.slamUnitDmg, 'crush', null, w.x, w.y, e); return false; });
  b.slams++;
  emit(s, { t: 'bossStrafe', x: w.x, y: w.y, impact: true, slam: true, boss: 'colossus', r: w.r });
  if (b.phase >= 2) raiseHusks(s, b, e);
}

function raiseHusks(s, b, e) {
  const r = s.rt.rng;
  const n = COL.husks[b.phase] || 0;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.float(-0.4, 0.4);
    let x = e.x + Math.cos(a) * T * 1.6, y = e.y + Math.sin(a) * T * 1.2;
    if (!freeWorld(s, x, y)) { x = e.x + r.float(-8, 8); y = e.y + T * 0.6; }
    spawnEnemy(s, 'bonehusk', x, y, null);
    emit(s, { t: 'spawn', x, y, elite: false });
  }
  if (!b.told) { b.told = true; emit(s, { t: 'toast', text: 'Bones shaken loose by the slam stand up as Bone Husks!', tone: 'bad' }); }
}

function doExposed(s, b, e, dt) {
  // Wrenching its fists out of the ground: it stands still and does not strike.
  b.timer -= dt;
  if (b.timer > 0) return;
  b.state = 'walk'; b.slamCd = COL.slamCd[b.phase]; b.timer = 0;
  e.cd = Math.max(e.cd, 0.4);
}

// ---- Helpers ------------------------------------------------------------------------
function freeWorld(s, x, y) {
  const tx = Math.floor(x / T), ty = Math.floor(y / T);
  if (!inB(tx, ty)) return false;
  const i = idx(tx, ty);
  return !s.occ[i] && !s.nodeGrid[i] && s.terrain[i] !== 4 && s.terrain[i] !== 5;
}

// ---- Plug-ins -------------------------------------------------------------------------
// x3 damage to the Colossus while its weak spot is exposed.
function dmgMult(s, src, t) {
  return t.boss && s.boss && s.boss.kind === 'colossus' && s.boss.weakT > 0 ? COL.weakMult : 1;
}

// Nothing can be built on the bone mound while the Colossus lies there by day.
function canPlace(s, type, tx, ty) {
  const b = s.boss;
  if (!b || b.kind !== 'colossus' || b.state !== 'withdrawn' || b.mx == null) return null;
  const size = (BUILDINGS[type] && BUILDINGS[type].size) || 1;
  const mx = tileOf(b.mx), my = tileOf(b.my), k = COL.moundBlock;
  if (tx + size - 1 >= mx - k && tx <= mx + k && ty + size - 1 >= my - k && ty <= my + k) return { ok: false, reason: 'The Colossus lies in its bones here' };
  return null;
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  registerBiomes();
  ENEMIES.colossus = { ...COLOSSUS_DEF, boss: true };
  ENEMIES.bonehusk = { ...BONEHUSK_DEF };
  BUS.dmgMult.push(dmgMult);
  BUS.canPlace.push(canPlace);
}
export const DEF = COLOSSUS_DEF;
