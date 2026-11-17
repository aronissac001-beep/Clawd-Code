// Rework stream H2 browser check: the one-tap start (taps from the title to the first building
// ghost), the Dawn Card and Beacon reward dialogs, and the New Realm screen fitting without scroll.
//   python3 -m http.server 8765 &  then  node tools/start.mjs [outdir]   (PORT=... to change)
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '.';
const PORT = process.env.PORT || 8765;
const URL = `http://localhost:${PORT}/`;
const browser = await chromium.launch();
const errors = [];
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails++; };
async function run(name, viewport) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}\n${e.stack}`));
  const wait = (ms = 350) => page.waitForTimeout(ms);
  await page.goto(URL); await wait(700);
  await page.screenshot({ path: `${out}/${name}-0-title.png` });
  let taps = 0;
  const tap = async (loc) => { const b = await loc.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); taps++; await wait(); };
  await tap(page.locator('.title-play'));
  await wait(400);
  await page.screenshot({ path: `${out}/${name}-1-intro.png` });
  // Region intro, then the opening blueprint pick.
  if (await page.locator('#modal.open .big-btn').count()) await tap(page.locator('#modal .big-btn').first());
  await page.screenshot({ path: `${out}/${name}-2-draft.png` });
  if (await page.locator('#modal.open .choice').count()) await tap(page.locator('#modal .choice').first());
  await wait(300);
  await tap(page.locator('.item[data-type="farm"]'));
  const ghost = await page.evaluate(() => !!window.embercrown.ctl.placement);
  await page.screenshot({ path: `${out}/${name}-3-ghost.png` });
  check(ghost && taps <= 4, `[${name}] taps from the title to the first building ghost: ${taps} (ghost ${ghost})`);
  // Play to the first dawn: the dawn card.
  await page.evaluate(() => { const c = window.embercrown.ctl; c.coach.enabled = false; c.coach.hide(); if (c.placement) c.cancelPlacement && c.cancelPlacement(); c.cmd({ t: 'debug', what: 'res' }); c.cmd({ t: 'callNight' }); for (let i = 0; i < 20 * 90 && !c.s.pending; i++) c.simTick(); });
  await wait(700);
  const k1 = await page.evaluate(() => { const s = window.embercrown.ctl.s; return s.pending && s.pending.kind; });
  await page.screenshot({ path: `${out}/${name}-4-dawncard.png` });
  const cards = await page.locator('#modal.open .choice').count();
  check(k1 === 'dawnCard' && cards >= 3, `[${name}] dawn 1 offers one dawn card pick (${k1}, ${cards} cards)`);
  const small = await page.evaluate(() => { let bad = 0; for (const n of document.querySelectorAll('#modal *')) { if (!n.childNodes.length || ![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue; if (parseFloat(getComputedStyle(n).fontSize) < 14) bad++; } return bad; });
  check(small === 0, `[${name}] dawn card text >= 14px (${small} smaller)`);
  const tgt = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#modal .choice')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
  check(tgt >= 44, `[${name}] dawn cards are >= 44 pt touch targets (${Math.round(tgt)})`);
  await tap(page.locator('#modal .choice').first());
  // Hold to the Long Night's dawn: the Beacon reward.
  await page.evaluate(() => { const c = window.embercrown.ctl; c.s.rt.hearth.hp = c.s.rt.hearth.maxHp = 1e6; if (c.s.sovereign) c.s.sovereign.hp = c.s.sovereign.maxHp = 1e6; const rift = c.s.enemies.find((e) => e.type === 'rift' && e.alive); if (rift) { rift.hp = 1; c.s.objective.done = true; c.s.objective.riftId = 0; } for (let n = 0; n < 2; n++) { c.cmd({ t: 'callNight' }); for (let i = 0; i < 20 * 120 && !c.s.pending; i++) c.simTick(); if (c.s.pending && c.s.pending.kind !== 'beaconPick') { c.cmd({ t: 'choose', i: 0 }); c.app.modal.close(); } } });
  await wait(700);
  const k3 = await page.evaluate(() => { const s = window.embercrown.ctl.s; return [s.pending && s.pending.kind, s.cycle.night, s.beaconReady]; });
  await page.screenshot({ path: `${out}/${name}-5-beacon.png` });
  check(k3[0] === 'beaconPick', `[${name}] the Long Night's dawn offers the Beacon reward (${JSON.stringify(k3)})`);
  await ctx.close();
  // The New Realm screen (opens after the first run) fits without scrolling.
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'], viewport, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(`[${name}/setup] pageerror: ${e.message}`));
  p2.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}/setup] ${m.type()}: ${m.text()}`); });
  await p2.goto(URL); await p2.waitForTimeout(600);
  await p2.evaluate(() => { const a = window.embercrown; a.meta.runs = 1; a.meta.actsWon = 1; a.saveMeta(); a.toSetup(); });
  await p2.waitForTimeout(500);
  await p2.screenshot({ path: `${out}/${name}-6-setup.png` });
  const fit = await p2.evaluate(() => { const s = document.querySelector('#screens .screen'); return { sh: s.scrollHeight, ch: s.clientHeight, vh: innerHeight, sw: s.scrollWidth, cw: s.clientWidth }; });
  check(fit.sh <= fit.ch && fit.sh <= fit.vh && fit.sw <= fit.cw, `[${name}] setup screen fits (scrollHeight ${fit.sh} <= ${fit.ch}, viewport ${fit.vh}; width ${fit.sw}/${fit.cw})`);
  await ctx2.close();
}
await run('port', { width: 390, height: 844 });
await run('land', { width: 844, height: 390 });
await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO CONSOLE ERRORS');
if (errors.length) fails++;
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
