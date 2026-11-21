// The Justice screen and the Laws switch (EMBERCROWN-FORTRESS.md 3.9, F18; step Z2.12). Logic:
// js/game/colony/justice.js (K); words: js/data/laws.js.
//
//   openJustice(ctx)               the sheet (Colony > Hold > Justice)
//   justicePanel(el, s, ctx, st)   the same view into any element (ctx null: read only)
//   lawsSwitch(el, s, ctx)         the Laws row of Settings > Hold (on by default; once a season)
//
// The panel: the Laws row; the Warden of Law card (holder, Vacant or what opens it, the Lockup need with a Met or
// Unmet mark, Appoint / Replace / Clear with a picker of 44 pt rows); who is serving a sentence; and the cases, most
// recent first (crime, offender, victim, witnesses, the sentence). Commands: `laws { on }`, `warden { colId }`
// (A's specs; until they exist the screen applies them directly, as the Offices screen does).
import { h, onTap, clear } from './kit.js';
import { COMMANDS } from '../game/core/commands.js';
import * as J from '../game/colony/justice.js';
import { TEXT, WARDEN } from '../data/laws.js';

const ROW = { minHeight: '44px' };
const CARD = { border: '1px solid rgba(201, 151, 62, 0.28)', borderRadius: '10px', padding: '10px 12px', margin: '10px 0', background: 'rgba(0, 0, 0, 0.16)' };
const MET = { color: '#9cc27a', fontWeight: '650' }, UNMET = { color: '#e08a6a', fontWeight: '650' };
const CASES_SHOWN = 12;

function send(ctx, cmd, okText) {
  if (cmd.t in COMMANDS) return ctx.send(cmd, okText);
  const fn = cmd.t === 'laws' ? J.lawsCmd : cmd.t === 'warden' ? J.wardenCmd : null;
  const res = fn ? fn(ctx.s, cmd) : { ok: false, reason: 'not available yet' };
  if (ctx.toast) ctx.toast(res.ok ? okText : String(res.reason || 'Not possible.'), res.ok ? undefined : 'bad');
  return res;
}
function btn(label, act, fn, primary = false, disabled = false) {
  const b = h('button.ec-rchip' + (primary ? '' : '.second'), { type: 'button', 'data-act': act, text: label, style: { minHeight: '44px', minWidth: '44px' } });
  if (disabled) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
  onTap(b, () => { if (!b.disabled) fn(); });
  return b;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function openJustice(ctx) {
  const st = { pick: false };
  ctx.openSheet('Justice', (el) => justicePanel(el, ctx.s, ctx, st), {});
}

/** The Laws row (Settings > Hold, and the top of the Justice screen). */
export function lawsSwitch(el, s, ctx = null, redraw = null) {
  const v = J.justiceView(s);
  const row = h('div.ec-laws', { 'data-laws': v.on ? 'on' : 'off', style: { ...CARD, margin: '6px 0' } });
  row.append(h('h3.ec-sub', { text: 'Laws', style: { margin: '0 0 2px' } }), h('p.ec-bio-d', { text: v.on ? TEXT.lawsOn : TEXT.lawsOff }));
  if (ctx) {
    const label = v.on ? 'Turn laws off' : 'Keep the laws';
    row.append(h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, btn(label, 'laws-toggle', () => {
      send(ctx, { t: 'laws', on: !v.on }, v.on ? 'The laws are set aside.' : 'The laws are kept again.');
      if (redraw) redraw(); else { clear(el); lawsSwitch(el, s, ctx); }
    }, !v.on, !v.changeable)));
  }
  row.append(h('p.ec-note', { text: v.changeable ? TEXT.bySeason : `${TEXT.bySeason} Changed already this season.` }));
  el.append(row);
  return el;
}

export function justicePanel(el, s, ctx = null, st = { pick: false }) {
  el.classList.add('ec-justice');
  const box = h('div.ec-justice-box');
  el.append(box);
  let mode = null;
  const draw = () => {
    clear(box);
    const m = st.pick ? 'pick' : 'list', sb = box.closest ? box.closest('.ec-sheet-body') : null;
    if (mode !== null && m !== mode && sb) sb.scrollTop = 0;
    mode = m;
    if (st.pick) { pickerView(box, s, ctx, st, draw); return; }
    const v = J.justiceView(s);
    lawsSwitch(box, s, ctx, draw);
    if (!v.on) { box.append(h('p.ec-note', { text: 'With no laws, the same acts still happen, only nobody answers for them.' })); return; }
    box.append(wardenCard(s, ctx, st, v, draw));
    if (v.serving.length) {
      box.append(h('h3.ec-sub', { text: 'Serving a sentence' }));
      for (const x of v.serving) {
        box.append(h('div.ec-log', { 'data-serving': String(x.colId) }, h('span.ec-log-d', { text: x.kind === 'confine' ? 'Lockup' : 'Labour' }),
          h('span.ec-log-t', { text: `${x.name}: ${plural(x.daysLeft, 'day')} left` })));
      }
    }
    box.append(h('h3.ec-sub', { text: v.waiting ? `Cases (${v.waiting} waiting)` : 'Cases' }));
    if (!v.cases.length) box.append(h('p.ec-note', { text: 'No crimes on the record.' }));
    for (const k of v.cases.slice(0, CASES_SHOWN)) box.append(caseRow(k));
  };
  draw();
  return el;
}

function wardenCard(s, ctx, st, v, draw) {
  const el = h('div.ec-office', { 'data-office': 'warden', style: CARD });
  const who = v.warden ? v.warden.name : v.open ? 'Vacant' : 'Not open yet';
  el.append(h('h3.ec-sub', { text: WARDEN.name, style: { margin: '0 0 2px' } }),
    h('p.ec-bio-d', { text: who, style: { color: v.warden ? 'var(--brass-hi)' : undefined, margin: '0 0 4px' } }),
    h('p.ec-bio-d', { text: WARDEN.verb }));
  if (!v.open && !v.warden) el.append(h('p.ec-note', { text: `${WARDEN.open} ${TEXT.common}` }));
  else if (!v.warden) el.append(h('p.ec-note', { text: TEXT.noWarden, style: UNMET }));
  el.append(h('div.ec-log', { 'data-need': 'lockup' }, h('span.ec-log-d', { text: v.lockup.met ? 'Met' : 'Unmet', style: v.lockup.met ? MET : UNMET }),
    h('span.ec-log-t', { text: v.lockup.met ? `${WARDEN.need} (${plural(v.lockup.cells, 'cell')})` : WARDEN.need })));
  if (!v.lockup.met) el.append(h('p.ec-note', { text: 'Without a free cell, a confinement is served as labour instead.' }));
  if (ctx && (v.open || v.warden)) {
    const row = h('div.ec-rchips', { style: { justifyContent: 'flex-start', marginTop: '6px' } });
    row.append(btn(v.warden ? 'Replace' : 'Appoint', 'warden-appoint', () => { st.pick = true; draw(); }, true));
    if (v.warden) row.append(btn('Clear', 'warden-clear', () => { send(ctx, { t: 'warden', colId: null }, `The ${WARDEN.name} is vacant.`); draw(); }));
    el.append(row);
  }
  return el;
}

function caseRow(k) {
  const sent = k.sent ? (k.sent.kind === 'confine' ? `Lockup, ${plural(k.sent.days, 'day')}` : `Labour, ${plural(k.sent.days, 'day')}${k.sent.commuted ? ' (no cell free)' : ''}`)
    : k.st === 'dropped' ? 'Dropped' : `Waiting, ${plural(k.days, 'day')}`;
  const wit = k.witnesses.length ? `Seen by ${k.witnesses.slice(0, 3).join(', ')}${k.witnesses.length > 3 ? ` and ${k.witnesses.length - 3} more` : ''}.` : 'Nobody saw it.';
  const what = `${k.offender}${k.what ? `: ${k.what}` : ''}${k.victim ? `; against ${k.victim}` : ''}.`;
  return h('div.ec-case', { 'data-case': String(k.id), 'data-st': k.st, style: { padding: '6px 0', borderBottom: '1px solid rgba(201, 151, 62, 0.1)' } },
    h('span.ec-ruler-t', { text: k.crime }),
    h('span.ec-bio-d', { text: what, style: { display: 'block', margin: '0' } }),
    h('span.ec-bio-d', { text: `${wit} ${sent}.`, style: { display: 'block', margin: '0', color: k.st === 'open' ? '#e08a6a' : undefined } }));
}

function pickerView(el, s, ctx, st, draw) {
  const back = btn('Back', 'warden-back', () => { st.pick = false; draw(); });
  el.append(h('div.ec-rchips', { style: { justifyContent: 'flex-start' } }, back), h('h3.ec-sub', { text: `Appoint the ${WARDEN.name}` }));
  const cur = J.wardenOf(s);
  let n = 0;
  for (const c of s.col) {
    if (c.hp.dead || J.canWarden(s, c.id)) continue;
    const b = h('button.ec-ruler-row', { type: 'button', 'data-act': 'warden-pick', 'data-col': String(c.id), style: { ...ROW, width: '100%', textAlign: 'left' } },
      h('span.ec-ruler-t', { text: c.name }), c === cur ? h('span.ec-bio-d', { text: `The ${WARDEN.name} now`, style: { display: 'block', margin: '0' } }) : null);
    onTap(b, () => { const r = send(ctx, { t: 'warden', colId: c.id }, `${c.name.split(' ')[0]} is the ${WARDEN.name}.`); if (!r || r.ok) st.pick = false; draw(); });
    el.append(b);
    n++;
  }
  if (!n) el.append(h('p.ec-note', { text: 'Nobody can take this office now.' }));
}
