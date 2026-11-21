// Personalities, preferences, life goals and memories (EMBERCROWN-FORTRESS.md 3.2, F15). Owner F. Stage Z2.
//
// Saved record: s.colony.people.psy = [[colId, { f, v, p, g, gm, m, hot }]] sorted by colId (plain JSON in the
// people record, so the colony codec saves it and the state hash covers it; no schema field is needed):
//   f  facets [6] -3..+3 (data FACETS order)      v  values [4] -2..+2 (VALUES order)
//   p  preferences [[kind, id] x 6]: material, gem, food, drink-or-item, creature, then the disliked one
//      as ['dislike', id] (a creature or a food)
//   g  life goal id; gm tick it was met (-1 not yet)
//   m  memories [[thoughtId, year, season, value]] (at most MEMORY_RULES.max)
//   hot ticks spent above HEAT.stroke (Heatstroke after strokeH hours; it falls back while cool)
// Generation is a pure function of (seed, colonist id, ancestry, skills) (hash3, no RNG stream), so the record
// is the same whenever it is first written. ensurePsy is called by the sim only (the daily step, the hourly
// thoughts, addThought): a save from before Z2 gains the record on its first Z2 tick, the same tick in an
// uninterrupted run and in a loaded one. UI reads go through psyOf, which never writes.
//
// What the facets and values do (3.2), where it lives:
//   Sociability  chat chance x(1 + 0.15 f) (social.js); Lonely never at f <= -2 (hourly, here)
//   Temper       break thresholds +f (breaks.js: a request; facetOf exported for it)
//   Nerve        Dread gain x(1 - 0.1 f) (needs.js: a request; nerveDreadPct exported)
//   Diligence    "Overworked" (-3) when the schedule's longest work run exceeds shiftH + f hours (hourly)
//   Fancy        room and beauty thoughts x(1 + 0.2 f) (thoughtPct, read by mood.js moodTarget)
//   Reverence    'reverence' thoughts (Unrested dead, prayer, memorials) x(1 + 0.25 f)
//   Values       a thought tagged v_<value> counts double at +2 and half at -2
// Preferences: "Admired the stone and work here" (+2, +4 when Fine+), "Ate a favourite dish", "A favourite drink",
// "Ate something I hate", "Saw a creature I love", "A creature I cannot stand", "Owns a thing I love".
// Life goals: checked once a game day; met: "Lived to see it" (+8 for a year), then "A life fulfilled" (+2,
// lasting) and a Chronicle line; never met by age 70: "A life unfinished" (-3, lasting).
// Memories: the 12 strong event thoughts of MEMORY_OF leave one; once a season each rolls its recurrence thought
// at half value (the stack of a value-1 thought), then fades by 1 and drops at 0.

import { TICKS_PER_HOUR, TICKS_PER_DAY, DAYS_PER_SEASON, seasonOf, yearOf, dayOf } from '../core/time.js';
import { W, H, TER, tx, ty, tz, zS } from '../core/grid.js';
import { SCHED } from '../core/schema.js';
import { bldById } from '../core/state.js';
import { colTile } from '../work/reserve.js';
import { roomInfoAt, roomTiles } from '../world/rooms.js';
import { stoneName, floorDefById } from '../world/defs.js';
import { addChron } from '../colony/chronicle.js';
import { def, stage2 } from './defs.js';
import { addThought, hasThought, removeThought } from './mood.js';
import { ensurePeople, peopleRec, getKey, putKey, hash3 } from './peoplerec.js';
import { kindOf, opinion, FRIEND_OP } from './social.js';
import { deedCount } from './coldeeds.js';
import { isEmberproof } from '../work/addons.js';
import {
  FACETS, VALUES, FACET_TEXT, VALUE_TEXT, FACET_RULES, FACET_TAGS, VALUE_TAGS, PREF_POOLS, PREF_BY_ANC, PREF_SLOTS,
  PREF_RULES, GOALS, GOAL_RULES, MEMORY_OF, MEMORY_RULES, HEAT,
} from '../../data/personality.js';

export { FACETS, VALUES, HEAT };
const FI = Object.freeze(Object.fromEntries(FACETS.map((k, i) => [k, i])));
const VI = Object.freeze(Object.fromEntries(VALUES.map((k, i) => [k, i])));

// ---- Generation (pure) ----------------------------------------------------------------------------------------
/** Three dice of -1..1 (a bell over -3..3), from one hash. */
const bell3 = (h) => ((h % 3) - 1) + (((h >>> 4) % 3) - 1) + (((h >>> 8) % 3) - 1);
const bell2 = (h) => ((h % 3) - 1) + (((h >>> 4) % 3) - 1);
function pick(pool, anc, h, not = null) {
  const mul = PREF_BY_ANC[anc] || {};
  let tot = 0;
  const w = pool.map(([id, wt]) => { const v = id === not ? 0 : Math.floor((wt * (mul[id] || 100)) / 100); tot += v; return v; });
  if (tot <= 0) return pool[0][0];
  let r = h % tot;
  for (let k = 0; k < pool.length; k++) { if (r < w[k]) return pool[k][0]; r -= w[k]; }
  return pool[pool.length - 1][0];
}
/** The life goal for values and skills (weighted: base w, x2 per point of its value above 0, +2 at a skill 8+). */
function pickGoal(v, col, h) {
  const best = Math.max(0, ...col.sk.map((x) => x[0] | 0));
  const ws = GOALS.map((g) => {
    let w = g.w;
    if (g.val) { const p = v[VI[g.val]]; w = p > 0 ? w * (1 + p) : p < 0 ? Math.max(1, w >> -p) : w; }
    if (g.id === 'master' && best >= 8) w += 2;
    return w;
  });
  let tot = 0; for (const w of ws) tot += w;
  let r = h % tot;
  for (let k = 0; k < GOALS.length; k++) { if (r < ws[k]) return GOALS[k].id; r -= ws[k]; }
  return GOALS[0].id;
}
/** A fresh personality record for a colonist (pure). */
export function genPsy(s, col) {
  const seed = (s.seed >>> 0) || 1, id = col.id | 0;
  const f = FACETS.map((k, i) => bell3(hash3(seed, id, 0x5100 + i)));
  const v = VALUES.map((k, i) => bell2(hash3(seed, id, 0x5200 + i)));
  const p = [];
  for (let k = 0; k < PREF_SLOTS.length; k++) {
    const kinds = PREF_SLOTS[k], h = hash3(seed, id, 0x5300 + k);
    if (kinds[0] === 'dislike') {
      const creature = h % 2 === 0;
      const likedC = p[4] ? p[4][1] : null, likedF = p[2] ? p[2][1] : null;
      p.push(['dislike', creature ? pick(PREF_POOLS.dislikeCreature, col.anc, h >>> 1, likedC) : pick(PREF_POOLS.dislikeFood, col.anc, h >>> 1, likedF)]);
      continue;
    }
    const kind = kinds.length > 1 ? kinds[h % 3 === 0 ? 1 : 0] : kinds[0];
    p.push([kind, pick(PREF_POOLS[kind], col.anc, h >>> 2)]);
  }
  return { f, v, p, g: pickGoal(v, col, hash3(seed, id, 0x5400)), gm: -1, m: [], hot: 0 };
}

// ---- Access ---------------------------------------------------------------------------------------------------
const EMPTY_PSY = Object.freeze({ f: [0, 0, 0, 0, 0, 0], v: [0, 0, 0, 0], p: [], g: null, gm: -1, m: [], hot: 0 });
/** The record (read only: a colonist not yet written reads as their generated one). */
export function psyOf(s, col) {
  if (!col) return EMPTY_PSY;
  const rec = peopleRec(s);
  const e = rec.psy ? getKey(rec.psy, col.id) : null;
  return e ? e[1] : genPsy(s, col);
}
/** The saved record, written on first use (sim only). */
export function ensurePsy(s, col) {
  const rec = ensurePeople(s);
  if (!rec.psy) rec.psy = [];
  const e = getKey(rec.psy, col.id);
  if (e) return e[1];
  const p = genPsy(s, col);
  putKey(rec.psy, [col.id, p]);
  return p;
}
/** Replace a colonist's record (tests and scripted scenes). */
export function setPsy(s, col, patch) { const p = ensurePsy(s, col); Object.assign(p, patch); return p; }
export const facetOf = (s, col, k) => psyOf(s, col).f[FI[k]] | 0;
export const valueOf = (s, col, k) => psyOf(s, col).v[VI[k]] | 0;
export const likes = (s, col, kind, id) => psyOf(s, col).p.some((x) => x[0] === kind && x[1] === id);
export const dislikes = (s, col, id) => psyOf(s, col).p.some((x) => x[0] === 'dislike' && x[1] === id);
/** Nerve (3.2): Dread gain percent x(1 - 0.1 f) (needs.js light fall, on request). */
export const nerveDreadPct = (s, col) => 100 - 10 * facetOf(s, col, 'nerve');
/** Temper (3.2): points added to the break thresholds (breaks.js, on request). */
export const temperBreak = (s, col) => facetOf(s, col, 'temper');
/** Sociability (3.2): chat chance percent. */
export const chatPct = (s, col) => 100 + FACET_RULES.chatPct * facetOf(s, col, 'sociability');

/**
 * Mood percent (x100) a thought def counts at for this colonist: Fancy on room and beauty thoughts, Reverence on
 * 'reverence' thoughts, values on v_* tags (x2 at +2, x0.5 at -2). 100 for untagged thoughts.
 */
export function thoughtPct(psy, d) {
  const tags = d && d.tags;
  if (!tags || !psy) return 100;
  let pct = 100;
  for (const t of tags) {
    if (FACET_TAGS.fancy.includes(t)) pct = Math.trunc((pct * (100 + FACET_RULES.fancyPct * psy.f[FI.fancy])) / 100);
    else if (FACET_TAGS.reverence.includes(t)) pct = Math.trunc((pct * (100 + FACET_RULES.reverencePct * psy.f[FI.reverence])) / 100);
  }
  for (const k of VALUES) {
    if (!tags.includes(VALUE_TAGS[k])) continue;
    const v = psy.v[VI[k]];
    if (v >= 2) pct *= 2; else if (v <= -2) pct = Math.trunc(pct / 2);
  }
  return Math.max(0, pct);
}

// ---- Bio tab (I reads these) ------------------------------------------------------------------------------------
/** Plain sentences for the Bio tab: facets and values that are not 0, in data order. */
export function describe(s, col) {
  const p = psyOf(s, col), out = [];
  FACETS.forEach((k, i) => { const t = FACET_TEXT[k][p.f[i] + 3]; if (t) out.push(t); });
  VALUES.forEach((k, i) => { const t = VALUE_TEXT[k][p.v[i] + 2]; if (t) out.push(t); });
  return out;
}
const nameOf = (kind, id) => {
  if (kind === 'material' || kind === 'gem') { const m = def('material', id); return m ? m.name : id; }
  if (kind === 'creature') { const a = def('animal', id); return a ? a.name : id; }
  const it = def('item', id); return it ? it.name || id : id;
};
/** Preference lines: { likes: ['Granite', ...], dislikes: 'Cave spider' }. */
export function prefLines(s, col) {
  const p = psyOf(s, col);
  const d = p.p.find((x) => x[0] === 'dislike');
  return { likes: p.p.filter((x) => x[0] !== 'dislike').map((x) => nameOf(x[0], x[1])),
    dislikes: d ? nameOf(def('animal', d[1]) ? 'creature' : 'food', d[1]) : null };
}
/** The life goal line: { id, label, met }. */
export function goalLine(s, col) {
  const p = psyOf(s, col), g = GOALS.find((x) => x.id === p.g);
  return g ? { id: g.id, label: g.label, met: p.gm >= 0 } : null;
}

// ---- Preference thoughts (hourly) ---------------------------------------------------------------------------------
/** Materials a room is made of: its bounding walls (rock or built), its floors and its furniture. Sorted ids. */
export function roomMaterials(s, roomId) {
  const set = new Set(), a = s.rt.room, occ = s.rt.occ, L = s.L;
  const add = (m) => { if (m) set.add(m); };
  for (const i of roomTiles(s, roomId)) {
    const x = tx(i), y = ty(i);
    const fd = floorDefById(L.floor[i]);
    if (fd && fd.mat) add(fd.mat);
    if (L.terrain[i] === TER.ROUGH && L.mat[i]) add(stoneName(L.mat[i]));
    const ns = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const n of ns) {
      if (n < 0 || a[n] === roomId) continue;
      if (occ && occ[n] >= 0) { const b = s.bld[occ[n]]; if (b && b.st === 'done') add(b.mat); }
      else if (L.terrain[n] === TER.ROCK) add(stoneName(L.mat[n]));
    }
    if (occ && occ[i] >= 0) { const b = s.bld[occ[i]]; if (b && b.st === 'done') add(b.mat); }
  }
  return [...set].sort();
}
function setCond(s, col, id, on) {
  const has = hasThought(col, id);
  if (on && !has) addThought(s, col, id);
  else if (!on && has) removeThought(col, id);
}
/** The longest run of WORK hours in the schedule (wrapping midnight). */
export function longestShift(sched) {
  let best = 0, run = 0;
  for (let k = 0; k < 48; k++) { if (sched[k % 24] === SCHED.WORK) { run++; if (run > best) best = run; } else run = 0; }
  return Math.min(24, best);
}
/** Items or furniture of kind k in a colonist's bedroom (the room of their bed), or held. */
function ownsKind(s, col, k) {
  const held = col.job && col.job.carry;
  if (held && held.k === k) return true;
  if (col.bed === null || col.bed === undefined) return false;
  const b = bldById(s, col.bed);
  if (!b) return false;
  const room = s.rt.room[((b.z | 0) * H + b.y) * W + b.x];
  if (!room) return false;
  const info = roomInfoAt(s, ((b.z | 0) * H + b.y) * W + b.x);
  if (info) for (const id of info.contents) { const o = bldById(s, id); if (o && o.def === k) return true; }
  for (const it of s.items) if (it && it.k === k && s.rt.room[((it.z | 0) * H + it.y) * W + it.x] === room) return true;
  return false;
}
/**
 * The hourly personality thoughts (mood.js, after surroundings, Stage 2): preference thoughts, Lonely by
 * Sociability, Overworked by Diligence, and the life-goal condition thoughts.
 */
export function personalityHour(s, col) {
  if (!stage2() || col.hp.dead) return;
  const p = ensurePsy(s, col), i = colTile(col);
  // preferences
  const mats = p.p.filter((x) => x[0] === 'material' || x[0] === 'gem').map((x) => x[1]);
  const info = roomInfoAt(s, i);
  let admired = false;
  if (info && mats.length) { const rm = roomMaterials(s, info.id); admired = mats.some((m) => rm.includes(m)); }
  const fine = admired && info.tierIdx >= PREF_RULES.fineTier;
  if (admired) { addThought(s, col, fine ? 'admired_material_fine' : 'admired_material'); removeThought(col, fine ? 'admired_material' : 'admired_material_fine'); }
  const liked = p.p.find((x) => x[0] === 'creature'), loath = p.p.find((x) => x[0] === 'dislike');
  const z = col.z | 0;
  let saw = false, near = false;
  const R1 = PREF_RULES.seeR * 32, R2 = PREF_RULES.loathR * 32;
  for (const a of s.anim) {
    if (!a || (a.z | 0) !== z || (a.hp && a.hp.dead)) continue;
    const dx = Math.abs(a.x - col.x), dy = Math.abs(a.y - col.y);
    if (liked && a.kind === liked[1] && dx <= R1 && dy <= R1) saw = true;
    if (loath && a.kind === loath[1] && dx <= R2 && dy <= R2) near = true;
  }
  if (saw) addThought(s, col, 'saw_liked_creature');
  if (near) addThought(s, col, 'loathed_creature');
  const item = p.p.find((x) => x[0] === 'item');
  setCond(s, col, 'owns_liked', !!item && ownsKind(s, col, item[1]));
  // a Brooding or Hollow-whispered seizure is not Ember-touched (surround.js sets that one for any seizure)
  const em = s.colony.ember, mine = !!em && em.colId === col.id, kind = mine ? em.kind || 'ember' : null;
  if (kind && kind !== 'ember') removeThought(col, 'ember_touched');
  if (!mine || kind !== 'brooding') removeThought(col, 'brooding');
  if (!mine || kind !== 'whispered') removeThought(col, 'whispered_work');
  // Sociability: never Lonely at -2 or lower (surround.js sets it by days without a chat)
  if (p.f[FI.sociability] <= FACET_RULES.lonelyNever) removeThought(col, 'lonely');
  // Diligence: the schedule's longest work run against what they tolerate
  setCond(s, col, 'overworked', longestShift(col.sched) > FACET_RULES.shiftH + p.f[FI.diligence]);
  // life goal conditions
  const metFor = p.gm >= 0 ? s.tick - p.gm : -1;
  setCond(s, col, 'goal_met', metFor >= 0 && metFor < GOAL_RULES.metDays * TICKS_PER_DAY);
  setCond(s, col, 'goal_met_lasting', metFor >= GOAL_RULES.metDays * TICKS_PER_DAY);
  setCond(s, col, 'life_unfinished', p.gm < 0 && (col.age | 0) >= GOAL_RULES.unfinishedAge);
}

// ---- Thoughts as they are added (mood.js addThought calls onThought) -------------------------------------------------
const FOOD_THOUGHTS = new Set(['ate_meal', 'ate_raw', 'ate_fine_meal', 'ate_feast']);
/** A thought was just added: memories, favourite food and drink, facet drift. */
export function onThought(s, col, id, d) {
  if (!stage2() || !col || !col.hp || col.hp.dead) return;
  if (FOOD_THOUGHTS.has(id) || id === 'drank') {
    const k = col.job && col.job.carry ? col.job.carry.k : null;
    if (!k) return;
    if (id === 'drank') { if (likes(s, col, 'drink', k)) addThought(s, col, 'drank_favourite'); return; }
    if (likes(s, col, 'food', k)) addThought(s, col, 'ate_favourite');
    else if (dislikes(s, col, k)) addThought(s, col, 'ate_disliked');
    return;
  }
  if (!(id in MEMORY_OF)) return;
  const p = ensurePsy(s, col);
  remember(s, p, id, Math.abs(d.value | 0));
  // a friend's death may raise Temper (3.2: 10%)
  if ((id === 'friend_died' || id === 'lover_died' || id === 'kin_died') && hash3(col.id, s.tick, 0x5d1) % 100 < FACET_RULES.driftPct) {
    p.f[FI.temper] = Math.min(3, p.f[FI.temper] + 1);
  }
}
/** Add a memory; when full, the weakest (then oldest) gives way to a stronger one. */
export function remember(s, p, id, value) {
  if (value <= 0) return;
  const m = p.m, mem = [id, yearOf(s.tick), seasonOf(s.tick), value];
  if (m.length < MEMORY_RULES.max) { m.push(mem); return; }
  let w = 0;
  for (let k = 1; k < m.length; k++) if (m[k][3] < m[w][3]) w = k;
  if (m[w][3] < value) { m.splice(w, 1); m.push(mem); }
}
/** Once a season (day 0 of each season): each memory may recur at half value, then fades by 1. */
function seasonMemories(s, col, p) {
  const out = [];
  for (const mem of p.m) {
    const rec = MEMORY_OF[mem[0]], half = mem[3] >> 1;
    if (rec && half > 0 && hash3(col.id, s.tick, mem[1] * 4 + mem[2]) % 100 < MEMORY_RULES.rollPct) recur(s, col, rec, half);
    mem[3]--;
    if (mem[3] > 0) out.push(mem);
  }
  p.m = out;
}
/** A recurrence thought at strength n (its stack: the def is worth 1 a stack). */
export function recur(s, col, id, n) {
  if (!addThought(s, col, id)) return;
  const t = col.thoughts.find((x) => x[0] === id);
  const d = def('thought', id);
  if (t && d && d.stack) t[2] = Math.max(t[2] | 0, Math.min(d.stack.max, n));
}

// ---- Life goals -------------------------------------------------------------------------------------------------
/** Is the colonist's goal met now? A test over the saved state (3.2). */
export function goalMet(s, col, goalId) {
  const g = GOALS.find((x) => x.id === goalId);
  if (!g) return false;
  const t = g.test;
  if (t.deed && deedCount(col, t.deed) >= t.n) return true;
  if (t.orQ && s.items.some((it) => it && it.maker === col.id && (it.q | 0) >= t.orQ && it.k !== 'corpse')) return true;
  if (t.lvl) return col.sk.some((x) => (x[0] | 0) >= t.lvl);
  if (t.spouse) return s.col.some((o) => o !== col && !o.hp.dead && kindOf(s, col.id, o.id) === 'spouse');
  if (t.friends) { let n = 0; for (const o of s.col) if (o !== col && !o.hp.dead && opinion(s, col.id, o.id) >= FRIEND_OP) n++; return n >= t.friends; }
  if (t.tier) return (s.colony.tier | 0) >= t.tier;
  if (t.thought) return hasThought(col, t.thought);
  if (t.depth) return tz(colTile(col)) <= zS - t.depth;
  if (t.artifact) return s.items.some((it) => it && it.name && it.maker !== null && it.maker !== undefined && it.k !== 'corpse' && (it.q | 0) >= 4);
  return false;
}
function checkGoal(s, col, p) {
  if (p.gm >= 0 || !p.g || !goalMet(s, col, p.g)) return;
  p.gm = s.tick;
  const g = GOALS.find((x) => x.id === p.g);
  addChron(s, 'people', 'chron_life_goal', { name: col.name, goal: g ? g.label : p.g, colId: col.id });
  if (Array.isArray(col.log)) { col.log.push({ tick: s.tick, text: `Lived to see it: ${g ? g.label.toLowerCase() : p.g}.` }); if (col.log.length > 40) col.log.splice(0, col.log.length - 40); }
}

/** The daily step (mood.js, at midnight, Stage 2): records, goals, the seasonal memories. */
export function personalityDay(s) {
  if (!stage2()) return;
  const seasonStart = dayOf(s.tick) % DAYS_PER_SEASON === 0 && dayOf(s.tick) > 0;
  // records of the dead and the gone are dropped (psyOf regenerates the facets for a dead colonist's page):
  // the record stays bounded by the living (soak cap)
  const rec = peopleRec(s);
  if (rec.psy && rec.psy.length) {
    const ids = new Set(s.col.filter((c) => !c.hp.dead).map((c) => c.id));
    for (let k = rec.psy.length - 1; k >= 0; k--) if (!ids.has(rec.psy[k][0])) rec.psy.splice(k, 1);
  }
  for (const col of s.col) {
    if (col.hp.dead) continue;
    const p = ensurePsy(s, col);
    checkGoal(s, col, p);
    if (seasonStart) seasonMemories(s, col, p);
  }
}

// ---- Heat (2.6) -----------------------------------------------------------------------------------------------------
/**
 * Sweltering (-4 above 35 C, -10 above 45 C) and Heatstroke (above 50 C for 2 game hours; it eases off as they
 * cool, an hour for an hour). `t` is the colonist's temperature, `dt` the ticks since the last call.
 */
export function heatConditions(s, col, t, dt) {
  // Z2.4: ember-proof gear keeps off Sweltering and Heatstroke
  const sl = col.gear && col.gear.slots;
  if (sl && Object.values(sl).some((p) => p && isEmberproof(typeof p === 'object' ? p.k : p))) t = Math.min(t, HEAT.hot);
  setCond(s, col, 'sweltering2', t > HEAT.hotter);
  setCond(s, col, 'sweltering', t > HEAT.hot && t <= HEAT.hotter);
  const hotNow = t > HEAT.stroke;
  const p0 = psyOf(s, col);
  if (!hotNow && !(p0.hot > 0)) { if (hasThought(col, 'heatstroke')) removeThought(col, 'heatstroke'); return; }
  const p = ensurePsy(s, col);
  p.hot = Math.max(0, Math.min(2 * HEAT.strokeH * TICKS_PER_HOUR, (p.hot | 0) + (hotNow ? dt : -dt)));
  if (hotNow && p.hot >= HEAT.strokeH * TICKS_PER_HOUR) setCond(s, col, 'heatstroke', true);
  else if (p.hot === 0) setCond(s, col, 'heatstroke', false);
}
/** Work percent from heat (skills.js workSpeed, on request): Heatstroke x0.7. */
export const heatWorkPct = (col) => (hasThought(col, 'heatstroke') ? HEAT.workPct : 100);
