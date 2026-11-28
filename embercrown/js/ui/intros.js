// System intros (owner I, written by X in the Stage 2 play-test; doc 10.9 "each system introduced the
// first time it matters"). After the coach's opening, each Stage 2 system gets one short card the first
// time it matters in this hold: depth (a migrated Stage 2 hold, E13), research, rooms, animals, the first trader, the Grey Taint, the
// Ember-touched, illness, breaks, fire, a nemesis, the first tier-up and the turn of the seasons.
// A card says what is going on and what to do (two or three lines), with a button that goes there and
// "Got it". Rules: one card at a time, never over a sheet, a panel, a tool, the ledger or a letter; at
// least 20 s between two cards; urgent ones (taint, the Ember-touched, fire, a break) may come during
// the coach's days, the rest wait for it to end. Each intro shows once per device (the player has
// learnt it), kept in localStorage 'ec2.intros' (no save or state change: UI only).
// The new shell (SHELL2; EMBERCROWN-WORLD.md 8.8, G23, step W1.7) adds, on the same card element:
//   - hints by need: one line and "Show me", the first time something happens in this hold (the first night,
//     cavern, flood, visitor, forecast front, foul or smoky air, clash of customs, envoy demand); each shows once
//     per hold ('ec2.hints.<colony id>'), folds away after HINT_MS, may come during the coach, and is listed
//     under Help / Hints (hintsBlock);
//   - the "What is new" deck: up to 3 cards (the world around the hold, the new menus, fronts and air; a card
//     shows only once its system is in the hold) for a hold played before the new shell, once per hold
//     ('ec2.whatsnew.<colony id>'); a hold founded under the new shell starts with every card seen, and
//     queueWhatsNew(id, cards) queues cards again (9.4 part 2 step 8).
// Text: HINT_TEXT and WHATSNEW_TEXT of js/data/text/help.js. UI only: nothing here writes the save or the state.
import { h, onTap, icon, clear } from './kit.js';
import { openDemand, openTrade } from './letters.js';
import { openHelp } from './help.js';
import { openWorld } from './worldui.js';
import { SHELL2_ON } from './peopleui.js';
import { COACH_END_TICK, migratedHold } from './guide.js';
import { COACH_TEXT, HINT_TEXT, WHATSNEW_TEXT } from '../data/text/help.js';
import { LEVELS } from '../data/levels.js';
import { dayOf, phaseOf, TICKS_PER_HOUR } from '../game/core/time.js';
import { fluidRec, FLOW } from '../game/world/fluids.js';
import { visitorsOf } from '../game/colony/visitors.js';
import { def } from '../game/core/content.js';

const KEY = 'ec2.intros';
const living = (s) => s.col.filter((c) => !c.hp.dead);
const done = (s, d) => s.bld.some((b) => b && b.def === d && b.st === 'done');
const tradeVisit = (s) => { const t = s.colony.trade; return t && Array.isArray(t.visits) && t.visits.length ? t.visits[0] : null; };
const firstCol = (s, f) => living(s).find(f) || null;

/** The intros, in priority order: id, title, how, when(s), urgent?, go: { colony | panel | tool | fn(ctx, s) }. */
export const INTROS = Object.freeze([
  // the returning-player card (EMBERCROWN-FORTRESS.md 4.6, 5.4 step 10): a Stage 2 hold migrated at the fortress
  // switch (its Chronicle has the depth line); it links to the coach's level steps (guide.js LEVEL_STEPS)
  { id: 'depth', urgent: true, title: 'Your hold now has depth',
    how: 'The old mountain is real rock above you, and there is a world below. Tap the down arrow under the level chip to look.',
    when: (s) => (s.d || 1) > 1 && Array.isArray(s.chron) && s.chron.some((e) => e && e[2] === 'chron_depth'),
    go: { label: 'Dig a stair', tool: { kind: 'vert', id: 'stairs' } } },
  { id: 'taint', urgent: true, title: 'The Grey Taint',
    how: (s) => `${(firstCol(s, (c) => (c.hp.taint | 0) > 0) || { name: 'Someone' }).name} took a Hollow wound and the grey is in their veins. It grows while they are up and fades in bed, faster near a Banked Hearth. At full taint they turn.`,
    when: (s) => living(s).some((c) => (c.hp.taint | 0) > 0),
    go: { label: 'Show them', fn: (ctx, s) => { const c = firstCol(s, (x) => (x.hp.taint | 0) > 0); if (c) { ctx.centerOn(c.x, c.y); ctx.select({ kind: 'colonist', id: c.id }); } } } },
  { id: 'ember', urgent: true, title: 'Ember-touched',
    how: 'A crafter is seized by the Ember and demands rare materials. Get every one into the stores within five days: they make a named masterwork. Fail, and they break.',
    when: (s) => !!s.colony.ember, go: { label: 'The demand', fn: (ctx) => openDemand(ctx) } },
  { id: 'fire', urgent: true, title: 'Fire',
    how: 'Something is burning. Colonists in the home area drop their work to beat it out. Stone does not burn; keep braziers and forges away from wood.',
    when: (s) => !!(s.colony.world && Array.isArray(s.colony.world.fire) && s.colony.world.fire.length), go: null },
  { id: 'break', urgent: true, title: 'A mental break',
    how: (s) => `${(firstCol(s, (c) => !!c.breakState) || { name: 'Someone' }).name} has broken under the strain. Breaks pass; good meals, joy hours, fine rooms and light keep mood up. The Needs tab shows what weighs on them.`,
    when: (s) => living(s).some((c) => !!c.breakState),
    go: { label: 'Show them', fn: (ctx, s) => { const c = firstCol(s, (x) => !!x.breakState); if (c) { ctx.centerOn(c.x, c.y); ctx.select({ kind: 'colonist', id: c.id }); } } } },
  { id: 'illness', title: 'Illness',
    how: 'Someone is ill. They rest in bed and a doctor tends them while their body fights it. The Grey Cough spreads between people who share a bedroom.',
    when: (s) => living(s).some((c) => !!c.hp.illness), go: { label: 'People', colony: 'People' } },
  { id: 'research', title: 'Research',
    how: 'The study desk is built. A scholar there earns lore toward the tech you pick in Colony > Research. Finding things (ore, a tamed animal) can make a tech cheaper.',
    when: (s) => done(s, 'study'), go: { label: 'Research', colony: 'Research' } },
  { id: 'rooms', title: 'Rooms',
    how: 'Walls, a door and a roof make a room. What is inside sets its role (bedroom, dining hall, workshop); wealth, beauty, space and light set its tier. Fine rooms lift the mood.',
    when: (s) => dayOf(s.tick) >= 4 && s.bld.some((b) => b && (b.def === 'bed' || b.def === 'table') && b.st === 'done'), go: { label: 'Build', panel: 'build' } },
  { id: 'trader', title: 'A trader is here',
    how: 'A caravan stays one day. Trade coins and goods: sell what you make, buy what the hold lacks. Each deal raises goodwill with their faction.',
    when: (s) => !!tradeVisit(s), go: { label: 'Trade', fn: (ctx, s) => { const v = tradeVisit(s); openTrade(ctx, v ? v.id : undefined); } } },
  { id: 'animals', title: 'Animals',
    how: 'Orders > Tame, then tap a wild animal: a herder walks out with food. Tamed animals need a pen (Zones > Pen); hens lay, goats give milk, sheep wool. Orders > Hunt brings meat.',
    when: (s) => dayOf(s.tick) >= 5 && s.anim.some((a) => a && !a.tame && !(a.hp && a.hp.dead)), go: { label: 'Orders', panel: 'orders' } },
  { id: 'nemesis', title: 'A nemesis',
    how: 'A raid leader escaped. It remembers who wounded it and will come back stronger, leading a raid of its kind. Its card is in Menu > Letters.',
    when: (s) => Array.isArray(s.st.nemeses) && s.st.nemeses.length > 0, go: null },
  { id: 'tier', title: 'The hold has grown',
    how: 'A new tier opens a new research era and new buildings, brings caravans and migrants, and bigger raids of new kinds. Colony > Hold shows what the next tier asks.',
    when: (s) => (s.colony.tier | 0) >= 1, go: { label: 'The hold', colony: 'Hold' } },
  { id: 'season', title: 'A new season',
    how: 'Four seasons of ten days: Thaw, Highsun, Ashfall and Deepcold. Crops stop in the cold and Deepcold freezes the unprepared: stock food, wood and warm clothes before it.',
    when: (s) => dayOf(s.tick) >= 10, go: { label: 'Help', fn: (ctx) => openHelp(ctx) } },
]);

// ---- hints by need (8.8) ---------------------------------------------------------------------------------------
const CAVERN_DISC = new Set(LEVELS.filter((l) => l.cavern && l.disc).map((l) => l.disc));
/** Moving water at alert depth, not a river source (as alerts.js reads the fluid set). */
function flooding(s) {
  const r = fluidRec(s), fl = s.L && s.L.fluid;
  if (!r || !fl || !r.act || !r.act.length) return false;
  for (const i of r.act) { const v = fl[i]; if (!(v & 16) && !(v & 8) && (v & 7) >= FLOW.alertDepth) return true; }
  return false;
}
/** A front within the forecast (6.2: weather v2, shown from arrive - 24 h). */
function frontSoon(s) {
  const w = s.colony && s.colony.world && s.colony.world.weather;
  const f = w && w.v >= 2 ? w.front : null;
  return !!(f && typeof f.arrive === 'number' && s.tick >= f.arrive - 24 * TICKS_PER_HOUR);
}
/** Foul or smoky air past the first thought (6.3: smoke or foul > 96 in any cell). */
function airBad(s) {
  const a = (s.rt && s.rt.air) || s.air;
  if (!a) return false;
  const over = (arr) => { if (!arr || typeof arr.length !== 'number') return false; for (let i = 0; i < arr.length; i++) if (arr[i] > 96) return true; return false; };
  if (a.smoke || a.foul) return over(a.smoke) || over(a.foul);
  // packed: 3 values per cell (smoke, foul, gas)
  if (typeof a.length === 'number') { for (let i = 0; i + 1 < a.length; i += 3) if (a[i] > 96 || a[i + 1] > 96) return true; }
  return false;
}
const hasDef = (k, id) => { try { return !!def(k, id); } catch (_) { return false; } };
const firstBuilt = (s, d) => s.bld.find((b) => b && b.def === d) || null;
/** The hints, in priority order: id, when(s), go: { tool | fn(ctx, s) } | null. Text: HINT_TEXT.rows[id]. */
export const HINTS = Object.freeze([
  { id: 'night', when: (s) => phaseOf(s.tick) === 'night',
    go: { fn: (ctx, s) => { const hr = s.colony.hearth, b = hr && hr.id !== null && hr.id !== undefined ? s.bld[hr.id] : firstBuilt(s, 'hearth'); if (b) { ctx.centerOn(b.x + 1, b.y + 1); ctx.select({ kind: 'building', id: b.id, x: b.x, y: b.y }); } } } },
  { id: 'cavern', when: (s) => { const d = s.colony.world && s.colony.world.disc; return Array.isArray(d) && d.some((k) => CAVERN_DISC.has(k)); },
    go: { tool: { kind: 'place', def: 'wall' } } },
  { id: 'flood', when: flooding, go: { tool: { kind: 'place', def: 'door' } } },
  { id: 'visitor', when: (s) => visitorsOf(s).length > 0 || !!tradeVisit(s), go: { fn: (ctx) => openWorld(ctx, 'letters') } },
  { id: 'front', when: frontSoon, go: null },
  { id: 'air', when: airBad, go: { tool: { kind: 'place', def: hasDef('structure', 'chimney') ? 'chimney' : 'door' } } },
  { id: 'clash', when: (s) => living(s).some((c) => Array.isArray(c.thoughts) && c.thoughts.some((t) => t && /clash/.test(String(t[0])))),
    go: { fn: (ctx) => ctx.openColony('People') } },
  { id: 'envoy', when: (s) => !!(s.colony.trade && s.colony.trade.envoy), go: { fn: (ctx) => openWorld(ctx, 'factions') } },
]);
export const HINT_MS = 12000;
const HKEY = (s) => 'ec2.hints.' + (s.id || 'colony');
const DKEY = (s) => 'ec2.whatsnew.' + (s.id || 'colony');
const loadList = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const saveList = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* private mode: it may show again */ } };
/** The hints this hold has shown (ids, in the order shown). */
export const hintsSeen = (s) => loadList(HKEY(s)).filter((id) => HINTS.some((x) => x.id === id));

/** Help / Hints: the hints this hold has shown, each with its "Show me" (closes Help first). */
export function hintsBlock(el, ctx) {
  const seen = hintsSeen(ctx.s);
  el.append(h('h3.ec-sub', { text: HINT_TEXT.title }));
  if (!seen.length) { el.append(h('p.ec-note', { text: HINT_TEXT.none })); return; }
  for (const id of seen) {
    const it = HINTS.find((x) => x.id === id);
    const row = h('div.ec-hintrow', { style: { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' } },
      h('p.ec-bio-d', { text: HINT_TEXT.rows[id], style: { flex: '1 1 auto', margin: '0' } }));
    if (it && it.go) {
      const go = h('button.ec-act', { type: 'button', 'data-act': 'hint-again', 'data-hint': id, text: COACH_TEXT.showMe, style: { flex: 'none', minHeight: '44px' } });
      onTap(go, () => { if (ctx.closeSheet) ctx.closeSheet(); runGo(ctx, ctx.s, it.go); });
      row.append(go);
    }
    el.append(row);
  }
}
function runGo(ctx, s, g) {
  if (!g) return;
  if (g.fn) g.fn(ctx, s);
  else if (g.colony) ctx.openColony(g.colony);
  else if (g.panel) ctx.openPanel(g.panel);
  else if (g.tool) ctx.startTool(g.tool);
}

// ---- the "What is new" deck (8.8) ------------------------------------------------------------------------------
/** The cards: id, when(s) (the system is in this hold). Text: WHATSNEW_TEXT.cards[id]. */
export const DECK = Object.freeze([
  { id: 'world', when: (s) => !!s.realm },
  { id: 'menus', when: () => true },
  { id: 'air', when: (s) => !!((s.colony.world && s.colony.world.weather && s.colony.world.weather.v >= 2) || (s.rt && s.rt.air) || s.air) },
]);
/** A hold played before the new shell: past the coach's days, or a Stage 2 hold given depth. */
export const olderHold = (s) => s.tick >= COACH_END_TICK || migratedHold(s);
/** Queue deck cards again for colony `id` (9.4 part 2: the world card after the migration). */
export function queueWhatsNew(id, cards = DECK.map((c) => c.id)) {
  const k = 'ec2.whatsnew.' + (id || 'colony');
  saveList(k, loadList(k).filter((x) => !cards.includes(x)));
}

function loadSeen() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
function saveSeen(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private mode: they may show again */ } }

/**
 * Mount the intro card. ctx: the shell context; opts: { coachDone(), busy() } (busy: a sheet, panel,
 * tool, ledger or letter is up). Returns { el, check(), hide(), destroy() }; check() about once a second.
 */
export function mountIntros(root, ctx, opts) {
  const s = ctx.s;
  const el = h('aside.ec-guide.ec-intro', { 'aria-label': 'New in your hold', hidden: true });
  root.append(el);
  let seen = loadSeen(), cur = null, lastEnd = -Infinity, lastShow = 0;
  let after = null;   // showFirst's follow-on (the Dawn Ledger after the depth card), run when the card is closed
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // the new shell: hints by need and the "What is new" deck (8.8), per hold
  const hintSeen = SHELL2_ON ? loadList(HKEY(s)) : [];
  const pending = [];   // hints whose moment came while something else was up (UI memory)
  let deckSeen = [];
  if (SHELL2_ON) {
    let raw = null;
    try { raw = localStorage.getItem(DKEY(s)); } catch (_) { raw = null; }
    // a hold founded under the new shell has nothing to catch up on: every card counts as seen
    if (raw === null && !olderHold(s)) saveList(DKEY(s), DECK.map((c) => c.id));
    deckSeen = loadList(DKEY(s));
  }
  const due = (x) => { try { return !!x.when(s); } catch (_) { return false; } };
  const deckDue = () => (SHELL2_ON ? DECK.filter((c) => !deckSeen.includes(c.id) && due(c)).map((c) => c.id) : []);
  const reset = () => { clear(el); el.removeAttribute('style'); el.removeAttribute('role'); el.classList.remove('ec-needhint', 'ec-deck'); };
  function hide(markSeen = true) {
    if (cur && cur.kind === 'hint') { if (markSeen && !hintSeen.includes(cur.id)) { hintSeen.push(cur.id); saveList(HKEY(s), hintSeen); } }
    else if (cur && cur.kind === 'deck') { if (markSeen) { for (const id of cur.ids) if (!deckSeen.includes(id)) deckSeen.push(id); saveList(DKEY(s), deckSeen); } }
    else if (cur && markSeen && !seen.includes(cur.id)) { seen.push(cur.id); saveSeen(seen); }
    cur = null; el.hidden = true; reset(); lastEnd = now();
    document.body.classList.remove('has-intro');
    if (!document.querySelector('.ec-guide:not(.ec-intro):not([hidden])')) document.body.classList.remove('has-guide');
    const then = after; after = null;
    if (then) then();
  }
  /** A hint: one line, "Show me" and close; it folds away after HINT_MS and counts as seen. */
  function showHint(it) {
    cur = { kind: 'hint', id: it.id, it, when: () => true }; reset(); el.hidden = false;
    el.classList.add('ec-needhint');
    el.setAttribute('role', 'status');
    Object.assign(el.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 4px 4px 12px' });
    document.body.classList.add('has-guide', 'has-intro');
    el.append(h('div.ec-guide-how', { text: HINT_TEXT.rows[it.id], style: { flex: '1 1 auto', margin: '0', color: 'var(--text)' } }));
    if (it.go) {
      const go = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': 'hint-go', 'data-hint': it.id, text: COACH_TEXT.showMe, style: { flex: 'none', margin: '0' } });
      onTap(go, () => { hide(); runGo(ctx, s, it.go); });
      el.append(go);
    }
    const x = h('button.ec-ibtn.ec-guide-x', { type: 'button', 'data-act': 'hint-hide', 'aria-label': COACH_TEXT.close, html: icon('x') });
    onTap(x, () => hide());
    el.append(x);
  }
  /** The deck: one card at a time, "n/3", Next, and Got it on the last; closing it counts the cards seen. */
  function showDeck(ids, i = 0) {
    cur = { kind: 'deck', id: 'deck', ids, when: () => true }; reset(); el.hidden = false;
    el.classList.add('ec-deck');
    document.body.classList.add('has-guide', 'has-intro');
    const c = WHATSNEW_TEXT.cards[ids[i]];
    const x = h('button.ec-ibtn.ec-guide-x', { type: 'button', 'data-act': 'deck-hide', 'aria-label': COACH_TEXT.close, html: icon('x') });
    onTap(x, () => hide());
    const head = WHATSNEW_TEXT.head.replace('{n}', String(i + 1)).replace('{total}', String(ids.length));
    el.append(h('div.ec-guide-head', null, h('div.ec-guide-n', { text: head }), x), h('div.ec-guide-t', { text: c.title }), h('div.ec-guide-how', { text: c.how }));
    const last = i >= ids.length - 1;
    const b = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': last ? 'deck-ok' : 'deck-next', text: last ? WHATSNEW_TEXT.ok : WHATSNEW_TEXT.next });
    onTap(b, () => { if (last) hide(); else showDeck(ids, i + 1); });
    el.append(h('div.ec-intro-row', null, b));
  }
  function show(it) {
    cur = it; reset(); el.hidden = false;
    // the coach card steps back while an intro is up (X 2.7: an urgent intro lay over the coach's step)
    document.body.classList.add('has-guide', 'has-intro');
    const x = h('button.ec-ibtn.ec-guide-x', { type: 'button', 'data-act': 'intro-hide', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => hide());
    el.append(h('div.ec-guide-head', null, h('div.ec-guide-n', { text: 'New in your hold' }), x),
      h('div.ec-guide-t', { text: it.title }), h('div.ec-guide-how', { text: typeof it.how === 'function' ? it.how(s) : it.how }));
    const row = h('div.ec-intro-row');
    if (it.go) {
      const go = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': 'intro-go', text: it.go.label || 'Show me' });
      onTap(go, () => {
        const g = it.go; after = null; hide();   // the player chose an action: what showFirst queued stays closed
        if (g.fn) g.fn(ctx, s);
        else if (g.colony) ctx.openColony(g.colony);
        else if (g.panel) ctx.openPanel(g.panel);
        else if (g.tool) ctx.startTool(g.tool);
      });
      row.append(go);
    }
    const ok = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': 'intro-ok', text: 'Got it' });
    onTap(ok, () => hide());
    row.append(ok);
    el.append(row);
  }
  return {
    el,
    get open() { return cur; },
    /** Hints shown in this hold and hints waiting for a free moment (tests, Help). */
    hints: () => ({ seen: hintSeen.slice(), pending: pending.slice() }),
    check() {
      // hints: note each one's moment when it comes (it waits for a free moment, once per hold)
      if (SHELL2_ON) for (const it of HINTS) if (!hintSeen.includes(it.id) && !pending.includes(it.id) && due(it)) pending.push(it.id);
      if (cur && cur.kind === 'hint') { if (now() - lastShow > HINT_MS) hide(true); return; }
      if (cur && cur.kind === 'deck') return;
      // a card whose subject is gone (the break passed) folds away; it counts as seen after 8 s on screen
      if (cur) { let still = true; try { still = !!cur.when(s); } catch (_) { still = false; } if (!still) hide(now() - lastShow > 8000); return; }
      if (opts.busy() || now() - lastEnd < 20000) return;
      const dk = deckDue();
      if (dk.length) { lastShow = now(); showDeck(dk); return; }
      const hn = pending.find((id) => !hintSeen.includes(id));
      if (hn) { pending.splice(pending.indexOf(hn), 1); lastShow = now(); showHint(HINTS.find((x) => x.id === hn)); return; }
      const coach = opts.coachDone();
      for (const it of INTROS) {
        if (seen.includes(it.id) || (!coach && !it.urgent)) continue;
        let ok = false;
        try { ok = !!it.when(s); } catch (_) { ok = false; }
        if (ok) { lastShow = now(); show(it); return; }
      }
    },
    /**
     * Show intro `id` now, ahead of anything else, when it is due and unseen on this device (Continue of a
     * migrated hold: the depth card comes before the Dawn Ledger, which `then` opens when the card is closed
     * with Got it or the close button). Returns false (and runs nothing) when the card is not due.
     */
    showFirst(id, then = null) {
      const it = INTROS.find((x) => x.id === id);
      if (!it || seen.includes(id)) return false;
      let ok = false;
      try { ok = !!it.when(s); } catch (_) { ok = false; }
      if (!ok) return false;
      if (cur && cur.id !== id) hide(false);
      lastShow = now(); show(it); after = then;
      return true;
    },
    hide,
    destroy() { el.remove(); },
  };
}
