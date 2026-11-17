// GameController: the in-region scene. Owns the camera, input, renderer
// hookup, HUD, selection and placement, and turns simulation events into
// messages, banners and music (particles and sounds: js/engine/fx.js).
// Player intent goes through cmd() only.
//
// Controls (rework stream F): one language for the Sovereign, squads and heroes.
//   The selection persists. The Sovereign is the default; a portrait (or a tap on a unit)
//   selects that unit; a tap on the ground moves the selected unit and a tap on a foe attacks
//   it, and the selection stays. Tapping the selected portrait again, the crown key (C) or a
//   two-finger tap returns to the Sovereign. There is no slow motion: Plan (pause) stops time
//   and orders and builds still work.
//   Buildings: a tap opens the card (the unit selection is kept). Building: drag from the bar
//   and let go on a valid spot, or tap a bar item for a ghost with ✓/✕ beside it.
import { BAL, RUN } from '../data/balance.js';
import { BUILDINGS } from '../data/buildings.js';
import { UNITS, SOVEREIGN_ABILITIES } from '../data/units.js';
import { ENEMIES } from '../data/enemies.js';
import { BOONS } from '../data/boons.js';
import { T, N, WORLD, idx, tileOf, inB, TER_NAMES } from './grid.js';
import { tick, applyCommand, canPlace, lineTiles, DT } from './sim.js';
import { serializeState } from './state.js';
import { HOOKS, BUS, first } from './hooks.js';
import { BIOMES } from '../data/biomes.js';
import { regionEmbers } from './run.js';
import { NODE_TYPES, nodeTypeFor } from './realmmap.js';
import { showBlueprintDraft } from '../ui/runscreens.js';
import { costHtml } from '../ui/dom.js';
import { canAfford, getE, popCap } from './systems/common.js';
import { isLongNight } from './systems/waves.js';
import { Camera } from '../engine/camera.js';
import { clearSprites } from '../engine/sprites.js';
import { GestureInput } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { handleEvent } from '../engine/fx.js';
import { saveRun, clearRun } from '../engine/save.js';
import { Hud } from '../ui/hud.js';
import { InfoCard } from '../ui/infocard.js';
import { Coach } from '../ui/coach.js';
import { DebugOverlay } from '../ui/debug.js';
import { el, tapButton } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

export class GameController {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.cam = new Camera();
    this.active = false;
    this.speed = 1; this.paused = false;
    this.selection = null; this.placement = null;
    this.ui = { sel: null, bsel: 0, ghost: null, press: null, tapMark: null };
    this.hudRoot = document.getElementById('hud');
    this.input = new GestureInput(app.canvas, this.gestures());
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    this.warnT = Object.create(null);
  }

  // ---- Lifecycle ---------------------------------------------------------------
  start(s) {
    // Building and unit sprites bake in heraldry; a new realm (or a Codex visit) must not reuse them.
    clearSprites();
    this.s = s;
    this.active = true;
    this.outcomeShown = false;
    this.warnT = Object.create(null);
    this.speed = 1; this.paused = false;
    this.selection = null; this.placement = null; this.tool = null; this.focusB = 0; this.nightArmT = 0;
    this.hudRoot.classList.remove('hidden');
    this.hud = new Hud(this.hudRoot, this);
    this.hud.setState(s);
    this.card = new InfoCard(this.hud.cardBox, this);
    this.coach = new Coach(this.hudRoot, this.app.meta, (m) => this.app.saveMeta(m));
    this.coach.reset();
    if (this.app.debug) this.debug = new DebugOverlay(this.hudRoot, this);
    this.renderer.setState(s);
    this.applySettings(this.app.meta.settings);
    this.resize();
    const h = s.rt.hearth;
    this.cam.zoom = this.app.portrait() ? 1.0 : 1.15;
    this.cam.centerOn((h.tx + 1.5) * T, (h.ty + 2.4) * T, false);
    this.music(s.cycle.phase, s.wave?.blood);
    this.lastSave = performance.now();
    this.select(null); // the Sovereign
    if (s.tick === 0) this.showIntro(); else this.app.toasts.show('Region restored. Welcome back, Sovereign.', 'good', 'crown');
    setTimeout(() => this.coach.next(), 400);
  }

  stop() {
    this.active = false;
    this.input.reset();
    this.app.modal.close();
    if (this.debug) { this.debug.remove(); this.debug = null; }
    this.coach?.hide();
    this.hudRoot.classList.add('hidden');
    this.hudRoot.innerHTML = '';
    this.app.toasts.clear();
  }

  showIntro() {
    const s = this.s;
    if (!s.standalone) {
      const node = nodeTypeFor(s.nodeType, s.bossType);
      const det = HOOKS.objectiveDetail ? HOOKS.objectiveDetail(s) : { title: 'Objective', lines: [] };
      const body = el('div');
      body.innerHTML = `<p class="lead"></p><div class="panel" style="padding:10px 14px;margin:6px auto;max-width:460px"><b></b><ul style="margin:6px 0 0;padding-left:20px"></ul></div><p class="lead"></p>`;
      body.querySelectorAll('.lead')[0].textContent = node.blurb + (s.nodeType === 'cursed' ? ' The Hollow here is stronger, and the spoils richer.' : '');
      body.querySelector('b').textContent = det.title;
      for (const l of det.lines) body.querySelector('ul').appendChild(el('li')).textContent = l;
      body.querySelectorAll('.lead')[1].textContent = s.objective.type === 'endless' ? 'Build, hold, and see how long your realm can last.' : 'Meet the objective, then Light the Beacon to move on.';
      this.app.modal.dialog(`${node.name}: ${this.biomeName()}`, body, [{ label: 'Kindle the Hearth', icon: 'flame', onTap: () => { audio.play('dawn'); this.coach.next(); } }]);
      return;
    }
    const body = el('div');
    body.innerHTML = `<p class="lead">The Hollowing has swallowed the old empire. You carry the Heartflame into <b>Greenvale</b> and kindle a new Hearth for the realm of <b></b>.</p>
      <div class="statgrid"><div><b>${s.objective.nights}</b>nights to survive</div><div><b>${BAL.difficulty[s.difficulty].label}</b>difficulty</div><div><b>${s.seedText}</b>seed</div></div>
      <p class="lead">Build by day. At dusk, markers show where the Hollow will come from. Hold the night, then Light the Beacon.</p>`;
    body.querySelectorAll('b')[1].textContent = s.heraldry.name;
    this.app.modal.dialog('Kindle the Hearth', body, [{ label: 'Begin', icon: 'flame', onTap: () => { audio.play('dawn'); this.coach.next(); } }]);
  }

  applySettings(st) {
    this.renderer.settings.damageNumbers = st.damageNumbers;
    this.renderer.settings.reduceMotion = st.reduceMotion;
    this.renderer.particles.reduced = st.reduceMotion;
    this.shakeOn = st.shake && !st.reduceMotion;
    document.body.classList.toggle('lefty', !!st.leftHanded);
    document.body.classList.toggle('reduce-motion', !!st.reduceMotion);
  }

  resize() {
    if (!this.active || !this.hud) return;
    const w = this.app.vw, h = this.app.vh;
    this.cam.resize(w, h, this.app.dpr);
    this.hud.lanes = '';
    this.hud.layoutLanes();
    this.coach?.position();
  }
  /** Keep wave arrows and the ghost clear of the HUD (called by the HUD when its bars move). */
  layoutInsets(top, bottom) {
    const rail = this.hudRoot.querySelector('.rail');
    const rw = rail ? rail.getBoundingClientRect().width + 20 : 76;
    const lefty = document.body.classList.contains('lefty');
    this.renderer.insets = { top: top + 4, bottom: Math.max(40, bottom + 4), left: lefty ? rw : 16, right: lefty ? 16 : rw };
  }

  // ---- Per-frame -------------------------------------------------------------
  timeScale() {
    if (!this.active || this.paused || this.app.modal.open || this.s.pending || this.s.outcome) return 0;
    return this.speed; // selecting never changes time: Plan (pause) is the safe mode
  }

  simTick() {
    if (!this.active) return;
    tick(this.s);
    this.drainFx();
  }

  frame(alpha, dt) {
    if (!this.active) return;
    const s = this.s;
    this.app.loop.timeScale = this.timeScale();
    this.keyPan(dt);
    this.cam.update(dt);
    this.drainFx();
    this.checkSelection();
    this.ui.sel = this.selection;
    this.ui.bsel = this.focusB;
    this.updateGhost();
    this.renderer.draw(s, this.cam, alpha, dt, this.ui);
    this.hud.update(s, dt, this);
    this.card.update(s);
    this.coach.update(s.cycle.phase, this.card.isOpen);
    if (this.debug) this.debug.update(dt, this.app.loop, s);
    this.musicT = (this.musicT || 0) + dt;
    if (this.musicT >= 1) { this.musicT = 0; audio.setIntensity(this.danger()); }
    audio.update();
    // Modal flow: dawn offerings, outcome.
    if (s.outcome && !this.outcomeShown) this.showOutcome();
    else if (s.pending && !this.app.modal.open) this.showPending();
  }

  /** The selected unit must exist: a lost squad or hero hands the selection back to the Sovereign. */
  checkSelection() {
    const s = this.s, sel = this.selection;
    if (!sel) { if (s.sovereign && s.sovereign.alive) this.select(null); return; }
    if (sel.kind === 'sov' && !(s.sovereign && s.sovereign.alive)) { this.selection = null; return; }
    if (sel.kind === 'squad' && !s.squads.some((q) => q.id === sel.id)) this.select(null);
    else if (sel.kind === 'hero') { const h = getE(s, sel.id); if (!h || !h.alive) this.select(null); }
    if (this.focusB && !s.rt.bById.has(this.focusB)) this.focusB = 0;
  }

  // ---- Commands & feedback ------------------------------------------------------
  cmd(c) {
    const r = applyCommand(this.s, c);
    if (!r.ok && r.msg) { this.toast(r.msg, 'bad'); audio.play('error'); }
    else if (r.ok) {
      if (c.t === 'upgrade') { audio.play('coin'); this.toast('Upgrade ordered. Builders are on their way.', 'good', 'up'); }
      if (c.t === 'train') audio.play('coin');
    }
    this.drainFx();
    if (this.card.isOpen) this.card.update(this.s, true);
    return r;
  }
  toast(text, tone = '', ic = null) { this.app.toasts.show(text, tone, ic); }

  // Throttle repeating warnings.
  warn(key, text, sec = 10, ic = null) {
    const now = performance.now() / 1000;
    if (this.warnT[key] && now - this.warnT[key] < sec) return;
    this.warnT[key] = now;
    this.toast(text, 'bad', ic);
  }

  onScreen(x, y, m = 40) { const p = this.cam.worldToScreen(x, y); return p.x > -m && p.y > -m && p.x < this.app.vw + m && p.y < this.app.vh + m; }
  sfxAt(name, x, y, vol = 1) {
    if (!isFinite(x) || !isFinite(y)) { audio.play(name, { vol }); return; }
    const p = this.cam.worldToScreen(x, y);
    const W = this.app.vw, H = this.app.vh;
    const dx = Math.max(0, Math.abs(p.x - W / 2) - W / 2), dy = Math.max(0, Math.abs(p.y - H / 2) - H / 2);
    const fall = Math.max(0, 1 - Math.hypot(dx, dy) / 500);
    if (fall <= 0.04) return;
    audio.play(name, { vol: vol * fall * Math.min(1, 0.55 + this.cam.zoom * 0.35), pan: ((p.x - W / 2) / W) * 1.2 });
  }
  shake(a) { if (this.shakeOn) this.cam.addShake(a); }

  // Simulation events: particles, sounds, shake and hit-stop live in js/engine/fx.js
  // (handleEvent, stream G); this switch keeps only messages, banners, music and saving.
  drainFx() {
    const fx = this.s.rt.fx;
    if (!fx.length) return;
    let laneSays = false; // the HUD's inline action already says what the economy is about to toast
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      handleEvent(this, e);
      if (e.t === 'softlock' && !e.clear && ((e.kind === 'trade' && e.canPay) || e.kind === 'camp')) laneSays = true;
      switch (e.t) {
        case 'destroyed':
          if (e.type !== 'wall') this.toast(`${BUILDINGS[e.type].name} destroyed!`, 'bad', 'skull');
          if (this.focusB && !this.s.rt.bById.has(this.focusB)) this.focusB = 0;
          break;
        case 'dusk': {
          const w = this.s.wave;
          this.music('dusk');
          this.hud.showBanner(w.long || w.blood ? 'THE LONG NIGHT' : 'DUSK', `${w.total} foes, ${w.groups.length} front${w.groups.length > 1 ? 's' : ''}${w.note ? '. ' + w.note : ''}`, w.long || w.blood || w.note ? 'blood' : 'danger', 2000);
          this.coach.event('dusk');
          break;
        }
        case 'night':
          this.music('night', e.blood);
          this.hud.showBanner(`NIGHT ${this.s.cycle.night + 1}`, e.long || e.blood ? 'The Long Night: hold the Hearth.' : 'Hold the light.', e.long || e.blood ? 'blood' : '', 2000);
          this.coach.event('night');
          setTimeout(() => this.coach.event('nightmid'), 15000);
          break;
        case 'dawn':
          audio.setMode('day');
          this.hud.showBanner(`DAWN ${e.night}`, e.gold ? `+${e.gold} gold` : 'The Hollow burns away.', 'dawn', 2400);
          this.autosave();
          if (this.s.mode !== 'sandbox') this.app.meta.best.nights = Math.max(this.app.meta.best.nights, e.night);
          break;
        case 'day':
          if (e.day === 2) this.coach.event('day2');
          if (this.s.wave && (this.s.wave.long || this.s.wave.blood)) this.toast('The Long Night comes tonight: the hardest wave of the region.', 'bad', 'moon');
          break;
        case 'beaconReady':
          this.hud.showBanner('THE BEACON CAN BE LIT', 'Leave now, or stay for more.', 'dawn', 3000);
          break;
        case 'toast': if (!(laneSays && e.icon === 'wood' && e.tone === 'bad')) this.toast(e.text, e.tone, e.icon); break;
        case 'cacheSeen': this.toast('You spot an abandoned cache! Send anyone to fetch it.', 'good', 'eye'); this.ui.tapMark = { x: e.x, y: e.y, t: performance.now(), color: '255,230,120' }; break;
        case 'hearthHit': this.warn('hearth', 'The Hearth is under attack!', 8, 'flame'); break;
        case 'noRes': this.warn('nores' + e.id, 'A camp has nothing left to harvest in range. Tap it for details.', 30, 'info'); break;
        case 'blueprint':
          this.hud.build.setKnown(this.s.blueprints);
          this.toast(`New blueprint: ${BUILDINGS[e.type].name}`, 'good', 'book');
          break;
        case 'bossRoar': this.music('night', this.s.wave?.blood); this.hud.showBanner(e.title || 'THE GLOOMWYRM', e.sub || 'Watch for the warning lines!', 'blood', 3000); break;
        case 'riftFallen': this.hud.showBanner('THE RIFT IS SEALED', 'Light the Beacon by day.', 'dawn', 3000); break;
        case 'bossPhase': audio.setBossPhase(e.phase); this.hud.showBanner(e.title || 'THE WYRM ENRAGES', e.sub || (e.phase === 3 ? 'It will dive at the Hearth!' : 'It calls the Hollow.'), 'blood', 3000); break;
        case 'bossDarkWarn': this.hud.showBanner(`DARKNESS FALLS ${e.left ? '\u2014 ' + e.left : ''}`, 'Get into the light, or stand beside the Sovereign!', 'blood', 1200); break;
        case 'bossSlain': this.music('night', this.s.wave?.blood); break;
      }
      if (BUS.fx.length) for (const f of BUS.fx) f(this, e, this.s);
    }
    fx.length = 0;
  }

  // ---- Saving --------------------------------------------------------------------
  autosave() {
    if (!this.active || this.s.outcome) return;
    const ok = this.app.flow && this.app.flow.run && !this.s.standalone ? this.app.flow.save() : saveRun(serializeState(this.s));
    this.lastSave = performance.now();
    if (!ok) this.warn('save', 'Could not save: storage is full or blocked. Export your save from Settings.', 60);
    this.app.saveMeta(this.app.meta);
  }

  // ---- Modals -------------------------------------------------------------------
  showPending() {
    const s = this.s;
    if (BUS.pendingUI[s.pending.kind]) { BUS.pendingUI[s.pending.kind](this, s); return; }
    if (s.pending.kind === 'blueprint') {
      const opts = s.pending.options.map((t) => ({ type: t, name: BUILDINGS[t].name, desc: BUILDINGS[t].desc, thumb: this.hud.build.thumbs[t] || '', cost: costHtml(BUILDINGS[t].levels[0].cost) }));
      showBlueprintDraft(this.app.modal, opts, (i) => {
        this.cmd({ t: 'choose', i });
        this.autosave();
      }, { title: s.pending.start ? 'Blueprint Draft' : `Dawn ${s.cycle.night}: Blueprint Draft`, lead: 'Learn one new building for the rest of the run. Dawnhold architects offer an extra plan.' });
      return;
    }
    this.showBoon();
  }

  showBoon() {
    const s = this.s;
    const opts = s.pending.options.map((o, i) => {
      const def = BOONS.find((b) => b.id === o.id);
      return { icon: def.icon, title: def.name, text: def.text(o.amount), onPick: () => { this.cmd({ t: 'choose', i }); this.autosave(); this.coach.event('dawnclosed'); } };
    });
    this.app.modal.choice(`Dawn ${s.cycle.night}: An Offering`, 'The survivors bring gifts. Choose one.', opts);
  }

  offerBeacon() {
    const s = this.s;
    const now = s.standalone ? this.emberReward('victory') : regionEmbers(s, 'victory');
    const next = s.standalone ? this.emberReward('victory', 1) - now : Math.round(RUN.embers.perBonusNight * Math.pow(RUN.embers.bonusGrowth, s.bonusNights || 0));
    this.app.modal.dialog('Light the Beacon?', `Leave ${s.heraldry.name} burning now and claim ${now} Embers, safely. Or stay one more night for about +${next} Embers, as the Hollow grows bolder.`, [
      { label: 'Light the Beacon', icon: 'beacon', onTap: () => this.cmd({ t: 'lightBeacon' }) },
      { label: 'Stay a night', cls: 'secondary', icon: 'moon', onTap: () => this.toast('The realm holds on. The Hollow will come again tonight.', '', 'moon') },
    ], { dismissable: true });
  }

  emberReward(result, extraNights = 0) {
    const s = this.s, E = BAL.embers;
    const nights = s.cycle.night + extraNights;
    let e = nights * E.perNight;
    if (result === 'victory') {
      e += E.objective;
      const bonus = Math.max(0, (s.bonusNights || 0) + extraNights);
      for (let i = 0; i < bonus; i++) e += Math.round(E.perBonusNight * Math.pow(E.bonusGrowth, i));
    } else e *= E.lossShare;
    return Math.round(e * BAL.difficulty[s.difficulty].emberMult);
  }

  /** Pick the music for a cycle phase; an act boss on the field always gets its own theme. */
  music(phase, blood) {
    const b = this.s.boss;
    if (b && phase !== 'day' && phase !== 'dawn' && !['dormant', 'slain', 'withdrawn'].includes(b.state)) {
      audio.setMode('boss-' + (b.kind || 'gloomwyrm')); audio.setBossPhase(b.phase || 1);
    } else audio.setMode(phase === 'night' ? (blood ? 'blood' : 'night') : phase === 'dusk' ? 'dusk' : 'day');
  }

  /** Music intensity 0..1: Hollow near the Hearth and the Hearth's wounds (read once a second). */
  danger() {
    const s = this.s, h = s.rt.hearth;
    if (!h || s.cycle.phase === 'day' || s.cycle.phase === 'dawn') return 0;
    const hx = (h.tx + h.size / 2) * T, hy = (h.ty + h.size / 2) * T, R2 = (11 * T) * (11 * T);
    let n = 0;
    for (const e of s.enemies) { if (!e.alive) continue; const dx = e.x - hx, dy = e.y - hy; if (dx * dx + dy * dy < R2) n += e.boss ? 6 : e.affix ? 2 : 1; }
    return Math.min(1, (s.cycle.phase === 'night' ? 0.12 : 0.05) + n / 16 + Math.max(0, 1 - h.hp / h.maxHp) * 0.6);
  }

  showOutcome() {
    this.outcomeShown = true;
    const s = this.s;
    if (!s.standalone && this.app.flow && this.app.flow.run) {
      // Record the result now (saved at once); only the dialog waits a beat.
      const sum = this.app.flow.recordRegion(s);
      audio.setMode('silent');
      if (s.outcome.result !== 'victory') audio.play('defeat');
      setTimeout(() => { if (this.active && this.s === s) this.app.flow.presentRegion(sum); }, s.outcome.result === 'victory' ? 900 : 1600);
      return;
    }
    const win = s.outcome.result === 'victory';
    const embers = this.emberReward(s.outcome.result);
    const m = this.app.meta;
    m.embers += embers; m.runs++; if (win) m.wins++;
    m.best.nights = Math.max(m.best.nights, s.cycle.night);
    this.app.saveMeta(m);
    clearRun();
    audio.setMode('silent');
    audio.play(win ? 'victory' : 'defeat');
    const body = el('div');
    body.innerHTML = `<p class="lead"></p><div class="statgrid">
      <div><b>${s.cycle.night}</b>nights survived</div><div><b>${s.stats.kills}</b>Hollow slain</div>
      <div><b>${s.stats.built}</b>buildings raised</div><div><b>${s.stats.villagersLost}</b>villagers lost</div>
      <div><b>+${embers}</b>Embers earned</div><div><b>${m.embers}</b>Embers banked</div></div>
      <p class="hint">Seed <b>${s.seedText}</b>: share it to let a friend play the same region.</p>`;
    body.querySelector('.lead').textContent = s.outcome.reason;
    this.app.modal.dialog(win ? 'Victory: the Beacon Burns' : 'The Flame Fades', body, [
      { label: 'New Realm', icon: 'flame', onTap: () => this.app.toSetup() },
      { label: 'Title', cls: 'secondary', onTap: () => this.app.toMenu() },
    ]);
  }

  // Any open modal freezes the simulation, so the pause menu needs no extra state.
  openPauseMenu() {
    if (this.s.outcome) return; // the region is over; its result is already on screen or on its way
    const d = el('div', 'dialog panel');
    d.appendChild(el('h2', '', 'Paused'));
    d.appendChild(el('p', 'lead')).textContent = `${this.s.heraldry.name} · Day ${this.s.cycle.night + 1} · seed ${this.s.seedText}`;
    const body = el('div', 'menu-col');
    body.style.margin = '0 auto';
    const mk = (label, ic, fn, cls = '') => {
      const b = el('button', 'big-btn ' + cls, icon(ic) + '<span></span>');
      b.querySelector('span').textContent = label;
      tapButton(b, fn);
      body.appendChild(b);
      return b;
    };
    mk('Resume', 'play', () => this.app.modal.close());
    const snd = mk(audio.muted ? 'Sound: off' : 'Sound: on', audio.muted ? 'mute' : 'sound', () => {
      this.toggleMute();
      snd.innerHTML = icon(audio.muted ? 'mute' : 'sound') + '<span></span>';
      snd.querySelector('span').textContent = audio.muted ? 'Sound: off' : 'Sound: on';
    }, 'secondary');
    const tips = mk(this.coach.tipsOn ? 'Tips: on' : 'Tips: off', 'info', () => {
      this.coach.setTips(!this.coach.tipsOn);
      tips.querySelector('span').textContent = this.coach.tipsOn ? 'Tips: on' : 'Tips: off';
    }, 'secondary');
    mk('Settings', 'gear', () => this.app.openSettings(() => this.openPauseMenu()), 'secondary');
    mk('How to Play', 'book', () => this.app.openHelp(() => this.openPauseMenu()), 'secondary');
    mk('Save & Quit', 'export', () => { this.autosave(); this.app.modal.close(); this.app.toMenu(); this.app.toasts.show('Realm saved.', 'good'); }, 'secondary');
    mk('Abandon Realm', 'skull', () => this.app.confirm('Abandon this realm?', 'The run ends as a defeat (partial Embers are still earned).', () => { this.s.outcome = { result: 'defeat', reason: 'You abandoned the realm to the Hollow.' }; }, () => this.openPauseMenu()), 'danger');
    d.appendChild(body);
    this.app.modal.show(d, { dismissable: true });
  }

  // ---- HUD actions ----------------------------------------------------------------
  /** Plan: stop time. Orders and building still work while planning. */
  togglePause() {
    this.paused = !this.paused;
    this.hud.setPlanning(this.paused);
  }
  cycleSpeed() { this.speed = this.speed >= 3 ? 1 : this.speed + 1; this.hud.setSpeed(this.speed); }
  /** Call the Night: the first tap arms the button, a second tap within 2.5 s calls it (no dialog). */
  callNight() {
    if (this.s.cycle.phase !== 'day') { this.toast('You can only call the night during the day.', 'bad'); return; }
    const now = performance.now();
    if (this.nightArmT && now - this.nightArmT < 2500) {
      this.nightArmT = 0;
      this.hud.setNightArmed(false);
      if (this.placement) this.cancelPlacement();
      this.cmd({ t: 'callNight' });
      this.coach.event('callnight');
      return;
    }
    this.nightArmT = now;
    this.hud.setNightArmed(true);
    setTimeout(() => { if (this.nightArmT === now) { this.nightArmT = 0; if (this.hud) this.hud.setNightArmed(false); } }, 2500);
  }
  toggleMute() {
    audio.setMuted(!audio.muted);
    this.app.meta.settings.muted = audio.muted; this.app.saveMeta(this.app.meta);
  }
  ability(name) {
    const r = this.cmd({ t: 'ability', name });
    if (!r.ok) audio.play('error');
  }
  explainAbility(name) { const a = SOVEREIGN_ABILITIES[name]; this.openText(a.name, `Cooldown ${a.cooldown}s`, a.desc, name === 'nova' ? 'nova' : 'banner'); }
  explainResource(k) {
    const t = {
      food: 'Food: grown by Farms. Villagers and soldiers eat it. At zero, villagers leave.',
      wood: 'Wood: cut by Lumber Camps near trees. Most buildings and repairs need it.',
      stone: 'Stone: cut by Quarries near grey rock. Walls, towers, upgrades and repairs.',
      gold: 'Gold: taxes from Houses and the dawn income. Pays for soldiers and upgrades.',
      pop: 'Population: villagers / housing. Houses add room; newcomers arrive by day while food lasts.',
      idle: 'Idle villagers: nobody gives them work. Build or staff a workplace.',
    }[k];
    this.toast(t, '', k === 'idle' ? 'hoe' : k);
  }
  biomeName() { return (BIOMES[this.s.biome] && BIOMES[this.s.biome].name) || 'Greenvale'; }

  explainObjective() {
    const det = HOOKS.objectiveDetail ? HOOKS.objectiveDetail(this.s) : null;
    if (det) this.openText(det.title, this.s.beaconReady ? 'Met: Light the Beacon when ready' : 'Region objective', det.lines, 'beacon');
  }

  explainCycle() {
    const s = this.s, c = s.cycle;
    const w = s.wave;
    const n = c.phase === 'dawn' ? c.night + 1 : c.night + 1;
    let k = 0;
    while (!isLongNight(n + k, s) && k < 12) k++;
    const ln = k === 0 ? 'The Long Night is tonight.' : k < 12 ? `The Long Night in ${k} night${k > 1 ? 's' : ''}.` : '';
    let head;
    if (c.phase === 'day') head = 'Build until dusk, or Call the Night.';
    else if (c.phase === 'dusk') head = 'Dusk: move to meet the fronts.';
    else if (c.phase === 'night') head = 'Night: the number is the foes left.';
    else head = 'Dawn.';
    const tonight = w && w.n === n ? ` Tonight: about ${w.total} Hollow, ${w.groups.length} front${w.groups.length > 1 ? 's' : ''}.` : '';
    this.toast(`${head}${tonight} ${ln}`.trim(), w && (w.long || w.blood) && c.phase !== 'day' ? 'bad' : '', 'moon');
  }
  explainSquad(id) {
    if (id === 'sov') { const v = this.s.sovereign; if (v) this.card.open('unit', v.id); return; }
    const q = this.s.squads.find((x) => x.id === id);
    if (q) this.openText(q.name, 'Squad', 'Tap the portrait to select it. Then every tap on the ground moves it there and a tap on a foe attacks, until you select another unit. Soldiers fight anything that comes near their flag. Double-tap the portrait to find them.', 'sword');
  }
  openText(title, sub, text, ic) { this.card.open('text', { title, sub, text, ic }); }
  openBuildInfo(type) { this.card.open('buildtype', type); }
  closeCard() { this.card.close(); this.focusB = 0; }

  // ---- Selection ------------------------------------------------------------------
  /** Select a unit ({kind:'sov'|'squad'|'hero', id}); null returns to the Sovereign. A building
   *  selection only highlights it for its card and keeps the unit selection. */
  select(sel) {
    if (sel && sel.kind === 'building') { this.focusB = sel.id; return; }
    if (!sel) sel = this.s && this.s.sovereign && this.s.sovereign.alive ? { kind: 'sov' } : null;
    const was = this.selection;
    this.selection = sel;
    if (sel && sel.kind === 'sov' && !(was && was.kind === 'sov')) this.coach.event('select:sov');
    if (sel && sel.kind === 'squad') this.coach.event('select:squad');
  }
  isSelected(id) {
    const sel = this.selection;
    if (!sel) return false;
    return (id === 'sov' && sel.kind === 'sov') || (sel.kind !== 'sov' && sel.id === id);
  }
  selectSquad(id) {
    if (this.placement) this.cancelPlacement();
    if (this.tool) { const T = BUS.tools[this.tool.name]; if (T && T.cancel) T.cancel(this); this.setTool(null); }
    // Tapping the selected portrait again returns to the Sovereign.
    if (this.isSelected(id)) { if (id !== 'sov') { this.select(null); audio.play('click'); } return; }
    this.select(id === 'sov' ? { kind: 'sov' } : { kind: 'squad', id });
    if (this.card.isOpen && this.card.kind !== 'building') this.card.close();
  }
  centerOnSquad(id) {
    const s = this.s;
    if (id === 'sov') { if (s.sovereign) this.cam.centerOn(s.sovereign.x, s.sovereign.y); }
    else { const u = s.soldiers.find((x) => x.squad === id); const q = s.squads.find((x) => x.id === id); if (u) this.cam.centerOn(u.x, u.y); else if (q) this.cam.centerOn(q.rx, q.ry); }
    if (!this.isSelected(id)) this.selectSquad(id);
  }

  /** Give the selected unit the order for a map hit: attack a foe, otherwise move there. */
  order(hit) {
    const sel = this.selection;
    if (!sel) return false;
    const foe = hit.kind === 'enemy' ? hit.e : null;
    let c;
    if (sel.kind === 'sov') c = foe ? { t: 'sovAttack', target: foe.id } : { t: 'sovMove', x: hit.w.x, y: hit.w.y };
    else if (sel.kind === 'squad') c = foe ? { t: 'squadAttack', id: sel.id, target: foe.id } : { t: 'squadMove', id: sel.id, x: hit.w.x, y: hit.w.y };
    else if (sel.kind === 'hero') c = foe ? { t: 'heroAttack', id: sel.id, target: foe.id } : { t: 'heroMove', id: sel.id, x: hit.w.x, y: hit.w.y };
    else return false;
    const r = this.cmd(c);
    if (!r.ok) return true;
    if (foe) { this.ui.tapMark = { x: foe.x, y: foe.y, t: performance.now(), color: '255,110,90' }; audio.play('clash'); }
    else { this.ui.tapMark = { x: hit.w.x, y: hit.w.y, t: performance.now() }; audio.play('ok'); }
    this.coach.event('order:' + sel.kind);
    return true;
  }

  // ---- Placement -----------------------------------------------------------------
  local(clientX, clientY) { const r = this.app.canvas.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top }; }
  /** Clamp a screen point into the free map area (between the HUD bars, clear of the rail). */
  clampFree(x, y, m = 16) {
    const ins = this.renderer.insets || { top: 60, bottom: 100, left: 16, right: 76 };
    return { x: Math.max(ins.left + m, Math.min(this.app.vw - ins.right - m, x)), y: Math.max(ins.top + m, Math.min(this.app.vh - ins.bottom - m, y)) };
  }
  tileUnder(sx, sy, type) {
    const w = this.cam.screenToWorld(sx, sy);
    const size = BUILDINGS[type].size;
    return [Math.floor(w.x / T - size / 2 + 0.5), Math.floor(w.y / T - size / 2 + 0.5)];
  }
  /** The tile a finger at (sx, sy) puts a ghost on: 32 px above the finger, inside the free area. */
  fingerTile(sx, sy, type) {
    const c = this.clampFree(sx, sy - 32);
    return this.tileUnder(c.x, c.y, type);
  }
  beginPlacement(type, clientX, clientY) {
    if (this.tool) { const T = BUS.tools[this.tool.name]; if (T && T.cancel) T.cancel(this); this.setTool(null); }
    this.card.close(); this.focusB = 0;
    let anchor;
    if (clientX == null) {
      const c = this.clampFree(this.app.vw / 2, this.app.vh * 0.45);
      anchor = this.nearestValid(type, this.tileUnder(c.x, c.y, type));
    } else { const p = this.local(clientX, clientY); anchor = this.fingerTile(p.x, p.y, type); }
    this.placement = { type, anchor, end: anchor.slice(), fromBar: clientX != null };
    if (BUILDINGS[type].line) this.placement.end = [anchor[0] + 2, anchor[1]];
  }
  // Spiral out from a tile to the closest spot where the building fits.
  nearestValid(type, [ax, ay]) {
    for (let r = 0; r <= 7; r++) {
      let best = null, bd = 1e9;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlace(this.s, type, ax + dx, ay + dy).ok) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [ax + dx, ay + dy]; } }
      }
      if (best) return best;
    }
    return [ax, ay];
  }
  dragPlacement(clientX, clientY) {
    if (!this.placement) return;
    const p = this.local(clientX, clientY);
    const a = this.fingerTile(p.x, p.y, this.placement.type);
    const dx = this.placement.end[0] - this.placement.anchor[0], dy = this.placement.end[1] - this.placement.anchor[1];
    this.placement.anchor = a; this.placement.end = [a[0] + dx, a[1] + dy];
  }
  /** The finger left the screen after dragging a building out of the bar: build it there in one
   *  gesture. Letting go over the HUD cancels; an invalid spot cancels with the reason. A wall
   *  keeps its ghost so its line can be drawn with the handle. */
  dropPlacement(clientX, clientY, cancelled) {
    const pl = this.placement;
    if (!pl) return;
    pl.fromBar = false;
    const at = clientX == null ? null : document.elementFromPoint(clientX, clientY);
    if (cancelled || !at || at.id !== 'view') { this.cancelPlacement(); return; }
    const p = this.local(clientX, clientY);
    const a = this.fingerTile(p.x, p.y, pl.type);
    const dx = pl.end[0] - pl.anchor[0], dy = pl.end[1] - pl.anchor[1];
    pl.anchor = a; pl.end = [a[0] + dx, a[1] + dy];
    if (BUILDINGS[pl.type].line) return;
    this.updateGhost();
    const g = this.ui.ghost;
    if (g && g.valid.some(Boolean)) this.confirmPlacement();
    else { audio.play('error'); this.toast(`${BUILDINGS[pl.type].name}: ${(g && g.reason) || 'cannot build there'}.`, 'bad'); this.cancelPlacement(); }
  }
  cancelPlacement() { this.placement = null; this.ui.ghost = null; this.ghostDrag = null; if (this.hud) this.hud.setPlacement(null); this.coach.suppress(false); }
  confirmPlacement() {
    const g = this.ui.ghost;
    if (!g) return;
    const tiles = g.tiles.filter((_, i) => g.valid[i]);
    if (!tiles.length) { audio.play('error'); this.toast(g.reason || 'Cannot build there.', 'bad'); return; }
    const r = this.cmd({ t: 'place', type: g.type, tiles });
    if (r.ok) {
      this.coach.event('placed:' + g.type);
      if (BUILDINGS[g.type].line && r.placed < g.tiles.length) this.toast(`Placed ${r.placed} of ${g.tiles.length} segments.`, '');
      this.cancelPlacement();
    }
  }
  /** The ghost's footprint on screen (px). */
  ghostRect(g) {
    const def = BUILDINGS[g.type];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [tx, ty] of g.tiles) { x0 = Math.min(x0, tx); y0 = Math.min(y0, ty); x1 = Math.max(x1, tx + def.size); y1 = Math.max(y1, ty + def.size); }
    const a = this.cam.worldToScreen(x0 * T, y0 * T - (def.line ? 0 : 20)), b = this.cam.worldToScreen(x1 * T, y1 * T);
    return { l: a.x, t: a.y, r: b.x, b: b.y };
  }
  inGhost(p, slack = 12) {
    const g = this.ui.ghost;
    if (!g) return false;
    const R = this.ghostRect(g);
    return p.x > R.l - slack && p.x < R.r + slack && p.y > R.t - slack && p.y < R.b + slack;
  }
  updateGhost() {
    const p = this.placement;
    if (!p) { this.ui.ghost = null; return; }
    this.coach.suppress(true);
    const def = BUILDINGS[p.type];
    const tiles = def.line ? lineTiles(p.anchor[0], p.anchor[1], p.end[0], p.end[1]) : [p.anchor];
    const cost = def.levels[0].cost;
    const valid = []; let reason = '';
    let n = 0;
    for (const [tx, ty] of tiles) {
      const v = canPlace(this.s, p.type, tx, ty);
      let ok = v.ok;
      if (ok) {
        const mult = n + 1;
        const tot = {}; for (const k in cost) tot[k] = cost[k] * mult;
        if (!canAfford(this.s.res, tot)) { ok = false; reason = 'Not enough resources'; } else n++;
      } else reason = v.reason;
      valid.push(ok);
    }
    const end = def.line ? tiles[tiles.length - 1] : null;
    p.end = def.line ? [end[0], end[1]] : p.end;
    this.ui.ghost = { type: p.type, tiles, valid, handle: end, reason };
    const costTxt = Object.entries(cost).map(([k, v]) => `${v * Math.max(1, n)} ${k}`).join(', ');
    const anyOk = valid.some(Boolean);
    const hint = p.fromBar
      ? (anyOk ? `${def.name}: let go to build (${costTxt})` : `${def.name}: ${reason}`)
      : anyOk ? `${def.name}${n > 1 ? ' ×' + n : ''}: ${costTxt}. ${def.line ? 'Drag the handle to draw a line.' : 'Drag to move.'}` : `${def.name}: ${reason}`;
    if (p.fromBar) { this.hud.setPlacement(null); this.hud.placeHint.classList.remove('hidden'); if (this.hud.placeHint.textContent !== hint) this.hud.placeHint.textContent = hint; return; }
    // ✓ and ✕ beside the ghost: right of it, or left near the right edge; clear of the HUD.
    const R = this.ghostRect(this.ui.ghost);
    const ins = this.renderer.insets;
    const bw = 52, bh = 52 * 2 + 10;
    let x = R.r + 10;
    if (x + bw > this.app.vw - ins.right + 8) x = R.l - 10 - bw;
    x = Math.max(8, Math.min(this.app.vw - bw - 8, x));
    let y = (R.t + R.b) / 2 - bh / 2;
    y = Math.max(ins.top + 4, Math.min(this.app.vh - ins.bottom - bh - 4, y));
    this.hud.setPlacement({ x, y }, anyOk, hint);
  }

  // ---- Map gestures ----------------------------------------------------------------
  gestures() {
    return {
      press: (p) => { if (this.active) this.ui.press = { x: p.x, y: p.y, t: performance.now() + 140 }; },
      release: () => { this.ui.press = null; },
      tap: (p) => { this.ui.press = null; if (this.active && !this.app.modal.open) this.onTap(p); },
      longpress: (p) => { this.ui.press = null; if (this.active && !this.app.modal.open) this.onLongPress(p); },
      dragstart: (p) => {
        this.ui.press = null;
        if (!this.active) return;
        this.cam.focus = null; this.cam.vx = this.cam.vy = 0;
        this.ghostDrag = null;
        if (this.placement && this.ui.ghost) {
          const g = this.ui.ghost;
          const w = this.cam.screenToWorld(p.x, p.y);
          const def = BUILDINGS[g.type];
          if (def.line && g.handle && Math.hypot(w.x - (g.handle[0] + 0.5) * T, w.y - (g.handle[1] + 0.5) * T) < Math.max(26, 30 / this.cam.zoom)) this.ghostDrag = 'handle';
          else if (this.inGhost(p, 16)) {
            const [tx, ty] = g.tiles[0];
            this.ghostDrag = 'move';
            this.dragOff = [w.x - tx * T, w.y - ty * T];
          }
        }
      },
      dragmove: (p, dx, dy) => {
        if (!this.active) return;
        if (this.ghostDrag && this.placement) {
          const c = this.clampFree(p.x, p.y, 4);
          const w = this.cam.screenToWorld(c.x, c.y);
          if (this.ghostDrag === 'handle') this.placement.end = [tileOf(w.x), tileOf(w.y)];
          else {
            const a = [Math.round((w.x - this.dragOff[0]) / T), Math.round((w.y - this.dragOff[1]) / T)];
            const ddx = this.placement.end[0] - this.placement.anchor[0], ddy = this.placement.end[1] - this.placement.anchor[1];
            this.placement.anchor = a; this.placement.end = [a[0] + ddx, a[1] + ddy];
          }
          this.edgeScroll(p);
          return;
        }
        this.cam.panBy(dx, dy);
      },
      dragend: (p, cancelled, vx = 0, vy = 0) => {
        if (!this.active) return;
        if (this.ghostDrag) { this.ghostDrag = null; return; }
        if (!cancelled && !this.app.settings().reduceMotion) { this.cam.vx = -vx / this.cam.zoom; this.cam.vy = -vy / this.cam.zoom; }
      },
      pinch: (k, cx, cy, dx, dy) => { if (!this.active) return; this.cam.zoomAt(k, cx, cy); this.cam.panBy(dx, dy); },
      twofingertap: () => { if (this.active) this.cancelAll(); },
      wheel: (dy, p) => { if (this.active) this.cam.zoomAt(Math.exp(-dy * 0.0016), p.x, p.y); },
      cancel: () => { if (this.active) this.cancelAll(); },
      hover: () => {},
    };
  }
  edgeScroll(p) {
    const m = 50, k = 6;
    const ins = this.renderer.insets;
    if (p.x < ins.left + m * 0.5) this.cam.panBy(k, 0); else if (p.x > this.app.vw - ins.right - m * 0.5) this.cam.panBy(-k, 0);
    if (p.y < ins.top + m * 0.5) this.cam.panBy(0, k); else if (p.y > this.app.vh - ins.bottom - m * 0.5) this.cam.panBy(0, -k);
  }
  cancelAll() {
    if (this.tool) { const T = BUS.tools[this.tool.name]; if (T && T.cancel) T.cancel(this); this.setTool(null); return; }
    if (this.placement) this.cancelPlacement();
    else if (this.card.isOpen) this.closeCard();
    else this.select(null);
  }

  /** What is under a screen point. Movers (the Sovereign, soldiers, foes, heroes) are picked by
   *  the nearest centre, not by type; while a unit is selected foes win close calls (an order). */
  pick(p, { enemiesFirst = false } = {}) {
    const s = this.s;
    const w = this.cam.screenToWorld(p.x, p.y);
    const R = Math.max(16, 22 / this.cam.zoom);
    let best = null, bd = Infinity;
    const consider = (kind, e, cx, cy, r, slack = 0, bias = 1) => {
      const d = (Math.hypot(cx - w.x, cy - w.y) - slack) * bias;
      if (d < r * bias && d < bd) { bd = d; best = { kind, e, w }; }
    };
    const v = s.sovereign;
    if (v && v.alive) consider('sov', v, v.x, v.y - 12, R * 1.2);
    for (const e of s.soldiers) if (e.alive) consider('soldier', e, e.x, e.y - 10, R);
    for (const e of s.heroes || []) if (e.alive) consider('hero', e, e.x, e.y - 10, R * 1.1);
    for (const e of s.enemies) {
      if (!e.alive) continue;
      // Big foes are big targets; the wyrm is hit where its body is drawn, not its shadow.
      const oy = e.boss ? (e.z || 0) + 16 : e.type === 'rift' ? 6 : e.type === 'lair' ? 14 : 10;
      const slack = e.boss ? 45 : e.type === 'rift' ? 34 : e.type === 'lair' ? 30 : 0;
      consider('enemy', e, e.x, e.y - oy, R * 1.2, slack, enemiesFirst ? 0.8 : 1);
    }
    if (best) return best;
    let vil = null, vd = R * 0.8;
    for (const e of s.villagers) {
      if (!e.alive || e.st === 'sheltered') continue;
      const d = Math.hypot(e.x - w.x, e.y - 10 - w.y);
      if (d < vd) { vd = d; vil = e; }
    }
    const tx = tileOf(w.x), ty = tileOf(w.y);
    // Tall sprites (towers, the Hearth) are drawn above their footprint, so
    // also test the tiles just below the finger.
    for (const [x, y, tallOnly] of [[tx, ty, false], [tx, ty + 1, false], [tx, ty + 2, true]]) {
      if (!inB(x, y)) continue;
      const b = s.occ[idx(x, y)];
      if (!b) continue;
      const bd2 = s.rt.bById.get(b);
      if (bd2 && (!tallOnly || bd2.type === 'tower' || bd2.type === 'hearth')) return { kind: 'building', b: bd2, w };
    }
    if (vil) return { kind: 'villager', e: vil, w };
    if (inB(tx, ty)) {
      const c = s.caches.find((q) => !q.taken && q.tx === tx && q.ty === ty && s.fog[idx(tx, ty)]);
      if (c) return { kind: 'cache', c, w };
      const nid = s.nodeGrid[idx(tx, ty)] || (inB(tx, ty + 1) ? s.nodeGrid[idx(tx, ty + 1)] : 0);
      if (nid && s.fog[idx(tx, ty)]) return { kind: 'node', n: s.rt.nById.get(nid), w };
      return { kind: 'tile', tx, ty, w };
    }
    return { kind: 'void', w };
  }

  /** Generic map tool mode used by plug-ins. A hero's order tool is the ordinary selection now. */
  setTool(name, data = null) {
    if (name === 'heroOrder') { if (this.tool) this.setTool(null); return; }
    if (this.placement) this.cancelPlacement();
    this.tool = name ? { name, data } : null;
    const T = name ? BUS.tools[name] : null;
    this.hud.setToolHint(T ? (typeof T.hint === 'function' ? T.hint(this) : T.hint) : null);
  }

  onTap(p) {
    if (this.tool) {
      const tool = BUS.tools[this.tool.name];
      if (!tool) { this.setTool(null); return; }
      if (tool.tap(this, p, this.cam.screenToWorld(p.x, p.y))) this.setTool(null);
      return;
    }
    if (this.placement) {
      // A tap on the ghost does nothing (drag it to move it); anywhere else drops it and counts as a tap.
      if (this.inGhost(p)) return;
      this.cancelPlacement();
    }
    const sel = this.selection;
    const hit = this.pick(p, { enemiesFirst: !!sel });
    // An open card is dismissed by a tap on the map (no order rides on that tap).
    if (this.card.isOpen && hit.kind !== 'building' && hit.kind !== 'soldier' && hit.kind !== 'hero' && hit.kind !== 'sov') { this.closeCard(); return; }
    switch (hit.kind) {
      case 'sov':
        if (sel && sel.kind === 'sov') { this.order({ kind: 'tile', w: { x: hit.e.x, y: hit.e.y } }); this.ui.tapMark = { x: hit.e.x, y: hit.e.y, t: performance.now(), color: '240,192,64' }; }
        else { this.selectSquad('sov'); audio.play('click'); }
        return;
      case 'soldier':
        if (!this.isSelected(hit.e.squad)) { this.selectSquad(hit.e.squad); audio.play('click'); }
        return;
      case 'hero':
        if (BUS.tapEntity.hero) BUS.tapEntity.hero(this, hit.e); else this.card.open('unit', hit.e.id);
        return;
      case 'building':
        audio.play('click'); this.focusB = hit.b.id; this.card.open('building', hit.b.id);
        return;
      case 'enemy':
        if (sel) this.order(hit); else this.card.open('enemy', hit.e.id);
        return;
      case 'cache':
        if (sel) this.order({ kind: 'tile', w: { x: (hit.c.tx + 0.5) * T, y: (hit.c.ty + 0.5) * T } });
        else this.openText('Abandoned Cache', 'Unclaimed supplies', 'Anyone of yours who walks next to it brings it home.', 'eye');
        return;
      case 'void': return;
      default:
        if (sel) { this.order(hit); return; }
        // Nothing selected (the Sovereign has fallen): a tap on empty ground does nothing.
        if (hit.kind === 'tile') first(BUS.tapTile, this, hit.tx, hit.ty, hit.w);
        else if (hit.kind === 'villager') this.card.open('unit', hit.e.id);
        else if (hit.kind === 'node') this.explainNode(hit.n);
    }
  }

  onLongPress(p) {
    const hit = this.pick(p);
    switch (hit.kind) {
      case 'sov': case 'soldier': case 'villager': this.card.open('unit', hit.e.id); break;
      case 'hero': if (BUS.tapEntity.hero) BUS.tapEntity.hero(this, hit.e); break;
      case 'enemy': this.card.open('enemy', hit.e.id); break;
      case 'building': this.focusB = hit.b.id; this.card.open('building', hit.b.id); break;
      case 'node': this.explainNode(hit.n); break;
      case 'cache': this.openText('Abandoned Cache', 'Unclaimed supplies', 'Walk anyone of yours next to it to claim it.', 'eye'); break;
      case 'tile': {
        const s = this.s;
        const i = idx(hit.tx, hit.ty);
        if (!s.fog[i]) { this.openText('Unexplored', 'Fog of war', 'Send the Sovereign or a squad to explore. Buildings and towers reveal the land around them.', 'eye'); break; }
        const t = s.terrain[i];
        const lit = s.lit[i] ? ' Lit: the Hollow takes 25% more damage here.' : '';
        this.openText(TER_NAMES[t], 'Terrain', (t === 4 ? 'Impassable water.' : t === 5 ? 'Impassable rock. Natural walls shape the Hollow’s path.' : 'Open land. Good for building.') + lit, 'map');
        break;
      }
      default: break;
    }
  }

  explainNode(n) {
    if (!n) return;
    if (n.kind === 'tree') this.openText('Tree', `${n.amount} wood left`, 'Trees block movement. Lumber Camps in range fell them for wood, which also opens paths.', 'axe');
    else this.openText('Boulder', `${n.amount} stone left`, 'Grey rock. Place a Quarry within range to cut stone.', 'pick');
  }

  // ---- Minimap ---------------------------------------------------------------------
  drawMinimap(c) {
    const s = this.s;
    const g = c.getContext('2d');
    const k = c.width / N;
    if (this.miniFog !== this.renderer.fogVersion || !this.miniBase) {
      this.miniFog = this.renderer.fogVersion;
      const b = this.miniBase || (this.miniBase = document.createElement('canvas'));
      b.width = b.height = c.width;
      const bg = b.getContext('2d');
      const cols = ['#5f8f3e', '#7aa852', '#8a6a43', '#c7b07a', '#3c6f8f', '#6c6a66'];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const i = idx(x, y);
        bg.fillStyle = s.fog[i] ? (s.nodeGrid[i] ? '#3f6a2c' : cols[s.terrain[i]]) : '#1b1a24';
        bg.fillRect(x * k, y * k, k + 0.5, k + 0.5);
      }
      if (!c._wired) {
        c._wired = true;
        c.addEventListener('pointerdown', (e) => {
          const r = c.getBoundingClientRect();
          this.cam.centerOn(((e.clientX - r.left) / r.width) * WORLD, ((e.clientY - r.top) / r.height) * WORLD);
          audio.play('click');
        });
      }
    }
    g.drawImage(this.miniBase, 0, 0);
    for (const b of s.buildings) { g.fillStyle = b.type === 'hearth' ? '#ffcf5a' : '#e0a040'; g.fillRect(b.tx * k, b.ty * k, b.size * k, b.size * k); }
    g.fillStyle = '#9fd0ff';
    for (const u of s.soldiers) g.fillRect(u.x / T * k - 1.5, u.y / T * k - 1.5, 3, 3);
    if (s.sovereign) { g.fillStyle = '#fff'; g.fillRect(s.sovereign.x / T * k - 2.5, s.sovereign.y / T * k - 2.5, 5, 5); }
    g.fillStyle = '#ff5a5a';
    for (const e of s.enemies) if (!e.stationary && !e.boss) g.fillRect(e.x / T * k - 1.5, e.y / T * k - 1.5, 3, 3);
    for (const e of s.enemies) {
      if (!e.alive || !(e.stationary || e.boss)) continue;
      g.fillStyle = e.boss ? '#e0b0ff' : '#a070e0';
      g.beginPath(); g.arc(e.x / T * k, e.y / T * k, e.boss ? 6 : 5, 0, 6.283); g.fill();
    }
    if (s.wave && s.cycle.phase === 'dusk') { g.fillStyle = '#ff3030'; for (const gr of s.wave.groups) { g.beginPath(); g.arc((gr.sp.tx + 0.5) * k, (gr.sp.ty + 0.5) * k, 6, 0, 6.283); g.fill(); } }
    const tl = this.cam.screenToWorld(0, 0), br = this.cam.screenToWorld(this.app.vw, this.app.vh);
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
    g.strokeRect(tl.x / T * k, tl.y / T * k, (br.x - tl.x) / T * k, (br.y - tl.y) / T * k);
  }

  // ---- Keyboard (desktop bonus) --------------------------------------------------------
  key(e, down) {
    if (!this.active || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else this.keys.delete(k);
    if (!down || this.app.modal.open) { if (down && k === 'escape' && this.app.modal.open && this.app.modal.dismissable) this.app.modal.close(); return; }
    switch (k) {
      case ' ': e.preventDefault(); this.togglePause(); break;
      case '1': case '2': case '3': this.speed = +k - 1; this.cycleSpeed(); break;
      case 'escape': this.cancelAll(); break;
      case 'n': this.ability('nova'); break;
      case 'b': this.ability('banner'); break;
      case 'm': this.hud.toggleMinimap(); break;
      case 'h': { const h = this.s.rt.hearth; if (h) this.cam.centerOn((h.tx + 1.5) * T, (h.ty + 1.5) * T); break; }
      case 'c': this.select(null); break;
      case '=': case '+': this.cam.zoomAt(1.15, this.app.vw / 2, this.app.vh / 2); break;
      case '-': this.cam.zoomAt(1 / 1.15, this.app.vw / 2, this.app.vh / 2); break;
      case 'enter': if (this.placement) this.confirmPlacement(); break;
      default: break;
    }
  }
  keyPan(dt) {
    if (!this.keys.size) return;
    const v = 700 * dt;
    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += v;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= v;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += v;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= v;
    if (dx || dy) this.cam.panBy(dx, dy);
  }
}
void UNITS; void ENEMIES; void getE; void popCap; void DT;
