// The fall and the Ruin, the screens (owner I; EMBERCROWN-FORTRESS.md 1.3, F8). The state, the slots and
// the fall test are A's (js/game/colony/fall.js, js/main.js); this module only reads them.
//
// A hold falls when no colonist is free and able for 24 game hours. The fall is final: there is no
// Reclaim, and the Fallen card offers no backup (Recover from a device problem lives in Settings >
// Storage). What the player gets is the record:
//   hearthColdView(el, summary, acts)   the final screen, "The Hearth goes cold": years lived, deeds, the
//                                       dead with causes, the deepest distance into rock (levels in the
//                                       fortress), named artifacts, great beasts slain, the last page
//   annalsView(el, s)                   the Annals, read-only (Stage 2.9: the Chronicle, by year)
//   annalsText(s)                       the same as plain text (the Export's .txt)
//   fallenCard(card, on)                the title's Fallen card: a greyed banner, "Fell in Year 3,
//                                       Ashfall day 4", Annals, View the ruin, Export, Delete. No Continue.
//   loadRuinState(id)                   a colony's newest readable copy as a state (no app.s side effects)
//   prepareRuinExport(id, s?)           the two export files, built ahead of the tap (iOS needs the share
//                                       sheet inside the tap); shareRuinExport(prep) shares or downloads
//   playDefeat()                        the defeat stinger (D's audio)
// The read-only ruin viewer is the in-game shell in ruin mode (shell.js: no commands, no speed, nothing
// ticks; camera, inspection and sheets stay).
import { h, onTap, icon } from './kit.js';
import { dateText, yearOf, DAYS_PER_YEAR } from '../game/core/time.js';
import { chronLine } from '../game/colony/chronicle.js';
import { def } from '../game/core/content.js';
import { fallSummary, isFallen } from '../game/colony/fall.js';
import { installSim } from '../game/core/setup.js';
import { readSlots, exportBlob } from '../game/save/slots.js';
import { loadBlob } from '../game/save/colonysave.js';
import { audio } from '../engine/audio.js';
import { STAGE } from './stage.js';

export const RUIN_TEXT = Object.freeze({
  title: 'The Hearth goes cold',
  banner: 'Fallen',
  view: 'View the ruin', viewSub: 'The map as it was left. Nothing moves.',
  annals: 'Annals', annalsSub: 'The hold\'s story, start to end',
  export: 'Export', exportSub: 'The save and the Annals as text',
  del: 'Delete', delSure: 'Delete for good', delSub: 'This cannot be undone',
  leave: 'Back to the title',
  readOnly: 'This hold has fallen: the ruin can be read, not changed.',
  never: 'A fallen hold stays fallen. A new colony is always a new map.',
});

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/** "Fell in Year 3, Ashfall day 4" (the card and the final screen). */
export const fellLine = (fellAt) => (Number.isInteger(fellAt) ? `Fell in ${dateText(fellAt)}` : 'Fallen');
/** "3 years and 12 days" or "40 days". */
export function livedText(days) {
  const y = Math.floor(days / DAYS_PER_YEAR), d = days % DAYS_PER_YEAR;
  if (!y && !d) return 'less than a day';
  if (!y) return plural(d, 'day');
  return d ? `${plural(y, 'year')} and ${plural(d, 'day')}` : plural(y, 'year');
}

/** The defeat stinger (1.3): plays once when a hold falls. Silent where audio is locked or missing. */
export function playDefeat() { try { audio.play('defeat', { vol: 0.9 }); } catch (_) { /* no audio */ } }

// ---- The final screen ------------------------------------------------------------------------------
/**
 * Fill `el` with "The Hearth goes cold". summary: colony/fall.js fallSummary(s). acts: [{ label, sub?, act,
 * fn, primary? }] (View the ruin, Annals, Export, Back to the title), shown as full-width buttons.
 */
export function hearthColdView(el, summary, acts = []) {
  const sm = summary || {};
  el.classList.add('ec-cold');
  el.append(h('div.ec-cold-head', null, h('span.ec-cold-ic', { html: icon('flame') }),
    h('div', null, h('p.ec-cold-name', { text: sm.name || 'The hold' }), h('p.ec-cold-when', { text: `${fellLine(sm.fellAt)}, after ${livedText(sm.daysLived | 0)}.` }))));
  el.append(h('p.ec-note', { text: 'No one was left to tend the Hearth. The hold is a ruin now: its story can be read, and it will not change again.' }));
  const sec = (title, rows, empty) => {
    el.append(h('h3.ec-sub', { text: title }));
    if (!rows.length) { el.append(h('p.ec-bio-d', { text: empty })); return; }
    const list = h('ul.ec-cold-list');
    for (const r of rows) list.append(h('li', { text: r }));
    el.append(list);
  };
  const dead = (sm.dead || []).slice().sort((a, b) => (a.tick || 0) - (b.tick || 0));
  sec(dead.length ? `The dead (${dead.length})` : 'The dead', dead.map((d) => `${d.name}: ${d.cause}${Number.isInteger(d.tick) ? `, ${dateText(d.tick)}` : ''}`), 'No one died before the end.');
  sec('Deeds', (sm.deeds || []).map((d) => deedName(d)), 'No deeds were done.');
  el.append(h('h3.ec-sub', { text: 'The deep' }), h('p.ec-bio-d', { text: sm.deepest > 0 ? `Deepest under the rock: ${plural(sm.deepest, 'tile')} from open sky.` : 'The hold never went under the mountain.' }));
  sec('Named works', (sm.artifacts || []).map((a) => (a.maker ? `${a.name}, made by ${a.maker}` : a.name)), 'No named work was made.');
  sec('Great beasts slain', sm.beasts || [], 'None.');
  const page = (sm.lastPage || []).filter((e) => e && e[1] !== 'year');
  sec('The last page', page.map((e) => `${dateText(e[0])}: ${chronLine(e)}`), 'The Chronicle is empty.');
  if (acts.length) {
    const box = h('div.ec-cold-acts');
    for (const a of acts) {
      const b = h('button.ec-btn' + (a.primary ? '.primary' : ''), { type: 'button', 'data-act': a.act }, h('span.ec-btn-label', { text: a.label }), a.sub ? h('span.ec-btn-sub', { text: a.sub }) : null);
      onTap(b, a.fn);
      box.append(b);
    }
    el.append(box);
  }
  return el;
}
/** A deed id (colony.deeds) as words: the data row's name when the registry has it. */
function deedName(id) {
  if (id && typeof id === 'object') return id.name || id.id || '';
  let d = null;
  try { d = def('deed', id); } catch (_) { d = null; }
  if (d && d.name) return d.name;
  return String(id).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

// ---- The Annals (Stage 2.9: the Chronicle) -----------------------------------------------------------
/** Every Chronicle entry, oldest first: [{ tick, year, date, kind, text }] (yearly summaries keep their place). */
export function annalsEntries(s) {
  return (s.chron || []).map((e) => ({ tick: e[0], year: yearOf(e[0]) + 1, date: dateText(e[0]), kind: e[1], text: chronLine(e) }));
}
/** The Annals as plain text, for the Export (a .txt beside the save). */
export function annalsText(s) {
  const out = [`${s.name}: the Annals`, ''];
  const sm = fallSummary(s);
  if (sm.fallen) out.push(`${fellLine(sm.fellAt)}, after ${livedText(sm.daysLived)}.`, '');
  let year = null;
  for (const e of annalsEntries(s)) {
    if (e.year !== year) { year = e.year; out.push('', `Year ${year}`); }
    out.push(e.kind === 'year' ? `  ${e.text}` : `  ${e.date}: ${e.text}`);
  }
  if (sm.dead.length) { out.push('', 'The dead'); for (const d of sm.dead) out.push(`  ${d.name}: ${d.cause}`); }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
/** The Annals, read-only: year headings, then each line with its date. */
export function annalsView(el, s) {
  el.classList.add('ec-annals');
  const sm = fallSummary(s);
  el.append(h('p.ec-note', { text: sm.fallen ? `${s.name}. ${fellLine(sm.fellAt)}, after ${livedText(sm.daysLived)}.` : `${s.name}: the story so far.` }));
  const all = annalsEntries(s);
  if (!all.length) { el.append(h('p.ec-bio-d', { text: 'The Annals are empty.' })); return el; }
  let year = null, list = null;
  for (const e of all) {
    if (e.year !== year) { year = e.year; el.append(h('h3.ec-sub', { text: `Year ${year}` })); list = h('ul.ec-cold-list'); el.append(list); }
    list.append(h('li', null, e.kind === 'year' ? null : h('span.ec-annals-d', { text: e.date.replace(/^Year \d+, /, '') + ': ' }), e.text));
  }
  return el;
}

// ---- The title's Fallen card --------------------------------------------------------------------------
/**
 * The Fallen card (1.3) for a colony card (slots.cardOf: { id, name, fallen, fallenAt, pop, ... }).
 * on: { annals(card), view(card), export(card), del(card) }. Delete asks once more on the card itself.
 */
export function fallenCard(card, on = {}) {
  const el = h('section.ec-fallen', { 'aria-label': `${card.name}, fallen`, 'data-colony': card.id },
    h('div.ec-fallen-banner', null, h('span.ec-fallen-ic', { html: icon('ruin') }), h('span.ec-fallen-tag', { text: RUIN_TEXT.banner })),
    h('p.ec-fallen-name', { text: card.name }),
    h('p.ec-fallen-when', { text: fellLine(card.fallenAt) }));
  const row = h('div.ec-fallen-acts');
  const btn = (label, act, ic, fn) => {
    const b = h('button.ec-fallen-b', { type: 'button', 'data-act': act, 'data-colony': card.id }, h('span', { html: icon(ic) }), h('span.ec-fallen-bl', { text: label }));
    onTap(b, fn);
    return b;
  };
  row.append(
    btn(RUIN_TEXT.annals, 'ruin-annals', 'book', () => on.annals && on.annals(card)),
    btn(RUIN_TEXT.view, 'ruin-view', 'eye', () => on.view && on.view(card)),
    btn(RUIN_TEXT.export, 'ruin-export', 'export', () => on.export && on.export(card)),
  );
  const del = btn(RUIN_TEXT.del, 'ruin-delete', 'trash', () => {
    if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.classList.add('bad'); del.querySelector('.ec-fallen-bl').textContent = RUIN_TEXT.delSure; return; }
    if (on.del) on.del(card);
  });
  row.append(del);
  el.append(row);
  return el;
}

// ---- Loading and exporting a ruin ---------------------------------------------------------------------
/** The colony's newest readable copy as a state (the sim installed at the UI's stage); null when none is stored. */
export async function loadRuinState(id) {
  installSim({ stage: STAGE });
  let err = null;
  for (const slot of await readSlots(id)) {
    try { const s = await loadBlob(slot.bytes); s.id = id; return s; } catch (e) { err = e; }
  }
  if (err) throw err;
  return null;
}
/**
 * The two export files of a colony: its newest save (.ecsave) and its Annals (.txt). `s` (the loaded
 * state) saves a second read. Resolves to { id, files: [{ name, bytes, type }], at }.
 */
export async function prepareRuinExport(id, s = null) {
  const ex = await exportBlob(id);
  const st = s || await loadRuinState(id);
  const text = st ? annalsText(st) : '';
  const base = ex.filename.replace(/\.ecsave$/, '');
  const files = [{ name: ex.filename, bytes: ex.bytes, type: 'application/octet-stream' }];
  if (text) files.push({ name: `${base}-annals.txt`, bytes: new TextEncoder().encode(text), type: 'text/plain' });
  return { id, files, at: Date.now(), fallen: !!(st && isFallen(st)) };
}
/** Share both files (the share sheet), else download them. Call it from the tap. -> { ok, via, names } */
export async function shareRuinExport(prep) {
  const names = prep.files.map((f) => f.name);
  const asFiles = typeof File === 'function' ? prep.files.map((f) => new File([f.bytes], f.name, { type: f.type })) : null;
  try {
    if (asFiles && navigator.canShare && navigator.share && navigator.canShare({ files: asFiles })) {
      await navigator.share({ files: asFiles, title: names[0] });
      return { ok: true, via: 'share', names };
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, via: 'share', reason: 'cancelled', names };
  }
  for (const f of prep.files) download(f.bytes, f.name, f.type);
  return { ok: true, via: 'download', names };
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
/** The toast after an export. */
export const exportedText = (r) => (!r || !r.ok ? (r && r.reason === 'cancelled' ? '' : 'The export failed.') : r.via === 'share' ? 'Exported: the save and the Annals.' : `Saved to your downloads: ${r.names.join(' and ')}.`);
