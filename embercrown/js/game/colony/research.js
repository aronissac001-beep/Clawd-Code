// Research and discovery (doc 7.12). Owner K. Provisional API; Stage 2 feature.
//
// s.colony.techs is a bitset (TECH_BYTES); a tech's bit is its index in js/data/research.js `tech`
// order (append only, like every positional list). s.colony.research = { cur, pts }: E's Lore
// giver adds points with addLore(); reaching the cost grants the tech. Techs of cost 0 are free once
// their era's tier is reached (granted by the hourly system). Discoveries (an event halves or
// zeroes a cost) need a sim-side call: discover(s, eventName) from the system that causes it
// (B's terrain for oreFound), since the sim never reads the event queue.
// Stage 2:
//   - Lore banks: points earned with nothing to research go to s.colony.lore and are spent first by
//     the next research (the `research` command), so a scholar's shift is never wasted.
//   - A finished tech emits 'researched' (C8), bumps the ledger and gets a Chronicle line (the tap).
//   - Discoveries come from the ledger's events tap (same tick, read only: see ledger.js), matching
//     tech.discover { event, k } against the event and its kind (an ore's material, a harvest's item).
//   - Free techs (cost 0 after discoveries) of open eras count as known at once (hasTech), and the
//     hourly system writes their bits.
//   - Gates (installResearchGates, Stage 2): a structure with `tech` or a later `tier` cannot be
//     placed (BUS.canPlace), a recipe with `tech` is not worked (E's bill gate), and an upgrade
//     level's tier and tech must be reached (E's upgrade gate).

import { getBit, setBit } from '../core/grid.js';
import { TECH_BYTES } from '../core/schema.js';
import { TICKS_PER_HOUR } from '../core/time.js';
import { registerApplier } from '../core/commands.js';
import { BUS } from '../core/bus.js';
import { emit } from '../core/events.js';
import { def, all } from './defs.js';
import { atLeast } from './tiers.js';
import { onTap, offTap } from './ledger.js';
import { setUpgradeGate } from '../work/construct.js';
import { setRecipeGate } from '../work/bills.js';

export const techIndex = (id) => all('tech').findIndex((t) => t.id === id);
const bitOf = (s, id) => { const i = techIndex(id); return i >= 0 && i < TECH_BYTES * 8 && getBit(s.colony.techs, i) === 1; };
/** Known: its bit is set, or it is free (cost 0 after discoveries) in an open era. */
export function hasTech(s, id) {
  if (bitOf(s, id)) return true;
  const t = def('tech', id);
  return !!t && costOf(s, t) === 0 && eraOpen(s, t.era);
}
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
/** Learn a tech now (research done, a lore tablet, a discovery that makes it free). */
export function learn(s, id) {
  if (bitOf(s, id) || !grantTech(s, id)) return false;
  emit(s, 'researched', { tech: id });
  return true;
}
/** Add lore points to the current research; grants it at its cost. Returns the granted id or null. */
export function addLore(s, pts) {
  const r = s.colony.research;
  if (r.cur && hasTech(s, r.cur)) { s.colony.lore += r.pts; r.cur = null; r.pts = 0; }
  if (!r.cur) { s.colony.lore += pts; return null; }
  const t = def('tech', r.cur);
  r.pts += pts;
  if (!t || r.pts < costOf(s, t)) return null;
  const done = r.cur;
  s.colony.lore += r.pts - costOf(s, t);   // the rest banks for the next research
  r.cur = null; r.pts = 0;
  learn(s, done);
  return done;
}
/** Start researching a tech: banked lore is spent first. null or the reason. */
export function startResearch(s, id) {
  const why = canResearch(s, id);
  if (why) return why;
  const r = s.colony.research;
  if (r.cur && r.cur !== id) s.colony.lore += r.pts;     // switching keeps what was put in
  else if (r.cur === id) return null;
  r.cur = id; r.pts = 0;
  const bank = s.colony.lore | 0;
  if (bank > 0) { s.colony.lore = 0; addLore(s, bank); }
  return null;
}
/** An event that may discover techs (sim-side call; kind narrows tech.discover.k). */
export function discover(s, eventName, kind = null) {
  const r = s.colony.research;
  for (const t of all('tech')) {
    if (!t.discover || t.discover.event !== eventName || bitOf(s, t.id)) continue;
    if (t.discover.k && t.discover.k !== kind) continue;
    if (!r.disc) r.disc = [];
    if (!r.disc.includes(t.id)) r.disc.push(t.id);
    // a discovery that makes the current research free finishes it
    if (r.cur === t.id && costOf(s, t) <= r.pts) addLore(s, 0);
  }
}

/** Tick system (slot 'colony'): free techs of open eras, hourly. */
export function researchSystem(s) {
  if (s.tick % TICKS_PER_HOUR !== 0) return;
  for (const t of all('tech')) if (costOf(s, t) === 0 && !bitOf(s, t.id) && eraOpen(s, t.era)) learn(s, t.id);
}

export function installResearchCommands() {
  registerApplier('research', (s, c) => {
    const r = startResearch(s, c.tech);
    return r ? { ok: false, reason: r } : { ok: true };
  });
}

// ---- Stage 2 gates and discoveries ---------------------------------------------------------------------
const tierName = (id) => { const t = def('tier', id); return t ? t.name : id; };
const techName = (id) => { const t = def('tech', id); return t ? t.name : id; };
/** Why a structure def cannot be placed yet (tier, then tech), or null. */
export function lockedWhy(s, d) {
  if (!d) return null;
  if (d.tier && !atLeast(s, d.tier)) return `needs the ${tierName(d.tier)} tier`;
  if (d.tech && !hasTech(s, d.tech)) return `needs ${techName(d.tech)} (research)`;
  return null;
}
const canPlaceGate = (s, d) => { const why = lockedWhy(s, d); return why ? { ok: false, reason: why } : null; };
const discTap = (s, e, kind) => discover(s, e.name, kind);
let gatesOn = false;
/** Turn on the Stage 2 gates and the discovery tap (idempotent; installColony with research). */
export function installResearchGates() {
  if (!BUS.canPlace.includes(canPlaceGate)) BUS.canPlace.push(canPlaceGate);
  onTap(discTap);
  setUpgradeGate((s, lv) => lockedWhy(s, lv));
  setRecipeGate((s, r) => !r.tech || hasTech(s, r.tech));
  gatesOn = true;
}
/** Turn them off (a Stage 1 install after a Stage 2 one in the same process). */
export function uninstallResearchGates() {
  offTap(discTap); setUpgradeGate(null); setRecipeGate(null); gatesOn = false;
}
export const researchGatesOn = () => gatesOn;
