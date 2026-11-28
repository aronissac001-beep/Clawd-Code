// The World sheet (owner I; EMBERCROWN-WORLD.md 8.1 bar slot 5, 8.5, step W1.3b). Tabs: Annals (one list with
// filter chips; an entry pushes "World / <entry>"), Letters (the choices waiting for an answer, then this
// session's letters; a letter pushes inside the sheet), Factions (standing and goodwill, a waiting envoy, the
// nemeses) and The dead. The world map tab comes with the realm (W2). Never a second sheet (G21).
//   openWorld(ctx, tab)          open the sheet; tab: a key of WORLD_KEYS, else Letters when one waits, else
//                                the last tab seen (Annals at first)
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
import { annalsView } from './annals.js';
import { openChoice, openLetter } from './letters.js';
import { deadPanel } from './burialui.js';
import { STAGE } from './stage.js';

const S2 = STAGE !== '1a' && STAGE !== '1b';
export const WORLD_KEYS = Object.freeze(['annals', 'letters', 'factions', 'dead']);
/** UI memory (never saved): the last tab, the Annals filter. */
const mem = { tab: 'annals', annals: 'Years' };
const tabLabel = (k) => t('world.tab.' + k);
const waitingOf = (ctx) => { try { return ctx.letters ? ctx.letters.waiting() : []; } catch (_) { return []; } };

/** The World sheet. */
export function openWorld(ctx, tab = null) {
  const k0 = WORLD_KEYS.includes(tab) ? tab : waitingOf(ctx).length ? 'letters' : mem.tab;
  const labels = WORLD_KEYS.map(tabLabel);
  const keyOf = (lab) => WORLD_KEYS[Math.max(0, labels.indexOf(lab))];
  const annals = { get tab() { return mem.annals; }, set tab(v) { mem.annals = v; }, page: [] };
  const intro = { key: 'world', get text() { let lab = null; try { lab = ctx.sheets && ctx.sheets.tab(); } catch (_) { lab = null; } return t('world.intro.' + keyOf(lab || labels[0])); } };
  ctx.openSheet(t('world.title'), (el, lab) => {
    const k = keyOf(lab);
    mem.tab = k;
    const box = h('div.ec-world-box', { 'data-world': k });
    el.append(box);
    if (k === 'letters') lettersTab(box, ctx);
    else if (k === 'factions') { if (S2) factionsBlock(box, ctx, true); else box.append(h('p.ec-note', { text: t('world.factions.later') })); }
    else if (k === 'dead') deadPanel(box, ctx.s, ctx);
    else annalsView(box, ctx.s, ctx, annals);
  }, { tabs: labels, tab: tabLabel(k0), crumb: () => t('world.title'), intro });
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
