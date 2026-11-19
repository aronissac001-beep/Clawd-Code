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
}

// ---- Squads (Stage 2) ---------------------------------------------------------------------------------------
const DEFAULT_SQUAD_NAMES = Object.freeze(['First Watch', 'Second Watch', 'Third Watch', 'Fourth Watch', 'Fifth Watch', 'Sixth Watch']);
/** Squads that exist: [{ id, name, banner, members }] by id. */
export function squadList(s) {
  return peopleRec(s).squads.map(([id, name, banner]) => ({ id, name, banner, members: squadMembers(s, id) }));
}
/** Put a colonist in squad n (1..MAX_SQUADS) or none (null); creates the squad record. null or a reason. */
export function setSquad(s, col, n) {
  if (n === null || n === undefined) { col.squad = null; return null; }
  if (!Number.isInteger(n) || n < 1 || n > MAX_SQUADS) return `squads are numbered 1 to ${MAX_SQUADS}`;
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
bindBanner(bannerHolds);
