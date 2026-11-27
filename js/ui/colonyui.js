// The Colony sheet (owner I; doc 10.3, 10.4, 5.2, 7.12, 8.4, 9.9, 9.10). Its tabs are a scrolling
// icon-and-label strip: People (list with roles), Work (roles, or the Advanced grid), Schedule (the
// 24 hours of each colonist: presets and an hour editor), Research (eras, techs, progress, banked
// lore), Stock (every item by category, tap to find it), Chronicle (the hold's history and its deeds)
// and Hold (tier progress, the Hearth and its upgrade, wealth, factions, nemeses, the storyteller,
// the season and weather). Read-only views of state; every change is a command (C3).
// W1.3a (EMBERCROWN-WORLD.md 8.1): with the new shell (SHELL2_ON) People, Work, Schedule and Military move to the
// People sheet (peopleui.js), this sheet is titled Hold (Overview, Stock, Research, Chronicle), and openWorld is
// the World slot's interim sheet (Annals, Letters, The dead, factions) until W1.3b's holdui.js and worldui.js.
import { h, onTap, icon } from './kit.js';
import { def, all, structDef } from '../game/core/content.js';
import { dayOf, seasonOf, yearOf, SEASON_NAMES, TICKS_PER_DAY, dayOfSeason } from '../game/core/time.js';
import { hasTech, costOf, eraOpen } from '../game/colony/research.js';
import { tierView } from '../game/colony/tiers.js';
import { computeWealth } from '../game/colony/wealth.js';
import { standingOf, goodwill, GOODWILL_IDS } from '../game/colony/factions.js';
import { chronLine } from '../game/colony/chronicle.js';
import { progress as deedProgress } from '../game/colony/deeds.js';
import { fullName } from '../game/threat/nemesis.js';
import { weatherText } from '../game/world/weather.js';
import { outdoorTemp } from '../game/world/temperature.js';
import { peopleList } from './rolesui.js';
import { SHELL2_ON, openPeople, workTab, scheduleTab } from './peopleui.js';
import { STAGE } from './stage.js';
// Stage Z2 (EMBERCROWN-FORTRESS.md 3.4-3.13): the Military tab and the hold's offices, justice, Annals, dead,
// halls, renown, births and laws from the Hold tab
import { militaryTab } from './military.js';
import { openOffices } from './officesui.js';
import { openJustice, lawsSwitch } from './justiceui.js';
import { openAnnals } from './annals.js';
import { openLetters } from './letters.js';
import { openDead } from './burialui.js';
import { hallsView } from '../game/colony/visitors.js';
import { renownLines } from '../game/colony/renown.js';
import { birthsOn } from '../game/people/family.js';
import { whenOf } from '../game/colony/verbs/discovery.js';

const OLD_TABS = Object.freeze(['People', 'Work', 'Schedule', 'Research', 'Stock', 'Military', 'Chronicle', 'Hold']);
/** With the new shell (W1.3a) People, Work, Schedule and Military live on the People sheet; this sheet is Hold. */
const HOLD_TABS = Object.freeze(['Overview', 'Stock', 'Research', 'Chronicle']);
export const COLONY_TABS = SHELL2_ON ? HOLD_TABS : OLD_TABS;
const PEOPLE_TABS = { People: 'List', Work: 'List', Schedule: 'Schedule', Military: 'List' };
const S2 = STAGE !== '1a' && STAGE !== '1b';
const TAB_HELP = {
  People: 'Everyone in the hold with their roles. Tap a name to find them, a chip to change the role.',
  Work: 'Roles set each colonist\'s work priorities. The grid edits them one by one: 1 first, 4 last.',
  Schedule: 'Each hour is Sleep, Work, Joy or Anything. Joy hours fill the Joy need; sleep in a bed.',
  Research: 'Scholars at a study turn lore into techs. Pick one; points left over are banked for the next.',
  Stock: 'Everything the colony owns, stored or not. Tap a kind to find a stack on the map.',
  Chronicle: 'The hold\'s history as it happened, and the deeds it is working toward.',
  Military: 'Squads, their uniforms and drills, and the alert: Peace, Muster or Shelter.',
  Overview: 'How far the hold has come: its offices, laws, Annals and halls, its tier, the Hearth, wealth, friends and enemies.',
  Hold: 'How far the hold has come: its offices, laws, Annals and halls, its tier, the Hearth, wealth, friends and enemies.',
};

/** The Colony sheet (10.3). ui: per-open state (work page, grid on). */
export function openColony(ctx, tab = 'People') {
  if (SHELL2_ON) {
    // the old links ("Colony > Work", the ledger's "Hold", the stock chip's long-press) land on the new sheets
    if (PEOPLE_TABS[tab]) { openPeople(ctx, { view: tab === 'Work' && ctx.settings && ctx.settings().advancedGrid ? 'Grid' : PEOPLE_TABS[tab], military: tab === 'Military' }); return; }
    if (tab === 'Hold' || !HOLD_TABS.includes(tab)) tab = 'Overview';
  }
  const ui = { page: 0, grid: null };
  ctx.openSheet(SHELL2_ON ? 'Hold' : 'Colony', (el, t) => {
    if (TAB_HELP[t]) el.append(h('p.ec-note.ec-help-line', { text: TAB_HELP[t] }));
    if (t === 'People') peopleList(el, ctx);
    else if (t === 'Work') workTab(el, ctx, ui);
    else if (t === 'Schedule') scheduleTab(el, ctx);
    else if (t === 'Research') researchTab(el, ctx);
    else if (t === 'Stock') stockTab(el, ctx);
    else if (t === 'Chronicle') chronicleTab(el, ctx);
    else if (t === 'Military') militaryTab(el, ctx);
    else if (t === 'Hold' || t === 'Overview') holdTab(el, ctx);
  }, { tabs: COLONY_TABS, tab: COLONY_TABS.includes(tab) ? tab : COLONY_TABS[0], crumb: (t) => t });
}

// Work (the grid), Schedule and Military moved to the People sheet (peopleui.js, W1.3a); the old tabs below
// call them while the new shell is off.

// ---- Research (7.12) ------------------------------------------------------------------------------------
function researchTab(el, ctx) {
  const s = ctx.s;
  if (!S2) { el.append(h('p.ec-note', { text: 'Research comes with the first techs.' })); return; }
  const r = s.colony.research || { cur: null, pts: 0 };
  const cur = r.cur ? def('tech', r.cur) : null;
  if (cur) {
    const cost = Math.max(1, costOf(s, cur)), pct = Math.min(100, Math.round((r.pts * 100) / cost));
    el.append(h('div.ec-research-cur', null, h('b', { text: `Researching ${cur.name}` }), h('span.ec-skill-bar', null, h('i', { style: { width: pct + '%' } })), h('span', { text: `${r.pts} of ${cost} lore` })));
  } else el.append(h('div.ec-cover.warn', { role: 'status' }, h('span', { html: icon('book') }), h('span', { text: `Nothing is being researched${s.colony.lore ? `: ${s.colony.lore} lore banked` : ''}. Pick a tech below.` })));
  if (!s.bld.some((b) => b && b.st === 'done' && (b.def === 'study' || b.def === 'scriptorium'))) el.append(h('p.ec-note', { text: 'Build a study (Build > Workshops) and give someone the Scholar role: lore comes from study hours.' }));
  el.append(h('p.ec-note', { text: 'Some techs are also discovered by doing (digging, crafting, a vault tablet, a visiting scholar): hold a tech to see how.' }));
  for (const era of all('era')) {
    if (era.id === 'crown') continue;
    const open = eraOpen(s, era.id);
    const tier = def('tier', era.tier);
    el.append(h('h3.ec-sub', { text: `${era.name || era.id}${open ? '' : ` (needs ${tier ? tier.name : era.tier})`}` }));
    const grid = h('div.ec-grid');
    for (const t of all('tech').filter((x) => x.era === era.id)) {
      const known = hasTech(s, t.id), cost = costOf(s, t), isCur = r.cur === t.id;
      const locked = known ? null : !open ? 'Era not open' : null;
      const b = h('button.ec-card.ec-tech' + (known ? '.on' : '') + (isCur ? '.cur' : '') + (locked ? '.locked' : ''), { type: 'button', 'data-act': 'tech-' + t.id, 'aria-disabled': locked ? 'true' : null, 'aria-pressed': isCur ? 'true' : 'false' },
        h('span.ec-card-ic', { html: icon(known ? 'check' : 'book') }), h('span.ec-card-n', { text: t.name }),
        h('span.ec-card-sub', { text: known ? 'Known' : isCur ? `Researching: ${r.pts}/${cost}` : locked || `${cost} lore${cost < t.cost ? ' (discovered)' : ''}` }));
      onTap(b, () => {
        if (known) { ctx.toast(`${t.name}: ${t.text || 'known'}.`); return; }
        if (locked) { ctx.toast(`${t.name}: the ${era.name || era.id} era opens at ${tier ? tier.name : era.tier}.`); return; }
        const res = ctx.send({ t: 'research', tech: t.id }, `Researching ${t.name}. ${t.text || ''}`.trim());
        if (res && res.ok) ctx.refreshSheet();
      }, { longpress: () => { const w = whenOf(t.id); ctx.toast(`${t.name}: ${t.text || ''}${w && !known ? ` Or by doing: ${w.text}` : ''}`); } });
      grid.append(b);
    }
    el.append(grid);
  }
}

// ---- Stock -------------------------------------------------------------------------------------------------
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
      onTap(row, () => { const it = s.items.find((x) => x && x.k === k); if (it) { ctx.closeSheet(); ctx.centerOn((it.x + 0.5) * 32, (it.y + 0.5) * 32); ctx.select({ kind: 'item', id: it.id, tile: it.y * s.w + it.x, x: it.x, y: it.y }); } });
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

// ---- Hold (8.4, 9.8, 9.10) -----------------------------------------------------------------------------------
function bar(label, have, need) {
  const pct = need > 0 ? Math.min(100, Math.round((have * 100) / need)) : 100;
  return h('div.ec-need.' + (have >= need ? 'good' : 'warn'), { role: 'meter', 'aria-label': `${label} ${have} of ${need}` },
    h('span.ec-need-n', { text: label }), h('span.ec-skill-bar', null, h('i', { style: { width: pct + '%' } })), h('b.ec-skill-l', { text: `${short(have)}/${short(need)}` }));
}
const short = (n) => (n >= 10000 ? Math.round(n / 1000) + 'k' : String(n));
function holdTab(el, ctx) {
  const s = ctx.s;
  if (S2) holdZ2(el, ctx);
  const tv = tierView(s);
  el.append(h('div.ec-hold-tier', null, h('span.ec-letter-ic', { html: icon('crown') }), h('div', null, h('b', { text: tv.name || 'Camp' }), h('p.ec-bio-d', { text: tv.text || '' }))));
  if (tv.next) {
    const n = tv.next;
    el.append(banner('crown', `Toward ${n.name}`), bar('Wealth', n.wealth[0], n.wealth[1]), bar('Colonists', n.colonists[0], n.colonists[1]), bar('Hearth level', n.hearth[0], n.hearth[1]),
      h('p.ec-note', { text: 'All three must hold for a full day.' }));
  }
  // the Hearth and its upgrade
  const hr = s.colony.hearth, hb = hr && hr.id !== null && hr.id !== undefined ? s.bld[hr.id] : null;
  if (hb) {
    const d = structDef(hb.def) || {};
    const lv = (d.levels || [])[(hb.lvl | 0) - 1] || null;
    el.append(banner('flame', `The Hearth, level ${hb.lvl | 0}`));
    const facts = h('div.ec-facts');
    facts.append(h('div.ec-fact', null, h('span', { text: 'Fuel' }), h('b', { text: `${Math.floor((hr.fuel | 0) / 600)} h of wood` })));
    el.append(facts);
    if (lv && S2) {
      // "Upgrade to the Banked Hearth" and what it takes (a bare "Upgrade: Banked" read as a mystery)
      const need = Object.entries(lv.cost || {}).map(([k, n]) => { const [base, mat] = k.split(':'); const it = def('item', base); return `${n} ${mat ? mat + ' ' : ''}${((it && it.name) || base).toLowerCase()}`; }).join(', ');
      const up = h('button.ec-act.ec-wide', { type: 'button', 'data-act': 'hearth-upgrade', text: lv.name ? `Upgrade to the ${lv.name} Hearth` : 'Upgrade the Hearth' });
      if (need) facts.append(h('div.ec-fact', null, h('span', { text: 'Next level needs' }), h('b', { text: need })));
      onTap(up, () => ctx.send({ t: 'upgrade', bId: hb.id }, 'Hearth upgrade planned: builders bring what it needs.'));
      el.append(up);
    }
  }
  // wealth
  let w = null; try { w = computeWealth(s); } catch (_) { w = null; }
  if (w) el.append(banner('gold', `Wealth ${w.total}`), h('div.ec-facts', null,
    h('div.ec-fact', null, h('span', { text: 'Goods' }), h('b', { text: String(Math.round(w.items / 10)) })),
    h('div.ec-fact', null, h('span', { text: 'Buildings' }), h('b', { text: String(Math.round(w.bld / 10)) })),
    h('div.ec-fact', null, h('span', { text: 'People' }), h('b', { text: String(w.pop) }))), h('p.ec-note', { text: 'Raids grow with wealth: walls and defences count less.' }));
  // the world: season, weather, storyteller
  const sd = def('storyteller', s.colony.storyteller), diff = s.colony.difficulty;
  const wx = (() => { try { return weatherText(s); } catch (_) { return null; } })();
  const tmp = (() => { try { return Math.round(outdoorTemp(s.tick, s)); } catch (_) { return null; } })();
  el.append(banner('map', 'The world'), h('div.ec-facts', null,
    h('div.ec-fact', null, h('span', { text: 'Season' }), h('b', { text: `${SEASON_NAMES[seasonOf(s.tick)]}, day ${dayOfSeason(s.tick) + 1} of 10` })),
    wx ? h('div.ec-fact', null, h('span', { text: 'Weather' }), h('b', { text: wx })) : null,
    tmp !== null ? h('div.ec-fact', null, h('span', { text: 'Outside' }), h('b', { text: `${tmp} C` })) : null,
    h('div.ec-fact', null, h('span', { text: 'Storyteller' }), h('b', { text: sd ? sd.name : s.colony.storyteller })),
    h('div.ec-fact', null, h('span', { text: 'Difficulty' }), h('b', { text: diff ? diff.charAt(0).toUpperCase() + diff.slice(1) : '' })),
    h('div.ec-fact', null, h('span', { text: 'Day' }), h('b', { text: String(dayOf(s.tick) + 1) }))));
  if (S2) factionsBlock(el, ctx);
  // nemeses (9.10)
  const nems = (s.st && s.st.nemeses) || [];
  if (S2) {
    el.append(banner('skull', nems.length ? 'Nemeses' : 'No nemeses'));
    if (!nems.length) el.append(h('p.ec-note', { text: 'A raid leader who escapes, wounded or ransomed, remembers the hold, and comes back.' }));
    for (const n of nems) el.append(nemesisRow(ctx, n));
  }
}
/** The factions: name, standing, goodwill; a waiting envoy. */
function factionsBlock(el, ctx) {
  const s = ctx.s;
  {
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
  }
}
/** The World slot (W1.3a, interim until W1.3b's worldui.js): Annals, Letters and The dead push inside it. */
export function openWorld(ctx) {
  ctx.openSheet('World', (el) => {
    const go = (label, act, fn) => { const b = h('button.ec-act', { type: 'button', 'data-act': act, text: label }); onTap(b, fn); return b; };
    el.append(h('div.ec-rchips.ec-hold-go', { style: { justifyContent: 'flex-start', flexWrap: 'wrap', gap: '6px' } },
      go('Annals', 'world-annals', () => openAnnals(ctx)),
      ctx.letters ? go('Letters', 'world-letters', () => openLetters(ctx, ctx.letters)) : null,
      go('The dead', 'world-dead', () => openDead(ctx))));
    if (S2) factionsBlock(el, ctx);
  }, { intro: { key: 'world', text: 'The world beyond the hold: its Annals, the letters that reach you, the dead you remember and the factions that watch you.' } });
}
// Z2: the hold's people and customs, first on the Hold tab (each opens its own screen)
function holdZ2(el, ctx) {
  const s = ctx.s;
  const go = (label, act, fn) => { const b = h('button.ec-act', { type: 'button', 'data-act': act, text: label }); onTap(b, () => fn(ctx)); return b; };
  el.append(banner('castle', 'The hold'), h('div.ec-rchips.ec-hold-go', { style: { justifyContent: 'flex-start', flexWrap: 'wrap', gap: '6px' } },
    go('Offices', 'hold-offices', openOffices), go('Justice', 'hold-justice', openJustice), go('Annals', 'hold-annals', (c) => openAnnals(c)), go('The dead', 'hold-dead', openDead)));
  // renown: what the hold is known for (it steers who visits)
  let rl = [];
  try { rl = renownLines(s); } catch (_) { rl = []; }
  const known = rl.filter((r) => r[4]).map((r) => r[1]);
  const lead = rl.filter((r) => !r[4] && r[2] > 0).sort((a, b) => b[2] - a[2])[0];
  el.append(h('p.ec-note', { text: known.length ? `Known for ${known.join(', ').toLowerCase()}. Renown steers who visits and who asks to stay.` : lead ? `Not yet known for anything; closest: ${lead[1].toLowerCase()} (${lead[2]} of ${lead[3]}).` : 'Not yet known for anything. Craft, grow, fight and build well to earn renown.' }));
  // the halls and their visitors
  let hv = [];
  try { hv = hallsView(s); } catch (_) { hv = []; }
  if (hv.length) {
    el.append(banner('merchant', 'Halls and visitors'));
    for (const x of hv) el.append(h('div.ec-thought.' + (x.count ? 'good' : 'bad'), null, h('span.ec-thought-n', { text: x.name }), h('span.ec-thought-w', { text: x.visitors.length ? x.visitors.map((v) => `${v.name} (${v.kind.toLowerCase()})`).join(', ') : x.count ? 'no visitors now' : 'none yet' }), h('b', { text: String(x.count) })));
    el.append(h('p.ec-note', { text: 'A tavern, temple or library draws visitors; one who likes the hold may write asking to stay.' }));
  }
  // customs: births and the laws (each can be turned off)
  el.append(banner('book', 'Customs'));
  const on = birthsOn(s);
  const row = h('div.ec-laws', { 'data-births': on ? 'on' : 'off' });
  const b = h('button.ec-act', { type: 'button', 'data-act': 'births-toggle', text: on ? 'Stop births' : 'Allow births' });
  onTap(b, () => { ctx.send({ t: 'births', on: !on }, on ? 'No more children will be born.' : 'Couples in a Fine bedroom may have children.'); ctx.refreshSheet(); });
  row.append(h('h3.ec-sub', { text: 'Births', style: { margin: '0 0 2px' } }), h('p.ec-bio-d', { text: on ? 'On: a couple sharing a Fine bedroom may have a child (a chance each season).' : 'Off: no children are born.' }), h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, b));
  el.append(row);
  lawsSwitch(el, s, ctx, () => ctx.refreshSheet());
}
/** An illustrated section header of the Hold tab: a pixel glyph on a brass-edged banner. */
const banner = (ic, text) => h('h3.ec-sub.ec-banner', null, h('span.ec-banner-ic', { html: icon(ic) }), h('span', { text }));
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
