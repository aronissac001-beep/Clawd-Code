// ============================================================================
// ZONEFALL — homestead panels: every powered item (status, watts in / out,
// network totals, its own controls and its cable sockets), planters, the
// cooking pot, and the wiring bar shown while you hold the wire tool.
// Panels open through the main UI (G.ui.openSheet / G.ui.openInventory), so
// they look and close like every other window.
// ============================================================================
import { G } from './state.js';
import { ITEMS, DEPLOY } from './data.js';
import { POWER, CROPS, STAGES, stageOf, COOK, POT, FARM, WIRE_RANGE, TURRET_BOOST, SEED_IDS } from './data_homestead.js';
import { Power, holdingWire, isNight } from './power.js';
import { Farming } from './farming.js';
import { Cooking, COOK_BY } from './cooking.js';
import { Build } from './build.js';
import { Sfx } from './audio.js';
import { el } from './util.js';

const nm = id => ITEMS[id] ? ITEMS[id].name : id;
const ic = id => { const A = typeof window !== 'undefined' ? window.ART : null; return A && A.iconURL ? A.iconURL(id) : ''; };
const dn = d => (DEPLOY[d.type] && DEPLOY[d.type].name) || d.type;
const SOURCE = { gen: 1, solar: 1, wind: 1 };
function btn(label, cls, fn) { const b = el('button', cls || '', label); b.onclick = e => { e.stopPropagation(); fn(); }; return b; }
function meter(label, val, unit, k, cls = '') {
  const m = el('div', 'pw-m ' + cls); m.innerHTML = '<small>' + label + '</small><b>' + val + '</b><span>' + unit + '</span>' + (k !== undefined ? '<u><i style="width:' + Math.round(Math.max(0, Math.min(1, k)) * 100) + '%"></i></u>' : '');
  return m;
}
/** move up to all of `id` from your pockets into a deployable's inventory */
function addFrom(d, id) { const p = G.player, n = Math.min(p.inv.count(id), d.inv.room(id)); if (n <= 0) return false; p.inv.take(id, n); d.inv.add(id, n); Sfx.pickup(); return true; }

export const HomeUI = {
  // ---------------------------------------------------------------- powered items
  openPower(d) {
    const U = G.ui; if (!U) return;
    if (d.inv) U.openInventory({ inv: d.inv, title: dn(d), noDeposit: true, extra: right => this.powerBody(right, d) });
    else U.openSheet(dn(d), body => this.powerBody(body, d), { cls: 'pw-sheet' });
    U.sheetRefresh = () => { if (!d.dead) U.rebuild(); else U.closeSheet(); };
  },
  /** status line: [text, good | bad | idle | warn] */
  statusOf(d) {
    const S = POWER[d.type], st = d.state;
    switch (S.kind) {
      case 'gen': return !st.on ? ['Switched off', 'idle'] : st.run ? ['Running · ' + (st.pout || 0) + ' of ' + S.max + ' W in use', 'good'] : ['Out of fuel: add Low Grade Fuel', 'bad'];
      case 'solar': return (st.av || 0) > 0 ? ['Making ' + st.av + ' W', 'good'] : [Build.isInside(d.x, d.z, d.y) ? 'Under a roof: no sun' : isNight() ? 'Night: no sun' : 'Too dark to make power', 'idle'];
      case 'wind': return (st.av || 0) > 0 ? ['Making ' + st.av + ' W · ' + Math.round(d.y || 0) + ' m up', 'good'] : ['No wind in here', 'idle'];
      case 'battery': return (st.flow || 0) > 0 ? ['Charging +' + st.flow + ' W', 'good'] : (st.pout || 0) > 0 ? ['Powering ' + st.pout + ' W from its charge', 'warn'] : (st.ch || 0) <= 0.5 ? ['Empty', 'bad'] : ['Holding its charge', 'idle'];
      case 'switch': return !st.pw ? ['No power coming in', 'bad'] : st.on ? ['ON · passing ' + (st.pout || 0) + ' W', 'good'] : ['OFF', 'idle'];
      case 'timer': return !st.pw ? ['No power coming in', 'bad'] : Power.timerOn(d) ? ['Passing power (' + (st.mode === 'day' ? 'by day' : 'at night') + ')', 'good'] : ['Waiting for ' + (st.mode === 'day' ? 'day' : 'night'), 'warn'];
      case 'sensor': return !st.pw ? ['No power coming in', 'bad'] : st.act ? ['Someone is close: passing power', 'good'] : ['Watching…', 'warn'];
      case 'split': return (st.pin || 0) > 0 ? ['Splitting ' + st.pin + ' W', 'good'] : ['No power coming in', 'bad'];
      case 'light': return st.legacy ? ['Old floodlight with its own battery: always on', 'good'] : st.pw ? ['On', 'good'] : ['No power: needs ' + S.use + ' W', 'bad'];
      case 'turret': return st.pw ? ['Powered: ' + Math.round((TURRET_BOOST.range - 1) * 100) + '% more range, steadier aim', 'good'] : ['Unpowered: works as usual (wire ' + S.use + ' W for the bonus)', 'idle'];
      case 'furnace': return !st.on ? ['Switched off', 'idle'] : !st.pw ? ['No power: needs ' + S.use + ' W', 'bad'] : st.lit ? ['Smelting', 'good'] : ['Powered: add ore', 'warn'];
      case 'door': return !st.pw ? ['No power: the door stays shut', 'bad'] : !st.door ? ['No door of yours within ' + S.reach + ' m', 'warn'] : ['Holding the door open', 'good'];
    }
    return ['', 'idle'];
  },
  powerBody(box, d) {
    const S = POWER[d.type], st = d.state, w = el('div', 'pw'), U = G.ui;
    const [txt, cls] = this.statusOf(d);
    w.appendChild(el('div', 'pw-st ' + cls, txt));
    const row = el('div', 'pw-row');
    if (SOURCE[S.kind]) row.appendChild(meter('MAKES', st.av || 0, 'of ' + S.max + ' W', (st.av || 0) / S.max));
    if (S.ins) row.appendChild(meter('IN', st.pin || 0, 'W'));
    if (S.outs) row.appendChild(meter('OUT', st.pout || 0, 'W'));
    if (S.use) row.appendChild(meter('NEEDS', S.use, 'W'));
    if (S.kind === 'battery') { const k = (st.ch || 0) / S.cap, load = st.pout || 0; row.appendChild(meter('CHARGE', Math.round(k * 100) + '%', load > 0 ? '~' + Math.max(1, Math.round((st.ch || 0) / load)) + ' min left' : Math.round(st.ch || 0) + ' / ' + S.cap + ' Wm', k, k < 0.2 ? 'low' : '')); }
    if (S.kind === 'gen') row.appendChild(meter('FUEL', d.inv ? d.inv.count(S.fuel) : 0, 'left'));
    w.appendChild(row);
    // controls
    const acts = el('div', 'acts pw-acts'); const re = () => { Sfx.click(); U.rebuild(); };
    if (S.kind === 'gen') { acts.appendChild(btn(st.on ? 'Switch off' : 'Switch on', st.on ? 'danger' : 'primary', () => { st.on = st.on ? 0 : 1; re(); })); if (G.player.inv.count(S.fuel)) acts.appendChild(btn('+ ' + nm(S.fuel), 'mini', () => { addFrom(d, S.fuel); re(); })); }
    if (S.kind === 'switch') acts.appendChild(btn(st.on ? 'Turn OFF' : 'Turn ON', st.on ? 'danger' : 'primary', () => { st.on = st.on ? 0 : 1; Sfx.lever(); U.rebuild(); }));
    if (S.kind === 'timer') for (const [m, l] of [['night', 'At night'], ['day', 'By day']]) acts.appendChild(btn(l, st.mode === m || (!st.mode && m === 'night') ? 'on primary' : '', () => { st.mode = m; re(); }));
    if (S.kind === 'sensor') for (const [m, l] of [['all', 'Anyone'], ['others', 'Strangers only']]) acts.appendChild(btn(l, (st.who || 'all') === m ? 'on primary' : '', () => { st.who = m; re(); }));
    if (S.kind === 'furnace') { acts.appendChild(btn(st.on ? 'Switch off' : 'Switch on', st.on ? 'danger' : 'primary', () => { st.on = st.on ? 0 : 1; re(); })); for (const id of ['metal_ore', 'sulfur_ore', 'hqm_ore']) if (G.player.inv.count(id)) acts.appendChild(btn('+ ' + nm(id), 'mini', () => { addFrom(d, id); re(); })); }
    if (acts.children.length) w.appendChild(acts);
    // the network this item is part of
    const N = Power.netStats(d);
    if (N.n > 1 || SOURCE[S.kind]) w.appendChild(el('div', 'pw-net', '<b>Network</b> ' + N.n + ' item' + (N.n > 1 ? 's' : '') + ' · making <b>' + N.make + ' W</b>' + (N.can > N.make ? ' (could make ' + N.can + ')' : '') + ' · using <b>' + N.use + ' W</b>' + (N.cap ? ' · batteries ' + Math.round(N.ch / N.cap * 100) + '%' + (N.flow ? (N.flow > 0 ? ' +' : ' ') + N.flow + ' W' : '') : '')));
    w.appendChild(this.portsBox(d));
    w.appendChild(el('p', 'dim small', DEPLOY[d.type].desc || ''));
    box.appendChild(w);
  },
  /** the item's sockets: what is plugged in where, unplug buttons */
  portsBox(d) {
    const S = POWER[d.type], box = el('div', 'pw-ports'), U = G.ui; Power.graph();
    const kids = Power.children(d), wire = holdingWire(G.player);
    if (S.ins) {
      const f = Power.feeder(d), r = el('div', 'pw-port in');
      r.innerHTML = '<i></i><span>Input ← ' + (f ? dn(f.d) : '<em>nothing</em>') + '</span>';
      if (f) r.appendChild(btn('Unplug', 'mini', () => { Power.unplugIn(d); Sfx.click(); U.rebuild(); }));
      else if (wire && Power.pending && Power.pending.eid !== d.state.eid) r.appendChild(btn('Plug in here', 'mini primary', () => { const res = Power.wireTap(d); if (res.msg) U.toast(res.msg, res.good ? 'good' : res.bad ? 'bad' : ''); U.rebuild(); }));
      box.appendChild(r);
    }
    for (let o = 0; o < S.outs; o++) {
      const c = kids.find(k => k.o === o), r = el('div', 'pw-port out');
      r.innerHTML = '<i></i><span>' + (S.outs > 1 ? 'Output ' + (o + 1) : 'Output') + ' → ' + (c ? dn(c.t) : '<em>free</em>') + '</span>';
      if (c) r.appendChild(btn('Unplug', 'mini', () => { Power.unplugOut(d, o); Sfx.click(); U.rebuild(); }));
      else if (wire) r.appendChild(btn('Run a cable', 'mini primary', () => { Power.cancelWire(); Power.pending = { eid: d.state.eid, o }; U.closeSheet(); U.toast('Cable from ' + dn(d) + ' — now tap the item to power', ''); }));
      box.appendChild(r);
    }
    if (!S.ins && !S.outs) box.appendChild(el('div', 'dim small', 'No sockets.'));
    if (!wire) box.appendChild(el('div', 'dim small', 'Hold a Wire Tool and tap items to connect cables (up to ' + WIRE_RANGE + ' m).'));
    return box;
  },
  // ---------------------------------------------------------------- planters
  openPlanter(d) {
    const U = G.ui; if (!U) return;
    U.openSheet(dn(d), body => this.planterBody(body, d), { cls: 'pl-sheet' });
    U.sheetRefresh = () => { if (!d.dead) U.rebuild(); else U.closeSheet(); };
  },
  planterBody(body, d) {
    const p = G.player, U = G.ui, pl = Farming.plots(d), st = d.state || {};
    const wat = st.wat || 0, lk = st.lk ?? 0, ls = st.ls || 'dark';
    const top = el('div', 'pw-row');
    top.appendChild(meter('WATER', Math.round(wat) + '%', wat <= 0 ? 'dry!' : wat < 25 ? 'low' : 'ok', wat / 100, wat < 25 ? 'low' : 'water'));
    top.appendChild(meter('LIGHT', Math.round(lk * 100) + '%', ls === 'sun' ? 'sunlight' : ls === 'lamp' ? 'grow light' : 'dark', lk, lk <= 0 ? 'low' : 'sun'));
    body.appendChild(top);
    const grid = el('div', 'plots');
    pl.forEach(q => {
      const c = el('div', 'plot' + (q ? '' : ' empty'));
      if (!q || !CROPS[q[0]]) c.innerHTML = '<b>Empty plot</b><small>Plant a seed</small>';
      else { const C = CROPS[q[0]], s = stageOf(q[1]); c.innerHTML = '<img src="' + ic(C.yield[0]) + '"><b>' + C.name + '</b><small>' + STAGES[s] + (s < 4 ? ' · ' + Math.floor(q[1]) + '%' : ' · harvest!') + '</small><u><i style="width:' + Math.floor(q[1]) + '%"></i></u>'; if (s >= 4) c.classList.add('ripe'); }
      grid.appendChild(c);
    });
    body.appendChild(grid);
    const acts = el('div', 'acts');
    const ripe = Farming.ripe(d);
    if (ripe) acts.appendChild(btn('Harvest (' + ripe + ')', 'primary', () => { Farming.harvest(p, d); U.rebuild(); U.refreshAll(); }));
    const bottles = p.inv.count('water_bottle');
    acts.appendChild(btn('Water' + (bottles ? ' (' + bottles + ' bottle' + (bottles > 1 ? 's' : '') + ')' : ''), bottles ? '' : 'dim', () => { const r = Farming.water(p, d); if (r !== true) { U.toast(r); Sfx.deny(); } U.rebuild(); U.refreshAll(); }));
    body.appendChild(acts);
    const held = Farming.seedsHeld(p), free = Farming.free(d);
    const seeds = el('div', 'quick');
    if (free && held.length) { seeds.appendChild(el('span', 'dim small', 'Plant: ')); for (const id of held) seeds.appendChild(btn(nm(id) + ' ×' + p.inv.count(id), 'mini', () => { const r = Farming.plant(p, d, id); if (r !== true) { U.toast(r); Sfx.deny(); } U.rebuild(); U.refreshAll(); })); }
    else if (free) seeds.appendChild(el('span', 'dim small', 'No seeds. Pick wild hemp or berries, loot food crates, or buy seeds at Haven Market.'));
    body.appendChild(seeds);
    body.appendChild(el('p', 'dim small', 'Crops need water and light. A water barrel within ' + FARM.barrelR + ' m waters the planter by itself and rain waters it in the open; a water bottle adds ' + FARM.bottle + '%. Indoors or at night, a powered ceiling light or floodlight lets them grow. Harvests often give seeds back.'));
  },
  // ---------------------------------------------------------------- cooking pot
  openPot(d) {
    const U = G.ui; if (!U) return;
    U.openInventory({ inv: d.inv, title: 'Cooking Pot' + (d.state.lit ? ' (burning)' : ''), noDeposit: true, extra: right => this.potBody(right, d) });
    U.sheetRefresh = () => { if (!d.dead) U.rebuild(); else U.closeSheet(); };
  },
  potBody(right, d) {
    const p = G.player, U = G.ui, st = d.state, w = el('div', 'pot');
    const acts = el('div', 'acts');
    acts.appendChild(btn(st.lit ? 'Put out the fire' : 'Light the fire', st.lit ? 'danger' : 'primary', () => { if (!st.lit && d.inv.count(POT.fuel) <= 0 && !(st.fa > 0)) { U.toast('Add wood as fuel'); Sfx.deny(); return; } st.lit = st.lit ? 0 : 1; Sfx.click(); U.rebuild(); }));
    if (p.inv.count(POT.fuel)) acts.appendChild(btn('+ Wood', 'mini', () => { const n = Math.min(p.inv.count(POT.fuel), 100, d.inv.room(POT.fuel)); if (n > 0) { p.inv.take(POT.fuel, n); d.inv.add(POT.fuel, n); Sfx.pickup(); } U.rebuild(); }));
    w.appendChild(acts);
    const q = Array.isArray(st.q) ? st.q : [];
    const stuck = q.length && q[0][1] <= 0 && COOK_BY[q[0][0]] && d.inv.room(COOK_BY[q[0][0]].out) < COOK_BY[q[0][0]].n;
    w.appendChild(el('div', 'pw-st ' + (stuck ? 'bad' : q.length ? (st.lit ? 'good' : 'warn') : 'idle'), stuck ? 'The pot is full: take some food out' : q.length ? (st.lit ? 'Cooking ' : 'Waiting for the fire: ') + q.map((j, i) => nm(COOK_BY[j[0]] ? COOK_BY[j[0]].out : j[0]) + (i === 0 && st.lit ? ' (' + Math.ceil(j[1]) + ' s)' : '')).join(', ') : 'Nothing cooking. Pick a recipe below.'));
    const list = el('div', 'recipes pot-recipes');
    for (const R of COOK) {
      const why = Cooking.cantCook(p, d, R), def = ITEMS[R.out], row = el('div', 'rec' + (why ? ' no' : ''));
      row.innerHTML = '<img src="' + ic(R.out) + '"><div class="rt"><b>' + def.name + (R.n > 1 ? ' ×' + R.n : '') + '</b><small>' + Object.entries(R.cost).map(([k, v]) => '<span class="' + (p.inv.count(k) >= v ? '' : 'bad') + '">' + v + ' ' + nm(k) + '</span>').join(' · ') + '</small><small class="dim">' + (def.desc || '') + '</small></div>';
      const b = btn('Cook', why ? '' : 'primary', () => { const r = Cooking.cook(p, d, R.id); if (r !== true) { U.toast(r); Sfx.deny(); } else if (!st.lit) U.toast('Light the fire to start cooking'); U.rebuild(); U.refreshAll(); });
      b.disabled = !!why; row.appendChild(b); list.appendChild(row);
    }
    w.appendChild(list);
    w.appendChild(el('p', 'dim small', 'Ingredients come from your pockets. The fire burns one wood every ' + POT.burn + ' s. The campfire roasts corn and bakes potatoes too.'));
    right.appendChild(w);
  },
  // ---------------------------------------------------------------- wiring bar
  frame() {
    const p = G.player; let bar = this.bar;
    const show = !!(p && !p.dead && G.mode === 'play' && (holdingWire(p) || Power.pending) && !G.buildMode);
    if (!show) { if (bar && !bar.classList.contains('hidden')) bar.classList.add('hidden'); return; }
    if (!bar) {
      bar = this.bar = el('div', 'wirebar hidden'); bar.innerHTML = '<b></b><span></span>';
      const x = el('button', 'mini', 'Cancel'); x.onclick = e => { e.stopPropagation(); Power.cancelWire(); Sfx.click(); }; bar.appendChild(x); this.barX = x;
      document.body.appendChild(bar);
    }
    const info = Power.pendingInfo();
    const t = info ? ['CABLE', 'from ' + info.name + ' · ' + Math.round(info.len) + ' / ' + WIRE_RANGE + ' m · tap the item to power'] : ['WIRE TOOL', 'tap an item to run a cable from its output'];
    const key = t.join('|');
    if (bar._k !== key) { bar._k = key; bar.querySelector('b').textContent = t[0]; bar.querySelector('span').textContent = t[1]; this.barX.style.display = info ? '' : 'none'; bar.classList.toggle('far', !!(info && info.len > WIRE_RANGE * 0.85)); }
    bar.classList.remove('hidden');
  },
};
void SEED_IDS;
