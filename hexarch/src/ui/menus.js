// ===== menus.js : screens and dialogs =====
function showScreen(el) { $('screens').replaceChildren(el); }
function closeScreens() { $('screens').replaceChildren(); }
function screen(...kids) { return h('div', { class: 'screen' }, h('div', { class: 'wrap' }, kids)); }
function backBtn(fn) { return h('button', { class: 'icon', 'aria-label': 'Back', onclick: fn }, '‹'); }
function closeModal() { $('modal').replaceChildren(); }
function confirmDlg(title, text, okLabel, onOk, danger) {
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, title), h('p', null, text),
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { class: danger ? 'danger' : 'pri', onclick: () => { closeModal(); onOk(); } }, okLabel))));
}
function infoDlg(title, text) {
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, title), h('p', null, text), h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: closeModal }, 'OK'))));
}
function seg(options, value, onPick) {
  return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: () => onPick(v) }, label)));
}
function toggleRow(label, sub, on, onChange, badge) {
  const sw = h('button', { class: 'sw2' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label,
    onclick: () => { on = !on; sw.classList.toggle('on', on); sw.setAttribute('aria-checked', on ? 'true' : 'false'); onChange(on); } });
  return h('div', { class: 'toggle' }, h('div', { class: 'lb' }, label, badge ? h('span', { class: 'badge' }, badge) : null, sub ? h('small', null, sub) : null), sw);
}
function fmtDate(ms) { const d = new Date(ms); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

// ---------- main menu ----------
function showMainMenu() {
  leaveGame();
  const latest = Saves.latest();
  showScreen(screen(
    h('h1', null, 'HEXARCH'),
    h('div', { class: 'sub' }, 'Found cities. Explore the world. Outlast your rivals.'),
    h('div', { class: 'col' },
      latest ? h('button', { class: 'pri', onclick: () => loadSlot(latest) }, 'Continue', h('span', { class: 'note', style: 'display:block;margin:0;color:#3b2f10' }, describeMeta(Saves.meta(latest)))) : null,
      h('button', { class: latest ? '' : 'pri', onclick: showNewGame }, 'New game'),
      h('button', { onclick: () => showLoad(showMainMenu) }, 'Load game'),
      h('button', { onclick: () => showSettings(showMainMenu) }, 'Settings'),
      h('button', { onclick: () => showHelp(showMainMenu) }, 'How to play')),
    h('div', { class: 'ver' }, `Version ${HX.version} · Build 2 of 9: economy, cities, research, trade`)));
}
function describeMeta(m) { return m ? `${m.civ} · Turn ${m.turn} · ${MAPSIZE[m.size] ? MAPSIZE[m.size].name : ''} ${MAPSCRIPT[m.script] ? MAPSCRIPT[m.script].name : ''}` : ''; }

// ---------- new game ----------
function showNewGame() {
  const cfg = Object.assign(HX.defaultConfig(), Settings.get('lastCfg') || {});
  cfg.victories = Object.assign(HX.defaultConfig().victories, cfg.victories || {});
  cfg.seed = '';
  const render = () => {
    const sc = $('screens').firstChild, top = sc ? sc.scrollTop : 0;
    const maxR = MAPSIZE[cfg.size].maxCivs - 1;
    if (cfg.rivals > maxR) cfg.rivals = maxR;
    const civCard = (key, name, leader, bonus, color) => h('button', { class: 'civ' + (cfg.civ === key ? ' on' : ''), onclick: () => { cfg.civ = key; render(); } },
      h('div', { class: 'sw', style: `background:${color}` }),
      h('div', null, h('div', { class: 'n' }, name), leader ? h('div', { class: 'l' }, leader) : null, h('div', { class: 'b' }, bonus)));
    const seedIn = h('input', { type: 'text', placeholder: 'Leave blank for a random world', value: cfg.seed, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    seedIn.addEventListener('input', () => { cfg.seed = seedIn.value; });
    const el = screen(
      h('h2', null, backBtn(showMainMenu), 'New game'),
      h('h3', null, 'Your civilization'),
      h('div', { class: 'civs' },
        civCard('random', 'Random', '', 'Let fate decide.', 'conic-gradient(#e2b544,#5b84dc,#e46a3c,#2db7a6,#62c44c,#b85aa6,#e2b544)'),
        CIVS.map(c => civCard(c.key, c.name, c.leader, `${c.bonus}: ${c.bonusText} Unique unit: ${c.uu}.`, c.color))),
      h('div', { class: 'note' }, 'Civilization bonuses and unique units take effect as economy and combat arrive in later builds.'),
      h('h3', null, 'Map size'),
      seg(Object.values(MAPSIZE).map(s => [s.key, s.name]), cfg.size, v => { cfg.size = v; render(); }),
      h('div', { class: 'note' }, `${MAPSIZE[cfg.size].W}×${MAPSIZE[cfg.size].H} tiles, up to ${maxR} rivals. The map wraps east to west.`),
      h('h3', null, 'Map type'),
      seg(Object.values(MAPSCRIPT).map(s => [s.key, s.name]), cfg.script, v => { cfg.script = v; render(); }),
      h('h3', null, 'Rivals'),
      h('div', { class: 'stepper' },
        h('button', { disabled: cfg.rivals <= 1, onclick: () => { cfg.rivals--; render(); } }, '−'),
        h('div', { class: 'v' }, String(cfg.rivals)),
        h('button', { disabled: cfg.rivals >= maxR, onclick: () => { cfg.rivals++; render(); } }, '+'),
        h('div', { class: 'note', style: 'margin:0' }, 'computer opponents')),
      h('h3', null, 'Difficulty'),
      seg(DIFFICULTY.map((d, i) => [i, d.name]), cfg.difficulty, v => { cfg.difficulty = v; render(); }),
      h('div', { class: 'note' }, DIFFICULTY[cfg.difficulty].desc),
      h('h3', null, 'Turn limit'),
      seg(TURN_LIMITS.map(t => [t, String(t)]), cfg.turnLimit, v => { cfg.turnLimit = v; render(); }),
      h('h3', null, 'Barbarians', h('span', { class: 'badge' }, 'later build')),
      seg(BARBARIANS.map(b => [b.key, b.name]), cfg.barbarians, v => { cfg.barbarians = v; render(); }),
      h('h3', null, 'Victory conditions', h('span', { class: 'badge' }, 'later build')),
      VICTORIES.map(v => toggleRow(v.name, v.desc, cfg.victories[v.key], on => { cfg.victories[v.key] = on; })),
      h('h3', null, 'World seed'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, seedIn), h('button', { 'aria-label': 'Random seed', onclick: () => { cfg.seed = HX.randomSeedString(); render(); } }, '🎲')),
      h('div', { class: 'note' }, 'The same seed and settings always make the same world. Share it with a friend.'),
      h('div', { class: 'bar' }, h('button', { onclick: showMainMenu }, 'Back'), h('button', { class: 'pri', onclick: () => startNewGame(cfg) }, 'Start game')));
    showScreen(el);
    el.scrollTop = top;
  };
  render();
}
function startNewGame(cfg) {
  const keep = Object.assign({}, cfg); delete keep.seed;
  Settings.set('lastCfg', keep);
  showScreen(screen(h('h1', null, 'HEXARCH'), h('div', { class: 'sub' }, 'Shaping continents…')));
  setTimeout(() => {
    try { enterGame(HX.makeGame(Object.assign({}, cfg))); }
    catch (e) { showMainMenu(); infoDlg('Could not create the world', String(e && e.message || e)); }
  }, 40);
}

// ---------- pause ----------
function showPause() {
  if (!UI.G) return;
  const G = UI.G, civ = humanCiv();
  showScreen(screen(
    h('h2', null, 'Paused'),
    h('div', { class: 'col' },
      h('button', { class: 'pri', onclick: closeScreens }, 'Resume'),
      h('button', { disabled: UI.busy, onclick: () => showSave(showPause) }, 'Save game'),
      h('button', { onclick: () => showLoad(showPause) }, 'Load game'),
      h('button', { onclick: () => showSettings(showPause) }, 'Settings'),
      h('button', { onclick: () => showHelp(showPause) }, 'How to play'),
      h('button', { class: 'danger', onclick: () => confirmDlg('Quit to main menu?', 'Your game was autosaved at the start of this turn. Moves made since then are saved too.', 'Quit', () => { if (UI.autoSlot && !UI.busy) Saves.write(UI.autoSlot, G, UI.pid); showMainMenu(); }) }, 'Quit to main menu')),
    h('h3', null, 'This game'),
    h('p', null, `${civ.name}, led by ${civ.leader}. ${MAPSIZE[G.cfg.size].name} ${MAPSCRIPT[G.cfg.script].name} map, ${G.players.length - 1} rivals, ${DIFFICULTY[G.cfg.difficulty].name} difficulty. Turn ${G.turn} of ${G.cfg.turnLimit}.`),
    h('p', null, 'Seed: ', h('b', { style: '-webkit-user-select:text;user-select:text;color:#e9eef4' }, G.seed))));
}

// ---------- save / load ----------
function slotRow(slot, label, actions) {
  const m = Saves.meta(slot);
  return h('div', { class: 'slot' + (m ? '' : ' empty') },
    h('div', { class: 'meta' }, h('div', { class: 'a' }, m ? `${label}: ${m.civ}` : `${label}: empty`),
      m ? h('div', { class: 'b' }, `Turn ${m.turn} · ${m.cities} ${m.cities === 1 ? 'city' : 'cities'} · ${fmtDate(m.date)}`) : null),
    actions(m));
}
function showSave(back) {
  const G = UI.G;
  const render = () => showScreen(screen(
    h('h2', null, backBtn(back), 'Save game'),
    h('div', { class: 'col' }, Saves.MANUAL.map((s, i) => slotRow(s, `Slot ${i + 1}`, m => h('button', { class: m ? '' : 'pri', onclick: () => {
      const go = () => { const err = Saves.write(s, G, UI.pid); if (err) infoDlg('Save failed', err); else { toast('Game saved to slot ' + (i + 1) + '.'); render(); } };
      if (m) confirmDlg('Overwrite slot ' + (i + 1) + '?', `It holds ${m.civ}, turn ${m.turn}.`, 'Overwrite', go); else go();
    } }, m ? 'Overwrite' : 'Save')))),
    h('h3', null, 'Move a game to another device'),
    h('p', null, 'Export copies the whole game as text. Paste it into Import on the other device, or keep it in Notes as a backup.'),
    h('button', { style: 'width:100%', onclick: () => exportDlg(HX.serializeGame(G)) }, 'Export save as text')));
  render();
}
function showLoad(back) {
  const render = () => {
    const act = (s) => m => m ? h('div', { class: 'row' },
      h('button', { class: 'pri', onclick: () => loadSlot(s) }, 'Load'),
      h('button', { class: 'icon danger', 'aria-label': 'Delete', onclick: () => confirmDlg('Delete this save?', `${m.civ}, turn ${m.turn}.`, 'Delete', () => { Saves.remove(s); render(); }, true) }, '🗑')) : h('span');
    showScreen(screen(
      h('h2', null, backBtn(back), 'Load game'),
      h('h3', null, 'Autosaves'),
      h('div', { class: 'col' }, Saves.AUTO.map((s, i) => slotRow(s, `Auto ${i + 1}`, act(s)))),
      h('h3', null, 'Saved games'),
      h('div', { class: 'col' }, Saves.MANUAL.map((s, i) => slotRow(s, `Slot ${i + 1}`, act(s)))),
      h('h3', null, 'Import'),
      h('button', { style: 'width:100%', onclick: importDlg }, 'Import save from text')));
  };
  render();
}
function loadSlot(s) {
  const data = Saves.read(s);
  if (!data) return infoDlg('Empty slot', 'There is no game in this slot.');
  loadFromText(data);
}
function loadFromText(text) {
  let G;
  try { G = HX.deserializeGame(text.trim()); }
  catch (e) { return infoDlg('Could not load', String(e && e.message || e)); }
  enterGame(G);
}
function exportDlg(text) {
  const ta = h('textarea', { readonly: true }); ta.value = text;
  const copy = h('button', { class: 'pri', onclick: async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
    catch (e) { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); copy.textContent = 'Selected, tap Copy'; }
  } }, 'Copy');
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, 'Export save'), h('p', null, `${Math.round(text.length / 1024)} KB of text.`), ta,
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Close'), copy)));
}
function importDlg() {
  const ta = h('textarea', { placeholder: 'Paste exported save text here' });
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, 'Import save'), ta,
    h('div', { class: 'bar' }, h('button', { onclick: closeModal }, 'Cancel'),
      h('button', { class: 'pri', onclick: () => { const t = ta.value; closeModal(); loadFromText(t); } }, 'Load'))));
  setTimeout(() => ta.focus(), 50);
}

// ---------- settings ----------
function showSettings(back) {
  const render = () => showScreen(screen(
    h('h2', null, backBtn(back), 'Settings'),
    h('h3', null, 'Map'),
    toggleRow('Hex grid', 'Thin outlines around every tile.', Settings.get('grid'), v => { Settings.set('grid', v); renderer.request(); }),
    toggleRow('Resource icons', 'Show resources on the map.', Settings.get('resources'), v => { Settings.set('resources', v); renderer.request(); }),
    h('h3', null, 'Unit movement animation'),
    seg([['off', 'Off'], ['normal', 'Normal'], ['fast', 'Fast']], Settings.get('anim'), v => { Settings.set('anim', v); render(); }),
    h('h3', null, 'Rendering'),
    seg([['high', 'Sharp'], ['battery', 'Battery saver']], Settings.get('quality'), v => { Settings.set('quality', v); renderer.resize(); render(); }),
    h('div', { class: 'note' }, 'Battery saver draws the map at lower resolution.'),
    h('h3', null, 'Controls'),
    toggleRow('Auto-select next unit', 'After a unit finishes moving, jump to the next one.', Settings.get('autoCycle'), v => Settings.set('autoCycle', v)),
    toggleRow('Confirm end turn', 'Ask before ending a turn while units still have moves.', Settings.get('confirmEnd'), v => Settings.set('confirmEnd', v)),
    h('div', { class: 'toggle' }, h('div', { class: 'lb' }, 'End turn button side'), seg([['left', 'Left'], ['right', 'Right']], Settings.get('hand'), v => { Settings.set('hand', v); updateHUD(); render(); })),
    h('h3', null, 'Data'),
    h('button', { class: 'danger', style: 'width:100%', onclick: () => confirmDlg('Delete all saves?', 'Every autosave and saved game on this device will be erased. Settings are kept.', 'Delete all', () => { Saves.AUTO.concat(Saves.MANUAL).forEach(s => Saves.remove(s)); toast('All saves deleted.'); }, true) }, 'Delete all saved games'),
    h('div', { class: 'note' }, 'Saves live in this browser on this device. The home-screen app and a Safari tab keep separate saves. Use Export to move a game between them.')));
  render();
}

// ---------- help ----------
function showHelp(back) {
  showScreen(screen(
    h('h2', null, backBtn(back), 'How to play'),
    h('div', { class: 'help' },
      h('p', null, h('b', null, 'Map. '), 'Drag to pan. Pinch to zoom. The world wraps east to west. Long-press any tile to inspect it.'),
      h('p', null, h('b', null, 'Units. '), 'Tap a unit to select it. Tap a destination to see the route; the numbers show which turn it arrives. Tap the same tile again, or press Move here, to go. Tap a tile repeatedly to cycle between its units, city and terrain.'),
      h('p', null, h('b', null, 'Movement. '), 'Grassland, Plains, Desert and Tundra cost 1 move. Hills, Forest and Marsh cost 2. Crossing a river costs 1 more. Roads cost a third of a move and bridge rivers; railroads cost a sixth. A unit with full moves can always step one tile. Mountains and water are impassable for now.'),
      h('p', null, h('b', null, 'Stacking. '), 'One military unit and one civilian unit may share a tile. Units can walk through friendly units but cannot stop on the same tile as one of the same kind.'),
      h('p', null, h('b', null, 'Cities. '), 'Settlers found cities with Found city. City centers must have 3 tiles between them. Good sites have food, production, fresh water from a river or lake, and coast.'),
      h('p', null, h('b', null, 'Fog of war. '), 'Dark tiles are unexplored. Dimmed tiles show what you last saw there. Hills give units extra sight. Forest, Hills and Mountains block the view behind them.'),
      h('p', null, h('b', null, 'Orders. '), 'Explore sends a unit out automatically. Sleep and Fortify keep a unit idle until you wake it. Skip passes for one turn. Next unit cycles through units that still need orders.'),
      h('p', null, h('b', null, 'Saving. '), 'The game autosaves at the start of every turn into three rotating slots, and again when you leave the app. Five manual slots are in the pause menu. Export turns a save into text you can paste on another device.'),
      h('p', null, h('b', null, 'Cities. '), 'Tap your city, then Open city. Pick what to build; tap + to queue more. Buy finishes the item now for gold. Citizens work the best tiles for the chosen focus; extra citizens become scholars.'),
      h('p', null, h('b', null, 'Growth. '), 'Each citizen eats 2 food. Surplus food fills the growth bar. Culture claims new tiles for the city one at a time.'),
      h('p', null, h('b', null, 'Happiness. '), 'Every city and every two citizens cost happiness. Improved luxuries, Temples, Arenas and Courthouses add it. Below zero, growth halves; at −10, growth stops and output drops.'),
      h('p', null, h('b', null, 'Research. '), 'Tap the science button at the top. Tap a locked tech to queue everything it needs. Insights (💡) are goals that cut a tech\'s cost by a third.'),
      h('p', null, h('b', null, 'Builders. '), 'Builders have 3 charges. Each farm, mine, pasture or similar uses one. Roads are free, cost the turn, and link cities to the capital for gold. Auto lets a Builder decide for itself.'),
      h('p', null, h('b', null, 'Trade. '), 'Currency unlocks Caravans. A Caravan opens a permanent route: home routes feed the target city, foreign routes earn gold and can bring science.'),
      h('p', null, h('b', null, 'Gold. '), 'Buildings and units beyond the free allowance cost upkeep. If the treasury runs dry, research slows.'),
      h('p', null, h('b', null, 'This build. '), 'Build 2 adds the economy. Policies, religion, combat, diplomacy, wonders and victory arrive in the next builds.'))));
}

boot();
