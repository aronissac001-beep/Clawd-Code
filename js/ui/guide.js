// The coach (owner I; doc 10.9): the guided opening as a checklist card at the top-left of the world
// view, one step at a time, each step detected from the colony's state and never forced. It runs to
// day 4: the dig-and-build steps of days 1-2 (chop, stockpile, 3x, carve, mason, bedroom, carpenter,
// campfire, needs: food, rest and light with the Needs tab, grow zone), then, from the first omen
// (day 2, 18:00; the omen letter carries the coach text on warnings, drafting and light), "Place 2 braziers by the Hearth", and from Imminent (day 3, 20:00)
// "Draft, then hold by the Hearth" (play-test: the Hollow go for the Hearth, not a door). At day 4, 06:00 the coach ends and the Dawn Ledger and Next steps
// take over (ledger.js). A step with `when` waits (is skipped) until its moment comes.
// UI only: it reads state and starts tools through the shell context; it never sends a command of
// its own and never writes the sim state. Progress is a per-colony localStorage flag set
// ('ec2.guide.<colony id>'), so it survives a reload without touching the save or the state hash.
import { h, onTap, icon, clear } from './kit.js';
import { openSubjectSheet } from './sheet.js';
import { DESIG } from '../game/core/grid.js';
import { TICKS_PER_DAY, TICKS_PER_HOUR } from '../game/core/time.js';

const warned = (s) => s.st.queue.some((e) => e.stage !== 'queued') || s.raids.length > 0 || s.st.history.some((x) => x.cat === 'major');
const close = (s) => s.st.queue.some((e) => e.stage === 'imminent') || s.raids.some((r) => r.stage === 'active' || r.stage === 'retreat') || s.st.history.some((x) => x.cat === 'major');
/** The coach ends at day 4, 06:00 (10.9). */
export const COACH_END_TICK = 3 * TICKS_PER_DAY + 6 * TICKS_PER_HOUR;

/** The steps: id, title, how (one line), done(s, ui), optional when(s) and a "Show me" tool or panel. */
export const GUIDE_STEPS = Object.freeze([
  { id: 'chop', title: 'Chop some trees', how: 'Orders > Chop, then drag over trees. Wood builds walls, doors and beds, and feeds the fire.',
    done: (s) => countDesig(s, DESIG.CHOP) >= 1, go: { tool: { kind: 'rect', id: 'chop' } } },
  { id: 'stockpile', title: 'Make a stockpile', how: 'Zones > Stockpile > All, then drag an area by the Hearth. Stock counts what is stored.',
    done: (s) => s.zones.some((z) => z.type === 'stockpile'), go: { tool: { kind: 'zone', op: 'new', preset: 'all' } } },
  { id: 'speed', title: 'Hold the speed button for 3x', how: 'Hold it, slide to 3x and let go. A tap pauses and resumes.',
    done: (s, ui) => ui.speed >= 3 },
  { id: 'carve', title: 'Carve into the mountain', how: 'Orders > Carve hall, then drag over rock. The pillars are planned for you.',
    done: (s) => s.colony.plans.some((p) => p.kind === 'carve') || countDesig(s, DESIG.MINE) >= 6, go: { tool: { kind: 'carve' } } },
  { id: 'mason', title: "Build a mason's bench", how: "Build > Workshops > Mason's bench. It cuts blocks from the stone you dig.",
    done: (s) => s.bld.some((b) => b && b.def === 'mason'), go: { tool: { kind: 'place', def: 'mason' } } },
  { id: 'bedroom', title: 'Stamp a bedroom', how: 'Build > Rooms > Bedroom, then drag 5 x 4: walls, a door, floor and a bed in one go.',
    done: (s) => s.bld.some((b) => b && b.def === 'bed'), go: { tool: { kind: 'stamp', stamp: 'bedroom' } } },
  { id: 'carpenter', title: "Build a carpenter's bench", how: "Build > Workshops > Carpenter's bench. It makes the bed your bedroom waits for, and tables, chairs and doors.",
    done: (s) => s.bld.some((b) => b && b.def === 'carpenter'), go: { tool: { kind: 'place', def: 'carpenter' } } },
  { id: 'campfire', title: 'Build a campfire', how: 'Build > Workshops > Campfire. A cook turns berries and hearthroot into simple meals there, 2 per colonist, without being asked.',
    done: (s) => s.bld.some((b) => b && b.def === 'campfire'), go: { tool: { kind: 'place', def: 'campfire' } } },
  { id: 'needs', title: 'Look after their needs', how: 'Campfire meals feed them, beds rest them, and light keeps the dread of the dark away. Tap a portrait, then its card, for Needs.',
    done: (s, ui, ctx) => !!(ui && ui.sheet && ctx && ctx.sheetTab && ctx.sheetTab() === 'Needs'), go: { needs: true } },
  { id: 'grow', title: 'Paint a grow zone', how: 'Zones > Grow, then drag over grass. Hearthroot is ready in 6 days.',
    done: (s) => s.zones.some((z) => z.type === 'grow'), go: { tool: { kind: 'zone', op: 'new', type: 'grow' } } },
  { id: 'braziers', title: 'Place 2 braziers by the Hearth', how: 'The Hollow come for the Hearth. Build > Light > Brazier, on the side they come from: on lit ground they are easier to hurt.',
    when: warned, done: (s) => s.bld.filter((b) => b && b.def === 'brazier').length >= 2, go: { tool: { kind: 'place', def: 'brazier' } } },
  { id: 'draft', title: 'Draft, then hold by the Hearth', how: 'Tap a portrait, then Draft (or Draft all). Then tap the ground between the Hearth and the horde: they hold there and fight.',
    when: close, done: (s) => s.col.some((c) => c.drafted) || s.st.history.some((x) => x.cat === 'major'), go: { draft: true } },
]);
const END = { title: 'Your hold has begun', how: 'Dig deeper for coal and iron, keep the Hearth fed, and watch the chip at the top for the next omen.' };
const WAIT = { title: 'Keep building', how: 'The coach returns when the first omen comes (day 2, at dusk). Dig, build and stock wood until then.' };
// after the omen (play-test: the card still promised an omen that had already come)
const WAIT_WARNED = { title: 'Ready the hold', how: 'Watch the chip at the top: the coach returns when the horde is close. Keep wood stocked for the Hearth and braziers.' };

function countDesig(s, bit) {
  const D = s.L.desig;
  let n = 0;
  for (let i = 0; i < D.length; i++) if (D[i] & bit) n++;
  return n;
}
const KEY = (s) => 'ec2.guide.' + (s.id || 'colony');
function load(s) {
  try { const v = JSON.parse(localStorage.getItem(KEY(s)) || 'null'); if (v && typeof v === 'object') return { done: Array.isArray(v.done) ? v.done : [], off: !!v.off, small: !!v.small }; } catch (_) { /* private mode */ }
  return { done: [], off: false, small: false };
}
function save(s, st) { try { localStorage.setItem(KEY(s), JSON.stringify(st)); } catch (_) { /* storage full or blocked: the guide simply starts again */ } }

/**
 * Mount the guide card in root. ctx: the shell context (s, ui, startTool, openPanel). Returns
 * { el, check(), destroy() }; the shell calls check() about once a second.
 */
export function mountGuide(root, ctx) {
  const s = ctx.s;
  const st = load(s);
  const el = h('aside.ec-guide', { 'aria-label': 'Getting started', hidden: true });
  root.append(el);
  let shown = null;   // the step id (or 'end') on screen, so a check that changes nothing leaves the DOM
  // a colony that already did every step (a continued old save) starts with the guide off
  const fresh = !st.done.length && !st.off;
  const ready = (g) => !g.when || g.when(s);
  // a colony with no guide progress on this device (imported, or moved to the Home Screen app) skips the
  // steps before the furthest one it has already done (play-test: a day-3 colony mid-raid showed
  // "Chop some trees")
  if (fresh) {
    let last = -1;
    GUIDE_STEPS.forEach((g, i) => { try { if (ready(g) && g.done(s, ctx.ui, ctx)) last = i; } catch (_) { /* a step that cannot read this state */ } });
    for (let i = 0; i < last; i++) st.done.push(GUIDE_STEPS[i].id);
  }
  const mark = () => { let ch = false; for (const g of GUIDE_STEPS) if (!st.done.includes(g.id) && ready(g) && g.done(s, ctx.ui, ctx)) { st.done.push(g.id); ch = true; } return ch; };
  const ended = () => s.tick >= COACH_END_TICK;
  if (ended()) st.off = true;
  if (mark() && fresh && GUIDE_STEPS.every((g) => st.done.includes(g.id))) st.off = true;
  save(s, st);

  function render() {
    const step = GUIDE_STEPS.find((g) => !st.done.includes(g.id) && ready(g));
    const waiting = !step && GUIDE_STEPS.some((g) => !st.done.includes(g.id));
    const key = st.off ? 'off' : (step ? step.id : waiting ? (warned(s) ? 'wait2' : 'wait') : 'end') + (st.small ? ':s' : '');
    if (key === shown) return;
    shown = key;
    clear(el);
    el.hidden = st.off;
    // the full card owns the top-left of the world: toasts move to the bottom while it shows (style.css)
    document.body.classList.toggle('has-guide', !st.off && !st.small);
    if (st.off) return;
    el.classList.toggle('small', st.small);
    const n = step ? GUIDE_STEPS.indexOf(step) + 1 : GUIDE_STEPS.length;
    if (st.small) {
      const chip = h('button.ec-guide-chip', { type: 'button', 'data-act': 'guide-open', 'aria-label': `Getting started, step ${n} of ${GUIDE_STEPS.length}` },
        h('span', { html: icon('check') }), h('span', { text: `${step ? n - 1 : n}/${GUIDE_STEPS.length}` }));
      onTap(chip, () => { st.small = false; save(s, st); render(); });
      el.append(chip);
      return;
    }
    const cur = step || (waiting ? (warned(s) ? WAIT_WARNED : WAIT) : END);
    const hide = h('button.ec-ibtn.ec-guide-x', { type: 'button', 'data-act': 'guide-hide', 'aria-label': step ? 'Hide the steps' : 'Close', html: icon(step ? 'chevDown' : 'x') });
    onTap(hide, () => { if (step) st.small = true; else st.off = true; save(s, st); render(); });
    const head = h('div.ec-guide-head', null,
      h('div.ec-guide-n', { text: step ? `Step ${n} of ${GUIDE_STEPS.length}` : waiting ? `${st.done.length} of ${GUIDE_STEPS.length} done` : 'All steps done' }), hide);
    el.append(head, h('div.ec-guide-t', { text: cur.title }), h('div.ec-guide-how', { text: cur.how }));
    if (step && step.go) {
      const go = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': 'guide-go', text: 'Show me' });
      go.textContent = step.go.draft ? 'Draft all' : 'Show me';
      onTap(go, () => {
        if (step.go.tool) ctx.startTool(step.go.tool);
        else if (step.go.panel) ctx.openPanel(step.go.panel);
        else if (step.go.draft && ctx.draftAll) ctx.draftAll();
        else if (step.go.needs) { const c = s.col.find((x) => !x.hp.dead); if (c) openSubjectSheet(ctx, { kind: 'colonist', id: c.id }, 'Needs'); }
      });
      el.append(go);
    }
  }
  render();
  return {
    el,
    /** The coach has ended (day 4 06:00, or closed after its last step): Next steps take over. */
    ended: () => st.off || ended(),
    check() {
      if (st.off) return;
      if (ended()) { st.off = true; save(s, st); shown = null; render(); return; }
      const before = st.done.length;
      if (mark()) {
        save(s, st);
        // a short "done" toast for each step finished while the card was up
        const g = GUIDE_STEPS.find((x) => x.id === st.done[st.done.length - 1]);
        if (g && st.done.length > before && ctx.toast) ctx.toast(`Done: ${g.title.charAt(0).toLowerCase()}${g.title.slice(1)}.`);
        // the last step done: the closing card opens once, even from the small chip
        if (GUIDE_STEPS.every((x) => st.done.includes(x.id))) { st.small = false; save(s, st); }
      }
      render();
    },
    destroy() { el.remove(); document.body.classList.remove('has-guide'); },
  };
}
