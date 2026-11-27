// The Annals screen (EMBERCROWN-FORTRESS.md 3.5, 4.6; step Z2.3). Colony > Annals, the ruin viewer and the
// title's Annals of a fallen hold. Logic and records: js/game/colony/legends.js (K); words:
// js/data/text/legends.js.
//
//   openAnnals(ctx, tab)            the Annals sheet in the game (tabs Years, Figures, Artifacts, Places)
//   annalsView(el, s, ctx, state)   the same view into any element (ctx null: read-only, no Show on map)
//   annalsText(s)                   the whole Annals as plain text (the export; for a Ruin, the keepsake)
//
// Years opens with the vale's pre-history ("Before the Hearth"), then the hold's years from the Chronicle and
// the legend records. Every entry is a short page with 44 pt links to related entries and, for a place or a
// colonist the hold can see, "Show on map" (it sets the level). Pre-history places stay off the map until the
// hold has found them (the fog bit), so the Annals never spoil a vault or a lair.
import { h, onTap, clear } from './kit.js';
import { dateText, yearOf, dayOf, DAYS_PER_YEAR, TICKS_PER_DAY } from '../game/core/time.js';
import { chronLine } from '../game/colony/chronicle.js';
import {
  prehistoryOf, figuresOf, artifactsOf, placesOf, holdYears, relatedOf, prehistoryEventsOf, recordLinesOf, entryVoxel,
} from '../game/colony/legends.js';
import { ANNALS_TEXT as T } from '../data/text/legends.js';

const TILE = 32;
const ROW = { minHeight: '44px', width: '100%', textAlign: 'left', display: 'grid' };
const dayText = (day) => dateText(day * TICKS_PER_DAY);

/** Every entry of the Annals by key: figures, artifacts and places (those with no key get one). */
export function annalsIndex(s) {
  const idx = new Map();
  let n = 0;
  const put = (tab, e) => { if (!e.key) e.key = 'x' + n++; e.tab = tab; idx.set(e.key, e); };
  for (const e of figuresOf(s)) put('Figures', e);
  for (const e of artifactsOf(s)) put('Artifacts', e);
  for (const e of placesOf(s)) put('Places', e);
  return idx;
}

/** The Annals sheet (Colony > Annals). */
export function openAnnals(ctx, tab = 'Years') {
  const state = { tab: T.tabs.includes(tab) ? tab : 'Years', page: [] };
  ctx.openSheet(T.title, (el) => annalsView(el, ctx.s, ctx, state), { push: true });
}

/** The Annals into el. state: { tab, page: [keys] } (kept by the caller across re-renders). */
export function annalsView(el, s, ctx = null, state = { tab: 'Years', page: [] }) {
  el.classList.add('ec-annals');
  const box = h('div.ec-annals-box');
  el.append(box);
  const index = annalsIndex(s);
  const draw = () => {
    clear(box);
    if (state.page.length) { pageView(box, s, ctx, state, index, draw); return; }
    const seg = h('div.ec-seg', { role: 'tablist', 'aria-label': 'Annals' });
    for (const t of T.tabs) {
      const b = h('button.ec-seg-b' + (t === state.tab ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': t === state.tab ? 'true' : 'false', 'data-act': 'annals-' + t.toLowerCase(), text: t });
      onTap(b, () => { state.tab = t; draw(); });
      seg.append(b);
    }
    box.append(seg);
    const open = (key) => { state.page.push(key); draw(); };
    if (state.tab === 'Years') yearsTab(box, s, index, open);
    else listTab(box, s, state.tab, index, open);
  };
  draw();
  return el;
}

function row(label, sub, act, fn, tint = null) {
  const b = h('button.ec-ruler-row.ec-annals-row', { type: 'button', 'data-act': act, style: tint ? { '--tint': tint } : null },
    h('span.ec-ruler-t', { text: label }), sub ? h('span.ec-bio-d', { text: sub, style: { display: 'block', margin: '0' } }) : null);
  onTap(b, fn);
  return b;
}
const TINT = { living: '#7fa05a', dead: '#8a6f6a', old: '#8f7f62', hold: '#c9973e' };

function yearsTab(el, s, index, open) {
  const pre = prehistoryOf(s);
  el.append(h('h3.ec-sub', { text: T.prehistory }), h('p.ec-note', { text: T.prehistoryNote }));
  for (const e of pre.events) {
    const key = e.figs.find((k) => index.has(k)) || null;
    const line = h('div.ec-log', null, h('span.ec-log-d', { text: T.crownYear(e.y) }), h('span.ec-log-t', { text: e.text }));
    if (key) { const b = h('button.ec-annals-ev', { type: 'button', 'data-act': 'annals-ev', style: ROW }, line); onTap(b, () => open(key)); el.append(b); }
    else el.append(line);
  }
  // the hold's years: the Chronicle and the record lines it does not carry, by day
  const lines = (s.chron || []).map((c) => ({ day: dayOf(c[0]), text: chronLine(c), sum: c[1] === 'year', yr: c[1] === 'year' && c[3] ? c[3].year : null }));
  for (const r of holdYears(s)) lines.push({ day: r.day, text: r.text, key: r.key });
  lines.sort((a, b) => a.day - b.day);
  let year = null;
  for (const l of lines) {
    const y = l.yr !== null && l.yr !== undefined ? l.yr : Math.floor(l.day / DAYS_PER_YEAR);
    if (y !== year) { year = y; el.append(h('h3.ec-sub', { text: `Year ${y + 1}` })); }
    const line = h('div.ec-log', null, h('span.ec-log-d', { text: l.sum ? 'Summary' : dayText(l.day).replace(/^Year \d+, /, '') }), h('span.ec-log-t', { text: l.text }));
    if (l.key && index.has(l.key)) { const b = h('button.ec-annals-ev', { type: 'button', 'data-act': 'annals-ev', style: ROW }, line); onTap(b, () => open(l.key)); el.append(b); }
    else el.append(line);
  }
  if (!lines.length) el.append(h('p.ec-note', { text: 'The hold\'s own story starts at the founding.' }));
}

function listTab(el, s, tab, index, open) {
  const items = [...index.values()].filter((e) => e.tab === tab);
  const groups = tab === 'Figures' ? [['living', T.living], ['dead', T.dead], ['old', T.ofOld]] : [['hold', 'Of the hold'], ['old', T.ofOld]];
  const empty = { Figures: T.noFigures, Artifacts: T.noArtifacts, Places: T.noPlaces }[tab];
  if (!items.some((e) => e.group !== 'old')) el.append(h('p.ec-note', { text: empty }));
  for (const [g, label] of groups) {
    const list = items.filter((e) => e.group === g);
    if (!list.length) continue;
    el.append(h('h3.ec-sub', { text: `${label} (${list.length})` }));
    for (const e of list) el.append(row(e.name, e.sub, 'annals-entry', () => open(e.key), TINT[g]));
  }
}

function pageView(el, s, ctx, state, index, draw) {
  const key = state.page[state.page.length - 1], e = index.get(key);
  const back = h('button.ec-rchip', { type: 'button', 'data-act': 'annals-back', text: 'Back' });
  onTap(back, () => { state.page.pop(); draw(); });
  el.append(h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, back));
  if (!e) { el.append(h('p.ec-note', { text: 'This entry is gone.' })); return; }
  el.append(h('h3.ec-sub', { text: e.name }));
  if (e.sub) el.append(h('p.ec-bio-d', { text: e.sub }));
  if (e.text) el.append(h('p.ec-bio-d', { text: e.text }));
  if (e.from !== undefined && e.from !== null) el.append(h('p.ec-bio-d', { text: e.to !== undefined && e.to !== null ? `Crown years ${e.from} to ${e.to}.` : `From Crown year ${e.from}.` }));
  if (e.day !== undefined && e.day !== null) el.append(h('p.ec-bio-d', { text: `First in the Annals: ${dayText(e.day)}.` }));
  // what happened: pre-history events, the hold's record lines, the Chronicle lines that name it
  const lines = [];
  for (const ev of prehistoryEventsOf(s, key)) lines.push([T.crownYear(ev.y), ev.text]);
  for (const r of recordLinesOf(s, key)) lines.push([dayText(r.day).replace(/, .*$/, ''), r.text]);
  if (e.group !== 'old' && e.name) {
    for (const c of s.chron || []) {
      const a = c[3] || {};
      if (a.name === e.name || a.maker === e.name || a.tamer === e.name || a.item === e.name) lines.push([`Year ${yearOf(c[0]) + 1}`, chronLine(c)]);
    }
  }
  for (const [d, t] of lines) el.append(h('div.ec-log', null, h('span.ec-log-d', { text: d }), h('span.ec-log-t', { text: t })));
  // Show on map (sets the level)
  if (ctx && ctx.centerOn) {
    let go = null;
    const v = entryVoxel(s, e);
    if (v >= 0) {
      const plane = s.w * s.h, z = Math.floor(v / plane), c = v % plane;
      go = () => { ctx.closeSheet(); if (ctx.setLevel) ctx.setLevel(z); ctx.centerOn(((c % s.w) + 0.5) * TILE, (Math.floor(c / s.w) + 0.5) * TILE); };
    } else if (e.colId !== undefined && e.group === 'living') {
      const col = s.col.find((x) => x && x.id === e.colId);
      if (col) go = () => { ctx.closeSheet(); if (ctx.setLevel) ctx.setLevel(col.z | 0); ctx.centerOn(col.x, col.y); if (ctx.select) ctx.select({ kind: 'colonist', id: col.id }); };
    }
    if (go) { const b = h('button.ec-btn', { type: 'button', 'data-act': 'annals-map', style: { minHeight: '44px', marginTop: '10px' } }, h('span.ec-btn-label', { text: T.showOnMap })); onTap(b, go); el.append(b); }
    else if (e.group === 'old' && e.voxel !== undefined) el.append(h('p.ec-note', { text: T.unseen }));
  }
  // related entries
  const rel = relatedOf(s, key).filter((k) => index.has(k));
  if (rel.length) {
    el.append(h('h3.ec-sub', { text: T.related }));
    const chips = h('div.ec-rchips', { style: { flexWrap: 'wrap', justifyContent: 'flex-start' } });
    for (const k of rel.slice(0, 24)) { const b = h('button.ec-rchip', { type: 'button', 'data-act': 'annals-link', text: index.get(k).name, style: { maxWidth: '100%' } }); onTap(b, () => { state.page.push(k); draw(); }); chips.append(b); }
    el.append(chips);
  }
}

/** The whole Annals as plain text (export). */
export function annalsText(s) {
  const pre = prehistoryOf(s), out = [`${s.name}: the Annals`, '', T.prehistory, ''];
  for (const e of pre.events) out.push(`  ${T.crownYear(e.y)}: ${e.text}`);
  const lines = (s.chron || []).map((c) => ({ day: dayOf(c[0]), text: chronLine(c), sum: c[1] === 'year' }));
  for (const r of holdYears(s)) lines.push({ day: r.day, text: r.text });
  lines.sort((a, b) => a.day - b.day);
  let year = null;
  for (const l of lines) {
    const y = Math.floor(l.day / DAYS_PER_YEAR);
    if (y !== year) { year = y; out.push('', `Year ${y + 1}`); }
    out.push(l.sum ? `  ${l.text}` : `  ${dayText(l.day)}: ${l.text}`);
  }
  const idx = annalsIndex(s);
  for (const tab of ['Figures', 'Artifacts', 'Places']) {
    out.push('', tab);
    for (const e of idx.values()) if (e.tab === tab) out.push(`  ${e.name}${e.sub ? ': ' + e.sub : ''}`);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
