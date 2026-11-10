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

function yieldsText(y) { return `🌾${y.f}  ⚙️${y.p}  💠${y.g}`; }
function humanCiv() { return CIVS[UI.G.players[UI.pid].civ]; }
// Re-render whatever is showing after the game state changed.
function refreshAll() { if (!UI.G) return; renderSel(); updateHUD(); renderer.request(); }

// ---------- toasts ----------
function toastEl(msg, onTap) { return h('div', { class: 'toast tap', onclick: e => { e.currentTarget.remove(); onTap(); } }, msg); }
function toast(msg, tile, ms) {
  const box = $('toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  const el = h('div', { class: 'toast', onclick: () => { if (tile >= 0 && UI.G) renderer.centerOn(tile, true); el.remove(); } }, msg);
  box.append(el);
  setTimeout(() => el.remove(), ms || 3800);
}
// One sound per batch of events, the most important first.
const LOG_SOUNDS = [[/won a .* victory|Victory!/, null], [/declared war/, 'war'], [/completed the|is complete in/, 'wonder'], [/Peace with|made peace/, 'peace'],
  [/Research complete/, 'tech'], [/adopted|Synergy/i, 'policy'], [/level \d+!|Communion|Lattice|Lineage/, 'faith'], [/captured|was destroyed|lost/i, 'boom'],
  [/Artifact found|Supply pod|Crash Site|Precursor Ruins|Echo Vault/, 'wonder'], [/launched/, 'sail'], [/has finished/, 'build'], [/Deal with/, 'deal'], [/has grown/, 'grow']];
function logSound(msgs) {
  for (const [re, name] of LOG_SOUNDS) if (msgs.some(m => re.test(m))) { if (name) Sound.play(name); return; }
}
function flushLog() {
  const G = UI.G; if (!G) return;
  const items = [];
  for (let i = G.uiLogIdx; i < G.log.length; i++) { const e = G.log[i]; if (e.pid === UI.pid || e.pid === -1) items.push(e); }
  G.uiLogIdx = G.log.length;
  logSound(items.map(e => e.msg));
  const show = items.length > 3 ? items.slice(-2) : items;
  show.forEach((e, k) => setTimeout(() => toast(e.msg, e.tile), k * 250));
  if (items.length > 3) setTimeout(() => { const el = toastEl(`${items.length - 2} more events. Tap to open the log.`, () => showLog()); $('toasts').append(el); setTimeout(() => el.remove(), 4500); }, 520);
}

// ---------- HUD ----------
function lensMode() { const v = Settings.get('lens'); return v === true || v === 'yields' ? 'yields' : 'off'; }
function fmtN(n) { return String(Math.round(n)); }
function fmtSigned(n) { n = Math.round(n); return (n >= 0 ? '+' : '') + n; }
function fmtMoves(m) { const v = m / MP; return Number.isInteger(v) ? String(v) : v.toFixed(1); }
// What must the player do before ending the turn? Returns null or {label, act}.
function turnBlocker() {
  const G = UI.G, P = G.players[UI.pid];
  if (HX.pendingDraft(G, UI.pid)) return { label: 'Choose a boon', act: () => showPendingDraft() };
  if (HX.pendingStory(G, UI.pid)) return { label: 'Answer the council', act: () => showPendingStory() };
  if (!P.landed && P.landing && P.landing.length > 1 && !G.cities.some(c => c.owner === UI.pid)) return { label: 'Choose landing site', act: () => showLandfall() };
  if (!P.research && HX.availableTechs(P).length) return { label: 'Choose research', act: () => showTech() };
  const idle = HX.ownCities(G, UI.pid).find(c => !c.build && !c.auto);
  if (idle) return { label: 'Choose production', act: () => showCity(idle) };
  return null;
}
function updateHUD() {
  const G = UI.G; if (!G) return;
  // units that could upgrade right now get a badge on the map
  renderer.upgradable = new Set(G.units.filter(u => u.owner === UI.pid && UNITS[u.type].upg && (u => { const i = HX.upgradeInfo(G, u); return i && i.ok; })(u)).map(u => u.id));
  const P = G.players[UI.pid], rep = HX.civReport(G, UI.pid);
  UI.rep = rep;
  $('stGold').replaceChildren('💠', h('span', null, fmtN(P.gold)), h('span', { class: rep.goldNet >= 0 ? 'pos' : 'neg' }, fmtSigned(rep.goldNet)));
  const sci = $('stSci');
  if (P.research) {
    const n = HX.researchTurns(G, UI.pid, P.research, rep.sci);
    sci.replaceChildren('🔬', h('span', null, `${TECHS[TECHI[P.research]].name} · ${n === Infinity ? '∞' : n}`));
  } else sci.replaceChildren('🔬', h('span', null, HX.availableTechs(P).length ? 'Choose research' : 'All researched'));
  sci.classList.toggle('warn', !P.research && HX.availableTechs(P).length > 0);
  const hp = rep.hap.net;
  $('stHap').replaceChildren(G.players[UI.pid].golden > G.turn ? '✨' : hp >= 0 ? '🙂' : hp > -10 ? '😟' : '😡', h('span', { class: hp >= 0 ? 'pos' : 'neg' }, String(hp)));
  $('turnInfo').replaceChildren(h('div', null, `T${G.turn}`), h('div', null, `/${G.cfg.turnLimit}`));
  const idle = UI.busy ? [] : HX.unitsNeedingOrders(G, UI.pid);
  const bn = $('btnNext');
  bn.textContent = idle.length ? `Next unit (${idle.length})` : 'All units moved';
  bn.disabled = UI.busy || !idle.length;
  const be = $('btnEnd'), blk = UI.busy ? null : turnBlocker();
  be.disabled = UI.busy;
  be.textContent = UI.busy ? 'Waiting…' : blk ? blk.label : 'End turn';
  $('turnbar').classList.toggle('left', Settings.get('hand') === 'left');
  $('busy').hidden = !UI.busy;
  $('btnLens').classList.toggle('on', lensMode() !== 'off');
  $('btnLens').textContent = '👁️';
  document.querySelector('#btnDip .pip').hidden = !G.offers.some(o => o.to === UI.pid);
  updateQuestBtn(G);
  document.querySelector('#btnFaith .pip').hidden = !HX.pendingStory(G, UI.pid);
  const pa = HX.primaryAff(P); $('btnFaith').firstChild.textContent = pa ? HX.AFFINITIES.find(a => a.key === pa).glyph : '🧬';
  const st = P.policies.length < 32 ? HX.policyCost(G, UI.pid) : Infinity;
  document.querySelector('#btnPolicy .pip').hidden = !(P.culturePool >= st && VIRTUE_TREES.some(tr => tr.virtues.some(p => HX.policyStatus(G, UI.pid, p.key).ok)));
  const info = new Map();
  for (const { c, r } of rep.cities) {
    const need = HX.growthNeed(G, c.pop);
    info.set(c.id, { grow: c.food / need, prod: c.build ? (typeof itemGlyph === 'function' ? itemGlyph(c.build) : '⚙️') : '❗', turns: c.build ? prodTurns(c, r) : '' });
  }
  renderer.cityInfo = info;
}

function setSel(sel, center) {
  setTimeout(checkTips, 250);
  UI.sel = sel; UI.preview = -1; UI.attack = null;
  const G = UI.G;
  renderer.path = null; renderer.reach = null; renderer.selTile = -1; renderer.cityFocus = null;
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
      if (c && c.owner === UI.pid) renderer.cityFocus = c;
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
  if (o.t === 'dig') return `Excavating: ${o.left} turn${o.left === 1 ? '' : 's'} left`;
  return { fortify: 'Fortified', sleep: 'Sleeping', explore: 'Exploring automatically', auto: 'Working automatically', heal: 'Healing' }[o.t] || o.t;
}

function renderSel() {
  const box = $('sel'), G = UI.G, s = UI.sel;
  box.classList.toggle('manage', !!UI.manage);
  if (UI.manage && G) return renderManagePanel(box, HX.cityById(G, UI.manage));
  if (!s || !G) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const close = h('button', { class: 'icon x', 'aria-label': 'Close', onclick: () => setSel(null) }, '✕');
  if (s.k === 'unit') {
    const u = HX.unitById(G, s.id);
    if (!u) { UI.sel = null; renderer.selTile = -1; renderer.reach = null; box.hidden = true; box.replaceChildren(); return; }
    return renderUnitPanel(box, u, close);
  }
  if (s.k === 'city') return renderCityPanel(box, HX.cityById(G, s.id), s, close);
  return renderTilePanel(box, s.t, close);
}

// The map icon as a small image for panels; emoji for anything without an icon.
function unitPortrait(type) {
  if (!UNIT_ICON[type]) return UNITS[type].glyph;
  const dpr = Math.min(2, window.devicePixelRatio || 1), c = iconCanvas(UNIT_ICON[type], 15, dpr, unitTint(type));
  c.style.width = c.style.height = (c.width / dpr) + 'px'; c.className = 'portrait'; return c;
}
function renderUnitPanel(box, u, close) {
  const G = UI.G, U = UNITS[u.type], P = G.players[u.owner], civ = CIVS[P.civ], own = u.owner === UI.pid;
  const head = h('div', { class: 'hd' },
    h('div', { class: 'gl', style: `background:${civ.color}` }, unitPortrait(u.type)),
    h('div', null, h('div', { class: 'tt' }, (own ? '' : civ.adj + ' ') + U.name),
      h('div', { class: 'st' }, own ? (U.orbital ? 'Waiting on the launch pad' : `Moves ${fmtMoves(u.moves)}/${fmtMoves(HX.maxMoves(G, u))}` + (U.strength ? ` · Str ${U.strength}` : '') + (U.charges ? ` · ${u.charges} ${U.recon ? 'kit' : 'charge'}${u.charges === 1 ? '' : 's'}` : '') + ` · ${TERRAIN[G.map.terrain[u.tile]].name}` + (G.map.veil[u.tile] ? ' · Veil' : '')) : `Strength ${U.strength || 0} · ${civ.name}`),
      own ? h('div', { class: 'st' }, orderLabel(G, u)) : null),
    close);
  const kids = [head];
  if (own && UNITS[u.type].military) kids.push(militaryInfo(u));
  if (own && !UI.busy && UI.attack) { kids.push(...attackBlock(u)); box.replaceChildren(...kids); return; }
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
      // Veil feedback: warn when the route makes the unit end a turn inside the Veil
      if (p && p.length && !HX.veilImmune(G, u) && !UNITS[u.type].orbital) {
        const stops = p.filter((s, i) => (i === p.length - 1 || p[i + 1].turn !== s.turn) && G.map.veil[s.t]).length;
        if (stops) kids.push(h('div', { class: 'why veilwarn' }, `🌫️ This route ends ${stops > 1 ? stops + ' turns' : 'a turn'} in the Spore Veil: −${HX.polFx(G.players[u.owner]).veilHalf ? 5 : 10} health each time.`));
      }
    } else {
      if (U.founds) {
        const chk = HX.canFoundCity(G, u);
        acts.push(h('button', { class: 'pri', disabled: !chk.ok, onclick: () => doFound(u) }, 'Found colony'));
        if (!chk.ok) kids.push(h('div', { class: 'why' }, chk.why));
        else kids.push(h('div', { class: 'info' }, `Site value ${HX.siteScore(G.map, G._grid, u.tile).toFixed(0)}. Food, production, fresh water and coast raise it.`));
      }
      if (U.charges && !U.recon && !u.order) builderButtons(u, acts, kids);
      if (U.recon && !u.order) explorerButtons(u, acts, kids);
      if (U.orbital) satButtons(u, acts, kids);
      if (U.trade && !u.order) caravanButtons(u, acts, kids);
      if (U.military && !u.order) { const ts = HX.tameStatus(G, u); if (ts) acts.unshift(h('button', { class: 'pri', disabled: !ts.ok, onclick: () => { if (HX.tameFauna(G, u)) { Sound.play('faith'); flushLog(); refreshAll(); afterUnitAction(u, 200); } } }, `🌿 Tame ${UNITS[ts.beast.type].name} (${ts.cost}💠)`)); }
      if (G.map.veil[u.tile] && HX.veilDamage(G, u)) kids.push(h('div', { class: 'why' }, `The Veil will hurt this unit by ${HX.veilDamage(G, u)} at the start of each turn here. Communion 2, the Veil Filters promotion or a Choir of Sel commander protect against it.`));
      if (U.great && !u.order) greatButtons(u, acts, kids);
      if (U.spy && !u.order) { const opts = HX.spyOptions(G, u); if (!opts.length) kids.push(h('div', { class: 'info' }, 'Move next to a rival colony to steal a technology or sabotage its production. Agents cross any border; a caught agent angers its target.'));
        for (const o of opts) acts.push(h('button', { class: o.kind === 'steal' ? 'pri' : '', disabled: !o.ok || u.moves <= 0, onclick: () => { const r = HX.spyAct(G, u, o.city, o.kind); if (r) { Sound.play(r.ok ? 'tech' : 'error'); setSel(null); flushLog(); updateHUD(); refreshAll(); selectNextUnit(); } } }, o.label)); }
      if (U.military) militaryButtons(u, acts, kids);
      if (canUndo(u)) acts.push(h('button', { onclick: () => undoMove(u) }, '↶ Undo move'));
      if (u.order) {
        acts.push(h('button', { onclick: () => doOrder(u, 'wake') }, u.order.t === 'goto' ? 'Cancel move' : u.order.t === 'auto' ? 'Stop automation' : 'Wake'));
      } else {
        if (U.charges && !U.recon) acts.push(h('button', { onclick: () => doOrder(u, 'auto') }, 'Auto'));
        if (!U.orbital && (U.recon || (!U.founds && !U.charges && !U.trade && !U.great))) acts.push(h('button', { onclick: () => doOrder(u, 'explore') }, 'Explore'));
        if (U.canFortify) acts.push(h('button', { onclick: () => doOrder(u, 'fortify') }, 'Fortify'));
        else if (!U.orbital) acts.push(h('button', { onclick: () => doOrder(u, 'sleep') }, 'Sleep'));
        if (U.military && u.hp < 100) acts.push(h('button', { onclick: () => doOrder(u, 'heal') }, 'Heal'));
        if (u.moves > 0 && !U.orbital) acts.push(h('button', { onclick: () => doOrder(u, 'skip') }, 'Skip'));
      }
      acts.push(h('button', { class: 'danger icon', 'aria-label': 'Disband', onclick: () => confirmDlg('Disband unit?', `The ${U.name} will be removed permanently.`, 'Disband', () => { HX.disbandUnit(G, u); setSel(null); selectNextUnit(); }, true) }, '🗑'));
    }
    kids.push(h('div', { class: 'acts' }, acts));
  }
  box.replaceChildren(...kids);
}

const DIR_ARROWS = ['E', 'SE', 'SW', 'W', 'NW', 'NE'];
function gainText(add) { return [add.f ? `+${add.f}🌾` : '', add.p ? `+${add.p}⚙️` : '', add.g ? `+${add.g}💠` : '', add.s ? `+${add.s}🔬` : '', add.c ? `+${add.c}🎭` : ''].join(''); }
function builderButtons(u, acts, kids) {
  const G = UI.G, list = HX.builderActions(G, u);
  for (const a of list) {
    let label;
    if (a.kind === 'road') label = a.level === 2 ? 'Maglev' : 'Road';
    else if (a.kind === 'scour') label = '🔥 Scour the Veil';
    else if (a.kind === 'seed') label = '🌸 Seed the Veil';
    else { const I = IMPROV[a.imp]; label = `${I.name} ${gainText(I.add)}`; if (a.tile !== u.tile) label += ` (${DIR_ARROWS[G._grid.dirTo(u.tile, a.tile)]})`; }
    acts.push(h('button', { class: a.kind === 'improv' ? 'pri' : '', disabled: u.moves <= 0, onclick: () => { HX.doBuilderAction(G, u, a); afterUnitAction(u, 0); renderer.request(); } }, label));
  }
  if (!list.some(a => a.kind === 'improv')) {
    const why = HX.improvementFor(G, u.owner, u.tile).why;
    if (why) kids.push(h('div', { class: 'info' }, why));
  }
}
function caravanButtons(u, acts, kids) {
  const G = UI.G, cap = HX.routeCapacity(G, UI.pid), used = G.routes.filter(r => r.owner === UI.pid).length;
  if (used >= cap) { kids.push(h('div', { class: 'why' }, `All ${cap} convoy route slot${cap === 1 ? ' is' : 's are'} in use.`)); return; }
  acts.push(h('button', { class: 'pri', onclick: () => routeDlg(u) }, 'Open convoy route'));
}
function routeDlg(u) {
  const G = UI.G, list = HX.routeTargets(G, u).sort((a, b) => (b.y.fromG + b.y.fromS) - (a.y.fromG + a.y.fromS));
  const rows = list.map(t => {
    const own = t.city.owner === UI.pid, y = t.y;
    const gets = own ? `${t.city.name} gets +${y.toF}🌾 +${y.toP}⚙️ · ${t.from.name} +${y.fromG}💠` : `${t.from.name} gets +${y.fromG}💠` + (y.fromS ? ` +${y.fromS}🔬` : '') + (y.fromC ? ` +${y.fromC}🎭` : '') + (y.outpost ? ' and outpost influence' : '');
    return h('button', { class: 'item', onclick: () => { closeModal(); if (HX.establishRoute(G, u, t.city.id)) { flushLog(); setSel(null); selectNextUnit(); } } },
      h('div', { class: 'ic' }, own ? '🏠' : y.outpost ? '🛰️' : '🌍'), h('div', { class: 'tx' }, h('div', { class: 'a' }, t.city.name + (own ? '' : ` (${CIVS[G.players[t.city.owner].civ].adj})`)), h('div', { class: 'b' }, gets)), h('div', { class: 'tn' }, `${t.dist} tiles`));
  });
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, 'Open convoy route'),
    h('p', null, rows.length ? 'Routes last forever. Foreign routes earn more credits and can bring science; routes to outposts also build your influence there.' : 'No colony is in range. Routes reach 14 tiles over land, or farther by sea between coastal colonies once you know Marine Technology.'),
    h('div', { class: 'col', style: 'display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto' }, rows),
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Close'))));
}

function greatButtons(u, acts, kids) {
  const G = UI.G, k = UNITS[u.type].great, info = HX.GREAT[k], st = HX.greatAction(G, u);
  kids.push(h('div', { class: 'info' }, info.desc));
  if (!info.act) return;
  acts.push(h('button', { class: 'pri', disabled: !st.ok || u.moves <= 0, onclick: () => { if (HX.useGreat(G, u)) { Sound.play(k === 'merchant' ? 'deal' : k === 'artist' ? 'policy' : k === 'scientist' ? 'tech' : 'build'); setSel(null); flushLog(); updateHUD(); refreshAll(); selectNextUnit(); } } }, info.act));
  kids.push(h('div', { class: st.ok ? 'info' : 'why' }, st.ok ? st.text + '.' : st.why));
}
function explorerButtons(u, acts, kids) {
  const G = UI.G, ds = HX.digStatus(G, u), st = HX.studyStatus(G, u), site = HX.siteAt(G, u.tile);
  if (site) {
    const K = HX.SITE_KINDS[site.kind];
    kids.push(h('div', { class: ds.ok ? 'info' : 'why' }, `${K.glyph} ${K.name}. ` + (ds.ok ? `${ds.text} Takes ${ds.turns} turn${ds.turns > 1 ? 's' : ''} and one kit.` : ds.why)));
    if (ds.ok) acts.unshift(h('button', { class: 'pri', onclick: () => { if (HX.startDig(G, u)) { Sound.play('build'); flushLog(); refreshAll(); afterUnitAction(u, 100); } } }, '⛏ Excavate'));
  } else if (!st) kids.push(h('div', { class: 'info' }, `Explorers excavate crash sites, Precursor ruins and Echo Vaults, and study fauna nests from next door. ${u.charges || 0} expedition kit${u.charges === 1 ? '' : 's'} left; refill in a colony with a Field Lab.`));
  if (st) acts.unshift(h('button', { class: 'pri', disabled: !st.ok, onclick: () => { if (HX.studyNest(G, u)) { Sound.play('tech'); flushLog(); refreshAll(); afterUnitAction(u, 100); } } }, '🔍 Study nest'));
}
function satButtons(u, acts, kids) {
  const G = UI.G, S = HX.SATS[u.type], ts = HX.launchTargets(G, u);
  kids.push(h('div', { class: 'info' }, `${S.glyph} ${S.text} Orbits for ${HX.satLife(G, G.players[u.owner], u.type)} turns, covering tiles within ${S.radius}.`));
  if (!ts.length) { kids.push(h('div', { class: 'why' }, 'Satellites launch from a colony to a tile within 4 tiles.')); return; }
  acts.unshift(h('button', { class: 'pri', onclick: () => startLaunch(u) }, '🚀 Choose launch site'));
}
function startLaunch(u) {
  const ts = HX.launchTargets(UI.G, u); UI.launch = { id: u.id, targets: ts }; renderer.reach = ts;
  toast('Tap a highlighted tile to launch over it.', -1, 2600); renderSel(); renderer.request();
}
function militaryInfo(u) {
  const U = UNITS[u.type], G = UI.G;
  const parts = [`❤️ ${u.hp}`, `⚔️ ${U.str}`];
  if (U.rstr) parts.push(`🏹 ${U.rstr} · range ${HX.unitRange(u)}`);
  parts.push(`XP ${u.xp || 0}`);
  if (u.promos && u.promos.length) parts.push('★ ' + u.promos.map(k => PROMO[k].name).join(', '));
  if (HX.isEmbarked(G, u)) parts.push('Embarked: defends weakly, cannot attack');
  return h('div', { class: 'info' }, parts.join(' · '));
}
function militaryButtons(u, acts, kids) {
  const G = UI.G;
  const pc = HX.promoChoices(G, u);
  if (pc.length) acts.unshift(h('button', { class: 'pri', onclick: () => promoteDlg(u) }, '★ Promote'));
  for (const up of HX.upgradeOptions(G, u).filter(o => o.visible)) {
    const A = HX.AFFINITIES.find(a => a.key === up.aff);
    acts.push(h('button', { disabled: !up.ok, style: `border-color:${A.color}`, onclick: () => { if (HX.upgradeUnit(G, u, up.to)) { Sound.play('build'); toast(`Upgraded to ${UNITS[u.type].name}.`); refreshAll(); } } }, `${A.glyph} ${UNITS[up.to].name} ${up.cost}💠`));
    if (!up.ok) kids.push(h('div', { class: 'why' }, `Upgrade to ${UNITS[up.to].name}: ${up.why}`));
  }
  if (HX.canPillage(G, u)) acts.push(h('button', { onclick: () => { HX.pillage(G, u); flushLog(); refreshAll(); } }, 'Pillage'));
  if (UNITS[u.type].note) kids.push(h('div', { class: 'info' }, UNITS[u.type].note));
  if (HX.campAt(G, u.tile) === undefined && !u.order && u.moves > 0 && !kids.some(k => k.textContent && k.textContent.startsWith('Tap an enemy'))) kids.push(h('div', { class: 'info' }, 'Tap an enemy or a wild beast to see the odds, tap again to attack.'));
}
function promoteDlg(u) {
  const G = UI.G, ch = HX.promoChoices(G, u);
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, `Promote ${UNITS[u.type].name}`), h('p', null, 'Choose one. Promoting also heals 15.'),
    h('div', { style: 'display:flex;flex-direction:column;gap:6px' }, ch.map(k => h('button', { class: 'belief', onclick: () => { HX.promote(G, u, k); closeModal(); refreshAll(); } }, h('div', { class: 'a' }, PROMO[k].name), h('div', { class: 'b' }, PROMO[k].text)))),
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Later'))));
}
function attackBlock(u) {
  const G = UI.G, a = UI.attack, out = [];
  const cancel = h('button', { onclick: () => { UI.attack = null; renderer.path = null; renderSel(); renderer.request(); } }, 'Cancel');
  if (a.peace !== undefined) {
    const civ = CIVS[G.players[a.peace].civ], ws = HX.warStatus(G, UI.pid, a.peace);
    out.push(h('div', { class: 'why' }, `You are at peace with the ${civ.name}. Attacking means war.`));
    out.push(h('div', { class: 'acts' }, h('button', { class: 'danger', disabled: !ws.ok, onclick: () => confirmDlg(`Declare war on the ${civ.name}?`, 'Their units and colonies become targets. Other factions will remember this.', 'Declare war', () => { HX.declareWar(G, UI.pid, a.peace); flushLog(); UI.attack = null; attackTap(u, a.tile); }, true) }, 'Declare war'), cancel));
    if (!ws.ok) out.push(h('div', { class: 'info' }, ws.why));
    return out;
  }
  const pv = a.pv;
  if (pv.capture && pv.tg && pv.tg.civilian) out.push(h('div', { class: 'info' }, h('b', null, `Capture the ${pv.name}.`), ' No fighting needed.'));
  else {
    const verdict = pv.capture ? 'The colony falls if this lands.' : pv.kill ? 'Likely destroys it.' : pv.attackerDies ? 'Your unit will probably die.' : '';
    out.push(h('div', { class: 'info' }, h('b', null, `${pv.ranged ? 'Fire on' : 'Attack'} ${pv.name}`), ` (❤️ ${pv.targetHp})`));
    out.push(h('div', { class: 'info' }, `You deal about `, h('b', { style: 'color:#7fd38a' }, String(pv.dmgToTarget)), pv.ranged ? ' and take nothing.' : ['. You take about ', h('b', { style: 'color:#ec6a5f' }, String(pv.dmgToAttacker)), '.'], verdict ? ' ' + verdict : ''));
    const mods = (pv.atk.mods || []).concat((pv.def.mods || []).map(m => 'Defender: ' + m));
    out.push(h('div', { class: 'info' }, `Strength ${pv.atk.str.toFixed(1)} vs ${pv.def.str.toFixed(1)}` + (mods.length ? ' · ' + mods.join(', ') : '')));
  }
  if (a.plan.origin !== u.tile) out.push(h('div', { class: 'info' }, 'Moves into position first.'));
  out.push(h('div', { class: 'acts' }, h('button', { class: 'pri', onclick: () => doAttackUI(u) }, pv.capture && pv.tg && pv.tg.civilian ? 'Capture' : pv.ranged ? 'Fire' : 'Attack'), cancel));
  return out;
}

function renderCityPanel(box, c, s, close) {
  const G = UI.G, P = G.players[UI.pid];
  const mem = c && P._vis[c.tile] ? { o: c.owner, n: c.name, p: c.pop, cap: c.capital } : P.seen[s.t];
  if (!mem) return renderTilePanel(box, s.t, close);
  const civ = CIVS[G.players[mem.o].civ], own = mem.o === UI.pid;
  const kids = [h('div', { class: 'hd' },
    h('div', { class: 'gl', style: `background:${civ.color}` }, civ.minor ? HX.MINOR_TYPES[civ.minor].glyph : '🏙️'),
    h('div', null, h('div', { class: 'tt' }, (mem.cap ? '★ ' : '') + mem.n), h('div', { class: 'st' }, `${civ.name} · Population ${mem.p}` + (mem.cap ? ' · Capital' : ''))),
    close)];
  if (own && c) {
    const r = HX.cityReport(G, c);
    const need = HX.growthNeed(G, c.pop), grow = r.foodNet > 0 ? Math.ceil((need - c.food) / r.foodNet) : null;
    kids.push(h('div', { class: 'info' }, h('b', null, `🌾${fmtSigned(r.foodNet)} ⚙️${fmtN(r.prod)} 💠${fmtN(r.gold - r.upkeep)} 🔬${fmtN(r.sci)} 🎭${fmtN(r.cul)}`),
      ' · ', grow ? `grows in ${grow}` : r.foodNet < 0 ? 'starving' : 'not growing'));
    kids.push(h('div', { class: 'info' }, c.build ? ['Building ', h('b', null, HX.itemName(c.build)), ` · ${prodTurns(c, r)} turns`] : h('span', { class: 'neg' }, 'Nothing in production')));
    const mx = HX.cityMaxHp(G, c);
    kids.push(h('div', { class: 'info' }, `🛡️ Defense ${HX.cityStrength(G, c).toFixed(0)} · ❤️ ${c.hp}/${mx}` + (c.unrest > 0 ? ` · Unrest for ${c.unrest} turn${c.unrest > 1 ? 's' : ''}` : '')));
    const proj = c.buildings.find(k => HX.isProject(k)); if (proj) { const B = BUILDINGS[BLDI[proj]], vp = HX.victoryProgress(G, UI.pid)[B.victory]; kids.push(h('div', { class: 'info' }, `⏳ ${B.name}: ${vp.clock} of ${vp.need} turns held.`)); }
    const acts = [h('button', { class: c.build ? 'pri' : '', onclick: () => showCity(c) }, 'Open colony')];
    if (!c.build && !UI.busy) { const tip = HX.aiRankProduction(G, c, false).find(x => x.v > 0); if (tip) acts.unshift(h('button', { class: 'pri', onclick: () => { HX.setBuild(G, c, tip.it); Sound.play('select'); updateHUD(); refreshAll(); setSel({ k: 'city', id: c.id, t: c.tile }); } }, `⭐ Build ${HX.itemName(tip.it)}`)); }
    for (const tu of HX.cityTargets(G, c)) acts.push(h('button', { class: 'danger', disabled: UI.busy, onclick: () => { const r = HX.cityBombard(G, c, tu.id); if (r) renderer.combatFx(null, r); flushLog(); setSel({ k: 'city', id: c.id, t: c.tile }); } }, `Fire at ${UNITS[tu.type].name}`));
    const buy = HX.canBuy(G, c);
    if (c.build && buy.cost !== undefined) acts.push(h('button', { disabled: !buy.ok || UI.busy, onclick: () => { HX.buyItem(G, c); flushLog(); setSel({ k: 'city', id: c.id, t: c.tile }); } }, `Buy ${buy.cost}💠`));
    kids.push(h('div', { class: 'acts' }, acts));
  } else if (!P._vis[s.t]) kids.push(h('div', { class: 'info' }, 'Last seen information. Send a unit to update it.'));
  box.replaceChildren(...kids);
}

function renderTilePanel(box, t, close) {
  const G = UI.G, P = G.players[UI.pid], m = G.map;
  if (!P.explored[t]) {
    box.replaceChildren(h('div', { class: 'hd' }, h('div', { class: 'gl', style: 'background:#111' }, '❔'), h('div', null, h('div', { class: 'tt' }, 'Unexplored'), h('div', { class: 'st' }, 'Send a unit to reveal this area.')), close));
    return;
  }
  const TT = TERRAIN[m.terrain[t]], y0 = HX.tileOutput(G, UI.pid, t, null), y = { f: y0.f, p: y0.p, g: y0.g };
  const nw = HX.naturalAt(G, t);
  const name = nw ? nw.name : m.lake[t] ? 'Lake' : TT.name;
  const more = [y0.s ? `${y0.s}🔬` : '', y0.c ? `${y0.c}🎭` : ''].filter(Boolean).join(' ');
  const lines = [h('div', { class: 'info' }, 'Yields ', h('b', null, yieldsText(y) + (more ? ' ' + more : '')))];
  if (TT.desc && !nw) lines.push(h('div', { class: 'info', style: 'color:var(--mut)' }, TT.desc));
  if (nw) lines.push(h('div', { class: 'info' }, `✨ Natural wonder. ${nw.desc} Inside your borders it also gives +1 morale.`));
  if (m.veil[t]) lines.push(h('div', { class: 'why' }, '🌫️ Spore Veil. Units without protection lose 10 health each turn here. Riggers can scour it (Biocontainment); Communion learns to live with it.'));
  const site = HX.siteAt(G, t); if (site) { const K = HX.SITE_KINDS[site.kind]; lines.push(h('div', { class: 'info' }, `${K.glyph} ${K.name}. ${K.desc}` + (site.kind === 'vault' && P.vaults.includes(site.id) ? ' You have decoded it.' : ''))); }
  if (HX.ruinAt(G, t)) lines.push(h('div', { class: 'info' }, '📦 Supply pod from the arks. Any land unit that reaches it opens it.'));
  for (const st of HX.satsOver(G, t)) lines.push(h('div', { class: 'info' }, `${HX.SATS[st.type].glyph} ${HX.SATS[st.type].name} (${CIVS[G.players[st.owner].civ].adj}) overhead for ${st.until - G.turn} more turns.`));
  const extra = [];
  if (m.res[t] >= 0 && HX.resVisible(G, UI.pid, m.res[t])) { const R0 = RES[m.res[t]]; extra.push(`${R0.glyph} ${R0.name} (${R0.kind})`); }
  if (m.improv[t]) extra.push(IMPROV[m.improv[t]].name);
  if (m.road[t]) extra.push(m.road[t] === 2 ? 'Maglev' : 'Road');
  if (m.river[t]) extra.push('Glow-river');
  if (TT.land && !TT.impassable) extra.push(`Move cost ${TT.move}`);
  if (TT.impassable) extra.push('Impassable');
  if (TT.water) extra.push('Water: land units embark with Marine Technology');
  if (TT.def) extra.push(`${TT.def > 0 ? '+' : ''}${TT.def}% defense`);
  if (extra.length) lines.push(h('div', { class: 'info' }, extra.join(' · ')));
  const o = m.owner[t];
  if (o >= 0) lines.push(h('div', { class: 'info' }, 'Territory of ', h('b', null, CIVS[G.players[o].civ].name)));
  if (!P._vis[t]) lines.push(h('div', { class: 'info' }, 'Not currently in view.'));
  if (P.explored[t] && HX.campAt(G, t)) lines.push(h('div', { class: 'why' }, `🦗 Fauna nest${HX.campAt(G, t).hoard ? ' (an ancient nest guarding an artifact)' : ''}. It spawns native beasts. An Explorer next to it can study it; a military unit on it destroys it, but the wild will remember.`));
  if (o === UI.pid) { const ch = HX.improvementFor(G, UI.pid, t); if (ch.imp) lines.push(h('div', { class: 'info' }, `A Builder can add a ${IMPROV[ch.imp].name} (${gainText(IMPROV[ch.imp].add)}).`)); else if (ch.wants) lines.push(h('div', { class: 'info' }, ch.why)); }
  box.replaceChildren(h('div', { class: 'hd' }, h('div', { class: 'gl', style: `background:${TT.color}` }, nw ? nw.glyph : m.res[t] >= 0 && HX.resVisible(G, UI.pid, m.res[t]) ? RES[m.res[t]].glyph : ''),
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
  const G = UI.G, from = u.tile, logBefore = G.log.length; UI.movesBefore = u.moves;
  const steps = HX.issueMove(G, u, dest);
  if (steps.length) { Sound.play(UNITS[u.type].naval || HX.isEmbarked(G, u) ? 'sail' : 'move'); UI.undo = G.log.length === logBefore && !G.cfg.ironman ? { id: u.id, from, to: u.tile, before: UI.movesBefore, after: u.moves, turn: G.turn, explored: exploredCount(G) } : null; }
  UI.preview = -1; renderer.path = null; renderer.reach = null;
  const dur = renderer.animate(u.id, [from, ...steps]);
  renderSel(); updateHUD();
  afterUnitAction(u, dur + 60);
}
// Undo the last move, but only if it revealed nothing new and nothing else happened since.
function exploredCount(G) { const ex = G.players[UI.pid].explored; let n = 0; for (let i = 0; i < ex.length; i++) n += ex[i]; return n; }
function canUndo(u) {
  const G = UI.G, d = UI.undo;
  if (!d || d.id !== u.id || d.turn !== G.turn || u.tile !== d.to || u.moves !== d.after || UI.busy) return false;
  if (exploredCount(G) !== d.explored) return false;
  const occ = (UNITS[u.type].civilian ? G._civ : G._mil).get(d.from);
  return !occ || occ === u;
}
function undoMove(u) {
  const G = UI.G, d = UI.undo; if (!canUndo(u)) return;
  const m = occMap(G, u); if (m.get(u.tile) === u) m.delete(u.tile);
  u.tile = d.from; m.set(d.from, u); u.moves = d.before; u.order = null;
  G._zocVer = (G._zocVer || 0) + 1; HX.computeVisibility(G, UI.pid);
  UI.undo = null; Sound.play('select');
  renderer.centerOn(u.tile, true); renderSel(); updateHUD(); renderer.request();
}
function doOrder(u, o) {
  const from = u.tile;
  const steps = HX.setOrder(UI.G, u, o);
  const dur = steps.length ? renderer.animate(u.id, [from, ...steps]) : 0;
  afterUnitAction(u, dur + 40);
}
function doFound(u) {
  const c = HX.foundCity(UI.G, u);
  if (c) { Sound.play('found'); flushLog(); afterUnitAction(u, 300); }
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
  if (UI.manage) return manageTap(t);
  if (UI.launch) {
    const u = HX.unitById(G, UI.launch.id), ok = u && UI.launch.targets.includes(t); UI.launch = null; renderer.reach = null;
    if (ok) return confirmDlg(`Launch ${UNITS[u.type].name}?`, `It will orbit over this tile for ${HX.satLife(G, G.players[u.owner], u.type)} turns.`, 'Launch', () => { if (HX.launchSat(G, u, t)) { Sound.play('wonder'); flushLog(); setSel(null); refreshAll(); selectNextUnit(); } });
    toast('Launch cancelled.'); setSel(u ? { k: 'unit', id: u.id } : null); return;
  }
  const s = UI.sel;
  if (!UI.busy && s && s.k === 'unit') {
    const u = HX.unitById(G, s.id);
    if (u && u.owner === UI.pid && t !== u.tile && UNITS[u.type].military && UNITS[u.type].cls !== 'recon' && foreignAt(t)) return attackTap(u, t);
    if (u && u.owner === UI.pid && t !== u.tile) {
      const opts = selectionOptions(t);
      const ownThere = opts.some(o => o.k === 'unit' && HX.unitById(G, o.id).owner === UI.pid && isCivilianUnit(HX.unitById(G, o.id)) === isCivilianUnit(u));
      if (!ownThere) {
        if (UI.preview === t) return doMove(u, t);
        const path = HX.findPath(G, u, t);
        if (!path || !path.length) {
          const o = G.map.owner[t];
          if (!UNITS[u.type].orbital) toast(HX.bordersClosed(G, u, t) ? `The ${CIVS[G.players[o].civ].name} have closed their borders. Trade for open borders in Diplomacy (🤝), or declare war.` : 'No known route to that tile.');
          return;
        }
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
// A visible foreign unit or city (or a barbarian camp) on tile t.
function foreignAt(t) {
  const G = UI.G, vis = G.players[UI.pid]._vis; if (!vis[t]) return false;
  const c = G._cityAt.get(t), m = G._mil.get(t), v = G._civ.get(t);
  return (c && c.owner !== UI.pid) || (m && m.owner !== UI.pid) || (v && v.owner !== UI.pid);
}
function attackTap(u, t) {
  const G = UI.G;
  if (UI.attack && UI.attack.tile === t && UI.attack.plan) return doAttackUI(u);
  const st = HX.attackStatus(G, u, t);
  if (!st.ok && st.peace !== undefined) { UI.attack = { tile: t, peace: st.peace }; renderer.path = null; renderSel(); renderer.request(); return; }
  const plan = HX.attackPlanFor(G, u, t);
  if (!plan) { toast(st.why && st.why !== 'Out of range.' && st.why !== 'Melee units must be next to their target.' ? st.why : 'This unit cannot reach that target this turn.'); return; }
  const pv = HX.previewFrom(G, u, plan);
  UI.attack = { tile: t, plan, pv };
  if (plan.origin !== u.tile) { const p = HX.findPath(G, u, plan.origin); renderer.path = p ? { from: u.tile, steps: p, ok: true } : null; } else renderer.path = null;
  renderSel(); renderer.request();
}
function doAttackUI(u) {
  const G = UI.G, a = UI.attack; UI.attack = null; renderer.path = null;
  if (!a || !a.plan) return;
  let delay = 0;
  if (a.plan.origin !== u.tile) {
    const from = u.tile, steps = HX.issueMove(G, u, a.plan.origin);
    delay = renderer.animate(u.id, [from, ...steps]);
    if (u.tile !== a.plan.origin) { afterUnitAction(u, delay); return; }
  }
  setTimeout(() => {
    const res = HX.doAttack(G, u, a.tile);
    if (res) { renderer.combatFx(u.id, res); const U = UNITS[u.type]; Sound.play(U.cls === 'siege' || U.cls === 'naval_ranged' ? 'boom' : U.ranged ? 'ranged' : 'melee'); }
    refreshAll();
    afterUnitAction(u, 650); flushLog(); updateHUD(); checkDefeat();
  }, delay);
}
function onLongPress(t) {
  if (!UI.G || t < 0) return;
  if (navigator.vibrate) navigator.vibrate(10);
  setSel({ k: 'tile', t });
}

// ---------- tile management on the map ----------
function startManage(c) {
  UI.manage = c.id; UI.sel = null; closeScreens();
  renderer.manage = c; renderer.cityFocus = null; renderer.selTile = c.tile; renderer.path = null; renderer.reach = null;
  if (renderer.cam.z < 0.85) renderer.cam.z = 0.95;
  renderer.centerOn(c.tile, true);
  refreshAll();
}
function endManage(back) {
  const c = HX.cityById(UI.G, UI.manage);
  UI.manage = null; renderer.manage = null; renderer.selTile = -1;
  refreshAll();
  if (back && c) showCity(c);
}
function manageTap(t) {
  const G = UI.G, c = HX.cityById(G, UI.manage); if (!c) return endManage(false);
  if (HX.workableTiles(G, c).includes(t)) { HX.toggleTileWork(G, c, t); refreshAll(); return; }
  const cost = HX.tileBuyCost(G, c, t);
  if (cost !== null && G.players[UI.pid].explored[t]) {
    const P = G.players[UI.pid];
    if (P.gold < cost) return toast(`This tile costs ${cost} credits. You have ${Math.floor(P.gold)}.`);
    return confirmDlg('Buy this tile?', `${c.name} claims it for ${cost} credits.`, `Buy for ${cost}💠`, () => { HX.buyTile(G, c, t); refreshAll(); });
  }
  if (t !== c.tile) toast('That tile is outside what this colony can work or buy.');
}
function renderManagePanel(box, c) {
  const G = UI.G; if (!c) { UI.manage = null; return renderSel(); }
  const r = HX.cityReport(G, c);
  box.hidden = false;
  box.replaceChildren(
    h('div', { class: 'hd' }, h('div', { class: 'gl', style: `background:${humanCiv().color}` }, '📌'),
      h('div', null, h('div', { class: 'tt' }, `Tiles of ${c.name}`), h('div', { class: 'st' }, `🌾${fmtSigned(r.foodNet)} ⚙️${fmtN(r.prod)} 💠${fmtN(r.gold - r.upkeep)} 🔬${fmtN(r.sci)}`))),
    h('div', { class: 'info' }, 'Tap a tile to pin a citizen there, or tap a 📌 to release it. Tiles marked 💠 can be bought.'),
    h('div', { class: 'acts' },
      h('div', { class: 'stepper sm' }, h('span', { class: 'note', style: 'margin:0' }, 'Scholars'),
        h('button', { disabled: !c.forcedSpec, onclick: () => { HX.setForcedSpec(G, c, c.forcedSpec - 1); refreshAll(); } }, '−'),
        h('div', { class: 'v' }, String(Math.max(c.forcedSpec, r.spec))),
        h('button', { disabled: c.forcedSpec >= c.pop, onclick: () => { HX.setForcedSpec(G, c, Math.max(c.forcedSpec, r.spec) + 1); refreshAll(); } }, '+')),
      h('button', { onclick: () => { HX.resetTiles(G, c); refreshAll(); } }, 'Automatic'),
      h('button', { class: 'pri', onclick: () => endManage(true) }, 'Done')));
}

// ---------- turn flow ----------
function turnBanner(text) {
  const el = $('turnBanner'); el.hidden = true; el.textContent = text; void el.offsetWidth; el.hidden = false;
  clearTimeout(turnBanner.t); turnBanner.t = setTimeout(() => { el.hidden = true; }, 1400);
}
function beginHumanTurnUI(first) {
  const G = UI.G;
  if (!first) { turnBanner(`TURN ${G.turn}`); Sound.play('turn'); }
  setTimeout(checkTips, first ? 900 : 1400);
  setTimeout(showPendingEvent, first ? 600 : 1000);
  { const P0 = G.players[UI.pid]; if (!P0.landed && P0.landing && P0.landing.length > 1 && !G.cities.some(c => c.owner === UI.pid)) setTimeout(() => { if (!$('modal').firstChild) showLandfall(); }, first ? 800 : 1200); }
  UI.undo = null;
  { const P = G.players[UI.pid]; Sound.setMood(HX.playerEra(P), HX.majorPlayers(G).some(Q => Q.id !== UI.pid && HX.atWar(G, UI.pid, Q.id)), HX.primaryAff(P)); }
  autosave();
  updateHUD();
  flushLog();
  if (!selectNextUnit(true)) setSel(null);
  if (first) {
    const s = G.units.find(u => u.owner === UI.pid && UNITS[u.type].founds) || G.cities.find(c => c.owner === UI.pid);
    if (s) renderer.centerOn(s.tile, false);
  }
}
// A random event waiting for this player's decision.
function showPendingEvent() {
  const G = UI.G; if (!G || UI.busy || $('modal').firstChild || document.querySelector('#screens .screen')) return;
  if (showPendingDraft() || showPendingStory() || showQuestOffer()) return;
  const ev = HX.pendingEvent(G, UI.pid); if (!ev) return;
  Sound.play('faith');
  $('modal').replaceChildren(h('div', { class: 'dlg event' }, h('div', { class: 'evk' }, 'Colony event'), h('h4', null, ev.title), h('p', null, ev.text),
    h('div', { class: 'col' }, ev.options.map(o => h('button', { class: o.i === 0 ? 'pri' : '', disabled: !o.ok, onclick: () => { if (HX.resolveEvent(G, UI.pid, o.i)) { closeModal(); Sound.play('build'); updateHUD(); refreshAll(); } } }, o.label)))));
}
function prodTurns(c, r) {
  if (!c.build) return '–';
  const rate = HX.itemRate(r, c.build), left = HX.itemCost(UI.G, c.build, c.owner) - c.prod;
  if (c.build.k === 'u' && c.build.key === 'settler' && c.pop < 2 && left <= 0) return 'waits for size 2,';
  return rate > 0 ? Math.max(1, Math.ceil(left / rate)) : '∞';
}
function endTurn() {
  const G = UI.G; if (!G || UI.busy) return;
  const blk = turnBlocker(); if (blk) return blk.act();
  const idle = HX.unitsNeedingOrders(G, UI.pid);
  if (idle.length && Settings.get('confirmEnd')) {
    return confirmDlg('End turn?', `${idle.length} unit${idle.length > 1 ? 's' : ''} still ${idle.length > 1 ? 'have' : 'has'} moves left.`, 'End turn', reallyEndTurn);
  }
  reallyEndTurn();
}
function reallyEndTurn() {
  setSel(null);
  if (Settings.get('autoBombard')) HX.aiCityBombard(UI.G, UI.pid);
  HX.endPlayerTurn(UI.G);
  runRivals();
}
// Run computer players one at a time, yielding to the browser between them so the phone never freezes.
function runRivals() {
  const G = UI.G;
  UI.busy = true; updateHUD();
  const step = () => {
    if (UI.G !== G) return;
    if (G.players[G.active].human) {
      UI.busy = false; renderer.request();
      if (G.active !== UI.pid) return passTo(G.active);
      if (checkDefeat()) return; beginHumanTurnUI(); if (G.over && !G.over.seen) showEndGame(); return;
    }
    const P = G.players[G.active];
    if (!P.barbarian && !P.minor) $('busy').textContent = `${P.met && G.players[UI.pid].met.includes(P.id) ? 'The ' + CIVS[P.civ].name : 'A distant faction'} ${P.met && G.players[UI.pid].met.includes(P.id) ? 'are' : 'is'} moving…`;
    else if (P.minor) $('busy').textContent = 'Outposts are moving…';
    else $('busy').textContent = 'The wild stirs…';
    HX.aiTakeTurn(G, G.active);
    HX.endPlayerTurn(G);
    renderer.request();
    setTimeout(step, 30);
  };
  setTimeout(step, 60);
}
// Hotseat: hide the map, then hand the phone to the next human player.
function passTo(pid) {
  const G = UI.G, P = G.players[pid], civ = CIVS[P.civ];
  closeModal(); setSel(null); UI.pid = pid; renderer.setGame(G, pid); HX.computeVisibility(G, pid); renderer.landing = null;
  G.uiLogIdx = Math.max(0, G.log.length - 30); while (G.uiLogIdx < G.log.length && G.log[G.uiLogIdx].pid !== pid && G.log[G.uiLogIdx].pid !== -1) G.uiLogIdx++;
  showScreen(h('div', { class: 'screen curtain' }, h('div', { class: 'wrap' },
    civEmblem(civ, 96),
    h('h2', null, `${civ.name}`), h('p', null, `${civ.leader}, it is your turn. Turn ${G.turn}.`),
    h('p', { class: 'note' }, 'Pass the phone. Tap when the right player is holding it.'),
    h('button', { class: 'pri', onclick: () => { closeScreens(); if (checkDefeat()) return; beginHumanTurnUI(true); if (G.over && !G.over.seen) showEndGame(); } }, 'Start my turn'))));
}
function humansAlive(G) { return G.players.filter(P => P.human && P.alive).length; }
function checkDefeat() {
  const G = UI.G; if (!G || G.players[UI.pid].alive) return false;
  if (humansAlive(G) > 0) return false; // hotseat: the others carry on
  if (G.cfg.ironman) { Saves.remove(Saves.RUN); if (!G.over) recordRun(G, false); }
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, 'Your faction has fallen'), h('p', null, `The ${humanCiv().name} lost their last colony on turn ${G.turn}.`),
    h('div', { class: 'bar' }, h('button', { onclick: () => { closeModal(); showLoad(showMainMenu); } }, 'Load a save'), h('button', { class: 'pri', onclick: () => { closeModal(); showMainMenu(); } }, 'Main menu'))));
  return true;
}
function autosave() {
  if (!UI.G.players[UI.pid].alive) return;
  const slot = UI.G.cfg.ironman ? Saves.RUN : Saves.pickAutoSlot();
  UI.autoSlot = slot;
  const err = Saves.write(slot, UI.G, UI.pid);
  if (err) toast(err);
}

function enterGame(G) {
  UI.G = G; UI.pid = G.players[G.active] && G.players[G.active].human ? G.active : Math.max(0, G.players.findIndex(p => p.human)); UI.sel = null; UI.busy = false; UI.manage = null; renderer.manage = null;
  renderer.setGame(G, UI.pid);
  closeScreens(); $('hud').hidden = false;
  beginHumanTurnUI(true);
  if (!G.players[G.active].human) runRivals();
}
function leaveGame() { UI.G = null; UI.manage = null; $('hud').hidden = true; renderer.G = null; renderer.manage = null; renderer.request(); }

function makeTouchIcon() {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 180; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 180); g.addColorStop(0, '#2a1858'); g.addColorStop(1, '#07040f');
    x.fillStyle = g; x.fillRect(0, 0, 180, 180);
    const cols = ['#4fe3c1', '#b18cff', '#5fe0a0', '#ff6f80', '#3f9c8a', '#5a3f86', '#f2c94c'];
    const pos = [[90, 90], [90 + 44, 90], [90 - 44, 90], [90 + 22, 90 - 38], [90 - 22, 90 - 38], [90 + 22, 90 + 38], [90 - 22, 90 + 38]];
    pos.forEach(([px, py], k) => { x.beginPath(); hexPath(x, px, py, 24); x.fillStyle = cols[k]; x.fill(); x.strokeStyle = '#0a0716'; x.lineWidth = 3; x.stroke(); });
    $('touchicon').setAttribute('href', c.toDataURL('image/png'));
  } catch (e) { /* icon is cosmetic */ }
}

function boot() {
  document.addEventListener('pointerdown', () => Sound.unlock(), { capture: true });
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) Sound.play('tap'); }, { capture: true });
  renderer = new Renderer($('map'));
  attachMapInput($('map'), renderer, { tap: onTap, longPress: onLongPress });
  $('btnMenu').onclick = () => showPause();
  $('stGold').onclick = () => showEmpire();
  $('stHap').onclick = () => showEmpire();
  $('stSci').onclick = () => showTech();
  $('btnPolicy').onclick = () => showPolicies();
  $('btnLens').onclick = () => {
    const next = lensMode() === 'off' ? 'yields' : 'off';
    Settings.set('lens', next); updateHUD(); renderer.request();
    toast(next === 'off' ? 'Lens off.' : 'Yields lens: food, production and credits on every tile in view.', -1, 2200);
  };
  $('btnFaith').onclick = () => showAffinity();
  // a dialog always wins over a tip: the tip comes back later, since it was not marked as seen
  new MutationObserver(() => { if ($('modal').firstChild && $('tip')) $('tip').remove(); }).observe($('modal'), { childList: true });
  $('btnDip').onclick = () => showDiplomacy();
  $('btnVic').onclick = () => showVictory();
  $('btnQuest').onclick = () => showQuestDlg();
  $('btnWorld').onclick = () => showWorld();
  $('btnNext').onclick = () => selectNextUnit(true);
  $('btnEnd').onclick = () => endTurn();
  document.addEventListener('visibilitychange', () => { if (document.hidden && UI.G && !UI.busy && UI.autoSlot) Saves.write(UI.autoSlot, UI.G, UI.pid); });
  window.addEventListener('pagehide', () => { if (UI.G && !UI.busy && UI.autoSlot) Saves.write(UI.autoSlot, UI.G, UI.pid); });
  makeTouchIcon();
  showMainMenu();
}
