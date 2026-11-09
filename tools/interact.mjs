// Interaction test: drag-to-place from the build bar, wall line handle,
// building card (train/upgrade), squad + Sovereign orders, pause menu,
// settings, save export/import round trip, reload-resume.
//   node tools/interact.mjs [outdir]
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '.';
const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:8765/');
await page.waitForTimeout(500);
await page.touchscreen.tap(400, 200);
await page.waitForTimeout(300);
await page.getByText('New Realm').click();
await page.locator('.seedrow input').fill('TEST-77');
await page.getByText('Kindle the Hearth').click();
await page.waitForTimeout(300);
await page.getByText('Begin', { exact: true }).click();
await page.waitForTimeout(500);
const S = () => page.evaluate(() => window.embercrown.ctl.s);
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => { const a = window.embercrown; a.ctl.cmd({ t: 'debug', what: 'res' }); a.ctl.cmd({ t: 'debug', what: 'res' }); });

// 1. Drag a House out of the build bar onto the map with the mouse.
const house = await page.locator('.item[data-type="house"]').boundingBox();
await page.mouse.move(house.x + 30, house.y + 30);
await page.mouse.down();
for (let i = 1; i <= 12; i++) await page.mouse.move(house.x + 30 - i * 12, house.y + 30 - i * 16);
await page.mouse.up();
await page.waitForTimeout(200);
const ghost1 = await ev(() => window.embercrown.ctl.ui.ghost && { type: window.embercrown.ctl.ui.ghost.type, valid: window.embercrown.ctl.ui.ghost.valid });
console.log('ghost after drag:', JSON.stringify(ghost1));
await page.screenshot({ path: `${out}/i-1-drag.png` });
if (ghost1 && !ghost1.valid[0]) {
  // move the ghost to a valid place by tapping candidates
  await ev(() => { const c = window.embercrown.ctl; c.placement.anchor = c.nearestValid('house', c.placement.anchor); });
  await page.waitForTimeout(100);
}
await page.locator('.place .ok').click();
await page.waitForTimeout(200);
console.log('buildings after house:', (await ev(() => window.embercrown.ctl.s.buildings.map((b) => b.type).join(','))));

// 2. Wall: tap the wall button (defense tab), drag the handle to make a line.
await page.locator('.tab[data-cat="defense"]').click();
await page.locator('.item[data-type="wall"]').click();
await page.waitForTimeout(150);
const handle = await ev(() => { const c = window.embercrown.ctl; const g = c.ui.ghost; const p = c.cam.worldToScreen((g.handle[0] + 0.5) * 32, (g.handle[1] + 0.5) * 32); return { x: p.x, y: p.y, n: g.tiles.length }; });
await page.mouse.move(handle.x, handle.y); await page.mouse.down();
for (let i = 1; i <= 8; i++) await page.mouse.move(handle.x + i * 20, handle.y);
await page.mouse.up();
await page.waitForTimeout(100);
const g2 = await ev(() => { const g = window.embercrown.ctl.ui.ghost; return { n: g.tiles.length, ok: g.valid.filter(Boolean).length }; });
console.log('wall line tiles before/after handle drag:', handle.n, '->', JSON.stringify(g2));
await page.screenshot({ path: `${out}/i-2-wall.png` });
await page.locator('.place .ok').click();
await page.waitForTimeout(100);

// 3. Barracks via command, finish construction, open its card and train.
await ev(() => {
  const c = window.embercrown.ctl; const s = c.s;
  const at = c.nearestValid('barracks', [s.rt.hearth.tx - 4, s.rt.hearth.ty + 4]);
  c.cmd({ t: 'place', type: 'barracks', tiles: [at] });
  for (let i = 0; i < 20 * 30; i++) c.simTick();
});
const bar = await ev(() => { const c = window.embercrown.ctl; const b = c.s.buildings.find((x) => x.type === 'barracks'); const p = c.cam.worldToScreen((b.tx + 1) * 32, (b.ty + 1.5) * 32); c.cam.centerOn((b.tx + 1) * 32, (b.ty + 1) * 32, false); return { built: b.built }; });
console.log('barracks built:', bar.built);
await page.waitForTimeout(200);
const bpos = await ev(() => { const c = window.embercrown.ctl; const b = c.s.buildings.find((x) => x.type === 'barracks'); return c.cam.worldToScreen((b.tx + 1) * 32, (b.ty + 1.6) * 32); });
await page.touchscreen.tap(bpos.x, bpos.y);
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/i-3-card.png` });
for (let i = 0; i < 3; i++) { await page.locator('.unitbtn').nth(i).click(); await page.waitForTimeout(80); }
await ev(() => { for (let i = 0; i < 20 * 25; i++) window.embercrown.ctl.simTick(); });
console.log('soldiers:', await ev(() => window.embercrown.ctl.s.soldiers.map((u) => u.type).join(',')), 'squads:', await ev(() => window.embercrown.ctl.s.squads.length));
await page.locator('.cbtn.gold').first().click();
console.log('barracks upgrading:', await ev(() => window.embercrown.ctl.s.buildings.find((x) => x.type === 'barracks').upg));
await page.locator('.card .close').click();

// 4. Select the squad by its portrait, check slow-mo, tap the ground to move.
await page.locator('.portrait').nth(1).click();
await page.waitForTimeout(100);
console.log('selection:', JSON.stringify(await ev(() => window.embercrown.ctl.selection)), 'timeScale:', await ev(() => window.embercrown.loop.timeScale));
await page.screenshot({ path: `${out}/i-4-selected.png` });
await page.touchscreen.tap(300, 230);
await page.waitForTimeout(100);
const q = await ev(() => { const s = window.embercrown.ctl.s; const q = s.squads[0]; return { rx: Math.round(q.rx), ry: Math.round(q.ry), sel: window.embercrown.ctl.selection }; });
console.log('after order:', JSON.stringify(q));

// 5. Night with enemies; order the Sovereign to attack one.
await ev(() => { const c = window.embercrown.ctl; c.cmd({ t: 'callNight' }); for (let i = 0; i < 20 * 16; i++) c.simTick(); });
await page.locator('.portrait').first().click();
const foe = await ev(() => { const c = window.embercrown.ctl; const e = c.s.enemies[0]; if (!e) return null; c.cam.centerOn(e.x, e.y, false); return { id: e.id }; });
await page.waitForTimeout(100);
if (foe) {
  const fp = await ev(() => { const c = window.embercrown.ctl; const e = c.s.enemies[0]; return c.cam.worldToScreen(e.x, e.y - 10); });
  await page.touchscreen.tap(fp.x, fp.y);
  console.log('sovereign attack order target:', await ev(() => window.embercrown.ctl.s.sovereign.orderTarget));
}
await page.screenshot({ path: `${out}/i-5-night.png` });
// Nova
await ev(() => { window.embercrown.ctl.ability('nova'); });
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/i-6-nova.png` });

// 6. Long-press an enemy for info.
const lp = await ev(() => { const c = window.embercrown.ctl; const e = c.s.enemies[0]; return e ? c.cam.worldToScreen(e.x, e.y - 10) : null; });
if (lp) { await page.mouse.move(lp.x, lp.y); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up(); }
console.log('card open:', await page.locator('.card').isVisible(), await page.locator('.card h3').textContent().catch(() => ''));

// 7. Pause menu -> settings -> export -> import round trip.
await page.locator('.corner .hbtn').nth(2).click();
await page.getByText('Settings').click();
await page.getByText('Export save').click();
await page.waitForTimeout(800);
const code = await page.locator('textarea.code').inputValue();
console.log('export code:', code.slice(0, 12) + '...', code.length, 'chars');
await page.getByText('Back').click();
await page.getByText('Import save').click();
await page.locator('textarea.code').fill(code);
await page.getByText('Import code').click();
await page.waitForTimeout(500);
console.log('after import on menu, continue visible:', await page.getByText('Continue').isVisible());

// 8. Reload resumes.
await page.reload();
await page.waitForTimeout(500);
await page.touchscreen.tap(400, 200);
await page.waitForTimeout(300);
await page.getByText('Continue').click();
await page.waitForTimeout(500);
console.log('resumed:', JSON.stringify(await ev(() => { const s = window.embercrown.ctl.s; return { seed: s.seedText, phase: s.cycle.phase, b: s.buildings.length, sol: s.soldiers.length }; })));
await page.screenshot({ path: `${out}/i-7-resumed.png` });
await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
