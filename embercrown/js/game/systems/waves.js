// Wave planning. The next night's attack is rolled at the start of each day
// (so the HUD can show omens) and revealed in full at dusk: direction, size
// and enemy types. Nothing spawns that was not telegraphed.
import { BAL, RUN } from '../../data/balance.js';
import { ENEMIES } from '../../data/enemies.js';
import { ctr } from '../grid.js';
import { rng, spawnEnemy, emit } from './common.js';
import { HOOKS, BUS, each } from '../hooks.js';

export function isBloodMoon(n, s) {
  return (n > 0 && n % BAL.waves.bloodMoonEvery === 0) || !!(s && BUS.query.extraBloodMoon && BUS.query.extraBloodMoon(s, n));
}

export function planNight(s) {
  const W = BAL.waves;
  const r = rng(s);
  const n = s.cycle.night + 1;
  const blood = isBloodMoon(n, s);
  const diff = BAL.difficulty[s.difficulty];
  const k = n - 1;
  let budget = (W.base + W.linear * k + W.quad * k * k) * diff.waveMult * (blood ? W.bloodMoonMult : 1)
    * (1 + (s.mods.waveMult || 0)) * (1 + RUN.depthWave * (s.step || 0)) * (1 + RUN.actWave * ((s.act || 1) - 1)) * (n === 1 && s.raiders ? 1.6 : 1);
  let groupsN = W.groupsByNight[Math.min(k, W.groupsByNight.length - 1)] + (blood ? 1 : 0);

  // Prefer distinct sides so the player learns to read directions.
  const pool = r.shuffle(s.spawns.slice());
  const chosen = [];
  const sides = new Set();
  for (const sp of pool) if (chosen.length < groupsN && !sides.has(sp.side)) { chosen.push(sp); sides.add(sp.side); }
  for (const sp of pool) if (chosen.length < groupsN && !chosen.includes(sp)) chosen.push(sp);
  groupsN = chosen.length;

  const weights = chosen.map(() => r.float(0.75, 1.25));
  const wsum = weights.reduce((a, b) => a + b, 0);
  // Bosses and stationary structures (the Rift) are never rolled into waves.
  // Wave rosters come from data: BAL.waves.unlockNight for the core four, or an
  // enemy's own `unlockNight` (and optional `waveWeight(k)`) for plug-in foes.
  const unlockOf = (t) => (t in W.unlockNight ? W.unlockNight[t] : ENEMIES[t].unlockNight);
  const types = Object.keys(ENEMIES).filter((t) => !ENEMIES[t].boss && !ENEMIES[t].stationary && !ENEMIES[t].noWave && unlockOf(t) != null && unlockOf(t) <= n);
  const baseWeight = { husk: 6, hound: 3 + k * 0.2, shade: 2 + k * 0.25, knight: 0.8 + k * 0.25 };
  const typeWeight = {};
  for (const t of types) typeWeight[t] = baseWeight[t] ?? (ENEMIES[t].waveWeight ? ENEMIES[t].waveWeight(k) : 1);

  const groups = chosen.map((sp, gi) => {
    let left = (budget * weights[gi]) / wsum;
    const units = [];
    // First night of a new type: guarantee one so its debut is never a surprise later.
    for (const t of types) if (unlockOf(t) === n && gi === 0) { units.push([t, null]); left -= ENEMIES[t].cost; }
    let guard = 0;
    while (left >= 0.99 && guard++ < 200) {
      let t = r.weighted(types, (x) => (ENEMIES[x].cost <= left + 0.3 ? typeWeight[x] : 0));
      if (ENEMIES[t].cost > left + 0.3) t = 'husk';
      let affix = null;
      if (n >= W.eliteFromNight && t === 'hound' && r.chance(0.3)) affix = 'swift';
      units.push([t, affix]);
      left -= ENEMIES[t].cost;
    }
    return { sp, units, counts: countUnits(units) };
  });
  if (blood && groups.length) {
    const big = groups.reduce((a, b) => (a.units.length >= b.units.length ? a : b));
    big.units.push([n >= 4 ? 'knight' : 'husk', 'warden']);
    big.counts = countUnits(big.units);
    big.warden = true;
  }
  if (HOOKS.extraWaveGroups) for (const gr of HOOKS.extraWaveGroups(s, n) || []) groups.push(gr);
  const note = HOOKS.bossWaveNote ? HOOKS.bossWaveNote(s, n) : null;
  s.wave = { n, blood, groups, total: 0, note, mods: [] };
  each(BUS.wavePlan, s, s.wave);
  for (const g of s.wave.groups) g.counts = countUnits(g.units);
  s.wave.total = s.wave.groups.reduce((a, g) => a + g.units.length, 0);
}

function countUnits(units) {
  const c = {};
  for (const [t] of units) c[t] = (c[t] || 0) + 1;
  return c;
}

export function startNightSpawns(s) {
  const W = BAL.waves;
  const q = [];
  s.wave.groups.forEach((g, gi) => {
    let t = 0.5 + gi * 2.5;
    for (const [type, affix] of g.units) { q.push({ t, type, affix, tx: g.sp.tx, ty: g.sp.ty }); t += W.spawnInterval; }
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
    const e = spawnEnemy(s, u.type, x, y, u.affix);
    emit(s, { t: 'spawn', x, y, elite: !!u.affix });
    if (u.affix === 'warden') emit(s, { t: 'toast', text: 'A Hollow Warden walks among them!', tone: 'bad' });
    void e;
  }
}
