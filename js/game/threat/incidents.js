// Contract C12 (owner H; reviewer K; provisional until the end of Stage 1b): the incident, cast and
// raid-plan schema (doc 9.1, 9.10). Data rows live in js/data/incidents.js (C11 fields, owner H);
// the code half of an incident (requires, plan, start, tick, end) registers here by id, so data
// stays plain and validate-data can check every row.
//
// Shapes (all plain JSON; saved in s.st.queue and s.raids):
//
//   IncidentDef (data)  { id, cat, minTier, seasons, weight, cooldownD, pts: { min, mult }, warnH: [lo, hi],
//                         arrive: 'day'|'dusk'|'night'|'any', tags: [...], after?: [aftermath ids],
//                         cast?: { role: selector }, letter }
//   IncidentLogic (code) { requires?(s) -> bool, plan?(s, entry) -> RaidPlan, start?(s, entry) -> raidId | null,
//                         tick?(s, raid), end?(s, raid, result) }
//   QueueEntry  { id, inc, warnTick, arriveTick, stage, plan: RaidPlan | null, cast: Cast, raid: raidId | null,
//                 side?: edge side rolled at scheduling (towers facing it warn earlier, 9.4), nem?: nemId leading it,
//                 bonusH?: the earlier-warning hours added (towers, beacon) }
//               stage: QUEUE_STAGES; id comes from s.next.raid (a raid that arrives keeps the same id)
//   RaidPlan    { pts, edge: { side: 'n'|'e'|'s'|'w'|'deep', i: tile }, goal: GOALS, members: [raiderId], nem: nemId | null,
//                 lead?: member index of the leader (an elite: warden affix, or the nemesis), aff?: [affix] of the leader }
//   Cast        { [role]: colId | [colId, colId] | null }   (selectors in cast.js; ties by colonist id)
//   Raid entity (schema C2) { id, inc, pts, edge, goal, morale, members: [foeId], stage: RAID_STAGES }
//
// Stage 2: every incident goes through the queue. A hostile one (pts) makes a Raid at its Omen like a
// major; one without pts (a disaster, visitor or boon) runs its logic.start at arrival; a warned one
// (warnH > 0) shows its Omen as a letter and the chip first. The live record s.st.live[raidId] =
// { deaths, downed, slayer?, fell?: [tile], by?: ... } holds per-raid counters that must survive a save.
//
// Raid stages: 'warned' (omen shown; no flow field yet) -> 'sighted' (route preview; raidLive from
// here, so flow fields are saved, C13) -> 'imminent' -> 'active' (hostiles on the map) ->
// 'retreat' (morale broken or dawn) -> 'ended'.

import { BUS } from '../core/bus.js';
import { all, def } from './defs.js';

export const CATS = Object.freeze(['major', 'minor', 'disaster', 'visitor', 'boon', 'discovery']);
export const QUEUE_STAGES = Object.freeze(['queued', 'omen', 'sighted', 'imminent']);
export const RAID_STAGES = Object.freeze(['warned', 'sighted', 'imminent', 'active', 'retreat', 'ended']);
export const GOALS = Object.freeze(['core', 'loot', 'people', 'dig']);
export const EDGES = Object.freeze(['n', 'e', 's', 'w']);
/** Warning stage lead times in hours before arrival (9.4). */
export const SIGHTED_H = 4, IMMINENT_H = 1;
export const SEASON_LETTERS = 'TBAD';

/** Incident defs: data rows, then defs added by systems through BUS.incidents (C4), by id. */
export function incidentDef(id) {
  const d = def('incident', id);
  if (d) return d;
  for (const x of BUS.incidents) if (x.id === id) return x;
  return null;
}
export function incidentList() {
  const out = all('incident').slice();
  for (const x of BUS.incidents) if (!out.some((d) => d.id === x.id)) out.push(x);
  return out;
}

const LOGIC = new Map();
/** Register the code half of an incident. Later registration of an id replaces it. */
export function registerIncidentLogic(id, logic) { LOGIC.set(id, logic); }
export const logicOf = (id) => LOGIC.get(id) || null;
export function resetIncidentLogic() { LOGIC.clear(); }

/** Can this incident happen in this season index (0 Thaw .. 3 Deepcold)? */
export const inSeason = (d, season) => !d.seasons || d.seasons.includes(SEASON_LETTERS[season]);

/** Errors (strings) for one incident def (data or BUS); [] when valid. */
export function checkIncident(d) {
  const e = [];
  if (!d || typeof d.id !== 'string') return ['id'];
  if (!CATS.includes(d.cat)) e.push(`${d.id}.cat`);
  if (d.warnH && (!Array.isArray(d.warnH) || d.warnH[0] > d.warnH[1])) e.push(`${d.id}.warnH`);
  if (d.pts && !(Number.isInteger(d.pts.min) && Number.isInteger(d.pts.mult))) e.push(`${d.id}.pts`);
  return e;
}
/** Errors for a queue entry. */
export function checkEntry(q) {
  const e = [];
  if (!Number.isInteger(q.id)) e.push('id');
  if (!incidentDef(q.inc)) e.push(`inc ${q.inc}`);
  if (!(q.warnTick <= q.arriveTick)) e.push('warnTick > arriveTick');
  if (!QUEUE_STAGES.includes(q.stage)) e.push(`stage ${q.stage}`);
  return e;
}

/** A hostile incident brings foes (it has a share of the threat budget, `pts`). */
export const isHostile = (d) => !!d && !!d.pts;
/** Edge words for letters and the chip ('deep': the breach comes up the tunnels). */
export const EDGE_WORDS = Object.freeze({ n: 'north', e: 'east', s: 'south', w: 'west', deep: 'deep' });

/** A fresh queue entry (storyteller.js schedules it). */
export const newEntry = (id, inc, warnTick, arriveTick, init = {}) => ({ id, inc, warnTick, arriveTick, stage: 'queued', plan: null, cast: {}, raid: null, ...init });
