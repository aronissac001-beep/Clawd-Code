// Browser test of the Phase 4 modes: Endless (single region, no Beacon, run ends on
// defeat with a best record), Daily Realm (fixed seed, best table) and Sandbox
// (all factions and blueprints, no Embers).  python3 -m http.server 8765 &  then  node tools/modes.mjs [outdir]
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '.';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms = 300) => page.waitForTimeout(ms);
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1; };
const pass = (m) => console.log('PASS', m);
await page.goto('http://localhost:8765/?debug=1');
await wait(400);
await page.touchscreen.tap(200, 300); await wait();

async function start(mode) {
  await page.getByText('New Realm').click(); await wait();
  await page.locator('.modeseg button', { hasText: mode }).click(); await wait();
  await page.screenshot({ path: `${out}/mode-${mode}.png` });
  await page.getByText('Kindle the Hearth').click(); await wait(600);
}
async function lose() {
  await ev(() => { const c = window.embercrown.ctl; c.coach.enabled = false; c.coach.hide(); c.s.outcome = { result: 'defeat', reason: 'test' }; });
  await wait(2500);
  // A region-result dialog may come first in some flows; the run summary has a Title button.
  if (!(await page.getByText('Title').count())) { await page.locator('#modal .big-btn').first().click().catch(() => {}); await wait(600); }
}

// Endless
await start('Endless');
let st = await ev(() => { const r = window.embercrown.flow.run, s = window.embercrown.ctl.s; return { mode: r.mode, obj: s && s.objective.type, active: window.embercrown.ctl.active }; });
if (st.mode === 'endless' && st.obj === 'endless' && st.active) pass('endless starts in a region with the endless objective'); else fail('endless start ' + JSON.stringify(st));
await page.locator('#modal .big-btn').first().click().catch(() => {}); await wait();
await page.locator('#modal .choice').first().click().catch(() => {}); await wait();
await ev(() => { const s = window.embercrown.ctl.s; s.cycle.night = 13; s.pending = null; void 0; });
await lose();
st = await ev(() => ({ title: document.querySelector('#modal')?.textContent, best: window.embercrown.meta.best.endless, runs: window.embercrown.meta.runs }));
if (/Long Night/.test(st.title || '') && st.best >= 13) pass('endless defeat ends the run and records best nights ' + st.best); else fail('endless end ' + JSON.stringify(st));
await page.screenshot({ path: `${out}/mode-endless-end.png` });
await page.getByText('Title').click(); await wait();

// Daily
await start('Daily');
st = await ev(() => { const r = window.embercrown.flow.run; return { mode: r.mode, seed: r.seedText, faction: r.faction }; });
if (st.mode === 'daily' && /^DAILY-\d{8}$/.test(st.seed)) pass('daily seed ' + st.seed + ' faction ' + st.faction); else fail('daily ' + JSON.stringify(st));
await page.getByText('Set out').click(); await wait();
await ev(() => window.embercrown.flow.finalizeRun({ result: 'defeat', reason: 'test' }));
const daily = await ev(() => window.embercrown.meta.daily);
if (daily && Object.values(daily)[0].tries === 1) pass('daily result recorded'); else fail('daily record ' + JSON.stringify(daily));
await ev(() => window.embercrown.toMenu()); await wait();
await page.getByText('New Realm').click(); await wait();
await page.locator('.modeseg button', { hasText: 'Daily' }).click(); await wait();
const table = await page.locator('.daily-table').textContent();
if (/today/.test(table)) pass('daily table shows today'); else fail('daily table ' + table);
await page.screenshot({ path: `${out}/mode-daily-table.png` });
await page.getByText('Back').click(); await wait();

// Sandbox
const embers0 = await ev(() => window.embercrown.meta.embers);
await page.getByText('New Realm').click(); await wait();
await page.locator('.modeseg button', { hasText: 'Sandbox' }).click(); await wait();
const locked = await page.locator('.facbtn.locked').count();
if (locked === 0) pass('sandbox opens every faction'); else fail('sandbox locked factions ' + locked);
await page.getByText('Kindle the Hearth').click(); await wait(600);
st = await ev(() => { const r = window.embercrown.flow.run; return { mode: r.mode, bp: r.blueprints.length }; });
if (st.mode === 'sandbox' && st.bp > 15) pass('sandbox blueprints ' + st.bp); else fail('sandbox ' + JSON.stringify(st));
await ev(() => { const r = window.embercrown.flow.run; r.embers = 500; window.embercrown.flow.finalizeRun({ result: 'defeat', reason: 'test' }); });
const embers1 = await ev(() => window.embercrown.meta.embers);
if (embers1 === embers0) pass('sandbox banks no Embers'); else fail(`sandbox embers ${embers0} -> ${embers1}`);

// A saved realm is never overwritten silently: New Realm asks, then banks it as an abandon.
await ev(() => window.embercrown.toMenu()); await wait();
await page.getByText('New Realm').click(); await wait();
await page.locator('.modeseg button', { hasText: 'Campaign' }).click(); await wait();
await page.getByText('Kindle the Hearth').click(); await wait(600);
await page.getByText('Set out').click(); await wait();
await ev(() => { window.embercrown.flow.run.embers = 40; window.embercrown.flow.save(); window.embercrown.toMenu(); }); await wait();
const before = await ev(() => ({ runs: window.embercrown.meta.runs, embers: window.embercrown.meta.embers }));
await page.getByText('New Realm').click(); await wait();
await page.getByText('Kindle the Hearth').click(); await wait(400);
const asked = await page.getByText('Leave your saved realm?').count();
await page.locator('#modal .big-btn', { hasText: 'Yes' }).click(); await wait(600);
const after = await ev(() => ({ runs: window.embercrown.meta.runs, embers: window.embercrown.meta.embers, run: !!window.embercrown.flow.run }));
if (asked && after.runs === before.runs + 1 && after.embers > before.embers && after.run) pass(`New Realm over a saved run asks first and banks it (embers ${before.embers} -> ${after.embers})`);
else fail('replace saved run ' + JSON.stringify({ asked, before, after }));

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
if (errors.length) process.exitCode = 1;
await browser.close();
