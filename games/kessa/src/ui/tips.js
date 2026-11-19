// ===== tips.js : the guided first colony: steps driven by colony state, with a pointer to what to tap next =====
const tipLander = G => G.buildings.find(b => b.t === 'lander');
const tipDome = G => G.buildings.find(b => !b.mod && BUILDINGS[b.t].dome);
// the next thing to tap on the way to building `type` from category `cat`
function buildPath(cat, type) {
  if (UI.mode && UI.mode.k === 'build') return UI.mode.type === type ? '#placeBar button.pri' : '#placeBar button';
  const sh = !$('#sheet').hidden && Sheet.cur;
  if (sh && Sheet.cur.tab === 'build') return Panels._buildCat === cat ? '[data-build=' + type + ']' : '#sheet .tabs button[data-k=' + cat + ']';
  if (sh) return '#sheet .sh-head button[aria-label=Close]';
  return '[data-tab=build]';
}
const tipHas = (G, t, n) => G.buildings.filter(b => b.t === t).length >= (n || 1);
const TIPS = [
  { id: 'welcome', title: 'Welcome to Kessa', text: 'Your lander is down on a cold, thin-aired world. Drag to look around, pinch to zoom, tap anything to inspect it. Time runs at the top: pause or speed it up whenever you like. The 💡 advisor always lists problems and what to build next.', done: () => false, manual: true },
  { id: 'drones', title: 'Drones do the building', text: 'You never build by hand: drones do. The lander carries 4 and they work only inside its range. Open Layers → Drone coverage (or tap the lander) to see where they can reach. Later, Drone Hubs and the Drone Crawler reach further.',
    done: G => (R.sel && R.sel.k === 'b' && R.sel.id === tipLander(G).id) || R.overlay === 'drones', hl: () => $('#sheet').hidden ? '[data-tab=layers]' : $('[data-layer=drones]') ? '[data-layer=drones]' : '#sheet .sh-head button[aria-label=Close]',
    show: G => { const L = tipLander(G); R.centerOn(L.x + 1.5, L.y + 1.5); R.overlay = 'drones'; R.sel = { k: 'b', id: L.id }; Panels.building(L); } },
  { id: 'solar', title: 'Power first', text: 'Place two Solar Arrays touching the lander (Build → Power). Buildings that touch share power; ones further away get cable planned for them.', done: G => tipHas(G, 'solar', 2), hl: () => buildPath('power', 'solar'), show: () => UI.beginBuild('solar') },
  { id: 'battery', title: 'Survive the night', text: 'Nights last about 11 hours and solar makes nothing then. Each Battery Bank stores 60 power. Build two now; the advisor tells you when you need more.', done: G => tipHas(G, 'battery', 2), hl: () => buildPath('power', 'battery'), show: () => UI.beginBuild('battery') },
  { id: 'sinter', title: 'Building blocks', text: 'Domes need sinter. Place a Regolith Sinterer (Build → Industry) on the tan fine-regolith deposit; Show me finds the nearest. Drones collect the grey metal scatter on their own.', done: G => tipHas(G, 'sinterer'), hl: () => buildPath('industry', 'sinterer'), show: () => UI.beginBuild('sinterer') },
  { id: 'water', title: 'Water and air', text: 'People need both. Your prefabs are free: an Ice Drill on the pale blue ice deposit, and an Air Synthesizer by the base (Build → Life support). A far drill gets cable and pipe planned automatically.',
    done: G => tipHas(G, 'icedrill') && tipHas(G, 'airsynth'), hl: G => buildPath('life', tipHas(G, 'icedrill') ? 'airsynth' : 'icedrill'), show: G => UI.beginBuild(tipHas(G, 'icedrill') ? 'airsynth' : 'icedrill') },
  { id: 'tanks', title: 'A buffer', text: 'Add a Water Tank and an Air Tank touching your network. If a machine breaks, the tanks keep everyone breathing while drones repair it.',
    done: G => tipHas(G, 'watertank') && tipHas(G, 'airtank'), hl: G => buildPath('life', tipHas(G, 'watertank') ? 'airtank' : 'watertank'), show: G => UI.beginBuild(tipHas(G, 'watertank') ? 'airtank' : 'watertank') },
  { id: 'dome', title: 'A home under glass', text: 'Place a Bubble Dome (Build → Domes) touching the base, so it shares power and pipes. It is the biggest job yet: watch the drones work on it.', done: G => !!tipDome(G), hl: () => buildPath('domes', 'dome_s'), show: () => UI.beginBuild('dome_s') },
  { id: 'modules', title: 'Fill the dome', text: G => { const d = tipDome(G); return (d && !d.built ? 'The dome is ' + Math.round(100 * d.prog / BUILDINGS[d.t].work) + '% built: drones are on it (speed up time if you like). ' : '') + 'Domes are empty shells. Once it is finished, tap it and add Living Quarters (beds), a Canteen (food service) and Hydroponics (food). Modules build inside, so they need no space outside.'; },
    done: G => tipHas(G, 'quarters') && tipHas(G, 'hydro'),
    hl: G => { const d = tipDome(G); if (!d || !d.built) return null; const sh = !$('#sheet').hidden && Sheet.cur; if (sh && $('[data-mod]')) return '[data-mod=' + (tipHas(G, 'quarters') ? (tipHas(G, 'canteen') ? 'hydro' : 'canteen') : 'quarters') + ']'; if (sh && $('#sheet button.pri.grow')) return '#sheet button.pri.grow'; return null; },
    show: G => { const d = tipDome(G); if (!d) return; R.centerOn(d.x + d.s / 2, d.y + d.s / 2); R.sel = { k: 'b', id: d.id }; if (d.built) Panels.addModule(d); else { Panels.building(d); HUD.toast('The dome is still being built. Add modules when it is done.', 'warn'); } } },
  { id: 'research', title: 'Research', text: 'Open Research and pick a technology. Until you have labs and scientists it is slow, but it never stops.', done: G => !!G.research.cur || G.research.queue.length > 0, hl: () => $('#sheet').hidden ? '[data-tab=research]' : !Sheet.cur || Sheet.cur.tab !== 'research' ? '#sheet .sh-head button[aria-label=Close]' : '[data-tech]:not(.done)', show: () => Panels.research() },
  { id: 'ark', title: 'Bring people', text: 'Once the dome has beds, power, water and oxygen, open Rockets → Ark, tap Pick best, add some food in Cargo, and Launch. If something is missing, the rocket panel says what.',
    done: G => G.st.everColonists || G.rockets.some(r => r.ark.length), hl: () => $('#sheet').hidden ? '[data-tab=rockets]' : !Sheet.cur || Sheet.cur.tab !== 'rockets' ? '#sheet .sh-head button[aria-label=Close]' : $('#sheet button:not(.on)[data-k=ark]') ? '#sheet .tabs button[data-k=ark]' : UI.order && !UI.order.ark.size && $('[data-pick]') ? '[data-pick]' : '[data-launch]', show: () => Panels.rockets('ark') },
  { id: 'jobs', title: 'Work and homes', text: 'Colonists take jobs near their dome. Build a Machine Works and an Ore Extractor so you make your own parts and metals. In People you can see who is unemployed, homeless or unhappy, and fix it with one tap.', done: G => tipHas(G, 'works'), hl: () => buildPath('industry', 'works'), show: () => UI.beginBuild('works') },
  { id: 'goal', title: 'The long game', text: 'Open Goals to see what Independence needs. Expand with more domes, labs and industry, sell your surplus, and watch the hazard warnings. Good luck, Commander.', done: () => false, manual: true },
];
const Tips = {
  reset() { this.shown = null; this.check(); },
  hl(sel) {
    const el = sel ? $(sel) : null;
    if (this._hl && this._hl !== el) this._hl.classList.remove('guide-hl');
    if (el && el.offsetParent !== null) { el.classList.add('guide-hl'); this._hl = el; } else this._hl = null;
  },
  check() {
    const G = UI.G, el = $('#tip');
    if (!G || !Settings.get('tips') || G.over) { el.hidden = true; this.hl(null); return; }
    const doneList = Settings.get('tipsDone') || [];
    for (const t of TIPS) if (!doneList.includes(t.id) && t.done(G)) { doneList.push(t.id); Settings.set('tipsDone', doneList); if (t.id !== 'welcome') Sound.play('good'); }
    const next = TIPS.find(t => !doneList.includes(t.id));
    Settings.data.tipsDone = doneList;
    let sel = null; try { sel = next && next.hl ? next.hl(G) : null; } catch (e) { sel = null; }
    // still placing something the current step does not need: point at Done
    if (UI.mode && (!sel || !/placeBar/.test(sel))) sel = '#placeBar button';
    this.hl(Modal.open ? null : sel);
    if (!next || UI.mode || !$('#sheet').hidden || Modal.open || $('#screens').children.length) { el.hidden = true; this.shown = null; return; }
    const text = typeof next.text === 'function' ? next.text(G) : next.text;
    if (this.shown === next.id && this._text === text && !el.hidden) return;
    this.shown = next.id; this._text = text; el.hidden = false; el.innerHTML = '';
    const n = TIPS.indexOf(next) + 1;
    el.appendChild(h('div', { class: 'row', style: 'justify-content:space-between' }, h('h4', null, next.title), h('span', { class: 'small mut' }, 'Step ' + n + ' of ' + TIPS.length)));
    el.appendChild(h('p', null, text));
    el.appendChild(h('div', { class: 'row' },
      h('button', { onclick: () => Modal.confirm('End the guide?', 'You can turn it back on in Settings → Tutorial tips.', () => { Settings.set('tips', false); el.hidden = true; this.hl(null); }, 'End guide') }, 'End guide'),
      next.manual ? null : h('button', { onclick: () => { doneList.push(next.id); Settings.set('tipsDone', doneList); this.shown = null; Sound.play('tap'); this.check(); } }, 'Skip'),
      next.show ? h('button', { class: 'pri', 'data-show': next.id, onclick: () => { Sound.play('open'); el.hidden = true; this.shown = null; next.show(G); } }, 'Show me') : h('button', { class: 'pri', onclick: () => { doneList.push(next.id); Settings.set('tipsDone', doneList); this.shown = null; Sound.play('tap'); this.check(); } }, next.manual ? 'Got it' : 'Next')));
  },
};
