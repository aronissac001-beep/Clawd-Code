// The Lore work giver (doc 5.1, 7.12; owner E; Stage 2). Two parts:
//   STUDY_GIVER   the study desk (a workplace): one scholar per desk works a shift; every game
//                 minute of work at speed 1.0 is one lore point (7.12: 1 point per 10 work ticks x
//                 speed), paid to K's research (colony/research.js addLore: the current research, or
//                 the colony's banked lore when nothing is being researched).
//   LORE_BENCH    bills at Lore workbenches (the scriptorium copies books), from the bench factory.
//   TABLET_GIVER  a lore tablet (a named book from the Old Crown vault, mapgen loot) lying unforbidden and
//                 reachable: a scholar reads it where it lies for TABLET.readMin game minutes and the hold
//                 learns a tech from it (the current research, else the cheapest open one; a Deep Reader
//                 learns a second). The tablet stays, marked read. Counts the reader's `tablets_read` deed.
// The survey table (reveal veins around a chosen spot) waits for a target command (Stage 3).

import { benchGiver, workplaceGiver } from './craft.js';
import { addLore, learn, hasTech, canResearch } from '../../colony/research.js';
import { all } from '../../colony/defs.js';
import { didDeed, studied } from '../../people/coldeeds.js';
import { DEED_RULES } from '../../../data/deeds-col.js';
import { hasGrant } from '../../people/perkrules.js';
import { idx } from '../../core/grid.js';
import { TICKS_PER_MIN } from '../../core/time.js';
import { T, makeJob, registerEffect, keyItem, keyId } from '../jobs.js';
import { openTarget, distTo, reachableFrom } from '../windex.js';

export const STUDY_SHIFT_MIN = 120;
/**
 * A study shift's lore points (to the current research, else banked). The `researched` deed (Deep Reader,
 * EMBERCROWN-FORTRESS.md 3.1) is counted by people/coldeeds.js from the `researched` event: the hold's lead
 * scholar (its best Lore), so a tech bought with banked lore is a scholar's work too. Each hour of points
 * studied is the scholar's `study_hours` deed (coldeeds.studied).
 */
export function studyYield(s, col, b, n) { addLore(s, n); studied(s, col, n); }
export const STUDY_GIVER = workplaceGiver({
  id: 'study', work: 'lore', defs: ['study'], sk: 'lore', shiftMin: STUDY_SHIFT_MIN, perMin: 1, order: 0, yieldFn: studyYield,
});
export const LORE_BENCH_GIVER = benchGiver('lore', 'lorebench');

// ---- Lore tablets ---------------------------------------------------------------------------------------
export const TABLET = Object.freeze({ k: 'book', suffix: 'tablet', read: ' (read)', readMin: 240, deepReaderTechs: 2 });
/** An unread lore tablet: a book whose name ends in "tablet" (mapgen's vault loot; read ones end in "(read)"). */
export const isTablet = (it) => !!it && it.k === TABLET.k && typeof it.name === 'string' && it.name.endsWith(TABLET.suffix);
/** The tech a tablet teaches now: the current research, else the cheapest open one (data order on a tie); null when none. */
export function tabletTech(s) {
  const r = s.colony.research;
  if (r && r.cur && !hasTech(s, r.cur)) return r.cur;
  let best = null;
  for (const t of all('tech')) if (canResearch(s, t.id) === null && (best === null || (t.cost | 0) < (best.cost | 0))) best = t;
  return best ? best.id : null;
}
/** Read a tablet: learn its tech(s), mark it read, count the deed. Returns the techs learned. */
export function readTablet(s, col, it) {
  if (!isTablet(it)) return [];
  const got = [];
  const n = hasGrant(col, 'deep_reader') ? TABLET.deepReaderTechs : 1;
  for (let k = 0; k < n; k++) { const id = tabletTech(s); if (!id || !learn(s, id)) break; got.push(id); }
  it.name = it.name + TABLET.read;
  didDeed(s, col, 'tablets_read');
  return got;
}
// the unread tablets on the map this tick (derived, never saved; there are one or two in a world)
let memo = { s: null, tick: -1, ids: [] };
function tablets(s) {
  if (memo.s === s && memo.tick === s.tick) return memo.ids;
  const ids = [];
  for (const it of s.items) if (it && isTablet(it) && !it.f) ids.push(it.id);
  memo = { s, tick: s.tick, ids };
  return ids;
}
const tabletTarget = (s, col, it) => {
  if (!isTablet(it) || it.f || !openTarget(s, col, keyItem(it.id))) return null;
  const i = idx(it.x, it.y, it.z | 0);
  if (!reachableFrom(s, col, i)) return null;
  const d = distTo(s, col, i);
  return d === Infinity ? null : { key: keyItem(it.id), id: it.id, i, d };
};
export const TABLET_GIVER = Object.freeze({
  id: 'tablet', work: 'lore', order: -1,
  candidates(s, col, k) {
    const ids = tablets(s);
    if (!ids.length || tabletTech(s) === null) return [];
    const out = [];
    for (const id of ids) { const t = tabletTarget(s, col, s.items[id]); if (t) out.push(t); }
    out.sort((a, b) => a.d - b.d || a.key - b.key);
    return out.slice(0, k);
  },
  valid(s, col, t) { const r = tabletTarget(s, col, s.items[t.id]); return !!r && r.i === t.i && tabletTech(s) !== null; },
  make(s, col, t) {
    const key = keyItem(t.id);
    return { job: makeJob('readtablet', key, [T.goto(t.i), T.work(TABLET.readMin * TICKS_PER_MIN, { sk: 'lore', fx: 'readTablet', key })]), claims: [[key, 0]] };
  },
  keyOf: (t) => t.key,
  fromTarget(s, col, tg) { return tg && tg.kind === 'item' ? tabletTarget(s, col, s.items[tg.id]) : null; },
});
registerEffect('readTablet', (s, col, job) => {
  const it = s.items[keyId(job.target)];
  if (!isTablet(it)) return 'targetGone';
  const got = readTablet(s, col, it);
  if (Array.isArray(col.log)) {
    const names = got.map((id) => (all('tech').find((x) => x.id === id) || { name: id }).name);
    col.log.push({ tick: s.tick, text: `Read the ${it.name.slice(0, -TABLET.read.length)}${names.length ? ': the hold learned ' + names.join(' and ') : ''}.` });
    if (col.log.length > DEED_RULES.logCap) col.log.splice(0, col.log.length - DEED_RULES.logCap);
  }
  return undefined;
});

export const GIVER = STUDY_GIVER;
