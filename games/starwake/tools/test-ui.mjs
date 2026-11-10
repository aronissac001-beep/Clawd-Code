// Drives the built page in headless Chromium at iPhone 14 size (390x844, touch).
// Run: node games/starwake/tools/test-ui.mjs [screenshotDir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const file = 'file://' + path.join(here, '../../../docs/starwake/index.html');
const shots = process.argv[2];
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 1 : 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok:', m); };
const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
const overflow = async () => page.evaluate(() => { const w = document.documentElement.clientWidth; const bad = []; if (document.documentElement.scrollWidth > w + 1) bad.push('page'); for (const el of document.querySelectorAll('.screen .body, #sel, .dlg')) if (el.scrollWidth > el.clientWidth + 2) bad.push(el.className || el.id); return bad; });
const smallTargets = async (sel) => page.evaluate(s => Array.from(document.querySelectorAll(s)).filter(b => b.offsetParent && getComputedStyle(b).visibility !== 'hidden').map(b => { const r = b.getBoundingClientRect(); return [b.textContent.slice(0, 20), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, hh]) => w < 44 || hh < 44), sel);
const dismissTip = async () => page.evaluate(() => { const t = document.getElementById('tip'); if (t) t.remove(); });
const resolveEvents = async () => { for (let k = 0; k < 6 && await page.isVisible('.dlg .opts button'); k++) { await page.locator('.dlg .opts button').first().tap(); await page.waitForTimeout(80); } };

await page.goto(file);
await page.waitForTimeout(500);
check(await page.isVisible('text=New game'), 'main menu shows');
check(await page.getAttribute('a.back', 'href') === '../' && (await page.textContent('a.back')).includes('All games'), 'main menu links to ../ (All games)');
await shot('01-menu');
await page.tap('text=How to play'); check(await page.isVisible('text=The goal'), 'help screen'); await shot('02-help');
await page.tap('button[aria-label=Back]');
await page.tap('text=Settings'); check(await page.isVisible('text=Ambient music'), 'settings screen'); await page.tap('button[aria-label=Back]');
await page.tap('text=New game');
await page.waitForTimeout(150);
check(await page.isVisible('text=Choose your people'), 'new game screen');
await page.tap('.species button:has-text("Ollvae")');
await page.tap('.seg button:has-text("Small")');
await page.fill('input[type=text] >> nth=-1', 'test-seed-1');
await shot('03-newgame');
check((await overflow()).length === 0, 'new game screen has no horizontal overflow');
{ const st = await smallTargets('.screen button, .screen a'); check(st.length === 0, 'new game tap targets are at least 44px ' + JSON.stringify(st.slice(0, 4))); }
await page.tap('text=Begin');
await page.waitForSelector('#hud:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(700);
await shot('04-start');
check(await page.evaluate(() => UI.G.species[UI.G.empires[UI.pid].species].name === 'Ollvae' && UI.G.cfg.size === 'small'), 'chosen species and galaxy are used');
check(await page.isVisible('#tip'), 'welcome tip shows');
await dismissTip();
await page.evaluate(() => Settings.set('tips', false));
const small = await smallTargets('#hud button');
check(small.length === 0, 'HUD tap targets are at least 44px: ' + JSON.stringify(small));
check((await overflow()).length === 0, 'HUD has no horizontal overflow');

// play and pause
const d0 = await page.evaluate(() => UI.G.day);
await page.tap('#speeds button[data-sp="3"]');
await page.waitForTimeout(1500);
await resolveEvents();
await page.tap('#speeds button[data-sp="0"]');
const d1 = await page.evaluate(() => UI.G.day);
check(d1 > d0 + 5, `time runs at 4x (${d0} -> ${d1})`);
await page.waitForTimeout(300);
check(await page.evaluate(() => UI.G.day) === d1, 'pause stops time');

// tap a star on the map
await page.evaluate(() => clearSel());
const star = await page.evaluate(() => { const G = UI.G, s = G.systems[G_capSys()]; const w = s.lanes[0]; const t = G.systems[w]; const x = (t.x - renderer.cam.x) * renderer.cam.z + renderer.w / 2, y = (t.y - renderer.cam.y) * renderer.cam.z + renderer.h / 2; return { x, y, id: w }; });
await page.touchscreen.tap(star.x, star.y); await page.waitForTimeout(250);
check(await page.isVisible('#sel .tt'), 'tapping a star opens the system panel');
check(await page.evaluate(id => UI.selSys === id, star.id), 'the tapped system is selected');
await shot('05-system-panel');
// pan and pinch
const cam0 = await page.evaluate(() => ({ ...renderer.cam }));
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
await touch('touchStart', [[200, 300]]); for (let k = 1; k <= 10; k++) await touch('touchMove', [[200 - k * 10, 300 + k * 5]]); await touch('touchEnd', []);
await page.waitForTimeout(200);
const cam1 = await page.evaluate(() => ({ ...renderer.cam }));
check(Math.abs(cam1.x - cam0.x) > 30, 'drag pans the camera');
await touch('touchStart', [[150, 300], [240, 300]]); for (let k = 1; k <= 10; k++) await touch('touchMove', [[150 - k * 6, 300], [240 + k * 6, 300]]); await touch('touchEnd', []);
await page.waitForTimeout(200);
const cam2 = await page.evaluate(() => ({ ...renderer.cam }));
check(cam2.z > cam1.z * 1.3, `pinch zooms (${cam1.z.toFixed(2)} -> ${cam2.z.toFixed(2)})`);
// system view
await page.evaluate(() => { const s = G_capSys(); renderer.centerOn(s, false, 0.8); selectSystem(s); });
await page.tap('#sel button:has-text("View system")'); await page.waitForTimeout(400);
check(await page.evaluate(() => renderer.mode === 'system'), 'system view opens');
await shot('06-system-view');
const pl = await page.evaluate(() => { const hit = renderer._planetHits.find(h => h.p.col); return hit ? { x: hit.x, y: hit.y } : null; });
if (pl) { await page.touchscreen.tap(pl.x, pl.y); await page.waitForTimeout(200); check(await page.isVisible('#sel button:has-text("Open colony")'), 'tapping the capital in system view shows its panel'); }
await page.tap('#btnView'); await page.waitForTimeout(200);
check(await page.evaluate(() => renderer.mode === 'galaxy'), 'back to galaxy view');

// fleet orders: constructor builds an outpost next door
await page.evaluate(() => { const G = UI.G, e = G.empires[UI.pid]; const s = G.systems[G_capSys()]; for (const w of s.lanes) e.surv[w] = 1; });
const bt = await page.evaluate(() => { const G = UI.G, e = G.empires[UI.pid]; const f = G.fleets.find(x => x.owner === UI.pid && x.kind === 'builder'); const s = G.systems[G_capSys()]; const w = s.lanes.find(id => !SW.canOutpost(G, e, id)); selectFleet(f.id); UI.selSys = w; renderSel(); return { f: f.id, w }; });
await page.waitForTimeout(150);
await shot('07-fleet-orders');
check(await page.isVisible('#sel button:has-text("Build outpost")'), 'constructor offers Build outpost for a neighbor');
await page.tap('#sel button:has-text("Build outpost")');
check(await page.evaluate(id => SW.fleetById(UI.G, id).order && SW.fleetById(UI.G, id).order.t === 'outpost', bt.f), 'outpost order given');
await page.tap('#sel button:has-text("Move")'); await page.waitForTimeout(100);
check(await page.isVisible('#hint'), 'move mode shows a hint');
await page.tap('#hint button'); await page.evaluate(() => clearSel());

// screens
await page.tap('#n_outliner'); await page.waitForSelector('.screen h2:has-text("Outliner")'); await shot('08-outliner');
check(await page.locator('.screen .item').count() >= 4, 'outliner lists colonies and fleets');
await page.locator('.screen .item').first().tap(); await page.waitForSelector('.screen h2'); await page.waitForTimeout(100);
check(await page.isVisible('text=Districts'), 'planet screen opens from the outliner');
await shot('09-planet');
const dBefore = await page.evaluate(() => { const p = UI.G.planets[UI.G.empires[UI.pid].capital]; return p.col.queue.length; });
await page.locator('.dist button[aria-label=Build]').first().tap(); await page.waitForTimeout(100);
check(await page.evaluate(n => UI.G.planets[UI.G.empires[UI.pid].capital].col.queue.length === n + 1, dBefore), 'build a district from the planet screen');
await page.evaluate(() => { UI.G.empires[UI.pid].res.minerals += 2000; rerender(); });
await page.tap('text=Construct a building'); await page.waitForSelector('.dlg h3'); await shot('10-buildings');
await page.locator('.dlg .item:not(.dis)').first().tap(); await page.waitForTimeout(100);
check(await page.evaluate(() => UI.G.planets[UI.G.empires[UI.pid].capital].col.queue.some(q => q.k === 'b')), 'queue a building');
{ const o = await overflow(); check(o.length === 0, 'planet screen has no horizontal overflow ' + o.join(',')); }
await page.tap('.screen .head button[aria-label=Close]');
{ const st = await smallTargets('.screen button'); check(st.length === 0, 'planet screen tap targets are at least 44px ' + JSON.stringify(st.slice(0, 4))); }
await page.tap('#n_research'); await page.waitForSelector('.tech'); await shot('11-research');
await page.locator('.tech').first().tap();
check(await page.evaluate(() => !!UI.G.empires[UI.pid].research.lumen.cur), 'choose a research card');
await page.tap('.tabs button:has-text("Known")'); await page.tap('.screen .head button[aria-label=Close]');
await page.evaluate(() => { UI.G.empires[UI.pid].res.unity = 5000; UI.G.empires[UI.pid].res.influence = 500; });
await page.tap('#n_empire'); await page.waitForSelector('.screen h2:has-text("Empire")'); await shot('12-empire');
await page.tap('.tabs button:has-text("Traditions")'); await page.locator('.trad button.pri').first().tap();
check(await page.evaluate(() => Object.keys(UI.G.empires[UI.pid].trads).length === 1), 'adopt a tradition'); await shot('13-traditions');
await page.tap('.tabs button:has-text("Edicts")'); await page.locator('.item button.pri').first().tap();
check(await page.evaluate(() => SW.activeEdicts(UI.G, UI.G.empires[UI.pid]).length === 1), 'enact an edict');
await page.tap('.tabs button:has-text("Market")'); const en0 = await page.evaluate(() => UI.G.empires[UI.pid].res.energy);
await page.locator('button:has-text("Buy 10")').first().tap(); check(await page.evaluate(n => UI.G.empires[UI.pid].res.energy < n, en0), 'market purchase spends energy');
await page.tap('.tabs button:has-text("Victory")'); await shot('14-victory');
check((await overflow()).length === 0, 'empire screen has no horizontal overflow');
await page.tap('.screen .head button[aria-label=Close]');
// diplomacy: meet the nearest empire
await page.evaluate(() => { const G = UI.G; const o = SW.alive(G).find(x => x.id !== UI.pid); SW.meet(G, UI.pid, o.id); });
await resolveEvents();
await page.tap('#n_diplomacy'); await page.waitForSelector('.screen h2:has-text("Diplomacy")');
await page.locator('.screen .item').first().tap(); await page.waitForSelector('text=Their opinion of you'); await shot('15-diplomacy');
check(await page.isVisible('text=Non-Aggression Pact'), 'diplomacy detail lists treaties');
check((await overflow()).length === 0, 'diplomacy screen has no horizontal overflow');
await page.tap('.screen .head button[aria-label=Close]');
await page.tap('#n_military'); await page.waitForSelector('.screen h2:has-text("Military")');
await page.tap('.tabs button:has-text("Designs")'); await shot('16-designs');
await page.locator('.screen .item').first().tap(); await page.waitForSelector('.dlg select'); await shot('17-designer');
const nd = await page.evaluate(() => UI.G.empires[UI.pid].designs.length);
await page.tap('.dlg button:has-text("Save")'); await page.waitForTimeout(100);
check(await page.evaluate(n => UI.G.empires[UI.pid].designs.length === n + 1, nd), 'ship designer saves a design');
await resolveEvents();
await page.tap('.tabs button:has-text("Shipyards")'); await page.locator('.screen .item').first().tap(); await page.waitForSelector('text=Build ships');
await page.evaluate(() => { UI.G.empires[UI.pid].res.alloys += 1000; rerender(); });
await shot('18-starbase');
await page.locator('.screen .item:has-text("Picket") button').first().tap();
check(await page.evaluate(() => UI.G.systems[G_capSys()].sb.queue.some(q => q.k === 'ship')), 'queue a warship at the starbase');
await page.tap('.screen .head button[aria-label=Close]');
await page.tap('#n_log'); await page.waitForSelector('.screen h2:has-text("Log")'); await shot('19-log'); await page.tap('.screen .head button[aria-label=Close]');
// an anomaly event dialog
await page.evaluate(() => { const G = UI.G; SW.startEvent(G, G.empires[UI.pid], 'derelict', { sys: G_capSys(), planet: -1, fleet: null }); });
await page.tap('#speeds button[data-sp="1"]');
await page.waitForSelector('.dlg .opts button', { timeout: 5000 });
await shot('20-event');
check(await page.evaluate(() => UI.speed === 0), 'events pause the game');
await page.locator('.dlg .opts button').first().tap(); await page.waitForTimeout(150);
check(await page.evaluate(() => !UI.G.pending.some(p => p.key === 'derelict')), 'choosing an option resolves the event');
await resolveEvents(); await page.tap('#speeds button[data-sp="0"]');

// save and load through the menu
await page.tap('#btnMenu'); await page.tap('.dlg button:has-text("Save or load")'); await page.locator('.item:has-text("Slot 1") button:has-text("Save")').tap();
await page.waitForTimeout(150);
const saved = await page.evaluate(() => ({ day: UI.G.day, json: SW.serializeGame(UI.G).length }));
check(await page.evaluate(() => !!localStorage.getItem('starwake.save.m1')), 'manual save written with the starwake. prefix');
await page.evaluate(() => { for (let i = 0; i < 30; i++) SW.advanceDay(UI.G); });
await page.locator('.item:has-text("Slot 1") button:has-text("Load")').tap(); await page.waitForTimeout(300);
check(await page.evaluate(d => UI.G.day === d, saved.day), 'load restores the saved day');
check(await page.evaluate(n => SW.serializeGame(UI.G).length === n, saved.json), 'loaded game matches the saved game');
const code = await page.evaluate(() => LZ.toText(SW.serializeGame(UI.G)));
check(await page.evaluate(c => SW.serializeGame(SW.deserializeGame(LZ.fromText(c))) === SW.serializeGame(UI.G), code), `export code round trip (${Math.round(code.length / 1024)} KB)`);
await resolveEvents();

// a long stretch of play: the empire grows, AI acts, every screen still renders
await page.evaluate(() => { const G = UI.G, me = G.empires[UI.pid]; me.ai = true; me.persona = 'expansionist'; for (let i = 0; i < 360 * 30; i++) { SW.advanceDay(G); for (const p of SW.playerEvents(G, UI.pid)) SW.resolveEvent(G, p.id, 0); const e = G.empires[UI.pid]; if (i % 30 === 0) { for (const p of SW.colonies(G, e)) p.col.auto = true; for (const k of RESEARCH) if (!e.research[k].cur) SW.chooseTech(G, e, k, e.research[k].opts[0]); } if (G.over) break; } me.ai = false; SW.dirty(me); flushLog(); updateHUD(); });
await resolveEvents();
for (const k of ['outliner', 'research', 'empire', 'diplomacy', 'military', 'log']) { await page.tap('#n_' + k); await page.waitForTimeout(80); check(await page.isVisible('.screen .body'), `late game: ${k} screen renders`); if (k === 'diplomacy') await shot('21-late-diplomacy'); await page.tap('.screen .head button[aria-label=Close]'); }
await page.evaluate(() => { renderer.fit(UI.G); clearSel(); });
await page.waitForTimeout(200);
await shot('22-late-galaxy');
check(await page.evaluate(() => UI.G.day >= 360 * 25 && UI.G.empires[UI.pid].alive), 'thirty years pass with the empire alive (year ' + await page.evaluate(() => SW.dateOf(UI.G.day).y) + ')');
// end of game
await page.evaluate(() => { const G = UI.G; G.endDay = G.day + 1; while (!G.over) { SW.advanceDay(G); for (const p of SW.playerEvents(G, UI.pid)) SW.resolveEvent(G, p.id, 0); } afterDays(1); });
await page.waitForSelector('text=Final standings', { timeout: 10000 });
await page.waitForTimeout(200);
await shot('23-end');
check(await page.locator('canvas.chart').count() >= 3, 'end screen shows charts');
await page.tap('text=Main menu'); await page.waitForTimeout(200);
check(await page.isVisible('text=Load game'), 'back to the main menu');
check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(fails ? `\n${fails} UI check(s) FAILED` : '\nall UI checks passed');
await browser.close();
process.exit(fails ? 1 : 0);
