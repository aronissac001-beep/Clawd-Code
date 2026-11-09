// Renders tools/make-icons.html in headless Chromium and writes PNGs to /icons.
//   node tools/make-icons.mjs
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + path.join(here, 'make-icons.html'));
const list = [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-512-maskable.png', 512, true], ['apple-touch-icon.png', 180, false]];
for (const [name, size, mask] of list) {
  const data = await page.evaluate(([s, m]) => window.drawIcon(s, m).toDataURL('image/png'), [size, mask]);
  writeFileSync(path.join(here, '..', 'icons', name), Buffer.from(data.split(',')[1], 'base64'));
  console.log('wrote', name);
}
await browser.close();
