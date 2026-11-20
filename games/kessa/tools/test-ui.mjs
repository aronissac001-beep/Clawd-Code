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
await page.tap('#tip button:has-text("Got it")'); await page.waitForTimeout(350);
// the guided first colony: a numbered step, with the thing to tap next pulsing
check(await page.isVisible('#tip:has-text("Step 2 of")'), 'the guide shows numbered steps');
check(await page.isVisible('[data-tab=layers].guide-hl'), 'the guide points at what to tap next');
await page.tap('#tip [data-show]'); await page.waitForTimeout(350);
check(await G(() => R.overlay === 'drones'), 'Show me demonstrates the step (drone coverage)');
await page.tap('#sheet .sh-head button[aria-label=Close]'); await page.waitForTimeout(350);
check(await page.isVisible('[data-tab=build].guide-hl') && await page.isVisible('#tip:has-text("Power first")'), 'finishing a step moves the guide on (power next)');
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
await page.tap('#sheet [data-focus=science]'); await page.waitForTimeout(100);
check(await G(id => KC.bById(UI.G, id).focus === 'science', dome.id), 'a dome work focus can be set');
await page.tap('#sheet [data-focus=any]');
await page.tap('#sheet .sh-head button[aria-label=Close]');
// advisor, decisions, sponsor contracts, connect to grid
await G(() => { UI.G.event = null; });
await page.tap('#btnAdvice'); await page.waitForTimeout(150);
check(await page.isVisible('#sheet h3:has-text("Advisor")') && await page.isVisible('#sheet .advi'), 'advisor lists items');
await shot('11b-advisor');
await page.tap('#sheet .sh-head button[aria-label=Close]');
await G(() => { UI.G.event = { id: 'meteorite', at: UI.G.tick }; (UI.G._fx = UI.G._fx || []).push({ k: 'event' }); UI.drainFx(); });
await page.waitForTimeout(400);
check(await page.isVisible('.mbox [data-choice]'), 'a colony decision shows as a card');
await shot('11c-decision');
const m0 = await G(() => UI.G.res.metals);
await page.tap('.mbox [data-choice="1"]'); await page.waitForTimeout(100);
check(await G(() => !UI.G.event) && await G(() => UI.G.res.metals) > m0, 'choosing an option applies it');
await G(() => { UI.G.contracts.active = null; UI.G.contracts.offer = { id: 9, kind: 'tech', name: 'Research milestone', need: KC.techCount(UI.G) + 2, sols: 12, reward: 500, text: 'Complete 2 more technologies.', expires: UI.G.tick + 48 }; });
await page.tap('[data-tab=rockets]'); await page.tap('#sheet .tabs button:has-text("Sponsor")'); await page.waitForTimeout(100);
check(await page.isVisible('#sheet :text("Sponsor confidence")'), 'sponsor tab shows confidence');
await page.tap('[data-accept]'); check(await G(() => !!UI.G.contracts.active), 'a contract can be accepted');
await shot('11d-sponsor');
await G(() => { UI.G.loan = null; UI.G.conf = 60; });
await page.tap('#sheet .tabs button:has-text("Sponsor")'); await page.waitForTimeout(100);
const fAdv = await G(() => UI.G.funds);
await page.tap('[data-advance]'); await page.tap('.mbox button:has-text("Take it")'); await page.waitForTimeout(100);
check(await G(f => UI.G.funds > f && !!UI.G.loan, fAdv), 'the sponsor advance can be taken from the Sponsor tab');
// exports: choose what to sell and see the next manifest
await G(() => { UI.G.res.parts = Math.max(UI.G.res.parts, 220); });
await page.tap('#sheet .tabs button:has-text("Exports")'); await page.waitForTimeout(100);
await page.tap('[data-keep="parts:100"]'); await page.waitForTimeout(100);
check(await G(() => UI.G.trade.keep.parts === 100 && (KC.exportManifest(UI.G).goods.parts || 0) > 0), 'exports: selling parts above 100 puts them on the next rocket');
check(await page.isVisible('#sheet :text("Next rocket home")'), 'exports tab shows the next manifest');
await smallTargets('#sheet [data-keep]', 'export settings'); await noOverflow('exports');
await shot('11f-exports');
await page.tap('#sheet .sh-head button[aria-label=Close]');
const far = await G(() => { const G = UI.G, L = G.buildings.find(b => b.t === 'lander'); for (let r = 8; r < 20; r++) for (let y = L.y - r; y <= L.y + r; y++) for (let x = L.x - r; x <= L.x + r; x++) { if (!KC.canPlace(G, 'condenser', x, y).ok) continue; let touch = false; for (let i = -1; i <= 2; i++) for (const [xx, yy] of [[x + i, y - 1], [x + i, y + 2], [x - 1, y + i], [x + 2, y + i]]) { const k = yy * KC.MAP_N + xx; if (G._occ[k] || G.cable[k] || G.pipe[k]) touch = true; } if (touch) continue; const b = KC.place(G, 'condenser', x, y); b.built = true; b.prog = 999; G._occ[y * KC.MAP_N + x] = b.id; KC.computeNets(G); R.centerOn(x + 1, y + 1); R.cam.z = 1; return { x, y, id: b.id }; } return null; });
if (far) {
  await page.waitForTimeout(200); await tapTile(far.x + 1, far.y + 1); await page.waitForTimeout(200);
  check(await page.isVisible('[data-connect]'), 'a stranded building offers Connect to grid');
  await page.tap('[data-connect]'); check(await G(() => Array.from(UI.G.cable).some(v => v === 3)), 'Connect to grid plans lines');
  await page.tap('#sheet .sh-head button[aria-label=Close]');
}
// an emergency is impossible to miss: danger chip in the HUD, opening the advisor
const saved = await G(() => KC.serialize(UI.G));
await G(() => { const G = UI.G; for (const b of G.buildings) if (b.t === 'airsynth' || b.t === 'algae') KC.setOn(G, b.id, false); for (let h = 0; h < 240 && !G.colonists.some(c => c.health < 85); h++) KC.step(G); G.event = null; G._fx = []; HUD.update(); });
await page.waitForTimeout(300);
check(await page.isVisible('.hz.danger'), 'colonists in danger show a red chip in the HUD');
await shot('11e-danger');
await page.tap('.hz.danger'); await page.waitForTimeout(150);
check(await page.isVisible('#sheet .advi') && !(await page.isVisible('#sheet :text("look steady")')), 'the danger chip opens the advisor, which does not say all is well');
await page.tap('#sheet .sh-head button[aria-label=Close]');
await G(s => { const G = KC.deserialize(s); UI.G = G; R.G = G; R.bz.clear(); HUD.update(); }, saved);
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
// pick a job by hand
const pick = await G(() => { const G = UI.G; KC.assignJobs(G); for (const c of G.colonists) { if (!KC.canWork(c)) continue; const o = KC.jobOptions(G, c).find(o => !o.here && o.open > 0); if (o) return { cid: c.id, bid: o.b.id }; } return null; });
if (pick) {
  await G(id => Panels.colonist(id), pick.cid); await page.waitForTimeout(100);
  await page.tap('.mbox [data-act=job]'); await page.waitForTimeout(100);
  await page.tap('.mbox [data-job="' + pick.bid + '"]'); await page.waitForTimeout(100);
  check(await G(p => { const c = KC.cById(UI.G, p.cid); return c.job === p.bid && c.pinJob === p.bid; }, pick), 'a colonist can be given a job by hand');
  await shot('16b-job');
}
// the list names problems and offers fixes
await G(() => { const G = UI.G; for (const c of G.colonists.slice(0, 2)) c.morale = 20; Panels._pf = 'all'; Panels.people('list'); });
await page.waitForTimeout(150);
check(await page.isVisible('#sheet .card.issue'), 'the colonist list summarises who needs help'); await shot('16c-issues');
await smallTargets('#sheet .card.issue button', 'people fixes');
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
await page.tap('#sheet .tabs button:has-text("Ark")'); await page.waitForTimeout(100); await shot('20-ark');
await noOverflow('rockets');
// log and goals
await page.tap('[data-tab=log]'); await page.waitForTimeout(100); check(await page.isVisible('#sheet h3:has-text("Colony log")'), 'log screen'); await shot('21-log');
await page.tap('[data-tab=goals]'); await page.waitForTimeout(100); check(await page.isVisible('#sheet :text("Independence")'), 'goals screen'); await shot('22-goals');
// Reshaping Kessa: the tab, the globe, the four gauges, the stages, and the comet button with its reason
await page.tap('#sheet .tabs button:has-text("Reshaping")'); await page.waitForTimeout(250);
{ const r = await G(() => ({ globe: !!document.querySelector('#sheet canvas.globe'), gauges: document.querySelectorAll('#sheet .gauge').length, stages: document.querySelectorAll('#sheet .stg').length, comet: !!document.querySelector('#sheet [data-comet]'), cometDisabled: document.querySelector('#sheet [data-comet]') && document.querySelector('#sheet [data-comet]').disabled, why: document.body.textContent.includes('Needs Comet Herding') }));
  check(r.globe && r.gauges === 4 && r.stages === 7, 'Reshaping tab shows the globe, four gauges and seven stages');
  check(r.comet && r.cometDisabled && r.why, 'comet strikes are locked until Comet Herding, and say why'); }
await shot('22b-reshaping'); await smallTargets('#sheet button', 'reshaping'); await noOverflow('reshaping');
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
// the Council tab and an emergency button in the advisor
await G(() => { const G = UI.G; if (!G.council) G.council = { sup: { hearth: 50, forge: 70, lantern: 20 }, dem: { hearth: { id: 1, f: 'hearth', kind: 'service', need: 1, due: G.tick + 99, base: 99, got: 0, text: 'Open a new service module.' } }, next: { hearth: 1e9, forge: 1e9, lantern: 1e9 }, last: {}, won: 0, lost: 0 }; KC.computeMods(G); Panels.people('council'); });
await page.waitForTimeout(150);
check(await page.isVisible('#sheet [data-faction=hearth]') && await page.isVisible('#sheet [data-faction=forge]'), 'the Council tab shows the factions');
await shot('26-council'); await smallTargets('#sheet button', 'council'); await noOverflow('council');
// the Colony Assembly in the Council tab: choose a government, see the seats, propose a law
{ await G(() => { const g = UI.G; if (!g.council) g.council = { sup: { hearth: 50, forge: 50, lantern: 50 }, dem: {}, next: {}, last: {}, won: 0, lost: 0 }; g.assembly = { gov: null, since: g.tick, laws: {}, next: 0, n: 0, crisisAt: g.tick + 9999, history: [] }; Panels.people('council'); });
  await page.waitForTimeout(250);
  check(await page.locator('#sheet [data-gov]').count() === 4, 'the Assembly offers four forms of government');
  await page.tap('#sheet [data-gov=academy]'); await page.waitForTimeout(250);
  const r = await G(() => ({ bar: document.querySelectorAll('#sheet .seatbar i').length, laws: document.querySelectorAll('#sheet [data-law]').length }));
  check(r.bar === 3 && r.laws === 10, 'the seats show by faction and all ten laws can be proposed (' + r.bar + ', ' + r.laws + ')');
  await shot('26b-assembly'); await smallTargets('#sheet button', 'assembly'); await noOverflow('assembly');
  await page.tap('#sheet [data-law=clinics]'); await page.waitForTimeout(250);
  check(await G(() => UI.G.assembly.n === 1 && UI.G.log.some(l => /Public Clinics/.test(l.m))), 'proposing a law puts it to the vote and logs the result');
  await G(() => { delete UI.G.assembly; KC.computeMods(UI.G); Panels.people('council'); }); await page.waitForTimeout(200); }
await page.tap('#sheet .sh-head button[aria-label=Close]');
// a reshaped world: lakes, green ground and the sky; the terrain rebuilds once per visible change and draws without errors
{ const r = await G(() => { const T = KC.terraOf(UI.G); Object.assign(T, { warm: 60, water: 55, life: 60, veil: 66 }); KC.terraCheck(UI.G); KC.computeMods(UI.G); const k0 = R.tkey; R.frame(performance.now(), 0.5); const k1 = R.tkey; R.frame(performance.now(), 0.5); return { k0, k1, lakes: !!(R.lakes && R.lakes.list.length), open: KC.terraStage(UI.G, 'openair') }; });
  check(r.k0 !== r.k1 && r.lakes && r.open, 'the map is reshaped: terrain rebuilt (' + r.k0 + ' -> ' + r.k1 + '), lakes drawn, Open Sky reached'); }
await page.evaluate(() => Sheet.close && Sheet.close()); await shot('28-reshaped');
// ---------- 2.1: the World tab: map, rivals, the race, trade and expeditions ----------
{
  await G(() => { const G = UI.G; for (let h = 0; h < 4 * 24; h++) KC.step(G); G._fx = []; G.event = null; Modal.close(); Sheet.close(); });
  await page.tap('[data-tab=world]'); await page.waitForTimeout(300);
  const r = await G(() => ({ map: !!document.querySelector('#sheet canvas.worldmap'), tabs: $$('#sheet .tabs button').map(b => b.dataset.k).join(','), sites: document.querySelectorAll('#sheet [data-site]').length }));
  check(r.map && r.tabs === 'map,rivals,trade,exp' && r.sites > 0, 'the World tab shows the drawn map, four tabs and the remote sites (' + JSON.stringify(r) + ')');
  await shot('29-world-map'); await noOverflow('world map'); await smallTargets('#sheet button', 'world map');
  // tapping a site on the map selects it and shows what it needs
  const sp = await G(() => { const cv = document.querySelector('#sheet canvas.worldmap'), s = UI.G.world.sites.find(x => !x.claimed), rc = cv.getBoundingClientRect(); return [rc.left + s.x * rc.width, rc.top + s.y * rc.height, s.id]; });
  await page.touchscreen.tap(sp[0], sp[1]); await page.waitForTimeout(250);
  check(await page.isVisible('#sheet [data-sitecard="' + sp[2] + '"]') && await page.isVisible('#sheet [data-plan]'), 'tapping a site on the map shows its card and a plan button');
  await shot('30-world-site');
  await page.tap('#sheet .tabs button[data-k=rivals]'); await page.waitForTimeout(200);
  const rv = await G(() => ({ rows: document.querySelectorAll('#sheet [data-board]').length, races: document.querySelectorAll('#sheet [data-race]').length }));
  check(rv.rows === 4 && rv.races === 7, 'the rivalry board lists your colony and three rivals, and the seven races (' + JSON.stringify(rv) + ')');
  await shot('31-world-rivals'); await noOverflow('rivals');
  // a trade offer: accept it with a tap
  await G(() => { const G = UI.G; G.funds = Math.max(G.funds, 1000); G.world.offers = [{ id: 9901, r: G.world.rivals[0].k, give: { parts: 10 }, take: { funds: 150 }, until: G.tick + 40, kind: 'sell' }]; Sheet.render(true); });
  await page.tap('#sheet .tabs button[data-k=trade]'); await page.waitForTimeout(200); await shot('32-world-trade');
  const f0 = await G(() => [UI.G.funds, UI.G.res.parts]);
  await page.tap('#sheet [data-accept="9901"]'); await page.waitForTimeout(200);
  check(await G(f0 => UI.G.funds === f0[0] - 150 && UI.G.res.parts === f0[1] + 10 && !UI.G.world.offers.length, f0), 'accepting a trade offer swaps the goods');
  // expeditions: without a pad the tab says how to start; with one, pick a site, see the crew, launch
  await page.tap('#sheet .tabs button[data-k=exp]'); await page.waitForTimeout(200);
  check(await page.isVisible('#sheet [data-buildpad]'), 'the Expeditions tab offers to build an Expedition Pad');
  await G(() => { const G = UI.G; let pad = null; for (let y = 2; y < 60 && !pad; y++) for (let x = 2; x < 60 && !pad; x++) if (KC.canPlace(G, 'xpad', x, y).ok) pad = KC.place(G, 'xpad', x, y); pad.built = true; pad.pw = 1; G.res.fuel = 100; const hb = G.buildings.find(b => b.t === 'lander'); hb.drones += 10; for (const c of G.colonists) c.health = 100; const s = G.world.sites.find(x => !x.claimed && !KC.SITES[x.kind].rover); UI.wexp = { site: s.id, ids: null }; Sheet.render(true); });
  await page.waitForTimeout(200);
  const ex = await G(() => ({ seats: document.querySelectorAll('#sheet .it.seat').length, launch: !!document.querySelector('#sheet [data-launch-exp]:not([disabled])'), why: (document.querySelector('#sheet [data-launch-exp]') || {}).disabled ? $('#sheet .warnc') && $('#sheet .warnc').textContent : '' }));
  check(ex.seats > 0 && ex.launch, 'the planner shows the crew seats and can launch (' + JSON.stringify(ex) + ')');
  await shot('33-world-exp'); await smallTargets('#sheet button', 'expeditions');
  if (await page.isVisible('#sheet [data-swap="0"]')) { const before = await G(() => UI.wexp.ids[0]); await page.tap('#sheet [data-swap="0"]'); await page.waitForTimeout(150); check(await G(b => UI.wexp.ids[0] !== b, before), 'Swap changes who takes a seat'); }
  const pop0 = await G(() => UI.G.colonists.length);
  await page.tap('#sheet [data-launch-exp]'); await page.waitForTimeout(250);
  check(await G(p => UI.G.world.exps.length === 1 && UI.G.colonists.length < p, pop0), 'launching sends the crew away on the skimmer');
  await G(() => { R.frame(performance.now(), 0.5); }); await shot('34-world-route');
  await page.tap('#sheet .sh-head button[aria-label=Close]');
}
// ---------- 2.1: the monorail: two stations, Lay track from a station, a train runs ----------
{
  await page.tap('[data-tab=build]'); await page.tap('#sheet .tabs button[data-k=infra]'); await page.waitForTimeout(150);
  check(await page.isVisible('[data-build=station]') && await page.isVisible('[data-build=xpad]'), 'Build → Base offers the Rail Station and the Expedition Pad');
  await page.tap('#sheet .tabs button[data-k=lines]'); await page.waitForTimeout(100);
  check(await page.isVisible('[data-build=rail]'), 'Build → Grids offers monorail track');
  await page.tap('#sheet .sh-head button[aria-label=Close]');
  const ids = await G(() => { const G = UI.G, L = G.buildings.find(b => b.t === 'lander'), N = KC.MAP_N; const find = (cx, cy, R) => { let best = null, bd = 1e9; for (let y = Math.max(0, cy - R); y <= Math.min(N - 2, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(N - 2, cx + R); x++) if (KC.canPlace(G, 'station', x, y).ok) { const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = { x, y }; } } return best; };
    const a = find(L.x + 5, L.y, 20), s1 = KC.place(G, 'station', a.x, a.y); let bp = null; for (const [dx, dy] of [[14, 0], [-14, 0], [0, 14], [0, -14], [10, 10], [-10, 10]]) { bp = find(a.x + dx, a.y + dy, 3); if (bp) break; } const s2 = KC.place(G, 'station', bp.x, bp.y);
    for (const b of [s1, s2]) { b.built = true; b.paid = true; KC.autoConnectSite(G, b.id); } for (let i = 0; i < N * N; i++) { if (G.cable[i] === 3) G.cable[i] = 1; if (G.pipe[i] === 3) G.pipe[i] = 1; } G._netDirty = true; G._railDirty = true; KC.step(G); R.cam.z = 1.2; R.centerOn(s1.x + 1, s1.y + 1); return [s1.id, s2.id]; });
  await page.waitForTimeout(200);
  await G(id => { R.sel = { k: 'b', id }; Panels.building(KC.bById(UI.G, id)); }, ids[0]); await page.waitForTimeout(250);
  check(await page.isVisible('#sheet [data-lay="' + ids[1] + '"]'), 'a station offers Lay track to the other station');
  await shot('35-station'); await smallTargets('#sheet button', 'station');
  await page.tap('#sheet [data-lay="' + ids[1] + '"]'); await page.waitForTimeout(200);
  check(await G(() => UI.G.rail.some(v => v === 3)), 'Lay track plans the track for the drones');
  const run = await G(() => { const G = UI.G; for (let i = 0; i < G.rail.length; i++) if (G.rail[i] === 3) G.rail[i] = 1; G._railDirty = true; for (let h = 0; h < 12; h++) KC.step(G); const tr = G.trains[0]; let p = null; for (let k = 0; k < 10 && tr && !p; k++) { KC.step(G); const q = KC.trainPos(G, tr, 0.5); if (q && !q.stop) p = q; } if (p) R.centerOn(p.x + 0.5, p.y + 0.5); R.cam.z = 1.5; G._fx = []; return { trains: G.trains.length, moving: !!p }; });
  check(run.trains === 1 && run.moving, 'a train runs on the finished line (' + JSON.stringify(run) + ')');
  await page.tap('#sheet .sh-head button[aria-label=Close]'); await page.waitForTimeout(150);
  const fr = await G(() => { const t0 = performance.now(); for (let i = 0; i < 5; i++) R.frame(performance.now(), 0.5); return performance.now() - t0; });
  check(fr < 2000, 'the map draws track and trains'); await shot('36-train');
}
// ---------- 2.1: mysteries on the Goals screen, and the intros to new systems ----------
{
  await page.tap('[data-tab=goals]'); await page.waitForTimeout(200); await page.tap('#sheet .tabs button[data-k=goals]'); await page.waitForTimeout(200);
  check(await G(() => ['bloom', 'moon', 'orrery'].every(k => document.querySelector('#sheet [data-myst=' + k + ']'))), 'Goals lists the Bloom Below, the Ninth Moon and the Orrery relics');
  await page.tap('#sheet .sh-head button[aria-label=Close]');
  await G(() => { Settings.set('tips', false); Settings.set('intros', true); Settings.set('introsDone', []); Tips.shown = null; Tips.check(); });
  await page.waitForTimeout(200);
  check(await page.isVisible('#tip [data-intro-show=i_world]'), 'an intro to the world map appears once the guide is done');
  await shot('37-intro');
  await page.tap('#tip [data-intro-show=i_world]'); await page.waitForTimeout(300);
  check(await page.isVisible('#sheet canvas.worldmap') && await G(() => Settings.get('introsDone').includes('i_world')), 'Show me opens the World map and the intro is not shown again');
  await page.tap('#sheet .sh-head button[aria-label=Close]'); await page.waitForTimeout(200);
  if (await page.isVisible('#tip [data-intro-skip]')) { const id = await page.getAttribute('#tip [data-intro-skip]', 'data-intro-skip'); await page.tap('#tip [data-intro-skip]'); await page.waitForTimeout(150); check(await G(id => Settings.get('introsDone').includes(id), id), 'Got it skips an intro'); }
  await G(() => { Settings.set('intros', false); Tips.check(); });
}
// a 375 px phone (iPhone mini / SE): every tab row fits, nothing overflows, targets stay at 44 px
{
  const p2 = await (await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
  p2.on('pageerror', e => errors.push('pageerror(375): ' + e.message));
  await p2.goto(file); await p2.waitForTimeout(300); await p2.evaluate(() => Settings.set('tips', false)); await p2.tap('#btnNew'); await p2.tap('#btnStart'); await p2.waitForTimeout(400);
  await p2.addScriptTag({ path: path.join(here, 'bot.js') });
  await p2.evaluate(() => { const G = UI.G, B = {}; UI.setSpeed(0); for (let h = 0; h < 30 * 24; h++) { if (h % 4 === 0) BOT.turn(G, B); KC.step(G); } G.event = null; G._fx = []; HUD.update(); });
  // a station and a trade offer, so the 375 px checks cover the new panels with content in them
  await p2.evaluate(() => { const G = UI.G; for (let y = 2; y < 60; y++) for (let x = 2; x < 60; x++) if (!G.buildings.some(b => b.t === 'station') && KC.canPlace(G, 'station', x, y).ok) { const b = KC.place(G, 'station', x, y); b.built = true; } G.world.offers.push({ id: 991, r: G.world.rivals[0].k, give: { electronics: 12 }, take: { funds: 300 }, until: G.tick + 40, kind: 'sell' }); });
  { const lb = await p2.evaluate(() => { const r = $$('#bottom .tb span').map(e => e.getBoundingClientRect()); let overlap = 0; for (let i = 1; i < r.length; i++) if (r[i].left < r[i - 1].right - 0.5) overlap++; return { n: r.length, overlap, small: $$('#bottom .tb').filter(b => b.getBoundingClientRect().width < 44).length }; }); check(lb.n === 8 && !lb.overlap && !lb.small, 'at 375 px the eight bottom tabs fit, labels apart and 44 px wide (' + JSON.stringify(lb) + ')'); }
  const bad = [];
  for (const js of ['Panels.build("power")', 'Panels.people("list")', 'Panels.people("council")', 'Panels.research()', 'Panels.rockets("fleet")', 'Panels.rockets("exports")', 'Panels.rockets("sponsor")', 'Panels.log()', 'Panels.goals()', '(Panels._gt = "reshape", Panels.goals())', 'Panels.advice()', 'Panels.world("map")', 'Panels.world("rivals")', 'Panels.world("trade")', 'Panels.world("exp")', 'Panels.building(UI.G.buildings.find(b => b.t === "station") || UI.G.buildings[0])']) {
    // measure once the sheet has finished sliding in: mid-animation the translated boxes report sizes like 43.99 px,
    // which failed this check once on a heavily loaded machine
    await p2.evaluate(js); await p2.waitForTimeout(60);
    await p2.evaluate(() => Promise.all(document.getAnimations().filter(a => { const t = a.effect && a.effect.getComputedTiming(); return t && t.iterations !== Infinity; }).map(a => a.finished.catch(() => null))));
    await p2.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await p2.evaluate(() => ({ tabs: Array.from(document.querySelectorAll('#sheet .tabs')).filter(t => t.offsetParent).filter(t => t.scrollWidth > t.clientWidth + 1).length, wide: Array.from(document.querySelectorAll('#sheet button, #sheet .card, #sheet .it')).filter(e => e.offsetParent && e.getBoundingClientRect().right > window.innerWidth + 1).length, small: Array.from(document.querySelectorAll('#sheet button, #hud button')).filter(e => e.offsetParent).map(e => [e, e.getBoundingClientRect()]).filter(([, q]) => Math.round(q.width) < 44 || Math.round(q.height) < 44).map(([e, q]) => (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 16)) + ' ' + q.width.toFixed(1) + 'x' + q.height.toFixed(1)), doc: document.documentElement.scrollWidth }));
    if (r.tabs || r.wide || r.small.length || r.doc > 375) bad.push(js + ' ' + JSON.stringify(r));
  }
  check(bad.length === 0, 'at 375 px every tab row fits, nothing overflows and targets are 44 px' + (bad.length ? ': ' + bad.join(' | ') : ''));
  if (shots) await p2.screenshot({ path: path.join(shots, '27-375-research.png') });
  await p2.close();
}
check(errors.length === 0, 'no page errors or network requests' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
console.log(`\n${oks} passed, ${fails} failed`);
await browser.close();
process.exit(fails ? 1 : 0);
