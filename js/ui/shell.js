// In-game layout shell (owner I; doc 10.1-10.7). The chrome at the 10.1 sizes around a live world
// canvas: top bar (Menu, clock, threat chip, stock chip), colonist rail, alert stack, map button,
// bottom bar (speed button + Build, Orders, Zones, Colony), the tool bar, the peek card and the full
// sheet, the loupe, toasts and the paused frame. Landscape: one top row with the rail inline, a
// vertical rail on the right, cards and sheets as a 320 pt overlay panel.
// The UI never mutates sim state: every change is a command (C3) sent through api.send.
//
// mountShell(root, api) -> shell
//   api.state                the colony (read-only here)
//   api.send(cmd)            -> { ok, reason?, ... }  (applyCommand with the determinism log)
//   api.saveNow()            -> Promise
//   api.exportBlob(id)       -> Promise<{ bytes, filename }>  (Menu > Back up)
//   api.quit()               back to the title (after a save)
//   api.demo                 optional demo data (?debug=1&demo=1): { alerts, threat, stock }
//   api.resumed              true when entered by Continue: the game starts paused with the Dawn Ledger (D4)
//   api.backupColony(id), api.skipBackup(), api.moveToApp(id), api.isStandalone()   A's storage prompts (11.5)
// Stage 1b: threat chip and omen letter (threatui.js), alerts (alerts.js), the Dawn Ledger and Next
// steps (ledger.js), the A2HS and backup prompts and Move to app (cards.js), drafted orders.
// Stage 2: letters with choices, the nemesis and demand cards and the trade sheet (letters.js), the
// full alert list, room outlines while building or with a room selected, the "?" help on every
// panel (help.js), animals as selections, and the auto-pause settings (letters, downed).
// Pieces: architect.js (Build, Orders), zonesui.js, toolbar.js (tool sessions), peek.js, sheet.js
// (subject sheets, Colony, Menu), colonistui.js, rolesui.js, billsui.js.
// Stage 2.9 (EMBERCROWN-FORTRESS.md 1.3, 3.1): no perk picks (an earned perk is a toast, from the
// Chronicle's perk lines), and the fall. When the colony falls (A's checkFall, 'ec2:fallen') the shell
// plays the defeat stinger, opens "The Hearth goes cold" (ruin.js) and turns into the read-only ruin
// viewer: no Build, Orders, Zones or speed; every command is refused; nothing ticks (tick() is a no-op
// for a fallen colony). The camera, the peek cards and the subject sheets stay, and the bottom bar holds
// Annals, The end, Export and Leave. A colony that has already fallen (View the ruin) opens this way.
import { h, clear, onTap, icon, Toaster } from './kit.js';
import { SIZES, isLandscape, measureWorld, plannedWorld, safeInsets } from './layout.js';
import { SpeedButton } from './speed.js';
import { Loupe } from './loupe.js';
import { TILE, W, H } from '../game/core/grid.js';
import { dayOf, seasonOf, clockText, SEASONS, SEASON_NAMES, TPS } from '../game/core/time.js';
import { step } from '../game/core/sim.js';
import { dispatch, on as onEvent } from '../game/core/events.js';
import { BUS } from '../game/core/bus.js';
import { FIX } from '../game/core/schema.js';
import { pickAt } from '../game/tools/pick.js';
import { tileAt } from '../game/tools/rect.js';
import { roomAt } from '../game/tools/copy.js';
import { footprint } from '../game/world/pass.js';
import { SAVE } from '../data/balance.js';
import { foodDays } from '../data/advice.js';
import { Renderer } from '../engine/render/index.js';
import { Camera } from '../engine/camera.js';
import { Loop, fpsTarget } from '../engine/loop.js';
import { GestureInput } from '../engine/input.js';
import { buildPanel, ordersPanel, STAGE } from './architect.js';
import { zonesPanel } from './zonesui.js';
import { createTool } from './toolbar.js';
import { peekContent, contextItems } from './peek.js';
import { openSubjectSheet, openColony, openMenu } from './sheet.js';
import { mountGuide } from './guide.js';
import { chipView, threatWatch, omenLetter, jumpToEdge, foeAt, draftAll, draftedIds, orderDrafted, firstOmen, imminentAdvice, endText } from './threatui.js';
import { alertTracker } from './alerts.js';
import { mountLedger } from './ledger.js';
import { mountIntros } from './intros.js';
import { mountPrompts } from './cards.js';
import { mountLetters, openDemand, openTrade, openLetters, openChoice } from './letters.js';
import { helpButton } from './help.js';
import { isFallen, fallSummary } from '../game/colony/fall.js';
import { checkFall } from '../main.js';
import { hearthColdView, annalsView, playDefeat, prepareRuinExport, shareRuinExport, exportedText, fellLine, RUIN_TEXT } from './ruin.js';
import { weatherText } from '../game/world/weather.js';
import { outdoorTemp } from '../game/world/temperature.js';

const TABS = [
  { id: 'build', label: 'Build', icon: 'build' },
  { id: 'orders', label: 'Orders', icon: 'orders' },
  { id: 'zones', label: 'Zones', icon: 'zones' },
  { id: 'colony', label: 'Colony', icon: 'colony' },
];
// the ruin viewer's bottom bar (1.3): read, export, leave; no tool opens on a fallen hold
const RUIN_TABS = [
  { id: 'annals', label: 'Annals', icon: 'book' },
  { id: 'end', label: 'The end', icon: 'skull' },
  { id: 'export', label: 'Export', icon: 'export' },
  { id: 'leave', label: 'Leave', icon: 'back' },
];
const PANEL_TITLE = { build: 'Build', orders: 'Orders', zones: 'Zones' };
const CLOTH = ['#8a4a3a', '#3f5f8a', '#5f7a3a', '#7a5a2a', '#6a3f7a', '#2f6f6a', '#8a6f3a', '#5a5a66'];
const SKIN = ['#f1d2b0', '#e2b98f', '#c99a6e', '#a8774f', '#7e5536', '#5a3b26'];

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
    speed: 1, sel: null, peek: null, sheet: null, panel: null, tool: null, stroke: null,
    stockOpen: false, map: false, landscape: false, narrow: false, follow: null,
    buildState: { tab: 'rooms' }, zonesState: { pick: false }, lastCmd: null, lastRes: null, menu: null,
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
  const ctxMenu = h('div.ec-ctxmenu', { hidden: true, role: 'menu' });
  const ctxScrim = h('div.ec-ctx-scrim', { hidden: true });
  const toasts = h('div.ec-toasts', { 'aria-live': 'polite' });
  root.append(frame, top, rail, strip, alerts, mapBtn, mini, hint, peek, panel, sheet, bottom, ctxScrim, ctxMenu, toasts);
  const loupe = new Loupe(root);
  const toast = new Toaster(toasts);

  // ---- renderer, camera, loop -------------------------------------------------------------------
  const r = new Renderer(canvas);
  r.setState(s);
  const cam = new Camera();
  cam.zoom = 1;
  const flags = { covered: false, saver: false, paused: false, combat: false, moving: true, fast: false };
  let lastMinute = -1, dirtyChrome = true, peekT = 0;
  // Settings that reach the renderer and the loop (A's save/settings.js; the CSS reads data-ec-*)
  const applyLive = (st) => { if (!st) return; r.settings.reduceMotion = !!st.reduceMotion; r.settings.colorblind = !!st.colourSafe; flags.saver = !!st.batterySaver; };
  applyLive(api.readSettings ? api.readSettings() : null);
  const onSettings = (e) => { applyLive(e && e.detail ? e.detail.settings : null); dirtyChrome = true; layout(); };
  window.addEventListener('ec2:settings', onSettings);
  const loop = new Loop({
    step: 1 / TPS,
    maxTicksPerFrame: 10,
    update: () => { step(s, 1); },
    render: (alpha, dt) => {
      dispatch(s);
      followCam();
      cam.update(dt);
      edgeScroll(dt);
      if (ui.tool) syncPreview();
      r.draw(s, cam, alpha, dt, {});
      if (ui.stroke && loupe.visible) drawLoupe();
      const m = Math.floor(s.tick / 10);
      // the stock chip follows hauling (not only commands): refreshed with the clock, each game minute
      if (m !== lastMinute || dirtyChrome) { lastMinute = m; renderClock(); if (!dirtyChrome) { renderStock(); renderThreat(); } }
      if (dirtyChrome) { dirtyChrome = false; renderRail(); renderStock(); renderThreat(); renderAlerts(); }
      if (ui.map) drawMini();
      peekT += dt;
      if (peekT > 1 && ui.peek && !ui.sheet) { peekT = 0; renderPeek(true); }
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
  // back from the background, or Continue: always paused, with the Dawn Ledger (2.2, D4, 10.10)
  let resumePaused = false;
  const onResume = () => { if (ruin.on) return; setSpeed(0); speed.render(); resumePaused = true; if (ledger) { if (ui.tool) endTool(); ledger.showResume(); } };
  window.addEventListener('ec2:resume', onResume);

  /** D3: 5x is blocked while raiders are on the map or anyone is drafted. */
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
    // with the threat chip up, a portrait bar up to 440 pt shows the season as its glyph too (X 2.7:
    // "D17 Highsun 06:00", the chip and the food chip overlapped at 390)
    const glyph = ui.narrow || (!threat.hidden && !ui.landscape && innerWidth < 440);
    const season = glyph ? `<span class="ec-season" aria-label="${SEASON_NAMES[se]}">${icon(SEASONS[se])}</span>` : `<span class="ec-season-name">${SEASON_NAMES[se]}</span>`;
    clock.innerHTML = `<span>D${d}</span>${season}<span>${clockText(s.tick)}</span>`;
  }
  let lastThreat = '';
  /** The threat chip (10.1): absent until an omen; icon + hours, "here" once on the map. */
  function renderThreat() {
    if (ruin.on) { threat.hidden = true; return; }
    const v = chipView(s);
    const demo = !v && api.demo && api.demo.threat;
    if (!v && !demo) { if (!threat.hidden) { threat.hidden = true; lastThreat = ''; renderClock(); } return; }
    const text = v ? v.text : `${demo.hours}h`, label = v ? v.label : `${demo.name} in ${demo.hours} hours`, tone = v ? v.tone : 'warn';
    const key = `${text}|${label}|${tone}`;
    if (key === lastThreat) return;
    lastThreat = key;
    const was = threat.hidden;
    threat.hidden = false;
    if (was) renderClock();
    threat.className = 'ec-chip ec-threat' + (tone ? ' ' + tone : '');
    threat.dataset.stage = v ? v.stage : 'demo';
    threat.innerHTML = `${icon('horde')}<span class="ec-chip-t">${text}</span>`;
    threat.setAttribute('aria-label', label);
  }
  function stockRows() {
    if (api.demo && api.demo.stock) return api.demo.stock;
    const tot = (k) => s.rt.stock[k] || 0;
    const meals = tot('meal');
    const days = Math.floor(foodDays(s));
    // Stage 1a has no hunger: the chip leads with wood (what a sandbox build waits on), not food days
    if (STAGE === '1a') return [['wood', 'Wood', String(tot('wood'))], ['stone', 'Stone', String(tot('stone'))], ['stone', 'Blocks', String(tot('block'))], ['pick', 'Ore', String(tot('coal') + tot('ore'))]];
    const rows = [['food', 'Food', `${Math.min(99, days)}d`], ['wood', 'Wood', String(tot('wood'))], ['stone', 'Stone', String(tot('stone'))], ['stone', 'Blocks', String(tot('block'))], ['sword', 'Ingots', String(tot('ingot'))], ['food', 'Meals', String(meals)]];
    if (s.colony.world) {
      rows.push(['gold', 'Coins', String(tot('coins'))]);
      try { rows.push([SEASONS[seasonOf(s.tick)], weatherText(s).replace(/, (\d+) h left/, ''), `${Math.round(outdoorTemp(s.tick, s))} C`]); } catch (_) { /* no weather yet */ }
    }
    return rows;
  }
  let lastChip = '', lastStrip = '';
  function renderStock() {
    const rows = stockRows();
    const chip = `<span class="ec-chip-t">${rows[0][1].toLowerCase()} ${rows[0][2]}</span>${icon('chevDown', 'chevd')}`;
    if (chip !== lastChip) { lastChip = chip; stock.innerHTML = chip; }
    if (ui.stockOpen) { const st = rows.map(([ic, n, v]) => `<div class="ec-stock-cell">${icon(ic)}<span>${n}</span><b>${v}</b></div>`).join(''); if (st !== lastStrip) { lastStrip = st; strip.innerHTML = st; } }
  }
  let stockT = 0;
  onTap(stock, () => {
    ui.stockOpen = !ui.stockOpen; strip.hidden = !ui.stockOpen; renderStock();
    clearTimeout(stockT); if (ui.stockOpen) stockT = setTimeout(() => { ui.stockOpen = false; strip.hidden = true; }, 4000);
  }, { longpress: () => openColony(ctx, 'Stock') });
  onTap(strip, () => { ui.stockOpen = false; strip.hidden = true; });
  // tap: jump to the edge (the route preview draws from the Sighted stage on) and show the raid card
  onTap(threat, () => {
    const v = chipView(s);
    if (!v) { toast.show(threat.getAttribute('aria-label') + '.'); return; }
    jumpToEdge(ctx, v.view);
    select({ kind: 'raid', id: v.view.id });
  });
  onTap(menuBtn, () => openMenu(ctx, api));

  // ---- colonist rail ----------------------------------------------------------------------------------
  function portrait(c, size = 44) {
    const mood = Math.max(0, Math.min(100, (c.mood || 0) / FIX));
    const ring = mood < 25 ? '#e0644e' : mood < 45 ? '#e8b04a' : '#8fd16a';
    const look = c.look || {};
    const p = h('span.ec-portrait', { style: { width: size + 'px', height: size + 'px', '--ring': ring, '--cloth': CLOTH[(look.cloth | 0) % CLOTH.length], '--skin': SKIN[(look.skin | 0) % SKIN.length] } },
      h('span.ec-portrait-i', { text: (c.name || '?').slice(0, 1) }));
    if (c.drafted) p.classList.add('drafted');
    return p;
  }
  let railKey = null;
  function renderRail() {
    const key = s.col.map((c) => `${c.id}:${c.name}:${c.drafted ? 1 : 0}:${Math.round(c.mood / FIX / 10)}`).join('|') + (ui.sel && ui.sel.kind === 'colonist' ? ':' + ui.sel.id : '');
    if (key === railKey) return;
    railKey = key;
    clear(rail);
    if (!s.col.length) { rail.append(h('p.ec-rail-empty', { text: 'No colonists.' })); return; }
    for (const c of s.col) {
      const b = h('button.ec-rail-btn', { type: 'button', role: 'listitem', 'data-act': 'colonist', 'data-col': String(c.id), 'aria-label': c.name }, portrait(c));
      if (ui.sel && ui.sel.kind === 'colonist' && ui.sel.id === c.id) b.classList.add('sel');
      onTap(b, () => {
        const again = ui.sel && ui.sel.kind === 'colonist' && ui.sel.id === c.id;
        select({ kind: 'colonist', id: c.id }, again);
        centerOn(c.x, c.y);
      }, {
        // long-press a portrait: the colonist's context menu (Draft, Follow...; 9.5, 10.2)
        longpress: () => {
          const rc = b.getBoundingClientRect(), cv = canvas.getBoundingClientRect();
          showCtx({ x: rc.left - cv.left + rc.width / 2, y: rc.bottom - cv.top + 20 }, contextItems(ctx, { kind: 'colonist', id: c.id }, null));
        },
      });
      rail.append(b);
    }
  }

  // ---- alerts -----------------------------------------------------------------------------------------
  const tracker = alertTracker(s, { get letters() { return letters; } });
  let alertKey = null;
  /** Jump to an alert's subject (10.6): a colonist, a building, a tile or the threat. */
  function alertGo(a) {
    const t = a.target || {};
    if (!t.open) toast.show(a.text + '.');
    if (t.colonist !== undefined) { const c = s.col.find((x) => x.id === t.colonist); if (c) { centerOn(c.x, c.y); select({ kind: 'colonist', id: c.id }); } }
    else if (t.building !== undefined && s.bld[t.building]) { const b = s.bld[t.building]; centerOn((b.x + 1) * TILE, (b.y + 1) * TILE); select({ kind: 'building', id: b.id, x: b.x, y: b.y }); }
    else if (t.threat) { const v = chipView(s); if (v) { jumpToEdge(ctx, v.view); select({ kind: 'raid', id: v.view.id }); } }
    else if (t.animal !== undefined) { const a = s.anim.find((x) => x.id === t.animal); if (a) { centerOn(a.x, a.y); select({ kind: 'animal', id: a.id }); } }
    else if (t.zone !== undefined) { const z = s.zones.find((x) => x.id === t.zone); if (z) { for (let i = 0; i < s.L.zone.length; i++) if (s.L.zone[i] === z.id) { centerOn(((i % W) + 0.5) * TILE, (((i / W) | 0) + 0.5) * TILE); break; } select({ kind: 'zone', id: z.id }); } }
    else if (t.open) openTarget(t);
    else if (t.tile) {
      // a tile subject (a fire, a rumbling roof, an unburied body): centre on it and show its card
      centerOn((t.tile[0] + 0.5) * TILE, (t.tile[1] + 0.5) * TILE);
      const i = t.tile[1] * W + t.tile[0];
      select({ kind: 'tile', id: i, tile: i, x: t.tile[0], y: t.tile[1] });
    }
  }
  /** Alert targets that open a sheet (10.6 "jump to its subject"). */
  function openTarget(t) {
    const tabFor = { needs: 'Needs', health: 'Health', skills: 'Skills' };
    if (tabFor[t.open] && t.colonist !== undefined) { const c = s.col.find((x) => x.id === t.colonist); if (c) { centerOn(c.x, c.y); select({ kind: 'colonist', id: c.id }); openSubjectSheet(ctx, { kind: 'colonist', id: c.id }, tabFor[t.open]); } return; }
    if (t.open === 'letters') { const w = letters.waiting(); if (w.length === 1) openLetterNow(w[0]); else openLetters(ctx, letters); return; }
    if (t.open === 'letter') { letters.openNewest(); return; }
    if (t.open === 'demand') { openDemand(ctx, letterHooks); return; }
    if (t.open === 'trade') { openTrade(ctx); return; }
    if (t.open === 'work') { openColony(ctx, 'Work'); return; }
    if (t.open === 'colony') { openColony(ctx, 'People'); return; }
    if (t.open === 'stock') { openColony(ctx, 'Stock'); return; }
    if (t.open === 'build') { openPanel('build'); }
  }
  function renderAlerts(force = true) {
    const list = ruin.on ? [] : (api.demo && api.demo.alerts) || tracker.list();
    const key = list.map((a) => `${a.id || a.icon}:${a.tone}:${a.text}`).join('|');
    if (!force && key === alertKey) return;
    alertKey = key;
    clear(alerts);
    const vis = list.slice(0, SIZES.alertsVisible);
    for (const a of vis) {
      const b = h('button.ec-ibtn.ec-alert' + (a.tone ? '.' + a.tone : ''), { type: 'button', 'data-act': 'alert', 'data-alert': a.id || a.icon, 'aria-label': a.text, html: icon(a.icon) });
      // long-press: explain and "snooze 1 day" (10.6)
      onTap(b, () => alertGo(a), { longpress: () => {
        const rc = b.getBoundingClientRect(), cv = canvas.getBoundingClientRect();
        toast.show(`${a.text}. ${a.why || ''}`.trim());
        if (a.id) showCtx({ x: rc.left - cv.left, y: rc.top - cv.top + rc.height + 40 }, [['Snooze 1 day', () => { tracker.snooze(a.id); renderAlerts(); }, 'alert-snooze'], ['Show me', () => alertGo(a), 'alert-go']]);
      } });
      alerts.append(b);
    }
    if (list.length > vis.length) {
      const more = h('button.ec-ibtn.ec-alert-more', { type: 'button', 'data-act': 'alerts', 'aria-label': `${list.length - vis.length} more alerts`, text: `+${list.length - vis.length}` });
      onTap(more, () => toast.show(list.slice(vis.length).map((a) => a.text).join('. ')));
      alerts.append(more);
    }
  }

  // ---- bottom bar -------------------------------------------------------------------------------------
  function renderTabs() {
    clear(tabs);
    for (const t of ruin.on ? RUIN_TABS : TABS) {
      const b = h('button.ec-tab', { type: 'button', 'data-act': ruin.on ? 'ruin-' + t.id : 'tab', 'data-tab': t.id, 'aria-label': t.label }, h('span', { html: icon(t.icon) }), h('span.ec-tab-l', { text: t.label }));
      onTap(b, () => (ruin.on ? ruinTab(t.id) : t.id === 'colony' ? openColony(ctx, 'People') : togglePanel(t.id)));
      tabs.append(b);
    }
  }
  // the ruin (1.3): set before the first render, so a fallen hold never shows its tools
  const ruin = { on: isFallen(s), prep: null, toldAt: 0 };
  renderTabs();

  // ---- panels (Build, Orders, Zones) -------------------------------------------------------------------
  function panelHead(title) {
    const x = h('button.ec-ibtn.ec-close', { type: 'button', 'data-act': 'close', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => closePanel());
    return h('div.ec-panel-head', null, h('h2', { text: title }), h('span.ec-head-r', null, helpButton(ctx, PANEL_TITLE[ui.panel] || title), x));
  }
  function renderPanel() {
    const id = ui.panel;
    clear(panel);
    panel.dataset.panel = id;
    panel.append(panelHead(id === 'zones' && ui.zonesState.pick ? 'Stockpile' : PANEL_TITLE[id]));
    if (id === 'build') buildPanel(panel, ctx, ui.buildState);
    else if (id === 'orders') ordersPanel(panel, ctx);
    else if (id === 'zones') zonesPanel(panel, ctx, ui.zonesState);
  }
  function togglePanel(id) {
    if (ui.panel === id) { closePanel(); return; }
    openPanel(id);
  }
  function openPanel(id) {
    if (ui.tool) endTool();
    closePeek(false); closeSheet(false);
    ui.panel = id;
    if (id === 'zones') ui.zonesState.pick = false;
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.tab === id);
    renderPanel();
    panel.hidden = false;
    panel.scrollTop = 0;
    syncChrome();
  }
  function closePanel(sync = true) { if (!ui.panel) return; ui.panel = null; panel.hidden = true; for (const b of tabs.children) b.classList.remove('on'); if (sync) syncChrome(); }

  // ---- sheets (a stack: a sheet opened with { back: true } returns to the one under it) -----------------
  const stack = [];
  let cur = null;
  function openSheet(title, build, opts = {}) {
    if (opts.back && cur) stack.push(cur); else stack.length = 0;
    closePanel(false);
    hideCtx();
    if (cur && cur.opts.onClose && !opts.back) { const f = cur.opts.onClose; cur.opts.onClose = null; f(); }
    cur = { title, build, opts, tab: opts.tab || (opts.tabs ? opts.tabs[0] : null) };
    renderSheet(false);
    sheet.classList.remove('tall');
    sheet.hidden = false;
    ui.sheet = title;
    peek.hidden = true;
    syncChrome();
  }
  function renderSheet(keep = true) {
    if (!cur) return;
    const oldBody = sheet.querySelector('.ec-sheet-body'), oldStrip = sheet.querySelector('.ec-strip');
    const sy = keep && oldBody ? oldBody.scrollTop : 0, sx = keep && oldStrip ? oldStrip.scrollLeft : 0;
    clear(sheet);
    const grab = h('div.ec-grab', { 'aria-hidden': 'true' }, h('i'));
    const x = h('button.ec-ibtn.ec-close', { type: 'button', 'data-act': 'close-sheet', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => closeSheet());
    const headRow = h('div.ec-panel-head', null);
    if (stack.length) { const bk = h('button.ec-ibtn.ec-close', { type: 'button', 'data-act': 'sheet-back', 'aria-label': 'Back', html: icon('back') }); onTap(bk, () => back()); headRow.append(bk); }
    headRow.append(h('h2', { text: cur.title }), h('span.ec-head-r', null, cur.opts.help ? helpButton(ctx, cur.opts.help) : helpButton(ctx, cur.title), x));
    sheet.append(grab, headRow);
    if (cur.opts.head) sheet.append(cur.opts.head());
    const bodyEl = h('div.ec-sheet-body');
    if (cur.opts.tabs) {
      const st = h('div.ec-strip', { role: 'tablist' });
      for (const n of cur.opts.tabs) {
        const b = h('button.ec-strip-tab' + (n === cur.tab ? '.on' : ''), { type: 'button', role: 'tab', 'aria-selected': n === cur.tab ? 'true' : 'false', 'data-tab': n, 'data-act': 'sheet-tab', text: n });
        onTap(b, () => { cur.tab = n; renderSheet(false); });
        st.append(b);
      }
      sheet.append(st, bodyEl);
      cur.build(bodyEl, cur.tab);
      st.scrollLeft = sx;
      if (!keep) { const on = st.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center' }); }
    } else { sheet.append(bodyEl); cur.build(bodyEl, null); }
    bodyEl.scrollTop = sy;
    dragToResize(grab);
  }
  function back() { if (stack.length) { cur = stack.pop(); ui.sheet = cur.title; renderSheet(false); } else closeSheet(); }
  function closeSheet(sync = true) {
    if (!ui.sheet) return;
    const closers = [cur, ...stack].map((x) => x && x.opts.onClose).filter(Boolean);
    ui.sheet = null; cur = null; stack.length = 0; sheet.hidden = true;
    for (const f of closers) f();
    if (ui.sel && sync) renderPeek();
    if (sync) syncChrome();
  }
  /** Drag the grab bar: up to 92%, down to close (10.1). */
  function dragToResize(grab) {
    let y0 = null;
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; try { grab.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } });
    grab.addEventListener('pointerup', (e) => {
      if (y0 === null) return; const dy = e.clientY - y0; y0 = null;
      if (dy < -30) sheet.classList.add('tall');
      else if (dy > 30) { if (sheet.classList.contains('tall')) sheet.classList.remove('tall'); else closeSheet(); }
    });
  }

  // ---- selection: peek card and full sheet -------------------------------------------------------------
  function select(sel, again = false, quiet = false) {
    if (!sel) { closePeek(); return; }
    if (again && ui.peek && !ui.sheet && !quiet) { openSubjectSheet(ctx, ui.sel); return; }
    if (ui.sel && ui.sel.kind === 'colonist') ui.prevColonist = ui.sel.id;
    if (sel.kind === 'colonist') ui.prevColonist = sel.id;
    ui.sel = sel;
    closePanel(false);
    if (!quiet) closeSheet(false);
    renderPeek();
    updateSelOverlay();
    dirtyChrome = true; loop.poke();
  }
  function updateSelOverlay() {
    const sel = ui.sel;
    if (sel && sel.kind !== 'colonist' && sel.x !== undefined) {
      // a building's highlight covers its whole footprint (a 2-tile bench, not just its anchor)
      let x0 = sel.x, y0 = sel.y, x1 = sel.x, y1 = sel.y;
      const b = sel.kind === 'building' && sel.id !== undefined ? s.bld[sel.id] : null;
      if (b) for (const i of footprint(s, b)) { const tx0 = i % W, ty0 = (i / W) | 0; if (tx0 < x0) x0 = tx0; if (tx0 > x1) x1 = tx0; if (ty0 < y0) y0 = ty0; if (ty0 > y1) y1 = ty0; }
      r.setOverlay('preview', { rect: { x0, y0, x1, y1 }, ok: true });
    }
    else r.setOverlay('preview', null);
    r.setOverlay('zones', ui.panel === 'zones' || (ui.tool && ui.tool.overlay === 'zones') ? true : sel && sel.kind === 'zone' ? sel.id : false);
    // room outlines (Stage 2, by role): every room while building; the selected room, brighter, otherwise
    const selRoom = sel && sel.tile !== undefined ? roomAt(s, sel.tile) : sel && sel.kind === 'building' && s.bld[sel.id] ? roomAt(s, s.bld[sel.id].y * W + s.bld[sel.id].x) : 0;
    const building = ui.panel === 'build' || (ui.tool && (ui.tool.kind === 'stamp' || ui.tool.kind === 'paste' || ui.tool.kind === 'place'));
    r.setOverlay('rooms', building ? (selRoom || true) : selRoom || false);
  }
  let peekKey = '', peekDown = false;
  peek.addEventListener('pointerdown', () => { peekDown = true; }, true);
  for (const ev of ['pointerup', 'pointercancel']) peek.addEventListener(ev, () => { setTimeout(() => { peekDown = false; }, 0); }, true);
  /** Build the peek card. live: the once-a-second refresh, which never rebuilds under a finger or when nothing changed. */
  function renderPeek(live = false) {
    const sel = ui.sel;
    if (!sel) return;
    if (live && peekDown) return;
    const c = peekContent(ctx, sel);
    if (!c) { closePeek(); return; }
    const key = `${sel.kind}:${sel.id}:${c.head.textContent}:${c.head.querySelector('.ec-moodbar i') ? c.head.querySelector('.ec-moodbar i').style.width : ''}:${c.acts.map((a) => a[0] + (a[3] ? '-' : '')).join('|')}`;
    if (live && key === peekKey && !peek.hidden) return;
    peekKey = key;
    clear(peek);
    peek.dataset.kind = sel.kind;
    const grab = h('div.ec-grab', { 'aria-hidden': 'true' }, h('i'));
    const row = h('div.ec-peek-acts');
    for (const [label, fn, act, disabled] of c.acts) {
      // an unavailable action looks dimmed but still answers a tap with why (its fn says so)
      const b = h('button.ec-act' + (disabled ? '.dim' : ''), { type: 'button', 'data-act': act || 'peek-act', text: label });
      onTap(b, fn);
      row.append(b);
    }
    peek.append(grab, c.head, row);
    if (!ui.sheet) peek.hidden = false;
    ui.peek = sel.kind;
    let y0 = null;
    const up = (e) => { if (y0 !== null && e.clientY - y0 < -30) openSubjectSheet(ctx, ui.sel); else if (y0 !== null && e.clientY - y0 > 30) closePeek(); y0 = null; };
    grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
    grab.addEventListener('pointerup', up);
    c.head.addEventListener('pointerdown', (e) => { y0 = e.clientY; });
    c.head.addEventListener('pointerup', (e) => { const dy = y0 === null ? 0 : e.clientY - y0; if (Math.abs(dy) > 30) up(e); else { y0 = null; if (!e.target.closest('button')) openSubjectSheet(ctx, ui.sel); } });
    syncChrome();
  }
  function closePeek(sync = true) {
    if (!ui.peek && !ui.sel) return;
    ui.peek = null; ui.sel = null; peek.hidden = true;
    r.setOverlay('preview', null); r.setOverlay('rooms', false);
    if (!ui.panel && !(ui.tool && ui.tool.overlay)) r.setOverlay('zones', false);
    dirtyChrome = true;
    if (sync) syncChrome();
  }
  /** The rail hides under any card, panel or sheet (portrait); the world height follows. */
  function syncChrome() {
    const showPeek = !!(ui.peek && !ui.sheet);
    const covered = !!(showPeek || ui.panel || ui.sheet);
    body.classList.toggle('rail-hidden', covered);
    body.classList.toggle('has-peek', showPeek);
    body.classList.toggle('has-panel', !!ui.panel);
    body.classList.toggle('has-sheet', !!ui.sheet);
    if (covered) { ui.stockOpen = false; strip.hidden = true; }
    updateSelOverlay();
    loop.poke();
  }

  function send(cmd, okText = null, quiet = false) {
    // a fallen hold is read-only (1.3): nothing reaches the sim (A's send refuses too)
    const res = ruin.on || isFallen(s) ? { ok: false, reason: RUIN_TEXT.readOnly } : api.send(cmd);
    ui.lastCmd = cmd; ui.lastRes = res;
    if (!res || !res.ok) {
      // validator reasons are lower-case fragments ("something is already there"): show a sentence
      const why = String((res && res.reason) || 'Not possible.');
      if (!quiet) toast.show(why.charAt(0).toUpperCase() + why.slice(1) + (/[.!?]$/.test(why) ? '' : '.'), 'bad');
    }
    else if (okText) toast.show(okText);
    dirtyChrome = true; loop.poke();
    if (ui.sel && !ui.sheet) renderPeek();
    return res || { ok: false };
  }
  function centerOn(x, y) { ui.follow = null; cam.centerOn(x, y); loop.poke(); }
  function followCam() {
    if (ui.follow === null) return;
    const c = s.col.find((x) => x.id === ui.follow);
    if (!c) { ui.follow = null; return; }
    cam.centerOn(c.x, c.y);
  }

  // ---- long-press menu (10.2) -------------------------------------------------------------------------
  function showCtx(p, items) {
    if (!items.length) return;
    clear(ctxMenu);
    for (const [label, fn, act] of items) {
      const b = h('button.ec-ctx-i', { type: 'button', role: 'menuitem', 'data-act': act || 'ctx', text: label });
      onTap(b, () => { hideCtx(); fn(); });
      ctxMenu.append(b);
    }
    ctxMenu.hidden = false; ctxScrim.hidden = false;
    const rc = canvas.getBoundingClientRect();
    const mw = ctxMenu.offsetWidth, mh = ctxMenu.offsetHeight;
    let x = rc.left + p.x - mw / 2, y = rc.top + p.y - mh - 30;
    if (y < rc.top + 4) y = rc.top + p.y + 30;
    x = Math.max(8, Math.min(innerWidth - mw - 8, x)); y = Math.max(8, Math.min(innerHeight - mh - 8, y));
    ctxMenu.style.left = `${Math.round(x)}px`; ctxMenu.style.top = `${Math.round(y)}px`;
  }
  function hideCtx() { ctxMenu.hidden = true; ctxScrim.hidden = true; }
  ctxScrim.addEventListener('pointerdown', (e) => { e.preventDefault(); hideCtx(); });

  // ---- tools (10.2, 10.3, 10.11) -----------------------------------------------------------------------
  let drawHook = null;
  function startTool(spec) {
    if (ui.tool) endTool();
    closePanel(false); closePeek(false); closeSheet(false);
    ui.follow = null;
    ui.tool = createTool(spec, ctx);
    body.classList.add('tooling');
    tabs.hidden = true; toolbar.hidden = false;
    hint.hidden = false;
    renderBar(); showHint();
    drawHook = (g, st, view) => { if (ui.tool && ui.tool.draw) ui.tool.draw(g, view); };
    BUS.draw.overlay.push(drawHook);
    syncChrome();
    return ui.tool;
  }
  function endTool(commit = false) {
    const t = ui.tool;
    if (t && commit && t.done) t.done();
    ui.tool = null; ui.stroke = null; loupe.hide();
    if (drawHook) { const k = BUS.draw.overlay.indexOf(drawHook); if (k >= 0) BUS.draw.overlay.splice(k, 1); drawHook = null; }
    body.classList.remove('tooling');
    tabs.hidden = false; toolbar.hidden = true; hint.hidden = true;
    r.setOverlay('preview', null); r.setOverlay('stripes', null);
    syncChrome();
  }
  let barDown = false;
  toolbar.addEventListener('pointerdown', () => { barDown = true; }, true);
  for (const ev of ['pointerup', 'pointercancel']) toolbar.addEventListener(ev, () => { setTimeout(() => { barDown = false; }, 0); }, true);
  function renderBar() {
    const t = ui.tool;
    if (barDown) { setTimeout(renderBar, 120); return; }   // never rebuild a button under a finger
    clear(toolbar);
    if (!t) return;
    const chips = h('div.ec-tchips');
    for (const c of t.chips()) {
      const b = h('button.ec-tchip' + (c.on ? '.on' : ''), { type: 'button', 'data-act': 'chip-' + c.id, 'aria-label': c.label }, c.icon ? h('span', { html: icon(c.icon) }) : null, h('span.ec-tchip-l', { text: c.label }));
      onTap(b, () => { c.act(); showHint(); loop.poke(); });
      chips.append(b);
    }
    const undo = h('button.ec-ibtn.ec-undo', { type: 'button', 'data-act': 'undo', 'aria-label': t.pending ? 'Clear the plan' : 'Undo', html: icon('undo'), disabled: !t.canUndo() });
    onTap(undo, () => { t.doUndo(); showHint(); });
    const done = h('button.ec-tdone', { type: 'button', 'data-act': 'done', text: t.pending ? 'Build' : 'Done' });
    if (t.pending && t.kind === 'carve') done.textContent = 'Carve';
    onTap(done, () => endTool(true));
    toolbar.append(chips, undo, done);
    // a chip row wider than its slot fades at the edge (it scrolls); the fade goes once at the end
    const fade = () => chips.classList.toggle('more', chips.scrollWidth > chips.clientWidth + 1 && chips.scrollLeft + chips.clientWidth < chips.scrollWidth - 2);
    chips.addEventListener('scroll', fade, { passive: true });
    requestAnimationFrame(fade);
  }
  function showHint() { if (ui.tool) hint.textContent = ui.tool.hintText(); }
  /** Preview overlays of the active tool (rect and zone tools use C's 'preview' overlay). */
  function syncPreview() {
    const t = ui.tool;
    if (t.preview) r.setOverlay('preview', t.preview());
    if (t.overlay === 'zones') r.setOverlay('zones', true);
  }
  const worldAt = (p) => cam.screenToWorld(p.x, p.y);
  function strokeTo(p) {
    const st = ui.stroke;
    st.p = p;
    const wpt = worldAt(p);
    const b = tileAt(wpt.x, wpt.y);
    if (!st.last || st.last.x !== b.x || st.last.y !== b.y) { st.last = b; ui.tool.strokeMove(b); showHint(); }
    loupe.show();
    loop.poke();
  }
  function drawLoupe() {
    const st = ui.stroke, rc = canvas.getBoundingClientRect();
    const wr = measureWorld(doc) || { x: rc.left, y: rc.top, width: rc.width, height: rc.height };
    loupe.update(canvas, rc, rc.left + st.p.x, rc.top + st.p.y, ui.tool ? ui.tool.label() : '', wr);
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
    // a stroke that starts in the edge band does not scroll: the finger must leave the band first and
    // then rest in it for 0.2 s (play-test: drags begun near the screen edge raced the camera away)
    if (!dx && !dy) { st.armed = true; st.dwell = 0; return; }
    if (!st.armed) return;
    st.dwell = (st.dwell || 0) + dt;
    if (st.dwell < 0.2) return;
    cam.panBy(dx, dy); strokeTo(st.p);
  }

  // ---- world gestures ------------------------------------------------------------------------------
  let pressAt = null, held = false;
  const input = new GestureInput(canvas, {
    press: (p) => { pressAt = p; held = false; },
    longpress: (p) => {
      held = true;
      if (ui.tool) return;   // in a tool: the next drag erases (10.2)
      const wpt = worldAt(p);
      const prevCol = ui.sel && ui.sel.kind === 'colonist' ? ui.sel.id : null;
      const target = pickAt(s, wpt.x, wpt.y, cam.zoom, null);
      if (!target) return;
      // with a colonist selected, a job under the finger offers "Prioritise: <work> here"
      const items = contextItems(ctx, target, target.kind !== 'colonist' ? prevCol : null);
      showCtx(p, items);
    },
    tap: (p) => {
      if (speed.isOpen) { speed.close(); return; }
      if (!ctxMenu.hidden) { hideCtx(); return; }
      const wpt = worldAt(p);
      if (ui.tool) { ui.tool.tap(tileAt(wpt.x, wpt.y)); showHint(); renderBar(); loop.poke(); return; }
      if (ui.panel) { closePanel(); return; }
      if (ui.sheet) { closeSheet(); return; }
      const prev = ui.sel;
      // drafted orders (9.5, 10.2): with drafted colonists selected, a tap on a hostile attacks it and a
      // tap on the ground moves them there (a tap on a colonist still selects)
      const orderIds = prev && prev.kind === 'drafted' ? draftedIds(s) : prev && prev.kind === 'colonist' && (s.col.find((c) => c.id === prev.id) || {}).drafted ? [prev.id] : [];
      const foe = foeAt(s, wpt.x, wpt.y, cam.zoom);
      if (orderIds.length) {
        const hit = pickAt(s, wpt.x, wpt.y, cam.zoom, null);
        if (!(hit && hit.kind === 'colonist')) { const tl = tileAt(wpt.x, wpt.y); orderDrafted(ctx, orderIds, foe ? { foe } : { x: tl.x, y: tl.y }); return; }
      }
      if (foe) { const raid = s.raids.find((r) => r.members.includes(foe.id)); select({ kind: 'raid', id: raid ? raid.id : null }); return; }
      const sel = pickAt(s, wpt.x, wpt.y, cam.zoom, prev);
      if (!sel) { closePeek(); return; }
      const again = sel.kind === 'colonist' ? sel.again : false;
      select(sel, again);
    },
    dragstart: (p) => {
      ui.follow = null;
      if (ui.tool && ui.tool.kind !== 'pick') {
        const w0 = worldAt(pressAt || p); const a = tileAt(w0.x, w0.y);
        ui.stroke = { a, last: a, p };
        ui.tool.strokeStart(a, held);
        strokeTo(p);
      }
    },
    dragmove: (p, dx, dy) => { if (ui.stroke) strokeTo(p); else { cam.panBy(dx, dy); loop.poke(); } },
    dragend: (p, cancelled, vx, vy) => {
      if (ui.stroke) {
        ui.stroke = null; loupe.hide();
        r.setOverlay('preview', null);
        if (ui.tool) { ui.tool.strokeEnd(!!cancelled); showHint(); renderBar(); }
        loop.poke();
        return;
      }
      if (!cancelled) { cam.vx = -(vx || 0) / cam.zoom; cam.vy = -(vy || 0) / cam.zoom; }
    },
    pinch: (f, cx, cy, dcx, dcy) => {
      if (ui.stroke) { ui.stroke = null; loupe.hide(); r.setOverlay('preview', null); if (ui.tool) ui.tool.strokeEnd(true); }
      ui.follow = null;
      cam.zoomAt(f, cx, cy); cam.panBy(dcx, dcy); loop.poke();
    },
    wheel: (dy, p) => { cam.zoomAt(Math.exp(-dy * 0.0015), p.x, p.y); loop.poke(); },
  });

  // ---- minimap ---------------------------------------------------------------------------------------
  const miniCv = mini.querySelector('canvas');
  onTap(mapBtn, () => { ui.map = !ui.map; mini.hidden = !ui.map; mapBtn.classList.toggle('on', ui.map); loop.poke(); });
  mini.addEventListener('pointerdown', (e) => {
    const rc = miniCv.getBoundingClientRect();
    centerOn(((e.clientX - rc.left) / rc.width) * W * TILE, ((e.clientY - rc.top) / rc.height) * H * TILE);
  });
  function drawMini() {
    const sz = 160, dpr = Math.min(2, devicePixelRatio || 1);
    if (miniCv.width !== sz * dpr) { miniCv.width = miniCv.height = sz * dpr; }
    if (r.drawMinimap) { r.drawMinimap(miniCv, {}); return; }
    const g = miniCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    if (r.minimap) g.drawImage(r.minimap, 0, 0, miniCv.width, miniCv.height);
  }

  // ---- autosave (11.4; A's lifecycle saves on hide) --------------------------------------------------
  // a fallen hold is saved once, by A's checkFall (its final state); the autosave never touches it, so the
  // older slot keeps the pre-fall copy that Recover from a device problem may need
  const autosave = setInterval(() => { if (!doc.hidden && !isFallen(s)) api.saveNow().catch(() => null); }, (SAVE.autosaveSec || 60) * 1000);

  // ---- the context handed to the menus, tools and sheets -----------------------------------------------
  const ctx = {
    s, r, cam, ui,
    send, toast: (t, tone) => toast.show(t, tone),
    openSheet, closeSheet, refreshSheet: () => renderSheet(true), back, sheetTab: () => (cur ? cur.tab : null),
    openPanel, closePanel, reopenPanel: () => { if (ui.panel) { renderPanel(); syncChrome(); } },
    startTool, endTool, refreshBar: () => renderBar(), hint: () => showHint(), redraw: () => loop.poke(),
    setStripes: (v) => r.setOverlay('stripes', v && v.length ? v : null),
    select, closePeek, centerOn, portrait,
    follow: (id) => { ui.follow = id; if (id !== null) toast.show('Following. Pan the map to stop.'); loop.poke(); },
    following: () => ui.follow,
    isLand: () => ui.landscape,
    quit: () => { shell.destroy(); api.quit(); },
    get prevColonist() { return ui.prevColonist; },
    openColony: (tab) => openColony(ctx, tab),
    draftAll: () => draftAll(ctx),
    orderLine: (ids, target) => { orderLines = { ids: ids.slice(), target, t0: performance.now() }; loop.poke(); },
    get speed() { return ui.speed; },
    settings: () => (api.readSettings ? api.readSettings() : {}),
    openColonist: (id, tab) => { const c = s.col.find((x) => x.id === id); if (c) { centerOn(c.x, c.y); select({ kind: 'colonist', id: c.id }); openSubjectSheet(ctx, { kind: 'colonist', id: c.id }, tab); } },
    openTrade: (id) => openTrade(ctx, id),
    openDemand: () => openDemand(ctx, letterHooks),
    get letters() { return letters; },
  };

  // ---- the coach (10.9), the Dawn Ledger (10.10), alerts and threats (10.6): checked once a second ----
  const guide = mountGuide(root, ctx);
  const ledger = mountLedger(root, ctx, {
    coachDone: () => guide.ended(), alerts: () => tracker.list(),
    // "Carry on" after a resume plays on at 1x (play-test: the resumed game otherwise stayed paused with no hint why)
    carryOn: () => { if (resumePaused && ui.speed === 0) { setSpeed(1); speed.render(); } resumePaused = false; },
  });
  const prompts = mountPrompts(root, ctx, api);
  // system intros (10.9): one card the first time each Stage 2 system matters, after the coach
  const intros = mountIntros(root, ctx, { coachDone: () => guide.ended(), busy: () => !!(ui.sheet || ui.tool || ledger.open || ui.panel || (prompts.el && !prompts.el.hidden)) });
  // letters (Stage 2): the auto-pause setting holds the game while a letter waits on screen (10.6)
  const letterHooks = {
    pause: () => {
      const st = api.readSettings ? api.readSettings() : {};
      if (!st.autoPauseLetter || ui.speed === 0) return null;
      const was = ui.speed; setSpeed(0); speed.render();
      return () => { if (ui.speed === 0) { setSpeed(was); speed.render(); } };
    },
  };
  const letters = mountLetters(ctx, letterHooks);
  const openLetterNow = (l) => openChoice(ctx, l, letterHooks);
  // downed: pause with the setting on (10.9 auto-pause rules); the C8 'downed' event
  const offDowned = onEvent('downed', () => { const st = api.readSettings ? api.readSettings() : {}; if (st.autoPauseDowned && ui.speed > 0) { setSpeed(0); speed.render(); toast.show('Someone is down: paused.', 'bad'); } });
  const watch = threatWatch(s);
  let letterSpeed = null;
  function onThreat(ev) {
    const v = ev.view;
    if (ev.kind === 'omen') {
      // the omen letter pauses the game; closing it resumes the speed it had (10.6 auto-pause)
      if (ui.tool) endTool();
      // a home-screen or backup prompt steps aside for the omen (X 2.7: both stood side by side)
      if (prompts.open) prompts.hide();
      if (intros.open) intros.hide(false);
      letterSpeed = ui.speed || letterSpeed || 1;
      setSpeed(0); speed.render();
      audioCue('bell');
      omenLetter(ctx, v, { first: firstOmen(s), onClose: () => { if (letterSpeed !== null && ui.speed === 0) { setSpeed(letterSpeed); speed.render(); } letterSpeed = null; } });
    } else if (ev.kind === 'imminent') {
      // Imminent drops the game to 1x, or pauses it with the setting on (9.4)
      const pause = !!(api.readSettings && api.readSettings().autoPauseImminent);
      if (pause && ui.speed > 0) { setSpeed(0); speed.render(); }
      else if (ui.speed > 1) { setSpeed(1); speed.render(); }
      toast.show(`${v.name} in ${v.hours} h from the ${v.edge ? v.edge.word : 'edge'}. ${imminentAdvice(v)}`, 'bad');
    } else if (ev.kind === 'active') {
      if (ui.speed > 1) { setSpeed(1); speed.render(); }
      toast.show(`${v.name} is here: ${v.onMap || ''} on the map.`.replace(': on', ' on'), 'bad');
    } else if (ev.kind === 'end') {
      // another raid still on the map or about to come: say only that this one is over (no "undraft")
      const more = s.raids.some((r) => r.stage === 'active' || r.stage === 'imminent');
      toast.show(more ? `${v.name || 'The raid'} is over. Another threat is still near.` : endText(v));
    }
    dirtyChrome = true;
  }
  function audioCue() { /* D's bell and horn play from C8 events (fx/audio); nothing extra here */ }
  // ---- earned perks (3.1): a toast for each new perk line of the Chronicle (perks send no letter) ----------
  let chronSeen = s.chron.length ? s.chron[s.chron.length - 1] : null;
  function perkToasts() {
    const c = s.chron;
    if (!c.length || c[c.length - 1] === chronSeen) return;
    const fresh = [];
    for (let k = c.length - 1; k >= 0 && c[k] !== chronSeen; k--) {
      if (chronSeen && c[k][0] < chronSeen[0]) break;
      if (c[k][2] === 'chron_perk' && c[k][3]) fresh.push(c[k][3]);
    }
    chronSeen = c[c.length - 1];
    for (const a of fresh.reverse()) toast.show(`${a.name} has learned ${a.perk}${a.why ? ': ' + a.why : ''}.`, 'good');
  }

  // ---- the fall and the ruin viewer (1.3) ----------------------------------------------------------------
  const ruinTag = h('button.ec-chip.ec-ruin-tag', { type: 'button', 'data-act': 'ruin-tag', hidden: true });
  top.querySelector('.ec-top-flex').append(ruinTag);
  onTap(ruinTag, () => toast.show(`${s.name}: ${fellLine(s.colony.fallenAt)}. ${RUIN_TEXT.readOnly}`));
  /** Turn the shell into the read-only ruin viewer; fresh: the colony fell just now (stinger and the final screen). */
  function enterRuin(fresh) {
    const was = ruin.on;
    ruin.on = true;
    if (ui.tool) endTool();
    closePanel(false);
    if (speed.isOpen) speed.close();
    setSpeed(1); speedHost.hidden = true;
    body.classList.add('ec-ruin');
    guide.el.hidden = true; body.classList.remove('has-guide');
    ledger.hide(); if (prompts.open || (prompts.el && !prompts.el.hidden)) prompts.hide(); if (intros.open) intros.hide(false);
    threat.hidden = true;
    ruinTag.hidden = false;
    ruinTag.innerHTML = `${icon('ruin')}<span class="ec-chip-t">Ruin</span>`;
    ruinTag.setAttribute('aria-label', `Ruin of ${s.name}. ${fellLine(s.colony.fallenAt)}`);
    if (!was) renderTabs();
    renderClock(); renderAlerts(); syncChrome();
    // the export files: built ahead of the tap (the share sheet must open inside it), once A's save has landed
    setTimeout(() => { if (!ruin.prep) ruin.prep = prepareRuinExport(s.id, s).catch(() => null); }, fresh ? 3000 : 200);
    if (fresh) { playDefeat(); showEnd(); }
  }
  function showEnd() {
    const sm = fallSummary(s);
    openSheet(RUIN_TEXT.title, (el) => hearthColdView(el, sm, [
      { label: RUIN_TEXT.view, sub: RUIN_TEXT.viewSub, act: 'cold-view', primary: true, fn: () => closeSheet() },
      { label: RUIN_TEXT.annals, sub: RUIN_TEXT.annalsSub, act: 'cold-annals', fn: () => openAnnals(true) },
      { label: RUIN_TEXT.export, sub: RUIN_TEXT.exportSub, act: 'cold-export', fn: () => exportRuin() },
      { label: RUIN_TEXT.leave, act: 'cold-leave', fn: () => ctx.quit() },
    ]), { help: null });
  }
  function openAnnals(backTo = false) { openSheet(RUIN_TEXT.annals, (el) => annalsView(el, s), { back: backTo }); }
  async function exportRuin() {
    toast.show('Preparing the export...');
    try {
      if (!ruin.prep) ruin.prep = prepareRuinExport(s.id, s).catch(() => null);
      let prep = await ruin.prep;
      if (!prep) { ruin.prep = null; prep = await prepareRuinExport(s.id, s); ruin.prep = Promise.resolve(prep); }
      const r = await shareRuinExport(prep);
      const t = exportedText(r);
      if (t) toast.show(t, r.ok ? '' : 'bad');
    } catch (e) { toast.show(`The export failed: ${e && e.message ? e.message : e}`, 'bad'); }
  }
  function ruinTab(id) {
    if (id === 'annals') openAnnals(false);
    else if (id === 'end') showEnd();
    else if (id === 'export') exportRuin();
    else if (id === 'leave') ctx.quit();
  }
  const onFallen = (e) => { const d = (e && e.detail) || {}; if (d.id === s.id && !ruin.on) enterRuin(true); };
  window.addEventListener('ec2:fallen', onFallen);

  function uiSecond() {
    // the fall: A's checkFall saves the final state once and fires 'ec2:fallen' (idempotent)
    if (!ruin.on && isFallen(s)) { try { checkFall(); } catch (_) { /* Node */ } if (!ruin.on) enterRuin(true); }
    if (ruin.on) { renderClock(); return; }
    perkToasts();
    guide.check();
    tracker.update(); renderAlerts(false);
    for (const ev of watch.poll()) onThreat(ev);
    ledger.check();
    letters.check(!ui.sheet && !ui.tool && !ledger.open && !ui.panel);
    if (!ui.sheet && !ui.tool && !ledger.open && !ui.panel) prompts.check();   // never over an open menu
    intros.check();
    renderThreat();
  }
  const guideT = setInterval(uiSecond, 1000);
  const onBackup = (e) => { const d = (e && e.detail) || {}; if (!d.id || d.id === s.id) prompts.showBackup(d); };
  window.addEventListener('ec2:backup', onBackup);

  // drafted orders draw a line from each colonist to its target for 1.5 s (10.2)
  let orderLines = null;
  const orderHook = (g, st, view) => {
    if (!orderLines) return;
    const age = performance.now() - orderLines.t0;
    if (age > 1500) { orderLines = null; return; }
    const k = 1 / view.z, a = 1 - age / 1500;
    const tx = orderLines.target.foe ? orderLines.target.foe.x : (orderLines.target.x + 0.5) * TILE;
    const ty = orderLines.target.foe ? orderLines.target.foe.y : (orderLines.target.y + 0.5) * TILE;
    g.save();
    g.strokeStyle = orderLines.target.foe ? `rgba(239,107,85,${a})` : `rgba(240,200,106,${a})`;
    g.lineWidth = 2.5 * k; g.setLineDash([8 * k, 6 * k]);
    for (const id of orderLines.ids) { const c = s.col.find((x) => x.id === id); if (!c) continue; g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(tx, ty); g.stroke(); }
    g.setLineDash([]); g.beginPath(); g.arc(tx, ty, 10 * k, 0, Math.PI * 2); g.stroke();
    g.restore();
    loop.poke();
  };
  BUS.draw.overlay.push(orderHook);

  // ---- go ------------------------------------------------------------------------------------------
  if (s.col.length) cam.centerOn(s.col.reduce((a, c) => a + c.x, 0) / s.col.length, s.col.reduce((a, c) => a + c.y, 0) / s.col.length, false);
  else cam.centerOn((W * TILE) / 2, (H * TILE) / 2, false);
  layout();
  loop.start();
  tracker.update(); renderAlerts(); renderThreat();
  if (ruin.on) enterRuin(false);
  else if (api.resumed) onResume();

  const shell = {
    state: s, renderer: r, camera: cam, loop, ui, speed, loupe, toast, ctx, guide, ledger, prompts, alerts: tracker, letters,
    alertGo: (id) => { const a = tracker.list().find((x) => x.id === id); if (a) alertGo(a); return !!a; },
    get ruin() { return ruin.on; }, showEnd: () => showEnd(), openAnnals: () => openAnnals(false),
    setSpeed: (v) => { setSpeed(v); speed.render(); }, resume: () => onResume(), uiSecond: () => uiSecond(),
    select, closePeek, openSubjectSheet: (sel, tab) => openSubjectSheet(ctx, sel, tab), startTool, endTool, togglePanel, openPanel,
    openMenu: () => openMenu(ctx, api), openColony: (tab) => openColony(ctx, tab),
    /** Gate and spike probe: the world rect now, and the 10.1 plan for this viewport. */
    metrics: () => ({ world: measureWorld(doc), plan: plannedWorld(innerWidth, innerHeight, safeInsets(doc)), landscape: ui.landscape, insets: safeInsets(doc) }),
    worldToScreen: (wx, wy) => { const rc = canvas.getBoundingClientRect(), p = cam.worldToScreen(wx, wy); return { x: rc.left + p.x, y: rc.top + p.y }; },
    /** Screen point (page px) of the centre of tile (x, y). */
    tileToScreen: (x, y) => { const rc = canvas.getBoundingClientRect(), p = cam.worldToScreen((x + 0.5) * TILE, (y + 0.5) * TILE); return { x: rc.left + p.x, y: rc.top + p.y }; },
    destroy() {
      loop.stop(); clearInterval(autosave); clearInterval(guideT); guide.destroy(); clearTimeout(stockT); r.dispose(); input.reset();
      letters.destroy(); offDowned(); window.removeEventListener('ec2:settings', onSettings);
      { const k = BUS.draw.overlay.indexOf(orderHook); if (k >= 0) BUS.draw.overlay.splice(k, 1); }
      window.removeEventListener('ec2:backup', onBackup);
      window.removeEventListener('ec2:fallen', onFallen);
      ledger.el.remove(); prompts.el.remove(); intros.destroy();
      if (drawHook) { const k = BUS.draw.overlay.indexOf(drawHook); if (k >= 0) BUS.draw.overlay.splice(k, 1); drawHook = null; }
      window.removeEventListener('resize', layout);
      window.removeEventListener('ec2:resume', onResume);
      if (window.visualViewport) visualViewport.removeEventListener('resize', layout);
      speed.close(); speed.fan.remove(); speed.scrim.remove();
      toast.clear(); clear(root); root.classList.add('hidden');
      body.classList.remove('ec-game', 'ec-ruin', 'land', 'narrow', 'paused', 'rail-hidden', 'has-peek', 'has-panel', 'has-sheet', 'tooling', 'has-ledger', 'has-prompt');
      // a fresh canvas drops the gesture listeners and the 2D context with the old one
      const fresh = canvas.cloneNode(false); fresh.classList.remove('ec-world'); fresh.width = fresh.height = 0;
      canvas.replaceWith(fresh);
    },
  };
  return shell;
}
