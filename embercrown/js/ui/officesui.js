// The Offices screen (EMBERCROWN-FORTRESS.md 3.4, F17; step Z2.2). Colony > Hold > Offices. Logic:
// js/game/colony/offices.js (K); words: js/data/offices.js.
//
//   openOffices(ctx)               the sheet
//   officesPanel(el, s, ctx, st)   the same view into any element (ctx null: read only)
//
// Each office is a card: its name, the holder (or Vacant, or what opens it), what the office does, the holder's
// requests with a Met or Unmet mark, and the nobles' open mandates with their progress. Appointed offices have
// Appoint and Clear (a colonist picker of 44 pt rows); the Steward's card holds the stock targets (+10 and -10
// steps, Remove, and a short list to add from). Commands: `office { id, colId }`, `stockTarget { k, m, n }`
// (A's specs); a Make mandate offers "Make it", a `bill` add at the bench that can make it.
import { h, onTap, clear } from './kit.js';
import { def } from '../game/core/content.js';
import { COMMANDS } from '../game/core/commands.js';
import * as O from '../game/colony/offices.js';

const ROW = { minHeight: '44px' };
const CARD = { border: '1px solid var(--line-soft)', borderRadius: 'var(--r-lg)', padding: '10px 12px', margin: '10px 0', background: 'var(--surface-2)', boxShadow: 'var(--bevel)' };
const MET = { color: 'var(--good)', fontWeight: '650' }, UNMET = { color: 'var(--bad-text)', fontWeight: '650' };
/** What the Steward's add list offers (those the data has). */
export const TARGET_KINDS = Object.freeze(['meal', 'finemeal', 'block', 'brick', 'cloth', 'bandage', 'ale']);
const STEP = 10;

/** Send through A's command path; until its spec exists, apply directly (the screen stays usable in dev). */
function send(ctx, cmd, okText) {
  if (cmd.t in COMMANDS) return ctx.send(cmd, okText);
  const fn = cmd.t === 'office' ? O.officeCmd : cmd.t === 'stockTarget' ? O.stockTargetCmd : null;
  const res = fn ? fn(ctx.s, cmd) : { ok: false, reason: 'not available yet' };
  if (ctx.toast) ctx.toast(res.ok ? okText : String(res.reason || 'Not possible.'), res.ok ? undefined : 'bad');
  return res;
}

export function openOffices(ctx) {
  const st = { pick: null };
  ctx.openSheet('Offices', (el) => officesPanel(el, ctx.s, ctx, st), {});
}

export function officesPanel(el, s, ctx = null, st = { pick: null }) {
  el.classList.add('ec-offices');
  const box = h('div.ec-offices-box');
  el.append(box);
  let mode = null;
  const draw = () => {
    clear(box);
    // a switch between the list and the picker starts at the top
    const m = st.pick ? 'pick' : 'list', sb = box.closest ? box.closest('.ec-sheet-body') : null;
    if (mode !== null && m !== mode && sb) sb.scrollTop = 0;
    mode = m;
    if (st.pick) { pickerView(box, s, ctx, st, draw); return; }
    box.append(h('p.ec-note', { text: 'Offices give the hold new things to do. The Thane is chosen by the colonists, and the Lord or Lady is sent by the Hearthwatch.' }));
    for (const o of O.officesView(s)) box.append(card(s, ctx, st, o, draw));
  };
  draw();
  return el;
}

function btn(label, act, fn, primary = false) {
  const b = h('button.ec-rchip' + (primary ? '' : '.second'), { type: 'button', 'data-act': act, text: label, style: { minHeight: '44px', minWidth: '44px' } });
  onTap(b, fn);
  return b;
}

function card(s, ctx, st, o, draw) {
  const el = h('div.ec-office', { 'data-office': o.id, style: CARD });
  const who = o.holder ? o.holder.name : o.open ? 'Vacant' : 'Not open yet';
  el.append(h('h3.ec-sub', { text: o.name, style: { margin: '0 0 2px' } }),
    h('p.ec-bio-d', { text: o.by === 'colonists' ? `${who}${o.score !== null ? ` (held in regard ${o.score})` : ''}` : who, style: { color: o.holder ? 'var(--brass-hi)' : undefined, margin: '0 0 4px' } }),
    h('p.ec-bio-d', { text: o.verb }));
  if (!o.open && !o.holder) el.append(h('p.ec-note', { text: o.openText }));
  if (o.holder || o.by !== 'player') {
    el.append(h('p.ec-bio-d', { text: o.holder ? 'Requests' : 'Will ask for', style: { margin: '6px 0 2px', fontWeight: '650' } }));
    for (const n of o.needs) {
      el.append(h('div.ec-log', { 'data-need': n.id }, h('span.ec-log-d', { text: o.holder ? (n.met ? 'Met' : 'Unmet') : 'Needs', style: o.holder ? (n.met ? MET : UNMET) : null }), h('span.ec-log-t', { text: n.label })));
    }
    if (o.holder && o.unmetDays > 0) el.append(h('p.ec-note', { text: `Unmet for ${o.unmetDays} day${o.unmetDays === 1 ? '' : 's'}. After 10 days the holder takes it badly.` }));
  }
  for (const m of o.mandates) {
    const line = m.kind === 'make' ? `Mandate: ${m.what}. Made ${Math.min(m.made, m.n)} of ${m.n}; ${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'} left.` : `Mandate: no ${m.what} may be traded away (${m.daysLeft} days left).`;
    el.append(h('p.ec-bio-d', { text: line, style: { color: 'var(--brass-hi)' } }));
    if (ctx && m.kind === 'make') {
      const p = O.benchFor(s, m.k, null);
      if (p) el.append(h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, btn('Make it', 'office-make', () => {
        send(ctx, { t: 'bill', op: 'add', bId: p.b.id, bill: { recipe: p.r.id, mode: 'count', n: Math.max(1, m.n - m.made) } }, `A bill for ${m.what} at the ${(def('structure', p.b.def) || { name: p.b.def }).name.toLowerCase()}.`);
        draw();
      }, true)));
      else el.append(h('p.ec-note', { text: 'No bench in the hold can make it yet.' }));
    }
  }
  if (ctx && o.by === 'player' && (o.open || o.holder)) {
    const row = h('div.ec-rchips', { style: { justifyContent: 'flex-start', marginTop: '6px' } });
    row.append(btn(o.holder ? 'Replace' : 'Appoint', 'office-appoint', () => { st.pick = o.id; draw(); }, true));
    if (o.holder) row.append(btn('Clear', 'office-clear', () => { send(ctx, { t: 'office', id: o.id, colId: null }, `The ${o.name} is vacant.`); draw(); }));
    el.append(row);
  }
  if (o.id === 'steward' && (o.open || o.holder)) el.append(targetsView(s, ctx, draw, !!o.holder));
  return el;
}

function targetsView(s, ctx, draw, live) {
  const el = h('div.ec-targets', { style: { marginTop: '8px' } });
  el.append(h('p.ec-bio-d', { text: live ? 'Stock targets' : 'Stock targets (kept once a Steward is appointed)', style: { margin: '6px 0 2px', fontWeight: '650' } }));
  const plan = O.stewardPlan(s);
  if (!plan.length) el.append(h('p.ec-note', { text: 'No targets yet.' }));
  for (const p of plan) {
    const bench = p.benchDef ? (def('structure', p.benchDef) || { name: p.benchDef }).name : null;
    const sub = `Keep ${p.n}; ${O.stockLabel(s, p.stock)} in stock. ${p.why ? (p.why === 'no Steward' ? 'Waiting for a Steward.' : 'No bench in the hold can make it.') : `A bill at the ${bench.toLowerCase()}.`}`;
    el.append(h('div.ec-target', { 'data-target': p.key, style: { padding: '4px 0', borderBottom: '1px solid var(--line-faint)' } },
      h('span.ec-ruler-t', { text: p.name }), h('span.ec-bio-d', { text: sub, style: { display: 'block', margin: '0 0 4px' } })));
    if (ctx) el.append(h('div.ec-rchips', { style: { justifyContent: 'flex-start' } },
      btn(`-${STEP}`, 'target-less', () => { send(ctx, { t: 'stockTarget', k: p.k, ...(p.m ? { m: p.m } : {}), n: Math.max(0, p.n - STEP) }, `Keep ${Math.max(0, p.n - STEP)} ${p.name.toLowerCase()}.`); draw(); }),
      btn(`+${STEP}`, 'target-more', () => { send(ctx, { t: 'stockTarget', k: p.k, ...(p.m ? { m: p.m } : {}), n: p.n + STEP }, `Keep ${p.n + STEP} ${p.name.toLowerCase()}.`); draw(); }),
      btn('Remove', 'target-remove', () => { send(ctx, { t: 'stockTarget', k: p.k, ...(p.m ? { m: p.m } : {}), n: 0 }, `No target for ${p.name.toLowerCase()}.`); draw(); })));
  }
  if (ctx) {
    const have = new Set(plan.map((p) => p.k));
    const add = TARGET_KINDS.filter((k) => def('item', k) && !have.has(k));
    if (add.length) {
      el.append(h('p.ec-bio-d', { text: 'Add a target', style: { margin: '8px 0 2px' } }));
      const chips = h('div.ec-rchips', { style: { flexWrap: 'wrap', justifyContent: 'flex-start' } });
      for (const k of add) { const it = def('item', k); chips.append(btn(it.name, 'target-add', () => { send(ctx, { t: 'stockTarget', k, n: 40 }, `Keep 40 ${it.name.toLowerCase()}.`); draw(); })); }
      el.append(chips);
    }
  }
  return el;
}

function pickerView(el, s, ctx, st, draw) {
  const id = st.pick, name = O.officeName(s, id);
  const back = btn('Back', 'office-back', () => { st.pick = null; draw(); });
  el.append(h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, back), h('h3.ec-sub', { text: `Appoint the ${name}` }));
  const cur = O.holderOf(s, id);
  let n = 0;
  for (const c of s.col) {
    if (c.hp.dead || O.canAppoint(s, id, c.id)) continue;
    const other = O.officeOf(s, c.id);
    const sub = c === cur ? `The ${name} now` : other ? `Now the ${O.officeName(s, other)}: this moves them` : null;
    const b = h('button.ec-ruler-row', { type: 'button', 'data-act': 'office-pick', 'data-col': String(c.id), style: { ...ROW, width: '100%', textAlign: 'left' } },
      h('span.ec-ruler-t', { text: c.name }), sub ? h('span.ec-bio-d', { text: sub, style: { display: 'block', margin: '0' } }) : null);
    onTap(b, () => { const r = send(ctx, { t: 'office', id, colId: c.id }, `${c.name.split(' ')[0]} is the ${name}.`); if (!r || r.ok) st.pick = null; draw(); });
    el.append(b);
    n++;
  }
  if (!n) el.append(h('p.ec-note', { text: 'Nobody can take this office now.' }));
}
