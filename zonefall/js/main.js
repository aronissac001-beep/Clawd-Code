'use strict';
// ZONEFALL — boot + service worker registration (offline / Home Screen app)
(function () {
  // patch the frame loop so UI timers tick every frame
  const origFrame = Game.frame.bind(Game);
  Game.frame = function (t) { const dt = Math.min(0.05, (t - (this._uiLast || t)) / 1000); this._uiLast = t; if (!this.paused) UI.tick(dt); origFrame(t); };
  $('#mapov').addEventListener('click', () => $('#mapov').classList.add('hidden'));
  $('#mapov').addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  document.addEventListener('visibilitychange', () => { if (document.hidden && Game.run && Game.mode !== 'zone' && Game.mode !== 'menu') Game.save(); });
  window.addEventListener('pagehide', () => { if (Game.run && Game.mode !== 'zone' && Game.mode !== 'menu') Game.save(); });
  Game.init();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => { });
})();
