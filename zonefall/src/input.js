// ============================================================================
// ZONEFALL 3 — input: floating twin sticks (touch), keyboard + mouse, virtual
// buttons, and "world taps" used by build mode.
// ============================================================================
import { Sfx } from './audio.js';

export const Input = {
  move: { x: 0, y: 0, id: null, ox: 0, oy: 0, cx: 0, cy: 0, mag: 0 },
  aim: { x: 0, y: 0, id: null, ox: 0, oy: 0, cx: 0, cy: 0, mag: 0, released: false, last: { x: 0, y: 0, mag: 0 } },
  keys: {}, mouse: { x: 0, y: 0, down: false, used: false, rdown: false },
  held: {}, pressed: {},
  taps: [],          // world taps this frame [{x,y}] (build mode)
  drag: null,        // build-mode drag {id, sx, sy, cx, cy}
  dragEnds: [],
  touchMode: ('ontouchstart' in window),
  STICK_R: 58, FIRE_T: 0.62, AIM_T: 0.18,
  buildMode: () => false,
  homes() { const R0 = this.STICK_R; return { mx: R0 + 40, my: innerHeight - R0 - 34, ax: innerWidth - 150 - R0, ay: innerHeight - R0 - 34 }; },
  inMoveZone(x, y) { return x < innerWidth * 0.42 && y > innerHeight * (this.buildMode() ? 0.45 : 0.25); },
  init(el) {
    const R0 = () => this.STICK_R;
    const startStick = (s, t) => Object.assign(s, { id: t.identifier, ox: t.clientX, oy: t.clientY, cx: t.clientX, cy: t.clientY, x: 0, y: 0, mag: 0 });
    el.addEventListener('touchstart', e => {
      this.touchMode = true; Sfx.unlock();
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (this.inMoveZone(x, y)) { if (this.move.id === null) startStick(this.move, t); continue; }
        if (this.buildMode()) { if (!this.drag) this.drag = { id: t.identifier, sx: x, sy: y, cx: x, cy: y, t0: performance.now() }; continue; }
        if (this.aim.id === null) startStick(this.aim, t);
      }
      e.preventDefault();
    }, { passive: false });
    el.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (this.drag && t.identifier === this.drag.id) { this.drag.cx = x; this.drag.cy = y; continue; }
        for (const s of [this.move, this.aim]) {
          if (s.id !== t.identifier) continue;
          let dx = x - s.ox, dy = y - s.oy; const d = Math.hypot(dx, dy);
          if (d > R0()) { const k = (d - R0()) / d; s.ox += dx * k; s.oy += dy * k; dx = x - s.ox; dy = y - s.oy; }
          s.cx = x; s.cy = y; s.x = dx / R0(); s.y = dy / R0(); s.mag = Math.min(1, Math.hypot(s.x, s.y));
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = e => {
      for (const t of e.changedTouches) {
        if (this.drag && t.identifier === this.drag.id) { this.dragEnds.push({ ...this.drag, cx: t.clientX, cy: t.clientY }); this.drag = null; }
        if (this.move.id === t.identifier) Object.assign(this.move, { id: null, x: 0, y: 0, mag: 0 });
        if (this.aim.id === t.identifier) { this.aim.last = { x: this.aim.x, y: this.aim.y, mag: this.aim.mag }; this.aim.released = true; Object.assign(this.aim, { id: null, x: 0, y: 0, mag: 0 }); }
      }
      e.preventDefault();
    };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
    // mouse
    el.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.used = true; if (this.drag && this.drag.id === 'm') { this.drag.cx = e.clientX; this.drag.cy = e.clientY; } });
    el.addEventListener('mousedown', e => {
      Sfx.unlock(); this.mouse.used = true; this.touchMode = false; this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (e.button === 2) { this.mouse.rdown = true; return; }
      this.mouse.down = true;
      if (this.buildMode()) this.drag = { id: 'm', sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, t0: performance.now() };
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mouseup', e => {
      if (e.button === 2) { this.mouse.rdown = false; return; }
      if (this.mouse.down && !this.buildMode()) this.aim.released = true;
      this.mouse.down = false; if (this.drag && this.drag.id === 'm') { this.dragEnds.push({ ...this.drag, cx: e.clientX, cy: e.clientY }); this.drag = null; }
    });
    el.addEventListener('wheel', e => { this.wheel = (this.wheel || 0) + Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase(); this.keys[k] = true; Sfx.unlock(); this.touchMode = false;
      const map = { e: 'interact', f: 'interact', r: 'reload', h: 'heal', tab: 'bag', i: 'bag', b: 'build', c: 'craft', m: 'map', escape: 'esc', q: 'rotate', x: 'hammer' };
      if (/^[1-6]$/.test(k)) this.pressed['slot' + k] = true;
      if (map[k] && !e.repeat) { this.pressed[map[k]] = true; this.held[map[k]] = true; }
      if (k === 'tab' || k === ' ') e.preventDefault();
    });
    addEventListener('keyup', e => { const k = e.key.toLowerCase(); this.keys[k] = false; if (k === 'e' || k === 'f') this.held.interact = false; });
    addEventListener('blur', () => { this.keys = {}; this.held = {}; this.mouse.down = false; });
  },
  bindButton(el, name, opts = {}) {
    const down = e => { e.preventDefault(); e.stopPropagation(); Sfx.unlock(); this.held[name] = true; this.pressed[name] = true; el.classList.add('down'); if (opts.onDown) opts.onDown(); };
    const up = e => { e.preventDefault(); e.stopPropagation(); this.held[name] = false; el.classList.remove('down'); };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', down);
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', e => { if (this.held[name]) up(e); });
  },
  moveVec() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.w || this.keys.arrowup) y -= 1;
    if (this.keys.s || this.keys.arrowdown) y += 1;
    if (this.keys.a || this.keys.arrowleft) x -= 1;
    if (this.keys.d || this.keys.arrowright) x += 1;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m), run: !!this.keys.shift };
  },
  endFrame() { this.pressed = {}; this.dragEnds.length = 0; this.aim.released = false; this.wheel = 0; },
};
