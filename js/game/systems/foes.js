// Phase 4 foes: Goblin Raider, Riftspawner, Ash Wyvern, Bog Witch, Frost Wraith, Ash Imp.
// Data in js/data/enemies-p4.js, art in js/engine/foeart.js. Everything plugs into the core
// through BUS (js/game/hooks.js). Deterministic: no Math.random/Date in anything that changes
// state (the region RNG is used only when tonight's plan is rolled).
//
// How each foe works with the core AI (js/game/systems/enemies.js):
//   goblin, wyvern  Their defs have aggro 0, so the core never picks a living target for them,
//                   and BUS.tick (which runs after the core) undoes the core's flow-field step
//                   (x,y back to px,py: the position at the start of the tick) and clears any
//                   siege target before the core could strike with it. They then move by their
//                   own rules: the goblin raids a store and flees along the trail it walked in;
//                   the wyvern flies straight over everything and swoops on buildings. The core
//                   still ticks their timers (cd, hitT, atkT, slowT), so slows, freezes and hit
//                   flashes from other systems apply to them as to any foe.
//   riftspawner     Core AI, plus Husk births every few seconds at night (capped).
//   bogwitch        Core AI (it already strikes from range); BUS.dmgMult adds the curse, and a
//                   'foeHex' event draws the bolt on the tick she strikes.
//   frostwraith     Core AI; on the tick it strikes (atkT is set to 0.2) its target is chilled.
//   ashimp          Core AI; BUS.kill makes it burst. Takes half damage from fire.
//
// Region state (plain JSON): s.ext.foes = { v, seen: [types announced], chill: [friendly ids],
//   stolen: {k: n}, recovered: {k: n}, lost: {k: n}, warnN }
// Per-mover fields (plain): fz (state), fzT (timer), ft (target building id), trail (tile ids),
//   tl (last tile), loot {k, a}, made, fsrc (spawner id on its Husks), wr (wyvern rest),
//   lastB, hits, z, flying, fzS (last strike tick); friendlies: chillT (time the chill ends).
// Cache (not saved): s.rt.foes = { at, witches } living Bog Witches, rebuilt on first use each tick.
import { BUS } from '../hooks.js';
import { ENEMIES } from '../../data/enemies.js';
import { BUILDINGS } from '../../data/buildings.js';
import { FOES, FOE_RULES as R, FOE_ROSTER, ACT_BIOME } from '../../data/enemies-p4.js';
import { T, N, idx, tileOf, ctr, distToRect, WORLD } from '../grid.js';
import { emit, getE, getB, hurt, hurtBuilding, spawnEnemy, flowRes } from './common.js';
import { MOVE, stepToward } from './movement.js';
import { solidForEnemy } from './pathing.js';
import * as ART from '../../engine/foeart.js';

export const FOE_TYPES = Object.keys(FOES);
const RES = ['gold', 'food', 'wood', 'stone'];
const EDGE_SIDES = { N: 1, S: 1, E: 1, W: 1 };
const FRIEND = { soldier: 1, hero: 1, sovereign: 1 };

// ---- State -------------------------------------------------------------------------------------
/** Region state for this module (plain JSON in s.ext.foes). */
export function foesOf(s) {
  const ext = s.ext || (s.ext = {});
  let X = ext.foes;
  if (!X) X = ext.foes = { v: 1, seen: [], chill: [], stolen: {}, recovered: {}, lost: {}, warnN: -1 };
  return X;
}
/** Living Bog Witches this tick (rebuilt on first use each tick, so a fresh load matches). */
function witchesOf(s) {
  const rt = s.rt.foes || (s.rt.foes = { at: -1, witches: [] });
  if (rt.at !== s.tick) {
    rt.at = s.tick;
    const W = rt.witches;
    W.length = 0;
    for (const e of s.enemies) if (e.alive && e.type === 'bogwitch') W.push(e);
  }
  return rt.witches;
}
const addTo = (o, k, a) => { o[k] = (o[k] || 0) + a; };

function heldFast(e) { return e.slowT > 0 && (e.slowAmt || 0) >= 0.99; }
function speedOf(e, d) { return d.speed * (e.speedMult || 1) * (e.slowT > 0 ? 1 - Math.min(1, e.slowAmt || 0.4) : 1); }
function tileIndex(x, y) { return idx(Math.max(0, Math.min(N - 1, tileOf(x))), Math.max(0, Math.min(N - 1, tileOf(y)))); }
const bcx = (b) => (b.tx + b.size / 2) * T;
const bcy = (b) => (b.ty + b.size / 2) * T;

/** Strike a building with this foe's own blow (goblin hacking a wall, wyvern claws). */
function strikeBuilding(s, e, d, b) {
  e.cd = d.rate; e.atkT = 0.2;
  hurtBuilding(s, b, d.dmg * (e.dmgMult || 1), d.dmgType);
  b.lastHit = s.time;
  const cx = bcx(b);
  if (Math.abs(cx - e.x) > 2) e.face = cx < e.x ? -1 : 1;
  emit(s, { t: 'sfx', k: 'thud', x: e.x, y: e.y });
}
/** If the tile e.blockTile is a building, hack at it (cooldown permitting). */
function hackBlocker(s, e, d) {
  if (e.blockTile < 0) return false;
  const b = getB(s, s.occ[e.blockTile]);
  if (!b) return false;
  if (e.cd <= 0) strikeBuilding(s, e, d, b);
  return true;
}

// ---- Goblin Raider -----------------------------------------------------------------------------
function storeKind(type) { return R.goblin.stores[type]; }

/** Nearest built store (Hearth, Granary, Windmill, Market, House) to a point. */
export function nearestStore(s, x, y) {
  let best = null, bd = 1e18;
  for (const b of s.buildings) {
    if (!b.alive || !b.built || !storeKind(b.type)) continue;
    const d = distToRect(x, y, b);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

/** What a raider takes from this store: { k, a } (a may be 0 when the store is bare). */
export function lootFor(s, b) {
  const G = R.goblin;
  let k = storeKind(b.type);
  if (k === 'any' || !(s.res[k] >= 1)) {
    // The Hearth (or a bare store): the richest stock, gold counted double.
    let best = 'gold', bv = -1;
    for (const r of RES) { const v = (s.res[r] || 0) * (r === 'gold' ? 2 : 1); if (v > bv) { bv = v; best = r; } }
    k = best;
  }
  const [base, per] = G.steal[k];
  const want = Math.round(base + per * (s.cycle.night || 0));
  return { k, a: Math.max(0, Math.min(Math.floor(s.res[k] || 0), want)) };
}

function trailPush(e) {
  const ti = tileIndex(e.x, e.y);
  if (ti === e.tl) return;
  e.tl = ti;
  const tr = e.trail;
  const j = tr.lastIndexOf(ti);
  if (j >= 0) tr.length = j + 1; // walked in a loop: cut it out
  else { tr.push(ti); if (tr.length > R.goblin.trailMax) tr.shift(); }
}

function goblinTick(s, e, dt, X) {
  const d = ENEMIES.goblin, G = R.goblin;
  e.x = e.px; e.y = e.py; e.siege = 0; // the raider keeps its own route (see the header)
  if (!e.fz) { e.fz = 'raid'; e.fzT = 0; e.ft = 0; e.loot = null; e.trail = [tileIndex(e.x, e.y)]; e.tl = e.trail[0]; }
  if (heldFast(e)) return;
  const sp = speedOf(e, d);
  if (e.fz === 'raid') {
    e.fzT -= dt;
    let b = getB(s, e.ft);
    if (!b || e.fzT <= 0) { b = nearestStore(s, e.x, e.y); e.ft = b ? b.id : 0; e.fzT = 1; }
    if (!b) { e.fz = 'flee'; return; }
    if (distToRect(e.x, e.y, b) <= G.reach * T + e.r) { e.fz = 'steal'; e.fzT = G.stealTime; e.atkT = 0.2; return; }
    let moved = false;
    if (distToRect(e.x, e.y, b) <= G.direct * T) moved = stepToward(s, e, bcx(b), bcy(b), sp, dt, 'enemy') !== MOVE.BLOCKED;
    if (!moved) {
      const ti = tileIndex(e.x, e.y);
      const n = s.rt.fieldN.next[ti];
      if (n < 0) {
        const h = s.rt.hearth;
        if (h && stepToward(s, e, bcx(h), bcy(h), sp, dt, 'enemy') === MOVE.BLOCKED) hackBlocker(s, e, d);
      } else if (s.occ[n] && solidForEnemy(s, n, false)) {
        const ob = getB(s, s.occ[n]);
        if (ob && storeKind(ob.type) && ob.built) { e.ft = ob.id; e.fzT = 1; } // a store in the way: rob it
        else if (ob && e.cd <= 0) strikeBuilding(s, e, d, ob);
      } else if (stepToward(s, e, ctr(n % N) + e.jx * 0.5, ctr((n / N) | 0) + e.jy * 0.5, sp, dt, 'enemy') === MOVE.BLOCKED) hackBlocker(s, e, d);
    }
    trailPush(e);
    return;
  }
  if (e.fz === 'steal') {
    const b = getB(s, e.ft);
    if (!b) { e.fz = 'raid'; e.fzT = 0; return; }
    e.fzT -= dt;
    if (((e.fzT * 6) | 0) % 2 === 0) e.atkT = Math.max(e.atkT, 0.1); // rummaging
    if (e.fzT > 0) return;
    const L = lootFor(s, b);
    e.loot = L.a > 0 ? L : null;
    e.fz = 'flee';
    if (L.a > 0) {
      flowRes(s, L.k, -L.a);
      addTo(X.stolen, L.k, L.a);
      emit(s, { t: 'foeSteal', x: e.x, y: e.y - 14, k: L.k, a: L.a });
      emit(s, { t: 'sfx', k: 'coin', x: e.x, y: e.y });
      if (X.warnN !== s.cycle.night) {
        X.warnN = s.cycle.night;
        const nm = BUILDINGS[b.type] ? BUILDINGS[b.type].name : 'store';
        emit(s, { t: 'toast', text: `A Goblin Raider robs your ${nm} of ${L.a} ${L.k}! Catch it before it reaches the map edge.`, tone: 'bad', icon: L.k });
      }
    }
    return;
  }
  // Flee: back along the trail it came in by, then out over the map edge.
  const fsp = sp * (e.loot ? G.burdened : 1);
  const m = 10;
  if (e.x <= m || e.y <= m || e.x >= WORLD - m || e.y >= WORLD - m) { goblinEscapes(s, e, X); return; }
  const tr = e.trail;
  if (tr && tr.length) {
    const ti = tr[tr.length - 1];
    const gx = ctr(ti % N), gy = ctr((ti / N) | 0);
    if (Math.hypot(gx - e.x, gy - e.y) < 8) { tr.pop(); return; }
    if (stepToward(s, e, gx, gy, fsp, dt, 'enemy') === MOVE.BLOCKED && !hackBlocker(s, e, d) && e.stuck > 1.2) { tr.pop(); e.stuck = 0; }
    return;
  }
  // Trail walked: run for the nearest edge.
  const dl = e.x, dr = WORLD - e.x, du = e.y, dd = WORLD - e.y;
  const mn = Math.min(dl, dr, du, dd);
  const gx = mn === dl ? 0 : mn === dr ? WORLD : e.x, gy = mn === du ? 0 : mn === dd ? WORLD : e.y;
  if (stepToward(s, e, gx, gy, fsp, dt, 'enemy') === MOVE.BLOCKED) hackBlocker(s, e, d);
}

function goblinEscapes(s, e, X) {
  e.alive = false; // gone over the edge: not a kill
  const L = e.loot;
  e.loot = null;
  emit(s, { t: 'foeEscape', x: e.x, y: e.y });
  if (L && L.a > 0) {
    addTo(X.lost, L.k, L.a);
    emit(s, { t: 'toast', text: `A Goblin Raider escaped with ${L.a} ${L.k}.`, tone: 'bad', icon: L.k });
  }
}

/** Loot returned when a raider is slain with a full sack: { k, a } or null. */
export function goblinDrop(L) {
  if (!L || !(L.a > 0)) return null;
  const G = R.goblin;
  return { k: L.k, a: L.a + Math.max(G.minBonus, Math.round(L.a * G.bonus)) };
}

// ---- Riftspawner ---------------------------------------------------------------------------------
function riftspawnerTick(s, e, dt) {
  const RS = R.riftspawner;
  if (!e.fz) { e.fz = 'walk'; e.fzT = RS.first; e.made = 0; e.scale = (e.scale || 1) * (FOES.riftspawner.drawScale || 1); }
  if (s.cycle.phase !== 'night' || heldFast(e)) return; // the tear stays shut in daylight
  e.fzT -= dt;
  if (e.fzT > 0) return;
  e.fzT = RS.every;
  if (e.made >= RS.lifeCap) return;
  let alive = 0;
  for (const o of s.enemies) if (o.alive && o.fsrc === e.id) alive++;
  const k = Math.min(RS.brood, RS.aliveCap - alive, RS.lifeCap - e.made);
  for (let i = 0; i < k; i++) {
    const a = (e.made + i) * 2.4 + e.id;
    let x = e.x + Math.cos(a) * 16, y = e.y + Math.sin(a) * 11;
    const ti = tileIndex(x, y);
    if (solidForEnemy(s, ti, false)) { x = e.x; y = e.y; }
    const h = spawnEnemy(s, 'husk', x, y, null);
    h.fsrc = e.id;
    e.made++;
  }
  if (k > 0) {
    e.birthT = s.time;
    emit(s, { t: 'foeBirth', x: e.x, y: e.y - 16, n: k });
    emit(s, { t: 'sfx', k: 'spawn', x: e.x, y: e.y });
  }
}

// ---- Ash Wyvern ------------------------------------------------------------------------------------
function swoopTarget(s, e) {
  const W = R.wyvern;
  const h = s.rt.hearth;
  if (!h) return null;
  if (e.wr > 0) return h;
  const hx = bcx(h), hy = bcy(h);
  const myD = Math.hypot(e.x - hx, e.y - hy);
  let best = null, bd = W.look * T;
  for (const b of s.buildings) {
    if (!b.alive || !b.built || b.type === 'hearth' || b.id === e.lastB) continue;
    const def = BUILDINGS[b.type];
    if (!def || def.isWall || def.walkable) continue;
    const d = distToRect(e.x, e.y, b);
    if (d >= bd) continue;
    if (Math.hypot(bcx(b) - hx, bcy(b) - hy) > myD + T) continue; // only what lies ahead
    bd = d; best = b;
  }
  return best || h;
}

function wyvernTick(s, e, dt) {
  const d = ENEMIES.wyvern, W = R.wyvern;
  e.x = e.px; e.y = e.py; e.siege = 0; // it flies: the ground field means nothing to it
  if (!e.fz) { e.fz = 'fly'; e.z = W.cruise; e.ft = 0; e.fzT = 0; e.wr = 0; e.lastB = 0; e.hits = 0; e.scale = (e.scale || 1) * (FOES.wyvern.drawScale || 1); }
  if (!heldFast(e)) {
    let b = getB(s, e.ft);
    switch (e.fz) {
      case 'fly': {
        e.wr = Math.max(0, (e.wr || 0) - dt);
        e.fzT -= dt;
        if (!b || e.fzT <= 0) { b = swoopTarget(s, e); e.ft = b ? b.id : 0; e.fzT = 0.8; }
        if (!b) break;
        const reach = W.reach * T + e.r * 0.5;
        if (distToRect(e.x, e.y, b) <= reach) {
          if (e.wr <= 0) { e.fz = 'dive'; e.fzT = W.dive; }
          break;
        }
        const gx = bcx(b), gy = bcy(b);
        const dx = gx - e.x, dy = gy - e.y, l = Math.hypot(dx, dy) || 1;
        const step = Math.min(l, speedOf(e, d) * T * dt);
        e.x += (dx / l) * step; e.y += (dy / l) * step;
        if (Math.abs(dx) > 0.5) e.face = dx < 0 ? -1 : 1;
        e.anim += step * 0.25;
        break;
      }
      case 'dive':
        e.fzT -= dt;
        e.z = 3 + (W.cruise - 3) * Math.max(0, e.fzT / W.dive);
        if (b) { const cx = bcx(b); if (Math.abs(cx - e.x) > 2) e.face = cx < e.x ? -1 : 1; }
        if (e.fzT <= 0) { e.fz = 'strike'; e.z = 3; e.hits = 0; if (e.cd > 0.25) e.cd = 0.25; }
        break;
      case 'strike':
        if (!b || e.hits >= W.strikes) { e.fz = 'climb'; e.fzT = W.climb; e.lastB = e.ft; break; }
        if (e.cd <= 0) { strikeBuilding(s, e, d, b); e.hits++; }
        break;
      case 'climb':
        e.fzT -= dt;
        e.z = W.cruise - (W.cruise - 3) * Math.max(0, e.fzT / W.climb);
        if (e.fzT <= 0) { e.fz = 'fly'; e.z = W.cruise; e.wr = W.rest; e.ft = 0; e.fzT = 0; }
        break;
    }
  }
  if (e.x < 2) e.x = 2; else if (e.x > WORLD - 2) e.x = WORLD - 2;
  if (e.y < 2) e.y = 2; else if (e.y > WORLD - 2) e.y = WORLD - 2;
  e.flying = e.z > W.low;
}

// ---- Bog Witch, Frost Wraith -------------------------------------------------------------------------
function strikeTarget(s, e, d) {
  const t = getE(s, e.targetId);
  if (t && Math.hypot(t.x - e.x, t.y - e.y) <= (d.range + 1) * T + t.r) return t;
  return null;
}
function bogwitchTick(s, e) {
  if (!(e.atkT > 0.199) || e.fzS === s.tick) return;
  e.fzS = s.tick;
  const d = ENEMIES.bogwitch;
  const t = strikeTarget(s, e, d);
  const b = t ? null : getB(s, e.siege);
  if (t) emit(s, { t: 'foeHex', x: e.x, y: e.y - 20, tx: t.x, ty: t.y - 10 });
  else if (b) emit(s, { t: 'foeHex', x: e.x, y: e.y - 20, tx: bcx(b), ty: bcy(b) - 10 });
}
function frostwraithTick(s, e, dt, X) {
  if (!(e.atkT > 0.199) || e.fzS === s.tick) return;
  e.fzS = s.tick;
  const t = strikeTarget(s, e, ENEMIES.frostwraith);
  if (t && t.kind !== 'enemy') chill(s, X, t);
}
/** Chill a friendly mover: slower steps and slower blows for FOE_RULES.frostwraith.time seconds. */
export function chill(s, X, t) {
  if (!(t.chillT > s.time)) X.chill.push(t.id);
  t.chillT = s.time + R.frostwraith.time;
  emit(s, { t: 'foeChill', x: t.x, y: t.y - 10 });
}
function chillTick(s, X, dt) {
  const F = R.frostwraith;
  const L = X.chill;
  for (let k = L.length - 1; k >= 0; k--) {
    const u = getE(s, L[k]);
    if (!u || !(u.chillT > s.time)) { if (u) u.chillT = 0; L.splice(k, 1); continue; }
    // Lose part of this tick's movement, and part of this tick's attack recovery.
    u.x = u.px + (u.x - u.px) * (1 - F.slow);
    u.y = u.py + (u.y - u.py) * (1 - F.slow);
    if (typeof u.cd === 'number') u.cd += dt * F.rate;
  }
}

// ---- Ash Imp ------------------------------------------------------------------------------------------
let blastS = null, blastSrc = null, blastHits = 0;
function blastOne(f) {
  if (f.kind === 'enemy') return false;
  hurt(blastS, f, R.ashimp.dmg, 'fire', null, blastSrc.x, blastSrc.y, blastSrc);
  blastHits++;
  return false;
}
/** The Ash Imp bursts: fire damage to every friendly mover and building within FOE_RULES.ashimp.blast tiles. */
export function impBurst(s, v) {
  const A = R.ashimp;
  const r = A.blast * T;
  blastS = s; blastSrc = v; blastHits = 0;
  s.rt.friendHash.each(v.x, v.y, r, blastOne);
  const hit = [];
  for (const b of s.buildings) if (b.alive && distToRect(v.x, v.y, b) <= r) hit.push(b);
  for (const b of hit) { hurtBuilding(s, b, A.bDmg, 'fire'); b.lastHit = s.time; blastHits++; }
  blastS = null; blastSrc = null;
  emit(s, { t: 'foeBlast', x: v.x, y: v.y - 6, r });
  emit(s, { t: 'sfx', k: 'impact', x: v.x, y: v.y });
  return blastHits;
}

// ---- Bus handlers --------------------------------------------------------------------------------------
const TICK = { goblin: goblinTick, riftspawner: riftspawnerTick, wyvern: wyvernTick, bogwitch: bogwitchTick, frostwraith: frostwraithTick };

function onTick(s, dt) {
  const X = foesOf(s);
  const list = s.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    const f = TICK[e.type];
    if (f) f(s, e, dt, X);
  }
  if (X.chill.length) chillTick(s, X, dt);
}

function onKill(s, v) {
  if (v.kind !== 'enemy') return;
  if (v.type === 'ashimp') { impBurst(s, v); return; }
  if (v.type === 'goblin' && v.loot) {
    const back = goblinDrop(v.loot);
    v.loot = null;
    if (!back) return;
    const X = foesOf(s);
    flowRes(s, back.k, back.a);
    addTo(X.recovered, back.k, back.a);
    emit(s, { t: 'gain', x: v.x, y: v.y - 16, k: back.k, a: back.a });
    emit(s, { t: 'sfx', k: 'coin', x: v.x, y: v.y });
    emit(s, { t: 'toast', text: `Goblin Raider slain: ${back.a} ${back.k} recovered from its sack.`, tone: 'good', icon: back.k });
  }
}

function onPhase(s, phase) {
  const X = foesOf(s);
  if (phase === 'dawn') {
    // Raiders caught by the sunrise burn where they stand and drop their sacks (no bonus).
    const got = {};
    let any = false;
    for (const e of s.enemies) {
      if (e.type !== 'goblin' || e.alive || !e.loot || !(e.hp > 0)) continue;
      flowRes(s, e.loot.k, e.loot.a); addTo(X.recovered, e.loot.k, e.loot.a); addTo(got, e.loot.k, e.loot.a);
      e.loot = null; any = true;
    }
    if (any) emit(s, { t: 'toast', text: `The dawn caught the raiders: ${Object.entries(got).map(([k, a]) => `${a} ${k}`).join(', ')} recovered.`, tone: 'good', icon: 'sun' });
    return;
  }
  if (phase === 'dusk' && s.wave) {
    // First sight of a new foe this run: say what it does.
    const tonight = new Set();
    for (const g of s.wave.groups) for (const u of g.units) if (FOES[u[0]]) tonight.add(u[0]);
    for (const t of FOE_TYPES) {
      if (!tonight.has(t) || X.seen.includes(t)) continue;
      X.seen.push(t);
      emit(s, { t: 'toast', text: FOES[t].debut, tone: 'bad', icon: 'skull' });
    }
  }
}

function dmgMult(s, a, t, type) {
  let m = 1;
  if (t.kind === 'enemy') {
    if (type === 'pierce' && t.type === 'riftspawner') m *= R.riftspawner.pierce;
    else if (type === 'fire' && t.type === 'ashimp') m *= R.ashimp.fire;
    if (a && FRIEND[a.kind]) {
      const W = witchesOf(s);
      if (W.length) {
        const r2 = (R.bogwitch.radius * T) * (R.bogwitch.radius * T);
        for (let i = 0; i < W.length; i++) {
          const w = W[i];
          if (!w.alive) continue;
          const dx = w.x - a.x, dy = w.y - a.y;
          if (dx * dx + dy * dy <= r2) { m *= R.bogwitch.curse; break; }
        }
      }
    }
  }
  return m;
}

// ---- Tonight's roster --------------------------------------------------------------------------------
const byAct = (v, act) => (Array.isArray(v) ? v[Math.min(act, v.length) - 1] : v);
const payable = (u) => !u[1] && (u[0] === 'husk' || u[0] === 'hound');

/**
 * Swap plain Husks (then Gloom Hounds) of equal budget for k foes of `type` in group g.
 * ctx = { owed, emptied }: owed carries the rounding left by earlier swaps tonight, so the
 * night's total wave-budget cost stays within about one Husk of the rolled plan.
 */
export function addFoes(w, g, type, k, r, ctx) {
  const cost = ENEMIES[type].cost * k;
  const order = [g, ...w.groups.filter((x) => x !== g && x.sp && EDGE_SIDES[x.sp.side])];
  let avail = 0;
  for (const gr of order) for (const u of gr.units) if (payable(u)) avail += ENEMIES[u[0]].cost;
  // Keep some of the plain Hollow: a swap never takes more than ~85% of what is left.
  if (avail < cost * 1.15 || avail < cost + 1) return false;
  ctx.owed += cost;
  for (const kind of ['husk', 'hound']) for (const gr of order) {
    for (let j = gr.units.length - 1; j >= 0 && ctx.owed > 0.5; j--) {
      const u = gr.units[j];
      if (u[0] === kind && !u[1]) { gr.units.splice(j, 1); ctx.owed -= ENEMIES[kind].cost; if (!gr.units.length) ctx.emptied.add(gr); }
    }
  }
  for (let i = 0; i < k; i++) g.units.splice(r.int(0, g.units.length), 0, [type, null]);
  ctx.emptied.delete(g);
  return true;
}

/** Add a rule's band to group g, shrinking it (by whole packs) when the night cannot pay for all of it. */
function tryAdd(w, g, L, n, act, r, ctx) {
  const type = L.rule.type;
  const step = type === 'ashimp' ? R.ashimp.pack : 1;
  for (let k = L.rule.count(n, act); k >= step; k -= step) if (addFoes(w, g, type, k, r, ctx)) return true;
  return false;
}

/** BUS.wavePlan: join the Phase 4 foes to tonight's plan by night, act, biome and season. */
export function planFoes(s, w) {
  const groups = w.groups.filter((g) => g.sp && EDGE_SIDES[g.sp.side] && !g.rift && !g.battlefield && g.units.length);
  if (!groups.length) return;
  const r = s.rt.rng;
  const n = w.n, act = s.act || 1;
  let biome = s.biome, bmul = 1;
  if (biome === 'ruins') { biome = ACT_BIOME[Math.min(3, act)]; bmul = 0.5; }
  const season = BUS.query.season ? BUS.query.season(s) : 'summer';
  const ctx = { owed: 0, emptied: new Set() };
  // Rules that may join tonight, in roster order (biome and season foes first).
  const live = [];
  for (const rule of FOE_ROSTER) {
    const from = byAct(rule.from, act);
    if (n < from || (rule.minAct && act < rule.minAct)) continue;
    let mul = 1;
    if (rule.biomes) { const m = rule.biomes[biome]; if (!m) continue; mul = m * bmul; }
    if (rule.season && season !== rule.season) continue;
    live.push({ rule, from, p: rule.chance * mul, cap: rule.perNight == null ? 99 : byAct(rule.perNight, act), got: 0 });
  }
  // Debut: the first night a foe may come, one front brings it, until the run has met it
  // (rare guests excepted). The dusk toast then explains it once.
  const seen = foesOf(s).seen;
  for (const L of live) {
    if (L.rule.rare || n !== L.from || seen.includes(L.rule.type)) continue;
    for (const g of groups) if (tryAdd(w, g, L, n, act, r, ctx)) { L.got++; break; }
  }
  // Then each front rolls each rule in turn, so one kind of foe cannot eat the whole night.
  for (const g of groups) for (const L of live) {
    if (L.got < L.cap && r.chance(L.p) && tryAdd(w, g, L, n, act, r, ctx)) L.got++;
  }
  if (ctx.emptied.size) w.groups = w.groups.filter((g) => !ctx.emptied.has(g));
}

// ---- Registration ---------------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  for (const [id, def] of Object.entries(FOES)) ENEMIES[id] = { ...def };
  BUS.regionInit.push((s, ctx) => {
    const X = foesOf(s);
    const run = ctx && ctx.run;
    const seen = run && run.ext && run.ext.foesSeen;
    if (Array.isArray(seen)) for (const t of seen) if (!X.seen.includes(t)) X.seen.push(t);
  });
  BUS.runRegionEnd.push((run, s) => {
    const X = s.ext && s.ext.foes;
    if (!X) return;
    const ext = run.ext || (run.ext = {});
    const seen = ext.foesSeen || (ext.foesSeen = []);
    for (const t of X.seen) if (!seen.includes(t)) seen.push(t);
  });
  BUS.wavePlan.push(planFoes);
  BUS.tick.push(onTick);
  BUS.kill.push(onKill);
  BUS.phase.push(onPhase);
  BUS.dmgMult.push(dmgMult);
  ART.register();
}
