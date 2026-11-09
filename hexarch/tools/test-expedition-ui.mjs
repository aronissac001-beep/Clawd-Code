// Drives an Expedition run in headless Chromium at iPhone 14 size.
// Run: node hexarch/tools/test-expedition-ui.mjs [screenshotDir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const file = 'file://' + path.join(here, '../../docs/hexarch/index.html');
const shots = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 2 : 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok:', m); };
const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };

await page.goto(file);
await page.evaluate(() => { localStorage.clear(); Settings.set('tips', false); Settings.set('heatMax', 3); });
await page.reload(); await page.waitForTimeout(300);
await page.tap('text=Expedition: a roguelike run');
await page.waitForSelector('.screen h2:has-text("Expedition")');
check(await page.locator('.heat button').count() === 7, 'seven heat levels shown');
check(await page.locator('.heat button[disabled]').count() === 3, 'locked heat levels are disabled');
await page.tap('.heat button:has-text("Searing")');
check(await page.locator('.card.curse').count() === 3, 'three curses listed at heat 3');
await shot('exp-01-setup');
await page.tap('button.civ.mini:has-text("Aurelian")');
await page.locator('.bar button:has-text("Set out")').tap(); await page.waitForTimeout(200); console.log('errs', errors);
await page.waitForTimeout(3000); await shot('exp-dbg'); console.log(await page.evaluate(() => ({ m: $('modal').innerHTML.slice(0, 300), d: UI.G && HX.pendingDraft(UI.G, UI.pid), busy: UI.busy })));
await page.waitForSelector('.dlg.draft', { timeout: 15000 });
check(await page.locator('.dlg.draft .boon').count() === 3, 'opening draft offers three boons');
await shot('exp-02-draft');
const picked = await page.locator('.dlg.draft .boon b').first().innerText();
await page.locator('.dlg.draft .boon').first().tap();
await page.waitForTimeout(600);
const st = await page.evaluate(() => ({ relics: UI.G.players[UI.pid].relics || [], iron: UI.G.cfg.ironman, heat: UI.G.cfg.expedition.heat, gold: UI.G.players[UI.pid].gold, ruins: UI.G.ruins.length }));
check(st.iron && st.heat === 3, 'game is an ironman expedition at heat 3');
console.log('   picked', picked, JSON.stringify(st));
// find our unit and a ruin, make the ruin known and move there via the engine, as a tap would
const res = await page.evaluate(() => {
  const G = UI.G, P = G.players[UI.pid], u = G.units.find(x => x.owner === UI.pid && !UNITS[x.type].civilian);
  const t = G.ruins.slice().sort((a, b) => G._grid.dist(u.tile, a) - G._grid.dist(u.tile, b))[0];
  for (const n of G._grid.within(t, 3)) P.explored[n] = 1;
  renderer.centerOn(t, false); renderer.request();
  return { t, d: G._grid.dist(u.tile, t) };
});
await page.waitForTimeout(400);
await shot('exp-03-ruin');
await page.tap('#btnMenu');
await page.waitForTimeout(200);
const pause = await page.locator('.screen h2:has-text("Paused")').count(); check(pause === 1, 'pause menu opens');
if (pause) {
  check(!(await page.isVisible('.screen button:has-text("Save game")')), 'no manual save in ironman');
  await page.tap('text=Empire and relics');
  await page.waitForTimeout(200);
  check(await page.isVisible('text=Expedition, Heat 3'), 'empire screen shows relics section');
  await shot('exp-04-empire');
  await page.tap('.screen .bar button:has-text("Back to map")');
}
// autosave goes to the run slot
const slot = await page.evaluate(() => !!Saves.meta(Saves.RUN));
check(slot, 'expedition saves to its own slot');
// codex world tab lists relics
await page.evaluate(() => showCodex(backToMap, 'world'));
check(await page.locator('.codex:has-text("Blood Crown")').count() === 1, 'codex lists relics');
await page.evaluate(() => backToMap());
check(!errors.length, 'no page errors ' + JSON.stringify(errors));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all expedition UI checks passed');
process.exit(fails ? 1 : 0);
