// Pointer-event gesture recogniser for the map canvas.
// Emits: tap, longpress, dragstart/dragmove/dragend (one finger), pinch
// (two fingers: zoom + pan), twofingertap and wheel. pointercancel is treated
// exactly like a lift so no touch ever gets stuck.
export class GestureInput {
  constructor(el, h) {
    this.el = el; this.h = h;
    this.pts = new Map();
    this.mode = 'none'; // none | press | drag | pinch
    this.downT = 0; this.startX = 0; this.startY = 0;
    this.lpTimer = 0; this.twoStart = 0; this.twoMoved = false;
    this.pinchD = 0; this.pinchCX = 0; this.pinchCY = 0;
    this.velX = 0; this.velY = 0; this.lastMoveT = 0;
    const opt = { passive: false };
    el.addEventListener('pointerdown', (e) => this.down(e), opt);
    el.addEventListener('pointermove', (e) => this.move(e), opt);
    el.addEventListener('pointerup', (e) => this.up(e, false), opt);
    el.addEventListener('pointercancel', (e) => this.up(e, true), opt);
    el.addEventListener('lostpointercapture', (e) => { if (this.pts.has(e.pointerId)) this.up(e, true); });
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.h.wheel?.(e.deltaY, this.local(e)); }, opt);
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); this.h.cancel?.(); });
  }
  local(e) { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  down(e) {
    e.preventDefault();
    if (e.button === 2) return;
    try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* not all pointers capture */ }
    const p = this.local(e);
    this.pts.set(e.pointerId, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (this.pts.size === 1) {
      this.mode = 'press';
      this.downT = performance.now(); this.startX = p.x; this.startY = p.y;
      this.velX = 0; this.velY = 0; this.lastMoveT = this.downT;
      this.h.press?.(p);
      clearTimeout(this.lpTimer);
      this.lpTimer = setTimeout(() => {
        if (this.mode === 'press') { this.mode = 'held'; this.h.longpress?.(p); }
      }, 480);
    } else if (this.pts.size === 2) {
      clearTimeout(this.lpTimer);
      if (this.mode === 'drag') this.h.dragend?.(this.firstPoint(), true);
      this.mode = 'pinch';
      this.twoStart = performance.now(); this.twoMoved = false;
      const [a, b] = [...this.pts.values()];
      this.pinchD = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.pinchCX = (a.x + b.x) / 2; this.pinchCY = (a.y + b.y) / 2;
    }
  }
  firstPoint() { const v = this.pts.values().next().value; return v ? { x: v.x, y: v.y } : { x: this.startX, y: this.startY }; }
  move(e) {
    const pt = this.pts.get(e.pointerId);
    if (!pt) { if (e.pointerType === 'mouse') this.h.hover?.(this.local(e)); return; }
    e.preventDefault();
    const p = this.local(e);
    const dx = p.x - pt.x, dy = p.y - pt.y;
    pt.x = p.x; pt.y = p.y;
    if (this.mode === 'press' || this.mode === 'held') {
      if (Math.hypot(p.x - this.startX, p.y - this.startY) > 9) {
        clearTimeout(this.lpTimer);
        this.mode = 'drag';
        this.h.dragstart?.({ x: this.startX, y: this.startY });
        this.h.dragmove?.(p, p.x - this.startX, p.y - this.startY);
      }
    } else if (this.mode === 'drag') {
      const now = performance.now();
      const ddt = Math.max(1, now - this.lastMoveT) / 1000;
      this.lastMoveT = now;
      this.velX = this.velX * 0.6 + (dx / ddt) * 0.4; this.velY = this.velY * 0.6 + (dy / ddt) * 0.4;
      this.h.dragmove?.(p, dx, dy);
    } else if (this.mode === 'pinch' && this.pts.size >= 2) {
      const [a, b] = [...this.pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (Math.abs(d - this.pinchD) > 3 || Math.hypot(cx - this.pinchCX, cy - this.pinchCY) > 3) this.twoMoved = true;
      this.h.pinch?.(d / this.pinchD, cx, cy, cx - this.pinchCX, cy - this.pinchCY);
      this.pinchD = d; this.pinchCX = cx; this.pinchCY = cy;
    }
  }
  up(e, cancelled) {
    const pt = this.pts.get(e.pointerId);
    if (!pt) return;
    if (e.cancelable) e.preventDefault();
    this.pts.delete(e.pointerId);
    try { this.el.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    const p = { x: pt.x, y: pt.y };
    if (this.mode === 'pinch') {
      if (this.pts.size === 0) {
        if (!this.twoMoved && performance.now() - this.twoStart < 320 && !cancelled) this.h.twofingertap?.();
        this.mode = 'none';
      } else {
        // One finger left after a pinch: keep panning smoothly with it.
        const rest = this.firstPoint();
        this.mode = 'drag'; this.startX = rest.x; this.startY = rest.y;
        this.h.dragstart?.(rest);
      }
      return;
    }
    clearTimeout(this.lpTimer);
    if (this.pts.size > 0) return;
    if (this.mode === 'press' && !cancelled && performance.now() - this.downT < 480) this.h.tap?.(p);
    else if (this.mode === 'drag') {
      const stale = performance.now() - this.lastMoveT > 80;
      this.h.dragend?.(p, cancelled, stale ? 0 : this.velX, stale ? 0 : this.velY);
    }
    this.h.release?.(p);
    this.mode = 'none';
  }
  reset() { this.pts.clear(); this.mode = 'none'; clearTimeout(this.lpTimer); }
}
