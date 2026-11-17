// One message lane (rework stream F). A single line above the bottom bar shows one message at
// a time from a short queue: a message already showing or waiting is dropped, nothing shows
// while a dialog is open in a region (the queue waits and stale lines expire), and a long queue keeps only
// the newest few. The lane's position comes from the HUD (--lane-b on #root).
import { el } from './dom.js';
import { icon } from './icons.js';

const MAX_QUEUE = 3;
const STALE_MS = 9000;  // a line that waited this long behind a dialog is no longer news
const FADE_MS = 220;

export class Toasts {
  constructor(root) {
    this.root = root;
    this.queue = [];
    this.cur = null;     // { node, text, until }
    this.fading = null;  // node on its way out
    this.timer = setInterval(() => this.pump(), 120);
  }
  /** In a region a dialog silences the lane (menus keep their feedback over their dialogs). */
  modalOpen() {
    const m = document.getElementById('modal');
    const a = typeof window !== 'undefined' ? window.embercrown : null;
    return !!(m && m.classList.contains('open') && a && a.ctl && a.ctl.active);
  }

  show(text, tone = '', ic = null, ms = 3000) {
    if (!text) return;
    const now = performance.now();
    if (this.cur && this.cur.text === text) { this.cur.until = Math.max(this.cur.until, now + ms * 0.6); return; }
    if (this.queue.some((q) => q.text === text)) return;
    this.queue.push({ text, tone, ic, ms, at: now });
    while (this.queue.length > MAX_QUEUE) this.queue.shift();
    this.pump();
  }

  pump() {
    const now = performance.now();
    if (this.modalOpen()) {
      if (this.cur) { this.cur.node.remove(); this.cur = null; }
      if (this.fading) { this.fading.remove(); this.fading = null; }
      return;
    }
    if (this.fading) return; // the lane holds one node at a time
    if (this.cur) {
      // Others waiting: a line gives way sooner, but is always readable for a moment.
      const until = this.queue.length ? Math.min(this.cur.until, this.cur.shown + 2200) : this.cur.until;
      if (now < until) return;
      this.drop();
      return;
    }
    while (this.queue.length && now - this.queue[0].at > STALE_MS) this.queue.shift();
    const it = this.queue.shift();
    if (!it) return;
    const node = el('div', 'toast ' + it.tone, (it.ic ? icon(it.ic) : '') + '<span></span>');
    node.querySelector('span').textContent = it.text;
    this.root.appendChild(node);
    this.cur = { node, text: it.text, shown: now, until: now + it.ms };
  }

  drop() {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    c.node.classList.add('out');
    this.fading = c.node;
    setTimeout(() => { c.node.remove(); if (this.fading === c.node) this.fading = null; this.pump(); }, FADE_MS);
  }

  clear() {
    this.queue.length = 0;
    if (this.cur) { this.cur.node.remove(); this.cur = null; }
    if (this.fading) { this.fading.remove(); this.fading = null; }
  }
}
