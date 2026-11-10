// Morale and Dread HUD and the Book of Decrees (Phase 3).
//  - Two compact meters in the resource bar: a sun-gold Morale bar and a grey-violet Dread
//    bar, each with an icon and its number (tap: what they do right now; long-press: read
//    the Book of Decrees).
//  - BUS.pendingUI.decree: the Book of Decrees at every 3rd dawn. Three columns (Path of the
//    Flame, Path of the Iron Crown, Laws of the Realm); tap a card, then Sign, or Not now.
//  - A faint ring around each Wailer showing the reach of its wail.
// Never mutates the simulation: signing goes through ctl.cmd({ t: 'choose', i }).
// register() also registers the simulation module (js/game/systems/mood.js).
import { BUS } from '../game/hooks.js';
import { el, tapButton } from './dom.js';
import { icon } from './icons.js';
import { DECREES, DECREE_ORDER, BRANCHES, TIER_LABEL, moodLines, decreeStatus } from '../data/decrees.js';
import { MOOD, moodSummary, register as registerMood } from '../game/systems/mood.js';
import { T, N, idx } from '../game/grid.js';

function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('moodui-css')) return;
  const st = document.createElement('style');
  st.id = 'moodui-css';
  st.textContent = `
.moodm { position: relative; flex: none; display: flex; flex-direction: column; justify-content: center; gap: 3px; width: 70px; min-height: 38px; padding: 0 2px; border-radius: 10px; color: inherit; touch-action: manipulation; }
.moodm::before { content: ''; position: absolute; inset: -4px -2px; }
.moodm.pressed { background: rgba(255,255,255,0.08); }
.moodm .mm-row { display: flex; align-items: center; gap: 3px; height: 17px; }
.moodm .ic { width: 15px; height: 15px; flex: none; }
.moodm .mm-row.mo .ic { color: #f5c84e; }
.moodm .mm-row.dr .ic { color: #b9aee0; }
.moodm .mm-bar { position: relative; flex: 1; height: 7px; border-radius: 4px; background: rgba(0,0,0,0.55); box-shadow: inset 0 0 0 1px rgba(255,235,200,0.18); overflow: hidden; }
.moodm .mm-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; }
.moodm .mo .mm-bar i { background: linear-gradient(90deg, #d8952e, #f7d36a); }
.moodm .dr .mm-bar i { background: linear-gradient(90deg, #6f6a86, #a99ad8); }
.moodm .mm-n { min-width: 21px; text-align: right; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; }
.moodm .mo.hi .mm-bar i { background: linear-gradient(90deg, #f0b040, #fff0a0); box-shadow: 0 0 6px #ffd870; }
.moodm .mo.hi .mm-n { color: #ffe08a; }
.moodm .mo.lo .mm-bar, .moodm .dr.hi .mm-bar { box-shadow: inset 0 0 0 1.5px var(--bad); }
.moodm .mo.lo .mm-bar i { background: var(--bad); }
.moodm .mo.lo .mm-n, .moodm .dr.crit .mm-n { color: var(--bad); }
.moodm .mo.lo .ic, .moodm .dr.hi .ic { animation: mmPulse 1.1s infinite; }
.moodm .dr.hi .mm-bar i { background: linear-gradient(90deg, #7a4ab8, #c08af0); }
.moodm .dr.hi .mm-n { color: #d6b8ff; }
.moodm .dr.crit .mm-bar i { background: linear-gradient(90deg, #8a2a9a, #e070ff); }
@keyframes mmPulse { 50% { opacity: 0.35; } }
.dcr { width: min(980px, 100%); padding-bottom: 0; }
.dcr .lead { margin-bottom: 8px; }
.dcr-now { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; margin: 0 0 12px; font-size: 15px; font-weight: 800; }
.dcr-now span { display: inline-flex; align-items: center; gap: 5px; }
.dcr-now .ic { width: 18px; height: 18px; }
.dcr-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; align-items: start; }
.dcr-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dcr-col > header { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 10px; background: rgba(0,0,0,0.3); border-left: 4px solid var(--bc); }
.dcr-col > header .ic { width: 22px; height: 22px; color: var(--bc); }
.dcr-col > header b { display: block; font-size: 16px; color: var(--parch); line-height: 1.15; }
.dcr-col > header small { display: block; font-size: 14px; color: var(--parch-dim); }
.dcr-card { position: relative; text-align: left; display: flex; flex-direction: column; gap: 4px; min-height: 44px; padding: 9px 10px 10px; border-radius: 12px; background: linear-gradient(#f3e5c4, #dcc69c); color: var(--ink); border: 2px solid #8a6528; box-shadow: 0 4px 0 #5a3e16; }
.dcr-card h4 { margin: 0; font-size: 17px; line-height: 1.15; }
.dcr-card p { margin: 0; font-size: 14px; font-weight: 700; color: #4a3420; line-height: 1.3; }
.dcr-card .dcr-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; font-size: 14px; font-weight: 800; }
.dcr-card .dcr-tier { padding: 1px 7px; border-radius: 8px; background: rgba(60,40,20,0.16); color: #5a3a18; }
.dcr-card .dcr-st { display: inline-flex; align-items: center; gap: 3px; color: #5a3a18; }
.dcr-card .dcr-st .ic { width: 16px; height: 16px; }
.dcr-card ul { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }
.dcr-card li { display: inline-flex; align-items: center; gap: 3px; font-size: 14px; font-weight: 800; padding: 1px 7px 1px 4px; border-radius: 8px; }
.dcr-card li .ic { width: 14px; height: 14px; }
.dcr-card li.good { background: rgba(70,120,40,0.18); color: #2f5a1a; }
.dcr-card li.bad { background: rgba(150,40,30,0.16); color: #7a2418; }
.cb .dcr-card li.good { background: rgba(40,90,170,0.16); color: #1e4a8a; }
.cb .dcr-card li.bad { background: rgba(190,100,20,0.18); color: #7a3e08; }
.dcr-card .dcr-note { font-size: 14px; color: #6a3a18; font-style: italic; }
.dcr-card.sel { border-color: #f6d488; box-shadow: 0 0 0 3px #f6d488, 0 4px 0 #5a3e16; background: linear-gradient(#fff3d6, #ead6a8); }
.dcr-card.signed { background: linear-gradient(#e6dcc0, #cbb88e); border-style: solid; border-color: #4f7a2e; }
.cb .dcr-card.signed { border-color: #2f62b0; }
.dcr-card.locked { background: linear-gradient(#a89a86, #8c806e); border-style: dashed; box-shadow: 0 3px 0 #3e2e16; }
.dcr-card.locked h4, .dcr-card.locked p { color: #2e241c; }
.dcr-card.locked .dcr-lock { font-size: 14px; font-weight: 800; color: #3a1c10; }
.dcr-foot { position: sticky; bottom: 0; margin: 12px -18px 0; padding: 10px 14px calc(12px + var(--sab)); display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; background: #2f241e; border-top: 1.5px solid rgba(201,151,62,0.6); }
.dcr-foot .big-btn { flex: 1 1 0; min-width: 0; max-width: 340px; min-height: 52px; font-size: 17px; padding: 10px 14px; line-height: 1.15; }
.dcr-foot .dcr-later { flex: 0 1 auto; }
.dcr-foot .big-btn:disabled { opacity: 1; filter: grayscale(0.85) brightness(0.75); }
@media (max-width: 700px) { .dcr-cols { grid-template-columns: 1fr; } .dcr { padding: 14px 12px 0; } .dcr-foot { margin: 12px -12px 0; } }
@media (max-height: 460px) { .dcr { padding-top: 10px; } .dcr h2 { font-size: 19px; } .dcr .lead { font-size: 14px; margin-bottom: 4px; } .dcr-now { margin-bottom: 6px; font-size: 14px; } .dcr-foot { margin-top: 8px; padding-top: 6px; padding-bottom: 6px; } .dcr-foot .big-btn { min-height: 46px; font-size: 16px; } }
`;
  document.head.appendChild(st);
}

const n0 = (v) => Math.round(v);

// ---- HUD meters ------------------------------------------------------------------------------
function meterWidget(hud, ctl) {
  injectCss();
  const box = el('button', 'moodm');
  box.setAttribute('aria-label', 'Morale and Dread');
  box.innerHTML = `<span class="mm-row mo">${icon('sun')}<span class="mm-bar"><i></i></span><span class="mm-n">0</span></span>`
    + `<span class="mm-row dr">${icon('eye')}<span class="mm-bar"><i></i></span><span class="mm-n">0</span></span>`;
  const mo = box.querySelector('.mo'), dr = box.querySelector('.dr');
  const moI = mo.querySelector('i'), drI = dr.querySelector('i');
  const moN = mo.querySelector('.mm-n'), drN = dr.querySelector('.mm-n');
  tapButton(box, () => ctl.s && explain(ctl, ctl.s), { longpress: () => ctl.s && showBook(ctl, ctl.s, null) });
  hud.slots.resbar.appendChild(box);
  let last = '', t = 1;
  return {
    update(s, dt) {
      t += dt;
      if (t < 0.25) return;
      t = 0;
      const m = s.ext && s.ext.mood;
      if (!m) return;
      const a = n0(m.morale), d = n0(m.dread);
      const key = a + '|' + d;
      if (key === last) return;
      last = key;
      moI.style.width = a + '%'; drI.style.width = d + '%';
      moN.textContent = a; drN.textContent = d;
      mo.classList.toggle('hi', a >= MOOD.high); mo.classList.toggle('lo', a <= MOOD.low);
      dr.classList.toggle('hi', d >= MOOD.panic); dr.classList.toggle('crit', d >= 90);
      box.title = `Morale ${a}, Dread ${d}`;
      box.setAttribute('aria-label', `Morale ${a} of 100, Dread ${d} of 100`);
    },
  };
}

/** Plain-language text of what Morale and Dread are doing now (tap on the meters). */
export function moodExplain(s) {
  const x = moodSummary(s);
  const a = n0(x.morale), d = n0(x.dread);
  const lines = [];
  let now = `Morale ${a}/100, settling toward ${n0(Math.max(0, Math.min(100, x.base)))} by 2 a minute.`;
  if (x.floor) now += ` Martial Law: never below ${x.floor}.`;
  lines.push(now);
  if (x.high) lines.push('High spirits (70+): work +15%; at dawn a festival may bring gold, and a volunteer may join if a House has room.');
  else if (x.riot) lines.push('Riots (15 or less): work -15%; at dawn villagers may desert and a mob wrecks a House.');
  else if (x.low) lines.push('Low spirits (30 or less): work -15%; at dawn villagers may desert.');
  else lines.push('Steady spirits. At 70+ work speeds up and festivals begin; at 30 or less work slows and villagers desert.');
  lines.push('Morale falls when people die (villager -4, soldier -1, hero -8), buildings are destroyed (-3; walls -1) or food runs out (-1 a minute). It rises after a night without losses (+2), a Blood Moon survived (+6) and festivals.');
  lines.push(`Dread ${d}/100, falling ${x.dreadPerDawn} each dawn. It rises with deaths (villager +3, soldier +1.5, hero +5), every night a Hollow Rift stands (+2), Wailers near your people and harsh decrees.`);
  if (x.panic) lines.push('Dread 70+: villagers panic at night (work -20%) and an Omen of Corruption adds Husks to every wave.');
  else lines.push('At 70 villagers panic at night and the Hollow grows; at 100 the realm is lost.');
  const names = x.decrees.map((id) => DECREES[id] ? DECREES[id].name : id);
  lines.push((names.length ? `Decrees: ${names.join(', ')}. ` : 'No decrees signed yet. ') + `The Book of Decrees opens at dawn ${x.nextBook}. Long-press to read it.`);
  return lines;
}

function explain(ctl, s) {
  const x = moodSummary(s);
  ctl.openText('Morale and Dread', `Morale ${n0(x.morale)} · Dread ${n0(x.dread)}`, moodExplain(s), 'sun');
}

// ---- The Book of Decrees ---------------------------------------------------------------------------
function chip(l) {
  const li = el('li', l.good ? 'good' : 'bad', `${icon(l.k === 'dread' ? 'eye' : 'sun')}<span></span>`);
  li.querySelector('span').textContent = l.text;
  li.setAttribute('aria-label', (l.good ? 'good: ' : 'bad: ') + l.text);
  return li;
}

function card(id, signed, onSel) {
  const d = DECREES[id];
  const st = decreeStatus(signed, id);
  const c = el('button', `dcr-card ${st.state}`);
  c.dataset.id = id;
  const stTxt = st.state === 'signed' ? `${icon('check')}Signed` : st.state === 'locked' ? `${icon('x')}Locked` : '';
  c.innerHTML = `<div class="dcr-top"><span class="dcr-tier">${TIER_LABEL[d.tier]}</span><span class="dcr-st">${stTxt}</span></div><h4></h4><p class="dcr-text"></p>`;
  c.querySelector('h4').textContent = d.name;
  c.querySelector('.dcr-text').textContent = d.text;
  const ml = moodLines(d);
  if (ml.length) { const ul = el('ul'); for (const l of ml) ul.appendChild(chip(l)); c.appendChild(ul); }
  if (d.tier === 3 && d.branch !== 'neutral' && st.state !== 'signed') {
    const other = BRANCHES[d.branch === 'flame' ? 'iron' : 'flame'].name;
    c.appendChild(el('p', 'dcr-note')).textContent = `Signing this closes the ${other}.`;
  }
  if (st.state === 'locked') c.appendChild(el('p', 'dcr-lock')).textContent = st.reason + '.';
  c.setAttribute('aria-label', `${d.name}, ${TIER_LABEL[d.tier]}, ${st.state}`);
  if (st.state === 'available' && onSel) tapButton(c, () => onSel(id, c), { sound: 'click' });
  else c.setAttribute('aria-disabled', 'true');
  return c;
}

/**
 * Show the Book. `pending` = s.pending of kind 'decree' (signing allowed) or null (read only).
 */
export function showBook(ctl, s, pending) {
  injectCss();
  const m = s.ext.mood || { decrees: [], morale: 60, dread: 10 };
  const signed = m.decrees || [];
  const d = el('div', 'dialog panel dcr');
  d.appendChild(el('h2', '', pending ? `Dawn ${pending.night || s.cycle.night}: Book of Decrees` : 'Book of Decrees'));
  d.appendChild(el('p', 'lead', pending
    ? 'Sign one law for the rest of the run. It can never be repealed.'
    : `Decrees can be signed at every 3rd dawn. Signed decrees last the whole run.`));
  const now = el('div', 'dcr-now', `<span class="mo">${icon('sun')}Morale <b></b></span><span class="dr">${icon('eye')}Dread <b></b></span><span>${icon('book')}Signed <b></b></span>`);
  const bs = now.querySelectorAll('b');
  bs[0].textContent = n0(m.morale); bs[1].textContent = n0(m.dread); bs[2].textContent = signed.length;
  now.querySelector('.mo .ic').style.color = '#f5c84e'; now.querySelector('.dr .ic').style.color = '#b9aee0';
  d.appendChild(now);

  let sel = null, selCard = null;
  const signBtn = el('button', 'big-btn dcr-sign', `${icon('book')}<span>Choose a decree</span>`);
  signBtn.disabled = true;
  const onSel = pending ? (id, c) => {
    if (selCard) selCard.classList.remove('sel');
    sel = id; selCard = c; c.classList.add('sel');
    signBtn.disabled = false;
    signBtn.querySelector('span').textContent = `Sign ${DECREES[id].name}`;
  } : null;

  const cols = el('div', 'dcr-cols');
  for (const bk of ['flame', 'iron', 'neutral']) {
    const B = BRANCHES[bk];
    const col = el('section', 'dcr-col');
    col.dataset.branch = bk;
    col.style.setProperty('--bc', B.color);
    col.appendChild(el('header', '', `${icon(B.icon)}<span><b></b><small></small></span>`));
    col.querySelector('b').textContent = B.name; col.querySelector('small').textContent = B.sub;
    const ids = DECREE_ORDER.filter((id) => DECREES[id].branch === bk).sort((a, b) => DECREES[a].tier - DECREES[b].tier);
    for (const id of ids) col.appendChild(card(id, signed, onSel));
    cols.appendChild(col);
  }
  d.appendChild(cols);

  const foot = el('div', 'dcr-foot');
  const modal = ctl.app.modal;
  if (pending) {
    const later = el('button', 'big-btn secondary dcr-later', `${icon('x')}<span>Not now</span>`);
    tapButton(signBtn, () => {
      if (!sel || !ctl.s.pending || ctl.s.pending.kind !== 'decree') return;
      const i = ctl.s.pending.options.indexOf(sel);
      if (i < 0) return;
      modal.close();
      ctl.cmd({ t: 'choose', i });
      ctl.autosave();
    }, { sound: 'ok' });
    tapButton(later, () => {
      if (!ctl.s.pending || ctl.s.pending.kind !== 'decree') return;
      modal.close();
      const i = ctl.s.pending.options.indexOf('skip');
      ctl.cmd({ t: 'choose', i: i >= 0 ? i : -1 });
      ctl.autosave();
    }, { sound: 'click' });
    foot.append(later, signBtn);
  } else {
    const close = el('button', 'big-btn secondary', `${icon('x')}<span>Close</span>`);
    tapButton(close, () => modal.close(), { sound: 'click' });
    foot.append(close);
  }
  d.appendChild(foot);
  modal.show(d, { dismissable: !pending });
  return d;
}

// ---- Wailer reach ----------------------------------------------------------------------------------
function drawWailerReach(g, s, view, time) {
  let any = false;
  for (const e of s.enemies) { if (e.alive && e.type === 'wailer') { any = true; break; } }
  if (!any) return;
  const r = MOOD.wailer.radius * T;
  g.save();
  g.lineWidth = 1.5;
  g.setLineDash([6, 6]);
  for (const e of s.enemies) {
    if (!e.alive || e.type !== 'wailer') continue;
    if (e.x < view.x0 - r || e.x > view.x1 + r || e.y < view.y0 - r || e.y > view.y1 + r) continue;
    // Like the renderer's own enemy pass: nothing is shown on land not yet explored.
    if (!s.fog[idx(Math.min(N - 1, Math.max(0, (e.x / T) | 0)), Math.min(N - 1, Math.max(0, (e.y / T) | 0)))]) continue;
    const a = 0.25 + 0.15 * Math.sin(time * 3 + e.id);
    g.strokeStyle = `rgba(190,170,240,${a})`;
    g.fillStyle = `rgba(150,130,210,${a * 0.18})`;
    g.beginPath(); g.arc(e.x, e.y - 6, r, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  g.restore();
}

// ---- Registration -----------------------------------------------------------------------------------
let done = false;
export function register() {
  if (done) return;
  done = true;
  registerMood();
  BUS.hud.push(meterWidget);
  BUS.pendingUI.decree = (ctl, s) => showBook(ctl, s, s.pending);
  BUS.draw.overlay.push(drawWailerReach);
}
