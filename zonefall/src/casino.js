// ============================================================================
// ZONEFALL — the Lucky Duck Casino (inside Haven Market). Gamble scrap on
//   openBlackjack(ui)    6-deck shoe, 3:2 naturals, dealer hits soft 16 and
//                        stands on all 17s, peeks for blackjack, double on the
//                        first two cards, one split (one card on split aces)
//   openDuckRace(ui)     five rubber ducks, fresh odds every race (~8% house
//                        edge), an 8 second race drawn on a 2D canvas
//   setDuckTrack(track)  mirror each race on the 3D trough ({ setProgress, reset })
// and the casino's 3D props: makeBlackjackTable(), makeDuckTrack(), makeCasinoSign().
// Rules are pure exported helpers (hand totals, dealer rule, odds, race plans)
// so they can be unit-tested without a DOM. Every hand / race is settled the
// moment its outcome is known (scrap paid at once); animation only reveals it.
// ============================================================================
import { G } from './state.js';
import { Sfx } from './audio.js';
import { Live } from './world/live.js';
import { THREE, M } from './gfx/materials.js';

const TAU = Math.PI * 2, PI = Math.PI;
const INK = '#120c10';
const FONT = '"Avenir Next Condensed","Futura-CondensedExtraBold","Roboto Condensed","Arial Narrow","Arial Black",-apple-system,system-ui,sans-serif';
export const MAX_BET = 200;
export const CHIPS = [5, 10, 25, 50, 100];
const CHIP_COL = { 5: '#e2433a', 10: '#2f7fd8', 25: '#33a84a', 50: '#ff8a1e', 100: '#2a2236' };
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// fair randomness: crypto when available (shuffles, winners), Math.random otherwise
const rnd = (() => {
  const C = globalThis.crypto;
  if (C && C.getRandomValues) { const buf = new Uint32Array(256); let i = 256; return () => { if (i >= 256) { C.getRandomValues(buf); i = 0; } return buf[i++] / 4294967296; }; }
  return Math.random;
})();
function shuffle(a, rand = rnd) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ============================================================================
// BLACKJACK RULES (pure)
// ============================================================================
export const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣']; // spades hearts diamonds clubs
/** card = { r: 1..13 (1 = ace), s: 0..3, id } */
export const cardValue = c => (c.r === 1 ? 1 : c.r > 10 ? 10 : c.r);
/** { total, soft, bust }: soft = an ace is counted as 11 */
export function handValue(cards) {
  let t = 0, ace = false;
  for (const c of cards) { t += cardValue(c); if (c.r === 1) ace = true; }
  const soft = ace && t + 10 <= 21;
  return { total: soft ? t + 10 : t, soft, bust: t > 21 };
}
export const isBlackjack = cards => cards.length === 2 && handValue(cards).total === 21;
/** dealer draws to 16 (soft 16 included) and stands on every 17, soft or hard */
export const dealerShouldHit = cards => handValue(cards).total < 17;
/** "Soft 17", "20", "Bust 24", "Blackjack" (natural = false for split hands) */
export function totalLabel(cards, natural = true) {
  if (!cards.length) return '';
  const v = handValue(cards);
  if (v.bust) return 'Bust ' + v.total;
  if (natural && isBlackjack(cards)) return 'Blackjack';
  return (v.soft && v.total < 21 ? 'Soft ' : '') + v.total;
}

/** a 6-deck shoe, reshuffled between hands once less than 25% is left */
export class Shoe {
  constructor(decks = 6, rand = rnd) { this.decks = decks; this.rand = rand; this.serial = Math.floor(rand() * 1e6) * 1000; this.shuffles = 0; this.shuffle(); }
  shuffle() {
    const a = [];
    for (let d = 0; d < this.decks; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) a.push({ r, s });
    this.cards = shuffle(a, this.rand); this.pos = 0; this.shuffles++;
  }
  get size() { return this.decks * 52; }
  get left() { return this.cards.length - this.pos; }
  needsShuffle() { return this.left < this.size * 0.25; }
  draw() { if (this.pos >= this.cards.length) this.shuffle(); const c = this.cards[this.pos++]; return { r: c.r, s: c.s, id: ++this.serial }; }
}

const mkHand = (cards, bet) => ({ cards, bet, doubled: false, done: false, split: false, result: null, pay: 0 });
/**
 * Start a hand: (reshuffle if due) deal player, dealer up, player, dealer hole.
 * Naturals settle at once (the dealer peeks under a 10 or an ace).
 * R.log lists every card / flip / split in order, for the table to replay.
 */
export function newRound(shoe, bet) {
  const R = { bet, staked: bet, payout: 0, delta: 0, dealer: [], hands: [mkHand([], bet)], active: 0, phase: 'player', log: [], natural: false, peek: false };
  if (shoe.needsShuffle()) { shoe.shuffle(); R.log.push({ t: 'shuffle' }); }
  const toP = () => drawTo(R, shoe, 0);
  const toD = () => { const c = shoe.draw(); R.dealer.push(c); R.log.push({ t: 'd', c, down: R.dealer.length === 2 }); };
  toP(); toD(); toP(); toD();
  const up = R.dealer[0]; R.peek = up.r === 1 || cardValue(up) === 10;
  if (isBlackjack(R.dealer) || isBlackjack(R.hands[0].cards)) { R.natural = true; R.hands[0].done = true; dealerPlay(R, shoe); }
  return R;
}
function drawTo(R, shoe, i) { const c = shoe.draw(); R.hands[i].cards.push(c); R.log.push({ t: 'p', h: i, c }); return c; }
export const canHit = R => !!R && R.phase === 'player';
export function canDouble(R) { const h = canHit(R) && R.hands[R.active]; return !!h && h.cards.length === 2; }
export function canSplit(R) { const h = canHit(R) && R.hands.length === 1 && R.hands[0]; return !!h && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]); }
/** extra scrap an action needs on top of what is already staked */
export const actionCost = (R, kind) => (kind === 'double' || kind === 'split') && R ? R.hands[R.active].bet : 0;
export function hit(R, shoe) { if (!canHit(R)) return false; const h = R.hands[R.active]; drawTo(R, shoe, R.active); if (handValue(h.cards).total >= 21) h.done = true; advance(R, shoe); return true; }
export function stand(R, shoe) { if (!canHit(R)) return false; R.hands[R.active].done = true; advance(R, shoe); return true; }
export function double(R, shoe) {
  if (!canDouble(R)) return false; const h = R.hands[R.active];
  R.staked += h.bet; h.bet *= 2; h.doubled = true; drawTo(R, shoe, R.active); h.done = true; advance(R, shoe); return true;
}
export function split(R, shoe) {
  if (!canSplit(R)) return false;
  const a = R.hands[0], b = mkHand([a.cards.pop()], a.bet); a.split = b.split = true; R.hands.push(b); R.staked += b.bet;
  R.log.push({ t: 'split' }); drawTo(R, shoe, 0); drawTo(R, shoe, 1);
  const aces = b.cards[0].r === 1; // split aces get one card each
  for (const h of R.hands) if (aces || handValue(h.cards).total === 21) h.done = true;
  advance(R, shoe); return true;
}
function advance(R, shoe) {
  while (R.active < R.hands.length && R.hands[R.active].done) R.active++;
  if (R.active < R.hands.length) return;
  R.active = R.hands.length - 1; dealerPlay(R, shoe);
}
/** reveal the hole card, draw while dealerShouldHit (unless every hand is bust / a natural ended it), settle */
export function dealerPlay(R, shoe) {
  R.phase = 'dealer'; R.log.push({ t: 'flip' });
  const live = !R.natural && R.hands.some(h => !handValue(h.cards).bust);
  if (live) while (dealerShouldHit(R.dealer)) { const c = shoe.draw(); R.dealer.push(c); R.log.push({ t: 'd', c }); }
  return settle(R);
}
/** results per hand: blackjack (3:2, rounded down) | win (1:1) | push (bet back) | lose | bust */
export function settle(R) {
  const d = handValue(R.dealer), dBJ = isBlackjack(R.dealer); let pay = 0;
  for (const h of R.hands) {
    const v = handValue(h.cards), bj = !h.split && isBlackjack(h.cards);
    if (v.bust) { h.result = 'bust'; h.pay = 0; }
    else if (bj && dBJ) { h.result = 'push'; h.pay = h.bet; }
    else if (bj) { h.result = 'blackjack'; h.pay = h.bet + Math.floor(h.bet * 3 / 2); }
    else if (dBJ) { h.result = 'lose'; h.pay = 0; }
    else if (d.bust || v.total > d.total) { h.result = 'win'; h.pay = h.bet * 2; }
    else if (v.total === d.total) { h.result = 'push'; h.pay = h.bet; }
    else { h.result = 'lose'; h.pay = 0; }
    pay += h.pay;
  }
  R.payout = pay; R.delta = pay - R.staked; R.phase = 'done';
  return R;
}

// ============================================================================
// DUCK RACE RULES (pure)
// ============================================================================
/** lane order = index; colours are shared by the 2D race and the 3D track */
export const DUCKS = [
  { name: 'Sir Quacks', col: '#ffd23a', acc: 'hat' },
  { name: 'Puddles', col: '#ff84c6', acc: 'bow' },
  { name: 'Rocket', col: '#ff4a3a', acc: 'goggles' },
  { name: 'Mallory', col: '#6fdc48', acc: 'ring' },
  { name: 'Lucky', col: '#a874ff', acc: 'clover' },
];
export const DUCK_EDGE = 0.08;
const LADDER = [[2, 1], [5, 2], [3, 1], [7, 2], [4, 1], [9, 2], [5, 1], [6, 1], [7, 1], [8, 1]];
export const oddsText = o => o[0] + ':' + o[1];
/** total returned for a winning bet: bet x odds (rounded down) + the bet */
export const duckPayout = (bet, o) => Math.floor(bet * o[0] / o[1]) + bet;
function snapOdds(x) { let b = LADDER[0], bd = 1e9; for (const o of LADDER) { const d = Math.abs(Math.log((o[0] / o[1] + 1) / (x + 1))); if (d < bd) { bd = d; b = o; } } return b; }
/**
 * A race card: odds per duck between 2:1 and 8:1. Win chances are the implied
 * probabilities b/(a+b) normalised to 1, so every duck has the same expected
 * return 1/sum(implied) = 1 - edge (the book is rejected unless edge = 8% +-1%).
 */
export function makeOdds(rand = rnd, edge = DUCK_EDGE) {
  const n = DUCKS.length; let best = null;
  for (let k = 0; k < 400; k++) {
    const s = []; for (let i = 0; i < n; i++) s.push(Math.exp((rand() + rand() + rand() - 1.5) * 1.3));
    const S = s.reduce((a, b) => a + b, 0);
    const odds = s.map(v => snapOdds((1 - edge) * S / v - 1));
    const q = odds.map(o => o[1] / (o[0] + o[1])), Q = q.reduce((a, b) => a + b, 0), e = 1 - 1 / Q;
    const dec = odds.map(o => o[0] / o[1]), book = { odds, p: q.map(x => x / Q), edge: e };
    if (Math.abs(e - edge) <= 0.01 && Math.min(...dec) <= 3 && Math.max(...dec) >= 5 && new Set(dec).size >= 3) return book;
    if (!best || Math.abs(e - edge) < Math.abs(best.edge - edge)) best = book;
  }
  return best;
}
/** index drawn from probabilities p */
export function pickIndex(p, rand = rnd) { let r = rand(); for (let i = 0; i < p.length - 1; i++) { r -= p[i]; if (r < 0) return i; } return p.length - 1; }

/**
 * Progress curves (0 at the start, 1 on the line) for a race whose winner is
 * already drawn: every duck gets its own surges and slumps, then its curve is
 * scaled to cross the line at its finish time; the winner's time is the
 * earliest. Re-rolled until the lead changes hands at least twice.
 */
export function planRace(winner, rand = rnd, n = DUCKS.length) {
  let plan = null;
  for (let k = 0; k < 40; k++) { plan = buildPlan(winner, rand, n); if (plan.leadChanges >= 2 && plan.leadChanges <= 8 && plan.winnerEarly < 0.65) break; }
  return plan;
}
function buildPlan(winner, rand, n) {
  const dt = 1 / 60, tw = 6.2 + rand() * 0.6;
  const others = shuffle([...Array(n).keys()].filter(i => i !== winner), rand);
  const fin = new Array(n); fin[winner] = tw; let t = tw;
  others.forEach((i, k) => { t += k === 0 ? 0.05 + rand() * 0.28 : 0.06 + rand() * 0.32; fin[i] = t; });
  const end = t + 0.55, N = Math.ceil(end / dt) + 2, curves = [];
  for (let i = 0; i < n; i++) {
    const S = [], k = 4 + Math.floor(rand() * 3);
    for (let j = 0; j < k; j++) S.push({ c: rand() * fin[i], w: 0.35 + rand() * 0.8, a: (rand() - 0.38) * 1.25 });
    if (i === winner) S.push({ c: fin[i] * (0.6 + rand() * 0.32), w: 0.45 + rand() * 0.5, a: 0.7 + rand() * 0.6 }); // the winning kick
    const d = new Float32Array(N); let acc = 0;
    for (let s = 0; s < N; s++) {
      const tt = s * dt; let sp = 1;
      for (const q of S) { const z = (tt - q.c) / q.w; sp += q.a * Math.exp(-z * z); }
      sp = Math.max(0.3, sp) * Math.min(1, 0.12 + tt / 0.5);
      if (tt > fin[i]) sp *= Math.max(0.25, 1 - (tt - fin[i]) / 0.9); // ease off past the line
      acc += sp * dt; d[s] = acc;
    }
    const f = fin[i] / dt, f0 = Math.floor(f), D = d[f0] + (d[f0 + 1] - d[f0]) * (f - f0);
    for (let s = 0; s < N; s++) d[s] /= D;
    curves.push(d);
  }
  const plan = { fin, curves, dt, end, tw, n, leadChanges: 0, winnerEarly: 0 };
  let lead = -1, early = 0, earlyN = 0;
  for (let tt = 1.0; tt < tw; tt += 0.1) {
    let L = 0; for (let i = 1; i < n; i++) if (raceProgress(plan, i, tt) > raceProgress(plan, L, tt)) L = i;
    if (lead >= 0 && L !== lead) plan.leadChanges++;
    lead = L; if (tt < tw * 0.6) { earlyN++; if (L === winner) early++; }
  }
  plan.winnerEarly = earlyN ? early / earlyN : 0;
  return plan;
}
/** progress of duck i at race time t (seconds after GO); passes 1 after the line */
export function raceProgress(plan, i, t) {
  if (t <= 0) return 0; const d = plan.curves[i], x = t / plan.dt, k = Math.floor(x);
  if (k >= d.length - 1) return d[d.length - 1];
  return d[k] + (d[k + 1] - d[k]) * (x - k);
}

// ============================================================================
// SCRAP + STATS
// ============================================================================
const _statsFallback = { won: 0, lost: 0, hands: 0, races: 0 };
/** G.run.casino = { won, lost, hands, races } (+ `pending`: an unfinished blackjack hand) */
export function casinoStats() {
  const r = G.run; if (!r) return _statsFallback;
  const c = r.casino || (r.casino = {});
  for (const k of ['won', 'lost', 'hands', 'races']) if (typeof c[k] !== 'number') c[k] = 0;
  return c;
}
function record(delta) { const s = casinoStats(); if (delta > 0) s.won += delta; else if (delta < 0) s.lost -= delta; }
const scrapHave = () => (G.player && G.player.inv ? G.player.inv.count('scrap') : 0);
function takeScrap(n) {
  if (n <= 0) return true; const inv = G.player && G.player.inv; if (!inv) return false;
  const got = inv.take('scrap', n); if (got < n) { giveScrap(got); return false; } return true;
}
function giveScrap(n) {
  const p = G.player; if (n <= 0 || !p) return;
  const left = p.inv.add('scrap', n);
  if (left > 0) { try { Live.dropItem(p.x, p.z, 'scrap', left); } catch (e) { console.warn('[casino] drop', e); } if (G.ui && G.ui.toast) G.ui.toast('Pockets full: ' + left + ' scrap dropped at your feet'); }
}
const sfx = f => { try { f(); } catch (e) { /* audio is optional */ } };
const fmtDelta = d => (d > 0 ? '+' + d : d < 0 ? '−' + -d : '±0') + ' scrap';
const scrapIcon = () => { try { const A = typeof ART !== 'undefined' ? ART : window.ART; return A && A.iconURL ? A.iconURL('scrap') : ''; } catch (e) { return ''; } }; // eslint-disable-line no-undef

// ============================================================================
// SHARED UI BITS
// ============================================================================
function h(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
function btn(label, cls, fn, dis) { const b = h('button', cls || '', label); b.disabled = !!dis; b.onclick = e => { e.stopPropagation(); fn(); }; return b; }
function balanceEl(n) { const src = scrapIcon(); return h('span', 'cz-bal', (src ? `<img src="${src}" alt="">` : '') + `<b>${n}</b><small>scrap</small>`); }
function chainClose(ui, fn) { const prev = ui.onClose; ui.onClose = () => { try { fn(); } catch (e) { console.warn('[casino]', e); } if (prev) prev(); }; }
/** the five chip buttons; S = { bet } state, onChange() re-renders */
function chipRow(S, dis, onChange, ui) {
  const row = h('div', 'cz-chips');
  for (const v of CHIPS) {
    const b = h('button', 'cz-chip', String(v)); b.style.setProperty('--c', CHIP_COL[v]); b.disabled = dis;
    b.onclick = e => {
      e.stopPropagation(); const have = scrapHave(), room = Math.min(MAX_BET, have) - S.bet;
      if (room <= 0) { sfx(() => Sfx.deny()); ui.toast(S.bet >= MAX_BET ? 'Table limit is ' + MAX_BET + ' scrap' : 'Not enough scrap'); return; }
      S.bet += Math.min(v, room); sfx(() => Sfx.click()); onChange();
    };
    row.appendChild(b);
  }
  return row;
}
/** [Clear][main action] row */
function betActs(S, dis, onChange, main) {
  const acts = h('div', 'cz-acts cz-bet');
  acts.appendChild(btn('Clear', 'cz-clear', () => { S.bet = 0; sfx(() => Sfx.ui()); onChange(); }, dis || !S.bet));
  acts.appendChild(main); return acts;
}
function bannerEl(cls, title, sub) { return h('div', 'cz-res ' + cls, `<b>${title}</b>${sub ? `<small>${sub}</small>` : ''}`); }

// ============================================================================
// BLACKJACK SHEET
// ============================================================================
const BJ = { shoe: null, round: null, shown: 0, seen: new Map(), busy: false, pend: 0, bet: 10, view: null };

export function openBlackjack(ui) {
  injectCss();
  if (!BJ.shoe) BJ.shoe = new Shoe(6);
  const st = casinoStats();
  if (st.pending && st.pending.phase === 'player' && BJ.round !== st.pending) { // resume a hand from a saved run
    BJ.round = st.pending; BJ.shown = BJ.round.log.length; BJ.seen = new Map();
    for (const e of BJ.round.log) if (e.c) BJ.seen.set(e.c.id, e.down ? 'down' : 'up');
  }
  if (BJ.round && BJ.shown < BJ.round.log.length) BJ.shown = BJ.round.log.length;
  BJ.busy = false;
  if (BJ.view && BJ.view.alive) BJ.view.kill();
  const V = { alive: true, ui }; BJ.view = V;
  ui.openSheet('Blackjack', body => buildBJ(body, V), { cls: 'wide cz-sheet' });
  V.onKey = e => {
    if (!V.alive || e.repeat || !V.felt || !V.felt.isConnected) return;
    const t = e.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'h') bjAct(V, 'hit'); else if (k === 's') bjAct(V, 'stand'); else if (k === 'd') bjAct(V, 'double'); else if (k === 'p') bjAct(V, 'split');
    else if (k === ' ') { e.preventDefault(); if (!BJ.round || BJ.round.phase === 'done') bjDeal(V); }
  };
  document.addEventListener('keydown', V.onKey);
  V.kill = () => {
    if (!V.alive) return; V.alive = false; document.removeEventListener('keydown', V.onKey);
    if (V.wake) V.wake();
    BJ.pend = 0;
  };
  chainClose(ui, V.kill);
}
function buildBJ(body, V) {
  const sc = body.scrollTop; body.innerHTML = '';
  const root = h('div', 'cz cz-bj'); V.felt = h('div', 'cz-felt'); V.side = h('div', 'cz-side');
  root.append(V.felt, V.side); body.appendChild(root); V.feltKey = null;
  renderBJ(V); body.scrollTop = sc;
}
function renderBJ(V) { renderBJFelt(V); renderBJSide(V); }
/** what the table shows after the first n log events */
function bjView(R, n) {
  const v = { dealer: [], hands: [[]], holeUp: false, shuffling: false };
  if (!R) return v;
  for (let i = 0; i < n && i < R.log.length; i++) {
    const e = R.log[i];
    if (e.t === 'p') (v.hands[e.h] || (v.hands[e.h] = [])).push(e.c);
    else if (e.t === 'd') v.dealer.push({ c: e.c, down: !!e.down });
    else if (e.t === 'flip') v.holeUp = true;
    else if (e.t === 'split') v.hands[1] = [v.hands[0].pop()];
    else if (e.t === 'shuffle') v.shuffling = i === n - 1;
  }
  return v;
}
function cardEl(c, down) {
  const prev = BJ.seen.get(c.id), anim = prev === undefined ? ' deal' : prev === 'down' && !down ? ' flip' : '';
  BJ.seen.set(c.id, down ? 'down' : 'up');
  const red = c.s === 1 || c.s === 2, d = h('div', 'cz-card' + (red ? ' red' : '') + (down ? ' down' : '') + anim);
  const rk = RANKS[c.r], su = SUITS[c.s] + '︎';
  d.innerHTML = '<div class="cz-in"><div class="cz-f">' + (down ? '' : `<span class="r">${rk}<small>${su}</small></span><span class="pip">${su}</span><span class="r r2">${rk}<small>${su}</small></span>`) + '</div><div class="cz-b"></div></div>';
  return d;
}
const placeholder = () => h('div', 'cz-ph');
function totEl(cards, natural) {
  const s = totalLabel(cards, natural); if (!s) return '';
  const cls = s.startsWith('Bust') ? ' bust' : s === 'Blackjack' ? ' bj' : '';
  return `<span class="cz-tot${cls}">${s}</span>`;
}
const RES_TXT = { blackjack: 'Blackjack!', win: 'Win', lose: 'Lose', bust: 'Bust', push: 'Push' };
function renderBJFelt(V) {
  const felt = V.felt; if (!felt || !V.alive) return;
  const R = BJ.round, key = (R ? R.log.length + ':' + (R.hands[0].cards[0] || {}).id : '-') + ':' + BJ.shown + ':' + BJ.busy + ':' + (R && R.active);
  if (key === V.feltKey) return; V.feltKey = key;
  felt.innerHTML = '';
  const vw = bjView(R, R ? BJ.shown : 0), shoe = BJ.shoe;
  felt.appendChild(h('div', 'cz-shoe', `<i></i><span>${Math.round(shoe.left / shoe.size * 100)}%</span>`));
  // dealer
  const up = vw.dealer.filter(d => !d.down || vw.holeUp).map(d => d.c);
  const drow = h('div', 'cz-row');
  drow.appendChild(h('div', 'cz-lab', 'Dealer ' + totEl(up, vw.holeUp)));
  const dc = h('div', 'cz-cards');
  if (!vw.dealer.length) dc.append(placeholder(), placeholder()); else for (const d of vw.dealer) dc.appendChild(cardEl(d.c, d.down && !vw.holeUp));
  drow.appendChild(dc); felt.appendChild(drow);
  felt.appendChild(h('div', 'cz-motto', vw.shuffling ? '<b class="cz-shuf">Shuffling the shoe…</b>' : 'BLACKJACK PAYS 3 TO 2 · DEALER STANDS ON ALL 17s'));
  // player hand(s)
  const done = R && R.phase === 'done' && BJ.shown >= R.log.length && !BJ.busy;
  const prow = h('div', 'cz-row'), hands = h('div', 'cz-hands' + (vw.hands.length > 1 ? ' two' : ''));
  vw.hands.forEach((cards, i) => {
    const hd = R && R.hands[i], box = h('div', 'cz-hand' + (R && R.phase === 'player' && R.hands.length > 1 && R.active === i && !BJ.busy ? ' on' : ''));
    const cc = h('div', 'cz-cards'); if (!cards.length) cc.append(placeholder(), placeholder()); else for (const c of cards) cc.appendChild(cardEl(c, false));
    box.appendChild(cc);
    let lab = (vw.hands.length > 1 ? 'Hand ' + (i + 1) : 'You') + ' ' + totEl(cards, !(hd && hd.split));
    if (hd && hd.doubled) lab += '<span class="cz-x2">×2</span>';
    if (done && vw.hands.length > 1 && hd && hd.result !== 'bust') lab += `<span class="cz-tag ${hd.result}">${RES_TXT[hd.result]}</span>`;
    box.appendChild(h('div', 'cz-lab', lab)); hands.appendChild(box);
  });
  prow.appendChild(hands); felt.appendChild(prow);
  if (!R) felt.appendChild(h('div', 'cz-hint', 'Tap the chips to bet, then Deal'));
  if (done) {
    const r0 = R.hands[0].result, many = R.hands.length > 1;
    let cls, title, sub = fmtDelta(R.delta);
    if (many) { cls = R.delta > 0 ? 'win' : R.delta < 0 ? 'lose' : 'push'; title = R.delta > 0 ? 'Win' : R.delta < 0 ? 'Lose' : 'Push'; }
    else if (r0 === 'blackjack') { cls = 'bj'; title = 'Blackjack!'; }
    else if (r0 === 'win') { cls = 'win'; title = 'Win'; if (handValue(R.dealer).bust) sub = 'Dealer busts · ' + sub; }
    else if (r0 === 'push') { cls = 'push'; title = 'Push'; sub = 'Bet returned'; }
    else { cls = 'lose'; title = 'Lose'; if (r0 === 'bust') sub = 'Bust · ' + sub; else if (isBlackjack(R.dealer)) sub = 'Dealer blackjack · ' + sub; }
    felt.appendChild(bannerEl(cls, title, sub));
  }
}
function renderBJSide(V) {
  const side = V.side; if (!side || !V.alive) return;
  side.innerHTML = '';
  const R = BJ.round, have = Math.max(0, scrapHave() - BJ.pend), inHand = R && (R.phase === 'player' || BJ.busy);
  if (!inHand) BJ.bet = Math.min(BJ.bet, have, MAX_BET);
  const top = h('div', 'cz-top'); top.appendChild(balanceEl(have));
  top.appendChild(h('span', 'cz-betv', inHand ? `<small>In play</small><b>${R.staked}</b>` : `<small>Bet</small><b>${BJ.bet}</b>`));
  side.appendChild(top);
  if (inHand) {
    const live = R.phase === 'player' && !BJ.busy, cost = R.hands[R.active].bet, rich = scrapHave() >= cost;
    const acts = h('div', 'cz-acts');
    acts.appendChild(btn('Hit', 'primary', () => bjAct(V, 'hit'), !live));
    acts.appendChild(btn('Stand', 'cz-stand', () => bjAct(V, 'stand'), !live));
    acts.appendChild(btn(`Double<small>+${cost}</small>`, '', () => bjAct(V, 'double'), !live || !canDouble(R) || !rich));
    acts.appendChild(btn(`Split<small>+${cost}</small>`, '', () => bjAct(V, 'split'), !live || !canSplit(R) || !rich));
    side.appendChild(acts);
  } else {
    side.appendChild(chipRow(BJ, false, () => renderBJSide(V), V.ui));
    side.appendChild(betActs(BJ, false, () => renderBJSide(V), btn((R ? 'Deal again' : 'Deal') + `<small>${BJ.bet ? BJ.bet + ' scrap' : 'tap a chip to bet'}</small>`, 'primary', () => bjDeal(V), !BJ.bet)));
  }
  side.appendChild(h('p', 'cz-rules', '<b>Rules:</b> 6-deck shoe, reshuffled at 25%. Blackjack pays 3:2 (rounded down), wins pay 1:1, a push returns your bet. Dealer hits soft 16, stands on all 17s and peeks for blackjack. Double on your first two cards; split one pair (split aces get one card). No insurance. Bets 5–' + MAX_BET + '.'));
  const s = casinoStats(); side.appendChild(h('div', 'cz-stats', `This run: won <b>${s.won}</b> · lost <b>${s.lost}</b> · ${s.hands} hands · ${s.races} races`));
}
function bjCredit(R) {
  if (R.paid) return; R.paid = true;
  giveScrap(R.payout); BJ.pend = R.payout; record(R.delta);
  const st = casinoStats(); if (st.pending === R) st.pending = null;
}
function bjDeal(V) {
  if (BJ.busy || (BJ.round && BJ.round.phase !== 'done')) return;
  const bet = BJ.bet, have = scrapHave();
  if (bet <= 0) { sfx(() => Sfx.deny()); V.ui.toast('Tap a chip to place a bet'); return; }
  if (bet > have || !takeScrap(bet)) { sfx(() => Sfx.deny()); V.ui.toast('Not enough scrap'); renderBJSide(V); return; }
  BJ.seen.clear(); BJ.shown = 0;
  const R = newRound(BJ.shoe, bet); BJ.round = R; casinoStats().hands++;
  if (R.phase === 'done') bjCredit(R); else casinoStats().pending = R;
  bjReveal(V);
}
function bjAct(V, kind) {
  const R = BJ.round; if (!R || R.phase !== 'player' || BJ.busy) return;
  if (kind === 'double' && !canDouble(R)) return;
  if (kind === 'split' && !canSplit(R)) return;
  const cost = actionCost(R, kind);
  if (cost && !takeScrap(cost)) { sfx(() => Sfx.deny()); V.ui.toast('Not enough scrap to ' + kind); return; }
  ({ hit, stand, double, split })[kind](R, BJ.shoe);
  sfx(() => Sfx.click());
  if (R.phase === 'done') bjCredit(R);
  bjReveal(V);
}
function sleep(V, ms) { return new Promise(res => { if (!V.alive) return res(); V.wake = () => { clearTimeout(V.tm); V.wake = null; res(); }; V.tm = setTimeout(V.wake, ms); }); }
const cardSnd = () => sfx(() => { Sfx.noise(0.07, 2600, 1.1, 0.22, 'bandpass', 0, 0.45); Sfx.noise(0.03, 5200, 2, 0.08, 'bandpass', 0.05); });
function evSound(e) {
  if (e.t === 'shuffle') sfx(() => { for (let i = 0; i < 12; i++) Sfx.noise(0.035, 3200 + (i % 3) * 600, 2, 0.12, 'bandpass', i * 0.045); });
  else if (e.t === 'flip') sfx(() => { Sfx.noise(0.05, 3800, 2, 0.16, 'bandpass'); Sfx.tone(820, 0.04, 0.05, 'triangle', 0.03); });
  else if (e.t !== 'split') cardSnd();
  else sfx(() => Sfx.tone(440, 0.06, 0.08, 'triangle'));
}
function resultSound(R) {
  const r = R.hands.length > 1 ? (R.delta > 0 ? 'win' : R.delta < 0 ? 'lose' : 'push') : R.hands[0].result;
  sfx(() => {
    if (r === 'blackjack') { Sfx.win(); Sfx.tone(1568, 0.35, 0.12, 'triangle', 0.42); Sfx.pickup(); }
    else if (r === 'win') { Sfx.win(); }
    else if (r === 'push') Sfx.ui();
    else Sfx.deny();
  });
}
/** reveal the round's log one card at a time (instantly once the sheet is closed) */
async function bjReveal(V) {
  const R = BJ.round; if (BJ.busy || !R) return;
  BJ.busy = true; renderBJ(V);
  try {
    while (BJ.round === R && BJ.shown < R.log.length) {
      const e = R.log[BJ.shown++];
      if (V.alive) { evSound(e); renderBJFelt(V); }
      await sleep(V, e.t === 'shuffle' ? 800 : e.t === 'flip' ? 560 : e.t === 'split' ? 340 : 380);
    }
  } finally { BJ.busy = false; }
  if (R.phase === 'done' && !R.told) {
    R.told = true; BJ.pend = 0;
    if (V.alive) resultSound(R);
    else if (V.ui && V.ui.toast) V.ui.toast('Blackjack: ' + fmtDelta(R.delta), R.delta > 0 ? 'good' : '');
  }
  if (V.alive && BJ.round === R) renderBJ(V);
}

// ============================================================================
// DUCK RACE SHEET
// ============================================================================
const DR = { next: null, pick: -1, bet: 10, race: null, history: [], pend: 0, view: null };
const COUNT = 1.2; // countdown seconds before GO
let duckTrack = null;
/** hand the 3D track in ({ setProgress([p0..p4]), reset() }); null to detach */
export function setDuckTrack(track) { duckTrack = track || null; }
function trackCall(fn, arg) { if (!duckTrack || typeof duckTrack[fn] !== 'function') return; try { duckTrack[fn](arg); } catch (e) { console.warn('[casino] duck track', e); } }

export function openDuckRace(ui) {
  injectCss();
  if (!DR.next) DR.next = makeOdds();
  if (DR.view && DR.view.alive) DR.view.close();
  const V = { alive: true, ui, frame: 0 }; DR.view = V;
  ui.openSheet('Duck Derby', body => buildDR(body, V), { cls: 'wide cz-sheet' });
  V.onKey = e => { if (!V.alive || e.repeat || e.key !== ' ' || !V.cv || !V.cv.isConnected) return; const t = e.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return; e.preventDefault(); drStart(V); };
  document.addEventListener('keydown', V.onKey);
  const close = () => {
    if (!V.alive) return; V.alive = false; cancelAnimationFrame(V.raf); document.removeEventListener('keydown', V.onKey);
    if (DR.race && DR.race.phase !== 'done') drEnd(V, true);
    trackCall('reset');
  };
  V.close = close; chainClose(ui, close);
  V.raf = requestAnimationFrame(t => drLoop(V, t));
}
function buildDR(body, V) {
  body.innerHTML = '';
  const root = h('div', 'cz cz-dr'), stage = h('div', 'cz-stage'), cv = document.createElement('canvas');
  stage.appendChild(cv); V.stage = stage; V.cv = cv; V.g = null;
  V.side = h('div', 'cz-side'); root.append(stage, V.side); body.appendChild(root);
  renderDRSide(V); renderDRBanner(V);
}
function renderDRBanner(V) {
  if (!V.stage) return; const old = V.stage.querySelector('.cz-res'); if (old) old.remove();
  const R = DR.race; if (!R || R.phase !== 'done' || !R.show) return;
  const won = R.payout > 0;
  V.stage.appendChild(bannerEl(won ? 'win' : 'lose', DUCKS[R.winner].name + ' wins!', won ? 'You win ' + fmtDelta(R.payout - R.bet) : fmtDelta(-R.bet)));
}
const _icons = {};
function duckIcon(i) {
  if (_icons[i]) return _icons[i];
  const c = document.createElement('canvas'); c.width = 72; c.height = 58; drawDuck(c.getContext('2d'), 32, 41, 40, DUCKS[i]);
  return (_icons[i] = c.toDataURL());
}
function renderDRSide(V) {
  const side = V.side; if (!side || !V.alive) return;
  side.innerHTML = '';
  const R = DR.race, racing = R && R.phase !== 'done', have = Math.max(0, scrapHave() - DR.pend), book = DR.next;
  if (!racing) DR.bet = Math.min(DR.bet, have, MAX_BET);
  const top = h('div', 'cz-top'); top.appendChild(balanceEl(have));
  top.appendChild(h('span', 'cz-betv', racing ? `<small>On ${DUCKS[R.pick].name}</small><b>${R.bet}</b>` : `<small>Bet</small><b>${DR.bet}</b>`));
  side.appendChild(top);
  const grid = h('div', 'cz-ducks'), fav = book.odds.reduce((b, o, i) => (o[0] / o[1] < book.odds[b][0] / book.odds[b][1] ? i : b), 0);
  DUCKS.forEach((D, i) => {
    const o = racing ? R.book.odds[i] : book.odds[i], sel = (racing ? R.pick : DR.pick) === i;
    const b = btn(`<img src="${duckIcon(i)}" alt=""><span>${D.name}</span><b>${oddsText(o)}</b>`, 'cz-duck' + (sel ? ' on' : '') + (!racing && i === fav ? ' fav' : ''), () => { DR.pick = i; sfx(() => Sfx.click()); renderDRSide(V); }, racing);
    b.style.setProperty('--c', D.col); grid.appendChild(b);
  });
  side.appendChild(grid);
  side.appendChild(chipRow(DR, !!racing, () => renderDRSide(V), V.ui));
  const label = racing ? 'Racing…<small>' + R.bet + ' on ' + DUCKS[R.pick].name + '</small>'
    : (R ? 'Race again' : 'Race!') + '<small>' + (DR.pick < 0 ? 'pick a duck' : !DR.bet ? 'tap a chip to bet' : DR.bet + ' on ' + DUCKS[DR.pick].name + ' pays ' + duckPayout(DR.bet, book.odds[DR.pick])) + '</small>';
  side.appendChild(betActs(DR, !!racing, () => renderDRSide(V), btn(label, 'primary', () => drStart(V), racing || DR.pick < 0 || !DR.bet)));
  if (DR.history.length) side.appendChild(h('div', 'cz-hist', '<span>Last winners</span>' + DR.history.map(i => `<img src="${duckIcon(i)}" alt="${DUCKS[i].name}" title="${DUCKS[i].name}">`).join('')));
  side.appendChild(h('p', 'cz-rules', '<b>Rules:</b> pick a duck and a bet (5–' + MAX_BET + '). A win pays bet × odds (rounded down) plus your bet back: 10 on 3:1 returns 40. Odds change every race and match each duck’s chance; the house keeps about 8%.'));
  const s = casinoStats(); side.appendChild(h('div', 'cz-stats', `This run: won <b>${s.won}</b> · lost <b>${s.lost}</b> · ${s.races} races · ${s.hands} hands`));
}
function drStart(V) {
  if (DR.race && DR.race.phase !== 'done') return;
  if (DR.pick < 0) { sfx(() => Sfx.deny()); V.ui.toast('Pick a duck first'); return; }
  const bet = DR.bet;
  if (bet <= 0) { sfx(() => Sfx.deny()); V.ui.toast('Tap a chip to place a bet'); return; }
  if (bet > scrapHave() || !takeScrap(bet)) { sfx(() => Sfx.deny()); V.ui.toast('Not enough scrap'); renderDRSide(V); return; }
  const book = DR.next || makeOdds(), winner = pickIndex(book.p), odds = book.odds[DR.pick];
  const payout = winner === DR.pick ? duckPayout(bet, odds) : 0;
  giveScrap(payout); DR.pend = payout; // settled now, revealed by the race
  casinoStats().races++; record(payout - bet);
  DR.race = { book, winner, pick: DR.pick, bet, odds, payout, plan: planRace(winner), t0: performance.now(), phase: 'count', beeps: 0, leader: -1, quackT: 0, crossed: false, rt: -COUNT, prog: DUCKS.map(() => 0) };
  trackCall('reset');
  renderDRSide(V); renderDRBanner(V);
}
function drEnd(V, closed) {
  const R = DR.race; if (!R || R.phase === 'done') return;
  R.phase = 'done'; R.rt = R.plan.end; R.prog = DUCKS.map((_, i) => raceProgress(R.plan, i, R.plan.end)); R.show = !closed;
  DR.pend = 0; DR.history.unshift(R.winner); if (DR.history.length > 6) DR.history.length = 6;
  DR.next = makeOdds();
  if (closed) {
    if (V.ui && V.ui.toast) V.ui.toast(DUCKS[R.winner].name + ' won the duck race: ' + (R.payout ? 'you win ' + fmtDelta(R.payout - R.bet) : fmtDelta(-R.bet)), R.payout ? 'good' : '');
    return;
  }
  trackCall('setProgress', R.prog.map(clamp01));
  sfx(() => { if (R.payout) { Sfx.win(); Sfx.pickup(); } else Sfx.deny(); });
  renderDRSide(V); renderDRBanner(V);
}
const quack = () => sfx(() => { const f = 520 + Math.random() * 140; Sfx.tone(f, 0.11, 0.07, 'sawtooth', 0, 0.55); Sfx.noise(0.08, 1400, 3, 0.05, 'bandpass'); Sfx.tone(f * 0.92, 0.12, 0.06, 'sawtooth', 0.13, 0.5); });
function drLoop(V, now) {
  if (!V.alive) return;
  if (!V.cv || !V.cv.isConnected) { V.close(); return; } // another sheet replaced ours
  const R = DR.race;
  if (R && R.phase !== 'done') {
    const el = (now - R.t0) / 1000;
    while (R.beeps < 4 && el >= R.beeps * 0.4) { const go = R.beeps === 3; sfx(() => Sfx.tone(go ? 988 : 660, go ? 0.3 : 0.12, 0.12, 'square')); R.beeps++; }
    R.rt = el - COUNT; if (R.rt > 0) R.phase = 'run';
    R.prog = DUCKS.map((_, i) => raceProgress(R.plan, i, R.rt));
    trackCall('setProgress', R.prog.map(clamp01));
    if (R.rt > 1 && R.rt < R.plan.tw) {
      let L = 0; for (let i = 1; i < R.prog.length; i++) if (R.prog[i] > R.prog[L]) L = i;
      if (L !== R.leader) { if (R.leader >= 0 && now - R.quackT > 650) { quack(); R.quackT = now; } R.leader = L; }
    }
    if (!R.crossed && R.rt >= R.plan.tw) { R.crossed = true; sfx(() => { Sfx.tone(1318, 0.18, 0.1, 'triangle'); Sfx.tone(1760, 0.3, 0.09, 'triangle', 0.12); }); }
    if (R.rt >= R.plan.end) drEnd(V, false);
  }
  const busy = R && R.phase !== 'done';
  if (busy || (V.frame++ & 1) === 0) drawRace(V, now / 1000); // idle bobbing at half rate
  V.raf = requestAnimationFrame(t => drLoop(V, t));
}

// ---------------------------------------------------------------- 2D drawing
/** cartoon rubber duck facing right; (x, y) = body centre at the water line, s = body length. Bill tip at x + 0.68 s */
export function drawDuck(g, x, y, s, D, o = {}) {
  const col = D.col || D, lw = Math.max(1.2, s * 0.055);
  g.save(); g.translate(x, y); if (o.rot) g.rotate(o.rot);
  g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = lw; g.strokeStyle = INK;
  const P = (a, b) => [a * s, b * s];
  // body + perky tail
  g.beginPath(); g.moveTo(...P(-0.46, -0.14));
  g.quadraticCurveTo(...P(-0.6, -0.44), ...P(-0.38, -0.34));
  g.quadraticCurveTo(...P(-0.2, -0.2), ...P(0.06, -0.2));
  g.quadraticCurveTo(...P(0.42, -0.24), ...P(0.47, -0.02));
  g.quadraticCurveTo(...P(0.5, 0.27), ...P(0.05, 0.27));
  g.quadraticCurveTo(...P(-0.46, 0.27), ...P(-0.5, 0.02));
  g.quadraticCurveTo(...P(-0.52, -0.08), ...P(-0.46, -0.14));
  g.closePath(); g.fillStyle = col; g.fill(); g.stroke();
  // wing
  g.beginPath(); g.moveTo(...P(-0.3, -0.04)); g.quadraticCurveTo(...P(-0.05, -0.14), ...P(0.16, 0.0)); g.quadraticCurveTo(...P(-0.02, 0.16), ...P(-0.3, -0.04));
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fill(); g.lineWidth = lw * 0.7; g.stroke(); g.lineWidth = lw;
  // head
  g.beginPath(); g.arc(...P(0.26, -0.42), 0.2 * s, 0, TAU); g.fillStyle = col; g.fill(); g.stroke();
  if (D.acc === 'ring') { g.beginPath(); g.moveTo(...P(0.12, -0.25)); g.quadraticCurveTo(...P(0.25, -0.19), ...P(0.4, -0.26)); g.strokeStyle = '#fff6e2'; g.lineWidth = lw * 1.6; g.stroke(); g.strokeStyle = INK; g.lineWidth = lw; }
  // bill
  g.beginPath(); g.moveTo(...P(0.4, -0.45)); g.quadraticCurveTo(...P(0.63, -0.47), ...P(0.68, -0.37)); g.quadraticCurveTo(...P(0.6, -0.29), ...P(0.39, -0.33));
  g.closePath(); g.fillStyle = '#ff8a1e'; g.fill(); g.stroke();
  // eye + shine
  g.beginPath(); g.arc(...P(0.3, -0.48), 0.06 * s, 0, TAU); g.fillStyle = '#fff'; g.fill(); g.lineWidth = lw * 0.6; g.stroke();
  g.beginPath(); g.arc(...P(0.32, -0.48), 0.032 * s, 0, TAU); g.fillStyle = INK; g.fill();
  g.beginPath(); g.arc(...P(0.18, -0.52), 0.05 * s, PI * 1.1, PI * 1.7); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = lw * 0.9; g.stroke();
  g.strokeStyle = INK; g.lineWidth = lw;
  // accessories
  if (D.acc === 'hat') {
    g.fillStyle = '#1e1a24'; g.beginPath(); g.rect(...P(0.08, -0.62), 0.34 * s, 0.05 * s); g.fill(); g.stroke();
    g.beginPath(); g.rect(...P(0.14, -0.86), 0.22 * s, 0.25 * s); g.fill(); g.stroke();
    g.fillStyle = '#e2433a'; g.fillRect(...P(0.145, -0.68), 0.21 * s, 0.05 * s);
  } else if (D.acc === 'bow') {
    g.fillStyle = '#36d2ff'; g.beginPath(); g.moveTo(...P(0.12, -0.58)); g.lineTo(...P(0.0, -0.68)); g.lineTo(...P(0.0, -0.5)); g.closePath(); g.moveTo(...P(0.12, -0.58)); g.lineTo(...P(0.22, -0.7)); g.lineTo(...P(0.25, -0.52)); g.closePath(); g.fill(); g.stroke();
    g.beginPath(); g.arc(...P(0.12, -0.58), 0.035 * s, 0, TAU); g.fill(); g.stroke();
  } else if (D.acc === 'goggles') {
    g.strokeStyle = '#2a2236'; g.lineWidth = lw * 1.8; g.beginPath(); g.arc(...P(0.26, -0.42), 0.2 * s, PI * 1.02, PI * 1.62); g.stroke();
    g.lineWidth = lw; g.strokeStyle = INK; g.fillStyle = '#9cf0ff'; g.beginPath(); g.arc(...P(0.3, -0.55), 0.075 * s, 0, TAU); g.fill(); g.stroke();
  } else if (D.acc === 'clover') {
    g.fillStyle = '#3fbf4a'; for (const [a, b] of [[0.18, -0.68], [0.26, -0.7], [0.2, -0.76], [0.26, -0.62]]) { g.beginPath(); g.arc(...P(a, b), 0.045 * s, 0, TAU); g.fill(); g.stroke(); }
  }
  g.restore();
}
function otext(g, s, x, y, fill, lw) { g.lineJoin = 'round'; g.lineWidth = lw; g.strokeStyle = INK; g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y); }
function drawRace(V, t) {
  const cv = V.cv; if (!cv) return;
  const W = cv.clientWidth, H = cv.clientHeight; if (W < 40 || H < 40) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1), bw = Math.round(W * dpr), bh = Math.round(H * dpr);
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
  const g = V.g || (V.g = cv.getContext('2d')); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const R = DR.race, live = R && R.phase !== 'done', n = DUCKS.length;
  const prog = R ? R.prog : DUCKS.map(() => 0), pick = live ? R.pick : DR.pick;
  const head = Math.max(20, Math.round(H * 0.11)), foot = Math.max(6, Math.round(H * 0.035)), LH = (H - head - foot) / n;
  const tag = 18, x0 = tag + W * 0.13, x1 = W * 0.915;
  // wooden trough
  g.fillStyle = '#7a4524'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#5c3018'; g.fillRect(0, 0, W, head); g.fillRect(0, H - foot, W, foot);
  g.fillStyle = 'rgba(0,0,0,.18)'; for (let x = 37; x < W; x += 74) g.fillRect(x, 0, 2, head);
  // header
  g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = `900 italic ${Math.round(head * 0.66)}px ${FONT}`; otext(g, 'DUCK DERBY', 8, head / 2 + 1, '#ffc928', 3.5);
  let status = DR.pick >= 0 ? 'Your duck: ' + DUCKS[DR.pick].name : 'Pick a duck, place a bet';
  if (R && R.phase === 'count') status = 'Ducks on the line…';
  else if (R && R.phase === 'run') status = R.crossed ? DUCKS[R.winner].name + ' takes it!' : 'Leader: ' + DUCKS[Math.max(0, R.leader)].name;
  else if (R && R.phase === 'done' && R.show !== false && pick === R.pick) status = 'Winner: ' + DUCKS[R.winner].name;
  g.textAlign = 'right'; g.font = `800 ${Math.round(head * 0.5)}px ${FONT}`; otext(g, status, W - 8, head / 2 + 1, '#fff6e2', 3);
  // lanes of water + drifting wave crests
  const grads = [];
  for (let i = 0; i < n; i++) {
    const y = head + i * LH, gr = g.createLinearGradient(0, y, 0, y + LH); gr.addColorStop(0, '#74dcfa'); gr.addColorStop(1, '#2394d8'); grads.push(gr);
    g.fillStyle = gr; g.fillRect(0, y, W, LH);
    if (i === pick) { g.fillStyle = 'rgba(255,214,60,.2)'; g.fillRect(0, y, W, LH); }
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.4;
    for (let r = 0; r < 2; r++) {
      const wy = y + LH * (0.28 + r * 0.44), sp = 26, off = (t * (12 + r * 7) + i * 9 + r * 13) % sp;
      g.beginPath(); for (let k = -1; k * sp < W + sp; k++) { const xx = k * sp - off + (r ? sp / 2 : 0); g.moveTo(xx, wy); g.quadraticCurveTo(xx + 6, wy - 3.4, xx + 12, wy); } g.stroke();
    }
  }
  // lane ropes with floats
  for (let i = 1; i < n; i++) {
    const y = head + i * LH; g.strokeStyle = 'rgba(255,248,230,.9)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    g.lineWidth = 1;
    for (let k = 0, x = tag + 6; x < W; x += 14, k++) { g.fillStyle = k % 2 ? '#ff4a3a' : '#fff6e2'; g.beginPath(); g.arc(x, y + Math.sin(t * 2.6 + k * 0.9 + i) * 0.7, 2.7, 0, TAU); g.fill(); g.strokeStyle = INK; g.stroke(); }
  }
  // start + checkered finish
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x0 - 1.5, head, 3, H - head - foot);
  const cs = Math.max(4, Math.round(LH / 5));
  for (let yy = head, k = 0; yy < H - foot; yy += cs, k++) for (let c = 0; c < 2; c++) { g.fillStyle = (k + c) % 2 ? INK : '#fff6e2'; g.fillRect(x1 + c * cs, yy, cs, Math.min(cs, H - foot - yy)); }
  // lane tags
  g.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const y = head + i * LH; g.fillStyle = DUCKS[i].col; g.fillRect(1, y + 2, tag - 3, LH - 4); g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(1, y + 2, tag - 3, LH - 4);
    g.font = `900 ${Math.round(Math.min(LH * 0.45, 15))}px ${FONT}`; otext(g, String(i + 1), tag / 2, y + LH / 2 + 1, '#fff', 2.5);
  }
  // ducks
  const s = Math.min(LH * 1.02, W * 0.095), rt = R ? R.rt : 0, places = [];
  if (R) [...Array(n).keys()].sort((a, b) => R.plan.fin[a] - R.plan.fin[b]).forEach((d, k) => { places[d] = k + 1; });
  for (let i = 0; i < n; i++) {
    const y = head + i * LH, p = Math.min(1.07, prog[i] || 0), nose = x0 + p * (x1 - x0), cx = nose - 0.68 * s;
    let speed = 0; if (live && R.phase === 'run') speed = Math.min(3, Math.max(0, (raceProgress(R.plan, i, rt) - raceProgress(R.plan, i, rt - 0.12)) / 0.12 * R.plan.tw));
    const cy = y + LH * 0.66 + Math.sin(t * 5.2 + i * 1.9) * LH * 0.035, rot = Math.sin(t * 4.1 + i * 1.3) * 0.05 + speed * 0.035;
    g.save(); g.beginPath(); g.rect(0, y, W, LH + 2); g.clip();
    if (R && R.phase === 'done' && i === R.winner) { // sunburst behind the winner
      g.save(); g.translate(cx, cy - 0.2 * s); g.rotate(t * 0.8);
      for (let k = 0; k < 12; k++) { g.fillStyle = k % 2 ? 'rgba(255,230,90,.6)' : 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 1.1 * s, k * TAU / 12, (k + 0.6) * TAU / 12); g.closePath(); g.fill(); }
      g.restore();
    }
    drawDuck(g, cx, cy, s, DUCKS[i], { rot });
    // water lapping over the bottom of the duck
    const wy = cy + 0.15 * s, lx = cx - 0.62 * s, rx = cx + 0.62 * s, ph = t * 6 + i;
    const lip = () => { g.moveTo(lx, wy); for (let k = 0; k < 4; k++) { const a = lx + (rx - lx) * (k + 0.5) / 4, b = lx + (rx - lx) * (k + 1) / 4; g.quadraticCurveTo(a, wy + Math.sin(ph + k) * 2.2, b, wy); } };
    g.beginPath(); lip(); g.lineTo(rx, cy + 0.32 * s); g.lineTo(lx, cy + 0.32 * s); g.closePath(); g.fillStyle = grads[i]; g.fill();
    if (i === pick) { g.fillStyle = 'rgba(255,214,60,.2)'; g.fill(); }
    g.beginPath(); lip(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.6; g.stroke();
    if (speed > 0.15) { // wake: ripples trailing the tail, spray when surging
      const k0 = Math.min(1, speed); g.strokeStyle = '#fff'; g.lineWidth = Math.max(1.4, s * 0.05);
      for (let k = 1; k <= 3; k++) { const wx = cx - 0.5 * s - k * 0.2 * s * (0.7 + 0.3 * speed), wr = 0.06 * s * (1 + k * 0.6); g.globalAlpha = (0.95 - k * 0.24) * k0; g.beginPath(); g.arc(wx, wy + 0.02 * s, wr, PI * 1.08, PI * 1.92); g.stroke(); }
      if (speed > 1.4) { g.fillStyle = '#fff'; for (let k = 0; k < 4; k++) { const a = t * 9 + k * 2.1 + i; g.globalAlpha = 0.9; g.beginPath(); g.arc(cx - 0.55 * s - (k * 0.1 + Math.abs(Math.sin(a)) * 0.12) * s, wy - 0.06 * s - Math.abs(Math.cos(a)) * 0.2 * s, Math.max(1.5, s * 0.035), 0, TAU); g.fill(); } }
      g.globalAlpha = 1;
    }
    g.restore();
    if (i === pick) { // "your duck" pointer
      const px = cx + 0.26 * s, py = cy - 0.72 * s - (DUCKS[i].acc === 'hat' ? 0.18 * s : 0);
      g.beginPath(); g.moveTo(px - 5, py - 7); g.lineTo(px + 5, py - 7); g.lineTo(px, py); g.closePath(); g.fillStyle = '#ffc928'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.5; g.stroke();
    }
    if (R && (prog[i] || 0) >= 1 && places[i]) { // finishing place
      const bx = cx - 0.72 * s, by = cy - 0.3 * s, rr = Math.max(7, LH * 0.22);
      g.beginPath(); g.arc(bx, by, rr, 0, TAU); g.fillStyle = ['#ffc928', '#dfe6ee', '#e09a5a'][places[i] - 1] || '#8a8494'; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
      g.font = `900 ${Math.round(rr * 1.2)}px ${FONT}`; g.fillStyle = INK; g.fillText(String(places[i]), bx, by + 1);
    }
  }
  // countdown
  if (R && R.rt < 0.45 && R.phase !== 'done') {
    const el = R.rt + COUNT, k = Math.floor(el / 0.4), txt = R.rt >= 0 ? 'GO!' : String(3 - Math.min(2, k)), f = R.rt >= 0 ? R.rt / 0.45 : (el % 0.4) / 0.4;
    g.save(); g.translate(W / 2, head + (H - head - foot) / 2); const sc = 1.25 - 0.3 * Math.min(1, f * 2); g.scale(sc, sc); g.globalAlpha = R.rt >= 0 ? 1 - f : 1;
    g.font = `900 italic ${Math.round(H * 0.3)}px ${FONT}`; g.textAlign = 'center'; otext(g, txt, 0, 0, R.rt >= 0 ? '#86e64a' : '#ffc928', 7);
    g.restore();
  }
}

// ============================================================================
// STYLES (injected once)
// ============================================================================
const CSS = `
.sheet.cz-sheet{width:min(97vw,800px)}
.cz{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start;--cw:56px}
@media (orientation:landscape) and (min-width:600px){.cz{grid-template-columns:minmax(0,1.45fr) minmax(250px,1fr)}}
@media (max-height:430px){.cz{--cw:46px;gap:8px}}
.cz-side{display:flex;flex-direction:column;gap:8px;min-width:0}
.cz-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.cz-bal{display:inline-flex;align-items:center;gap:5px;background:var(--amber);color:var(--ink);border:3px solid var(--ink);border-radius:5px;box-shadow:3px 3px 0 var(--ink);font-weight:900;font-size:17px;line-height:1.1;padding:2px 10px;transform:skewX(-8deg);white-space:nowrap}
.cz-bal img{width:22px;height:22px;image-rendering:auto}.cz-bal small{font-size:11px;letter-spacing:.6px;text-transform:uppercase}
.cz-betv{display:inline-flex;align-items:baseline;gap:6px;background:var(--panel3);border:3px solid var(--ink);border-radius:5px;box-shadow:3px 3px 0 var(--ink);padding:2px 10px;font-weight:900;white-space:nowrap;min-width:0;overflow:hidden}
.cz-betv small{font-size:10.5px;color:var(--dim);letter-spacing:1px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis}.cz-betv b{font-size:18px;color:#fff}
.cz-chips{display:flex;gap:5px;justify-content:center;align-items:center}
button.cz-chip{flex:0 1 48px;min-width:44px;height:auto;aspect-ratio:1;padding:0;border-radius:50%;border:3px solid var(--ink);box-shadow:2px 3px 0 var(--ink);color:#fff;font-size:15px;font-weight:900;letter-spacing:0;
  background:radial-gradient(circle,var(--c) 0 44%,#fff6e2 45% 51%,transparent 52%),repeating-conic-gradient(#fff6e2 0 11deg,var(--c) 11deg 45deg);
  text-shadow:-1px -1px 0 var(--ink),1px -1px 0 var(--ink),-1px 1px 0 var(--ink),1px 1px 0 var(--ink)}
button.cz-chip:active,button.cz-chip.pressing{transform:translateY(2px) scale(.96);border-bottom-width:3px;box-shadow:1px 1px 0 var(--ink)}
button.cz-clear{font-size:14px!important}
.cz-acts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
.cz-acts button{min-height:50px;font-size:17px;padding:4px 8px;line-height:1.1}
.cz-acts button.wide{grid-column:1/-1}
.cz-acts.cz-bet{grid-template-columns:minmax(64px,1fr) minmax(0,2.6fr)}
.cz-acts button small{display:block;font-size:10.5px;font-weight:700;letter-spacing:.2px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
button.cz-stand{background:linear-gradient(#ff8a78 0 45%,#e2433a 45%);color:#fff;text-shadow:1px 1px 0 var(--ink)}
.cz-rules{font-size:11px;line-height:1.35;color:var(--dim);margin:0}.cz-rules b{color:var(--text)}
.cz-stats{font-size:11px;color:var(--dim)}.cz-stats b{color:var(--text)}
/* the felt */
.cz-felt{position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;gap:2px;min-height:calc(var(--cw)*2.8 + 96px);padding:10px 10px 22px;
  border:3px solid var(--ink);border-radius:14px 14px 50% 50%/14px 14px 22% 22%;
  background:radial-gradient(ellipse at 50% 32%,#3fc46c 0,#249452 50%,#166a36 100%);
  box-shadow:inset 0 0 0 6px #8e4a22,inset 0 0 0 9px var(--ink),inset 0 0 44px rgba(0,0,0,.35),4px 4px 0 var(--ink)}
.cz-row{display:flex;flex-direction:column;align-items:center;gap:3px;position:relative;z-index:1}
.cz-lab{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:900;letter-spacing:1.4px;text-transform:uppercase;color:#e6ffd8;text-shadow:1px 1px 0 var(--ink);min-height:20px}
.cz-tot{background:#fff6e2;color:var(--ink);border:2px solid var(--ink);border-radius:10px;padding:0 7px;font-size:12.5px;letter-spacing:.3px;text-shadow:none;box-shadow:2px 2px 0 var(--ink)}
.cz-tot.bust{background:#ff5a48;color:#fff}.cz-tot.bj{background:var(--amber)}
.cz-x2{background:var(--cyan);color:var(--ink);border:2px solid var(--ink);border-radius:4px;padding:0 4px;font-size:11px;text-shadow:none}
.cz-tag{border:2px solid var(--ink);border-radius:4px;padding:0 5px;font-size:10.5px;text-shadow:none;color:var(--ink);background:#fff6e2}
.cz-tag.win,.cz-tag.blackjack{background:#8fe85a}.cz-tag.lose,.cz-tag.bust{background:#ff5a48;color:#fff}
.cz-cards{display:flex;justify-content:center;min-height:calc(var(--cw)*1.4)}
.cz-cards>*+*{margin-left:calc(var(--cw)*-.5)}
.cz-hands{display:flex;gap:10px;justify-content:center;align-items:flex-end;flex-wrap:wrap}
.cz-hands.two .cz-cards>*+*{margin-left:calc(var(--cw)*-.64)}.cz-hands.two .cz-lab{letter-spacing:.6px;gap:3px}.cz-hands.two .cz-hand{padding:3px 2px}
.cz-hand{display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px 5px;border-radius:8px;border:2px solid transparent}
.cz-hand.on{border-color:var(--amber);background:rgba(255,201,40,.14);box-shadow:0 0 12px rgba(255,201,40,.5)}
.cz-ph{width:var(--cw);height:calc(var(--cw)*1.4);border:2px dashed rgba(255,255,255,.35);border-radius:6px;flex:none}
.cz-motto{position:relative;z-index:1;text-align:center;font-size:10px;font-weight:900;font-style:italic;letter-spacing:.7px;text-wrap:balance;color:rgba(255,232,150,.85);text-shadow:1px 1px 0 rgba(0,0,0,.45);line-height:1.2;padding:1px 0}
.cz-shuf{color:#fff;font-size:12px;animation:czpulse .5s infinite alternate}
.cz-hint{position:absolute;left:0;right:0;bottom:calc(var(--cw)*.7 + 22px);text-align:center;font-weight:900;font-style:italic;font-size:13px;color:#fff6e2;text-shadow:2px 2px 0 var(--ink);z-index:2;pointer-events:none}
.cz-shoe{position:absolute;right:12px;top:10px;display:flex;align-items:center;gap:3px;font-size:10px;font-weight:900;color:#e6ffd8;text-shadow:1px 1px 0 var(--ink);z-index:1}
.cz-shoe i{width:14px;height:18px;border:2px solid var(--ink);border-radius:2px;background:repeating-linear-gradient(45deg,#d8382c 0 3px,#a8241c 3px 6px);transform:skewX(-10deg)}
/* cards */
.cz-card{width:var(--cw);height:calc(var(--cw)*1.4);perspective:520px;flex:none;position:relative}
.cz-in{position:absolute;inset:0;transform-style:preserve-3d;-webkit-transform-style:preserve-3d}
.cz-f,.cz-b{position:absolute;inset:0;border:2px solid var(--ink);border-radius:6px;backface-visibility:hidden;-webkit-backface-visibility:hidden;box-shadow:2px 2px 0 rgba(18,12,16,.55)}
.cz-f{background:linear-gradient(160deg,#fffef8,#f3ead2);color:#1a1418;font-family:${FONT};font-weight:900}
.cz-card.red .cz-f{color:#e0302a}
.cz-f .r{position:absolute;left:3px;top:2px;font-size:calc(var(--cw)*.3);line-height:.95;text-align:center;letter-spacing:-1px}
.cz-f .r small{display:block;font-size:calc(var(--cw)*.24);letter-spacing:0}
.cz-f .r2{left:auto;top:auto;right:3px;bottom:2px;transform:rotate(180deg)}
.cz-f .pip{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);font-size:calc(var(--cw)*.56);line-height:1}
.cz-b{transform:rotateY(180deg);background:radial-gradient(circle at 50% 50%,#ffc928 0 14%,transparent 15%),repeating-linear-gradient(45deg,#d8382c 0 5px,#ae241c 5px 10px);box-shadow:inset 0 0 0 3px #fff6e2,2px 2px 0 rgba(18,12,16,.55)}
.cz-card.down .cz-in{transform:rotateY(180deg)}
.cz-card.deal{animation:czdeal .34s cubic-bezier(.22,.9,.35,1.12) both}
.cz-card.flip .cz-in{animation:czflip .5s ease-out both}
@keyframes czdeal{from{transform:translate(90px,-110px) rotate(-28deg) scale(.7);opacity:0}to{transform:none;opacity:1}}
@keyframes czflip{from{transform:rotateY(180deg)}to{transform:rotateY(0deg)}}
@keyframes czpulse{to{opacity:.45}}
/* result banner */
.cz-res{position:absolute;left:50%;top:50%;z-index:5;pointer-events:none;text-align:center;white-space:nowrap;animation:czpop .5s cubic-bezier(.2,1.5,.4,1) both,czsideR .7s cubic-bezier(.5,0,.3,1) 1.7s forwards;transform:translate(-50%,-50%) rotate(-4deg)}
.cz-stage .cz-res{animation:czpop .5s cubic-bezier(.2,1.5,.4,1) both,czsideL .7s cubic-bezier(.5,0,.3,1) 1.9s forwards}
.cz-res b{display:block;font-size:38px;line-height:1;font-weight:900;font-style:italic;letter-spacing:2px;color:var(--amber);-webkit-text-stroke:2px var(--ink);text-shadow:4px 4px 0 var(--ink)}
.cz-res small{display:inline-block;margin-top:6px;background:#fff6dc;color:var(--ink);border:3px solid var(--ink);border-radius:5px;box-shadow:3px 3px 0 var(--ink);font-size:15px;font-weight:900;padding:1px 10px}
.cz-res.win b{color:#8fe85a}.cz-res.lose b{color:#ff5a48}.cz-res.push b{color:#fff6e2}.cz-res.bj b{color:var(--amber);font-size:42px}
.cz-res.win small,.cz-res.bj small{background:#8fe85a}
@keyframes czpop{0%{opacity:0;transform:translate(-50%,-50%) scale(.2) rotate(-16deg)}100%{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(-4deg)}}
@keyframes czsideR{from{left:50%;transform:translate(-50%,-50%) scale(1) rotate(-4deg)}to{left:calc(100% - 14px);transform:translate(-100%,-50%) scale(.62) rotate(-4deg)}}
@keyframes czsideL{from{left:50%;transform:translate(-50%,-50%) scale(1) rotate(-4deg)}to{left:30px;transform:translate(0,-50%) scale(.66) rotate(-4deg)}}
/* duck race */
.cz-stage{position:relative;border:3px solid var(--ink);border-radius:8px;box-shadow:4px 4px 0 var(--ink);overflow:hidden;background:#7a4524}
.cz-stage canvas{display:block;width:100%;height:auto;aspect-ratio:4/3;max-height:52vh;touch-action:pan-y}
@media (orientation:landscape){.cz-stage canvas{aspect-ratio:16/11}}
@media (orientation:landscape) and (min-width:600px) and (max-height:500px){.cz-stage canvas{aspect-ratio:auto;height:calc(100vh - 84px - var(--sat) - var(--sab));max-height:330px;min-height:190px}}
.cz-stage .cz-res b{font-size:32px}
.cz-ducks{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px}
button.cz-duck{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:2px 0 1px;min-height:60px;font-size:9.5px;line-height:1.05;letter-spacing:-.2px;overflow:hidden;border-bottom-width:5px;position:relative}
button.cz-duck img{width:34px;height:27px;image-rendering:auto;pointer-events:none}
button.cz-duck span{max-width:100%;max-height:2.1em;overflow:hidden;font-weight:800;text-align:center;overflow-wrap:normal}
button.cz-duck b{font-size:14.5px;line-height:1.05}
button.cz-duck::before{content:"";position:absolute;left:0;right:0;top:0;height:4px;background:var(--c)}
button.cz-duck.on{background:var(--amber);color:var(--ink);box-shadow:0 0 0 2px var(--amber),2px 2px 0 var(--ink)}
button.cz-duck.fav::after{content:"FAV";position:absolute;right:1px;top:5px;font-size:7.5px;font-weight:900;background:var(--ink);color:var(--amber);border-radius:2px;padding:0 2px;letter-spacing:.3px}
button.cz-duck:disabled{opacity:.6}button.cz-duck.on:disabled{opacity:1}
.cz-hist{display:flex;align-items:center;gap:3px;font-size:10.5px;color:var(--dim);font-weight:800;letter-spacing:.8px;text-transform:uppercase}
.cz-hist span{margin-right:4px}.cz-hist img{width:28px;height:23px;image-rendering:auto}
@media (max-height:430px){
  .cz-side{gap:6px}.cz-acts button{min-height:46px;font-size:16px}button.cz-duck{min-height:54px}button.cz-duck img{width:30px;height:24px}
  .cz-rules{font-size:10.5px;line-height:1.25}.cz-res b{font-size:32px}.cz-felt{min-height:calc(var(--cw)*2.8 + 84px);padding:8px 8px 18px}
}
`;
function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('casino-css')) return;
  const s = document.createElement('style'); s.id = 'casino-css'; s.textContent = CSS; document.head.appendChild(s);
}

// ============================================================================
// 3D PROPS — metres, Y up, origin on the floor at the footprint centre.
// Static parts are baked once (M.bake) and cloned; animated parts stay apart.
//   blackjack table: long side along X; players at +Z (curved edge), dealer at -Z
//   duck track: viewed from -Z; ducks race from +X (start) to -X (finish), so
//               they run left -> right like the 2D race; lane 1 is the far lane (+Z)
//   sign: faces -Z, 4.6 m along X; origin at the bottom edge of the board
// ============================================================================
export const BLACKJACK_INFO = { w: 2.6, d: 1.4, h: 0.95, colliders: [[0, 0, 2.6, 1.4, 0.95], [0, -1.0, 0.7, 0.45, 1.75]] };
export const DUCK_TRACK_INFO = { w: 8, d: 2.2, h: 1.0, colliders: [[0, 0, 8, 2.2, 1.0]] };
export const SIGN_INFO = { w: 4.6, d: 0.3, h: 1.2 };
const C = hex => M.mat(hex);
const _baked = {};
function baked(key, build) { if (!_baked[key]) { const g = new THREE.Group(); build(g); _baked[key] = M.bake(g); } return _baked[key].clone(); }
function bb(p, m, w, hh, d, x, y0, z, o) { return M.add(p, M.box(w, hh, d), m, x, y0 + hh / 2, z, o); }
function cv(p, m, r, hh, x, y0, z, seg = 12, o) { return M.add(p, M.cyl(r, r, hh, seg), m, x, y0 + hh / 2, z, o); }
const _up = new THREE.Vector3(0, 1, 0);
function rod(p, m, r, a, b, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const me = M.add(p, M.cyl(r, r, 1, seg), m); me.position.copy(A).add(B).multiplyScalar(0.5); me.quaternion.setFromUnitVectors(_up, d.normalize()); me.scale.y = L; return me;
}
function canvasTex(w, hh, paint) {
  const c = document.createElement('canvas'); c.width = w; c.height = hh; paint(c.getContext('2d'), w, hh);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** plane (facing +Z) showing the canvas pixel rect (x0,y0)-(x1,y1) of a W x H atlas */
function planeRect(w, hh, x0, y0, x1, y1, W, H) {
  const g = new THREE.PlaneGeometry(w, hh), uv = g.attributes.uv, u0 = x0 / W, u1 = x1 / W, vb = 1 - y1 / H, vt = 1 - y0 / H;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), vb + uv.getY(i) * (vt - vb));
  return g;
}
function arcText(g, str, cx, cy, r, font, fill, spread) { // text along a circle, reading left to right on its lower side
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...str], ws = chars.map(ch => g.measureText(ch).width), tot = ws.reduce((a, b) => a + b, 0) * spread;
  let a = -tot / 2 / r;
  chars.forEach((ch, i) => { const w = ws[i] * spread / r; a += w / 2; g.save(); g.translate(cx + r * Math.sin(a), cy + r * Math.cos(a)); g.rotate(-a); g.fillStyle = fill; g.fillText(ch, 0, 0); g.restore(); a += w / 2; });
}

// ---------------------------------------------------------------- blackjack table
// footprint: X -1.3..1.3, Z -0.7..0.7 (table), dealer standing at z = -1.0
const TBL = { hx: 1.3, z0: -0.7, rz: 1.4, top: 0.88 };
function tableShape(inset = 0) { // D shape in shape coords (X, -Z): straight dealer edge at z0, curved player edge
  const s = new THREE.Shape(), a = TBL.hx - inset, b = TBL.rz - inset, z0 = TBL.z0 + inset * 0.5, N = 40;
  for (let k = 0; k <= N; k++) { const th = -PI / 2 + PI * k / N, x = a * Math.sin(th), z = Math.max(z0, TBL.z0 + b * Math.cos(th)); if (k === 0) s.moveTo(x, -z); else s.lineTo(x, -z); }
  s.closePath(); return s;
}
const SEATS = [-0.82, 0, 0.82], seat = (th, f) => [TBL.hx * f * Math.sin(th), TBL.z0 + TBL.rz * f * Math.cos(th)];
const feltUV = (x, z) => [(x + TBL.hx) / (2 * TBL.hx), 1 - (z - TBL.z0) / TBL.rz]; // canvas 1024 x 512: the felt is a half-disc r 512 round (512, 0)
function feltCanvas(g, W, H) {
  const gr = g.createRadialGradient(512, 120, 40, 512, 120, 560); gr.addColorStop(0, '#46c66e'); gr.addColorStop(0.6, '#259a4e'); gr.addColorStop(1, '#17733a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,236,160,.85)'; g.lineWidth = 5; g.beginPath(); g.arc(512, 0, 474, 0.05, PI - 0.05); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.arc(512, 0, 244, 0.5, PI - 0.5); g.stroke();
  arcText(g, 'BLACKJACK PAYS 3 TO 2', 512, 0, 280, `900 italic 40px ${FONT}`, '#ffd23a', 1.08);
  arcText(g, 'DEALER STANDS ON ALL 17s', 512, 0, 212, `800 24px ${FONT}`, 'rgba(255,246,226,.9)', 1.2);
  for (const th of SEATS) { // betting circles
    const [u, v] = feltUV(...seat(th, 0.8)), x = u * W, y = (1 - v) * H;
    g.strokeStyle = '#fff6e2'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 46, 0, TAU); g.stroke();
    g.strokeStyle = '#ffd23a'; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 37, 0, TAU); g.stroke();
  }
  drawDuck(g, 508, 168, 56, DUCKS[0]); // house logo
}
let _feltMat = null, _cardMat = null;
function feltMat() { return _feltMat || (_feltMat = new THREE.MeshLambertMaterial({ map: canvasTex(1024, 512, feltCanvas) })); }
const CARD_CELLS = [['A', 0], ['K', 1], ['10', 2], ['7', 3], ['J', 1], ['back']];
function cardMat() {
  return _cardMat || (_cardMat = new THREE.MeshLambertMaterial({
    map: canvasTex(768, 192, (g) => {
      CARD_CELLS.forEach(([rk, s], k) => {
        const x = k * 128 + 6, y = 6, w = 116, hh = 168; g.fillStyle = rk === 'back' ? '#c8302a' : '#fffaf0'; g.fillRect(x, y, w, hh);
        g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, w - 6, hh - 6);
        if (rk === 'back') { g.strokeStyle = '#fff6e2'; g.lineWidth = 4; g.strokeRect(x + 14, y + 14, w - 28, hh - 28); g.fillStyle = '#ffc928'; g.beginPath(); g.arc(x + w / 2, y + hh / 2, 22, 0, TAU); g.fill(); return; }
        g.fillStyle = s === 1 || s === 2 ? '#e0302a' : '#1a1418'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `900 42px ${FONT}`; g.fillText(rk, x + 26, y + 28); g.font = `900 30px ${FONT}`; g.fillText(SUITS[s], x + 26, y + 60);
        g.font = `900 78px ${FONT}`; g.fillText(SUITS[s], x + w / 2, y + hh / 2 + 18);
      });
    }),
  }));
}
function cardGeo(k) { const g = planeRect(0.1, 0.145, k * 128 + 6, 6, k * 128 + 122, 174, 768, 192); g.rotateX(-PI / 2); return g; }
function chipStack(g, x, z, n, cols, y0) { for (let i = 0; i < n; i++) cv(g, C(cols[i % cols.length]), 0.026, 0.0075, x, y0 + i * 0.0078, z, 14); }
function buildTable(g) {
  const wood = C('#8e4a22'), woodDk = C('#5a2c14'), rim = C('#2a1a20'), brass = C('#ffc928'), feltSide = C('#1c7a3e');
  // pedestal + feet
  for (const x of [-0.75, 0.75]) { cv(g, woodDk, 0.11, 0.72, x, 0.04, -0.2, 12); bb(g, wood, 0.5, 0.06, 0.6, x, 0, -0.2); }
  bb(g, woodDk, 1.6, 0.08, 0.12, 0, 0.12, -0.2);
  rod(g, brass, 0.022, [-0.8, 0.18, 0.22], [0.8, 0.18, 0.22], 8); // brass foot rail
  for (const x of [-0.8, 0.8]) rod(g, brass, 0.02, [x, 0.04, 0.22], [x, 0.18, 0.22], 6);
  // body (apron) + felt slab
  const ex = (inset, depth, y, m) => { const geo = new THREE.ExtrudeGeometry(tableShape(inset), { depth, bevelEnabled: false, curveSegments: 4 }); geo.rotateX(-PI / 2); geo.translate(0, y, 0); return M.add(g, geo, m); };
  ex(0.04, 0.12, 0.74, wood); ex(0.0, 0.02, 0.86, feltSide);
  const top = new THREE.ShapeGeometry(tableShape(0.0)); top.rotateX(-PI / 2); top.translate(0, TBL.top + 0.001, 0);
  { const pos = top.attributes.position, uv = top.attributes.uv; for (let i = 0; i < pos.count; i++) { const [u, v] = feltUV(pos.getX(i), pos.getZ(i)); uv.setXY(i, u, v); } }
  M.add(g, top, feltMat(), 0, 0, 0, { cast: false });
  // padded rim around the curved edge
  const pts = []; for (let k = 0; k <= 48; k++) { const th = -PI / 2 + PI * k / 48; pts.push(new THREE.Vector3(TBL.hx * Math.sin(th), TBL.top + 0.012, TBL.z0 + TBL.rz * Math.cos(th))); }
  M.add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.065, 8, false), rim);
  for (const s of [-1, 1]) M.add(g, M.sphere(0.065, 10, 8), rim, s * TBL.hx, TBL.top + 0.012, TBL.z0);
  bb(g, woodDk, 2.64, 0.06, 0.08, 0, TBL.top - 0.04, TBL.z0 - 0.02); // dealer-side lip
  // dealer's chip rack (sunk into the felt) + chips lying in the rows
  bb(g, woodDk, 0.8, 0.05, 0.18, 0, TBL.top - 0.02, -0.56);
  ['#e2433a', '#2f7fd8', '#33a84a', '#2a2236', '#ff8a1e', '#a874ff', '#e2433a', '#33a84a'].forEach((col, i) => M.add(g, M.cyl(0.024, 0.024, 0.14, 12), C(col), -0.35 + i * 0.1, TBL.top + 0.03, -0.56, { rx: PI / 2 }));
  // card shoe on the dealer's left (+X) and discard tray on the right (-X)
  bb(g, C('#2a1a20'), 0.2, 0.1, 0.16, 0.95, TBL.top, -0.48);
  M.add(g, M.box(0.2, 0.012, 0.16), C('#2a1a20'), 0.95, TBL.top + 0.105, -0.41, { rx: -0.45 });
  bb(g, C('#fff6e2'), 0.17, 0.07, 0.12, 0.95, TBL.top + 0.02, -0.49);
  bb(g, C('#c8302a'), 0.12, 0.004, 0.02, 0.95, TBL.top + 0.09, -0.4); // the next card peeking out
  bb(g, C('#3a6ea8'), 0.16, 0.06, 0.2, -0.95, TBL.top, -0.5); bb(g, C('#fff6e2'), 0.12, 0.03, 0.15, -0.95, TBL.top + 0.04, -0.5);
  // cards in play
  const cm = cardMat(), card = (k, x, z, ry, y = 0) => M.add(g, cardGeo(k), cm, x, TBL.top + 0.003 + y, z, { ry, cast: false });
  card(5, -0.06, -0.36, 0.06); card(2, 0.06, -0.35, -0.05, 0.002); // dealer: hole card + a 10
  { const [x, z] = seat(0, 0.64); card(0, x - 0.045, z, 0.12); card(1, x + 0.045, z + 0.01, -0.1, 0.002); } // blackjack in the middle seat
  { const [x, z] = seat(0.82, 0.62); card(3, x - 0.04, z, 0.82 + 0.1); card(4, x + 0.03, z + 0.03, 0.82 - 0.12, 0.002); }
  // bets on the circles
  const S = SEATS.map(th => seat(th, 0.8));
  chipStack(g, S[0][0], S[0][1], 5, ['#e2433a', '#fff6e2'], TBL.top); chipStack(g, S[1][0] - 0.03, S[1][1], 7, ['#33a84a', '#2a2236'], TBL.top);
  chipStack(g, S[1][0] + 0.035, S[1][1] + 0.02, 3, ['#ff8a1e'], TBL.top); chipStack(g, S[2][0], S[2][1], 4, ['#2f7fd8'], TBL.top);
  buildDealer(g, 0, -1.0);
}
function buildDealer(g, x, z) { // faces +Z, hands resting on the table edge
  const shirt = C('#fff6e2'), vest = C('#b8262e'), pants = C('#2a2236'), skin = C('#e6bc98'), hair = C('#5a3420'), visor = C('#3fbf5a'), tie = C('#ffc928'), shoe = C('#1a1418');
  for (const s of [-1, 1]) { bb(g, pants, 0.15, 0.82, 0.16, x + s * 0.1, 0.04, z); bb(g, shoe, 0.15, 0.06, 0.24, x + s * 0.1, 0, z + 0.03); }
  bb(g, pants, 0.4, 0.14, 0.24, x, 0.82, z);
  bb(g, shirt, 0.42, 0.5, 0.24, x, 0.92, z);
  for (const s of [-1, 1]) bb(g, vest, 0.16, 0.44, 0.03, x + s * 0.12, 0.94, z + 0.12);
  bb(g, vest, 0.44, 0.46, 0.18, x, 0.93, z - 0.04);
  M.add(g, M.box(0.08, 0.05, 0.03), tie, x - 0.045, 1.37, z + 0.135, { rz: 0.4 }); M.add(g, M.box(0.08, 0.05, 0.03), tie, x + 0.045, 1.37, z + 0.135, { rz: -0.4 });
  for (const s of [-1, 1]) { // arms: shoulder -> elbow -> hand on the rail
    const sh = [x + s * 0.24, 1.36, z], el = [x + s * 0.33, 1.07, z + 0.12], hd = [x + s * 0.5, TBL.top + 0.06, TBL.z0 + 0.1];
    rod(g, shirt, 0.055, sh, el, 8); rod(g, shirt, 0.05, el, hd, 8); M.add(g, M.sphere(0.05, 8, 6), skin, ...hd);
    M.add(g, M.sphere(0.065, 8, 6), vest, ...sh);
  }
  cv(g, skin, 0.055, 0.08, x, 1.4, z, 8);
  M.add(g, M.sphere(0.125, 14, 10), skin, x, 1.6, z, { sy: 1.08 });
  M.add(g, new THREE.SphereGeometry(0.13, 14, 8, 0, TAU, 0, PI * 0.5), hair, x, 1.62, z - 0.01);
  for (const s of [-1, 1]) { M.add(g, M.sphere(0.018, 6, 5), C(INK), x + s * 0.045, 1.62, z + 0.115); M.add(g, M.sphere(0.03, 6, 5), skin, x + s * 0.125, 1.6, z); }
  M.add(g, M.sphere(0.024, 6, 5), C('#d89a78'), x, 1.585, z + 0.13);
  M.add(g, M.box(0.08, 0.012, 0.02), C('#7a2a2a'), x, 1.54, z + 0.118);
  M.add(g, M.cyl(0.135, 0.135, 0.035, 14), visor, x, 1.69, z); // eyeshade band
  M.add(g, new THREE.CylinderGeometry(0.17, 0.17, 0.012, 16, 1, false, -PI * 0.42, PI * 0.84), visor, x, 1.685, z + 0.02, { rx: 0.18 });
}
/** blackjack table + chips, cards, shoe and a dealer (one baked Group; players at +Z, dealer at z = -1.0) */
export function makeBlackjackTable() { const g = baked('table', buildTable); g.name = 'blackjack_table'; g.userData.info = BLACKJACK_INFO; return g; }

// ---------------------------------------------------------------- duck track
const TRK = { xs: 3.3, xf: -3.3, water: 0.9, lanes: DUCKS.map((_, i) => 0.8 - 0.4 * i), board: { x: -3.2, y: 2.12, w: 1.6, h: 0.8 }, lamp: i => 0.28 * (2 - i) };
function trackAtlas(g, W, H) {
  const banner = (y, txt, check) => {
    g.fillStyle = '#fff6e2'; g.fillRect(0, y, W, 128); g.fillStyle = INK; g.fillRect(0, y, W, 10); g.fillRect(0, y + 118, W, 10);
    if (check) for (let k = 0; k < 32; k++) for (let r = 0; r < 2; r++) if ((k + r) % 2) g.fillRect(k * 32, y + 10 + r * 54, 32, 54);
    g.font = `900 italic 86px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tw = g.measureText(txt).width + 60; if (check) { g.fillStyle = '#fff6e2'; g.fillRect(W / 2 - tw / 2, y + 14, tw, 100); g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(W / 2 - tw / 2, y + 14, tw, 100); }
    g.lineWidth = 12; g.strokeStyle = INK; g.lineJoin = 'round'; g.strokeText(txt, W / 2, y + 66); g.fillStyle = check ? '#ff4a3a' : '#86e64a'; g.fillText(txt, W / 2, y + 66);
  };
  banner(0, 'START', false); banner(128, 'FINISH', true);
  for (const [ox, order] of [[0, [0, 1, 2, 3, 4]], [512, [4, 3, 2, 1, 0]]]) { // scoreboard: front (seen from -Z) and back (from +Z)
    const y = 256; g.fillStyle = '#2a1d4a'; g.fillRect(ox, y, 512, 256); g.strokeStyle = '#ffc928'; g.lineWidth = 8; g.strokeRect(ox + 8, y + 8, 496, 240);
    g.font = `900 italic 54px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 9; g.strokeStyle = INK; g.strokeText('DUCK DERBY', ox + 256, y + 46); g.fillStyle = '#ffc928'; g.fillText('DUCK DERBY', ox + 256, y + 46);
    order.forEach((d, k) => {
      const cx = ox + 256 + (k - 2) * 89.6; drawDuck(g, cx - 4, y + 140, 56, DUCKS[d]);
      g.font = `900 30px ${FONT}`; g.lineWidth = 6; g.strokeText(String(d + 1), cx, y + 180); g.fillStyle = '#fff'; g.fillText(String(d + 1), cx, y + 180);
      g.fillStyle = INK; g.beginPath(); g.arc(cx, y + 218, 22, 0, TAU); g.fill();
    });
  }
}
let _trackMat = null, _waterMat = null;
function trackMat() { return _trackMat || (_trackMat = new THREE.MeshLambertMaterial({ map: canvasTex(1024, 512, trackAtlas) })); }
function waterMat() {
  if (_waterMat) return _waterMat;
  const t = M.texture('water').clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 1.4);
  return (_waterMat = new THREE.MeshLambertMaterial({ color: '#46cdf4', map: t, emissive: new THREE.Color('#0a4a6a'), emissiveIntensity: 0.35 }));
}
function buildTrack(g) {
  const red = C('#e2433a'), white = C('#fff6e2'), amber = C('#ffc928'), wood = C('#7a4524'), dark = C('#3a2216'), floatR = C('#ff4a3a');
  for (const x of [-3.75, -1.25, 1.25, 3.75]) for (const z of [-0.95, 0.95]) bb(g, wood, 0.14, 0.58, 0.14, x, 0, z);
  for (const z of [-0.95, 0.95]) bb(g, wood, 7.6, 0.08, 0.08, 0, 0.16, z);
  bb(g, dark, 8, 0.06, 2.2, 0, 0.53, 0);
  for (const s of [-1, 1]) { bb(g, red, 8, 0.4, 0.1, 0, 0.56, s * 1.05); bb(g, red, 0.1, 0.4, 2.0, s * 3.95, 0.56, 0); }
  for (const s of [-1, 1]) { bb(g, white, 8.04, 0.04, 0.16, 0, 0.96, s * 1.05); bb(g, white, 0.16, 0.04, 2.0, s * 3.95, 0.96, 0); }
  for (const s of [-1, 1]) { bb(g, amber, 8.0, 0.07, 0.012, 0, 0.72, s * 1.106); bb(g, amber, 0.012, 0.07, 2.2, s * 4.006, 0.72, 0); bb(g, white, 8.0, 0.03, 0.012, 0, 0.82, s * 1.106); }
  bb(g, dark, 7.8, 0.3, 2.0, 0, 0.59, 0); // fills the tub under the water
  // lane ropes + floats
  for (let k = 1; k < 5; k++) {
    const z = 1.0 - 0.4 * k; M.add(g, M.cyl(0.01, 0.01, 7.8, 5), white, 0, TRK.water + 0.025, z, { rz: PI / 2 });
    for (let i = 0, x = -3.75; x <= 3.76; x += 0.3, i++) M.add(g, M.cyl(0.032, 0.032, 0.07, 8), i % 2 ? floatR : white, x, TRK.water + 0.025, z, { rz: PI / 2 });
  }
  // start line, checkered finish, lane-colour tabs on both end walls
  bb(g, white, 0.05, 0.006, 2.0, TRK.xs, TRK.water, 0);
  for (let i = 0; i < 10; i++) for (let r = 0; r < 2; r++) bb(g, (i + r) % 2 ? C(INK) : white, 0.1, 0.006, 0.2, TRK.xf - 0.05 - r * 0.1, TRK.water + 0.001, -0.9 + i * 0.2);
  TRK.lanes.forEach((z, i) => { for (const s of [-1, 1]) bb(g, C(DUCKS[i].col), 0.2, 0.05, 0.3, s * 3.95, 1.0, z); });
  // gates: candy-striped posts on the rim, crossbar, double-sided banners
  for (const [gx, row] of [[TRK.xs, 0], [TRK.xf, 128]]) {
    for (const s of [-1, 1]) { for (let k = 0; k < 6; k++) cv(g, k % 2 ? red : white, 0.045, 0.18, gx, 1.0 + k * 0.18, s * 1.05, 10); M.add(g, M.sphere(0.06, 10, 8), amber, gx, 2.1, s * 1.05); }
    bb(g, wood, 0.08, 0.08, 2.2, gx, 1.96, 0);
    for (const ry of [PI / 2, -PI / 2]) M.add(g, planeRect(2.0, 0.25, 0, row, 1024, row + 128, 1024, 512), trackMat(), gx + (ry > 0 ? 0.045 : -0.045), 1.82, 0, { ry });
  }
  // scoreboard above the finish gate (front faces -Z, back +Z)
  const B = TRK.board, by = B.y + B.h / 2;
  bb(g, wood, 0.06, B.y - 2.0, 0.06, TRK.xf, 2.0, 0);
  bb(g, C('#2a1d4a'), B.w + 0.06, B.h + 0.06, 0.05, B.x, B.y - 0.03, 0);
  M.add(g, planeRect(B.w, B.h, 0, 256, 512, 512, 1024, 512), trackMat(), B.x, by, -0.027, { ry: PI });
  M.add(g, planeRect(B.w, B.h, 512, 256, 1024, 512, 1024, 512), trackMat(), B.x, by, 0.027);
}
function buildDuck(g, D) { // faces +X, origin at the water line, bill tip at x = 0.19
  const body = C(D.col), bill = C('#ff8a1e'), ink = C(INK), white = C('#fff6e2');
  M.add(g, M.sphere(0.1, 14, 10), body, 0, 0.03, 0, { sx: 1.45, sy: 0.85, sz: 1.0 });
  M.add(g, M.cone(0.055, 0.12, 8), body, -0.13, 0.085, 0, { rz: 0.85 });
  M.add(g, M.sphere(0.068, 12, 10), body, 0.075, 0.15, 0);
  M.add(g, M.sphere(0.04, 10, 6), bill, 0.145, 0.135, 0, { sx: 1.2, sy: 0.42, sz: 1.0 });
  for (const s of [-1, 1]) {
    M.add(g, M.sphere(0.021, 8, 6), white, 0.112, 0.172, s * 0.04); M.add(g, M.sphere(0.012, 6, 5), ink, 0.122, 0.175, s * 0.052);
    M.add(g, M.sphere(0.05, 10, 6), C('#' + new THREE.Color(D.col).multiplyScalar(0.85).getHexString()), -0.01, 0.05, s * 0.088, { sx: 1.4, sy: 0.6, sz: 0.35 });
  }
  if (D.acc === 'hat') { cv(g, ink, 0.07, 0.012, 0.07, 0.205, 0, 12); cv(g, ink, 0.042, 0.07, 0.07, 0.215, 0, 12); cv(g, C('#e2433a'), 0.043, 0.015, 0.07, 0.218, 0, 12); }
  else if (D.acc === 'bow') for (const s of [-1, 1]) M.add(g, M.cone(0.025, 0.05, 6), C('#36d2ff'), 0.02, 0.2, s * 0.03, { rx: s * PI / 2 });
  else if (D.acc === 'goggles') { M.add(g, M.cyl(0.071, 0.071, 0.025, 12), C('#2a2236'), 0.075, 0.16, 0, { rz: -0.15 }); M.add(g, M.cyl(0.024, 0.024, 0.02, 10), C('#9cf0ff'), 0.13, 0.19, 0, { rz: PI / 2 - 0.4 }); }
  else if (D.acc === 'ring') M.add(g, new THREE.TorusGeometry(0.05, 0.011, 6, 14), white, 0.07, 0.095, 0, { rx: PI / 2 });
  else if (D.acc === 'clover') for (const [a, b] of [[0.015, 0], [-0.015, 0], [0, 0.015], [0, -0.015]]) M.add(g, M.sphere(0.017, 6, 5), C('#3fbf4a'), 0.06 + a, 0.222, b);
}
/** a single rubber duck (lane i colours), baked; faces +X */
export function makeDuck(i) { return baked('duck' + i, g => buildDuck(g, DUCKS[i])); }
/**
 * Raised 8 x 2.2 m water trough with five lanes, gates, a scoreboard and five
 * ducks. Returns { root, ducks, setProgress([p0..p4]), reset(), tick(t) }.
 * setProgress: 0 = start line, 1 = nose on the finish line (call every frame).
 */
export function makeDuckTrack() {
  const root = new THREE.Group(); root.name = 'duck_track';
  root.add(baked('track', buildTrack));
  const water = M.add(root, new THREE.PlaneGeometry(7.8, 2.0), waterMat(), 0, TRK.water, 0, { rx: -PI / 2, cast: false });
  const lamps = DUCKS.map((D, i) => {
    const on = new THREE.Color(D.col), off = on.clone().multiplyScalar(0.28), m = new THREE.MeshBasicMaterial({ color: off.clone() });
    const mesh = M.add(root, M.sphere(0.055, 10, 8), m, TRK.board.x + TRK.lamp(i), TRK.board.y + TRK.board.h * (1 - 218 / 256), 0, { cast: false });
    return { m, on, off, mesh };
  });
  const ducks = DUCKS.map((D, i) => { const d = makeDuck(i); d.rotation.y = PI; root.add(d); return d; });
  const prog = DUCKS.map(() => 0); let first = -1, moving = false;
  const t0 = () => performance.now() / 1000;
  function place(t) {
    for (let i = 0; i < ducks.length; i++) {
      const d = ducks[i], p = prog[i], sp = moving ? 1 : 0.4;
      d.position.set(TRK.xs + (TRK.xf - TRK.xs) * p + 0.19, TRK.water + Math.sin(t * 5.2 + i * 1.9) * 0.012 * sp, TRK.lanes[i]);
      d.rotation.z = Math.sin(t * 4.1 + i * 1.3) * 0.05 * sp; d.rotation.x = Math.sin(t * 3.3 + i) * 0.04 * sp;
    }
    let L = 0; for (let i = 1; i < prog.length; i++) if (prog[i] > prog[L]) L = i;
    const blink = Math.floor(t * 5) % 2 === 0;
    lamps.forEach((l, i) => l.m.color.copy(first >= 0 ? (i === first && blink ? l.on : l.off) : moving && i === L ? l.on : l.off));
    water.material.map.offset.x = -t * 0.06;
  }
  const api = {
    root, ducks,
    setProgress(arr) {
      for (let i = 0; i < prog.length; i++) { prog[i] = clamp01(+arr[i] || 0); if (first < 0 && prog[i] >= 1) first = i; }
      moving = true; place(t0());
    },
    reset() { prog.fill(0); first = -1; moving = false; place(t0()); },
    tick(t = t0()) { place(t); }, // optional idle bob from the game loop
  };
  root.userData.track = api; root.userData.tick = api.tick; root.userData.info = DUCK_TRACK_INFO;
  api.reset();
  return api;
}

// ---------------------------------------------------------------- neon sign
const SIGN = { w: 4.6, h: 1.2, border: 0.14, d: 0.12 };
let _signMat = null; const _bulbs = [];
function signCanvas(g, W, H) {
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#46206a'); gr.addColorStop(1, '#1e0e33'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const cx = 118, cy = H / 2 + 4; // starburst behind the duck
  for (let k = 0; k < 16; k++) { g.fillStyle = k % 2 ? '#ff8a1e' : '#ffc928'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 150, k * TAU / 16, (k + 1) * TAU / 16); g.closePath(); g.fill(); }
  g.fillStyle = '#46206a'; g.beginPath(); g.arc(cx, cy, 84, 0, TAU); g.fill(); g.strokeStyle = INK; g.lineWidth = 6; g.stroke();
  drawDuck(g, cx - 6, cy + 24, 118, DUCKS[0]);
  for (const [x, y, r] of [[206, 36, 9], [36, 50, 7], [214, 176, 7], [30, 186, 6]]) { g.fillStyle = '#fff6e2'; g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * PI / 4, rr = k % 2 ? r * 0.35 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); }
  const tx = 640; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.font = `900 italic 112px ${FONT}`; const sw = Math.min(1, 700 / g.measureText('LUCKY DUCK').width);
  g.save(); g.translate(tx, 86); g.scale(sw, 1);
  g.fillStyle = INK; g.fillText('LUCKY DUCK', 7, 7); g.lineWidth = 14; g.strokeStyle = INK; g.strokeText('LUCKY DUCK', 0, 0);
  const tg = g.createLinearGradient(0, -50, 0, 50); tg.addColorStop(0, '#fff2a0'); tg.addColorStop(0.5, '#ffc928'); tg.addColorStop(1, '#ff8a1e'); g.fillStyle = tg; g.fillText('LUCKY DUCK', 0, 0);
  g.restore();
  g.font = `900 58px ${FONT}`; const word = 'C A S I N O';
  g.lineWidth = 10; g.strokeStyle = INK; g.strokeText(word, tx, 176); g.fillStyle = '#36d2ff'; g.fillText(word, tx, 176);
  g.font = `900 46px ${FONT}`;
  [['♠', 370, INK], ['♥', 430, '#ff4a3a'], ['♦', 850, '#ff4a3a'], ['♣', 910, INK]].forEach(([s, x, col]) => { g.lineWidth = 6; g.strokeStyle = col === INK ? '#fff6e2' : INK; g.strokeText(s, x, 176); g.fillStyle = col; g.fillText(s, x, 176); });
}
function signMat() { return _signMat || (_signMat = new THREE.MeshBasicMaterial({ map: canvasTex(1024, 224, signCanvas) })); }
function bulbMats() {
  if (!_bulbs.length) for (const c of ['#fff3b0', '#ffb43a']) _bulbs.push(new THREE.MeshBasicMaterial({ color: c }));
  return _bulbs;
}
function buildSign(g) {
  const { w, h: hh, border: b, d } = SIGN, back = C('#7a1820'), gold = C('#ffc928'), dark = C('#2a1d24');
  bb(g, back, w, hh, d, 0, 0, 0); // board box: back face at z = +d/2, front at -d/2
  for (const s of [-1, 1]) { bb(g, gold, w, b, 0.03, 0, s > 0 ? hh - b : 0, -d / 2 - 0.015); bb(g, gold, b, hh - 2 * b, 0.03, s * (w / 2 - b / 2), b, -d / 2 - 0.015); }
  M.add(g, new THREE.PlaneGeometry(w - 2 * b, hh - 2 * b), signMat(), 0, hh / 2, -d / 2 - 0.002, { ry: PI, cast: false });
  for (const x of [-1.6, 1.6]) { bb(g, dark, 0.08, 0.3, 0.2, x, hh / 2 - 0.15, d / 2 + 0.1); bb(g, dark, 0.2, 0.08, 0.06, x, hh / 2 - 0.04, d / 2 + 0.17); }
  const [A, B] = bulbMats(), geos = [[], []], sph = new THREE.SphereGeometry(0.036, 8, 6); let k = 0;
  const bulb = (x, y) => { const q = sph.clone(); q.translate(x, y, -d / 2 - 0.04); geos[k++ % 2].push(q); };
  const nx = 23, ny = 5, X = w / 2 - b / 2, Y0 = b / 2, Y1 = hh - b / 2;
  for (let i = 0; i <= nx; i++) bulb(-X + 2 * X * i / nx, Y1);
  for (let i = 1; i <= ny; i++) bulb(X, Y1 - (Y1 - Y0) * i / (ny + 1));
  for (let i = nx; i >= 0; i--) bulb(-X + 2 * X * i / nx, Y0);
  for (let i = ny; i >= 1; i--) bulb(-X, Y1 - (Y1 - Y0) * i / (ny + 1));
  for (let j = 0; j < 2; j++) M.add(g, M.mergeGeometries(geos[j], false), j ? B : A, 0, 0, 0, { cast: false });
}
/** "LUCKY DUCK CASINO" marquee: faces -Z, 4.6 x 1.2 m, origin at the bottom centre of the board (brackets reach +Z to the wall). Unlit, so it glows at night. userData.tick(t) chases the bulbs. */
export function makeCasinoSign() {
  const g = baked('sign', buildSign); g.name = 'casino_sign';
  const [A, B] = bulbMats(), hi = new THREE.Color('#fff3b0'), lo = new THREE.Color('#ffb43a');
  g.userData.tick = (t = performance.now() / 1000) => { const on = Math.floor(t * 3) % 2 === 0; A.color.copy(on ? hi : lo); B.color.copy(on ? lo : hi); };
  g.userData.light = new THREE.Vector3(0, SIGN.h * 0.5, -0.9); g.userData.lightColor = '#ffc06a';
  g.userData.info = SIGN_INFO;
  return g;
}
