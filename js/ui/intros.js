// System intros (owner I, written by X in the Stage 2 play-test; doc 10.9 "each system introduced the
// first time it matters"). After the coach's opening, each Stage 2 system gets one short card the first
// time it matters in this hold: research, rooms, animals, the first trader, the Grey Taint, the
// Ember-touched, illness, breaks, fire, a nemesis, the first tier-up and the turn of the seasons.
// A card says what is going on and what to do (two or three lines), with a button that goes there and
// "Got it". Rules: one card at a time, never over a sheet, a panel, a tool, the ledger or a letter; at
// least 20 s between two cards; urgent ones (taint, the Ember-touched, fire, a break) may come during
// the coach's days, the rest wait for it to end. Each intro shows once per device (the player has
// learnt it), kept in localStorage 'ec2.intros' (no save or state change: UI only).
import { h, onTap, icon, clear } from './kit.js';
import { openDemand, openTrade } from './letters.js';
import { openHelp } from './help.js';
import { dayOf } from '../game/core/time.js';

const KEY = 'ec2.intros';
const living = (s) => s.col.filter((c) => !c.hp.dead);
const done = (s, d) => s.bld.some((b) => b && b.def === d && b.st === 'done');
const tradeVisit = (s) => { const t = s.colony.trade; return t && Array.isArray(t.visits) && t.visits.length ? t.visits[0] : null; };
const firstCol = (s, f) => living(s).find(f) || null;

/** The intros, in priority order: id, title, how, when(s), urgent?, go: { colony | panel | tool | fn(ctx, s) }. */
export const INTROS = Object.freeze([
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
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function hide(markSeen = true) {
    if (cur && markSeen && !seen.includes(cur.id)) { seen.push(cur.id); saveSeen(seen); }
    cur = null; el.hidden = true; clear(el); lastEnd = now();
    document.body.classList.remove('has-guide');
  }
  function show(it) {
    cur = it; clear(el); el.hidden = false;
    document.body.classList.add('has-guide');
    const x = h('button.ec-ibtn.ec-guide-x', { type: 'button', 'data-act': 'intro-hide', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => hide());
    el.append(h('div.ec-guide-head', null, h('div.ec-guide-n', { text: 'New in your hold' }), x),
      h('div.ec-guide-t', { text: it.title }), h('div.ec-guide-how', { text: typeof it.how === 'function' ? it.how(s) : it.how }));
    const row = h('div.ec-intro-row');
    if (it.go) {
      const go = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': 'intro-go', text: it.go.label || 'Show me' });
      onTap(go, () => {
        const g = it.go; hide();
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
    check() {
      // a card whose subject is gone (the break passed) folds away; it counts as seen after 8 s on screen
      if (cur) { let still = true; try { still = !!cur.when(s); } catch (_) { still = false; } if (!still) hide(now() - lastShow > 8000); return; }
      if (opts.busy() || now() - lastEnd < 20000) return;
      const coach = opts.coachDone();
      for (const it of INTROS) {
        if (seen.includes(it.id) || (!coach && !it.urgent)) continue;
        let ok = false;
        try { ok = !!it.when(s); } catch (_) { ok = false; }
        if (ok) { lastShow = now(); show(it); return; }
      }
    },
    hide,
    destroy() { el.remove(); },
  };
}
