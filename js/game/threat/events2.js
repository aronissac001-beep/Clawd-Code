// Stage 2 incidents without raiders (doc 9.1, 9.7, 9.8, 9.10): minor events, disasters, visitors and
// boons. Owner H. Each is the start() of its incident (C12 IncidentLogic), run at its arrival by the
// storyteller; a warned one already showed its Omen letter. Disasters that run for days keep a saved
// record in s.st.dis = [{ k, until, tiles?, next? }] (story record), advanced every game hour.
//   brawl           the rival pair (cast) trade blows: a light bruise each and "Insulted"
//   hollow_whisper  the unhappiest colonist (cast) dreams of the Hollow: a letter and "Uneasy"
//   fire            a flammable building (else a tree) in the hold catches (B's ignite)
//   blight_surge    the Grey Edge creeps in four days' worth at once (B's blightSurge; Ashfall)
//   crop_blight     one sown crop rots; every hour the rot takes one more crop next to a rotten one,
//                   for 3 days (at most 30 crops): harvest early
//   grey_cough      a colonist falls ill with the Grey Cough (F's infect; contagion is F's)
//   deep_tremor     the ground shakes under the deepest tunnel: weak tiles rumble and fall (B's tremor)
//   cold_snap       -15 C for 3-6 days (B's setWeather 'coldsnap'); drought: 4-8 days ('drought')
//   flood           open land within 2 tiles of river water becomes shallow water for 2 days (at most
//                   160 tiles; not under buildings); a quarter of the stacks there wash away; then the
//                   land comes back (only tiles still shallow)
//   vermin          a fifth of the food outside granaries, barrel racks and ice houses is spoiled
//   ember_gutter    the Hearth loses 3 days of fuel
//   wanderer        a letter with the newcomer's card: Accept or Refuse (24 h, default Refuse)
//   migrants        2-4 newcomers (Hamlet): Accept all or Refuse; also the day after each tier-up (X 2.7)
//   refugees        2-5 wounded newcomers: accepting them brings a reaver warband in 1-2 days
//   herd_passing    6-12 deer come in at an edge (K's wild animals)
//   lost_cache      a crate of goods by an edge road; starfall: a lumenite-bright crater with gems

import { headCount } from '../people/family.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../core/time.js';
import { W, H, N, TER, ROOF, PLANE, D } from '../core/grid.js';
import { nextU32 } from '../core/rand.js';
import { colById } from '../core/state.js';
import { toPlain, fromPlain } from '../core/schema.js';
import { addThought } from '../people/mood.js';
import { damage, infect } from '../people/health.js';
import { generateColonist, spawnColonist } from '../people/colonists.js';
import { ignite, canBurn } from '../world/fire.js';
import { blightSurge } from '../world/blight.js';
import { setWeather } from '../world/weather.js';
import { tremor } from '../world/support.js';
import { setTerrain, setPlant } from '../world/terrain.js';
import { spawn as spawnItem, consume, destroy, stackAt, storeBldAt } from '../work/items.js';
import { spawnAnimal } from '../animals/spawn.js';
import { registerIncidentLogic, incidentDef } from './incidents.js';
import { sendLetter, textOf, onChoice } from './letters.js';
import { edgeTile, deepestTile } from './raidplan.js';
import { def, all, bal } from './defs.js';
import { onStoryHour, scheduleIncident } from './storyteller.js';

const roll = (s, lo, hi) => lo + (nextU32(s, 'story') % (hi - lo + 1));
const able = (c) => !c.hp.dead && !c.hp.down;
const hearthAt = (s) => { const hb = s.colony.hearth.id !== null ? s.bld[s.colony.hearth.id] : null; return hb ? [hb.x + 1, hb.y + 1] : [W >> 1, H >> 1]; };
const near = (s) => { const [x, y] = hearthAt(s); return [x, y + 3]; };
const disRec = (s) => s.st.dis || (s.st.dis = []);
/** A plain incident letter from the incident's text with vars. */
const note = (s, inc, vars = {}, kind = 'incident') => sendLetter(s, kind, { inc, text: textOf((incidentDef(inc) || {}).letter || '', vars) });
const L = (logic) => Object.freeze(logic);

// ---- Minor events ---------------------------------------------------------------------------------
const BRAWL = L({
  start(s, e) {
    const pair = e.cast && e.cast.pair;
    if (!pair) return null;
    const [a, b] = pair.map((id) => colById(s, id));
    if (!a || !b || !able(a) || !able(b)) return null;
    for (const c of [a, b]) { damage(s, c, 2 + (nextU32(s, 'combat') % 2), 'blunt', 3, null); addThought(s, c, 'insulted'); }
    note(s, 'brawl', { a: a.name, b: b.name }, 'minor');
    return null;
  },
});
const WHISPER = L({
  start(s, e) {
    const c = e.cast && e.cast.dreamer !== null && e.cast.dreamer !== undefined ? colById(s, e.cast.dreamer) : null;
    if (!c || !able(c)) return null;
    addThought(s, c, 'uneasy');
    note(s, 'hollow_whisper', { name: c.name }, 'minor');
    return null;
  },
});

// ---- Disasters ------------------------------------------------------------------------------------
// (2.9b) the fire starts where the hold is awake: never at a bed, nor within FIRE_SLEEP_R tiles of a
// colonist asleep. It had no warning and the sleepers never woke: on seed 3 a fire lit under a bunk at
// night burned 7 of 18 colonists in their beds (and 4 on seed 1), a loss no player could have answered.
const FIRE_SLEEP_R = 4;
const BEDS = new Set(['bed', 'cot', 'bunk', 'doublebed', 'bedroll']);
const asleepNear = (s, x, y) => s.col.some((c) => !c.hp.dead && c.job && (c.job.type === 'sleep' || c.job.type === 'bedrest')
  && Math.abs(((c.x / 32) | 0) - x) <= FIRE_SLEEP_R && Math.abs(((c.y / 32) | 0) - y) <= FIRE_SLEEP_R);
const FIRE = L({
  start(s) {
    const cands = [];
    for (const b of s.bld) if (b && b.st === 'done' && b.def !== 'hearth' && !BEDS.has(b.def) && !asleepNear(s, b.x, b.y)) { const i = b.y * W + b.x; if (canBurn(s, i)) cands.push(i); }
    if (!cands.length) { const [hx, hy] = hearthAt(s); for (let r = 4; r < 24 && !cands.length; r += 4) for (let y = hy - r; y <= hy + r; y++) for (let x = hx - r; x <= hx + r; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = y * W + x; if (canBurn(s, i)) cands.push(i); } }
    if (!cands.length) return null;
    ignite(s, cands[nextU32(s, 'story') % cands.length]);
    note(s, 'fire');
    return null;
  },
});
const SURGE = L({ start(s) { for (let k = 0; k < 4; k++) blightSurge(s); note(s, 'blight_surge', { edge: 'grey' }); return null; } });
const cropAt = (s, i) => { const p = s.L.plant[i]; if (!p) return false; const d = all('plant')[p - 1]; return !!d && d.kind === 'crop'; };
const CROP_BLIGHT = L({
  start(s) {
    const crops = [];
    for (let i = 0; i < N; i++) if (cropAt(s, i)) crops.push(i);
    if (!crops.length) return null;
    const i = crops[nextU32(s, 'story') % crops.length];
    setPlant(s, i, 0, 0);
    disRec(s).push({ k: 'crop_blight', until: s.tick + 3 * TICKS_PER_DAY, tiles: [i] });
    note(s, 'crop_blight');
    return null;
  },
});
function cropBlightHour(s, d) {
  if (d.tiles.length >= 30) return;
  for (const i of d.tiles) {
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= N || d.tiles.includes(j) || !cropAt(s, j)) continue;
      setPlant(s, j, 0, 0); d.tiles.push(j); return;
    }
  }
}
const COUGH = L({
  start(s) {
    const list = s.col.filter(able);
    if (!list.length) return null;
    const c = list[nextU32(s, 'story') % list.length];
    if (infect(s, c, 'grey_cough')) note(s, 'grey_cough', { name: c.name });
    return null;
  },
});
const TREMOR = L({
  start(s) {
    const i = deepestTile(s);
    if (i < 0) return null;
    tremor(s, i, 8);
    return null;
  },
});
const COLD = L({ start(s) { setWeather(s, 'coldsnap', 24 * roll(s, 3, 6)); return null; } });
const DROUGHT = L({ start(s) { setWeather(s, 'drought', 24 * roll(s, 4, 8)); note(s, 'drought'); return null; } });
const isWater = (t) => t === TER.SHALLOW || t === TER.DEEP;
const FLOOD = L({
  requires: (s) => { for (let i = 0; i < N; i += 5) if (s.L.terrain[i] === TER.DEEP && s.L.roof[i] === ROOF.OPEN) return true; return false; },
  start(s) {
    const tiles = [];
    for (let i = 0; i < N && tiles.length < 160; i++) {
      const t = s.L.terrain[i];
      if (isWater(t) || t === TER.ROCK || t === TER.ICE || s.L.roof[i] !== ROOF.OPEN || s.rt.occ[i] >= 0) continue;
      const x = i % W, y = (i / W) | 0;
      let wet = false;
      for (let dy = -2; dy <= 2 && !wet; dy++) for (let dx = -2; dx <= 2 && !wet; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && s.L.terrain[yy * W + xx] === TER.DEEP) wet = true;
      }
      if (!wet) continue;
      const it = stackAt(s, i);
      if (it && nextU32(s, 'story') % 4 === 0) destroy(s, it.id);
      tiles.push([i, t]);
      setTerrain(s, i, TER.SHALLOW);
    }
    if (tiles.length) disRec(s).push({ k: 'flood', until: s.tick + 2 * TICKS_PER_DAY, tiles });
    return null;
  },
});
function floodEnd(s, d) { for (const [i, t] of d.tiles) if (s.L.terrain[i] === TER.SHALLOW && s.rt.occ[i] < 0) setTerrain(s, i, t); }
const SAFE_STORES = new Set(['granary', 'barrelrack', 'icehouse']);
const VERMIN = L({
  start(s) {
    let lost = 0;
    for (const it of s.items.slice()) {
      if (!it) continue;
      const d = def('item', it.k);
      if (!d || (d.cat !== 'rawfood' && d.cat !== 'meals')) continue;
      const sb = storeBldAt(s, it.y * W + it.x);
      if (sb && SAFE_STORES.has(sb.def)) continue;
      const n = Math.ceil(it.n / 5);
      lost += consume(s, it.id, n);
    }
    if (lost) note(s, 'vermin');
    return null;
  },
});
const GUTTER = L({ start(s) { s.colony.hearth.fuel = Math.max(0, s.colony.hearth.fuel - 3 * TICKS_PER_DAY); note(s, 'ember_gutter'); return null; } });

// ---- Visitors and boons ---------------------------------------------------------------------------
const cardOf = (c) => ({ id: c.id, name: c.name, anc: c.anc, age: c.age, traits: c.traits.slice(), bs: c.bs });
function newcomers(s, n, hurt = false) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(generateColonist(s, {}));
  return out.map((c) => ({ card: cardOf(c), plain: toPlain('col', c), hurt }));
}
function ask(s, inc, k, people, vars, extra = {}) {
  sendLetter(s, 'choice', { inc, text: textOf(incidentDef(inc).letter, vars), choices: ['Accept', 'Refuse'], deflt: 1, data: { k, people, ...extra } });
}
const WANDERER = L({ start(s) { const p = newcomers(s, 1); ask(s, 'wanderer', 'join', p, { name: p[0].card.name }); return null; } });
const MIGRANTS = L({ start(s) { const p = newcomers(s, roll(s, 2, 4)); ask(s, 'migrants', 'join', p, { n: p.length }); return null; } });
const REFUGEES = L({ start(s) { const p = newcomers(s, roll(s, 2, 5), true); ask(s, 'refugees', 'join', p, { n: p.length }, { pursued: true }); return null; } });
onChoice('join', (s, l, choice) => {
  if (choice !== 0) return;
  const [x, y] = near(s);
  for (const p of l.data.people) {
    const c = fromPlain('col', p.plain);
    spawnColonist(s, c, x, y);
    addThought(s, c, 'new_arrival');
    if (p.hurt) damage(s, c, 1, 'cut', 8, null);
  }
  if (l.data.pursued && incidentDef('reaver_raid')) {
    let at = s.tick + roll(s, 24, 48) * TICKS_PER_HOUR;
    // the pursuers keep the storyteller's 2-day gap to every other major (9.1; X 2.7: they came
    // 0.9 days after a horde)
    const gap = 2 * TICKS_PER_DAY, majors = s.st.queue.filter((e) => (incidentDef(e.inc) || {}).cat === 'major').map((e) => e.arriveTick);
    if (s.st.lastMajorArrive !== undefined) majors.push(s.st.lastMajorArrive);
    for (const r of s.raids) if ((incidentDef(r.inc) || {}).cat === 'major' && r.stage !== 'ended' && r.arriveTick !== undefined) majors.push(r.arriveTick);
    for (let k = 0; k < 20 && majors.some((t) => Math.abs(t - at) < gap); k++) at += TICKS_PER_DAY / 2;
    scheduleIncident(s, 'reaver_raid', at - 12 * TICKS_PER_HOUR, at, { side: 'n' });
    if (s.st.lastMajorArrive === undefined || at > s.st.lastMajorArrive) s.st.lastMajorArrive = at;
  }
});
const HERD = L({
  start(s) {
    if (!def('animal', 'deer')) return null;
    const i = edgeTile(s, ['n', 'e', 's', 'w'][nextU32(s, 'story') % 4]);
    if (i === null) return null;
    const n = roll(s, 6, 12);
    for (let k = 0; k < n; k++) spawnAnimal(s, 'deer', Math.min(W - 1, Math.max(0, (i % W) + (k % 3) - 1)), Math.min(H - 1, Math.max(0, (((i % PLANE) / W) | 0) + ((k / 3) | 0) - 1)), D > 1 ? { z: (i / PLANE) | 0 } : {});
    note(s, 'herd_passing', {}, 'minor');
    return null;
  },
});
const CACHE_GOODS = Object.freeze([['coins', null, 20, 60], ['bandage', null, 3, 6], ['ration', null, 8, 16], ['ingot', 'iron', 4, 10], ['cloth', 'linen', 10, 20]]);
function dropNear(s, k, m, n) { if (!def('item', k)) return; const [x, y] = near(s); spawnItem(s, k, m, 0, n, x + (nextU32(s, 'story') % 5) - 2, y + 2); }
const CACHE = L({
  start(s) {
    for (let k = 0; k < 2; k++) { const g = CACHE_GOODS[nextU32(s, 'story') % CACHE_GOODS.length]; dropNear(s, g[0], g[1], roll(s, g[2], g[3])); }
    note(s, 'lost_cache', { edge: 'south' }, 'minor');
    return null;
  },
});
const STARFALL = L({ start(s) { dropNear(s, 'gem', null, roll(s, 3, 6)); note(s, 'starfall'); return null; } });

/** Hourly (8.4, 9.8 "migrant group on tier-up"): the day after the hold reaches a new tier (Hamlet and
 * up), a migrant group asks to join. st.cooldowns['tier:migrants'] remembers the last tier served. */
function tierMigrants(s) {
  const tier = s.colony.tier | 0, cd = s.st.cooldowns, key = 'tier:migrants';
  if (tier < 1 || (cd[key] | 0) >= tier || !incidentDef('migrants')) return;
  cd[key] = tier;
  const living = headCount(s);   // Z2 (3.13): children count as half a head
  if (living >= (bal('caps').colonistsSoft || 30)) return;
  const at = (Math.floor(s.tick / TICKS_PER_DAY) + 1) * TICKS_PER_DAY + 10 * TICKS_PER_HOUR;
  scheduleIncident(s, 'migrants', at, at);
}

/** Hourly: disasters that run for days. */
function disHour(s) {
  tierMigrants(s);
  const rec = s.st.dis;
  if (!rec || !rec.length) return;
  for (const d of rec.slice()) {
    if (s.tick >= d.until) { if (d.k === 'flood') floodEnd(s, d); rec.splice(rec.indexOf(d), 1); continue; }
    if (d.k === 'crop_blight') cropBlightHour(s, d);
  }
}

export function installEvents2() {
  const L2 = { brawl: BRAWL, hollow_whisper: WHISPER, fire: FIRE, blight_surge: SURGE, crop_blight: CROP_BLIGHT, grey_cough: COUGH, deep_tremor: TREMOR,
    cold_snap: COLD, drought: DROUGHT, flood: FLOOD, vermin: VERMIN, ember_gutter: GUTTER, wanderer: WANDERER, migrants: MIGRANTS, refugees: REFUGEES,
    herd_passing: HERD, lost_cache: CACHE, starfall: STARFALL };
  for (const id of Object.keys(L2)) registerIncidentLogic(id, L2[id]);
  onStoryHour(disHour);
}
