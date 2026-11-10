// Scripted "human" playthrough through the real UI (taps, not engine calls) with screenshots.
// Run: node games/starwake/tools/playtest.mjs [years=40] [screenshotDir] [size=medium]
// Time is advanced in 30-day steps; every decision is made by tapping buttons the way a player would.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const YEARS = +(process.argv[2] || 40), shots = process.argv[3], size = process.argv[4] || 'medium';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [], badToasts = new Map(), taps = {}, blocked = [];
page.on('pageerror', e => errors.push(e.message));
const tap = async (sel, why) => { const l = page.locator(sel).first(); if (!(await l.count()) || !(await l.isVisible()) || !(await l.isEnabled())) return false; try { await l.tap({ timeout: 2500 }); } catch (err) { blocked.push(why + ': ' + (String(err.message).match(/<[^>]+> from <[^>]+>|intercepts pointer events|[^\n]+/) || [''])[0]); if (shots) await page.screenshot({ path: path.join(shots, 'blocked-' + blocked.length + '.png') }); return false; } taps[why] = (taps[why] || 0) + 1; await page.waitForTimeout(40); return true; };
const shot = async n => { if (shots) await page.screenshot({ path: path.join(shots, n + '.png') }); };
await page.goto('file://' + path.join(here, '../../../docs/starwake/index.html'));
await page.waitForTimeout(300);
await tap('text=New game', 'setup');
await tap(`.seg button:has-text("${size[0].toUpperCase() + size.slice(1)}")`, 'setup');
await page.fill('input[type=text] >> nth=-1', 'playtest-1');
await tap('text=Begin', 'setup');
await page.waitForSelector('#hud:not([hidden])');
await page.evaluate(() => { const t = document.getElementById('tip'); if (t) t.remove(); Settings.set('tips', false); });
const closeScreen = async () => { for (let k = 0; k < 3 && await page.isVisible('.screen .head button[aria-label=Close]'); k++) await tap('.screen .head button[aria-label=Close]', 'navigate'); };
const handleDialogs = async () => { for (let k = 0; k < 8 && await page.isVisible('.dlg .opts button'); k++) { await page.locator('.dlg .opts button').first().tap(); taps.events = (taps.events || 0) + 1; await page.waitForTimeout(40); } };
const tapSystem = async (sid) => {
  const xy = await page.evaluate(id => { if (renderer.mode === 'system') exitSystem(); renderer.centerOn(id, false, 0.8); renderer.draw(UI.G, 0); const s = UI.G.systems[id]; return [(s.x - renderer.cam.x) * renderer.cam.z + renderer.w / 2, (s.y - renderer.cam.y) * renderer.cam.z + renderer.h / 2]; }, sid);
  await page.touchscreen.tap(xy[0], xy[1]); taps.map = (taps.map || 0) + 1; await page.waitForTimeout(60);
};
let year = 0;
for (let month = 1; month <= YEARS * 12; month++) {
  await page.evaluate(() => { const G = UI.G; for (let i = 0; i < 30 && !G.over; i++) { SW.advanceDay(G); if (SW.playerEvents(G, UI.pid).length) break; } afterDays(1); });
  // collect red toasts the player saw
  for (const t of await page.evaluate(() => Array.from(document.querySelectorAll('.toast.bad')).filter(el => !el.dataset.seen).map(el => { el.dataset.seen = 1; return el.textContent; }))) { const k = t.replace(/[0-9.]+/g, '#'); badToasts.set(k, (badToasts.get(k) || 0) + 1); }
  await closeScreen();
  await handleDialogs();
  if (await page.evaluate(() => UI.G.over)) break;
  const st = await page.evaluate(() => { const G = UI.G, e = G.empires[UI.pid]; return { noResearch: RESEARCH.some(k => !e.research[k].cur), trad: TRADITION_KEYS.some(k => !SW.canTradition(G, e, k)), minerals: e.res.minerals, alloys: e.res.alloys, influence: e.res.influence,
    target: SW.bestOutpostTarget(G, e, G_capSys()), builderBusy: G.fleets.filter(f => f.owner === UI.pid && f.kind === 'builder').every(f => f.order), queueArk: SW.shipyards(G, e).some(sid => G.systems[sid].sb.queue.some(q => q.then && q.then.t === 'colonize')) || G.fleets.some(f => f.owner === UI.pid && f.kind === 'colony'),
    capFree: (() => { const p = G.planets[e.capital]; return p && p.col ? SW.bldSlots(p) - SW.bldUsed(p.col) : 0; })(), cap: e.capital, war: SW.warsOf(G, UI.pid).length }; });
  if (st.noResearch) { await tap('#n_research', 'research'); for (const k of [0, 1, 2]) { const c = page.locator('.card:has(.tech)').nth(k); if (await c.count() && await c.locator('.warnc').count()) { await c.locator('.tech').first().tap(); taps.research++; } } await closeScreen(); }
  if (st.trad) { await tap('#n_empire', 'traditions'); await tap('.tabs button:has-text("Traditions")', 'traditions'); await tap('.trad button.pri', 'traditions'); await closeScreen(); }
  if (st.target >= 0 && !st.builderBusy && st.influence > 60) { await tapSystem(st.target); const ok = await tap('#sel button:has-text("Claim system")', 'expand'); if (!ok && process.env.PT_VERBOSE) { console.log('claim failed', st.target, await page.evaluate(() => ({ selSys: UI.selSys, selFleet: UI.selFleet, mode: renderer.mode, screen: !!UI.screen, sel: document.getElementById('sel').innerText.slice(0, 200) }))); } }
  if (!st.queueArk && st.minerals > 380 && month % 3 === 0) { await tap('#n_outliner', 'colonize'); const ok = await tap('.screen .item button:has-text("Colonize")', 'colonize'); if (!ok) await closeScreen(); else if (await page.isVisible('.screen')) await closeScreen(); }
  if (st.capFree > 0 && st.minerals > 450 && month % 4 === 0) { await page.evaluate(id => openPlanet(id), st.cap); taps.planet = (taps.planet || 0) + 1; await tap('text=Construct a building', 'planet'); await tap('.dlg .item:not(.dis)', 'planet'); await tap('.dlg button:has-text("Cancel")', 'planet'); await closeScreen(); }
  if (month % 12 === 6 && st.alloys > (st.war ? 250 : 500)) { await page.evaluate(() => openStarbase(G_capSys())); taps.military = (taps.military || 0) + 1; const five = page.locator('.screen .item button[aria-label="Build five"]').last(); if (await five.count() && await five.isEnabled()) { await five.tap(); taps.military++; } await closeScreen(); }
  await handleDialogs();
  if (month % 36 === 0 && process.env.PT_VERBOSE) console.log(await page.evaluate(() => { const G = UI.G, e = G.empires[UI.pid]; return SW.dateStr(G.day) + ' sys ' + SW.ownedSystems(G, e).length + ' cols ' + SW.colonies(G, e).length + ' inf ' + Math.round(e.res.influence) + '/' + SW.empireEcon(G, e).net.influence.toFixed(1) + ' alloys ' + Math.round(e.res.alloys) + ' minerals ' + Math.round(e.res.minerals) + ' builders ' + G.fleets.filter(f => f.owner === UI.pid && f.kind === 'builder').map(f => f.order ? f.order.t : 'idle').join(',') + ' target ' + SW.bestOutpostTarget(G, e, G_capSys()); }));
  if (month % 60 === 0) { year = month / 12; await page.evaluate(() => { clearSel(); renderer.request(); }); await page.waitForTimeout(80); await shot(`pt-${String(year).padStart(2, '0')}y`); }
}
const sum = await page.evaluate(() => { const G = UI.G, e = G.empires[UI.pid]; const rank = SW.alive(G).map(x => SW.scoreOf(G, x).total).sort((a, b) => b - a).indexOf(SW.scoreOf(G, e).total) + 1;
  return { date: SW.dateStr(G.day), alive: e.alive, colonies: SW.colonies(G, e).length, systems: SW.ownedSystems(G, e).length, pops: SW.totalPops(G, e), techs: e.stats.techs, power: SW.empirePower(G, e), rank, of: SW.alive(G).length, wars: G.log.filter(l => /declared war on the/.test(l.m) && l.m.includes(e.name)).length, over: G.over && G.winner }; });
console.log('result', JSON.stringify(sum));
console.log('taps', JSON.stringify(taps), 'total', Object.values(taps).reduce((a, b) => a + b, 0));
console.log('red toasts seen:', JSON.stringify([...badToasts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)));
console.log('blocked taps:', blocked.length, JSON.stringify(blocked.slice(0, 6)));
console.log(errors.length ? 'page errors: ' + errors.slice(0, 5).join(' | ') : 'no page errors');
await browser.close();
