// Morale and Dread (two 0-100 meters) and the Book of Decrees.
// Region state: s.ext.mood = { morale, dread, baseMorale, dropMult?, dreadMult?, decrees: [ids],
//   signed: [ids signed this region], loss, wt, warn: {}, mulApplied }.
// Run state: run.ext.mood = { morale, dread }, run.ext.decrees = [ids].
// Cache: s.rt.moodFx (decree effects folded together; rebuilt lazily).
// Everything plugs into the core through BUS. Deterministic: only s.rt.rng.
import { BUS } from '../hooks.js';
import { ENEMIES } from '../../data/enemies.js';
import { BUILDINGS, levelStats } from '../../data/buildings.js';
import { DECREES, availableDecrees, decreeStatus } from '../../data/decrees.js';
import { UNIT_ART, ART } from '../../engine/sprites.js';
import { T } from '../grid.js';
import { emit, mood, moodAdd, queuePending, popCap, spawnVillager, spawnSoldier, accessTile, markLightDirty } from './common.js';
import { squadFor, squadSize } from './buildings.js';

// ---- Tuning ---------------------------------------------------------------------------------------
export const MOOD = {
  runStart: { morale: 60, dread: 10 },
  carryCenter: 60,          // between regions Morale drifts halfway back to this
  carryDread: -10,          // and Dread eases by this much
  baseMorale: 50,           // the level Morale settles toward (+ decrees, factions, buildings)
  drift: 2,                 // Morale per minute toward that level
  high: 70, low: 30, riot: 15,
  highWork: 1.15, lowWork: 0.85, panicWork: 0.8,
  panic: 70,                // Dread at or above: villagers panic at night, corruption omen
  warn: [80, 90],
  warnKeys: ['d80', 'd90'],  // m.warn keys for the warnings above (no string building per tick)
  deaths: { villager: [-4, 3], soldier: [-1, 1.5], hero: [-8, 5] }, // [morale, dread]
  destroyed: -3, wallDestroyed: -1,
  calmNight: 2, bloodMoon: 6, starve: 1, // per minute
  riftDread: 2, dawnDread: 1,
  festival: { chance: 0.35, gold: 15, goldPerNight: 5, morale: 3 },
  volunteer: 0.25,
  desert: { base: 0.35, perPoint: 0.02 },
  riotDamage: 0.4,
  pilgrimMorale: 50,
  decreeEvery: 3,
  wailer: { radius: 3.5, morale: -0.4, dread: 0.3 },
  corruption: { base: 2, perNights: 3 },
};

export const WAILER_DEF = {
  id: 'wailer', name: 'Wailer', color: '#9a96a8',
  desc: 'A keening grey spirit. While any of your people stand within 3.5 tiles of it, its wail drains Morale and feeds Dread every second.',
  weak: 'Fire, the Sovereign, Mage Spires',
  hp: 46, dmg: 3, dmgType: 'magic', rate: 1.4, range: 0.8, speed: 1.25, aggro: 3.5,
  tags: ['hollow', 'spirit'], cost: 2, radius: 6, prefers: 'living',
  unlockNight: 3, waveWeight: (k) => 0.6 + 0.1 * k,
};

// ---- State ------------------------------------------------------------------------------------------
/** The region's mood with this module's fields filled in. */
export function moodState(s) {
  const m = mood(s);
  if (!m.decrees) m.decrees = [];
  if (!m.signed) m.signed = [];
  if (!m.warn) m.warn = {};
  if (typeof m.loss !== 'number') m.loss = 0;
  if (typeof m.wt !== 'number') m.wt = 0;
  if (typeof m.baseMorale !== 'number') m.baseMorale = MOOD.baseMorale + decreeSum(m.decrees, 'baseMorale');
  return m;
}

function decreeSum(ids, key) {
  let v = 0;
  for (const id of ids) { const d = DECREES[id]; if (d && d.mood && d.mood[key]) v += d.mood[key]; }
  return v;
}
function decreeProduct(ids, key) {
  let v = 1;
  for (const id of ids) { const d = DECREES[id]; if (d && d.mood && d.mood[key]) v *= d.mood[key]; }
  return v;
}

/** Decree effects folded into one object (cached in s.rt.moodFx). */
export function moodFx(s) {
  let fx = s.rt.moodFx;
  if (fx) return fx;
  fx = {
    workMult: 1, goldMult: 1, costWood: 1, costStone: 1, costFood: 1, costGold: 1, moraleFloor: 0,
    heroDmg: 1, heroLoss: 1, nightGuard: 1, deathDread: 1, deathMorale: 1,
    pilgrims: false, conscript: false, festChance: 1, festDread: 0, duskMorale: 0, duskDread: 0,
    dreadPerDawn: 0,
  };
  const ids = (s.ext.mood && s.ext.mood.decrees) || [];
  for (const id of ids) {
    const d = DECREES[id];
    if (!d) continue;
    const f = d.fx || {};
    for (const k of ['workMult', 'goldMult', 'heroDmg', 'heroLoss', 'nightGuard', 'deathDread', 'deathMorale', 'festChance']) if (f[k]) fx[k] *= f[k];
    for (const k of ['festDread', 'duskMorale', 'duskDread']) if (f[k]) fx[k] += f[k];
    if (f.moraleFloor) fx.moraleFloor = Math.max(fx.moraleFloor, f.moraleFloor);
    if (f.pilgrims) fx.pilgrims = true;
    if (f.conscript) fx.conscript = true;
    if (f.costMult) for (const k in f.costMult) { const key = 'cost' + k[0].toUpperCase() + k.slice(1); if (key in fx) fx[key] *= f.costMult[k]; }
    if (d.mood && d.mood.dreadPerDawn) fx.dreadPerDawn += d.mood.dreadPerDawn;
  }
  s.rt.moodFx = fx;
  return fx;
}

export function hasDecree(s, id) { return !!(s.ext.mood && s.ext.mood.decrees && s.ext.mood.decrees.includes(id)); }

const clamp100 = (v) => Math.max(0, Math.min(100, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Change Morale/Dread exactly (no fragility multipliers): decree one-shots, drift. */
function moodSet(s, dMorale, dDread, why) {
  const m = moodState(s);
  m.morale = clamp100(m.morale + dMorale);
  m.dread = clamp100(m.dread + dDread);
  if (why && (Math.abs(dMorale) >= 3 || Math.abs(dDread) >= 3)) emit(s, { t: 'mood', dMorale, dDread, why });
}

// ---- Registration --------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  ENEMIES.wailer = { ...WAILER_DEF };
  UNIT_ART.wailer = wailerArt;
  BUS.runNew.push(onRunNew);
  BUS.runRegion.push(onRunRegion);
  BUS.runRegionEnd.push(onRunRegionEnd);
  BUS.regionInit.push(onRegionInit);
  BUS.tick.push(onTick);
  BUS.phase.push(onPhase);
  BUS.kill.push(onKill);
  BUS.removed.push(onRemoved);
  BUS.workMult.push(workMult);
  BUS.goldMult.push(goldMult);
  BUS.costMult.push(costMult);
  BUS.dmgMult.push(dmgMult);
  BUS.wavePlan.push(wavePlan);
  BUS.choose.decree = chooseDecree;
}

// ---- Run layer ------------------------------------------------------------------------------------
function onRunNew(run) {
  run.ext.mood = { ...MOOD.runStart };
  run.ext.decrees = [];
}
function runDecrees(run) {
  if (!run.ext) run.ext = {};
  if (!Array.isArray(run.ext.decrees)) run.ext.decrees = [];
  return run.ext.decrees;
}
/** Every signed decree's region modifiers go into the region's params; the list rides in params.extra. */
function onRunRegion(run, node, params) {
  const ids = runDecrees(run);
  for (const id of ids) {
    const d = DECREES[id];
    if (d && d.mods) for (const k in d.mods) params.mods[k] = (params.mods[k] || 0) + d.mods[k];
  }
  params.extra.decrees = ids.slice();
}
function onRunRegionEnd(run, s) {
  const m = s.ext && s.ext.mood;
  if (!m) return;
  const ids = runDecrees(run); // also makes sure run.ext exists
  run.ext.mood = { morale: r3(m.morale), dread: r3(m.dread) };
  for (const id of m.signed || []) if (!ids.includes(id)) ids.push(id);
}

// ---- Region lifecycle ---------------------------------------------------------------------------
function onRegionInit(s, ctx) {
  const m = mood(s);
  const run = ctx && ctx.run;
  const carry = run && run.ext && run.ext.mood;
  if (carry && typeof carry.morale === 'number' && typeof carry.dread === 'number') {
    // The first region starts exactly where the run starts (60/10); between regions Morale
    // drifts halfway back to 60 and Dread eases by 10.
    const between = (run.regionsCleared || 0) > 0;
    const tm = between ? MOOD.carryCenter + (carry.morale - MOOD.carryCenter) / 2 : carry.morale;
    const td = between ? carry.dread + MOOD.carryDread : carry.dread;
    // Keep whatever a module that initialised before this one already added on top of the
    // defaults mood() starts from (60/10), so registration order does not matter.
    m.morale = clamp100(r3(tm + (m.morale - MOOD.runStart.morale)));
    m.dread = clamp100(r3(td + (m.dread - MOOD.runStart.dread)));
  }
  const ids = (ctx && ctx.extra && Array.isArray(ctx.extra.decrees)) ? ctx.extra.decrees : run ? runDecrees(run) : [];
  m.decrees = ids.filter((id) => DECREES[id]);
  m.signed = [];
  // Additive, so a Cathedral/combo bonus another module set up first is kept.
  m.baseMorale = (typeof m.baseMorale === 'number' ? m.baseMorale : MOOD.baseMorale) + decreeSum(m.decrees, 'baseMorale');
  m.loss = 0; m.wt = 0; m.warn = {};
  m.mulApplied = false; // multipliers are folded in on the first tick (after every module's init)
  s.rt.moodFx = null;
}

/** Fold decree fragility multipliers into dropMult/dreadMult once per region. */
function applyMultipliers(s, m) {
  m.mulApplied = true;
  const dm = decreeProduct(m.decrees, 'dropMult'), dd = decreeProduct(m.decrees, 'dreadMult');
  if (dm !== 1) m.dropMult = r3((m.dropMult || 1) * dm);
  if (dd !== 1) m.dreadMult = r3((m.dreadMult || 1) * dd);
}

function checkDread(s, m) {
  if (m.dread >= 100) {
    if (!s.outcome) {
      s.outcome = { result: 'defeat', reason: 'Dread overwhelms the realm. Your people abandon the Heartflame.' };
      emit(s, { t: 'toast', text: 'Dread overwhelms the realm.', tone: 'bad', icon: 'eye' });
    }
    return;
  }
  for (let i = 0; i < MOOD.warn.length; i++) {
    const w = MOOD.warn[i], key = MOOD.warnKeys[i];
    if (m.dread >= w && !m.warn[key]) {
      m.warn[key] = 1;
      emit(s, { t: 'toast', text: w >= 90 ? `Dread ${w}: the realm is on the brink. At 100 your people flee.` : `Dread ${w}: fear spreads. At 100 the realm is lost.`, tone: 'bad', icon: 'eye' });
    } else if (m.dread < w - 5 && m.warn[key]) m.warn[key] = 0;
  }
  if (m.morale <= MOOD.low && !m.warn.low) { m.warn.low = 1; emit(s, { t: 'toast', text: 'Morale is low: work slows and villagers may desert at dawn.', tone: 'bad', icon: 'sun' }); }
  else if (m.morale > MOOD.low + 5 && m.warn.low) m.warn.low = 0;
}

function onTick(s, dt) {
  const m = moodState(s);
  if (!m.mulApplied) applyMultipliers(s, m);
  const fx = moodFx(s);
  // Drift toward the settled level.
  const base = Math.max(0, Math.min(100, m.baseMorale));
  const step = (MOOD.drift / 60) * dt, d = base - m.morale;
  if (d) m.morale += Math.abs(d) <= step ? d : Math.sign(d) * step;
  // Hunger.
  if (s.res.food <= 0.01 && s.villagers.length > 0) moodAdd(s, -(MOOD.starve / 60) * dt, 0);
  // Wailers: every second, each one with your people in earshot.
  m.wt += dt;
  if (m.wt >= 1) {
    m.wt -= 1;
    const W = MOOD.wailer, r = W.radius * T;
    for (const e of s.enemies) {
      if (!e.alive || e.type !== 'wailer') continue;
      if (s.rt.friendHash.nearest(e.x, e.y, r)) moodAdd(s, W.morale, W.dread);
    }
  }
  if (fx.moraleFloor && m.morale < fx.moraleFloor) m.morale = fx.moraleFloor;
  checkDread(s, m);
}

function onPhase(s, phase) {
  const m = moodState(s);
  const fx = moodFx(s);
  if (phase === 'dusk') {
    m.loss = 0;
    if (fx.duskMorale || fx.duskDread) moodAdd(s, fx.duskMorale, fx.duskDread, 'Hymns at dusk');
  } else if (phase === 'night') {
    if (m.dread >= MOOD.panic) emit(s, { t: 'toast', text: 'Dread grips the villagers: they panic in the dark (work -20%).', tone: 'bad', icon: 'eye' });
  } else if (phase === 'dawn') onDawn(s, m, fx);
  if (fx.moraleFloor && m.morale < fx.moraleFloor) m.morale = fx.moraleFloor;
  checkDread(s, m);
}

function onDawn(s, m, fx) {
  const r = s.rt.rng;
  const night = s.cycle.night;
  if (s.wave && s.wave.blood) moodAdd(s, MOOD.bloodMoon, 0, 'The Blood Moon is survived');
  if (!m.loss) moodAdd(s, MOOD.calmNight, 0, 'A night without losses');
  m.loss = 0;
  const ob = s.objective;
  if (ob && ob.type === 'rift' && !ob.done) moodAdd(s, 0, MOOD.riftDread, 'The Hollow Rift still stands');
  moodSet(s, 0, -(MOOD.dawnDread + fx.dreadPerDawn));
  if (fx.moraleFloor && m.morale < fx.moraleFloor) m.morale = fx.moraleFloor;

  // High Morale: festivals and volunteers.
  if (m.morale >= MOOD.high) {
    const F = MOOD.festival;
    if (r.chance(Math.min(1, F.chance * fx.festChance))) {
      const gold = F.gold + F.goldPerNight * night;
      s.res.gold += gold;
      moodAdd(s, F.morale, -fx.festDread);
      emit(s, { t: 'toast', text: `A festival at dawn! The realm celebrates: +${gold} gold${fx.festDread ? `, Dread -${fx.festDread}` : ''}.`, tone: 'good', icon: 'sun' });
      { const h = s.rt.hearth; emit(s, { t: 'sfx', k: 'coin', x: h ? (h.tx + 1.5) * 32 : 640, y: h ? (h.ty + 1.5) * 32 : 640 }); }
    }
    if (livingVillagers(s) < popCap(s) && r.chance(MOOD.volunteer)) {
      const v = spawnVillager(s);
      emit(s, { t: 'toast', text: 'Heartened by the realm’s spirit, a volunteer joins you.', tone: 'good', icon: 'pop' });
      emit(s, { t: 'newcomer', x: v.x, y: v.y - 20, n: livingVillagers(s), cap: popCap(s) });
    }
  }
  // Low Morale: desertion; very low: riots.
  if (m.morale <= MOOD.low && s.villagers.length > 1) {
    const D = MOOD.desert;
    if (r.chance(Math.min(0.95, D.base + (MOOD.low - m.morale) * D.perPoint))) {
      const live = s.villagers.filter((v) => v.alive);
      if (live.length > 1) {
        const v = live[r.int(0, live.length - 1)];
        v.alive = false;
        emit(s, { t: 'toast', text: 'Disheartened, a villager deserts the realm in the night.', tone: 'bad', icon: 'pop' });
      }
    }
  }
  if (m.morale <= MOOD.riot) {
    const houses = s.buildings.filter((b) => b.alive && b.built && b.type === 'house');
    if (houses.length) {
      const b = houses[r.int(0, houses.length - 1)];
      b.hp = Math.max(1, b.hp - b.maxHp * MOOD.riotDamage); b.hitT = 0.14;
      emit(s, { t: 'toast', text: 'Riot! An angry crowd wrecks a House.', tone: 'bad', icon: 'house' });
      emit(s, { t: 'sfx', k: 'thud', x: (b.tx + 0.5) * T, y: (b.ty + 0.5) * T });
    }
  }
  // Decree effects at dawn.
  if (fx.pilgrims && m.morale >= MOOD.pilgrimMorale && livingVillagers(s) < popCap(s)) {
    const v = spawnVillager(s);
    emit(s, { t: 'toast', text: 'Pilgrims arrive, and one settles in the realm.', tone: 'good', icon: 'pop' });
    emit(s, { t: 'newcomer', x: v.x, y: v.y - 20, n: livingVillagers(s), cap: popCap(s) });
  }
  if (fx.conscript) conscript(s);
  // Every 3rd dawn the Book of Decrees opens (after the core's own dawn choice).
  if (night > 0 && night % MOOD.decreeEvery === 0) {
    const avail = availableDecrees(m.decrees);
    if (avail.length) queuePending(s, { kind: 'decree', options: [...avail, 'skip'], night });
  }
}

function livingVillagers(s) {
  let n = 0;
  for (const v of s.villagers) if (v.alive) n++;
  return n;
}

function conscript(s) {
  for (const b of s.buildings) {
    if (!b.alive || !b.built || b.type !== 'barracks') continue;
    const cap = levelStats('barracks', b.level).squadCap || 0;
    if (squadSize(s, b) + b.train.length >= cap) continue;
    const sq = squadFor(s, b);
    const cx = (b.tx + b.size / 2) * T, cy = (b.ty + b.size / 2) * T;
    const at = accessTile(s, b, cx, cy + T * 3) || { tx: b.tx, ty: b.ty + b.size };
    spawnSoldier(s, 'militia', sq, (at.tx + 0.5) * T, (at.ty + 0.5) * T);
    emit(s, { t: 'trained', x: cx, y: cy, unit: 'militia', squad: sq.id });
    emit(s, { t: 'toast', text: `Conscription: a Militia joins ${sq.name}.`, icon: 'sword' });
    return;
  }
}

function onKill(s, e) {
  const D = MOOD.deaths[e.kind];
  if (!D) return;
  const m = moodState(s);
  const fx = moodFx(s);
  let dm = D[0] * fx.deathMorale, dd = D[1] * fx.deathDread;
  if (e.kind === 'hero') { dm *= fx.heroLoss; dd *= fx.heroLoss; }
  const ph = s.cycle.phase;
  if (ph === 'dusk' || ph === 'night') m.loss++;
  moodAdd(s, dm, dd, e.kind === 'hero' ? `${e.name || 'A hero'} has fallen` : '');
  if (fx.moraleFloor && m.morale < fx.moraleFloor) m.morale = fx.moraleFloor;
  checkDread(s, m);
}

function onRemoved(s, b, destroyed) {
  if (!destroyed || b.type === 'hearth') return;
  const def = BUILDINGS[b.type];
  moodAdd(s, def && def.isWall ? MOOD.wallDestroyed : MOOD.destroyed, 0);
  const fx = moodFx(s), m = moodState(s);
  if (fx.moraleFloor && m.morale < fx.moraleFloor) m.morale = fx.moraleFloor;
}

// ---- Multipliers (hot paths: no allocation) --------------------------------------------------------
function workMult(s) {
  const m = s.ext.mood;
  if (!m) return 1;
  let k = m.morale >= MOOD.high ? MOOD.highWork : m.morale <= MOOD.low ? MOOD.lowWork : 1;
  if (m.dread >= MOOD.panic && s.cycle.phase === 'night') k *= MOOD.panicWork;
  return k * moodFx(s).workMult;
}
function goldMult(s) { return s.ext.mood ? moodFx(s).goldMult : 1; }
function costMult(s, type, k) {
  if (!s.ext.mood) return 1;
  const fx = moodFx(s);
  return k === 'wood' ? fx.costWood : k === 'stone' ? fx.costStone : k === 'food' ? fx.costFood : k === 'gold' ? fx.costGold : 1;
}
function dmgMult(s, src, t) {
  if (!s.ext.mood) return 1;
  const fx = s.rt.moodFx || moodFx(s);
  if (fx.heroDmg !== 1 && src && src.kind === 'hero') return fx.heroDmg;
  if (fx.nightGuard !== 1 && t.kind === 'villager' && (s.cycle.phase === 'night' || s.cycle.phase === 'dusk')) return fx.nightGuard;
  return 1;
}

/** Omen of Corruption: high Dread swells tonight's wave (telegraphed at dawn of the day). */
function wavePlan(s, wave) {
  const m = s.ext.mood;
  if (!m || m.dread < MOOD.panic || !wave.groups.length) return;
  const C = MOOD.corruption;
  const n = C.base + Math.floor(wave.n / C.perNights);
  const g = wave.groups[0];
  for (let i = 0; i < n; i++) g.units.push(['husk', null]);
  // wave.mods holds { id, name, text } omens (the director lists them in the omen panel).
  if (!Array.isArray(wave.mods)) wave.mods = [];
  wave.mods.push({ id: 'corruption', name: 'Omen of Corruption', text: `Dread ${Math.round(m.dread)} feeds the Hollow: ${n} extra Husks join tonight's attack.` });
  wave.corruption = n;
  emit(s, { t: 'toast', text: `Omen of Corruption: Dread feeds the Hollow. +${n} Husks tonight.`, tone: 'bad', icon: 'eye' });
}

// ---- Decrees --------------------------------------------------------------------------------------
/** Sign a decree in this region: modifiers now, one-shots now, kept for the rest of the run. */
export function signDecree(s, id) {
  const m = moodState(s);
  const st = decreeStatus(m.decrees, id);
  if (st.state !== 'available') return { ok: false, msg: st.reason };
  const d = DECREES[id];
  m.decrees.push(id);
  m.signed.push(id);
  s.rt.moodFx = null;
  if (d.mods) {
    for (const k in d.mods) s.mods[k] = (s.mods[k] || 0) + d.mods[k];
    if (d.mods.lightRadius) markLightDirty(s);
    if (d.mods.hearthHp) growHp(s, (b) => b.type === 'hearth', d.mods.hearthHp);
    if (d.mods.wallHp) growHp(s, (b) => BUILDINGS[b.type] && BUILDINGS[b.type].isWall, d.mods.wallHp);
  }
  if (d.mood) {
    if (d.mood.baseMorale) m.baseMorale += d.mood.baseMorale;
    if (d.mood.dropMult) m.dropMult = r3((m.dropMult || 1) * d.mood.dropMult);
    if (d.mood.dreadMult) m.dreadMult = r3((m.dreadMult || 1) * d.mood.dreadMult);
  }
  const o = d.oneShot || {};
  if (o.gold) s.res.gold += o.gold;
  if (o.food) s.res.food += o.food;
  if (o.morale || o.dread) moodSet(s, o.morale || 0, o.dread || 0, d.name);
  const fx = moodFx(s);
  if (fx.moraleFloor && m.morale < fx.moraleFloor) m.morale = fx.moraleFloor;
  emit(s, { t: 'toast', text: `Decree signed: ${d.name}.`, tone: 'good', icon: 'book' });
  emit(s, { t: 'decree', id });
  checkDread(s, m);
  return { ok: true };
}

function growHp(s, pred, frac) {
  for (const b of s.buildings) {
    if (!b.alive || !pred(b)) continue;
    const add = Math.round(levelStats(b.type, b.level).hp * frac);
    b.maxHp += add; if (b.built) b.hp += add;
  }
}

/** BUS.choose.decree: index into s.pending.options; the trailing 'skip' (or i < 0) closes the Book. */
function chooseDecree(s, i) {
  const p = s.pending;
  if (!p || p.kind !== 'decree') return { ok: false };
  const id = i >= 0 ? p.options[i] : 'skip';
  if (id === undefined) return { ok: false };
  if (id === 'skip') {
    s.pending = null;
    emit(s, { t: 'toast', text: `The Book of Decrees closes until dawn ${s.cycle.night + MOOD.decreeEvery}.`, icon: 'book' });
    return { ok: true };
  }
  const r = signDecree(s, id);
  if (r.ok) s.pending = null;
  return r;
}

// ---- Read-only helpers for the UI ---------------------------------------------------------------
/** Plain summary of the realm's mood and what it does right now. */
export function moodSummary(s) {
  const m = moodState(s);
  const fx = moodFx(s);
  const night = s.cycle.night;
  const next = night - (night % MOOD.decreeEvery) + MOOD.decreeEvery;
  return {
    morale: m.morale, dread: m.dread, base: m.baseMorale,
    high: m.morale >= MOOD.high, low: m.morale <= MOOD.low, riot: m.morale <= MOOD.riot,
    panic: m.dread >= MOOD.panic, floor: fx.moraleFloor,
    dreadPerDawn: MOOD.dawnDread + fx.dreadPerDawn,
    decrees: m.decrees.slice(), nextBook: next,
    dropMult: m.dropMult || 1, dreadMult: m.dreadMult || 1,
  };
}

// ---- Wailer art (merged into UNIT_ART) --------------------------------------------------------------
function wailerArt(frame) {
  const { INK, shadow, circle, line } = ART;
  return (g) => {
    const b = frame === 1 ? 1 : frame === 2 ? -1 : 0;
    const atk = frame === 3;
    shadow(g, 13, 27, 6, 2.2, 0.22);
    // Trailing grey shroud.
    const gr = g.createLinearGradient(0, 3, 0, 31);
    gr.addColorStop(0, '#c4c0cf'); gr.addColorStop(0.6, '#8f8a9e'); gr.addColorStop(1, 'rgba(120,114,140,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(13, 3 + b);
    g.bezierCurveTo(21, 4 + b, 22, 14, 19, 21);
    g.bezierCurveTo(18, 25, 16, 28, 17, 31);
    g.bezierCurveTo(14, 28, 13, 30, 11, 31);
    g.bezierCurveTo(10, 28, 8, 29, 7, 30);
    g.bezierCurveTo(8, 24, 4, 16, 6, 10);
    g.bezierCurveTo(7, 6, 9, 3 + b, 13, 3 + b);
    g.fill();
    g.strokeStyle = INK; g.lineWidth = 0.7; g.stroke();
    // Hood shadow and long thin arms raised to the face.
    g.fillStyle = '#4a4658';
    g.beginPath(); g.ellipse(13, 10 + b, 4.6, 5, 0, 0, Math.PI * 2); g.fill();
    line(g, 7, 14, atk ? 3 : 5, atk ? 7 : 9 + b, '#a9a4b8', 1.3);
    line(g, 19, 14, atk ? 23 : 21, atk ? 7 : 9 + b, '#a9a4b8', 1.3);
    // Hollow eyes and the open, keening mouth.
    circle(g, 11.4, 8.8 + b, 1.1, '#efe8ff', null); circle(g, 14.6, 8.8 + b, 1.1, '#efe8ff', null);
    g.fillStyle = '#1c1824';
    g.beginPath(); g.ellipse(13, 12.6 + b, 1.4, atk ? 2.6 : 2, 0, 0, Math.PI * 2); g.fill();
    // Sound rings.
    g.strokeStyle = 'rgba(214,206,240,0.55)'; g.lineWidth = 0.8;
    for (let i = 0; i < (atk ? 3 : 2); i++) { g.beginPath(); g.arc(13, 12.6 + b, 4 + i * 2.6, 0.35, Math.PI - 0.35); g.stroke(); }
  };
}

