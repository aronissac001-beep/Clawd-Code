// ===== hud.js : resource bar, clock, hazards, toasts, bottom sheet, placement bar, modal =====
const HUD = {
  build() {
    const bar = $('#resBar'); bar.innerHTML = '';
    this.chips = {};
    for (const k of ['funds', 'pop', 'power', 'water', 'oxygen', 'food', 'metals', 'sinter', 'parts', 'polymers', 'electronics', 'fuel', 'rare', 'crystals', 'rp']) {
      const icon = k === 'pop' ? '☺' : RES[k].icon;
      const el = h('button', { class: 'rc', 'data-res': k, 'aria-label': k === 'pop' ? 'Colonists' : RES[k].name, onclick: () => Panels.resource(k) }, h('span', { class: 'v' }, icon + ' 0'), h('span', { class: 'd' }, ''));
      bar.appendChild(el); this.chips[k] = el;
    }
  },
  totals() {
    const G = UI.G, o = { power: { prod: 0, dem: 0, sto: 0, cap: 0 }, water: { sto: 0, cap: 0 }, oxygen: { sto: 0, cap: 0 } };
    if (G._pnets) for (const n of G._pnets.values()) { o.power.prod += n.prod; o.power.dem += n.demand; o.power.sto += n.stored; o.power.cap += n.cap; }
    for (const b of G.buildings) { const d = BUILDINGS[b.t]; if (!b.built || b.mod || !d.tank) continue; if (d.tank.water) { o.water.sto += b.water; o.water.cap += d.tank.water; } if (d.tank.oxygen) { o.oxygen.sto += b.oxygen; o.oxygen.cap += d.tank.oxygen; } }
    return o;
  },
  update() {
    const G = UI.G; if (!G) return;
    $('#clockSol').textContent = 'Sol ' + KC.solOf(G.tick) + (G.over ? (G.over.win ? ' · Independent' : ' · Recalled') : '');
    const hr = KC.hourOf(G.tick), env = G._env || KC.envNow(G);
    $('#clockHour').textContent = String(hr).padStart(2, '0') + ':00 ' + (env.sun > 0.05 ? '☀' : '☾') + ' shift ' + 'ABC'[env.shift];
    const rate = k => (G.rate[k] || []).reduce((a, b) => a + b, 0);
    const T = this.totals(), cap = KC.storageCap(G);
    const set = (k, val, d, cls) => { const el = this.chips[k]; if (!el) return; el.children[0].textContent = (k === 'pop' ? '☺' : RES[k].icon) + ' ' + val; const de = el.children[1]; de.textContent = d; de.className = 'd' + (d.startsWith('+') ? ' pos' : d.startsWith('-') ? ' neg' : ''); el.className = 'rc' + (cls ? ' ' + cls : ''); };
    set('funds', fmt(G.funds), '');
    const homes = [...(G._domes || new Map()).values()].reduce((s, I) => s + I.cap, 0);
    set('pop', G.colonists.length, homes ? 'homes ' + homes : '');
    set('power', T.power.cap ? Math.round(100 * T.power.sto / T.power.cap) + '%' : fmt(T.power.prod), fmtSigned(T.power.prod - T.power.dem) + '/h', T.power.dem > T.power.prod + T.power.sto + 0.1 ? 'crit' : T.power.cap && T.power.sto < T.power.cap * 0.15 && T.power.dem > T.power.prod ? 'warn' : '');
    for (const k of ['water', 'oxygen']) { const r = rate(k); set(k, fmt(T[k].sto), fmtSigned(r) + '/sol', (G.sol.short[k] || 0) > 0 && T[k].sto < 1 ? 'crit' : r < 0 && T[k].sto < 20 ? 'warn' : ''); }
    for (const k of ['food', 'metals', 'sinter', 'parts', 'polymers', 'electronics', 'fuel', 'rare', 'crystals']) {
      const r = rate(k), v = G.res[k];
      const crit = k === 'food' ? G.colonists.length && v < 1 : false;
      set(k, fmt(v), fmtSigned(r) + '/sol', crit ? 'crit' : (r < 0 && v < -r * 2 && G.colonists.length) || (v >= cap - 0.5 && k !== 'food') ? 'warn' : '');
    }
    set('rp', fmt(G._rp || 0) + '/h', G.research.cur ? Math.round(100 * (G.research.prog[G.research.cur] || 0) / KC.techCost(G, G.research.cur)) + '%' : 'idle', G.research.cur ? '' : 'warn');
    // hazards
    const hz = $('#hzBar'), items = [];
    for (const a of G.hz.active) items.push(h('span', { class: 'hz active' }, KC.HAZARDS[a.kind].icon + ' ' + KC.HAZARDS[a.kind].name + (a.kind === 'dust' || a.kind === 'cold' ? ' · ' + Math.max(0, a.end - G.tick) + 'h' : '')));
    for (const u of G.hz.upcoming) items.push(h('span', { class: 'hz' }, KC.HAZARDS[u.kind].icon + ' ' + KC.HAZARDS[u.kind].name + ' in ' + Math.max(0, u.at - G.tick) + 'h'));
    const key = items.map(e => e.textContent).join('|');
    if (key !== this.hzKey) { this.hzKey = key; hz.innerHTML = ''; items.forEach(e => hz.appendChild(e)); hz.hidden = !items.length; }
    // pips
    $('[data-tab=research] .pip').hidden = !!G.research.cur || !Object.keys(KC.TECHS).some(id => KC.techAvailable(G, id));
    const unread = G.log.slice(UI.logSeen).some(l => l.k === 'bad' || l.k === 'warn');
    $('[data-tab=log] .pip').hidden = !unread;
    $('#toasts').style.top = (($('#top').getBoundingClientRect().bottom | 0) + 6) + 'px';
  },
  toast(msg, kind, entry) {
    const box = $('#toasts');
    while (box.children.length >= 2) box.firstChild.remove();
    const el = h('div', { class: 'toast ' + (kind || ''), onclick: () => { if (entry && entry.x !== undefined) R.centerOn(entry.x + 0.5, entry.y + 0.5); el.remove(); } }, msg);
    box.appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 6500 : 4500);
  },
};
// bottom sheet: one panel at a time
const Sheet = {
  cur: null, busy: false,
  show(opt) {
    const el = $('#sheet');
    this.cur = opt; el.hidden = false; el.className = opt.tall ? 'tall' : '';
    this.render(true);
    if (!this._wired) { this._wired = true; el.addEventListener('pointerdown', () => { this.busy = true; }); window.addEventListener('pointerup', () => setTimeout(() => { this.busy = false; }, 120)); }
    $$('#bottom .tb').forEach(b => b.classList.toggle('on', b.dataset.tab === opt.tab));
  },
  render(first) {
    const opt = this.cur, el = $('#sheet'); if (!opt) return;
    const oldBody = $('.sh-body', el), scroll = oldBody ? oldBody.scrollTop : 0;
    el.innerHTML = '';
    const head = h('div', { class: 'sh-head' }, h('h3', null, typeof opt.title === 'function' ? opt.title() : opt.title), ...(opt.head ? opt.head() : []), h('button', { class: 'icon', 'aria-label': 'Close', onclick: () => { Sound.play('tap'); this.close(); } }, '✕'));
    el.appendChild(head);
    if (opt.tabs) {
      const tabs = h('div', { class: 'tabs' });
      for (const [k, label] of opt.tabs) tabs.appendChild(h('button', { class: opt.tabK === k ? 'on' : '', onclick: () => { opt.tabK = k; Sound.play('tap'); this.render(true); } }, label));
      el.appendChild(tabs);
    }
    const body = h('div', { class: 'sh-body' });
    try { const content = opt.body(opt.tabK); if (Array.isArray(content)) content.forEach(c => c && body.appendChild(c)); else if (content) body.appendChild(content); }
    catch (e) { body.appendChild(h('p', { class: 'bad' }, 'Error: ' + e.message)); console.error(e); }
    el.appendChild(body);
    if (!first) body.scrollTop = scroll;
  },
  refresh() { if (this.cur && this.cur.live && !this.busy && !$('#sheet').hidden) { const now = performance.now(); if (now - (this._last || 0) > 900) { this._last = now; this.render(false); } } },
  close() { $('#sheet').hidden = true; this.cur = null; $$('#bottom .tb').forEach(b => b.classList.remove('on')); if (R.sel && !UI.mode) R.sel = null; },
};
const Place = {
  render() {
    const m = UI.mode, el = $('#placeBar'), G = UI.G; if (!m) return this.hide();
    el.hidden = false; el.innerHTML = '';
    if (m.k === 'build') {
      const d = BUILDINGS[m.type], g = R.ghost, cost = KC.costOf(G, m.type), pre = G.prefabs[m.type] > 0;
      el.appendChild(h('div', { class: 't' }, d.name + (pre ? ' (prefab ×' + G.prefabs[m.type] + ')' : '')));
      el.appendChild(h('div', { class: 's' + (g && !g.ok ? ' bad' : '') }, g && !g.ok ? g.why : pre ? 'Free: uses a prefab. Tap the map to move, then Place.' : 'Cost ' + costText(cost) + (KC.canAfford(G, cost) ? '' : ' (drones wait for materials)') + '. Tap the map to move.'));
      if (g && g.ok) {
        const hints = [];
        if (!dronesInRange(G, g.x + d.size / 2, g.y + d.size / 2) && !d.hub) hints.push('No drones in range: build a Drone Hub nearby or park the Crawler here.');
        if (!touchesGrid(G, g.x, g.y, d.size) && !['depot', 'mast'].includes(m.type)) hints.push('Not touching the grid: link it with Power Cable / Life Pipe.');
        if (hints.length) el.appendChild(h('div', { class: 's warnc' }, hints.join(' ')));
      }
      el.appendChild(h('div', { class: 'row' }, h('button', { onclick: () => { UI.cancelMode(); Sound.play('tap'); } }, 'Done'), h('button', { class: 'pri', disabled: !(g && g.ok), onclick: () => UI.confirmPlace() }, 'Place here')));
    } else if (m.k === 'line') {
      const g = R.ghost, d = BUILDINGS[m.type];
      el.appendChild(h('div', { class: 't' }, d.name));
      el.appendChild(h('div', { class: 's' + (g && g.ok === false ? ' bad' : '') }, !m.start ? 'Tap the tile where the line starts.' : !m.end ? 'Now tap where it ends (it bends once).' : g.ok ? g.n + ' new tiles, ' + costText(g.cost) + '.' : g.why));
      el.appendChild(h('div', { class: 'row' }, h('button', { onclick: () => { UI.cancelMode(); Sound.play('tap'); } }, 'Done'), h('button', { class: 'pri', disabled: !(m.end && g.ok), onclick: () => UI.confirmPlace() }, 'Build line')));
    } else if (m.k === 'move') {
      const v = G.vehicles.find(x => x.id === m.vid);
      el.appendChild(h('div', { class: 't' }, 'Move ' + VEHICLES[v.t].name));
      el.appendChild(h('div', { class: 's' }, m.to ? 'Destination ' + m.to.join(', ') + '. Confirm to drive there.' : 'Tap a destination on the map.'));
      el.appendChild(h('div', { class: 'row' }, h('button', { onclick: () => { UI.cancelMode(); R.sel = null; } }, 'Cancel'), h('button', { class: 'pri', disabled: !m.to, onclick: () => UI.confirmPlace() }, 'Drive')));
    }
  },
  hide() { $('#placeBar').hidden = true; },
};
const Modal = {
  open: false,
  show(title, body, buttons) {
    const root = $('#modal'); root.innerHTML = ''; this.open = true;
    const box = h('div', { class: 'mbox', role: 'dialog' }, h('h3', null, title));
    if (typeof body === 'string') box.appendChild(h('p', null, body)); else if (Array.isArray(body)) body.forEach(b => b && box.appendChild(b)); else if (body) box.appendChild(body);
    const row = h('div', { class: 'row' });
    for (const [label, fn, cls] of buttons || [['OK']]) row.appendChild(h('button', { class: cls || '', onclick: () => { Sound.play('tap'); this.close(); if (fn) fn(); } }, label));
    box.appendChild(row);
    root.appendChild(h('div', { class: 'mback' }, box));
  },
  close() { $('#modal').innerHTML = ''; this.open = false; },
  confirm(title, text, ok, okLabel) { this.show(title, text, [['Cancel'], [okLabel || 'OK', ok, 'pri']]); },
};
function touchesGrid(G, x, y, s) {
  for (let i = -1; i <= s; i++) for (const [xx, yy] of [[x + i, y - 1], [x + i, y + s], [x - 1, y + i], [x + s, y + i]]) {
    if (xx < 0 || yy < 0 || xx >= MAP_N || yy >= MAP_N) continue;
    const k = yy * MAP_N + xx; if (G._occ[k] || G.cable[k] || G.pipe[k]) return true;
  }
  return false;
}
function costText(cost) { const parts = []; for (const k in cost) parts.push(RES[k].icon + ' ' + fmt(cost[k])); return parts.join('  ') || 'free'; }
function costEl(G, cost) {
  const el = h('div', { class: 'cost' });
  for (const k in cost) el.appendChild(h('span', { class: G.res[k] + 1e-9 >= cost[k] ? '' : 'no' }, RES[k].icon + ' ' + fmt(cost[k])));
  if (!Object.keys(cost).length) el.appendChild(h('span', null, 'free'));
  return el;
}
