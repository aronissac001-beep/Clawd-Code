// Accessibility, part 1 (owner I; EMBERCROWN-WORLD.md 8.10, 11 item 14, 12.3 W1.9).
//   installA11y(doc)   once per page (letters.js mountLetters calls it): every sheet (.ec-sheet, the section
//                      view) is a modal dialog while it shows: role="dialog", aria-modal="true", focus moves in
//                      on open and back to the opener on close, Tab and Shift+Tab stay inside (the focus trap),
//                      Escape goes back one screen or closes. A dialog that opens a letter (.ec-letter) is read
//                      out through the live region (letters are live, 8.10). Toasts and the alert stack get
//                      aria-live="polite" (the shell builds them; this only makes sure).
//   announce(text)     says `text` through one hidden polite live region (alerts.js: a new alert; letters).
//   contrast(fg, bg), parseColor(css), over(fg, bg)   WCAG 2.x relative-luminance contrast on sRGB colours.
//   tokenContrast(doc) every text token (--text, --dim, ...) on every panel token (--bg, --surface, ...) read
//                      from the live :root, with the ratio; TEXT_MIN = 4.5.
//   sweepContrast(root) every visible text node under root, its computed colour on its effective panel (the
//                      ancestors' backgrounds composited, gradients at their worst stop); disabled and locked
//                      controls are exempt (WCAG 1.4.3 inactive components); text drawn over the map canvas is
//                      counted as `overMap` and not judged (its backdrop is the live picture).
// UI only: nothing here reads or writes sim state. Node-safe: no DOM is touched at import time.

export const TEXT_MIN = 4.5;
/** The colour tokens text is drawn in (css/style.css :root). --bad is the fill and icon red (bars, rings, icons:
 *  WCAG 1.4.11 asks 3:1 of those); red text uses --bad-text. */
export const TEXT_TOKENS = Object.freeze(['--text', '--dim', '--faint', '--brass', '--brass-hi', '--ember', '--amber', '--good', '--warn', '--bad-text']);
/** The panels text sits on; translucent ones are composited over --bg (the page under the sheets). */
export const PANEL_TOKENS = Object.freeze(['--bg', '--surface', '--surface-2', '--raised', '--raised-hi', '--sel', '--panel', '--glass']);
/** Pairs outside the matrix: [text, panel]. */
export const EXTRA_PAIRS = Object.freeze([['--bad-text', '--bad-bg'], ['--text', '--bad-bg'], ['--on-primary', '#f0bd62'], ['--on-primary', '#cf9238']]);

// ---- colour maths --------------------------------------------------------------------------------------
/** [r, g, b, a] (0-255, a 0-1) from a CSS colour string (#rgb, #rrggbb(aa), rgb(), rgba(), space syntax), or null. */
export function parseColor(str) {
  if (!str) return null;
  const s = String(str).trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  if (s[0] === '#') {
    const x = s.slice(1);
    const hx = x.length <= 4 ? [...x].map((c) => c + c).join('') : x;
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hx)) return null;
    const v = [0, 2, 4].map((i) => parseInt(hx.slice(i, i + 2), 16));
    return [...v, hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map((t, i) => (t.endsWith('%') ? (i < 3 ? parseFloat(t) * 2.55 : parseFloat(t) / 100) : parseFloat(t)));
  if (p.length < 3 || p.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
  return [p[0], p[1], p[2], p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1];
}
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of an opaque [r, g, b]. */
export const luminance = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
/** `fg` (with its alpha) painted over the opaque `bg`. */
export function over(fg, bg) {
  const a = fg.length > 3 ? fg[3] : 1;
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}
/** Contrast ratio (1..21) of fg on bg; a translucent fg is composited over bg first. */
export function contrast(fg, bg) {
  const f = typeof fg === 'string' ? parseColor(fg) : fg, b = typeof bg === 'string' ? parseColor(bg) : bg;
  if (!f || !b) return 0;
  const x = luminance(over(f, b)), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const round2 = (v) => Math.round(v * 100) / 100;

/** The token matrix from the live :root: [{ fg, bg, ratio, ok }] (translucent panels over --bg). */
export function tokenContrast(doc = globalThis.document) {
  const cs = getComputedStyle(doc.documentElement);
  const tok = (n) => (n[0] === '#' ? parseColor(n) : parseColor(cs.getPropertyValue(n)));
  const base = tok('--bg') || [22, 19, 27, 1];
  const panel = (n) => { const c = tok(n); return c ? over(c, base) : null; };
  const out = [];
  const pair = (f, b) => { const fc = tok(f), bc = panel(b); if (!fc || !bc) { out.push({ fg: f, bg: b, ratio: 0, ok: false, missing: true }); return; } const r = round2(contrast(fc, bc)); out.push({ fg: f, bg: b, ratio: r, ok: r >= TEXT_MIN }); };
  for (const f of TEXT_TOKENS) for (const b of PANEL_TOKENS) pair(f, b);
  for (const [f, b] of EXTRA_PAIRS) pair(f, b);
  return out;
}

/** Contrast of every visible text node under `root` on its effective panel. */
export function sweepContrast(root = globalThis.document.body) {
  const doc = root.ownerDocument || root;
  const base = parseColor(getComputedStyle(doc.documentElement).getPropertyValue('--bg')) || [22, 19, 27, 1];
  const fails = [], seen = new Set();
  let checked = 0, overMap = 0, exempt = 0;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  // a linear gradient is judged at its worst stop; a radial one at its centre stop (text sits in the middle:
  // the portrait initial on the face), the first layer of several
  const stops = (img) => {
    if (!img || img === 'none') return [];
    const first = img.split(/,\s*(?=(?:linear|radial|conic|repeating)-gradient|url\()/)[0];
    const all = (first.match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/gi) || []).map(parseColor).filter(Boolean);
    return /^radial/.test(first) ? all.slice(0, 1) : all;
  };
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !n.textContent.trim() || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('[hidden], [aria-hidden="true"], .ec-sr-live')) continue;
    if (!vis(el)) continue;
    if (el.closest(':disabled, [aria-disabled="true"], .locked, .dim')) { exempt++; continue; }
    // the stack of backgrounds from the text up to the first opaque one; opacity multiplies the text
    let alpha = 1;
    const layers = [];
    let opaque = false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      alpha *= +cs.opacity;
      const g = stops(cs.backgroundImage), c = parseColor(cs.backgroundColor);
      if (g.length) { layers.push({ g }); if (g.every((x) => x[3] >= 0.99)) { opaque = true; break; } }
      if (c && c[3] > 0) { layers.push({ c }); if (c[3] >= 0.99) { opaque = true; break; } }
      if (e.tagName === 'CANVAS') break;
    }
    const coverage = layers.reduce((a, l) => 1 - (1 - a) * (1 - (l.c ? l.c[3] : Math.min(...l.g.map((x) => x[3])))), 0);
    if (!opaque && coverage < 0.5) { overMap++; continue; }
    // composite bottom-up; for gradients take each stop and keep the worst ratio
    const fg0 = parseColor(getComputedStyle(el).color);
    if (!fg0) continue;
    const fg = [fg0[0], fg0[1], fg0[2], fg0[3] * alpha];
    let bgs = [opaque ? null : base];
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i], cols = l.c ? [l.c] : l.g;
      const nx = [];
      for (const b of bgs) for (const c of cols) nx.push(b ? over(c, b) : over(c, [0, 0, 0, 1]));
      bgs = nx.slice(0, 16);
    }
    checked++;
    let ratio = Infinity, worst = bgs[0];
    for (const b of bgs) { const r = contrast(fg, b); if (r < ratio) { ratio = r; worst = b; } }
    if (ratio < TEXT_MIN - 0.005) {
      const rgb = (c) => `rgb(${c.slice(0, 3).map(Math.round).join(',')})`;
      fails.push({ text: n.textContent.trim().slice(0, 28), cls: (el.className && el.className.baseVal === undefined ? String(el.className) : '').split(' ')[0] || el.tagName.toLowerCase(), fg: rgb(over(fg, worst)), bg: rgb(worst), ratio: round2(ratio) });
    }
  }
  return { checked, overMap, exempt, fails };
}

// ---- the live region -------------------------------------------------------------------------------------
let live = null, liveTimer = 0;
function liveRegion(doc) {
  if (live && live.isConnected) return live;
  live = doc.createElement('div');
  live.className = 'ec-sr-live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  // visually hidden (no stylesheet rule needed): 1 px, clipped, off the layout
  live.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;font-size:16px;pointer-events:none';
  doc.body.append(live);
  return live;
}
/** Say `text` politely (a no-op without a document, e.g. in node tests). Repeating the same text says it again. */
export function announce(text) {
  const doc = globalThis.document;
  if (!doc || !doc.body || !text) return;
  const el = liveRegion(doc);
  el.textContent = '';
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { el.textContent = String(text); }, 40);
}
/** What the live region says now (tests). */
export const announced = () => (live ? live.textContent : '');

// ---- dialogs: aria-modal, focus in and back, the trap, Escape ------------------------------------------
const MODAL = '.ec-sheet, .ec-section';
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const shown = (el) => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0;
/** The focusable controls inside `el`, in order, that can be seen. */
export function focusables(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter((x) => shown(x) && getComputedStyle(x).visibility !== 'hidden');
}

let installed = null;
/** Install the dialog and live-region rules on `doc` (idempotent). Returns { open(), destroy() }. */
export function installA11y(doc = globalThis.document) {
  if (!doc || !doc.body || typeof MutationObserver === 'undefined') return { open: () => [], destroy() {} };
  if (installed && installed.doc === doc) return installed.api;
  const stack = [];                 // open modals, oldest first: { el, opener }
  let keyMode = false;              // the last input was a key (then focus that strays is pulled back)
  const top = () => (stack.length ? stack[stack.length - 1].el : null);
  const letterLine = (el) => {
    const body = el.querySelector('.ec-letter');
    if (!body) return null;
    const t = el.getAttribute('aria-label') || '', p = body.querySelector('.ec-letter-t');
    return `${t}. ${p ? p.textContent : ''}`.trim();
  };
  function opened(el) {
    if (stack.some((x) => x.el === el)) return;
    const act = doc.activeElement;
    stack.push({ el, opener: act && act !== doc.body && !el.contains(act) ? act : null });
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    if (!el.contains(doc.activeElement)) { try { el.focus({ preventScroll: true }); } catch (_) { /* old engines */ } }
    const line = letterLine(el);
    if (line) announce(line);
  }
  function closed(el) {
    const k = stack.findIndex((x) => x.el === el);
    if (k < 0) return;
    const [{ opener }] = stack.splice(k, 1);
    el.setAttribute('aria-modal', 'false');
    const act = doc.activeElement;
    if (!act || act === doc.body || el.contains(act)) {
      const next = top();
      const to = opener && opener.isConnected && shown(opener) ? opener : next;
      if (to) { try { to.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
    }
  }
  const sync = () => {
    for (const el of doc.querySelectorAll(MODAL)) { if (shown(el)) opened(el); else closed(el); }
    for (const x of [...stack]) if (!x.el.isConnected) closed(x.el);
  };
  // a sheet re-renders its content in place: a letter shown in an already open sheet is read out too
  let lastLetter = '';
  const mo = new MutationObserver((recs) => {
    let re = false;
    for (const r of recs) if (r.type === 'attributes' || r.addedNodes.length || r.removedNodes.length) { re = true; break; }
    if (!re) return;
    sync();
    const t = top();
    const line = t ? letterLine(t) : null;
    if (line && line !== lastLetter) { lastLetter = line; announce(line); }
    if (!line) lastLetter = '';
    if (t && keyMode && (!doc.activeElement || doc.activeElement === doc.body)) { try { t.focus({ preventScroll: true }); } catch (_) { /* gone */ } }
    for (const q of doc.querySelectorAll('.ec-toasts, .ec-alerts')) if (q.getAttribute('aria-live') !== 'polite') q.setAttribute('aria-live', 'polite');
  });
  mo.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  const onKey = (e) => {
    keyMode = true;
    const t = top();
    if (!t) return;
    if (e.key === 'Tab') {
      const list = focusables(t);
      if (!list.length) { e.preventDefault(); try { t.focus({ preventScroll: true }); } catch (_) { /* gone */ } return; }
      const first = list[0], last = list[list.length - 1], act = doc.activeElement;
      const inside = t.contains(act);
      if (e.shiftKey && (!inside || act === first || act === t)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || act === last)) { e.preventDefault(); first.focus(); }
    }
  };
  // Escape: the sheet engine handles it with focus inside; from anywhere else, back one screen or close
  const onKeyUp = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = top();
    if (!t || t.contains(doc.activeElement)) return;
    const b = t.querySelector('[data-act="sheet-back"]') || t.querySelector('[data-act="close-sheet"], [data-act="close"], .ec-close');
    if (b) { e.preventDefault(); b.click(); }
  };
  const onFocusIn = (e) => {
    const t = top();
    if (t && keyMode && !t.contains(e.target) && !(e.target.closest && e.target.closest('.ec-toasts'))) { const list = focusables(t); (list[0] || t).focus({ preventScroll: true }); }
  };
  const onPointer = () => { keyMode = false; };
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('keydown', onKeyUp);
  doc.addEventListener('focusin', onFocusIn);
  doc.addEventListener('pointerdown', onPointer, true);
  liveRegion(doc);
  sync();
  const api = {
    open: () => stack.map((x) => x.el),
    destroy() {
      mo.disconnect();
      doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('keydown', onKeyUp);
      doc.removeEventListener('focusin', onFocusIn); doc.removeEventListener('pointerdown', onPointer, true);
      installed = null;
    },
  };
  installed = { doc, api };
  return api;
}
