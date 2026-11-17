// The Hollow King, Act III boss: a tall crowned wraith. He drifts toward the
// living (phasing through walls that stand in darkness, like a Shade) and
// strikes in melee, and every few seconds casts one telegraphed ability:
//   SUMMON   a violet glyph for KING.summonDur s, then 4-6 Hollow rise around him
//   SNUFF    grey flame icons over the 2 nearest Braziers for KING.snuffDur s,
//            then they go dark for KING.snuffT s (b.snuffT; fog.js lightRadiusOf honours it)
//   TELEPORT a shadow mark at the destination KING.blinkDur s before he blinks there
// Below KING.darkAt health the MAP GOES DARK after a KING.darkWarn s countdown:
// friendlies on unlit tiles lose KING.darkDps health per second unless they stand
// within KING.sovSafe tiles of the Sovereign. Slaying him wins the run.
// Same API as boss.js (the Gloomwyrm); the lead dispatches by s.bossType.
import { RUN } from '../../data/balance.js';
import { BUILDINGS } from '../../data/buildings.js';
import { ENEMIES } from '../../data/enemies.js';
import { T, N, WORLD, idx, inB, ctr, distToRect, clamp, tileOf } from '../grid.js';
import { emit, hurt, hurtBuilding, spawnEnemy, getE, getB, markLightDirty } from './common.js';
import { MOVE, stepToward, separate } from './movement.js';
import { solidForEnemy } from './pathing.js';
import { registerBiomes } from '../../data/biomes-ext.js';

export const HOLLOWKING_DEF = {
  id: 'hollowking', name: 'The Hollow King', color: '#9a7fd0',
  desc: 'The crowned wraith at the heart of the Hollowing. He snuffs out your Braziers, raises the dead, steps through shadow, and at the last drowns the realm in darkness.',
  weak: 'Fire and the Hearth. Keep Braziers lit and soldiers near the Sovereign when the dark comes',
  hp: 5600, dmg: 30, dmgType: 'magic', rate: 1.3, range: 1.2, speed: 1.25, aggro: 4,
  tags: ['hollow', 'spirit', 'boss'], cost: 0, radius: 14, prefers: 'living', boss: true,
};

// Tunables (tiles, seconds).
export const KING = {
  abilityCd: [0, 7, 5.5, 4.5], // by phase, between abilities
  firstCd: 4,
  summonDur: 1.5,
  summon: [[0, 0], [4, 5], [5, 6], [5, 6]], // minions per summon by phase [min, max]
  summonTypes: [['shade', 4.5], ['husk', 3.5], ['knight', 2]],
  snuffDur: 2, snuffT: 12, snuffCount: 2,
  blinkDur: 1.5, blinkMin: 4,
  darkAt: 0.3, darkWarn: 3, darkDps: 6, darkTick: 0.5, sovSafe: 2,
  phase2: 0.6,
};
const ORDER = ['summon', 'snuff', 'teleport'];
const ACTIVE = { stalk: 1, cast: 1 };

export function initBoss(s) {
  s.boss = { kind: 'hollowking', state: 'dormant', arriveNight: RUN.bossNight, phase: 1, id: 0, act: null, abCd: 0, rot: 0, dark: false, darkWarn: null, darkAcc: 0, hp: 0, maxHp: 0, lx: 0, ly: 0, casts: 0, told: {}, withdrawn: false };
}

export function bossWaveNote(s, n) {
  const b = s.boss;
  if (!b || b.state === 'slain' || n < b.arriveNight) return null;
  if (b.state === 'withdrawn') return 'The Hollow King returns tonight!';
  if (b.state === 'dormant') return 'The Hollow King comes for the Heartflame tonight!';
  return null;
}

export function bossBar(s) {
  const b = s.boss;
  if (!b || (!ACTIVE[b.state] && b.state !== 'withdrawn')) return null;
  const e = getE(s, b.id);
  const name = HOLLOWKING_DEF.name;
  if (e) {
    let note = null;
    if (b.darkWarn) note = `Darkness in ${Math.max(1, Math.ceil(b.darkWarn.dur - b.darkWarn.t))}!`;
    else if (b.act) note = b.act.k === 'summon' ? 'Summoning the dead!' : b.act.k === 'snuff' ? 'Snuffing your Braziers!' : 'Stepping through shadow!';
    else if (b.dark) note = 'Darkness: stay in the light!';
    return { name, hp: Math.max(0, e.hp), maxHp: e.maxHp, phase: b.phase, note, dark: !!b.dark };
  }
  if (b.state === 'withdrawn') return { name, hp: b.hp, maxHp: b.maxHp, phase: b.phase, away: true, note: 'Returns at dusk' };
  return null;
}

/** The live King entity, if any. */
export function kingOf(s) { return s.boss && s.boss.kind === 'hollowking' ? getE(s, s.boss.id) : null; }

export function updateBoss(s, dt) {
  const b = s.boss;
  if (!b || b.state === 'slain') return;
  tickSnuff(s, dt);
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
  if (e.blinkT > 0) e.blinkT = Math.max(0, e.blinkT - dt);

  if (ph === 'dawn' || ph === 'day') { withdraw(s, b, e); return; }
  checkPhase(s, b, e);

  // Darkness: countdown, then damage over time.
  if (b.darkWarn) {
    const before = Math.ceil(b.darkWarn.dur - b.darkWarn.t);
    b.darkWarn.t += dt;
    const left = Math.ceil(b.darkWarn.dur - b.darkWarn.t);
    if (left !== before && left > 0) emit(s, { t: 'bossDarkWarn', left, boss: 'hollowking' });
    if (b.darkWarn.t >= b.darkWarn.dur) {
      b.darkWarn = null; b.dark = true; b.darkAcc = 0;
      emit(s, { t: 'bossDark', on: true, boss: 'hollowking' });
      emit(s, { t: 'toast', text: 'Darkness swallows the realm! Only light and the Sovereign keep it at bay.', tone: 'bad' });
    }
  } else if (b.dark) {
    b.darkAcc += dt;
    while (b.darkAcc >= KING.darkTick) { b.darkAcc -= KING.darkTick; darkHurt(s, KING.darkDps * KING.darkTick); }
  }

  // Abilities.
  if (b.act) {
    b.act.t += dt;
    if (b.act.t >= b.act.dur) finishAct(s, b, e);
  } else if (s.cycle.phase === 'night') {
    b.abCd -= dt;
    if (b.abCd <= 0) startAct(s, b, e);
  }

  if (b.state === 'stalk') stalk(s, b, e, dt);
  e.cast = b.act ? b.act.k : '';
  e.castP = b.act ? Math.min(1, b.act.t / b.act.dur) : 0;
  e.dark = !!b.dark;
  e.phase = b.phase;
}

// ---- Arrival, withdrawal and death -------------------------------------------
function hearthXY(s) {
  const h = s.rt.hearth;
  return h ? [(h.tx + h.size / 2) * T, (h.ty + h.size / 2) * T] : [WORLD / 2, WORLD / 2];
}

function arrive(s, b) {
  const r = s.rt.rng;
  const [hx, hy] = hearthXY(s);
  // Rise at a reachable spawn point far from the Hearth.
  const sp = (s.spawns || []).slice().sort((p, q) => Math.hypot(ctr(q.tx) - hx, ctr(q.ty) - hy) - Math.hypot(ctr(p.tx) - hx, ctr(p.ty) - hy));
  let x = WORLD / 2, y = T;
  if (sp.length) { const p = sp[r.int(0, Math.min(2, sp.length - 1))]; x = ctr(p.tx); y = ctr(p.ty); }
  const back = b.state === 'withdrawn';
  const e = spawnEnemy(s, 'hollowking', x, y, null);
  Object.assign(e, { boss: true, flying: false, scale: 1, cast: '', castP: 0, dark: false, blinkT: 0.8, phase: b.phase, withdrawn: false });
  e.face = hx < x ? -1 : 1;
  if (back && b.hp > 0) { e.maxHp = b.maxHp || e.maxHp; e.hp = Math.min(e.maxHp, b.hp); }
  b.id = e.id; b.state = 'stalk'; b.act = null; b.abCd = KING.firstCd; b.dark = false; b.darkWarn = null; b.darkAcc = 0;
  b.withdrawn = false; b.lx = x; b.ly = y;
  if (b.phase >= 3) startDark(s, b);
  emit(s, { t: 'bossRoar', x, y, boss: 'hollowking', title: 'THE HOLLOW KING', sub: 'Watch for his glyphs, his shadow marks and the grey flames over your Braziers!' });
  emit(s, { t: 'toast', text: back ? 'The Hollow King returns from the ash, colder than before.' : 'The Hollow King comes for the Heartflame!', tone: 'bad' });
}

function withdraw(s, b, e) {
  b.hp = Math.max(1, e.hp); b.maxHp = e.maxHp;
  e.withdrawn = true; e.alive = false; // not a kill
  b.state = 'withdrawn'; b.withdrawn = true; b.act = null; b.dark = false; b.darkWarn = null; b.id = 0;
  emit(s, { t: 'bossDark', on: false, boss: 'hollowking' });
  emit(s, { t: 'toast', text: 'The Hollow King fades with the dawn. He will return at dusk.', tone: 'bad' });
}

function slain(s, b) {
  b.state = 'slain'; b.act = null; b.dark = false; b.darkWarn = null; b.id = 0; b.hp = 0;
  // Every snuffed flame rekindles at once.
  let any = false;
  for (const bd of s.buildings) if (bd.snuffT > 0) { bd.snuffT = 0; any = true; }
  if (any) markLightDirty(s);
  emit(s, { t: 'bossDark', on: false, boss: 'hollowking' });
  emit(s, { t: 'bossSlain', x: b.lx || 0, y: b.ly || 0, boss: 'hollowking' });
  emit(s, { t: 'toast', text: 'The Hollow King unravels into ash and silence!', tone: 'good' });
  if (s.objective && s.objective.type === 'boss') s.objective.done = true;
}

function checkPhase(s, b, e) {
  const f = e.hp / e.maxHp;
  const want = f < KING.darkAt ? 3 : f < KING.phase2 ? 2 : 1;
  while (b.phase < want) {
    b.phase++;
    const sub = b.phase === 2 ? 'He casts faster and raises more of the dead.' : 'The dark is coming. Get into the light or beside the Sovereign!';
    emit(s, { t: 'bossPhase', phase: b.phase, boss: 'hollowking', title: b.phase === 3 ? 'THE KING DRAWS THE DARK' : 'THE KING STIRS', sub });
    emit(s, { t: 'toast', text: b.phase === 2 ? 'The Hollow King\'s crown blazes violet. He casts faster!' : 'The Hollow King raises his hands. The dark is coming!', tone: 'bad' });
    b.abCd = Math.min(b.abCd, 2);
    if (b.phase === 3) startDark(s, b);
  }
}

function startDark(s, b) {
  if (b.dark || b.darkWarn) return;
  b.darkWarn = { t: 0, dur: KING.darkWarn };
  emit(s, { t: 'bossDarkWarn', left: KING.darkWarn, boss: 'hollowking', first: true });
}

// 6 health per second to friendlies on unlit ground, except near the Sovereign.
function darkHurt(s, amt) {
  const sv = s.sovereign && s.sovereign.alive ? s.sovereign : null;
  const safe = KING.sovSafe * T;
  const lists = [s.villagers, s.soldiers, s.heroes || []];
  for (let l = 0; l < lists.length; l++) {
    const list = lists[l];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (!f.alive || f.st === 'sheltered' || f.away) continue;
      if (lit(s, f.x, f.y)) continue;
      if (sv && Math.abs(f.x - sv.x) <= safe && Math.abs(f.y - sv.y) <= safe && Math.hypot(f.x - sv.x, f.y - sv.y) <= safe) continue;
      hurt(s, f, amt, 'magic', null);
    }
  }
}
function lit(s, x, y) {
  const tx = tileOf(x), ty = tileOf(y);
  return inB(tx, ty) && s.lit[idx(tx, ty)] === 1;
}

// Snuffed Braziers count down and rekindle (fog.js lightRadiusOf reads b.snuffT).
function tickSnuff(s, dt) {
  let changed = false;
  for (const bd of s.buildings) {
    if (!(bd.snuffT > 0)) continue;
    bd.snuffT -= dt;
    if (bd.snuffT <= 0) { bd.snuffT = 0; changed = true; emit(s, { t: 'kingRekindle', x: (bd.tx + bd.size / 2) * T, y: (bd.ty + bd.size / 2) * T }); }
  }
  if (changed) markLightDirty(s);
}

// ---- Abilities ------------------------------------------------------------------
function startAct(s, b, e) {
  for (let k = 0; k < ORDER.length; k++) {
    const kind = ORDER[(b.rot + k) % ORDER.length];
    const act = kind === 'summon' ? planSummon(s, e) : kind === 'snuff' ? planSnuff(s, e) : planBlink(s, b, e);
    if (!act) continue;
    b.rot = (b.rot + k + 1) % ORDER.length;
    b.act = act; b.casts++;
    if (kind === 'summon') b.state = 'cast';
    emit(s, { t: 'bossWarn', x: act.x, y: act.y, boss: 'hollowking', k: kind });
    if (!b.told[kind]) {
      b.told[kind] = 1;
      const msg = { summon: 'The Hollow King draws a violet glyph: the dead will rise around him!', snuff: 'Grey flames hang over your Braziers: the King is about to snuff them out!', teleport: 'A shadow mark spreads by your buildings: the King will step out of it!' }[kind];
      emit(s, { t: 'toast', text: msg, tone: 'bad' });
    }
    return;
  }
  b.abCd = 1; // nothing to cast right now
}

function planSummon(s, e) {
  return { k: 'summon', t: 0, dur: KING.summonDur, x: e.x, y: e.y };
}

function planSnuff(s, e) {
  const cands = [];
  for (const bd of s.buildings) {
    if (!bd.alive || !bd.built || bd.type !== 'brazier' || bd.snuffT > 0) continue;
    cands.push({ id: bd.id, d: Math.hypot((bd.tx + 0.5) * T - e.x, (bd.ty + 0.5) * T - e.y) });
  }
  if (!cands.length) return null;
  cands.sort((p, q) => p.d - q.d || p.id - q.id);
  const ids = cands.slice(0, KING.snuffCount).map((c) => c.id);
  const first = getB(s, ids[0]);
  return { k: 'snuff', t: 0, dur: KING.snuffDur, ids, x: (first.tx + 0.5) * T, y: (first.ty + 0.5) * T };
}

function bValue(bd) {
  if (bd.type === 'hearth') return 6;
  const def = BUILDINGS[bd.type];
  if (!def || def.isWall) return 0;
  return 2 + bd.level + (bd.type === 'brazier' || bd.type === 'tower' ? 1.5 : 0);
}

function planBlink(s, b, e) {
  const r = s.rt.rng;
  const cands = [];
  for (const bd of s.buildings) {
    if (!bd.alive || !bd.built) continue;
    const v = bValue(bd);
    if (v <= 0 || distToRect(e.x, e.y, bd) < KING.blinkMin * T) continue;
    cands.push({ bd, v });
  }
  if (!cands.length) return null;
  const pick = r.weighted(cands, (c) => c.v).bd;
  const spots = [];
  for (let ring = 1; ring <= 2 && !spots.length; ring++) {
    for (let ty = pick.ty - ring; ty < pick.ty + pick.size + ring; ty++) for (let tx = pick.tx - ring; tx < pick.tx + pick.size + ring; tx++) {
      if (tx >= pick.tx && tx < pick.tx + pick.size && ty >= pick.ty && ty < pick.ty + pick.size) continue;
      if (freeTile(s, tx, ty)) spots.push(idx(tx, ty));
    }
  }
  if (!spots.length) return null;
  const i = r.pick(spots);
  return { k: 'teleport', t: 0, dur: KING.blinkDur, x: ctr(i % N), y: ctr((i / N) | 0), fx: e.x, fy: e.y, bid: pick.id };
}

function finishAct(s, b, e) {
  const a = b.act;
  b.act = null;
  b.abCd = KING.abilityCd[b.phase];
  if (a.k === 'summon') {
    b.state = 'stalk';
    const r = s.rt.rng;
    const [lo, hi] = KING.summon[b.phase];
    const n = r.int(lo, hi);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + r.float(-0.3, 0.3);
      let x = a.x + Math.cos(ang) * T * 1.5, y = a.y + Math.sin(ang) * T * 1.2;
      if (!freeTile(s, tileOf(x), tileOf(y))) { x = a.x + r.float(-6, 6); y = a.y + r.float(-6, 6); }
      const type = r.weighted(KING.summonTypes, (q) => q[1])[0];
      spawnEnemy(s, type, x, y, null);
      emit(s, { t: 'spawn', x, y, elite: false });
    }
    emit(s, { t: 'kingSummon', x: a.x, y: a.y, n });
  } else if (a.k === 'snuff') {
    let any = false;
    for (const id of a.ids) {
      const bd = getB(s, id);
      if (!bd) continue;
      bd.snuffT = KING.snuffT; any = true;
      emit(s, { t: 'kingSnuff', x: (bd.tx + 0.5) * T, y: (bd.ty + 0.5) * T });
    }
    if (any) markLightDirty(s);
  } else if (a.k === 'teleport') {
    emit(s, { t: 'kingBlink', fx: e.x, fy: e.y, x: a.x, y: a.y });
    e.x = a.x; e.y = a.y; e.px = a.x; e.py = a.y;
    e.targetId = 0; e.siege = 0; e.blinkT = 0.8; e.cd = Math.max(e.cd, 0.5);
  }
}

// ---- Movement and melee -----------------------------------------------------------
function stalk(s, b, e, dt) {
  const d = HOLLOWKING_DEF;
  const rt = s.rt;
  const speed = d.speed * (e.speedMult || 1) * (b.phase >= 2 ? 1.15 : 1);
  e.think -= dt;
  if (e.think <= 0) {
    e.think = 0.4;
    const f = rt.friendHash.nearest(e.x, e.y, d.aggro * T);
    e.targetId = f ? f.id : 0;
  }
  const t = getE(s, e.targetId);
  if (t && Math.hypot(t.x - e.x, t.y - e.y) < (d.aggro + 2) * T) {
    const reach = d.range * T + t.r + e.r * 0.4;
    if (Math.abs(t.x - e.x) > 1) e.face = t.x < e.x ? -1 : 1;
    if (Math.hypot(t.x - e.x, t.y - e.y) <= reach) { if (e.cd <= 0) strike(s, e, t, null); }
    else if (stepToward(s, e, t.x, t.y, speed, dt, 'phase') === MOVE.BLOCKED) e.targetId = 0;
    separate(s, e, rt.enemyHash, e.r * 1.4, 'phase');
    return;
  }
  e.targetId = 0;
  const reachB = d.range * T + e.r + 2;
  const sb = getB(s, e.siege);
  if (sb) {
    if (distToRect(e.x, e.y, sb) <= reachB) { if (e.cd <= 0) strike(s, e, null, sb); return; }
    stepToward(s, e, (sb.tx + sb.size / 2) * T, (sb.ty + sb.size / 2) * T, speed, dt, 'phase');
    return;
  }
  e.siege = 0;
  const ti = idx(clamp(tileOf(e.x), 0, N - 1), clamp(tileOf(e.y), 0, N - 1));
  const n = rt.fieldP.next[ti];
  let gx, gy;
  if (n < 0) {
    const h = rt.hearth;
    if (!h) return;
    if (distToRect(e.x, e.y, h) <= reachB) { e.siege = h.id; return; }
    gx = (h.tx + h.size / 2) * T; gy = (h.ty + h.size / 2) * T;
  } else {
    const occ = s.occ[n];
    if (occ && solidForEnemy(s, n, true)) { e.siege = occ; return; }
    gx = ctr(n % N); gy = ctr((n / N) | 0);
  }
  if (stepToward(s, e, gx, gy, speed, dt, 'phase') === MOVE.BLOCKED && e.blockTile >= 0 && s.occ[e.blockTile]) e.siege = s.occ[e.blockTile];
  separate(s, e, rt.enemyHash, e.r * 1.4, 'phase');
}

function strike(s, e, target, building) {
  const d = HOLLOWKING_DEF;
  e.cd = d.rate; e.atkT = 0.3;
  const dmg = d.dmg * (e.dmgMult || 1);
  if (target) hurt(s, target, dmg, d.dmgType, null, e.x, e.y, e);
  else if (building) { hurtBuilding(s, building, dmg * (building.type === 'hearth' ? 0.6 : 1), d.dmgType); building.lastHit = s.time; }
  emit(s, { t: 'sfx', k: building ? 'thud' : 'bite', x: e.x, y: e.y });
}

function freeTile(s, tx, ty) {
  if (!inB(tx, ty)) return false;
  const i = idx(tx, ty);
  return !s.occ[i] && !s.nodeGrid[i] && s.terrain[i] !== 4 && s.terrain[i] !== 5;
}

let done = false;
export function register() {
  if (done) return;
  done = true;
  registerBiomes();
  ENEMIES.hollowking = { ...HOLLOWKING_DEF, boss: true };
}
export const DEF = HOLLOWKING_DEF;
