// Letters from incidents (doc 9.8, 9.10, 10.6). Owner H. Stage 2.
//
// Every incident speaks through the `letter` event (C8: { letterId, kind, ... }). A letter with
// choices also waits in the saved story record until it is answered with the `letter` command
// (C3 { id, choice }) or runs out:
//   s.st.letters = [Letter] by id; Letter = { id, kind, inc, title, text, choices: [label], data, until, deflt }
//   kind: 'omen' (a warned incident), 'incident' (it happened), 'minor' (small news: it does not drop
//   the speed to 1x, core/time.js SLOWDOWN_EVENTS), 'choice' (wanderer, migrants, refugees, a captive,
//   a stolen heirloom), 'nemesis'. Event payload: { letterId, kind, inc, title, text, choices, colId? }. The UI lists pending letters with pendingLetters(s) and
//   shows choices as buttons; `until` (tick) is when the default choice (deflt) is taken for the player.
// Choice handlers register by letter `kind` + `data.k` with onChoice(k, fn(s, letter, choice)); the
// applier dispatches only letters in s.st.letters (others: 'no such letter').
// Text comes from the incident's letter template ({var} placeholders; variants() of the text id).

import { TICKS_PER_HOUR } from '../core/time.js';
import { nextId } from '../core/state.js';
import { emit } from '../core/events.js';
import { registerApplier } from '../core/commands.js';
import { variants } from './defs.js';

export const LETTER_CAP = 12;
const HANDLERS = new Map();
/** Register the code that answers a choice letter of sub-kind k (data.k). */
export function onChoice(k, fn) { HANDLERS.set(k, fn); }

/** Fill a template: '{name}' -> vars.name. */
export function fillText(t, vars = {}) { return String(t).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m)); }
/** The text of a template id with vars (first variant), or the fallback. */
export function textOf(id, vars = {}, fallback = '') { const v = variants(id); return fillText(v.length ? v[0] : fallback, vars); }

const recOf = (s) => s.st.letters || (s.st.letters = []);
/** Pending choice letters, oldest first. */
export const pendingLetters = (s) => (s.st.letters || []).slice();
export const letterById = (s, id) => (s.st.letters || []).find((l) => l.id === id) || null;

/**
 * Send a letter. With `choices`, it waits for an answer (choice index; `deflt` is taken at `until`,
 * default 24 game hours). Returns the letter record (also for plain letters, not stored).
 */
export function sendLetter(s, kind, { inc = null, title = '', text = '', data = {}, choices = null, deflt = null, hours = 24 } = {}) {
  const id = nextId(s, 'letter');
  const l = { id, kind, inc, title, text, choices: choices || null, data, until: choices ? s.tick + hours * TICKS_PER_HOUR : s.tick, deflt: choices ? (deflt ?? choices.length - 1) : null };
  if (choices) {
    const rec = recOf(s);
    rec.push(l);
    while (rec.length > LETTER_CAP) answer(s, rec[0], rec[0].deflt);
  }
  emit(s, 'letter', { letterId: id, kind, inc, title, text, choices: l.choices, ...(data.colId !== undefined ? { colId: data.colId } : {}) });
  return l;
}

/** Answer a pending letter now. Returns null or a reason. */
export function answer(s, l, choice) {
  const rec = recOf(s), k = rec.indexOf(l);
  if (k < 0) return 'no such letter';
  if (!l.choices || choice < 0 || choice >= l.choices.length) return 'no such choice';
  rec.splice(k, 1);
  const fn = HANDLERS.get(l.data && l.data.k);
  if (fn) fn(s, l, choice);
  return null;
}

/** Hourly (storyteller): letters past their time take their default choice. */
export function expireLetters(s) {
  const rec = s.st.letters;
  if (!rec || !rec.length) return;
  for (const l of rec.slice()) if (s.tick >= l.until) answer(s, l, l.deflt);
}

export function installLetterCommand() {
  registerApplier('letter', (s, c) => {
    const l = letterById(s, c.id);
    if (!l) return { ok: false, reason: 'no such letter' };
    const r = answer(s, l, c.choice);
    return r ? { ok: false, reason: r } : { ok: true };
  });
}
