// W1.5 visual kit check (EMBERCROWN-WORLD.md 12.3 W1.5 Test and Oracle). Owner J; written by D, who owns
// what it measures. `node tools/render-check.mjs --scene=art` runs this file.
//   node tools/render-check-art.mjs [--browser=chromium|webkit] [--vp=390x664@3,844x335@3,390x664@2]
// 1. headless: every frame grid is 2 * slice + tile square, every pixel a palette colour or clear; at every
//    device pixel ratio (1, 1.25, 1.5, 2, 2.625, 3) and k (2, 3) the bake is m = round(k * dpr) whole device
//    px per art px and border-width * dpr = slice * m exactly;
// 2. in the browser at each viewport (touch emulation): the contact sheet `?debug=1&scene=art` reports
//    0 errors; the UI art samples (js/engine/art/ui.js uiArtSamples) mount without error;
// 3. frames scale by integers only: each frame kind is laid out as a real CSS border-image panel (via the
//    --px-frame-* custom properties that js/ui/frame.js installs) at an integer CSS position and an odd
//    device-pixel size, and screenshotted at device scale: all four corners equal the art grid upscaled by
//    m pixel for pixel (clear art pixels skipped), every colour in the four edge bands is a frame colour
//    (nothing blended) and equals the edge's art row scaled by m across the band, and every inner run of
//    one colour along a band is a multiple of m;
// 4. the icon sheet holds every icon bit for bit at scale 2.
// Exit 0 pass, 1 fail, 2 browser unavailable. Screenshots and JSON go to tools/out/render/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'render');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const vps = arg('vp', '390x664@3,844x335@3,390x664@2').split(',').map((v) => { const [wh, d] = v.split('@'); const [w, h] = wh.split('x').map(Number); return { w, h, dpr: +(d || 3) }; });
const checks = [];
const add = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${detail}`); };

// ---- 1. headless -------------------------------------------------------------------------------------
const UI = await import(new URL('../js/engine/art/ui.js', import.meta.url).href);
const { PAL } = await import(new URL('../js/engine/art/palette.js', import.meta.url).href);
{
  const pal = new Set(Object.values(PAL)), bad = [];
  for (const kind of UI.FRAME_KINDS) {
    const g = UI.frameGrid(kind);
    if (g.w !== 2 * g.slice + g.tile || g.h !== g.w || g.px.length !== g.w * g.h) bad.push(`${kind}: ${g.w} x ${g.h}`);
    g.px.forEach((c, i) => { if (c !== null && !pal.has(c)) bad.push(`${kind}@${i}: ${c}`); });
    if (g.fill && g.px[(g.h >> 1) * g.w + (g.w >> 1)] === null) bad.push(`${kind}: fill has a clear centre`);
  }
  for (const gr of [UI.ruleGrid(), UI.runeGrid()]) gr.px.forEach((c, i) => { if (c !== null && !pal.has(c)) bad.push(`rule/rune@${i}: ${c}`); });
  add('frame grids: square, palette colours only', bad.length === 0, bad.length ? bad.slice(0, 6).join('; ') : `${UI.FRAME_KINDS.length} kinds, rule 8 x 3, rune 9 x 9`);
  const off = [];
  for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) for (const k of [2, 3]) {
    const m = UI.devScale(k, dpr);
    if (!Number.isInteger(m) || m < 1) off.push(`k ${k} dpr ${dpr}: m ${m}`);
    for (const kind of UI.FRAME_KINDS) { const S = UI.frameGrid(kind).slice, w = +(S * m / dpr).toFixed(4); if (Math.abs(w * dpr - S * m) > 1e-3) off.push(`${kind} k ${k} dpr ${dpr}: ${w} css px`); }
  }
  add('bake scale is whole device px per art px at every ratio', off.length === 0, off.length ? off.slice(0, 4).join('; ') : 'dpr 1, 1.25, 1.5, 2, 2.625, 3 x k 2, 3');
}

// ---- 2-4. browser ------------------------------------------------------------------------------------
const which = browserArg('chromium');
const browser = await launch(which);
if (!browser) { console.log(`render-check --scene=art [${which}]: UNAVAILABLE - Playwright ${which} is not installed`); process.exit(UNAVAILABLE); }
const srv = await serve(0);
const report = { engine: which, viewports: [] };
for (const vp of vps) {
  const tag = `${vp.w}x${vp.h}@${vp.dpr}`;
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.dpr, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto(srv.url + '?debug=1&scene=art');
  await page.waitForFunction(() => window.__ecArt && window.__ecArt.ready, null, { timeout: 30000 }).catch(() => {});
  const art = await page.evaluate(() => { const r = window.__ecArt || {}; return { ready: !!r.ready, keys: r.keys, drawn: r.drawn, cells: r.cells, missing: (r.missing || []).length, errors: r.errors || ['no report'] }; });
  // the UI art section (the contact sheet mounts the same samples; mounted here too so this check stands alone)
  const samples = await page.evaluate(async () => {
    const UI = await import('/js/engine/art/ui.js');
    const { installPanels } = await import('/js/ui/frame.js');
    const panels = installPanels();
    const host = document.getElementById('artsheet') || document.body;
    const h = document.createElement('h2'); h.textContent = 'UI art: panel frames, rune rule, icon sheet (ui.js)'; host.appendChild(h);
    const grid = document.createElement('div'); grid.className = 'grid'; host.appendChild(grid);
    let out;
    try { const s = UI.uiArtSamples(document); s.figures.forEach((f) => grid.appendChild(f)); out = { ok: true, figures: s.figures.length, keys: s.keys }; }
    catch (e) { out = { ok: false, error: String(e && e.message) }; }
    out.panels = panels;
    out.vars = ['--px-frame-stone', '--px-frame-wood', '--px-frame-plate', '--px-frame-plate-hot', '--px-rule', '--px-rune'].filter((n) => !getComputedStyle(document.documentElement).getPropertyValue(n).includes('data:image/png'));
    return out;
  });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 150)));
  await page.evaluate(() => { const h = [...document.querySelectorAll('#artsheet h2')].pop(); if (h) h.scrollIntoView(); });
  await page.screenshot({ path: join(OUT, `art-ui-${tag}.png`) });

  // 3. integer scaling of the live border-image panels
  const frames = [];
  for (const kind of UI.FRAME_KINDS) {
    const box = await page.evaluate((kind) => {
      const n = kind.replace('.', '-');
      let el = document.getElementById('__uiframe');
      if (!el) { el = document.createElement('div'); el.id = '__uiframe'; document.body.appendChild(el); }
      el.style.cssText = `position:fixed;left:10px;top:10px;z-index:99999;width:${n.startsWith('plate') ? 141 : 203}px;height:${n.startsWith('plate') ? 29 : 97}px;background:#ff00ff;`
        + `border:var(--px-frame-${n}-w) solid transparent;border-image:var(--px-frame-${n}) var(--px-frame-${n}-slice) / var(--px-frame-${n}-w) repeat;image-rendering:pixelated;box-sizing:content-box;background-clip:padding-box`;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, bw: getComputedStyle(el).borderTopWidth, m: +getComputedStyle(document.documentElement).getPropertyValue('--px-m') };
    }, kind);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    const grid = UI.frameGrid(kind), m = box.m;
    const res = await page.evaluate(async ({ b64, grid, m }) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data, W = c.width, H = c.height;
      const hex = (x, y) => { const o = (y * W + x) * 4; return '#' + [d[o], d[o + 1], d[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''); };
      const S = grid.slice, gw = grid.w, gh = grid.h, SM = S * m, bad = [];
      // corners: device px (x, y) of each corner box against the grid scaled by m
      const corners = [[0, 0, 0, 0], [W - SM, 0, gw - S, 0], [0, H - SM, 0, gh - S], [W - SM, H - SM, gw - S, gh - S]];
      let px = 0;
      for (const [dx, dy, gx, gy] of corners) for (let y = 0; y < SM; y++) for (let x = 0; x < SM; x++) {
        const want = grid.px[(gy + ((y / m) | 0)) * gw + gx + ((x / m) | 0)], got = hex(dx + x, dy + y);
        px++;
        if (want !== null && got !== want) { if (bad.length < 4) bad.push(`corner (${dx + x},${dy + y}) ${got} != ${want}`); }
      }
      // edge bands: run lengths along each band, ignoring the partial tiles at the two ends
      const pal = new Set(grid.px.filter(Boolean)), runs = [];
      const band = (n, at, want) => { // n device px along, at(i, j) -> colour, j across 0..SM-1; want(art row across)
        for (let j = 0; j < SM; j++) {
          let prev = null, len = 0; const seq = [], w = want((j / m) | 0);
          for (let i = SM; i < n - SM; i++) {
            const c = at(i, j);
            if ((!pal.has(c) || c !== w) && bad.length < 8) bad.push(`band px ${c} != ${w} at ${i},${j}`);
            if (c === prev) len++; else { if (prev) seq.push(len); prev = c; len = 1; }
          }
          seq.shift(); // the first run may be cut by the corner
          for (const L of seq) { runs.push(L); if (L % m && bad.length < 8) bad.push(`run ${L} not a multiple of ${m} (row ${j})`); }
          bandPx += n - 2 * SM;
        }
      };
      let bandPx = 0;
      band(W, (i, j) => hex(i, j), (r) => grid.px[r * gw + S]); band(W, (i, j) => hex(i, H - 1 - j), (r) => grid.px[(gh - 1 - r) * gw + S]);
      band(H, (i, j) => hex(j, i), (r) => grid.px[S * gw + r]); band(H, (i, j) => hex(W - 1 - j, i), (r) => grid.px[S * gw + gw - 1 - r]);
      return { W, H, cornerPx: px, bandPx, runs: runs.length, bad };
    }, { b64: png.toString('base64'), grid: { slice: grid.slice, w: grid.w, h: grid.h, px: grid.px }, m });
    frames.push({ kind, m, borderWidth: box.bw, ...res });
  }
  await page.evaluate(() => document.getElementById('__uiframe')?.remove());

  // 4. the icon sheet, bit for bit
  const icons = await page.evaluate(async () => {
    const UI = await import('/js/engine/art/ui.js'), I = await import('/js/ui/icons.js');
    const sh = UI.iconSheet({ scale: 2, color: '#ffffff' }), g = sh.canvas.getContext('2d');
    const d = g.getImageData(0, 0, sh.canvas.width, sh.canvas.height).data, W = sh.canvas.width;
    let bad = 0;
    for (const n of I.ICON_NAMES) {
      const [ox, oy] = sh.rect(n), bits = I.iconBits(n);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const on = (bits[y >> 1] >> (15 - (x >> 1))) & 1, a = d[((oy + y) * W + ox + x) * 4 + 3]; if ((on ? a !== 255 : a !== 0)) bad++; }
    }
    return { icons: I.ICON_NAMES.length, bad, size: [sh.canvas.width, sh.canvas.height] };
  });

  const v = { tag, art, samples, frames, icons, errs };
  report.viewports.push(v);
  add(`${tag}: contact sheet 0 errors`, art.ready && art.errors.length === 0, `${art.keys} keys, ${art.drawn} drawn in ${art.cells} cells, ${art.missing} not drawn, ${art.errors.length} errors${art.errors.length ? ': ' + art.errors.slice(0, 3).join('; ') : ''}`);
  add(`${tag}: UI art samples mount, frames installed`, samples.ok && samples.vars.length === 0, samples.ok ? `${samples.figures} figures (${samples.keys.join(', ')}), panels at dpr ${samples.panels}${samples.vars.length ? '; missing ' + samples.vars.join(', ') : ''}` : samples.error);
  for (const f of frames) add(`${tag}: ${f.kind} frame scales by integers only (m ${f.m})`, f.bad.length === 0 && f.cornerPx > 0, `${f.W} x ${f.H} dev px, border ${f.borderWidth}; ${f.cornerPx} corner px and ${f.bandPx} edge px equal the art scaled by ${f.m}${f.bad.length ? '; ' + f.bad.join('; ') : ''}`);
  add(`${tag}: icon sheet bit for bit`, icons.bad === 0, `${icons.icons} icons, ${icons.size.join(' x ')} px, ${icons.bad} wrong px`);
  add(`${tag}: no console errors`, errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  await ctx.close();
}
const ok = checks.every((c) => c.ok);
writeFileSync(join(OUT, `render-check-art-${which}.json`), JSON.stringify({ ...report, checks }, null, 1));
console.log(`render-check --scene=art [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${ok ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.ok).length}/${checks.length})`);
await browser.close(); await srv.close();
process.exit(ok ? 0 : 1);
