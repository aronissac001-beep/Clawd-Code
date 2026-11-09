// Browser smoke test: boots the game at iPhone sizes, starts a realm, places
// buildings, runs to night and back, and reports console errors.
//   python3 -m http.server 8765 &  then  node tools/smoke.mjs [outdir]
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '.';
const URL = 'http://localhost:8765/?debug=1';
const browser = await chromium.launch();
const errors = [];
async function run(name, viewport) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${name}] ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}\n${e.stack}`));
  page.on('requestfailed', (r) => errors.push(`[${name}] 404/failed: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${name}] HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(URL);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}-0-title.png` });
  await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-1-menu.png` });
  await page.getByText('New Realm').click();
  await page.waitForTimeout(300);
  await page.locator('.seedrow input').fill('EMBER-1234');
  await page.screenshot({ path: `${out}/${name}-2-setup.png` });
  await page.getByText('Kindle the Hearth').click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-3-intro.png` });
  await page.getByText('Set out').click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { const f = window.embercrown.flow; f.travel(f.run.map.steps[0][0]); });
  await page.waitForTimeout(400);
  await page.locator('#modal .big-btn').first().click();
  await page.waitForTimeout(300);
  await page.locator('#modal .choice').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}-4-game.png` });
  // Tap the farm button: the ghost appears mid-screen; confirm it.
  await page.locator('.item[data-type="farm"]').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-5-ghost.png` });
  const ok = page.locator('.place .ok');
  if (await ok.isVisible()) await ok.click();
  await page.waitForTimeout(300);
  // Advance time quickly using the sim directly.
  await page.evaluate(() => { const a = window.embercrown; for (let i = 0; i < 20 * 25; i++) a.ctl.simTick(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-6-day.png` });
  await page.evaluate(() => { const a = window.embercrown; a.ctl.cmd({ t: 'callNight' }); for (let i = 0; i < 20 * 9; i++) a.ctl.simTick(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-7-dusk.png` });
  await page.evaluate(() => { const a = window.embercrown; for (let i = 0; i < 20 * 14; i++) a.ctl.simTick(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-8-night.png` });
  await page.evaluate(() => { const a = window.embercrown; for (let i = 0; i < 20 * 60 && !a.ctl.s.pending; i++) a.ctl.simTick(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}-9-dawn.png` });
  const state = await page.evaluate(() => { const s = window.embercrown.ctl.s; return { phase: s.cycle.phase, night: s.cycle.night, res: s.res, vill: s.villagers.length, b: s.buildings.map((b) => b.type + (b.built ? '' : '*')).join(','), kills: s.stats.kills, outcome: s.outcome }; });
  console.log(name, JSON.stringify(state));
  await ctx.close();
}
await run('land', { width: 844, height: 390 });
await run('port', { width: 390, height: 844 });
await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO CONSOLE ERRORS');
