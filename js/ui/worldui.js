// The World sheet (owner I; EMBERCROWN-WORLD.md 8.1 bar slot 5, 8.5, step W1.3b). Tabs: Annals (one list with
// filter chips; an entry pushes "World / <entry>"), Letters (the choices waiting for an answer, then this
// session's letters; a letter pushes inside the sheet), Factions (standing and goodwill, a waiting envoy, the
// nemeses) and The dead. Never a second sheet (G21).
// W3.2: a hold in a world gets a Map tab first (the world map, read-only, the hold's region framed; a tap peeks
// at the region and opens the site there) and the Annals' Wars and World chips (annals.js). "Show on map" in a
// world entry reopens this sheet on the Map tab with the site selected (a gold mark, zoomed to 4x). The full
// World tab (pins, routes, wars, neighbours, Peoples) is W3.9's.
//   openWorld(ctx, tab, opt)     open the sheet; tab: a key of worldKeys(s), else Letters when one waits, else
//                                the last tab seen (Annals at first); opt.select { rx, ry } selects a region on Map
//   worldKeys(s)                 the tab keys for a hold: 'map' first when it stands in a world
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
import { WORLD_TEXT as WT, civText, SITE_WORDS } from '../data/text/realm.js';
import { REALM_BIOMES } from '../data/realm/biomes.js';
import { openChoice, openLetter } from './letters.js';
import { deadPanel } from './burialui.js';
import { STAGE } from './stage.js';

const S2 = STAGE !== '1a' && STAGE !== '1b';
export const WORLD_KEYS = Object.freeze(['annals', 'letters', 'factions', 'dead']);
export const worldKeys = (s) => (s && s.realm ? ['map', ...WORLD_KEYS] : WORLD_KEYS);
/** UI memory (never saved): the last tab, the Annals filter, the Map's selection. */
const mem = { tab: 'annals', annals: 'Years', select: null };
const tabLabel = (k) => (k === 'map' ? WT.tabMap : t('world.tab.' + k));
let liveMap = null;
const dropMap = () => { if (liveMap) { try { liveMap.destroy(); } catch (_) { /* gone */ } liveMap = null; } };
/** The open map (tests, the bench): its worldmap.js handle, or null. */
export const worldMapHandle = () => liveMap;
const waitingOf = (ctx) => { try { return ctx.letters ? ctx.letters.waiting() : []; } catch (_) { return []; } };

/** The World sheet. */
export function openWorld(ctx, tab = null, opt = {}) {
  const keys = worldKeys(ctx.s);
  const k0 = keys.includes(tab) ? tab : waitingOf(ctx).length ? 'letters' : keys.includes(mem.tab) ? mem.tab : 'annals';
  mem.select = opt.select ? { rx: opt.select.rx | 0, ry: opt.select.ry | 0 } : k0 === 'map' ? mem.select : null;
  const labels = keys.map(tabLabel);
  const keyOf = (lab) => keys[Math.max(0, labels.indexOf(lab))];
  const showSite = (rx, ry) => openWorld(ctx, 'map', { select: { rx, ry } });
  const annals = { get tab() { return mem.annals; }, set tab(v) { mem.annals = v; }, page: [], showSite };
  const intro = { key: 'world', get text() { let lab = null; try { lab = ctx.sheets && ctx.sheets.tab(); } catch (_) { lab = null; } const k = keyOf(lab || labels[0]); return k === 'map' ? WT.mapNote : t('world.intro.' + k); } };
  ctx.openSheet(t('world.title'), (el, lab) => {
    const k = keyOf(lab);
    dropMap();
    mem.tab = k;
    const box = h('div.ec-world-box', { 'data-world': k });
    el.append(box);
    if (k === 'map') mapTab(box, ctx, showSite);
    else if (k === 'letters') lettersTab(box, ctx);
    else if (k === 'factions') { if (S2) factionsBlock(box, ctx, true); else box.append(h('p.ec-note', { text: t('world.factions.later') })); }
    else if (k === 'dead') deadPanel(box, ctx.s, ctx);
    else annalsView(box, ctx.s, ctx, annals);
  }, { tabs: labels, tab: tabLabel(k0), crumb: () => t('world.title'), intro, onClose: dropMap, detent: k0 === 'map' ? 'large' : undefined });
}

// ---- Map (W3.2; W3.9 adds pins, routes and wars) ------------------------------------------------------------------
function mapTab(el, ctx, showSite) {
  const s = ctx.s, R = holdRealm(s, () => { try { if (ctx.sheets && ctx.sheets.isOpen() && mem.tab === 'map') ctx.sheets.render(true); } catch (_) { /* closed */ } });
  if (R.status !== 'ready') { el.append(h('p.ec-note', { 'data-world': R.status, text: R.status === 'loading' ? WT.loading : R.status === 'none' ? WT.noWorld : WT.missing })); return; }
  const realm = R.realm, n = realm.n, T = realm.tables || {};
  const host = h('div.ec-world-map', { style: { position: 'relative', height: 'min(58vh, 480px)', minHeight: '200px', margin: '0 -4px' } });
  const peek = h('div.ec-world-peek', { 'aria-live': 'polite', style: { display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '8px' } });
  el.append(host, peek);
  const home = { rx: s.realm.rx | 0, ry: s.realm.ry | 0 };
  const say = (rx, ry) => {
    peek.replaceChildren();
    const i = ry * n + rx, sid = realm.fields.site ? realm.fields.site[i] : 0, site = sid ? (T.sites || [])[sid - 1] : null;
    const biome = REALM_BIOMES[realm.fields.biome[i]];
    const what = rx === home.rx && ry === home.ry ? WT.hold : site ? `${site.name}, ${WT.siteSub(SITE_WORDS[site.kind] || site.kind, site.civ !== null && site.razed === null ? civText(T.civs[site.civ]) : null).replace(/^A /, 'a ')}` : `${biome ? biome.name : ''}, ${WT.mapEmpty}`;
    peek.dataset.rx = String(rx); peek.dataset.ry = String(ry);
    peek.append(h('p.ec-bio-d', { text: WT.mapPeek(rx, ry, what), style: { margin: '0' } }));
    if (site) {
      const b = h('button.ec-btn', { type: 'button', 'data-act': 'world-map-open', 'data-key': 'ws' + site.id, style: { minHeight: '44px' } }, h('span.ec-btn-label', { text: WT.openRecord(site.name) }));
      onTap(b, () => pushEntry(ctx, s, 'ws' + site.id, { showSite }));
      peek.append(b);
    }
  };
  const mark = (rx, ry) => { mem.select = { rx, ry }; liveMap.select(rx, ry, { reveal: false }); liveMap.setMatches(rx === home.rx && ry === home.ry ? [] : [{ rx, ry }]); say(rx, ry); };
  liveMap = createWorldMap(host, realm, { readOnly: true, home, chips: true, settings: () => (ctx.settings ? ctx.settings() : {}), onPeek: (rx, ry) => mark(rx, ry) });
  const sel = mem.select;
  if (sel) {
    const st = liveMap.state();
    liveMap.setView({ scale: st.levels[1] });
    liveMap.select(sel.rx, sel.ry, { reveal: true });
    liveMap.setMatches(sel.rx === home.rx && sel.ry === home.ry ? [] : [{ rx: sel.rx, ry: sel.ry }]);
    say(sel.rx, sel.ry);
  } else { liveMap.reveal(home.rx, home.ry); say(home.rx, home.ry); }
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
  if (!nem) return;
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
