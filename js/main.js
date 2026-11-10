// Embercrown boot: screens (title, menu, new realm), settings, lifecycle,
// resize handling, service worker and the single shared game loop.
import './game/content.js';
import { Loop } from './engine/loop.js';
import { Renderer } from './engine/render.js';
import { audio } from './engine/audio.js';
import { loadMeta, saveMeta, hasRun, loadRun, requestPersist, exportCode, importCode, downloadJson, DEFAULT_SETTINGS } from './engine/save.js';
import { randomSeedText } from './engine/rng.js';
import { GameController } from './game/controller.js';
import { RunFlow } from './game/runflow.js';
import { DT } from './game/sim.js';
import { BAL } from './data/balance.js';
import { Modal } from './ui/modal.js';
import { Toasts } from './ui/toast.js';
import { el, tapButton } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { drawSigil } from './engine/sprites.js';
import { FACTIONS } from './data/factions.js';
import { BUS } from './game/hooks.js';
import { MODES, MODE_LIST, dailyConfig, dailyTable } from './game/modes.js';
import { STORYTELLERS, STORYTELLER_LIST } from './data/storytellers.js';

const VERSION = '1.3.0 · Phase 4';
const root = document.getElementById('root');
const canvas = document.getElementById('view');
const screens = document.getElementById('screens');

const app = {
  canvas, root,
  meta: loadMeta(),
  debug: new URLSearchParams(location.search).get('debug') === '1',
  vw: 1, vh: 1, dpr: 1,
  modal: new Modal(document.getElementById('modal')),
  toasts: new Toasts(document.getElementById('toasts')),
  renderer: new Renderer(canvas),
  portrait() { return this.vh > this.vw; },
  settings() { return this.meta.settings; },
  saveMeta(m) { saveMeta(m || this.meta); },
};
app.loop = new Loop({
  step: DT,
  update: () => { if (ctl.active) ctl.simTick(); },
  render: (alpha, dt) => { if (ctl.active) ctl.frame(alpha, dt); else drawBackdrop(dt); },
});
const ctl = new GameController(app);
app.ctl = ctl;
app.flow = new RunFlow(app);
app.measure = () => measure();

// ---- iOS input hygiene --------------------------------------------------------------
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest || !e.target.closest('.dialog, .card, .items, .squads, .screen')) e.preventDefault();
}, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// ---- Layout -------------------------------------------------------------------------
const supportsDvh = CSS.supports && CSS.supports('height', '100dvh');
function measure() {
  if (!supportsDvh) root.style.height = window.innerHeight + 'px';
  app.vw = root.clientWidth || window.innerWidth;
  app.vh = root.clientHeight || window.innerHeight;
  app.dpr = Math.min(2, window.devicePixelRatio || 1);
  app.renderer.resize(app.vw, app.vh, app.dpr);
  ctl.resize();
}
let resizeT = 0;
function onResize() { clearTimeout(resizeT); resizeT = setTimeout(measure, 120); }
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

// ---- Settings -----------------------------------------------------------------------
function applySettings() {
  const st = app.meta.settings;
  document.documentElement.style.setProperty('--ts', String(st.textSize || 1));
  document.body.classList.toggle('cb', !!st.colorblind);
  audio.setVolumes(st.music, st.sfx);
  audio.setMuted(!!st.muted);
  app.renderer.settings.colorblind = !!st.colorblind;
  if (ctl.active) ctl.applySettings(st);
}

app.openSettings = (back) => {
  const st = app.meta.settings;
  const d = el('div', 'dialog panel');
  d.appendChild(el('h2', '', 'Settings'));
  const list = el('div', 'settings');
  const slider = (label, key) => {
    const row = el('label', 'set-row', `<span>${label}</span><input type="range" min="0" max="1" step="0.05">`);
    const inp = row.querySelector('input');
    inp.value = st[key];
    inp.addEventListener('input', () => { st[key] = +inp.value; applySettings(); });
    inp.addEventListener('change', () => { app.saveMeta(); audio.play('click'); });
    list.appendChild(row);
  };
  const toggle = (label, key) => {
    const row = el('div', 'set-row', `<span>${label}</span>`);
    const t = el('button', 'toggle' + (st[key] ? ' on' : ''));
    t.setAttribute('aria-label', label);
    tapButton(t, () => { st[key] = !st[key]; t.classList.toggle('on', st[key]); applySettings(); app.saveMeta(); });
    row.appendChild(t);
    list.appendChild(row);
  };
  slider('Music volume', 'music');
  slider('Effects volume', 'sfx');
  toggle('Mute all sound', 'muted');
  toggle('Screen shake', 'shake');
  toggle('Damage numbers', 'damageNumbers');
  toggle('Colorblind palette', 'colorblind');
  toggle('Left-handed layout', 'leftHanded');
  toggle('Reduce motion', 'reduceMotion');
  const ts = el('div', 'set-row', '<span>Text size</span>');
  const seg = el('div', 'seg'); seg.style.width = '52%';
  for (const [lbl, v] of [['S', 0.9], ['M', 1], ['L', 1.15]]) {
    const b = el('button', st.textSize === v ? 'on' : '', lbl);
    tapButton(b, () => { st.textSize = v; for (const c of seg.children) c.classList.toggle('on', c === b); applySettings(); app.saveMeta(); });
    seg.appendChild(b);
  }
  ts.appendChild(seg); list.appendChild(ts);
  d.appendChild(list);
  d.appendChild(el('p', 'hint', 'Safari may clear site data after 7 days without a visit unless Embercrown is on your Home Screen, and the Home Screen app keeps separate storage. Export your save to keep it safe.'));
  const acts = el('div', 'actions');
  const mk = (label, ic, fn, cls = 'secondary') => { const b = el('button', 'big-btn ' + cls, icon(ic) + `<span>${label}</span>`); tapButton(b, fn); acts.appendChild(b); };
  mk('Export save', 'export', () => openExport(() => app.openSettings(back)));
  mk('Import save', 'import', () => openImport(() => app.openSettings(back)));
  mk('Reset tips', 'info', () => { app.meta.tutorialDone = false; app.meta.coachDone = []; app.saveMeta(); app.toasts.show('Tutorial tips will show again.', 'good'); });
  mk('Done', 'check', () => { app.modal.close(); if (back) back(); }, '');
  d.appendChild(acts);
  app.modal.show(d, { dismissable: true });
};

async function openExport(back) {
  if (ctl.active) ctl.autosave();
  const d = el('div', 'dialog panel');
  d.appendChild(el('h2', '', 'Export Save'));
  d.appendChild(el('p', 'lead', 'Copy this code somewhere safe, or download it as a file. Import it on any device.'));
  const ta = el('textarea', 'code'); ta.readOnly = true; ta.value = 'Preparing…';
  d.appendChild(ta);
  const acts = el('div', 'actions');
  const copy = el('button', 'big-btn', icon('share') + '<span>Copy code</span>');
  tapButton(copy, async () => {
    try { await navigator.clipboard.writeText(ta.value); app.toasts.show('Save code copied.', 'good'); }
    catch (_) { ta.select(); document.execCommand && document.execCommand('copy'); app.toasts.show('Select the code and copy it.', ''); }
  });
  const dl = el('button', 'big-btn secondary', icon('export') + '<span>Download .json</span>');
  tapButton(dl, () => downloadJson());
  const done = el('button', 'big-btn secondary', '<span>Back</span>');
  tapButton(done, () => { app.modal.close(); back && back(); });
  acts.append(copy, dl, done);
  d.appendChild(acts);
  app.modal.show(d);
  try { ta.value = await exportCode(); } catch (e) { ta.value = 'Export failed: ' + e.message; }
}

function openImport(back) {
  const d = el('div', 'dialog panel');
  d.appendChild(el('h2', '', 'Import Save'));
  d.appendChild(el('p', 'lead', 'Paste a save code, or choose an exported .json file. This replaces your current progress.'));
  const ta = el('textarea', 'code'); ta.placeholder = 'EC1.…';
  d.appendChild(ta);
  const file = el('input'); file.type = 'file'; file.accept = '.json,application/json,text/plain'; file.style.display = 'none';
  d.appendChild(file);
  const run = async (text) => {
    try {
      await importCode(text);
      app.meta = loadMeta(); applySettings();
      app.modal.close();
      app.toasts.show('Save imported.', 'good');
      if (ctl.active) ctl.stop();
      toMenu();
    } catch (e) { app.toasts.show(e.message, 'bad'); audio.play('error'); }
  };
  file.addEventListener('change', async () => { const f = file.files && file.files[0]; if (f) run(await f.text()); });
  const acts = el('div', 'actions');
  const go = el('button', 'big-btn', icon('import') + '<span>Import code</span>');
  tapButton(go, () => run(ta.value));
  const pick = el('button', 'big-btn secondary', '<span>Choose file</span>');
  tapButton(pick, () => file.click());
  const back2 = el('button', 'big-btn secondary', '<span>Back</span>');
  tapButton(back2, () => { app.modal.close(); back && back(); });
  acts.append(go, pick, back2);
  d.appendChild(acts);
  app.modal.show(d);
}

app.openHelp = (back) => {
  const d = el('div', 'dialog panel');
  d.appendChild(el('h2', '', 'How to Play'));
  const b = el('div');
  b.innerHTML = `
  <p><b>The run.</b> Travel across the Realm Map one node at a time: regions to settle, Mystery events, Merchant Caravans, Shrines, Ruins and Cursed regions. The grey Hollowing follows a step behind you. The Gloomwyrm waits at the end of Act I. Your Sovereign's health, gold, relics, blueprints and Beacon bonuses carry from region to region.</p>
  <p><b>A region.</b> Each has an objective (survive the nights, destroy the Hollow Rift, grow prosperous, or fulfil the Crown's Edict) shown in the top bar. When it is met, tap <b>Light the Beacon</b> to move on, or stay for more Embers. If the Hearth falls or the Sovereign dies, the run is lost.</p>
  <p><b>Day</b> (about 90 s): drag buildings from the bottom bar onto the land and tap the check mark. Villagers build, farm, chop and quarry on their own. <b>Dusk</b>: red markers show where the Hollow will attack and how many. <b>Night</b>: towers fire, squads fight. <b>Dawn</b>: choose an Offering.</p>
  <p><b>Controls.</b> Drag to pan, pinch to zoom. Tap a building to manage it. Tap the Sovereign or a squad portrait to select (time slows), then tap the ground to move or a foe to attack. Long-press anything to learn about it. Two-finger tap cancels.</p>
  <p><b>Counters.</b> Archers and towers shred Husks. Spearmen impale Gloom Hounds. Militia mauls crack Hollow Knights. Braziers light the dark: the Hollow takes 25% more damage in light, and Shades cannot slip through lit walls.</p>
  <p><b>Desktop.</b> WASD/arrows pan, wheel zooms, Space pauses, 1-3 speed, C selects the Sovereign, N Nova, B Banner, M minimap, Esc cancels.</p>`;
  d.appendChild(b);
  const acts = el('div', 'actions');
  const ok = el('button', 'big-btn', '<span>Got it</span>');
  tapButton(ok, () => { app.modal.close(); back && back(); });
  acts.appendChild(ok); d.appendChild(acts);
  app.modal.show(d, { dismissable: true });
};

app.confirm = (title, text, yes, no) => {
  app.modal.dialog(title, text, [
    { label: 'Yes', onTap: yes },
    { label: 'No', cls: 'secondary', onTap: () => no && no() },
  ], { dismissable: true });
};

// ---- Screens ------------------------------------------------------------------------
function show(node) { screens.innerHTML = ''; if (node) screens.appendChild(node); }

function titleScreen() {
  const s = el('div', 'screen');
  s.innerHTML = `<h1 class="title-logo">EMBERCROWN</h1><p class="title-sub">Carry the last flame through the Shattered Realm of Vael.</p><div class="tap-begin">TAP TO BEGIN</div>`;
  const begin = (e) => {
    e.preventDefault();
    audio.unlock(); // must be synchronous inside the gesture for iOS
    requestPersist();
    s.removeEventListener('pointerup', begin);
    audio.play('ok');
    toMenu();
  };
  s.addEventListener('pointerup', begin);
  show(s);
  audio.setMode('menu');
}

function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function isStandalone() { return navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); }

function toMenu() {
  if (ctl.active) ctl.stop();
  app.flow.run = null;
  app.modal.close();
  audio.setMode('menu');
  const s = el('div', 'screen');
  s.innerHTML = `<h1 class="title-logo" style="font-size:clamp(40px,9vw,72px)">EMBERCROWN</h1>`;
  const m = app.meta;
  const stats = el('p', 'title-sub', `Embers banked: <b>${m.embers}</b> · Realms: ${m.runs} · Victories: ${m.wins}${m.best.nights ? ' · Best: ' + m.best.nights + ' nights' : ''}`);
  s.appendChild(stats);
  const col = el('div', 'menu-col');
  const mk = (label, ic, fn, cls = '') => { const b = el('button', 'big-btn ' + cls, icon(ic) + `<span>${label}</span>`); tapButton(b, fn, { sound: 'ok' }); col.appendChild(b); return b; };
  if (hasRun()) mk('Continue', 'play', continueRun);
  mk('New Realm', 'flame', toSetup, hasRun() ? 'secondary' : '');
  // Meta screens (Ember Citadel, Codex, Achievements) plug in here.
  const extra = BUS.menu.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (extra.length) {
    const row = el('div', 'menu-row');
    for (const it of extra) { const b = el('button', 'big-btn secondary', icon(it.icon || 'book') + `<span>${it.label}</span>`); b.dataset.menu = it.id; tapButton(b, () => it.open(app), { sound: 'ok' }); row.appendChild(b); }
    col.appendChild(row);
  }
  mk('Settings', 'gear', () => app.openSettings(), 'secondary');
  mk('How to Play', 'book', () => app.openHelp(), 'secondary');
  s.appendChild(col);
  s.appendChild(el('div', 'version', VERSION));
  show(s);
  if (isIOS() && !isStandalone() && !m.homeTipShown) {
    const tip = el('div', 'home-tip panel', `${icon('share')}<div><b>Play full-screen:</b> tap Share, then <b>Add to Home Screen</b>. Saves are safer there too.</div>`);
    const x = el('button', 'hbtn', icon('x')); x.setAttribute('aria-label', 'Dismiss');
    tapButton(x, () => { tip.remove(); m.homeTipShown = true; app.saveMeta(); });
    tip.appendChild(x);
    s.appendChild(tip);
  }
}
app.toMenu = toMenu;

function toSetup(preset) {
  if (ctl.active) ctl.stop();
  app.modal.close();
  const m = app.meta;
  const s = el('div', 'screen');
  s.appendChild(el('h2', '', 'A New Realm')).style.cssText = 'margin:0;color:var(--brass-hi);font-size:28px';
  const col = el('div', 'menu-col');
  col.style.width = 'min(460px, 100%)';
  const opts = {
    mode: (preset && preset.mode) || (MODES[m.lastMode] ? m.lastMode : 'campaign'),
    faction: m.lastFaction || 'dawnhold', storyteller: m.lastStoryteller || 'steady', difficulty: m.lastDifficulty || 'standard',
  };
  // Mode: Campaign, Endless, Daily Realm, Sandbox.
  const mseg = el('div', 'seg modeseg');
  const mdesc = el('p', 'hint');
  for (const id of MODE_LIST) { const b = el('button', '', MODES[id].name); b.dataset.k = id; tapButton(b, () => setMode(id)); mseg.appendChild(b); }
  col.appendChild(mseg); col.appendChild(mdesc);
  const body = el('div', 'setup-body');
  col.appendChild(body);
  const go = el('button', 'big-btn', icon('flame') + '<span>Kindle the Hearth</span>');
  const back = el('button', 'big-btn secondary', '<span>Back</span>');
  tapButton(back, toMenu);
  let seedInput = null;

  function factionOpen(id) {
    if (opts.mode === 'sandbox') return true;
    return FACTIONS[id].playable || !!BUS.factionUnlocked(m, id);
  }

  function setMode(id) {
    opts.mode = id;
    for (const b of mseg.children) b.classList.toggle('on', b.dataset.k === id);
    mdesc.textContent = MODES[id].desc;
    body.innerHTML = '';
    seedInput = null;
    if (id === 'daily') buildDaily(); else buildFree();
    for (const f of BUS.setup) { try { f(body, opts, app); } catch (e) { console.error(e); } }
  }

  function buildDaily() {
    const cfg = dailyConfig();
    Object.assign(opts, cfg);
    const f = FACTIONS[cfg.faction], st = STORYTELLERS[cfg.storyteller];
    const info = el('div', 'panel facinfo');
    info.innerHTML = '<b></b><p class="hint"></p><p class="hint"></p><p class="hint"></p>';
    info.querySelector('b').textContent = `Today's realm: ${cfg.seedText}`;
    const ps = info.querySelectorAll('p');
    ps[0].textContent = `Faction: ${f.name} \u00b7 ${f.people}`;
    ps[1].textContent = `Storyteller: ${st.name}. Difficulty: ${BAL.difficulty.standard.label}.`;
    ps[2].textContent = 'Same seed for everyone today. Your best score is kept on this device.';
    body.appendChild(info);
    const rows = dailyTable(m, 7);
    const tb = el('div', 'panel facinfo daily-table');
    tb.appendChild(el('b', '', 'Your recent Daily Realms'));
    if (!rows.length) tb.appendChild(el('p', 'hint', 'No Daily Realm played yet.'));
    for (const r of rows) {
      const line = el('p', 'hint');
      line.textContent = `${r.label}${r.key === cfg.dailyKey ? ' (today)' : ''}: best ${r.best} \u00b7 ${r.tries} ${r.tries === 1 ? 'try' : 'tries'} \u00b7 ${FACTIONS[r.faction] ? FACTIONS[r.faction].name : ''}`;
      tb.appendChild(line);
    }
    body.appendChild(tb);
  }

  function buildFree() {
    delete opts.dailyKey; delete opts.seedText;
    if (!factionOpen(opts.faction)) opts.faction = 'dawnhold';
    // Faction: four peoples from the start, two more from the Ember Citadel.
    const facRow = el('div', 'facrow');
    const facInfo = el('div', 'panel facinfo');
    const setFac = (id) => {
      const f = FACTIONS[id];
      if (!factionOpen(id)) {
        facInfo.innerHTML = '<b></b><p class="hint"></p><p class="hint"></p>';
        facInfo.querySelector('b').textContent = `${f.name} (locked)`;
        const ps = facInfo.querySelectorAll('p');
        ps[0].textContent = 'Strength: ' + f.passive;
        ps[1].textContent = 'Unlock this people in the Ember Citadel.';
        return;
      }
      opts.faction = id;
      for (const c of facRow.children) c.classList.toggle('on', c.dataset.id === id);
      facInfo.innerHTML = '<b></b> <span class="hint"></span><p class="hint"></p><p class="hint"></p>';
      facInfo.querySelector('b').textContent = f.name;
      facInfo.querySelector('span').textContent = '\u00b7 ' + f.people;
      const ps = facInfo.querySelectorAll('p');
      ps[0].textContent = 'Strength: ' + f.passive;
      ps[1].textContent = 'Drawback: ' + f.drawback;
    };
    for (const id of Object.keys(FACTIONS)) {
      const f = FACTIONS[id];
      const open = factionOpen(id);
      const b = el('button', 'facbtn' + (open ? '' : ' locked'));
      b.dataset.id = id;
      b.setAttribute('aria-label', f.name + (open ? '' : ' (locked)'));
      const c = el('canvas'); c.width = 88; c.height = 88;
      const g = c.getContext('2d'); g.fillStyle = f.colors[1]; g.beginPath(); g.arc(44, 44, 42, 0, 6.283); g.fill();
      g.strokeStyle = f.colors[0]; g.lineWidth = 4; g.stroke(); drawSigil(g, f.sigil || 'sun', 44, 44, 26, f.colors[0]);
      b.appendChild(c);
      b.appendChild(el('span', '', f.name));
      if (!open) b.appendChild(el('i', 'lockmark', icon('lock')));
      tapButton(b, () => setFac(id));
      facRow.appendChild(b);
    }
    body.appendChild(facRow); body.appendChild(facInfo); setFac(opts.faction);
    // Storyteller: how the Hollow and fate pace the run.
    const tseg = el('div', 'seg');
    const tdesc = el('p', 'hint');
    const setTeller = (id) => { opts.storyteller = id; for (const b of tseg.children) b.classList.toggle('on', b.dataset.k === id); tdesc.textContent = STORYTELLERS[id].desc; };
    for (const st of STORYTELLER_LIST) { const b = el('button', '', st.name.replace(/^The /, '')); b.dataset.k = st.id; tapButton(b, () => setTeller(st.id)); tseg.appendChild(b); }
    body.appendChild(tseg); body.appendChild(tdesc); setTeller(STORYTELLERS[opts.storyteller] ? opts.storyteller : 'steady');
    // Difficulty
    const seg = el('div', 'seg');
    const desc = el('p', 'hint');
    const setDiff = (k) => { opts.difficulty = k; for (const b of seg.children) b.classList.toggle('on', b.dataset.k === k); const d = BAL.difficulty[k]; desc.textContent = opts.mode === 'endless' ? d.desc : `${d.desc} Survive ${d.nights} nights.`; };
    for (const k of ['story', 'standard', 'brutal']) { const b = el('button', '', BAL.difficulty[k].label); b.dataset.k = k; tapButton(b, () => setDiff(k)); seg.appendChild(b); }
    body.appendChild(seg); body.appendChild(desc); setDiff(BAL.difficulty[opts.difficulty] ? opts.difficulty : 'standard');
    // Seed
    const seedRow = el('div', 'seedrow');
    const inp = el('input'); inp.value = randomSeedText(); inp.maxLength = 24; inp.setAttribute('aria-label', 'Seed'); inp.autocapitalize = 'characters'; inp.spellcheck = false;
    const dice = el('button', 'hbtn', icon('dice')); dice.setAttribute('aria-label', 'Random seed'); dice.style.cssText = 'width:52px;height:52px';
    tapButton(dice, () => { inp.value = randomSeedText(); });
    seedRow.append(inp, dice);
    body.appendChild(seedRow);
    body.appendChild(el('p', 'hint', 'The same seed always makes the same realm. Share it with friends.'));
    seedInput = inp;
  }

  tapButton(go, () => {
    if (seedInput) opts.seedText = (seedInput.value || randomSeedText()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || randomSeedText();
    if (!factionOpen(opts.faction)) opts.faction = 'dawnhold';
    m.lastMode = opts.mode;
    if (opts.mode !== 'daily') { m.lastDifficulty = opts.difficulty; m.lastFaction = opts.faction; m.lastStoryteller = opts.storyteller; }
    app.saveMeta();
    // The run reads a frozen copy of meta (unlocks, Citadel levels) so later changes never alter it.
    app.flow.newRun({ ...opts, meta: JSON.parse(JSON.stringify(m)) });
  }, { sound: 'ok' });
  col.appendChild(go);
  col.appendChild(back);
  s.appendChild(col);
  show(s);
  setMode(opts.mode);
}
app.toSetup = toSetup;

function continueRun() {
  const r = loadRun();
  if (!r.ok) { app.modal.dialog('Save Problem', r.error, [{ label: 'OK', onTap: toMenu }]); return; }
  try { app.flow.resume(r.state); }
  catch (e) { app.modal.dialog('Save Problem', 'This saved realm could not be restored: ' + e.message + ' You can start a new realm, or import a save in Settings.', [{ label: 'OK', onTap: toMenu }]); }
}


// ---- Menu backdrop: drifting embers over the dark -------------------------------------
let bdT = 0;
function drawBackdrop(dt) {
  bdT += dt;
  const r = app.renderer, g = r.g, w = app.vw, h = app.vh;
  g.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#16131d'); gr.addColorStop(0.65, '#2a1a1c'); gr.addColorStop(1, '#4a2614');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  const P = r.particles;
  P.update(dt);
  if (Math.random() < 0.7) P.spawn('ember', Math.random() * w, h + 6, { vy: -30 - Math.random() * 50, vx: (Math.random() - 0.5) * 20, life: 6, size: 1.5 + Math.random() * 2.5, color: Math.random() < 0.5 ? '#ffb347' : '#ff7a2a', add: true, drag: 1 });
  const glow = g.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, h * 0.8);
  glow.addColorStop(0, 'rgba(255,140,50,0.35)'); glow.addColorStop(1, 'rgba(255,140,50,0)');
  g.fillStyle = glow; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  P.draw(g, true, { x0: -10, x1: w + 10, y0: -10, y1: h + 20 });
  g.globalCompositeOperation = 'source-over';
  audio.update();
}

// ---- Lifecycle ------------------------------------------------------------------------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (ctl.active) { ctl.autosave(); if (!ctl.paused) ctl.togglePause(); }
    else if (app.flow.run) app.flow.save();
    audio.suspend();
  } else if (audio.ctx) audio.resume();
});
window.addEventListener('pagehide', () => { if (ctl.active) ctl.autosave(); else if (app.flow.run) app.flow.save(); });

window.addEventListener('error', (e) => { if (app.debug) app.toasts.show('Error: ' + e.message, 'bad'); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

// ---- Boot -------------------------------------------------------------------------------
app.meta.settings = { ...DEFAULT_SETTINGS, ...app.meta.settings };
applySettings();
measure();
app.loop.start();
titleScreen();
window.embercrown = app; // handy for debugging in the console
