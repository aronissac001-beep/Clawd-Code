// The People sheet (owner I; EMBERCROWN-WORLD.md 8.1 bar slot 3, 8.5, step W1.3a). One roster: People and Work
// merged (each colonist with the job line, the top skills and the role chips), filtered by All, Soldiers,
// Children, Visitors and Animals. Views (the sheet's tab strip): List, Grid (the work priorities) and Schedule.
// Military is a section: the alert switch is pinned at the top of the List and "Squads" pushes the squad
// screen inside the sheet ("People / Military"); a colonist's ">" pushes the colonist on the Skills tab. Never a
// second sheet (G21). Read-only views of state; every change is a command (C3).
//   openPeople(ctx, { view, filter, military })   open the sheet (view: 'List' | 'Grid' | 'Schedule')
//   workTab(el, ctx, ui), scheduleTab(el, ctx), scheduleEditor(ctx, c), gridView(el, ctx, ui)
//                                                  the Work, Schedule and grid bodies (also the old Colony tabs)
//   SHELL2_ON                                      the new shell is on: flags.js SHELL2 (A; W1.10 flips it) or
//                                                  the debug URL ?shell=2. UI only, never read by the sim.
// Strings: the 'people.*' rows of strings-en.js (G25).
// t-keys: people.filter.* people.none people.none.*
import { h, onTap, icon } from './kit.js';
import { t } from './strings.js';
import * as FLAGS from '../game/core/flags.js';
import { def } from '../game/core/content.js';
import { WORK_IDS, SCHED, SKILL_IDS } from '../game/core/schema.js';
import { workGrid, schedulePreset, scheduleName, SCHEDULES } from '../game/people/roles.js';
import { isChild } from '../game/people/family.js';
import { squadList } from '../game/people/draft.js';
import { visitorsOf } from '../game/colony/visitors.js';
import { peopleList, roleChips, coverageRow, roleName } from './rolesui.js';
import { militaryTab, alertSwitch } from './military.js';
import { colonistTab, colonistHeader, COLONIST_TABS, jobText } from './colonistui.js';

const urlShell = () => { try { return typeof location !== 'undefined' && new URLSearchParams(location.search).get('shell') === '2'; } catch (_) { return false; } };
export const SHELL2_ON = FLAGS.SHELL2 === true || urlShell();


export const PEOPLE_VIEWS = Object.freeze(['List', 'Grid', 'Schedule']);
export const PEOPLE_FILTERS = Object.freeze(['all', 'soldiers', 'children', 'visitors', 'animals']);
/** UI memory (never saved): the last view and filter, so a second visit opens where the first left off. */
const mem = { view: 'List', filter: 'all' };

const alive = (s) => s.col.filter((c) => c && !(c.hp && c.hp.dead));
/** Soldiers: the Soldier role (first or second) or a squad member. */
export function soldiersOf(s) {
  const inSquad = new Set();
  try { for (const q of squadList(s)) for (const id of q.members) inSquad.add(id); } catch (_) { /* no squads record */ }
  return alive(s).filter((c) => inSquad.has(c.id) || (c.role && (c.role[0] === 'soldier' || c.role[1] === 'soldier')));
}
const childrenOf = (s) => alive(s).filter((c) => { try { return isChild(c); } catch (_) { return false; } });
const tameOf = (s) => s.anim.filter((a) => a && a.tame && !(a.hp && a.hp.dead));
/** The count shown on each filter chip. */
export function filterCounts(s) {
  let vis = [];
  try { vis = visitorsOf(s); } catch (_) { vis = []; }
  return { all: alive(s).length, soldiers: soldiersOf(s).length, children: childrenOf(s).length, visitors: vis.length, animals: tameOf(s).length };
}

/** Open the People sheet. military: push the squad screen at once (old "Colony > Military" links). */
export function openPeople(ctx, { view = null, filter = null, military = false } = {}) {
  if (view && PEOPLE_VIEWS.includes(view)) mem.view = view;
  if (filter && PEOPLE_FILTERS.includes(filter)) mem.filter = filter;
  const ui = { page: 0, grid: true, sort: null };
  ctx.openSheet(t('people.title'), (el, v) => {
    mem.view = v;
    if (v === 'Grid') gridView(el, ctx, ui);
    else if (v === 'Schedule') scheduleTab(el, ctx);
    else listView(el, ctx);
  }, { tabs: PEOPLE_VIEWS, tab: mem.view, crumb: () => t('people.title'), intro: { key: 'people', text: t('people.intro') } });
  if (military) openMilitary(ctx);
}
/** The squad screen inside the People sheet ("People / Military"). */
export function openMilitary(ctx) {
  ctx.openSheet(t('people.military'), (el) => militaryTab(el, ctx), { push: true });
}

// ---- List: the pinned Military row, the filters, the roster ----------------------------------------------
function listView(el, ctx) {
  const s = ctx.s;
  // the Military alert, pinned: two taps from the map (People, then Peace | Muster | Shelter)
  const sq = h('button.ec-act', { type: 'button', 'data-act': 'people-squads', 'aria-label': t('people.squads'), style: { flex: '0 0 auto', padding: '0 12px', display: 'flex', alignItems: 'center', gap: '4px' } },
    h('span', { text: t('people.squads') }), h('span', { html: icon('chev'), 'aria-hidden': 'true', style: { display: 'inline-flex', width: '16px' } }));
  onTap(sq, () => openMilitary(ctx));
  const sw = alertSwitch(ctx, () => ctx.refreshSheet());
  sw.style.flex = '1'; sw.style.margin = '0';
  el.append(h('div.ec-people-mil', { role: 'group', 'aria-label': t('people.military.alert') }, sw, sq));
  // the filters
  const n = filterCounts(s);
  const fs = h('div.ec-seg.ec-people-filter', { role: 'radiogroup', 'aria-label': t('people.filter.label') });
  for (const f of PEOPLE_FILTERS) {
    if (f !== 'all' && f !== mem.filter && !n[f]) continue;   // an empty filter hides (All stays)
    const on = mem.filter === f;
    const b = h('button.ec-seg-b' + (on ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-act': 'people-filter-' + f, 'aria-label': `${t('people.filter.' + f)}: ${n[f]}`, text: t('people.filter.' + f) });
    onTap(b, () => { mem.filter = f; ctx.refreshSheet(); });
    fs.append(b);
  }
  if (fs.children.length > 1) el.append(fs);   // a lone "All" says nothing: the row shows once there is a choice
  if (mem.filter === 'visitors') { visitorRows(el, ctx); return; }
  if (mem.filter === 'animals') { animalRows(el, ctx); return; }
  const list = mem.filter === 'soldiers' ? soldiersOf(s) : mem.filter === 'children' ? childrenOf(s) : alive(s);
  if (!list.length) { el.append(h('p.ec-note', { text: t(mem.filter === 'all' ? 'people.none' : 'people.none.' + mem.filter) })); return; }
  for (const c of list) el.append(personRow(ctx, c));
  if (mem.filter === 'all') coverageRow(el, s);
}
/** Top skills of a colonist: "Mining 8, Building 5". */
export function topSkills(c, n = 2) {
  const out = [];
  if (!c.sk) return '';
  const order = c.sk.map((x, i) => [x[0] | 0, x[2] | 0, i]).sort((a, b) => b[0] - a[0] || b[1] - a[1] || a[2] - b[2]);
  for (const [lvl, , i] of order.slice(0, n)) { if (!lvl) break; const d = def('skill', SKILL_IDS[i]); out.push(`${d ? d.name : SKILL_IDS[i]} ${lvl}`); }
  return out.join(', ');
}
function personRow(ctx, c) {
  const first = c.name.split(' ')[0];
  // the name: find them on the map (as the old roster did); ">" opens them in the sheet on Skills
  const who = h('button.ec-person', { type: 'button', 'data-act': 'person', 'data-col': String(c.id), 'aria-label': t('people.find', { name: c.name }) }, ctx.portrait(c, 36), h('span.ec-person-n', { text: first }));
  onTap(who, () => { ctx.closeSheet(); ctx.select({ kind: 'colonist', id: c.id }); ctx.centerOn(c.x, c.y); });
  const open = h('button.ec-ibtn', { type: 'button', 'data-act': 'person-open', 'data-col': String(c.id), 'aria-label': t('people.open', { name: c.name }), html: icon('chev') });
  onTap(open, () => pushColonist(ctx, c, 'Skills'));
  let job = '';
  try { job = jobText(c); } catch (_) { job = ''; }
  // as the peek card says it (peek.js peekJob; not imported: peek.js reaches sheet.js, a cycle at load)
  if (job === 'Idle: no role work' && c.role && c.role[0] && !c.custom && roleName(c.role[0]) !== 'None') job = `Idle: no ${roleName(c.role[0])} work`;
  const sk = topSkills(c);
  return h('div.ec-prow', { 'data-col': String(c.id) }, who, roleChips(ctx, c), open,
    h('p.ec-row-help', { style: { flex: '1 0 100%', margin: '0 0 2px 44px' }, text: [job, sk].filter(Boolean).join(' · ') }));
}
/** The colonist inside the People sheet (pushed, so Back returns to the roster). */
export function pushColonist(ctx, c, tab = 'Skills') {
  ctx.select({ kind: 'colonist', id: c.id }, false, true);
  const nav = (dir) => {
    const list = alive(ctx.s), k = list.indexOf(c), nx = list[(k + dir + list.length) % list.length];
    if (!nx || nx === c) return;
    const tb = ctx.sheetTab();
    ctx.back();
    pushColonist(ctx, nx, tb);
  };
  ctx.openSheet(c.name, (el, tb) => colonistTab(el, ctx, c, tb), { push: true, tabs: COLONIST_TABS, tab, head: () => colonistHeader(ctx, c, nav), subject: { kind: 'colonist', id: c.id } });
}
function visitorRows(el, ctx) {
  const s = ctx.s;
  let vs = [];
  try { vs = visitorsOf(s); } catch (_) { vs = []; }
  if (!vs.length) { el.append(h('p.ec-note', { text: t('people.none.visitors') })); return; }
  for (const v of vs) {
    const hall = (def('room', v.hall) || def('hall', v.hall) || { name: String(v.hall || 'hall') }).name;
    const c = s.col.find((x) => x && x.id === v.id);
    const b = h('button.ec-person', { type: 'button', 'data-act': 'visitor', 'aria-label': v.name, style: { width: '100%' } }, h('span.ec-portrait', { style: { width: '36px', height: '36px' } }, h('span.ec-portrait-i', { text: (v.name || '?').slice(0, 1) })),
      h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: '0' } }, h('span.ec-person-n', { text: v.name }), h('span.ec-row-help', { text: t('people.visitor', { kind: v.kind, hall: String(hall).toLowerCase() }) })));
    onTap(b, () => { if (c) { ctx.closeSheet(); ctx.select({ kind: 'colonist', id: c.id }); ctx.centerOn(c.x, c.y); } else ctx.toast(`${v.name}: ${t('people.visitor', { kind: v.kind, hall: String(hall).toLowerCase() })}.`); });
    el.append(h('div.ec-prow', null, b));
  }
}
function animalRows(el, ctx) {
  const list = tameOf(ctx.s);
  if (!list.length) { el.append(h('p.ec-note', { text: t('people.none.animals') })); return; }
  for (const a of list) {
    const kind = (def('animal', a.kind) || { name: a.kind }).name;
    const b = h('button.ec-person', { type: 'button', 'data-act': 'animal', 'data-anim': String(a.id), 'aria-label': a.name || kind, style: { width: '100%' } }, h('span.ec-portrait', { style: { width: '36px', height: '36px' } }, h('span', { html: icon('heart') })),
      h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: '0' } }, h('span.ec-person-n', { text: a.name || kind }), h('span.ec-row-help', { text: t('people.animal', { kind: String(kind).toLowerCase() }) })));
    onTap(b, () => { ctx.closeSheet(); ctx.select({ kind: 'animal', id: a.id }); ctx.centerOn(a.x, a.y); });
    el.append(h('div.ec-prow', null, b));
  }
}

// ---- Work: roles or the grid (10.4; moved from colonyui.js) ----------------------------------------------
const PAGES = [['Labour', ['haul', 'chop', 'mine', 'build', 'grow']], ['Make', ['cook', 'smith', 'craft', 'tailor', 'art']], ['Care', ['care', 'animals', 'lore']]];
const WORK_ICON = { haul: 'crate', chop: 'axe', mine: 'pick', build: 'hammer', grow: 'farm', cook: 'food', smith: 'sword', craft: 'saw', tailor: 'banner', art: 'relic', care: 'heart', animals: 'pop', lore: 'book' };
/** The old Colony > Work tab: Roles | Grid, then the role list or the grid. */
export function workTab(el, ctx, ui) {
  const adv = ui.grid !== null ? ui.grid : !!(ctx.settings && ctx.settings().advancedGrid);
  const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Work view' });
  for (const [label, v] of [['Roles', false], ['Grid', true]]) {
    const b = h('button.ec-seg-b' + (adv === v ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': adv === v ? 'true' : 'false', 'data-act': 'work-' + (v ? 'grid' : 'roles'), text: label });
    onTap(b, () => { ui.grid = v; ctx.refreshSheet(); });
    seg.append(b);
  }
  el.append(seg);
  if (!adv) { peopleList(el, ctx, { work: true }); return; }
  gridView(el, ctx, ui);
}
/** The work grid: pages of up to 5 work types, a row per colonist; tap cycles 1-4 and off. */
export function gridView(el, ctx, ui) {
  if (ui.page >= PAGES.length) ui.page = 0;
  const pg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Work types' });
  PAGES.forEach(([label], k) => {
    const b = h('button.ec-seg-b' + (ui.page === k ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': ui.page === k ? 'true' : 'false', 'data-act': 'grid-page-' + k, text: label });
    onTap(b, () => { ui.page = k; ctx.refreshSheet(); });
    pg.append(b);
  });
  el.append(pg);
  const works = PAGES[ui.page][1];
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

// ---- Schedule (5.2; moved from colonyui.js) ---------------------------------------------------------------
const SCH = [['Sleep', SCHED.SLEEP, 'sleep'], ['Work', SCHED.WORK, 'work'], ['Joy', SCHED.JOY, 'joy'], ['Any', SCHED.ANY, 'any']];
const SCH_CLASS = ['sleep', 'work', 'joy', 'any'];
function strip(sched) {
  const st = h('span.ec-sched', { role: 'img', 'aria-label': 'Schedule' });
  for (let k = 0; k < 24; k++) st.append(h('i.' + SCH_CLASS[sched[k] | 0]));
  return st;
}
export function scheduleTab(el, ctx) {
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

/** The "+N" chip at the end of the collapsed colonist rail (11 item 27): opens People. */
export function railMore(ctx, n) {
  const b = h('button.ec-rail-btn.ec-rail-more', { type: 'button', 'data-act': 'rail-more', 'aria-label': t('people.more', { n }), text: `+${n}` });
  onTap(b, () => openPeople(ctx));
  return b;
}
