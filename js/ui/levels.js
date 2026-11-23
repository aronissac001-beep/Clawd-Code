// Level controls (owner I; EMBERCROWN-FORTRESS.md 4.1-4.5, F22; Stage Z1 step E7). Only on a map with
// D > 1: a D = 1 colony never mounts this, so the Stage 2.9 shell is unchanged.
//   The capsule: [up] (44 x 44, a badge with the colonists above and a red dot for hostiles above), the
//   level chip (44 x 52: the relative level in 17 px bold tabular figures, a 14 px band swatch under it)
//   and [down] (the lowest control, where the thumb rests). Portrait: bottom right, 8 pt above the bottom
//   bar (sliding with the peek card); landscape: bottom left. The band plate beside the chip names the band.
//   Tap an arrow: one level. Hold it (450 ms): the next interesting level that way. Drag the chip
//   vertically: a relative scrub with acceleration and detents (js/game/tools/levels.js Scrub) and a label
//   bubble. Tap the chip: the depth ruler. Long-press the chip: Go to surface, Go to deepest dig.
//   Navigation stays inside the explored range: down stops at the deepest known level plus 1 ("Unexplored
//   below: dig or sound to see more"), up at the highest known solid level.
//   The capsule locks during world gestures: while a pan, pinch or tool drag owns a pointer (the shell sets
//   body.wgest), it takes no new pointer, and a tool drag crossing it keeps drawing.
//   The depth ruler: a 132 pt panel at full world height (from the right in portrait, the left in
//   landscape): "Surface 0" and "Deepest -9" on top, one 44 pt row per explored level (unexplored runs folded
//   into one row) with its colonists, hostiles (red dot), alerts (amber dot) and pending work, and "Nearest
//   stairs" at the bottom. Tapping a row jumps there and closes the ruler.
//   The ghost column (4.4): while a Mine, Carve hall, Stairs, Ramp or Channel tool is open (and 3 s after
//   Done), one 44 pt tick per level holding that tool's designations; tapping a tick jumps to the level.
// View level = the camera's `level` (UI memory, never sim state). mountLevels(root, ctx, hooks) -> api.
//   hooks: getZ(), setZ(z, why) -> bool, showCtx(p, items), centerTile(x, y), alertLevels() -> [z], toolKind() -> kind|null
import { h, clear, onTap } from './kit.js';
import { D, zS, TILE } from '../game/core/grid.js';
import { bandOfRel } from '../data/levels.js';
import { routeChevrons } from './threatui.js';
import { levelSummary, exploredRange, interestingLevels, nextInteresting, rulerRows, Scrub, levelText, toolLevels, nearestStair } from '../game/tools/levels.js';

const HOLD_MS = 450;
const GHOST_KEEP_MS = 3000;
const SVG_UP = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4 L17 14 L3 14 Z" fill="currentColor"/></svg>';
const SVG_DOWN = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 16 L17 6 L3 6 Z" fill="currentColor"/></svg>';
export const LEVEL_TEXT = Object.freeze({
  unexploredBelow: 'Unexplored below: dig or sound to see more',
  nothingAbove: 'Nothing known above',
  surface: 'Go to surface', deepest: 'Go to deepest dig', noDig: 'Nothing dug below the surface yet',
  nearest: 'Nearest stairs', noStairs: 'No stairs on this level',
});
/** "Level -4 · Outer" (the change toast and the alert explanations). */
export function levelWord(z) { return `Level ${levelText(z)} · ${bandOfRel(z - zS).short}`; }

export function mountLevels(root, ctx, hooks) {
  const s = ctx.s;
  const st = { sum: null, range: { lo: 0, hi: D - 1, deepest: null }, interest: new Set([zS]), shown: null, ruler: false, ghostUntil: 0, ghostKind: null, ghostKey: '', bubbleT: 0, scrub: null };

  // ---- DOM ------------------------------------------------------------------------------------------
  const badge = () => h('span.ec-lv-badge', { hidden: true, 'aria-hidden': 'true' }, h('b'), h('i.ec-lv-red'));
  const upB = h('button.ec-lv-btn.ec-lv-up', { type: 'button', 'data-act': 'level-up', 'aria-label': 'Up one level', html: SVG_UP });
  const dnB = h('button.ec-lv-btn.ec-lv-down', { type: 'button', 'data-act': 'level-down', 'aria-label': 'Down one level', html: SVG_DOWN });
  upB.append(badge()); dnB.append(badge());
  const chipN = h('b.ec-lv-n'), chipG = h('i.ec-lv-glyph', { 'aria-hidden': 'true' });
  const chip = h('button.ec-lv-chip', { type: 'button', 'data-act': 'level-chip', 'aria-label': 'Level' }, chipN, chipG);
  const capsule = h('div.ec-lv-capsule', { role: 'group', 'aria-label': 'Levels' }, upB, chip, dnB);
  const plate = h('div.ec-lv-plate', { 'aria-hidden': 'true' });
  const ghost = h('div.ec-lv-ghost', { hidden: true, role: 'group', 'aria-label': 'Levels with designations' });
  const bubble = h('div.ec-lv-bubble', { hidden: true, role: 'status' });
  const el = h('div.ec-levels', null, plate, ghost, capsule);   // portrait: plate, ghost, capsule (right); landscape reversed
  const rulerList = h('div.ec-ruler-list');
  const rulerHead = h('div.ec-ruler-head');
  const nearest = h('button.ec-ruler-near', { type: 'button', 'data-act': 'ruler-stairs', text: LEVEL_TEXT.nearest });
  const ruler = h('section.ec-ruler', { hidden: true, role: 'dialog', 'aria-label': 'Depth ruler' }, rulerHead, rulerList, nearest);
  const scrim = h('div.ec-ruler-scrim', { hidden: true });
  // Z3.5 route chevrons: where the threat's route preview leaves (or reaches) the view level, a 44 pt stair
  // chevron over the world; tapping it switches to the level the route goes to (the arrival one: back where
  // it came from) and centres there. Data once a second (tick), positions every frame.
  const CHEV_MAX = 6;
  const chevs = h('div.ec-lv-chevs', { 'aria-label': 'Route level changes' });
  const chevB = [];
  for (let k = 0; k < CHEV_MAX; k++) {
    const b = h('button.ec-lv-chev', { type: 'button', 'data-act': 'route-chev', style: { position: 'fixed', left: '0', top: '0', width: '44px', height: '44px', minWidth: '44px', padding: '0', border: '2px solid #f0c060', borderRadius: '10px', background: 'rgba(40,16,12,0.85)', color: '#ffd27a', fontSize: '14px', fontWeight: '700', lineHeight: '1', zIndex: '5', display: 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', touchAction: 'none' } });
    b.append(h('span.ec-lv-chev-a', { style: { width: '16px', height: '16px', display: 'block' } }), h('b', { style: { fontSize: '14px' } }));
    onTap(b, () => { const c = b._c; if (!c) return; go(c.to, 'route'); hooks.centerTile(c.x, c.y); placeChevs(); say(`Route: ${levelWord(c.to)}`, 1400); });
    chevB.push(b); chevs.append(b);
  }
  st.chev = []; st.chevPin = null;   // chevPin: a fixed route's chevrons (the phone walk)
  function chevData() { if (st.chevPin) { st.chev = st.chevPin; return; } try { st.chev = routeChevrons(s); } catch (_) { st.chev = []; } }
  function placeChevs() {
    const cur = z();
    let k = 0;
    const cv = st.chev.length && !st.ruler && ctx.cam ? document.getElementById('view') : null;
    if (cv) {
      const rc = cv.getBoundingClientRect();
      for (const c of st.chev) {
        if (k >= CHEV_MAX) break;
        if (c.from !== cur) continue;
        const q = ctx.cam.worldToScreen((c.x + 0.5) * TILE, (c.y + 0.5) * TILE), p = { x: rc.left + q.x, y: rc.top + q.y };
        if (p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight) continue;
        const b = chevB[k++];
        const up = c.to > c.from, key = `${c.to}|${up}`;
        if (b._k !== key) { b._k = key; b.firstChild.innerHTML = up ? SVG_UP : SVG_DOWN; b.lastChild.textContent = levelText(c.to); b.setAttribute('aria-label', `Route ${up ? 'goes up' : 'goes down'} to ${levelWord(c.to)}`); }
        b._c = c; b.style.transform = `translate(${Math.round(p.x - 22)}px, ${Math.round(p.y - 22)}px)`;
        if (b.style.display === 'none') b.style.display = 'flex';
      }
    }
    for (; k < CHEV_MAX; k++) if (chevB[k].style.display !== 'none') { chevB[k].style.display = 'none'; chevB[k]._c = null; }
  }
  root.append(el, bubble, scrim, ruler, chevs);
  document.body.classList.add('has-levels');

  // ---- level changes ------------------------------------------------------------------------------------
  const z = () => hooks.getZ();
  function go(nz, why = 'tap') {
    nz = Math.max(0, Math.min(D - 1, nz | 0));
    if (nz === z()) return false;
    hooks.setZ(nz, why);
    render();
    if (why !== 'scrub') say(levelWord(nz), 1200);
    return true;
  }
  function step(dir) {
    refresh();
    const cur = z(), nz = cur + dir;
    if (dir < 0 && nz < st.range.lo) { say(LEVEL_TEXT.unexploredBelow, 2000); return false; }
    if (dir > 0 && nz > st.range.hi) { say(LEVEL_TEXT.nothingAbove, 2000); return false; }
    return go(nz);
  }
  function jump(dir) {
    refresh();
    const cur = z(), t = nextInteresting(st.interest, cur, dir, st.range.lo, st.range.hi);
    if (t === cur) { say(dir < 0 ? LEVEL_TEXT.unexploredBelow : LEVEL_TEXT.nothingAbove, 2000); return false; }
    return go(t, 'jump');
  }
  function say(text, ms) {
    bubble.textContent = text; bubble.hidden = false; bubble.classList.remove('snap');
    clearTimeout(st.bubbleT); st.bubbleT = setTimeout(() => { bubble.hidden = true; }, ms);
  }
  function scrubLabel(zz) {
    const b = bandOfRel(zz - zS), sm = st.sum;
    const bits = [`${levelText(zz)} ${b.name}`];
    if (sm && sm.col[zz]) bits.push(`${sm.col[zz]} ${sm.col[zz] === 1 ? 'colonist' : 'colonists'}`);
    if (sm && sm.work[zz]) bits.push(`${sm.work[zz]} ${sm.work[zz] === 1 ? 'job' : 'jobs'}`);
    return bits.join(' · ');
  }

  // ---- the arrows: tap one level, hold for the next interesting level ---------------------------------------
  const locked = () => document.body.classList.contains('wgest');
  function arrow(btn, dir) {
    let t = 0, down = null, fired = false;
    btn.addEventListener('pointerdown', (e) => {
      if (locked() || e.button > 0) return;
      down = e.pointerId; fired = false; btn.classList.add('pressed');
      t = setTimeout(() => { if (down !== null) { fired = true; jump(dir); } }, HOLD_MS);
    });
    const end = (e, ok) => {
      if (down === null || e.pointerId !== down) return;
      down = null; clearTimeout(t); btn.classList.remove('pressed');
      if (ok && !fired) step(dir);
    };
    btn.addEventListener('pointerup', (e) => end(e, true));
    btn.addEventListener('pointercancel', (e) => end(e, false));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => { if (e.detail === 0) step(dir); });
  }
  arrow(upB, 1); arrow(dnB, -1);

  // ---- the chip: tap the ruler, long-press the menu, vertical drag the scrub --------------------------------
  {
    let down = null, t = 0;
    chip.addEventListener('pointerdown', (e) => {
      if (locked() || e.button > 0) return;
      down = { id: e.pointerId, y: e.clientY, x: e.clientX, ly: e.clientY, lt: performance.now(), long: false };
      try { chip.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointers */ }
      chip.classList.add('pressed');
      t = setTimeout(() => {
        if (!down || st.scrub) return;
        down.long = true; chip.classList.remove('pressed');
        const rc = chip.getBoundingClientRect();
        hooks.showCtx({ x: rc.left + rc.width / 2, y: rc.top }, [
          [LEVEL_TEXT.surface, () => go(zS, 'menu'), 'level-surface'],
          [LEVEL_TEXT.deepest, () => { refresh(); if (st.range.deepest === null) say(LEVEL_TEXT.noDig, 2000); else go(st.range.deepest, 'menu'); }, 'level-deepest'],
        ]);
      }, HOLD_MS);
    });
    chip.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id || down.long) return;
      const now = performance.now();
      if (!st.scrub) {
        if (Math.abs(e.clientY - down.y) < 6) return;
        clearTimeout(t); refresh();
        st.scrub = new Scrub(z(), st.range.lo, st.range.hi, st.interest);
        document.body.classList.add('lv-scrub');
        down.ly = down.y; down.lt = now - 16;
      }
      const nz = st.scrub.move(e.clientY - down.ly, now - down.lt);
      down.ly = e.clientY; down.lt = now;
      if (nz !== z()) go(nz, 'scrub');
      bubble.textContent = scrubLabel(nz); bubble.hidden = false; bubble.classList.toggle('snap', st.scrub.snapped || st.interest.has(nz));
      clearTimeout(st.bubbleT);
    });
    const end = (e, ok) => {
      if (!down || e.pointerId !== down.id) return;
      clearTimeout(t); chip.classList.remove('pressed');
      const wasScrub = !!st.scrub, wasLong = down.long;
      down = null; st.scrub = null; document.body.classList.remove('lv-scrub');
      if (wasScrub) { st.bubbleT = setTimeout(() => { bubble.hidden = true; }, 700); return; }
      if (ok && !wasLong) openRuler();
    };
    chip.addEventListener('pointerup', (e) => end(e, true));
    chip.addEventListener('pointercancel', (e) => end(e, false));
    chip.addEventListener('contextmenu', (e) => e.preventDefault());
    chip.addEventListener('click', (e) => { if (e.detail === 0) openRuler(); });
  }

  // ---- the depth ruler ---------------------------------------------------------------------------------------
  function openRuler() {
    refresh();
    st.ruler = true; ruler.hidden = false; scrim.hidden = false;
    document.body.classList.add('has-ruler');
    renderRuler();
    const on = rulerList.querySelector('.on');
    if (on) rulerList.scrollTop = Math.max(0, on.offsetTop - rulerList.clientHeight / 2 + on.offsetHeight / 2);
  }
  function closeRuler() { st.ruler = false; ruler.hidden = true; scrim.hidden = true; document.body.classList.remove('has-ruler'); }
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); closeRuler(); });
  onTap(nearest, () => {
    const c = ctx.cam, tx = Math.floor(c.x / 32), ty = Math.floor(c.y / 32);
    const p = nearestStair(s, z(), tx, ty);
    if (!p) { say(LEVEL_TEXT.noStairs, 2000); return; }
    closeRuler(); hooks.centerTile(p.x, p.y);
  });
  function renderRuler() {
    const sm = st.sum, r = st.range, cur = z(), alerts = new Set(hooks.alertLevels());
    clear(rulerHead);
    rulerHead.append(h('div', { text: `Surface ${levelText(zS)}` }), h('div', { text: r.deepest === null ? 'Deepest: none' : `Deepest ${levelText(r.deepest)}` }));
    const sc = rulerList.scrollTop;
    clear(rulerList);
    for (const row of rulerRows(sm, r)) {
      if (row.kind === 'fold') { rulerList.append(h('div.ec-ruler-fold', { text: `Unexplored · ${row.n} ${row.n === 1 ? 'level' : 'levels'}` })); continue; }
      const zz = row.z, b = bandOfRel(zz - zS);
      const sub = [];
      if (sm.col[zz]) sub.push(`${sm.col[zz]} here`);
      if (sm.work[zz]) sub.push(`${sm.work[zz]} jobs`);
      const dots = h('span.ec-ruler-dots', null, sm.foe[zz] ? h('i.red', { 'aria-label': 'Hostiles' }) : null, alerts.has(zz) ? h('i.amber', { 'aria-label': 'Alert' }) : null);
      const b0 = h('button.ec-ruler-row' + (zz === cur ? '.on' : ''), { type: 'button', 'data-act': 'ruler-row', 'data-z': String(zz), style: { '--tint': b.tint } },
        h('span.ec-ruler-t', null, h('b', { text: levelText(zz) }), ` · ${b.short}`), dots, h('span.ec-ruler-sub', { text: sub.join(' · ') || ' ' }));
      onTap(b0, () => { closeRuler(); go(zz, 'ruler'); });
      rulerList.append(b0);
    }
    rulerList.scrollTop = sc;
  }

  // ---- the ghost column ----------------------------------------------------------------------------------------
  /** kind: the open tool's designation kind ('mine', 'carve', 'stairs', 'ramp', 'channel') or null; keep: the 3 s after Done. */
  function setGhost(kind) {
    if (kind) { st.ghostKind = kind; st.ghostUntil = Infinity; }
    else if (st.ghostKind && st.ghostUntil === Infinity) { st.ghostUntil = performance.now() + GHOST_KEEP_MS; setTimeout(() => renderGhost(true), GHOST_KEEP_MS + 50); }
    renderGhost(true);
  }
  function renderGhost(force = false) {
    const live = st.ghostKind && performance.now() < st.ghostUntil;
    if (!live) { if (!ghost.hidden) { ghost.hidden = true; clear(ghost); st.ghostKey = ''; } if (st.ghostKind && st.ghostUntil !== Infinity) st.ghostKind = null; return; }
    const lv = [...toolLevels(s, st.ghostKind)].sort((a, b) => b - a), cur = z();
    const key = lv.join(',') + ':' + cur;
    if (!force && key === st.ghostKey) return;
    st.ghostKey = key;
    clear(ghost);
    ghost.hidden = !lv.length;
    for (const zz of lv) {
      const b = h('button.ec-lv-tick' + (zz === cur ? '.on' : ''), { type: 'button', 'data-act': 'ghost-tick', 'data-z': String(zz), 'aria-label': `Designations on level ${levelText(zz)}` }, h('i'), h('span', { text: levelText(zz) }));
      onTap(b, () => go(zz, 'ghost'));
      ghost.append(b);
    }
    ghost.scrollTop = ghost.scrollHeight;   // the deepest tick sits nearest the thumb
  }

  // ---- refresh -------------------------------------------------------------------------------------------------
  function refresh() {
    st.sum = levelSummary(s);
    st.range = exploredRange(st.sum);
    st.interest = interestingLevels(st.sum, hooks.alertLevels());
  }
  function setBadge(btn, n, red) {
    const bd = btn.querySelector('.ec-lv-badge');
    bd.hidden = !n && !red;
    bd.querySelector('b').textContent = n ? String(n) : '';
    bd.querySelector('.ec-lv-red').hidden = !red;
  }
  function render() {
    const cur = z(), sm = st.sum, b = bandOfRel(cur - zS);
    const key = `${cur}|${b.id}|${st.range.lo}|${st.range.hi}`;
    if (sm) {
      let ca = 0, cb = 0, fa = 0, fb = 0;
      for (let k = 0; k < sm.d; k++) { if (k > cur) { ca += sm.col[k]; fa += sm.foe[k]; } else if (k < cur) { cb += sm.col[k]; fb += sm.foe[k]; } }
      setBadge(upB, ca, fa > 0); setBadge(dnB, cb, fb > 0);
      upB.setAttribute('aria-label', `Up one level${ca ? `, ${ca} colonists above` : ''}${fa ? ', hostiles above' : ''}`);
      dnB.setAttribute('aria-label', `Down one level${cb ? `, ${cb} colonists below` : ''}${fb ? ', hostiles below' : ''}`);
    }
    upB.classList.toggle('end', cur >= st.range.hi); dnB.classList.toggle('end', cur <= st.range.lo);
    if (key === st.shown) return;
    st.shown = key;
    chipN.textContent = levelText(cur);
    chipG.style.background = b.tint;
    chip.setAttribute('aria-label', `${levelWord(cur)}. Tap for the depth ruler, drag to scrub`);
    plate.textContent = b.short;
    if (st.ruler) renderRuler();
    renderGhost(true);
  }
  refresh(); render();

  return {
    el, capsule, ruler, bubble, ghost, st,
    /** Once a second: the summary, badges, the ruler and the ghost column. */
    tick() { refresh(); render(); if (st.ruler) renderRuler(); renderGhost(); chevData(); placeChevs(); },
    /** Every frame: the chip follows a level set elsewhere (Follow, an alert, the rail). */
    frame() { if (st.shown === null || !st.shown.startsWith(z() + '|')) render(); if (st.chev.length || chevB[0].style.display !== 'none') placeChevs(); },
    chevrons: () => st.chev,
    go, step, jump, openRuler, closeRuler, setGhost, renderGhost, say,
    get rulerOpen() { return st.ruler; },
    destroy() { chevs.remove(); el.remove(); bubble.remove(); ruler.remove(); scrim.remove(); clearTimeout(st.bubbleT); document.body.classList.remove('has-levels', 'has-ruler', 'lv-scrub'); },
  };
}
