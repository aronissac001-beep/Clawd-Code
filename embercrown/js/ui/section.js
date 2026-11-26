// The section view (owner I; EMBERCROWN-FORTRESS.md 4.1, Stage Z4): a read-only side cut through the hold that
// shows every explored level at once along a line the player picks. Opened from the depth ruler ("Section
// view") or the chip's long-press menu. The cut runs through the camera centre, west-east by default; the
// axis button turns it north-south and the two arrow buttons move the line 4 tiles. Touch a level row and
// lift to jump there (the row under the finger is lit while it moves, so 8-12 pt rows are safe to aim at).
//   mountSection(root, ctx, { range, go, z }) -> { open(), close(), get isOpen, el, destroy() }
// Draws with js/engine/render/section.js. Never mutates sim state; the line and axis are view state only.

import { h, onTap } from './kit.js';
import { W, H, TILE, zS } from '../game/core/grid.js';
import { levelText } from '../game/tools/levels.js';
import { bandOfRel } from '../data/levels.js';
import { sectionImage, drawSection } from '../engine/render/section.js';

const STEP = 4;
const textScale = () => { try { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ts')) || 1; } catch (_) { return 1; } };

export function mountSection(root, ctx, hooks) {
  const s = ctx.s;
  const st = { open: false, axis: 'x', line: 0, pick: null, lay: null, img: null, down: null };
  const title = h('div.ec-sec-title', { role: 'heading', 'aria-level': '2' });
  const axisB = h('button.ec-sec-btn', { type: 'button', 'data-act': 'section-axis', 'aria-label': 'Turn the cut' });
  const prevB = h('button.ec-sec-btn', { type: 'button', 'data-act': 'section-prev', 'aria-label': 'Move the cut north', text: '‹' });
  const nextB = h('button.ec-sec-btn', { type: 'button', 'data-act': 'section-next', 'aria-label': 'Move the cut south', text: '›' });
  const closeB = h('button.ec-sec-btn.ec-sec-x', { type: 'button', 'data-act': 'section-close', 'aria-label': 'Close the section view', text: '×' });
  const cv = h('canvas.ec-sec-cv', { role: 'img', 'aria-label': 'Side cut through the hold' });
  const hint = h('div.ec-sec-hint', { role: 'status', text: 'Touch a level to go there' });
  const el = h('section.ec-section', { hidden: true, role: 'dialog', 'aria-label': 'Section view' },
    h('div.ec-sec-head', null, title, h('div.ec-sec-tools', null, axisB, prevB, nextB, closeB)), cv, hint);
  const scrim = h('div.ec-sec-scrim', { hidden: true });
  root.append(scrim, el);

  const camTile = () => { const c = ctx.cam; return c ? { x: Math.floor(c.x / TILE), y: Math.floor(c.y / TILE) } : { x: W >> 1, y: H >> 1 }; };
  function labels() {
    const ew = st.axis === 'x';
    title.textContent = ew ? `Row ${st.line}, west to east` : `Column ${st.line}, north to south`;
    axisB.textContent = ew ? 'N-S' : 'W-E';
    axisB.setAttribute('aria-label', ew ? 'Turn the cut north to south' : 'Turn the cut west to east');
    prevB.setAttribute('aria-label', ew ? 'Move the cut north' : 'Move the cut west');
    nextB.setAttribute('aria-label', ew ? 'Move the cut south' : 'Move the cut east');
  }
  function draw() {
    if (!st.open) return;
    const r = hooks.range(), zHi = r.hi, zLo = Math.max(0, r.lo);
    st.img = sectionImage(s, st.axis, st.line, zLo, zHi);
    const ct = camTile(), ew = st.axis === 'x';
    const cols = [];
    for (const c of s.col) {
      if (!c || (c.hp && c.hp.dead)) continue;
      const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);   // colonists stand in world units
      if (Math.abs((ew ? ty : tx) - st.line) <= 2) cols.push({ k: ew ? tx : ty, z: c.z | 0 });
    }
    st.lay = drawSection(cv, st.img, { viewZ: hooks.z(), mark: ew ? ct.x : ct.y, cols, pick: st.pick, ts: textScale() });
    const z = st.pick !== null ? st.pick : hooks.z();
    hint.textContent = st.pick !== null ? `Lift to go to Level ${levelText(z)} · ${bandOfRel(z - zS).short}` : 'Touch a level to go there';
    cv.setAttribute('aria-label', `Side cut through the hold, levels ${levelText(zHi)} to ${levelText(zLo)}`);
  }
  const rowAt = (e) => {
    const L = st.lay, img = st.img;
    if (!L || !img || !img.rows) return null;
    const rc = cv.getBoundingClientRect(), y = e.clientY - rc.top - L.top;
    const r = Math.floor(y / L.rowH);
    return r < 0 || r >= img.rows ? null : img.zHi - r;
  };
  cv.addEventListener('pointerdown', (e) => { st.down = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic */ } st.pick = rowAt(e); draw(); });
  cv.addEventListener('pointermove', (e) => { if (st.down !== e.pointerId) return; const p = rowAt(e); if (p !== st.pick) { st.pick = p; draw(); } });
  cv.addEventListener('pointerup', (e) => { if (st.down !== e.pointerId) return; st.down = null; const p = rowAt(e); st.pick = null; if (p !== null) { close(); hooks.go(p); } else draw(); });
  cv.addEventListener('pointercancel', () => { st.down = null; st.pick = null; draw(); });
  const lim = () => (st.axis === 'x' ? H : W) - 1;
  onTap(axisB, () => { const ct = camTile(); st.axis = st.axis === 'x' ? 'y' : 'x'; st.line = st.axis === 'x' ? ct.y : ct.x; labels(); draw(); });
  onTap(prevB, () => { st.line = Math.max(0, st.line - STEP); labels(); draw(); });
  onTap(nextB, () => { st.line = Math.min(lim(), st.line + STEP); labels(); draw(); });
  onTap(closeB, () => close());
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  const onResize = () => draw();

  function open() {
    const ct = camTile();
    st.open = true; st.pick = null; st.line = st.axis === 'x' ? ct.y : ct.x;
    el.hidden = false; scrim.hidden = false; document.body.classList.add('has-section');
    window.addEventListener('resize', onResize);
    labels(); draw();
  }
  function close() {
    if (!st.open) return;
    st.open = false; el.hidden = true; scrim.hidden = true; document.body.classList.remove('has-section');
    window.removeEventListener('resize', onResize);
  }
  return {
    el, st, open, close, draw,
    get isOpen() { return st.open; },
    destroy() { close(); el.remove(); scrim.remove(); },
  };
}
