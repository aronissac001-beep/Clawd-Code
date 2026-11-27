// Letters, the nemesis card, the demand card and the trade sheet (owner I; doc 9.8, 9.10, 4.5, 10.6).
//   Letters (10.6): every incident speaks through the C8 `letter` event. Choice letters (a wanderer,
//   refugees, a captive, a stolen heirloom: H's s.st.letters) open as a card sheet with their choices
//   (the `letter` command) and an "If you do not answer" line; incident and nemesis letters wait as
//   unread mail (the envelope alert) and open from it; minor news is a toast. Every letter stays in
//   Menu > Letters for the session; the Chronicle keeps the history.
//   The nemesis card (9.10): who it is (name and epithet), what it is, its scar and affixes, whom it
//   hates and how often it came back; shown for nemesis letters and inside the omen of a nemesis-led raid.
//   The demand card (4.5): an Ember-touched colonist's demand (F's demandCard): each material with
//   have / need, the bench, the days left and what happens when it is met or not.
//   The trade sheet (9.8): the visiting trader's stock and what the hold can sell, prices from K's
//   buyPrice / sellPrice, a basket, and one `trade` command.
// UI memory only (never saved): the session's letter list and which letters were read.
import { h, onTap, icon } from './kit.js';
import { def, all } from '../game/core/content.js';
import { on } from '../game/core/events.js';
import { TICKS_PER_HOUR, TICKS_PER_DAY } from '../game/core/time.js';
import { pendingLetters, letterById } from '../game/threat/letters.js';
import { fullName, nemesisById } from '../game/threat/nemesis.js';
import { demandCard } from '../game/people/embertouch.js';
import { buyPrice, sellPrice, colonyCoins } from '../game/colony/trade.js';
import { nemesisRow } from './worldui.js';
import { W, PLANE, D, TER, DESIG } from '../game/core/grid.js';
import { stoneId } from '../game/world/defs.js';
import { vdigAt } from '../game/work/vdig.js';
/** F's ember record: met is the tick the demand was met, or -1 (null in older records). */
const emberMet = (em) => typeof em.met === 'number' ? em.met >= 0 : !!em.met;

const CAP = 40;
const KIND_ICON = { choice: 'book', incident: 'omen', nemesis: 'skull', trader: 'merchant', envoy: 'banner', envoyMet: 'banner', envoyFailed: 'banner', omen: 'omen', minor: 'info' };
const MINOR = new Set(['minor']);

/** Words for letters whose event carries ids, not text (K's trade and envoys). Perks send no letter (EMBERCROWN-FORTRESS.md 3.1). */
function letterWords(s, e) {
  const d = e.data || {};
  if (d.kind === 'trader') {
    const t = def('trader', d.trader) || { name: 'A trader', text: '' };
    return { title: `${t.name} at the gate`, text: `${t.text || ''} They stay one day. Open the trade sheet to buy and sell.`.trim() };
  }
  if (d.kind === 'envoy') { const f = def('faction', d.faction) || { name: d.faction }, it = def('item', d.k) || { name: d.k }; return { title: `An envoy of the ${f.name}`, text: `They ask for ${d.n} ${it.name.toLowerCase()}. Keep them in a stockpile by the deadline: goodwill and coin if they are there, a slight if not.` }; }
  if (d.kind === 'envoyMet') { const f = def('faction', d.faction) || { name: d.faction }; return { title: 'The envoy is pleased', text: `The ${f.name} took what they asked for and paid. Their goodwill grows.` }; }
  if (d.kind === 'envoyFailed') { const f = def('faction', d.faction) || { name: d.faction }; return { title: 'The envoy left empty-handed', text: `The ${f.name} will remember it. Their goodwill falls.` }; }
  return { title: d.title || (def('incident', d.inc) || {}).name || 'A letter', text: d.text || '' };
}

/**
 * The letter tracker for one colony. ctx: shell context; hooks: { pause(on) -> restore fn, settings() }.
 * check() once a second (opens a waiting choice letter when the screen is free).
 */
export function mountLetters(ctx, hooks = {}) {
  const s = ctx.s;
  const list = [];            // [{ id, kind, title, text, tick, read, data }]
  const seenChoice = new Set();
  const off = on('letter', (e) => {
    const d = e.data || {};
    if (!d || d.letterId === undefined) return;
    if (list.some((x) => x.id === d.letterId && x.kind === d.kind)) return;
    const w = letterWords(s, e);
    const rec = { id: d.letterId, kind: d.kind, title: w.title || '', text: w.text || '', tick: e.tick, read: MINOR.has(d.kind) || d.kind === 'omen', data: d };
    list.unshift(rec);
    while (list.length > CAP) list.pop();
    if (MINOR.has(d.kind)) ctx.toast(rec.title ? `${rec.title}: ${rec.text}` : rec.text);
    else if (d.kind === 'trader') { rec.read = true; ctx.toast(`${rec.title}. Tap the trader alert to trade.`); }
    else if (d.kind !== 'omen' && d.kind !== 'choice') ctx.toast(`${rec.title || 'A letter'}. Tap the letter alert to read it.`);
  });
  const offEmber = on('emberTouched', (e) => { const d = e.data || {}; pendingDemand = d.colId === undefined ? true : d.colId; });
  let pendingDemand = null;
  const api = {
    list: () => list,
    unread: () => list.filter((x) => !x.read),
    /** Choice letters waiting for an answer (H's record), oldest first. */
    waiting: () => { try { return pendingLetters(s).filter((l) => l.choices && l.choices.length); } catch (_) { return []; } },
    check(free) {
      if (!free) return;
      if (pendingDemand !== null && s.colony.ember) { pendingDemand = null; openDemand(ctx, hooks); return; }
      for (const l of api.waiting()) {
        if (seenChoice.has(l.id)) continue;
        seenChoice.add(l.id);
        openChoice(ctx, l, hooks);
        return;
      }
    },
    open(rec) { rec.read = true; openLetter(ctx, rec, hooks); },
    openNewest() { const u = api.unread()[0] || list[0]; if (u) api.open(u); else ctx.toast('No letters.'); },
    destroy() { off(); offEmber(); },
  };
  return api;
}

const hoursLeft = (s, until) => Math.max(0, Math.ceil((until - s.tick) / TICKS_PER_HOUR));
/** A waiting choice letter (H): its text, the choices, and the default taken when time runs out. */
export function openChoice(ctx, l, hooks = {}) {
  const s = ctx.s;
  const restore = hooks.pause ? hooks.pause(true) : null;
  ctx.openSheet(l.title || 'A letter', (el) => {
    el.classList.add('ec-letter');
    el.append(h('div.ec-letter-ic', { html: icon(l.kind === 'nemesis' ? 'skull' : 'book') }), h('p.ec-letter-t', { text: l.text || '' }));
    const left = letterById(s, l.id);
    if (!left) { el.append(h('p.ec-note', { text: 'This letter has been answered.' })); return; }
    const acts = h('div.ec-choices');
    l.choices.forEach((label, k) => {
      const b = h('button.ec-act' + (k === 0 ? '.primary' : ''), { type: 'button', 'data-act': 'letter-choice-' + k, text: label });
      onTap(b, () => { const r = ctx.send({ t: 'letter', id: l.id, choice: k }, `${label}.`); if (r && r.ok) ctx.closeSheet(); });
      acts.append(b);
    });
    el.append(acts);
    if (l.deflt !== null && l.deflt !== undefined && l.choices[l.deflt]) el.append(h('p.ec-note', { text: `If you do not answer within ${hoursLeft(s, l.until)} hours: ${l.choices[l.deflt]}.` }));
  }, { onClose: () => { if (restore) restore(); }, letter: true, back: !!hooks.back });
}

/** A letter from the list: a choice letter still waiting opens with its choices; a nemesis letter with its card. */
export function openLetter(ctx, rec, hooks = {}) {
  const s = ctx.s;
  if (rec.kind === 'choice') { const l = letterById(s, rec.id); if (l) { openChoice(ctx, l, hooks); return; } }
  if (rec.kind === 'trader') { openTrade(ctx, rec.data.visitId); return; }
  ctx.openSheet(rec.title || 'A letter', (el) => {
    el.classList.add('ec-letter');
    el.append(h('div.ec-letter-ic', { html: icon(KIND_ICON[rec.kind] || 'book') }), h('p.ec-letter-t', { text: rec.text || '' }));
    if (rec.kind === 'nemesis') {
      const n = (s.st.nemeses || []).find((x) => fullName(x) === rec.title) || null;
      if (n) el.append(nemesisCard(ctx, n));
    }
    el.append(h('p.ec-note', { text: `Day ${Math.floor(rec.tick / TICKS_PER_DAY) + 1}.` }));
  }, { back: !!hooks.back, letter: true });
}

/** Menu > Letters: waiting choices first, then the session's letters, newest first. */
export function openLetters(ctx, letters) {
  ctx.openSheet('Letters', (el) => {
    const waiting = letters.waiting();
    if (waiting.length) el.append(h('h3.ec-sub', { text: 'Waiting for an answer' }));
    for (const l of waiting) {
      const b = h('button.ec-row', { type: 'button', 'data-act': 'letter-open' }, h('span', { html: icon('book') }), h('span.ec-row-n', { text: l.title || 'A letter' }), h('span.ec-row-s', { text: `${hoursLeft(ctx.s, l.until)} h` }));
      onTap(b, () => openChoice(ctx, l, { back: true }));
      el.append(b);
    }
    const list = letters.list();
    el.append(h('h3.ec-sub', { text: list.length ? 'This session' : 'No letters yet' }));
    if (!list.length) el.append(h('p.ec-note', { text: 'Raids, traders, visitors and news arrive as letters. The Chronicle (Colony) keeps the history.' }));
    for (const rec of list) {
      const b = h('button.ec-row' + (rec.read ? '' : '.unread'), { type: 'button', 'data-act': 'letter-read' }, h('span', { html: icon(KIND_ICON[rec.kind] || 'book') }),
        h('span.ec-row-n', { text: rec.title || (rec.text || '').slice(0, 40) || 'A letter' }), h('span.ec-row-s', { text: `Day ${Math.floor(rec.tick / TICKS_PER_DAY) + 1}` }));
      onTap(b, () => { rec.read = true; openLetter(ctx, rec, { back: true }); });
      el.append(b);
    }
  }, { back: true });
}

// ---- The nemesis card (9.10) ------------------------------------------------------------------------------
export function nemesisCard(ctx, n) {
  return h('div.ec-nemcard', { role: 'group', 'aria-label': `Nemesis ${fullName(n)}` }, h('span.ec-nemcard-ic', { html: icon('skull') }), nemesisRow(ctx, n));
}
/** The nemesis leading a queued raid (storyteller entry.nem), or null. */
export function nemesisOf(s, view) {
  const e = s.st && s.st.queue ? s.st.queue.find((x) => x.id === view.id) : null;
  if (!e || e.nem === undefined || e.nem === null) return null;
  return nemesisById(s, e.nem);
}

// ---- The demand card (4.5) ----------------------------------------------------------------------------------
export function openDemand(ctx, hooks = {}) {
  const s = ctx.s;
  const em = s.colony.ember;
  if (!em) { ctx.toast('Nobody is Ember-touched.'); return; }
  const c = s.col.find((x) => x.id === em.colId);
  const restore = hooks.pause ? hooks.pause(true) : null;
  ctx.openSheet(`${c ? c.name.split(' ')[0] : 'Someone'} is Ember-touched`, (el) => {
    el.classList.add('ec-letter');
    const sk = def('skill', em.skill) || { name: em.skill };
    el.append(h('div.ec-letter-ic', { html: icon('flame') }),
      h('p.ec-letter-t', { text: `${c ? c.name : 'A crafter'} has been seized by the Ember. They will make a thing of legend (${sk.name}) if the hold brings them what they ask for.` }));
    let rows = [];
    try { rows = demandCard(s); } catch (_) { rows = []; }
    const list = h('div.ec-needs', { role: 'list' });
    for (const r of rows) {
      const it = def('item', r.k) || { name: r.k }, mat = r.m ? (def('material', r.m) || { name: r.m }).name + ' ' : '';
      const pct = Math.min(100, Math.round((r.have * 100) / Math.max(1, r.n)));
      list.append(h('div.ec-need.' + (r.ok ? 'good' : 'bad'), { role: 'listitem', 'aria-label': `${mat}${it.name}: ${r.have} of ${r.n}` },
        h('span.ec-need-n', { text: `${mat}${it.name}`.replace(/^./, (x) => x.toUpperCase()) }), h('span.ec-skill-bar', null, h('i', { style: { width: pct + '%' } })), h('b.ec-skill-l', { text: `${Math.min(r.have, r.n)}/${r.n}` })));
    }
    el.append(h('h3.ec-sub', { text: emberMet(em) ? 'Demand met: they are at work' : 'The demand' }), list);
    const days = em.deadline !== undefined ? Math.max(0, Math.ceil((em.deadline - s.tick) / TICKS_PER_DAY)) : null;
    const bench = em.bench !== null && em.bench !== undefined && s.bld[em.bench] ? (def('structure', s.bld[em.bench].def) || { name: 'their bench' }).name : null;
    el.append(h('div.ec-facts', null,
      bench ? h('div.ec-fact', null, h('span', { text: 'Bench' }), h('b', { text: bench })) : h('div.ec-fact', null, h('span', { text: 'Bench' }), h('b', { text: 'None yet: they wait by the Hearth' })),
      days !== null ? h('div.ec-fact', null, h('span', { text: 'Time left' }), h('b', { text: emberMet(em) ? 'Working' : `${days} days` })) : null));
    el.append(h('p.ec-note', { text: 'Everything must be in the stores at once: they take it from there. Met: a named masterwork or legendary piece. Not met by the deadline: a major break.' }));
    const acts = h('div.ec-peek-acts');
    const btn = (label, act, fn) => { const b = h('button.ec-act', { type: 'button', 'data-act': act, text: label }); onTap(b, fn); acts.append(b); };
    if (c) btn('Show them', 'demand-locate', () => { ctx.closeSheet(); ctx.centerOn(c.x, c.y); ctx.select({ kind: 'colonist', id: c.id }); });
    btn('Trade', 'demand-trade', () => openTrade(ctx));
    btn('Got it', 'demand-ok', () => ctx.closeSheet());
    el.append(acts);
  }, { onClose: () => { if (restore) restore(); }, letter: true });
}

// ---- The trade sheet (9.8) ----------------------------------------------------------------------------------
/** The live visit (K's s.colony.trade), the given id or the first. */
export function visitNow(s, visitId) {
  const v = s.colony.trade && s.colony.trade.visits ? s.colony.trade.visits.filter((x) => x.until > s.tick) : [];
  return (visitId !== undefined && visitId !== null ? v.find((x) => x.id === visitId) : null) || v[0] || null;
}
const ITEM = (k) => (def('item', k) || { name: k }).name;
/** Stock the hold can sell to this trader: stored stacks whose category the trader buys. */
function sellables(s, tr) {
  const buys = new Set(tr.buys || []);
  const cats = all('itemCat');
  const topOf = (cat) => { const c = cats.find((x) => x.id === cat); return c && c.parent ? c.parent : cat; };
  const tot = new Map();
  for (const it of s.items) {
    if (!it || it.f || it.k === 'coins') continue;
    const d = def('item', it.k);
    if (!d || !(buys.has(d.cat) || buys.has(topOf(d.cat)))) continue;
    const key = it.k + '|' + (it.m || '');
    tot.set(key, (tot.get(key) || 0) + it.n);
  }
  return [...tot].map(([key, n]) => { const [k, m] = key.split('|'); return { k, m: m || null, n }; }).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
}
export function openTrade(ctx, visitId) {
  const s = ctx.s;
  const v = visitNow(s, visitId);
  if (!v) { ctx.toast('No trader is here. Traders come every few days; a trade post brings more.'); return; }
  const tr = def('trader', v.trader) || { name: 'Trader', buys: [], sells: [] };
  const basket = { buy: new Map(), sell: new Map() };
  const key = (g) => g.k + '|' + (g.m || '') + '|' + (g.q || 0);
  ctx.openSheet(`Trade: ${tr.name}`, (el) => {
    const coins = colonyCoins(s);
    let cost = 0, gain = 0;
    const price = (side, g, n) => { try { return side === 'buy' ? buyPrice(s, v.trader, g.k, n) : sellPrice(s, v.trader, g.k, n); } catch (_) { return 0; } };
    for (const [, x] of basket.buy) cost += price('buy', x.g, x.n);
    for (const [, x] of basket.sell) gain += price('sell', x.g, x.n);
    const net = Math.floor(gain / 10) - Math.ceil(cost / 10);   // K's prices are tenths of a coin
    el.append(h('div.ec-facts', null,
      h('div.ec-fact', null, h('span', { text: 'Your coins' }), h('b', { text: String(coins) })),
      h('div.ec-fact', null, h('span', { text: 'Their coins' }), h('b', { text: String(v.coins | 0) })),
      h('div.ec-fact', null, h('span', { text: 'Leaves in' }), h('b', { text: `${hoursLeft(s, v.until)} h` }))));
    const row = (side, g, have) => {
      const k = key(g), cur = basket[side].get(k), n = cur ? cur.n : 0, step = have >= 50 ? 10 : 1;
      const p1 = price(side, g, 1), each = p1 % 10 ? (p1 / 10).toFixed(1) : String(p1 / 10);
      const minus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': `${side}-minus`, 'aria-label': 'Less', html: icon('minus'), disabled: n <= 0 });
      const plus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': `${side}-plus`, 'aria-label': 'More', html: icon('plus'), disabled: n >= have });
      onTap(minus, () => { const m = Math.max(0, n - step); if (m) basket[side].set(k, { g, n: m }); else basket[side].delete(k); ctx.refreshSheet(); });
      onTap(plus, () => { basket[side].set(k, { g, n: Math.min(have, n + step) }); ctx.refreshSheet(); });
      const mat = g.m ? (def('material', g.m) || { name: g.m }).name + ' ' : '';
      return h('div.ec-trade-row', null, h('span.ec-trade-n', null, h('b', { text: `${mat}${ITEM(g.k)}`.replace(/^./, (x) => x.toUpperCase()) }), h('span', { text: `${have} ${side === 'buy' ? 'for sale' : 'in store'} · ${each} coins each` })), minus, h('b.ec-bill-n', { text: String(n) }), plus);
    };
    el.append(h('h3.ec-sub', { text: 'Buy' }));
    const stock = (v.stock || []).filter((g) => g.n > 0);
    if (!stock.length) el.append(h('p.ec-note', { text: 'Sold out.' }));
    for (const g of stock) el.append(row('buy', g, g.n));
    el.append(h('h3.ec-sub', { text: 'Sell' }));
    const sell = sellables(s, tr);
    if (!sell.length) el.append(h('p.ec-note', { text: `They buy ${(tr.buys || []).map((c) => (all('itemCat').find((x) => x.id === c) || { name: c }).name.toLowerCase()).join(', ') || 'nothing'}; none is in your stores.` }));
    for (const g of sell) el.append(row('sell', g, g.n));
    const deal = h('button.ec-act.primary.ec-wide', { type: 'button', 'data-act': 'trade-deal', text: net >= 0 ? `Deal: you get ${net} coins` : `Deal: you pay ${-net} coins`, disabled: !basket.buy.size && !basket.sell.size });
    onTap(deal, () => {
      const cmd = { t: 'trade', visitId: v.id, buy: [...basket.buy.values()].map((x) => ({ k: x.g.k, m: x.g.m || null, q: x.g.q || 0, n: x.n })), sell: [...basket.sell.values()].map((x) => ({ k: x.g.k, m: x.g.m || null, n: x.n })) };
      const r = ctx.send(cmd, 'Traded. The goods land by the trade post or the Hearth.');
      if (r && r.ok) { basket.buy.clear(); basket.sell.clear(); ctx.refreshSheet(); }
    });
    el.append(deal, h('p.ec-note', { text: `${tr.text || ''} Goodwill with their faction lowers prices; an envoy with Social bargains better.`.trim() }));
  }, { back: true });
}

// ---- The Seal asks first (owner decision 3; EMBERCROWN-FORTRESS.md 3.12 Hollow King) -----------------------------
// The first order that would cut the Seal-stone (a Mine, Risky, Stairs, Ramp or Channel mark, or a carved hall,
// over one of its 3 x 3 voxels) raises one letter before it is sent: break the Seal, or leave it. Once the Seal
// is marked or cut (state), or the player said yes on this device, it never asks again. UI only: the command
// itself is unchanged, so the sim and its determinism are untouched.
const SEAL_KEY = (s) => 'ec2.seal.' + (s.id || 'colony');
const CUTS = new Set(['mine', 'risky', 'stairs', 'ramp', 'channel']);
const sealCache = new WeakMap();
/** The Seal-stone voxels of this hold (ascending; [] at D = 1 or when the world has none). */
export function sealVoxels(s) {
  if (D <= 1 || !s.L || !s.L.mat) return [];
  let v = sealCache.get(s.L.mat);
  if (v) return v;
  const id = stoneId('sealstone'), m = s.L.mat;
  v = [];
  if (id) for (let i = 0; i < m.length; i++) if (m[i] === id) v.push(i);
  sealCache.set(s.L.mat, v);
  return v;
}
/** True when the Seal has been agreed to: a Seal voxel cut or marked, or a yes on this device. */
export function sealAgreed(s) {
  try { if (localStorage.getItem(SEAL_KEY(s)) === '1') return true; } catch (_) { /* private mode: state alone */ }
  for (const i of sealVoxels(s)) if (s.L.terrain[i] !== TER.ROCK || (s.L.desig[i] & (DESIG.MINE | DESIG.RISKY)) || vdigAt(s, i)) return true;
  return false;
}
/** The levels a command reaches: its rect's level, and `levels` down (or up) from it. */
function cmdLevels(c) {
  const z = c.rect.z | 0, n = Math.max(1, c.levels | 0);
  return c.dir === 'up' ? [z, z + n - 1] : [z - n + 1, z];
}
/** True when command c would cut a Seal-stone voxel that is not yet agreed to. */
export function cutsSeal(s, c) {
  if (!c || !c.rect || c.rect.z === undefined) return false;
  if (!((c.t === 'designate' && c.add !== false && CUTS.has(c.kind)) || c.t === 'carve')) return false;
  const vs = sealVoxels(s);
  if (!vs.length) return false;
  const r = c.rect, x0 = Math.min(r.x0, r.x1), x1 = Math.max(r.x0, r.x1), y0 = Math.min(r.y0, r.y1), y1 = Math.max(r.y0, r.y1), [z0, z1] = cmdLevels(c);
  const hit = vs.some((i) => { const z = (i / PLANE) | 0, p = i - z * PLANE, x = p % W, y = (p / W) | 0; return z >= z0 && z <= z1 && x >= x0 && x <= x1 && y >= y0 && y <= y1; });
  return hit && !sealAgreed(s);
}
/** The Seal's letter: yes sends `go()` (the order as given) and remembers the answer; no sends nothing. */
export function openSealLetter(ctx, go) {
  const s = ctx.s;
  ctx.openSheet('The Seal-stone', (el) => {
    el.classList.add('ec-letter');
    el.append(h('div.ec-letter-ic', { html: icon('book') }),
      h('p.ec-letter-t', { text: 'The old songs say the Hollow King sleeps under this grey plug, and what is cut cannot be mended. Break the Seal?' }));
    const acts = h('div.ec-choices');
    const yes = h('button.ec-act', { type: 'button', 'data-act': 'seal-break', text: 'Break the Seal' });
    const no = h('button.ec-act.primary', { type: 'button', 'data-act': 'seal-leave', text: 'Leave it sealed' });
    onTap(yes, () => { try { localStorage.setItem(SEAL_KEY(s), '1'); } catch (_) { /* the marks themselves remember */ } ctx.closeSheet(); go(); });
    onTap(no, () => { ctx.closeSheet(); if (ctx.toast) ctx.toast('The Seal stays whole.'); });
    acts.append(no, yes);
    el.append(acts, h('p.ec-note', { text: 'You are asked once. Leaving it sealed sends nothing.' }));
  }, { letter: true });
}
