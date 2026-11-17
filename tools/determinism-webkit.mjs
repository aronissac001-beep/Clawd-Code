// Gate check "Determinism" in Playwright WebKit (JavaScriptCore, the engine of every iPhone browser).
//   node tools/determinism-webkit.mjs [--scenes=slice,bot|stub] [--ticks=N] [--json] [--browser=webkit|chromium]
// Serves the repo on a free port, opens tools/web/determinism.html and reads window.RESULT.
import { serve } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const which = browserArg('webkit');
const browser = await launch(which);
if (!browser) {
  console.log(`determinism [${which}]: UNAVAILABLE - the Playwright ${which} build is not installed (npx playwright install ${which}); run with --browser=chromium as a stand-in`);
  process.exit(UNAVAILABLE);
}
const srv = await serve(0);
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
let res;
try {
  await page.goto(srv.url + 'tools/web/determinism.html?ticks=' + arg('ticks', 3000) + '&scenes=' + arg('scenes', 'slice,bot'));
  await page.waitForFunction(() => window.RESULT, null, { timeout: 300000 });
  res = await page.evaluate(() => window.RESULT);
} catch (e) { res = { ok: false, error: String(e) }; }
await browser.close(); await srv.close();
if (errors.length) { res.ok = false; res.pageErrors = errors; }
if (process.argv.includes('--json')) console.log(JSON.stringify(res));
else {
  for (const c of res.checks || []) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '  (' + c.detail + ')' : ''}`);
  if (res.error) console.log('error: ' + res.error);
  for (const e of errors) console.log('page error: ' + e);
  console.log(`determinism [${which}]: ${res.ok ? 'PASS' : 'FAIL'}  hash ${res.hash || '-'}  ${res.ticks || 0} ticks  ${res.ms || 0} ms`);
}
process.exit(res.ok ? 0 : 1);
