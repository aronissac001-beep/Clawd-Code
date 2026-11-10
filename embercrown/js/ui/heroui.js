// Hero UI (Phase 3): portraits beside the squads, the hero card with Rally,
// the bounty-flag button and picker, map tools for placing flags and rallying,
// the perk choice dialog, the Tavern's recruit list, and flags drawn on the map.
// Never mutates the simulation: everything goes through ctl.cmd().
import { BUS } from '../game/hooks.js';
import { el, tapButton } from './dom.js';
import { icon } from './icons.js';
import { getE } from '../game/systems/common.js';
import { HERO_CLASSES, TRAITS, QUIRKS, XP_TABLE, MAX_LEVEL, HERO_RULES as R, perkDef } from '../data/heroes.js';
import { heroStats, tavernOffers, livingHeroes, register as registerSim } from '../game/systems/heroes.js';
import { drawHeroPortrait, setSelectedHero, register as registerArt } from '../engine/heroart.js';

import { T, N } from '../game/grid.js';
export const BOUNTY_KINDS = {
  attack: { id: 'attack', name: 'Attack', icon: 'sword', color: '#d8483a', text: 'Paid to the hero who slays the marked foe or lair.', need: 'Tap a foe or a lair.' },
  explore: { id: 'explore', name: 'Explore', icon: 'eye', color: '#3a9ad8', text: 'Paid to the first hero to reach the flag. The land around it is revealed.', need: 'Tap anywhere, even in the fog.' },
  defend: { id: 'defend', name: 'Defend', icon: 'shield', color: '#58b048', text: 'Paid if the building still stands after 60 s with a hero within 3 tiles.', need: 'Tap one of your buildings.' },
  avoid: { id: 'avoid', name: 'Avoid', icon: 'x', color: '#9a7ac8', text: 'No gold. Heroes keep out of a 4-tile zone unless paid or rallied.', need: 'Tap the place to keep clear.' },
};
const FLAG_SVG = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M4 2h2.2v20H4z"/><path d="M6.2 3H19l-3 4.2L19 11.4H6.2z"/><circle cx="17" cy="17.5" r="4.5" fill="#f0c040" stroke="#7a5310" stroke-width="1.2"/><path d="M17 15v5" stroke="#7a5310" stroke-width="1.3"/></svg>';
const GK_TEXT = { idle: 'Idle', rest: 'Resting by the Hearth', wander: 'Wandering', watch: 'Keeping watch', home: 'Falling back to heal', bounty: 'Chasing a bounty', fight: 'Fighting', guard: 'Defending the settlement', rally: 'Following your Rally' };

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('heroui-css')) return;
  const st = document.createElement('style');
  st.id = 'heroui-css';
  st.textContent = `
.heroports { display: contents; }
.portrait.hero .badge { background: #f0c040; }
.portrait.hero .stripe { width: 10px; height: 10px; border-radius: 5px; border: 1px solid rgba(0,0,0,.5); }
.hb-card .hb-head { display: flex; gap: 10px; align-items: center; margin-right: 40px; }
.hb-card .hb-head canvas { width: 48px; height: 53px; border-radius: 10px; background: rgba(0,0,0,.3); flex: none; }
.hb-card h3 { margin: 0; }
.hb-card .xpbar { height: 6px; border-radius: 3px; background: rgba(0,0,0,.5); overflow: hidden; margin: 2px 0 6px; }
.hb-card .xpbar i { display: block; height: 100%; background: #f0c040; }
.hb-card .doing { font-size: 14px; font-weight: 700; color: var(--parch-dim); }
@media (orientation: landscape) and (max-height: 440px) { .abilities .hbtn.bounty { width: 48px; height: 48px; align-self: center; } .abilities .hbtn.bounty .ic { width: 26px; height: 26px; } }
.hb-card .tag { display: inline-block; font-size: 14px; font-weight: 800; padding: 2px 8px; border-radius: 8px; background: rgba(240,192,64,.16); margin: 2px 4px 2px 0; }
.hb-card p small, .hb-recruit small { font-size: 14px; color: var(--parch-dim); }
.hb-recruit { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.hb-recruit canvas { width: 40px; height: 44px; border-radius: 8px; background: rgba(0,0,0,.3); flex: none; }
.hb-recruit .meta { flex: 1; min-width: 0; font-size: 14px; line-height: 1.3; }
.hb-recruit .meta b { font-size: 15px; }
.hb-pick .row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin: 8px 0; }
.hb-pick .cbtn.on { background: linear-gradient(#e2b358, #b37f2a); color: #2a1a08; border-color: #f6d488; }
.hb-pick .desc { text-align: center; font-size: 15px; margin: 4px 0 8px; min-height: 40px; }
.hb-pick .active { margin-top: 10px; font-size: 15px; }
.hb-pick .active .cbtn { min-height: 44px; }
.hbtn.bounty .badge { background: #f0c040; }
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

export function selectHero(ctl, e, { center = true, card = true } = {}) {
  if (!e) return;
  if (ctl.placement) ctl.cancelPlacement();
  ctl.select({ kind: 'hero', id: e.id });
  setSelectedHero(e.id);
  if (center) ctl.cam.centerOn(e.x, e.y);
  if (card) openHeroCard(ctl, e);
}

// ---- Hero card ---------------------------------------------------------------------------------
// Built once per hero/level/perk set; health, experience, purse, goal and the Rally countdown
// are then updated in place. (Rebuilding the DOM while hp ticks would swap the Rally button
// out from under a finger between pointerdown and pointerup, and the tap would be lost.)
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
  const s = ctl.s;
  const box = ctl.card.box;
  const c = HERO_CLASSES[e.cls];
  const tr = TRAITS[e.trait], q = QUIRKS[e.quirk];
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
  ht.appendChild(el('div', 'sub')).textContent = `Level ${e.level} ${c.name} \u00b7 ${c.role}`;
  head.appendChild(ht);
  card.appendChild(head);
  const hpbar = card.appendChild(el('div', 'hpbar', '<i></i>')).firstChild;
  const xpbar = card.appendChild(el('div', 'xpbar', '<i></i>')).firstChild;
  const row = el('div', 'row');
  const rally = el('button', 'cbtn gold', `${icon('banner')}<span></span>`);
  rally.setAttribute('aria-label', 'Rally this hero');
  tapButton(rally, () => {
    const h = getE(ctl.s, e.id);
    if (!h) return;
    if (h.rallyCd > 0) { ctl.toast(`${h.name} will heed another Rally in ${Math.ceil(h.rallyCd)} s.`, 'bad'); return; }
    ctl.card.close();
    ctl.setTool('heroRally', { id: h.id });
  }, { sound: 'ok' });
  const find = el('button', 'cbtn', `${icon('eye')}<span>Find</span>`);
  find.setAttribute('aria-label', 'Centre the view on this hero');
  tapButton(find, () => { const h = getE(ctl.s, e.id); if (h) ctl.cam.centerOn(h.x, h.y); });
  const doing = el('span', 'doing');
  row.append(rally, find, doing);
  card.appendChild(row);
  const st = heroStats(s, e);
  const rows = [
    ['Health', 'hp'], ['Experience', 'xp'],
    ['Damage', `${Math.round(st.dmg)} ${st.dmgType}`], ['Range', st.ranged ? `${st.range} tiles` : 'melee'],
    ['Armor', `${Math.round(st.armor * 100)}%`], ['Purse', 'purse'],
  ];
  const stats = el('div', 'stats');
  const live = {};
  for (const [k, v] of rows) {
    stats.appendChild(el('span')).textContent = k;
    const b = stats.appendChild(el('b'));
    if (v === 'hp' || v === 'xp' || v === 'purse') live[v] = b; else b.textContent = v;
  }
  card.appendChild(stats);
  const ab = el('p');
  ab.innerHTML = '<b></b> <small></small>';
  ab.querySelector('b').textContent = c.ability.name + ':';
  ab.querySelector('small').textContent = c.ability.text;
  card.appendChild(ab);
  const tags = el('p');
  for (const [lab, def] of [['Trait', tr], ['Quirk', q]]) {
    if (!def) continue;
    const t = el('div');
    t.innerHTML = '<span class="tag"></span><small></small>';
    t.querySelector('.tag').textContent = `${lab}: ${def.name}`;
    t.querySelector('small').textContent = def.text;
    tags.appendChild(t);
  }
  card.appendChild(tags);
  const pp = el('p');
  if (e.perks.length) {
    pp.innerHTML = '<b>Perks:</b> ';
    pp.appendChild(document.createTextNode(e.perks.map((id) => (perkDef(id) || { name: id }).name).join(', ')));
  } else pp.innerHTML = '<small>New perks at levels 3, 6 and 9. Heroes pick their own fights: post bounty flags to steer them, or Rally for a 15 s order.</small>';
  card.appendChild(pp);
  box.appendChild(card);
  cardEls = { hpbar, xpbar, rally, rallyLbl: rally.querySelector('span'), doing, live, last: {} };
  cardSig = heroSig(e);
  updateHeroCard(e);
}

function setText(L, k, node, v) { if (L[k] !== v) { L[k] = v; node.textContent = v; } }

function updateHeroCard(e) {
  const E = cardEls;
  if (!E) return;
  const L = E.last;
  const f = Math.max(0, Math.min(1, e.hp / e.maxHp));
  const w = Math.round(f * 100) + '%';
  if (L.hpW !== w) { L.hpW = w; E.hpbar.style.width = w; E.hpbar.style.background = hpColor(f); }
  const xw = Math.round(xpFrac(e) * 100) + '%';
  if (L.xpW !== xw) { L.xpW = xw; E.xpbar.style.width = xw; }
  setText(L, 'hp', E.live.hp, `${Math.ceil(e.hp)}/${e.maxHp}`);
  setText(L, 'xp', E.live.xp, e.level >= MAX_LEVEL ? 'max level' : `${Math.floor(e.xp)}/${XP_TABLE[e.level]} XP`);
  setText(L, 'purse', E.live.purse, `${e.purse} gold \u00b7 ${e.kills} kills`);
  setText(L, 'doing', E.doing, GK_TEXT[e.gk] || 'Idle');
  const cd = Math.ceil(e.rallyCd);
  setText(L, 'rally', E.rallyLbl, cd > 0 ? `Rally in ${cd}s` : 'Rally');
  if (L.cd !== (cd > 0)) { L.cd = cd > 0; E.rally.classList.toggle('disabled', cd > 0); }
}

// Keeps an open hero card fresh (and restores it if the core re-rendered the card box).
function refreshCard(ctl, s) {
  if (!cardRef) return;
  if (ctl.card.kind !== 'text' || ctl.card.ref !== cardRef) { cardRef = null; cardEls = null; return; }
  const e = getE(s, cardRef.heroId);
  if (!e) { ctl.closeCard(); cardRef = null; cardEls = null; return; }
  const has = cardEls && ctl.card.box.contains(cardEls.rally);
  if (!has || heroSig(e) !== cardSig) renderHeroCard(ctl, e);
  else updateHeroCard(e);
}

// ---- HUD widget: portraits ------------------------------------------------------------------
function heroPortraits(hud, ctl) {
  const box = el('div', 'heroports');
  hud.slots.squads.appendChild(box);
  const ports = new Map();
  let key = '';
  let t = 0;
  const rebuild = (s) => {
    box.innerHTML = '';
    ports.clear();
    for (const e of heroesOf(s)) {
      const c = HERO_CLASSES[e.cls];
      const b = el('button', 'hbtn portrait hero', `<span class="stripe" style="background:${c.color}"></span><span class="badge"></span><span class="hp"><i></i></span>`);
      b.insertBefore(portraitCanvas(e.cls), b.firstChild);
      b.setAttribute('aria-label', `${e.name}, ${c.name}`);
      const id = e.id;
      tapButton(b, () => { const h = getE(ctl.s, id); if (h) selectHero(ctl, h); }, { longpress: () => { const h = getE(ctl.s, id); if (h) selectHero(ctl, h, { center: false }); } });
      box.appendChild(b);
      ports.set(id, { node: b, badge: b.querySelector('.badge'), hp: b.querySelector('.hp i'), lv: -1, hpW: '' });
    }
  };
  return {
    update(s, dt) {
      let k = '';
      for (const e of s.heroes || []) if (e.alive && e.kind === 'hero') k += e.id + ',';
      if (k !== key) { key = k; rebuild(s); }
      const sel = ctl.selection;
      setSelectedHero(sel && sel.kind === 'hero' ? sel.id : 0);
      if (sel && sel.kind === 'hero' && !getE(s, sel.id)) ctl.select(null);
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
          p.node.classList.toggle('sel', !!(sel && sel.kind === 'hero' && sel.id === id));
        }
        refreshCard(ctl, s);
      }
    },
  };
}

// ---- HUD widget: bounty button and picker ------------------------------------------------
let pickKind = 'attack', pickGold = 30;
function bountyButton(hud, ctl) {
  const btn = el('button', 'hbtn bounty', FLAG_SVG + '<span class="badge hidden"></span>');
  btn.setAttribute('aria-label', 'Bounty flags');
  btn.title = 'Bounty flags';
  const badge = btn.querySelector('.badge');
  tapButton(btn, () => {
    if (ctl.tool && ctl.tool.name === 'bounty') { ctl.setTool(null); return; }
    openPicker(ctl);
  }, { longpress: () => ctl.openText('Bounty Flags', 'Indirect orders', ['Heroes cannot be ordered about, but they love gold. Post a flag with a reward and heroes decide whether it is worth it: bigger and closer bounties draw more of them.', 'Attack: slay a foe or lair. Explore: reach a spot. Defend: guard a building for 60 s. Avoid: a zone heroes keep out of.', 'The gold is held until a hero earns it. Cancel a flag to get it back.'], 'gold') });
  const rail = hud.slots.rail;
  rail.insertBefore(btn, rail.firstChild);
  let last = '';
  return {
    update(s) {
      const X = s.ext && s.ext.heroes;
      const n = X ? X.bounties.length : 0;
      const k = n + ':' + (ctl.tool && ctl.tool.name === 'bounty' ? 1 : 0) + ':' + livingHeroes(s);
      if (k === last) return;
      last = k;
      badge.textContent = String(n);
      badge.classList.toggle('hidden', !n);
      btn.classList.toggle('on', !!(ctl.tool && ctl.tool.name === 'bounty'));
      btn.classList.toggle('disabled', !livingHeroes(s) && !n);
    },
  };
}

export function openPicker(ctl) {
  const s = ctl.s;
  if (!livingHeroes(s)) { ctl.toast('No hero to claim a bounty. Hire one at a Tavern.', 'bad', 'crown'); return; }
  const body = el('div', 'hb-pick');
  const kinds = el('div', 'row');
  const desc = el('p', 'desc');
  const golds = el('div', 'row');
  const kbtn = {}, gbtn = {};
  const refresh = () => {
    for (const k in kbtn) kbtn[k].classList.toggle('on', k === pickKind);
    for (const g in gbtn) {
      gbtn[g].classList.toggle('on', +g === pickGold);
      gbtn[g].classList.toggle('disabled', s.res.gold < +g);
    }
    golds.classList.toggle('hidden', pickKind === 'avoid');
    desc.textContent = BOUNTY_KINDS[pickKind].text;
  };
  for (const k of Object.keys(BOUNTY_KINDS)) {
    const d = BOUNTY_KINDS[k];
    const b = el('button', 'cbtn', `<span style="color:${d.color}">${icon(d.icon)}</span><span>${d.name}</span>`);
    b.dataset.kind = k;
    tapButton(b, () => { pickKind = k; refresh(); });
    kbtn[k] = b; kinds.appendChild(b);
  }
  for (const g of R.bountyGold) {
    const b = el('button', 'cbtn', `<span style="color:var(--c-gold)">${icon('gold')}</span><span>${g}</span>`);
    b.dataset.gold = g;
    tapButton(b, () => { if (s.res.gold < g) { ctl.toast('Not enough gold.', 'bad'); return; } pickGold = g; refresh(); });
    gbtn[g] = b; golds.appendChild(b);
  }
  if (s.res.gold < pickGold) pickGold = R.bountyGold.filter((g) => s.res.gold >= g).pop() || R.bountyGold[0];
  body.append(kinds, desc, golds);
  const X = s.ext.heroes;
  if (X && X.bounties.length) {
    const act = el('div', 'active');
    act.appendChild(el('b', '', 'Posted flags'));
    for (const b of X.bounties) {
      const d = BOUNTY_KINDS[b.kind];
      const r = el('div', 'row');
      r.style.justifyContent = 'space-between';
      const lab = el('span', '', `<span style="color:${d.color}">${icon(d.icon)}</span> `);
      lab.appendChild(document.createTextNode(`${d.name}${b.gold ? ' · ' + b.gold + ' gold' : ''}`));
      const cancel = el('button', 'cbtn red', `${icon('trash')}<span>Cancel</span>`);
      tapButton(cancel, () => { ctl.cmd({ t: 'cancelBounty', id: b.id }); r.remove(); });
      r.append(lab, cancel);
      act.appendChild(r);
    }
    body.appendChild(act);
  }
  refresh();
  ctl.app.modal.dialog('Post a Bounty', body, [
    { label: 'Choose the spot', icon: 'check', cls: 'primary', onTap: () => {
      if (pickKind !== 'avoid' && ctl.s.res.gold < pickGold) { ctl.toast('Not enough gold.', 'bad'); return; }
      ctl.setTool('bounty', { kind: pickKind, gold: pickKind === 'avoid' ? 0 : pickGold });
    } },
    { label: 'Close', icon: 'x' },
  ], { dismissable: true });
}

// ---- Map tools ----------------------------------------------------------------------------------
const bountyTool = {
  hint(ctl) {
    const d = ctl.tool && ctl.tool.data;
    if (!d) return null;
    const k = BOUNTY_KINDS[d.kind];
    return `${k.name} bounty${d.gold ? ' (' + d.gold + ' gold)' : ''}: ${k.need} Two-finger tap to cancel.`;
  },
  tap(ctl, p, w) {
    const d = ctl.tool.data;
    let c = null;
    if (d.kind === 'attack') {
      const hit = ctl.pick(p, { enemiesFirst: true });
      if (hit.kind !== 'enemy' && !(hit.e && hit.e.kind === 'lair')) { ctl.toast('Tap a foe or a lair to mark it.', 'bad', 'sword'); return false; }
      c = { t: 'placeBounty', kind: 'attack', targetId: hit.e.id, gold: d.gold };
    } else if (d.kind === 'defend') {
      const hit = ctl.pick(p);
      if (hit.kind !== 'building') { ctl.toast('Tap one of your buildings to guard it.', 'bad', 'shield'); return false; }
      c = { t: 'placeBounty', kind: 'defend', buildingId: hit.b.id, gold: d.gold };
    } else c = { t: 'placeBounty', kind: d.kind, x: w.x, y: w.y, gold: d.gold };
    const r = ctl.cmd(c);
    if (r.ok) {
      ctl.ui.tapMark = { x: w.x, y: w.y, t: performance.now(), color: '255,220,110' };
      ctl.toast(d.kind === 'avoid' ? 'Heroes will keep clear of that place.' : `Bounty posted: ${d.gold} gold. Heroes are taking note.`, 'good', 'gold');
    }
    return true;
  },
  cancel() {},
};

const rallyTool = {
  hint(ctl) {
    const e = ctl.tool && getE(ctl.s, ctl.tool.data.id);
    return e ? `Rally ${e.name}: tap the ground to send them there, or a foe to attack it.` : null;
  },
  tap(ctl, p, w) {
    const id = ctl.tool.data.id;
    const hit = ctl.pick(p, { enemiesFirst: true });
    const r = hit.kind === 'enemy' ? ctl.cmd({ t: 'heroRally', id, target: hit.e.id }) : ctl.cmd({ t: 'heroRally', id, x: w.x, y: w.y });
    if (r.ok) ctl.ui.tapMark = { x: w.x, y: w.y, t: performance.now(), color: hit.kind === 'enemy' ? '255,110,90' : undefined };
    return true;
  },
  cancel() {},
};

// ---- Perk dialog ------------------------------------------------------------------------------
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

// ---- Tavern card ---------------------------------------------------------------------------------
function tavernCard(box, s, b, ctl) {
  if (b.type !== 'tavern' || !b.built) return;
  const list = tavernOffers(s, b);
  const n = livingHeroes(s);
  box.appendChild(el('div', 'queue', `<b>Heroes for hire</b> · ${n}/${R.maxHeroes} serve you · new faces at dawn`));
  if (!list.length) { box.appendChild(el('p', '', '<small>Nobody is drinking here yet. Come back tomorrow.</small>')); return; }
  list.forEach((c, i) => {
    const cls = HERO_CLASSES[c.cls];
    const row = el('div', 'hb-recruit');
    row.appendChild(portraitCanvas(c.cls));
    const meta = el('div', 'meta');
    meta.innerHTML = '<b></b><br><span></span><br><small></small>';
    meta.querySelector('b').textContent = c.name;
    meta.querySelector('span').textContent = `${cls.name} · ${cls.ability.name}`;
    meta.querySelector('small').textContent = `${TRAITS[c.trait].name} · ${QUIRKS[c.quirk].name}`;
    row.appendChild(meta);
    if (c.hired) row.appendChild(el('span', 'tag', '<b>Hired</b>'));
    else {
      const okk = s.res.gold >= c.price && n < R.maxHeroes;
      const hire = el('button', 'cbtn gold' + (okk ? '' : ' disabled'), `<span>Hire</span> <span style="color:#5a3a08">${icon('gold')}</span><span>${c.price}</span>`);
      hire.setAttribute('aria-label', `Hire ${c.name} for ${c.price} gold`);
      tapButton(hire, () => ctl.cmd({ t: 'recruitHero', id: b.id, i }), { sound: 'coin' });
      row.appendChild(hire);
    }
    box.appendChild(row);
  });
}

// ---- Map drawing (overlay: above fog and night so flags always read) ---------------------
function zoomOf(g) {
  const tr = g.getTransform();
  const c = g.canvas;
  const dpr = c && c.clientWidth ? c.width / c.clientWidth : 1;
  return tr.a / dpr;
}

function drawFlag(g, x, y, kind, gold, time, z) {
  const d = BOUNTY_KINDS[kind];
  const wave = Math.sin(time * 3 + x * 0.01) * 1.5;
  g.fillStyle = 'rgba(20,15,30,0.3)'; g.beginPath(); g.ellipse(x, y, 6, 2.4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4a3828'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 34); g.stroke();
  g.fillStyle = '#f0c040'; g.beginPath(); g.arc(x, y - 35, 2, 0, Math.PI * 2); g.fill();
  g.fillStyle = d.color; g.strokeStyle = 'rgba(20,12,8,0.8)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x + 1, y - 33); g.quadraticCurveTo(x + 10, y - 35 + wave, x + 20, y - 32); g.lineTo(x + 20, y - 19); g.quadraticCurveTo(x + 10, y - 22 + wave, x + 1, y - 20); g.closePath(); g.fill(); g.stroke();
  // glyph
  const gx = x + 10.5, gy = y - 26.5 + wave * 0.5;
  g.strokeStyle = '#fff6e0'; g.fillStyle = '#fff6e0'; g.lineWidth = 1.6;
  if (kind === 'attack') { g.beginPath(); g.moveTo(gx - 4, gy + 4); g.lineTo(gx + 4, gy - 4); g.moveTo(gx - 2, gy - 1); g.lineTo(gx + 1, gy + 2); g.stroke(); }
  else if (kind === 'explore') { g.beginPath(); g.ellipse(gx, gy, 4.5, 2.6, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(gx, gy, 1.2, 0, 6.283); g.fill(); }
  else if (kind === 'defend') { g.beginPath(); g.moveTo(gx - 3.5, gy - 3.5); g.lineTo(gx + 3.5, gy - 3.5); g.lineTo(gx + 3.5, gy); g.quadraticCurveTo(gx, gy + 4.5, gx, gy + 4.5); g.quadraticCurveTo(gx - 3.5, gy + 2, gx - 3.5, gy); g.closePath(); g.stroke(); }
  else { g.beginPath(); g.moveTo(gx - 3, gy - 3); g.lineTo(gx + 3, gy + 3); g.moveTo(gx + 3, gy - 3); g.lineTo(gx - 3, gy + 3); g.stroke(); }
  if (gold && z > 0.55) {
    // The label keeps a constant 14 px on screen whatever the zoom.
    const k = 1 / z;
    g.save(); g.translate(x, y + 3); g.scale(k, k);
    const txt = String(gold);
    g.font = `bold ${LABEL_PX}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(txt).width + 22, h = LABEL_PX + 5;
    g.fillStyle = 'rgba(30,22,14,0.85)';
    rr(g, -w / 2, 0, w, h, h / 2); g.fill();
    g.fillStyle = '#f0c040'; g.beginPath(); g.arc(-w / 2 + 9, h / 2, 4.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffe9a8'; g.fillText(txt, 4, h / 2 + 0.5);
    g.restore();
  }
}
const LABEL_PX = 14;
function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
}

function drawBounties(g, s, view, time) {
  const X = s.ext && s.ext.heroes;
  const z = view && view.z ? view.z : zoomOf(g); // the renderer passes its zoom: no canvas layout read
  if (X && X.bounties.length) {
    for (const b of X.bounties) {
      let x = b.x, y = b.y;
      if (b.kind === 'attack') {
        const t = getE(s, b.targetId);
        if (t) { x = t.x; y = t.y; }
        g.strokeStyle = 'rgba(230,80,60,0.9)'; g.lineWidth = 1.6; g.setLineDash([4, 3]);
        g.beginPath(); g.ellipse(x, y - 2, 14, 6, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
        y -= 24;
      } else if (b.kind === 'defend') {
        const bd = s.rt.bById.get(b.buildingId);
        if (bd) {
          g.strokeStyle = 'rgba(110,210,90,0.8)'; g.lineWidth = 1.6; g.setLineDash([5, 4]);
          g.strokeRect(bd.tx * T - 2, bd.ty * T - 2, bd.size * T + 4, bd.size * T + 4); g.setLineDash([]);
          // countdown arc
          const f = Math.max(0, Math.min(1, (b.until - s.time) / R.defendTime));
          g.strokeStyle = 'rgba(110,210,90,0.95)'; g.lineWidth = 3;
          g.beginPath(); g.arc(x, y + 8, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); g.stroke();
        }
      } else if (b.kind === 'avoid') {
        const r = R.avoidRadius * T;
        g.fillStyle = 'rgba(150,120,200,0.12)'; g.strokeStyle = 'rgba(170,140,220,0.8)'; g.lineWidth = 2; g.setLineDash([8, 6]);
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke(); g.setLineDash([]);
      }
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      drawFlag(g, x, y, b.kind, b.gold, time, z);
    }
  }
  // Name and level labels above heroes when zoomed in.
  if (z > 0.8 && s.heroes && s.heroes.length) {
    const k = 1 / z, h = LABEL_PX + 4;
    for (const e of s.heroes) {
      if (!e.alive || e.x < view.x0 || e.x > view.x1 || e.y < view.y0 || e.y > view.y1) continue;
      if (s.fog && !s.fog[Math.min(N - 1, Math.max(0, (e.y / T) | 0)) * N + Math.min(N - 1, Math.max(0, (e.x / T) | 0))]) continue;
      const sp = e.name.indexOf(' ');
      const txt = `${sp > 0 ? e.name.slice(0, sp) : e.name} \u00b7 ${e.level}`;
      g.save(); g.translate(e.x, e.y - (e.rallyT > 0 ? 50 : 44)); g.scale(k, k);
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
export function register() {
  if (done) return;
  done = true;
  registerSim();
  registerArt();
  injectCss();
  BUS.hud.push(heroPortraits, bountyButton);
  BUS.tapEntity.hero = (ctl, e) => selectHero(ctl, e, { center: false });
  BUS.tools.bounty = bountyTool;
  BUS.tools.heroRally = rallyTool;
  BUS.pendingUI.perk = perkUI;
  BUS.card.push(tavernCard);
  BUS.draw.overlay.push(drawBounties);
}
