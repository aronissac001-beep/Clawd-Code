// Run-layer dialogs (events, merchant, shrine, Wheel of Fortune, drafts,
// Beacon bonuses, relics, run summary), all built on the shared Modal.
import { el, tapButton, fmt } from './dom.js';
import { icon } from './icons.js';
import { audio } from '../engine/audio.js';

const pct = (p) => `${Math.round(p * 100)}%`;
const reduce = () => document.body.classList.contains('reduce-motion');

function shell(cls, title, lead, ic) {
  const d = el('div', 'dialog panel rs-dialog ' + cls);
  if (ic) d.appendChild(el('div', 'rs-emblem', icon(ic)));
  const h = el('h2', ''); h.textContent = title || ''; d.appendChild(h);
  if (lead) { const p = el('p', 'lead rs-lead'); p.textContent = lead; d.appendChild(p); }
  return d;
}

function bigBtn(label, cls, ic, fn, sound = 'ok') {
  const b = el('button', 'big-btn ' + (cls || ''), (ic ? icon(ic) : '') + '<span></span>');
  b.querySelector('span').textContent = label;
  tapButton(b, fn, { sound });
  return b;
}

function actions(...btns) { const row = el('div', 'actions'); row.append(...btns); return row; }

/** A choice card: icon or thumbnail, title, body and optional extra node. */
function card({ ic, thumb, title, text, extra, cls = '' }, onPick) {
  const c = el('button', 'choice rs-choice ' + cls);
  if (thumb) { const img = el('img', 'rs-thumb'); img.src = thumb; img.alt = ''; c.appendChild(img); }
  else c.insertAdjacentHTML('beforeend', icon(ic || 'flame'));
  const body = el('div', 'rs-cbody');
  const h = el('h4'); h.textContent = title; body.appendChild(h);
  if (text) { const p = el('p'); p.textContent = text; body.appendChild(p); }
  if (extra) body.appendChild(extra);
  c.appendChild(body);
  tapButton(c, onPick, { sound: 'ok' });
  return c;
}

// ---- Events ---------------------------------------------------------------------------
/** ev = { title, text, icon, choices: [{ label, desc, chance? }] }; onChoose(index). */
export function showEventDialog(modal, ev, onChoose) {
  const d = shell('rs-event', ev.title, null, ev.icon || 'mystery');
  const t = el('p', 'rs-story'); t.textContent = ev.text || ''; d.appendChild(t);
  const row = el('div', 'choices rs-choices');
  ev.choices.forEach((c, i) => {
    let extra = null;
    if (c.chance != null) extra = el('span', 'rs-chance', `${icon('dice')}<span>${pct(c.chance)} chance</span>`);
    if (c.disabled) extra = el('span', 'rs-chance rs-poor', `${icon('gold')}<span>Not enough gold</span>`);
    const node = card({ ic: c.chance != null ? 'dice' : 'check', title: c.label, text: c.desc, extra, cls: 'rs-evc' + (c.disabled ? ' off' : '') }, () => {
      if (c.disabled) return; // iOS gets no events on disabled buttons, so refuse here instead
      modal.close(); onChoose && onChoose(i);
    });
    if (c.disabled) node.setAttribute('aria-disabled', 'true');
    row.appendChild(node);
  });
  d.appendChild(row);
  modal.show(d);
  return d;
}

/** Outcome of an event choice. */
export function showEventResult(modal, { title, lines = [], good = true }, onDone) {
  const d = shell('rs-result ' + (good ? 'good' : 'bad'), title || (good ? 'Fortune Smiles' : 'Ill Fortune'), null, good ? 'check' : 'skull');
  const ul = el('ul', 'rs-lines');
  for (const ln of lines) { const li = el('li'); li.textContent = ln; ul.appendChild(li); }
  d.appendChild(ul);
  d.appendChild(actions(bigBtn('Continue', '', 'play', () => { modal.close(); onDone && onDone(); })));
  modal.show(d);
  return d;
}

// ---- Merchant ---------------------------------------------------------------------------
/** shop.items = [{ kind, name, desc, icon, rarity?, price, sold }]; onBuy(i) -> { ok, msg }. */
export function showMerchant(modal, shop, run, onBuy, onLeave) {
  const d = shell('rs-shop', 'Merchant Caravan', 'Gold you carry between regions buys what the road cannot give.', 'merchant');
  const purse = el('div', 'rs-purse');
  const grid = el('div', 'rs-wares');
  const msg = el('p', 'rs-msg'); msg.setAttribute('aria-live', 'polite');
  // Purse, last message and Leave stay pinned at the bottom while the wares scroll.
  const foot = el('div', 'rs-foot');
  const leave = bigBtn('Leave', 'secondary', 'play', () => { modal.close(); onLeave && onLeave(); });
  const info = el('div', 'rs-finfo');
  info.append(purse, msg);
  foot.append(info, leave);
  d.append(grid, foot);

  function render() {
    purse.innerHTML = `<span style="color:var(--c-gold)">${icon('gold')}</span><b>${fmt(run.gold)}</b><span>gold</span>`;
    grid.innerHTML = '';
    shop.items.forEach((it, i) => {
      const cant = !it.sold && run.gold < it.price;
      const w = el('button', 'rs-ware' + (it.sold ? ' sold' : '') + (cant ? ' cant' : '') + (it.rarity ? ' r-' + it.rarity : ''));
      // Not `disabled`: iOS sends no pointer events to disabled buttons, and a tap on
      // a sold or unaffordable ware should still answer (error sound + message).
      const off = !!(it.sold || cant);
      if (off) w.setAttribute('aria-disabled', 'true');
      w.innerHTML = `<span class="rs-wic">${icon(it.icon || 'relic')}</span><span class="rs-wbody"><b class="rs-wname"></b><span class="rs-wtag"></span><span class="rs-wdesc"></span></span><span class="rs-price">${it.sold ? '<span>Sold</span>' : `${icon('gold')}<span>${it.price}</span>`}</span>`;
      w.querySelector('.rs-wname').textContent = it.name;
      w.querySelector('.rs-wtag').textContent = it.rarity ? cap(it.rarity) + ' relic' : KIND[it.kind] || '';
      w.querySelector('.rs-wdesc').textContent = it.desc || '';
      if (cant) w.setAttribute('aria-label', `${it.name}: costs ${it.price} gold, not enough gold`);
      tapButton(w, () => {
        const res = off ? { ok: false, msg: it.sold ? 'Already sold.' : `Not enough gold: ${it.name} costs ${it.price}.` }
          : onBuy ? onBuy(i) : { ok: false, msg: '' };
        audio.play(res && res.ok ? 'coin' : 'error');
        const top = d.scrollTop;
        render();
        d.scrollTop = top;
        msg.textContent = (res && res.msg) || '';
        msg.className = 'rs-msg ' + (res && res.ok ? 'ok' : 'no');
      }, { sound: null });
      grid.appendChild(w);
    });
  }
  render();
  modal.show(d);
  return { node: d, refresh: render };
}
const KIND = { blueprint: 'Blueprint', heal: 'Remedy', supplies: 'Supplies', uncurse: 'Ritual', relic: 'Relic' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- Shrine -----------------------------------------------------------------------------
/** options = [{ title, text, icon, odds?: [{ label, p }] }]; onPick(index). */
export function showShrine(modal, options, onPick, { title = 'Wayside Shrine', lead = 'The spring will grant one gift. Choose.' } = {}) {
  const d = shell('rs-shrine', title, lead, 'shrine');
  const row = el('div', 'choices rs-choices');
  options.forEach((o, i) => {
    let extra = null;
    if (o.odds && o.odds.length) {
      extra = el('table', 'rs-odds');
      for (const od of o.odds) {
        const tr = el('tr', '', '<td></td><td></td>');
        tr.children[0].textContent = od.label; tr.children[1].textContent = pct(od.p);
        extra.appendChild(tr);
      }
    }
    row.appendChild(card({ ic: o.icon, title: o.title, text: o.text, extra }, () => { modal.close(); onPick && onPick(i); }));
  });
  d.appendChild(row);
  modal.show(d);
  return d;
}

// ---- Wheel of Fortune ---------------------------------------------------------------------
/** segments = [{ label, p, color }]; spins and lands on resultIndex, then OK -> onDone(). */
export function showWheel(modal, segments, resultIndex, onDone, { title = 'Wheel of Fortune' } = {}) {
  const d = shell('rs-wheel', title, null, null);
  const wrap = el('div', 'rs-wwrap');
  const stage = el('div', 'rs-wstage');
  const cv = el('canvas', 'rs-wcv');
  const pointer = el('div', 'rs-wptr');
  stage.append(cv, pointer);
  const side = el('div', 'rs-wside');
  const legend = el('ul', 'rs-legend');
  const total = segments.reduce((a, s) => a + Math.max(0, s.p), 0) || 1;
  segments.forEach((s) => {
    const li = el('li', '', `<i style="background:${s.color}"></i><span></span><b>${pct(s.p / total)}</b>`);
    li.querySelector('span').textContent = s.label;
    legend.appendChild(li);
  });
  const res = el('p', 'rs-wres', 'The Wheel turns…');
  const ok = bigBtn('OK', '', 'check', () => { modal.close(); onDone && onDone(); });
  ok.disabled = true;
  side.append(legend, res, actions(ok));
  wrap.append(stage, side);
  d.appendChild(wrap);
  modal.show(d);

  // Size for the phone: portrait uses width, landscape uses height.
  const root = modal.root;
  const vw = root.clientWidth || window.innerWidth, vh = root.clientHeight || window.innerHeight;
  const land = vw > vh;
  const S = Math.round(Math.max(150, Math.min(300, land ? vh - 150 : Math.min(vw - 90, vh - 330))));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = S * dpr; cv.height = S * dpr;
  cv.style.width = S + 'px'; cv.style.height = S + 'px';
  stage.style.width = S + 'px'; stage.style.height = (S + 14) + 'px';
  const g = cv.getContext('2d');
  const TAU = Math.PI * 2;
  const starts = []; let acc = 0;
  for (const s of segments) { starts.push(acc / total); acc += Math.max(0, s.p); }
  const fracOf = (i) => Math.max(0, segments[i].p) / total;

  function segAtPointer(rot) {
    let a = ((-rot) % TAU + TAU) % TAU / TAU;
    for (let i = segments.length - 1; i >= 0; i--) if (a >= starts[i]) return i;
    return 0;
  }
  function draw(rot) {
    const r = S / 2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    g.save(); g.translate(r, r);
    segments.forEach((s, i) => {
      const a0 = rot + starts[i] * TAU - Math.PI / 2, a1 = a0 + fracOf(i) * TAU;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r - 4, a0, a1); g.closePath();
      g.fillStyle = s.color; g.fill();
      g.strokeStyle = 'rgba(30,20,10,0.75)'; g.lineWidth = 2; g.stroke();
      if (fracOf(i) < 0.07) return;
      const mid = (a0 + a1) / 2, flip = Math.cos(mid) < 0; // keep labels upright
      g.save(); g.rotate(flip ? mid + Math.PI : mid);
      g.fillStyle = '#1e140c'; g.textAlign = flip ? 'left' : 'right'; g.textBaseline = 'middle';
      const fs = Math.max(14, Math.round(S / 17));
      g.font = `800 ${fs}px -apple-system, system-ui, sans-serif`;
      const lines = wrapText(g, s.label, r * 0.62);
      lines.forEach((ln, k) => g.fillText(ln, flip ? -(r - 14) : r - 14, (k - (lines.length - 1) / 2) * (fs + 1)));
      g.restore();
    });
    g.beginPath(); g.arc(0, 0, r - 3, 0, TAU); g.strokeStyle = '#c9973e'; g.lineWidth = 5; g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.12, 0, TAU); g.fillStyle = '#f0c86a'; g.fill(); g.strokeStyle = '#6d4a16'; g.lineWidth = 2; g.stroke();
    g.restore();
  }

  // Land on the chosen segment, a little off its centre so it feels natural.
  const ri = Math.max(0, Math.min(segments.length - 1, resultIndex | 0));
  const c = (starts[ri] + fracOf(ri) * (0.25 + Math.random() * 0.5)) * TAU;
  const end = -c + TAU * 5;
  const finish = () => {
    draw(end);
    const lab = el('span', 'rs-wlab'); lab.textContent = segments[ri].label;
    res.innerHTML = 'The Wheel lands on: '; res.appendChild(lab);
    res.style.setProperty('--sc', segments[ri].color);
    ok.disabled = false;
    audio.play('ok');
  };
  if (reduce()) { finish(); return d; }
  draw(0);
  const dur = 2500;
  let t0 = 0, lastSeg = segAtPointer(0);
  const tick = (now) => {
    if (!d.isConnected) return;
    if (!t0) t0 = now;
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const rot = end * e;
    draw(rot);
    const sg = segAtPointer(rot);
    if (sg !== lastSeg) { lastSeg = sg; audio.play('click'); }
    if (k < 1) requestAnimationFrame(tick); else finish();
  };
  setTimeout(() => requestAnimationFrame(tick), 250);
  return d;
}

function wrapText(g, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

// ---- Blueprint draft ---------------------------------------------------------------------
/** options = [{ type, name, desc, thumb, cost (html) }]; onPick(index). */
export function showBlueprintDraft(modal, options, onPick, { title = 'Choose a Blueprint', lead = 'Learn one new building for the rest of the run.' } = {}) {
  const d = shell('rs-draft', title, lead, 'book');
  const row = el('div', 'choices rs-choices n' + options.length);
  options.forEach((o, i) => {
    const extra = el('div', 'rs-cost');
    extra.innerHTML = o.cost || '';
    row.appendChild(card({ ic: 'hammer', thumb: o.thumb || null, title: o.name, text: o.desc, extra, cls: 'rs-bp' }, () => { modal.close(); onPick && onPick(i); }));
  });
  d.appendChild(row);
  modal.show(d);
  return d;
}

// ---- Beacon bonus ------------------------------------------------------------------------
/** options = [{ name, text, icon }]; onPick(index). */
export function showBeaconChoice(modal, options, onPick, { title = 'The Beacon Blazes', lead = 'Its light reaches every realm ahead. Choose a lasting blessing.' } = {}) {
  const d = shell('rs-beacon', title, lead, 'beacon');
  const row = el('div', 'choices rs-choices');
  options.forEach((o, i) => row.appendChild(card({ ic: o.icon, title: o.name, text: o.text }, () => { modal.close(); onPick && onPick(i); })));
  d.appendChild(row);
  modal.show(d);
  return d;
}

// ---- Relics ------------------------------------------------------------------------------
/** relics = [{ id, name, rarity, rarityLabel, color, text, icon, used }], sets = [{ name, text, active, have?, count? }]. */
export function showRelicList(modal, relics, sets, onClose, { focus = null } = {}) {
  const d = shell('rs-relicdlg', 'Relics', null, 'relic');
  const list = el('div', 'rs-relics');
  if (!relics.length) list.appendChild(el('p', 'rs-empty', 'No relics yet. Find them in Ruins, Cursed Regions and Mysteries, or buy them from the Merchant.'));
  let focusNode = null;
  for (const r of relics) {
    const row = el('div', 'rs-relic' + (r.used ? ' used' : '') + ' r-' + r.rarity, `<span class="rs-ric">${icon(r.icon || 'relic')}</span><div class="rs-rbody"><div class="rs-rtop"><b></b><span class="rs-rar"></span></div><p></p></div>`);
    row.style.setProperty('--rc', r.color || '#c9c2b4');
    row.querySelector('b').textContent = r.name;
    row.querySelector('.rs-rar').textContent = r.rarityLabel || r.rarity;
    row.querySelector('p').textContent = r.text || '';
    if (r.used) row.querySelector('.rs-rtop').appendChild(el('span', 'rs-spent', 'Spent'));
    if (focus && r.id === focus) { row.classList.add('focus'); focusNode = row; }
    list.appendChild(row);
  }
  d.appendChild(list);
  if (sets && sets.length) {
    d.appendChild(el('h3', 'rs-sub', 'Relic Sets'));
    const sl = el('div', 'rs-sets');
    for (const s of sets) {
      const row = el('div', 'rs-set' + (s.active ? ' on' : ''), `<span class="rs-sic">${icon(s.active ? 'check' : 'relic')}</span><div><div class="rs-rtop"><b></b><span class="rs-sst"></span></div><p></p></div>`);
      row.querySelector('b').textContent = s.name;
      row.querySelector('.rs-sst').textContent = s.active ? 'Active' : (s.count ? `${s.have || 0}/${s.count}` : 'Inactive');
      row.querySelector('p').textContent = s.text || '';
      sl.appendChild(row);
    }
    d.appendChild(sl);
  }
  const foot = el('div', 'rs-foot center');
  foot.appendChild(bigBtn('Close', 'secondary', 'x', () => modal.close()));
  d.appendChild(foot);
  modal.show(d, { dismissable: true, onClose });
  if (focusNode) focusNode.scrollIntoView({ block: 'center' });
  return d;
}

// ---- Run summary --------------------------------------------------------------------------
/** { title, reason, stats: [[label, value]], seed }, actions = [{ label, cls, icon, onTap }]. */
export function showRunSummary(modal, { title, reason, stats = [], seed, victory = false }, acts = []) {
  const d = shell('rs-summary' + (victory ? ' win' : ''), title, reason, victory ? 'crown' : 'skull');
  const grid = el('div', 'statgrid');
  const n = stats.length;
  grid.style.setProperty('--cols', String(n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : 4));
  for (const [label, value] of stats) {
    const c = el('div', '', '<b></b><span></span>');
    c.querySelector('b').textContent = String(value);
    c.querySelector('span').textContent = label;
    grid.appendChild(c);
  }
  d.appendChild(grid);
  if (seed) { const s = el('p', 'rs-seed', 'Seed: <b></b>'); s.querySelector('b').textContent = seed; d.appendChild(s); }
  d.appendChild(actions(...acts.map((a) => bigBtn(a.label, a.cls, a.icon, () => { if (!a.keep) modal.close(); a.onTap && a.onTap(); }))));
  modal.show(d);
  return d;
}
