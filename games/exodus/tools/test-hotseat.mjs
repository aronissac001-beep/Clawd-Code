// Hotseat: two players share the phone. Run: node games/exodus/tools/test-hotseat.mjs [screenshotDir]

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
// use a local playwright if present, otherwise the global install
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const file = 'file://' + path.join(here, '../../../docs/exodus/index.html');
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
await page.evaluate(() => { Settings.set('tips', false); Settings.set('confirmEnd', false); });
await page.tap('text=New game'); await page.waitForTimeout(150);
await page.tap('.seg button:has-text("Small")');
await page.locator('.stepper').first().locator('button:has-text("+")').tap();
check(await page.isVisible('select[aria-label="Player 2 faction"]'), 'second player can pick a faction');
await page.selectOption('select[aria-label="Player 2 faction"]', 'tidecall');
await page.fill('input[type=text]', 'hotseat-1');
await page.tap('text=Start game');
await page.waitForSelector('#hud:not([hidden])', { timeout: 10000 }); await page.waitForTimeout(400);
check(await page.evaluate(() => UI.G.players.filter(P => P.human).length === 2 && CIVS[UI.G.players[1].civ].key === 'tidecall'), 'two human players, second is Tidecall');
check(await page.evaluate(() => UI.pid === 0), 'player 1 starts');
await page.evaluate(() => reallyEndTurn());
await page.waitForSelector('.curtain', { timeout: 10000 });
await shot('h1-curtain');
check(await page.isVisible('.curtain h2:has-text("Tidecall")'), 'curtain names the next player');
check(await page.evaluate(() => !document.querySelector('#map').checkVisibility || getComputedStyle(document.querySelector('.screen.curtain')).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'curtain hides the map');
await page.tap('.curtain button:has-text("Start my turn")'); await page.waitForTimeout(900);
check(await page.evaluate(() => UI.pid === 1 && UI.G.active === 1), 'player 2 takes over');
check(await page.isVisible('.dlg h4:has-text("Choose where the ark comes down")'), 'player 2 chooses their own landing site');
await shot('h2-landfall');
await page.locator('.landcard button:has-text("Land here")').first().tap(); await page.waitForTimeout(300);
check(await page.evaluate(() => UI.G.players[1].landed && !UI.G.players[0].landed), 'only player 2 has landed');
check(await page.evaluate(() => UI.G.players[1].loadout && UI.G.players[0].loadout), 'both players have an ark loadout');
check(await page.evaluate(() => UI.G.units.filter(u => u.owner === 1).every(u => UI.G.players[1]._vis[u.tile])), 'player 2 sees their own units');
await page.evaluate(() => reallyEndTurn());
await page.waitForSelector('.curtain', { timeout: 15000 });
check(await page.evaluate(() => UI.G.turn === 2 && UI.G.active === 0), 'back to player 1 on turn 2 after the rivals moved');
await page.tap('.curtain button:has-text("Start my turn")'); await page.waitForTimeout(900);
check(await page.isVisible('.dlg h4:has-text("Choose where the ark comes down")'), 'player 1 is offered landfall again');
await page.evaluate(() => closeModal());
// a deal offered to the other human waits for their turn
await page.evaluate(() => { const G = UI.G; G.players[0].met.push(1); G.players[1].met.push(0); G.players[0].gold = 100; });
await page.tap('#btnDip'); await page.waitForSelector('.screen h2:has-text("Diplomacy")');
await page.locator('.relcard', { hasText: 'Tidecall' }).locator('button:has-text("Trade")').tap();
await page.tap('.chip.add:has-text("💠 25")');
await page.tap('.screen button:has-text("Send offer")'); await page.waitForTimeout(150);
check(await page.evaluate(() => UI.G.offers.some(o => o.from === 0 && o.to === 1 && o.kind === 'deal')), 'offer to another player is queued');
await page.tap('.screen .bar button:has-text("Done")').catch(() => {});
console.log(errors.length ? 'errors: ' + JSON.stringify(errors) : 'no page errors');
check(!errors.length, 'no page errors');
await browser.close();
console.log(fails ? `${fails} failures` : 'all hotseat checks passed');
process.exit(fails ? 1 : 0);
