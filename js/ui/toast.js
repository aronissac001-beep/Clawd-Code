// Stacking toast notifications.
import { el } from './dom.js';
import { icon } from './icons.js';

export class Toasts {
  constructor(root) { this.root = root; this.items = []; }
  show(text, tone = '', ic = null, ms = 3200) {
    // Merge identical consecutive toasts.
    const last = this.items[this.items.length - 1];
    if (last && last.text === text && !last.gone) { last.count++; last.node.querySelector('span').textContent = `${text} ×${last.count}`; clearTimeout(last.t); last.t = setTimeout(() => this.drop(last), ms); return; }
    const node = el('div', 'toast ' + tone, (ic ? icon(ic) : '') + `<span></span>`);
    node.querySelector('span').textContent = text;
    this.root.appendChild(node);
    const it = { node, text, count: 1, gone: false };
    it.t = setTimeout(() => this.drop(it), ms);
    this.items.push(it);
    while (this.items.length > 2) this.drop(this.items[0]);
  }
  drop(it) {
    if (it.gone) return;
    it.gone = true; clearTimeout(it.t);
    it.node.classList.add('out');
    setTimeout(() => it.node.remove(), 400);
    this.items = this.items.filter((x) => x !== it);
  }
  clear() { for (const it of this.items.slice()) this.drop(it); }
}
