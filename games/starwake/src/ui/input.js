// ===== input.js : touch and mouse (tap, drag to pan, pinch and wheel to zoom), keyboard =====
function setupInput(canvas, R, handlers) {
  const pts = new Map();
  let start = null, moved = false, pinch = null, lastTap = null;
  canvas.addEventListener('pointerdown', ev => {
    canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    Sound.unlock();
    if (pts.size === 1) { start = { x: ev.clientX, y: ev.clientY, t: performance.now() }; moved = false; }
    if (pts.size === 2) { const [a, b] = Array.from(pts.values()); pinch = { d: hyp(a.x - b.x, a.y - b.y), z: R.mode === 'system' ? R.sysZoom : R.cam.z }; moved = true; }
  });
  canvas.addEventListener('pointermove', ev => {
    const p = pts.get(ev.pointerId); if (!p) return;
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX; p.y = ev.clientY;
    if (pts.size === 2 && pinch) {
      const [a, b] = Array.from(pts.values()); const d = hyp(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (R.mode === 'system') { R.sysZoom = clamp(pinch.z * d / pinch.d, 0.5, 2.6); R.dirty = true; if (R.sysZoom < 0.62) { pinch = null; handlers.exitSystem(); } }
      else { const target = pinch.z * d / pinch.d; R.zoomAt(cx, cy, target / R.cam.z); }
      return;
    }
    if (pts.size === 1 && start) {
      if (!moved && hyp(ev.clientX - start.x, ev.clientY - start.y) > 7) moved = true;
      if (moved && R.mode === 'galaxy') R.pan(dx, dy);
    }
  });
  const end = ev => {
    if (!pts.has(ev.pointerId)) return;
    pts.delete(ev.pointerId);
    if (pts.size === 0) {
      if (start && !moved && performance.now() - start.t < 500) {
        const now = performance.now();
        const dbl = lastTap && now - lastTap.t < 320 && hyp(lastTap.x - start.x, lastTap.y - start.y) < 24;
        lastTap = dbl ? null : { t: now, x: start.x, y: start.y };
        if (dbl) handlers.doubleTap(start.x, start.y); else handlers.tap(start.x, start.y);
      }
      start = null; pinch = null;
    }
    if (pts.size === 1) { pinch = null; const p = Array.from(pts.values())[0]; start = { x: p.x, y: p.y, t: 0 }; moved = true; }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    const f = Math.exp(-ev.deltaY * 0.0015);
    if (R.mode === 'system') { R.sysZoom = clamp(R.sysZoom * f, 0.5, 2.6); R.dirty = true; if (R.sysZoom < 0.62) handlers.exitSystem(); }
    else R.zoomAt(ev.clientX, ev.clientY, f);
  }, { passive: false });
  // stop iOS page gestures
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('touchmove', e => { if (e.target === canvas) e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', ev => {
    if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
    if (ev.key === ' ') { ev.preventDefault(); handlers.key('pause'); }
    else if (ev.key === '1' || ev.key === '2' || ev.key === '3') handlers.key('speed' + ev.key);
    else if (ev.key === 'Escape') handlers.key('escape');
  });
}
