// Late-game smoke test: every screen and panel on a big turn-180 empire. Run: node hexarch/tools/test-late.mjs

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
// use a local playwright if present, otherwise the global install
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const file = 'file://' + path.join(here, '../../docs/hexarch/index.html');
const shots = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok:', m); };
const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
await page.goto(file); await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  Settings.set('tips', false);
  const G = HX.makeGame({ size: 'huge', script: 'continents', rivals: 7, seed: 'late-smoke' });
  G.players[0].human = false;
  while (G.turn < 180 && !G.over) { HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G); }
  const best = HX.majorPlayers(G).filter(P => P.alive).sort((a, b) => G.cities.filter(c => c.owner === b.id).length - G.cities.filter(c => c.owner === a.id).length)[0].id;
  G.players[best].human = true; let guard = 0; while (G.active !== best && guard++ < 30) { HX.aiTakeTurn(G, G.active); HX.endPlayerTurn(G); }
  for (const Q of G.players) if (!Q.barbarian && !G.players[best].met.includes(Q.id) && Q.id !== best) G.players[best].met.push(Q.id);
  enterGame(G); window.__best = best;
  return { turn: G.turn, cities: G.cities.filter(c => c.owner === best).length, units: G.units.filter(u => u.owner === best).length };
});
console.log('late game:', JSON.stringify(info));
check(info.cities >= 3, 'player has an empire to test with');
const screens = ['showTech()', 'showEmpire()', 'showPolicies()', 'showReligion()', 'showDiplomacy()', 'showVictory()', 'showWorld()', 'showLog()', 'showCodex()', 'showHall(showMainMenu)', 'showPause()', 'showSettings(showPause)', 'showHelp(showPause)'];
for (const s of screens) {
  await page.evaluate(s => { closeScreens(); eval(s); }, s); await page.waitForTimeout(80);
  check(await page.evaluate(() => !!document.querySelector('#screens .screen') || !!document.querySelector('#modal').firstChild), 'screen opens: ' + s);
  await page.evaluate(() => closeModal());
}
const cityIds = await page.evaluate(() => HX.ownCities(UI.G, UI.pid).slice(0, 4).map(c => c.id));
for (const id of cityIds) { await page.evaluate(id => { closeScreens(); showCity(HX.cityById(UI.G, id)); }, id); await page.waitForTimeout(60); }
check(await page.isVisible('.screen .item'), 'city screen lists items late in the game');
// every own unit's panel, and the trade screen with each civ
const n = await page.evaluate(() => { closeScreens(); let k = 0; for (const u of UI.G.units.filter(x => x.owner === UI.pid)) { setSel({ k: 'unit', id: u.id }); k++; } return k; });
check(n > 0, `opened ${n} unit panels`);
await page.evaluate(() => { for (const Q of HX.majorPlayers(UI.G)) if (Q.id !== UI.pid && Q.alive) { showTrade(Q.id); } closeScreens(); });
// tile panels across the visible map and a few turns of play
await page.evaluate(() => { const G = UI.G; for (let t = 0; t < G._grid.N; t += 97) setSel({ k: 'tile', t }); setSel(null); });
for (let k = 0; k < 3; k++) { await page.evaluate(() => reallyEndTurn()); await page.waitForFunction(() => !UI.busy && UI.G.players[UI.G.active].human, null, { timeout: 60000 }); await page.evaluate(() => closeModal()); }
check(await page.evaluate(() => UI.G.turn >= 183), 'three late-game turns played through the UI');
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
check(!over, 'no horizontal overflow');
console.log(errors.length ? 'errors: ' + JSON.stringify(errors.slice(0, 5)) : 'no page errors');
check(!errors.length, 'no page errors');
await browser.close();
console.log(fails ? `${fails} failures` : 'all late-game checks passed');
process.exit(fails ? 1 : 0);
