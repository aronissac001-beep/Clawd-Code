// The in-game HUD (rework stream F). Layout, thumb-first:
//   top strip (one 44 pt row): the phase ring with a large countdown, food, wood, stone, gold,
//     population and idle villagers. Under it one chip: the day/night and the objective, and the
//     boss bar when a boss is on the field.
//   right rail (left when left-handed): Heartflame Nova and the Royal Banner, then the unit
//     portraits in a vertical column (the Sovereign with a crown, squads with their colour and
//     number, heroes in round frames, added by js/ui/heroui.js into slots.squads).
//   bottom: Menu, Plan (pause), speed, minimap and, by day, Call the Night; the build bar by day
//     only (it hides at dusk and night).
//   strips: one-line notices under the top bar (phase banners, placement hint, the Plan state).
//   act lane: one inline action above the bottom bar (the Hearth wood trade when the realm is
//     stuck without wood, or a nudge to place a Lumber Camp).
// Explanations open on tap (pointerup without movement) or long-press, never on pointerdown.
// The HUD writes --hud-t / --hud-b / --lane-b on #root so the toast lane, the coach and the
// rail always sit in the free map area whatever the phase and orientation.
import { el, tapButton, iconBtn, fmt } from './dom.js';
import { icon } from './icons.js';
import { BuildBar } from './buildbar.js';
import { BAL } from '../data/balance.js';
import { SOVEREIGN_ABILITIES } from '../data/units.js';
import { popCap } from '../game/systems/common.js';
import { HOOKS, BUS } from '../game/hooks.js';
import { ratesPerMin, idleCount } from '../game/systems/economy.js';
import { isLongNight } from '../game/systems/waves.js';
import { unitSprite } from '../engine/sprites.js';

const RES = ['food', 'wood', 'stone', 'gold', 'pop', 'idle'];
const RES_LABEL = { food: 'Food', wood: 'Wood', stone: 'Stone', gold: 'Gold', pop: 'Population', idle: 'Idle villagers' };

export class Hud {
  constructor(root, ctl) {
    this.root = root; this.ctl = ctl;
    root.innerHTML = '';
    this.t = 1;
    // ---- top strip
    const top = el('div', 'top');
    this.strip = el('div', 'strip panel');
    this.cyc = el('button', 'cyc', `<svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="rgba(0,0,0,.35)" stroke="rgba(0,0,0,.5)" stroke-width="3.4"/><circle class="arc" cx="18" cy="18" r="15.5" fill="none" stroke="#f0c86a" stroke-width="3.4" stroke-dasharray="97.4" stroke-dashoffset="0" stroke-linecap="round"/></svg><span class="pi"></span><span class="cl"></span>`);
    this.cyc.setAttribute('aria-label', 'Time and tonight');
    this.arc = this.cyc.querySelector('.arc'); this.pi = this.cyc.querySelector('.pi'); this.cl = this.cyc.querySelector('.cl');
    tapButton(this.cyc, () => ctl.explainCycle());
    this.resbar = el('div', 'resbar');
    this.res = {};
    for (const k of RES) {
      const r = el('button', 'res', `<span class="ri" style="color:var(--c-${k === 'idle' ? 'pop' : k})">${icon(k === 'idle' ? 'hoe' : k)}</span><span class="col"><span class="v">0</span><span class="r"></span></span>`);
      r.dataset.k = k;
      r.setAttribute('aria-label', RES_LABEL[k]);
      this.res[k] = { node: r, v: r.querySelector('.v'), r: r.querySelector('.r'), last: '' };
      tapButton(r, () => ctl.explainResource(k), { longpress: () => ctl.explainResource(k) });
      this.resbar.appendChild(r);
    }
    this.strip.append(this.cyc, this.resbar);
    // ---- chip row: day/night + objective, the boss bar
    this.chips = el('div', 'chips');
    this.obj = el('button', 'objective', '<span class="och"></span>');
    this.objT = this.obj.querySelector('.och');
    this.obj.setAttribute('aria-label', 'Objective');
    tapButton(this.obj, () => ctl.explainObjective());
    this.bossBox = el('div', 'bossbar hidden', '<div class="bn"></div><div class="bb"><i></i></div>');
    this.chips.append(this.obj, this.bossBox);
    top.append(this.strip, this.chips);
    // ---- right rail: abilities, then portraits
    this.rail = el('div', 'rail');
    const ab = el('div', 'abilities');
    this.nova = iconBtn('nova', 'Heartflame Nova'); this.nova.appendChild(el('div', 'cd'));
    this.bannerBtn = iconBtn('banner', 'Royal Banner'); this.bannerBtn.appendChild(el('div', 'cd'));
    tapButton(this.nova, () => ctl.ability('nova'), { sound: null, longpress: () => ctl.explainAbility('nova') });
    tapButton(this.bannerBtn, () => ctl.ability('banner'), { sound: null, longpress: () => ctl.explainAbility('banner') });
    ab.append(this.nova, this.bannerBtn);
    this.squads = el('div', 'squads');
    this.portraitBox = el('div', 'portraitbox');
    this.squads.appendChild(this.portraitBox);
    this.rail.append(ab, this.squads);
    this.minimap = el('div', 'minimap panel hidden', '<canvas width="240" height="240"></canvas>');
    this.miniC = this.minimap.querySelector('canvas');
    // ---- bottom: controls and the build bar
    const bottom = el('div', 'bottom');
    this.bottom = bottom;
    this.controls = el('div', 'controls panel');
    this.menuBtn = iconBtn('menu', 'Menu');
    this.pauseBtn = el('button', 'hbtn plan', `${icon('pause')}<span class="lbl">Plan</span>`);
    this.pauseBtn.setAttribute('aria-label', 'Plan (pause)');
    this.speedBtn = el('button', 'hbtn', '<span class="spd">1x</span>');
    this.speedBtn.setAttribute('aria-label', 'Game speed');
    this.mapBtn = iconBtn('map', 'Minimap');
    this.nightBtn = el('button', 'hbtn nightbtn', `${icon('nightskip')}<span>Call the Night</span>`);
    this.nightBtn.setAttribute('aria-label', 'Call the night');
    tapButton(this.menuBtn, () => ctl.openPauseMenu());
    tapButton(this.pauseBtn, () => ctl.togglePause());
    tapButton(this.speedBtn, () => ctl.cycleSpeed());
    tapButton(this.mapBtn, () => this.toggleMinimap());
    tapButton(this.nightBtn, () => ctl.callNight(), { longpress: () => ctl.toast(`Call the Night: dusk falls now, and you get ${BAL.cycle.callGold || 1} gold for every second of daylight you skip.`, '', 'moon') });
    this.controls.append(this.menuBtn, this.pauseBtn, this.speedBtn, this.mapBtn, this.nightBtn);
    this.build = new BuildBar(ctl);
    bottom.append(this.controls, this.build.root);
    // ---- the act lane: one inline action (Hearth trade / Lumber Camp nudge)
    this.act = el('button', 'act-btn panel hidden', `<span class="ai"></span><span class="at"></span>`);
    tapButton(this.act, () => this.onAct(), { sound: null });
    // ---- overlays
    this.beacon = el('button', 'big-btn beacon-btn hidden', icon('beacon') + '<span>Light the Beacon</span>');
    tapButton(this.beacon, () => ctl.offerBeacon(), { sound: 'ok' });
    this.strips = el('div', 'strips');
    this.bannerBox = el('div', 'banner hidden', '<b></b><span></span>');
    this.planStrip = el('div', 'strip-note plan-note hidden', `${icon('pause')}<span>Planning: time is stopped. Orders and builds still work.</span>`);
    this.placeHint = el('div', 'strip-note place-hint hidden');
    this.toolHint = el('div', 'strip-note place-hint hidden');
    this.strips.append(this.bannerBox, this.planStrip, this.placeHint, this.toolHint);
    this.place = el('div', 'place hidden');
    this.placeOk = iconBtn('check', 'Build here', 'ok');
    this.placeNo = iconBtn('x', 'Cancel', 'no');
    tapButton(this.placeNo, () => ctl.cancelPlacement());
    tapButton(this.placeOk, () => ctl.confirmPlacement(), { sound: null });
    this.place.append(this.placeOk, this.placeNo);
    this.cardBox = el('div', 'card panel hidden');
    root.append(top, this.rail, this.minimap, bottom, this.act, this.beacon, this.strips, this.place, this.cardBox);
    // Plug-in widgets get named slots in the HUD.
    this.slots = { resbar: this.resbar, cyclebar: this.chips, squads: this.squads, rail: ab, corner: this.controls, root };
    this.widgets = BUS.hud.map((f) => f(this, ctl)).filter(Boolean);
    this.squadKey = null;
    this.portraits = new Map();
    this.minimapOn = false;
    this.phaseCls = '';
    this.lanes = '';
  }

  setState(s) {
    this.s = s;
    this.build.s = s;
    this.build.makeThumbs(s.heraldry);
    this.build.setKnown(s.standalone ? null : s.blueprints);
    this.squadKey = null;
    this.t = 1;
  }

  toggleMinimap(force) {
    this.minimapOn = force ?? !this.minimapOn;
    this.minimap.classList.toggle('hidden', !this.minimapOn);
    this.mapBtn.classList.toggle('on', this.minimapOn);
  }

  /** A one-line strip under the top bar. Dusk and night notices stay 2 s. */
  showBanner(title, text, cls = '', ms = 2000) {
    const b = this.bannerBox;
    b.className = 'banner strip-note ' + cls;
    b.querySelector('b').textContent = title;
    b.querySelector('span').textContent = text ? ' ' + text : '';
    b.title = (title + ' ' + (text || '')).trim();
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.add('hidden'), Math.min(ms, 3000));
  }

  setPlanning(on) {
    this.planStrip.classList.toggle('hidden', !on);
    this.pauseBtn.classList.toggle('on', on);
    this.pauseBtn.innerHTML = `${icon(on ? 'play' : 'pause')}<span class="lbl">${on ? 'Go' : 'Plan'}</span>`;
    this.pauseBtn.setAttribute('aria-label', on ? 'Resume' : 'Plan (pause)');
  }
  setSpeed(n) { this.speedBtn.innerHTML = `<span class="spd">${n}x</span>`; this.speedBtn.classList.toggle('on', n > 1); }
  setNightArmed(on) {
    this.nightBtn.classList.toggle('armed', on);
    this.nightBtn.querySelector('span').textContent = on ? 'Tap again: Night' : 'Call the Night';
  }

  /** Called every frame; text refreshes are throttled. */
  update(s, dt, ctl) {
    this.t += dt;
    this.updateAbilities(s);
    this.updatePortraits(s, ctl);
    for (const w of this.widgets) if (w.update) w.update(s, dt);
    if (this.t < 0.12) return;
    this.t = 0;
    const c = s.cycle, C = BAL.cycle;
    // Phase classes drive what the bottom shows (the build bar is a day tool).
    const ph = 'ph-' + c.phase;
    if (ph !== this.phaseCls) { if (this.phaseCls) this.root.classList.remove(this.phaseCls); this.root.classList.add(ph); this.phaseCls = ph; }
    const rates = ratesPerMin(s);
    for (const k of ['food', 'wood', 'stone', 'gold']) {
      const r = this.res[k];
      const v = fmt(s.res[k]);
      if (v !== r.last) { r.v.textContent = v; r.last = v; }
      const rate = Math.round(rates[k]);
      const rt = rate === 0 ? '' : (rate > 0 ? '+' : '') + rate + '/m';
      if (rt !== r.lastR) { r.r.textContent = rt; r.r.className = 'r ' + (rate > 0 ? 'pos' : rate < 0 ? 'neg' : ''); r.lastR = rt; }
    }
    const pop = `${s.villagers.length}/${popCap(s)}`;
    const p = this.res.pop;
    if (pop !== p.last) { p.v.textContent = pop; p.last = pop; }
    const idle = String((s.econ && typeof s.econ.idle === 'number') ? s.econ.idle : idleCount(s));
    const id = this.res.idle;
    if (idle !== id.last) { id.v.textContent = idle; id.last = idle; id.node.classList.toggle('zero', idle === '0'); }
    this.build.update(s);
    // The phase ring: the arc empties as the phase runs out; the number is what matters now.
    const len = c.len || { day: C.dayLen, dusk: C.duskLen, night: C.nightMax * (c.nm || 1), dawn: C.dawnLen }[c.phase];
    const frac = Math.min(1, c.t / len);
    const left = Math.max(0, Math.ceil(len - c.t));
    const long = !!(s.wave && (s.wave.long || s.wave.blood));
    this.arc.setAttribute('stroke-dashoffset', String(97.4 * frac));
    this.arc.setAttribute('stroke', c.phase === 'day' ? (left <= 10 ? '#ff8a5a' : '#f0c86a') : c.phase === 'dusk' ? '#ef8a4a' : c.phase === 'night' ? (long ? '#e0505e' : '#8fa8e8') : '#ffc0b0');
    let label, pi = '';
    if (c.phase === 'day') label = left > 99 ? clock(left) : String(left);
    else if (c.phase === 'dusk') label = String(Math.max(0, Math.ceil(C.duskLen - c.t)));
    else if (c.phase === 'night') { const f = foesLeft(s); label = f ? String(f) : ''; pi = f ? '' : 'moon'; }
    else { label = ''; pi = 'sun'; }
    if (label !== this.lastLabel) { this.cl.textContent = label; this.lastLabel = label; this.cl.classList.toggle('long', label.length > 2); }
    if (pi !== this.lastPi) { this.pi.innerHTML = pi ? icon(pi) : ''; this.lastPi = pi; }
    const hurry = c.phase === 'day' && left <= 10 && left > 0;
    this.cyc.classList.toggle('hurry', hurry);
    this.cyc.classList.toggle('foes', c.phase === 'night' && !!label);
    this.cyc.setAttribute('aria-label', c.phase === 'day' ? `${left} seconds until dusk` : c.phase === 'dusk' ? 'Dusk: the Hollow are coming' : c.phase === 'night' ? `${label || 'No'} foes left tonight` : 'Dawn');
    // The chip: where we are in the region and what the objective asks.
    const obj = this.objectiveLine(s);
    if (obj !== this.lastObj) { this.objT.textContent = obj; this.lastObj = obj; this.obj.classList.toggle('long', long && c.phase !== 'day'); }
    const bb = HOOKS.bossBar ? HOOKS.bossBar(s) : null;
    this.bossBox.classList.toggle('hidden', !bb);
    this.root.classList.toggle('has-boss', !!bb);
    if (bb) {
      const key = `${bb.name}|${Math.ceil(bb.hp)}|${bb.phase}|${bb.note || ''}`;
      if (key !== this.bossKey) {
        this.bossKey = key;
        this.bossBox.querySelector('.bn').textContent = `${bb.name}${bb.phase > 1 ? ' · phase ' + bb.phase : ''}${bb.note ? ' · ' + bb.note : ''}`;
        this.bossBox.classList.toggle('exposed', !!bb.exposed);
        this.bossBox.querySelector('i').style.width = Math.max(0, Math.round((bb.hp / bb.maxHp) * 100)) + '%';
      }
    }
    this.beacon.classList.toggle('hidden', !s.beaconReady || s.cycle.phase !== 'day' || !!s.outcome);
    this.nightBtn.classList.toggle('hidden', c.phase !== 'day');
    if (c.phase !== 'day' && this.nightBtn.classList.contains('armed')) this.setNightArmed(false);
    this.updateAct(s);
    if (this.minimapOn) ctl.drawMinimap(this.miniC);
    this.layoutLanes();
  }

  objectiveLine(s) {
    const c = s.cycle;
    const n = c.night + 1;
    const when = c.phase === 'day' ? `Day ${n}` : c.phase === 'dawn' ? `Dawn ${c.night}` : `Night ${n}`;
    let obj;
    if (s.beaconReady) obj = s.bonusNights > 0 ? `Bonus night ${s.bonusNights}` : 'Beacon ready';
    else if (HOOKS.objectiveText) obj = HOOKS.objectiveText(s);
    else obj = `Survive ${Math.min(c.night, s.objective.nights)}/${s.objective.nights}`;
    const ln = c.phase !== 'dawn' && isLongNight(n, s) ? (c.phase === 'night' ? 'The Long Night' : 'Long Night tonight') : '';
    return [when, obj, ln].filter(Boolean).join(' · ');
  }

  // ---- The inline action (economy stream E's soft-lock guard) ---------------------------------
  updateAct(s) {
    const sl = s.econ && s.econ.softlock;
    let key = '';
    if (sl && s.cycle.phase === 'day' && !this.ctl.placement) {
      if (sl.kind === 'trade' && sl.canPay) key = `trade|${sl.price}|${sl.amount}`;
      else if (sl.kind === 'camp' && (!s.blueprints || s.blueprints.includes('lumber'))) key = 'camp';
    }
    if (key === this.actKey) return;
    this.actKey = key;
    this.act.classList.toggle('hidden', !key);
    if (!key) return;
    if (key === 'camp') {
      this.act.querySelector('.ai').innerHTML = `<span style="color:var(--c-wood)">${icon('axe')}</span>`;
      this.act.querySelector('.at').textContent = 'No wood coming in: place a Lumber Camp';
      this.act.setAttribute('aria-label', 'Place a Lumber Camp');
    } else {
      this.act.querySelector('.ai').innerHTML = `<span style="color:var(--c-gold)">${icon('gold')}</span>`;
      this.act.querySelector('.at').textContent = `Trade ${sl.price} gold for ${sl.amount} wood`;
      this.act.setAttribute('aria-label', 'Trade gold for wood at the Hearth');
    }
  }
  onAct() {
    const s = this.s, sl = s && s.econ && s.econ.softlock;
    if (!sl) return;
    if (sl.kind === 'camp') { this.ctl.beginPlacement('lumber'); return; }
    const r = this.ctl.cmd({ t: 'trade', k: 'wood' });
    if (r.ok) { this.ctl.toast(`+${sl.amount} wood from the Hearth stores.`, 'good', 'wood'); this.actKey = null; }
  }

  /** Free-area insets for the toast lane, the coach and the rail (CSS variables on #root). */
  layoutLanes() {
    const R = this.root.getBoundingClientRect();
    const H = R.height || window.innerHeight;
    const tb = Math.max(this.strip.getBoundingClientRect().bottom, this.chips.getBoundingClientRect().bottom) - R.top;
    const bt = this.bottom.getBoundingClientRect().top - R.top;
    const hudB = Math.max(0, Math.round(H - bt));
    const actH = this.act.classList.contains('hidden') ? 0 : this.act.getBoundingClientRect().height + 8;
    // The message lane sits above the bottom bar, between the thumb rail and the other edge (it
    // never hides a portrait). An open card owns its sheet: the lane moves above it (portrait
    // bottom sheet) or beside it (landscape side sheet), so a line never covers its buttons.
    let laneB = hudB + 8 + actH;
    const rl = this.rail.getBoundingClientRect();
    const railLeft = rl.width > 0 && rl.left < R.left + R.width / 2;
    let lo = rl.width > 0 && railLeft ? rl.right - R.left + 8 : 12;
    let hi = rl.width > 0 && !railLeft ? rl.left - R.left - 8 : R.width - 12;
    if (!this.cardBox.classList.contains('hidden')) {
      const C = this.cardBox.getBoundingClientRect();
      if (C.bottom >= R.bottom - 2 && C.width > R.width * 0.6) { laneB = Math.max(laneB, Math.round(R.bottom - C.top + 8)); lo = 12; hi = R.width - 12; }
      else if (C.left < R.left + R.width / 2) lo = Math.max(lo, C.right - R.left + 8);
      else hi = Math.min(hi, C.left - R.left - 8);
    }
    const w = Math.max(160, Math.round(hi - lo));
    const laneX = Math.round(lo + (hi - lo) / 2) + 'px', laneW = w + 'px';
    const key = `${Math.round(tb)}|${hudB}|${actH}|${laneB}|${laneX}|${laneW}`;
    if (key === this.lanes) return;
    this.lanes = key;
    const host = document.getElementById('root') || document.documentElement;
    host.style.setProperty('--hud-t', Math.round(tb + 6) + 'px');
    host.style.setProperty('--hud-b', (hudB + 8) + 'px');
    host.style.setProperty('--lane-b', laneB + 'px');
    host.style.setProperty('--lane-x', laneX);
    host.style.setProperty('--lane-w', laneW);
    if (this.ctl.layoutInsets) this.ctl.layoutInsets(tb, hudB);
  }

  updateAbilities(s) {
    const v = s.sovereign;
    const set = (btn, cd, max) => {
      const f = v && v.alive ? cd / max : 1;
      const cdEl = btn.querySelector('.cd');
      const key = Math.round(f * 40);
      if (btn._k === key) return;
      btn._k = key;
      cdEl.style.background = f > 0 ? `conic-gradient(rgba(10,8,12,0.72) ${f * 360}deg, transparent 0)` : 'none';
      btn.classList.toggle('ready', f <= 0);
    };
    set(this.nova, v ? v.novaCd : 1, SOVEREIGN_ABILITIES.nova.cooldown);
    set(this.bannerBtn, v ? v.bannerCd : 1, SOVEREIGN_ABILITIES.banner.cooldown);
  }

  updatePortraits(s, ctl) {
    const key = s.squads.map((q) => q.id).join(',');
    if (key !== this.squadKey) {
      this.squadKey = key;
      this.portraitBox.innerHTML = '';
      this.portraits.clear();
      this.addPortrait('sov', 'sovereign', 'The Sovereign', '#f0c040', ctl, 0);
      s.squads.forEach((q, i) => this.addPortrait(q.id, null, `${q.name} (squad ${i + 1})`, q.color, ctl, i + 1));
    }
    const sel = ctl.selection;
    for (const [id, p] of this.portraits) {
      let hp = 0, max = 1, n = 0, type = 'militia';
      if (id === 'sov') { const v = s.sovereign; if (v) { hp = v.hp; max = v.maxHp; } }
      else {
        const counts = {};
        for (const u of s.soldiers) if (u.squad === id) { hp += u.hp; max += u.maxHp; n++; counts[u.type] = (counts[u.type] || 0) + 1; }
        const b = s.buildings.find((x) => x.squad === id);
        const q = b ? b.train.length : 0;
        let best = '', bn = 0;
        for (const t in counts) if (counts[t] > bn) { bn = counts[t]; best = t; }
        type = best || (b && b.train[0] ? b.train[0].u : 'militia');
        const badge = q ? `${n}+${q}` : String(n);
        if (p.badgeT !== badge) { p.badge.textContent = badge; p.badgeT = badge; }
        if (p.type !== type) { p.type = type; this.drawPortrait(p, type); }
      }
      const f = Math.max(0, hp / max);
      const w = Math.round(f * 100) + '%';
      if (p.hpW !== w) { p.hp.style.width = w; p.hp.style.background = f > 0.5 ? 'var(--good)' : f > 0.25 ? '#e8c440' : 'var(--bad)'; p.hpW = w; }
      const isSel = !!(sel && ((sel.kind === 'sov' && id === 'sov') || (sel.kind === 'squad' && sel.id === id)));
      if (p.sel !== isSel) { p.sel = isSel; p.node.classList.toggle('sel', isSel); }
    }
  }

  addPortrait(id, type, name, color, ctl, num) {
    const sov = id === 'sov';
    const mark = sov ? `<span class="crown">${icon('crown')}</span>` : `<span class="num" style="background:${color}">${num}</span>`;
    const b = el('button', 'hbtn portrait' + (sov ? ' sov' : ''), `<canvas width="80" height="88"></canvas>${mark}<span class="badge${sov ? ' hidden' : ''}"></span><span class="hp"><i></i></span>`);
    b.setAttribute('aria-label', name);
    if (!sov) b.style.setProperty('--sq', color);
    const p = { node: b, canvas: b.querySelector('canvas'), badge: b.querySelector('.badge'), hp: b.querySelector('.hp i'), type: null };
    let lastTap = 0;
    tapButton(b, () => {
      const now = performance.now();
      if (now - lastTap < 320) ctl.centerOnSquad(id); else ctl.selectSquad(id);
      lastTap = now;
    }, { longpress: () => ctl.explainSquad(id) });
    this.portraitBox.appendChild(b);
    this.portraits.set(id, p);
    this.drawPortrait(p, type || 'militia');
  }

  drawPortrait(p, type) {
    const g = p.canvas.getContext('2d');
    g.clearRect(0, 0, 80, 88);
    const her = this.s.heraldry;
    const sp = unitSprite(type, 0, false, 3, { field: her.field, charge: her.charge, second: her.second });
    g.drawImage(sp.c, 1, -2, 78, 96);
  }

  setToolHint(text) {
    this.toolHint.classList.toggle('hidden', !text);
    if (text) this.toolHint.textContent = text;
  }

  /** The ✓/✕ pair beside the ghost (pos: its top-left corner in screen px). */
  setPlacement(pos, valid, hint) {
    if (!pos) { this.place.classList.add('hidden'); this.placeHint.classList.add('hidden'); return; }
    this.place.classList.remove('hidden');
    this.place.style.left = Math.round(pos.x) + 'px'; this.place.style.top = Math.round(pos.y) + 'px';
    this.placeOk.classList.toggle('disabled', !valid);
    this.placeHint.classList.remove('hidden');
    if (this.placeHint.textContent !== hint) this.placeHint.textContent = hint;
  }
}

function foesLeft(s) {
  let f = s.spawnQueue.length;
  for (const e of s.enemies) if (e.alive && !e.stationary && !e.guard) f++;
  return f;
}

function clock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
