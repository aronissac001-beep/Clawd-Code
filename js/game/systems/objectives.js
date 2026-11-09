// Region objectives: what a region asks of the player before the Beacon may be
// lit. The objective is plain data on s.objective; this module creates it,
// tracks progress every 10 ticks and sets `done`. The Hollow Rift is an entry
// in s.enemies (stationary) so every weapon in the game can strike it.
import { BAL, RUN } from '../../data/balance.js';
import { BUILDINGS } from '../../data/buildings.js';
import { ENEMIES } from '../../data/enemies.js';
import { N, TER_PASSABLE, idx, inB, ctr } from '../grid.js';
import { rng, spawnEnemy, getE, emit } from './common.js';
import { revealAround } from './fog.js';

export const RIFT_DEF = {
  id: 'rift', name: 'Hollow Rift', color: '#8a7aa8',
  desc: 'A wound in the world where the Hollow seeps through. Every night it sends more of them. Destroy it.',
  weak: 'Any weapon: it cannot fight back',
  // cost 99: never affordable from a wave budget, so wave rolls can never pick the rift itself.
  hp: 1400, dmg: 0, dmgType: 'magic', rate: 99, range: 0, speed: 0, aggro: 0,
  tags: ['hollow', 'rift'], cost: 99, radius: 16, prefers: 'any', stationary: true,
};

const NAMES = {
  survive: 'Survive the nights',
  rift: 'Destroy the Hollow Rift',
  prosperity: 'Grow prosperous',
  edict: "Fulfil the Crown's Edict",
  boss: 'Slay the Gloomwyrm',
};
export function objectiveName(objectiveType) { return NAMES[objectiveType] || NAMES.survive; }

// Building types every region starts with (safe for build/level goals).
const BASE = ['house', 'farm', 'lumber', 'quarry', 'wall', 'gate', 'tower'];
const RES_NAME = { food: 'food', wood: 'wood', stone: 'stone', gold: 'gold' };

// ---- Creation -------------------------------------------------------------------
/** Plain-data objective for a region node. rng: an RNG; step: map depth (0-based). */
export function makeObjective(r, objectiveType, step = 0, nodeType = 'region') {
  const st = Math.max(0, step | 0);
  const hard = nodeType === 'cursed' ? 1.15 : 1;
  const nr = RUN.regionNights[nodeType] || RUN.regionNights.region;
  const nights = r.int(nr[0], nr[1]);
  switch (objectiveType) {
    case 'rift': return { type: 'rift', riftId: 0, hp: 0, maxHp: 0, done: false };
    case 'prosperity': {
      // Each region is a fresh settlement, so targets rise gently; waves carry the depth.
      const target = Math.round(((190 + 18 * st) * hard) / 10) * 10;
      return { type: 'prosperity', target, score: 0, done: false };
    }
    case 'edict': return { type: 'edict', goals: makeEdictGoals(r, st, hard), done: false };
    case 'boss': return { type: 'boss', done: false };
    default: return { type: 'survive', nights: Math.max(1, nights), done: false };
  }
}

const EDICT_KINDS = [
  { kind: 'build', w: 3 }, { kind: 'level', w: 2 }, { kind: 'pop', w: 2 },
  { kind: 'produce', w: 3 }, { kind: 'train', w: 1 }, { kind: 'kills', w: 2 },
];

function makeEdictGoals(r, st, hard) {
  const pool = EDICT_KINDS.slice();
  const goals = [];
  while (goals.length < 3 && pool.length) {
    const k = r.weighted(pool, (x) => x.w);
    pool.splice(pool.indexOf(k), 1);
    goals.push(makeGoal(r, k.kind, st, hard, goals));
  }
  return goals;
}

// One edict goal; `taken` avoids repeating a building type across goals.
function makeGoal(r, kind, st, hard, taken = []) {
  const used = new Set(taken.map((g) => g.type).filter(Boolean));
  const sc = (v) => Math.max(1, Math.round(v * hard));
  let g;
  switch (kind) {
    case 'build': {
      const opts = { house: 3 + (st >> 1), farm: 2 + (st >> 2), tower: 2 + (st >> 2), wall: 10 + 2 * st, lumber: 2, quarry: 1 + (st >> 2) };
      const type = r.pick(Object.keys(opts).filter((t) => !used.has(t)));
      g = { kind, type, n: sc(Math.min(opts[type], type === 'wall' ? 30 : 9)) };
      break;
    }
    case 'level': {
      const opts = { tower: 1 + (st >> 2), house: 1 + (st >> 2), farm: 1 + (st >> 2) };
      const type = r.pick(Object.keys(opts).filter((t) => !used.has(t)));
      g = { kind, type, n: sc(Math.min(opts[type], 5)) };
      break;
    }
    case 'pop': g = { kind, n: sc(9 + st) }; break;
    case 'produce': {
      const res = r.pick(['food', 'wood', 'stone', 'gold']);
      const base = { food: [260, 40], wood: [240, 30], stone: [100, 15], gold: [130, 20] }[res];
      g = { kind, res, n: Math.round(sc(base[0] + base[1] * st) / 10) * 10 };
      break;
    }
    case 'train': g = { kind, n: sc(3 + (st >> 1)) }; break;
    default: g = { kind: 'kills', n: sc(25 + 6 * st) }; break;
  }
  g.prog = 0; g.met = false;
  g.text = goalText(g);
  return g;
}

function goalText(g) {
  const nm = (t, n) => {
    const name = (BUILDINGS[t] && BUILDINGS[t].name) || t;
    if (n === 1) return name;
    return name === 'Watchtower' ? 'Watchtowers' : name.endsWith('s') ? name : name + 's';
  };
  switch (g.kind) {
    case 'build': return `Build ${g.n} ${nm(g.type, g.n)}`;
    case 'level': return `Upgrade ${g.n} ${nm(g.type, g.n)} to level 2`;
    case 'pop': return `Grow to ${g.n} villagers`;
    case 'produce': return `Produce ${g.n} ${RES_NAME[g.res]}`;
    case 'train': return `Train ${g.n} soldiers`;
    default: return `Slay ${g.n} Hollow`;
  }
}

// ---- Region start --------------------------------------------------------------------
/** After the map and Hearth exist: place the rift, adjust impossible goals. */
export function initObjective(s) {
  const o = s.objective;
  if (!o) return;
  if (o.type === 'rift' && !o.riftId && !o.done) placeRift(s, o);
  if (o.type === 'edict') {
    // No Barracks blueprint: a training goal could never be met here.
    const noBarracks = s.blueprints && s.blueprints.length && !s.blueprints.includes('barracks');
    const i = o.goals.findIndex((g) => g.kind === 'train');
    if (noBarracks && i >= 0) {
      const kinds = ['pop', 'kills', 'produce', 'build'].filter((k) => !o.goals.some((g) => g.kind === k));
      o.goals[i] = makeGoal(rng(s), kinds[0] || 'kills', s.step || 0, s.nodeType === 'cursed' ? 1.15 : 1, o.goals);
    }
  }
  updateObjective(s);
}

function hearthCentre(s) {
  const h = s.rt.hearth;
  return h ? { x: h.tx + h.size / 2, y: h.ty + h.size / 2 } : { x: N / 2, y: N / 2 };
}

// Tiles reachable on foot from the Hearth (terrain and resource nodes block).
function reachable(s) {
  const seen = new Uint8Array(N * N);
  const h = s.rt.hearth;
  const q = [];
  if (h) {
    for (let y = h.ty - 1; y <= h.ty + h.size; y++) for (let x = h.tx - 1; x <= h.tx + h.size; x++) {
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      if (TER_PASSABLE[s.terrain[i]] && !s.nodeGrid[i] && !s.occ[i]) { seen[i] = 1; q.push(i); }
    }
  }
  while (q.length) {
    const i = q.pop();
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inB(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen[j] || !TER_PASSABLE[s.terrain[j]] || s.nodeGrid[j]) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}

// Distance bands (tiles from the Hearth centre): the spec band first, wider ones only as a fallback.
const RIFT_BANDS = [[11, 15], [9, 18], [6, 22]];

function placeRift(s, o) {
  const reach = reachable(s);
  const c = hearthCentre(s);
  const r = rng(s);
  const spawnAt = new Set(s.spawns.map((p) => idx(p.tx, p.ty)));
  const cacheAt = new Set(s.caches.map((p) => idx(p.tx, p.ty)));
  const ok = (x, y, lo, hi) => {
    if (x < 2 || y < 2 || x > N - 3 || y > N - 3) return false;
    const i = idx(x, y);
    if (!reach[i] || s.occ[i] || s.nodeGrid[i] || spawnAt.has(i) || cacheAt.has(i)) return false;
    const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
    return d >= lo && d <= hi;
  };
  // Score: how open the 3x3 around the tile is (the art is ~3 tiles wide).
  const open = (x, y) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const i = idx(x + dx, y + dy);
      if (reach[i] && !s.occ[i] && !cacheAt.has(i)) n++;
    }
    return n;
  };
  let cands = [];
  for (const [lo, hi] of RIFT_BANDS) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (ok(x, y, lo, hi)) cands.push([x, y, open(x, y)]);
    if (cands.length) break;
  }
  if (!cands.length) {
    // No room anywhere (never seen on generated maps): fall back to a plain survival objective
    // rather than leave the region without a way to light the Beacon.
    Object.assign(o, { type: 'survive', nights: RUN.regionNights.region[1], done: false });
    return;
  }
  const best = Math.max(...cands.map((q) => q[2]));
  const pool = cands.filter((q) => q[2] >= Math.min(best, 8));
  const [tx, ty] = r.pick(pool);
  const e = spawnEnemy(s, 'rift', ctr(tx), ctr(ty), null);
  const hp = Math.round(e.maxHp * (1 + 0.08 * (s.step || 0)));
  e.hp = hp; e.maxHp = hp;
  e.stationary = true; e.tx = tx; e.ty = ty;
  o.riftId = e.id; o.tx = tx; o.ty = ty; o.hp = hp; o.maxHp = hp;
  revealAround(s, ctr(tx), ctr(ty), 3.5);
}

// ---- Progress --------------------------------------------------------------------------
export function prosperityScore(s) {
  let score = 0;
  for (const v of s.villagers) if (v.alive) score += 6;
  for (const b of s.buildings) {
    if (!b.built || !b.alive) continue;
    // Walls and gates are cheap filler: they count a single point per level.
    score += BUILDINGS[b.type] && BUILDINGS[b.type].isWall ? b.level + 1 : (b.level + 1) * b.size * b.size * 4;
  }
  const p = (s.stats && s.stats.produced) || {};
  return score + Math.floor((p.gold || 0) / 10);
}

function goalValue(s, g) {
  switch (g.kind) {
    case 'build': { let n = 0; for (const b of s.buildings) if (b.alive && b.built && b.type === g.type) n++; return n; }
    case 'level': { let n = 0; for (const b of s.buildings) if (b.alive && b.built && b.type === g.type && b.level >= 1) n++; return n; }
    case 'pop': { let n = 0; for (const v of s.villagers) if (v.alive) n++; return n; }
    case 'produce': return Math.floor((s.stats.produced && s.stats.produced[g.res]) || 0);
    case 'train': return s.stats.trained || 0;
    default: return s.stats.kills || 0;
  }
}

/** Every 10 ticks: refresh progress and set `done`. */
export function updateObjective(s) {
  const o = s.objective;
  if (!o || o.done) return;
  switch (o.type) {
    case 'survive':
      if (s.cycle.night >= o.nights) o.done = true;
      break;
    case 'rift': {
      if (!o.riftId) break;
      const e = getE(s, o.riftId);
      if (!e) { riftFallen(s, o); break; }
      // Pinned in place: knockback from hits never drifts it. enemies.js skips stationary
      // entities, so their hit flash timer is cleared here instead.
      if (o.tx !== undefined) { e.x = ctr(o.tx); e.y = ctr(o.ty); }
      e.hitT = 0;
      o.hp = Math.max(0, Math.ceil(e.hp)); o.maxHp = e.maxHp;
      break;
    }
    case 'prosperity':
      o.score = prosperityScore(s);
      if (o.score >= o.target) o.done = true;
      break;
    case 'edict': {
      let all = true;
      for (const g of o.goals) {
        g.prog = Math.min(g.n, goalValue(s, g));
        // Goals stay met once met, so a burnt house never undoes an edict.
        if (g.prog >= g.n && !g.met) { g.met = true; emit(s, { t: 'toast', text: `Edict fulfilled: ${g.text}`, tone: 'good' }); }
        if (!g.met) all = false;
      }
      if (all) o.done = true;
      break;
    }
    default: break; // 'boss': boss.js sets done
  }
}

function riftFallen(s, o) {
  o.done = true; o.hp = 0; o.riftId = 0;
  // Its telegraphed groups never come: drop them from tonight's plan and queue.
  if (s.wave && s.wave.groups) {
    s.wave.groups = s.wave.groups.filter((g) => g.sp.side !== 'rift');
    s.wave.total = s.wave.groups.reduce((a, g) => a + g.units.length, 0);
  }
  if (s.spawnQueue && o.tx !== undefined) s.spawnQueue = s.spawnQueue.filter((q) => !(q.tx === o.tx && q.ty === o.ty));
  emit(s, { t: 'toast', text: 'The Hollow Rift collapses into silence.', tone: 'good' });
  emit(s, { t: 'riftFallen', x: ctr(o.tx || 0), y: ctr(o.ty || 0) });
}

// ---- Rift waves ----------------------------------------------------------------------------
const RIFT_TYPES = ['husk', 'hound', 'shade', 'knight'];
const RIFT_WEIGHT = { husk: 5, hound: 3, shade: 2.5, knight: 1 };

/** Extra telegraphed group from the rift for night n (empty when there is none). */
export function extraWaveGroups(s, n) {
  const o = s.objective;
  if (!o || o.type !== 'rift' || o.done || !o.riftId || !getE(s, o.riftId)) return [];
  const r = rng(s);
  const diff = BAL.difficulty[s.difficulty] || BAL.difficulty.standard;
  const unlock = BAL.waves.unlockNight;
  const types = RIFT_TYPES.filter((t) => ENEMIES[t] && (unlock[t] || 1) <= n);
  // Same depth and difficulty scaling as the main waves, so the rift stays about a third of a night.
  let left = (3 + 2 * (n - 1)) * diff.waveMult * (1 + (s.mods.waveMult || 0)) * (1 + RUN.depthWave * (s.step || 0));
  const units = [];
  let guard = 0;
  while (left >= 0.99 && guard++ < 60) {
    let t = r.weighted(types, (x) => (ENEMIES[x].cost <= left + 0.3 ? RIFT_WEIGHT[x] : 0));
    if (ENEMIES[t].cost > left + 0.3) t = 'husk';
    units.push([t, null]);
    left -= ENEMIES[t].cost;
  }
  if (!units.length) units.push(['husk', null]);
  const counts = {};
  for (const [t] of units) counts[t] = (counts[t] || 0) + 1;
  return [{ sp: { tx: o.tx, ty: o.ty, side: 'rift' }, units, counts, rift: true }];
}

// ---- Text ------------------------------------------------------------------------------------
/** Short HUD string (<= 22 chars). */
export function objectiveText(s) {
  const o = s.objective;
  if (!o) return '';
  if (o.done) return 'Beacon ready';
  switch (o.type) {
    case 'survive': return `Survive ${Math.min(s.cycle.night, o.nights)}/${o.nights}`;
    case 'rift': {
      const e = o.riftId ? getE(s, o.riftId) : null;
      const hp = e ? Math.max(0, Math.ceil(e.hp)) : o.hp;
      return `Rift ${hp}/${e ? e.maxHp : o.maxHp}`;
    }
    case 'prosperity': return `Prosperity ${Math.min(o.score, o.target)}/${o.target}`;
    case 'edict': return `Edict ${o.goals.filter((g) => g.met).length}/${o.goals.length}`;
    case 'boss': return 'Slay the Gloomwyrm';
    default: return '';
  }
}

/** Info-card text: { title, lines }. */
export function objectiveDetail(s) {
  const o = s.objective;
  if (!o) return { title: 'Objective', lines: [] };
  const title = objectiveName(o.type);
  const lines = [];
  switch (o.type) {
    case 'survive':
      lines.push(`Hold the realm through ${o.nights} nights. Nights survived: ${Math.min(s.cycle.night, o.nights)}.`);
      break;
    case 'rift': {
      const e = o.riftId ? getE(s, o.riftId) : null;
      if (o.done || !e) lines.push('The Hollow Rift is destroyed.');
      else {
        const c = hearthCentre(s);
        lines.push(`A Hollow Rift tears the ground to the ${compass(o.tx + 0.5 - c.x, o.ty + 0.5 - c.y)}. Rift health: ${Math.ceil(e.hp)}/${e.maxHp}.`);
        lines.push('Every night it sends an extra band of Hollow. Send your Sovereign and soldiers to destroy it.');
      }
      break;
    }
    case 'prosperity':
      lines.push(`Prosperity: ${Math.min(o.score, o.target)}/${o.target}.`);
      lines.push('Each villager, each building (bigger and upgraded ones count more) and the gold your realm earns raise it.');
      break;
    case 'edict':
      lines.push('The Crown decrees:');
      for (const g of o.goals) lines.push(`${g.text}: ${g.met ? 'done' : `${g.prog}/${g.n}`}`);
      break;
    case 'boss':
      lines.push('The Gloomwyrm comes for the Heartflame. Slay it to win the act.');
      break;
    default: break;
  }
  if (o.done && o.type !== 'boss') lines.push('Objective met: Light the Beacon by day to move on.');
  return { title, lines };
}

function compass(dx, dy) {
  const a = Math.atan2(dy, dx);
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}
