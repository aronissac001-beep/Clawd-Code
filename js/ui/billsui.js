// Bills (owner I; doc 5.7, 10.8). The building sheet of a workbench: its bills top to bottom
// (recipe, mode and count first; More reveals the skill floor, the fetch radius and reordering),
// Add bill with smart defaults, Pause and Remove. Building a bench already adds its default bills
// (A's addBuilding reads the bench's autoBills). Commands: bill add / edit / remove / move (C3).
import { h, onTap, icon } from './kit.js';
import { def, all, structDef } from '../game/core/content.js';
import { availableIn } from '../data/schema.js';
import { STAGE } from './stage.js';
import { untilTarget } from '../game/work/bills.js';

const MODES = Object.freeze([['count', 'Count'], ['until', 'Until'], ['forever', 'Forever']]);
const ITEM = (k) => (def('item', k) || { name: k }).name;
const CAT = (k) => { const c = all('itemCat').find((x) => x.id === k); return c ? c.name : k; };

/** Recipes this bench can work in this build. */
export const benchRecipes = (b) => all('recipe').filter((r) => r.bench && r.bench.includes(b.def) && availableIn(r, STAGE));
/** "Wood 35 > Bed" */
export const recipeLine = (r) => `${r.in.map((x) => `${x.k ? ITEM(x.k) : CAT(x.cat)} ${x.n}`).join(', ')} > ${r.out.map((o) => (o.n > 1 ? `${o.n} ` : '') + ITEM(o.k)).join(', ')}`;
/**
 * Smart default for a new bill (5.7): the bench's own default when it has one for the recipe;
 * materials (blocks, ingots) "until 100"; furniture and everything else "count 1".
 */
export function smartBill(b, r) {
  const d = structDef(b.def);
  const auto = d && d.workbench && d.workbench.autoBills && d.workbench.autoBills.find((a) => a.recipe === r.id);
  if (auto) return { recipe: r.id, mode: auto.mode, n: auto.n };
  const out = def('item', r.out[0].k);
  if (out && ['blocks', 'ingots', 'cloth', 'leather'].includes(out.cat)) return { recipe: r.id, mode: 'until', n: 100 };
  if (out && out.cat === 'meals') return { recipe: r.id, mode: 'until', n: 2 };
  return { recipe: r.id, mode: 'count', n: 1 };
}
/** "Until 100 (have 37)", "Make 3 more", "Forever". */
export function billText(s, bl) {
  if (bl.mode === 'forever') return 'Forever';
  if (bl.mode === 'until') {
    const r = def('recipe', bl.recipe), k = r && r.out[0] ? r.out[0].k : null;
    const have = k ? (s.rt.stock[k] || 0) : 0;
    return `Until ${untilTarget(s, bl)}${bl.perCol ? ` (${bl.n} each)` : ''}, have ${have}`;
  }
  return `Make ${bl.n} more`;
}

/** Fill the Bills tab of a workbench's sheet. ctx: shell context; ui: { more: Set(bill index) }. */
export function billsTab(el, ctx, b, ui) {
  const s = ctx.s;
  const send = (op, bill, ok) => { const r = ctx.send({ t: 'bill', op, bId: b.id, bill }, ok); ctx.refreshSheet(); return r; };
  if (b.st !== 'done') el.append(h('p.ec-note', { text: 'Bills start once the bench is built.' }));
  if (!b.bills.length) el.append(h('p.ec-note', { text: 'No bills. Add one and a crafter will work it.' }));
  b.bills.forEach((bl, i) => {
    const r = def('recipe', bl.recipe) || { name: bl.recipe, in: [], out: [] };
    const auto = (structDef(b.def).workbench.autoBills || []).some((a) => a.recipe === bl.recipe);
    const rm = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': 'bill-remove', 'aria-label': `Remove ${r.name}`, html: icon('x') });
    onTap(rm, () => send('remove', { i }, `${r.name}: removed.`));
    const top = h('div.ec-bill-top', null,
      h('div.ec-bill-name', null, h('b', { text: r.name }), auto ? h('span.ec-tag', { text: 'Default' }) : null, bl.bp ? h('span.ec-tag', { text: 'For a blueprint' }) : null, bl.paused ? h('span.ec-tag.warn', { text: 'Paused' }) : null),
      rm);
    const mode = h('button.ec-tchip.on', { type: 'button', 'data-act': 'bill-mode', text: (MODES.find((m) => m[0] === bl.mode) || MODES[0])[1] });
    onTap(mode, () => { const k = MODES.findIndex((m) => m[0] === bl.mode); const next = MODES[(k + 1) % MODES.length][0]; send('edit', { i, mode: next, n: next === 'until' && bl.n < 5 ? 10 : bl.n }); });
    const step = bl.mode === 'until' && bl.n >= 20 ? 10 : 1;
    const minus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': 'bill-minus', 'aria-label': 'Fewer', html: icon('minus'), disabled: bl.mode === 'forever' || bl.n <= 0 });
    const plus = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': 'bill-plus', 'aria-label': 'More', html: icon('plus'), disabled: bl.mode === 'forever' });
    onTap(minus, () => send('edit', { i, n: Math.max(0, bl.n - step) }));
    onTap(plus, () => send('edit', { i, n: Math.min(9999, bl.n + step) }));
    const n = h('b.ec-bill-n', { text: bl.mode === 'forever' ? '-' : String(bl.n) });
    const pause = h('button.ec-ibtn.ec-mini', { type: 'button', 'data-act': 'bill-pause', 'aria-label': bl.paused ? 'Resume' : 'Pause', html: icon(bl.paused ? 'play' : 'pause') });
    onTap(pause, () => send('edit', { i, paused: !bl.paused }, bl.paused ? 'Resumed.' : 'Paused.'));
    const moreB = h('button.ec-tchip', { type: 'button', 'data-act': 'bill-more', text: ui.more.has(i) ? 'Less' : 'More' });
    onTap(moreB, () => { if (ui.more.has(i)) ui.more.delete(i); else ui.more.add(i); ctx.refreshSheet(); });
    const row = h('div.ec-bill', { 'data-bill': String(i) }, top,
      h('div.ec-bill-sub', { text: `${billText(s, bl)} · ${recipeLine(r)}` }),
      h('div.ec-bill-ctl', null, mode, minus, n, plus, pause, moreB));
    if (ui.more.has(i)) {
      const mk = (label, act, fn, dis) => { const x = h('button.ec-tchip', { type: 'button', 'data-act': act, text: label, disabled: !!dis }); onTap(x, fn); return x; };
      row.append(h('div.ec-bill-more', null,
        h('div.ec-bill-line', null, h('span', { text: `Skill ${bl.minSkill}+` }),
          mk('-', 'bill-skill-minus', () => send('edit', { i, minSkill: Math.max(0, bl.minSkill - 1) }), bl.minSkill <= 0),
          mk('+', 'bill-skill-plus', () => send('edit', { i, minSkill: Math.min(bl.maxSkill, bl.minSkill + 1) }), bl.minSkill >= bl.maxSkill)),
        // (999: from anywhere, the default of new bills; the steps go 10 ... 120, then anywhere)
        h('div.ec-bill-line', null, h('span', { text: bl.radius >= 999 ? 'Fetch from anywhere' : `Fetch within ${bl.radius} tiles` }),
          mk('-', 'bill-radius-minus', () => send('edit', { i, radius: bl.radius >= 999 ? 120 : Math.max(10, bl.radius - 10) }), bl.radius <= 10),
          mk('+', 'bill-radius-plus', () => send('edit', { i, radius: bl.radius >= 120 ? 999 : bl.radius + 10 }), bl.radius >= 999)),
        h('div.ec-bill-line', null, mk('Move up', 'bill-up', () => send('move', { i, to: i - 1 }), i === 0), mk('Move down', 'bill-down', () => send('move', { i, to: i + 1 }), i === b.bills.length - 1))));
    }
    el.append(row);
  });
  const recipes = benchRecipes(b);
  if (b.bills.length < 10 && recipes.length) {
    el.append(h('h3.ec-sub', { text: 'Add a bill' }));
    const grid = h('div.ec-grid');
    for (const r of recipes) {
      const sm = smartBill(b, r);
      const c = h('button.ec-card', { type: 'button', 'data-act': 'bill-add-' + r.id }, h('span.ec-card-ic', { html: icon('plus') }), h('span.ec-card-n', { text: r.name }),
        h('span.ec-card-sub', { text: sm.mode === 'until' ? `Until ${sm.n}` : sm.mode === 'count' ? `Make ${sm.n}` : 'Forever' }));
      onTap(c, () => send('add', sm, `${r.name}: ${sm.mode === 'until' ? 'until ' + sm.n : 'make ' + sm.n}.`));
      grid.append(c);
    }
    el.append(grid);
  }
}
