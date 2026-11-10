// ===== input.js : touch / pointer handling for the map =====
function attachMapInput(cv, R, on) {
  const ptr = new Map();
  let mode = 'idle', downT = 0, lpTimer = 0, pinch = null, vel = { x: 0, y: 0 }, last = null, inertia = null;
  const pos = e => [e.clientX, e.clientY];
  const cancelLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = 0; } };

  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* capture unsupported */ }
    inertia = null; R.camAnim = null;
    const [x, y] = pos(e);
    ptr.set(e.pointerId, { x, y, sx: x, sy: y });
    if (ptr.size === 1) {
      mode = 'press'; downT = performance.now(); vel = { x: 0, y: 0 }; last = { x, y, t: downT };
      cancelLP();
      lpTimer = setTimeout(() => { if (mode === 'press') { mode = 'long'; on.longPress(R.screenToTile(x, y), x, y); } }, 480);
    } else if (ptr.size === 2) {
      cancelLP();
      const [a, b] = Array.from(ptr.values());
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: R.cam.z, wp: R.screenToWorld(mx, my) };
      mode = 'pinch'; R.gesturing = true;
    }
  }, { passive: false });

  cv.addEventListener('pointermove', e => {
    const p = ptr.get(e.pointerId); if (!p) return;
    e.preventDefault();
    const [x, y] = pos(e), dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (mode === 'pinch' && ptr.size >= 2) {
      const [a, b] = Array.from(ptr.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      R.cam.z = Math.max(0.42, Math.min(2.4, pinch.z0 * d / pinch.d0));
      R.cam.x = pinch.wp[0] - (mx - R.w / 2) / R.cam.z;
      R.cam.y = pinch.wp[1] - (my - R.h / 2) / (R.cam.z * R.tilt);
      R.request(); return;
    }
    if (mode === 'press' && Math.hypot(x - p.sx, y - p.sy) > 9) { mode = 'drag'; cancelLP(); }
    if (mode === 'drag') {
      R.cam.x -= dx / R.cam.z; R.cam.y -= dy / (R.cam.z * R.tilt);
      const now = performance.now(), dt = Math.max(1, now - last.t);
      vel = { x: 0.7 * vel.x + 0.3 * (x - last.x) / dt, y: 0.7 * vel.y + 0.3 * (y - last.y) / dt };
      last = { x, y, t: now };
      R.request();
    }
  }, { passive: false });

  const up = e => {
    const p = ptr.get(e.pointerId); if (!p) return;
    ptr.delete(e.pointerId);
    cancelLP();
    if (mode === 'pinch') {
      if (ptr.size === 0) { mode = 'idle'; R.gesturing = false; R.request(); }
      else { mode = 'cooldown'; }
      return;
    }
    if (mode === 'cooldown') { if (ptr.size === 0) { mode = 'idle'; R.gesturing = false; R.request(); } return; }
    if (mode === 'press' && e.type === 'pointerup') on.tap(R.screenToTile(p.x, p.y), p.x, p.y);
    if (mode === 'drag' && performance.now() - last.t < 80 && Math.hypot(vel.x, vel.y) > 0.25) {
      inertia = { vx: vel.x, vy: vel.y, t: performance.now() }; R.request();
    }
    mode = 'idle';
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const wp = R.screenToWorld(e.clientX, e.clientY);
    R.cam.z = Math.max(0.42, Math.min(2.4, R.cam.z * Math.exp(-e.deltaY * 0.0015)));
    R.cam.x = wp[0] - (e.clientX - R.w / 2) / R.cam.z; R.cam.y = wp[1] - (e.clientY - R.h / 2) / (R.cam.z * R.tilt);
    R.request();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

  // momentum after a flick
  R.onFrame = now => {
    if (!inertia) return false;
    const dt = Math.min(40, now - inertia.t); inertia.t = now;
    R.cam.x -= inertia.vx * dt / R.cam.z; R.cam.y -= inertia.vy * dt / (R.cam.z * R.tilt);
    const f = Math.pow(0.93, dt / 16); inertia.vx *= f; inertia.vy *= f;
    if (Math.hypot(inertia.vx, inertia.vy) < 0.02) { inertia = null; return false; }
    return true;
  };
}
