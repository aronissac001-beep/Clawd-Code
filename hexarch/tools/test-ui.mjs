// Drives the built page in headless Chromium at iPhone 14 size (390x844, DPR 3, touch).
// Run: node hexarch/tools/test-ui.mjs [screenshotDir]
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

await page.goto(file);
await page.waitForTimeout(300);
check(await page.isVisible('text=New game'), 'main menu shows');
await shot('01-menu');
await page.tap('text=New game');
await page.waitForTimeout(150);
await shot('02-newgame');
check(await page.isVisible('text=Your civilization'), 'new game screen');
await page.tap('button.civ:has-text("Verdant Circle")');
await page.tap('.seg button:has-text("Small")');
await page.fill('input[type=text]', 'amber-falcon-417');
await page.tap('text=Start game');
await page.waitForSelector('#hud:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(500);
await shot('03-start');
check(await page.evaluate(() => CIVS[UI.G.players[UI.pid].civ].key) === 'verdant', 'chosen civ is used');
check(await page.isVisible('#sel'), 'a unit is selected at game start');

// all tap targets in the HUD are at least 44x44
const small = await page.evaluate(() => Array.from(document.querySelectorAll('#hud button')).filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.textContent, r.width, r.height]; }).filter(([, w, hh]) => w < 44 || hh < 44));
check(small.length === 0, 'HUD buttons are at least 44pt: ' + JSON.stringify(small));

// found the capital with the settler
const st = await page.evaluate(() => { const u = UI.G.units.find(x => x.owner === UI.pid && x.type === 'settler'); setSel({ k: 'unit', id: u.id }, true); return HX.canFoundCity(UI.G, u); });
await page.waitForTimeout(400);
if (st.ok) { await page.tap('#sel button:has-text("Found city")'); await page.waitForTimeout(500); }
check(await page.evaluate(() => UI.G.cities.some(c => c.owner === UI.pid)), 'capital founded via button');
await shot('04-city');

// tap-to-move: select the militia, tap a reachable tile twice
const moved = await page.evaluate(async () => {
  const G = UI.G, u = G.units.find(x => x.owner === UI.pid && x.type === 'militia');
  setSel({ k: 'unit', id: u.id }, true);
  await new Promise(r => setTimeout(r, 400));
  const reach = HX.reachableTiles(G, u);
  if (!reach.length) return { skipped: true };
  const t = reach[reach.length - 1], [x, y] = renderer.posOf(t);
  return { t, x, y, from: u.tile, id: u.id };
});
if (!moved.skipped) {
  await page.touchscreen.tap(moved.x, moved.y);
  await page.waitForTimeout(150);
  check(await page.isVisible('#sel button:has-text("Move here")'), 'first tap shows route preview');
  await shot('05-preview');
  await page.touchscreen.tap(moved.x, moved.y);
  await page.waitForTimeout(700);
  const now = await page.evaluate(id => HX.unitById(UI.G, id).tile, moved.id);
  check(now === moved.t, 'second tap moves the unit');
}

// pan by dragging and zoom with a pinch (simulated via CDP touch events)
const cam0 = await page.evaluate(() => ({ ...renderer.cam }));
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
await touch('touchStart', [[200, 400]]);
for (let k = 1; k <= 10; k++) await touch('touchMove', [[200 - k * 12, 400 - k * 6]]);
await touch('touchEnd', []);
await page.waitForTimeout(300);
const cam1 = await page.evaluate(() => ({ ...renderer.cam }));
check(Math.abs(cam1.x - cam0.x) > 30, 'drag pans the camera');
await touch('touchStart', [[150, 420], [240, 420]]);
for (let k = 1; k <= 10; k++) await touch('touchMove', [[150 - k * 6, 420], [240 + k * 6, 420]]);
await touch('touchEnd', []);
await page.waitForTimeout(300);
const cam2 = await page.evaluate(() => ({ ...renderer.cam }));
check(cam2.z > cam1.z * 1.3, `pinch zooms in (${cam1.z.toFixed(2)} -> ${cam2.z.toFixed(2)})`);
await shot('06-zoomed');

// explore with the scout, then play turns through the research and production prompts
await page.evaluate(() => { const u = UI.G.units.find(x => x.owner === UI.pid && x.type === 'scout'); if (u) { setSel({ k: 'unit', id: u.id }); doOrder(u, 'explore'); } });
await page.waitForTimeout(800);
check((await page.textContent('#btnEnd')).includes('Choose'), 'end turn asks for research or production first');
await page.evaluate(() => { Settings.set('confirmEnd', false); });
let sawTech = false, sawCity = false;
for (let k = 0; k < 40 && (await page.evaluate(() => UI.G.turn)) < 13; k++) {
  const label = await page.textContent('#btnEnd');
  await page.tap('#btnEnd');
  if (label.includes('Choose research')) {
    await page.waitForSelector('.tech.avail');
    if (!sawTech) { sawTech = true; await shot('10-research'); }
    await page.tap('.tech.avail >> nth=0');
    await page.tap('.screen .bar button:has-text("Done")');
  } else if (label.includes('Choose production')) {
    await page.waitForSelector('.screen .item');
    if (!sawCity) { sawCity = true; await shot('11-city'); }
    const want = await page.evaluate(() => UI.G.turn < 4 ? 'Builder' : 'Monument');
    const btn = page.locator(`.screen .item:has-text("${want}")`);
    if (await btn.count()) await btn.first().tap(); else await page.locator('.screen .item').first().tap();
    await page.tap('.screen .bar button:has-text("Back to map")');
  } else {
    await page.waitForFunction(() => !UI.busy, null, { timeout: 15000 });
  }
  await page.waitForTimeout(60);
}
check(sawTech && sawCity, 'research and production screens reached from the end turn button');
const turn = await page.evaluate(() => UI.G.turn);
check(turn >= 13, 'turns pass with choices made (turn ' + turn + ')');
check(await page.evaluate(() => UI.G.players[UI.pid].techs.length >= 1), 'research completes');

// builder: put it on an improvable tile and build
const built = await page.evaluate(async () => {
  const G = UI.G, P = G.players[UI.pid];
  for (const k of ['agriculture', 'mining', 'construction', 'hunting', 'pottery', 'animal_husbandry', 'calendar', 'masonry', 'sailing']) if (!P.techs.includes(k)) P.techs.push(k);
  let u = G.units.find(x => x.owner === UI.pid && x.type === 'builder');
  const city = HX.ownCities(G, UI.pid)[0];
  const t = city.tiles.find(x => HX.improvementFor(G, UI.pid, x).imp && !G._civ.has(x));
  if (!t) return 'no tile';
  if (!u) u = spawnUnit(G, 'builder', UI.pid, t); else placeUnit(G, u, t);
  u.moves = 12; setSel({ k: 'unit', id: u.id }, true);
  return HX.improvementFor(G, UI.pid, t).imp;
});
await page.waitForTimeout(400);
await shot('12-builder');
const impBtn = page.locator('#sel .acts button.pri');
check(await impBtn.count() > 0, 'builder shows an improvement button (' + built + ')');
if (await impBtn.count()) {
  await impBtn.first().tap(); await page.waitForTimeout(200);
  check(await page.evaluate(() => { let n = 0; for (const v of UI.G.map.improv) if (v) n++; return n; }) >= 1, 'improvement built from the panel');
}

// city panel and buy
await page.evaluate(() => { const c = HX.ownCities(UI.G, UI.pid)[0]; UI.G.players[UI.pid].gold = 500; setSel({ k: 'city', id: c.id, t: c.tile }, true); });
await page.waitForTimeout(300);
await shot('13-citypanel');
check(await page.isVisible('#sel button:has-text("Open city")'), 'city panel offers Open city');
const before = await page.evaluate(() => UI.G.players[UI.pid].gold);
const buyBtn = page.locator('#sel button:has-text("Buy")');
if (await buyBtn.count() && await buyBtn.isEnabled()) { await buyBtn.tap(); await page.waitForTimeout(150); check(await page.evaluate(() => UI.G.players[UI.pid].gold) < before, 'buying spends gold'); }
await page.tap('#stGold'); await page.waitForSelector('.screen h3:has-text("Happiness")');
await shot('14-empire');
check(await page.isVisible('.cityrow'), 'empire screen lists cities');
await page.tap('.screen .bar button:has-text("Back to map")');
check(await page.evaluate(() => UI.G.cities.length) >= 4, 'rivals founded their capitals');
await page.evaluate(() => { renderer.cam.z = 0.5; renderer.request(); });
await page.waitForTimeout(300);
await shot('07-turn7-zoomedout');

// pause, save to slot 1, load it back
await page.tap('#btnMenu');
await page.tap('text=Save game');
await page.tap('.slot >> nth=0 >> button');
await page.waitForTimeout(200);
check(await page.evaluate(() => !!Saves.meta('m1')), 'manual save written');
await page.tap('.screen h2 button');
await shot('08-pause');
await page.tap('text=Quit to main menu');
await page.tap('.dlg button:has-text("Quit")');
await page.waitForTimeout(200);
check(await page.isVisible('text=Continue'), 'continue offered after quitting');
await page.tap('text=Load game');
await page.tap('.slot:has-text("Slot 1") button:has-text("Load")');
await page.waitForSelector('#hud:not([hidden])');
check(await page.evaluate(t => UI.G.turn === t, turn), 'loaded game resumes at the saved turn');

// export / import round trip through the dialog
const exported = await page.evaluate(() => HX.serializeGame(UI.G));
await page.tap('#btnMenu'); await page.tap('text=Load game'); await page.tap('text=Import save from text');
await page.fill('.dlg textarea', exported);
await page.tap('.dlg button:has-text("Load")');
await page.waitForSelector('#hud:not([hidden])');
check(await page.evaluate(s => HX.serializeGame(UI.G) === s, exported), 'import restores the exact game');

// settings screen renders and toggles persist
await page.tap('#btnMenu'); await page.tap('.screen button:has-text("Settings")');
await shot('09-settings');
await page.tap('.toggle:has-text("Hex grid") .sw2');
check(await page.evaluate(() => Settings.get('grid') === false && JSON.parse(localStorage.getItem('hexarch.settings')).grid === false), 'setting persists');

// no horizontal overflow on any screen
const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check(!over, 'no horizontal overflow');
check(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
await browser.close();
console.log(fails ? `${fails} UI failures` : 'all UI checks passed');
process.exit(fails ? 1 : 0);
