// Drafting and squads (doc 9.5): the draft API H's orders use. Owner F. Provisional API.
//
// col.drafted (C2): a drafted colonist has no work job; H's order system (threat/raiders.js and
// systems/engage.js) gives it an order job. col.squad: null or a squad number 1..MAX_SQUADS.
// col.soldier: soldier duty (Soldier role or the soldier command; 8.1).
// Stage 1b: drafting a sleeper wakes them and ends their sleep (or meal, rescue, bed rest) through
// endJob; drafted colonists skip the need jobs (think returns early) and their needs keep falling.
// Stage 2: squad records live in s.colony.people.squads [[id, name, banner]] (peoplerec.js; A please
// add `people` to newColonyRecord): setSquad / nameSquad / squadList. A `squad { colId, squad }`
// command (A, C3) would call setSquad; until then the UI can only show squads made in tests or by
// the soldier role (a new soldier joins squad 1). Craven colonists cannot be drafted under mood 40.

import { registerApplier } from '../core/commands.js';
import { colById } from '../core/state.js';
import { END, requestThink, getMover } from '../work/jobs.js';
import { endJob } from '../work/reserve.js';
import { FIX } from '../core/schema.js';
import { traitFlag, stage2 } from './defs.js';
import { ensurePeople, peopleRec, getKey, putKey, dropKey } from './peoplerec.js';
import { bldById } from '../core/state.js';
import { withGrant } from './perkrules.js';
import { bindBanner } from './breaks.js';

export const MAX_SQUADS = 4, MAX_SQUADS_WAR_ROOM = 6;

/** Can this colonist be drafted now? null when yes, else the reason (shown as a toast). */
export function draftVeto(s, col) {
  if (col.hp.dead) return 'they are dead';
  if (col.hp.down) return 'they are downed';
  if (col.breakState) return 'they are in a break';
  if (stage2() && traitFlag(col, 'break.craven') && col.mood < 40 * FIX) return 'they are too frightened to fight';
  return null;
}

/**
 * Draft or undraft one colonist. Drafting ends the current job through E's single exit (reason
 * 'draft', so claims and carries are released) and stops the path; undrafting queues a think.
 * @returns {null | string} null on success, else the veto reason
 */
export function setDrafted(s, col, on) {
  if (on) {
    if (col.drafted) return null;
    const veto = draftVeto(s, col);
    if (veto) return veto;
    if (col.job) endJob(s, col, END.DRAFT);
    const m = getMover();
    if (m) m.stop(s, col); else col.path = null;
    col.drafted = true;
    return null;
  }
  if (!col.drafted) return null;
  if (col.job) endJob(s, col, END.DRAFT);
  col.drafted = false;
  requestThink(s, col.id);
  return null;
}

/** Ids of colonists who could be drafted now (alive, not downed, not in a break), ascending. */
export function draftableIds(s) { const out = []; for (const c of s.col) if (!draftVeto(s, c)) out.push(c.id); return out.sort((a, b) => a - b); }
/** Undraft everyone (dawn retreat, raid end): they go back to work (or to bed) through a think. */
export function undraftAll(s) { const out = []; for (const c of s.col) if (c.drafted) { setDrafted(s, c, false); out.push(c.id); } return out; }
/**
 * Draft a list of colonists, skipping those with a veto (the threat chip's "Draft all" and the bot's
 * draft on Imminent): drafting wakes a sleeper and ends a meal or a rescue through E's endJob, so
 * reservations and carried items are released. Returns the ids drafted.
 */
export function draftMany(s, ids) { const out = []; for (const id of ids) { const c = colById(s, id); if (c && setDrafted(s, c, true) === null && c.drafted) out.push(c.id); } return out; }

/** Ids of drafted colonists, ascending. */
export function draftedIds(s) { const out = []; for (const c of s.col) if (c.drafted) out.push(c.id); return out.sort((a, b) => a - b); }
/** Members of a squad, ascending ids. */
export function squadMembers(s, squad) { const out = []; for (const c of s.col) if (c.squad === squad) out.push(c.id); return out.sort((a, b) => a - b); }
/** The squad leader: the lowest id among able members (followers keep formation offsets, 9.5). */
export function squadLeader(s, squad) {
  for (const id of squadMembers(s, squad)) { const c = colById(s, id); if (c && !c.hp.down && !c.hp.dead) return c; }
  return null;
}
/** Draft every soldier ("Draft all soldiers" on the threat chip). Returns the drafted ids. */
export function draftSoldiers(s) {
  const out = [];
  for (const c of s.col) if (c.soldier && setDrafted(s, c, true) === null && c.drafted) out.push(c.id);
  return out;
}

/** Command applier (C3): draft { colIds, on }. All or nothing: any veto rejects the command. */
export function installDraftCommands() {
  registerApplier('draft', (s, c) => {
    if (c.on) for (const id of c.colIds) { const v = draftVeto(s, colById(s, id)); if (v) return { ok: false, reason: v }; }
    for (const id of c.colIds) setDrafted(s, colById(s, id), c.on);
    return { ok: true };
  });
  installMilitary();
}

// ---- Squads (Stage 2) ---------------------------------------------------------------------------------------
const DEFAULT_SQUAD_NAMES = Object.freeze(['First Watch', 'Second Watch', 'Third Watch', 'Fourth Watch', 'Fifth Watch', 'Sixth Watch']);
/** Squads that exist: [{ id, name, banner, members }] by id. */
export function squadList(s) {
  return peopleRec(s).squads.map(([id, name, banner]) => ({ id, name, banner, members: squadMembers(s, id) }));
}
/** Put a colonist in squad n (1..MAX_SQUADS) or none (null); creates the squad record. null or a reason. */
export function setSquad(s, col, n) {
  if (n === null || n === undefined) { if (s.colony.mil) leaveSquad(s, col); col.squad = null; return null; }
  if (!Number.isInteger(n) || n < 1 || n > maxSquads(s)) return `squads are numbered 1 to ${maxSquads(s)}`;
  if (col.squad !== n && s.colony.mil) leaveSquad(s, col);
  const rec = ensurePeople(s);
  if (!getKey(rec.squads, n)) putKey(rec.squads, [n, DEFAULT_SQUAD_NAMES[n - 1], null]);
  col.squad = n;
  return null;
}
export function nameSquad(s, n, name) { const e = getKey(ensurePeople(s).squads, n); if (!e) return 'no such squad'; e[1] = String(name).slice(0, 24); return null; }
/** Drop squad records nobody is in (called daily by the people install). */
export function pruneSquads(s) {
  const rec = s.colony.people;
  if (!rec) return;
  for (const [id] of rec.squads.slice()) if (!squadMembers(s, id).length) dropKey(rec.squads, id);
}
/** A new soldier (role or duty) with no squad joins squad 1. */
export function soldierSquad(s, col) { if (stage2() && col.soldier && (col.squad === null || col.squad === undefined)) setSquad(s, col, 1); }

// ---- Squad banners (Banner-maker, Tailoring 15; doc 8.1) -------------------------------------------------
export const BANNER_R = 8;
const isBanner = (b) => !!b && b.def === 'banner' && (b.st === undefined || b.st === 'done');
/**
 * Give squad n its banner: a finished Banner (G's civic 'banner') sewn by the colony's Banner-maker
 * (a living colonist with the perk). null or the reason. The UI or a `squad` command (A) calls it.
 */
export function setSquadBanner(s, n, bId) {
  const e = getKey(ensurePeople(s).squads, n);
  if (!e) return 'no such squad';
  if (bId === null || bId === undefined) { e[2] = null; return null; }
  if (!isBanner(bldById(s, bId))) return 'that is not a finished banner';
  if (!withGrant(s, 'banner_maker').length) return 'needs a Banner-maker (Tailoring 15)';
  e[2] = bId;
  return null;
}
/** Is this colonist within BANNER_R tiles of their squad's standing banner? (no breaks; H: no fleeing) */
export function bannerHolds(s, col) {
  if (!col || !col.squad) return false;
  const e = getKey(peopleRec(s).squads, col.squad);
  if (!e || e[2] === null || e[2] === undefined) return false;
  const b = bldById(s, e[2]);
  if (!isBanner(b)) return false;
  const R = BANNER_R * 32, bx = b.x * 32 + 16, by = b.y * 32 + 16;
  return Math.abs(col.x - bx) <= R && Math.abs(col.y - by) <= R;
}
// Drilled (3.8): a drafted member of a Drilled squad holds formation and does not break or flee either.
bindBanner((s, col) => bannerHolds(s, col) || (!!col.drafted && colDrilled(s, col)));

// ---- Military (EMBERCROWN-FORTRESS.md 3.8; Stage Z2.5) -------------------------------------------------------
//
// s.colony.mil (plain JSON, saved with the colony record like s.colony.people; absent until the first
// military command, so an untouched hold is byte-identical to Z1 and old saves need no migration):
//   { v: 1, alert: 'peace'|'muster'|'shelter', by: null|'marshal' (who raised it),
//     sq: [[squadId, uniform, sched, order, drill, drillDay]] sorted by squad id, where
//       uniform  { weapon, helm, body, legs, shield }: each null (not part of it) or [kind|'any', minQ, mat|null]
//       sched    [n0, n1, n2, n3]: train n days in 10, per season (0: no training)
//       order    null | { kind: 'station'|'patrol'|'defendRefuge'|'guard'|'move', pts: [voxel], seq }
//       drill    [absSeason, drillsThisSeason, drillsLastSeason]; drillDay: the last day it drilled (-1)
//     called: [colId] drafted by the military (on duty), shel: [colId] civilians sent to a Refuge,
//     trn: [colId] drafted to drill, away: [colId] released to eat or sleep, seq: order counter }
// The system (slot 'social', every MIL.every ticks) drafts squads on duty (Muster, Shelter or a standing
// order), sends each to fetch its missing uniform pieces from armoury racks first, then walks it to its
// squad's order (formation tiles), loops patrols, sends civilians to the Refuge on Shelter, drafts
// squads to drill on their schedule's days during their work hours, and counts drills. A member with an
// order the player gave it directly (job.by 'p', orders.js) is left alone until that order ends.
import { def } from '../core/content.js';
import { idx as vidx, W as GW, PLANE as GPLANE } from '../core/grid.js';
import { dayOf, seasonOf, yearOf, hourOf } from '../core/time.js';
import { SCHED } from '../core/schema.js';
import { candidates as itemCands, storeBldAt } from '../work/items.js';
import { reachableFrom } from '../work/windex.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { slotOf } from '../work/outfit.js';
import { milOrder, equipOrder, trainOrder, formationTile, shelterTile, bindSquadOrder, refugeDoors } from '../threat/orders.js';

export const ALERTS = Object.freeze(['peace', 'muster', 'shelter']);
/** Uniform slots (3.8) and the gear slots (outfit.js) each may fill. */
export const UNIFORM_SLOTS = Object.freeze({ weapon: ['weapon'], helm: ['head'], body: ['body', 'outer'], legs: ['feet'], shield: ['hands'] });
export const UNIFORM_KEYS = Object.freeze(Object.keys(UNIFORM_SLOTS));
const SLOT_NAMES = Object.freeze({ weapon: ['weapon', 'weapons'], helm: ['helm', 'helms'], body: ['body armour', 'body armours'], legs: ['boots', 'boots'], shield: ['shield', 'shields'] });
export const MIL = Object.freeze({ every: 20, drilledAt: 3, drillTicks: 600, patrolWait: 120, needLow: 20, needOk: 60, foeNearTiles: 8 });
export const DEFAULT_UNIFORM = () => ({ weapon: ['any', 0, null], helm: null, body: null, legs: null, shield: null });
const DRILL_DEFS = ['trainingyard'];
const STANDING = ['station', 'patrol', 'defendRefuge', 'guard', 'move'];

export function newMilRec() { return { v: 1, alert: 'peace', by: null, sq: [], called: [], shel: [], trn: [], away: [], seq: 0 }; }
const MIL_EMPTY = Object.freeze(newMilRec());
export const milRec = (s) => (s && s.colony && s.colony.mil) || MIL_EMPTY;
export function ensureMil(s) {
  if (!s.colony.mil) s.colony.mil = newMilRec();
  const m = s.colony.mil;
  for (const k of Object.keys(MIL_EMPTY)) if (!(k in m)) m[k] = Array.isArray(MIL_EMPTY[k]) ? [] : MIL_EMPTY[k];
  return m;
}
/** The military entry of squad n (created on demand when `make`). */
export function squadMil(s, n, make = false) {
  const e = getKey(milRec(s).sq, n);
  if (e || !make) return e;
  return putKey(ensureMil(s).sq, [n, DEFAULT_UNIFORM(), [0, 0, 0, 0], null, [-1, 0, 0], -1]);
}
const addId = (a, id) => { if (!a.includes(id)) { a.push(id); a.sort((x, y) => x - y); } };
const dropId = (a, id) => { const k = a.indexOf(id); if (k >= 0) a.splice(k, 1); return k >= 0; };

/** Squads allowed now: 4, or 6 with a War Room (a finished 'warroom' building, once G adds it). */
export function maxSquads(s) { for (const b of s.bld) if (b && b.def === 'warroom' && (b.st === undefined || b.st === 'done')) return MAX_SQUADS_WAR_ROOM; return MAX_SQUADS; }

/** The Marshal's colonist id (K's s.colony.offices { officeId: colId }), or null: training needs one (3.8). */
export function marshalOf(s) {
  const o = s.colony.offices;
  const id = o ? o.marshal : null;
  const c = id === null || id === undefined ? null : colById(s, id);
  return c && !c.hp.dead ? c.id : null;
}

// ---- Uniforms -----------------------------------------------------------------------------------------------
function anyFits(k, key) {
  const d = def('item', k), sl = slotOf(k);
  if (!d || !sl || !UNIFORM_SLOTS[key].includes(sl)) return false;
  return key === 'weapon' || d.cat === 'armour' || (!!d.wear && (d.wear.armour | 0) >= 10);
}
/** Does worn or stored piece b meet uniform spec [k, q, m] for slot key? */
export function pieceFits(b, spec, key) {
  if (!b || !spec) return false;
  const k = typeof b === 'object' ? b.k : b;
  if (spec[0] === 'any' ? !anyFits(k, key) : k !== spec[0]) return false;
  if (((b.q | 0)) < (spec[1] | 0)) return false;
  return !spec[2] || b.m === spec[2];
}
/** Is col's uniform slot `key` met by what it wears? */
export function slotMet(col, key, spec) {
  if (!spec) return true;
  const sl = col.gear && col.gear.slots;
  if (!sl) return false;
  for (const g of UNIFORM_SLOTS[key]) if (pieceFits(sl[g], spec, key)) return true;
  return false;
}
export const uniformOf = (s, n) => { const e = squadMil(s, n); return e ? e[1] : DEFAULT_UNIFORM(); };
/** The unmet uniform slots of col (in UNIFORM_KEYS order). */
export function missingSlots(s, col) {
  if (!col.squad) return [];
  const u = uniformOf(s, col.squad);
  return UNIFORM_KEYS.filter((k) => !slotMet(col, k, u[k]));
}
const CATS = { weapon: ['weapons'], helm: ['armour', 'apparel'], body: ['armour', 'apparel'], legs: ['armour', 'apparel'], shield: ['armour'] };
const isRack = (s, i) => { const b = storeBldAt(s, i); return !!b && b.def === 'weaponrack'; };
/** The nearest stored piece col may take for slot key: armoury racks first, then any reachable stack. */
export function findPiece(s, col, key, spec) {
  const from = vidx(Math.max(0, Math.min(GW - 1, (col.x / 32) | 0)), Math.max(0, ((col.y / 32) | 0)), col.z | 0);
  const out = [];
  const filters = spec[0] === 'any' ? CATS[key].map((cat) => ({ cat, holder: col.id, minN: 1 })) : [{ k: spec[0], holder: col.id, minN: 1 }];
  for (const f of filters) {
    if (spec[1]) f.q = [spec[1] | 0, 6];
    if (spec[2]) f.m = spec[2];
    for (const it of itemCands(s, f, from, null, 12)) {
      if (!pieceFits(it, spec, key)) continue;
      const i = vidx(it.x, it.y, it.z | 0), rack = isRack(s, i);
      if (!rack && !storeBldAt(s, i) && !reachableFrom(s, col, i)) continue;
      out.push([rack ? 0 : 1, (it.x - (from % GW)) ** 2 + (it.y - (((from % GPLANE) / GW) | 0)) ** 2 + 4 * ((it.z | 0) - (col.z | 0)) ** 2, it.id, it, !!storeBldAt(s, i)]);
    }
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return out.length ? { it: out[0][3], adj: out[0][4] } : null;
}
/**
 * Uniform pieces the squads lack (3.8): [{ squad, slot, n, kind, text }] where n members miss the slot
 * and no stored piece is free for them. The Marshal's alert ("Squad 2 lacks 3 helms") and the Steward's
 * stock target (K, offices.js) read this.
 */
export function uniformShortfall(s) {
  const out = [];
  for (const sq of squadList(s)) {
    const u = uniformOf(s, sq.id);
    for (const key of UNIFORM_KEYS) {
      if (!u[key]) continue;
      let n = 0;
      for (const id of sq.members) { const c = colById(s, id); if (c && !c.hp.dead && !slotMet(c, key, u[key]) && !findPiece(s, c, key, u[key])) n++; }
      if (n) {
        const kind = u[key][0], nm = kind === 'any' ? SLOT_NAMES[key] : [(def('item', kind) || { name: kind }).name.toLowerCase(), (def('item', kind) || { name: kind }).name.toLowerCase() + 's'];
        out.push({ squad: sq.id, slot: key, n, kind, text: `${sq.name} lacks ${n} ${n === 1 ? nm[0] : nm[1]}` });
      }
    }
  }
  return out;
}
/** Steward stock targets from the uniforms: [{ k, n }] by kind (named kinds only), ascending k. */
export function uniformStockTargets(s) {
  const m = new Map();
  for (const r of uniformShortfall(s)) if (r.kind !== 'any') m.set(r.kind, (m.get(r.kind) || 0) + r.n);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, n]) => ({ k, n }));
}

// ---- Training and Drilled ---------------------------------------------------------------------------------
const absSeason = (tick) => yearOf(tick) * 4 + seasonOf(tick);
function rollDrill(e, tick) {
  const a = absSeason(tick), d = e[4];
  if (d[0] === a) return d;
  e[4] = [a, 0, d[0] === a - 1 ? d[1] : 0];
  return e[4];
}
/** Drilled (3.8): drilled MIL.drilledAt times this season or the last one. */
export function squadDrilled(s, n) {
  const e = squadMil(s, n);
  if (!e) return false;
  const a = absSeason(s.tick), d = e[4];
  return (d[0] === a && (d[1] >= MIL.drilledAt || d[2] >= MIL.drilledAt)) || (d[0] === a - 1 && d[1] >= MIL.drilledAt);
}
export const colDrilled = (s, col) => !!col && !!col.squad && squadDrilled(s, col.squad);
/** Drills this season of squad n. */
export function drillsThisSeason(s, n) { const e = squadMil(s, n); if (!e) return 0; const d = e[4]; return d[0] === absSeason(s.tick) ? d[1] : 0; }
/** Is today a training day of squad n (its schedule spreads n days evenly over each 10)? */
export function trainingDay(s, n) {
  const e = squadMil(s, n);
  if (!e) return false;
  const k = e[2][seasonOf(s.tick)] | 0;
  if (k <= 0) return false;
  const d = dayOf(s.tick) % 10;
  return Math.floor(((d + 1) * k) / 10) > Math.floor((d * k) / 10);
}
/** The finished drill site: a training yard, or a barracks with a Drill post add-on beside it (Z2.4). */
export function drillSite(s) {
  let best = null;
  for (const b of s.bld) {
    if (!b || (b.st !== undefined && b.st !== 'done')) continue;
    if (DRILL_DEFS.includes(b.def)) return b;
    if (!best && b.def === 'barracks' && s.bld.some((p) => p && p.def === 'drillpost' && (p.st === undefined || p.st === 'done') && (p.z | 0) === (b.z | 0) && Math.abs(p.x - b.x) <= 5 && Math.abs(p.y - b.y) <= 5)) best = b;
  }
  return best;
}

// ---- Where the squad goes -----------------------------------------------------------------------------------
const xyzOf = (i) => { const z = (i / GPLANE) | 0, p = i - z * GPLANE; return { x: p % GW, y: (p / GW) | 0, z }; };
/** The muster point: a barracks, else a drill site, else beside the Hearth (formation around it). */
export function musterPoint(s) {
  let b = null;
  for (const x of s.bld) if (x && x.def === 'barracks' && (x.st === undefined || x.st === 'done')) { b = x; break; }
  if (!b) b = drillSite(s);
  if (b) { const d = def('structure', b.def), sz = (d && d.size) || [1, 1]; return { x: b.x + (sz[0] >> 1), y: b.y + sz[1], z: b.z | 0 }; }
  return shelterTile(s);
}
/** The tile member k of squad sq should go to now and the order kind: { kind, t, key } or null. */
function wantFor(s, e, k, col) {
  const o = e ? e[3] : null;
  if (o && o.kind === 'patrol') {
    const j = col.job;
    const leg = j && j.type === 'order' && j.by === 'mil' && j.seq === o.seq && j.order === 'patrol' ? j.leg : 0;
    const p = xyzOf(o.pts[leg % o.pts.length]);
    return { kind: 'patrol', t: formationTile(s, p.x, p.y, k, p.z), key: `p${o.seq}:${leg}`, leg, seq: o.seq };
  }
  if (o && o.kind === 'defendRefuge') {
    const doors = refugeDoors(s);
    const p = doors.length ? doors[k % doors.length] : shelterTile(s);
    if (!p) return null;
    return { kind: 'guard', t: formationTile(s, p.x, p.y, doors.length ? Math.floor(k / doors.length) : k, p.z | 0), key: `r${o.seq}`, seq: o.seq };
  }
  if (o && o.pts && o.pts.length) {
    const p = xyzOf(o.pts[0]);
    return { kind: o.kind === 'guard' ? 'guard' : 'station', t: formationTile(s, p.x, p.y, k, p.z), key: `s${o.seq}`, seq: o.seq };
  }
  const m = musterPoint(s);
  return m ? { kind: 'guard', t: formationTile(s, m.x, m.y, k, m.z | 0), key: 'm', seq: -1 } : null;
}
const onTile = (col, t) => !!t && ((col.x / 32) | 0) === t.x && ((col.y / 32) | 0) === t.y && (col.z | 0) === (t.z | 0);
const standingJ = (j) => { const t = j && j.toils[j.i]; return !!t && t.t === 'stand'; };
function foeNear(s, col) {
  if (!s.foes || !s.foes.length) return false;
  const R = MIL.foeNearTiles * 32;
  for (const f of s.foes) if (f && !(f.st && f.st.down) && (f.z | 0) === (col.z | 0) && Math.abs(f.x - col.x) <= R && Math.abs(f.y - col.y) <= R) return true;
  return false;
}
const needsLow = (c) => c.need[0] < MIL.needLow * FIX || c.need[1] < MIL.needLow * FIX;
const needsOk = (c) => c.need[0] >= MIL.needOk * FIX && c.need[1] >= MIL.needOk * FIX;
const able = (c) => !c.hp.dead && !c.hp.down && !c.breakState;

/** Direct one on-duty drafted member (k: its place in the squad). */
function direct(s, col, e, k, equip = true) {
  const j = col.job;
  if (j && j.type === 'order' && j.by === 'p') return;                       // the player's own order
  if (j && j.type === 'order' && j.by === 'mil' && (j.order === 'equip' || j.order === 'train') && !standingJ(j)) return;
  if (equip && !foeNear(s, col)) {
    const u = uniformOf(s, col.squad);
    for (const key of UNIFORM_KEYS) {
      if (!u[key] || slotMet(col, key, u[key])) continue;
      const p = findPiece(s, col, key, u[key]);
      if (p && equipOrder(s, col, p.it, p.adj)) return;
    }
  }
  const w = wantFor(s, e, k, col);
  if (!w) return;
  if (j && j.type === 'order' && j.by === 'mil' && j.mk === w.key) {
    if (w.kind === 'patrol' && standingJ(j)) {
      if (j.arr === undefined || j.arr === null) j.arr = s.tick;
      else if (s.tick - j.arr >= MIL.patrolWait) {
        const o = e[3], leg = (j.leg + 1) % o.pts.length, p = xyzOf(o.pts[leg]);
        milOrder(s, col, 'patrol', formationTile(s, p.x, p.y, k, p.z), { mk: `p${o.seq}:${leg}`, leg, seq: o.seq });
      }
    }
    return;
  }
  if (j && j.type === 'order' && j.by === 'mil' && onTile(col, w.t) && j.mk === w.key) return;
  milOrder(s, col, w.kind, w.t, { mk: w.key, leg: w.leg | 0, seq: w.seq });
}

/** The military tick (slot 'social'). Does nothing in a hold with no military record. */
export function militarySystem(s) {
  const m = s.colony && s.colony.mil;
  if (!m || s.tick % MIL.every !== 0) return;
  marshalAlert(s, m);
  const peace = m.alert === 'peace';
  // members leave lists when they die or leave their squad
  for (const L of [m.called, m.trn, m.away]) for (const id of L.slice()) { const c = colById(s, id); if (!c || c.hp.dead || (!c.squad && L !== m.away)) { if (c && c.drafted && L !== m.away) setDrafted(s, c, false); dropId(L, id); } }
  for (const id of m.away.slice()) { const c = colById(s, id); if (!c || c.hp.dead || needsOk(c) || (peace && !m.called.includes(id) && !m.shel.includes(id))) dropId(m.away, id); }
  // squads on duty
  const squads = squadList(s);
  for (const sq of squads) {
    const e = squadMil(s, sq.id);
    const standing = !!(e && e[3]);
    const duty = !peace || standing;
    const ids = sq.members.filter((id) => { const c = colById(s, id); return c && able(c) && !m.away.includes(id); });
    // training (peace, no standing order, a schedule day, the Marshal, a drill site, work hours)
    const site = !duty && e && trainingDay(s, sq.id) && marshalOf(s) !== null ? drillSite(s) : null;
    let drilled = false;
    ids.forEach((id, k) => {
      const c = colById(s, id);
      if (duty) {
        if (m.trn.includes(id)) dropId(m.trn, id);
        if (needsLow(c) && (peace || !foeNear(s, c))) { if (c.drafted && m.called.includes(id)) setDrafted(s, c, false); dropId(m.called, id); addId(m.away, id); return; }
        if (!c.drafted) { if (setDrafted(s, c, true) !== null) return; addId(m.called, id); }
        else if (!m.called.includes(id) && !(c.job && c.job.by === 'p')) addId(m.called, id);
        if (m.called.includes(id)) direct(s, c, e, k);
        return;
      }
      if (m.called.includes(id)) { if (c.drafted) setDrafted(s, c, false); dropId(m.called, id); }
      const work = site && c.sched[hourOf(s.tick)] === SCHED.WORK && !needsLow(c);
      if (work) {
        if (!c.drafted) { if (setDrafted(s, c, true) !== null) return; addId(m.trn, id); }
        if (!m.trn.includes(id)) return;                                        // drafted by the player
        const j = c.job;
        if (!(j && j.type === 'order' && j.order === 'train')) {
          const d = def('structure', site.def), sz = (d && d.size) || [1, 1];
          const ranged = (() => { const w = c.gear && c.gear.slots && c.gear.slots.weapon; const wd = w ? def('item', typeof w === 'object' ? w.k : w) : null; return !!(wd && wd.weapon && (wd.weapon.reach | 0) >= 30); })();
          trainOrder(s, c, formationTile(s, site.x + (sz[0] >> 1), site.y + (sz[1] >> 1), k, site.z | 0), ranged ? 'archery' : 'melee');
        } else if ((j.dr | 0) >= MIL.drillTicks) drilled = true;
      } else if (m.trn.includes(id)) { if (c.drafted) setDrafted(s, c, false); dropId(m.trn, id); }
    });
    if (drilled && e) { const d = rollDrill(e, s.tick); if (e[5] !== dayOf(s.tick)) { e[5] = dayOf(s.tick); d[1]++; } }
  }
  // Shelter: civilians go to the Refuge and stay until Peace (released to eat or sleep when low)
  if (m.alert === 'shelter') {
    const t = shelterTile(s);
    let k = 0;
    for (const c of s.col) {
      if (c.squad || c.soldier || !able(c) || m.away.includes(c.id)) continue;
      if (needsLow(c)) { if (m.shel.includes(c.id)) { if (c.drafted) setDrafted(s, c, false); dropId(m.shel, c.id); } addId(m.away, c.id); continue; }
      if (!c.drafted) { if (setDrafted(s, c, true) !== null) continue; addId(m.shel, c.id); }
      if (!m.shel.includes(c.id)) continue;
      const j = c.job;
      if (t && !(j && j.type === 'order' && j.mk === 'shel')) milOrder(s, c, 'retreat', formationTile(s, t.x, t.y, k, t.z | 0), { mk: 'shel' });
      k++;
    }
  } else if (m.shel.length) {
    for (const id of m.shel.slice()) { const c = colById(s, id); if (c && c.drafted) setDrafted(s, c, false); dropId(m.shel, id); }
  }
}
/** The Marshal raises Muster when a raid is in the vale and stands the hold down after it (3.8). */
function marshalAlert(s, m) {
  if (!marshalOf(s)) return;
  const live = (s.raids || []).some((r) => r && (r.stage === 'active' || r.stage === 'sighted'));
  if (live && m.alert === 'peace') { m.alert = 'muster'; m.by = 'marshal'; }
  else if (!live && m.by === 'marshal') { m.alert = 'peace'; m.by = null; }
}

/** Set the alert level (the `alert` command; the threat chip). */
export function setAlert(s, level) {
  if (!ALERTS.includes(level)) return `alert must be one of ${ALERTS.join(', ')}`;
  const m = ensureMil(s);
  m.alert = level; m.by = null;
  return null;
}
export const alertLevel = (s) => milRec(s).alert;

/** The `squad { id, uniform?, sched?, name?, add?, remove? }` command (C3 v3). */
export function squadCmd(s, c) {
  const n = c.id;
  if (!Number.isInteger(n) || n < 1 || n > maxSquads(s)) return { ok: false, reason: `squads are numbered 1 to ${maxSquads(s)}` };
  for (const id of c.add || []) { const col = colById(s, id); if (!col) return { ok: false, reason: 'no such colonist' }; }
  for (const id of c.add || []) { const col = colById(s, id); const r = setSquad(s, col, n); if (r) return { ok: false, reason: r }; }
  for (const id of c.remove || []) { const col = colById(s, id); if (col && col.squad === n) leaveSquad(s, col); }
  const rec = ensurePeople(s);
  if (!getKey(rec.squads, n)) putKey(rec.squads, [n, DEFAULT_SQUAD_NAMES[n - 1], null]);
  if (c.name !== undefined && c.name !== null) nameSquad(s, n, c.name);
  const e = squadMil(s, n, true);
  if (c.uniform) {
    const u = { ...e[1] };
    for (const key of UNIFORM_KEYS) {
      if (!(key in c.uniform)) continue;
      const v = c.uniform[key];
      if (v === null) { u[key] = null; continue; }
      const k = Array.isArray(v) ? v[0] : v && v.k;
      if (k !== 'any' && !(def('item', k) && UNIFORM_SLOTS[key].includes(slotOf(k)))) return { ok: false, reason: `${k} does not go in the ${key} slot` };
      const q = Array.isArray(v) ? v[1] | 0 : (v.q | 0), mat = Array.isArray(v) ? v[2] || null : v.m || null;
      u[key] = [k, Math.max(0, Math.min(5, q)), mat];
    }
    e[1] = u;
  }
  if (c.sched !== undefined && c.sched !== null) {
    const a = Array.isArray(c.sched) ? c.sched : [c.sched, c.sched, c.sched, c.sched];
    if (a.length !== 4 || a.some((x) => !Number.isInteger(x) || x < 0 || x > 10)) return { ok: false, reason: 'train 0 to 10 days in 10, per season' };
    e[2] = a.slice();
  }
  return { ok: true };
}
/** Leave the squad: off duty, out of the military lists. */
export function leaveSquad(s, col) {
  const m = s.colony.mil;
  if (m) for (const L of [m.called, m.trn]) if (dropId(L, col.id) && col.drafted) setDrafted(s, col, false);
  col.squad = null;
}

/** A squad order (the `order` command with `squad`): standing kinds are kept; hold clears the standing order. */
export function squadOrderCmd(s, c) {
  const n = c.squad;
  if (!getKey(peopleRec(s).squads, n)) return { ok: false, reason: 'no such squad' };
  const pts = c.pts || (c.target && !('id' in c.target) ? [vidx(c.target.x, c.target.y, c.target.z | 0)] : []);
  if (c.kind === 'patrol' && (pts.length < 2 || pts.length > 4)) return { ok: false, reason: 'a patrol needs 2 to 4 points' };
  if ((c.kind === 'station' || c.kind === 'move' || c.kind === 'guard') && pts.length < 1) return { ok: false, reason: 'needs a point' };
  if (c.kind === 'attack') return { ok: false, reason: 'order an attack on its members' };
  const m = ensureMil(s), e = squadMil(s, n, true);
  if (c.kind === 'hold' || c.kind === 'retreat' || c.kind === 'sally') {
    e[3] = null;
    for (const id of squadMembers(s, n)) { const col = colById(s, id); if (col && col.drafted && !(col.job && col.job.by === 'p')) giveOrderHold(s, col); }
    return { ok: true };
  }
  if (!STANDING.includes(c.kind)) return { ok: false, reason: `unknown order ${c.kind}` };
  e[3] = { kind: c.kind, pts: pts.slice(0, 4), seq: ++m.seq };
  // the squad follows its new order: drop what the player told its members one by one
  for (const id of squadMembers(s, n)) { const col = colById(s, id); if (col && col.job && col.job.by === 'p') col.job.by = 'mil'; }
  return { ok: true };
}
import { holdHere as giveOrderHold } from '../threat/orders.js';

let milOn = false;
/** Register the military system and the squad/alert appliers (idempotent; installDraftCommands calls it). */
export function installMilitary() {
  if (!tickSystems().some((x) => x.slot === 'social' && x.name === 'military')) registerSystem('social', 'military', militarySystem, 25);
  bindSquadOrder(squadOrderCmd);
  for (const [name, fn] of [['squad', squadCmd], ['alert', (s, c) => { const r = setAlert(s, c.level); return r ? { ok: false, reason: r } : { ok: true }; }]]) {
    try { registerApplier(name, fn); } catch { /* A has not added the command to C3 yet */ }
  }
  milOn = true;
}
export const militaryInstalled = () => milOn;
