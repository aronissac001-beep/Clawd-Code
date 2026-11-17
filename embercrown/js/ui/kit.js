// Small widget kit for the colony UI (owner I). DOM helpers, a fast tap handler and the icon lookup.
// Icons come from icons.js (owner D); the few the shell needs that icons.js does not have yet are
// drawn here (UI_GLYPHS) until D adds them there. Headless-safe: nothing touches the DOM at import.
import { icon as baseIcon } from './icons.js';

/** Extra 24x24 glyphs (season marks, chevrons, tabs). Original paths. D: move these into icons.js. */
export const UI_GLYPHS = {
  thaw: '<path d="M12 21v-8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 13c-4 0-6-3-6-7 4 0 6 3 6 7zm0 0c4 0 6-3 6-7-4 0-6 3-6 7z"/>',
  highsun: '<circle cx="12" cy="12" r="5"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g>',
  ashfall: '<path d="M5 19C5 10 11 4 20 4c0 9-6 15-15 15z"/><path d="M5 19l9-9" stroke="#2a1e18" stroke-width="1.6" fill="none"/>',
  deepcold: '<g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5L12 6l2.5-2.5M9.5 20.5L12 18l2.5 2.5"/></g>',
  chevDown: '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  chev: '<path d="M8 5l8 7-8 7" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  orders: '<path d="M3 8c5-5 13-5 18 0-3-1.5-6-2-8-1.5L6 21l-2.5-1L11 7c-3-.3-5.5.2-8 1z"/>',
  zones: '<path d="M4 4h7v7H4zM13 13h7v7h-7z"/><path d="M13 4h7v7h-7zM4 13h7v7H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/>',
  colony: '<circle cx="8" cy="8" r="3.2"/><circle cx="16" cy="8" r="3.2"/><path d="M2 20c0-4 2.7-7 6-7s6 3 6 7zM10 20c0-4 2.7-7 6-7s6 3 6 7z"/>',
  build: '<path d="M3 7l6-4 3 3-1.5 1.5L21 18l-3 3L7.5 10.5 6 12z"/>',
  horde: '<path d="M12 2a8 8 0 00-8 8c0 2.6 1.3 4.4 2.7 5.4V20h10.6v-4.6C18.7 14.4 20 12.6 20 10a8 8 0 00-8-8z"/><circle cx="9" cy="10" r="2" fill="#2a1e18"/><circle cx="15" cy="10" r="2" fill="#2a1e18"/>',
  alert: '<path d="M12 2l10 18H2z"/><rect x="11" y="8" width="2" height="7" rx="1" fill="#2a1e18"/><circle cx="12" cy="17.5" r="1.3" fill="#2a1e18"/>',
  hunger: '<path d="M7 2v8a3 3 0 006 0V2M10 2v20M17 2c-2 2-2 6-2 9h3v11h-1" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
  bed: '<path d="M2 18V6M2 14h20v4M22 14v-3a3 3 0 00-3-3h-8v6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="6.5" cy="10.5" r="2"/>',
  rooms: '<path d="M3 3h18v18H3z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 3v7M3 12h6M15 12h6M12 15v6" stroke="currentColor" stroke-width="2.4"/><rect x="10" y="10" width="4" height="4" rx="1"/>',
  door: '<path d="M5 21V4a1 1 0 011-1h12a1 1 0 011 1v17z" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M8 21V6h8v15" /><circle cx="14" cy="13" r="1.3" fill="#2a1e18"/><path d="M3 21h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  floor: '<path d="M2 8h20M2 14h20M2 20h20M8 2v6M16 8v6M8 14v6M2 2h20" stroke="currentColor" stroke-width="2" fill="none"/>',
  prop: '<path d="M4 4h16v3H4z"/><path d="M10 7h4v14h-4z"/><path d="M6 21h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  pillar: '<path d="M5 3h14v3H5zM5 18h14v3H5z"/><path d="M8 6h8v12H8z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 7v10M13.5 7v10" stroke="currentColor" stroke-width="1.2"/>',
  table: '<path d="M2 8h20v3H2z"/><path d="M5 11v9M19 11v9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  chair: '<path d="M7 3v9h10" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 12h12v3H6z"/><path d="M7 15v6M17 15v6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  saw: '<path d="M3 17L17 3l3 3L6 20z"/><path d="M6 20l-1 1M9 17l-1 1M12 14l-1 1M15 11l-1 1" stroke="#2a1e18" stroke-width="1.4"/><path d="M17 3l4-1-1 4z"/>',
  crate: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3 7l9 4 9-4M12 11v10" stroke="currentColor" stroke-width="2" fill="none"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  carve: '<path d="M2 21V9l5-5h10l5 5v12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="2.6"/><path d="M6 21v-6M18 21v-6" stroke="currentColor" stroke-width="2"/>',
  rotate: '<path d="M20 12a8 8 0 11-2.4-5.7" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M20 3v6h-6z"/>',
  back: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  undo: '<path d="M9 14L4 9l5-5" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 9h10a6 6 0 010 12h-3" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
};
export function icon(name, cls = '') {
  const g = UI_GLYPHS[name];
  if (g) return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${g}</svg>`;
  return baseIcon(name, cls);
}

/** h('button.ec-btn.big', { onclick, 'aria-label': 'x' }, child | text | [children]) */
export function h(spec, attrs, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const e = document.createElement(tag || 'div');
  if (cls.length) e.className = cls.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } }
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
export const clear = (e) => { while (e.firstChild) e.removeChild(e.firstChild); return e; };

/**
 * Fast tap: fires on pointerup inside the element if the finger moved less than 24 pt, with an
 * instant pressed state. Optional long-press (450 ms, doc 10.2). Disabled elements never fire.
 */
export function onTap(el, fn, { longpress = null, ms = 450 } = {}) {
  let down = null, t = 0, fired = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    down = { x: e.clientX, y: e.clientY, id: e.pointerId }; fired = false;
    el.classList.add('pressed');
    if (longpress) t = setTimeout(() => { if (down) { fired = true; el.classList.remove('pressed'); longpress(e); } }, ms);
  });
  const end = (e, ok) => {
    if (!down || e.pointerId !== down.id) return;
    const d = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null; clearTimeout(t); el.classList.remove('pressed');
    if (ok && !fired && d < 24 && !el.disabled && el.getAttribute('aria-disabled') !== 'true') fn(e);
  };
  el.addEventListener('pointerup', (e) => end(e, true));
  el.addEventListener('pointercancel', (e) => end(e, false));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // keyboard and assistive tech
  el.addEventListener('click', (e) => { if (e.detail === 0 && !el.disabled) fn(e); });
  return el;
}

/** One-lane toast queue under the top bar (10.6): 3 s each, duplicates dropped, at most 3 waiting. */
export class Toaster {
  constructor(root) { this.root = root; this.q = []; this.cur = null; this.t = 0; }
  show(text, tone = '') {
    if (!text || (this.cur && this.cur.text === text) || this.q.some((x) => x.text === text)) return;
    this.q.push({ text, tone }); while (this.q.length > 3) this.q.shift();
    if (!this.cur) this.next();
  }
  next() {
    clearTimeout(this.t);
    if (this.cur) this.cur.node.remove();
    this.cur = null;
    const m = this.q.shift();
    if (!m) return;
    const node = h('div.ec-toast' + (m.tone ? '.' + m.tone : ''), { role: 'status', text: m.text });
    onTap(node, () => this.next());
    this.root.append(node);
    this.cur = { ...m, node };
    this.t = setTimeout(() => this.next(), 3000);
  }
  clear() { this.q.length = 0; this.next(); }
}
