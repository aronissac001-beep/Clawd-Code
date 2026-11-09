// ===== victory.js (ui) : victory progress, wonders, graphs, end of game =====
const STAT_TABS = [['score', 'Score', 0], ['sci', 'Science', 1], ['cul', 'Culture', 2], ['mil', 'Military', 3], ['cities', 'Cities', 4], ['techs', 'Techs', 6]];
// Line chart of one statistic for the civs the player knows. Unknown civs are drawn grey and unnamed.
function statChart(G, idx, h0) {
  const cv = document.createElement('canvas'), W = Math.min(window.innerWidth - 32, 560), H = h0 || 180, dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.className = 'chart';
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const t = G.hist.t, P = G.players[UI.pid];
  const series = HX.majorPlayers(G).filter(Q => G.hist.p[Q.id]).map(Q => ({ Q, known: Q.id === UI.pid || P.met.includes(Q.id), v: G.hist.p[Q.id].map(r => r[idx]) }));
  let max = 1; for (const s of series) for (const x of s.v) if (x > max) max = x;
  const L = 34, R = 8, T = 8, B = 20, pw = W - L - R, ph = H - T - B;
  ctx.fillStyle = '#0d131a'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1f2935'; ctx.lineWidth = 1; ctx.font = '10px system-ui'; ctx.fillStyle = '#7b8796'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) { const y = T + ph * (1 - i / 4); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillText(String(Math.round(max * i / 4)), L - 4, y + 3); }
  if (t.length < 2) { ctx.textAlign = 'center'; ctx.fillText('History appears after a few turns.', W / 2, H / 2); return cv; }
  const t0 = t[0], t1 = t[t.length - 1], X = i => L + pw * (t[i] - t0) / Math.max(1, t1 - t0), Y = v => T + ph * (1 - v / max);
  ctx.textAlign = 'center'; for (let i = 0; i <= 4; i++) { const tt = Math.round(t0 + (t1 - t0) * i / 4); ctx.fillText('T' + tt, L + pw * i / 4, H - 5); }
  series.sort((a, b) => (a.Q.id === UI.pid) - (b.Q.id === UI.pid));
  for (const s of series) {
    ctx.strokeStyle = s.known ? CIVS[s.Q.civ].color : '#465263'; ctx.lineWidth = s.Q.id === UI.pid ? 3 : 1.6; ctx.globalAlpha = s.known ? 1 : 0.7;
    ctx.beginPath(); const off = t.length - s.v.length;
    s.v.forEach((v, i) => { const x = X(i + off), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return cv;
}
function chartBlock(G) {
  let tab = 0; const box = h('div', { class: 'chartbox' });
  const draw = () => box.replaceChildren(seg(STAT_TABS.map((x, i) => [i, x[1]]), tab, v => { tab = v; draw(); }), statChart(G, STAT_TABS[tab][2]),
    h('div', { class: 'chips', style: 'margin-top:6px' }, HX.majorPlayers(G).filter(Q => Q.id === UI.pid || G.players[UI.pid].met.includes(Q.id)).map(Q => h('span', { class: 'chip', style: `border-color:${CIVS[Q.civ].color}` }, h('i', { class: 'dot', style: `background:${CIVS[Q.civ].color}` }), Q.id === UI.pid ? 'You' : CIVS[Q.civ].name))));
  draw(); return box;
}
function knownName(G, pid) { return pid === UI.pid ? 'You' : G.players[UI.pid].met.includes(pid) ? CIVS[G.players[pid].civ].name : 'An unknown civilization'; }
function showVictory(back) {
  const G = UI.G; if (!G) return;
  const P = G.players[UI.pid], alive = HX.majorPlayers(G).filter(Q => Q.alive);
  const prog = {}; for (const Q of alive) prog[Q.id] = HX.victoryProgress(G, Q.id);
  const mine = prog[UI.pid] || HX.victoryProgress(G, UI.pid);
  const cards = VICTORIES.filter(v => G.cfg.victories[v.key]).map(v => {
    const lead = alive.filter(Q => Q.id !== UI.pid).sort((a, b) => prog[b.id][v.key].pct - prog[a.id][v.key].pct)[0];
    const lp = lead ? prog[lead.id][v.key].pct : 0;
    return h('div', { class: 'card vcard' },
      h('div', { class: 'row' }, h('div', { class: 'vic' }, { domination: '⚔️', science: '🚀', score: '🏅', culture: '🎭', religion: '🙏', diplomacy: '🕊️' }[v.key]), h('div', { class: 'grow' }, h('b', null, v.name), h('div', { class: 's' }, v.desc))),
      h('div', { class: 'vrow' }, h('span', null, 'You'), h('div', { class: 'prog' }, h('i', { style: `width:${Math.round(mine[v.key].pct * 100)}%` })), h('span', null, Math.round(mine[v.key].pct * 100) + '%')),
      h('div', { class: 's' }, mine[v.key].text),
      lead ? h('div', { class: 'vrow them' }, h('span', null, P.met.includes(lead.id) ? CIVS[lead.civ].name.replace(/^The /, '') : 'Leader (unknown)'), h('div', { class: 'prog' }, h('i', { style: `width:${Math.round(lp * 100)}%;background:${P.met.includes(lead.id) ? CIVS[lead.civ].color : '#5b6676'}` })), h('span', null, Math.round(lp * 100) + '%')) : null);
  });
  const ranks = alive.slice().sort((a, b) => HX.scoreOf(G, b.id) - HX.scoreOf(G, a.id));
  const wonderRow = W => {
    const w = G.wonders[W.key], have = P.techs.includes(W.tech);
    const where = w ? (w.pid === UI.pid || P.met.includes(w.pid) ? `${knownName(G, w.pid)}${(c => c && (c.owner === UI.pid || P.seen[c.tile]) ? ' · ' + c.name : '')(HX.cityById(G, w.city))}, turn ${w.turn}` : `Built on turn ${w.turn}`) : have ? 'Available to build' : `Needs ${TECHS[TECHI[W.tech]].name}`;
    return h('div', { class: 'wonder' + (w ? (w.pid === UI.pid ? ' mine' : ' taken') : have ? ' open' : '') }, h('div', { class: 'wg' }, W.glyph), h('div', { class: 'tx' }, h('div', { class: 'a' }, W.name), h('div', { class: 'b' }, W.desc), h('div', { class: 'c' }, where)));
  };
  showScreen(screen(
    h('h2', null, backBtn(back || backToMap), 'Victory'),
    h('p', { class: 'note' }, `Turn ${G.turn} of ${G.cfg.turnLimit}. The first civilization to meet any enabled condition wins. If nobody does, the highest score wins when time runs out.`),
    cards,
    h('h3', null, 'Score'),
    h('div', { class: 'card' }, ranks.map((Q, i) => h('div', { class: 'reason' + (Q.id === UI.pid ? ' me' : '') }, h('span', null, `${i + 1}. ${knownName(G, Q.id)}`), h('b', null, String(HX.scoreOf(G, Q.id))))),
      h('details', null, h('summary', null, 'Your score in detail'), HX.scoreParts(G, UI.pid).map(([k, v]) => h('div', { class: 'reason' }, h('span', null, k), h('b', null, String(v)))))),
    h('h3', null, 'History'), chartBlock(G),
    h('h3', null, `World wonders (${Object.keys(G.wonders).length} of ${HX.WONDERS.length} built)`),
    h('div', { class: 'col' }, HX.WONDERS.map(wonderRow)),
    h('h3', null, 'Great projects'),
    h('div', { class: 'col' }, HX.PROJECTS.filter(B => G.cfg.victories[B.victory]).map(B => h('div', { class: 'wonder' + (HX.projectBuilt(G, UI.pid, B.key) ? ' mine' : P.techs.includes(B.tech) ? ' open' : '') }, h('div', { class: 'wg' }, B.glyph),
      h('div', { class: 'tx' }, h('div', { class: 'a' }, B.name), h('div', { class: 'b' }, B.desc), h('div', { class: 'c' }, HX.projectBuilt(G, UI.pid, B.key) ? 'Built' : P.techs.includes(B.tech) ? 'Available to build in a city' : `Needs ${TECHS[TECHI[B.tech]].name}`))))),
    h('div', { class: 'bar' }, h('button', { class: 'pri', onclick: back || backToMap }, 'Done'))));
}
// Finished games, newest first, kept on this device.
function recordHall(G, o) {
  const me = G.players[UI.pid], hall = Settings.get('hall') || [];
  if (hall.some(x => x.seed === G.seed && x.turn === o.turn && x.civ === CIVS[me.civ].key)) return;
  hall.unshift({ date: Date.now(), civ: CIVS[me.civ].key, won: o.winner === UI.pid, type: o.type, winner: CIVS[G.players[o.winner].civ].key, turn: o.turn,
    score: HX.scoreOf(G, UI.pid), size: G.cfg.size, difficulty: G.cfg.difficulty, seed: G.seed, humans: G.players.filter(P => P.human).length });
  Settings.set('hall', hall.slice(0, 30));
}
function showHall(back) {
  const hall = Settings.get('hall') || [], wins = hall.filter(x => x.won).length;
  showScreen(screen(
    h('h2', null, backBtn(back), 'Hall of Fame'),
    h('p', { class: 'note' }, hall.length ? `${hall.length} finished game${hall.length === 1 ? '' : 's'}, ${wins} won. Best score ${Math.max(...hall.map(x => x.score))}.` : 'Finish a game and it will be remembered here.'),
    h('div', { class: 'col' }, hall.map(x => { const civ = CIVS[CIVI[x.civ]] || CIVS[0];
      return h('div', { class: 'card codex' + (x.won ? ' gold' : '') }, h('div', { class: 'row' }, civEmblem(civ, 40), h('div', { class: 'grow' },
        h('b', null, (x.won ? '🏆 ' : '') + civ.name), h('div', { class: 's' }, `${x.won ? 'Won' : 'Lost to the ' + (CIVS[CIVI[x.winner]] || civ).name} · ${HX.victoryName(x.type)} · turn ${x.turn} · score ${x.score}`),
        h('div', { class: 's' }, `${MAPSIZE[x.size] ? MAPSIZE[x.size].name : x.size} map · ${(DIFFICULTY[x.difficulty] || {}).name || ''}${x.humans > 1 ? ' · pass and play' : ''} · ${fmtDate(x.date)} · seed ${x.seed}`)))); })),
    h('div', { class: 'bar' }, hall.length ? h('button', { class: 'danger', onclick: () => confirmDlg('Clear the Hall of Fame?', 'Every recorded game will be forgotten.', 'Clear', () => { Settings.set('hall', []); showHall(back); }, true) }, 'Clear') : null,
      h('button', { class: 'pri', onclick: back }, 'Done'))));
}
// Shown once when someone wins (or time runs out).
function showEndGame() {
  const G = UI.G, o = G.over; if (!o) return;
  o.seen = true;
  const won = o.winner === UI.pid, me = G.players[UI.pid];
  recordHall(G, o);
  Sound.play(won ? 'victory' : 'defeat');
  const title = won ? 'Victory!' : o.type === 'time' ? 'Time is up' : 'Defeat';
  const how = { domination: 'by holding every rival capital', science: 'by launching the Skyward Project', culture: 'by opening the Grand Exhibition', religion: 'by bringing their faith to every land', diplomacy: 'through a lasting web of alliances', score: 'with the highest score when time ran out', time: 'with the highest score when time ran out' }[o.type];
  const sub = won ? `You won ${how.replace('their faith', 'your faith')}, on turn ${o.turn}.` : `${knownName(G, o.winner)} won ${how}, on turn ${o.turn}.`;
  const ranks = HX.majorPlayers(G).slice().sort((a, b) => HX.scoreOf(G, b.id) - HX.scoreOf(G, a.id));
  showScreen(screen(
    h('div', { class: 'endhead ' + (won ? 'won' : 'lost') }, h('div', { class: 'big' }, won ? '🏆' : o.type === 'time' ? '⌛' : '🏳️'), h('h2', null, title), h('p', null, sub)),
    h('h3', null, 'Final standings'),
    h('div', { class: 'card' }, ranks.map((Q, i) => h('div', { class: 'reason' + (Q.id === UI.pid ? ' me' : '') }, h('span', null, `${i + 1}. ${CIVS[Q.civ].name}${Q.alive ? '' : ' (destroyed)'}`), h('b', null, String(HX.scoreOf(G, Q.id)))))),
    h('h3', null, 'How it went'), chartBlock(G),
    h('div', { class: 'grid2', style: 'margin-top:10px' },
      h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Cities'), h('div', { class: 'v' }, String(G.cities.filter(c => c.owner === UI.pid).length))),
      h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Technologies'), h('div', { class: 'v' }, `${me.techs.length}/${TECHS.length}`)),
      h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Wonders'), h('div', { class: 'v' }, String((me._wonders || []).length))),
      h('div', { class: 'kv' }, h('div', { class: 'k' }, 'Policies'), h('div', { class: 'v' }, String(me.policies.length)))),
    h('div', { class: 'bar' }, h('button', { onclick: () => { leaveGame(); showMainMenu(); } }, 'Main menu'),
      me.alive ? h('button', { class: 'pri', onclick: () => { o.cont = true; backToMap(); } }, 'Keep playing') : null)));
}
