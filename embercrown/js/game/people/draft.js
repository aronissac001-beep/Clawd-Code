// Drafting and squads (doc 9.5): the draft API H's orders use. Owner F. Provisional API.
//
// col.drafted (C2): a drafted colonist has no work job; H's order system (threat/raiders.js and
// systems/engage.js) gives it an order job. col.squad: null or a squad number 1..MAX_SQUADS.
// col.soldier: soldier duty (Soldier role or the soldier command; 8.1).
// Stage 1b: drafting a sleeper wakes them and ends their sleep (or meal, rescue, bed rest) through
// endJob; drafted colonists skip the need jobs (think returns early) and their needs keep falling.
// Squad records (colour, banner, rally point) need a saved home: requested as an addition to
// s.colony (owner A, C2-full) for Stage 2; until then a squad is only the number on its members.

import { registerApplier } from '../core/commands.js';
import { colById } from '../core/state.js';
import { END, requestThink, getMover } from '../work/jobs.js';
import { endJob } from '../work/reserve.js';

export const MAX_SQUADS = 4, MAX_SQUADS_WAR_ROOM = 6;

/** Can this colonist be drafted now? null when yes, else the reason (shown as a toast). */
export function draftVeto(s, col) {
  if (col.hp.dead) return 'they are dead';
  if (col.hp.down) return 'they are downed';
  if (col.breakState) return 'they are in a break';
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
