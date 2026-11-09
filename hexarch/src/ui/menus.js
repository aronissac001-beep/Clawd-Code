// ===== menus.js : screens and dialogs =====
function showScreen(el) { $('screens').replaceChildren(el); }
function closeScreens() { $('screens').replaceChildren(); if (typeof checkTips === 'function') setTimeout(checkTips, 300); }
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
// A freshly generated little world behind the title.
function menuBackdrop() {
  const cv = h('canvas', { id: 'menuBg' });
  setTimeout(() => {
    try {
      const rng = RNG.fromSeed('menu' + Math.floor(Math.random() * 1e9));
      const { map } = generateMap({ size: 'small', script: Math.random() < 0.5 ? 'continents' : 'archipelago', civs: 2 }, rng);
      const w = window.innerWidth, hh = window.innerHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = w * dpr; cv.height = hh * dpr; const x = cv.getContext('2d'); x.scale(dpr, dpr);
      const R = Math.max(w / (map.W * SQ3) * 1.6, hh / (map.H * 1.5) * 1.15);
      // the same painted terrain as the game, one cached sprite per terrain and variant
      const sw = Math.ceil(SQ3 * R * dpr) + 4, sh = Math.ceil(2 * R * dpr) + 4, cache = new Map();
      const sprite = (t, v) => { const k = t * 8 + v; let c = cache.get(k); if (!c) { c = document.createElement('canvas'); c.width = sw; c.height = sh; const cx = c.getContext('2d'); cx.translate(sw / 2, sh / 2); drawTerrainSprite(cx, t, v, R * dpr); cache.set(k, c); } return c; };
      for (let i = 0; i < map.W * map.H; i++) {
        const c = i % map.W, r = (i / map.W) | 0, px = SQ3 * R * (c + 0.5 * (r & 1)) - R * 6, py = 1.5 * R * r;
        if (px < -R * 2 || px > w + R * 2 || py > hh + R * 2) continue;
        x.drawImage(sprite(map.terrain[i], (i * 7 + r) % 4), px - sw / dpr / 2, py - sh / dpr / 2, sw / dpr, sh / dpr);
      }
      const vg = x.createRadialGradient(w / 2, hh * 0.35, Math.min(w, hh) * 0.2, w / 2, hh * 0.5, Math.max(w, hh) * 0.75);
      vg.addColorStop(0, 'rgba(8,12,18,.15)'); vg.addColorStop(1, 'rgba(8,12,18,.85)'); x.fillStyle = vg; x.fillRect(0, 0, w, hh);
    } catch (e) { /* decorative only */ }
  }, 0);
  return cv;
}
function showMainMenu() {
  leaveGame();
  const latest = Saves.latest();
  const el = screen(
    h('h1', null, 'HEXARCH'),
    h('div', { class: 'sub' }, 'Found cities. Explore the world. Outlast your rivals.'),
    h('div', { class: 'col' },
      latest ? h('button', { class: 'pri', onclick: () => loadSlot(latest) }, 'Continue', h('span', { class: 'note', style: 'display:block;margin:0;color:#3b2f10' }, describeMeta(Saves.meta(latest)))) : null,
      h('button', { class: latest ? '' : 'pri', onclick: showNewGame }, 'New game'),
      h('button', { onclick: () => startNewGame(Object.assign(HX.defaultConfig(), { size: 'small', script: Math.random() < 0.5 ? 'continents' : 'pangaea', rivals: 3, turnLimit: 250, civ: 'random' })) }, 'Quick start: small map, 250 turns'),
      h('button', { class: 'exp-btn', onclick: () => showExpedition(showMainMenu) }, '🗺️ Expedition: a roguelike run' + (heatUnlocked() ? ` · Heat ${heatUnlocked()}` : '')),
      h('button', { onclick: () => showLoad(showMainMenu) }, 'Load game'),
      h('button', { onclick: () => showSettings(showMainMenu) }, 'Settings'),
      h('button', { onclick: () => showHelp(showMainMenu) }, 'How to play'),
      h('button', { onclick: () => showCodex(showMainMenu) }, 'Codex'),
      h('button', { onclick: () => showHall(showMainMenu) }, 'Hall of Fame' + ((Settings.get('hall') || []).some(x => x.won) ? ' 🏆' : ''))),
    h('div', { class: 'ver' }, `Version ${HX.version} · Build 9 of 9: balanced and complete`));
  el.classList.add('menu'); el.prepend(menuBackdrop());
  showScreen(el);
}
function describeMeta(m) { return m ? (m.exp !== undefined ? `🗺️ Heat ${m.exp} · ` : '') + `${m.civ} · Turn ${m.turn} · ${MAPSIZE[m.size] ? MAPSIZE[m.size].name : ''} ${MAPSCRIPT[m.script] ? MAPSCRIPT[m.script].name : ''}` : ''; }

// ---------- new game ----------
function showNewGame() {
  const cfg = Object.assign(HX.defaultConfig(), Settings.get('lastCfg') || {});
  cfg.victories = Object.assign(HX.defaultConfig().victories, cfg.victories || {});
  cfg.seed = ''; delete cfg.expedition; delete cfg.ironman;
  const render = () => {
    const sc = $('screens').firstChild, top = sc ? sc.scrollTop : 0;
    cfg.humans = cfg.humans || 1; cfg.hotseatCivs = cfg.hotseatCivs || [];
    if (cfg.humans > MAPSIZE[cfg.size].maxCivs) cfg.humans = MAPSIZE[cfg.size].maxCivs;
    const maxR = MAPSIZE[cfg.size].maxCivs - cfg.humans, minR = cfg.humans > 1 ? 0 : 1;
    if (cfg.rivals > maxR) cfg.rivals = maxR; if (cfg.rivals < minR) cfg.rivals = minR;
    const civSelect = (k) => { const sel = h('select', { 'aria-label': `Player ${k + 2} civilization` }, h('option', { value: 'random' }, 'Random'), CIVS.filter(c => !c.barb && !c.minor).map(c => h('option', { value: c.key }, c.name)));
      sel.value = cfg.hotseatCivs[k] || 'random'; sel.addEventListener('change', () => { cfg.hotseatCivs[k] = sel.value; }); return sel; };
    const civCard = (key, name, leader, bonus, color) => h('button', { class: 'civ' + (cfg.civ === key ? ' on' : ''), onclick: () => { cfg.civ = key; render(); } },
      key !== 'random' && CIVS[CIVI[key]] ? civEmblem(CIVS[CIVI[key]], 44) : h('div', { class: 'sw', style: `background:${color}` }),
      h('div', null, h('div', { class: 'n' }, name), leader ? h('div', { class: 'l' }, leader) : null, h('div', { class: 'b' }, bonus)));
    const seedIn = h('input', { type: 'text', placeholder: 'Leave blank for a random world', value: cfg.seed, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    seedIn.addEventListener('input', () => { cfg.seed = seedIn.value; });
    const el = screen(
      h('h2', null, backBtn(showMainMenu), 'New game'),
      h('h3', null, 'Your civilization'),
      h('div', { class: 'civs' },
        civCard('random', 'Random', '', 'Let fate decide.', 'conic-gradient(#e2b544,#5b84dc,#e46a3c,#2db7a6,#62c44c,#b85aa6,#e2b544)'),
        CIVS.filter(c => !c.barb && !c.minor).map(c => civCard(c.key, c.name, c.leader, `${c.bonus}: ${c.bonusText} Unique unit: ${c.uu}, ${c.uuText.charAt(0).toLowerCase() + c.uuText.slice(1)}`, c.color))),
      h('h3', null, 'Map size'),
      seg(Object.values(MAPSIZE).map(s => [s.key, s.name]), cfg.size, v => { cfg.size = v; render(); }),
      h('div', { class: 'note' }, `${MAPSIZE[cfg.size].W}×${MAPSIZE[cfg.size].H} tiles, up to ${maxR} rivals. The map wraps east to west.`),
      h('h3', null, 'Map type'),
      seg(Object.values(MAPSCRIPT).map(s => [s.key, s.name]), cfg.script, v => { cfg.script = v; render(); }),
      h('h3', null, 'Players on this phone'),
      h('div', { class: 'stepper' },
        h('button', { disabled: cfg.humans <= 1, onclick: () => { cfg.humans--; render(); } }, '−'),
        h('div', { class: 'v' }, String(cfg.humans)),
        h('button', { disabled: cfg.humans >= Math.min(4, MAPSIZE[cfg.size].maxCivs), onclick: () => { cfg.humans++; render(); } }, '+'),
        h('div', { class: 'note', style: 'margin:0' }, cfg.humans > 1 ? 'pass and play' : 'just you')),
      cfg.humans > 1 ? h('div', { class: 'col', style: 'margin-top:8px' }, Array.from({ length: cfg.humans - 1 }, (_, k) => h('div', { class: 'toggle' }, h('div', { class: 'lb' }, `Player ${k + 2}`), civSelect(k)))) : null,
      cfg.humans > 1 ? h('div', { class: 'note' }, 'Players take turns on this phone. The map hides between turns so nobody sees the other\'s land. Player 1 uses the civilization chosen above.') : null,
      h('h3', null, 'Computer rivals'),
      h('div', { class: 'stepper' },
        h('button', { disabled: cfg.rivals <= minR, onclick: () => { cfg.rivals--; render(); } }, '−'),
        h('div', { class: 'v' }, String(cfg.rivals)),
        h('button', { disabled: cfg.rivals >= maxR, onclick: () => { cfg.rivals++; render(); } }, '+'),
        h('div', { class: 'note', style: 'margin:0' }, 'computer opponents')),
      h('h3', null, 'Difficulty'),
      seg(DIFFICULTY.map((d, i) => [i, d.name]), cfg.difficulty, v => { cfg.difficulty = v; render(); }),
      h('div', { class: 'note' }, DIFFICULTY[cfg.difficulty].desc),
      h('h3', null, 'Turn limit'),
      seg(TURN_LIMITS.map(t => [t, String(t)]), cfg.turnLimit, v => { cfg.turnLimit = v; render(); }),
      h('h3', null, 'Barbarians'),
      seg(BARBARIANS.map(b => [b.key, b.name]), cfg.barbarians, v => { cfg.barbarians = v; render(); }),
      h('h3', null, 'World'),
      toggleRow('Free cities', 'Independent city-states you can befriend with gold for steady bonuses, or conquer.', cfg.cityStates !== false, on => { cfg.cityStates = on; }),
      toggleRow('Ancient ruins', 'Ruins scattered over the world. The first unit to step on one finds treasure, relics, maps, recruits, or a barbarian trap.', cfg.ruins !== false, on => { cfg.ruins = on; }),
      toggleRow('Quests', 'At each new era, take on an optional challenge with a deadline for a relic or gold.', cfg.quests !== false, on => { cfg.quests = on; }),
      toggleRow('Random events', 'Harvests, fires, scholars, comets and more, each with a choice to make.', cfg.events !== false, on => { cfg.events = on; }),
      h('h3', null, 'Victory conditions'),
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
function startNewGame(cfg, isRun) {
  const keep = Object.assign({}, cfg); delete keep.seed;
  if (!isRun) Settings.set('lastCfg', keep);
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
      G.cfg.ironman ? null : h('button', { disabled: UI.busy, onclick: () => showSave(showPause) }, 'Save game'),
      G.cfg.ironman ? null : h('button', { onclick: () => showLoad(showPause) }, 'Load game'),
      h('button', { onclick: () => showEmpire() }, 'Empire and relics'),
      h('button', { onclick: () => showRivals(showPause) }, 'Diplomacy' + (G.offers.some(o => o.to === UI.pid) ? ' ●' : '')),
      h('button', { onclick: () => showPolicies(showPause) }, 'Policies'),
      h('button', { onclick: () => showVictory(showPause) }, 'Victory and wonders'),
      h('button', { onclick: () => showLog(showPause) }, 'Event log'),
      h('button', { onclick: () => showSettings(showPause) }, 'Settings'),
      h('button', { onclick: () => showHelp(showPause) }, 'How to play'),
      h('button', { onclick: () => showCodex(showPause) }, 'Codex: units, buildings, wonders'),
      h('button', { class: 'danger', onclick: () => confirmDlg('Quit to main menu?', 'Your game was autosaved at the start of this turn. Moves made since then are saved too.', 'Quit', () => { if (UI.autoSlot && !UI.busy) Saves.write(UI.autoSlot, G, UI.pid); showMainMenu(); }) }, 'Quit to main menu')),
    h('h3', null, 'This game'),
    G.cfg.expedition ? h('p', null, `🗺️ Expedition at Heat ${HX.expHeat(G)} (${heatName(HX.expHeat(G))}). One save, kept every turn; no undo. Run score so far ${HX.runScore(G, UI.pid, false)}.`) : null,
    h('p', null, `${civ.name}, led by ${civ.leader}. ${MAPSIZE[G.cfg.size].name} ${MAPSCRIPT[G.cfg.script].name} map, ${HX.majorPlayers(G).length - 1} rivals, ${DIFFICULTY[G.cfg.difficulty].name} difficulty. Turn ${G.turn} of ${G.cfg.turnLimit}.`),
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
      Saves.meta(Saves.RUN) ? h('h3', null, 'Expedition') : null,
      Saves.meta(Saves.RUN) ? h('div', { class: 'col' }, slotRow(Saves.RUN, 'Run', act(Saves.RUN))) : null,
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
    h('h3', null, 'Sound'),
    toggleRow('Sound effects', 'Clicks, battles, discoveries and fanfares, all synthesized.', (Settings.get('sound') || {}).sfx !== false, v => { Settings.set('sound', Object.assign({}, Settings.get('sound'), { sfx: v })); Sound.applySettings(); }),
    toggleRow('Music', 'Slow generative music that changes with the era and with war.', (Settings.get('sound') || {}).music !== false, v => { Settings.set('sound', Object.assign({}, Settings.get('sound'), { music: v })); Sound.unlock(); Sound.applySettings(); }),
    h('div', { class: 'toggle' }, h('div', { class: 'lb' }, 'Volume'), seg([[0.3, 'Low'], [0.6, 'Mid'], [0.9, 'High']], (Settings.get('sound') || {}).vol || 0.8, v => { Settings.set('sound', Object.assign({}, Settings.get('sound'), { vol: v })); Sound.applySettings(); Sound.play('build'); render(); })),
    h('div', { class: 'note' }, 'Sound follows your iPhone\'s silent switch.'),
    h('h3', null, 'Map'),
    toggleRow('3D terrain', 'Tilted view with raised hills and mountains and cliff edges. Turn off for a flat top-down map.', Settings.get('view3d') !== false, v => { Settings.set('view3d', v); if (renderer) { renderer.sprites = null; renderer.request(); } }),
    toggleRow('Hex grid', 'Thin outlines around every tile.', Settings.get('grid'), v => { Settings.set('grid', v); renderer.request(); }),
    toggleRow('Resource icons', 'Show resources on the map.', Settings.get('resources'), v => { Settings.set('resources', v); renderer.request(); }),
    h('h3', null, 'Unit movement animation'),
    seg([['off', 'Off'], ['normal', 'Normal'], ['fast', 'Fast']], Settings.get('anim'), v => { Settings.set('anim', v); render(); }),
    h('h3', null, 'Rendering'),
    seg([['high', 'Sharp'], ['battery', 'Battery saver']], Settings.get('quality'), v => { Settings.set('quality', v); renderer.resize(); render(); }),
    h('div', { class: 'note' }, 'Battery saver draws the map at lower resolution.'),
    h('h3', null, 'Guide'),
    toggleRow('Tips', 'Short hints the first time something new happens.', Settings.get('tips'), v => Settings.set('tips', v)),
    h('button', { style: 'width:100%', onclick: () => { Settings.set('tipsSeen', []); Settings.set('tips', true); toast('Tips will show again.'); render(); } }, 'Show all tips again'),
    h('h3', null, 'Controls'),
    toggleRow('Auto-select next unit', 'After a unit finishes moving, jump to the next one.', Settings.get('autoCycle'), v => Settings.set('autoCycle', v)),
    toggleRow('Confirm end turn', 'Ask before ending a turn while units still have moves.', Settings.get('confirmEnd'), v => Settings.set('confirmEnd', v)),
    toggleRow('Cities fire automatically', 'At the end of your turn, cities shoot the weakest enemy in range.', Settings.get('autoBombard'), v => Settings.set('autoBombard', v)),
    h('div', { class: 'toggle' }, h('div', { class: 'lb' }, 'End turn button side'), seg([['left', 'Left'], ['right', 'Right']], Settings.get('hand'), v => { Settings.set('hand', v); updateHUD(); render(); })),
    h('h3', null, 'Data'),
    h('button', { class: 'danger', style: 'width:100%', onclick: () => confirmDlg('Delete all saves?', 'Every autosave and saved game on this device will be erased. Settings are kept.', 'Delete all', () => { Saves.AUTO.concat(Saves.MANUAL, [Saves.RUN]).forEach(s => Saves.remove(s)); toast('All saves deleted.'); }, true) }, 'Delete all saved games'),
    h('div', { class: 'note' }, 'Saves live in this browser on this device. The home-screen app and a Safari tab keep separate saves. Use Export to move a game between them.')));
  render();
}

// ---------- help ----------
function showHelp(back) {
  const el = screen(
    h('h2', null, backBtn(back), 'How to play'),
    h('div', { class: 'help' },
      h('p', null, h('b', null, 'Map. '), 'Drag to pan. Pinch to zoom. The world wraps east to west. Long-press any tile to inspect it.'),
      h('p', null, h('b', null, 'Units. '), 'Tap a unit to select it. Tap a destination to see the route; the numbers show which turn it arrives. Tap the same tile again, or press Move here, to go. Tap a tile repeatedly to cycle between its units, city and terrain.'),
      h('p', null, h('b', null, 'Movement. '), 'Grassland, Plains, Desert and Tundra cost 1 move. Hills, Forest and Marsh cost 2. Crossing a river costs 1 more. Roads cost a third of a move and bridge rivers; railroads cost a sixth. A unit with full moves can always step one tile. Mountains are impassable. Land units cross water by embarking (see War).'),
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
      h('p', null, h('b', null, 'Policies. '), 'Culture fills a pool. Tap 🎭 on the right of the map to adopt policies from six trees. Each tree starts with its first policy; finishing all five grants a bonus. Commerce and Faith open in the Classical era, Enlightenment in the Medieval era.'),
      h('p', null, h('b', null, 'Tile control. '), 'In a city, tap Manage tiles. On the map, tap a tile to pin a citizen to it and tap again to release it. Use Scholars to turn citizens into scholars. Tiles marked with gold can be bought. Automatic hands control back to the focus.'),
      h('p', null, h('b', null, 'Map tools. '), '🗺️ opens the whole known world; tap to jump there. 👁️ shows food, production and gold dots on every tile in view.'),
      h('p', null, h('b', null, 'Religion. '), 'Shrines, Temples and Grand Temples make faith. With Mysticism, spend faith on a pantheon (🙏 on the right of the map). With Philosophy, a Prophet appears once you have enough faith; move it into one of your cities to found a religion with a founder belief and a follower belief. A second Prophet after Theology enhances it. Religions spread by themselves to cities within 10 tiles and along trade routes. Buy Missionaries to push your religion into other cities and Inquisitors to clear rival faiths from yours.'),
      h('p', null, h('b', null, 'Lenses. '), 'Tap 👁️ to cycle the map lens: yields, religion, off.'),
      h('p', null, h('b', null, 'War. '), 'You start at peace with everyone except barbarians. Declare war from Diplomacy (🤝), or by tapping a unit of a civilization you are at peace with. AIs declare war when they feel strong, and offer peace when it goes badly.'),
      h('p', null, h('b', null, 'Attacking. '), 'Select a military unit and tap an enemy: the panel shows the damage you deal and take. Tap again to attack. Melee units must be next to the target and move in when they win; ranged units fire up to their range and take no damage. Attacking ends the unit\'s turn.'),
      h('p', null, h('b', null, 'Combat strength. '), 'Hills and forest give +25% defense, Forts +50%, fortifying +25%. Attacking across a river costs 20%. Each friendly unit next to the target adds 10% (up to 30%). Spearmen and Pikemen get +50% against mounted units. Siege units get +100% against cities. Wounded units fight weaker.'),
      h('p', null, h('b', null, 'Cities. '), 'Cities defend themselves and can fire at one enemy within 2 tiles each turn. Walls, Castles and Bastions add strength and health. Bring a city to zero health with any units, then take it with a melee land unit. Captured cities shrink and are in unrest for a few turns.'),
      h('p', null, h('b', null, 'Experience. '), 'Fighting earns experience; a ★ on a unit means it can be promoted. Barracks and Armories give new units a head start. Upgrade old units for gold inside your territory.'),
      h('p', null, h('b', null, 'Movement in war. '), 'Moving from one tile next to an enemy unit to another ends your move (zone of control). With Sailing, land units can embark onto coast; with Compass, onto ocean. Embarking or landing ends the move, and embarked units are easy targets. Ships need a coastal city.'),
      h('p', null, h('b', null, 'Resources. '), 'Riders and Knights need Horses; Swordsmen, Longswords and Frigates need Iron; Musketeers and Artillery need Saltpeter. Each improved source supports two units.'),
      h('p', null, h('b', null, 'Diplomacy. '), 'Tap 🤝 to see how every civilization you know feels about you and why. Wars, broken treaties, denouncements, tribute demands, crowded borders and rival faiths in their cities make them colder; trade routes, deals, open borders, a shared faith and common enemies warm them up.'),
      h('p', null, h('b', null, 'Trading. '), 'Open Trade on a civilization and add items from either side: gold, gold per turn, luxuries, strategic resources, open borders, alliances or a war on someone else. Their answer updates live, and if they want a little more, one tap adds the gold. Deals last 20 turns. A luxury you trade away stops making you happy unless you have a second copy.'),
      h('p', null, h('b', null, 'Borders and alliances. '), 'Without open borders, military units cannot enter the land of a civilization you are at peace with; scouts and civilians always can. Allies share vision and are called into each other\'s wars. Declaring war on someone you have a treaty with is remembered as betrayal by them.'),
      h('p', null, h('b', null, 'Offers. '), 'AIs propose deals, demand tribute, ask you to join wars and offer peace. A dot on 🤝 means something is waiting for your answer. Offers expire after a few turns.'),
      h('p', null, h('b', null, 'Ruins and relics. '), 'Ancient ruins (broken columns on the map) reward the first land unit that steps on them: gold, science, a map, recruits, sometimes a relic, sometimes a barbarian trap. Relics are permanent bonuses; each exists once in the world. Yours are listed on the Empire screen. Barbarian camps marked 💎 guard a relic hoard.'),
      h('p', null, h('b', null, 'Quests. '), 'At each new era the court may offer two quests. Pick one (or neither) and finish it before the deadline for a relic or gold. The 📜 button on the right shows your progress.'),
      h('p', null, h('b', null, 'Expedition. '), 'A roguelike run from the main menu. Choose a boon at the start and whenever you enter a new era. One save, no undo. Heat adds curses and multiplies your run score; win to unlock the next level.'),
      h('p', null, h('b', null, 'Wonders. '), '22 world wonders, from the Stone Circle to the People\'s Hall. Each can be built once in the whole world and gives its city a bonus plus an empire-wide effect. Find them at the bottom of a city\'s production list. If a rival finishes first, your production carries over. Wonders cannot be bought. 🏆 lists who built what.'),
      h('p', null, h('b', null, 'Victory. '), 'Six ways to win, each can be turned off when you start a game. Domination: hold every rival\'s original capital. Science: research Grand Theory, then build the three Skyward parts. Culture: complete four policy trees, then build the Grand Exhibition. Religion: your faith leads in over 60% of every civilization\'s cities for 15 turns (needs Theology). Diplomatic: build the Hall of Nations, then stay allied with at least half the surviving civilizations for 20 turns. Score: if nobody has won when the turn limit arrives, the highest score wins.'),
      h('p', null, h('b', null, 'Watching rivals. '), 'Tap 🏆 to see your progress toward each victory next to the leading rival, the score table, and history graphs of score, science, culture, military, cities and techs. You get a warning when a rival gets close.'),
      h('p', null, h('b', null, 'Free cities. '), 'Independent city-states dot the map. Each has a type: Cultural, Scholarly, Mercantile, Maritime, Devout or Martial. Gift gold in Diplomacy (🤝) to raise your influence: at 30 they are your friends and send their bonus every turn; the civilization with the most influence above 60 is their ally and gets double. Influence fades slowly, and rivals compete for it. You can also conquer them.'),
      h('p', null, h('b', null, 'Great People. '), 'Libraries and Universities draw Great Scientists, Workshops and worked Mines Great Engineers, Markets and trade routes Great Merchants, Amphitheaters and Opera Houses Great Artists, and battle Great Generals. Track them on the Empire screen (tap your gold). Each Great Person has one powerful action: Discover, Construct (great for wonders), Trade mission (more gold inside a foreign city), or Masterwork. A Great General gives your units within 2 tiles +15% strength.'),
      h('p', null, h('b', null, 'Natural wonders. '), 'Ten natural wonders, such as Skyfall Crater and Emerald Falls, are scattered across each world. The first civilization to see one earns a reward (later visitors get half). Working the tile gives strong yields, and each one inside your borders adds +1 happiness. Long-press one to read about it.'),
      h('p', null, h('b', null, 'Events. '), 'Now and then something happens: a bountiful harvest, a fire, a wandering scholar, a comet. Each event offers two choices. Events can be turned off when starting a game.'),
      h('p', null, h('b', null, 'Civilizations. '), 'Eight civilizations, each with a bonus, a unique unit and its own personality when controlled by the computer. The Huge map fits all eight.'),
      h('p', null, h('b', null, 'Golden Ages. '), 'Every turn your net happiness (up to 15) builds toward a Golden Age: 10 turns of +20% production and gold in every city. Each one needs a little more. Track it on the Empire screen; ✨ at the top means one is running.'),
      h('p', null, h('b', null, 'Undo. '), 'After moving a unit, ↶ Undo move puts it back, as long as the move revealed nothing new and nothing happened on the way.'),
      h('p', null, h('b', null, 'Pass and play. '), 'Up to four people can share one phone: raise Players on this phone when starting a game and pick each player\'s civilization. Between turns the map hides until the next player taps Start my turn. Offers between players wait for the other\'s turn.'),
      h('p', null, h('b', null, 'Sound. '), 'All sounds and music are synthesized in the game, so there is nothing to download. The music shifts with the era and darkens in war. Turn either off in Settings. The silent switch mutes everything.'),
      h('p', null, h('b', null, 'Tips. '), 'A short tip appears the first time something new happens. Turn tips off, or show them all again, in Settings.'),
      h('p', null, h('b', null, 'This build. '), 'Build 9 tuned the civilizations and victories across hundreds of simulated games, and added Great People, natural wonders, random events, two new civilizations and a Huge map.')));
  groupHelp(el);
  showScreen(el);
}
// Sort the help paragraphs into collapsible topics. 'Cities.' appears three times: founding, economy, war.
const HELP_GROUPS = [
  ['Basics', ['Map', 'Units', 'Movement', 'Stacking', 'Cities#0', 'Fog of war', 'Orders', 'Undo', 'Map tools', 'Lenses', 'Saving']],
  ['Cities and economy', ['Cities#1', 'Growth', 'Happiness', 'Golden Ages', 'Tile control', 'Builders', 'Gold', 'Trade', 'Research', 'Resources']],
  ['Culture, faith and Great People', ['Policies', 'Religion', 'Great People']],
  ['War', ['War', 'Attacking', 'Combat strength', 'Cities#2', 'Experience', 'Movement in war']],
  ['Diplomacy and free cities', ['Diplomacy', 'Trading', 'Borders and alliances', 'Offers', 'Free cities']],
  ['Wonders and victory', ['Wonders', 'Natural wonders', 'Victory', 'Watching rivals']],
  ['World and options', ['Civilizations', 'Events', 'Pass and play', 'Sound', 'Tips', 'This build']],
];
function groupHelp(el) {
  const box = el.querySelector('.help'); if (!box) return;
  const seen = {}, byKey = {};
  for (const p of Array.from(box.querySelectorAll(':scope > p'))) {
    const b = p.querySelector('b'); if (!b) continue;
    const t = b.textContent.replace(/\.\s*$/, ''), n = seen[t] = (seen[t] || 0) + 1;
    byKey[t === 'Cities' ? 'Cities#' + (n - 1) : t] = p;
  }
  const used = new Set(), out = [];
  HELP_GROUPS.forEach(([title, keys], gi) => {
    const ps = keys.map(k => byKey[k]).filter(Boolean); ps.forEach(p => used.add(p));
    if (ps.length) out.push(h('details', { class: 'hgroup', open: gi === 0 ? true : null }, h('summary', null, title), ps));
  });
  const rest = Array.from(box.querySelectorAll(':scope > p')).filter(p => !used.has(p));
  if (rest.length) out.push(h('details', { class: 'hgroup' }, h('summary', null, 'More'), rest));
  box.replaceChildren(...out);
}

boot();
