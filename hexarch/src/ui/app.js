// ===== app.js : HUD, selection, turn flow =====
const $ = id => document.getElementById(id);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const k in props) {
    const v = props[k];
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

const UI = { G: null, pid: 0, sel: null, preview: -1, busy: false, autoSlot: null };
let renderer = null;

function yieldsText(y) { return `🌾${y.f}  ⚙️${y.p}  💰${y.g}`; }
function humanCiv() { return CIVS[UI.G.players[UI.pid].civ]; }

// ---------- toasts ----------
function toast(msg, tile, ms) {
  const box = $('toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const el = h('div', { class: 'toast', onclick: () => { if (tile >= 0 && UI.G) renderer.centerOn(tile, true); el.remove(); } }, msg);
  box.append(el);
  setTimeout(() => el.remove(), ms || 3800);
}
function flushLog() {
  const G = UI.G; if (!G) return;
  const items = [];
  for (let i = G.uiLogIdx; i < G.log.length; i++) { const e = G.log[i]; if (e.pid === UI.pid || e.pid === -1) items.push(e); }
  G.uiLogIdx = G.log.length;
  items.slice(-3).forEach((e, k) => setTimeout(() => toast(e.msg, e.tile), k * 250));
}

// ---------- HUD ----------
function updateHUD() {
  const G = UI.G; if (!G) return;
  const civ = humanCiv();
  document.querySelector('#civBadge .dot').style.background = civ.color;
  document.querySelector('#civBadge .nm').textContent = civ.name;
  $('turnInfo').textContent = `Turn ${G.turn}/${G.cfg.turnLimit}`;
  const nc = G.cities.filter(c => c.owner === UI.pid).length, nu = G.units.filter(u => u.owner === UI.pid).length;
  $('topStats').textContent = `🏛 ${nc}  👥 ${nu}`;
  const idle = UI.busy ? [] : HX.unitsNeedingOrders(G, UI.pid);
  const bn = $('btnNext');
  bn.textContent = idle.length ? `Next unit (${idle.length})` : 'All units moved';
  bn.disabled = UI.busy || !idle.length;
  $('btnEnd').disabled = UI.busy;
  $('btnEnd').textContent = UI.busy ? 'Waiting…' : 'End turn';
  $('turnbar').classList.toggle('left', Settings.get('hand') === 'left');
  $('busy').hidden = !UI.busy;
}

function setSel(sel, center) {
  UI.sel = sel; UI.preview = -1;
  const G = UI.G;
  renderer.path = null; renderer.reach = null; renderer.selTile = -1;
  if (sel) {
    if (sel.k === 'unit') {
      const u = HX.unitById(G, sel.id);
      if (!u) { UI.sel = null; return setSel(null); }
      renderer.selTile = u.tile;
      if (u.owner === UI.pid && u.moves > 0 && !UI.busy) renderer.reach = HX.reachableTiles(G, u);
      if (u.order && u.order.t === 'goto') {
        const p = HX.findPath(G, u, u.order.dest);
        if (p) renderer.path = { from: u.tile, steps: p, ok: true };
      }
      if (center && !renderer.isOnScreen(u.tile)) renderer.centerOn(u.tile, true);
    } else if (sel.k === 'city') {
      const c = HX.cityById(G, sel.id); renderer.selTile = c ? c.tile : sel.t;
    } else renderer.selTile = sel.t;
  }
  renderSel(); updateHUD(); renderer.request();
}

function selectNextUnit(center) {
  const G = UI.G, idle = HX.unitsNeedingOrders(G, UI.pid);
  if (!idle.length) { setSel(null); return false; }
  let k = 0;
  if (UI.sel && UI.sel.k === 'unit') { const i = idle.findIndex(u => u.id === UI.sel.id); if (i >= 0) k = (i + 1) % idle.length; }
  setSel({ k: 'unit', id: idle[k].id }, center !== false);
  return true;
}

function orderLabel(G, u) {
  const o = u.order; if (!o) return u.skip ? 'Skipping this turn' : (u.moves > 0 ? 'Awaiting orders' : 'No moves left');
  if (o.t === 'goto') { const p = HX.findPath(G, u, o.dest); return p && p.length ? `Moving, arrives in ${p[p.length - 1].turn + 1} turn${p[p.length - 1].turn ? 's' : ''}` : 'Moving'; }
  return { fortify: 'Fortified', sleep: 'Sleeping', explore: 'Exploring automatically' }[o.t] || o.t;
}

function renderSel() {
  const box = $('sel'), G = UI.G, s = UI.sel;
  if (!s || !G) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const close = h('button', { class: 'icon x', 'aria-label': 'Close', onclick: () => setSel(null) }, '✕');
  if (s.k === 'unit') return renderUnitPanel(box, HX.unitById(G, s.id), close);
  if (s.k === 'city') return renderCityPanel(box, HX.cityById(G, s.id), s, close);
  return renderTilePanel(box, s.t, close);
}

function renderUnitPanel(box, u, close) {
  const G = UI.G, U = UNITS[u.type], P = G.players[u.owner], civ = CIVS[P.civ], own = u.owner === UI.pid;
  const head = h('div', { class: 'hd' },
    h('div', { class: 'gl', style: `background:${civ.color}` }, U.glyph),
    h('div', null, h('div', { class: 'tt' }, (own ? '' : civ.adj + ' ') + U.name),
      h('div', { class: 'st' }, own ? `Moves ${u.moves}/${U.moves}` + (U.strength ? ` · Str ${U.strength}` : '') + ` · ${TERRAIN[G.map.terrain[u.tile]].name}` : `Strength ${U.strength || 0} · ${civ.name}`),
      own ? h('div', { class: 'st' }, orderLabel(G, u)) : null),
    close);
  const kids = [head];
  if (own && !UI.busy) {
    const acts = [];
    if (UI.preview >= 0) {
      const p = HX.findPath(G, u, UI.preview);
      const n = p && p.length ? p[p.length - 1].turn + 1 : 0;
      acts.push(h('button', { class: 'pri', onclick: () => doMove(u, UI.preview) }, n > 1 ? `Move here (${n} turns)` : 'Move here'));
      acts.push(h('button', { onclick: () => setSel({ k: 'unit', id: u.id }) }, 'Cancel'));
      const other = HX.unitsAt(G, UI.preview).find(o => o.owner === UI.pid);
      if (other) acts.push(h('button', { onclick: () => setSel({ k: 'unit', id: other.id }) }, 'Select ' + UNITS[other.type].name));
      kids.push(h('div', { class: 'info' }, 'Tap the tile again or press Move here.'));
    } else {
      if (U.founds) {
        const chk = HX.canFoundCity(G, u);
        acts.push(h('button', { class: 'pri', disabled: !chk.ok, onclick: () => doFound(u) }, 'Found city'));
        if (!chk.ok) kids.push(h('div', { class: 'why' }, chk.why));
        else kids.push(h('div', { class: 'info' }, `Site value ${HX.siteScore(G.map, G._grid, u.tile).toFixed(0)}. Food, production, fresh water and coast raise it.`));
      }
      if (u.order) {
        acts.push(h('button', { onclick: () => doOrder(u, 'wake') }, u.order.t === 'goto' ? 'Cancel move' : 'Wake'));
      } else {
        if (U.recon || !U.founds) acts.push(h('button', { onclick: () => doOrder(u, 'explore') }, 'Explore'));
        if (U.canFortify) acts.push(h('button', { onclick: () => doOrder(u, 'fortify') }, 'Fortify'));
        else acts.push(h('button', { onclick: () => doOrder(u, 'sleep') }, 'Sleep'));
        if (u.moves > 0) acts.push(h('button', { onclick: () => doOrder(u, 'skip') }, 'Skip'));
      }
      acts.push(h('button', { class: 'danger icon', 'aria-label': 'Disband', onclick: () => confirmDlg('Disband unit?', `The ${U.name} will be removed permanently.`, 'Disband', () => { HX.disbandUnit(G, u); setSel(null); selectNextUnit(); }, true) }, '🗑'));
    }
    kids.push(h('div', { class: 'acts' }, acts));
  }
  box.replaceChildren(...kids);
}

function renderCityPanel(box, c, s, close) {
  const G = UI.G, P = G.players[UI.pid];
  const mem = c && P._vis[c.tile] ? { o: c.owner, n: c.name, p: c.pop, cap: c.capital } : P.seen[s.t];
  if (!mem) return renderTilePanel(box, s.t, close);
  const civ = CIVS[G.players[mem.o].civ], own = mem.o === UI.pid;
  const kids = [h('div', { class: 'hd' },
    h('div', { class: 'gl', style: `background:${civ.color}` }, '🏛'),
    h('div', null, h('div', { class: 'tt' }, (mem.cap ? '★ ' : '') + mem.n), h('div', { class: 'st' }, `${civ.name} · Population ${mem.p}` + (mem.cap ? ' · Capital' : ''))),
    close)];
  if (own && c) {
    const y = HX.cityYieldPotential(G, c);
    kids.push(h('div', { class: 'info' }, `Founded turn ${c.founded}. Territory `, h('b', null, `${c.tiles.length} tiles`), '.'));
    kids.push(h('div', { class: 'info' }, 'Territory yields ', h('b', null, yieldsText(y))));
  } else if (!P._vis[s.t]) kids.push(h('div', { class: 'info' }, 'Last seen information. Send a unit to update it.'));
  box.replaceChildren(...kids);
}

function renderTilePanel(box, t, close) {
  const G = UI.G, P = G.players[UI.pid], m = G.map;
  if (!P.explored[t]) {
    box.replaceChildren(h('div', { class: 'hd' }, h('div', { class: 'gl', style: 'background:#111' }, '❔'), h('div', null, h('div', { class: 'tt' }, 'Unexplored'), h('div', { class: 'st' }, 'Send a unit to reveal this area.')), close));
    return;
  }
  const TT = TERRAIN[m.terrain[t]], y = HX.tileYield(m, t);
  const name = m.lake[t] ? 'Lake' : TT.name;
  const lines = [h('div', { class: 'info' }, 'Yields ', h('b', null, yieldsText(y)))];
  const extra = [];
  if (m.res[t] >= 0) { const R0 = RES[m.res[t]]; extra.push(`${R0.glyph} ${R0.name} (${R0.kind})`); }
  if (m.river[t]) extra.push('River');
  if (TT.land && !TT.impassable) extra.push(`Move cost ${TT.move}`);
  if (TT.impassable) extra.push('Impassable');
  if (TT.water) extra.push('Water: needs boats (later build)');
  if (TT.def) extra.push(`${TT.def > 0 ? '+' : ''}${TT.def}% defense`);
  if (extra.length) lines.push(h('div', { class: 'info' }, extra.join(' · ')));
  const o = m.owner[t];
  if (o >= 0) lines.push(h('div', { class: 'info' }, 'Territory of ', h('b', null, CIVS[G.players[o].civ].name)));
  if (!P._vis[t]) lines.push(h('div', { class: 'info' }, 'Not currently in view.'));
  box.replaceChildren(h('div', { class: 'hd' }, h('div', { class: 'gl', style: `background:${TT.color}` }, m.res[t] >= 0 ? RES[m.res[t]].glyph : ''),
    h('div', null, h('div', { class: 'tt' }, name), h('div', { class: 'st' }, TT.land ? 'Land' : 'Water')), close), ...lines);
}

// ---------- actions ----------
function afterUnitAction(u, delay) {
  setTimeout(() => {
    if (!UI.G) return;
    const still = HX.unitById(UI.G, u.id);
    if (Settings.get('autoCycle') && (!still || !HX.unitsNeedingOrders(UI.G, UI.pid).includes(still))) {
      if (!selectNextUnit()) setSel(null);
    } else setSel(still ? { k: 'unit', id: still.id } : null);
    flushLog();
  }, delay || 0);
}
function doMove(u, dest) {
  const G = UI.G, from = u.tile;
  const steps = HX.issueMove(G, u, dest);
  UI.preview = -1; renderer.path = null; renderer.reach = null;
  const dur = renderer.animate(u.id, [from, ...steps]);
  renderSel(); updateHUD();
  afterUnitAction(u, dur + 60);
}
function doOrder(u, o) {
  const from = u.tile;
  const steps = HX.setOrder(UI.G, u, o);
  const dur = steps.length ? renderer.animate(u.id, [from, ...steps]) : 0;
  afterUnitAction(u, dur + 40);
}
function doFound(u) {
  const c = HX.foundCity(UI.G, u);
  if (c) { flushLog(); afterUnitAction(u, 300); }
}

// ---------- map taps ----------
function selectionOptions(t) {
  const G = UI.G, P = G.players[UI.pid], opts = [];
  const vis = P._vis[t];
  const mil = G._mil.get(t), civ = G._civ.get(t);
  if (mil && (mil.owner === UI.pid || vis)) opts.push({ k: 'unit', id: mil.id });
  if (civ && (civ.owner === UI.pid || vis)) opts.push({ k: 'unit', id: civ.id });
  if (P.seen[t]) opts.push({ k: 'city', id: P.seen[t].id, t });
  opts.push({ k: 'tile', t });
  return opts;
}
function sameSel(a, b) { return a && b && a.k === b.k && (a.k === 'tile' ? a.t === b.t : a.id === b.id); }
function onTap(t) {
  const G = UI.G; if (!G || t < 0) return;
  const s = UI.sel;
  if (!UI.busy && s && s.k === 'unit') {
    const u = HX.unitById(G, s.id);
    if (u && u.owner === UI.pid && t !== u.tile) {
      const opts = selectionOptions(t);
      const ownThere = opts.some(o => o.k === 'unit' && HX.unitById(G, o.id).owner === UI.pid && isCivilianUnit(HX.unitById(G, o.id)) === isCivilianUnit(u));
      if (!ownThere) {
        if (UI.preview === t) return doMove(u, t);
        const path = HX.findPath(G, u, t);
        if (!path || !path.length) { toast('No known route to that tile.'); return; }
        UI.preview = t; renderer.path = { from: u.tile, steps: path, ok: true };
        renderSel(); renderer.request(); return;
      }
    }
  }
  const opts = selectionOptions(t);
  let k = opts.findIndex(o => sameSel(o, s));
  const next = k >= 0 ? opts[(k + 1) % opts.length] : opts[0];
  setSel(next);
}
function onLongPress(t) {
  if (!UI.G || t < 0) return;
  if (navigator.vibrate) navigator.vibrate(10);
  setSel({ k: 'tile', t });
}

// ---------- turn flow ----------
function beginHumanTurnUI(first) {
  const G = UI.G;
  autosave();
  updateHUD();
  flushLog();
  if (!selectNextUnit(true)) setSel(null);
  if (first) {
    const s = G.units.find(u => u.owner === UI.pid && UNITS[u.type].founds) || G.cities.find(c => c.owner === UI.pid);
    if (s) renderer.centerOn(s.tile, false);
  }
}
function endTurn() {
  const G = UI.G; if (!G || UI.busy) return;
  const idle = HX.unitsNeedingOrders(G, UI.pid);
  if (idle.length && Settings.get('confirmEnd')) {
    return confirmDlg('End turn?', `${idle.length} unit${idle.length > 1 ? 's' : ''} still ${idle.length > 1 ? 'have' : 'has'} moves left.`, 'End turn', reallyEndTurn);
  }
  reallyEndTurn();
}
function reallyEndTurn() {
  setSel(null);
  HX.endPlayerTurn(UI.G);
  runRivals();
}
// Run computer players one at a time, yielding to the browser between them so the phone never freezes.
function runRivals() {
  const G = UI.G;
  UI.busy = true; updateHUD();
  const step = () => {
    if (UI.G !== G) return;
    if (G.players[G.active].human) { UI.busy = false; renderer.request(); beginHumanTurnUI(); return; }
    HX.aiTakeTurn(G, G.active);
    HX.endPlayerTurn(G);
    renderer.request();
    setTimeout(step, 30);
  };
  setTimeout(step, 60);
}
function autosave() {
  const slot = Saves.pickAutoSlot();
  UI.autoSlot = slot;
  const err = Saves.write(slot, UI.G, UI.pid);
  if (err) toast(err);
}

function enterGame(G) {
  UI.G = G; UI.pid = Math.max(0, G.players.findIndex(p => p.human)); UI.sel = null; UI.busy = false;
  renderer.setGame(G, UI.pid);
  closeScreens(); $('hud').hidden = false;
  beginHumanTurnUI(true);
  if (!G.players[G.active].human) runRivals();
}
function leaveGame() { UI.G = null; $('hud').hidden = true; renderer.G = null; renderer.request(); }

function makeTouchIcon() {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 180; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, '#16263a'); g.addColorStop(1, '#070a0e');
    x.fillStyle = g; x.fillRect(0, 0, 180, 180);
    const cols = ['#e2b544', '#5b84dc', '#62c44c', '#e46a3c', '#2db7a6', '#b85aa6', '#a99b52'];
    const pos = [[90, 90], [90 + 44, 90], [90 - 44, 90], [90 + 22, 90 - 38], [90 - 22, 90 - 38], [90 + 22, 90 + 38], [90 - 22, 90 + 38]];
    pos.forEach(([px, py], k) => { x.beginPath(); hexPath(x, px, py, 24); x.fillStyle = cols[k]; x.fill(); x.strokeStyle = '#0b1016'; x.lineWidth = 3; x.stroke(); });
    $('touchicon').setAttribute('href', c.toDataURL('image/png'));
  } catch (e) { /* icon is cosmetic */ }
}

function boot() {
  renderer = new Renderer($('map'));
  attachMapInput($('map'), renderer, { tap: onTap, longPress: onLongPress });
  $('btnMenu').onclick = () => showPause();
  $('btnNext').onclick = () => selectNextUnit(true);
  $('btnEnd').onclick = () => endTurn();
  document.addEventListener('visibilitychange', () => { if (document.hidden && UI.G && !UI.busy && UI.autoSlot) Saves.write(UI.autoSlot, UI.G, UI.pid); });
  window.addEventListener('pagehide', () => { if (UI.G && !UI.busy && UI.autoSlot) Saves.write(UI.autoSlot, UI.G, UI.pid); });
  makeTouchIcon();
  showMainMenu();
}
