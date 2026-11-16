// Wave planning. The next night's attack is rolled at the start of each day and revealed in
// full at dusk: direction, route, size and enemy types. Nothing spawns that was not
// telegraphed (the Riftspawner's brood is counted in the forecast too).
//
// Pacing (EMBERCROWN-REWORK.md, stream D): every region plays 3 escalating nights and the
// last one is the Long Night, the hardest wave of the region, led by an elite Warden. The
// budget grows with one global depth index (RUN.depth), so nothing resets at an act boundary.
// Each front arrives as 1-3 dense pulses a few seconds after nightfall.
//
// Plain JSON on s.wave = { n, long, blood (legacy alias of long), pos: 'n1'|'n2'|'long', depth,
//   ne (effective night for unlocks), groups: [{ sp, units: [[type, affix]], counts, brood?,
//   warden?, route? }], total, note, mods }
import { BAL, RUN } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { FOE_RULES } from '../../data/enemies-p4.js';
import { BUILDINGS } from '../../data/buildings.js';
import { ctr, N, T, idx, distToRect } from '../grid.js';
import { rng, spawnEnemy, emit } from './common.js';
import { createField, buildFlowField } from './pathing.js';
import { HOOKS, BUS, each } from '../hooks.js';

const POS_I = { n1: 0, n2: 1, long: 2 };

// ---- Night structure ------------------------------------------------------------------------
/** Nights the region is built around: a survive/rift objective's `nights`, else none (every 3rd). */
function regionLen(s) {
  const o = s && s.objective;
  if (!o || o.type === 'endless' || o.type === 'boss') return 0;
  return typeof o.nights === 'number' && o.nights > 0 ? o.nights : 0;
}

/** Is night n a Long Night? The region's last night, then every 3rd night after it (bonus
 *  nights); in Endless and regions without a fixed length, every 3rd night. Boss regions have
 *  none: the boss is the climax. */
export function isLongNight(n, s) {
  if (!(n > 0)) return false;
  const every = BAL.waves.longEvery;
  if (s && s.objective && s.objective.type === 'boss') return false;
  const L = regionLen(s);
  if (L) {
    if (n === L) return true;
    if (n > L) return (n - L) % every === 0;
    return n % every === 0 && n < L - 1;
  }
  return n % every === 0;
}
/** Legacy name (the HUD moon counts down to the next Long Night). */
export const isBloodMoon = isLongNight;

/** Global depth of the region: (act - 1) * (stepsPerAct + 1) + step. Endless counts its own. */
export function baseDepth(s) {
  const step = Math.max(0, (s && s.step) | 0);
  if (s && s.objective && s.objective.type === 'endless') return step;
  return Math.max(0, ((s && s.act) || 1) - 1) * (RUN.stepsPerAct + 1) + step;
}

/** Where night n sits in the region's escalation: { n, pos, long, depth, ne }. */
export function nightInfo(s, n) {
  const long = isLongNight(n, s);
  let prev = 0, held = 0;
  for (let m = 1; m < n; m++) if (isLongNight(m, s)) { prev = m; held++; }
  const pos = long ? 'long' : (n - prev <= 1 ? 'n1' : 'n2');
  const depth = baseDepth(s) + held;
  // New foe types arrive every second depth step, so a region's roster is familiar before it grows.
  return { n, pos, long, depth, ne: POS_I[pos] + 1 + Math.floor(depth * BAL.waves.unlockPerDepth) };
}

/** Has the region's Long Night been held (the Beacon's precondition)? */
export function longNightHeld(s) {
  const o = s.objective;
  if (o && o.held) return true;
  const L = regionLen(s) || BAL.waves.longEvery;
  return (s.cycle.night || 0) >= L;
}

// ---- Planning -----------------------------------------------------------------------------------
export function planNight(s) {
  const W = BAL.waves;
  const r = rng(s);
  const n = s.cycle.night + 1;
  const info = nightInfo(s, n);
  const { pos, long, depth, ne } = info;
  const diff = BAL.difficulty[s.difficulty] || BAL.difficulty.standard;
  const B = W.budget[pos];
  // A live Hollow Rift sends its own band (objectives.js); the fronts make room for it.
  const rift = s.objective && s.objective.type === 'rift' && !s.objective.done && s.objective.riftId ? W.riftShare : 0;
  const budget = (B[0] + B[1] * depth) * (1 - rift) * diff.waveMult * Math.max(0.1, 1 + (s.mods.waveMult || 0)) * (n === 1 && s.raiders ? 1.3 : 1);
  const F = depth >= W.fronts.lateFromDepth ? W.fronts.late : W.fronts.early;
  let groupsN = Math.max(1, F[POS_I[pos]] - (rift ? 1 : 0)); // the Rift is a front of its own

  // Prefer distinct sides so the player learns to read directions.
  const pool = r.shuffle(s.spawns.filter((sp) => sp.ok !== false));
  if (!pool.length) pool.push(...s.spawns);
  const chosen = [];
  const sides = new Set();
  for (const sp of pool) if (chosen.length < groupsN && !sides.has(sp.side)) { chosen.push(sp); sides.add(sp.side); }
  for (const sp of pool) if (chosen.length < groupsN && !chosen.includes(sp)) chosen.push(sp);
  groupsN = chosen.length;

  const weights = chosen.map(() => r.float(0.8, 1.2));
  const wsum = weights.reduce((a, b) => a + b, 0);
  // Bosses and stationary structures (the Rift) are never rolled into waves. Rosters come from
  // data: BAL.waves.unlockNight for the core four, or an enemy's own `unlockNight` (and optional
  // `waveWeight(k)`) for plug-in foes. Unlocks read the effective night (region night + depth).
  const unlockOf = (t) => (t in W.unlockNight ? W.unlockNight[t] : ENEMIES[t].unlockNight);
  const types = Object.keys(ENEMIES).filter((t) => !ENEMIES[t].boss && !ENEMIES[t].stationary && !ENEMIES[t].noWave && unlockOf(t) != null && unlockOf(t) <= ne);
  const k = ne - 1;
  const baseWeight = { husk: 6, hound: 3 + k * 0.2, shade: 2 + k * 0.25, knight: 0.8 + k * 0.25 };
  const typeWeight = {};
  for (const t of types) typeWeight[t] = baseWeight[t] ?? (ENEMIES[t].waveWeight ? ENEMIES[t].waveWeight(k) : 1);

  const groups = chosen.map((sp, gi) => {
    let left = (budget * weights[gi]) / wsum;
    const units = [];
    // First night of a new type: guarantee one so its debut is never a surprise later.
    for (const t of types) if (unlockOf(t) === ne && gi === 0) { units.push([t, null]); left -= ENEMIES[t].cost; }
    let guard = 0;
    while (left >= 0.99 && guard++ < 300) {
      let t = r.weighted(types, (x) => (ENEMIES[x].cost <= left + 0.3 ? typeWeight[x] : 0));
      if (!t || ENEMIES[t].cost > left + 0.3) t = 'husk';
      let affix = null;
      if (ne >= W.eliteFromNight && t === 'hound' && r.chance(0.3)) affix = 'swift';
      units.push([t, affix]);
      left -= ENEMIES[t].cost;
    }
    return { sp: { tx: sp.tx, ty: sp.ty, side: sp.side }, units, counts: countUnits(units) };
  });
  // The Long Night is led by an elite Warden (it replaced the Blood Moon's).
  if (long && groups.length) {
    const big = groups.reduce((a, b) => (a.units.length >= b.units.length ? a : b));
    big.units.unshift([ne >= 4 ? 'knight' : 'shade', 'warden']);
    big.warden = true;
  }
  if (HOOKS.extraWaveGroups) for (const gr of HOOKS.extraWaveGroups(s, n) || []) groups.push(gr);
  const note = HOOKS.bossWaveNote ? HOOKS.bossWaveNote(s, n) : null;
  s.wave = { n, long, blood: long, pos, depth, ne, groups, total: 0, note, mods: [], wh: 0 };
  each(BUS.wavePlan, s, s.wave);
  retotal(s.wave);
}

function countUnits(units) {
  const c = {};
  for (const [t] of units) c[t] = (c[t] || 0) + 1;
  return c;
}

/** Recount every front and the total, including the Husks a Riftspawner will birth (the
 *  forecast is honest: what is shown is the most that can come). Safe to call any time. */
export function retotal(w) {
  if (!w || !Array.isArray(w.groups)) return;
  const RS = FOE_RULES.riftspawner;
  let total = 0;
  for (const g of w.groups) {
    g.counts = countUnits(g.units || []);
    const spawners = g.counts.riftspawner || 0;
    g.brood = spawners && RS ? spawners * RS.lifeCap : 0;
    if (g.brood) g.counts.husk = (g.counts.husk || 0) + g.brood;
    total += (g.units || []).length + g.brood;
  }
  w.total = total;
}

// ---- Dusk: route preview ------------------------------------------------------------------------
/** Per-front route from its spawn to the Hearth along the enemy flow field, as a flat list of
 *  tile coordinates [tx0, ty0, tx1, ty1, ...] with straight runs collapsed. Read-only: uses a
 *  scratch field, so the simulation's own field and its dirty flag are untouched. */
let scratch = null;
export function planRoutes(s) {
  if (!s.wave || !Array.isArray(s.wave.groups)) return;
  const f = scratch || (scratch = createField());
  buildFlowField(s, f, false);
  for (const g of s.wave.groups) g.route = routeFrom(f, g.sp.tx, g.sp.ty);
}
function routeFrom(f, tx, ty) {
  const out = [tx, ty];
  let i = idx(Math.max(0, Math.min(N - 1, tx)), Math.max(0, Math.min(N - 1, ty)));
  let ldx = 0, ldy = 0;
  for (let guard = 0; guard < N * 3; guard++) {
    const j = f.next[i];
    if (j < 0) break;
    const dx = (j % N) - (i % N), dy = ((j / N) | 0) - ((i / N) | 0);
    if (dx === ldx && dy === ldy && out.length > 2) { out[out.length - 2] = j % N; out[out.length - 1] = (j / N) | 0; }
    else out.push(j % N, (j / N) | 0);
    ldx = dx; ldy = dy; i = j;
  }
  return out;
}

// ---- Night: spawning ------------------------------------------------------------------------------
export function startNightSpawns(s) {
  const W = BAL.waves;
  const q = [];
  const shares = W.pulses[s.wave.pos] || [1];
  s.wave.groups.forEach((g, gi) => {
    const U = g.units;
    // Cut the front into pulses by share (each pulse at least one foe while foes remain).
    let j = 0, acc = 0;
    shares.forEach((sh, p) => {
      acc += sh;
      const end = p === shares.length - 1 ? U.length : Math.min(U.length, Math.max(j + 1, Math.round(U.length * acc)));
      for (let k = 0; j < end; j++, k++) {
        const [type, affix] = U[j];
        q.push({ t: 0.5 + gi * W.frontStagger + p * W.pulseGap + k * W.spawnInterval, type, affix, tx: g.sp.tx, ty: g.sp.ty });
      }
    });
  });
  q.sort((a, b) => a.t - b.t);
  s.spawnQueue = q;
}

export function updateSpawns(s) {
  const q = s.spawnQueue;
  const r = rng(s);
  while (q.length && q[0].t <= s.cycle.t) {
    const u = q.shift();
    const x = ctr(u.tx) + r.float(-10, 10), y = ctr(u.ty) + r.float(-10, 10);
    spawnEnemy(s, u.type, x, y, u.affix);
    emit(s, { t: 'spawn', x, y, elite: !!u.affix });
    if (u.affix === 'warden') emit(s, { t: 'toast', text: 'The Long Night: a Hollow Warden leads them!', tone: 'bad' });
  }
}

// ---- The Warden: walls and towers first; at most 40% of the Hearth a night -------------------------
const WARDEN_LOOK = 3.5; // tiles
function wardenTick(s) {
  if (s.cycle.phase !== 'night' || !s.wave) return;
  const h = s.rt.hearth;
  for (const e of s.enemies) {
    if (!e.alive || e.affix !== 'warden') continue;
    const d = ENEMIES[e.type];
    if (!d) continue;
    // It just struck the Hearth this tick (atkT is set to 0.2 on a strike): count the blow.
    if (h && e.siege === h.id && !e.targetId && e.atkT === 0.2) {
      s.wave.wh = (s.wave.wh || 0) + d.dmg * (e.dmgMult || 1) * (BAL.combat.buildingDmgMult[d.dmgType] || 1);
    }
    const sb = e.siege ? s.rt.bById.get(e.siege) : null;
    const onDefense = sb && sb.alive && sb.type !== 'hearth' && isDefense(sb);
    if (!onDefense && !e.targetId) {
      const t = nearestDefense(s, e);
      if (t) { e.siege = t.id; continue; }
    }
    if (h && e.siege === h.id && !e.targetId) {
      const next = d.dmg * (e.dmgMult || 1) * (BAL.combat.buildingDmgMult[d.dmgType] || 1);
      if ((s.wave.wh || 0) + next > BAL.waves.wardenHearthCap * h.maxHp) e.cd = Math.max(e.cd, 0.5); // spent: it can no longer harm the Hearth tonight
    }
  }
}
function isDefense(b) { const def = BUILDINGS[b.type]; return !!def && b.built && (def.isWall || b.type === 'tower' || b.type === 'ballista' || b.type === 'spire'); }
function nearestDefense(s, e) {
  let best = null, bd = WARDEN_LOOK * T;
  for (const b of s.buildings) {
    if (!b.alive || !isDefense(b)) continue;
    const dd = distToRect(e.x, e.y, b);
    if (dd < bd) { bd = dd; best = b; }
  }
  return best;
}

/** BUS.canPlace: nothing is built on a spawn point or right beside it (the Hollow rise there). */
function vetoSpawn(s, type, tx, ty) {
  const def = BUILDINGS[type];
  const size = (def && def.size) || 1, k = BAL.waves.spawnKeepOut;
  for (const sp of s.spawns) {
    if (sp.tx >= tx - k && sp.tx <= tx + size - 1 + k && sp.ty >= ty - k && sp.ty <= ty + size - 1 + k) return { ok: false, reason: 'The Hollow rise here at night' };
  }
  return null;
}

let registered = false;
/** BUS registrations owned by this module (called from director.register()). */
export function registerWaves() {
  if (registered) return;
  registered = true;
  BUS.tick.push(wardenTick);
  BUS.canPlace.push(vetoSpawn);
}
