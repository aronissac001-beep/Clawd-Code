// Drives an Expedition run in headless Chromium at iPhone 14 size.
// Run: node games/exodus/tools/test-expedition-ui.mjs [screenshotDir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const file = 'file://' + path.join(here, '../../../docs/exodus/index.html');
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
await page.tap('text=Odyssey: a roguelike run');
await page.waitForSelector('.screen h2:has-text("Odyssey")');
check(await page.locator('.heat button').count() === 7, 'seven Peril levels shown');
check(await page.locator('.heat button[disabled]').count() === 3, 'locked Peril levels are disabled');
await page.tap('.heat button:has-text("Grim")');
check(await page.locator('.card.curse').count() === 3, 'three perils listed at Peril 3');
await shot('exp-01-setup');
await page.tap('button.civ.mini:has-text("Kestrel")');
await page.locator('.bar button:has-text("Set out")').tap(); await page.waitForTimeout(200);
await page.waitForSelector('.dlg.draft', { timeout: 15000 });
check(await page.locator('.dlg.draft .boon').count() === 3, 'landfall draft offers three boons');
await shot('exp-02-draft');
const picked = await page.locator('.dlg.draft .boon b').first().innerText();
await page.locator('.dlg.draft .boon').first().tap();
await page.waitForSelector('.dlg h4:has-text("Choose where the ark comes down")', { timeout: 5000 });
check(true, 'landfall follows the boon draft');
await page.locator('.landcard button:has-text("Land here")').first().tap();
await page.waitForTimeout(600);
const st = await page.evaluate(() => ({ relics: UI.G.players[UI.pid].relics || [], iron: UI.G.cfg.ironman, heat: UI.G.cfg.expedition.heat, gold: UI.G.players[UI.pid].gold, ruins: UI.G.ruins.length }));
check(st.iron && st.heat === 3, 'game is an ironman Odyssey at Peril 3');
console.log('   picked', picked, JSON.stringify(st));
// find our unit and a supply pod, make the ruin known and move there via the engine, as a tap would
const res = await page.evaluate(() => {
  const G = UI.G, P = G.players[UI.pid], u = G.units.find(x => x.owner === UI.pid && !UNITS[x.type].civilian);
  const t = G.ruins.slice().sort((a, b) => G._grid.dist(u.tile, a) - G._grid.dist(u.tile, b))[0];
  for (const n of G._grid.within(t, 3)) P.explored[n] = 1;
  renderer.centerOn(t, false); renderer.request();
  return { t, d: G._grid.dist(u.tile, t) };
});
await page.waitForTimeout(400);
await shot('exp-03-pod');
await page.tap('#btnMenu');
await page.waitForTimeout(200);
const pause = await page.locator('.screen h2:has-text("Paused")').count(); check(pause === 1, 'pause menu opens');
if (pause) {
  check(!(await page.isVisible('.screen button:has-text("Save game")')), 'no manual save in ironman');
  await page.tap('text=Faction and artifacts');
  await page.waitForTimeout(200);
  check(await page.isVisible('text=Odyssey, Peril 3'), 'empire screen shows the artifacts section');
  await shot('exp-04-empire');
  await page.tap('.screen .bar button:has-text("Back to map")');
}
// a quest offer appears as a dialog; accepting shows the quest button with progress
await page.evaluate(() => { HX.offerQuest(UI.G, UI.pid); showPendingEvent(); });
await page.waitForSelector('.dlg.draft .boon');
await shot('exp-06-quest');
await page.locator('.dlg.draft .boon').first().tap();
await page.waitForTimeout(400);
check(await page.isVisible('#btnQuest') && /\d+\/\d+/.test(await page.locator('#btnQuest .qn').innerText()), 'directive button shows progress');
await page.tap('#btnQuest'); await page.waitForTimeout(200);
check(await page.isVisible('text=Current directive'), 'directive details open');
await shot('exp-07-questdlg');
await page.tap('.dlg button:has-text("OK")');
// autosave goes to the run slot
const slot = await page.evaluate(() => !!Saves.meta(Saves.RUN));
check(slot, 'the Odyssey saves to its own slot');
// codex Veyra tab lists artifacts
await page.evaluate(() => showCodex(backToMap, 'world'));
check(await page.locator('.codex:has-text("Hungering Crystal")').count() === 1, 'codex lists artifacts');
await page.evaluate(() => backToMap());
// winning the run shows the run score, records it and unlocks the next Heat level
await page.evaluate(() => { const G = UI.G; G.over = { winner: UI.pid, type: 'score', turn: G.turn }; showEndGame(); });
await page.waitForTimeout(300);
check(await page.isVisible('text=Run score'), 'end screen shows the run score');
await shot('exp-05-end');
const after = await page.evaluate(() => ({ heat: Settings.get('heatMax'), hall: (Settings.get('hall') || [])[0] }));
check(after.heat === 4 && after.hall && after.hall.heat === 3 && after.hall.runScore > 0, 'a win unlocks Peril 4 and is in the Hall of Fame');
check(!errors.length, 'no page errors ' + JSON.stringify(errors));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'all Odyssey UI checks passed');
process.exit(fails ? 1 : 0);
