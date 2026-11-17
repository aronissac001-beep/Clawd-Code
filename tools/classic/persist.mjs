// Browser regression test for run persistence: every unfinished step survives
// a reload (Beacon choice, Mystery, Merchant, Shrine), a defeat is recorded at
// once, and Escape cannot dismiss a dialog that must be answered.
//   python3 -m http.server 8765 &  then  node tools/classic/persist.mjs [screenshot dir]
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms = 300) => page.waitForTimeout(ms);
let ok = true; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) ok = false; };
const modalTitle = () => page.locator('#modal h2').first().textContent().catch(() => '');
async function boot(fresh) {
  if (fresh) await ev(() => localStorage.clear());
  await page.reload(); await wait(400);
  // The New Realm screen opens after the first realm: mark one played, then take the title's Menu.
  await ev(() => { const a = window.embercrown; if (!(a.meta.runs > 0)) { a.meta.runs = 1; a.saveMeta(); } });
  await page.locator('.title-menu').click(); await wait(300);
}
async function newRun(seed) {
  await page.getByText('New Realm').click();
  await page.locator('.seedrow input').fill(seed);
  await page.getByText('Kindle the Hearth').click(); await wait();
  await page.getByText('Set out').click(); await wait();
}
async function continueRun() { await page.getByText('Continue').click(); await wait(800); }
async function forceNode(type) {
  // New maps have no Shrine (cut in the rework); an older saved map still can, so one is made
  // from an unvisited node to keep that path covered.
  return ev((t) => { const f = window.embercrown.flow, r = f.run; const free = Object.values(r.map.nodes).filter((x) => !r.visited.includes(x.id)); let n = free.find((x) => x.type === t); if (!n && t === 'shrine') { n = free.find((x) => x.type === 'mystery') || free.find((x) => x.type !== 'boss'); n.type = 'shrine'; } r.map.steps[0].push(n.id); n.step = 0; r.pos = null; f.travel(n.id); return n.id; }, type);
}

await page.goto(process.env.CLASSIC_URL || 'http://localhost:8765/classic/'); await boot(true);
await newRun('PERSIST-1');

// 1. Beacon owed survives a reload.
await ev(() => { const f = window.embercrown.flow; f.travel(f.run.map.steps[0][0]); }); await wait(500);
await page.locator('#modal .big-btn').first().click(); await wait(200);
if (await page.locator('#modal .choice').count()) await page.locator('#modal .choice').first().click();
await ev(() => { const c = window.embercrown.ctl; c.coach.enabled = false; c.coach.hide(); c.cmd({ t: 'debug', what: 'win' }); for (let i = 0; i < 20; i++) c.simTick(); c.cmd({ t: 'lightBeacon' }); });
await wait(1500);
check((await modalTitle()).includes('Cleared'), 'region cleared dialog shown');
await page.keyboard.press('Escape'); await wait(200);
check((await modalTitle()).includes('Cleared'), 'Escape does not dismiss the Region Cleared dialog');
await boot(false); await continueRun(); await wait(400);
check((await modalTitle()).includes('Beacon'), `after reload the owed Beacon choice reappears (${await modalTitle()})`);
// The Beacon reward is a relic or a lasting bonus (rework): exactly one of them is granted.
const owned0 = await ev(() => window.embercrown.flow.run.beacons.length + window.embercrown.flow.run.relics.length);
await page.locator('#modal .choice').first().click(); await wait(400);
const owned1 = await ev(() => ({ n: window.embercrown.flow.run.beacons.length + window.embercrown.flow.run.relics.length, owed: !!window.embercrown.flow.run.owedBeacon }));
check(owned1.n === owned0 + 1 && !owned1.owed, `Beacon reward granted once (${owned0} -> ${owned1.n})`);

// 2. Merchant, Mystery and Shrine survive a reload mid-dialog.
for (const [type, title] of [['merchant', 'Merchant'], ['mystery', ''], ['shrine', 'Shrine']]) {
  await forceNode(type); await wait(500);
  const before = await modalTitle();
  await boot(false); await continueRun(); await wait(400);
  const after = await modalTitle();
  check(after && after === before && (!title || after.includes(title)), `${type} dialog re-presented after reload: "${before}" -> "${after}"`);
  // resolve it
  if (type === 'merchant') await page.getByText('Leave').last().click();
  else if (type === 'mystery') { await page.locator('#modal .choice:not(.off)').first().click(); await wait(300); await page.locator('#modal .big-btn').first().click(); }
  else { await page.locator('#modal .choice').first().click(); await wait(300); await page.locator('#modal .big-btn').first().click(); }
  await wait(400);
  if (await page.locator('#modal.open').count()) { const b = page.locator('#modal .choice:not(.off), #modal .big-btn').first(); await b.click().catch(() => {}); await wait(300); if (await page.locator('#modal.open .big-btn').count()) await page.locator('#modal .big-btn').first().click().catch(() => {}); }
  check((await ev(() => window.embercrown.flow.run.pending)) === null, `${type} resolved, nothing pending`);
}

// 3. Defeat is recorded the moment it happens; the pause menu is closed to it.
const runsBefore = await ev(() => window.embercrown.meta.runs);
await forceNode('region'); await wait(500);
await page.locator('#modal .big-btn').first().click(); await wait(200);
if (await page.locator('#modal .choice').count()) await page.locator('#modal .choice').first().click();
// The Hearth is held at 1 health and the nights are called until the Hollow break it (one
// night is not always enough: the defenders may clear a small wave before it arrives).
await ev(() => {
  const c = window.embercrown.ctl; c.coach.enabled = false; c.coach.hide(); c.cmd({ t: 'debug', what: 'boss' });
  for (let i = 0; i < 20 * 600 && !c.s.outcome; i++) {
    if (c.s.pending) c.cmd({ t: 'choose', i: 0 });
    if (c.s.cycle.phase === 'day') c.cmd({ t: 'callNight' });
    if (c.s.rt.hearth.hp > 1) c.s.rt.hearth.hp = 1;
    c.simTick();
  }
  c.frame(0, 0.016);
});
const rec = await ev(() => ({ runs: window.embercrown.meta.runs, saved: !!localStorage.getItem('embercrown.run') }));
check(rec.runs === runsBefore + 1 && !rec.saved, `defeat recorded immediately (runs ${runsBefore} -> ${rec.runs}, save cleared: ${!rec.saved})`);
await ev(() => window.embercrown.ctl.openPauseMenu());
check(!(await page.locator('#modal.open').count()) || !(await page.getByText('Save & Quit').count()), 'pause menu refused after the region ended');
await wait(2000);
check((await modalTitle()).includes('Flame Fades'), `run summary shown (${await modalTitle()})`);

// 4. (The v3-bounties fixture and migrate.mjs were deleted in colony Stage 0; that check retired.)

await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
process.exit(ok && !errors.length ? 0 : 1);
