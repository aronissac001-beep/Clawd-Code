// Roles (owner I; doc 5.1, 10.4). The People and Work tabs list colonists with a primary-role chip
// and a second-role chip (44 pt each). Tapping a chip opens the role picker: a 2-column grid of the
// role cards (icon, name, key work), the best-suited ones marked by skill and passion, and a
// coverage row that warns when a key work has nobody at priority 1 or 2 ("No one mines").
// The command is `role {colId, primary, secondary}` (C3; F's applier recomputes the priorities).
import { h, onTap, icon } from './kit.js';
import { def, all } from '../game/core/content.js';
import { WORK_IDS } from '../game/core/schema.js';
import { availableIn } from '../data/schema.js';
import { STAGE } from './stage.js';
import { level, passionOf } from '../game/people/skills.js';

export const ROLE_ICON = { miner: 'pick', builder: 'hammer', crafter: 'saw', hauler: 'crate', generalist: 'pop', smith: 'hammer', grower: 'farm', cook: 'food',
  herder: 'heart', doctor: 'heart', scholar: 'book', artisan: 'gear', soldier: 'sword' };
/** Work types the slice gives work for (14.6: Haul, Mine, Chop, Build, Craft). */
export const KEY_WORK = Object.freeze(['mine', 'build', 'craft', 'haul', 'chop']);
const WORK_VERB = { mine: 'mines', build: 'builds', craft: 'crafts', haul: 'hauls', chop: 'chops trees', cook: 'cooks', grow: 'grows crops', care: 'tends the hurt', smith: 'smiths' };

export const roleName = (id) => { const r = def('role', id); return r ? r.name : 'None'; };
export const roles = () => all('role').filter((r) => !r.stage || availableIn(r, STAGE));
/** Work names a role puts first: "Mine", "Build". */
export function roleKeyWork(r) {
  if (r.all) return 'Everything at even priority';
  const ks = Object.keys(r.prio || {}).filter((k) => r.prio[k] === 1).sort((a, b) => WORK_IDS.indexOf(a) - WORK_IDS.indexOf(b));
  return ks.map((k) => { const w = def('worktype', k); return w ? w.name : k; }).join(', ');
}
/** Fit of a colonist for a role: the best (level + 3 x passion) over the skills of its priority-1 work. */
export function roleFit(col, r) {
  if (r.all) return 0;
  let best = 0;
  for (const w of Object.keys(r.prio || {})) {
    if (r.prio[w] !== 1) continue;
    const wt = def('worktype', w);
    for (const sk of (wt && wt.skills) || []) best = Math.max(best, level(col, sk) + 3 * passionOf(col, sk));
  }
  return best;
}
/** Coverage (10.4): key work types with nobody at priority 1 or 2. ["No one mines", ...] */
export function coverage(s) {
  const out = [];
  for (const w of KEY_WORK) {
    const k = WORK_IDS.indexOf(w);
    if (!s.col.some((c) => !c.hp.dead && c.prio[k] >= 1 && c.prio[k] <= 2)) out.push(`No one ${WORK_VERB[w] || w}`);
  }
  return out;
}

/** Two role chips for a colonist (primary, second). */
export function roleChips(ctx, col) {
  const p = h('button.ec-rchip', { type: 'button', 'data-act': 'role-primary', 'aria-label': `${col.name}: role ${roleName(col.role[0])}` }, h('span', { html: icon(ROLE_ICON[col.role[0]] || 'pop') }), h('span', { text: roleName(col.role[0]) }));
  const s2 = h('button.ec-rchip.second', { type: 'button', 'data-act': 'role-second', 'aria-label': `${col.name}: second role ${col.role[1] ? roleName(col.role[1]) : 'none'}` }, h('span', { text: col.role[1] ? roleName(col.role[1]) : '+ Second' }));
  onTap(p, () => openRolePicker(ctx, col, 'primary'));
  onTap(s2, () => openRolePicker(ctx, col, 'second'));
  return h('div.ec-rchips', null, p, s2);
}

/** The People / Work list: colonists with their role chips, then the coverage row. */
export function peopleList(el, ctx, { work = false } = {}) {
  const s = ctx.s;
  if (!s.col.length) { el.append(h('p.ec-note', { text: 'No colonists.' })); return; }
  for (const c of s.col) {
    const who = h('button.ec-person', { type: 'button', 'data-act': 'person', 'data-col': String(c.id), 'aria-label': `${c.name}: open` }, ctx.portrait(c, 36), h('span.ec-person-n', { text: c.name.split(' ')[0] }));
    onTap(who, () => { ctx.closeSheet(); ctx.select({ kind: 'colonist', id: c.id }); ctx.centerOn(c.x, c.y); });
    const row = h('div.ec-prow', null, who, roleChips(ctx, c));
    if (work && c.custom) row.append(h('span.ec-tag', { text: 'Custom' }));
    el.append(row);
  }
  coverageRow(el, s);
}
function coverageRow(el, s) {
  const gaps = coverage(s);
  el.append(gaps.length
    ? h('div.ec-cover.warn', { role: 'status' }, h('span', { html: icon('alert') }), h('span', { text: gaps.join('. ') + '.' }))
    : h('div.ec-cover', { role: 'status' }, h('span', { html: icon('check') }), h('span', { text: 'Every key work has someone at priority 1 or 2.' })));
}

/** The role picker sheet for one colonist (which: 'primary' | 'second'). */
export function openRolePicker(ctx, col, which = 'primary') {
  ctx.openSheet(`${col.name.split(' ')[0]}: ${which === 'primary' ? 'role' : 'second role'}`, (el) => {
    const list = roles();
    const fits = list.map((r) => roleFit(col, r));
    const top = Math.max(...fits);
    const seg = h('div.ec-seg', { role: 'radiogroup', 'aria-label': 'Which role' });
    for (const [label, w] of [['Role', 'primary'], ['Second role', 'second']]) {
      const b = h('button.ec-seg-b' + (which === w ? '.on' : ''), { type: 'button', role: 'radio', 'aria-checked': which === w ? 'true' : 'false', 'data-act': 'which-' + w, text: label });
      onTap(b, () => openRolePicker(ctx, col, w));
      seg.append(b);
    }
    el.append(seg);
    const grid = h('div.ec-grid');
    const cur = which === 'primary' ? col.role[0] : col.role[1];
    for (let k = 0; k < list.length; k++) {
      const r = list[k];
      const best = top > 0 && fits[k] === top;
      const b = h('button.ec-card.ec-role' + (cur === r.id ? '.on' : ''), { type: 'button', 'data-act': 'pick-role-' + r.id, 'aria-pressed': cur === r.id ? 'true' : 'false' },
        h('span.ec-card-ic', { html: icon(ROLE_ICON[r.id] || 'pop') }), h('span.ec-card-n', { text: r.name }),
        h('span.ec-card-sub', { text: roleKeyWork(r) }), best ? h('span.ec-best', { text: 'Best suited' }) : null);
      onTap(b, () => {
        let primary = col.role[0], second = col.role[1];
        if (which === 'primary') { primary = r.id; if (second === r.id) second = null; } else { second = r.id === primary ? null : r.id; }
        const cmd = { t: 'role', colId: col.id, primary };
        if (second) cmd.secondary = second;
        const res = ctx.send(cmd, `${col.name.split(' ')[0]}: ${roleName(primary)}${second ? ' and ' + roleName(second) : ''}.`);
        if (res && res.ok) ctx.back();
      });
      grid.append(b);
    }
    if (which === 'second' && col.role[1]) {
      const none = h('button.ec-card', { type: 'button', 'data-act': 'pick-role-none' }, h('span.ec-card-ic', { html: icon('x') }), h('span.ec-card-n', { text: 'No second role' }));
      onTap(none, () => { const res = ctx.send({ t: 'role', colId: col.id, primary: col.role[0] }, 'Second role cleared.'); if (res && res.ok) ctx.back(); });
      grid.append(none);
    }
    el.append(grid);
    el.append(h('p.ec-note', { text: 'A second role is done when the first has nothing to do. Benches only work when someone crafts, cooks or smiths.' }));
    coverageRow(el, ctx.s);
  }, { back: true });
}
