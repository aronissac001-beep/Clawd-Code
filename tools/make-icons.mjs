// Renders the app icons with D's pixel-art painter (js/engine/art/appicon.js) in headless Chromium
// and writes PNGs to /icons.
//   node tools/make-icons.mjs
import { createRequire } from 'module';
import { writeFileSync } from 'fs';
import path from 'path';
import { serve, ROOT } from './lib/static-server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const srv = await serve(0);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(srv.url + 'tools/make-icons.html');
const list = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-512-maskable.png', 512, true], ['apple-touch-icon.png', 180, false]];
for (const [name, size, mask] of list) {
  const data = await page.evaluate(async ([s, m]) => (await import('/js/engine/art/appicon.js')).drawAppIcon(s, m).toDataURL('image/png'), [size, mask]);
  writeFileSync(path.join(ROOT, 'icons', name), Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', name);
}
await browser.close();
srv.close && srv.close();
process.exit(0);
