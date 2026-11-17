// In-game layout shell (owner I; doc 10.1-10.7). Stage 0: the chrome at the 10.1 sizes around a live
// world canvas: top bar (Menu, clock, threat chip, stock chip), colonist rail, alert stack, map
// button, bottom bar (speed button + Build, Orders, Zones, Colony), the tool bar, the peek card and
// the full sheet, the loupe, toasts and the paused frame. Landscape: one top row with the rail
// inline, a vertical rail on the right, cards as a 320 pt overlay panel.
// The UI never mutates sim state: every change is a command (C3) sent through api.send.
//
// mountShell(root, api) -> shell
//   api.state                the colony (read-only here)
//   api.send(cmd)            -> { ok, reason?, stub? }  (applyCommand with the determinism log)
//   api.saveNow()            -> Promise
//   api.quit()               back to the title (after a save)
//   api.demo                 optional demo data (?debug=1&demo=1): { alerts, threat, stock }
import { h, clear, onTap, icon, Toaster } from './kit.js';
import { SIZES, isLandscape, measureWorld, plannedWorld, safeInsets } from './layout.js';
import { SpeedButton } from './speed.js';
import { Loupe } from './loupe.js';
import { TILE, W, H, TER_NAMES, TER_MINEABLE } from '../game/core/grid.js';
import { dayOf, seasonOf, clockText, SEASONS, SEASON_NAMES, TPS } from '../game/core/time.js';
import { step } from '../game/core/sim.js';
import { dispatch } from '../game/core/events.js';
import { FIX } from '../game/core/schema.js';
import { pickAt } from '../game/tools/pick.js';
import { RECT_TOOLS, tileAt, rectOf, rectLabel, strokeCommand, undoCommand } from '../game/tools/rect.js';
import { SAVE } from '../data/balance.js';
import { Renderer } from '../engine/render/index.js';
import { Camera } from '../engine/camera.js';
import { Loop, fpsTarget } from '../engine/loop.js';
import { GestureInput } from '../engine/input.js';

const TABS = [
  { id: 'build', label: 'Build', icon: 'build' },
  { id: 'orders', label: 'Orders', icon: 'orders' },
  { id: 'zones', label: 'Zones', icon: 'zones' },
  { id: 'colony', label: 'Colony', icon: 'colony' },
];
const LATER = 'Arrives in Stage 1a';
const ORDERS = [
  ['mine', 'Mine', 'pick'], ['chop', 'Chop', 'axe'], ['harvest', 'Harvest', 'farm'], ['cancel', 'Cancel', 'x'],
  ['carve', 'Carve hall', 'pick'], ['haul', 'Haul', 'wood'], ['hunt', 'Hunt', 'sword'], ['tame', 'Tame', 'heart'],
  ['smooth', 'Smooth', 'stone'], ['engrave', 'Engrave', 'hammer'], ['prospect', 'Prospect', 'eye'], ['deconstruct', 'Deconstruct', 'trash'], ['forbid', 'Forbid', 'lock'],
];
const BUILD_TABS = ['Rooms', 'Structure', 'Housing', 'Storage', 'Farm', 'Workshops', 'Furniture', 'Defence', 'Light', 'Utility', 'Civic', 'Monuments'];
const ZONES = [['Stockpile', 'house'], ['Grow', 'farm'], ['Pen', 'gate'], ['Burial', 'skull'], ['Dump', 'trash'], ['Shelter', 'shield'], ['Roof', 'castle'], ['Home area', 'flame'], ['Allowed area', 'map']];
const COLONY_TABS = ['People', 'Work', 'Schedule', 'Research', 'Stock', 'Chronicle', 'Hold'];
const CLOTH = ['#8a4a3a', '#3f5f8a', '#5f7a3a', '#7a5a2a', '#6a3f7a', '#2f6f6a', '#8a6f3a', '#5a5a66'];

export function mountShell(root, api) {
  const s = api.state;
  const doc = document, body = doc.body;
  body.classList.add('ec-game');
  clear(root);
  root.classList.remove('hidden');
  const canvas = doc.getElementById('view');
  canvas.classList.add('ec-world');

  // ---- view state (UI only; never saved) ----------------------------------------------------------
  const ui = {
    speed: 1, sel: null, peek: null, sheet: null, panel: null, tool: null, toolMode: 'add',
    stroke: null, undo: null, stockOpen: false, map: false, landscape: false, narrow: false,
  };

  // ---- DOM -----------------------------------------------------------------------------------------
  const menuBtn = h('button.ec-ibtn.ec-menu', { type: 'button', 'data-act': 'menu', 'aria-label': 'Menu', html: icon('menu') });
  const clock = h('div.ec-clock', { role: 'timer', 'aria-label': 'Date and time' });
  const threat = h('button.ec-chip.ec-threat', { type: 'button', 'data-act': 'threat', hidden: true });
  const stock = h('button.ec-chip.ec-stock', { type: 'button', 'data-act': 'stock', 'aria-label': 'Stock' });
  const rail = h('div.ec-rail', { role: 'list', 'aria-label': 'Colonists' });
  const top = h('header.ec-top', null, menuBtn, clock, h('div.ec-top-flex', null, threat), stock);
  const strip = h('div.ec-stockstrip', { hidden: true, role: 'status' });
  const alerts = h('div.ec-alerts', { 'aria-label': 'Alerts' });
  const mapBtn = h('button.ec-ibtn.ec-mapbtn', { type: 'button', 'data-act': 'map', 'aria-label': 'Map', html: icon('map') });
  const mini = h('div.ec-minimap', { hidden: true }, h('canvas.ec-minimap-cv'));
  const hint = h('div.ec-hint', { hidden: true, role: 'status' });
  const pausedTag = h('div.ec-paused-tag', { text: 'Paused', 'aria-hidden': 'true' });
  const frame = h('div.ec-paused-frame', { 'aria-hidden': 'true' }, pausedTag);
  const speedHost = h('div.ec-speed-host');
  const tabs = h('nav.ec-tabs', { 'aria-label': 'Menus' });
  const toolbar = h('div.ec-toolbar', { hidden: true, role: 'toolbar', 'aria-label': 'Tool' });
  const bottom = h('footer.ec-bottom', null, speedHost, tabs, toolbar);
  const peek = h('section.ec-peek', { hidden: true, 'aria-label': 'Selection' });
  const panel = h('section.ec-panel', { hidden: true });
  const sheet = h('section.ec-sheet', { hidden: true, role: 'dialog', 'aria-modal': 'false' });
  const toasts = h('div.ec-toasts', { 'aria-live': 'polite' });
  root.append(frame, top, rail, strip, alerts, mapBtn, mini, hint, peek, panel, sheet, bottom, toasts);
  const loupe = new Loupe(root);
  const toast = new Toaster(toasts);

  // ---- renderer, camera, loop -------------------------------------------------------------------
  const r = new Renderer(canvas);
  r.setState(s);
  const cam = new Camera();
  cam.zoom = 1;
  const flags = { covered: false, saver: false, paused: false, combat: false, moving: true, fast: false };
  let lastMinute = -1, dirtyChrome = true;
  const loop = new Loop({
    step: 1 / TPS,
    maxTicksPerFrame: 10,
    update: () => { step(s, 1); },
    render: (alpha, dt) => {
      dispatch(s);
      cam.update(dt);
      edgeScroll(dt);
      r.draw(s, cam, alpha, dt, {});
      if (ui.stroke && loupe.visible) drawLoupe();
      const m = Math.floor(s.tick / 10);
      if (m !== lastMinute || dirtyChrome) { lastMinute = m; renderClock(); }
      if (dirtyChrome) { dirtyChrome = false; renderRail(); renderStock(); renderThreat(); renderAlerts(); }
      if (ui.map) drawMini();
    },
    fpsFor: () => { flags.moving = cam.takeMoving() || !!ui.stroke; flags.combat = r.wantsFast(s); flags.paused = ui.speed === 0; flags.fast = ui.speed >= 5; return fpsTarget(flags, r.cfg.fps); },
  });
  const setSpeed = (v) => { ui.speed = v; loop.timeScale = v; body.classList.toggle('paused', v === 0); loop.poke(); };
  const speed = new SpeedButton(speedHost, {
    get: () => ui.speed, set: setSpeed, toast: (t) => toast.show(t),
    blocked: (v) => (v === 5 ? blocked5x() : null),
    mirrored: () => ui.landscape,
  });
  setSpeed(1);

  /** D3: 5x is hidden while an active raid member or aggroed creature is on the map, or anyone is drafted. */
  function blocked5x() {
    if (s.col.some((c) => c.drafted)) return 'a colonist is drafted';
    if (s.raids.length && s.foes.length) return 'raiders are on the map';
    return null;
  }

  // ---- layout ---------------------------------------------------------------------------------------
  function layout() {
    const w = innerWidth, hh = innerHeight;
    ui.landscape = isLandscape(w, hh);
    ui.narrow = w < SIZES.narrowClock;
    body.classList.toggle('land', ui.landscape);
    body.classList.toggle('narrow', ui.narrow);
    if (ui.landscape) top.insertBefore(rail, stock.nextSibling); else root.insertBefore(rail, strip);
    const rc = canvas.getBoundingClientRect();
    const dpr = Math.min(r.cfg.dprCap || 2, devicePixelRatio || 1);
    r.resize(rc.width, rc.height, dpr); cam.resize(rc.width, rc.height, dpr);
    if (speed.isOpen) speed.layoutFan();
    dirtyChrome = true; loop.poke();
  }
  window.addEventListener('resize', layout);
  if (window.visualViewport) visualViewport.addEventListener('resize', layout);

  // ---- top bar ----------------------------------------------------------------------------------------
  function renderClock() {
    const d = dayOf(s.tick) + 1, se = seasonOf(s.tick);
    const season = ui.narrow ? `<span class="ec-season" aria-label="${SEASON_NAMES[se]}">${icon(SEASONS[se])}</span>` : `<span class="ec-season-name">${SEASON_NAMES[se]}</span>`;
    clock.innerHTML = `<span>D${d}</span>${season}<span>${clockText(s.tick)}</span>`;
  }
  function renderThreat() {
    const q = s.st.queue && s.st.queue[0];
    const demo = api.demo && api.demo.threat;
    if (!q && !demo) { threat.hidden = true; return; }
    const hours = q ? Math.max(0, Math.ceil((q.arriveTick - s.tick) / 600)) : demo.hours;
    const name = q ? 'Threat' : demo.name;
    threat.hidden = false;
    threat.innerHTML = `${icon('horde')}<span class="ec-chip-t">${hours}h</span>`;
    threat.setAttribute('aria-label', `${name} in ${hours} hours`);
  }
  function stockRows() {
    if (api.demo && api.demo.stock) return api.demo.stock;
    const tot = (k) => { const st = s.rt.stock; if (!st) return 0; if (st instanceof Map) return st.get(k) || 0; return st[k] || 0; };
    return [['food', 'Food', s.col.length ? `${Math.floor(tot('meal') / Math.max(1, s.col.length))}d` : '0d'], ['wood', 'Wood', String(tot('wood'))], ['stone', 'Stone', String(tot('stone'))], ['sword', 'Steel', String(tot('steel'))], ['food', 'Meals', String(tot('meal'))]];
  }
  function renderStock() {
    const rows = stockRows();
    stock.innerHTML = `<span class="ec-chip-t">food ${rows[0][2]}</span>${icon('chevDown', 'chevd')}`;
    if (ui.stockOpen) strip.innerHTML = rows.map(([ic, n, v]) => `<div class="ec-stock-cell">${icon(ic)}<span>${n}</span><b>${v}</b></div>`).join('');
  }
  let stockT = 0;
  onTap(stock, () => {
    ui.stockOpen = !ui.stockOpen; strip.hidden = !ui.stockOpen; renderStock();
    clearTimeout(stockT); if (ui.stockOpen) stockT = setTimeout(() => { ui.stockOpen = false; strip.hidden = true; }, 4000);
  }, { longpress: () => openColony('Stock') });
  onTap(strip, () => { ui.stockOpen = false; strip.hidden = true; });
  onTap(threat, () => toast.show(threat.getAttribute('aria-label') + '. Route preview arrives with the storyteller.'));
  onTap(menuBtn, () => openMenu());

  // ---- colonist rail ----------------------------------------------------------------------------------
  function portrait(c, size = 44) {
    const mood = Math.max(0, Math.min(100, (c.mood || 0) / FIX));
    const ring = mood < 25 ? '#e0644e' : mood < 45 ? '#e8b04a' : '#8fd16a';
    const p = h('span.ec-portrait', { style: { width: size + 'px', height: size + 'px', '--ring': ring, '--cloth': CLOTH[(c.look && c.look.cloth) % CLOTH.length || 0] } },
      h('span.ec-portrait-i', { text: (c.name || '?').slice(0, 1) }));
    if (c.drafted) p.classList.add('drafted');
    return p;
  }
  let railKey = null;
  function renderRail() {
    const key = s.col.map((c) => `${c.id}:${c.name}:${c.drafted ? 1 : 0}:${Math.round(c.mood / FIX / 10)}`).join('|') + (ui.sel && ui.sel.kind === 'colonist' ? ui.sel.id : '');
    if (key === railKey) return;
    railKey = key;
    clear(rail);
    if (!s.col.length) { rail.append(h('p.ec-rail-empty', { text: 'No colonists yet. The founding band arrives with Stage 1a.' })); return; }
    for (const c of s.col) {
      const b = h('button.ec-rail-btn', { type: 'button', role: 'listitem', 'data-act': 'colonist', 'data-col': String(c.id), 'aria-label': c.name }, portrait(c));
      if (ui.sel && ui.sel.kind === 'colonist' && ui.sel.id === c.id) b.classList.add('sel');
      onTap(b, () => {
        const again = ui.sel && ui.sel.kind === 'colonist' && ui.sel.id === c.id;
        select({ kind: 'colonist', id: c.id }, again);
        cam.centerOn(c.x, c.y);
      });
      rail.append(b);
    }
  }

  // ---- alerts -----------------------------------------------------------------------------------------
  function renderAlerts() {
    clear(alerts);
    const list = (api.demo && api.demo.alerts) || [];
    const vis = list.slice(0, SIZES.alertsVisible);
    for (const a of vis) {
      const b = h('button.ec-ibtn.ec-alert' + (a.tone ? '.' + a.tone : ''), { type: 'button', 'data-act': 'alert', 'aria-label': a.text, html: icon(a.icon) });
      onTap(b, () => toast.show(a.text), { longpress: () => toast.show(`${a.text}. ${a.why || ''}`.trim()) });
      alerts.append(b);
    }
    if (list.length > vis.length) {
      const more = h('button.ec-ibtn.ec-alert-more', { type: 'button', 'data-act': 'alerts', 'aria-label': `${list.length - vis.length} more alerts`, text: `+${list.length - vis.length}` });
      onTap(more, () => toast.show(list.slice(vis.length).map((a) => a.text).join('. ')));
      alerts.append(more);
    }
  }

  // ---- bottom bar -------------------------------------------------------------------------------------
  for (const t of TABS) {
    const b = h('button.ec-tab', { type: 'button', 'data-act': 'tab', 'data-tab': t.id, 'aria-label': t.label }, h('span', { html: icon(t.icon) }), h('span.ec-tab-l', { text: t.label }));
    onTap(b, () => (t.id === 'colony' ? openColony('People') : togglePanel(t.id)));
    tabs.append(b);
  }
  const chipAdd = h('button.ec-tchip', { type: 'button', 'data-act': 'mode-add', text: 'Add' });
  const chipRem = h('button.ec-tchip', { type: 'button', 'data-act': 'mode-remove', text: 'Remove' });
  const undoBtn = h('button.ec-ibtn.ec-undo', { type: 'button', 'data-act': 'undo', 'aria-label': 'Undo', html: icon('undo'), disabled: true });
  const doneBtn = h('button.ec-tdone', { type: 'button', 'data-act': 'done', text: 'Done' });
  toolbar.append(chipAdd, chipRem, undoBtn, doneBtn);
  onTap(chipAdd, () => setToolMode('add'));
  onTap(chipRem, () => setToolMode('remove'));
  onTap(undoBtn, () => doUndo());
  onTap(doneBtn, () => endTool());

  // ---- panels (Build, Orders, Zones), sheets (Colony, Menu, subject) ----------------------------------
  function card(label, ic, { locked = null, act, onPick } = {}) {
    const b = h('button.ec-card' + (locked ? '.locked' : ''), { type: 'button', 'data-act': act || 'card', 'aria-disabled': locked ? 'true' : null },
      h('span.ec-card-ic', { html: icon(ic) }), h('span.ec-card-n', { text: label }), locked ? h('span.ec-card-why', { text: locked }) : null);
    onTap(b, () => (locked ? toast.show(`${label}: ${locked}`) : onPick && onPick()));
    if (locked) b.addEventListener('click', (e) => { if (e.detail === 0) toast.show(`${label}: ${locked}`); });
    return b;
  }
  function panelHead(title) {
    const x = h('button.ec-ibtn.ec-close', { type: 'button', 'data-act': 'close', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => closePanel());
    return h('div.ec-panel-head', null, h('h2', { text: title }), x);
  }
  function togglePanel(id) {
    if (ui.panel === id) { closePanel(); return; }
    closePeek(); closeSheet();
    ui.panel = id;
    clear(panel);
    panel.dataset.panel = id;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === id);
    if (id === 'orders') {
      panel.append(panelHead('Orders'));
      const grid = h('div.ec-grid');
      for (const [tid, label, ic] of ORDERS) grid.append(card(label, ic, { act: 'order-' + tid, locked: RECT_TOOLS[tid] ? null : LATER, onPick: () => startTool(tid) }));
      panel.append(grid);
    } else if (id === 'build') {
      panel.append(panelHead('Build'));
      const st = h('div.ec-strip', { role: 'tablist' });
      BUILD_TABS.forEach((n, k) => { const b = h('button.ec-strip-tab' + (k === 0 ? '.on' : ''), { type: 'button', role: 'tab', text: n }); onTap(b, () => { for (const x of st.children) x.classList.toggle('on', x === b); }); st.append(b); });
      const grid = h('div.ec-grid');
      for (const [n, ic] of [['Bedroom', 'house'], ['Dorm', 'house'], ['Workshop', 'hammer'], ['Dining hall', 'food'], ['Store', 'wood'], ['Infirmary', 'heart']]) grid.append(card(n, ic, { locked: LATER }));
      panel.append(st, grid);
    } else if (id === 'zones') {
      panel.append(panelHead('Zones'));
      const grid = h('div.ec-grid');
      for (const [n, ic] of ZONES) grid.append(card(n, ic, { locked: LATER }));
      panel.append(grid);
    }
    panel.hidden = false;
    syncChrome();
  }
  function closePanel() { ui.panel = null; panel.hidden = true; for (const b of tabs.children) b.classList.remove('on'); syncChrome(); }

  function openSheet(title, build, { tabs: tabNames = null, tab = null } = {}) {
    closePanel(); closePeek(false);
    clear(sheet);
    const grab = h('div.ec-grab', { 'aria-hidden': 'true' }, h('i'));
    const x = h('button.ec-ibtn.ec-close', { type: 'button', 'data-act': 'close-sheet', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => closeSheet());
    sheet.append(grab, h('div.ec-panel-head', null, h('h2', { text: title }), x));
    const bodyEl = h('div.ec-sheet-body');
    if (tabNames) {
      const st = h('div.ec-strip', { role: 'tablist' });
      const show = (n) => { for (const b of st.children) b.classList.toggle('on', b.dataset.tab === n); clear(bodyEl); build(bodyEl, n); };
      for (const n of tabNames) { const b = h('button.ec-strip-tab', { type: 'button', role: 'tab', 'data-tab': n, text: n }); onTap(b, () => show(n)); st.append(b); }
      sheet.append(st, bodyEl);
      show(tab || tabNames[0]);
    } else { sheet.append(bodyEl); build(bodyEl); }
    sheet.classList.remove('tall');
    sheet.hidden = false;
    ui.sheet = title;
    dragToResize(grab, sheet);
    syncChrome();
  }
  function closeSheet() { if (!ui.sheet) return; ui.sheet = null; sheet.hidden = true; syncChrome(); }
  /** Drag the grab bar: up to 92%, down to close (10.1). */
  function dragToResize(grab, el) {
    let y0 = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; try { grab.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } });
    grab.addEventListener('pointerup', (e) => {
      if (y0 === null) return; const dy = e.clientY - y0; y0 = null;
      if (dy < -30) el.classList.add('tall');
      else if (dy > 30) { if (el.classList.contains('tall')) el.classList.remove('tall'); else closeSheet(); }
    });
  }

  function openColony(tab) {
    openSheet('Colony', (el, n) => {
      if (n === 'People') {
        if (!s.col.length) { el.append(h('p.ec-note', { text: 'No colonists yet.' })); return; }
        for (const c of s.col) {
          const row = h('button.ec-row', { type: 'button', 'data-act': 'person' }, portrait(c, 36), h('span.ec-row-n', { text: c.name }), h('span.ec-row-s', { text: roleName(c) }));
          onTap(row, () => { closeSheet(); select({ kind: 'colonist', id: c.id }); cam.centerOn(c.x, c.y); });
          el.append(row);
        }
      } else el.append(h('p.ec-note', { text: `${n}: ${LATER}.` }));
    }, { tabs: COLONY_TABS, tab });
  }
  function openMenu() {
    openSheet('Menu', (el) => {
      const item = (label, fn, locked) => { const b = h('button.ec-row' + (locked ? '.locked' : ''), { type: 'button', 'data-act': 'menu-' + label.toLowerCase().replace(/\s+/g, '-'), 'aria-disabled': locked ? 'true' : null }, h('span.ec-row-n', { text: label }), locked ? h('span.ec-row-s', { text: locked }) : null); onTap(b, () => (locked ? toast.show(`${label}: ${locked}`) : fn())); return b; };
      el.append(
        item('Save now', async () => { try { await api.saveNow(); toast.show('Saved.'); } catch (e) { toast.show('Save failed: ' + e.message, 'bad'); } }),
        item('Back up', null, LATER), item('Colonies', null, LATER), item('Settings', null, LATER), item('Help', null, LATER),
        item('Quit to title', () => { shell.destroy(); api.quit(); }),
      );
    });
  }

  // ---- selection: peek card and full sheet -------------------------------------------------------------
  const roleName = (c) => { const r0 = (c.role && c.role[0]) || 'generalist'; return r0.charAt(0).toUpperCase() + r0.slice(1); };
  const colOf = (id) => s.col.find((c) => c.id === id) || null;
  function select(sel, again = false) {
    if (!sel) { closePeek(); return; }
    if (again && ui.peek && !ui.sheet) { openSubjectSheet(sel); return; }
    ui.sel = sel;
    closePanel(); closeSheet();
    renderPeek();
    if (sel.kind !== 'colonist' && sel.x !== undefined) r.setOverlay('preview', { rect: { x0: sel.x, y0: sel.y, x1: sel.x, y1: sel.y }, ok: true });
    else r.setOverlay('preview', null);
    dirtyChrome = true; loop.poke();
  }
  function peekActions(list) {
    const row = h('div.ec-peek-acts');
    for (const [label, fn, act] of list) { const b = h('button.ec-act', { type: 'button', 'data-act': act || 'peek-act', text: label }); onTap(b, fn); row.append(b); }
    return row;
  }
  function renderPeek() {
    const sel = ui.sel;
    clear(peek);
    peek.dataset.kind = sel.kind;
    const grab = h('div.ec-grab', { 'aria-hidden': 'true' }, h('i'));
    let head, acts;
    if (sel.kind === 'colonist') {
      const c = colOf(sel.id);
      if (!c) { closePeek(); return; }
      const mood = Math.round(c.mood / FIX);
      head = h('div.ec-peek-head', null, portrait(c),
        h('div.ec-peek-txt', null,
          h('div.ec-peek-name', null, h('b', { text: c.name }), h('span.ec-rolechip', { text: roleName(c) })),
          h('div.ec-peek-sub', { text: c.drafted ? 'Drafted' : c.job ? `Working: ${c.job.type}` : 'Idle' }),
          h('div.ec-moodbar', { role: 'meter', 'aria-label': 'Mood', 'aria-valuenow': String(mood), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: { width: mood + '%' } }))));
      acts = peekActions([
        [c.drafted ? 'Undraft' : 'Draft', () => send({ t: 'draft', colIds: [c.id], on: !c.drafted }), 'draft'],
        ['Role', () => toast.show(`Role picker: ${LATER}`), 'role'],
        ['Prioritise', () => toast.show('Long-press a target to prioritise it (Stage 1a).'), 'prioritise'],
      ]);
    } else {
      const i = sel.tile, t = s.L.terrain[i];
      const what = sel.kind === 'tile' ? TER_NAMES[t] : sel.kind === 'item' ? `Item ${sel.id}` : sel.kind === 'building' ? `Building ${sel.id}` : `Zone ${sel.id}`;
      head = h('div.ec-peek-head', null, h('span.ec-peek-ic', { html: icon(TER_MINEABLE[t] ? 'stone' : sel.kind === 'tile' ? 'region' : 'info') }),
        h('div.ec-peek-txt', null, h('div.ec-peek-name', null, h('b', { text: what })), h('div.ec-peek-sub', { text: `Tile ${sel.x}, ${sel.y}${(s.L.desig[i] & 1) ? ' · marked for mining' : ''}` })));
      const mineable = TER_MINEABLE[t] === 1;
      acts = peekActions([
        ['Mine', () => (mineable ? send({ t: 'designate', kind: 'mine', rect: { x0: sel.x, y0: sel.y, x1: sel.x, y1: sel.y }, add: true }, 'Marked for mining.') : toast.show('Only rock can be mined.')), 'mine'],
        ['Zone', () => toast.show(`Zones: ${LATER}`), 'zone'],
        ['Close', () => closePeek(), 'close-peek'],
      ]);
    }
    peek.append(grab, head, acts);
    peek.hidden = false;
    ui.peek = sel.kind;
    let y0 = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
    grab.addEventListener('pointerup', (e) => { if (y0 !== null && e.clientY - y0 < -30) openSubjectSheet(ui.sel); else if (y0 !== null && e.clientY - y0 > 30) closePeek(); y0 = null; });
    syncChrome();
  }
  function openSubjectSheet(sel) {
    if (!sel) return;
    const c = sel.kind === 'colonist' ? colOf(sel.id) : null;
    const title = c ? c.name : sel.kind === 'tile' ? TER_NAMES[s.L.terrain[sel.tile]] : `${sel.kind} ${sel.id}`;
    const tabNames = c ? ['Needs', 'Skills', 'Health', 'Gear', 'Social', 'Log', 'Bio'] : null;
    openSheet(title, (el, n) => el.append(h('p.ec-note', { text: `${n || 'Details'}: ${LATER}.` })), { tabs: tabNames });
  }
  function closePeek(sync = true) {
    if (!ui.peek && !ui.sel) return;
    ui.peek = null; ui.sel = null; peek.hidden = true;
    r.setOverlay('preview', null);
    dirtyChrome = true;
    if (sync) syncChrome();
  }
  /** The rail hides under any card, panel or sheet (portrait); the world height follows. */
  function syncChrome() {
    const covered = !!(ui.peek || ui.panel || ui.sheet);
    body.classList.toggle('rail-hidden', covered);
    body.classList.toggle('has-peek', !!ui.peek);
    body.classList.toggle('has-panel', !!ui.panel);
    body.classList.toggle('has-sheet', !!ui.sheet);
    if (covered) { ui.stockOpen = false; strip.hidden = true; }
    loop.poke();
  }

  function send(cmd, okText = null) {
    const res = api.send(cmd);
    ui.lastCmd = cmd; ui.lastRes = res;
    if (!res || !res.ok) toast.show((res && res.reason) || 'Not possible.', 'bad');
    else if (okText) toast.show(okText + (res.stub ? ' (Stage 0: no worker acts on it yet)' : ''));
    dirtyChrome = true; loop.poke();
    if (ui.sel) renderPeek();
    return res;
  }

  // ---- tools (rectangle designations, 10.2) ----------------------------------------------------------
  function startTool(id) {
    closePanel(); closePeek();
    ui.tool = id; ui.toolMode = 'add';
    body.classList.add('tooling');
    tabs.hidden = true; toolbar.hidden = false;
    hint.hidden = false;
    hint.textContent = `${RECT_TOOLS[id].name}: drag over the map`;
    setToolMode('add');
    syncChrome();
  }
  function setToolMode(m) { ui.toolMode = m; chipAdd.classList.toggle('on', m === 'add'); chipRem.classList.toggle('on', m === 'remove'); }
  function endTool() {
    ui.tool = null; ui.stroke = null; loupe.hide();
    body.classList.remove('tooling');
    tabs.hidden = false; toolbar.hidden = true; hint.hidden = true;
    r.setOverlay('preview', null);
    ui.undo = null; undoBtn.disabled = true;
    loop.poke();
  }
  function applyStroke(rect, erase) {
    const cmd = strokeCommand(ui.tool, rect, erase ? 'remove' : ui.toolMode);
    const res = send(cmd);
    if (res && res.ok) {
      const inv = undoCommand(cmd);
      ui.undo = inv ? { cmd: inv, until: performance.now() + 5000 } : null;
      undoBtn.disabled = !ui.undo;
      if (ui.undo) setTimeout(() => { if (ui.undo && performance.now() >= ui.undo.until) { ui.undo = null; undoBtn.disabled = true; } }, 5100);
      hint.textContent = `${RECT_TOOLS[ui.tool].name}: ${rectLabel(rect)}${res.stub ? ' (no worker yet)' : ''}`;
    }
  }
  function doUndo() { if (ui.undo && performance.now() < ui.undo.until) send(ui.undo.cmd, 'Undone.'); ui.undo = null; undoBtn.disabled = true; }
  const worldAt = (p) => cam.screenToWorld(p.x, p.y);
  function strokeTo(p) {
    const st = ui.stroke;
    const wpt = worldAt(p);
    st.b = tileAt(wpt.x, wpt.y); st.p = p;
    st.rect = rectOf(st.a, st.b);
    r.setOverlay('preview', { rect: st.rect, ok: !st.erase });
    loupe.show();
    loop.poke();
  }
  function drawLoupe() {
    const st = ui.stroke, rc = canvas.getBoundingClientRect();
    const wr = measureWorld(doc) || { x: rc.left, y: rc.top, width: rc.width, height: rc.height };
    loupe.update(canvas, rc, rc.left + st.p.x, rc.top + st.p.y, (st.erase || ui.toolMode === 'remove' ? 'Remove: ' : '') + rectLabel(st.rect), wr);
  }
  function edgeScroll(dt) {
    const st = ui.stroke;
    if (!st || !st.p) return;
    const rc = canvas.getBoundingClientRect(), wr = measureWorld(doc);
    if (!wr) return;
    const x = rc.left + st.p.x, y = rc.top + st.p.y, e = 40, v = 600 * dt;
    let dx = 0, dy = 0;
    if (x < wr.x + e) dx = v; else if (x > wr.x + wr.width - e) dx = -v;
    if (y < wr.y + e) dy = v; else if (y > wr.y + wr.height - e) dy = -v;
    if (dx || dy) { cam.panBy(dx, dy); strokeTo(st.p); }
  }

  // ---- world gestures ------------------------------------------------------------------------------
  let pressAt = null, held = false;
  const input = new GestureInput(canvas, {
    press: (p) => { pressAt = p; held = false; },
    longpress: () => { held = true; if (!ui.tool) toast.show('Context menus arrive with Stage 1a.'); },
    tap: (p) => {
      if (speed.isOpen) { speed.close(); return; }
      const wpt = worldAt(p);
      if (ui.tool) { const t = tileAt(wpt.x, wpt.y); applyStroke(rectOf(t, t), false); return; }
      if (ui.panel) { closePanel(); return; }
      const prev = ui.sel;
      const sel = pickAt(s, wpt.x, wpt.y, cam.zoom, prev);
      if (!sel) { closePeek(); return; }
      const again = sel.kind === 'colonist' ? sel.again : false;
      select(sel, again);
    },
    dragstart: (p) => {
      if (ui.tool) { const w0 = worldAt(pressAt || p); const a = tileAt(w0.x, w0.y); ui.stroke = { a, b: a, rect: rectOf(a, a), p, erase: held }; strokeTo(p); }
    },
    dragmove: (p, dx, dy) => { if (ui.stroke) strokeTo(p); else { cam.panBy(dx, dy); loop.poke(); } },
    dragend: (p, cancelled, vx, vy) => {
      if (ui.stroke) {
        const st = ui.stroke; ui.stroke = null; loupe.hide();
        r.setOverlay('preview', null);
        if (!cancelled) applyStroke(st.rect, st.erase);
        return;
      }
      if (!cancelled) { cam.vx = -(vx || 0) / cam.zoom; cam.vy = -(vy || 0) / cam.zoom; }
    },
    pinch: (f, cx, cy, dcx, dcy) => { if (ui.stroke) { ui.stroke = null; loupe.hide(); r.setOverlay('preview', null); } cam.zoomAt(f, cx, cy); cam.panBy(dcx, dcy); loop.poke(); },
    wheel: (dy, p) => { cam.zoomAt(Math.exp(-dy * 0.0015), p.x, p.y); loop.poke(); },
  });

  // ---- minimap ---------------------------------------------------------------------------------------
  const miniCv = mini.querySelector('canvas');
  onTap(mapBtn, () => { ui.map = !ui.map; mini.hidden = !ui.map; mapBtn.classList.toggle('on', ui.map); loop.poke(); });
  mini.addEventListener('pointerdown', (e) => {
    const rc = miniCv.getBoundingClientRect();
    cam.centerOn(((e.clientX - rc.left) / rc.width) * W * TILE, ((e.clientY - rc.top) / rc.height) * H * TILE);
    loop.poke();
  });
  function drawMini() {
    const src = r.minimap;
    const sz = 160, dpr = Math.min(2, devicePixelRatio || 1);
    if (miniCv.width !== sz * dpr) { miniCv.width = miniCv.height = sz * dpr; }
    const g = miniCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    if (src) g.drawImage(src, 0, 0, miniCv.width, miniCv.height); else { g.fillStyle = '#2a2a2a'; g.fillRect(0, 0, miniCv.width, miniCv.height); }
    const k = miniCv.width / (W * TILE), v = r.view;
    if (v) { g.strokeStyle = '#f0c86a'; g.lineWidth = 2 * dpr; g.strokeRect(v.x0 * k, v.y0 * k, (v.x1 - v.x0) * k, (v.y1 - v.y0) * k); }
  }

  // ---- autosave (11.4; A's lifecycle saves on hide) --------------------------------------------------
  const autosave = setInterval(() => { if (!doc.hidden) api.saveNow().catch(() => null); }, (SAVE.autosaveSec || 60) * 1000);

  // ---- go ------------------------------------------------------------------------------------------
  if (s.col.length) cam.centerOn(s.col.reduce((a, c) => a + c.x, 0) / s.col.length, s.col.reduce((a, c) => a + c.y, 0) / s.col.length, false);
  else cam.centerOn((W * TILE) / 2, (H * TILE) / 2, false);
  layout();
  loop.start();

  const shell = {
    state: s, renderer: r, camera: cam, loop, ui, speed, loupe, toast,
    select, closePeek, openSubjectSheet, startTool, endTool, togglePanel, openMenu, openColony,
    /** Gate and spike probe: the world rect now, and the 10.1 plan for this viewport. */
    metrics: () => ({ world: measureWorld(doc), plan: plannedWorld(innerWidth, innerHeight, safeInsets(doc)), landscape: ui.landscape, insets: safeInsets(doc) }),
    worldToScreen: (wx, wy) => { const rc = canvas.getBoundingClientRect(), p = cam.worldToScreen(wx, wy); return { x: rc.left + p.x, y: rc.top + p.y }; },
    destroy() {
      loop.stop(); clearInterval(autosave); clearTimeout(stockT); r.dispose(); input.reset();
      window.removeEventListener('resize', layout);
      if (window.visualViewport) visualViewport.removeEventListener('resize', layout);
      speed.close(); speed.fan.remove(); speed.scrim.remove();
      toast.clear(); clear(root); root.classList.add('hidden');
      body.classList.remove('ec-game', 'land', 'narrow', 'paused', 'rail-hidden', 'has-peek', 'has-panel', 'has-sheet', 'tooling');
      // a fresh canvas drops the gesture listeners and the 2D context with the old one
      const fresh = canvas.cloneNode(false); fresh.classList.remove('ec-world'); fresh.width = fresh.height = 0;
      canvas.replaceWith(fresh);
    },
  };
  return shell;
}
