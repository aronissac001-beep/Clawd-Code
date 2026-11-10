// ===== menus.js : main menu, new game and species creator, saves, settings, help, end screen, boot =====
function menuScreen(content, solid) { UI.screen = null; const el = h('div', { class: 'screen menu' + (solid || UI.G ? ' solid' : '') }, h('div', { class: 'mwrap' }, content)); $('screens').replaceChildren(el); return el; }
function showMainMenu() {
  UI.G = null; $('hud').hidden = true; closeModal(); setSpeed(0);
  if (!UI.bd && renderer) { UI.bd = true; requestAnimationFrame(menuBackdrop); }
  const latest = Saves.latest();
  const m = latest ? Saves.meta(latest) : null;
  menuScreen([
    h('a', { class: 'back', href: '../' }, '◂ All games'),
    h('div', { class: 'logo' }, h('h1', null, 'STARWAKE'), h('div', null, 'A galaxy waits to wake')),
    m ? h('button', { class: 'pri', onclick: () => loadSlot(latest) }, 'Continue', h('span', { style: 'font-weight:400;font-size:13px;opacity:.85' }, ` · ${m.name}, ${SW.dateStr(m.day)}`)) : null,
    h('button', { class: m ? '' : 'pri', onclick: () => { Sound.unlock(); Sound.play('select'); showNewGame(); } }, 'New game'),
    h('button', { onclick: () => showSaves(false) }, 'Load game'),
    h('button', { onclick: () => showHelp(showMainMenu) }, 'How to play'),
    h('button', { onclick: () => showSettings(showMainMenu) }, 'Settings'),
    h('div', { class: 'ver' }, 'Starwake ' + SW_VERSION + ' · a galactic strategy game'),
  ]);
}
// ---------- new game ----------
const NG = { cfg: null, sp: null };
function defaultNG() {
  const last = Settings.get('lastCfg');
  NG.cfg = Object.assign({ size: 'medium', shape: 'spiral2', empires: 8, difficulty: 'normal', years: 200, crisis: 'normal', seed: randomSeed() }, last || {});
  NG.cfg.seed = randomSeed();
  const p = SPECIES_PRESETS[0];
  NG.sp = { name: p.name, empire: p.empire, body: p.body, pref: p.pref, traits: p.traits.slice(), ethos: p.ethos.slice(), gov: p.gov, portrait: p.portrait.slice(), color: EMPIRE_COLORS[0], preset: 0 };
}
function randomSeed() { const w = ['amber', 'cinder', 'dusk', 'ember', 'frost', 'gale', 'halo', 'iris', 'jade', 'lumen', 'nova', 'onyx', 'pyre', 'quill', 'rune', 'sable', 'tide', 'umbra', 'vale', 'wisp']; return w[Math.floor(Math.random() * w.length)] + '-' + w[Math.floor(Math.random() * w.length)] + '-' + Math.floor(100 + Math.random() * 900); }
function seg(options, cur, fn) { return h('div', { class: 'seg full' }, options.map(([v, lb]) => h('button', { class: cur === v ? 'on' : '', onclick: () => { Sound.play('tap'); fn(v); } }, lb))); }
function showNewGame() {
  if (!NG.cfg) defaultNG();
  const c = NG.cfg, s = NG.sp, re = () => showNewGame();
  const maxE = { small: 7, medium: 9, large: 10 }[c.size];
  c.empires = clamp(c.empires, 3, maxE);
  const pv = Art.portrait(s.portrait, 200, s.color); pv.style.width = '100px'; pv.style.height = '100px'; pv.className = 'portrait';
  const pts = SW.traitPointsLeft(s.traits);
  const el = menuScreen([
    h('div', { class: 'row' }, h('button', { class: 'icon', 'aria-label': 'Back', onclick: showMainMenu }, icon('back')), h('h2', { style: 'margin:0;flex:1' }, 'New game')),
    h('div', { class: 'sub' }, 'Choose your people'),
    h('div', { class: 'species' }, SPECIES_PRESETS.map((p, i) => { const cv = Art.portrait(p.portrait, 128, EMPIRE_COLORS[i]); cv.style.width = '64px'; cv.style.height = '64px';
      return h('button', { class: s.preset === i ? 'on' : '', onclick: () => { Object.assign(s, { name: p.name, empire: p.empire, body: p.body, pref: p.pref, traits: p.traits.slice(), ethos: p.ethos.slice(), gov: p.gov, portrait: p.portrait.slice(), color: EMPIRE_COLORS[i], preset: i }); Sound.play('select'); re(); } }, cv, p.name); })),
    h('div', { class: 'card', style: 'margin-top:8px' },
      h('div', { class: 'row' }, pv, h('div', { class: 'grow col', style: 'gap:6px' }, h('input', { type: 'text', value: s.name, maxlength: 16, 'aria-label': 'Species name', oninput: ev => { s.name = ev.target.value; s.preset = -1; } }), h('input', { type: 'text', value: s.empire, maxlength: 30, 'aria-label': 'Empire name', oninput: ev => { s.empire = ev.target.value; } }))),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'small grow', onclick: () => { s.portrait = SW.randomPortrait(Math.random()); s.preset = -1; re(); } }, 'New look'), h('select', { class: 'grow', 'aria-label': 'Body', onchange: ev => { s.body = ev.target.value; } }, BODY_TYPES.map(b => h('option', { value: b, selected: s.body === b }, b)))),
      h('label', { class: 'f' }, 'Home world type (best habitability)'),
      h('select', { onchange: ev => { s.pref = ev.target.value; s.preset = -1; } }, HAB_TYPES.map(t => h('option', { value: t, selected: s.pref === t }, PLANET_TYPES[t].name + ' (' + PLANET_TYPES[t].climate + ')'))),
      h('label', { class: 'f' }, 'Color'),
      h('div', { class: 'row wrap', style: 'gap:6px' }, EMPIRE_COLORS.map(col => h('button', { 'aria-label': 'Color', class: s.color === col ? 'on' : '', style: `width:44px;padding:0;background:${col};border-width:${s.color === col ? 3 : 1}px;border-color:${s.color === col ? '#fff' : '#0006'}`, onclick: () => { s.color = col; re(); } }))),
      h('label', { class: 'f' }, `Traits · ${pts} point${pts === 1 ? '' : 's'} left (negative traits give points)`),
      h('div', { class: 'traits' }, Object.keys(TRAITS).map(k => { const T = TRAITS[k], on = s.traits.includes(k);
        return h('button', { class: (on ? 'on ' : '') + (T.cost < 0 ? 'neg' : ''), onclick: () => { const nt = on ? s.traits.filter(x => x !== k) : s.traits.concat([k]); if (SW.validTraits(nt) || (on && SW.traitPointsLeft(nt) >= 0)) { s.traits = nt; s.preset = -1; Sound.play('tap'); re(); } else { toast(SW.traitPointsLeft(nt) < 0 ? 'Not enough trait points' : nt.length > TRAIT_MAX ? 'At most 5 traits' : 'Those traits are opposites', 'bad'); } } }, `${T.name} (${T.cost > 0 ? T.cost : '+' + -T.cost})`); })),
      h('div', { class: 'mut', style: 'font-size:12px;margin-top:4px' }, s.traits.map(k => TRAITS[k].name + ': ' + TRAITS[k].desc).join(' · ')),
      h('label', { class: 'f' }, 'Ethos (choose two)'),
      h('div', { class: 'traits' }, Object.keys(ETHOS).map(k => { const on = s.ethos.includes(k);
        return h('button', { class: on ? 'on' : '', onclick: () => { let ne = on ? s.ethos.filter(x => x !== k) : s.ethos.concat([k]); ne = ne.filter(x => !(ETHOS[x].opp === k && x !== k) || x === k); if (!on) ne = ne.filter(x => ETHOS[k].opp !== x); while (ne.length > 2) ne.shift(); s.ethos = ne; s.preset = -1; re(); } }, ETHOS[k].name); })),
      h('div', { class: 'mut', style: 'font-size:12px;margin-top:4px' }, s.ethos.map(k => ETHOS[k].desc).join(' ')),
      h('label', { class: 'f' }, 'Government'),
      h('select', { onchange: ev => { s.gov = ev.target.value; re(); } }, Object.keys(GOVS).map(k => h('option', { value: k, selected: s.gov === k }, GOVS[k].name))),
      h('div', { class: 'mut', style: 'font-size:12px;margin-top:4px' }, GOVS[s.gov].desc)),
    h('div', { class: 'sub' }, 'Galaxy'),
    seg(Object.keys(GALAXY_SIZES).map(k => [k, k[0].toUpperCase() + k.slice(1)]), c.size, v => { c.size = v; c.empires = GALAXY_SIZES[v].empires; re(); }),
    h('div', { class: 'mut', style: 'font-size:12px;text-align:center' }, GALAXY_SIZES[c.size].label),
    seg(Object.keys(GALAXY_SHAPES).map(k => [k, GALAXY_SHAPES[k].replace('Spiral, ', 'Spiral ').replace(' arms', '')]), c.shape, v => { c.shape = v; re(); }),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, `Empires: ${c.empires} (you and ${c.empires - 1} rivals)`), h('button', { class: 'icon', 'aria-label': 'Fewer', onclick: () => { c.empires = Math.max(3, c.empires - 1); re(); } }, icon('minus')), h('button', { class: 'icon', 'aria-label': 'More', onclick: () => { c.empires = Math.min(maxE, c.empires + 1); re(); } }, icon('plus'))),
    h('label', { class: 'f' }, 'Difficulty'), seg(Object.keys(DIFFICULTY).map(k => [k, DIFFICULTY[k].label]), c.difficulty, v => { c.difficulty = v; re(); }),
    h('label', { class: 'f' }, 'Length'), seg([[120, '120 yrs'], [200, '200 yrs'], [300, '300 yrs']], c.years, v => { c.years = v; re(); }),
    h('label', { class: 'f' }, 'Galactic crisis'), seg([['off', 'Off'], ['mild', 'Mild'], ['normal', 'Normal'], ['strong', 'Strong']], c.crisis, v => { c.crisis = v; re(); }),
    h('label', { class: 'f' }, 'Seed'), h('div', { class: 'row' }, h('input', { type: 'text', value: c.seed, oninput: ev => { c.seed = ev.target.value; } }), h('button', { class: 'icon', 'aria-label': 'Random seed', onclick: () => { c.seed = randomSeed(); re(); } }, icon('star'))),
    h('button', { class: 'gold', style: 'margin-top:10px', onclick: startNew }, 'Begin'),
  ]);
  return el;
}
function startNew() {
  const c = NG.cfg, s = NG.sp;
  if (s.ethos.length !== 2) return toast('Choose two ethos', 'bad');
  if (!s.name.trim()) return toast('Name your species', 'bad');
  if (!SW.validTraits(s.traits)) return toast('Invalid traits', 'bad');
  Settings.set('lastCfg', { size: c.size, shape: c.shape, empires: c.empires, difficulty: c.difficulty, years: c.years, crisis: c.crisis });
  const G = SW.newGame({ size: c.size, shape: c.shape, empires: c.empires, difficulty: c.difficulty, years: c.years, crisis: c.crisis, seed: c.seed.trim() || randomSeed(), autoColonies: Settings.get('autoCol') !== false,
    player: { name: s.name.trim(), empire: s.empire.trim() || s.name.trim() + ' Dominion', body: s.body, pref: s.pref, traits: s.traits.slice(), ethos: s.ethos.slice(), gov: s.gov, portrait: s.portrait.slice(), color: s.color } });
  for (const f of G.fleets) if (f.owner === 0 && f.kind === 'survey') f.auto = 1;
  Sound.play('colony');
  startGame(G, true);
}
function startGame(G, fresh) {
  UI.G = G; UI.pid = G.empires.findIndex(e => e.kind === 'major' && !e.ai); if (UI.pid < 0) UI.pid = 0;
  UI.selSys = null; UI.selFleet = null; UI.selPlanet = null; UI.moveMode = false; UI.lastAuto = G.day; UI.logSeen = G.log.length; G.uiLog = G.log.length;
  renderer.resetCaches(); renderer.mode = 'galaxy'; renderer.resize && 0;
  closeScreen(); $('screens').replaceChildren(); closeModal();
  $('hud').hidden = false; $('hint').hidden = true;
  const s = G.systems[G_capSys()];
  renderer.cam.x = s.x; renderer.cam.y = s.y + renderer.h * 0.17 / 0.75; renderer.cam.z = 0.75;
  setSpeed(0); updateHUD(); renderSel();
  selectSystem(s.id);
  if (fresh) { autosave(); setTimeout(() => showTip('welcome'), 600); }
}
// ---------- saves ----------
function loadSlot(slot) {
  try { const data = Saves.read(slot); if (!data) return toast('That slot is empty', 'bad'); const G = SW.deserializeGame(data); startGame(G); toast('Game loaded.', 'good'); }
  catch (err) { toast('Could not load: ' + err.message, 'bad'); }
}
function showSaves(inGame) {
  const back = inGame ? () => { $('screens').replaceChildren(); UI.screen = null; } : showMainMenu;
  const row = (slot, label) => {
    const m = Saves.meta(slot);
    return h('div', { class: 'item' }, h('div', { class: 'grow' }, h('div', { class: 'nm' }, label), h('div', { class: 'ds' }, m ? `${m.name} · ${SW.dateStr(m.day)} · ${m.cols} colonies · ${Math.round(m.bytes / 1024)} KB · ${new Date(m.date).toLocaleString()}` : 'Empty')),
      inGame && slot.startsWith('m') ? h('button', { class: 'small pri', onclick: () => { const err = Saves.write(slot, UI.G); toast(err || 'Saved.', err ? 'bad' : 'good'); showSaves(true); } }, 'Save') : null,
      m ? h('button', { class: 'small', onclick: () => loadSlot(slot) }, 'Load') : null,
      m ? h('button', { class: 'icon danger', 'aria-label': 'Delete', onclick: () => confirmDlg('Delete this save?', label, 'Delete', () => { Saves.remove(slot); showSaves(inGame); }, true) }, icon('close')) : null);
  };
  menuScreen([
    h('div', { class: 'row' }, h('button', { class: 'icon', 'aria-label': 'Back', onclick: back }, icon('back')), h('h2', { style: 'margin:0;flex:1' }, inGame ? 'Save or load' : 'Load game')),
    h('div', { class: 'sub' }, 'Manual saves'), Saves.MANUAL.map((s, i) => row(s, 'Slot ' + (i + 1))),
    h('div', { class: 'sub' }, 'Autosaves'), Saves.AUTO.map((s, i) => row(s, 'Autosave ' + (i + 1))),
    h('div', { class: 'sub' }, 'Transfer'),
    inGame ? h('button', { onclick: () => { const t = LZ.toText(SW.serializeGame(UI.G)); modal(h('div', null, h('h3', null, 'Export save'), h('p', null, 'Copy this code and keep it somewhere safe. Paste it into Import on any device.'), h('textarea', { readonly: true, onclick: ev => ev.target.select() }, t),
      h('div', { class: 'opts' }, h('button', { class: 'pri', onclick: () => { try { navigator.clipboard.writeText(t).then(() => toast('Copied.', 'good'), () => toast('Select the text and copy it.', 'bad')); } catch (e) { toast('Select the text and copy it.', 'bad'); } } }, 'Copy'), h('button', { onclick: closeModal }, 'Close')))); } }, 'Export as text') : null,
    h('button', { onclick: () => { const ta = h('textarea', { placeholder: 'Paste a SWK1: save code' }); modal(h('div', null, h('h3', null, 'Import save'), ta, h('div', { class: 'opts' }, h('button', { class: 'pri', onclick: () => { try { const G = SW.deserializeGame(LZ.fromText(ta.value)); closeModal(); startGame(G); toast('Imported.', 'good'); } catch (err) { toast('Import failed: ' + err.message, 'bad'); } } }, 'Import and play'), h('button', { onclick: closeModal }, 'Cancel')))); } }, 'Import from text'),
  ]);
}
// ---------- in-game menu ----------
function showGameMenu() {
  setSpeed(0);
  modal(h('div', null, h('h3', null, 'Menu'), h('div', { class: 'mut', style: 'font-size:13px' }, `${P_().name} · ${SW.dateStr(UI.G.day)} · seed ${UI.G.seed}`), h('div', { class: 'opts' },
    h('button', { class: 'pri', onclick: closeModal }, 'Resume'),
    h('button', { onclick: () => { closeModal(); showSaves(true); } }, 'Save or load'),
    h('button', { onclick: () => { closeModal(); showSettings(() => { $('screens').replaceChildren(); }); } }, 'Settings'),
    h('button', { onclick: () => { closeModal(); showHelp(() => { $('screens').replaceChildren(); }); } }, 'How to play'),
    h('button', { class: 'danger', onclick: () => { autosave(); closeModal(); showMainMenu(); } }, 'Save and quit to main menu'))));
}
// ---------- settings & help ----------
function showSettings(back) {
  const re = () => showSettings(back);
  const tog = (k, lb, after) => h('div', { class: 'item' }, h('div', { class: 'grow nm' }, lb), h('button', { class: Settings.get(k) ? 'on' : '', onclick: () => { Settings.set(k, !Settings.get(k)); Sound.unlock(); Sound.apply(); after && after(); re(); } }, Settings.get(k) ? 'On' : 'Off'));
  menuScreen([
    h('div', { class: 'row' }, h('button', { class: 'icon', 'aria-label': 'Back', onclick: back }, icon('back')), h('h2', { style: 'margin:0;flex:1' }, 'Settings')),
    h('div', { class: 'sub' }, 'Sound'), tog('sfx', 'Sound effects'), tog('music', 'Ambient music'),
    h('div', { class: 'item' }, h('div', { class: 'grow nm' }, 'Volume ' + Math.round(Settings.get('vol') * 100) + '%'), h('button', { class: 'icon', 'aria-label': 'Quieter', onclick: () => { Settings.set('vol', Math.max(0, Math.round((Settings.get('vol') - 0.1) * 10) / 10)); Sound.apply(); re(); } }, icon('minus')), h('button', { class: 'icon', 'aria-label': 'Louder', onclick: () => { Settings.set('vol', Math.min(1, Math.round((Settings.get('vol') + 0.1) * 10) / 10)); Sound.apply(); Sound.play('select'); re(); } }, icon('plus'))),
    h('div', { class: 'sub' }, 'Display'), tog('names', 'Show system and fleet names'), tog('effects', 'Battle effects'),
    h('div', { class: 'sub' }, 'Gameplay'), tog('autoCol', 'Automate new colonies', () => { if (UI.G) UI.G.cfg.autoColonies = Settings.get('autoCol'); }),
    h('div', { class: 'sub' }, 'Help'), tog('tips', 'Tips', () => { if (Settings.get('tips')) Settings.set('tipsSeen', []); }),
    h('div', { class: 'sub' }, 'Autosave'), seg([[0, 'Off'], [90, '3 mo'], [180, '6 mo'], [360, 'Yearly']], Settings.get('autosave'), v => { Settings.set('autosave', v); re(); }),
  ]);
}
const HELP = [
  ['The goal', 'Lead your people from one world to a galactic power. Win by conquest (be the last empire, or hold the homeworlds of more than half of all empires for 5 years), by waking the starlanes (hold three Wake Beacons with Keeps for 18 years after researching Wakefield Theory), or by having the highest score when the final year comes.'],
  ['Time', 'The game runs in days. Use pause, 1×, 2× and 4× at the top. The economy updates every month. Events and full-screen panels pause the game.'],
  ['Moving around', 'Drag to pan, pinch or scroll to zoom. Tap a star to inspect it, double-tap it (or use View system) to see its planets up close. Pinch out of a system to return to the galaxy.'],
  ['Exploration', 'Surveyors chart systems, reveal deposits and find anomalies. Studying an anomaly starts an event, sometimes a chain of them. Auto-explore keeps surveyors busy.'],
  ['Expansion', 'Constructors claim surveyed systems next to your borders by building outposts (alloys and influence). In your systems they build mining and research stations on deposits. Colony Arks, built at a shipyard, settle habitable worlds. Habitability depends on your preferred world type and climate.'],
  ['Planets', 'Pops work jobs. Districts give housing and worker jobs; buildings give specialist jobs, and a new building slot opens every 5 pops. Keep amenities above demand and give everyone a job for good stability. Low stability cuts output and can cause riots. Turn on Automate to let a planet build for itself.'],
  ['Resources', 'Energy pays upkeep, minerals build, food feeds pops, alloys build warships and starbases, goods keep specialists working, influence claims systems and signs treaties, unity buys traditions. Running out hurts. Tap any resource at the top to see where it comes from. Trade surplus at the Market.'],
  ['Research', 'Each of the three streams (Lumen, Vita, Forge) offers three cards. Pick one; when it completes you get three new cards. Higher tiers unlock as you learn more. Administrative sprawl makes research and traditions slower.'],
  ['Traditions and edicts', 'Spend unity on six tradition trees for lasting bonuses. Spend influence on edicts that last ten years.'],
  ['Fleets', 'Warships are built at starbases with a Shipyard. Fleets have a command limit; your total naval capacity grows with Anchorages and techs. Kinetic weapons beat shields, beams beat armor, missiles ignore evasion but can be intercepted. Design ships in Military → Designs or leave auto-design on.'],
  ['War', 'Declare war from Diplomacy with a war goal. Destroy or disable enemy starbases, hold orbit over their worlds, bombard to weaken defenses, then land armies to invade. War exhaustion rises with losses and time; at 100% a side must yield.'],
  ['Diplomacy', 'Opinion depends on ethos, borders, treaties, gifts and insults. Treaties cost influence. The panel shows what the other side thinks of each proposal before you send it.'],
  ['Other powers', 'Space fauna roam empty space and guardians protect rich systems. Native civilizations can be observed, uplifted or invaded. Midway through the game the Hollow Choir arrives from the galactic rim and threatens everyone: destroy its Spires.'],
];
function showHelp(back) {
  menuScreen([h('div', { class: 'row' }, h('button', { class: 'icon', 'aria-label': 'Back', onclick: back }, icon('back')), h('h2', { style: 'margin:0;flex:1' }, 'How to play')),
    h('div', { class: 'help' }, HELP.map(([t, p]) => [h('h3', null, t), h('p', null, p)]))]);
}
// ---------- end screen ----------
function lineChart(G, idx, title) {
  const W = 360, H = 180, c = Art.mk(W * 2, H * 2); c.className = 'chart'; const g = c.getContext('2d'); g.scale(2, 2);
  const rows = G.hist; const es = SW.majors(G);
  let max = 1; for (const r of rows) for (const e of es) max = Math.max(max, (r.s[e.id] || [0])[idx] || 0);
  g.fillStyle = '#0b0d22'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#23285a'; g.lineWidth = 1; for (let k = 0; k <= 4; k++) { const y = 10 + (H - 30) * k / 4; g.beginPath(); g.moveTo(30, y); g.lineTo(W - 6, y); g.stroke(); g.fillStyle = '#5d6396'; g.font = '9px system-ui'; g.fillText(fmt(max * (1 - k / 4)), 2, y + 3); }
  g.fillStyle = '#9096c8'; g.font = '11px system-ui'; g.fillText(title, 34, H - 6);
  if (rows.length > 1) for (const e of es) {
    g.strokeStyle = e.color; g.lineWidth = e.id === UI.pid ? 2.5 : 1.5; g.beginPath();
    rows.forEach((r, i) => { const v = (r.s[e.id] || [0])[idx] || 0; const x = 30 + (W - 36) * i / (rows.length - 1), y = 10 + (H - 30) * (1 - v / max); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }
  return c;
}
function showEnd() {
  const G = UI.G; if (!G || !G.over) return;
  if (UI.ended === G) return; UI.ended = G;
  autosave();
  const w = G.winner, W = w.e >= 0 ? G.empires[w.e] : null, me = P_();
  const won = W && W.id === UI.pid;
  Sound.play(won ? 'victory' : 'defeat');
  const title = won ? 'Victory' : w.type === 'defeat' ? 'Your empire has fallen' : 'The game is over';
  const sub = W ? `${W.name} won a ${VICTORY_TYPES[w.type].name} victory in ${SW.dateOf(w.day).y}.` : w.type === 'defeat' ? 'Your last world has been lost.' : '';
  const ranking = SW.majors(G).map(e => ({ e, s: e.alive ? SW.scoreOf(G, e).total : 0 })).sort((a, b) => b.s - a.s);
  menuScreen([
    h('div', { class: 'logo', style: 'margin:3vh 0 2vh' }, h('h1', { style: 'font-size:34px;letter-spacing:.12em' }, title.toUpperCase()), h('div', null, sub)),
    h('div', { class: 'card empcard' }, portraitEl(me, 72), h('div', { class: 'grow' }, h('div', { style: `font-weight:700;color:${me.color}` }, me.name), kvs([['Score', String(me.alive ? SW.scoreOf(G, me).total : 0)], ['Colonies', String(SW.colonies(G, me).length)], ['Pops', String(SW.totalPops(G, me))], ['Technologies', String(me.stats.techs)], ['Ships destroyed', String(me.stats.shipsKilled)], ['Ships lost', String(me.stats.shipsLost)], ['Worlds conquered', String(me.stats.planetsTaken)], ['Anomalies studied', String(me.stats.anomalies)]]))),
    h('div', { class: 'card' }, lineChart(G, 0, 'Score'), h('div', { class: 'legend' }, SW.majors(G).map(e => h('span', { style: `color:${e.color}` }, '● ' + e.name)))),
    h('div', { class: 'card' }, lineChart(G, 1, 'Pops')),
    h('div', { class: 'card' }, lineChart(G, 2, 'Systems')),
    h('div', { class: 'card' }, lineChart(G, 3, 'Fleet power')),
    h('div', { class: 'card' }, h('h3', null, 'Final standings'), ranking.map(({ e, s }) => h('div', { class: 'row sp' }, h('span', { style: `color:${e.color}` }, e.name + (e.alive ? '' : ' (destroyed)')), h('b', null, s)))),
    h('button', { class: 'pri', onclick: () => { defaultNG(); showNewGame(); } }, 'New game'),
    h('button', { onclick: showMainMenu }, 'Main menu'),
  ]);
  $('hud').hidden = true;
}
// ---------- menu background ----------
function menuBackdrop(t) {
  if (UI.G) { UI.bd = false; return; }
  const c = $('map'), g = c.getContext('2d'), w = renderer.w, hh = renderer.h;
  g.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
  g.fillStyle = '#04050d'; g.fillRect(0, 0, w, hh);
  const cx = w / 2, cy = hh * 0.32, rot = t / 60000;
  const core = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5); core.addColorStop(0, 'rgba(255,220,170,.35)'); core.addColorStop(0.25, 'rgba(160,110,255,.16)'); core.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = core; g.fillRect(0, 0, w, hh);
  for (let i = 0; i < 900; i++) {
    const arm = i % 2, d = Art.hash(i, 1, 4), a = arm * Math.PI + d * 4.2 + rot + (Art.hash(i, 2, 4) - 0.5) * 0.6, r = d * w * 0.62;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.42;
    const b = Art.hash(i, 3, 4);
    g.fillStyle = b > 0.8 ? `rgba(255,220,180,${0.5 + b * 0.5})` : `rgba(${150 + b * 100},${170 + b * 80},255,${0.3 + b * 0.5})`;
    g.fillRect(x, y, b > 0.93 ? 2 : 1, b > 0.93 ? 2 : 1);
  }
  requestAnimationFrame(menuBackdrop);
}
// ---------- boot ----------
function boot() {
  renderer = makeRenderer($('map'));
  setupInput($('map'), renderer, { tap: onTap, doubleTap: onDoubleTap, exitSystem, key: k => {
    if (!UI.G) return;
    if (k === 'pause') setSpeed(UI.speed ? 0 : UI.lastSpeed || 1); else if (k.startsWith('speed')) setSpeed(+k.slice(5)); else if (k === 'escape') { if (UI.modal) closeModal(); else if (UI.screen) closeScreen(); else clearSel(); }
  } });
  buildHUD();
  document.addEventListener('visibilitychange', () => { if (document.hidden && UI.G && !UI.G.over) { autosave(); setSpeed(0); } });
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  showMainMenu();
  requestAnimationFrame(loop);
}
window.addEventListener('DOMContentLoaded', boot);
