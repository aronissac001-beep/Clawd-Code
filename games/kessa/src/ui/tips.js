// ===== tips.js : first-game tutorial cards driven by colony state =====
const TIPS = [
  { id: 'welcome', title: 'Welcome to Kessa', text: 'Your lander is down. Drag to look around, pinch to zoom, tap anything to inspect it. Time is running: use the buttons at the top to pause or speed up. The 💡 button is your advisor: it lists problems and what to build next.', done: () => false, manual: true },
  { id: 'solar', title: 'Power first', text: 'Open Build → Power and place two Solar Arrays touching the lander. Buildings that touch share power.', done: G => G.buildings.filter(b => b.t === 'solar').length >= 2 },
  { id: 'battery', title: 'Survive the night', text: 'Nights last about 11 hours and solar makes nothing then. Each Battery Bank stores 60 power: build enough to carry your whole base through the dark (the 💡 advisor tells you how many).', done: G => G.buildings.filter(b => b.t === 'battery').length >= 2 },
  { id: 'sinter', title: 'Building blocks', text: 'Domes need sinter. Place a Regolith Sinterer (Build → Industry) over the tan fine-regolith deposit near the lander. Drones collect the grey metal scatter by themselves.', done: G => G.buildings.some(b => b.t === 'sinterer') },
  { id: 'water', title: 'Water and air', text: 'Use your prefabs: an Ice Drill on the pale blue ice deposit and an Air Synthesizer by the base (Build → Life support). Link a far drill with Life Pipe and Power Cable.', done: G => G.buildings.some(b => b.t === 'icedrill') && G.buildings.some(b => b.t === 'airsynth') },
  { id: 'tanks', title: 'Storage', text: 'Add a Water Tank and an Air Tank touching your network so colonists have a buffer.', done: G => G.buildings.some(b => b.t === 'watertank') && G.buildings.some(b => b.t === 'airtank') },
  { id: 'dome', title: 'A home under glass', text: 'Place a Bubble Dome (Build → Domes) touching the base, so it shares power and pipes.', done: G => G.buildings.some(b => b.t === 'dome_s') },
  { id: 'modules', title: 'Fill the dome', text: 'When the dome is finished, tap it and add Living Quarters, a Canteen and Hydroponics.', done: G => G.buildings.some(b => b.t === 'quarters') && G.buildings.some(b => b.t === 'hydro') },
  { id: 'research', title: 'Research', text: 'Open Research and choose a technology. Labs and scientists speed this up later.', done: G => !!G.research.cur || G.research.queue.length > 0 },
  { id: 'ark', title: 'Bring people', text: 'Once the dome has homes, power, water and oxygen, open Rockets → Colonists, tap Pick best, add some food in Cargo, and Launch.', done: G => G.st.everColonists || G.rockets.some(r => r.ark.length) },
  { id: 'jobs', title: 'Work and shifts', text: 'Colonists work in buildings near their dome. Build a Machine Works and an Ore Extractor so you make your own parts and metals. Watch the badges over buildings for problems.', done: G => G.buildings.some(b => b.t === 'works') },
  { id: 'goal', title: 'The long game', text: 'Open Goals to see what Independence needs. Expand with more domes, labs and industry, and keep an eye on the hazard warnings. Good luck, Commander.', done: () => false, manual: true },
];
const Tips = {
  reset() { this.shown = null; this.check(); },
  check() {
    const G = UI.G, el = $('#tip');
    if (!G || !Settings.get('tips') || G.over) { el.hidden = true; return; }
    const doneList = Settings.get('tipsDone') || [];
    for (const t of TIPS) if (!doneList.includes(t.id) && t.done(G)) doneList.push(t.id);
    const next = TIPS.find(t => !doneList.includes(t.id));
    Settings.data.tipsDone = doneList;
    if (!next || UI.mode || !$('#sheet').hidden || Modal.open || $('#screens').children.length) { el.hidden = true; this.shown = null; return; }
    if (this.shown === next.id && !el.hidden) return;
    this.shown = next.id; el.hidden = false; el.innerHTML = '';
    el.appendChild(h('h4', null, next.title)); el.appendChild(h('p', null, next.text));
    el.appendChild(h('div', { class: 'row' }, h('button', { onclick: () => { Settings.set('tips', false); el.hidden = true; } }, 'Hide tips'), h('button', { class: 'pri', onclick: () => { doneList.push(next.id); Settings.set('tipsDone', doneList); this.shown = null; Sound.play('tap'); this.check(); } }, next.manual ? 'Got it' : 'Skip')));
  },
};
