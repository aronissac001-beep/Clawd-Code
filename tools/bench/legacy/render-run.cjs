// Legacy render bench (old renderer, from classic/). Serve the repo root first:
//   python3 -m http.server 8799   then   node tools/bench/legacy/render-run.cjs
const { chromium, devices } = require('module').createRequire(__filename)('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [n, thr] of [[40, 1], [128, 1], [128, 4]]) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log('pageerror', e.message));
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
    await p.goto(`http://localhost:8799/tools/bench/legacy/render.html?n=${n}`);
    await p.waitForFunction(() => window.RESULT, null, { timeout: 280000 });
    console.log(`N=${n} cpuThrottle=${thr}x`, JSON.stringify(await p.evaluate(() => window.RESULT)));
    await ctx.close();
  }
  await b.close();
})();
