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
// one-tap orders from the system panel
await page.evaluate(() => { const G = UI.G, e = G.empires[UI.pid]; const s = G.systems[G_capSys()]; const w = s.lanes.find(id => !SW.canOutpost(G, e, id) && !G.fleets.some(f => f.order && f.order.sys === id)); e.res.influence += 200; e.res.minerals += 1000; selectSystem(w ?? s.lanes[0]); });
await page.waitForTimeout(100);
check(await page.isVisible('#sel button:has-text("Claim system")'), 'system panel offers a one-tap Claim system');
await page.tap('#sel button:has-text("Claim system")'); await page.waitForTimeout(100);
check(await page.evaluate(() => UI.G.fleets.some(f => f.owner === UI.pid && f.kind === 'builder' && f.order && f.order.t === 'outpost' && f.order.sys === UI.selSys) || UI.G.systems.some(s => s.sb && s.sb.queue.some(q => q.then && q.then.t === 'outpost'))), 'one-tap claim sends or queues a constructor');
await page.evaluate(() => clearSel());

// screens
await page.tap('#n_outliner'); await page.waitForSelector('.screen h2:has-text("Outliner")'); await shot('08-outliner');
check(await page.locator('.screen .item').count() >= 4, 'outliner lists colonies and fleets');
check(await page.evaluate(() => UI.G.fleets.filter(f => f.owner === UI.pid && f.kind === 'builder').length) === 2, 'the player starts with two constructors');
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
check(await page.isVisible('text=Mind Lattice'), 'Ascension perks are listed');
await page.evaluate(() => { const e = UI.G.empires[UI.pid]; e.techs.zero_point = 1; e.res.alloys += 2000; e.res.minerals += 2000; SW.dirty(e); });
await page.tap('.tabs button:has-text("Projects")'); await page.waitForSelector('text=Sun Lattice');
await page.locator('.card button.gold:has-text("Begin the Sun Lattice")').tap();
check(await page.evaluate(() => !!(UI.G.empires[UI.pid].projects || {}).sun_lattice), 'begin a Great Project'); await shot('13b-projects');
await page.tap('.tabs button:has-text("Edicts")'); await page.locator('.item button.pri').first().tap();
check(await page.evaluate(() => SW.activeEdicts(UI.G, UI.G.empires[UI.pid]).length === 1), 'enact an edict');
await page.tap('.tabs button:has-text("Market")'); const en0 = await page.evaluate(() => UI.G.empires[UI.pid].res.energy);
await page.locator('button:has-text("Buy 10")').first().tap(); check(await page.evaluate(n => UI.G.empires[UI.pid].res.energy < n, en0), 'market purchase spends energy');
await page.tap('.tabs button:has-text("Victory")'); await shot('14-victory');
check((await overflow()).length === 0, 'empire screen has no horizontal overflow');
await page.tap('.screen .head button[aria-label=Close]');
// victory race and first goals
await page.tap('#btnVictory'); await page.waitForSelector('.dlg h3:has-text("race")');
check(await page.isVisible('.dlg >> text=Wake Beacons') && await page.isVisible('.dlg >> text=Conquest'), 'victory race shows every path'); await shot('14b-victory-race');
await page.tap('.dlg button:has-text("Close")');
check(await page.isVisible('#btnGoals'), 'first goals button shows early on');
await page.tap('#btnGoals'); await page.waitForSelector('.goal'); check(await page.locator('.goal').count() === 10, 'ten first goals listed'); await shot('14c-goals');
await page.tap('.dlg button:has-text("Close")');
// diplomacy: meet the nearest empire
await page.evaluate(() => { const G = UI.G; const o = SW.alive(G).find(x => x.id !== UI.pid); SW.meet(G, UI.pid, o.id); });
await resolveEvents();
await page.tap('#n_diplomacy'); await page.waitForTimeout(400);
console.log('MODAL', await page.evaluate(() => document.getElementById('modal').innerText.slice(0, 1500)));
await browser.close();
