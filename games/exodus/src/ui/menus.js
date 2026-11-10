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
function seg(options, value, onPick, cls) {
  return h('div', { class: 'seg' + (cls ? ' ' + cls : '') }, options.map(([v, label]) => h('button', { class: v === value ? 'on' : '', onclick: () => onPick(v) }, label)));
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
      const { map, grid } = generateMap({ size: 'small', script: Math.random() < 0.5 ? 'continents' : 'archipelago', civs: 2 }, rng);
      map.veil = new Uint8Array(map.W * map.H); generateVeil({ map, _grid: grid, seed: 'menu' + Math.random(), cfg: {} }, []);
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
        if (map.veil[i]) { const vg2 = x.createRadialGradient(px, py, 0, px, py, R); vg2.addColorStop(0, 'rgba(232,120,214,.35)'); vg2.addColorStop(1, 'rgba(160,80,200,0)'); x.fillStyle = vg2; x.beginPath(); x.arc(px, py, R, 0, 6.283); x.fill(); }
      }
      const vg = x.createRadialGradient(w / 2, hh * 0.35, Math.min(w, hh) * 0.2, w / 2, hh * 0.5, Math.max(w, hh) * 0.75);
      vg.addColorStop(0, 'rgba(20,8,40,.2)'); vg.addColorStop(1, 'rgba(8,4,20,.9)'); x.fillStyle = vg; x.fillRect(0, 0, w, hh);
      // twin moons over the horizon and drifting spores
      const sky = x.createLinearGradient(0, 0, 0, hh * 0.45); sky.addColorStop(0, 'rgba(90,40,160,.55)'); sky.addColorStop(1, 'rgba(60,200,180,0)'); x.fillStyle = sky; x.fillRect(0, 0, w, hh * 0.45);
      for (const [mx, my, mr, mc] of [[w * 0.78, hh * 0.13, 34, '#d8c8ff'], [w * 0.88, hh * 0.2, 14, '#9ff7e0']]) { const mg = x.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr); mg.addColorStop(0, '#ffffff'); mg.addColorStop(1, mc); x.fillStyle = mg; x.beginPath(); x.arc(mx, my, mr, 0, 6.283); x.fill(); }
      for (let k = 0; k < 60; k++) { x.fillStyle = `rgba(${k % 2 ? '160,255,230' : '255,190,250'},${(0.2 + Math.random() * 0.5).toFixed(2)})`; x.beginPath(); x.arc(Math.random() * w, Math.random() * hh, 0.8 + Math.random() * 1.6, 0, 6.283); x.fill(); }
    } catch (e) { /* decorative only */ }
  }, 0);
  return cv;
}
function showMainMenu() {
  leaveGame();
  const latest = Saves.latest();
  const el = screen(
    h('div', { style: 'display:flex;justify-content:flex-start;margin-top:4px' }, h('a', { class: 'hub', href: '../' }, '◂ All games')),
    h('h1', null, 'HEXARCH'),
    h('div', { class: 'sub2' }, 'Exodus'),
    h('div', { class: 'sub' }, 'The homeworld is dying. Land on Veyra, choose what humanity becomes, and outlast the rival colonies.'),
    h('div', { class: 'col' },
      latest ? h('button', { class: 'pri', onclick: () => loadSlot(latest) }, 'Continue', h('span', { class: 'note', style: 'display:block;margin:0;color:#3b2f10' }, describeMeta(Saves.meta(latest)))) : null,
      h('button', { class: latest ? '' : 'pri', onclick: showNewGame }, 'New game'),
      h('button', { onclick: () => startNewGame(Object.assign(HX.defaultConfig(), { size: 'small', script: Math.random() < 0.5 ? 'continents' : 'pangaea', rivals: 3, turnLimit: 250, civ: 'random' })) }, 'Quick start: small world, 250 turns'),
      h('button', { class: 'exp-btn', onclick: () => showExpedition(showMainMenu) }, '🚀 Odyssey: a roguelike run' + (heatUnlocked() ? ` · Peril ${heatUnlocked()}` : '')),
      h('button', { onclick: () => showLoad(showMainMenu) }, 'Load game'),
      h('button', { onclick: () => showSettings(showMainMenu) }, 'Settings'),
      h('button', { onclick: () => showHelp(showMainMenu) }, 'How to play'),
      h('button', { onclick: () => showCodex(showMainMenu) }, 'Codex'),
      h('button', { onclick: () => showHall(showMainMenu) }, 'Hall of Fame' + ((Settings.get('hall') || []).some(x => x.won) ? ' 🏆' : ''))),
    h('div', { class: 'ver' }, `Hexarch: Exodus ${HX.version} · a planetary 4X for iPhone`));
  el.classList.add('menu'); el.prepend(menuBackdrop());
  showScreen(el);
}
function describeMeta(m) { return m ? (m.exp !== undefined ? `🚀 Peril ${m.exp} · ` : '') + `${m.civ} · Turn ${m.turn} · ${MAPSIZE[m.size] ? MAPSIZE[m.size].name : ''} ${MAPSCRIPT[m.script] ? MAPSCRIPT[m.script].name : ''}` : ''; }

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
    cfg.loadout = Object.assign({ col: 'random', cargo: 'random', ship: 'random' }, cfg.loadout || {});
    const loadSeg = (grp, field, title) => [h('div', { class: 'k', style: 'margin-top:8px' }, title),
      seg([['random', '🎲']].concat(HX.LOADOUT[grp].map(L => [L.key, L.glyph + ' ' + L.name])), cfg.loadout[field], v => { cfg.loadout[field] = v; render(); }, 'wrapseg'),
      h('div', { class: 'note' }, cfg.loadout[field] === 'random' ? 'Chosen at random.' : HX.LOADOUT[grp].find(L => L.key === cfg.loadout[field]).text)];
    const civSelect = (k) => { const sel = h('select', { 'aria-label': `Player ${k + 2} faction` }, h('option', { value: 'random' }, 'Random'), CIVS.filter(c => !c.barb && !c.minor).map(c => h('option', { value: c.key }, c.name)));
      sel.value = cfg.hotseatCivs[k] || 'random'; sel.addEventListener('change', () => { cfg.hotseatCivs[k] = sel.value; }); return sel; };
    const civCard = (key, name, leader, bonus, color) => h('button', { class: 'civ' + (cfg.civ === key ? ' on' : ''), onclick: () => { cfg.civ = key; render(); } },
      key !== 'random' && CIVS[CIVI[key]] ? civEmblem(CIVS[CIVI[key]], 44) : h('div', { class: 'sw', style: `background:${color}` }),
      h('div', null, h('div', { class: 'n' }, name), leader ? h('div', { class: 'l' }, leader) : null, h('div', { class: 'b' }, bonus)));
    const seedIn = h('input', { type: 'text', placeholder: 'Leave blank for a random world', value: cfg.seed, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    seedIn.addEventListener('input', () => { cfg.seed = seedIn.value; });
    const el = screen(
      h('h2', null, backBtn(showMainMenu), 'New game'),
      h('h3', null, 'Expedition sponsor'),
      h('div', { class: 'civs' },
        civCard('random', 'Random', '', 'Let fate decide.', 'conic-gradient(#4fe3c1,#b18cff,#ff6f80,#f2c94c,#5fe0a0,#4fb8f0,#4fe3c1)'),
        CIVS.filter(c => !c.barb && !c.minor).map(c => civCard(c.key, c.name, c.leader, `${c.lore} ${c.bonus}: ${c.bonusText} Unique unit: ${c.uu}, ${c.uuText.charAt(0).toLowerCase() + c.uuText.slice(1)} Leans ${HX.AFFINITIES.find(a => a.key === c.lean).glyph} ${HX.AFFINITIES.find(a => a.key === c.lean).name}.`, c.color))),
      h('h3', null, 'Ark loadout'),
      h('div', { class: 'note' }, 'What the ark carries down gives your colony its first edge.'),
      loadSeg('colonists', 'col', 'Colonists'), loadSeg('cargo', 'cargo', 'Cargo'), loadSeg('ships', 'ship', 'Ship'),
      h('h3', null, 'Map size'),
      seg(Object.values(MAPSIZE).map(s => [s.key, s.name]), cfg.size, v => { cfg.size = v; render(); }),
      h('div', { class: 'note' }, `${MAPSIZE[cfg.size].W}×${MAPSIZE[cfg.size].H} tiles, up to ${maxR} rivals. Veyra wraps east to west.`),
      h('h3', null, 'Map type'),
      seg(Object.values(MAPSCRIPT).map(s => [s.key, s.name]), cfg.script, v => { cfg.script = v; render(); }),
      h('h3', null, 'Players on this phone'),
      h('div', { class: 'stepper' },
        h('button', { disabled: cfg.humans <= 1, onclick: () => { cfg.humans--; render(); } }, '−'),
        h('div', { class: 'v' }, String(cfg.humans)),
        h('button', { disabled: cfg.humans >= Math.min(4, MAPSIZE[cfg.size].maxCivs), onclick: () => { cfg.humans++; render(); } }, '+'),
        h('div', { class: 'note', style: 'margin:0' }, cfg.humans > 1 ? 'pass and play' : 'just you')),
      cfg.humans > 1 ? h('div', { class: 'col', style: 'margin-top:8px' }, Array.from({ length: cfg.humans - 1 }, (_, k) => h('div', { class: 'toggle' }, h('div', { class: 'lb' }, `Player ${k + 2}`), civSelect(k)))) : null,
      cfg.humans > 1 ? h('div', { class: 'note' }, 'Players take turns on this phone. The map hides between turns so nobody sees the other\'s land. Player 1 uses the sponsor chosen above; the others get a random loadout.') : null,
      h('h3', null, 'Computer rivals'),
      h('div', { class: 'stepper' },
        h('button', { disabled: cfg.rivals <= minR, onclick: () => { cfg.rivals--; render(); } }, '−'),
        h('div', { class: 'v' }, String(cfg.rivals)),
        h('button', { disabled: cfg.rivals >= maxR, onclick: () => { cfg.rivals++; render(); } }, '+'),
        h('div', { class: 'note', style: 'margin:0' }, 'computer factions')),
      h('h3', null, 'Difficulty'),
      seg(DIFFICULTY.map((d, i) => [i, d.name]), cfg.difficulty, v => { cfg.difficulty = v; render(); }),
      h('div', { class: 'note' }, DIFFICULTY[cfg.difficulty].desc),
      h('h3', null, 'Turn limit'),
      seg(TURN_LIMITS.map(t => [t, String(t)]), cfg.turnLimit, v => { cfg.turnLimit = v; render(); }),
      h('h3', null, 'Native fauna'),
      seg(BARBARIANS.map(b => [b.key, b.name]), cfg.barbarians, v => { cfg.barbarians = v; render(); }),
      h('div', { class: 'note' }, 'Fauna nests spawn beasts that defend their land. Attack them and they grow angry; leave them be and they calm down.'),
      h('h3', null, 'Planet'),
      toggleRow('Spore Veil', 'A creeping haze that hurts unadapted units. Scour it, or learn to live in it.', cfg.veil !== false, on => { cfg.veil = on; }),
      toggleRow('Outposts', 'Independent stations land over time. Befriend them with credits and convoys, absorb them, or conquer them.', cfg.cityStates !== false, on => { cfg.cityStates = on; }),
      toggleRow('Supply pods', 'Pods from the arks lie scattered over Veyra. The first unit to reach one opens it.', cfg.ruins !== false, on => { cfg.ruins = on; }),
      toggleRow('Planetary condition', 'One random rule for every faction, like Clear Skies (+15% science) or Scattered Fleet (twice the pods).', cfg.omen === 'random', on => { cfg.omen = on ? 'random' : null; }),
      toggleRow('Story quests', 'Milestones ask you to make choices with permanent effects that steer your affinity.', cfg.story !== false, on => { cfg.story = on; }),
      toggleRow('Directives', 'At each new phase, take on an optional objective with a deadline for an artifact or credits.', cfg.quests !== false, on => { cfg.quests = on; }),
      toggleRow('Colony events', 'Blooms, fevers, fallen probes and more, each with a choice to make.', cfg.events !== false, on => { cfg.events = on; }),
      h('h3', null, 'Victory conditions'),
      VICTORIES.map(v => toggleRow(v.name, v.desc, cfg.victories[v.key], on => { cfg.victories[v.key] = on; })),
      h('h3', null, 'World seed'),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, seedIn), h('button', { 'aria-label': 'Random seed', onclick: () => { cfg.seed = HX.randomSeedString(); render(); } }, '🎲')),
      h('div', { class: 'note' }, 'The same seed and settings always make the same Veyra. Share it with a friend.'),
      h('div', { class: 'bar' }, h('button', { onclick: showMainMenu }, 'Back'), h('button', { class: 'pri', onclick: () => startNewGame(cfg) }, 'Start game')));
    showScreen(el);
    el.scrollTop = top;
  };
  render();
}
function startNewGame(cfg, isRun) {
  const keep = Object.assign({}, cfg); delete keep.seed;
  if (!isRun) Settings.set('lastCfg', keep);
  showScreen(screen(h('h1', null, 'HEXARCH'), h('div', { class: 'sub2' }, 'Exodus'), h('div', { class: 'sub' }, 'Descending through the Veil…')));
  setTimeout(() => {
    try { enterGame(HX.makeGame(Object.assign({}, cfg))); }
    catch (e) { showMainMenu(); infoDlg('Could not create the planet', String(e && e.message || e)); }
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
      h('button', { onclick: () => showEmpire() }, 'Faction and artifacts'),
      h('button', { onclick: () => showRivals(showPause) }, 'Diplomacy' + (G.offers.some(o => o.to === UI.pid) ? ' ●' : '')),
      h('button', { onclick: () => showTech(showPause) }, 'Technology web'),
      h('button', { onclick: () => showPolicies(showPause) }, 'Virtues'),
      h('button', { onclick: () => showAffinity(showPause) }, 'Affinity'),
      h('button', { onclick: () => showVictory(showPause) }, 'Victory and wonders'),
      h('button', { onclick: () => showLog(showPause) }, 'Event log'),
      h('button', { onclick: () => showSettings(showPause) }, 'Settings'),
      h('button', { onclick: () => showHelp(showPause) }, 'How to play'),
      h('button', { onclick: () => showCodex(showPause) }, 'Codex'),
      h('button', { class: 'danger', onclick: () => confirmDlg('Quit to main menu?', 'Your game was autosaved at the start of this turn. Moves made since then are saved too.', 'Quit', () => { if (UI.autoSlot && !UI.busy) Saves.write(UI.autoSlot, G, UI.pid); showMainMenu(); }) }, 'Quit to main menu')),
    h('h3', null, 'This game'),
    HX.omenOf(G) ? h('p', null, `${HX.omenOf(G).glyph} Planetary condition: ${HX.omenOf(G).name}. ${HX.omenOf(G).text}`) : null,
    G.cfg.expedition ? h('p', null, `🚀 Odyssey at Peril ${HX.expHeat(G)} (${heatName(HX.expHeat(G))}). One save, kept every turn; no undo. Run score so far ${HX.runScore(G, UI.pid, false)}.`) : null,
    h('p', null, `${civ.name}, led by ${civ.leader}. ${MAPSIZE[G.cfg.size].name} ${MAPSCRIPT[G.cfg.script].name} world, ${HX.majorPlayers(G).length - 1} rivals, ${DIFFICULTY[G.cfg.difficulty].name} difficulty. Turn ${G.turn} of ${G.cfg.turnLimit}.`),
    h('p', null, 'Seed: ', h('b', { style: '-webkit-user-select:text;user-select:text;color:#e9eef4' }, G.seed))));
}

// ---------- save / load ----------
function slotRow(slot, label, actions) {
  const m = Saves.meta(slot);
  return h('div', { class: 'slot' + (m ? '' : ' empty') },
    h('div', { class: 'meta' }, h('div', { class: 'a' }, m ? `${label}: ${m.civ}` : `${label}: empty`),
      m ? h('div', { class: 'b' }, `Turn ${m.turn} · ${m.cities} ${m.cities === 1 ? 'colony' : 'colonies'} · ${fmtDate(m.date)}`) : null),
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
      Saves.meta(Saves.RUN) ? h('h3', null, 'Odyssey') : null,
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
    toggleRow('Music', 'Slow generative music, airy and strange, that shifts with your affinity, the phase of the colony and war.', (Settings.get('sound') || {}).music !== false, v => { Settings.set('sound', Object.assign({}, Settings.get('sound'), { music: v })); Sound.unlock(); Sound.applySettings(); }),
    h('div', { class: 'toggle' }, h('div', { class: 'lb' }, 'Volume'), seg([[0.3, 'Low'], [0.6, 'Mid'], [0.9, 'High']], (Settings.get('sound') || {}).vol || 0.8, v => { Settings.set('sound', Object.assign({}, Settings.get('sound'), { vol: v })); Sound.applySettings(); Sound.play('build'); render(); })),
    h('div', { class: 'note' }, 'Sound follows your iPhone\'s silent switch.'),
    h('h3', null, 'Map'),
    toggleRow('Living map', 'Water glints, the Veil drifts and spores rise. Turn off to save battery.', Settings.get('ambient') !== false, v => { Settings.set('ambient', v); if (renderer) renderer.request(); }),
    toggleRow('3D terrain', 'Tilted view with raised ridges, spires, giant mushrooms and an alien sky. Turn off for a flat top-down map.', Settings.get('view3d') !== false, v => { Settings.set('view3d', v); if (renderer) { renderer.sprites = null; renderer.request(); } }),
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
    toggleRow('Colonies fire automatically', 'At the end of your turn, colonies shoot the weakest enemy in range.', Settings.get('autoBombard'), v => Settings.set('autoBombard', v)),
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
      h('p', null, h('b', null, 'Map. '), 'Drag to pan. Pinch to zoom. Veyra wraps east to west. Long-press any tile to inspect it.'),
      h('p', null, h('b', null, 'Landfall. '), 'On your first turn, choose one of three landing sites scanned from orbit. Your ark loadout (colonists, cargo and ship, chosen when starting a game) gives a starting bonus.'),
      h('p', null, h('b', null, 'Units. '), 'Tap a unit to select it. Tap a destination to see the route; the numbers show which turn it arrives. Tap the same tile again, or press Move here, to go. Tap a tile repeatedly to cycle between its units, colony and terrain.'),
      h('p', null, h('b', null, 'Movement. '), 'Steppe, Flats, Dunes and Frost cost 1 move. Crystal Ridges, Fungal Forest and Spore Marsh cost 2. Crossing a glow-river costs 1 more. Roads cost a third of a move; maglev a sixth. A unit with full moves can always step one tile. Spire Crags are impassable. Land units cross water by embarking.'),
      h('p', null, h('b', null, 'Stacking. '), 'One military unit and one civilian unit may share a tile.'),
      h('p', null, h('b', null, 'Colonies. '), 'Colony Pods found colonies. Centers need 3 tiles between them. Good sites have food, production, fresh water and coast. Colonies cannot sit on crash sites, ruins or vaults.'),
      h('p', null, h('b', null, 'Fog of war. '), 'Dark tiles are unexplored. Dimmed tiles show what you last saw. Ridges give extra sight. Forest, ridges and crags block the view behind them.'),
      h('p', null, h('b', null, 'Undo. '), 'After moving a unit, Undo move puts it back, as long as the move revealed nothing new.'),
      h('p', null, h('b', null, 'Saving. '), 'The game autosaves each turn into three rotating slots and when you leave the app. Five manual slots are in the pause menu. Export turns a save into text for another device. Saves never mix with Hexarch saves.'),
      h('p', null, h('b', null, 'Economy. '), 'Tap your colony, then Open colony. Pick what to build; tap + to queue. Buy finishes the item now for credits. Each citizen eats 2 food. Culture claims new tiles.'),
      h('p', null, h('b', null, 'Morale. '), 'Every colony and every two citizens cost morale. Luxuries, Med Clinics, Holo Arenas and Tribunals add it. Every 4 Veil tiles in your borders cost 1 until you reach Communion 2. Below zero, growth halves; at −10, growth stops.'),
      h('p', null, h('b', null, 'Research. '), "Tap the science button at the top to open the technology web: eight sectors around Landfall. Leaves need their branch; a branch opens from its own sector or a neighbor. Each tech known makes the next dearer. Breakthroughs (💡) cut a tech's cost by a third."),
      h('p', null, h('b', null, 'Riggers. '), 'Riggers build Hydro Farms, Drill Rigs, Bloom Gardens and more (3 charges), roads, Bulwark Posts, and scour the Veil (Biocontainment). With Communion 3 they can also seed it.'),
      h('p', null, h('b', null, 'Convoys. '), 'Frontier Commerce unlocks Convoys. A Convoy opens a permanent route: home routes feed the target colony; foreign routes earn credits and science; routes to outposts raise your influence there.'),
      h('p', null, h('b', null, 'The Spore Veil. '), 'The pink haze is the Spore Veil. Units starting a turn in it lose 10 health unless protected (Communion 2, the Veil Filters promotion, or the Choir of Sel). It creeps out from nests. Riggers scour it; Veil Scrubber satellites burn it away; Communion grows on it with Biowells and Symbiont Gardens.'),
      h('p', null, h('b', null, 'Affinities. '), 'Three philosophies: Communion (join the planet), Lattice (merge with machines), Lineage (stay human). Technologies, story choices, excavations and nests give affinity experience. Levels unlock perks, buildings, tier 2 units at level 3 and tier 3 at level 7, and change how leaders see you. Tap the affinity button on the right.'),
      h('p', null, h('b', null, 'Unit upgrades. '), "Each unit line splits by affinity. A Marine can become a Thornguard, a Servitor Frame or a Vanguard, and later a Sporewarden, Exo Legion or Paladin Corps. Third-tier units need their affinity's resource: Chitin, Lumenite or Ferrite. Upgrade inside your territory for credits."),
      h('p', null, h('b', null, 'Virtues. '), 'Culture buys Virtues in four trees: Resolve, Industry, Inquiry and Kinship. Tier 2 needs a tier 1 virtue in the same tree. Depth synergies reward 3, 6 and 8 virtues in one tree; Harmony rewards holding virtues in every tree.'),
      h('p', null, h('b', null, 'Story quests. '), 'Milestones such as your first Hydroponics Bay or a new affinity level ask the council a question. Each answer is a permanent bonus and nudges an affinity.'),
      h('p', null, h('b', null, 'Satellites. '), 'After Orbital Launch, colonies build satellites. Select one and choose a launch site within 4 tiles. Helio Lenses add production, Survey Eyes see and research, Sentinel Platforms defend and strike, Veil Scrubbers clear the Veil, and each affinity has its own. They burn up after a few dozen turns.'),
      h('p', null, h('b', null, 'Explorers. '), 'Explorers carry expedition kits. Stand on a crash site or Precursor ruin and Excavate for supplies, artifacts and affinity. Stand next to a fauna nest to study it. After Deep Resonance they decode Echo Vaults (also from next door). Kits refill in a colony with a Field Lab.'),
      h('p', null, h('b', null, 'Supply pods. '), 'Pods from the arks lie scattered over Veyra. Any land unit that reaches one opens it: credits, science, survivors, maps, sometimes an artifact or a nest of angry beasts.'),
      h('p', null, h('b', null, 'Native fauna. '), 'Skitterswarms, Delvers, Spinemaws, Ravagers, Tidewyrms and the colossal Titanoth live on Veyra. Nests spawn them. They defend their nests and hunt factions that have angered them: attacking beasts and nests raises their anger, leaving them alone lets it fade. Communion calms them and, at level 4 with Fauna Ethology, can tame them.'),
      h('p', null, h('b', null, 'War. '), 'Declare war from Diplomacy, or by tapping a unit of a faction you are at peace with. Tap an enemy to preview the fight, tap again to attack. Ridges and forest give +25% defense, Bulwark Posts +50%, fortifying +25%. Colonies fire on enemies within 2 tiles. Bring a colony to zero health and take it with a melee land unit.'),
      h('p', null, h('b', null, 'Diplomacy. '), 'Tap 🤝 to see how each faction feels about you and why. Each leader has an agenda, and shared or opposed affinities matter. Trade credits, luxuries, strategic resources, open borders and alliances.'),
      h('p', null, h('b', null, 'Outposts. '), 'Independent outposts land over time. Gift credits or run convoys to raise influence: friends get their bonus, the ally gets double, and an ally with 90 influence can absorb the outpost peacefully.'),
      h('p', null, h('b', null, 'Wonders. '), "28 planetary wonders, each built once on Veyra. Find them at the bottom of a colony's build list."),
      h('p', null, h('b', null, 'Victory. '), 'Rootsong (Communion 8, grow the Heartbloom), Convergence (Lattice 8, build the Lattice Core), Genesis (Lineage 8, the Genesis Engine with your land clear of the Veil), Awakening (decode 3 Echo Vaults and build the Listening Array), Dominion (hold the first colonies of half the rivals, rounded down, for 10 turns) and Legacy (highest score at the turn limit). Projects must then be held for 15 to 18 turns; rivals will try to take them. Tap 🏆 to watch the race.'),
      h('p', null, h('b', null, 'Odyssey. '), 'A roguelike run from the main menu: choose a boon at landfall and at every new phase, one save, no undo, and rising Peril for a higher run score.'),
      h('p', null, h('b', null, 'Pass and play. '), 'Up to four people can share one phone. Between turns the map hides until the next player taps Start my turn.'),
      h('p', null, h('b', null, 'Sound. '), 'All sounds and music are synthesized in the game. The music shifts with your affinity and darkens in war. The silent switch mutes everything.')));
  groupHelp(el);
  showScreen(el);
}
const HELP_GROUPS = [
  ['Basics', ['Map', 'Landfall', 'Units', 'Movement', 'Stacking', 'Colonies', 'Fog of war', 'Undo', 'Saving']],
  ['Colonies and economy', ['Economy', 'Morale', 'Research', 'Riggers', 'Convoys']],
  ['Veyra', ['The Spore Veil', 'Native fauna', 'Explorers', 'Supply pods', 'Satellites']],
  ['Affinity, virtues and story', ['Affinities', 'Unit upgrades', 'Virtues', 'Story quests']],
  ['War and diplomacy', ['War', 'Diplomacy', 'Outposts']],
  ['Wonders and victory', ['Wonders', 'Victory']],
  ['Modes and options', ['Odyssey', 'Pass and play', 'Sound']],
];
function groupHelp(el) {
  const box = el.querySelector('.help'); if (!box) return;
  const byKey = {};
  for (const p of Array.from(box.querySelectorAll(':scope > p'))) { const b = p.querySelector('b'); if (b) byKey[b.textContent.replace(/\.\s*$/, '')] = p; }
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
