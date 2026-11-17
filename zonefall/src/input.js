// ============================================================================
// ZONEFALL 4 — first-person input.
// Touch: floating move stick on the left, drag anywhere on the right to look,
// on-screen buttons (FIRE also steers the camera while held — like mobile FPS).
// Desktop: WASD + pointer-locked mouse look, LMB fire, RMB aim, Space jump,
// C/Ctrl crouch, Shift sprint, E use, R reload, 1–6 belt, B build, Tab bag.
// ============================================================================
import { Sfx } from './audio.js';

export const Input = {
  move: { x: 0, y: 0, id: null, ox: 0, oy: 0, cx: 0, cy: 0, mag: 0 },
  lookTouches: new Map(),         // touch id -> {x, y}
  lookDX: 0, lookDY: 0,           // accumulated look deltas (pixels for touch, mouse units for mouse)
  mouseDX: 0, mouseDY: 0,
  keys: {}, mouse: { x: 0, y: 0, down: false, rdown: false, used: false },
  held: {}, pressed: {}, released: {},
  wheel: 0,
  touchMode: ('ontouchstart' in window),
  locked: false,
  STICK_R: 58,
  blocked: () => false,           // true while a menu/sheet is open
  canLock: () => true,
  homes() { const R0 = this.STICK_R; return { mx: R0 + 46, my: innerHeight - R0 - 38 }; },
  inMoveZone(x, y) { return x < innerWidth * 0.4 && y > innerHeight * 0.3; },
  init(el) {
    this.el = el;
    const R0 = () => this.STICK_R;
    el.addEventListener('touchstart', e => {
      this.touchMode = true; Sfx.unlock();
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (this.inMoveZone(x, y) && this.move.id === null) { Object.assign(this.move, { id: t.identifier, ox: x, oy: y, cx: x, cy: y, x: 0, y: 0, mag: 0 }); continue; }
        this.lookTouches.set(t.identifier, { x, y, sx: x, sy: y, t0: performance.now() });
      }
      e.preventDefault();
    }, { passive: false });
    const onMove = e => {
      for (const t of e.changedTouches) {
        const x = t.clientX, y = t.clientY;
        if (t.identifier === this.move.id) {
          const s = this.move; let dx = x - s.ox, dy = y - s.oy; const d = Math.hypot(dx, dy);
          if (d > R0()) { const k = (d - R0()) / d; s.ox += dx * k; s.oy += dy * k; dx = x - s.ox; dy = y - s.oy; }
          s.cx = x; s.cy = y; s.x = dx / R0(); s.y = dy / R0(); s.mag = Math.min(1, Math.hypot(s.x, s.y));
          continue;
        }
        const L = this.lookTouches.get(t.identifier);
        if (L) { this.lookDX += x - L.x; this.lookDY += y - L.y; L.x = x; L.y = y; }
      }
      e.preventDefault();
    };
    // look/fire touches that start on a button are registered by bindButton(...{look:true}) and tracked here too
    document.addEventListener('touchmove', onMove, { passive: false });
    const onEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.move.id) Object.assign(this.move, { id: null, x: 0, y: 0, mag: 0 });
        const L = this.lookTouches.get(t.identifier);
        if (L) { this.lookTouches.delete(t.identifier); if (performance.now() - L.t0 < 220 && Math.hypot(L.x - L.sx, L.y - L.sy) < 12 && !L.button) this.taps.push({ x: L.x, y: L.y }); }
      }
    };
    document.addEventListener('touchend', onEnd, { passive: false });
    document.addEventListener('touchcancel', onEnd, { passive: false });
    // ---- mouse + pointer lock (desktop)
    el.addEventListener('mousedown', e => {
      Sfx.unlock(); this.touchMode = false; this.mouse.used = true;
      if (!this.locked && this.canLock() && el.requestPointerLock) { try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (err) { } }
      if (e.button === 2) { this.mouse.rdown = true; this.held.ads = true; this.pressed.ads = true; }
      else if (e.button === 0) { this.mouse.down = true; this.held.fire = true; this.pressed.fire = true; }
    });
    addEventListener('mouseup', e => {
      if (e.button === 2) { this.mouse.rdown = false; this.held.ads = false; }
      else if (e.button === 0) { if (this.mouse.down) this.released.fire = true; this.mouse.down = false; this.held.fire = false; }
    });
    addEventListener('mousemove', e => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked) { this.mouseDX += e.movementX || 0; this.mouseDY += e.movementY || 0; }
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; if (!this.locked) { this.held.fire = false; this.held.ads = false; } });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.key.toLowerCase(); Sfx.unlock(); this.touchMode = false;
      if (!this.keys[k]) {
        const map = { e: 'interact', f: 'interact', r: 'reload', h: 'heal', tab: 'bag', i: 'bag', b: 'build', m: 'map', escape: 'esc', q: 'rotate', x: 'hammer', ' ': 'jump', c: 'crouch', control: 'crouch', g: 'throwkey', v: 'ads' };
        if (map[k]) { this.pressed[map[k]] = true; this.held[map[k]] = true; }
        if (/^[1-6]$/.test(k)) this.pressed['slot' + k] = true;
      }
      this.keys[k] = true;
      if (k === 'tab' || k === ' ') e.preventDefault();
    });
    addEventListener('keyup', e => {
      const k = e.key.toLowerCase(); this.keys[k] = false;
      const map = { e: 'interact', f: 'interact', ' ': 'jump', c: 'crouch', control: 'crouch', v: 'ads' };
      if (map[k]) this.held[map[k]] = false;
    });
    addEventListener('blur', () => { this.keys = {}; this.held = {}; this.mouse.down = false; this.mouse.rdown = false; });
  },
  taps: [],
  /**
   * on-screen button. opts.look: touches that start on this button also steer the camera (FIRE / ADS).
   * opts.toggle: tap toggles held state (crouch / ADS on touch).
   */
  bindButton(el, name, opts = {}) {
    const down = e => {
      e.preventDefault(); e.stopPropagation(); Sfx.unlock();
      if (opts.toggle) { this.held[name] = !this.held[name]; this.pressed[name] = true; el.classList.toggle('on', !!this.held[name]); }
      else { this.held[name] = true; this.pressed[name] = true; el.classList.add('down'); }
      if (opts.look && e.changedTouches) for (const t of e.changedTouches) this.lookTouches.set(t.identifier, { x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t0: performance.now(), button: true, name });
      if (opts.onDown) opts.onDown();
    };
    const up = e => {
      e.preventDefault(); e.stopPropagation();
      if (!opts.toggle) { if (this.held[name]) this.released[name] = true; this.held[name] = false; el.classList.remove('down'); }
      if (e.changedTouches) for (const t of e.changedTouches) { const L = this.lookTouches.get(t.identifier); if (L && L.button) this.lookTouches.delete(t.identifier); }
    };
    el.addEventListener('touchstart', down, { passive: false });
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
    el.addEventListener('mousedown', e => { if (e.button === 0) down(e); });
    el.addEventListener('mouseup', up);
    el.addEventListener('mouseleave', e => { if (this.held[name] && !opts.toggle) up(e); });
  },
  setHeld(name, v, el) { this.held[name] = v; if (el) el.classList.toggle('on', !!v); },
  /** movement in local space: x = strafe right, y = forward. */
  moveVec() {
    let x = this.move.x, y = -this.move.y;
    if (this.keys.w || this.keys.arrowup) y += 1;
    if (this.keys.s || this.keys.arrowdown) y -= 1;
    if (this.keys.a || this.keys.arrowleft) x -= 1;
    if (this.keys.d || this.keys.arrowright) x += 1;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    return { x, y, mag: Math.min(1, m), sprint: !!this.keys.shift || (this.move.id !== null && this.move.mag > 0.94 && -this.move.y > 0.82) };
  },
  /** consume look deltas: returns radians { yaw, pitch } */
  takeLook(sensTouch, sensMouse, invert) {
    const yaw = this.lookDX * sensTouch + this.mouseDX * sensMouse;
    let pitch = -(this.lookDY * sensTouch + this.mouseDY * sensMouse);
    if (invert) pitch = -pitch;
    this.lookDX = this.lookDY = this.mouseDX = this.mouseDY = 0;
    return { yaw, pitch };
  },
  endFrame() { this.pressed = {}; this.released = {}; this.wheel = 0; this.taps.length = 0; },
};
