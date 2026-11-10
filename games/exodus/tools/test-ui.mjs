// Drives the built page in headless Chromium at iPhone 14 size (390x844, DPR 3, touch).
// Run: node games/exodus/tools/test-ui.mjs [screenshotDir] [dpr]   (screenshots at DPR 1 with dpr=1)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;
const file = 'file://' + path.join(here, '../../../docs/exodus/index.html');
const shots = process.argv[2], dpr = +(process.argv[3] || 3);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) errors.push('external request: ' + r.url()); });
let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok:', m); };
const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
const noOverflow = async where => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && Array.from(document.querySelectorAll('.screen, .dlg')).every(e => e.scrollWidth <= e.clientWidth + 2)), 'no horizontal overflow: ' + where);
const smallTargets = () => page.evaluate(() => Array.from(document.querySelectorAll('.screen button, .dlg button, #hud button, #sel button')).filter(b => b.offsetParent && !b.closest('.web')).map(b => { return [b.textContent.slice(0, 24) || b.id || b.className, b.offsetWidth, b.offsetHeight]; }).filter(([, w, hh]) => w < 44 || hh < 44));

await page.goto(file);
await page.waitForTimeout(500);
check(await page.isVisible('text=New game'), 'main menu shows');
check(await page.evaluate(() => { const a = document.querySelector('a.hub'); return !!a && a.getAttribute('href') === '../' && a.textContent.includes('All games') && !!a.offsetParent; }), 'main menu links back to All games');
await shot('01-menu');
await page.tap('text=Codex'); await page.waitForSelector('.screen h2:has-text("Codex")');
for (const t of ['Units', 'Buildings', 'Wonders', 'Factions', 'Veyra']) { await page.tap(`.codextabs button:has-text("${t}")`); await noOverflow('codex ' + t); }
check(await page.locator('.codex').count() > 10, 'codex lists entries');
await shot('01b-codex');
await page.tap('.screen .bar button:has-text("Done")');
await page.tap('text=How to play'); await page.waitForTimeout(150);
check(await page.isVisible('.screen h2:has-text("How to play")'), 'help screen opens');
await noOverflow('help');
await page.tap('.screen h2 button');
await page.tap('text=New game');
await page.waitForTimeout(150);
await shot('02-newgame');
check(await page.isVisible('text=Expedition sponsor') && await page.isVisible('text=Ark loadout'), 'new game screen with sponsor and loadout');
check(await page.locator('button.civ').count() === 9, 'eight sponsors plus random');
await noOverflow('new game');
await page.tap('button.civ:has-text("Choir of Sel")');
await page.tap('.seg button:has-text("Small")');
await page.fill('input[type=text]', 'glass-moth-417');
await page.tap('text=Start game');
await page.waitForSelector('#hud:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(700);
check(await page.evaluate(() => CIVS[UI.G.players[UI.pid].civ].key) === 'choir', 'chosen sponsor is used');
// landfall: pick a landing site from the dialog
if (!(await page.isVisible('.dlg h4:has-text("Choose where the ark comes down")'))) await page.tap('#btnEnd');
await page.waitForSelector('.dlg h4:has-text("Choose where the ark comes down")');
check(await page.locator('.landcard').count() >= 2, 'landfall offers several sites');
await shot('03-landfall');
await noOverflow('landfall');
await page.locator('.landcard button:has-text("Land here")').nth(1).tap();
await page.waitForTimeout(600);
check(await page.evaluate(() => UI.G.players[UI.pid].landed), 'the ark lands');
check(await page.isVisible('#sel'), 'the Colony Pod is selected after landing');
await page.waitForTimeout(900);
check(await page.isVisible('#tip:has-text("Welcome")'), 'first-game tip appears');
await shot('03b-tip');
await page.tap('#tip button:has-text("Got it")');
await page.evaluate(() => Settings.set('tips', false));
const small = await page.evaluate(() => Array.from(document.querySelectorAll('#hud button')).filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.textContent, r.width, r.height]; }).filter(([, w, hh]) => w < 44 || hh < 44));
check(small.length === 0, 'HUD buttons are at least 44pt: ' + JSON.stringify(small));

// found the first colony, answer the story quest it opens
const st = await page.evaluate(() => { const u = UI.G.units.find(x => x.owner === UI.pid && x.type === 'settler'); setSel({ k: 'unit', id: u.id }, true); return HX.canFoundCity(UI.G, u); });
await page.waitForTimeout(400);
if (st.ok) { await page.tap('#sel button:has-text("Found colony")'); await page.waitForTimeout(500); }
check(await page.evaluate(() => UI.G.cities.some(c => c.owner === UI.pid)), 'first colony founded via button');
await shot('04-city');
check(await page.evaluate(() => !!HX.pendingStory(UI.G, UI.pid)), 'founding opens the First Night story');
if (!(await page.isVisible('.dlg.event'))) { await page.evaluate(() => closeModal()); await page.tap('#btnEnd'); }
await page.waitForSelector('.dlg.event .belief');
await shot('04b-story');
await noOverflow('story');
await page.locator('.dlg.event .belief').nth(0).tap(); await page.waitForTimeout(200);
check(await page.evaluate(() => !HX.pendingStory(UI.G, UI.pid) && UI.G.players[UI.pid].qfx.length >= 1), 'story answer is kept');

// tap-to-move with the Marine, then undo
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
  check(await page.evaluate(id => HX.unitById(UI.G, id).tile, moved.id) === moved.t, 'second tap moves the unit');
  await page.evaluate(id => { if (UI.undo) UI.undo.explored = exploredCount(UI.G); setSel({ k: 'unit', id }); }, moved.id);
  if (await page.isVisible('#sel button:has-text("Undo move")')) {
    await page.tap('#sel button:has-text("Undo move")'); await page.waitForTimeout(200);
    check(await page.evaluate(id => HX.unitById(UI.G, id).tile, moved.id) === moved.from, 'undo puts the unit back');
  } else check(false, 'undo button offered after a move');
}

// pan by dragging and zoom with a pinch
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

// explore, then play turns through the research and production prompts
await page.evaluate(() => { const u = UI.G.units.find(x => x.owner === UI.pid && x.type === 'scout'); if (u) { setSel({ k: 'unit', id: u.id }); doOrder(u, 'explore'); } });
await page.waitForTimeout(800);
check((await page.textContent('#btnEnd')).includes('Choose'), 'end turn asks for research or production first');
await page.evaluate(() => { Settings.set('confirmEnd', false); });
let sawTech = false, sawCity = false;
for (let k = 0; k < 50 && (await page.evaluate(() => UI.G.turn)) < 13; k++) {
  const label = await page.textContent('#btnEnd');
  await page.tap('#btnEnd');
  if (label.includes('Choose research')) {
    await page.waitForSelector('.tnode.avail');
    if (!sawTech) { sawTech = true; await shot('10-techweb'); await noOverflow('tech web'); }
    await page.locator('.tnode.avail').first().tap();
    await page.tap('.tdetail button.pri');
    await page.tap('.screen .bar button:has-text("Done")');
  } else if (label.includes('Choose production')) {
    await page.waitForSelector('.screen .item');
    if (!sawCity) { sawCity = true; await shot('11-city'); await noOverflow('colony screen'); }
    const want = await page.evaluate(() => UI.G.turn < 4 ? 'Rigger' : 'Explorer');
    const btn = page.locator(`.screen .item:has-text("${want}")`);
    if (await btn.count()) await btn.first().tap(); else await page.locator('.screen .item').first().tap();
    await page.tap('.screen .bar button:has-text("Back to map")');
  } else if (label.includes('Answer')) {
    await page.waitForSelector('.dlg.event .belief'); await page.locator('.dlg.event .belief').first().tap();
  } else {
    if (await page.isVisible('.dlg.event button')) await page.locator('.dlg.event button').first().tap();
    await page.waitForFunction(() => !UI.busy, null, { timeout: 15000 });
  }
  await page.waitForTimeout(60);
}
check(sawTech && sawCity, 'research and production screens reached from the end turn button');
const turn = await page.evaluate(() => UI.G.turn);
check(turn >= 13, 'turns pass with choices made (turn ' + turn + ')');
check(await page.evaluate(() => UI.G.players[UI.pid].techs.length >= 2), 'research completes');

// the tech web: 60+ nodes, path research to a far tech
await page.tap('#stSci'); await page.waitForSelector('.tnode');
check(await page.locator('.tnode').count() >= 61, 'tech web shows every tech');
await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.tnode')).find(x => x.textContent.includes('Rootsong Theory')); b.scrollIntoView({ block: 'center', inline: 'center' }); });
await page.locator('.tnode:has-text("Rootsong Theory")').tap();
await page.waitForSelector('.tdetail b:has-text("Rootsong Theory")');
await page.tap('.tdetail button:has-text("Research path")');
check(await page.evaluate(() => { const P = UI.G.players[UI.pid], q = [P.research].concat(P.rqueue || []); return q[q.length - 1] === 'rootsong_theory' && q.length >= 3; }), 'research path queues the far tech');
await shot('10b-techpath');
await page.tap('.screen .bar button:has-text("Done")');

// Rigger: improve a tile
const built = await page.evaluate(async () => {
  const G = UI.G, P = G.players[UI.pid];
  for (const k of ['hydroponics', 'fabrication', 'xenobiology', 'robotics', 'marine_tech', 'field_physics', 'geomechanics', 'colonial_charter']) if (!P.techs.includes(k)) P.techs.push(k);
  P._techSet = null;
  let u = G.units.find(x => x.owner === UI.pid && x.type === 'builder');
  const city = HX.ownCities(G, UI.pid)[0];
  const t = city.tiles.find(x => HX.improvementFor(G, UI.pid, x).imp && !G._civ.has(x) && !G.map.improv[x]);
  if (t === undefined) return 'no tile';
  if (!u) u = spawnUnit(G, 'builder', UI.pid, t); else placeUnit(G, u, t);
  u.moves = 12; u.order = null; setSel({ k: 'unit', id: u.id }, true);
  return HX.improvementFor(G, UI.pid, t).imp;
});
await page.waitForTimeout(400);
await shot('12-rigger');
const impBtn = page.locator('#sel .acts button.pri');
check(await impBtn.count() > 0, 'Rigger shows an improvement button (' + built + ')');
if (await impBtn.count()) {
  const n0 = await page.evaluate(() => { let n = 0; for (const v of UI.G.map.improv) if (v) n++; return n + UI.G.units.filter(u => u.order && u.order.kind === 'build').length; });
  await impBtn.first().tap(); await page.waitForTimeout(200);
  check(await page.evaluate(() => { let n = 0; for (const v of UI.G.map.improv) if (v) n++; return n + UI.G.units.filter(u => u.order && u.order.kind === 'build').length; }) > n0, 'improvement started from the panel');
}

// city panel and buy, tile management
await page.evaluate(() => { const c = HX.ownCities(UI.G, UI.pid)[0]; UI.G.players[UI.pid].gold = 500; setSel({ k: 'city', id: c.id, t: c.tile }, true); });
await page.waitForTimeout(300);
await shot('13-citypanel');
check(await page.isVisible('#sel button:has-text("Open colony")'), 'colony panel offers Open colony');
const before = await page.evaluate(() => UI.G.players[UI.pid].gold);
const buyBtn = page.locator('#sel button:has-text("Buy")');
if (await buyBtn.count() && await buyBtn.isEnabled()) { await buyBtn.tap(); await page.waitForTimeout(150); check(await page.evaluate(() => UI.G.players[UI.pid].gold) < before, 'buying spends credits'); }
await page.evaluate(() => { const c = HX.ownCities(UI.G, UI.pid)[0]; showCity(c); });
await page.tap('button:has-text("Manage tiles")');
await page.waitForSelector('#sel.manage');
await page.waitForTimeout(400);
const pin = await page.evaluate(() => { const c = HX.cityById(UI.G, UI.manage); const t = HX.workableTiles(UI.G, c).find(x => !c.worked.includes(x)) ?? HX.workableTiles(UI.G, c)[0]; const [x, y] = renderer.posOf(t); return { t, x, y }; });
await page.touchscreen.tap(pin.x, pin.y); await page.waitForTimeout(150);
check(await page.evaluate(t => HX.cityById(UI.G, UI.manage).locked.includes(t), pin.t), 'tapping a tile on the map pins it');
await page.tap('#sel button:has-text("Done")');
await page.waitForSelector('.screen h2');
check(await page.isVisible('text=pinned'), 'colony screen reports pinned tiles');
await page.tap('.screen .bar button:has-text("Back to map")');

// virtues from the floating button
await page.evaluate(() => { UI.G.players[UI.pid].culturePool = 500; updateHUD(); });
check(await page.isVisible('#btnPolicy .pip'), 'virtue badge shows when one is affordable');
await page.tap('#btnPolicy');
await page.waitForSelector('.virt.ready');
check(await page.locator('.vtree').count() === 4, 'four virtue trees');
await shot('16-virtues');
await noOverflow('virtues');
const np = await page.evaluate(() => UI.G.players[UI.pid].policies.length);
await page.tap('.virt.ready >> nth=0'); await page.tap('.dlg button:has-text("Adopt")');
check(await page.evaluate(n => UI.G.players[UI.pid].policies.length === n + 1, np), 'adopt a virtue from the screen');
await page.tap('.screen .bar button:has-text("Done")');

// affinity screen
await page.evaluate(() => { HX.gainAff(UI.G, UI.pid, 'communion', 50); updateHUD(); });
await page.tap('#btnFaith'); await page.waitForSelector('.screen h2:has-text("Affinity")');
check(await page.locator('.affcard').count() === 3, 'three affinities shown');
check(await page.evaluate(() => HX.affLevel(UI.G.players[UI.pid], 'communion') >= 2), 'affinity levels rise');
await shot('17-affinity');
await noOverflow('affinity');
await page.tap('.screen .bar button:has-text("Done")');

// lens, world map, log
await page.tap('#btnLens'); await page.waitForTimeout(200);
check(await page.evaluate(() => Settings.get('lens') === 'yields'), 'yields lens toggles');
await shot('18-lens');
await page.tap('#btnLens'); await page.waitForTimeout(100);
check(await page.evaluate(() => Settings.get('lens') === 'off'), 'lens toggles off');
await page.tap('#btnWorld'); await page.waitForSelector('.worldwrap canvas');
await shot('19-world');
const wb = await page.locator('.worldwrap canvas').boundingBox();
await page.touchscreen.tap(wb.x + wb.width * 0.3, wb.y + wb.height * 0.5);
check(await page.evaluate(() => !document.querySelector('.worldwrap')), 'tapping the world map jumps and closes');
await page.evaluate(() => showLog()); await page.waitForSelector('.screen h2:has-text("Event log")');
check(await page.locator('.logrow').count() > 0, 'event log lists events');
await page.tap('.screen .bar button:has-text("Back")');

// Explorer: excavate a crash site
const dig = await page.evaluate(() => {
  const G = UI.G, site = G.sites.find(x => x.kind === 'wreck' && !G._civ.has(x.tile) && !G._mil.has(x.tile)) || G.sites.find(x => x.kind === 'ruin' && !G._civ.has(x.tile)); if (!site) return null;
  let u = G.units.find(x => x.owner === UI.pid && UNITS[x.type].recon);
  if (!u) u = spawnUnit(G, 'scout', UI.pid, site.tile); else placeUnit(G, u, site.tile);
  u.moves = 12; u.order = null; u.charges = 2; HX.computeVisibility(G, UI.pid); renderer.centerOn(site.tile, true); setSel({ k: 'unit', id: u.id }, true); return u.id;
});
await page.waitForTimeout(400);
if (dig !== null) {
  check(await page.isVisible('#sel button:has-text("Excavate")'), 'Explorer on a site offers Excavate');
  await shot('20-excavate');
  await page.tap('#sel button:has-text("Excavate")'); await page.waitForTimeout(200);
  check(await page.evaluate(id => { const u = HX.unitById(UI.G, id); return u && u.order && u.order.t === 'dig'; }, dig), 'excavation starts');
} else check(false, 'a crash site exists to excavate');

// satellites: build one, choose a launch site on the map
const sat = await page.evaluate(() => {
  const G = UI.G, P = G.players[UI.pid], c = HX.ownCities(G, UI.pid)[0];
  if (!P.techs.includes('orbital_launch')) P.techs.push('orbital_launch'); P._techSet = null;
  const u = spawnUnit(G, 'sat_helio', UI.pid, c.tile); renderer.centerOn(c.tile, true); setSel({ k: 'unit', id: u.id }, true); return u.id;
});
await page.waitForTimeout(300);
await page.tap('#sel button:has-text("Choose launch site")'); await page.waitForTimeout(200);
const nSat = await page.evaluate(() => UI.G.sats.filter(s => s.owner === UI.pid).length);
const lt = await page.evaluate(async () => { const t = UI.launch.targets.find(x => UI.G._grid.dist(x, HX.ownCities(UI.G, UI.pid)[0].tile) === 2) ?? UI.launch.targets[0]; renderer.centerOn(t, true); await new Promise(r => setTimeout(r, 500)); const [x, y] = renderer.posOf(t); return { t, x, y }; });
await page.touchscreen.tap(lt.x, lt.y); await page.waitForTimeout(200);
if (await page.isVisible('.dlg button:has-text("Launch")')) await page.tap('.dlg button:has-text("Launch")');
await page.waitForTimeout(300);
check(await page.evaluate(n => UI.G.sats.filter(s => s.owner === UI.pid).length === n + 1, nSat), 'satellite launched from the map');
await shot('21-satellite');

// tile panel on a Veil tile
const veilT = await page.evaluate(() => { const G = UI.G; const t = G._grid.within(HX.ownCities(G, UI.pid)[0].tile, 8).find(x => G.map.veil[x] && G.players[UI.pid].explored[x]); if (t === undefined) return null; renderer.centerOn(t, true); setSel({ k: 'tile', t }, true); return t; });
await page.waitForTimeout(400);
if (veilT !== null) { check(await page.isVisible('#sel:has-text("Veil")'), 'tile panel explains the Veil'); await shot('22-veil'); }
await page.evaluate(() => setSel(null));

// combat: meet a rival, declare war, preview and attack by tapping
const setup = await page.evaluate(() => {
  const G = UI.G, me = UI.pid, them = HX.majorPlayers(G).find(P => P.id !== me);
  const P = G.players[me]; if (!P.met.includes(them.id)) { P.met.push(them.id); them.met.push(me); }
  const c = HX.ownCities(G, me)[0], g = G._grid;
  const spots = g.within(c.tile, 3).filter(t => passableTerrain(G, t) && !G._mil.has(t) && !G._cityAt.has(t) && !G._civ.has(t) && g.dist(t, c.tile) >= 1);
  let pair = null;
  for (const a of spots) { const b = spots.find(x => g.dist(a, x) === 1 && g.dist(x, c.tile) <= 2); if (b !== undefined && a !== b) { pair = [a, b]; break; } }
  const mine = spawnUnit(G, 'militia', me, pair[0]); mine.moves = 12;
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
await noOverflow('diplomacy');
await page.tap('.offer button:has-text("Accept")'); await page.waitForTimeout(100);
check(await page.evaluate(g => UI.G.players[UI.pid].gold === g + 40, gold0), 'accepting an AI deal moves the credits');
await page.tap('.screen button.att'); check(await page.isVisible('.screen .why'), 'attitude reasons expand');
check(await page.isVisible('.screen :text("Agenda")'), 'rival agenda is shown');
await page.tap('.relcard .rowbtns button:has-text("Trade")'); await page.waitForSelector('.screen h2:has-text("Trade with")');
await page.tap('.chip.add:has-text("Open borders")'); await page.waitForTimeout(100);
check(await page.isVisible('.verdict.ok, .verdict.no'), 'trade screen shows a live verdict');
await shot('26-trade');
if (await page.isEnabled('.screen button:has-text("Propose deal")')) {
  await page.tap('.screen button:has-text("Propose deal")'); await page.waitForTimeout(100);
  console.log('   (open borders proposed)');
} else { console.log('   (they refused open borders)'); }
if (await page.isVisible('.screen h2:has-text("Trade with")')) await page.tap('.screen h2 button.icon');
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
await page.touchscreen.tap(fp[0], fp[1]); await page.waitForTimeout(900);
check(await page.evaluate(id => { const f = HX.unitById(UI.G, id); return !f || f.hp < 100; }, setup.foeId), 'second tap attacks');
// promotion dialog
await page.evaluate(id => { const u = HX.unitById(UI.G, id); if (u) { u.xp = 40; setSel({ k: 'unit', id }, true); } }, setup.mine);
await page.waitForTimeout(200);
if (await page.isVisible('#sel button:has-text("Promote")')) {
  await page.tap('#sel button:has-text("Promote")'); await page.locator('.dlg .belief').first().tap();
  check(await page.evaluate(id => HX.unitById(UI.G, id).promos.length === 1, setup.mine), 'promote from the dialog');
} else check(false, 'promote button shown');
// affinity upgrade at a colony
const upg = await page.evaluate(id => { const G = UI.G, P = G.players[UI.pid], u = HX.unitById(G, id), c = HX.ownCities(G, UI.pid)[0]; if (!u) return false;
  if (!P.techs.includes('combat_doctrine')) P.techs.push('combat_doctrine'); P._techSet = null; HX.gainAff(G, UI.pid, 'communion', 100); P.gold = 2000;
  const g0 = G._mil.get(c.tile); if (g0 && g0.id !== u.id) placeUnit(G, g0, G._grid.neighbors(c.tile).find(t => passableTerrain(G, t) && !G._mil.has(t) && !G._cityAt.has(t)));
  placeUnit(G, u, c.tile); u.moves = 12; setSel({ k: 'unit', id }, true); return true; }, setup.mine);
await page.waitForTimeout(300);
if (upg) {
  const ub = page.locator('#sel button:has-text("Thornguard")');
  check(await ub.count() > 0, 'Communion upgrade offered for the Marine');
  await shot('25-upgrade');
  if (await ub.count()) { await ub.first().tap(); await page.waitForTimeout(200); if (await page.isVisible('.dlg button:has-text("Upgrade")')) await page.tap('.dlg button:has-text("Upgrade")'); }
  check(await page.evaluate(id => HX.unitById(UI.G, id).type === 'thornguard', setup.mine), 'upgrade to the Communion line');
}
// taming: a wild beast next to a Communion unit
const tame = await page.evaluate(id => { const G = UI.G, P = G.players[UI.pid], u = HX.unitById(G, id); if (!u) return null;
  if (!P.techs.includes('fauna_ethology')) P.techs.push('fauna_ethology'); P._techSet = null; HX.gainAff(G, UI.pid, 'communion', 200);
  const t = G._grid.neighbors(u.tile).find(x => passableTerrain(G, x) && !G._mil.has(x) && !G._cityAt.has(x) && !G._civ.has(x)); if (t === undefined) return null;
  const B = G.players.findIndex(Q => Q.barbarian), b = spawnUnit(G, 'skitter', B, t); u.moves = 12; HX.computeVisibility(G, UI.pid); setSel({ k: 'unit', id }, true); return b.id; }, setup.mine);
await page.waitForTimeout(300);
if (tame !== null) {
  const tb = page.locator('#sel button:has-text("Tame")');
  check(await tb.count() > 0, 'Communion units offer to tame fauna');
  if (await tb.count()) { await tb.first().tap(); await page.waitForTimeout(200); check(await page.evaluate(b => HX.unitById(UI.G, b) && HX.unitById(UI.G, b).owner === UI.pid, tame), 'beast tamed'); }
}
// colony fires at an enemy in range
const fire = await page.evaluate(() => { const G = UI.G, c = HX.ownCities(G, UI.pid)[0]; c.firedTurn = -1; setSel({ k: 'city', id: c.id, t: c.tile }); return HX.cityTargets(G, c).length; });
if (fire) { await page.tap('#sel button:has-text("Fire at")'); check(await page.evaluate(() => HX.ownCities(UI.G, UI.pid)[0].firedTurn === UI.G.turn), 'colony fires from its panel'); }

await page.tap('#stGold'); await page.waitForSelector('.screen h3:has-text("Morale")');
check(await page.isVisible('.screen h3:has-text("The wild")'), 'empire screen shows fauna anger');
await shot('14-empire');
await noOverflow('empire');
// random event dialog
await page.tap('.screen .bar button:has-text("Back to map")');
const g0 = await page.evaluate(() => { const G = UI.G; while (HX.pendingStory(G, UI.pid)) HX.resolveStory(G, UI.pid, 0); closeModal(); G.pendingEvents[UI.pid] = { key: 'harvest', ctx: { city: HX.ownCities(G, UI.pid)[0].id, name: HX.ownCities(G, UI.pid)[0].name, food: 20, gold: 33 }, turn: G.turn }; showPendingEvent(); return G.players[UI.pid].gold; });
check(await page.isVisible('.dlg.event h4:has-text("Glowroot Bloom")'), 'event dialog shows');
await shot('29-event');
await page.tap('.dlg.event button:has-text("Sell the surplus")');
check(await page.evaluate(g => UI.G.players[UI.pid].gold === g + 33 && !HX.pendingEvent(UI.G, UI.pid), g0), 'event choice applies');
// visionaries: a Pioneer Scholar makes a breakthrough
const gp = await page.evaluate(() => { closeScreens(); const G = UI.G, P = G.players[UI.pid], c = HX.ownCities(G, UI.pid)[0]; if (!P.research) HX.setResearch(G, UI.pid, HX.availableTechs(P)[0]);
  const t = G._grid.within(c.tile, 2).find(x => passableTerrain(G, x) && !G._civ.has(x) && !G._cityAt.has(x)); const u = spawnUnit(G, 'great_scientist', UI.pid, t); setSel({ k: 'unit', id: u.id }, true); return { r: P.research, p: P.progress[P.research] || 0, id: u.id }; });
await page.waitForTimeout(300);
check(await page.isVisible('#sel button:has-text("Breakthrough")'), 'Pioneer Scholar offers Breakthrough');
await page.tap('#sel button:has-text("Breakthrough")'); await page.waitForTimeout(200);
check(await page.evaluate(g => (UI.G.players[UI.pid].progress[g.r] || 0) > g.p || UI.G.players[UI.pid].techs.includes(g.r), gp), 'breakthrough boosts research');
// agents: next to a rival colony
const spy = await page.evaluate(() => { closeScreens(); const G = UI.G, c = G.cities.find(x => x.owner !== UI.pid && !G.players[x.owner].barbarian && !G.players[x.owner].minor); if (!c) return null;
  const t = G._grid.neighbors(c.tile).find(n => passableTerrain(G, n) && !G._civ.has(n) && !G._cityAt.has(n)); if (t === undefined) return null;
  const u = spawnUnit(G, 'spy', UI.pid, t); HX.computeVisibility(G, UI.pid); setSel({ k: 'unit', id: u.id }, true); return u.id; });
if (spy !== null) { await page.waitForTimeout(300); check(await page.isVisible('#sel button:has-text("Sabotage")'), 'Agent next to a rival colony offers missions'); await page.evaluate(id => { const u = HX.unitById(UI.G, id); if (u) removeUnit(UI.G, u); setSel(null); }, spy); }
// outposts: gift credits, then absorb
await page.evaluate(() => closeScreens());
const fc = await page.evaluate(() => { const G = UI.G, M = G.players.find(x => x.minor && x.alive); if (!M) return null; const P = G.players[UI.pid]; if (!P.met.includes(M.id)) { P.met.push(M.id); M.met.push(UI.pid); } P.gold = Math.max(P.gold, 3000); return M.id; });
if (fc !== null) {
  await page.tap('#btnDip'); await page.waitForSelector('.screen h3:has-text("Outposts")');
  const card = page.locator('.relcard', { has: page.locator('button:has-text("Absorb")') }).first();
  await card.locator('button:has-text("Gift")').first().tap(); await page.waitForTimeout(150);
  check(await page.evaluate(id => HX.influence(UI.G, id, UI.pid) > 0, fc), 'gifting credits raises influence with an outpost');
  await shot('31-outposts');
  await page.evaluate(id => { UI.G.players[id].inf[UI.pid] = 100; }, fc);
  await page.tap('.screen .bar button:has-text("Done")');
  await page.tap('#btnDip'); await page.waitForSelector('.screen h3:has-text("Outposts")');
  await page.locator('.relcard button.pri:has-text("Absorb")').first().tap(); await page.tap('.dlg button:has-text("Absorb")');
  check(await page.evaluate(id => !UI.G.players[id].alive, fc), 'absorb an outpost from the diplomacy screen');
  await page.tap('.screen .bar button:has-text("Done")');
} else check(false, 'small map has an outpost');
// wonders in the colony screen, victory screen and the end of the game
await page.evaluate(() => { const P = UI.G.players[UI.pid]; for (const k of ['xenobiology', 'colonial_charter', 'hydroponics', 'gene_weaving']) if (!P.techs.includes(k)) P.techs.push(k); P._techSet = null; showCity(HX.ownCities(UI.G, UI.pid)[0]); });
check(await page.isVisible('.screen .item.great'), 'colony screen lists planetary wonders');
await page.locator('.screen .item.great').first().tap(); await page.waitForTimeout(100);
check(await page.evaluate(() => HX.isWonder((HX.ownCities(UI.G, UI.pid)[0].build || {}).key || '')), 'pick a wonder to build');
await page.tap('.screen .bar button:has-text("Back to map")');
await page.tap('#btnVic'); await page.waitForSelector('.screen h2:has-text("Victory")');
check(await page.locator('.screen .vcard').count() >= 6, 'victory screen shows every condition');
check(await page.isVisible('.screen canvas.chart'), 'history chart is drawn');
await page.tap('.screen .seg button:has-text("Science")');
await shot('27-victory');
await noOverflow('victory');
await page.tap('.screen .bar button:has-text("Done")');
await page.evaluate(() => { UI.G.over = { winner: UI.pid, type: 'rootsong', turn: UI.G.turn, seen: false }; showEndGame(); });
check(await page.isVisible('.endhead.won'), 'end screen shows the victory');
check(await page.evaluate(() => (Settings.get('hall') || []).length >= 1 && Settings.get('hall')[0].won), 'finished game recorded in the Hall of Fame');
await shot('28-end');
await page.tap('.screen button:has-text("Keep playing")');
check(await page.evaluate(() => UI.G.over.cont === true && !document.querySelector('.screen')), 'keep playing after victory');
await page.evaluate(() => { UI.G.over = null; });
await page.tap('#stGold'); await page.waitForSelector('.screen h3:has-text("Morale")');
check(await page.isVisible('.cityrow'), 'empire screen lists colonies');
check(await page.isVisible('.screen h3:has-text("Visionaries")'), 'empire screen shows Visionary progress');
await page.tap('.screen .bar button:has-text("Back to map")');
check(await page.evaluate(() => UI.G.cities.length) >= 4, 'rivals founded their colonies');
await page.evaluate(() => { renderer.cam.z = 0.6; renderer.request(); });
await page.waitForTimeout(300);
await shot('07-zoomedout');

// pause, save to slot 1, load it back
await page.tap('#btnMenu');
await page.tap('text=Save game');
await page.tap('.slot >> nth=0 >> button');
await page.waitForTimeout(200);
check(await page.evaluate(() => !!Saves.meta('m1') && Object.keys(localStorage).some(k => k.startsWith('exodus.save.'))), 'manual save written under exodus.save.');
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
check(await page.evaluate(() => Settings.get('grid') === false && JSON.parse(localStorage.getItem('exodus.settings')).grid === false), 'setting persists under exodus.settings');
const tgt = await smallTargets();
check(tgt.length === 0, 'settings buttons are at least 44pt: ' + JSON.stringify(tgt));
check(await page.evaluate(() => Object.keys(localStorage).every(k => k.startsWith('exodus.'))), 'every storage key uses the exodus. prefix');

const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check(!over, 'no horizontal overflow');
check(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
await browser.close();
console.log(fails ? `${fails} UI failures` : 'all UI checks passed');
process.exit(fails ? 1 : 0);
