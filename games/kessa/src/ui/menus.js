// ===== menus.js : full screens: main menu, new colony, saves, settings, help, end =====
const Screens = {
  closeAll() { $('#screens').innerHTML = ''; },
  show(content, cls) { const root = $('#screens'); root.innerHTML = ''; const el = h('div', { class: 'screen ' + (cls || '') }); content.forEach(c => c && el.appendChild(c)); root.appendChild(el); return el; },
  back(fn) { return h('button', { class: 'back icon', 'aria-label': 'Back', onclick: () => { Sound.play('tap'); fn(); } }, ic('back')); },
  main() {
    UI.setSpeed && UI.G && UI.setSpeed(0);
    const latest = Saves.latest();
    const art = h('canvas', { id: 'menuArt' });
    this.show([h('div', { class: 'menu' },
      h('a', { class: 'btn', href: '../', id: 'allGames', style: 'align-self:flex-start' }, ic('back'), 'All games'),
      art,
      h('div', { class: 'title' }, h('h1', null, 'KESSA'), h('p', null, 'Colony')),
      h('p', { class: 'tag' }, 'A cold, dusty world with two percent oxygen. Land robots, raise domes, bring people, and make them free.'),
      latest ? h('button', { class: 'pri', id: 'btnContinue', onclick: () => this.loadSlot(latest.s) }, 'Continue', h('div', { class: 'small', style: 'font-weight:500;opacity:.8' }, 'Sol ' + latest.m.sol + ' · ' + latest.m.pop + ' colonists · ' + latest.m.sponsor)) : null,
      h('button', { class: latest ? '' : 'pri', id: 'btnNew', onclick: () => this.newGame() }, 'New colony'),
      h('button', { onclick: () => this.saves('load') }, 'Load game'),
      h('div', { class: 'minor' }, h('button', { onclick: () => this.importSave() }, 'Import'), h('button', { onclick: () => this.settings() }, 'Settings'), h('button', { onclick: () => this.help() }, 'Help')),
      h('p', { class: 'foot' }, 'Kessa Colony ' + KC_VERSION))]);
    requestAnimationFrame(() => menuArt(art));
  },
  newGame() {
    const last = Settings.get('lastCfg') || {};
    const cfg = { sponsor: last.sponsor || 'orrin', commander: last.commander || 'engineer', difficulty: last.difficulty || 'normal', seed: KC.randomSeedName(), tutorial: Settings.get('tips') };
    const render = () => {
      const pick = (obj, key) => h('div', { class: 'cards' }, ...Object.entries(obj).map(([k, v]) => { const E = EMBLEM[key][k] || ['none', '#555']; return h('button', { class: 'ccard' + (cfg[key] === k ? ' on' : ''), 'data-pick': key + ':' + k, onclick: () => { cfg[key] = k; Sound.play('tap'); render(); } },
        h('span', { class: 'em', style: 'background:linear-gradient(160deg,' + E[1] + ',' + shade(E[1], -0.45) + ');color:#fff8ee;box-shadow:0 0 0 1px ' + shade(E[1], 0.25) + ' inset' }, ic(E[0])), h('span', { class: 'tx' }, h('b', null, v.name), h('p', null, v.desc)), h('span', { class: 'ck' }, cfg[key] === k ? ic('check') : null)); }));
      this.show([this.back(() => this.main()), h('div', { class: 'menu' },
        h('h2', { style: 'text-align:center' }, 'New colony'),
        h('div', { class: 'sec' }, 'Sponsor'), pick(SPONSORS, 'sponsor'),
        h('div', { class: 'sec' }, 'Commander'), pick(COMMANDERS, 'commander'),
        h('div', { class: 'sec' }, 'Difficulty'), h('div', { class: 'seg' }, ...Object.entries(DIFFICULTY).map(([k, v]) => h('button', { class: cfg.difficulty === k ? 'on' : '', onclick: () => { cfg.difficulty = k; render(); } }, v.name))),
        h('p', { class: 'small mut' }, DIFFICULTY[cfg.difficulty].desc + ' Independence needs ' + DIFFICULTY[cfg.difficulty].pop + ' colonists; colonists must arrive by sol ' + DIFFICULTY[cfg.difficulty].patience + '.'),
        h('div', { class: 'sec' }, 'Landing site (map seed)'),
        h('div', { class: 'row' }, h('input', { type: 'text', id: 'seedIn', value: cfg.seed, oninput: e => { cfg.seed = e.target.value; } }), h('button', { class: 'icon', 'aria-label': 'Random seed', onclick: () => { cfg.seed = KC.randomSeedName(); render(); } }, ic('dice'))),
        h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Guided first colony'), h('button', { class: cfg.tutorial ? 'on' : '', onclick: () => { cfg.tutorial = !cfg.tutorial; render(); } }, cfg.tutorial ? 'On' : 'Off')),
        h('button', { class: 'pri', id: 'btnStart', style: 'min-height:54px;margin-top:8px', onclick: () => {
          Settings.set('lastCfg', { sponsor: cfg.sponsor, commander: cfg.commander, difficulty: cfg.difficulty }); Settings.set('tips', cfg.tutorial);
          if (cfg.tutorial) Settings.set('tipsDone', []);
          const G = KC.newGame({ seed: (cfg.seed || 'kessa').trim(), sponsor: cfg.sponsor, commander: cfg.commander, difficulty: cfg.difficulty, tutorial: cfg.tutorial });
          Sound.unlock(); Sound.play('good'); UI.start(G); Saves.write('auto', G);
        } }, 'Land on Kessa'))]);
    };
    render();
  },
  loadSlot(s) {
    try { const G = Saves.load(s); if (!G) { HUD.toast('That slot is empty.', 'warn'); return; } Sound.unlock(); UI.start(G); HUD.toast('Loaded ' + (s === 'auto' ? 'autosave' : 'slot ' + s.slice(1)) + '.', 'good'); }
    catch (e) { Modal.show('Could not load', 'This save could not be read: ' + e.message); }
  },
  saves(mode) {
    const inGame = !!UI.G;
    const render = () => {
      const rows = Saves.SLOTS.map(s => {
        const m = Saves.meta(s), name = s === 'auto' ? 'Autosave' : 'Slot ' + s.slice(1);
        return h('div', { class: 'card', style: 'margin-bottom:8px' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h5', null, name), h('p', null, m ? 'Sol ' + m.sol + ' · ' + m.pop + ' colonists · ' + m.sponsor + ' · ' + m.diff + ' · ' + new Date(m.date).toLocaleString() + ' · ' + m.kb + ' KB' : 'Empty')),
          mode === 'save' && s !== 'auto' ? h('button', { class: 'pri', 'data-slot': s, onclick: () => { const doIt = () => { const err = Saves.write(s, UI.G); if (err) Modal.show('Save failed', err); else { HUD.toast('Saved to ' + name + '.', 'good'); Sound.play('good'); render(); } }; if (m) Modal.confirm('Overwrite ' + name + '?', 'The colony in this slot will be replaced.', doIt, 'Overwrite'); else doIt(); } }, 'Save') : null,
          mode === 'load' && m ? h('button', { class: 'pri', 'data-load': s, onclick: () => this.loadSlot(s) }, 'Load') : null,
          m && s !== 'auto' ? h('button', { class: 'danger icon', 'aria-label': 'Delete', onclick: () => Modal.confirm('Delete ' + name + '?', 'This cannot be undone.', () => { Saves.remove(s); render(); }, 'Delete') }, '🗑') : null));
      });
      this.show([this.back(() => inGame ? this.closeAll() : this.main()), h('div', { class: 'menu' }, h('h2', { style: 'text-align:center' }, mode === 'save' ? 'Save game' : 'Load game'), ...rows,
        h('button', { onclick: () => inGame ? this.exportSave() : this.importSave() }, inGame ? 'Export as text…' : 'Import from text…'))]);
    };
    render();
  },
  exportSave() {
    const G = UI.G, txt = KC.exportText(G);
    const ta = h('textarea', { id: 'exportText', readonly: true }); ta.value = txt;
    this.show([this.back(() => this.closeAll()), h('div', { class: 'menu' }, h('h2', { style: 'text-align:center' }, 'Export colony'),
      h('p', { class: 'small mut' }, 'Copy this text somewhere safe. Paste it into Import on any device to continue. (' + Math.round(txt.length / 1024) + ' KB)'), ta,
      h('button', { class: 'pri', onclick: async () => { try { await navigator.clipboard.writeText(txt); HUD.toast('Copied.', 'good'); } catch (e) { ta.select(); HUD.toast('Select the text and copy it.', 'warn'); } } }, 'Copy to clipboard'),
      h('button', { onclick: () => this.importSave() }, 'Import a colony instead…'))]);
  },
  importSave() {
    const ta = h('textarea', { id: 'importText', placeholder: 'Paste a KESSA1: save here' });
    this.show([this.back(() => UI.G ? this.closeAll() : this.main()), h('div', { class: 'menu' }, h('h2', { style: 'text-align:center' }, 'Import colony'), ta,
      h('button', { class: 'pri', id: 'btnImport', onclick: () => { try { const G = KC.importText(ta.value); Sound.unlock(); UI.start(G); HUD.toast('Colony imported.', 'good'); } catch (e) { Modal.show('Import failed', 'That text is not a valid Kessa save (' + e.message + ').'); } } }, 'Import'))]);
  },
  settings() {
    const render = () => {
      const tog = (k, label, after) => h('div', { class: 'row', style: 'margin:6px 0' }, h('span', { class: 'grow' }, label), h('button', { class: Settings.get(k) ? 'on' : '', 'data-set': k, onclick: () => { Settings.set(k, !Settings.get(k)); Sound.unlock(); Sound.apply(); after && after(); render(); } }, Settings.get(k) ? 'On' : 'Off'));
      this.show([this.back(() => UI.G ? this.closeAll() : this.main()), h('div', { class: 'menu' }, h('h2', { style: 'text-align:center' }, 'Settings'),
        tog('sfx', 'Sound effects'), tog('music', 'Ambient music'),
        h('div', null, h('div', { class: 'small mut' }, 'Volume'), h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: Settings.get('vol'), oninput: e => { Settings.set('vol', +e.target.value); Sound.apply(); } })),
        tog('tips', 'Tutorial tips', () => { if (Settings.get('tips')) Settings.set('tipsDone', []); }),
        tog('autosave', 'Autosave every sol'),
        h('div', { class: 'sec' }, 'Graphics'),
        h('div', { class: 'seg' }, ...[['low', 'Battery'], ['auto', 'Balanced'], ['high', 'Sharp']].map(([k, n]) => h('button', { class: Settings.get('quality') === k ? 'on' : '', onclick: () => { Settings.set('quality', k); R.resize(); render(); } }, n))),
        h('p', { class: 'small mut' }, 'Sharp renders at full Retina resolution and uses more battery.'),
        h('p', { class: 'small mut' }, 'Kessa Colony ' + KC_VERSION + '. Saves are kept in this browser (keys starting with kessa.).'))]);
    };
    render();
  },
  help() {
    const HI = { Controls: 'menu', 'Phase 1: robots': 'build', Grids: 'lines', 'Phase 2: colonists': 'domes', 'Production': 'industry', 'Research': 'research', 'Hazards': 'dust', 'Winning and losing': 'goals', 'Rockets and funding': 'rockets', 'Advisor and decisions': 'advisor', 'The Wardens': 'star' };
    const sec2 = (t, ...ps) => [h('h4', { class: 'row', style: 'gap:8px' }, ic(HI[t] || 'star'), t), ...ps.map(p => h('p', null, p))];
    this.show([this.back(() => UI.G ? this.closeAll() : this.main()), h('div', { class: 'menu help' }, h('h2', { style: 'text-align:center' }, 'How to play'),
      ...sec2('Controls', 'Drag to pan, pinch (or mouse wheel) to zoom. Tap anything to inspect it. Speed buttons are at the top: pause, normal, fast, fastest. One sol is 24 hours; at normal speed an hour takes about two seconds.'),
      ...sec2('Phase 1: robots', 'You start with a lander, a Drone Crawler, a Pathfinder and a few prefabs. Drones build, mine surface metal scatter, repair grids and maintain everything within their hub\'s range. Open Build, pick a building, tap the map to position it, then Place. Drones fetch materials from storage when they start.', 'Solar Arrays make power by day; Battery Banks carry you through the night. A Regolith Sinterer must sit on a fine regolith deposit, an Ice Drill on water ice.'),
      ...sec2('Grids', 'Buildings that touch share power and pipes. Use Power Cable and Life Pipe for anything further away: tap a start tile, tap an end tile, Build line. Meteors, quakes and wear break lines; leaking pipes drain your tanks until drones fix them.'),
      ...sec2('Phase 2: colonists', 'Build a Bubble Dome, add Living Quarters (and a Canteen and Hydroponics), and connect it to power, water and oxygen. Then open Rockets → Ark, pick applicants and launch an ark. Colonists work in buildings within reach of their dome, in three shifts. The night shift tires them.', 'They need food (one per sol), homes, and services they want (dining, fitness, social, relaxation, shopping, play). Health, sanity and comfort make up morale. Unhappy colonists become homesick and leave on the next rocket. Happy, comfortable adults have children.'),
      ...sec2('Production', 'Ore Extractors (metals), Rare Ore Extractors and Sinterers feed Machine Works (parts), Fuel Refineries, Polymer Plants and Circuit Foundries. Every building slowly wears out; drones service it with one unit of its upkeep material. Worn buildings run at 60%; at full wear they break down. Keep a reserve of parts and metals: construction will not spend below it.'),
      ...sec2('Research', 'Labs and Research Stations staffed by scientists produce research. Tap a tech to research it; locked techs are queued with their prerequisites. Anomalies investigated by the Pathfinder can unlock breakthrough technologies.'),
      ...sec2('Hazards', 'Dust storms (solar collapses, fast wear), meteor showers, cold waves (more power, freezing), quakes and random failures. Warnings appear at the top. A Storm Observatory doubles warning time; Meteor Lances, Thermal Beacons and Static Brush Towers protect nearby buildings.'),
      ...sec2('Winning and losing', 'Independence needs a large population, 25 technologies, the Charter Spire, five self-sufficient sols, and enough funding to buy out the sponsor\'s stake. You lose if no colonists arrive before the sponsor\'s patience runs out, or if the colony is empty for three sols.'),
      ...sec2('Rockets and funding', 'Your sponsor pays a stipend every sol and grants for milestones, but the stipend shrinks as the colony matures, and every colonist from home costs Earth payroll. Prices and arks get dearer over time. Order cargo, prefabs, drones and vehicles; rockets take about a sol and a half each way. Returning rockets sell rare metals and Kessite: with 5 fuel of your own you keep it all, otherwise the sponsor refuels the rocket and keeps a quarter.', 'Rockets → Sponsor shows sponsor confidence (it scales the stipend), contracts with deadlines and rewards, research grants, recruiting drives, and the Independence buyout. Late-game megaprojects such as the Orbital Mirror cost funding too.'),
      ...sec2('Advisor and decisions', 'The advisor (the bulb at the top) lists what needs attention, worst first: shortage forecasts, empty tanks, ice running out, stranded buildings, missing drones, low funding, and what to build next, each with a shortcut. Now and then the colony faces a decision: choose carefully, each option has a cost.'),
      ...sec2('The Wardens', 'Basalt pillars across the region hum at one pitch. Investigate Wardens and signals to start a mystery that runs through the whole game and ends with a megaproject.'),
      h('button', { class: 'pri', onclick: () => UI.G ? this.closeAll() : this.main() }, 'Got it'))]);
  },
  event() {
    const G = UI.G; if (!G || !G.event) return;
    const e = KC.EVENTS[G.event.id], ch = KC.eventChoices(G), art = h('canvas', { class: 'hero' });
    Modal.show(e.title, [h('div', { class: 'kicker' }, 'Decision · time is paused'), h('p', null, e.text),
      ...ch.map(c => h('button', { class: 'choice' + (c.ok ? '' : ' lock'), 'data-choice': c.i, disabled: !c.ok, onclick: () => { if (KC.resolveEvent(G, c.i)) { Sound.play('tap'); Modal.close(); HUD.update(); } } }, h('b', null, c.label), c.note ? h('div', { class: 'small' }, c.note) : null))], [], art);
    requestAnimationFrame(() => sceneArt(art, EVENT_ART[G.event.id] || ['day', 'decision']));
  },
  end() {
    const G = UI.G, o = G.over; if (!o) return;
    const art = h('canvas', { class: 'hero' }); requestAnimationFrame(() => sceneArt(art, o.win ? ['dawn', 'star'] : ['night', 'warn']));
    Modal.show(o.win ? 'Independence!' : 'Mission recalled', [h('div', { class: 'kicker' }, o.win ? 'Kessa is free' : 'The end of the mission'), h('p', null, o.reason), kv('Sol', String(o.sol)), kv('Colonists', String(G.colonists.length)), kv('Births', String(G.st.births)), kv('Technologies', String(KC.techCount(G))), kv('Score', String(o.score))],
      o.win ? [['Main menu', () => { UI.G = null; $('#hud').hidden = true; this.main(); }], ['Keep playing', () => { o.continued = true; UI.setSpeed(1); }, 'pri']] : [['Main menu', () => { UI.G = null; $('#hud').hidden = true; this.main(); }], ['New colony', () => this.newGame(), 'pri']], art);
  },
};
// emblems for sponsors and commanders on the new-colony screen: [icon, colour]
const EMBLEM = {
  sponsor: { orrin: ['rockets', '#c98a2e'], union: ['people', '#3b8f8a'], meridian: ['research', '#7a5cc9'], tessaline: ['metals', '#b4553a'], pilgrim: ['star', '#5f8f3e'] },
  commander: { engineer: ['engineer', '#c97a2e'], agronomist: ['botanist', '#5f9a3e'], physician: ['medic', '#b84a4a'], geoscientist: ['geologist', '#9a7346'], financier: ['funds', '#b59a2e'], roboticist: ['build', '#4a7ab8'] },
};
// event art: mood and emblem for each decision
const EVENT_ART = { scrubbers: ['dust', 'parts'], letters: ['night', 'log'], stowaway: ['day', 'pop'], gala: ['dawn', 'star'], meteorite: ['night', 'meteor'], lab: ['day', 'research'], festival: ['dawn', 'social'],
  strike: ['night', 'moon'], rival: ['dust', 'funds'], seeds: ['day', 'food'], medical: ['day', 'medic'], firmware: ['day', 'build'], wanderer: ['dawn', 'geologist'] };
// a wide landscape vignette: sky by mood, mesas, a dome, and an emblem medallion
function sceneArt(cv, spec) {
  const [mood, icon] = spec, dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 380, H = cv.clientHeight || 132;
  cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const SKY = { day: ['#5a3020', '#b0673a', '#e2a06a'], dawn: ['#2a1630', '#9a4a3a', '#f0a060'], night: ['#070912', '#14203a', '#3a3040'], dust: ['#4a2a18', '#8a5530', '#c08050'] }[mood] || ['#2a1a14', '#5a3020', '#9a5a30'];
  const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, SKY[0]); sky.addColorStop(0.65, SKY[1]); sky.addColorStop(1, SKY[2]); c.fillStyle = sky; c.fillRect(0, 0, W, H);
  const r = KC.RNG.fromSeed('scene' + mood + icon);
  if (mood === 'night') for (let k = 0; k < 70; k++) { c.fillStyle = 'rgba(230,240,255,' + r.range(0.2, 0.9) + ')'; c.fillRect(r.next() * W, r.next() * H * 0.6, 1.1, 1.1); }
  const sunx = W * (mood === 'dawn' ? 0.25 : 0.8), suny = H * (mood === 'dawn' ? 0.62 : 0.3);
  const sg = c.createRadialGradient(sunx, suny, 2, sunx, suny, mood === 'night' ? 30 : 70); sg.addColorStop(0, mood === 'night' ? 'rgba(220,230,255,.9)' : 'rgba(255,236,190,1)'); sg.addColorStop(0.2, mood === 'night' ? 'rgba(160,180,230,.3)' : 'rgba(255,170,90,.7)'); sg.addColorStop(1, 'rgba(255,120,60,0)');
  c.fillStyle = sg; c.beginPath(); c.arc(sunx, suny, 80, 0, 7); c.fill();
  const ridge = (y0, amp, col, seed) => { const rr = KC.RNG.fromSeed(seed); c.fillStyle = col; c.beginPath(); c.moveTo(0, H); let y = y0; for (let x = 0; x <= W + 8; x += 8) { y += rr.range(-amp, amp); y = clamp(y, y0 - amp * 3, y0 + amp * 2); c.lineTo(x, rr.chance(0.06) ? y - amp * 3 : y); } c.lineTo(W, H); c.fill(); };
  const dk = mood === 'night' ? 0.55 : 0;
  ridge(H * 0.6, 3, shade('#6a3626', -dk), 'a' + mood); ridge(H * 0.74, 2.5, shade('#4a2618', -dk), 'b' + mood); ridge(H * 0.88, 1.5, shade('#2c1810', -dk), 'c' + mood);
  // a small dome and mast on the near ridge
  const dx = W * 0.22, dy = H * 0.9; c.fillStyle = mood === 'night' ? 'rgba(150,200,230,.35)' : 'rgba(200,230,240,.45)'; c.beginPath(); c.ellipse(dx, dy, 26, 20, 0, Math.PI, 0); c.fill();
  c.fillStyle = 'rgba(255,200,120,.85)'; for (let k = 0; k < 4; k++) c.fillRect(dx - 15 + k * 9, dy - 5, 3, 2);
  c.fillStyle = '#1a0f0b'; c.fillRect(W * 0.34, dy - 22, 2, 22); c.fillStyle = '#ff5a3a'; c.fillRect(W * 0.34 - 1, dy - 24, 4, 3);
  if (mood === 'dust') { const g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, 'rgba(190,120,70,.5)'); g.addColorStop(0.5, 'rgba(190,120,70,.1)'); g.addColorStop(1, 'rgba(190,120,70,.45)'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  // the emblem, drawn from the icon set
  const mx = W * 0.62, my = H * 0.52, R0 = 30;
  c.fillStyle = 'rgba(14,11,9,.55)'; c.beginPath(); c.arc(mx, my, R0 + 6, 0, 7); c.fill();
  c.strokeStyle = 'rgba(255,198,138,.9)'; c.lineWidth = 2; c.beginPath(); c.arc(mx, my, R0, 0, 7); c.stroke();
  drawIcon(c, icon, mx - 18, my - 18, 36, '#ffe6c4');
  const v = c.createLinearGradient(0, H * 0.55, 0, H); v.addColorStop(0, 'rgba(24,19,15,0)'); v.addColorStop(1, 'rgba(24,19,15,.9)'); c.fillStyle = v; c.fillRect(0, 0, W, H);
}
// draw an icon from the set onto a canvas (paths, circles, ellipses and rects of the 24-unit grid)
function drawIcon(c, name, x, y, size, col) {
  const box = document.createElement('div'); box.innerHTML = '<svg>' + (ICONS[name] || ICONS.none) + '</svg>';
  c.save(); c.translate(x, y); c.scale(size / 24, size / 24); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 1.9; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const el of box.firstChild.children) {
    const a = n => parseFloat(el.getAttribute(n) || '0'), fill = el.getAttribute('fill') === 'currentColor', stroke = el.getAttribute('stroke') !== 'none';
    let p = null;
    if (el.tagName === 'path') p = new Path2D(el.getAttribute('d'));
    else if (el.tagName === 'circle') { p = new Path2D(); p.arc(a('cx'), a('cy'), a('r'), 0, Math.PI * 2); }
    else if (el.tagName === 'ellipse') { p = new Path2D(); const t = /rotate\((-?[\d.]+)/.exec(el.getAttribute('transform') || ''); p.ellipse(a('cx'), a('cy'), a('rx'), a('ry'), t ? +t[1] * Math.PI / 180 : 0, 0, Math.PI * 2); }
    else if (el.tagName === 'rect') { p = new Path2D(); p.rect(a('x'), a('y'), a('width'), a('height')); }
    if (!p) continue;
    if (fill) c.fill(p); if (stroke) c.stroke(p);
  }
  c.restore();
}
// title art: Kessa's orange star over mesas, a lit dome settlement, frost on the near ground
function menuArt(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 360, H = cv.clientHeight || 250;
  cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#0b0811'); sky.addColorStop(0.45, '#2a1420'); sky.addColorStop(0.72, '#6a2e20'); sky.addColorStop(1, '#a8522a'); c.fillStyle = sky; c.fillRect(0, 0, W, H);
  const r = KC.RNG.fromSeed('menu'); for (let i = 0; i < 120; i++) { c.fillStyle = 'rgba(255,240,225,' + r.range(0.15, 0.85) + ')'; const s = r.chance(0.1) ? 1.8 : 1.1; c.fillRect(r.next() * W, r.next() * H * 0.55, s, s); }
  // a faint aurora band
  c.globalCompositeOperation = 'lighter';
  for (let b = 0; b < 2; b++) { const g = c.createLinearGradient(0, H * 0.05, 0, H * 0.4); const hue = b ? '120,90,255' : '90,255,190'; g.addColorStop(0, 'rgba(' + hue + ',0)'); g.addColorStop(0.5, 'rgba(' + hue + ',.08)'); g.addColorStop(1, 'rgba(' + hue + ',0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(0, H * 0.12); for (let x = 0; x <= W; x += 16) c.lineTo(x, H * (0.1 + b * 0.05) + Math.sin(x / 60 + b * 2) * 14); for (let x = W; x >= 0; x -= 16) c.lineTo(x, H * (0.32 + b * 0.04) + Math.sin(x / 80 + b) * 16); c.closePath(); c.fill(); }
  c.globalCompositeOperation = 'source-over';
  // the star and a moon
  const sx = W * 0.76, sy = H * 0.44;
  const sg = c.createRadialGradient(sx, sy, 2, sx, sy, 90); sg.addColorStop(0, 'rgba(255,236,196,1)'); sg.addColorStop(0.12, 'rgba(255,186,110,.95)'); sg.addColorStop(0.4, 'rgba(255,120,60,.25)'); sg.addColorStop(1, 'rgba(255,100,50,0)'); c.fillStyle = sg; c.beginPath(); c.arc(sx, sy, 90, 0, 7); c.fill();
  c.fillStyle = '#d8c8b8'; c.beginPath(); c.arc(W * 0.18, H * 0.2, 8, 0, 7); c.fill(); c.fillStyle = '#20101a'; c.beginPath(); c.arc(W * 0.18 + 4, H * 0.2 - 2, 7.4, 0, 7); c.fill();
  // mesas: flat-topped ridges in three depths
  const mesa = (y0, col, seed, amp) => { const rr = KC.RNG.fromSeed(seed); c.fillStyle = col; c.beginPath(); c.moveTo(0, H); let y = y0, x = 0; c.lineTo(0, y);
    while (x < W + 10) { const run = rr.range(14, 46); if (rr.chance(0.3)) { const up = rr.range(amp, amp * 3) * (rr.chance(0.5) ? -1 : 1); x += rr.range(3, 7); y = clamp(y + up, y0 - amp * 4, y0 + amp * 2); c.lineTo(x, y); } x += run; c.lineTo(x, y + rr.range(-0.6, 0.6)); }
    c.lineTo(W, H); c.fill(); };
  mesa(H * 0.6, '#5e2c1e', 'm1', 5); mesa(H * 0.7, '#45211a', 'm2', 4); mesa(H * 0.82, '#2c1611', 'm3', 2.5);
  // rim light on the far mesa from the star
  c.globalCompositeOperation = 'lighter'; const rl = c.createRadialGradient(sx, sy, 10, sx, sy, 180); rl.addColorStop(0, 'rgba(255,140,70,.22)'); rl.addColorStop(1, 'rgba(255,140,70,0)'); c.fillStyle = rl; c.fillRect(0, H * 0.4, W, H * 0.35); c.globalCompositeOperation = 'source-over';
  // the settlement: two domes, a tube, the lander, a mast with a beacon
  const gy = H * 0.9;
  const dome = (x, rx, ry) => { const dg = c.createRadialGradient(x - rx * 0.3, gy - ry * 0.7, 3, x, gy - ry * 0.3, rx * 1.2); dg.addColorStop(0, 'rgba(255,245,230,.75)'); dg.addColorStop(0.45, 'rgba(150,210,235,.35)'); dg.addColorStop(1, 'rgba(70,120,150,.55)');
    c.fillStyle = dg; c.beginPath(); c.ellipse(x, gy, rx, ry, 0, Math.PI, 0); c.fill(); c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1; c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.14)'; for (let k = 1; k < 4; k++) { c.beginPath(); c.ellipse(x, gy, rx * k / 4, ry, 0, Math.PI, 0); c.stroke(); }
    c.fillStyle = 'rgba(255,205,130,.9)'; for (let k = 0; k < 5; k++) c.fillRect(x - rx * 0.6 + k * rx * 0.3, gy - 6 - (k % 2) * 5, 3.5, 2.5); };
  dome(W * 0.3, 50, 42); dome(W * 0.52, 30, 25);
  c.fillStyle = '#3a2a22'; c.fillRect(W * 0.3 + 48, gy - 6, W * 0.52 - W * 0.3 - 76, 5);
  c.fillStyle = '#1c110d'; c.fillRect(W * 0.66, gy - 34, 4, 34); c.fillRect(W * 0.66 - 6, gy - 16, 16, 2);
  c.fillStyle = '#ff5a3a'; c.beginPath(); c.arc(W * 0.66 + 2, gy - 37, 2.4, 0, 7); c.fill();
  c.fillStyle = 'rgba(255,90,58,.25)'; c.beginPath(); c.arc(W * 0.66 + 2, gy - 37, 7, 0, 7); c.fill();
  // the ground with a cold frost sheen
  const fg = c.createLinearGradient(0, gy - 4, 0, H); fg.addColorStop(0, '#26140f'); fg.addColorStop(1, '#130b08'); c.fillStyle = fg; c.fillRect(0, gy - 1, W, H - gy + 1);
  c.fillStyle = 'rgba(170,210,235,.16)'; for (let k = 0; k < 40; k++) c.fillRect(r.next() * W, gy + 2 + r.next() * (H - gy - 4), r.range(6, 22), 1);
  // dust haze
  const hz = c.createLinearGradient(0, H * 0.5, 0, H); hz.addColorStop(0, 'rgba(210,130,80,0)'); hz.addColorStop(1, 'rgba(210,130,80,.14)'); c.fillStyle = hz; c.fillRect(0, 0, W, H);
}
