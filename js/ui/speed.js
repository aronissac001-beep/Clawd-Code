// The speed button (owner I; doc 10.7). Tap: pause or resume. Hold 250 ms: a fan of four 48 pt
// buttons (1x, 2x, 3x, 5x) arcs above it; slide onto one and release, or tap one. The button shows
// the speed as 1-3 chevrons (5x: three chevrons and a dot) and an amber ring when paused. 5x is
// greyed with its reason while blocked (D3). Speed is not sim state: the shell owns it.
import { h, icon } from './kit.js';
import { SIZES } from './layout.js';

export const SPEED_STEPS = Object.freeze([1, 2, 3, 5]);
const R = 118;                         // fan radius (pt): 48 pt buttons, 26 degrees apart, chord 53 pt
const ANGLES = [90, 64, 38, 12];       // degrees above the horizontal, from straight up towards the bar

/**
 * new SpeedButton(host, { get(): speed (0 = paused), set(speed), blocked(speed) -> reason | null,
 *   toast(text), mirrored(): bool (fan opens to the left: landscape and the left-handed setting) })
 */
export class SpeedButton {
  constructor(host, opt) {
    this.opt = opt;
    this.last = 1;                     // the speed a tap resumes to
    this.btn = h('button.ec-speed', { type: 'button', 'data-act': 'speed', 'aria-label': 'Speed' });
    this.face = h('span.ec-speed-face');
    this.btn.append(this.face);
    host.append(this.btn);
    this.scrim = h('div.ec-fan-scrim', { hidden: true });
    this.fan = h('div.ec-fan', { hidden: true, role: 'menu', 'aria-label': 'Game speed' });
    this.items = SPEED_STEPS.map((v) => {
      const b = h('button.ec-fan-btn', { type: 'button', role: 'menuitem', 'data-speed': String(v), 'aria-label': `${v}x speed` }, h('span', { text: `${v}x` }));
      b.addEventListener('pointerup', (e) => { if (!this.dragging) { e.stopPropagation(); this.choose(v); } });
      this.fan.append(b);
      return b;
    });
    document.body.append(this.scrim, this.fan);
    this.scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); this.close(); });
    this.bind();
    this.render();
  }
  get speed() { return this.opt.get(); }
  bind() {
    const b = this.btn;
    let timer = 0, down = null;
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    b.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { b.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
      b.classList.add('pressed');
      timer = setTimeout(() => { timer = 0; this.open(); this.dragging = true; }, SIZES.holdMs);
    });
    b.addEventListener('pointermove', (e) => { if (down && this.dragging && e.pointerId === down.id) this.hover(e.clientX, e.clientY); });
    const up = (e, ok) => {
      if (!down || e.pointerId !== down.id) return;
      b.classList.remove('pressed');
      down = null;
      if (timer) { clearTimeout(timer); timer = 0; if (ok) this.toggle(); return; }
      this.dragging = false;
      const v = ok ? this.at(e.clientX, e.clientY) : null;
      if (v) this.choose(v);
      else if (!ok || !this.onButton(e.clientX, e.clientY)) this.close();
      // released on the button itself: the fan stays open for a tap
    };
    b.addEventListener('pointerup', (e) => up(e, true));
    b.addEventListener('pointercancel', (e) => up(e, false));
    b.addEventListener('click', (e) => { if (e.detail === 0) this.toggle(); });
  }
  onButton(x, y) { const r = this.btn.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }
  /** The fan speed whose button is under (x, y): within 30 pt of its centre (a 60 pt catch circle). */
  at(x, y) {
    if (this.fan.hidden) return null;
    let best = null, bd = 30 * 30;
    for (const it of this.items) {
      const r = it.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d <= bd) { bd = d; best = +it.dataset.speed; }
    }
    return best;
  }
  hover(x, y) { const v = this.at(x, y); for (const it of this.items) it.classList.toggle('hot', +it.dataset.speed === v); }
  layoutFan() {
    const r = this.btn.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dir = this.opt.mirrored && this.opt.mirrored() ? -1 : 1;
    const half = SIZES.fan / 2;
    this.items.forEach((it, k) => {
      const a = (ANGLES[k] * Math.PI) / 180;
      it.style.left = `${Math.round(cx + dir * R * Math.cos(a) - half)}px`;
      it.style.top = `${Math.round(cy - R * Math.sin(a) - half)}px`;
    });
  }
  open() {
    this.layoutFan();
    for (const it of this.items) {
      const v = +it.dataset.speed, why = this.opt.blocked ? this.opt.blocked(v) : null;
      it.classList.toggle('blocked', !!why); it.dataset.why = why || '';
      it.classList.toggle('cur', v === this.speed);
      it.classList.remove('hot');
    }
    this.fan.hidden = false; this.scrim.hidden = false;
    this.btn.classList.add('open');
  }
  close() { this.fan.hidden = true; this.scrim.hidden = true; this.btn.classList.remove('open'); this.dragging = false; }
  get isOpen() { return !this.fan.hidden; }
  choose(v) {
    const why = this.opt.blocked ? this.opt.blocked(v) : null;
    this.close();
    if (why) { this.opt.toast && this.opt.toast(`5x is not available: ${why}`); return; }
    this.last = v; this.opt.set(v); this.render();
  }
  toggle() {
    if (this.speed > 0) { this.last = this.speed; this.opt.set(0); }
    else { const v = this.opt.blocked && this.opt.blocked(this.last) ? 3 : this.last; this.opt.set(v); }
    this.render();
  }
  render() {
    const v = this.speed, shown = v || this.last;
    const n = shown >= 3 ? 3 : shown;
    this.face.innerHTML = Array.from({ length: n }, () => icon('chev', 'chev')).join('') + (shown === 5 ? '<i class="dot"></i>' : '');
    this.btn.classList.toggle('paused', v === 0);
    this.btn.setAttribute('aria-label', v === 0 ? `Paused (tap to resume at ${shown}x, hold for speeds)` : `Speed ${v}x (tap to pause, hold for speeds)`);
    this.btn.dataset.speed = String(v);
  }
}
