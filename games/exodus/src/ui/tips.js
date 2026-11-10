// ===== tips.js : a first-game guide. Each tip shows once, when it becomes relevant. =====
const TIPS = [
  { id: 'welcome', when: (G, P) => G.units.some(u => u.owner === P.id && UNITS[u.type].founds) && !G.cities.some(c => c.owner === P.id),
    title: 'Welcome to Hexarch', text: 'Tap your Settler (the wagon), then press Found City. Rivers, coast, hills and grassland make strong cities. Drag to pan, pinch to zoom.' },
  { id: 'move', when: (G, P) => UI.sel && UI.sel.k === 'unit' && G.cities.some(c => c.owner === P.id),
    title: 'Moving units', text: 'Tap a tile to see the path, tap it again to go. Long-press any tile to learn about it. ↶ Undo appears after a move that revealed nothing new.' },
  { id: 'production', when: (G, P) => G.cities.some(c => c.owner === P.id && !c.build),
    title: 'City production', text: 'A city with nothing to build wastes its production. Tap the city, or the gold button at the bottom right, and pick something. Builders and Scouts are good first picks.' },
  { id: 'research', when: (G, P) => G.cities.some(c => c.owner === P.id) && !P.research,
    title: 'Research', text: 'Tap 🔬 at the top to choose a technology. Each one unlocks buildings, units or improvements. Insights (💡) cut a technology\'s cost when you meet their condition.' },
  { id: 'builder', when: (G, P) => G.units.some(u => u.owner === P.id && u.type === 'builder'),
    title: 'Builders', text: 'Builders improve tiles: farms for food, mines on hills, camps and plantations on resources, roads to link cities. Each has 3 charges. Auto lets them choose for you.' },
  { id: 'happy', when: (G, P) => G.cities.filter(c => c.owner === P.id).length >= 2 && HX.civHappiness(G, P.id).net < 3,
    title: 'Happiness', text: 'Happiness 🙂 is shared by your whole empire. Each city and citizen lowers it; different luxuries, temples, arenas and some policies raise it. Below zero, growth slows.' },
  { id: 'policy', when: (G, P) => P.culturePool >= HX.policyCost(G, P.id),
    title: 'Policies', text: 'Your culture can buy a policy. Tap 🎭. Finishing a whole tree gives a bonus, and four trees open the way to a Culture victory.' },
  { id: 'ruins', when: (G, P) => (G.ruins || []).some(t => P._vis[t]),
    title: 'Ancient ruins', text: 'Broken columns mark ancient ruins. Step on one with any land unit for a random reward: gold, science, a map, recruits, even a relic. A few hide a barbarian trap.' },
  { id: 'quest', when: (G, P) => !!P.quest,
    title: 'Quests', text: 'You took on a quest. The 📜 button on the right shows your progress and how many turns are left. Finish in time for the reward.' },
  { id: 'hoard', when: (G, P) => G.camps.some(c => c.hoard && P._vis[c.tile]),
    title: 'A barbarian hoard', text: 'A camp marked 💎 guards a hoard. Destroy it (move a military unit onto it) to claim a relic.' },
  { id: 'meet', when: (G, P) => P.met.some(k => !G.players[k].barbarian),
    title: 'Another civilization', text: 'You met a neighbor. Tap 🤝 to see how they feel about you and why, trade luxuries, or open your borders.' },
  { id: 'freecity', when: (G, P) => P.met.some(k => G.players[k].minor),
    title: 'A free city', text: 'You met a free city. Gift gold from Diplomacy (🤝) to become its friend or ally and receive its bonus every turn.' },
  { id: 'pantheon', when: (G, P) => HX.pantheonStatus(G, P.id).ok,
    title: 'Pantheon', text: 'You have enough faith for a Pantheon. Tap 🙏 and choose a belief. Later, a Prophet can found a full religion.' },
  { id: 'war', when: (G, P) => HX.majorPlayers(G).some(Q => Q.id !== P.id && HX.atWar(G, P.id, Q.id)),
    title: 'War', text: 'Tap an enemy to preview the fight, tap again to attack. Hills, forest, rivers and fortifying help defenders. Cities shoot back; walls make them tougher.' },
  { id: 'barb', when: (G, P) => G.camps.some(c => P._vis && P._vis[c.tile]),
    title: 'Barbarians', text: 'A barbarian camp! It sends raiders. Move a military unit onto it to destroy it and claim gold.' },
  { id: 'wonder', when: (G, P) => G.cities.some(c => c.owner === P.id && HX.availableItems(G, c).some(it => HX.isWonder(it.key))),
    title: 'World wonders', text: 'A world wonder is available, at the bottom of a city\'s build list. Only one civilization can build each, so race for the ones you want.' },
  { id: 'victory', when: (G) => G.turn >= 25,
    title: 'How to win', text: 'Tap 🏆 to see the six ways to win, how close you and your rivals are, and graphs of the game so far.' },
];
function checkTips() {
  const G = UI.G; if (!G || UI.busy || !Settings.get('tips') || document.querySelector('#screens .screen') || $('modal').firstChild) return;
  if ($('tip')) return;
  const P = G.players[UI.pid], seen = Settings.get('tipsSeen') || [];
  for (const T of TIPS) {
    if (seen.includes(T.id)) continue;
    let ok = false; try { ok = T.when(G, P); } catch (e) { ok = false; }
    if (!ok) continue;
    const done = () => { el.remove(); Settings.set('tipsSeen', (Settings.get('tipsSeen') || []).concat(T.id)); };
    const el = h('div', { id: 'tip', class: 'tip' }, h('div', { class: 't' }, '💡 ' + T.title), h('div', { class: 'x' }, T.text),
      h('div', { class: 'bar' }, h('button', { onclick: () => { done(); Settings.set('tips', false); toast('Tips off. Turn them back on in Settings.'); } }, 'No more tips'), h('button', { class: 'pri', onclick: () => { done(); setTimeout(checkTips, 400); } }, 'Got it')));
    $('hud').append(el);
    return;
  }
}
