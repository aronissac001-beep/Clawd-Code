// News from the wider world (EMBERCROWN-WORLD.md 2.7 letters row, 2.8 news; owner K, step W3.8).
//
// The season tick (realm/tick.js) writes each change within 12 travel days of the hold as a rumour row in s.realm.ev
// (flags & EV_FLAG.rumour). World news never arrives out of nowhere: a rumour reaches the hold only with a traveller
// who arrived at or after the rumour's day - a caravan in s.colony.trade.visits (arrived at `until` minus the stay)
// or a visitor in s.colony.visitors (arrived on `day`) still in the hold. newsSystem, hourly, lets the latest such
// traveller deliver up to NEWS.lines rumours (the most important, then the newest) in one 'minor' letter and marks
// them EV_FLAG.delivered; a rumour no traveller brought within NEWS.staleYears is dropped unsent (marked delivered).
// With the realm record lost (9.2), pending rumours arrive as "word from the wider world is lost".
//
// State: only the flags of s.realm.ev rows (and the letter id counter). No rng, no rt key. A realm-less hold returns at
// once (the legacy-hash rule of 12.1). Text: the history grammar (js/data/text/realm.js eventText) over the record;
// the letter titles below move to G's text data with the strings layer (G25).
import { TICKS_PER_HOUR, TICKS_PER_DAY, dayOf } from '../core/time.js';
import { registerSystem, tickSystems } from '../core/bus.js';
import { EVENT_TYPES, EVENT_BYTES } from '../../data/realm/events.js';
import { eventText } from '../../data/text/realm.js';
import { sendLetter, fillText } from '../threat/letters.js';
import { realmRec } from './factions.js';
import { VISIT } from './trade.js';
import { EV_FLAG, rowYear } from '../realm/tick.js';

export const NEWS = Object.freeze({ lines: 3, staleYears: 1 });
export const NEWS_WORDS = Object.freeze({
  caravan: 'Word with the caravan from {site}', caravanAny: 'Word with the caravan', visitor: '{name} brings word',
  lost: 'Word from the wider world is lost.',
});

/** Rumour rows not yet delivered: [{ k, row }] in log order. */
export function pendingRumours(s) {
  const ev = (s.realm && s.realm.ev) || [], out = [];
  ev.forEach((row, k) => { if (Array.isArray(row) && row[1] >= 0 && (row[6] & EV_FLAG.rumour) && !(row[6] & EV_FLAG.delivered)) out.push({ k, row }); });
  return out;
}

/** The present traveller who arrived last: { kind: 'caravan' | 'visitor', at (tick), v }, or null. */
export function latestTraveller(s) {
  const day = dayOf(s.tick);
  let best = null;
  const offer = (kind, at, v) => { if (at <= s.tick && (!best || at > best.at || (at === best.at && kind === 'caravan' && best.kind !== 'caravan'))) best = { kind, at, v }; };
  for (const v of (s.colony.trade && s.colony.trade.visits) || []) if (v && v.until > s.tick) offer('caravan', v.until - VISIT.stayD * TICKS_PER_DAY, v);
  for (const v of s.colony.visitors || []) if (v && Number.isInteger(v.day) && !(v.leave < day)) offer('visitor', v.day * TICKS_PER_DAY, v);
  return best;
}

/** The text of rumour row `row` of hold s ({ text, links }), from the record's grammar; null without the record. */
export function rumourLine(s, R, row) {
  if (!R || !R.tables || !EVENT_TYPES[row[1]]) return null;
  // a one-row event log for the grammar: the row sits at index j so the line's variant varies with the day
  const j = (row[0] + row[1]) % 4, bytes = new Uint8Array((j + 1) * EVENT_BYTES), dv = new DataView(bytes.buffer), o = j * EVENT_BYTES;
  dv.setInt16(o, rowYear(s.realm, row), true); dv.setUint8(o + 2, row[1]); dv.setUint8(o + 3, 0);
  dv.setUint16(o + 4, row[2] & 0xffff, true); dv.setUint16(o + 6, row[3] & 0xffff, true); dv.setUint16(o + 8, row[4] & 0xffff, true); dv.setInt16(o + 10, row[5] | 0, true);
  const t = eventText({ tables: R.tables, events: bytes, n: R.n }, j);
  return { text: t.text, links: t.links };
}

function title(s, R, tr) {
  if (tr.kind === 'visitor') return fillText(NEWS_WORDS.visitor, { name: tr.v.name || 'A traveller' });
  const site = R && Number.isInteger(tr.v.site) && R.tables.sites[tr.v.site] ? R.tables.sites[tr.v.site].name : null;
  return site ? fillText(NEWS_WORDS.caravan, { site }) : NEWS_WORDS.caravanAny;
}

/** Hourly (slot 'colony', after the arrivals): a present traveller delivers the rumours older than its arrival. Returns the letter or null. */
export function newsSystem(s) {
  if (!s.realm || s.tick % TICKS_PER_HOUR !== 0 || !Array.isArray(s.realm.ev)) return null;
  const pend = pendingRumours(s);
  if (!pend.length) return null;
  const year = s.realm.year | 0;
  for (const p of pend) if (year - rowYear(s.realm, p.row) > NEWS.staleYears) p.row[6] |= EV_FLAG.delivered;
  const tr = latestTraveller(s);
  if (!tr) return null;
  const due = pend.filter((p) => !(p.row[6] & EV_FLAG.delivered) && p.row[0] * TICKS_PER_DAY <= tr.at);
  if (!due.length) return null;
  const imp = (p) => (EVENT_TYPES[p.row[1]] ? EVENT_TYPES[p.row[1]].imp : 0);
  due.sort((a, b) => imp(b) - imp(a) || b.row[0] - a.row[0] || b.k - a.k);
  const R = realmRec(s), take = R ? due.slice(0, NEWS.lines) : due;
  for (const p of take) p.row[6] |= EV_FLAG.delivered;
  const lines = R ? take.map((p) => rumourLine(s, R, p.row)).filter(Boolean) : [];
  const text = lines.length ? lines.map((l) => l.text).join(' ') : NEWS_WORDS.lost;
  return sendLetter(s, 'minor', { title: title(s, R, tr), text, data: { k: 'news', from: tr.kind, rows: take.map((p) => p.k), links: lines.flatMap((l) => l.links) } });
}

/** Register the news system (idempotent). colony/index.js calls it (W3.8 request to K) with the Z2 systems. */
export function installNews() {
  if (!tickSystems().some((x) => x.slot === 'colony' && x.name === 'news')) registerSystem('colony', 'news', newsSystem, 147);
}
