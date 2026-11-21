// Hold verb: research by doing (EMBERCROWN-FORTRESS.md 8.4 Z2.4, owner decision 5). Owner K.
//
// The tech tree stays (js/data/research.js, research.js). About a third of its techs gain a "discovered when"
// alternative: the hold learns the tech by doing the thing instead of (or before) paying its lore:
//   mine    working a material at the rock face: n voxels of `mat` dug (the 'mined' event's stone);
//   craft   working a material at a bench: n crafted stacks of kind `k` and/or material `mat` (the 'crafted' event);
//   tablet  a vault lore tablet read (lore.js readTablet): each tablet read also discovers the first tablet tech
//           the hold lacks, in WHEN order;
//   scholar a visiting scholar (visitors.js, Z2.8; a hold known for Lore and light sees more of them): each visit
//           teaches the first scholar tech the hold lacks.
// A tech discovered while its era is still closed waits (`found`) and is learned at the first hour its era opens.
// Learning goes through research.learn(), so the 'researched' event, the Chronicle line and the ledger count are
// the same as for paid research. The WHEN rows are data (G: they may move onto the tech rows as `when` once the
// schema has the field); the existing `discover` rows (half or free cost on an event) are unchanged.
//
// Saved state (plain JSON on the colony record, created lazily on the first counted deed, so a hold that never
// does any of these deeds, and every old save, has none):
//   s.colony.byDoing = { v: 1, n: [count per WHEN row], found: [tech ids waiting for their era] }
// Determinism: counters only, rows in WHEN order; no rng.
//
// Hooks into other owners' code (requests in the Z2.4 report; dark until they land):
//   colony/index.js (K)  installDiscovery() with the research gates (it adds the events tap)
//   givers/lore.js (E)   readTablet(): discoveredByTablet(s) after the tablet's own tech is learned
//   visitors.js (Z2.8)   a scholar's visit: discoveredByScholar(s)

import { TICKS_PER_HOUR } from '../../core/time.js';
import { onTap, offTap } from '../ledger.js';
import { learn, hasTech, eraOpen } from '../research.js';
import { def, all } from '../defs.js';
import { stoneName } from '../../world/defs.js';
import { getItem } from '../../work/items.js';

/** The "discovered when" rows (11 of the 33 techs: a third). */
export const WHEN = Object.freeze([
  { tech: 'glassblowing', by: 'mine', mat: 'sand', n: 30, text: 'Discovered when 30 sand has been dug.' },
  { tech: 'sculpture', by: 'mine', mat: 'marble', n: 20, text: 'Discovered when 20 marble has been dug.' },
  { tech: 'smithing', by: 'craft', k: 'ingot', mat: 'iron', n: 12, text: 'Discovered when 12 loads of iron have been smelted.' },
  { tech: 'steel', by: 'craft', mat: 'iron', n: 40, text: 'Discovered when 40 iron things have been made.' },
  { tech: 'masonry2', by: 'craft', k: 'block', n: 40, text: 'Discovered when 40 loads of blocks have been cut.' },
  { tech: 'lanterns', by: 'craft', k: 'glass', n: 10, text: 'Discovered when 10 batches of glass have been made.' },
  { tech: 'tailoring', by: 'craft', k: 'cloth', n: 12, text: 'Discovered when 12 bolts of cloth have been woven.' },
  { tech: 'mechanisms', by: 'tablet', text: 'Discovered when an Old Crown tablet is read.' },
  { tech: 'siegecraft', by: 'tablet', text: 'Discovered when a second Old Crown tablet is read.' },
  { tech: 'medicine2', by: 'scholar', text: 'Discovered when a visiting scholar teaches it.' },
  { tech: 'waterworks', by: 'scholar', text: 'Discovered when a visiting scholar teaches it.' },
]);
export const WHEN_KINDS = Object.freeze(['mine', 'craft', 'tablet', 'scholar']);

/** The record, created on first use. */
export function doingOf(s) {
  let r = s.colony.byDoing;
  if (!r) r = s.colony.byDoing = { v: 1, n: WHEN.map(() => 0), found: [] };
  while (r.n.length < WHEN.length) r.n.push(0);   // rows appended in a later release
  return r;
}
/** The "discovered when" row of a tech, or null (UI: the research card's second line). */
export const whenOf = (techId) => WHEN.find((w) => w.tech === techId) || null;

/** Mark a tech discovered: learned now if its era is open, else when it opens. True when it is new. */
export function discoverByDoing(s, techId) {
  if (!def('tech', techId) || hasTech(s, techId)) return false;
  const t = def('tech', techId);
  if (eraOpen(s, t.era)) return learn(s, techId);
  const r = doingOf(s);
  if (r.found.includes(techId)) return false;
  r.found.push(techId);
  return true;
}
function count(s, k, need) {
  if (hasTech(s, WHEN[k].tech)) return;
  const r = doingOf(s);
  if (r.n[k] < 65535) r.n[k]++;
  if (r.n[k] >= need) discoverByDoing(s, WHEN[k].tech);
}
/** The events tap (ledger onTap): mined and crafted deeds. */
export function discoveryTap(s, e) {
  if (e.name !== 'mined' && e.name !== 'crafted') return;
  const d = e.data || {};
  let mat = null, kind = null;
  if (e.name === 'mined') mat = typeof d.mat === 'number' ? stoneName(d.mat) : d.mat;
  else { kind = d.k; const it = getItem(s, d.itemId); mat = it ? it.m : null; }
  for (let k = 0; k < WHEN.length; k++) {
    const w = WHEN[k];
    if (e.name === 'mined' ? w.by !== 'mine' : w.by !== 'craft') continue;
    if (w.mat && w.mat !== mat) continue;
    if (w.k && w.k !== kind) continue;
    if (!w.mat && !w.k) continue;
    count(s, k, w.n);
  }
}
function firstOf(s, by) { for (const w of WHEN) if (w.by === by && !hasTech(s, w.tech) && !(s.colony.byDoing && s.colony.byDoing.found.includes(w.tech))) return w.tech; return null; }
/** A vault lore tablet was read: the first tablet tech the hold lacks is discovered. Returns its id or null. */
export function discoveredByTablet(s) { const id = firstOf(s, 'tablet'); return id && discoverByDoing(s, id) ? id : null; }
/** A visiting scholar taught: the first scholar tech the hold lacks is discovered. Returns its id or null. */
export function discoveredByScholar(s) { const id = firstOf(s, 'scholar'); return id && discoverByDoing(s, id) ? id : null; }

/** Hourly: learn found techs whose era has opened (WHEN order). */
function tick(s) {
  const r = s.colony.byDoing;
  if (!r || !r.found.length || s.tick % TICKS_PER_HOUR !== 0) return;
  const keep = [];
  for (const id of r.found) {
    const t = def('tech', id);
    if (!t || hasTech(s, id)) continue;
    if (eraOpen(s, t.era)) learn(s, id); else keep.push(id);
  }
  r.found = keep;
}
export function installDiscovery() { onTap(discoveryTap); }
export function uninstallDiscovery() { offTap(discoveryTap); }
/** Share of the techs with a "discovered when" row (owner decision 5: about a third). */
export const whenShare = () => WHEN.length / all('tech').length;

export const VERB = Object.freeze({
  id: 'discovery',
  /** Per-tick work (slot 'colony', through verbs/index.js): hourly, the found techs whose era opened. */
  tick,
});
