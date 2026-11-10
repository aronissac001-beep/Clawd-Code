// ===== tips.js : a first-game guide. Each tip shows once, when it becomes relevant. =====
const TIPS = [
  { id: 'welcome', when: (G, P) => G.units.some(u => u.owner === P.id && UNITS[u.type].founds) && !G.cities.some(c => c.owner === P.id) && P.landed,
    title: 'Welcome to Veyra', text: 'Tap your Colony Pod, then press Found colony. Glow-rivers, coast, ridges and steppe make strong colonies. Avoid the pink Veil. Drag to pan, pinch to zoom.' },
  { id: 'move', when: (G, P) => UI.sel && UI.sel.k === 'unit' && G.cities.some(c => c.owner === P.id),
    title: 'Moving units', text: 'Tap a tile to see the path, tap it again to go. Long-press any tile to learn about it. Undo appears after a move that revealed nothing new.' },
  { id: 'production', when: (G, P) => G.cities.some(c => c.owner === P.id && !c.build),
    title: 'Colony production', text: 'A colony with nothing to build wastes its production. Tap it and pick something. A Rigger and an Explorer are good first picks.' },
  { id: 'research', when: (G, P) => G.cities.some(c => c.owner === P.id) && !P.research,
    title: 'The technology web', text: 'Tap 🔬 at the top to open the web. Eight sectors surround Landfall; colored badges show the affinity each tech teaches. Breakthroughs (💡) cut a tech\'s cost.' },
  { id: 'veil', when: (G, P) => G.units.some(u => u.owner === P.id && G.map.veil[u.tile]),
    title: 'The Spore Veil', text: 'One of your units is in the Veil and will lose health each turn. Move it out, scour the Veil with a Rigger (Biocontainment), or walk the path of Communion and stop fearing it.' },
  { id: 'builder', when: (G, P) => G.units.some(u => u.owner === P.id && u.type === 'builder'),
    title: 'Riggers', text: 'Riggers improve tiles: Hydro Farms, Drill Rigs, Harvest Camps and Bloom Gardens on resources, and roads to link colonies. Each has 3 charges. Auto lets them choose.' },
  { id: 'explorer', when: (G, P) => (G.sites || []).some(s => P._vis[s.tile]),
    title: 'Something worth excavating', text: 'A crash site, Precursor ruin or Echo Vault is in sight. Send an Explorer onto it and press Excavate for supplies, artifacts and affinity.' },
  { id: 'nest', when: (G, P) => G.camps.some(c => P._vis && P._vis[c.tile]),
    title: 'A fauna nest', text: 'Native beasts guard their nests. An Explorer next door can study the nest for science and Communion. Destroying it pays credits, but the wild remembers and grows angry.' },
  { id: 'affinity', when: (G, P) => HX.AFF_KEYS.some(a => HX.affLevel(P, a) >= 1),
    title: 'Affinity', text: 'You reached your first affinity level. Tap the affinity button on the right to see Communion, Lattice and Lineage, their perks and the units they unlock.' },
  { id: 'story', when: (G, P) => !!HX.pendingStory(G, P.id),
    title: 'Story quests', text: 'The council has a question. Each answer is a permanent bonus and a nudge toward one affinity. Choose the future you want.' },
  { id: 'happy', when: (G, P) => G.cities.filter(c => c.owner === P.id).length >= 2 && HX.civHappiness(G, P.id).net < 3,
    title: 'Morale', text: 'Morale 🙂 is shared by your whole faction. Each colony and citizen lowers it; luxuries, Med Clinics, Holo Arenas and some virtues raise it. Below zero, growth slows.' },
  { id: 'policy', when: (G, P) => P.culturePool >= HX.policyCost(G, P.id),
    title: 'Virtues', text: 'Your culture can buy a virtue. Tap 🎴. Going deep in a tree and spreading across all four both earn synergy bonuses.' },
  { id: 'ruins', when: (G, P) => (G.ruins || []).some(t => P._vis[t]),
    title: 'Supply pods', text: 'A beacon marks a supply pod from the arks. Reach it with any land unit for credits, research, survivors or an artifact. Some are full of angry beasts.' },
  { id: 'sat', when: (G, P) => G.units.some(u => u.owner === P.id && UNITS[u.type].orbital),
    title: 'Satellites', text: 'A satellite is ready. Select it in its colony and choose a launch site within 4 tiles. Its effect covers the tiles beneath it until it burns up.' },
  { id: 'quest', when: (G, P) => !!P.quest,
    title: 'Directives', text: 'You took on a directive. The 📜 button on the right shows your progress and how many turns are left.' },
  { id: 'meet', when: (G, P) => P.met.some(k => !G.players[k].barbarian && !G.players[k].minor),
    title: 'Another faction', text: 'You met a rival colony. Tap 🤝 to see how they feel about you and why: their agenda, your affinities and your history.' },
  { id: 'freecity', when: (G, P) => P.met.some(k => G.players[k].minor),
    title: 'An outpost', text: 'You met an independent outpost. Gift credits or run convoys there to become its friend or ally and receive its bonus every turn; allies can absorb it.' },
  { id: 'war', when: (G, P) => HX.majorPlayers(G).some(Q => Q.id !== P.id && HX.atWar(G, P.id, Q.id)),
    title: 'War', text: 'Tap an enemy to preview the fight, tap again to attack. Ridges, forests, glow-rivers and fortifying help defenders. Colonies shoot back; walls make them tougher.' },
  { id: 'wonder', when: (G, P) => G.cities.some(c => c.owner === P.id && HX.availableItems(G, c).some(it => HX.isWonder(it.key))),
    title: 'Planetary wonders', text: 'A wonder is available, at the bottom of a colony\'s build list. Only one faction can build each.' },
  { id: 'credits', when: (G, P) => P.gold >= 250 && G.turn >= 12 && G.cities.some(c => c.owner === P.id),
    title: 'Spend your credits', text: 'Credits are piling up. Open a colony and press Buy to finish what it is making, upgrade units at a colony, or gift credits to an outpost in Diplomacy (🤝).' },
  { id: 'victory', when: (G) => G.turn >= 25,
    title: 'How to win', text: 'Tap 🏆 to see the six victories (one per affinity, the Awakening, Dominion and Legacy), how close everyone is, and graphs of the game so far.' },
];
function checkTips() {
  const G = UI.G; if (!G || UI.busy || !Settings.get('tips') || document.querySelector('#screens .screen') || $('modal').firstChild) return;
  if ($('tip')) return;
  const P = G.players[UI.pid], seen = Settings.get('tipsSeen') || [];
  if (!P.landed && P.landing && P.landing.length > 1 && !G.cities.some(c => c.owner === UI.pid)) return; // landfall first
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
