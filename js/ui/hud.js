// The in-game HUD: resources, cycle, moon, objective, controls, build bar,
// squad portraits, Sovereign abilities, banners and the placement confirm.
import { el, tapButton, iconBtn, fmt } from './dom.js';
import { icon } from './icons.js';
import { BuildBar } from './buildbar.js';
import { BAL } from '../data/balance.js';
import { UNITS, SOVEREIGN_ABILITIES } from '../data/units.js';
import { popCap } from '../game/systems/common.js';
import { HOOKS } from '../game/hooks.js';
import { ratesPerMin } from '../game/systems/economy.js';
import { isBloodMoon } from '../game/systems/waves.js';
import { unitSprite, banner as drawBanner } from '../engine/sprites.js';

export class Hud {
  constructor(root, ctl) {
    this.root = root; this.ctl = ctl;
    root.innerHTML = '';
    this.t = 0;
    // ---- top bar
    const top = el('div', 'top');
    this.resbar = el('div', 'resbar panel');
    this.her = el('canvas', 'heraldry'); this.her.width = 60; this.her.height = 80;
    this.resbar.appendChild(this.her);
    this.res = {};
    for (const k of ['food', 'wood', 'stone', 'gold', 'pop']) {
      const r = el('div', 'res', `<span style="color:var(--c-${k})">${icon(k)}</span><span class="col"><span class="v">0</span><span class="r"></span></span>`);
      r.dataset.k = k;
      this.res[k] = { node: r, v: r.querySelector('.v'), r: r.querySelector('.r'), last: '' };
      this.resbar.appendChild(r);
      r.addEventListener('pointerdown', () => ctl.explainResource(k));
    }
    this.cyclebar = el('div', 'cyclebar panel');
    this.cyc = el('div', 'cyc', `<div class="phase-ring"><svg class="ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="4"/><circle class="arc" cx="18" cy="18" r="15" fill="none" stroke="#f0c86a" stroke-width="4" stroke-dasharray="94.2" stroke-dashoffset="0" stroke-linecap="round"/></svg><span class="pi"></span></div><span class="cl"></span>`);
    this.arc = this.cyc.querySelector('.arc'); this.pi = this.cyc.querySelector('.pi'); this.cl = this.cyc.querySelector('.cl');
    this.moon = el('div', 'moon', '<canvas width="52" height="52"></canvas><span></span>');
    this.moonC = this.moon.querySelector('canvas'); this.moonT = this.moon.querySelector('span');
    this.obj = el('div', 'objective');
    this.cyclebar.append(this.cyc, this.moon, this.obj);
    this.cyclebar.addEventListener('pointerdown', (e) => { if (e.target.closest('.objective')) ctl.explainObjective(); else ctl.explainCycle(); });
    top.append(this.resbar, this.cyclebar);
    // ---- corner buttons
    const corner = el('div', 'corner');
    this.mapBtn = iconBtn('map', 'Minimap');
    this.muteBtn = iconBtn('sound', 'Mute');
    this.menuBtn = iconBtn('menu', 'Menu');
    tapButton(this.mapBtn, () => this.toggleMinimap());
    tapButton(this.muteBtn, () => ctl.toggleMute());
    tapButton(this.menuBtn, () => ctl.openPauseMenu());
    corner.append(this.mapBtn, this.muteBtn, this.menuBtn);
    this.minimap = el('div', 'minimap panel hidden', '<canvas width="240" height="240"></canvas>');
    this.miniC = this.minimap.querySelector('canvas');
    // ---- abilities
    const ab = el('div', 'abilities');
    this.nova = iconBtn('nova', 'Heartflame Nova'); this.nova.appendChild(el('div', 'cd'));
    this.bannerBtn = iconBtn('banner', 'Royal Banner'); this.bannerBtn.appendChild(el('div', 'cd'));
    tapButton(this.nova, () => ctl.ability('nova'), { sound: null, longpress: () => ctl.explainAbility('nova') });
    tapButton(this.bannerBtn, () => ctl.ability('banner'), { sound: null, longpress: () => ctl.explainAbility('banner') });
    ab.append(this.nova, this.bannerBtn);
    // ---- bottom
    const bottom = el('div', 'bottom');
    this.controls = el('div', 'controls panel');
    this.pauseBtn = iconBtn('pause', 'Pause');
    this.speedBtn = el('button', 'hbtn', '<span style="font-weight:900;font-size:17px">1x</span>');
    this.speedBtn.setAttribute('aria-label', 'Game speed');
    this.nightBtn = iconBtn('nightskip', 'Call the night');
    tapButton(this.pauseBtn, () => ctl.togglePause());
    tapButton(this.speedBtn, () => ctl.cycleSpeed());
    tapButton(this.nightBtn, () => ctl.callNight(), { longpress: () => ctl.toast('Call the Night: skip the rest of the day and face the Hollow now.', '', 'moon') });
    this.controls.append(this.pauseBtn, this.speedBtn, this.nightBtn);
    this.build = new BuildBar(ctl);
    this.squads = el('div', 'squads panel');
    const lower = el('div', 'lower');
    this.controls.style.order = 0; this.build.root.style.order = 1; this.squads.style.order = 2;
    lower.append(this.controls, this.squads);
    bottom.append(this.build.root, lower);
    // ---- overlays
    this.beacon = el('button', 'big-btn beacon-btn hidden', icon('beacon') + '<span>Light the Beacon</span>');
    tapButton(this.beacon, () => ctl.offerBeacon(), { sound: 'ok' });
    this.bannerBox = el('div', 'banner hidden', '<h2></h2><p></p>');
    this.slow = el('div', 'slowmo hidden', 'Time slowed · tap ground to move, a foe to attack');
    this.bossBox = el('div', 'bossbar hidden', '<div class="bn"></div><div class="bb"><i></i></div>');
    this.place = el('div', 'place hidden');
    this.placeNo = iconBtn('x', 'Cancel', 'no');
    this.placeOk = iconBtn('check', 'Build here', 'ok');
    tapButton(this.placeNo, () => ctl.cancelPlacement());
    tapButton(this.placeOk, () => ctl.confirmPlacement(), { sound: null });
    this.place.append(this.placeNo, this.placeOk);
    this.placeHint = el('div', 'place-hint panel hidden');
    this.cardBox = el('div', 'card panel hidden');
    root.append(top, corner, this.minimap, ab, bottom, this.beacon, this.bannerBox, this.slow, this.bossBox, this.place, this.placeHint, this.cardBox);
    this.squadKey = null;
    this.portraits = new Map();
    this.minimapOn = false;
  }

  setState(s) {
    this.s = s;
    this.build.makeThumbs(s.heraldry);
    this.build.setKnown(s.standalone ? null : s.blueprints);
    const g = this.her.getContext('2d');
    g.clearRect(0, 0, 60, 80);
    g.save(); g.scale(2.5, 2.5); drawBanner(g, 2, 2, 20, 28, s.heraldry); g.restore();
    this.squadKey = null;
    this.her.title = s.heraldry.name;
  }

  toggleMinimap(force) {
    this.minimapOn = force ?? !this.minimapOn;
    this.minimap.classList.toggle('hidden', !this.minimapOn);
    this.mapBtn.classList.toggle('on', this.minimapOn);
  }

  showBanner(title, text, cls = '', ms = 2600) {
    const b = this.bannerBox;
    b.className = 'banner ' + cls;
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = text || '';
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.add('hidden'), ms);
  }

  /** Called every frame; text refreshes are throttled. */
  update(s, dt, ctl) {
    this.t += dt;
    this.updateAbilities(s);
    this.updatePortraits(s, ctl);
    if (this.t < 0.12) return;
    this.t = 0;
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
    const sol = '';
    if (sol !== p.lastR) { p.r.textContent = sol; p.lastR = sol; }
    this.build.update(s.res);
    // cycle
    const c = s.cycle, C = BAL.cycle;
    const len = { day: C.dayLen, dusk: C.duskLen, night: C.nightMax, dawn: C.dawnLen }[c.phase];
    const frac = Math.min(1, c.t / len);
    this.arc.setAttribute('stroke-dashoffset', String(94.2 * frac));
    this.arc.setAttribute('stroke', c.phase === 'day' ? '#f0c86a' : c.phase === 'dusk' ? '#ef8a4a' : c.phase === 'night' ? (s.wave?.blood ? '#e0505e' : '#8fa8e8') : '#ffc0b0');
    const pi = c.phase === 'day' || c.phase === 'dawn' ? 'sun' : 'moon';
    if (this.lastPi !== pi) { this.pi.innerHTML = icon(pi); this.lastPi = pi; }
    let label;
    if (c.phase === 'day') label = `Day ${c.night + 1} · ${clock(C.dayLen - c.t)}`;
    else if (c.phase === 'dusk') label = `Dusk · ${Math.ceil(C.duskLen - c.t)}s`;
    else if (c.phase === 'night') { const f = s.enemies.reduce((a, e) => a + (e.alive && !e.stationary ? 1 : 0), 0) + s.spawnQueue.length; label = `Night ${c.night + 1}` + (f ? ` · ${f} foes` : ''); }
    else label = 'Dawn';
    if (label !== this.lastLabel) { this.cl.textContent = label; this.lastLabel = label; }
    this.drawMoon(s);
    let obj;
    if (s.beaconReady) obj = s.bonusNights > 0 ? `Bonus night ${s.bonusNights}` : 'Beacon ready';
    else if (HOOKS.objectiveText) obj = HOOKS.objectiveText(s);
    else obj = `Survive ${Math.min(c.night, s.objective.nights)}/${s.objective.nights}`;
    const bb = HOOKS.bossBar ? HOOKS.bossBar(s) : null;
    this.bossBox.classList.toggle('hidden', !bb);
    this.root.classList.toggle('has-boss', !!bb);
    if (bb) {
      const key = `${bb.name}|${Math.ceil(bb.hp)}|${bb.phase}`;
      if (key !== this.bossKey) {
        this.bossKey = key;
        this.bossBox.querySelector('.bn').textContent = `${bb.name}${bb.phase > 1 ? ' \u00b7 phase ' + bb.phase : ''}`;
        this.bossBox.querySelector('i').style.width = Math.max(0, Math.round((bb.hp / bb.maxHp) * 100)) + '%';
      }
    }
    if (obj !== this.lastObj) { this.obj.textContent = obj; this.lastObj = obj; }
    this.beacon.classList.toggle('hidden', !s.beaconReady || s.cycle.phase !== 'day' || !!s.outcome);
    this.nightBtn.classList.toggle('disabled', c.phase !== 'day');
    if (this.minimapOn) ctl.drawMinimap(this.miniC);
  }

  drawMoon(s) {
    const n = s.cycle.phase === 'night' || s.cycle.phase === 'dusk' ? s.cycle.night + 1 : s.cycle.night + 1;
    const every = BAL.waves.bloodMoonEvery;
    let k = 0;
    while (!isBloodMoon(n + k) && k < every) k++;
    const key = n + ':' + k;
    if (key === this.moonKey) return;
    this.moonKey = key;
    const g = this.moonC.getContext('2d');
    g.clearRect(0, 0, 52, 52);
    const blood = k === 0;
    const phase = 1 - k / every; // fullness
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(26, 26, 22, 0, 6.283); g.fill();
    g.save();
    g.beginPath(); g.arc(26, 26, 20, 0, 6.283); g.clip();
    g.fillStyle = blood ? '#e0505e' : '#e9e1c8'; g.fillRect(0, 0, 52, 52);
    g.fillStyle = 'rgba(30,26,40,0.92)';
    g.beginPath(); g.arc(26 - 6 - 40 * phase, 26, 21, 0, 6.283); g.fill();
    g.restore();
    this.moonT.textContent = blood ? 'Tonight!' : `in ${k}`;
    this.moon.title = blood ? 'A Blood Moon rises tonight' : `Blood Moon in ${k} nights`;
    this.moon.style.color = blood ? '#ff8a8a' : '';
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
      this.squads.innerHTML = '';
      this.portraits.clear();
      this.addPortrait('sov', 'sovereign', 'The Sovereign', '#f0c040', ctl);
      for (const q of s.squads) this.addPortrait(q.id, null, q.name, q.color, ctl);
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
        type = Object.entries(counts).sort((a, b2) => b2[1] - a[1])[0]?.[0] || (b && b.train[0] ? b.train[0].u : 'militia');
        const badge = q ? `${n}+${q}` : String(n);
        if (p.badgeT !== badge) { p.badge.textContent = badge; p.badgeT = badge; }
        if (p.type !== type) { p.type = type; this.drawPortrait(p, type); }
      }
      const f = Math.max(0, hp / max);
      const w = Math.round(f * 100) + '%';
      if (p.hpW !== w) { p.hp.style.width = w; p.hp.style.background = f > 0.5 ? 'var(--good)' : f > 0.25 ? '#e8c440' : 'var(--bad)'; p.hpW = w; }
      const isSel = sel && ((sel.kind === 'sov' && id === 'sov') || (sel.kind === 'squad' && sel.id === id));
      p.node.classList.toggle('sel', !!isSel);
    }
  }

  addPortrait(id, type, name, color, ctl) {
    const b = el('button', 'hbtn portrait', `<canvas width="80" height="88"></canvas><span class="stripe" style="background:${color}"></span><span class="badge hidden"></span><span class="hp"><i></i></span>`);
    b.setAttribute('aria-label', name);
    const p = { node: b, canvas: b.querySelector('canvas'), badge: b.querySelector('.badge'), hp: b.querySelector('.hp i'), type: null };
    if (id !== 'sov') p.badge.classList.remove('hidden');
    let lastTap = 0;
    tapButton(b, () => {
      const now = performance.now();
      if (now - lastTap < 320) ctl.centerOnSquad(id); else ctl.selectSquad(id);
      lastTap = now;
    }, { longpress: () => ctl.explainSquad(id) });
    this.squads.appendChild(b);
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

  setPlacement(pos, valid, hint) {
    if (!pos) { this.place.classList.add('hidden'); this.placeHint.classList.add('hidden'); return; }
    this.place.classList.remove('hidden');
    this.place.style.left = pos.x + 'px'; this.place.style.top = pos.y + 'px';
    this.placeOk.classList.toggle('disabled', !valid);
    this.placeHint.classList.remove('hidden');
    if (this.placeHint.textContent !== hint) this.placeHint.textContent = hint;
  }
}

function clock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
void UNITS;
