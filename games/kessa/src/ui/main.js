// ===== main.js : boot and wiring of HUD buttons =====
(function boot() {
  R.init($('#map'));
  // drawn icons for the static HUD buttons
  const put = (sel, name) => { const el = $(sel); if (el) { el.textContent = ''; el.appendChild(ic(name)); } };
  put('#btnMenu', 'menu');
  { const a = $('#btnAdvice'), n = $('#advN'); a.textContent = ''; a.appendChild(ic('advisor')); a.appendChild(n); }
  for (const [sp, name] of [['0', 'pause'], ['1', 'play'], ['3', 'fast'], ['10', 'fastest']]) put('#speed [data-sp="' + sp + '"]', name);
  $$('#bottom .tb').forEach(b => { const i = $('i', b); i.textContent = ''; i.appendChild(ic(b.dataset.tab)); });
  UI.input = attachInput($('#map'), { tap: (x, y) => UI.tap(x, y) });
  $$('#speed button').forEach(b => b.addEventListener('click', () => { Sound.unlock(); UI.setSpeed(+b.dataset.sp); Sound.play('tap'); }));
  $('#btnMenu').addEventListener('click', () => { Sound.unlock(); Panels.gameMenu(); });
  $('#btnAdvice').addEventListener('click', () => { Sound.unlock(); Sound.play('open'); if (UI.mode) UI.cancelMode(); if (UI.G && UI.G.event) Screens.event(); else Panels.advice(); });
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
