// Research and discovery (doc 7.12). Owner K. Provisional API; Stage 2 feature.
//
// s.colony.techs is a bitset (TECH_BYTES); a tech's bit is its index in js/data/research.js `tech`
// order (append only, like every positional list). s.colony.research = { cur, pts }: E's Lore
// giver adds points with addLore(); reaching the cost grants the tech. Techs of cost 0 are free once
// their era's tier is reached (granted by the hourly system). Discoveries (an event halves or
// zeroes a cost) need a sim-side call: discover(s, eventName) from the system that causes it
// (B's terrain for oreFound), since the sim never reads the event queue.

import { getBit, setBit } from '../core/grid.js';
import { TECH_BYTES } from '../core/schema.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { registerApplier } from '../core/commands.js';
import { def, all } from './defs.js';
import { atLeast } from './tiers.js';

export const techIndex = (id) => all('tech').findIndex((t) => t.id === id);
export function hasTech(s, id) { const i = techIndex(id); return i >= 0 && i < TECH_BYTES * 8 && getBit(s.colony.techs, i) === 1; }
export function grantTech(s, id) { const i = techIndex(id); if (i < 0 || i >= TECH_BYTES * 8) return false; setBit(s.colony.techs, i, 1); return true; }
export function eraOpen(s, eraId) { const e = def('era', eraId); return !!e && atLeast(s, e.tier); }
/** Cost now, after discoveries ('free' 0, 'half' 50%). */
export function costOf(s, t) {
  const d = (s.colony.research.disc || []).includes(t.id) && t.discover ? t.discover.effect : null;
  return d === 'free' ? 0 : d === 'half' ? Math.floor(t.cost / 2) : t.cost;
}
/** null when research of `id` can start, else the reason. */
export function canResearch(s, id) {
  const t = def('tech', id);
  if (!t) return 'no such tech';
  if (hasTech(s, id)) return 'already known';
  if (!eraOpen(s, t.era)) return 'that era is not open yet';
  return null;
}
/** Add lore points to the current research; grants it at its cost. Returns the granted id or null. */
export function addLore(s, pts) {
  const r = s.colony.research;
  if (!r.cur) { s.colony.lore += pts; return null; }
  const t = def('tech', r.cur);
  r.pts += pts;
  if (!t || r.pts < costOf(s, t)) return null;
  grantTech(s, r.cur);
  const done = r.cur;
  r.cur = null; r.pts = 0;
  return done;
}
/** An event that may discover techs (sim-side call). */
export function discover(s, eventName) {
  const r = s.colony.research;
  for (const t of all('tech')) {
    if (!t.discover || t.discover.event !== eventName || hasTech(s, t.id)) continue;
    if (!r.disc) r.disc = [];
    if (!r.disc.includes(t.id)) r.disc.push(t.id);
  }
}

/** Tick system (slot 'colony'): free techs of open eras, hourly. */
export function researchSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  for (const t of all('tech')) if (costOf(s, t) === 0 && !hasTech(s, t.id) && eraOpen(s, t.era)) grantTech(s, t.id);
}

export function installResearchCommands() {
  registerApplier('research', (s, c) => {
    const r = canResearch(s, c.tech);
    if (r) return { ok: false, reason: r };
    s.colony.research.cur = c.tech; s.colony.research.pts = 0;
    return { ok: true };
  });
}
