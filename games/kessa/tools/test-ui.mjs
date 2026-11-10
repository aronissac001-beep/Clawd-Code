// Drives the built page in headless Chromium at iPhone 14 size (390x844, touch) with real taps.
// Run: node games/kessa/tools/test-ui.mjs [screenshotDir]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const file = 'file://' + path.join(here, '../../../docs/kessa/index.html');
const shots = process.argv[2];
if (shots) fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: shots ? 1 : 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errors.push('network request: ' + r.url()); });
let fails = 0, oks = 0;
const check = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else { oks++; console.log('ok:', m); } };
const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
const noOverflow = async where => { const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, w: window.innerWidth, wide: Array.from(document.querySelectorAll('button, .card, .toast, .tech, .it')).filter(e => e.offsetParent && !e.closest('#resBar, .tabs, #hzBar')).map(e => e.getBoundingClientRect()).filter(r => r.right > window.innerWidth + 1 || r.left < -1).length })); check(o.sw <= o.w && o.bw <= o.w && o.wide === 0, 'no horizontal overflow: ' + where + ' ' + JSON.stringify(o)); };
const smallTargets = async (sel, where) => { const s = await page.evaluate(sel => Array.from(document.querySelectorAll(sel)).filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.textContent.trim().slice(0, 18), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, hh]) => w < 44 || hh < 44), sel); check(s.length === 0, 'tap targets >= 44px: ' + where + (s.length ? ' ' + JSON.stringify(s.slice(0, 5)) : '')); };
const tapTile = async (x, y) => { const p = await page.evaluate(([x, y]) => R.tileToScreen(x + 0.5, y + 0.5), [x, y]); await page.touchscreen.tap(p[0], p[1]); await page.waitForTimeout(120); return p; };
const G = (expr, arg) => page.evaluate(expr, arg);

await page.goto(file);
await page.waitForTimeout(400);
// ---------- main menu ----------
check(await page.isVisible('#btnNew'), 'main menu shows');
check(await G(() => { const a = document.querySelector('#allGames'); return a && a.getAttribute('href') === '../' && a.offsetParent !== null && a.textContent.includes('All games'); }), '"◂ All games" link to ../ is visible');
await noOverflow('main menu'); await smallTargets('.screen button, .screen a', 'main menu');
await shot('01-menu');
await page.tap('text=Help'); await page.waitForTimeout(100); check(await page.isVisible('text=How to play'), 'help screen'); await shot('02-help');
await page.tap('.screen .back'); await page.tap('text=Settings'); check(await page.isVisible('h2:has-text("Settings")'), 'settings screen');
await page.tap('[data-set=music]'); check(await G(() => Settings.get('music') === false), 'music toggle works');
await page.tap('[data-set=music]'); await shot('03-settings'); await page.tap('.screen .back');
// ---------- new colony ----------
await page.tap('#btnNew'); await page.waitForTimeout(100);
check(await page.isVisible('text=New colony'), 'new colony screen');
await page.tap('[data-pick="sponsor:union"]'); await page.tap('[data-pick="commander:roboticist"]');
await page.fill('#seedIn', 'rust-crater-404');
await noOverflow('new colony'); await shot('04-newgame');
await page.tap('#btnStart');
await page.waitForSelector('#hud:not([hidden])', { timeout: 10000 });
await page.waitForTimeout(600);
check(await G(() => UI.G.cfg.sponsor === 'union' && UI.G.cfg.commander === 'roboticist' && UI.G.seed === 'rust-crater-404'), 'chosen sponsor, commander and seed are used');
check(await page.isVisible('#tip:has-text("Welcome")'), 'tutorial tip appears');
await shot('05-start');
await page.tap('#tip button:has-text("Got it")');
await smallTargets('#hud button', 'HUD');
await noOverflow('HUD');
// ---------- place a solar array with taps ----------
await page.tap('#speed [data-sp="0"]');
await page.tap('[data-tab=build]'); await page.waitForTimeout(150);
check(await page.isVisible('#sheet'), 'build menu opens'); await shot('06-build');
await page.tap('#sheet .tabs button:has-text("Power")');
await page.tap('[data-build=solar]'); await page.waitForTimeout(150);
check(await page.isVisible('#placeBar'), 'placement bar shows after choosing a building');
const spot = await G(() => { const G = UI.G, L = G.buildings.find(b => b.t === 'lander'); for (let r = 0; r < 8; r++) for (let y = L.y - r - 2; y <= L.y + 3 + r; y++) for (let x = L.x - r - 2; x <= L.x + 3 + r; x++) if (KC.canPlace(G, 'solar', x, y).ok) return { x, y }; return null; });
const before = await G(() => UI.G.buildings.length);
await tapTile(spot.x, spot.y);
check(await G(() => R.ghost && R.ghost.ok), 'tapping the map moves a valid ghost');
await shot('07-ghost');
await page.tap('#placeBar button:has-text("Place here")'); await page.waitForTimeout(100);
check(await G(() => UI.G.buildings.length) === before + 1, 'Place here creates a construction site');
// a battery too, then leave placement
await page.tap('#placeBar button:has-text("Done")');
await page.tap('[data-tab=build]'); await page.tap('#sheet .tabs button:has-text("Power")'); await page.tap('[data-build=battery]');
const bspot = await G(() => { const G = UI.G, L = G.buildings.find(b => b.t === 'lander'); for (let r = 0; r < 10; r++) for (let y = L.y - r; y <= L.y + 3 + r; y++) for (let x = L.x - r; x <= L.x + 3 + r; x++) if (KC.canPlace(G, 'battery', x, y).ok) return { x, y }; return null; });
await tapTile(bspot.x, bspot.y); await page.tap('#placeBar button:has-text("Place here")');
check(await G(() => UI.G.buildings.some(b => b.t === 'battery')), 'battery placed via taps');
await page.tap('#placeBar button:has-text("Done")');
// ---------- a cable line: tap start, tap end ----------
await page.tap('[data-tab=build]'); await page.tap('#sheet .tabs button:has-text("Grids")'); await page.tap('[data-build=cable]');
const lspot = await G(() => { const G = UI.G, L = G.buildings.find(b => b.t === 'lander'); for (let d = 6; d < 14; d++) { const x = L.x + d, y = L.y + 1; let ok = true; for (let k = 0; k < 4; k++) if (G._occ[(y) * KC.MAP_N + x + k] || G._T.slope[y * KC.MAP_N + x + k] > KC.SLOPE_LINE) ok = false; if (ok) return { x, y }; } return null; });
await G(s => R.centerOn(s.x + 1.5, s.y), lspot); await page.waitForTimeout(100); await tapTile(lspot.x, lspot.y); await page.waitForTimeout(150); await tapTile(lspot.x + 3, lspot.y);
check(await page.isEnabled('#placeBar button:has-text("Build line")'), 'line preview is valid ' + JSON.stringify(await G(() => ({ g: R.ghost, m: UI.mode }))));
await shot('08-line');
await page.tap('#placeBar button:has-text("Build line")');
check(await G(() => Array.from(UI.G.cable).filter(v => v === 3).length >= 4), 'cable tiles planned');
await page.tap('#placeBar button:has-text("Done")');
// ---------- time controls ----------
const t0 = await G(() => UI.G.tick);
await page.tap('#speed [data-sp="10"]'); await page.waitForTimeout(1500);
const t1 = await G(() => UI.G.tick);
check(t1 > t0 + 2, 'fastest speed advances time (' + t0 + ' -> ' + t1 + ')');
await page.tap('#speed [data-sp="0"]'); await page.waitForTimeout(50);
const t2 = await G(() => UI.G.tick); await page.waitForTimeout(800);
check(await G(() => UI.G.tick) === t2, 'pause stops time');
await page.tap('#speed [data-sp="1"]'); await page.waitForTimeout(2600); check(await G(() => UI.G.tick) > t2, 'normal speed runs'); await page.tap('#speed [data-sp="0"]');
// tap the new site to open its panel
await tapTile(spot.x, spot.y); await page.waitForTimeout(150);
check(await page.isVisible('#sheet h3:has-text("Solar Array")'), 'tapping a site opens its panel');
await shot('09-site');
await page.tap('#sheet .sh-head button[aria-label=Close]');
// ---------- develop the colony with the test bot, then use every screen ----------
await page.addScriptTag({ path: path.join(here, 'bot.js') });
await G(() => { const G = UI.G, B = {}; for (let h = 0; h < 22 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); } while (KC.hourOf(G.tick) !== 10) KC.step(G); G._fx = []; });
check(await G(() => UI.G.colonists.length > 0), 'colonists have arrived (' + await G(() => UI.G.colonists.length) + ')');
const dome = await G(() => { const d = UI.G.buildings.find(b => b.t === 'dome_s' && b.built); R.cam.z = 1.2; R.centerOn(d.x + d.s / 2, d.y + d.s / 2); return { x: d.x, y: d.y, s: d.s, id: d.id }; });
await page.waitForTimeout(300); await shot('10-colony');
await tapTile(dome.x + 1, dome.y + 2); await page.waitForTimeout(200);
check(await page.isVisible('#sheet h3:has-text("Bubble Dome")'), 'tapping a dome opens the dome panel');
check(await page.isVisible('#sheet .slots'), 'dome shows its module slots');
await shot('11-dome');
await G(id => { const G = UI.G, d = KC.bById(G, id); for (const m of KC.domeModules(G, d)) if (m.t === 'arboretum' || m.t === 'gym' || m.t === 'clinic') KC.demolish(G, m.id); }, dome.id);
await page.tap('#sheet button:has-text("+ Add module")'); await page.waitForTimeout(100);
const modsBefore = await G(id => KC.domeModules(UI.G, KC.bById(UI.G, id)).length, dome.id);
await page.tap('[data-mod=gym]'); await page.waitForTimeout(100);
check(await G(id => KC.domeModules(UI.G, KC.bById(UI.G, id)).length, dome.id) === modsBefore + 1, 'module added from the dome panel');
await smallTargets('#sheet button', 'dome panel');
await page.tap('#sheet .sh-head button[aria-label=Close]');
// a working building panel with controls
const works = await G(() => { const b = UI.G.buildings.find(b => b.built && !b.mod && (b.t === 'works' || b.t === 'lab' || b.t === 'oremine')); R.centerOn(b.x + b.s / 2, b.y + b.s / 2); return b && { x: b.x, y: b.y, id: b.id, t: b.t }; });
await page.waitForTimeout(150);
await tapTile(works.x + 1, works.y + 1); await page.waitForTimeout(150);
check(await page.isVisible('#sheet .sec:has-text("Workers")'), 'workplace panel lists workers by shift');
await page.tap('#sheet button:has-text("High")'); check(await G(id => KC.bById(UI.G, id).prio === 2, works.id), 'priority button works');
await page.tap('#sheet button:has-text("Turn off")'); check(await G(id => !KC.bById(UI.G, id).on, works.id), 'on/off button works');
await page.tap('#sheet button:has-text("Turn on")');
await shot('12-building');
await noOverflow('building panel');
await page.tap('#sheet .sh-head button[aria-label=Close]');
// layers
await page.tap('[data-tab=layers]');
for (const l of ['power', 'life', 'drones', 'deposits']) { if (!(await page.isVisible('[data-layer=' + l + ']'))) await page.tap('[data-tab=layers]'); await page.tap('[data-layer=' + l + ']'); await page.waitForTimeout(80); check(await G(() => R.overlay) === l, 'layer ' + l); if (l === 'power' || l === 'drones') await shot('13-layer-' + l); }
await page.tap('[data-tab=layers]'); await page.tap('[data-layer=survey]'); await page.waitForTimeout(100);
const sec = await G(() => { const G = UI.G, k = KC.MAP_N / KC.SECTOR; const i = G.sectors.findIndex(s => !s.st); return i < 0 ? null : { x: (i % k) * KC.SECTOR + 4, y: Math.floor(i / k) * KC.SECTOR + 4, i }; });
if (sec) { await G(s => R.centerOn(s.x, s.y), sec); await page.waitForTimeout(100); await tapTile(sec.x, sec.y); check(await page.isVisible('#sheet h3:has-text("Sector")'), 'tapping a sector in survey layer opens it'); await page.tap('#sheet button:has-text("Queue survey")'); check(await G(i => UI.G.survey.includes(i), sec.i), 'survey queued'); await shot('14-survey'); await page.tap('#sheet .sh-head button[aria-label=Close]'); }
await page.tap('[data-tab=layers]'); await page.tap('[data-layer=none]');
// people
await page.tap('[data-tab=people]'); await page.waitForTimeout(150);
check(await page.isVisible('#sheet .list .it'), 'colonist list shows people'); await shot('15-people');
await page.tap('#sheet .list .it.tap >> nth=0'); await page.waitForTimeout(100);
check(await page.isVisible('.mbox:has-text("Morale")'), 'colonist card opens'); await shot('16-colonist');
await page.tap('.mbox button:has-text("Close")');
await page.tap('#sheet .tabs button:has-text("Domes")'); check(await page.isVisible('#sheet .list .it'), 'domes overview');
await page.tap('#sheet .tabs button:has-text("Applicants")'); check(await page.isVisible('#sheet .list .it'), 'applicant pool');
await noOverflow('people');
// research
await page.tap('[data-tab=research]'); await page.waitForTimeout(150);
check(await page.isVisible('#sheet h3:has-text("Research")'), 'research screen'); 
await page.tap('#sheet .tabs button:has-text("Social")');
const tech = await G(() => Object.values(KC.TECHS).find(t => t.field === 'soc' && !KC.techDone(UI.G, t.id) && KC.techAvailable(UI.G, t.id)));
if (tech) { await page.tap('[data-tech=' + tech.id + ']'); check(await G(id => UI.G.research.cur === id, tech.id), 'tapping a tech starts it'); }
const locked = await G(() => Object.values(KC.TECHS).find(t => t.field === 'soc' && !KC.techAvailable(UI.G, t.id) && !KC.techDone(UI.G, t.id) && t.tier > 4));
if (locked) { await page.tap('[data-tech=' + locked.id + ']'); check(await G(id => UI.G.research.queue.includes(id), locked.id), 'tapping a locked tech queues it with prerequisites'); }
await shot('17-research'); await noOverflow('research');
// rockets: order cargo and launch
await page.tap('[data-tab=rockets]'); await page.waitForTimeout(150); await shot('18-rockets');
await G(() => { UI.G.funds += 500; for (const r of UI.G.rockets) if (r.st !== 'home') { r.st = 'home'; r.t = 0; r.ark = []; r.cargo = null; } });
await page.tap('#sheet .tabs button:has-text("Cargo")'); await page.waitForTimeout(100);
await page.tap('[data-add=metals]'); await page.tap('[data-add=parts]');
check(await G(() => UI.order.cargo.metals === 1 && UI.order.cargo.parts === 1), 'cargo steppers work'); await shot('19-cargo');
const inbound = await G(() => UI.G.rockets.filter(r => r.st === 'out').length);
await page.tap('[data-launch]'); await page.waitForTimeout(100);
check(await G(() => UI.G.rockets.filter(r => r.st === 'out').length) === inbound + 1, 'rocket launched from the cargo screen');
await page.tap('#sheet .tabs button:has-text("Colonists")'); await page.waitForTimeout(100); await shot('20-ark');
await noOverflow('rockets');
// log and goals
await page.tap('[data-tab=log]'); await page.waitForTimeout(100); check(await page.isVisible('#sheet h3:has-text("Colony log")'), 'log screen'); await shot('21-log');
await page.tap('[data-tab=goals]'); await page.waitForTimeout(100); check(await page.isVisible('#sheet :text("Independence")'), 'goals screen'); await shot('22-goals');
// resource chip details
await page.tap('[data-res=parts]'); check(await page.isVisible('#sheet h3:has-text("Parts")'), 'resource details open from the top bar');
await page.tap('#sheet .sh-head button[aria-label=Close]');
// vehicles
const pf = await G(() => { const v = UI.G.vehicles.find(v => v.t === 'pathfinder'); R.cam.z = 1; R.centerOn(v.x + 0.5, v.y + 0.5); return v.id; });
await page.waitForTimeout(150);
const vs = await G(id => { const v = UI.G.vehicles.find(x => x.id === id); return R.worldToScreen(isoX(v.x + 0.5, v.y + 0.5), isoY(v.x + 0.5, v.y + 0.5, R.zSmooth(v.x + 0.5, v.y + 0.5) + 6)); }, pf);
await page.touchscreen.tap(vs[0], vs[1]); await page.waitForTimeout(150);
check(await page.isVisible('#sheet h3:has-text("Pathfinder")'), 'tapping the Pathfinder opens it');
await page.tap('#sheet button:has-text("Move…")');
const dest = await G(id => { const G = UI.G, v = G.vehicles.find(x => x.id === id); for (let d = 3; d < 10; d++) for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d]]) { const x = Math.round(v.x) + dx, y = Math.round(v.y) + dy; if (KC.passable(G, x, y) && KC.findPath(G, Math.round(v.x), Math.round(v.y), x, y)) return { x, y }; } return null; }, pf);
await tapTile(dest.x, dest.y); await page.tap('#placeBar button:has-text("Drive")');
check(await G(id => UI.G.vehicles.find(x => x.id === id).path.length > 0, pf), 'vehicle move via tap and confirm');
// ---------- save / load / export / import ----------
await page.tap('#btnMenu'); await page.tap('[data-menu=save]'); await page.waitForTimeout(100);
await page.tap('[data-slot=m1]'); await page.waitForTimeout(200);
if (await page.isVisible('.mbox button:has-text("Overwrite")')) await page.tap('.mbox button:has-text("Overwrite")');
check(await G(() => !!localStorage.getItem('kessa.save.m1')), 'saved to slot 1 (localStorage kessa.save.m1)');
await shot('23-saves');
const savedTick = await G(() => UI.G.tick);
await page.tap('.screen .back');
await G(() => { for (let i = 0; i < 30; i++) KC.step(UI.G); });
await page.tap('#btnMenu'); await page.tap('#sheet button:has-text("Load game")'); await page.tap('[data-load=m1]'); await page.waitForTimeout(400);
check(await G(() => UI.G.tick) === savedTick, 'loading slot 1 restores the saved sol and hour');
await page.tap('#btnMenu'); await page.tap('#sheet button:has-text("Export / import")'); await page.waitForTimeout(100);
const txt = await page.inputValue('#exportText');
check(txt.startsWith('KESSA1:') && txt.length > 1000, 'export produces text (' + Math.round(txt.length / 1024) + ' KB)');
await page.tap('.screen button:has-text("Import a colony instead")');
await page.fill('#importText', txt); await page.tap('#btnImport'); await page.waitForTimeout(400);
check(await G(() => UI.G.tick) === savedTick && await page.isVisible('#hud'), 'import restores the colony');
// ---------- main menu continue ----------
await page.tap('#btnMenu'); await page.tap('#sheet button:has-text("Main menu")'); await page.tap('.mbox button:has-text("OK")'); await page.waitForTimeout(200);
check(await page.isVisible('#btnContinue'), 'main menu offers Continue');
await page.tap('#btnContinue'); await page.waitForTimeout(400);
check(await page.isVisible('#hud') && await G(() => !!UI.G), 'Continue resumes the colony');
// night and storm visuals
await G(() => { const G = UI.G; while (KC.hourOf(G.tick) !== 22) KC.step(G); G._fx = []; R.cam.z = 0.7; const L = G.buildings.find(b => b.t === 'lander'); R.centerOn(L.x + 1.5, L.y + 1.5); });
await page.waitForTimeout(300); await shot('24-night');
await G(() => { const G = UI.G; G.hz.active.push({ kind: 'dust', sev: 0.7, end: G.tick + 30, at: G.tick, x: 30, y: 30, dur: 30 }); while (KC.hourOf(G.tick) !== 12) KC.step(G); G._fx = []; });
await page.waitForTimeout(300); await shot('25-storm');
await noOverflow('final');
check(errors.length === 0, 'no page errors or network requests' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`\n${oks} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
