// ===== input.js : tap, drag to pan, pinch and wheel to zoom =====
function attachInput(cv, on) {
  const ptr = new Map();
  let mode = 'idle', pinch = null, vel = { x: 0, y: 0 }, last = null, inertia = null;
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* unsupported */ }
    inertia = null;
    ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (ptr.size === 1) { mode = 'press'; vel = { x: 0, y: 0 }; last = { x: e.clientX, y: e.clientY, t: performance.now() }; }
    else if (ptr.size === 2) {
      const [a, b] = Array.from(ptr.values());
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: R.cam.z, wp: R.screenToWorld(mx, my) };
      mode = 'pinch';
    }
  }, { passive: false });
  cv.addEventListener('pointermove', e => {
    const p = ptr.get(e.pointerId); if (!p) return;
    e.preventDefault();
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (mode === 'pinch' && ptr.size >= 2) {
      const [a, b] = Array.from(ptr.values());
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      R.cam.z = clamp(pinch.z0 * d / pinch.d0, 0.28, 2.6);
      R.cam.x = pinch.wp[0] - (mx - R.w / 2) / R.cam.z; R.cam.y = pinch.wp[1] - (my - R.h / 2) / R.cam.z;
      R.clampCam(); return;
    }
    if (mode === 'press' && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 9) mode = 'drag';
    if (mode === 'drag') {
      R.cam.x -= dx / R.cam.z; R.cam.y -= dy / R.cam.z; R.clampCam();
      const now = performance.now(), dt = Math.max(1, now - last.t);
      vel = { x: 0.7 * vel.x + 0.3 * (e.clientX - last.x) / dt, y: 0.7 * vel.y + 0.3 * (e.clientY - last.y) / dt };
      last = { x: e.clientX, y: e.clientY, t: now };
    }
  }, { passive: false });
  const up = e => {
    const p = ptr.get(e.pointerId); if (!p) return;
    ptr.delete(e.pointerId);
    if (mode === 'pinch') { mode = ptr.size ? 'cooldown' : 'idle'; return; }
    if (mode === 'cooldown') { if (!ptr.size) mode = 'idle'; return; }
    if (mode === 'press' && e.type === 'pointerup') on.tap(p.x, p.y);
    if (mode === 'drag' && performance.now() - last.t < 80 && Math.hypot(vel.x, vel.y) > 0.2) inertia = { vx: vel.x, vy: vel.y };
    mode = 'idle';
  };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const wp = R.screenToWorld(e.clientX, e.clientY);
    R.cam.z = clamp(R.cam.z * Math.exp(-e.deltaY * 0.0015), 0.28, 2.6);
    R.cam.x = wp[0] - (e.clientX - R.w / 2) / R.cam.z; R.cam.y = wp[1] - (e.clientY - R.h / 2) / R.cam.z; R.clampCam();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault(), { passive: false }));
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  return {
    tick(dt) {
      if (!inertia) return;
      R.cam.x -= inertia.vx * dt / R.cam.z; R.cam.y -= inertia.vy * dt / R.cam.z; R.clampCam();
      const f = Math.pow(0.93, dt / 16); inertia.vx *= f; inertia.vy *= f;
      if (Math.hypot(inertia.vx, inertia.vy) < 0.02) inertia = null;
    },
  };
}
