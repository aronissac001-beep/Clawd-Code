// GameController: the in-region scene. Owns the camera, input, renderer
// hookup, HUD, selection and placement, and turns simulation events into
// sound, particles and messages. Player intent goes through cmd() only.
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
import { NODE_TYPES } from './realmmap.js';
import { showBlueprintDraft } from '../ui/runscreens.js';
import { costHtml } from '../ui/dom.js';
import { canAfford, getE, popCap } from './systems/common.js';
import { isBloodMoon } from './systems/waves.js';
import { Camera } from '../engine/camera.js';
import { GestureInput } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { saveRun, clearRun } from '../engine/save.js';
import { Hud } from '../ui/hud.js';
import { InfoCard } from '../ui/infocard.js';
import { Coach } from '../ui/coach.js';
import { DebugOverlay } from '../ui/debug.js';
import { el, tapButton } from '../ui/dom.js';
import { icon } from '../ui/icons.js';

const RES_COLOR = { food: '#f0d060', wood: '#e0a868', stone: '#d8d4ce', gold: '#ffd84a' };

export class GameController {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.cam = new Camera();
    this.active = false;
    this.speed = 1; this.paused = false;
    this.selection = null; this.placement = null;
    this.ui = { sel: null, ghost: null, slowmo: false, press: null, tapMark: null };
    this.hudRoot = document.getElementById('hud');
    this.input = new GestureInput(app.canvas, this.gestures());
    this.keys = new Set();
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    this.warnT = Object.create(null);
  }

  // ---- Lifecycle ---------------------------------------------------------------
  start(s) {
    this.s = s;
    this.active = true;
    this.outcomeShown = false;
    this.warnT = Object.create(null);
    this.speed = 1; this.paused = false;
    this.selection = null; this.placement = null; this.tool = null;
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
    audio.setMode(s.cycle.phase === 'night' ? (s.wave?.blood ? 'blood' : 'night') : 'day');
    this.lastSave = performance.now();
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
      const node = NODE_TYPES[s.nodeType] || NODE_TYPES.region;
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
    if (this.hud) this.hud.muteBtn.innerHTML = icon(audio.muted ? 'mute' : 'sound');
  }

  resize() {
    if (!this.active || !this.hud) return;
    const w = this.app.vw, h = this.app.vh;
    this.cam.resize(w, h, this.app.dpr);
    // Keep wave arrows clear of the HUD bars.
    const top = this.hudRoot.querySelector('.top');
    const bottom = this.hudRoot.querySelector('.bottom');
    const tb = top ? top.getBoundingClientRect().bottom : 60;
    const bt = bottom ? bottom.getBoundingClientRect().top : h - 100;
    this.renderer.insets = { top: tb + 4, bottom: Math.max(60, h - bt + 4), left: 16, right: 76 };
    this.coach?.position();
  }

  // ---- Per-frame -------------------------------------------------------------
  timeScale() {
    if (!this.active || this.paused || this.app.modal.open || this.s.pending || this.s.outcome) return 0;
    const slow = this.selection && (this.selection.kind === 'squad' || this.selection.kind === 'sov');
    return this.speed * (slow ? 0.25 : 1);
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
    this.ui.sel = this.selection;
    this.ui.slowmo = this.app.loop.timeScale > 0 && this.app.loop.timeScale < this.speed;
    this.updateGhost();
    this.renderer.draw(s, this.cam, alpha, dt, this.ui);
    this.hud.update(s, dt, this);
    this.hud.slow.classList.toggle('hidden', !this.ui.slowmo);
    this.card.update(s);
    this.coach.update(s.cycle.phase, this.card.isOpen);
    if (this.debug) this.debug.update(dt, this.app.loop, s);
    audio.update();
    // Modal flow: dawn offerings, outcome.
    if (s.outcome && !this.outcomeShown) this.showOutcome();
    else if (s.pending && !this.app.modal.open) this.showPending();
    if (this.selection && this.selection.kind === 'squad' && !s.squads.some((q) => q.id === this.selection.id)) this.select(null);
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
    const p = this.cam.worldToScreen(x, y);
    const W = this.app.vw, H = this.app.vh;
    const dx = Math.max(0, Math.abs(p.x - W / 2) - W / 2), dy = Math.max(0, Math.abs(p.y - H / 2) - H / 2);
    const fall = Math.max(0, 1 - Math.hypot(dx, dy) / 500);
    if (fall <= 0.04) return;
    audio.play(name, { vol: vol * fall * Math.min(1, 0.55 + this.cam.zoom * 0.35), pan: ((p.x - W / 2) / W) * 1.2 });
  }
  shake(a) { if (this.shakeOn) this.cam.addShake(a); }

  drainFx() {
    const fx = this.s.rt.fx;
    if (!fx.length) return;
    const P = this.renderer.particles;
    for (let i = 0; i < fx.length; i++) {
      const e = fx[i];
      switch (e.t) {
        case 'sfx': this.sfxAt(e.k, e.x, e.y, e.k === 'hammer' || e.k === 'chop' || e.k === 'pick' ? 0.55 : 0.8);
          if (e.k === 'chop' && this.onScreen(e.x, e.y)) P.burst('chip', e.x, e.y - 8, 2, { speed: 40, color: '#d8b07a', life: 0.4, size: 2, g: 0 });
          break;
        case 'hit':
          if (!this.onScreen(e.x, e.y)) break;
          P.burst('spark', e.x, e.y, 3, { speed: 50, color: e.foe ? (e.dtype === 'fire' ? '#ffb347' : '#e8e2ff') : '#ff8a70', life: 0.25, size: 2 });
          if (this.renderer.settings.damageNumbers && this.cam.zoom > 0.6) P.spawn('text', e.x + (Math.random() - 0.5) * 8, e.y - 4, { vy: -28, life: 0.7, size: 13, text: String(Math.max(1, Math.round(e.amt))), color: e.foe ? '#fff2c8' : '#ff8070', drag: 0.85 });
          break;
        case 'death':
          if (this.onScreen(e.x, e.y)) {
            P.burst('puff', e.x, e.y - 8, e.big ? 16 : 7, { speed: 26, color: e.foe ? '#9a90b8' : '#8a7a68', life: 0.8, size: e.big ? 9 : 5 });
            if (e.foe) P.burst('ember', e.x, e.y - 8, 5, { speed: 30, color: '#c9b8ff', life: 0.9, size: 2, add: true });
          }
          this.sfxAt(e.foe ? 'death' : 'fall', e.x, e.y, 0.8);
          if (e.big) this.shake(6);
          break;
        case 'built':
          this.sfxAt('build', e.x, e.y);
          P.burst('puff', e.x, e.y, 10, { speed: 40, color: '#d8c8a8', life: 0.7, size: 5 });
          break;
        case 'destroyed':
          this.sfxAt('demolish', e.x, e.y);
          P.burst('puff', e.x, e.y, 18, { speed: 50, color: '#7a6a5a', life: 1.1, size: 8 });
          this.shake(e.size * 2.5);
          if (e.type !== 'wall') this.toast(`${BUILDINGS[e.type].name} destroyed!`, 'bad', 'skull');
          if (this.selection?.kind === 'building' && !this.s.rt.bById.has(this.selection.id)) this.select(null);
          break;
        case 'dusk': {
          const w = this.s.wave;
          audio.play('horn');
          audio.setMode('dusk');
          this.hud.showBanner(w.blood ? 'BLOOD MOON RISES' : 'DUSK', (w.note ? w.note + ' ' : '') + `The Hollow gathers: ${w.groups.length} front${w.groups.length > 1 ? 's' : ''}, ${w.total} foes`, w.blood || w.note ? 'blood' : 'danger', 4600);
          this.coach.event('dusk');
          break;
        }
        case 'night':
          audio.setMode(e.blood ? 'blood' : 'night');
          if (e.blood) audio.play('blood');
          this.hud.showBanner(`NIGHT ${this.s.cycle.night + 1}`, e.blood ? 'The Blood Moon: they will not flee the dawn.' : 'Hold the light.', e.blood ? 'blood' : '', 2200);
          this.coach.event('night');
          setTimeout(() => this.coach.event('nightmid'), 15000);
          break;
        case 'dawn':
          audio.play('dawn'); audio.setMode('day');
          this.hud.showBanner(`DAWN ${e.night}`, e.blood ? `You weathered the Blood Moon. +${e.gold} gold` : `The Hollow burns away in the light. +${e.gold} gold`, 'dawn', 3000);
          this.autosave();
          this.app.meta.best.nights = Math.max(this.app.meta.best.nights, e.night);
          break;
        case 'day':
          if (e.day === 2) this.coach.event('day2');
          if (this.s.wave && this.s.wave.blood) this.toast('Omen: the moon is turning red. A Blood Moon rises tonight!', 'bad', 'moon');
          break;
        case 'beaconReady':
          this.hud.showBanner('THE BEACON CAN BE LIT', 'Leave now in safety, or stay for greater rewards.', 'dawn', 3600);
          break;
        case 'toast': this.toast(e.text, e.tone, e.icon); break;
        case 'gain':
          if (this.onScreen(e.x, e.y) && this.cam.zoom > 0.6) P.spawn('text', e.x, e.y, { vy: -22, life: 1.1, size: 13, text: `+${Math.round(e.a)}`, color: RES_COLOR[e.k], drag: 0.9 });
          this.sfxAt('gain', e.x, e.y, 0.4);
          break;
        case 'felled':
          if (this.onScreen(e.x, e.y)) {
            if (e.kind === 'tree') P.burst('leaf', e.x, e.y - 20, 10, { speed: 50, color: ['#4b7d33', '#679a43', '#3f6f2c'], life: 1.2, size: 3 });
            else P.burst('chip', e.x, e.y - 6, 8, { speed: 50, color: '#b4b0aa', life: 0.6, size: 2.5 });
          }
          break;
        case 'spawn':
          if (this.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 6, { speed: 30, color: '#6a5a90', life: 0.8, size: 6 });
          this.sfxAt('spawn', e.x, e.y, 0.6);
          break;
        case 'burn':
          if (this.onScreen(e.x, e.y)) { P.burst('ember', e.x, e.y - 8, 8, { speed: 30, color: ['#ffb347', '#ffd27a'], life: 1, size: 2.4, add: true }); P.burst('puff', e.x, e.y - 6, 4, { speed: 16, color: '#c0b0a0', life: 0.9, size: 5 }); }
          break;
        case 'impact': if (e.kind === 'bolt' && this.onScreen(e.x, e.y)) P.burst('ember', e.x, e.y, 5, { speed: 40, color: '#ffb347', life: 0.4, size: 2, add: true }); break;
        case 'nova':
          audio.play('nova');
          P.spawn('ring', e.x, e.y, { life: 0.6, size: e.r * 2.2, color: '#ffd27a', add: true });
          P.burst('ember', e.x, e.y - 6, 40, { speed: 160, color: ['#ffd27a', '#ff9a3a', '#fff2c8'], life: 0.7, size: 3, add: true, drag: 0.8 });
          this.shake(8);
          break;
        case 'banner':
          audio.play('banner');
          P.burst('spark', e.x, e.y - 30, 14, { speed: 50, color: '#ffe08a', life: 0.8, size: 2.5, add: true });
          break;
        case 'trained': this.sfxAt('trained', e.x, e.y, 0.8); break;
        case 'cacheSeen': this.toast('You spot an abandoned cache! Send anyone to fetch it.', 'good', 'eye'); this.ui.tapMark = { x: e.x, y: e.y, t: performance.now(), color: '255,230,120' }; break;
        case 'cache': audio.play('coin'); P.burst('spark', e.x, e.y - 6, 16, { speed: 60, color: '#ffe680', life: 0.8, size: 2.5, add: true }); break;
        case 'hearthHit':
          this.warn('hearth', 'The Hearth is under attack!', 8, 'flame');
          if (Math.random() < 0.15) { audio.play('hearth'); this.shake(3); }
          break;
        case 'noRes': this.warn('nores' + e.id, 'A camp has nothing left to harvest in range. Tap it for details.', 30, 'info'); break;
        case 'boon': break;
        case 'mood':
          if (Math.abs(e.dMorale) >= 5 || Math.abs(e.dDread) >= 5) this.toast(`${e.why}: ${e.dMorale ? `Morale ${e.dMorale > 0 ? '+' : ''}${Math.round(e.dMorale)}` : ''}${e.dMorale && e.dDread ? ', ' : ''}${e.dDread ? `Dread ${e.dDread > 0 ? '+' : ''}${Math.round(e.dDread)}` : ''}`, e.dMorale < 0 || e.dDread > 0 ? 'bad' : 'good', e.dDread > 0 ? 'skull' : 'sun');
          break;
        case 'combo': {
          const m = this.app.meta;
          m.combos = m.combos || [];
          const first = !m.combos.includes(e.id);
          if (first) { m.combos.push(e.id); this.app.saveMeta(m); }
          audio.play('build');
          if (e.x !== undefined) P.burst('spark', e.x, e.y - 10, 24, { speed: 70, color: e.good === false ? ['#a77ad8', '#d6b8ff'] : ['#ffe08a', '#fff2c8'], life: 1, size: 2.5, add: true });
          this.hud.showBanner(first ? (e.good === false ? 'A BAD OMEN' : 'COMBO DISCOVERED') : 'COMBO', e.name || e.id, e.good === false ? 'blood' : 'dawn', 2800);
          break;
        }
        case 'lightning':
          audio.play('hearth'); this.shake(9);
          if (e.x !== undefined && this.onScreen(e.x, e.y)) P.burst('spark', e.x, e.y - 20, 30, { speed: 120, color: ['#ffffff', '#c8e0ff'], life: 0.5, size: 2.5, add: true });
          break;
        case 'blueprint':
          this.hud.build.setKnown(this.s.blueprints);
          this.toast(`New blueprint: ${BUILDINGS[e.type].name}`, 'good', 'book');
          break;
        case 'bossRoar': audio.play('horn'); audio.setMode('blood'); this.shake(10); this.hud.showBanner(e.title || 'THE GLOOMWYRM', e.sub || 'Grey fire on the wind. Watch for the warning lines!', 'blood', 4200); break;
        case 'bossWarn': audio.play('error', { vol: 0.6 }); break;
        case 'bossStrafe': if (e.impact) { audio.play('hearth'); this.shake(12); } else if (Math.random() < 0.3) { audio.play('nova', { vol: 0.5 }); this.shake(4); } if (e.x !== undefined && this.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 3, { speed: 30, color: '#8a8498', life: 0.9, size: 7 }); break;
        case 'bossLand': audio.play('thud'); this.shake(7); break;
        case 'bossTakeoff': this.sfxAt('chop', e.x, e.y, 0.5); if (this.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 8, { speed: 60, color: '#9a90b0', life: 0.8, size: 8 }); break;
        case 'riftFallen':
          audio.play('victory'); this.shake(10);
          if (e.x !== undefined) { P.burst('ember', e.x, e.y - 10, 40, { speed: 140, color: ['#c9b8ff', '#fff2c8'], life: 1.2, size: 3, add: true, drag: 0.85 }); P.burst('puff', e.x, e.y, 20, { speed: 50, color: '#7a6a90', life: 1.4, size: 9 }); }
          this.hud.showBanner('THE RIFT IS SEALED', 'The objective is met. Light the Beacon by day.', 'dawn', 3600);
          break;
        case 'bossPhase': audio.play('horn'); this.shake(8); this.hud.showBanner(e.title || 'THE WYRM ENRAGES', e.sub || (e.phase === 3 ? 'Its fire splits in two. It will dive at the Hearth!' : 'It calls the Hollow to its side.'), 'blood', 3200); break;
        case 'bossDarkWarn': if (e.first) audio.play('horn'); this.hud.showBanner(`DARKNESS FALLS ${e.left ? '\u2014 ' + e.left : ''}`, 'Get into the light, or stand beside the Sovereign!', 'blood', 1200); break;
        case 'bossDark': if (e.on) { audio.play('blood'); this.shake(6); } break;
        case 'kingSummon': if (e.x !== undefined && this.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 14, { speed: 50, color: '#7a5ab0', life: 1, size: 8 }); this.sfxAt('spawn', e.x, e.y); break;
        case 'kingSnuff': if (e.x !== undefined && this.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y - 20, 10, { speed: 30, color: '#8a8498', life: 1, size: 6 }); this.sfxAt('death', e.x, e.y); break;
        case 'kingBlink': for (const [bx, by] of [[e.fx, e.fy], [e.x, e.y]]) if (bx !== undefined && this.onScreen(bx, by)) P.burst('puff', bx, by, 12, { speed: 60, color: '#5a4a80', life: 0.8, size: 8 }); audio.play('spawn'); break;
        case 'kingRekindle': if (e.x !== undefined) P.burst('ember', e.x, e.y - 20, 12, { speed: 40, color: '#ffb347', life: 0.8, size: 2, add: true }); break;
        case 'charge': if (this.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 8, { speed: 50, color: '#d8c8a0', life: 0.6, size: 5 }); break;
        case 'regrow': if (this.onScreen(e.x, e.y)) P.burst('leaf', e.x, e.y - 14, 8, { speed: 30, color: ['#4b7d33', '#679a43'], life: 1, size: 3 }); break;
        case 'bountyPaid': audio.play('coin'); if (e.x !== undefined && this.onScreen(e.x, e.y)) { P.burst('spark', e.x, e.y - 10, 16, { speed: 60, color: '#ffe680', life: 0.8, size: 2.5, add: true }); P.spawn('text', e.x, e.y - 20, { vy: -24, life: 1.2, size: 14, text: `+${e.gold}`, color: '#ffd84a', drag: 0.9 }); } break;
        case 'bountyPlaced': if (e.x !== undefined && this.onScreen(e.x, e.y)) P.burst('puff', e.x, e.y, 6, { speed: 30, color: '#e8d8a0', life: 0.6, size: 5 }); break;
        case 'heroLevel': audio.play('ok'); if (e.x !== undefined) P.burst('spark', e.x, e.y - 16, 30, { speed: 90, color: ['#ffd27a', '#fff2c8'], life: 1, size: 3, add: true }); this.toast(`${e.hero || 'A hero'} reached level ${e.level}!`, 'good', 'crown'); break;
        case 'heroHired': audio.play('trained'); if (e.x !== undefined) P.burst('puff', e.x, e.y, 10, { speed: 40, color: '#e8d8a0', life: 0.8, size: 6 }); break;
        case 'heal': if (e.x !== undefined && this.onScreen(e.x, e.y) && Math.random() < 0.3) P.burst('spark', e.x, e.y - 12, 3, { speed: 20, color: '#8fe86a', life: 0.6, size: 2, add: true }); break;
        case 'zoneClaimed': audio.play('build'); if (e.x !== undefined) P.burst('spark', e.x, e.y, 30, { speed: 90, color: ['#f0c86a', '#ffe8b0'], life: 1, size: 2.5, add: true }); break;
        case 'lairCleared': audio.play('demolish'); this.shake(4); if (e.x !== undefined) P.burst('puff', e.x, e.y, 20, { speed: 50, color: '#6a5a4a', life: 1.2, size: 9 }); break;
        case 'season': audio.play('dawn'); break;
        case 'decree': audio.play('ok'); break;
        case 'feyGrove': audio.play(e.good ? 'ok' : 'error'); if (e.x !== undefined && this.onScreen(e.x, e.y)) P.burst(e.good ? 'spark' : 'puff', e.x, e.y, 20, { speed: 50, color: e.good ? ['#9fe8a0', '#e8ffd0'] : '#a77ad8', life: 1, size: 3, add: !!e.good }); break;
        case 'bossSlain': audio.play('victory'); this.shake(14); if (e.x !== undefined) { P.burst('ember', e.x, e.y - 30, 60, { speed: 180, color: ['#ffd27a', '#c9b8ff', '#fff2c8'], life: 1.4, size: 3, add: true, drag: 0.85 }); P.burst('puff', e.x, e.y, 30, { speed: 70, color: '#8a8498', life: 1.6, size: 10 }); } break;
        case 'arcane':
          if (this.onScreen(e.x1, e.y1)) for (let k = 0; k <= 6; k++) P.spawn('spark', e.x1 + (e.x2 - e.x1) * k / 6, e.y1 + (e.y2 - e.y1) * k / 6 - 8, { life: 0.3, size: 2.5, color: '#7ff0e8', add: true });
          break;
        case 'newcomer':
          if (this.onScreen(e.x, e.y)) P.spawn('text', e.x, e.y, { vy: -18, life: 1.8, size: 14, text: `+1 villager (${e.n}/${e.cap})`, color: '#fff2c8', drag: 0.92 });
          audio.play('ok', { vol: 0.4 });
          break;
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
    d.appendChild(el('p', 'lead')).textContent = `${this.s.heraldry.name} \u00b7 Day ${this.s.cycle.night + 1} \u00b7 seed ${this.s.seedText}`;
    const body = el('div', 'menu-col');
    body.style.margin = '0 auto';
    const mk = (label, ic, fn, cls = '') => {
      const b = el('button', 'big-btn ' + cls, icon(ic) + '<span></span>');
      b.querySelector('span').textContent = label;
      tapButton(b, fn);
      body.appendChild(b);
    };
    mk('Resume', 'play', () => this.app.modal.close());
    mk('Settings', 'gear', () => this.app.openSettings(() => this.openPauseMenu()), 'secondary');
    mk('How to Play', 'book', () => this.app.openHelp(() => this.openPauseMenu()), 'secondary');
    mk('Save & Quit', 'export', () => { this.autosave(); this.app.modal.close(); this.app.toMenu(); this.app.toasts.show('Realm saved.', 'good'); }, 'secondary');
    mk('Abandon Realm', 'skull', () => this.app.confirm('Abandon this realm?', 'The run ends as a defeat (partial Embers are still earned).', () => { this.s.outcome = { result: 'defeat', reason: 'You abandoned the realm to the Hollow.' }; }, () => this.openPauseMenu()), 'danger');
    d.appendChild(body);
    this.app.modal.show(d, { dismissable: true });
  }

  // ---- HUD actions ----------------------------------------------------------------
  togglePause() { this.paused = !this.paused; this.hud.pauseBtn.innerHTML = icon(this.paused ? 'play' : 'pause'); this.hud.pauseBtn.classList.toggle('on', this.paused); if (this.paused) this.toast('Paused. You can still plan and place buildings.', '', 'pause'); }
  cycleSpeed() { this.speed = this.speed >= 3 ? 1 : this.speed + 1; this.hud.speedBtn.innerHTML = `<span style="font-weight:900;font-size:17px">${this.speed}x</span>`; this.hud.speedBtn.classList.toggle('on', this.speed > 1); }
  callNight() {
    if (this.s.cycle.phase !== 'day') { this.toast('You can only call the night during the day.', 'bad'); return; }
    this.app.confirm('Call the Night?', 'Skip the rest of the day. Dusk falls now and the Hollow comes soon after.', () => this.cmd({ t: 'callNight' }));
  }
  toggleMute() {
    audio.setMuted(!audio.muted);
    this.app.meta.settings.muted = audio.muted; this.app.saveMeta(this.app.meta);
    this.hud.muteBtn.innerHTML = icon(audio.muted ? 'mute' : 'sound');
  }
  ability(name) {
    const r = this.cmd({ t: 'ability', name });
    if (!r.ok) audio.play('error');
  }
  explainAbility(name) { const a = SOVEREIGN_ABILITIES[name]; this.openText(a.name, `Cooldown ${a.cooldown}s`, a.desc, name === 'nova' ? 'nova' : 'banner'); }
  explainResource(k) {
    const t = {
      food: 'Food: grown by Farms. Every villager eats 2 a minute, every soldier 1.2. At zero, villagers leave.',
      wood: 'Wood: cut by Lumber Camps near trees. Used for most buildings.',
      stone: 'Stone: cut by Quarries near grey rock. Used for walls, towers and upgrades.',
      gold: 'Gold: taxes from Houses and gifts at dawn. Pays for soldiers and upgrades.',
      pop: 'Population: villagers / housing. Houses add room; newcomers arrive by day while food lasts.',
    }[k];
    this.toast(t, '', k);
  }
  biomeName() { return (BIOMES[this.s.biome] && BIOMES[this.s.biome].name) || 'Greenvale'; }

  explainObjective() {
    const det = HOOKS.objectiveDetail ? HOOKS.objectiveDetail(this.s) : null;
    if (det) this.openText(det.title, this.s.beaconReady ? 'Met: Light the Beacon when ready' : 'Region objective', det.lines, 'beacon');
  }

  explainCycle() {
    const s = this.s;
    const w = s.wave;
    let k = 0;
    while (w && !isBloodMoon(w.n + k, s) && k < 12) k++;
    const moon = k === 0 ? 'The moon is red: a Blood Moon tonight!' : `Blood Moon in ${k} night${k > 1 ? 's' : ''}.`;
    this.toast(w ? `Tonight (night ${w.n}): ${w.groups.length} front${w.groups.length > 1 ? 's' : ''}, about ${w.total} Hollow. ${moon}` : 'The day is young.', w && w.blood ? 'bad' : '', 'moon');
  }
  explainSquad(id) {
    if (id === 'sov') { const v = this.s.sovereign; if (v) this.card.open('unit', v.id); return; }
    const q = this.s.squads.find((x) => x.id === id);
    if (q) this.openText(q.name, 'Squad', 'Tap to select (time slows), then tap ground to move or a foe to attack. Double-tap to find them. Soldiers fight anything that comes near their rally flag.', 'sword');
  }
  openText(title, sub, text, ic) { this.card.open('text', { title, sub, text, ic }); }
  openBuildInfo(type) { this.card.open('buildtype', type); }
  closeCard() { this.card.close(); if (this.selection?.kind === 'building') this.select(null); }

  select(sel) {
    this.selection = sel;
    if (sel && sel.kind === 'sov') this.coach.event('select:sov');
  }
  selectSquad(id) {
    if (this.placement) this.cancelPlacement();
    const same = this.selection && ((id === 'sov' && this.selection.kind === 'sov') || (this.selection.kind === 'squad' && this.selection.id === id));
    if (same) { this.select(null); return; }
    this.select(id === 'sov' ? { kind: 'sov' } : { kind: 'squad', id });
    this.card.close();
  }
  centerOnSquad(id) {
    const s = this.s;
    if (id === 'sov') { if (s.sovereign) this.cam.centerOn(s.sovereign.x, s.sovereign.y); }
    else { const u = s.soldiers.find((x) => x.squad === id); const q = s.squads.find((x) => x.id === id); if (u) this.cam.centerOn(u.x, u.y); else if (q) this.cam.centerOn(q.rx, q.ry); }
    this.selectSquad(id);
  }

  // ---- Placement -----------------------------------------------------------------
  local(clientX, clientY) { const r = this.app.canvas.getBoundingClientRect(); return { x: clientX - r.left, y: clientY - r.top }; }
  tileUnder(sx, sy, type) {
    const w = this.cam.screenToWorld(sx, sy);
    const size = BUILDINGS[type].size;
    return [Math.floor(w.x / T - size / 2 + 0.5), Math.floor(w.y / T - size / 2 + 0.5)];
  }
  beginPlacement(type, clientX, clientY) {
    this.select(null); this.card.close();
    let anchor;
    if (clientX == null) anchor = this.nearestValid(type, this.tileUnder(this.app.vw / 2, this.app.vh * 0.45, type));
    else { const p = this.local(clientX, clientY); anchor = this.tileUnder(p.x, p.y - 56, type); }
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
    const a = this.tileUnder(p.x, p.y - 56, this.placement.type);
    const dx = this.placement.end[0] - this.placement.anchor[0], dy = this.placement.end[1] - this.placement.anchor[1];
    this.placement.anchor = a; this.placement.end = [a[0] + dx, a[1] + dy];
  }
  dropPlacement() {
    if (!this.placement) return;
    this.placement.fromBar = false;
  }
  cancelPlacement() { this.placement = null; this.ui.ghost = null; this.hud.setPlacement(null); this.coach.suppress(false); }
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
    // Confirm buttons above the ghost (or below when near the top).
    const [tx, ty] = tiles[0];
    const sp = this.cam.worldToScreen((tx + def.size / 2) * T, ty * T - 36);
    let x = Math.max(80, Math.min(this.app.vw - 80, sp.x)), y = sp.y;
    if (y < this.renderer.insets.top + 70) y = this.cam.worldToScreen(0, (ty + def.size) * T + 80).y;
    y = Math.min(y, this.app.vh - this.renderer.insets.bottom - 10);
    const costTxt = Object.entries(cost).map(([k, v]) => `${v * Math.max(1, n)} ${k}`).join(', ');
    const anyOk = valid.some(Boolean);
    const hint = anyOk ? `${def.name}${n > 1 ? ' ×' + n : ''}: ${costTxt}. ${def.line ? 'Drag the round handle to draw the line.' : 'Drag the ghost to move it.'}` : `${def.name}: ${reason}`;
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
          else {
            const [tx, ty] = g.tiles[0];
            const m = T * 0.9;
            if (w.x > tx * T - m && w.x < (tx + def.size) * T + m && w.y > ty * T - m - 20 && w.y < (ty + def.size) * T + m) {
              this.ghostDrag = 'move';
              this.dragOff = [w.x - tx * T, w.y - ty * T];
            }
          }
        }
      },
      dragmove: (p, dx, dy) => {
        if (!this.active) return;
        if (this.ghostDrag && this.placement) {
          const w = this.cam.screenToWorld(p.x, p.y);
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
    if (p.x < m) this.cam.panBy(k, 0); else if (p.x > this.app.vw - m) this.cam.panBy(-k, 0);
    if (p.y < this.renderer.insets.top + m * 0.5) this.cam.panBy(0, k); else if (p.y > this.app.vh - this.renderer.insets.bottom - m * 0.5) this.cam.panBy(0, -k);
  }
  cancelAll() {
    if (this.tool) { const T = BUS.tools[this.tool.name]; if (T && T.cancel) T.cancel(this); this.setTool(null); return; }
    if (this.placement) this.cancelPlacement();
    else if (this.card.isOpen) this.closeCard();
    else this.select(null);
  }

  pick(p, { enemiesFirst = false } = {}) {
    const s = this.s;
    const w = this.cam.screenToWorld(p.x, p.y);
    const R = Math.max(16, 22 / this.cam.zoom);
    const near = (list, r = R) => {
      let best = null, bd = r;
      for (const e of list) {
        if (!e.alive || e.st === 'sheltered') continue;
        // Big foes are big targets; the wyrm is hit where its body is drawn, not its shadow.
        const oy = e.boss ? (e.z || 0) + 16 : e.type === 'rift' ? 6 : e.type === 'lair' ? 14 : 10;
        const slack = e.boss ? 45 : e.type === 'rift' ? 34 : e.type === 'lair' ? 30 : 0;
        const d = Math.hypot(e.x - w.x, e.y - oy - w.y) - slack;
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    };
    const foe = near(s.enemies, R * 1.2);
    if (enemiesFirst && foe) return { kind: 'enemy', e: foe, w };
    const sov = s.sovereign && s.sovereign.alive && Math.hypot(s.sovereign.x - w.x, s.sovereign.y - 12 - w.y) < R * 1.2 ? s.sovereign : null;
    if (sov) return { kind: 'sov', e: sov, w };
    const sol = near(s.soldiers);
    if (sol) return { kind: 'soldier', e: sol, w };
    if (foe) return { kind: 'enemy', e: foe, w };
    const hero = near(s.heroes || [], R * 1.1);
    if (hero) return { kind: 'hero', e: hero, w };
    const vil = near(s.villagers, R * 0.8);
    const tx = tileOf(w.x), ty = tileOf(w.y);
    // Tall sprites (towers, the Hearth) are drawn above their footprint, so
    // also test the tiles just below the finger.
    for (const [x, y, tallOnly] of [[tx, ty, false], [tx, ty + 1, false], [tx, ty + 2, true]]) {
      if (!inB(x, y)) continue;
      const b = s.occ[idx(x, y)];
      if (!b) continue;
      const bd = s.rt.bById.get(b);
      if (bd && (!tallOnly || bd.type === 'tower' || bd.type === 'hearth')) return { kind: 'building', b: bd, w };
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

  /** Generic map tool mode used by plug-ins (e.g. bounty flags). */
  setTool(name, data = null) {
    if (this.placement) this.cancelPlacement();
    this.tool = name ? { name, data } : null;
    const T = name ? BUS.tools[name] : null;
    this.hud.setToolHint(T ? (typeof T.hint === 'function' ? T.hint(this) : T.hint) : null);
  }

  onTap(p) {
    const s = this.s;
    if (this.tool) {
      const tool = BUS.tools[this.tool.name];
      if (!tool) { this.setTool(null); return; }
      if (tool.tap(this, p, this.cam.screenToWorld(p.x, p.y))) this.setTool(null);
      return;
    }
    if (this.placement) {
      const a = this.tileUnder(p.x, p.y, this.placement.type);
      const dx = this.placement.end[0] - this.placement.anchor[0], dy = this.placement.end[1] - this.placement.anchor[1];
      this.placement.anchor = a; this.placement.end = [a[0] + dx, a[1] + dy];
      audio.play('click');
      return;
    }
    const sel = this.selection;
    if (sel && (sel.kind === 'squad' || sel.kind === 'sov')) {
      const hit = this.pick(p, { enemiesFirst: true });
      if (hit.kind === 'soldier' && sel.kind === 'squad' && hit.e.squad !== sel.id) { this.selectSquad(hit.e.squad); return; }
      if (hit.kind === 'sov' && sel.kind !== 'sov') { this.selectSquad('sov'); return; }
      if (hit.kind === 'enemy') {
        this.cmd(sel.kind === 'sov' ? { t: 'sovAttack', target: hit.e.id } : { t: 'squadAttack', id: sel.id, target: hit.e.id });
        this.ui.tapMark = { x: hit.e.x, y: hit.e.y, t: performance.now(), color: '255,110,90' };
        audio.play('clash');
      } else {
        const w = hit.w;
        this.cmd(sel.kind === 'sov' ? { t: 'sovMove', x: w.x, y: w.y } : { t: 'squadMove', id: sel.id, x: w.x, y: w.y });
        this.ui.tapMark = { x: w.x, y: w.y, t: performance.now() };
        audio.play('ok');
      }
      this.select(null);
      return;
    }
    const hit = this.pick(p);
    switch (hit.kind) {
      case 'sov': this.selectSquad('sov'); break;
      case 'soldier': this.selectSquad(hit.e.squad); break;
      case 'building': audio.play('click'); this.select({ kind: 'building', id: hit.b.id }); this.card.open('building', hit.b.id); break;
      case 'enemy': this.card.open('enemy', hit.e.id); break;
      case 'villager': this.card.open('unit', hit.e.id); break;
      case 'hero': if (BUS.tapEntity.hero) BUS.tapEntity.hero(this, hit.e); else this.card.open('unit', hit.e.id); break;
      case 'tile': if (first(BUS.tapTile, this, hit.tx, hit.ty, hit.w)) break; this.select(null); this.card.close(); break;
      case 'cache': this.openText('Abandoned Cache', 'Unclaimed supplies', 'Anyone of yours who walks next to it brings it home. Order the Sovereign or a squad over here.', 'eye'); break;
      case 'node': this.explainNode(hit.n); break;
      default: this.select(null); this.card.close();
    }
  }

  onLongPress(p) {
    const hit = this.pick(p);
    switch (hit.kind) {
      case 'sov': case 'soldier': case 'villager': this.card.open('unit', hit.e.id); break;
      case 'hero': if (BUS.tapEntity.hero) BUS.tapEntity.hero(this, hit.e); break;
      case 'enemy': this.card.open('enemy', hit.e.id); break;
      case 'building': this.select({ kind: 'building', id: hit.b.id }); this.card.open('building', hit.b.id); break;
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
      case 'c': this.selectSquad('sov'); break;
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
