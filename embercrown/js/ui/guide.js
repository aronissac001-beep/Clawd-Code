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
// The new shell (SHELL2; EMBERCROWN-WORLD.md 8.8, G23, step W1.7) teaches by need: 6 steps (chop, stockpile, bed,
// food, dig down, defend), each with a "Show me" that arms the tool for the step's next missing part, on a card
// at the top of the world (<= 20 % of the portrait height) that folds to a "2/6" chip; its progress is kept
// under 'ec2.guide.<colony id>.c6'. The one-line hints and the "What is new" deck live in intros.js. Text: the
// COACH_TEXT rows of js/data/text/help.js.
import { h, onTap, icon, clear } from './kit.js';
import { openSubjectSheet } from './sheet.js';
import { SHELL2_ON } from './peopleui.js';
import { COACH_TEXT } from '../data/text/help.js';
import { DESIG, D, zS, PLANE, TER } from '../game/core/grid.js';
import { vdigList, VD } from '../game/work/vdig.js';
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
/**
 * Stage Z1 (EMBERCROWN-FORTRESS.md 4.6): three steps after the first room on a map with levels. Pacing stays
 * the 10.9 target (the first room and the first warning within about 15 minutes).
 */
export const LEVEL_STEPS = Object.freeze([
  { id: 'stairs', title: 'Dig a stair down 2 levels', how: 'Orders > Stairs, Down 2, then tap the ground and Done. Stairs join the levels.',
    done: (s) => vdigList(s).some((e) => e[1] === VD.STAIR) || stairDug(s), go: { tool: { kind: 'vert', id: 'stairs' } } },
  { id: 'levels', title: 'Switch levels', how: 'Tap the down arrow under the level chip, or drag the chip up and down. Tap the chip for the depth ruler.',
    done: (s, ui) => !!(ui && ui.levelSeen) },
  { id: 'store', title: 'Build a store near the stairs', how: 'Go down a level, then Zones > Stockpile and drag an area by the stairs: haulers carry stone up and down.',
    done: (s) => stockBelow(s), go: { tool: { kind: 'zone', op: 'new', preset: 'all' } } },
]);
/** The steps for this map: the level steps follow the bedroom on a map with levels. */
export const stepsFor = (deep) => {
  if (!deep) return GUIDE_STEPS;
  const k = GUIDE_STEPS.findIndex((g) => g.id === 'bedroom') + 1;
  return Object.freeze([...GUIDE_STEPS.slice(0, k), ...LEVEL_STEPS, ...GUIDE_STEPS.slice(k)]);
};
function stairDug(s) { const t = s.L.terrain, b = zS * PLANE; for (let p = 0; p < PLANE; p++) if (t[b + p] === TER.STAIR_D || t[b + p] === TER.STAIR_UD) return true; return false; }
function stockBelow(s) {
  const ids = new Set(s.zones.filter((z) => z.type === 'stockpile').map((z) => z.id));
  if (!ids.size) return false;
  const zl = s.L.zone;
  for (let i = 0, e = zS * PLANE; i < e; i++) if (zl[i] && ids.has(zl[i])) return true;
  return false;
}
/**
 * The 6 steps of the new shell (8.8): id, parts [{ done(s), go }]; a step is done when every part is, and its
 * "Show me" arms the tool of the first part not done (bed: the carpenter's bench, then the bedroom stamp).
 * deep: a map with levels digs a stair down; a flat test map carves into the mountain.
 */
const built = (d) => (s) => s.bld.some((b) => b && b.def === d);
export function coachSteps(deep = true) {
  const P = (done, tool) => ({ done, go: { tool } });
  const rows = [
    ['chop', [P((s) => countDesig(s, DESIG.CHOP) >= 1, { kind: 'rect', id: 'chop' })]],
    ['stockpile', [P((s) => s.zones.some((z) => z.type === 'stockpile'), { kind: 'zone', op: 'new', preset: 'all' })]],
    ['bed', [P(built('carpenter'), { kind: 'place', def: 'carpenter' }), P(built('bed'), { kind: 'stamp', stamp: 'bedroom' })]],
    ['food', [P(built('campfire'), { kind: 'place', def: 'campfire' }), P((s) => s.zones.some((z) => z.type === 'grow'), { kind: 'zone', op: 'new', type: 'grow' })]],
    deep ? ['dig', [P((s) => vdigList(s).some((e) => e[1] === VD.STAIR) || stairDug(s), { kind: 'vert', id: 'stairs' })]]
      : ['carve', [P((s) => s.colony.plans.some((p) => p.kind === 'carve') || countDesig(s, DESIG.MINE) >= 6, { kind: 'carve' })]],
    ['defend', [P((s) => s.bld.filter((b) => b && b.def === 'brazier').length >= 2, { kind: 'place', def: 'brazier' })]],
  ];
  return Object.freeze(rows.map(([id, parts]) => Object.freeze({
    id, parts, title: COACH_TEXT.steps[id].title, how: COACH_TEXT.steps[id].how,
    done: (s) => parts.every((p) => p.done(s)),
    goFor: (s) => { const p = parts.find((x) => { try { return !x.done(s); } catch (_) { return true; } }); return (p || parts[parts.length - 1]).go; },
  })));
}
export const COACH_STEPS = coachSteps(true);
/** The coach card's inline layout (portrait and landscape alike; style.css owns the look, these the grid). */
const CARD6 = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: '8px', rowGap: '0', alignItems: 'center',
  padding: '2px 2px 8px 12px', width: 'min(360px, calc(100vw - var(--sa-l) - var(--sa-r) - 76px))', maxHeight: 'none', overflow: 'visible' };
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => (v[k] === undefined ? m : String(v[k])));
const END = { title: 'Your hold has begun', how: 'Dig deeper for coal and iron, keep the Hearth fed, and watch the chip at the top for the next omen.' };
const LV_END = { title: 'The levels are yours', how: 'Dig down for coal, iron and the caverns below. Tap the level chip for the depth ruler: every level you have found.' };
const WAIT = { title: 'Keep building', how: 'The coach returns when the first omen comes (day 2, at dusk). Dig, build and stock wood until then.' };
// after the omen (play-test: the card still promised an omen that had already come)
const WAIT_WARNED = { title: 'Ready the hold', how: 'Watch the chip at the top: the coach returns when the horde is close. Keep wood stocked for the Hearth and braziers.' };

function countDesig(s, bit) {
  const D = s.L.desig;
  let n = 0;
  for (let i = 0; i < D.length; i++) if (D[i] & bit) n++;
  return n;
}
// lv: true for the level steps ('.lv'), or a key suffix ('.c6': the 6-step coach of the new shell)
const KEY = (s, lv = false) => 'ec2.guide.' + (s.id || 'colony') + (typeof lv === 'string' ? lv : lv ? '.lv' : '');
/** A Stage 2 hold given depth at the fortress switch (migrate4 writes the Chronicle's depth line). */
export const migratedHold = (s) => (s.d || 1) > 1 && Array.isArray(s.chron) && s.chron.some((e) => e && e[2] === 'chron_depth');
function load(s, lv = false) {
  try { const v = JSON.parse(localStorage.getItem(KEY(s, lv)) || 'null'); if (v && typeof v === 'object') return { done: Array.isArray(v.done) ? v.done : [], off: !!v.off, small: !!v.small }; } catch (_) { /* private mode */ }
  return { done: [], off: false, small: false };
}
function saveSt(s, st, lv = false) { try { localStorage.setItem(KEY(s, lv), JSON.stringify(st)); } catch (_) { /* storage full or blocked: the guide simply starts again */ } }

/**
 * Mount the guide card in root. ctx: the shell context (s, ui, startTool, openPanel). Returns
 * { el, check(), destroy() }; the shell calls check() about once a second.
 */
export function mountGuide(root, ctx) {
  const s = ctx.s;
  // a migrated hold continued after its opening (the coach is over or was closed) gets the level steps alone, once,
  // with no day limit (EMBERCROWN-FORTRESS.md 4.6: digging down is new to it); kept under its own key
  const st0 = load(s);
  const lvMode = D > 1 && migratedHold(s) && (st0.off || s.tick >= COACH_END_TICK);
  // the new shell: the 6 steps (8.8), kept under their own key; a coach closed on the old card stays closed
  const six = SHELL2_ON && !lvMode;
  const GUIDE_STEPS = lvMode ? LEVEL_STEPS : six ? coachSteps(D > 1) : stepsFor(D > 1);   // this colony's steps (shadows the module list)
  const sfx = lvMode ? true : six ? '.c6' : false;
  const st = sfx ? load(s, sfx) : st0;
  if (six && st0.off) st.off = true;
  const save = (s0, v) => saveSt(s0, v, sfx);
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
  const ended = () => !lvMode && s.tick >= COACH_END_TICK;
  if (ended()) st.off = true;
  if (mark() && fresh && GUIDE_STEPS.every((g) => st.done.includes(g.id))) st.off = true;
  save(s, st);

  function render() {
    if (six) { render6(); return; }
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
    const cur = step || (waiting ? (warned(s) ? WAIT_WARNED : WAIT) : lvMode ? LV_END : END);
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
  /** The 6-step card (8.8): "n/6" and the title with the fold button, then the line and "Show me". */
  function render6() {
    const step = GUIDE_STEPS.find((g) => !st.done.includes(g.id));
    const key = st.off ? 'off' : (step ? step.id + ':' + st.done.length : 'end') + (st.small ? ':s' : '');
    if (key === shown) return;
    shown = key;
    clear(el);
    el.removeAttribute('style');
    el.classList.remove('ec-coach');
    el.hidden = st.off;
    document.body.classList.toggle('has-guide', !st.off && !st.small);
    if (st.off) return;
    el.classList.toggle('small', st.small);
    const total = GUIDE_STEPS.length, nDone = st.done.filter((id) => GUIDE_STEPS.some((g) => g.id === id)).length;
    if (st.small) {
      const chip = h('button.ec-guide-chip', { type: 'button', 'data-act': 'guide-open', 'aria-label': fill(COACH_TEXT.chipLabel, { done: nDone, total }) },
        h('span', { html: icon('check') }), h('span', { text: fill(COACH_TEXT.count, { n: nDone, total }) }));
      onTap(chip, () => { st.small = false; save(s, st); render(); });
      el.append(chip);
      return;
    }
    el.classList.add('ec-coach');
    Object.assign(el.style, CARD6);
    const cur = step || COACH_TEXT.end;
    const hide = h('button.ec-ibtn.ec-guide-x', { type: 'button', 'data-act': 'guide-hide', 'aria-label': step ? COACH_TEXT.fold : COACH_TEXT.close, html: icon(step ? 'chevDown' : 'x') });
    hide.style.gridColumn = '2'; hide.style.gridRow = '1';
    onTap(hide, () => { if (step) st.small = true; else st.off = true; save(s, st); render(); });
    const t = h('div.ec-guide-t', { style: { gridColumn: '1', gridRow: '1', margin: '0', fontSize: 'var(--fs-3)', lineHeight: '1.25' } },
      h('span.ec-guide-n', { text: step ? fill(COACH_TEXT.count, { n: GUIDE_STEPS.indexOf(step) + 1, total }) + ' ' : '' }), document.createTextNode(cur.title));
    const how = h('div.ec-guide-how', { text: cur.how, style: { gridColumn: step ? '1' : '1 / -1', gridRow: '2', margin: '0', alignSelf: 'center' } });
    el.append(t, hide, how);
    if (step) {
      const go = h('button.ec-act.ec-guide-go', { type: 'button', 'data-act': 'guide-go', text: COACH_TEXT.showMe, style: { gridColumn: '2', gridRow: '2', margin: '0 6px 0 0', padding: '0 14px', alignSelf: 'center' } });
      onTap(go, () => { const g = step.goFor(s); if (g && g.tool) ctx.startTool(g.tool); });
      el.append(go);
    }
  }
  render();
  return {
    el,
    /** The coach has ended (day 4 06:00, or closed after its last step): Next steps take over. */
    ended: () => st.off || lvMode || ended(),   // the level steps of a migrated hold do not hold back Next steps or intros
    levelSteps: lvMode,
    check() {
      if (st.off) return;
      if (ended()) { st.off = true; save(s, st); shown = null; render(); return; }
      const before = st.done.length;
      if (mark()) {
        save(s, st);
        // a short "done" toast for each step finished while the card was up
        const g = GUIDE_STEPS.find((x) => x.id === st.done[st.done.length - 1]);
        if (g && st.done.length > before && ctx.toast) ctx.toast(six ? fill(COACH_TEXT.done, { what: g.title.charAt(0).toLowerCase() + g.title.slice(1) }) : `Done: ${g.title.charAt(0).toLowerCase()}${g.title.slice(1)}.`);
        // the last step done: the closing card opens once, even from the small chip
        if (GUIDE_STEPS.every((x) => st.done.includes(x.id))) { st.small = false; save(s, st); }
      }
      render();
    },
    destroy() { el.remove(); document.body.classList.remove('has-guide'); },
  };
}
