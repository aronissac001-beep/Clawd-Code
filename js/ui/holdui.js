// The Hold sheet (owner I; EMBERCROWN-WORLD.md 8.1 bar slot 4, 8.5, 11 item 28, step W1.3b). Tabs: Overview
// (name, tier and year; wealth and renown; food and Hearth fuel days; the threat in sight; offices filled;
// visitors, which pushes "Hold / Halls": renown, the halls and their visitors; the Chronicle and deeds; the
// tier's next step, the Hearth and its upgrade, the season), Stock, Research and Offices (Offices and Justice as
// two segments, with the customs). Four tabs, so the strip is one row in portrait. Sub-screens push inside the
// sheet ("Hold / Chronicle"); never a second sheet (G21). The paragraph of the tab on show is the sheet's "?"
// (shown on the first visit only), so the Research and Stock cards sit above the fold (11 item 28).
// Read-only views of state; every change is a command (C3).
//   openHold(ctx, tab, opts)   open the sheet; tab: a key of HOLD_KEYS or an old Colony tab name
//                              ('Hold', 'Chronicle', 'Justice', ...); opts.detent keeps the detent on a tab jump
//   openChronicle(ctx)         "Hold / Chronicle": the hold's history and its deeds (pushed)
//   openHalls(ctx)             "Hold / Halls": renown, the halls and their visitors (pushed)
//   openColony(ctx, tab)       the old entry point: with the new shell People, Work, Schedule and Military land
//                              on the People sheet and the rest here; without it the 8-tab Colony sheet below
// Strings: the 'hold.*' rows of strings-en.js (G25); the code moved from colonyui.js keeps its words until W7.7.
// t-keys: hold.tab.* hold.intro.* hold.seg.*
import { h, onTap, icon } from './kit.js';
import { t } from './strings.js';
import { def, all, structDef } from '../game/core/content.js';
import { dayOf, seasonOf, yearOf, SEASON_NAMES, dayOfSeason } from '../game/core/time.js';
import { hasTech, costOf, eraOpen } from '../game/colony/research.js';
import { tierView } from '../game/colony/tiers.js';
import { computeWealth } from '../game/colony/wealth.js';
import { chronLine } from '../game/colony/chronicle.js';
import { progress as deedProgress } from '../game/colony/deeds.js';
import { weatherText } from '../game/world/weather.js';
import { outdoorTemp } from '../game/world/temperature.js';
import { foodDays } from '../data/advice.js';   // the HUD chip's count, so the two agree
import { hearthFuelDays } from '../game/world/fuel.js';
import { officesView } from '../game/colony/offices.js';
import { hallsView, visitorsOf } from '../game/colony/visitors.js';
import { renownLines } from '../game/colony/renown.js';
import { birthsOn } from '../game/people/family.js';
import { whenOf } from '../game/colony/verbs/discovery.js';
import { peopleList } from './rolesui.js';
import { SHELL2_ON, openPeople, workTab, scheduleTab } from './peopleui.js';
import { militaryTab } from './military.js';
import { officesPanel, openOffices } from './officesui.js';
import { justicePanel, openJustice, lawsSwitch } from './justiceui.js';
import { openAnnals } from './annals.js';
import { openDead } from './burialui.js';
import { chipView, jumpToEdge } from './threatui.js';
import { factionsBlock } from './worldui.js';
import { STAGE } from './stage.js';

const S2 = STAGE !== '1a' && STAGE !== '1b';
export const HOLD_KEYS = Object.freeze(['overview', 'stock', 'research', 'offices']);
/** Old Colony tab names (links, the ledger, the coach, the stock chip) to the Hold tab that carries them. */
const OLD_TO_KEY = { Overview: 'overview', Hold: 'overview', Chronicle: 'overview', Stock: 'stock', Research: 'research', Offices: 'offices', Justice: 'offices', Halls: 'overview' };
const PEOPLE_TABS = { People: 'List', Work: 'List', Schedule: 'Schedule', Military: 'List' };
/** UI memory (never saved): the Offices tab's segment. */
const mem = { seg: 'offices' };
const tabLabel = (k) => t('hold.tab.' + k);

/** The Hold sheet. tab: a HOLD_KEYS key or an old Colony tab name. */
export function openHold(ctx, tab = 'overview', opts = {}) {
  const want = HOLD_KEYS.includes(tab) ? tab : OLD_TO_KEY[tab] || 'overview';
  if (tab === 'Justice' || tab === 'justice') mem.seg = 'justice';
  else if (tab === 'Offices') mem.seg = 'offices';
  // Research and Stock open with their cards first: their paragraph waits behind "?" (11 item 28)
  // (sheet.js seenBefore's record, written here: importing sheet.js would close an import cycle at load)
  if (want === 'research' || want === 'stock') { try { localStorage.setItem('ec2.seen.hold', '1'); } catch (_) { /* private mode */ } }
  const labels = HOLD_KEYS.map(tabLabel);
  const keyOf = (lab) => HOLD_KEYS[Math.max(0, labels.indexOf(lab))];
  const ost = { pick: null }, jst = { pick: false };
  // the paragraph of the tab on show: behind "?" after the first visit (G21; 11 item 28)
  const intro = { key: 'hold', get text() { let lab = null; try { lab = ctx.sheets && ctx.sheets.tab(); } catch (_) { lab = null; } return t('hold.intro.' + keyOf(lab || labels[0])); } };
  ctx.openSheet(t('hold.title'), (el, lab) => {
    const k = keyOf(lab);
    if (k === 'stock') stockTab(el, ctx);
    else if (k === 'research') researchTab(el, ctx);
    else if (k === 'offices') officesTab(el, ctx, ost, jst);
    else overviewTab(el, ctx);
  }, { tabs: labels, tab: tabLabel(want), crumb: () => t('hold.title'), intro, detent: opts.detent });
  if (tab === 'Chronicle' || tab === 'chronicle') openChronicle(ctx);
  else if (tab === 'Halls' || tab === 'halls') openHalls(ctx);
}
/** Jump to another tab of the open Hold sheet (the same sheet: it is opened again on that tab). */
function goTab(ctx, k) {
  let d = null;
  try { d = ctx.sheets && ctx.sheets.detent(); } catch (_) { d = null; }
  openHold(ctx, k, { detent: d === 'large' ? 'large' : undefined });
}

// ---- Overview (8.5) -------------------------------------------------------------------------------------------
/** A summary line; with fn it is a 44 pt row that goes somewhere (a chevron says so). */
function line(text, act = null, fn = null, tone = null) {
  if (!fn) return h('div.ec-row.ec-hold-row' + (tone ? '.' + tone : ''), { 'data-row': act || null }, h('span.ec-row-n', { text }));
  const b = h('button.ec-row.ec-hold-row' + (tone ? '.' + tone : ''), { type: 'button', 'data-act': act },
    h('span.ec-row-n', { text }), h('span', { html: icon('chev'), 'aria-hidden': 'true', style: { display: 'inline-flex', width: '24px', flex: '0 0 24px' } }));
  onTap(b, fn);
  return b;
}
/** What the hold is known for, or its closest renown. */
function renownWord(s) {
  let rl = [];
  try { rl = renownLines(s); } catch (_) { rl = []; }
  const known = rl.filter((r) => r[4]).map((r) => String(r[1]).toLowerCase());
  return known.length ? known.join(', ') : t('hold.ov.renownNone');
}
function overviewTab(el, ctx) {
  const s = ctx.s;
  const tv = tierView(s);
  el.append(h('h3.ec-sub.ec-banner', null, h('span.ec-banner-ic', { html: icon('castle') }), h('span', { text: t('hold.ov.head', { name: s.name || t('hold.title'), tier: tv.name || 'Camp', year: yearOf(s.tick) + 1 }) })));
  let w = null;
  try { w = computeWealth(s); } catch (_) { w = null; }
  el.append(line(t('hold.ov.wealth', { wealth: w ? w.total : 0, renown: renownWord(s) })));
  if (S2) {
    let food = 0, fuel = 0;
    try { food = Math.min(99, Math.floor(foodDays(s))); } catch (_) { food = 0; }
    try { fuel = Math.floor(hearthFuelDays(s)); } catch (_) { fuel = 0; }
    el.append(line(t('hold.ov.supplies', { food, fuel }), 'hold-supplies', null, food < 3 ? 'warn' : null));
  }
  // the threat in sight: the row jumps to the edge it comes from
  let th = null;
  try { th = chipView(s); } catch (_) { th = null; }
  el.append(th ? line(t('hold.ov.threat', { what: th.label }), 'hold-threat', () => { ctx.closeSheet(); jumpToEdge(ctx, th.view); }, th.tone || 'warn') : line(t('hold.ov.noThreat'), 'hold-threat'));
  if (S2) {
    let offs = [];
    try { offs = officesView(s); } catch (_) { offs = []; }
    const open = offs.filter((o) => o.open), held = offs.filter((o) => o.holder);
    el.append(line(t('hold.ov.offices', { n: held.length, m: open.length }), 'hold-go-offices', () => goTab(ctx, 'offices')));
    let vis = [];
    try { vis = visitorsOf(s); } catch (_) { vis = []; }
    el.append(line(vis.length ? t('hold.ov.visitors', { n: vis.length }) : t('hold.ov.noVisitors'), 'hold-halls', () => openHalls(ctx)));
  }
  const deeds = S2 ? all('deed') : [];
  el.append(line(deeds.length ? t('hold.ov.chronicle', { n: (s.colony.deeds || []).length, m: deeds.length }) : t('hold.chronicle'), 'hold-chronicle', () => openChronicle(ctx)));
  tierBlock(el, ctx);
  seasonBlock(el, ctx, false);
}

/** The tier and the next one; the Hearth and its upgrade; wealth (the old Hold tab's blocks). */
function tierBlock(el, ctx) {
  const s = ctx.s;
  const tv = tierView(s);
  el.append(h('div.ec-hold-tier', null, h('span.ec-letter-ic', { html: icon('crown') }), h('div', null, h('b', { text: tv.name || 'Camp' }), h('p.ec-bio-d', { text: tv.text || '' }))));
  if (tv.next) {
    const n = tv.next;
    el.append(banner('crown', `Toward ${n.name}`), bar('Wealth', n.wealth[0], n.wealth[1]), bar('Colonists', n.colonists[0], n.colonists[1]), bar('Hearth level', n.hearth[0], n.hearth[1]),
      h('p.ec-note', { text: 'All three must hold for a full day.' }));
  }
  const hr = s.colony.hearth, hb = hr && hr.id !== null && hr.id !== undefined ? s.bld[hr.id] : null;
  if (hb) {
    const d = structDef(hb.def) || {};
    const lv = (d.levels || [])[(hb.lvl | 0) - 1] || null;
    el.append(banner('flame', `The Hearth, level ${hb.lvl | 0}`));
    const facts = h('div.ec-facts');
    facts.append(h('div.ec-fact', null, h('span', { text: 'Fuel' }), h('b', { text: `${Math.floor((hr.fuel | 0) / 600)} h of wood` })));
    el.append(facts);
    if (lv && S2) {
      const need = Object.entries(lv.cost || {}).map(([k, n]) => { const [base, mat] = k.split(':'); const it = def('item', base); return `${n} ${mat ? mat + ' ' : ''}${((it && it.name) || base).toLowerCase()}`; }).join(', ');
      const up = h('button.ec-act.ec-wide', { type: 'button', 'data-act': 'hearth-upgrade', text: lv.name ? `Upgrade to the ${lv.name} Hearth` : 'Upgrade the Hearth' });
      if (need) facts.append(h('div.ec-fact', null, h('span', { text: 'Next level needs' }), h('b', { text: need })));
      onTap(up, () => ctx.send({ t: 'upgrade', bId: hb.id }, 'Hearth upgrade planned: builders bring what it needs.'));
      el.append(up);
    }
  }
  let w = null;
  try { w = computeWealth(s); } catch (_) { w = null; }
  if (w) el.append(banner('gold', `Wealth ${w.total}`), h('div.ec-facts', null,
    h('div.ec-fact', null, h('span', { text: 'Goods' }), h('b', { text: String(Math.round(w.items / 10)) })),
    h('div.ec-fact', null, h('span', { text: 'Buildings' }), h('b', { text: String(Math.round(w.bld / 10)) })),
    h('div.ec-fact', null, h('span', { text: 'People' }), h('b', { text: String(w.pop) }))), h('p.ec-note', { text: 'Raids grow with wealth: walls and defences count less.' }));
}
/** Season, weather, the storyteller and the day. */
function seasonBlock(el, ctx, titled = true) {
  const s = ctx.s;
  const sd = def('storyteller', s.colony.storyteller), diff = s.colony.difficulty;
  const wx = (() => { try { return weatherText(s); } catch (_) { return null; } })();
  const tmp = (() => { try { return Math.round(outdoorTemp(s.tick, s)); } catch (_) { return null; } })();
  el.append(banner('map', titled ? 'The world' : t('hold.ov.season')), h('div.ec-facts', null,
    h('div.ec-fact', null, h('span', { text: 'Season' }), h('b', { text: `${SEASON_NAMES[seasonOf(s.tick)]}, day ${dayOfSeason(s.tick) + 1} of 10` })),
    wx ? h('div.ec-fact', null, h('span', { text: 'Weather' }), h('b', { text: wx })) : null,
    tmp !== null ? h('div.ec-fact', null, h('span', { text: 'Outside' }), h('b', { text: `${tmp} C` })) : null,
    h('div.ec-fact', null, h('span', { text: 'Storyteller' }), h('b', { text: sd ? sd.name : s.colony.storyteller })),
    h('div.ec-fact', null, h('span', { text: 'Difficulty' }), h('b', { text: diff ? diff.charAt(0).toUpperCase() + diff.slice(1) : '' })),
    h('div.ec-fact', null, h('span', { text: 'Day' }), h('b', { text: String(dayOf(s.tick) + 1) }))));
}

/** "Hold / Chronicle": the hold's history as it happened and the deeds it works toward. */
export function openChronicle(ctx) {
  ctx.openSheet(t('hold.chronicle'), (el) => chronicleTab(el, ctx), { push: true });
}

// ---- Offices and Justice (two segments) and the customs ------------------------------------------------------
function officesTab(el, ctx, ost, jst) {
  if (!S2) { el.append(h('p.ec-note', { text: t('hold.offices.later') })); return; }
  const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': t('hold.tab.offices') });
  for (const k of ['offices', 'justice']) {
    const on = mem.seg === k;
    const b = h('button.ec-seg-b' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-act': 'hold-seg-' + k, text: t('hold.seg.' + k) });
    onTap(b, () => { mem.seg = k; ctx.refreshSheet(); });
    seg.append(b);
  }
  el.append(seg);
  const box = h('div');
  el.append(box);
  if (mem.seg === 'justice') { justicePanel(box, ctx.s, ctx, jst); customsBlock(el, ctx); }
  else officesPanel(box, ctx.s, ctx, ost);
}
/** Births (the laws are on the Justice segment). */
function customsBlock(el, ctx) {
  const s = ctx.s;
  el.append(banner('book', 'Customs'));
  const on = birthsOn(s);
  const row = h('div.ec-laws', { 'data-births': on ? 'on' : 'off' });
  const b = h('button.ec-act', { type: 'button', 'data-act': 'births-toggle', text: on ? 'Stop births' : 'Allow births' });
  onTap(b, () => { ctx.send({ t: 'births', on: !on }, on ? 'No more children will be born.' : 'Couples in a Fine bedroom may have children.'); ctx.refreshSheet(); });
  row.append(h('h3.ec-sub', { text: 'Births', style: { margin: '0 0 2px' } }), h('p.ec-bio-d', { text: on ? 'On: a couple sharing a Fine bedroom may have a child (a chance each season).' : 'Off: no children are born.' }), h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, b));
  el.append(row);
}

// ---- Halls and visitors (renown steers who comes) ---------------------------------------------------------------
/** "Hold / Halls" (pushed). */
export function openHalls(ctx) {
  ctx.openSheet(t('hold.halls'), (el) => hallsTab(el, ctx), { push: true });
}
function hallsTab(el, ctx) {
  const s = ctx.s;
  let rl = [];
  try { rl = renownLines(s); } catch (_) { rl = []; }
  const known = rl.filter((r) => r[4]).map((r) => r[1]);
  const lead = rl.filter((r) => !r[4] && r[2] > 0).sort((a, b) => b[2] - a[2])[0];
  el.append(h('p.ec-note', { text: known.length ? `Known for ${known.join(', ').toLowerCase()}. Renown steers who visits and who asks to stay.` : lead ? `Not yet known for anything; closest: ${lead[1].toLowerCase()} (${lead[2]} of ${lead[3]}).` : 'Not yet known for anything. Craft, grow, fight and build well to earn renown.' }));
  let hv = [];
  try { hv = hallsView(s); } catch (_) { hv = []; }
  if (!hv.length) { el.append(h('p.ec-note', { text: t('hold.halls.none') })); return; }
  el.append(banner('merchant', 'Halls and visitors'));
  for (const x of hv) el.append(h('div.ec-thought.' + (x.count ? 'good' : 'bad'), null, h('span.ec-thought-n', { text: x.name }), h('span.ec-thought-w', { text: x.visitors.length ? x.visitors.map((v) => `${v.name} (${v.kind.toLowerCase()})`).join(', ') : x.count ? 'no visitors now' : 'none yet' }), h('b', { text: String(x.count) })));
}

// ---- Research (7.12): the cards first; the paragraphs are the sheet's "?" ----------------------------------------
function researchTab(el, ctx) {
  const s = ctx.s;
  if (!S2) { el.append(h('p.ec-note', { text: 'Research comes with the first techs.' })); return; }
  const r = s.colony.research || { cur: null, pts: 0 };
  const cur = r.cur ? def('tech', r.cur) : null;
  const study = s.bld.some((b) => b && b.st === 'done' && (b.def === 'study' || b.def === 'scriptorium'));
  if (cur) {
    const cost = Math.max(1, costOf(s, cur)), pct = Math.min(100, Math.round((r.pts * 100) / cost));
    el.append(h('div.ec-research-cur', null, h('b', { text: `Researching ${cur.name}` }), h('span.ec-skill-bar', null, h('i', { style: { width: pct + '%' } })), h('span', { text: `${r.pts} of ${cost} lore` })));
  } else el.append(h('div.ec-cover.warn', { role: 'status' }, h('span', { html: icon('book') }), h('span', { text: study ? t('hold.research.none', { lore: s.colony.lore | 0 }) : t('hold.research.noStudy') })));
  if (cur && !study) el.append(h('p.ec-note', { text: t('hold.research.noStudy') }));
  for (const era of all('era')) {
    if (era.id === 'crown') continue;
    const open = eraOpen(s, era.id);
    const tier = def('tier', era.tier);
    el.append(h('h3.ec-sub', { text: `${era.name || era.id}${open ? '' : ` (needs ${tier ? tier.name : era.tier})`}` }));
    const grid = h('div.ec-grid');
    for (const tc of all('tech').filter((x) => x.era === era.id)) {
      const known = hasTech(s, tc.id), cost = costOf(s, tc), isCur = r.cur === tc.id;
      const locked = known ? null : !open ? 'Era not open' : null;
      const b = h('button.ec-card.ec-tech' + (known ? '.on' : '') + (isCur ? '.cur' : '') + (locked ? '.locked' : ''), { type: 'button', 'data-act': 'tech-' + tc.id, 'aria-disabled': locked ? 'true' : null, 'aria-pressed': isCur ? 'true' : 'false' },
        h('span.ec-card-ic', { html: icon(known ? 'check' : 'book') }), h('span.ec-card-n', { text: tc.name }),
        h('span.ec-card-sub', { text: known ? 'Known' : isCur ? `Researching: ${r.pts}/${cost}` : locked || `${cost} lore${cost < tc.cost ? ' (discovered)' : ''}` }));
      onTap(b, () => {
        if (known) { ctx.toast(`${tc.name}: ${tc.text || 'known'}.`); return; }
        if (locked) { ctx.toast(`${tc.name}: the ${era.name || era.id} era opens at ${tier ? tier.name : era.tier}.`); return; }
        const res = ctx.send({ t: 'research', tech: tc.id }, `Researching ${tc.name}. ${tc.text || ''}`.trim());
        if (res && res.ok) ctx.refreshSheet();
      }, { longpress: () => { const wn = whenOf(tc.id); ctx.toast(`${tc.name}: ${tc.text || ''}${wn && !known ? ` Or by doing: ${wn.text}` : ''}`); } });
      grid.append(b);
    }
    el.append(grid);
  }
}

// ---- Stock: every item by category; tap a kind to find a stack ------------------------------------------------
function stockTab(el, ctx) {
  const s = ctx.s;
  const tot = new Map();
  for (const it of s.items) if (it && !it.f) tot.set(it.k, (tot.get(it.k) || 0) + it.n);
  if (!tot.size) { el.append(h('p.ec-note', { text: 'Nothing in stock.' })); return; }
  const cats = all('itemCat');
  const topOf = (cat) => { const c = cats.find((x) => x.id === cat); return c && c.parent ? c.parent : cat; };
  const groups = new Map();
  for (const k of [...tot.keys()].sort()) {
    const d = def('item', k) || { name: k, cat: 'goods' };
    const top = topOf(d.cat || 'goods');
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push([k, d]);
  }
  const order = cats.filter((c) => !c.parent).map((c) => c.id);
  for (const g of [...groups.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const c = cats.find((x) => x.id === g);
    const list = groups.get(g);
    el.append(h('h3.ec-sub', { text: `${c ? c.name : g} (${list.reduce((n, [k]) => n + tot.get(k), 0)})` }));
    for (const [k, d] of list) {
      const row = h('button.ec-row', { type: 'button', 'data-act': 'stock-' + k }, h('span.ec-row-n', { text: d.name }), h('b.ec-row-v', { text: String(tot.get(k)) }));
      onTap(row, () => { const it = s.items.find((x) => x && x.k === k); if (it) { ctx.closeSheet(); if (ctx.setLevel && it.z !== undefined) ctx.setLevel(it.z | 0); ctx.centerOn((it.x + 0.5) * 32, (it.y + 0.5) * 32); ctx.select({ kind: 'item', id: it.id, tile: it.y * s.w + it.x, x: it.x, y: it.y }); } });
      el.append(row);
    }
  }
}

// ---- Chronicle (9.9) ------------------------------------------------------------------------------------------
function chronicleTab(el, ctx) {
  const s = ctx.s;
  const list = s.chron || [];
  if (!list.length) el.append(h('p.ec-note', { text: 'Nothing written yet. The founding, the first raid held, masterworks and deaths go here.' }));
  let lastYear = null;
  for (let k = list.length - 1; k >= 0 && k >= list.length - 120; k--) {
    const e = list[k], tick = e[0] | 0, y = yearOf(tick);
    if (y !== lastYear) { lastYear = y; el.append(h('h3.ec-sub', { text: `Year ${y + 1}` })); }
    el.append(h('div.ec-log', null, h('span.ec-log-d', { text: e[1] === 'year' ? 'Summary' : `${SEASON_NAMES[seasonOf(tick)]} ${dayOfSeason(tick) + 1}` }), h('span.ec-log-t', { text: chronLine(e) })));
  }
  const deeds = all('deed');
  if (S2 && deeds.length) {
    const done = s.colony.deeds || [];
    el.append(h('h3.ec-sub', { text: `Deeds: ${done.length} of ${deeds.length}` }));
    const rows = deeds.slice().sort((a, b) => (done.includes(b.id) ? 1 : 0) - (done.includes(a.id) ? 1 : 0));
    for (const d of rows) {
      const ok = done.includes(d.id);
      let p = 0; try { p = deedProgress(s, d); } catch (_) { p = 0; }
      el.append(h('div.ec-thought.' + (ok ? 'good' : 'bad') + '.ec-deed', null, h('span.ec-thought-n', { text: d.name }), h('span.ec-thought-w', { text: ok ? 'Done' : d.text || '' }), h('b', { text: ok ? '' : `${p}/${d.goal.n}` })));
    }
  }
}

// ---- shared bits ----------------------------------------------------------------------------------------------
function bar(label, have, need) {
  const pct = need > 0 ? Math.min(100, Math.round((have * 100) / need)) : 100;
  return h('div.ec-need.' + (have >= need ? 'good' : 'warn'), { role: 'meter', 'aria-label': `${label} ${have} of ${need}` },
    h('span.ec-need-n', { text: label }), h('span.ec-skill-bar', null, h('i', { style: { width: pct + '%' } })), h('b.ec-skill-l', { text: `${short(have)}/${short(need)}` }));
}
const short = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : String(n));
/** An illustrated section header: a pixel glyph on a brass-edged banner. */
export const banner = (ic, text) => h('h3.ec-sub.ec-banner', null, h('span.ec-banner-ic', { html: icon(ic) }), h('span', { text }));

// ---- the old entry point and the 8-tab Colony sheet (the shell without SHELL2) -----------------------------------
const OLD_TABS = Object.freeze(['People', 'Work', 'Schedule', 'Research', 'Stock', 'Military', 'Chronicle', 'Hold']);
export const COLONY_TABS = SHELL2_ON ? Object.freeze(HOLD_KEYS.map(tabLabel)) : OLD_TABS;
const TAB_HELP = {
  People: 'Everyone in the hold with their roles. Tap a name to find them, a chip to change the role.',
  Work: 'Roles set each colonist\'s work priorities. The grid edits them one by one: 1 first, 4 last.',
  Schedule: 'Each hour is Sleep, Work, Joy or Anything. Joy hours fill the Joy need; sleep in a bed.',
  Research: 'Scholars at a study turn lore into techs. Pick one; points left over are banked for the next.',
  Stock: 'Everything the colony owns, stored or not. Tap a kind to find a stack on the map.',
  Chronicle: 'The hold\'s history as it happened, and the deeds it is working toward.',
  Military: 'Squads, their uniforms and drills, and the alert: Peace, Muster or Shelter.',
  Hold: 'How far the hold has come: its offices, laws, Annals and halls, its tier, the Hearth, wealth, friends and enemies.',
};
/** The old links ("Colony > Work", the ledger's "Hold", the stock chip's long-press) land on the new sheets. */
export function openColony(ctx, tab = 'People') {
  if (SHELL2_ON) {
    if (PEOPLE_TABS[tab]) { openPeople(ctx, { view: tab === 'Work' && ctx.settings && ctx.settings().advancedGrid ? 'Grid' : PEOPLE_TABS[tab], military: tab === 'Military' }); return; }
    openHold(ctx, tab);
    return;
  }
  const ui = { page: 0, grid: null };
  ctx.openSheet('Colony', (el, tb) => {
    if (TAB_HELP[tb]) el.append(h('p.ec-note.ec-help-line', { text: TAB_HELP[tb] }));
    if (tb === 'People') peopleList(el, ctx);
    else if (tb === 'Work') workTab(el, ctx, ui);
    else if (tb === 'Schedule') scheduleTab(el, ctx);
    else if (tb === 'Research') researchTab(el, ctx);
    else if (tb === 'Stock') stockTab(el, ctx);
    else if (tb === 'Chronicle') chronicleTab(el, ctx);
    else if (tb === 'Military') militaryTab(el, ctx);
    else if (tb === 'Hold') legacyHoldTab(el, ctx);
  }, { tabs: OLD_TABS, tab: OLD_TABS.includes(tab) ? tab : 'People', crumb: (tb) => tb });
}
/** The old Hold tab: its hub of screens (each pushes), renown, halls, customs and laws, tier, world, factions. */
function legacyHoldTab(el, ctx) {
  if (S2) {
    const go = (label, act, fn) => { const b = h('button.ec-act', { type: 'button', 'data-act': act, text: label }); onTap(b, () => fn(ctx)); return b; };
    el.append(banner('castle', 'The hold'), h('div.ec-rchips.ec-hold-go', { style: { justifyContent: 'flex-start', flexWrap: 'wrap', gap: '6px' } },
      go('Offices', 'hold-offices', openOffices), go('Justice', 'hold-justice', openJustice), go('Annals', 'hold-annals', (c) => openAnnals(c)), go('The dead', 'hold-dead', openDead)));
    hallsTab(el, ctx);
    customsBlock(el, ctx);
    lawsSwitch(el, ctx.s, ctx, () => ctx.refreshSheet());
  }
  tierBlock(el, ctx);
  seasonBlock(el, ctx, true);
  if (S2) factionsBlock(el, ctx, true);
}
