// The Gloomwyrm, Act 1 boss. A grey dragon that circles the settlement, then
// strafes the densest row or column of buildings with grey fire. Every pass is
// telegraphed by a warning band (s.boss.warn) for WYRM.warnDur seconds first.
// The wyrm is an ordinary entry in s.enemies (boss: true) so targeting, hurt()
// and the spatial hash keep working; this module alone moves it.
import { RUN } from '../../data/balance.js';
import { BUILDINGS } from '../../data/buildings.js';
import { T, N, WORLD, idx, inB, ctr, distToRect, clamp } from '../grid.js';
import { emit, hurt, hurtBuilding, spawnEnemy, getE } from './common.js';

export const GLOOMWYRM_DEF = {
  id: 'gloomwyrm', name: 'The Gloomwyrm', color: '#7d7594',
  desc: 'A grey dragon of the Hollowing. It strafes rows of buildings with grey fire, then lands to feed. Watch the sky for its warning line.',
  weak: 'Towers and Archers while it flies; every soldier once it lands',
  hp: 2300, dmg: 34, dmgType: 'fire', rate: 1.2, range: 1.1, speed: 4.5, aggro: 3,
  tags: ['hollow', 'beast', 'boss'], cost: 0, radius: 18, prefers: 'buildings', boss: true,
};

// Tunables (tiles, seconds, fractions of GLOOMWYRM_DEF.dmg).
export const WYRM = {
  warnDur: 2.0,
  bandTiles: 1.6,              // strafe band width
  highZ: 150, aimZ: 70, strafeZ: 26,
  circleTime: [0, 5, 3.6, 2.8],  // by phase
  strafeSpeed: [0, 8, 11, 12.5], // tiles per second, by phase
  aimSpeed: 11,
  strafeBuildingDmg: 1.6,      // x dmg to each building in the band, once per pass
  strafeUnitDmg: 0.7,          // x dmg to each friendly in the band, once per pass
  diveHearthDmg: 2.0,          // x dmg to the Hearth at the end of a dive
  perchTime: 6,
  summon: [4, 6],
  lineOverhang: 3.5,           // tiles the strafe line runs past the outermost building
  orbitMin: 7, orbitMax: 14,
};

const ACTIVE = { circle: 1, aim: 1, strafe: 1, land: 1, perch: 1 };

export function initBoss(s) {
  s.boss = { state: 'dormant', arriveNight: RUN.bossNight, phase: 1, id: 0, timer: 0, warn: null, warn2: null, strafes: 0, withdrawn: false, hp: 0, maxHp: 0 };
}

export function bossWaveNote(s, n) {
  const b = s.boss;
  if (!b || b.state === 'slain' || n < b.arriveNight) return null;
  if (b.state === 'withdrawn') return 'The wounded Gloomwyrm returns tonight!';
  if (b.state === 'dormant') return 'The Gloomwyrm descends tonight!';
  return null;
}

export function bossBar(s) {
  const b = s.boss;
  if (!b || !ACTIVE[b.state] && b.state !== 'withdrawn') return null;
  const e = getE(s, b.id);
  if (e) return { name: GLOOMWYRM_DEF.name, hp: Math.max(0, e.hp), maxHp: e.maxHp, phase: b.phase };
  if (b.state === 'withdrawn') return { name: GLOOMWYRM_DEF.name, hp: b.hp, maxHp: b.maxHp, phase: b.phase, away: true };
  return null;
}

/** The live wyrm entity, if any (render and HUD helpers use this too). */
export function wyrmOf(s) { return s.boss ? getE(s, s.boss.id) : null; }

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
  e.anim += dt;

  if (ph === 'dawn' || ph === 'day') { withdraw(s, b, e); return; }
  checkPhase(s, b, e);

  switch (b.state) {
    case 'circle': doCircle(s, b, e, dt); break;
    case 'aim': doAim(s, b, e, dt); break;
    case 'strafe': doStrafe(s, b, e, dt); break;
    case 'land': doLand(s, b, e, dt); break;
    case 'perch': doPerch(s, b, e, dt); break;
  }
  if (b.warn && b.warn.t < b.warn.dur + 30) b.warn.t += dt;
  if (b.warn2 && b.warn2.t < b.warn2.dur + 30) b.warn2.t += dt;
  e.fire = b.state === 'strafe';
}

// ---- Arrival, withdrawal and death -------------------------------------------
function arrive(s, b) {
  const r = s.rt.rng;
  const h = s.rt.hearth;
  const hx = h ? (h.tx + 1.5) * T : WORLD / 2, hy = h ? (h.ty + 1.5) * T : WORLD / 2;
  const m = T, M = WORLD - T;
  const cands = [[m, m], [WORLD / 2, m], [M, m], [M, WORLD / 2], [M, M], [WORLD / 2, M], [m, M], [m, WORLD / 2]];
  cands.sort((p, q) => Math.hypot(q[0] - hx, q[1] - hy) - Math.hypot(p[0] - hx, p[1] - hy));
  const [x, y] = cands[r.int(0, 2)];
  const e = spawnEnemy(s, 'gloomwyrm', x, y, null);
  Object.assign(e, { boss: true, flying: true, z: WYRM.highZ, scale: 4, ang: Math.atan2(hy - y, hx - x), fire: false, withdrawn: false });
  e.face = hx < x ? -1 : 1;
  const back = b.state === 'withdrawn';
  if (back && b.hp > 0) { e.maxHp = b.maxHp || e.maxHp; e.hp = Math.min(e.maxHp, b.hp); }
  b.id = e.id; b.state = 'circle'; b.timer = WYRM.circleTime[b.phase] + 3; b.orbitAng = Math.atan2(y - hy, x - hx);
  b.warn = null; b.warn2 = null; b.lines = null; b.li = 0; b.withdrawn = false; b.diveNext = false; b.told = false;
  b.lx = x; b.ly = y;
  emit(s, { t: 'bossRoar', x, y });
  emit(s, { t: 'toast', text: back ? 'The Gloomwyrm returns, its wounds still smoking!' : 'The Gloomwyrm descends on the realm! Watch for its warning lines.', tone: 'bad' });
}

function withdraw(s, b, e) {
  b.hp = Math.max(1, e.hp); b.maxHp = e.maxHp;
  e.withdrawn = true; e.alive = false; // not a kill: kill() is never called
  e.flying = true;
  b.state = 'withdrawn'; b.withdrawn = true; b.warn = null; b.warn2 = null; b.lines = null; b.id = 0;
  emit(s, { t: 'toast', text: 'The Gloomwyrm withdraws into the grey sky. It will return at dusk.', tone: 'bad' });
}

function slain(s, b) {
  b.state = 'slain'; b.warn = null; b.warn2 = null; b.lines = null; b.id = 0; b.hp = 0;
  emit(s, { t: 'bossSlain', x: b.lx || 0, y: b.ly || 0 });
  emit(s, { t: 'toast', text: 'The Gloomwyrm is slain! Its grey fire gutters out.', tone: 'good' });
  if (s.objective && s.objective.type === 'boss') s.objective.done = true;
}

function checkPhase(s, b, e) {
  const f = e.hp / e.maxHp;
  const want = f < 0.33 ? 3 : f < 0.66 ? 2 : 1;
  while (b.phase < want) {
    b.phase++;
    emit(s, { t: 'bossPhase', phase: b.phase });
    emit(s, { t: 'toast', text: b.phase === 2 ? 'The Gloomwyrm shrieks! It flies faster and calls the Hollow to it.' : 'The Gloomwyrm is desperate! Twin fire lines, then it dives at the Hearth!', tone: 'bad' });
    if (b.state === 'perch') b.timer = Math.min(b.timer, 0.6);
  }
}

// ---- Movement helpers ------------------------------------------------------------
function flyTo(e, x, y, speedTiles, dt) {
  const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
  if (d < 0.5) return 0;
  const step = Math.min(d, speedTiles * T * dt);
  e.x += (dx / d) * step; e.y += (dy / d) * step;
  face(e, dx, dy, dt);
  return d - step;
}
function face(e, dx, dy, dt) {
  if (Math.abs(dx) > 0.3) e.face = dx < 0 ? -1 : 1;
  const a = Math.atan2(dy, dx);
  let da = a - (e.ang || 0);
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  let n = (e.ang || 0) + da * Math.min(1, dt * 6);
  // Keep the heading in [-PI, PI] so it never drifts while circling.
  if (n > Math.PI) n -= Math.PI * 2; else if (n < -Math.PI) n += Math.PI * 2;
  e.ang = n;
}
function towardZ(e, z, rate, dt) {
  const d = z - (e.z || 0);
  e.z = (e.z || 0) + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
}

function settlementCenter(s) {
  let x = 0, y = 0, n = 0, ext = 0;
  for (const b of s.buildings) { if (!b.alive) continue; x += (b.tx + b.size / 2) * T; y += (b.ty + b.size / 2) * T; n++; }
  if (!n) { const h = s.rt.hearth; return h ? { x: (h.tx + 1.5) * T, y: (h.ty + 1.5) * T, r: WYRM.orbitMin * T } : { x: WORLD / 2, y: WORLD / 2, r: WYRM.orbitMin * T }; }
  x /= n; y /= n;
  for (const b of s.buildings) if (b.alive) ext = Math.max(ext, Math.hypot((b.tx + b.size / 2) * T - x, (b.ty + b.size / 2) * T - y));
  return { x, y, r: clamp(ext + 3 * T, WYRM.orbitMin * T, WYRM.orbitMax * T) };
}

// ---- States ---------------------------------------------------------------------
function doCircle(s, b, e, dt) {
  const c = settlementCenter(s);
  const spd = GLOOMWYRM_DEF.speed * (b.phase > 1 ? 1.25 : 1) * (e.speedMult || 1);
  b.orbitAng = (b.orbitAng || 0) + (spd * T / c.r) * dt;
  const tx = clamp(c.x + Math.cos(b.orbitAng) * c.r, T, WORLD - T), ty = clamp(c.y + Math.sin(b.orbitAng) * c.r, T, WORLD - T);
  flyTo(e, tx, ty, spd * 1.5, dt);
  towardZ(e, WYRM.highZ, 90, dt);
  e.flying = true;
  b.timer -= dt;
  if (b.timer <= 0 && s.cycle.phase === 'night') startAim(s, b, e);
}

function startAim(s, b, e) {
  let lines;
  if (b.diveNext) { lines = [diveLine(s, e)]; b.diveNext = false; }
  else {
    const first = pickLine(s, e.x, e.y, null);
    lines = [first];
    if (b.phase >= 3) {
      const second = pickLine(s, first.x2, first.y2, first.vert ? 'h' : 'v');
      lines.push(second);
    }
  }
  b.lines = lines; b.li = 0;
  const mk = (l) => ({ x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, width: WYRM.bandTiles * T, t: 0, dur: WYRM.warnDur, dive: !!l.dive });
  b.warn = mk(lines[0]);
  b.warn2 = lines[1] ? mk(lines[1]) : null;
  b.state = 'aim'; b.timer = 0;
  emit(s, { t: 'bossWarn', x: (lines[0].x1 + lines[0].x2) / 2, y: (lines[0].y1 + lines[0].y2) / 2, n: lines.length, dive: !!lines[0].dive });
}

function doAim(s, b, e, dt) {
  const w = b.warn;
  if (!w) { b.state = 'circle'; b.timer = 1; return; }
  const left = flyTo(e, w.x1, w.y1, WYRM.aimSpeed * (e.speedMult || 1), dt);
  towardZ(e, WYRM.aimZ, 70, dt);
  if (left > 1) { b.timer += dt; if (w.t < w.dur + 3) return; e.x = w.x1; e.y = w.y1; }
  // Line up with the band while the warning finishes.
  face(e, w.x2 - w.x1, w.y2 - w.y1, dt);
  if (w.t < w.dur) return;
  b.state = 'strafe'; b.prog = 0; b.hitB = []; b.hitF = []; b.burnT = 0;
  b.strafeWarnT = w.t;
  b.strafes++;
  emit(s, { t: 'bossStrafe', x: e.x, y: e.y, dive: !!w.dive });
}

function doStrafe(s, b, e, dt) {
  const w = b.warn;
  if (!w) { b.state = 'circle'; b.timer = 1; return; }
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const spd = WYRM.strafeSpeed[b.phase] * (e.speedMult || 1) * (w.dive ? 1.1 : 1);
  b.prog = Math.min(len, (b.prog || 0) + spd * T * dt);
  e.x = w.x1 + ux * b.prog; e.y = w.y1 + uy * b.prog;
  face(e, ux, uy, dt * 3);
  towardZ(e, WYRM.strafeZ, 160, dt);
  e.flying = true;
  const half = w.width / 2;
  const dm = GLOOMWYRM_DEF.dmg * (e.dmgMult || 1) * (b.phase > 1 ? 1.15 : 1);

  // Buildings: rect within half-width of the line and already passed over.
  for (const bd of s.buildings) {
    if (!bd.alive || b.hitB.includes(bd.id)) continue;
    const x0 = bd.tx * T, y0 = bd.ty * T, x1 = x0 + bd.size * T, y1 = y0 + bd.size * T;
    let pmin = 1e9, pmax = -1e9, dmin = 1e9, dmax = -1e9;
    for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const rx = cx - w.x1, ry = cy - w.y1;
      const along = rx * ux + ry * uy, perp = rx * -uy + ry * ux;
      if (along < pmin) pmin = along; if (along > pmax) pmax = along;
      if (perp < dmin) dmin = perp; if (perp > dmax) dmax = perp;
    }
    const perpDist = dmin <= 0 && dmax >= 0 ? 0 : Math.min(Math.abs(dmin), Math.abs(dmax));
    if (perpDist > half || pmin > b.prog || pmax < 0) continue;
    b.hitB.push(bd.id);
    const amt = dm * WYRM.strafeBuildingDmg * (bd.type === 'hearth' ? 0.5 : 1);
    hurtBuilding(s, bd, amt, 'fire');
    bd.lastHit = s.time;
    emit(s, { t: 'burn', x: (bd.tx + bd.size / 2) * T, y: (bd.ty + bd.size / 2) * T });
  }
  // Friendlies in the band around the wyrm's current point.
  s.rt.friendHash.each(e.x, e.y, half + T * 0.5, (f) => {
    if (b.hitF.includes(f.id)) return false;
    const rx = f.x - w.x1, ry = f.y - w.y1;
    if (Math.abs(rx * -uy + ry * ux) > half + f.r) return false;
    b.hitF.push(f.id);
    hurt(s, f, dm * WYRM.strafeUnitDmg, 'fire', null, e.x, e.y);
    return false;
  });
  b.burnT = (b.burnT || 0) - dt;
  if (b.burnT <= 0) { b.burnT = 0.15; emit(s, { t: 'burn', x: e.x + s.rt.rng.float(-half, half) * uy, y: e.y - s.rt.rng.float(-half, half) * ux }); }

  if (b.prog < len) return;
  // Pass complete.
  if (w.dive) diveImpact(s, b, e, dm);
  if (b.lines && b.li + 1 < b.lines.length) {
    b.li++; b.warn = b.warn2; b.warn2 = null;
    b.state = 'aim';
    return;
  }
  b.warn = null; b.warn2 = null;
  const lastLine = b.lines && b.lines[b.li];
  b.lines = null;
  if (b.phase >= 3 && !w.dive) { b.diveNext = true; startAim(s, b, e); return; }
  b.perch = perchSpot(s, e.x, e.y, w.dive || (lastLine && lastLine.dive));
  b.state = 'land'; b.timer = 0;
}

function diveImpact(s, b, e, dm) {
  const h = s.rt.hearth;
  if (h && h.alive) hurtBuilding(s, h, dm * WYRM.diveHearthDmg, 'fire');
  s.rt.friendHash.each(e.x, e.y, T * 2.2, (f) => { hurt(s, f, dm, 'fire', null, e.x, e.y); return false; });
  emit(s, { t: 'bossStrafe', x: e.x, y: e.y, impact: true });
  for (let i = 0; i < 5; i++) emit(s, { t: 'burn', x: e.x + s.rt.rng.float(-40, 40), y: e.y + s.rt.rng.float(-30, 30) });
}

function doLand(s, b, e, dt) {
  const p = b.perch || { x: e.x, y: e.y };
  const left = flyTo(e, p.x, p.y, WYRM.aimSpeed * 0.7, dt);
  towardZ(e, 0, 110, dt);
  b.timer += dt;
  if ((left > 2 || e.z > 1) && b.timer < 6) return;
  e.x = p.x; e.y = p.y; e.z = 0; e.flying = false;
  b.state = 'perch'; b.timer = WYRM.perchTime; e.cd = 0.6;
  emit(s, { t: 'bossLand', x: e.x, y: e.y });
  if (b.phase >= 2) summon(s, b, e);
}

function doPerch(s, b, e, dt) {
  e.flying = false; e.z = 0;
  if (b.perch) { e.x = b.perch.x; e.y = b.perch.y; } // shrug off knockback
  b.timer -= dt;
  if (e.cd <= 0) {
    const d = GLOOMWYRM_DEF;
    const dm = d.dmg * (e.dmgMult || 1);
    const reach = d.range * T + e.r;
    const f = s.rt.friendHash.nearest(e.x, e.y, reach + 8);
    let hit = false;
    if (f) { hurt(s, f, dm, d.dmgType, null, e.x, e.y); face(e, f.x - e.x, f.y - e.y, 1); hit = true; }
    else {
      let best = null, bd = reach;
      for (const bl of s.buildings) { if (!bl.alive) continue; const dd = distToRect(e.x, e.y, bl); if (dd <= bd) { bd = dd; best = bl; } }
      if (best) { hurtBuilding(s, best, dm * (best.type === 'hearth' ? 0.5 : 1), d.dmgType); best.lastHit = s.time; face(e, (best.tx + best.size / 2) * T - e.x, (best.ty + best.size / 2) * T - e.y, 1); hit = true; }
    }
    e.cd = hit ? d.rate : 0.3;
    if (hit) { e.atkT = 0.3; emit(s, { t: 'sfx', k: 'bite', x: e.x, y: e.y }); }
  }
  if (b.timer > 0) return;
  b.state = 'circle'; b.timer = WYRM.circleTime[b.phase]; e.flying = true; b.perch = null;
  const c = settlementCenter(s);
  b.orbitAng = Math.atan2(e.y - c.y, e.x - c.x);
  emit(s, { t: 'bossTakeoff', x: e.x, y: e.y }); // not bossRoar: that one opens the fight with a banner
}

function summon(s, b, e) {
  const r = s.rt.rng;
  const n = r.int(WYRM.summon[0], WYRM.summon[1]);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.float(-0.3, 0.3);
    let x = e.x + Math.cos(a) * T * 1.4, y = e.y + Math.sin(a) * T * 1.4;
    if (!freeWorld(s, x, y)) { x = e.x; y = e.y; }
    spawnEnemy(s, r.chance(0.5) ? 'hound' : 'husk', x, y, null);
    emit(s, { t: 'spawn', x, y, elite: false });
  }
  if (!b.told) { b.told = true; emit(s, { t: 'toast', text: 'The Gloomwyrm calls the Hollow to its side!', tone: 'bad' }); }
}

// ---- Targeting ---------------------------------------------------------------------
function freeTile(s, tx, ty) {
  if (!inB(tx, ty)) return false;
  const i = idx(tx, ty);
  return !s.occ[i] && !s.nodeGrid[i] && s.terrain[i] !== 4 && s.terrain[i] !== 5;
}
function freeWorld(s, x, y) { return freeTile(s, Math.floor(x / T), Math.floor(y / T)); }

function bValue(b) {
  if (b.type === 'hearth') return 90;
  const def = BUILDINGS[b.type];
  if (!def || !def.levels) return 1;
  let v = 0;
  for (let l = 0; l <= b.level && l < def.levels.length; l++) { const c = def.levels[l].cost || {}; for (const k in c) v += c[k] * (k === 'gold' ? 1.5 : 1); }
  return def.isWall ? v * 0.3 : v;
}

// Land next to the most valuable building near (x, y), or beside the Hearth after a dive.
// The Hearth is only chosen after a dive (or when nothing else stands): the dive is its
// telegraphed threat, and perching there every pass made undefended Hearths melt.
function perchSpot(s, x, y, atHearth) {
  const h = s.rt.hearth;
  let target = atHearth && h && h.alive ? h : null;
  if (!target) {
    let bv = -1;
    for (const b of s.buildings) {
      if (!b.alive || b.type === 'hearth') continue;
      const d = distToRect(x, y, b);
      if (d > 6 * T) continue;
      const v = bValue(b) - d * 0.05;
      if (v > bv) { bv = v; target = b; }
    }
  }
  if (!target) {
    let bv = -1;
    for (const b of s.buildings) if (b.alive) { const v = bValue(b); if (v > bv) { bv = v; target = b; } }
  }
  if (!target) return { x: clamp(x, T, WORLD - T), y: clamp(y, T, WORLD - T) };
  let best = null, bd = 1e9;
  for (let ring = 1; ring <= 3 && !best; ring++) {
    for (let ty = target.ty - ring; ty < target.ty + target.size + ring; ty++) for (let tx = target.tx - ring; tx < target.tx + target.size + ring; tx++) {
      if (!freeTile(s, tx, ty)) continue;
      const d = Math.hypot(ctr(tx) - x, ctr(ty) - y);
      if (d < bd) { bd = d; best = { x: ctr(tx), y: ctr(ty) }; }
    }
  }
  return best || { x: clamp(x, T, WORLD - T), y: clamp(y, T, WORLD - T) };
}

/**
 * Strafe line through the densest band of buildings. Bands run along rows ('h')
 * or columns ('v'), centred every half tile. `only` restricts the orientation.
 * The line starts at whichever end is nearer (fromX, fromY).
 */
function pickLine(s, fromX, fromY, only) {
  const half = (WYRM.bandTiles * T) / 2;
  const cands = [];
  for (const o of only ? [only] : ['h', 'v']) {
    for (let k = 1; k < N * 2; k++) {
      const c = (k * T) / 2;
      let score = 0, lo = 1e9, hi = -1e9;
      for (const b of s.buildings) {
        if (!b.alive) continue;
        const a0 = (o === 'h' ? b.ty : b.tx) * T, a1 = a0 + b.size * T;
        if (a1 <= c - half + 2 || a0 >= c + half - 2) continue;
        if (!s.fog[idx(b.tx, b.ty)]) continue;
        score += b.type === 'hearth' ? 1.5 : BUILDINGS[b.type] && BUILDINGS[b.type].isWall ? 0.4 : 1;
        const p0 = (o === 'h' ? b.tx : b.ty) * T, p1 = p0 + b.size * T;
        if (p0 < lo) lo = p0; if (p1 > hi) hi = p1;
      }
      if (score > 0) cands.push({ o, c, score, lo, hi });
    }
  }
  let pick;
  if (!cands.length) {
    const h = s.rt.hearth;
    const hx = h ? (h.tx + 1.5) * T : WORLD / 2, hy = h ? (h.ty + 1.5) * T : WORLD / 2;
    const o = only || (s.rt.rng.chance(0.5) ? 'h' : 'v');
    pick = { o, c: o === 'h' ? hy : hx, lo: (o === 'h' ? hx : hy) - 2 * T, hi: (o === 'h' ? hx : hy) + 2 * T };
  } else {
    cands.sort((a, b) => b.score - a.score);
    const top = cands.slice(0, 4);
    pick = s.rt.rng.weighted(top, (q) => q.score * q.score);
  }
  const ov = WYRM.lineOverhang * T;
  const a = clamp(pick.lo - ov, T * 0.5, WORLD - T * 0.5), z = clamp(pick.hi + ov, T * 0.5, WORLD - T * 0.5);
  let l = pick.o === 'h' ? { x1: a, y1: pick.c, x2: z, y2: pick.c } : { x1: pick.c, y1: a, x2: pick.c, y2: z };
  if (Math.hypot(l.x2 - fromX, l.y2 - fromY) < Math.hypot(l.x1 - fromX, l.y1 - fromY)) l = { x1: l.x2, y1: l.y2, x2: l.x1, y2: l.y1 };
  l.vert = pick.o === 'v';
  return l;
}

// A dive ends on the Hearth, approaching from the wyrm's side.
function diveLine(s, e) {
  const h = s.rt.hearth;
  const hx = h ? (h.tx + 1.5) * T : WORLD / 2, hy = h ? (h.ty + 1.5) * T : WORLD / 2;
  let dx = e.x - hx, dy = e.y - hy;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const L = 9 * T;
  return { x1: clamp(hx + dx * L, T, WORLD - T), y1: clamp(hy + dy * L, T, WORLD - T), x2: hx, y2: hy, dive: true };
}
