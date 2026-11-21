// Every threat has a cause (EMBERCROWN-FORTRESS.md 2.10, F26; step Z2.10). Owner H; data js/data/causes.js (G).
//
// A cause is a fact of the world state. The live list s.st.causes = [[kind, subject, weight]] is recomputed
// once per game day (st.causesDay; the storyteller's first hourly run of the day, or the first schedule of
// the day) from:
//   grievance  the pre-history (the Ashfang, driven out by the Old Crown; more for every Crown vault the hold
//              has opened), the Gutterkin while their goodwill is Wary or worse, and every living nemesis
//              (subject 'm<id>': it allows the major that nemesis leads)
//   rumour     traders who visited this year, weighted by the gems, coins and art they saw in the hold
//              (noted hourly while a visit is live: s.st.rumour = [[day, traderId, worth]], st.rumourVid)
//   hunger     the Hollow's hunger: always present, heavier as the Hearth grows
//   winter     Deepcold, the end of Ashfall, the start of Thaw, and a cold snap
//   seep       the deep breach's own condition (raids2 BREACH_LOGIC.requires: a tunnel near the seep, or Hold)
// Renown leans every weight (colony/renown.js causeLean: Trade x1.5 rumour, Arms x1.25 grievance).
// Both lists are saved story state (plain JSON in s.st), so a load continues them exactly (F25, C13). The
// list is sorted by kind order (data order), then subject.
//
// The storyteller (storyteller.js) asks causeWeight(s, inc) when it weighs a hostile incident (0: not
// eligible) and causeFor(s, inc, nem) when it schedules one: the heaviest allowing row, saved on the queue
// entry as entry.cause = [kind, subject] and entry.why (the letter's cause line, filled now so it never
// changes after the omen). A non-hostile incident needs no cause.

import { DAYS_PER_SEASON, dayOf, seasonOf, yearOf, DAYS_PER_YEAR } from '../core/time.js';
import { DATA } from '../../data/causes.js';
import { DATA as FACTIONS } from '../../data/factions.js';
import { def } from './defs.js';
import { logicOf, isHostile } from './incidents.js';
import { fillText } from './letters.js';
import { fullName, incidentFor } from './nemesis.js';
import { weatherKind } from '../world/weather.js';
import { causeLean } from '../colony/renown.js';
import { prehistoryOf, foundVoxel } from '../colony/legends.js';

export const CAUSE_KINDS = Object.freeze(DATA.cause.map((c) => c.id));
const ROW = Object.freeze(Object.fromEntries(DATA.cause.map((c) => [c.id, c])));
const K = Object.freeze({ ...DATA.tuning[0] });
const TEXT = Object.freeze(Object.fromEntries(DATA.text.map((t) => [t.id, t.text])));
const PRECIOUS = new Set(['gems', 'coins', 'art']);
const factionName = (id) => { const f = (FACTIONS.faction || []).find((x) => x.id === id); return f ? f.name : id; };
const kindOrder = (k) => CAUSE_KINDS.indexOf(k);

/** The incidents a cause row allows for a subject (nemesis subjects: the major that nemesis leads). */
export function allowsOf(kind, subject) {
  const r = ROW[kind];
  if (!r) return [];
  if (kind === 'grievance' && typeof subject === 'string' && subject[0] === 'm') return [];
  return [...(r.allows[subject] || []), ...(r.allows['*'] || [])];
}
/** Every incident id some cause row can allow (data), for the validation test. */
export function causedIncidents() {
  const out = new Set();
  for (const r of DATA.cause) for (const k of Object.keys(r.allows)) for (const id of r.allows[k]) out.add(id);
  return out;
}

// ---- the sources ------------------------------------------------------------------------------------------
/** The worth (tenths of a coin) of the gems, coins and art in the hold now (what a trader sees). */
export function preciousWorth(s) {
  let n = 0;
  for (const it of s.items) {
    if (!it) continue;
    const d = def('item', it.k);
    if (!d || !PRECIOUS.has(d.cat)) continue;
    const m = it.m ? def('material', it.m) : null;
    n += Math.floor((d.value * (it.n | 0) * (m && m.value !== undefined ? m.value : 100)) / 100);
  }
  return n;
}
/** Hourly: note each live trader visit once (its worth seen), and drop notes from earlier years. */
export function noteRumours(s) {
  const st = s.st, tr = s.colony && s.colony.trade;
  if (!Array.isArray(st.rumour)) st.rumour = [];
  const y = yearOf(s.tick);
  if (st.rumour.length && Math.floor(st.rumour[0][0] / DAYS_PER_YEAR) !== y) st.rumour = st.rumour.filter((r) => Math.floor(r[0] / DAYS_PER_YEAR) === y);
  if (!tr || !tr.visits || !tr.visits.length) return;
  let vid = st.rumourVid | 0;
  for (const v of tr.visits) {
    if (v.id <= (st.rumourVid | 0)) continue;
    st.rumour.push([dayOf(s.tick), v.trader, preciousWorth(s)]);
    if (v.id > vid) vid = v.id;
  }
  st.rumourVid = vid;
  if (st.rumour.length > 24) st.rumour.splice(0, st.rumour.length - 24);
}
/** The Crown vaults (pre-history places) the hold has opened: [{ key, name, voxel }]. */
export function openedVaults(s) {
  if (!s.L || !s.L.fog) return [];
  const out = [];
  for (const p of prehistoryOf(s).places) if (p.kind === 'vault' && foundVoxel(s, p.voxel)) out.push(p);
  return out;
}
/** The pre-history founder of a faction (a figure name), or null. */
function founderOf(s, factionId) {
  const name = factionName(factionId);
  const f = prehistoryOf(s).figures.find((x) => x.kind === 'founder' && x.title === `Founder of the ${name}`);
  return f ? f.name : null;
}
function winterWeight(s) {
  const se = seasonOf(s.tick), ds = dayOf(s.tick) % DAYS_PER_SEASON, half = DAYS_PER_SEASON / 2;
  let w = 0;
  if (se === 3) w = K.winterDeep;
  else if ((se === 2 && ds >= half) || (se === 0 && ds < half)) w = K.winterEdge;
  if (weatherKind(s) === 'coldsnap') w += K.winterSnap;
  return w;
}
const leaned = (s, kind, w) => (w > 0 ? Math.max(1, Math.floor((w * causeLean(s, kind)) / 100)) : 0);

/** The live causes now (pure in s): [[kind, subject, weight]], sorted by kind order then subject. */
export function computeCauses(s) {
  const out = [];
  const add = (kind, subject, w) => { const v = leaned(s, kind, w); if (v > 0) out.push([kind, subject, v]); };
  // grievance: the pre-history, opened vaults, the Gutterkin's goodwill, nemeses
  add('grievance', 'ashfang', K.ashfangBase + K.vaultW * openedVaults(s).length);
  const g = (s.colony && s.colony.factions && s.colony.factions.gutterkin) | 0;
  if (g <= K.gutterkinFrom) add('grievance', 'gutterkin', K.gutterkinBase + Math.floor((K.gutterkinFrom - g) / K.gutterkinStep));
  for (const n of (s.st && s.st.nemeses) || []) add('grievance', 'm' + n.id, K.nemesisW);
  // rumour: this year's trader visits, per trader
  const per = new Map();
  for (const [, t, worth] of (s.st && s.st.rumour) || []) per.set(t, (per.get(t) | 0) + K.rumourBase + Math.min(K.rumourMax, Math.floor(worth / K.rumourWorth)));
  for (const [t, w] of per) add('rumour', t, w);
  // the Hollow's hunger: always, from the first night
  add('hunger', 'hollow', K.hungerBase + ((s.colony && s.colony.hearth && s.colony.hearth.lvl) | 0));
  // hard winter
  add('winter', ['thaw', 'highsun', 'ashfall', 'deepcold'][seasonOf(s.tick)], winterWeight(s));
  // a woken seep
  const br = logicOf('deep_breach');
  if (br && br.requires && br.requires(s)) add('seep', 'seep', 4);
  out.sort((a, b) => kindOrder(a[0]) - kindOrder(b[0]) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return out;
}
/** The day's cause list (recomputed once per game day; saved in s.st). */
export function liveCauses(s) {
  const st = s.st, day = dayOf(s.tick);
  if (st.causesDay !== day || !Array.isArray(st.causes)) { st.causes = computeCauses(s); st.causesDay = day; }
  return st.causes;
}
/** Hourly (storyteller): note trader visits; refresh the list on a new day. */
export function causesHour(s) { noteRumours(s); liveCauses(s); }

// ---- what the storyteller asks ------------------------------------------------------------------------------
const nemOf = (s, key) => { const id = +key.slice(1); return ((s.st && s.st.nemeses) || []).find((n) => n.id === id) || null; };
/** The rows that allow incident d now (nemesis rows allow only the major that nemesis leads, when nem is it). */
export function allowingCauses(s, d, nem = null) {
  const out = [];
  for (const c of liveCauses(s)) {
    if (c[0] === 'grievance' && c[1][0] === 'm') { if (nem && c[1] === 'm' + nem.id && incidentFor(nem) === d.id) out.push(c); continue; }
    if (allowsOf(c[0], c[1]).includes(d.id)) out.push(c);
  }
  return out;
}
/** Does this incident need a live cause? Every hostile one does (F26). */
export const needsCause = (d) => isHostile(d);
/** Summed weight of the causes allowing d (0: none). A non-hostile incident: 1. */
export function causeWeight(s, d, nem = null) {
  if (!needsCause(d)) return 1;
  let w = 0;
  for (const c of allowingCauses(s, d, nem)) w += c[2];
  return w;
}
/** The incident's pick weight with its causes: weight x clamp(sum, 1, max) / ref (at least 1 when caused). */
export function causedWeight(s, d) {
  const base = d.weight | 0;
  if (!needsCause(d) || base <= 0) return base;
  const w = causeWeight(s, d);
  if (w <= 0) return 0;
  return Math.max(1, Math.floor((base * Math.min(K.weightMax, w)) / K.weightRef));
}
/** The cause a scheduled incident names: the heaviest allowing row (ties: list order), or null. */
export function causeFor(s, d, nem = null) {
  let best = null;
  for (const c of allowingCauses(s, d, nem)) if (!best || c[2] > best[2]) best = c;
  return best ? [best[0], best[1]] : null;
}

/** The letter line for a cause [kind, subject] now. */
export function causeLine(s, cause) {
  if (!cause) return '';
  const [kind, subject] = cause;
  const t = (id, vars = {}) => fillText(TEXT[id] || '', vars);
  if (kind === 'grievance') {
    if (subject[0] === 'm') {
      const n = nemOf(s, subject);
      const c = n && n.grudge !== null && n.grudge !== undefined ? s.col.find((x) => x && x.id === n.grudge) : null;
      return t('cause_grievance_nemesis', { nemesis: n ? fullName(n) : 'An old enemy', target: c ? c.name : 'the hold' });
    }
    if (subject === 'gutterkin') return t('cause_grievance_gutterkin');
    const v = openedVaults(s);
    if (v.length) return t('cause_grievance_vault', { faction: factionName(subject), vault: v[v.length - 1].name });
    return t('cause_grievance_ashfang', { faction: factionName(subject), founder: founderOf(s, subject) || 'their founders' });
  }
  if (kind === 'rumour') { const d = def('trader', subject); return t('cause_rumour', { trader: d && d.name ? d.name.toLowerCase() : 'traders' }); }
  if (kind === 'hunger') return t((s.colony && s.colony.hearth && s.colony.hearth.lvl | 0) >= 3 ? 'cause_hunger_bright' : 'cause_hunger');
  if (kind === 'winter') return t(weatherKind(s) === 'coldsnap' ? 'cause_winter_snap' : 'cause_winter');
  if (kind === 'seep') return t('cause_seep');
  const r = ROW[kind];
  return r ? t(r.line) : '';
}
/** Append a cause line to a letter text (one space between; no line when there is no cause). */
export const withCause = (text, why) => (why ? `${text} ${why}` : text);
/** For tests: the weights' tuning row. */
export const CAUSE_TUNING = K;
