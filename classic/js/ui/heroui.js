// Hero UI (rework Stream C): portraits beside the squads, commanded like squads (tap the
// portrait, then tap the ground to post the hero there or a foe to attack it), the hero card
// (a compact sheet: health, level, its one ability, kills, Guard Hearth / Find), the hero
// choice offered at dawn, and post markers drawn on the map.
// Never mutates the simulation: everything goes through ctl.cmd().
//
// Input wiring: until the controller handles a { kind: 'hero' } selection itself (stream F),
// selecting a hero arms the 'heroOrder' map tool, whose next tap gives the order. orderHero()
// is the same logic for the controller to call once it does.
import { BUS } from '../game/hooks.js';
import { el, tapButton } from './dom.js';
import { icon } from './icons.js';
import { audio } from '../engine/audio.js';
import { getE } from '../game/systems/common.js';
import { HERO_CLASSES, XP_TABLE, MAX_LEVEL, perkDef, traitOf } from '../data/heroes.js';
import { heroCardText, register as registerSim } from '../game/systems/heroes.js';
import { drawHeroPortrait, setSelectedHero, register as registerArt } from '../engine/heroart.js';
import { T, N } from '../game/grid.js';

const GK_TEXT = { guard: 'Guarding the Hearth', post: 'Holding its post', march: 'Marching to its post', attack: 'Attacking your target', fight: 'Fighting', home: 'Falling back to heal' };

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('heroui-css')) return;
  const st = document.createElement('style');
  st.id = 'heroui-css';
  st.textContent = `
.heroports { display: contents; }
.portrait.hero { border-radius: 50%; }
.portrait.hero canvas { border-radius: 50%; }
.portrait.hero .badge { background: #f0c040; }
.portrait.hero .stripe { width: 10px; height: 10px; border-radius: 5px; border: 1px solid rgba(0,0,0,.5); }
.hb-card .hb-head { display: flex; gap: 10px; align-items: center; margin-right: 40px; }
.hb-card .hb-head canvas { width: 48px; height: 53px; border-radius: 50%; background: rgba(0,0,0,.3); flex: none; }
.hb-card h3 { margin: 0; }
.hb-card .sub { font-size: 14px; }
.hb-card .xpbar { height: 6px; border-radius: 3px; background: rgba(0,0,0,.5); overflow: hidden; margin: 2px 0 6px; }
.hb-card .xpbar i { display: block; height: 100%; background: #f0c040; }
.hb-card .hb-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
.hb-card .hb-row .cbtn { min-height: 44px; min-width: 44px; }
.hb-card .hb-row .cbtn.on { background: linear-gradient(#e2b358, #b37f2a); color: #2a1a08; border-color: #f6d488; }
.hb-card .doing { font-size: 14px; font-weight: 700; color: var(--parch-dim); }
.hb-card .hb-line { font-size: 14px; margin: 4px 0; line-height: 1.35; }
.hb-card .hb-line small { font-size: 14px; color: var(--parch-dim); }
`;
  document.head.appendChild(st);
}

// ---- Helpers ---------------------------------------------------------------------------------
function heroesOf(s) { return (s.heroes || []).filter((e) => e.alive && e.kind === 'hero'); }
function xpFrac(e) {
  if (e.level >= MAX_LEVEL) return 1;
  const a = XP_TABLE[e.level - 1], b = XP_TABLE[e.level];
  return Math.max(0, Math.min(1, (e.xp - a) / (b - a)));
}
function portraitCanvas(cls, w = 80, h = 88) {
  const c = el('canvas'); c.width = w; c.height = h;
  try { drawHeroPortrait(c.getContext('2d'), cls, w, h); } catch (err) { /* headless */ }
  return c;
}
function selectedHeroId(ctl) { const s = ctl.selection; return s && s.kind === 'hero' ? s.id : 0; }

/** Select a hero the way a squad is selected: the next tap on the map gives its order. */
export function selectHero(ctl, e, { center = false, card = false } = {}) {
  if (!e) return;
  if (ctl.placement) ctl.cancelPlacement();
  ctl.select({ kind: 'hero', id: e.id });
  setSelectedHero(e.id);
  ctl.setTool('heroOrder', { id: e.id });
  if (center) ctl.cam.centerOn(e.x, e.y);
  if (card) openHeroCard(ctl, e); else if (cardRef && cardRef.heroId !== e.id) ctl.card.close();
}
function deselectHero(ctl) {
  if (selectedHeroId(ctl)) ctl.select(null);
  setSelectedHero(0);
  if (ctl.tool && ctl.tool.name === 'heroOrder') ctl.setTool(null);
}

/** Give the selected hero id the order for a map tap (hit from ctl.pick(p, { enemiesFirst: true })).
 *  Returns true when an order was given (false: the tap picked another unit instead). */
export function orderHero(ctl, id, hit) {
  if (hit.kind === 'enemy') {
    const r = ctl.cmd({ t: 'heroAttack', id, target: hit.e.id });
    if (r.ok) { ctl.ui.tapMark = { x: hit.e.x, y: hit.e.y, t: performance.now(), color: '255,110,90' }; audio.play('clash'); }
    return true;
  }
  const w = hit.w;
  const r = ctl.cmd({ t: 'heroMove', id, x: w.x, y: w.y });
  if (r.ok) { ctl.ui.tapMark = { x: w.x, y: w.y, t: performance.now() }; audio.play('ok'); }
  return true;
}

const heroOrderTool = {
  hint(ctl) {
    const e = ctl.tool && getE(ctl.s, ctl.tool.data.id);
    if (!e) return null;
    const sp = e.name.indexOf(' ');
    return `${sp > 0 ? e.name.slice(0, sp) : e.name}: tap ground to post, a foe to attack.`;
  },
  tap(ctl, p) {
    const id = ctl.tool.data.id;
    if (!getE(ctl.s, id)) { deselectHero(ctl); return true; }
    const hit = ctl.pick(p, { enemiesFirst: true });
    if (hit.kind === 'hero') {
      if (hit.e.id === id) openHeroCard(ctl, hit.e); else selectHero(ctl, hit.e);
      return false;
    }
    if (hit.kind === 'sov') { ctl.selectSquad('sov'); return true; }
    if (hit.kind === 'soldier') { ctl.selectSquad(hit.e.squad); return true; }
    orderHero(ctl, id, hit);
    // Same as a squad order today: the selection ends with the order (the post marker stays).
    deselectHero(ctl);
    return true;
  },
  cancel(ctl) { if (selectedHeroId(ctl)) ctl.select(null); setSelectedHero(0); },
};

// ---- Hero card ---------------------------------------------------------------------------------
// Built once per hero/level/perk set; health, experience, kills and what the hero is doing are
// then updated in place (rebuilding the DOM while hp ticks would swap a button out from under
// a finger between pointerdown and pointerup).
let cardRef = null, cardSig = '', cardEls = null;
export function openHeroCard(ctl, e) {
  cardRef = { title: e.name, sub: 'Hero', text: '', ic: 'crown', heroId: e.id };
  cardSig = '';
  ctl.card.open('text', cardRef);
  renderHeroCard(ctl, e);
}

function heroSig(e) { return e.id * 1000 + e.level * 10 + e.perks.length; }
function hpColor(f) { return f > 0.5 ? 'var(--good)' : f > 0.25 ? '#e8c440' : 'var(--bad)'; }

function renderHeroCard(ctl, e) {
  const box = ctl.card.box;
  const c = HERO_CLASSES[e.cls] || HERO_CLASSES.paladin;
  box.innerHTML = '';
  const close = el('button', 'close', icon('x'));
  close.setAttribute('aria-label', 'Close');
  tapButton(close, () => ctl.closeCard());
  box.appendChild(close);
  const card = el('div', 'hb-card');
  const head = el('div', 'hb-head');
  head.appendChild(portraitCanvas(e.cls, 48 * 2, 53 * 2));
  const ht = el('div');
  ht.appendChild(el('h3')).textContent = e.name;
  const sub = ht.appendChild(el('div', 'sub'));
  head.appendChild(ht);
  card.appendChild(head);
  const hpbar = card.appendChild(el('div', 'hpbar', '<i></i>')).firstChild;
  const xpbar = card.appendChild(el('div', 'xpbar', '<i></i>')).firstChild;
  // Actions first.
  const row = el('div', 'hb-row');
  const order = el('button', 'cbtn gold', `${icon('banner')}<span>Order</span>`);
  order.setAttribute('aria-label', 'Give this hero an order');
  tapButton(order, () => { const h = getE(ctl.s, e.id); if (h) { ctl.card.close(); selectHero(ctl, h); } }, { sound: 'ok' });
  const home = el('button', 'cbtn', `${icon('flame')}<span>Hearth</span>`);
  home.setAttribute('aria-label', 'Guard the Hearth');
  home.title = 'Guard the Hearth';
  tapButton(home, () => { const r = ctl.cmd({ t: 'heroAuto', id: e.id }); if (r.ok) ctl.toast(`${e.name} returns to guard the Hearth.`, 'good', 'flame'); });
  const find = el('button', 'cbtn', `${icon('eye')}<span>Find</span>`);
  find.setAttribute('aria-label', 'Centre the view on this hero');
  tapButton(find, () => { const h = getE(ctl.s, e.id); if (h) ctl.cam.centerOn(h.x, h.y); });
  row.append(order, home, find);
  card.appendChild(row);
  const doing = card.appendChild(el('div', 'doing'));
  const ab = card.appendChild(el('p', 'hb-line'));
  ab.innerHTML = '<b></b> <small></small>';
  ab.querySelector('b').textContent = c.ability.name + ':';
  ab.querySelector('small').textContent = c.ability.text;
  const line = card.appendChild(el('p', 'hb-line'));
  if (e.perks.length) {
    const pp = card.appendChild(el('p', 'hb-line'));
    pp.appendChild(el('small')).textContent = `Perks: ${e.perks.map((id) => (perkDef(id) || { name: id }).name).join(', ')}`;
  }
  box.appendChild(card);
  cardEls = { hpbar, xpbar, sub, line, doing, home, last: {} };
  cardSig = heroSig(e);
  updateHeroCard(e);
}

function setText(L, k, node, v) { if (L[k] !== v) { L[k] = v; node.textContent = v; } }

function updateHeroCard(e) {
  const E = cardEls;
  if (!E) return;
  const L = E.last;
  const c = HERO_CLASSES[e.cls] || HERO_CLASSES.paladin;
  const f = Math.max(0, Math.min(1, e.hp / e.maxHp));
  const w = Math.round(f * 100) + '%';
  if (L.hpW !== w) { L.hpW = w; E.hpbar.style.width = w; E.hpbar.style.background = hpColor(f); }
  const xw = Math.round(xpFrac(e) * 100) + '%';
  if (L.xpW !== xw) { L.xpW = xw; E.xpbar.style.width = xw; }
  setText(L, 'sub', E.sub, `Level ${e.level} ${c.name} · ${Math.ceil(e.hp)}/${e.maxHp}`);
  setText(L, 'line', E.line, `${e.kills} kills · ${e.level >= MAX_LEVEL ? 'max level' : `${Math.floor(e.xp)}/${XP_TABLE[e.level]} XP`} · ${traitOf(e.trait).name}${e.owedPerks && e.owedPerks.length ? ' · a perk awaits at dawn' : ''}`);
  setText(L, 'doing', E.doing, GK_TEXT[e.gk] || 'Guarding the Hearth');
  const auto = e.postX === null || e.postX === undefined;
  if (L.auto !== auto) { L.auto = auto; E.home.classList.toggle('on', auto); }
}

// Keeps an open hero card fresh (and lets go when the core re-rendered the card box).
function refreshCard(ctl, s) {
  if (!cardRef) return;
  if (ctl.card.kind !== 'text' || ctl.card.ref !== cardRef) { cardRef = null; cardEls = null; return; }
  const e = getE(s, cardRef.heroId);
  if (!e || !e.alive) { ctl.closeCard(); cardRef = null; cardEls = null; return; }
  const has = cardEls && ctl.card.box.contains(cardEls.doing);
  if (!has || heroSig(e) !== cardSig) renderHeroCard(ctl, e);
  else updateHeroCard(e);
}

// ---- HUD widget: portraits ------------------------------------------------------------------
function heroPortraits(hud, ctl) {
  const box = el('div', 'heroports');
  hud.slots.squads.appendChild(box);
  const ports = new Map();
  let key = '';
  let t = 0, wasArmed = false;
  const rebuild = (s) => {
    box.innerHTML = '';
    ports.clear();
    for (const e of heroesOf(s)) {
      const c = HERO_CLASSES[e.cls] || HERO_CLASSES.paladin;
      const b = el('button', 'hbtn portrait hero', `<span class="stripe" style="background:${c.color}"></span><span class="badge"></span><span class="hp"><i></i></span>`);
      b.insertBefore(portraitCanvas(e.cls), b.firstChild);
      b.setAttribute('aria-label', `${e.name}, ${c.name}`);
      const id = e.id;
      let lastTap = 0;
      tapButton(b, () => {
        const h = getE(ctl.s, id);
        if (!h) return;
        const now = performance.now();
        if (now - lastTap < 320) { ctl.cam.centerOn(h.x, h.y); selectHero(ctl, h); }
        else if (selectedHeroId(ctl) === id) deselectHero(ctl);
        else selectHero(ctl, h);
        lastTap = now;
      }, { longpress: () => { const h = getE(ctl.s, id); if (h) openHeroCard(ctl, h); } });
      box.appendChild(b);
      ports.set(id, { node: b, badge: b.querySelector('.badge'), hp: b.querySelector('.hp i'), lv: -1, hpW: '' });
    }
  };
  return {
    update(s, dt) {
      let k = '';
      for (const e of s.heroes || []) if (e.alive && e.kind === 'hero') k += e.id + ',';
      if (k !== key) { key = k; rebuild(s); }
      let sel = selectedHeroId(ctl);
      if (sel && !getE(s, sel)) { deselectHero(ctl); sel = 0; }
      // The order tool was dropped (two-finger cancel, a build started): the hero is let go too.
      const armed = !!(ctl.tool && ctl.tool.name === 'heroOrder');
      if (sel && wasArmed && !armed) { ctl.select(null); sel = 0; }
      wasArmed = armed;
      setSelectedHero(sel);
      t += dt;
      if (t >= 0.1) {
        t = 0;
        for (const [id, p] of ports) {
          const e = getE(s, id);
          if (!e) continue;
          if (p.lv !== e.level) { p.lv = e.level; p.badge.textContent = String(e.level); }
          const f = Math.max(0, e.hp / e.maxHp);
          const w = Math.round(f * 100) + '%';
          if (w !== p.hpW) { p.hpW = w; p.hp.style.width = w; p.hp.style.background = f > 0.5 ? 'var(--good)' : f > 0.25 ? '#e8c440' : 'var(--bad)'; }
          p.node.classList.toggle('sel', sel === id);
        }
        refreshCard(ctl, s);
      }
    },
  };
}

// ---- Dawn pick: a hero choice in place of the Offering (until stream H2's Dawn Cards) ----------
function heroDawnUI(ctl, s) {
  const p = s.pending;
  const opts = p.options.map((o, i) => {
    const pick = () => { ctl.cmd({ t: 'choose', i }); if (ctl.autosave) ctl.autosave(); };
    if (o.act === 'supplies') return { icon: 'gold', title: 'Take supplies', text: `+${o.gold} gold for the treasury.`, onPick: pick };
    const tx = heroCardText(s, o);
    return { icon: tx.icon, title: tx.title, text: tx.text, onPick: pick };
  });
  const perk = p.options.find((o) => o.act === 'perk');
  const e = perk ? getE(s, perk.heroId) : null;
  if (e) ctl.app.modal.choice(`Dawn ${s.cycle.night}: ${e.name} grows stronger`, `Choose a perk for your ${(HERO_CLASSES[e.cls] || HERO_CLASSES.paladin).name}, or take supplies.`, opts);
  else ctl.app.modal.choice(`Dawn ${s.cycle.night}: a champion arrives`, 'A hero answers the dawn horn. Take one into your service (at most 2), or take supplies.', opts);
}

// An older save may hold a perk choice queued mid-night: shown as before.
function perkUI(ctl, s) {
  const p = s.pending;
  const e = getE(s, p.heroId);
  const opts = p.options.map((id, i) => {
    const d = perkDef(id) || { name: id, text: '' };
    return { icon: 'up', title: d.name, text: d.text, onPick: () => { ctl.cmd({ t: 'choose', i }); if (ctl.autosave) ctl.autosave(); } };
  });
  const cls = e ? HERO_CLASSES[e.cls].name : 'hero';
  ctl.app.modal.choice(`${p.name || 'Your hero'} reaches level ${p.level}`, `Choose a perk for your ${cls}.`, opts);
}

// ---- Map drawing (overlay: above fog and night so markers always read) ---------------------
function zoomOf(g) {
  const tr = g.getTransform();
  const c = g.canvas;
  const dpr = c && c.clientWidth ? c.width / c.clientWidth : 1;
  return tr.a / dpr;
}
const LABEL_PX = 14;
function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

/** A hero's post: a small pennant in its class colour (bright while selected), and a dashed
 *  line from the hero while it marches there. */
function drawPost(g, e, sel, time) {
  const c = HERO_CLASSES[e.cls] || HERO_CLASSES.paladin;
  const x = e.postX, y = e.postY;
  g.globalAlpha = sel ? 0.95 : 0.55;
  if (e.march || sel) {
    g.strokeStyle = c.color; g.lineWidth = 1.5; g.setLineDash([5, 5]); g.lineDashOffset = -time * 20;
    g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(x, y); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
  }
  g.strokeStyle = c.color; g.lineWidth = 1.6;
  g.beginPath(); g.ellipse(x, y, 11, 4.5, 0, 0, Math.PI * 2); g.stroke();
  // The pennant stands beside the spot, so the hero standing on it does not hide it.
  const fx = x + 13;
  g.strokeStyle = '#4a3828'; g.lineWidth = 2; g.beginPath(); g.moveTo(fx, y + 2); g.lineTo(fx, y - 22); g.stroke();
  const wave = Math.sin(time * 3 + x * 0.01) * 1.2;
  g.fillStyle = c.color; g.strokeStyle = 'rgba(20,12,8,0.8)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(fx + 1, y - 22); g.quadraticCurveTo(fx + 7, y - 23 + wave, fx + 13, y - 20); g.lineTo(fx + 1, y - 14); g.closePath(); g.fill(); g.stroke();
  g.globalAlpha = 1;
}

function drawHeroOverlay(g, s, view, time) {
  if (!s.heroes || !s.heroes.length) return;
  const z = view && view.z ? view.z : zoomOf(g); // the renderer passes its zoom: no canvas layout read
  const sel = curCtl ? selectedHeroId(curCtl) : 0;
  for (const e of s.heroes) {
    if (!e.alive || e.postX === null || e.postX === undefined) continue;
    drawPost(g, e, e.id === sel, time);
  }
  // Name and level labels above heroes when zoomed in.
  if (z > 0.8) {
    const k = 1 / z, h = LABEL_PX + 4;
    for (const e of s.heroes) {
      if (!e.alive || e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1) continue;
      if (s.fog && !s.fog[Math.min(N - 1, Math.max(0, (e.y / T) | 0)) * N + Math.min(N - 1, Math.max(0, (e.x / T) | 0))]) continue;
      const sp = e.name.indexOf(' ');
      const txt = `${sp > 0 ? e.name.slice(0, sp) : e.name} · ${e.level}`;
      g.save(); g.translate(e.x, e.y - 44); g.scale(k, k);
      g.font = `bold ${LABEL_PX}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = g.measureText(txt).width + 12;
      g.fillStyle = 'rgba(25,18,12,0.72)';
      rr(g, -w / 2, -h / 2, w, h, 7); g.fill();
      g.fillStyle = HERO_CLASSES[e.cls] ? HERO_CLASSES[e.cls].color : '#f0c040';
      g.fillText(txt, 0, 0.5);
      g.restore();
    }
  }
}

// ---- Registration ------------------------------------------------------------------------------
let done = false;
let curCtl = null;
export function register() {
  if (done) return;
  done = true;
  registerSim();
  registerArt();
  injectCss();
  BUS.hud.push((hud, ctl) => { curCtl = ctl; return heroPortraits(hud, ctl); });
  BUS.tapEntity.hero = (ctl, e) => selectHero(ctl, e, { card: true });
  BUS.tools.heroOrder = heroOrderTool;
  BUS.pendingUI.heroDawn = heroDawnUI;
  BUS.pendingUI.perk = perkUI;
  BUS.draw.overlay.push(drawHeroOverlay);
}
