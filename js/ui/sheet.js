// Full sheets (owner I; doc 10.1 "Full sheet", 10.3, 10.5, 10.8; EMBERCROWN-WORLD.md 8.1 G21, 8.4 G22).
// The sheet engine (W1.2, createSheets below): one sheet at a time; a sub-screen pushes inside it with a back
// arrow and a breadcrumb ("Hold / Offices") and never opens a second sheet; two detents in portrait, medium
// (about half the height, the map visible above) and large (full height under the top bar): a tap on the
// grabber (the whole head row) cycles them, a swipe down closes; in landscape the sheet is 48 % of the width
// at full height. A sheet's paragraph (opts.intro) shows on the first visit only, then sits behind "?". The
// shell hands the engine its hooks and moves the camera (hooks.cover) so the selection stays visible.
// Subjects: colonist (colonistui.js), building (bills, billsui.js; info; the room it stands in), zone
// (zonesui.js), animal, item and tile (details, the room). The Colony sheet lives in colonyui.js; the Menu
// and Settings in menu.js and settingsui.js (re-exported here).
import { h, clear, onTap, icon } from './kit.js';
import { t as tx } from './strings.js';   // aliased: openSubjectSheet has a local t (the terrain)
import { def, structDef } from '../game/core/content.js';
import { TER_NAMES, TILE } from '../game/core/grid.js';
import { colonistHeader, colonistTab, COLONIST_TABS } from './colonistui.js';
import { billsTab, benchRecipes } from './billsui.js';
import { zoneSheet } from './zonesui.js';
import { buildingStatus } from './peek.js';
import { openColony as colonySheet, COLONY_TABS as TABS } from './colonyui.js';
import { roomInfo } from '../game/world/rooms.js';
import { FIX } from '../game/core/schema.js';

// ---- the sheet engine ------------------------------------------------------------------------------------
const SEEN_KEY = 'ec2.seen.';
const seenNow = new Set();
/** True when the paragraph `key` was shown before (this device); marks it shown. UI memory, never sim state. */
export function seenBefore(key) {
  if (seenNow.has(key)) return true;
  seenNow.add(key);
  let v = null;
  try { v = localStorage.getItem(SEEN_KEY + key); } catch (_) { v = null; }
  if (v) return true;
  try { localStorage.setItem(SEEN_KEY + key, '1'); } catch (_) { /* private mode: this session remembers */ }
  return false;
}
/** Forget the shown paragraphs (Help > show the notes again; tests). */
export function resetSeen() {
  seenNow.clear();
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(SEEN_KEY)) localStorage.removeItem(k); } } catch (_) { /* nothing stored */ }
}
/** The world point (world units) of a selection, for keeping it in view; null when it has none. */
export function selectionPoint(s, sel) {
  if (!s || !sel) return null;
  const ent = sel.kind === 'colonist' ? s.col.find((c) => c.id === sel.id) : sel.kind === 'animal' ? (s.anim || []).find((a) => a.id === sel.id) : null;
  if (ent) return { x: ent.x, y: ent.y };
  const b = sel.kind === 'building' ? s.bld[sel.id] : null;
  if (b) { const d = structDef(b.def) || {}, sz = d.size || [1, 1]; return { x: (b.x + sz[0] / 2) * TILE, y: (b.y + sz[1] / 2) * TILE }; }
  if (sel.x !== undefined && sel.y !== undefined) return { x: (sel.x + 0.5) * TILE, y: (sel.y + 0.5) * TILE };
  return null;
}

/**
 * The sheet engine on one element (the shell's section.ec-sheet). hooks (all optional):
 *   before()           an open is starting (close the panel, the context menu)
 *   shown(title)       the sheet shows `title` (after open, back, crumb)
 *   hidden(sync)       the sheet closed
 *   help(key)          a "?" button for sheets without an intro paragraph (help.js helpButton), or null
 *   land()             true in landscape (one full-height detent, no grabber)
 *   cover(rect|null)   the sheet's rect after any open, detent change or relayout (null when closed): the shell
 *                      insets the camera and keeps the selection visible
 * open(title, build(el, tab), opts): opts.tabs, opts.tab, opts.head() (a node under the head row),
 *   opts.push (or the older opts.back): a sub-screen of the sheet now open (breadcrumb, back arrow);
 *   opts.crumb: this screen's breadcrumb label (a string, or fn(tab)); default the title;
 *   opts.detent: 'medium' (default) or 'large'; a push keeps the detent unless it names one;
 *   opts.intro: { key, text } or a string: the paragraph shown on the first visit, then behind "?";
 *   opts.help: the help.js key of the "?" toast (sheets without an intro); opts.onClose().
 */
export function createSheets(el, hooks = {}) {
  const stack = [];
  let cur = null, detent = 'medium';
  const land = () => !!(hooks.land && hooks.land());
  const crumbOf = (e) => { const c = e.opts.crumb; return typeof c === 'function' ? c(e.tab) || e.title : c || e.title; };
  const introOf = (e) => { const x = e.opts.intro; if (!x) return null; return typeof x === 'string' ? { key: e.title.toLowerCase().replace(/\s+/g, '-'), text: x } : x; };
  el.setAttribute('role', 'dialog');
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) { e.preventDefault(); if (stack.length) back(); else close(); } });

  function open(title, build, opts = {}) {
    const push = !!(opts.push || opts.back) && !!cur;
    if (hooks.before) hooks.before();
    if (push) { const b = el.querySelector('.ec-sheet-body'); cur.sy = b ? b.scrollTop : 0; stack.push(cur); }
    else {
      const closers = [cur, ...stack].map((x) => x && x.opts.onClose).filter(Boolean);
      stack.length = 0; cur = null;
      for (const f of closers) f();
    }
    if (!push || opts.detent) detent = opts.detent === 'large' ? 'large' : 'medium';
    cur = { title, build, opts, tab: opts.tab || (opts.tabs ? opts.tabs[0] : null), sy: 0, intro: false };
    const ii = introOf(cur);
    if (ii) cur.intro = !seenBefore(ii.key);
    show(false, 0);
  }
  function show(keep, sy) {
    render(keep, sy);
    el.hidden = false;
    applyDetent();
    if (hooks.shown) hooks.shown(cur.title);
    relayout();
  }
  function applyDetent() {
    el.dataset.detent = land() ? 'side' : detent;
    el.classList.toggle('tall', !land() && detent === 'large');
    const g = el.querySelector('.ec-sheet-head > .ec-grab');
    if (g) g.setAttribute('aria-label', detent === 'large' ? tx('sheet.shorter') : tx('sheet.taller'));
  }
  function setDetent(d) { if (!cur || land()) return; detent = d === 'large' ? 'large' : 'medium'; applyDetent(); relayout(); }
  /** The layout rect (offsets: the opening slide's transform is left out), then hooks.cover. */
  function relayout() {
    if (!cur) return;
    applyDetent();
    if (!hooks.cover) return;
    const left = el.offsetLeft, top = el.offsetTop, width = el.offsetWidth, height = el.offsetHeight;
    hooks.cover({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
  }

  function render(keep = true, sy0 = null) {
    if (!cur) return;
    const oldBody = el.querySelector('.ec-sheet-body'), oldStrip = el.querySelector('.ec-strip');
    const sy = sy0 !== null ? sy0 : keep && oldBody ? oldBody.scrollTop : 0, sx = keep && oldStrip ? oldStrip.scrollLeft : 0;
    clear(el);
    el.setAttribute('aria-label', cur.title);
    el.append(headRow());
    if (cur.opts.head) el.append(cur.opts.head());
    const bodyEl = h('div.ec-sheet-body');
    const ii = introOf(cur);
    if (ii && cur.intro) bodyEl.append(h('p.ec-sheet-intro', { role: 'note', 'data-intro': ii.key, text: ii.text }));
    if (cur.opts.tabs) {
      const st = h('div.ec-strip', { role: 'tablist' });
      for (const n of cur.opts.tabs) {
        const b = h('button.ec-strip-tab' + (n === cur.tab ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': n === cur.tab ? 'true' : 'false', 'data-tab': n, 'data-act': 'sheet-tab', text: n });
        onTap(b, () => { cur.tab = n; render(false); });
        st.append(b);
      }
      el.append(st, bodyEl);
      cur.build(bodyEl, cur.tab);
      st.scrollLeft = sx;
      if (!keep) { const on = st.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    } else { el.append(bodyEl); cur.build(bodyEl, null); }
    bodyEl.scrollTop = sy;
    applyDetent();
  }
  /** The head row: the grabber under everything, back, the breadcrumb, "?" and close. */
  function headRow() {
    const row = h('div.ec-panel-head.ec-sheet-head');
    const grab = h('button.ec-grab', { type: 'button', 'data-act': 'sheet-detent', 'aria-label': tx('sheet.taller') }, h('i', { 'aria-hidden': 'true' }));
    grabGestures(grab);
    row.append(grab);
    if (stack.length) {
      const bk = h('button.ec-ibtn.ec-close', { type: 'button', 'data-act': 'sheet-back', 'aria-label': tx('sheet.backTo', { title: crumbOf(stack[stack.length - 1]) }), html: icon('back') });
      onTap(bk, () => back());
      row.append(bk);
    }
    const nav = h('nav.ec-crumbs', { 'aria-label': tx('sheet.crumbs') });
    const from = Math.max(0, stack.length - 2);   // the last two levels: narrow phones keep the title readable
    for (let i = from; i < stack.length; i++) {
      const c = h('button.ec-crumb', { type: 'button', 'data-act': 'sheet-crumb', 'data-depth': String(i), text: crumbOf(stack[i]) });
      onTap(c, () => popTo(i));
      nav.append(c, h('span.ec-crumb-sep', { 'aria-hidden': 'true', text: '/' }));
    }
    nav.append(h('h2', { text: stack.length ? crumbOf(cur) : cur.title }));
    const x = h('button.ec-ibtn.ec-close', { type: 'button', 'data-act': 'close-sheet', 'aria-label': tx('sheet.close'), html: icon('x') });
    onTap(x, () => close());
    const ii = introOf(cur);
    let q = null;
    if (ii) {
      q = h('button.ec-ibtn.ec-help', { type: 'button', 'data-act': 'sheet-intro', 'aria-expanded': cur.intro ? 'true' : 'false', 'aria-label': tx('sheet.about', { title: cur.title }), text: '?' });
      onTap(q, () => { cur.intro = !cur.intro; render(true); });
    } else if (hooks.help) q = hooks.help(cur.opts.help || cur.title);
    row.append(nav, h('span.ec-head-r', null, q, x));
    return row;
  }
  /** Grabber: a tap cycles medium and large; a swipe up makes it large; a swipe down shrinks, then closes. */
  function grabGestures(grab) {
    let y0 = null, id = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; id = e.pointerId; try { grab.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } });
    grab.addEventListener('pointercancel', () => { y0 = null; });
    grab.addEventListener('pointerup', (e) => {
      if (y0 === null || e.pointerId !== id) return;
      const dy = e.clientY - y0; y0 = null;
      if (dy < -30) setDetent('large');
      else if (dy > 30) { if (detent === 'large') setDetent('medium'); else close(); }
      else if (Math.abs(dy) < 12) setDetent(detent === 'large' ? 'medium' : 'large');
    });
    grab.addEventListener('click', (e) => { if (e.detail === 0) setDetent(detent === 'large' ? 'medium' : 'large'); });   // keyboard
  }
  function back() { if (stack.length) popTo(stack.length - 1); else close(); }
  /** Back to the breadcrumb level i (0 = the sheet first opened). */
  function popTo(i) {
    if (!cur || i < 0 || i >= stack.length) return;
    const dropped = [cur, ...stack.slice(i + 1)];
    cur = stack[i]; stack.length = i;
    for (const e of dropped) if (e.opts.onClose) { const f = e.opts.onClose; e.opts.onClose = null; f(); }
    show(false, cur.sy || 0);
  }
  function close(sync = true) {
    if (!cur) return;
    const closers = [cur, ...stack].map((x) => x && x.opts.onClose).filter(Boolean);
    cur = null; stack.length = 0; el.hidden = true;
    for (const f of closers) f();
    if (hooks.cover) hooks.cover(null);
    if (hooks.hidden) hooks.hidden(sync);
  }
  return {
    open, render: (keep = true) => render(keep), back, close, popTo, setDetent, relayout,
    isOpen: () => !!cur, title: () => (cur ? cur.title : null), tab: () => (cur ? cur.tab : null),
    detent: () => (cur ? (land() ? 'side' : detent) : null), depth: () => stack.length,
    crumbs: () => (cur ? [...stack.map(crumbOf), crumbOf(cur)] : []),
  };
}

/** Open the sheet of a selection. tab: the tab to show first (colonists, workbenches). */
export function openSubjectSheet(ctx, sel, tab = null) {
  const s = ctx.s;
  if (!sel) return;
  if (sel.kind === 'colonist') {
    const c = s.col.find((x) => x.id === sel.id);
    if (!c) return;
    const nav = (dir) => {
      const k = s.col.indexOf(c), n = s.col[(k + dir + s.col.length) % s.col.length];
      ctx.select({ kind: 'colonist', id: n.id }, false, true);
      openSubjectSheet(ctx, { kind: 'colonist', id: n.id }, ctx.sheetTab());
    };
    ctx.openSheet(c.name, (el, t) => colonistTab(el, ctx, c, t), { tabs: COLONIST_TABS, tab: tab || 'Needs', head: () => colonistHeader(ctx, c, nav), subject: sel, intro: { key: 'colonist', text: tx('sheet.intro.colonist') } });
    return;
  }
  if (sel.kind === 'building') {
    const b = s.bld[sel.id];
    if (!b) return;
    const d = structDef(b.def) || { name: b.def };
    const ui = { more: new Set() };
    const bench = !!(d.workbench && benchRecipes(b).length);
    const rid = s.rt.room ? s.rt.room[b.y * s.w + b.x] : 0;
    const tabs = [bench ? 'Bills' : null, 'Info', rid ? 'Room' : null].filter(Boolean);
    ctx.openSheet(d.name, (el, t) => (t === 'Bills' ? billsTab(el, ctx, b, ui) : t === 'Room' ? roomTab(el, ctx, rid) : buildingInfo(el, ctx, b, d)), { tabs: tabs.length > 1 ? tabs : null, tab: tab || tabs[0], subject: sel });
    return;
  }
  if (sel.kind === 'zone') {
    const z = s.zones.find((x) => x.id === sel.id);
    if (!z) return;
    const ui = {};
    ctx.openSheet(z.name, (el) => zoneSheet(el, ctx, z, ui), { subject: sel });
    return;
  }
  if (sel.kind === 'animal') {
    const a = s.anim.find((x) => x.id === sel.id);
    if (!a) return;
    const d = def('animal', a.kind) || { name: a.kind };
    ctx.openSheet(a.name || d.name, (el) => animalInfo(el, ctx, a, d), { subject: sel });
    return;
  }
  if (sel.kind === 'item') {
    const it = s.items[sel.id];
    if (!it) return;
    const d = def('item', it.k) || { name: it.k };
    ctx.openSheet(d.name, (el) => { el.append(h('p.ec-note', { text: `${it.n} in this stack${it.m ? ', ' + (def('material', it.m) || { name: it.m }).name : ''}. ${d.text || ''}` })); }, { subject: sel });
    return;
  }
  const t = s.L.terrain[sel.tile];
  const rid = s.rt.room ? s.rt.room[sel.tile] : 0;
  if (rid) { ctx.openSheet(TER_NAMES[t], (el) => { el.append(h('p.ec-note', { text: `Tile ${sel.x}, ${sel.y}.` })); roomTab(el, ctx, rid); }, { subject: sel }); return; }
  ctx.openSheet(TER_NAMES[t], (el) => { el.append(h('p.ec-note', { text: `Tile ${sel.x}, ${sel.y}.` })); }, { subject: sel });
}

/** A room's role, tier and stats (B's roomInfo, 7.11). */
export function roomTab(el, ctx, rid) {
  let inf = null;
  try { inf = roomInfo(ctx.s, rid); } catch (_) { inf = null; }
  if (!inf) { el.append(h('p.ec-note', { text: 'Not a room: it needs walls or rock all round and a door.' })); return; }
  const role = def('room', inf.role) || { name: inf.role.charAt(0).toUpperCase() + inf.role.slice(1), text: '' };
  const tier = def('roomTier', inf.tier) || { name: inf.tier };
  const rec = ctx.s.rt.rooms && ctx.s.rt.rooms[rid];
  el.append(h('h3.ec-sub', { text: `${role.name}, ${tier.name}` }));
  const facts = h('div.ec-facts');
  const row = (k, v) => facts.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: v })));
  row('Impressiveness', String(inf.imp));
  row('Size', `${rec ? rec.n : '?'} tiles (${inf.stats.space} free)`);
  row('Wealth', String(inf.stats.wealth));
  row('Beauty', inf.beautyAvg.toFixed(1));
  row('Clean', inf.stats.clean + '%');
  row('Light', inf.stats.light + '%');
  if (rec) row('Roof', rec.roofed ? 'Roofed' : rec.under ? 'Under the mountain' : 'Partly open');
  el.append(facts, h('p.ec-note', { text: `${role.text ? role.text + ' ' : ''}Wealth, beauty, space and cleanliness raise the tier: Squalid, Plain, Decent, Fine, Grand, Majestic. A finer room lifts the mood of those who use it.` }));
}

/** An animal: kind, tame or wild, its pen, health. */
function animalInfo(el, ctx, a, d) {
  const s = ctx.s;
  const facts = h('div.ec-facts');
  const row = (k, v) => facts.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: v })));
  row('Kind', d.name);
  row('State', a.st && a.st.mode === 'manhunt' ? 'Hunting people' : a.tame ? 'Tame' : 'Wild');
  if (a.tame) { const z = a.pen !== null ? s.zones.find((x) => x.id === a.pen) : null; row('Pen', z ? z.name : 'None: make a pen'); }
  if (a.hp && a.hp.max) row('Health', `${Math.round((a.hp.hp / a.hp.max) * 100)}%`);
  el.append(facts);
  if (d.text) el.append(h('p.ec-note', { text: d.text }));
  el.append(h('p.ec-note', { text: a.tame ? 'Handlers milk, shear and feed tame animals; an overfull pen is culled.' : 'Orders > Tame (a farm kind, a pen with room) or Orders > Hunt.' }));
}

function buildingInfo(el, ctx, b, d) {
  const rows = [['Status', buildingStatus(ctx.s, b)]];
  if (b.mat) rows.push(['Material', (def('material', b.mat) || { name: b.mat }).name]);
  if (d.size) rows.push(['Size', `${d.size[0]} x ${d.size[1]}`]);
  if (b.hp !== undefined && d.hp) rows.push(['Condition', `${Math.round((b.hp / d.hp) * 100)}%`]);
  const dl = h('div.ec-facts');
  for (const [k, v] of rows) dl.append(h('div.ec-fact', null, h('span', { text: k }), h('b', { text: v })));
  el.append(dl);
  if (d.text) el.append(h('p.ec-note', { text: d.text }));
}

export const COLONY_TABS = TABS;
/** The Colony sheet (10.3; colonyui.js). */
export function openColony(ctx, tab = 'People') { colonySheet(ctx, tab); }

// The Menu and Settings (W1.4, EMBERCROWN-WORLD.md 8.7) live in menu.js and settingsui.js.
export { openMenu } from './menu.js';
export { openSettings, settingsList } from './settingsui.js';

