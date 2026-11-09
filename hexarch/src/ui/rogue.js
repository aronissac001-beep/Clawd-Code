// ===== rogue.js (UI) : Expedition setup, boon drafts, relics =====
function heatUnlocked() { return Math.max(0, Math.min(HX.MAX_HEAT, Settings.get('heatMax') || 0)); }
function heatName(n) { return ['Calm', 'Warm', 'Hot', 'Searing', 'Blazing', 'Infernal', 'Molten'][n] || 'Heat ' + n; }

function showExpedition(back) {
  const last = Settings.get('lastExp') || {};
  const st = { civ: last.civ || 'random', heat: Math.min(heatUnlocked(), last.heat || 0), size: last.size || 'small', len: last.len || 250 };
  const render = () => {
    const top = $('screens').firstChild ? $('screens').firstChild.scrollTop : 0;
    const unl = heatUnlocked(), curses = HX.CURSES.slice(0, st.heat);
    const civBtn = c => h('button', { class: 'civ mini' + (st.civ === (c ? c.key : 'random') ? ' on' : ''), onclick: () => { st.civ = c ? c.key : 'random'; render(); } },
      c ? civEmblem(c, 36) : h('div', { class: 'sw', style: 'background:conic-gradient(#e2b544,#5b84dc,#e46a3c,#2db7a6,#62c44c,#b85aa6,#e2b544)' }),
      h('div', { class: 'n' }, c ? c.name : 'Random'));
    const el = screen(
      h('h2', null, backBtn(back), 'Expedition'),
      h('div', { class: 'card gold exp-intro' },
        h('b', null, '🗺️ A roguelike run'),
        h('div', { class: 's' }, 'Pick a boon before you set out and another at the dawn of every era: relics with lasting powers, or a windfall now. Ruins hide treasure, relics and traps. One save, no undo. Win to unlock the next Heat level, where curses stack and your run score climbs.')),
      h('h3', null, 'Civilization'),
      h('div', { class: 'civs mini' }, civBtn(null), CIVS.filter(c => !c.barb && !c.minor).map(civBtn)),
      h('h3', null, 'Heat'),
      h('div', { class: 'heat' }, Array.from({ length: HX.MAX_HEAT + 1 }, (_, n) => h('button', { class: (st.heat === n ? 'on ' : '') + (n > unl ? 'locked' : ''), disabled: n > unl, 'aria-label': `Heat ${n}`, onclick: () => { st.heat = n; render(); } },
        h('div', { class: 'hn' }, n > unl ? '🔒' : String(n)), h('div', { class: 'hl' }, heatName(n))))),
      h('div', { class: 'note' }, `Score ×${(1 + 0.25 * st.heat).toFixed(2)}. ` + (unl < HX.MAX_HEAT ? `Win at Heat ${unl} to unlock Heat ${unl + 1}.` : 'Every Heat level is open.')),
      curses.length ? h('div', { class: 'col' }, curses.map(c => h('div', { class: 'card codex curse' }, h('div', { class: 'row' }, h('div', { class: 'cx-ic' }, c.glyph), h('div', { class: 'grow' }, h('b', null, c.name), h('div', { class: 's' }, c.text))))))
        : h('div', { class: 'note' }, 'No curses. A good first run.'),
      h('h3', null, 'Map'),
      seg([['tiny', 'Tiny'], ['small', 'Small'], ['medium', 'Medium']], st.size, v => { st.size = v; render(); }),
      h('h3', null, 'Length'),
      seg([[150, 'Short · 150 turns'], [250, 'Standard · 250']], st.len, v => { st.len = v; render(); }),
      h('div', { class: 'note' }, `${{ tiny: 2, small: 3, medium: 4 }[st.size]} rivals${st.heat >= 5 ? ' plus one' : ''}, ${st.len} turns, ancient ruins everywhere. Everything moves faster in a short run.`),
      h('div', { class: 'bar' }, h('button', { onclick: back }, 'Back'), h('button', { class: 'pri', onclick: () => {
        Settings.set('lastExp', st);
        const cfg = Object.assign(HX.defaultConfig(), { size: st.size, script: Math.random() < 0.5 ? 'continents' : 'pangaea', rivals: { tiny: 2, small: 3, medium: 4 }[st.size], turnLimit: st.len, civ: st.civ, difficulty: 1, expedition: { heat: st.heat } });
        startNewGame(cfg, true);
      } }, 'Set out')));
    showScreen(el); el.scrollTop = top;
  };
  render();
}

// The boon draft: a modal that must be answered. Returns true if one was shown.
function showPendingDraft() {
  const G = UI.G; if (!G || UI.busy || $('modal').firstChild) return false;
  const d = HX.pendingDraft(G, UI.pid); if (!d) return false;
  Sound.play('wonder');
  $('modal').replaceChildren(h('div', { class: 'dlg draft' }, h('div', { class: 'evk' }, 'Choose a boon'), h('h4', null, d.title), h('p', null, d.text),
    h('div', { class: 'col' }, d.choices.map(ch => h('button', { class: 'boon' + (ch.cursed ? ' cursed' : ''), onclick: () => {
      if (!HX.resolveDraft(G, UI.pid, ch.i)) return;
      closeModal(); Sound.play(ch.cursed ? 'war' : 'policy'); updateHUD(); flushLog(); refreshAll();
      setTimeout(() => { if (!showPendingDraft()) showPendingEvent(); }, 350);
    } }, h('div', { class: 'bg' }, ch.glyph), h('div', { class: 'tx' }, h('div', { class: 'k' }, ch.kind), h('b', null, ch.name), h('div', { class: 's' }, ch.text)))))));
  return true;
}

// Relics and curses held by a player, for the Empire screen.
function relicSection(G, pid) {
  const P = G.players[pid], rel = P.relics || [], cur = P.curses || [];
  if (!rel.length && !cur.length && !G.cfg.expedition) return null;
  return [h('h3', null, 'Relics' + (G.cfg.expedition ? ` · Expedition, Heat ${HX.expHeat(G)}` : '')),
    rel.length ? h('div', { class: 'col' }, rel.map(k => { const R = HX.RELI[k]; return h('div', { class: 'card codex relic' + (R.cursed ? ' curse' : ' gold') }, h('div', { class: 'row' }, h('div', { class: 'cx-ic' }, R.glyph), h('div', { class: 'grow' }, h('b', null, R.name), h('div', { class: 's' }, R.text)))); }))
      : h('p', { class: 'note' }, 'No relics yet. Explore ancient ruins, or choose one when a new era dawns.'),
    cur.length ? h('div', { class: 'col', style: 'margin-top:8px' }, cur.map(k => { const C = HX.CURSI[k]; return h('div', { class: 'card codex curse' }, h('div', { class: 'row' }, h('div', { class: 'cx-ic' }, C.glyph), h('div', { class: 'grow' }, h('b', null, C.name), h('div', { class: 's' }, C.text)))); })) : null,
    G.cfg.expedition ? h('p', { class: 'note' }, `Run score so far: ${HX.runScore(G, pid, false)} (score ×${HX.runMultiplier(G).toFixed(2)}).`) : null];
}
function relicCodex(card) {
  return [h('div', { class: 'k', style: 'margin-top:10px' }, 'Ancient ruins'),
    card('🏛️', 'Ancient ruins', 'Step on one with any land unit', 'Treasure, ancient tablets, maps, survivors who join you, training grounds, settlers, relics, and sometimes a barbarian trap. Each ruin can be looted once.'),
    h('div', { class: 'k', style: 'margin-top:10px' }, 'Relics'),
    HX.RELICS.map(R => card(R.glyph, R.name, R.cursed ? 'Cursed relic' : 'Relic', R.text + ' Each relic exists once in the world.', R.cursed ? 'curse' : 'gold')),
    h('div', { class: 'k', style: 'margin-top:10px' }, 'Expedition curses'),
    HX.CURSES.map((C, i) => card(C.glyph, C.name, `Heat ${i + 1} and above`, C.text, 'curse'))];
}
// A run that ended in defeat (no game-over screen): remember it in the Hall of Fame.
function recordRun(G, won) {
  const me = G.players[UI.pid], hall = Settings.get('hall') || [];
  hall.unshift({ date: Date.now(), civ: CIVS[me.civ].key, won: !!won, type: 'fallen', winner: null, turn: G.turn, score: 0, size: G.cfg.size, difficulty: G.cfg.difficulty, seed: G.seed, humans: 1,
    heat: HX.expHeat(G), runScore: Math.round(HX.runScore(G, UI.pid, false) || HX.expHeat(G) * 10 + G.turn), relics: (me.relics || []).length });
  Settings.set('hall', hall.slice(0, 30));
}
function unlockHeat(h) {
  const next = Math.min(HX.MAX_HEAT, h + 1);
  if (next > heatUnlocked()) { Settings.set('heatMax', next); setTimeout(() => toast(`Heat ${next} (${heatName(next)}) unlocked for your next Expedition.`, -1, 3500), 1500); }
}

// ---- quests ----
function updateQuestBtn(G) {
  const q = HX.activeQuest(G, UI.pid), off = HX.pendingQuestOffer(G, UI.pid), b = $('btnQuest');
  b.hidden = !q && !off;
  b.querySelector('.pip').hidden = !off;
  b.querySelector('.qn').textContent = q ? `${Math.min(q.cur, q.need)}/${q.need}` : '';
  b.classList.toggle('done', !!q && q.cur >= q.need);
}
function questCard(q, extra) {
  return h('div', { class: 'card codex quest' }, h('div', { class: 'row' }, h('div', { class: 'cx-ic' }, q.glyph), h('div', { class: 'grow' }, h('b', null, q.name), h('div', { class: 's' }, q.text))),
    h('div', { class: 'b' }, `Reward: ${q.reward}. `, extra || `${q.left} turns to finish.`));
}
// A quest offer: two quests to pick from, or neither. Returns true if shown.
function showQuestOffer() {
  const G = UI.G; if (!G || UI.busy || $('modal').firstChild) return false;
  const off = HX.pendingQuestOffer(G, UI.pid); if (!off) return false;
  Sound.play('policy');
  const done = i => { HX.acceptQuest(G, UI.pid, i); closeModal(); updateHUD(); flushLog(); setTimeout(() => showPendingEvent(), 350); };
  $('modal').replaceChildren(h('div', { class: 'dlg draft' }, h('div', { class: 'evk' }, 'A quest'), h('h4', null, 'The court has a challenge for you'),
    h('p', null, 'Take on one quest. Finish it in time for the reward; fail and nothing is lost but the chance.'),
    h('div', { class: 'col' }, off.map((q, i) => h('button', { class: 'boon', onclick: () => done(i) },
      h('div', { class: 'bg' }, q.glyph), h('div', { class: 'tx' }, h('div', { class: 'k' }, `${q.left} turns · reward ${q.reward}`), h('b', null, q.name), h('div', { class: 's' }, q.text)))),
      h('button', { onclick: () => done(-1) }, 'Not now'))));
  return true;
}
function showQuestDlg() {
  const G = UI.G; if (!G) return;
  if (showQuestOffer()) return;
  const q = HX.activeQuest(G, UI.pid); if (!q) return;
  $('modal').replaceChildren(h('div', { class: 'dlg' }, h('h4', null, 'Current quest'),
    questCard(q, `Progress ${Math.min(q.cur, q.need)}/${q.need}. ${q.left > 0 ? q.left + ' turns left.' : 'Last turn!'}`),
    h('div', { class: 'prog', style: 'margin-top:10px' }, h('i', { style: `width:${Math.min(100, q.cur / q.need * 100)}%` })),
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: closeModal }, 'OK'))));
}
