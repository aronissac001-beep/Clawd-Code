// The guided opening (owner I; doc 10.9): a checklist card at the top-left of the world view, one
// step at a time, each step detected from the colony's state and never forced. Stage 1a carries the
// dig-and-build steps of days 1-2 (the omen and horde steps arrive with Stage 1b).
// UI only: it reads state and starts tools through the shell context; it never sends a command of
// its own and never writes the sim state. Progress is a per-colony localStorage flag set
// ('ec2.guide.<colony id>'), so it survives a reload without touching the save or the state hash.
import { h, onTap, icon, clear } from './kit.js';
import { DESIG } from '../game/core/grid.js';

/** The 1a steps: id, title, how (one line), done(s, ui) and an optional "Show me" tool or panel. */
export const GUIDE_STEPS = Object.freeze([
  { id: 'chop', title: 'Chop some trees', how: 'Orders > Chop, then drag over trees. Wood builds walls, doors and beds.',
    done: (s) => countDesig(s, DESIG.CHOP) >= 1, go: { tool: { kind: 'rect', id: 'chop' } } },
  { id: 'stockpile', title: 'Make a stockpile', how: 'Zones > Stockpile > All, then drag an area by the Hearth. Stock counts what is stored.',
    done: (s) => s.zones.length > 0, go: { tool: { kind: 'zone', op: 'new', preset: 'all' } } },
  { id: 'speed', title: 'Hold the speed button for 3x', how: 'Hold it, slide to 3x and let go. A tap pauses and resumes.',
    done: (s, ui) => ui.speed >= 3 },
  { id: 'carve', title: 'Carve into the mountain', how: 'Orders > Carve hall, then drag over rock. The pillars are planned for you.',
    done: (s) => s.colony.plans.some((p) => p.kind === 'carve') || countDesig(s, DESIG.MINE) >= 6, go: { tool: { kind: 'carve' } } },
  { id: 'mason', title: "Build a mason's bench", how: "Build > Workshops > Mason's bench. It cuts blocks from the stone you dig.",
    done: (s) => s.bld.some((b) => b && b.def === 'mason'), go: { tool: { kind: 'place', def: 'mason' } } },
  { id: 'bedroom', title: 'Stamp a bedroom', how: 'Build > Rooms > Bedroom, then drag 5 x 4: walls, a door, floor and a bed in one go.',
    done: (s) => s.bld.some((b) => b && b.def === 'bed'), go: { tool: { kind: 'stamp', stamp: 'bedroom' } } },
]);
const END = { title: 'Your hold has begun', how: 'Dig deeper for coal and iron, copy a room you like from its card, and keep building.' };

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
  const mark = () => { let ch = false; for (const g of GUIDE_STEPS) if (!st.done.includes(g.id) && g.done(s, ctx.ui)) { st.done.push(g.id); ch = true; } return ch; };
  if (mark() && fresh && GUIDE_STEPS.every((g) => st.done.includes(g.id))) st.off = true;
  save(s, st);

  function render() {
    const step = GUIDE_STEPS.find((g) => !st.done.includes(g.id));
    const key = st.off ? 'off' : (step ? step.id : 'end') + (st.small ? ':s' : '');
    if (key === shown) return;
    shown = key;
    clear(el);
    el.hidden = st.off;
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
    const cur = step || END;
    const hide = h('button.ec-ibtn.ec-guide-x', { type: 'button', 'data-act': 'guide-hide', 'aria-label': step ? 'Hide the steps' : 'Close', html: icon(step ? 'chevDown' : 'x') });
    onTap(hide, () => { if (step) st.small = true; else st.off = true; save(s, st); render(); });
    const head = h('div.ec-guide-head', null,
      h('div.ec-guide-n', { text: step ? `Step ${n} of ${GUIDE_STEPS.length}` : 'All steps done' }), hide);
    el.append(head, h('div.ec-guide-t', { text: cur.title }), h('div.ec-guide-how', { text: cur.how }));
    if (step && step.go) {
      const go = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': 'guide-go', text: 'Show me' });
      onTap(go, () => { if (step.go.tool) ctx.startTool(step.go.tool); else if (step.go.panel) ctx.openPanel(step.go.panel); });
      el.append(go);
    }
  }
  render();
  return {
    el,
    check() {
      if (st.off) return;
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
    destroy() { el.remove(); },
  };
}
