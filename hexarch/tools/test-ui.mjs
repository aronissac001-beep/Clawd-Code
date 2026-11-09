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
await page.waitForTimeout(500);
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
// tile management on the map
await page.evaluate(() => { const c = HX.ownCities(UI.G, UI.pid)[0]; showCity(c); });
await page.tap('button:has-text("Manage tiles")');
await page.waitForSelector('#sel.manage');
await page.waitForTimeout(400);
await shot('15-manage');
const pin = await page.evaluate(() => { const c = HX.cityById(UI.G, UI.manage); const t = HX.workableTiles(UI.G, c).find(x => !c.worked.includes(x)) ?? HX.workableTiles(UI.G, c)[0]; const [x, y] = renderer.posOf(t); return { t, x, y }; });
await page.touchscreen.tap(pin.x, pin.y); await page.waitForTimeout(150);
check(await page.evaluate(t => HX.cityById(UI.G, UI.manage).locked.includes(t), pin.t), 'tapping a tile on the map pins it');
await page.tap('#sel button:has-text("Done")');
await page.waitForSelector('.screen h2');
check(await page.isVisible('text=pinned'), 'city screen reports pinned tiles');
await page.tap('.screen .bar button:has-text("Back to map")');

// policies from the floating button
await page.evaluate(() => { UI.G.players[UI.pid].culturePool = 500; updateHUD(); });
check(await page.isVisible('#btnPolicy .pip'), 'policy badge shows when one is affordable');
await page.tap('#btnPolicy');
await page.waitForSelector('.pol.ready');
await shot('16-policies');
await page.tap('.pol.ready >> nth=0'); await page.tap('.dlg button:has-text("Adopt")');
check(await page.evaluate(() => UI.G.players[UI.pid].policies.length === 1), 'adopt a policy from the screen');
await page.tap('.screen .bar button:has-text("Done")');

// lens, world map, log
await page.tap('#btnLens'); await page.waitForTimeout(200);
check(await page.evaluate(() => Settings.get('lens') === 'yields'), 'yields lens toggles');
await shot('17-lens');
await page.tap('#btnLens'); await page.waitForTimeout(100);
check(await page.evaluate(() => Settings.get('lens') === 'religion'), 'lens cycles to religion');
await page.tap('#btnLens');

// religion: pantheon, prophet founding, faith purchases
await page.evaluate(() => { const P = UI.G.players[UI.pid]; for (const k of ['mysticism', 'philosophy', 'theology', 'hunting', 'writing', 'pottery']) if (!P.techs.includes(k)) P.techs.push(k); P.faith = 400; updateHUD(); });
check(await page.isVisible('#btnFaith .pip'), 'faith badge shows when a pantheon is affordable');
await page.tap('#btnFaith');
await page.waitForSelector('.screen h2:has-text("Religion")');
await page.locator('.belief:not([disabled])').first().tap();
await page.tap('.dlg button:has-text("Choose")');
check(await page.evaluate(() => !!UI.G.players[UI.pid].pantheon), 'pick a pantheon from the religion screen');
await page.tap('.screen .bar button:has-text("Done")');
await page.evaluate(() => { const G = UI.G, c = HX.ownCities(G, UI.pid)[0]; G.players[UI.pid].faith = 1000; checkProphet(G, UI.pid); const u = G.units.find(x => x.owner === UI.pid && x.type === 'prophet'); placeUnit(G, u, c.tile); u.moves = 12; setSel({ k: 'unit', id: u.id }, true); });
await page.waitForTimeout(300);
await page.tap('#sel button:has-text("Found religion")');
await page.waitForSelector('.screen h2:has-text("Found a religion")');
await page.locator('.belief:not([disabled])').nth(0).tap();
await page.locator('.belief:not([disabled])').nth(6).tap();
await shot('19-found');
await page.tap('.screen .bar button:has-text("Found religion")');
check(await page.evaluate(() => UI.G.players[UI.pid].religion !== null && UI.G.religions.length === 1), 'found a religion through the dialog');
check(await page.evaluate(() => { const c = HX.ownCities(UI.G, UI.pid)[0]; return HX.cityReligion(UI.G, c).major === UI.G.players[UI.pid].religion; }), 'holy city follows the new religion');
await page.evaluate(() => showCity(HX.ownCities(UI.G, UI.pid)[0]));
await page.waitForSelector('.screen h3:has-text("Buy with faith")');
await shot('21-cityfaith');
const nMiss = await page.evaluate(() => UI.G.units.filter(u => u.type === 'missionary').length);
await page.locator('.screen .item:has-text("Missionary")').first().tap();
check(await page.evaluate(n => UI.G.units.filter(u => u.type === 'missionary').length === n + 1, nMiss), 'buy a Missionary with faith');
await page.tap('.screen .bar button:has-text("Back to map")');
await page.tap('#btnFaith'); await page.waitForSelector('.relcard');
await shot('22-religion');
await page.tap('.screen .bar button:has-text("Done")');
await page.tap('#btnWorld'); await page.waitForSelector('.worldwrap canvas');
await shot('18-world');
const wb = await page.locator('.worldwrap canvas').boundingBox();
await page.touchscreen.tap(wb.x + wb.width * 0.3, wb.y + wb.height * 0.5);
check(await page.evaluate(() => !document.querySelector('.worldwrap')), 'tapping the world map jumps and closes');
await page.evaluate(() => showLog()); await page.waitForSelector('.screen h2:has-text("Event log")');
check(await page.locator('.logrow').count() > 0, 'event log lists events');
await page.tap('.screen .bar button:has-text("Back")');

// combat: meet a rival, declare war from Rivals, preview and attack by tapping
const setup = await page.evaluate(() => {
  const G = UI.G, me = UI.pid, them = HX.majorPlayers(G).find(P => P.id !== me);
  const P = G.players[me]; if (!P.met.includes(them.id)) { P.met.push(them.id); them.met.push(me); }
  const c = HX.ownCities(G, me)[0], g = G._grid;
  const spots = g.within(c.tile, 3).filter(t => passableTerrain(G, t) && !G._mil.has(t) && !G._cityAt.has(t) && !G._civ.has(t) && g.dist(t, c.tile) >= 1);
  let pair = null;
  for (const a of spots) { const b = spots.find(x => g.dist(a, x) === 1 && g.dist(x, c.tile) <= 2); if (b !== undefined && a !== b) { pair = [a, b]; break; } }
  const mine = spawnUnit(G, 'swordsman', me, pair[0]); mine.moves = 12;
  const foe = spawnUnit(G, 'militia', them.id, pair[1]);
  HX.computeVisibility(G, me); setSel({ k: 'unit', id: mine.id }, true);
  return { them: them.id, foeTile: foe.tile, foeId: foe.id, mine: mine.id };
});
await page.waitForTimeout(400);
let fp = await page.evaluate(t => renderer.posOf(t), setup.foeTile);
await page.touchscreen.tap(fp[0], fp[1]); await page.waitForTimeout(150);
check(await page.isVisible('#sel button:has-text("Declare war")'), 'tapping a unit at peace offers to declare war');
await page.tap('#sel button:has-text("Cancel")');
// diplomacy: an AI offer waits in the inbox
const gold0 = await page.evaluate(t => { const G = UI.G; G.players[t].gold = 300; G.players[UI.pid].gold = 400; G.offers.push({ id: G.nextId++, kind: 'deal', from: t, to: UI.pid, items: [{ by: t, kind: 'gold', amount: 40 }], turn: G.turn }); updateHUD(); return G.players[UI.pid].gold; }, setup.them);
check(await page.isVisible('#btnDip .pip'), 'diplomacy button shows a dot for a waiting offer');
await page.tap('#btnDip'); await page.waitForSelector('.screen h2:has-text("Diplomacy")');
await shot('23-diplomacy');
await page.tap('.offer button:has-text("Accept")'); await page.waitForTimeout(100);
check(await page.evaluate(g => UI.G.players[UI.pid].gold === g + 40, gold0), 'accepting an AI deal moves the gold');
await page.tap('.screen button.att'); check(await page.isVisible('.screen .why'), 'attitude reasons expand');
// trade builder: ask for open borders, pay what they want
await page.tap('.relcard .rowbtns button:has-text("Trade")'); await page.waitForSelector('.screen h2:has-text("Trade with")');
await page.tap('.chip.add:has-text("Open borders")'); await page.waitForTimeout(100);
check(await page.isVisible('.verdict.ok, .verdict.no'), 'trade screen shows a live verdict');
if (await page.isVisible('.screen .bar button:has-text("gold")')) await page.tap('.screen .bar button:has-text("gold")');
await shot('26-trade');
if (await page.isEnabled('.screen button:has-text("Propose deal")')) {
  await page.tap('.screen button:has-text("Propose deal")'); await page.waitForTimeout(100);
  check(await page.evaluate(t => HX.hasOB(UI.G, UI.pid, t), setup.them), 'open borders deal goes through');
} else { console.log('   (they refused open borders at any price)'); await page.tap('.screen h2 button.icon'); }
await page.waitForSelector('.screen h2:has-text("Diplomacy")');
await page.tap('.relcard .rowbtns button:has-text("Declare war")'); await page.tap('.dlg button:has-text("Declare war")');
check(await page.evaluate(t => HX.atWar(UI.G, UI.pid, t), setup.them), 'declare war from the diplomacy screen');
check(await page.evaluate(t => !HX.hasOB(UI.G, UI.pid, t), setup.them), 'war cancels open borders');
await page.tap('.screen .bar button:has-text("Done")');
await page.evaluate(id => setSel({ k: 'unit', id }, true), setup.mine); await page.waitForTimeout(800);
fp = await page.evaluate(t => renderer.posOf(t), setup.foeTile);
await page.touchscreen.tap(fp[0], fp[1]); await page.waitForTimeout(150);
check(await page.isVisible('#sel button:has-text("Attack")'), 'first tap on an enemy shows the attack preview');
await shot('24-attack-preview');
await page.touchscreen.tap(fp[0], fp[1]); await page.waitForTimeout(500);
await shot('25-after-attack');
await page.waitForTimeout(500);
check(await page.evaluate(id => { const f = HX.unitById(UI.G, id); return !f || f.hp < 100; }, setup.foeId), 'second tap attacks');
// promotion dialog
await page.evaluate(id => { const u = HX.unitById(UI.G, id); if (u) { u.xp = 40; setSel({ k: 'unit', id }, true); } }, setup.mine);
await page.waitForTimeout(200);
if (await page.isVisible('#sel button:has-text("Promote")')) {
  await page.tap('#sel button:has-text("Promote")'); await page.locator('.dlg .belief').first().tap();
  check(await page.evaluate(id => HX.unitById(UI.G, id).promos.length === 1, setup.mine), 'promote from the dialog');
} else check(false, 'promote button shown');
// city fires at an enemy in range
const fire = await page.evaluate(() => { const G = UI.G, c = HX.ownCities(G, UI.pid)[0]; c.firedTurn = -1; setSel({ k: 'city', id: c.id, t: c.tile }); return HX.cityTargets(G, c).length; });
if (fire) { await page.tap('#sel button:has-text("Fire at")'); check(await page.evaluate(() => HX.ownCities(UI.G, UI.pid)[0].firedTurn === UI.G.turn), 'city fires from its panel'); }

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
