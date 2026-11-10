// ===== main.js : boot and wiring of HUD buttons =====
(function boot() {
  R.init($('#map'));
  UI.input = attachInput($('#map'), { tap: (x, y) => UI.tap(x, y) });
  $$('#speed button').forEach(b => b.addEventListener('click', () => { Sound.unlock(); UI.setSpeed(+b.dataset.sp); Sound.play('tap'); }));
  $('#btnMenu').addEventListener('click', () => { Sound.unlock(); Panels.gameMenu(); });
  $('#clock').addEventListener('click', () => { Sound.unlock(); UI.togglePause(); });
  const tabs = { build: () => Panels.build(), layers: () => Panels.layers(), people: () => Panels.people(), research: () => Panels.research(), rockets: () => Panels.rockets(), log: () => Panels.log(), goals: () => Panels.goals() };
  $$('#bottom .tb').forEach(b => b.addEventListener('click', () => {
    Sound.unlock(); Sound.play('open');
    if (UI.mode) UI.cancelMode();
    if (Sheet.cur && Sheet.cur.tab === b.dataset.tab) { Sheet.close(); return; }
    tabs[b.dataset.tab]();
  }));
  document.addEventListener('keydown', e => {
    if (!UI.G || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); UI.togglePause(); }
    else if (e.key === 'Escape') { if (UI.mode) UI.cancelMode(); else Sheet.close(); }
    else if (e.key === '1' || e.key === '2' || e.key === '3') UI.setSpeed([1, 3, 10][+e.key - 1]);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && UI.G && Settings.get('autosave')) Saves.write('auto', UI.G); });
  window.addEventListener('pagehide', () => { if (UI.G && Settings.get('autosave')) Saves.write('auto', UI.G); });
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  Screens.main();
  requestAnimationFrame(t => UI.loop(t));
})();
