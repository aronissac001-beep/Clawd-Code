// ===== hud.js : game loop, top bar, navigation, selection panels, orders, toasts, dialogs, tips =====
const UI = { G: null, pid: 0, speed: 0, lastSpeed: 1, selSys: null, selFleet: null, selPlanet: null, frac: 0, acc: 0, moveMode: false, screen: null, modal: false, lastAuto: 0, logSeen: 0, hudT: 0, selT: 0 };
const SPEEDS = [0, 4, 8, 16];
let renderer = null;
const P_ = () => UI.G.empires[UI.pid];

// ---------- game loop ----------
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (t - (lastT || t)) / 1000); lastT = t;
  const G = UI.G;
  if (G && !G.over && UI.speed > 0 && !UI.modal && !UI.screen) {
    UI.acc += dt * SPEEDS[UI.speed];
    let n = 0;
    while (UI.acc >= 1 && n < 4) {
      UI.acc -= 1; n++;
      SW.advanceDay(G);
      if (SW.playerEvents(G, UI.pid).length || G.over) { UI.acc = 0; break; }
    }
    UI.frac = UI.acc;
    if (n) afterDays(n);
  } else if (G) UI.frac = UI.speed > 0 && !UI.modal && !UI.screen ? UI.acc : UI.frac;
  UI.fr = (UI.fr || 0) + 1;
  const running = UI.speed > 0 && !UI.modal && !UI.screen;
  if (G && renderer && !UI.screen && (renderer.dirty || running || (renderer.busy() && UI.fr % 2 === 0))) renderer.draw(G, running ? UI.frac : 0);
  if (G && t - UI.hudT > 250) { UI.hudT = t; updateHUD(); }
}
function afterDays(n) {
  const G = UI.G;
  flushLog();
  if (G.day - UI.lastAuto >= (Settings.get('autosave') || 1e9)) { UI.lastAuto = G.day; autosave(); }
  if (t_selDue()) renderSel();
  if (G.over) { setTimeout(() => showEnd(), 300); setSpeed(0); return; }
  const evs = SW.playerEvents(G, UI.pid);
  if (evs.length && !UI.modal) showEvent(evs[0]);
  Sound.setMood(SW.warsOf(G, UI.pid).length || G.crisis.stage === 2 ? 'war' : 'calm');
  tipsCheck();
}
function t_selDue() { const now = performance.now(); if (now - UI.selT > 400) { UI.selT = now; return true; } return false; }
function setSpeed(s) {
  if (s > 0) UI.lastSpeed = s;
  UI.speed = s;
  for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', +b.dataset.sp === s);
  renderer && renderer.request();
}
function autosave() { const slot = Saves.pickAuto(); const err = Saves.write(slot, UI.G); if (err) toast(err, 'bad'); }

// ---------- toasts & log ----------
function toast(msg, kind, sys) {
  const box = $('toasts'); while (box.children.length >= 3) box.firstChild.remove();
  const el = h('div', { class: 'toast ' + (kind || ''), onclick: () => { if (sys != null && sys >= 0) { selectSystem(sys); renderer.centerOn(sys, true); } el.remove(); } }, msg);
  box.append(el); setTimeout(() => el.remove(), 4200);
}
const LOG_SOUND = { war: 'war', peace: 'peace', tech: 'tech', trad: 'trad', build: 'build', event: 'event', major: 'alert', bad: 'alert', good: 'colony' };
function flushLog() {
  const G = UI.G; const items = [];
  for (let i = G.uiLog; i < G.log.length; i++) { const e = G.log[i]; if (e.e === UI.pid || e.e === -1) items.push(e); }
  G.uiLog = G.log.length;
  if (!items.length) return;
  const pri = ['war', 'major', 'bad', 'event', 'peace', 'good', 'tech', 'trad', 'diplo', 'build', 'info'];
  items.sort((a, b) => pri.indexOf(a.k) - pri.indexOf(b.k));
  const s = LOG_SOUND[items[0].k]; if (s) Sound.play(s);
  const show = items.filter(e => e.k !== 'info' || items.length < 3).slice(0, 2);
  show.forEach((e, i) => setTimeout(() => toast(e.m, e.k, e.s), i * 200));
}

// ---------- HUD ----------
const RES_CHIPS = ['energy', 'minerals', 'food', 'alloys', 'goods', 'influence', 'unity', 'research'];
function buildHUD() {
  $('sel').addEventListener('pointerdown', () => { UI.selDown = true; });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { if (UI.selDown) { UI.selDown = false; } });
  $('btnMenu').replaceChildren(icon('menu')); $('btnMenu').onclick = () => { Sound.play('tap'); showGameMenu(); };
  for (const b of document.querySelectorAll('#speeds button')) b.onclick = () => { Sound.unlock(); Sound.play('tap'); setSpeed(+b.dataset.sp); };
  document.querySelector('#speeds button[data-sp="0"]').replaceChildren(icon('pause'));
  $('resbar').replaceChildren(...RES_CHIPS.map(r => h('button', { class: 'res', id: 'r_' + r, 'aria-label': r, onclick: () => showResPop(r) })));
  const NAV = [['outliner', 'list', 'Outliner'], ['research', 'research', 'Research'], ['empire', 'crown', 'Empire'], ['diplomacy', 'hands', 'Diplomacy'], ['military', 'ship', 'Military'], ['log', 'bell', 'Log']];
  $('nav').replaceChildren(...NAV.map(([k, ic, lb]) => h('button', { id: 'n_' + k, onclick: () => { Sound.play('tap'); openScreen(k); } }, icon(ic), lb, h('span', { class: 'pip', hidden: true }))));
  $('btnView').onclick = () => { Sound.play('tap'); if (renderer.mode === 'system') exitSystem(); else { const sid = UI.selSys ?? (UI.selFleet != null && SW.fleetById(UI.G, UI.selFleet) ? SW.fleetById(UI.G, UI.selFleet).sys : G_capSys()); enterSystem(sid); } };
  $('btnHome').replaceChildren(icon('home')); $('btnHome').onclick = () => { Sound.play('tap'); const s = G_capSys(); if (renderer.mode === 'system') enterSystem(s); else { renderer.centerOn(s, true, 0.8); selectSystem(s); } };
  $('btnAlerts').replaceChildren(icon('alert'), h('span', { class: 'pip red' })); $('btnAlerts').onclick = () => { Sound.play('tap'); showAlerts(); };
}
function G_capSys() { const e = P_(); const p = UI.G.planets[e.capital]; return p ? p.sys : (SW.ownedSystems(UI.G, e)[0] ?? 0); }
function updateHUD() {
  const G = UI.G; if (!G) return;
  { const t = $('top').getBoundingClientRect().bottom, n = $('nav').getBoundingClientRect().top; if (t > 0) renderer.topPad = t; if (n > 0) renderer.botPad = renderer.h - n; }
  const e = P_(), ec = SW.empireEcon(G, e), net = ec.net;
  const d = SW.dateOf(G.day);
  $('date').textContent = SW.dateStr(G.day);
  const yl = Math.max(0, Math.ceil((G.endDay - G.day) / 360));
  $('dateSub').textContent = UI.speed === 0 ? 'Paused' + (yl ? ' · ' + yl + ' years left' : '') : SPEEDS[UI.speed] + ' days/sec';
  for (const r of RES_CHIPS) {
    const el = $('r_' + r); if (!el) continue;
    let v, dn;
    if (r === 'research') { v = (net.lumen || 0) + (net.vita || 0) + (net.forge || 0); dn = null; }
    else { v = e.res[r]; dn = net[r] || 0; }
    el.replaceChildren(icon(r), h('span', { class: 'v' }, fmt(v)), h('span', { class: 'd ' + (dn == null ? 'mut' : dn >= 0 ? 'pos' : 'neg') }, dn == null ? '/mo' : fmtS(dn)));
    el.classList.toggle('alert', r !== 'research' && (e.deficit[r] || (dn < 0 && e.res[r] + dn * 6 < 0)));
  }
  $('btnView').replaceChildren(icon(renderer.mode === 'system' ? 'galaxy' : 'system'));
  // nav pips
  const pip = (k, on, red) => { const p = document.querySelector('#n_' + k + ' .pip'); if (p) { p.hidden = !on; p.classList.toggle('red', !!red); } };
  pip('research', RESEARCH.some(k => !e.research[k].cur));
  pip('empire', TRADITION_KEYS.some(k => !SW.canTradition(G, e, k)) || (SW.legacyOpen(e) && e.res.unity >= SW.legacyCost(G, e)));
  pip('diplomacy', SW.warsOf(G, UI.pid).length > 0, true);
  pip('military', G.fleets.some(f => f.owner === UI.pid && (f.kind === 'survey' || f.kind === 'builder' || f.kind === 'colony') && !f.order && !f.path.length && !f.auto));
  pip('log', G.log.length > UI.logSeen && G.log.slice(UI.logSeen).some(l => (l.e === UI.pid || l.e === -1) && /war|major|bad/.test(l.k)));
  $('btnAlerts').hidden = !alerts().length;
}
function showResPop(r) {
  Sound.play('tap');
  const G = UI.G, e = P_(), ec = SW.empireEcon(G, e), pop = $('pop');
  if (!pop.hidden && pop.dataset.r === r) { pop.hidden = true; return; }
  pop.dataset.r = r;
  const close = h('button', { class: 'icon ghost', style: 'float:right', onclick: () => (pop.hidden = true) }, icon('close'));
  if (r === 'research') {
    pop.replaceChildren(close, h('h3', { style: 'margin:4px 0 8px' }, 'Research per month'),
      ...RESEARCH.map(k => { const rs = e.research[k]; const t = rs.cur ? SW.techInfo(rs.cur) : null; const m = SW.researchMonths(G, e, k);
        return h('div', { class: 'item', onclick: () => { pop.hidden = true; openScreen('research'); } }, icon(k), h('div', { class: 'grow' }, h('div', { class: 'nm' }, STREAM_NAMES[k] + ' ', h('span', { class: 'pos' }, '+' + fmt(ec.net[k] || 0))), h('div', { class: 'ds' }, t ? `${t.name} · ${m === Infinity ? '∞' : m + ' mo'}` : 'Choose a research option'))); }),
      h('p', { class: 'mut', style: 'font-size:13px' }, 'Researchers and research stations produce Lumen, Vita and Forge points.'));
  } else {
    const b = ec.brk[r] || {};
    pop.replaceChildren(close, h('div', { class: 'row' }, icon(r), h('h3', { style: 'margin:4px 0' }, RES_INFO[r].name)),
      h('div', { class: 'kv', style: 'margin:6px 0' }, h('span', null, 'Stockpile'), h('b', null, fmt(e.res[r])), h('span', null, 'Monthly'), h('b', { class: (ec.net[r] || 0) >= 0 ? 'pos' : 'neg' }, fmtS(ec.net[r] || 0)),
        ...Object.keys(b).sort((x, y) => b[y] - b[x]).flatMap(k => [h('span', null, k), h('span', { class: b[k] >= 0 ? 'pos' : 'neg' }, fmtS(b[k]))])),
      h('p', { class: 'mut', style: 'font-size:13px;margin:6px 0' }, RES_INFO[r].desc),
      MARKET[r] ? h('button', { class: 'small', onclick: () => { pop.hidden = true; openScreen('empire', 'market'); } }, 'Open the market') : null);
  }
  pop.hidden = false;
}
document.addEventListener('pointerdown', ev => { const pop = $('pop'); if (!pop.hidden && !pop.contains(ev.target) && !(ev.target.closest && ev.target.closest('.res'))) pop.hidden = true; }, true);

// ---------- alerts ----------
function alerts() {
  const G = UI.G, e = P_(), out = [];
  for (const k of RESEARCH) if (!e.research[k].cur) { out.push({ t: `Choose ${STREAM_NAMES[k]} research`, a: () => openScreen('research') }); break; }
  const idle = G.fleets.filter(f => f.owner === UI.pid && (f.kind === 'survey' || f.kind === 'builder' || f.kind === 'colony') && !f.order && !f.path.length && !f.auto);
  for (const f of idle.slice(0, 3)) out.push({ t: `${f.name} is idle`, a: () => selectFleet(f.id, true) });
  for (const r of STOCK_RES) if (e.deficit[r]) out.push({ t: `${RES_INFO[r].name} deficit`, a: () => showResPop(r) });
  for (const p of SW.colonies(G, e)) {
    if ((p.col.stab ?? 60) < 30) out.push({ t: `${p.name}: low stability (${p.col.stab})`, a: () => openPlanet(p.id) });
    if (!p.col.auto && !p.col.queue.length && G.day > 60) { const rep = SW.planetReport(G, p); if (rep.unemployed >= 2) out.push({ t: `${p.name}: ${rep.unemployed} unemployed pops`, a: () => openPlanet(p.id) }); }
  }
  if (TRADITION_KEYS.some(k => !SW.canTradition(G, e, k))) out.push({ t: 'A tradition can be adopted', a: () => openScreen('empire', 'traditions') });
  for (const w of SW.warsOf(G, UI.pid)) out.push({ t: `At war: ${w.name}`, a: () => openScreen('diplomacy') });
  for (const x of SW.alive(G)) if (x.beaconDays > 0 && x.id !== UI.pid) out.push({ t: `${x.name} is attuning the Wake Beacons!`, a: () => openScreen('empire', 'victory') });
  for (const x of SW.alive(G)) if (x.domDays > 0 && x.id !== UI.pid) out.push({ t: `${x.name} is close to a conquest victory!`, a: () => openScreen('empire', 'victory') });
  return out;
}
function showAlerts() {
  const list = alerts();
  modal(h('div', null, h('h3', null, 'Situation'), list.length ? list.map(a => h('div', { class: 'item', onclick: () => { closeModal(); a.a(); } }, icon('alert'), h('div', { class: 'nm grow' }, a.t))) : h('p', null, 'All is calm.'),
    h('div', { class: 'opts' }, h('button', { onclick: closeModal }, 'Close'))));
}

// ---------- modal dialogs ----------
function modal(content, opts) {
  UI.modal = true;
  const veil = h('div', { class: 'veil', onclick: ev => { if (ev.target === veil && !(opts && opts.sticky)) closeModal(); } }, h('div', { class: 'dlg' }, content));
  $('modal').replaceChildren(veil);
}
function closeModal() { $('modal').replaceChildren(); UI.modal = false; renderer && renderer.request(); setTimeout(() => { if (UI.G && !UI.modal) { const evs = SW.playerEvents(UI.G, UI.pid); if (evs.length) showEvent(evs[0]); } }, 50); }
function confirmDlg(title, text, okLabel, fn, danger) {
  modal(h('div', null, h('h3', null, title), h('p', null, text), h('div', { class: 'opts' }, h('button', { class: danger ? 'danger' : 'pri', onclick: () => { closeModal(); fn(); } }, okLabel), h('button', { onclick: closeModal }, 'Cancel'))));
}
function showEvent(p) {
  const G = UI.G, e = P_(), E = EVENTS[p.key];
  const resume = UI.speed;
  if (UI.speed) setSpeed(0);
  let art;
  if (p.key === 'first_contact' || p.key === 'ai_offer' || p.key === 'peace_offer' || p.key === 'war_declared') {
    const o = G.empires[p.ctx.other]; const sp = G.species[o.species];
    art = h('div', { class: 'row', style: 'justify-content:center;padding:6px;background:#05060f;border-radius:14px' });
    const c = Art.portrait(sp.portrait, 128, o.color); c.className = 'portrait'; c.style.width = '110px'; c.style.height = '110px';
    art.append(c, h('div', null, h('div', { style: `font-weight:700;color:${o.color}` }, o.name), h('div', { class: 'mut', style: 'font-size:13px' }, sp.name + ' · ' + sp.body), h('div', { class: 'mut', style: 'font-size:13px' }, o.ethos.map(x => ETHOS[x].name).join(' · '))));
  } else { art = Art.scene(E.art, 600, 220, p.id * 13 + 5); art.className = 'art'; }
  Sound.play(p.key === 'war_declared' ? 'war' : p.key === 'first_contact' ? 'contact' : 'event');
  const opts = SW.eventOptions(G, e, p);
  modal(h('div', null, art, h('h3', null, E.title), h('p', null, E.text(G, e, p.ctx)),
    h('div', { class: 'opts' }, opts.map((o, i) => h('button', { class: i === 0 ? 'pri' : '', onclick: () => {
      SW.resolveEvent(G, p.id, i); Sound.play('select');
      closeModal(); flushLog(); updateHUD(); renderSel();
      if (resume && !SW.playerEvents(G, UI.pid).length) setSpeed(resume);
    } }, o.t))),
    p.ctx.sys >= 0 && p.ctx.sys != null ? h('div', { class: 'mut', style: 'font-size:12px;margin-top:8px;text-align:center' }, 'Location: ' + G.systems[p.ctx.sys].name) : null), { sticky: true });
}

// ---------- tips ----------
const TIPS = {
  welcome: 'Welcome to <b>Starwake</b>. Time is paused: press <b>1×</b> to let days flow. Drag to pan, pinch to zoom, tap a star to inspect it. Your surveyors are already exploring on their own.',
  research: 'Pick one card in each research stream. New choices appear when a tech completes.',
  outpost: 'Select your <b>Constructor</b>, then tap a surveyed system next to your borders and choose <b>Build outpost</b> to claim it. Outposts cost influence.',
  colony: 'Build a <b>Colony Ark</b> at a shipyard (Military → Shipyards), then send it to a habitable world. Green percentages mean good habitability.',
  anomaly: 'An anomaly was found! Select a surveyor, tap the system marked <b>?</b>, and choose <b>Study anomaly</b>.',
  contact: 'You have met another empire. Open <b>Diplomacy</b> to see their opinion of you and propose treaties.',
  war: 'War! Build warships at your shipyards and armies on your planets. Defeat starbases, hold orbit, then invade colonies with armies.',
  crisis: 'The Hollow Choir threatens every empire. Destroy its Spires to end the crisis. Its fleets hollow out any world they hold.',
  planet: 'Your capital needs jobs and housing. Open it from the Outliner to build districts and buildings, or turn on Automate.',
};
function showTip(key) {
  if (!Settings.get('tips')) return;
  const seen = Settings.get('tipsSeen') || []; if (seen.includes(key)) return;
  if (document.getElementById('tip')) return;
  Settings.set('tipsSeen', seen.concat([key]));
  const el = h('div', { id: 'tip' }, h('div', { html: TIPS[key] }), h('div', { class: 'row', style: 'margin-top:8px;justify-content:flex-end' },
    h('button', { class: 'small ghost', onclick: () => { Settings.set('tips', false); el.remove(); } }, 'No more tips'), h('button', { class: 'small pri', onclick: () => el.remove() }, 'Got it')));
  $('app').append(el);
}
function tipsCheck() {
  const G = UI.G, e = P_();
  if (G.day > 20) showTip('research');
  if (G.day > 120 && SW.ownedSystems(G, e).length < 3) showTip('outpost');
  if (G.day > 400) showTip('colony');
  if (G.day > 240) { const cp = G.planets[e.capital]; if (cp && cp.col && !cp.col.auto && SW.bldUsed(cp.col) < SW.bldSlots(cp)) showTip('planet'); }
  if (G.systems.some(s => s.anom && s.anom.by === UI.pid && !s.anom.done)) showTip('anomaly');
  if (Object.keys(e.rel).some(k => e.rel[k].contact >= 0)) showTip('contact');
  if (SW.warsOf(G, UI.pid).length) showTip('war');
  if (G.crisis.stage === 2) showTip('crisis');
}

// ---------- selection ----------
function selectSystem(sid) { UI.selSys = sid; UI.selPlanet = null; renderSel(); renderer.request(); }
function selectFleet(fid, center) {
  const f = SW.fleetById(UI.G, fid); if (!f) return;
  UI.selFleet = fid; UI.selSys = null; UI.selPlanet = null; UI.moveMode = false; $('hint').hidden = true;
  if (center) { closeScreen(); if (renderer.mode === 'system' && renderer.sys !== f.sys) exitSystem(); if (renderer.mode === 'galaxy') renderer.centerOn(f.sys, true); }
  Sound.play('select'); renderSel(); renderer.request();
}
function clearSel() { UI.selSys = null; UI.selFleet = null; UI.selPlanet = null; UI.moveMode = false; $('hint').hidden = true; renderSel(); renderer.request(); }
function enterSystem(sid) { renderer.enterSystem(sid); UI.selSys = UI.selFleet != null ? sid : null; UI.selPlanet = null; renderSel(); updateHUD(); }
function exitSystem() { renderer.exitSystem(); UI.selPlanet = null; renderSel(); updateHUD(); }
function onTap(x, y) {
  const G = UI.G; if (!G) return;
  const hit = renderer.hit(G, x, y);
  const mf = UI.selFleet != null ? SW.fleetById(G, UI.selFleet) : null;
  if (!hit) { if (UI.moveMode) return; if (renderer.mode === 'system') { UI.selPlanet = null; renderSel(); return; } clearSel(); return; }
  Sound.play('tap');
  if (hit.k === 'fleet') {
    if (UI.moveMode && mf) { const f = SW.fleetById(G, hit.id); if (f) return moveSelected(f.sys); }
    return selectFleet(hit.id);
  }
  if (hit.k === 'sys') {
    if (UI.moveMode && mf && mf.owner === UI.pid) return moveSelected(hit.id);
    if (mf && mf.owner !== UI.pid) UI.selFleet = null;
    UI.selSys = hit.id; UI.selPlanet = null; renderSel(); renderer.request(); return;
  }
  if (hit.k === 'cluster') { UI.selPlanet = null; UI.selSys = hit.id; UI.selFleet = null; renderSel(); renderer.request(); return; }
  if (hit.k === 'planet') { UI.selPlanet = hit.id; UI.selSys = renderer.sys; renderSel(); renderer.request(); return; }
  if (hit.k === 'sb') { const s = G.systems[hit.id]; if (s.sb && s.sb.owner === UI.pid) openStarbase(hit.id); else { UI.selPlanet = null; UI.selSys = hit.id; renderSel(); } }
}
function onDoubleTap(x, y) {
  const hit = renderer.hit(UI.G, x, y);
  if (renderer.mode === 'galaxy' && hit && hit.k === 'sys') { enterSystem(hit.id); Sound.play('select'); }
  else if (renderer.mode === 'galaxy') renderer.zoomAt(x, y, 1.6);
}
function moveSelected(sid) {
  const G = UI.G, f = SW.fleetById(G, UI.selFleet); if (!f) return;
  if (f.order && f.order.cost) SW.cancelOrder(G, f); else f.order = null;
  f.auto = 0;
  const err = SW.moveTo(G, f, sid);
  UI.moveMode = false; $('hint').hidden = true;
  if (err) toast(err, 'bad'); else { Sound.play('order'); UI.selSys = sid; }
  renderSel(); renderer.request();
}
function giveOrder(f, order) {
  const err = SW.orderFleet(UI.G, f, order);
  if (err) { toast(err, 'bad'); Sound.play('alert'); } else { Sound.play('order'); f.auto = 0; }
  renderSel(); updateHUD(); renderer.request();
}

// ---------- the selection panel ----------
function planetThumb(p, size) { const c = Art.planet(p, 64); const out = Art.mk(size * 2); const g = out.getContext('2d'); if (PLANET_TYPES[p.type].tex === 'belt') { g.fillStyle = '#8a8078'; for (let k = 0; k < 30; k++) g.fillRect(Art.hash(k, 1, 3) * size * 2, size * 0.7 + Art.hash(k, 2, 3) * size * 0.6, 2, 2); } else g.drawImage(c, 0, 0, size * 2, size * 2); out.style.width = size + 'px'; out.style.height = size + 'px'; out.className = 'pl'; return out; }
function renderSel() {
  const G = UI.G, el = $('sel'); if (!G) return;
  const f = UI.selFleet != null ? SW.fleetById(G, UI.selFleet) : null;
  if (UI.selFleet != null && !f) UI.selFleet = null;
  let content = null;
  if (f) content = fleetPanel(f);
  else if (UI.selPlanet != null) content = planetPanel(G.planets[UI.selPlanet]);
  else if (UI.selSys != null) content = systemPanel(G.systems[UI.selSys]);
  if (!content) { el.hidden = true; el.replaceChildren(); UI.selHTML = ''; return; }
  const html = content.outerHTML;
  if (html === UI.selHTML && !el.hidden) return; // unchanged: keep the live buttons
  if (UI.selDown && !el.hidden && UI.selHTML) return; // a finger is on the panel
  UI.selHTML = html;
  const st = el.scrollTop;
  el.replaceChildren(content); el.hidden = false; el.scrollTop = st;
}
function closeBtn(fn) { return h('button', { class: 'icon ghost', 'aria-label': 'Close', onclick: fn || clearSel }, icon('close')); }
function sysDesc(G, s) {
  const P = P_(); const bits = [STAR_TYPES[s.star].name];
  if (s.owner >= 0) bits.push(G.empires[s.owner].name); else bits.push('Unclaimed');
  if (!P.surv[s.id]) bits.push('Unsurveyed');
  return bits.join(' · ');
}
function systemPanel(s) {
  const G = UI.G, P = P_();
  if (!P.known[s.id]) return h('div', null, h('div', { class: 'hd' }, h('div', { class: 'grow' }, h('div', { class: 'tt' }, 'Unknown system'), h('div', { class: 'st' }, 'Explore nearby systems to chart this star.')), closeBtn()));
  const surveyed = P.surv[s.id] === 1;
  const fleets = G.fleets.filter(f => f.sys === s.id && (f.prog === 0 || !f.path.length) && (f.owner === UI.pid || renderer.visible(G, s.id)));
  const spec = { beacon: 'Wake Beacon: one of the ancient structures needed for a Beacon victory', storm: 'A living storm guards this nebula', crystals: 'Crystal Tenders guard rich deposits', garden: 'A garden world orbits here', relic: 'Ruins of a precursor empire', primitive: 'A native civilization lives here', rift: 'A Hollow rift: source of the Choir' }[s.special];
  const planets = s.planets.map(id => G.planets[id]);
  const rows = surveyed ? planets.map(p => {
    const T = PLANET_TYPES[p.type];
    let ds = T.name + (T.tex === 'belt' ? '' : ' · size ' + p.size);
    if (p.col) ds = `${G.empires[p.col.owner].name} · ${p.col.pops} pops`;
    else if (p.prim) ds = `${p.prim.name}: ${['stone age', 'bronze age', 'industrial', 'atomic age'][p.prim.stage]} natives`;
    else if (T.hab) ds += ' · ' + Math.round(SW.habitability(G, G.species[P.species], p, P) * 100) + '% habitable';
    const dep = p.dep ? Object.keys(p.dep).map(k => h('span', { class: 'chip' }, icon(k), '+' + p.dep[k] + (p.station ? ' ✓' : ''))) : null;
    return h('div', { class: 'item', onclick: () => { if (p.col && p.col.owner === UI.pid) openPlanet(p.id); else { UI.selPlanet = p.id; renderSel(); } } }, planetThumb(p, 30), h('div', { class: 'grow' }, h('div', { class: 'nm' }, p.name), h('div', { class: 'ds' }, ds)), dep);
  }) : [h('div', { class: 'ds mut', style: 'font-size:13px' }, `${planets.length} bodies. Survey the system to learn more.`)];
  const acts = [h('button', { onclick: () => enterSystem(s.id) }, icon('system'), 'View system')];
  if (s.sb && s.sb.owner === UI.pid) acts.push(h('button', { onclick: () => openStarbase(s.id) }, icon('gear'), SB_LEVELS[s.sb.lvl].name));
  return h('div', null,
    h('div', { class: 'hd' }, h('span', { class: 'dot', style: `color:${STAR_TYPES[s.star].color};background:${STAR_TYPES[s.star].color}` }), h('div', { class: 'grow' }, h('div', { class: 'tt' }, s.name), h('div', { class: 'st' }, sysDesc(G, s))), closeBtn()),
    spec && (surveyed || s.special === 'beacon' || s.special === 'rift') ? h('div', { class: 'chip gold', style: 'margin-top:6px;white-space:normal' }, spec) : null,
    s.anom && s.anom.by === UI.pid && !s.anom.done ? h('div', { class: 'chip', style: 'margin-top:6px;border-color:#7a52c4;white-space:normal' }, '? Anomaly: ' + EVENTS[s.anom.key].title + ' — send a surveyor to study it') : null,
    h('div', { class: 'acts' }, acts),
    h('div', { class: 'sub' }, 'Planets'), rows,
    fleets.length ? [h('div', { class: 'sub' }, 'Fleets here'), fleets.map(f => fleetRow(f))] : null);
}
function fleetRow(f) {
  const G = UI.G, e = G.empires[f.owner];
  const st = f.kind === 'war' || f.kind === 'monster' ? `${f.ships.length} ships · power ${fmt(SW.fleetPower(G, f))}` : f.kind === 'army' ? `${f.ships.length} armies` : (f.order ? orderLabel(f) : f.path.length ? 'Moving' : 'Idle');
  return h('div', { class: 'item', onclick: () => selectFleet(f.id) }, h('span', { class: 'dot', style: `color:${e.color};background:${e.color}` }), h('div', { class: 'grow' }, h('div', { class: 'nm' }, f.name), h('div', { class: 'ds' }, (f.owner === UI.pid ? '' : e.name + ' · ') + st)));
}
function orderLabel(f) {
  const G = UI.G, o = f.order; if (!o) return f.path.length ? 'Moving to ' + G.systems[f.path[f.path.length - 1]].name : 'Idle';
  const name = o.sys != null ? G.systems[o.sys].name : o.planet != null ? G.planets[o.planet].name : '';
  return { survey: 'Surveying ', anomaly: 'Studying anomaly at ', outpost: 'Building outpost at ', station: 'Building station at ', colonize: 'Colonizing ', invade: 'Invading ', bombard: 'Bombarding ' }[o.t] + name;
}
function shipSummary(G, f) {
  const e = G.empires[f.owner], c = {};
  for (const s of f.ships) { const n = s.m ? MONSTERS[s.m].name : typeof s.d === 'string' ? ARMIES[s.d].name : (SW.designById(e, s.d) ? HULLS[SW.designById(e, s.d).hull].name : '?'); c[n] = (c[n] || 0) + 1; }
  return Object.keys(c).map(k => c[k] + '× ' + k).join(', ');
}
function fleetPanel(f) {
  const G = UI.G, e = G.empires[f.owner], mine = f.owner === UI.pid;
  const hp = sum(f.ships, s => s.hp), hpMax = sum(f.ships, s => SW.shipStats(G, e, s).hull);
  const loc = G.systems[f.sys];
  const dest = f.path.length ? G.systems[f.path[f.path.length - 1]] : null;
  const eta = dest ? Math.ceil((pathLength(G, f.sys, f.path) - (f.prog || 0) * hyp(loc.x - G.systems[f.path[0]].x, loc.y - G.systems[f.path[0]].y)) / SW.fleetSpeed(G, f)) : 0;
  const pr = SW.orderProgress(G, f);
  const out = [h('div', { class: 'hd' }, h('span', { class: 'dot', style: `color:${e.color};background:${e.color}` }), h('div', { class: 'grow' }, h('div', { class: 'tt' }, f.name), h('div', { class: 'st' }, (mine ? '' : e.name + ' · ') + shipSummary(G, f))), closeBtn())];
  const info = [];
  if (f.kind === 'war' || f.kind === 'monster') info.push(h('span', { class: 'chip' }, icon('power'), 'Power ' + fmt(SW.fleetPower(G, f))));
  if (f.kind === 'war' && mine) info.push(h('span', { class: 'chip' }, 'Command ' + SW.fleetCmd(G, f) + '/' + SW.cmdLimit(G, e)));
  info.push(h('span', { class: 'chip' + (hp < hpMax * 0.5 ? ' bad' : '') }, 'Hull ' + Math.round(hp / Math.max(1, hpMax) * 100) + '%'));
  if (G._fight && G._fight[f.sys] && f.prog === 0) info.push(h('span', { class: 'chip bad' }, icon('swords'), 'In combat'));
  out.push(h('div', { class: 'row wrap', style: 'margin-top:6px' }, info));
  out.push(h('div', { class: 'st', style: 'margin-top:6px;color:var(--mut);font-size:13px' }, dest ? `Moving to ${dest.name} · ~${eta} days` : `At ${loc.name}`, f.order ? ' · ' + orderLabel(f) : ''));
  if (pr) out.push(h('div', { class: 'bar', style: 'margin-top:6px' }, h('i', { style: `width:${Math.min(100, pr.work / pr.need * 100)}%` })));
  if (!mine) {
    out.push(h('div', { class: 'acts' }, h('button', { onclick: () => { UI.selFleet = null; UI.selSys = f.sys; renderSel(); } }, 'System info')));
    return h('div', null, out);
  }
  const acts = [];
  acts.push(h('button', { class: UI.moveMode ? 'on' : '', onclick: () => { UI.moveMode = !UI.moveMode; const hint = $('hint'); hint.hidden = !UI.moveMode; hint.replaceChildren('Tap a destination system', h('button', { class: 'small ghost', onclick: () => { UI.moveMode = false; hint.hidden = true; renderSel(); } }, 'Cancel')); if (renderer.mode === 'system' && UI.moveMode) exitSystem(); renderSel(); } }, icon('ship'), 'Move'));
  if (f.path.length || f.order) acts.push(h('button', { onclick: () => { SW.cancelOrder(G, f); f.path = f.prog ? f.path.slice(0, 1) : []; f.auto = 0; renderSel(); } }, 'Stop'));
  if (f.kind === 'survey') acts.push(h('button', { class: f.auto ? 'on' : '', onclick: () => { f.auto = f.auto ? 0 : 1; if (f.auto) SW.autoSurvey(G, G.empires[UI.pid], f); renderSel(); } }, f.auto ? 'Auto-explore: on' : 'Auto-explore'));
  if (f.kind === 'builder') acts.push(h('button', { class: f.auto ? 'on' : '', onclick: () => { f.auto = f.auto ? 0 : 1; renderSel(); } }, f.auto ? 'Auto-stations: on' : 'Auto-stations'));
  if (f.kind === 'war') {
    const others = G.fleets.filter(g => g !== f && g.owner === UI.pid && g.kind === 'war' && g.sys === f.sys && !g.prog && !f.prog);
    if (others.length) acts.push(h('button', { onclick: () => { let err = null; for (const g of others) { err = SW.mergeFleets(G, f, g) || err; } if (err) toast(err, 'bad'); renderSel(); renderer.request(); } }, 'Merge (' + others.length + ')'));
    if (f.ships.length > 1) acts.push(h('button', { onclick: () => { const g = SW.splitFleet(G, f); if (typeof g === 'string') toast(g, 'bad'); renderSel(); renderer.request(); } }, 'Split'));
    const rc = SW.refitCost(G, e, f);
    if (rc.n) acts.push(h('button', { onclick: () => { const err = SW.refitFleet(G, f); toast(err || 'Fleet upgraded to the newest designs.', err ? 'bad' : 'good'); renderSel(); } }, `Upgrade ${rc.n} (${rc.alloys} alloys)`));
    acts.push(h('button', { onclick: () => { f.stance = f.stance === 'passive' ? 'aggressive' : 'passive'; renderSel(); } }, f.stance === 'passive' ? 'Stance: cautious' : 'Stance: hold'));
  }
  if (f.kind === 'army' && f.ships.length) { const others = G.fleets.filter(g => g !== f && g.owner === UI.pid && g.kind === 'army' && g.sys === f.sys && !g.prog && !f.prog); if (others.length) acts.push(h('button', { onclick: () => { for (const g of others) SW.mergeFleets(G, f, g); renderSel(); } }, 'Merge armies')); }
  acts.push(h('button', { onclick: () => { const s = G_capSys(); const err = SW.moveTo(G, f, s); if (err) toast(err, 'bad'); else Sound.play('order'); renderSel(); } }, icon('home'), 'Home'));
  acts.push(h('button', { class: 'danger', onclick: () => confirmDlg('Disband ' + f.name + '?', 'The ships will be scrapped. This cannot be undone.', 'Disband', () => { SW.disbandFleet(G, f); clearSel(); }, true) }, 'Disband'));
  out.push(h('div', { class: 'acts' }, acts));
  const target = UI.selSys != null ? UI.selSys : (f.path.length ? null : f.sys);
  if (target != null) out.push(ordersFor(f, G.systems[target]));
  return h('div', null, out);
}
function ordersFor(f, s) {
  const G = UI.G, P = P_(), out = [], btn = (label, fn, sub, err) => h('button', { class: err ? '' : 'pri', disabled: !!err, onclick: fn, style: 'flex-direction:column;align-items:flex-start;line-height:1.2;padding:6px 12px' }, label, sub || err ? h('span', { style: 'font-size:11.5px;opacity:.8;font-weight:400' }, err || sub) : null);
  const here = f.sys === s.id && f.prog === 0;
  if (!here) { const eta = SW.etaDays(G, f, s.id); out.push(btn('Move to ' + s.name, () => moveSelected(s.id), eta === Infinity ? 'No route' : `~${eta} days`)); }
  if (f.kind === 'survey') {
    if (!P.surv[s.id]) out.push(btn('Survey ' + s.name, () => giveOrder(f, { t: 'survey', sys: s.id }), `${12 + 3 * s.planets.length} days of work`));
    if (s.anom && s.anom.by === UI.pid && !s.anom.done) out.push(btn('Study anomaly: ' + EVENTS[s.anom.key].title, () => giveOrder(f, { t: 'anomaly', sys: s.id }), '60 days of work'));
  }
  if (f.kind === 'builder') {
    if (s.owner < 0) { const err = SW.canOutpost(G, P, s.id); out.push(btn('Build outpost', () => giveOrder(f, { t: 'outpost', sys: s.id }), costText(SW.outpostCost(G, P, s.id)) + ' · 90 days', err)); }
    if (s.owner === UI.pid) for (const pid of s.planets) { const p = G.planets[pid]; if (!p.dep || p.station || PLANET_TYPES[p.type].hab) continue; const k = Object.keys(p.dep)[0]; out.push(btn(`${RESEARCH.includes(k) ? 'Research' : 'Mining'} station on ${p.name}`, () => giveOrder(f, { t: 'station', planet: pid }), `+${(p.dep[k] * 1.5).toFixed(1)} ${RES_INFO[k].name.toLowerCase()} · ${costText(STATION_COST)}`, SW.canStation(G, P, pid))); }
  }
  if (f.kind === 'colony' && P.surv[s.id]) for (const pid of s.planets) { const p = G.planets[pid]; if (!PLANET_TYPES[p.type].hab || p.col || p.prim) continue; const hb = SW.habitability(G, G.species[P.species], p, P); out.push(btn(`Colonize ${p.name}`, () => giveOrder(f, { t: 'colonize', planet: pid }), `${Math.round(hb * 100)}% habitable · size ${p.size}`, SW.canColonize(G, P, pid))); }
  if (f.kind === 'army') for (const pid of s.planets) { const p = G.planets[pid]; if (!(p.col && SW.hostile(G, UI.pid, p.col.owner)) && !p.prim) continue; out.push(btn(`Invade ${p.name}`, () => giveOrder(f, { t: 'invade', planet: pid }), p.col ? `Defenders ${Math.round(p.col.def)} · fortification ${Math.round(p.col.fort)}%` : `Natives: defense ${p.prim.pops * 40 * (p.prim.stage + 1)}`, SW.orbitClear(G, UI.pid, s.id) || !here ? null : 'Orbit not secured yet (armies will wait)')); }
  if (f.kind === 'war') for (const pid of s.planets) { const p = G.planets[pid]; if (!p.col || !SW.hostile(G, UI.pid, p.col.owner)) continue; out.push(btn(`Bombard ${p.name}`, () => giveOrder(f, { t: 'bombard', planet: pid }), `Fortification ${Math.round(p.col.fort)}%`)); }
  if (!out.length) return null;
  return h('div', null, h('div', { class: 'sub' }, 'Orders · ' + s.name), h('div', { class: 'acts', style: 'flex-direction:column' }, out),
    f.sys !== s.id ? h('button', { class: 'small ghost', onclick: () => { UI.selSys = null; renderSel(); } }, 'Clear target') : null);
}
function planetPanel(p) {
  const G = UI.G, P = P_(), T = PLANET_TYPES[p.type], surveyed = P.surv[p.sys] === 1, s = G.systems[p.sys];
  const out = [h('div', { class: 'hd' }, planetThumb(p, 44), h('div', { class: 'grow' }, h('div', { class: 'tt' }, p.name), h('div', { class: 'st' }, T.name + (T.tex === 'belt' ? '' : ' · size ' + p.size) + ' · ' + s.name)), closeBtn(() => { UI.selPlanet = null; renderSel(); }))];
  const kv = [];
  if (!surveyed) kv.push('Survey', 'Not yet surveyed');
  else {
    if (T.hab) kv.push('Habitability for ' + G.species[P.species].name, Math.round(SW.habitability(G, G.species[P.species], p, P) * 100) + '%');
    if (T.hab && !p.col && !p.prim) { const c = SW.distCaps(p); kv.push('District room', `${p.size} (gen ${c.generator}, mine ${c.mining}, farm ${c.farming})`); }
    if (p.dep) { const k = Object.keys(p.dep)[0]; kv.push('Deposit', `+${p.dep[k]} ${RES_INFO[k].name.toLowerCase()}` + (p.station ? ' (station built)' : '')); }
    if (p.col) { kv.push('Owner', G.empires[p.col.owner].name, 'Species', G.species[p.col.sp].name, 'Pops', String(p.col.pops)); if (p.col.owner !== UI.pid) kv.push('Defense', `${Math.round(p.col.def)} · fortification ${Math.round(p.col.fort)}%`); }
    if (p.prim) kv.push('Natives', `${p.prim.name}, ${['stone age', 'bronze age', 'industrial', 'atomic age'][p.prim.stage]}`, 'Population', String(p.prim.pops), 'Observed by', p.prim.observed >= 0 ? G.empires[p.prim.observed].name : 'no one');
    if (p.siege) kv.push('Siege', `${G.empires[p.siege.att].name}: ${p.siege.armies.length} armies landed`);
    if (p.type === 'beacon') kv.push('Wake Beacon', 'Hold three, each with a Keep or better, after Wakefield Theory to win');
  }
  out.push(h('div', { class: 'kv', style: 'margin-top:8px' }, kv.map(x => h('span', null, x))));
  const acts = [];
  if (p.col && p.col.owner === UI.pid) acts.push(h('button', { class: 'pri', onclick: () => openPlanet(p.id) }, 'Open colony'));
  acts.push(h('button', { onclick: () => { UI.selPlanet = null; renderSel(); } }, 'System'));
  out.push(h('div', { class: 'acts' }, acts));
  return h('div', null, out);
}
