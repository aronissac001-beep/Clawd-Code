// ===== menus.js : full screens: main menu, new colony, saves, settings, help, end =====
const Screens = {
  closeAll() { $('#screens').innerHTML = ''; },
  show(content, cls) { const root = $('#screens'); root.innerHTML = ''; const el = h('div', { class: 'screen ' + (cls || '') }); content.forEach(c => c && el.appendChild(c)); root.appendChild(el); return el; },
  back(fn) { return h('button', { class: 'back icon', 'aria-label': 'Back', onclick: () => { Sound.play('tap'); fn(); } }, '◂'); },
  main() {
    UI.setSpeed && UI.G && UI.setSpeed(0);
    const latest = Saves.latest();
    const art = h('canvas', { id: 'menuArt' });
    this.show([h('div', { class: 'menu' },
      h('a', { class: 'btn', href: '../', id: 'allGames', style: 'align-self:flex-start' }, '◂ All games'),
      art,
      h('div', { class: 'title' }, h('h1', null, 'KESSA'), h('p', null, 'Colony')),
      latest ? h('button', { class: 'pri', id: 'btnContinue', onclick: () => this.loadSlot(latest.s) }, 'Continue', h('div', { class: 'small', style: 'font-weight:400' }, 'Sol ' + latest.m.sol + ' · ' + latest.m.pop + ' colonists · ' + latest.m.sponsor)) : null,
      h('button', { class: latest ? '' : 'pri', id: 'btnNew', onclick: () => this.newGame() }, 'New colony'),
      h('button', { onclick: () => this.saves('load') }, 'Load game'),
      h('button', { onclick: () => this.importSave() }, 'Import save'),
      h('div', { class: 'row' }, h('button', { class: 'grow', onclick: () => this.settings() }, 'Settings'), h('button', { class: 'grow', onclick: () => this.help() }, 'Help')),
      h('p', { class: 'small mut', style: 'text-align:center' }, 'Kessa: a cold, dusty world with two percent oxygen. Land robots, build domes, bring people, and make them free.'))]);
    requestAnimationFrame(() => menuArt(art));
  },
  newGame() {
    const last = Settings.get('lastCfg') || {};
    const cfg = { sponsor: last.sponsor || 'orrin', commander: last.commander || 'engineer', difficulty: last.difficulty || 'normal', seed: KC.randomSeedName(), tutorial: Settings.get('tips') };
    const render = () => {
      const pick = (obj, key) => h('div', { class: 'pick' }, ...Object.entries(obj).map(([k, v]) => h('button', { class: cfg[key] === k ? 'on' : '', 'data-pick': key + ':' + k, onclick: () => { cfg[key] = k; Sound.play('tap'); render(); } }, v.name, h('p', null, v.desc))));
      this.show([this.back(() => this.main()), h('div', { class: 'menu' },
        h('h2', { style: 'text-align:center' }, 'New colony'),
        h('div', { class: 'sec' }, 'Sponsor'), pick(SPONSORS, 'sponsor'),
        h('div', { class: 'sec' }, 'Commander'), pick(COMMANDERS, 'commander'),
        h('div', { class: 'sec' }, 'Difficulty'), h('div', { class: 'seg' }, ...Object.entries(DIFFICULTY).map(([k, v]) => h('button', { class: cfg.difficulty === k ? 'on' : '', onclick: () => { cfg.difficulty = k; render(); } }, v.name))),
        h('p', { class: 'small mut' }, DIFFICULTY[cfg.difficulty].desc + ' Independence needs ' + DIFFICULTY[cfg.difficulty].pop + ' colonists; colonists must arrive by sol ' + DIFFICULTY[cfg.difficulty].patience + '.'),
        h('div', { class: 'sec' }, 'Landing site (map seed)'),
        h('div', { class: 'row' }, h('input', { type: 'text', id: 'seedIn', value: cfg.seed, oninput: e => { cfg.seed = e.target.value; } }), h('button', { class: 'icon', 'aria-label': 'Random seed', onclick: () => { cfg.seed = KC.randomSeedName(); render(); } }, '⚄')),
        h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Tutorial tips'), h('button', { class: cfg.tutorial ? 'on' : '', onclick: () => { cfg.tutorial = !cfg.tutorial; render(); } }, cfg.tutorial ? 'On' : 'Off')),
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
    const sec2 = (t, ...ps) => [h('h4', null, t), ...ps.map(p => h('p', null, p))];
    this.show([this.back(() => UI.G ? this.closeAll() : this.main()), h('div', { class: 'menu help' }, h('h2', { style: 'text-align:center' }, 'How to play'),
      ...sec2('Controls', 'Drag to pan, pinch (or mouse wheel) to zoom. Tap anything to inspect it. Speed buttons are at the top: pause, normal, fast, fastest. One sol is 24 hours; at normal speed an hour takes about two seconds.'),
      ...sec2('Phase 1: robots', 'You start with a lander, a Drone Crawler, a Pathfinder and a few prefabs. Drones build, mine surface metal scatter, repair grids and maintain everything within their hub\'s range. Open Build, pick a building, tap the map to position it, then Place. Drones fetch materials from storage when they start.', 'Solar Arrays make power by day; Battery Banks carry you through the night. A Regolith Sinterer must sit on a fine regolith deposit, an Ice Drill on water ice.'),
      ...sec2('Grids', 'Buildings that touch share power and pipes. Use Power Cable and Life Pipe for anything further away: tap a start tile, tap an end tile, Build line. Meteors, quakes and wear break lines; leaking pipes drain your tanks until drones fix them.'),
      ...sec2('Phase 2: colonists', 'Build a Bubble Dome, add Living Quarters (and a Canteen and Hydroponics), and connect it to power, water and oxygen. Then open Rockets → Colonists, pick applicants and launch an ark. Colonists work in buildings within reach of their dome, in three shifts. The night shift tires them.', 'They need food (one per sol), homes, and services they want (dining, fitness, social, relaxation, shopping, play). Health, sanity and comfort make up morale. Unhappy colonists become homesick and leave on the next rocket. Happy, comfortable adults have children.'),
      ...sec2('Production', 'Ore Extractors (metals), Rare Ore Extractors and Sinterers feed Machine Works (parts), Fuel Refineries, Polymer Plants and Circuit Foundries. Every building slowly wears out; drones service it with one unit of its upkeep material. Worn buildings run at 60%; at full wear they break down. Keep a reserve of parts and metals: construction will not spend below it.'),
      ...sec2('Research', 'Labs and Research Stations staffed by scientists produce research. Tap a tech to research it; locked techs are queued with their prerequisites. Anomalies investigated by the Pathfinder can unlock breakthrough technologies.'),
      ...sec2('Hazards', 'Dust storms (solar collapses, fast wear), meteor showers, cold waves (more power, freezing), quakes and random failures. Warnings appear at the top. A Storm Observatory doubles warning time; Meteor Lances, Thermal Beacons and Static Brush Towers protect nearby buildings.'),
      ...sec2('Winning and losing', 'Independence needs a large population, 25 technologies, the Charter Spire and five sols of self-sufficiency in food, air, water and parts. You lose if no colonists arrive before the sponsor\'s patience runs out, or if the colony is empty for three sols.'),
      ...sec2('Rockets and funding', 'Your sponsor pays a stipend every sol and grants for milestones. Order cargo, prefabs, drones and vehicles; rockets take about a sol and a half each way. Returning rockets sell rare metals and Kessite if you have 5 fuel for the trip.'),
      h('button', { class: 'pri', onclick: () => UI.G ? this.closeAll() : this.main() }, 'Got it'))]);
  },
  end() {
    const G = UI.G, o = G.over; if (!o) return;
    Modal.show(o.win ? '★ Independence!' : 'Mission recalled', [h('p', null, o.reason), kv('Sol', String(o.sol)), kv('Colonists', String(G.colonists.length)), kv('Births', String(G.st.births)), kv('Technologies', String(KC.techCount(G))), kv('Score', String(o.score))],
      o.win ? [['Main menu', () => { UI.G = null; $('#hud').hidden = true; this.main(); }], ['Keep playing', () => { o.continued = true; UI.setSpeed(1); }, 'pri']] : [['Main menu', () => { UI.G = null; $('#hud').hidden = true; this.main(); }], ['New colony', () => this.newGame(), 'pri']]);
  },
};
// title art: Kessa rising over the horizon with a little dome
function menuArt(cv) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth || 360, H = cv.clientHeight || 220;
  cv.width = W * dpr; cv.height = H * dpr; const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#120b12'); sky.addColorStop(0.6, '#3a1c18'); sky.addColorStop(1, '#7a3a22'); c.fillStyle = sky; c.fillRect(0, 0, W, H);
  const r = KC.RNG.fromSeed('menu'); for (let i = 0; i < 90; i++) { c.fillStyle = 'rgba(255,240,220,' + r.range(0.2, 0.9) + ')'; c.fillRect(r.next() * W, r.next() * H * 0.6, 1.2, 1.2); }
  // the orange star and a small moon
  const sg = c.createRadialGradient(W * 0.78, H * 0.3, 2, W * 0.78, H * 0.3, 60); sg.addColorStop(0, 'rgba(255,230,180,1)'); sg.addColorStop(0.15, 'rgba(255,170,90,.9)'); sg.addColorStop(1, 'rgba(255,120,60,0)'); c.fillStyle = sg; c.beginPath(); c.arc(W * 0.78, H * 0.3, 60, 0, 7); c.fill();
  c.fillStyle = '#c9b8a8'; c.beginPath(); c.arc(W * 0.2, H * 0.22, 9, 0, 7); c.fill(); c.fillStyle = '#3a1c18'; c.beginPath(); c.arc(W * 0.2 + 4, H * 0.22 - 2, 8, 0, 7); c.fill();
  // ridges
  const ridge = (y0, amp, col, seed) => { const rr = KC.RNG.fromSeed(seed); c.fillStyle = col; c.beginPath(); c.moveTo(0, H); let y = y0; for (let x = 0; x <= W; x += 8) { y += rr.range(-amp, amp); y = clamp(y, y0 - amp * 4, y0 + amp * 3); c.lineTo(x, y); } c.lineTo(W, H); c.fill(); };
  ridge(H * 0.62, 4, '#5a2e20', 'r1'); ridge(H * 0.72, 3, '#41231a', 'r2'); ridge(H * 0.84, 2, '#2a1712', 'r3');
  // dome and lander silhouettes with lights
  const dx = W * 0.38, dy = H * 0.86;
  const dg = c.createRadialGradient(dx - 12, dy - 30, 4, dx, dy - 10, 60); dg.addColorStop(0, 'rgba(255,240,220,.7)'); dg.addColorStop(0.5, 'rgba(150,210,230,.35)'); dg.addColorStop(1, 'rgba(80,130,160,.5)');
  c.fillStyle = dg; c.beginPath(); c.ellipse(dx, dy, 52, 44, 0, Math.PI, 0); c.fill(); c.strokeStyle = 'rgba(255,255,255,.35)'; c.stroke();
  c.fillStyle = 'rgba(255,200,120,.8)'; for (let k = 0; k < 6; k++) c.fillRect(dx - 30 + k * 11, dy - 8 - (k % 2) * 6, 4, 3);
  c.fillStyle = '#1e120e'; c.fillRect(W * 0.62, dy - 30, 6, 30); c.beginPath(); c.moveTo(W * 0.6, dy - 30); c.lineTo(W * 0.625, dy - 46); c.lineTo(W * 0.65, dy - 30); c.fill();
  c.fillStyle = '#ff5a3a'; c.beginPath(); c.arc(W * 0.625, dy - 48, 2, 0, 7); c.fill();
  // dust haze
  const hz = c.createLinearGradient(0, H * 0.55, 0, H); hz.addColorStop(0, 'rgba(200,120,70,0)'); hz.addColorStop(1, 'rgba(200,120,70,.18)'); c.fillStyle = hz; c.fillRect(0, 0, W, H);
}
