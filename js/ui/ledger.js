// The Dawn Ledger and Next steps (owner I; doc 10.10; counters K's colony/ledger.js, rules G's
// js/data/advice.js). One card at the top of the world view:
//   - at 06:00 each game day it appears toast-sized ("Dawn, day 5: 40 tiles mined, 3 built"), tap to
//     expand; on every resume (Continue, or coming back to the tab) it appears expanded, and the shell
//     pauses the game (2.2, D4);
//   - expanded: the day's counts (built, crafted, meals, mined, hauled, raids, lost), the open alerts,
//     and, once the coach has ended, Next steps: the top 3 advice rules by score whose `when` holds and
//     that were not dismissed in the last cooldownD game days (default 2), each with a Go button.
// UI only: it reads the state; dismissals are per colony in localStorage ('ec2.advice.<id>', game ticks).
import { h, onTap, icon, clear } from './kit.js';
import { all, def } from '../game/core/content.js';
import { dayOf, TICKS_PER_DAY } from '../game/core/time.js';
import { dawnLedger } from '../game/colony/ledger.js';

const ROW_ICON = { mined: 'pick', built: 'hammer', crafted: 'saw', hauled: 'crate', meals: 'food', raidsRepelled: 'shield', deaths: 'skull', kills: 'sword' };
/** Where each rule's Go button leads (a tool where one fits better than the data's panel). */
const GO = {
  food_grow: { tool: { kind: 'zone', op: 'new', type: 'grow' } },
  first_stockpile: { tool: { kind: 'zone', op: 'new', preset: 'all' } },
  campfire: { tool: { kind: 'place', def: 'campfire' } },
  beds: { tool: { kind: 'place', def: 'bed' } },
  dark_tunnels: { tool: { kind: 'place', def: 'sconce' } },
  iron_bloomery: { tool: { kind: 'place', def: 'bloomery' } },
  ingots_forge: { tool: { kind: 'place', def: 'forge' } },
  horde_braziers: { tool: { kind: 'place', def: 'brazier' } },
  hearth_fuel: { hearth: true },
  idle_hands: { colony: 'Work' },
  downed: { colony: 'People' },
};

const KEY = (s) => 'ec2.advice.' + (s.id || 'colony');
function loadDismissed(s) { try { const v = JSON.parse(localStorage.getItem(KEY(s)) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } }
function saveDismissed(s, v) { try { localStorage.setItem(KEY(s), JSON.stringify(v)); } catch (_) { /* private mode */ } }

/** The top `n` advice rules now: [{ id, text, score, go }] (pure reads; a throwing rule is skipped). */
export function nextSteps(s, dismissed = {}, n = 3) {
  const out = [];
  for (const r of all('advice')) {
    const cd = (r.cooldownD === undefined ? 2 : r.cooldownD) * TICKS_PER_DAY;
    if (dismissed[r.id] !== undefined && s.tick - dismissed[r.id] < cd) continue;
    let ok = false, sc = 0;
    try { ok = !!r.when(s); sc = ok ? +r.score(s) || 0 : 0; } catch (_) { ok = false; }
    if (ok) out.push({ id: r.id, text: r.text, score: sc, go: GO[r.id] || r.go || null });
  }
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return out.slice(0, n);
}

/** The ledger lines: [[icon, text]] from dawnLedger(s) (the day that ended at the last 06:00). */
export function ledgerLines(s) {
  const d = dawnLedger(s);
  if (!d) return [];
  return d.rows.map(([k, label, n]) => [ROW_ICON[k] || 'check', `${label}: ${n}`]);
}

/**
 * Mount the card. ctx: the shell context (s, openPanel, startTool, select, centerOn, openColony,
 * toast); opts.coachDone() says whether the coach has ended (Next steps show only after it);
 * opts.alerts() the open alerts. Returns { el, showDawn(), showResume(), check(), hide(), open }.
 */
export function mountLedger(root, ctx, opts) {
  const s = ctx.s;
  const el = h('aside.ec-ledger', { hidden: true, 'aria-label': 'Dawn Ledger', 'data-act': 'ledger' });
  root.append(el);
  let dismissed = loadDismissed(s);
  let mode = null;            // null | 'small' | 'full'
  let lastSince = s.colony.ledger ? s.colony.ledger.since : null;
  const api = {
    el,
    get open() { return mode; },
    showDawn() { mode = 'small'; render(); },
    showResume() { mode = 'full'; render(); },
    hide() { mode = null; el.hidden = true; document.body.classList.remove('has-ledger'); },
    /** Once a second: a new dawn roll of the counters shows the small card. */
    check() {
      const since = s.colony.ledger ? s.colony.ledger.since : null;
      if (since !== lastSince) { lastSince = since; if (since !== null && since > 3600) api.showDawn(); }
    },
    refresh() { if (mode) render(); },
  };
  function go(step) {
    const g = step.go || {};
    api.hide();
    if (g.tool) ctx.startTool(g.tool);
    else if (g.hearth) { const id = s.colony.hearth && s.colony.hearth.id; const b = id !== null && id !== undefined ? s.bld[id] : null; if (b) { ctx.centerOn((b.x + 1) * 32, (b.y + 1) * 32); ctx.select({ kind: 'building', id, x: b.x, y: b.y }); } }
    else if (g.colony) ctx.openColony(g.colony);
    else if (g.panel === 'work') ctx.openColony('Work');
    else if (g.panel === 'build' || g.panel === 'orders' || g.panel === 'zones') ctx.openPanel(g.panel);
    else if (g.panel) ctx.openColony('Hold');
  }
  function render() {
    clear(el);
    el.hidden = !mode;
    document.body.classList.toggle('has-ledger', !!mode);
    if (!mode) return;
    el.classList.toggle('small', mode === 'small');
    const day = dayOf(s.tick) + 1;
    const lines = ledgerLines(s);
    if (mode === 'small') {
      const sum = lines.length ? lines.slice(0, 3).map((l) => l[1]).join(' · ') : 'A quiet night.';
      const b = h('button.ec-ledger-chip', { type: 'button', 'data-act': 'ledger-open', 'aria-label': `Dawn Ledger, day ${day}. ${sum}` },
        h('span', { html: icon('sun') }), h('span.ec-ledger-sum', { text: `Dawn, day ${day}: ${sum}` }));
      onTap(b, () => { mode = 'full'; render(); });
      const x = h('button.ec-ibtn.ec-ledger-x', { type: 'button', 'data-act': 'ledger-close', 'aria-label': 'Close', html: icon('x') });
      onTap(x, () => api.hide());
      el.append(b, x);
      return;
    }
    const x = h('button.ec-ibtn.ec-ledger-x', { type: 'button', 'data-act': 'ledger-close', 'aria-label': 'Close', html: icon('x') });
    onTap(x, () => api.hide());
    el.append(h('div.ec-ledger-head', null, h('h2.ec-ledger-t', { text: `Dawn Ledger, day ${day}` }), x));
    const list = h('div.ec-ledger-rows');
    if (lines.length) for (const [ic, t] of lines) list.append(h('div.ec-ledger-row', null, h('span', { html: icon(ic) }), h('span', { text: t })));
    else list.append(h('p.ec-note', { text: dawnLedger(s) ? 'A quiet day: nothing built, made or lost.' : 'The first dawn has not come yet. The ledger counts each day from 06:00.' }));
    el.append(list);
    const al = opts.alerts ? opts.alerts() : [];
    if (al.length) {
      el.append(h('h3.ec-sub', { text: 'Open alerts' }));
      for (const a of al.slice(0, 3)) el.append(h('div.ec-ledger-row.' + (a.tone || 'warn'), null, h('span', { html: icon(a.icon) }), h('span', { text: a.text })));
    }
    if (opts.coachDone && opts.coachDone()) {
      const steps = nextSteps(s, dismissed);
      if (steps.length) {
        el.append(h('h3.ec-sub', { text: 'Next steps' }));
        for (const st of steps) {
          const goB = h('button.ec-act.ec-ledger-go', { type: 'button', 'data-act': 'advice-go', 'data-advice': st.id, text: 'Go' });
          onTap(goB, () => go(st));
          const no = h('button.ec-ibtn.ec-ledger-no', { type: 'button', 'data-act': 'advice-dismiss', 'aria-label': 'Not now', html: icon('x') });
          onTap(no, () => { dismissed[st.id] = s.tick; saveDismissed(s, dismissed); render(); });
          el.append(h('div.ec-advice', { 'data-advice': st.id }, h('p.ec-advice-t', { text: st.text }), goB, no));
        }
      }
    }
    const ok = h('button.ec-act.ec-wide', { type: 'button', 'data-act': 'ledger-ok', text: 'Carry on' });
    onTap(ok, () => api.hide());
    el.append(ok);
    void def;
  }
  return api;
}
