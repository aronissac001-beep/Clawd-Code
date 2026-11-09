// Modal dialogs: choice cards, confirmations, free-form panels.
import { el, tapButton } from './dom.js';
import { icon } from './icons.js';

export class Modal {
  constructor(root) { this.root = root; this.onClose = null; this.stack = []; }
  get open() { return this.root.classList.contains('open'); }
  show(node, { dismissable = false, onClose } = {}) {
    this.root.innerHTML = '';
    this.root.appendChild(node);
    this.root.classList.add('open');
    this.dismissable = !!dismissable;
    this.onClose = onClose || null;
    this.root.onpointerdown = dismissable ? (e) => { if (e.target === this.root) this.close(); } : null;
  }
  close() {
    if (!this.open) return;
    this.root.classList.remove('open');
    this.root.innerHTML = '';
    const cb = this.onClose; this.onClose = null;
    if (cb) cb();
  }

  /** options: [{icon, title, text, onPick}] */
  choice(title, lead, options, opts = {}) {
    const d = el('div', 'dialog panel');
    d.appendChild(el('h2', '', title));
    if (lead) d.appendChild(el('p', 'lead', lead));
    const row = el('div', 'choices');
    options.forEach((o) => {
      const c = el('button', 'choice', `${icon(o.icon || 'flame')}<h4></h4><p></p>`);
      c.querySelector('h4').textContent = o.title;
      c.querySelector('p').textContent = o.text;
      tapButton(c, () => { this.close(); o.onPick(); }, { sound: 'ok' });
      row.appendChild(c);
    });
    d.appendChild(row);
    if (opts.footer) d.appendChild(opts.footer);
    this.show(d, opts);
    return d;
  }

  /** A titled dialog with arbitrary body node and action buttons [{label, cls, icon, onTap, keep}] */
  dialog(title, body, actions = [], opts = {}) {
    const d = el('div', 'dialog panel');
    if (title) d.appendChild(el('h2', '', title));
    if (typeof body === 'string') d.appendChild(el('p', 'lead', body)); else if (body) d.appendChild(body);
    if (actions.length) {
      const row = el('div', 'actions');
      for (const a of actions) {
        const b = el('button', 'big-btn ' + (a.cls || ''), (a.icon ? icon(a.icon) : '') + `<span></span>`);
        b.querySelector('span').textContent = a.label;
        tapButton(b, () => { if (!a.keep) this.close(); a.onTap && a.onTap(); }, { sound: a.sound || 'ok' });
        row.appendChild(b);
      }
      d.appendChild(row);
    }
    this.show(d, opts);
    return d;
  }
}
