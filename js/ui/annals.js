// The Annals screen (EMBERCROWN-FORTRESS.md 3.5, 4.6; step Z2.3). Colony > Annals, the ruin viewer and the
// title's Annals of a fallen hold. Logic and records: js/game/colony/legends.js (K); words:
// js/data/text/legends.js.
//
//   openAnnals(ctx, tab)            the Annals sheet in the game (tabs Years, Figures, Artifacts, Places)
//   annalsView(el, s, ctx, state)   the same view into any element (ctx null: read-only, no Show on map)
//   annalsText(s)                   the whole Annals as plain text (the export; for a Ruin, the keepsake)
//
// W1.3b (EMBERCROWN-WORLD.md 8.5): the World sheet's Annals tab is this view; the filters are one row of chips in
// the order Years, Figures, Places, Artifacts (Wars and World come with the realm's history, W3), and in the game
// an entry pushes inside the open sheet ("World / <entry>", the sheet's back arrow returns) instead of paging
// inside the view; read-only views (the ruin, the title) still page inside with a Back chip.
//
// W3.2 (EMBERCROWN-WORLD.md 2.6, 2.7 first row, 8.5): a hold in a world gets two more chips, Wars and World.
// World lists Eras, Civilizations, Peoples, Sites, Figures, Artifacts and Beasts of the world's history; world
// records have keys w<kind><n> (wc2 civ, ws3 site, wf12 figure, wa7 artifact, wb1 beast, ww4 war) beside the
// hold's own p<n>/q<n>, and their lines come from js/data/text/realm.js (never stored; rendered only for the
// rows shown, 40 at a time, with its cache of 200 strings). Every name in a world entry is a 44 pt link (a row
// or a Related chip); a line's row opens the other record it names. "Show on map" on a site (a civ's seat, a
// lair, a lost artifact's place) calls state.showSite(rx, ry, key): the World sheet's Map tab with the site
// selected (worldui.js). The realm record is read once per world from the store (holdRealm, 9.2 fallbacks).
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
import { resolveRealm } from '../game/save/realmstore.js';
import {
  WORLD_TEXT as W, eventText, eventMeta, eventCount, eventsOf, recordOf, recordName, parseWorldKey, isWorldKey, worldKey,
  figureName, artifactName, artifactDesc, civText, civName, warName, yearText, peopleWord, SITE_WORDS, ROLE_WORDS, CIVKIND_WORDS, oathText,
} from '../data/text/realm.js';

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
    const seg = h('div.ec-seg', { role: 'tablist', 'aria-label': 'Annals', style: { flexWrap: 'wrap' } });
    const chips = filterOrder(s);
    if (!chips.includes(state.tab)) state.tab = 'Years';
    for (const t of chips) {
      const b = h('button.ec-seg-b' + (t === state.tab ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': t === state.tab ? 'true' : 'false', 'data-act': 'annals-' + t.toLowerCase(), text: t, style: chips.length > 4 ? { whiteSpace: 'nowrap', flex: '1 0 auto' } : null });
      onTap(b, () => { state.tab = t; draw(); });
      seg.append(b);
    }
    box.append(seg);
    // in the game an entry pushes inside the sheet (one sheet, the back arrow); elsewhere it pages in the view
    const open = (key) => { if (ctx && ctx.openSheet && ctx.sheets) pushEntry(ctx, s, key, { showSite: state.showSite }); else { state.page.push(key); draw(); } };
    if (state.tab === 'Years') yearsTab(box, s, index, open);
    else if (state.tab === W.tabWars || state.tab === W.tabWorld) worldTab(box, s, state.tab, open, draw);
    else { listTab(box, s, state.tab, index, open); worldMore(box, s, state.tab, open, draw); }
  };
  draw();
  return el;
}

/** The filter chips in reading order (8.5): Years, Figures, Places, Artifacts, then any others the words add. */
const ORDER = ['Years', 'Figures', 'Places', 'Artifacts'];
const filterOrder = (s) => [...ORDER.filter((x) => T.tabs.includes(x)), ...T.tabs.filter((x) => !ORDER.includes(x)), ...(s && s.realm ? [W.tabWars, W.tabWorld] : [])];

/** An entry pushed inside the open sheet; its links push further ("World / Annals entry / ..."). */
export function pushEntry(ctx, s, key, opt = {}) {
  if (isWorldPage(key)) {
    const R = holdRealm(s);
    ctx.openSheet(worldTitle(R.realm, key), (el) => {
      el.classList.add('ec-annals');
      const box = h('div.ec-annals-box');
      el.append(box);
      worldPage(box, s, key, (k) => pushEntry(ctx, s, k, opt), opt.showSite || null, true);
    }, { push: true });
    return;
  }
  const index = annalsIndex(s), e = index.get(key);
  ctx.openSheet(e && e.name ? e.name : T.title, (el) => {
    el.classList.add('ec-annals');
    const box = h('div.ec-annals-box');
    el.append(box);
    entryView(box, s, ctx, key, annalsIndex(s), (k) => pushEntry(ctx, s, k));
  }, { push: true });
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
  const key = state.page[state.page.length - 1];
  const back = h('button.ec-rchip', { type: 'button', 'data-act': 'annals-back', text: 'Back' });
  onTap(back, () => { state.page.pop(); draw(); });
  el.append(h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, back));
  if (isWorldPage(key)) { worldPage(el, s, key, (k) => { state.page.push(k); draw(); }, state.showSite || null, false); return; }
  entryView(el, s, ctx, key, index, (k) => { state.page.push(k); draw(); });
}

/** One entry: what it is, what happened, Show on map, the related entries (follow(key) opens a link). */
function entryView(el, s, ctx, key, index, follow) {
  const e = index.get(key);
  if (!e) { el.append(h('p.ec-note', { text: 'This entry is gone.' })); return; }
  if (!(ctx && ctx.sheets)) el.append(h('h3.ec-sub', { text: e.name }));
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
    for (const k of rel.slice(0, 24)) { const b = h('button.ec-rchip', { type: 'button', 'data-act': 'annals-link', text: index.get(k).name, style: { maxWidth: '100%' } }); onTap(b, () => follow(k)); chips.append(b); }
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

// ---- the world (W3.2) ------------------------------------------------------------------------------------------
/** UI memory (never saved): the realm record of each world, read once a session. */
const realms = new Map();
/**
 * The realm object of a hold's world: { status: 'none' | 'loading' | 'ready' | 'missing', realm }. The first call
 * reads the record (realmstore.js resolveRealm: the store, the dawn copy, regeneration); onReady() runs when a
 * load finishes. A missing record is asked for again on the next open.
 */
export function holdRealm(s, onReady = null) {
  const ref = s && s.realm;
  if (!ref || !Number.isInteger(ref.wid)) return { status: 'none', realm: null };
  const wid = ref.wid >>> 0;
  let e = realms.get(wid);
  if (!e) {
    e = { status: 'loading', realm: null, waiters: new Set() };
    realms.set(wid, e);
    const done = (realm) => {
      e.status = realm ? 'ready' : 'missing'; e.realm = realm || null;
      if (!realm) realms.delete(wid);
      const ws = [...e.waiters]; e.waiters.clear();
      for (const f of ws) { try { f(); } catch (_) { /* a closed view */ } }
    };
    let p = null;
    try { p = resolveRealm({ ref: { wid, crc: ref.crc, params: ref.params }, colonyId: s.id || null }); } catch (_) { p = null; }
    if (p && p.then) p.then((r) => done(r && r.realm), () => done(null)); else done(null);
  }
  if (e.status === 'loading' && onReady) e.waiters.add(onReady);
  return e;
}
/** Seed the session's realm cache (a world just created or read elsewhere; tests). */
export function noteHoldRealm(realm) { if (realm && Number.isInteger(realm.wid)) realms.set(realm.wid >>> 0, { status: 'ready', realm, waiters: new Set() }); }

const isWorldPage = (key) => isWorldKey(key) || (typeof key === 'string' && key.startsWith('wl:'));
const hasHistory = (realm) => !!(realm && realm.tables && realm.tables.civs && realm.tables.civs.length);
const PAGE = 40;
const SECTIONS = ['eras', 'civs', 'peoples', 'sites', 'figures', 'artifacts', 'beasts'];
const ERA_YEARS = 50;

function worldTitle(realm, key) {
  if (key.startsWith('wl:era:')) { const i = +key.slice(7); return W.era(i * ERA_YEARS, Math.min(realm ? realm.years | 0 : 0, i * ERA_YEARS + ERA_YEARS - 1)); }
  if (key.startsWith('wl:')) return W.sections[key.slice(3)] || T.title;
  return (realm && recordName(realm, key)) || T.title;
}
/** The note a world view shows instead of its rows when the record is not ready; null when it is. */
function realmNote(el, R) {
  if (R.status === 'ready' && hasHistory(R.realm)) return false;
  const text = R.status === 'none' ? W.noWorld : R.status === 'loading' ? W.loading : R.status === 'missing' ? W.missing : W.noHistory;
  el.append(h('p.ec-note', { text, 'data-world': R.status === 'ready' ? 'empty' : R.status }));
  return true;
}

/** The Wars and World chips. */
function worldTab(el, s, tab, open, redraw) {
  const R = holdRealm(s, redraw);
  if (realmNote(el, R)) return;
  const realm = R.realm, T2 = realm.tables;
  if (tab === W.tabWars) {
    if (!T2.wars.length) { el.append(h('p.ec-note', { text: W.noWars })); return; }
    const on = T2.wars.filter((w) => w.ended === null), done = T2.wars.filter((w) => w.ended !== null);
    group(el, W.ongoing, on, (w) => warRow(realm, w, open));
    group(el, W.ended, done.slice().reverse(), (w) => warRow(realm, w, open));
    return;
  }
  el.append(h('p.ec-note', { text: W.worldOf(realm.params && realm.params.name ? realm.params.name : '', realm.years | 0) }));
  const counts = { eras: eras(realm).length, civs: T2.civs.length, peoples: new Set(T2.civs.map((c) => c.people)).size, sites: T2.sites.length,
    figures: T2.figures.length, artifacts: T2.artifacts.length, beasts: T2.beasts.length };
  for (const k of SECTIONS) el.append(row(`${W.sections[k]} (${counts[k]})`, W.sectionSub[k], 'world-section', () => open('wl:' + k)));
}
/** Under the hold's Figures, Places and Artifacts: one row into the world's list. */
function worldMore(el, s, tab, open, redraw) {
  if (!s.realm) return;
  const R = holdRealm(s, redraw);
  if (R.status !== 'ready' || !hasHistory(R.realm)) return;
  const T2 = R.realm.tables, map = { Figures: ['figures', W.worldFigures(T2.figures.length)], Places: ['sites', W.worldPlaces(T2.sites.length)], Artifacts: ['artifacts', W.worldArtifacts(T2.artifacts.length)] }[tab];
  if (!map) return;
  el.append(h('h3.ec-sub', { text: W.worldRows }), row(map[1], W.sectionSub[map[0]], 'world-section', () => open('wl:' + map[0])));
}

function group(el, label, list, mk) {
  if (!list.length) return;
  el.append(h('h3.ec-sub', { text: `${label} (${list.length})` }));
  paged(el, list, mk);
}
/** Rows PAGE at a time with a "Show N more" button (rendering is lazy, 2.6). */
function paged(el, list, mk, size = PAGE) {
  const box = h('div.ec-wlist');
  el.append(box);
  let at = 0;
  const more = h('button.ec-rchip', { type: 'button', 'data-act': 'world-more', style: { marginTop: '6px' } });
  const step = () => {
    const end = Math.min(list.length, at + size);
    for (; at < end; at++) box.append(mk(list[at], at));
    if (at < list.length) { more.textContent = W.more(Math.min(size, list.length - at)); if (!more.isConnected) el.append(more); }
    else more.remove();
  };
  onTap(more, step);
  step();
}
const TINTW = { living: '#7fa05a', dead: '#8a6f6a', war: '#b0573f', site: '#c9973e', art: '#9a86b8', beast: '#7f8f9a' };
const warRow = (realm, w, open) => row(warName(realm, w), W.warYears(w.began, w.ended), 'world-entry', () => open(worldKey('war', w.id)), TINTW.war);
const figRow = (realm, f, open) => row(figureName(f), W.figRow(ROLE_WORDS[f.role] || f.role, peopleWord(f.people), f.born, f.died), 'world-entry', () => open(worldKey('fig', f.id)), f.died === null ? TINTW.living : TINTW.dead);
const siteRow = (realm, x, open) => row(x.name, W.siteSub(SITE_WORDS[x.kind] || x.kind, x.civ !== null && x.razed === null ? civText(realm.tables.civs[x.civ]) : null), 'world-entry', () => open(worldKey('site', x.id)), TINTW.site);
const civRow = (realm, c, open) => row(civName(c), `${W.civSub(peopleWord(c.people), CIVKIND_WORDS[c.kind] || c.kind)}. ${c.fell === null ? W.founded(c.founded) : W.fell(c.fell)}`, 'world-entry', () => open(worldKey('civ', c.id)), c.fell === null ? TINTW.living : TINTW.dead);
const artRow = (realm, a, open) => row(artifactName(a), artifactDesc(a), 'world-entry', () => open(worldKey('art', a.id)), TINTW.art);
const beastRow = (realm, b, open) => row(b.name, b.alive ? W.beastAlive : W.beastSlain(figureName(realm.tables.figures[b.by]) || '?', b.slain), 'world-entry', () => open(worldKey('beast', b.id)), TINTW.beast);

/** Eras of ERA_YEARS years: [{ i, a, b, name }] named by what filled them. */
function eras(realm) {
  const Y = realm.years | 0, n = Math.floor(Y / ERA_YEARS) + 1, c = Array.from({ length: n }, () => ({ war: 0, hunger: 0, build: 0, all: 0 }));
  const N = eventCount(realm);
  for (let k = 0; k < N; k++) {
    const m = eventMeta(realm, k), i = Math.max(0, Math.min(n - 1, Math.floor(m.year / ERA_YEARS)));
    if (m.imp < 2 && m.key !== 'site.founded') continue;
    c[i].all++;
    if (m.group === 'war' || m.key === 'site.razed' || m.key === 'site.taken') c[i].war++;
    else if (m.key === 'world.plague' || m.key === 'world.famine') c[i].hunger += 2;
    else if (m.key === 'site.founded' || m.key === 'fig.forged' || m.key === 'fig.wrote') c[i].build++;
  }
  return c.map((x, i) => {
    const name = i === 0 ? W.eraNames.fall : x.war >= Math.max(4, x.build) ? W.eraNames.war : x.hunger >= Math.max(4, x.build) ? W.eraNames.hunger : x.build >= 4 ? W.eraNames.build : W.eraNames.quiet;
    return { i, a: i * ERA_YEARS, b: Math.min(Y, i * ERA_YEARS + ERA_YEARS - 1), name };
  });
}

/** An event line: year and words; a tap opens the first other record it names (`self` is the open entry). */
function evLine(realm, k, open, self = null) {
  const e = eventText(realm, k), go = e.links.find((x) => x !== self) || null;
  const line = h('div.ec-log', null, h('span.ec-log-d', { text: yearText(e.year) }), h('span.ec-log-t', { text: e.text }));
  if (!go) return line;
  const b = h('button.ec-annals-ev', { type: 'button', 'data-act': 'world-ev', 'data-key': go, style: ROW }, line);
  onTap(b, () => open(go));
  return b;
}

/** A world page: a section list ('wl:<section>', 'wl:era:<i>') or a record (a world key). */
function worldPage(el, s, key, open, showSite, inSheet) {
  const R = holdRealm(s);
  if (realmNote(el, R)) return;
  const realm = R.realm, T2 = realm.tables;
  if (!inSheet) el.append(h('h3.ec-sub', { text: worldTitle(realm, key) }));
  if (key.startsWith('wl:era:')) {
    const i = +key.slice(7), lo = i * ERA_YEARS, hi = lo + ERA_YEARS - 1, list = [];
    for (let k = 0, N = eventCount(realm); k < N; k++) { const m = eventMeta(realm, k); if (m.year >= lo && m.year <= hi && m.imp >= 2) list.push(k); }
    el.append(h('p.ec-note', { text: W.eraNote }));
    paged(el, list, (k) => evLine(realm, k, open));
    return;
  }
  if (key.startsWith('wl:')) {
    const sec = key.slice(3);
    if (sec === 'eras') for (const e of eras(realm)) el.append(row(e.name, W.era(e.a, e.b), 'world-era', () => open('wl:era:' + e.i)));
    else if (sec === 'civs') { group(el, W.living, T2.civs.filter((c) => c.fell === null), (c) => civRow(realm, c, open)); group(el, W.fallen, T2.civs.filter((c) => c.fell !== null), (c) => civRow(realm, c, open)); }
    else if (sec === 'peoples') {
      const ps = [...new Set(T2.civs.map((c) => c.people))];
      for (const p of ps) { const cs = T2.civs.filter((c) => c.people === p); el.append(h('h3.ec-sub', { text: `${peopleWord(p, true)}: ${W.peopleSub(cs.length)}` })); for (const c of cs) el.append(civRow(realm, c, open)); }
    } else if (sec === 'sites') {
      group(el, W.standing, T2.sites.filter((x) => x.civ !== null && x.razed === null), (x) => siteRow(realm, x, open));
      group(el, W.ruined, T2.sites.filter((x) => x.razed !== null), (x) => siteRow(realm, x, open));
      group(el, W.wild, T2.sites.filter((x) => x.civ === null && x.razed === null), (x) => siteRow(realm, x, open));
    } else if (sec === 'figures') {
      const by = (a, b) => (b.ren | 0) - (a.ren | 0) || a.id - b.id;
      group(el, W.living, T2.figures.filter((f) => f.died === null).sort(by), (f) => figRow(realm, f, open));
      group(el, W.dead, T2.figures.filter((f) => f.died !== null).sort(by), (f) => figRow(realm, f, open));
    } else if (sec === 'artifacts') { group(el, W.held, T2.artifacts.filter((a) => !a.lost), (a) => artRow(realm, a, open)); group(el, W.lost, T2.artifacts.filter((a) => a.lost), (a) => artRow(realm, a, open)); }
    else if (sec === 'beasts') { group(el, W.alive, T2.beasts.filter((b) => b.alive), (b) => beastRow(realm, b, open)); group(el, W.slain, T2.beasts.filter((b) => !b.alive), (b) => beastRow(realm, b, open)); }
    return;
  }
  worldEntry(el, realm, key, open, showSite);
}

/** One world record: what it is, its facts, Show on map, its rows of linked records, what happened, Related. */
function worldEntry(el, realm, key, open, showSite) {
  const p = parseWorldKey(key), r = recordOf(realm, key), T2 = realm.tables;
  if (!r) { el.append(h('p.ec-note', { text: W.gone })); return; }
  el.dataset.wkey = key;
  const para = (text) => el.append(h('p.ec-bio-d', { text }));
  const sub = (text) => el.append(h('h3.ec-sub', { text }));
  const seen = new Set([key]);
  const link = (k) => { seen.add(k); };
  let map = null;
  const siteAt = (id) => (id !== null && id !== undefined && id >= 0 ? T2.sites[id] : null);
  if (p.kind === 'civ') {
    para(`${W.civSub(peopleWord(r.people), CIVKIND_WORDS[r.kind] || r.kind)}.`);
    para(`${W.founded(r.founded)} ${r.fell === null ? W.endures : W.fell(r.fell)}`);
    const cap = siteAt(r.cap);
    if (cap) { para(W.capital(cap.name)); map = cap; }
    if (r.oath) para(W.oath(oathText(r.oath % 32768)));
    if (r.parent !== null && r.parent !== undefined && T2.civs[r.parent]) para(W.parent(civText(T2.civs[r.parent])));
    if (cap) { el.append(siteRow(realm, cap, open)); link(worldKey('site', cap.id)); }
    const rulers = (r.rulers || []).map((id) => T2.figures[id]).filter(Boolean);
    if (rulers.length) { sub(`${W.rulers} (${rulers.length})`); paged(el, rulers.slice().reverse(), (f) => { link(worldKey('fig', f.id)); return figRow(realm, f, open); }, 12); }
    const own = T2.sites.filter((x) => x.civ === r.id && x.razed === null);
    if (own.length) { sub(`${W.sitesOf} (${own.length})`); paged(el, own, (x) => { link(worldKey('site', x.id)); return siteRow(realm, x, open); }, 12); }
    const wars = T2.wars.filter((w) => w.a === r.id || w.b === r.id);
    if (wars.length) { sub(`${W.warsOf} (${wars.length})`); for (const w of wars) { link(worldKey('war', w.id)); el.append(warRow(realm, w, open)); } }
  } else if (p.kind === 'site') {
    const owner = r.civ !== null && r.razed === null ? T2.civs[r.civ] : null;
    para(`${W.siteSub(SITE_WORDS[r.kind] || r.kind, owner ? civText(owner) : null)}.`);
    para(`${W.founded(r.founded)}${r.razed !== null ? ' ' + W.razed(r.razed) : ''} ${W.region(r.x, r.y)}`);
    map = r;
    if (owner) { el.append(civRow(realm, owner, open)); link(worldKey('civ', owner.id)); }
    const lair = T2.beasts.find((b) => b.site === r.id);
    if (lair) { el.append(beastRow(realm, lair, open)); link(worldKey('beast', lair.id)); }
  } else if (p.kind === 'fig') {
    const c = T2.civs[r.civ];
    para(`${W.figSub(ROLE_WORDS[r.role] || r.role, peopleWord(r.people), civText(c) || '?')}.`);
    para(W.life(r.born, r.died));
    if (c) { el.append(civRow(realm, c, open)); link(worldKey('civ', c.id)); }
    const home = siteAt(r.home);
    if (home) { el.append(siteRow(realm, home, open)); link(worldKey('site', home.id)); }
    const kin = [];
    if (r.kin && r.kin[0] >= 0 && T2.figures[r.kin[0]]) kin.push(['parent', T2.figures[r.kin[0]]]);
    if (r.kin && r.kin[1] >= 0 && T2.figures[r.kin[1]]) kin.push(['spouse', T2.figures[r.kin[1]]]);
    for (const g of T2.figures) if (g.kin && g.kin[0] === r.id) kin.push(['child', g]);
    for (const [w, g] of kin) { link(worldKey('fig', g.id)); el.append(row(figureName(g), W.kinOf(W.kinWords[w], W.figRow(ROLE_WORDS[g.role] || g.role, peopleWord(g.people), g.born, g.died)), 'world-link', () => open(worldKey('fig', g.id)), g.died === null ? TINTW.living : TINTW.dead)); }
  } else if (p.kind === 'art') {
    para(`${W.artSub(artifactDesc(r))}.`);
    const mk = r.maker >= 0 ? T2.figures[r.maker] : null;
    para(mk ? W.madeBy(figureName(mk), r.made) : W.madeOld(r.made));
    if (mk) { el.append(figRow(realm, mk, open)); link(worldKey('fig', mk.id)); }
    if (r.lost) { const at = siteAt(r.lost[1]); para(at ? W.lostAt(at.name, r.lost[0]) : W.lostAway(r.lost[0])); if (at) { map = at; el.append(siteRow(realm, at, open)); link(worldKey('site', at.id)); } }
    else if (r.holders && r.holders.length) { const hd = T2.figures[r.holders[r.holders.length - 1][0]]; if (hd) { para(W.heldBy(figureName(hd))); if (!seen.has(worldKey('fig', hd.id))) { el.append(figRow(realm, hd, open)); link(worldKey('fig', hd.id)); } } }
  } else if (p.kind === 'beast') {
    para(`${W.beastSub}.`);
    const lair = siteAt(r.site);
    if (lair) { para(W.lair(lair.name)); map = lair; el.append(siteRow(realm, lair, open)); link(worldKey('site', lair.id)); }
    const by = !r.alive && r.by !== null && r.by !== undefined ? T2.figures[r.by] : null;
    para(by ? W.beastSlain(figureName(by), r.slain) : W.beastAlive);
    if (by) { el.append(figRow(realm, by, open)); link(worldKey('fig', by.id)); }
    para(W.kills(r.kills | 0, r.wounds | 0));
  } else if (p.kind === 'war') {
    const A = T2.civs[r.a], B = T2.civs[r.b];
    para(`${W.warSub(civName(A), civText(B))}.`);
    para(W.warYears(r.began, r.ended));
    const oc = W.outcome[r.outcome];
    para(typeof oc === 'function' ? oc(civName(r.outcome === 2 ? A : B)) : oc || '');
    for (const c of [A, B]) if (c) { el.append(civRow(realm, c, open)); link(worldKey('civ', c.id)); }
    if (r.cause >= 0 && r.cause < eventCount(realm)) { sub(W.warCause); el.append(evLine(realm, r.cause, open, key)); }
  }
  if (map && showSite) {
    const b = h('button.ec-btn', { type: 'button', 'data-act': 'world-map', 'data-rx': String(map.x), 'data-ry': String(map.y), style: { minHeight: '44px', marginTop: '10px' } }, h('span.ec-btn-label', { text: W.showOnMap }));
    onTap(b, () => showSite(map.x, map.y, worldKey('site', map.id)));
    el.append(b);
  }
  // what happened (deeds first for a figure: its own rows), then Related: every other name the lines link
  const ev = eventsOf(realm, key);
  if (ev.length) {
    sub(`${p.kind === 'fig' ? W.deeds : W.events} (${ev.length})`);
    el.append(h('p.ec-note', { text: W.eventsNote }));
    const rel = h('div.ec-rchips', { style: { flexWrap: 'wrap', justifyContent: 'flex-start' } });
    const relSeen = new Set(seen);
    const addRel = (k) => {
      if (relSeen.has(k) || relSeen.size > 40) return;
      relSeen.add(k);
      const nm = recordName(realm, k);
      if (!nm) return;
      const b = h('button.ec-rchip', { type: 'button', 'data-act': 'world-link', 'data-key': k, text: nm, style: { maxWidth: '100%' } });
      onTap(b, () => open(k));
      rel.append(b);
    };
    paged(el, ev, (k) => { for (const x of eventText(realm, k).links) addRel(x); return evLine(realm, k, open, key); });
    if (rel.children.length) el.append(h('h3.ec-sub', { text: W.related }), rel);
  }
}
