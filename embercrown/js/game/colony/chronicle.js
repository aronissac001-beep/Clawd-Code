// The Chronicle (doc 9.9, 13.2): the hold's history. Owner K. Provisional API.
//
// s.chron (C2) = [[tick, kind, templateId, args]], capped at CHRON_CAP (600). When full, the
// oldest plain entry folds into its year's summary [tick, 'year', 'chron_year', { year, n }],
// which stays at the front. Templates live in js/data/text/chronicle.js; args are plain JSON.
// installChronicle() writes death lines through BUS.kill (F's kill() and H's killFoe run it).

import { yearOf, seasonOf, SEASON_NAMES, START_TICK } from '../core/time.js';
import { BUS } from '../core/bus.js';
import { def, variants } from './defs.js';

export const CHRON_CAP = 600;

export function addChron(s, kind, templateId, args = {}) {
  s.chron.push([s.tick, kind, templateId, args]);
  while (s.chron.length > CHRON_CAP) fold(s);
}
function fold(s) {
  const c = s.chron;
  let k = 0;
  while (k < c.length && c[k][1] === 'year') k++;          // summaries sit at the front, by year
  if (k >= c.length) { c.shift(); return; }
  const old = c.splice(k, 1)[0];
  const y = yearOf(old[0]);
  let j = 0;
  while (j < k && c[j][3].year < y) j++;
  if (j < k && c[j][3].year === y) { c[j][3].n++; return; }
  c.splice(j, 0, [old[0], 'year', 'chron_year', { year: y, n: 1 }]); // same length: the caller folds again
}
/** Entries of a kind, oldest first. */
export const entriesOf = (s, kind) => s.chron.filter((e) => e[1] === kind);

const onKill = (s, victim, killer) => {
  if (!victim || !('sk' in victim)) return;
  addChron(s, 'death', 'chron_death', { id: victim.id, name: victim.name, killer: killer && killer.id !== undefined ? killer.id : null });
};
export function installChronicle() { if (!BUS.kill.includes(onKill)) BUS.kill.push(onKill); }

// ---- Stage 2: the hold's story from the events tap (ledger.onTap) ----------------------------------
// Lines for the founding (the first colony tick), tiers, raids held, masterworks, named artifacts,
// research, tamings, deeds (deeds.js) and trades (trade.js). Args hold names as they were, so the
// Chronicle reads the same after the colonist dies.
const colName = (s, id) => { for (const c of s.col) if (c.id === id) return c.name; return null; };
const itemName = (k) => { const d = def('item', k); return d ? d.name : k; };
/** ledger.onTap listener: fn(s, e). */
export function chronicleTap(s, e) {
  const d = e.data || {};
  switch (e.name) {
    case 'tierUp': { const t = def('tier', d.tier); addChron(s, 'tier', 'chron_tier', { tier: d.tier, name: t ? t.name : d.tier }); break; }
    case 'raidEnd': if (d.result === 'repelled') addChron(s, 'raid', 'chron_raid', { raidId: d.raidId, result: d.result }); break;
    case 'masterwork': { const it = d.itemId >= 0 ? s.items[d.itemId] : null; addChron(s, 'craft', 'chron_masterwork', { maker: colName(s, d.colId), item: it ? itemName(it.k) : '' }); break; }
    case 'artifact': addChron(s, 'craft', 'chron_artifact', { maker: colName(s, d.colId), item: d.name || '' }); break;
    case 'researched': { const t = def('tech', d.tech); addChron(s, 'lore', 'chron_research', { tech: d.tech, name: t ? t.name : d.tech }); break; }
    case 'tamed': addChron(s, 'animal', 'chron_tamed', { tamer: colName(s, d.colId), animId: d.animId, kind: d.kind || null }); break;
    default: break;
  }
}
/** The founding line, once: the 'colony' slot calls it every tick; it writes on the colony's first tick only. */
export function chronicleFounding(s) {
  if (s.tick !== START_TICK + 1) return;
  addChron(s, 'founded', 'chron_founded', { hold: s.name, season: SEASON_NAMES[seasonOf(s.tick)], year: yearOf(s.tick) + 1 });
}

// Stand-in wording (a stub for G: text/chronicle.js holds only chron_founded, chron_death and
// chron_masterwork today; these ids should move there). The UI renders with chronLine().
const FALLBACK = Object.freeze({
  chron_year: 'Year {year}: {n} more lines of the hold\'s story.',
  chron_tier: 'The hold grew into a {name}.',
  chron_raid: 'A raid was thrown back from the gates.',
  chron_artifact: '{maker} made {item}.',
  chron_research: 'The scholars learned {name}.',
  chron_tamed: '{tamer} tamed a {kind}.',
  chron_deed: 'Deed done: {deed}.',
  chron_trade: 'Traded with the {trader}.',
  chron_envoy: 'An envoy of the {faction} came asking for {what}.',
  chron_born: 'A {kind} was born in the pens.',
  chron_manhunt: 'A {kind} turned on the hold.',
});
/** One Chronicle entry as text: G's template when it exists, else the stand-in above. */
export function chronLine(entry) {
  const [, , id, args] = entry;
  const v = variants(id);
  const t = v.length ? v[0] : FALLBACK[id] || id;
  return t.replace(/\{(\w+)\}/g, (m, k) => (args && args[k] !== undefined && args[k] !== null ? String(args[k]) : ''));
}
