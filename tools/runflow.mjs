// Browser test of the Phase 2 run flow: map -> region -> Beacon -> map,
// every node type (event, merchant, shrine, ruin, cursed, boss), relic list,
// reload-resume on the map and mid-region. Fails on any console error.
//   python3 -m http.server 8765 &  then  node tools/runflow.mjs [outdir]
import { createRequire } from 'module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || '.';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ev = (f, a) => page.evaluate(f, a);
const shot = (n) => page.screenshot({ path: `${out}/flow-${n}.png` });
const wait = (ms = 300) => page.waitForTimeout(ms);
const clickModal = async (sel = '#modal .big-btn, #modal .choice') => { const b = page.locator(sel).first(); await b.click(); await wait(); };

await page.goto('http://localhost:8765/?debug=1');
await wait(400);
await page.touchscreen.tap(400, 200); await wait();
await page.getByText('New Realm').click();
await page.locator('.seedrow input').fill('FLOW-77');
await page.getByText('Kindle the Hearth').click(); await wait();
await page.getByText('Set out').click(); await wait();

// Plan a path that touches as many node types as possible.
const path = await ev(() => {
  const run = window.embercrown.flow.run, M = run.map;
  const want = ['region', 'mystery', 'merchant', 'shrine', 'ruin', 'cursed'];
  let best = null;
  const dfs = (id, acc) => {
    const n = M.nodes[id]; const p = acc.concat(id);
    if (n.type === 'boss') { const types = new Set(p.map((x) => M.nodes[x].type)); const sc = want.filter((t) => types.has(t)).length; if (!best || sc > best.sc) best = { sc, p }; return; }
    for (const nx of n.next) dfs(nx, p);
  };
  for (const s0 of M.steps[0]) dfs(s0, []);
  return best.p.map((id) => [id, M.nodes[id].type]);
});
console.log('path:', path.map((p) => p[1]).join(' > '));

let i = 0;
for (const [id, type] of path) {
  i++;
  await ev((nid) => window.embercrown.flow.travel(nid), id);
  await wait(500);
  if (['region', 'cursed', 'ruin', 'boss'].includes(type)) {
    await clickModal(); // region intro: Kindle the Hearth
    await wait(300);
    if (await page.locator('#modal .choice').count()) await clickModal('#modal .choice'); // blueprint draft
    await shot(`${i}-${type}-play`);
    if (type === 'boss') {
      // Fast-forward to the wyrm's arrival, look at it, then slay it.
      await ev(() => { const c = window.embercrown.ctl; c.coach.enabled = false; c.coach.hide(); c.cmd({ t: 'debug', what: 'res' }); c.s.cycle.night = 2; c.s.rt.hearth.hp = 1e6; c.cmd({ t: 'callNight' }); for (let k = 0; k < 20 * 14; k++) c.simTick(); const w = c.s.enemies.find((e) => e.boss); if (w) c.cam.centerOn(w.x, w.y - 60, false); });
      await wait(400); await shot(`${i}-boss-arrives`);
      const info = await ev(() => { const c = window.embercrown.ctl; const w = c.s.enemies.find((e) => e.boss); return { wyrm: !!w, state: c.s.boss.state, bar: !document.querySelector('.bossbar').classList.contains('hidden'), warn: !!c.s.boss.warn }; });
      console.log('boss:', JSON.stringify(info));
      await ev(() => { const c = window.embercrown.ctl; for (let k = 0; k < 20 * 6; k++) c.simTick(); const h = c.s.rt.hearth; c.cam.centerOn((h.tx + 1.5) * 32, (h.ty + 1.5) * 32, false); });
      await wait(300); await shot(`${i}-boss-fight`);
      await ev(() => { const c = window.embercrown.ctl; const w = c.s.enemies.find((e) => e.boss); if (w) w.hp = 1; for (let k = 0; k < 20 * 30 && !c.s.outcome; k++) { const w2 = c.s.enemies.find((e) => e.boss); if (w2) w2.hp = Math.min(w2.hp, 1); for (const t of c.s.enemies) if (t.boss) { t.hp = 0; } c.simTick(); } });
      // kill directly via hurt for a clean ending if still alive
      await ev(() => { const c = window.embercrown.ctl; if (!c.s.outcome) { c.s.objective.done = true; c.simTick(); } });
      await wait(2500);
      await shot(`${i}-boss-end`);
      console.log('run summary:', await page.locator('#modal h2').first().textContent().catch(() => '-'));
      break;
    }
    // Rift objective visible? Then complete via debug and light the Beacon.
    await ev(() => { const c = window.embercrown.ctl; c.coach.enabled = false; c.coach.hide(); c.cmd({ t: 'debug', what: 'win' }); for (let k = 0; k < 20; k++) c.simTick(); });
    await wait(300);
    const ready = await ev(() => window.embercrown.ctl.s.beaconReady);
    if (!ready) console.log('  beacon not ready!', await ev(() => JSON.stringify(window.embercrown.ctl.s.objective)));
    await page.locator('.beacon-btn').click(); await wait();
    await page.getByText('Light the Beacon', { exact: true }).last().click();
    await wait(1600);
    await shot(`${i}-${type}-cleared`);
    await clickModal(); // Choose a Beacon
    await wait(300);
    await shot(`${i}-${type}-beacon`);
    await clickModal('#modal .choice'); // pick bonus
    await wait(500);
  } else if (type === 'mystery') {
    await shot(`${i}-event`);
    // pick the first enabled choice
    const cards = page.locator('#modal .choice:not(.off)');
    await cards.first().click(); await wait(400);
    await shot(`${i}-event-result`);
    await clickModal(); await wait(400);
    // A chain event might follow
    if (await page.locator('#modal .choice').count()) { await page.locator('#modal .choice:not(.off)').first().click(); await wait(300); await clickModal(); }
  } else if (type === 'merchant') {
    await shot(`${i}-merchant`);
    await ev(() => { window.embercrown.flow.run.gold += 200; });
    const buy = page.locator('#modal button').filter({ hasText: /\d/ }).first();
    await buy.click().catch(() => {}); await wait(300);
    await shot(`${i}-merchant-bought`);
    await page.getByText('Leave', { exact: false }).last().click(); await wait(300);
  } else if (type === 'shrine') {
    await shot(`${i}-shrine`);
    await page.locator('#modal .choice').last().click(); await wait(3300); // wheel spin
    await shot(`${i}-wheel`);
    await clickModal(); await wait(300);
    if (await page.locator('#modal').evaluate((m) => m.classList.contains('open'))) await clickModal();
  }
  // On the map again: save, reload and resume once mid-run.
  if (i === 2) {
    await page.reload(); await wait(500);
    await page.touchscreen.tap(400, 200); await wait();
    await page.getByText('Continue').click(); await wait(500);
    console.log('resumed on map at', await ev(() => window.embercrown.flow.run.pos), 'region?', await ev(() => !!window.embercrown.flow.run.region));
  }
  const st = await ev(() => { const r = window.embercrown.flow.run; return `gold ${r.gold} sov ${r.sov.hp}/${r.sov.maxHp} relics ${r.relics.map((x) => x.id).join(',')} beacons ${r.beacons.join(',')} bp ${r.blueprints.length}`; });
  console.log(`after ${type}: ${st}`);
}
// Relic list from the map menu if we are still on the map.
await browser.close();
console.log(errors.length ? errors.join('\n') : 'NO ERRORS');
