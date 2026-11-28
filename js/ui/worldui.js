// The World sheet (owner I; EMBERCROWN-WORLD.md 8.1 bar slot 5, 8.5, step W1.3b). Tabs: Annals (one list with
// filter chips; an entry pushes "World / <entry>"), Letters (the choices waiting for an answer, then this
// session's letters; a letter pushes inside the sheet), Factions (standing and goodwill, a waiting envoy, the
// nemeses) and The dead. Never a second sheet (G21).
// W3.2: a hold in a world gets a Map tab first (the world map, read-only, the hold's region framed; a tap peeks
// at the region and opens the site there) and the Annals' Wars and World chips (annals.js). "Show on map" in a
// world entry reopens this sheet on the Map tab with the site selected (a gold mark, zoomed to 4x).
// W3.9 (8.1, 8.5): in a world the tabs are Map, Annals, Peoples, Letters, The dead, and the sheet opens on Map
// (unless a letter waits or another tab was seen last). Map: the hold's pin, its liege and 6 nearest neighbours
// as pins, the caravan routes, the wars now (crossed blades at each front); under the map the Neighbours (the
// liege first: name, standing, goodwill, travel days; a row pushes "World / <civ>" with the civ's card) and the
// News (the wars now). So the hold, its liege and 6 neighbours are 2 taps from the play screen. Peoples
// (peoplesui.js): one card per civ, then the fallen, then the nemeses. A realm-less hold keeps Factions.
//   openWorld(ctx, tab, opt)     open the sheet; tab: a key of worldKeys(s) ('factions' means Peoples in a world),
//                                else Letters when one waits, else the last tab seen (the first tab at first);
//                                opt.select { rx, ry } selects a region on Map
//   worldKeys(s)                 the tab keys for a hold: map, annals, peoples, letters, dead in a world
//   factionsBlock(el, ctx, nem)  the factions (and with nem the nemeses), also on the old Hold tab
//   nemesisRow(ctx, n)           one nemesis (also the letters' nemesis card)
// Strings: the 'world.*' rows of strings-en.js (G25); the code moved from colonyui.js keeps its words until W7.7.
// t-keys: world.tab.* world.intro.*
import { h, onTap, icon } from './kit.js';
import { t } from './strings.js';
import { def } from '../game/core/content.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../game/core/time.js';
import { standingOf, goodwill, GOODWILL_IDS } from '../game/colony/factions.js';
import { fullName } from '../game/threat/nemesis.js';
import { annalsView, holdRealm, pushEntry } from './annals.js';
import { createWorldMap } from './worldmap.js';
import { WORLD_TEXT as WT, civText, civName, SITE_WORDS } from '../data/text/realm.js';
import { REALM_BIOMES } from '../data/realm/biomes.js';
import { openChoice, openLetter } from './letters.js';
import { deadPanel } from './burialui.js';
import { STAGE } from './stage.js';
import { realmView, peoplesView, openCivPage, crestCanvas, warLine, PEOPLES_TEXT as PT } from './peoplesui.js';

const S2 = STAGE !== '1a' && STAGE !== '1b';
export const WORLD_KEYS = Object.freeze(['annals', 'letters', 'factions', 'dead']);
export const REALM_KEYS = Object.freeze(['map', 'annals', 'peoples', 'letters', 'dead']);
export const worldKeys = (s) => (s && s.realm ? REALM_KEYS : WORLD_KEYS);
/** UI memory (never saved): the last tab (null: the first tab), the Annals filter, the Map's selection. */
const mem = { tab: null, annals: 'Years', select: null };
const tabLabel = (k) => (k === 'map' ? WT.tabMap : k === 'peoples' ? PT.tab : t('world.tab.' + k));
let liveMap = null;
const dropMap = () => { if (liveMap) { try { liveMap.destroy(); } catch (_) { /* gone */ } liveMap = null; } };
/** The open map (tests, the bench): its worldmap.js handle, or null. */
export const worldMapHandle = () => liveMap;
const waitingOf = (ctx) => { try { return ctx.letters ? ctx.letters.waiting() : []; } catch (_) { return []; } };

/** The World sheet. */
export function openWorld(ctx, tab = null, opt = {}) {
  const keys = worldKeys(ctx.s);
  if (tab === 'factions' && keys.includes('peoples')) tab = 'peoples';
  const k0 = keys.includes(tab) ? tab : waitingOf(ctx).length ? 'letters' : keys.includes(mem.tab) ? mem.tab : keys[0];
  mem.select = opt.select ? { rx: opt.select.rx | 0, ry: opt.select.ry | 0 } : k0 === 'map' ? mem.select : null;
  const labels = keys.map(tabLabel);
  const keyOf = (lab) => keys[Math.max(0, labels.indexOf(lab))];
  const showSite = (rx, ry) => openWorld(ctx, 'map', { select: { rx, ry } });
  const annals = { get tab() { return mem.annals; }, set tab(v) { mem.annals = v; }, page: [], showSite };
  const intro = { key: 'world', get text() { let lab = null; try { lab = ctx.sheets && ctx.sheets.tab(); } catch (_) { lab = null; } const k = keyOf(lab || labels[0]); return k === 'map' ? WT.mapNote : k === 'peoples' ? PT.intro : t('world.intro.' + k); } };
  ctx.openSheet(t('world.title'), (el, lab) => {
    const k = keyOf(lab);
    dropMap();
    mem.tab = k;
    const box = h('div.ec-world-box', { 'data-world': k });
    el.append(box);
    if (k === 'map') mapTab(box, ctx, showSite);
    else if (k === 'letters') lettersTab(box, ctx);
    else if (k === 'peoples') peoplesTab(box, ctx, showSite);
    else if (k === 'factions') { if (S2) factionsBlock(box, ctx, true); else box.append(h('p.ec-note', { text: t('world.factions.later') })); }
    else if (k === 'dead') deadPanel(box, ctx.s, ctx);
    else annalsView(box, ctx.s, ctx, annals);
  }, { tabs: labels, tab: tabLabel(k0), crumb: () => t('world.title'), intro, onClose: dropMap, detent: k0 === 'map' || k0 === 'peoples' ? 'large' : undefined });
}

// ---- Map (W3.2; W3.9: pins, routes, wars, Neighbours and News) -------------------------------------------------
const rerender = (ctx, key) => () => { try { if (ctx.sheets && ctx.sheets.isOpen() && mem.tab === key) ctx.sheets.render(true); } catch (_) { /* closed */ } };
function realmNote(el, R) { el.append(h('p.ec-note', { 'data-world': R.status, text: R.status === 'loading' ? WT.loading : R.status === 'none' ? WT.noWorld : WT.missing })); }
const hasHistory = (realm) => !!(realm && realm.tables && Array.isArray(realm.tables.civs) && realm.tables.civs.length);
function mapTab(el, ctx, showSite) {
  const s = ctx.s, R = holdRealm(s, rerender(ctx, 'map'));
  if (R.status !== 'ready') { realmNote(el, R); return; }
  const realm = R.realm, n = realm.n, T = realm.tables || {};
  const host = h('div.ec-world-map', { style: { position: 'relative', height: 'clamp(240px, 58vh, 480px)', minHeight: '240px', margin: '0 -4px' } });
  const peek = h('div.ec-world-peek', { 'aria-live': 'polite', style: { display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px' } });
  el.append(host, peek);
  const home = { rx: s.realm.rx | 0, ry: s.realm.ry | 0 };
  const V = hasHistory(realm) ? realmView(s, realm) : null;
  const say = (rx, ry) => {
    peek.replaceChildren();
    const i = ry * n + rx, sid = realm.fields.site ? realm.fields.site[i] : 0, site = sid ? (T.sites || [])[sid - 1] : null;
    const now = site && V ? V.sites[site.id] : null, owner = now ? now.civ : site && site.razed === null ? site.civ : null;
    const biome = REALM_BIOMES[realm.fields.biome[i]];
    const what = rx === home.rx && ry === home.ry ? WT.hold : site ? `${site.name}, ${WT.siteSub(SITE_WORDS[site.kind] || site.kind, owner !== null ? civText(T.civs[owner]) : null).replace(/^A /, 'a ')}` : `${biome ? biome.name : ''}, ${WT.mapEmpty}`;
    peek.dataset.rx = String(rx); peek.dataset.ry = String(ry);
    peek.append(h('p.ec-bio-d', { text: WT.mapPeek(rx, ry, what) + (V && site && !(rx === home.rx && ry === home.ry) ? ` ${PT.days(V.days(rx, ry))} away.` : ''), style: { margin: '0' } }));
    if (site) {
      const row = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
      const b = h('button.ec-btn', { type: 'button', 'data-act': 'world-map-open', 'data-key': 'ws' + site.id, style: { minHeight: '44px', flex: '1 1 auto' } }, h('span.ec-btn-label', { text: WT.openRecord(site.name) }));
      onTap(b, () => pushEntry(ctx, s, 'ws' + site.id, { showSite }));
      row.append(b);
      if (V && owner !== null && T.civs[owner] && T.civs[owner].fell === null) {
        const c = h('button.ec-btn', { type: 'button', 'data-act': 'world-map-civ', 'data-civ': String(owner), style: { minHeight: '44px', flex: '1 1 auto' } }, h('span.ec-btn-label', { text: civName(T.civs[owner]) }));
        onTap(c, () => openCivPage(ctx, realm, owner, { site: site.id, showSite, open: (k) => pushEntry(ctx, s, k, { showSite }) }));
        row.append(c);
      }
      peek.append(row);
    }
  };
  const mark = (rx, ry) => { mem.select = { rx, ry }; liveMap.select(rx, ry, { reveal: false }); liveMap.setMatches(rx === home.rx && ry === home.ry ? [] : [{ rx, ry }]); say(rx, ry); };
  liveMap = createWorldMap(host, realm, { readOnly: true, home, chips: true, settings: () => (ctx.settings ? ctx.settings() : {}), onPeek: (rx, ry) => mark(rx, ry) });
  if (V) liveMap.setMarks({
    pins: [{ ...home, kind: 'home' }, ...V.rows.map((r) => ({ rx: r.x, ry: r.y, kind: r.role === 'liege' ? 'liege' : 'near' }))],
    routes: V.routes.map((r) => r.path),
    wars: V.wars.filter((w) => w.front).map((w) => w.front),
  });
  const sel = mem.select;
  if (sel) {
    const st = liveMap.state();
    liveMap.setView({ scale: st.levels[1] });
    liveMap.select(sel.rx, sel.ry, { reveal: true });
    liveMap.setMatches(sel.rx === home.rx && sel.ry === home.ry ? [] : [{ rx: sel.rx, ry: sel.ry }]);
    say(sel.rx, sel.ry);
  } else { liveMap.reveal(home.rx, home.ry); say(home.rx, home.ry); }
  if (!V) { el.append(h('p.ec-note', { text: WT.noHistory })); return; }
  // Neighbours: the liege first, then the 6 nearest; a row pushes the civ's card
  el.append(h('h3.ec-sub', { text: PT.neighbours }));
  const open = (k) => pushEntry(ctx, s, k, { showSite });
  for (const r of V.rows) {
    const c = T.civs[r.civ];
    const b = h('button.ec-row', { type: 'button', 'data-act': 'world-nb', 'data-role': r.role, 'data-civ': String(r.civ), 'data-site': String(r.site), 'data-rx': String(r.x), 'data-ry': String(r.y) },
      crestCanvas(c, 2), h('span.ec-row-n', { text: PT.nbName(r.name, civName(c)), style: { minWidth: '0', overflowWrap: 'anywhere' } }),
      h('span.ec-row-s', { text: PT.nbSub(r.word, r.goodwill, PT.days(r.days)), style: { flex: 'none', textAlign: 'right' } }), h('span', { html: icon('chev'), style: { flex: 'none', width: '20px', display: 'inline-flex' } }));
    onTap(b, () => openCivPage(ctx, realm, r.civ, { site: r.site, showSite, open }));
    el.append(b);
  }
  // News: the wars now
  el.append(h('h3.ec-sub', { text: PT.news }));
  if (!V.wars.length) el.append(h('p.ec-note', { text: PT.noNews }));
  for (const w of V.wars) {
    const b = h('button.ec-row', { type: 'button', 'data-act': 'world-news', 'data-a': String(w.a), 'data-b': String(w.b), 'data-key': w.id !== null ? 'ww' + w.id : '' },
      h('span', { html: icon('banner') }), h('span.ec-row-n', { text: warLine(realm, w) }), h('span.ec-row-s', { text: PT.warSince(w.began) }));
    if (w.id !== null) onTap(b, () => open('ww' + w.id));
    else if (w.front) onTap(b, () => showSite(w.front.rx, w.front.ry));
    el.append(b);
  }
}

// ---- Peoples (W3.9: peoplesui.js) ------------------------------------------------------------------------------
function peoplesTab(el, ctx, showSite) {
  const s = ctx.s, R = holdRealm(s, rerender(ctx, 'peoples'));
  if (R.status !== 'ready') { realmNote(el, R); if (R.status !== 'loading' && S2) factionsBlock(el, ctx, true); return; }
  if (!hasHistory(R.realm)) { if (S2) factionsBlock(el, ctx, false); else el.append(h('p.ec-note', { text: WT.noHistory })); }
  else peoplesView(el, ctx, R.realm, { showSite, open: (k) => pushEntry(ctx, s, k, { showSite }) });
  if (S2) nemesesBlock(el, ctx);
}

// ---- Letters ------------------------------------------------------------------------------------------------
const KIND_ICON = { choice: 'book', incident: 'omen', nemesis: 'skull', trader: 'merchant', envoy: 'banner', envoyMet: 'banner', envoyFailed: 'banner', omen: 'omen', minor: 'info' };
function lettersTab(el, ctx) {
  const s = ctx.s, L = ctx.letters;
  const waiting = waitingOf(ctx);
  if (waiting.length) el.append(h('h3.ec-sub', { text: t('world.letters.waiting') }));
  for (const l of waiting) {
    const hrs = Math.max(0, Math.ceil(((l.until | 0) - s.tick) / TICKS_PER_HOUR));
    const b = h('button.ec-row', { type: 'button', 'data-act': 'letter-open' }, h('span', { html: icon('book') }), h('span.ec-row-n', { text: l.title || t('world.letters.untitled') }), h('span.ec-row-s', { text: t('world.letters.hours', { n: hrs }) }));
    onTap(b, () => openChoice(ctx, l, { back: true }));
    el.append(b);
  }
  let list = [];
  try { list = L ? L.list() : []; } catch (_) { list = []; }
  el.append(h('h3.ec-sub', { text: list.length ? t('world.letters.session') : t('world.letters.none') }));
  if (!list.length) el.append(h('p.ec-note', { text: t('world.letters.noneText') }));
  for (const rec of list) {
    const b = h('button.ec-row' + (rec.read ? '' : '.unread'), { type: 'button', 'data-act': 'letter-read' }, h('span', { html: icon(KIND_ICON[rec.kind] || 'book') }),
      h('span.ec-row-n', { text: rec.title || (rec.text || '').slice(0, 40) || t('world.letters.untitled') }), h('span.ec-row-s', { text: t('world.letters.day', { n: Math.floor(rec.tick / TICKS_PER_DAY) + 1 }) }));
    onTap(b, () => { rec.read = true; openLetter(ctx, rec, { back: true }); });
    el.append(b);
  }
}

// ---- Factions and nemeses (moved from colonyui.js) ----------------------------------------------------------------
const banner = (ic, text) => h('h3.ec-sub.ec-banner', null, h('span.ec-banner-ic', { html: icon(ic) }), h('span', { text }));
/** The factions: name, standing, goodwill; a waiting envoy; with nem, the nemeses. */
export function factionsBlock(el, ctx, nem = false) {
  const s = ctx.s;
  el.append(banner('banner', 'Factions'));
  for (const f of GOODWILL_IDS) {
    const d = def('faction', f) || { name: f };
    const g = goodwill(s, f);
    el.append(h('div.ec-thought.' + (g < 0 ? 'bad' : 'good'), null, h('span.ec-thought-n', { text: d.name }), h('span.ec-thought-w', { text: standingOf(s, f) }), h('b', { text: (g > 0 ? '+' : '') + g })));
  }
  if (s.colony.trade && s.colony.trade.envoy) {
    const e = s.colony.trade.envoy, fd = def('faction', e.faction) || { name: e.faction }, it = def('item', e.k) || { name: e.k };
    el.append(h('p.ec-note', { text: `The ${fd.name} envoy waits for ${e.n} ${it.name.toLowerCase()} by day ${Math.floor((e.until | 0) / TICKS_PER_DAY) + 1}: keep them in a stockpile.` }));
  }
  if (nem) nemesesBlock(el, ctx);
}
/** The nemeses (the Factions tab, the Peoples tab and the old Hold tab). */
export function nemesesBlock(el, ctx) {
  const s = ctx.s;
  const nems = (s.st && s.st.nemeses) || [];
  el.append(banner('skull', nems.length ? 'Nemeses' : 'No nemeses'));
  if (!nems.length) el.append(h('p.ec-note', { text: 'A raid leader who escapes, wounded or ransomed, remembers the hold, and comes back.' }));
  for (const n of nems) el.append(nemesisRow(ctx, n));
}
const AFFIX = { armoured: 'Armoured', swift: 'Swift', rallying: 'Rallying', burning: 'Burning' };
/** One nemesis: name and epithet, what it is, its scar, grudge and returns. */
export function nemesisRow(ctx, n) {
  const s = ctx.s;
  const grudge = n.grudge !== null && n.grudge !== undefined ? s.col.find((c) => c.id === n.grudge) : null;
  const due = n.nextTick > s.tick ? `back in about ${Math.max(1, Math.ceil((n.nextTick - s.tick) / TICKS_PER_DAY))} days` : 'due';
  return h('section.ec-nem', null, h('b', { text: fullName(n) }),
    h('p.ec-bio-d', { text: [kindName(n.kind), n.scar ? `scarred by a ${n.scar}` : null, (n.affixes || []).length ? (n.affixes || []).map((a) => AFFIX[a] || a).join(', ') : null].filter(Boolean).join(' · ') }),
    h('p.ec-bio-d', { text: `${grudge ? `Hates ${grudge.name}. ` : ''}Returned ${n.returns | 0} ${n.returns === 1 ? 'time' : 'times'}; ${due}.` }));
}
const kindName = (k) => { const d = def('raider', k) || def('foe', k); return d && d.name ? d.name : String(k || '').replace(/_/g, ' '); };
