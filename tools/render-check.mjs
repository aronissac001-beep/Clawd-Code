// Gate check "Render memory and battery" (doc 14.4, enforced from Stage 1a). Owner J; written by
// C, who owns what it measures.
//   node tools/render-check.mjs [--browser=webkit|chromium] [--vp=430x740] [--quick] [--scene=bot|slice]
// On the real game page (index.html?debug=1) with a day-5 colony: by default the colony bot's (tools/lib/
// bot.mjs botColony(1, 5): the real founding and five days of a scripted player); --scene=slice uses
// A's stand-in (tools/tests/slice-scene.mjs day5Colony):
//   1. pan the whole map in all three bands (near 1.25, mid 0.6, far 0.33, with band jumps): held
//      chunks are always within near 36 + mid 27, or mid 27 + far 48 (never another pair or all three);
//   2. no blank chunk rect in any frame: the renderer's blankRects counter stays 0, and sampled canvas
//      pixels inside the map never show the void colour;
//   3. mining a tile (terrain API mineTile) triggers a patch, not a bake;
//   4. throttle: still camera, no combat, 1x: 30 +- 2 draws/s; paused and still: <= 10; full-screen
//      menu: 0 (the game's own menu sheet, and the loop with covered = true).
// Exit 0 pass, 1 fail, 2 browser unavailable. Screenshots and JSON go to tools/out/render/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, ROOT } from './lib/static-server.mjs';
import { launch, browserArg, UNAVAILABLE } from './lib/browsers.mjs';

const OUT = join(ROOT, 'tools', 'out', 'render');
mkdirSync(OUT, { recursive: true });
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const quick = process.argv.includes('--quick');
const scene = arg('scene', 'bot');
const [vw, vh] = arg('vp', '430x740').split('x').map(Number);
const which = browserArg('webkit');
const browser = await launch(which);
if (!browser) { console.log(`render-check [${which}]: UNAVAILABLE - Playwright ${which} is not installed; try --browser=chromium`); process.exit(UNAVAILABLE); }
const srv = await serve(0);
const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, hasTouch: true, isMobile: which === 'chromium' ? true : undefined });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(srv.url + '?debug=1');
await page.waitForTimeout(400);

const checks = [];
const add = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };

// ---- set up: the day-5 colony in the real shell, with a per-frame probe on the renderer -----------
const setup = await page.evaluate(async (scene) => {
  let s;
  if (scene === 'slice') { const m = await import('/tools/tests/slice-scene.mjs'); s = (await m.day5Colony('DAY5-1')).s; }
  else { const b = await import('/tools/lib/bot.mjs'); s = await b.botColony(1, 5); }
  const app = await import('/js/ui/app.js');
  await app.enter(s);
  const sh = window.__ecUI.shell, r = sh.renderer;
  const RI = await import('/js/engine/render/index.js'); await RI.artKitReady(); const kit = !!RI.artKit();
  const P = window.__rc = { frames: 0, badPair: [], maxHeld: { near: 0, mid: 0, far: 0 }, worstPair: 0, blankPx: 0, samples: 0, sampleEvery: 0, lastBlank: 0 };
  const draw0 = r.draw.bind(r), tdraw0 = r.terrain.draw.bind(r.terrain);
  const WW = s.w * 32, WH = s.h * 32;
  // blank check right after the terrain layer (before the darkness and fog, whose colour is close to
  // the void): any pixel inside the map rect still showing the void clear colour is a blank rect
  r.terrain.draw = (g, view, z, cx, cy) => {
    const n = tdraw0(g, view, z, cx, cy);
    if (P.sampleEvery && (P.frames + 1) % P.sampleEvery === 0) {
      const cv = r.canvas, dpr = r.dpr;
      const img = g.getImageData(0, 0, cv.width, cv.height).data;
      for (let sy = 8; sy < r.h; sy += 24) for (let sx = 8; sx < r.w; sx += 24) {
        const wx = view.x0 + sx / view.z, wy = view.y0 + sy / view.z;
        if (wx < 4 || wy < 4 || wx > WW - 4 || wy > WH - 4) continue;
        const o = (Math.round(sy * dpr) * cv.width + Math.round(sx * dpr)) * 4;
        P.samples++;
        if (img[o] === 23 && img[o + 1] === 21 && img[o + 2] === 31) P.blankPx++;
      }
    }
    return n;
  };
  r.draw = (...a) => {
    draw0(...a);
    P.frames++;
    const t = r.terrain, h = { near: t.heldCount(0), mid: t.heldCount(1), far: t.heldCount(2) };
    for (const k in h) if (h[k] > P.maxHeld[k]) P.maxHeld[k] = h[k];
    const ok = (h.far === 0 && h.near <= 36 && h.mid <= 27) || (h.near === 0 && h.mid <= 27 && h.far <= 48);
    if (!ok && P.badPair.length < 10) P.badPair.push(h);
    const pair = h.near + h.mid + h.far; if (pair > P.worstPair) P.worstPair = pair;
  };
  return { scene, w: s.w, h: s.h, tick: s.tick, kit, bld: s.bld.filter(Boolean).length, items: s.items.filter(Boolean).length };
}, scene);

// ---- 1 + 2: pan the whole map in all three bands ---------------------------------------------------
const pan = await page.evaluate(async (quick) => {
  const sh = window.__ecUI.shell, r = sh.renderer, cam = sh.camera, P = window.__rc;
  sh.ui.speed = 0; sh.loop.timeScale = 0; // the sim is not what this measures
  P.sampleEvery = 20;
  const frame = () => new Promise(requestAnimationFrame);
  const WW = sh.state.w * 32, WH = sh.state.h * 32;
  const plan = quick ? [[1.25], [0.6], [0.33], [1.25]] : [[1.25], [0.6], [0.33], [0.6], [1.25], [0.33], [1.25]];
  const speed = (z) => 2600 / z; // world units per second
  const blank0 = r.terrain.st.blankRects, bakes0 = r.terrain.st.bakes, t0 = performance.now();
  let switches = 0, lastBand = r.terrain.band;
  for (let p = 0; p < plan.length; p++) {
    const z1 = plan[p][0], jump = p === 5; // one direct jump near -> far (a minimap tap at far zoom)
    if (jump) { cam.setZoom(z1); sh.loop.poke(); await frame(); }
    else { const z0 = cam.zoom; for (let k = 1; k <= 24; k++) { cam.setZoom(z0 + (z1 - z0) * (k / 24)); sh.loop.poke(); await frame(); } }
    const hw = r.w / cam.zoom, hh = r.h / cam.zoom;
    const rows = Math.max(1, Math.ceil(WH / hh));
    for (let row = 0; row < rows; row++) {
      const y = Math.min(WH - hh / 2, hh / 2 + row * hh), ltr = row % 2 === 0;
      let x = ltr ? hw / 2 : WW - hw / 2, last = performance.now();
      cam.centerOn(x, y, false);
      for (;;) {
        await frame();
        const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
        x += (ltr ? 1 : -1) * speed(cam.zoom) * dt;
        cam.centerOn(x, y, false); cam.moving = true; sh.loop.poke();
        if (r.terrain.band !== lastBand) { switches++; lastBand = r.terrain.band; }
        if (ltr ? x > WW - hw / 2 : x < hw / 2) break;
      }
    }
  }
  P.sampleEvery = 0;
  return { secs: +((performance.now() - t0) / 1000).toFixed(1), frames: P.frames, switches, bakes: r.terrain.st.bakes - bakes0, blankRects: r.terrain.st.blankRects - blank0,
    blankPx: P.blankPx, samples: P.samples, badPair: P.badPair, maxHeld: P.maxHeld, worstHeldSum: P.worstPair, evictions: r.terrain.st.evictions, released: r.terrain.st.released, placeholderRects: r.terrain.st.placeholderRects };
}, quick);
await page.screenshot({ path: join(OUT, 'check-after-pan.png') });
add('held chunks within near 36 + mid 27, or mid 27 + far 48 (all frames)', pan.badPair.length === 0, `max held near ${pan.maxHeld.near}, mid ${pan.maxHeld.mid}, far ${pan.maxHeld.far}; ${pan.switches} band switches, ${pan.bakes} bakes, ${pan.evictions} evictions, ${pan.released} released in ${pan.secs} s / ${pan.frames} frames${pan.badPair.length ? '; bad: ' + JSON.stringify(pan.badPair.slice(0, 3)) : ''}`);
add('no blank chunk rect in any frame', pan.blankRects === 0 && pan.blankPx === 0, `blankRects ${pan.blankRects}; void pixels ${pan.blankPx} of ${pan.samples} samples; placeholder rects drawn ${pan.placeholderRects}`);

// ---- 3: mining a tile triggers a patch, not a bake -------------------------------------------------
const mine = await page.evaluate(async () => {
  const sh = window.__ecUI.shell, r = sh.renderer, cam = sh.camera, s = sh.state;
  const { mineTile } = await import('/js/game/world/terrain.js');
  const { getBit, TER } = await import('/js/game/core/grid.js');
  const frame = () => new Promise(requestAnimationFrame);
  // a known rock tile next to mined floor
  let i0 = -1;
  for (let i = 0; i < s.L.terrain.length && i0 < 0; i++) {
    if (s.L.terrain[i] !== TER.ROCK || !getBit(s.L.known, i)) continue;
    const x = i % s.w, y = (i / s.w) | 0;
    if (x < 2 || y < 2 || x > s.w - 3 || y > s.h - 3) continue;
    if (s.L.terrain[i + 1] === TER.ROUGH || s.L.terrain[i - 1] === TER.ROUGH || s.L.terrain[i + s.w] === TER.ROUGH) i0 = i;
  }
  if (i0 < 0) return { error: 'no rock face found' };
  cam.setZoom(1); cam.centerOn((i0 % s.w + 0.5) * 32, (((i0 / s.w) | 0) + 0.5) * 32, false);
  for (let k = 0; k < 90; k++) { sh.loop.poke(); await frame(); } // let every visible chunk bake
  const st = r.terrain.st, b0 = st.bakes, p0 = st.patches;
  const res = mineTile(s, i0, null);
  for (let k = 0; k < 10; k++) { sh.loop.poke(); await frame(); }
  return { tile: i0, mined: !!res, bakes: st.bakes - b0, patches: st.patches - p0, patchAvgMs: +(st.patchMs / Math.max(1, st.patches)).toFixed(3) };
});
add('mining a tile triggers a patch, not a bake', mine.mined && mine.bakes === 0 && mine.patches >= 1, JSON.stringify(mine));
await page.screenshot({ path: join(OUT, 'check-mined.png') });

// ---- 4: the throttle ---------------------------------------------------------------------------------
const rate = (setupFn, secs = 3) => page.evaluate(async ([fn, secs]) => {
  const sh = window.__ecUI.shell, r = sh.renderer;
  (new Function('sh', fn))(sh);
  await new Promise((res) => setTimeout(res, 600)); // settle (inertia, pending pokes)
  const f0 = r.frames, t0 = performance.now();
  await new Promise((res) => setTimeout(res, secs * 1000));
  return +((r.frames - f0) / ((performance.now() - t0) / 1000)).toFixed(1);
}, [setupFn, secs]);
const still = await rate('sh.ui.speed = 1; sh.loop.timeScale = 1; sh.camera.vx = sh.camera.vy = 0;');
add('still camera, no combat, 1x: 30 +- 2 draws/s', Math.abs(still - 30) <= 2, `${still} draws/s`);
const paused = await rate('sh.ui.speed = 0; sh.loop.timeScale = 0;');
add('paused and still: <= 10 draws/s', paused <= 10, `${paused} draws/s`);
const menu = await rate('sh.ui.speed = 1; sh.loop.timeScale = 1; sh.openMenu();');
// does the menu cover the canvas? (a 6 x 6 grid of points all on opaque UI, none on the canvas)
const menuCovers = await page.evaluate(() => {
  const cv = document.getElementById('view'), rc = cv.getBoundingClientRect();
  for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
    const x = rc.left + (i + 0.5) * rc.width / 6, y = rc.top + (j + 0.5) * rc.height / 6;
    let e = document.elementFromPoint(x, y), opaque = false;
    if (!e || e === cv) return false;
    for (; e && e !== document.body; e = e.parentElement) { const bg = getComputedStyle(e).backgroundColor; const m = bg.match(/rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); if (p.length < 4 || p[3] >= 0.99) { opaque = true; break; } } }
    if (!opaque) return false;
  }
  return true;
});
const covered = await rate('window.__fpsFor0 = sh.loop.fpsFor; sh.loop.fpsFor = () => 0;');
await page.evaluate(() => { const sh = window.__ecUI.shell; sh.loop.fpsFor = window.__fpsFor0; });
add('full-screen menu: 0 draws/s (loop with covered = true)', covered === 0, `${covered} draws/s`);
if (menuCovers) add('full-screen menu: 0 draws/s (the game menu, I sets covered)', menu === 0, `${menu} draws/s`);
else console.log(`info  the game menu does not cover the canvas (a partial sheet): ${menu} draws/s, not checked`);
await page.screenshot({ path: join(OUT, 'check-menu.png') });
add('no console errors', errs.length === 0, errs.slice(0, 4).join(' | '));

const ok = checks.every((c) => c.ok);
const report = { engine: which, viewport: `${vw}x${vh}`, setup, pan, mine, rates: { still, paused, menu, menuCovers, covered }, checks };
writeFileSync(join(OUT, `render-check-${which}.json`), JSON.stringify(report, null, 1));
for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}: ${c.detail}`);
console.log(`render-check [${which}${which === 'chromium' ? ', stand-in for WebKit' : ''}]: ${ok ? 'PASS' : 'FAIL'} (${checks.filter((c) => c.ok).length}/${checks.length})`);
await ctx.close(); await browser.close(); await srv.close();
process.exit(ok ? 0 : 1);
