// Seizures of craft: the moods family (EMBERCROWN-FORTRESS.md 3.3, F16). Owner F. Stage Z2.
// This folds R2 4.5 Ember-touched (people/embertouch.js, whose whole API this module exports unchanged, so
// embertouch.js can become `export * from './seizures.js'`) into one system of three seizures.
//
// s.colony.ember (C2) = null | { kind?, colId, skill, bench, demand: [[k, m, n]], start, deadline, met, work, days,
//   dead?, take? }. kind is 'ember' (absent in older saves: read as 'ember'), 'brooding' or 'whispered'. At most
//   one seizure at a time, colony-wide. The people record keeps the rest (s.colony.people, plain JSON):
//     seizeN   artifacts made by seizures (memorials not counted); old saves start from the named artifacts they hold
//     dreadD   [[colId, consecutive days at Dread >= 60]] (Hollow-whispered)
//     melan    [[colId, deadId]] Melancholy until a memorial to deadId stands
//     memo     [[itemOrSlabKey, deadId]] memorials (Brooding artifacts; Z2.6 slabs through recordMemorial)
//     grey     [[itemId]] grey artifacts (Dread +1 a game hour within 4 tiles)
//
//   Pace (3.3): every daily chance is multiplied by max(0, 1 + floor(pop / 5) - seizeN), so a hold of 20 expects
//     about 4-5 artifacts over its life, plus memorials.
//   Ember-touched: as R2 (embertouch.js rules); the demand's first ordinary material becomes the colonist's
//     liked stone, metal or wood (personality.js) when the hold has it in stock or in its rock.
//   Brooding: within 10 days of the death of a friend, kin or lover; a crafter at 4+ with a bench; demands 1-3
//     materials and a token of the dead (an item they owned or made, or, once they lie in a grave, a stone block from
//     the grave site); met: a named memorial artifact ("..., in memory of Hal"), "Made a memorial" (+10), friends
//     of the dead "A memorial to a friend" (+6); not met in 5 days: Melancholy (-6 until a memorial is raised).
//   Hollow-whispered: Dread >= 60 for 3 days, or Hollow-Touched (1% a day); any Ember skill at 4+ with a bench; no
//     demand: they take up to two stacks from the stores and work; met: a grey artifact (value x3 on G's item, on
//     request; Dread +1 within 4 tiles), no skill gain; drafted or in another break while working: Grey-raging.
// The day's trigger tries Brooding, then Hollow-whispered, then Ember-touched, colonists in id order.

import { FIX, SKILL_IDS } from '../core/schema.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR, dayOf } from '../core/time.js';
import { tx, ty, tz, TER } from '../core/grid.js';  // tx/ty: the bench distance
import { depositId, stoneId, plantCode } from '../world/defs.js';
import { emit } from '../core/events.js';
import { bldById } from '../core/state.js';
import { structDef } from '../core/content.js';
import { T, makeJob, registerToil, RUN, NEXT, keyBld } from '../work/jobs.js';
import { colTile } from '../work/reserve.js';
import { standSpot } from '../work/windex.js';
import { footprint } from '../work/construct.js';
import { spawnAt, take } from '../work/items.js';
import { addChron } from '../colony/chronicle.js';
import { hasTech } from '../colony/research.js';
import { all, def, PEOPLE, stage2 } from './defs.js';
import { addThought, removeThought, hasThought } from './mood.js';
import { startBreakOf } from './breaks.js';
import { grantTrait } from './colonists.js';
import { ensurePeople, peopleRec, hash3, getKey, putKey, dropKey } from './peoplerec.js';
import { relation, FRIEND_OP } from './social.js';
import { psyOf } from './personality.js';
import { SEIZE, BROODING_DEMAND, WHISPER_TAKES, MEMORIAL_NAMES, GREY_NAMES, MEMORIAL_KIND, GREY_KIND } from '../../data/seizures.js';

const E = PEOPLE.ember;
export const EMBER_SKILLS = Object.freeze(['smithing', 'woodcraft', 'masonry', 'tailoring', 'art', 'cooking']);
export const MIN_LVL = E.minLvl, MIN_MOOD = E.minMood * FIX;
/** What the artifact is, by skill (item kinds; G's art items). */
export const ARTIFACT_KIND = Object.freeze({ smithing: 'sword', woodcraft: 'statue', masonry: 'bigstatue', tailoring: 'tapestry', art: 'figurine', cooking: 'feast' });
const SKILL_WORK = Object.freeze({ smithing: 'smith', woodcraft: 'craft', masonry: 'craft', tailoring: 'tailor', art: 'art', cooking: 'cook' });
export const SEIZURE_KINDS = Object.freeze(['ember', 'brooding', 'whispered']);

export const activeEmber = (s) => s.colony.ember;
/** The kind of the active seizure ('ember' for records made before Z2), or null. */
export const seizureKind = (s) => (s.colony.ember ? s.colony.ember.kind || 'ember' : null);
const lvl = (col, sk) => col.sk[SKILL_IDS.indexOf(sk)][0];
const able = (col) => !col.hp.dead && !col.hp.down && !col.breakState;
/** Is this colonist eligible for the daily Ember-touched check? */
export function eligible(s, col) {
  if (s.colony.ember || !able(col) || col.mood < MIN_MOOD) return false;
  // (X 2.7 play-test: the Ember comes to a crafter who has a workshop of their craft, and not before day E.minDay)
  if (dayOf(s.tick) < (E.minDay | 0)) return false;
  return EMBER_SKILLS.some((k) => lvl(col, k) >= MIN_LVL && benchFor(s, col, k) !== null);
}
/** Demand rows for a skill and tier (data). */
export const demandRows = (skill, tier) => all('emberDemand').filter((r) => r.skill === skill && r.tier === tier);

/** The colonist's best seizure skill at minLvl+ (level, then data order), with a bench when s is given. */
function emberSkill(col, s = null, minLvl = MIN_LVL) {
  let best = null;
  for (const k of EMBER_SKILLS) if (lvl(col, k) >= minLvl && (!s || benchFor(s, col, k) !== null) && (!best || lvl(col, k) > lvl(col, best))) best = k;
  return best;
}
/** The nearest finished workshop for a skill: its id, or null. */
function benchFor(s, col, skill) {
  const work = SKILL_WORK[skill], c = colTile(col);
  let best = null, bd = Infinity;
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    const d = structDef(b.def);
    if (!d || !d.workbench || d.workbench.workType !== work) continue;
    const dist = Math.abs(b.x - tx(c)) + Math.abs(b.y - ty(c)) + 4 * Math.abs((b.z | 0) - (col.z | 0));
    if (dist < bd) { bd = dist; best = b.id; }
  }
  return best;
}
const GEMS = Object.freeze(['amber', 'garnet', 'sapphire', 'emerald', 'ruby', 'heartstone']);
/**
 * Does the map still hold the source of a "from the deep" key in unmined rock? ingot/ore:X needs
 * deposit X; block:duskstone needs Duskstone rock; gem:X deposit X; cutgem any gem pocket; glowcap a
 * cavern mushroom. Other keys (honey, cheese) are always obtainable.
 */
export function deepHeld(s, key) {
  const [k, m] = key.split(':');
  const L = s.L, N = L.terrain.length;
  let ores = null, stone = 0;
  if ((k === 'ingot' || k === 'ore' || k === 'gem') && m) ores = [depositId(m)];
  else if (k === 'cutgem') ores = GEMS.map(depositId);
  else if (k === 'block' && m) stone = stoneId(m);
  else if (k === 'glowcap') { const pc = plantCode('glowcap'); if (!pc) return false; for (let i = 0; i < N; i++) if (L.plant[i] === pc) return true; return false; }
  else return true;
  if (ores) ores = ores.filter(Boolean);
  if ((!ores || !ores.length) && !stone) return false;
  for (let i = 0; i < N; i++) {
    if (L.terrain[i] !== TER.ROCK) continue;
    if (stone && L.mat[i] === stone) return true;
    if (ores && L.ore[i] && ores.includes(L.ore[i])) return true;
  }
  return false;
}
/** The demand key of a liked material (block / ingot / wood), or null. */
function likedKey(s, col) {
  const pr = psyOf(s, col).p.find((x) => x[0] === 'material');
  const m = pr && def('material', pr[1]);
  if (!m) return null;
  const k = m.group === 'stone' ? 'block' : m.group === 'metal' ? 'ingot' : m.group === 'wood' ? 'wood' : null;
  if (!k) return null;
  const key = k === 'wood' && m.id === 'wood' ? 'wood' : `${k}:${m.id}`;
  // only what the hold can get: in stock now, or (stone and ore) still in its rock
  if (stockOf(s, k, k === 'wood' && m.id === 'wood' ? null : m.id) > 0) return key;
  if (k === 'ingot' && !all('recipe').some((r) => (r.in || []).some((i) => i.mat === m.id) && (!r.tech || hasTech(s, r.tech)))) return null;
  if (k === 'block' && !stoneNear(s, m.id)) return null;
  if (k === 'block' || k === 'ingot') return deepHeld(s, key) && key !== 'ingot:steel' && key !== 'ingot:bronze' ? key : null;
  return null;
}
/** Is stone `id` in unmined rock within 3 levels of the deepest level a colonist stands on? */
function stoneNear(s, id) {
  const st = stoneId(id);
  if (!st) return false;
  let lo = Infinity;
  for (const c of s.col) if (!c.hp.dead) lo = Math.min(lo, tz(colTile(c)));
  if (lo === Infinity) return false;
  const L = s.L, N = L.terrain.length;
  for (let i = 0; i < N; i++) if (L.terrain[i] === TER.ROCK && L.mat[i] === st && Math.abs(tz(i) - lo) <= 3) return true;
  return false;
}
/** Roll the Ember demand: 2-3 ordinary materials (the first the liked one when it can be had) and one from the deep. */
export function rollDemand(s, col, skill) {
  const tierId = (all('tier')[s.colony.tier | 0] || { id: 'camp' }).id;
  const rows = demandRows(skill, tierId).length ? demandRows(skill, tierId) : demandRows(skill, 'camp');
  if (!rows.length) return [];
  const row = rows[0], seed = hash3(col.id, s.tick, 0xe1);
  const mats = Object.keys(row.mats).sort(), deep = Object.keys(row.deep).sort();
  const nMats = 2 + (seed % 2);
  const out = [];
  for (let k = 0; k < mats.length && out.length < nMats; k++) {
    const key = mats[(k + (seed >>> 3)) % mats.length];
    const [kind, m] = key.split(':');
    out.push([kind, m || null, row.mats[key]]);
  }
  if (stage2()) {
    const lk = likedKey(s, col);
    if (lk && !out.some((d) => (d[1] ? `${d[0]}:${d[1]}` : d[0]) === lk)) {
      const [kind, m] = lk.split(':');
      out[0] = [kind, m || null, SEIZE.likedN[kind] || 10];
    }
  }
  // prefer what the map still holds in unmined rock (so the demand pushes digging), else any
  const held = deep.filter((k) => deepHeld(s, k));
  const pool = held.length ? held : deep;
  const dk = pool[(seed >>> 7) % pool.length];
  const [kind, m] = dk.split(':');
  out.push([kind, m || null, row.deep[dk]]);
  return out;
}

/** Seize a colonist with Ember-touched (the daily trigger, or a scripted test). Returns the record. */
export function startEmber(s, col, skill = emberSkill(col, s) || emberSkill(col)) {
  if (!skill) return null;
  const rec = ensurePeople(s);
  s.colony.ember = { kind: 'ember', colId: col.id, skill, bench: benchFor(s, col, skill), demand: rollDemand(s, col, skill), start: s.tick, deadline: s.tick + E.deadlineDays * TICKS_PER_DAY, met: -1, work: 0, days: 0 };
  rec.emberLast = s.tick;
  emit(s, 'emberTouched', { colId: col.id, bId: s.colony.ember.bench });
  return s.colony.ember;
}
/** Units of kind k (material m) the colony holds anywhere on the map, not forbidden (the demand card). */
function stockOf(s, k, m) {
  if (k === 'token') return tokenStock(s, m | 0);
  let n = 0;
  for (const it of s.items) if (it && it.k === k && (!m || it.m === m) && !it.f) n += it.n;
  return n;
}
/** Is the dead colonist laid in a grave (by name in the people record)? */
function inGrave(s, deadId) {
  const dead = s.col.find((c) => c.id === deadId);
  const name = dead ? dead.name : null;
  return !!name && peopleRec(s).graves.some((g) => Array.isArray(g[1]) && g[1].includes(name));
}
/** The stack that serves as a token of the dead: an item they made or owned, else a stone block once buried. */
function tokenItem(s, deadId) {
  for (const it of s.items) if (it && !it.f && it.maker === deadId && it.k !== 'corpse') return it;
  if (inGrave(s, deadId)) for (const it of s.items) if (it && !it.f && it.k === 'block') return it;
  return null;
}
const tokenStock = (s, deadId) => (tokenItem(s, deadId) ? 1 : 0);
/** Does the colony hold every demanded material now? */
export const demandMet = (s, em) => em.demand.every(([k, m, n]) => stockOf(s, k, m) >= n);
/** The demand card rows: [{ k, m, n, have, ok }] (a token row is k 'token', m the dead colonist's id). */
export const demandCard = (s) => { const em = s.colony.ember; return em ? em.demand.map(([k, m, n]) => ({ k, m, n, have: stockOf(s, k, m), ok: stockOf(s, k, m) >= n })) : []; };
/** Take the demanded materials out of the stores (lowest stack ids first). */
function consumeDemand(s, em) {
  for (const [k, m, n] of em.demand) {
    if (k === 'token') { const it = tokenItem(s, m | 0); if (it) take(s, it.id, 1); continue; }
    let left = n;
    for (let id = 0; id < s.items.length && left > 0; id++) {
      const it = s.items[id];
      if (!it || it.k !== k || (m && it.m !== m) || it.f) continue;
      const b = take(s, id, Math.min(left, it.n));
      if (b) left -= b.n;
    }
  }
}
function spotFor(s, em, col) {
  const b = em.bench !== null ? bldById(s, em.bench) : null;
  const at = b ? standSpot(s, col, footprint(s, b)).i : colTile(col);
  return at >= 0 ? at : colTile(col);
}
function countArtifact(s) { const rec = ensureSeize(s); rec.seizeN = (rec.seizeN | 0) + 1; }
function finish(s, em, col) {
  if (stage2()) ensureSeize(s);   // count the artifacts held before this one (older saves) first
  const kind = em.kind || 'ember';
  if (kind === 'brooding') return finishMemorial(s, em, col);
  if (kind === 'whispered') return finishGrey(s, em, col);
  const i = spotFor(s, em, col);
  const names = (def('text', 'art_name') || { variants: ['Emberwork'] }).variants || ['Emberwork'];
  const name = names[hash3(col.id, em.start, 0xa7) % names.length];
  const q = E.artifactQ[hash3(col.id, s.tick, 0xa8) % E.artifactQ.length];
  const ak = ARTIFACT_KIND[em.skill] || 'figurine';
  const mat = (em.demand.find((d) => d[1]) || [null, null])[1];
  const id = spawnAt(s, ak, mat, q, 1, i, { name, maker: col.id });
  const sk = col.sk[SKILL_IDS.indexOf(em.skill)];
  // (Z2b) a seizure lifts the skill a level, but never to Grandmaster (20): that is earned at the bench (4.2)
  if (sk[0] < 19) { sk[0]++; sk[1] = 0; }
  addThought(s, col, 'ember_made');
  removeThought(col, 'ember_touched');
  addChron(s, 'artifact', 'chron_artifact', { maker: col.name, item: name, kind: ak, colId: col.id });
  emit(s, 'artifact', { itemId: id, colId: col.id, name });
  if (stage2()) countArtifact(s);
  s.colony.ember = null;
  return id;
}
function fail(s, em, col) {
  removeThought(col, 'ember_touched');
  removeThought(col, 'unmade_work');
  if ((em.kind || 'ember') === 'brooding') {
    removeThought(col, 'brooding');
    putKey(ensureSeize(s).melan, [col.id, em.dead]);
    addThought(s, col, 'melancholy');
    addChron(s, 'people', 'chron_melancholy', { name: col.name, dead: deadName(s, em.dead), colId: col.id });
    s.colony.ember = null;
    return;
  }
  addThought(s, col, 'ember_failed');
  const dread = col.need[4] < 20 * FIX;
  startBreakOf(s, col, dread ? 'hollow_whispered' : 'tantrum', 'major');
  if (hash3(col.id, s.tick, 0xaf) % 100 < E.touchedPct) grantTrait(col.traits, 'hollow_touched');
  s.colony.ember = null;
}

// ---- Brooding and Hollow-whispered (3.3) ---------------------------------------------------------------------------
function ensureSeize(s) {
  const rec = ensurePeople(s);
  if (rec.seizeN === undefined) {
    // older saves: count the named artifacts the hold already holds (never memorials or corpses)
    let n = 0;
    for (const it of s.items) if (it && it.name && it.maker !== null && it.maker !== undefined && it.k !== 'corpse' && (it.q | 0) >= 4 && !it.name.includes(', in memory of ')) n++;
    rec.seizeN = n;
  }
  for (const k of ['dreadD', 'melan', 'memo', 'grey']) if (!Array.isArray(rec[k])) rec[k] = [];
  return rec;
}
const deadName = (s, id) => { const d = s.col.find((c) => c.id === id); return d ? String(d.name || '').split(' ')[0] : 'the dead'; };
/** Is there a memorial (a Brooding artifact, or a slab Z2.6 records) to the dead colonist? */
export const memorialFor = (s, deadId) => (peopleRec(s).memo || []).some((m) => m[1] === deadId);
/** Record a memorial to deadId (Z2.6 memorial slabs call this with a key of their own, e.g. 1e6 + bldId). */
export function recordMemorial(s, key, deadId) {
  const rec = ensureSeize(s);
  putKey(rec.memo, [key, deadId]);
  for (const [colId, d] of rec.melan.slice()) {
    if (d !== deadId) continue;
    dropKey(rec.melan, colId);
    const c = s.col.find((x) => x.id === colId);
    if (c) removeThought(c, 'melancholy');
  }
}
/** The dead friend, kin or lover a colonist grieves within `days` (most recent death first), or null. */
export function griefOf(s, col, days = SEIZE.brooding.withinDays) {
  let best = null;
  for (const d of s.col) {
    if (d === col || !d.hp.dead || d.hp.diedT === undefined || s.tick - d.hp.diedT > days * TICKS_PER_DAY) continue;
    const r = relation(s, col.id, d.id);
    if (!r) continue;
    const close = r[1] === 'kin' || r[1] === 'lover' || r[1] === 'spouse' || r[0] >= FRIEND_OP;
    if (close && (!best || d.hp.diedT > best.hp.diedT)) best = d;
  }
  return best;
}
/** Seize a grieving crafter with Brooding (daily trigger or a scripted test). */
export function startBrooding(s, col, dead = griefOf(s, col), skill = emberSkill(col, s, SEIZE.brooding.minLvl)) {
  if (!skill || !dead) return null;
  const B = SEIZE.brooding, table = BROODING_DEMAND[skill] || {};
  const keys = Object.keys(table).sort(), h = hash3(col.id, s.tick, 0xb0);
  const demand = [];
  const n = 1 + (h % 3);
  for (let k = 0; k < keys.length && demand.length < n; k++) {
    const key = keys[(k + (h >>> 4)) % keys.length];
    const [kind, m] = key.split(':');
    demand.push([kind, m || null, table[key]]);
  }
  demand.push(['token', dead.id, B.tokenN]);
  ensurePeople(s).emberLast = s.tick;
  s.colony.ember = { kind: 'brooding', colId: col.id, skill, bench: benchFor(s, col, skill), demand, start: s.tick, deadline: s.tick + B.deadlineDays * TICKS_PER_DAY, met: -1, work: 0, days: 0, dead: dead.id };
  addThought(s, col, 'brooding');
  emit(s, 'emberTouched', { colId: col.id, bId: s.colony.ember.bench });
  return s.colony.ember;
}
function finishMemorial(s, em, col) {
  const i = spotFor(s, em, col);
  const base = MEMORIAL_NAMES[hash3(col.id, em.start, 0xb7) % MEMORIAL_NAMES.length];
  const name = `${base}, in memory of ${deadName(s, em.dead)}`;
  const q = E.artifactQ[hash3(col.id, s.tick, 0xb8) % E.artifactQ.length];
  const ak = MEMORIAL_KIND[em.skill] || 'figurine';
  const mat = (em.demand.find((d) => d[1] && d[0] !== 'token') || [null, null])[1];
  const id = spawnAt(s, ak, mat, q, 1, i, { name, maker: col.id });
  removeThought(col, 'brooding');
  addThought(s, col, 'memorial_made');
  for (const c of s.col) {
    if (c.hp.dead || c === col) continue;
    const r = relation(s, c.id, em.dead);
    if (r && (r[0] >= FRIEND_OP || r[1] === 'kin' || r[1] === 'lover' || r[1] === 'spouse')) addThought(s, c, 'memorial_raised');
  }
  recordMemorial(s, id, em.dead);
  addChron(s, 'artifact', 'chron_memorial', { maker: col.name, item: name, dead: deadName(s, em.dead), kind: ak, colId: col.id });
  emit(s, 'artifact', { itemId: id, colId: col.id, name });
  s.colony.ember = null;
  return id;
}
/** Seize a colonist with Hollow-whispered: they take what they want and start at once. */
export function startWhispered(s, col, skill = emberSkill(col, s, SEIZE.whispered.minLvl)) {
  if (!skill) return null;
  const W_ = SEIZE.whispered, take_ = [];
  for (const k of WHISPER_TAKES) {
    if (take_.length >= W_.takeStacks) break;
    for (const it of s.items) if (it && !it.f && it.k === k && it.n > 0) { take_.push([it.k, it.m || null, Math.min(W_.takeN, it.n)]); break; }
  }
  ensurePeople(s).emberLast = s.tick;
  s.colony.ember = { kind: 'whispered', colId: col.id, skill, bench: benchFor(s, col, skill), demand: take_, start: s.tick, deadline: s.tick + E.deadlineDays * TICKS_PER_DAY, met: -1, work: 0, days: 0 };
  addThought(s, col, 'whispered_work');
  emit(s, 'emberTouched', { colId: col.id, bId: s.colony.ember.bench });
  return s.colony.ember;
}
function finishGrey(s, em, col) {
  const i = spotFor(s, em, col);
  const name = GREY_NAMES[hash3(col.id, em.start, 0xc7) % GREY_NAMES.length];
  const ak = GREY_KIND[em.skill] || 'figurine';
  const mat = (em.demand.find((d) => d[1]) || [null, null])[1];
  const id = spawnAt(s, ak, mat, 5, 1, i, { name, maker: col.id });
  removeThought(col, 'whispered_work');
  addThought(s, col, 'grey_made');
  putKey(ensureSeize(s).grey, [id]);
  countArtifact(s);
  addChron(s, 'artifact', 'chron_grey_artifact', { maker: col.name, item: name, kind: ak, colId: col.id });
  emit(s, 'artifact', { itemId: id, colId: col.id, name });
  s.colony.ember = null;
  return id;
}
/** Hollow-whispered interrupted (drafted, or another break): Grey-raging, an extreme break; no artifact. */
function greyRage(s, em, col) {
  removeThought(col, 'whispered_work');
  s.colony.ember = null;
  col.breakState = null;
  startBreakOf(s, col, 'grey_raging', 'extreme');
  addChron(s, 'people', 'chron_grey_rage', { name: col.name, colId: col.id });
}
/** Every game hour: grey artifacts weigh on those near them (Dread +1, "Something grey is near"). */
function greyHour(s) {
  const g = peopleRec(s).grey;
  if (!g || !g.length) { for (const c of s.col) if (!c.hp.dead && hasThought(c, 'grey_near')) removeThought(c, 'grey_near'); return; }
  const its = [];
  for (const [id] of g) { const it = s.items[id]; if (it && GREY_NAMES.includes(it.name)) its.push(it); }
  if (its.length < g.length) { const rec = ensureSeize(s); rec.grey = g.filter(([id]) => its.some((it) => it.id === id)); }
  const R = SEIZE.greyR;
  for (const c of s.col) {
    if (c.hp.dead) continue;
    const ctx = Math.floor(c.x / 32), cty = Math.floor(c.y / 32);
    const near = its.some((it) => (it.z | 0) === (c.z | 0) && Math.abs(it.x - ctx) <= R && Math.abs(it.y - cty) <= R);
    if (near) { c.need[4] = Math.max(0, c.need[4] - FIX); if (!hasThought(c, 'grey_near')) addThought(s, c, 'grey_near'); }
    else if (hasThought(c, 'grey_near')) removeThought(c, 'grey_near');
  }
}

/** One hourly step of an active seizure (exported for tests). */
export function emberStep(s) {
  const em = s.colony.ember;
  if (!em) return;
  const col = s.col.find((c) => c.id === em.colId);
  if (!col || col.hp.dead) { s.colony.ember = null; return; }
  const kind = em.kind || 'ember';
  if (kind === 'whispered' && em.met >= 0 && (col.drafted || (col.breakState && col.breakState.id !== 'hollow_whispered'))) { greyRage(s, em, col); return; }
  if (em.met < 0 && demandMet(s, em)) { consumeDemand(s, em); em.met = s.tick; }
  if (em.met >= 0) { if (em.work >= (kind === 'brooding' ? SEIZE.brooding.workH : kind === 'whispered' ? SEIZE.whispered.workH : E.workH) * TICKS_PER_HOUR) finish(s, em, col); return; }
  const day = Math.floor((s.tick - em.start) / TICKS_PER_DAY);
  if (day > em.days) { em.days = day; addThought(s, col, 'unmade_work'); }
  if (s.tick >= em.deadline) fail(s, em, col);
}

/** The pace factor (3.3): max(0, 1 + floor(pop / 5) - artifacts made). */
export function paceFactor(s) {
  let pop = 0;
  for (const c of s.col) if (!c.hp.dead) pop++;
  return Math.max(0, 1 + Math.floor(pop / SEIZE.popPer) - (peopleRec(s).seizeN | 0));
}
/** The daily Dread count for Hollow-whispered: consecutive days at Dread >= 60 (light need <= 40). */
function dreadDays(s) {
  const rec = ensureSeize(s), at = SEIZE.whispered.dreadAt * FIX;
  for (const c of s.col) {
    if (c.hp.dead) { dropKey(rec.dreadD, c.id); continue; }
    if (c.need[4] <= at) { const e = getKey(rec.dreadD, c.id); putKey(rec.dreadD, [c.id, e ? e[1] + 1 : 1]); }
    else dropKey(rec.dreadD, c.id);
  }
}
/** Melancholy: kept on until a memorial to the dead stands (daily). */
function melancholyDay(s) {
  const rec = ensureSeize(s);
  for (const [colId, deadId] of rec.melan.slice()) {
    const c = s.col.find((x) => x.id === colId);
    if (!c || c.hp.dead) { dropKey(rec.melan, colId); continue; }
    if (memorialFor(s, deadId)) { dropKey(rec.melan, colId); removeThought(c, 'melancholy'); }
    else if (!hasThought(c, 'melancholy')) addThought(s, c, 'melancholy');
  }
}
/** The daily trigger (3.3): Brooding, then Hollow-whispered, then Ember-touched. Returns the record or null. */
export function seizeDay(s) {
  const rec = peopleRec(s), day = dayOf(s.tick);
  const z2 = stage2();
  if (z2) { dreadDays(s); melancholyDay(s); }
  if (s.colony.ember) return null;
  if (rec.emberLast >= 0 && s.tick - rec.emberLast < E.cooldownDays * TICKS_PER_DAY) return null;
  const pace = z2 ? paceFactor(s) : 1;
  if (z2) {
    for (const col of s.col) {
      if (!able(col)) continue;
      if (!emberSkill(col, s, SEIZE.brooding.minLvl)) continue;
      const dead = griefOf(s, col);
      if (dead && hash3(s.seed >>> 0, col.id, day ^ 0xb00d) % 1000 < SEIZE.brooding.chancePermille) return startBrooding(s, col, dead);
    }
    if (pace > 0) {
      const W_ = SEIZE.whispered, dd = ensureSeize(s).dreadD;
      for (const col of s.col) {
        if (!able(col) || col.drafted || !emberSkill(col, s, W_.minLvl)) continue;
        const e = getKey(dd, col.id);
        const p = e && e[1] >= W_.dreadDays ? W_.chancePermille : col.traits.includes('hollow_touched') ? W_.touchedPermille : 0;
        if (p && hash3(s.seed >>> 0, col.id, day ^ 0x9e7) % 1000 < p * pace) return startWhispered(s, col);
      }
    }
    if (pace <= 0) return null;
  }
  const boost = rec.majorTick >= 0 && s.tick - rec.majorTick <= E.afterMajorDays * TICKS_PER_DAY ? 2 : 1;
  for (const col of s.col) {
    if (!eligible(s, col)) continue;
    if (hash3(s.seed >>> 0, col.id, day) % 1000 < E.chancePermille * boost * pace) { const em = startEmber(s, col); addThought(s, col, 'ember_touched'); return em; }
  }
  return null;
}

/** Tick system (slot 'mood'): the hourly step, the grey artifacts, and the daily trigger. */
export function emberSystem(s) {
  if (!stage2()) return;
  if (s.tick % TICKS_PER_HOUR === 0) { emberStep(s); greyHour(s); }
  if (s.tick % TICKS_PER_DAY !== 0) return;
  seizeDay(s);
}
export const seizuresSystem = emberSystem;

// ---- The work at the bench (needjobs.js calls emberJob from the schedule hook in work hours) -------------
/** The seizure job for the seized colonist now, or null (not them, or nothing to do). */
export function emberJob(s, col) {
  const em = s.colony.ember;
  if (!stage2() || !em || em.colId !== col.id) return null;
  const b = em.bench !== null ? bldById(s, em.bench) : null;
  const st = b ? standSpot(s, col, footprint(s, b)) : null;
  if (em.met < 0) {
    // waiting for the materials: they stand by their bench (or the Hearth) and will not work
    if (st && st.i >= 0) return makeJob('ember', -1, [T.goto(st.i), T.wait(TICKS_PER_HOUR)], { need: true });
    return null;
  }
  if (!st || st.i < 0) return makeJob('ember', -1, [{ t: 'emberWork', n: TICKS_PER_HOUR }], { need: true });
  return { job: makeJob('ember', keyBld(b.id), [T.goto(st.i), { t: 'emberWork', n: TICKS_PER_HOUR }], { need: true }), claims: [[keyBld(b.id), 0]] };
}
registerToil('emberWork', (s, col, job, toil) => {
  const em = s.colony.ember;
  if (!em || em.colId !== col.id) return NEXT;
  em.work++;
  return ++job.work >= toil.n ? NEXT : RUN;
});
