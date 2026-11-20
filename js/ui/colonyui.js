// The Colony sheet (owner I; doc 10.3, 10.4, 5.2, 7.12, 8.4, 9.9, 9.10). Its tabs are a scrolling
// icon-and-label strip: People (list with roles), Work (roles, or the Advanced grid), Schedule (the
// 24 hours of each colonist: presets and an hour editor), Research (eras, techs, progress, banked
// lore), Stock (every item by category, tap to find it), Chronicle (the hold's history and its deeds)
// and Hold (tier progress, the Hearth and its upgrade, wealth, factions, nemeses, the storyteller,
// the season and weather). Read-only views of state; every change is a command (C3).
import { h, onTap, icon } from './kit.js';
import { def, all, structDef } from '../game/core/content.js';
import { WORK_IDS, SCHED } from '../game/core/schema.js';
import { dayOf, seasonOf, yearOf, SEASON_NAMES, TICKS_PER_DAY, dayOfSeason } from '../game/core/time.js';
import { workGrid, schedulePreset, scheduleName, SCHEDULES } from '../game/people/roles.js';
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
import { STAGE } from './stage.js';

export const COLONY_TABS = Object.freeze(['People', 'Work', 'Schedule', 'Research', 'Stock', 'Chronicle', 'Hold']);
const S2 = STAGE !== '1a' && STAGE !== '1b';
const TAB_HELP = {
  People: 'Everyone in the hold with their roles. Tap a name to find them, a chip to change the role.',
  Work: 'Roles set each colonist\'s work priorities. The grid edits them one by one: 1 first, 4 last.',
  Schedule: 'Each hour is Sleep, Work, Joy or Anything. Joy hours fill the Joy need; sleep in a bed.',
  Research: 'Scholars at a study turn lore into techs. Pick one; points left over are banked for the next.',
  Stock: 'Everything the colony owns, stored or not. Tap a kind to find a stack on the map.',
  Chronicle: 'The hold\'s history as it happened, and the deeds it is working toward.',
  Hold: 'How far the hold has come: its tier, the Hearth, wealth, its friends and its enemies.',
};

/** The Colony sheet (10.3). ui: per-open state (work page, grid on). */
export function openColony(ctx, tab = 'People') {
  const ui = { page: 0, grid: null };
  ctx.openSheet('Colony', (el, t) => {
    if (TAB_HELP[t]) el.append(h('p.ec-note.ec-help-line', { text: TAB_HELP[t] }));
    if (t === 'People') peopleList(el, ctx);
    else if (t === 'Work') workTab(el, ctx, ui);
    else if (t === 'Schedule') scheduleTab(el, ctx);
    else if (t === 'Research') researchTab(el, ctx);
    else if (t === 'Stock') stockTab(el, ctx);
    else if (t === 'Chronicle') chronicleTab(el, ctx);
    else if (t === 'Hold') holdTab(el, ctx);
  }, { tabs: COLONY_TABS, tab: COLONY_TABS.includes(tab) ? tab : 'People' });
}

// ---- Work: roles or the Advanced grid (10.4) --------------------------------------------------------------
const PAGES_P = [['Labour', ['haul', 'chop', 'mine', 'build', 'grow']], ['Make', ['cook', 'smith', 'craft', 'tailor', 'art']], ['Care', ['care', 'animals', 'lore']]];
// landscape: the sheet is the 320 pt overlay panel, so the pages stay at most 5 columns there too
const PAGES_L = PAGES_P;
const WORK_ICON = { haul: 'crate', chop: 'axe', mine: 'pick', build: 'hammer', grow: 'farm', cook: 'food', smith: 'sword', craft: 'saw', tailor: 'banner', art: 'relic', care: 'heart', animals: 'pop', lore: 'book' };
function workTab(el, ctx, ui) {
  const adv = ui.grid !== null ? ui.grid : !!(ctx.settings && ctx.settings().advancedGrid);
  const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Work view' });
  for (const [label, v] of [['Roles', false], ['Grid', true]]) {
    const b = h('button.ec-seg-b' + (adv === v ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': adv === v ? 'true' : 'false', 'data-act': 'work-' + (v ? 'grid' : 'roles'), text: label });
    onTap(b, () => { ui.grid = v; ctx.refreshSheet(); });
    seg.append(b);
  }
  el.append(seg);
  if (!adv) { peopleList(el, ctx, { work: true }); return; }
  const pages = ctx.isLand() ? PAGES_L : PAGES_P;
  if (ui.page >= pages.length) ui.page = 0;
  const pg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Work types' });
  pages.forEach(([label], k) => {
    const b = h('button.ec-seg-b' + (ui.page === k ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': ui.page === k ? 'true' : 'false', 'data-act': 'grid-page-' + k, text: label });
    onTap(b, () => { ui.page = k; ctx.refreshSheet(); });
    pg.append(b);
  });
  el.append(pg);
  const works = pages[ui.page][1];
  const grid = h('div.ec-wgrid', { role: 'grid', style: { '--cols': String(works.length) } });
  const head = h('div.ec-wrow.ec-whead', { role: 'row' }, h('span.ec-wname', { text: '' }));
  for (const w of works) {
    const d = def('worktype', w) || { name: w };
    const b = h('button.ec-wh', { type: 'button', role: 'columnheader', 'data-act': 'grid-head-' + w, 'aria-label': d.name, html: icon(WORK_ICON[w] || 'gear') });
    onTap(b, () => { ui.sort = ui.sort === w ? null : w; ctx.toast(`${d.name}${ui.sort ? ': sorted by skill' : ''}.`); ctx.refreshSheet(); });
    head.append(b);
  }
  grid.append(head);
  let rows = workGrid(ctx.s);
  if (ui.sort) { const k = WORK_IDS.indexOf(ui.sort); rows = rows.slice().sort((a, b) => b.cells[k].lvl - a.cells[k].lvl || a.colId - b.colId); }
  for (const r of rows) {
    const c = ctx.s.col.find((x) => x.id === r.colId);
    const row = h('div.ec-wrow', { role: 'row' }, h('span.ec-wname', null, ctx.portrait(c, 32), h('span', { text: r.name.split(' ')[0] }), r.custom ? h('i.ec-wcustom', { 'aria-label': 'Custom', text: '*' }) : null));
    for (const w of works) {
      const k = WORK_IDS.indexOf(w), cell = r.cells[k];
      const b = h('button.ec-wcell' + (cell.off ? '.off' : '') + (cell.p === 1 ? '.p1' : cell.p === 4 ? '.p4' : ''), {
        type: 'button', role: 'gridcell', 'data-act': `prio-${w}`, 'data-col': String(r.colId), 'aria-label': `${r.name} ${w}: ${cell.off ? 'ruled out' : cell.p ? 'priority ' + cell.p : 'off'}`, 'aria-disabled': cell.off ? 'true' : null,
      }, h('b', { text: cell.off ? '' : cell.p ? String(cell.p) : '' }), h('span.ec-wbar', null, h('i', { style: { width: Math.round((cell.lvl / 20) * 100) + '%' } })),
      cell.passion ? h('span.ec-wpass', { html: icon('flame') + (cell.passion > 1 ? icon('flame') : '') }) : null);
      const set = (p) => { ctx.send({ t: 'prio', colId: r.colId, work: w, p }); ctx.refreshSheet(); };
      onTap(b, () => (cell.off ? ctx.toast(`${r.name.split(' ')[0]}'s past rules out ${(def('worktype', w) || { name: w }).name.toLowerCase()}.`) : set(cell.p === 0 ? 1 : cell.p >= 4 ? 0 : cell.p + 1)), {
        longpress: () => { if (!cell.off) prioPicker(ctx, r, w, set); },
      });
      row.append(b);
    }
    grid.append(row);
  }
  el.append(grid, h('p.ec-note', { text: 'Tap a cell: 1, 2, 3, 4, off. Long-press for the whole row or column. The bar is the skill; a flame is a passion. Any edit marks the colonist Custom.' }));
}
function prioPicker(ctx, r, w, set) {
  ctx.openSheet(`${r.name.split(' ')[0]}: ${(def('worktype', w) || { name: w }).name}`, (el) => {
    const grid = h('div.ec-grid');
    const opt = (label, act, fn) => { const b = h('button.ec-card', { type: 'button', 'data-act': act }, h('span.ec-card-ic', { html: icon('check') }), h('span.ec-card-n', { text: label })); onTap(b, () => { fn(); ctx.back(); }); grid.append(b); };
    for (const p of [1, 2, 3, 4]) opt(`Priority ${p}`, 'pick-' + p, () => set(p));
    opt('Off', 'pick-off', () => set(0));
    opt('Whole row', 'pick-row', () => { const p = r.cells[WORK_IDS.indexOf(w)].p || 3; for (const c of r.cells) if (!c.off) ctx.send({ t: 'prio', colId: r.colId, work: c.work, p }, null, true); });
    opt('Whole column', 'pick-col', () => { const p = r.cells[WORK_IDS.indexOf(w)].p || 3; for (const c of ctx.s.col) if (!c.hp.dead) ctx.send({ t: 'prio', colId: c.id, work: w, p }, null, true); });
    el.append(grid);
  }, { back: true });
}

// ---- Schedule (5.2) ---------------------------------------------------------------------------------------
const SCH = [['Sleep', SCHED.SLEEP, 'sleep'], ['Work', SCHED.WORK, 'work'], ['Joy', SCHED.JOY, 'joy'], ['Any', SCHED.ANY, 'any']];
const SCH_CLASS = ['sleep', 'work', 'joy', 'any'];
function strip(sched) {
  const st = h('span.ec-sched', { role: 'img', 'aria-label': 'Schedule' });
  for (let k = 0; k < 24; k++) st.append(h('i.' + SCH_CLASS[sched[k] | 0]));
  return st;
}
function scheduleTab(el, ctx) {
  const s = ctx.s;
  el.append(h('div.ec-sched-key', null, ...SCH.map(([n, , c]) => h('span', null, h('i.' + c), n))));
  for (const c of s.col) {
    if (c.hp.dead) continue;
    const name = scheduleName(c.sched);
    const preset = SCHEDULES.find((p) => p.id === name);
    const b = h('button.ec-srow', { type: 'button', 'data-act': 'sched-edit', 'data-col': String(c.id), 'aria-label': `${c.name}: ${preset ? preset.name : 'Custom'} schedule. Edit` },
      h('span.ec-srow-n', null, h('b', { text: c.name.split(' ')[0] }), h('span', { text: preset ? preset.name : 'Custom' })), strip(c.sched));
    onTap(b, () => scheduleEditor(ctx, c));
    el.append(b);
  }
  // one tap for everyone
  el.append(h('h3.ec-sub', { text: 'Everyone' }));
  const grid = h('div.ec-grid');
  for (const p of SCHEDULES) {
    const b = h('button.ec-card', { type: 'button', 'data-act': 'sched-all-' + p.id }, h('span.ec-card-ic', { html: icon(p.id === 'night' ? 'moon' : 'sun') }), h('span.ec-card-n', { text: p.name }), h('span.ec-card-sub', { text: p.text }));
    onTap(b, () => { const hrs = Array.from(schedulePreset(p.id)); for (const c of s.col) if (!c.hp.dead) ctx.send({ t: 'sched', colId: c.id, hours: hrs }, null, true); ctx.toast(`Everyone: ${p.name}.`); ctx.refreshSheet(); });
    grid.append(b);
  }
  el.append(grid);
}
/** The hour editor: presets, a brush and the 24 hours as a 6 x 4 grid of 44 pt cells. */
export function scheduleEditor(ctx, c) {
  const st = { brush: SCHED.WORK };
  ctx.openSheet(`${c.name.split(' ')[0]}: schedule`, (el) => {
    const send = (hrs, ok) => { ctx.send({ t: 'sched', colId: c.id, hours: hrs }, ok); ctx.refreshSheet(); };
    const pre = h('div.ec-seg', { role: 'group', 'aria-label': 'Presets' });
    const name = scheduleName(c.sched);
    for (const p of SCHEDULES) {
      const b = h('button.ec-seg-b' + (name === p.id ? '.on' : ''), { type: 'button', 'data-act': 'sched-' + p.id, text: p.name });
      onTap(b, () => send(Array.from(schedulePreset(p.id)), `${c.name.split(' ')[0]}: ${p.name}.`));
      pre.append(b);
    }
    el.append(h('h3.ec-sub', { text: 'Presets' }), pre, h('h3.ec-sub', { text: 'Paint hours with' }));
    const brush = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Brush' });
    for (const [n, v, cl] of SCH) {
      const b = h('button.ec-seg-b.ec-brush-' + cl + (st.brush === v ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': st.brush === v ? 'true' : 'false', 'data-act': 'brush-' + cl, text: n });
      onTap(b, () => { st.brush = v; ctx.refreshSheet(); });
      brush.append(b);
    }
    el.append(brush);
    const hours = h('div.ec-hours', { role: 'grid', 'aria-label': 'Hours' });
    for (let k = 0; k < 24; k++) {
      const v = c.sched[k] | 0;
      const b = h('button.ec-hour.' + SCH_CLASS[v], { type: 'button', role: 'gridcell', 'data-act': 'hour-' + k, 'aria-label': `${String(k).padStart(2, '0')}:00 ${SCH[v][0]}` }, h('b', { text: String(k).padStart(2, '0') }), h('span', { text: SCH[v][0] }));
      onTap(b, () => { const hrs = Array.from(c.sched); hrs[k] = st.brush === v ? (v + 1) % 4 : st.brush; send(hrs); });
      hours.append(b);
    }
    el.append(hours, h('p.ec-note', { text: 'Tap an hour to paint it with the brush (tap again to cycle). Night owls like Night watch.' }));
  }, { back: true });
}

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
      }, { longpress: () => ctx.toast(`${t.name}: ${t.text || ''}`) });
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
  const tv = tierView(s);
  el.append(h('div.ec-hold-tier', null, h('span.ec-letter-ic', { html: icon('crown') }), h('div', null, h('b', { text: tv.name || 'Camp' }), h('p.ec-bio-d', { text: tv.text || '' }))));
  if (tv.next) {
    const n = tv.next;
    el.append(h('h3.ec-sub', { text: `Toward ${n.name}` }), bar('Wealth', n.wealth[0], n.wealth[1]), bar('Colonists', n.colonists[0], n.colonists[1]), bar('Hearth level', n.hearth[0], n.hearth[1]),
      h('p.ec-note', { text: 'All three must hold for a full day.' }));
  }
  // the Hearth and its upgrade
  const hr = s.colony.hearth, hb = hr && hr.id !== null && hr.id !== undefined ? s.bld[hr.id] : null;
  if (hb) {
    const d = structDef(hb.def) || {};
    const lv = (d.levels || [])[(hb.lvl | 0) - 1] || null;
    el.append(h('h3.ec-sub', { text: `The Hearth, level ${hb.lvl | 0}` }));
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
  if (w) el.append(h('h3.ec-sub', { text: `Wealth ${w.total}` }), h('div.ec-facts', null,
    h('div.ec-fact', null, h('span', { text: 'Goods' }), h('b', { text: String(Math.round(w.items / 10)) })),
    h('div.ec-fact', null, h('span', { text: 'Buildings' }), h('b', { text: String(Math.round(w.bld / 10)) })),
    h('div.ec-fact', null, h('span', { text: 'People' }), h('b', { text: String(w.pop) }))), h('p.ec-note', { text: 'Raids grow with wealth: walls and defences count less.' }));
  // the world: season, weather, storyteller
  const sd = def('storyteller', s.colony.storyteller), diff = s.colony.difficulty;
  const wx = (() => { try { return weatherText(s); } catch (_) { return null; } })();
  const tmp = (() => { try { return Math.round(outdoorTemp(s.tick, s)); } catch (_) { return null; } })();
  el.append(h('h3.ec-sub', { text: 'The world' }), h('div.ec-facts', null,
    h('div.ec-fact', null, h('span', { text: 'Season' }), h('b', { text: `${SEASON_NAMES[seasonOf(s.tick)]}, day ${dayOfSeason(s.tick) + 1} of 10` })),
    wx ? h('div.ec-fact', null, h('span', { text: 'Weather' }), h('b', { text: wx })) : null,
    tmp !== null ? h('div.ec-fact', null, h('span', { text: 'Outside' }), h('b', { text: `${tmp} C` })) : null,
    h('div.ec-fact', null, h('span', { text: 'Storyteller' }), h('b', { text: sd ? sd.name : s.colony.storyteller })),
    h('div.ec-fact', null, h('span', { text: 'Difficulty' }), h('b', { text: diff ? diff.charAt(0).toUpperCase() + diff.slice(1) : '' })),
    h('div.ec-fact', null, h('span', { text: 'Day' }), h('b', { text: String(dayOf(s.tick) + 1) }))));
  // factions
  if (S2) {
    el.append(h('h3.ec-sub', { text: 'Factions' }));
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
  // nemeses (9.10)
  const nems = (s.st && s.st.nemeses) || [];
  if (S2) {
    el.append(h('h3.ec-sub', { text: nems.length ? 'Nemeses' : 'No nemeses' }));
    if (!nems.length) el.append(h('p.ec-note', { text: 'A raid leader who escapes, wounded or ransomed, remembers the hold, and comes back.' }));
    for (const n of nems) el.append(nemesisRow(ctx, n));
  }
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
