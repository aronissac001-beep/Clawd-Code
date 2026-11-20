// Death, grief, burial and the Husks that rise (doc 4.6, 4.7, 4.8; owner F; Stage 2).
//
//   On a colonist's death (BUS.kill): a corpse item ('corpse', named, maker = the colonist's id) lies
//   where they fell (E's item API), and the living grieve by relation (4.7): lover or spouse "My love
//   is dead" -18, kin -15, friend -12 for 10 days; a rival's death is "My rival is gone" +2.
//   Burial (the 'bury' work giver, Haul, after hauling): a hauler carries a corpse to a finished
//   grave, sarcophagus or crypt (flag 'grave', `cap` dead each) and lays it to rest: the corpse is
//   gone, the grave remembers the name (s.colony.people.graves), the hauler gets "Laid someone to
//   rest" +2 and every friend of the dead "My friend was laid to rest" +2.
//   Rising (4.8): every game hour, each unburied colonist corpse lying on an unlit tile (rt.light 0)
//   adds an hour of darkness (s.colony.people.corpses [[colId, darkTicks]]); after PEOPLE.death.riseDays
//   (2) days of darkness it rises as a Husk on the next night hour. A colonist whose Grey Taint
//   reaches 100 turns at once: dead, no corpse, a Husk where they stood (health.js bindTurn).
//   A risen Husk is a one-member raid on the map (stage 'active', goal 'core', incident id
//   'husk_rising'): H's movement and combat run it like any raid; it carries no tension and no
//   aftermath (that incident has no def). H may register incident logic 'husk_rising' to take over.
//   Everyone near (10 tiles) gets "Saw the dead rise" -10; a turning gives everyone "One of us turned".

import { TICKS_PER_HOUR, TICKS_PER_DAY, phaseOf } from '../core/time.js';
import { W, H, idx, tx, ty, ctrW, tileOfW, clamp } from '../core/grid.js';
import { BUS } from '../core/bus.js';
import { nextId } from '../core/state.js';
import { newFoe, newRaid } from '../core/schema.js';
import { structDef, hasFlag } from '../core/content.js';
import { RUN, NEXT, T, makeJob, registerToil, keyItem, keyBld, isReserved } from '../work/jobs.js';
import { candidates as itemCandidates, spawn as spawnItem, destroy as destroyStack, carried } from '../work/items.js';
import { colTile } from '../work/reserve.js';
import { openTarget, standSpot, reachableFrom, distTo } from '../work/windex.js';
import { footprint } from '../work/construct.js';
import { PEOPLE, stage2 } from './defs.js';
import { addThought, addThoughtAll } from './mood.js';
import { relation, FRIEND_OP, forget } from './social.js';
import { ensurePeople, peopleRec, getKey, putKey, dropKey } from './peoplerec.js';
import { kill, bindTurn } from './health.js';

export const HUSK_INCIDENT = 'husk_rising';
const D = PEOPLE.death;

// ---- Death and grief -----------------------------------------------------------------------------------------
/** BUS.kill: a dead colonist leaves a corpse (unless they turned) and the living grieve. */
export function onColonistKilled(s, victim) {
  if (!stage2() || !victim || !Array.isArray(victim.sk)) return;
  const rec = ensurePeople(s);
  victim.hp.diedT = s.tick;   // for the death-record cap (pruneDead)
  if (!victim.hp.turned) {
    const i = colTile(victim);
    spawnItem(s, 'corpse', null, 0, 1, tx(i), ty(i), { name: victim.name, maker: victim.id });
    putKey(rec.corpses, [victim.id, 0]);
  }
  for (const c of s.col) {
    if (c === victim || c.hp.dead) continue;
    const r = relation(s, c.id, victim.id);
    if (!r) continue;
    const [op, kind] = r;
    if (kind === 'lover' || kind === 'spouse') addThought(s, c, 'lover_died');
    else if (kind === 'kin') addThought(s, c, 'kin_died');
    else if (op >= FRIEND_OP) addThought(s, c, 'friend_died');
    else if (kind === 'rival') addThought(s, c, 'rival_died');
  }
  rec.majorTick = s.tick;
}

/** The corpse stack of a dead colonist, or null (it may be carried, buried or risen). */
export function corpseOf(s, colId) {
  for (const it of s.items) if (it && it.k === 'corpse' && it.maker === colId) return it;
  return null;
}
/** Unburied colonist corpses on the map: [{ colId, it, dark }] in colonist id order. */
export function corpses(s) {
  const out = [];
  for (const [colId, dark] of peopleRec(s).corpses) { const it = corpseOf(s, colId); if (it) out.push({ colId, it, dark }); }
  return out;
}

// ---- Husks ---------------------------------------------------------------------------------------------------
/** A Husk on the map at world (x, y), as a one-member raid. Returns the foe. */
export function raiseHusk(s, x, y) {
  const hp = 40;
  const raid = newRaid(nextId(s, 'raid'), HUSK_INCIDENT, { pts: 20, edge: { i: clamp(tileOfW(y), 0, H - 1) * W + clamp(tileOfW(x), 0, W - 1), side: 'n' }, goal: 'core', stage: 'active' });
  const f = newFoe(nextId(s, 'foe'), 'husk', { raid: raid.id, x, y, hp: { hp, max: hp }, st: { prey: null, bt: null } });
  raid.members.push(f.id);
  s.foes.push(f); s.foes.sort((a, b) => a.id - b.id);
  s.raids.push(raid); s.raids.sort((a, b) => a.id - b.id);
  if (!s.st.live) s.st.live = {};
  s.st.live[String(raid.id)] = { deaths: 0, downed: 0 };
  return f;
}
function sawRise(s, x, y) {
  for (const c of s.col) if (!c.hp.dead && Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) <= 10 * 32) addThought(s, c, 'saw_rise');
}
/** The Grey Taint takes a colonist (health.js): dead without a corpse, a Husk in their place. */
export function turn(s, col) {
  const x = col.x, y = col.y;
  col.hp.turned = true;
  kill(s, col, 'taint', null);
  addThoughtAll(s, 'turned', col.id);
  raiseHusk(s, x, y);
}

// ---- Death records (14.8 J soak: no state growth beyond caps) ------------------------------------
// The dead stay in s.col while they matter: grief, the corpse, burial, the colonist sheet. Past
// KEEP_DEAD dead records, the longest dead whose corpse is gone (buried, risen or never left; not
// carried) and who died at least a day ago leave s.col for good, with their relations (forget).
// The Chronicle death line and the grave keep the name. Every reader of a colonist id already
// treats a missing colonist as gone (colById returns null).
export const KEEP_DEAD = 24;
export function pruneDead(s) {
  let n = 0;
  for (const c of s.col) if (c.hp.dead) n++;
  if (n <= KEEP_DEAD) return 0;
  const rec = peopleRec(s);
  const carriedCorpse = (id) => s.col.some((c) => { const b = carried(c); return b && b.k === 'corpse' && b.maker === id; });
  const old = s.col.filter((c) => c.hp.dead && s.tick - (c.hp.diedT ?? -TICKS_PER_DAY) >= TICKS_PER_DAY
    && !getKey(rec.corpses, c.id) && !corpseOf(s, c.id) && !carriedCorpse(c.id))
    .sort((a, b) => (a.hp.diedT ?? -1) - (b.hp.diedT ?? -1) || a.id - b.id)
    .slice(0, n - KEEP_DEAD);
  for (const c of old) {
    forget(s, c.id);
    s.col.splice(s.col.indexOf(c), 1);
  }
  return old.length;
}

/** Tick system (slot 'social', hourly): darkness on unburied corpses, the dead that rise, and the
 *  death-record cap. */
export function deathSystem(s) {
  if (!stage2() || s.tick % (D.corpseCheckH * TICKS_PER_HOUR) !== 0) return;
  pruneDead(s);
  const rec = s.colony.people;
  if (!rec || !rec.corpses.length) return;
  const night = phaseOf(s.tick) === 'night';
  for (const [colId] of rec.corpses.slice()) {
    const it = corpseOf(s, colId);
    if (!it) {
      // carried right now: keep counting from where it was; gone for good when buried or never found
      const carriedNow = s.col.some((c) => { const b = carried(c); return b && b.k === 'corpse' && b.maker === colId; });
      if (!carriedNow) dropKey(rec.corpses, colId);
      continue;
    }
    const e = getKey(rec.corpses, colId);
    if (s.rt.light[idx(it.x, it.y, it.z | 0)] === 0) e[1] += D.corpseCheckH * TICKS_PER_HOUR;
    if (night && e[1] >= D.riseDays * TICKS_PER_DAY) {
      const x = ctrW(it.x), y = ctrW(it.y);
      destroyStack(s, it.id);
      dropKey(rec.corpses, colId);
      raiseHusk(s, x, y);
      sawRise(s, x, y);
    }
  }
}

// ---- Burial (work giver 'bury', Haul) --------------------------------------------------------------------------
const isGrave = (b) => !!b && b.st === 'done' && hasFlag(structDef(b.def), 'grave');
const capOf = (b) => { const d = structDef(b.def); return (d && d.cap) || 1; };
export const graveNames = (s, bId) => { const e = getKey(peopleRec(s).graves, bId); return e ? e[1] : []; };
const graveFree = (s, b) => isGrave(b) && graveNames(s, b.id).length < capOf(b);
/** The nearest grave with room the colonist can reach: { b, stand } or null. */
function graveFor(s, col) {
  let best = null, bd = Infinity;
  for (const b of s.bld) {
    if (!graveFree(s, b) || isReserved(s, keyBld(b.id), col.id)) continue;
    const st = standSpot(s, col, footprint(s, b));
    if (st.i < 0 || st.d >= bd) continue;
    bd = st.d; best = { b, stand: st.i };
  }
  return best;
}
export const BURY_GIVER = Object.freeze({
  id: 'bury', work: 'haul', order: 3,
  candidates(s, col, k) {
    if (!stage2() || !peopleRec(s).corpses.length) return [];
    const cs = itemCandidates(s, { k: 'corpse', holder: col.id, minN: 1 }, colTile(col), (i) => reachableFrom(s, col, i), k);
    const out = [];
    for (const it of cs) if (it.maker !== null && openTarget(s, col, keyItem(it.id))) out.push({ key: keyItem(it.id), id: it.id, d: distTo(s, col, idx(it.x, it.y, it.z | 0)), plan: null });
    out.sort((p, q) => p.d - q.d || p.key - q.key);
    return out.slice(0, k);
  },
  valid(s, col, t) {
    const it = s.items[t.id];
    if (!it || it.k !== 'corpse') return false;
    const g = graveFor(s, col);
    if (!g) return false;
    const toils = [T.goto(idx(it.x, it.y, it.z | 0)), T.pickup(it.id, 1), T.carry(g.stand), { t: 'bury', b: g.b.id, n: D.buryWork * 10 }];
    t.plan = { job: makeJob('bury', keyItem(it.id), toils), claims: [[keyItem(it.id), 1], [keyBld(g.b.id), 0]] };
    return true;
  },
  make(s, col, t) { return t.plan; },
  keyOf: (t) => t.key,
});
registerToil('bury', (s, col, job, toil) => {
  if (++job.work < toil.n) return RUN;
  const b = s.bld[toil.b], c = carried(col);
  if (!c || c.k !== 'corpse') return NEXT;
  if (!graveFree(s, b)) return 'graveFull';
  const rec = ensurePeople(s);
  const e = getKey(rec.graves, b.id) || putKey(rec.graves, [b.id, []]);
  e[1].push(c.name || 'a colonist');
  const deadId = c.maker;
  job.carry = null;
  dropKey(rec.corpses, deadId);
  addThought(s, col, 'buried_someone');
  for (const o of s.col) {
    if (o.hp.dead || o === col) continue;
    const r = relation(s, o.id, deadId);
    if (r && (r[0] >= FRIEND_OP || r[1] === 'kin' || r[1] === 'lover' || r[1] === 'spouse')) addThought(s, o, 'laid_to_rest');
  }
  return NEXT;
});
/** BUS.removed: a grave that is gone forgets its dead. */
function onRemoved(s, b) { const rec = s.colony.people; if (rec) dropKey(rec.graves, b.id); }

export function installDeath() {
  bindTurn(turn);
  if (!BUS.kill.includes(onColonistKilled)) BUS.kill.push(onColonistKilled);
  if (!BUS.removed.includes(onRemoved)) BUS.removed.push(onRemoved);
  if (!BUS.workGivers.includes(BURY_GIVER)) BUS.workGivers.push(BURY_GIVER);
}
