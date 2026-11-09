// Phase 2 structures: Market income, Granary bonuses, Spike Traps, Ballistae
// and Mage Spires. Runs every tick after the core building pass.
import { EXTRA_BUILDINGS } from '../../data/buildings-ext.js';
import { T } from '../grid.js';
import { hurt, hurtBuilding, emit, flowRes } from './common.js';
import { spawnProjectile } from './combat.js';

const STAT = (type, level) => EXTRA_BUILDINGS[type].levels[Math.min(level, EXTRA_BUILDINGS[type].levels.length - 1)];
const TRAP_PULSE = 0.5;      // seconds between spike hits
const SLOW_HOLD = 0.7;       // seconds the slow lingers after leaving a trap
const CHAIN_FALLOFF = 0.75;  // each arcane jump deals this share of the previous
const UPKEEP_CAP = 0.3;
const MARKET_RECALC = 20;    // ticks between Market house counts

export function isWalkable(type) { return type === 'trap'; }

export function updateStructures(s, dt) {
  const recalc = s.tick % MARKET_RECALC === 0;
  // Backwards: a trap that wears out removes itself from the list mid-loop.
  for (let i = s.buildings.length - 1; i >= 0; i--) {
    const b = s.buildings[i];
    if (!b.built || !b.alive) continue;
    switch (b.type) {
      case 'market': market(s, b, dt, recalc); break;
      case 'trap': trap(s, b, dt); break;
      case 'ballista': case 'spire': shooter(s, b, dt); break;
    }
  }
}

// ---- Market --------------------------------------------------------------------
// Gold per minute = base + perHouse x built Houses whose centre is in range.
export function marketRate(s, b) {
  const st = STAT('market', b.level);
  const cx = (b.tx + 1) * T, cy = (b.ty + 1) * T, r2 = (st.radius * T) ** 2;
  let n = 0;
  for (const o of s.buildings) {
    if (o.type !== 'house' || !o.built || !o.alive) continue;
    const dx = (o.tx + 0.5) * T - cx, dy = (o.ty + 0.5) * T - cy;
    if (dx * dx + dy * dy <= r2) n++;
  }
  return (st.goldBase + st.goldPerHouse * n) * (1 + (s.mods.goldMult || 0));
}
function market(s, b, dt, recalc) {
  if (recalc || b.goldRate === undefined) b.goldRate = marketRate(s, b);
  flowRes(s, 'gold', (b.goldRate / 60) * dt);
}

// ---- Spike Trap ------------------------------------------------------------------
let trapS = null, trapSt = null, trapX0 = 0, trapY0 = 0, trapHits = 0;
function trapHit(e) {
  if (e.boss || e.stationary) return false;
  const m = e.r * 0.5;
  if (e.x < trapX0 - m || e.x > trapX0 + T + m || e.y < trapY0 - m || e.y > trapY0 + T + m) return false;
  hurt(trapS, e, trapSt.dps * TRAP_PULSE, 'pierce', null);
  if (e.alive) {
    e.slowAmt = e.slowT > 0 ? Math.max(e.slowAmt || 0, trapSt.slow) : trapSt.slow;
    e.slowT = Math.max(e.slowT || 0, SLOW_HOLD);
  }
  trapHits++;
  return false;
}
function trap(s, b, dt) {
  b.cd -= dt;
  if (b.cd > 0) return;
  b.cd = TRAP_PULSE;
  trapS = s; trapSt = STAT('trap', b.level); trapX0 = b.tx * T; trapY0 = b.ty * T; trapHits = 0;
  s.rt.enemyHash.each(trapX0 + T / 2, trapY0 + T / 2, T, trapHit);
  if (trapHits) {
    emit(s, { t: 'sfx', k: 'thud', x: trapX0 + T / 2, y: trapY0 + T / 2 });
    b.lastHit = s.time;
    hurtBuilding(s, b, trapSt.wear * trapHits, 'pierce');
  }
  trapS = trapSt = null;
}

// ---- Ballista and Mage Spire -------------------------------------------------------
// Own cooldown field (scd) so the core tower loop never shares a timer with it.
function shooter(s, b, dt) {
  // Park the core tower timer so updateBuildings never also fires arrows from
  // this building, even before it learns to skip `selfFire` defs.
  b.cd = 1e6;
  b.scd = (b.scd || 0) - dt;
  if (b.scd > 0) return;
  const a = STAT(b.type, b.level).attack;
  const ballista = b.type === 'ballista';
  const cx = (b.tx + 0.5) * T, cy = (b.ty + 0.5) * T;
  const range = (a.range + (ballista ? s.mods.towerRange || 0 : 0)) * T;
  const t = s.rt.enemyHash.nearest(cx, cy, range);
  if (!t) { b.scd = 0.25; return; }
  b.scd = a.rate;
  if (ballista) {
    const dmg = a.dmg * (1 + (s.mods.towerDmg || 0) + (s.mods.rangedDmg || 0));
    spawnProjectile(s, 'ballista', cx, cy - 30, t, dmg, a.type, a.bonus, 17, 0.25);
    emit(s, { t: 'sfx', k: 'bow', x: cx, y: cy });
  } else {
    const dmg = a.dmg * (1 + (s.mods.towerDmg || 0));
    const p = spawnProjectile(s, 'arcane', cx, cy - 44 - b.level * 4, t, dmg, a.type, null, 10, 0.12);
    p.chain = a.chain; p.chainR = a.chainRange * T;
    emit(s, { t: 'sfx', k: 'bolt', x: cx, y: cy });
  }
}

// Called by the projectile system when an 'arcane' bolt lands on `target`.
const chainHit = [0, 0, 0, 0, 0, 0, 0, 0];
let chainN = 0;
function notHit(e) {
  if (e.kind !== 'enemy') return false;
  for (let i = 0; i < chainN; i++) if (chainHit[i] === e.id) return false;
  return true;
}
export function onArcaneHit(s, p, target) {
  const jumps = Math.min(p.chain || 0, chainHit.length - 1);
  if (!jumps) return;
  const r = p.chainR || 2.5 * T;
  chainN = 1; chainHit[0] = target.id;
  let from = target, dmg = p.dmg;
  for (let j = 0; j < jumps; j++) {
    const e = s.rt.enemyHash.nearest(from.x, from.y, r, notHit);
    if (!e) break;
    dmg *= CHAIN_FALLOFF;
    chainHit[chainN++] = e.id;
    emit(s, { t: 'arcane', x1: from.x, y1: from.y, x2: e.x, y2: e.y });
    hurt(s, e, dmg, p.type || 'magic', null, from.x, from.y);
    from = e;
  }
  chainN = 0;
}

// ---- Granary -----------------------------------------------------------------------
// Best Granary bonus covering this farm's centre (they do not stack).
export function farmBonus(s, farm) {
  const fx = (farm.tx + farm.size / 2) * T, fy = (farm.ty + farm.size / 2) * T;
  let best = 0;
  for (const b of s.buildings) {
    if (b.type !== 'granary' || !b.built || !b.alive) continue;
    const st = STAT('granary', b.level);
    const dx = (b.tx + 1) * T - fx, dy = (b.ty + 1) * T - fy, r = st.radius * T;
    if (dx * dx + dy * dy <= r * r && st.farmBonus > best) best = st.farmBonus;
  }
  return best;
}

// Food upkeep reduction: each built Granary adds its cut once, capped at 30%.
export function upkeepCut(s) {
  let cut = 0;
  for (const b of s.buildings) if (b.type === 'granary' && b.built && b.alive) cut += STAT('granary', b.level).upkeepCut;
  return Math.min(UPKEEP_CAP, cut);
}
