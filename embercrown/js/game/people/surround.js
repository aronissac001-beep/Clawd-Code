// Room and surroundings thoughts (doc 4.4, 4.5, 4.7, 7.11; owner F; Stage 2).
//
//   surroundings(s, col)  once a game hour per colonist (mood.js, staggered by id): the condition
//     thoughts that follow where they are and who they are with:
//       Ugly / Hideous surroundings, Beautiful / Breathtaking hall    the room's average beauty
//           (B's roomInfo; Beauty-Lovers feel it twice; Ascetics ignore it)
//       The grey blight is near                                          blight within 3 tiles
//       Stone-pressed (Sylvari under rock), Among growing things (Sylvari, 5+ plants within 3),
//       Rock and hearth (Deepforge in a carved room)                     ancestry (4.1)
//       Warmth of the flame (Firekeeper near a lit Hearth or brazier), The Hearth feels too warm
//           (Hollow-Touched), Working in daylight (Night Owl at work by day)      traits (4.3)
//       Doing what I love (a passion skill's work), Missing my craft (a burning passion idle 3 days)
//       Lonely (3 days without a chat; never for Loners), My rival is here, With my love
//       A hold of renown (by prosperity tier), Festering wound, The grey in my veins, Ill, Ember-touched
//     and the timed ones: Saw a corpse (an unburied corpse within 6 tiles), Treasure of the hold (a named
//     artifact in the room).
//   roomThoughtsAfterSleep(s, col, bedId) / roomThoughtsAfterMeal(s, col, tile): the tier thoughts of
//     the bedroom slept in (owner only; Greedy and Ascetic rules; shared bedroom; barracks) and the dining
//     hall eaten in (7.11).

import { TICKS_PER_DAY, phaseOf } from '../core/time.js';
import { W, H, ROOF, idx, tx, ty } from '../core/grid.js';
import { bldById } from '../core/state.js';
import { structDef, hasFlag } from '../core/content.js';
import { colTile } from '../work/reserve.js';
import { curToil } from '../work/jobs.js';
import { isBurning } from '../world/fuel.js';
import { roomInfoAt } from '../world/rooms.js';
import { blightNear } from '../world/blight.js';
import { PEOPLE, traitFlag, stage2 } from './defs.js';
import { addThought, hasThought, removeThought } from './mood.js';
import { peopleRec, getKey } from './peoplerec.js';
import { sinceChat, kindOf } from './social.js';
import { SK } from './skills.js';

function setCond(s, col, id, on) {
  const has = hasThought(col, id);
  if (on && !has) addThought(s, col, id);
  else if (!on && has) removeThought(col, id);
}
const RENOWN = ['hold_renown', 'hold_renown2', 'hold_renown3'];

/** A lit fire (the Hearth, a brazier, a fireplace, a campfire) within r tiles of tile i? */
function fireNear(s, i, r, hearthOnly = false) {
  const x = tx(i), y = ty(i);
  for (const b of s.bld) {
    if (!b || b.st !== 'done') continue;
    if (hearthOnly ? b.def !== 'hearth' : !(b.def === 'hearth' || b.def === 'brazier' || b.def === 'hearthfire' || b.def === 'campfire')) continue;
    if (Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) > r + 1 || !isBurning(s, b)) continue;
    return true;
  }
  return false;
}
function plantsNear(s, i, r) {
  const x = tx(i), y = ty(i);
  let n = 0;
  for (let yy = Math.max(0, y - r); yy <= Math.min(H - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(W - 1, x + r); xx++) if (s.L.plant[yy * W + xx]) n++;
  return n;
}
function corpseNear(s, i, r) {
  const x = tx(i), y = ty(i);
  for (const it of s.items) if (it && it.k === 'corpse' && Math.max(Math.abs(it.x - x), Math.abs(it.y - y)) <= r) return true;
  return false;
}

/** Is a named artifact (an item with a name and a maker) lying in room `id`? */
function artifactIn(s, id) {
  const room = s.rt.room;
  for (const it of s.items) if (it && it.name && it.maker !== null && it.maker !== undefined && room[it.y * W + it.x] === id) return true;
  return false;
}

/** The hourly surroundings thoughts (Stage 2). */
export function surroundings(s, col) {
  if (!stage2()) return;
  const i = colTile(col), info = roomInfoAt(s, i);
  // beauty
  let bAvg = info ? info.beautyAvg : 0;
  if (traitFlag(col, 'beauty.lover')) bAvg *= 2;
  const asc = traitFlag(col, 'thought.ascetic');
  setCond(s, col, 'ugly_near2', !asc && !!info && bAvg <= -3);
  setCond(s, col, 'ugly_near', !asc && !!info && bAvg <= -1 && bAvg > -3);
  setCond(s, col, 'beautiful_near2', !asc && !!info && bAvg >= 5);
  setCond(s, col, 'beautiful_near', !asc && !!info && bAvg >= 2 && bAvg < 5);
  setCond(s, col, 'blight_near', blightNear(s, i, PEOPLE.rooms.blightR) > 0);
  if (corpseNear(s, i, PEOPLE.rooms.corpseR)) addThought(s, col, 'saw_corpse');
  // a named artifact (Ember-touched) standing in this room: "Treasure of the hold" (refreshed hourly)
  if (info && artifactIn(s, s.rt.room[i])) addThought(s, col, 'treasure');
  // ancestry
  const rock = s.L.roof[i] === ROOF.THIN || s.L.roof[i] === ROOF.MOUNTAIN;
  setCond(s, col, 'stone_pressed', col.anc === 'sylvari' && s.L.roof[i] === ROOF.MOUNTAIN && !!info);
  setCond(s, col, 'among_trees', col.anc === 'sylvari' && plantsNear(s, i, 3) >= 5);
  setCond(s, col, 'rock_and_hearth', col.anc === 'deepforge' && rock && !!info);
  // traits
  setCond(s, col, 'near_fire', traitFlag(col, 'mood.firekeeper') && fireNear(s, i, 6));
  setCond(s, col, 'hearth_too_warm', traitFlag(col, 'mood.hearthWarm') && fireNear(s, i, 8, true));
  const t = curToil(col.job);
  const working = !!t && (t.t === 'work' || t.t === 'useBench');
  const ph = phaseOf(s.tick);
  setCond(s, col, 'night_owl_day', traitFlag(col, 'work.nightOwl') && working && (ph === 'day'));
  // passions
  const sk = working && t.sk ? SK[t.sk] : -1;
  setCond(s, col, 'passion_work', sk >= 0 && col.sk[sk][2] > 0);
  let missed = false;
  const pr = peopleRec(s).passion;
  for (let k = 0; k < col.sk.length; k++) {
    if (col.sk[k][2] !== 2) continue;
    const e = getKey(pr, col.id * 32 + k);
    if (s.tick - (e ? e[1] : 0) > 3 * TICKS_PER_DAY) { missed = true; break; }
  }
  setCond(s, col, 'passion_missed', missed);
  // people
  setCond(s, col, 'lonely', !traitFlag(col, 'mood.loner') && sinceChat(s, col) > PEOPLE.joy.lonelyDays * TICKS_PER_DAY);
  let rival = false, lover = false, apart = false;
  const myRoom = s.rt.room[i];
  for (const o of s.col) {
    if (o === col || o.hp.dead) continue;
    const k = kindOf(s, col.id, o.id);
    if (!k) continue;
    if (k === 'spouse' && col.bed !== null && col.bed !== undefined && col.bed !== o.bed) apart = true;
    const near = myRoom ? s.rt.room[colTile(o)] === myRoom : Math.max(Math.abs(o.x - col.x), Math.abs(o.y - col.y)) <= 5 * 32;
    if (!near) continue;
    if (k === 'rival') rival = true;
    if (k === 'lover' || k === 'spouse') lover = true;
  }
  setCond(s, col, 'rival_near', rival);
  setCond(s, col, 'lover_near', lover);
  setCond(s, col, 'spouse_apart', apart);
  // the colony and the body
  const tier = s.colony.tier | 0;
  for (let k = 0; k < RENOWN.length; k++) setCond(s, col, RENOWN[k], k === (tier >= 3 ? 2 : tier === 2 ? 1 : tier === 1 ? 0 : -1));
  setCond(s, col, 'infected', col.hp.wounds.some((w) => (w.infected | 0) > 0));
  setCond(s, col, 'tainted', (col.hp.taint | 0) > 0);
  setCond(s, col, 'ill', !!col.hp.illness);
  setCond(s, col, 'ember_touched', !!s.colony.ember && s.colony.ember.colId === col.id);
}

/** Tier thoughts after a night in bed `bedId` (7.11; Stage 2). */
export function roomThoughtsAfterSleep(s, col, bedId) {
  if (!stage2()) return;
  const b = bldById(s, bedId);
  if (!b) return;
  const info = roomInfoAt(s, idx(b.x, b.y, b.z | 0));
  if (!info) return;
  if (info.role === 'barracks') { if (!col.soldier) addThought(s, col, 'slept_barracks'); return; }
  if (info.role !== 'bedroom') return;
  // shared: beds in the room owned by someone else (lovers sharing are not "shared")
  let shared = false;
  for (const id of info.contents) {
    const o = bldById(s, id);
    if (!o || o.id === b.id || !hasFlag(structDef(o.def), 'bed') || o.owner === null || o.owner === col.id) continue;
    const k = kindOf(s, col.id, o.owner);
    if (k !== 'lover' && k !== 'spouse') shared = true;
  }
  if (shared) addThought(s, col, 'shared_bedroom');
  if (b.owner !== col.id) return;
  const fine = info.tierIdx >= 3;
  if (traitFlag(col, 'thought.ascetic')) { if (fine) addThought(s, col, 'ascetic_room'); return; }
  if (traitFlag(col, 'thought.greedy') && !fine) addThought(s, col, 'greedy_room');
  if (info.tierIdx !== 1) addThought(s, col, `bedroom_t${info.tierIdx}`);
  if (!shared && traitFlag(col, 'mood.loner')) addThought(s, col, 'own_room_alone');
}
/** Dining hall tier thought after a meal at a table on tile i (7.11; Stage 2). */
export function roomThoughtsAfterMeal(s, col, i) {
  if (!stage2() || i < 0) return;
  const info = roomInfoAt(s, i);
  if (!info || info.role !== 'dining') return;
  if (!traitFlag(col, 'thought.ascetic') && info.tierIdx !== 1) addThought(s, col, `dining_t${info.tierIdx}`);
  if (traitFlag(col, 'mood.loner')) {
    let n = 0;
    for (const o of s.col) if (!o.hp.dead && s.rt.room[colTile(o)] === info.id) n++;
    if (n >= PEOPLE.rooms.crowd) addThought(s, col, 'crowded_hall');
  }
}
