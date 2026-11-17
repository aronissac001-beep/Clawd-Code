// Interaction test: drag-to-place from the build bar, wall line handle,
// building card (train/upgrade), squad + Sovereign orders, pause menu,
// settings, save export/import round trip, reload-resume.
//   node tools/classic/interact.mjs [outdir]
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'tools/out';
const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(process.env.CLASSIC_URL || 'http://localhost:8765/classic/');
await page.waitForTimeout(500);
// The New Realm screen opens after the first realm: mark one played, then take the title's Menu.
await page.evaluate(() => { const a = window.embercrown; a.meta.runs = Math.max(1, a.meta.runs || 0); a.saveMeta(); });
await page.locator('.title-menu').click();
await page.waitForTimeout(300);
await page.getByText('New Realm').click();
await page.locator('.seedrow input').fill('TEST-77');
await page.getByText('Kindle the Hearth').click();
await page.waitForTimeout(300);
await page.getByText('Set out').click();
await page.waitForTimeout(300);
await page.evaluate(() => { const f = window.embercrown.flow; f.travel(f.run.map.steps[0][0]); });
await page.waitForTimeout(400);
await page.locator('#modal .big-btn').first().click();
await page.waitForTimeout(300);
await page.locator('#modal .choice').first().click();
await page.waitForTimeout(500);
const S = () => page.evaluate(() => window.embercrown.ctl.s);
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => { const a = window.embercrown; a.ctl.cmd({ t: 'debug', what: 'res' }); a.ctl.cmd({ t: 'debug', what: 'res' }); });

// 1. Drag a House out of the build bar and let go on a valid spot: built in one gesture (no ✓).
//    The finger is aimed 32 px below the spot (the ghost rides above the finger).
const house = await page.locator('.item[data-type="house"]').boundingBox();
const spot = await ev(async () => {
  const c = window.embercrown.ctl, ins = c.renderer.insets;
  const sz = (await import('/js/data/buildings.js')).BUILDINGS.house.size;
  const [ax, ay] = c.nearestValid('house', c.tileUnder((ins.left + c.app.vw - ins.right) / 2, (ins.top + c.app.vh - ins.bottom) / 2 - 32, 'house'));
  const p = c.cam.worldToScreen((ax + sz / 2) * 32, (ay + sz / 2) * 32);
  return { ax, ay, x: p.x, y: p.y + 32, n: c.s.buildings.length };
});
await page.mouse.move(house.x + 30, house.y + 30);
await page.mouse.down();
await page.mouse.move(house.x + 30, house.y + 10);
for (let i = 1; i <= 12; i++) await page.mouse.move(house.x + 30 + (spot.x - house.x - 30) * i / 12, house.y + 10 + (spot.y - house.y - 10) * i / 12);
await page.screenshot({ path: `${out}/i-1-drag.png` });
await page.mouse.up();
await page.waitForTimeout(200);
const h1 = await ev(() => ({ ghost: !!window.embercrown.ctl.placement, types: window.embercrown.ctl.s.buildings.map((b) => b.type) }));
console.log('buildings after house drag:', h1.types.join(','), 'ghost left:', h1.ghost);
if (h1.ghost || !h1.types.includes('house') || h1.types.length !== spot.n + 1) errors.push('drag-to-build: the House was not placed in one gesture');

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
await page.locator('.card .abtn.gold').first().click(); // Upgrade (the card's action row)
console.log('barracks upgrading:', await ev(() => window.embercrown.ctl.s.buildings.find((x) => x.type === 'barracks').upg));
await page.locator('.card .close').click();

// 4. Select the squad by its portrait (time does not change), tap the ground to move; the
//    selection stays for the next order.
await page.locator('.portrait').nth(1).click();
await page.waitForTimeout(100);
const ts = await ev(() => window.embercrown.loop.timeScale);
console.log('selection:', JSON.stringify(await ev(() => window.embercrown.ctl.selection)), 'timeScale:', ts);
if (ts !== 1) errors.push('selecting a squad changed timeScale to ' + ts);
await page.screenshot({ path: `${out}/i-4-selected.png` });
await page.touchscreen.tap(300, 230);
await page.waitForTimeout(100);
const q = await ev(() => { const s = window.embercrown.ctl.s; const q = s.squads[0]; return { rx: Math.round(q.rx), ry: Math.round(q.ry), sel: window.embercrown.ctl.selection }; });
console.log('after order:', JSON.stringify(q));
if (!q.sel || q.sel.kind !== 'squad') errors.push('the squad selection did not persist after its order: ' + JSON.stringify(q.sel));

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
// Hold the clock while pressing (foes walk ~40 units in 600 ms) and pick a foe
// that is not covered by a friendly, so the press lands on the enemy itself.
const lp = await ev(() => {
  const c = window.embercrown.ctl; c.paused = true;
  for (const e of c.s.enemies) {
    if (!e.alive) continue;
    c.cam.centerOn(e.x, e.y, false);
    const p = c.cam.worldToScreen(e.x, e.y - 10);
    if (c.pick(p).kind === 'enemy') return p;
  }
  return null;
});
await page.waitForTimeout(100);
if (lp) { await page.mouse.move(lp.x, lp.y); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up(); }
console.log('card open:', await page.locator('.card').isVisible(), await page.locator('.card h3').textContent({ timeout: 1000 }).catch(() => ''));
await ev(() => { window.embercrown.ctl.paused = false; });

// 7. Pause menu -> settings -> export -> import round trip.
await page.locator('.controls .hbtn[aria-label="Menu"]').click();
await page.getByText('Settings').click();
await page.getByText('Export save').click();
await page.waitForTimeout(800);
const code = await page.locator('textarea.code').inputValue();
console.log('export code:', code.slice(0, 12) + '...', code.length, 'chars');
await page.screenshot({ path: `${out}/i-export.png` });
await page.getByRole('button', { name: 'Back', exact: true }).click();
await page.getByText('Import save').click();
await page.locator('textarea.code').fill(code);
await page.getByText('Import code').click();
await page.waitForTimeout(500);
console.log('after import on menu, continue visible:', await page.getByText('Continue').isVisible());

// 8. Reload resumes.
await page.reload();
await page.waitForTimeout(500);
await page.locator('.title-menu').click();
await page.waitForTimeout(300);
await page.getByText('Continue').click();
await page.waitForTimeout(500);
console.log('resumed:', JSON.stringify(await ev(() => { const s = window.embercrown.ctl.s; return { seed: s.seedText, phase: s.cycle.phase, b: s.buildings.length, sol: s.soldiers.length }; })));
await page.screenshot({ path: `${out}/i-7-resumed.png` });
await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
