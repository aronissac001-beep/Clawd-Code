// Headless checks for ruins, relics and Expedition mode. Run: node hexarch/tools/test-rogue.mjs
import { loadEngine } from './load-engine.mjs';
const { HX, ev } = loadEngine();
const UNITS = ev('UNITS'), polFx = ev('polFx');
let fails = 0;
const check = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } else console.log('ok:', msg); };
const majors = G => G.players.filter(P => !P.barbarian && !P.minor);

// 1. Ruins are placed, spaced out, away from starts, on passable land; the same seed gives the same ruins.
{
  const A = HX.makeGame({ size: 'medium', seed: 'ruin-a', rivals: 3 }), B = HX.makeGame({ size: 'medium', seed: 'ruin-a', rivals: 3 });
  check(A.ruins.length >= 10, `medium map has ruins (${A.ruins.length})`);
  check(JSON.stringify(A.ruins) === JSON.stringify(B.ruins), 'ruins are deterministic per seed');
  const g = A._grid, starts = majors(A).map(P => A.units.find(u => u.owner === P.id && u.type === 'settler').tile);
  check(A.ruins.every(t => starts.every(s => g.dist(s, t) >= 4)), 'ruins are away from starts');
  check(A.ruins.every((t, i) => A.ruins.every((o, j) => i === j || g.dist(t, o) >= 6)), 'ruins are spaced apart');
  const off = HX.makeGame({ size: 'medium', seed: 'ruin-a', rivals: 3, ruins: false });
  check(off.ruins.length === 0, 'ruins can be turned off');
  // same land with and without ruins
  check(Buffer.from(off.map.terrain).equals(Buffer.from(A.map.terrain)), 'ruins do not change the map');
}

// 2. Stepping on a ruin gives a reward and removes it; save/load keeps the ruins.
{
  const G = HX.makeGame({ size: 'small', seed: 'ruin-b', rivals: 2 });
  const u = G.units.find(x => x.owner === 0 && x.type === 'scout');
  const t = G.ruins[0], before = G.ruins.length;
  // teleport next to the ruin and walk in
  const nb = G._grid.neighbors(t).find(n => ev('passableTerrain')(G, n) && HX.stepCost(G, u, n, t) < Infinity && !HX.unitsAt(G, n).length);
  G._mil.delete(u.tile); u.tile = nb; G._mil.set(nb, u); G.players[0].explored[t] = 1; u.moves = 3 * ev('MP');
  const gold = G.players[0].gold, logN = G.log.length;
  HX.issueMove(G, u, t);
  check(G.ruins.length === before - 1 && !HX.ruinAt(G, t), 'ruin is consumed');
  check(G.log.slice(logN).some(e => /Ancient ruins!/.test(e.msg)), 'ruin reward is logged');
  check((G.players[0].stats.ruins || 0) === 1, 'ruin count recorded');
  const G2 = HX.deserializeGame(HX.serializeGame(G));
  check(JSON.stringify(G2.ruins) === JSON.stringify(G.ruins), 'ruins survive save and load');
}

// 3. Every reward type runs without error, many times.
{
  let n = 0; const kinds = {};
  for (let s = 0; s < 40; s++) {
    const G = HX.makeGame({ size: 'small', seed: 'ruin-c' + s, rivals: 2 });
    G.turn = 30; // allow ambushes
    for (const t of G.ruins.slice(0, 6)) {
      const u = HX.unitById(G, G.units.find(x => x.owner === 0 && x.type === 'militia').id);
      G._mil.delete(u.tile); u.tile = t; G._mil.set(t, u);
      const r = ev('enterRuin')(G, u); if (r) { n++; r.keys.forEach(k => kinds[k] = (kinds[k] || 0) + 1); }
      if (!G.units.includes(u)) break;
    }
  }
  console.log('   rewards:', JSON.stringify(kinds));
  check(n > 150 && Object.keys(kinds).length >= 9, `reward table covered (${n} ruins, ${Object.keys(kinds).length} kinds)`);
}

// 4. Relics change yields through polFx.
{
  const G = HX.makeGame({ size: 'small', seed: 'relic-a', rivals: 2 });
  const P = G.players[0];
  const before = polFx(P).sciPct || 0;
  HX.grantRelic(G, 0, 'star_chart');
  check((polFx(P).sciPct || 0) === before + 10, 'Star Chart adds +10% science');
  check(!HX.grantRelic(G, 0, 'star_chart'), 'a relic is granted only once');
  check(!HX.relicsLeft(G, 1, true).some(r => r.key === 'star_chart'), 'a relic exists once in the world');
}

// 5. Expedition: curses, opening draft, era drafts, and a full run without errors.
{
  const G = HX.makeGame({ size: 'small', seed: 'exp-a', rivals: 2, difficulty: 1, expedition: { heat: 6 } });
  const P = G.players[0];
  check(G.cfg.ironman === true, 'expedition is ironman');
  check(G.cfg.barbarians === 'raging', 'heat 1 makes barbarians rage');
  check(G.cfg.difficulty === 2, 'heat 2 raises difficulty');
  check(majors(G).length === 4, 'heat 5 adds a rival');
  check(P.gold === 0 && !G.units.some(u => u.owner === 0 && u.type === 'scout'), 'heat 3 lean start');
  check((polFx(P).happy || 0) <= -2, 'heat 4 dark omens');
  check(G.units.filter(u => u.owner === 1 && UNITS[u.type] && !UNITS[u.type].civilian).length >= 3, 'heat 6 iron rivals');
  check(HX.runMultiplier(G) === 2.5, 'run multiplier 2.5 at heat 6');
  const d = HX.pendingDraft(G, 0);
  check(d && d.choices.length === 3, 'opening draft offers three choices');
  check(HX.resolveDraft(G, 0, 0) && !HX.pendingDraft(G, 0), 'draft resolves');
  let drafts = 1, errs = 0;
  try {
    while (!G.over && G.turn < 220) {
      if (G.active === 0) { while (HX.pendingDraft(G, 0)) { HX.resolveDraft(G, 0, G.turn % 3); drafts++; } if (HX.pendingEvent(G, 0)) HX.resolveEvent(G, 0, 0);
        for (const c of G.cities) if (c.owner === 0) c.auto = true; // a human on autopilot
        if (!P.research) { const k = ev('aiBestResearch')(G, 0, false); if (k) ev('setResearch')(G, 0, k); } }
      const me = G.active === 0; if (me) P.human = false; HX.aiTakeTurn(G, G.active); if (me) P.human = true; HX.endPlayerTurn(G);
    }
  } catch (e) { errs++; console.log(e.stack); }
  check(!errs, 'expedition plays to turn 220 without errors');
  check(drafts >= 3, `era drafts happen (${drafts} drafts, era ${HX.playerEra(P)}, relics ${(P.relics || []).join(',')})`);
  check(G.ruins.length < 9, `ruins get explored (${G.ruins.length} left)`);
  const G2 = HX.deserializeGame(HX.serializeGame(G));
  check(JSON.stringify(G2.players[0].relics) === JSON.stringify(P.relics) && G2.cfg.expedition.heat === 6, 'expedition state survives save and load');
}

// 6. AI-only games still finish and pop ruins.
{
  const G = HX.makeGame({ size: 'small', seed: 'ai-ruins', rivals: 3 }, { allAI: true });
  while (G.turn <= 80) { HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G); }
  const popped = majors(G).reduce((a, P) => a + (P.stats.ruins || 0), 0);
  check(popped >= 5, `AIs explore ruins (${popped} by turn 80)`);
}
console.log(fails ? `${fails} FAILED` : 'all rogue checks passed');
process.exit(fails ? 1 : 0);
