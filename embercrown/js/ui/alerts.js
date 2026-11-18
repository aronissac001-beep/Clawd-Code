// Alerts (owner I; doc 10.6): conditions shown while they hold, as the right-edge icon stack (4
// visible, "+N"). Tap: jump to the subject. Long-press: explain, with "Snooze 1 day".
// Stage 1b: starving, idle colonists, raid (a horde close or on the map), Hearth fuel (< 1 day).
// UI only: alerts read state and never write it. Idle is timed on the UI side (a colonist idle for
// a game hour or more), snoozes are per colony in localStorage ('ec2.snooze.<id>'), in game ticks.
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../game/core/time.js';
import { FIX } from '../game/core/schema.js';
import { threatChip } from '../game/threat/warnings.js';

const IDLE_TICKS = TICKS_PER_HOUR;   // idle for a game hour before the alert shows (jobs change often)
const first = (c) => (c.name || '?').split(' ')[0];
const alive = (s) => s.col.filter((c) => !c.hp.dead);
const isIdle = (c) => !c.drafted && !c.hp.down && !c.breakState && (!c.job || c.job.type === 'idle');

/** Hearth fuel in ticks, or null without a lit Hearth. */
export function hearthFuel(s) {
  const h = s.colony.hearth;
  if (!h || h.id === null || h.id === undefined || !s.bld[h.id]) return null;
  return h.fuel | 0;
}

/**
 * The alert rules. Each: id, icon, tone, test(s, view) -> null | { text, why, target }. target:
 * { colonist: id } | { building: id } | { tile: [x, y] } | { threat: true }.
 */
export const ALERT_RULES = Object.freeze([
  {
    id: 'raid', icon: 'horde', tone: 'bad',
    test(s) {
      const v = threatChip(s);
      if (!v || !(v.stage === 'imminent' || v.stage === 'active')) return null;
      const n = v.onMap !== null && v.onMap !== undefined ? v.onMap : v.size ? v.size.n : 0;
      const text = v.stage === 'active' ? `${v.name} on the map: ${n}` : `${v.name} in ${v.hours} h from the ${v.edge ? v.edge.word : 'edge'}`;
      return { text, why: 'Draft your colonists (tap a portrait, then Draft) and hold by the braziers. Tap to see where it comes from.', target: { threat: true } };
    },
  },
  {
    id: 'starving', icon: 'hunger', tone: 'bad',
    test(s) {
      const c = alive(s).find((x) => x.need && x.need[0] <= 0);
      if (!c) return null;
      return { text: `${first(c)} is starving`, why: 'No food: health drains away. Cook meals at a campfire, grow hearthroot, keep food in a stockpile.', target: { colonist: c.id } };
    },
  },
  {
    id: 'hearth', icon: 'flame', tone: 'warn',
    test(s) {
      const f = hearthFuel(s);
      if (f === null || f >= TICKS_PER_DAY) return null;
      const hours = Math.floor(f / TICKS_PER_HOUR);
      return { text: f <= 0 ? 'The Hearth is out' : `Hearth fuel: ${hours} h left`, tone: f <= 0 ? 'bad' : 'warn',
        why: 'Haulers bring wood to the Hearth by themselves when there is wood in a stockpile. A cold Hearth gives no light and no night shot.', target: { building: s.colony.hearth.id } };
    },
  },
  {
    id: 'idle', icon: 'alert', tone: 'warn',
    test(s, view) {
      const idle = alive(s).filter((c) => isIdle(c) && view.idleSince.has(c.id) && s.tick - view.idleSince.get(c.id) >= IDLE_TICKS);
      if (!idle.length) return null;
      return { text: idle.length === 1 ? `${first(idle[0])} is idle` : `${idle.length} colonists are idle`,
        why: 'Nothing their roles allow can be done. Give them a role with more work (Colony > Work), or mark rock, trees or blueprints.', target: { colonist: idle[0].id } };
    },
  },
]);

const KEY = (s) => 'ec2.snooze.' + (s.id || 'colony');
function loadSnooze(s) { try { const v = JSON.parse(localStorage.getItem(KEY(s)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
function saveSnooze(s, v) { try { localStorage.setItem(KEY(s), JSON.stringify(v)); } catch (_) { /* private mode: snoozes last this session */ } }

/** The alert tracker for one colony: update() once a second, list() for the stack. */
export function alertTracker(s) {
  const view = { idleSince: new Map() };
  let snooze = loadSnooze(s);
  let cur = [];
  return {
    view,
    update() {
      for (const c of s.col) {
        if (isIdle(c)) { if (!view.idleSince.has(c.id)) view.idleSince.set(c.id, s.tick); }
        else view.idleSince.delete(c.id);
      }
      const out = [];
      for (const r of ALERT_RULES) {
        if ((snooze[r.id] | 0) > s.tick) continue;
        const a = r.test(s, view);
        if (a) out.push({ id: r.id, icon: r.icon, tone: a.tone || r.tone, text: a.text, why: a.why, target: a.target });
      }
      cur = out;
      return out;
    },
    list: () => cur,
    snooze(id, ticks = TICKS_PER_DAY) { snooze[id] = s.tick + ticks; saveSnooze(s, snooze); cur = cur.filter((a) => a.id !== id); },
    key: () => cur.map((a) => `${a.id}:${a.tone}:${a.text}`).join('|'),
  };
}

/** Mood ring colour band for a colonist (portraits). */
export const moodPct = (c) => Math.max(0, Math.min(100, (c.mood || 0) / FIX));
