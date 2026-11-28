// Burial and the dead (EMBERCROWN-FORTRESS.md 3.6; step Z2.6). Logic: js/game/people/death.js (F).
//
//   restLine(s, b)        the line a grave, sarcophagus, crypt or memorial slab shows on its card
//                         ("Rests here: Bram Ashford" / "Engraved: ..." / "Room for 6 names"), or null
//   deadRows(s)           the dead not yet laid to rest: [{ colId, name, text, unrested, lost }]
//   unrestAlert(s)        { text, why, target } for the alert stack while anyone is Unrested, or null
//   openDead(ctx)         the sheet "The dead" (Colony > People, or from the alert)
//   deadPanel(el, s, ctx) the same view into any element
//
// Rows are 44 pt high, text 14 px or more. A row whose body still lies on the map offers "Show" (the view
// jumps to it through ctx.focusTile when the shell has it).
import { h, onTap, clear } from './kit.js';
import { structDef, hasFlag } from '../game/core/content.js';
import * as DEATH from '../game/people/death.js';

const ROW = { minHeight: '44px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: 'var(--fs-2)', padding: '4px 0', borderBottom: '1px solid var(--line-faint)' };
const SUB = { fontSize: '14px', opacity: '0.82' };
const BTN = { minHeight: '44px', minWidth: '72px', width: 'auto', flex: '0 0 auto', fontSize: 'var(--fs-2)', padding: '0 14px' };

const list = (names) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', '));

export function restLine(s, b) {
  if (!b) return null;
  const d = structDef(b.def);
  if (DEATH.SLAB_DEFS.includes(b.def)) {
    const n = DEATH.slabNames(s, b.id);
    return n.length ? `Engraved: ${list(n)}` : `Room for ${DEATH.SLAB_CAP} names of the lost`;
  }
  if (!d || !hasFlag(d, 'grave')) return null;
  const n = DEATH.graveNames(s, b.id);
  const cap = d.cap || 1;
  if (!n.length) return cap > 1 ? `Empty: room for ${cap}` : 'Empty';
  return `Rests here: ${list(n)}${n.length < cap ? ` (room for ${cap - n.length} more)` : ''}`;
}

export function deadRows(s) {
  return DEATH.restingList(s).map((r) => {
    const when = r.days === 1 ? '1 day' : `${r.days} days`;
    const what = r.lost ? 'The body is lost: a mason can name them on a memorial slab.' : 'Unburied: build a grave and haulers will lay them to rest.';
    return { colId: r.colId, name: r.name, unrested: r.unrested, lost: r.lost, text: `Dead ${when}${r.unrested ? ', their friends are Unrested' : ''}. ${what}` };
  });
}

export function unrestAlert(s) {
  const rows = deadRows(s).filter((r) => r.unrested);
  if (!rows.length) return null;
  const lost = rows.some((r) => r.lost);
  const body = rows.map((r) => (r.lost ? null : DEATH.corpseOf(s, r.colId))).find(Boolean);
  return {
    text: rows.length === 1 ? `${rows[0].name} is not laid to rest` : `${rows.length} dead are not laid to rest`,
    why: lost ? 'Bodies lost: build a memorial slab (Masonry) and a mason engraves their names.' : 'Build a grave (Build > Utility): haulers bury the dead.',
    // the shell's alert target: the first unburied body, else the dead sheet (t.open, handled by the shell's owner)
    target: body ? { tile: [body.x, body.y, body.z | 0] } : { open: 'dead' },
  };
}

export function openDead(ctx) {
  ctx.openSheet('The dead', (el) => deadPanel(el, ctx.s, ctx), { push: true });
}

export function deadPanel(el, s, ctx = null) {
  clear(el);
  const rows = deadRows(s);
  el.appendChild(h('p', { style: { fontSize: '15px' }, text: 'Friends and kin grieve if the dead are neither buried nor named on a memorial within 5 days.' }));
  if (!rows.length) { el.appendChild(h('p', { style: SUB, text: 'All of the dead are laid to rest.' })); return el; }
  for (const r of rows) {
    const txt = h('div', { style: { flex: '1 1 auto', minWidth: '0' } }, h('b', { text: r.name }), h('div', { style: SUB, text: r.text }));
    const row = h('div.ec-dead-row', { style: ROW }, txt);
    if (!r.lost && ctx && ctx.focusTile) {
      const it = DEATH.corpseOf(s, r.colId);
      if (it) {
        const btn = h('button.ec-btn', { style: BTN, text: 'Show', 'aria-label': `Show the body of ${r.name}` });
        onTap(btn, () => ctx.focusTile([it.x, it.y, it.z | 0]));
        row.appendChild(btn);
      }
    }
    el.appendChild(row);
  }
  return el;
}
