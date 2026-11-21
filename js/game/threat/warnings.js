// Threat warnings for the UI and the renderer (doc 9.4). Owner H. Read-only views of the saved
// state: nothing here changes it, so I's threat chip and omen letter and C's edge marker and route
// preview call these freely (every frame if they like; each call is a few hundred steps at most).
//
//   threatViews(s)  -> [ThreatView], soonest first: every queue entry from its Omen on, and every
//                      raid on the map (active, or retreating at dawn)
//   threatChip(s)   -> the first ThreatView, or null (no chip before the Omen)
//   omenText(s, v)  -> the omen letter text (js/data/text/incidents.js template, {edge} {hours})
//
// ThreatView = {
//   id, inc, name ('Hollow horde'), stage: 'omen' | 'sighted' | 'imminent' | 'active' | 'retreat',
//   arriveTick, hours (whole hours left, rounded up; 0 once on the map),
//   chip ('Hollow horde: 14 h', 'Hollow horde: on the map', 'Hollow horde: fleeing'),
//   edge: { side: 'n'|'e'|'s'|'w', word: 'north'..., i, x, y }            (from the Omen: the edge marker)
//   size: { n, text: 'about 12' } | null, types: ['Husk', 'Gloom Hound'] | null   (from Sighted)
//   route: [tile index] | null   (from Sighted: edge to goal down the goal's flow field)
//   comp: [{ id, name, n }] | null   (from Imminent: the exact composition, most first, then by id)
//   onMap: number | null             (members still on the map, once it has arrived)
//   prey: colId | null               (the cast's prey, once chosen at the Omen)
// }
// Imminent drops the game to 1x and may auto-pause: that is the UI's (speed is not sim state); it
// listens for the `raidStage` event with stage 'imminent' (C8).

import { W, PLANE } from '../core/grid.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { def, variants } from './defs.js';
import { incidentDef } from './incidents.js';
import { raidById } from './raiders.js';
import { routeTiles } from './flow.js';

export const NAMES = Object.freeze({ hollow_horde: 'Hollow horde', sapper_raid: 'Sapper raid', siege: 'Siege', thieves: 'Gutterkin thieves', manhunters: 'Manhunters',
  reaver_raid: 'Reaver warband', hollow_rift: 'Hollow Rift', deep_breach: 'Breach from the deep', lone_husks: 'Wandering Husks', lone_thief: 'A thief', wolf_pair: 'Wolves',
  blight_surge: 'Blight surge', deep_tremor: 'Deep tremor', cold_snap: 'Cold snap', flood: 'Flood' });
export const EDGE_WORDS = Object.freeze({ n: 'north', e: 'east', s: 'south', w: 'west', deep: 'deep' });
const STAGE_RANK = Object.freeze({ omen: 1, sighted: 2, imminent: 3, active: 4, retreat: 4 });

export const incidentName = (id) => NAMES[id] || (id ? id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Threat');
const raiderName = (id) => { const d = def('raider', id); return d ? d.name : id; };

/** "about 12": exact up to 4, then rounded to 2 (under 10) or 5. */
export function approxSize(n) {
  if (n <= 4) return String(n);
  const step = n < 10 ? 2 : 5;
  return `about ${Math.max(step, Math.round(n / step) * step)}`;
}
/** Composition [{ id, name, n }], most first, ties by id. */
export function composition(members) {
  const m = new Map();
  for (const id of members) m.set(id, (m.get(id) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id, n]) => ({ id, name: raiderName(id), n }));
}

function edgeOf(plan) {
  if (!plan || !plan.edge) return null;
  const i = plan.edge.i;
  const p = i % PLANE, z = (i / PLANE) | 0;
  return { side: plan.edge.side, word: EDGE_WORDS[plan.edge.side] || plan.edge.side, i, x: p % W, y: (p / W) | 0, ...(z ? { z } : {}) };
}
function fill(v, s, raid, plan, members) {
  const rank = STAGE_RANK[v.stage] || 0;
  v.edge = edgeOf(plan || (raid && { edge: raid.edge }));
  if (rank >= 2 && members) {
    v.size = { n: members.length, text: approxSize(members.length) };
    v.types = composition(members).slice(0, 3).map((c) => c.name);
    v.route = raid && v.stage !== 'retreat' ? routeTiles(s, raid) : null;
  }
  if (rank >= 3 && members) v.comp = composition(members);
  return v;
}
const blank = (id, inc, stage, arriveTick) => ({ id, inc, name: incidentName(inc), stage, arriveTick, hours: 0, chip: '', edge: null, size: null, types: null, route: null, comp: null, onMap: null, prey: null, why: null });

/** Every warned or live threat, soonest first. */
export function threatViews(s) {
  const out = [];
  for (const e of s.st.queue) {
    if (e.stage === 'queued') continue;
    const inc = incidentDef(e.inc);
    if (!inc) continue;
    const raid = raidById(s, e.id);
    const plan = e.plan || null;
    const v = blank(e.id, e.inc, e.stage, e.arriveTick);
    v.hours = Math.max(0, Math.ceil((e.arriveTick - s.tick) / TICKS_PER_HOUR));
    v.chip = `${v.name}: ${v.hours} h`;
    v.why = e.why || null;
    v.prey = e.cast && e.cast.prey !== undefined ? e.cast.prey : null;
    out.push(fill(v, s, raid, plan, plan ? plan.members : null));
  }
  for (const r of s.raids) {
    if (r.stage !== 'active' && r.stage !== 'retreat') continue;
    const v = blank(r.id, r.inc, r.stage, s.tick);
    v.chip = `${v.name}: ${r.stage === 'retreat' ? 'fleeing' : 'on the map'}`;
    v.onMap = r.members.length;
    const kinds = r.members.map((id) => { for (const f of s.foes) if (f.id === id) return f.kind; return null; }).filter(Boolean);
    out.push(fill(v, s, r, null, kinds));
  }
  out.sort((a, b) => a.arriveTick - b.arriveTick || a.id - b.id);
  return out;
}
export function threatChip(s) { const v = threatViews(s); return v.length ? v[0] : null; }

/** The omen letter text for a view (the incident's letter template). */
export function omenText(s, v) {
  const inc = incidentDef(v.inc);
  const t = (inc && variants(inc.letter)[0]) || `${v.name} in {hours} hours.`;
  return `${t.replace('{edge}', v.edge ? v.edge.word : 'edge').replace('{hours}', String(v.hours))}${v.why ? ' ' + v.why : ''}`;
}
