// Embercrown boot: screens (title, menu, new realm), settings, lifecycle,
// resize handling, service worker and the single shared game loop.
import './game/content.js';
import { Loop } from './engine/loop.js';
import { Renderer } from './engine/render.js';
import { audio } from './engine/audio.js';
import { loadMeta, saveMeta, hasRun, loadRun, clearRun, requestPersist, exportCode, importCode, downloadJson, DEFAULT_SETTINGS } from './engine/save.js';
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

const VERSION = '1.4.0 · Phase 4';
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
  d.appendChild(el('p', 'lead', FRAMED ? 'Copy this code somewhere safe. Import it on any device.' : 'Copy this code somewhere safe, or download it as a file. Import it on any device.'));
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
  acts.append(copy, ...(FRAMED ? [] : [dl]), done);
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
  <p><b>Build by day. Lead the fire by night. Pick one card at dawn.</b> Hold each region for 3 nights; the 3rd is the <b>Long Night</b>. Survive it, light the Beacon, march on.</p>
  <p><b>The road.</b> Each act is 3 regions, one stop on the road (a Mystery or a Merchant Caravan), then its boss. The grey Hollowing follows a step behind you. Your Sovereign's health, gold, relics, blueprints and Dawn Card upgrades travel with you. If a Hearth falls or the Sovereign dies, the run is lost.</p>
  <p><b>Day</b> (about 35 s): build from the bottom bar; villagers build and repair, but repairs cost wood or stone. <b>Call the Night</b> early for gold. <b>Dusk</b>: route lines show where the Hollow will come from. <b>Night</b>: lead with the Sovereign; towers and squads support. <b>Dawn</b>: one card (a blueprint, an upgrade, a hero, or supplies). The Long Night's dawn grants the Beacon's reward instead: a relic or a lasting bonus.</p>
  <p><b>Controls.</b> Drag to pan, pinch to zoom. Tap a building to manage it. Tap the Sovereign, a squad or a hero (or its portrait) to select it, then tap the ground to move or a foe to attack. Long-press anything to learn about it. Two-finger tap cancels.</p>
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
  const s = el('div', 'screen title-screen');
  s.innerHTML = `<h1 class="title-logo">EMBERCROWN</h1><p class="title-sub">Carry the last flame through the Shattered Realm of Vael.</p>`;
  // One tap to play (rework): the first button starts (or continues) a realm at once; a tap
  // anywhere else opens the menu. Audio unlocks inside the same gesture, as iOS requires.
  const col = el('div', 'menu-col title-col');
  const saved = hasRun();
  const play = el('button', 'big-btn title-play', icon(saved ? 'play' : 'flame') + `<span>${saved ? 'Continue' : 'Play'}</span>`);
  const more = el('button', 'big-btn secondary title-menu', icon('menu') + '<span>Menu</span>');
  col.append(play, more);
  s.appendChild(col);
  s.appendChild(el('div', 'tap-begin', 'TAP ANYWHERE FOR THE MENU'));
  let gone = false;
  const begin = (e, then) => {
    if (gone) return;
    gone = true;
    if (e) { e.preventDefault(); e.stopPropagation(); }
    audio.unlock(); // must be synchronous inside the gesture for iOS
    requestPersist();
    audio.play('ok');
    then();
  };
  play.addEventListener('pointerup', (e) => begin(e, saved ? continueRun : quickPlay));
  more.addEventListener('pointerup', (e) => begin(e, toMenu));
  s.addEventListener('pointerup', (e) => { if (!e.target.closest('button')) begin(e, toMenu); });
  show(s);
  audio.setMode('menu');
}

/** Play: a Campaign with Dawnhold on Standard and a random seed, straight into the first region. */
function quickPlay() {
  const m = app.meta;
  const begin = () => app.flow.newRun({ mode: 'campaign', faction: 'dawnhold', difficulty: 'standard', seedText: randomSeedText(), quick: true, meta: JSON.parse(JSON.stringify(m)) });
  if (!hasRun()) { begin(); return; }
  app.confirm('Leave your saved realm?', 'A realm is still in progress. Starting a new one ends it; the Embers it earned are banked.', () => {
    const r = loadRun();
    if (r.ok) app.flow.abandonSaved(r.state); else clearRun();
    begin();
  }, () => {});
}
app.quickPlay = quickPlay;

/** Setup options (faction, difficulty, seed, perks) open after the first realm. */
function setupOpen() { return (app.meta.runs || 0) > 0 || app.debug; }
/** Modes offered on the New Realm screen: Endless after the first Act is won; Daily and
 *  Sandbox are hidden from the menu (?modes=all or ?debug=1 shows them, for testing). */
function modesOpen() {
  const all = app.debug || new URLSearchParams(location.search).get('modes') === 'all';
  // An act boss slain before this rework counts too (meta.life.bosses, meta.wins).
  const m = app.meta, won = (m.actsWon || 0) + ((m.life && m.life.bosses) || 0) + (m.wins || 0) > 0;
  return MODE_LIST.filter((id) => id === 'campaign' || (id === 'endless' && (all || won)) || all);
}

// Embedded in another page (e.g. a hosted preview frame): file downloads and
// Home Screen installs belong to the host, so those options are hidden.
const FRAMED = (() => { try { return window.self !== window.top; } catch (_) { return true; } })();
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
  mk('Play', 'flame', quickPlay, hasRun() ? 'secondary' : '');
  if (setupOpen()) mk('New Realm', 'map', toSetup, 'secondary');
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
  if (!FRAMED && isIOS() && !isStandalone() && !m.homeTipShown) {
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
  s.classList.add('setup-screen');
  // Layout (rework): a title bar with a 44 pt Back button, then two groups: who (mode,
  // people) and how (difficulty, seed, perks, Kindle). Portrait stacks them; a landscape
  // phone puts them side by side, so the whole screen fits 390 or 844 px without scrolling.
  const bar = el('div', 'setup-bar');
  const back = el('button', 'hbtn setup-back', icon('x'));
  back.setAttribute('aria-label', 'Back');
  tapButton(back, toMenu);
  bar.appendChild(back);
  bar.appendChild(el('h2', '', 'A New Realm'));
  s.appendChild(bar);
  const col = el('div', 'menu-col setup-col');
  const left = el('div', 'setup-l'), right = el('div', 'setup-r');
  col.append(left, right);
  const modes = modesOpen();
  const opts = {
    mode: (preset && preset.mode) || (modes.includes(m.lastMode) ? m.lastMode : 'campaign'),
    faction: m.lastFaction || 'dawnhold', difficulty: m.lastDifficulty || 'standard',
  };
  // Mode: Campaign, Endless, Daily Realm, Sandbox.
  const mseg = el('div', 'seg modeseg');
  const mdesc = el('p', 'hint modedesc');
  for (const id of modes) { const b = el('button', '', MODES[id].name); b.dataset.k = id; tapButton(b, () => setMode(id)); mseg.appendChild(b); }
  if (modes.length > 1) { left.appendChild(mseg); left.appendChild(mdesc); }
  const body = el('div', 'setup-body');   // the people (or today's Daily Realm)
  const body2 = el('div', 'setup-body');  // difficulty, seed and the BUS.setup sections (perks)
  left.appendChild(body); right.appendChild(body2);
  const go = el('button', 'big-btn setup-go', icon('flame') + '<span>Kindle the Hearth</span>');
  let seedInput = null;

  function factionOpen(id) {
    if (opts.mode === 'sandbox') return true;
    return !!FACTIONS[id] && (FACTIONS[id].open || !!BUS.factionUnlocked(m, id));
  }

  function setMode(id) {
    opts.mode = id;
    for (const b of mseg.children) b.classList.toggle('on', b.dataset.k === id);
    mdesc.textContent = MODES[id].desc;
    body.innerHTML = ''; body2.innerHTML = '';
    seedInput = null;
    if (id === 'daily') buildDaily(); else buildFree();
    for (const f of BUS.setup) { try { f(body2, opts, app); } catch (e) { console.error(e); } }
  }

  function buildDaily() {
    const cfg = dailyConfig();
    Object.assign(opts, cfg);
    const f = FACTIONS[cfg.faction];
    const info = el('div', 'panel facinfo');
    info.innerHTML = '<b></b><p class="hint"></p><p class="hint"></p><p class="hint"></p>';
    info.querySelector('b').textContent = `Today's realm: ${cfg.seedText}`;
    const ps = info.querySelectorAll('p');
    ps[0].textContent = `Faction: ${f.name} \u00b7 ${f.people}`;
    ps[1].textContent = `Difficulty: ${BAL.difficulty.standard.label}.`;
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
    // Difficulty
    const seg = el('div', 'seg');
    const desc = el('p', 'hint');
    // (The old "Survive N nights" belonged to the single-region game; a region is 3 nights now.)
    const setDiff = (k) => { opts.difficulty = k; for (const b of seg.children) b.classList.toggle('on', b.dataset.k === k); desc.textContent = BAL.difficulty[k].desc; };
    for (const k of ['story', 'standard', 'brutal']) { const b = el('button', '', BAL.difficulty[k].label); b.dataset.k = k; tapButton(b, () => setDiff(k)); seg.appendChild(b); }
    body2.appendChild(seg); body2.appendChild(desc); setDiff(BAL.difficulty[opts.difficulty] ? opts.difficulty : 'standard');
    // Seed
    const seedRow = el('div', 'seedrow');
    const inp = el('input'); inp.value = randomSeedText(); inp.maxLength = 24; inp.setAttribute('aria-label', 'Seed'); inp.autocapitalize = 'characters'; inp.spellcheck = false;
    const dice = el('button', 'hbtn', icon('dice')); dice.setAttribute('aria-label', 'Random seed'); dice.style.cssText = 'width:52px;height:52px';
    tapButton(dice, () => { inp.value = randomSeedText(); });
    seedRow.append(inp, dice);
    body2.appendChild(seedRow);
    body2.appendChild(el('p', 'hint seedhint', 'The same seed always makes the same realm.'));
    seedInput = inp;
  }

  tapButton(go, () => {
    if (seedInput) opts.seedText = (seedInput.value || randomSeedText()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 24) || randomSeedText();
    if (!factionOpen(opts.faction)) opts.faction = 'dawnhold';
    m.lastMode = opts.mode;
    if (opts.mode !== 'daily') { m.lastDifficulty = opts.difficulty; m.lastFaction = opts.faction; }
    app.saveMeta();
    // The run reads a frozen copy of meta (unlocks, Citadel levels) so later changes never alter it.
    const begin = () => app.flow.newRun({ ...opts, meta: JSON.parse(JSON.stringify(m)) });
    if (!hasRun()) { begin(); return; }
    app.confirm('Leave your saved realm?', 'A realm is still in progress. Starting a new one ends it; the Embers it earned are banked.', () => {
      const r = loadRun();
      if (r.ok) app.flow.abandonSaved(r.state); else clearRun();
      begin();
    }, () => {});
  }, { sound: 'ok' });
  right.appendChild(go);
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

if (!FRAMED && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

// ---- Title and setup layout (one-tap start; the New Realm screen fits a phone without scrolling) --
{
  const st = document.createElement('style');
  st.textContent = `
.title-col { margin-top: 18px; gap: 10px; width: min(320px, 86vw); }
.title-col .big-btn { min-height: 56px; }
.title-play { font-size: 22px; }
.title-screen .tap-begin { margin-top: 14px; font-size: 14px; }
.setup-screen { justify-content: flex-start; gap: 8px; padding-top: calc(var(--pad-t) + 6px); padding-bottom: calc(var(--pad-b) + 8px); }
.setup-bar { position: relative; width: min(460px, 100%); min-height: 44px; display: flex; align-items: center; justify-content: center; flex: none; }
.setup-bar h2 { margin: 0; color: var(--brass-hi); font-size: 24px; line-height: 1.1; }
.setup-back { position: absolute; left: 0; top: 0; width: 44px; height: 44px; }
.setup-col { width: min(460px, 100%); gap: 8px; }
.setup-l, .setup-r, .setup-body { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.setup-screen .seg button { min-height: 46px; }
.setup-screen .facrow { grid-template-columns: repeat(4, 1fr); }
.setup-screen .facbtn { min-height: 62px; padding: 4px 2px; }
.setup-screen .facbtn canvas { width: 30px; height: 30px; }
.setup-screen .facinfo { padding: 8px 12px; font-size: 14px; }
.setup-screen .facinfo p { margin: 3px 0 0; }
.setup-screen .hint { margin: 0; font-size: 14px; line-height: 1.3; }
.setup-screen .seedrow input { min-height: 46px; }
.setup-screen .seedrow .hbtn { width: 46px !important; height: 46px !important; }
.setup-screen .cit-setup { padding: 8px 10px; gap: 6px; }
.setup-screen .cit-slot { min-height: 52px; }
.setup-screen .setup-go { min-height: 54px; }
@media (orientation: landscape) and (max-height: 500px) {
  .setup-screen { gap: 4px; padding-top: calc(var(--pad-t) + 4px); padding-bottom: calc(var(--pad-b) + 4px); }
  .setup-bar { width: min(820px, 100%); }
  .setup-bar h2 { font-size: 22px; }
  .setup-col { width: min(820px, 100%); flex-direction: row; align-items: flex-start; gap: 14px; }
  .setup-l, .setup-r { flex: 1 1 0; min-width: 0; gap: 6px; }
  .setup-body { gap: 6px; }
  .setup-screen .seg button { min-height: 44px; }
  .setup-screen .facbtn { min-height: 56px; }
  .setup-screen .facinfo { padding: 6px 10px; }
  .setup-screen .seedrow input { min-height: 44px; }
  .setup-screen .seedrow .hbtn { width: 44px !important; height: 44px !important; }
  .setup-screen .seedhint { display: none; }
  .setup-screen .cit-setup { padding: 6px 8px; gap: 4px; }
  .setup-screen .cit-slot { min-height: 46px; }
  .setup-screen .setup-go { min-height: 48px; }
}
/* Smaller phones (iPhone SE): drop the two helper lines rather than scroll. */
@media (orientation: portrait) and (max-height: 760px) { .setup-screen .seedhint, .setup-screen .modedesc { display: none; } }
@media (orientation: landscape) and (max-height: 380px) {
  .setup-screen .modedesc { display: none; }
  .setup-screen .facinfo { line-height: 1.2; }
  .setup-l, .setup-r, .setup-body { gap: 4px; }
}`;
  document.head.appendChild(st);
}

// ---- Boot -------------------------------------------------------------------------------
app.meta.settings = { ...DEFAULT_SETTINGS, ...app.meta.settings };
applySettings();
measure();
app.loop.start();
titleScreen();
window.embercrown = app; // handy for debugging in the console
