// Gate check "Phone UI" (14.4; enforced from Stage 1a; I's Stage 0 acceptance uses the title flow).
//   node tools/ui-phone.mjs [--browser=webkit|chromium] [--path=/] [--flow=title]
// At every gate viewport: no console errors or failed requests; no horizontal overflow; every
// visible interactive element >= 44 x 44 pt; every visible text node >= 14 px computed.
// Screenshots go to tools/out/ui-phone/ (look at them).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'out', 'ui-phone');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
export const VIEWPORTS = [
  { name: 'p375x635-safari', width: 375, height: 635 }, { name: 'p390x664-safari', width: 390, height: 664 },
  { name: 'p430x740-safari', width: 430, height: 740 }, { name: 'p390x763-app', width: 390, height: 763 },
  { name: 'l844x335-safari', width: 844, height: 335 }, { name: 'l932x380-safari', width: 932, height: 380 },
];
const which = browserArg('webkit');
const browser = await launch(which);
if (!browser) { console.log(`ui-phone [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); process.exit(UNAVAILABLE); }
const srv = await serve(0);
const path = arg('path', '/').replace(/^\//, '');
const sep = path.includes('?') ? '&' : '?';
let bad = 0;
const report = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => errs.push('failed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) errs.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(srv.url + path + sep + 'debug=1');
  await page.waitForTimeout(900);
  const probe = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
    const small = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [data-act], [onclick]')) {
      if (!vis(el)) continue; const r = el.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const tiny = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement)) continue;
      const fs = parseFloat(getComputedStyle(n.parentElement).fontSize);
      if (fs < 14 - 0.01) tiny.push(`"${n.textContent.trim().slice(0, 24)}" ${fs}px`);
    }
    return { overflowX: document.documentElement.scrollWidth > innerWidth + 0.5 || document.body.scrollWidth > innerWidth + 0.5, small, tiny, title: document.title };
  });
  await page.screenshot({ path: join(OUT, `${vp.name}.png`) });
  const problems = [...errs, ...(probe.overflowX ? ['horizontal overflow'] : []), ...probe.small.map((x) => 'target < 44 pt: ' + x), ...probe.tiny.map((x) => 'text < 14 px: ' + x)];
  if (problems.length) bad++;
  report.push({ vp: vp.name, ok: !problems.length, problems });
  await ctx.close();
}
await browser.close(); await srv.close();
for (const r of report) { console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.vp}`); for (const p of r.problems.slice(0, 12)) console.log('      ' + p); }
console.log(`ui-phone [${which}] /${path}: ${bad ? bad + ' viewport(s) with problems' : 'all viewports clean'} (screenshots in tools/out/ui-phone/)`);
process.exit(bad ? 1 : 0);
